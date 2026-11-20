const {
  SCHEMA_VERSION,
  parseTimestampToSeconds,
  parseTimeToSec,
  formatTime,
  toSrtTime,
  formatTimecode,
  migrateSegmentTimestamps,
  migrateProjectData,
} = require('./timestampUtils');

const {
  detectSpeakerGender,
  getSpeakerId,
  getDefaultVoiceForGender,
} = require('./speakerRegistry');

/**
 * Create and normalize a single segment adhering to the schema
 * @param {Object} raw 
 * @param {number} index 
 * @param {string} [defaultMode='dialogue'] 
 * @returns {Object}
 */
function createSegment(raw = {}, index = 0, defaultMode = 'dialogue') {
  const mode = raw.mode || defaultMode;
  const rawStartSec = parseTimeToSec(raw.startSec ?? raw.start, index * 4);
  let rawEndSec = parseTimeToSec(raw.endSec ?? raw.end, rawStartSec + 3.5);
  const rawDuration = rawEndSec - rawStartSec;
  const isMicroDuration = isNaN(rawEndSec) || rawDuration < 0.6; // Strictly blocks 0.01s or zero duration
  
  if (rawEndSec <= rawStartSec || isMicroDuration) {
    const textLen = (raw.khmerTranslatedText || raw.khmer || raw.khmerText || raw.originalChineseText || raw.original || "").trim().length || 8;
    const safeDuration = Math.max(1.8, Math.min(8.0, parseFloat((textLen * 0.16).toFixed(2))));
    rawEndSec = parseFloat((rawStartSec + safeDuration).toFixed(2));
  }

  const id = raw.segmentId ? String(raw.segmentId) : (raw.id ? String(raw.id) : `seg_${Date.now()}_${index + 1}`);
  const segmentId = id;
  const originalChineseText = (raw.originalChineseText || raw.original || raw.originalText || raw.chineseText || '').trim();
  const original = originalChineseText;
  const khmerTranslatedText = (raw.khmerTranslatedText || raw.khmer || raw.khmerText || '').trim();
  const khmer = khmerTranslatedText;
  const speaker = (raw.speakerName || raw.speaker || '').trim() || (
    mode === 'dialogue' ? 'តួអង្គ' : (
      mode === 'subtitles' || mode === 'title_translation' ? 'ចំណងជើង/Subtitle' : 'អ្នកសម្រាយរឿង'
    )
  );
  const speakerName = raw.speakerName || speaker;
  const speakerId = raw.speakerId || getSpeakerId(speaker);
  const explicitRawGender = String(raw.speakerGender || raw.gender || raw.voiceGender || '').trim().toLowerCase();
  const hasExplicitGender = explicitRawGender === 'female' || explicitRawGender === 'male' || explicitRawGender === 'f' || explicitRawGender === 'm';
  const isManual = Boolean(raw.userOverridden || raw.voiceAssignmentSource === 'manual' || raw.voiceOverride);
  const titleGender = detectSpeakerGender(speaker, '', raw.khmerTranslatedText || raw.khmer || raw.khmerText || '');
  const speakerGender = (!isManual && titleGender !== 'UNKNOWN')
    ? titleGender
    : detectSpeakerGender(speaker, hasExplicitGender ? explicitRawGender : '');
  const derivedVoice = (speakerGender === 'FEMALE' || speakerGender === 'MALE')
    ? getDefaultVoiceForGender(speakerGender)
    : null;
  const voiceId = isManual
    ? (raw.voiceOverride || raw.khmerVoiceId || raw.voiceId || raw.voice || derivedVoice || getDefaultVoiceForGender(speakerGender))
    : (derivedVoice || raw.khmerVoiceId || raw.voiceId || getDefaultVoiceForGender(speakerGender));
  const voiceProvider = raw.voiceProvider || (voiceId === 'km' ? 'google-translate-tts' : 'edge-tts');

  const audioStartSec = raw.audioStartSec !== undefined 
    ? parseTimeToSec(raw.audioStartSec, rawStartSec)
    : (raw.audioStart ? parseTimeToSec(raw.audioStart, rawStartSec) : rawStartSec);

  const audioDurationSec = raw.audioDurationSec ? parseFloat(raw.audioDurationSec) : 0;
  const audioEndSec = audioDurationSec > 0 
    ? parseFloat((audioStartSec + audioDurationSec).toFixed(2))
    : (raw.audioEndSec !== undefined ? parseTimeToSec(raw.audioEndSec, rawEndSec) : rawEndSec);

  const audioFile = raw.audioFile || null;
  const audioUrl = raw.audioUrl || (audioFile ? `/uploads/${audioFile}` : null);
  const audioPath = raw.audioPath || null;

  // Translation status detection
  let translationStatus = raw.translationStatus || (khmer ? 'translated' : (originalChineseText ? 'review_needed' : 'pending'));
  if (raw.textStatus === 'text_updated') {
    translationStatus = 'edited';
  }

  // TTS status detection
  let ttsStatus = raw.ttsStatus || 'pending';
  if (audioFile && audioDurationSec > 0) {
    ttsStatus = (raw.audioOutdated || translationStatus === 'edited') ? 'outdated' : 'ready';
  } else if (raw.textStatus === 'generating' || raw.isGenerating) {
    ttsStatus = 'generating';
  } else if (raw.textStatus === 'error' || raw.regenError) {
    ttsStatus = 'error';
  }

  let status = raw.status || (ttsStatus === 'ready' ? 'audio_ready' : (khmer ? 'translated' : 'pending'));

  const voiceGender = isManual
    ? (String(raw.voiceGender || (speakerGender === 'FEMALE' ? 'female' : (speakerGender === 'MALE' ? 'male' : 'unknown'))).toLowerCase())
    : (speakerGender === 'FEMALE' ? 'female' : (speakerGender === 'MALE' ? 'male' : (raw.voiceGender || 'unknown')));
  const genderConfidence = typeof raw.genderConfidence === 'number' && raw.genderConfidence !== 0.5
    ? raw.genderConfidence
    : (voiceGender === 'unknown' ? null : 0.85);
  const khmerVoiceId = raw.khmerVoiceId || voiceId;
  const voiceAssignmentSource = raw.voiceAssignmentSource || (isManual ? 'manual' : (voiceGender === 'unknown' ? 'fallback' : 'automatic'));

  // Inner-Thought & Delivery Classification metadata
  const deliveryType = raw.deliveryType && ['out_loud', 'inner_thought', 'narration', 'unknown'].includes(raw.deliveryType)
    ? raw.deliveryType
    : (mode === 'recap' ? 'narration' : 'out_loud');
  const deliveryOverride = Boolean(raw.deliveryOverride);
  const deliveryConfidence = typeof raw.deliveryConfidence === 'number'
    ? raw.deliveryConfidence
    : (deliveryType === 'unknown' ? null : (deliveryOverride ? 1.0 : 0.9));
  const deliveryReviewNeeded = Boolean(raw.deliveryReviewNeeded || deliveryType === 'unknown');
  const audioEffect = raw.audioEffect || (deliveryType === 'inner_thought' ? 'inner_thought_reverb' : 'none');
  const effectConfig = raw.effectConfig || (deliveryType === 'inner_thought' ? { inGain: 0.85, outGain: 0.75, delays: "40|90", decays: "0.3|0.15" } : null);
  const rawAudioPath = raw.rawAudioPath || null;
  const rawAudioFile = raw.rawAudioFile || null;

  const segment = {
    id,
    segmentId,
    mode,
    startSec: parseFloat(rawStartSec.toFixed(2)),
    endSec: parseFloat(rawEndSec.toFixed(2)),
    sourceStartSec: typeof raw.sourceStartSec === 'number' ? parseFloat(raw.sourceStartSec.toFixed(2)) : parseFloat(rawStartSec.toFixed(2)),
    sourceEndSec: typeof raw.sourceEndSec === 'number' ? parseFloat(raw.sourceEndSec.toFixed(2)) : parseFloat(rawEndSec.toFixed(2)),
    start: formatTime(rawStartSec),
    end: formatTime(rawEndSec),
    original,
    originalText: originalChineseText,
    originalChineseText,
    chineseText: originalChineseText,
    khmer,
    khmerText: khmerTranslatedText,
    khmerTranslatedText,
    speaker,
    speakerName,
    speakerId,
    speakerGender,
    gender: voiceGender === 'female' ? 'female' : (voiceGender === 'male' ? 'male' : 'unknown'),
    voiceGender,
    genderConfidence,
    khmerVoiceId,
    voiceId: khmerVoiceId,
    voice: khmerVoiceId,
    voiceAssignmentSource,
    voiceProvider,
    deliveryType,
    deliveryOverride,
    deliveryConfidence,
    deliveryReviewNeeded,
    audioEffect,
    effectConfig,
    rawAudioPath,
    rawAudioFile,
    audioFile,
    audioUrl,
    audioPath,
    audioDurationSec: parseFloat(audioDurationSec.toFixed(2)),
    audioStartSec: parseFloat(audioStartSec.toFixed(2)),
    audioEndSec: parseFloat(audioEndSec.toFixed(2)),
    audioStart: formatTime(audioStartSec),
    audioEnd: formatTime(audioEndSec),
    schemaVersion: SCHEMA_VERSION,
    status,
    translationStatus,
    ttsStatus,
    audioOutdated: ttsStatus === 'outdated',
    reviewNeeded: Boolean(isMicroDuration || raw.reviewNeeded || translationStatus === 'review_needed' || voiceGender === 'unknown'),
    isFallback: Boolean(raw.isFallback || (voiceGender === 'unknown' && !isManual)),
    uncertainTiming: Boolean(isMicroDuration || raw.uncertainTiming),
    duration: parseFloat((rawEndSec - rawStartSec).toFixed(2)),
    timingType: raw.timingType || (isMicroDuration ? 'uncertain_micro_adjusted' : 'approximate'), // 'approximate' | 'exact' | 'user_adjusted'
    validationErrors: [],
  };

  validateSegment(segment);
  return segment;
}

/**
 * Validate a segment and populate validationErrors array
 * @param {Object} seg 
 * @returns {Array<string>}
 */
function validateSegment(seg) {
  const errors = [];

  if (seg.endSec <= seg.startSec) {
    errors.push('ពេលវេលាបញ្ចប់ (End) ត្រូវតែធំជាងពេលវេលាចាប់ផ្តើម (Start)');
  }

  if (!seg.khmerTranslatedText && !seg.khmer) {
    if (seg.originalChineseText || seg.original) {
      errors.push('មិនទាន់មានអត្ថបទបកប្រែជាភាសាខ្មែរឡើយ (ត្រូវការ Review)');
    } else {
      errors.push('មិនទាន់មានអត្ថបទដើម ឬអត្ថបទបកប្រែជាភាសាខ្មែរឡើយ');
    }
  }

  // Audio duration overflow check
  if (seg.audioDurationSec > 0) {
    const targetInterval = seg.endSec - seg.startSec;
    const diff = seg.audioDurationSec - targetInterval;
    if (diff > 0.4) {
      errors.push(`សំឡេង AI វែងជាងឈុតឆាក +${diff.toFixed(1)}s (សូមកាត់បន្ថយពាក្យ ឬពន្លឿន Speed)`);
    }
  }

  seg.validationErrors = errors;
  return errors;
}

/**
 * Normalize an array of segments
 * @param {Array} segments 
 * @param {string} [defaultMode='dialogue'] 
 * @returns {Array}
 */
function normalizeSegmentList(segments, defaultMode = 'dialogue') {
  if (!segments || !Array.isArray(segments)) return [];
  let prevEndSec = 0;
  return segments.map((s, idx) => {
    const seg = createSegment(s, idx, defaultMode);
    if (idx > 0 && seg.startSec < prevEndSec) {
      const dur = Math.max(1.8, parseFloat((seg.endSec - seg.startSec).toFixed(2)));
      seg.startSec = parseFloat((prevEndSec + 0.15).toFixed(2));
      seg.endSec = parseFloat((seg.startSec + dur).toFixed(2));
      seg.start = formatTime(seg.startSec);
      seg.end = formatTime(seg.endSec);
      seg.audioStartSec = seg.startSec;
      seg.audioEndSec = seg.endSec;
      seg.audioStart = seg.start;
      seg.audioEnd = seg.end;
    }
    prevEndSec = Math.max(prevEndSec, seg.endSec);
    return seg;
  });
}

module.exports = {
  SCHEMA_VERSION,
  parseTimestampToSeconds,
  parseTimeToSec,
  formatTime,
  toSrtTime,
  formatTimecode,
  createSegment,
  validateSegment,
  normalizeSegmentList,
  migrateSegmentTimestamps,
  migrateProjectData,
};