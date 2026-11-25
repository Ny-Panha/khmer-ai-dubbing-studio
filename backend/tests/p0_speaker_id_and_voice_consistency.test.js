const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detectSpeakerGender, syncSegmentsWithSpeakerRegistry } = require('../models/speakerRegistry');
const { createSegment } = require('../models/segmentModel');
const { computeAcousticCueFeatures, clusterCueSpeakers } = require('../services/audioClassifierService');
const { identifySpeakersForCues, buildVerifiedSeriesSpeakerMapPatch } = require('../services/pipeline/speakerIdentificationService');
const { applyTranslatedSegmentResult, enforceEpisodeCharacterConsistency } = require('../services/pipeline/stages/stage6PromptAndConsistency');
const { generateSegmentTTS } = require('../services/pipeline/stages/stage9_generateSegmentTTS');
const { persistEpisodeScriptData, getSeriesMetadata, saveSeriesMetadata } = require('../services/episodeService');
const { normalizeScriptData } = require('../services/geminiService');

test('P0-1: Transliterated male name "ស៊ូ មីង" is never poisoned by "មីង" keyword or Khmer pronouns', () => {
  assert.equal(detectSpeakerGender('ស៊ូ មីង', '', ''), 'UNKNOWN');
  const seg = createSegment({
    id: 1,
    sourceCueId: 'cue_1',
    speaker: 'ស៊ូ មីង',
    speakerGender: 'MALE',
    voiceGender: 'male',
    voiceId: 'km-KH-PisethNeural',
    speakerStatus: 'verified',
    voiceAssignmentSource: 'multimodal_verified',
    khmerText: 'បងមើលមីងនោះចុះ នាងមករកខ្ញុំហើយ',
    originalChineseText: '你看那个人来了',
  });
  assert.equal(seg.speakerGender, 'MALE');
  assert.equal(seg.voiceGender, 'male');
  assert.equal(seg.voiceId, 'km-KH-PisethNeural');
});

test('P0-2: Ambiguous acoustic overlap zone (155-175Hz) or high-spread BGM returns unknown & marks review_needed instead of guessing male', () => {
  const sr = 16000;
  const len = sr * 1.5;
  const pcm = new Int16Array(len);
  // 164 Hz ambiguous zone pure tone
  for (let i = 0; i < len; i++) {
    pcm[i] = Math.round(6000 * Math.sin((2 * Math.PI * 164 * i) / sr));
  }
  const feat = computeAcousticCueFeatures(pcm, sr);
  assert.equal(feat.gender, 'unknown', '164Hz must remain unknown rather than forcing male');
  assert.ok(feat.confidence <= 0.55);

  const cues = [
    { id: 1, sourceCueId: 'cue_amb', startSec: 0, endSec: 1.5, pitchHz: 164, acousticGender: 'unknown', acousticConfidence: 0.5, acousticAmbiguous: true, chineseText: '谁在那里' },
  ];
  return identifySpeakersForCues({ cues }).then((res) => {
    assert.equal(res.cues.length, 1);
    assert.equal(res.cues[0].sourceCueId, 'cue_amb');
    assert.equal(res.cues[0].speakerGender, 'UNKNOWN');
    assert.equal(res.cues[0].voiceGender, 'unknown');
    assert.equal(res.cues[0].speakerStatus, 'review_needed');
    assert.equal(res.cues[0].speakerReviewNeeded, true);
    assert.equal(res.cues[0].reviewNeeded, true);
  });
});

test('P0-3: Multimodal Step 1 distinguishes speaker from passive listener, handles off-screen/inner thoughts, preserves 1:1 sourceCueId with internalTurns', async () => {
  const cues = [
    { id: 1, sourceCueId: 'cue_1', startSec: 0, endSec: 2, chineseText: '大哥哥我找到你了', acousticGender: 'female', pitchHz: 215, acousticConfidence: 0.88, voicedRatio: 0.7 },
    { id: 2, sourceCueId: 'cue_2', startSec: 2.1, endSec: 3.1, chineseText: '谁', acousticGender: 'unknown', pitchHz: 235, pitchIqr: 85, bgmSuspected: true, acousticConfidence: 0.45 },
    { id: 3, sourceCueId: 'cue_3', startSec: 3.5, endSec: 6.0, chineseText: '- 他是谁？ - 是苏铭！', acousticGender: 'unknown', pitchHz: 170, acousticAmbiguous: true },
    { id: 4, sourceCueId: 'cue_4', startSec: 7.0, endSec: 9.0, chineseText: '规则十一，禁止夜晚出门', acousticGender: 'female', pitchHz: 220, acousticConfidence: 0.85, voicedRatio: 0.7 },
  ];

  let apiCalls = 0;
  const mockVisualProbe = async () => new Map([
    ['cue_1', { sourceCueId: 'cue_1', faceCount: 1, sceneCutFromPrev: true }],
    ['cue_2', { sourceCueId: 'cue_2', faceCount: 1, sceneCutFromPrev: true }],
    ['cue_3', { sourceCueId: 'cue_3', faceCount: 2, sceneCutFromPrev: true }],
    ['cue_4', { sourceCueId: 'cue_4', faceCount: 0, sceneCutFromPrev: true }],
  ]);

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: async () => {
      apiCalls++;
      return {
        cues: [
          {
            sourceCueId: 'cue_1',
            speakerName: 'ក្មេងស្រីខ្មោច',
            speakerGender: 'FEMALE',
            confidence: 0.94,
            deliveryType: 'out_loud',
            speakerLocation: 'off_screen',
            evidence: 'Little girl voice off-screen behind sleeping boy listener',
          },
          {
            sourceCueId: 'cue_2',
            speakerName: 'យូម៉ា',
            speakerGender: 'MALE',
            confidence: 0.91,
            deliveryType: 'inner_thought',
            speakerLocation: 'on_screen',
            evidence: 'Startled male gasping inside head while girl stands above',
          },
          {
            sourceCueId: 'cue_3',
            speakerName: 'យូម៉ា',
            speakerGender: 'MALE',
            confidence: 0.88,
            deliveryType: 'out_loud',
            speakerLocation: 'on_screen',
            evidence: 'Rapid multi-turn inside single cue',
            internalTurns: [
              { textZh: '他是谁？', speakerName: 'យូម៉ា', speakerGender: 'MALE' },
              { textZh: '是苏铭！', speakerName: 'សិស្សស្រី', speakerGender: 'FEMALE' },
            ],
          },
        ],
      };
    },
  });

  // Deterministic system cue_4 skips Gemini -> only 1 batched Gemini call for cues 1..3!
  assert.equal(apiCalls, 1, 'Expected 1 batched multimodal Gemini call, NOT 1 call per cue');
  assert.equal(res.cues.length, 4, 'Strict 1:1 cue preservation (no merging or splitting)');
  assert.deepEqual(res.cues.map((c) => c.sourceCueId), ['cue_1', 'cue_2', 'cue_3', 'cue_4']);

  assert.equal(res.cues[0].speakerGender, 'FEMALE');
  assert.equal(res.cues[0].voiceId, 'km-KH-SreymomNeural');
  assert.equal(res.cues[1].speakerGender, 'MALE');
  assert.equal(res.cues[1].voiceId, 'km-KH-PisethNeural');
  assert.equal(res.cues[1].deliveryType, 'inner_thought');
  assert.equal(res.cues[2].internalSpeakerTurns.length, 2);
  assert.equal(res.cues[3].speakerName, 'ប្រព័ន្ធ');
  assert.equal(res.cues[3].speakerGender, 'FEMALE');
  assert.equal(res.cues[3].voiceId, 'km-KH-SreymomNeural');
  assert.ok(res.cues[0].speakerEvidence && res.cues[0].speakerEvidence.reason);
});

test('P0-4: Stage 6 translation and Step 2 TTS never override verified Step 1 speakerId/voiceId using Khmer text', async () => {
  const seg = {
    id: 1,
    segmentId: 1,
    sourceCueId: 'cue_locked',
    startSec: 0,
    endSec: 2,
    originalChineseText: '我叫苏铭',
    chineseText: '我叫苏铭',
    speaker: 'ស៊ូ មីង',
    speakerName: 'ស៊ូ មីង',
    speakerId: 'spk_male_ស៊ូ_មីង',
    speakerGender: 'MALE',
    voiceGender: 'male',
    voiceId: 'km-KH-PisethNeural',
    khmerVoiceId: 'km-KH-PisethNeural',
    speakerStatus: 'verified',
    speakerVerified: true,
    voiceAssignmentSource: 'multimodal_verified',
    deliveryType: 'out_loud',
  };

  // Even if Stage 6 translation LLM hallucinates a female speaker and female Khmer pronoun:
  applyTranslatedSegmentResult(
    seg,
    { speaker: 'មីងចាន់', speakerGender: 'FEMALE', khmer: 'នាងខ្ញុំឈ្មោះស៊ូមីង' },
    0,
    { isFastOcrMode: true, defaultGender: 'male' }
  );
  assert.equal(seg.voiceGender, 'male', 'Stage 6 must not overwrite verified Step 1 gender');
  assert.equal(seg.voiceId, 'km-KH-PisethNeural');
  assert.equal(seg.speakerId, 'spk_male_ស៊ូ_មីង');

  const afterConsistency = enforceEpisodeCharacterConsistency([seg], { isFastOcrMode: true });
  const consistentSegs = Array.isArray(afterConsistency) ? afterConsistency : (afterConsistency.segments || []);
  assert.equal(consistentSegs[0].voiceId, 'km-KH-PisethNeural');

  const norm = normalizeScriptData({ segments: [consistentSegs[0]] }, 'dialogue');
  assert.equal(norm.segments[0].voiceId, 'km-KH-PisethNeural');
  assert.equal(norm.segments[0].speakerGender, 'MALE');

  // Step 2 TTS keeps Piseth even when defaultVoiceId is Sreymom and khmerText contains នាងខ្ញុំ
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0_step2_lock_'));
  try {
    const ttsRes = await generateSegmentTTS({
      segments: [norm.segments[0]],
      audioDir: tmpDir,
      defaultVoiceId: 'km-KH-SreymomNeural',
    });
    assert.equal(ttsRes.segmentsWithAudio[0].voiceId, 'km-KH-PisethNeural');
    assert.equal(ttsRes.segmentsWithAudio[0].actualVoiceId, 'km-KH-PisethNeural');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P0-5: Cross-episode memory persists verified speakerId and voice from EP1 to EP28 via seriesSpeakerMap', async () => {
  const tmpProjects = fs.mkdtempSync(path.join(os.tmpdir(), 'p0_cross_ep_'));
  try {
    const seriesId = 'series_p0_ep1_ep28';
    saveSeriesMetadata({
      id: seriesId,
      title: 'P0 Series',
      episodes: [
        { id: 'ep_1', episodeNumber: 1, title: 'EP1' },
        { id: 'ep_28', episodeNumber: 28, title: 'EP28' },
      ],
    }, { projectsDir: tmpProjects });

    const ep1Segs = [
      {
        id: 1,
        sourceCueId: 'cue_1',
        startSec: 0,
        endSec: 2,
        originalChineseText: '我叫苏铭',
        khmerTranslatedText: 'ខ្ញុំឈ្មោះ ស៊ូ មីង',
        speaker: 'ស៊ូ មីង',
        speakerName: 'ស៊ូ មីង',
        speakerId: 'spk_male_ស៊ូ_មីង',
        speakerGender: 'MALE',
        voiceGender: 'male',
        voiceId: 'km-KH-PisethNeural',
        khmerVoiceId: 'km-KH-PisethNeural',
        speakerConfidence: 0.94,
        speakerStatus: 'verified',
        voiceAssignmentSource: 'multimodal_verified',
      },
      {
        id: 2,
        sourceCueId: 'cue_2',
        startSec: 2,
        endSec: 4,
        originalChineseText: '恭喜宿主',
        khmerTranslatedText: 'សូមអបអរសាទរ',
        speaker: 'ប្រព័ន្ធ',
        speakerName: 'ប្រព័ន្ធ',
        speakerId: 'spk_female_ប្រព័ន្ធ',
        speakerGender: 'FEMALE',
        voiceGender: 'female',
        voiceId: 'km-KH-SreymomNeural',
        khmerVoiceId: 'km-KH-SreymomNeural',
        speakerConfidence: 0.95,
        speakerStatus: 'verified',
        voiceAssignmentSource: 'local_system_rule',
      },
    ];

    await persistEpisodeScriptData({
      seriesId,
      episodeId: 'ep_1',
      scriptData: { mode: 'dialogue', segments: ep1Segs, speakerRegistry: {} },
      projectsDir: tmpProjects,
    });

    const loaded = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir: tmpProjects });
    assert.ok(loaded.seriesSpeakerMap['spk_male_ស៊ូ_មីង'], 'seriesSpeakerMap must persist EP1 verified male character');
    assert.ok(loaded.seriesSpeakerMap['spk_female_ប្រព័ន្ធ'], 'seriesSpeakerMap must persist EP1 verified female system');

    // Simulate EP28 arriving with spacing drift ("ស៊ូមីង") -> matches canonical ID & Piseth
    const ep28Res = syncSegmentsWithSpeakerRegistry([
      {
        id: 1,
        sourceCueId: 'cue_ep28_1',
        startSec: 1,
        endSec: 3,
        originalChineseText: '走吧',
        khmerTranslatedText: 'តោះ',
        speaker: 'ស៊ូមីង',
      },
    ], { seriesSpeakerMap: loaded.seriesSpeakerMap });

    assert.equal(ep28Res.segments[0].voiceId, 'km-KH-PisethNeural');
    assert.equal(ep28Res.segments[0].voiceGender, 'male');
  } finally {
    fs.rmSync(tmpProjects, { recursive: true, force: true });
  }
});

test('P0-6: Local acoustic clustering groups same-speaker cues while separating distinct voices', () => {
  const cues = [
    { id: 1, pitchHz: 118, spectralCentroidHz: 520, highMidRatio: 0.45, voicedRatio: 0.8, acousticGender: 'male', bgmSuspected: false },
    { id: 2, pitchHz: 224, spectralCentroidHz: 1150, highMidRatio: 1.45, voicedRatio: 0.82, acousticGender: 'female', bgmSuspected: false },
    { id: 3, pitchHz: 122, spectralCentroidHz: 540, highMidRatio: 0.48, voicedRatio: 0.78, acousticGender: 'male', bgmSuspected: false },
  ];
  clusterCueSpeakers(cues);
  assert.equal(cues[0].acousticClusterId, cues[2].acousticClusterId, 'Same male voice belongs to same cluster');
  assert.notEqual(cues[0].acousticClusterId, cues[1].acousticClusterId, 'Male and female voices belong to distinct clusters');
});
