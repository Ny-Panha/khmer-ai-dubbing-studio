const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const videoRoutes = require('../routes/videoRoutes');
const { splitVideoIntoEpisodes } = require('../services/ffmpegService');

test('Episode Split Defaults: Static Audit of frontend components and backend routes', () => {
  const mediaUploadPath = path.resolve(__dirname, '../../frontend/src/components/media/MediaUploadTab.jsx');
  const episodesTabPath = path.resolve(__dirname, '../../frontend/src/components/media/EpisodesTab.jsx');
  const videoRoutesPath = path.resolve(__dirname, '../routes/videoRoutes.js');
  const ffmpegServicePath = path.resolve(__dirname, '../services/ffmpegService.js');
  const apiServicePath = path.resolve(__dirname, '../../frontend/src/services/api.js');

  const mediaUploadCode = fs.readFileSync(mediaUploadPath, 'utf8');
  const episodesTabCode = fs.readFileSync(episodesTabPath, 'utf8');
  const videoRoutesCode = fs.readFileSync(videoRoutesPath, 'utf8');
  const ffmpegServiceCode = fs.readFileSync(ffmpegServicePath, 'utf8');
  const apiServiceCode = fs.readFileSync(apiServicePath, 'utf8');

  // 1. MediaUploadTab audit
  assert.ok(!mediaUploadCode.includes('useState(20)'), 'MediaUploadTab must not initialize splitMinutes to 20');
  assert.ok(!mediaUploadCode.includes('|| 20'), 'MediaUploadTab must not have fallback to 20');
  assert.ok(mediaUploadCode.includes("useState('')"), "MediaUploadTab splitValue must start empty");
  assert.ok(!mediaUploadCode.includes('handleAutoSplit(20)'), 'MediaUploadTab must not have hardcoded 20-min button');

  // 2. EpisodesTab audit
  assert.ok(!episodesTabCode.includes('useState(20)'), 'EpisodesTab must not initialize splitMinutes to 20');
  assert.ok(!episodesTabCode.includes('|| 8'), 'EpisodesTab must not have fallback to 8');
  assert.ok(!episodesTabCode.includes('|| 20'), 'EpisodesTab must not have fallback to 20');
  assert.ok(episodesTabCode.includes("useState('')"), "EpisodesTab splitValue must start empty");

  // 3. Backend videoRoutes audit
  assert.ok(!videoRoutesCode.includes('replaceEpisodes = true'), 'videoRoutes must not default replaceEpisodes to true');
  assert.ok(videoRoutesCode.includes('replaceEpisodes = false'), 'videoRoutes must default replaceEpisodes to false');
  assert.ok(!videoRoutesCode.includes('durationMinutes || 1'), 'videoRoutes must not fallback to durationMinutes || 1');
  assert.ok(!videoRoutesCode.includes('totalDuration / 2'), 'videoRoutes must delete silent split-in-half branch');
  assert.ok(videoRoutesCode.includes('user must choose episode count or minutes'), 'videoRoutes must require user choice');

  // 4. ffmpegService audit
  assert.ok(!ffmpegServiceCode.includes('targetDurationSec = 480'), 'ffmpegService must not default targetDurationSec to 480');

  // 5. Frontend API service audit
  assert.ok(apiServiceCode.includes('replaceEpisodes: Boolean(replaceEpisodes)'), 'api.js must forward replaceEpisodes');
});

test('ffmpegService splitVideoIntoEpisodes: rejects missing or zero targetDurationSec', async () => {
  await assert.rejects(
    async () => {
      await splitVideoIntoEpisodes({
        inputVideoPath: 'dummy.mp4',
        targetDurationSec: 0,
        outputDir: './tmp',
      });
    },
    /targetDurationSec must be specified and greater than 0/
  );

  await assert.rejects(
    async () => {
      await splitVideoIntoEpisodes({
        inputVideoPath: 'dummy.mp4',
        targetDurationSec: undefined,
        outputDir: './tmp',
      });
    },
    /targetDurationSec must be specified and greater than 0/
  );
});

test('Backend /api/split-video-episodes: Rejection of silent defaults and empty requests', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', videoRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/split-video-episodes`;

  try {
    // 1. Empty body -> 400
    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res1.status, 400);
    const body1 = await res1.json();
    assert.equal(body1.success, false);
    assert.match(body1.error, /videoPath or videoId is required/);

    // 2. Valid videoId but NO durationMinutes and NO episodeCount -> 400
    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: 'projects/series_1793898268958/episodes/ep_1/video/ep_1_source.mp4',
      }),
    });
    assert.equal(res2.status, 400);
    const body2 = await res2.json();
    assert.equal(body2.success, false);
    assert.equal(body2.error, 'user must choose episode count or minutes');

    // 3. durationMinutes is 0 or negative -> 400
    const res3 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: 'projects/series_1793898268958/episodes/ep_1/video/ep_1_source.mp4',
        durationMinutes: 0,
      }),
    });
    assert.equal(res3.status, 400);
    const body3 = await res3.json();
    assert.equal(body3.error, 'user must choose episode count or minutes');

    // 4. episodeCount is 1 (without positive duration) -> 400
    const res4 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: 'projects/series_1793898268958/episodes/ep_1/video/ep_1_source.mp4',
        episodeCount: 1,
      }),
    });
    assert.equal(res4.status, 400);
    const body4 = await res4.json();
    assert.equal(body4.error, 'user must choose episode count or minutes');

    // 5. Empty strings passed -> 400
    const res5 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: 'projects/series_1793898268958/episodes/ep_1/video/ep_1_source.mp4',
        durationMinutes: '',
        episodeCount: '',
      }),
    });
    assert.equal(res5.status, 400);
    const body5 = await res5.json();
    assert.equal(body5.error, 'user must choose episode count or minutes');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
