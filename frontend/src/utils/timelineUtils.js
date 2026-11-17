import {
  parseTimeToSeconds,
  formatMinSec,
} from './timestampUtils.js';
import { isGapClip } from './timelineOps.js';

/**
 * Timeline mathematical and non-linear editing (NLE) data manipulation utilities
 * Supports canonical numeric seconds and strict separation of:
 * - Timeline Placement: [start, end]
 * - Source Media Boundaries: [sourceStart, sourceEnd]
 */

/**
 * Calculates pixels per second for given zoom factor
 * @param {number} zoom - Zoom factor between 0.5 and 3.0
 * @returns {number}
 */
export function getPixelsPerSecond(zoom = 1) {
  return 45 * Math.max(0.5, Math.min(3.0, zoom));
}

/**
 * Normalize and validate a single clip, ensuring canonical numeric timestamps
 * and backward compatibility with legacy saved projects.
 * @param {Object} clip 
 * @param {number} [fallbackDuration=0] 
 * @returns {Object}
 */
export function normalizeClip(clip, fallbackDuration = 0) {
  if (!clip || typeof clip !== 'object') {
    return {
      id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: 'Video Clip',
      start: 0,
      end: Math.max(0.3, fallbackDuration),
      sourceStart: 0,
      sourceEnd: Math.max(0.3, fallbackDuration),
    };
  }

  const rawStart = typeof clip.start === 'number' && !isNaN(clip.start)
    ? clip.start
    : parseTimeToSeconds(clip.start, 0);
  const rawEnd = typeof clip.end === 'number' && !isNaN(clip.end)
    ? clip.end
    : parseTimeToSeconds(clip.end, rawStart + (fallbackDuration || 3.0));

  const start = Math.max(0, parseFloat(rawStart.toFixed(3)));
  const end = Math.max(start + 0.1, parseFloat(rawEnd.toFixed(3)));

  // Backward compatibility: If sourceStart / sourceEnd are missing, inherit from start / end
  const rawSourceStart = typeof clip.sourceStart === 'number' && !isNaN(clip.sourceStart)
    ? clip.sourceStart
    : (typeof clip.source_in === 'number' ? clip.source_in : start);

  const rawSourceEnd = typeof clip.sourceEnd === 'number' && !isNaN(clip.sourceEnd)
    ? clip.sourceEnd
    : (typeof clip.source_out === 'number' ? clip.source_out : (rawSourceStart + (end - start)));

  const sourceStart = Math.max(0, parseFloat(rawSourceStart.toFixed(3)));
  const sourceEnd = Math.max(sourceStart + 0.1, parseFloat(rawSourceEnd.toFixed(3)));

  return {
    ...clip,
    id: clip.id || `clip-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    name: clip.name || 'Video Clip',
    trackRow: typeof clip.trackRow === 'number' ? clip.trackRow : 0,
    trackId: clip.trackId || `video-${(clip.trackRow || 0) + 1}`,
    start,
    end,
    sourceStart,
    sourceEnd,
  };
}

/**
 * Normalize an array of clips and sort them chronologically by timeline start
 * @param {Array} clips 
 * @param {number} [totalDuration=0] 
 * @returns {Array}
 */
export function normalizeClips(clips = [], totalDuration = 0) {
  if (!Array.isArray(clips) || clips.length === 0) {
    if (totalDuration > 0) {
      return [normalizeClip({ id: `clip-${Date.now()}`, start: 0, end: totalDuration }, totalDuration)];
    }
    return [];
  }
  return clips.map((c) => normalizeClip(c, totalDuration)).sort((a, b) => a.start - b.start);
}

/**
 * Map a timeline position (playhead time) to the corresponding source media playback time.
 * Essential for NLE preview: when playing a clip that references source 12s-20s placed at timeline 0s-8s,
 * playhead 2.0s maps to source frame 14.0s.
 * @param {number} timelineTime 
 * @param {Array} clips 
 * @returns {{ inClip: boolean, sourceTime: number|null, clip: Object|null, clipIndex: number, isGap: boolean, nextClip: Object|null }}
 */
export function mapTimelineToSourceTime(timelineTime, clips = []) {
  const safeTime = Number.isFinite(timelineTime) ? Math.max(0, timelineTime) : 0;
  if (!Array.isArray(clips) || clips.length === 0) {
    return { inClip: false, sourceTime: safeTime, clip: null, clipIndex: -1, isGap: false, nextClip: null };
  }

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (isGapClip(c)) continue;
    const cStart = Number.isFinite(c.start) ? c.start : 0;
    const cEnd = Number.isFinite(c.end) ? c.end : (cStart + 0.1);
    const cSourceStart = Number.isFinite(c.sourceStart) ? c.sourceStart : cStart;

    if (safeTime >= cStart && safeTime < cEnd) {
      const offset = safeTime - cStart;
      const calcSource = cSourceStart + offset;
      const sourceTime = Number.isFinite(calcSource) ? parseFloat(calcSource.toFixed(3)) : 0;
      return {
        inClip: true,
        sourceTime,
        clip: c,
        clipIndex: i,
        isGap: false,
        nextClip: null,
      };
    }
  }

  // Not in any dialogue clip -> check if in a gap between clips or before/after
  const nextClip = clips.find((c) => !isGapClip(c) && (Number.isFinite(c?.start) ? c.start : 0) > safeTime) || null;
  return {
    inClip: false,
    sourceTime: null,
    clip: null,
    clipIndex: -1,
    isGap: true,
    nextClip,
  };
}

/**
 * Map a source media timestamp to its timeline position (if present in clips)
 * @param {number} sourceTime 
 * @param {Array} clips 
 * @returns {number|null}
 */
export function mapSourceToTimelineTime(sourceTime, clips = [], fromIndex = 0) {
  if (!Array.isArray(clips) || clips.length === 0) return sourceTime;
  const startIdx = typeof fromIndex === 'number' && fromIndex >= 0 && fromIndex < clips.length ? fromIndex : 0;

  // 1. Check fromIndex
  const cur = clips[startIdx];
  if (cur && !isGapClip(cur) && sourceTime >= cur.sourceStart && sourceTime <= cur.sourceEnd) {
    const offset = sourceTime - cur.sourceStart;
    return parseFloat((cur.start + offset).toFixed(3));
  }

  // 2. Check next clip in timeline order
  if (startIdx + 1 < clips.length) {
    const next = clips[startIdx + 1];
    if (next && !isGapClip(next) && sourceTime >= next.sourceStart && sourceTime <= next.sourceEnd) {
      const offset = sourceTime - next.sourceStart;
      return parseFloat((next.start + offset).toFixed(3));
    }
  }

  // 3. Scan forward in timeline order
  for (let i = startIdx + 2; i < clips.length; i++) {
    const c = clips[i];
    if (c && !isGapClip(c) && sourceTime >= c.sourceStart && sourceTime <= c.sourceEnd) {
      const offset = sourceTime - c.sourceStart;
      return parseFloat((c.start + offset).toFixed(3));
    }
  }

  // 4. Fallback: scan backward if seeked before
  for (let i = startIdx - 1; i >= 0; i--) {
    const c = clips[i];
    if (c && !isGapClip(c) && sourceTime >= c.sourceStart && sourceTime <= c.sourceEnd) {
      const offset = sourceTime - c.sourceStart;
      return parseFloat((c.start + offset).toFixed(3));
    }
  }

  return null;
}



/**
 * Trim a clip's start (in-point) or end (out-point).
 * Updates BOTH timeline placement and source media boundaries.
 * @param {Array} clips 
 * @param {string} clipId 
 * @param {'start'|'end'|'left'|'right'} edge 
 * @param {number} newTime - New proposed timestamp for that edge
 * @param {number} [maxSourceDuration=Infinity] - Total duration of source video file
 * @returns {Array|null}
 */
export function trimClip(clips = [], clipId, edge, newTime, maxSourceDuration = Infinity) {
  if (!Array.isArray(clips) || clips.length === 0 || !clipId) return null;
  const index = clips.findIndex((c) => c.id === clipId);
  if (index === -1) return null;

  const clip = normalizeClip(clips[index]);
  const isStart = edge === 'start' || edge === 'left';
  const MIN_CLIP_DURATION = 0.2;

  if (isStart) {
    // Trimming the left edge (in-point):
    // proposed new timeline start
    const delta = newTime - clip.start;
    const proposedTimelineStart = Math.max(0, newTime);
    const proposedSourceStart = clip.sourceStart + delta;

    // Boundary validations:
    // 1. Must leave at least MIN_CLIP_DURATION
    if (proposedTimelineStart > clip.end - MIN_CLIP_DURATION) return null;
    // 2. Source start must not be negative
    if (proposedSourceStart < 0) return null;
    // 3. Source start cannot exceed source end - MIN_CLIP_DURATION
    if (proposedSourceStart > clip.sourceEnd - MIN_CLIP_DURATION) return null;

    const updatedClip = {
      ...clip,
      start: parseFloat(proposedTimelineStart.toFixed(3)),
      sourceStart: parseFloat(proposedSourceStart.toFixed(3)),
    };

    const nextClips = [...clips];
    nextClips[index] = updatedClip;
    return nextClips;
  } else {
    // Trimming the right edge (out-point):
    // proposed new timeline end
    const delta = newTime - clip.end;
    const proposedTimelineEnd = Math.max(clip.start + MIN_CLIP_DURATION, newTime);
    const proposedSourceEnd = clip.sourceEnd + delta;

    // Boundary validations:
    // 1. Must be after start + MIN_CLIP_DURATION
    if (proposedTimelineEnd < clip.start + MIN_CLIP_DURATION) return null;
    // 2. Source end cannot exceed maximum source media duration
    if (isFinite(maxSourceDuration) && proposedSourceEnd > maxSourceDuration + 0.05) return null;
    // 3. Source end must be greater than source start + MIN_CLIP_DURATION
    if (proposedSourceEnd < clip.sourceStart + MIN_CLIP_DURATION) return null;

    const updatedClip = {
      ...clip,
      end: parseFloat(proposedTimelineEnd.toFixed(3)),
      sourceEnd: parseFloat(proposedSourceEnd.toFixed(3)),
    };

    const nextClips = [...clips];
    nextClips[index] = updatedClip;
    return nextClips;
  }
}

/**
 * Move a clip along the timeline, preserving its duration and source media in/out points.
 * @param {Array} clips 
 * @param {string} clipId 
 * @param {number} newStart - New timeline start position
 * @returns {Array|null}
 */
export function moveClip(clips = [], clipId, newStart) {
  if (!Array.isArray(clips) || clips.length === 0 || !clipId) return null;
  const index = clips.findIndex((c) => c.id === clipId);
  if (index === -1) return null;

  const clip = normalizeClip(clips[index]);
  const duration = clip.end - clip.start;
  const safeStart = Math.max(0, parseFloat(newStart.toFixed(3)));
  const safeEnd = parseFloat((safeStart + duration).toFixed(3));

  const updatedClip = {
    ...clip,
    start: safeStart,
    end: safeEnd,
    // Note: sourceStart and sourceEnd remain unchanged during move
  };

  const nextClips = [...clips];
  nextClips[index] = updatedClip;
  return nextClips;
}

/**
 * Find dialogue segments that belong to a video clip
 * @param {Object} clip - The video clip
 * @param {Array} segments - Array of dialogue segments
 * @returns {Array<number>} - Indices of associated segments in segments array
 */
export function findAssociatedSegmentIndices(clip, segments = []) {
  if (!clip || !Array.isArray(segments) || segments.length === 0) return [];
  
  const clipSourceStart = Number.isFinite(clip.sourceStart) ? clip.sourceStart : (Number.isFinite(clip.start) ? clip.start : 0);
  const clipSourceEnd = Number.isFinite(clip.sourceEnd) ? clip.sourceEnd : (Number.isFinite(clip.end) ? clip.end : clipSourceStart + 0.1);
  const clipSegIdx = Number.isFinite(clip.segmentIndex) ? clip.segmentIndex : null;
  const clipSegId = clip.segmentId ? String(clip.segmentId) : null;

  return segments.map((seg, idx) => {
    if (!seg || typeof seg !== 'object') return -1;
    // 1. Explicit segmentId, segmentIndex or clipId match
    if (seg.clipId && clip.id && String(seg.clipId) === String(clip.id)) {
      return idx;
    }
    if (clipSegId && (String(seg.id) === clipSegId || String(idx + 1) === clipSegId)) {
      return idx;
    }
    if (clipSegIdx !== null && (seg.id === clipSegIdx || seg.id === String(clipSegIdx) || (idx + 1) === clipSegIdx)) {
      return idx;
    }

    // 2. Source timestamp match (only for dialogue clips)
    if (clip.isDialogue !== false) {
      const segSourceStart = Number.isFinite(seg.sourceStartSec) 
        ? seg.sourceStartSec 
        : (Number.isFinite(seg.startSec) ? seg.startSec : parseTimeToSeconds(seg.start, idx * 4));
      
      if (segSourceStart >= clipSourceStart - 0.05 && segSourceStart < clipSourceEnd - 0.05) {
        return idx;
      }
    }

    return -1;
  }).filter(idx => idx !== -1);
}

/**
 * Synchronize dialogue segments when a video clip moves on the timeline.
 * Preserves source media anchors, relative offsets within the clip, and prevents drift.
 * 
 * @param {Object} clip - The video clip being moved
 * @param {number} newStart - The new timeline start position for the clip
 * @param {Array} segments - Array of script/dialogue segments
 * @returns {Array} - New updated segments array (or original if no associated segments)
 */
export function syncSegmentsWithMovedClip(clip, newStartOrClip, segments = []) {
  const newStart = typeof newStartOrClip === 'object' && newStartOrClip !== null
    ? newStartOrClip.start
    : newStartOrClip;
  if (!clip || !Array.isArray(segments) || segments.length === 0 || !Number.isFinite(newStart)) {
    return segments;
  }

  const associatedIndices = findAssociatedSegmentIndices(clip, segments);
  if (associatedIndices.length === 0) {
    return segments;
  }

  const oldClipStart = Number.isFinite(clip.start) ? clip.start : 0;
  const clipSourceStart = Number.isFinite(clip.sourceStart) ? clip.sourceStart : oldClipStart;
  const isRestoringToSource = Math.abs(newStart - clipSourceStart) < 0.05;

  const updatedSegments = [...segments];

  associatedIndices.forEach((segIdx) => {
    const seg = segments[segIdx];
    const origSourceStart = Number.isFinite(seg.sourceStartSec) 
      ? seg.sourceStartSec 
      : (Number.isFinite(seg.startSec) ? seg.startSec : 0);
    const origSourceEnd = Number.isFinite(seg.sourceEndSec) 
      ? seg.sourceEndSec 
      : (Number.isFinite(seg.endSec) ? seg.endSec : origSourceStart + 3.0);
    const segDur = Math.max(0.3, origSourceEnd - origSourceStart);
    const audioDur = Number.isFinite(seg.audioDurationSec) && seg.audioDurationSec > 0
      ? seg.audioDurationSec
      : (Number.isFinite(seg.audioEndSec) && Number.isFinite(seg.audioStartSec) && seg.audioEndSec > seg.audioStartSec ? seg.audioEndSec - seg.audioStartSec : segDur);

    let nextStartSec;
    let nextAudioStartSec;

    if (isRestoringToSource) {
      // Snapping back cleanly to original source media time (0 drift)
      nextStartSec = origSourceStart;
      nextAudioStartSec = origSourceStart;
    } else {
      // Offset relative to clip start
      const offsetInClip = Math.max(0, origSourceStart - clipSourceStart);
      nextStartSec = Math.max(0, parseFloat((newStart + offsetInClip).toFixed(2)));
      nextAudioStartSec = nextStartSec;
    }

    const nextEndSec = parseFloat((nextStartSec + segDur).toFixed(2));
    const nextAudioEndSec = parseFloat((nextAudioStartSec + audioDur).toFixed(2));

    updatedSegments[segIdx] = {
      ...seg,
      sourceStartSec: origSourceStart,
      sourceEndSec: origSourceEnd,
      startSec: nextStartSec,
      endSec: nextEndSec,
      audioStartSec: nextAudioStartSec,
      audioEndSec: nextAudioEndSec,
      start: formatMinSec(nextStartSec),
      end: formatMinSec(nextEndSec),
      audioStart: formatMinSec(nextAudioStartSec),
      audioEnd: formatMinSec(nextAudioEndSec),
      userShifted: true,
    };
  });

  return updatedSegments;
}



/**
 * Test if a segment matches a target identifier (by _uid, id, segmentId, or index).
 * Uses the exact predicate aligned with TimelineTracksCanvas (L246).
 *
 * @param {Object} seg - Segment object
 * @param {string|number} key - Identifier to match (_uid, id, segmentId, or index)
 * @param {number} [idx] - 0-based array index of the segment
 * @returns {boolean}
 */
export function isSegmentMatch(seg, key, idx) {
  if (key === null || key === undefined || !seg) return false;
  const keyStr = String(key).trim();
  // 1. Direct _uid match
  if (seg._uid && String(seg._uid) === keyStr) return true;
  // 2. Direct id match or index match if id not set
  if (seg.id !== undefined && seg.id !== null) {
    if (String(seg.id) === keyStr) return true;
  } else if (typeof idx === 'number' && Number(key) === idx) {
    return true;
  }
  // 3. SegmentId match
  if (seg.segmentId !== undefined && seg.segmentId !== null && String(seg.segmentId) === keyStr) {
    return true;
  }
  // 4. Index match fallback when key is numeric
  if (typeof idx === 'number' && (Number(key) === idx || keyStr === String(idx))) {
    return true;
  }
  return false;
}

/**
 * Find the index of a segment matching key (_uid, id, segmentId, or numeric index).
 *
 * @param {Array} segments
 * @param {string|number} key
 * @returns {number} Index of segment or -1
 */
export function findSegmentIndex(segments, key) {
  if (!Array.isArray(segments) || segments.length === 0 || key === null || key === undefined) {
    return -1;
  }
  const keyStr = String(key).trim();
  // 1. First priority: Match by unique identifiers (_uid, id, segmentId)
  let targetIndex = segments.findIndex((s, idx) => {
    if (s._uid && String(s._uid) === keyStr) return true;
    if (s.id !== undefined && s.id !== null && String(s.id) === keyStr) return true;
    if (s.segmentId !== undefined && s.segmentId !== null && String(s.segmentId) === keyStr) return true;
    return false;
  });

  // 2. Second priority: If key was passed as a number, check 0-based array index
  if (targetIndex === -1 && typeof key === 'number' && !isNaN(key)) {
    if (key >= 0 && key < segments.length) {
      targetIndex = key;
    }
  }

  // 3. Third priority: String numeric index fallback
  if (targetIndex === -1 && /^\d+$/.test(keyStr)) {
    const num = parseInt(keyStr, 10);
    if (num >= 0 && num < segments.length) {
      targetIndex = num;
    }
  }

  return targetIndex;
}



/**
 * Bridge / close eligible gaps between video clips by shifting subsequent clips left.
 * Preserves source media in/out points.
 * @param {Array} clips 
 * @param {number} [maxGapThreshold=Infinity] - Max gap duration in seconds to close
 * @returns {Array}
 */
export function bridgeClipGaps(clips = [], maxGapThreshold = Infinity) {
  if (!Array.isArray(clips) || clips.length === 0) return [];
  const sorted = [...clips].sort((a, b) => a.start - b.start);

  // Snap first clip to 0 if there is a leading gap at the start of the timeline!
  const leadOffset = sorted[0].start > 0.04 ? sorted[0].start : 0;
  const firstDur = sorted[0].end - sorted[0].start;
  const firstStart = Math.max(0, parseFloat((sorted[0].start - leadOffset).toFixed(3)));
  const bridged = [{
    ...sorted[0],
    start: firstStart,
    end: parseFloat((firstStart + firstDur).toFixed(3)),
  }];

  for (let i = 1; i < sorted.length; i++) {
    const prev = bridged[i - 1];
    const curr = sorted[i];
    const shiftedCurrStart = Math.max(0, curr.start - leadOffset);
    const gap = shiftedCurrStart - prev.end;

    if (gap > 0.04 && gap <= maxGapThreshold) {
      // Shift current clip to touch previous clip's end
      const dur = curr.end - curr.start;
      const newStart = prev.end;
      const newEnd = parseFloat((newStart + dur).toFixed(3));
      bridged.push({
        ...curr,
        start: newStart,
        end: newEnd,
      });
    } else {
      const dur = curr.end - curr.start;
      bridged.push({
        ...curr,
        start: shiftedCurrStart,
        end: parseFloat((shiftedCurrStart + dur).toFixed(3)),
      });
    }
  }

  // Strip segmentId and segmentIndex from any Gap clip in bridged
  return bridged.map((c) => {
    const isGap = c.name === 'Gap' || c.isDialogue === false || (c.id && String(c.id).startsWith('clip-gap'));
    if (isGap) {
      const copy = { ...c };
      delete copy.segmentId;
      delete copy.segmentIndex;
      return copy;
    }
    return c;
  });
}

/**
 * Auto-split video track into separate clips matching each dialogue/subtitle segment (CapCut style)
 * Assigns valid sourceStart and sourceEnd for each clip.
 * @param {Array} segments - Array of script segments with start/end
 * @param {number} totalDuration - Total video duration in seconds
 * @param {string} [videoName='Video'] - Original video name
 * @returns {Array} - Array of split video clips
 */
export function autoSplitVideoBySegments(segments = [], totalDuration = 0, videoName = 'Video') {
  if (!segments || segments.length === 0 || totalDuration <= 0) return [];

  // Parse segments into sorted numeric intervals (prioritizing canonical numeric seconds)
  const intervals = segments.map((seg, idx) => {
    if (!seg || typeof seg !== 'object') return { start: 0, end: 0 };
    const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec
      : ((typeof seg.startSec === 'number' && !isNaN(seg.startSec))
          ? seg.startSec
          : parseTimeToSeconds(seg.audioStart ?? seg.start, idx * 3.5));
    const rawEnd = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
      ? seg.audioEndSec
      : ((typeof seg.endSec === 'number' && !isNaN(seg.endSec))
          ? seg.endSec
          : parseTimeToSeconds(seg.audioEnd ?? seg.end, rawStart + 3.0));
    const start = Math.max(0, Math.min(totalDuration, rawStart));
    const end = Math.max(start + 0.3, Math.min(totalDuration, rawEnd));

    return {
      start: parseFloat(start.toFixed(2)),
      end: parseFloat(end.toFixed(2)),
      speaker: seg.speaker || `Line #${idx + 1}`,
      khmer: seg.khmer || '',
      index: idx + 1,
      id: seg.id || idx + 1,
    };
  }).filter((s) => s.end > s.start);

  if (intervals.length === 0) return [];

  const sortedIntervals = [...intervals].sort((a, b) => a.start - b.start);
  const clips = [];
  let curTime = 0;

  sortedIntervals.forEach((it, idx) => {
    // If dialogue overlaps into previous clip (it.start < curTime):
    // In video editing on a single track, dialogue clip N cuts to dialogue clip N+1 when speaker N+1 begins.
    // Clamp the previous clip's end to it.start so video cuts cleanly at dialogue onset with 0 overlap.
    if (it.start < curTime) {
      const prevClip = clips[clips.length - 1];
      if (prevClip) {
        const adjustedEnd = Math.max(prevClip.start + 0.2, it.start);
        prevClip.end = parseFloat(adjustedEnd.toFixed(2));
        prevClip.sourceEnd = parseFloat(adjustedEnd.toFixed(2));
        curTime = adjustedEnd;
      }
    }

    // If there is an introductory or dialogue gap
    if (it.start > curTime + 0.15) {
      const gapStart = parseFloat(curTime.toFixed(2));
      const gapEnd = parseFloat(it.start.toFixed(2));
      const gapClip = {
        id: `clip-gap-${Date.now()}-${idx}`,
        trackRow: 0,
        trackId: 'video-1',
        start: gapStart,
        end: gapEnd,
        sourceStart: gapStart,
        sourceEnd: gapEnd,
        name: 'Gap',
        isDialogue: false,
        isMuted: false,
      };
      delete gapClip.segmentId;
      delete gapClip.segmentIndex;
      clips.push(gapClip);
      curTime = gapEnd;
    }

    const clipStart = parseFloat(curTime.toFixed(2));
    const nextIt = sortedIntervals[idx + 1];
    let rawClipEnd = it.end;
    // If the next speaker interrupts / overlaps before current speaker finishes:
    if (nextIt && nextIt.start < rawClipEnd) {
      rawClipEnd = Math.max(clipStart + 0.2, nextIt.start);
    }
    const clipEnd = parseFloat(Math.min(totalDuration, Math.max(clipStart + 0.2, rawClipEnd)).toFixed(2));

    // Video clip matching this dialogue line (Auto-Cut only cuts — never mutes)
    clips.push({
      id: `clip-seg-${Date.now()}-${idx}`,
      trackRow: 0,
      trackId: 'video-1',
      start: clipStart,
      end: clipEnd,
      sourceStart: clipStart,
      sourceEnd: clipEnd,
      name: `#${it.index} ${it.speaker}`,
      isDialogue: true,
      segmentIndex: it.index,
      segmentId: it.id || it.index,
      isMuted: false,
    });

    curTime = clipEnd;
  });

  // Outro clip if video continues past last segment
  if (totalDuration > curTime + 0.15) {
    const outroStart = parseFloat(curTime.toFixed(2));
    const outroEnd = parseFloat(totalDuration.toFixed(2));
    const outroClip = {
      id: `clip-outro-${Date.now()}`,
      trackRow: 0,
      trackId: 'video-1',
      start: outroStart,
      end: outroEnd,
      sourceStart: outroStart,
      sourceEnd: outroEnd,
      name: 'Outro',
      isDialogue: false,
      isMuted: false,
    };
    delete outroClip.segmentId;
    delete outroClip.segmentIndex;
    clips.push(outroClip);
  }

  return clips;
}

/**
 * Preserves segment identifiers and fills missing IDs while ensuring React keys exist
 */
export function sanitizeScriptData(scriptData) {
  if (!scriptData) return scriptData;
  if (!Array.isArray(scriptData.segments)) return scriptData;
  const sanitizedSegments = scriptData.segments
    .filter((seg) => seg && typeof seg === 'object')
    .map((seg, idx) => {
      const cn = (seg.chineseText || seg.originalChineseText || seg.originalText || seg.original || seg.chinese || '').trim();
      return {
        ...seg,
        id: seg.id ?? seg.segmentId ?? idx + 1,
        segmentId: seg.segmentId ?? seg.id ?? idx + 1,
        chineseText: cn,
        originalChineseText: cn,
        originalText: cn,
        original: cn,
        _uid: seg._uid || `seg_${idx + 1}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      };
    });
  return {
    ...scriptData,
    segments: sanitizedSegments,
  };
}

/**
 * Deterministically resolves the dialogue segment at a target timeline time.
 * Uses half-open interval [start, end) to strictly prevent boundary collisions between adjacent segments.
 * Returns null if targetTime falls in a gap (silence) between segments.
 */
export function resolveSegmentAtTime(segments, targetTime) {
  if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(targetTime)) return null;

  // Find segments where targetTime is within canonical [startSec, endSec)
  const matches = segments.filter((seg) => {
    if (!seg || typeof seg !== 'object') return false;
    const s = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
      ? seg.startSec
      : ((typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : (parseTimeToSeconds ? parseTimeToSeconds(seg.start ?? seg.startTime, 0) : 0));
    const dur = (typeof seg.duration === 'number' && seg.duration > 0)
      ? seg.duration
      : ((typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0)
        ? seg.audioDurationSec
        : 2.5);
    const e = (typeof seg.endSec === 'number' && !isNaN(seg.endSec))
      ? seg.endSec
      : ((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : (parseTimeToSeconds ? parseTimeToSeconds(seg.end ?? seg.endTime, s + dur) : s + dur));

    // Half-open interval: s <= targetTime < e (boundary edge belongs to subsequent segment)
    return targetTime >= s && targetTime < (e - 0.001);
  });

  if (matches.length > 0) {
    // If overlaps exist, select the segment with latest start time
    return matches.reduce((latest, s) => {
      const sStart = (typeof s.startSec === 'number' && !isNaN(s.startSec))
        ? s.startSec
        : ((typeof s.audioStartSec === 'number' && !isNaN(s.audioStartSec)) ? s.audioStartSec : 0);
      const latestStart = (typeof latest.startSec === 'number' && !isNaN(latest.startSec))
        ? latest.startSec
        : ((typeof latest.audioStartSec === 'number' && !isNaN(latest.audioStartSec)) ? latest.audioStartSec : 0);
      return sStart >= latestStart ? s : latest;
    }, matches[0]);
  }

  // Fallback for exact terminal boundary of the very last segment
  const lastMatch = segments.find((seg) => {
    const s = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
      ? seg.startSec
      : ((typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : 0);
    const dur = (typeof seg.duration === 'number' && seg.duration > 0)
      ? seg.duration
      : ((typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0) ? seg.audioDurationSec : 2.5);
    const e = (typeof seg.endSec === 'number' && !isNaN(seg.endSec))
      ? seg.endSec
      : ((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec)) ? seg.audioEndSec : s + dur);
    return Math.abs(targetTime - e) <= 0.015 && targetTime >= s;
  });

  return lastMatch || null;
}

/**
 * Resolve the exact timeline start timestamp (in seconds) of a segment's VOICE clip.
 * Matches VOICE track rendering priority: audioStartSec -> startSec -> parsed string start -> fallback idx * 4.
 *
 * @param {Object} seg
 * @param {number} [idx=0]
 * @returns {number} Non-negative start seconds
 */
export function resolveVoiceClipStartSec(seg, idx = 0) {
  if (!seg || typeof seg !== 'object') return 0;
  const safeIdx = Number.isFinite(idx) && idx >= 0 ? idx : 0;
  if (typeof seg.audioStartSec === 'number' && Number.isFinite(seg.audioStartSec)) {
    return Math.max(0, seg.audioStartSec);
  }
  if (typeof seg.startSec === 'number' && Number.isFinite(seg.startSec)) {
    return Math.max(0, seg.startSec);
  }
  const rawStr = seg.audioStart ?? seg.start ?? seg.startTime;
  return Math.max(0, parseTimeToSeconds(rawStr, safeIdx * 4));
}

/**
 * Computes the horizontal scrollLeft needed to center a timeline timestamp inside the track viewport.
 * Matches TimelineEditor viewport geometry (including sticky track header offset).
 *
 * @param {number} timeSec
 * @param {number} pixelsPerSecond
 * @param {number} clientWidth
 * @param {number} [trackHeaderWidth=112]
 * @returns {number}
 */
export function computeTimelineScrollForTime(timeSec, pixelsPerSecond, clientWidth, trackHeaderWidth = 112) {
  const safeTime = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
  const safePps = Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0 ? pixelsPerSecond : 45;
  const safeWidth = Number.isFinite(clientWidth) && clientWidth > 0 ? clientWidth : 0;
  if (safeWidth <= 0) return 0;

  const playheadAbsoluteX = safeTime * safePps + trackHeaderWidth;
  const centerThreshold = safeWidth / 2;
  return playheadAbsoluteX > centerThreshold
    ? Math.max(0, Math.round(playheadAbsoluteX - centerThreshold))
    : 0;
}

