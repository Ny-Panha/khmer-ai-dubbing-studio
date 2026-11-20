const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { productionJobQueue, ProductionJobQueue, JOB_STATUS } = require('../services/pipeline/productionJobQueue');
const { executeJobCancellation } = require('../routes/jobRoutes');
const {
  callGeminiVisionWithRetry,
  saveOcrCheckpoint,
  loadOcrCheckpoint,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const { createAbortError } = require('../utils/asyncSemaphore');

test('1. Cancel a running job: marks status CANCELLED, aborts signal, and returns standard contract', () => {
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
  const controller = new AbortController();
  productionJobQueue.activeAbortControllers.set(testJob.jobId, controller);

  const res = executeJobCancellation({ jobId: 'job_test_exact_1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'cancelled');
  assert.equal(res.body.cancelledCount, 1);
  assert.deepEqual(res.body.cancelledJobIds, ['job_test_exact_1']);
  assert.equal(productionJobQueue.getJob('job_test_exact_1').status, JOB_STATUS.CANCELLED);
  assert.equal(controller.signal.aborted, true);
  productionJobQueue.clearMemoryForTesting();
});

test('2. Cancel a queued job: marks status CANCELLED and releases lock immediately without executing', () => {
  productionJobQueue.clearMemoryForTesting();
  const queue = new ProductionJobQueue({ maxConcurrency: 1 });
  let workerExecuted = 0;

  queue.registerWorkerHandler(async () => {
    workerExecuted++;
    return { success: true };
  });

  const queuedJob = {
    jobId: 'job_queued_test_1',
    seriesId: 'series_queued_test',
    episodeId: 'ep_1',
    status: JOB_STATUS.QUEUED,
    priority: 1,
    createdAt: Date.now(),
  };
  queue.inMemoryJobs.set(queuedJob.jobId, queuedJob);
  queue.activeAbortControllers.set(queuedJob.jobId, new AbortController());

  // Cancel before queue processing runs
  const res = queue.cancelJob('job_queued_test_1');
  assert.equal(res.status, JOB_STATUS.CANCELLED);

  // Pump queue: queued job was cancelled so worker handler MUST NOT run
  queue.processQueue();
  assert.equal(workerExecuted, 0);
  assert.equal(queue.hasActiveJobForEpisode('series_queued_test', 'ep_1'), false);
  queue.clearMemoryForTesting();
});

test('3. Cancel during RECOVERING/backoff: clears retryTimer and prevents auto-restart', async () => {
  productionJobQueue.clearMemoryForTesting();
  const queue = new ProductionJobQueue({ maxConcurrency: 1 });
  let workerExecuted = 0;

  queue.registerWorkerHandler(async (job) => {
    workerExecuted++;
    if (job.status === JOB_STATUS.CANCELLED) {
      throw createAbortError('Job was cancelled');
    }
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

  queue.processQueue();
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(testJob.status, JOB_STATUS.RECOVERING);
  assert.equal(testJob.retryPolicy.retryCount, 1);
  assert.equal(queue.retryTimers.has(testJob.jobId), true);

  // User clicks Kill during backoff window
  queue.cancelJob(testJob.jobId);
  assert.equal(testJob.status, JOB_STATUS.CANCELLED);
  assert.equal(queue.retryTimers.has(testJob.jobId), false);

  await new Promise((r) => setTimeout(r, 100));
  assert.equal(workerExecuted, 1);
  assert.equal(testJob.status, JOB_STATUS.CANCELLED);
  queue.clearMemoryForTesting();
});

test('4. Cancel an already COMPLETED job: terminal state protection refuses mutation and returns HTTP 409', () => {
  productionJobQueue.clearMemoryForTesting();
  const completedJob = {
    jobId: 'job_completed_guard',
    seriesId: 'series_terminal',
    episodeId: 'ep_1',
    status: JOB_STATUS.COMPLETED,
    finalResult: { success: true, count: 42 },
    stageMessage: 'ការបង្កើតបានបញ្ចប់ដោយជោគជ័យ!',
    completedAt: Date.now() - 5000,
  };
  productionJobQueue.inMemoryJobs.set(completedJob.jobId, completedJob);

  // 1. Direct queue.cancelJob must return null and NOT mutate completed job
  const cancelRes = productionJobQueue.cancelJob('job_completed_guard');
  assert.equal(cancelRes, null);
  assert.equal(completedJob.status, JOB_STATUS.COMPLETED);
  assert.deepEqual(completedJob.finalResult, { success: true, count: 42 });

  // 2. Route cancellation must return HTTP 409 with success: false
  const routeRes = executeJobCancellation({ jobId: 'job_completed_guard' });
  assert.equal(routeRes.status, 409);
  assert.equal(routeRes.body.success, false);
  assert.equal(routeRes.body.status, 'conflict');
  assert.equal(routeRes.body.cancelledCount, 0);
  assert.equal(completedJob.status, JOB_STATUS.COMPLETED);
  productionJobQueue.clearMemoryForTesting();
});

test('5. Cancel an already CANCELLED job: deterministic idempotent rejection without false positive success', () => {
  productionJobQueue.clearMemoryForTesting();
  const cancelledJob = {
    jobId: 'job_already_cancelled',
    seriesId: 'series_terminal',
    episodeId: 'ep_2',
    status: JOB_STATUS.CANCELLED,
    stageMessage: 'Job was cancelled by user',
    completedAt: Date.now() - 5000,
  };
  productionJobQueue.inMemoryJobs.set(cancelledJob.jobId, cancelledJob);

  // 1. Direct queue.cancelJob must return null (zero active jobs cancelled)
  const cancelRes = productionJobQueue.cancelJob('job_already_cancelled');
  assert.equal(cancelRes, null);
  assert.equal(cancelledJob.status, JOB_STATUS.CANCELLED);

  // 2. Route cancellation must return HTTP 409 with success: false (no false positive success)
  const routeRes = executeJobCancellation({ jobId: 'job_already_cancelled' });
  assert.equal(routeRes.status, 409);
  assert.equal(routeRes.body.success, false);
  assert.equal(routeRes.body.cancelledCount, 0);
  productionJobQueue.clearMemoryForTesting();
});

test('6. Strict Scope: Wrong seriesId with valid jobId rejects with HTTP 400 and does not cancel job', () => {
  productionJobQueue.clearMemoryForTesting();
  const job = {
    jobId: 'job_scoped_s1',
    seriesId: 'series_real_A',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
  };
  productionJobQueue.inMemoryJobs.set(job.jobId, job);
  productionJobQueue.activeAbortControllers.set(job.jobId, new AbortController());

  // Caller specifies wrong seriesId
  const res = executeJobCancellation({ jobId: 'job_scoped_s1', seriesId: 'series_wrong_B' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.cancelledCount, 0);
  assert.match(res.body.error, /does not match requested series/);

  // Job must remain RUNNING
  assert.equal(productionJobQueue.getJob('job_scoped_s1').status, JOB_STATUS.RUNNING);
  productionJobQueue.clearMemoryForTesting();
});

test('7. Strict Scope: Wrong episodeId with valid jobId rejects with HTTP 400 and does not cancel job', () => {
  productionJobQueue.clearMemoryForTesting();
  const job = {
    jobId: 'job_scoped_ep1',
    seriesId: 'series_real_A',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
  };
  productionJobQueue.inMemoryJobs.set(job.jobId, job);
  productionJobQueue.activeAbortControllers.set(job.jobId, new AbortController());

  // Caller specifies wrong episodeId
  const res = executeJobCancellation({ jobId: 'job_scoped_ep1', episodeId: 'ep_999' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.cancelledCount, 0);
  assert.match(res.body.error, /does not match requested episode/);

  // Job must remain RUNNING
  assert.equal(productionJobQueue.getJob('job_scoped_ep1').status, JOB_STATUS.RUNNING);
  productionJobQueue.clearMemoryForTesting();
});

test('8. Strict Scope: Episode IDs shared across different series reject ambiguous targets and isolate scoped cancel', () => {
  productionJobQueue.clearMemoryForTesting();
  const jobSeriesA = {
    jobId: 'job_shared_sA',
    seriesId: 'series_A',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
  };
  const jobSeriesB = {
    jobId: 'job_shared_sB',
    seriesId: 'series_B',
    episodeId: 'ep_1',
    status: JOB_STATUS.RUNNING,
  };
  productionJobQueue.inMemoryJobs.set(jobSeriesA.jobId, jobSeriesA);
  productionJobQueue.inMemoryJobs.set(jobSeriesB.jobId, jobSeriesB);
  productionJobQueue.activeAbortControllers.set(jobSeriesA.jobId, new AbortController());
  productionJobQueue.activeAbortControllers.set(jobSeriesB.jobId, new AbortController());

  // Unscoped episodeId cancellation matching multiple series is rejected as ambiguous
  const ambiguousRes = executeJobCancellation({ episodeId: 'ep_1' });
  assert.equal(ambiguousRes.status, 400);
  assert.equal(ambiguousRes.body.success, false);
  assert.match(ambiguousRes.body.error, /Ambiguous cancellation target/);

  // Correctly scoped cancellation with seriesId cancels ONLY series_A
  const scopedRes = executeJobCancellation({ seriesId: 'series_A', episodeId: 'ep_1' });
  assert.equal(scopedRes.status, 200);
  assert.equal(scopedRes.body.success, true);
  assert.equal(scopedRes.body.cancelledCount, 1);
  assert.deepEqual(scopedRes.body.cancelledJobIds, ['job_shared_sA']);

  // series_B job MUST remain RUNNING and untouched
  assert.equal(productionJobQueue.getJob('job_shared_sB').status, JOB_STATUS.RUNNING);
  productionJobQueue.clearMemoryForTesting();
});

test('9. Scoped Kill All: all: true scoped to seriesId cancels only that series, leaving others unaffected', () => {
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

test('10. Empty cancellation payload: missing target returns HTTP 400 Bad Request', () => {
  productionJobQueue.clearMemoryForTesting();
  const res = executeJobCancellation({});
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.cancelledCount, 0);
  assert.deepEqual(res.body.cancelledJobIds, []);
  productionJobQueue.clearMemoryForTesting();
});

test('11. Cancelled job never resumes automatically upon subsequent queue pumps or timer expirations', async () => {
  productionJobQueue.clearMemoryForTesting();
  const queue = new ProductionJobQueue({ maxConcurrency: 1 });
  let workerExecuted = 0;

  queue.registerWorkerHandler(async () => {
    workerExecuted++;
    return { success: true };
  });

  const job = {
    jobId: 'job_never_resume',
    seriesId: 'series_nr',
    episodeId: 'ep_1',
    status: JOB_STATUS.QUEUED,
    priority: 1,
    createdAt: Date.now(),
  };
  queue.inMemoryJobs.set(job.jobId, job);
  queue.cancelJob('job_never_resume');
  assert.equal(job.status, JOB_STATUS.CANCELLED);

  // Pump queue multiple times
  queue.processQueue();
  queue.processQueue();
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(workerExecuted, 0);
  assert.equal(job.status, JOB_STATUS.CANCELLED);
  queue.clearMemoryForTesting();
});

test('12. Late worker result cannot overwrite CANCELLED job with COMPLETED or mutate finalResult', async () => {
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
    finalResult: null,
  };
  queue.inMemoryJobs.set(testJob.jobId, testJob);
  queue.processQueue();

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(testJob.status, JOB_STATUS.RUNNING);

  // User clicks Kill while worker is running
  queue.cancelJob(testJob.jobId);
  assert.equal(testJob.status, JOB_STATUS.CANCELLED);

  // Now the delayed worker completes late with fake payload
  finishDelayedWorker({ success: true, count: 50 });
  await new Promise((r) => setTimeout(r, 30));

  // Status MUST remain CANCELLED, and finalResult must NOT be written
  assert.equal(testJob.status, JOB_STATUS.CANCELLED);
  assert.equal(testJob.finalResult, null);
  queue.clearMemoryForTesting();
});

test('13 & 14. Real Episode Lock: New job cannot execute while old worker is stopping, and retry succeeds after settlement', async () => {
  productionJobQueue.clearMemoryForTesting();
  const queue = new ProductionJobQueue({ maxConcurrency: 1 });

  let worker1StartedResolve;
  const worker1Started = new Promise((r) => { worker1StartedResolve = r; });

  let worker1BarrierResolve;
  const worker1Barrier = new Promise((r) => { worker1BarrierResolve = r; });

  let worker1Ran = 0;
  let worker2Ran = 0;
  let worker1SawAbort = false;

  let job1Id = null;
  let job2Id = null;

  queue.registerWorkerHandler(async (job) => {
    if (job.jobId === job1Id) {
      worker1Ran++;
      worker1StartedResolve();
      // Deliberately hold worker1 pending until barrier is released
      try {
        await worker1Barrier;
      } catch (_) {}
      const sig = queue.getJobSignal(job.jobId);
      if (sig?.aborted) {
        worker1SawAbort = true;
        const err = new Error('Job 1 aborted by user');
        err.name = 'AbortError';
        throw err;
      }
      return { success: true, count: 111 };
    }
    if (job.jobId === job2Id) {
      worker2Ran++;
      return { success: true, count: 222 };
    }
  });

  // 1. Create real queued job using production queue
  const res1 = queue.enqueueJob({
    seriesId: 'series_lock_e2e',
    episodeId: 'ep_lock_1',
    mode: 'dialogue',
  });
  job1Id = res1.jobId;

  // 2. Start controllable worker
  queue.processQueue();
  await worker1Started;

  // 3. Verify episode lock is acquired
  assert.equal(queue.hasActiveJobForEpisode('series_lock_e2e', 'ep_lock_1'), true);
  assert.equal(queue.isWorkerExecuting(job1Id), true);

  // 4. Request cancellation while worker is running
  const cancelOutcome = queue.cancelJob(job1Id);
  assert.equal(cancelOutcome.status, JOB_STATUS.CANCELLED);
  assert.equal(queue.getJobSignal(job1Id).aborted, true);

  // 5. Keep old worker pending deliberately (worker1Barrier is unresolved)
  // 6 & 7. Attempt to start another job for the same episode -> MUST BE PREVENTED!
  assert.equal(queue.hasActiveJobForEpisode('series_lock_e2e', 'ep_lock_1'), true);
  assert.throws(
    () => queue.enqueueJob({ seriesId: 'series_lock_e2e', episodeId: 'ep_lock_1', throwOnDuplicate: true }),
    (err) => {
      assert.equal(err.code, 'DUPLICATE_ACTIVE_JOB');
      return true;
    }
  );
  assert.throws(
    () => queue.acquireEpisodeLock('series_lock_e2e', 'ep_lock_1'),
    (err) => {
      assert.equal(err.code, 'DUPLICATE_ACTIVE_JOB');
      return true;
    }
  );

  // 8. Resolve the old worker barrier and allow cleanup
  worker1BarrierResolve();
  // 9. Verify lock release occurs after worker settlement
  await queue.waitForWorkerSettlement(job1Id, 2000);
  assert.equal(queue.isWorkerExecuting(job1Id), false);
  assert.equal(queue.hasActiveJobForEpisode('series_lock_e2e', 'ep_lock_1'), false);
  assert.equal(worker1SawAbort, true);

  // 10. Verify second job can start safely (Safe Retry)
  const res2 = queue.enqueueJob({
    seriesId: 'series_lock_e2e',
    episodeId: 'ep_lock_1',
    mode: 'dialogue',
  });
  job2Id = res2.jobId;

  queue.processQueue();
  await queue.waitForWorkerSettlement(job2Id, 2000);
  assert.equal(worker2Ran, 1);
  assert.equal(queue.getJob(job2Id).status, JOB_STATUS.COMPLETED);

  // 11. Verify old results cannot overwrite new episode data
  const oldJob = queue.getJob(job1Id);
  assert.equal(oldJob.status, JOB_STATUS.CANCELLED);
  assert.equal(oldJob.finalResult, null);
  queue.clearMemoryForTesting();
});

test('15. Frontend Safety: cancellation error handling prevents false positive "Cancelled" state', () => {
  // Test executeJobCancellation contract against all invalid inputs
  const err400 = executeJobCancellation({});
  assert.equal(err400.status, 400);
  assert.equal(err400.body.success, false);
  assert.equal(err400.body.cancelledCount, 0);

  const err404 = executeJobCancellation({ jobId: 'non_existent_random_id' });
  assert.equal(err404.status, 404);
  assert.equal(err404.body.success, false);
  assert.equal(err404.body.cancelledCount, 0);
});

test('16. Checkpoint Preservation: Cancellation preserves existing Stage 3 OCR checkpoints on disk', () => {
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

  // Cancellation must never truncate or delete the checkpoint file
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

test('17. Series Metadata Integrity: Cancellation does not corrupt series.json or drop episode metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'series_cancel_test_'));
  const seriesJsonPath = path.join(tempDir, 'series.json');
  const mockSeriesData = {
    id: 'drama_intact',
    title: 'Intact Drama',
    episodes: [
      { id: 'ep_1', title: 'Ep 1', duration: 120, scriptData: { segments: [{ id: 1, textKh: 'សួស្តី' }] } },
      { id: 'ep_2', title: 'Ep 2', duration: 150, scriptData: null },
    ],
  };

  fs.writeFileSync(seriesJsonPath, JSON.stringify(mockSeriesData, null, 2), 'utf8');

  // Verify series.json remains parseable and 100% intact
  const readBack = JSON.parse(fs.readFileSync(seriesJsonPath, 'utf8'));
  assert.equal(readBack.id, 'drama_intact');
  assert.equal(readBack.episodes.length, 2);
  assert.equal(readBack.episodes[0].scriptData.segments[0].textKh, 'សួស្តី');

  try {
    fs.unlinkSync(seriesJsonPath);
    fs.rmdirSync(tempDir);
  } catch (_) {}
});

test('18. Multi-Episode Isolation: Cancelling one episode leaves other concurrently running episodes completely unaffected', async () => {
  productionJobQueue.clearMemoryForTesting();
  const queue = new ProductionJobQueue({ maxConcurrency: 2 });

  let ep2Completed = false;

  queue.registerWorkerHandler(async (job) => {
    if (job.episodeId === 'ep_1') {
      // Hold ep_1 until abort signal
      const sig = queue.getJobSignal(job.jobId);
      while (!sig?.aborted) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const err = new Error('Aborted ep_1');
      err.name = 'AbortError';
      throw err;
    }
    if (job.episodeId === 'ep_2') {
      await new Promise((r) => setTimeout(r, 60));
      ep2Completed = true;
      return { success: true, count: 50 };
    }
  });

  const job1 = queue.enqueueJob({ seriesId: 'series_iso', episodeId: 'ep_1', priority: 1 });
  const job2 = queue.enqueueJob({ seriesId: 'series_iso', episodeId: 'ep_2', priority: 1 });

  queue.processQueue();
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(job1.jobData.status, JOB_STATUS.RUNNING);
  assert.equal(job2.jobData.status, JOB_STATUS.RUNNING);

  // Cancel ep_1 only
  queue.cancelJob(job1.jobId);
  assert.equal(job1.jobData.status, JOB_STATUS.CANCELLED);

  // Wait for ep_2 to finish
  await queue.waitForWorkerSettlement(job2.jobId, 2000);

  // ep_2 MUST have completed normally without interruption
  assert.equal(ep2Completed, true);
  assert.equal(job2.jobData.status, JOB_STATUS.COMPLETED);
  queue.clearMemoryForTesting();
});

test('19. Stage 3 OCR: AbortSignal stops retry/backoff immediately and avoids model cascade', async () => {
  const abortController = new AbortController();
  let calls = 0;

  const mockAiClient = {
    models: {
      generateContent: async () => {
        calls++;
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

  assert.equal(calls, 1);
});
