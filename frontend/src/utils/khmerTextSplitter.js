/**
 * Intelligent Khmer Subtitle & Dialogue Text Splitter
 * Splits long dialogue blocks (e.g., > 12-18 words) into natural, bite-sized consecutive segments
 */

const KHMER_CONJUNCTIONS = [
  ' ហើយ',
  ' ប៉ុន្តែ',
  ' រួច',
  ' ពីព្រោះ',
  ' ដូច្នេះ',
  ' ឬ',
  ' ស្រាប់តែ',
  ' ក៏',
  ' តែ',
  ' ព្រោះ',
  ' បើ',
  ', ',
  ' '
];

/**
 * Split a long Khmer sentence into two natural halves based on conjunctions or words
 * @param {string} text - Full Khmer sentence
 * @returns {[string, string]} [part1, part2]
 */
export function splitKhmerTextIntoHalves(text) {
  if (!text || typeof text !== 'string') return ['', ''];
  const trimmed = text.trim();
  if (trimmed.length <= 25) return [trimmed, ''];

  const mid = Math.floor(trimmed.length / 2);
  let bestIdx = -1;
  let minDiff = Infinity;

  // Search for natural Khmer conjunction near the middle (within 35% of middle)
  for (const conj of KHMER_CONJUNCTIONS) {
    let idx = trimmed.indexOf(conj);
    while (idx !== -1) {
      const diff = Math.abs(idx - mid);
      if (diff < minDiff && diff < trimmed.length * 0.38) {
        minDiff = diff;
        bestIdx = idx;
      }
      idx = trimmed.indexOf(conj, idx + 1);
    }
  }

  // Fallback: search for space closest to middle
  if (bestIdx === -1) {
    let spaceIdx = trimmed.indexOf(' ');
    while (spaceIdx !== -1) {
      const diff = Math.abs(spaceIdx - mid);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = spaceIdx;
      }
      spaceIdx = trimmed.indexOf(' ', spaceIdx + 1);
    }
  }

  // If still no space, break at mid
  if (bestIdx === -1 || bestIdx === 0 || bestIdx >= trimmed.length - 1) {
    bestIdx = mid;
  }

  const part1 = trimmed.slice(0, bestIdx).trim();
  const part2 = trimmed.slice(bestIdx).trim();
  return [part1, part2];
}

/**
 * Check if a subtitle segment is considered long (> 55 chars or > 14 words)
 * @param {string} text 
 * @returns {boolean}
 */
export function isLongKhmerSubtitle(text) {
  if (!text) return false;
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  return trimmed.length > 55 || words.length >= 14;
}

/**
 * Get dynamic sub-phrase for long subtitles during playback ("ចូល second មួយទៀត ចូល text មួយទៀត")
 * @param {Object} seg 
 * @param {number} currentTime 
 * @param {Function} parseTimeToSeconds 
 * @returns {string}
 */
export function getLivePagedSubtitle(seg, currentTime, parseTimeToSeconds) {
  if (!seg) return '';
  const text = String(seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || '').trim();
  if (!text) return '';
  if (!isLongKhmerSubtitle(text)) return text;

  const s = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
    ? seg.startSec
    : ((typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec
      : (parseTimeToSeconds ? parseTimeToSeconds(seg.start ?? seg.startTime, 0) : 0));

  let e = (typeof seg.endSec === 'number' && !isNaN(seg.endSec))
    ? seg.endSec
    : ((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
      ? seg.audioEndSec
      : (parseTimeToSeconds ? parseTimeToSeconds(seg.end ?? seg.endTime, s + (seg.audioDurationSec || 2.5)) : s + (seg.audioDurationSec || 2.5)));

  if (isNaN(e) || e <= s || (e - s) < 0.6) {
    e = s + Math.max(1.8, Math.min(6.0, text.length * 0.16));
  }

  const dur = Math.max(1.5, e - s);
  const midTime = s + dur / 2;
  const [part1, part2] = splitKhmerTextIntoHalves(text);

  if (!part2) return text;
  return currentTime < midTime ? part1 : part2;
}

/**
 * Splits a long segment into natural bite-sized sentence segments based on Khmer & Chinese punctuation
 * @param {Object} seg - Segment object
 * @returns {Array<Object>} Array of sub-segments
 */
export function splitSegmentIntoNaturalSentences(seg) {
  if (!seg) return [seg];
  const origChinese = String(seg.chineseText || seg.originalChineseText || seg.originalText || seg.original || seg.chinese || '').trim();
  const fullKhmer = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || '').trim();
  const startSec = typeof seg.startSec === 'number' ? seg.startSec : 0;
  const endSec = typeof seg.endSec === 'number' ? seg.endSec : startSec + 4;
  const totalDur = parseFloat((endSec - startSec).toFixed(2));

  // 1. Split Khmer sentences by punctuation: ។, ?, !, ..., \n
  const kmSentences = fullKhmer
    .split(/(?<=[។!?\n])\s*|(?<=\.{3,})\s*|(?<=…+)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 2. Split Chinese sentences by punctuation: 。！？…\n；
  const cnSentences = origChinese
    .split(/(?<=[。！？\n；])\s*|(?<=\.{3,})\s*|(?<=…+)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const numSplits = Math.max(kmSentences.length, cnSentences.length);
  if (numSplits <= 1) {
    // If no sentence punctuation, split into 2 halves
    const midTime = parseFloat((startSec + totalDur / 2).toFixed(2));
    const [km1, km2] = splitKhmerTextIntoHalves(fullKhmer);
    let cn1 = origChinese;
    let cn2 = origChinese;
    if (origChinese.length >= 10) {
      const midCn = Math.floor(origChinese.length / 2);
      cn1 = origChinese.slice(0, midCn).trim();
      cn2 = origChinese.slice(midCn).trim();
    }
    return [
      {
        ...seg,
        endSec: midTime,
        end: formatMinSec(midTime),
        audioEndSec: midTime,
        audioDurationSec: parseFloat((midTime - startSec).toFixed(2)),
        khmer: km1,
        khmerText: km1,
        khmerTranslatedText: km1,
        chineseText: cn1,
        original: cn1,
        originalText: cn1,
        originalChineseText: cn1,
        audioGenerated: false,
        audioFile: null,
      },
      {
        ...seg,
        id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        startSec: midTime,
        start: formatMinSec(midTime),
        audioStartSec: midTime,
        audioDurationSec: parseFloat((endSec - midTime).toFixed(2)),
        khmer: km2 || km1,
        khmerText: km2 || km1,
        khmerTranslatedText: km2 || km1,
        chineseText: cn2 || cn1,
        original: cn2 || cn1,
        originalText: cn2 || cn1,
        originalChineseText: cn2 || cn1,
        audioGenerated: false,
        audioFile: null,
      },
    ];
  }

  // Calculate weights based on length
  const weights = [];
  for (let i = 0; i < numSplits; i++) {
    const kmL = (kmSentences[i] || '').length;
    const cnL = (cnSentences[i] || '').length;
    weights.push(Math.max(1, kmL + cnL * 1.5));
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0) || 1;

  const result = [];
  let curStart = startSec;

  for (let i = 0; i < numSplits; i++) {
    const partDur = parseFloat(((weights[i] / sumWeights) * totalDur).toFixed(2));
    const isLast = i === numSplits - 1;
    const partEnd = isLast ? endSec : parseFloat((curStart + Math.max(1.5, partDur)).toFixed(2));

    const kmPart = kmSentences[i] || (i === 0 ? fullKhmer : '');
    const cnPart = cnSentences[i] || (i === 0 ? origChinese : '');

    result.push({
      ...seg,
      id: i === 0 ? seg.id : `seg-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 4)}`,
      startSec: curStart,
      endSec: partEnd,
      start: formatMinSec(curStart),
      end: formatMinSec(partEnd),
      audioStartSec: curStart,
      audioEndSec: partEnd,
      audioDurationSec: parseFloat((partEnd - curStart).toFixed(2)),
      khmer: kmPart,
      khmerText: kmPart,
      khmerTranslatedText: kmPart,
      chineseText: cnPart,
      original: cnPart,
      originalText: cnPart,
      originalChineseText: cnPart,
      audioGenerated: false,
      audioFile: null,
      fullAudioUrl: null,
    });

    curStart = partEnd;
  }

  return result;
}

function formatMinSec(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(5, '0')}`;
}
