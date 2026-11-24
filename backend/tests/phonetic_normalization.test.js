const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { cleanTextForTts } = require('../services/ttsService');

describe('Khmer TTS Phonetic Normalization (Rank A -> អា)', () => {
  it('1. Converts rank/level/class letter A to Khmer អា', () => {
    assert.equal(
      cleanTextForTts('កាំបិតជាឧបករណ៍កម្រិត A'),
      'កាំបិតជាឧបករណ៍កម្រិត អា',
      'Must normalize "កម្រិត A" to "កម្រិត អា"'
    );
    assert.equal(
      cleanTextForTts('កាំបិតជាឧបករណ៍កម្រិតA'),
      'កាំបិតជាឧបករណ៍កម្រិត អា',
      'Must normalize "កម្រិតA" (no space) to "កម្រិត អា"'
    );
    assert.equal(
      cleanTextForTts('ថ្នាក់ A'),
      'ថ្នាក់ អា',
      'Must normalize "ថ្នាក់ A" to "ថ្នាក់ អា"'
    );
    assert.equal(
      cleanTextForTts('លំដាប់ A'),
      'លំដាប់ អា',
      'Must normalize "លំដាប់ A" to "លំដាប់ អា"'
    );
    assert.equal(
      cleanTextForTts('ចំណាត់ថ្នាក់ A'),
      'ចំណាត់ថ្នាក់ អា',
      'Must normalize "ចំណាត់ថ្នាក់ A" to "ចំណាត់ថ្នាក់ អា"'
    );
    assert.equal(
      cleanTextForTts('Rank A'),
      'Rank អា',
      'Must normalize "Rank A" to "Rank អា"'
    );
    assert.equal(
      cleanTextForTts('Level A'),
      'Level អា',
      'Must normalize "Level A" to "Level អា"'
    );
    assert.equal(
      cleanTextForTts('Class A'),
      'Class អា',
      'Must normalize "Class A" to "Class អា"'
    );
  });

  it('2. Converts standalone uppercase letter A in Khmer sentences', () => {
    assert.equal(
      cleanTextForTts('គាត់ជា Hunter កម្រិត A ដ៏ល្បី'),
      'គាត់ជា Hunter កម្រិត អា ដ៏ល្បី'
    );
    assert.equal(
      cleanTextForTts('កម្រិត A!'),
      'កម្រិត អា!'
    );
    assert.equal(
      cleanTextForTts('កម្រិត A+'),
      'កម្រិត អា+'
    );
    assert.equal(
      cleanTextForTts('ឧបករណ៍ A នេះល្អ'),
      'ឧបករណ៍ អា នេះល្អ'
    );
  });

  it('3. Preserves English words and other rank letters untouched', () => {
    // English words containing A
    assert.equal(cleanTextForTts('Apple'), 'Apple');
    assert.equal(cleanTextForTts('Auto-fit'), 'Auto-fit');
    assert.equal(cleanTextForTts('Admin'), 'Admin');
    assert.equal(cleanTextForTts('AI'), 'AI');
    assert.equal(cleanTextForTts('DNA'), 'DNA');
    assert.equal(cleanTextForTts('Attack'), 'Attack');

    // Other rank letters (S, B, C, D)
    assert.equal(cleanTextForTts('កម្រិត S'), 'កម្រិត S');
    assert.equal(cleanTextForTts('កម្រិត B'), 'កម្រិត B');
    assert.equal(cleanTextForTts('កម្រិត C'), 'កម្រិត C');
    assert.equal(cleanTextForTts('កម្រិត D'), 'កម្រិត D');
  });

  it('4. Synthesizes "កាំបិតជាឧបករណ៍កម្រិត A" cleanly with Piseth Neural', async () => {
    const { generateSingleSegmentAudio } = require('../services/ttsService');
    const segment = {
      id: 9999,
      khmer: 'កាំបិតជាឧបករណ៍កម្រិត A',
      khmerText: 'កាំបិតជាឧបករណ៍កម្រិត A',
      voiceId: 'km-KH-PisethNeural',
      speed: 'normal',
    };
    const tempDir = path.resolve(__dirname, '../uploads/cache/temp_phonetic_test');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const result = await generateSingleSegmentAudio(segment, tempDir, { forceRegen: true });
    assert.ok(result.audioPath, 'Audio path must be returned');
    assert.ok(fs.existsSync(result.audioPath), 'Audio file must exist');
    const dur = result.audioDuration || result.audioDurationSec || result.finalAudioDuration;
    assert.ok(dur > 0.5, 'Audio duration must be valid');

    // Cleanup test audio
    try {
      if (fs.existsSync(result.audioPath)) fs.unlinkSync(result.audioPath);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch (_) {}
  });
});
