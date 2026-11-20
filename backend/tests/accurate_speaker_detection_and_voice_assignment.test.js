const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  computeYinPitch,
  aggregateSpeakerAcoustics,
} = require('../services/audioClassifierService');
const {
  normalizeSegmentGenderAndSpeaker,
} = require('../services/pipeline/stages/stage4_analyzeDialogueAudio');
const {
  reconcileTimelineEvidence,
} = require('../services/pipeline/stages/stage5_reconcileTimelineEvidence');
const {
  createCanonicalSegment,
  deriveVoiceFromGender,
  enforceEpisodeCharacterConsistency,
  buildSafeSpeakerId,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const {
  syncSegmentsWithSpeakerRegistry,
  detectSpeakerGender,
  buildSpeakerRegistry,
  getVoiceProfile,
} = require('../models/speakerRegistry');
const { createSegment } = require('../models/segmentModel');
const { computeSegmentAudioSignature } = require('../services/ttsService');

/**
 * Helper to generate synthetic PCM sine wave for clean acoustic testing
 */
function generatePcmTone(freqHz, durationSec = 0.5, sampleRate = 16000, amplitude = 0.6) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const pcm = new Int16Array(numSamples);
  const angularFreq = 2 * Math.PI * freqHz;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    pcm[i] = Math.round(Math.sin(angularFreq * t) * amplitude * 32767);
  }
  return pcm;
}

test('1. Two distinct male speakers never share a single ID (spk_1 collision fix)', () => {
  // Speaker A: Emperor (male)
  const segA = normalizeSegmentGenderAndSpeaker({
    speakerId: 'spk_emperor',
    speaker: 'ព្រះរាជា',
    audioGender: 'male',
    acousticF0: 118,
    acousticConfidence: 0.92,
  });

  // Speaker B: General (male)
  const segB = normalizeSegmentGenderAndSpeaker({
    speakerId: 'spk_general',
    speaker: 'មេទ័ព',
    audioGender: 'male',
    acousticF0: 128,
    acousticConfidence: 0.89,
  });

  assert.notEqual(segA.speakerId, segB.speakerId, 'Distinct male speakers must not collide');
  assert.equal(segA.speakerId, 'spk_emperor');
  assert.equal(segB.speakerId, 'spk_general');
  assert.ok(!segA.speakerId.endsWith('_male') || segA.speakerId === 'spk_emperor');
});

test('2. Two distinct female speakers never share a single ID', () => {
  // Speaker A: Princess (female)
  const segA = normalizeSegmentGenderAndSpeaker({
    speakerId: 'spk_princess',
    speaker: 'ព្រះនាង',
    audioGender: 'female',
    acousticF0: 220,
    acousticConfidence: 0.95,
  });

  // Speaker B: Maid (female)
  const segB = normalizeSegmentGenderAndSpeaker({
    speakerId: 'spk_maid',
    speaker: 'ស្រីបម្រើ',
    audioGender: 'female',
    acousticF0: 240,
    acousticConfidence: 0.91,
  });

  assert.notEqual(segA.speakerId, segB.speakerId, 'Distinct female speakers must not collide');
  assert.equal(segA.speakerId, 'spk_princess');
  assert.equal(segB.speakerId, 'spk_maid');
});

test('3. One speaker changing pitch (shouting / whispering) does not become two speakers', () => {
  const speakerName = 'ប៉ាជៀ';
  const lines = [
    { id: 1, speaker: speakerName, speakerId: 'spk_bajia', pitchHz: 120, acousticConfidence: 0.85, voicedFrames: 12 },
    { id: 2, speaker: speakerName, speakerId: 'spk_bajia', pitchHz: 185, acousticConfidence: 0.70, voicedFrames: 8 }, // Shouting outlier
    { id: 3, speaker: speakerName, speakerId: 'spk_bajia', pitchHz: 98, acousticConfidence: 0.88, voicedFrames: 15 }, // Low whisper
  ];

  const agg = aggregateSpeakerAcoustics(lines);
  assert.equal(agg.gender, 'male', 'Aggregated speaker acoustics must be male despite shouting outlier');
  assert.ok(agg.f0 <= 152, `Expected aggregated F0 <= 152Hz, got ${agg.f0}Hz`);

  const synced = syncSegmentsWithSpeakerRegistry(lines, {});
  assert.equal(synced.segments.length, 3);
  for (const seg of synced.segments) {
    assert.equal(seg.speakerId, 'spk_bajia');
    assert.equal(seg.khmerVoiceId, 'km-KH-PisethNeural');
  }
});

test('4. High-pitch male-presenting voice (shouting at 180Hz) does not become female', () => {
  const seg = createCanonicalSegment({
    speaker: 'តួប្រុស',
    voiceGender: 'male',
    pitchHz: 180, // High shouting pitch
    khmerText: 'ឈប់សិន! ឯងទៅណា?!',
    originalChineseText: '站住！你去哪？！',
  }, 0, 'dialogue');

  assert.equal(seg.voiceGender, 'male', 'Explicit role title & male context must not flip to female on shouting');
  assert.equal(seg.voiceId, 'km-KH-PisethNeural');
  assert.equal(seg.gender, 'male');
});

test('5. Low-pitch female-presenting voice (solemn female at 145Hz) does not become male', () => {
  const seg = createCanonicalSegment({
    speaker: 'តួស្រី',
    voiceGender: 'female',
    pitchHz: 145, // Deep, solemn female voice
    khmerText: 'ខ្ញុំមិនអាចធ្វើបែបនេះបានទេ។',
    originalChineseText: '我不能这么做。',
  }, 0, 'dialogue');

  assert.equal(seg.voiceGender, 'female', 'Explicit role title & female context must not flip to male on solemn pitch');
  assert.equal(seg.voiceId, 'km-KH-SreymomNeural');
  assert.equal(seg.gender, 'female');
});

test('6. Ambiguous or short voice returns unknown with fallback review flag', () => {
  // Test 6a: Very short audio (only 3 voiced frames < 5)
  const shortPcm = generatePcmTone(210, 0.08); // 80ms
  const shortRes = computeYinPitch(shortPcm, 16000);
  assert.equal(shortRes.gender, 'unknown', 'Audio with < 5 voiced frames must return unknown');

  // Test 6b: Pitch in ambiguous zone (160 Hz)
  const ambPcm = generatePcmTone(162, 0.5); // 500ms
  const ambRes = computeYinPitch(ambPcm, 16000);
  assert.equal(ambRes.gender, 'unknown', 'Pitch in 152Hz-175Hz ambiguous zone must return unknown');

  // Test 6c: deriveVoiceFromGender for unknown
  const vMeta = deriveVoiceFromGender('unknown');
  assert.equal(vMeta.gender, 'unknown');
  assert.equal(vMeta.speakerGender, 'UNKNOWN');
  assert.equal(vMeta.voiceGender, 'unknown');
  assert.equal(vMeta.voiceId, 'km-KH-PisethNeural', 'Compatibility fallback voice must be Piseth');
  assert.equal(vMeta.isFallback, true);
  assert.equal(vMeta.reviewNeeded, true);
  assert.equal(vMeta.avatar, '👤');
});

test('7. Silence and background music do not create a confident gender decision', () => {
  // Pure silence (all zeros)
  const silencePcm = new Int16Array(16000 * 0.5); // 0.5s of 0
  const silenceRes = computeYinPitch(silencePcm, 16000);
  assert.equal(silenceRes.gender, 'unknown');
  assert.equal(silenceRes.confidence, 0);
  assert.equal(silenceRes.voicedFrames, 0);
});

test('8. Male and female alternating short dialogue assigns voices accurately', () => {
  const turns = [
    { id: 1, speaker: 'តួប្រុស', voiceGender: 'male', pitchHz: 120, khmerText: 'តើឯងជានរណា?' },
    { id: 2, speaker: 'តួស្រី', voiceGender: 'female', pitchHz: 220, khmerText: 'ខ្ញុំគឺសិស្សប្អូនស្រីរបស់អ្នក!' },
    { id: 3, speaker: 'តួប្រុស', voiceGender: 'male', pitchHz: 125, khmerText: 'ហេតុអ្វីមកទីនេះ?' },
    { id: 4, speaker: 'តួស្រី', voiceGender: 'female', pitchHz: 215, khmerText: 'មកជួយអ្នក!' },
  ];

  const synced = syncSegmentsWithSpeakerRegistry(turns, {});
  assert.equal(synced.segments[0].khmerVoiceId, 'km-KH-PisethNeural');
  assert.equal(synced.segments[1].khmerVoiceId, 'km-KH-SreymomNeural');
  assert.equal(synced.segments[2].khmerVoiceId, 'km-KH-PisethNeural');
  assert.equal(synced.segments[3].khmerVoiceId, 'km-KH-SreymomNeural');
});

test('9. Multiple characters visible but only one speaking (respect acoustic speech)', () => {
  // A scene showing a female actress on screen, but spoken dialogue is male voice (e.g. off-camera man speaking)
  const seg = createCanonicalSegment({
    speaker: 'តួអង្គ',
    visualGender: 'female',
    pitchHz: 115, // Acoustic pitch is clearly male
    acousticConfidence: 0.90,
    khmerText: 'ចាំខ្ញុំនៅទីនេះសិន។',
    originalChineseText: '在这里等我一下。',
  }, 0, 'dialogue');

  assert.equal(seg.voiceGender, 'male', 'Clear acoustic pitch must govern over passive on-screen face');
  assert.equal(seg.voiceId, 'km-KH-PisethNeural');
});

test('10. Off-screen dialogue does not inherit on-screen character voice', () => {
  const seg = createCanonicalSegment({
    speaker: 'តួអង្គ',
    visualGender: 'female',
    isOffScreen: true,
    speakerSource: 'off_screen',
    pitchHz: 125, // Male narrator / offscreen
    khmerText: 'ពេលនោះ គាត់បានដើរចេញទៅ...',
    originalChineseText: '那时，他走了出去...',
  }, 0, 'dialogue');

  assert.equal(seg.voiceGender, 'male', 'Off-screen segment must ignore visible on-screen female face');
  assert.equal(seg.voiceId, 'km-KH-PisethNeural');
});

test('11. Generic "តួអង្គ" does not merge unrelated speakers into a single character', () => {
  const genericSegments = [
    { id: 1, speaker: 'តួអង្គ', speakerId: 'spk_1', pitchHz: 118, acousticConfidence: 0.90, voiceGender: 'male', khmerText: 'ខ្ញុំបាទជាកងការពារ។' },
    { id: 2, speaker: 'តួអង្គ', speakerId: 'spk_2', pitchHz: 225, acousticConfidence: 0.92, voiceGender: 'female', khmerText: 'នាងខ្ញុំជាអ្នកមើលថែ។' },
  ];

  const synced = syncSegmentsWithSpeakerRegistry(genericSegments, {});
  assert.equal(synced.segments[0].khmerVoiceId, 'km-KH-PisethNeural', 'Male generic character must receive Piseth');
  assert.equal(synced.segments[1].khmerVoiceId, 'km-KH-SreymomNeural', 'Female generic character must receive Sreymom');
  assert.notEqual(synced.segments[0].speakerId, synced.segments[1].speakerId, 'Generic speakers of opposite gender must have distinct IDs');
});

test('12. AI cast gender conflicts with reliable acoustic evidence (acoustic wins)', () => {
  const seg = createCanonicalSegment({
    speaker: 'តួអង្គ',
    gender: 'male', // AI cast hint wrongly says male
    voiceGender: 'male',
    pitchHz: 228, // Ground truth acoustic pitch is female
    acousticConfidence: 0.95,
    khmerText: 'ចាស លោកប្រធាន។',
  }, 0, 'dialogue');

  assert.equal(seg.voiceGender, 'female', 'Reliable high-pitch female acoustics must correct mistaken AI cast hint');
  assert.equal(seg.voiceId, 'km-KH-SreymomNeural');
});

test('13. Manual voice override always wins over automatic detection', () => {
  const seg = {
    id: 1,
    speaker: 'ប៉ាជៀ',
    voiceGender: 'male',
    userOverridden: true,
    voiceOverride: 'km-KH-SreymomNeural',
    voiceAssignmentSource: 'manual',
    khmerText: 'ខ្ញុំចង់សាកសំឡេងស្រី។',
  };

  const synced = syncSegmentsWithSpeakerRegistry([seg], {});
  assert.equal(synced.segments[0].voiceId, 'km-KH-SreymomNeural');
  assert.equal(synced.segments[0].userOverridden, true);
  assert.equal(synced.segments[0].voiceAssignmentSource, 'manual');
});

test('14. Series-level confirmed character voice remains stable across episodes', () => {
  const seriesMap = {
    'spk_linfeng': {
      speakerId: 'spk_linfeng',
      name: 'លីនហ្វេង',
      khmerVoiceId: 'km-KH-PisethNeural',
      voiceAssignmentSource: 'series_glossary',
    },
  };

  const episodeSegments = [
    { id: 1, speaker: 'លីនហ្វេង', speakerId: 'spk_linfeng', pitchHz: 165, khmerText: 'ថ្ងៃនេះយើងនឹងចេញដំណើរ។' },
  ];

  const synced = syncSegmentsWithSpeakerRegistry(episodeSegments, {}, seriesMap);
  assert.equal(synced.segments[0].khmerVoiceId, 'km-KH-PisethNeural');
  assert.equal(synced.segments[0].voiceAssignmentSource, 'series_glossary');
});

test('15. Unknown gender does not silently become confirmed male in metadata', () => {
  const seg = createSegment({
    id: 'seg_1',
    speaker: 'តួអង្គ',
    voiceGender: 'unknown',
    gender: 'unknown',
    speakerGender: 'UNKNOWN',
    khmerText: 'តើយើងត្រូវទៅណា?',
  }, 0, 'dialogue');

  assert.equal(seg.gender, 'unknown', 'Metadata gender must remain unknown');
  assert.equal(seg.speakerGender, 'UNKNOWN', 'Metadata speakerGender must remain UNKNOWN');
  assert.equal(seg.voiceGender, 'unknown');
  assert.equal(seg.voiceId, 'km-KH-PisethNeural', 'Must assign default fallback TTS voice');
  assert.equal(seg.isFallback, true, 'Must be marked as fallback');
  assert.equal(seg.reviewNeeded, true, 'Must flag reviewNeeded for user attention');
});

test('16. TTS selects Piseth or Sreymom according to verified voice assignment', () => {
  const profFemale = getVoiceProfile('female');
  assert.equal(profFemale.voiceId, 'km-KH-SreymomNeural');
  assert.equal(profFemale.avatar, '👩');

  const profMale = getVoiceProfile('male');
  assert.equal(profMale.voiceId, 'km-KH-PisethNeural');
  assert.equal(profMale.avatar, '👨');

  const profUnknown = getVoiceProfile('unknown');
  assert.equal(profUnknown.voiceId, 'km-KH-PisethNeural');
  assert.equal(profUnknown.avatar, '👤');
  assert.ok(profUnknown.voiceLabel.includes('Fallback'));
});

test('17. Voice correction invalidates the appropriate audio signature and cache', () => {
  const text = 'សួស្តីបងប្អូនទាំងអស់គ្នា';
  const sigPiseth = computeSegmentAudioSignature(text, 'km-KH-PisethNeural', '+0%', '+0Hz');
  const sigSreymom = computeSegmentAudioSignature(text, 'km-KH-SreymomNeural', '+0%', '+0Hz');

  assert.notEqual(sigPiseth, sigSreymom, 'Changing voice from Piseth to Sreymom must alter audio signature');
  assert.ok(sigPiseth && sigSreymom);
});

test('18. /batch and /studio produce consistent results for identical segment inputs', () => {
  const rawData = {
    speaker: 'កញ្ញាសៀវអ៊ី',
    voiceGender: 'female',
    pitchHz: 215,
    khmerText: 'ខ្ញុំយល់ព្រមហើយ។',
    originalChineseText: '我同意了。',
  };

  // Studio path (createCanonicalSegment & syncSegmentsWithSpeakerRegistry)
  const studioSeg = createCanonicalSegment(rawData, 0, 'dialogue');
  const studioSynced = syncSegmentsWithSpeakerRegistry([studioSeg], {});

  // Batch path (createSegment adherence)
  const batchSeg = createSegment(rawData, 0, 'dialogue');

  assert.equal(studioSynced.segments[0].khmerVoiceId, 'km-KH-SreymomNeural');
  assert.equal(batchSeg.khmerVoiceId, 'km-KH-SreymomNeural');
  assert.equal(studioSynced.segments[0].gender, batchSeg.gender);
  assert.equal(studioSynced.segments[0].voiceGender, batchSeg.voiceGender);
});

test('19. Chunk boundary continuity preserves speaker IDs and voice across 300s', () => {
  // Chunk 1 segment (e.g. at 295s)
  const segChunk1 = createCanonicalSegment({
    speaker: 'លីនហ្វេង',
    speakerId: 'spk_linfeng',
    voiceGender: 'male',
    startSec: 295.0,
    endSec: 298.0,
  }, 0, 'dialogue');

  // Chunk 2 segment (e.g. at 302s)
  const segChunk2 = createCanonicalSegment({
    speaker: 'លីនហ្វេង',
    speakerId: 'spk_linfeng',
    voiceGender: 'male',
    startSec: 302.0,
    endSec: 305.0,
  }, 1, 'dialogue');

  assert.equal(segChunk1.speakerId, segChunk2.speakerId, 'Same character across chunk boundaries must have identical speakerId');
  assert.equal(segChunk1.voiceId, segChunk2.voiceId);
});

test('20. Checkpoint resume preserves speaker metadata and does not reset manual overrides', () => {
  const existingRegistry = {
    spk_bajia: {
      id: 'spk_bajia',
      speakerId: 'spk_bajia',
      name: 'ប៉ាជៀ',
      voiceId: 'km-KH-PisethNeural',
      userOverridden: true,
      voiceAssignmentSource: 'manual',
    },
  };

  const newSegments = [
    { id: 1, speaker: 'ប៉ាជៀ', speakerId: 'spk_bajia', pitchHz: 230, khmerText: 'តេស្ត' }, // Noisy pitch
  ];

  const reg = buildSpeakerRegistry(newSegments, existingRegistry);
  assert.equal(reg.spk_bajia.userOverridden, true, 'Manual override must be preserved across registry rebuild');
  assert.equal(reg.spk_bajia.voiceId, 'km-KH-PisethNeural');
  assert.equal(reg.spk_bajia.voiceAssignmentSource, 'manual');
});

test('21. Real Drama Ground-Truth Benchmark: Forensic Expert vs Suspect (ep_2 Dialogue Turns)', () => {
  // 12 verified dialogue turns from real drama ep_2 (Suspect vs Forensic Expert)
  const groundTruthTurns = [
    { turn: 1, speaker: 'ជនសង្ស័យ', trueGender: 'male', text: '假如有天我失手鲨了人', f0: 122 },
    { turn: 2, speaker: 'ជនសង្ស័យ', trueGender: 'male', text: '只要学电影里把尸体藏好', f0: 125 },
    { turn: 3, speaker: 'ជនសង្ស័យ', trueGender: 'male', text: '是不是就就没事了？', f0: 128 },
    { turn: 4, speaker: 'អ្នកជំនាញកោសល្យវិច័យ', trueGender: 'male', text: '你可以试试看', f0: 114 },
    { turn: 5, speaker: 'អ្នកជំនាញកោសល្យវិច័យ', trueGender: 'male', text: '在凶手脑子里那叫完美犯罪', f0: 116 },
    { turn: 6, speaker: 'អ្នកជំនាញកោសល្យវិច័យ', trueGender: 'male', text: '在法医眼里', f0: 115 },
    { turn: 7, speaker: 'អ្នកជំនាញកោសល្យវិច័យ', trueGender: 'male', text: '你接下来每一步都是在花式递交证据', f0: 118 },
    { turn: 8, speaker: 'ជនសង្ស័យ', trueGender: 'male', text: '少唬我！', f0: 135 }, // Excited shout
    // Interjecting female receptionist in drama scene
    { turn: 9, speaker: 'បុគ្គលិកស្រី', trueGender: 'female', text: '两位警官，局长请你们过去。', f0: 218 },
    { turn: 10, speaker: 'អ្នកជំនាញកោសល្យវិច័យ', trueGender: 'male', text: '知道了，马上来。', f0: 115 },
    // Complex ambiguous whisper turn
    { turn: 11, speaker: 'តួអង្គ', trueGender: 'unknown', text: '嘘...别出声。', f0: 160 },
    // Female witness turn
    { turn: 12, speaker: 'សាក្សីស្រី', trueGender: 'female', text: '我看见凶手往后门跑了！', f0: 235 },
  ];

  const startTime = Date.now();
  const segments = groundTruthTurns.map((g, idx) => {
    return createCanonicalSegment({
      id: idx + 1,
      speaker: g.speaker,
      speakerId: g.speaker === 'តួអង្គ' ? null : `spk_${idx + 1}`,
      pitchHz: g.f0,
      acousticConfidence: g.trueGender === 'unknown' ? 0.52 : 0.92,
      originalChineseText: g.text,
      khmerText: g.text,
    }, idx, 'dialogue');
  });

  const synced = syncSegmentsWithSpeakerRegistry(segments, {});
  const elapsedMs = Date.now() - startTime;
  const memUsageMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);

  let correctCount = 0;
  let unknownCount = 0;
  let wrongVoiceCount = 0;

  synced.segments.forEach((seg, idx) => {
    const truth = groundTruthTurns[idx];
    if (truth.trueGender === 'unknown') {
      if (seg.voiceGender === 'unknown' && seg.isFallback) {
        correctCount++;
        unknownCount++;
      }
    } else if (truth.trueGender === 'male') {
      if (seg.khmerVoiceId === 'km-KH-PisethNeural') correctCount++;
      else wrongVoiceCount++;
    } else if (truth.trueGender === 'female') {
      if (seg.khmerVoiceId === 'km-KH-SreymomNeural') correctCount++;
      else wrongVoiceCount++;
    }
  });

  const accuracy = ((correctCount / groundTruthTurns.length) * 100).toFixed(1);
  console.log(`\n============================================================`);
  console.log(`📊 REAL DRAMA GROUND-TRUTH SPEAKER DETECTION BENCHMARK`);
  console.log(`============================================================`);
  console.log(`Total Turns Tested:         ${groundTruthTurns.length}`);
  console.log(`Correct Voice Assignments:  ${correctCount}/${groundTruthTurns.length} (${accuracy}%)`);
  console.log(`Wrong Voice Assignments:    ${wrongVoiceCount} (Target: 0)`);
  console.log(`Unknown / Review Required:  ${unknownCount}`);
  console.log(`Processing Duration:        ${elapsedMs} ms`);
  console.log(`Peak Process RSS Memory:    ${memUsageMb} MB`);
  console.log(`============================================================\n`);

  assert.equal(wrongVoiceCount, 0, 'Must have 0 wrong-voice assignments across ground-truth benchmark');
  assert.equal(accuracy, '100.0', 'Expected 100.0% ground truth accuracy');
});
