import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapTimelineToSourceTime, mapSourceToTimelineTime } from '../../frontend/src/utils/timelineUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Playback Stall & Boundary Flow Regression Suite (#5 -> Gap / 00:07)', () => {
  it('1. mediaStream.js chunks video at 8MB, large WAV at 4MB, and emits strong HTTP range cache validators', () => {
    const mediaStreamCode = fs.readFileSync(path.join(rootDir, 'backend/middleware/mediaStream.js'), 'utf8');

    assert.ok(
      mediaStreamCode.includes('8 * 1024 * 1024'),
      'Video open-ended range chunk size must be 8MB to cover long 1080p GOPs in a single 206 request'
    );
    assert.ok(
      mediaStreamCode.includes('isLargeWav') && mediaStreamCode.includes('4 * 1024 * 1024'),
      'Large WAV streams (e.g. 100MB+ Demucs no_vocals.wav) must be chunked at 4MB to prevent socket hogging'
    );
    assert.ok(
      mediaStreamCode.includes('"Cache-Control": "no-store"') && mediaStreamCode.includes('isStreamedMedia'),
      'Streamed byte-range media (.mp4/.webm/.mov and >4MB .wav) must send Cache-Control: no-store to prevent Chromium HttpCache single-writer lock stalls'
    );
    assert.ok(
      mediaStreamCode.includes('"ETag"') && mediaStreamCode.includes('"Last-Modified"') && mediaStreamCode.includes('"Cache-Control": "public, max-age=3600"'),
      'Small audio clips must return ETag, Last-Modified, and Cache-Control'
    );
    assert.ok(
      mediaStreamCode.includes('res.on(\'close\'') && mediaStreamCode.includes('fileStream.destroy()'),
      'mediaStream must destroy file streams cleanly when aborted responses close'
    );
  });

  it('2. useVideoPlayback.js eliminates stale-pause backward re-seek, guards stale activeClipIdxRef, and enforces forward-only stall recovery', () => {
    const code = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useVideoPlayback.js'), 'utf8').replace(/\r\n/g, '\n');

    // Frozen timeline invariants must remain intact
    assert.ok(!code.includes('if (isGapClip(c)) continue'), 'Must keep play-through-Gaps invariant');
    assert.ok(!code.includes('nextDialogueClip'), 'Must never skip Gaps to nextDialogueClip');
    assert.ok(code.includes('if (!isPlaying) {\n      return;\n    }'), 'Must preserve paused snap-back guard');
    assert.ok(code.includes('nextSrcStart > srcNow + 0.15'), 'Must preserve forward-only transition invariant');

    // Stall-fix invariants
    assert.ok(code.includes('alreadySeekingToTarget'), 'handlePlayPause must not abort an in-flight seek targeting the same timestamp');
    assert.ok(code.includes('mapSourceToTimelineTime(rawNow, videoClips, activeClipIdxRef.current)'), 'Pause branch must sync exact currentTime so Resume never forces a stale backward seek');
    assert.ok(code.includes('stallRecoveryCountRef') && code.includes('curT + 0.005'), 'Stall watchdog must nudge strictly forward (+5ms) and stay bounded');
    assert.ok(code.includes('}, [videoClips, isPlaying]);'), 'activeClipIdxRef must re-align whenever videoClips changes');
  });

  it('3. Frontend media loaders stay within HTTP/1.1 6-connection origin budget and handle VOICE 3 overlapping/out-of-order segments', () => {
    const previewCode = (
      fs.readFileSync(path.join(rootDir, 'frontend/src/components/player/VideoPlayerPreview.jsx'), 'utf8') +
      '\n' +
      fs.readFileSync(path.join(rootDir, 'frontend/src/components/player/usePlayerAudioSync.js'), 'utf8')
    ).replace(/\r\n/g, '\n');
    const canvasCode = fs.readFileSync(path.join(rootDir, 'frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8').replace(/\r\n/g, '\n');
    const thumbCode = fs.readFileSync(path.join(rootDir, 'frontend/src/utils/thumbnailUtils.js'), 'utf8').replace(/\r\n/g, '\n');

    assert.ok(previewCode.includes('leadingSilenceInflightRef.current.size >= 2'), 'Leading-silence probes must be capped at 2 concurrent fetches');
    assert.ok(previewCode.includes('maxNewPerTick = 3'), 'Segment audio preloading must throttle newly created Audio elements per tick');
    assert.ok(!previewCode.includes('if (s > (now + 5)) break;'), 'Segment audio matcher must not break early on out-of-order userShifted segments');
    assert.ok(previewCode.includes('const merged = [];'), 'speakingIntervals must sort and merge overlapping multi-lane intervals (e.g. VOICE 3 overlapping VOICE 1)');
    assert.ok(previewCode.includes('ref={cleanBgAudioRef}\n                  src={cleanBgAudioUrl}\n                  preload="metadata"'), '100MB Demucs BGM audio must use preload="metadata" instead of preload="auto"');
    assert.ok(canvasCode.includes('const MAX_CONCURRENT = 3;'), 'TimelineTracksCanvas duration probe concurrency must stay <= 3');
    assert.ok(thumbCode.includes("v.preload = 'metadata'") && thumbCode.includes('isMainPlayerBusy'), 'Thumbnail extractor must use preload="metadata" and yield while main video is seeking/buffering');
  });

  it('4. Time mapping across #5 -> Gap boundary (00:05 -> 00:09) advances monotonically with zero freeze', () => {
    const clips = [
      { id: 'c4', name: '#4', isDialogue: true, start: 4.84, end: 6.50, sourceStart: 4.84, sourceEnd: 6.50 },
      { id: 'g4', name: 'Gap', isDialogue: false, start: 6.50, end: 7.71, sourceStart: 6.50, sourceEnd: 7.71 },
      { id: 'c5', name: '#5', isDialogue: true, start: 7.71, end: 8.91, sourceStart: 7.71, sourceEnd: 8.91 },
      { id: 'g5', name: 'Gap', isDialogue: false, start: 8.91, end: 9.40, sourceStart: 8.91, sourceEnd: 9.40 },
      { id: 'c6', name: '#6', isDialogue: true, start: 9.40, end: 10.70, sourceStart: 9.40, sourceEnd: 10.70 },
    ];

    let prev = -1;
    for (let t = 5.0; t <= 10.0; t = parseFloat((t + 0.1).toFixed(2))) {
      const m = mapTimelineToSourceTime(t, clips);
      assert.equal(m.inClip, true, `Expected t=${t}s to map inside a playable clip or Gap`);
      assert.ok(Math.abs(m.sourceTime - t) < 0.01, `Expected 1:1 sourceTime at t=${t}s, got ${m.sourceTime}`);
      const back = mapSourceToTimelineTime(m.sourceTime, clips);
      assert.ok(back > prev, `Mapped timeline time must strictly advance at t=${t}s (prev=${prev}, back=${back})`);
      prev = back;
    }
  });
});
