const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeKhmerSimilarity,
  detectDuplicateTranslations,
  createCanonicalSegment,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');

const {
  computeKhmerSimilarity: geminiSimilarity,
  detectDuplicateTranslations: geminiDetectDuplicates,
} = require('../services/geminiService');

test('Phase 1: computeKhmerSimilarity calculates accurate Dice-Sorensen score', () => {
  // Exact match
  assert.equal(computeKhmerSimilarity('កាលពីដប់ឆ្នាំមុន', 'កាលពីដប់ឆ្នាំមុន'), 1.0);
  assert.equal(geminiSimilarity('កាលពីដប់ឆ្នាំមុន', 'កាលពីដប់ឆ្នាំមុន'), 1.0);

  // High similarity (minor word diff)
  const highSim = computeKhmerSimilarity(
    'កាលពីដប់ឆ្នាំមុន ពេលដែលមេម៉ត់ពន្លត់រូងបើកពេញ មានមនុស្សពីរនាក់បានកើតគំនិតឡើងក្នុងពេលតែមួយ។',
    'កាលពីដប់ឆ្នាំមុន ពេលដែលមេម៉ត់ពន្លត់រូងបើកពេញ មានមនុស្សពីរនាក់បានកើតគំនិតឡើង'
  );
  assert.ok(highSim > 0.80, `Expected > 0.80, got ${highSim}`);

  // Completely distinct sentences
  const lowSim = computeKhmerSimilarity('កាលពីដប់ឆ្នាំមុន', 'មានមនុស្សពីរនាក់កើតគំនិតឡើង');
  assert.ok(lowSim < 0.35, `Expected < 0.35, got ${lowSim}`);

  // Empty strings
  assert.equal(computeKhmerSimilarity('', ''), 1.0);
  assert.equal(computeKhmerSimilarity('hello', ''), 0.0);
});

test('Phase 1: Segment #18 and #19 payload extraction separates source Chinese from audio context', () => {
  const fullAsrSentence = '十年前天蓬元帅离开高老庄时, 有两个人同时产生了一个念头。';
  const rawSegments = [
    {
      id: 18,
      segmentId: 18,
      startSec: 148.75,
      endSec: 158.13,
      duration: 9.38,
      originalChineseText: '十年前天蓬元帅离开高老庄时,',
      spokenAudioText: fullAsrSentence,
      ocrSubtitleText: '十年前天蓬元帅离开高老庄时',
    },
    {
      id: 19,
      segmentId: 19,
      startSec: 158.13,
      endSec: 158.80,
      duration: 10.05,
      originalChineseText: '有两个人同时产生了一个念头。',
      spokenAudioText: fullAsrSentence,
      ocrSubtitleText: '有两个人同时产生了一个念头',
    },
  ];

  // Emulate payload mapping in Stage 6
  const payload = rawSegments.map((s, idx) => {
    const rawDur = typeof s.duration === 'number' && s.duration > 0
      ? s.duration
      : parseFloat(Math.max(0.6, s.endSec - s.startSec).toFixed(2));
    const reliableSpeechDur = Number.isFinite(s.speechDuration) && s.speechDuration > 0
      ? s.speechDuration
      : null;
    const effectiveDur = reliableSpeechDur || Math.min(rawDur, 4.5);
    const maxWords = Math.min(16, Math.max(3, Math.ceil(effectiveDur * 3.2)));

    const segmentChinese = String(s.originalChineseText || s.chineseText || s.originalText || '').trim();
    const audioTranscript = String(s.spokenAudioText || '').trim();
    const targetToTranslate = segmentChinese || audioTranscript;
    const audioContext = (audioTranscript && audioTranscript !== targetToTranslate) ? audioTranscript : null;

    return {
      index: idx + 1,
      segmentId: s.segmentId || s.id || (idx + 1),
      durationSec: parseFloat(effectiveDur.toFixed(2)),
      maxKhmerWords: maxWords,
      sourceChineseToTranslate: targetToTranslate,
      surroundingAudioContext: audioContext,
    };
  });

  // Verify independent Chinese sources
  assert.equal(payload[0].sourceChineseToTranslate, '十年前天蓬元帅离开高老庄时,');
  assert.equal(payload[1].sourceChineseToTranslate, '有两个人同时产生了一个念头。');
  assert.notEqual(payload[0].sourceChineseToTranslate, payload[1].sourceChineseToTranslate);

  // Verify full ASR is NOT the primary translation target
  assert.notEqual(payload[0].sourceChineseToTranslate, fullAsrSentence);
  assert.notEqual(payload[1].sourceChineseToTranslate, fullAsrSentence);

  // Verify full ASR is relegated to surroundingAudioContext
  assert.equal(payload[0].surroundingAudioContext, fullAsrSentence);
  assert.equal(payload[1].surroundingAudioContext, fullAsrSentence);

  // Verify word budget is controlled (max 16 words instead of 33-36)
  assert.ok(payload[0].maxKhmerWords <= 16, `Expected <= 16, got ${payload[0].maxKhmerWords}`);
  assert.ok(payload[1].maxKhmerWords <= 16, `Expected <= 16, got ${payload[1].maxKhmerWords}`);
  assert.ok(payload[0].durationSec <= 4.5, `Expected <= 4.5, got ${payload[0].durationSec}`);
  assert.ok(payload[1].durationSec <= 4.5, `Expected <= 4.5, got ${payload[1].durationSec}`);
});

test('Phase 1: Different Chinese sources producing identical Khmer triggers POTENTIAL_DUPLICATE_TRANSLATION', () => {
  const segments = [
    {
      id: 18,
      originalChineseText: '十年前天蓬元帅离开高老庄时,',
      khmerTranslatedText: 'កាលពីដប់ឆ្នាំមុន ពេលមេទ័ពធៀនប៉ុងចាកចេញពីភូមិហ្កាវឡាវចួង មានមនុស្សពីរនាក់មានគំនិតដូចគ្នា។',
    },
    {
      id: 19,
      originalChineseText: '有两个人同时产生了一个念头。',
      khmerTranslatedText: 'កាលពីដប់ឆ្នាំមុន ពេលមេទ័ពធៀនប៉ុងចាកចេញពីភូមិហ្កាវឡាវចួង មានមនុស្សពីរនាក់មានគំនិតដូចគ្នា។',
    },
  ];

  const result = detectDuplicateTranslations(segments);

  // Segment 19 should have warning and reviewNeeded
  assert.equal(result[1].translationWarning, 'POTENTIAL_DUPLICATE_TRANSLATION');
  assert.equal(result[1].reviewNeeded, true);
  assert.ok(Array.isArray(result[1].validationWarnings));
  assert.ok(result[1].validationWarnings.some((w) => w.includes('POTENTIAL_DUPLICATE_TRANSLATION')));

  // Segment 18 should remain clean
  assert.equal(result[0].translationWarning, undefined);

  // Khmer text must NOT be deleted or mutated!
  assert.equal(
    result[1].khmerTranslatedText,
    'កាលពីដប់ឆ្នាំមុន ពេលមេទ័ពធៀនប៉ុងចាកចេញពីភូមិហ្កាវឡាវចួង មានមនុស្សពីរនាក់មានគំនិតដូចគ្នា។'
  );
});

test('Phase 1: Legitimately repeated spoken dialogue is preserved as POSSIBLE_DUPLICATE_INPUT without error', () => {
  const repeatedSegments = [
    {
      id: 1,
      startSec: 5.0,
      originalChineseText: '快走快走',
      khmerTranslatedText: 'ឆាប់ឡើង ឆាប់ឡើង',
    },
    {
      id: 2,
      startSec: 15.0,
      originalChineseText: '快走快走',
      khmerTranslatedText: 'ឆាប់ឡើង ឆាប់ឡើង',
    },
  ];

  const result = detectDuplicateTranslations(repeatedSegments);

  // Must be marked as POSSIBLE_DUPLICATE_INPUT
  assert.equal(result[1].translationWarning, 'POSSIBLE_DUPLICATE_INPUT');
  // Must NOT trigger reviewNeeded or failure
  assert.equal(result[1].reviewNeeded, undefined);
  // Text preserved identically
  assert.equal(result[0].khmerTranslatedText, 'ឆាប់ឡើង ឆាប់ឡើង');
  assert.equal(result[1].khmerTranslatedText, 'ឆាប់ឡើង ឆាប់ឡើង');
});

test('Phase 1: High similarity warning is triggered when different Chinese produce >85% similar Khmer', () => {
  const segments = [
    {
      id: 1,
      originalChineseText: '我们赶紧离开这个危险的地方吧',
      khmerTranslatedText: 'យើងឆាប់ចាកចេញពីកន្លែងគ្រោះថ្នាក់នេះទៅ',
    },
    {
      id: 2,
      originalChineseText: '大家都快走吧别停留',
      khmerTranslatedText: 'យើងឆាប់ចាកចេញពីកន្លែងគ្រោះថ្នាក់នេះទៅឆាប់',
    },
  ];

  const result = detectDuplicateTranslations(segments);
  assert.equal(result[1].translationWarning, 'HIGH_SIMILARITY_WARNING');
  assert.ok(result[1].validationWarnings.some((w) => w.includes('HIGH_SIMILARITY_WARNING')));
  // Original text remains preserved without modification
  assert.equal(result[1].khmerTranslatedText, 'យើងឆាប់ចាកចេញពីកន្លែងគ្រោះថ្នាក់នេះទៅឆាប់');
});

test('Phase 1: Canonical segment creator preserves duplicate detection metadata', () => {
  const raw = {
    segmentId: 19,
    startSec: 158.13,
    endSec: 168.18,
    originalChineseText: '有两个人同时产生了一个念头。',
    khmerTranslatedText: 'មានមនុស្សពីរនាក់បានកើតគំនិតឡើងក្នុងពេលតែមួយ។',
    translationWarning: 'POTENTIAL_DUPLICATE_TRANSLATION',
    validationWarnings: ['[POTENTIAL_DUPLICATE_TRANSLATION] duplicate of seg 18'],
    speechStartSec: 151.80,
    speechEndSec: 154.51,
    speechDuration: 2.71,
    reviewNeeded: false,
  };

  const canonical = createCanonicalSegment(raw, 18, 'dialogue');

  assert.equal(canonical.id, 19);
  assert.equal(canonical.segmentId, 19);
  assert.equal(canonical.translationWarning, 'POTENTIAL_DUPLICATE_TRANSLATION');
  assert.ok(canonical.validationWarnings.includes('[POTENTIAL_DUPLICATE_TRANSLATION] duplicate of seg 18'));
  assert.equal(canonical.speechDuration, 2.71);
  // reviewNeeded must be forced true because of POTENTIAL_DUPLICATE_TRANSLATION
  assert.equal(canonical.reviewNeeded, true);
});

test('Phase 1: geminiService retranslateBatchDialogues exports and helper equivalence', () => {
  assert.equal(typeof geminiDetectDuplicates, 'function');
  assert.equal(typeof geminiSimilarity, 'function');

  const testSegs = [
    { id: 1, originalChineseText: '你好', khmerTranslatedText: 'សួស្តី' },
    { id: 2, originalChineseText: '再见', khmerTranslatedText: 'សួស្តី' },
  ];
  const evaluated = geminiDetectDuplicates(testSegs);
  assert.equal(evaluated[1].translationWarning, 'POTENTIAL_DUPLICATE_TRANSLATION');
  assert.equal(evaluated[1].reviewNeeded, true);
});

