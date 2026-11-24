const { ingestEpisode } = require('./stages/stage1_ingestEpisode');
const { analyzeSourceMedia } = require('./stages/stage2_analyzeSourceMedia');
const { extractChineseSubtitles } = require('./stages/stage3_extractChineseSubtitles');
const { analyzeDialogueAudio } = require('./stages/stage4_analyzeDialogueAudio');
const { reconcileTimelineEvidence } = require('./stages/stage5_reconcileTimelineEvidence');
const { generateModeSpecificScript } = require('./stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('./stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('./stages/stage8_validateSubtitleTiming');
const { generateSegmentTTS } = require('./stages/stage9_generateSegmentTTS');
const { previewAndExport } = require('./stages/stage10_previewAndExport');
const { saveCheckpoint } = require('./checkpointManager');
const { GENERATION_MODES } = require('./pipelineTypes');
const { DUBBING_CASCADE_MODELS, isUsableDubbingModel } = require('../geminiModelCatalog');
const { geminiQuotaTracker } = require('../geminiQuotaTracker');

function checkAbortSignal(signal, stageName) {
  if (signal?.aborted) {
    const err = new Error(`Pipeline aborted at ${stageName}`);
    err.name = 'AbortError';
    throw err;
  }
}

function trySaveStageCheckpoint({
  jobId,
  seriesId,
  episodeId,
  stage,
  stageIndex,
  data,
  baseUploadsDir,
}) {
  if (!jobId) return;
  try {
    saveCheckpoint({
      jobId,
      seriesId,
      episodeId,
      stage,
      stageIndex,
      stageStatus: 'completed',
      data,
      baseUploadsDir,
    });
  } catch (err) {
    console.warn(`[Pipeline Orchestrator] Checkpoint warning at ${stage}:`, err.message);
  }
}

/**
 * ដំណើរការ Pipeline ទាំង ១០ ដំណាក់កាលសម្រាប់បកប្រែ និងបញ្ចូលសំឡេងខ្មែរ
 *
 * @param {object} params
 * @param {string} params.videoPath - ទីតាំងវីដេអូដើម
 * @param {object} params.aiClient - Google Gen AI client instance
 * @param {string} [params.seriesId='series_default']
 * @param {string} [params.episodeId='ep_1']
 * @param {string} [params.mode='dialogue'] - 'dialogue' (Mode A) ឬ 'recap' (Mode B)
 * @param {string} [params.genre='auto'] - 'auto' | 'ancient' | 'modern' | 'action' | 'comedy' | 'general'
 * @param {string} [params.modelName='gemini-3.5-flash-lite']
 * @param {string} [params.userDirection='']
 * @param {string} [params.narratorGender='male']
 * @param {object} [params.seriesGlossary={}]
 * @param {string} [params.defaultVoiceId='km-KH-PisethNeural']
 * @param {object} [params.speakerRegistry={}]
 * @param {boolean} [params.forceRegenTts=false]
 * @param {number} [params.ttsConcurrency=5]
 * @param {object} [params.exportOptions={ renderVideo: true, burnSubtitles: true }]
 * @param {string} [params.baseUploadsDir=null]
 * @param {AbortSignal} [params.signal=null]
 * @param {Function} [params.onProgress=null]
 */
async function runEpisodePipeline({
  videoPath,
  aiClient,
  seriesId = 'series_default',
  episodeId = 'ep_1',
  mode = GENERATION_MODES?.MODE_A_DIALOGUE || 'dialogue',
  genre = 'auto',
  modelName = null,
  userDirection = '',
  narratorGender = 'male',
  seriesGlossary = {},
  defaultVoiceId = 'km-KH-PisethNeural',
  speakerRegistry = {},
  forceRegenTts = false,
  ttsConcurrency = 5,
  exportOptions = { renderVideo: true, burnSubtitles: true },
  baseUploadsDir = null,
  signal = null,
  onProgress = null,
}) {
  const cleanRequestedModel = String(modelName || '').trim();
  const effectiveModelName = (cleanRequestedModel && cleanRequestedModel !== 'auto' && isUsableDubbingModel(cleanRequestedModel))
    ? cleanRequestedModel
    : geminiQuotaTracker.getPreferredPrimaryModel(DUBBING_CASCADE_MODELS[0]);
  const notifyProgress = (stageIndex, stageName, percent, message, meta = {}) => {
    if (typeof onProgress === 'function') {
      onProgress({ stageIndex, stageName, percent, message, ...meta });
    }
  };

  // =========================================================================
  // STAGE 1: Ingest Episode
  // =========================================================================
  checkAbortSignal(signal, 'stage1_ingestEpisode');
  notifyProgress(1, 'stage1_ingestEpisode', 5, 'កំពុងត្រួតពិនិត្យ និងរៀបចំថតឯកសារវីដេអូដើម...');

  const ingestCtx = await ingestEpisode({
    videoPath,
    seriesId,
    episodeId,
    baseUploadsDir,
  });

  const {
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    episodeDir,
    audioDir,
  } = ingestCtx;

  trySaveStageCheckpoint({
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    stage: 'stage1_ingestEpisode',
    stageIndex: 1,
    data: ingestCtx,
    baseUploadsDir,
  });

  // =========================================================================
  // STAGE 2: Analyze Source Media
  // =========================================================================
  checkAbortSignal(signal, 'stage2_analyzeSourceMedia');
  notifyProgress(2, 'stage2_analyzeSourceMedia', 12, 'កំពុងវិភាគប្រវែង និងទិន្នន័យបច្ចេកទេសវីដេអូ...');

  const mediaAnalysis = await analyzeSourceMedia({
    videoPath: ingestCtx.videoPath,
  });

  const { durationSec } = mediaAnalysis;

  trySaveStageCheckpoint({
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    stage: 'stage2_analyzeSourceMedia',
    stageIndex: 2,
    data: mediaAnalysis,
    baseUploadsDir,
  });

  // =========================================================================
  // STAGE 3 & STAGE 4 (PARALLEL): Extract Subtitles (OCR) + Analyze Audio (ASR)
  // =========================================================================
  checkAbortSignal(signal, 'stage3_and_stage4_extraction');
  notifyProgress(3, 'stage3_and_stage4', 25, 'កំពុងស្កេនអក្សរចិនលើអេក្រង់ (OCR) និងវិភាគសំឡេងសន្ទនា (ASR) ទន្ទឹមគ្នា...');

  const [ocrResult, asrResult] = await Promise.all([
    extractChineseSubtitles({
      videoPath: ingestCtx.videoPath,
      durationSec,
      aiClient,
      modelName: effectiveModelName,
      baseStepSec: 0.75,
      startOffsetSec: 0,
    }),
    analyzeDialogueAudio({
      videoPath: ingestCtx.videoPath,
      durationSec,
      aiClient,
      modelName: effectiveModelName,
      startOffsetSec: 0,
    }),
  ]);

  trySaveStageCheckpoint({
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    stage: 'stage3_extractChineseSubtitles',
    stageIndex: 3,
    data: ocrResult,
    baseUploadsDir,
  });

  trySaveStageCheckpoint({
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    stage: 'stage4_analyzeDialogueAudio',
    stageIndex: 4,
    data: asrResult,
    baseUploadsDir,
  });

  // =========================================================================
  // STAGE 5: Reconcile Timeline Evidence
  // =========================================================================
  checkAbortSignal(signal, 'stage5_reconcileTimelineEvidence');
  notifyProgress(5, 'stage5_reconcileTimelineEvidence', 45, 'កំពុងផ្គូផ្គងទិន្នន័យសំឡេង ASR និងអក្សររត់ OCR...');

  const reconciliation = await reconcileTimelineEvidence({
    visualSegments: ocrResult.visualSegments,
    audioSegments: asrResult.audioSegments,
    rawObservations: ocrResult.rawObservations,
    durationSec,
  });

  trySaveStageCheckpoint({
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    stage: 'stage5_reconcileTimelineEvidence',
    stageIndex: 5,
    data: reconciliation,
    baseUploadsDir,
  });

  // =========================================================================
  // STAGE 6: Generate Mode Specific Script (Mode A Dialogue / Mode B Recap)
  // =========================================================================
  checkAbortSignal(signal, 'stage6_generateModeSpecificScript');
  notifyProgress(6, 'stage6_generateModeSpecificScript', 60, 'កំពុងបកប្រែ និងសម្រួលអត្ថបទសន្ទនាភាសាខ្មែរ...');

  const scriptGeneration = await generateModeSpecificScript({
    mode,
    reconciledSegments: reconciliation.reconciledSegments,
    durationSec,
    aiClient,
    modelName: effectiveModelName,
    userDirection,
    narratorGender,
    seriesGlossary,
    genre,
    signal,
  });

  trySaveStageCheckpoint({
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    stage: 'stage6_generateModeSpecificScript',
    stageIndex: 6,
    data: scriptGeneration,
    baseUploadsDir,
  });

  // =========================================================================
  // STAGE 7: Translate and Validate Khmer
  // =========================================================================
  checkAbortSignal(signal, 'stage7_translateAndValidateKhmer');
  notifyProgress(7, 'stage7_translateAndValidateKhmer', 70, 'កំពុងផ្ទៀងផ្ទាត់អត្ថបទភាសាខ្មែរ...');

  const khmerValidation = await translateAndValidateKhmer({
    scriptSegments: scriptGeneration.scriptSegments,
    mode: scriptGeneration.mode,
  });

  trySaveStageCheckpoint({
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    stage: 'stage7_translateAndValidateKhmer',
    stageIndex: 7,
    data: khmerValidation,
    baseUploadsDir,
  });

  // =========================================================================
  // STAGE 8 (PASS 1 - Pre-TTS): Validate Subtitle Timing & Compute Slot Duration
  // =========================================================================
  checkAbortSignal(signal, 'stage8_validateSubtitleTiming_preTTS');
  notifyProgress(8, 'stage8_validateSubtitleTiming', 75, 'កំពុងគណនាចន្លោះពេលវេលា (Slot Duration) សម្រាប់សំឡេងនិយាយ...');

  const preTtsTiming = await validateSubtitleTiming({
    segments: khmerValidation.validatedSegments,
    durationSec,
  });

  // =========================================================================
  // STAGE 9: Generate Segment TTS
  // =========================================================================
  checkAbortSignal(signal, 'stage9_generateSegmentTTS');
  notifyProgress(9, 'stage9_generateSegmentTTS', 80, 'កំពុងបង្កើតសំឡេងនិយាយភាសាខ្មែរ (TTS)...');

  const ttsResult = await generateSegmentTTS({
    segments: preTtsTiming.timedSegments,
    audioDir,
    defaultVoiceId,
    speakerRegistry,
    forceRegen: forceRegenTts,
    concurrency: ttsConcurrency,
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    baseUploadsDir,
    signal,
    aiClient,
    modelName,
    onSegmentCompleted: (seg, idx, completedCount) => {
      const total = preTtsTiming.timedSegments.length || 1;
      const subPercent = Math.min(92, Math.round(80 + (completedCount / total) * 12));
      notifyProgress(
        9,
        'stage9_generateSegmentTTS',
        subPercent,
        `កំពុងបង្កើតសំឡេង TTS (${completedCount}/${total})...`,
        { segmentId: seg.id, segmentIndex: idx }
      );
    },
  });

  // =========================================================================
  // STAGE 8 (PASS 2 - Post-TTS): Re-sync Subtitle End Times with Actual Audio
  // =========================================================================
  checkAbortSignal(signal, 'stage8_validateSubtitleTiming_postTTS');
  notifyProgress(8, 'stage8_postTtsSync', 94, 'កំពុងផ្គូផ្គងពេលវេលាអក្សររត់ឱ្យស៊ីគ្នាជាមួយប្រវែងសំឡេង TTS ជាក់ស្តែង...');

  const finalTiming = await validateSubtitleTiming({
    segments: ttsResult.segmentsWithAudio,
    durationSec,
  });

  trySaveStageCheckpoint({
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    stage: 'stage9_generateSegmentTTS',
    stageIndex: 9,
    data: {
      segments: finalTiming.timedSegments,
      ttsReport: ttsResult.ttsReport,
      timingReport: finalTiming.timingReport,
    },
    baseUploadsDir,
  });

  // =========================================================================
  // STAGE 10: Preview and Export (.ass, .srt, Dubbed Video with Ducking)
  // =========================================================================
  checkAbortSignal(signal, 'stage10_previewAndExport');
  notifyProgress(10, 'stage10_previewAndExport', 96, 'កំពុងបង្កើតឯកសារអក្សររត់ (.ass/.srt) និងផលិតវីដេអូសម្រេច...');

  const exportResult = await previewAndExport({
    videoPath: ingestCtx.videoPath,
    segments: finalTiming.timedSegments,
    episodeDir,
    exportOptions,
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    signal,
    baseUploadsDir,
  });

  notifyProgress(10, 'completed', 100, 'ដំណើរការបកប្រែ និងផលិតវីដេអូត្រូវបានបញ្ចប់ដោយជោគជ័យ!');

  return {
    jobId,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    mode: scriptGeneration.mode,
    detectedGenre: scriptGeneration.detectedGenre,
    summary: scriptGeneration.summary,
    mediaAnalysis,
    segments: finalTiming.timedSegments,
    reports: {
      ocrMeta: ocrResult.ocrMeta,
      audioMeta: asrResult.audioMeta,
      reconciliationMeta: reconciliation.reconciliationMeta,
      validationReport: khmerValidation.validationReport,
      timingReport: finalTiming.timingReport,
      ttsReport: ttsResult.ttsReport,
    },
    artifacts: {
      episodeDir,
      audioDir,
      assSubtitlePath: exportResult.assSubtitlePath,
      srtSubtitlePath: exportResult.srtSubtitlePath,
      outputVideoPath: exportResult.outputVideoPath,
      validationResult: exportResult.validationResult,
    },
  };
}

module.exports = {
  runEpisodePipeline,
};

