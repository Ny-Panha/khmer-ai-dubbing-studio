const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  PersistentChineseOcrWorker,
  isLocalChineseOcrAvailable,
} = require('../services/ocr/localChineseOcrService');
const { resolvePythonBinary } = require('../services/audioSeparationService');
const {
  isExactChineseSubtitleMatch,
  areChineseTextsEquivalent,
  deduplicateFastOcrCues,
  parseVisionResponseFrames,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const { generateModeSpecificScript } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('../services/pipeline/stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('../services/pipeline/stages/stage8_validateSubtitleTiming');
const { stitchAndDeduplicateSegments } = require('../services/pipeline/chunkOrchestrator');
const { computePipelineCompletenessReport, GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

async function createPng(outPath, drawCode) {
  const pyBin = resolvePythonBinary();
  const script = `
import cv2, numpy as np, sys
img = np.full((360, 640, 3), 25, dtype=np.uint8)
${drawCode}
cv2.imwrite(sys.argv[1], img)
`;
  await new Promise((resolve, reject) => {
    const cp = spawn(pyBin, ['-c', script, outPath], { windowsHide: true });
    cp.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Python exited ${code}`))));
  });
}

test('1. Corner watermark rejected while legitimate off-center dialogue is preserved', async () => {
  if (!(await isLocalChineseOcrAvailable())) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'step1_wm_test_'));
  const worker = new PersistentChineseOcrWorker({ detLimitSideLen: 360 });
  await worker.start();
  try {
    const fWatermark = path.join(dir, 'wm_only.png');
    const fOffCenter = path.join(dir, 'offcenter.png');
    // Extreme bottom-right corner ASCII+digits stamp inside ROI (x=0.80..0.89, y=0.92..0.97)
    await createPng(fWatermark, `cv2.putText(img, 'ID2640', (520, 342), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255,255,255), 2)`);
    // Legitimate off-center dialogue shifted left in subtitle band (x=0.20..0.44, y=0.84..0.90)
    await createPng(fOffCenter, `cv2.putText(img, 'HELLO WORLD', (130, 315), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255,255,255), 2)`);

    const res = await worker.processBatch([
      { id: 'wm', filePath: fWatermark, timestampSec: 1.0, cueIndex: 1 },
      { id: 'oc', filePath: fOffCenter, timestampSec: 2.0, cueIndex: 2 },
    ], 'wm_oc_batch');

    assert.equal(res.results[0].hasText, false, 'Extreme-corner watermark alone must be rejected');
    assert.equal(res.results[1].hasText, true, 'Legitimate off-center dialogue must be preserved');
    assert.ok(res.results[1].chineseText.includes('HELLO'), `Expected off-center text, got: ${res.results[1].chineseText}`);
  } finally {
    await worker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('2. Short echo cues and 1-char negation differences are never merged or dropped', () => {
  assert.equal(isExactChineseSubtitleMatch('我相信你', '我不相信你'), false);
  assert.equal(isExactChineseSubtitleMatch('有一些凶兆', '凶兆'), false);
  assert.equal(isExactChineseSubtitleMatch('那边应该是原来的陆家嘴方向', '陆家嘴'), false);
  assert.equal(areChineseTextsEquivalent('我相信你', '我不相信你'), false);
  assert.equal(areChineseTextsEquivalent('有一些凶兆', '凶兆'), false);

  const cues = [
    { sourceCueId: 'cue_1', startSec: 199.6, endSec: 200.4, originalChineseText: '有一些凶兆', chineseText: '有一些凶兆' },
    { sourceCueId: 'cue_2', startSec: 200.6, endSec: 201.2, originalChineseText: '凶兆', chineseText: '凶兆' },
    { sourceCueId: 'cue_3', startSec: 205.0, endSec: 206.0, originalChineseText: '嗯', chineseText: '嗯' },
    { sourceCueId: 'cue_4', startSec: 210.0, endSec: 211.0, originalChineseText: '嗯', chineseText: '嗯' },
  ];

  const deduped = deduplicateFastOcrCues(cues, 'male');
  assert.equal(deduped.length, 4, 'All 4 distinct cues including short echo and distant repeat must be preserved');
  assert.deepEqual(deduped.map((c) => c.sourceCueId), ['cue_1', 'cue_2', 'cue_3', 'cue_4']);
  assert.deepEqual(deduped.map((c) => c.originalChineseText), ['有一些凶兆', '凶兆', '嗯', '嗯']);
});

test('3. Omitted Gemini Vision frames stay unresolved (never classified as verified_empty)', () => {
  const batchFrames = [{ timestampSec: 1.0 }, { timestampSec: 2.0 }];
  const obs = parseVisionResponseFrames({
    text: JSON.stringify({
      frames: [{ timestampSec: 1.0, hasText: true, textZh: '你好', chineseText: '你好' }],
    }),
  }, batchFrames, { autoVerifyOmitted: true });

  assert.equal(obs[0].isVerified, true);
  assert.equal(obs[1].isVerified, false);
  assert.equal(obs[1].ocrFailed, true);
  assert.equal(obs[1].ocrStatus, 'missing');
});

test('4. Immutable sourceCueId & 1:1 Chinese-to-Khmer mapping preserved across Stage 6, 7, 8 and Chunk Stitching', async () => {
  const chunk0 = [
    { sourceCueId: 'cue_0_100_1', startSec: 1.0, endSec: 8.5, duration: 7.5, originalChineseText: '我们今天必须完成任务！否则后果不堪设想。', chineseText: '我们今天必须完成任务！否则后果不堪设想。' },
    { sourceCueId: 'cue_0_20000_2', startSec: 200.0, endSec: 200.4, duration: 0.4, originalChineseText: '有一些凶兆', chineseText: '有一些凶兆' },
    { sourceCueId: 'cue_0_20060_3', startSec: 200.6, endSec: 201.2, duration: 0.6, originalChineseText: '凶兆', chineseText: '凶兆' },
  ];
  const stitched = stitchAndDeduplicateSegments(chunk0);
  assert.equal(stitched.length, 3);

  const mockAi = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          summary: 'សាកល្បង',
          detectedGenre: 'modern',
          segments: [
            { index: 1, sourceCueId: 'cue_0_100_1', speaker: 'តួប្រុស', gender: 'male', khmerText: 'ថ្ងៃនេះយើងត្រូវតែបំពេញភារកិច្ចនេះ!' },
            { index: 2, sourceCueId: 'cue_0_20000_2', speaker: 'តួប្រុស', gender: 'male', khmerText: 'មានប្រផ្នូលមិនល្អខ្លះ' },
            { index: 3, sourceCueId: 'cue_0_20060_3', speaker: 'តួស្រី', gender: 'female', khmerText: 'ប្រផ្នូលមិនល្អឬ?' },
          ],
        }),
      }),
    },
  };

  // Even in Standard MODE_A_DIALOGUE, sourceCueId prevents splitLongDialogueSegment from breaking 1:1 mapping
  const stage6 = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    reconciledSegments: stitched,
    durationSec: 210,
    aiClient: mockAi,
    useTranslationCache: false,
  });
  assert.equal(stage6.scriptSegments.length, 3);
  assert.equal(stage6.translationReport.oneToOneMappingValid, true);

  const stage7 = await translateAndValidateKhmer({ scriptSegments: stage6.scriptSegments, mode: 'dialogue' });
  assert.equal(stage7.validationReport.oneToOneMappingValid, true);
  assert.equal(stage7.validationReport.translatedCount, 3);

  const stage8 = await validateSubtitleTiming({ segments: stage7.validatedSegments, durationSec: 210 });
  assert.equal(stage8.timedSegments.length, 3);
  assert.deepEqual(stage8.timedSegments.map((s) => s.sourceCueId), ['cue_0_100_1', 'cue_0_20000_2', 'cue_0_20060_3']);
});

test('5. Completeness report never hardcodes 100% when OCR frames or translations are incomplete', () => {
  const partialReport = computePipelineCompletenessReport({
    durationSec: 300,
    verifiedSourceCuesCount: 10,
    ocrTotalFrames: 100,
    ocrVerifiedFrames: 98,
    ocrUnresolvedFrames: 2,
    finalizedSegments: [
      { originalChineseText: '一', khmerTranslatedText: 'មួយ', translationStatus: 'translated' },
      { originalChineseText: '二', khmerTranslatedText: '', translationStatus: 'review_needed' },
    ],
  });
  assert.equal(partialReport.status, 'incomplete');
  assert.equal(partialReport.oneToOneMappingValid, false);
  assert.equal(partialReport.ocrFrameCompletenessPct, 98);
  assert.equal(partialReport.translationCompletenessPct, 10);
  assert.equal(partialReport.coveragePercentage, 10);
});

test('6. Direct Studio and Batch Step 1 job worker both enforce 1:1 cue mapping and completeness', async () => {
  const { createPipelineWorkerHandler } = require('../services/pipeline/jobWorker');
  const { ProductionJobQueue, JOB_STATUS } = require('../services/pipeline/productionJobQueue');

  // Verify Batch Step 1 worker passes through runDubbingPipeline and returns exact completeness metadata
  const queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step1_batch_q_'));
  const dummyVideo = path.join(queueDir, 'ep_test.mp4');
  fs.writeFileSync(dummyVideo, 'dummy');

  const fakePipelineResult = {
    success: true,
    totalSegments: 3,
    segments: [
      { sourceCueId: 'cue_1', originalChineseText: 'A', khmerTranslatedText: 'ក', translationStatus: 'translated' },
      { sourceCueId: 'cue_2', originalChineseText: 'B', khmerTranslatedText: 'ខ', translationStatus: 'translated' },
      { sourceCueId: 'cue_3', originalChineseText: 'C', khmerTranslatedText: 'គ', translationStatus: 'translated' },
    ],
    coverage: computePipelineCompletenessReport({
      durationSec: 10,
      verifiedSourceCuesCount: 3,
      ocrTotalFrames: 6,
      ocrVerifiedFrames: 6,
      ocrUnresolvedFrames: 0,
      finalizedSegments: [
        { sourceCueId: 'cue_1', originalChineseText: 'A', khmerTranslatedText: 'ក', translationStatus: 'translated' },
        { sourceCueId: 'cue_2', originalChineseText: 'B', khmerTranslatedText: 'ខ', translationStatus: 'translated' },
        { sourceCueId: 'cue_3', originalChineseText: 'C', khmerTranslatedText: 'គ', translationStatus: 'translated' },
      ],
    }),
  };

  try {
    const queue = new ProductionJobQueue({ baseDir: queueDir, concurrency: 1 });
    const calls = [];
    const worker = createPipelineWorkerHandler(queue, {
      extractAllGeminiKeys: () => ['test-key-1'],
      runDubbingPipeline: async (args) => {
        calls.push(args);
        return fakePipelineResult;
      },
    });

    const res = await worker({
      jobId: 'job_step1_test',
      seriesId: 'series_test',
      episodeId: 'ep_test',
      videoPath: dummyVideo,
      mode: GENERATION_MODES.FAST_OCR,
      status: JOB_STATUS.RUNNING,
      config: { mode: GENERATION_MODES.FAST_OCR, generationMode: 'fast_ocr' },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, GENERATION_MODES.FAST_OCR);
    assert.equal(res.coverage.oneToOneMappingValid, true);
    assert.equal(res.coverage.verifiedSourceCuesCount, 3);
    assert.equal(res.coverage.translatedKhmerCuesCount, 3);
    assert.equal(res.coverage.coveragePercentage, 100);
  } finally {
    fs.rmSync(queueDir, { recursive: true, force: true });
  }
});
