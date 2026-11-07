const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeKhmerDialogue } = require('../services/geminiService');
const { cleanKhmerSpokenText } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');

test('Zero-Tolerance Thai Filter: sanitizeKhmerDialogue eliminates Thai script and maps Thai loanwords', () => {
  // Test 1: Nha's exact bug scenario with Gemini hallucinating Thai drama slang
  const bugInput = 'ไอ้ស្វាស្អាក ออกมานี่!';
  const sanitized = sanitizeKhmerDialogue(bugInput);
  // 'ไอ้' -> 'អា', 'ออกมานี่' -> 'ចេញមកនេះ', no Thai chars left
  assert.equal(/[\u0E00-\u0E7F]/.test(sanitized), false, 'Must not contain any Thai Unicode characters');
  assert.equal(sanitized, 'អាស្វាស្អាក ចេញមកនេះ!');

  // Test 2: Thai narrator loanwords
  const thaiNarrator = 'ผู้บรรยาย និយាយរឿង';
  const cleanNarrator = sanitizeKhmerDialogue(thaiNarrator);
  assert.equal(/[\u0E00-\u0E7F]/.test(cleanNarrator), false);
  assert.equal(cleanNarrator, 'អ្នករៀបរាប់ និយាយរឿង');

  // Test 3: Common Thai slang words (มึง, กู, ยาก, มั่ง)
  const thaiSlang = 'มึง ទៅណា? ยาก ណាស់';
  const cleanSlang = sanitizeKhmerDialogue(thaiSlang);
  assert.equal(/[\u0E00-\u0E7F]/.test(cleanSlang), false);
  assert.equal(cleanSlang, 'ឯង ទៅណា? ពិបាក ណាស់');
});

test('Zero-Tolerance Thai Filter: cleanKhmerSpokenText in Stage 6 eliminates Thai characters', () => {
  const stage6Input = 'ไอ้ស្វាស្អុយ ออกមក!';
  const stage6Clean = cleanKhmerSpokenText(stage6Input);
  assert.equal(/[\u0E00-\u0E7F]/.test(stage6Clean), false);
  assert.ok(stage6Clean.includes('អាស្វាស្អុយ'));
});

