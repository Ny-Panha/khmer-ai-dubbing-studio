const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const express = require('express');

const backendTq = require('../utils/translationQuality');
const {
  runRepairBrokenSegmentsJob,
  buildDiskAudioChecker,
} = require('../services/repairBrokenService');
const { filterValidChineseAsrSegments } = require('../services/pipeline/stages/stage4_analyzeDialogueAudio');
const { stitchAndDeduplicateSegments } = require('../services/pipeline/chunkOrchestrator');
const {
  ProductionJobQueue,
  JOB_STATUS,
} = require('../services/pipeline/productionJobQueue');

function makeTempProjectsDir() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub-repair-test-'));
  const projectsDir = path.join(tmpRoot, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  return { tmpRoot, projectsDir };
}

test('translationQuality: detects text-broken & voice-broken accurately and matches frontend ESM', async () => {
  const frontendTqUrl = pathToFileURL(
    path.resolve(__dirname, '../../frontend/src/utils/translationQuality.js')
  ).href;
  const frontendTq = await import(frontendTqUrl);

  const segments = [
    // #1 Healthy segment
    {
      id: 1,
      chineseText: '我不能再等下去了。',
      khmerText: 'ខ្ញុំមិនអាចរង់ចាំទៀតទេ។',
      audioUrl: '/uploads/ep1/seg1.mp3',
      ttsStatus: 'ready',
    },
    // #2 Empty Khmer text
    {
      id: 2,
      chineseText: '你快走吧！',
      khmerText: '   ',
      audioUrl: '/uploads/ep1/seg2.mp3',
      ttsStatus: 'ready',
    },
    // #3 Punctuation-only Khmer text
    {
      id: 3,
      chineseText: '加油！',
      khmerText: '...',
      audioUrl: null,
    },
    // #4 Explicit filler "សូមរង់ចាំ" + truncation "សូមរង់..."
    {
      id: 4,
      chineseText: '这是什么地方？',
      khmerText: 'សូមរង់ចាំ...',
      audioUrl: '/uploads/ep1/seg4.mp3',
    },
    {
      id: 5,
      chineseText: '快看那边！',
      khmerText: 'សូមរង់...',
      audioUrl: null,
    },
    // #6..#10 Repeated <=40-char Khmer on >=5 segments with differing Chinese
    { id: 6, chineseText: '第一句台词', khmerText: 'ឃ្លាដដែលៗ', audioUrl: '/uploads/ep1/seg6.mp3' },
    { id: 7, chineseText: '第二句台词', khmerText: 'ឃ្លាដដែលៗ', audioUrl: '/uploads/ep1/seg7.mp3' },
    { id: 8, chineseText: '第三句台词', khmerText: 'ឃ្លាដដែលៗ', audioUrl: '/uploads/ep1/seg8.mp3' },
    { id: 9, chineseText: '第四句台词', khmerText: 'ឃ្លាដដែលៗ', audioUrl: '/uploads/ep1/seg9.mp3' },
    { id: 10, chineseText: '第五句台词', khmerText: 'ឃ្លាដដែលៗ', audioUrl: '/uploads/ep1/seg10.mp3' },
    // #11..#15 Repeated Khmer for IDENTICAL Chinese ("好" x5) -> must NOT be flagged
    { id: 11, chineseText: '好', khmerText: 'ល្អ', audioUrl: '/uploads/ep1/seg11.mp3', ttsStatus: 'ready' },
    { id: 12, chineseText: '好', khmerText: 'ល្អ', audioUrl: '/uploads/ep1/seg12.mp3', ttsStatus: 'ready' },
    { id: 13, chineseText: '好', khmerText: 'ល្អ', audioUrl: '/uploads/ep1/seg13.mp3', ttsStatus: 'ready' },
    { id: 14, chineseText: '好', khmerText: 'ល្អ', audioUrl: '/uploads/ep1/seg14.mp3', ttsStatus: 'ready' },
    { id: 15, chineseText: '好', khmerText: 'ល្អ', audioUrl: '/uploads/ep1/seg15.mp3', ttsStatus: 'ready' },
    // #16 VOICE-BROKEN: real Khmer text, missing audioUrl
    {
      id: 16,
      chineseText: '师父救命！',
      khmerText: 'លោកគ្រូជួយផង!',
      audioUrl: null,
      ttsStatus: 'pending',
    },
    // #17 VOICE-BROKEN: real Khmer text, ttsStatus failed
    {
      id: 17,
      chineseText: '小心后面！',
      khmerText: 'ប្រយ័ត្នខាងក្រោយ!',
      audioUrl: '/uploads/ep1/seg17.mp3',
      ttsStatus: 'failed',
    },
    // #18 VOICE-BROKEN: audioFileMissing flag true
    {
      id: 18,
      chineseText: '别过来！',
      khmerText: 'កុំចូលមក!',
      audioUrl: '/uploads/ep1/seg18.mp3',
      audioFileMissing: true,
    },
  ];

  const ep = { id: 'ep_1', scriptData: { segments } };
  const beScan = backendTq.scanEpisodeBrokenSegments(ep);
  const feScan = frontendTq.scanEpisodeBrokenSegments(ep);

  assert.deepEqual(beScan.textBrokenSegmentIds, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(beScan.voiceBrokenSegmentIds, [16, 17, 18]);
  assert.equal(beScan.totalBrokenCount, 12);

  // Parity check between backend CommonJS and frontend ESM
  assert.deepEqual(feScan.textBrokenSegmentIds, beScan.textBrokenSegmentIds);
  assert.deepEqual(feScan.voiceBrokenSegmentIds, beScan.voiceBrokenSegmentIds);
  assert.equal(feScan.totalBrokenCount, beScan.totalBrokenCount);
});

test('geminiRouteHelpers: episode-level hasAudio/Master flags never override broken segment counts', async () => {
  const helpersUrl = pathToFileURL(
    path.resolve(__dirname, '../../frontend/src/components/dashboard/geminiRouteHelpers.js')
  ).href;
  const helpers = await import(helpersUrl);

  const epBroken = {
    id: 'ep_2',
    hasAudio: true,
    audioGenerated: true,
    fullAudioUrl: '/uploads/ep_2_narration_khmer.mp3',
    scriptData: {
      segments: [
        { id: 1, chineseText: '你好', khmerText: 'សួស្តី', audioUrl: '/uploads/1.mp3', ttsStatus: 'ready' },
        { id: 2, chineseText: '什么', khmerText: 'សន្ទនា', audioUrl: '/uploads/2.mp3', ttsStatus: 'ready' },
      ],
    },
  };

  const epHealthy = {
    id: 'ep_3',
    hasAudio: true,
    audioGenerated: true,
    fullAudioUrl: '/uploads/ep_3_narration_khmer.mp3',
    scriptData: {
      segments: [
        { id: 1, chineseText: '你好', khmerText: 'សួស្តី', audioUrl: '/uploads/1.mp3', ttsStatus: 'ready' },
      ],
    },
  };

  assert.equal(helpers.checkEpisodeHasAudioReady(epBroken), false);
  assert.equal(helpers.checkEpisodeHasAudioReady(epHealthy), true);

  const translateSummary = helpers.computeSeriesTranslateSummary([epBroken, epHealthy]);
  assert.equal(translateSummary.isTranslateAllDone, false);
  assert.equal(translateSummary.totalTextBrokenCount, 1);
  assert.equal(translateSummary.healthyScriptedCount, 1);
});

test('runRepairBrokenSegmentsJob: sweeps ONLY broken subset, preserves healthy mtimes, handles quota partial & idempotent resume', async () => {
  const { tmpRoot, projectsDir } = makeTempProjectsDir();
  const seriesId = 'series_repair_unit';
  const episodeId = 'ep_1';
  const seriesDir = path.join(projectsDir, seriesId);
  const epAudioDir = path.join(seriesDir, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  // Healthy segment audio file on disk (mtime must remain untouched!)
  const healthyAudioPath = path.join(epAudioDir, 'seg_1_healthy.mp3');
  fs.writeFileSync(healthyAudioPath, Buffer.from('HEALTHY_MP3_BYTES_DO_NOT_TOUCH'));
  const pastTime = new Date(Date.now() - 120_000);
  fs.utimesSync(healthyAudioPath, pastTime, pastTime);
  const beforeMtimeMs = fs.statSync(healthyAudioPath).mtimeMs;

  // Stale filler audio file on disk for seg #2 (must NOT overwrite healthy file; seg #2 gets fresh audio)
  const staleFillerAudioPath = path.join(epAudioDir, 'seg_2_stale.mp3');
  fs.writeFileSync(staleFillerAudioPath, Buffer.from('STALE_FILLER_AUDIO'));

  const initialSeries = {
    id: seriesId,
    title: 'Repair Test Series',
    episodes: [
      {
        id: episodeId,
        episodeNumber: 1,
        title: 'Episode 1',
        hasAudio: true,
        audioGenerated: true,
        scriptData: {
          hasScript: true,
          segments: [
            {
              id: 1,
              start: '00:00',
              end: '00:03',
              startSec: 0,
              endSec: 3,
              chineseText: '师兄请留步。',
              khmerText: 'បងប្រុសសូមឈប់សិន។',
              audioPath: healthyAudioPath,
              audioUrl: `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/seg_1_healthy.mp3`,
              ttsStatus: 'ready',
            },
            {
              id: 2,
              start: '00:03',
              end: '00:06',
              startSec: 3,
              endSec: 6,
              chineseText: '这颗丹药到底是什么？',
              khmerText: 'សន្ទនា',
              audioPath: staleFillerAudioPath,
              audioUrl: `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/seg_2_stale.mp3`,
              ttsStatus: 'ready',
            },
            {
              id: 3,
              start: '00:06',
              end: '00:09',
              startSec: 6,
              endSec: 9,
              chineseText: '系统没有骗你！',
              khmerText: 'សូមរង់...',
              audioPath: null,
              audioUrl: null,
              ttsStatus: 'pending',
            },
            {
              id: 4,
              start: '00:09',
              end: '00:12',
              startSec: 9,
              endSec: 12,
              chineseText: '我们快离开这里！',
              khmerText: 'ពួកយើងប្រញាប់ចាកចេញពីទីនេះទៅ!',
              audioPath: null,
              audioUrl: null,
              ttsStatus: 'failed',
            },
          ],
        },
      },
    ],
  };
  fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify(initialSeries, null, 2), 'utf8');

  const translatedIdsPass1 = [];
  const voicedIdsPass1 = [];

  const queue = new ProductionJobQueue({ maxConcurrency: 1, baseUploadsDir: tmpRoot });
  queue.workerHandler = async (job, signal) => {
    return runRepairBrokenSegmentsJob(job, {
      projectsDir,
      baseUploadsDir: tmpRoot,
      queue,
      signal,
      // Simulate Pass 1: fixes seg #2, rejects still-junk on seg #3, then hits 429 quota!
      translateBatchFn: async (inputLines) => {
        for (const l of inputLines) translatedIdsPass1.push(l.id);
        return [
          { id: 2, khmerText: 'តើថ្នាំទិព្វនេះជាអ្វីឱ្យប្រាកដ?' },
          { id: 3, khmerText: 'សូមរង់ចាំ...' }, // still-junk -> detector MUST reject!
        ];
      },
      generateBatchTtsFn: async (subset, audioDir) => {
        return subset.map((seg) => {
          voicedIdsPass1.push(seg.id);
          const outFile = path.join(audioDir, `repaired_seg_${seg.id}.mp3`);
          fs.writeFileSync(outFile, Buffer.from(`FRESH_TTS_${seg.id}`));
          return {
            ...seg,
            audioPath: outFile,
            audioFile: path.basename(outFile),
            audioUrl: `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/${path.basename(outFile)}`,
            ttsStatus: 'ready',
            audioGenerated: true,
          };
        });
      },
      syncNarrationFn: async (_segs, fullAudioPath) => {
        fs.writeFileSync(fullAudioPath, Buffer.from('MASTER_NARRATION_SYNCED'));
      },
    });
  };

  try {
    // ── PASS 1: Partial completion (seg #3 remains broken because output was still junk) ──
    const { jobData: job1 } = queue.enqueueJob({
      seriesId,
      episodeId,
      mode: 'repair_broken',
      totalSegments: 3,
      config: { isRepairBroken: true },
      baseUploadsDir: tmpRoot,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const doneJob1 = queue.getJob(job1.jobId);
    assert.equal(doneJob1.status, JOB_STATUS.PARTIAL);
    assert.equal(doneJob1.finalResult.fixedCount, 2); // seg #2 + seg #4 fixed
    assert.equal(doneJob1.finalResult.remainingCount, 1); // seg #3 still broken
    assert.match(doneJob1.finalResult.message, /^កែបាន 2 • នៅសល់ 1.*ចុចម្ដងទៀតដើម្បីបន្ត$/);

    // Healthy seg #1 must NEVER have been passed to translator or TTS, and mtime must be untouched!
    assert.deepEqual(translatedIdsPass1, [2, 3]);
    assert.deepEqual(voicedIdsPass1, [2, 4]);
    assert.equal(fs.statSync(healthyAudioPath).mtimeMs, beforeMtimeMs);

    // ── PASS 2: Idempotent second press resumes strictly remaining 1 segment (#3) ──
    const translatedIdsPass2 = [];
    const voicedIdsPass2 = [];
    queue.workerHandler = async (job, signal) => {
      return runRepairBrokenSegmentsJob(job, {
        projectsDir,
        baseUploadsDir: tmpRoot,
        queue,
        signal,
        translateBatchFn: async (inputLines) => {
          for (const l of inputLines) translatedIdsPass2.push(l.id);
          return [{ id: 3, khmerText: 'ប្រព័ន្ធមិនបានកុហកឯងទេ!' }];
        },
        generateBatchTtsFn: async (subset, audioDir) => {
          return subset.map((seg) => {
            voicedIdsPass2.push(seg.id);
            const outFile = path.join(audioDir, `repaired_seg_${seg.id}_p2.mp3`);
            fs.writeFileSync(outFile, Buffer.from(`FRESH_TTS_P2_${seg.id}`));
            return {
              ...seg,
              audioPath: outFile,
              audioFile: path.basename(outFile),
              audioUrl: `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/${path.basename(outFile)}`,
              ttsStatus: 'ready',
              audioGenerated: true,
            };
          });
        },
        syncNarrationFn: async (_segs, fullAudioPath) => {
          fs.writeFileSync(fullAudioPath, Buffer.from('MASTER_NARRATION_SYNCED_P2'));
        },
      });
    };

    const { jobData: job2 } = queue.enqueueJob({
      seriesId,
      episodeId,
      mode: 'repair_broken',
      totalSegments: 1,
      config: { isRepairBroken: true },
      baseUploadsDir: tmpRoot,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const doneJob2 = queue.getJob(job2.jobId);
    assert.equal(doneJob2.status, JOB_STATUS.COMPLETED);
    assert.equal(doneJob2.finalResult.fixedCount, 1);
    assert.equal(doneJob2.finalResult.remainingCount, 0);

    // Only remaining seg #3 was translated & voiced in Pass 2
    assert.deepEqual(translatedIdsPass2, [3]);
    assert.deepEqual(voicedIdsPass2, [3]);
    assert.equal(fs.statSync(healthyAudioPath).mtimeMs, beforeMtimeMs);

    // Final stored scan confirms broken == 0
    const updatedSeries = JSON.parse(fs.readFileSync(path.join(seriesDir, 'series.json'), 'utf8'));
    const checkFn = buildDiskAudioChecker(epAudioDir, tmpRoot);
    const finalScan = backendTq.scanEpisodeBrokenSegments(updatedSeries.episodes[0], {
      checkAudioFileFn: checkFn,
    });
    assert.equal(finalScan.totalBrokenCount, 0);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('runRepairBrokenSegmentsJob: simulated mid-job 429 quota exhaustion reports exact partial message and resumes cleanly', async () => {
  const { tmpRoot, projectsDir } = makeTempProjectsDir();
  const seriesId = 'series_quota_sim';
  const episodeId = 'ep_1';
  const seriesDir = path.join(projectsDir, seriesId);
  const epAudioDir = path.join(seriesDir, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  // Build 30 broken segments (> REPAIR_BATCH_SIZE=25 so batch 1 fixes 25 and batch 2 hits 429 quota on remaining 5)
  const segs = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    start: '00:00',
    end: '00:02',
    startSec: i * 2,
    endSec: (i + 1) * 2,
    chineseText: `台词第${i + 1}句`,
    khmerText: 'សន្ទនា',
    audioUrl: null,
    ttsStatus: 'pending',
  }));

  fs.writeFileSync(
    path.join(seriesDir, 'series.json'),
    JSON.stringify({
      id: seriesId,
      episodes: [{ id: episodeId, episodeNumber: 1, title: 'EP1', scriptData: { hasScript: true, segments: segs } }],
    }),
    'utf8'
  );

  const queue = new ProductionJobQueue({ maxConcurrency: 1, baseUploadsDir: tmpRoot });
  queue.workerHandler = async (job, signal) => {
    return runRepairBrokenSegmentsJob(job, {
      projectsDir,
      baseUploadsDir: tmpRoot,
      queue,
      signal,
      translateBatchFn: async (inputLines, { batchIndex }) => {
        if (batchIndex >= 1) {
          const err = new Error('429 Resource has been exhausted (quota)');
          err.status = 429;
          throw err;
        }
        return inputLines.map((l) => ({ id: l.id, khmerText: `ឃ្លាពិតប្រាកដទី ${l.id}` }));
      },
      generateBatchTtsFn: async (subset, audioDir) =>
        subset.map((seg) => {
          const outFile = path.join(audioDir, `q_seg_${seg.id}.mp3`);
          fs.writeFileSync(outFile, Buffer.from(`AUDIO_${seg.id}`));
          return {
            ...seg,
            audioPath: outFile,
            audioFile: path.basename(outFile),
            audioUrl: `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/${path.basename(outFile)}`,
            ttsStatus: 'ready',
            audioGenerated: true,
          };
        }),
      syncNarrationFn: async (_segs, fullAudioPath) => {
        fs.writeFileSync(fullAudioPath, Buffer.from('MASTER_QUOTA_PARTIAL'));
      },
    });
  };

  try {
    const { jobData: pass1Job } = queue.enqueueJob({
      seriesId,
      episodeId,
      mode: 'repair_broken',
      totalSegments: 30,
      config: { isRepairBroken: true },
      baseUploadsDir: tmpRoot,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const j1 = queue.getJob(pass1Job.jobId);
    assert.equal(j1.status, JOB_STATUS.PARTIAL);
    assert.equal(j1.finalResult.fixedCount, 25);
    assert.equal(j1.finalResult.remainingCount, 5);
    assert.equal(j1.finalResult.message, 'កែបាន 25 • នៅសល់ 5 (quota) — ចុចម្ដងទៀតដើម្បីបន្ត');

    // Second press resumes ONLY the remaining 5 segments
    let pass2BatchCount = 0;
    queue.workerHandler = async (job, signal) => {
      return runRepairBrokenSegmentsJob(job, {
        projectsDir,
        baseUploadsDir: tmpRoot,
        queue,
        signal,
        translateBatchFn: async (inputLines) => {
          pass2BatchCount += 1;
          assert.deepEqual(inputLines.map((l) => l.id), [26, 27, 28, 29, 30]);
          return inputLines.map((l) => ({ id: l.id, khmerText: `ឃ្លាពិតប្រាកដទី ${l.id}` }));
        },
        generateBatchTtsFn: async (subset, audioDir) =>
          subset.map((seg) => {
            const outFile = path.join(audioDir, `q_seg_${seg.id}.mp3`);
            fs.writeFileSync(outFile, Buffer.from(`AUDIO_${seg.id}`));
            return {
              ...seg,
              audioPath: outFile,
              audioFile: path.basename(outFile),
              audioUrl: `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/${path.basename(outFile)}`,
              ttsStatus: 'ready',
              audioGenerated: true,
            };
          }),
        syncNarrationFn: async (_segs, fullAudioPath) => {
          fs.writeFileSync(fullAudioPath, Buffer.from('MASTER_QUOTA_COMPLETE'));
        },
      });
    };

    const { jobData: pass2Job } = queue.enqueueJob({
      seriesId,
      episodeId,
      mode: 'repair_broken',
      totalSegments: 5,
      config: { isRepairBroken: true },
      baseUploadsDir: tmpRoot,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const j2 = queue.getJob(pass2Job.jobId);
    assert.equal(pass2BatchCount, 1);
    assert.equal(j2.status, JOB_STATUS.COMPLETED);
    assert.equal(j2.finalResult.fixedCount, 5);
    assert.equal(j2.finalResult.remainingCount, 0);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('POST /api/jobs/repair-broken: returns truthful scanBefore and skips healthy episodes', async () => {
  const jobRoutes = require('../routes/jobRoutes');
  const { uploadsDir } = require('../utils/pathUtils');

  const testSeriesId = `series_route_repair_${Date.now()}`;
  const seriesDir = path.join(uploadsDir, 'projects', testSeriesId);
  fs.mkdirSync(seriesDir, { recursive: true });

  const seriesPayload = {
    id: testSeriesId,
    title: 'Route Repair Test',
    episodes: [
      {
        id: 'ep_healthy',
        episodeNumber: 1,
        title: 'Healthy Ep',
        scriptData: {
          hasScript: true,
          segments: [
            { id: 1, chineseText: '你好', khmerText: 'សួស្តី', audioUrl: null }, // wait: missing audio -> let's make an actual disk file below!
          ],
        },
      },
      {
        id: 'ep_broken',
        episodeNumber: 2,
        title: 'Broken Ep',
        scriptData: {
          hasScript: true,
          segments: [
            { id: 1, chineseText: '快走', khmerText: 'សន្ទនា', audioUrl: null },
          ],
        },
      },
    ],
  };

  // Create real audio file for ep_healthy seg #1
  const healthyAudioDir = path.join(seriesDir, 'episodes', 'ep_healthy', 'audio');
  fs.mkdirSync(healthyAudioDir, { recursive: true });
  const healthyFile = path.join(healthyAudioDir, 'ok.mp3');
  fs.writeFileSync(healthyFile, Buffer.from('OK_AUDIO'));
  seriesPayload.episodes[0].scriptData.segments[0].audioPath = healthyFile;
  seriesPayload.episodes[0].scriptData.segments[0].audioUrl = `/uploads/projects/${testSeriesId}/episodes/ep_healthy/audio/ok.mp3`;

  fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify(seriesPayload, null, 2), 'utf8');

  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    // Request repair with NO apiKey first when textBroken > 0 -> expects 400 clear message
    const res400 = await fetch(`http://127.0.0.1:${port}/api/jobs/repair-broken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId: testSeriesId,
        episodeIds: ['ep_healthy', 'ep_broken'],
      }),
    });
    assert.equal(res400.status, 400);

    // Request repair ONLY on ep_healthy -> 0 jobs enqueued, skippedHealthyCount === 1
    const resHealthyOnly = await fetch(`http://127.0.0.1:${port}/api/jobs/repair-broken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId: testSeriesId,
        episodeIds: ['ep_healthy'],
      }),
    });
    const dataHealthyOnly = await resHealthyOnly.json();
    assert.equal(resHealthyOnly.status, 200);
    assert.equal(dataHealthyOnly.enqueuedCount, 0);
    assert.equal(dataHealthyOnly.skippedHealthyCount, 1);
    assert.equal(dataHealthyOnly.scanBefore.totalBrokenCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(seriesDir, { recursive: true, force: true });
  }
});

test('Non-Chinese SenseVoice ASR hallucinations are auto-dropped at Stage 4, Stitcher, and Parity while preserving visual_ocr & Hanzi', async () => {
  const frontendTqUrl = pathToFileURL(
    path.resolve(__dirname, '../../frontend/src/utils/translationQuality.js')
  ).href;
  const frontendTq = await import(frontendTqUrl);

  const sampleSegments = [
    // Non-Chinese SenseVoice ASR junk -> MUST drop
    { id: 1, startSec: 1, endSec: 2, evidenceSource: 'audio_asr', spokenAudioText: 'The.', originalChineseText: 'The.', ocrSubtitleText: '' },
    { id: 2, startSec: 3, endSec: 4, evidenceSource: 'sense_voice_local', spokenAudioText: 'Yeah.', originalChineseText: 'Yeah.', ocrSubtitleText: '' },
    // Non-Hanzi visual OCR (e.g. mathematical formula) -> MUST keep
    { id: 3, startSec: 5, endSec: 6, evidenceSource: 'visual_ocr', ocrSubtitleText: 'E=MC²', originalChineseText: 'E=MC²' },
    // Mixed audio_asr that HAS Chinese Hanzi -> MUST keep
    { id: 4, startSec: 7, endSec: 8, evidenceSource: 'audio_asr', spokenAudioText: '好 OK!', originalChineseText: '好 OK!' },
    // User-overridden segment -> MUST keep
    { id: 5, startSec: 9, endSec: 10, evidenceSource: 'audio_asr', originalChineseText: 'Okay', userOverridden: true },
  ];

  assert.deepEqual(
    sampleSegments.map((s) => backendTq.isNonChineseAsrHallucination(s)),
    [true, true, false, false, false]
  );
  assert.deepEqual(
    sampleSegments.map((s) => frontendTq.isNonChineseAsrHallucination(s)),
    sampleSegments.map((s) => backendTq.isNonChineseAsrHallucination(s)),
    'Backend & frontend isNonChineseAsrHallucination must have 100% parity'
  );

  // Stage 4 filter keeps Chinese ASR speech and drops English/punctuation hallucinations
  const stage4Filtered = filterValidChineseAsrSegments([
    { startSec: 1, endSec: 2, text: 'The.', chineseText: 'The.' },
    { startSec: 3, endSec: 4, spokenAudioText: '你好，快过来！', text: '你好，快过来！' },
    { startSec: 5, endSec: 6, text: 'Yeah.' },
  ]);
  assert.equal(stage4Filtered.length, 1);
  assert.equal(stage4Filtered[0].text, '你好，快过来！');

  // ChunkOrchestrator stitcher filters cached/stitched audio_asr hallucinations while preserving visual_ocr
  const stitched = stitchAndDeduplicateSegments(sampleSegments);
  assert.deepEqual(
    stitched.map((s) => s.originalChineseText),
    ['E=MC²', '好 OK!', 'Okay']
  );
});

test('runRepairBrokenSegmentsJob: auto-drops non-Chinese audio_asr hallucinations, persists cleanup, and retries broken text lines when enabled', async () => {
  const { tmpRoot, projectsDir } = makeTempProjectsDir();
  const seriesId = 'series_repair_drop_asr_junk';
  const ep1Id = 'ep_1';
  const ep2Id = 'ep_2';
  const seriesDir = path.join(projectsDir, seriesId);
  const ep1AudioDir = path.join(seriesDir, 'episodes', ep1Id, 'audio');
  const ep2AudioDir = path.join(seriesDir, 'episodes', ep2Id, 'audio');
  fs.mkdirSync(ep1AudioDir, { recursive: true });
  fs.mkdirSync(ep2AudioDir, { recursive: true });

  const healthyAudio = path.join(ep1AudioDir, 'seg1_ok.mp3');
  fs.writeFileSync(healthyAudio, Buffer.from('HEALTHY_AUDIO_BYTES'));
  const pastTime = new Date(Date.now() - 90_000);
  fs.utimesSync(healthyAudio, pastTime, pastTime);
  const beforeMtime = fs.statSync(healthyAudio).mtimeMs;

  const seriesData = {
    id: seriesId,
    title: 'Repair Junk Test',
    episodes: [
      {
        id: ep1Id,
        episodeNumber: 1,
        title: 'EP1 Junk Only',
        hasAudio: true,
        audioGenerated: true,
        scriptData: {
          hasScript: true,
          segments: [
            {
              id: 1,
              startSec: 0,
              endSec: 2,
              chineseText: '你来了。',
              khmerText: 'អ្នកមកដល់ហើយ។',
              audioPath: healthyAudio,
              audioUrl: `/uploads/projects/${seriesId}/episodes/${ep1Id}/audio/seg1_ok.mp3`,
              ttsStatus: 'ready',
            },
            {
              id: 2,
              startSec: 2,
              endSec: 4,
              evidenceSource: 'audio_asr',
              spokenAudioText: 'The.',
              chineseText: 'The.',
              khmerText: '',
              audioUrl: null,
            },
            {
              id: 3,
              startSec: 4,
              endSec: 6,
              evidenceSource: 'sense_voice_local',
              spokenAudioText: 'Yeah.',
              chineseText: 'Yeah.',
              khmerText: '។',
              audioUrl: null,
            },
          ],
        },
      },
      {
        id: ep2Id,
        episodeNumber: 2,
        title: 'EP2 Retry Recovery',
        scriptData: {
          hasScript: true,
          segments: [
            {
              id: 10,
              startSec: 0,
              endSec: 2,
              evidenceSource: 'audio_asr',
              spokenAudioText: 'Oh.',
              chineseText: 'Oh.',
              khmerText: '!',
              audioUrl: null,
            },
            {
              id: 11,
              startSec: 2,
              endSec: 5,
              evidenceSource: 'visual_ocr',
              ocrSubtitleText: '别动！',
              chineseText: '别动！',
              khmerText: '។',
              audioUrl: null,
              ttsStatus: 'pending',
            },
          ],
        },
      },
    ],
  };
  fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify(seriesData, null, 2), 'utf8');

  const queue = new ProductionJobQueue({ maxConcurrency: 1, baseUploadsDir: tmpRoot });

  try {
    // 1. EP1 has only 1 healthy line + 2 non-Chinese audio_asr hallucinations -> drops junk cleanly without calling translator or touching healthy mtime
    let translateCalledEp1 = false;
    queue.workerHandler = async (job, signal) =>
      runRepairBrokenSegmentsJob(job, {
        projectsDir,
        baseUploadsDir: tmpRoot,
        queue,
        signal,
        translateBatchFn: async () => {
          translateCalledEp1 = true;
          return [];
        },
      });

    const { jobData: jobEp1 } = queue.enqueueJob({
      seriesId,
      episodeId: ep1Id,
      mode: 'repair_broken',
      totalSegments: 2,
      config: { isRepairBroken: true },
      baseUploadsDir: tmpRoot,
    });
    await new Promise((r) => setTimeout(r, 120));

    const done1 = queue.getJob(jobEp1.jobId);
    assert.equal(done1.status, JOB_STATUS.COMPLETED);
    assert.equal(done1.finalResult.droppedJunkCount, 2);
    assert.equal(done1.finalResult.remainingCount, 0);
    assert.equal(translateCalledEp1, false);
    assert.equal(fs.statSync(healthyAudio).mtimeMs, beforeMtime);

    const diskAfter1 = JSON.parse(fs.readFileSync(path.join(seriesDir, 'series.json'), 'utf8'));
    assert.deepEqual(
      diskAfter1.episodes[0].scriptData.segments.map((s) => s.id),
      [1]
    );

    // 2. EP2 drops audio_asr "Oh." AND rescues visual_ocr "别动！" via in-job retry when pass 1 returns punctuation-only "..."
    const seenCalls = [];
    queue.workerHandler = async (job, signal) =>
      runRepairBrokenSegmentsJob(job, {
        projectsDir,
        baseUploadsDir: tmpRoot,
        queue,
        signal,
        enableInJobRetry: true,
        translateBatchFn: async (inputLines, { isRetry }) => {
          seenCalls.push({ isRetry: Boolean(isRetry), ids: inputLines.map((l) => l.id) });
          if (!isRetry) {
            return [{ id: 11, khmerText: '...' }];
          }
          return [{ id: 11, khmerText: 'កុំកម្រើក!' }];
        },
        generateBatchTtsFn: async (subset, audioDir) =>
          subset.map((seg) => {
            const outFile = path.join(audioDir, `ep2_${seg.id}.mp3`);
            fs.writeFileSync(outFile, Buffer.from(`AUDIO_${seg.id}`));
            return {
              ...seg,
              audioPath: outFile,
              audioFile: path.basename(outFile),
              audioUrl: `/uploads/projects/${seriesId}/episodes/${ep2Id}/audio/${path.basename(outFile)}`,
              ttsStatus: 'ready',
              audioGenerated: true,
            };
          }),
        syncNarrationFn: async (_segs, fullAudioPath) => {
          fs.writeFileSync(fullAudioPath, Buffer.from('MASTER_EP2'));
        },
      });

    const { jobData: jobEp2 } = queue.enqueueJob({
      seriesId,
      episodeId: ep2Id,
      mode: 'repair_broken',
      totalSegments: 2,
      config: { isRepairBroken: true },
      baseUploadsDir: tmpRoot,
    });
    await new Promise((r) => setTimeout(r, 150));

    const done2 = queue.getJob(jobEp2.jobId);
    assert.equal(done2.status, JOB_STATUS.COMPLETED);
    assert.equal(done2.finalResult.droppedJunkCount, 1);
    assert.equal(done2.finalResult.remainingCount, 0);
    assert.deepEqual(seenCalls, [
      { isRetry: false, ids: [11] },
      { isRetry: true, ids: [11] },
    ]);

    const diskAfter2 = JSON.parse(fs.readFileSync(path.join(seriesDir, 'series.json'), 'utf8'));
    assert.equal(diskAfter2.episodes[1].scriptData.segments.length, 1);
    assert.equal(diskAfter2.episodes[1].scriptData.segments[0].khmerText, 'កុំកម្រើក!');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Batch Generate Studio & Job Dashboard contain ZERO browser native confirm/alert dialogs', () => {
  const dashboardDir = path.resolve(__dirname, '../../frontend/src/components/dashboard');
  const commonDir = path.resolve(__dirname, '../../frontend/src/components/common');
  const filesToScan = [];

  const collectJsFiles = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectJsFiles(fullPath);
      } else if (/\.(js|jsx)$/.test(entry.name)) {
        filesToScan.push(fullPath);
      }
    }
  };
  collectJsFiles(dashboardDir);
  collectJsFiles(commonDir);

  assert.ok(filesToScan.length >= 6, 'Expected dashboard & common components to be scanned');
  for (const filePath of filesToScan) {
    const code = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      /\bwindow\.confirm\s*\(/.test(code),
      false,
      `${path.basename(filePath)} must NOT call browser window.confirm()`
    );
    assert.equal(
      /(?:^|[^\w$.])alert\s*\(/m.test(code),
      false,
      `${path.basename(filePath)} must NOT call browser alert()`
    );
  }

  const studioDialogCode = fs.readFileSync(path.join(commonDir, 'StudioConfirmDialog.jsx'), 'utf8');
  assert.ok(studioDialogCode.includes('data-testid="studio-confirm-modal"'));
  assert.ok(studioDialogCode.includes('data-testid="studio-confirm-ok-btn"'));
  assert.ok(studioDialogCode.includes('data-testid="studio-confirm-cancel-btn"'));

  const geminiModalCode = fs.readFileSync(path.join(dashboardDir, 'GeminiRouteModal.jsx'), 'utf8');
  assert.ok(geminiModalCode.includes('StudioConfirmDialog'));
  assert.ok(geminiModalCode.includes('openStudioDialog'));
});

test('runRepairBrokenSegmentsJob (aiClient path): resolves wrapped/string/re-indexed responses + single-line rescue and clears MISSING_SEGMENT_TRANSLATION', async () => {
  const { tmpRoot, projectsDir } = makeTempProjectsDir();
  const seriesId = 'series_repair_aiclient';
  const episodeId = 'ep_6';
  const seriesDir = path.join(projectsDir, seriesId);
  const epAudioDir = path.join(seriesDir, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  const healthyAudio = path.join(epAudioDir, 'seg1_ok.mp3');
  fs.writeFileSync(healthyAudio, Buffer.from('HEALTHY_AUDIO_OK'));
  const pastTime = new Date(Date.now() - 80_000);
  fs.utimesSync(healthyAudio, pastTime, pastTime);
  const beforeMtime = fs.statSync(healthyAudio).mtimeMs;

  const seriesData = {
    id: seriesId,
    title: 'AI Client Repair Test',
    episodes: [
      {
        id: episodeId,
        episodeNumber: 6,
        title: 'EP6',
        scriptData: {
          hasScript: true,
          segments: [
            {
              id: 1,
              startSec: 0,
              endSec: 2,
              chineseText: '大家快看！',
              khmerText: 'អ្នកទាំងអស់គ្នាមើល!',
              audioPath: healthyAudio,
              audioUrl: `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/seg1_ok.mp3`,
              ttsStatus: 'ready',
            },
            {
              id: 67,
              startSec: 2,
              endSec: 4,
              evidenceSource: 'visual_ocr',
              ocrSubtitleText: '天眼视角',
              chineseText: '天眼视角',
              khmerText: '',
              khmerTranslatedText: '',
              reviewNeeded: true,
              translationWarning: 'MISSING_SEGMENT_TRANSLATION',
              validationErrors: ['មិនមានលទ្ធផលបកប្រែពី AI សម្រាប់បន្ទាត់ #67'],
              audioUrl: null,
            },
            {
              id: 86,
              startSec: 4,
              endSec: 6,
              chineseText: '你这个混蛋，',
              khmerText: '',
              khmerTranslatedText: '',
              reviewNeeded: true,
              translationWarning: 'MISSING_SEGMENT_TRANSLATION',
              validationErrors: ['មិនមានលទ្ធផលបកប្រែពី AI សម្រាប់បន្ទាត់ #86'],
              audioUrl: null,
            },
            {
              id: 233,
              startSec: 6,
              endSec: 9,
              chineseText: '不然你们走到灵虚圣地得走多少年',
              khmerText: '។',
              khmerTranslatedText: '។',
              reviewNeeded: true,
              translationWarning: 'TRANSLATION_FAILED',
              validationErrors: ['ការបកប្រែ AI បរាជ័យសម្រាប់ Batch 12'],
              audioUrl: null,
            },
          ],
        },
      },
    ],
  };
  fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify(seriesData, null, 2), 'utf8');

  let aiStageCall = 0;
  const mockAiClient = {
    models: {
      generateContent: async ({ contents }) => {
        const prompt = String(contents[0] || '');
        if (prompt.includes('ឃ្លាត្រូវជួសជុល (#233)')) {
          return {
            text: JSON.stringify({
              id: 233,
              khmerText: 'បើមិនអញ្ចឹង តើដើរដល់ដែនដីលីងស៊ូប៉ុន្មានឆ្នាំ?',
            }),
          };
        }
        aiStageCall++;
        if (aiStageCall === 1) {
          // Pass 1 returns wrapper { segments } + string ID "#67" and omits 86 & 233
          return {
            text: JSON.stringify({
              segments: [{ id: '#67', khmerText: 'ទិដ្ឋភាពភ្នែកទិព្វ' }],
            }),
          };
        }
        // Retry slice [86, 233] re-numbers relative index 1 -> repairs #86, omits #233 so single-line catches it
        return {
          text: JSON.stringify([{ id: 1, khmerText: 'អាចង្រៃនេះ,' }]),
        };
      },
    },
  };

  const queue = new ProductionJobQueue({ maxConcurrency: 1, baseUploadsDir: tmpRoot });
  queue.workerHandler = async (job, signal) =>
    runRepairBrokenSegmentsJob(job, {
      projectsDir,
      baseUploadsDir: tmpRoot,
      queue,
      signal,
      aiClient: mockAiClient,
      generateBatchTtsFn: async (subset, audioDir) =>
        subset.map((seg) => {
          const outFile = path.join(audioDir, `ep6_${seg.id}.mp3`);
          fs.writeFileSync(outFile, Buffer.from(`AUDIO_${seg.id}`));
          return {
            ...seg,
            audioPath: outFile,
            audioFile: path.basename(outFile),
            audioUrl: `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/${path.basename(outFile)}`,
            ttsStatus: 'ready',
            audioGenerated: true,
          };
        }),
      syncNarrationFn: async (_segs, fullAudioPath) => {
        fs.writeFileSync(fullAudioPath, Buffer.from('MASTER_EP6'));
      },
    });

  try {
    const { jobData } = queue.enqueueJob({
      seriesId,
      episodeId,
      mode: 'repair_broken',
      totalSegments: 3,
      config: { isRepairBroken: true },
      baseUploadsDir: tmpRoot,
    });
    await new Promise((r) => setTimeout(r, 200));

    const done = queue.getJob(jobData.jobId);
    assert.equal(done.status, JOB_STATUS.COMPLETED);
    assert.equal(done.finalResult.textFixed, 3);
    assert.equal(done.finalResult.voiceFixed, 3);
    assert.equal(done.finalResult.remainingCount, 0);
    assert.equal(fs.statSync(healthyAudio).mtimeMs, beforeMtime);

    const diskAfter = JSON.parse(fs.readFileSync(path.join(seriesDir, 'series.json'), 'utf8'));
    const segs = diskAfter.episodes[0].scriptData.segments;
    assert.equal(segs[1].khmerText, 'ទិដ្ឋភាពភ្នែកទិព្វ');
    assert.equal(segs[2].khmerText, 'អាចង្រៃនេះ,');
    assert.equal(segs[3].khmerText, 'បើមិនអញ្ចឹង តើដើរដល់ដែនដីលីងស៊ូប៉ុន្មានឆ្នាំ?');
    for (const repaired of [segs[1], segs[2], segs[3]]) {
      assert.equal(repaired.reviewNeeded, false);
      assert.equal(repaired.translationStatus, 'translated');
      assert.equal(repaired.translationWarning, null);
      assert.deepEqual(repaired.validationErrors, []);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
