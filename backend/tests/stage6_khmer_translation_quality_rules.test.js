const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateModeSpecificScript } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');

const stage6File = path.resolve(__dirname, '../services/pipeline/stages/stage6_generateModeSpecificScript.js');
const stage6Source = fs.readFileSync(stage6File, 'utf8');

describe('Stage 6 Khmer Translation Quality Rules (Anti-Translationese)', () => {
  it('1. Static audit: Mode A prompt includes RULE 1 (degree words), RULE 2 (explicit subject), and RULE 3 (natural single-marker questions) without removing existing rules', () => {
    // New rules present
    assert.ok(stage6Source.includes('RULE 1 — រក្សាពាក្យកម្រិត និងបរិមាណ'), 'Mode A must define RULE 1 for degree words');
    assert.ok(stage6Source.includes('一点/有点') && stage6Source.includes('បន្តិច / ល្មមៗ'), 'RULE 1 must map 一点/有点 to បន្តិច/ល្មមៗ');
    assert.ok(stage6Source.includes('很/非常') && stage6Source.includes('更 (កាន់តែ)'), 'RULE 1 must cover 很/非常 and 更');
    assert.ok(stage6Source.includes('RULE 2 — បញ្ជាក់ប្រធានឱ្យច្បាស់'), 'Mode A must define RULE 2 for explicit subject');
    assert.ok(stage6Source.includes('舍不得'), 'RULE 2 must include 舍不得 subject disambiguation');
    assert.ok(stage6Source.includes('RULE 3 — សំណួរភាសាខ្មែរធម្មជាតិ'), 'Mode A must define RULE 3 for natural Khmer questions');
    assert.ok(stage6Source.includes('难道...吗') && stage6Source.includes('ទេឬ?') && stage6Source.includes('មែនទេ?'), 'RULE 3 must enforce single Khmer question marker');
    assert.ok(stage6Source.includes('ឬមួយ...') && stage6Source.includes('ឬក៏អ្វី?'), 'RULE 3 must explicitly forbid stacking ឬមួយ with ឬក៏អ្វី?');

    // Existing rules preserved intact
    assert.ok(stage6Source.includes('MANDATORY PRE-TRANSLATION CAST REGISTRY'), 'Existing Rule 1 preserved');
    assert.ok(stage6Source.includes('COMPACT & PUNCHY SUBTITLE STYLE'), 'Existing Rule 2 preserved');
    assert.ok(stage6Source.includes('<= 5.5 syllables/sec'), 'Existing lip-sync rule preserved');
    assert.ok(stage6Source.includes('THE SOLE TRANSLATION TARGET'), 'Existing source-vs-context rule preserved');
    assert.ok(stage6Source.includes('STRICT CLAUSE BOUNDARY & ANTI-DUPLICATION'), 'Existing Rule 8 preserved');
  });

  it('2. Static audit: Mode B recap prompt also enforces degree words, explicit subject, and natural Khmer questions', () => {
    const modeBIdx = stage6Source.indexOf('MODE B - CINEMATIC DRAMA RECAP');
    assert.ok(modeBIdx > 0, 'Mode B prompt must exist');
    const modeBSection = stage6Source.slice(modeBIdx, modeBIdx + 2500);
    assert.ok(modeBSection.includes('KEEP DEGREE WORDS'), 'Mode B must include degree words rule');
    assert.ok(modeBSection.includes('EXPLICIT SUBJECT'), 'Mode B must include explicit subject rule');
    assert.ok(modeBSection.includes('NATURAL KHMER QUESTIONS'), 'Mode B must include natural Khmer questions rule');
  });

  it('3. Runtime check: generateModeSpecificScript Mode A injects all 3 rules into prompt payload and preserves 1:1 segment count', async () => {
    let capturedPrompt = '';
    const mockAiClient = {
      models: {
        generateContent: async ({ contents }) => {
          capturedPrompt = Array.isArray(contents) ? contents.join('\n') : String(contents || '');
          return {
            text: JSON.stringify({
              summary: 'សាកល្បង',
              detectedGenre: 'ancient',
              castRegistry: [],
              segments: [
                { index: 1, speaker: 'តួឯកប្រុស', gender: 'male', khmerText: 'សូម្បីតែមនុស្សមានទេពកោសល្យល្មមៗ ក៏បក្សមិនដាច់ចិត្តលះបង់ដែរ' },
                { index: 2, speaker: 'តួឯកប្រុស', gender: 'male', khmerText: 'ពួកគេមិនមែនមករកខ្ញុំទេឬ?' },
              ],
            }),
          };
        },
      },
    };

    const inputSegs = [
      { id: 59, segmentId: 59, startSec: 0, endSec: 2.59, duration: 2.59, originalChineseText: '竟连资质好一点的人都舍不得' },
      { id: 87, segmentId: 87, startSec: 3, endSec: 5.28, duration: 2.28, originalChineseText: '难道他们不是冲着我来的' },
    ];

    const result = await generateModeSpecificScript({
      mode: 'dialogue',
      reconciledSegments: inputSegs,
      durationSec: 6,
      aiClient: mockAiClient,
      genre: 'ancient',
    });

    assert.equal(result.scriptSegments.length, 2, '1:1 segment count must hold');
    assert.ok(capturedPrompt.includes('RULE 1 — រក្សាពាក្យកម្រិត និងបរិមាណ'), 'Prompt sent to Gemini includes RULE 1');
    assert.ok(capturedPrompt.includes('RULE 2 — បញ្ជាក់ប្រធានឱ្យច្បាស់'), 'Prompt sent to Gemini includes RULE 2');
    assert.ok(capturedPrompt.includes('RULE 3 — សំណួរភាសាខ្មែរធម្មជាតិ'), 'Prompt sent to Gemini includes RULE 3');
  });
});
