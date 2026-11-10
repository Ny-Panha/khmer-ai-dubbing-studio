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

const EXPLICIT_FILLER_SET = new Set(EXPLICIT_FILLER_KHMERS);
const EXPLICIT_FILLER_REGEX = /^សូមរង់(?:ចា(?:ំ)?)?[\s.…។!?,:;~'"«»()\-–—]*$/u;

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

export function isSegmentTextBroken(seg, repeatedJunkSet = null) {
  if (!seg || typeof seg !== 'object') return true;
  const km = getSegmentKhmerText(seg);
  if (!km) return true;
  if (!stripPunctuationForSpeech(km)) return true;
  if (isExplicitFillerKhmer(km)) return true;
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

