const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  extractFramesStreaming,
  extractFramesAtTimestamps,
  extractSubtitleDifferenceGrid,
  detectSubtitleChangePoints,
} = require('../../ffmpegService');
const {
  formatSecondsToTimecode,
  OCR_ENGINE_MODES,
  resolveOcrEngineMode,
} = require('../pipelineTypes');
const { createAbortError } = require('../../../utils/asyncSemaphore');
const { geminiQuotaTracker } = require('../../geminiQuotaTracker');
const {
  checkLocalChineseOcrStatus,
  isLocalChineseOcrAvailable,
  runLocalChineseOcr,
} = require('../../ocr/localChineseOcrService');
const {
  sleepOrAbort,
  defaultCacheDir,
  getOcrCachePath,
  getOcrCheckpointPath,
  saveOcrCheckpoint,
  loadOcrCheckpoint,
  needsIndependentRead,
  hasChineseHanzi,
  normalizeChineseChars,
  stripDecorativeSubtitleNoise,
  stripRepeatedLeadingTimeCardPrefix,
  sameSubtitleText,
  isExactChineseSubtitleMatch,
  areChineseTextsEquivalent,
  CASCADE_VISION_MODELS,
  visionModelCooldownMap,
  classifyVisionError,
  extractRetryDelayMs,
  isRetryableVisionError,
  isTimeoutOrOverloadError,
  callGeminiVisionWithRetry,
  parseVisionResponseFrames,
  buildVisionBatchContents,
  executeSingleVisionBatch: runSingleVisionBatch,
  deduplicateFastOcrCues,
} = require('./stage3VisionBatchRunner');

function computeNormalizedTextSimilarity(a = '', b = '') {
  const s1 = normalizeChineseChars(stripDecorativeSubtitleNoise(a));
  const s2 = normalizeChineseChars(stripDecorativeSubtitleNoise(b));
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length === 1 || s2.length === 1) {
    return (s1.includes(s2) || s2.includes(s1)) ? 0.5 : 0;
  }
  const bigrams = (str) => {
    const counts = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      counts.set(bg, (counts.get(bg) || 0) + 1);
    }
    return counts;
  };
  const m1 = bigrams(s1);
  const m2 = bigrams(s2);
  let shared = 0;
  for (const [bg, c1] of m1.entries()) {
    const c2 = m2.get(bg) || 0;
    if (c2 > 0) shared += Math.min(c1, c2);
  }
  return (2 * shared) / Math.max(1, (s1.length - 1) + (s2.length - 1));
}

function formatSrtTimestamp(sec = 0) {
  const totalMs = Math.max(0, Math.round((Number(sec) || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function saveVerifiedChineseSrt(cues = [], outputPath) {
  if (!outputPath || !Array.isArray(cues)) return null;
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  cues.forEach((cue, idx) => {
    const txt = String(cue?.originalChineseText || cue?.chineseText || cue?.textZh || '').trim();
    if (!txt) return;
    const startSec = Number(cue.sourceStartSec ?? cue.startSec ?? 0) || 0;
    const endSec = Math.max(startSec + 0.35, Number(cue.sourceEndSec ?? cue.endSec ?? startSec + 1.2) || (startSec + 1.2));
    lines.push(`${idx + 1}\n${formatSrtTimestamp(startSec)} --> ${formatSrtTimestamp(endSec)}\n${txt}`);
  });
  const content = lines.join('\n\n') + (lines.length ? '\n' : '');
  fs.writeFileSync(outputPath, content, 'utf8');
  return outputPath;
}

async function extractChineseSubtitles({
  videoPath,
  durationSec,
  aiClient,
  modelName = null,
  baseStepSec = 0.75,
  startOffsetSec = 0,
  force = false,
  signal = null,
  onProgress = null,
  enableLocalOcr = true,
  ocrMode = null,
  cacheDir = defaultCacheDir,
  isFastOcrMode = false,
  generationMode = null,
  strictOcrReviewGate = false,
}) {
  const fastOcrActive = Boolean(
    isFastOcrMode ||
    generationMode === 'fast_ocr' ||
    process.env.FAST_OCR_MODE === 'true'
  );
  const isFastOcr = fastOcrActive;
  const ocrEngineMode = resolveOcrEngineMode({ ocrMode, enableLocalOcr });
  const effectiveEnableLocalOcr = ocrEngineMode === OCR_ENGINE_MODES.HYBRID;
  let activeWorkingModel = modelName || geminiQuotaTracker.getPreferredPrimaryModel(CASCADE_VISION_MODELS[0]);
  const effectiveModel = activeWorkingModel;
  const checkAbort = () => {
    if (signal?.aborted) {
      throw createAbortError('Stage 3 OCR aborted');
    }
  };

  checkAbort();

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`[Stage 3 Extract Subtitles] Video file not found: ${videoPath}`);
  }
  if (!aiClient) {
    throw new Error('[Stage 3 Extract Subtitles] Gemini AI client is required');
  }

  const cachePath = getOcrCachePath(videoPath, startOffsetSec, durationSec, effectiveModel, cacheDir, ocrEngineMode);
  if (force && cachePath && fs.existsSync(cachePath)) {
    try { fs.unlinkSync(cachePath); } catch (_) {}
  }
  if (!force && cachePath && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const hasUnresolved = Boolean(
        cached.hasUnresolvedFrames ||
        cached.isComplete === false ||
        cached.ocrMeta?.hasUnresolvedFrames ||
        cached.ocrMeta?.isComplete === false ||
        (Array.isArray(cached.rawObservations) && cached.rawObservations.some((o) => o.ocrFailed || o.isVerified === false || o.ocrStatus === 'failed' || o.ocrStatus === 'missing'))
      );
      if (!hasUnresolved && cached.ocrMeta?.independentSamples && Array.isArray(cached.visualSegments) && Array.isArray(cached.rawObservations) && cached.visualSegments.length > 0) {
        console.log(`[Stage 3 OCR] ⚡ Cache Hit: Reusing ${cached.visualSegments.length} visual segments from disk cache (${path.basename(cachePath)})`);
        return cached;
      } else if (hasUnresolved) {
        console.warn(`[Stage 3 OCR] ⚠️ Cache at ${path.basename(cachePath)} contains unresolved/failed frames. Rejecting incomplete cache.`);
      }
    } catch (_) {}
  }

  const checkpointPath = getOcrCheckpointPath(videoPath, startOffsetSec, durationSec, cacheDir);
  if (force && checkpointPath && fs.existsSync(checkpointPath)) {
    try { fs.unlinkSync(checkpointPath); } catch (_) {}
  }

  const completedMap = new Map();
  const unresolvedMap = new Map();
  const localReads = new Map();
  let resumedFromCheckpoint = false;
  if (!force && checkpointPath) {
    const ckpt = loadOcrCheckpoint(checkpointPath);
    if (ckpt) {
      if (ckpt.independentSamples && Array.isArray(ckpt.pendingLocalReads)) {
        for (const row of ckpt.pendingLocalReads) {
          if (Number.isFinite(row?.timestampSec) && row.ocrStatus !== 'failed') localReads.set(row.timestampSec, row);
        }
      }
      for (const obs of ckpt.rawObservations) {
        if (obs && typeof obs.timestampSec === 'number') {
          const t = parseFloat(obs.timestampSec.toFixed(2));
          const isVerified = Boolean(obs.isVerified && !obs.ocrFailed && obs.ocrStatus !== 'failed' && obs.ocrStatus !== 'missing');
          if (!ckpt.independentSamples && needsIndependentRead(obs)) continue;
          if (isVerified) {
            completedMap.set(t, obs);
          } else {
            unresolvedMap.set(t, obs);
          }
        }
      }
      resumedFromCheckpoint = true;
      console.log(`[Stage 3 OCR] ⚡ Resuming from checkpoint (${path.basename(checkpointPath)}): ${completedMap.size} completed frame observations loaded (${unresolvedMap.size} unresolved to retry).`);
    }
  }

  const localOnResume = new Set(localReads.keys());
  function saveProgress(data) {
    return saveOcrCheckpoint(checkpointPath, {
      ...data,
      independentSamples: true,
      pendingLocalReads: [...localReads.values()].filter(row => !completedMap.has(row.timestampSec)),
    });
  }

  const verifiedOnResume = new Set(completedMap.keys());
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub_ocr_'));

  const rawObservations = [];
  const evaluatedCueStates = [];
  let apiCallsCount = 0;
  let retriesCount = 0;
  let lastBatchError = null;
  let ocrWallTimeMs = 0;
  let ffmpegPrepassMs = 0;
  let frameExtractionMs = 0;
  let localOcrMs = 0;
  let geminiVerificationMs = 0;
  let localTelemetry = { imageDecodeMs: 0, inferenceMs: 0, avgInferenceMs: 0, workerCpuMs: 0, workerPeakRssMb: null };
  const geminiRequestedTimes = new Set();
  let tieBreakMs = 0;
  let batchSplitsCount = 0;
  let dedupedFramesCount = 0;
  let localOcrFramesCount = 0;
  let actualOcrFramesCount = 0;
  let workerStartupMs = 0;
  let rapidOcrInitMs = 0;
  let avgMsPerFrame = 0;
  let localVerifiedCount = 0;
  let geminiVerifiedCount = 0;
  let geminiBatchCount = 0;
  let isLocalOcrActive = false;
  const telemetry = {
    apiTotalMs: 0,
    retrySleepMs: 0,
    attempts: 0,
    successfulCalls: 0,
    promptTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  const stage3StartTime = Date.now();
  const prepassStartTime = Date.now();
  try {
    checkAbort();
    // 1. STEP 1: Change-driven sampling pre-pass (local FFmpeg pixel-diff, zero API calls)
    const { changePoints = [], cueStates = [], frameDiffs = [] } = await detectSubtitleChangePoints(
      videoPath,
      startOffsetSec,
      durationSec,
      5.0,
      {
        signal,
        minPeakDist: fastOcrActive ? 0.40 : 0.35,
        minCueDurationSec: fastOcrActive ? 0.35 : 0.35,
      }
    ).catch((preErr) => {
      if (preErr?.name === 'AbortError' || signal?.aborted) {
        throw preErr?.name === 'AbortError' ? preErr : createAbortError('Stage 3 OCR aborted');
      }
      console.warn('[Stage 3 Extract Subtitles] Pre-pass change point detection failed, falling back to grid:', preErr.message);
      return { changePoints: [], cueStates: [], frameDiffs: [] };
    });

    // Helper: Inspect maximum subtitle pixel diff between two timestamps
    // P0: Strictly inspect d.subDiff; never fall back to full-frame d.diff when subDiff === 0
    function getMaxSubtitleDiffBetween(startT, endT) {
      if (!Array.isArray(frameDiffs) || frameDiffs.length === 0) return 999;
      const minT = Math.min(startT, endT);
      const maxT = Math.max(startT, endT);
      const inRange = frameDiffs.filter((d) => d && typeof d.timestampSec === 'number' && d.timestampSec >= minT && d.timestampSec <= maxT);
      if (inRange.length === 0) return 999;
      return inRange.reduce(
        (max, d) => Math.max(max, typeof d?.subDiff === 'number' ? d.subDiff : (typeof d?.diff === 'number' ? d.diff : 0)),
        0
      );
    }

    // Schedule candidate frame timestamps:
    // (a) One frame shortly AFTER each change point (sampleASec) + mid-cue frame (sampleBSec)
    // (b) 0.75s baseline safety net deduplicated by timestamp (drops on static scenes)
    const scheduled = new Set();
    const candidateTimestamps = [];
    // Keep the original anchor grid for baseline coverage. Independently read
    // every cue sample, including timestamps previously linked to an anchor.
    const cueSamples = new Map();
    const additionalSamples = new Set();
    const safeStartSec = Math.max(0, Number(startOffsetSec) || 0);
    const endSec = durationSec > 0 ? safeStartSec + durationSec : (cueStates.length > 0 ? cueStates[cueStates.length - 1].endSec : safeStartSec + 10);

    function trySchedule(t, reason, minGap = 0.12) {
      const rounded = parseFloat(Number(t).toFixed(2));
      if (rounded < safeStartSec || rounded > endSec) return false;
      for (const ex of scheduled) {
        if (Math.abs(ex - rounded) < minGap) return false;
      }
      scheduled.add(rounded);
      candidateTimestamps.push({ timestampSec: rounded, reason });
      return true;
    }

    // (a) Change-point frames & dual-read frames (use full dual-read when Hybrid local OCR is active)
    const scheduleMidpointOnly = fastOcrActive && !effectiveEnableLocalOcr;
    if (scheduleMidpointOnly && cueStates.length > 0) {
      for (const cs of cueStates) {
        const midSec = Number(((cs.startSec + cs.endSec) / 2).toFixed(2));
        trySchedule(midSec, `cue_${cs.cueIndex}_mid`, 0.20);
        cueSamples.set(midSec, cs);

        if (cs.duration >= 1.2) {
          const secondSec = Number((cs.startSec + cs.duration * 0.75).toFixed(2));
          trySchedule(secondSec, `cue_${cs.cueIndex}_sampleB`, 0.20);
          cueSamples.set(secondSec, cs);
        }
      }
    } else if (cueStates.length > 0) {
      for (const cs of cueStates) {
        trySchedule(cs.sampleASec, `cue_${cs.cueIndex}_sampleA`, 0.12);

        cueSamples.set(cs.sampleASec, cs);
        cueSamples.set(cs.sampleBSec, cs);
        if (getMaxSubtitleDiffBetween(cs.sampleASec, cs.sampleBSec) >= 2.5) {
          trySchedule(cs.sampleBSec, `cue_${cs.cueIndex}_sampleB`, 0.12);
        }
      }
    } else {
      // Fallback: use raw changePoints if cueStates empty
      for (const cp of changePoints) {
        trySchedule(cp.timestampSec + 0.10, 'cp_onset', 0.12);
      }
    }

    const stepDiff = 0.2; // 5 fps pre-pass step

    // (b) Baseline safety net (0.75s grid deduplicated) + adaptive <=0.5s subtle-change scan
    const effectiveStep = scheduleMidpointOnly ? 1.0 : Math.max(0.5, Number(baseStepSec) || 0.75);
    let curTime = safeStartSec === 0 ? 0.5 : safeStartSec;

    while (curTime < endSec) {
      const rounded = parseFloat(curTime.toFixed(2));
      let isCovered = false;
      const coverageThreshold = scheduleMidpointOnly ? 0.60 : 0.40;
      for (const ex of scheduled) {
        if (Math.abs(ex - rounded) <= coverageThreshold) {
          isCovered = true;
          break;
        }
      }

      if (!isCovered && cueSamples.has(rounded)) {
        isCovered = true;
      }

      if (!isCovered) {
        const idx = Math.round((curTime - safeStartSec) / stepDiff);
        const nearDiffs = frameDiffs.slice(Math.max(0, idx - 2), Math.min(frameDiffs.length, idx + 3));
        const maxNearDiff = nearDiffs.reduce(
          (m, d) => Math.max(m, typeof d?.subDiff === 'number' ? d.subDiff : (typeof d?.diff === 'number' ? d.diff : 0)),
          0
        );
        const maxNearBrightChange = nearDiffs.reduce(
          (m, d) => Math.max(m, typeof d?.brightChangeRatio === 'number' ? d.brightChangeRatio : 0),
          0
        );

        if (maxNearDiff >= 8.0 || maxNearBrightChange >= 0.0035 || frameDiffs.length === 0) {
          trySchedule(rounded, 'baseline_active', 0.20);
        } else if (maxNearDiff >= 4.0 || maxNearBrightChange >= 0.0020) {
          // Adaptive local rescan for faint/low-contrast or short 1-3 char subtitles at <= 0.45s resolution
          const peakDiff = nearDiffs.reduce((best, d) => {
            const val = (typeof d?.subDiff === 'number' ? d.subDiff : 0) + (typeof d?.brightChangeRatio === 'number' ? d.brightChangeRatio * 500 : 0);
            return val > (best?.val || 0) ? { val, timestampSec: d.timestampSec } : best;
          }, null);
          trySchedule(peakDiff?.timestampSec ?? rounded, 'baseline_subtle_rescan', 0.20);
        } else if (!scheduleMidpointOnly) {
          // Static scene: keep sparse anchor at most every 2.0s (prevents silent 1.3s-4.0s gaps swallowing short cues)
          let hasRecentAnchor = false;
          for (const ex of scheduled) {
            if (Math.abs(ex - rounded) < 2.0) {
              hasRecentAnchor = true;
              break;
            }
          }
          if (!hasRecentAnchor) {
            trySchedule(rounded, 'baseline_static_sparse', 0.20);
          }
        }
      }
      curTime += effectiveStep;
    }

    if (!scheduleMidpointOnly) {
      for (const t of cueSamples.keys()) {
        if (!scheduled.has(t)) trySchedule(t, 'independent_sample', 0);
      }
    }

    // Sort candidate frame timestamps chronologically
    candidateTimestamps.sort((a, b) => a.timestampSec - b.timestampSec);
    const sortedTimes = candidateTimestamps.map((c) => c.timestampSec);
    const totalCandidateFrames = candidateTimestamps.length;

    // P1: Resume Checkpoint without re-decoding: Only extract frames that are NOT yet verified in completedMap
    const timesToExtract = sortedTimes.filter((t) => !completedMap.has(parseFloat(Number(t).toFixed(2))));

    // 2. Extract candidate frames at scheduled timestamps
    checkAbort();
    let extractedFrames = [];
    const extractStartTime = Date.now();
    if (timesToExtract.length > 0) {
      try {
        extractedFrames = await extractFramesAtTimestamps(videoPath, timesToExtract, tempDir, { signal });
      } catch (extractErr) {
        if (extractErr?.name === 'AbortError' || signal?.aborted) {
          throw extractErr?.name === 'AbortError' ? extractErr : createAbortError('Stage 3 OCR aborted');
        }
        console.warn('[Stage 3 Extract Subtitles] Timestamp extraction error, attempting streaming fallback:', extractErr.message);
        const fps = Math.min(2.0, Math.max(0.8, parseFloat((1 / effectiveStep).toFixed(2))));
        extractedFrames = await extractFramesStreaming(videoPath, safeStartSec, durationSec, fps, tempDir, { signal });
      }
    } else {
      console.log(`[Stage 3 OCR] ⚡ All candidate frames already verified in checkpoint (${completedMap.size} frames). Skipping FFmpeg frame extraction.`);
    }
    frameExtractionMs = Date.now() - extractStartTime;
    ffmpegPrepassMs = Math.max(0, Date.now() - prepassStartTime - frameExtractionMs);

    const framesToAnalyze = extractedFrames || [];
    console.log(`[Stage 3 Extract Subtitles] Detected ${changePoints.length} change points (${cueStates.length} candidate cue states). Prioritized ${framesToAnalyze.length} pending frames for Vision OCR (${completedMap.size} already verified in checkpoint)`);


    // Delegate single-batch execution to stage3VisionBatchRunner.js
    const executeSingleVisionBatch = (batchFrames) =>
      runSingleVisionBatch(batchFrames, {
        checkAbort,
        geminiRequestedTimes,
        onApiCall: () => { apiCallsCount++; },
        aiClient,
        getActiveWorkingModel: () => activeWorkingModel,
        setActiveWorkingModel: (m) => { activeWorkingModel = m; },
        signal,
        telemetry,
        fastOcrActive,
      });

    // 2.5 HYBRID LOCAL CHINESE OCR & VERIFICATION ROUTER
    const availabilityStart = Date.now();
    if (effectiveEnableLocalOcr && framesToAnalyze.length) {
      try {
        isLocalOcrActive = await isLocalChineseOcrAvailable();
      } catch (_) {
        isLocalOcrActive = false;
      }
    }

    const localAvailabilityMs = Date.now() - availabilityStart;
    if (effectiveEnableLocalOcr && (isLocalOcrActive || localReads.size) && framesToAnalyze.length > 0) {
      const pendingForLocalOcr = framesToAnalyze
        .filter((f) => !completedMap.has(f.timestampSec) && !localReads.has(f.timestampSec))
        .map((f, idx) => {
          const t = parseFloat(f.timestampSec.toFixed(2));
          const matchedCue = cueSamples.get(t);
          return {
            ...f,
            id: f.id || `f_${idx}_${t}`,
            cueIndex: matchedCue ? matchedCue.cueIndex : -1,
            isShortCue: matchedCue ? matchedCue.duration <= 1.0 : false,
            sceneCut: changePoints.some((cp) => Math.abs(cp.timestampSec - t) <= 0.15),
          };
        });
      if (pendingForLocalOcr.length || localReads.size) {
        const localOcrStart = Date.now();
        let localResults = [];
        if (isLocalOcrActive && pendingForLocalOcr.length) {
          console.log(`[Stage 3 OCR] ⚡ Running RapidOCR Local Chinese OCR on ${pendingForLocalOcr.length} candidate frames...`);
          if (typeof onProgress === 'function') {
            onProgress({
              stage: 'stage3_local_ocr',
              completedBatches: 0,
              totalBatches: 1,
              completedFrames: completedMap.size,
              totalFrames: totalCandidateFrames,
              localCompleted: 0,
              localTotal: pendingForLocalOcr.length,
              percent: 25,
              modelUsed: 'rapidocr-local',
              retriesCount,
              statusMessage: `1. Local Chinese OCR: 0/${pendingForLocalOcr.length} frames (RapidOCR)...`,
            });
          }

          try {
            const ocrRun = await runLocalChineseOcr({
              frames: pendingForLocalOcr,
              onBatchComplete: (rows) => {
                for (const row of rows) {
                  if (row.ocrStatus !== 'failed') localReads.set(row.timestampSec, row);
                }
                saveProgress({
                  version: 1, videoPath, startOffsetSec, durationSec, updatedAt: Date.now(),
                  rawObservations: [...completedMap.values(), ...unresolvedMap.values()],
                  totalCandidateFrames, completed: false,
                });
              },
              signal,
              onProgress: (p) => {
                if (typeof onProgress === 'function') {
                  onProgress({
                    stage: 'stage3_local_ocr',
                    completedBatches: 0,
                    totalBatches: 1,
                    completedFrames: completedMap.size + (p.completed || 0),
                    totalFrames: totalCandidateFrames,
                    localCompleted: p.completed,
                    localTotal: pendingForLocalOcr.length,
                    percent: Math.min(60, 25 + Math.round(((p.completed || 0) / Math.max(1, pendingForLocalOcr.length)) * 35)),
                    modelUsed: 'rapidocr-local',
                    retriesCount,
                    statusMessage: `Local Chinese OCR: ${p.completed}/${pendingForLocalOcr.length} frames (${p.percent}%)`,
                  });
                }
              },
            });
            localResults = ocrRun.results || [];
            workerStartupMs = ocrRun.workerStartupMs || 0;
            rapidOcrInitMs = ocrRun.rapidOcrInitMs || 0;
            actualOcrFramesCount = ocrRun.actualOcrFramesCount ?? localResults.length;
            const { imageDecodeMs, inferenceMs, avgInferenceMs, workerCpuMs, workerPeakRssMb } = ocrRun;
            localTelemetry = { imageDecodeMs, inferenceMs, avgInferenceMs, workerCpuMs, workerPeakRssMb };
            dedupedFramesCount = ocrRun.dedupedFramesCount || 0;
            avgMsPerFrame = ocrRun.avgMsPerFrame || 0;
          } catch (localErr) {
            if (localErr?.name === 'AbortError' || signal?.aborted) {
              throw localErr?.name === 'AbortError' ? localErr : createAbortError('Stage 3 OCR aborted');
            }
            console.warn(`[Stage 3 OCR] ⚠️ Local Chinese OCR failed (${localErr.message}). Falling back to Gemini Vision for all frames.`);
            localResults = [];
          }
        }
        localOcrMs = Date.now() - localOcrStart;
        localOcrFramesCount = localResults.length;
        const localMap = new Map(localReads);
        for (const row of localResults) localMap.set(row.timestampSec, row);

        if (localMap.size) {
          // HYBRID VERIFICATION ROUTER (Section 5):
          // Track cue-state sampleA/sampleB text disagreements so baseline loop never self-certifies them
          const disagreedTimestamps = new Set();

          // A. LOCAL VERIFIED:
          // 1. Both sampleA and sampleB empty with confidence >= 0.70
          // 2. Both sampleA and sampleB have Chinese text, are equivalent, and confidence >= 0.70 (1-char requires >= 0.85)
          if (cueStates.length > 0) {
            for (const cs of cueStates) {
              const tA = parseFloat(cs.sampleASec.toFixed(2));
              const tB = parseFloat(cs.sampleBSec.toFixed(2));
              const rA = localMap.get(tA);
              const rB = localMap.get(tB);

              if (!rA || !rB || tA === tB) continue;

              const confA = rA.confidence || 0;
              const confB = rB.confidence || 0;
              const rawTextA = rA.hasText ? stripDecorativeSubtitleNoise(rA.chineseText || rA.textZh || '') : '';
              const rawTextB = rB.hasText ? stripDecorativeSubtitleNoise(rB.chineseText || rB.textZh || '') : '';
              const hasHanziA = Boolean(rawTextA && hasChineseHanzi(rawTextA));
              const hasHanziB = Boolean(rawTextB && hasChineseHanzi(rawTextB));
              const textA = hasHanziA ? rawTextA : '';
              const textB = hasHanziB ? rawTextB : '';

              if (!hasHanziA && !hasHanziB && !rA.hasText && !rB.hasText && confA >= 0.70 && confB >= 0.70) {
                if (!completedMap.has(tA)) {
                  completedMap.set(tA, {
                    timestampSec: tA,
                    reportedSec: tA,
                    hasText: false,
                    textZh: '',
                    chineseText: '',
                    confidence: confA,
                    isSharp: true,
                    position: rA.position || 'bottom_subtitle',
                    visualGender: 'unknown',
                    speakerGender: 'UNKNOWN',
                    speakerVisualHint: '',
                    deliveryType: 'dialogue',
                    genderConfidence: 0.5,
                    ocrStatus: 'verified_empty',
                    isVerified: true,
                    isVerifiedEmpty: true,
                    ocrFailed: false,
                    reviewNeeded: false,
                    uncertainOcr: false,
                    ocrEngine: 'rapidocr-local',
                  });
                  localVerifiedCount++;
                }
                if (!completedMap.has(tB)) {
                  completedMap.set(tB, {
                    timestampSec: tB,
                    reportedSec: tB,
                    hasText: false,
                    textZh: '',
                    chineseText: '',
                    confidence: confB,
                    isSharp: true,
                    position: rB.position || 'bottom_subtitle',
                    visualGender: 'unknown',
                    speakerGender: 'UNKNOWN',
                    speakerVisualHint: '',
                    deliveryType: 'dialogue',
                    genderConfidence: 0.5,
                    ocrStatus: 'verified_empty',
                    isVerified: true,
                    isVerifiedEmpty: true,
                    ocrFailed: false,
                    reviewNeeded: false,
                    uncertainOcr: false,
                    ocrEngine: 'rapidocr-local',
                  });
                  localVerifiedCount++;
                }
              } else if (hasHanziA && hasHanziB && sameSubtitleText(textA, textB) && confA >= 0.70 && confB >= 0.70) {
                const resolvedText = textA.length >= textB.length ? textA : textB;
                const normResolvedLen = normalizeChineseChars(resolvedText).length;
                if (normResolvedLen <= 1 && (confA < 0.85 || confB < 0.85)) {
                  disagreedTimestamps.add(tA);
                  disagreedTimestamps.add(tB);
                  continue;
                }
                if (!completedMap.has(tA)) {
                  completedMap.set(tA, {
                    timestampSec: tA,
                    reportedSec: tA,
                    hasText: true,
                    textZh: resolvedText,
                    chineseText: resolvedText,
                    confidence: confA,
                    isSharp: confA >= 0.70,
                    position: rA.position || 'bottom_subtitle',
                    visualGender: 'unknown',
                    speakerGender: 'UNKNOWN',
                    speakerVisualHint: '',
                    deliveryType: 'dialogue',
                    genderConfidence: 0.5,
                    ocrStatus: 'verified_text',
                    isVerified: true,
                    isVerifiedEmpty: false,
                    ocrFailed: false,
                    reviewNeeded: false,
                    uncertainOcr: false,
                    ocrEngine: 'rapidocr-local',
                  });
                  localVerifiedCount++;
                }
                if (!completedMap.has(tB)) {
                  completedMap.set(tB, {
                    timestampSec: tB,
                    reportedSec: tB,
                    hasText: true,
                    textZh: resolvedText,
                    chineseText: resolvedText,
                    confidence: confB,
                    isSharp: confB >= 0.70,
                    position: rB.position || 'bottom_subtitle',
                    visualGender: 'unknown',
                    speakerGender: 'UNKNOWN',
                    speakerVisualHint: '',
                    deliveryType: 'dialogue',
                    genderConfidence: 0.5,
                    ocrStatus: 'verified_text',
                    isVerified: true,
                    isVerifiedEmpty: false,
                    ocrFailed: false,
                    reviewNeeded: false,
                    uncertainOcr: false,
                    ocrEngine: 'rapidocr-local',
                  });
                  localVerifiedCount++;
                }
              } else if (hasHanziA && hasHanziB && !sameSubtitleText(textA, textB)) {
                // Conflicting RapidOCR reads within one cue: block local self-certification so Gemini settles it cleanly
                disagreedTimestamps.add(tA);
                disagreedTimestamps.add(tB);
              }
            }
          }

          // Baseline frames: high-confidence local Chinese text continues without Gemini;
          // Reject pure-ASCII/non-Hanzi prop text and require neighbor confirmation or >= 0.94 conf for isolated 1-char hits.
          for (const cand of candidateTimestamps) {
            const t = cand.timestampSec;
            if (completedMap.has(t) || disagreedTimestamps.has(t)) continue;
            const loc = localMap.get(t);
            if (!loc) continue;

            const rawLocText = loc.hasText ? stripDecorativeSubtitleNoise(loc.chineseText || loc.textZh || '') : '';
            const locHasHanzi = Boolean(rawLocText && hasChineseHanzi(rawLocText));
            const normLocLen = locHasHanzi ? normalizeChineseChars(rawLocText).length : 0;
            const isSingleCharConfirmed = normLocLen > 1 || Array.from(localMap.values()).some(
              (other) => other !== loc && other.hasText && Math.abs((other.timestampSec || 0) - t) <= 1.1 && sameSubtitleText(rawLocText, other.chineseText || other.textZh || '')
            );

            if (locHasHanzi && isSingleCharConfirmed && (loc.confidence || 0) >= 0.85) {
              // High-confidence local text continues without Gemini
              completedMap.set(t, {
                timestampSec: t,
                reportedSec: t,
                hasText: true,
                textZh: rawLocText,
                chineseText: rawLocText,
                confidence: loc.confidence,
                isSharp: loc.confidence >= 0.70,
                position: loc.position || 'bottom_subtitle',
                visualGender: 'unknown',
                speakerGender: 'UNKNOWN',
                speakerVisualHint: '',
                deliveryType: 'dialogue',
                genderConfidence: 0.5,
                ocrStatus: 'verified_text',
                isVerified: true,
                isVerifiedEmpty: false,
                ocrFailed: false,
                reviewNeeded: false,
                uncertainOcr: false,
                ocrEngine: 'rapidocr-local',
              });
              localVerifiedCount++;
            } else if ((!loc.hasText || !locHasHanzi) && (loc.confidence || 0) >= 0.70) {
              // Independent supporting evidence: verify empty ONLY if surrounded by verified empty frames
              // within a static window where max subtitle difference is < 1.0 (subDiff < 1.0)
              const prevVerified = Array.from(completedMap.values())
                .filter((o) => o.timestampSec < t && o.isVerifiedEmpty)
                .pop();
              const hasIndependentEmptyContext = Boolean(
                prevVerified &&
                Math.abs(t - prevVerified.timestampSec) <= 1.5 &&
                getMaxSubtitleDiffBetween(prevVerified.timestampSec, t) < 1.0
              );

              if (hasIndependentEmptyContext) {
                completedMap.set(t, {
                  timestampSec: t,
                  reportedSec: t,
                  hasText: false,
                  textZh: '',
                  chineseText: '',
                  confidence: loc.confidence,
                  isSharp: true,
                  position: 'bottom_subtitle',
                  visualGender: 'unknown',
                  speakerGender: 'UNKNOWN',
                  speakerVisualHint: '',
                  deliveryType: 'dialogue',
                  genderConfidence: 0.5,
                  ocrStatus: 'verified_empty',
                  isVerified: true,
                  isVerifiedEmpty: true,
                  ocrFailed: false,
                  reviewNeeded: false,
                  uncertainOcr: false,
                  ocrEngine: 'rapidocr-local',
                });
                localVerifiedCount++;
              }
              // If no independent supporting evidence, frame remains unverified and routes to Gemini Vision
            }
          }

          console.log(`[Stage 3 OCR] 🎯 Hybrid Router: ${localVerifiedCount} frame observations verified locally (${completedMap.size} total verified). Queuing remaining uncertain frames for Gemini...`);

          for (const t of completedMap.keys()) unresolvedMap.delete(t);

          // Checkpoint save after local OCR
          if (checkpointPath) {
            saveProgress({
              version: 1,
              videoPath,
              startOffsetSec: Math.round(startOffsetSec),
              durationSec: Math.round(durationSec),
              updatedAt: Date.now(),
              rawObservations: [...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values())].sort((a, b) => a.timestampSec - b.timestampSec),
              completedBatchesCount: 0,
              totalCandidateFrames,
              completed: unresolvedMap.size === 0 && completedMap.size === totalCandidateFrames,
              hasUnresolvedFrames: unresolvedMap.size > 0,
              unresolvedCount: unresolvedMap.size,
            });
          }
        }
      }
    }

    // 3. Adaptive Batch Scheduler with Per-Batch Checkpointing & Concurrency Backoff
    const INITIAL_BATCH_SIZE = fastOcrActive ? 10 : 15;

    // Filter candidate frames against completed observations from checkpoint / local OCR
    const pendingFrames = framesToAnalyze.filter((f) => {
      const t = parseFloat(f.timestampSec.toFixed(2));
      return !completedMap.has(t);
    });
    const pendingGeminiFramesCount = pendingFrames.length;
    console.log(
      `[Stage 3 Extract Subtitles] Running Gemini Vision OCR on ${pendingGeminiFramesCount} pending Gemini frames (${completedMap.size}/${totalCandidateFrames} total candidate frames already verified)...`
    );

    const batchQueue = [];
    for (let i = 0; i < pendingFrames.length; i += INITIAL_BATCH_SIZE) {
      const slice = pendingFrames.slice(i, i + INITIAL_BATCH_SIZE);
      const startT = slice[0].timestampSec.toFixed(2);
      const endT = slice[slice.length - 1].timestampSec.toFixed(2);
      batchQueue.push({
        batchId: `batch_${startT}_${endT}_${i}`,
        frames: slice,
        splitDepth: 0,
      });
    }

    let completedBatchesCount = Math.floor(completedMap.size / INITIAL_BATCH_SIZE);
    let totalBatchesEstimated = completedBatchesCount + batchQueue.length;
    const poolKeys = Array.isArray(aiClient?.pool?.keys) ? aiClient.pool.keys : [];
    const healthyKeyCount = poolKeys.length > 0 ? poolKeys.length : 4;
    let adaptiveConcurrency = fastOcrActive ? Math.min(4, Math.max(2, healthyKeyCount)) : 2;
    let consecutiveSuccesses = 0;
    let failedBatchesCount = 0;
    let recoveredBatchesCount = 0;
    const inFlightBatchKeys = new Set(); // Prevents concurrent retries of same batch (Requirement 13)

    const reportProgress = (statusMsg = '') => {
      if (typeof onProgress === 'function') {
        onProgress({
          stage: 'stage3_ocr',
          completedBatches: completedBatchesCount,
          totalBatches: Math.max(completedBatchesCount, totalBatchesEstimated),
          completedFrames: completedMap.size,
          totalFrames: totalCandidateFrames,
          modelUsed: activeWorkingModel,
          retriesCount,
          concurrency: adaptiveConcurrency,
          statusMessage: statusMsg,
        });
      }
    };

    reportProgress(resumedFromCheckpoint ? `Resumed (${completedMap.size}/${totalCandidateFrames} frames from checkpoint)` : 'Starting Vision OCR...');

    const geminiBatchStart = Date.now();
    while (batchQueue.length > 0) {
      checkAbort();

      const currentWave = [];
      while (currentWave.length < adaptiveConcurrency && batchQueue.length > 0) {
        const nextBatch = batchQueue.shift();
        if (inFlightBatchKeys.has(nextBatch.batchId)) continue;
        inFlightBatchKeys.add(nextBatch.batchId);
        currentWave.push(nextBatch);
      }

      if (currentWave.length === 0) break;

      const waveResults = await Promise.allSettled(
        currentWave.map(async (batch) => {
          checkAbort();
          const observations = await executeSingleVisionBatch(batch.frames);
          return { batch, observations };
        })
      );

      for (let wIdx = 0; wIdx < waveResults.length; wIdx++) {
        const item = waveResults[wIdx];
        const originalBatch = currentWave[wIdx];
        inFlightBatchKeys.delete(originalBatch.batchId);

        if (item.status === 'fulfilled') {
          const obsList = item.value.observations || [];
          const verifiedObsList = obsList.filter((obs) => obs.isVerified);
          const unverifiedObsList = obsList.filter((obs) => !obs.isVerified);

          for (const obs of verifiedObsList) {
            const t = parseFloat(obs.timestampSec.toFixed(2));
            const existing = completedMap.get(t);
            if (existing && existing.userOverridden) continue;
            if (existing && existing.hasText && existing.chineseText && (!obs.hasText || !obs.chineseText)) continue;
            completedMap.set(t, { ...obs, ocrEngine: 'gemini-vision' });
            unresolvedMap.delete(t);
            geminiVerifiedCount++;
          }

          if (unverifiedObsList.length > 0) {
            console.warn(`[Stage 3 OCR] ⚠️ Batch at ${originalBatch.frames[0]?.timestampSec}s returned ${verifiedObsList.length}/${obsList.length} verified frames (${unverifiedObsList.length} missing/unresolved).`);

            const missingFramesToRetry = originalBatch.frames.filter((f) => {
              const t = parseFloat(f.timestampSec.toFixed(2));
              return !completedMap.has(t);
            });

            if (missingFramesToRetry.length > 0 && (originalBatch.splitDepth || 0) < 3) {
              const subBatch = {
                batchId: `${originalBatch.batchId}_retry_unres_${Date.now()}`,
                frames: missingFramesToRetry,
                splitDepth: (originalBatch.splitDepth || 0) + 1,
              };
              totalBatchesEstimated += 1;
              batchQueue.unshift(subBatch);
              console.log(`[Stage 3 OCR] 🔄 Queued retry for ${missingFramesToRetry.length} unresolved frame(s)...`);
            } else {
              for (const unres of unverifiedObsList) {
                const t = parseFloat(unres.timestampSec.toFixed(2));
                unresolvedMap.set(t, unres);
              }
              failedBatchesCount++;
            }
          }

          if (verifiedObsList.length > 0) {
            completedBatchesCount++;
            geminiBatchCount++;
            consecutiveSuccesses++;

            // Fast OCR / standard recovery: restore concurrency when demonstrated successes
            const maxAllowedConcurrency = fastOcrActive ? Math.min(4, Math.max(2, healthyKeyCount)) : 2;
            if (consecutiveSuccesses >= 2 && adaptiveConcurrency < maxAllowedConcurrency) {
              adaptiveConcurrency = Math.min(maxAllowedConcurrency, adaptiveConcurrency + 1);
              console.log(`[Stage 3 OCR] ⚡ Concurrency restored to ${adaptiveConcurrency} after consecutive successes`);
            }
          }

          // Persist atomically after each verified batch (Requirement 7)
          if (checkpointPath) {
            saveProgress({
              version: 1,
              videoPath,
              startOffsetSec: Math.round(startOffsetSec),
              durationSec: Math.round(durationSec),
              updatedAt: Date.now(),
              rawObservations: [...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values())].sort((a, b) => a.timestampSec - b.timestampSec),
              completedBatchesCount,
              totalCandidateFrames,
              completed: unresolvedMap.size === 0 && completedMap.size === totalCandidateFrames,
              hasUnresolvedFrames: unresolvedMap.size > 0,
              unresolvedCount: unresolvedMap.size,
            });
          }

          reportProgress(`Batch processed (${completedMap.size}/${totalCandidateFrames} frames verified${unresolvedMap.size > 0 ? `, ${unresolvedMap.size} unresolved` : ''})`);
        } else {
          // Failure on this batch
          retriesCount++;
          const batchErr = item.reason || new Error('Batch failed');
          if (batchErr?.name === 'AbortError' || signal?.aborted) {
            throw batchErr?.name === 'AbortError' ? batchErr : createAbortError('Stage 3 OCR aborted');
          }

          lastBatchError = batchErr.message;
          consecutiveSuccesses = 0;

          // Adaptive concurrency reduction (Requirement 5)
          const is429QuotaErr = Boolean(
            batchErr?.status === 429 ||
            String(batchErr?.message || '').includes('429') ||
            String(batchErr?.message || '').includes('RESOURCE_EXHAUSTED')
          );
          if (fastOcrActive) {
            if (is429QuotaErr && adaptiveConcurrency > 2) {
              adaptiveConcurrency = Math.max(2, adaptiveConcurrency - 1);
              console.warn(`[Stage 3 OCR] ⚠️ 429 Quota rate limit detected on batch at ${originalBatch.frames[0]?.timestampSec}s. Adjusted concurrency to ${adaptiveConcurrency}.`);
            } else if (!is429QuotaErr && adaptiveConcurrency > 3) {
              adaptiveConcurrency = Math.max(3, adaptiveConcurrency - 1);
            }
          } else {
            if (adaptiveConcurrency > 1) {
              console.warn(`[Stage 3 OCR] ⚠️ Overload detected on batch at ${originalBatch.frames[0]?.timestampSec}s. Reducing concurrency to 1.`);
              adaptiveConcurrency = 1;
            }
          }

          // Adaptive batch splitting without discarding source frames (Requirement 6)
          if (originalBatch.frames.length > 1) {
            batchSplitsCount++;
            const mid = Math.ceil(originalBatch.frames.length / 2);
            const subBatch1 = {
              batchId: `${originalBatch.batchId}_s1`,
              frames: originalBatch.frames.slice(0, mid),
              splitDepth: (originalBatch.splitDepth || 0) + 1,
            };
            const subBatch2 = {
              batchId: `${originalBatch.batchId}_s2`,
              frames: originalBatch.frames.slice(mid),
              splitDepth: (originalBatch.splitDepth || 0) + 1,
            };
            totalBatchesEstimated += 1;
            batchQueue.unshift(subBatch2);
            batchQueue.unshift(subBatch1);
            console.warn(
              `[Stage 3 OCR] 🔀 Batch at ${originalBatch.frames[0]?.timestampSec}s failed (${lastBatchError}). Split into sub-batches (${subBatch1.frames.length} & ${subBatch2.frames.length} frames) without discarding frames. (Total splits: ${batchSplitsCount})`
            );
            recoveredBatchesCount++;
          } else {
            // Single frame batch that failed repeatedly across all models
            // Mark unresolved OCR as failed/review_needed without classifying as completed
            const failedFrame = originalBatch.frames[0];
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
              ocrStatus: 'failed',
              ocrFailed: true,
              isVerified: false,
              isVerifiedEmpty: false,
              reviewNeeded: true,
              uncertainOcr: true,
              failureReason: lastBatchError || 'Exhausted retries across cascade models',
            };
            const t = parseFloat(failedFrame.timestampSec.toFixed(2));
            unresolvedMap.set(t, fallbackObs);
            failedBatchesCount++;
            console.warn(`[Stage 3 OCR] ⚠️ Frame at ${failedFrame.timestampSec}s unresolved after retries. Marked as review_needed (not completed).`);

            if (checkpointPath) {
              saveProgress({
                version: 1,
                videoPath,
                startOffsetSec: Math.round(startOffsetSec),
                durationSec: Math.round(durationSec),
                updatedAt: Date.now(),
                rawObservations: [...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values())].sort((a, b) => a.timestampSec - b.timestampSec),
                completedBatchesCount,
                totalCandidateFrames,
                completed: false,
                hasUnresolvedFrames: true,
                unresolvedCount: unresolvedMap.size,
              });
            }
          }
        }
      }

      const pacingMs = fastOcrActive ? 100 : (adaptiveConcurrency === 1 ? 750 : 350);
      if (batchQueue.length > 0) {
        await sleepOrAbort(pacingMs, signal);
      }
    }
    geminiVerificationMs = Date.now() - geminiBatchStart;

    // Account for all candidate frames:
    for (const c of candidateTimestamps) {
      const t = parseFloat(Number(c.timestampSec).toFixed(2));
      if (!completedMap.has(t) && !unresolvedMap.has(t)) {
        unresolvedMap.set(t, {
          timestampSec: t,
          reportedSec: t,
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
          ocrStatus: 'missing',
          ocrFailed: true,
          isVerified: false,
          isVerifiedEmpty: false,
          reviewNeeded: true,
          uncertainOcr: true,
          failureReason: 'Frame unreached during batch execution',
        });
      }
    }
    function getObservation(targetT) {
      const roundedT = parseFloat(Number(targetT).toFixed(2));
      if (completedMap.has(roundedT)) {
        return completedMap.get(roundedT);
      }
      if (unresolvedMap.has(roundedT)) {
        return unresolvedMap.get(roundedT);
      }
      return { timestampSec: targetT, hasText: false, chineseText: '', isVerified: false, ocrStatus: 'missing', ocrFailed: true };
    }

    // 4. STEP 2: Double-Read Verification per Candidate Cue State
    evaluatedCueStates.length = 0;
    const statesNeedingTieBreak = [];

    const hasSampleObservation = (targetT) => {
      const roundedT = parseFloat(Number(targetT).toFixed(2));
      return completedMap.has(roundedT) || unresolvedMap.has(roundedT);
    };
    const useMidpointOnlyEvaluation = isFastOcr && !effectiveEnableLocalOcr && cueStates.length > 0 && cueStates.every(
      (cs) => !hasSampleObservation(cs.sampleASec) && !hasSampleObservation(cs.sampleBSec)
    );

    if (useMidpointOnlyEvaluation) {
      for (const cs of cueStates) {
        const midSec = Number(((cs.startSec + cs.endSec) / 2).toFixed(2));
        const secondSec = cs.duration >= 1.2 ? Number((cs.startSec + cs.duration * 0.75).toFixed(2)) : null;
        const obs = getObservation(midSec) || getObservation(cs.sampleASec) || (secondSec ? getObservation(secondSec) : null);
        if (obs && obs.hasText && obs.chineseText && hasChineseHanzi(obs.chineseText)) {
          evaluatedCueStates.push({
            ...cs,
            textZh: obs.chineseText,
            originalChineseText: obs.chineseText,
            chineseText: obs.chineseText,
            position: obs.position || 'bottom_subtitle',
            ocrConfidence: obs.reviewNeeded ? 'medium' : 'high',
            reviewNeeded: Boolean(obs.reviewNeeded),
            ocrDisagreement: false,
            uncertainOcr: Boolean(obs.uncertainOcr),
            visualGender: obs.visualGender || obs.speakerGender || 'unknown',
            speakerVisualHint: obs.speakerVisualHint || '',
            deliveryType: obs.deliveryType || 'dialogue',
            genderVotes: {
              [obs.visualGender || obs.speakerGender || 'unknown']: 1,
            },
          });
        }
      }
    } else if (cueStates.length > 0) {
      for (const cs of cueStates) {
        const obsA = getObservation(cs.sampleASec);
        const obsB = getObservation(cs.sampleBSec);

        const textA = (obsA && obsA.hasText && obsA.chineseText && hasChineseHanzi(obsA.chineseText)) ? obsA.chineseText : '';
        const textB = (obsB && obsB.hasText && obsB.chineseText && hasChineseHanzi(obsB.chineseText)) ? obsB.chineseText : '';
        const hasA = Boolean(textA);
        const hasB = Boolean(textB);

        // If neither frame contained text, this state is non-dialogue (motion or silence)
        if (!hasA && !hasB) {
          continue;
        }

        // If both reads have text and are equivalent -> ACCEPT with high confidence
        if (hasA && hasB && sameSubtitleText(textA, textB)) {
          const resolvedText = textA.length >= textB.length ? textA : textB;
          const gA = obsA.visualGender || obsA.speakerGender || 'unknown';
          const gB = obsB.visualGender || obsB.speakerGender || 'unknown';
          const resolvedVisualGender = gA === gB ? gA : (gA !== 'unknown' ? gA : gB);
          const resolvedVisualHint = obsA.speakerVisualHint || obsB.speakerVisualHint || '';
          const resolvedDelivery = (obsA.deliveryType && obsA.deliveryType !== 'dialogue')
            ? obsA.deliveryType
            : (obsB.deliveryType || 'dialogue');
          evaluatedCueStates.push({
            ...cs,
            textZh: resolvedText,
            originalChineseText: resolvedText,
            chineseText: resolvedText,
            position: (obsA.position && obsA.position !== 'bottom_subtitle') ? obsA.position : (obsB.position || 'bottom_subtitle'),
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            visualGender: resolvedVisualGender,
            speakerVisualHint: resolvedVisualHint,
            deliveryType: resolvedDelivery,
            genderVotes: {
              [gA]: 1,
              [gB]: (gA === gB ? 2 : 1),
            },
          });
        } else if (hasA && hasB && !sameSubtitleText(textA, textB)) {
          // Guard against splitting 1-2 char OCR typo variants (e.g. 占卜一下 vs 占下一下) into 2 corrupt cues!
          const normA = normalizeChineseChars(textA);
          const normB = normalizeChineseChars(textB);
          const simRatio = computeNormalizedTextSimilarity(textA, textB);
          const subDiffAB = getMaxSubtitleDiffBetween(cs.sampleASec, cs.sampleBSec);
          const isSubstringOrPrefix = (normA.length >= 2 && normB.length >= 2) && (normA.includes(normB) || normB.includes(normA));
          const looksLikeGenuineRapidSplit = subDiffAB >= 8.0 && simRatio < 0.45 && !isSubstringOrPrefix;

          if (!looksLikeGenuineRapidSplit) {
            statesNeedingTieBreak.push({
              cueState: cs,
              obsA,
              obsB,
            });
            continue;
          }

          // Both frames have genuinely distinct sequential Chinese dialogue text across a strong visual transition!
          let splitT = parseFloat(((cs.sampleASec + cs.sampleBSec) / 2).toFixed(2));
          const idxA = Math.round((cs.sampleASec - safeStartSec) / stepDiff);
          const idxB = Math.round((cs.sampleBSec - safeStartSec) / stepDiff);
          let maxD = 0;
          for (let k = Math.max(0, idxA); k <= Math.min(frameDiffs.length - 1, idxB); k++) {
            const d = frameDiffs[k];
            if (d && (d.subDiff || 0) > maxD) {
              maxD = d.subDiff;
              splitT = d.timestampSec;
            }
          }
          const s1 = cs.startSec;
          const e1 = parseFloat(Math.max(s1 + 0.35, Math.min(cs.endSec - 0.35, splitT)).toFixed(2));
          const s2 = e1;
          const e2 = cs.endSec;

          const gA = obsA.visualGender || obsA.speakerGender || 'unknown';
          const gB = obsB.visualGender || obsB.speakerGender || 'unknown';

          evaluatedCueStates.push({
            ...cs,
            startSec: s1,
            endSec: e1,
            duration: parseFloat((e1 - s1).toFixed(2)),
            textZh: textA,
            originalChineseText: textA,
            chineseText: textA,
            position: obsA.position || 'bottom_subtitle',
            ocrConfidence: obsA.isSharp ? 'high' : 'medium',
            reviewNeeded: !obsA.isSharp,
            ocrDisagreement: false,
            uncertainOcr: !obsA.isSharp,
            visualGender: gA,
            speakerVisualHint: obsA.speakerVisualHint || '',
            deliveryType: obsA.deliveryType || 'dialogue',
            genderVotes: { [gA]: 1 },
          });

          evaluatedCueStates.push({
            ...cs,
            startSec: s2,
            endSec: e2,
            duration: parseFloat((e2 - s2).toFixed(2)),
            textZh: textB,
            originalChineseText: textB,
            chineseText: textB,
            position: obsB.position || 'bottom_subtitle',
            ocrConfidence: obsB.isSharp ? 'high' : 'medium',
            reviewNeeded: !obsB.isSharp,
            ocrDisagreement: false,
            uncertainOcr: !obsB.isSharp,
            visualGender: gB,
            speakerVisualHint: obsB.speakerVisualHint || '',
            deliveryType: obsB.deliveryType || 'dialogue',
            genderVotes: { [gB]: 1 },
          });
        } else if (hasA && !hasB && obsA.isSharp) {
          // Short dialogue cue (< 1s): textA appeared at startSec and ended before sampleBSec
          let disappearT = parseFloat((cs.sampleBSec - 0.05).toFixed(2));
          const idxA = Math.round((cs.sampleASec - safeStartSec) / stepDiff);
          const idxB = Math.round((cs.sampleBSec - safeStartSec) / stepDiff);
          for (let k = Math.max(0, idxA); k <= Math.min(frameDiffs.length - 1, idxB); k++) {
            const d = frameDiffs[k];
            if (d && (d.isChange || d.subDiff >= 10.0)) {
              disappearT = d.timestampSec;
              break;
            }
          }
          const eSec = parseFloat(Math.max(cs.startSec + 0.35, Math.min(cs.endSec, disappearT)).toFixed(2));
          const gA = obsA.visualGender || obsA.speakerGender || 'unknown';
          evaluatedCueStates.push({
            ...cs,
            endSec: eSec,
            duration: parseFloat((eSec - cs.startSec).toFixed(2)),
            textZh: textA,
            originalChineseText: textA,
            chineseText: textA,
            position: obsA.position || 'bottom_subtitle',
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            visualGender: gA,
            speakerVisualHint: obsA.speakerVisualHint || '',
            deliveryType: obsA.deliveryType || 'dialogue',
            genderVotes: { [gA]: 1 },
          });
        } else if (!hasA && hasB && obsB.isSharp) {
          // Dialogue cue appeared near sampleBSec
          let appearT = parseFloat((cs.sampleASec + 0.05).toFixed(2));
          const idxA = Math.round((cs.sampleASec - safeStartSec) / stepDiff);
          const idxB = Math.round((cs.sampleBSec - safeStartSec) / stepDiff);
          for (let k = Math.min(frameDiffs.length - 1, idxB); k >= Math.max(0, idxA); k--) {
            const d = frameDiffs[k];
            if (d && (d.isChange || d.subDiff >= 10.0)) {
              appearT = d.timestampSec;
              break;
            }
          }
          const sSec = parseFloat(Math.max(cs.startSec, Math.min(cs.endSec - 0.35, appearT)).toFixed(2));
          const gB = obsB.visualGender || obsB.speakerGender || 'unknown';
          evaluatedCueStates.push({
            ...cs,
            startSec: sSec,
            duration: parseFloat((cs.endSec - sSec).toFixed(2)),
            textZh: textB,
            originalChineseText: textB,
            chineseText: textB,
            position: obsB.position || 'bottom_subtitle',
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            visualGender: gB,
            speakerVisualHint: obsB.speakerVisualHint || '',
            deliveryType: obsB.deliveryType || 'dialogue',
            genderVotes: { [gB]: 1 },
          });
        } else {
          // Disagreement (either one frame had text and one didn't, or different texts)
          statesNeedingTieBreak.push({
            cueState: cs,
            obsA,
            obsB,
          });
        }
      }

      // Execute tie-break read if any disagreements occurred
      if (statesNeedingTieBreak.length > 0) {
        checkAbort();
        const tieBreakStart = Date.now();
        console.log(`[Stage 3 OCR] Executing tie-break verification for ${statesNeedingTieBreak.length} candidate cue states...`);
        const tieTimes = [...new Set(statesNeedingTieBreak.map((n) => n.cueState.sampleTieSec))]
          .filter(t => !completedMap.has(t));
        const tieExtractStart = Date.now();
        let tieFrames = [];
        try {
          if (tieTimes.length) tieFrames = await extractFramesAtTimestamps(videoPath, tieTimes, tempDir, { signal });
        } catch (tieErr) {
          if (tieErr?.name === 'AbortError' || signal?.aborted) {
            throw tieErr?.name === 'AbortError' ? tieErr : createAbortError('Stage 3 OCR aborted');
          }
          tieFrames = [];
        }

        frameExtractionMs += Date.now() - tieExtractStart;
        const tieVisionStart = Date.now();
        if (tieFrames.length > 0) {
          for (let ti = 0; ti < tieFrames.length; ti += 15) {
            const tieSlice = tieFrames.slice(ti, ti + 15);
            try {
              const tieObsList = await executeSingleVisionBatch(tieSlice);
              for (const tobs of tieObsList) {
                const t = parseFloat(tobs.timestampSec.toFixed(2));
                if (tobs.isVerified) {
                  completedMap.set(t, tobs);
                  unresolvedMap.delete(t);
                } else {
                  unresolvedMap.set(t, tobs);
                }

              }
              if (checkpointPath) {
                saveProgress({
                  version: 1,
                  videoPath,
                  startOffsetSec: Math.round(startOffsetSec),
                  durationSec: Math.round(durationSec),
                  updatedAt: Date.now(),
                  rawObservations: [...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values())].sort((a, b) => a.timestampSec - b.timestampSec),
                  completedBatchesCount,
                  totalCandidateFrames,
                  completed: unresolvedMap.size === 0,
                  hasUnresolvedFrames: unresolvedMap.size > 0,
                  unresolvedCount: unresolvedMap.size,
                });
              }
            } catch (tieErr) {
              checkAbort();
              console.warn(`[Stage 3 OCR] Tie-break batch call failed: ${tieErr.message}`);
            }
          }
        }
        geminiVerificationMs += Date.now() - tieVisionStart;
        tieBreakMs = Date.now() - tieBreakStart;

        // Resolve each disagreement using tie-break read
        for (const item of statesNeedingTieBreak) {
          const { cueState: cs, obsA, obsB } = item;
          const obsTie = getObservation(cs.sampleTieSec);

          const textA = (obsA && obsA.hasText && hasChineseHanzi(obsA.chineseText)) ? obsA.chineseText : '';
          const textB = (obsB && obsB.hasText && hasChineseHanzi(obsB.chineseText)) ? obsB.chineseText : '';
          const textTie = (obsTie && obsTie.hasText && hasChineseHanzi(obsTie.chineseText)) ? obsTie.chineseText : '';

          let resolvedText = '';
          let ocrConfidence = 'high';
          let reviewNeeded = false;
          let ocrDisagreement = false;
          let uncertainOcr = false;

          // Check pairwise majority
          if (textTie && textB && sameSubtitleText(textTie, textB)) {
            // Majority (2 of 3) votes for Sample B
            resolvedText = textB.length >= textTie.length ? textB : textTie;
          } else if (textTie && textA && sameSubtitleText(textTie, textA)) {
            // Majority (2 of 3) votes for Sample A
            resolvedText = textA.length >= textTie.length ? textA : textTie;
          } else if (textA && textB && sameSubtitleText(textA, textB)) {
            resolvedText = textA.length >= textB.length ? textA : textB;
          } else if (textTie && obsTie?.ocrEngine === 'gemini-vision' && obsTie?.isSharp !== false) {
            // Gemini Vision tie-break settles conflicting local OCR reads cleanly
            resolvedText = textTie;
            ocrConfidence = 'medium';
            reviewNeeded = false;
            ocrDisagreement = true;
            uncertainOcr = false;
          } else {
            // Still unresolved! Keep Gemini-verified read first if available, else first non-empty read, and flag review
            const geminiPick = [obsA, obsB, obsTie].find((o) => o?.ocrEngine === 'gemini-vision' && o?.hasText && hasChineseHanzi(o?.chineseText));
            resolvedText = (geminiPick?.chineseText) || textTie || textA || textB;
            ocrConfidence = 'low';
            reviewNeeded = true;
            ocrDisagreement = true;
            uncertainOcr = true;
          }

          if (resolvedText) {
            const votes = { male: 0, female: 0, unknown: 0 };
            let resolvedVisualHint = '';
            let resolvedDelivery = 'dialogue';
            [obsA, obsB, obsTie].forEach((o) => {
              if (!o) return;
              const g = o.visualGender || o.speakerGender;
              if (g) votes[g] = (votes[g] || 0) + 1;
              if (!resolvedVisualHint && o.speakerVisualHint) resolvedVisualHint = o.speakerVisualHint;
              if (resolvedDelivery === 'dialogue' && o.deliveryType && o.deliveryType !== 'dialogue') {
                resolvedDelivery = o.deliveryType;
              }
            });
            const resolvedVisualGender = votes.female > votes.male && votes.female > 0
              ? 'female'
              : (votes.male > votes.female && votes.male > 0 ? 'male' : 'unknown');

            evaluatedCueStates.push({
              ...cs,
              textZh: resolvedText,
              originalChineseText: resolvedText,
              chineseText: resolvedText,
              position: (obsA?.position && obsA.position !== 'bottom_subtitle') ? obsA.position : ((obsB?.position && obsB.position !== 'bottom_subtitle') ? obsB.position : (obsTie?.position || 'bottom_subtitle')),
              ocrConfidence,
              reviewNeeded,
              ocrDisagreement,
              uncertainOcr,
              visualGender: resolvedVisualGender,
              speakerVisualHint: resolvedVisualHint,
              deliveryType: resolvedDelivery,
              genderVotes: votes,
            });
          }
        }
      }
    }

    // Unresolved OCR frames remain in unresolvedMap (never auto-classified as verified_empty).
    if (unresolvedMap.size > 0) {
      console.warn(`[Stage 3 Extract Subtitles] ⚠️ ${unresolvedMap.size} OCR frame(s) remain unresolved/failed and will NOT be marked verified_empty.`);
    }

    rawObservations.length = 0;
    rawObservations.push(...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values()));
    rawObservations.sort((a, b) => a.timestampSec - b.timestampSec);
    const hasUnresolvedFrames = unresolvedMap.size > 0;
    const isComplete = !hasUnresolvedFrames;

    if (apiCallsCount > 0 && retriesCount >= apiCallsCount) {
      console.warn(`[Stage 3 Extract Subtitles] Notice: Vision OCR batch calls failed (${lastBatchError}). Continuing with Audio ASR as primary source.`);
    }

  function resolveGenderFromVotes(genderVotes = {}, explicitVisualGender = null) {
    const mCount = genderVotes.male || 0;
    const fCount = genderVotes.female || 0;
    const uCount = genderVotes.unknown || 0;
    const total = mCount + fCount + uCount;

    let resolvedGender = 'unknown';
    let resolvedConfidence = 0.5;

    if (fCount > mCount && fCount > 0) {
      resolvedGender = 'female';
      resolvedConfidence = parseFloat((fCount / Math.max(1, total)).toFixed(2));
    } else if (mCount > fCount && mCount > 0) {
      resolvedGender = 'male';
      resolvedConfidence = parseFloat((mCount / Math.max(1, total)).toFixed(2));
    } else if (explicitVisualGender === 'female' || explicitVisualGender === 'male') {
      resolvedGender = explicitVisualGender;
      resolvedConfidence = 0.85;
    }

    const voiceGender = resolvedGender === 'female' ? 'female' : (resolvedGender === 'male' ? 'male' : 'unknown');
    const khmerVoiceId = voiceGender === 'female' ? 'km-KH-SreymomNeural' : (voiceGender === 'male' ? 'km-KH-PisethNeural' : 'km-KH-PisethNeural');

    return {
      visualGender: resolvedGender,
      speakerGender: resolvedGender.toUpperCase(),
      voiceGender,
      gender: voiceGender,
      genderConfidence: resolvedConfidence,
      khmerVoiceId,
      voiceId: khmerVoiceId,
    };
  }

  // STEP 2B: Recover valid rawObservations with text that were not covered in evaluatedCueStates
  if (Array.isArray(rawObservations) && rawObservations.length > 0) {
    const uncapturedObservations = rawObservations.filter((obs) => {
      if (!obs.hasText || !obs.chineseText || !hasChineseHanzi(obs.chineseText) || normalizeChineseChars(obs.chineseText).length === 0) {
        return false;
      }
      const isCovered = evaluatedCueStates.some((c) => {
        return (c.startSec - 0.25 <= obs.timestampSec && obs.timestampSec <= c.endSec + 0.25) &&
          sameSubtitleText(c.originalChineseText, obs.chineseText);
      });
      return !isCovered;
    });

    if (uncapturedObservations.length > 0) {
      console.log(`[Stage 3 OCR] Recovering ${uncapturedObservations.length} valid subtitle observation(s) outside primary cue states...`);
      const stepDiff = 0.2;
      const safeStartSec = Math.max(0, Number(startOffsetSec) || 0);
      const endSec = durationSec > 0 ? safeStartSec + durationSec : (safeStartSec + 10);
      const sortedUncaptured = [...uncapturedObservations].sort((a, b) => a.timestampSec - b.timestampSec);
      let prevRecoveredEnd = safeStartSec;
      for (const obs of sortedUncaptured) {
        const t = obs.timestampSec;
        const tIdx = Math.round((t - safeStartSec) / stepDiff);
        let onset = Math.max(safeStartSec, t - 0.5);
        for (let k = tIdx; k >= Math.max(0, tIdx - 10); k--) {
          const d = frameDiffs[k];
          if (d && (d.isChange || d.subDiff >= 10.0)) {
            onset = d.timestampSec;
            break;
          }
        }
        // Prevent distinct sequential recovered observations from snapping onto the same earlier onset
        const prevObsDistinct = rawObservations
          .filter((o) => o.timestampSec < t && o.hasText && !isExactChineseSubtitleMatch(o.chineseText, obs.chineseText))
          .pop();
        const floorOnset = Math.max(
          safeStartSec,
          prevObsDistinct ? parseFloat((prevObsDistinct.timestampSec + 0.05).toFixed(2)) : safeStartSec,
          prevRecoveredEnd <= t ? prevRecoveredEnd : safeStartSec
        );
        if (onset < floorOnset && floorOnset < t) {
          onset = floorOnset;
        }
        let offset = Math.min(endSec, t + 1.0);
        for (let k = tIdx + 1; k <= Math.min(frameDiffs.length - 1, tIdx + 12); k++) {
          const d = frameDiffs[k];
          if (d && (d.isChange || d.subDiff >= 10.0)) {
            offset = d.timestampSec;
            break;
          }
        }
        const sSec = parseFloat(Math.max(safeStartSec, onset).toFixed(2));
        const eSec = parseFloat(Math.max(sSec + 0.35, offset).toFixed(2));
        const dur = parseFloat((eSec - sSec).toFixed(2));
        prevRecoveredEnd = Math.max(prevRecoveredEnd, eSec);

        evaluatedCueStates.push({
          startSec: sSec,
          endSec: eSec,
          duration: dur,
          textZh: obs.chineseText,
          originalChineseText: obs.chineseText,
          chineseText: obs.chineseText,
          position: obs.position || 'bottom_subtitle',
          ocrConfidence: obs.isSharp ? 'high' : 'medium',
          reviewNeeded: !obs.isSharp,
          ocrDisagreement: false,
          uncertainOcr: !obs.isSharp,
          visualGender: obs.visualGender || 'unknown',
          speakerVisualHint: obs.speakerVisualHint || '',
          deliveryType: obs.deliveryType || 'dialogue',
          genderVotes: { [obs.visualGender || 'unknown']: 1 },
        });
      }
    }
  }

  // STEP 3: Boundaries from change points & Deduplication
  const visualSegments = [];

  if (evaluatedCueStates && evaluatedCueStates.length > 0) {
    evaluatedCueStates.sort((a, b) => a.startSec - b.startSec);

    // Pass 2: Merge adjacent states ONLY when exact normalized Chinese text matches,
    // gap <= 0.25s, and no verified empty frame intervened between them.
    for (const cue of evaluatedCueStates) {
      if (visualSegments.length === 0) {
        visualSegments.push({ ...cue });
        continue;
      }
      const prev = visualSegments[visualSegments.length - 1];
      const gap = parseFloat((cue.startSec - prev.endSec).toFixed(2));
      const isAdjacent = gap <= 0.25;
      const isEquivalent = isExactChineseSubtitleMatch(prev.originalChineseText, cue.originalChineseText);
      const hasInterveningEmpty = gap > 0.05 && rawObservations.some(
        (o) => o.isVerifiedEmpty && o.timestampSec > prev.endSec + 0.02 && o.timestampSec < cue.startSec - 0.02
      );

      if (isAdjacent && isEquivalent && !hasInterveningEmpty) {
        prev.endSec = Math.max(prev.endSec, cue.endSec);
        prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
        if (cue.originalChineseText.length > prev.originalChineseText.length) {
          prev.originalChineseText = cue.originalChineseText;
          prev.chineseText = cue.originalChineseText;
          prev.textZh = cue.originalChineseText;
        }
        if (cue.ocrConfidence === 'low') {
          prev.ocrConfidence = 'low';
          prev.reviewNeeded = true;
          prev.ocrDisagreement = true;
          prev.uncertainOcr = true;
        }
        if (!prev.speakerVisualHint && cue.speakerVisualHint) {
          prev.speakerVisualHint = cue.speakerVisualHint;
        }
        if ((!prev.deliveryType || prev.deliveryType === 'dialogue') && cue.deliveryType && cue.deliveryType !== 'dialogue') {
          prev.deliveryType = cue.deliveryType;
        }
        if (cue.genderVotes) {
          for (const [k, v] of Object.entries(cue.genderVotes)) {
            prev.genderVotes[k] = (prev.genderVotes[k] || 0) + v;
          }
        }
      } else {
        // Prevent overlaps between distinct consecutive cues
        if (cue.startSec < prev.endSec) {
          prev.endSec = parseFloat(Math.max(prev.startSec + 0.35, cue.startSec).toFixed(2));
          prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
        }
        visualSegments.push({ ...cue });
      }
    }
  } else {
    // Fallback: Group continuous frame observations if cueStates was empty
    let currentSegment = null;
    for (let i = 0; i < rawObservations.length; i++) {
      const obs = rawObservations[i];
      if (!obs.hasText) {
        if (currentSegment) {
          const endSec = parseFloat(obs.timestampSec.toFixed(2));
          const dur = Math.max(0.35, parseFloat((endSec - currentSegment.startSec).toFixed(2)));
          const genderData = resolveGenderFromVotes(currentSegment.genderVotes, currentSegment.visualGender);
          visualSegments.push({
            ...currentSegment,
            endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
            duration: dur,
            verifiedDisappearance: true,
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            ...genderData,
          });
          currentSegment = null;
        }
        continue;
      }

      if (!currentSegment) {
        const startSec = parseFloat(obs.timestampSec.toFixed(2));
        const genderVotes = { male: 0, female: 0, unknown: 0 };
        const obsGender = obs.visualGender || obs.speakerGender;
        if (obsGender) genderVotes[obsGender] = (genderVotes[obsGender] || 0) + 1;

        currentSegment = {
          textZh: obs.chineseText,
          originalChineseText: obs.chineseText,
          startSec,
          lastObservedSec: startSec,
          position: obs.position,
          isSharp: obs.isSharp,
          frameCount: 1,
          source: 'visual_ocr',
          visualGender: obsGender || 'unknown',
          speakerVisualHint: obs.speakerVisualHint || '',
          deliveryType: obs.deliveryType || 'dialogue',
          genderVotes,
        };
      } else {
        const isContinuation = sameSubtitleText(obs.chineseText, currentSegment.originalChineseText);
        if (isContinuation) {
          currentSegment.lastObservedSec = parseFloat(obs.timestampSec.toFixed(2));
          currentSegment.frameCount++;
          if (obs.chineseText.length > currentSegment.originalChineseText.length) {
            currentSegment.originalChineseText = obs.chineseText;
            currentSegment.textZh = obs.chineseText;
          }
          const obsGender = obs.visualGender || obs.speakerGender;
          if (obsGender) {
            currentSegment.genderVotes[obsGender] = (currentSegment.genderVotes[obsGender] || 0) + 1;
          }
          if (!currentSegment.speakerVisualHint && obs.speakerVisualHint) {
            currentSegment.speakerVisualHint = obs.speakerVisualHint;
          }
          if (currentSegment.deliveryType === 'dialogue' && obs.deliveryType && obs.deliveryType !== 'dialogue') {
            currentSegment.deliveryType = obs.deliveryType;
          }
        } else {
          const endSec = parseFloat(obs.timestampSec.toFixed(2));
          const dur = Math.max(0.35, parseFloat((endSec - currentSegment.startSec).toFixed(2)));
          const genderData = resolveGenderFromVotes(currentSegment.genderVotes, currentSegment.visualGender);
          visualSegments.push({
            ...currentSegment,
            endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
            duration: dur,
            verifiedDisappearance: true,
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            ...genderData,
          });

          const startSec = parseFloat(obs.timestampSec.toFixed(2));
          const genderVotes = { male: 0, female: 0, unknown: 0 };
          const obsGender = obs.visualGender || obs.speakerGender;
          if (obsGender) genderVotes[obsGender] = (genderVotes[obsGender] || 0) + 1;

          currentSegment = {
            textZh: obs.chineseText,
            originalChineseText: obs.chineseText,
            startSec,
            lastObservedSec: startSec,
            position: obs.position,
            isSharp: obs.isSharp,
            frameCount: 1,
            source: 'visual_ocr',
            visualGender: obsGender || 'unknown',
            speakerVisualHint: obs.speakerVisualHint || '',
            deliveryType: obs.deliveryType || 'dialogue',
            genderVotes,
          };
        }
      }
    }

    if (currentSegment) {
      const estimatedEnd = currentSegment.lastObservedSec > currentSegment.startSec
        ? parseFloat((currentSegment.lastObservedSec + baseStepSec).toFixed(2))
        : parseFloat((currentSegment.startSec + 1.2).toFixed(2));
      const dur = Math.max(0.35, parseFloat((estimatedEnd - currentSegment.startSec).toFixed(2)));
      const genderData = resolveGenderFromVotes(currentSegment.genderVotes, currentSegment.visualGender);
      visualSegments.push({
        ...currentSegment,
        endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
        duration: dur,
        verifiedDisappearance: currentSegment.frameCount > 1,
        ocrConfidence: 'high',
        reviewNeeded: false,
        ocrDisagreement: false,
        uncertainOcr: false,
        ...genderData,
      });
    }
  }

  // Finalize segments with immutable sourceCueId, timecodes, gender resolution, and minimum duration 0.35s
  const chunkOffsetTag = Math.round(Math.max(0, Number(startOffsetSec) || 0) * 100);
  const finalizedVisualSegments = stripRepeatedLeadingTimeCardPrefix(visualSegments.map((s, idx) => {
    const rawDur = parseFloat((s.endSec - s.startSec).toFixed(2));
    const dur = Math.max(0.35, rawDur);
    const endSec = parseFloat((s.startSec + dur).toFixed(2));
    const genderData = resolveGenderFromVotes(s.genderVotes, s.visualGender);
    const resolvedChinese = s.originalChineseText || s.chineseText || s.textZh || '';
    const sourceCueId = s.sourceCueId || `cue_${chunkOffsetTag}_${Math.round(s.startSec * 100)}_${idx + 1}`;

    return {
      ...s,
      id: idx + 1,
      segmentId: idx + 1,
      sourceCueId,
      sourceStartSec: typeof s.sourceStartSec === 'number' ? s.sourceStartSec : s.startSec,
      sourceEndSec: typeof s.sourceEndSec === 'number' ? s.sourceEndSec : endSec,
      endSec,
      duration: dur,
      textZh: resolvedChinese,
      originalChineseText: resolvedChinese,
      chineseText: resolvedChinese,
      position: s.position || 'bottom_subtitle',
      visualGender: genderData.visualGender || s.visualGender || 'unknown',
      speakerVisualHint: s.speakerVisualHint || '',
      deliveryType: s.deliveryType || 'dialogue',
      ocrConfidence: s.ocrConfidence || 'high',
      reviewNeeded: Boolean(s.reviewNeeded),
      ocrDisagreement: Boolean(s.ocrDisagreement),
      uncertainOcr: Boolean(s.uncertainOcr || s.ocrConfidence === 'low'),
      source: 'visual_ocr',
      ...genderData,
    };
  }));

  ocrWallTimeMs = Date.now() - stage3StartTime;

  const performance = {
    wallTimeMs: ocrWallTimeMs,
    totalStage3Ms: ocrWallTimeMs,
    ffmpegPrepassMs,
    frameExtractionMs,
    localOcrMs,
    geminiVerificationMs,
    retrySleepMs: telemetry.retrySleepMs,
    tieBreakMs,
    candidateFramesCount: totalCandidateFrames,
    pendingGeminiFramesCount,
    localCheckpointReusedFramesCount: sortedTimes.filter(t => localOnResume.has(t) && !verifiedOnResume.has(t)).length,
    checkpointReusedFramesCount: sortedTimes.filter(t => verifiedOnResume.has(t)).length,
    localAvailabilityMs,
    ...localTelemetry,
    localOcrFramesCount,
    actualOcrFramesCount,
    localVerifiedCount,
    geminiVerifiedCount,
    geminiActualAttemptsCount: telemetry.attempts || 0,
    geminiBatchCount,
    geminiFallbackFramesCount: geminiRequestedTimes.size,
    dedupedFramesCount,
    unresolvedFramesCount: unresolvedMap.size,
    finalChineseCuesCount: finalizedVisualSegments.length,
    workerStartupMs,
    rapidOcrInitMs,
    avgMsPerFrame,
    peakMemoryMb: parseFloat((process.resourceUsage().maxRSS / 1024).toFixed(1)),
    ocrEngineMode,
    geminiUsage: {
      requests: apiCallsCount,
      attempts: telemetry.attempts || 0,
      successfulCalls: telemetry.successfulCalls || 0,
      promptTokens: telemetry.promptTokens || 0,
      outputTokens: telemetry.outputTokens || 0,
      totalTokens: telemetry.totalTokens || 0,
    },
  };

  const ocrEngineLabel = isLocalOcrActive ? (geminiRequestedTimes.size > 0 ? 'hybrid-rapidocr-gemini' : 'rapidocr-local') : 'gemini-vision';
  const ocrWallTimeSec = (ocrWallTimeMs / 1000).toFixed(1);
  console.log(`[Stage 3 Extract Subtitles] OCR engine: ${ocrEngineLabel} [mode=${ocrEngineMode}] (${activeWorkingModel}, wall time: ${ocrWallTimeSec}s, local OCR: ${(localOcrMs / 1000).toFixed(1)}s, api: ${(telemetry.apiTotalMs / 1000).toFixed(1)}s, prepass: ${(ffmpegPrepassMs / 1000).toFixed(1)}s, calls: ${apiCallsCount}, localVerified: ${localVerifiedCount}, geminiVerified: ${geminiVerifiedCount}, deduped: ${dedupedFramesCount}, ${finalizedVisualSegments.length} cues)`);
  console.log(`[Stage 3 Extract Subtitles] Completed with ${finalizedVisualSegments.length} deduplicated visual segments detected from ${rawObservations.length} observations.`);

  const result = {
    rawObservations,
    visualSegments: finalizedVisualSegments,
    hasUnresolvedFrames,
    isComplete,
    unresolvedFrames: Array.from(unresolvedMap.values()),
    ocrMeta: {
      independentSamples: true,
      ocrEngineMode,
      usage: performance.geminiUsage,
      totalFramesSampled: rawObservations.length,
      totalObservations: rawObservations.length,
      detectedSegmentsCount: finalizedVisualSegments.length,
      verifiedFramesCount: completedMap.size,
      unresolvedFramesCount: unresolvedMap.size,
      hasUnresolvedFrames,
      isComplete,
      status: isComplete ? 'completed' : 'review_needed',
      baseStepSec,
      apiCallsCount,
      retriesCount,
      batchSplitsCount,
      dedupedFramesCount,
      performance,
      modelUsed: activeWorkingModel,
      ocrEngine: ocrEngineLabel,
      wallTimeMs: ocrWallTimeMs,
      totalStage3Ms: ocrWallTimeMs,
      ffmpegPrepassMs,
      frameExtractionMs,
      localOcrMs,
      geminiVerificationMs,
      workerStartupMs,
      rapidOcrInitMs,
      avgMsPerFrame,
      actualOcrFramesCount,
      localVerifiedCount,
      geminiVerifiedCount,
      geminiBatchCount,
      hasVisualSubtitles: finalizedVisualSegments.length > 0,
      ocrNotice: lastBatchError || (hasUnresolvedFrames ? `${unresolvedMap.size} unresolved frame(s) require review` : null),
      adaptiveConcurrency,
      failedBatchesCount,
      recoveredBatchesCount,
      completedBatchesCount,
      resumedFromCheckpoint,
    },
  };

  // Only cache on disk if completely resolved with NO unresolved frames
  if (cachePath && isComplete && finalizedVisualSegments.length > 0) {
    try {
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
      console.log(`[Stage 3 OCR] 💾 Cached ${finalizedVisualSegments.length} segments to ${path.basename(cachePath)}`);
    } catch (_) {}
  } else if (cachePath && !isComplete) {
    console.warn(`[Stage 3 OCR] ⚠️ Skipping disk cache write: ${unresolvedMap.size} frame(s) remain unresolved.`);
  }

  if (checkpointPath && fs.existsSync(checkpointPath)) {
    try {
      saveProgress({
        ...(loadOcrCheckpoint(checkpointPath) || {}),
        completed: isComplete,
        hasUnresolvedFrames,
        unresolvedCount: unresolvedMap.size,
        finalizedAt: Date.now(),
      });
    } catch (_) {}
  }

    return result;
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

/**
 * Deduplicate raw OCR cues for Fast OCR mode and external subtitle imports.
 * Drops chunk-boundary repeats (equivalent CN text within 0.3s or overlapping).
 * Merges truly continuous duplicates of the same text when gap < 0.20s by extending endSec.
 * Supports short dialogue cues down to 0.35s and preserves visualGender, speakerVisualHint, and deliveryType.
 * Applies Fast OCR speaker/gender defaults: speakerSource: 'ocr_only', unverifiedSpeaker: true.
 *
 * @param {Array<object>} rawCues
 * @param {string} [defaultGender='male']
 * @returns {Array<object>}
 */

module.exports = {
  extractChineseSubtitles,
  saveVerifiedChineseSrt,
  parseVisionResponseFrames,
  normalizeChineseChars,
  stripDecorativeSubtitleNoise,
  stripRepeatedLeadingTimeCardPrefix,
  isExactChineseSubtitleMatch,
  areChineseTextsEquivalent,
  deduplicateFastOcrCues,
  isRetryableVisionError,
  isTimeoutOrOverloadError,
  classifyVisionError,
  extractRetryDelayMs,
  callGeminiVisionWithRetry,
  buildVisionBatchContents,
  getOcrCachePath,
  getOcrCheckpointPath,
  saveOcrCheckpoint,
  loadOcrCheckpoint,
  CASCADE_VISION_MODELS,
  visionModelCooldownMap,
};
