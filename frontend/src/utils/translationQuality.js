/**
 * Shared Stored-Segment Quality & Broken-Set Scanner (Frontend ESM)
 *
 * Mirrors backend/utils/translationQuality.js exactly so frontend and backend
 * compute identical broken-segment counts from stored episode data.
 */

export const EXPLICIT_FILLER_KHMERS = Object.freeze([
  'សូមរង់ចាំ',
  'សូមរង់ចា',
  'សូមរង់',
  'សន្ទនា',
]);

export const EXPRESSIVE_KHMER_DUBBING_RULES = `EXPRESSIVE SOUNDS, INTERJECTIONS & NATURAL DUBBING RULES:
- Understand the original audio emotion, speaker tone, character relationship, and surrounding dialogue before translating.
- Choose EXACTLY ONE final, natural, concise Khmer line per sourceCueId (balancing natural spoken dialogue, lip-sync pacing, and emotional delivery — never output multiple alternatives).
- Translate ALL spoken dialogue, interjections, repeated sounds, hesitation, laughter, coughing, crying, screaming, sighing, stuttering, and emotional vocalizations into context-aware, pronounceable Khmer phonetic expressions suitable for Edge TTS (adapt to actual emotion/context, NOT rigid fixed replacements).
- Preserve meaningful repetitions, hesitation, and emotional intensity (NEVER skip short vocalizations or interjections merely because they contain few characters).
- NEVER translate audible sounds into descriptive words like "សើច", "យំ", "ក្អក", or "ស្រែក" unless those words are actually spoken as dialogue.
- Context-aware examples (adapt tone & intensity to scene):
  * 哈哈哈 / hahaha -> ហាហាហា! / ហាហាហាហា!
  * 呵呵 / hehehe -> ហេហេហេ... / ហ៊ីហ៊ី...
  * 呢呢呢 -> អឹ... អឺ... / នែ... នែ... (តាមបរិបទស្ទាក់ស្ទើរ/អង្វរ)
  * 啊 / 呀啊 -> អា៎! / យ៉ា៎! / អូយ! (តាមអារម្មណ៍ភ្ញាក់ផ្អើល ឬឈឺចាប់)
  * 啊啊啊 -> អា៎! អា៎! អា៎!
  * 啊呃啊 -> អា៎... អឺ... អា៎!
  * 咳咳咳 -> ខក់! ខក់! ខក់!
  * 嗯嗯嗯 -> អ៊ឹម... អ៊ឹម...
  * 哼 -> ហ៊ឹស!
  * 唉 -> ហ៊ឺ...
- Do NOT leave untranslated Chinese, Thai, Lao, or English vocalizations (e.g. hahaha, hehehe, hmm, 哼, 唉).
- Preserve strict 1:1 sourceCueId mapping, character identity, and assigned voice; match original cue duration closely.`;

const EXPLICIT_FILLER_SET = new Set(EXPLICIT_FILLER_KHMERS);
const EXPLICIT_FILLER_REGEX = /^សូមរង់(?:ចា(?:ំ)?)?[\s.…។!?,:;~'"«»()\-–—]*$/u;
const CHINESE_HANZI_REGEX = /[\u3400-\u4dbf\u4e00-\u9fa5]/;
const FOREIGN_SCRIPT_LEAK_REGEX = /[\u3400-\u4dbf\u4e00-\u9fff\u0590-\u06FF\u0900-\u0DFF\u0E00-\u0EFF\u1000-\u109F\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF\u1E00-\u1EFF]/;
const EXPRESSIVE_CHINESE_VOCALIZATION_REGEX =
  /^(?:[\s啊哦嗯哈呵呀哇哎咦哼咳嘘嘿嘎呜唉呃唔呐嘛嗨哟喂嗷嘶哧咻嗚]+|[\s呢]{2,})[啊哦嗯哈呵呀哇哎咦哼咳嘘嘿嘎呜唉呃唔呐嘛嗨哟喂嗷嘶哧咻嗚呢\s!！?？.。…~～、，,\-—]*$/u;
const EXPRESSIVE_LATIN_VOCALIZATION_REGEX =
  /^(?:(?:ha){2,}|(?:he){2,}|(?:hi){2,}|(?:ho){2,}|h+m{2,}|u+m{2,}|u+h{2,}|a+h{2,}|e+h{2,}|o+h{2,}|sh{2,}|pfft+|tsk+|ahem+|argh+|ouch+|sigh+|haha+|hehe+)(?:[\s,!?.…~\-—]+(?:(?:ha){2,}|(?:he){2,}|(?:hi){2,}|(?:ho){2,}|h+m+|u+m+|u+h+|a+h+|e+h+|o+h+|e+r+|sh+|pfft+|tsk+|ahem+|argh+|ouch+|sigh+|haha+|hehe+))*[\s!?.…~\-—]*$|^(?:uh|ah|oh|eh|hm|um)+[\s,!?.…~\-—]+(?:uh|ah|oh|eh|hm|um)+[\s!?.…~\-—]*$/i;
const DESCRIPTIVE_SOUND_LABELS = new Set([
  'សើច',
  'សំឡេងសើច',
  'យំ',
  'សំឡេងយំ',
  'ក្អក',
  'សំឡេងក្អក',
  'ស្រែក',
  'សំឡេងស្រែក',
  'ដកដង្ហើមធំ',
  'ថ្ងូរ',
]);

export function isExpressiveVocalizationSource(text = '') {
  const norm = String(text || '').normalize('NFC').trim();
  if (!norm) return false;
  return (
    EXPRESSIVE_CHINESE_VOCALIZATION_REGEX.test(norm) ||
    EXPRESSIVE_LATIN_VOCALIZATION_REGEX.test(norm)
  );
}

export function isPureDescriptiveSoundLabel(khmerText = '') {
  const norm = String(khmerText || '')
    .normalize('NFC')
    .replace(/^[\[\(（【]+|[\]\)）】]+$/g, '')
    .replace(/[\s.…។!?,:;~'"«»\-–—]+$/gu, '')
    .trim();
  if (!norm) return false;
  return DESCRIPTIVE_SOUND_LABELS.has(norm);
}

export function containsChineseHanzi(text = '') {
  return CHINESE_HANZI_REGEX.test(String(text || '').normalize('NFC'));
}

export function containsForeignScriptLeak(text = '') {
  return FOREIGN_SCRIPT_LEAK_REGEX.test(String(text || '').normalize('NFC'));
}

export function getSegmentKhmerText(seg) {
  if (!seg || typeof seg !== 'object') return '';
  return String(seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || '')
    .normalize('NFC')
    .trim();
}

export function getSegmentChineseText(seg) {
  if (!seg || typeof seg !== 'object') return '';
  return String(
    seg.chineseText ||
      seg.originalChineseText ||
      seg.originalText ||
      seg.original ||
      seg.chinese ||
      ''
  )
    .normalize('NFC')
    .trim();
}

export function stripPunctuationForSpeech(text = '') {
  return String(text || '')
    .normalize('NFC')
    .replace(/[*_~`#<>[\]{}|\\]/g, ' ')
    .replace(/[\s\-–—….:,;!?«»"“”'()។៕៖ៗ៘៙៚]+/gu, '')
    .trim();
}

export function isExplicitFillerKhmer(text = '') {
  const raw = String(text || '').normalize('NFC').trim();
  if (!raw) return false;
  if (EXPLICIT_FILLER_REGEX.test(raw)) return true;
  const strippedTrailing = raw.replace(/[\s.…។!?,:;~'"«»()\-–—]+$/gu, '').trim();
  return EXPLICIT_FILLER_SET.has(strippedTrailing);
}

export function findRepeatedJunkKhmerSet(segments = [], { maxLen = 40, minCount = 5 } = {}) {
  const repeatedSet = new Set();
  if (!Array.isArray(segments) || segments.length < minCount) {
    return repeatedSet;
  }

  const statsByKhmer = new Map();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const km = getSegmentKhmerText(seg);
    if (!km || km.length > maxLen) continue;
    const cn = getSegmentChineseText(seg);
    // Expressive interjections/vocalizations (e.g. "哈哈哈" / "哈哈" -> "ហាហាហាហា!")
    // naturally share the same phonetic Khmer expression across cues and are NOT junk.
    if (cn && isExpressiveVocalizationSource(cn)) continue;
    let entry = statsByKhmer.get(km);
    if (!entry) {
      entry = { count: 0, distinctChinese: new Set() };
      statsByKhmer.set(km, entry);
    }
    entry.count += 1;
    if (cn) {
      entry.distinctChinese.add(cn);
    }
  }

  for (const [km, entry] of statsByKhmer.entries()) {
    if (entry.count >= minCount && entry.distinctChinese.size >= 2) {
      repeatedSet.add(km);
    }
  }

  return repeatedSet;
}

export function isNonChineseAsrHallucination(seg) {
  if (!seg || typeof seg !== 'object') return false;
  if (seg.userOverridden || seg.voiceAssignmentSource === 'manual') return false;

  const evSource = String(seg.evidenceSource || seg.evidenceType || seg.source || '')
    .trim()
    .toLowerCase();
  if (evSource !== 'audio_asr' && evSource !== 'sense_voice_local') {
    return false;
  }

  const ocrText = String(seg.ocrSubtitleText || '').trim();
  if (ocrText.length > 0) return false;

  const sourceText =
    getSegmentChineseText(seg) ||
    String(seg.spokenAudioText || seg.spokenChineseText || '').trim();
  if (!sourceText) return false;
  if (isExpressiveVocalizationSource(sourceText)) return false;

  return !containsChineseHanzi(sourceText);
}

export function isSegmentTextBroken(seg, repeatedJunkSet = null) {
  if (!seg || typeof seg !== 'object') return true;
  const km = getSegmentKhmerText(seg);
  if (!km) return true;
  if (!stripPunctuationForSpeech(km)) return true;
  if (isExplicitFillerKhmer(km)) return true;
  if (containsForeignScriptLeak(km)) return true;
  const cn = getSegmentChineseText(seg);
  if (cn && isExpressiveVocalizationSource(cn) && isPureDescriptiveSoundLabel(km)) {
    return true;
  }
  if (repeatedJunkSet && repeatedJunkSet.has(km)) return true;
  return false;
}

export function isSegmentVoiceBroken(seg, { repeatedJunkSet = null, audioExistsOnDisk = null } = {}) {
  if (!seg || typeof seg !== 'object') return false;
  if (isSegmentTextBroken(seg, repeatedJunkSet)) return false;

  const hasAudioRef = Boolean(seg.audioUrl || seg.audioFile || seg.audioPath);
  if (!hasAudioRef) return true;

  const statusLower = String(seg.ttsStatus || seg.status || '')
    .trim()
    .toLowerCase();
  if (
    statusLower === 'failed' ||
    statusLower === 'error' ||
    statusLower === 'tts_error' ||
    statusLower === 'missing'
  ) {
    return true;
  }

  if (seg.audioFileMissing === true) return true;

  if (audioExistsOnDisk === false) return true;
  if (typeof audioExistsOnDisk === 'function' && audioExistsOnDisk(seg) === false) {
    return true;
  }

  return false;
}

export function scanEpisodeBrokenSegments(ep, { checkAudioFileFn = null } = {}) {
  const segments = Array.isArray(ep?.scriptData?.segments) ? ep.scriptData.segments : [];
  const repeatedJunkSet = findRepeatedJunkKhmerSet(segments);

  const textBrokenSegmentIds = [];
  const voiceBrokenSegmentIds = [];
  const brokenSegmentIds = [];
  const textBrokenIndices = [];
  const voiceBrokenIndices = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segId = seg?.id !== undefined && seg?.id !== null ? seg.id : i + 1;
    if (isSegmentTextBroken(seg, repeatedJunkSet)) {
      textBrokenSegmentIds.push(segId);
      brokenSegmentIds.push(segId);
      textBrokenIndices.push(i);
    } else if (isSegmentVoiceBroken(seg, { repeatedJunkSet, audioExistsOnDisk: checkAudioFileFn })) {
      voiceBrokenSegmentIds.push(segId);
      brokenSegmentIds.push(segId);
      voiceBrokenIndices.push(i);
    }
  }

  const textBrokenCount = textBrokenSegmentIds.length;
  const voiceBrokenCount = voiceBrokenSegmentIds.length;
  const totalBrokenCount = textBrokenCount + voiceBrokenCount;

  return {
    episodeId: ep?.id || null,
    totalSegments: segments.length,
    hasSegments: segments.length > 0,
    textBrokenCount,
    voiceBrokenCount,
    totalBrokenCount,
    textBrokenSegmentIds,
    voiceBrokenSegmentIds,
    brokenSegmentIds,
    textBrokenIndices,
    voiceBrokenIndices,
    repeatedJunkPhrases: Array.from(repeatedJunkSet),
    isTextHealthy: segments.length > 0 && textBrokenCount === 0,
    isVoiceHealthy: segments.length > 0 && totalBrokenCount === 0,
  };
}

export function scanSeriesBrokenSegments(episodes = [], { checkAudioFileFn = null } = {}) {
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];
  let textBrokenCount = 0;
  let voiceBrokenCount = 0;
  let totalSegments = 0;
  const brokenEpisodes = [];
  const perEpisode = {};

  for (const ep of safeEpisodes) {
    if (!ep) continue;
    const scan = scanEpisodeBrokenSegments(ep, { checkAudioFileFn });
    if (ep.id) {
      perEpisode[ep.id] = scan;
    }
    totalSegments += scan.totalSegments;
    textBrokenCount += scan.textBrokenCount;
    voiceBrokenCount += scan.voiceBrokenCount;
    if (scan.totalBrokenCount > 0) {
      brokenEpisodes.push({
        episodeId: ep.id,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        ...scan,
      });
    }
  }

  return {
    totalSegments,
    textBrokenCount,
    voiceBrokenCount,
    totalBrokenCount: textBrokenCount + voiceBrokenCount,
    brokenEpisodeCount: brokenEpisodes.length,
    brokenEpisodes,
    perEpisode,
  };
}

