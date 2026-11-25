/**
 * Bug Condition Exploration Tests
 * 
 * These tests reproduce the 5 bug conditions causing incorrect speaker assignments.
 * They are EXPECTED TO FAIL on unfixed code - failure confirms the bugs exist.
 * 
 * Bug Conditions:
 * 1. Generic Identity Gender Inheritance (3 tests)
 * 2. Character vs Voice Actor Confusion (3 tests)
 * 3. Speaker Change Detection Failure (3 tests)
 * 4. Ground Truth Validation Gaps (2 tests)
 * 5. Specialized Voice Detection Failures (4 tests)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectSpeakerGender, syncSegmentsWithSpeakerRegistry } = require('../models/speakerRegistry');
const { identifySpeakersForCues } = require('../services/pipeline/speakerIdentificationService');
const { createSegment } = require('../models/segmentModel');

// ============================================================
// Bug Condition 1: Generic Identity Gender Inheritance
// ============================================================

test('BC1-1: Generic identity "ប្រព័ន្ធ" with male acoustic (120Hz) inherits FEMALE from series map (SHOULD FAIL)', async () => {
  // This test demonstrates the bug where generic identities inherit cached gender
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_generic_male',
      startSec: 0,
      endSec: 2.5,
      chineseText: '恭喜玩家通关第一关',
      speaker: 'ប្រព័ន្ធ',
      acousticGender: 'male',
      pitchHz: 120,
      acousticConfidence: 0.85,
      voicedRatio: 0.65,
    },
  ];

  // Simulate series map with FEMALE cached from earlier episode
  const mockSeriesSpeakerMap = {
    'ប្រព័ន្ធ': { gender: 'FEMALE', voiceId: 'km-KH-SreymomNeural', confidence: 0.9 },
  };

  const mockVisualProbe = async () => new Map([
    ['cue_generic_male', { sourceCueId: 'cue_generic_male', faceCount: 0, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_generic_male',
        speakerName: 'ប្រព័ន្ធ',
        speakerGender: 'MALE',
        confidence: 0.88,
        deliveryType: 'out_loud',
        evidence: 'Deep male narrator voice for system announcement',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
    seriesSpeakerMap: mockSeriesSpeakerMap,
  });

  // EXPECTED: Should assign MALE based on acoustic evidence (120Hz deep voice)
  // ACTUAL BUG: Assigns FEMALE inherited from series map
  assert.equal(res.cues[0].speakerGender, 'MALE', 'Generic identity should use acoustic evidence, not series map');
  assert.equal(res.cues[0].voiceGender, 'male', 'Voice gender should match acoustic evidence');
});

test('BC1-2: Generic identity "系统" with female acoustic (220Hz) inherits MALE from series map (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_system_female',
      startSec: 0,
      endSec: 2.0,
      chineseText: '规则警告：禁止夜晚出门',
      speaker: '系统',
      acousticGender: 'female',
      pitchHz: 220,
      acousticConfidence: 0.82,
      voicedRatio: 0.7,
    },
  ];

  const mockSeriesSpeakerMap = {
    '系统': { gender: 'MALE', voiceId: 'km-KH-PisethNeural', confidence: 0.85 },
  };

  const mockVisualProbe = async () => new Map([
    ['cue_system_female', { sourceCueId: 'cue_system_female', faceCount: 0, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_system_female',
        speakerName: '系统',
        speakerGender: 'FEMALE',
        confidence: 0.86,
        deliveryType: 'out_loud',
        evidence: 'Female narrator voice for world announcement',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
    seriesSpeakerMap: mockSeriesSpeakerMap,
  });

  // EXPECTED: Should assign FEMALE based on acoustic evidence (220Hz female voice)
  // ACTUAL BUG: Assigns MALE inherited from series map
  assert.equal(res.cues[0].speakerGender, 'FEMALE', 'Generic system identity should use in-scene acoustic evidence');
  assert.equal(res.cues[0].voiceGender, 'female', 'Voice gender should match acoustic timbre');
});

test('BC1-3: Generic narrator identity switches gender between episodes but series map locks first gender (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_narrator_ep1',
      startSec: 0,
      endSec: 3.0,
      chineseText: '很久以前，在一个小村庄里',
      speaker: 'ឧទ្ទេសក',
      acousticGender: 'male',
      pitchHz: 125,
      acousticConfidence: 0.9,
      voicedRatio: 0.68,
    },
    {
      id: 2,
      sourceCueId: 'cue_narrator_ep2',
      startSec: 0,
      endSec: 3.5,
      chineseText: '第二天，故事继续发展',
      speaker: 'ឧទ្ទេសក',
      acousticGender: 'female',
      pitchHz: 215,
      acousticConfidence: 0.87,
      voicedRatio: 0.72,
    },
  ];

  const mockSeriesSpeakerMap = {
    'ឧទ្ទេសក': { gender: 'MALE', voiceId: 'km-KH-PisethNeural', confidence: 0.9 },
  };

  const mockVisualProbe = async () => new Map([
    ['cue_narrator_ep1', { sourceCueId: 'cue_narrator_ep1', faceCount: 0, sceneCutFromPrev: true }],
    ['cue_narrator_ep2', { sourceCueId: 'cue_narrator_ep2', faceCount: 0, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_narrator_ep1',
        speakerName: 'ឧទ្ទេសក',
        speakerGender: 'MALE',
        confidence: 0.92,
        deliveryType: 'out_loud',
        evidence: 'Male narrator voice',
      },
      {
        sourceCueId: 'cue_narrator_ep2',
        speakerName: 'ឧទ្ទេសក',
        speakerGender: 'FEMALE',
        confidence: 0.89,
        deliveryType: 'out_loud',
        evidence: 'Female narrator voice',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
    seriesSpeakerMap: mockSeriesSpeakerMap,
  });

  // EXPECTED: First cue MALE (125Hz), second cue FEMALE (215Hz) - each uses in-scene acoustic
  // ACTUAL BUG: Both assigned MALE from series map
  assert.equal(res.cues[0].speakerGender, 'MALE', 'First narrator instance correctly MALE');
  assert.equal(res.cues[1].speakerGender, 'FEMALE', 'Second narrator instance should be FEMALE based on 215Hz acoustic');
});

// ============================================================
// Bug Condition 2: Character vs Voice Actor Confusion
// ============================================================

test('BC2-1: Boy character "小鬼" voiced by female actress (230Hz) assigned MALE character gender (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_child_ghost',
      startSec: 0,
      endSec: 2.0,
      chineseText: '你不要过来啊',
      speaker: '小鬼',
      acousticGender: 'female',
      pitchHz: 230,
      acousticConfidence: 0.85,
      voicedRatio: 0.75,
      visualGender: 'male',
      genderConfidence: 0.7,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_child_ghost', { sourceCueId: 'cue_child_ghost', faceCount: 1, sceneCutFromPrev: true, gender: 'male', genderConfidence: 0.7 }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_child_ghost',
        speakerName: '小鬼',
        speakerGender: 'MALE',
        confidence: 0.78,
        deliveryType: 'out_loud',
        evidence: 'Boy ghost character visible on screen',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Should assign FEMALE based on voice actor timbre (230Hz, breathy female voice)
  // ACTUAL BUG: Assigns MALE based on character visual gender or name
  assert.equal(res.cues[0].speakerGender, 'FEMALE', 'Should classify by voice actor timbre (female), not character gender (male)');
  assert.equal(res.cues[0].voiceGender, 'female', 'Voice gender should be female for TTS voice selection');
});

test('BC2-2: Male child character with high-confidence visual MALE but female voice actor (210Hz) (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_male_child',
      startSec: 0,
      endSec: 1.8,
      chineseText: '大哥救我',
      speaker: '小男孩',
      acousticGender: 'female',
      pitchHz: 210,
      acousticConfidence: 0.88,
      voicedRatio: 0.78,
      visualGender: 'male',
      genderConfidence: 0.82,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_male_child', { sourceCueId: 'cue_male_child', faceCount: 1, sceneCutFromPrev: true, gender: 'male', genderConfidence: 0.82 }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_male_child',
        speakerName: '小男孩',
        speakerGender: 'MALE',
        confidence: 0.84,
        deliveryType: 'out_loud',
        evidence: 'Young boy character on screen',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Should assign FEMALE based on voice actor timbre (210Hz)
  // ACTUAL BUG: Assigns MALE based on high-confidence visualGender (priority 1 in detectSpeakerGender)
  assert.equal(res.cues[0].speakerGender, 'FEMALE', 'Voice actor timbre should take priority over visual character gender');
  assert.equal(res.cues[0].voiceGender, 'female', 'Voice gender for TTS should be female');
});

test('BC2-3: Comedy role with female character but male voice actor for effect (140Hz) (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_comedy',
      startSec: 0,
      endSec: 2.2,
      chineseText: '哎呀我的天啊',
      speaker: '张小花',
      acousticGender: 'male',
      pitchHz: 140,
      acousticConfidence: 0.9,
      voicedRatio: 0.7,
      visualGender: 'female',
      genderConfidence: 0.75,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_comedy', { sourceCueId: 'cue_comedy', faceCount: 1, sceneCutFromPrev: true, gender: 'female', genderConfidence: 0.75 }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_comedy',
        speakerName: '张小花',
        speakerGender: 'FEMALE',
        confidence: 0.80,
        deliveryType: 'out_loud',
        evidence: 'Female character on screen speaking',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Should assign MALE based on voice actor timbre (140Hz deep male voice)
  // ACTUAL BUG: Assigns FEMALE based on character visual/name
  assert.equal(res.cues[0].speakerGender, 'MALE', 'Should classify by voice actor timbre (male), not character gender (female)');
  assert.equal(res.cues[0].voiceGender, 'male', 'Voice gender should be male for TTS');
});

// ============================================================
// Bug Condition 3: Speaker Change Detection Failure
// ============================================================

test('BC3-1: Consecutive cues with speaker change (MALE 130Hz → FEMALE 240Hz) but continuity assumed (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_male',
      startSec: 0,
      endSec: 2.0,
      chineseText: '我们要去哪里',
      speaker: 'ស៊ូ មីង',
      acousticGender: 'male',
      pitchHz: 130,
      acousticConfidence: 0.9,
      voicedRatio: 0.68,
    },
    {
      id: 2,
      sourceCueId: 'cue_female',
      startSec: 2.5,
      endSec: 4.5,
      chineseText: '跟着我走就对了',
      speaker: 'Unknown',
      acousticGender: 'female',
      pitchHz: 240,
      acousticConfidence: 0.87,
      voicedRatio: 0.74,
      khmerPronoun: 'នាង',
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_male', { sourceCueId: 'cue_male', faceCount: 1, sceneCutFromPrev: true }],
    ['cue_female', { sourceCueId: 'cue_female', faceCount: 1, sceneCutFromPrev: false }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_male',
        speakerName: 'ស៊ូ មីង',
        speakerGender: 'MALE',
        confidence: 0.92,
        deliveryType: 'out_loud',
        evidence: 'Male voice 130Hz',
      },
      {
        sourceCueId: 'cue_female',
        speakerName: 'ស៊ូ មីង',
        speakerGender: 'MALE',
        confidence: 0.65,
        deliveryType: 'out_loud',
        evidence: 'Speaker continuity from previous cue',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: First cue MALE, second cue FEMALE (speaker changed based on 240Hz + "នាង" pronoun)
  // ACTUAL BUG: Second cue assigned MALE due to speaker continuity assumption
  assert.equal(res.cues[0].speakerGender, 'MALE', 'First cue correctly MALE');
  assert.equal(res.cues[1].speakerGender, 'FEMALE', 'Second cue should be FEMALE - speaker changed (240Hz, female pronoun)');
});

test('BC3-2: Danmaku crowd scene with rapid male→female→male switches but changes not detected (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_danmaku_1',
      startSec: 0,
      endSec: 1.0,
      chineseText: '666',
      speaker: 'spk_male_crowd_1',
      acousticGender: 'male',
      pitchHz: 135,
      acousticConfidence: 0.75,
      voicedRatio: 0.6,
    },
    {
      id: 2,
      sourceCueId: 'cue_danmaku_2',
      startSec: 1.1,
      endSec: 2.0,
      chineseText: '太厉害了',
      speaker: 'spk_female_crowd_1',
      acousticGender: 'female',
      pitchHz: 225,
      acousticConfidence: 0.78,
      voicedRatio: 0.65,
    },
    {
      id: 3,
      sourceCueId: 'cue_danmaku_3',
      startSec: 2.2,
      endSec: 3.0,
      chineseText: '牛逼',
      speaker: 'spk_male_crowd_2',
      acousticGender: 'male',
      pitchHz: 128,
      acousticConfidence: 0.8,
      voicedRatio: 0.62,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_danmaku_1', { sourceCueId: 'cue_danmaku_1', faceCount: 0, sceneCutFromPrev: true }],
    ['cue_danmaku_2', { sourceCueId: 'cue_danmaku_2', faceCount: 0, sceneCutFromPrev: false }],
    ['cue_danmaku_3', { sourceCueId: 'cue_danmaku_3', faceCount: 0, sceneCutFromPrev: false }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_danmaku_1',
        speakerName: 'spk_male_crowd_1',
        speakerGender: 'MALE',
        confidence: 0.80,
        deliveryType: 'out_loud',
        evidence: 'Male crowd comment',
      },
      {
        sourceCueId: 'cue_danmaku_2',
        speakerName: 'spk_male_crowd_1',
        speakerGender: 'MALE',
        confidence: 0.60,
        deliveryType: 'out_loud',
        evidence: 'Speaker continuity',
      },
      {
        sourceCueId: 'cue_danmaku_3',
        speakerName: 'spk_male_crowd_1',
        speakerGender: 'MALE',
        confidence: 0.62,
        deliveryType: 'out_loud',
        evidence: 'Speaker continuity',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Cue 1 MALE, Cue 2 FEMALE, Cue 3 MALE (per-line speaker changes)
  // ACTUAL BUG: All assigned MALE due to continuity assumption
  assert.equal(res.cues[0].speakerGender, 'MALE', 'First danmaku MALE');
  assert.equal(res.cues[1].speakerGender, 'FEMALE', 'Second danmaku should be FEMALE (225Hz)');
  assert.equal(res.cues[2].speakerGender, 'MALE', 'Third danmaku MALE (128Hz)');
});

test('BC3-3: Speaker change in ambiguous acoustic overlap zone (165Hz) missed due to continuity bias (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_clear_male',
      startSec: 0,
      endSec: 2.0,
      chineseText: '我们开始吧',
      speaker: 'ស៊ូ មីង',
      acousticGender: 'male',
      pitchHz: 125,
      acousticConfidence: 0.9,
      voicedRatio: 0.7,
    },
    {
      id: 2,
      sourceCueId: 'cue_ambiguous',
      startSec: 2.5,
      endSec: 4.0,
      chineseText: '好的',
      speaker: 'Unknown',
      acousticGender: 'unknown',
      pitchHz: 165,
      acousticConfidence: 0.4,
      acousticAmbiguous: true,
      voicedRatio: 0.55,
      khmerPronoun: 'នាង',
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_clear_male', { sourceCueId: 'cue_clear_male', faceCount: 1, sceneCutFromPrev: true }],
    ['cue_ambiguous', { sourceCueId: 'cue_ambiguous', faceCount: 1, sceneCutFromPrev: false }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_clear_male',
        speakerName: 'ស៊ូ មីង',
        speakerGender: 'MALE',
        confidence: 0.92,
        deliveryType: 'out_loud',
        evidence: 'Male voice 125Hz',
      },
      {
        sourceCueId: 'cue_ambiguous',
        speakerName: 'ស៊ូ មីង',
        speakerGender: 'MALE',
        confidence: 0.55,
        deliveryType: 'out_loud',
        evidence: 'Speaker continuity, ambiguous acoustic',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: First cue MALE, second cue FEMALE based on "នាង" pronoun override despite ambiguous acoustic
  // ACTUAL BUG: Second cue assigned MALE due to continuity bias
  assert.equal(res.cues[0].speakerGender, 'MALE', 'First cue correctly MALE');
  assert.equal(res.cues[1].speakerGender, 'FEMALE', 'Second cue should be FEMALE based on pronoun despite ambiguous acoustic');
});

// ============================================================
// Bug Condition 4: Ground Truth Validation Gaps
// ============================================================

test('BC4-1: Acoustic FEMALE (230Hz) correctly assigned but ground truth says MALE - no dispute flag (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_gt_mismatch',
      startSec: 0,
      endSec: 2.0,
      chineseText: '你不要过来啊',
      speaker: '小鬼',
      acousticGender: 'female',
      pitchHz: 230,
      acousticConfidence: 0.9,
      voicedRatio: 0.78,
      groundTruthGender: 'MALE',
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_gt_mismatch', { sourceCueId: 'cue_gt_mismatch', faceCount: 1, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_gt_mismatch',
        speakerName: '小鬼',
        speakerGender: 'FEMALE',
        confidence: 0.92,
        deliveryType: 'out_loud',
        evidence: 'Female voice actor (230Hz, breathy female timbre)',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
    includeGroundTruthValidation: true,
  });

  // EXPECTED: Assigns FEMALE (correct acoustic analysis) AND flags ground truth dispute
  // ACTUAL BUG: Assigns FEMALE but no dispute flag, scored as "incorrect" in benchmark
  assert.equal(res.cues[0].speakerGender, 'FEMALE', 'Should assign FEMALE based on acoustic evidence');
  assert.equal(res.cues[0].groundTruthDisputed, true, 'Should flag ground truth dispute');
  assert.ok(res.cues[0].disputeReason, 'Should provide dispute reasoning');
});

test('BC4-2: Acoustic MALE (140Hz) correctly assigned but ground truth says FEMALE - no dual accuracy (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_gt_conflict',
      startSec: 0,
      endSec: 2.5,
      chineseText: '规则警告',
      speaker: '系统',
      acousticGender: 'male',
      pitchHz: 140,
      acousticConfidence: 0.88,
      voicedRatio: 0.7,
      groundTruthGender: 'FEMALE',
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_gt_conflict', { sourceCueId: 'cue_gt_conflict', faceCount: 0, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_gt_conflict',
        speakerName: '系统',
        speakerGender: 'MALE',
        confidence: 0.90,
        deliveryType: 'out_loud',
        evidence: 'Male narrator voice (140Hz)',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
    includeGroundTruthValidation: true,
  });

  // EXPECTED: Assigns MALE AND provides dual accuracy (benchmark: incorrect, acoustic: correct)
  // ACTUAL BUG: No ground truth validation or dual accuracy reporting
  assert.equal(res.cues[0].speakerGender, 'MALE', 'Should assign MALE based on acoustic evidence');
  assert.equal(res.cues[0].groundTruthDisputed, true, 'Should flag ground truth dispute');
  assert.ok(res.dualAccuracyProvided, 'Should provide dual accuracy reporting');
});

// ============================================================
// Bug Condition 5: Specialized Voice Detection Failures
// ============================================================

test('BC5-1: Ghost voice with heavy reverb/chorus (250Hz base + harmonics) misclassified (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_distorted_ghost',
      startSec: 0,
      endSec: 2.5,
      chineseText: '我来找你了',
      speaker: 'spk_ghost',
      acousticGender: 'unknown',
      pitchHz: 250,
      pitchIqr: 85,
      acousticConfidence: 0.4,
      voicedRatio: 0.5,
      hasReverb: true,
      hasDistortion: true,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_distorted_ghost', { sourceCueId: 'cue_distorted_ghost', faceCount: 1, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_distorted_ghost',
        speakerName: 'spk_ghost',
        speakerGender: 'MALE',
        confidence: 0.55,
        deliveryType: 'out_loud',
        evidence: 'Distorted voice, low confidence',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Should analyze underlying 250Hz timbre beneath reverb/chorus → FEMALE
  // ACTUAL BUG: Harmonic confusion leads to MALE or UNKNOWN
  assert.equal(res.cues[0].speakerGender, 'FEMALE', 'Should analyze underlying timbre (250Hz female) beneath distortion');
});

test('BC5-2: Screaming voice (female scream 280Hz with vocal fry) misclassified as MALE or ambiguous (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_scream',
      startSec: 0,
      endSec: 1.1,
      chineseText: '啊！',
      speaker: 'Unknown',
      acousticGender: 'unknown',
      pitchHz: 280,
      acousticConfidence: 0.35,
      voicedRatio: 0.45,
      isScreaming: true,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_scream', { sourceCueId: 'cue_scream', faceCount: 1, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_scream',
        speakerName: 'Unknown',
        speakerGender: 'MALE',
        confidence: 0.42,
        deliveryType: 'out_loud',
        evidence: 'Screaming voice, ambiguous',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Should adjust for arousal pitch shift → 280Hz female scream → FEMALE
  // ACTUAL BUG: Assigned MALE or UNKNOWN due to low confidence
  assert.equal(res.cues[0].speakerGender, 'FEMALE', 'Should adjust for arousal - 280Hz is female scream range');
});

test('BC5-3: Short exclamation (1.1s, female 240Hz) has low confidence and incorrect gender (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_short',
      startSec: 0,
      endSec: 1.1,
      chineseText: '什么',
      speaker: 'Unknown',
      acousticGender: 'female',
      pitchHz: 240,
      acousticConfidence: 0.5,
      voicedRatio: 0.6,
      isShortDuration: true,
      duration: 1.1,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_short', { sourceCueId: 'cue_short', faceCount: 1, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_short',
        speakerName: 'Unknown',
        speakerGender: 'MALE',
        confidence: 0.52,
        deliveryType: 'out_loud',
        evidence: 'Short clip, low acoustic confidence',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Should prioritize context window over isolated acoustic → FEMALE based on 240Hz + context
  // ACTUAL BUG: Assigned MALE or marked review_needed due to duration limit
  assert.equal(res.cues[0].speakerGender, 'FEMALE', 'Short clip should use context + 240Hz acoustic → FEMALE');
});

test('BC5-4: Off-screen phone call (male voice, compressed frequency) misclassified as FEMALE (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_phone',
      startSec: 0,
      endSec: 3.0,
      chineseText: '喂，是我',
      speaker: 'Unknown',
      acousticGender: 'unknown',
      pitchHz: 170,
      acousticConfidence: 0.45,
      voicedRatio: 0.5,
      suspectedOffScreen: true,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_phone', { sourceCueId: 'cue_phone', faceCount: 1, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_phone',
        speakerName: 'Unknown',
        speakerGender: 'FEMALE',
        confidence: 0.58,
        deliveryType: 'out_loud',
        evidence: 'Phone call voice, compressed audio',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Should rely on formant ratios over absolute pitch → MALE
  // ACTUAL BUG: Assigned FEMALE due to compressed frequency misleading pitch analysis
  assert.equal(res.cues[0].speakerGender, 'MALE', 'Off-screen phone call should use formant analysis → MALE');
});

test('BC5-5: Genuinely ambiguous cue should mark review_needed rather than forcing incorrect prediction (SHOULD FAIL)', async () => {
  const cues = [
    {
      id: 1,
      sourceCueId: 'cue_truly_ambiguous',
      startSec: 0,
      endSec: 1.5,
      chineseText: '嗯',
      speaker: 'Unknown',
      acousticGender: 'unknown',
      pitchHz: 164,
      pitchIqr: 75,
      acousticConfidence: 0.3,
      acousticAmbiguous: true,
      voicedRatio: 0.4,
      bgmSuspected: true,
    },
  ];

  const mockVisualProbe = async () => new Map([
    ['cue_truly_ambiguous', { sourceCueId: 'cue_truly_ambiguous', faceCount: 0, sceneCutFromPrev: true }],
  ]);

  const mockGeminiFn = async () => ({
    cues: [
      {
        sourceCueId: 'cue_truly_ambiguous',
        speakerName: 'Unknown',
        speakerGender: 'MALE',
        confidence: 0.35,
        deliveryType: 'out_loud',
        evidence: 'Ambiguous acoustic, low confidence, forced guess',
      },
    ],
  });

  const res = await identifySpeakersForCues({
    cues,
    apiKey: 'mock-key',
    visualProbeFn: mockVisualProbe,
    geminiGenerateFn: mockGeminiFn,
  });

  // EXPECTED: Should mark review_needed for genuinely ambiguous cue (164Hz overlap zone, BGM suspected)
  // ACTUAL BUG: Forces MALE prediction despite low confidence
  assert.equal(res.cues[0].speakerStatus, 'review_needed', 'Genuinely ambiguous cue should be marked review_needed');
  assert.equal(res.cues[0].reviewNeeded, true, 'reviewNeeded flag should be true');
  assert.ok(res.cues[0].confidence < 0.6, 'Confidence should reflect ambiguity');
});
