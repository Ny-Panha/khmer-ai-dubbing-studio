const test = require('node:test');
const assert = require('node:assert/strict');
const {
  systemPrompt,
  FAST_EXECUTION_SYSTEM_PROMPT,
  FAST_SCRIPT_RESPONSE_SCHEMA,
  safeParseOrRepairJson,
  normalizeScriptData,
} = require('../services/geminiService');
const {
  detectGender,
  getVoiceForGender,
  detectSpeakerGender,
} = require('../models/speakerRegistry');

test('Fast-Execution Multimodal Prompt: exports and exact rule verification', () => {
  assert.ok(systemPrompt, 'systemPrompt should be defined and non-empty');
  assert.equal(systemPrompt, FAST_EXECUTION_SYSTEM_PROMPT, 'FAST_EXECUTION_SYSTEM_PROMPT should equal systemPrompt');

  // Verify critical prompt rules requested by Nha
  assert.match(systemPrompt, /NO DESCRIPTIONS/);
  assert.match(systemPrompt, /DIALOGUE ONLY/);
  assert.match(systemPrompt, /CONCISENESS/);
  assert.match(systemPrompt, /SPEAKER IDENTIFICATION/);
  assert.match(systemPrompt, /SPEAKER IDENTIFICATION MUST BE GENDER SPECIFIC/);
  assert.match(systemPrompt, /"start_time":\s*"00:00\.00"/);
  assert.match(systemPrompt, /"end_time":\s*"00:03\.00"/);
  assert.match(systemPrompt, /"speaker":\s*"តួប្រុស"/);
  assert.match(systemPrompt, /"khmer_dialogue":\s*"ខ្ញុំប្រាប់ហើយថាកុំឱ្យទៅ!"/);

  // Fast response schema verification
  assert.equal(FAST_SCRIPT_RESPONSE_SCHEMA.type, 'ARRAY');
  assert.deepEqual(FAST_SCRIPT_RESPONSE_SCHEMA.items.required, [
    'start_time',
    'end_time',
    'speaker',
    'khmer_dialogue',
  ]);
});

test('Speaker-to-Voice Mapping: detectGender and getVoiceForGender', () => {
  const maleKeywords = ['តួប្រុស', 'បុរស', 'លោក', 'បងប្រុស', 'ពូ', 'តា', 'លោកប្រធាន', 'male', 'man', 'boy'];
  const femaleKeywords = ['តួស្រី', 'នារី', 'ស្ត្រី', 'អ្នកស្រី', 'បងស្រី', 'មីង', 'យាយ', 'តួឯកស្រី', 'female', 'woman', 'girl'];

  for (const kw of maleKeywords) {
    assert.equal(detectGender(kw), 'male', `Expected ${kw} to detect male`);
    assert.equal(getVoiceForGender(detectGender(kw)), 'km-KH-PisethNeural');
  }

  for (const kw of femaleKeywords) {
    assert.equal(detectGender(kw), 'female', `Expected ${kw} to detect female`);
    assert.equal(getVoiceForGender(detectGender(kw)), 'km-KH-SreymomNeural');
  }
});

test('Fast-Execution Multimodal Prompt: safeParseOrRepairJson handles pure JSON array', () => {
  const sampleArrayJson = `
  [
    {
      "start_time": "00:00.00",
      "end_time": "00:03.00",
      "speaker": "តួប្រុស",
      "khmer_dialogue": "ខ្ញុំប្រាប់ហើយថាកុំឱ្យទៅ!"
    },
    {
      "start_time": "00:03.20",
      "end_time": "00:06.50",
      "speaker": "តួស្រី",
      "khmer_dialogue": "ខ្ញុំមិនស្ដាប់ទេ!"
    }
  ]
  `;

  const parsed = safeParseOrRepairJson(sampleArrayJson);
  assert.ok(Array.isArray(parsed) || Array.isArray(parsed.segments));
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].speaker, 'តួប្រុស');
  assert.equal(parsed.segments[1].speaker, 'តួស្រី');
});

test('Fast-Execution Multimodal Prompt: normalizeScriptData maps dialogue array to valid segments', () => {
  const rawArray = [
    {
      start_time: '00:01.00',
      end_time: '00:04.20',
      speaker: 'តួប្រុស',
      khmer_dialogue: 'ឈប់សិន! កុំទាន់ទៅ!',
    },
    {
      start_time: '00:04.50',
      end_time: '00:07.80',
      speaker: 'តួស្រី',
      khmer_dialogue: 'លែងដៃខ្ញុំភ្លាម!',
    },
  ];

  const normalized = normalizeScriptData(rawArray, 'dialogue');
  assert.ok(normalized.segments.length >= 2);

  const seg1 = normalized.segments[0];
  assert.equal(seg1.startSec, 1.0);
  assert.equal(seg1.endSec, 4.2);
  assert.equal(seg1.speaker, 'តួប្រុស');
  assert.equal(seg1.gender, 'male');
  assert.equal(seg1.voiceGender, 'male');
  assert.equal(seg1.khmer, 'ឈប់សិន! កុំទាន់ទៅ!');
  assert.equal(seg1.khmer_dialogue, 'ឈប់សិន! កុំទាន់ទៅ!');
  assert.equal(seg1.khmerVoiceId, 'km-KH-PisethNeural');

  const seg2 = normalized.segments[1];
  assert.equal(seg2.startSec, 4.5);
  assert.equal(seg2.endSec, 7.8);
  assert.equal(seg2.speaker, 'តួស្រី');
  assert.equal(seg2.gender, 'female');
  assert.equal(seg2.voiceGender, 'female');
  assert.equal(seg2.khmer, 'លែងដៃខ្ញុំភ្លាម!');
  assert.equal(seg2.khmer_dialogue, 'លែងដៃខ្ញុំភ្លាម!');
  assert.equal(seg2.khmerVoiceId, 'km-KH-SreymomNeural');
});
