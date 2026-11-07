const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');

/**
 * Standard Job Status Enums (Phase 4.1)
 * Checkpoints are discrete event/data records and NOT job statuses.
 */
const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RECOVERING: 'recovering',
});

const ACTIVE_STATUSES = new Set([
  JOB_STATUS.QUEUED,
  JOB_STATUS.RUNNING,
  JOB_STATUS.RECOVERING,
]);

const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_CONFIGURABLE_CONCURRENCY = 4;

/**
 * Sanitizes an identifier to prevent path traversal, null bytes, or invalid filename characters.
 */
function sanitizeIdentifier(rawId, fallback = 'default') {
  if (!rawId || typeof rawId !== 'string') return fallback;
  const cleaned = rawId
    .replace(/\0/g, '')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\.\.+/g, '_')
    .trim();
  return cleaned || fallback;
}

const CANONICAL_UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const LEGACY_UPLOADS_DIR = path.resolve(__dirname, '../../../uploads');

/**
 * Resolves the isolated jobs folder for an episode:
 * uploads/projects/:seriesId/episodes/:episodeId/jobs/
 */
function getJobDir(seriesId, episodeId, baseUploadsDir = null) {
  const uploadsDir = baseUploadsDir || CANONICAL_UPLOADS_DIR;
  const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
  const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
  const jobDir = path.join(uploadsDir, 'projects', cleanSeries, 'episodes', cleanEpisode, 'jobs');
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true });
  }
  return jobDir;
}

/**
 * Resolves the canonical manifest path for a job, with backward-compatible fallback to legacy uploads.
 */
function getJobFilePath(seriesId, episodeId, jobId, baseUploadsDir = null) {
  const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
  const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
  const cleanJobId = sanitizeIdentifier(jobId, 'job_unknown');

  const targetBaseDir = baseUploadsDir || CANONICAL_UPLOADS_DIR;
  const canonicalPath = path.join(targetBaseDir, 'projects', cleanSeries, 'episodes', cleanEpisode, 'jobs', `${cleanJobId}.json`);

  // If file already exists at canonical path, use it
  if (fs.existsSync(canonicalPath)) {
    return canonicalPath;
  }

  // Fallback: Check if file exists in legacy uploads directory (only in default project environment)
  const isDefaultEnv = !baseUploadsDir || baseUploadsDir === CANONICAL_UPLOADS_DIR;
  if (isDefaultEnv && LEGACY_UPLOADS_DIR && LEGACY_UPLOADS_DIR !== targetBaseDir && fs.existsSync(LEGACY_UPLOADS_DIR)) {
    const legacyPath = path.join(LEGACY_UPLOADS_DIR, 'projects', cleanSeries, 'episodes', cleanEpisode, 'jobs', `${cleanJobId}.json`);
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
  }

  // If not found, return canonicalPath for new writes
  return canonicalPath;
}

/**
 * Persists JSON data using safe atomic writes:
 * Writes to a unique temp file in the same directory, then atomically renames to target.
 * Strictly prevents partially written or corrupted JSON files on disk.
 */
function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = path.join(
    dir,
    `.tmp_${path.basename(filePath)}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );

  const jsonContent = JSON.stringify(data, null, 2);
  fs.writeFileSync(tempPath, jsonContent, 'utf8');

  try {
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (renameErr) {
    // Windows rename fallback (file lock / transient access)
    try {
      fs.copyFileSync(tempPath, filePath);
      fs.unlinkSync(tempPath);
    } catch (copyErr) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      throw copyErr;
    }
  }
}

class ProductionJobQueue {
  constructor(options = {}) {
    this.inMemoryJobs = new Map();
    this.activeAbortControllers = new Map();
    this.activeEpisodeLocks = new Map();
    this.workerHandler = null;
    this.baseUploadsDir = options.baseUploadsDir || CANONICAL_UPLOADS_DIR;
    
    // Concurrency default is 1, max configurable is 2
    const envConcurrency = process.env.DRAGONDUB_MAX_CONCURRENT_JOBS
      ? parseInt(process.env.DRAGONDUB_MAX_CONCURRENT_JOBS, 10)
      : null;
    this.maxConcurrency = this.normalizeConcurrency(options.maxConcurrency || envConcurrency || DEFAULT_MAX_CONCURRENCY);
    this.isProcessing = false;
    this.events = new EventEmitter();
  }

  normalizeConcurrency(val) {
    if (typeof val !== 'number' || isNaN(val) || val < 1) {
      return DEFAULT_MAX_CONCURRENCY;
    }
    // Hard ceiling of 2 in Phase 4.1 to strictly prevent CPU/GPU thrashing
    return Math.min(MAX_CONFIGURABLE_CONCURRENCY, Math.floor(val));
  }

  setMaxConcurrency(val) {
    this.maxConcurrency = this.normalizeConcurrency(val);
    this.processQueue();
    return this.maxConcurrency;
  }

  getMaxConcurrency() {
    return this.maxConcurrency;
  }

  /**
   * Acquires a mutual exclusion lock for an episode (used by direct pipeline).
   */
  acquireEpisodeLock(seriesId, episodeId, lockType = 'pipeline', workerId = 'direct_worker') {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;

    if (this.hasActiveJobForEpisode(cleanSeries, cleanEpisode)) {
      const active = this.getActiveJobForEpisode(cleanSeries, cleanEpisode);
      const duplicateMsg = `Duplicate Active Job: An active job or lock (#${active?.jobId || 'episode_lock'}) is already running for ${cleanSeries}/${cleanEpisode}`;
      const err = new Error(duplicateMsg);
      err.code = 'DUPLICATE_ACTIVE_JOB';
      err.existingJobId = active?.jobId || 'episode_lock';
      err.status = active?.status || 'running';
      err.httpStatus = 409;
      throw err;
    }

    this.activeEpisodeLocks.set(lockKey, {
      seriesId: cleanSeries,
      episodeId: cleanEpisode,
      lockType,
      workerId,
      acquiredAt: Date.now(),
    });
    return true;
  }

  /**
   * Releases an episode lock.
   */
  releaseEpisodeLock(seriesId, episodeId) {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;
    return this.activeEpisodeLocks.delete(lockKey);
  }

  /**
   * Checks if an active job or execution lock already exists for the given series and episode.
   * Active statuses: queued, running, recovering.
   */
  hasActiveJobForEpisode(seriesId, episodeId) {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;

    if (this.activeEpisodeLocks.has(lockKey)) {
      return true;
    }

    for (const job of this.inMemoryJobs.values()) {
      if (
        job.seriesId === cleanSeries &&
        job.episodeId === cleanEpisode &&
        ACTIVE_STATUSES.has(job.status)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Retrieves the current active job or execution lock for an episode, if any.
   */
  getActiveJobForEpisode(seriesId, episodeId) {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;

    if (this.activeEpisodeLocks.has(lockKey)) {
      const lock = this.activeEpisodeLocks.get(lockKey);
      return {
        jobId: `lock_${lock.lockType}`,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        status: JOB_STATUS.RUNNING,
        lockType: lock.lockType,
        isVirtualLock: true,
      };
    }

    for (const job of this.inMemoryJobs.values()) {
      if (
        job.seriesId === cleanSeries &&
        job.episodeId === cleanEpisode &&
        ACTIVE_STATUSES.has(job.status)
      ) {
        return job;
      }
    }
    return null;
  }

  /**
   * Enqueues a new job with FIFO ordering, priority support, and duplicate prevention.
   */
  enqueueJob({
    seriesId = 'series_default',
    episodeId = 'ep_1',
    videoPath = null,
    mode = 'dialogue',
    priority = 5,
    totalDurationSec = 0,
    chunkSizeSec = 300,
    overlapSec = 2,
    totalSegments = 0,
    config = {},
    baseUploadsDir = null,
    allowDuplicate = false,
    throwOnDuplicate = true,
  } = {}) {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const targetBaseDir = baseUploadsDir || this.baseUploadsDir;

    // Duplicate Active Job Policy:
    // Reject new submission if an active job already exists for this exact episode
    if (!allowDuplicate && this.hasActiveJobForEpisode(cleanSeries, cleanEpisode)) {
      const activeJob = this.getActiveJobForEpisode(cleanSeries, cleanEpisode);
      const duplicateMsg = `Duplicate Active Job: An active job (#${activeJob?.jobId || 'active'}) is already ${activeJob?.status || 'running'} for ${cleanSeries}/${cleanEpisode}`;
      if (throwOnDuplicate) {
        const err = new Error(duplicateMsg);
        err.code = 'DUPLICATE_ACTIVE_JOB';
        err.existingJobId = activeJob?.jobId || 'active';
        err.status = activeJob?.status || 'running';
        err.httpStatus = 409;
        throw err;
      }
      return {
        isDuplicate: true,
        jobId: activeJob?.jobId,
        status: activeJob?.status,
        jobData: activeJob,
        abortSignal: activeJob?.jobId ? this.getJobSignal(activeJob.jobId) : null,
      };
    }

    const jobId = `job_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const parsedPriority = Number.isInteger(priority) ? priority : 5;

    const jobData = {
      // Identity & Routing
      jobId,
      seriesId: cleanSeries,
      episodeId: cleanEpisode,
      mode,
      priority: parsedPriority,

      // Top-level fields preserved for 100% backward compatibility
      videoPath,
      totalDurationSec: parseFloat((totalDurationSec || 0).toFixed(2)),
      chunkSizeSec,
      overlapSec,
      chunks: [],
      finalResult: null,
      error: null,

      // Status & Lifecycle
      status: JOB_STATUS.QUEUED,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
      completedAt: null,

      // Execution & Progress State
      currentStage: 'initialized',
      stageMessage: 'Job queued in production queue...',
      progress: 0,
      totalSegments: Number.isFinite(totalSegments) ? Math.max(0, totalSegments) : 0,
      completedSegments: 0,
      failedSegments: 0,

      // Resiliency Metadata
      retryPolicy: {
        retryCount: 0,
        maxRetries: 3,
        lastError: null,
        recoverable: false,
      },

      // Configuration & Technical Artifacts
      config: {
        videoPath,
        totalDurationSec: parseFloat((totalDurationSec || 0).toFixed(2)),
        chunkSizeSec,
        overlapSec,
        ...config,
      },

      // Checkpoints (stored as event records, NOT as a job status)
      checkpoints: {},

      output: {
        finalVideoPath: null,
        finalVideoUrl: null,
        masterAudioPath: null,
        subtitlesAssPath: null,
        subtitlesSrtPath: null,
      },
    };

    // Store in-memory
    this.inMemoryJobs.set(jobId, jobData);
    const controller = new AbortController();
    this.activeAbortControllers.set(jobId, controller);

    // Persist to disk atomically
    try {
      const filePath = getJobFilePath(cleanSeries, cleanEpisode, jobId, targetBaseDir);
      atomicWriteJson(filePath, jobData);
    } catch (err) {
      console.warn(`[ProductionJobQueue] Failed to persist new job ${jobId} to disk:`, err.message);
    }

    // Trigger queue evaluation if worker is registered
    if (this.workerHandler) {
      this.processQueue();
    }

    this.events.emit('job_change', { action: 'enqueue', job: jobData });

    return {
      isDuplicate: false,
      jobId,
      status: jobData.status,
      jobData,
      abortSignal: controller.signal,
    };
  }

  /**
   * Retrieves a job by ID from memory or disk safely.
   */
  getJob(jobId, seriesId = null, episodeId = null, baseUploadsDir = null) {
    if (!jobId) return null;
    const cleanJobId = sanitizeIdentifier(jobId, '');
    if (!cleanJobId) return null;

    if (this.inMemoryJobs.has(cleanJobId)) {
      return this.inMemoryJobs.get(cleanJobId);
    }

    // Attempt loading from disk if series and episode are provided
    if (seriesId && episodeId) {
      try {
        const filePath = getJobFilePath(seriesId, episodeId, cleanJobId, baseUploadsDir || this.baseUploadsDir);
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(raw);
          this.inMemoryJobs.set(cleanJobId, data);
          return data;
        }
      } catch (err) {
        console.warn(`[ProductionJobQueue] Corrupted or unreadable job manifest for ${cleanJobId}:`, err.message);
        return null;
      }
    }

    return null;
  }

  /**
   * Updates job fields in memory and writes atomically to disk.
   */
  updateJob(jobId, updates = {}) {
    const job = this.inMemoryJobs.get(jobId);
    if (!job) return null;

    const previousStatus = job.status;
    const targetStatus = updates.status || job.status;

    // Validate status transition
    if (updates.status && !Object.values(JOB_STATUS).includes(updates.status)) {
      throw new Error(`Invalid job status: '${updates.status}'`);
    }

    // Auto-manage lifecycle timestamps
    if (targetStatus === JOB_STATUS.RUNNING && !job.startedAt) {
      job.startedAt = Date.now();
    }
    if (
      [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED].includes(targetStatus) &&
      !job.completedAt
    ) {
      job.completedAt = Date.now();
    }

    // Apply updates safely (preserve core identifiers)
    Object.assign(job, updates, {
      jobId: job.jobId,
      seriesId: job.seriesId,
      episodeId: job.episodeId,
      updatedAt: Date.now(),
    });

    // Record structured log event for UI live console streaming
    if (!Array.isArray(job.logs)) job.logs = [];
    if (updates.stageMessage || updates.currentStage) {
      const logEntry = {
        time: Date.now(),
        progress: typeof updates.progress === 'number' ? updates.progress : (job.progress || 0),
        stage: updates.currentStage || job.currentStage || 'running',
        message: updates.stageMessage || ''
      };
      const last = job.logs[job.logs.length - 1];
      if (!last || last.message !== logEntry.message || Math.abs(last.progress - logEntry.progress) >= 2) {
        job.logs.push(logEntry);
        if (job.logs.length > 80) job.logs.shift();
      }
    }

    // Write to disk atomically
    try {
      const filePath = getJobFilePath(job.seriesId, job.episodeId, jobId, this.baseUploadsDir);
      atomicWriteJson(filePath, job);
    } catch (err) {
      console.warn(`[ProductionJobQueue] Failed to flush atomic update for ${jobId}:`, err.message);
    }

    this.events.emit('job_change', { action: 'update', job });

    // If job transitioned out of running/active into terminal, trigger queue for next job
    if (previousStatus === JOB_STATUS.RUNNING && targetStatus !== JOB_STATUS.RUNNING) {
      this.processQueue();
    }

    return job;
  }

  /**
   * Updates a specific chunk status and result (backward compatibility).
   */
  updateChunk(jobId, chunkIndex, chunkUpdates = {}) {
    const job = this.inMemoryJobs.get(jobId);
    if (!job || !Array.isArray(job.chunks)) return null;

    const target = job.chunks.find((c) => c.chunkIndex === chunkIndex);
    if (target) {
      Object.assign(target, chunkUpdates);
    } else {
      job.chunks.push({ chunkIndex, ...chunkUpdates });
    }

    // Calculate real progress percentage based on completed chunks
    if (job.chunks.length > 0) {
      const completedCount = job.chunks.filter((c) => c.status === 'completed').length;
      const chunkProgressWeight = 80;
      const calculated = Math.min(85, Math.round((completedCount / job.chunks.length) * chunkProgressWeight));
      job.progress = Math.max(job.progress, calculated);
    }

    job.updatedAt = Date.now();

    try {
      const filePath = getJobFilePath(job.seriesId, job.episodeId, jobId, this.baseUploadsDir);
      atomicWriteJson(filePath, job);
    } catch (_) {}

    return job;
  }

  /**
   * Pauses a running or queued job.
   */
  pauseJob(jobId) {
    const job = this.inMemoryJobs.get(jobId);
    if (!job) return null;

    if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.CANCELLED) {
      throw new Error(`Cannot pause a terminal job (${job.status})`);
    }

    const wasRunning = job.status === JOB_STATUS.RUNNING;
    job.status = JOB_STATUS.PAUSED;
    job.stageMessage = 'Job paused by user';
    job.updatedAt = Date.now();

    try {
      const filePath = getJobFilePath(job.seriesId, job.episodeId, jobId, this.baseUploadsDir);
      atomicWriteJson(filePath, job);
    } catch (_) {}

    this.events.emit('job_change', { action: 'pause', job });
    if (wasRunning) {
      this.processQueue();
    }

    return job;
  }

  /**
   * Resumes a paused or failed job back into the queued state.
   */
  resumeJob(jobId) {
    const job = this.inMemoryJobs.get(jobId);
    if (!job) return null;

    if (![JOB_STATUS.PAUSED, JOB_STATUS.FAILED].includes(job.status)) {
      throw new Error(`Cannot resume a job with status '${job.status}' (must be paused or failed)`);
    }

    job.status = JOB_STATUS.QUEUED;
    job.stageMessage = 'Job resumed back into queue';
    job.updatedAt = Date.now();

    try {
      const filePath = getJobFilePath(job.seriesId, job.episodeId, jobId, this.baseUploadsDir);
      atomicWriteJson(filePath, job);
    } catch (_) {}

    this.events.emit('job_change', { action: 'resume', job });
    this.processQueue();
    return job;
  }

  /**
   * Cancels a job and signals its AbortController.
   */
  cancelJob(jobId) {
    const controller = this.activeAbortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(jobId);
    }

    const job = this.inMemoryJobs.get(jobId);
    if (job) {
      const wasRunning = job.status === JOB_STATUS.RUNNING;
      job.status = JOB_STATUS.CANCELLED;
      job.stageMessage = 'Job was cancelled by user';
      job.completedAt = Date.now();
      job.updatedAt = Date.now();

      try {
        const filePath = getJobFilePath(job.seriesId, job.episodeId, jobId, this.baseUploadsDir);
        atomicWriteJson(filePath, job);
      } catch (_) {}

      this.events.emit('job_change', { action: 'cancel', job });
      if (wasRunning) {
        this.processQueue();
      }
      return job;
    }
    return null;
  }

  /**
   * Returns the AbortSignal for a job.
   */
  getJobSignal(jobId) {
    return this.activeAbortControllers.get(jobId)?.signal || null;
  }

  /**
   * Registers a worker callback invoked when a job transitions from queued to running.
   */
  registerWorkerHandler(handlerFn) {
    if (typeof handlerFn === 'function') {
      this.workerHandler = handlerFn;
      this.processQueue();
    }
  }

  /**
   * Core Queue Processing Engine:
   * Enforces MAX_CONCURRENT_JOBS (default: 1, configurable up to 2).
   * Sorts queued jobs using Stable Priority-FIFO ordering:
   * 1. Priority ascending (1 before 5)
   * 2. Enqueue createdAt ascending (FIFO)
   */
  processQueue() {
    if (!this.workerHandler) return;
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const runningJobs = Array.from(this.inMemoryJobs.values()).filter(
        (j) => j.status === JOB_STATUS.RUNNING
      );

      const availableSlots = this.maxConcurrency - runningJobs.length;
      if (availableSlots <= 0) {
        return;
      }

      // Find all candidates in queued status
      const queuedJobs = Array.from(this.inMemoryJobs.values()).filter(
        (j) => j.status === JOB_STATUS.QUEUED
      );

      if (queuedJobs.length === 0) {
        return;
      }

      // Stable Priority-FIFO Comparator:
      // Priority (lower number = higher priority) -> createdAt (FIFO)
      queuedJobs.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.createdAt - b.createdAt;
      });

      const jobsToStart = queuedJobs.slice(0, availableSlots);

      for (const job of jobsToStart) {
        job.status = JOB_STATUS.RUNNING;
        job.startedAt = Date.now();
        job.updatedAt = Date.now();
        job.stageMessage = 'Processing job in active worker slot...';

        try {
          const filePath = getJobFilePath(job.seriesId, job.episodeId, job.jobId, this.baseUploadsDir);
          atomicWriteJson(filePath, job);
        } catch (_) {}

        if (typeof this.workerHandler === 'function') {
          // Execute worker asynchronously without blocking queue pump
          Promise.resolve()
            .then(() => this.workerHandler(job))
            .catch(async (err) => {
              console.error(`[ProductionJobQueue] Error in worker handler for ${job.jobId}:`, err.message);
              const retryCount = (job.retryPolicy?.retryCount || 0);
              const maxRetries = (job.retryPolicy?.maxRetries || 3);
              const isFatal = String(err.message || '').includes('Video file not found');

              if (!isFatal && retryCount < maxRetries) {
                const nextRetry = retryCount + 1;
                const backoffMs = Math.min(10000, 2000 * nextRetry);
                console.log(`[ProductionJobQueue] 🔄 Auto-recovering job ${job.jobId} (Attempt ${nextRetry}/${maxRetries}) in ${backoffMs}ms...`);
                
                this.updateJob(job.jobId, {
                  status: JOB_STATUS.QUEUED,
                  stageMessage: `កំពុងព្យាយាមឡើងវិញដោយស្វ័យប្រវត្តិ (Auto-retry ${nextRetry}/${maxRetries})...`,
                  retryPolicy: {
                    ...job.retryPolicy,
                    retryCount: nextRetry,
                    lastError: err.message,
                  },
                });

                setTimeout(() => {
                  this.processQueue();
                }, backoffMs);
                return;
              }

              this.updateJob(job.jobId, {
                status: JOB_STATUS.FAILED,
                error: err.message,
                stageMessage: `បរាជ័យ: ${err.message}`,
              });
            });
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Recovers dangling jobs (crash recovery engine).
   */
  recoverDanglingJobs(options = {}) {
    const { recoverDanglingJobs: runRecovery } = require('./recoveryEngine');
    return runRecovery({
      queue: this,
      baseUploadsDir: options.baseUploadsDir || this.baseUploadsDir,
      ...options,
    });
  }

  /**
   * Saves a verifiable checkpoint for a job.
   */
  saveCheckpoint(options = {}) {
    const { saveCheckpoint: saveCp } = require('./checkpointManager');
    return saveCp({
      baseUploadsDir: options.baseUploadsDir || this.baseUploadsDir,
      ...options,
    });
  }

  /**
   * Retrieves the latest valid checkpoint for a job.
   */
  getLatestValidCheckpoint(jobId, seriesId, episodeId, options = {}) {
    const { getLatestValidCheckpoint: getLatestCp } = require('./checkpointManager');
    return getLatestCp(
      jobId,
      seriesId,
      episodeId,
      options,
      options.baseUploadsDir || this.baseUploadsDir
    );
  }

  /**
   * Records a completed TTS segment into the durable ledger.
   */
  recordSegmentCompletion(options = {}) {
    const { recordSegmentCompletion: recordSeg } = require('./segmentLedger');
    return recordSeg({
      baseUploadsDir: options.baseUploadsDir || this.baseUploadsDir,
      ...options,
    });
  }

  /**
   * Loads the segment completion ledger for a job.
   */
  loadSegmentLedger(jobId, seriesId, episodeId, baseUploadsDir = null) {
    const { loadSegmentLedger: loadLedger } = require('./segmentLedger');
    return loadLedger(jobId, seriesId, episodeId, baseUploadsDir || this.baseUploadsDir);
  }

  /**
   * Verifies the integrity of a segment's audio output.
   */
  async verifySegmentAudioIntegrity(options = {}) {
    const { verifySegmentAudioIntegrity: verifySeg } = require('./segmentLedger');
    return verifySeg({
      baseUploadsDir: options.baseUploadsDir || this.baseUploadsDir,
      ...options,
    });
  }

  /**
   * Diagnostic snapshot of queue state.
   */
  getQueueSnapshot() {
    const all = Array.from(this.inMemoryJobs.values());
    return {
      maxConcurrency: this.maxConcurrency,
      totalJobs: all.length,
      runningCount: all.filter((j) => j.status === JOB_STATUS.RUNNING).length,
      queuedCount: all.filter((j) => j.status === JOB_STATUS.QUEUED).length,
      pausedCount: all.filter((j) => j.status === JOB_STATUS.PAUSED).length,
      completedCount: all.filter((j) => j.status === JOB_STATUS.COMPLETED).length,
      failedCount: all.filter((j) => j.status === JOB_STATUS.FAILED).length,
      cancelledCount: all.filter((j) => j.status === JOB_STATUS.CANCELLED).length,
    };
  }

  /**
   * Resets in-memory maps for test isolation.
   */

  /**
   * Retries a failed or cancelled job, resetting status to queued.
   */
  retryJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (job.status !== JOB_STATUS.FAILED && job.status !== JOB_STATUS.CANCELLED) {
      throw new Error(`Only failed or cancelled jobs can be retried (current status: '${job.status}')`);
    }

    job.status = JOB_STATUS.QUEUED;
    job.error = null;
    job.stageMessage = 'Job queued for retry in production queue...';
    if (!job.retryPolicy) {
      job.retryPolicy = { retryCount: 0, maxRetries: 3, lastError: null, recoverable: false };
    }
    job.retryPolicy.retryCount = (job.retryPolicy.retryCount || 0) + 1;
    job.updatedAt = Date.now();

    const controller = new AbortController();
    this.activeAbortControllers.set(job.jobId, controller);

    try {
      const filePath = getJobFilePath(job.seriesId, job.episodeId, job.jobId, this.baseUploadsDir);
      atomicWriteJson(filePath, job);
    } catch (_) {}

    this.events.emit('job_change', { action: 'retry', job });
    this.processQueue();
    return job;
  }

  /**
   * Heartbeat to keep worker lease alive during long stages.
   */
  heartbeat(jobId, workerId, leaseDurationMs) {
    const job = this.inMemoryJobs.get(jobId);
    if (!job) return false;
    const { renewJobLease } = require('./recoveryEngine');
    const renewed = renewJobLease(job, workerId, leaseDurationMs);
    if (renewed) {
      try {
        const filePath = getJobFilePath(job.seriesId, job.episodeId, jobId, this.baseUploadsDir);
        atomicWriteJson(filePath, job);
      } catch (_) {}
      this.events.emit('job_change', { action: 'heartbeat', job });
    }
    return renewed;
  }

  /**
   * Retrieves all jobs across series and episodes, with optional status filter.
   */
  getAllJobs(filter = null) {
    const effectiveBaseDir = this.baseUploadsDir || CANONICAL_UPLOADS_DIR;
    if (this.inMemoryJobs.size === 0) {
      try {
        const { scanJobFilesOnDisk } = require('./recoveryEngine');
        if (typeof scanJobFilesOnDisk === 'function') {
          const diskJobs = scanJobFilesOnDisk(effectiveBaseDir);
          for (const dj of diskJobs) {
            this.inMemoryJobs.set(dj.jobId, dj);
          }
        }
      } catch (_) {}
    }

    let all = Array.from(this.inMemoryJobs.values());
    if (filter && filter !== 'all') {
      const targetFilter = String(filter).toLowerCase();
      all = all.filter((j) => String(j.status).toLowerCase() === targetFilter);
    }

    all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return all;
  }

  clearMemoryForTesting() {
    this.inMemoryJobs.clear();
    this.activeAbortControllers.clear();
    if (this.activeEpisodeLocks) {
      this.activeEpisodeLocks.clear();
    }
    this.workerHandler = null;
    this.maxConcurrency = DEFAULT_MAX_CONCURRENCY;
    this.isProcessing = false;
  }
}

// Global Singleton Instance
const globalJobQueue = new ProductionJobQueue();

module.exports = {
  JOB_STATUS,
  ACTIVE_STATUSES,
  CANONICAL_UPLOADS_DIR,
  LEGACY_UPLOADS_DIR,
  DEFAULT_MAX_CONCURRENCY,
  MAX_CONFIGURABLE_CONCURRENCY,
  ProductionJobQueue,
  productionJobQueue: globalJobQueue,
  atomicWriteJson,
  sanitizeIdentifier,
  getJobDir,
  getJobFilePath,
};
