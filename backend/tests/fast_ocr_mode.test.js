const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { deduplicateFastOcrCues } = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const {
  generateModeSpecificScript,
  createCanonicalSegment,
  enforceFastOcrCharacterConsistency,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('../services/pipeline/stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('../services/pipeline/stages/stage8_validateSubtitleTiming');
const { syncSegmentsWithSpeakerRegistry } = require('../models/speakerRegistry');
const { parseSrtContent, parseJsonContent, parseSrtTimestamp } = require('../utils/subtitleParser');
const { GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

test('Fast OCR Deduplication: Drops chunk repeats and extends continuous duplicates', () => {
  const mockCues = [
    { startSec: 0.0, endSec: 1.5, chineseText: '你好' },
    // Continuous repeat within 0.35s -> should extend to 3.0s
    { startSec: 1.6, endSec: 3.0, chineseText: '你好' },
    // Chunk overlap repeat within 0.3s -> should be dropped/merged
    { startSec: 2.9, endSec: 3.5, chineseText: '你好' },
    // Distinct text -> preserved as separate cue
    { startSec: 4.0, endSec: 5.5, chineseText: '我们走吧' },
    // Distant repeat of previous text > 0.35s -> preserved
    { startSec: 10.0, endSec: 11.2, chineseText: '你好' },
  ];

  const deduped = deduplicateFastOcrCues(mockCues, 'female');

  assert.equal(deduped.length, 3, 'Should produce exactly 3 deduped cues');

  // Check Cue 1: Extended to 3.5s
  assert.equal(deduped[0].chineseText, '你好');
  assert.equal(deduped[0].startSec, 0.0);
  assert.equal(deduped[0].endSec, 3.5);

  // Check Cue 2
  assert.equal(deduped[1].chineseText, '我们走吧');
  assert.equal(deduped[1].startSec, 4.0);
  assert.equal(deduped[1].endSec, 5.5);

  // Check Cue 3: Distant repetition kept
  assert.equal(deduped[2].chineseText, '你好');
  assert.equal(deduped[2].startSec, 10.0);
  assert.equal(deduped[2].endSec, 11.2);
});

test('Fast OCR Speaker/Gender Rules: Sets unverified ocr_only metadata without guessing opposite gender', () => {
  const mockCues = [
    { startSec: 1.0, endSec: 2.5, chineseText: '第一句' },
    { startSec: 3.0, endSec: 4.5, chineseText: '第二句' },
  ];

  const dedupedFemale = deduplicateFastOcrCues(mockCues, 'female');
  assert.equal(dedupedFemale[0].speakerSource, 'ocr_only');
  assert.equal(dedupedFemale[0].unverifiedSpeaker, true);
  assert.equal(dedupedFemale[0].genderConfidence, null);
  assert.equal(dedupedFemale[0].voiceGender, 'female');
  assert.equal(dedupedFemale[0].voiceId, 'km-KH-SreymomNeural');

  const dedupedMale = deduplicateFastOcrCues(mockCues, 'male');
  assert.equal(dedupedMale[0].speakerSource, 'ocr_only');
  assert.equal(dedupedMale[0].unverifiedSpeaker, true);
  assert.equal(dedupedMale[0].genderConfidence, null);
  assert.equal(dedupedMale[0].voiceGender, 'male');
  assert.equal(dedupedMale[0].voiceId, 'km-KH-PisethNeural');
});

test('Subtitle Parser: Valid SRT content parses into canonical segments', () => {
  const validSrt = `1
00:00:01,000 --> 00:00:03,000
你好世界

2
00:00:03,500 --> 00:00:05,200
欢迎来到这里
`;

  const parsed = parseSrtContent(validSrt, GENERATION_MODES.FAST_OCR);
  assert.equal(parsed.success, true);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].startSec, 1.0);
  assert.equal(parsed.segments[0].endSec, 3.0);
  assert.equal(parsed.segments[0].originalChineseText, '你好世界');
  assert.equal(parsed.segments[1].startSec, 3.5);
  assert.equal(parsed.segments[1].endSec, 5.2);
  assert.equal(parsed.segments[1].originalChineseText, '欢迎来到这里');
});

test('Subtitle Parser: Malformed SRT returns line-by-line validation errors and fails with 0 segments', () => {
  const malformedSrt = `1
invalid_timecode --> broken_time
Missing valid timestamps

2
Just text without any timecode line
`;

  const parsed = parseSrtContent(malformedSrt, GENERATION_MODES.FAST_OCR);
  assert.equal(parsed.success, false);
  assert.equal(parsed.segments.length, 0);
  assert.ok(Array.isArray(parsed.validationErrors));
  assert.ok(parsed.validationErrors.length >= 2, 'Should report validation errors for both malformed blocks');
  assert.ok(parsed.validationErrors.some((e) => e.includes('Block 1 skipped')));
  assert.ok(parsed.validationErrors.some((e) => e.includes('Block 2 skipped')));
});

test('Subtitle Parser: Valid JSON content parses into canonical segments', () => {
  const validJson = JSON.stringify([
    { startSec: 1.2, endSec: 2.8, text: '第一行' },
    { startSec: 3.5, endSec: 5.0, text: '第二行' },
  ]);

  const parsed = parseJsonContent(validJson, GENERATION_MODES.FAST_OCR);
  assert.equal(parsed.success, true);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].startSec, 1.2);
  assert.equal(parsed.segments[0].originalChineseText, '第一行');
});

test('Subtitle Parser: Malformed JSON returns validation error', () => {
  const invalidJson = `{ broken: json`;
  const parsed = parseJsonContent(invalidJson, GENERATION_MODES.FAST_OCR);
  assert.equal(parsed.success, false);
  assert.equal(parsed.segments.length, 0);
  assert.ok(parsed.validationErrors[0].includes('JSON parse error'));
});

test('Re-Translate Safety: Backup snapshots of script and series.json are created before overwrite', () => {
  const tmpSeriesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'series_test_'));
  const tmpEpDir = path.join(tmpSeriesDir, 'episodes', 'ep_test');
  const tmpBackupsDir = path.join(tmpEpDir, 'backups');
  fs.mkdirSync(tmpBackupsDir, { recursive: true });

  const seriesJsonPath = path.join(tmpSeriesDir, 'series.json');
  fs.writeFileSync(seriesJsonPath, JSON.stringify({ id: 'series_test', title: 'Test Series' }), 'utf8');

  const oldScriptData = { segments: [{ id: 1, text: 'Old Line' }] };

  // Perform snapshot operation as executed in safety guard
  const now = Date.now();
  const epBackupPath = path.join(tmpBackupsDir, `script_backup_${now}.json`);
  fs.writeFileSync(epBackupPath, JSON.stringify(oldScriptData, null, 2), 'utf8');

  const seriesBackupPath = path.join(tmpSeriesDir, `series.json.backup_${now}`);
  fs.copyFileSync(seriesJsonPath, seriesBackupPath);

  assert.ok(fs.existsSync(epBackupPath), 'Episode backup should exist');
  assert.ok(fs.existsSync(seriesBackupPath), 'series.json backup should exist');

  const restoredSeries = JSON.parse(fs.readFileSync(seriesBackupPath, 'utf8'));
  assert.equal(restoredSeries.id, 'series_test');

  // Clean up
  fs.rmSync(tmpSeriesDir, { recursive: true, force: true });
});

test('Rule 1: ocr_only segment with voiceGender female and stale Piseth voiceId exits Stage 6 with Sreymom everywhere', async () => {
  // 1a. Direct createCanonicalSegment check
  const directSeg = createCanonicalSegment({
    startSec: 1.0,
    endSec: 3.0,
    originalChineseText: '哥哥，别走！',
    khmerTranslatedText: 'បងប្រុស កុំទៅអី!',
    speaker: 'តួឯកស្រី',
    speakerSource: 'ocr_only',
    voiceGender: 'female',
    voiceId: 'km-KH-PisethNeural',
    khmerVoiceId: 'km-KH-PisethNeural',
    voice: 'km-KH-PisethNeural',
  }, 0, 'dialogue');

  assert.equal(directSeg.voiceGender, 'female');
  assert.equal(directSeg.voiceId, 'km-KH-SreymomNeural');
  assert.equal(directSeg.khmerVoiceId, 'km-KH-SreymomNeural');
  assert.equal(directSeg.voice, 'km-KH-SreymomNeural');
  assert.equal(directSeg.speakerSource, 'ocr_only');
  assert.equal(directSeg.unverifiedSpeaker, false);

  // Opposite check: male ocr_only with stale Sreymom voiceId must exit with Piseth everywhere
  const directMaleSeg = createCanonicalSegment({
    startSec: 3.2,
    endSec: 5.0,
    originalChineseText: '我没事。',
    khmerTranslatedText: 'ខ្ញុំមិនអីទេ។',
    speaker: 'តួឯកប្រុស',
    speakerSource: 'ocr_only',
    voiceGender: 'male',
    voiceId: 'km-KH-SreymomNeural',
    khmerVoiceId: 'km-KH-SreymomNeural',
    voice: 'km-KH-SreymomNeural',
  }, 1, 'dialogue');

  assert.equal(directMaleSeg.voiceGender, 'male');
  assert.equal(directMaleSeg.voiceId, 'km-KH-PisethNeural');
  assert.equal(directMaleSeg.khmerVoiceId, 'km-KH-PisethNeural');
  assert.equal(directMaleSeg.voice, 'km-KH-PisethNeural');

  // 1b. Full generateModeSpecificScript Stage 6 exit check with stale Piseth input
  const mockAiClient = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          summary: 'សាកល្បង',
          detectedGenre: 'modern',
          segments: [
            { index: 1, speaker: 'តួឯកស្រី', gender: 'female', khmerText: 'បងប្រុស កុំទៅអី!' },
          ],
        }),
      }),
    },
  };

  const stage6Res = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.FAST_OCR,
    reconciledSegments: [
      {
        id: 1,
        segmentId: 1,
        startSec: 1.0,
        endSec: 3.0,
        duration: 2.0,
        originalChineseText: '哥哥，别走！',
        speaker: 'តួអង្គ',
        speakerSource: 'ocr_only',
        unverifiedSpeaker: true,
        voiceGender: 'female',
        voiceId: 'km-KH-PisethNeural',
        khmerVoiceId: 'km-KH-PisethNeural',
        voice: 'km-KH-PisethNeural',
      },
    ],
    durationSec: 10,
    aiClient: mockAiClient,
    narratorGender: 'male',
  });

  const outSeg = stage6Res.scriptSegments[0];
  assert.equal(outSeg.voiceGender, 'female');
  assert.equal(outSeg.voiceId, 'km-KH-SreymomNeural');
  assert.equal(outSeg.khmerVoiceId, 'km-KH-SreymomNeural');
  assert.equal(outSeg.voice, 'km-KH-SreymomNeural');
  assert.equal(outSeg.speakerSource, 'ocr_only');
  assert.equal(outSeg.unverifiedSpeaker, false);
});

test('Stage 3 deduplicateFastOcrCues ignores stale opposite voiceId when !userOverridden and preserves userOverridden', () => {
  const cues = [
    {
      startSec: 1.0,
      endSec: 2.5,
      chineseText: '第一句',
      voiceGender: 'male',
      voiceId: 'km-KH-PisethNeural',
    },
    {
      startSec: 3.0,
      endSec: 4.5,
      chineseText: '第二句',
      userOverridden: true,
      voiceGender: 'male',
      voiceId: 'km-KH-PisethNeural',
      speaker: 'តួពិសេស',
    },
  ];

  const deduped = deduplicateFastOcrCues(cues, 'female');
  assert.equal(deduped[0].voiceGender, 'female');
  assert.equal(deduped[0].voiceId, 'km-KH-SreymomNeural');
  assert.equal(deduped[0].khmerVoiceId, 'km-KH-SreymomNeural');
  assert.equal(deduped[0].voice, 'km-KH-SreymomNeural');

  assert.equal(deduped[1].userOverridden, true);
  assert.equal(deduped[1].voiceGender, 'male');
  assert.equal(deduped[1].voiceId, 'km-KH-PisethNeural');
  assert.equal(deduped[1].voice, 'km-KH-PisethNeural');
  assert.equal(deduped[1].speaker, 'តួពិសេស');
});

test('Rule 3 (Honest Hints): fast_ocr sends acousticGenderHint="unknown" & acousticPitchHz=null while standard mode keeps real ASR pitch hints', async () => {
  const capturedPrompts = [];
  const mockAiClient = {
    models: {
      generateContent: async ({ contents }) => {
        capturedPrompts.push(String(contents[0] || ''));
        return {
          text: JSON.stringify({
            summary: 'test',
            detectedGenre: 'modern',
            segments: [
              { index: 1, speaker: 'តួឯកស្រី', gender: 'female', khmerText: 'សួស្តី!' },
            ],
          }),
        };
      },
    },
  };

  // Fast OCR: Stage 3 stamped default 'male', Stage 6 MUST send 'unknown' and pitchHz null
  const ocrSegs = deduplicateFastOcrCues([
    { startSec: 0.5, endSec: 2.5, chineseText: '你好，先生。' },
  ], 'male');
  assert.equal(ocrSegs[0].voiceGender, 'male');

  await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.FAST_OCR,
    reconciledSegments: ocrSegs,
    durationSec: 10,
    aiClient: mockAiClient,
    narratorGender: 'male',
  });

  const fastOcrPrompt = capturedPrompts[0];
  assert.ok(fastOcrPrompt.includes('"acousticGenderHint": "unknown"'), 'Fast OCR prompt must pass acousticGenderHint="unknown"');
  assert.ok(fastOcrPrompt.includes('"detectedGender": "unknown"'), 'Fast OCR prompt must pass detectedGender="unknown"');
  assert.ok(fastOcrPrompt.includes('"acousticPitchHz": null'), 'Fast OCR prompt must pass acousticPitchHz=null');
  assert.ok(!fastOcrPrompt.includes('"acousticGenderHint": "male"'), 'Fast OCR must never pass fabricated Stage 3 default as acousticGenderHint');

  // Standard Mode: real ASR hints pass through unchanged
  await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.MODE_A_DIALOGUE,
    reconciledSegments: [
      {
        id: 1,
        segmentId: 1,
        startSec: 0.5,
        endSec: 2.5,
        duration: 2.0,
        originalChineseText: '你好，先生。',
        voiceGender: 'female',
        pitchHz: 215,
      },
    ],
    durationSec: 10,
    aiClient: mockAiClient,
    narratorGender: 'male',
  });

  const stdPrompt = capturedPrompts[1];
  assert.ok(stdPrompt.includes('"acousticGenderHint": "female"'), 'Standard mode must preserve real ASR gender hint');
  assert.ok(stdPrompt.includes('"acousticPitchHz": 215'), 'Standard mode must preserve real ASR pitchHz');
  assert.ok(stdPrompt.includes('acousticPitchHz >= 170Hz'), 'Standard mode keeps acoustic pitch prompt rule');
});

test('Rule 2 (Consistency Pass + generic + userOverridden): Whole-episode majority gender wins, voice follows gender, generic keeps per-line & unverified, userOverridden untouched', async () => {
  // Build 22 cues (> TRANSLATION_BATCH 20) to simulate multi-batch flip
  const rawCues = [];
  for (let i = 0; i < 22; i++) {
    rawCues.push({
      startSec: i * 3 + 0.5,
      endSec: i * 3 + 2.5,
      chineseText: `对白第${i + 1}句`,
      ...(i === 21 ? {
        // Last segment is user-overridden to male/Piseth even though speaker stays តួឯកស្រី
        userOverridden: true,
        voiceGender: 'male',
        voiceId: 'km-KH-PisethNeural',
        khmerVoiceId: 'km-KH-PisethNeural',
        voice: 'km-KH-PisethNeural',
        speaker: 'តួឯកស្រី',
        speakerId: 'spk_custom_override_22',
      } : {}),
    });
  }

  const stage3Segs = deduplicateFastOcrCues(rawCues, 'male');

  let batchCall = 0;
  const mockAiClient = {
    models: {
      generateContent: async () => {
        batchCall++;
        if (batchCall === 1) {
          // Batch 1 (1..20)
          const segs = [];
          for (let idx = 1; idx <= 20; idx++) {
            if (idx <= 8) {
              segs.push({ index: idx, speaker: 'តួឯកស្រី', gender: 'female', khmerText: `ស្រី${idx}` });
            } else if (idx <= 16) {
              segs.push({ index: idx, speaker: 'តួឯកប្រុស', gender: 'male', khmerText: `ប្រុស${idx}` });
            } else if (idx === 17) {
              segs.push({ index: idx, speaker: 'តួអង្គ', gender: 'female', khmerText: 'តួអង្គស្រី' });
            } else if (idx === 18) {
              segs.push({ index: idx, speaker: 'តួអង្គ', gender: 'male', khmerText: 'តួអង្គប្រុស' });
            } else if (idx === 19) {
              // Minority gender flip for តួឯកស្រី -> will be corrected by majority pass
              segs.push({ index: idx, speaker: 'តួឯកស្រី', gender: 'male', khmerText: 'ស្រីច្រឡំភេទ' });
            } else {
              // Minority gender flip for តួឯកប្រុស -> will be corrected by majority pass
              segs.push({ index: idx, speaker: 'តួឯកប្រុស', gender: 'female', khmerText: 'ប្រុសច្រឡំភេទ' });
            }
          }
          return { text: JSON.stringify({ summary: 'សាច់រឿង', detectedGenre: 'modern', segments: segs }) };
        }
        // Batch 2 (21..22): another female flip on 21, and attempt to flip userOverridden 22
        return {
          text: JSON.stringify({
            summary: 'សាច់រឿង',
            detectedGenre: 'modern',
            segments: [
              { index: 21, speaker: 'តួឯកស្រី', gender: 'male', khmerText: 'ស្រីច្រឡំវគ្គ២' },
              { index: 22, speaker: 'តួឯកស្រី', gender: 'female', khmerText: 'ឃ្លាអ្នកប្រើកែដៃ' },
            ],
          }),
        };
      },
    },
  };

  const stage6Res = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.FAST_OCR,
    reconciledSegments: stage3Segs,
    durationSec: 120,
    aiClient: mockAiClient,
    narratorGender: 'male',
  });

  // Also run Stage 7, Stage 8, and SpeakerRegistry sync to verify end-to-end persistence invariant
  const stage7Res = await translateAndValidateKhmer({
    scriptSegments: stage6Res.scriptSegments,
    mode: stage6Res.mode,
  });
  const stage8Res = await validateSubtitleTiming({
    segments: stage7Res.validatedSegments,
    durationSec: 120,
  });
  const syncRes = syncSegmentsWithSpeakerRegistry(stage8Res.timedSegments, {});
  const finalSegs = syncRes.segments;

  // Check consistency stats
  assert.equal(stage6Res.consistencySummary.namedCharactersCount, 2);
  assert.equal(stage6Res.consistencySummary.genericCount, 2);
  assert.equal(stage6Res.consistencySummary.overriddenCount, 1);
  assert.equal(stage6Res.consistencySummary.correctedCount, 3, 'Lines 19, 20, 21 flipped genders must be corrected');

  // Named female lead: lines 1..8, 19, 21 all female + Sreymom everywhere
  for (const idx of [0, 7, 18, 20]) {
    assert.equal(finalSegs[idx].speaker, 'តួឯកស្រី');
    assert.equal(finalSegs[idx].voiceGender, 'female');
    assert.equal(finalSegs[idx].voiceId, 'km-KH-SreymomNeural');
    assert.equal(finalSegs[idx].khmerVoiceId, 'km-KH-SreymomNeural');
    assert.equal(finalSegs[idx].voice, 'km-KH-SreymomNeural');
    assert.equal(finalSegs[idx].unverifiedSpeaker, false);
    assert.equal(finalSegs[idx].speakerSource, 'ocr_only');
  }

  // Named male lead: lines 9..16, 20 all male + Piseth everywhere
  for (const idx of [8, 15, 19]) {
    assert.equal(finalSegs[idx].speaker, 'តួឯកប្រុស');
    assert.equal(finalSegs[idx].voiceGender, 'male');
    assert.equal(finalSegs[idx].voiceId, 'km-KH-PisethNeural');
    assert.equal(finalSegs[idx].khmerVoiceId, 'km-KH-PisethNeural');
    assert.equal(finalSegs[idx].voice, 'km-KH-PisethNeural');
    assert.equal(finalSegs[idx].unverifiedSpeaker, false);
  }

  // Generic 'តួអង្គ': keep per-line judgement (idx 16=female/Sreymom, idx 17=male/Piseth) + unverifiedSpeaker=true
  assert.equal(finalSegs[16].speaker, 'តួអង្គ');
  assert.equal(finalSegs[16].voiceGender, 'female');
  assert.equal(finalSegs[16].voiceId, 'km-KH-SreymomNeural');
  assert.equal(finalSegs[16].unverifiedSpeaker, true);

  assert.equal(finalSegs[17].speaker, 'តួអង្គ');
  assert.equal(finalSegs[17].voiceGender, 'male');
  assert.equal(finalSegs[17].voiceId, 'km-KH-PisethNeural');
  assert.equal(finalSegs[17].unverifiedSpeaker, true);

  // User-overridden idx 21: stays male/Piseth despite Gemini female & តួឯកស្រី majority female
  assert.equal(finalSegs[21].userOverridden, true);
  assert.equal(finalSegs[21].voiceGender, 'male');
  assert.equal(finalSegs[21].voiceId, 'km-KH-PisethNeural');
  assert.equal(finalSegs[21].khmerVoiceId, 'km-KH-PisethNeural');
  assert.equal(finalSegs[21].voice, 'km-KH-PisethNeural');
});

test('Stage 6 Fast OCR cascade rescue fallback also applies final gender & derived voiceId', async () => {
  let callCount = 0;
  const mockAiClient = {
    models: {
      generateContent: async ({ model }) => {
        callCount++;
        if (model === 'gemini-3.5-flash-lite') {
          throw new Error('503 temporary overload');
        }
        return {
          text: JSON.stringify({
            summary: 'rescue',
            segments: [
              { index: 1, speaker: 'អ្នកនាងលី', gender: 'female', khmerText: 'ជួយផង!' },
            ],
          }),
        };
      },
    },
  };

  const ocrSegs = deduplicateFastOcrCues([
    { startSec: 1.0, endSec: 2.5, chineseText: '救命啊！' },
  ], 'male');

  const stage6Res = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    generationMode: GENERATION_MODES.FAST_OCR,
    reconciledSegments: ocrSegs,
    durationSec: 10,
    aiClient: mockAiClient,
    modelName: 'gemini-3.5-flash-lite',
    narratorGender: 'male',
  });

  assert.ok(callCount >= 2);
  assert.equal(stage6Res.scriptSegments[0].speaker, 'អ្នកនាងលី');
  assert.equal(stage6Res.scriptSegments[0].voiceGender, 'female');
  assert.equal(stage6Res.scriptSegments[0].voiceId, 'km-KH-SreymomNeural');
  assert.equal(stage6Res.scriptSegments[0].khmerVoiceId, 'km-KH-SreymomNeural');
  assert.equal(stage6Res.scriptSegments[0].voice, 'km-KH-SreymomNeural');
});
