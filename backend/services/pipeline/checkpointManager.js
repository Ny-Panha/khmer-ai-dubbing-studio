const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  atomicWriteJson,
  sanitizeIdentifier,
  getJobDir,
} = require('./productionJobQueue');

const CHECKPOINT_SCHEMA_VERSION = '1.0';

/**
 * Generates a stable fingerprint for a source video file.
 */
function generateVideoFingerprint(videoPath) {
  if (!videoPath) return 'no_video';
  if (typeof videoPath !== 'string') return 'invalid_video';

  try {
    if (fs.existsSync(videoPath)) {
      const stat = fs.statSync(videoPath);
      // Read first 64KB for content hash
      const buffer = Buffer.alloc(Math.min(65536, stat.size));
      const fd = fs.openSync(videoPath, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, 0);
      fs.closeSync(fd);

      return crypto
        .createHash('sha256')
        .update(`${path.basename(videoPath)}_${stat.size}_${stat.mtimeMs}_`)
        .update(buffer)
        .digest('hex');
    }
  } catch (_) {}

  // Fallback if file not on local disk (mock or URI)
  return crypto.createHash('sha256').update(String(videoPath)).digest('hex');
}

/**
 * Resolves the canonical checkpoints ledger file path for a job.
 * uploads/projects/:seriesId/episodes/:episodeId/jobs/:jobId.checkpoints.json
 */
function getCheckpointFilePath(seriesId, episodeId, jobId, baseUploadsDir = null) {
  const jobDir = getJobDir(seriesId, episodeId, baseUploadsDir);
  const cleanJobId = sanitizeIdentifier(jobId, 'job_unknown');
  return path.join(jobDir, `${cleanJobId}.checkpoints.json`);
}

/**
 * Validates a checkpoint object against the required schema.
 */
function validateCheckpointSchema(cp) {
  if (!cp || typeof cp !== 'object') return false;
  if (!cp.checkpointId || typeof cp.checkpointId !== 'string') return false;
  if (typeof cp.sequence !== 'number' || cp.sequence < 1) return false;
  if (cp.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) return false;
  if (!cp.jobId || typeof cp.jobId !== 'string') return false;
  if (!cp.seriesId || typeof cp.seriesId !== 'string') return false;
  if (!cp.episodeId || typeof cp.episodeId !== 'string') return false;
  if (!cp.stage || typeof cp.stage !== 'string') return false;
  if (!cp.videoFingerprint || typeof cp.videoFingerprint !== 'string') return false;
  if (!['in_progress', 'completed'].includes(cp.stageStatus)) return false;
  return true;
}

/**
 * Validates checkpoint context and file integrity.
 */
function validateCheckpointIntegrity(checkpoint, expectedContext = {}) {
  if (!validateCheckpointSchema(checkpoint)) {
    return { valid: false, reason: 'SCHEMA_INVALID' };
  }

  if (expectedContext.jobId && checkpoint.jobId !== expectedContext.jobId) {
    return { valid: false, reason: 'JOB_ID_MISMATCH' };
  }
  if (expectedContext.seriesId && checkpoint.seriesId !== expectedContext.seriesId) {
    return { valid: false, reason: 'SERIES_ID_MISMATCH' };
  }
  if (expectedContext.episodeId && checkpoint.episodeId !== expectedContext.episodeId) {
    return { valid: false, reason: 'EPISODE_ID_MISMATCH' };
  }
  if (expectedContext.videoFingerprint && checkpoint.videoFingerprint !== expectedContext.videoFingerprint) {
    return { valid: false, reason: 'VIDEO_FINGERPRINT_MISMATCH' };
  }

  // Validate required artifact files if specified
  if (checkpoint.artifacts && typeof checkpoint.artifacts === 'object') {
    for (const [artKey, artPath] of Object.entries(checkpoint.artifacts)) {
      if (typeof artPath === 'string' && artPath) {
        // Enforce path containment within project base
        if (expectedContext.baseUploadsDir && !artPath.startsWith(expectedContext.baseUploadsDir)) {
          // Check if outside expected directory
          return { valid: false, reason: `ARTIFACT_OUTSIDE_BASE: ${artKey}` };
        }
        if (expectedContext.requireArtifactsExist && !fs.existsSync(artPath)) {
          return { valid: false, reason: `MISSING_ARTIFACT: ${artKey}` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Loads the checkpoints array for a job from disk safely.
 */
function loadCheckpoints(jobId, seriesId, episodeId, baseUploadsDir = null) {
  const filePath = getCheckpointFilePath(seriesId, episodeId, jobId, baseUploadsDir);
  if (!fs.existsSync(filePath)) {
    return { checkpoints: [], corrupted: false };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { checkpoints: [], corrupted: true };
    }
    return { checkpoints: parsed, corrupted: false };
  } catch (err) {
    console.warn(`[CheckpointManager] Corrupted checkpoint JSON for job ${jobId}:`, err.message);
    return { checkpoints: [], corrupted: true };
  }
}

/**
 * Saves a new checkpoint atomically to the job's checkpoints ledger.
 * Preserves the previous valid checkpoint if the new write fails.
 */
function saveCheckpoint({
  seriesId,
  episodeId,
  jobId,
  stage,
  stageIndex = 1,
  stageStatus = 'in_progress',
  videoFingerprint = 'default_fingerprint',
  data = {},
  artifacts = {},
  baseUploadsDir = null,
}) {
  const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
  const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
  const cleanJob = sanitizeIdentifier(jobId, 'job_unknown');

  const { checkpoints, corrupted } = loadCheckpoints(cleanJob, cleanSeries, cleanEpisode, baseUploadsDir);
  const safeCheckpoints = corrupted ? [] : [...checkpoints];

  const sequence = safeCheckpoints.length + 1;
  const checkpointId = `chk_${cleanJob}_seq${sequence}_${Date.now()}`;

  const newCheckpoint = {
    checkpointId,
    sequence,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    jobId: cleanJob,
    seriesId: cleanSeries,
    episodeId: cleanEpisode,
    stage,
    stageIndex,
    stageStatus,
    videoFingerprint,
    timestamp: Date.now(),
    data: { ...data },
    artifacts: { ...artifacts },
  };

  if (!validateCheckpointSchema(newCheckpoint)) {
    throw new Error(`[CheckpointManager] Generated checkpoint failed schema validation: ${checkpointId}`);
  }

  const updatedLedger = [...safeCheckpoints, newCheckpoint];
  const filePath = getCheckpointFilePath(cleanSeries, cleanEpisode, cleanJob, baseUploadsDir);

  // Atomic write to disk preserves previous file if anything fails
  atomicWriteJson(filePath, updatedLedger);

  return newCheckpoint;
}

/**
 * Retrieves the most recent fully validated checkpoint for a job.
 */
function getLatestValidCheckpoint(jobId, seriesId, episodeId, expectedContext = {}, baseUploadsDir = null) {
  const { checkpoints, corrupted } = loadCheckpoints(jobId, seriesId, episodeId, baseUploadsDir);
  if (corrupted || checkpoints.length === 0) return null;

  // Search backward from most recent sequence
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    const cp = checkpoints[i];
    const validation = validateCheckpointIntegrity(cp, {
      jobId,
      seriesId,
      episodeId,
      ...expectedContext,
    });
    if (validation.valid) {
      return cp;
    }
  }

  return null;
}

module.exports = {
  CHECKPOINT_SCHEMA_VERSION,
  generateVideoFingerprint,
  getCheckpointFilePath,
  validateCheckpointSchema,
  validateCheckpointIntegrity,
  loadCheckpoints,
  saveCheckpoint,
  getLatestValidCheckpoint,
};
