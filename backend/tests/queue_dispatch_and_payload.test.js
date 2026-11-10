const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const jobRoutes = require('../routes/jobRoutes');
const {
  JOB_STATUS,
  ProductionJobQueue,
  productionJobQueue,
  getJobFilePath,
} = require('../services/pipeline/productionJobQueue');
const {
  createPipelineWorkerHandler,
  setTransientJobApiKey,
  getTransientJobApiKey,
} = require('../services/pipeline/jobWorker');
const { updateSeriesMetadata, saveSeriesMetadata } = require('../services/episodeService');
const { ffmpegHeavySemaphore } = require('../utils/asyncSemaphore');
const { extractFramesAtTimestamps } = require('../services/ffmpegService');

function httpRequestJson(port, method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c.toString('utf8')));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw), rawBytes: Buffer.byteLength(raw) });
          } catch (err) {
            resolve({ status: res.statusCode, data: raw, rawBytes: Buffer.byteLength(raw) });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('ProductionJobQueue caps concurrency to 2, supports restart retry, and never retries AbortError or fatal key errors', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_q_test_'));
  try {
    const queue = new ProductionJobQueue({ baseUploadsDir: tempRoot, maxConcurrency: 2 });
    assert.equal(queue.getMaxConcurrency(), 2);

    let currentActive = 0;
    let maxObservedActive = 0;
    const executedOrder = [];
    const resolvers = new Map();

    queue.registerWorkerHandler(async (job) => {
      currentActive++;
      maxObservedActive = Math.max(maxObservedActive, currentActive);
      executedOrder.push(job.episodeId);
      const signal = queue.getJobSignal(job.jobId);
      try {
        await new Promise((resolve, reject) => {
          if (signal?.aborted) {
            const err = new Error('Cancelled');
            err.name = 'AbortError';
            return reject(err);
          }
          const onAbort = () => {
            const err = new Error('Cancelled');
            err.name = 'AbortError';
            reject(err);
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          resolvers.set(job.episodeId, () => {
            signal?.removeEventListener('abort', onAbort);
            resolve({ totalSegments: 12 });
          });
        });
        return { totalSegments: 12 };
      } finally {
        currentActive--;
      }
    });

    const jobs = [];
    for (let i = 1; i <= 5; i++) {
      const enq = queue.enqueueJob({
        seriesId: 'series_unit',
        episodeId: `ep_${i}`,
        videoPath: `mock_${i}.mp4`,
      });
      jobs.push(enq);
    }

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(maxObservedActive, 2, 'Queue must run at most 2 jobs concurrently');
    assert.deepEqual(executedOrder, ['ep_1', 'ep_2']);
    assert.equal(queue.getJob(jobs[2].jobId).status, JOB_STATUS.QUEUED);

    // Cancel ep_2 in-flight and verify it transitions cleanly to cancelled and never retries
    queue.cancelJob(jobs[1].jobId);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(queue.getJob(jobs[1].jobId).status, JOB_STATUS.CANCELLED);
    assert.equal(queue.getJob(jobs[1].jobId).retryPolicy.retryCount, 0);

    // ep_3 should be promoted into freed slot
    assert.ok(executedOrder.includes('ep_3'), 'Queued ep_3 must be promoted when ep_2 cancels');

    // Finish remaining active jobs
    for (const epId of ['ep_1', 'ep_3', 'ep_4', 'ep_5']) {
      for (let wait = 0; wait < 20 && !resolvers.has(epId); wait++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      if (resolvers.has(epId)) resolvers.get(epId)();
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(queue.getJob(jobs[0].jobId).status, JOB_STATUS.COMPLETED);
    assert.equal(queue.getJob(jobs[4].jobId).status, JOB_STATUS.COMPLETED);

    // Non-retryable error (401 / invalid key) must fail immediately with retryCount 0
    const qFatal = new ProductionJobQueue({ baseUploadsDir: tempRoot, maxConcurrency: 2 });
    qFatal.registerWorkerHandler(async () => {
      const err = new Error('401 Unauthorized API_KEY invalid');
      err.status = 401;
      throw err;
    });
    const fatalEnq = qFatal.enqueueJob({ seriesId: 's_f', episodeId: 'ep_f', videoPath: 'x.mp4' });
    await new Promise((r) => setTimeout(r, 50));
    const fatalJob = qFatal.getJob(fatalEnq.jobId);
    assert.equal(fatalJob.status, JOB_STATUS.FAILED);
    assert.equal(fatalJob.retryPolicy.retryCount, 0, 'Fatal 401 key error must not auto-retry');

    // Restart retry lookup by jobId without seriesId/episodeId
    const qRestart = new ProductionJobQueue({ baseUploadsDir: tempRoot, maxConcurrency: 2 });
    let retriedRan = false;
    qRestart.registerWorkerHandler(async () => {
      retriedRan = true;
      return { totalSegments: 5 };
    });
    const retried = qRestart.retryJob(fatalEnq.jobId);
    assert.ok(retried, 'retryJob(jobId) must find job on disk after restart');
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(retriedRan, 'retried job must dispatch to workerHandler');
    assert.equal(qRestart.getJob(fatalEnq.jobId).status, JOB_STATUS.COMPLETED);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('POST /api/jobs/generate routes through queue, strips plaintext apiKey on disk, and trims list/SSE payloads', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_route_test_'));
  const origBaseDir = productionJobQueue.baseUploadsDir;
  const origWorker = productionJobQueue.workerHandler;
  const origMax = productionJobQueue.maxConcurrency;
  const createdIds = [];

  // Synthetic video file in allowed uploads tree so resolveMediaFile finds it cleanly
  const tempMediaName = `test_q_route_${Date.now()}.mp4`;
  const tempMediaPath = path.resolve(__dirname, '../uploads', tempMediaName);
  fs.writeFileSync(tempMediaPath, Buffer.alloc(16 * 1024, 0));

  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    productionJobQueue.clearMemoryForTesting();
    productionJobQueue.baseUploadsDir = tempRoot;
    productionJobQueue.setMaxConcurrency(2);

    const gates = [];
    productionJobQueue.registerWorkerHandler(async (job) => {
      const segs = Array.from({ length: 220 }, (_, i) => ({
        segmentId: i + 1,
        startSec: i * 1.5,
        endSec: i * 1.5 + 1.2,
        chineseText: '你好世界测试对白数据非常长',
        khmerText: 'សួស្តីពិភពលោក នេះជាការសាកល្បងទិន្នន័យ',
      }));
      await new Promise((resolve) => {
        if (gates.length < 2) {
          gates.push(resolve);
        } else {
          resolve();
        }
      });
      return {
        success: true,
        mode: job.mode,
        totalSegments: segs.length,
        segments: segs,
        script: segs,
      };
    });

    // Submit 4 episodes -> first 2 should enter active worker slots, next 2 queued
    for (let i = 1; i <= 4; i++) {
      const res = await httpRequestJson(port, 'POST', '/api/jobs/generate', {
        videoPath: tempMediaPath,
        seriesId: 'series_route_test',
        episodeId: `ep_${i}`,
        apiKey: 'AIzaSyTEST_SECRET_KEY_1234567890',
        mode: 'fast_ocr',
      });
      assert.equal(res.status, 200, `Expected 200 for ep_${i}, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.equal(res.data.success, true);
      createdIds.push(res.data.jobId);
      assert.equal(res.data.job?.config?.apiKey, undefined, 'Response job config must not leak apiKey');
    }

    await new Promise((r) => setTimeout(r, 60));

    // Verify disk manifest contains NO apiKey
    const diskPath = getJobFilePath('series_route_test', 'ep_1', createdIds[0], tempRoot);
    const diskContent = fs.readFileSync(diskPath, 'utf8');
    assert.ok(!diskContent.includes('AIzaSyTEST_SECRET_KEY'), 'Disk job manifest must NEVER contain plaintext apiKey');
    assert.ok(getTransientJobApiKey(createdIds[0])?.includes('AIzaSyTEST_SECRET_KEY'), 'Transient key must exist while active');

    const listMid = await httpRequestJson(port, 'GET', '/api/jobs');
    assert.equal(listMid.status, 200);
    assert.equal(listMid.data.stats.runningCount, 2, 'Max 2 jobs should be running simultaneously');
    assert.equal(listMid.data.stats.queuedCount, 2, 'Remaining 2 jobs must stay queued');

    // Release gates so all complete with 220 segments
    while (gates.length > 0) gates.shift()();
    await new Promise((r) => setTimeout(r, 120));

    // Verify GET /api/jobs strips heavy segments/script while keeping totalSegments = 220
    const listDone = await httpRequestJson(port, 'GET', '/api/jobs');
    assert.equal(listDone.status, 200);
    const ep1Summary = listDone.data.jobs.find((j) => j.jobId === createdIds[0]);
    assert.ok(ep1Summary, 'Completed ep_1 job must appear in list');
    assert.equal(ep1Summary.totalSegments, 220);
    assert.equal(ep1Summary.finalResult?.totalSegments, 220);
    assert.equal(ep1Summary.finalResult?.segments, undefined, 'GET /api/jobs must strip finalResult.segments');
    assert.equal(ep1Summary.finalResult?.script, undefined, 'GET /api/jobs must strip finalResult.script');

    // Verify transient key auto-cleaned after completion
    assert.equal(getTransientJobApiKey(createdIds[0]), null, 'Transient API key must be deleted after job completion');

    // Verify GET /api/jobs/:jobId/status keeps full 220 segments
    const detailRes = await httpRequestJson(port, 'GET', `/api/jobs/${createdIds[0]}/status`);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.finalResult?.segments?.length, 220, 'Detail status endpoint must preserve full segments');
  } finally {
    jobRoutes.closeAllJobStreams();
    await new Promise((r) => server.close(r));
    productionJobQueue.clearMemoryForTesting();
    productionJobQueue.baseUploadsDir = origBaseDir;
    productionJobQueue.workerHandler = origWorker;
    productionJobQueue.maxConcurrency = origMax;
    if (fs.existsSync(tempMediaPath)) fs.unlinkSync(tempMediaPath);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('createPipelineWorkerHandler reads transient API key and cleans up after failure or completion', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_worker_test_'));
  const dummyVideo = path.join(tempRoot, 'vid.mp4');
  fs.writeFileSync(dummyVideo, Buffer.alloc(1024));

  try {
    const queue = new ProductionJobQueue({ baseUploadsDir: tempRoot, maxConcurrency: 2 });
    let capturedKey = null;
    let capturedSignal = null;

    const handler = createPipelineWorkerHandler(queue, {
      runDubbingPipeline: async ({ apiKey, signal }) => {
        capturedKey = apiKey;
        capturedSignal = signal;
        return { totalSegments: 3, segments: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      },
      extractAllGeminiKeys: (raw) => (raw ? String(raw).split(',').filter(Boolean) : []),
    });
    queue.registerWorkerHandler(handler);

    const enq = queue.enqueueJob({
      seriesId: 's_w',
      episodeId: 'ep_w',
      videoPath: dummyVideo,
    });
    setTransientJobApiKey(enq.jobId, 'AIzaSyWORKER_TRANSIENT_KEY_ABC123');

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(capturedKey, 'AIzaSyWORKER_TRANSIENT_KEY_ABC123');
    assert.ok(capturedSignal instanceof AbortSignal);
    assert.equal(queue.getJob(enq.jobId).status, JOB_STATUS.COMPLETED);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('updateSeriesMetadata updates target episode atomically without clobbering sibling episode edits', () => {
  const testSeriesId = `series_atomic_test_${Date.now()}`;
  const seriesDir = path.resolve(__dirname, '../uploads/projects', testSeriesId);
  try {
    saveSeriesMetadata({
      id: testSeriesId,
      title: 'Atomic Test Series',
      episodes: [
        { id: 'ep_1', episodeNumber: 1, title: 'EP1', scriptData: null },
        { id: 'ep_2', episodeNumber: 2, title: 'EP2', scriptData: null },
      ],
    });

    updateSeriesMetadata(testSeriesId, (s) => {
      const ep1 = s.episodes.find((e) => e.id === 'ep_1');
      ep1.status = 'translated';
      ep1.scriptData = { hasScript: true, mode: 'dialogue', totalSegments: 1, segments: [{ id: 1 }] };
      return true;
    });

    updateSeriesMetadata(testSeriesId, (s) => {
      const ep2 = s.episodes.find((e) => e.id === 'ep_2');
      ep2.status = 'translated';
      ep2.scriptData = { hasScript: true, mode: 'recap', totalSegments: 2, segments: [{ id: 1 }, { id: 2 }] };
      return true;
    });

    const finalMeta = JSON.parse(fs.readFileSync(path.join(seriesDir, 'series.json'), 'utf8'));
    const savedEp1 = finalMeta.episodes.find((e) => e.id === 'ep_1');
    const savedEp2 = finalMeta.episodes.find((e) => e.id === 'ep_2');
    assert.equal(savedEp1.status, 'translated');
    assert.equal(savedEp1.scriptData.totalSegments, 1);
    assert.equal(savedEp1.scriptData.mode, 'dialogue');
    assert.equal(savedEp2.status, 'translated');
    assert.equal(savedEp2.scriptData.totalSegments, 2);
    assert.equal(savedEp2.scriptData.mode, 'recap');
  } finally {
    fs.rmSync(seriesDir, { recursive: true, force: true });
  }
});

test('extractFramesAtTimestamps supports single-pass extraction and AbortSignal cancellation cleanly', async () => {
  const testVideoPath = path.resolve(__dirname, '../uploads/test_media/ep_2_source.mp4');
  if (!fs.existsSync(testVideoPath)) {
    return;
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_frames_test_'));
  try {
    // 1. Pre-aborted signal must fail immediately with AbortError without exhausting semaphore
    const abortedCtrl = new AbortController();
    abortedCtrl.abort();
    await assert.rejects(
      () => extractFramesAtTimestamps(testVideoPath, [0.5, 42.1], outDir, { signal: abortedCtrl.signal }),
      (err) => err && err.name === 'AbortError'
    );
    assert.equal(ffmpegHeavySemaphore.getStats().active, 0);

    // 2. Real single-pass windowed extraction must produce exact files and clean up temp window files
    const frames = await extractFramesAtTimestamps(testVideoPath, [0.5, 42.1, 42.3, 42.8, 43.4, 44.1, 45.7], outDir);
    assert.equal(frames.length, 7, 'Must extract all 7 requested timestamps');
    for (const f of frames) {
      assert.ok(fs.existsSync(f.filePath), `Frame missing: ${f.filePath}`);
      assert.ok(fs.statSync(f.filePath).size > 400, `Frame empty: ${f.filePath}`);
    }
    const leftovers = fs.readdirSync(outDir).filter((name) => name.startsWith('selw_') || name.startsWith('.selw_'));
    assert.equal(leftovers.length, 0, 'Temporary raw window frames must be cleaned up');
    assert.equal(ffmpegHeavySemaphore.getStats().active, 0);

    // 3. Guard against FFmpeg 8 removed flags (-filter_script:v) and dev.ps1 watching binary models folder
    const ffmpegSrc = fs.readFileSync(path.resolve(__dirname, '../services/ffmpegService.js'), 'utf8');
    assert.ok(!ffmpegSrc.includes('"-filter_script:v"'), 'Must use inline -vf instead of removed -filter_script:v');
    const devPs1Src = fs.readFileSync(path.resolve(__dirname, '../../dev.ps1'), 'utf8');
    assert.ok(!/--watch-path=models(?:\s|$)/.test(devPs1Src), 'dev.ps1 must never watch binary models directory (NTFS atime restarts)');
    assert.ok(devPs1Src.includes('$backendCmd = "node server.js"'), 'dev.ps1 must default backend to stable node server.js');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
