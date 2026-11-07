const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanonicalSegment } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { validateSubtitleTiming } = require('../services/pipeline/stages/stage8_validateSubtitleTiming');
const { debugAndRepairSegments } = require('../scripts/debugAndFixEpisode');

test('Stage 6: Female & Male characters never share the same speakerId (spk_1 collision fix)', () => {
  const maleSeg = createCanonicalSegment({
    originalChineseText: '我是天蓬元帅。',
    khmerTranslatedText: 'ខ្ញុំគឺមេទ័ពធានផឹង។',
    speaker: 'ប៉ាជៀ',
    voiceGender: 'male',
    startSec: 10.0,
    endSec: 12.0,
  }, 0, 'dialogue');

  const femaleSeg = createCanonicalSegment({
    originalChineseText: '那一世，我没有拜师，没有喊过你二师兄。',
    khmerTranslatedText: 'ក្នុងជាតិនោះ ខ្ញុំមិនបានបួសជាសិស្ស ក៏មិនដែលហៅបងថាសិស្សច្បងទីពីរដែរ។',
    speaker: 'នាងនៀនអាន',
    voiceGender: 'female',
    pitchHz: 215,
    startSec: 12.2,
    endSec: 15.0,
  }, 1, 'dialogue');

  assert.notEqual(maleSeg.speakerId, femaleSeg.speakerId);
  assert.equal(maleSeg.voiceId, 'km-KH-PisethNeural');
  assert.equal(femaleSeg.voiceId, 'km-KH-SreymomNeural');
  assert.match(femaleSeg.speakerId, /^spk_female_/);
  assert.match(maleSeg.speakerId, /^spk_male_/);
});

test('Stage 8 & Debug Script: Drifted segments (#88-#98 at 07:10) are pulled back inside 06:15.37 video duration', async () => {
  const videoDurationSec = 375.37; // 06:15.37
  const rawSegments = [];

  // Simulate 98 segments where #88-#98 drifted up to 430s (07:10) due to old Auto-Align
  for (let i = 0; i < 98; i++) {
    const canonicalStart = parseFloat((i * 3.8).toFixed(2)); // 0s .. 368.6s
    const canonicalEnd = parseFloat((canonicalStart + 2.2).toFixed(2));
    const driftedStart = i >= 87 ? canonicalStart + 58.0 : canonicalStart; // Drifted to ~426s (07:06)

    rawSegments.push({
      id: i + 1,
      segmentId: i + 1,
      sourceStartSec: canonicalStart,
      sourceEndSec: canonicalEnd,
      startSec: driftedStart,
      endSec: driftedStart + 3.2,
      duration: 3.2,
      userShifted: true,
      originalChineseText: i === 90 ? '那叫你爸戒' : '测试对白',
      khmerTranslatedText: i === 90 ? 'ហៅខ្ញុំថាប៉ាឆា' : 'ការសន្ទនាសាកល្បង',
      speaker: i === 90 ? 'តួអង្គ' : 'ប៉ាជៀ',
      voiceGender: 'male',
      pitchHz: i === 90 ? 210 : 120,
    });
  }

  // 1. Verify Stage 8 timing validation pulls drifted segments back to canonicalStart & inside videoDurationSec
  const { timedSegments } = await validateSubtitleTiming({
    segments: rawSegments,
    durationSec: videoDurationSec,
  });

  const lastSeg = timedSegments[timedSegments.length - 1];
  assert.ok(
    lastSeg.endSec <= videoDurationSec,
    `Expected last segment endSec (${lastSeg.endSec}) <= videoDurationSec (${videoDurationSec})`
  );
  assert.ok(
    Math.abs(lastSeg.startSec - lastSeg.sourceStartSec) <= 0.35,
    `Expected zero cumulative drift from sourceStartSec, got drift=${Math.abs(lastSeg.startSec - lastSeg.sourceStartSec)}`
  );

  // 2. Verify debugAndRepairSegments fixes Gender, Timing Drift, and Dynamic Pun Correction ("ប៉ាឆា" -> "ប៉ាជៀ")
  const repaired = debugAndRepairSegments(rawSegments, videoDurationSec, true, {
    punCorrections: [
      {
        matchChinese: /爸戒/,
        matchKhmer: /ប៉ាឆា/,
        replaceKhmer: 'អ៊ីចឹងហៅបងថាប៉ាជៀតែម្ដងទៅ!',
      },
    ],
  });
  const seg91 = repaired[90];
  assert.equal(seg91.voiceGender, 'female');
  assert.equal(seg91.voiceId, 'km-KH-SreymomNeural');
  assert.ok(!seg91.khmerTranslatedText.includes('ប៉ាឆា'));
  assert.ok(seg91.khmerTranslatedText.includes('ប៉ាជៀ'));
});

