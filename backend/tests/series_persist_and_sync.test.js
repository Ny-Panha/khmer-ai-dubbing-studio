const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getSeriesMetadata,
  saveSeriesMetadata,
  withSeriesMetadataLock,
  persistEpisodeScriptData,
  syncSeriesMetadataSafely,
  resetHydrationLogForTesting,
} = require('../services/episodeService');

function makeTempProjectsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_persist_test_'));
}

function makeSegments(count, prefix = 'seg') {
  return Array.from({ length: count }, (_, idx) => ({
    id: idx + 1,
    segmentId: idx + 1,
    startSec: idx * 2,
    endSec: idx * 2 + 1.5,
    chineseText: `${prefix}_zh_${idx + 1}`,
    khmerText: `${prefix}_km_${idx + 1}`,
  }));
}

function seedSeriesWithEpisodes(projectsDir, seriesId, episodeIds) {
  const episodes = episodeIds.map((id, idx) => ({
    id,
    episodeNumber: idx + 1,
    title: `ភាគទី ${idx + 1} (${id.toUpperCase()})`,
    status: 'uploaded',
    video: {
      videoId: `projects/${seriesId}/episodes/${id}/video/${id}.mp4`,
      videoUrl: `/uploads/projects/${seriesId}/episodes/${id}/video/${id}.mp4`,
      videoPath: path.join(projectsDir, seriesId, 'episodes', id, 'video', `${id}.mp4`),
    },
    scriptData: null,
  }));
  return saveSeriesMetadata({ id: seriesId, title: 'Test Series', episodes }, { projectsDir });
}

test('persistEpisodeScriptData writes exact segments to series.json and verifies disk count', async () => {
  const projectsDir = makeTempProjectsDir();
  const seriesId = 'series_persist_ok';
  try {
    seedSeriesWithEpisodes(projectsDir, seriesId, ['ep_1', 'ep_2']);
    const segments = makeSegments(12, 'ep2');

    const res = await persistEpisodeScriptData({
      seriesId,
      episodeId: 'ep_2',
      expectedSeriesId: seriesId,
      expectedEpisodeId: 'ep_2',
      scriptData: { mode: 'fast_ocr', segments },
      generationMode: 'fast_ocr',
      seriesGenre: 'modern',
      jobId: 'job_test_1',
      projectsDir,
    });

    assert.equal(res.savedCount, 12);
    assert.equal(res.seriesId, seriesId);
    assert.equal(res.episodeId, 'ep_2');

    const disk = JSON.parse(fs.readFileSync(path.join(projectsDir, seriesId, 'series.json'), 'utf8'));
    const diskEp1 = disk.episodes.find((e) => e.id === 'ep_1');
    const diskEp2 = disk.episodes.find((e) => e.id === 'ep_2');
    assert.equal(diskEp1.scriptData, null);
    assert.equal(diskEp2.scriptData.segments.length, 12);
    assert.equal(diskEp2.scriptData.totalSegments, 12);
    assert.equal(diskEp2.scriptData.hasScript, true);
    assert.equal(diskEp2.status, 'translated');
    assert.equal(disk.genre, 'modern');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('persistEpisodeScriptData fails loudly with [Persist] ERROR and both IDs on mismatch, missing episode, or post-write corruption', async () => {
  const projectsDir = makeTempProjectsDir();
  const seriesId = 'series_persist_fail';
  const origError = console.error;
  const capturedErrors = [];
  console.error = (...args) => {
    capturedErrors.push(args.map(String).join(' '));
  };

  try {
    seedSeriesWithEpisodes(projectsDir, seriesId, ['ep_1', 'ep_2']);

    // 1. Expected vs actual episode ID mismatch
    capturedErrors.length = 0;
    await assert.rejects(
      () =>
        persistEpisodeScriptData({
          seriesId,
          episodeId: 'ep_2',
          expectedSeriesId: seriesId,
          expectedEpisodeId: 'ep_1',
          scriptData: { segments: makeSegments(5) },
          jobId: 'job_mismatch',
          projectsDir,
        }),
      (err) => err.nonRetryable === true
    );
    assert.ok(
      capturedErrors.some((msg) => msg.includes('[Persist] ERROR') && msg.includes(seriesId) && msg.includes('ep_2') && msg.includes('ep_1')),
      `Expected [Persist] ERROR with both IDs, got: ${capturedErrors.join(' | ')}`
    );

    // 2. Target episode missing from existing series.json
    capturedErrors.length = 0;
    await assert.rejects(
      () =>
        persistEpisodeScriptData({
          seriesId,
          episodeId: 'ep_99',
          scriptData: { segments: makeSegments(5) },
          jobId: 'job_missing_ep',
          projectsDir,
        }),
      (err) => err.nonRetryable === true
    );
    assert.ok(
      capturedErrors.some((msg) => msg.includes('[Persist] ERROR') && msg.includes(seriesId) && msg.includes('ep_99')),
      `Expected [Persist] ERROR with seriesId and missing episodeId, got: ${capturedErrors.join(' | ')}`
    );

    // 3. Post-write disk verification catches truncated segments on disk
    capturedErrors.length = 0;
    await assert.rejects(
      () =>
        persistEpisodeScriptData({
          seriesId,
          episodeId: 'ep_2',
          scriptData: { segments: makeSegments(10) },
          jobId: 'job_corrupt_disk',
          projectsDir,
          _afterWriteHook: async ({ metaPath }) => {
            const corrupted = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const ep = corrupted.episodes.find((e) => e.id === 'ep_2');
            ep.scriptData.segments = ep.scriptData.segments.slice(0, 3);
            fs.writeFileSync(metaPath, JSON.stringify(corrupted), 'utf8');
          },
        }),
      /verification mismatch/i
    );
    assert.ok(
      capturedErrors.some(
        (msg) =>
          msg.includes('[Persist] ERROR') &&
          msg.includes(seriesId) &&
          msg.includes('ep_2') &&
          msg.includes('expectedSegments=10') &&
          msg.includes('diskSegments=3')
      ),
      `Expected [Persist] ERROR with count mismatch & IDs, got: ${capturedErrors.join(' | ')}`
    );
  } finally {
    console.error = origError;
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('concurrent batch persists + concurrent stale /sync offloads never lost-update or wipe sibling episodes', async () => {
  const projectsDir = makeTempProjectsDir();
  const seriesId = 'series_concurrent_mutex';
  try {
    seedSeriesWithEpisodes(projectsDir, seriesId, ['ep_1', 'ep_2', 'ep_3', 'ep_4']);

    const persistPromises = [
      persistEpisodeScriptData({ seriesId, episodeId: 'ep_1', scriptData: { segments: makeSegments(120, 'e1') }, projectsDir }),
      persistEpisodeScriptData({ seriesId, episodeId: 'ep_2', scriptData: { segments: makeSegments(250, 'e2') }, projectsDir }),
      persistEpisodeScriptData({ seriesId, episodeId: 'ep_3', scriptData: { segments: makeSegments(336, 'e3') }, projectsDir }),
      persistEpisodeScriptData({ seriesId, episodeId: 'ep_4', scriptData: { segments: makeSegments(95, 'e4') }, projectsDir }),
    ];

    // Stale frontend /sync payloads sending offloaded segments: [] for inactive episodes + partial audio flags
    const staleSyncPayload = {
      id: seriesId,
      title: 'Updated Title Via UI',
      episodes: [
        { id: 'ep_1', episodeNumber: 1, title: 'EP1', audioGenerated: true, fullAudioUrl: '/uploads/ep_1.mp3', scriptData: { hasScript: true, totalSegments: 120, segments: [], updatedAt: 100 } },
        { id: 'ep_2', episodeNumber: 2, title: 'EP2', status: 'uploaded', scriptData: null },
        { id: 'ep_3', episodeNumber: 3, title: 'EP3', status: 'translated', scriptData: { hasScript: true, totalSegments: 336, segments: [], updatedAt: 100 } },
        { id: 'ep_4', episodeNumber: 4, title: 'EP4', scriptData: { hasScript: true, totalSegments: 1, segments: makeSegments(1, 'stale'), updatedAt: 50 } },
      ],
    };

    const syncPromises = [
      syncSeriesMetadataSafely(seriesId, staleSyncPayload, { projectsDir }),
      syncSeriesMetadataSafely(seriesId, staleSyncPayload, { projectsDir }),
      withSeriesMetadataLock(seriesId, () => {
        const s = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
        const ep2 = s.episodes.find((e) => e.id === 'ep_2');
        ep2.bgmAudioUrl = '/uploads/ep_2_bgm.wav';
        saveSeriesMetadata(s, { projectsDir });
      }, { projectsDir }),
    ];

    await Promise.all([...persistPromises, ...syncPromises]);

    const finalDisk = JSON.parse(fs.readFileSync(path.join(projectsDir, seriesId, 'series.json'), 'utf8'));
    const counts = Object.fromEntries(
      finalDisk.episodes.map((e) => [e.id, e.scriptData?.segments?.length || 0])
    );
    assert.deepEqual(counts, { ep_1: 120, ep_2: 250, ep_3: 336, ep_4: 95 });
    assert.equal(finalDisk.episodes.find((e) => e.id === 'ep_1').audioGenerated, true);
    assert.equal(finalDisk.episodes.find((e) => e.id === 'ep_2').bgmAudioUrl, '/uploads/ep_2_bgm.wav');
    assert.equal(finalDisk.title, 'Updated Title Via UI');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('getSeriesMetadata hydration safety net recovers completed job segments and logs once per episode', () => {
  const projectsDir = makeTempProjectsDir();
  const seriesId = 'series_hydration_test';
  const origLog = console.log;
  const capturedLogs = [];
  console.log = (...args) => {
    capturedLogs.push(args.map(String).join(' '));
  };

  try {
    resetHydrationLogForTesting();
    seedSeriesWithEpisodes(projectsDir, seriesId, ['ep_1']);
    const epJobsDir = path.join(projectsDir, seriesId, 'episodes', 'ep_1', 'jobs');
    fs.mkdirSync(epJobsDir, { recursive: true });
    fs.writeFileSync(
      path.join(epJobsDir, 'job_1000.json'),
      JSON.stringify({
        jobId: 'job_1000',
        status: 'completed',
        completedAt: 1700000000000,
        config: { mode: 'fast_ocr', generationMode: 'fast_ocr' },
        finalResult: { segments: makeSegments(42, 'hydrated') },
      }),
      'utf8'
    );

    // First disk read recovers and persists segments to series.json + logs once
    const first = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(first.episodes[0].scriptData.segments.length, 42);
    const hydrationLogsFirst = capturedLogs.filter((l) => l.includes('[Hydration]') && l.includes('ep_1'));
    assert.equal(hydrationLogsFirst.length, 1);

    // Even if disk segments were cleared again in-session, repeated hydration logs at most once per episode
    const raw = JSON.parse(fs.readFileSync(path.join(projectsDir, seriesId, 'series.json'), 'utf8'));
    raw.episodes[0].scriptData = null;
    fs.writeFileSync(path.join(projectsDir, seriesId, 'series.json'), JSON.stringify(raw), 'utf8');

    const second = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(second.episodes[0].scriptData.segments.length, 42);
    const hydrationLogsTotal = capturedLogs.filter((l) => l.includes('[Hydration]') && l.includes('ep_1'));
    assert.equal(hydrationLogsTotal.length, 1);
  } finally {
    console.log = origLog;
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('frontend GeminiRouteModal honesty helpers derive strictly from stored episode segments', async () => {
  const helpers = await import('../../frontend/src/components/dashboard/geminiRouteHelpers.js');
  const {
    checkEpisodeHasScript,
    getEpisodeSegmentCount,
    isJobCompletedSegmentsMissing,
    computeSeriesTranslateSummary,
  } = helpers;

  // Completed job on disk/SSE, plus stale flags, but stored segments array is empty -> must report false / 0 / missing
  const unsavedEp = {
    id: 'ep_7',
    episodeNumber: 7,
    status: 'translated',
    video: { videoUrl: '/v/ep_7.mp4' },
    scriptData: { hasScript: true, totalSegments: 336, segments: [] },
  };
  const completedJob = {
    jobId: 'job_ep7',
    episodeId: 'ep_7',
    status: 'completed',
    totalSegments: 336,
    finalResult: { segments: makeSegments(336, 'job') },
  };

  assert.equal(checkEpisodeHasScript(unsavedEp), false);
  assert.equal(getEpisodeSegmentCount(unsavedEp), 0);
  assert.equal(isJobCompletedSegmentsMissing(unsavedEp, completedJob), true);

  // Stored segments populated -> honest true / 336 / not missing
  const savedEp = {
    id: 'ep_3',
    episodeNumber: 3,
    status: 'translated',
    video: { videoUrl: '/v/ep_3.mp4' },
    scriptData: { hasScript: true, totalSegments: 336, segments: makeSegments(336, 'saved') },
  };
  assert.equal(checkEpisodeHasScript(savedEp), true);
  assert.equal(getEpisodeSegmentCount(savedEp), 336);
  assert.equal(isJobCompletedSegmentsMissing(savedEp, { ...completedJob, episodeId: 'ep_3' }), false);

  // Simulate the exact live symptom (11 episodes: 6 saved, 4 completed-job-not-saved, 1 idle)
  const episodes = [];
  const jobsMap = new Map();
  for (let i = 1; i <= 11; i++) {
    const id = `ep_${i}`;
    if (i <= 6) {
      episodes.push({
        id,
        episodeNumber: i,
        video: { videoUrl: `/v/${id}.mp4` },
        scriptData: { segments: makeSegments(i === 3 ? 336 : 100) },
      });
      jobsMap.set(id, { episodeId: id, status: 'completed', totalSegments: i === 3 ? 336 : 100 });
    } else if (i <= 10) {
      episodes.push({
        id,
        episodeNumber: i,
        status: 'translated',
        video: { videoUrl: `/v/${id}.mp4` },
        scriptData: { hasScript: true, totalSegments: 336, segments: [] },
      });
      jobsMap.set(id, { episodeId: id, status: 'completed', totalSegments: 336 });
    } else {
      episodes.push({
        id,
        episodeNumber: i,
        status: 'uploaded',
        video: { videoUrl: `/v/${id}.mp4` },
        scriptData: null,
      });
    }
  }

  const summary = computeSeriesTranslateSummary(episodes, jobsMap);
  assert.equal(summary.totalEpisodes, 11);
  assert.equal(summary.completedCount, 6);
  assert.equal(summary.remainingCount, 5);
  assert.equal(summary.unsavedCompletedJobsCount, 4);
  assert.equal(summary.isTranslateAllDone, false);
});

test('syncSeriesMetadataSafely rejects stale timestamps, accepts newer edits, and preserves omitted episodes', async () => {
  const projectsDir = makeTempProjectsDir();
  const seriesId = 'series_sync_timestamp_guard';
  try {
    seedSeriesWithEpisodes(projectsDir, seriesId, ['ep_1', 'ep_2']);

    await persistEpisodeScriptData({
      seriesId,
      episodeId: 'ep_1',
      scriptData: { mode: 'fast_ocr', segments: makeSegments(45, 'fresh_disk') },
      projectsDir,
    });

    const diskAfterPersist = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    const diskUpdatedAt = Number(diskAfterPersist.episodes[0].scriptData.updatedAt || 0);
    assert.ok(diskUpdatedAt > 0);

    // 1. Payload with incUpdatedAt === 0 or < diskUpdatedAt must NOT overwrite disk segments
    await syncSeriesMetadataSafely(
      seriesId,
      {
        id: seriesId,
        episodes: [
          {
            id: 'ep_1',
            episodeNumber: 1,
            scriptData: { mode: 'dialogue', segments: makeSegments(2, 'stale_zero'), updatedAt: 0 },
          },
          {
            id: 'ep_2',
            episodeNumber: 2,
            scriptData: null,
          },
        ],
      },
      { projectsDir }
    );
    let current = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(current.episodes[0].scriptData.segments.length, 45);
    assert.equal(current.episodes[0].scriptData.segments[0].khmerText, 'fresh_disk_km_1');

    // 2. Older non-zero timestamp must also NOT overwrite disk segments
    await syncSeriesMetadataSafely(
      seriesId,
      {
        id: seriesId,
        episodes: [
          {
            id: 'ep_1',
            episodeNumber: 1,
            scriptData: { mode: 'dialogue', segments: makeSegments(3, 'older_ts'), updatedAt: diskUpdatedAt - 10 },
          },
        ],
      },
      { projectsDir }
    );
    current = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(current.episodes.length, 2, 'Omitted ep_2 on partial payload must be preserved');
    assert.equal(current.episodes[0].scriptData.segments.length, 45);

    // 3. Newer timestamp (> diskUpdatedAt) MUST persist user edits cleanly
    const newerTs = diskUpdatedAt + 5000;
    await syncSeriesMetadataSafely(
      seriesId,
      {
        id: seriesId,
        episodes: [
          {
            id: 'ep_1',
            episodeNumber: 1,
            scriptData: { mode: 'fast_ocr', segments: makeSegments(44, 'user_edited'), updatedAt: newerTs },
          },
        ],
      },
      { projectsDir }
    );
    current = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(current.episodes[0].scriptData.segments.length, 44);
    assert.equal(current.episodes[0].scriptData.segments[0].khmerText, 'user_edited_km_1');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('HTTP POST /api/series/:seriesId/sync + parallel persistEpisodeScriptData never lost-update under concurrent requests', async () => {
  const express = require('express');
  const http = require('http');

  const tempUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_http_uploads_'));
  const tempProjectsDir = path.join(tempUploadsDir, 'projects');
  fs.mkdirSync(tempProjectsDir, { recursive: true });

  const pathUtilsPath = require.resolve('../utils/pathUtils');
  const episodeServicePath = require.resolve('../services/episodeService');
  const seriesRoutesPath = require.resolve('../routes/seriesRoutes');

  const savedCache = new Map([
    [pathUtilsPath, require.cache[pathUtilsPath]],
    [episodeServicePath, require.cache[episodeServicePath]],
    [seriesRoutesPath, require.cache[seriesRoutesPath]],
  ]);

  let server;
  try {
    const realPathUtils = require('../utils/pathUtils');
    require.cache[pathUtilsPath] = {
      id: pathUtilsPath,
      filename: pathUtilsPath,
      loaded: true,
      exports: {
        ...realPathUtils,
        uploadsDir: tempUploadsDir,
      },
    };
    delete require.cache[episodeServicePath];
    delete require.cache[seriesRoutesPath];

    const isolatedEpisodeService = require('../services/episodeService');
    const isolatedSeriesRoutes = require('../routes/seriesRoutes');

    const seriesId = 'series_http_parallel';
    const epIds = ['ep_1', 'ep_2', 'ep_3', 'ep_4'];
    isolatedEpisodeService.saveSeriesMetadata(
      {
        id: seriesId,
        title: 'Parallel HTTP Test',
        episodes: epIds.map((id, idx) => ({
          id,
          episodeNumber: idx + 1,
          title: `EP${idx + 1}`,
          status: 'uploaded',
          video: { videoUrl: `/uploads/projects/${seriesId}/episodes/${id}/video/${id}.mp4` },
          scriptData: null,
        })),
      },
      { projectsDir: tempProjectsDir }
    );

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/series', isolatedSeriesRoutes);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Run 4 parallel backend persists concurrently with 3 UI POST /sync requests (stale offloads + title update)
    const staleUiBody = {
      series: {
        id: seriesId,
        title: 'Parallel HTTP Renamed',
        episodes: [
          { id: 'ep_1', episodeNumber: 1, audioGenerated: true, scriptData: { hasScript: true, totalSegments: 120, segments: [], updatedAt: 100 } },
          { id: 'ep_2', episodeNumber: 2, scriptData: null },
          { id: 'ep_3', episodeNumber: 3, scriptData: { hasScript: true, totalSegments: 336, segments: [], updatedAt: 100 } },
          { id: 'ep_4', episodeNumber: 4, scriptData: { hasScript: true, totalSegments: 2, segments: makeSegments(2, 'stale_ui'), updatedAt: 100 } },
        ],
      },
    };

    const persistTasks = [
      isolatedEpisodeService.persistEpisodeScriptData({ seriesId, episodeId: 'ep_1', scriptData: { mode: 'fast_ocr', segments: makeSegments(120, 'p1') }, projectsDir: tempProjectsDir }),
      new Promise((r) => setTimeout(r, 5)).then(() =>
        isolatedEpisodeService.persistEpisodeScriptData({ seriesId, episodeId: 'ep_2', scriptData: { mode: 'fast_ocr', segments: makeSegments(250, 'p2') }, projectsDir: tempProjectsDir })
      ),
      new Promise((r) => setTimeout(r, 10)).then(() =>
        isolatedEpisodeService.persistEpisodeScriptData({ seriesId, episodeId: 'ep_3', scriptData: { mode: 'fast_ocr', segments: makeSegments(336, 'p3') }, projectsDir: tempProjectsDir })
      ),
      new Promise((r) => setTimeout(r, 15)).then(() =>
        isolatedEpisodeService.persistEpisodeScriptData({ seriesId, episodeId: 'ep_4', scriptData: { mode: 'fast_ocr', segments: makeSegments(95, 'p4') }, projectsDir: tempProjectsDir })
      ),
    ];

    const httpSyncTasks = [0, 5, 10, 15].map((delayMs) =>
      new Promise((r) => setTimeout(r, delayMs)).then(() =>
        fetch(`${baseUrl}/api/series/${seriesId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(staleUiBody),
        }).then(async (res) => {
          assert.equal(res.status, 200);
          return res.json();
        })
      )
    );

    await Promise.all([...persistTasks, ...httpSyncTasks]);

    // Trailing stale HTTP /sync after completion must still be blocked by timestamp & offload guards
    const trailingSync = await fetch(`${baseUrl}/api/series/${seriesId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(staleUiBody),
    });
    assert.equal(trailingSync.status, 200);

    const getRes = await fetch(`${baseUrl}/api/series/${seriesId}`);
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.success, true);
    assert.equal(getJson.series.title, 'Parallel HTTP Renamed');

    const counts = Object.fromEntries(
      getJson.series.episodes.map((e) => [e.id, e.scriptData?.segments?.length || 0])
    );
    assert.deepEqual(counts, { ep_1: 120, ep_2: 250, ep_3: 336, ep_4: 95 });
    assert.equal(getJson.series.episodes.find((e) => e.id === 'ep_1').audioGenerated, true);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    for (const [key, entry] of savedCache.entries()) {
      if (entry) require.cache[key] = entry;
      else delete require.cache[key];
    }
    fs.rmSync(tempUploadsDir, { recursive: true, force: true });
  }
});

test('frontend GeminiRouteModal Task 2 partition & clamped stage percentage helpers', async () => {
  const helpers = await import('../../frontend/src/components/dashboard/geminiRouteHelpers.js');
  const {
    partitionSelectedEpisodesForTranslate,
    computeClampedStagePercent,
    computeSeriesTranslateSummary,
  } = helpers;

  // 1. Clamped percent invariants (never >100, never negative, handles 0/0 & NaN)
  assert.equal(computeClampedStagePercent(0, 0), 0);
  assert.equal(computeClampedStagePercent(0, 11), 0);
  assert.equal(computeClampedStagePercent(6, 11), 55);
  assert.equal(computeClampedStagePercent(11, 11), 100);
  assert.equal(computeClampedStagePercent(99, 11), 100, 'Overflow count must clamp strictly at 100%');
  assert.equal(computeClampedStagePercent(-3, 11), 0, 'Negative count must clamp strictly at 0%');
  assert.equal(computeClampedStagePercent(NaN, 11), 0);

  // 2. Partition selected episodes strictly from stored scriptData.segments (ignoring stale job/status flags)
  const mixSelection = [
    { id: 'ep_1', status: 'translated', scriptData: { segments: makeSegments(50, 'e1') } },
    { id: 'ep_2', status: 'translated', scriptData: { hasScript: true, totalSegments: 336, segments: [] } }, // unsaved segments -> MUST be treated as unscripted!
    { id: 'ep_3', status: 'translated', scriptData: { segments: makeSegments(336, 'e3') } },
  ];
  const partitionedMix = partitionSelectedEpisodesForTranslate(mixSelection);
  assert.deepEqual(partitionedMix.scriptedEpisodes.map((e) => e.id), ['ep_1', 'ep_3']);
  assert.deepEqual(partitionedMix.unscriptedEpisodes.map((e) => e.id), ['ep_2']);

  // All 11 finished -> 0 unscripted, 11 scripted, summary translatePercent == 100
  const all11 = Array.from({ length: 11 }, (_, idx) => ({
    id: `ep_${idx + 2}`,
    episodeNumber: idx + 1,
    video: { videoUrl: `/v/ep_${idx + 2}.mp4` },
    scriptData: { segments: makeSegments(100, `ep${idx + 2}`) },
  }));
  const partitionedAll11 = partitionSelectedEpisodesForTranslate(all11);
  assert.equal(partitionedAll11.unscriptedEpisodes.length, 0);
  assert.equal(partitionedAll11.scriptedEpisodes.length, 11);

  const summary11 = computeSeriesTranslateSummary(all11, new Map());
  assert.equal(summary11.completedCount, 11);
  assert.equal(summary11.translatePercent, 100);
});

test('POST /api/jobs/generate runs 2 parallel jobs to persisted Editor truth, blocks force:false duplicates, and force:true creates backups + overwrites', async () => {
  const express = require('express');
  const http = require('http');

  const tempUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_jobs_e2e_'));
  const tempProjectsDir = path.join(tempUploadsDir, 'projects');
  fs.mkdirSync(tempProjectsDir, { recursive: true });

  const modulePaths = [
    require.resolve('../utils/pathUtils'),
    require.resolve('../services/episodeService'),
    require.resolve('../services/ffmpegService'),
    require.resolve('../services/pipeline/productionJobQueue'),
    require.resolve('../services/pipeline/checkpointManager'),
    require.resolve('../services/pipeline/segmentLedger'),
    require.resolve('../services/pipeline/recoveryEngine'),
    require.resolve('../services/pipeline/jobManager'),
    require.resolve('../services/pipeline/index'),
    require.resolve('../services/pipeline/jobWorker'),
    require.resolve('../routes/jobRoutes'),
    require.resolve('../routes/seriesRoutes'),
  ];
  const savedCache = new Map(modulePaths.map((p) => [p, require.cache[p]]));

  let server;
  let isolatedQueue;
  try {
    const realPathUtils = require('../utils/pathUtils');
    const realFfmpegService = require('../services/ffmpegService');

    require.cache[require.resolve('../utils/pathUtils')] = {
      id: require.resolve('../utils/pathUtils'),
      filename: require.resolve('../utils/pathUtils'),
      loaded: true,
      exports: {
        ...realPathUtils,
        uploadsDir: tempUploadsDir,
        resolveMediaFile: (rawRef) => {
          if (!rawRef) return null;
          if (path.isAbsolute(rawRef) && fs.existsSync(rawRef)) return rawRef;
          const candidate = path.join(tempUploadsDir, String(rawRef).replace(/^\/+uploads[\\/]/, ''));
          return fs.existsSync(candidate) ? candidate : null;
        },
      },
    };
    require.cache[require.resolve('../services/ffmpegService')] = {
      id: require.resolve('../services/ffmpegService'),
      filename: require.resolve('../services/ffmpegService'),
      loaded: true,
      exports: {
        ...realFfmpegService,
        getMediaDuration: async () => 60,
      },
    };

    for (const p of modulePaths.slice(1)) {
      if (p !== require.resolve('../services/ffmpegService')) {
        delete require.cache[p];
      }
    }

    const isolatedEpisodeService = require('../services/episodeService');
    const { productionJobQueue, JOB_STATUS } = require('../services/pipeline/productionJobQueue');
    isolatedQueue = productionJobQueue;
    isolatedQueue.setMaxConcurrency(2);

    const seriesId = 'series_parallel_e2e';
    const ep1Dir = path.join(tempProjectsDir, seriesId, 'episodes', 'ep_1', 'video');
    const ep2Dir = path.join(tempProjectsDir, seriesId, 'episodes', 'ep_2', 'video');
    fs.mkdirSync(ep1Dir, { recursive: true });
    fs.mkdirSync(ep2Dir, { recursive: true });
    const ep1Video = path.join(ep1Dir, 'ep_1.mp4');
    const ep2Video = path.join(ep2Dir, 'ep_2.mp4');
    fs.writeFileSync(ep1Video, Buffer.alloc(1024, 1));
    fs.writeFileSync(ep2Video, Buffer.alloc(1024, 2));

    isolatedEpisodeService.saveSeriesMetadata({
      id: seriesId,
      title: 'Parallel Batch & Re-Translate Test',
      episodes: [
        {
          id: 'ep_1',
          episodeNumber: 1,
          title: 'EP1',
          status: 'uploaded',
          video: { videoId: ep1Video, videoPath: ep1Video, videoUrl: `/uploads/projects/${seriesId}/episodes/ep_1/video/ep_1.mp4` },
          scriptData: null,
        },
        {
          id: 'ep_2',
          episodeNumber: 2,
          title: 'EP2',
          status: 'uploaded',
          video: { videoId: ep2Video, videoPath: ep2Video, videoUrl: `/uploads/projects/${seriesId}/episodes/ep_2/video/ep_2.mp4` },
          scriptData: null,
        },
      ],
    });

    let activeCount = 0;
    let maxParallelObserved = 0;
    let runVersionEp1 = 0;

    isolatedQueue.registerWorkerHandler(async (job) => {
      activeCount += 1;
      maxParallelObserved = Math.max(maxParallelObserved, activeCount);
      try {
        await new Promise((r) => setTimeout(r, 40));
        const isEp1 = job.episodeId === 'ep_1';
        if (isEp1) runVersionEp1 += 1;
        const count = isEp1 ? (runVersionEp1 === 1 ? 18 : 31) : 24;
        const tag = isEp1 ? `ep1_v${runVersionEp1}` : 'ep2_v1';
        const segs = makeSegments(count, tag);

        await isolatedEpisodeService.persistEpisodeScriptData({
          seriesId: job.seriesId,
          episodeId: job.episodeId,
          expectedSeriesId: job.seriesId,
          expectedEpisodeId: job.episodeId,
          scriptData: { mode: 'fast_ocr', generationMode: 'fast_ocr', segments: segs },
          generationMode: 'fast_ocr',
          jobId: job.jobId,
        });

        return {
          success: true,
          mode: 'fast_ocr',
          generationMode: 'fast_ocr',
          totalSegments: segs.length,
          segments: segs,
        };
      } finally {
        activeCount -= 1;
      }
    });

    const jobRoutes = require('../routes/jobRoutes');
    const seriesRoutes = require('../routes/seriesRoutes');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobRoutes);
    app.use('/api/series', seriesRoutes);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 1. Trigger 2 parallel jobs (force: false) -> both enqueue and run in parallel
    const [r1, r2] = await Promise.all([
      fetch(`${baseUrl}/api/jobs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId, episodeId: 'ep_1', videoPath: ep1Video, mode: 'fast_ocr', force: false, apiKey: 'AIzaTestKey123456' }),
      }).then((r) => r.json()),
      fetch(`${baseUrl}/api/jobs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId, episodeId: 'ep_2', videoPath: ep2Video, mode: 'fast_ocr', force: false, apiKey: 'AIzaTestKey123456' }),
      }).then((r) => r.json()),
    ]);
    assert.equal(r1.success, true);
    assert.equal(r2.success, true);

    const waitForJobDone = async (jobId) => {
      for (let i = 0; i < 60; i++) {
        const j = isolatedQueue.getJob(jobId);
        if (j && (j.status === JOB_STATUS.COMPLETED || j.status === JOB_STATUS.FAILED)) return j;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`Timed out waiting for ${jobId}`);
    };
    const [done1, done2] = await Promise.all([waitForJobDone(r1.jobId), waitForJobDone(r2.jobId)]);
    assert.equal(done1.status, JOB_STATUS.COMPLETED);
    assert.equal(done2.status, JOB_STATUS.COMPLETED);
    assert.equal(maxParallelObserved, 2, 'Both jobs must execute in parallel');

    let seriesRes = await fetch(`${baseUrl}/api/series/${seriesId}`).then((r) => r.json());
    assert.equal(seriesRes.series.episodes.find((e) => e.id === 'ep_1').scriptData.segments.length, 18);
    assert.equal(seriesRes.series.episodes.find((e) => e.id === 'ep_2').scriptData.segments.length, 24);

    // 2. Non-force submit on completed ep_1 must return 409 alreadyCompleted
    const blockedRes = await fetch(`${baseUrl}/api/jobs/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId, episodeId: 'ep_1', videoPath: ep1Video, mode: 'fast_ocr', force: false, apiKey: 'AIzaTestKey123456' }),
    });
    assert.equal(blockedRes.status, 409);
    const blockedJson = await blockedRes.json();
    assert.equal(blockedJson.alreadyCompleted, true);

    // 3. Explicit force: true on ep_1 creates auto-backups AND replaces segments upon completion
    const reRunRes = await fetch(`${baseUrl}/api/jobs/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId, episodeId: 'ep_1', videoPath: ep1Video, mode: 'fast_ocr', force: true, apiKey: 'AIzaTestKey123456' }),
    });
    assert.equal(reRunRes.status, 200);
    const reRunJson = await reRunRes.json();
    assert.equal(reRunJson.success, true);

    const ep1BackupsDir = path.join(tempProjectsDir, seriesId, 'episodes', 'ep_1', 'backups');
    const ep1BackupFiles = fs.readdirSync(ep1BackupsDir).filter((f) => f.startsWith('script_backup_'));
    const seriesBackups = fs.readdirSync(path.join(tempProjectsDir, seriesId)).filter((f) => f.startsWith('series.json.backup_'));
    assert.ok(ep1BackupFiles.length >= 1, 'Expected script_backup_*.json before overwrite');
    assert.ok(seriesBackups.length >= 1, 'Expected series.json.backup_* before overwrite');

    const backupData = JSON.parse(fs.readFileSync(path.join(ep1BackupsDir, ep1BackupFiles[0]), 'utf8'));
    assert.equal(backupData.segments.length, 18, 'Backup must preserve prior 18 segments');

    const doneReRun = await waitForJobDone(reRunJson.jobId);
    assert.equal(doneReRun.status, JOB_STATUS.COMPLETED);

    seriesRes = await fetch(`${baseUrl}/api/series/${seriesId}`).then((r) => r.json());
    assert.equal(seriesRes.series.episodes.find((e) => e.id === 'ep_1').scriptData.segments.length, 31);
    assert.equal(seriesRes.series.episodes.find((e) => e.id === 'ep_1').scriptData.segments[0].khmerText, 'ep1_v2_km_1');
    assert.equal(seriesRes.series.episodes.find((e) => e.id === 'ep_2').scriptData.segments.length, 24);
  } finally {
    if (isolatedQueue) {
      isolatedQueue.registerWorkerHandler(null);
      if (typeof isolatedQueue.clearMemoryForTesting === 'function') {
        isolatedQueue.clearMemoryForTesting();
      }
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    for (const [key, entry] of savedCache.entries()) {
      if (entry) require.cache[key] = entry;
      else delete require.cache[key];
    }
    fs.rmSync(tempUploadsDir, { recursive: true, force: true });
  }
});

test('frontend checkEpisodeHasAudioReady respects audioOutdated over stale DONE/localStorage flags', async () => {
  const helpers = await import('../../frontend/src/components/dashboard/geminiRouteHelpers.js');
  const { checkEpisodeHasAudioReady, checkEpisodeHasDemucsReady } = helpers;

  const poisonedCompletedSet = new Set(['ep_2', 'ep_3', 'ep_11']);

  // Stale audioGenerated/fullAudioUrl + poisoned completedTtsEpIds must STILL return false when audioOutdated is true
  const outdatedEpWithStaleFlags = {
    id: 'ep_2',
    audioGenerated: true,
    hasAudio: true,
    audioOutdated: true,
    fullAudioUrl: '/uploads/old_ep2.mp3',
  };
  assert.equal(checkEpisodeHasAudioReady(outdatedEpWithStaleFlags, poisonedCompletedSet, {}), false);

  // Typical invalidated episode on server (8 affected episodes) -> must return false even with poisoned Set
  const outdatedServerEp = {
    id: 'ep_3',
    audioGenerated: false,
    hasAudio: false,
    audioOutdated: true,
    fullAudioUrl: null,
  };
  assert.equal(checkEpisodeHasAudioReady(outdatedServerEp, poisonedCompletedSet, {}), false);

  // Up-to-date live TTS completion in current session overrides old flag until server refresh lands
  assert.equal(checkEpisodeHasAudioReady(outdatedServerEp, poisonedCompletedSet, { ep_3: { isDone: true } }), true);

  // Clean completed episode (not outdated) -> true
  const readyEp = {
    id: 'ep_11',
    audioGenerated: true,
    hasAudio: true,
    audioOutdated: false,
    fullAudioUrl: '/uploads/ep_11.mp3',
  };
  assert.equal(checkEpisodeHasAudioReady(readyEp, new Set(), {}), true);
  assert.equal(checkEpisodeHasDemucsReady({ id: 'ep_11', isDemucsDone: true }, new Set(), {}), true);
});

test('frontend projectStorage.saveEpisodeState never revives stale audioGenerated over explicit audioOutdated invalidation, and backend syncSeriesMetadataSafely preserves disk invalidation', async () => {
  // 1. Frontend projectStorage localStorage round-trip check
  const store = new Map();
  const prevLocalStorage = global.localStorage;
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    get length() { return store.size; },
    key: (idx) => Array.from(store.keys())[idx] ?? null,
  };

  try {
    const storage = await import('../../frontend/src/utils/projectStorage.js');
    const seriesId = 'series_storage_test';
    const initialSeries = {
      id: seriesId,
      title: 'Storage Test',
      createdAt: Date.now(),
      glossary: { characters: [], terms: [] },
      episodes: [
        {
          id: 'ep_2',
          episodeNumber: 2,
          title: 'EP2',
          audioGenerated: true,
          hasAudio: true,
          audioOutdated: false,
          fullAudioUrl: '/uploads/old_ep2.mp3',
          fullAudioPath: '/abs/old_ep2.mp3',
          scriptData: { mode: 'fast_ocr', segments: makeSegments(5, 'old'), updatedAt: 1000 },
        },
      ],
    };
    storage.saveSeriesList([initialSeries]);
    storage.setActiveSeriesId(seriesId);
    storage.setActiveEpisodeId('ep_2');

    // Simulate Studio auto-save after server hydrated ep_2 as invalidated (audioGenerated: false, audioOutdated: true, fullAudioUrl: null)
    storage.saveEpisodeState(seriesId, 'ep_2', {
      audioGenerated: false,
      audioOutdated: true,
      fullAudioUrl: null,
      fullAudioPath: null,
    });
    const afterInvalidation = storage.loadSeriesList()[0].episodes[0];
    assert.equal(afterInvalidation.audioGenerated, false, 'stale prevEp.audioGenerated must not revive');
    assert.equal(afterInvalidation.hasAudio, false);
    assert.equal(afterInvalidation.audioOutdated, true);
    assert.equal(afterInvalidation.fullAudioUrl, null);

    // Partial patch without audio fields must preserve current non-outdated generated state
    storage.saveEpisodeState(seriesId, 'ep_2', {
      audioGenerated: true,
      audioOutdated: false,
      fullAudioUrl: '/uploads/fresh_ep2.mp3',
    });
    storage.saveEpisodeState(seriesId, 'ep_2', { renderedVideo: null });
    const afterPartial = storage.loadSeriesList()[0].episodes[0];
    assert.equal(afterPartial.audioGenerated, true);
    assert.equal(afterPartial.audioOutdated, false);
    assert.equal(afterPartial.fullAudioUrl, '/uploads/fresh_ep2.mp3');
  } finally {
    if (prevLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = prevLocalStorage;
  }

  // 2. Backend syncSeriesMetadataSafely refuses stale localStorage audioGenerated=true when disk ep is audioOutdated=true & audioGenerated=false
  const projectsDir = makeTempProjectsDir();
  const seriesId = 'series_sync_audio_outdated_guard';
  try {
    seedSeriesWithEpisodes(projectsDir, seriesId, ['ep_2']);
    const s = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    s.episodes[0].audioGenerated = false;
    s.episodes[0].hasAudio = false;
    s.episodes[0].audioOutdated = true;
    s.episodes[0].fullAudioUrl = null;
    s.episodes[0].scriptData = { mode: 'fast_ocr', segments: makeSegments(5, 'repaired'), updatedAt: 5000 };
    saveSeriesMetadata(s, { projectsDir });

    await syncSeriesMetadataSafely(
      seriesId,
      {
        id: seriesId,
        episodes: [
          {
            id: 'ep_2',
            episodeNumber: 2,
            audioGenerated: true,
            hasAudio: true,
            audioOutdated: false,
            fullAudioUrl: '/uploads/stale_ep2.mp3',
            scriptData: { mode: 'fast_ocr', segments: [], updatedAt: 1000 },
          },
        ],
      },
      { projectsDir }
    );

    const refreshed = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(refreshed.episodes[0].audioGenerated, false);
    assert.equal(refreshed.episodes[0].hasAudio, false);
    assert.equal(refreshed.episodes[0].audioOutdated, true);
    assert.equal(refreshed.episodes[0].fullAudioUrl, null);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('Mock renderedVideo sanitization: strips mock_render.mp4 on disk hydration, /sync, and browser localStorage', async () => {
  const { sanitizeRenderedVideoRef } = require('../services/episodeService');
  assert.equal(
    sanitizeRenderedVideoRef({
      success: true,
      videoUrl: '/uploads/mock_render.mp4',
      outputVideoUrl: '/uploads/mock_render.mp4',
      outputFilename: 'mock_16-9.mp4',
      downloadUrl: '/uploads/mock_render.mp4',
    }),
    null
  );
  assert.ok(
    sanitizeRenderedVideoRef({
      success: true,
      videoUrl: '/uploads/projects/s1/episodes/ep_1/video/final.mp4',
      outputVideoUrl: '/uploads/projects/s1/episodes/ep_1/video/final.mp4',
      outputFilename: 'final.mp4',
    }),
    'Real rendered video URL must be preserved when checkDisk=false'
  );

  const projectsDir = makeTempProjectsDir();
  const seriesId = 'series_mock_render_guard';
  try {
    seedSeriesWithEpisodes(projectsDir, seriesId, ['ep_2']);
    const s = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    s.episodes[0].status = 'completed';
    s.episodes[0].scriptData = { mode: 'fast_ocr', segments: makeSegments(3, 'real'), updatedAt: 5000 };
    s.episodes[0].renderedVideo = {
      success: true,
      videoUrl: '/uploads/mock_render.mp4',
      outputVideoUrl: '/uploads/mock_render.mp4',
      outputFilename: 'mock_16-9.mp4',
    };
    saveSeriesMetadata(s, { projectsDir });

    const hydrated = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(hydrated.episodes[0].renderedVideo, null, 'Disk hydration must strip mock_render.mp4');
    assert.equal(hydrated.episodes[0].status, 'translated', 'Status must downgrade from completed when mock render removed');

    await syncSeriesMetadataSafely(
      seriesId,
      {
        id: seriesId,
        episodes: [
          {
            id: 'ep_2',
            episodeNumber: 2,
            status: 'completed',
            renderedVideo: {
              success: true,
              videoUrl: '/uploads/mock_render.mp4',
              outputVideoUrl: '/uploads/mock_render.mp4',
              outputFilename: 'mock_16-9.mp4',
            },
          },
        ],
      },
      { projectsDir }
    );
    const afterSync = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(afterSync.episodes[0].renderedVideo, null, '/sync must reject mock_render.mp4 from stale client');
    assert.equal(afterSync.episodes[0].status, 'translated');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }

  // Frontend projectStorage sanitization test
  const prevLocalStorage = global.localStorage;
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (idx) => Array.from(store.keys())[idx] ?? null,
    get length() { return store.size; },
  };
  try {
    const storage = await import('../../frontend/src/utils/projectStorage.js');
    assert.equal(storage.sanitizeRenderedVideo({ outputVideoUrl: '/uploads/mock_render.mp4' }), null);
    store.set('KHMER_AI_SERIES_LIST_V2', JSON.stringify([{
      id: 's_mock',
      title: 'Test',
      episodes: [{
        id: 'ep_2',
        episodeNumber: 2,
        status: 'completed',
        audioGenerated: false,
        audioOutdated: true,
        scriptData: { mode: 'fast_ocr', segments: makeSegments(2, 's') },
        renderedVideo: { outputVideoUrl: '/uploads/mock_render.mp4', outputFilename: 'mock_16-9.mp4' },
      }],
    }]));
    const loaded = storage.loadSeriesList();
    assert.equal(loaded[0].episodes[0].renderedVideo, null, 'loadSeriesList must heal stale mock_render.mp4');
    assert.equal(loaded[0].episodes[0].status, 'translated');
  } finally {
    if (prevLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = prevLocalStorage;
  }
});
