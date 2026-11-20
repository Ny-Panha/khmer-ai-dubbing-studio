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
  computeMasterAudioSignature,
} = require('../services/ttsService');
const { autoStretchTtsAudio } = require('../services/ffmpegService');

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

test('computeMasterAudioSignature differentiates timeline startSec, offsets, ordering, and audio files', () => {
  const base = [
    { id: 1, audioPath: '/path/seg_1.mp3', startSec: 0.0, audioOffset: 0.0, audioSignature: 'sig1' },
    { id: 2, audioPath: '/path/seg_2.mp3', startSec: 2.5, audioOffset: 0.0, audioSignature: 'sig2' },
  ];
  const sigBase = computeMasterAudioSignature(base);
  assert.ok(sigBase && sigBase.length >= 16);

  // 1. Same timings and files produces identical signature
  const sigSame = computeMasterAudioSignature([
    { id: 1, audioPath: '/path/seg_1.mp3', startSec: 0.0, audioOffset: 0.0, audioSignature: 'sig1' },
    { id: 2, audioPath: '/path/seg_2.mp3', startSec: 2.5, audioOffset: 0.0, audioSignature: 'sig2' },
  ]);
  assert.equal(sigSame, sigBase);

  // 2. Moving clip timing on timeline produces different signature (P0 fix)
  const sigMoved = computeMasterAudioSignature([
    { id: 1, audioPath: '/path/seg_1.mp3', startSec: 0.0, audioOffset: 0.0, audioSignature: 'sig1' },
    { id: 2, audioPath: '/path/seg_2.mp3', startSec: 3.8, audioOffset: 0.0, audioSignature: 'sig2' },
  ]);
  assert.notEqual(sigMoved, sigBase, 'Changing startSec must invalidate master audio signature');

  // 3. Changing audioOffset produces different signature
  const sigOffset = computeMasterAudioSignature([
    { id: 1, audioPath: '/path/seg_1.mp3', startSec: 0.0, audioOffset: 0.15, audioSignature: 'sig1' },
    { id: 2, audioPath: '/path/seg_2.mp3', startSec: 2.5, audioOffset: 0.0, audioSignature: 'sig2' },
  ]);
  assert.notEqual(sigOffset, sigBase, 'Changing audioOffset must invalidate master audio signature');

  // 4. Reordering clips produces different signature
  const sigReordered = computeMasterAudioSignature([
    { id: 2, audioPath: '/path/seg_2.mp3', startSec: 2.5, audioOffset: 0.0, audioSignature: 'sig2' },
    { id: 1, audioPath: '/path/seg_1.mp3', startSec: 0.0, audioOffset: 0.0, audioSignature: 'sig1' },
  ]);
  assert.notEqual(sigReordered, sigBase, 'Reordering segments must invalidate master audio signature');
});

test('POST /api/generate-audio: Initial run creates master + sig, second all-cached run skips merge, moving clip forces re-merge', async () => {
  const seriesId = `series_sig_e2e_${Date.now()}`;
  const episodeId = 'ep_sig';
  const epAudioDir = path.join(uploadsDir, 'projects', seriesId, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  const { server, baseUrl } = await startTestServer();
  try {
    // 1. Initial run: synthesize 2 segments
    const res1 = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: [
          { id: 1, index: 1, khmer: 'សួស្តីបងប្អូនទាំងអស់គ្នា', startSec: 0, endSec: 2.0, voiceId: 'km-KH-PisethNeural' },
          { id: 2, index: 2, khmer: 'ថ្ងៃនេះមានកម្មវិធីពិសេស', startSec: 2.5, endSec: 4.5, voiceId: 'km-KH-PisethNeural' },
        ],
      }),
    });
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.equal(data1.telemetry.synthesizedSegmentsCount, 2);
    assert.ok(data1.telemetry.masterAudioSignature, 'Master Audio Signature in telemetry must not be null');
    assert.ok(fs.existsSync(data1.fullAudioPath), 'Master narration MP3 must be created');
    const sigPath = `${data1.fullAudioPath}.sig`;
    assert.ok(fs.existsSync(sigPath), 'Master audio .sig file must be written');
    const sigInitial = fs.readFileSync(sigPath, 'utf8').trim();
    assert.equal(data1.telemetry.masterAudioSignature, sigInitial, 'Telemetry masterAudioSignature must match .sig file on disk');

    // 2. Second all-cached run with identical segments and timings -> must skip master merge safely!
    const res2 = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: data1.segments,
      }),
    });
    const data2 = await res2.json();
    assert.equal(data2.success, true);
    assert.equal(data2.telemetry.synthesizedSegmentsCount, 0);
    assert.equal(data2.telemetry.reusedSegmentsCount, 2);
    assert.equal(data2.telemetry.masterMergeSkipped, true, 'Master merge must be skipped when all cached and signature matches');
    assert.equal(data2.telemetry.masterAudioMergeMs, 0);

    // 3. Third run: move segment 2 on the timeline (startSec: 2.5 -> 3.8) without changing text/MP3
    const movedSegments = data1.segments.map((s) => (s.id === 2 ? { ...s, startSec: 3.8, audioStartSec: 3.8 } : s));
    const res3 = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: movedSegments,
      }),
    });
    const data3 = await res3.json();
    assert.equal(data3.success, true);
    assert.equal(data3.telemetry.synthesizedSegmentsCount, 0, 'Audio MP3 files did not need re-synthesis');
    assert.equal(data3.telemetry.masterMergeSkipped, false, 'Master audio merge MUST NOT be skipped when timeline timings changed');
    assert.ok(data3.telemetry.masterAudioMergeMs >= 0);
    const sigMoved = fs.readFileSync(sigPath, 'utf8').trim();
    assert.notEqual(sigMoved, sigInitial, 'Updated master audio .sig must reflect the new timeline positions');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(path.join(uploadsDir, 'projects', seriesId), { recursive: true, force: true });
  }
});

test('Failed segment in batch prevents false completion and keeps episode audioOutdated: true', async () => {
  const seriesId = `series_failure_guard_${Date.now()}`;
  const episodeId = 'ep_fail';
  const seriesDir = path.join(uploadsDir, 'projects', seriesId);
  const epAudioDir = path.join(seriesDir, 'episodes', episodeId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  // 1. Write real series.json to disk with episode
  const initialMeta = {
    id: seriesId,
    episodes: [
      {
        id: episodeId,
        episodeNumber: 1,
        audioGenerated: true,
        audioOutdated: false,
        scriptData: {
          segments: [
            { id: 1, index: 1, khmer: 'សួស្តីបងប្អូនទាំងអស់គ្នា', startSec: 0, endSec: 2.0 },
            { id: 'fail:invalid:id', index: 2, khmer: 'ឃ្លាបរាជ័យដោយសារអក្សរឈ្មោះឯកសារ', startSec: 2.5, endSec: 4.5 },
          ],
        },
      },
    ],
  };
  fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify(initialMeta, null, 2), 'utf8');

  const { server, baseUrl } = await startTestServer();
  try {
    // 2. Unit level test with generateSingleFn throwing
    const tmpDir = path.join(uploadsDir, `batch_fail_test_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const segments = [
      { id: 1, khmer: 'សួស្តីបងប្អូន', voiceId: 'km-KH-PisethNeural' },
      { id: 2, khmer: 'ឃ្លាបរាជ័យ', voiceId: 'km-KH-PisethNeural' },
    ];

    const results = await generateBatchSegmentsAudio(segments, tmpDir, {
      generateSingleFn: async (seg) => {
        if (seg.id === 2) {
          throw new Error('Simulated Edge TTS Network Connection Reset');
        }
        return {
          ...seg,
          audioUrl: `/uploads/ok_${seg.id}.mp3`,
          audioPath: path.join(tmpDir, `ok_${seg.id}.mp3`),
          audioGenerated: true,
          ttsStatus: 'ready',
          _wasNewlySynthesized: true,
        };
      },
    });

    assert.equal(results.telemetry.failedCount, 1);
    assert.equal(results.telemetry.succeededCount, 1);
    assert.equal(results[1]._failed, true, 'Failed segment must be explicitly flagged with _failed=true');
    assert.equal(results[1].ttsStatus, 'error');
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Pre-create the exact destination output path for segment 2 as a directory to trigger an unrecoverable filesystem write error (EISDIR)
    const blockingDir = path.join(epAudioDir, 'ep_ep_fail_seg_fail_invalid_id_km-KH-PisethNeural_voice_7bda5d51.mp3');
    fs.mkdirSync(blockingDir, { recursive: true });

    // 3. Real Backend Route test: POST /api/generate-audio with segment 2 blocked by directory
    const res = await fetch(`${baseUrl}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        episodeId,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: false,
        segments: initialMeta.episodes[0].scriptData.segments,
      }),
    });
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.failedCount, 1, 'Route must report failedCount: 1 when a segment fails');
    assert.equal(data.telemetry.failedCount, 1);

    // Verify series.json on disk: targetEp must have audioOutdated: true and audioGenerated: false!
    const diskMeta = JSON.parse(fs.readFileSync(path.join(seriesDir, 'series.json'), 'utf8'));
    const diskEp = diskMeta.episodes.find((e) => e.id === episodeId);
    assert.equal(diskEp.audioOutdated, true, 'Episode in series.json on disk must have audioOutdated: true when any segment fails');
    assert.equal(diskEp.audioGenerated, false, 'Episode in series.json on disk must have audioGenerated: false when any segment fails');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(seriesDir, { recursive: true, force: true });
  }
});

test('generateBatchSegmentsAudio returns telemetry with reusedCount and newlySynthesizedCount', async () => {
  const tmpDir = path.join(uploadsDir, `batch_telemetry_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    let callCount = 0;
    const segments = [
      { id: 1, khmer: 'ឃ្លាទីមួយ', voiceId: 'km-KH-PisethNeural' },
      { id: 2, khmer: 'ឃ្លាទីពីរ', voiceId: 'km-KH-PisethNeural' },
      { id: 3, khmer: '', voiceId: 'km-KH-PisethNeural' },
    ];

    const results = await generateBatchSegmentsAudio(segments, tmpDir, {
      generateSingleFn: async (seg) => {
        callCount++;
        const isReused = seg.id === 1;
        return {
          ...seg,
          audioUrl: `/uploads/test_${seg.id}.mp3`,
          audioPath: path.join(tmpDir, `test_${seg.id}.mp3`),
          audioGenerated: true,
          _wasNewlySynthesized: !isReused,
        };
      },
    });

    assert.ok(results.telemetry, 'generateBatchSegmentsAudio results must have telemetry');
    assert.equal(results.telemetry.totalSegments, 3);
    assert.equal(results.telemetry.pendingSegments, 2, 'Only non-empty segments must be pending');
    assert.equal(results.telemetry.skippedEmptyCount, 1);
    assert.equal(results.telemetry.newlySynthesizedCount, 1);
    assert.equal(results.telemetry.reusedCount, 1);
    assert.equal(callCount, 2, 'generateSingleFn must only be called for non-empty segments');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('autoStretchTtsAudio with isPreTrimmed: true and currentDuration <= targetDuration returns immediately', async () => {
  const dummyFile = path.join(uploadsDir, `test_pretrim_${Date.now()}.mp3`);
  fs.writeFileSync(dummyFile, Buffer.alloc(1000, 0x55));

  try {
    const res = await autoStretchTtsAudio({
      inputAudioPath: dummyFile,
      targetDuration: 3.0,
      isPreTrimmed: true,
      currentDuration: 2.5,
    });

    assert.equal(res.appliedSpeed, 1.0);
    assert.equal(res.originalDuration, 2.5);
    assert.equal(res.finalDuration, 2.5);
  } finally {
    try { fs.unlinkSync(dummyFile); } catch (_) {}
  }
});

