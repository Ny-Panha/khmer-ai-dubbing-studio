const express = require("express");
const fs = require("fs");
const path = require("path");
const { uploadsDir, resolveMediaFile } = require("../utils/pathUtils");
const { extractAllGeminiKeys } = require("../services/geminiKeyManager");
const {
  runDubbingPipeline,
  createJob,
  getJob,
  getAllJobs,
  updateJob,
  cancelJob,
  pauseJob,
  resumeJob,
  retryJob,
} = require("../services/pipeline");
const { productionJobQueue } = require("../services/pipeline/productionJobQueue");
const { getMediaDuration, pauseJobRenderProcess, cancelJobRenderProcess } = require("../services/ffmpegService");
const { getSeriesMetadata, saveSeriesMetadata } = require("../services/episodeService");
const { GENERATION_MODES } = require("../services/pipeline/pipelineTypes");
const { generateModeSpecificScript } = require("../services/pipeline/stages/stage6_generateModeSpecificScript");
const { translateAndValidateKhmer } = require("../services/pipeline/stages/stage7_translateAndValidateKhmer");
const { validateSubtitleTiming } = require("../services/pipeline/stages/stage8_validateSubtitleTiming");
const { buildSpeakerRegistry, syncSegmentsWithSpeakerRegistry } = require("../models/speakerRegistry");
const { createSmartGenAIClient } = require("../services/geminiKeyManager");

const router = express.Router();

router.post("/generate", async (req, res) => {
  try {
    const {
      videoPath,
      videoId,
      videoFileName,
      mode = "dialogue",
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

    const rawVideoRef = videoPath || (videoFileName ? (path.isAbsolute(videoFileName) ? videoFileName : path.join(uploadsDir, videoFileName)) : null) || videoId;
    const resolvedVideoPath = rawVideoRef ? resolveMediaFile(rawVideoRef) : null;

    if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
      return res.status(400).json({ success: false, error: "រកមិនឃើញ File វីដេអូសម្រាប់ដំណើរការ Job ឡើយ" });
    }

    // Anti-duplication Guard & Re-Translate Safety
    if (!req.body.force) {
      const seriesMeta = getSeriesMetadata(seriesId);
      const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(episodeId));
      if (targetEp?.scriptData?.segments?.length > 0) {
        console.log(`[Job Dispatch] ⚡ Episode ${episodeId} in series ${seriesId} already completed (${targetEp.scriptData.segments.length} segments). Skipping redundant translation.`);
        return res.json({
          success: true,
          alreadyCompleted: true,
          message: `ភាគ ${episodeId} បាន Translate រួចរាល់ហើយ (${targetEp.scriptData.segments.length} ឃ្លា)។ មិនចាំបាច់ Translate ឡើងវិញទេ។`,
          episodeId,
          segmentsCount: targetEp.scriptData.segments.length,
        });
      }
    } else {
      // Re-Translate safety backup
      try {
        const seriesMeta = getSeriesMetadata(seriesId);
        const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(episodeId));
        if (targetEp?.scriptData?.segments?.length > 0) {
          const backupsDir = path.join(
            uploadsDir,
            'projects',
            String(seriesId).replace(/[/\\?%*:|"<>]/g, '_'),
            'episodes',
            String(episodeId).replace(/[/\\?%*:|"<>]/g, '_'),
            'backups'
          );
          if (!fs.existsSync(backupsDir)) {
            fs.mkdirSync(backupsDir, { recursive: true });
          }
          const backupFileName = `script_backup_${Date.now()}.json`;
          fs.writeFileSync(path.join(backupsDir, backupFileName), JSON.stringify(targetEp.scriptData, null, 2), 'utf8');
          console.log(`[Job Dispatch] 🛡️ Re-Translate Safety: Backed up existing script to ${backupFileName}`);

          const existingBackups = fs.readdirSync(backupsDir).filter((f) => f.startsWith('script_backup_') && f.endsWith('.json')).sort();
          if (existingBackups.length > 5) {
            for (let i = 0; i < existingBackups.length - 5; i++) {
              try { fs.unlinkSync(path.join(backupsDir, existingBackups[i])); } catch (_) {}
            }
          }
        }
      } catch (backupErr) {
        console.warn(`[Job Dispatch] Warning: Could not create script backup:`, backupErr.message);
      }
    }

    const availableKeys = extractAllGeminiKeys(apiKey);
    if (availableKeys.length === 0) {
      return res.status(400).json({ success: false, error: "Gemini API Key មិនទាន់បានកំណត់ទេ" });
    }
    const keyToUse = availableKeys.join(',');

    const durSec = await getMediaDuration(resolvedVideoPath).catch(() => 0);

    const { jobData, abortSignal } = createJob({
      seriesId,
      episodeId,
      videoPath: resolvedVideoPath,
      mode,
      totalDurationSec: durSec,
      chunkSizeSec,
      overlapSec,
      baseUploadsDir: uploadsDir,
    });

    // Run in background without blocking response
    runDubbingPipeline({
      videoPath: resolvedVideoPath,
      mode,
      seriesId,
      episodeId,
      apiKey: keyToUse,
      modelName: modelName || process.env.GEMINI_MODEL,
      customPrompt,
      narratorGender,
      seriesGlossary,
      genre,
      jobId: jobData.jobId,
      signal: abortSignal,
    }).then((result) => {
      console.log(`[Job ${jobData.jobId}] Pipeline finished successfully.`);
      updateJob(jobData.jobId, {
        status: 'completed',
        progress: 100,
        currentStage: 'completed',
        stageMessage: 'ការបង្កើតបានបញ្ចប់ដោយជោគជ័យ!',
        finalResult: result,
      });
    }).catch((err) => {
      console.error(`[Job ${jobData.jobId}] Background pipeline execution error:`, err.message);
      updateJob(jobData.jobId, {
        status: err.name === 'AbortError' ? 'cancelled' : 'failed',
        error: err.message,
        stageMessage: err.name === 'AbortError' ? 'Job was cancelled' : `បរាជ័យ: ${err.message}`,
      });
    });

    res.json({
      success: true,
      jobId: jobData.jobId,
      status: "running",
      message: "Background generation job started successfully",
      job: jobData,
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

router.get("/", (req, res) => {
  try {
    const filter = req.query.filter || req.query.status || null;
    const jobs = getAllJobs(filter);
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
  if (req.socket && typeof req.socket.setKeepAlive === "function") {
    req.socket.setKeepAlive(true, 10000);
  }

  // Initial event snapshot
  try {
    const jobs = getAllJobs();
    const stats = productionJobQueue.getQueueSnapshot();
    res.write(`event: init\ndata: ${JSON.stringify({ jobs, stats })}\n\n`);
  } catch (err) {
    console.warn("[SSE] Error sending init event:", err.message);
  }

  // Live updates handler
  const onJobChange = (eventPayload) => {
    try {
      const stats = productionJobQueue.getQueueSnapshot();
      res.write(`event: job_update\ndata: ${JSON.stringify({ ...eventPayload, stats })}\n\n`);
    } catch (_) {}
  };

  if (productionJobQueue.events && typeof productionJobQueue.events.on === "function") {
    productionJobQueue.events.on("job_change", onJobChange);
  }

  // 15s keepalive ping
  const keepAliveTimer = setInterval(() => {
    try {
      res.write(":keepalive\n\n");
    } catch (_) {}
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAliveTimer);
    if (productionJobQueue.events && typeof productionJobQueue.events.off === "function") {
      productionJobQueue.events.off("job_change", onJobChange);
    }
  });
});

router.get("/:jobId", (req, res) => {
  const { jobId } = req.params;
  const { seriesId, episodeId } = req.query;
  const job = getJob(jobId, seriesId, episodeId);
  if (!job) {
    return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
  }
  res.json({ success: true, job });
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
    res.json({ success: true, message: `Job #${jobId} paused successfully`, job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/:jobId/resume", (req, res) => {
  const { jobId } = req.params;
  try {
    const job = resumeJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
    }
    res.json({ success: true, message: `Job #${jobId} resumed successfully`, job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/:jobId/retry", (req, res) => {
  const { jobId } = req.params;
  try {
    const job = retryJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
    }
    res.json({ success: true, message: `Job #${jobId} retried successfully`, job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/:jobId/cancel", (req, res) => {
  const { jobId } = req.params;
  cancelJobRenderProcess(jobId);
  const job = cancelJob(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
  }
  res.json({ success: true, message: `Job #${jobId} cancelled successfully`, job });
});

module.exports = router;

