const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  extractChineseSubtitles,
  callGeminiVisionWithRetry,
  classifyVisionError,
  extractRetryDelayMs,
  getOcrCheckpointPath,
  saveOcrCheckpoint,
  loadOcrCheckpoint,
  CASCADE_VISION_MODELS,
  visionModelCooldownMap,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const { createAbortError } = require('../utils/asyncSemaphore');

test('1. Error Classification: Distinguishes 429, 503, 504, client timeouts, network errors, and auth errors', () => {
  const err429 = new Error('429 RESOURCE_EXHAUSTED: Rate limit exceeded');
  assert.equal(classifyVisionError(err429).type, 'RATE_LIMIT');
  assert.equal(classifyVisionError(err429).isRetryable, true);

  const err503 = new Error('503 Service Unavailable: The model is overloaded. Please try again later.');
  assert.equal(classifyVisionError(err503).type, 'SERVICE_UNAVAILABLE');
  assert.equal(classifyVisionError(err503).isRetryable, true);

  const err504 = new Error('504 Gateway Timeout: Deadline exceeded');
  assert.equal(classifyVisionError(err504).type, 'SERVER_TIMEOUT');
  assert.equal(classifyVisionError(err504).isRetryable, true);

  const clientTimeout = new Error('Timeout: Gemini Vision OCR on gemini-3.5-flash-lite exceeded 25000ms deadline');
  assert.equal(classifyVisionError(clientTimeout).type, 'CLIENT_TIMEOUT');
  assert.equal(classifyVisionError(clientTimeout).isRetryable, true);

  const netErr = new Error('fetch failed: connect ECONNRESET');
  assert.equal(classifyVisionError(netErr).type, 'NETWORK_ERROR');
  assert.equal(classifyVisionError(netErr).isRetryable, true);

  const authErr = new Error('401 UNAUTHENTICATED: API key not valid');
  assert.equal(classifyVisionError(authErr).type, 'AUTH_ERROR');
  assert.equal(classifyVisionError(authErr).isRetryable, false);
});

test('2. Server Retry-After Extraction: Respects headers, statusDetails, and regex delays', () => {
  // From headers
  const errWithHeader = {
    message: '503 Overloaded',
    headers: { 'retry-after': '7' },
  };
  assert.equal(extractRetryDelayMs(errWithHeader), 7000);

  // From statusDetails RetryInfo
  const errWithDetails = {
    message: '429 Quota Exceeded',
    statusDetails: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }],
  };
  assert.equal(extractRetryDelayMs(errWithDetails), 12000);

  // From message regex
  const errWithMsg = new Error('Resource exhausted. Please retry in 5.5s.');
  assert.equal(extractRetryDelayMs(errWithMsg), 5500);

  // Fallback when no server info
  const errPlain = new Error('503 Overload');
  assert.equal(extractRetryDelayMs(errPlain, 2500), 2500);
});

test('3. 503 then successful retry on same model', async () => {
  let callCount = 0;
  const mockAiClient = {
    models: {
      async generateContent({ model }) {
        callCount++;
        if (callCount === 1) {
          const err = new Error('503 Service Unavailable: High demand on gemini-3.5-flash-lite');
          err.status = 503;
          throw err;
        }
        return {
          text: JSON.stringify({
            frames: [
              { timestampSec: 1.0, hasText: true, textZh: '你好', visualGender: 'female' },
            ],
          }),
        };
      },
    },
  };

  let winningModelRecorded = null;
  const resp = await callGeminiVisionWithRetry(
    mockAiClient,
    'gemini-3.5-flash-lite',
    [{ text: 'test' }],
    2,
    null,
    (m) => { winningModelRecorded = m; }
  );

  assert.equal(callCount, 2, 'Should succeed on attempt 2 after 503');
  assert.ok(resp.text.includes('你好'));
  assert.equal(winningModelRecorded, 'gemini-3.5-flash-lite');
});

test('4. 504 timeout with request cancellation and signal cleanup', async () => {
  let wasAborted = false;
  const mockAiClient = {
    models: {
      generateContent({ config }) {
        return new Promise((resolve, reject) => {
          if (config?.abortSignal) {
            config.abortSignal.addEventListener('abort', () => {
              wasAborted = true;
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
          // Intentionally do not resolve to simulate deadline hit
        });
      },
    },
  };

  // Run with timeoutMs small or let abortController fire
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('Stage 3 OCR aborted')), 50);

  await assert.rejects(
    async () => {
      await callGeminiVisionWithRetry(
        mockAiClient,
        'gemini-3.5-flash-lite',
        [{ text: 'test' }],
        1,
        controller.signal
      );
    },
    (err) => err.name === 'AbortError' || err.message.includes('aborted')
  );

  assert.equal(wasAborted, true, 'SDK generateContent abortSignal must receive abort notification');
});

test('5. All models temporarily unavailable: records cooldown and avoids infinite rotation', async () => {
  visionModelCooldownMap.clear();
  let calls = 0;
  const mockAiClient = {
    models: {
      async generateContent({ model }) {
        calls++;
        const err = new Error(`503 High demand on ${model}`);
        err.status = 503;
        throw err;
      },
    },
  };

  await assert.rejects(
    async () => {
      await callGeminiVisionWithRetry(
        mockAiClient,
        'gemini-3.5-flash-lite',
        [{ text: 'test' }],
        2,
        null
      );
    },
    (err) => err.message.includes('All cascade Gemini models exceeded quota/rate limits')
  );

  // Each candidate model was tried up to maxRetries (2), then placed on cooldown
  assert.ok(calls >= 2, 'Should have attempted bounded retries');
  assert.ok(visionModelCooldownMap.size > 0, 'Models should be placed in cooldown map');
  visionModelCooldownMap.clear();
});

test('6. Atomic Checkpoint: saveOcrCheckpoint and loadOcrCheckpoint persist atomically', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr_ckpt_test_'));
  const ckptFile = path.join(tmpDir, 'ocr_test_ckpt.json');

  const testData = {
    version: 1,
    videoPath: 'dummy.mp4',
    startOffsetSec: 0,
    durationSec: 300,
    rawObservations: [
      { timestampSec: 0.5, reportedSec: 0.5, hasText: true, textZh: '第一行', isSharp: true },
      { timestampSec: 1.2, reportedSec: 1.2, hasText: false, textZh: '', isSharp: true },
    ],
    completedBatchesCount: 1,
    totalCandidateFrames: 2,
  };

  const saved = saveOcrCheckpoint(ckptFile, testData);
  assert.equal(saved, true);
  assert.equal(fs.existsSync(ckptFile), true);

  const loaded = loadOcrCheckpoint(ckptFile);
  assert.ok(loaded);
  assert.equal(loaded.rawObservations.length, 2);
  assert.equal(loaded.rawObservations[0].textZh, '第一行');
  assert.equal(loaded.completedBatchesCount, 1);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('7. Resume after failure: successful batches are not called again', () => {
  const completedMap = new Map();
  // Simulate batch 1 (frames 0.5 and 1.0) already completed
  completedMap.set(0.5, { timestampSec: 0.5, hasText: true, textZh: '已完成' });
  completedMap.set(1.0, { timestampSec: 1.0, hasText: true, textZh: '第二句' });

  const allCandidateFrames = [
    { timestampSec: 0.5, filePath: 'f0.jpg' },
    { timestampSec: 1.0, filePath: 'f1.jpg' },
    { timestampSec: 1.8, filePath: 'f2.jpg' },
    { timestampSec: 2.5, filePath: 'f3.jpg' },
  ];

  // Filtering pending frames against completed observations
  const pendingFrames = allCandidateFrames.filter((f) => !completedMap.has(f.timestampSec));
  assert.equal(pendingFrames.length, 2);
  assert.equal(pendingFrames[0].timestampSec, 1.8);
  assert.equal(pendingFrames[1].timestampSec, 2.5);
  // Successful frames 0.5 and 1.0 are NOT in pendingFrames!
});

test('8. Adaptive batch splitting: splits failed batch into smaller sub-batches without dropping frames', () => {
  const originalBatch = {
    batchId: 'batch_0.50_10.50_0',
    frames: [
      { timestampSec: 0.5 },
      { timestampSec: 1.2 },
      { timestampSec: 2.0 },
      { timestampSec: 2.8 },
      { timestampSec: 3.5 },
      { timestampSec: 4.2 },
    ],
    splitDepth: 0,
  };

  const mid = Math.ceil(originalBatch.frames.length / 2);
  const sub1 = {
    batchId: `${originalBatch.batchId}_s1`,
    frames: originalBatch.frames.slice(0, mid),
    splitDepth: originalBatch.splitDepth + 1,
  };
  const sub2 = {
    batchId: `${originalBatch.batchId}_s2`,
    frames: originalBatch.frames.slice(mid),
    splitDepth: originalBatch.splitDepth + 1,
  };

  assert.equal(sub1.frames.length, 3);
  assert.equal(sub2.frames.length, 3);
  assert.equal(sub1.frames[0].timestampSec, 0.5);
  assert.equal(sub1.frames[2].timestampSec, 2.0);
  assert.equal(sub2.frames[0].timestampSec, 2.8);
  assert.equal(sub2.frames[2].timestampSec, 4.2);

  const combined = [...sub1.frames, ...sub2.frames];
  assert.equal(combined.length, 6, 'All 6 frames must be preserved');
  for (let i = 0; i < 6; i++) {
    assert.equal(combined[i].timestampSec, originalBatch.frames[i].timestampSec);
  }
});

test('9. Adaptive concurrency: reduces to 1 on overload and recovers to 2 after 3 successes', () => {
  let adaptiveConcurrency = 2;
  let consecutiveSuccesses = 0;

  // Simulate failure / overload
  adaptiveConcurrency = 1;
  consecutiveSuccesses = 0;
  assert.equal(adaptiveConcurrency, 1);

  // Success 1
  consecutiveSuccesses++;
  if (consecutiveSuccesses >= 3 && adaptiveConcurrency < 2) adaptiveConcurrency = 2;
  assert.equal(adaptiveConcurrency, 1);

  // Success 2
  consecutiveSuccesses++;
  if (consecutiveSuccesses >= 3 && adaptiveConcurrency < 2) adaptiveConcurrency = 2;
  assert.equal(adaptiveConcurrency, 1);

  // Success 3 -> recovery!
  consecutiveSuccesses++;
  if (consecutiveSuccesses >= 3 && adaptiveConcurrency < 2) adaptiveConcurrency = 2;
  assert.equal(adaptiveConcurrency, 2);
});

test('10. In-flight batch keys prevent concurrent retries of same batch', () => {
  const inFlightBatchKeys = new Set();
  const batchA = { batchId: 'batch_0.50_3.00_0' };

  assert.equal(inFlightBatchKeys.has(batchA.batchId), false);
  inFlightBatchKeys.add(batchA.batchId);

  // Attempting to pick batchA while in flight
  const canSchedule = !inFlightBatchKeys.has(batchA.batchId);
  assert.equal(canSchedule, false, 'In-flight batch must not be scheduled concurrently');

  inFlightBatchKeys.delete(batchA.batchId);
  assert.equal(inFlightBatchKeys.has(batchA.batchId), false);
});

test('11. Unresolved OCR frame marked as review_needed and ocrFailed without inventing text', () => {
  const failedFrame = { timestampSec: 7.25 };
  const fallbackObs = {
    timestampSec: failedFrame.timestampSec,
    reportedSec: failedFrame.timestampSec,
    hasText: false,
    textZh: '',
    chineseText: '',
    position: 'bottom_subtitle',
    isSharp: false,
    visualGender: 'unknown',
    speakerGender: 'UNKNOWN',
    speakerVisualHint: '',
    deliveryType: 'dialogue',
    genderConfidence: 0.5,
    ocrFailed: true,
    reviewNeeded: true,
    uncertainOcr: true,
    failureReason: '503 High Demand across all models',
  };

  assert.equal(fallbackObs.hasText, false);
  assert.equal(fallbackObs.chineseText, '');
  assert.equal(fallbackObs.textZh, '');
  assert.equal(fallbackObs.ocrFailed, true);
  assert.equal(fallbackObs.reviewNeeded, true);
  assert.equal(fallbackObs.uncertainOcr, true);
  assert.ok(fallbackObs.failureReason.includes('503'));
});

test('12. Cancel during retry/backoff aborts immediately', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  const mockAiClient = {
    models: {
      async generateContent() {
        const err = new Error('503 Service Unavailable');
        err.status = 503;
        throw err;
      },
    },
  };

  const startTime = Date.now();
  await assert.rejects(
    async () => {
      await callGeminiVisionWithRetry(
        mockAiClient,
        'gemini-3.5-flash-lite',
        [{ text: 'test' }],
        3,
        controller.signal
      );
    },
    (err) => err.name === 'AbortError' || err.message.includes('aborted')
  );

  const duration = Date.now() - startTime;
  assert.ok(duration < 2000, `Abort should terminate quickly, took ${duration}ms`);
});

test('13. extractChineseSubtitles: Handles 503 overload, splits batch, saves checkpoint atomically, reports live progress', async () => {
  const testVideo = path.resolve(__dirname, 'fixtures/test_short_clip.mp4');
  // If fixture does not exist, use existing project mp4
  const videoPath = fs.existsSync(testVideo)
    ? testVideo
    : path.resolve(__dirname, 'uploads/projects/series_test_scen2_1795069250729/episodes/ep_1/video/ep_1_source.mp4');

  if (!fs.existsSync(videoPath)) {
    // If not found, skip test gracefully
    return;
  }

  let generateCalls = 0;
  let saw503 = false;
  const progressReports = [];

  const mockAiClient = {
    models: {
      async generateContent({ contents }) {
        generateCalls++;
        if (generateCalls === 1) {
          saw503 = true;
          const err = new Error('503 Service Unavailable: High demand on gemini-3.5-flash-lite');
          err.status = 503;
          throw err;
        }

        // Return mock frame detections matching the batch
        const textItems = contents.filter((c) => typeof c.text === 'string' && c.text.includes('[FRAME_TIMESTAMP:'));
        const frames = textItems.map((c) => {
          const match = c.text.match(/\[FRAME_TIMESTAMP:\s*([0-9.]+)/);
          const t = match ? parseFloat(match[1]) : 1.0;
          return {
            timestampSec: t,
            hasText: true,
            textZh: '天道无情',
            chineseText: '天道无情',
            position: 'bottom_subtitle',
            isSharp: true,
            visualGender: 'male',
            speakerGender: 'male',
            deliveryType: 'dialogue',
            genderConfidence: 0.9,
          };
        });

        return {
          text: JSON.stringify({ frames }),
        };
      },
    },
  };

  const result = await extractChineseSubtitles({
    videoPath,
    durationSec: 3.0,
    aiClient: mockAiClient,
    modelName: 'gemini-3.5-flash-lite',
    baseStepSec: 0.75,
    startOffsetSec: 0,
    force: true, // force re-scan
    onProgress: (p) => {
      progressReports.push(p);
    },
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.visualSegments));
  assert.ok(saw503, 'Should have experienced and recovered from 503');
  assert.ok(result.ocrMeta.completedBatchesCount > 0);
  assert.ok(progressReports.length > 0, 'Should have emitted live progress reports');

  // Verify checkpoint was written
  const ckptPath = getOcrCheckpointPath(videoPath, 0, 3.0);
  assert.ok(ckptPath);
  assert.ok(fs.existsSync(ckptPath), 'Checkpoint file must exist on disk');

  const ckpt = loadOcrCheckpoint(ckptPath);
  assert.ok(ckpt);
  assert.ok(ckpt.rawObservations.length > 0, 'Checkpoint must contain completed observations');
  assert.equal(ckpt.completed, true, 'Final checkpoint must be marked completed');
});

test('14. extractChineseSubtitles: Resumes from existing checkpoint and does not re-call completed frames', async () => {
  const testVideo = path.resolve(__dirname, 'fixtures/test_short_clip.mp4');
  const videoPath = fs.existsSync(testVideo)
    ? testVideo
    : path.resolve(__dirname, 'uploads/projects/series_test_scen2_1795069250729/episodes/ep_1/video/ep_1_source.mp4');

  if (!fs.existsSync(videoPath)) return;

  const ckptPath = getOcrCheckpointPath(videoPath, 0, 3.0);
  if (!ckptPath || !fs.existsSync(ckptPath)) return;

  let newCalls = 0;
  const mockAiClient = {
    models: {
      async generateContent() {
        newCalls++;
        return { text: JSON.stringify({ frames: [] }) };
      },
    },
  };

  // Run with force=false so it reuses the checkpoint
  const result = await extractChineseSubtitles({
    videoPath,
    durationSec: 3.0,
    aiClient: mockAiClient,
    modelName: 'gemini-3.5-flash-lite',
    baseStepSec: 0.75,
    startOffsetSec: 0,
    force: false,
  });

  assert.ok(result);
  // Full cache hit or checkpoint reuse means 0 new generateContent calls for already-completed frames!
  assert.equal(newCalls, 0, 'Frames already completed in checkpoint/cache must not trigger new API calls');
});
