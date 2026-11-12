const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const audioRoutes = require('../routes/audioRoutes');
const { getMediaDuration } = require('../services/ffmpegService');
const { uploadsDir } = require('../utils/pathUtils');

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', audioRoutes);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}/api`,
      });
    });
  });
}

test('POST /api/audio/autofit-speed speeds up overflowing speech up to 1.50x to fit subtitle slot without cutting words', async (t) => {
  const { server, baseUrl } = await createTestApp();
  const seriesId = `series_test_autofit_${Date.now()}`;
  const seriesDir = path.join(uploadsDir, 'projects', seriesId);
  const epDir = path.join(seriesDir, 'episodes', 'ep_1', 'audio');
  fs.mkdirSync(epDir, { recursive: true });

  t.after(() => {
    server.close();
    try {
      fs.rmSync(seriesDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // 1. Generate an actual speech audio file for testing (realistic dialogue ~2.5s)
  const text = 'កុំថាឡើយការកសាងគ្រឹះរយថ្ងៃ។';
  const genRes = await fetch(`${baseUrl}/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segment: { id: 1, khmer: text, startSec: 0, endSec: 1.8 },
      voiceId: 'km-KH-PisethNeural',
      speed: 'normal',
      autoStretch: false,
      seriesId,
      episodeId: 'ep_1',
      forceRegen: true,
    }),
  });
  assert.equal(genRes.status, 200);
  const genData = await genRes.json();
  assert.equal(genData.success, true);
  const segAudioPath = genData.segment.audioPath;
  const initialDur = await getMediaDuration(segAudioPath);
  assert.ok(initialDur > 1.8, `Expected speech duration > 1.8s to create an overflow, got: ${initialDur}`);

  // Create a series.json where this segment is placed in a tight slot of 1.8s (overflow ~0.6s)
  const slotDur = 1.8;
  const initialSegments = [
    {
      id: 1,
      startSec: 10.0,
      endSec: 10.0 + slotDur, // Slot duration: 1.8s
      audioStartSec: 10.0,
      audioEndSec: 10.0 + initialDur,
      audioDurationSec: initialDur,
      originalAudioDuration: initialDur,
      rawAudioDur: initialDur,
      audioFile: path.basename(segAudioPath),
      audioPath: segAudioPath,
      audioUrl: genData.segment.audioUrl,
      audioTrimmed: true, // Marked trimmed/red
      khmer: text,
    },
  ];

  const seriesMeta = {
    id: seriesId,
    title: 'Test AutoFit Series',
    episodes: [
      {
        id: 'ep_1',
        episodeNumber: 1,
        scriptData: {
          segments: initialSegments,
        },
      },
    ],
  };
  fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify(seriesMeta, null, 2), 'utf8');

  // 2. Call /api/audio/autofit-speed
  const fitRes = await fetch(`${baseUrl}/audio/autofit-speed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seriesId,
      episodeId: 'ep_1',
      maxSpeed: 1.50,
    }),
  });

  assert.equal(fitRes.status, 200);
  const fitData = await fitRes.json();
  assert.equal(fitData.success, true);
  assert.equal(fitData.fittedCount, 1);

  const fittedSeg = fitData.segments[0];
  assert.equal(fittedSeg.audioTrimmed, false, 'audioTrimmed must be reset to false');
  assert.equal(fittedSeg.userTrimmed, false, 'userTrimmed must be reset to false');
  assert.ok(fittedSeg.appliedSpeed >= 1.15, `Expected appliedSpeed >= 1.15, got: ${fittedSeg.appliedSpeed}`);

  // 3. Verify actual audio file on disk was sped up with atempo
  const newDur = await getMediaDuration(segAudioPath);
  assert.ok(newDur < initialDur, `Expected new duration (${newDur}) < initial duration (${initialDur})`);
  assert.ok(newDur <= slotDur + 0.05, `Expected new duration to fit ~${slotDur}s slot, got: ${newDur}`);
  assert.equal(fittedSeg.audioDurationSec, newDur);
  assert.equal(fittedSeg.finalAudioDuration, newDur);
  assert.equal(fittedSeg.originalAudioDuration, newDur);

  // 4. Verify series.json on disk was updated
  const updatedSeries = JSON.parse(fs.readFileSync(path.join(seriesDir, 'series.json'), 'utf8'));
  const savedSeg = updatedSeries.episodes[0].scriptData.segments[0];
  assert.equal(savedSeg.audioTrimmed, false);
  assert.equal(savedSeg.audioDurationSec, newDur);
});
