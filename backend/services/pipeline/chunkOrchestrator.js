const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  GENERATION_MODES,
  computePipelineCompletenessReport,
  resolveOcrEngineMode,
} = require('./pipelineTypes');
const {
  extractChineseSubtitles,
  saveVerifiedChineseSrt,
  isExactChineseSubtitleMatch,
  areChineseTextsEquivalent,
  deduplicateFastOcrCues,
} = require('./stages/stage3_extractChineseSubtitles');
const { isCrossChunkOriginPair } = require('./stages/stage3VisionBatchRunner');
const { analyzeDialogueAudio, enrichCuesWithAcousticPitch } = require('./stages/stage4_analyzeDialogueAudio');
const { reconcileTimelineEvidence } = require('./stages/stage5_reconcileTimelineEvidence');
const { generateModeSpecificScript } = require('./stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('./stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('./stages/stage8_validateSubtitleTiming');
const { generateSegmentTTS } = require('./stages/stage9_generateSegmentTTS');
const { previewAndExport } = require('./stages/stage10_previewAndExport');
const { buildSpeakerRegistry, syncSegmentsWithSpeakerRegistry } = require('../../models/speakerRegistry');
const {
  identifySpeakersForCues,
  buildVerifiedSeriesSpeakerMapPatch,
  CHARACTER_RECOGNITION_VERSION,
  computeSeriesRegistryRevision,
} = require('./speakerIdentificationService');
const { updateChunk, updateJob, productionJobQueue } = require('./jobManager');
const { createAbortError } = require('../../utils/asyncSemaphore');
const { isNonChineseAsrHallucination } = require('../../utils/translationQuality');
const { DUBBING_CASCADE_MODELS, isUsableDubbingModel } = require('../geminiModelCatalog');
const { geminiQuotaTracker } = require('../geminiQuotaTracker');
const { extractAllGeminiKeys } = require('../geminiKeyManager');

/**
 * Generate logical chunk plan for long videos.
 * Defaults to 5-minute (300s) chunks with 2-second overlap.
 * 
 * @param {number} totalDurationSec
 * @param {number} [chunkSizeSec=300]
 * @param {number} [overlapSec=2]
 * @returns {Array<object>}
 */
function generateChunkPlan(totalDurationSec, chunkSizeSec = 300, overlapSec = 2) {
  const chunks = [];
  if (!totalDurationSec || totalDurationSec <= 0) return chunks;

  let currentStart = 0;
  let chunkIdx = 0;

  while (currentStart < totalDurationSec) {
    const rawEnd = currentStart + chunkSizeSec;
    // Tail absorption: absorb small leftover tails (< 15s) into the current chunk instead of orphan micro-chunks
    const remainingAfterRawEnd = totalDurationSec - rawEnd;
    const isLast = rawEnd >= totalDurationSec || remainingAfterRawEnd < 15;
    const effectiveEnd = isLast ? totalDurationSec : Math.min(totalDurationSec, rawEnd + overlapSec);
    const duration = parseFloat((effectiveEnd - currentStart).toFixed(2));

    chunks.push({
      chunkIndex: chunkIdx,
      chunkId: `chunk_${chunkIdx}_${Math.round(currentStart)}_${Math.round(effectiveEnd)}`,
      startSec: parseFloat(currentStart.toFixed(2)),
      endSec: parseFloat(effectiveEnd.toFixed(2)),
      durationSec: duration,
      isLast,
      status: 'pending',
    });

    if (isLast) break;
    currentStart = rawEnd;
    chunkIdx++;
  }

  return chunks;
}

/**
 * Reconcile and stitch segments across chunk boundaries without duplicate lines
 * or dropped dialogue.
 * 
 * @param {Array<object>} allChunkSegments
 * @returns {Array<object>}
 */
function stitchAndDeduplicateSegments(allChunkSegments = []) {
  const validSegments = Array.isArray(allChunkSegments)
    ? allChunkSegments.filter((seg) => !isNonChineseAsrHallucination(seg))
    : [];
  if (validSegments.length === 0) return [];

  // Sort globally by startSec
  const sorted = [...validSegments].sort((a, b) => a.startSec - b.startSec);
  const stitched = [];

  for (const seg of sorted) {
    if (stitched.length === 0) {
      stitched.push({ ...seg });
      continue;
    }

    const prev = stitched[stitched.length - 1];
    // Check overlap condition across chunk boundaries only:
    // Start times within 2.5s (or overlapping) and exact normalized Chinese text match
    const isTimeAdjacent = Math.abs(seg.startSec - prev.startSec) < 2.5 || (seg.startSec < prev.endSec + 0.25);
    const textA = seg.originalChineseText || seg.chineseText || '';
    const textB = prev.originalChineseText || prev.chineseText || '';
    const isTextMatch = isExactChineseSubtitleMatch(textA, textB);
    const sameChunkSourceIds = Boolean(prev.sourceCueId && seg.sourceCueId && prev.sourceCueId !== seg.sourceCueId && !isCrossChunkOriginPair(prev, seg));

    if (!sameChunkSourceIds && isTimeAdjacent && isTextMatch) {
      // Merge boundary segment without creating duplicate
      const mergedStart = Math.min(prev.startSec, seg.startSec);
      const mergedEnd = Math.max(prev.endSec, seg.endSec);
      prev.startSec = parseFloat(mergedStart.toFixed(2));
      prev.endSec = parseFloat(mergedEnd.toFixed(2));
      prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
      prev.sourceStartSec = prev.startSec;
      prev.sourceEndSec = prev.endSec;
      if (seg.evidenceSource === 'audio_and_ocr' || prev.evidenceSource === 'audio_and_ocr') {
        prev.evidenceSource = 'audio_and_ocr';
        prev.evidenceType = 'audio_and_ocr';
      }
      if (prev.voiceGender === 'male' && prev.genderConfidence < 0.6 && seg.genderConfidence >= 0.7) {
        prev.voiceGender = seg.voiceGender;
        prev.speakerGender = seg.speakerGender;
        prev.khmerVoiceId = seg.khmerVoiceId;
        prev.genderConfidence = seg.genderConfidence;
      }
      if (textA.length > textB.length) {
        prev.originalChineseText = textA;
        prev.chineseText = textA;
      }
      continue;
    }

    stitched.push({ ...seg });
  }

  // Renumber IDs sequentially
  return stitched.map((s, idx) => ({
    ...s,
    id: idx + 1,
    segmentId: idx + 1,
  }));
}

/**
 * Executes Chunk-Based AI Dubbing Pipeline for long-form media (up to 1-2 hours)
 * Processes 5-minute chunks in sequence, persists chunk results for resumption,
 * and stitches timeline globally.
 * 
 * @param {object} params
 * @returns {Promise<object>} Standardized pipeline output
 */
async function runChunkedDubbingPipeline({
  videoPath,
  durationSec,
  ingestResult,
  mode = GENERATION_MODES.MODE_A_DIALOGUE,
  seriesId = 'series_default',
  episodeId = 'ep_1',
  jobSeriesId = null,
  jobEpisodeId = null,
  jobId,
  aiClient,
  modelName = null,
  customPrompt = '',
  narratorGender = 'male',
  seriesGlossary = {},
  genre = 'auto',
  generateAudio = false,
  signal = null,
  onProgress = null,
  chunkSizeSec = 300,
  overlapSec = 2,
  force = false,
  forceRegen = false,
  ocrMode = null,
}) {
  const resolvedOcrMode = resolveOcrEngineMode({ ocrMode });
  const cleanRequestedModel = String(modelName || '').trim();
  const effectiveModelName = (cleanRequestedModel && cleanRequestedModel !== 'auto' && isUsableDubbingModel(cleanRequestedModel))
    ? cleanRequestedModel
    : geminiQuotaTracker.getPreferredPrimaryModel(DUBBING_CASCADE_MODELS[0]);
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
    console.log(`[ChunkOrchestrator] [${percent}%] [${stageName}]: ${msg}`);
  };

  const chunks = generateChunkPlan(durationSec, chunkSizeSec, overlapSec);
  console.log(`[ChunkOrchestrator] Generated ${chunks.length} chunks for ${durationSec}s video (chunkSize=${chunkSizeSec}s, overlap=${overlapSec}s)`);


  if (jobId) {
    updateJob(jobId, {
      status: 'running',
      chunks: chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        chunkId: c.chunkId,
        startSec: c.startSec,
        endSec: c.endSec,
        status: 'pending',
      })),
    });
  }

  const chunkCacheDir = path.resolve(__dirname, '../../uploads/cache/chunks');
  if (!fs.existsSync(chunkCacheDir)) {
    fs.mkdirSync(chunkCacheDir, { recursive: true });
  }

  const allChunkSegments = [];
  const effectiveSeriesId = ingestResult?.seriesId || seriesId || 'series_default';
  const effectiveEpisodeId = ingestResult?.episodeId || episodeId || 'ep_1';
  let runningSeriesSpeakerMap = { ...(seriesGlossary?.seriesSpeakerMap || {}) };
  let speakerIdentificationCalls = 0;
  let speakerIdentificationStats = null;
  const pipelineStartTime = Date.now();
  const pipelineStageDurations = {
    ocrMs: 0,
    asrMs: 0,
    reconcileMs: 0,
    stage6ScriptMs: 0,
    stage7ValidationMs: 0,
    stage8TimingMs: 0,
    ffmpegPrepassMs: 0,
    f0Ms: 0,
  };

  const allAvailableKeys = extractAllGeminiKeys();
  const healthyKeyCount = Array.isArray(allAvailableKeys) && allAvailableKeys.length > 0
    ? allAvailableKeys.length
    : (aiClient?.pool?.keys?.length || 4);
  const CHUNK_CONCURRENCY = (mode === GENERATION_MODES.FAST_OCR && healthyKeyCount >= 4 && chunks.length > 1) ? 2 : 1;
  if (CHUNK_CONCURRENCY > 1) {
    console.log(`[ChunkOrchestrator] 🚀 Turbo Multi-Key: Running ${chunks.length} chunks with CHUNK_CONCURRENCY = ${CHUNK_CONCURRENCY} across ${healthyKeyCount} Gemini keys`);
  }

  async function processSingleChunk(chunk, cIdx) {
    checkAbort();
    const chunkPercent = Math.round(10 + (cIdx / chunks.length) * 60);

    report(
      'chunkProcessing',
      chunkPercent,
      `ដំណើរការ Chunk ទី ${cIdx + 1}/${chunks.length} (${chunk.startSec}s -> ${chunk.endSec}s)...`
    );

    if (jobId) {
      updateChunk(jobId, chunk.chunkIndex, {
        status: 'running',
        startedAt: Date.now(),
      });
    }

    let videoSignature = '';
    try {
      if (fs.existsSync(videoPath)) {
        const stat = fs.statSync(videoPath);
        videoSignature = `_${stat.size}_${Math.round(stat.mtimeMs)}`;
      }
    } catch (_) {}

    const chunkRegistryRevision = computeSeriesRegistryRevision(
      { ...(seriesGlossary?.seriesSpeakerMap || {}), ...runningSeriesSpeakerMap },
      seriesGlossary?.characters || []
    );
    const chunkHash = crypto.createHash('md5')
      .update(`${effectiveSeriesId}::${effectiveEpisodeId}::${videoPath}${videoSignature}_${chunk.startSec}_${chunk.endSec}_${effectiveModelName}_${mode}_${resolvedOcrMode}_${CHARACTER_RECOGNITION_VERSION}_${chunkRegistryRevision}`)
      .digest('hex');
    const chunkFile = path.join(chunkCacheDir, `chunk_${chunkHash}.json`);

    let chunkSegments = [];
    let isChunkReused = false;
    let visualOnlyCount = 0;
    let fusedCount = 0;
    let ocrPerf = null;
    let chunkOcrDurationMs = 0;
    let chunkAsrDurationMs = 0;
    let chunkRecDurationMs = 0;
    let chunkF0DurationMs = 0;

    if (force && fs.existsSync(chunkFile)) {
      try { fs.unlinkSync(chunkFile); } catch (_) {}
    }

    if (!force && fs.existsSync(chunkFile)) {
      try {
        const cachedChunk = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
        const hasUnresolved = Boolean(
          cachedChunk.hasUnresolvedFrames ||
          cachedChunk.isComplete === false ||
          cachedChunk.status === 'review_needed'
        );
        const cacheMetadataMatches = Boolean(
          cachedChunk.seriesId === effectiveSeriesId &&
          cachedChunk.episodeId === effectiveEpisodeId &&
          cachedChunk.videoSignature === videoSignature &&
          cachedChunk.characterRecognitionVersion === CHARACTER_RECOGNITION_VERSION &&
          cachedChunk.registryRevision === chunkRegistryRevision
        );
        if (!hasUnresolved && cacheMetadataMatches && Array.isArray(cachedChunk.segments) && cachedChunk.segments.length > 0) {
          const beforeCacheCount = cachedChunk.segments.length;
          chunkSegments = cachedChunk.segments.filter((seg) => !isNonChineseAsrHallucination(seg));
          const droppedCacheJunk = beforeCacheCount - chunkSegments.length;
          visualOnlyCount = cachedChunk.visualOnlyCount || 0;
          fusedCount = cachedChunk.fusedCount || 0;
          ocrPerf = cachedChunk.ocrPerformance || null;
          isChunkReused = true;
          console.log(
            `[ChunkOrchestrator] ⚡ Resuming Chunk ${cIdx + 1}/${chunks.length}: Loaded ${chunkSegments.length} validated segments from disk cache${droppedCacheJunk > 0 ? ` (dropped ${droppedCacheJunk} non-Chinese ASR junk)` : ''}`
          );
        } else if (hasUnresolved) {
          console.warn(`[ChunkOrchestrator] ⚠️ Chunk cache at ${path.basename(chunkFile)} contains unresolved frames or was not completed. Re-running chunk.`);
        } else if (!cacheMetadataMatches) {
          console.warn(`[ChunkOrchestrator] ⚠️ Chunk cache at ${path.basename(chunkFile)} failed series/episode/recognition/registry validation. Re-running chunk.`);
        }
      } catch (_) {}
    }

    if (!isChunkReused) {
      try {
        // 1. Stage 3 Visual OCR for this chunk (1.8s step = ~5 API calls per chunk, perfectly safe for 15 RPM)
        report(
          'chunkOCR',
          Math.min(70, Math.round(chunkPercent + (1 / chunks.length) * 15)),
          `Chunk ${cIdx + 1}/${chunks.length}: កំពុងស្កេនអក្សរចិនលើរូបភាព (Vision OCR)...`
        );
        const chunkOcrStart = Date.now();
        const isFastOcr = mode === GENERATION_MODES.FAST_OCR;
        const ocrResult = await extractChineseSubtitles({
          videoPath,
          durationSec: chunk.durationSec,
          aiClient,
          modelName: effectiveModelName,
          baseStepSec: isFastOcr ? 1.0 : 1.0,
          startOffsetSec: chunk.startSec,
          force,
          signal,
          isFastOcrMode: isFastOcr,
          generationMode: mode,
          ocrMode: resolvedOcrMode,
          onProgress: (p) => {
            const batchPercent = p.totalBatches > 0
              ? Math.round(chunkPercent + (p.completedBatches / p.totalBatches) * ((1 / chunks.length) * 15))
              : chunkPercent;
            const statusText = p.statusMessage || `ស្កេន OCR ${p.completedBatches}/${p.totalBatches} batches (${p.completedFrames}/${p.totalFrames} frames) [Model: ${p.modelUsed || effectiveModelName}]${p.retriesCount > 0 ? ` (Retries: ${p.retriesCount})` : ''}`;
            report(
              'chunkOCR',
              Math.min(70, batchPercent),
              `Chunk ${cIdx + 1}/${chunks.length}: ${statusText}`
            );
          },
        });
        chunkOcrDurationMs = Date.now() - chunkOcrStart;

        checkAbort();

        ocrPerf = ocrResult?.ocrMeta?.performance || {
          wallTimeMs: ocrResult?.ocrMeta?.wallTimeMs || 0,
          totalStage3Ms: ocrResult?.ocrMeta?.wallTimeMs || 0,
          ffmpegPrepassMs: 0,
          frameExtractionMs: 0,
          localOcrMs: 0,
          geminiVerificationMs: 0,
          apiTotalMs: 0,
          retrySleepMs: 0,
          tieBreakMs: 0,
          candidateFramesCount: ocrResult?.ocrMeta?.totalFramesSampled || 0,
          localOcrFramesCount: 0,
          localVerifiedCount: 0,
          geminiVerifiedCount: 0,
          geminiBatchCount: 0,
          geminiActualAttemptsCount: ocrResult?.ocrMeta?.apiCallsCount || 0,
          apiCallsCount: ocrResult?.ocrMeta?.apiCallsCount || 0,
          retriesCount: ocrResult?.ocrMeta?.retriesCount || 0,
          batchSplitsCount: ocrResult?.ocrMeta?.batchSplitsCount || 0,
          dedupedFramesCount: ocrResult?.ocrMeta?.dedupedFramesCount || 0,
          verifiedFramesCount: ocrResult?.ocrMeta?.verifiedFramesCount || 0,
          unresolvedFramesCount: ocrResult?.ocrMeta?.unresolvedFramesCount || 0,
          finalChineseCuesCount: ocrResult?.ocrMeta?.detectedSegmentsCount || 0,
        };

        console.log(`[ChunkOrchestrator] 📊 Chunk ${cIdx + 1}/${chunks.length} OCR Performance Metrics:`, {
          wallTimeMs: ocrPerf.wallTimeMs,
          localOcrMs: ocrPerf.localOcrMs,
          geminiVerificationMs: ocrPerf.geminiVerificationMs,
          ffmpegPrepassMs: ocrPerf.ffmpegPrepassMs,
          localVerifiedCount: ocrPerf.localVerifiedCount,
          geminiVerifiedCount: ocrPerf.geminiVerifiedCount,
          geminiBatchCount: ocrPerf.geminiBatchCount,
          apiCallsCount: ocrPerf.apiCallsCount,
          retriesCount: ocrPerf.retriesCount,
          batchSplitsCount: ocrPerf.batchSplitsCount,
          dedupedFramesCount: ocrPerf.dedupedFramesCount,
          verifiedFramesCount: ocrPerf.verifiedFramesCount,
        });

        // Validate OCR completeness: Do not allow incomplete OCR to silently trigger downstream stages
        const hasUnresolvedOcr = Boolean(
          ocrResult?.hasUnresolvedFrames ||
          ocrResult?.ocrMeta?.hasUnresolvedFrames ||
          ocrResult?.isComplete === false ||
          ocrResult?.ocrMeta?.isComplete === false ||
          (ocrResult?.ocrMeta?.unresolvedFramesCount > 0)
        );

        if (hasUnresolvedOcr) {
          const unresCount = ocrResult?.ocrMeta?.unresolvedFramesCount || ocrResult?.unresolvedFrames?.length || 0;
          console.warn(`[ChunkOrchestrator] ⚠️ Chunk ${cIdx + 1}/${chunks.length} had ${unresCount} unresolved OCR frame(s); proceeding with ${(ocrResult?.visualSegments || []).length} extracted subtitle cues.`);
        }

        const ocrCuesCount = Array.isArray(ocrResult?.visualSegments) ? ocrResult.visualSegments.length : 0;
        const chunkHasUnresolvedOcr = hasUnresolvedOcr;
        const needsSelectiveAsrFallback = mode === GENERATION_MODES.FAST_OCR && (ocrCuesCount === 0 || chunkHasUnresolvedOcr);

        if (mode === GENERATION_MODES.FAST_OCR && !needsSelectiveAsrFallback) {
          console.log(`[ChunkOrchestrator] ⚡ Fast OCR Mode: Skipping Stage 4 (ASR) & Stage 5 (Reconcile) for Chunk ${cIdx + 1}`);
          chunkSegments = deduplicateFastOcrCues(ocrResult.visualSegments || [], narratorGender);
          visualOnlyCount = chunkSegments.length;
          fusedCount = 0;

          // Step 1: Enrich Fast OCR cues with Acoustic F0 Pitch (takes ~0.15s)
          if (videoPath && chunkSegments.length > 0) {
            try {
              const f0Start = Date.now();
              await enrichCuesWithAcousticPitch(videoPath, chunkSegments, {
                startOffsetSec: chunk.startSec,
                durationSec: chunk.durationSec,
                signal,
              });
              if (chunkSegments.length > 0 && mode !== GENERATION_MODES.MODE_B_RECAP) {
                const spkRes = await identifySpeakersForCues({
                  cues: chunkSegments,
                  videoPath,
                  startOffsetSec: chunk.startSec,
                  durationSec: chunk.durationSec,
                  aiClient,
                  modelName: effectiveModelName,
                  mode,
                  seriesId: effectiveSeriesId,
                  episodeId: effectiveEpisodeId,
                  sourceMediaFingerprint: videoSignature,
                  seriesSpeakerMap: {
                    ...(seriesGlossary?.seriesSpeakerMap || {}),
                    ...runningSeriesSpeakerMap,
                  },
                  castRegistry: seriesGlossary?.characters || [],
                  narratorGender,
                  signal,
                });
                if (Array.isArray(spkRes?.cues) && spkRes.cues.length === chunkSegments.length) {
                  chunkSegments = spkRes.cues;
                  speakerIdentificationCalls += Number(spkRes.geminiCallsCount || 0);
                  speakerIdentificationStats = spkRes.stats || null;
                  runningSeriesSpeakerMap = buildVerifiedSeriesSpeakerMapPatch(
                    chunkSegments,
                    null,
                    runningSeriesSpeakerMap,
                    { seriesId: effectiveSeriesId }
                  );
                }
              }
              chunkF0DurationMs = Date.now() - f0Start;
              const maleCount = chunkSegments.filter((s) => s.acousticGender === 'male').length;
              const femaleCount = chunkSegments.filter((s) => s.acousticGender === 'female').length;
              const voicedCues = chunkSegments.filter((s) => s.acousticF0 > 0);
              const avgF0 = voicedCues.length > 0
                ? Math.round(voicedCues.reduce((acc, c) => acc + c.acousticF0, 0) / voicedCues.length)
                : 0;
              console.log(`[ChunkOrchestrator] 🎙️ Fast OCR Acoustic F0 Pitch: Male=${maleCount} cues, Female=${femaleCount} cues (avg F0: ${avgF0}Hz)`);
            } catch (pitchErr) {
              console.warn('[ChunkOrchestrator] Notice on acoustic pitch:', pitchErr.message);
            }
          }

          console.log(`[ChunkOrchestrator] Chunk ${cIdx + 1} cues detected: ${ocrCuesCount} -> segments stored: ${chunkSegments.length}`);
          if (ocrCuesCount !== chunkSegments.length) {
            console.warn(`[ChunkOrchestrator] ⚠️ WARNING: Fast OCR 1:1 rule mismatch! cues detected: ${ocrCuesCount} -> segments stored: ${chunkSegments.length} (${ocrCuesCount} != ${chunkSegments.length})`);
          }
        } else {
          if (needsSelectiveAsrFallback) {
            console.warn(`[ChunkOrchestrator] 🎙️ Fast OCR selective ASR fallback triggered for Chunk ${cIdx + 1} (visualCues=${ocrCuesCount}, unresolvedFrames=${ocrResult?.ocrMeta?.unresolvedFramesCount || 0}).`);
          }
          // 2. Stage 4 Audio Diarization for this chunk
          report(
            'chunkASR',
            Math.min(70, Math.round(chunkPercent + (1 / chunks.length) * 35)),
            `Chunk ${cIdx + 1}/${chunks.length}: កំពុងស្ដាប់សំឡេងតួអង្គចិន (ASR Audio Diarization)...`
          );
          const asrStart = Date.now();
          const audioAnalysis = await analyzeDialogueAudio({
            videoPath,
            durationSec: chunk.durationSec,
            aiClient,
            modelName: effectiveModelName,
            startOffsetSec: chunk.startSec,
            force,
            signal,
          });
          chunkAsrDurationMs = Date.now() - asrStart;

          const chunkEngine = audioAnalysis?.audioMeta?.asrEngineUsed || 'unknown';
          const chunkWallSec = audioAnalysis?.audioMeta?.wallTimeMs
            ? ` (${(audioAnalysis.audioMeta.wallTimeMs / 1000).toFixed(1)}s)`
            : '';
          console.log(`[ChunkOrchestrator] 🎙️ Chunk ${cIdx + 1} ASR engine: ${chunkEngine}${chunkWallSec}`);

          checkAbort();

          // 3. Stage 5 Reconcile chunk visual & audio
          report(
            'chunkReconcile',
            Math.min(70, Math.round(chunkPercent + (1 / chunks.length) * 50)),
            `Chunk ${cIdx + 1}/${chunks.length}: ផ្គូផ្គងអក្សរ និងសំឡេង (Reconciling Timeline)...`
          );
          const recStart = Date.now();
          const chunkReconciliation = await reconcileTimelineEvidence({
            visualSegments: ocrResult.visualSegments,
            audioSegments: audioAnalysis.audioSegments,
            rawObservations: ocrResult.rawObservations,
            durationSec: chunk.durationSec,
          });
          chunkRecDurationMs = Date.now() - recStart;

          const rawReconciled = chunkReconciliation.reconciledSegments || [];
          chunkSegments = rawReconciled.filter((seg) => !isNonChineseAsrHallucination(seg));
          if (chunkSegments.length !== rawReconciled.length) {
            console.log(`[ChunkOrchestrator] 🧹 Dropped ${rawReconciled.length - chunkSegments.length} non-Chinese ASR hallucination(s) from Chunk ${cIdx + 1}.`);
          }
          visualOnlyCount = chunkReconciliation.reconciliationMeta?.visualOnlyCount || 0;
          fusedCount = chunkReconciliation.reconciliationMeta?.fusedSegmentsCount || 0;
          if (videoPath && chunkSegments.length > 0 && mode !== GENERATION_MODES.MODE_B_RECAP) {
            try {
              await enrichCuesWithAcousticPitch(videoPath, chunkSegments, {
                startOffsetSec: chunk.startSec,
                durationSec: chunk.durationSec,
                signal,
              });
              const spkRes = await identifySpeakersForCues({
                cues: chunkSegments,
                videoPath,
                startOffsetSec: chunk.startSec,
                durationSec: chunk.durationSec,
                aiClient,
                modelName: effectiveModelName,
                mode,
                seriesId: effectiveSeriesId,
                episodeId: effectiveEpisodeId,
                sourceMediaFingerprint: videoSignature,
                seriesSpeakerMap: {
                  ...(seriesGlossary?.seriesSpeakerMap || {}),
                  ...runningSeriesSpeakerMap,
                },
                castRegistry: seriesGlossary?.characters || [],
                narratorGender,
                signal,
              });
              if (Array.isArray(spkRes?.cues) && spkRes.cues.length === chunkSegments.length) {
                chunkSegments = spkRes.cues;
                speakerIdentificationCalls += Number(spkRes.geminiCallsCount || 0);
                speakerIdentificationStats = spkRes.stats || null;
                runningSeriesSpeakerMap = buildVerifiedSeriesSpeakerMapPatch(
                  chunkSegments,
                  null,
                  runningSeriesSpeakerMap,
                  { seriesId: effectiveSeriesId }
                );
              }
            } catch (spkErr) {
              if (spkErr?.name === 'AbortError' || signal?.aborted) throw spkErr;
              console.warn(`[ChunkOrchestrator] Standard-mode speaker ID notice (Chunk ${cIdx + 1}):`, spkErr.message);
            }
          }
          console.log(`[ChunkOrchestrator] Chunk ${cIdx + 1} cues detected: ${ocrCuesCount} -> segments stored: ${chunkSegments.length} (Standard mode)`);
        }

        // Persist validated chunk result to disk for instant resumption
        try {
          fs.writeFileSync(chunkFile, JSON.stringify({
            chunkIndex: chunk.chunkIndex,
            startSec: chunk.startSec,
            endSec: chunk.endSec,
            seriesId: effectiveSeriesId,
            episodeId: effectiveEpisodeId,
            characterRecognitionVersion: CHARACTER_RECOGNITION_VERSION,
            registryRevision: chunkRegistryRevision,
            segments: chunkSegments,
            visualOnlyCount,
            fusedCount,
            ocrPerformance: ocrPerf,
            videoSignature,
            isComplete: !chunkHasUnresolvedOcr,
            hasUnresolvedFrames: chunkHasUnresolvedOcr,
            status: chunkHasUnresolvedOcr ? 'review_needed' : 'completed',
            savedAt: Date.now(),
          }, null, 2), 'utf8');
        } catch (_) {}
      } catch (chunkErr) {
        if (chunkErr?.name === 'AbortError' || signal?.aborted) {
          console.warn(`[ChunkOrchestrator] 🛑 Chunk ${cIdx + 1}/${chunks.length} aborted by user.`);
          throw chunkErr?.name === 'AbortError' ? chunkErr : createAbortError('Pipeline execution was cancelled by user');
        }
        if (chunkErr?.code === 'OCR_REVIEW_NEEDED' || chunkErr?.reviewNeeded) {
          console.warn(`[ChunkOrchestrator] ⚠️ Chunk ${cIdx + 1}/${chunks.length} entered review_needed state without silent completion.`);
          throw chunkErr;
        }
        console.error(`[ChunkOrchestrator] ❌ Chunk ${cIdx + 1}/${chunks.length} failed: ${chunkErr.message}`);
        if (jobId) {
          const managedByQueue = Boolean(productionJobQueue?.activeExecutions?.has(jobId));
          updateChunk(jobId, chunk.chunkIndex, {
            status: 'failed',
            error: chunkErr.message,
            failedAt: Date.now(),
          });
          updateJob(jobId, {
            ...(managedByQueue ? {} : { status: 'failed' }),
            error: `Chunk ${cIdx + 1}/${chunks.length} failed: ${chunkErr.message}`,
            failedChunkIndex: chunk.chunkIndex,
          });
        }
        throw new Error(`[ChunkOrchestrator] Chunk ${cIdx + 1}/${chunks.length} (start: ${chunk.startSec}s) failed: ${chunkErr.message}`);
      }
    }

    if (jobId) {
      updateChunk(jobId, chunk.chunkIndex, {
        status: 'completed',
        completedAt: Date.now(),
        segmentsCount: chunkSegments.length,
        visualOnlyCount,
        fusedCount,
        ocrPerformance: ocrPerf,
      });
    }

    report(
      'chunkCompleted',
      Math.min(70, Math.round(10 + ((cIdx + 1) / chunks.length) * 60)),
      `✅ Chunk ${cIdx + 1}/${chunks.length} រួចរាល់ (${chunkSegments.length} បន្ទាត់សន្ទនា)`
    );

    console.log(`[ChunkOrchestrator] Chunk ${cIdx + 1}/${chunks.length} completed with ${chunkSegments.length} reconciled segments.`);

    return {
      chunkSegments,
      visualOnlyCount,
      fusedCount,
      ocrPerf,
      chunkOcrDurationMs,
      chunkAsrDurationMs,
      chunkRecDurationMs,
      chunkF0DurationMs,
    };
  }

  // Process chunks with dynamic CHUNK_CONCURRENCY
  const chunkResults = Array.from({ length: chunks.length });
  for (let cStart = 0; cStart < chunks.length; cStart += CHUNK_CONCURRENCY) {
    checkAbort();
    const chunkBatch = chunks.slice(cStart, cStart + CHUNK_CONCURRENCY);
    const batchResults = await Promise.all(
      chunkBatch.map((chunk, relIdx) => processSingleChunk(chunk, cStart + relIdx))
    );
    batchResults.forEach((res, relIdx) => {
      chunkResults[cStart + relIdx] = res;
      pipelineStageDurations.ocrMs += (res.chunkOcrDurationMs || 0);
      pipelineStageDurations.asrMs += (res.chunkAsrDurationMs || 0);
      pipelineStageDurations.reconcileMs += (res.chunkRecDurationMs || 0);
      pipelineStageDurations.f0Ms = (pipelineStageDurations.f0Ms || 0) + (res.chunkF0DurationMs || 0);
      pipelineStageDurations.ffmpegPrepassMs = (pipelineStageDurations.ffmpegPrepassMs || 0) +
        (res.ocrPerf?.ffmpegPrepassMs || res.ocrPerf?.frameExtractionMs || 0);
    });
  }

  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const res = chunkResults[cIdx];
    if (res?.chunkSegments) {
      allChunkSegments.push(...res.chunkSegments);
    }
  }

  checkAbort();

  // 4. Global Stitching and Boundary Deduplication
  report('stitching', 72, 'កំពុងផ្គុំ និងផ្ទៀងផ្ទាត់ព្រំប្រទល់ Chunk ទាំងអស់ (Global Timeline Stitching)...');
  const stitchedSegments = mode === GENERATION_MODES.FAST_OCR
    ? deduplicateFastOcrCues(allChunkSegments, narratorGender)
    : stitchAndDeduplicateSegments(allChunkSegments);
  console.log(`[ChunkOrchestrator] Global stitching complete: ${stitchedSegments.length} total unified segments.`);

  // Save verified Chinese subtitle checkpoint (.srt + .json) BEFORE Stage 6 translation
  let verifiedChineseSrtPath = null;
  if (ingestResult?.episodeDir && Array.isArray(stitchedSegments) && stitchedSegments.length > 0) {
    try {
      verifiedChineseSrtPath = saveVerifiedChineseSrt(
        stitchedSegments,
        path.join(ingestResult.episodeDir, 'verified_chinese.srt')
      );
      fs.writeFileSync(
        path.join(ingestResult.episodeDir, 'verified_chinese_cues.json'),
        JSON.stringify({
          updatedAt: Date.now(),
          count: stitchedSegments.length,
          cues: stitchedSegments.map((c) => ({
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

  // 5. Stage 6: Mode-Specific Script Generation
  report(
    'generateModeSpecificScript',
    78,
    mode === GENERATION_MODES.MODE_B_RECAP
      ? 'កំពុងតែងនិពន្ធសម្រាយសាច់រឿងបែបកុនភាគខ្មែរ (Mode B Recap)...'
      : (mode === GENERATION_MODES.FAST_OCR
        ? '⚡ កំពុងបកប្រែពាក្យសន្ទនា Subtitle ចិន ➡️ ខ្មែរ ភ្លាមៗ (Fast OCR)...'
        : 'កំពុងបកប្រែពាក្យសន្ទនាតាមបន្ទាត់ចិនដើម ១០០% (Mode A Faithful Dialogue)...')
  );
  const stage6Start = Date.now();
  const scriptResult = await generateModeSpecificScript({
    mode: mode === GENERATION_MODES.FAST_OCR ? GENERATION_MODES.MODE_A_DIALOGUE : mode,
    generationMode: mode,
    reconciledSegments: stitchedSegments,
    durationSec,
    aiClient,
    modelName: effectiveModelName,
    userDirection: customPrompt,
    narratorGender,
    seriesGlossary,
    seriesId: ingestResult?.seriesId,
    episodeId: ingestResult?.episodeId,
    genre,
    force: Boolean(force || forceRegen),
    forceRegen: Boolean(forceRegen),
    signal,
  });
  pipelineStageDurations.stage6ScriptMs = Date.now() - stage6Start;
  console.log(`[ChunkOrchestrator] ⏱️ Stage 6 Script Translation Duration: ${(pipelineStageDurations.stage6ScriptMs / 1000).toFixed(1)}s for ${stitchedSegments.length} segments.`);

  if (ingestResult?.seriesId) {
    try {
      const { withSeriesMetadataLock, updateSeriesMetadata } = require('../episodeService');
      await withSeriesMetadataLock(ingestResult.seriesId, () => {
        updateSeriesMetadata(ingestResult.seriesId, (series) => {
          if (!series) return false;
          series.genre = scriptResult.genre || genre;
          series.detectedGenre = scriptResult.detectedGenre || scriptResult.genre || genre;
          return true;
        });
      });
    } catch (_) {}
  }

  checkAbort();

  // 6. Stage 7: Translate and Validate Khmer
  report('translateAndValidateKhmer', 85, 'កំពុងផ្ទៀងផ្ទាត់ភាសាខ្មែរ រក្សាអក្សរចិនដើម និងសម្គាល់ Review Needed...');
  const stage7Start = Date.now();
  const validationRes = await translateAndValidateKhmer({
    scriptSegments: scriptResult.scriptSegments,
    sourceCues: mode === GENERATION_MODES.MODE_B_RECAP ? null : stitchedSegments,
    mode: scriptResult.mode,
  });
  pipelineStageDurations.stage7ValidationMs = Date.now() - stage7Start;

  checkAbort();

  // 7. Stage 8: Validate Subtitle Timing
  report('validateSubtitleTiming', 92, 'កំពុងផ្ទៀងផ្ទាត់ Subtitle Timing (ទប់ស្កាត់ 0.01s និងចៀសវាង Overlap)...');
  const stage8Start = Date.now();
  const timingRes = await validateSubtitleTiming({
    segments: validationRes.validatedSegments,
    sourceCues: mode === GENERATION_MODES.MODE_B_RECAP ? null : stitchedSegments,
    durationSec,
  });
  pipelineStageDurations.stage8TimingMs = Date.now() - stage8Start;

  let finalizedSegments = timingRes.timedSegments;

  // Speaker Registry Sync — single canonical pass (merge series memory + in-run chunk discoveries)
  const effectiveSeriesMapForSync = {
    ...(seriesGlossary?.seriesSpeakerMap || {}),
    ...(runningSeriesSpeakerMap || {}),
  };
  const syncResult = syncSegmentsWithSpeakerRegistry(finalizedSegments, {
    seriesSpeakerMap: effectiveSeriesMapForSync,
  });
  finalizedSegments = syncResult.segments || finalizedSegments;
  const speakerRegistry = syncResult.speakerRegistry || {};
  const speakers = syncResult.speakers || [];
  const updatedSeriesSpeakerMap = buildVerifiedSeriesSpeakerMapPatch(
    finalizedSegments,
    speakerRegistry,
    effectiveSeriesMapForSync,
    { seriesId: effectiveSeriesId }
  );

  checkAbort();

  // 8. Stage 9: Generate Segment TTS (Optional initial pass)
  let ttsReport = null;
  if (generateAudio && finalizedSegments.length > 0) {
    report('generateSegmentTTS', 96, 'កំពុងបង្កើតសំឡេងខ្មែរ Neural TTS សម្រាប់ឃ្លានីមួយៗ...');
    const ttsRes = await generateSegmentTTS({
      segments: finalizedSegments,
      audioDir: ingestResult.audioDir,
      defaultVoiceId: 'km-KH-PisethNeural',
      forceRegen: false,
      signal,
      aiClient,
      modelName: effectiveModelName,
    });
    finalizedSegments = ttsRes.segmentsWithAudio;
    ttsReport = ttsRes.ttsReport || null;
  }

  checkAbort();

  // 9. Stage 10: Preview and Export Preparation
  report('previewAndExport', 99, 'រៀបចំ Timeline Data និងត្រៀមផ្ទៀងផ្ទាត់រក្សាទុកទិន្នន័យ...');
  const exportPrep = await previewAndExport({
    videoPath: ingestResult.videoPath,
    segments: finalizedSegments,
    episodeDir: ingestResult.episodeDir,
    exportOptions: { renderVideo: false },
  });

  const pipelineTotalWallTimeMs = Date.now() - pipelineStartTime;
  console.log(`[ChunkOrchestrator] 🚀 Full Pipeline Performance Telemetry:`, {
    totalWallTimeMs: pipelineTotalWallTimeMs,
    totalWallTimeSec: (pipelineTotalWallTimeMs / 1000).toFixed(1),
    stage3OcrTotalMs: pipelineStageDurations.ocrMs,
    stage4AsrTotalMs: pipelineStageDurations.asrMs,
    stage5ReconcileTotalMs: pipelineStageDurations.reconcileMs,
    stage6ScriptMs: pipelineStageDurations.stage6ScriptMs,
    stage7ValidationMs: pipelineStageDurations.stage7ValidationMs,
    stage8TimingMs: pipelineStageDurations.stage8TimingMs,
    chunksCount: chunks.length,
    totalCues: finalizedSegments.length,
  });

  const totalSec = (pipelineTotalWallTimeMs / 1000).toFixed(1);
  const frameSec = ((pipelineStageDurations.ffmpegPrepassMs || 0) / 1000).toFixed(1);
  const f0Sec = ((pipelineStageDurations.f0Ms || 0) / 1000).toFixed(1);
  const ocrSec = (pipelineStageDurations.ocrMs / 1000).toFixed(1);
  const transSec = (pipelineStageDurations.stage6ScriptMs / 1000).toFixed(1);
  console.log(`[Turbo Pipeline] ✅ Script generated in ${totalSec}s (FFmpeg+Frames: ${frameSec}s, Acoustic F0: ${f0Sec}s, Stage 3 Vision OCR: ${ocrSec}s, Stage 6 Khmer Translation: ${transSec}s)`);

  const totalOcrFrames = chunkResults.reduce((sum, r) => sum + (r?.ocrPerf?.candidateFramesCount || 0), 0);
  const totalOcrVerifiedFrames = chunkResults.reduce((sum, r) => sum + (r?.ocrPerf?.verifiedFramesCount ?? ((r?.ocrPerf?.localVerifiedCount || 0) + (r?.ocrPerf?.geminiVerifiedCount || 0))), 0);
  const totalOcrUnresolvedFrames = chunkResults.reduce((sum, r) => sum + (r?.ocrPerf?.unresolvedFramesCount || 0), 0);
  const ocrRequests = chunkResults.reduce((sum, r) => sum + (r?.ocrPerf?.geminiUsage?.requests ?? r?.ocrPerf?.apiCallsCount ?? 0), 0);
  const ocrPromptTokens = chunkResults.reduce((sum, r) => sum + (r?.ocrPerf?.geminiUsage?.promptTokens || 0), 0);
  const ocrOutputTokens = chunkResults.reduce((sum, r) => sum + (r?.ocrPerf?.geminiUsage?.outputTokens || 0), 0);
  const ocrTotalTokens = chunkResults.reduce((sum, r) => sum + (r?.ocrPerf?.geminiUsage?.totalTokens || 0), 0);
  const transUsage = scriptResult?.usage || { requests: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  const combinedUsage = {
    ocrRequests,
    ocrPromptTokens,
    ocrOutputTokens,
    ocrTotalTokens,
    translationRequests: transUsage.requests || 0,
    translationPromptTokens: transUsage.promptTokens || 0,
    translationOutputTokens: transUsage.outputTokens || 0,
    translationTotalTokens: transUsage.totalTokens || 0,
    speakerIdentificationRequests: speakerIdentificationCalls,
    totalRequests: ocrRequests + (transUsage.requests || 0) + speakerIdentificationCalls,
    totalPromptTokens: ocrPromptTokens + (transUsage.promptTokens || 0),
    totalOutputTokens: ocrOutputTokens + (transUsage.outputTokens || 0),
    totalTokens: ocrTotalTokens + (transUsage.totalTokens || 0),
  };

  const sourceCuesForCheck = mode === GENERATION_MODES.MODE_B_RECAP ? null : stitchedSegments;
  const coverageReport = computePipelineCompletenessReport({
    durationSec,
    verifiedSourceCuesCount: stitchedSegments.length,
    ocrTotalFrames: totalOcrFrames,
    ocrVerifiedFrames: totalOcrVerifiedFrames,
    ocrUnresolvedFrames: totalOcrUnresolvedFrames,
    finalizedSegments,
    sourceCues: sourceCuesForCheck,
    ocrEngineMode: resolvedOcrMode,
    usage: combinedUsage,
  });

  const ttsHasFailures = Boolean(ttsReport && (ttsReport.failedCount > 0 || ttsReport.isComplete === false));
  const isPipelineComplete = (mode === GENERATION_MODES.MODE_B_RECAP
    ? ((coverageReport.ocrUnresolvedFramesCount || 0) === 0 && finalizedSegments.length > 0)
    : Boolean(coverageReport.oneToOneMappingValid)) && !ttsHasFailures;
  const pipelineFinalStatus = isPipelineComplete ? 'completed' : 'review_needed';

  const finalOutput = {
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
      recoveredSegmentsCount: finalizedSegments.length,
      totalChunksProcessed: chunks.length,
    },
    pipelineMeta: {
      jobId: ingestResult.jobId,
      seriesId: ingestResult.seriesId,
      episodeId: ingestResult.episodeId,
      modelUsed: effectiveModelName,
      ocrEngineMode: resolvedOcrMode,
      usage: combinedUsage,
      verifiedChineseSrtPath,
      fileHash: ingestResult.fileHash,
      durationSec,
      totalChunks: chunks.length,
      completedAt: Date.now(),
      assSubtitlePath: exportPrep.assSubtitlePath,
      srtSubtitlePath: exportPrep.srtSubtitlePath,
      pipelinePerformance: {
        totalWallTimeMs: pipelineTotalWallTimeMs,
        stage3OcrTotalMs: pipelineStageDurations.ocrMs,
        stage4AsrTotalMs: pipelineStageDurations.asrMs,
        stage5ReconcileTotalMs: pipelineStageDurations.reconcileMs,
        stage6ScriptMs: pipelineStageDurations.stage6ScriptMs,
        stage7ValidationMs: pipelineStageDurations.stage7ValidationMs,
        stage8TimingMs: pipelineStageDurations.stage8TimingMs,
      },
      ...(scriptResult.translationReport ? { translationReport: scriptResult.translationReport } : {}),
      ...(validationRes?.validationReport ? { validationReport: validationRes.validationReport } : {}),
      ...(ttsReport ? { ttsReport } : {}),
      ...(exportPrep?.reviewWarnings?.length ? { exportReviewWarnings: exportPrep.reviewWarnings } : {}),
    },
  };

  // Persist completed scriptData atomically to series.json under per-series mutex + disk verification
  report('persistScript', 99, 'កំពុងរក្សាទុក & ផ្ទៀងផ្ទាត់ទិន្នន័យ Script ចូល series.json...');
  const resolvedSeriesId = ingestResult?.seriesId || jobSeriesId || seriesId;
  const resolvedEpisodeId = ingestResult?.episodeId || jobEpisodeId || episodeId;
  const { persistEpisodeScriptData } = require('../episodeService');
  const persistRes = await persistEpisodeScriptData({
    seriesId: resolvedSeriesId,
    episodeId: resolvedEpisodeId,
    expectedSeriesId: jobSeriesId || seriesId || resolvedSeriesId,
    expectedEpisodeId: jobEpisodeId || episodeId || resolvedEpisodeId,
    scriptData: {
      mode: scriptResult.mode || mode,
      generationMode: mode,
      genre: scriptResult.genre || genre,
      detectedGenre: scriptResult.detectedGenre || scriptResult.genre || genre,
      summary: scriptResult.summary,
      speakers,
      speakerRegistry,
      hasScript: finalizedSegments.length > 0,
      totalSegments: finalizedSegments.length,
      segments: finalizedSegments,
      coverage: coverageReport,
      recoveryReport: finalOutput.recoveryReport,
      pipelineMeta: finalOutput.pipelineMeta,
      updatedAt: Date.now(),
    },
    generationMode: mode,
    status: isPipelineComplete ? 'translated' : 'review_needed',
    seriesGenre: scriptResult.genre || genre,
    seriesDetectedGenre: scriptResult.detectedGenre || scriptResult.genre || genre,
    seriesSpeakerMap: updatedSeriesSpeakerMap,
    jobId: jobId || ingestResult?.jobId,
  });
  console.log(`[ChunkOrchestrator] ✅ Persisted ${persistRes.savedCount} script segments atomically to series.json for ${persistRes.episodeId} (status=${pipelineFinalStatus})`);

  if (jobId) {
    updateJob(jobId, {
      status: pipelineFinalStatus,
      progress: isPipelineComplete ? 100 : 99,
      currentStage: pipelineFinalStatus,
      stageMessage: isPipelineComplete
        ? `Successfully processed ${finalizedSegments.length} segments across ${chunks.length} chunks.`
        : `Review needed: ${coverageReport.missingTranslationsCount || 0} missing/untranslated cue(s), ${coverageReport.ocrUnresolvedFramesCount || 0} unresolved OCR frame(s).`,
      finalResult: finalOutput,
    });
  }

  return finalOutput;
}

module.exports = {
  runChunkedDubbingPipeline,
  generateChunkPlan,
  stitchAndDeduplicateSegments,
};
