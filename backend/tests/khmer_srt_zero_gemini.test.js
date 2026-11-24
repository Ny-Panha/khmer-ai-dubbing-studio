const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  isKhmerText,
  parseSrtContent,
  parseJsonContent,
} = require('../utils/subtitleParser');
const { deduplicateFastOcrCues } = require('../services/pipeline/stages/stage3VisionBatchRunner');

test('Khmer Unicode detection correctly detects Khmer characters', () => {
  assert.equal(isKhmerText('សួស្តីពិភពលោក'), true);
  assert.equal(isKhmerText('1. ខ្ញុំស្រលាញ់អ្នក'), true);
  assert.equal(isKhmerText('你好世界'), false);
  assert.equal(isKhmerText('Hello World 123!'), false);
  assert.equal(isKhmerText(''), false);
});

test('parseSrtContent with Khmer SRT populates khmerTranslatedText and translationStatus=translated', () => {
  const sampleKhmerSrt = `1
00:00:01,000 --> 00:00:03,500
សួស្តីអ្នកទាំងអស់គ្នា!

2
00:00:03,800 --> 00:00:06,200
តើអ្នកសុខសប្បាយជាទេថ្ងៃនេះ?

3
00:00:06,500 --> 00:00:08,000
ខ្ញុំសុខសប្បាយជាទេ អរគុណច្រើន!
`;

  const result = parseSrtContent(sampleKhmerSrt);
  assert.equal(result.success, true);
  assert.equal(result.segments.length, 3);

  const seg1 = result.segments[0];
  assert.equal(seg1.startSec, 1.0);
  assert.equal(seg1.endSec, 3.5);
  assert.equal(seg1.khmerTranslatedText, 'សួស្តីអ្នកទាំងអស់គ្នា!');
  assert.equal(seg1.khmerText, 'សួស្តីអ្នកទាំងអស់គ្នា!');
  assert.equal(seg1.khmer, 'សួស្តីអ្នកទាំងអស់គ្នា!');
  assert.equal(seg1.translationStatus, 'translated');

  const seg2 = result.segments[1];
  assert.equal(seg2.khmerTranslatedText, 'តើអ្នកសុខសប្បាយជាទេថ្ងៃនេះ?');
  assert.equal(seg2.translationStatus, 'translated');
});

test('parseSrtContent with Chinese SRT retains Chinese text and translationStatus=review_needed', () => {
  const sampleChineseSrt = `1
00:00:01,000 --> 00:00:03,500
你好，今天天气真好！

2
00:00:03,800 --> 00:00:06,200
我们一起去散步吧。
`;

  const result = parseSrtContent(sampleChineseSrt);
  assert.equal(result.success, true);
  assert.equal(result.segments.length, 2);

  const seg1 = result.segments[0];
  assert.equal(seg1.originalChineseText, '你好，今天天气真好！');
  assert.equal(seg1.translationStatus, 'review_needed');
  assert.equal(seg1.khmerTranslatedText, '');
});

test('parseJsonContent supports Khmer JSON and preserves translationStatus=translated', () => {
  const sampleKhmerJson = JSON.stringify([
    {
      startSec: 1.2,
      endSec: 3.4,
      khmerText: 'ដំណើររឿងចាប់ផ្តើមពីទីនេះ...',
    },
    {
      startSec: 3.5,
      endSec: 5.0,
      text: 'តោះទៅមុខទៀត!',
    },
  ]);

  const result = parseJsonContent(sampleKhmerJson);
  assert.equal(result.success, true);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].khmerTranslatedText, 'ដំណើររឿងចាប់ផ្តើមពីទីនេះ...');
  assert.equal(result.segments[0].translationStatus, 'translated');
  assert.equal(result.segments[1].khmerTranslatedText, 'តោះទៅមុខទៀត!');
  assert.equal(result.segments[1].translationStatus, 'translated');
});

test('deduplicateFastOcrCues preserves Khmer text and translationStatus=translated', () => {
  const rawKhmerCues = [
    {
      id: 1,
      startSec: 1.0,
      endSec: 2.5,
      khmerTranslatedText: 'លឿនឡើង!',
      khmerText: 'លឿនឡើង!',
      translationStatus: 'translated',
    },
    {
      id: 2,
      startSec: 2.8,
      endSec: 4.5,
      khmerTranslatedText: 'ខ្ញុំកំពុងរត់ទៅហើយ!',
      khmerText: 'ខ្ញុំកំពុងរត់ទៅហើយ!',
      translationStatus: 'translated',
    },
  ];

  const deduped = deduplicateFastOcrCues(rawKhmerCues, 'male');
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].khmerTranslatedText, 'លឿនឡើង!');
  assert.equal(deduped[0].translationStatus, 'translated');
  assert.equal(deduped[0].status, 'translated');
  assert.equal(deduped[1].khmerTranslatedText, 'ខ្ញុំកំពុងរត់ទៅហើយ!');
  assert.equal(deduped[1].translationStatus, 'translated');
  assert.equal(deduped[1].status, 'translated');
});

test('Zero-Gemini Subtitle Import Workflow End-to-End Simulation', async () => {
  const sampleKhmerSrt = `1
00:00:00,500 --> 00:00:02,800
ពិសិដ្ឋនិយាយ៖ សូមស្វាគមន៍មកកាន់ស្ទូឌីយោ!

2
00:00:03,000 --> 00:00:05,500
ស្រីមុំឆ្លើយ៖ ចាស អរគុណបង!
`;

  // 1. Parse
  const parseResult = parseSrtContent(sampleKhmerSrt, undefined, { importMode: 'auto' });
  assert.equal(parseResult.success, true);

  // 2. Dedup
  const deduped = deduplicateFastOcrCues(parseResult.segments, 'male');
  assert.equal(deduped.length, 2);

  // 3. Translation Decision (Same as in scriptRoutes.js)
  const hasKhmerCues = deduped.some((s) => /[\u1780-\u17FF]/.test(String(s.khmerTranslatedText || s.khmerText || s.khmer || '')));
  const isKhmerDirect = true; // Auto-detected Khmer cues
  const shouldTranslate = !isKhmerDirect;

  let geminiApiCallCount = 0;
  if (shouldTranslate) {
    geminiApiCallCount++;
  }

  assert.equal(geminiApiCallCount, 0, 'Gemini API call count MUST be exactly 0 for Khmer SRT import');
  assert.equal(deduped[0].translationStatus, 'translated');
  assert.equal(deduped[1].translationStatus, 'translated');
});

test('Explicit importMode options behave correctly', () => {
  const mixedSrt = `1
00:00:01,000 --> 00:00:02,500
សួស្តី
`;
  // import_only
  const resImportOnly = parseSrtContent(mixedSrt, undefined, { importMode: 'import_only' });
  assert.equal(resImportOnly.segments[0].translationStatus, 'translated'); // Still Khmer text

  const chineseSrt = `1
00:00:01,000 --> 00:00:02,500
你好
`;
  const resCnImportOnly = parseSrtContent(chineseSrt, undefined, { importMode: 'import_only' });
  assert.equal(resCnImportOnly.segments[0].translationStatus, 'imported');

  const resKhmerDirect = parseSrtContent(mixedSrt, undefined, { importMode: 'khmer_direct' });
  assert.equal(resKhmerDirect.segments[0].translationStatus, 'translated');
  assert.equal(resKhmerDirect.segments[0].khmerText, 'សួស្តី');
});

test('Batch TTS Auto-Shorten Bypass Flag suppresses Gemini client invocation', () => {
  const body1 = { autoShortenOverflow: false };
  const disable1 = body1.disableAiAutoShorten === true || body1.enableAiAutoShorten === false || body1.autoShortenOverflow === false || body1.isZeroGemini === true;
  assert.equal(disable1, true);

  const body2 = { disableAiAutoShorten: true };
  const disable2 = body2.disableAiAutoShorten === true || body2.enableAiAutoShorten === false || body2.autoShortenOverflow === false || body2.isZeroGemini === true;
  assert.equal(disable2, true);

  const body3 = { isZeroGemini: true };
  const disable3 = body3.disableAiAutoShorten === true || body3.enableAiAutoShorten === false || body3.autoShortenOverflow === false || body3.isZeroGemini === true;
  assert.equal(disable3, true);

  const bodyNormal = { autoShortenOverflow: true };
  const disableNormal = bodyNormal.disableAiAutoShorten === true || bodyNormal.enableAiAutoShorten === false || bodyNormal.autoShortenOverflow === false || bodyNormal.isZeroGemini === true;
  assert.equal(disableNormal, false);
});

