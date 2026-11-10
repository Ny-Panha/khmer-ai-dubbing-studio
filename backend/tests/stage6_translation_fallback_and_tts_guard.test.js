const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');
const express = require('express');

const {
  generateModeSpecificScript,
  createCanonicalSegment,
  applyTranslatedSegmentResult,
  isPlaceholderTranslationText,
  STAGE6_CASCADE_MODELS,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('../services/pipeline/stages/stage7_translateAndValidateKhmer');
const { generateSegmentTTS } = require('../services/pipeline/stages/stage9_generateSegmentTTS');
const {
  isPlaceholderOrEmptyTtsText,
  generateSingleSegmentAudio,
  generateBatchSegmentsAudio,
} = require('../services/ttsService');
const audioRoutes = require('../routes/audioRoutes');
const { GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

function buildMockChineseSegments(count, offset = 0) {
  return Array.from({ length: count }, (_, idx) => {
    const n = offset + idx + 1;
    const startSec = parseFloat((idx * 3.0 + 0.5).toFixed(2));
    const endSec = parseFloat((startSec + 2.2).toFixed(2));
    return {
      id: n,
      segmentId: n,
      startSec,
      endSec,
      duration: 2.2,
      originalChineseText: `第${n}句台词内容`,
      speaker: 'តួអង្គ',
      speakerSource: 'ocr_only',
      voiceGender: 'male',
    };
  });
}

test('Stage 6 Cascade: Rescues across full 10-model cascade (down to gemini-flash-latest) on 429/404/503/504', async () => {
  const attemptedModels = [];
  const mockAiClient = {
    models: {
      generateContent: async ({ model }) => {
        attemptedModels.push(model);
        if (
          model === 'gemini-3.5-flash-lite' ||
          model === 'gemini-flash-lite-latest' ||
          model === 'gemini-3.6-flash' ||
          model === 'gemini-2.5-flash'
        ) {
          const err = new Error('RESOURCE_EXHAUSTED: 429 Quota exceeded');
          err.status = 429;
          throw err;
        }
        if (model === 'gemini-3.1-flash-lite') {
          const err = new Error('404 NOT_FOUND: deprecated model');
          err.status = 404;
          throw err;
        }
        if (model === 'gemini-3.5-flash') {
          const err = new Error('504 DEADLINE_EXCEEDED');
          err.status = 504;
          throw err;
        }
        if (
          model === 'gemini-3.7-flash' ||
          model === 'gemini-3.8-flash' ||
          model === 'gemini-3-flash-preview'
        ) {
          const err = new Error('503 Service Unavailable');
          err.status = 503;
          throw err;
        }
        return {
          text: JSON.stringify({
            summary: 'តេស្ត Cascade',
            detectedGenre: 'ancient',
            segments: [
              { index: 1, speaker: 'តួឯកប្រុស', gender: 'male', khmerText: 'សួស្តីសិស្សប្អូន!' },
            ],
          }),
        };
      },
    },
  };

  const result = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.FAST_OCR,
    reconciledSegments: buildMockChineseSegments(1),
    durationSec: 10,
    aiClient: mockAiClient,
    modelName: 'gemini-3.5-flash-lite',
    retryDelayMs: 0,
  });

  assert.equal(STAGE6_CASCADE_MODELS.length, 10, 'Stage 6 cascade must expose all 10 dubbing models');
  assert.deepEqual(attemptedModels, STAGE6_CASCADE_MODELS, 'Must traverse all 10 cascade models cleanly');
  assert.equal(result.scriptSegments.length, 1);
  assert.equal(result.scriptSegments[0].khmerTranslatedText, 'សួស្តីសិស្សប្អូន!');
  assert.equal(result.scriptSegments[0].translationStatus, 'translated');
});

test('Stage 6 Auth Fail-Fast: 401/403 throws INVALID_API_KEY immediately without cascading or writing placeholder text', async () => {
  const attemptedModels = [];
  const mockAiClient = {
    models: {
      generateContent: async ({ model }) => {
        attemptedModels.push(model);
        const err = new Error('API key not valid. Please pass a valid API key.');
        err.status = 401;
        throw err;
      },
    },
  };

  await assert.rejects(
    () =>
      generateModeSpecificScript({
        mode: GENERATION_MODES.MODE_A_DIALOGUE,
        generationMode: GENERATION_MODES.FAST_OCR,
        reconciledSegments: buildMockChineseSegments(2),
        durationSec: 10,
        aiClient: mockAiClient,
        modelName: 'gemini-3.5-flash-lite',
        retryDelayMs: 0,
      }),
    (err) => {
      assert.equal(err.code, 'INVALID_API_KEY');
      assert.equal(err.status, 401);
      assert.equal(err.nonRetryable, true);
      return true;
    }
  );

  assert.equal(attemptedModels.length, 1, 'Must fail fast on first 401 call without cascading or retrying');
});

test('Stage 6 Quota Exhaustion Fail-Fast: Aborts multi-batch run after 2 consecutive full-cascade failures instead of stalling remaining batches', async () => {
  const seenBatches = new Set();
  const mockAiClient = {
    models: {
      generateContent: async ({ contents }) => {
        const prompt = String(contents[0] || '');
        const match = prompt.match(/INPUT SEGMENTS TO TRANSLATE \(Batch (\d+)\):/);
        const batchNum = match ? Number(match[1]) : 0;
        seenBatches.add(batchNum);

        if (batchNum === 1) {
          return {
            text: JSON.stringify({
              summary: 'វគ្គសាកល្បង',
              detectedGenre: 'ancient',
              segments: Array.from({ length: 20 }, (_, i) => ({
                index: i + 1,
                speaker: 'តួឯកប្រុស',
                gender: 'male',
                khmerText: `ឃ្លាទី${i + 1}`,
              })),
            }),
          };
        }

        const err = new Error('429 You exceeded your current quota (RESOURCE_EXHAUSTED)');
        err.status = 429;
        throw err;
      },
    },
  };

  await assert.rejects(
    () =>
      generateModeSpecificScript({
        mode: GENERATION_MODES.MODE_A_DIALOGUE,
        generationMode: GENERATION_MODES.FAST_OCR,
        reconciledSegments: buildMockChineseSegments(80), // 4 batches of 20
        durationSec: 300,
        aiClient: mockAiClient,
        modelName: 'gemini-3.5-flash-lite',
        retryDelayMs: 0,
      }),
    (err) => {
      assert.equal(err.code, 'QUOTA_EXCEEDED');
      assert.equal(err.status, 429);
      assert.ok(err.translationReport);
      assert.equal(err.translationReport.translatedCount, 20);
      assert.equal(err.translationReport.untranslatedCount, 60);
      assert.ok(err.message.includes('Batch 2/4'));
      return true;
    }
  );

  assert.equal(seenBatches.has(4), false, 'Must abort before calling Batch 4 after Batch 2 & Batch 3 failed');
});

test('Stage 6 Isolated Batch Failure + Partial Omission: Never writes literal សន្ទនា or needsReview typo, flags reviewNeeded cleanly', async () => {
  // 5 batches = 100 segments; Batch 3 fails across cascade, all others translate except line #2 missed in Batch 1
  const mockAiClient = {
    models: {
      generateContent: async ({ contents }) => {
        const prompt = String(contents[0] || '');
        const match = prompt.match(/INPUT SEGMENTS TO TRANSLATE \(Batch (\d+)\):/);
        const batchNum = match ? Number(match[1]) : 0;

        if (batchNum === 3) {
          const err = new Error('Malformed batch temporarily failed');
          err.status = 500;
          throw err;
        }

        const startIdx = (batchNum - 1) * 20;
        const segments = [];
        for (let i = 0; i < 20; i++) {
          const globalIdx = startIdx + i + 1;
          if (globalIdx === 2) continue; // omit line #2 intentionally
          // Line #3 returns accidental literal placeholder "សន្ទនា" from model -> must be rejected
          const text = globalIdx === 3 ? 'សន្ទនា' : `អត្ថបទទី${globalIdx}`;
          segments.push({
            index: globalIdx,
            speaker: 'តួឯកស្រី',
            gender: 'female',
            khmerText: text,
          });
        }
        return {
          text: JSON.stringify({
            summary: 'ភាគសាកល្បង',
            detectedGenre: 'modern',
            segments,
          }),
        };
      },
    },
  };

  const result = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.FAST_OCR,
    reconciledSegments: buildMockChineseSegments(100), // 5 batches; 1 fails (20% < 25%)
    durationSec: 360,
    aiClient: mockAiClient,
    modelName: 'gemini-3.5-flash-lite',
    retryDelayMs: 0,
  });

  assert.equal(result.scriptSegments.length, 100);
  assert.equal(result.translationReport.isPartial, true);
  assert.equal(result.translationReport.failedBatches, 1);

  // Batch 3 segments (index 40..59 => id 41..60): empty khmerTranslatedText, reviewNeeded=true, NO needsReview typo, NO literal 'សន្ទនា'
  for (let idx = 40; idx < 60; idx++) {
    const seg = result.scriptSegments[idx];
    assert.equal(seg.khmerTranslatedText, '');
    assert.equal(seg.khmerText, '');
    assert.equal(seg.reviewNeeded, true);
    assert.equal(seg.needsReview, undefined);
    assert.equal(seg.translationStatus, 'review_needed');
    assert.equal(seg.translationWarning, 'TRANSLATION_FAILED');
    assert.ok(seg.validationErrors.length >= 1, 'Failed batch segment must preserve validationErrors');
    assert.ok(seg.originalChineseText.length > 0, 'Original Chinese text must remain intact');
  }

  // Omitted line #2 and literal 'សន្ទនា' line #3 must also stay empty + reviewNeeded=true
  for (const idx of [1, 2]) {
    const seg = result.scriptSegments[idx];
    assert.equal(seg.khmerTranslatedText, '');
    assert.equal(seg.reviewNeeded, true);
    assert.equal(seg.translationStatus, 'review_needed');
  }

  // Never emit literal 'សន្ទនា' anywhere in the entire episode
  assert.equal(
    result.scriptSegments.some((s) => s.khmerTranslatedText === 'សន្ទនា'),
    false
  );
});

test('Stage 6 Helpers: applyTranslatedSegmentResult & createCanonicalSegment reject literal សន្ទនា placeholder', () => {
  assert.equal(isPlaceholderTranslationText('សន្ទនា'), true);
  assert.equal(isPlaceholderTranslationText(''), true);
  assert.equal(isPlaceholderTranslationText('តើអ្នកសុខសប្បាយទេ?'), false);

  const seg = { id: 1, originalChineseText: '你好', speaker: 'តួអង្គ', speakerSource: 'ocr_only' };
  const applied = applyTranslatedSegmentResult(seg, { speaker: 'តួឯកប្រុស', gender: 'male', khmerText: 'សន្ទនា' }, 8, 0, { isFastOcrMode: true });
  assert.equal(applied, false);
  assert.equal(seg.khmerTranslatedText, '');
  assert.equal(seg.reviewNeeded, true);
  assert.equal(seg.translationStatus, 'review_needed');

  const canonical = createCanonicalSegment({
    startSec: 1.0,
    endSec: 2.5,
    originalChineseText: '你好',
    khmerTranslatedText: 'សន្ទនា',
    validationErrors: ['Stage 6 notice'],
  }, 0, 'dialogue');
  assert.equal(canonical.khmerTranslatedText, '');
  assert.equal(canonical.reviewNeeded, true);
  assert.equal(canonical.translationStatus, 'review_needed');
  assert.deepEqual(canonical.validationErrors, ['Stage 6 notice']);
});

test('Stage 7 & Stage 9 & ttsService Guards: Legacy សន្ទនា placeholder is caught, cleared/flagged, and blocked from TTS synthesis', async () => {
  // 1. Stage 7 catches legacy literal "សន្ទនា"
  const stage7Out = await translateAndValidateKhmer({
    scriptSegments: [
      { id: 1, originalChineseText: '你好', khmerTranslatedText: 'សួស្តី!' },
      { id: 2, originalChineseText: '两个天灵根', khmerTranslatedText: 'សន្ទនា' },
    ],
    mode: 'dialogue',
  });
  assert.equal(stage7Out.validationReport.translatedCount, 1);
  assert.equal(stage7Out.validationReport.missingTranslationCount, 1);
  assert.equal(stage7Out.validatedSegments[1].khmerTranslatedText, '');
  assert.equal(stage7Out.validatedSegments[1].reviewNeeded, true);
  assert.equal(stage7Out.validatedSegments[1].translationStatus, 'review_needed');
  assert.ok(stage7Out.validatedSegments[1].validationErrors.some((e) => e.includes('សន្ទនា')));

  // 2. ttsService helper & single-segment guard reject "សន្ទនា"
  assert.equal(isPlaceholderOrEmptyTtsText('សន្ទនា'), true);
  assert.equal(isPlaceholderOrEmptyTtsText('  ...សន្ទនា  '), true);
  assert.equal(isPlaceholderOrEmptyTtsText('ការសន្ទនាសាកល្បង'), false);

  const tmpAudioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts_guard_'));
  try {
    await assert.rejects(
      () => generateSingleSegmentAudio({ id: 9, khmerTranslatedText: 'សន្ទនា', duration: 2.0 }, tmpAudioDir),
      /សន្ទនា|Empty text/
    );

    // 3. ttsService batch skips placeholder without calling generator function
    const generatedIds = [];
    const batchRes = await generateBatchSegmentsAudio(
      [
        { id: 1, khmerTranslatedText: 'សន្ទនា', duration: 2.0 },
        { id: 2, khmerTranslatedText: 'សួស្តីអ្នកទាំងអស់គ្នា', duration: 2.0 },
      ],
      tmpAudioDir,
      {
        concurrency: 2,
        generateSingleFn: async (seg) => {
          generatedIds.push(seg.id);
          return { ...seg, audioUrl: '/mock.mp3', ttsStatus: 'ready', audioGenerated: true };
        },
      }
    );
    assert.deepEqual(generatedIds, [2], 'Only real translated segment #2 may invoke TTS generator');
    assert.equal(batchRes[0].ttsStatus, 'empty_text');
    assert.equal(batchRes[0].audioGenerated, false);

    // 4. Stage 9 skips "សន្ទនា" before ledger/cache/synthesis
    const stage9Out = await generateSegmentTTS({
      segments: [
        { id: 10, startSec: 0, endSec: 2, duration: 2, khmerTranslatedText: 'សន្ទនា' },
      ],
      audioDir: tmpAudioDir,
    });
    assert.equal(stage9Out.ttsReport.skippedEmptyCount, 1);
    assert.equal(stage9Out.ttsReport.generatedCount, 0);
    assert.equal(stage9Out.segmentsWithAudio[0].ttsStatus, 'empty_text');
    assert.equal(stage9Out.segmentsWithAudio[0].audioGenerated, false);
  } finally {
    fs.rmSync(tmpAudioDir, { recursive: true, force: true });
  }
});

test('POST /api/generate-audio rejects literal សន្ទនា on single (400) and skips on batch (200)', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', audioRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/generate-audio`;

  try {
    const singleRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segment: {
          id: 129,
          index: 129,
          khmer: 'សន្ទនា',
          khmerText: 'សន្ទនា',
          khmerTranslatedText: 'សន្ទនា',
        },
      }),
    });
    assert.equal(singleRes.status, 400);
    const singleBody = await singleRes.json();
    assert.equal(singleBody.success, false);
    assert.ok(singleBody.error.includes('សន្ទនា'));

    const batchRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: [
          { id: 129, khmer: 'សន្ទនា', chineseText: '不就是几步路的事情' },
          { id: 130, khmer: '', chineseText: '两个天灵根' },
        ],
        seriesId: 'test_placeholder_guard',
        episodeId: 'ep_guard',
      }),
    });
    assert.equal(batchRes.status, 200);
    const batchBody = await batchRes.json();
    assert.equal(batchBody.success, true);
    assert.equal(batchBody.skippedEmptyCount, 2);
    assert.equal(batchBody.validCount, 0);
    assert.equal(batchBody.fullAudioUrl, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(path.resolve(__dirname, '../uploads/projects/test_placeholder_guard'), { recursive: true, force: true });
  }
});

