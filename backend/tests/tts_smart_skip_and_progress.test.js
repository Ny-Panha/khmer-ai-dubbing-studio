const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const audioRoutes = require('../routes/audioRoutes');
const { uploadsDir } = require('../utils/pathUtils');
const {
  generateSingleSegmentAudio,
  generateBatchSegmentsAudio,
  getTtsJobProgress,
} = require('../services/ttsService');

function startTestServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
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

test('GET /api/tts/progress deduplicates old hash files and never exceeds 100% (fixes 649/500 130%)', async () => {
  const seriesId = `series_progress_dedup_${Date.now()}`;
  const episodeId = 'ep_1';
  const epAudioDir = path.join(uploadsDir, 'projects', seriesId, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  // Simulate 3 old hash versions of seg_1 and 2 old hash versions of seg_2 (total 5 MP3s for only 2 segments!)
  const fakeMp3 = Buffer.alloc(400, 0xaa);
  fs.writeFileSync(path.join(epAudioDir, 'ep_ep_1_seg_1_km-KH-PisethNeural_voice_11111111.mp3'), fakeMp3);
  fs.writeFileSync(path.join(epAudioDir, 'ep_ep_1_seg_1_km-KH-PisethNeural_voice_22222222.mp3'), fakeMp3);
  fs.writeFileSync(path.join(epAudioDir, 'ep_ep_1_seg_1_km-KH-PisethNeural_voice_33333333.mp3'), fakeMp3);
  fs.writeFileSync(path.join(epAudioDir, 'ep_ep_1_seg_2_km-KH-PisethNeural_voice_44444444.mp3'), fakeMp3);
  fs.writeFileSync(path.join(epAudioDir, 'ep_ep_1_seg_2_km-KH-PisethNeural_voice_55555555.mp3'), fakeMp3);
  fs.writeFileSync(path.join(epAudioDir, '.tmp_tts_1234_abcd.mp3'), Buffer.alloc(0));

  const { server, baseUrl } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/tts/progress?seriesId=${seriesId}&episodeId=${episodeId}&total=2`);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.current, 2, 'Unique segment count must be 2, not 5 raw mp3 files');
    assert.equal(data.total, 2);
    assert.ok(data.percent <= 100, `Percent must be <= 100, got ${data.percent}`);
    assert.equal(data.isRunning, false);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(path.join(uploadsDir, 'projects', seriesId), { recursive: true, force: true });
  }
});

test('GET /api/tts/progress reads active in-memory batch progress cleanly even when old narration exists', async () => {
  const seriesId = `series_live_prog_${Date.now()}`;
  const episodeId = 'ep_9';
  const epAudioDir = path.join(uploadsDir, 'projects', seriesId, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });
  // Pre-existing narration from prior run MUST NOT cause isDone:true mid-batch
  fs.writeFileSync(path.join(epAudioDir, `${episodeId}_narration_khmer.mp3`), Buffer.alloc(2000, 0xbb));

  const { server, baseUrl } = await startTestServer();
  try {
    let observedMidRun = null;
    const batchPromise = generateBatchSegmentsAudio(
      [
        { id: 1, khmer: 'មួយ' },
        { id: 2, khmer: 'ពីរ' },
        { id: 3, khmer: '' },
      ],
      epAudioDir,
      {
        seriesId,
        episodeId,
        concurrency: 1,
        generateSingleFn: async (seg) => {
          if (seg.id === 2) {
            const pRes = await fetch(`${baseUrl}/tts/progress?seriesId=${seriesId}&episodeId=${episodeId}&total=3`);
            observedMidRun = await pRes.json();
          }
          return { ...seg, audioFileName: `ep_ep_9_seg_${seg.id}.mp3`, audioUrl: `/uploads/x_${seg.id}.mp3` };
        },
      }
    );
    await batchPromise;
    assert.ok(observedMidRun, 'Should observe mid-run /api/tts/progress snapshot');
    assert.equal(observedMidRun.isRunning, true, 'Must report isRunning=true while batch is active');
    assert.equal(observedMidRun.isDone, false, 'Must NOT report isDone=true before batch finishes');
    assert.ok(observedMidRun.current >= 1 && observedMidRun.current <= 3, `current must stay within 1..3, got ${observedMidRun.current}`);
    assert.equal(getTtsJobProgress(seriesId, episodeId), null, 'Active job entry must clean up after finish');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(path.join(uploadsDir, 'projects', seriesId), { recursive: true, force: true });
  }
});

test('POST /api/generate-audio smart fast-path skips re-generation when audio already exists and catches missing pending segments', async () => {
  const seriesId = `series_smart_skip_${Date.now()}`;
  const episodeId = 'ep_1';
  const epAudioDir = path.join(uploadsDir, 'projects', seriesId, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  const { server, baseUrl } = await startTestServer();
  try {
    // 1. Real baseline synthesis of 1 segment so real valid MP3 + narration exist
    const firstRes = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: [
          { id: 1, khmer: 'សួស្តីបងប្អូនទាំងអស់គ្នា', startSec: 0, endSec: 2.5, voiceId: 'km-KH-PisethNeural' },
        ],
      }),
    });
    const firstData = await firstRes.json();
    assert.equal(firstData.success, true);
    assert.equal(firstData.alreadyCompleted, undefined);
    const seg1 = firstData.segments[0];
    assert.ok(fs.existsSync(seg1.audioPath));
    assert.ok(fs.existsSync(firstData.fullAudioPath));

    // 2. Second call with forceRegen=false and same ready segment -> MUST fast-skip (`alreadyCompleted: true`)
    const secondRes = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: [seg1],
      }),
    });
    const secondData = await secondRes.json();
    assert.equal(secondData.success, true);
    assert.equal(secondData.alreadyCompleted, true, 'Existing complete audio with forceRegen=false must return alreadyCompleted=true');

    // 3. Call with 1 ready segment + 1 newly added (+ ឃ្លា) pending segment WITHOUT audioOutdated -> must NOT skip!
    const thirdRes = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: [
          seg1,
          { id: 2, khmer: 'ឃ្លាបន្ថែមថ្មី', startSec: 3.0, endSec: 5.0, ttsStatus: 'pending', voiceId: 'km-KH-PisethNeural' },
        ],
      }),
    });
    const thirdData = await thirdRes.json();
    assert.equal(thirdData.success, true);
    assert.notEqual(thirdData.alreadyCompleted, true, 'New pending segment must trigger batch completion instead of fast-skip');
    assert.ok(fs.existsSync(thirdData.segments[1].audioPath), 'Pending segment #2 must be generated cleanly');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(path.join(uploadsDir, 'projects', seriesId), { recursive: true, force: true });
  }
});

test('Prior episode MP3 cleanup removes superseded same-segment hash while preserving split sibling shared file', async () => {
  const seriesId = `series_prior_cleanup_${Date.now()}`;
  const episodeId = 'ep_4';
  const epAudioDir = path.join(uploadsDir, 'projects', seriesId, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  const oldSeg1Path = path.join(epAudioDir, `ep_${episodeId}_seg_1_km-KH-PisethNeural_voice_deadbeef.mp3`);
  const sharedSplitPath = path.join(epAudioDir, `ep_${episodeId}_seg_2_km-KH-PisethNeural_voice_cafe1234.mp3`);
  fs.writeFileSync(oldSeg1Path, Buffer.alloc(600, 0x11));
  fs.writeFileSync(sharedSplitPath, Buffer.alloc(600, 0x22));

  try {
    // 1. Regenerate non-shared ep_* seg_1 -> old deadbeef hash must be cleaned up
    const res1 = await generateSingleSegmentAudio(
      { id: 1, khmer: 'តេស្តសម្អាតឯកសារចាស់', audioPath: oldSeg1Path, startSec: 0, endSec: 2.0 },
      epAudioDir,
      { voiceId: 'km-KH-PisethNeural', episodeId, forceRegen: true }
    );
    assert.ok(fs.existsSync(res1.audioPath));
    assert.equal(fs.existsSync(oldSeg1Path), false, 'Superseded ep_* hash file for seg_1 should be cleaned up');

    // 2. Regenerate seg_2 when sharedAudioPaths protects sharedSplitPath (split sibling still uses it)
    const res2 = await generateSingleSegmentAudio(
      { id: 2, khmer: 'តេស្តពុះឃ្លា', audioPath: sharedSplitPath, startSec: 2.0, endSec: 4.0 },
      epAudioDir,
      { voiceId: 'km-KH-PisethNeural', episodeId, forceRegen: true, sharedAudioPaths: new Set([path.resolve(sharedSplitPath)]) }
    );
    assert.ok(fs.existsSync(res2.audioPath));
    assert.equal(fs.existsSync(sharedSplitPath), true, 'Split sibling shared file must NOT be deleted');
  } finally {
    fs.rmSync(path.join(uploadsDir, 'projects', seriesId), { recursive: true, force: true });
  }
});

test('Frontend guards: useAudioDubbing never defaults forceRegen=true & DubbingModeTab gates Re-TTS behind confirmation', () => {
  const hookCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/hooks/useAudioDubbing.js'), 'utf8');
  const tabCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/media/DubbingModeTab.jsx'), 'utf8');
  const apiCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/services/api.js'), 'utf8');

  assert.ok(
    hookCode.includes('const forceRegen = Boolean(cleanParams.forceRegen);'),
    'useAudioDubbing must default forceRegen to false instead of auto-forcing when audio exists'
  );
  assert.ok(
    !hookCode.includes("Boolean(scriptData.segments.some((s) => s.audioUrl || s.audioPath || s.audioFile))"),
    'Must remove auto forceRegen=true trigger from useAudioDubbing'
  );
  assert.ok(tabCode.includes('showConfirmReTts'), 'DubbingModeTab must guard Re-TTS behind showConfirmReTts modal');
  assert.ok(tabCode.includes('pendingOrOutdatedCount'), 'DubbingModeTab must detect missing/outdated segments separately');
  assert.ok(apiCode.includes('alreadyCompleted: Boolean(data.alreadyCompleted)'), 'api.js must pass through alreadyCompleted');
});

test('POST /api/generate-audio clears ep.audioOutdated in series.json after batch completion and fast-path skip', async () => {
  const { getSeriesMetadata, saveSeriesMetadata } = require('../services/episodeService');
  const seriesId = `series_clear_outdated_${Date.now()}`;
  const episodeId = 'ep_2';
  const epAudioDir = path.join(uploadsDir, 'projects', seriesId, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  saveSeriesMetadata({
    id: seriesId,
    title: 'Clear Outdated Audio Test',
    episodes: [
      {
        id: episodeId,
        episodeNumber: 2,
        title: 'EP 2',
        audioGenerated: false,
        hasAudio: false,
        audioOutdated: true,
        fullAudioUrl: null,
        scriptData: {
          hasScript: true,
          mode: 'fast_ocr',
          segments: [
            { id: 1, index: 1, khmer: 'សួស្តីអ្នកទាំងអស់គ្នា', startSec: 0, endSec: 2.0, voiceId: 'km-KH-PisethNeural', audioOutdated: true, ttsStatus: 'outdated' },
            { id: 2, index: 2, khmer: '!', startSec: 2.2, endSec: 2.8, voiceId: 'km-KH-PisethNeural', audioOutdated: true, ttsStatus: 'empty_text' },
          ],
        },
      },
    ],
  });

  const { server, baseUrl } = await startTestServer();
  try {
    // 1. Batch TTS generates spoken segment & builds master narration -> must clear ep.audioOutdated = false
    const res1 = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: [
          { id: 1, index: 1, khmer: 'សួស្តីអ្នកទាំងអស់គ្នា', startSec: 0, endSec: 2.0, voiceId: 'km-KH-PisethNeural', audioOutdated: true, ttsStatus: 'outdated' },
          { id: 2, index: 2, khmer: '!', startSec: 2.2, endSec: 2.8, voiceId: 'km-KH-PisethNeural', audioOutdated: true, ttsStatus: 'empty_text' },
        ],
      }),
    });
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.ok(fs.existsSync(data1.fullAudioPath), 'Master narration MP3 must be created');

    const metaAfterBatch = getSeriesMetadata(seriesId, { forceDisk: true });
    const epAfterBatch = metaAfterBatch.episodes[0];
    assert.equal(epAfterBatch.audioGenerated, true);
    assert.equal(epAfterBatch.hasAudio, true);
    assert.equal(epAfterBatch.audioOutdated, false, 'Batch TTS completion must clear ep.audioOutdated=false on disk');

    // 2. Simulate stale ep.audioOutdated=true even though narration & segment MP3s exist -> fast-path must clear it too
    epAfterBatch.audioOutdated = true;
    saveSeriesMetadata(metaAfterBatch);
    const readySegs = epAfterBatch.scriptData.segments;
    const res2 = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: readySegs,
      }),
    });
    const data2 = await res2.json();
    assert.equal(data2.success, true);
    assert.equal(data2.alreadyCompleted, true, 'Empty punctuation seg must not block fast-path skip');

    const metaAfterFastPath = getSeriesMetadata(seriesId, { forceDisk: true });
    assert.equal(metaAfterFastPath.episodes[0].audioOutdated, false, 'Fast-path skip must clear stale ep.audioOutdated=false');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(path.join(uploadsDir, 'projects', seriesId), { recursive: true, force: true });
  }
});

