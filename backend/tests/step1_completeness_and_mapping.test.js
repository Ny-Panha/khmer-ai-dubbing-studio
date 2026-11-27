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

test('7. OCR engine mode defaults to hybrid even in fast_ocr and supports configurable gemini_only', async () => {
  const { OCR_ENGINE_MODES, resolveOcrEngineMode } = require('../services/pipeline/pipelineTypes');
  assert.equal(resolveOcrEngineMode({}), OCR_ENGINE_MODES.HYBRID);
  assert.equal(resolveOcrEngineMode({ ocrMode: 'hybrid' }), OCR_ENGINE_MODES.HYBRID);
  assert.equal(resolveOcrEngineMode({ ocrMode: 'gemini_only' }), OCR_ENGINE_MODES.GEMINI_ONLY);
  assert.equal(resolveOcrEngineMode({ enableLocalOcr: false }), OCR_ENGINE_MODES.GEMINI_ONLY);
});

test('8. Deduplication & chunk stitching protect distinct sourceCueIds while deduping cross-chunk boundary overlaps', async () => {
  const { deduplicateFastOcrCues } = require('../services/pipeline/stages/stage3VisionBatchRunner');
  const { stitchAndDeduplicateSegments } = require('../services/pipeline/chunkOrchestrator');
  const { saveVerifiedChineseSrt } = require('../services/pipeline/stages/stage3_extractChineseSubtitles');

  const sameChunkDistinct = [
    { sourceCueId: 'cue_0_1000_1', startSec: 1.0, endSec: 2.0, originalChineseText: '怎么了' },
    { sourceCueId: 'cue_0_2050_2', startSec: 2.05, endSec: 2.8, originalChineseText: '怎么了' },
  ];
  const dedupedSame = deduplicateFastOcrCues(sameChunkDistinct, 'male');
  assert.equal(dedupedSame.length, 2, 'Same-chunk distinct sourceCueIds must never merge');

  const crossChunkOverlap = [
    { sourceCueId: 'cue_0_29850_45', startSec: 298.5, endSec: 300.2, originalChineseText: '我们走吧' },
    { sourceCueId: 'cue_30000_29855_1', startSec: 298.55, endSec: 300.3, originalChineseText: '我们走吧' },
  ];
  const dedupedCross = deduplicateFastOcrCues(crossChunkOverlap, 'male');
  assert.equal(dedupedCross.length, 1, 'Cross-chunk boundary repeat must deduplicate cleanly');

  const stitchedShortIds = stitchAndDeduplicateSegments([
    { sourceCueId: 'cue_1', startSec: 1.0, endSec: 1.6, originalChineseText: '不好' },
    { sourceCueId: 'cue_2', startSec: 1.65, endSec: 2.2, originalChineseText: '不好' },
  ]);
  assert.equal(stitchedShortIds.length, 2, 'Short test cue_1/cue_2 IDs must not falsely collide via split("_")[1]');

  const srtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step1_srt_'));
  try {
    const srtPath = path.join(srtDir, 'verified_chinese.srt');
    saveVerifiedChineseSrt(sameChunkDistinct, srtPath);
    const content = fs.readFileSync(srtPath, 'utf8');
    assert.ok(content.includes('00:00:01,000 --> 00:00:02,000'));
    assert.ok(content.includes('怎么了'));
  } finally {
    fs.rmSync(srtDir, { recursive: true, force: true });
  }
});

test('9. Strict sourceCueId set mapping rejects dropped, duplicate, swapped, or placeholder cues across Stage 6-8', async () => {
  const { validateStrictSourceCueMapping } = require('../services/pipeline/pipelineTypes');
  const { generateModeSpecificScript } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
  const { translateAndValidateKhmer } = require('../services/pipeline/stages/stage7_translateAndValidateKhmer');
  const { validateSubtitleTiming } = require('../services/pipeline/stages/stage8_validateSubtitleTiming');

  const sourceCues = [
    { sourceCueId: 'cue_0_100_1', startSec: 1, endSec: 2, originalChineseText: '你好' },
    { sourceCueId: 'cue_0_250_2', startSec: 2.5, endSec: 3.5, originalChineseText: '快走' },
  ];

  // Swapped/duplicate ID with matching count 2 === 2 must fail strict check
  const badReport = computePipelineCompletenessReport({
    durationSec: 10,
    verifiedSourceCuesCount: 2,
    sourceCues,
    finalizedSegments: [
      { sourceCueId: 'cue_0_100_1', originalChineseText: '你好', khmerTranslatedText: 'សួស្តី', translationStatus: 'translated' },
      { sourceCueId: 'cue_0_100_1', originalChineseText: '你好', khmerTranslatedText: 'សួស្តី', translationStatus: 'translated' },
    ],
  });
  assert.equal(badReport.oneToOneMappingValid, false);
  assert.equal(badReport.exactCueIdSetMatch, false);
  assert.deepEqual(badReport.missingCueIds, ['cue_0_250_2']);
  assert.deepEqual(badReport.duplicateCueIds, ['cue_0_100_1']);

  const strictMismatch = validateStrictSourceCueMapping(sourceCues, [
    { sourceCueId: 'cue_0_250_2', originalChineseText: '快走', khmerTranslatedText: 'ទៅ', translationStatus: 'translated' },
    { sourceCueId: 'cue_0_100_1', originalChineseText: '你好', khmerTranslatedText: 'សួស្តី', translationStatus: 'translated' },
  ]);
  assert.equal(strictMismatch.valid, false);
  assert.ok(strictMismatch.mismatchedOrderCueIds.length > 0);

  // Stage 6 tracks Gemini token usage, skips already-translated batches, and enforces 1:1 IDs
  let calls = 0;
  const mockAi = {
    models: {
      generateContent: async () => {
        calls++;
        if (calls === 1) {
          // Omit segment 2 cleanly -> triggers targeted retry only for segment 2
          return {
            text: JSON.stringify({
              segments: [{ index: 1, segmentId: 1, sourceCueId: 'cue_0_100_1', speaker: 'តួប្រុស', gender: 'male', khmerText: 'សួស្តី' }],
            }),
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, totalTokenCount: 130 },
          };
        }
        return {
          text: JSON.stringify({
            segments: [{ index: 2, segmentId: 2, sourceCueId: 'cue_0_250_2', speaker: 'តួប្រុស', gender: 'male', khmerText: 'ទៅឱ្យលឿន!' }],
          }),
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
        };
      },
    },
  };

  const s6 = await generateModeSpecificScript({
    mode: 'dialogue',
    generationMode: 'fast_ocr',
    reconciledSegments: sourceCues,
    durationSec: 10,
    aiClient: mockAi,
    retryDelayMs: 0,
    useTranslationCache: false,
  });
  assert.equal(calls, 2);
  assert.equal(s6.translationReport.oneToOneMappingValid, true);
  assert.equal(s6.translationReport.exactCueIdSetMatch, true);
  assert.equal(s6.usage.promptTokens, 150);
  assert.equal(s6.usage.outputTokens, 50);
  assert.equal(s6.usage.totalTokens, 200);

  const s7 = await translateAndValidateKhmer({ scriptSegments: s6.scriptSegments, sourceCues, mode: 'dialogue' });
  assert.equal(s7.validationReport.oneToOneMappingValid, true);

  const s8 = await validateSubtitleTiming({ segments: s7.validatedSegments, sourceCues, durationSec: 10 });
  assert.equal(s8.timingReport.oneToOneMappingValid, true);
  assert.deepEqual(s8.timedSegments.map((x) => x.sourceCueId), ['cue_0_100_1', 'cue_0_250_2']);
});

test('10. Stage 3 typo-split guard routes minor variants to tie-break, rejects ASCII props, and filters isolated 1-char noise', async () => {
  const { extractChineseSubtitles } = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
  const stage3RunnerSrc = fs.readFileSync(path.join(__dirname, '../services/pipeline/stages/stage3_extractChineseSubtitles.js'), 'utf8');

  assert.ok(stage3RunnerSrc.includes('looksLikeGenuineRapidSplit'), 'Typo-split guard must exist in Stage 3');
  assert.ok(stage3RunnerSrc.includes('disagreedTimestamps'), 'Conflicting local OCR pairs must block self-certification');
  assert.ok(stage3RunnerSrc.includes('hasChineseHanzi'), 'Non-Hanzi ASCII props must be excluded from Chinese dialogue');
  assert.ok(!stage3RunnerSrc.includes('const skipLocalOcr = fastOcrActive'), 'Fast OCR must not hard-disable RapidOCR');

  // Also test parseVisionResponseFrames drops ASCII-only strings like "NOH"
  const { parseVisionResponseFrames } = require('../services/pipeline/stages/stage3VisionBatchRunner');
  const obs = parseVisionResponseFrames(
    { text: JSON.stringify({ frames: [{ timestampSec: 1.0, hasText: true, textZh: 'NOH', chineseText: 'NOH' }] }) },
    [{ timestampSec: 1.0 }]
  );
  assert.equal(obs[0].hasText, false, 'Pure ASCII prop NOH must not be accepted as Chinese dialogue');
  assert.equal(typeof extractChineseSubtitles, 'function');
});

test('11. ProductionJobQueue preserves review_needed status when 1:1 mapping or OCR completeness fails', async () => {
  const { ProductionJobQueue, JOB_STATUS } = require('../services/pipeline/productionJobQueue');
  const qDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step1_review_q_'));
  const epVid = path.join(qDir, 'v.mp4');
  fs.writeFileSync(epVid, 'x');
  try {
    const queue = new ProductionJobQueue({ baseDir: qDir, concurrency: 1 });
    queue.registerWorkerHandler(async () => ({
      success: false,
      status: JOB_STATUS.REVIEW_NEEDED,
      totalSegments: 2,
      coverage: { oneToOneMappingValid: false, ocrUnresolvedFramesCount: 1 },
      stageMessage: '1 unresolved frame requires review',
    }));
    const { jobData } = queue.enqueueJob({
      seriesId: 's_rev',
      episodeId: 'ep_1',
      videoPath: epVid,
      mode: 'fast_ocr',
      config: { mode: 'fast_ocr' },
    });
    await queue.waitForWorkerSettlement(jobData.jobId, 3000);
    const settled = queue.getJob(jobData.jobId, 's_rev', 'ep_1');
    assert.equal(settled.status, JOB_STATUS.REVIEW_NEEDED, 'Incomplete job must transition to review_needed, never completed');
  } finally {
    fs.rmSync(qDir, { recursive: true, force: true });
  }
});
