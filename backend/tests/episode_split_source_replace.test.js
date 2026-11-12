const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const express = require('express');

const videoRoutes = require('../routes/videoRoutes');
const { getSeriesMetadata, saveSeriesMetadata } = require('../services/episodeService');

function ensureSyntheticMp4(targetPath, durationSec = 33) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  execSync(
    `ffmpeg -y -f lavfi -i "color=c=navy:s=64x64:d=${durationSec}" -f lavfi -i "sine=frequency=440:duration=${durationSec}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest "${targetPath}"`,
    { stdio: 'ignore', windowsHide: true }
  );
}

test('findSourceEpisodeIndex: Robust matching of source episode', () => {
  const findSourceEpisodeIndex = videoRoutes.findSourceEpisodeIndex;
  assert.equal(typeof findSourceEpisodeIndex, 'function', 'findSourceEpisodeIndex must be exported');

  const testSeriesPath = path.resolve(__dirname, '../uploads/projects/test_source_match_series');
  const ep1VideoPath = path.join(testSeriesPath, 'episodes/ep_1/video/ep_1_source.mp4');
  const ep2VideoPath = path.join(testSeriesPath, 'episodes/ep_2/video/ep_2_source.mp4');

  const sampleEpisodes = [
    {
      id: 'ep_1',
      episodeNumber: 1,
      title: 'ភាគទី 1 (EP1)',
      videoFile: '/uploads/projects/test_source_match_series/episodes/ep_1/video/ep_1_source.mp4',
      sourceVideoPath: ep1VideoPath,
      video: {
        videoId: 'projects/test_source_match_series/episodes/ep_1/video/ep_1_source.mp4',
        videoPath: ep1VideoPath,
      },
    },
    {
      id: 'ep_2',
      episodeNumber: 2,
      title: 'ភាគទី 2 (EP2)',
      videoFile: '/uploads/projects/test_source_match_series/episodes/ep_2/video/ep_2_source.mp4',
      sourceVideoPath: ep2VideoPath,
      video: {
        videoId: 'projects/test_source_match_series/episodes/ep_2/video/ep_2_source.mp4',
        videoPath: ep2VideoPath,
      },
    },
  ];

  // 1. Match by absolute path
  const idxAbs = findSourceEpisodeIndex(sampleEpisodes, ep1VideoPath, ep1VideoPath);
  assert.equal(idxAbs, 0, 'Must match ep_1 by canonical absolute path');

  // 2. Match by normalized videoId
  const idxRel = findSourceEpisodeIndex(sampleEpisodes, 'projects/test_source_match_series/episodes/ep_2/video/ep_2_source.mp4', ep2VideoPath);
  assert.equal(idxRel, 1, 'Must match ep_2 by relative videoId');

  // 3. Match by targetEpisodeId
  const idxEpId = findSourceEpisodeIndex(sampleEpisodes, 'unknown_video.mp4', null, 'ep_1');
  assert.equal(idxEpId, 0, 'Must match ep_1 by targetEpisodeId');

  // 4. Return -1 for unmatched
  const idxUnmatched = findSourceEpisodeIndex(sampleEpisodes, 'unrelated_other.mp4', 'c:\\unrelated\\path.mp4', null);
  assert.equal(idxUnmatched, -1, 'Must return -1 for unmatched video');
});

test('Scenario 1: Fresh series with 1 long video -> Auto-Split replaces full-video EP1 into exactly 11 chunks', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', videoRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/split-video-episodes`;

  const seriesId = `series_test_scen1_${Date.now()}`;
  const seriesDir = path.resolve(__dirname, '../uploads/projects', seriesId);
  const ep1Dir = path.join(seriesDir, 'episodes/ep_1/video');
  fs.mkdirSync(ep1Dir, { recursive: true });

  const fullVideoPath = path.join(ep1Dir, 'ep_1_source.mp4');
  const shared110sPath = path.resolve(__dirname, '../uploads/test_fast_110s.mp4');

  if (fs.existsSync(shared110sPath)) {
    fs.copyFileSync(shared110sPath, fullVideoPath);
  } else {
    ensureSyntheticMp4(fullVideoPath, 110);
  }

  const initialBytes = fs.readFileSync(fullVideoPath);
  const fullDurationSec = 110;

  const initialSeries = {
    id: seriesId,
    title: 'តេស្តរឿងភាគវែង 110s',
    episodes: [
      {
        id: 'ep_1',
        episodeNumber: 1,
        title: 'ភាគទី 1: Full Movie (110s)',
        displayTitle: 'ភាគទី 1: Full Movie (110s)',
        status: 'uploaded',
        videoFile: `/uploads/projects/${seriesId}/episodes/ep_1/video/ep_1_source.mp4`,
        sourceVideoPath: fullVideoPath,
        duration: fullDurationSec,
        video: {
          videoId: `projects/${seriesId}/episodes/ep_1/video/ep_1_source.mp4`,
          videoPath: fullVideoPath,
          durationSec: fullDurationSec,
        },
        metadata: { duration: fullDurationSec, durationSec: fullDurationSec },
      },
    ],
  };
  saveSeriesMetadata(initialSeries);

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        videoId: `projects/${seriesId}/episodes/ep_1/video/ep_1_source.mp4`,
        videoPath: fullVideoPath,
        episodeId: 'ep_1',
        episodeCount: 11,
        replaceEpisodes: false, // Default append mode: MUST STILL REPLACE SOURCE!
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.sourceReplaced, true, 'Source episode must be recognized and replaced');
    assert.equal(body.totalEpisodes, 11, 'Series total must be EXACTLY 11 episodes (no 12th full video)');

    // Verify metadata saved on disk
    const savedSeries = getSeriesMetadata(seriesId);
    assert.equal(savedSeries.episodes.length, 11, 'Series must have exactly 11 episodes');

    // EP1 is now the first chunk (~10s), NOT the full video (110s)
    const ep1 = savedSeries.episodes[0];
    assert.equal(ep1.episodeNumber, 1);
    assert.ok(ep1.duration < 20, `EP1 duration (${ep1.duration}s) must be first chunk duration (~10s), not 110s`);

    // No episode holds the full video duration
    const fullEpExists = savedSeries.episodes.some((e) => Math.abs(e.duration - fullDurationSec) < 1);
    assert.equal(fullEpExists, false, 'No episode with full-video duration may exist in metadata');

    // The source video file on disk must be cleaned up to free disk space (Option A)
    assert.equal(fs.existsSync(fullVideoPath), false, 'The original uncut source video file on disk must be cleaned up');

    // All chunks have valid video and sequential display numbering 1..11
    savedSeries.episodes.forEach((ep, idx) => {
      assert.equal(ep.episodeNumber, idx + 1, `Episode at index ${idx} must have episodeNumber ${idx + 1}`);
      assert.ok(ep.videoFile, 'Each chunk must have a valid videoFile URL');
      assert.ok(ep.sourceVideoPath, 'Each chunk must have a sourceVideoPath');
      assert.ok(fs.existsSync(ep.sourceVideoPath), `Chunk video file must exist on disk: ${ep.sourceVideoPath}`);
    });

    // Message must report final total count
    assert.match(body.message, /សរុបក្នុងរឿងមាន 11 ភាគ/);
  } finally {
    server.close();
    try { fs.rmSync(seriesDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Scenario 2: Series with 3 real episodes -> split episode 2 with append mode replaces ep2 at position 2, ep1 and ep3 byte-identical', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', videoRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/split-video-episodes`;

  const seriesId = `series_test_scen2_${Date.now()}`;
  const seriesDir = path.resolve(__dirname, '../uploads/projects', seriesId);

  const ep1Dir = path.join(seriesDir, 'episodes/ep_1/video');
  const ep2Dir = path.join(seriesDir, 'episodes/ep_2/video');
  const ep3Dir = path.join(seriesDir, 'episodes/ep_3/video');
  fs.mkdirSync(ep1Dir, { recursive: true });
  fs.mkdirSync(ep2Dir, { recursive: true });
  fs.mkdirSync(ep3Dir, { recursive: true });

  const ep1File = path.join(ep1Dir, 'ep_1_source.mp4');
  const ep2File = path.join(ep2Dir, 'ep_2_source.mp4');
  const ep3File = path.join(ep3Dir, 'ep_3_source.mp4');

  // Create real synthetic mp4s
  ensureSyntheticMp4(ep1File, 12);
  ensureSyntheticMp4(ep2File, 33); // 33s video -> 3 chunks of 11s each
  ensureSyntheticMp4(ep3File, 15);

  const ep1Bytes = fs.readFileSync(ep1File);
  const ep2Bytes = fs.readFileSync(ep2File);
  const ep3Bytes = fs.readFileSync(ep3File);

  const initialSeries = {
    id: seriesId,
    title: 'រឿងភាគ ៣ ភាគ',
    episodes: [
      {
        id: 'ep_1',
        episodeNumber: 1,
        title: 'ភាគទី 1: The Beginning',
        videoFile: `/uploads/projects/${seriesId}/episodes/ep_1/video/ep_1_source.mp4`,
        sourceVideoPath: ep1File,
        duration: 12,
        video: { videoId: `projects/${seriesId}/episodes/ep_1/video/ep_1_source.mp4`, videoPath: ep1File, durationSec: 12 },
      },
      {
        id: 'ep_2',
        episodeNumber: 2,
        title: 'ភាគទី 2: The Long Journey',
        videoFile: `/uploads/projects/${seriesId}/episodes/ep_2/video/ep_2_source.mp4`,
        sourceVideoPath: ep2File,
        duration: 33,
        video: { videoId: `projects/${seriesId}/episodes/ep_2/video/ep_2_source.mp4`, videoPath: ep2File, durationSec: 33 },
      },
      {
        id: 'ep_3',
        episodeNumber: 3,
        title: 'ភាគទី 3: The Finale',
        videoFile: `/uploads/projects/${seriesId}/episodes/ep_3/video/ep_3_source.mp4`,
        sourceVideoPath: ep3File,
        duration: 15,
        video: { videoId: `projects/${seriesId}/episodes/ep_3/video/ep_3_source.mp4`, videoPath: ep3File, durationSec: 15 },
      },
    ],
  };
  saveSeriesMetadata(initialSeries);

  try {
    // Split episode 2 into 3 chunks with append mode (replaceEpisodes: false)
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        videoId: `projects/${seriesId}/episodes/ep_2/video/ep_2_source.mp4`,
        videoPath: ep2File,
        episodeId: 'ep_2',
        episodeCount: 3,
        replaceEpisodes: false, // Append mode
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.sourceReplaced, true);
    // Initial 3 - 1 (source ep2) + 3 chunks = 5 episodes total
    assert.equal(body.totalEpisodes, 5);

    const savedSeries = getSeriesMetadata(seriesId);
    assert.equal(savedSeries.episodes.length, 5, 'Series must have 5 episodes');

    // 1. Episode 1 byte-identical check
    assert.equal(fs.existsSync(ep1File), true);
    assert.deepEqual(fs.readFileSync(ep1File), ep1Bytes, 'Episode 1 video on disk must be byte-identical');
    assert.equal(savedSeries.episodes[0].id, 'ep_1');
    assert.equal(savedSeries.episodes[0].episodeNumber, 1);
    assert.equal(savedSeries.episodes[0].title, 'ភាគទី 1: The Beginning');

    // 2. Chunks take position 2, 3, 4 (indices 1, 2, 3)
    assert.equal(savedSeries.episodes[1].episodeNumber, 2);
    assert.equal(savedSeries.episodes[2].episodeNumber, 3);
    assert.equal(savedSeries.episodes[3].episodeNumber, 4);

    // 3. Episode 3 byte-identical check (now at index 4, episodeNumber 5)
    assert.equal(fs.existsSync(ep3File), true);
    assert.deepEqual(fs.readFileSync(ep3File), ep3Bytes, 'Episode 3 video on disk must be byte-identical');
    assert.equal(savedSeries.episodes[4].id, 'ep_3', 'Episode 3 ID must be preserved');
    assert.equal(savedSeries.episodes[4].episodeNumber, 5, 'Episode 3 display number follows sequential order 1..N');
    assert.equal(savedSeries.episodes[4].title, 'ភាគទី 5: The Finale');

    // 4. Source episode 2 uncut video on disk is cleaned up (Option A)
    assert.equal(fs.existsSync(ep2File), false, 'Source ep2 video on disk must be cleaned up');

    // 5. No ID collisions
    const allIds = savedSeries.episodes.map((e) => e.id);
    const uniqueIds = new Set(allIds);
    assert.equal(uniqueIds.size, allIds.length, 'All episode IDs must be strictly unique');

    // 6. Response message reports final count
    assert.match(body.message, /សរុបក្នុងរឿងមាន 5 ភាគ/);
  } finally {
    server.close();
    try { fs.rmSync(seriesDir, { recursive: true, force: true }); } catch (_) {}
  }
});
