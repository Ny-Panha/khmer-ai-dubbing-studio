/**
 * Job Manager Service (Phase 4.1 Production Queue Facade)
 * Fully delegates to ProductionJobQueue while preserving 100% backward compatibility
 * with existing pipeline orchestrators and acceptance test suites.
 */
const {
  JOB_STATUS,
  ACTIVE_STATUSES,
  CANONICAL_UPLOADS_DIR,
  LEGACY_UPLOADS_DIR,
  DEFAULT_MAX_CONCURRENCY,
  MAX_CONFIGURABLE_CONCURRENCY,
  ProductionJobQueue,
  productionJobQueue,
  atomicWriteJson,
  sanitizeIdentifier,
  getJobDir,
  getJobFilePath,
} = require('./productionJobQueue');
const {
  saveCheckpoint,
  getLatestValidCheckpoint,
  validateCheckpointSchema,
  validateCheckpointIntegrity,
  generateVideoFingerprint,
} = require('./checkpointManager');
const {
  recordSegmentCompletion,
  loadSegmentLedger,
  verifySegmentAudioIntegrity,
  generateSegmentFingerprint,
} = require('./segmentLedger');
const {
  recoverDanglingJobs,
  acquireJobLease,
  renewJobLease,
  releaseJobLease,
  isJobLeaseExpired,
} = require('./recoveryEngine');

/**
 * Creates a new tracking job and persists to disk.
 * Wraps productionJobQueue.enqueueJob with identical backward-compatible interface.
 */
function createJob({
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
  return productionJobQueue.enqueueJob({
    seriesId,
    episodeId,
    videoPath,
    mode,
    priority,
    totalDurationSec,
    chunkSizeSec,
    overlapSec,
    totalSegments,
    config,
    baseUploadsDir,
    allowDuplicate,
    throwOnDuplicate,
  });
}

/**
 * Retrieves a job by ID from memory or disk safely.
 */
function getJob(jobId, seriesId = null, episodeId = null, baseUploadsDir = null) {
  return productionJobQueue.getJob(jobId, seriesId, episodeId, baseUploadsDir);
}

/**
 * Updates job properties in memory and flushes to disk atomically.
 */
function updateJob(jobId, updates = {}) {
  return productionJobQueue.updateJob(jobId, updates);
}

/**
 * Updates a specific chunk status and result.
 */
function updateChunk(jobId, chunkIndex, chunkUpdates = {}) {
  return productionJobQueue.updateChunk(jobId, chunkIndex, chunkUpdates);
}

/**
 * Pauses a running or queued job.
 */
function pauseJob(jobId) {
  return productionJobQueue.pauseJob(jobId);
}

/**
 * Resumes a paused or failed job back into the queued state.
 */
function resumeJob(jobId) {
  return productionJobQueue.resumeJob(jobId);
}

/**
 * Cancels a running job and triggers its AbortController.
 */
function cancelJob(jobId) {
  return productionJobQueue.cancelJob(jobId);
}

/**
 * Gets the AbortSignal for a job.
 */
function getJobSignal(jobId) {
  return productionJobQueue.getJobSignal(jobId);
}

/**
 * Retries a failed or cancelled job.
 */
function retryJob(jobId) {
  return productionJobQueue.retryJob(jobId);
}

/**
 * Retrieves all jobs across series and episodes with optional status filter.
 */
function getAllJobs(filter = null) {
  return productionJobQueue.getAllJobs(filter);
}

module.exports = {
  JOB_STATUS,
  ACTIVE_STATUSES,
  DEFAULT_MAX_CONCURRENCY,
  MAX_CONFIGURABLE_CONCURRENCY,
  ProductionJobQueue,
  productionJobQueue,
  createJob,
  getJob,
  getAllJobs,
  updateJob,
  updateChunk,
  pauseJob,
  resumeJob,
  retryJob,
  cancelJob,
  getJobSignal,
  getJobFilePath,
  getJobDir,
  atomicWriteJson,
  sanitizeIdentifier,
  // Phase 4.2 Checkpoints, Ledger & Recovery Exports
  saveCheckpoint,
  getLatestValidCheckpoint,
  validateCheckpointSchema,
  validateCheckpointIntegrity,
  generateVideoFingerprint,
  recordSegmentCompletion,
  loadSegmentLedger,
  verifySegmentAudioIntegrity,
  generateSegmentFingerprint,
  recoverDanglingJobs,
  acquireJobLease,
  renewJobLease,
  releaseJobLease,
  isJobLeaseExpired,
  CANONICAL_UPLOADS_DIR,
  LEGACY_UPLOADS_DIR,
};
