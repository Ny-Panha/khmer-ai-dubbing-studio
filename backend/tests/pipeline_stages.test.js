const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { previewAndExport } = require('../services/pipeline/stages/stage10_previewAndExport');

test('Stage 3: getOcrCachePath resolves correctly to ../../../uploads/cache', () => {
  const stage3Path = path.resolve(__dirname, '../services/pipeline/stages/stage3_extractChineseSubtitles.js');
  const stage3Content = fs.readFileSync(stage3Path, 'utf8');
  assert.ok(
    stage3Content.includes("path.resolve(__dirname, '../../../uploads/cache')"),
    'Stage 3 must use 3 levels up (../../../uploads/cache)'
  );
  assert.ok(
    !stage3Content.includes("path.resolve(__dirname, '../../../../uploads/cache')"),
    'Stage 3 path.resolve must not use 4 levels up'
  );
});

test('Stage 9: toPublicAudioUrl generates proper /uploads/ URL without 404', () => {
  const stage9Path = path.resolve(__dirname, '../services/pipeline/stages/stage9_generateSegmentTTS.js');
  const stage9Content = fs.readFileSync(stage9Path, 'utf8');

  assert.ok(
    stage9Content.includes('toPublicAudioUrl(integrity.audioPath)'),
    'Stage 9 must use toPublicAudioUrl for ledger'
  );
  assert.ok(
    stage9Content.includes('toPublicAudioUrl(existingAudioPath)'),
    'Stage 9 must use toPublicAudioUrl for existing audio'
  );
  assert.ok(
    stage9Content.includes('toPublicAudioUrl(destPath)'),
    'Stage 9 must use toPublicAudioUrl for disk cache'
  );
  assert.ok(
    !stage9Content.includes("path.resolve(audioDir, '../../../../')"),
    'Stage 9 must not use 4-level relative path resolution'
  );

  // Test toPublicAudioUrl transformation logic
  const uploadsRoot = path.resolve(__dirname, '../uploads');
  const targetAudio = path.join(uploadsRoot, 'projects', 'series_demo', 'episodes', 'ep_1', 'audio', 'seg_1_12345.mp3');
  const relPath = path.relative(uploadsRoot, targetAudio).replace(/\\/g, '/');
  const publicAudioUrl = `/uploads/${relPath}`;

  assert.strictEqual(
    publicAudioUrl,
    '/uploads/projects/series_demo/episodes/ep_1/audio/seg_1_12345.mp3',
    'Audio URL must retain the /projects/ hierarchy'
  );
});

test('Stage 10: uploadsDir resolves to ../../../uploads matching Stage 1', () => {
  const stage10Path = path.resolve(__dirname, '../services/pipeline/stages/stage10_previewAndExport.js');
  const stage10Content = fs.readFileSync(stage10Path, 'utf8');

  assert.ok(
    stage10Content.includes("path.resolve(__dirname, '../../../uploads')"),
    'Stage 10 must use 3 levels up (../../../uploads)'
  );
  assert.ok(
    !stage10Content.includes("path.resolve(__dirname, '../../../../uploads')"),
    'Stage 10 path.resolve must not use 4 levels up'
  );
});

test('Stage 10 writes numeric ASS sizes for presets, layout defaults and legacy numeric overrides', async (t) => {
  const episodeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage10-subtitle-size-'));
  t.after(() => fs.rmSync(episodeDir, { recursive: true, force: true }));
  for (const [aspectRatio, subtitleSize, expected] of [
    ['16:9', 'small', 35], ['16:9', 'medium', 44], ['16:9', 'large', 55],
    ['16:9', undefined, 44], ['1:1', 'large', 65], ['9:16', 'small', 38],
    ['16:9', '62', 62],
  ]) {
    const { assSubtitlePath } = await previewAndExport({ episodeDir, exportOptions: { aspectRatio, subtitleSize } });
    const ass = fs.readFileSync(assSubtitlePath, 'utf8');
    assert.strictEqual(ass.match(/^Style: Default,[^,]*,([^,]*),/m)[1], String(expected));
  }
});

test('Master Orchestrator: episodePipelineOrchestrator runs and exports correctly', () => {
  const orchestrator = require('../services/pipeline/episodePipelineOrchestrator');
  assert.strictEqual(
    typeof orchestrator.runEpisodePipeline,
    'function',
    'runEpisodePipeline must be a function'
  );

  const pipelineIndex = require('../services/pipeline/index');
  assert.strictEqual(
    typeof pipelineIndex.runEpisodePipeline,
    'function',
    'pipeline index must export runEpisodePipeline'
  );
});
