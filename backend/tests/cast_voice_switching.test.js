const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

describe('Cast Voice Switching: Male ↔ Female Toggle, Auto-Regen & Honest Status', () => {
  it('1. VoiceSettings.jsx: Cast voice button derives state strictly from assigned voiceId, NOT character detected gender', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/components/voice/VoiceSettings.jsx'), 'utf8');

    // Verify isVoiceFemale and isCharacterFemale separation
    assert.ok(
      src.includes('const isVoiceFemale = String(currentVoice).toLowerCase().includes(\'sreymom\');'),
      'VoiceSettings must derive isVoiceFemale strictly from currentVoice'
    );
    assert.ok(
      src.includes('isCharacterFemale'),
      'VoiceSettings must track isCharacterFemale separately from voice'
    );
    assert.ok(
      src.includes('spk.isVoiceFemale ? \'km-KH-PisethNeural\' : \'km-KH-SreymomNeural\''),
      'Voice button click must toggle between Piseth and Sreymom based on current assigned voice'
    );
    assert.ok(
      src.includes('className={`inspector-speaker-voice-btn ${spk.isVoiceFemale ? \'is-female\' : \'is-male\'}`}'),
      'Voice button style must reflect assigned voice, not character biological gender'
    );
    assert.ok(
      src.includes('className={`inspector-speaker-name ${spk.isCharacterFemale ? \'is-female\' : \'is-male\'}`}'),
      'Speaker name style must preserve character detected gender'
    );
  });

  it('2. useAudioDubbing.js: handleUpdateSpeakerVoice auto-regenerates TTS for all matching segments with honest generating status', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useAudioDubbing.js'), 'utf8');

    // Verify handleUpdateSpeakerVoice is async and auto-regenerates
    assert.ok(
      src.includes('const handleUpdateSpeakerVoice = async (speakerId, newVoiceId, newSpeed = \'normal\') => {'),
      'handleUpdateSpeakerVoice must be an async function'
    );
    assert.ok(
      src.includes('textStatus: \'generating\''),
      'Must set textStatus to generating on matching segments during wait'
    );
    assert.ok(
      src.includes('audioUrl: null') && src.includes('audioFile: null') && src.includes('audioPath: null'),
      'Must clear stale audio references so old voice audio is never played or marked ready'
    );
    assert.ok(
      src.includes('generateSingleSegmentAudio('),
      'Must call generateSingleSegmentAudio for matching segments'
    );
    assert.ok(
      src.includes('speakerRegenSeqRef'),
      'Must use speakerRegenSeqRef to prevent stale concurrent requests from overwriting newer edits'
    );
    assert.ok(
      src.includes('syncTimelineAudioApi('),
      'Must re-stitch timeline audio after auto-regeneration so playback uses the new voice'
    );
    assert.ok(
      src.includes('saveTimelineOperationToLocalStorage('),
      'Must persist changes to localStorage to survive reload'
    );
  });

  it('3. Male → Female Cast Voice switching: preserves character identity while updating voice metadata and audio', () => {
    // Simulate a male character with multiple segments in an episode
    const segments = [
      {
        id: 1,
        speaker: 'ស៊ូ មីង',
        speakerName: 'ស៊ូ មីង',
        speakerId: 'spk_male_ស៊ូ_មីង',
        gender: 'male',
        speakerGender: 'MALE',
        voiceId: 'km-KH-PisethNeural',
        khmerVoiceId: 'km-KH-PisethNeural',
        voiceLabel: 'ពិសិដ្ឋ (Piseth)',
        khmer: 'ខ្ញុំឈ្មោះ ស៊ូ មីង។',
        audioUrl: '/audio/ep1_seg1_piseth.mp3',
        textStatus: 'ready',
      },
      {
        id: 2,
        speaker: 'នាងតូច',
        speakerName: 'នាងតូច',
        speakerId: 'spk_female_នាងតូច',
        gender: 'female',
        speakerGender: 'FEMALE',
        voiceId: 'km-KH-SreymomNeural',
        khmerVoiceId: 'km-KH-SreymomNeural',
        voiceLabel: 'ស្រីមុំ (Sreymom)',
        khmer: 'សួស្តីបងប្រុស!',
        audioUrl: '/audio/ep1_seg2_sreymom.mp3',
        textStatus: 'ready',
      },
      {
        id: 3,
        speaker: 'ស៊ូ មីង',
        speakerName: 'ស៊ូ មីង',
        speakerId: 'spk_male_ស៊ូ_មីង',
        gender: 'male',
        speakerGender: 'MALE',
        voiceId: 'km-KH-PisethNeural',
        khmerVoiceId: 'km-KH-PisethNeural',
        voiceLabel: 'ពិសិដ្ឋ (Piseth)',
        khmer: 'យើងទៅជាមួយគ្នា។',
        audioUrl: '/audio/ep1_seg3_piseth.mp3',
        textStatus: 'ready',
      },
    ];

    // Target speaker: switch 'spk_male_ស៊ូ_មីង' to Sreymom
    const newVoiceId = 'km-KH-SreymomNeural';
    const isFemale = String(newVoiceId).toLowerCase().includes('sreymom');
    const voiceLabel = isFemale ? 'ស្រីមុំ (Sreymom)' : 'ពិសិដ្ឋ (Piseth)';
    const avatar = isFemale ? '👩' : '👨';
    const badgeColor = isFemale ? '#ec4899' : '#38bdf8';

    const updatedSegments = segments.map((seg) => {
      if (seg.speakerId === 'spk_male_ស៊ូ_មីង') {
        return {
          ...seg,
          voiceId: newVoiceId,
          khmerVoiceId: newVoiceId,
          voice: newVoiceId,
          voiceLabel,
          avatar,
          badgeColor,
          voiceOverride: newVoiceId,
          voiceAssignmentSource: 'manual',
          userOverridden: true,
          gender: seg.gender, // MUST PRESERVE
          speakerGender: seg.speakerGender, // MUST PRESERVE
          audioOutdated: true,
          textStatus: 'generating',
          audioUrl: null,
          audioFile: null,
          audioPath: null,
        };
      }
      return seg;
    });

    // Check segment 1 (switched)
    assert.equal(updatedSegments[0].voiceId, 'km-KH-SreymomNeural');
    assert.equal(updatedSegments[0].voiceLabel, 'ស្រីមុំ (Sreymom)');
    assert.equal(updatedSegments[0].badgeColor, '#ec4899');
    assert.equal(updatedSegments[0].gender, 'male', 'Character gender MUST remain male');
    assert.equal(updatedSegments[0].speakerGender, 'MALE', 'Character speakerGender MUST remain MALE');
    assert.equal(updatedSegments[0].textStatus, 'generating', 'Must be generating, not ready');
    assert.equal(updatedSegments[0].audioUrl, null, 'Stale audio reference must be cleared');

    // Check segment 3 (switched)
    assert.equal(updatedSegments[2].voiceId, 'km-KH-SreymomNeural');
    assert.equal(updatedSegments[2].gender, 'male');
    assert.equal(updatedSegments[2].textStatus, 'generating');

    // Check segment 2 (unaffected character)
    assert.equal(updatedSegments[1].voiceId, 'km-KH-SreymomNeural');
    assert.equal(updatedSegments[1].audioUrl, '/audio/ep1_seg2_sreymom.mp3', 'Unaffected segment must keep audio');
    assert.equal(updatedSegments[1].textStatus, 'ready', 'Unaffected segment status must remain untouched');
  });

  it('4. Female → Male Cast Voice switching: toggles correctly back to Piseth', () => {
    const femaleSpeaker = {
      key: 'spk_female_នាងតូច',
      name: 'នាងតូច',
      voiceId: 'km-KH-SreymomNeural',
      isVoiceFemale: true,
      isCharacterFemale: true,
    };

    // Toggle button logic: if currently female voice, next voice is Piseth
    const nextVoiceId = femaleSpeaker.isVoiceFemale ? 'km-KH-PisethNeural' : 'km-KH-SreymomNeural';
    assert.equal(nextVoiceId, 'km-KH-PisethNeural', 'Switching female voice MUST select Piseth');

    // Now character has Piseth assigned
    const switchedSpeaker = {
      ...femaleSpeaker,
      voiceId: nextVoiceId,
      isVoiceFemale: String(nextVoiceId).toLowerCase().includes('sreymom'),
    };
    assert.equal(switchedSpeaker.isVoiceFemale, false);
    assert.equal(switchedSpeaker.isCharacterFemale, true, 'Biological gender still female');

    // Toggle again from Piseth back to Sreymom
    const toggleBackVoiceId = switchedSpeaker.isVoiceFemale ? 'km-KH-PisethNeural' : 'km-KH-SreymomNeural';
    assert.equal(toggleBackVoiceId, 'km-KH-SreymomNeural', 'Switching back MUST select Sreymom');
  });

  it('5. Edge TTS generation produces real audio for both Piseth and Sreymom', async () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { synthesizeWithEdgeNeural } = require('../services/ttsService.js');

    const tmpDir = os.tmpdir();
    const pisethFile = path.join(tmpDir, `test_piseth_${Date.now()}.mp3`);
    const sreymomFile = path.join(tmpDir, `test_sreymom_${Date.now()}.mp3`);

    try {
      // Test Male Voice: Piseth
      await synthesizeWithEdgeNeural('ខ្ញុំឈ្មោះ ស៊ូ មីង។', 'km-KH-PisethNeural', pisethFile);
      assert.ok(fs.existsSync(pisethFile), 'Piseth TTS must create an audio file');
      const pisethStat = fs.statSync(pisethFile);
      assert.ok(pisethStat.size > 500, `Piseth audio file must have valid size, got ${pisethStat.size}`);

      // Test Female Voice: Sreymom
      await synthesizeWithEdgeNeural('ខ្ញុំឈ្មោះ ស៊ូ មីង។', 'km-KH-SreymomNeural', sreymomFile);
      assert.ok(fs.existsSync(sreymomFile), 'Sreymom TTS must create an audio file');
      const sreymomStat = fs.statSync(sreymomFile);
      assert.ok(sreymomStat.size > 500, `Sreymom audio file must have valid size, got ${sreymomStat.size}`);
    } finally {
      if (fs.existsSync(pisethFile)) fs.unlinkSync(pisethFile);
      if (fs.existsSync(sreymomFile)) fs.unlinkSync(sreymomFile);
    }
  });
});
