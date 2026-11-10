const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const ttsService = require('../services/ttsService');
const { getMediaDuration } = require('../services/ffmpegService');
const audioRoutes = require('../routes/audioRoutes');
const { uploadsDir } = require('../utils/pathUtils');

const {
  speedToEdgeRate,
  resolveSegmentSpeed,
  generateBatchSegmentsAudio,
} = ttsService;

function captureConsoleWarningsAndLogs(fn) {
  const logs = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    origLog.apply(console, args);
  };
  console.warn = (...args) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    origWarn.apply(console, args);
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = origLog;
      console.warn = origWarn;
    })
    .then((res) => ({ res, logs }));
}

function createAudioTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', audioRoutes);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}/api/generate-audio`,
      });
    });
  });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('speedToEdgeRate converts numeric, string, preset, and missing speeds accurately', () => {
  assert.deepEqual(
    speedToEdgeRate(1.5),
    { provided: true, valid: true, rate: '+50%', numericSpeed: 1.5, isCustomNonDefault: true, requested: 1.5 }
  );
  assert.deepEqual(
    speedToEdgeRate(0.75),
    { provided: true, valid: true, rate: '-25%', numericSpeed: 0.75, isCustomNonDefault: true, requested: 0.75 }
  );
  assert.deepEqual(
    speedToEdgeRate(1.25),
    { provided: true, valid: true, rate: '+25%', numericSpeed: 1.25, isCustomNonDefault: true, requested: 1.25 }
  );
  assert.deepEqual(
    speedToEdgeRate(1),
    { provided: true, valid: true, rate: '+0%', numericSpeed: 1, isCustomNonDefault: false, requested: 1 }
  );
  assert.deepEqual(
    speedToEdgeRate('normal'),
    { provided: true, valid: true, rate: '+0%', numericSpeed: 1.0, isCustomNonDefault: false, requested: 'normal' }
  );
  assert.equal(speedToEdgeRate(undefined).rate, '+0%');
  assert.equal(speedToEdgeRate(undefined).provided, false);
  assert.equal(speedToEdgeRate(null).rate, '+0%');
  assert.equal(speedToEdgeRate('').rate, '+0%');
  assert.equal(speedToEdgeRate('1.5x').rate, '+50%');
  assert.equal(speedToEdgeRate('+50%').rate, '+50%');
  assert.equal(speedToEdgeRate('-25%').rate, '-25%');
  assert.equal(speedToEdgeRate('slow').rate, '-25%');
  assert.equal(speedToEdgeRate('fast').rate, '+25%');

  for (const invalid of ['bogus', 0, -0.5, NaN, 5.0, {}]) {
    const res = speedToEdgeRate(invalid);
    assert.equal(res.provided, true, `Expected provided=true for ${String(invalid)}`);
    assert.equal(res.valid, false, `Expected valid=false for ${String(invalid)}`);
    assert.equal(res.rate, null);
  }
});

test('resolveSegmentSpeed logs explicit [TTS] line on invalid speed and enforces precedence', async () => {
  const { res: invalidInfo, logs } = await captureConsoleWarningsAndLogs(() =>
    resolveSegmentSpeed({ id: 42 }, { speed: 'turbo-invalid' })
  );
  assert.equal(invalidInfo.speedApplyFailed, true);
  assert.equal(invalidInfo.rate, '+0%');
  assert.ok(
    logs.some((l) => l.includes('[TTS]') && l.includes('turbo-invalid')),
    `Expected [TTS] warning containing "turbo-invalid", got: ${JSON.stringify(logs)}`
  );

  // Absent options.speed / options.rate uses segment payload's own speed & userCustomSpeed
  const segFallback = resolveSegmentSpeed({ id: 7, speed: 1.5, userCustomSpeed: true }, {});
  assert.equal(segFallback.rate, '+50%');
  assert.equal(segFallback.hasExplicitUserSpeed, true);

  // userCustomSpeed: true with speed 1 keeps rate +0% AND still skips autoStretch (hasExplicitUserSpeed=true)
  const customNormal = resolveSegmentSpeed({ id: 8, speed: 1, userCustomSpeed: true }, {});
  assert.equal(customNormal.rate, '+0%');
  assert.equal(customNormal.hasExplicitUserSpeed, true);
});

test('generateBatchSegmentsAudio applies userCustomSpeed/rate per segment and preserves fit on untouched segments', async () => {
  const calls = [];
  const spySingle = async (seg, _dir, opts) => {
    calls.push({ id: seg.id, opts });
    return { ...seg, ttsRate: opts.rate || '+0%', audioUrl: `/uploads/fake_${seg.id}.mp3`, voiceId: 'km-KH-PisethNeural' };
  };

  const segments = [
    { id: 1, khmer: 'ឃ្លាទីមួយធម្មតា', startSec: 0, endSec: 2.0 },
    { id: 2, khmer: 'ឃ្លាទីពីរលឿន', startSec: 2.5, endSec: 4.5, speed: 1.5, userCustomSpeed: true },
    { id: 3, khmer: 'ឃ្លាទីបីត្រឡប់ធម្មតា', startSec: 5.0, endSec: 7.0, speed: 1, userCustomSpeed: false },
  ];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts_batch_parity_'));
  try {
    await generateBatchSegmentsAudio(segments, tmpDir, {
      concurrency: 1,
      autoStretch: true,
      speed: 'normal',
      generateSingleFn: spySingle,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.equal(calls.length, 3);
  const c1 = calls.find((c) => c.id === 1);
  const c2 = calls.find((c) => c.id === 2);
  const c3 = calls.find((c) => c.id === 3);

  assert.equal(c1.opts.rate, '+0%');
  assert.equal(c1.opts.autoStretch, true);
  assert.equal(c1.opts.userCustomSpeed, false);

  assert.equal(c2.opts.rate, '+50%');
  assert.equal(c2.opts.autoStretch, false);
  assert.equal(c2.opts.userCustomSpeed, true);

  assert.equal(c3.opts.rate, '+0%');
  assert.equal(c3.opts.autoStretch, true);
  assert.equal(c3.opts.userCustomSpeed, false);
});

test('Frontend speed fields reset userCustomSpeed on 1.0x and do not clobber 0/segment speed in api.js', () => {
  const hookCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/hooks/useAudioDubbing.js'), 'utf8');
  const apiCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/services/api.js'), 'utf8');

  assert.ok(hookCode.includes('isCustomClipSpeed'), 'useAudioDubbing must define isCustomClipSpeed');
  assert.ok(hookCode.includes('userCustomSpeed: customFlag'), 'handleUpdateSegmentSpeed must set userCustomSpeed from customFlag');
  assert.ok(!apiCode.includes("options.speed || 'normal'"), 'api.js must not coerce 0/omitted options.speed via || normal');
  assert.ok(!apiCode.includes("params.speed || 'normal'"), 'api.js generateAudioApi must not coerce 0 via || normal');
});

test('Live /api/generate-audio E2E: 1.5x, 0.75x, 1.0x normal fit, segment payload fallback, batch parity, and invalid speed logging', async () => {
  const uniqueSeriesId = `series_test_clipspeed_${Date.now()}`;
  const projectAudioRoot = path.join(uploadsDir, 'projects', uniqueSeriesId);
  const { server, baseUrl } = await createAudioTestApp();

  const text = 'ថ្ងៃនេះមេឃស្រឡះល្អណាស់ សូមអញ្ជើញចូលរួមពិធីជួបជុំជាមួយយើងទាំងអស់គ្នា។';

  try {
    // 1. Probe natural unstretched 1.0x duration first (wide 15s slot so autoStretch does not touch it)
    const naturalRes = await captureConsoleWarningsAndLogs(() =>
      postJson(baseUrl, {
        segment: { id: 101, khmer: text, startSec: 0, endSec: 15.0 },
        voiceId: 'km-KH-PisethNeural',
        speed: 'normal',
        autoStretch: false,
        seriesId: uniqueSeriesId,
        episodeId: 'ep_test',
        forceRegen: true,
      })
    );
    assert.equal(naturalRes.res.status, 200);
    assert.equal(naturalRes.res.data.success, true);
    const naturalSeg = naturalRes.res.data.segment;
    const naturalDur = await getMediaDuration(naturalSeg.audioPath);
    assert.ok(naturalDur > 1.5, `Expected decodable baseline duration > 1.5s, got ${naturalDur}`);
    assert.equal(naturalSeg.ttsRate, '+0%');
    assert.equal(naturalSeg.userCustomSpeed, false);

    // Build a slot ~24% shorter than naturalDur (ratio ~1.24..1.27, inside Dubbing Policy auto-fit window 1.02..1.30)
    const tightSlotEnd = parseFloat((naturalDur / 1.24).toFixed(2));

    // 2. Normal Generate on tight slot -> MUST still slot-fit as before
    const fitRes = await postJson(baseUrl, {
      segment: { id: 102, khmer: text, startSec: 0, endSec: tightSlotEnd },
      voiceId: 'km-KH-PisethNeural',
      speed: 'normal',
      autoStretch: true,
      seriesId: uniqueSeriesId,
      episodeId: 'ep_test',
      forceRegen: true,
    });
    assert.equal(fitRes.status, 200);
    const fitSeg = fitRes.data.segment;
    const fitProbed = await getMediaDuration(fitSeg.audioPath);
    assert.equal(fitSeg.userCustomSpeed, false);
    assert.equal(fitSeg.ttsRate, '+0%');
    assert.ok(fitSeg.appliedSpeed > 1.0, `Normal tight-slot Generate should slot-fit (appliedSpeed=${fitSeg.appliedSpeed})`);
    assert.ok(fitProbed <= tightSlotEnd && fitProbed < naturalDur * 0.90, `Expected slot-fit audio ${fitProbed}s <= slot ${tightSlotEnd}s (natural=${naturalDur}s)`);

    // 3. Set Clip Speed 1.5x from inspector -> log shows +50%, skips slot-fit, probed duration ~2/3 of naturalDur, OVER/duration updated
    const fastRes = await captureConsoleWarningsAndLogs(() =>
      postJson(baseUrl, {
        segment: { id: 102, khmer: text, startSec: 0, endSec: tightSlotEnd, speed: 1.5, userCustomSpeed: true },
        voiceId: 'km-KH-PisethNeural',
        speed: 1.5,
        autoStretch: true,
        seriesId: uniqueSeriesId,
        episodeId: 'ep_test',
        forceRegen: true,
      })
    );
    assert.equal(fastRes.res.status, 200);
    assert.ok(
      fastRes.logs.some((l) => l.includes('[TTS]') && l.includes('+50%')),
      `Expected [TTS] log showing +50%, got: ${JSON.stringify(fastRes.logs)}`
    );
    const fastSeg = fastRes.res.data.segment;
    const fastProbed = await getMediaDuration(fastSeg.audioPath);
    const fastRatio = fastProbed / naturalDur;
    assert.ok(
      fastRatio > 0.55 && fastRatio < 0.78,
      `1.5x audio duration should be ~2/3 (${(naturalDur * 2 / 3).toFixed(2)}s), got ${fastProbed}s (ratio=${fastRatio.toFixed(3)})`
    );
    assert.equal(fastSeg.ttsRate, '+50%');
    assert.equal(fastSeg.userCustomSpeed, true);
    assert.equal(fastSeg.appliedSpeed, 1.5);
    assert.ok(Math.abs(fastSeg.audioDurationSec - fastProbed) < 0.02, 'audioDurationSec must match real probed duration');
    assert.ok(Math.abs(fastSeg.originalAudioDuration - fastProbed) < 0.02, 'originalAudioDuration must match real probed duration');
    assert.ok(Math.abs(fastSeg.rawAudioDur - fastProbed) < 0.02, 'rawAudioDur must match real probed duration');
    assert.equal(fastSeg.audioEndSec, parseFloat((0 + fastProbed).toFixed(2)));

    // 4. Set Clip Speed 0.75x -> ~4/3 of naturalDur, skips slot-fit, OVER updates
    const slowRes = await captureConsoleWarningsAndLogs(() =>
      postJson(baseUrl, {
        segment: { id: 102, khmer: text, startSec: 0, endSec: tightSlotEnd, speed: 0.75, userCustomSpeed: true },
        voiceId: 'km-KH-PisethNeural',
        speed: 0.75,
        autoStretch: true,
        seriesId: uniqueSeriesId,
        episodeId: 'ep_test',
        forceRegen: true,
      })
    );
    assert.equal(slowRes.res.status, 200);
    assert.ok(
      slowRes.logs.some((l) => l.includes('[TTS]') && l.includes('-25%')),
      `Expected [TTS] log showing -25%`
    );
    const slowSeg = slowRes.res.data.segment;
    const slowProbed = await getMediaDuration(slowSeg.audioPath);
    const slowRatio = slowProbed / naturalDur;
    assert.ok(
      slowRatio > 1.20 && slowRatio < 1.50,
      `0.75x audio duration should be ~4/3 (${(naturalDur * 4 / 3).toFixed(2)}s), got ${slowProbed}s (ratio=${slowRatio.toFixed(3)})`
    );
    assert.equal(slowSeg.ttsRate, '-25%');
    assert.equal(slowSeg.userCustomSpeed, true);
    assert.equal(slowSeg.overflowSec, parseFloat((slowProbed - tightSlotEnd).toFixed(3)));

    // 5. Set Clip Speed 1.0x (resets custom speed -> normal) -> rate +0%, slot-fits again
    const resetRes = await postJson(baseUrl, {
      segment: { id: 102, khmer: text, startSec: 0, endSec: tightSlotEnd, speed: 1.0, userCustomSpeed: false },
      voiceId: 'km-KH-PisethNeural',
      speed: 1.0,
      autoStretch: true,
      seriesId: uniqueSeriesId,
      episodeId: 'ep_test',
      forceRegen: true,
    });
    assert.equal(resetRes.status, 200);
    const resetSeg = resetRes.data.segment;
    const resetProbed = await getMediaDuration(resetSeg.audioPath);
    assert.equal(resetSeg.ttsRate, '+0%');
    assert.equal(resetSeg.userCustomSpeed, false);
    assert.ok(resetSeg.appliedSpeed > 1.0, `Resetting to 1.0x should restore normal slot-fit behavior (appliedSpeed=${resetSeg.appliedSpeed})`);
    assert.ok(resetProbed <= tightSlotEnd && resetProbed < naturalDur * 0.90, `Expected reset 1.0x slot-fit duration <= ${tightSlotEnd}s, got ${resetProbed}s`);

    // 5b. Resetting via body.speed=1.0 on a previously 0.75x segment (without explicit body.userCustomSpeed) also returns to normal fit
    const resetFromSlowRes = await postJson(baseUrl, {
      segment: { ...slowSeg, id: 105 },
      voiceId: 'km-KH-PisethNeural',
      speed: 1.0,
      autoStretch: true,
      seriesId: uniqueSeriesId,
      episodeId: 'ep_test',
      forceRegen: true,
    });
    assert.equal(resetFromSlowRes.status, 200);
    assert.equal(resetFromSlowRes.data.segment.userCustomSpeed, false);
    assert.equal(resetFromSlowRes.data.segment.ttsRate, '+0%');
    assert.ok(resetFromSlowRes.data.segment.appliedSpeed > 1.0, 'Resetting 0.75x -> 1.0 via body.speed restores slot-fit');

    // 6. Route fallback when body.speed is absent (pipeline/batch caller sending segment.speed & userCustomSpeed)
    const absentSpeedRes = await postJson(baseUrl, {
      segment: { id: 103, khmer: text, startSec: 0, endSec: tightSlotEnd, speed: 1.5, userCustomSpeed: true },
      voiceId: 'km-KH-PisethNeural',
      seriesId: uniqueSeriesId,
      episodeId: 'ep_test',
      forceRegen: true,
    });
    assert.equal(absentSpeedRes.status, 200);
    assert.equal(absentSpeedRes.data.segment.ttsRate, '+50%');
    assert.equal(absentSpeedRes.data.segment.userCustomSpeed, true);

    // 7. Batch-generate episode containing userCustomSpeed segments (0.75x AND explicit 1.0x userCustomSpeed) and one normal segment -> ONLY userCustomSpeed skips fit!
    const customLongEnd = parseFloat((naturalDur / 1.24).toFixed(2));
    const batchRes = await postJson(baseUrl, {
      segments: [
        { id: 201, khmer: text, startSec: 0, endSec: customLongEnd },
        { id: 202, khmer: text, startSec: customLongEnd + 0.5, endSec: customLongEnd + 0.5 + customLongEnd, speed: 0.75, userCustomSpeed: true },
        { id: 203, khmer: text, startSec: 20, endSec: 20 + customLongEnd, speed: 1.0, userCustomSpeed: true },
      ],
      voiceId: 'km-KH-PisethNeural',
      speed: 'normal',
      autoStretch: true,
      seriesId: uniqueSeriesId,
      episodeId: 'ep_batch_test',
      forceRegen: true,
    });
    assert.equal(batchRes.status, 200);
    assert.equal(batchRes.data.segments.length, 3);
    const bNormal = batchRes.data.segments[0];
    const bCustomSlow = batchRes.data.segments[1];
    const bCustomNorm = batchRes.data.segments[2];

    const bNormalDur = await getMediaDuration(bNormal.audioPath);
    const bCustomSlowDur = await getMediaDuration(bCustomSlow.audioPath);
    const bCustomNormDur = await getMediaDuration(bCustomNorm.audioPath);

    assert.equal(bNormal.ttsRate, '+0%');
    assert.equal(bNormal.userCustomSpeed, false);
    assert.ok(bNormal.appliedSpeed > 1.0 && bNormalDur <= customLongEnd && bNormalDur < naturalDur * 0.90, `Batch normal segment must slot-fit (dur=${bNormalDur}s, slot=${customLongEnd}s, natural=${naturalDur}s)`);

    assert.equal(bCustomSlow.ttsRate, '-25%');
    assert.equal(bCustomSlow.userCustomSpeed, true);
    assert.equal(bCustomSlow.appliedSpeed, 0.75);
    assert.ok(bCustomSlowDur > naturalDur * 1.18, `Batch userCustomSpeed 0.75x segment must skip fit and stay ~4/3 (dur=${bCustomSlowDur}s vs natural=${naturalDur}s)`);

    assert.equal(bCustomNorm.ttsRate, '+0%');
    assert.equal(bCustomNorm.userCustomSpeed, true);
    assert.equal(bCustomNorm.appliedSpeed, 1);
    assert.ok(Math.abs(bCustomNormDur - naturalDur) < 0.15, `Batch userCustomSpeed=true 1.0x segment must also skip fit (dur=${bCustomNormDur}s vs natural=${naturalDur}s)`);

    // 8. Unparseable speed logs clear [TTS] line with requested value (no silent fallback)
    const invalidRes = await captureConsoleWarningsAndLogs(() =>
      postJson(baseUrl, {
        segment: { id: 104, khmer: text, startSec: 0, endSec: 15.0 },
        voiceId: 'km-KH-PisethNeural',
        speed: 'unparseable-99x',
        seriesId: uniqueSeriesId,
        episodeId: 'ep_test',
        forceRegen: true,
      })
    );
    assert.equal(invalidRes.res.status, 200);
    assert.ok(
      invalidRes.logs.some((l) => l.includes('[TTS]') && l.includes('unparseable-99x')),
      `Expected [TTS] log containing "unparseable-99x", got: ${JSON.stringify(invalidRes.logs)}`
    );
    assert.equal(invalidRes.res.data.segment.speedWarning, 'unapplied:unparseable-99x');
  } finally {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(projectAudioRoot, { recursive: true, force: true });
    } catch (_) {}
  }
});
