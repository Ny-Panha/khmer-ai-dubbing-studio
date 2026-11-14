const fs = require('fs');
const path = require('path');
const {
  JOB_STATUS,
  CANONICAL_UPLOADS_DIR,
  LEGACY_UPLOADS_DIR,
  atomicWriteJson,
  getJobFilePath,
} = require('./productionJobQueue');
const {
  getLatestValidCheckpoint,
  validateCheckpointIntegrity,
} = require('./checkpointManager');
const {
  loadSegmentLedger,
  verifySegmentAudioIntegrity,
} = require('./segmentLedger');

const DEFAULT_LEASE_DURATION_MS = 60000;

/**
 * Checks if a worker lease on a job is expired.
 */
function isJobLeaseExpired(job) {
  if (!job || typeof job !== 'object') return true;
  if (!job.workerLease || typeof job.workerLease !== 'object') return true;
  const expiresAt = Number(job.workerLease.expiresAt || 0);
  return expiresAt <= Date.now();
}

/**
 * Attempts to acquire an exclusive worker lease on a job.
 * Prevents multiple workers or concurrent processes from claiming the same job.
 */
function acquireJobLease(job, workerId, leaseDurationMs = DEFAULT_LEASE_DURATION_MS) {
  if (!job || typeof job !== 'object') return false;
  const now = Date.now();

  if (job.workerLease && typeof job.workerLease === 'object') {
    const isExpired = Number(job.workerLease.expiresAt || 0) <= now;
    const isSameWorker = job.workerLease.workerId === workerId;

    if (!isExpired && !isSameWorker) {
      // Job is locked by another active worker
      return false;
    }
  }

  job.workerLease = {
    workerId: String(workerId || 'default_worker'),
    lockedAt: now,
    expiresAt: now + leaseDurationMs,
    lastHeartbeat: now,
  };
  return true;
}

/**
 * Renews an existing worker lease with a heartbeat.
 */
function renewJobLease(job, workerId, leaseDurationMs = DEFAULT_LEASE_DURATION_MS) {
  if (!job || typeof job !== 'object') return false;
  const now = Date.now();

  if (!job.workerLease) {
    return acquireJobLease(job, workerId, leaseDurationMs);
  }

  const isSameWorker = job.workerLease.workerId === workerId;
  const isExpired = Number(job.workerLease.expiresAt || 0) <= now;

  if (!isSameWorker && !isExpired) {
    return false;
  }

  job.workerLease.workerId = String(workerId || job.workerLease.workerId || 'default_worker');
  job.workerLease.expiresAt = now + leaseDurationMs;
  job.workerLease.lastHeartbeat = now;
  job.updatedAt = now;
  return true;
}

/**
 * Releases the worker lease if owned by workerId.
 */
function releaseJobLease(job, workerId) {
  if (!job || !job.workerLease) return true;
  if (!workerId || job.workerLease.workerId === workerId) {
    job.workerLease = null;
    return true;
  }
  return false;
}

/**
 * Scans job manifest files from a specific folder.
 */
function scanJobFilesFromDir(baseUploadsDir) {
  const jobs = [];
  if (!baseUploadsDir || !fs.existsSync(baseUploadsDir)) return jobs;
  const projectsDir = path.join(baseUploadsDir, 'projects');
  if (!fs.existsSync(projectsDir)) return jobs;

  try {
    const seriesDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const sDir of seriesDirs) {
      const episodesDir = path.join(projectsDir, sDir.name, 'episodes');
      if (!fs.existsSync(episodesDir)) continue;

      const epDirs = fs.readdirSync(episodesDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const epDir of epDirs) {
        const jobsDir = path.join(episodesDir, epDir.name, 'jobs');
        if (!fs.existsSync(jobsDir)) continue;

        const files = fs.readdirSync(jobsDir).filter(
          (f) => f.endsWith('.json') && !f.includes('.checkpoints.') && !f.includes('.segments.')
        );
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(jobsDir, file), 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.jobId) {
              jobs.push(parsed);
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}

  return jobs;
}

/**
 * Scans job manifest files from disk across canonical backend/uploads and legacy uploads/.
 * Backward-compatible read support for existing jobs without requiring migration.
 */
function scanJobFilesOnDisk(baseUploadsDir = null) {
  const canonicalDir = baseUploadsDir || CANONICAL_UPLOADS_DIR;
  const scannedMap = new Map();

  // 1. Scan primary directory
  const primaryJobs = scanJobFilesFromDir(canonicalDir);
  for (const pj of primaryJobs) {
    scannedMap.set(pj.jobId, pj);
  }

  // 2. Scan fallback legacy directory only when running in default project environment
  const isDefaultEnv = !baseUploadsDir || baseUploadsDir === CANONICAL_UPLOADS_DIR;
  if (isDefaultEnv && LEGACY_UPLOADS_DIR && LEGACY_UPLOADS_DIR !== canonicalDir && fs.existsSync(LEGACY_UPLOADS_DIR)) {
    const legacyJobs = scanJobFilesFromDir(LEGACY_UPLOADS_DIR);
    for (const lj of legacyJobs) {
      if (!scannedMap.has(lj.jobId)) {
        scannedMap.set(lj.jobId, lj);
      }
    }
  }

  return Array.from(scannedMap.values());
}

/**
 * Crash Recovery Engine:
 * Scans jobs on startup or recovery invocation, enforces status transitions,
 * validates checkpoint and segment ledger integrity, and prevents double recovery.
 * 
 * Status Matrix:
 * - queued: remain queued
 * - running: transition to recovering -> validate -> return to queued on success (or failed if corrupt)
 * - paused: remain paused (never auto-resume)
 * - failed: remain failed (wait for explicit user action)
 * - cancelled: never auto-resume
 * - completed: never execute again
 */
function recoverDanglingJobs({
  queue,
  workerId = 'recovery_engine_main',
  baseUploadsDir = null,
  expectedVideoFingerprint = null,
  durationValidatorFn = null,
} = {}) {
  if (!queue) {
    throw new Error('[RecoveryEngine] Queue instance is required for recovery');
  }

  const effectiveBaseDir = baseUploadsDir || queue.baseUploadsDir;

  // On process restart, populate in-memory queue from disk if empty
  if (queue.inMemoryJobs.size === 0 && effectiveBaseDir) {
    const diskJobs = scanJobFilesOnDisk(effectiveBaseDir);
    for (const dj of diskJobs) {
      queue.inMemoryJobs.set(dj.jobId, dj);
    }
  }

  const results = [];
  let recoveredCount = 0;
  let failedCount = 0;
  let untouchedCount = 0;

  const allJobs = Array.from(queue.inMemoryJobs.values());

  for (const job of allJobs) {
    const currentStatus = job.status;

    // 1. Terminal and Inactive statuses are strictly left untouched
    if ([JOB_STATUS.COMPLETED, JOB_STATUS.CANCELLED, JOB_STATUS.FAILED, JOB_STATUS.PAUSED].includes(currentStatus)) {
      untouchedCount++;
      results.push({
        jobId: job.jobId,
        status: currentStatus,
        action: 'preserved_unchanged',
      });
      continue;
    }

    // 2. Queued jobs remain queued
    if (currentStatus === JOB_STATUS.QUEUED) {
      untouchedCount++;
      results.push({
        jobId: job.jobId,
        status: currentStatus,
        action: 'kept_queued',
      });
      continue;
    }

    // 3. Dangling jobs: 'running' or interrupted 'recovering'
    if (currentStatus === JOB_STATUS.RUNNING || currentStatus === JOB_STATUS.RECOVERING) {
      // Enforce worker lease to prevent double recovery across multiple instances
      const acquired = acquireJobLease(job, workerId);
      if (!acquired) {
        untouchedCount++;
        results.push({
          jobId: job.jobId,
          status: currentStatus,
          action: 'skipped_locked_by_other_worker',
        });
        continue;
      }

      // Transition to recovering state while validating
      job.status = JOB_STATUS.RECOVERING;
      job.stageMessage = 'កំពុងផ្ទៀងផ្ទាត់ Checkpoint និង Ledger ដើម្បីបន្តការងារ (Recovering...)';
      job.updatedAt = Date.now();

      try {
        const filePath = getJobFilePath(job.seriesId, job.episodeId, job.jobId, baseUploadsDir);
        atomicWriteJson(filePath, job);
      } catch (_) {}

      // Check for valid checkpoint
      const targetFingerprint = expectedVideoFingerprint || job.config?.videoFingerprint;
      const latestCheckpoint = getLatestValidCheckpoint(
        job.jobId,
        job.seriesId,
        job.episodeId,
        { videoFingerprint: targetFingerprint },
        baseUploadsDir
      );

      // Check segment ledger for TTS progress if in or past TTS stage
      const { segments: ledgerSegments } = loadSegmentLedger(
        job.jobId,
        job.seriesId,
        job.episodeId,
        baseUploadsDir
      );

      if (latestCheckpoint) {
        // Successfully validated checkpoint: transition back to queued for safe worker resumption
        job.status = JOB_STATUS.QUEUED;
        job.stageMessage = `បានបន្តដោយជោគជ័យពី Checkpoint: ${latestCheckpoint.stage} (Seq: ${latestCheckpoint.sequence})`;
        job.currentStage = latestCheckpoint.stage;
        job.recoveryInfo = {
          recoveredAt: Date.now(),
          checkpointId: latestCheckpoint.checkpointId,
          resumeStage: latestCheckpoint.stage,
          sequence: latestCheckpoint.sequence,
          completedSegmentsCount: Object.keys(ledgerSegments).length,
        };
        job.updatedAt = Date.now();

        // Release lease so worker can pick it up
        releaseJobLease(job, workerId);

        try {
          const filePath = getJobFilePath(job.seriesId, job.episodeId, job.jobId, baseUploadsDir);
          atomicWriteJson(filePath, job);
        } catch (_) {}

        recoveredCount++;
        results.push({
          jobId: job.jobId,
          status: JOB_STATUS.QUEUED,
          action: 'recovered_to_queued',
          checkpointId: latestCheckpoint.checkpointId,
          resumeStage: latestCheckpoint.stage,
        });
      } else {
        const retryCount = Number(job.retryPolicy?.retryCount || 0);
        const maxRetries = Number(job.retryPolicy?.maxRetries ?? 3);
        const canAutoRetry = retryCount < maxRetries;

        if (canAutoRetry) {
          // Auto-recover to queued: increments retry count and allows worker to resume cleanly (chunk caches on disk are preserved!)
          job.status = JOB_STATUS.QUEUED;
          job.retryPolicy = {
            ...(job.retryPolicy || {}),
            retryCount: retryCount + 1,
            lastError: 'WORKER_INTERRUPTED_AUTO_RECOVERED',
            recoverable: true,
          };
          job.stageMessage = `បានស្ដារការងារឡើងវិញដោយស្វ័យប្រវត្តបន្ទាប់ពី Server Restart (Auto-resuming attempt ${retryCount + 1}/${maxRetries}...)`;
          job.recoveryInfo = {
            recoveredAt: Date.now(),
            action: 'auto_retry_interrupted_worker',
            attempt: retryCount + 1,
          };
          job.updatedAt = Date.now();

          releaseJobLease(job, workerId);

          try {
            const filePath = getJobFilePath(job.seriesId, job.episodeId, job.jobId, baseUploadsDir);
            atomicWriteJson(filePath, job);
          } catch (_) {}

          recoveredCount++;
          results.push({
            jobId: job.jobId,
            status: JOB_STATUS.QUEUED,
            action: 'auto_retry_queued',
            attempt: retryCount + 1,
          });
        } else {
          // No valid checkpoint and exceeded retries: mark job failed with diagnostic message
          job.status = JOB_STATUS.FAILED;
          job.error = 'WORKER_INTERRUPTED';
          job.completedAt = job.completedAt || Date.now();
          job.stageMessage = 'ការងារត្រូវបានរំខានដោយសារ Server បាន Restart ឬ Worker បានដាច់ (Worker Interrupted)';
          job.updatedAt = Date.now();

          releaseJobLease(job, workerId);

          try {
            const filePath = getJobFilePath(job.seriesId, job.episodeId, job.jobId, baseUploadsDir);
            atomicWriteJson(filePath, job);
          } catch (_) {}

          failedCount++;
          results.push({
            jobId: job.jobId,
            status: JOB_STATUS.FAILED,
            action: 'marked_failed_missing_checkpoint',
            reason: 'WORKER_INTERRUPTED',
          });
        }
      }
    }
  }

  return {
    recoveredCount,
    failedCount,
    untouchedCount,
    totalScanned: allJobs.length,
    results,
  };
}

module.exports = {
  DEFAULT_LEASE_DURATION_MS,
  acquireJobLease,
  renewJobLease,
  releaseJobLease,
  isJobLeaseExpired,
  recoverDanglingJobs,
  scanJobFilesOnDisk,
};
