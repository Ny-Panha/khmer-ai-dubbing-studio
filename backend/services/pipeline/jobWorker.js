const fs = require('fs');
const { extractAllGeminiKeys } = require('../geminiKeyManager');
const { runDubbingPipeline } = require('./dubbingPipeline');
const { runRepairBrokenSegmentsJob } = require('../repairBrokenService');
const { JOB_STATUS, productionJobQueue } = require('./productionJobQueue');

/**
 * In-memory transient store for per-job API keys submitted from the UI.
 * Keys are NEVER serialized into job manifest files or series.json on disk.
 */
const transientApiKeys = new Map();
const queuesWithCleanup = new WeakSet();

function setTransientJobApiKey(jobId, apiKey) {
  if (!jobId || !apiKey || typeof apiKey !== 'string') return;
  const trimmed = apiKey.trim();
  if (trimmed) {
    transientApiKeys.set(jobId, trimmed);
  }
}

function getTransientJobApiKey(jobId) {
  if (!jobId) return null;
  return transientApiKeys.get(jobId) || null;
}

function clearTransientJobApiKey(jobId) {
  if (!jobId) return;
  transientApiKeys.delete(jobId);
}

function attachTransientKeyCleanup(queue) {
  if (!queue || !queue.events || queuesWithCleanup.has(queue)) return;
  queuesWithCleanup.add(queue);

  queue.events.on('job_change', ({ job }) => {
    if (!job || !job.jobId) return;
    if (
      job.status === JOB_STATUS.COMPLETED ||
      job.status === JOB_STATUS.PARTIAL ||
      job.status === JOB_STATUS.CANCELLED ||
      job.status === JOB_STATUS.FAILED
    ) {
      transientApiKeys.delete(job.jobId);
    }
  });
}

/**
 * Creates the canonical worker handler executed inside ProductionJobQueue slots.
 * Runs the 10-stage dubbing pipeline with full AbortSignal propagation.
 */
function createPipelineWorkerHandler(queue = productionJobQueue, deps = {}) {
  const executePipeline = deps.runDubbingPipeline || runDubbingPipeline;
  const executeRepairBroken = deps.runRepairBrokenSegmentsJob || runRepairBrokenSegmentsJob;
  const resolveKeys = deps.extractAllGeminiKeys || extractAllGeminiKeys;

  return async function pipelineWorker(job) {
    if (!job || !job.jobId) {
      const err = new Error('Invalid job payload passed to pipeline worker');
      err.nonRetryable = true;
      throw err;
    }

    const abortSignal = typeof queue.getJobSignal === 'function'
      ? queue.getJobSignal(job.jobId)
      : null;

    if (abortSignal?.aborted || job.status === JOB_STATUS.CANCELLED) {
      const abortErr = new Error('Pipeline execution was cancelled by user');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const cfg = job.config || {};

    if (job.mode === 'repair_broken' || cfg.isRepairBroken === true) {
      const transientKey = getTransientJobApiKey(job.jobId);
      return await executeRepairBroken(job, {
        queue,
        signal: abortSignal,
        transientApiKey: transientKey,
        ...(deps.projectsDir ? { projectsDir: deps.projectsDir } : {}),
        ...(deps.baseUploadsDir ? { baseUploadsDir: deps.baseUploadsDir } : {}),
        ...(deps.aiClient ? { aiClient: deps.aiClient } : {}),
        ...(deps.translateBatchFn ? { translateBatchFn: deps.translateBatchFn } : {}),
        ...(deps.generateBatchTtsFn ? { generateBatchTtsFn: deps.generateBatchTtsFn } : {}),
        ...(deps.generateSingleTtsFn ? { generateSingleTtsFn: deps.generateSingleTtsFn } : {}),
        ...(deps.syncNarrationFn ? { syncNarrationFn: deps.syncNarrationFn } : {}),
      });
    }

    const videoPath = job.videoPath || cfg.videoPath;

    if (!videoPath || !fs.existsSync(videoPath)) {
      const err = new Error(`Video file not found: ${videoPath || 'missing videoPath'}`);
      err.nonRetryable = true;
      throw err;
    }

    const transientKey = getTransientJobApiKey(job.jobId);
    const availableKeys = resolveKeys(transientKey);
    if (!availableKeys || availableKeys.length === 0) {
      const err = new Error('Gemini API Key មិនទាន់បានកំណត់ទេ');
      err.nonRetryable = true;
      throw err;
    }

    const result = await executePipeline({
      videoPath,
      mode: job.mode || cfg.mode || 'dialogue',
      seriesId: job.seriesId || 'series_default',
      episodeId: job.episodeId || 'ep_1',
      apiKey: availableKeys.join(','),
      modelName: cfg.modelName || process.env.GEMINI_MODEL,
      customPrompt: cfg.customPrompt || '',
      narratorGender: cfg.narratorGender || 'male',
      seriesGlossary: cfg.seriesGlossary,
      genre: cfg.genre || 'auto',
      jobId: job.jobId,
      force: Boolean(cfg.force || job.force || cfg.forceRegen),
      ocrMode: cfg.ocrMode || job.ocrMode || null,
      signal: abortSignal,
    });

    return result;
  };
}

/**
 * Registers the default pipeline worker onto the queue idempotently.
 * Avoids overriding custom worker handlers injected by tests unless force=true.
 */
function ensurePipelineWorkerRegistered(queue = productionJobQueue, options = {}) {
  if (!queue) return false;
  attachTransientKeyCleanup(queue);

  if (options.force || !queue.workerHandler) {
    queue.registerWorkerHandler(createPipelineWorkerHandler(queue, options.deps));
    return true;
  }

  return false;
}

module.exports = {
  setTransientJobApiKey,
  getTransientJobApiKey,
  clearTransientJobApiKey,
  createPipelineWorkerHandler,
  ensurePipelineWorkerRegistered,
};

