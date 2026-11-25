const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { createSmartGenAIClient, extractAllGeminiKeys } = require('../geminiKeyManager');
const { DUBBING_CASCADE_MODELS, isUsableDubbingModel } = require('../geminiModelCatalog');
const { geminiQuotaTracker } = require('../geminiQuotaTracker');
const {
  PIPELINE_STAGES,
  PIPELINE_STATUS,
  GENERATION_MODES,
  computePipelineCompletenessReport,
  resolveOcrEngineMode,
} = require('./pipelineTypes');
const { ingestEpisode } = require('./stages/stage1_ingestEpisode');
const { analyzeSourceMedia } = require('./stages/stage2_analyzeSourceMedia');
const {
  extractChineseSubtitles,
  saveVerifiedChineseSrt,
  deduplicateFastOcrCues,
} = require('./stages/stage3_extractChineseSubtitles');
const { analyzeDialogueAudio, enrichCuesWithAcousticPitch } = require('./stages/stage4_analyzeDialogueAudio');
const { reconcileTimelineEvidence } = require('./stages/stage5_reconcileTimelineEvidence');
const { generateModeSpecificScript } = require('./stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('./stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('./stages/stage8_validateSubtitleTiming');
const { generateSegmentTTS } = require('./stages/stage9_generateSegmentTTS');
const { previewAndExport } = require('./stages/stage10_previewAndExport');
const { runChunkedDubbingPipeline } = require('./chunkOrchestrator');
const { createJob, updateJob } = require('./jobManager');
const { saveCheckpoint, generateVideoFingerprint } = require('./checkpointManager');
const { isNonChineseAsrHallucination } = require('../../utils/translationQuality');
const { buildSpeakerRegistry, syncSegmentsWithSpeakerRegistry } = require('../../models/speakerRegistry');
const { identifySpeakersForCues, buildVerifiedSeriesSpeakerMapPatch } = require('./speakerIdentificationService');

const CASCADE_MODELS = DUBBING_CASCADE_MODELS;

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
  modelName = null,
  customPrompt = '',
  narratorGender = 'male',
  seriesGlossary = {},
  genre = 'auto',
  generateAudio = false,
  jobId = null,
  forceChunking = false,
  force = false,
  forceRegen = false,
  ocrMode = null,
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

  const jobSeriesId = seriesId;
  const jobEpisodeId = episodeId;
  const cleanReqModel = String(modelName || '').trim();
  const hasExplicitModel = Boolean(cleanReqModel && cleanReqModel !== 'auto' && isUsableDubbingModel(cleanReqModel));
  const trackerSettings = geminiQuotaTracker.getSettings();
  const hasPinnedPreferred = Boolean(
    trackerSettings?.preferredModel &&
    trackerSettings.preferredModel !== 'auto' &&
    isUsableDubbingModel(trackerSettings.preferredModel)
  );
  const prioritizedPool = geminiQuotaTracker.prioritizeAvailableModels(
    CASCADE_MODELS,
    extractAllGeminiKeys(apiKey)
  );
  const chosenModel = hasExplicitModel
    ? cleanReqModel
    : hasPinnedPreferred
      ? trackerSettings.preferredModel
      : (prioritizedPool[0] || geminiQuotaTracker.getPreferredPrimaryModel(CASCADE_MODELS[0]));
  const aiClient = getAiClient(apiKey);
  const startTime = Date.now();
  let speakerIdentificationCalls = 0;
  let speakerIdentificationStats = null;

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
      jobSeriesId,
      jobEpisodeId,
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
      force: Boolean(force || forceRegen),
      forceRegen: Boolean(forceRegen),
      ocrMode,
    });
  }

  // ==========================================
  // SINGLE-CHUNK EXECUTION (For episodes <= 150s)
  // With high-density 1.0s sampling to capture all dialogue
  // ==========================================

  // Stage 3: Extract Chinese Subtitles (Hybrid RapidOCR-first + Gemini Vision verification)
  report('extractChineseSubtitles', 35, 'កំពុងស្កេនរកអក្សរចិន Subtitles និងចំណងជើងលើវីដេអូទាំងមូល (Visual OCR)...');
  const isFastOcr = mode === GENERATION_MODES.FAST_OCR;
  const resolvedOcrMode = resolveOcrEngineMode({ ocrMode });
  const ocrResult = await extractChineseSubtitles({
    videoPath: ingestResult.videoPath,
    durationSec,
    aiClient,
    modelName: chosenModel,
    baseStepSec: isFastOcr ? 1.0 : 1.0,
    startOffsetSec: 0,
    force: Boolean(force || forceRegen),
    signal,
    isFastOcrMode: isFastOcr,
    generationMode: mode,
    ocrMode: resolvedOcrMode,
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

    const detectedCuesCount = Array.isArray(ocrResult?.visualSegments) ? ocrResult.visualSegments.length : 0;
    inputSegmentsForScript = deduplicateFastOcrCues(ocrResult.visualSegments || [], narratorGender);
    const storedSegmentsCount = inputSegmentsForScript.length;

    // Step 1: Enrich Fast OCR cues with Acoustic F0 Pitch (takes ~0.15s)
    if (ingestResult?.videoPath && inputSegmentsForScript.length > 0) {
      try {
        await enrichCuesWithAcousticPitch(ingestResult.videoPath, inputSegmentsForScript, { signal });
        if (inputSegmentsForScript.length > 0 && mode !== GENERATION_MODES.MODE_B_RECAP) {
          const spkRes = await identifySpeakersForCues({
            cues: inputSegmentsForScript,
            videoPath: ingestResult.videoPath,
            apiKey,
            aiClient,
            modelName: chosenModel,
            mode,
            seriesSpeakerMap: seriesGlossary?.seriesSpeakerMap || {},
            castRegistry: seriesGlossary?.characters || [],
            narratorGender,
            signal,
            onLog: (msg) => report('analyzeDialogueAudio', 54, `[SpeakerID] ${msg}`),
          });
          if (Array.isArray(spkRes?.cues) && spkRes.cues.length === inputSegmentsForScript.length) {
            inputSegmentsForScript = spkRes.cues;
            speakerIdentificationCalls += Number(spkRes.geminiCallsCount || 0);
            speakerIdentificationStats = spkRes.stats || null;
          }
        }
        const maleCount = inputSegmentsForScript.filter((s) => s.acousticGender === 'male').length;
        const femaleCount = inputSegmentsForScript.filter((s) => s.acousticGender === 'female').length;
        const voicedCues = inputSegmentsForScript.filter((s) => s.acousticF0 > 0);
        const avgF0 = voicedCues.length > 0
          ? Math.round(voicedCues.reduce((acc, c) => acc + c.acousticF0, 0) / voicedCues.length)
          : 0;
        console.log(`[Pipeline] 🎙️ Fast OCR Acoustic F0 Pitch: Male=${maleCount} cues, Female=${femaleCount} cues (avg F0: ${avgF0}Hz)`);
      } catch (pitchErr) {
        console.warn('[Pipeline] Notice on acoustic pitch:', pitchErr.message);
      }
    }

    console.log(`[Pipeline] cues detected: ${detectedCuesCount} -> segments stored: ${storedSegmentsCount}`);
    if (detectedCuesCount !== storedSegmentsCount) {
      console.warn(`[Pipeline] ⚠️ WARNING: Fast OCR 1:1 rule mismatch! cues detected: ${detectedCuesCount} -> segments stored: ${storedSegmentsCount} (${detectedCuesCount} != ${storedSegmentsCount})`);
    }
  } else {
    // Stage 4: Analyze Dialogue Audio & Diarization
    report('analyzeDialogueAudio', 50, 'កំពុងស្រង់ & វិភាគសំឡេងសន្ទនាចិនដើម និងភេទសំឡេង (Audio Diarization)...');
    const audioAnalysis = await analyzeDialogueAudio({
      videoPath: ingestResult.videoPath,
      durationSec,
      aiClient,
      modelName: chosenModel,
      startOffsetSec: 0,
      force: Boolean(force || forceRegen),
      signal,
    });

    const engineNotice = audioAnalysis?.audioMeta?.asrEngineUsed || 'unknown';
    const wallSec = audioAnalysis?.audioMeta?.wallTimeMs
      ? ` (${(audioAnalysis.audioMeta.wallTimeMs / 1000).toFixed(1)}s)`
      : '';
    console.log(`[Pipeline] 🎙️ ASR engine: ${engineNotice}${wallSec}`);
    report('analyzeDialogueAudio', 58, `ASR engine: ${engineNotice}${wallSec} (${audioAnalysis?.audioSegments?.length || 0} segments)`);

    checkAbort();

    // Stage 5: Reconcile Timeline Evidence & Legitimate Silence
    report('reconcileTimelineEvidence', 65, 'កំពុងផ្គូផ្គងភស្តុតាង Visual OCR & Audio និងរក្សាចន្លោះស្ងាត់ធម្មជាតិ...');
    reconciliation = await reconcileTimelineEvidence({
      visualSegments: ocrResult.visualSegments,
      audioSegments: audioAnalysis.audioSegments,
      rawObservations: ocrResult.rawObservations,
      durationSec,
    });

    inputSegmentsForScript = (reconciliation.reconciledSegments || []).filter(
      (seg) => !isNonChineseAsrHallucination(seg)
    );
    if (inputSegmentsForScript.length > 0 && mode !== GENERATION_MODES.MODE_B_RECAP) {
      try {
        await enrichCuesWithAcousticPitch(ingestResult.videoPath, inputSegmentsForScript, { signal });
        const spkRes = await identifySpeakersForCues({
          cues: inputSegmentsForScript,
          videoPath: ingestResult.videoPath,
          apiKey,
          aiClient,
          modelName: chosenModel,
          mode,
          seriesSpeakerMap: seriesGlossary?.seriesSpeakerMap || {},
          castRegistry: seriesGlossary?.characters || [],
          narratorGender,
          signal,
          onLog: (msg) => report('reconcileTimelineEvidence', 68, `[SpeakerID] ${msg}`),
        });
        if (Array.isArray(spkRes?.cues) && spkRes.cues.length === inputSegmentsForScript.length) {
          inputSegmentsForScript = spkRes.cues;
          speakerIdentificationCalls += Number(spkRes.geminiCallsCount || 0);
          speakerIdentificationStats = spkRes.stats || null;
        }
      } catch (spkErr) {
        if (spkErr?.name === 'AbortError' || signal?.aborted) throw spkErr;
        console.warn('[Pipeline] Standard-mode speaker ID notice:', spkErr.message);
      }
    }
    console.log(`[Pipeline] cues detected: ${ocrResult.visualSegments?.length || 0} -> segments stored: ${inputSegmentsForScript.length} (Standard mode)`);
  }

  checkAbort();

  // Save verified Chinese subtitle checkpoint (.srt + .json) BEFORE Stage 6 translation
  let verifiedChineseSrtPath = null;
  if (ingestResult?.episodeDir && Array.isArray(inputSegmentsForScript) && inputSegmentsForScript.length > 0) {
    try {
      verifiedChineseSrtPath = saveVerifiedChineseSrt(
        inputSegmentsForScript,
        path.join(ingestResult.episodeDir, 'verified_chinese.srt')
      );
      fs.writeFileSync(
        path.join(ingestResult.episodeDir, 'verified_chinese_cues.json'),
        JSON.stringify({
          updatedAt: Date.now(),
          count: inputSegmentsForScript.length,
          cues: inputSegmentsForScript.map((c) => ({
            sourceCueId: c.sourceCueId || null,
            startSec: c.startSec,
            endSec: c.endSec,
            originalChineseText: c.originalChineseText || c.chineseText || c.textZh || '',
          })),
        }, null, 2),
        'utf8'
      );
    } catch (_) {}
  }

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
    generationMode: mode,
    reconciledSegments: inputSegmentsForScript,
    durationSec,
    aiClient,
    modelName: chosenModel,
    userDirection: customPrompt,
    narratorGender,
    seriesGlossary,
    seriesId: ingestResult?.seriesId,
    episodeId: ingestResult?.episodeId,
    genre,
    force,
    forceRegen,
    signal,
  });

  checkAbort();

  // Stage 7: Translate and Validate Khmer
  report('translateAndValidateKhmer', 85, 'កំពុងផ្ទៀងផ្ទាត់ភាសាខ្មែរ រក្សាអក្សរចិនដើម និងសម្គាល់ Review Needed...');
  const validationRes = await translateAndValidateKhmer({
    scriptSegments: scriptResult.scriptSegments,
    sourceCues: mode === GENERATION_MODES.MODE_B_RECAP ? null : inputSegmentsForScript,
    mode: scriptResult.mode,
  });

  checkAbort();

  // Stage 8: Validate Subtitle Timing & Boundary Safety
  report('validateSubtitleTiming', 92, 'កំពុងផ្ទៀងផ្ទាត់ Subtitle Timing (ទប់ស្កាត់ 0.01s និងចៀសវាង Overlap)...');
  const timingRes = await validateSubtitleTiming({
    segments: validationRes.validatedSegments,
    sourceCues: mode === GENERATION_MODES.MODE_B_RECAP ? null : inputSegmentsForScript,
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
  const updatedSeriesSpeakerMap = buildVerifiedSeriesSpeakerMapPatch(
    finalizedSegments,
    speakerRegistry,
    seriesGlossary?.seriesSpeakerMap || {}
  );

  checkAbort();

  // Stage 9: Generate Segment TTS (Optional initial pass)
  if (generateAudio && finalizedSegments.length > 0) {
    report('generateSegmentTTS', 96, 'កំពុងបង្កើតសំឡេងខ្មែរ Neural TTS សម្រាប់ឃ្លានីមួយៗ...');
    const ttsRes = await generateSegmentTTS({
      segments: finalizedSegments,
      audioDir: ingestResult.audioDir,
      defaultVoiceId: 'km-KH-PisethNeural',
      forceRegen: false,
      signal,
      aiClient,
      modelName: chosenModel,
    });
    finalizedSegments = ttsRes.segmentsWithAudio;
  }

  checkAbort();

  // Stage 10: Preview and Export Preparation
  report('previewAndExport', 99, 'រៀបចំ Timeline Data និងត្រៀមផ្ទៀងផ្ទាត់រក្សាទុកទិន្នន័យ...');
  const exportPrep = await previewAndExport({
    videoPath: ingestResult.videoPath,
    segments: finalizedSegments,
    episodeDir: ingestResult.episodeDir,
    exportOptions: { renderVideo: false },
  });

  const totalTimeMs = Date.now() - startTime;

  const ocrUsage = ocrResult?.ocrMeta?.usage || { requests: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  const transUsage = scriptResult?.usage || { requests: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  const combinedUsage = {
    ocrRequests: ocrUsage.requests || 0,
    ocrPromptTokens: ocrUsage.promptTokens || 0,
    ocrOutputTokens: ocrUsage.outputTokens || 0,
    ocrTotalTokens: ocrUsage.totalTokens || 0,
    translationRequests: transUsage.requests || 0,
    translationPromptTokens: transUsage.promptTokens || 0,
    translationOutputTokens: transUsage.outputTokens || 0,
    translationTotalTokens: transUsage.totalTokens || 0,
    speakerIdentificationRequests: speakerIdentificationCalls,
    totalRequests: (ocrUsage.requests || 0) + (transUsage.requests || 0) + speakerIdentificationCalls,
    totalPromptTokens: (ocrUsage.promptTokens || 0) + (transUsage.promptTokens || 0),
    totalOutputTokens: (ocrUsage.outputTokens || 0) + (transUsage.outputTokens || 0),
    totalTokens: (ocrUsage.totalTokens || 0) + (transUsage.totalTokens || 0),
  };

  const sourceCuesForCheck = mode === GENERATION_MODES.MODE_B_RECAP ? null : inputSegmentsForScript;
  const coverageReport = computePipelineCompletenessReport({
    durationSec,
    verifiedSourceCuesCount: inputSegmentsForScript.length,
    ocrTotalFrames: ocrResult?.ocrMeta?.performance?.candidateFramesCount || ocrResult?.ocrMeta?.totalFramesSampled || 0,
    ocrVerifiedFrames: ocrResult?.ocrMeta?.verifiedFramesCount || 0,
    ocrUnresolvedFrames: ocrResult?.ocrMeta?.unresolvedFramesCount || 0,
    finalizedSegments,
    sourceCues: sourceCuesForCheck,
    ocrEngineMode: ocrResult?.ocrMeta?.ocrEngineMode || resolvedOcrMode,
    usage: combinedUsage,
  });

  const isPipelineComplete = mode === GENERATION_MODES.MODE_B_RECAP
    ? ((coverageReport.ocrUnresolvedFramesCount || 0) === 0 && finalizedSegments.length > 0)
    : Boolean(coverageReport.oneToOneMappingValid);
  const pipelineFinalStatus = isPipelineComplete ? 'completed' : 'review_needed';

  const resultPayload = {
    success: isPipelineComplete,
    status: pipelineFinalStatus,
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
    seriesSpeakerMap: updatedSeriesSpeakerMap,
    ...(speakerIdentificationStats ? { speakerIdentificationStats } : {}),
    coverage: coverageReport,
    recoveryReport: {
      status: pipelineFinalStatus,
      recoveredSegmentsCount: reconciliation?.reconciliationMeta?.fusedSegmentsCount || 0,
      visualObservationsCount: ocrResult?.ocrMeta?.totalObservations || 0,
    },
    pipelineMeta: {
      jobId: jobId || ingestResult.jobId,
      seriesId: ingestResult.seriesId,
      episodeId: ingestResult.episodeId,
      modelUsed: chosenModel,
      ocrEngineMode: ocrResult?.ocrMeta?.ocrEngineMode || resolvedOcrMode,
      usage: combinedUsage,
      verifiedChineseSrtPath,
      fileHash: ingestResult.fileHash,
      durationSec,
      totalTimeMs,
      completedAt: Date.now(),
      assSubtitlePath: exportPrep.assSubtitlePath,
      srtSubtitlePath: exportPrep.srtSubtitlePath,
      ...(scriptResult.translationReport ? { translationReport: scriptResult.translationReport } : {}),
      ...(validationRes?.validationReport ? { validationReport: validationRes.validationReport } : {}),
    },
  };


  report('persistScript', 99, 'កំពុងរក្សាទុក & ផ្ទៀងផ្ទាត់ទិន្នន័យ Script ចូល series.json...');
  const resolvedSeriesId = ingestResult?.seriesId || jobSeriesId;
  const resolvedEpisodeId = ingestResult?.episodeId || jobEpisodeId;
  const { persistEpisodeScriptData } = require('../episodeService');
  const persistRes = await persistEpisodeScriptData({
    seriesId: resolvedSeriesId,
    episodeId: resolvedEpisodeId,
    expectedSeriesId: jobSeriesId,
    expectedEpisodeId: jobEpisodeId,
    scriptData: resultPayload,
    generationMode: mode,
    status: isPipelineComplete ? 'translated' : 'review_needed',
    seriesGenre: scriptResult.genre || genre,
    seriesDetectedGenre: scriptResult.detectedGenre || scriptResult.genre || genre,
    seriesSpeakerMap: updatedSeriesSpeakerMap,
    jobId: jobId || ingestResult?.jobId,
  });
  console.log(`[Pipeline] ✅ Persisted ${persistRes.savedCount} script segments atomically to series.json for ${persistRes.episodeId} (status=${pipelineFinalStatus})`);

  if (jobId) {
    updateJob(jobId, {
      status: pipelineFinalStatus,
      progress: isPipelineComplete ? 100 : 99,
      currentStage: pipelineFinalStatus,
      stageMessage: isPipelineComplete
        ? `Pipeline completed with ${finalizedSegments.length} segments.`
        : `Review needed: ${coverageReport.missingTranslationsCount || 0} missing/untranslated cue(s), ${coverageReport.ocrUnresolvedFramesCount || 0} unresolved OCR frame(s).`,
      finalResult: resultPayload,
    });
  }

  return resultPayload;
}

module.exports = {
  runDubbingPipeline,
  CASCADE_MODELS,
};
