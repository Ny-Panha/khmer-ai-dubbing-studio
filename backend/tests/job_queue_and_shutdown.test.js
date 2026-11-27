const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const jobRoutes = require('../routes/jobRoutes');
const { productionJobQueue } = require('../services/pipeline/productionJobQueue');
const { pickAttemptRetryError } = require('../services/ttsService');

test('SSE /api/jobs/stream cleans up listeners and ends cleanly on closeAllJobStreams() and client abort', async () => {
  const app = express();
  app.use('/api/jobs', jobRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const initialListeners = productionJobQueue.events.listenerCount('job_change');

  try {
    // 1. Open an SSE stream and receive initial init event
    let sseReq = null;
    const streamClosed = new Promise((resolve, reject) => {
      sseReq = http.get(`http://127.0.0.1:${port}/api/jobs/stream`, (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(res.headers['content-type'], /text\/event-stream/i);
        let received = '';
        let triggered = false;
        res.on('data', (chunk) => {
          received += chunk.toString('utf8');
          if (!triggered && received.includes('event: init')) {
            triggered = true;
            // Once stream is active and listener is registered, trigger closeAllJobStreams()
            assert.equal(
              productionJobQueue.events.listenerCount('job_change'),
              initialListeners + 1,
              'SSE connection should attach one job_change listener'
            );
            jobRoutes.closeAllJobStreams();
          }
        });
        res.on('end', () => resolve(received));
        res.on('error', reject);
      });
      sseReq.on('error', reject);
    });

    const received = await streamClosed;
    assert.ok(received.includes('event: init'), 'SSE client must receive initial event: init');
    assert.equal(
      productionJobQueue.events.listenerCount('job_change'),
      initialListeners,
      'closeAllJobStreams() must detach all job_change listeners'
    );

    // 2. Verify client abort also cleans up listener without leak
    await new Promise((resolve, reject) => {
      const req2 = http.get(`http://127.0.0.1:${port}/api/jobs/stream`, (res2) => {
        res2.once('data', () => {
          req2.destroy();
          setTimeout(() => {
            try {
              assert.equal(
                productionJobQueue.events.listenerCount('job_change'),
                initialListeners,
                'Aborted SSE client must clean up job_change listener'
              );
              resolve();
            } catch (err) {
              reject(err);
            }
          }, 50);
        });
      });
      req2.on('error', () => {});
    });
  } finally {
    jobRoutes.closeAllJobStreams();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Frontend JobQueueContext HMR singleton, ErrorBoundary, and useJobQueue SSE reconnect resilience', () => {
  const storeSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/context/jobQueueStore.js'), 'utf8');
  assert.match(storeSrc, /Symbol\.for\(/, 'jobQueueStore must pin context identity with Symbol.for across Vite HMR reloads');
  assert.match(storeSrc, /globalThis\[/, 'jobQueueStore must persist singleton Context on globalThis');
  const ctxSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/context/JobQueueContext.jsx'), 'utf8');
  assert.match(ctxSrc, /export function JobQueueProvider/, 'JobQueueContext.jsx must cleanly export only JobQueueProvider component for Fast Refresh');

  const hookSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/dashboard/useJobQueue.js'), 'utf8');
  assert.match(hookSrc, /setIsConnected\(false\)/, 'useJobQueue must clear isConnected on any SSE error');
  assert.match(hookSrc, /backend-online/, 'useJobQueue must recover SSE immediately upon backend-online event');
  assert.match(hookSrc, /document\.hidden/, 'useJobQueue must guard SSE reconnects while tab is hidden');

  const appSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.jsx'), 'utf8');
  assert.match(appSrc, /<ErrorBoundary[\s\S]*JobDashboardModal/, 'JobDashboardModal must be wrapped inside ErrorBoundary');

  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/main.jsx'), 'utf8');
  assert.match(mainSrc, /<ErrorBoundary[\s\S]*<App\s*\/>/, 'Root <App /> must be wrapped inside ErrorBoundary');

  const serverSrc = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  assert.match(serverSrc, /closeAllJobStreams/, 'server.js shutdown must close active job SSE streams');
  assert.match(serverSrc, /closeAllConnections/, 'server.js shutdown must tear down lingering keep-alive sockets');
});

test('ttsService pickAttemptRetryError preserves transient 429 when optional CLI fails with ENOENT', () => {
  const err429 = new Error('Unexpected server response: 429');
  const errEnoent = Object.assign(new Error('spawn edge-tts ENOENT'), { code: 'ENOENT' });

  const picked = pickAttemptRetryError([err429, err429, errEnoent]);
  assert.equal(picked, err429, 'Transient 429 must not be masked by missing optional CLI ENOENT');

  const permanent = new Error('Invalid SSML payload');
  const pickedPerm = pickAttemptRetryError([permanent, errEnoent]);
  assert.equal(pickedPerm, permanent, 'Real Edge error must be preserved over ENOENT when no transient error occurred');
});

test('processQueue avoids head-of-line deadlock when duplicate queued jobs share an episode', async () => {
  const os = require('node:os');
  const { ProductionJobQueue, JOB_STATUS } = require('../services/pipeline/productionJobQueue');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dd_queue_hol_'));
  const queue = new ProductionJobQueue({ maxConcurrency: 2, baseUploadsDir: tmpRoot });
  const started = [];
  let releaseWorker;
  const gate = new Promise((resolve) => {
    releaseWorker = resolve;
  });

  try {
    queue.registerWorkerHandler(async (job) => {
      started.push(`${job.seriesId}/${job.episodeId}`);
      await gate;
      return { success: true };
    });

    // Two duplicate queued jobs for series_A/ep_1 plus a queued job for series_B/ep_1
    queue.inMemoryJobs.set('dup_1', {
      jobId: 'dup_1',
      seriesId: 'series_A',
      episodeId: 'ep_1',
      status: JOB_STATUS.QUEUED,
      priority: 5,
      createdAt: 1000,
    });
    queue.inMemoryJobs.set('dup_2', {
      jobId: 'dup_2',
      seriesId: 'series_A',
      episodeId: 'ep_1',
      status: JOB_STATUS.QUEUED,
      priority: 5,
      createdAt: 1001,
    });
    queue.inMemoryJobs.set('other_1', {
      jobId: 'other_1',
      seriesId: 'series_B',
      episodeId: 'ep_1',
      status: JOB_STATUS.QUEUED,
      priority: 5,
      createdAt: 1002,
    });

    queue.processQueue();
    await new Promise((r) => setTimeout(r, 40));

    assert.deepEqual(
      started.sort(),
      ['series_A/ep_1', 'series_B/ep_1'],
      'Both available worker slots must run distinct episodes without deadlocking on dup_1/dup_2'
    );
    assert.equal(queue.getJob('dup_2').status, JOB_STATUS.QUEUED, 'Second job for same episode stays safely queued');

    releaseWorker();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(queue.getJob('dup_2').status, JOB_STATUS.COMPLETED);
  } finally {
    queue.clearMemoryForTesting();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  }
});
