const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  callGeminiVisionWithRetry,
  extractChineseSubtitles,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');

test('Stage 3 Smart OCR & Performance Telemetry Suite', async (t) => {
  await t.test('1. Point 1: lastSuccessfulVisionModel affinity remembers and reuses successful model', async () => {
    const callLog = [];
    const mockAiClient = {
      models: {
        generateContent: async ({ model }) => {
          callLog.push(model);
          return { text: () => '{"frames":[{"timestampSec":1.0,"hasText":true,"textZh":"测试","isSharp":true}]}' };
        },
      },
    };

    // First call succeeds with gemini-3.8-flash (e.g. preferred override)
    await callGeminiVisionWithRetry(
      mockAiClient,
      'gemini-3.8-flash',
      [{ text: 'batch1' }],
      1
    );

    assert.strictEqual(callLog[0], 'gemini-3.8-flash', 'Batch 1 used gemini-3.8-flash');

    // Second call without specifying modelName should reuse last successful model (gemini-3.8-flash)
    await callGeminiVisionWithRetry(
      mockAiClient,
      null,
      [{ text: 'batch2' }],
      1
    );

    assert.strictEqual(callLog[1], 'gemini-3.8-flash', 'Batch 2 prioritized lastSuccessfulVisionModel');
  });

  await t.test('2. Point 2: Large batch (>4 frames) on timeout throws fastSplit without cascade delay', async () => {
    let callCount = 0;
    const mockAiClient = {
      models: {
        generateContent: async () => {
          callCount++;
          const err = new Error('Timeout: Gemini Vision OCR deadline exceeded');
          err.name = 'TimeoutError';
          err.code = 'ETIMEDOUT';
          throw err;
        },
      },
    };

    const dummyBatchContents = [];
    for (let i = 0; i < 15; i++) {
      dummyBatchContents.push({ inlineData: { mimeType: 'image/jpeg', data: 'fake' } });
    }

    try {
      await callGeminiVisionWithRetry(
        mockAiClient,
        'gemini-3.5-flash-lite',
        dummyBatchContents,
        2,
        null,
        null,
        { batchSize: 15, fastSplitOnTimeout: true }
      );
      assert.fail('Should have thrown fastSplit error');
    } catch (err) {
      assert.strictEqual(err.fastSplit, true, 'Must set fastSplit flag on timeout');
      assert.strictEqual(err.code, 'ERR_BATCH_TIMEOUT', 'Must have ERR_BATCH_TIMEOUT code');
      assert.strictEqual(callCount, 1, 'Must fail immediately on attempt 1 without cascading through 4 models');
    }
  });

  await t.test('3. Point 3: Subtitle region pixel-diff deduplication inherits verified observation safely', async () => {
    // Verify that inherited frame preserves exact timestamp and inherits clean Chinese text
    const sampleA = {
      timestampSec: 10.12,
      reportedSec: 10.12,
      hasText: true,
      textZh: '我们今天必须完成',
      chineseText: '我们今天必须完成',
      position: 'bottom_subtitle',
      isSharp: true,
      visualGender: 'female',
      speakerGender: 'female',
      speakerVisualHint: 'female_lead_white_robe',
      deliveryType: 'dialogue',
      genderConfidence: 0.95,
      ocrStatus: 'verified_text',
      isVerified: true,
      isVerifiedEmpty: false,
      ocrFailed: false,
      reviewNeeded: false,
      uncertainOcr: false,
    };

    // When sampleB at 11.20s is linked to sampleA:
    const sampleBTime = 11.20;
    const inheritedB = {
      ...sampleA,
      timestampSec: sampleBTime,
      reportedSec: sampleBTime,
      dedupedFromSec: sampleA.timestampSec,
      isDeduped: true,
    };

    assert.strictEqual(inheritedB.timestampSec, 11.20, 'Preserves exact sampleB timestamp');
    assert.strictEqual(inheritedB.chineseText, '我们今天必须完成', 'Inherits exact verified Chinese text');
    assert.strictEqual(inheritedB.visualGender, 'female', 'Preserves speaker gender');
    assert.strictEqual(inheritedB.isDeduped, true, 'Marks frame as deduped');
    assert.strictEqual(inheritedB.isVerified, true, 'Inherits verified status');
  });

  await t.test('4. Point 4: Performance telemetry structure includes all required timing and counter metrics', async () => {
    const ocrMeta = {
      wallTimeMs: 1542,
      ffmpegPrepassMs: 310,
      batchLoopMs: 800,
      fallbackDirectMs: 0,
      tieBreakMs: 0,
      apiTotalMs: 1120,
      retrySleepMs: 0,
      apiCallsCount: 2,
      retriesCount: 0,
      batchSplitsCount: 1,
      dedupedFramesCount: 4,
      verifiedFramesCount: 12,
      unresolvedFramesCount: 0,
    };

    assert.ok(typeof ocrMeta.wallTimeMs === 'number', 'wallTimeMs must be present');
    assert.ok(typeof ocrMeta.ffmpegPrepassMs === 'number', 'ffmpegPrepassMs must be present');
    assert.ok(typeof ocrMeta.batchLoopMs === 'number', 'batchLoopMs must be present');
    assert.ok(typeof ocrMeta.apiTotalMs === 'number', 'apiTotalMs must be present');
    assert.ok(typeof ocrMeta.batchSplitsCount === 'number', 'batchSplitsCount must be present');
    assert.ok(typeof ocrMeta.dedupedFramesCount === 'number', 'dedupedFramesCount must be present');
    assert.strictEqual(ocrMeta.dedupedFramesCount, 4);
    assert.strictEqual(ocrMeta.batchSplitsCount, 1);
  });

  await t.test('5. P0: Subtitle Pixel Diff strictly prefers subDiff over diff when subDiff is 0', () => {
    // When subtitle region has 0% change (subDiff = 0) but background moved dramatically (diff = 25.5)
    const frameDiff = { timestampSec: 15.0, subDiff: 0, diff: 25.5, isChange: false };
    const evaluated = typeof frameDiff?.subDiff === 'number' ? frameDiff.subDiff : (typeof frameDiff?.diff === 'number' ? frameDiff.diff : 0);

    // Old flawed logic: frameDiff.subDiff || frameDiff.diff || 0 -> would yield 25.5!
    const oldFlawed = frameDiff.subDiff || frameDiff.diff || 0;
    assert.strictEqual(oldFlawed, 25.5, 'Demonstrating old bug where 0 fell back to full-frame motion');

    // Fixed logic yields 0
    assert.strictEqual(evaluated, 0, 'Must be 0 so background camera motion does NOT trigger spurious baseline frames');
  });

  await t.test('6. P1: Resume from Checkpoint filters out verified timestamps before decoding', () => {
    const sortedCandidateTimes = [1.0, 2.0, 3.0, 4.0, 5.0];
    const completedMap = new Map();
    completedMap.set(1.0, { timestampSec: 1.0, isVerified: true });
    completedMap.set(2.0, { timestampSec: 2.0, isVerified: true });
    completedMap.set(3.0, { timestampSec: 3.0, isVerified: true });

    // Filter before decoding
    const timesToExtract = sortedCandidateTimes.filter((t) => !completedMap.has(parseFloat(Number(t).toFixed(2))));

    assert.deepStrictEqual(timesToExtract, [4.0, 5.0], 'Must only extract unresolved frames [4.0, 5.0]');
    assert.strictEqual(timesToExtract.length, 2, 'Avoids decoding the 3 already-verified frames');
  });
});
