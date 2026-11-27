const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { pathToFileURL } = require('url');

const { reconcileTimelineEvidence } = require('../services/pipeline/stages/stage5_reconcileTimelineEvidence');
const {
  enforceEpisodeCharacterConsistency,
  applyTranslatedSegmentResult,
  hasManualTextOverride,
  hasManualSpeakerOrVoiceOverride,
} = require('../services/pipeline/stages/stage6PromptAndConsistency');
const { translateAndValidateKhmer } = require('../services/pipeline/stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('../services/pipeline/stages/stage8_validateSubtitleTiming');
const { validateStrictSourceCueMapping, computePipelineCompletenessReport } = require('../services/pipeline/pipelineTypes');
const {
  isExpressiveVocalizationSource,
  isPureDescriptiveSoundLabel,
} = require('../utils/translationQuality');
const {
  isEdgeTtsCliAvailable,
  getAvailableTtsProviders,
  isRateLimit429Error,
  generateBatchSegmentsAudio,
} = require('../services/ttsService');
const { buildExportReadinessReport, previewAndExport } = require('../services/pipeline/stages/stage10_previewAndExport');

test('Phase 4: Stage 5 reconciliation preserves visual sourceCueId and assigns deterministic ASR sourceCueId', async () => {
  const { reconciledSegments } = await reconcileTimelineEvidence({
    visualSegments: [
      { sourceCueId: 'cue_v_1', startSec: 1.0, endSec: 2.5, duration: 1.5, originalChineseText: '你好吗', position: 'bottom_subtitle' },
      { sourceCueId: 'cue_v_2', startSec: 5.0, endSec: 6.5, duration: 1.5, originalChineseText: '没人接', position: 'bottom_subtitle' },
    ],
    audioSegments: [
      { startSec: 1.0, endSec: 2.4, duration: 1.4, spokenChineseText: '你好吗', speakerId: 'spk_lead', audioGender: 'male', audioConfidence: 0.9 },
      { startSec: 10.0, endSec: 11.5, duration: 1.5, spokenChineseText: '快跑吧', speakerId: 'spk_2', audioGender: 'female', audioConfidence: 0.92 },
    ],
    durationSec: 15,
  });

  assert.equal(reconciledSegments.length, 3);
  assert.equal(reconciledSegments[0].sourceCueId, 'cue_v_1');
  assert.equal(reconciledSegments[1].sourceCueId, 'cue_v_2');
  assert.ok(String(reconciledSegments[2].sourceCueId || '').startsWith('cue_asr_'));
});

test('Phase 5: Stage 6 separates autoVerifiedSpeaker vs manualOverride vs reviewNeededSpeaker and allows missing translation on voice-overridden cues', () => {
  const segments = [
    {
      id: 1,
      sourceCueId: 'cue_1',
      originalChineseText: '你好',
      khmerTranslatedText: 'សួស្តី',
      speaker: 'ស៊ូ មីង',
      voiceGender: 'male',
      speakerStatus: 'verified',
      voiceAssignmentSource: 'multimodal_verified',
    },
    {
      id: 2,
      sourceCueId: 'cue_2',
      originalChineseText: '快走',
      khmerTranslatedText: '',
      speaker: 'លីន ហ្វាង',
      voiceGender: 'female',
      voiceOverride: 'km-KH-SreymomNeural',
      voiceAssignmentSource: 'manual',
    },
    {
      id: 3,
      sourceCueId: 'cue_3',
      originalChineseText: '啊',
      khmerTranslatedText: 'អា៎!',
      speaker: 'តួអង្គ',
      voiceGender: 'unknown',
      speakerStatus: 'review_needed',
      speakerReviewNeeded: true,
    },
  ];

  assert.equal(hasManualSpeakerOrVoiceOverride(segments[0]), false);
  assert.equal(hasManualTextOverride(segments[0]), false);
  assert.equal(hasManualSpeakerOrVoiceOverride(segments[1]), true);
  assert.equal(hasManualTextOverride(segments[1]), false);

  // Voice-overridden segment with empty Khmer must still accept translation while keeping manual voice
  const applied = applyTranslatedSegmentResult(
    segments[1],
    { khmerText: 'ប្រញាប់ទៅ!', speaker: 'តួប្រុស', gender: 'male' },
    8,
    1,
    { isFastOcrMode: true }
  );
  assert.equal(applied, true);
  assert.equal(segments[1].khmerTranslatedText, 'ប្រញាប់ទៅ!');
  assert.equal(segments[1].voiceOverride, 'km-KH-SreymomNeural');
  assert.equal(segments[1].voiceGender, 'female');

  const consistency = enforceEpisodeCharacterConsistency(segments, { isFastOcrMode: true });
  assert.equal(consistency.stats.autoVerifiedSpeakerCount, 1);
  assert.equal(consistency.stats.manualOverrideCount, 1);
  assert.equal(consistency.stats.overriddenCount, 1);
  assert.equal(consistency.stats.reviewNeededSpeakerCount, 1);
});

test('Phase 5: Expressive vocalizations include 呢呢呢, 呀啊, 哈哈哈, 啊, 啊啊啊, 啊呃啊, 咳咳咳, hehehe', () => {
  for (const sample of ['哈哈哈', '呢呢呢', '啊', '呀啊', '啊啊啊', '啊呃啊', '咳咳咳', 'hehehe']) {
    assert.equal(isExpressiveVocalizationSource(sample), true, `Expected ${sample} to be recognized as expressive vocalization`);
  }
  assert.equal(isPureDescriptiveSoundLabel('សើច'), true);
  assert.equal(isPureDescriptiveSoundLabel('ហាហាហា!'), false);
});

test('Phase 6: Stage 7 & 8 and strict mapping reject descriptive sound labels, Chinese/Thai/Lao leaks, duplicates, and invalid timing', async () => {
  const sourceCues = [
    { sourceCueId: 'cue_1', startSec: 1.0, endSec: 2.2, originalChineseText: '哈哈哈' },
    { sourceCueId: 'cue_2', startSec: 3.0, endSec: 4.5, originalChineseText: '你是谁' },
    { sourceCueId: 'cue_3', startSec: 5.0, endSec: 4.0, originalChineseText: '快走' },
  ];

  const { validatedSegments, validationReport } = await translateAndValidateKhmer({
    sourceCues,
    scriptSegments: [
      { sourceCueId: 'cue_1', startSec: 1.0, endSec: 2.2, originalChineseText: '哈哈哈', khmerTranslatedText: 'សើច' },
      { sourceCueId: 'cue_2', startSec: 3.0, endSec: 4.5, originalChineseText: '你是谁', khmerTranslatedText: 'ឯងជាអ្នកណា 谁' },
      { sourceCueId: 'cue_3', startSec: 5.0, endSec: 4.0, originalChineseText: '快走', khmerTranslatedText: 'ប្រញាប់ទៅ' },
    ],
  });

  assert.equal(validationReport.oneToOneMappingValid, false);
  assert.equal(validatedSegments[0].translationStatus, 'review_needed');
  assert.equal(validatedSegments[1].translationStatus, 'review_needed');
  assert.equal(validatedSegments[2].uncertainTiming, true);
  assert.equal(validationReport.invalidTimingCueIds.length, 1);

  const strict = validateStrictSourceCueMapping(sourceCues, validatedSegments);
  assert.equal(strict.valid, false);
  assert.ok(strict.invalidTranslationCueIds.includes('cue_1'));
  assert.ok(strict.invalidTranslationCueIds.includes('cue_2'));
  assert.ok(strict.invalidTimingCueIds.includes('cue_3'));

  const completeness = computePipelineCompletenessReport({
    durationSec: 10,
    verifiedSourceCuesCount: 3,
    ocrTotalFrames: 10,
    ocrVerifiedFrames: 10,
    ocrUnresolvedFrames: 0,
    finalizedSegments: validatedSegments,
    sourceCues,
  });
  assert.equal(completeness.status, 'incomplete');
  assert.equal(completeness.oneToOneMappingValid, false);

  const timing = await validateSubtitleTiming({ segments: validatedSegments, sourceCues, durationSec: 10 });
  assert.equal(timing.timingReport.timingValid, true);
  assert.equal(timing.timingReport.invalidTimingCount, 0);
});

test('Phase 7: Frontend voiceCatalog resolveSegmentGender never counts unknown gender as male', async () => {
  const voiceCatalogUrl = pathToFileURL(path.resolve(__dirname, '../../frontend/src/utils/voiceCatalog.js')).href;
  const { resolveSegmentGender } = await import(voiceCatalogUrl);

  assert.equal(resolveSegmentGender({ voiceGender: 'unknown', voiceId: 'km-KH-PisethNeural', isFallback: true }), 'UNKNOWN');
  assert.equal(resolveSegmentGender({ gender: 'unknown', speakerGender: 'UNKNOWN', voiceId: 'km-KH-PisethNeural' }), 'UNKNOWN');
  assert.equal(resolveSegmentGender({ voiceGender: 'male', voiceId: 'km-KH-PisethNeural' }), 'MALE');
  assert.equal(resolveSegmentGender({ voiceGender: 'female', voiceId: 'km-KH-SreymomNeural' }), 'FEMALE');
  assert.equal(resolveSegmentGender({ voiceGender: 'unknown', voiceOverride: 'km-KH-SreymomNeural', voiceAssignmentSource: 'manual' }), 'FEMALE');
});

test('Phase 8: TTS provider pre-check, 429 detection, and incomplete failure status never mark failed batch completed', async () => {
  const providers = getAvailableTtsProviders();
  assert.equal(typeof providers.edgeTtsCli, 'boolean');
  assert.equal(providers.edgeTtsCli, isEdgeTtsCliAvailable());
  assert.equal(isRateLimit429Error(new Error('Edge TTS returned 429 Too Many Requests')), true);
  assert.equal(isRateLimit429Error(new Error('Normal error')), false);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-tts-audit-'));
  try {
    const res = await generateBatchSegmentsAudio(
      [
        { id: 1, khmer: 'សួស្តី', startSec: 0, endSec: 1.5 },
        { id: 2, khmer: 'ប្រញាប់ឡើង', startSec: 2, endSec: 3.5 },
      ],
      tmpDir,
      {
        concurrency: 2,
        generateSingleFn: async (seg) => {
          if (seg.id === 2) {
            const err = new Error('HTTP 429 Too Many Requests');
            err.status = 429;
            throw err;
          }
          return {
            ...seg,
            audioUrl: `/uploads/seg_1.mp3`,
            audioPath: path.join(tmpDir, 'seg_1.mp3'),
            audioGenerated: true,
            ttsStatus: 'ready',
            _wasNewlySynthesized: true,
          };
        },
      }
    );

    assert.equal(res.telemetry.status, 'incomplete');
    assert.equal(res.telemetry.isComplete, false);
    assert.equal(res.telemetry.succeededCount, 1);
    assert.equal(res.telemetry.failedCount, 1);
    assert.equal(res[1].ttsStatus, 'error');
    assert.equal(res[1].audioGenerated, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 9: Stage 10 previewAndExport and HTTP /api/render-video emit explicit review warnings and block 100% untranslated export', async () => {
  const readiness = buildExportReadinessReport(
    [
      { id: 1, originalChineseText: '你好', khmerTranslatedText: '' },
      { id: 2, originalChineseText: '再见', khmerTranslatedText: 'លាហើយ', ttsStatus: 'error' },
    ],
    { checkAudioOnDisk: true, hasMasterAudio: false }
  );
  assert.equal(readiness.reviewNeeded, true);
  assert.equal(readiness.untranslatedCount, 1);
  assert.equal(readiness.missingOrFailedAudioCount, 1);
  assert.ok(readiness.reviewWarnings.length >= 2);

  const tmpEp = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-export-audit-'));
  try {
    const prep = await previewAndExport({
      videoPath: null,
      segments: [
        { id: 1, startSec: 0, endSec: 1.5, originalChineseText: '你好', khmerTranslatedText: '' },
      ],
      episodeDir: tmpEp,
      exportOptions: { renderVideo: false },
    });
    assert.equal(prep.reviewNeeded, true);
    assert.ok(prep.reviewWarnings.length >= 1);
  } finally {
    fs.rmSync(tmpEp, { recursive: true, force: true });
  }

  // HTTP integration test against real videoRoutes /api/render-video with 100% untranslated segments
  const videoRoutes = require('../routes/videoRoutes');
  const app = express();
  app.use(express.json());
  app.use('/api', videoRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  // Create tiny dummy video inside uploads dir so resolveMediaFile accepts it, then clean it up
  const dummyRel = `_tmp_p0_export_guard_${Date.now()}.mp4`;
  const dummyPath = path.resolve(__dirname, '../uploads', dummyRel);
  fs.writeFileSync(dummyPath, Buffer.alloc(64, 0));

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/render-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: dummyRel,
        projectName: 'p0_guard_test',
        segments: [
          { id: 1, startSec: 0, endSec: 2, originalChineseText: '你好', khmerTranslatedText: '' },
        ],
      }),
    });
    const body = await resp.json();
    assert.equal(resp.status, 400);
    assert.equal(body.code, 'EXPORT_REVIEW_NEEDED');
    assert.equal(body.reviewNeeded, true);
    assert.ok(Array.isArray(body.reviewWarnings) && body.reviewWarnings.length > 0);
  } finally {
    server.close();
    try { fs.unlinkSync(dummyPath); } catch (_) {}
    const projDir = path.resolve(__dirname, '../uploads/projects/p0_guard_test');
    try { fs.rmSync(projDir, { recursive: true, force: true }); } catch (_) {}
  }
});
