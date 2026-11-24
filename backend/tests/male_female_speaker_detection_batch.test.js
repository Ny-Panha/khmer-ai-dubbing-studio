const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { enrichCuesWithAcousticPitch } = require('../services/pipeline/stages/stage4_analyzeDialogueAudio');
const { syncSegmentsWithSpeakerRegistry, isGenericSpeakerName } = require('../models/speakerRegistry');
const { updateSeriesMetadata, getSeriesMetadata } = require('../services/episodeService');

test('Step 1 (DSP): enrichCuesWithAcousticPitch is exported and safely handles empty or synthetic cues', async () => {
  assert.equal(typeof enrichCuesWithAcousticPitch, 'function', 'enrichCuesWithAcousticPitch must be an exported function');

  // Handle missing audio file gracefully
  const cues = [
    { startSec: 1.0, endSec: 3.0, chineseText: '你好' },
  ];
  await enrichCuesWithAcousticPitch('/non/existent/path.mp3', cues);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startSec, 1.0);
});

test('Step 3 (Anti-Crushing): isGenericSpeakerName identifies generic and non-generic character names', () => {
  assert.equal(isGenericSpeakerName('តួអង្គ'), true);
  assert.equal(isGenericSpeakerName('Speaker 1'), true);
  assert.equal(isGenericSpeakerName('Speaker 2'), true);
  assert.equal(isGenericSpeakerName('Unknown'), true);
  assert.equal(isGenericSpeakerName('spk_1'), true);
  assert.equal(isGenericSpeakerName('Default Speaker'), true);

  // Non-generic names
  assert.equal(isGenericSpeakerName('តួឯកប្រុស'), false);
  assert.equal(isGenericSpeakerName('តួឯកស្រី'), false);
  assert.equal(isGenericSpeakerName('លោកប្រធាន'), false);
  assert.equal(isGenericSpeakerName('អ្នកនាងលី'), false);
});

test('Step 3 (Anti-Crushing): syncSegmentsWithSpeakerRegistry partitions generic cues by acousticGender instead of majority crushing', () => {
  // Scenario: 7 generic dialogue lines where 5 are male pitch and 2 are female pitch.
  // In the old buggy code, all 7 generic lines were lumped into spk_1 majority vote -> all became male!
  // In the new fix, spk_female and spk_male are partitioned so female cues get Sreymom.
  const segments = [
    { id: 1, speaker: 'តួអង្គ', acousticGender: 'male', pitchHz: 120, acousticConfidence: 0.85, originalText: '你好' },
    { id: 2, speaker: 'តួអង្គ', acousticGender: 'male', pitchHz: 130, acousticConfidence: 0.85, originalText: '你是谁' },
    { id: 3, speaker: 'តួអង្គ', acousticGender: 'male', pitchHz: 125, acousticConfidence: 0.85, originalText: '别走' },
    { id: 4, speaker: 'តួអង្គ', acousticGender: 'male', pitchHz: 110, acousticConfidence: 0.85, originalText: '快点' },
    { id: 5, speaker: 'តួអង្គ', acousticGender: 'male', pitchHz: 115, acousticConfidence: 0.85, originalText: '我们去吧' },
    { id: 6, speaker: 'តួអង្គ', acousticGender: 'female', pitchHz: 230, acousticConfidence: 0.90, originalText: '不要这样' },
    { id: 7, speaker: 'តួអង្គ', acousticGender: 'female', pitchHz: 245, acousticConfidence: 0.90, originalText: '救命啊' },
  ];

  const result = syncSegmentsWithSpeakerRegistry(segments, {}, {});
  assert.ok(result.segments, 'Should return updated segments');

  const updatedFemale = result.segments.filter((s) => s.id === 6 || s.id === 7);
  for (const seg of updatedFemale) {
    assert.equal(seg.voiceGender, 'female', `Segment ${seg.id} should preserve female voiceGender`);
    assert.equal(seg.voiceId, 'km-KH-SreymomNeural', `Segment ${seg.id} should receive Sreymom voiceId`);
  }

  const updatedMale = result.segments.filter((s) => s.id <= 5);
  for (const seg of updatedMale) {
    assert.equal(seg.voiceGender, 'male', `Segment ${seg.id} should preserve male voiceGender`);
    assert.equal(seg.voiceId, 'km-KH-PisethNeural', `Segment ${seg.id} should receive Piseth voiceId`);
  }
});

test('Step 4 (Route): POST /api/rescan-episode-gender endpoint validates params and updates metadata', async () => {
  const express = require('express');
  const scriptRoutes = require('../routes/scriptRoutes');

  const app = express();
  app.use(express.json());
  app.use('/api', scriptRoutes);

  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. Missing params -> 400
    const emptyRes = await fetch(`http://127.0.0.1:${port}/api/rescan-episode-gender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(emptyRes.status, 400);

    // 2. Empty segments -> 400
    const emptySegRes = await fetch(`http://127.0.0.1:${port}/api/rescan-episode-gender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId: 'non_existent_series_xyz', episodeId: 'ep_1' }),
    });
    assert.equal(emptySegRes.status, 400);

    // 3. Rescan with valid segments in metadata
    updateSeriesMetadata('test_series_rescan_gender', (data) => {
      return {
        id: 'test_series_rescan_gender',
        episodes: [
          {
            id: 'ep_test_rescan',
            episodeNumber: 1,
            scriptData: {
              segments: [
                { id: 1, speaker: 'តួអង្គ', acousticGender: 'male', pitchHz: 120, originalText: '你好' },
                { id: 2, speaker: 'តួអង្គ', acousticGender: 'female', pitchHz: 230, originalText: '不要' },
              ],
            },
          },
        ],
      };
    });

    const successRes = await fetch(`http://127.0.0.1:${port}/api/rescan-episode-gender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId: 'test_series_rescan_gender', episodeId: 'ep_test_rescan' }),
    });
    const successData = await successRes.json();
    assert.equal(successRes.status, 200);
    assert.equal(successData.success, true);
    assert.equal(successData.maleCueCount, 1);
    assert.equal(successData.femaleCueCount, 1);
    assert.equal(successData.segments[0].voiceId, 'km-KH-PisethNeural');
    assert.equal(successData.segments[1].voiceId, 'km-KH-SreymomNeural');
  } finally {
    server.close();
  }
});
