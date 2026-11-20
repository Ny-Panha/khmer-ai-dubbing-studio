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
  PARTIAL: 'partial',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RECOVERING: 'recovering',
});

const ACTIVE_STATUSES = new Set([
  JOB_STATUS.QUEUED,
  JOB_STATUS.RUNNING,
  JOB_STATUS.RECOVERING,
]);

const DEFAULT_MAX_CONCURRENCY = 2;
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

const pathUtils = require('../../utils/pathUtils');

const CANONICAL_UPLOADS_DIR = pathUtils.uploadsDir || path.resolve(__dirname, '../../uploads');
const LEGACY_UPLOADS_DIR = path.resolve(__dirname, '../../../uploads');

function getCanonicalUploadsDir() {
  try {
    const livePathUtils = require('../../utils/pathUtils');
    if (livePathUtils && livePathUtils.uploadsDir) {
      return livePathUtils.uploadsDir;
    }
  } catch (_) {}
  return CANONICAL_UPLOADS_DIR;
}

/**
 * Resolves the isolated jobs folder for an episode:
 * uploads/projects/:seriesId/episodes/:episodeId/jobs/
 */
function getJobDir(seriesId, episodeId, baseUploadsDir = null) {
  const uploadsDir = baseUploadsDir || getCanonicalUploadsDir();
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

  const defaultUploadsDir = getCanonicalUploadsDir();
  const targetBaseDir = baseUploadsDir || defaultUploadsDir;
  const canonicalPath = path.join(targetBaseDir, 'projects', cleanSeries, 'episodes', cleanEpisode, 'jobs', `${cleanJobId}.json`);

  // If file already exists at canonical path, use it
  if (fs.existsSync(canonicalPath)) {
    return canonicalPath;
  }

  // Fallback: Check if file exists in legacy uploads directory (only in default project environment)
  const isDefaultEnv = !baseUploadsDir || baseUploadsDir === defaultUploadsDir;
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
    this.activeExecutions = new Set();
    this.retryTimers = new Map();
    this.workerHandler = null;
    this.baseUploadsDir = options.baseUploadsDir || CANONICAL_UPLOADS_DIR;
    
    // Concurrency default is 2 (laptop CPU safe), max configurable is 4
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
    // Clamp between 1 and MAX_CONFIGURABLE_CONCURRENCY to strictly prevent CPU/GPU thrashing
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
   * Checks whether a worker is currently executing for a job ID.
   */
  isWorkerExecuting(jobId) {
    if (!jobId || !this.activeExecutions) return false;
    return this.activeExecutions.has(jobId);
  }

  /**
   * Checks whether any active execution is currently running for an episode.
   */
  isWorkerExecutingForEpisode(seriesId, episodeId, excludeJobId = null) {
    if (!this.activeExecutions || this.activeExecutions.size === 0) return false;
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;

    // 1. Check in-memory background queue workers
    for (const jobId of this.activeExecutions) {
      if (excludeJobId && jobId === excludeJobId) continue;
      const job = this.inMemoryJobs.get(jobId);
      if (job && job.seriesId === cleanSeries && job.episodeId === cleanEpisode) {
        return true;
      }
    }

    // 2. Check active episode locks (including direct pipelines)
    if (this.activeEpisodeLocks.has(lockKey)) {
      const lock = this.activeEpisodeLocks.get(lockKey);
      if (lock && (!excludeJobId || lock.workerId !== excludeJobId)) {
        if (this.activeExecutions.has(lock.workerId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Waits for a running worker to fully settle (clean up and finish execution).
   */
  waitForWorkerSettlement(jobId, timeoutMs = 5000) {
    if (!jobId || !this.activeExecutions || !this.activeExecutions.has(jobId)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.events.off('worker_settled', onSettled);
          resolve(!this.activeExecutions.has(jobId));
        }
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      const onSettled = (event) => {
        if (event?.jobId === jobId) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.events.off('worker_settled', onSettled);
            resolve(true);
          }
        }
      };

      this.events.on('worker_settled', onSettled);
    });
  }

  /**
   * Acquires a mutual exclusion lock for an episode (used by direct pipeline).
   */
  acquireEpisodeLock(seriesId, episodeId, lockType = 'pipeline', workerId = 'direct_worker', options = {}) {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;

    const existingLock = this.activeEpisodeLocks.get(lockKey);
    if (existingLock && existingLock.workerId === workerId) {
      return true;
    }

    if (this.hasActiveJobForEpisode(cleanSeries, cleanEpisode, workerId)) {
      const active = this.getActiveJobForEpisode(cleanSeries, cleanEpisode);
      if (active?.jobId !== workerId) {
        const duplicateMsg = `Duplicate Active Job: An active job or lock (#${active?.jobId || 'episode_lock'}) is already running for ${cleanSeries}/${cleanEpisode}`;
        const err = new Error(duplicateMsg);
        err.code = 'DUPLICATE_ACTIVE_JOB';
        err.existingJobId = active?.jobId || 'episode_lock';
        err.status = active?.status || 'running';
        err.httpStatus = 409;
        throw err;
      }
    }

    if (options.controller) {
      this.activeAbortControllers.set(workerId, options.controller);
    }
    if (lockType === 'direct_pipeline' || options.controller) {
      this.activeExecutions.add(workerId);
    }

    this.activeEpisodeLocks.set(lockKey, {
      seriesId: cleanSeries,
      episodeId: cleanEpisode,
      lockType,
      workerId,
      acquiredAt: Date.now(),
      controller: options.controller || null,
    });
    return true;
  }

  /**
   * Releases an episode lock safely.
   * If a worker is still executing, refuses release unless force=true.
   */
  releaseEpisodeLock(seriesId, episodeId, force = false, workerId = null) {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;

    // If not forced and worker is still executing for episode, refuse release
    if (!force && this.isWorkerExecutingForEpisode(cleanSeries, cleanEpisode)) {
      return false;
    }

    const existingLock = this.activeEpisodeLocks.get(lockKey);
    const targetWorkerId = workerId || (force ? existingLock?.workerId : null);

    if (targetWorkerId && (this.activeExecutions.has(targetWorkerId) || this.activeAbortControllers.has(targetWorkerId))) {
      this.activeExecutions.delete(targetWorkerId);
      this.activeAbortControllers.delete(targetWorkerId);
      this.events.emit('worker_settled', {
        jobId: targetWorkerId,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
      });
    }

    return this.activeEpisodeLocks.delete(lockKey);
  }

  /**
   * Checks if an active job or execution lock already exists for the given series and episode.
   * Active statuses: queued, running, recovering, or activeExecutions worker running.
   */
  hasActiveJobForEpisode(seriesId, episodeId, excludeJobId = null) {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;

    if (this.activeEpisodeLocks.has(lockKey)) {
      const lock = this.activeEpisodeLocks.get(lockKey);
      if (!excludeJobId || lock.workerId !== excludeJobId) {
        return true;
      }
    }

    if (this.isWorkerExecutingForEpisode(cleanSeries, cleanEpisode, excludeJobId)) {
      return true;
    }

    for (const job of this.inMemoryJobs.values()) {
      if (excludeJobId && job.jobId === excludeJobId) continue;
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
   * Prioritizes actual in-memory queued/running jobs so caller receives real jobId instead of virtual lock.
   */
  getActiveJobForEpisode(seriesId, episodeId) {
    const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
    const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
    const lockKey = `${cleanSeries}/${cleanEpisode}`;

    // 1. Check if a real queue job exists in memory (queued, running, recovering)
    for (const job of this.inMemoryJobs.values()) {
      if (job.seriesId === cleanSeries && job.episodeId === cleanEpisode) {
        if (ACTIVE_STATUSES.has(job.status) || this.activeExecutions.has(job.jobId)) {
          return job;
        }
      }
    }

    // 2. Check active episode locks (including direct pipelines or standalone locks)
    if (this.activeEpisodeLocks.has(lockKey)) {
      const lock = this.activeEpisodeLocks.get(lockKey);
      if (lock.workerId && this.inMemoryJobs.has(lock.workerId)) {
        return this.inMemoryJobs.get(lock.workerId);
      }
      return {
        jobId: lock.workerId || `lock_${lock.lockType}`,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        status: JOB_STATUS.RUNNING,
        lockType: lock.lockType,
        isVirtualLock: true,
        isDirectPipeline: lock.lockType === 'direct_pipeline',
      };
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

    this.events.emit('job_change', { action: 'enqueue', job: jobData });

    // Trigger queue evaluation if worker is registered
    if (this.workerHandler) {
      this.processQueue();
    }

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

    // Populate in-memory cache from disk once if empty (e.g., /:jobId/retry or /:jobId/status after restart)
    if (this.inMemoryJobs.size === 0) {
      this.getAllJobs();
      if (this.inMemoryJobs.has(cleanJobId)) {
        return this.inMemoryJobs.get(cleanJobId);
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

    const { _allowFromTerminal, ...cleanUpdates } = updates || {};

    // Prevent stale async pipeline callbacks from overwriting cancelled/completed/partial/paused jobs
    if (
      (job.status === JOB_STATUS.CANCELLED ||
        job.status === JOB_STATUS.COMPLETED ||
        job.status === JOB_STATUS.PARTIAL) &&
      !_allowFromTerminal
    ) {
      return job;
    }
    if (
      job.status === JOB_STATUS.PAUSED &&
      cleanUpdates.status !== JOB_STATUS.QUEUED &&
      cleanUpdates.status !== JOB_STATUS.CANCELLED &&
      !_allowFromTerminal
    ) {
      return job;
    }

    const previousStatus = job.status;
    const targetStatus = cleanUpdates.status || job.status;

    // Validate status transition
    if (cleanUpdates.status && !Object.values(JOB_STATUS).includes(cleanUpdates.status)) {
      throw new Error(`Invalid job status: '${cleanUpdates.status}'`);
    }

    // Auto-manage lifecycle timestamps
    if (targetStatus === JOB_STATUS.RUNNING && !job.startedAt) {
      job.startedAt = Date.now();
    }
    if (
      [JOB_STATUS.COMPLETED, JOB_STATUS.PARTIAL, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED].includes(targetStatus) &&
      !job.completedAt
    ) {
      job.completedAt = Date.now();
    }

    // Preserve totalSegments count whenever finalResult carries it (even if list serializer strips segments)
    if (
      cleanUpdates.finalResult &&
      typeof cleanUpdates.finalResult.totalSegments === 'number' &&
      cleanUpdates.totalSegments === undefined
    ) {
      cleanUpdates.totalSegments = cleanUpdates.finalResult.totalSegments;
    }

    // Apply updates safely (preserve core identifiers)
    Object.assign(job, cleanUpdates, {
      jobId: job.jobId,
      seriesId: job.seriesId,
      episodeId: job.episodeId,
      updatedAt: Date.now(),
    });

    // Record structured log event for UI live console streaming
    if (!Array.isArray(job.logs)) job.logs = [];
    if (cleanUpdates.stageMessage || cleanUpdates.currentStage) {
      const logEntry = {
        time: Date.now(),
        progress: typeof cleanUpdates.progress === 'number' ? cleanUpdates.progress : (job.progress || 0),
        stage: cleanUpdates.currentStage || job.currentStage || 'running',
        message: cleanUpdates.stageMessage || ''
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
    const job = this.getJob(jobId);
    if (!job) return null;

    if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.CANCELLED) {
      throw new Error(`Cannot pause a terminal job (${job.status})`);
    }

    const wasActive = job.status === JOB_STATUS.RUNNING || job.status === JOB_STATUS.RECOVERING;
    job.status = JOB_STATUS.PAUSED;
    job.stageMessage = 'Job paused by user';
    job.updatedAt = Date.now();

    const controller = this.activeAbortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(jobId);
    }

    try {
      const filePath = getJobFilePath(job.seriesId, job.episodeId, jobId, this.baseUploadsDir);
      atomicWriteJson(filePath, job);
    } catch (_) {}

    this.events.emit('job_change', { action: 'pause', job });
    if (wasActive) {
      this.processQueue();
    }

    return job;
  }

  /**
   * Resumes a paused or failed job back into the queued state.
   */
  resumeJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) return null;

    if (![JOB_STATUS.PAUSED, JOB_STATUS.FAILED].includes(job.status)) {
      throw new Error(`Cannot resume a job with status '${job.status}' (must be paused or failed)`);
    }

    job.status = JOB_STATUS.QUEUED;
    job.error = null;
    job.completedAt = null;
    job.stageMessage = 'Job resumed back into queue';
    job.updatedAt = Date.now();

    this.activeAbortControllers.set(job.jobId, new AbortController());

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
    const job = this.getJob(jobId);
    const controller = this.activeAbortControllers.get(jobId);

    // 1. Clear any active auto-recovery retry timer for this job
    if (this.retryTimers && this.retryTimers.has(jobId)) {
      try { clearTimeout(this.retryTimers.get(jobId)); } catch (_) {}
      this.retryTimers.delete(jobId);
    }

    if (!job) {
      if (controller) {
        controller.abort(new Error('Job was cancelled by user'));
        return { jobId, status: JOB_STATUS.CANCELLED, isDirectPipeline: true };
      }
      return null;
    }

    // Terminal State Protection:
    // Never change COMPLETED, FAILED, or PARTIAL to CANCELLED.
    if (
      job.status === JOB_STATUS.COMPLETED ||
      job.status === JOB_STATUS.FAILED ||
      job.status === JOB_STATUS.PARTIAL
    ) {
      return null;
    }

    // Repeated cancellation: If already CANCELLED, do not re-cancel or report false success
    if (job.status === JOB_STATUS.CANCELLED) {
      if (controller && !controller.signal.aborted) {
        controller.abort(new Error('Job was cancelled by user'));
      }
      return null;
    }

    const wasActive = job.status === JOB_STATUS.RUNNING || job.status === JOB_STATUS.RECOVERING;
    job.status = JOB_STATUS.CANCELLED;
    job.cancelRequested = true;
    job.stageMessage = 'Job was cancelled by user';
    job.completedAt = Date.now();
    job.updatedAt = Date.now();

    // Signal abort to active worker immediately
    if (controller) {
      controller.abort(new Error('Job was cancelled by user'));
    }

    // Episode Lock Release Race Prevention:
    // Only release mutual exclusion lock immediately if the worker is NOT currently executing!
    // If worker is running, lock is strictly retained and released in worker .finally() upon actual settlement.
    if (job.seriesId && job.episodeId && !this.isWorkerExecuting(job.jobId)) {
      this.releaseEpisodeLock(job.seriesId, job.episodeId, true);
    }

    try {
      const filePath = getJobFilePath(job.seriesId, job.episodeId, jobId, this.baseUploadsDir);
      atomicWriteJson(filePath, job);
    } catch (_) {}

    this.events.emit('job_change', { action: 'cancel', job });
    if (wasActive) {
      this.processQueue();
    }
    return job;
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
   * Enforces MAX_CONCURRENT_JOBS (default: 2, configurable up to 4).
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
        (j) => j.status === JOB_STATUS.RUNNING || this.activeExecutions.has(j.jobId)
      );

      const availableSlots = this.maxConcurrency - runningJobs.length;
      if (availableSlots <= 0) {
        return;
      }

      // Find all candidates in queued status not currently executing
      const queuedJobs = Array.from(this.inMemoryJobs.values()).filter(
        (j) => j.status === JOB_STATUS.QUEUED && !this.activeExecutions.has(j.jobId)
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
        // Strict Episode Isolation: Do not start a job if another worker is already active or stopping for this episode
        if (this.hasActiveJobForEpisode(job.seriesId, job.episodeId, job.jobId)) {
          continue;
        }

        if (!this.activeAbortControllers.has(job.jobId)) {
          this.activeAbortControllers.set(job.jobId, new AbortController());
        }

        const cleanSeries = sanitizeIdentifier(job.seriesId, 'series_default');
        const cleanEpisode = sanitizeIdentifier(job.episodeId, 'ep_1');
        const lockKey = `${cleanSeries}/${cleanEpisode}`;
        if (!this.activeEpisodeLocks.has(lockKey)) {
          this.activeEpisodeLocks.set(lockKey, {
            seriesId: cleanSeries,
            episodeId: cleanEpisode,
            lockType: 'queue_worker',
            workerId: job.jobId,
            acquiredAt: Date.now(),
          });
        }

        job.status = JOB_STATUS.RUNNING;
        job.startedAt = job.startedAt || Date.now();
        job.updatedAt = Date.now();
        job.stageMessage = 'Processing job in active worker slot...';

        try {
          const filePath = getJobFilePath(job.seriesId, job.episodeId, job.jobId, this.baseUploadsDir);
          atomicWriteJson(filePath, job);
        } catch (_) {}

        this.activeExecutions.add(job.jobId);
        this.events.emit('job_change', { action: 'start', job });

        if (typeof this.workerHandler === 'function') {
          // Execute worker asynchronously without blocking queue pump
          Promise.resolve()
            .then(() => this.workerHandler(job))
            .then((result) => {
              if (job.status === JOB_STATUS.CANCELLED || job.cancelRequested || this.getJobSignal(job.jobId)?.aborted) {
                return;
              }
              if (job.status === JOB_STATUS.RUNNING) {
                const isPartial = result && typeof result === 'object' && result.status === JOB_STATUS.PARTIAL;
                this.updateJob(job.jobId, {
                  status: isPartial ? JOB_STATUS.PARTIAL : JOB_STATUS.COMPLETED,
                  progress: 100,
                  currentStage: isPartial ? 'partial' : 'completed',
                  stageMessage:
                    (result && typeof result === 'object' && result.message) ||
                    'ការបង្កើតបានបញ្ចប់ដោយជោគជ័យ!',
                  ...(result !== undefined ? { finalResult: result } : {}),
                });
              }
            })
            .catch((err) => {
              const isAborted =
                job.status === JOB_STATUS.CANCELLED ||
                job.cancelRequested ||
                err?.name === 'AbortError' ||
                err?.code === 'ABORT_ERR' ||
                Boolean(this.getJobSignal(job.jobId)?.aborted) ||
                err?.message?.toLowerCase().includes('abort') ||
                err?.message?.toLowerCase().includes('cancel');

              if (isAborted) {
                if (job.status === JOB_STATUS.RUNNING) {
                  this.updateJob(job.jobId, {
                    status: JOB_STATUS.CANCELLED,
                    error: err?.message || 'Job was cancelled by user',
                    stageMessage: 'Job was cancelled by user',
                  });
                }
                if (this.retryTimers && this.retryTimers.has(job.jobId)) {
                  try { clearTimeout(this.retryTimers.get(job.jobId)); } catch (_) {}
                  this.retryTimers.delete(job.jobId);
                }
                return;
              }
              if (job.status === JOB_STATUS.PAUSED) {
                return;
              }

              const msg = String(err?.message || 'Pipeline execution failed');
              console.error(`[ProductionJobQueue] Error in worker handler for ${job.jobId}:`, msg);
              const retryCount = (job.retryPolicy?.retryCount || 0);
              const maxRetries = (job.retryPolicy?.maxRetries ?? 3);
              const msgLower = msg.toLowerCase();
              const isNonRetryable =
                err?.nonRetryable === true ||
                msg.includes('Video file not found') ||
                msg.includes('រកមិនឃើញ File វីដេអូ') ||
                msg.includes('Gemini API Key') ||
                msgLower.includes('api_key') ||
                msgLower.includes('unauthenticated') ||
                msgLower.includes('permission_denied') ||
                msgLower.includes('401') ||
                msgLower.includes('403') ||
                err?.status === 401 ||
                err?.status === 403 ||
                err?.status === 400;

              if (!isNonRetryable && retryCount < maxRetries) {
                const nextRetry = retryCount + 1;
                const backoffMs = Math.min(10000, 2000 * nextRetry);
                console.log(`[ProductionJobQueue] 🔄 Auto-recovering job ${job.jobId} (Attempt ${nextRetry}/${maxRetries}) in ${backoffMs}ms...`);

                this.updateJob(job.jobId, {
                  status: JOB_STATUS.RECOVERING,
                  stageMessage: `កំពុងព្យាយាមឡើងវិញដោយស្វ័យប្រវត្តិ (Auto-retry ${nextRetry}/${maxRetries})...`,
                  retryPolicy: {
                    ...job.retryPolicy,
                    retryCount: nextRetry,
                    lastError: msg,
                  },
                });

                const retryTimer = setTimeout(() => {
                  this.retryTimers.delete(job.jobId);
                  if (job.status === JOB_STATUS.RECOVERING) {
                    this.updateJob(job.jobId, { status: JOB_STATUS.QUEUED });
                    this.processQueue();
                  }
                }, backoffMs);
                if (typeof retryTimer.unref === 'function') {
                  retryTimer.unref();
                }
                this.retryTimers.set(job.jobId, retryTimer);
                return;
              }

              this.updateJob(job.jobId, {
                status: JOB_STATUS.FAILED,
                error: msg,
                stageMessage: `បរាជ័យ: ${msg}`,
              });
            })
            .finally(() => {
              this.activeExecutions.delete(job.jobId);
              if (job.seriesId && job.episodeId) {
                if (!this.isWorkerExecutingForEpisode(job.seriesId, job.episodeId)) {
                  this.releaseEpisodeLock(job.seriesId, job.episodeId, true);
                }
              }
              this.events.emit('worker_settled', {
                jobId: job.jobId,
                seriesId: job.seriesId,
                episodeId: job.episodeId,
              });
              this.processQueue();
            });
        } else {
          this.activeExecutions.delete(job.jobId);
          if (job.seriesId && job.episodeId) {
            if (!this.isWorkerExecutingForEpisode(job.seriesId, job.episodeId)) {
              this.releaseEpisodeLock(job.seriesId, job.episodeId, true);
            }
          }
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
    job.completedAt = null;
    job.startedAt = null;
    job.failedChunkIndex = null;
    if (job.progress >= 100) {
      job.progress = 0;
    }
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
    if (this.activeExecutions) {
      this.activeExecutions.clear();
    }
    if (this.retryTimers) {
      for (const t of this.retryTimers.values()) {
        try { clearTimeout(t); } catch (_) {}
      }
      this.retryTimers.clear();
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
