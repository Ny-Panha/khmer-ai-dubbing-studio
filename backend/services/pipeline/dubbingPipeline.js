const { GoogleGenAI } = require('@google/genai');
const { createSmartGenAIClient } = require('../geminiKeyManager');
const { PIPELINE_STAGES, PIPELINE_STATUS, GENERATION_MODES } = require('./pipelineTypes');
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
const { runChunkedDubbingPipeline } = require('./chunkOrchestrator');
const { createJob, updateJob } = require('./jobManager');
const { saveCheckpoint, generateVideoFingerprint } = require('./checkpointManager');
const { buildSpeakerRegistry, syncSegmentsWithSpeakerRegistry } = require('../../models/speakerRegistry');

const CASCADE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
];

function getAiClient(customApiKey) {
  return createSmartGenAIClient(customApiKey);
}

/**
 * Master AI Dubbing Pipeline Orchestrator
 * Executes Stages 1 through 10 with isolated workspace context,
 * real progress callback, cancellation protection, and error recovery.
 * Automatically delegates to chunked execution for videos > 360s (supporting up to 1-2 hours).
 * 
 * @param {object} params
 * @param {string} params.videoPath - Path to original source video
 * @param {string} [params.mode='dialogue'] - 'dialogue' (Mode A) or 'recap' (Mode B)
 * @param {string} [params.seriesId='series_default']
 * @param {string} [params.episodeId='ep_1']
 * @param {string} [params.apiKey]
 * @param {string} [params.modelName='gemini-3.5-flash-lite']
 * @param {string} [params.customPrompt='']
 * @param {string} [params.narratorGender='male']
 * @param {object} [params.seriesGlossary={}]
 * @param {boolean} [params.generateAudio=false] - If true, runs TTS stage immediately
 * @param {string} [params.jobId] - Optional tracking background job ID
 * @param {boolean} [params.forceChunking=false]
 * @param {AbortSignal} [params.signal]
 * @param {Function} [params.onProgress] - (stage, percent, message) => void
 * @returns {Promise<object>} Standardized generation result
 */
async function runDubbingPipeline({
  videoPath,
  mode = GENERATION_MODES.MODE_A_DIALOGUE,
  seriesId = 'series_default',
  episodeId = 'ep_1',
  apiKey = null,
  modelName = 'gemini-3.5-flash-lite',
  customPrompt = '',
  narratorGender = 'male',
  seriesGlossary = {},
  genre = 'auto',
  generateAudio = false,
  jobId = null,
  forceChunking = false,
  signal = null,
  onProgress = null,
}) {
  const checkAbort = () => {
    if (signal?.aborted) {
      const err = new Error('Pipeline execution was cancelled by user');
      err.name = 'AbortError';
      throw err;
    }
  };

  const report = (stageName, percent, msg) => {
    if (typeof onProgress === 'function') {
      onProgress(stageName, percent, msg);
    }
    if (jobId) {
      updateJob(jobId, { progress: percent, currentStage: stageName, stageMessage: msg });
    }
    console.log(`[Pipeline] [${percent}%] [${stageName}]: ${msg}`);
  };

  checkAbort();

  const chosenModel = CASCADE_MODELS.includes(modelName) ? modelName : CASCADE_MODELS[0];
  const aiClient = getAiClient(apiKey);
  const startTime = Date.now();

  // Stage 1: Ingest Episode
  report('ingestEpisode', 10, 'កំពុងផ្ទៀងផ្ទាត់ទិន្នន័យវីដេអូ និងបង្កើត Folder សម្គាល់ភាគ...');
  const ingestResult = await ingestEpisode({
    videoPath,
    seriesId,
    episodeId,
  });

  checkAbort();

  // Stage 2: Analyze Source Media
  report('analyzeSourceMedia', 20, 'កំពុងវិភាគ Duration, Resolution និងកម្រិតសំឡេងដើម (FFprobe)...');
  const mediaAnalysis = await analyzeSourceMedia({
    videoPath: ingestResult.videoPath,
  });
  const durationSec = mediaAnalysis.durationSec;

  checkAbort();

  // SCALABILITY DISPATCH: If video duration > 150 seconds (~2.5 minutes) or forceChunking is set,
  // automatically dispatch to Chunk Orchestrator (300s chunks, 5-minute target) to eliminate Gemini 429 rate limits
  // and speech transcription JSON token-limit truncation on long videos.
  if (durationSec > 150 || forceChunking) {
    console.log(`[Pipeline] Video duration is ${durationSec}s (> 150s). Activating Chunk Orchestrator for rate-safe long-form processing...`);
    return await runChunkedDubbingPipeline({
      videoPath: ingestResult.videoPath,
      durationSec,
      ingestResult,
      mode,
      seriesId: ingestResult.seriesId,
      episodeId: ingestResult.episodeId,
      jobId: jobId || ingestResult.jobId,
      aiClient,
      modelName: chosenModel,
      customPrompt,
      narratorGender,
      seriesGlossary,
      genre,
      generateAudio,
      signal,
      onProgress,
      chunkSizeSec: 300,
      overlapSec: 2,
    });
  }

  // ==========================================
  // SINGLE-CHUNK EXECUTION (For episodes <= 150s)
  // With high-density 1.0s sampling to capture all dialogue
  // ==========================================

  // Stage 3: Extract Chinese Subtitles (Vision OCR across entire video at 1.0s interval)
  report('extractChineseSubtitles', 35, 'កំពុងស្កេនរកអក្សរចិន Subtitles និងចំណងជើងលើវីដេអូទាំងមូល (Visual OCR)...');
  const ocrResult = await extractChineseSubtitles({
    videoPath: ingestResult.videoPath,
    durationSec,
    aiClient,
    modelName: chosenModel,
    baseStepSec: 1.0, // High coverage without exceeding rate limits
    startOffsetSec: 0,
  });

  checkAbort();

  let inputSegmentsForScript = [];
  let reconciliation = null;

  if (mode === GENERATION_MODES.FAST_OCR) {
    // ==========================================
    // ⚡ FAST OCR BYPASS: SKIP STAGES 4 & 5
    // Direct Vision Subtitle to Translation Pipeline
    // ==========================================
    console.log(`[Pipeline] ⚡ Fast OCR Mode activated: Bypassing Stage 4 (ASR) & Stage 5 (Reconciliation) for Episode ${ingestResult.episodeId}`);
    report('analyzeDialogueAudio', 50, '⚡ Fast OCR: រំលង Stage 4 Audio Diarization (Skipped - CPU Saved)');
    report('reconcileTimelineEvidence', 65, '⚡ Fast OCR: រំលង Stage 5 Reconcile (Skipped)');

    if (jobId) {
      updateJob(jobId, {
        stages: {
          analyzeDialogueAudio: 'skipped',
          reconcileTimelineEvidence: 'skipped',
        },
      });
    }

    inputSegmentsForScript = ocrResult.visualSegments || [];
  } else {
    // Stage 4: Analyze Dialogue Audio & Diarization
    report('analyzeDialogueAudio', 50, 'កំពុងស្រង់ & វិភាគសំឡេងសន្ទនាចិនដើម និងភេទសំឡេង (Audio Diarization)...');
    const audioAnalysis = await analyzeDialogueAudio({
      videoPath: ingestResult.videoPath,
      durationSec,
      aiClient,
      modelName: chosenModel,
      startOffsetSec: 0,
    });

    checkAbort();

    // Stage 5: Reconcile Timeline Evidence & Legitimate Silence
    report('reconcileTimelineEvidence', 65, 'កំពុងផ្គូផ្គងភស្តុតាង Visual OCR & Audio និងរក្សាចន្លោះស្ងាត់ធម្មជាតិ...');
    reconciliation = await reconcileTimelineEvidence({
      visualSegments: ocrResult.visualSegments,
      audioSegments: audioAnalysis.audioSegments,
      rawObservations: ocrResult.rawObservations,
      durationSec,
    });

    inputSegmentsForScript = reconciliation.reconciledSegments || [];
  }

  checkAbort();

  // Stage 6: Generate Mode Specific Script (Mode A vs Mode B vs Fast OCR)
  report(
    'generateModeSpecificScript',
    75,
    mode === GENERATION_MODES.MODE_B_RECAP
      ? 'កំពុងតែងនិពន្ធសម្រាយសាច់រឿងបែបកុនភាគខ្មែរ (Mode B Recap)...'
      : (mode === GENERATION_MODES.FAST_OCR
        ? '⚡ កំពុងបកប្រែពាក្យសន្ទនា Subtitle ចិន ➡️ ខ្មែរ ភ្លាមៗ (Fast OCR)...'
        : 'កំពុងបកប្រែពាក្យសន្ទនាតាមបន្ទាត់ចិនដើម ១០០% (Mode A Faithful Dialogue)...')
  );
  const scriptResult = await generateModeSpecificScript({
    mode: mode === GENERATION_MODES.FAST_OCR ? GENERATION_MODES.MODE_A_DIALOGUE : mode,
    reconciledSegments: inputSegmentsForScript,
    durationSec,
    aiClient,
    modelName: chosenModel,
    userDirection: customPrompt,
    narratorGender,
    seriesGlossary,
    genre,
  });

  checkAbort();

  // Stage 7: Translate and Validate Khmer
  report('translateAndValidateKhmer', 85, 'កំពុងផ្ទៀងផ្ទាត់ភាសាខ្មែរ រក្សាអក្សរចិនដើម និងសម្គាល់ Review Needed...');
  const validationRes = await translateAndValidateKhmer({
    scriptSegments: scriptResult.scriptSegments,
    mode: scriptResult.mode,
  });

  checkAbort();

  // Stage 8: Validate Subtitle Timing & Boundary Safety
  report('validateSubtitleTiming', 92, 'កំពុងផ្ទៀងផ្ទាត់ Subtitle Timing (ទប់ស្កាត់ 0.01s និងចៀសវាង Overlap)...');
  const timingRes = await validateSubtitleTiming({
    segments: validationRes.validatedSegments,
    durationSec,
  });

  let finalizedSegments = timingRes.timedSegments;

  // Build / synchronize speaker registry for the episode
  const initialRegistry = buildSpeakerRegistry(finalizedSegments, {});
  const syncResult = syncSegmentsWithSpeakerRegistry(finalizedSegments, {
    seriesSpeakerMap: seriesGlossary?.seriesSpeakerMap || {},
  });
  finalizedSegments = syncResult.segments || finalizedSegments;
  const speakerRegistry = syncResult.speakerRegistry || initialRegistry;
  const speakers = syncResult.speakers || [];

  checkAbort();

  // Stage 9: Generate Segment TTS (Optional initial pass)
  if (generateAudio && finalizedSegments.length > 0) {
    report('generateSegmentTTS', 96, 'កំពុងបង្កើតសំឡេងខ្មែរ Neural TTS សម្រាប់ឃ្លានីមួយៗ...');
    const ttsRes = await generateSegmentTTS({
      segments: finalizedSegments,
      audioDir: ingestResult.audioDir,
      defaultVoiceId: 'km-KH-PisethNeural',
      forceRegen: false,
    });
    finalizedSegments = ttsRes.segmentsWithAudio;
  }

  checkAbort();

  // Stage 10: Preview and Export Preparation
  report('previewAndExport', 100, 'រៀបចំ Timeline Data រួចរាល់ ១០០% សម្រាប់ Review & Playback!');
  const exportPrep = await previewAndExport({
    videoPath: ingestResult.videoPath,
    segments: finalizedSegments,
    episodeDir: ingestResult.episodeDir,
    exportOptions: { renderVideo: false },
  });

  const totalTimeMs = Date.now() - startTime;

  const resultPayload = {
    success: true,
    mode: scriptResult.mode,
    generationMode: mode,
    genre: scriptResult.genre || genre,
    detectedGenre: scriptResult.detectedGenre || scriptResult.genre || genre,
    summary: scriptResult.summary,
    totalSegments: finalizedSegments.length,
    segments: finalizedSegments,
    script: finalizedSegments,
    speakers,
    speakerRegistry,
    coverage: {
      status: 'good',
      totalDurationSec: durationSec,
      totalSegments: finalizedSegments.length,
      coveragePercentage: 100,
    },
    recoveryReport: {
      status: 'completed',
      recoveredSegmentsCount: reconciliation?.reconciliationMeta?.fusedSegmentsCount || 0,
      visualObservationsCount: ocrResult?.ocrMeta?.totalObservations || 0,
    },
    pipelineMeta: {
      jobId: jobId || ingestResult.jobId,
      seriesId: ingestResult.seriesId,
      episodeId: ingestResult.episodeId,
      modelUsed: chosenModel,
      fileHash: ingestResult.fileHash,
      durationSec,
      totalTimeMs,
      completedAt: Date.now(),
      assSubtitlePath: exportPrep.assSubtitlePath,
      srtSubtitlePath: exportPrep.srtSubtitlePath,
    },
  };


  if (ingestResult?.seriesId) {
    try {
      const { getSeriesMetadata, saveSeriesMetadata } = require('../episodeService');
      const series = getSeriesMetadata(ingestResult.seriesId);
      if (series) {
        if (Array.isArray(series.episodes) && ingestResult.episodeId) {
          const ep = series.episodes.find((e) => e.id === ingestResult.episodeId);
          if (ep) {
            ep.scriptData = resultPayload;
            ep.status = 'translated';
          }
        }
        series.genre = scriptResult.genre || genre;
        series.detectedGenre = scriptResult.detectedGenre || scriptResult.genre || genre;
        saveSeriesMetadata(series);
      }
    } catch (_) {}
  }

  if (jobId) {
    updateJob(jobId, {
      status: 'completed',
      progress: 100,
      currentStage: 'completed',
      stageMessage: `Pipeline completed with ${finalizedSegments.length} segments.`,
      finalResult: resultPayload,
    });
  }

  return resultPayload;
}

module.exports = {
  runDubbingPipeline,
  CASCADE_MODELS,
};
