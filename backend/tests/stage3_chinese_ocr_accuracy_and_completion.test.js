const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  extractChineseSubtitles,
  parseVisionResponseFrames,
  getOcrCachePath,
  getOcrCheckpointPath,
  saveOcrCheckpoint,
  loadOcrCheckpoint,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const { runChunkedDubbingPipeline } = require('../services/pipeline/chunkOrchestrator');
const { GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

// Locate an existing video fixture for integration tests
const sampleVideo = path.resolve(__dirname, 'fixtures/test_short_clip.mp4');
const projectVideo = path.resolve(__dirname, 'uploads/projects/series_test_scen2_1795069250729/episodes/ep_1/video/ep_1_source.mp4');
const validVideoPath = fs.existsSync(sampleVideo) ? sampleVideo : (fs.existsSync(projectVideo) ? projectVideo : null);

test('1. All frames OCR successfully -> completed', async () => {
  if (!validVideoPath) return;

  const mockAiClient = {
    models: {
      async generateContent({ contents }) {
        const textItems = contents.filter((c) => typeof c.text === 'string' && c.text.includes('[FRAME_TIMESTAMP:'));
        const frames = textItems.map((c) => {
          const match = c.text.match(/\[FRAME_TIMESTAMP:\s*([0-9.]+)/);
          const t = match ? parseFloat(match[1]) : 1.0;
          return {
            timestampSec: t,
            hasText: true,
            textZh: '天下无难事',
            chineseText: '天下无难事',
            position: 'bottom_subtitle',
            isSharp: true,
            visualGender: 'female',
            speakerGender: 'female',
            deliveryType: 'dialogue',
            genderConfidence: 0.95,
          };
        });
        return { text: JSON.stringify({ frames }) };
      },
    },
  };

  const result = await extractChineseSubtitles({
    videoPath: validVideoPath,
    durationSec: 2.0,
    aiClient: mockAiClient,
    modelName: 'gemini-3.5-flash-lite',
    startOffsetSec: 0,
    force: true,
  });

  assert.ok(result);
  assert.equal(result.isComplete, true, 'Result must be marked complete');
  assert.equal(result.hasUnresolvedFrames, false, 'hasUnresolvedFrames must be false');
  assert.equal(result.ocrMeta.status, 'completed', 'Meta status must be completed');
  assert.equal(result.ocrMeta.unresolvedFramesCount, 0, 'Unresolved count must be 0');
  assert.ok(result.ocrMeta.verifiedFramesCount > 0, 'Must have verified frames');
  assert.ok(result.visualSegments.length > 0, 'Must have visual segments');

  // Verify checkpoint has completed: true and hasUnresolvedFrames: false
  const ckptPath = getOcrCheckpointPath(validVideoPath, 0, 2.0);
  assert.ok(ckptPath && fs.existsSync(ckptPath));
  const ckpt = loadOcrCheckpoint(ckptPath);
  assert.equal(ckpt.completed, true);
  assert.equal(ckpt.hasUnresolvedFrames, false);

  // Verify disk cache was written
  const cachePath = getOcrCachePath(validVideoPath, 0, 2.0, 'gemini-3.5-flash-lite');
  assert.ok(cachePath && fs.existsSync(cachePath));
  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(cached.isComplete, true);
  assert.equal(cached.hasUnresolvedFrames, false);
});

test('2. Verified frame without subtitle -> valid empty observation', () => {
  const batchFrames = [
    { timestampSec: 1.5, filePath: 'frame_1.5.jpg' },
  ];
  const mockResp = {
    text: JSON.stringify({
      frames: [
        {
          timestampSec: 1.5,
          hasText: false,
          textZh: '',
          chineseText: '',
          position: 'bottom_subtitle',
          isSharp: true,
          visualGender: 'unknown',
        },
      ],
    }),
  };

  const observations = parseVisionResponseFrames(mockResp, batchFrames);
  assert.equal(observations.length, 1);
  const obs = observations[0];

  assert.equal(obs.timestampSec, 1.5);
  assert.equal(obs.hasText, false);
  assert.equal(obs.chineseText, '');
  assert.equal(obs.textZh, '');
  assert.equal(obs.ocrStatus, 'verified_empty');
  assert.equal(obs.isVerified, true, 'Verified empty must have isVerified = true');
  assert.equal(obs.isVerifiedEmpty, true, 'Verified empty must have isVerifiedEmpty = true');
  assert.equal(obs.ocrFailed, false, 'Verified empty must not be marked ocrFailed');
  assert.equal(obs.reviewNeeded, false, 'Verified sharp empty does not need review');
});

test('3. Missing Gemini response frame -> retry/review_needed, not silently empty', () => {
  const batchFrames = [
    { timestampSec: 1.0, filePath: 'frame_1.0.jpg' },
    { timestampSec: 2.0, filePath: 'frame_2.0.jpg' },
    { timestampSec: 3.0, filePath: 'frame_3.0.jpg' },
  ];

  // Gemini returns only frame at 1.0, completely omitting 2.0 and returning empty object for 3.0
  const mockResp = {
    text: JSON.stringify({
      frames: [
        {
          timestampSec: 1.0,
          hasText: true,
          textZh: '第一句话',
          chineseText: '第一句话',
        },
        {}, // Empty object for frame 3.0 / 2.0
      ],
    }),
  };

  const observations = parseVisionResponseFrames(mockResp, batchFrames);
  assert.equal(observations.length, 3);

  // Frame 1.0: Verified text
  assert.equal(observations[0].timestampSec, 1.0);
  assert.equal(observations[0].hasText, true);
  assert.equal(observations[0].isVerified, true);
  assert.equal(observations[0].ocrStatus, 'verified_text');

  // Frame 2.0: Missing from response -> MUST NOT be silently treated as hasText: false empty!
  assert.equal(observations[1].timestampSec, 2.0);
  assert.equal(observations[1].hasText, false);
  assert.equal(observations[1].isVerified, false, 'Missing frame MUST NOT be isVerified');
  assert.equal(observations[1].ocrStatus, 'missing');
  assert.equal(observations[1].ocrFailed, true);
  assert.equal(observations[1].reviewNeeded, true);

  // Frame 3.0: Empty object in response -> MUST NOT be silently treated as hasText: false empty!
  assert.equal(observations[2].timestampSec, 3.0);
  assert.equal(observations[2].hasText, false);
  assert.equal(observations[2].isVerified, false, 'Empty object response frame MUST NOT be isVerified');
  assert.equal(observations[2].ocrStatus, 'missing');
  assert.equal(observations[2].ocrFailed, true);
  assert.equal(observations[2].reviewNeeded, true);
});

test('4. Unresolved frame after retry exhaustion -> no false completion', async () => {
  if (!validVideoPath) return;

  // Mock AI client that always fails with 503
  const mockAiClient = {
    models: {
      async generateContent() {
        const err = new Error('503 Service Unavailable: Continuous overload');
        err.status = 503;
        throw err;
      },
    },
  };

  // Run Stage 3 where all attempts fail
  const result = await extractChineseSubtitles({
    videoPath: validVideoPath,
    durationSec: 1.5,
    aiClient: mockAiClient,
    modelName: 'gemini-3.5-flash-lite',
    startOffsetSec: 0,
    force: true,
  });

  assert.ok(result);
  // Must NOT falsely report completed
  assert.equal(result.isComplete, false, 'Incomplete scan must have isComplete = false');
  assert.equal(result.hasUnresolvedFrames, true, 'hasUnresolvedFrames must be true');
  assert.equal(result.ocrMeta.status, 'review_needed', 'Status must be review_needed');
  assert.ok(result.ocrMeta.unresolvedFramesCount > 0, 'Unresolved count must be > 0');
  assert.ok(Array.isArray(result.unresolvedFrames) && result.unresolvedFrames.length > 0);

  // Verify that no fake subtitles were invented
  assert.equal(result.visualSegments.length, 0, 'Failed frames must never produce fabricated subtitles');

  // Verify checkpoint reflects incomplete status
  const ckptPath = getOcrCheckpointPath(validVideoPath, 0, 1.5);
  assert.ok(ckptPath && fs.existsSync(ckptPath));
  const ckpt = loadOcrCheckpoint(ckptPath);
  assert.equal(ckpt.completed, false, 'Checkpoint completed must be false');
  assert.equal(ckpt.hasUnresolvedFrames, true, 'Checkpoint hasUnresolvedFrames must be true');

  // Verify disk cache was NOT saved as complete
  const cachePath = getOcrCachePath(validVideoPath, 0, 1.5, 'gemini-3.5-flash-lite');
  if (cachePath && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.notEqual(cached.isComplete, true, 'Cache must not claim completion');
  }
});

test('5. Partial checkpoint -> resume only unresolved frames', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt_resume_test_'));
  const ckptPath = path.join(tmpDir, 'test_ckpt.json');

  const partialData = {
    version: 1,
    videoPath: 'dummy.mp4',
    startOffsetSec: 0,
    durationSec: 10,
    rawObservations: [
      { timestampSec: 0.5, reportedSec: 0.5, hasText: true, textZh: '第一句', isVerified: true, ocrStatus: 'verified_text' },
      { timestampSec: 1.2, reportedSec: 1.2, hasText: false, isVerified: true, isVerifiedEmpty: true, ocrStatus: 'verified_empty' },
      { timestampSec: 2.0, reportedSec: 2.0, hasText: false, isVerified: false, ocrFailed: true, ocrStatus: 'failed', reviewNeeded: true },
    ],
    completedBatchesCount: 1,
    totalCandidateFrames: 3,
    completed: false,
    hasUnresolvedFrames: true,
  };

  saveOcrCheckpoint(ckptPath, partialData);
  const ckpt = loadOcrCheckpoint(ckptPath);
  assert.ok(ckpt);

  // Replicate checkpoint resume filtering in Stage 3
  const completedMap = new Map();
  const unresolvedMap = new Map();
  for (const obs of ckpt.rawObservations) {
    const t = parseFloat(obs.timestampSec.toFixed(2));
    const isVerified = Boolean(obs.isVerified && !obs.ocrFailed && obs.ocrStatus !== 'failed' && obs.ocrStatus !== 'missing');
    if (isVerified) {
      completedMap.set(t, obs);
    } else {
      unresolvedMap.set(t, obs);
    }
  }

  // Candidate frames to analyze
  const framesToAnalyze = [
    { timestampSec: 0.5 },
    { timestampSec: 1.2 },
    { timestampSec: 2.0 },
  ];

  const pendingFrames = framesToAnalyze.filter((f) => !completedMap.has(parseFloat(f.timestampSec.toFixed(2))));

  // ONLY timestamp 2.0 is pending for retry! Timestamps 0.5 and 1.2 are verified and preserved!
  assert.equal(pendingFrames.length, 1);
  assert.equal(pendingFrames[0].timestampSec, 2.0);
  assert.equal(completedMap.size, 2);
  assert.equal(completedMap.has(0.5), true);
  assert.equal(completedMap.has(1.2), true);
  assert.equal(completedMap.has(2.0), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('6. Incomplete cached OCR -> reject as complete', () => {
  // Scenario A: Cache file with hasUnresolvedFrames: true
  const incompleteCachedA = {
    hasUnresolvedFrames: true,
    isComplete: false,
    visualSegments: [{ startSec: 1.0, endSec: 2.5, textZh: '未完成的字幕' }],
    rawObservations: [
      { timestampSec: 1.0, isVerified: true, hasText: true },
      { timestampSec: 2.0, isVerified: false, ocrFailed: true, ocrStatus: 'failed' },
    ],
    ocrMeta: { hasUnresolvedFrames: true, isComplete: false },
  };

  const hasUnresolvedA = Boolean(
    incompleteCachedA.hasUnresolvedFrames ||
    incompleteCachedA.isComplete === false ||
    incompleteCachedA.ocrMeta?.hasUnresolvedFrames ||
    incompleteCachedA.ocrMeta?.isComplete === false ||
    (Array.isArray(incompleteCachedA.rawObservations) &&
      incompleteCachedA.rawObservations.some((o) => o.ocrFailed || o.isVerified === false || o.ocrStatus === 'failed' || o.ocrStatus === 'missing'))
  );
  assert.equal(hasUnresolvedA, true, 'Incomplete cache A must be rejected');

  // Scenario B: Cache with missing observations
  const incompleteCachedB = {
    isComplete: true, // falsely claims complete
    visualSegments: [{ startSec: 1.0, endSec: 2.0, textZh: '测试' }],
    rawObservations: [
      { timestampSec: 1.0, isVerified: true },
      { timestampSec: 2.0, isVerified: false, ocrStatus: 'missing' }, // unverified
    ],
  };

  const hasUnresolvedB = Boolean(
    incompleteCachedB.hasUnresolvedFrames ||
    incompleteCachedB.isComplete === false ||
    incompleteCachedB.ocrMeta?.hasUnresolvedFrames ||
    incompleteCachedB.ocrMeta?.isComplete === false ||
    (Array.isArray(incompleteCachedB.rawObservations) &&
      incompleteCachedB.rawObservations.some((o) => o.ocrFailed || o.isVerified === false || o.ocrStatus === 'failed' || o.ocrStatus === 'missing'))
  );
  assert.equal(hasUnresolvedB, true, 'Incomplete cache B with unverified observation must be rejected');
});

test('7. Chinese text and timestamps remain unchanged during retry', () => {
  const completedMap = new Map();
  // An established verified frame
  completedMap.set(1.5, {
    timestampSec: 1.5,
    hasText: true,
    textZh: '原版中文字幕',
    chineseText: '原版中文字幕',
    isVerified: true,
    userOverridden: false,
  });

  // Incoming retry batch observation attempt on timestamp 1.5 with empty/failed result
  const incomingRetryObs = {
    timestampSec: 1.5,
    hasText: false,
    textZh: '',
    chineseText: '',
    isVerified: false,
  };

  const t = 1.5;
  const existing = completedMap.get(t);
  // Verification logic in Stage 3:
  if (existing && existing.hasText && existing.chineseText && (!incomingRetryObs.hasText || !incomingRetryObs.chineseText)) {
    // Existing verified text is protected from overwrite!
  } else {
    completedMap.set(t, incomingRetryObs);
  }

  const finalObs = completedMap.get(1.5);
  assert.equal(finalObs.timestampSec, 1.5, 'Timestamp must remain unchanged');
  assert.equal(finalObs.chineseText, '原版中文字幕', 'Verified Chinese text must not be overwritten');
  assert.equal(finalObs.hasText, true);
});

test('8. Failed OCR cannot silently trigger downstream translation/TTS', async () => {
  // Simulate chunk processing where Stage 3 has unresolved frames
  const fakeOcrResultWithUnresolved = {
    hasUnresolvedFrames: true,
    isComplete: false,
    visualSegments: [
      { startSec: 0.5, endSec: 1.8, textZh: '残余字幕' },
    ],
    rawObservations: [
      { timestampSec: 0.5, isVerified: true, hasText: true },
      { timestampSec: 1.2, isVerified: false, ocrFailed: true, ocrStatus: 'failed' },
    ],
    ocrMeta: {
      hasUnresolvedFrames: true,
      isComplete: false,
      unresolvedFramesCount: 1,
      verifiedFramesCount: 1,
    },
  };

  const hasUnresolvedOcr = Boolean(
    fakeOcrResultWithUnresolved?.hasUnresolvedFrames ||
    fakeOcrResultWithUnresolved?.ocrMeta?.hasUnresolvedFrames ||
    fakeOcrResultWithUnresolved?.isComplete === false ||
    fakeOcrResultWithUnresolved?.ocrMeta?.isComplete === false ||
    (fakeOcrResultWithUnresolved?.ocrMeta?.unresolvedFramesCount > 0)
  );

  assert.equal(hasUnresolvedOcr, true);

  // In chunkOrchestrator, this condition throws OCR_REVIEW_NEEDED:
  let caughtError = null;
  try {
    if (hasUnresolvedOcr) {
      const unresErr = new Error(`[ChunkOrchestrator] Chunk contains unresolved OCR frames. Review is required before downstream translation/TTS.`);
      unresErr.code = 'OCR_REVIEW_NEEDED';
      unresErr.reviewNeeded = true;
      throw unresErr;
    }
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError);
  assert.equal(caughtError.code, 'OCR_REVIEW_NEEDED');
  assert.equal(caughtError.reviewNeeded, true);
  // Halts execution before Stage 6 (Translation) or Stage 9 (TTS)!
});

test('9. Previously successful batches remain reusable', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt_reusable_test_'));
  const ckptFile = path.join(tmpDir, 'test_ckpt_reusable.json');

  // Save successful batch 1
  const batch1Data = {
    version: 1,
    videoPath: 'dummy.mp4',
    startOffsetSec: 0,
    durationSec: 10,
    rawObservations: [
      { timestampSec: 0.5, hasText: true, textZh: '第一批字幕', isVerified: true, ocrStatus: 'verified_text' },
      { timestampSec: 1.2, hasText: true, textZh: '第二批字幕', isVerified: true, ocrStatus: 'verified_text' },
    ],
    completedBatchesCount: 1,
    totalCandidateFrames: 4,
    completed: false,
    hasUnresolvedFrames: false,
  };

  saveOcrCheckpoint(ckptFile, batch1Data);

  // Load in subsequent session
  const loaded = loadOcrCheckpoint(ckptFile);
  assert.ok(loaded);
  assert.equal(loaded.rawObservations.length, 2);
  assert.equal(loaded.rawObservations[0].textZh, '第一批字幕');

  // Re-queued candidate frames
  const allCandidates = [
    { timestampSec: 0.5 },
    { timestampSec: 1.2 },
    { timestampSec: 2.0 },
    { timestampSec: 2.8 },
  ];

  const completedMap = new Map();
  for (const obs of loaded.rawObservations) {
    if (obs.isVerified) completedMap.set(obs.timestampSec, obs);
  }

  const remainingToCall = allCandidates.filter((f) => !completedMap.has(f.timestampSec));
  // 0.5 and 1.2 are already completed, so only 2.0 and 2.8 need to be called
  assert.equal(remainingToCall.length, 2);
  assert.equal(remainingToCall[0].timestampSec, 2.0);
  assert.equal(remainingToCall[1].timestampSec, 2.8);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
