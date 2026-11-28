const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');
const express = require('express');

const {
  identifySpeakersForCues,
  buildVerifiedSeriesSpeakerMapPatch,
  rescanEpisodeOrSeriesCharacters,
  CHARACTER_RECOGNITION_VERSION,
  computeSeriesRegistryRevision,
  isUnnamedCharacterId,
} = require('../services/pipeline/speakerIdentificationService');
const {
  saveSeriesMetadata,
  getSeriesMetadata,
  deleteSeries,
  createNewEpisode,
} = require('../services/episodeService');
const scriptRoutes = require('../routes/scriptRoutes');

const mockEmptyVisualProbe = async () => new Map();

test('Audit-1: Production code and prompts contain zero hardcoded story-specific character names or IDs', () => {
  const productionFiles = [
    path.join(__dirname, '../services/pipeline/speakerIdentificationService.js'),
    path.join(__dirname, '../services/pipeline/chunkOrchestrator.js'),
    path.join(__dirname, '../services/pipeline/stages/stage3VisionBatchRunner.js'),
    path.join(__dirname, '../services/pipeline/stages/stage6_generateModeSpecificScript.js'),
    path.join(__dirname, '../models/speakerRegistry.js'),
  ];
  const forbiddenPatterns = [
    'ស៊ូ មីង',
    'char_ស៊ូ_មីង',
    'spk_ស៊ូ_មីង',
    '苏铭',
    'លីន ហ្វាង',
    'ម្តាយ ស៊ូ',
    'លោកគ្រូពេទ្យ ចាង',
    'មេឃុំ',
    'តាប្រាក់',
    'ដើមឈើបាច',
    '李天维 男主',
    '灵虚圣地主峰讲坛',
  ];

  for (const filePath of productionFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const bad of forbiddenPatterns) {
      assert.equal(
        content.includes(bad),
        false,
        `Production file ${path.basename(filePath)} must NOT contain story-specific token "${bad}"`
      );
    }
  }
});

test('Audit-2: Prompt generation dynamically reflects ONLY verified series cast and never pre-seeds story names on fresh series', async () => {
  let capturedPromptText = '';
  const cues = [
    { sourceCueId: 'f_1', startSec: 0, endSec: 2, text: '你好！', acousticGender: 'male', pitchHz: 115, acousticConfidence: 0.9, voicedRatio: 0.7 },
  ];

  const res = await identifySpeakersForCues({
    cues,
    seriesId: 'fresh_series_001',
    episodeId: 'ep_1',
    seriesSpeakerMap: {},
    castRegistry: [],
    visualProbeFn: mockEmptyVisualProbe,
    geminiGenerateFn: async ({ parts }) => {
      capturedPromptText = (parts || []).map((p) => p.text || '').join('\n');
      return {
        cues: [{
          sourceCueId: 'f_1',
          speakerName: 'តួអង្គ',
          speakerGender: 'MALE',
          voiceGenderConfidence: 0.91,
          characterIdentityConfidence: 0.88,
          characterNameConfidence: 0.0,
          hasVerifiedName: false,
          nameEvidence: 'none',
          unnamedEntityKey: 'entity_male_1',
          confidence: 0.91,
          evidence: 'Clear young male vocal timbre, no name mentioned in dialogue',
        }],
      };
    },
  });

  assert.ok(capturedPromptText.includes('No verified recurring cast yet for this series'));
  assert.equal(res.castRegistry.length, 0, 'Unnamed characters must NOT be added as verified named cast');
  assert.equal(res.cues.length, 1);
  const cue = res.cues[0];
  assert.equal(cue.speakerGender, 'MALE');
  assert.equal(cue.voiceId, 'km-KH-PisethNeural');
  assert.equal(cue.speakerName, 'តួអង្គ');
  assert.equal(cue.hasVerifiedName, false);
  assert.equal(cue.characterNameConfidence, 0);
  assert.ok(cue.voiceGenderConfidence >= 0.9);
  assert.ok(isUnnamedCharacterId(cue.characterId), `Expected stable char_unnamed_male_* ID, got ${cue.characterId}`);
  assert.ok(isUnnamedCharacterId(cue.speakerId), `Expected stable spk_unnamed_male_* ID, got ${cue.speakerId}`);
});

test('Audit-3: Unnamed male/female recurring voices get distinct stable unnamed IDs without fabricating names, and never pollute seriesSpeakerMap', async () => {
  const cues = [
    { sourceCueId: 'u_m1', startSec: 0, endSec: 2, text: '快走！', acousticGender: 'male', pitchHz: 112, acousticConfidence: 0.9, voicedRatio: 0.72 },
    { sourceCueId: 'u_f1', startSec: 2.2, endSec: 4, text: '等一下！', acousticGender: 'female', pitchHz: 220, acousticConfidence: 0.92, voicedRatio: 0.75 },
    { sourceCueId: 'u_m1b', startSec: 4.2, endSec: 6, text: '别回头！', acousticGender: 'male', pitchHz: 114, acousticConfidence: 0.89, voicedRatio: 0.71 },
  ];

  const res = await identifySpeakersForCues({
    cues,
    seriesId: 'fresh_series_002',
    episodeId: 'ep_1',
    seriesSpeakerMap: {},
    visualProbeFn: mockEmptyVisualProbe,
    geminiGenerateFn: async () => ({
      cues: [
        {
          sourceCueId: 'u_m1',
          // Even if a rogue model returns a guessed personal name alongside low characterNameConfidence / hasVerifiedName=false,
          // the pipeline must strip the unverified name instead of promoting a hallucinated character!
          speakerName: 'តួប្រុសចម្លែក',
          speakerGender: 'MALE',
          voiceGenderConfidence: 0.92,
          characterIdentityConfidence: 0.87,
          characterNameConfidence: 0.15,
          hasVerifiedName: false,
          nameEvidence: 'none',
          unnamedEntityKey: 'entity_male_lead_unknown',
          confidence: 0.92,
        },
        {
          sourceCueId: 'u_f1',
          speakerName: 'តួអង្គ',
          speakerGender: 'FEMALE',
          voiceGenderConfidence: 0.93,
          characterIdentityConfidence: 0.90,
          characterNameConfidence: 0.0,
          hasVerifiedName: false,
          nameEvidence: 'none',
          unnamedEntityKey: 'entity_female_ally_unknown',
          confidence: 0.93,
        },
        {
          sourceCueId: 'u_m1b',
          speakerName: 'តួអង្គ',
          speakerGender: 'MALE',
          voiceGenderConfidence: 0.90,
          characterIdentityConfidence: 0.86,
          characterNameConfidence: 0.0,
          hasVerifiedName: false,
          nameEvidence: 'none',
          unnamedEntityKey: 'entity_male_lead_unknown',
          confidence: 0.90,
        },
      ],
    }),
  });

  const [mA, fA, mA2] = res.cues;
  assert.equal(mA.speakerName, 'តួអង្គ', 'Unverified guessed name must be stripped when hasVerifiedName=false / low characterNameConfidence');
  assert.equal(mA.speakerGender, 'MALE');
  assert.equal(fA.speakerGender, 'FEMALE');
  assert.equal(mA.characterId, mA2.characterId, 'Recurring unnamed male voice must keep stable char_unnamed_male_* ID');
  assert.notEqual(mA.characterId, fA.characterId);

  const patch = buildVerifiedSeriesSpeakerMapPatch(res.cues, {}, {}, { seriesId: 'fresh_series_002' });
  assert.equal(Object.keys(patch).length, 0, 'Unnamed/unverified characters must NOT contaminate persistent seriesSpeakerMap');
});

test('Audit-4: Cross-series contamination is blocked in buildKnownCastIndex, buildVerifiedSeriesSpeakerMapPatch, and computeSeriesRegistryRevision', async () => {
  const contaminatedOtherSeriesMap = {
    spk_other: {
      id: 'spk_other',
      speakerId: 'spk_other',
      characterId: 'char_other',
      seriesId: 'old_series_X',
      name: 'តួអង្គពីរឿងចាស់',
      speakerName: 'តួអង្គពីរឿងចាស់',
      speakerGender: 'MALE',
      gender: 'male',
      voiceId: 'km-KH-PisethNeural',
      recognitionConfidence: 0.95,
    },
  };

  let receivedCast = [];
  const res = await identifySpeakersForCues({
    cues: [{ sourceCueId: 'c1', startSec: 0, endSec: 2, text: '我是韩立。', acousticGender: 'male', pitchHz: 120, acousticConfidence: 0.9, voicedRatio: 0.7 }],
    seriesId: 'new_series_Y',
    episodeId: 'ep_1',
    seriesSpeakerMap: contaminatedOtherSeriesMap,
    visualProbeFn: mockEmptyVisualProbe,
    geminiGenerateFn: async ({ parts }) => {
      receivedCast = parts;
      return {
        cues: [{
          sourceCueId: 'c1',
          speakerName: 'ហាន់ លី',
          chineseAlias: '韩立',
          speakerGender: 'MALE',
          voiceGenderConfidence: 0.94,
          characterIdentityConfidence: 0.94,
          characterNameConfidence: 0.95,
          hasVerifiedName: true,
          nameEvidence: 'spoken self-introduction 我是韩立',
          confidence: 0.94,
        }],
      };
    },
  });

  const promptBlob = receivedCast.map((p) => p.text || '').join('\n');
  assert.equal(promptBlob.includes('តួអង្គពីរឿងចាស់'), false, 'Other-series cast must never leak into current-series prompt');
  assert.equal(res.cues[0].speakerName, 'ហាន់ លី');

  const merged = buildVerifiedSeriesSpeakerMapPatch(res.cues, {}, contaminatedOtherSeriesMap, { seriesId: 'new_series_Y' });
  assert.equal(Boolean(merged.spk_other), false, 'Other-series entry must be stripped during seriesSpeakerMap patch');
  assert.ok(merged[res.cues[0].speakerId]);
  assert.equal(merged[res.cues[0].speakerId].seriesId, 'new_series_Y');

  const rev1 = computeSeriesRegistryRevision(merged, []);
  const rev2 = computeSeriesRegistryRevision({ ...merged, extra: { speakerId: 'spk_extra', name: 'Extra', voiceId: 'km-KH-PisethNeural' } }, []);
  assert.notEqual(rev1, rev2, 'Registry revision hash must change whenever series cast registry changes');
  assert.ok(CHARACTER_RECOGNITION_VERSION);
});

test('Audit-5: Fresh empty series initialization has empty glossary and empty seriesSpeakerMap (server + fallback)', async () => {
  const testSeriesId = `audit_empty_${Date.now()}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit_empty_series_'));
  try {
    const saved = saveSeriesMetadata({
      id: testSeriesId,
      title: 'Fresh Series Test',
      glossary: { characters: [], terms: [] },
      seriesSpeakerMap: {},
      episodes: [{ id: 'ep_1', episodeNumber: 1, title: 'EP1', status: 'idle' }],
    }, { projectsDir: tmpDir });
    assert.ok(saved && saved.id === testSeriesId);

    const loaded = getSeriesMetadata(testSeriesId, { projectsDir: tmpDir, bypassCache: true });
    assert.deepEqual(loaded.glossary.characters, []);
    assert.deepEqual(loaded.seriesSpeakerMap || {}, {});
  } finally {
    deleteSeries(testSeriesId, { projectsDir: tmpDir });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Audit-6: Rescan Characters updates character names/voices while preserving subs, translations, sourceCueId, timing, manual overrides & unchanged-voice TTS audio', async () => {
  const tmpSeries = {
    id: 'rescan_test_series',
    title: 'Rescan Test',
    glossary: {
      characters: [
        { id: 'spk_stale', speakerId: 'spk_stale', name: 'តួចាស់មិនពិត', gender: 'male', voiceId: 'km-KH-PisethNeural' },
      ],
      terms: [],
    },
    seriesSpeakerMap: {
      spk_stale: { id: 'spk_stale', speakerId: 'spk_stale', name: 'តួចាស់មិនពិត', speakerGender: 'MALE', gender: 'male', voiceId: 'km-KH-PisethNeural' },
      spk_manual: { id: 'spk_manual', speakerId: 'spk_manual', characterId: 'char_manual', name: 'គ្រូបង្វឹក (កែដៃ)', speakerGender: 'MALE', gender: 'male', voiceId: 'km-KH-PisethNeural', userOverridden: true, manualCharacterOverridden: true },
    },
    episodes: [
      {
        id: 'ep_1',
        episodeNumber: 1,
        scriptData: {
          mode: 'dialogue',
          segments: [
            {
              id: 1,
              segmentId: 1,
              sourceCueId: 'cue_101',
              startSec: 1.5,
              endSec: 3.8,
              start: '00:00:01,500',
              end: '00:00:03,800',
              originalChineseText: '恭喜宿主激活系统！请宿主做好准备。',
              chineseText: '恭喜宿主激活系统！请宿主做好准备。',
              khmerText: 'ប្រព័ន្ធបានចាប់ផ្តើមហើយ សូមត្រៀមខ្លួន។',
              khmer: 'ប្រព័ន្ធបានចាប់ផ្តើមហើយ សូមត្រៀមខ្លួន។',
              // Previously wrong stale character + wrong MALE voice -> should change to FEMALE & mark voice outdated
              speaker: 'តួចាស់មិនពិត',
              speakerName: 'តួចាស់មិនពិត',
              speakerId: 'spk_stale',
              voiceId: 'km-KH-PisethNeural',
              khmerVoiceId: 'km-KH-PisethNeural',
              audioUrl: '/uploads/old_ep1_seg1.mp3',
              audioPath: 'E:/fake/old_ep1_seg1.mp3',
              audioDurationSec: 2.1,
              acousticGender: 'female',
            },
            {
              id: 2,
              segmentId: 2,
              sourceCueId: 'cue_102',
              startSec: 4.2,
              endSec: 6.9,
              start: '00:00:04,200',
              end: '00:00:06,900',
              originalChineseText: '我是陈风，我一定能活下去！',
              chineseText: '我是陈风，我一定能活下去！',
              khmerText: 'ខ្ញុំឈ្មោះ ចេន ហ្វឹង ខ្ញុំនឹងរស់បន្ត!',
              khmer: 'ខ្ញុំឈ្មោះ ចេន ហ្វឹង ខ្ញុំនឹងរស់បន្ត!',
              // Voice remains km-KH-PisethNeural -> MUST preserve audioUrl/audioPath!
              speaker: 'តួចាស់មិនពិត',
              speakerName: 'តួចាស់មិនពិត',
              speakerId: 'spk_stale',
              voiceId: 'km-KH-PisethNeural',
              khmerVoiceId: 'km-KH-PisethNeural',
              audioUrl: '/uploads/ep1_seg2_valid.mp3',
              audioPath: 'E:/fake/ep1_seg2_valid.mp3',
              audioDurationSec: 2.4,
              acousticGender: 'male',
            },
            {
              id: 3,
              segmentId: 3,
              sourceCueId: 'cue_103',
              startSec: 7.5,
              endSec: 9.2,
              start: '00:00:07,500',
              end: '00:00:09,200',
              originalChineseText: '跟着我走。',
              chineseText: '跟着我走。',
              khmerText: 'ដើរតាមខ្ញុំមក។',
              khmer: 'ដើរតាមខ្ញុំមក។',
              speaker: 'គ្រូបង្វឹក (កែដៃ)',
              speakerName: 'គ្រូបង្វឹក (កែដៃ)',
              speakerId: 'spk_manual',
              characterId: 'char_manual',
              voiceId: 'km-KH-PisethNeural',
              khmerVoiceId: 'km-KH-PisethNeural',
              userOverridden: true,
              manualCharacterOverridden: true,
              voiceAssignmentSource: 'manual',
              audioUrl: '/uploads/ep1_seg3_manual.mp3',
              audioPath: 'E:/fake/ep1_seg3_manual.mp3',
            },
          ],
        },
      },
    ],
  };

  let promptSeen = '';
  const scanRes = await rescanEpisodeOrSeriesCharacters({
    seriesMeta: tmpSeries,
    episodeId: 'ep_1',
    scope: 'episode',
    clearStaleRegistry: true,
    visualProbeFn: mockEmptyVisualProbe,
    geminiGenerateFn: async ({ parts }) => {
      promptSeen = (parts || []).map((p) => p.text || '').join('\n');
      return {
        cues: [
          {
            sourceCueId: 'cue_102',
            speakerName: 'ចេន ហ្វឹង',
            chineseAlias: '陈风',
            speakerGender: 'MALE',
            voiceGenderConfidence: 0.95,
            characterIdentityConfidence: 0.94,
            characterNameConfidence: 0.96,
            hasVerifiedName: true,
            nameEvidence: 'spoken 我是陈风',
            confidence: 0.95,
          },
        ],
      };
    },
  });

  assert.equal(promptSeen.includes('តួចាស់មិនពិត'), false, 'Stale old character name must NOT be seeded into rescan prompt');
  assert.equal(scanRes.episodeResults.length, 1);
  const epRes = scanRes.episodeResults[0];
  assert.equal(epRes.changedVoiceCuesCount, 1);
  assert.equal(epRes.preservedAudioCount, 2);

  const [seg1, seg2, seg3] = epRes.segments;
  // Cue 1: immutable OCR/translation/timing preserved, System female voice assigned, audio marked outdated due to voice change
  assert.equal(seg1.sourceCueId, 'cue_101');
  assert.equal(seg1.originalChineseText, '恭喜宿主激活系统！请宿主做好准备。');
  assert.equal(seg1.khmerText, 'ប្រព័ន្ធបានចាប់ផ្តើមហើយ សូមត្រៀមខ្លួន។');
  assert.equal(seg1.startSec, 1.5);
  assert.equal(seg1.endSec, 3.8);
  assert.equal(seg1.voiceId, 'km-KH-SreymomNeural');
  assert.equal(seg1.audioOutdated, true);
  assert.equal(seg1.audioUrl, null);

  // Cue 2: updated name to ចេន ហ្វឹង, same Piseth voice -> existing audio MUST be preserved!
  assert.equal(seg2.sourceCueId, 'cue_102');
  assert.equal(seg2.speakerName, 'ចេន ហ្វឹង');
  assert.equal(seg2.voiceId, 'km-KH-PisethNeural');
  assert.equal(seg2.audioUrl, '/uploads/ep1_seg2_valid.mp3');
  assert.equal(seg2.audioPath, 'E:/fake/ep1_seg2_valid.mp3');
  assert.notEqual(seg2.audioOutdated, true);

  // Cue 3: manual override strictly preserved
  assert.equal(seg3.speakerName, 'គ្រូបង្វឹក (កែដៃ)');
  assert.equal(seg3.userOverridden, true);
  assert.equal(seg3.audioUrl, '/uploads/ep1_seg3_manual.mp3');

  // Verify HTTP endpoint validation on /api/dubbing/rescan-characters
  const app = express();
  app.use(express.json());
  app.use('/api', scriptRoutes);
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const missingRes = await fetch(`http://127.0.0.1:${port}/api/dubbing/rescan-characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missingRes.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Audit-7: Chunk cache key and metadata validation isolate seriesId, episodeId, recognitionVersion, and registryRevision without clearing Stage 3 OCR', () => {
  const chunkOrchSrc = fs.readFileSync(path.join(__dirname, '../services/pipeline/chunkOrchestrator.js'), 'utf8');
  assert.ok(chunkOrchSrc.includes('CHARACTER_RECOGNITION_VERSION'));
  assert.ok(chunkOrchSrc.includes('computeSeriesRegistryRevision'));
  assert.ok(chunkOrchSrc.includes('cachedChunk.seriesId === effectiveSeriesId'));
  assert.ok(chunkOrchSrc.includes('cachedChunk.episodeId === effectiveEpisodeId'));
  assert.ok(chunkOrchSrc.includes('cachedChunk.characterRecognitionVersion === CHARACTER_RECOGNITION_VERSION'));
  assert.ok(chunkOrchSrc.includes('cachedChunk.registryRevision === chunkRegistryRevision'));

  // Verify computeSeriesRegistryRevision is sensitive to character registry edits while deterministic for identical maps
  const mapA = { spk_a: { speakerId: 'spk_a', characterId: 'char_a', name: 'Hero', voiceId: 'km-KH-PisethNeural' } };
  const mapB = { spk_a: { speakerId: 'spk_a', characterId: 'char_a', name: 'Hero Renamed', voiceId: 'km-KH-PisethNeural' } };
  assert.equal(computeSeriesRegistryRevision(mapA, []), computeSeriesRegistryRevision(mapA, []));
  assert.notEqual(computeSeriesRegistryRevision(mapA, []), computeSeriesRegistryRevision(mapB, []));
});
