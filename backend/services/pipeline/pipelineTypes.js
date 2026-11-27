/**
 * Canonical Types, Constants, and Schema Definitions for Khmer AI Dubbing Pipeline
 */

const PIPELINE_STAGES = Object.freeze([
  'ingestEpisode',
  'analyzeSourceMedia',
  'extractChineseSubtitles',
  'analyzeDialogueAudio',
  'reconcileTimelineEvidence',
  'generateModeSpecificScript',
  'translateAndValidateKhmer',
  'validateSubtitleTiming',
  'generateSegmentTTS',
  'previewAndExport',
]);

const PIPELINE_STATUS = Object.freeze({
  QUEUED: 'queued',
  ANALYZING: 'analyzing',
  EXTRACTING_SUBTITLES: 'extracting_subtitles',
  TRANSCRIBING_AUDIO: 'transcribing_audio',
  RECONCILING: 'reconciling',
  TRANSLATING: 'translating',
  VALIDATING: 'validating',
  GENERATING_TTS: 'generating_tts',
  READY_FOR_REVIEW: 'ready_for_review',
  EXPORTING: 'exporting',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const GENERATION_MODES = Object.freeze({
  MODE_A_DIALOGUE: 'dialogue',
  MODE_B_RECAP: 'recap',
  MODE_C_SUBTITLES: 'subtitles',
  FAST_OCR: 'fast_ocr',
});

const OCR_ENGINE_MODES = Object.freeze({
  HYBRID: 'hybrid',
  GEMINI_ONLY: 'gemini_only',
});

function resolveOcrEngineMode({ ocrMode, ocrEngineMode, enableLocalOcr, env = process.env } = {}) {
  const raw = String(ocrMode || ocrEngineMode || env?.OCR_ENGINE_MODE || '').trim().toLowerCase();
  if (
    raw === 'gemini_only' ||
    raw === 'gemini' ||
    enableLocalOcr === false ||
    env?.SKIP_LOCAL_OCR === 'true' ||
    env?.ENABLE_LOCAL_CHINESE_OCR === 'false'
  ) {
    return OCR_ENGINE_MODES.GEMINI_ONLY;
  }
  return OCR_ENGINE_MODES.HYBRID;
}

/**
 * Format float seconds into MM:SS.ms format (e.g. 00:03.50)
 */
function formatSecondsToTimecode(sec) {
  const safeSec = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(safeSec / 60);
  const secs = (safeSec % 60).toFixed(2);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(5, '0')}`;
}

/**
 * Parse time string ("00:01.50" or "01:05") or number to float seconds
 */
function parseTimeToSeconds(val, fallback = 0) {
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  if (!val) return fallback;
  const str = String(val).trim();
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  const num = parseFloat(str);
  return isNaN(num) ? fallback : num;
}

/**
 * Canonical Segment Factory
 * Guarantees every segment has consistent properties across all 10 stages
 */
function createCanonicalSegment(raw = {}, index = 0, defaultMode = GENERATION_MODES.MODE_A_DIALOGUE) {
  const mode = raw.mode || defaultMode;
  const id = raw.segmentId !== undefined && raw.segmentId !== null
    ? raw.segmentId
    : (raw.id !== undefined && raw.id !== null ? raw.id : index + 1);

  const startSec = parseTimeToSeconds(raw.startSec ?? raw.startTime ?? raw.start, index * 3.5);
  let endSec = parseTimeToSeconds(raw.endSec ?? raw.endTime ?? raw.end, startSec + 2.5);

  const originalChineseText = String(
    raw.originalChineseText ?? raw.originalText ?? raw.original ?? raw.chineseText ?? ''
  ).trim();

  const khmerTranslatedText = String(
    raw.khmerTranslatedText ?? raw.khmerText ?? raw.khmer ?? ''
  ).trim();

  const rawSpeaker = String(raw.speakerName ?? raw.speaker ?? '').trim() || (
    mode === GENERATION_MODES.MODE_A_DIALOGUE ? 'តួអង្គ' : (
      mode === GENERATION_MODES.MODE_C_SUBTITLES ? 'ចំណងជើង/Subtitle' : 'អ្នកសម្រាយរឿង'
    )
  );

  const speakerId = raw.speakerId || (
    mode === GENERATION_MODES.MODE_B_RECAP ? 'spk_narrator' : `spk_${index + 1}`
  );

  const rawGender = String(raw.voiceGender ?? raw.gender ?? raw.speakerGender ?? 'unknown').toLowerCase();
  const voiceGender = rawGender === 'female' ? 'female' : (rawGender === 'male' ? 'male' : 'unknown');

  const defaultVoice = voiceGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';
  const khmerVoiceId = raw.khmerVoiceId || raw.voiceId || defaultVoice;

  const duration = parseFloat(Math.max(0, endSec - startSec).toFixed(2));
  const isMicroDuration = duration < 0.6;

  return {
    id,
    segmentId: id,
    mode,
    startSec: parseFloat(startSec.toFixed(2)),
    endSec: parseFloat(endSec.toFixed(2)),
    sourceStartSec: typeof raw.sourceStartSec === 'number' ? parseFloat(raw.sourceStartSec.toFixed(2)) : parseFloat(startSec.toFixed(2)),
    sourceEndSec: typeof raw.sourceEndSec === 'number' ? parseFloat(raw.sourceEndSec.toFixed(2)) : parseFloat(endSec.toFixed(2)),
    start: formatSecondsToTimecode(startSec),
    end: formatSecondsToTimecode(endSec),
    startTime: formatSecondsToTimecode(startSec),
    endTime: formatSecondsToTimecode(endSec),
    duration,
    originalChineseText,
    originalText: originalChineseText,
    original: originalChineseText,
    chineseText: originalChineseText,
    khmerTranslatedText,
    khmerText: khmerTranslatedText,
    khmer: khmerTranslatedText,
    speaker: rawSpeaker,
    speakerName: rawSpeaker,
    speakerId,
    voiceGender,
    gender: voiceGender,
    speakerGender: voiceGender.toUpperCase(),
    genderConfidence: typeof raw.genderConfidence === 'number' ? raw.genderConfidence : (voiceGender === 'unknown' ? 0.5 : 0.85),
    khmerVoiceId,
    voiceId: khmerVoiceId,
    voice: khmerVoiceId,
    voiceAssignmentSource: raw.voiceAssignmentSource || 'automatic',
    voiceProvider: raw.voiceProvider || 'edge-tts',
    audioFile: raw.audioFile || null,
    audioUrl: raw.audioUrl || null,
    audioPath: raw.audioPath || null,
    audioDurationSec: Number(raw.audioDurationSec || 0),
    audioStartSec: raw.audioStartSec !== undefined ? Number(raw.audioStartSec) : parseFloat(startSec.toFixed(2)),
    audioEndSec: raw.audioEndSec !== undefined ? Number(raw.audioEndSec) : parseFloat(endSec.toFixed(2)),
    audioOutdated: Boolean(raw.audioOutdated),
    translationStatus: raw.translationStatus || (khmerTranslatedText ? 'translated' : (originalChineseText ? 'review_needed' : 'pending')),
    ttsStatus: raw.ttsStatus || (raw.audioFile ? 'ready' : 'pending'),
    reviewNeeded: Boolean(isMicroDuration || raw.reviewNeeded || raw.uncertainOcr || raw.uncertainTiming),
    uncertainOcr: Boolean(raw.uncertainOcr || raw.isUncertain),
    uncertainTiming: Boolean(isMicroDuration || raw.uncertainTiming),
    timingType: raw.timingType || (isMicroDuration ? 'uncertain_micro_adjusted' : 'verified_evidence'),
    ocrTimestamp: raw.ocrTimestamp || null,
    isRecovered: Boolean(raw.isRecovered),
    recoveryGap: raw.recoveryGap || null,
    validationErrors: Array.isArray(raw.validationErrors) ? [...raw.validationErrors] : [],
  };
}

function validateStrictSourceCueMapping(sourceCues = [], outputSegments = []) {
  const srcList = Array.isArray(sourceCues) ? sourceCues : [];
  const outList = Array.isArray(outputSegments) ? outputSegments : [];

  const srcIds = srcList.map((c, idx) => String(c?.sourceCueId || '').trim() || `__missing_src_${idx + 1}`);
  const srcIdSet = new Set(srcList.map((c) => String(c?.sourceCueId || '').trim()).filter(Boolean));
  const outIds = outList.map((s) => String(s?.sourceCueId || '').trim());

  const seenOut = new Map();
  const duplicateSourceCueIds = [];
  const unexpectedSourceCueIds = [];
  const invalidTranslationCueIds = [];
  const missingChineseCueIds = [];

  for (let i = 0; i < outList.length; i++) {
    const seg = outList[i] || {};
    const cid = outIds[i];
    if (!cid) {
      unexpectedSourceCueIds.push(`__missing_out_id_${i + 1}`);
    } else {
      const prevCount = seenOut.get(cid) || 0;
      seenOut.set(cid, prevCount + 1);
      if (prevCount === 1) duplicateSourceCueIds.push(cid);
      if (srcIdSet.size > 0 && !srcIdSet.has(cid)) {
        unexpectedSourceCueIds.push(cid);
      }
    }

    const cn = String(seg.originalChineseText || seg.chineseText || seg.textZh || '').trim();
    const kh = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || '').trim();
    const refId = cid || `seg_${i + 1}`;
    if (!cn && srcList[i] && String(srcList[i].originalChineseText || srcList[i].chineseText || srcList[i].textZh || '').trim()) {
      missingChineseCueIds.push(refId);
    }
    if (cn && (!kh || seg.translationStatus === 'review_needed')) {
      invalidTranslationCueIds.push(refId);
    }
  }

  const outIdSet = new Set(outIds.filter(Boolean));
  const missingSourceCueIds = [];
  for (let i = 0; i < srcList.length; i++) {
    const scId = String(srcList[i]?.sourceCueId || '').trim();
    if (!scId) {
      missingSourceCueIds.push(srcIds[i]);
    } else if (!outIdSet.has(scId)) {
      missingSourceCueIds.push(scId);
    }
  }

  const mismatchedOrderCueIds = [];
  const minLen = Math.min(srcList.length, outList.length);
  for (let i = 0; i < minLen; i++) {
    const scId = String(srcList[i]?.sourceCueId || '').trim();
    const ocId = outIds[i];
    if (scId && ocId && scId !== ocId) {
      mismatchedOrderCueIds.push(`${scId}!=${ocId}`);
    }
  }

  const exactCueIdSetMatch =
    srcList.length > 0 &&
    outList.length === srcList.length &&
    missingSourceCueIds.length === 0 &&
    duplicateSourceCueIds.length === 0 &&
    unexpectedSourceCueIds.length === 0 &&
    srcIdSet.size === srcList.length;

  const valid =
    exactCueIdSetMatch &&
    mismatchedOrderCueIds.length === 0 &&
    invalidTranslationCueIds.length === 0 &&
    missingChineseCueIds.length === 0;

  return {
    valid,
    exactCueIdSetMatch,
    sourceCount: srcList.length,
    outputCount: outList.length,
    missingSourceCueIds,
    duplicateSourceCueIds,
    unexpectedSourceCueIds,
    mismatchedOrderCueIds,
    invalidTranslationCueIds,
    missingChineseCueIds,
  };
}

function computePipelineCompletenessReport({
  durationSec = 0,
  verifiedSourceCuesCount = 0,
  ocrTotalFrames = 0,
  ocrVerifiedFrames = 0,
  ocrUnresolvedFrames = 0,
  finalizedSegments = [],
  sourceCues = null,
  ocrEngineMode = null,
  usage = null,
} = {}) {
  const segs = Array.isArray(finalizedSegments) ? finalizedSegments : [];
  const hasSourceCues = Array.isArray(sourceCues) && sourceCues.length > 0;
  const strictMapping = hasSourceCues ? validateStrictSourceCueMapping(sourceCues, segs) : null;

  const extractedChineseCuesCount = segs.filter((s) => Boolean(String(s?.originalChineseText || s?.chineseText || '').trim())).length;
  const translatedKhmerCuesCount = segs.filter((s) => Boolean(String(s?.khmerTranslatedText || s?.khmerText || '').trim()) && s?.translationStatus !== 'review_needed').length;
  const effectiveSourceCount = hasSourceCues
    ? sourceCues.length
    : (verifiedSourceCuesCount > 0 ? verifiedSourceCuesCount : segs.length);
  const missingSubtitlesCount = hasSourceCues
    ? Math.max(0, strictMapping.missingSourceCueIds.length, strictMapping.missingChineseCueIds.length, effectiveSourceCount - extractedChineseCuesCount)
    : Math.max(0, effectiveSourceCount - extractedChineseCuesCount);
  const missingTranslationsCount = hasSourceCues
    ? Math.max(0, strictMapping.invalidTranslationCueIds.length, strictMapping.missingSourceCueIds.length, effectiveSourceCount - translatedKhmerCuesCount)
    : Math.max(0, effectiveSourceCount - translatedKhmerCuesCount);
  const translationCompletenessPct = effectiveSourceCount > 0
    ? parseFloat(((Math.min(translatedKhmerCuesCount, effectiveSourceCount) / effectiveSourceCount) * 100).toFixed(2))
    : 0;
  const ocrFrameCompletenessPct = ocrTotalFrames > 0
    ? parseFloat(((ocrVerifiedFrames / ocrTotalFrames) * 100).toFixed(2))
    : (ocrUnresolvedFrames === 0 ? 100 : 0);
  const oneToOneMappingValid = hasSourceCues
    ? Boolean(strictMapping.valid && ocrUnresolvedFrames === 0 && missingSubtitlesCount === 0 && missingTranslationsCount === 0)
    : Boolean(effectiveSourceCount > 0 && missingSubtitlesCount === 0 && missingTranslationsCount === 0 && ocrUnresolvedFrames === 0);

  return {
    status: oneToOneMappingValid ? 'complete' : 'incomplete',
    totalDurationSec: durationSec,
    totalSegments: segs.length,
    verifiedSourceCuesCount: effectiveSourceCount,
    extractedChineseCuesCount,
    translatedKhmerCuesCount,
    missingSubtitlesCount,
    missingTranslationsCount,
    oneToOneMappingValid,
    exactCueIdSetMatch: strictMapping ? strictMapping.exactCueIdSetMatch : null,
    missingCueIds: strictMapping ? strictMapping.missingSourceCueIds : [],
    duplicateCueIds: strictMapping ? strictMapping.duplicateSourceCueIds : [],
    unexpectedCueIds: strictMapping ? strictMapping.unexpectedSourceCueIds : [],
    mismatchedCueIds: strictMapping ? strictMapping.mismatchedOrderCueIds : [],
    invalidTranslationCueIds: strictMapping ? strictMapping.invalidTranslationCueIds : [],
    translationCompletenessPct,
    ocrFrameCompletenessPct,
    ocrUnresolvedFramesCount: ocrUnresolvedFrames,
    coveragePercentage: translationCompletenessPct,
    ...(ocrEngineMode ? { ocrEngineMode } : {}),
    ...(usage ? { usage } : {}),
  };
}

module.exports = {
  PIPELINE_STAGES,
  PIPELINE_STATUS,
  GENERATION_MODES,
  OCR_ENGINE_MODES,
  resolveOcrEngineMode,
  validateStrictSourceCueMapping,
  formatSecondsToTimecode,
  parseTimeToSeconds,
  createCanonicalSegment,
  computePipelineCompletenessReport,
};
