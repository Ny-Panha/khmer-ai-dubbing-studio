/**
 * VAD Alignment Service (Speech Activity & Clause Alignment)
 * DragonDub AI — Phase 2 Controlled Implementation
 *
 * Reconciles compound ASR sentences with split visual subtitle cards,
 * partitions multi-clause speech events across corresponding visual segments,
 * clamps visual hangover intervals to legitimate speech cessation,
 * and maintains strict distinction between speech duration, subtitle duration,
 * skipTts, subtitleOnly, and isMuted.
 */

function normalizeChineseChars(str = '') {
  return String(str || '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim();
}

/**
 * Normalizes Chinese text including common ASR Arabic digit substitutions and phonetic confusions
 * e.g., '1约' -> '一跃', '1' -> '一', '2' -> '二', etc.
 */
function normalizeChineseWithDigits(str = '') {
  const s = normalizeChineseChars(str);
  return s
    .replace(/1约/g, '一跃')
    .replace(/0/g, '零')
    .replace(/1/g, '一')
    .replace(/2/g, '二')
    .replace(/3/g, '三')
    .replace(/4/g, '四')
    .replace(/5/g, '五')
    .replace(/6/g, '六')
    .replace(/7/g, '七')
    .replace(/8/g, '八')
    .replace(/9/g, '九');
}

/**
 * Conservative fuzzy match between ASR clause and OCR clause
 */
function isFuzzyClauseMatch(aText = '', vText = '') {
  const aNorm = normalizeChineseChars(aText);
  const vNorm = normalizeChineseChars(vText);
  if (!aNorm || !vNorm) return false;
  if (aNorm === vNorm) return true;
  if (aNorm.includes(vNorm) || vNorm.includes(aNorm)) return true;

  // Normalized digits test (e.g. 1约十万八千里 vs 一跃十万八千里)
  const aDig = normalizeChineseWithDigits(aText);
  const vDig = normalizeChineseWithDigits(vText);
  if (aDig.includes(vDig) || vDig.includes(aDig)) return true;

  // Minimum length check to avoid single-char spurious false positives (>= 70% match)
  const minL = Math.min(aDig.length, vDig.length);
  if (minL >= 3) {
    for (let i = 0; i <= aDig.length - minL; i++) {
      const window = aDig.substring(i, i + minL);
      let matchCount = 0;
      for (let j = 0; j < minL; j++) {
        if (window[j] === vDig[j]) matchCount++;
      }
      if (matchCount / minL >= 0.70) return true;
    }
  }
  return false;
}

/**
 * Distributes a compound ASR speech duration proportionally across its constituent visual clauses
 * based on Hanzi character count.
 *
 * @param {object} aSeg - Spoken Chinese ASR segment
 * @param {Array<object>} visualClauses - Ordered array of visual segments forming the compound sentence
 * @returns {Array<object>} - Array of partitioned speech timing objects
 */
function partitionAsrSegmentAcrossVisualClauses(aSeg, visualClauses = []) {
  if (!aSeg || !Array.isArray(visualClauses) || visualClauses.length === 0) {
    return [];
  }

  const aStart = typeof aSeg.startSec === 'number' ? aSeg.startSec : 0;
  const aEnd = typeof aSeg.endSec === 'number' ? aSeg.endSec : aStart + 2.0;
  const totalAudioDur = Math.max(0.6, parseFloat((aEnd - aStart).toFixed(2)));

  if (visualClauses.length === 1) {
    const vSeg = visualClauses[0];
    const vStart = typeof vSeg.startSec === 'number' ? vSeg.startSec : aStart;
    const vEnd = typeof vSeg.endSec === 'number' ? vSeg.endSec : (vStart + 2.5);
    const speechStart = typeof aStart === 'number' ? Math.max(0, Math.min(aStart, vStart)) : vStart;
    // Cap speechEnd so it does not spill wildly past visual clause boundary when ASR includes music/bgm
    const speechEnd = Math.min(aEnd, Math.max(vEnd, speechStart + 0.8));
    const speechDur = Math.max(0.6, parseFloat((speechEnd - speechStart).toFixed(2)));
    const hangover = Math.max(0, parseFloat((vEnd - speechEnd).toFixed(2)));
    const clauseText = String(vSeg.originalChineseText || vSeg.text || '').trim();
    return [{
      visualIndex: vSeg._visualIndex ?? 0,
      vSeg,
      speechStartSec: parseFloat(speechStart.toFixed(2)),
      speechEndSec: parseFloat(speechEnd.toFixed(2)),
      speechDuration: speechDur,
      spokenAudioText: clauseText || String(aSeg.spokenChineseText || '').trim(),
      visualHangoverSec: hangover,
      skipTts: false,
      subtitleOnly: false,
      isMuted: false,
      isSilentScene: false,
    }];
  }

  // Calculate clean character lengths for proportional division
  const clauseLengths = visualClauses.map((v) => {
    const norm = normalizeChineseChars(v.originalChineseText || v.text || '');
    return Math.max(1, norm.length);
  });
  const totalChars = clauseLengths.reduce((acc, l) => acc + l, 0);

  const partitions = [];
  let currentStart = aStart;

  for (let i = 0; i < visualClauses.length; i++) {
    const vSeg = visualClauses[i];
    const isLast = i === visualClauses.length - 1;
    let dur;

    if (isLast) {
      dur = Math.max(0.6, parseFloat((aEnd - currentStart).toFixed(2)));
    } else {
      const propDur = totalAudioDur * (clauseLengths[i] / totalChars);
      dur = Math.max(0.6, parseFloat(propDur.toFixed(2)));
      // Ensure remaining clauses get at least 0.6s
      const remainingClauses = visualClauses.length - 1 - i;
      if (currentStart + dur + remainingClauses * 0.6 > aEnd) {
        dur = Math.max(0.6, parseFloat((aEnd - currentStart - remainingClauses * 0.6).toFixed(2)));
      }
    }

    const currentEnd = isLast ? aEnd : parseFloat((currentStart + dur).toFixed(2));
    const vEnd = typeof vSeg.endSec === 'number' ? vSeg.endSec : currentEnd;
    const hangover = Math.max(0, parseFloat((vEnd - currentEnd).toFixed(2)));

    // Derive clause-level spoken audio text from visual segment if available
    const clauseText = String(vSeg.originalChineseText || vSeg.text || '').trim();

    partitions.push({
      visualIndex: vSeg._visualIndex ?? i,
      vSeg,
      speechStartSec: parseFloat(currentStart.toFixed(2)),
      speechEndSec: parseFloat(currentEnd.toFixed(2)),
      speechDuration: parseFloat((currentEnd - currentStart).toFixed(2)),
      spokenAudioText: clauseText || String(aSeg.spokenChineseText || '').trim(),
      visualHangoverSec: hangover,
      skipTts: false,
      subtitleOnly: false,
      isMuted: false,
      isSilentScene: false,
    });

    currentStart = currentEnd;
  }

  return partitions;
}

/**
 * Scans visual and audio segments to find compound ASR sentences partitioned into multiple visual cards
 * Supports conservative fuzzy matching to handle known recognition confusions (e.g. 1约 vs 一跃).
 * 
 * @param {Array<object>} visualSegments
 * @param {Array<object>} audioSegments
 * @returns {Map<number, Array<object>>} Map of visualIndex -> partition record
 */
function findCompoundAsrPartitions(visualSegments = [], audioSegments = []) {
  const partitionMap = new Map();
  const matchedAudioIndices = new Set();

  for (let aIdx = 0; aIdx < audioSegments.length; aIdx++) {
    const aSeg = audioSegments[aIdx];
    const aNorm = normalizeChineseWithDigits(aSeg.spokenChineseText || '');
    if (aNorm.length < 6) continue;

    const aStart = typeof aSeg.startSec === 'number' ? aSeg.startSec : 0;
    const aEnd = typeof aSeg.endSec === 'number' ? aSeg.endSec : aStart + 1;

    // Look for consecutive visual segments that overlap with this audio window (+/- 2.5s)
    const candidates = [];
    for (let vIdx = 0; vIdx < visualSegments.length; vIdx++) {
      const vSeg = visualSegments[vIdx];
      if (vSeg.position === 'title_card') continue;

      const vNorm = normalizeChineseWithDigits(vSeg.originalChineseText || '');
      if (vNorm.length === 0) continue;

      const vStart = typeof vSeg.startSec === 'number' ? vSeg.startSec : 0;
      const vEnd = typeof vSeg.endSec === 'number' ? vSeg.endSec : vStart + 1.5;
      const timeOverlap = (vStart <= aEnd + 2.5) && (aStart <= vEnd + 2.5);
      const isMatch = isFuzzyClauseMatch(aSeg.spokenChineseText, vSeg.originalChineseText);

      if (timeOverlap && isMatch) {
        candidates.push({ ...vSeg, _visualIndex: vIdx });
      }
    }

    if (candidates.length >= 2) {
      const combinedNorm = candidates.map((c) => normalizeChineseWithDigits(c.originalChineseText || '')).join('');
      // If candidates match substantial portion of ASR or are consecutive matching clauses
      if (
        candidates.length >= 2 ||
        aNorm.includes(combinedNorm) ||
        combinedNorm.includes(aNorm) ||
        (combinedNorm.length / aNorm.length >= 0.35)
      ) {
        matchedAudioIndices.add(aIdx);
        const partitioned = partitionAsrSegmentAcrossVisualClauses(aSeg, candidates);
        for (const part of partitioned) {
          partitionMap.set(part.visualIndex, { ...part, aIdx, aSeg });
        }
      }
    }
  }

  return { partitionMap, matchedAudioIndices };
}

/**
 * Classifies speech activity according to DragonDub AI evidence standards.
 * Distinguishes spoken dialogue, singing, BGM, SFX, silence, and uncertain audio.
 * Prevents non-speech from creating dialogue Timeline clips while strictly preserving
 * whispered speech and quiet dialogue.
 */
function classifySpeechActivity({
  hasAsrText = false,
  hasAcousticVoice = false,
  isTitleCard = false,
  visualHangoverSec = 0,
  hasOverlap = false,
  asrConfidence = null,
  isBgmOnly = false,
  isPureBgm = false,
  isSinging = false,
  audioEvents = [],
  ocrHasText = true,
  isSilentRegion = false,
  speechDuration = 0,
}) {
  // Case 1: Title Card / Graphics
  if (isTitleCard) {
    return {
      caseType: 'CASE_G_TITLE_CARD',
      skipTts: true,
      subtitleOnly: true,
      isMuted: true,
      isSilentScene: true,
      reviewNeeded: false,
      rejectFromDialogueTimeline: false,
    };
  }

  // Case 2: Confirmed pure BGM / Music / Singing without spoken dialogue
  // បន្ថែម isSinging: បើជាចម្រៀង ឬភ្លេងសុទ្ធ មិនត្រូវបង្កើតជា Dialogue ឡើយ
  if (isPureBgm || isBgmOnly || isSinging) {
    return {
      caseType: 'CASE_B_BGM_ONLY',
      skipTts: true,
      subtitleOnly: false,
      isMuted: true,
      isSilentScene: true,
      reviewNeeded: false,
      rejectFromDialogueTimeline: true, // ច្រោះចោលពី timeline ទាំងស្រុង
    };
  }

  // Case 3: Confirmed silence / non-speech region
  if (isSilentRegion && !hasAsrText) {
    return {
      caseType: 'CASE_C_SILENT_SCENE',
      skipTts: true,
      subtitleOnly: true,
      isMuted: true,
      isSilentScene: true,
      reviewNeeded: false,
      rejectFromDialogueTimeline: true,
    };
  }

  // Case 4: Clear spoken dialogue (with or without BGM)
  if (hasAsrText && hasAcousticVoice) {
    return {
      caseType: 'CASE_A_SPEECH_WITH_BGM',
      skipTts: false,
      subtitleOnly: false,
      isMuted: false,
      isSilentScene: false,
      reviewNeeded: false,
      rejectFromDialogueTimeline: false,
    };
  }

  // Case 5: ASR text exists, but acoustic pitch confidence was low (whisper, quiet speech, shouted speech, or heavy BGM)
  if (hasAsrText && !hasAcousticVoice) {
    const isCorroborated = ocrHasText || (audioEvents && audioEvents.includes('speech'));
    return {
      caseType: 'CASE_E_LOW_ACOUSTIC_CONF',
      skipTts: false,
      subtitleOnly: false,
      isMuted: false,
      isSilentScene: false,
      reviewNeeded: !isCorroborated,
      confidence: typeof asrConfidence === 'number' ? asrConfidence : 0.85,
      rejectFromDialogueTimeline: false, // Never auto-delete possible whispered speech!
    };
  }

  // Case 6: Acoustic energy without text (groan, scream, roar)
  if (!hasAsrText && hasAcousticVoice) {
    return {
      caseType: 'CASE_F_VOICE_WITHOUT_TEXT',
      skipTts: true,
      subtitleOnly: true,
      isMuted: true,
      isSilentScene: false,
      reviewNeeded: true,
      rejectFromDialogueTimeline: false,
    };
  }

  // Default: BGM or Silence
  return {
    caseType: 'CASE_B_BGM_ONLY',
    skipTts: true,
    subtitleOnly: true,
    isMuted: true,
    isSilentScene: true,
    reviewNeeded: false,
    rejectFromDialogueTimeline: !ocrHasText,
  };
}

module.exports = {
  normalizeChineseChars,
  normalizeChineseWithDigits,
  isFuzzyClauseMatch,
  partitionAsrSegmentAcrossVisualClauses,
  findCompoundAsrPartitions,
  classifySpeechActivity,
};
