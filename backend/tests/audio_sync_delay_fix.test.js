const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateSingleSegmentAudio } = require('../services/ttsService');
const { detectSpeechBounds, getMediaDuration } = require('../services/ffmpegService');

test('audioSyncUtils: findLeadingSilenceFromChannels detects Edge TTS silence while preserving aspirated consonant cushion', async () => {
  const { findLeadingSilenceFromChannels } = await import('../../frontend/src/utils/audioSyncUtils.js');

  const sampleRate = 24000;
  // Case 1: 210ms digital silence followed by speech burst
  const len1 = sampleRate * 1;
  const buf1 = new Float32Array(len1);
  const onsetSample1 = Math.round(0.210 * sampleRate);
  for (let i = 0; i < onsetSample1; i++) buf1[i] = 0.0003; // faint padding noise below threshold
  for (let i = onsetSample1; i < len1; i++) buf1[i] = 0.35;
  const skip1 = findLeadingSilenceFromChannels([buf1], sampleRate);
  assert.equal(skip1, 0.185, 'Expected 0.210s - 0.025s cushion = 0.185s skip');

  // Case 2: Already trimmed clip (40ms silence) -> returns 0
  const buf2 = new Float32Array(sampleRate);
  for (let i = Math.round(0.040 * sampleRate); i < buf2.length; i++) buf2[i] = 0.25;
  assert.equal(findLeadingSilenceFromChannels([buf2], sampleRate), 0, 'Clips with <=55ms silence must not be skipped');

  // Case 3: Excessive 500ms silence -> clamped to 0.35s safety cap
  const buf3 = new Float32Array(sampleRate);
  for (let i = Math.round(0.500 * sampleRate); i < buf3.length; i++) buf3[i] = 0.25;
  assert.equal(findLeadingSilenceFromChannels([buf3], sampleRate), 0.35, 'Leading skip must clamp at 0.35s cap');

  // Case 4: Invalid inputs -> 0
  assert.equal(findLeadingSilenceFromChannels([], sampleRate), 0);
  assert.equal(findLeadingSilenceFromChannels([new Float32Array(1000)], 0), 0);
});

test('audioSyncUtils: computeSegmentAudioSyncTarget handles pre-roll, EP2 autoTrimmed offset=0, split slices, and userTrimmed safety', async () => {
  const { computeSegmentAudioSyncTarget } = await import('../../frontend/src/utils/audioSyncUtils.js');

  // 1. Normal clip at 6.92s with 0.190s Edge leading silence -> pre-rolls at -30ms and seeks past 0.190s
  const normalSeg = { id: 3, audioStartSec: 6.92, audioDurationSec: 2.33, audioTrimmed: false };
  const preRollRes = computeSegmentAudioSyncTarget({
    seg: normalSeg,
    now: 6.89, // 30ms before segStart
    audioDuration: 2.33,
    detectedLeadSkipSec: 0.19,
  });
  assert.equal(preRollRes.inRange, true, 'Should pre-roll within 35ms lookahead before segStart');
  assert.equal(preRollRes.baseStartOffset, 0.19);
  assert.equal(preRollRes.expectedOffset, 0.19);

  // 2. EP2 Seg #2 case (auto slot trimmed: audioTrimmed=true, userTrimmed=false, audioOffset=0) -> STILL skips Edge lead silence & adjusts end limit
  const slotTrimmedSeg = { id: 2, audioStartSec: 5.60, audioEndSec: 6.92, audioDurationSec: 1.32, audioTrimmed: true, userTrimmed: false, audioOffset: 0 };
  const slotTrimmedRes = computeSegmentAudioSyncTarget({
    seg: slotTrimmedSeg,
    now: 5.70,
    audioDuration: 1.87,
    detectedLeadSkipSec: 0.191,
  });
  assert.equal(slotTrimmedRes.autoLeadTrim, 0.191);
  assert.equal(slotTrimmedRes.baseStartOffset, 0.191);
  assert.equal(slotTrimmedRes.expectedOffset, 0.291);
  assert.equal(slotTrimmedRes.segAudioEndLimit, 1.511, 'Slice end limit must shift by baseStartOffset + clipLen');

  // 3. Right split slice (audioOffset > 0) -> MUST NOT skip leading silence again!
  const splitRightSeg = { id: '3_split', audioStartSec: 8.10, audioEndSec: 9.25, audioDurationSec: 1.15, audioTrimmed: true, audioOffset: 1.18 };
  const splitRes = computeSegmentAudioSyncTarget({
    seg: splitRightSeg,
    now: 8.10,
    audioDuration: 2.33,
    detectedLeadSkipSec: 0.19,
  });
  assert.equal(splitRes.autoLeadTrim, 0, 'Split right slice with audioOffset > 0 must NOT apply autoLeadTrim');
  assert.equal(splitRes.baseStartOffset, 1.18);

  // 3b. Uneven cold-start split right slice before <audio> metadata loads (audioDuration=null)
  const coldSplitRes = computeSegmentAudioSyncTarget({
    seg: splitRightSeg,
    now: 8.10,
    audioDuration: null,
    detectedLeadSkipSec: 0.19,
  });
  assert.equal(coldSplitRes.baseStartOffset, 1.18, 'Cold-start uneven right slice must preserve audioOffset even when offset >= slice duration');
  assert.equal(coldSplitRes.autoLeadTrim, 0);

  // 4. User-trimmed left edge (userTrimmed=true) -> MUST preserve exact user trim offset
  const userTrimmedSeg = { id: 9, audioStartSec: 10.0, audioEndSec: 11.5, audioDurationSec: 1.5, audioTrimmed: true, userTrimmed: true, audioOffset: 0 };
  const userTrimRes = computeSegmentAudioSyncTarget({
    seg: userTrimmedSeg,
    now: 10.0,
    audioDuration: 2.5,
    detectedLeadSkipSec: 0.20,
  });
  assert.equal(userTrimRes.autoLeadTrim, 0, 'Explicit userTrimmed clip must keep offset untouched');

  // 5. Stale offset guard (>= audioDurationSec) resets to 0 cleanly
  const staleSeg = { id: 10, audioStartSec: 12.0, audioDurationSec: 2.0, audioOffset: 3.5 };
  const staleRes = computeSegmentAudioSyncTarget({
    seg: staleSeg,
    now: 12.0,
    audioDuration: 2.0,
    detectedLeadSkipSec: 0.18,
  });
  assert.equal(staleRes.segAudioOffset, 0);
  assert.equal(staleRes.autoLeadTrim, 0.18);
});

test('Backend TTS generation strips Edge TTS ~200ms leading silence for both normal and custom-speed clips', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts_lead_trim_test_'));
  const text = 'សួស្តីអ្នកទាំងអស់គ្នា ថ្ងៃនេះយើងចាប់ផ្តើមភ្លាមៗ។';

  try {
    const normalSeg = await generateSingleSegmentAudio(
      { id: 701, khmer: text, startSec: 0, endSec: 8.0 },
      tmpDir,
      { voiceId: 'km-KH-PisethNeural', autoStretch: false, forceRegen: true }
    );
    assert.ok(fs.existsSync(normalSeg.audioPath), 'Normal segment MP3 should exist');
    const boundsNormal = await detectSpeechBounds(normalSeg.audioPath, '-45dB', 0.02);
    const durNormal = await getMediaDuration(normalSeg.audioPath);
    assert.ok(
      boundsNormal.leadingSilence < 0.095,
      `Normal TTS leading silence must be trimmed (<95ms incl. codec frame), got ${boundsNormal.leadingSilence}s`
    );
    assert.ok(
      (durNormal - boundsNormal.tailSilence) < 0.18,
      `Trailing dead silence should also be compact, got ${(durNormal - boundsNormal.tailSilence).toFixed(3)}s`
    );

    // Custom 1.5x speed (skips autoStretch) must ALSO have leading silence stripped
    const fastSeg = await generateSingleSegmentAudio(
      { id: 702, khmer: text, startSec: 0, endSec: 2.0, speed: 1.5, userCustomSpeed: true },
      tmpDir,
      { voiceId: 'km-KH-PisethNeural', speed: 1.5, userCustomSpeed: true, autoStretch: true, forceRegen: true }
    );
    const boundsFast = await detectSpeechBounds(fastSeg.audioPath, '-45dB', 0.02);
    assert.equal(fastSeg.ttsRate, '+50%');
    assert.ok(
      boundsFast.leadingSilence < 0.095,
      `Custom-speed TTS leading silence must also be trimmed (<95ms), got ${boundsFast.leadingSilence}s`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('VideoPlayerPreview sync hardening static audit: WebAudio silence trim, 60Hz RAF loop, pool eviction, cold metadata seek, and tight catch-up', () => {
  const previewPath = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx');
  const audioSyncPath = path.resolve(__dirname, '../../frontend/src/components/player/usePlayerAudioSync.js');
  const code = fs.readFileSync(previewPath, 'utf8') + '\n' + fs.readFileSync(audioSyncPath, 'utf8');

  assert.ok(code.includes('computeSegmentAudioSyncTarget'), 'VideoPlayerPreview must use computeSegmentAudioSyncTarget');
  assert.ok(code.includes('findLeadingSilenceFromChannels'), 'VideoPlayerPreview must probe leading silence via findLeadingSilenceFromChannels');
  assert.ok(code.includes('probeUrlLeadingSilence'), 'VideoPlayerPreview must pre-probe cached MP3 URLs');
  assert.ok(code.includes('evictDistantSegmentAudios'), 'VideoPlayerPreview must bound WebMediaPlayer pool size via evictDistantSegmentAudios');
  assert.ok(code.includes("audio.addEventListener('loadedmetadata'"), 'VideoPlayerPreview must handle cold <audio> metadata arrival seek');
  assert.ok(code.includes('nowPerf - lastSyncPerf >= 14'), 'VideoPlayerPreview RAF syncLoop must run at ~60Hz (>=14ms) instead of 20Hz (>=50ms)');
  assert.ok(code.includes('absDrift > 0.120') || code.includes('absDrift > 0.220'), 'VideoPlayerPreview must hard-seek catch-up at <=220ms threshold instead of 500ms');
  assert.ok(!code.includes('absDrift > 0.50'), 'VideoPlayerPreview must not keep the sluggish 500ms hard-seek threshold');
});
