const express = require("express");
const fs = require("fs");
const path = require("path");
const { uploadsDir, resolveMediaFile } = require("../utils/pathUtils");
const { extractAllGeminiKeys } = require("../services/geminiKeyManager");
const {
  createJob,
  getJob,
  getAllJobs,
  cancelJob,
  pauseJob,
  resumeJob,
  retryJob,
} = require("../services/pipeline");
const { productionJobQueue } = require("../services/pipeline/productionJobQueue");
const {
  ensurePipelineWorkerRegistered,
  setTransientJobApiKey,
  clearTransientJobApiKey,
} = require("../services/pipeline/jobWorker");
const { getMediaDuration, pauseJobRenderProcess, cancelJobRenderProcess } = require("../services/ffmpegService");
const { getSeriesMetadata, updateSeriesMetadata, withSeriesMetadataLock, ensureEpisodeDirectories } = require("../services/episodeService");
const { GENERATION_MODES } = require("../services/pipeline/pipelineTypes");
const { scanEpisodeBrokenSegments } = require("../utils/translationQuality");
const { buildDiskAudioChecker } = require("../services/repairBrokenService");

const router = express.Router();
const activeSseClients = new Set();

function serializeFinalResultSummary(finalResult) {
  if (!finalResult || typeof finalResult !== "object") return finalResult || null;
  const derivedTotal =
    typeof finalResult.totalSegments === "number"
      ? finalResult.totalSegments
      : Array.isArray(finalResult.segments)
        ? finalResult.segments.length
        : Array.isArray(finalResult.script)
          ? finalResult.script.length
          : 0;

  return {
    success: finalResult.success,
    status: finalResult.status,
    episodeId: finalResult.episodeId,
    mode: finalResult.mode,
    generationMode: finalResult.generationMode,
    genre: finalResult.genre,
    detectedGenre: finalResult.detectedGenre,
    summary: finalResult.summary,
    totalSegments: derivedTotal,
    fixedCount: finalResult.fixedCount,
    remainingCount: finalResult.remainingCount,
    textFixed: finalResult.textFixed,
    voiceFixed: finalResult.voiceFixed,
    remainingTextBroken: finalResult.remainingTextBroken,
    remainingVoiceBroken: finalResult.remainingVoiceBroken,
    remainingBroken: finalResult.remainingBroken,
    reason: finalResult.reason,
    message: finalResult.message,
    coverage: finalResult.coverage,
    recoveryReport: finalResult.recoveryReport,
    pipelineMeta: finalResult.pipelineMeta,
  };
}

function serializeConfigSafe(config) {
  if (!config || typeof config !== "object") return config;
  const { apiKey: _strippedApiKey, seriesGlossary: _strippedGlossary, ...rest } = config;
  return rest;
}

function serializeJobForList(job) {
  if (!job || typeof job !== "object") return job;
  const lightFinalResult = serializeFinalResultSummary(job.finalResult);
  const derivedTotalSegments =
    typeof job.totalSegments === "number" && job.totalSegments > 0
      ? job.totalSegments
      : lightFinalResult?.totalSegments || 0;

  return {
    jobId: job.jobId,
    seriesId: job.seriesId,
    episodeId: job.episodeId,
    mode: job.mode,
    priority: job.priority,
    videoPath: job.videoPath,
    totalDurationSec: job.totalDurationSec,
    chunkSizeSec: job.chunkSizeSec,
    overlapSec: job.overlapSec,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    currentStage: job.currentStage,
    stageMessage: job.stageMessage,
    progress: job.progress,
    totalSegments: derivedTotalSegments,
    completedSegments: job.completedSegments,
    failedSegments: job.failedSegments,
    failedChunkIndex: job.failedChunkIndex,
    error: job.error,
    retryPolicy: job.retryPolicy,
    recoveryInfo: job.recoveryInfo,
    stages: job.stages,
    output: job.output,
    config: serializeConfigSafe(job.config),
    chunks: Array.isArray(job.chunks)
      ? job.chunks.map((c) => ({
          chunkIndex: c.chunkIndex,
          chunkId: c.chunkId,
          startSec: c.startSec,
          endSec: c.endSec,
          status: c.status,
          startedAt: c.startedAt,
          completedAt: c.completedAt,
          segmentsCount: c.segmentsCount,
          visualOnlyCount: c.visualOnlyCount,
          fusedCount: c.fusedCount,
          error: c.error,
          failedAt: c.failedAt,
        }))
      : [],
    logs: Array.isArray(job.logs) ? job.logs.slice(-40) : [],
    finalResult: lightFinalResult,
  };
}

function serializeJobDetail(job) {
  if (!job || typeof job !== "object") return job;
  if (job.config && Object.prototype.hasOwnProperty.call(job.config, "apiKey")) {
    const { apiKey: _strippedApiKey, ...safeCfg } = job.config;
    return { ...job, config: safeCfg };
  }
  return job;
}

function closeAllJobStreams() {
  for (const cleanup of Array.from(activeSseClients)) {
    try {
      cleanup(true);
    } catch (_) {}
  }
}

router.post("/generate", async (req, res) => {
  try {
    const {
      videoPath,
      videoId,
      videoFileName,
      mode: rawMode = "dialogue",
      dubbingMode: rawDubbingMode,
      generationMode: rawGenMode,
      pipelineMode,
      recapStyle = "story_recap",
      customPrompt = "",
      narratorGender = "male",
      genre = "auto",
      seriesId = "series_default",
      episodeId = "ep_1",
      seriesGlossary,
      apiKey,
      modelName,
      chunkSizeSec = 300,
      overlapSec = 2,
    } = req.body;

    const generationMode = rawGenMode || (pipelineMode === 'fast_ocr' ? 'fast_ocr' : null) || (rawMode === 'fast_ocr' ? 'fast_ocr' : 'standard');
    const effectiveDubbingMode = rawDubbingMode || (rawMode === 'recap' ? 'recap' : 'dialogue');
    const mode = effectiveDubbingMode === 'recap'
      ? GENERATION_MODES.MODE_B_RECAP
      : (generationMode === 'fast_ocr' ? GENERATION_MODES.FAST_OCR : rawMode);

    const rawVideoRef = videoPath || (videoFileName ? (path.isAbsolute(videoFileName) ? videoFileName : path.join(uploadsDir, videoFileName)) : null) || videoId;
    const resolvedVideoPath = rawVideoRef ? resolveMediaFile(rawVideoRef) : null;

    if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
      return res.status(400).json({ success: false, error: "រកមិនឃើញ File វីដេអូសម្រាប់ដំណើរការ Job ឡើយ" });
    }

    // Anti-duplication Guard & Re-Translate Safety
    const seriesMeta = getSeriesMetadata(seriesId);
    const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(episodeId));
    const hasExistingSegments = Boolean(targetEp?.scriptData?.segments?.length > 0);

    if (hasExistingSegments) {
      if (!req.body.force || (req.body.confirmed !== true && req.body.force !== true)) {
        console.log(`[Job Dispatch] ⚡ Episode ${episodeId} in series ${seriesId} already completed (${targetEp.scriptData.segments.length} segments). Re-translation requires confirmation.`);
        return res.status(409).json({
          success: false,
          requireConfirmation: true,
          alreadyCompleted: true,
          error: `ភាគ ${episodeId} បាន Translate រួចរាល់ហើយ (${targetEp.scriptData.segments.length} ឃ្លា)។ ការ Translate ឡើងវិញតម្រូវឱ្យមានការបញ្ជាក់ (Confirmation required)។`,
          episodeId,
          segmentsCount: targetEp.scriptData.segments.length,
        });
      }

      // STEP 5: Re-Translate Safety — snapshot episode's scriptData AND series.json before overwriting
      try {
        const seriesCleanId = String(seriesId).replace(/[/\\?%*:|"<>]/g, '_');
        const episodeCleanId = String(episodeId).replace(/[/\\?%*:|"<>]/g, '_');
        const seriesDir = path.join(uploadsDir, 'projects', seriesCleanId);
        const episodeDir = path.join(seriesDir, 'episodes', episodeCleanId);
        const backupsDir = path.join(episodeDir, 'backups');

        if (!fs.existsSync(backupsDir)) {
          fs.mkdirSync(backupsDir, { recursive: true });
        }
        const now = Date.now();
        // 1. Snapshot episode scriptData
        const epBackupName = `script_backup_${now}.json`;
        const epBackupPath = path.join(backupsDir, epBackupName);
        fs.writeFileSync(epBackupPath, JSON.stringify(targetEp.scriptData, null, 2), 'utf8');

        // 2. Snapshot series.json
        const seriesJsonPath = path.join(seriesDir, 'series.json');
        if (fs.existsSync(seriesJsonPath)) {
          const seriesBackupPath = path.join(seriesDir, `series.json.backup_${now}`);
          fs.copyFileSync(seriesJsonPath, seriesBackupPath);
          console.log(`[Job Dispatch] 🛡️ Snapshot series.json backed up to ${seriesBackupPath}`);
        } else if (seriesMeta) {
          const seriesBackupPath = path.join(seriesDir, `series.json.backup_${now}`);
          fs.writeFileSync(seriesBackupPath, JSON.stringify(seriesMeta, null, 2), 'utf8');
        }

        console.log(`[Job Dispatch] 🛡️ Re-Translate Safety: Backed up script to ${epBackupName}`);

        const existingBackups = fs.readdirSync(backupsDir).filter((f) => f.startsWith('script_backup_') && f.endsWith('.json')).sort();
        if (existingBackups.length > 5) {
          for (let i = 0; i < existingBackups.length - 5; i++) {
            try { fs.unlinkSync(path.join(backupsDir, existingBackups[i])); } catch (_) {}
          }
        }
      } catch (backupErr) {
        console.error(`[Job Dispatch] ❌ FATAL: Re-Translate backup failed:`, backupErr.message);
        return res.status(500).json({
          success: false,
          error: `Re-Translate Safety Error: Could not create required backups before overwriting (${backupErr.message}). Operation refused.`,
        });
      }
    }

    if (targetEp && targetEp.generationMode !== generationMode) {
      await withSeriesMetadataLock(seriesId, () =>
        updateSeriesMetadata(seriesId, (freshSeries) => {
          const freshEp = (freshSeries?.episodes || []).find((e) => String(e.id) === String(episodeId));
          if (!freshEp || freshEp.generationMode === generationMode) return false;
          freshEp.generationMode = generationMode;
          return true;
        })
      );
    }

    const availableKeys = extractAllGeminiKeys(apiKey);
    if (availableKeys.length === 0) {
      return res.status(400).json({ success: false, error: "Gemini API Key មិនទាន់បានកំណត់ទេ" });
    }
    const keyToUse = availableKeys.join(",");

    const durSec = await getMediaDuration(resolvedVideoPath).catch(() => 0);

    ensurePipelineWorkerRegistered(productionJobQueue);

    // If force re-translate is requested and an active job/lock exists, cancel it cleanly first
    if ((req.body.force === true || req.body.confirmed === true) && productionJobQueue.hasActiveJobForEpisode(seriesId, episodeId)) {
      const active = productionJobQueue.getActiveJobForEpisode(seriesId, episodeId);
      if (active?.jobId) {
        cancelJobRenderProcess(active.jobId);
        cancelJob(active.jobId);
        clearTransientJobApiKey(active.jobId);
      }
      productionJobQueue.releaseEpisodeLock(seriesId, episodeId);
      console.log(`[Job Dispatch] 🔄 Force Re-Run: Cancelled previous active job for ${seriesId}/${episodeId}`);
    }

    const { jobData } = createJob({
      seriesId,
      episodeId,
      videoPath: resolvedVideoPath,
      mode,
      totalDurationSec: durSec,
      chunkSizeSec,
      overlapSec,
      config: {
        mode,
        generationMode,
        modelName: modelName || process.env.GEMINI_MODEL || null,
        customPrompt,
        narratorGender,
        seriesGlossary,
        genre,
        force: Boolean(req.body.force || req.body.confirmed),
        forceRegen: Boolean(req.body.force || req.body.confirmed || req.body.forceRegen),
      },
      baseUploadsDir: uploadsDir,
    });

    // Store per-request API keys only in transient in-memory map (never written to disk job manifest)
    if (jobData?.jobId) {
      setTransientJobApiKey(jobData.jobId, keyToUse);
    }

    const initialStatus = jobData.status || "queued";
    res.json({
      success: true,
      jobId: jobData.jobId,
      status: initialStatus,
      message: initialStatus === "queued"
        ? "Job added to production queue"
        : "Background generation job started successfully",
      job: serializeJobForList(jobData),
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_ACTIVE_JOB' || err.httpStatus === 409) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_ACTIVE_JOB',
        error: err.message,
        existingJobId: err.existingJobId,
        status: err.status,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/repair-broken", async (req, res) => {
  try {
    const {
      seriesId = "series_default",
      episodeIds = null,
      episodeId = null,
      apiKey = null,
      modelName = null,
    } = req.body || {};

    const seriesMeta = getSeriesMetadata(seriesId, { forceDisk: true });
    const allEpisodes = Array.isArray(seriesMeta?.episodes) ? seriesMeta.episodes : [];

    let candidateEpisodes = [];
    if (Array.isArray(episodeIds) && episodeIds.length > 0) {
      const idSet = new Set(episodeIds.map((id) => String(id)));
      candidateEpisodes = allEpisodes.filter((ep) => idSet.has(String(ep.id)));
    } else if (episodeId) {
      candidateEpisodes = allEpisodes.filter((ep) => String(ep.id) === String(episodeId));
    } else {
      candidateEpisodes = allEpisodes.filter((ep) => Array.isArray(ep?.scriptData?.segments) && ep.scriptData.segments.length > 0);
    }

    if (candidateEpisodes.length === 0) {
      return res.status(404).json({
        success: false,
        error: "មិនមានភាគដែលត្រូវជួសជុលទេ (No matching episodes found)",
      });
    }

    let totalTextBrokenBefore = 0;
    let totalVoiceBrokenBefore = 0;
    const episodesWithBroken = [];

    for (const ep of candidateEpisodes) {
      const dirInfo = ensureEpisodeDirectories(seriesId, ep.id);
      const checkAudioFileFn = buildDiskAudioChecker(dirInfo.audioDir, uploadsDir);
      const scan = scanEpisodeBrokenSegments(ep, { checkAudioFileFn });
      totalTextBrokenBefore += scan.textBrokenCount;
      totalVoiceBrokenBefore += scan.voiceBrokenCount;
      if (scan.totalBrokenCount > 0) {
        episodesWithBroken.push({ ep, scan });
      }
    }

    const totalBrokenBefore = totalTextBrokenBefore + totalVoiceBrokenBefore;
    if (totalBrokenBefore === 0) {
      return res.json({
        success: true,
        seriesId,
        jobs: [],
        enqueuedCount: 0,
        skippedHealthyCount: candidateEpisodes.length,
        scanBefore: {
          textBrokenCount: 0,
          voiceBrokenCount: 0,
          totalBrokenCount: 0,
        },
        message: "គ្រប់ឃ្លារួចរាល់ 100% — គ្មានឃ្លាខូចទេ!",
      });
    }

    const availableKeys = extractAllGeminiKeys(apiKey);
    if (totalTextBrokenBefore > 0 && availableKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Gemini API Key មិនទាន់បានកំណត់ទេ (ត្រូវការសម្រាប់បកប្រែអត្ថបទខូច)",
      });
    }
    const keyToUse = availableKeys.join(",");

    ensurePipelineWorkerRegistered(productionJobQueue);

    const enqueuedJobs = [];
    const conflicts = [];

    for (const { ep, scan } of episodesWithBroken) {
      try {
        const { jobData } = createJob({
          seriesId,
          episodeId: ep.id,
          videoPath: ep.video?.videoPath || ep.sourceVideoPath || null,
          mode: "repair_broken",
          priority: 2,
          totalSegments: scan.totalBrokenCount,
          config: {
            mode: "repair_broken",
            isRepairBroken: true,
            modelName: modelName || process.env.GEMINI_MODEL || null,
            initialTextBroken: scan.textBrokenCount,
            initialVoiceBroken: scan.voiceBrokenCount,
          },
          baseUploadsDir: uploadsDir,
        });
        if (jobData?.jobId && keyToUse) {
          setTransientJobApiKey(jobData.jobId, keyToUse);
        }
        enqueuedJobs.push(serializeJobForList(jobData));
      } catch (enqErr) {
        if (enqErr.code === "DUPLICATE_ACTIVE_JOB" || enqErr.httpStatus === 409) {
          conflicts.push({ episodeId: ep.id, existingJobId: enqErr.existingJobId, status: enqErr.status });
        } else {
          throw enqErr;
        }
      }
    }

    const skippedHealthyCount = Math.max(0, candidateEpisodes.length - episodesWithBroken.length);

    return res.json({
      success: true,
      seriesId,
      jobs: enqueuedJobs,
      enqueuedCount: enqueuedJobs.length,
      skippedHealthyCount,
      conflicts,
      scanBefore: {
        textBrokenCount: totalTextBrokenBefore,
        voiceBrokenCount: totalVoiceBrokenBefore,
        totalBrokenCount: totalBrokenBefore,
      },
      message: `បានដាក់ជួសជុលឃ្លាខូច ${enqueuedJobs.length} ភាគ (អត្ថបទខូច: ${totalTextBrokenBefore} ឃ្លា • សំឡេងខ្វះ: ${totalVoiceBrokenBefore} ឃ្លា)`,
    });
  } catch (err) {
    console.error("[Job Repair Broken] Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/", (req, res) => {
  try {
    const filter = req.query.filter || req.query.status || null;
    const jobs = getAllJobs(filter).map(serializeJobForList);
    const stats = productionJobQueue.getQueueSnapshot();
    res.json({
      success: true,
      total: jobs.length,
      jobs,
      stats,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  if (req.socket && typeof req.socket.setKeepAlive === "function") {
    req.socket.setKeepAlive(true, 10000);
  }

  let closed = false;
  let keepAliveTimer = null;

  const cleanup = (endResponse = false) => {
    if (closed) return;
    closed = true;
    activeSseClients.delete(cleanup);
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    if (productionJobQueue.events && typeof productionJobQueue.events.off === "function") {
      productionJobQueue.events.off("job_change", onJobChange);
    }
    if (endResponse && !res.writableEnded && !res.destroyed) {
      try {
        res.end();
      } catch (_) {}
    }
  };

  // Live updates handler (lightweight payload without multi-MB finalResult arrays)
  const onJobChange = (eventPayload) => {
    if (closed || res.writableEnded || res.destroyed) {
      return cleanup(false);
    }
    try {
      const stats = productionJobQueue.getQueueSnapshot();
      const lightPayload = eventPayload && typeof eventPayload === "object"
        ? {
            ...eventPayload,
            ...(eventPayload.job ? { job: serializeJobForList(eventPayload.job) } : {}),
            stats,
          }
        : { stats };
      res.write(`event: job_update\ndata: ${JSON.stringify(lightPayload)}\n\n`);
    } catch (_) {
      cleanup(false);
    }
  };

  activeSseClients.add(cleanup);

  // Initial event snapshot (lightweight payload)
  try {
    const jobs = getAllJobs().map(serializeJobForList);
    const stats = productionJobQueue.getQueueSnapshot();
    res.write(`event: init\ndata: ${JSON.stringify({ jobs, stats })}\n\n`);
  } catch (err) {
    console.warn("[SSE] Error sending init event:", err.message);
  }

  if (productionJobQueue.events && typeof productionJobQueue.events.on === "function") {
    productionJobQueue.events.on("job_change", onJobChange);
  }

  // 15s keepalive ping
  keepAliveTimer = setInterval(() => {
    if (closed || res.writableEnded || res.destroyed) {
      return cleanup(false);
    }
    try {
      res.write(":keepalive\n\n");
    } catch (_) {
      cleanup(false);
    }
  }, 15000);
  if (typeof keepAliveTimer.unref === "function") {
    keepAliveTimer.unref();
  }

  req.on("close", () => cleanup(false));
  res.on("close", () => cleanup(false));
  res.on("error", () => cleanup(false));
});

router.get("/:jobId", (req, res) => {
  const { jobId } = req.params;
  const { seriesId, episodeId } = req.query;
  const job = getJob(jobId, seriesId, episodeId);
  if (!job) {
    return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
  }
  res.json({ success: true, job: serializeJobDetail(job) });
});

router.get("/:jobId/status", (req, res) => {
  const { jobId } = req.params;
  const { seriesId, episodeId } = req.query;
  const job = getJob(jobId, seriesId, episodeId);
  if (!job) {
    return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
  }
  res.json({
    success: true,
    jobId,
    status: job.status,
    progress: job.progress,
    stage: job.currentStage,
    message: job.stageMessage,
    chunks: job.chunks,
    logs: job.logs || [],
    finalResult: job.finalResult,
    error: job.error,
    updatedAt: job.updatedAt,
  });
});

router.post("/:jobId/pause", (req, res) => {
  const { jobId } = req.params;
  try {
    pauseJobRenderProcess(jobId);
    const job = pauseJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
    }
    res.json({ success: true, message: `Job #${jobId} paused successfully`, job: serializeJobForList(job) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/:jobId/resume", (req, res) => {
  const { jobId } = req.params;
  try {
    if (req.body?.apiKey) {
      const keys = extractAllGeminiKeys(req.body.apiKey);
      if (keys.length > 0) setTransientJobApiKey(jobId, keys.join(","));
    }
    ensurePipelineWorkerRegistered(productionJobQueue);
    const job = resumeJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
    }
    res.json({ success: true, message: `Job #${jobId} resumed successfully`, job: serializeJobForList(job) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/:jobId/retry", (req, res) => {
  const { jobId } = req.params;
  try {
    if (req.body?.apiKey) {
      const keys = extractAllGeminiKeys(req.body.apiKey);
      if (keys.length > 0) setTransientJobApiKey(jobId, keys.join(","));
    }
    ensurePipelineWorkerRegistered(productionJobQueue);
    const job = retryJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
    }
    res.json({ success: true, message: `Job #${jobId} retried successfully`, job: serializeJobForList(job) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

function executeJobCancellation({ jobId, episodeId, seriesId, all = false }) {
  const hasJobId = Boolean(jobId && typeof jobId === "string" && jobId.trim());
  const hasEpisodeId = Boolean(episodeId && typeof episodeId === "string" && episodeId.trim());
  const hasSeriesId = Boolean(seriesId && typeof seriesId === "string" && seriesId.trim());
  const isKillAll = Boolean(all === true || all === "true");

  // Reject missing or ambiguous targets
  if (!hasJobId && !hasEpisodeId && !isKillAll) {
    return {
      status: 400,
      body: {
        success: false,
        status: "bad_request",
        error: "Missing cancellation target. Please specify jobId, episodeId, or all: true",
        cancelledCount: 0,
        cancelledJobIds: [],
        cancelledJobs: [],
      },
    };
  }

  const cancelledJobs = [];
  const cancelledJobIds = [];

  // Case 1: Specific jobId requested
  if (hasJobId) {
    const cleanJobId = jobId.trim();
    let job = getJob(cleanJobId);

    // Fallback: If cleanJobId wasn't found as a job ID, check if an episode identifier was passed as jobId
    if (!job && (cleanJobId.startsWith("ep_") || cleanJobId.startsWith("episode_") || cleanJobId.match(/^ep\d+$/i))) {
      const candidateJobs = getAllJobs();
      for (const j of candidateJobs) {
        if (["running", "queued", "processing", "recovering"].includes(j.status)) {
          if (String(j.episodeId) === cleanJobId) {
            if (!hasSeriesId || String(j.seriesId) === seriesId.trim()) {
              job = j;
              break;
            }
          }
        }
      }
    }

    if (job) {
      cancelJobRenderProcess(job.jobId);
      const c = cancelJob(job.jobId);
      clearTransientJobApiKey(job.jobId);
      if (c) {
        cancelledJobs.push(serializeJobForList(c));
        cancelledJobIds.push(c.jobId);
      }
      if (job.seriesId && job.episodeId) {
        productionJobQueue.releaseEpisodeLock(job.seriesId, job.episodeId);
      }
    }

    if (cancelledJobIds.length === 0) {
      return {
        status: 404,
        body: {
          success: false,
          status: "not_found",
          error: `No active or queued job found for target #${cleanJobId}`,
          cancelledCount: 0,
          cancelledJobIds: [],
          cancelledJobs: [],
        },
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        status: "cancelled",
        cancelledCount: cancelledJobIds.length,
        count: cancelledJobIds.length,
        cancelledJobIds,
        cancelledJobs,
      },
    };
  }

  // Case 2: Scoped by episodeId and/or seriesId, or explicit Kill All
  const jobs = getAllJobs();
  const targetSeries = hasSeriesId ? seriesId.trim() : null;
  const targetEpisode = hasEpisodeId ? episodeId.trim() : null;

  for (const j of jobs) {
    if (["running", "queued", "processing", "recovering"].includes(j.status)) {
      if (targetEpisode && String(j.episodeId) !== targetEpisode) continue;
      if (targetSeries && String(j.seriesId) !== targetSeries) continue;

      cancelJobRenderProcess(j.jobId);
      const c = cancelJob(j.jobId);
      clearTransientJobApiKey(j.jobId);
      if (c) {
        cancelledJobs.push(serializeJobForList(c));
        cancelledJobIds.push(c.jobId);
      }
    }
  }

  // Clean up virtual lock if held for this episode
  if (targetSeries && targetEpisode && productionJobQueue.hasActiveJobForEpisode(targetSeries, targetEpisode)) {
    productionJobQueue.releaseEpisodeLock(targetSeries, targetEpisode);
  }

  if (cancelledJobIds.length === 0) {
    const targetDesc = targetEpisode ? `episode ${targetEpisode}` : (targetSeries ? `series ${targetSeries}` : "all");
    return {
      status: 404,
      body: {
        success: false,
        status: "not_found",
        error: `No active or queued job found for ${targetDesc}`,
        cancelledCount: 0,
        cancelledJobIds: [],
        cancelledJobs: [],
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      status: "cancelled",
      cancelledCount: cancelledJobIds.length,
      count: cancelledJobIds.length,
      cancelledJobIds,
      cancelledJobs,
    },
  };
}

router.post("/cancel", (req, res) => {
  try {
    const outcome = executeJobCancellation(req.body || {});
    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    console.error("[Job Cancel] Error:", err);
    return res.status(500).json({ success: false, status: "error", error: err.message, cancelledCount: 0, cancelledJobIds: [] });
  }
});

router.post("/kill", (req, res) => {
  try {
    const outcome = executeJobCancellation(req.body || {});
    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    console.error("[Job Kill] Error:", err);
    return res.status(500).json({ success: false, status: "error", error: err.message, cancelledCount: 0, cancelledJobIds: [] });
  }
});

router.post("/:jobId/cancel", (req, res) => {
  try {
    const { jobId } = req.params;
    const outcome = executeJobCancellation({ jobId });
    if (!outcome.body.success) {
      return res.status(outcome.status).json(outcome.body);
    }
    const cancelledJob = outcome.body.cancelledJobs?.[0] || null;
    return res.status(200).json({
      success: true,
      status: "cancelled",
      cancelledCount: 1,
      cancelledJobIds: [jobId],
      message: `Job #${jobId} cancelled successfully`,
      job: cancelledJob,
      cancelledJobs: outcome.body.cancelledJobs,
    });
  } catch (err) {
    console.error("[Job Cancel] Error:", err);
    return res.status(500).json({ success: false, status: "error", error: err.message, cancelledCount: 0, cancelledJobIds: [] });
  }
});

router.executeJobCancellation = executeJobCancellation;
router.closeAllJobStreams = closeAllJobStreams;

module.exports = router;

