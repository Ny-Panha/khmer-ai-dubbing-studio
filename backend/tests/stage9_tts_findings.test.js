const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const {
  generateSegmentFingerprint,
  verifySegmentAudioIntegrity,
  recordSegmentCompletion,
  loadSegmentLedger,
} = require('../services/pipeline/segmentLedger');

function getTtsAudioCacheKey(text, voiceId, durationSec) {
  return crypto.createHash('md5')
    .update(`${text.trim()}_${voiceId}_${(durationSec || 0).toFixed(1)}`)
    .digest('hex');
}

test('Test 1: Duration mismatch reproduction and ledger reuse consistency', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts_test_ledger_'));
  const dummyAudio = path.join(tmpDir, 'test_seg1.mp3');
  fs.writeFileSync(dummyAudio, Buffer.alloc(500, 1)); // 500 bytes valid size

  const segDuration = 3.0;
  const segSlotDuration = 2.2;
  const effectiveTargetDuration = Math.min(segDuration, segSlotDuration); // 2.2
  const text = 'សួស្តីពិភពលោក';
  const voiceId = 'km-KH-PisethNeural';
  const jobId = 'job_test_1';
  const seriesId = 'series_test';
  const episodeId = 'ep_1';

  // 1. Initial completion records effectiveTargetDuration (2.2)
  const record = recordSegmentCompletion({
    jobId,
    seriesId,
    episodeId,
    segmentId: 'seg_1',
    segmentIndex: 0,
    text,
    voiceId,
    targetDurationSec: effectiveTargetDuration,
    audioPath: dummyAudio,
    fileSize: 500,
    durationSec: 2.15,
    baseUploadsDir: tmpDir,
  });

  assert.strictEqual(record.targetDurationSec, 2.2);

  // 2. Previous buggy verification passed seg.duration (3.0) -> resulted in FINGERPRINT_MISMATCH
  const buggyCheck = await verifySegmentAudioIntegrity({
    record,
    expectedText: text,
    expectedVoiceId: voiceId,
    expectedTargetDurationSec: segDuration, // 3.0
    jobId,
    seriesId,
    episodeId,
    baseUploadsDir: tmpDir,
  });
  assert.strictEqual(buggyCheck.valid, false, 'Buggy check with 3.0 must fail with fingerprint mismatch');
  assert.strictEqual(buggyCheck.reason, 'FINGERPRINT_MISMATCH');

  // 3. Fixed verification passes effectiveTargetDuration (2.2) -> succeeds
  const fixedCheck = await verifySegmentAudioIntegrity({
    record,
    expectedText: text,
    expectedVoiceId: voiceId,
    expectedTargetDurationSec: effectiveTargetDuration, // 2.2
    jobId,
    seriesId,
    episodeId,
    baseUploadsDir: tmpDir,
    durationValidatorFn: async () => 2.15,
  });
  assert.strictEqual(fixedCheck.valid, true, 'Fixed check with 2.2 must pass');
  assert.strictEqual(fixedCheck.durationSec, 2.15);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Test 2: Cache key consistency across different effective target durations', () => {
  const text = 'រឿងនិទានខ្មែរ';
  const voiceId = 'km-KH-SreymomNeural';

  const keyForEffective2_2 = getTtsAudioCacheKey(text, voiceId, 2.2);
  const keyForRaw3_0 = getTtsAudioCacheKey(text, voiceId, 3.0);
  const keyForSlot2_2 = getTtsAudioCacheKey(text, voiceId, 2.2);

  assert.strictEqual(keyForEffective2_2, keyForSlot2_2, 'Same effective target duration must share cache key');
  assert.notStrictEqual(
    keyForEffective2_2,
    keyForRaw3_0,
    'Different effective durations (2.2 vs 3.0) must have different cache keys'
  );
});

test('Test 3: Audio integrity with durationValidatorFn rejects invalid audio and allows valid', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts_integrity_'));
  const testAudio = path.join(tmpDir, 'audio_integrity.mp3');
  fs.writeFileSync(testAudio, Buffer.alloc(600, 2));

  const text = 'តេស្តសំឡេង';
  const voiceId = 'km-KH-PisethNeural';
  const targetDurationSec = 2.5;

  const record = {
    segmentId: 'seg_1',
    jobId: 'job_integrity',
    seriesId: 'series_1',
    episodeId: 'ep_1',
    fingerprint: generateSegmentFingerprint({ text, voiceId, targetDurationSec }),
    text,
    voiceId,
    targetDurationSec,
    audioPath: testAudio,
    fileSize: 600,
    durationSec: 2.5,
  };

  // Case 3a: Valid positive duration (> 0.1) -> Allows reuse
  const validRes = await verifySegmentAudioIntegrity({
    record,
    expectedText: text,
    expectedVoiceId: voiceId,
    expectedTargetDurationSec: targetDurationSec,
    durationValidatorFn: async () => 2.45,
  });
  assert.strictEqual(validRes.valid, true);
  assert.strictEqual(validRes.durationSec, 2.45);

  // Case 3b: Duration 0 -> Rejects reuse
  const zeroRes = await verifySegmentAudioIntegrity({
    record,
    expectedText: text,
    expectedVoiceId: voiceId,
    expectedTargetDurationSec: targetDurationSec,
    durationValidatorFn: async () => 0,
  });
  assert.strictEqual(zeroRes.valid, false);
  assert.strictEqual(zeroRes.reason, 'AUDIO_INDECODABLE_OR_ZERO_DURATION');

  // Case 3c: Duration < 0.1 (e.g., 0.05s) -> Rejects reuse
  const microRes = await verifySegmentAudioIntegrity({
    record,
    expectedText: text,
    expectedVoiceId: voiceId,
    expectedTargetDurationSec: targetDurationSec,
    durationValidatorFn: async () => 0.05,
  });
  assert.strictEqual(microRes.valid, false);
  assert.strictEqual(microRes.reason, 'AUDIO_INDECODABLE_OR_ZERO_DURATION');

  // Case 3d: NaN or non-finite duration -> Rejects reuse
  const nanRes = await verifySegmentAudioIntegrity({
    record,
    expectedText: text,
    expectedVoiceId: voiceId,
    expectedTargetDurationSec: targetDurationSec,
    durationValidatorFn: async () => NaN,
  });
  assert.strictEqual(nanRes.valid, false);

  // Case 3e: Validator throws error (e.g., FFprobe crash) -> Rejects reuse
  const throwRes = await verifySegmentAudioIntegrity({
    record,
    expectedText: text,
    expectedVoiceId: voiceId,
    expectedTargetDurationSec: targetDurationSec,
    durationValidatorFn: async () => {
      throw new Error('FFprobe failed to decode corrupted stream');
    },
  });
  assert.strictEqual(throwRes.valid, false);
  assert.strictEqual(throwRes.reason, 'DECODE_ERROR');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Test 4: Static audit of stage9_generateSegmentTTS.js for duration semantics', () => {
  const stage9File = path.resolve(__dirname, '../services/pipeline/stages/stage9_generateSegmentTTS.js');
  const content = fs.readFileSync(stage9File, 'utf8');

  // Check that getMediaDuration is imported from ffmpegService
  assert.ok(
    content.includes("const { getMediaDuration } = require('../../ffmpegService');"),
    'Must import getMediaDuration from ffmpegService'
  );

  // Check that durationValidatorFn: getMediaDuration is passed to verifySegmentAudioIntegrity
  assert.ok(
    content.includes('durationValidatorFn: getMediaDuration'),
    'Must pass durationValidatorFn: getMediaDuration in verifySegmentAudioIntegrity'
  );

  // Check that effectiveTargetDuration is calculated with finite check
  assert.ok(
    content.includes('Number.isFinite(seg.duration) && seg.duration > 0'),
    'Must validate seg.duration with Number.isFinite'
  );

  // Check that effectiveTargetDuration is used in ledger verification
  assert.ok(
    content.includes('expectedTargetDurationSec: effectiveTargetDuration'),
    'Must pass effectiveTargetDuration in expectedTargetDurationSec'
  );

  // Check that audioSignature or getTtsAudioCacheKey is used for cache key
  assert.ok(
    content.includes('const cacheKey = audioSignature;') ||
    content.includes('getTtsAudioCacheKey(khmerText, chosenVoiceId, effectiveTargetDuration)'),
    'Must use audioSignature or effectiveTargetDuration in getTtsAudioCacheKey'
  );

  // Ensure NO occurrence of targetDurationSec: seg.duration exists
  assert.ok(
    !content.includes('targetDurationSec: seg.duration'),
    'No ledger write should use targetDurationSec: seg.duration directly'
  );
});

test('Test 5: autoShortenOverflowingSegments preserves valid fallback MP3 when rewritten text is not shorter', async () => {
  const { autoShortenOverflowingSegments } = require('../services/pipeline/stages/stage9_generateSegmentTTS');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage9_shorten_preserve_'));
  const origAudioPath = path.join(tmpDir, 'ep_20_seg_31_orig.mp3');
  const rejectedAudioPath = path.join(tmpDir, 'ep_20_seg_31_retry.mp3');
  fs.writeFileSync(origAudioPath, Buffer.alloc(1024, 1));

  const mockAiClient = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          segments: [{ index: 1, segmentId: 31, khmerText: 'ក្បែរទីលាន' }],
        }),
      }),
    },
  };

  let receivedOpts = null;
  let receivedSeg = null;
  const res = await autoShortenOverflowingSegments({
    segments: [
      {
        id: 31,
        segmentId: 31,
        startSec: 65.4,
        endSec: 65.8,
        availableSlotDuration: 0.4,
        khmerText: 'ក្បែរទីលាន!',
        voiceId: 'km-KH-PisethNeural',
        audioDurationSec: 0.611,
        finalAudioDuration: 0.611,
        overflowSec: 0.211,
        audioPath: origAudioPath,
        ttsStatus: 'ready',
      },
    ],
    audioDir: tmpDir,
    aiClient: mockAiClient,
    generateSingleFn: async (seg, _dir, opts) => {
      receivedSeg = seg;
      receivedOpts = opts;
      fs.writeFileSync(rejectedAudioPath, Buffer.alloc(1024, 2));
      return {
        ...seg,
        audioPath: rejectedAudioPath,
        finalAudioDuration: 0.62, // Not shorter than 0.611 -> rejected
        audioDurationSec: 0.62,
      };
    },
  });

  assert.strictEqual(res.shortenedCount, 0);
  assert.strictEqual(receivedOpts?.preservePriorAudioOnDisk, true, 'Must preserve prior valid MP3 during speculative re-TTS');
  assert.strictEqual(receivedSeg?.audioPath, null, 'Must strip prior audioPath on speculative draft segment');
  assert.strictEqual(fs.existsSync(origAudioPath), true, 'Original valid MP3 on disk must remain intact');
  assert.strictEqual(res.segments[0].audioPath, origAudioPath, 'Segment must retain original valid audioPath');
  assert.strictEqual(fs.existsSync(rejectedAudioPath), false, 'Rejected speculative MP3 should be cleaned up');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

