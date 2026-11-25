const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  computeAdaptiveCrossfadeDuration,
  computeOverlapCrossfadePlan: backendComputePlan,
  buildSegmentMixFilterChain,
  createSynchronizedNarrationAudio,
} = require('../services/ffmpeg/ffmpegAudioMixAndDucking');
const { FFMPEG_PATH, getMediaDuration } = require('../services/ffmpeg/ffmpegProbeAndFrames');

/**
 * Decode an audio file to mono Float32 PCM at 24kHz for exact RMS & peak envelope inspection.
 */
function decodeAudioToMonoFloat32(filePath, sampleRate = 24000) {
  const res = spawnSync(
    FFMPEG_PATH,
    ['-v', 'error', '-i', filePath, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'],
    { maxBuffer: 50 * 1024 * 1024, windowsHide: true }
  );
  assert.equal(res.status, 0, `FFmpeg PCM decode failed for ${filePath}: ${res.stderr?.toString()}`);
  const buf = res.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

function measureWindowRmsAndPeak(samples, sampleRate, startSec, endSec) {
  const s = Math.max(0, Math.floor(startSec * sampleRate));
  const e = Math.min(samples.length, Math.floor(endSec * sampleRate));
  if (e <= s) return { rms: 0, peak: 0 };
  let sumSq = 0;
  let peak = 0;
  for (let i = s; i < e; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    sumSq += v * v;
  }
  return {
    rms: Math.sqrt(sumSq / (e - s)),
    peak,
  };
}

/**
 * Minimal deterministic Web Audio API mock that enforces spec-compliant non-overlapping
 * setValueCurveAtTime / setValueAtTime automation scheduling.
 */
function createMockAudioContext() {
  let currentTime = 0;
  const createdGains = [];
  const createdSources = [];

  class MockAudioParam {
    constructor(initialValue = 1.0) {
      this.value = initialValue;
      this.events = [];
    }
    cancelScheduledValues(t) {
      this.events = this.events.filter((e) => e.startTime < t);
    }
    setValueAtTime(val, t) {
      for (const e of this.events) {
        if (e.type === 'curve' && t >= e.startTime && t <= e.startTime + e.duration) {
          throw new Error(`NotSupportedError: setValueAtTime(${t}) overlaps curve [${e.startTime}, ${e.startTime + e.duration}]`);
        }
      }
      this.events.push({ type: 'set', value: val, startTime: t });
      if (t <= currentTime) this.value = val;
    }
    setValueCurveAtTime(values, t, duration) {
      if (!values || values.length < 2) throw new Error('InvalidStateError: curve length < 2');
      if (!(duration > 0)) throw new Error('InvalidStateError: curve duration <= 0');
      for (const e of this.events) {
        const eEnd = e.type === 'curve' ? (e.startTime + e.duration) : e.startTime;
        if (t <= eEnd && (t + duration) >= e.startTime) {
          throw new Error(`NotSupportedError: curve [${t}, ${t + duration}] overlaps event [${e.startTime}, ${eEnd}]`);
        }
      }
      this.events.push({ type: 'curve', values: Float32Array.from(values), startTime: t, duration });
    }
    evalAt(t) {
      let val = this.value;
      const sorted = [...this.events].sort((a, b) => a.startTime - b.startTime);
      for (const e of sorted) {
        if (t < e.startTime) break;
        if (e.type === 'set') {
          val = e.value;
        } else if (e.type === 'curve') {
          const frac = Math.min(1, Math.max(0, (t - e.startTime) / e.duration));
          const idx = frac * (e.values.length - 1);
          const lo = Math.floor(idx);
          const hi = Math.min(e.values.length - 1, lo + 1);
          const alpha = idx - lo;
          val = e.values[lo] * (1 - alpha) + e.values[hi] * alpha;
        }
      }
      return val;
    }
  }

  return {
    get currentTime() { return currentTime; },
    set currentTime(v) { currentTime = v; },
    state: 'running',
    destination: { kind: 'destination' },
    resume: async () => {},
    close: async () => {},
    createGain() {
      const node = { gain: new MockAudioParam(1.0), connectedTo: null, connect(dest) { this.connectedTo = dest; }, disconnect() {} };
      createdGains.push(node);
      return node;
    },
    createBufferSource() {
      const node = {
        buffer: null,
        playbackRate: new MockAudioParam(1.0),
        started: null,
        stopped: false,
        connect() {},
        disconnect() {},
        start(when, offset, duration) { this.started = { when, offset, duration }; },
        stop() { this.stopped = true; },
      };
      createdSources.push(node);
      return node;
    },
    createdGains,
    createdSources,
  };
}

describe('Automatic Smooth Audio Crossfade (Web Audio API GainNode + FFmpeg afade)', () => {
  it('1. Exact 0.2s overlap (Clip #12 -> #13): backend & frontend produce identical half-sine crossfade plans', async () => {
    const fe = await import('../../frontend/src/utils/webAudioScheduler.js');

    // Clip #12: 10.00s..11.20s (dur 1.20s), Clip #13: 11.00s..12.50s (dur 1.50s) -> 0.20s overlap
    const segs = [
      { id: 12, startSec: 10.0, durSec: 1.2, endSec: 11.2, trackRow: 0 },
      { id: 13, startSec: 11.0, durSec: 1.5, endSec: 12.5, trackRow: 0 },
    ];
    const bePlan = backendComputePlan(segs);
    const fePlanMap = fe.computeOverlapCrossfadePlan(
      segs.map((s) => ({ key: String(s.id), startSec: s.startSec, endSec: s.endSec, durSec: s.durSec }))
    );

    assert.equal(bePlan[0].fadeIn, null);
    assert.equal(bePlan[0].fadeOut.startSec, 11.0);
    assert.equal(bePlan[0].fadeOut.endSec, 11.2);
    assert.equal(bePlan[0].fadeOut.durSec, 0.2);
    assert.equal(bePlan[0].fadeOut.relStartSec, 1.0);

    assert.equal(bePlan[1].fadeIn.startSec, 11.0);
    assert.equal(bePlan[1].fadeIn.endSec, 11.2);
    assert.equal(bePlan[1].fadeIn.durSec, 0.2);
    assert.equal(bePlan[1].fadeOut, null);

    // Exact frontend-backend parity
    const fe12 = fePlanMap.get('12');
    const fe13 = fePlanMap.get('13');
    assert.equal(fe12.fadeOut.startSec, bePlan[0].fadeOut.startSec);
    assert.equal(fe12.fadeOut.endSec, bePlan[0].fadeOut.endSec);
    assert.equal(fe12.fadeOut.durSec, bePlan[0].fadeOut.durSec);
    assert.equal(fe13.fadeIn.startSec, bePlan[1].fadeIn.startSec);
    assert.equal(fe13.fadeIn.endSec, bePlan[1].fadeIn.endSec);
    assert.equal(fe13.fadeIn.durSec, bePlan[1].fadeIn.durSec);

    // Verify FFmpeg filter chains (zero atempo, zero atrim, exact curve=hsin)
    const f12 = buildSegmentMixFilterChain({ ...segs[0], crossfadePlan: bePlan[0] }, null, 10000);
    const f13 = buildSegmentMixFilterChain({ ...segs[1], crossfadePlan: bePlan[1] }, null, 11000);
    assert.equal(f12, 'afade=t=out:st=1.000:d=0.200:curve=hsin,adelay=10000|10000');
    assert.equal(f13, 'afade=t=in:st=0:d=0.200:curve=hsin,adelay=11000|11000');

    // Verify constant-sum unity gain across entire 0.20s overlap: g12(t) + g13(t) === 1.0 (zero clipping, zero volume jump)
    for (let step = 0; step <= 20; step++) {
      const t = 11.0 + (0.2 * step) / 20;
      const g12 = fe.evalSegmentCrossfadeGainAtTime(t, fe12, 1.0);
      const g13 = fe.evalSegmentCrossfadeGainAtTime(t, fe13, 1.0);
      assert.ok(Math.abs((g12 + g13) - 1.0) < 1e-6, `At t=${t.toFixed(3)}, g12(${g12}) + g13(${g13}) must equal 1.0`);
    }
    assert.ok(Math.abs(fe.evalSegmentCrossfadeGainAtTime(11.1, fe12, 1.0) - 0.5) < 1e-6, 'Midpoint fade-out must be 50%');
    assert.ok(Math.abs(fe.evalSegmentCrossfadeGainAtTime(11.1, fe13, 1.0) - 0.5) < 1e-6, 'Midpoint fade-in must be 50%');
  });

  it('2. Adaptive fade caps protect short spoken words, multi-lane transitions, chained overlaps, and simultaneous starts', () => {
    // Large overlap (0.90s) -> capped at 0.35s so Clip #13 reaches full clarity rapidly
    assert.equal(computeAdaptiveCrossfadeDuration(0.90, 2.0, 2.0), 0.35);

    // Short incoming clip (0.50s) -> capped at 35% of clip = 0.175s to protect intelligibility
    assert.equal(computeAdaptiveCrossfadeDuration(0.40, 2.0, 0.50), 0.175);

    // Negligible sub-15ms overlap -> 0 (untouched)
    assert.equal(computeAdaptiveCrossfadeDuration(0.010, 1.5, 1.5), 0);

    // Multi-lane transition (trackRow 0 -> trackRow 1 -> trackRow 0) + chained 3-clip overlap
    const chained = [
      { id: 11, startSec: 5.0, durSec: 1.5, trackRow: 0 }, // ends 6.5
      { id: 12, startSec: 6.3, durSec: 0.9, trackRow: 1 }, // overlaps #11 by 0.2s, ends 7.2
      { id: 13, startSec: 7.0, durSec: 1.4, trackRow: 0 }, // overlaps #12 by 0.2s, ends 8.4
    ];
    const plan = backendComputePlan(chained);
    assert.equal(plan[0].fadeOut.durSec, 0.2);
    assert.equal(plan[1].fadeIn.durSec, 0.2);
    assert.equal(plan[1].fadeOut.durSec, 0.2);
    assert.ok(plan[1].fadeIn.endSec < plan[1].fadeOut.startSec, 'Chained clip fadeIn must finish before fadeOut starts');
    assert.equal(plan[2].fadeIn.durSec, 0.2);

    // Simultaneous start (startA === startB) must NOT zero out Clip A from t=0
    const simultaneous = [
      { id: 1, startSec: 2.0, durSec: 1.5, trackRow: 0 },
      { id: 2, startSec: 2.0, durSec: 1.5, trackRow: 1 },
    ];
    const simPlan = backendComputePlan(simultaneous);
    assert.equal(simPlan[0].fadeOut, null);
    assert.equal(simPlan[1].fadeIn, null);
  });

  it('3. WebAudioScheduler schedules GainNode setValueCurveAtTime cleanly across Clip #12 -> #13 without 60Hz thrashing', async () => {
    const { WebAudioScheduler } = await import('../../frontend/src/utils/webAudioScheduler.js');
    const mockCtx = createMockAudioContext();
    const scheduler = new WebAudioScheduler({ maxCachedBuffers: 20 });
    scheduler.ctx = mockCtx;
    scheduler.masterGain = mockCtx.createGain();
    scheduler.isSupported = () => true;

    // Pre-populate decoded AudioBuffers for Clip #12 (1.20s) and Clip #13 (1.50s)
    scheduler.lruCache.set('/audio/clip12.mp3', { duration: 1.20, numberOfChannels: 1, sampleRate: 24000 }, 0);
    scheduler.lruCache.set('/audio/clip13.mp3', { duration: 1.50, numberOfChannels: 1, sampleRate: 24000 }, 0);

    const segments = [
      { id: 12, audioStartSec: 10.0, finalAudioDuration: 1.20, audioUrl: '/audio/clip12.mp3', trackRow: 0 },
      { id: 13, audioStartSec: 11.0, finalAudioDuration: 1.50, audioUrl: '/audio/clip13.mp3', trackRow: 1 },
    ];

    // Tick at t=9.50s (lookahead schedules both Clip #12 at 10.0s and Clip #13 at 11.0s)
    mockCtx.currentTime = 0.0;
    scheduler.syncAtTimelineTime({ timelineNow: 9.5, playbackRate: 1.0, segments, khmerVolume: 1.0, isKhmerMuted: false, lookaheadSec: 2.2 });

    const node12 = scheduler.scheduledNodes.get('12');
    const node13 = scheduler.scheduledNodes.get('13');
    assert.ok(node12, 'Clip #12 must be scheduled');
    assert.ok(node13, 'Clip #13 must be scheduled');

    // Clip #12 must NOT be hard-cut at 11.0s; it plays smoothly to 11.2s while fading out!
    assert.equal(node12.segEnd, 11.2);
    assert.ok(Math.abs(node12.sourceNode.started.duration - 1.2) < 1e-4, 'Clip #12 source plays full 1.2s through fade-out');

    // Verify exact GainNode automation curves at AudioContext times:
    // timelineNow=9.5 -> ctx=0.0 => Clip #12 starts at ctx=0.5, overlap is ctx=1.5..1.7
    assert.ok(Math.abs(node12.gainNode.gain.evalAt(1.0) - 1.0) < 1e-4, 'Clip #12 full volume before overlap');
    assert.ok(Math.abs(node12.gainNode.gain.evalAt(1.5) - 1.0) < 1e-3, 'Clip #12 starts fade-out at 100%');
    assert.ok(Math.abs(node12.gainNode.gain.evalAt(1.6) - 0.5) < 1e-2, 'Clip #12 reaches 50% at overlap midpoint');
    assert.ok(Math.abs(node12.gainNode.gain.evalAt(1.7) - 0.0) < 1e-3, 'Clip #12 reaches 0% at overlap end');

    assert.ok(Math.abs(node13.gainNode.gain.evalAt(1.5) - 0.0) < 1e-3, 'Clip #13 starts fade-in at 0%');
    assert.ok(Math.abs(node13.gainNode.gain.evalAt(1.6) - 0.5) < 1e-2, 'Clip #13 reaches 50% at overlap midpoint');
    assert.ok(Math.abs(node13.gainNode.gain.evalAt(1.7) - 1.0) < 1e-3, 'Clip #13 reaches 100% at overlap end');

    // Simulate 30 subsequent 60Hz ticks across the transition -> nodes must NOT thrash/recreate!
    const origSource12 = node12.sourceNode;
    const origSource13 = node13.sourceNode;
    for (let k = 1; k <= 30; k++) {
      const dt = k * 0.05;
      mockCtx.currentTime = dt;
      scheduler.syncAtTimelineTime({ timelineNow: 9.5 + dt, playbackRate: 1.0, segments, khmerVolume: 1.0, isKhmerMuted: false, lookaheadSec: 2.2 });
    }
    assert.equal(scheduler.scheduledNodes.get('12')?.sourceNode, origSource12, 'Clip #12 must not tear down during playback');
    assert.equal(scheduler.scheduledNodes.get('13')?.sourceNode, origSource13, 'Clip #13 must not tear down during playback');
  });

  it('4. Real FFmpeg Audio Export Verification (actual Clip #12 -> #13 MP3s + 0.2s & real episode overlaps)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossfade_real_verify_'));
    try {
      // Load real Clip #12 and Clip #13 MP3s from Solo_Summoning ep_18 (if present on disk), else synthesize speech-like tones
      const realSeriesPath = path.resolve(__dirname, '../uploads/projects/Solo_Summoning/series.json');
      let clip12Path = null;
      let clip13Path = null;
      let usingRealClips = false;

      if (fs.existsSync(realSeriesPath)) {
        const sj = JSON.parse(fs.readFileSync(realSeriesPath, 'utf8'));
        const eps = Array.isArray(sj.episodes) ? sj.episodes : Object.values(sj.episodes || {});
        const ep18 = eps.find((e) => e.id === 'ep_18');
        if (ep18?.scriptData?.segments?.[11]?.audioPath && ep18?.scriptData?.segments?.[12]?.audioPath) {
          const p12 = ep18.scriptData.segments[11].audioPath;
          const p13 = ep18.scriptData.segments[12].audioPath;
          if (fs.existsSync(p12) && fs.existsSync(p13)) {
            clip12Path = p12;
            clip13Path = p13;
            usingRealClips = true;
          }
        }
      }

      // Also create two constant-level sine clips (440Hz & 660Hz) to mathematically verify exact 100%->0% and 0%->100% curves in FFmpeg output!
      const tone12Path = path.join(tmpDir, 'tone12.mp3');
      const tone13Path = path.join(tmpDir, 'tone13.mp3');
      for (const [p, freq, dur] of [[tone12Path, 440, 1.2], [tone13Path, 660, 1.2]]) {
        const gen = spawnSync(FFMPEG_PATH, [
          '-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`,
          '-af', 'volume=0.5', '-c:a', 'libmp3lame', '-q:a', '2', p,
        ], { windowsHide: true });
        assert.equal(gen.status, 0);
      }

      // Verify exact 0.20s overlap on tones (Clip #12 at 0.0..1.2s, Clip #13 at 1.0..2.2s)
      const toneMixPath = path.join(tmpDir, 'tone_crossfade_02s.mp3');
      const tone12OnlyPath = path.join(tmpDir, 'tone12_fadeout_only.mp3');
      await createSynchronizedNarrationAudio([
        { id: 12, startSec: 0.0, audioDurationSec: 1.2, audioPath: tone12Path, trackRow: 0 },
        { id: 13, startSec: 1.0, audioDurationSec: 1.2, audioPath: tone13Path, trackRow: 1 },
      ], toneMixPath);

      assert.ok(fs.existsSync(toneMixPath), 'Crossfaded tone mix must be exported');
      const toneSamples = decodeAudioToMonoFloat32(toneMixPath, 24000);
      const beforeOverlap = measureWindowRmsAndPeak(toneSamples, 24000, 0.3, 0.9);
      const duringOverlap = measureWindowRmsAndPeak(toneSamples, 24000, 1.02, 1.18);
      const afterOverlap = measureWindowRmsAndPeak(toneSamples, 24000, 1.3, 1.9);

      // Zero clipping (peak < 0.96), smooth energy continuity (no 0-drop, no 2x spike!)
      assert.ok(duringOverlap.peak < 0.96, `Overlap peak must not clip (got ${duringOverlap.peak.toFixed(3)})`);
      assert.ok(
        duringOverlap.rms > beforeOverlap.rms * 0.55 && duringOverlap.rms < beforeOverlap.rms * 1.15,
        `Overlap RMS (${duringOverlap.rms.toFixed(3)}) must stay smooth vs pre-overlap RMS (${beforeOverlap.rms.toFixed(3)})`
      );
      assert.ok(
        Math.abs(afterOverlap.rms - beforeOverlap.rms) < 0.06,
        `Post-overlap Clip #13 RMS (${afterOverlap.rms.toFixed(3)}) must match full level (${beforeOverlap.rms.toFixed(3)})`
      );

      // Verify real Khmer Clip #12 -> #13 MP3 export (preserving source files untouched!)
      if (usingRealClips) {
        const stat12Before = fs.statSync(clip12Path);
        const stat13Before = fs.statSync(clip13Path);
        const realDur12 = await getMediaDuration(clip12Path);
        const realDur13 = await getMediaDuration(clip13Path);

        // Place Clip #12 at 0.0s and Clip #13 so actual overlap is exact 0.20s
        const start13 = Math.max(0.2, Number((realDur12 - 0.20).toFixed(3)));
        const realMixPath = path.join(tmpDir, 'real_clip12_13_crossfade_02s.mp3');
        await createSynchronizedNarrationAudio([
          { id: 12, startSec: 0.0, audioDurationSec: realDur12, audioPath: clip12Path, trackRow: 0 },
          { id: 13, startSec: start13, audioDurationSec: realDur13, audioPath: clip13Path, trackRow: 0 },
        ], realMixPath);

        assert.ok(fs.existsSync(realMixPath), 'Real Clip #12 -> #13 crossfaded MP3 must exist');
        const outDur = await getMediaDuration(realMixPath);
        const expectedOutDur = start13 + realDur13;
        assert.ok(
          Math.abs(outDur - expectedOutDur) < 0.12,
          `Exported duration (${outDur.toFixed(3)}s) must preserve exact original timing (${expectedOutDur.toFixed(3)}s) without atempo`
        );

        const realSamples = decodeAudioToMonoFloat32(realMixPath, 24000);
        const overlapStats = measureWindowRmsAndPeak(realSamples, 24000, start13, realDur12);
        const fullStats = measureWindowRmsAndPeak(realSamples, 24000, 0, outDur);
        assert.ok(fullStats.peak < 0.98, `Real Clip #12->#13 mix must not clip (peak=${fullStats.peak.toFixed(3)})`);
        assert.ok(overlapStats.rms > 0.002, `Real Clip #12->#13 overlap must remain smoothly audible (rms=${overlapStats.rms.toFixed(4)})`);

        // Confirm original source audio files are 100% untouched (zero regeneration / zero mutation)
        const stat12After = fs.statSync(clip12Path);
        const stat13After = fs.statSync(clip13Path);
        assert.equal(stat12After.size, stat12Before.size);
        assert.equal(stat12After.mtimeMs, stat12Before.mtimeMs);
        assert.equal(stat13After.size, stat13Before.size);
        assert.equal(stat13After.mtimeMs, stat13Before.mtimeMs);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
