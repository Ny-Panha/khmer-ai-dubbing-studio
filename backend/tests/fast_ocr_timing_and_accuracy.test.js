const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  deduplicateFastOcrCues,
  areChineseTextsEquivalent,
  normalizeChineseChars,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const {
  generateModeSpecificScript,
  createCanonicalSegment,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

test('1. Fast-changing subtitle detection (< 1s): Short cue preserved without tie-break deletion', () => {
  // Simulate short subtitle lasting 0.6s where sampleA saw text, sampleB was blank (already disappeared)
  const rawCues = [
    {
      startSec: 10.0,
      endSec: 10.65,
      duration: 0.65,
      chineseText: '快走！',
      originalChineseText: '快走！',
      textZh: '快走！',
      visualGender: 'female',
      ocrConfidence: 'high',
      isSharp: true,
    },
    {
      startSec: 11.2,
      endSec: 12.8,
      duration: 1.6,
      chineseText: '他们追上来了',
      originalChineseText: '他们追上来了',
      textZh: '他们追上来了',
      visualGender: 'male',
      ocrConfidence: 'high',
      isSharp: true,
    },
  ];

  const deduped = deduplicateFastOcrCues(rawCues, 'male');
  assert.equal(deduped.length, 2, 'Must keep both the short subtitle and the subsequent dialogue');
  assert.equal(deduped[0].chineseText, '快走！');
  assert.equal(deduped[0].duration, 0.65);
  assert.equal(deduped[0].voiceGender, 'female', 'Should preserve female visualGender from Vision OCR');
  assert.equal(deduped[0].khmerVoiceId, 'km-KH-SreymomNeural', 'Female visualGender must get Sreymom voice');
  assert.equal(deduped[1].chineseText, '他们追上来了');
  assert.equal(deduped[1].voiceGender, 'male', 'Male visualGender must get Piseth voice');
  assert.equal(deduped[1].khmerVoiceId, 'km-KH-PisethNeural');
});

test('2. Two distinct consecutive subtitles in rapid succession: Both preserved without collision', () => {
  // Rapid succession dialogue: Line A at 5.0-5.8s, Line B at 5.8-6.6s
  const rawCues = [
    { startSec: 5.0, endSec: 5.8, chineseText: '你快走', visualGender: 'male' },
    { startSec: 5.8, endSec: 6.6, chineseText: '我来断后', visualGender: 'male' },
  ];

  const deduped = deduplicateFastOcrCues(rawCues, 'male');
  assert.equal(deduped.length, 2, 'Both distinct Chinese dialogue cues must be preserved');
  assert.equal(deduped[0].chineseText, '你快走');
  assert.equal(deduped[1].chineseText, '我来断后');
  assert.ok(deduped[0].endSec <= deduped[1].startSec, 'No timestamp overlap between consecutive cues');
});

test('3. Non-overlapping timestamp protection: Clamps preceding cue to avoid timeline overlap', () => {
  // Cue 1 slightly overlaps Cue 2 due to rounding: 1.0 -> 2.65, while Cue 2 starts at 2.50
  const rawCues = [
    { startSec: 1.0, endSec: 2.65, chineseText: '今天天气很好' },
    { startSec: 2.50, endSec: 4.0, chineseText: '我们去公园吧' },
  ];

  const deduped = deduplicateFastOcrCues(rawCues, 'male');
  assert.equal(deduped.length, 2);
  assert.ok(deduped[0].endSec <= deduped[1].startSec, `Cue 1 endSec (${deduped[0].endSec}) must not exceed Cue 2 startSec (${deduped[1].startSec})`);
  assert.equal(deduped[0].endSec, 2.50);
});

test('4. Gender-to-Voice Assignment: Automatically maps detected character visualGender to Khmer voice', () => {
  const cues = [
    { startSec: 1.0, endSec: 2.5, chineseText: '女主角说话', visualGender: 'female' },
    { startSec: 3.0, endSec: 4.5, chineseText: '男主角说话', visualGender: 'male' },
    { startSec: 5.0, endSec: 6.5, chineseText: '路人说话', visualGender: 'unknown' },
  ];

  const processed = deduplicateFastOcrCues(cues, 'male');
  assert.equal(processed[0].voiceGender, 'female');
  assert.equal(processed[0].voiceId, 'km-KH-SreymomNeural');
  assert.equal(processed[1].voiceGender, 'male');
  assert.equal(processed[1].voiceId, 'km-KH-PisethNeural');
  assert.equal(processed[2].voiceGender, 'male', 'Unknown gender falls back to defaultGender');
  assert.equal(processed[2].voiceId, 'km-KH-PisethNeural');
});

test('5. Strict 1:1 segment mapping in Stage 6 Fast OCR Mode: Long sentences are NOT split', async () => {
  // Long Chinese subtitle cue (> 6s) with sentence-ending punctuation
  const inputSegments = [
    {
      id: 1,
      segmentId: 1,
      startSec: 2.0,
      endSec: 9.5,
      duration: 7.5,
      sourceStartSec: 2.0,
      sourceEndSec: 9.5,
      originalChineseText: '我们今天必须完成这项任务！如果不完成，后果不堪设想。',
      chineseText: '我们今天必须完成这项任务！如果不完成，后果不堪设想。',
      visualGender: 'female',
      voiceGender: 'female',
      voiceId: 'km-KH-SreymomNeural',
    },
    {
      id: 2,
      segmentId: 2,
      startSec: 10.0,
      endSec: 13.0,
      duration: 3.0,
      sourceStartSec: 10.0,
      sourceEndSec: 13.0,
      originalChineseText: '遵命！属下明白。',
      chineseText: '遵命！属下明白。',
      visualGender: 'male',
      voiceGender: 'male',
      voiceId: 'km-KH-PisethNeural',
    },
  ];

  const fakeAiClient = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          summary: 'ការសន្ទនា',
          detectedGenre: 'ancient',
          castRegistry: [],
          segments: [
            { index: 1, speaker: 'តួស្រី', voiceGender: 'female', khmerText: 'យើងត្រូវតែបញ្ចប់ការងារនេះថ្ងៃនេះ' },
            { index: 2, speaker: 'តួប្រុស', voiceGender: 'male', khmerText: 'ទូលបង្គំយល់ហើយ' },
          ],
        }),
      }),
    },
  };

  const result = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.FAST_OCR,
    reconciledSegments: inputSegments,
    durationSec: 15.0,
    aiClient: fakeAiClient,
    modelName: 'gemini-3.5-flash-lite',
  });

  assert.equal(result.scriptSegments.length, 2, 'Fast OCR mode MUST preserve 1:1 mapping (exactly 2 segments)');
  assert.equal(result.scriptSegments[0].sourceStartSec, 2.0);
  assert.equal(result.scriptSegments[0].sourceEndSec, 9.5);
  assert.equal(result.scriptSegments[0].khmerTranslatedText, 'យើងត្រូវតែបញ្ចប់ការងារនេះថ្ងៃនេះ');
  assert.equal(result.scriptSegments[1].sourceStartSec, 10.0);
  assert.equal(result.scriptSegments[1].sourceEndSec, 13.0);
  assert.equal(result.scriptSegments[1].khmerTranslatedText, 'ទូលបង្គំយល់ហើយ');
});

test('6. Uncertain OCR tagging: Marks uncertainOcr and reviewNeeded on canonical segments', () => {
  const uncertainRaw = {
    id: 1,
    startSec: 5.0,
    endSec: 7.0,
    chineseText: '模糊的文字',
    khmerTranslatedText: 'អត្ថបទព្រាលៗ',
    ocrConfidence: 'low',
    uncertainOcr: true,
    ocrDisagreement: true,
  };

  const canonical = createCanonicalSegment(uncertainRaw, 0, 'dialogue');
  assert.equal(canonical.uncertainOcr, true);
  assert.equal(canonical.ocrConfidence, 'low');
  assert.equal(canonical.ocrDisagreement, true);
  assert.equal(canonical.reviewNeeded, true, 'Uncertain OCR must flag reviewNeeded for UI Amber warning badge');
});

test('7. Job dispatch compatibility: pipelineMode="fast_ocr" resolves to FAST_OCR mode', () => {
  // Simulates jobRoutes logic for incoming request body
  const bodyWithPipelineMode = {
    videoId: 'vid_123',
    pipelineMode: 'fast_ocr',
    mode: 'dialogue',
  };

  const {
    mode: rawMode = 'dialogue',
    dubbingMode: rawDubbingMode,
    generationMode: rawGenMode,
    pipelineMode,
  } = bodyWithPipelineMode;

  const generationMode = rawGenMode || (pipelineMode === 'fast_ocr' ? 'fast_ocr' : null) || (rawMode === 'fast_ocr' ? 'fast_ocr' : 'standard');
  const effectiveDubbingMode = rawDubbingMode || (rawMode === 'recap' ? 'recap' : 'dialogue');
  const mode = effectiveDubbingMode === 'recap'
    ? GENERATION_MODES.MODE_B_RECAP
    : (generationMode === 'fast_ocr' ? GENERATION_MODES.FAST_OCR : rawMode);

  assert.equal(generationMode, 'fast_ocr');
  assert.equal(mode, GENERATION_MODES.FAST_OCR, 'Job must be configured to FAST_OCR to bypass Stage 4 & 5');
});

test('8. Chunk boundary deduplication: Merges boundary overlap repeats cleanly', () => {
  // Chunk 1 ends with '我们要保护好大家', Chunk 2 begins with overlapping repeat of '我们要保护好大家'
  const chunk1Segments = [
    { startSec: 295.0, endSec: 298.5, chineseText: '我们要保护好大家', visualGender: 'male' },
  ];
  const chunk2Segments = [
    { startSec: 298.0, endSec: 301.5, chineseText: '我们要保护好大家', visualGender: 'male' },
    { startSec: 302.0, endSec: 304.5, chineseText: '敌人又来了', visualGender: 'male' },
  ];

  const allChunkSegments = [...chunk1Segments, ...chunk2Segments];
  const stitched = deduplicateFastOcrCues(allChunkSegments, 'male');

  assert.equal(stitched.length, 2, 'Boundary repeat must be merged into single unified segment');
  assert.equal(stitched[0].chineseText, '我们要保护好大家');
  assert.equal(stitched[0].startSec, 295.0);
  assert.equal(stitched[0].endSec, 301.5, 'Extended across boundary');
  assert.equal(stitched[1].chineseText, '敌人又来了');
});
