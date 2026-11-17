/**
 * timelineOps.js — Pure Timeline Operations Module
 *
 * ALL timeline mutations live here as pure functions:
 *   (state, args) => { state, applied, reason? }
 *
 * Rules:
 *   - NO React, NO refs, NO API calls
 *   - Only imports from timestampUtils.js and khmerTextSplitter.js
 *   - Fully unit-testable
 *   - Components and hooks may ONLY change clips/segments by calling these ops
 */

import {
  parseTimeToSeconds,
  formatMinSec,
  getSegmentAudioDuration,
  hasSegmentAudio,
} from './timestampUtils.js';

import {
  splitKhmerTextIntoHalves,
} from './khmerTextSplitter.js';

// ─── Helpers ────────────────────────────────────────────────────────

/** Check if a clip is a Gap */
export function isGapClip(clip) {
  if (!clip) return false;
  if (clip.isDialogue === false && (!clip.name || clip.name === 'Gap')) return true;
  return /^Gap(?: \(Part \d+\))?$/i.test(clip.name || '') || (clip.id && String(clip.id).startsWith('clip-gap'));
}

/** Deterministic unique ID (timestamp + random suffix) */
function uid(prefix = 'clip') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
}

/** Round to 3 decimal places */
function r3(n) {
  return parseFloat(Number(n).toFixed(3));
}

/** Round to 2 decimal places */
function r2(n) {
  return parseFloat(Number(n).toFixed(2));
}

/** Deep-clone a simple JSON-serializable value */
function deepClone(obj) {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Find segment index matching key (_uid, id, segmentId, or numeric index).
 * Replicates findSegmentIndex from timelineUtils (read-only helper).
 */
function findSegIdx(segments, key) {
  if (!Array.isArray(segments) || segments.length === 0 || key === null || key === undefined) return -1;
  const keyStr = String(key).trim();

  // 1. _uid, id, segmentId match
  let idx = segments.findIndex((s) => {
    if (s._uid && String(s._uid) === keyStr) return true;
    if (s.id !== undefined && s.id !== null && String(s.id) === keyStr) return true;
    if (s.segmentId !== undefined && s.segmentId !== null && String(s.segmentId) === keyStr) return true;
    return false;
  });

  // 2. Numeric index fallback
  if (idx === -1 && typeof key === 'number' && !isNaN(key) && key >= 0 && key < segments.length) {
    idx = key;
  }
  if (idx === -1 && /^\d+$/.test(keyStr)) {
    const num = parseInt(keyStr, 10);
    if (num >= 0 && num < segments.length) idx = num;
  }
  return idx;
}

/** Normalize a clip ensuring numeric start/end/sourceStart/sourceEnd */
function ensureClipNums(clip) {
  if (!clip) return clip;
  return {
    ...clip,
    start: typeof clip.start === 'number' ? clip.start : 0,
    end: typeof clip.end === 'number' ? clip.end : 0,
    sourceStart: typeof clip.sourceStart === 'number' ? clip.sourceStart : (typeof clip.start === 'number' ? clip.start : 0),
    sourceEnd: typeof clip.sourceEnd === 'number' ? clip.sourceEnd : (typeof clip.end === 'number' ? clip.end : 0),
  };
}

// ─── OpResult factory ───────────────────────────────────────────────

function ok(state) {
  if (state && Array.isArray(state.videoClips)) {
    state.videoClips.forEach((c) => {
      if (isGapClip(c)) {
        delete c.segmentId;
        delete c.segmentIndex;
      }
    });
  }
  return { state, applied: true };
}

function noop(state, reason) {
  return { state, applied: false, reason };
}

// ═══════════════════════════════════════════════════════════════════
//  R1 — deleteSegment
//  Remove only the targeted segment. videoClips deep-equal before/after.
//  Survivor ids and times preserved (no ripple, no renumber, no snap).
// ═══════════════════════════════════════════════════════════════════

export function deleteSegment(state, { segKey }) {
  const { videoClips, segments } = state;
  if (!Array.isArray(segments) || segments.length === 0) {
    return noop(state, 'No segments to delete');
  }

  const targetIndex = findSegIdx(segments, segKey);
  if (targetIndex === -1) {
    return noop(state, `Segment not found for key: ${segKey}`);
  }

  // R1: Filter out the target — do NOT renumber, do NOT ripple, do NOT touch times
  const nextSegments = segments.filter((_, idx) => idx !== targetIndex);

  return ok({
    videoClips: deepClone(videoClips), // deep-equal copy (unchanged)
    segments: nextSegments,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  R2 — deleteVideoClip (dialogue clip → Gap merge)
//  Remove dialogue clip; replace its range with ONE Gap merged with
//  adjacent Gaps; segments deep-equal; [0, duration] continuous.
// ═══════════════════════════════════════════════════════════════════

export function deleteVideoClip(state, { clipId, totalDuration }) {
  const { videoClips, segments } = state;
  if (!Array.isArray(videoClips) || videoClips.length === 0) {
    return noop(state, 'No video clips');
  }

  const targetIdx = videoClips.findIndex((c) => c.id === clipId);
  if (targetIdx === -1) {
    return noop(state, `Video clip not found: ${clipId}`);
  }

  const target = videoClips[targetIdx];

  // Guard: this op is for dialogue clips only. Use deleteGap for Gaps.
  if (isGapClip(target)) {
    return noop(state, 'Use deleteGap for Gap clips');
  }

  const targetStart = r3(target.start ?? 0);
  const targetEnd = r3(target.end ?? targetStart);

  // 1. Remove the target and add a replacement Gap
  let remaining = videoClips.filter((c) => c.id !== clipId);

  const gap = {
    id: uid('clip-gap-delete'),
    trackRow: target.trackRow || 0,
    trackId: target.trackId || 'video-1',
    start: targetStart,
    end: targetEnd,
    sourceStart: targetStart,
    sourceEnd: targetEnd,
    name: 'Gap',
    isDialogue: false,
    isMuted: false,
  };
  delete gap.segmentId;
  delete gap.segmentIndex;

  remaining = [...remaining, gap].sort((a, b) => a.start - b.start);

  // 2. Ensure continuous coverage [0, coverageEnd]
  const coverageEnd = remaining.reduce(
    (end, clip) => Math.max(end, Number.isFinite(clip.end) ? clip.end : 0),
    Number.isFinite(totalDuration) ? totalDuration : 0
  );

  const covered = [];
  let cursor = 0;
  remaining.forEach((clip, index) => {
    if (clip.start > cursor + 0.000001) {
      covered.push({
        ...gap,
        id: uid('clip-gap-fill'),
        start: r3(cursor),
        end: r3(clip.start),
        sourceStart: r3(cursor),
        sourceEnd: r3(clip.start),
      });
    }
    covered.push(clip);
    cursor = Math.max(cursor, clip.end);
  });
  if (coverageEnd > cursor + 0.000001) {
    covered.push({
      ...gap,
      id: uid('clip-gap-end'),
      start: r3(cursor),
      end: r3(coverageEnd),
      sourceStart: r3(cursor),
      sourceEnd: r3(coverageEnd),
    });
  }

  // 3. Merge adjacent Gaps
  const merged = covered.reduce((acc, clip) => {
    const prev = acc[acc.length - 1];
    if (isGapClip(prev) && isGapClip(clip) && clip.start <= prev.end + 0.001) {
      acc[acc.length - 1] = {
        ...prev,
        end: Math.max(prev.end, clip.end),
        sourceStart: prev.start,
        sourceEnd: Math.max(prev.end, clip.end),
      };
      delete acc[acc.length - 1].segmentId;
      delete acc[acc.length - 1].segmentIndex;
    } else {
      acc.push(clip);
    }
    return acc;
  }, []);

  return ok({
    videoClips: merged,
    segments: deepClone(segments), // deep-equal (unchanged)
  });
}

// ═══════════════════════════════════════════════════════════════════
//  R3 — deleteGap (film ripple left)
//  Remove Gap; shift later VIDEO clips AND segments that start at or
//  after the Gap's end left by exact Gap duration (D).
//  Segments starting before the Gap's end are untouched (deep-equal).
//  Ids, source times (sourceStartSec/sourceEndSec), and each segment's
//  subtitle stay attached; only timeline times shift.
// ═══════════════════════════════════════════════════════════════════

export function deleteGap(state, { clipId }) {
  const { videoClips, segments } = state;
  if (!Array.isArray(videoClips) || videoClips.length === 0) {
    return noop(state, 'No video clips');
  }

  const targetIdx = videoClips.findIndex((c) => c.id === clipId);
  if (targetIdx === -1) {
    return noop(state, `Gap clip not found: ${clipId}`);
  }

  const target = videoClips[targetIdx];
  if (!isGapClip(target)) {
    return noop(state, 'Clip is not a Gap — use deleteVideoClip for dialogue clips');
  }

  const gapStart = r3(target.start ?? 0);
  const gapEnd = r3(target.end ?? gapStart);
  const dur = r3(Math.max(0, gapEnd - gapStart));

  // Remove the gap and shift later clips left
  let remaining = videoClips.filter((c) => c.id !== clipId);

  const shifted = remaining.map((clip) => {
    if (clip.start < gapEnd - 0.001) return { ...clip }; // before gap: untouched
    const newStart = Math.max(0, r3(clip.start - dur));
    const newEnd = r3(newStart + (clip.end - clip.start));
    return {
      ...clip,
      start: newStart,
      end: newEnd,
    };
  });

  // Sort and merge newly adjacent Gaps
  const sorted = shifted.sort((a, b) => a.start - b.start);
  const merged = sorted.reduce((acc, clip) => {
    const prev = acc[acc.length - 1];
    if (isGapClip(prev) && isGapClip(clip) && clip.start <= prev.end + 0.001) {
      acc[acc.length - 1] = {
        ...prev,
        end: Math.max(prev.end, clip.end),
        sourceStart: prev.start,
        sourceEnd: Math.max(prev.end, clip.end),
      };
      delete acc[acc.length - 1].segmentId;
      delete acc[acc.length - 1].segmentIndex;
    } else {
      acc.push(clip);
    }
    return acc;
  }, []);

  // Ripple segments starting at or after Gap end
  const segs = Array.isArray(segments) ? segments : [];
  const shiftedSegments = segs.map((seg) => {
    const segStart = typeof seg.startSec === 'number' && !isNaN(seg.startSec)
      ? seg.startSec
      : (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)
        ? seg.audioStartSec
        : (typeof seg.start === 'string' ? parseTimeToSeconds(seg.start, 0) : 0));

    // Segments starting before the Gap's end are untouched
    if (segStart < gapEnd - 0.001) {
      return deepClone(seg);
    }

    // Segments starting at or after the Gap's end shift left by dur
    const updated = { ...seg };
    if (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) {
      updated.startSec = Math.max(0, r3(seg.startSec - dur));
    }
    if (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) {
      updated.endSec = Math.max(0, r3(seg.endSec - dur));
    }
    if (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) {
      updated.audioStartSec = Math.max(0, r3(seg.audioStartSec - dur));
    }
    if (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec)) {
      updated.audioEndSec = Math.max(0, r3(seg.audioEndSec - dur));
    }
    if (typeof seg.start === 'string' && typeof updated.startSec === 'number') {
      updated.start = formatMinSec(updated.startSec);
    }
    if (typeof seg.end === 'string' && typeof updated.endSec === 'number') {
      updated.end = formatMinSec(updated.endSec);
    }
    if (typeof seg.startTime === 'string' && typeof updated.startSec === 'number') {
      updated.startTime = formatMinSec(updated.startSec);
    }
    if (typeof seg.endTime === 'string' && typeof updated.endSec === 'number') {
      updated.endTime = formatMinSec(updated.endSec);
    }
    if (typeof seg.audioStart === 'string' && typeof updated.audioStartSec === 'number') {
      updated.audioStart = formatMinSec(updated.audioStartSec);
    }
    if (typeof seg.audioEnd === 'string' && typeof updated.audioEndSec === 'number') {
      updated.audioEnd = formatMinSec(updated.audioEndSec);
    }
    return updated;
  });

  return ok({
    videoClips: merged,
    segments: shiftedSegments,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  R4 — splitClip (video clip at playhead)
//  Cuts the clip under the playhead — dialogue, Gap, or single full-
//  length clip of a fresh episode — whether or not anything is selected.
// ═══════════════════════════════════════════════════════════════════

export function splitClip(state, { splitTime, activeClipId, totalDuration, clipDefaults = {} }) {
  const { videoClips, segments } = state;
  let targetClips = Array.isArray(videoClips) && videoClips.length > 0
    ? [...videoClips]
    : [];

  const roundedSplit = r3(splitTime);

  // Materialize virtual/empty clips for a fresh episode
  const isVirtualOrEmpty = targetClips.length === 0 || (targetClips.length === 1 && (!targetClips[0].end || targetClips[0].end <= targetClips[0].start));

  if (isVirtualOrEmpty) {
    const clipDur = totalDuration > 0 ? totalDuration : Math.max(30, roundedSplit + 10);
    targetClips = [{
      id: uid('clip'),
      start: 0,
      end: clipDur,
      sourceStart: 0,
      sourceEnd: clipDur,
      duration: clipDur,
      name: clipDefaults.name || 'Video Clip',
      trackRow: 0,
      trackId: 'video-1',
      ...clipDefaults,
    }];
  } else if (targetClips.length === 1 && (targetClips[0].start || 0) === 0 && totalDuration > targetClips[0].end && roundedSplit > targetClips[0].end - 0.05) {
    targetClips = [{
      ...targetClips[0],
      end: totalDuration,
      sourceEnd: Math.max(Number(targetClips[0].sourceEnd) || 0, totalDuration),
      duration: totalDuration,
    }];
  }

  if (targetClips.length === 0) {
    return noop(state, 'No video clips to split');
  }

  // Find target clip: prefer activeClipId, then any clip containing splitTime
  let targetIndex = -1;
  if (activeClipId) {
    targetIndex = targetClips.findIndex(
      (c) => c.id === activeClipId && roundedSplit > c.start && roundedSplit < c.end
    );
  }
  if (targetIndex === -1) {
    targetIndex = targetClips.findIndex(
      (c) => roundedSplit > c.start && roundedSplit < c.end
    );
  }
  if (targetIndex === -1) {
    return noop(state, 'គ្មាន clip នៅត្រង់ playhead ទេ');
  }

  const target = targetClips[targetIndex];
  const isGap = isGapClip(target);
  const timelineOffset = roundedSplit - target.start;
  const newSourceSplit = r3(target.sourceStart + timelineOffset);
  const targetRow = typeof target.trackRow === 'number' ? target.trackRow : 0;
  const targetTrackId = target.trackId || `video-${targetRow + 1}`;

  const firstPart = {
    ...target,
    trackRow: targetRow,
    trackId: targetTrackId,
    end: roundedSplit,
    sourceEnd: newSourceSplit,
  };

  const newId = uid('clip');
  const baseName = (target.name || 'Clip').replace(/ \(Part \d+\)$/, '');
  const secondPart = {
    ...target,
    id: newId,
    trackRow: targetRow,
    trackId: targetTrackId,
    start: roundedSplit,
    end: target.end,
    sourceStart: newSourceSplit,
    sourceEnd: target.sourceEnd,
    name: isGap ? 'Gap' : `${baseName} (Part 2)`,
  };

  if (isGap) {
    delete firstPart.segmentId;
    delete firstPart.segmentIndex;
    delete secondPart.segmentId;
    delete secondPart.segmentIndex;
  }

  const updated = [...targetClips];
  updated.splice(targetIndex, 1, firstPart, secondPart);

  return {
    state: {
      videoClips: updated,
      segments: deepClone(segments), // R4: segments unchanged for video split
    },
    applied: true,
    activeClipId: firstPart.id,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  R4 (segment) — splitSegment
//  Only when a segment is explicitly selected and playhead is inside it.
//  Includes Khmer/Chinese/English text splitting logic.
// ═══════════════════════════════════════════════════════════════════

export function splitSegment(state, { segKey, splitTime }) {
  const { videoClips, segments } = state;
  if (!Array.isArray(segments) || segments.length === 0) {
    return noop(state, 'No segments to split');
  }

  const targetIndex = findSegIdx(segments, segKey);
  if (targetIndex === -1) {
    return noop(state, `Segment not found for key: ${segKey}`);
  }

  const targetSeg = segments[targetIndex];
  const roundedSplit = r3(splitTime);

  // Determine effective start/end
  const effectiveStart = typeof targetSeg.audioStartSec === 'number' && !isNaN(targetSeg.audioStartSec)
    ? targetSeg.audioStartSec
    : (typeof targetSeg.startSec === 'number' && !isNaN(targetSeg.startSec)
      ? targetSeg.startSec
      : parseTimeToSeconds(targetSeg.start, 0));

  const effectiveEnd = (() => {
    const isTrimmed = Boolean(targetSeg.audioTrimmed || targetSeg.userTrimmed);
    if (isTrimmed && typeof targetSeg.audioEndSec === 'number' && !isNaN(targetSeg.audioEndSec)) {
      return targetSeg.audioEndSec;
    }
    const audioDur = getSegmentAudioDuration(targetSeg, 0);
    const candidates = [effectiveStart + audioDur];
    if (typeof targetSeg.audioEndSec === 'number' && !isNaN(targetSeg.audioEndSec)) {
      candidates.push(targetSeg.audioEndSec);
    }
    return Math.max(...candidates);
  })();

  // Guard: playhead must be inside the segment
  if (roundedSplit <= effectiveStart + 0.05 || roundedSplit >= effectiveEnd - 0.05) {
    return noop(state, 'Playhead is not inside the selected segment');
  }

  const dur = Math.max(0.2, effectiveEnd - effectiveStart);

  // ── Text splitting ──
  const fullKhmer = (targetSeg.khmerTranslatedText || targetSeg.khmerText || targetSeg.khmer || '').trim();
  let [part1, part2] = splitKhmerTextIntoHalves(fullKhmer);
  if (!part2) {
    const words = fullKhmer.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const ratio = (roundedSplit - effectiveStart) / Math.max(0.1, dur);
      const midWord = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)));
      part1 = words.slice(0, midWord).join(' ');
      part2 = words.slice(midWord).join(' ');
    } else {
      part1 = fullKhmer;
      part2 = fullKhmer;
    }
  }

  // Chinese text
  const fullChinese = (targetSeg.chineseText || targetSeg.originalChineseText || targetSeg.originalText || targetSeg.original || targetSeg.chinese || '').trim();
  let cnPart1 = fullChinese;
  let cnPart2 = '';
  if (fullChinese.length > 4) {
    const ratio = (roundedSplit - effectiveStart) / Math.max(0.1, dur);
    const splitIdx = Math.max(1, Math.min(fullChinese.length - 1, Math.round(fullChinese.length * ratio)));
    const puncts = ['。', '？', '！', '…', '，', '；', '\n'];
    let bestPunctIdx = -1;
    let minPunctDiff = Infinity;
    for (const p of puncts) {
      let pIdx = fullChinese.indexOf(p);
      while (pIdx !== -1) {
        const diff = Math.abs(pIdx + 1 - splitIdx);
        if (diff < minPunctDiff && diff < fullChinese.length * 0.35) {
          minPunctDiff = diff;
          bestPunctIdx = pIdx + 1;
        }
        pIdx = fullChinese.indexOf(p, pIdx + 1);
      }
    }
    const finalCnSplit = bestPunctIdx !== -1 ? bestPunctIdx : splitIdx;
    cnPart1 = fullChinese.slice(0, finalCnSplit).trim();
    cnPart2 = fullChinese.slice(finalCnSplit).trim();
  }

  // English text
  let engPart1 = targetSeg.english || '';
  let engPart2 = targetSeg.english || '';
  if (targetSeg.english) {
    const engWords = targetSeg.english.trim().split(/\s+/).filter(Boolean);
    if (engWords.length >= 2) {
      const ratio = (roundedSplit - effectiveStart) / Math.max(0.1, dur);
      const mid = Math.max(1, Math.min(engWords.length - 1, Math.round(engWords.length * ratio)));
      engPart1 = engWords.slice(0, mid).join(' ');
      engPart2 = engWords.slice(mid).join(' ');
    }
  }

  const dur1 = r2(roundedSplit - effectiveStart);
  const dur2 = r2(effectiveEnd - roundedSplit);
  const hasAudio = Boolean(targetSeg.audioGenerated || targetSeg.audioFile || targetSeg.audioUrl);
  const origOffset = typeof targetSeg.audioOffset === 'number' && !isNaN(targetSeg.audioOffset) ? targetSeg.audioOffset : 0;

  const uid1 = targetSeg._uid ? `${targetSeg._uid}_a` : `seg_${Date.now()}_a_${Math.random().toString(36).substr(2, 4)}`;
  const uid2 = `seg_${Date.now()}_b_${Math.random().toString(36).substr(2, 4)}`;

  const seg1 = {
    ...targetSeg,
    _uid: uid1,
    start: formatMinSec(effectiveStart),
    end: formatMinSec(roundedSplit),
    startSec: effectiveStart,
    endSec: roundedSplit,
    audioStart: formatMinSec(effectiveStart),
    audioEnd: formatMinSec(roundedSplit),
    audioStartSec: effectiveStart,
    audioEndSec: roundedSplit,
    audioOffset: origOffset,
    audioDurationSec: dur1,
    finalAudioDuration: dur1,
    audioDuration: dur1,
    originalAudioDuration: dur1,
    rawAudioDur: dur1,
    audioTrimmed: true,
    userTrimmed: true,
    khmer: part1,
    khmerText: part1,
    khmerTranslatedText: part1,
    chineseText: cnPart1,
    original: cnPart1,
    originalText: cnPart1,
    originalChineseText: cnPart1,
    english: engPart1,
    audioGenerated: hasAudio,
    audioFile: targetSeg.audioFile || null,
    audioPath: targetSeg.audioPath || null,
    audioUrl: targetSeg.audioUrl || null,
    audioFileName: targetSeg.audioFileName || null,
    rawAudioPath: targetSeg.rawAudioPath || null,
    rawAudioFile: targetSeg.rawAudioFile || null,
    audioOutdated: false,
    ttsStatus: targetSeg.ttsStatus || (hasAudio ? 'ready' : 'pending'),
    userShifted: true,
  };

  const seg2 = {
    ...targetSeg,
    _uid: uid2,
    id: uid('seg'),
    start: formatMinSec(roundedSplit),
    end: formatMinSec(effectiveEnd),
    startSec: roundedSplit,
    endSec: effectiveEnd,
    audioStart: formatMinSec(roundedSplit),
    audioEnd: formatMinSec(effectiveEnd),
    audioStartSec: roundedSplit,
    audioEndSec: effectiveEnd,
    audioOffset: r2(origOffset + dur1),
    audioDurationSec: dur2,
    finalAudioDuration: dur2,
    audioDuration: dur2,
    originalAudioDuration: dur2,
    rawAudioDur: dur2,
    audioTrimmed: true,
    userTrimmed: true,
    khmer: part2,
    khmerText: part2,
    khmerTranslatedText: part2,
    chineseText: cnPart2 || cnPart1,
    original: cnPart2 || cnPart1,
    originalText: cnPart2 || cnPart1,
    originalChineseText: cnPart2 || cnPart1,
    english: engPart2,
    audioGenerated: hasAudio,
    audioFile: targetSeg.audioFile || null,
    audioPath: targetSeg.audioPath || null,
    audioUrl: targetSeg.audioUrl || null,
    audioFileName: targetSeg.audioFileName || null,
    rawAudioPath: targetSeg.rawAudioPath || null,
    rawAudioFile: targetSeg.rawAudioFile || null,
    audioOutdated: false,
    ttsStatus: targetSeg.ttsStatus || (hasAudio ? 'ready' : 'pending'),
    userShifted: true,
  };

  const nextSegments = [...segments];
  nextSegments.splice(targetIndex, 1, seg1, seg2);

  // Re-index id/segmentId
  const reindexed = nextSegments.map((item, idx) => ({
    ...item,
    id: idx + 1,
    segmentId: idx + 1,
  }));

  return {
    state: {
      videoClips: deepClone(videoClips), // segments-only split: videoClips unchanged
      segments: reindexed,
    },
    applied: true,
    newSegmentId: uid2,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  trimClip — Trim a video clip or segment start or end
// ═══════════════════════════════════════════════════════════════════

export function trimClip(state, { clipId, edge, newTime, maxSourceDuration = Infinity }) {
  const { videoClips, segments } = state;
  if (clipId === null || clipId === undefined || clipId === '') {
    return noop(state, 'Missing clipId');
  }

  const isStart = edge === 'start' || edge === 'left' || edge === 'trim-left';
  const MIN_CLIP_DURATION = 0.2;

  // 1. Check videoClips
  const videoIndex = Array.isArray(videoClips) ? videoClips.findIndex((c) => c.id === clipId) : -1;
  if (videoIndex !== -1) {
    const clip = ensureClipNums(videoClips[videoIndex]);
    const targetRow = typeof clip.trackRow === 'number' ? clip.trackRow : 0;

    if (isStart) {
      const delta = newTime - clip.start;
      const proposedStart = Math.max(0, newTime);
      const proposedSourceStart = clip.sourceStart + delta;

      if (proposedStart > clip.end - MIN_CLIP_DURATION) return noop(state, 'Trim would make clip too short');
      if (proposedSourceStart < 0) return noop(state, 'Source start would be negative');
      if (proposedSourceStart > clip.sourceEnd - MIN_CLIP_DURATION) return noop(state, 'Source range too narrow');

      // Check overlap with prior clips on same track
      for (let i = 0; i < videoClips.length; i++) {
        if (i === videoIndex) continue;
        const other = ensureClipNums(videoClips[i]);
        const otherRow = typeof other.trackRow === 'number' ? other.trackRow : 0;
        if (otherRow === targetRow && other.end <= clip.start + 0.001) {
          if (proposedStart < other.end - 0.001) {
            return noop(state, `Trim would overlap with clip "${other.name || other.id}"`);
          }
        }
      }

      const nextClips = [...videoClips];
      nextClips[videoIndex] = {
        ...clip,
        start: r3(proposedStart),
        sourceStart: r3(proposedSourceStart),
      };
      return ok({ videoClips: nextClips, segments: deepClone(segments) });
    } else {
      const delta = newTime - clip.end;
      const proposedEnd = Math.max(clip.start + MIN_CLIP_DURATION, newTime);
      const proposedSourceEnd = clip.sourceEnd + delta;

      if (proposedEnd < clip.start + MIN_CLIP_DURATION) return noop(state, 'Trim would make clip too short');
      if (isFinite(maxSourceDuration) && proposedSourceEnd > maxSourceDuration + 0.05) return noop(state, 'Exceeds source duration');
      if (proposedSourceEnd < clip.sourceStart + MIN_CLIP_DURATION) return noop(state, 'Source range too narrow');

      // Check overlap with next clips on same track
      for (let i = 0; i < videoClips.length; i++) {
        if (i === videoIndex) continue;
        const other = ensureClipNums(videoClips[i]);
        const otherRow = typeof other.trackRow === 'number' ? other.trackRow : 0;
        if (otherRow === targetRow && other.start >= clip.end - 0.001) {
          if (proposedEnd > other.start + 0.001) {
            return noop(state, `Trim would overlap with clip "${other.name || other.id}"`);
          }
        }
      }

      const nextClips = [...videoClips];
      nextClips[videoIndex] = {
        ...clip,
        end: r3(proposedEnd),
        sourceEnd: r3(proposedSourceEnd),
      };
      return ok({ videoClips: nextClips, segments: deepClone(segments) });
    }
  }

  // 2. Check segments
  const segIndex = findSegIdx(segments, clipId);

  if (segIndex !== -1) {
    const seg = segments[segIndex];
    if (isStart) {
      const proposedStart = Math.max(0, r2(newTime));
      const currentEnd = typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec)
        ? seg.audioEndSec
        : (typeof seg.endSec === 'number' ? seg.endSec : proposedStart + 0.5);
      if (proposedStart > currentEnd - MIN_CLIP_DURATION) {
        return noop(state, 'Trim would make segment too short');
      }

      const nextSegments = [...segments];
      const newDur = r2(currentEnd - proposedStart);
      nextSegments[segIndex] = {
        ...seg,
        startSec: proposedStart,
        audioStartSec: proposedStart,
        duration: newDur,
        audioDurationSec: newDur,
        start: formatMinSec(proposedStart),
        startTime: formatMinSec(proposedStart),
        audioStart: formatMinSec(proposedStart),
        audioTrimmed: true,
        userTrimmed: true,
      };
      return ok({ videoClips: deepClone(videoClips), segments: nextSegments });
    } else {
      const currentStart = typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)
        ? seg.audioStartSec
        : (typeof seg.startSec === 'number' ? seg.startSec : 0);
      const proposedEnd = r2(newTime);
      if (proposedEnd < currentStart + MIN_CLIP_DURATION) {
        return noop(state, 'Trim would make segment too short');
      }

      const nextSegments = [...segments];
      const newDur = r2(proposedEnd - currentStart);
      nextSegments[segIndex] = {
        ...seg,
        endSec: proposedEnd,
        audioEndSec: proposedEnd,
        duration: newDur,
        audioDurationSec: newDur,
        end: formatMinSec(proposedEnd),
        endTime: formatMinSec(proposedEnd),
        audioEnd: formatMinSec(proposedEnd),
        audioTrimmed: true,
        userTrimmed: true,
      };
      return ok({ videoClips: deepClone(videoClips), segments: nextSegments });
    }
  }

  return noop(state, `Clip or segment not found: ${clipId}`);
}

// ═══════════════════════════════════════════════════════════════════
//  moveClip — Move a video clip or segment along the timeline
// ═══════════════════════════════════════════════════════════════════

export function moveClip(state, { clipId, newStart, trackRow, subTrackRow }) {
  const { videoClips, segments } = state;
  if (clipId === null || clipId === undefined || clipId === '') {
    return noop(state, 'Missing clipId');
  }

  // 1. Check if clipId is in videoClips
  const videoIndex = Array.isArray(videoClips) ? videoClips.findIndex((c) => c.id === clipId) : -1;
  if (videoIndex !== -1) {
    const clip = ensureClipNums(videoClips[videoIndex]);
    const duration = clip.end - clip.start;
    const safeStart = Math.max(0, r3(newStart));
    const safeEnd = r3(safeStart + duration);
    const targetRow = typeof trackRow === 'number' ? Math.max(0, trackRow) : (clip.trackRow || 0);

    // Invariant: a move may not create overlapping clips on the video track (op returns applied:false with reason instead of overlapping)
    for (let i = 0; i < videoClips.length; i++) {
      if (i === videoIndex) continue;
      const other = ensureClipNums(videoClips[i]);
      const otherRow = typeof other.trackRow === 'number' ? other.trackRow : 0;
      if (otherRow === targetRow) {
        if (Math.max(safeStart, other.start) < Math.min(safeEnd, other.end) - 0.001) {
          return noop(state, `Move would overlap with video clip "${other.name || other.id}" at [${other.start}s, ${other.end}s]`);
        }
      }
    }

    const nextClips = [...videoClips];
    nextClips[videoIndex] = {
      ...clip,
      start: safeStart,
      end: safeEnd,
      ...(typeof trackRow === 'number' ? { trackRow: targetRow, trackId: `video-${targetRow + 1}` } : {}),
      // sourceStart and sourceEnd remain unchanged during move
    };

    return ok({
      videoClips: nextClips,
      segments: deepClone(segments),
    });
  }

  // 2. Check if clipId is in segments
  const segIndex = findSegIdx(segments, clipId);

  if (segIndex !== -1) {
    const seg = segments[segIndex];
    const rawDur = typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0
      ? seg.audioDurationSec
      : (typeof seg.duration === 'number' && seg.duration > 0
        ? seg.duration
        : Math.max(0.3, (seg.endSec || 0) - (seg.startSec || 0)));
    const dur = r2(rawDur);
    const safeStart = Math.max(0, r2(newStart));
    const safeEnd = r2(safeStart + dur);
    const targetRow = typeof trackRow === 'number' ? Math.max(0, trackRow) : (seg.trackRow || 0);

    const nextSegments = [...segments];
    nextSegments[segIndex] = {
      ...seg,
      startSec: safeStart,
      endSec: safeEnd,
      duration: dur,
      audioStartSec: safeStart,
      audioEndSec: safeEnd,
      audioDurationSec: dur,
      start: formatMinSec(safeStart),
      end: formatMinSec(safeEnd),
      startTime: formatMinSec(safeStart),
      endTime: formatMinSec(safeEnd),
      audioStart: formatMinSec(safeStart),
      audioEnd: formatMinSec(safeEnd),
      userShifted: true,
      trackRow: targetRow,
      trackId: `voice-${targetRow + 1}`,
      ...(typeof subTrackRow === 'number' ? { subTrackRow: Math.max(0, subTrackRow), userSubShifted: true } : {}),
      // Subtitle belongs to segment and follows the move
    };

    return ok({
      videoClips: deepClone(videoClips),
      segments: nextSegments,
    });
  }

  return noop(state, `Clip or segment not found: ${clipId}`);
}

// ═══════════════════════════════════════════════════════════════════
//  R5 — autoAlign (move-only transform)
//  Hard count guard: segments.length in == out; aborts on mismatch.
//  Single-lane rule: non-userShifted voices on VOICE 1; overruns
//  clamped and flagged audioOverrun.
// ═══════════════════════════════════════════════════════════════════

export function autoAlign(state, { totalDuration, options = {} }) {
  const { videoClips, segments } = state;
  if (!Array.isArray(segments) || segments.length === 0) {
    return noop(state, 'No segments to align');
  }

  const inputCount = segments.length;
  const {
    minGapSec = 0.05,
    maxShiftSec = 0.35,
    maxPlaybackSpeed = 1.45,
  } = options;

  const hasValidVideoEnd = Number.isFinite(totalDuration) && totalDuration > 0;

  // 1. Sort chronologically by canonical subtitle onset
  const sorted = [...segments]
    .map((seg, idx) => {
      const canonicalStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec) && seg.startSec >= 0)
        ? seg.startSec
        : ((typeof seg.sourceStartSec === 'number' && !isNaN(seg.sourceStartSec) && seg.sourceStartSec >= 0)
          ? seg.sourceStartSec
          : parseTimeToSeconds(seg.start ?? seg.startTime, idx * 3.5));

      const canonicalEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec) && seg.endSec > canonicalStart)
        ? seg.endSec
        : ((typeof seg.sourceEndSec === 'number' && !isNaN(seg.sourceEndSec) && seg.sourceEndSec > canonicalStart)
          ? seg.sourceEndSec
          : canonicalStart + 2.2);

      return {
        ...seg,
        _canonicalStart: r2(canonicalStart),
        _canonicalEnd: r2(canonicalEnd),
      };
    })
    .sort((a, b) => a._canonicalStart - b._canonicalStart);

  // 2. Single-Lane Sequential Voice Layout
  const trackLastEnds = {};
  const subTrackLastEnds = { 0: 0, 1: 0, 2: 0 };
  const aligned = [];
  let lastLane0Idx = -1;

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const isUserShifted = Boolean(seg.userShifted);

    let baseStart = seg._canonicalStart;
    if (hasValidVideoEnd && baseStart >= totalDuration - 0.4) {
      baseStart = Math.max(0, r2(totalDuration - 1.2));
    }

    let targetRow = 0;
    let targetStart = baseStart;

    if (isUserShifted && typeof seg.trackRow === 'number') {
      targetRow = Math.max(0, seg.trackRow);
      if (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) {
        targetStart = seg.audioStartSec;
      } else if (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) {
        targetStart = seg.startSec;
      }
    } else {
      targetRow = 0;

      // Resolve overrun on Lane 0
      if (lastLane0Idx >= 0) {
        const prevLane0 = aligned[lastLane0Idx];
        if (prevLane0 && prevLane0.audioEndSec > baseStart) {
          const origAudioDur = getSegmentAudioDuration(
            prevLane0,
            Math.max(0, (prevLane0.audioEndSec || 0) - (prevLane0.audioStartSec || 0))
          );
          const cutDur = prevLane0.audioEndSec - baseStart;
          const cutRatio = (origAudioDur > 0 && cutDur > 0) ? (cutDur / origAudioDur) : 0;

          const clampedEnd = Math.max(
            r2(prevLane0.audioStartSec + 0.05),
            r2(baseStart)
          );
          prevLane0.audioEndSec = clampedEnd;
          prevLane0.endSec = clampedEnd;
          const newDur = r2(Math.max(0.05, prevLane0.audioEndSec - prevLane0.audioStartSec));
          prevLane0.audioDurationSec = newDur;
          prevLane0.duration = newDur;
          prevLane0.audioTrimmed = true;
          if (cutRatio > 0.40) {
            prevLane0.audioOverrun = true;
            prevLane0.overrunRatio = r2(cutRatio);
          } else {
            prevLane0.audioOverrun = false;
            delete prevLane0.overrunRatio;
          }
          prevLane0.end = formatMinSec(prevLane0.audioEndSec);
          prevLane0.audioEnd = formatMinSec(prevLane0.audioEndSec);
          trackLastEnds[0] = prevLane0.audioEndSec;

          if (clampedEnd > targetStart) {
            targetStart = clampedEnd;
          }
        }
      }
    }

    // Determine audio duration
    const fallbackSubtitleSpan = Math.max(0.35, (seg._canonicalEnd || 0) - (seg._canonicalStart || 0));
    const rawAudioDur = getSegmentAudioDuration(seg, fallbackSubtitleSpan);
    let effectiveDur = Math.max(0.35, rawAudioDur);

    let finalEndSec;
    let finalDur;

    if (isUserShifted) {
      finalEndSec = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : ((typeof seg.endSec === 'number' && !isNaN(seg.endSec))
          ? seg.endSec
          : r2(targetStart + effectiveDur));
      finalDur = (typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
        ? seg.audioDurationSec
        : r2(Math.max(0.05, finalEndSec - targetStart));
    } else {
      finalEndSec = r2(Math.min(
        hasValidVideoEnd ? totalDuration : Infinity,
        targetStart + effectiveDur
      ));
      finalDur = r2(Math.max(0.30, finalEndSec - targetStart));
    }

    trackLastEnds[targetRow] = Math.max(trackLastEnds[targetRow] || 0, finalEndSec);
    if (targetRow === 0) lastLane0Idx = aligned.length;

    // Subtitle track row (multi-lane collision avoidance)
    let targetSubRow = 0;
    if (typeof seg.subTrackRow === 'number' && (seg.userSubShifted || (seg.userShifted && seg.subTrackRow > 0))) {
      targetSubRow = Math.max(0, seg.subTrackRow);
    } else {
      if (targetStart >= (subTrackLastEnds[0] || 0) - 0.04) {
        targetSubRow = 0;
      } else if (targetStart >= (subTrackLastEnds[1] || 0) - 0.04) {
        targetSubRow = 1;
      } else if (targetStart >= (subTrackLastEnds[2] || 0) - 0.04) {
        targetSubRow = 2;
      } else {
        const sortedLanes = [0, 1, 2].sort((a, b) => (subTrackLastEnds[a] || 0) - (subTrackLastEnds[b] || 0));
        targetSubRow = sortedLanes[0];
      }
    }
    subTrackLastEnds[targetSubRow] = finalEndSec;

    const cleanSeg = { ...seg };
    delete cleanSeg._canonicalStart;
    delete cleanSeg._canonicalEnd;
    if (cleanSeg.overrunRatio === undefined) {
      delete cleanSeg.overrunRatio;
    }

    const alignedSeg = {
      ...cleanSeg,
      id: seg.id !== undefined ? seg.id : (i + 1),
      segmentId: seg.segmentId !== undefined ? seg.segmentId : (seg.id !== undefined ? seg.id : (i + 1)),
      sourceStartSec: seg.sourceStartSec !== undefined ? seg.sourceStartSec : seg._canonicalStart,
      sourceEndSec: seg.sourceEndSec !== undefined ? seg.sourceEndSec : seg._canonicalEnd,
      startSec: targetStart,
      endSec: finalEndSec,
      duration: finalDur,
      audioStartSec: targetStart,
      audioEndSec: finalEndSec,
      audioDurationSec: finalDur,
      rawAudioDur: effectiveDur,
      audioTrimmed: Boolean(cleanSeg.userTrimmed || cleanSeg.audioTrimmed),
      audioOverrun: Boolean(cleanSeg.audioOverrun),
      trackRow: targetRow,
      trackId: `voice-${targetRow + 1}`,
      subTrackRow: targetSubRow,
      subTrackId: `subs-${targetSubRow + 1}`,
      start: formatMinSec(targetStart),
      end: formatMinSec(finalEndSec),
      startTime: formatMinSec(targetStart),
      endTime: formatMinSec(finalEndSec),
      audioStart: formatMinSec(targetStart),
      audioEnd: formatMinSec(finalEndSec),
      playbackRate: 1.0,
      needsTimeStretch: false,
      userShifted: isUserShifted,
    };
    if (cleanSeg.overrunRatio !== undefined) {
      alignedSeg.overrunRatio = cleanSeg.overrunRatio;
    } else {
      delete alignedSeg.overrunRatio;
    }

    aligned.push(alignedSeg);
  }

  // R5 Hard guard: segment count in == segment count out
  if (aligned.length !== inputCount) {
    return noop(state, `Auto-Align count mismatch (in: ${inputCount}, out: ${aligned.length}). Aborted.`);
  }

  return ok({
    videoClips: deepClone(videoClips), // R5: autoAlign is move-only on segments; videoClips unchanged
    segments: aligned,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  resetTiming — Reset segments to original source timestamps
// ═══════════════════════════════════════════════════════════════════

export function resetTiming(state, { totalDuration }) {
  const { videoClips, segments } = state;
  if (!Array.isArray(segments) || segments.length === 0) {
    return noop(state, 'No segments to reset');
  }

  const hasValidVideoEnd = Number.isFinite(totalDuration) && totalDuration > 0;
  const trackLastEnds = [0, 0];
  const subTrackLastEnds = [0, 0, 0];

  const reset = segments
    .filter((seg) => seg && typeof seg === 'object')
    .map((seg, idx) => {
      const srcStart = (typeof seg.sourceStartSec === 'number' && !isNaN(seg.sourceStartSec) && seg.sourceStartSec >= 0)
        ? seg.sourceStartSec
        : ((typeof seg.startSec === 'number' && !isNaN(seg.startSec) && seg.startSec >= 0)
          ? seg.startSec
          : idx * 3.5);
      const rawSrcEnd = (typeof seg.sourceEndSec === 'number' && !isNaN(seg.sourceEndSec) && seg.sourceEndSec > srcStart)
        ? seg.sourceEndSec
        : ((typeof seg.endSec === 'number' && !isNaN(seg.endSec) && seg.endSec > srcStart)
          ? seg.endSec
          : srcStart + 2.2);

      const safeStart = hasValidVideoEnd ? Math.min(srcStart, Math.max(0, totalDuration - 1.0)) : srcStart;
      const safeEnd = hasValidVideoEnd ? Math.min(totalDuration, Math.max(safeStart + 0.4, rawSrcEnd)) : rawSrcEnd;
      const dur = r2(safeEnd - safeStart);

      const hasAudioFlag = hasSegmentAudio(seg);
      const audioDur = hasAudioFlag ? getSegmentAudioDuration(seg, dur) : dur;
      const audioEndSec = r2(safeStart + audioDur);

      const isUserShifted = Boolean(seg.userShifted);
      const targetRow = (isUserShifted && typeof seg.trackRow === 'number')
        ? Math.max(0, seg.trackRow)
        : 0;
      const effectiveEnd = hasAudioFlag ? audioEndSec : safeEnd;
      trackLastEnds[targetRow] = Math.max(trackLastEnds[targetRow] || 0, effectiveEnd);

      let targetSubRow = 0;
      if (safeStart >= (subTrackLastEnds[0] || 0) - 0.04) {
        targetSubRow = 0;
      } else if (safeStart >= (subTrackLastEnds[1] || 0) - 0.04) {
        targetSubRow = 1;
      } else if (safeStart >= (subTrackLastEnds[2] || 0) - 0.04) {
        targetSubRow = 2;
      } else {
        const sortedLanes = [0, 1, 2].sort((a, b) => (subTrackLastEnds[a] || 0) - (subTrackLastEnds[b] || 0));
        targetSubRow = sortedLanes[0];
      }
      subTrackLastEnds[targetSubRow] = safeEnd;

      const resetSeg = {
        ...seg,
        id: seg.id !== undefined ? seg.id : (idx + 1),
        segmentId: seg.segmentId !== undefined ? seg.segmentId : (seg.id !== undefined ? seg.id : (idx + 1)),
        sourceStartSec: r2(safeStart),
        sourceEndSec: r2(safeEnd),
        startSec: r2(safeStart),
        endSec: r2(safeEnd),
        duration: dur,
        audioStartSec: r2(safeStart),
        audioEndSec: audioEndSec,
        audioDurationSec: audioDur,
        rawAudioDur: hasAudioFlag ? audioDur : undefined,
        audioTrimmed: false,
        audioOverrun: false,
        finalAudioDuration: hasAudioFlag ? audioDur : seg.finalAudioDuration,
        audioDuration: hasAudioFlag ? audioDur : seg.audioDuration,
        trackRow: targetRow,
        trackId: `voice-${targetRow + 1}`,
        subTrackRow: targetSubRow,
        subTrackId: `subs-${targetSubRow + 1}`,
        start: formatMinSec(safeStart),
        end: formatMinSec(safeEnd),
        startTime: formatMinSec(safeStart),
        endTime: formatMinSec(safeEnd),
        audioStart: formatMinSec(safeStart),
        audioEnd: formatMinSec(safeEnd),
        userShifted: isUserShifted,
      };
      delete resetSeg.overrunRatio;
      return resetSeg;
    });

  return ok({
    videoClips: deepClone(videoClips),
    segments: reset,
  });
}
