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
} = require('../services/pipeline/speakerIdentificationService');
const {
  buildSpeakerRegistry,
  syncSegmentsWithSpeakerRegistry,
  isPositionalSpeakerId,
  isPlaceholderSpeakerName,
} = require('../models/speakerRegistry');
const { deduplicateFastOcrCues } = require('../services/pipeline/stages/stage3VisionBatchRunner');
const { enforceFastOcrCharacterConsistency } = require('../services/pipeline/stages/stage6PromptAndConsistency');
const { generateSegmentTTS } = require('../services/pipeline/stages/stage9_generateSegmentTTS');
const { verifyAudioFileProvenance } = require('../services/ttsService');
const {
  saveSeriesMetadata,
  getSeriesMetadata,
  deleteSeries,
} = require('../services/episodeService');
const seriesRoutes = require('../routes/seriesRoutes');

function createMockMultiCharGemini(cueToCharacterMap) {
  return async ({ batch = [] }) => {
    const cues = (batch || []).map((item) => {
      const id = item?.cue?.sourceCueId || item?.sourceCueId;
      const def = cueToCharacterMap[id] || {
        speakerName: 'តួអង្គ',
        speakerGender: 'UNKNOWN',
        confidence: 0.4,
        evidence: 'Uncertain speaker',
      };
      return {
        sourceCueId: id,
        speakerName: def.speakerName,
        speakerGender: def.speakerGender,
        confidence: def.confidence,
        evidence: def.evidence,
        isAmbiguous: Boolean(def.isAmbiguous ?? (def.speakerGender === 'UNKNOWN')),
        ...(def.chineseAlias ? { chineseAlias: def.chineseAlias } : {}),
        ...(def.visualAppearance ? { visualAppearance: def.visualAppearance } : {}),
        ...(def.voiceTimbreDesc ? { voiceTimbreDesc: def.voiceTimbreDesc } : {}),
      };
    });
    return { cues };
  };
}

const mockEmptyVisualProbe = async () => new Map();

test('P0-CR1: Distinct male and female characters remain separate across turns (never merged by gender or generic role)', async () => {
  const cues = [
    { sourceCueId: 'c_m1', startSec: 0, endSec: 2.0, text: '我叫苏明。', khmerText: 'ខ្ញុំឈ្មោះ ស៊ូ មីង។', acousticGender: 'male', pitchHz: 105, pitchIqr: 14, acousticConfidence: 0.91, voicedRatio: 0.72, acousticClusterId: 'spk_a', speaker: 'តួអង្គ' },
    { sourceCueId: 'c_m2', startSec: 2.2, endSec: 4.1, text: '我是李王。', khmerText: 'ខ្ញុំគឺ លី វ៉ាង។', acousticGender: 'male', pitchHz: 132, pitchIqr: 15, acousticConfidence: 0.89, voicedRatio: 0.70, acousticClusterId: 'spk_b', speaker: 'តួអង្គ' },
    { sourceCueId: 'c_f1', startSec: 4.3, endSec: 6.2, text: '我是林清。', khmerText: 'ខ្ញុំនាង លីន ឈីង។', acousticGender: 'female', pitchHz: 228, pitchIqr: 18, acousticConfidence: 0.90, voicedRatio: 0.75, acousticClusterId: 'spk_c', speaker: 'តួអង្គ' },
    { sourceCueId: 'c_f2', startSec: 6.4, endSec: 8.3, text: '我是张舒。', khmerText: 'ខ្ញុំឈ្មោះ ចាង ស៊ូ។', acousticGender: 'female', pitchHz: 196, pitchIqr: 16, acousticConfidence: 0.88, voicedRatio: 0.74, acousticClusterId: 'spk_d', speaker: 'តួអង្គ' },
    { sourceCueId: 'c_u1', startSec: 8.5, endSec: 9.8, text: '谁在外面？', khmerText: 'នរណានៅខាងក្រៅ?', acousticGender: 'unknown', pitchHz: 0, acousticConfidence: 0.25, voicedRatio: 0.12, bgmSuspected: true, speaker: 'តួអង្គ' },
  ];

  const mockGemini = createMockMultiCharGemini({
    c_m1: { speakerName: 'ស៊ូ មីង', speakerGender: 'MALE', confidence: 0.92, evidence: 'Man in black jacket speaking', chineseAlias: '苏明', visualAppearance: 'Young man in black coat', voiceTimbreDesc: 'Deep calm baritone' },
    c_m2: { speakerName: 'លី វ៉ាង', speakerGender: 'MALE', confidence: 0.90, evidence: 'Older man in grey suit speaking', chineseAlias: '李王', visualAppearance: 'Middle-aged man in grey suit', voiceTimbreDesc: 'Raspy mid baritone' },
    c_f1: { speakerName: 'លីន ឈីង', speakerGender: 'FEMALE', confidence: 0.91, evidence: 'Woman in white dress speaking', chineseAlias: '林清', visualAppearance: 'Woman in white dress', voiceTimbreDesc: 'Clear bright soprano' },
    c_f2: { speakerName: 'ចាង ស៊ូ', speakerGender: 'FEMALE', confidence: 0.89, evidence: 'Woman in red coat speaking', chineseAlias: '张舒', visualAppearance: 'Woman in red coat', voiceTimbreDesc: 'Warm mezzo' },
    c_u1: { speakerName: 'តួអង្គ', speakerGender: 'UNKNOWN', confidence: 0.35, evidence: 'Off-screen blurred speaker over BGM' },
  });

  const res = await identifySpeakersForCues({
    cues,
    seriesId: 'series_cr1',
    episodeId: 'ep_1',
    geminiGenerateFn: mockGemini,
    visualProbeFn: mockEmptyVisualProbe,
  });

  assert.equal(res.cues.length, 5);
  assert.deepEqual(res.cues.map((c) => c.sourceCueId), cues.map((c) => c.sourceCueId));

  const [m1, m2, f1, f2, u1] = res.cues;
  // Different male characters remain distinct
  assert.notEqual(m1.speakerId, m2.speakerId);
  assert.notEqual(m1.characterId, m2.characterId);
  assert.equal(m1.voiceId, 'km-KH-PisethNeural');
  assert.equal(m2.voiceId, 'km-KH-PisethNeural');

  // Different female characters remain distinct
  assert.notEqual(f1.speakerId, f2.speakerId);
  assert.notEqual(f1.characterId, f2.characterId);
  assert.equal(f1.voiceId, 'km-KH-SreymomNeural');
  assert.equal(f2.voiceId, 'km-KH-SreymomNeural');

  // Uncertain speaker marked review_needed rather than merged or invented
  assert.equal(u1.speakerStatus, 'review_needed');
  assert.equal(u1.speakerReviewNeeded, true);
  assert.notEqual(u1.speakerId, m1.speakerId);
  assert.notEqual(u1.speakerId, f1.speakerId);
});

test('P0-CR2: Cross-episode memory matches returning character despite clothing/scene change, keeps new character separate, and isolates seriesId', async () => {
  const ep1Cues = [
    { sourceCueId: 'ep1_1', startSec: 0, endSec: 2, text: '我是苏明。', khmerText: 'ខ្ញុំឈ្មោះ ស៊ូ មីង។', acousticGender: 'male', pitchHz: 108, pitchIqr: 12, acousticConfidence: 0.92, voicedRatio: 0.78, acousticClusterId: 'cl_sm' },
  ];
  const ep1Mock = createMockMultiCharGemini({
    ep1_1: { speakerName: 'ស៊ូ មីង', speakerGender: 'MALE', confidence: 0.93, evidence: 'Lead actor in suit', chineseAlias: '苏明', visualAppearance: 'Black trench coat', voiceTimbreDesc: 'Steady baritone' },
  });

  const ep1Res = await identifySpeakersForCues({
    cues: ep1Cues,
    seriesId: 'series_alpha',
    episodeId: 'ep_1',
    geminiGenerateFn: ep1Mock,
    visualProbeFn: mockEmptyVisualProbe,
  });

  const seriesAlphaMap = buildVerifiedSeriesSpeakerMapPatch(ep1Res.cues, {}, {});
  assert.ok(Object.keys(seriesAlphaMap).length >= 1);

  const ep1Sm = ep1Res.cues[0];
  assert.ok(ep1Sm.characterId);
  assert.equal(ep1Sm.voiceId, 'km-KH-PisethNeural');

  // EP4: returning ស៊ូ មីង in different clothing/alias + new male character ថៅកែ ចូវ + ambiguous cue after ថៅកែ ចូវ
  const ep4Cues = [
    { sourceCueId: 'ep4_1', startSec: 0, endSec: 2, text: '苏明来了。', khmerText: 'ខ្ញុំមកដល់ហើយ។', acousticGender: 'male', pitchHz: 110, pitchIqr: 14, acousticConfidence: 0.90, voicedRatio: 0.74 },
    { sourceCueId: 'ep4_2', startSec: 2.2, endSec: 4.5, text: '我是周老板。', khmerText: 'ខ្ញុំគឺ ថៅកែ ចូវ។', acousticGender: 'male', pitchHz: 146, pitchIqr: 15, acousticConfidence: 0.89, voicedRatio: 0.72 },
    { sourceCueId: 'ep4_3', startSec: 4.7, endSec: 6.0, text: '小心！', khmerText: 'ប្រយ័ត្ន!', acousticGender: 'unknown', pitchHz: 0, acousticConfidence: 0.2, voicedRatio: 0.1, bgmSuspected: true },
  ];
  const ep4Mock = createMockMultiCharGemini({
    ep4_1: { speakerName: '苏明', speakerGender: 'MALE', confidence: 0.88, evidence: 'Same actor now wearing hospital gown', visualAppearance: 'Hospital gown' },
    ep4_2: { speakerName: 'ថៅកែ ចូវ', speakerGender: 'MALE', confidence: 0.91, evidence: 'New antagonist CEO in blue suit', chineseAlias: '周老板', visualAppearance: 'Blue pinstripe suit', voiceTimbreDesc: 'Sharp tenor-baritone' },
    ep4_3: { speakerName: 'តួអង្គ', speakerGender: 'UNKNOWN', confidence: 0.30, evidence: 'Offscreen shout in dark room' },
  });

  const ep4Res = await identifySpeakersForCues({
    cues: ep4Cues,
    seriesId: 'series_alpha',
    episodeId: 'ep_4',
    seriesSpeakerMap: seriesAlphaMap,
    geminiGenerateFn: ep4Mock,
    visualProbeFn: mockEmptyVisualProbe,
  });

  const [retSm, newBoss, unk] = ep4Res.cues;
  assert.equal(retSm.characterId, ep1Sm.characterId);
  assert.equal(retSm.speakerId, ep1Sm.speakerId);
  assert.equal(retSm.voiceId, ep1Sm.voiceId);
  assert.equal(retSm.speakerName, 'ស៊ូ មីង');

  // New character does not overwrite existing identity
  assert.notEqual(newBoss.characterId, ep1Sm.characterId);
  assert.notEqual(newBoss.speakerId, ep1Sm.speakerId);
  assert.equal(newBoss.speakerName, 'ថៅកែ ចូវ');

  // Ambiguous cue does not blindly inherit previous character's name
  assert.equal(unk.speakerStatus, 'review_needed');
  assert.notEqual(unk.speakerId, newBoss.speakerId);
  assert.notEqual(unk.speakerName, 'ថៅកែ ចូវ');

  // Series Beta without Alpha's seriesSpeakerMap stays isolated
  const betaRes = await identifySpeakersForCues({
    cues: [{ sourceCueId: 'b_1', startSec: 0, endSec: 2, text: '你好', khmerText: 'សួស្តី', acousticGender: 'male', pitchHz: 112, pitchIqr: 14, acousticConfidence: 0.88, voicedRatio: 0.7 }],
    seriesId: 'series_beta',
    episodeId: 'ep_1',
    seriesSpeakerMap: {},
    geminiGenerateFn: createMockMultiCharGemini({
      b_1: { speakerName: 'អាភីង', speakerGender: 'MALE', confidence: 0.89, evidence: 'Series Beta lead' },
    }),
    visualProbeFn: mockEmptyVisualProbe,
  });
  assert.notEqual(betaRes.cues[0].characterId, ep1Sm.characterId);
  assert.equal(betaRes.cues[0].speakerName, 'អាភីង');
});

test('P0-CR3: Generic system broadcasts stay isolated and never overwrite recurring characters', async () => {
  const cues = [
    { sourceCueId: 's_1', startSec: 0, endSec: 2, text: '怎么回事？', khmerText: 'មានរឿងអ្វី?', acousticGender: 'male', pitchHz: 108, pitchIqr: 12, acousticConfidence: 0.9, voicedRatio: 0.72 },
    { sourceCueId: 's_sys', startSec: 2.1, endSec: 4.5, text: '恭喜宿主激活系统！任务已开启！', khmerText: 'ប្រព័ន្ធជូនដំណឹង៖ បេសកកម្មបានចាប់ផ្តើម!', speaker: 'ប្រព័ន្ធ', acousticGender: 'female', pitchHz: 235, pitchIqr: 15, acousticConfidence: 0.86, voicedRatio: 0.7 },
    { sourceCueId: 's_2', startSec: 4.6, endSec: 6.5, text: '我明白了。', khmerText: 'ខ្ញុំយល់ហើយ។', acousticGender: 'male', pitchHz: 110, pitchIqr: 13, acousticConfidence: 0.91, voicedRatio: 0.74 },
  ];

  const mockGemini = createMockMultiCharGemini({
    s_1: { speakerName: 'ស៊ូ មីង', speakerGender: 'MALE', confidence: 0.92, evidence: 'Male protagonist' },
    s_2: { speakerName: 'ស៊ូ មីង', speakerGender: 'MALE', confidence: 0.91, evidence: 'Male protagonist responds' },
  });

  const res = await identifySpeakersForCues({
    cues,
    seriesId: 'series_sys',
    episodeId: 'ep_3',
    geminiGenerateFn: mockGemini,
    visualProbeFn: mockEmptyVisualProbe,
  });

  const [c1, cSys, c2] = res.cues;
  assert.equal(c1.speakerName, 'ស៊ូ មីង');
  assert.equal(c1.voiceId, 'km-KH-PisethNeural');
  assert.equal(cSys.speakerName, 'ប្រព័ន្ធ');
  assert.equal(cSys.voiceId, 'km-KH-SreymomNeural');
  assert.ok(cSys.speakerId.startsWith('spk_female_'));
  assert.notEqual(cSys.characterId, c1.characterId);
  assert.equal(c2.speakerName, 'ស៊ូ មីង');
  assert.equal(c2.characterId, c1.characterId);
  assert.equal(c2.voiceId, 'km-KH-PisethNeural');

  const patch = buildVerifiedSeriesSpeakerMapPatch(res.cues, {}, {});
  // Generic bare name 'ប្រព័ន្ធ' must NOT pollute bare key lookups
  assert.equal(patch['ប្រព័ន្ធ'], undefined);
  assert.ok(patch[c1.speakerId]);
  assert.equal(patch[c1.speakerId].voiceId, 'km-KH-PisethNeural');
});

test('P0-CR4: Step 1 -> Stage 3 deduplicateFastOcrCues -> Stage 6 -> Stage 9 TTS preserves 1:1 sourceCueId, identity & real MP3 voice provenance', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-cr4-tts-'));
  const audioDir = path.join(tmpRoot, 'audio');
  t.after(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  });

  const step1Cues = [
    { sourceCueId: 'cue_1', id: 1, startSec: 0, endSec: 2.0, text: '你好。', chineseText: '你好。', khmerText: 'សួស្តី។', khmerTranslatedText: 'សួស្តី។', acousticGender: 'male', pitchHz: 112, pitchIqr: 14, acousticConfidence: 0.90, voicedRatio: 0.72, chunkIndex: 0 },
    { sourceCueId: 'cue_2', id: 2, startSec: 2.2, endSec: 4.5, text: '请进。', chineseText: '请进。', khmerText: 'សូមអញ្ជើញចូល។', khmerTranslatedText: 'សូមអញ្ជើញចូល។', acousticGender: 'female', pitchHz: 224, pitchIqr: 16, acousticConfidence: 0.91, voicedRatio: 0.75, chunkIndex: 0 },
  ];

  const step1 = await identifySpeakersForCues({
    cues: step1Cues,
    seriesId: 'series_cr4',
    episodeId: 'ep_1',
    geminiGenerateFn: createMockMultiCharGemini({
      cue_1: { speakerName: 'ស៊ូ មីង', speakerGender: 'MALE', confidence: 0.93, evidence: 'Lead actor' },
      cue_2: { speakerName: 'លីន ឈីង', speakerGender: 'FEMALE', confidence: 0.92, evidence: 'Lead actress' },
    }),
    visualProbeFn: mockEmptyVisualProbe,
  });

  // Simulate post-Step-1 global deduplicateFastOcrCues (root bug previously clobbered speakers to 'តួអង្គ'/'spk_ocr_*')
  const deduped = deduplicateFastOcrCues(step1.cues, 'female');
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((s) => s.sourceCueId), ['cue_1', 'cue_2']);
  assert.equal(deduped[0].speakerName, 'ស៊ូ មីង');
  assert.equal(deduped[1].speakerName, 'លីន ឈីង');
  assert.equal(isPositionalSpeakerId(deduped[0].speakerId), false);
  assert.equal(isPlaceholderSpeakerName(deduped[0].speakerName), false);

  // Build registry + Stage 6 consistency + Stage 9 TTS
  const reg = buildSpeakerRegistry(deduped, {});
  const synced = syncSegmentsWithSpeakerRegistry(deduped, {}, reg);
  const stage6Res = enforceFastOcrCharacterConsistency(synced.segments);
  const stage6Out = stage6Res.segments;

  assert.equal(stage6Out[0].userOverridden, false);
  assert.equal(stage6Out[1].userOverridden, false);
  assert.equal(stage6Out[0].voiceId, 'km-KH-PisethNeural');
  assert.equal(stage6Out[1].voiceId, 'km-KH-SreymomNeural');

  const { segmentsWithAudio, ttsReport } = await generateSegmentTTS({
    segments: stage6Out,
    audioDir,
    defaultVoiceId: 'km-KH-PisethNeural',
    speakerRegistry: reg,
    forceRegen: true,
    concurrency: 1,
    seriesId: 'series_cr4',
    episodeId: 'ep_1',
    baseUploadsDir: tmpRoot,
    autoShortenOverflow: false,
  });

  assert.equal(ttsReport.failedCount, 0);
  assert.equal(segmentsWithAudio.length, 2);
  assert.deepEqual(segmentsWithAudio.map((s) => s.sourceCueId), ['cue_1', 'cue_2']);

  for (const [idx, expectedVoice] of [[0, 'km-KH-PisethNeural'], [1, 'km-KH-SreymomNeural']]) {
    const seg = segmentsWithAudio[idx];
    assert.equal(seg.voiceId, expectedVoice);
    assert.equal(seg.actualVoiceId, expectedVoice);
    assert.equal(seg.characterId, stage6Out[idx].characterId);
    assert.equal(seg.speakerId, stage6Out[idx].speakerId);
    assert.ok(fs.existsSync(seg.audioPath));
    const prov = verifyAudioFileProvenance(seg.audioPath, {
      voiceId: expectedVoice,
      text: seg.khmerTranslatedText,
    });
    assert.equal(prov.valid, true, `Provenance mismatch on segment ${idx}: ${prov.reason}`);
    assert.equal(prov.meta.actualVoiceId, expectedVoice);
  }
});

test('P0-CR5: Manual speaker identity & voice override via PATCH /api/series/:seriesId/speaker-identity persists on disk & transfers to unseen episode', async (t) => {
  const testSeriesId = `__test_p0_char_rec_${Date.now()}`;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/series', seriesRoutes);

  let server;
  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    deleteSeries(testSeriesId);
  });

  const initialSegsEp1 = [
    {
      id: 1,
      sourceCueId: 'ep1_c1',
      startSec: 0,
      endSec: 2,
      text: '怎么了？',
      khmerTranslatedText: 'មានរឿងអ្វី?',
      speaker: 'តួអង្គ',
      speakerName: 'តួអង្គ',
      speakerId: 'spk_ocr_1',
      characterId: 'char_ocr_1',
      speakerGender: 'UNKNOWN',
      voiceId: 'km-KH-PisethNeural',
      speakerStatus: 'review_needed',
      speakerReviewNeeded: true,
    },
    {
      id: 2,
      sourceCueId: 'ep1_c2',
      startSec: 2.2,
      endSec: 4.5,
      text: '别过来！',
      khmerTranslatedText: 'កុំមកជិត!',
      speaker: 'លី វ៉ាង',
      speakerName: 'លី វ៉ាង',
      speakerId: 'spk_male_li_wang',
      characterId: 'char_li_wang',
      speakerGender: 'MALE',
      voiceGender: 'male',
      voiceId: 'km-KH-PisethNeural',
      speakerStatus: 'verified',
      speakerVerified: true,
      speakerReviewNeeded: false,
    },
    {
      id: 3,
      sourceCueId: 'ep1_c3',
      startSec: 4.8,
      endSec: 7.0,
      text: '是我。',
      khmerTranslatedText: 'គឺខ្ញុំទេ។',
      speaker: 'តួអង្គ',
      speakerName: 'តួអង្គ',
      speakerId: 'spk_ocr_1',
      characterId: 'char_ocr_1',
      speakerGender: 'UNKNOWN',
      voiceId: 'km-KH-PisethNeural',
      speakerStatus: 'review_needed',
      speakerReviewNeeded: true,
    },
  ];

  saveSeriesMetadata({
    id: testSeriesId,
    title: testSeriesId,
    episodes: [
      {
        id: 'ep_1',
        episodeNumber: 1,
        title: 'Episode 1',
        speakerRegistry: buildSpeakerRegistry(initialSegsEp1, {}),
        scriptData: { mode: 'dialogue', segments: initialSegsEp1 },
      },
      {
        id: 'ep_2',
        episodeNumber: 2,
        title: 'Episode 2',
        scriptData: { mode: 'dialogue', segments: [] },
      },
    ],
    seriesSpeakerMap: {},
  });

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  const patchRes = await fetch(`http://127.0.0.1:${port}/api/series/${encodeURIComponent(testSeriesId)}/speaker-identity`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      episodeId: 'ep_1',
      targetKey: 'spk_ocr_1',
      targetCharacterId: 'char_ocr_1',
      newName: 'ស៊ូ មីង',
      newVoiceId: 'km-KH-PisethNeural',
      newGender: 'male',
      applyAcrossSeries: true,
    }),
  });
  assert.equal(patchRes.status, 200);
  const body = await patchRes.json();
  assert.equal(body.success, true);
  assert.equal(body.updatedCount, 2);

  // Force cold disk read (simulating reload & server restart)
  const reloaded = getSeriesMetadata(testSeriesId, { forceDisk: true });
  const reloadedEp1 = reloaded.episodes.find((e) => e.id === 'ep_1');
  const [c1, c2, c3] = reloadedEp1.scriptData.segments;

  // Target cues updated & marked manual; 1:1 sourceCueId intact
  assert.deepEqual(reloadedEp1.scriptData.segments.map((s) => s.sourceCueId), ['ep1_c1', 'ep1_c2', 'ep1_c3']);
  assert.equal(c1.speakerName, 'ស៊ូ មីង');
  assert.equal(c3.speakerName, 'ស៊ូ មីង');
  assert.equal(c1.characterId, c3.characterId);
  assert.equal(c1.speakerId, c3.speakerId);
  assert.equal(isPositionalSpeakerId(c1.speakerId), false);
  assert.equal(c1.manualCharacterOverridden, true);
  assert.equal(c1.userOverridden, true);
  assert.equal(c1.speakerReviewNeeded, false);

  // Unrelated character remained completely untouched
  assert.equal(c2.speakerId, 'spk_male_li_wang');
  assert.equal(c2.characterId, 'char_li_wang');
  assert.equal(c2.speakerName, 'លី វ៉ាង');
  assert.notEqual(c2.userOverridden, true);

  // Persisted seriesSpeakerMap recognizes returning ស៊ូ មីង in unseen EP2
  assert.ok(reloaded.seriesSpeakerMap['ស៊ូ មីង']);
  const unseenEp2Res = await identifySpeakersForCues({
    cues: [
      { sourceCueId: 'ep2_c1', startSec: 0, endSec: 2, text: '苏明在这里。', khmerText: 'ខ្ញុំនៅទីនេះ។', acousticGender: 'male', pitchHz: 111, pitchIqr: 14, acousticConfidence: 0.90, voicedRatio: 0.72 },
    ],
    seriesId: testSeriesId,
    episodeId: 'ep_2',
    seriesSpeakerMap: reloaded.seriesSpeakerMap,
    geminiGenerateFn: createMockMultiCharGemini({
      ep2_c1: { speakerName: 'ស៊ូ មីង', speakerGender: 'MALE', confidence: 0.87, evidence: 'Same character returns' },
    }),
    visualProbeFn: mockEmptyVisualProbe,
  });
  assert.equal(unseenEp2Res.cues[0].characterId, c1.characterId);
  assert.equal(unseenEp2Res.cues[0].speakerId, c1.speakerId);
  assert.equal(unseenEp2Res.cues[0].voiceId, 'km-KH-PisethNeural');
});

test('P0-CR6: Frontend speakerUtils & projectStorage exclude positional spk_ocr_* and placeholder តួអង្គ entries while preserving characterId', async () => {
  const { pathToFileURL } = require('node:url');
  const speakerUtilsPath = path.resolve(__dirname, '../../frontend/src/utils/speakerUtils.js');
  const projectStoragePath = path.resolve(__dirname, '../../frontend/src/utils/projectStorage.js');
  const { buildSpeakerRegistry: feBuildSpeakerRegistry } = await import(pathToFileURL(speakerUtilsPath).href);
  const { extractGlossaryFromEpisode } = await import(pathToFileURL(projectStoragePath).href);

  const mockSegments = [
    { id: 1, speaker: 'តួអង្គ', speakerId: 'spk_ocr_1', voiceId: 'km-KH-PisethNeural', speakerStatus: 'review_needed' },
    { id: 2, speaker: 'ស៊ូ មីង', speakerId: 'spk_male_su_ming', characterId: 'char_su_ming', speakerGender: 'MALE', voiceGender: 'male', voiceId: 'km-KH-PisethNeural', manualCharacterOverridden: true },
  ];

  const feReg = feBuildSpeakerRegistry(mockSegments, {});
  assert.equal(feReg['spk_male_su_ming']?.characterId, 'char_su_ming');
  assert.equal(feReg['spk_male_su_ming']?.manualCharacterOverridden, true);

  const glossary = extractGlossaryFromEpisode(mockSegments, feReg);
  const charNames = (glossary?.characters || []).map((c) => c.khmerName || c.name);
  assert.equal(charNames.includes('តួអង្គ'), false);
  assert.equal(charNames.includes('ស៊ូ មីង'), true);
});
