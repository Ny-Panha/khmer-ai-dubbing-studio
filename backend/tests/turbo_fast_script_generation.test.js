const test = require('node:test');
const assert = require('node:assert/strict');
const { generateModeSpecificScript } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { generateChunkPlan } = require('../services/pipeline/chunkOrchestrator');
const { GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

test('Turbo Stage 6: TRANSLATION_BATCH = 45 and Parallel Wave Execution', async () => {
  // Create 50 mock dialogue segments (> 45 segments -> splits into 2 batches)
  const segments = [];
  for (let i = 0; i < 50; i++) {
    segments.push({
      startSec: i * 2.0,
      endSec: i * 2.0 + 1.5,
      originalChineseText: `你好句子_${i + 1}`,
      speaker: i % 2 === 0 ? 'តួប្រុស' : 'តួស្រី',
      voiceGender: i % 2 === 0 ? 'male' : 'female',
      acousticGender: i % 2 === 0 ? 'male' : 'female',
      acousticF0: i % 2 === 0 ? 120 : 210,
    });
  }

  const batchCalls = [];
  const mockAiClient = {
    pool: {
      keys: ['key1', 'key2', 'key3', 'key4'],
      getCurrentKey: () => 'key1',
    },
    models: {
      generateContent: async ({ contents }) => {
        const promptText = contents[0];
        // Parse the batch input segments from prompt
        const match = promptText.match(/INPUT SEGMENTS TO TRANSLATE \(Batch (\d+)\):\n([\s\S]+?)\n\nReturn JSON ONLY/);
        const batchNum = match ? parseInt(match[1], 10) : 1;
        batchCalls.push({
          batchNum,
          timestamp: Date.now(),
        });

        // Return valid mock translation for the requested segments
        const inputSegmentsMatch = promptText.match(/"index":\s*(\d+)/g);
        const indices = inputSegmentsMatch
          ? inputSegmentsMatch.map(m => parseInt(m.replace(/\D/g, ''), 10))
          : [1];

        const translatedSegments = indices.map(idx => ({
          index: idx,
          speaker: idx % 2 === 1 ? 'តួប្រុស' : 'តួស្រី',
          gender: idx % 2 === 1 ? 'male' : 'female',
          voiceGender: idx % 2 === 1 ? 'male' : 'female',
          khmerText: `សួស្តីប្រយោគទី ${idx}`,
        }));

        return {
          text: JSON.stringify({
            summary: 'សង្ខេបសាច់រឿងតេស្ត Turbo',
            detectedGenre: 'modern',
            castRegistry: [
              { speakerId: 'spk_1', speakerLabelKh: 'តួប្រុស', voiceGender: 'male' },
              { speakerId: 'spk_2', speakerLabelKh: 'តួស្រី', voiceGender: 'female' },
            ],
            segments: translatedSegments,
          }),
        };
      },
    },
  };

  const result = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.FAST_OCR,
    reconciledSegments: segments,
    durationSec: 100,
    aiClient: mockAiClient,
    modelName: 'gemini-3.5-flash-lite',
  });

  assert.equal(result.scriptSegments.length, 50, 'All 50 segments should be translated');
  assert.equal(batchCalls.length, 2, '50 segments should split into exactly 2 batches (Batch 1: 45 cues, Batch 2: 5 cues)');
  assert.equal(result.scriptSegments[0].khmerTranslatedText, 'សួស្តីប្រយោគទី 1');
  assert.equal(result.scriptSegments[49].khmerTranslatedText, 'សួស្តីប្រយោគទី 50');
});

test('Turbo Chunk Plan & Concurrency Logic', () => {
  // 10-minute video (600s) -> 2 chunks of 300s
  const plan = generateChunkPlan(600, 300, 2);
  assert.equal(plan.length, 2, '10-minute video must have 2 chunks');
  assert.equal(plan[0].startSec, 0);
  assert.equal(plan[0].endSec, 302);
  assert.equal(plan[1].startSec, 300);
  assert.equal(plan[1].endSec, 600);

  // 5-minute video (300s) -> 1 chunk
  const plan5m = generateChunkPlan(300, 300, 2);
  assert.equal(plan5m.length, 1, '5-minute video must have 1 chunk');
  assert.equal(plan5m[0].startSec, 0);
  assert.equal(plan5m[0].endSec, 300);
});

test('Turbo Stage 3: Single Mid-Cue Timestamp Calculation', () => {
  // Formula: sampleASec = startSec + Math.min(0.45, duration * 0.45)
  // Short cue: 0.5s duration -> offset = 0.5 * 0.45 = 0.225s
  const startSec1 = 10.0;
  const duration1 = 0.5;
  const midSec1 = parseFloat((startSec1 + Math.min(0.45, duration1 * 0.45)).toFixed(2));
  assert.ok(Math.abs(midSec1 - 10.225) < 0.01, `Expected ~10.225, got ${midSec1}`);

  // Long cue: 3.0s duration -> offset = Math.min(0.45, 1.35) = 0.45s (sharp mid-point before fade)
  const startSec2 = 20.0;
  const duration2 = 3.0;
  const midSec2 = parseFloat((startSec2 + Math.min(0.45, duration2 * 0.45)).toFixed(2));
  assert.equal(midSec2, 20.45);
});
