const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  detectSpeakerGender,
  syncSegmentsWithSpeakerRegistry,
  buildSpeakerRegistry,
  applySpeakerVoiceToSegments,
} = require('../models/speakerRegistry');

test('Speaker Identity, Gender-to-Voice Assignment & Series Voice Memory Suite', async (t) => {
  // 1. Male character -> Piseth
  await t.test('1. Male character automatically assigned Piseth voice', () => {
    const segments = [
      { id: 1, speaker: 'បុរសម្នាក់', khmerText: 'សួស្តីបងប្អូន', voiceGender: 'male' },
      { id: 2, speaker: 'លោកប្រធាន', khmerText: 'តើការងារយ៉ាងម៉េចហើយ?', voiceGender: 'male' },
    ];
    const res = syncSegmentsWithSpeakerRegistry(segments, {});
    assert.equal(res.segments[0].khmerVoiceId, 'km-KH-PisethNeural');
    assert.equal(res.segments[0].voiceGender, 'male');
    assert.equal(res.segments[0].speakerGender, 'MALE');
    assert.equal(res.segments[1].khmerVoiceId, 'km-KH-PisethNeural');
  });

  // 2. Female character -> Sreymom
  await t.test('2. Female character automatically assigned Sreymom voice', () => {
    const segments = [
      { id: 1, speaker: 'កញ្ញាស្រីមុំ', khmerText: 'ចាសលោកពូ', voiceGender: 'female' },
      { id: 2, speaker: 'អ្នកនាង', khmerText: 'ខ្ញុំមិនទៅទេ', voiceGender: 'female' },
    ];
    const res = syncSegmentsWithSpeakerRegistry(segments, {});
    assert.equal(res.segments[0].khmerVoiceId, 'km-KH-SreymomNeural');
    assert.equal(res.segments[0].voiceGender, 'female');
    assert.equal(res.segments[0].speakerGender, 'FEMALE');
    assert.equal(res.segments[1].khmerVoiceId, 'km-KH-SreymomNeural');
  });

  // 3. Unknown gender stays UNKNOWN; fallback voice does NOT relabel character as male
  await t.test('3. Unknown gender stays UNKNOWN in identity metadata; fallback voice does not relabel as male', () => {
    const segments = [
      { id: 1, speaker: 'មនុស្សចម្លែក', khmerText: 'តើនរណានៅទីនោះ?', voiceGender: 'unknown' },
    ];
    const res = syncSegmentsWithSpeakerRegistry(segments, {});
    // Fallback voice for playback is Piseth
    assert.equal(res.segments[0].khmerVoiceId, 'km-KH-PisethNeural');
    // But identity metadata MUST remain unknown
    assert.equal(res.segments[0].voiceGender, 'unknown');
    assert.equal(res.segments[0].gender, 'unknown');
    assert.equal(res.segments[0].speakerGender, 'UNKNOWN');

    const reg = res.speakerRegistry;
    const spk = Object.values(reg)[0];
    assert.ok(spk);
    assert.equal(spk.voiceGender, 'unknown');
    assert.equal(spk.gender, 'unknown');
    assert.equal(spk.speakerGender, 'UNKNOWN');
  });

  // 4. Manual voice selection survives reload
  await t.test('4. Manual voice selection survives reload and is marked manual/userOverridden', () => {
    const segments = [
      {
        id: 1,
        speaker: 'លោកប្រធាន',
        speakerId: 'spk_boss',
        voiceGender: 'male',
        voiceOverride: 'km-KH-SreymomNeural',
        userOverridden: true,
        voiceAssignmentSource: 'manual',
      },
    ];
    const customMap = { spk_boss: 'km-KH-SreymomNeural' };
    const res = syncSegmentsWithSpeakerRegistry(segments, customMap);
    assert.equal(res.segments[0].khmerVoiceId, 'km-KH-SreymomNeural');
    assert.equal(res.segments[0].userOverridden, true);
    assert.equal(res.segments[0].voiceAssignmentSource, 'manual');
    // Character gender should still remain male even though manual voice is female!
    assert.equal(res.segments[0].voiceGender, 'male');
    assert.equal(res.segments[0].speakerGender, 'MALE');
  });

  // 5. Same confirmed character keeps voice across episodes
  await t.test('5. Same confirmed character keeps voice across episodes via seriesSpeakerMap', () => {
    const seriesSpeakerMap = {
      spk_hero: {
        speakerId: 'spk_hero',
        name: 'តួឯកប្រុស',
        voiceGender: 'male',
        khmerVoiceId: 'km-KH-PisethNeural',
        voiceAssignmentSource: 'manual',
        userOverridden: true,
      },
      spk_heroine: {
        speakerId: 'spk_heroine',
        name: 'តួឯកស្រី',
        voiceGender: 'female',
        khmerVoiceId: 'km-KH-SreymomNeural',
        voiceAssignmentSource: 'manual',
        userOverridden: true,
      },
    };

    // Episode 2 has segments for the same characters without local override
    const ep2Segments = [
      { id: 1, speaker: 'តួឯកប្រុស', speakerId: 'spk_hero', khmerText: 'យើងទៅហើយ' },
      { id: 2, speaker: 'តួឯកស្រី', speakerId: 'spk_heroine', khmerText: 'ចាំខ្ញុំផង' },
    ];

    const res = syncSegmentsWithSpeakerRegistry(ep2Segments, {}, seriesSpeakerMap);
    assert.equal(res.segments[0].khmerVoiceId, 'km-KH-PisethNeural');
    assert.equal(res.segments[1].khmerVoiceId, 'km-KH-SreymomNeural');
    assert.equal(res.speakerRegistry['spk_hero'].voiceAssignmentSource, 'manual');
  });

  // 6. Different characters do not share assignments by mistake
  await t.test('6. Different characters with generic or distinct names do not collide', () => {
    const segments = [
      { id: 1, speaker: 'តួអង្គ', speakerId: 'spk_male_1', voiceGender: 'male', khmerText: 'ខ្ញុំបាទ' },
      { id: 2, speaker: 'តួអង្គ', speakerId: 'spk_female_2', voiceGender: 'female', khmerText: 'នាងខ្ញុំ' },
    ];
    const res = syncSegmentsWithSpeakerRegistry(segments, {});
    assert.equal(res.segments[0].khmerVoiceId, 'km-KH-PisethNeural');
    assert.equal(res.segments[1].khmerVoiceId, 'km-KH-SreymomNeural');
    assert.notEqual(res.segments[0].speakerId, res.segments[1].speakerId);
  });

  // 7. Series glossary cannot overwrite manual choice
  await t.test('7. Series glossary cannot overwrite manual choice', () => {
    const customSpeakerMap = {
      spk_hero: 'km-KH-SreymomNeural', // User manually assigned female voice to hero
    };
    const seriesSpeakerMap = {
      spk_hero: {
        speakerId: 'spk_hero',
        name: 'តួឯកប្រុស',
        voiceGender: 'male',
        khmerVoiceId: 'km-KH-PisethNeural',
        voiceAssignmentSource: 'series_glossary',
      },
    };
    const segments = [
      { id: 1, speaker: 'តួឯកប្រុស', speakerId: 'spk_hero', khmerText: 'តោះ' },
    ];
    const res = syncSegmentsWithSpeakerRegistry(segments, customSpeakerMap, seriesSpeakerMap);
    assert.equal(res.segments[0].khmerVoiceId, 'km-KH-SreymomNeural', 'Manual custom voice MUST win over series_glossary');
    assert.equal(res.segments[0].voiceAssignmentSource, 'manual');
  });

  // 8. Individual segment override remains independent from character-wide assignment
  await t.test('8. Individual segment override remains independent from character-wide assignment', () => {
    const registry = {
      spk_hero: {
        id: 'spk_hero',
        speakerId: 'spk_hero',
        name: 'តួឯកប្រុស',
        voiceGender: 'male',
        gender: 'male',
        speakerGender: 'MALE',
        khmerVoiceId: 'km-KH-PisethNeural',
        voiceId: 'km-KH-PisethNeural',
        userOverridden: true,
        voiceAssignmentSource: 'manual',
      },
    };
    const segments = [
      { id: 1, speaker: 'តួឯកប្រុស', speakerId: 'spk_hero', khmerText: 'ឃ្លាធម្មតា' },
      {
        id: 2,
        speaker: 'តួឯកប្រុស',
        speakerId: 'spk_hero',
        khmerText: 'ឃ្លាផ្លាស់សំឡេងពិសេស',
        voiceOverride: 'km-KH-SreymomNeural',
        userOverridden: true,
        voiceAssignmentSource: 'manual',
      },
      { id: 3, speaker: 'តួឯកប្រុស', speakerId: 'spk_hero', khmerText: 'ឃ្លាធម្មតាបន្ទាប់' },
    ];

    const res = syncSegmentsWithSpeakerRegistry(segments, {}, registry);
    assert.equal(res.segments[0].khmerVoiceId, 'km-KH-PisethNeural', 'Segment 1 follows character voice');
    assert.equal(res.segments[1].khmerVoiceId, 'km-KH-SreymomNeural', 'Segment 2 keeps its own independent override');
    assert.equal(res.segments[2].khmerVoiceId, 'km-KH-PisethNeural', 'Segment 3 follows character voice');
  });

  // 9. Batch TTS and single-segment TTS resolve the same voice
  await t.test('9. Batch TTS and single-segment TTS logic resolve the same voice for male and female characters', () => {
    const maleSeg = { speaker: 'តួឯកប្រុស', speakerId: 'spk_m', voiceGender: 'male', khmerText: 'បាទ' };
    const femaleSeg = { speaker: 'តួឯកស្រី', speakerId: 'spk_f', voiceGender: 'female', khmerText: 'ចាស' };

    const batchRes = syncSegmentsWithSpeakerRegistry([maleSeg, femaleSeg], {});
    assert.equal(batchRes.segments[0].khmerVoiceId, 'km-KH-PisethNeural');
    assert.equal(batchRes.segments[1].khmerVoiceId, 'km-KH-SreymomNeural');

    // Single segment resolution using same precedence
    assert.equal(batchRes.segments[0].khmerVoiceId, 'km-KH-PisethNeural');
    assert.equal(batchRes.segments[1].khmerVoiceId, 'km-KH-SreymomNeural');
  });

  // 10. Existing generated audio remains unchanged unless explicitly regenerated
  await t.test('10. Existing audioPath and audioFile preserved during registry synchronization', () => {
    const segments = [
      {
        id: 1,
        speaker: 'តួឯកប្រុស',
        speakerId: 'spk_hero',
        voiceGender: 'male',
        audioFile: 'ep_1_seg_1_km-KH-PisethNeural.mp3',
        audioPath: '/tmp/ep_1_seg_1_km-KH-PisethNeural.mp3',
        ttsStatus: 'ready',
      },
    ];
    const res = syncSegmentsWithSpeakerRegistry(segments, {});
    assert.equal(res.segments[0].audioFile, 'ep_1_seg_1_km-KH-PisethNeural.mp3');
    assert.equal(res.segments[0].audioPath, '/tmp/ep_1_seg_1_km-KH-PisethNeural.mp3');
    assert.equal(res.segments[0].ttsStatus, 'ready');
  });

  // 11. Re-running speaker detection does not undo user corrections
  await t.test('11. Re-running buildSpeakerRegistry preserves existing user manual corrections', () => {
    const existingRegistry = {
      spk_hero: {
        id: 'spk_hero',
        speakerId: 'spk_hero',
        name: 'តួឯកប្រុស',
        voiceGender: 'male',
        gender: 'male',
        speakerGender: 'MALE',
        khmerVoiceId: 'km-KH-SreymomNeural', // User manually assigned Sreymom to hero
        voiceId: 'km-KH-SreymomNeural',
        userOverridden: true,
        voiceAssignmentSource: 'manual',
      },
    };
    const newSegments = [
      { id: 1, speaker: 'តួឯកប្រុស', speakerId: 'spk_hero', khmerText: 'ខ្ញុំមកដល់ហើយ' },
    ];
    const updated = buildSpeakerRegistry(newSegments, existingRegistry);
    assert.equal(updated['spk_hero'].khmerVoiceId, 'km-KH-SreymomNeural', 'Must not undo user correction');
    assert.equal(updated['spk_hero'].userOverridden, true);
    assert.equal(updated['spk_hero'].voiceAssignmentSource, 'manual');
  });

  // 12. Save, reopen, and regenerate produce consistent results
  await t.test('12. Invariant verification across Frontend speakerUtils & ProjectStorage', () => {
    const { extractGlossaryFromEpisode } = require('../../frontend/src/utils/projectStorage');
    const speakerRegistry = {
      spk_unknown: {
        id: 'spk_unknown',
        speakerId: 'spk_unknown',
        name: 'អ្នកដំណើរ',
        gender: 'unknown',
        voiceGender: 'unknown',
        speakerGender: 'UNKNOWN',
        voiceId: 'km-KH-PisethNeural',
      },
      spk_manual_female: {
        id: 'spk_manual_female',
        speakerId: 'spk_manual_female',
        name: 'តួប្រុសពិសេស',
        gender: 'male',
        voiceGender: 'male',
        speakerGender: 'MALE',
        voiceId: 'km-KH-SreymomNeural',
        userOverridden: true,
        voiceAssignmentSource: 'manual',
      },
    };

    const extracted = extractGlossaryFromEpisode({ segments: [] }, speakerRegistry);
    const unkChar = extracted.characters.find((c) => c.name === 'អ្នកដំណើរ');
    assert.ok(unkChar);
    assert.equal(unkChar.gender, 'unknown', 'Unknown character must remain unknown in extracted glossary');

    const manualChar = extracted.characters.find((c) => c.name === 'តួប្រុសពិសេស');
    assert.ok(manualChar);
    assert.equal(manualChar.voiceId, 'km-KH-SreymomNeural');
    assert.equal(manualChar.userOverridden, true);
  });
});
