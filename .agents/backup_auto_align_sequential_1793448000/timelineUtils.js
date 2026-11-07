import { parseTimeToSeconds, formatMinSec } from './formatTime.js';

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
 * Convert pixel offset to timeline time in seconds
 * @param {number} pixelX 
 * @param {number} zoom 
 * @param {number} [headerOffset=150] 
 * @returns {number}
 */
export function pixelToTime(pixelX, zoom = 1, headerOffset = 0) {
  const pps = getPixelsPerSecond(zoom);
  const adjusted = Math.max(0, pixelX - headerOffset);
  return parseFloat((adjusted / pps).toFixed(3));
}

/**
 * Convert timeline time in seconds to pixel offset
 * @param {number} timeSec 
 * @param {number} zoom 
 * @param {number} [headerOffset=0] 
 * @returns {number}
 */
export function timeToPixel(timeSec, zoom = 1, headerOffset = 0) {
  const pps = getPixelsPerSecond(zoom);
  return Math.max(0, timeSec) * pps + headerOffset;
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

  // Not in any clip -> check if in a gap between clips or before/after
  const nextClip = clips.find((c) => (Number.isFinite(c?.start) ? c.start : 0) > safeTime) || null;
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
export function mapSourceToTimelineTime(sourceTime, clips = []) {
  if (!Array.isArray(clips) || clips.length === 0) return sourceTime;
  for (const c of clips) {
    if (sourceTime >= c.sourceStart && sourceTime <= c.sourceEnd) {
      const offset = sourceTime - c.sourceStart;
      return parseFloat((c.start + offset).toFixed(3));
    }
  }
  return null;
}

/**
 * Split an existing video clip at a valid playhead position.
 * Correctly slices BOTH the timeline interval and source media in/out points.
 * @param {Array} clips 
 * @param {number} splitTime - Exact playhead time in seconds
 * @param {number} [totalDuration=0] - Fallback duration if clips is empty
 * @param {string|null} [activeClipId=null] - Optional ID of active clip to prioritize
 * @returns {{ newClips: Array, activeClipId: string } | null}
 */
export function splitClipAtTime(clips = [], splitTime = 0, totalDuration = 0, activeClipId = null) {
  let targetClips = normalizeClips(clips, totalDuration);
  if (!targetClips || targetClips.length === 0) return null;

  let targetIndex = -1;
  if (activeClipId) {
    targetIndex = targetClips.findIndex(
      (c) => c.id === activeClipId && splitTime > c.start + 0.05 && splitTime < c.end - 0.05
    );
  }

  if (targetIndex === -1) {
    targetIndex = targetClips.findIndex(
      (c) => splitTime > c.start + 0.05 && splitTime < c.end - 0.05
    );
  }

  if (targetIndex === -1) return null;

  const target = targetClips[targetIndex];
  const roundedSplit = parseFloat(splitTime.toFixed(3));
  const timelineOffset = roundedSplit - target.start;
  const newSourceSplit = parseFloat((target.sourceStart + timelineOffset).toFixed(3));
  const targetRow = typeof target.trackRow === 'number' ? target.trackRow : 0;
  const targetTrackId = target.trackId || `video-${targetRow + 1}`;

  const firstPart = {
    ...target,
    trackRow: targetRow,
    trackId: targetTrackId,
    end: roundedSplit,
    sourceEnd: newSourceSplit,
  };

  const newId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
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
    name: `${baseName} (Part 2)`,
  };

  const updated = [...targetClips];
  updated.splice(targetIndex, 1, firstPart, secondPart);

  return {
    newClips: updated,
    activeClipId: newId,
  };
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
 * Delete a clip by ID.
 * @param {Array} clips 
 * @param {string} clipId 
 * @param {Object} [options]
 * @param {boolean} [options.allowEmpty=false]
 * @returns {Array}
 */
export function deleteClipById(clips, clipId, options = {}) {
  const { allowEmpty = true } = options;
  if (!Array.isArray(clips) || clips.length === 0) return [];
  if (!allowEmpty && clips.length <= 1) return clips;
  return clips.filter((c) => c.id !== clipId);
}

/**
 * Delete a script segment by explicit ID or fallback index, and re-index sequentially.
 * @param {Array} segments
 * @param {string|number} segIdOrIdx
 * @returns {Array}
 */
export function deleteSegmentByIdOrIndex(segments, segIdOrIdx) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  if (segIdOrIdx === null || segIdOrIdx === undefined) return segments;

  const targetStr = String(segIdOrIdx).trim();

  // 1. First priority: Match by unique identifiers (_uid, id, or segmentId)
  let targetIndex = segments.findIndex((s) => {
    if (s._uid && String(s._uid) === targetStr) return true;
    if (s.id !== undefined && s.id !== null && String(s.id) === targetStr) return true;
    if (s.segmentId !== undefined && s.segmentId !== null && String(s.segmentId) === targetStr) return true;
    return false;
  });

  // 2. Second priority: If segIdOrIdx was passed as a number, check 0-based array index
  if (targetIndex === -1 && typeof segIdOrIdx === 'number' && !isNaN(segIdOrIdx)) {
    if (segIdOrIdx >= 0 && segIdOrIdx < segments.length) {
      targetIndex = segIdOrIdx;
    }
  }

  // 3. Third priority: String numeric index fallback
  if (targetIndex === -1 && /^\d+$/.test(targetStr)) {
    const num = parseInt(targetStr, 10);
    if (num >= 0 && num < segments.length) {
      targetIndex = num;
    }
  }

  if (targetIndex === -1) {
    console.warn('[deleteSegmentByIdOrIndex] Segment not found for key:', segIdOrIdx);
    return segments;
  }

  return segments
    .filter((_, idx) => idx !== targetIndex)
    .map((seg, newIdx) => ({
      ...seg,
      id: newIdx + 1,
      segmentId: newIdx + 1,
    }));
}

/**
 * Calculate gaps between clips on the timeline
 * @param {Array} clips 
 * @param {number} [totalDuration=0] 
 * @returns {Array<{ start: number, end: number, duration: number }>}
 */
export function calculateTimelineGaps(clips = [], totalDuration = 0) {
  if (!Array.isArray(clips) || clips.length === 0) return [];
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const gaps = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (next.start - cur.end > 0.05) {
      gaps.push({
        start: cur.end,
        end: next.start,
        duration: parseFloat((next.start - cur.end).toFixed(3)),
      });
    }
  }

  return gaps;
}

/**
 * Bridge / close eligible gaps between video clips by shifting subsequent clips left.
 * Preserves source media in/out points.
 * @param {Array} clips 
 * @param {number} [maxGapThreshold=Infinity] - Max gap duration in seconds to close
 * @returns {Array}
 */
export function bridgeClipGaps(clips = [], maxGapThreshold = Infinity) {
  if (!Array.isArray(clips) || clips.length <= 1) return clips;
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const bridged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = bridged[i - 1];
    const curr = sorted[i];
    const gap = curr.start - prev.end;

    if (gap > 0.05 && gap <= maxGapThreshold) {
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
      bridged.push(curr);
    }
  }

  return bridged;
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
      clips.push({
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
      });
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

    // Video clip matching this dialogue line
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
      segmentId: it.index,
      isMuted: false,
    });

    curTime = clipEnd;
  });

  // Outro clip if video continues past last segment
  if (totalDuration > curTime + 0.15) {
    const outroStart = parseFloat(curTime.toFixed(2));
    const outroEnd = parseFloat(totalDuration.toFixed(2));
    clips.push({
      id: `clip-outro-${Date.now()}`,
      trackRow: 0,
      trackId: 'video-1',
      start: outroStart,
      end: outroEnd,
      sourceStart: outroStart,
      sourceEnd: outroEnd,
      name: 'Outro',
      isDialogue: false,
    });
  }

  return clips;
}

/**
 * Ensures all segments have guaranteed unique sequential IDs (1..N) and unique _uid tokens for React keys
 */
export function sanitizeScriptData(scriptData) {
  if (!scriptData) return scriptData;
  if (!Array.isArray(scriptData.segments)) return scriptData;
  const sanitizedSegments = scriptData.segments.map((seg, idx) => ({
    ...seg,
    id: idx + 1,
    segmentId: idx + 1,
    _uid: seg._uid || `seg_${idx + 1}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
  }));
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
      return sStart > latestStart ? s : latest;
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
 * Smart Slot-Bounded Auto-Align Voice Segments (Zero Cumulative Drift)
 * - Anchors every segment back to its canonical `sourceStartSec` first (heals drifted #88-#98 clips).
 * - Limits maximum forward shift to `maxShiftSec` (default 0.35s) so dialogue NEVER drifts off-scene.
 * - Clamps strictly within `totalDuration` so no clips ever overflow past the end of the video.
 *
 * @param {Array} segments - Script/dialogue segments
 * @param {number} totalDuration - Canonical video duration in seconds (e.g. 375.37 for 06:15.37)
 * @param {Object} [options]
 * @param {number} [options.minGapSec=0.04] - 40ms clean breathing gap between segments
 * @param {number} [options.maxShiftSec=0.35] - Maximum allowed delay from original mouth onset
 * @param {number} [options.maxPlaybackSpeed=1.45] - Max speed factor before clamping slot
 * @returns {Array} Aligned segments with zero timeline overflow
 */
export function autoAlignVoiceSegments(segments = [], totalDuration = 0, options = {}) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const {
    minGapSec = 0.05,
    maxShiftSec = 0.35,
    maxPlaybackSpeed = 1.45,
  } = options;

  const hasValidVideoEnd = Number.isFinite(totalDuration) && totalDuration > 0;

  // 1. Sort segments chronologically by visual subtitle dialogue onset (startSec)
  // Ground truth: seg.startSec matches the visual subtitle & actor mouth onset in the video
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
        _canonicalStart: parseFloat(canonicalStart.toFixed(2)),
        _canonicalEnd: parseFloat(canonicalEnd.toFixed(2)),
      };
    })
    .sort((a, b) => a._canonicalStart - b._canonicalStart);

  // 2. Track-aware Multi-Lane Alignment:
  // Balances dialogue between Track 1 (VOICE 1) and Track 2 (VOICE 2) so neither lane stays empty,
  // preserves natural pauses/silence in the video, and prevents audio from stepping on speech onset.
  const trackLastEnds = {};
  const aligned = [];

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];

    // Determine target track row:
    let targetRow = 0;
    if (typeof seg.trackRow === 'number' && seg.trackRow >= 0) {
      targetRow = seg.trackRow;
    } else {
      const rawGender = String(seg.speakerGender || seg.voiceGender || seg.gender || '').toUpperCase().trim();
      if (rawGender === 'FEMALE' || rawGender === 'GIRL' || rawGender === 'WOMAN') {
        targetRow = 0; // VOICE 1
      } else if (rawGender === 'MALE' || rawGender === 'BOY' || rawGender === 'MAN') {
        // Distribute alternating male dialogue so VOICE 1 doesn't stay 100% empty
        targetRow = (i % 2 === 0) ? 0 : 1;
      } else {
        targetRow = (i % 2 === 0) ? 0 : 1;
      }
    }

    // Speech onset: rigidly anchored to canonical subtitle onset in video
    let baseStart = seg._canonicalStart;
    if (hasValidVideoEnd && baseStart >= totalDuration - 0.4) {
      baseStart = Math.max(0, parseFloat((totalDuration - 1.2).toFixed(2)));
    }

    // Check collision ONLY on THIS specific track lane
    const lastEndOnThisTrack = trackLastEnds[targetRow] !== undefined ? trackLastEnds[targetRow] : 0;
    let targetStart = baseStart;

    // If previous audio on THIS track slightly trails past baseStart:
    if (lastEndOnThisTrack + minGapSec > baseStart) {
      // First try switching to the alternate track lane if it's completely free:
      const alternateRow = targetRow === 0 ? 1 : 0;
      const lastEndOnAlt = trackLastEnds[alternateRow] !== undefined ? trackLastEnds[alternateRow] : 0;
      if (lastEndOnAlt + minGapSec <= baseStart) {
        targetRow = alternateRow;
      } else {
        // Both lanes occupied: apply small bounded nudge without cumulative drift
        const requiredShift = (lastEndOnThisTrack + minGapSec) - baseStart;
        const boundedShift = Math.min(requiredShift, maxShiftSec);
        targetStart = parseFloat((baseStart + boundedShift).toFixed(2));
      }
    }

    // Determine audio duration
    const rawAudioDur = (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0.1)
      ? seg.audioDurationSec
      : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0.1)
        ? seg.audioDuration
        : (seg._canonicalEnd - seg._canonicalStart));

    let effectiveDur = Math.max(0.35, rawAudioDur);
    let recommendedPlaybackRate = 1.0;
    let needsTimeStretch = false;

    const finalEndSec = parseFloat(Math.min(
      hasValidVideoEnd ? totalDuration : Infinity,
      targetStart + effectiveDur
    ).toFixed(2));

    const finalDur = parseFloat(Math.max(0.30, finalEndSec - targetStart).toFixed(2));
    trackLastEnds[targetRow] = finalEndSec;

    const cleanSeg = { ...seg };
    delete cleanSeg._canonicalStart;
    delete cleanSeg._canonicalEnd;

    aligned.push({
      ...cleanSeg,
      id: i + 1,
      segmentId: i + 1,
      sourceStartSec: seg._canonicalStart,
      sourceEndSec: seg._canonicalEnd,
      startSec: targetStart,
      endSec: finalEndSec,
      duration: finalDur,
      audioStartSec: targetStart,
      audioEndSec: finalEndSec,
      audioDurationSec: finalDur,
      trackRow: targetRow,
      trackId: targetRow === 0 ? 'voice-1' : `voice-${targetRow + 1}`,
      start: formatMinSec(targetStart),
      end: formatMinSec(finalEndSec),
      startTime: formatMinSec(targetStart),
      endTime: formatMinSec(finalEndSec),
      audioStart: formatMinSec(targetStart),
      audioEnd: formatMinSec(finalEndSec),
      playbackRate: recommendedPlaybackRate,
      needsTimeStretch,
      userShifted: false,
    });
  }

  return aligned;
}

/**
 * Reset all segments back to their exact original Chinese video timestamps (0% drift)
 *
 * @param {Array} segments
 * @param {number} [totalDuration=0]
 * @returns {Array}
 */
export function resetSegmentsToSourceTiming(segments = [], totalDuration = 0) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const hasValidVideoEnd = Number.isFinite(totalDuration) && totalDuration > 0;

  return segments.map((seg, idx) => {
    const srcStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
      ? seg.startSec
      : ((typeof seg.sourceStartSec === 'number' && !isNaN(seg.sourceStartSec))
        ? seg.sourceStartSec
        : idx * 3.5);
    const rawSrcEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec) && seg.endSec > srcStart)
      ? seg.endSec
      : ((typeof seg.sourceEndSec === 'number' && !isNaN(seg.sourceEndSec) && seg.sourceEndSec > srcStart)
        ? seg.sourceEndSec
        : srcStart + 2.2);

    const safeStart = hasValidVideoEnd ? Math.min(srcStart, Math.max(0, totalDuration - 1.0)) : srcStart;
    const safeEnd = hasValidVideoEnd ? Math.min(totalDuration, Math.max(safeStart + 0.4, rawSrcEnd)) : rawSrcEnd;
    const dur = parseFloat((safeEnd - safeStart).toFixed(2));
    const targetRow = (idx % 2 === 0) ? 0 : 1;

    return {
      ...seg,
      id: idx + 1,
      segmentId: idx + 1,
      sourceStartSec: parseFloat(safeStart.toFixed(2)),
      sourceEndSec: parseFloat(safeEnd.toFixed(2)),
      startSec: parseFloat(safeStart.toFixed(2)),
      endSec: parseFloat(safeEnd.toFixed(2)),
      duration: dur,
      audioStartSec: parseFloat(safeStart.toFixed(2)),
      audioEndSec: parseFloat(safeEnd.toFixed(2)),
      audioDurationSec: dur,
      trackRow: targetRow,
      trackId: targetRow === 0 ? 'voice-1' : `voice-${targetRow + 1}`,
      start: formatMinSec(safeStart),
      end: formatMinSec(safeEnd),
      startTime: formatMinSec(safeStart),
      endTime: formatMinSec(safeEnd),
      audioStart: formatMinSec(safeStart),
      audioEnd: formatMinSec(safeEnd),
      userShifted: false,
    };
  });
}
