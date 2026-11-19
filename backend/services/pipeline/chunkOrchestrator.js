const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GENERATION_MODES } = require('./pipelineTypes');
const { extractChineseSubtitles, areChineseTextsEquivalent, deduplicateFastOcrCues } = require('./stages/stage3_extractChineseSubtitles');
const { analyzeDialogueAudio } = require('./stages/stage4_analyzeDialogueAudio');
const { reconcileTimelineEvidence } = require('./stages/stage5_reconcileTimelineEvidence');
const { generateModeSpecificScript } = require('./stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('./stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('./stages/stage8_validateSubtitleTiming');
const { generateSegmentTTS } = require('./stages/stage9_generateSegmentTTS');
const { previewAndExport } = require('./stages/stage10_previewAndExport');
const { buildSpeakerRegistry, syncSegmentsWithSpeakerRegistry } = require('../../models/speakerRegistry');
const { updateChunk, updateJob, productionJobQueue } = require('./jobManager');
const { createAbortError } = require('../../utils/asyncSemaphore');
const { isNonChineseAsrHallucination } = require('../../utils/translationQuality');
const { DUBBING_CASCADE_MODELS, isUsableDubbingModel } = require('../geminiModelCatalog');
const { geminiQuotaTracker } = require('../geminiQuotaTracker');

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
    const isLast = rawEnd >= totalDurationSec;
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
    // Check overlap condition:
    // If start times are within 2.5s and Chinese texts are equivalent
    const isTimeAdjacent = Math.abs(seg.startSec - prev.startSec) < 2.5 || (seg.startSec < prev.endSec + 0.6);
    const textA = seg.originalChineseText || seg.chineseText || '';
    const textB = prev.originalChineseText || prev.chineseText || '';
    const isTextMatch = areChineseTextsEquivalent(textA, textB);

    if (isTimeAdjacent && isTextMatch) {
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
}) {
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

  // Process chunks
  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    checkAbort();
    const chunk = chunks[cIdx];
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

    const chunkHash = crypto.createHash('md5')
      .update(`${videoPath}${videoSignature}_${chunk.startSec}_${chunk.endSec}_${effectiveModelName}_${mode}`)
      .digest('hex');
    const chunkFile = path.join(chunkCacheDir, `chunk_${chunkHash}.json`);

    let chunkSegments = [];
    let isChunkReused = false;
    let visualOnlyCount = 0;
    let fusedCount = 0;

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
        if (!hasUnresolved && Array.isArray(cachedChunk.segments) && cachedChunk.segments.length > 0) {
          const beforeCacheCount = cachedChunk.segments.length;
          chunkSegments = cachedChunk.segments.filter((seg) => !isNonChineseAsrHallucination(seg));
          const droppedCacheJunk = beforeCacheCount - chunkSegments.length;
          visualOnlyCount = cachedChunk.visualOnlyCount || 0;
          fusedCount = cachedChunk.fusedCount || 0;
          isChunkReused = true;
          console.log(
            `[ChunkOrchestrator] ⚡ Resuming Chunk ${cIdx + 1}/${chunks.length}: Loaded ${chunkSegments.length} validated segments from disk cache${droppedCacheJunk > 0 ? ` (dropped ${droppedCacheJunk} non-Chinese ASR junk)` : ''}`
          );
        } else if (hasUnresolved) {
          console.warn(`[ChunkOrchestrator] ⚠️ Chunk cache at ${path.basename(chunkFile)} contains unresolved frames or was not completed. Re-running chunk.`);
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
        const ocrResult = await extractChineseSubtitles({
          videoPath,
          durationSec: chunk.durationSec,
          aiClient,
          modelName: effectiveModelName,
          baseStepSec: mode === GENERATION_MODES.FAST_OCR ? 0.75 : 1.0,
          startOffsetSec: chunk.startSec,
          force,
          signal,
          onProgress: (p) => {
            const batchPercent = p.totalBatches > 0
              ? Math.round(chunkPercent + (p.completedBatches / p.totalBatches) * ((1 / chunks.length) * 15))
              : chunkPercent;
            report(
              'chunkOCR',
              Math.min(70, batchPercent),
              `Chunk ${cIdx + 1}/${chunks.length}: ស្កេន OCR ${p.completedBatches}/${p.totalBatches} batches (${p.completedFrames}/${p.totalFrames} frames) [Model: ${p.modelUsed || effectiveModelName}]${p.retriesCount > 0 ? ` (Retries: ${p.retriesCount})` : ''}`
            );
          },
        });

        checkAbort();

        // Validate OCR completeness: Do not allow incomplete OCR to silently trigger downstream stages
        const hasUnresolvedOcr = Boolean(
          ocrResult?.hasUnresolvedFrames ||
          ocrResult?.ocrMeta?.hasUnresolvedFrames ||
          ocrResult?.isComplete === false ||
          ocrResult?.ocrMeta?.isComplete === false ||
          (ocrResult?.ocrMeta?.unresolvedFramesCount > 0)
        );

        if (hasUnresolvedOcr) {
          const unresCount = ocrResult?.ocrMeta?.unresolvedFramesCount || ocrResult?.unresolvedFrames?.length || 1;
          const msg = `Chunk ${cIdx + 1}/${chunks.length} contains ${unresCount} unresolved OCR frame(s). Downstream translation/TTS paused for review.`;
          console.warn(`[ChunkOrchestrator] ⚠️ ${msg}`);
          if (jobId) {
            updateChunk(jobId, chunk.chunkIndex, {
              status: 'review_needed',
              reviewNeeded: true,
              hasUnresolvedFrames: true,
              unresolvedCount: unresCount,
              segmentsCount: (ocrResult.visualSegments || []).length,
              updatedAt: Date.now(),
            });
            updateJob(jobId, {
              status: 'review_needed',
              reviewNeeded: true,
              error: msg,
              failedChunkIndex: chunk.chunkIndex,
            });
          }
          const unresErr = new Error(`[ChunkOrchestrator] ${msg}`);
          unresErr.code = 'OCR_REVIEW_NEEDED';
          unresErr.reviewNeeded = true;
          unresErr.chunkIndex = chunk.chunkIndex;
          unresErr.ocrResult = ocrResult;
          throw unresErr;
        }

        const ocrCuesCount = Array.isArray(ocrResult?.visualSegments) ? ocrResult.visualSegments.length : 0;

        if (mode === GENERATION_MODES.FAST_OCR) {
          console.log(`[ChunkOrchestrator] ⚡ Fast OCR Mode: Skipping Stage 4 (ASR) & Stage 5 (Reconcile) for Chunk ${cIdx + 1}`);
          chunkSegments = deduplicateFastOcrCues(ocrResult.visualSegments || [], narratorGender);
          visualOnlyCount = chunkSegments.length;
          fusedCount = 0;

          console.log(`[ChunkOrchestrator] Chunk ${cIdx + 1} cues detected: ${ocrCuesCount} -> segments stored: ${chunkSegments.length}`);
          if (ocrCuesCount !== chunkSegments.length) {
            console.warn(`[ChunkOrchestrator] ⚠️ WARNING: Fast OCR 1:1 rule mismatch! cues detected: ${ocrCuesCount} -> segments stored: ${chunkSegments.length} (${ocrCuesCount} != ${chunkSegments.length})`);
          }
        } else {
          // 2. Stage 4 Audio Diarization for this chunk
          report(
            'chunkASR',
            Math.min(70, Math.round(chunkPercent + (1 / chunks.length) * 35)),
            `Chunk ${cIdx + 1}/${chunks.length}: កំពុងស្ដាប់សំឡេងតួអង្គចិន (ASR Audio Diarization)...`
          );
          const audioAnalysis = await analyzeDialogueAudio({
            videoPath,
            durationSec: chunk.durationSec,
            aiClient,
            modelName: effectiveModelName,
            startOffsetSec: chunk.startSec,
            force,
            signal,
          });

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
          const chunkReconciliation = await reconcileTimelineEvidence({
            visualSegments: ocrResult.visualSegments,
            audioSegments: audioAnalysis.audioSegments,
            rawObservations: ocrResult.rawObservations,
            durationSec: chunk.durationSec,
          });

          const rawReconciled = chunkReconciliation.reconciledSegments || [];
          chunkSegments = rawReconciled.filter((seg) => !isNonChineseAsrHallucination(seg));
          if (chunkSegments.length !== rawReconciled.length) {
            console.log(`[ChunkOrchestrator] 🧹 Dropped ${rawReconciled.length - chunkSegments.length} non-Chinese ASR hallucination(s) from Chunk ${cIdx + 1}.`);
          }
          visualOnlyCount = chunkReconciliation.reconciliationMeta?.visualOnlyCount || 0;
          fusedCount = chunkReconciliation.reconciliationMeta?.fusedSegmentsCount || 0;
          console.log(`[ChunkOrchestrator] Chunk ${cIdx + 1} cues detected: ${ocrCuesCount} -> segments stored: ${chunkSegments.length} (Standard mode)`);
        }

        // Persist validated chunk result to disk for instant resumption
        try {
          fs.writeFileSync(chunkFile, JSON.stringify({
            chunkIndex: chunk.chunkIndex,
            startSec: chunk.startSec,
            endSec: chunk.endSec,
            segments: chunkSegments,
            visualOnlyCount,
            fusedCount,
            videoSignature,
            isComplete: true,
            hasUnresolvedFrames: false,
            status: 'completed',
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

    allChunkSegments.push(...chunkSegments);

    if (jobId) {
      updateChunk(jobId, chunk.chunkIndex, {
        status: 'completed',
        completedAt: Date.now(),
        segmentsCount: chunkSegments.length,
        visualOnlyCount,
        fusedCount,
      });
    }

    report(
      'chunkCompleted',
      Math.min(70, Math.round(10 + ((cIdx + 1) / chunks.length) * 60)),
      `✅ Chunk ${cIdx + 1}/${chunks.length} រួចរាល់ (${chunkSegments.length} បន្ទាត់សន្ទនា)`
    );

    console.log(`[ChunkOrchestrator] Chunk ${cIdx + 1}/${chunks.length} completed with ${chunkSegments.length} reconciled segments.`);
  }

  checkAbort();

  // 4. Global Stitching and Boundary Deduplication
  report('stitching', 72, 'កំពុងផ្គុំ និងផ្ទៀងផ្ទាត់ព្រំប្រទល់ Chunk ទាំងអស់ (Global Timeline Stitching)...');
  const stitchedSegments = mode === GENERATION_MODES.FAST_OCR
    ? deduplicateFastOcrCues(allChunkSegments, narratorGender)
    : stitchAndDeduplicateSegments(allChunkSegments);
  console.log(`[ChunkOrchestrator] Global stitching complete: ${stitchedSegments.length} total unified segments.`);

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
    force,
    forceRegen,
    signal,
  });

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
  const validationRes = await translateAndValidateKhmer({
    scriptSegments: scriptResult.scriptSegments,
    mode: scriptResult.mode,
  });

  checkAbort();

  // 7. Stage 8: Validate Subtitle Timing
  report('validateSubtitleTiming', 92, 'កំពុងផ្ទៀងផ្ទាត់ Subtitle Timing (ទប់ស្កាត់ 0.01s និងចៀសវាង Overlap)...');
  const timingRes = await validateSubtitleTiming({
    segments: validationRes.validatedSegments,
    durationSec,
  });

  let finalizedSegments = timingRes.timedSegments;

  // Speaker Registry Sync
  const initialRegistry = buildSpeakerRegistry(finalizedSegments, {});
  const syncResult = syncSegmentsWithSpeakerRegistry(finalizedSegments, {
    seriesSpeakerMap: seriesGlossary?.seriesSpeakerMap || {},
  });
  finalizedSegments = syncResult.segments || finalizedSegments;
  const speakerRegistry = syncResult.speakerRegistry || initialRegistry;
  const speakers = syncResult.speakers || [];

  checkAbort();

  // 8. Stage 9: Generate Segment TTS (Optional initial pass)
  if (generateAudio && finalizedSegments.length > 0) {
    report('generateSegmentTTS', 96, 'កំពុងបង្កើតសំឡេងខ្មែរ Neural TTS សម្រាប់ឃ្លានីមួយៗ...');
    const ttsRes = await generateSegmentTTS({
      segments: finalizedSegments,
      audioDir: ingestResult.audioDir,
      defaultVoiceId: 'km-KH-PisethNeural',
      forceRegen: false,
      signal,
    });
    finalizedSegments = ttsRes.segmentsWithAudio;
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

  const finalOutput = {
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
      recoveredSegmentsCount: finalizedSegments.length,
      totalChunksProcessed: chunks.length,
    },
    pipelineMeta: {
      jobId: ingestResult.jobId,
      seriesId: ingestResult.seriesId,
      episodeId: ingestResult.episodeId,
      modelUsed: effectiveModelName,
      fileHash: ingestResult.fileHash,
      durationSec,
      totalChunks: chunks.length,
      completedAt: Date.now(),
      assSubtitlePath: exportPrep.assSubtitlePath,
      srtSubtitlePath: exportPrep.srtSubtitlePath,
      ...(scriptResult.translationReport ? { translationReport: scriptResult.translationReport } : {}),
      ...(validationRes?.validationReport ? { validationReport: validationRes.validationReport } : {}),
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
      updatedAt: Date.now(),
    },
    generationMode: mode,
    status: 'translated',
    seriesGenre: scriptResult.genre || genre,
    seriesDetectedGenre: scriptResult.detectedGenre || scriptResult.genre || genre,
    jobId: jobId || ingestResult?.jobId,
  });
  console.log(`[ChunkOrchestrator] ✅ Persisted ${persistRes.savedCount} script segments atomically to series.json for ${persistRes.episodeId}`);

  if (jobId) {
    updateJob(jobId, {
      status: 'completed',
      progress: 100,
      currentStage: 'completed',
      stageMessage: `Successfully processed ${finalizedSegments.length} segments across ${chunks.length} chunks.`,
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
