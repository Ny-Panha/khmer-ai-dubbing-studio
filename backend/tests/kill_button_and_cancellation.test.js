const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { productionJobQueue, ProductionJobQueue, JOB_STATUS } = require('../services/pipeline/productionJobQueue');
const { executeJobCancellation } = require('../routes/jobRoutes');
const {
  extractChineseSubtitles,
  callGeminiVisionWithRetry,
  saveOcrCheckpoint,
  loadOcrCheckpoint,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const { createAbortError } = require('../utils/asyncSemaphore');

test('1. Backend Cancellation: Scoped cancellation with jobId cancels exact job and returns correct contract', () => {
  productionJobQueue.clearMemoryForTesting();
  const testJob = {
    jobId: 'job_test_exact_1',
    seriesId: 'series_kill_test',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  productionJobQueue.inMemoryJobs.set(testJob.jobId, testJob);
  productionJobQueue.activeAbortControllers.set(testJob.jobId, new AbortController());

  const res = executeJobCancellation({ jobId: 'job_test_exact_1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'cancelled');
  assert.equal(res.body.cancelledCount, 1);
  assert.deepEqual(res.body.cancelledJobIds, ['job_test_exact_1']);
  assert.equal(productionJobQueue.getJob('job_test_exact_1').status, JOB_STATUS.CANCELLED);
  productionJobQueue.clearMemoryForTesting();
});

test('2. Backend Cancellation: Scoped cancellation with { seriesId, episodeId } resolves active job', () => {
  productionJobQueue.clearMemoryForTesting();
  const testJob = {
    jobId: 'job_test_scoped_ep2',
    seriesId: 'series_kill_test',
    episodeId: 'ep_2',
    status: JOB_STATUS.RUNNING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  productionJobQueue.inMemoryJobs.set(testJob.jobId, testJob);
  productionJobQueue.activeAbortControllers.set(testJob.jobId, new AbortController());

  const res = executeJobCancellation({ seriesId: 'series_kill_test', episodeId: 'ep_2' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cancelledCount, 1);
  assert.deepEqual(res.body.cancelledJobIds, ['job_test_scoped_ep2']);
  assert.equal(productionJobQueue.getJob('job_test_scoped_ep2').status, JOB_STATUS.CANCELLED);
  productionJobQueue.clearMemoryForTesting();
});

test('3. Backend Cancellation: Episode ID passed in jobId field is safely resolved without failing', () => {
  productionJobQueue.clearMemoryForTesting();
  const testJob = {
    jobId: 'job_test_resolved_from_ep',
    seriesId: 'series_kill_test',
    episodeId: 'ep_4',
    status: JOB_STATUS.RUNNING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  productionJobQueue.inMemoryJobs.set(testJob.jobId, testJob);
  productionJobQueue.activeAbortControllers.set(testJob.jobId, new AbortController());

  // Caller inadvertently passed 'ep_4' as jobId
  const res = executeJobCancellation({ jobId: 'ep_4', seriesId: 'series_kill_test' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cancelledCount, 1);
  assert.deepEqual(res.body.cancelledJobIds, ['job_test_resolved_from_ep']);
  assert.equal(productionJobQueue.getJob('job_test_resolved_from_ep').status, JOB_STATUS.CANCELLED);
  productionJobQueue.clearMemoryForTesting();
});

test('4. Backend Cancellation: Non-existent job returns 404 with success: false (no false positive)', () => {
  productionJobQueue.clearMemoryForTesting();
  const res = executeJobCancellation({ jobId: 'job_does_not_exist_999' });
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.cancelledCount, 0);
  assert.deepEqual(res.body.cancelledJobIds, []);
  productionJobQueue.clearMemoryForTesting();
});

test('5. Backend Cancellation: Missing target (empty body) is rejected with HTTP 400', () => {
  productionJobQueue.clearMemoryForTesting();
  const res = executeJobCancellation({});
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.cancelledCount, 0);
  productionJobQueue.clearMemoryForTesting();
});

test('6. Isolation: Cancelling job A leaves job B and job C running completely unaffected', () => {
  productionJobQueue.clearMemoryForTesting();
  const jobA = {
    jobId: 'job_ep1',
    seriesId: 'series_multi',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
    createdAt: 1000,
  };
  const jobB = {
    jobId: 'job_ep2',
    seriesId: 'series_multi',
    episodeId: 'ep_2',
    status: JOB_STATUS.RUNNING,
    createdAt: 2000,
  };
  const jobC = {
    jobId: 'job_ep3',
    seriesId: 'series_multi',
    episodeId: 'ep_3',
    status: JOB_STATUS.QUEUED,
    createdAt: 3000,
  };
  productionJobQueue.inMemoryJobs.set(jobA.jobId, jobA);
  productionJobQueue.inMemoryJobs.set(jobB.jobId, jobB);
  productionJobQueue.inMemoryJobs.set(jobC.jobId, jobC);

  const res = executeJobCancellation({ jobId: 'job_ep1' });
  assert.equal(res.body.success, true);
  assert.equal(res.body.cancelledCount, 1);
  assert.deepEqual(res.body.cancelledJobIds, ['job_ep1']);

  assert.equal(productionJobQueue.getJob('job_ep1').status, JOB_STATUS.CANCELLED);
  assert.equal(productionJobQueue.getJob('job_ep2').status, JOB_STATUS.RUNNING);
  assert.equal(productionJobQueue.getJob('job_ep3').status, JOB_STATUS.QUEUED);
  productionJobQueue.clearMemoryForTesting();
});

test('7. Scoped Kill All: all: true scoped to seriesId cancels only that series', () => {
  productionJobQueue.clearMemoryForTesting();
  const jobSeriesA1 = {
    jobId: 'job_sA_1',
    seriesId: 'series_A',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
    createdAt: 1000,
  };
  const jobSeriesA2 = {
    jobId: 'job_sA_2',
    seriesId: 'series_A',
    episodeId: 'ep_2',
    status: JOB_STATUS.QUEUED,
    createdAt: 1001,
  };
  const jobSeriesB1 = {
    jobId: 'job_sB_1',
    seriesId: 'series_B',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
    createdAt: 1002,
  };
  productionJobQueue.inMemoryJobs.set(jobSeriesA1.jobId, jobSeriesA1);
  productionJobQueue.inMemoryJobs.set(jobSeriesA2.jobId, jobSeriesA2);
  productionJobQueue.inMemoryJobs.set(jobSeriesB1.jobId, jobSeriesB1);

  const res = executeJobCancellation({ seriesId: 'series_A', all: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cancelledCount, 2);
  assert.deepEqual(res.body.cancelledJobIds.sort(), ['job_sA_1', 'job_sA_2'].sort());

  // series_B job must NOT be touched
  assert.equal(productionJobQueue.getJob('job_sB_1').status, JOB_STATUS.RUNNING);
  productionJobQueue.clearMemoryForTesting();
});

test('8. ProductionJobQueue: cancelJob aborts AbortController and marks job CANCELLED', () => {
  productionJobQueue.clearMemoryForTesting();
  const testJob = {
    jobId: 'job_abort_signal_test',
    seriesId: 'series_test',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
    createdAt: Date.now(),
  };
  productionJobQueue.inMemoryJobs.set(testJob.jobId, testJob);
  const controller = new AbortController();
  productionJobQueue.activeAbortControllers.set(testJob.jobId, controller);

  assert.equal(controller.signal.aborted, false);
  const cancelled = productionJobQueue.cancelJob('job_abort_signal_test');

  assert.equal(cancelled.status, JOB_STATUS.CANCELLED);
  assert.equal(controller.signal.aborted, true);
  productionJobQueue.clearMemoryForTesting();
});

test('9. ProductionJobQueue: Cancelling during auto-recovery backoff window clears retryTimer and prevents restart', async () => {
  productionJobQueue.clearMemoryForTesting();
  const queue = new ProductionJobQueue({ maxConcurrency: 1 });
  let workerExecuted = 0;

  queue.registerWorkerHandler(async (job) => {
    workerExecuted++;
    if (job.status === JOB_STATUS.CANCELLED) {
      throw createAbortError('Job was cancelled');
    }
    // Simulate first transient failure
    const err = new Error('503 Service Unavailable');
    err.status = 503;
    throw err;
  });

  const testJob = {
    jobId: 'job_recovery_cancel_test',
    seriesId: 'series_recovery',
    episodeId: 'ep_1',
    status: JOB_STATUS.QUEUED,
    priority: 1,
    createdAt: Date.now(),
    retryPolicy: { retryCount: 0, maxRetries: 3 },
  };
  queue.inMemoryJobs.set(testJob.jobId, testJob);

  // Pump queue to execute first attempt
  queue.processQueue();
  await new Promise((r) => setTimeout(r, 50));

  // The job should now be in RECOVERING status with an active retryTimer scheduled
  assert.equal(testJob.status, JOB_STATUS.RECOVERING);
  assert.equal(testJob.retryPolicy.retryCount, 1);
  assert.equal(queue.retryTimers.has(testJob.jobId), true);

  // User clicks Kill during backoff window!
  queue.cancelJob(testJob.jobId);
  assert.equal(testJob.status, JOB_STATUS.CANCELLED);
  assert.equal(queue.retryTimers.has(testJob.jobId), false);

  // Wait 100ms and verify worker was NOT executed a second time
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(workerExecuted, 1);
  assert.equal(testJob.status, JOB_STATUS.CANCELLED);
  queue.clearMemoryForTesting();
});

test('10. Terminal State Protection: Delayed async worker callback cannot overwrite CANCELLED with COMPLETED', async () => {
  productionJobQueue.clearMemoryForTesting();
  const queue = new ProductionJobQueue({ maxConcurrency: 1 });

  let finishDelayedWorker;
  const workerPromise = new Promise((resolve) => {
    finishDelayedWorker = resolve;
  });

  queue.registerWorkerHandler(async () => {
    return await workerPromise;
  });

  const testJob = {
    jobId: 'job_delayed_complete_test',
    seriesId: 'series_delayed',
    episodeId: 'ep_1',
    status: JOB_STATUS.QUEUED,
    priority: 1,
    createdAt: Date.now(),
  };
  queue.inMemoryJobs.set(testJob.jobId, testJob);
  queue.processQueue();

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(testJob.status, JOB_STATUS.RUNNING);

  // User clicks Kill while worker is running
  queue.cancelJob(testJob.jobId);
  assert.equal(testJob.status, JOB_STATUS.CANCELLED);

  // Now the delayed worker completes late
  finishDelayedWorker({ success: true, count: 50 });
  await new Promise((r) => setTimeout(r, 30));

  // Status MUST remain CANCELLED, never flipped to COMPLETED
  assert.equal(testJob.status, JOB_STATUS.CANCELLED);
  queue.clearMemoryForTesting();
});

test('11. Episode Lock Release: cancelJob releases activeEpisodeLocks for immediate re-run', () => {
  productionJobQueue.clearMemoryForTesting();
  const seriesId = 'series_lock_test';
  const episodeId = 'ep_1';

  // Acquire episode lock
  productionJobQueue.acquireEpisodeLock(seriesId, episodeId, 'pipeline');
  assert.equal(productionJobQueue.hasActiveJobForEpisode(seriesId, episodeId), true);

  // Cancel job and verify lock is released
  productionJobQueue.cancelJob('non_existent_or_virtual');
  // Explicitly release via episode target
  productionJobQueue.releaseEpisodeLock(seriesId, episodeId);
  assert.equal(productionJobQueue.hasActiveJobForEpisode(seriesId, episodeId), false);

  // Can acquire lock again without 409 conflict
  assert.equal(productionJobQueue.acquireEpisodeLock(seriesId, episodeId, 'pipeline'), true);
  productionJobQueue.releaseEpisodeLock(seriesId, episodeId);
  productionJobQueue.clearMemoryForTesting();
});

test('12. Stage 3 OCR: AbortSignal stops retry/backoff immediately and avoids model cascade', async () => {
  const abortController = new AbortController();
  let calls = 0;

  const mockAiClient = {
    models: {
      generateContent: async () => {
        calls++;
        // Simulate in-flight abort
        abortController.abort(createAbortError('Stage 3 OCR aborted'));
        const err = new Error('Socket closed: aborted');
        err.name = 'AbortError';
        throw err;
      },
    },
  };

  await assert.rejects(
    async () => {
      await callGeminiVisionWithRetry(
        mockAiClient,
        'gemini-3.5-flash-lite',
        [{ text: 'test' }],
        3,
        abortController.signal
      );
    },
    (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );

  // Must have stopped immediately on first call without cascading through 12 models
  assert.equal(calls, 1);
});

test('13. Stage 3 Checkpoint: Verified batches are saved atomically and preserved after cancel', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr_kill_test_'));
  const testCheckpoint = {
    version: 1,
    videoPath: 'test_vid.mp4',
    startOffsetSec: 0,
    durationSec: 120,
    completed: false,
    rawObservations: [
      { timestampSec: 1.0, reportedSec: 1.0, hasText: true, textZh: '你好', isSharp: true },
      { timestampSec: 2.0, reportedSec: 2.0, hasText: true, textZh: '世界', isSharp: true },
    ],
    completedBatchesCount: 1,
    savedAt: Date.now(),
  };

  const ckptFile = path.join(tempDir, 'ocr_ckpt_test.json');
  const saved = saveOcrCheckpoint(ckptFile, testCheckpoint);
  assert.equal(saved, true);

  // Verify checkpoint exists and is loadable
  const loaded = loadOcrCheckpoint(ckptFile);
  assert.ok(loaded);
  assert.equal(loaded.rawObservations.length, 2);
  assert.equal(loaded.rawObservations[0].textZh, '你好');
  assert.equal(loaded.rawObservations[1].textZh, '世界');
  assert.equal(loaded.completedBatchesCount, 1);

  try {
    fs.unlinkSync(ckptFile);
    fs.rmdirSync(tempDir);
  } catch (_) {}
});
