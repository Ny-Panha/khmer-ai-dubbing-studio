const { formatSecondsToTimecode, validateStrictSourceCueMapping } = require('../pipelineTypes');

/**
 * Stage 8: Validate Subtitle Timing
 * Validates start and end against actual media duration, calculates available slotDuration
 * (nextSegment.sourceStartSec - currentSegment.sourceStartSec) to guide TTS atempo auto-stretch,
 * rejects 0.01s micro-durations without blind 1.8s padding, deduplicates duplicate speech starts,
 * prevents overlapping/stale persistence, and flags uncertain cases.
 * 
 * @param {object} params
 * @param {Array} params.segments
 * @param {Array|null} [params.sourceCues=null]
 * @param {number} params.durationSec - Total video duration
 * @returns {Promise<{ timedSegments: Array, timingReport: object }>}
 */
async function validateSubtitleTiming({ segments = [], sourceCues = null, durationSec = 0 }) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return {
      timedSegments: [],
      timingReport: {
        totalSegments: 0,
        microDurationsCorrected: 0,
        overlapsResolved: 0,
        duplicatesRemoved: 0,
        oneToOneMappingValid: !Array.isArray(sourceCues) || sourceCues.length === 0,
      },
    };
  }

  // Pre-sort by start time
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec);
  
  // 1. Remove duplicate segments sharing the same start timestamp (<0.35s) and overlapping/identical text
  const cleanList = [];
  let duplicatesRemoved = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cleanList.length > 0) {
      const prev = cleanList[cleanList.length - 1];
      const sameTime = Math.abs((cur.startSec || 0) - (prev.startSec || 0)) < 0.35;
      const curText = (cur.khmerTranslatedText || cur.originalChineseText || '').trim();
      const prevText = (prev.khmerTranslatedText || prev.originalChineseText || '').trim();
      const hasDistinctSourceCueIds = Boolean(cur.sourceCueId && prev.sourceCueId && cur.sourceCueId !== prev.sourceCueId);
      const textMatches = !hasDistinctSourceCueIds && curText.length > 0 && curText === prevText;

      if (sameTime && textMatches) {
        duplicatesRemoved++;
        // Keep the one with longer/more complete duration and text
        if ((cur.endSec || 0) > (prev.endSec || 0)) {
          prev.endSec = cur.endSec;
          prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
          prev.sourceEndSec = cur.sourceEndSec || cur.endSec;
        }
        if (curText.length > prevText.length) {
          prev.originalChineseText = cur.originalChineseText || prev.originalChineseText;
          prev.khmerTranslatedText = cur.khmerTranslatedText || prev.khmerTranslatedText;
          prev.khmerText = prev.khmerTranslatedText;
          prev.khmer = prev.khmerTranslatedText;
        }
        continue;
      }
    }
    cleanList.push(cur);
  }

  const timedSegments = [];
  let microDurationsCorrected = 0;
  let overlapsResolved = 0;
  let prevEndSec = 0;

  for (let idx = 0; idx < cleanList.length; idx++) {
    const raw = cleanList[idx];
    let startSec = Math.max(0, typeof raw.startSec === 'number' ? raw.startSec : 0);
    let endSec = typeof raw.endSec === 'number' ? raw.endSec : startSec + 2.0;

    let reviewNeeded = Boolean(raw.reviewNeeded);
    let uncertainTiming = Boolean(raw.uncertainTiming);
    const errors = [...(raw.validationErrors || [])];

    // Canonical source timestamp reference:
    const canonicalStart = (typeof raw.sourceStartSec === 'number' && !isNaN(raw.sourceStartSec) && raw.sourceStartSec >= 0)
      ? raw.sourceStartSec
      : startSec;

    // ទប់ស្កាត់បញ្ហា Auto-Align Drift៖ បើ startSec ឃ្លាតពីពេលវេលាដើម (canonicalStart) លើសពី 1.5s
    // ឬរត់ហួសប្រវែងវីដេអូ (durationSec) ត្រូវទាញវាមកកាន់ canonicalStart វិញភ្លាម!
    const driftFromSource = Math.abs(startSec - canonicalStart);
    if (!raw.userShifted || driftFromSource > 1.5 || (durationSec > 0 && startSec >= durationSec - 0.5)) {
      startSec = canonicalStart;
    }

    // Invariant: endSec must be strictly greater than startSec
    if (isNaN(endSec) || endSec <= startSec) {
      endSec = parseFloat((startSec + 1.2).toFixed(2));
      uncertainTiming = true;
      reviewNeeded = true;
      errors.push('កាលបរិច្ឆេទបញ្ចប់តូចជាង ឬស្មើកាលបរិច្ឆេទចាប់ផ្តើម (Fixed endSec > startSec)');
    }

    // Determine upcoming speech start for available slot boundary calculation
    const nextItem = cleanList[idx + 1];
    let nextStartSec = null;
    if (nextItem) {
      if (typeof nextItem.sourceStartSec === 'number' && !isNaN(nextItem.sourceStartSec)) {
        nextStartSec = nextItem.sourceStartSec;
      } else if (typeof nextItem.startSec === 'number' && !isNaN(nextItem.startSec)) {
        nextStartSec = nextItem.startSec;
      }
    }

    // Calculate maximum slot available before next dialogue onset
    const availableSlot = (nextStartSec !== null && nextStartSec > startSec)
      ? (nextStartSec - startSec)
      : (durationSec > 0 ? Math.max(0.3, durationSec - startSec) : 4.0);

    // Dynamic minimum duration: calculated from text length and constrained by available slot
    // Prevents forcing arbitrary 0.8s-1.2s padding that causes downstream subtitle/audio collisions
    let rawDur = endSec - startSec;
    const textStr = (raw.khmerTranslatedText || raw.khmerText || raw.originalChineseText || '').trim();
    const textLen = textStr.length || 3;
    const readingTime = Math.max(0.35, Math.min(3.5, parseFloat((textLen * 0.09).toFixed(2))));
    const dynamicMinDur = availableSlot > 0.35 ? Math.min(availableSlot, readingTime) : Math.max(0.20, availableSlot);

    if (rawDur < dynamicMinDur) {
      microDurationsCorrected++;
      endSec = parseFloat((startSec + dynamicMinDur).toFixed(2));
      uncertainTiming = true;
      reviewNeeded = true;
      errors.push(`បានជួសជុល Micro-duration (${rawDur.toFixed(2)}s) ទៅជា ${dynamicMinDur.toFixed(2)}s តាមប្រវែងអត្ថបទ និង slot ទំនេរ`);
    }

    // Safe 0.05s gap and overlap resolution:
    // CRITICAL: NEVER shift startSec late (anchored to dialogue onset to preserve audio sync).
    if (idx > 0 && startSec < prevEndSec) {
      const prevSeg = timedSegments[idx - 1];
      const isDifferentSpeaker = raw.speakerId && prevSeg?.speakerId && raw.speakerId !== prevSeg.speakerId;
      const isVisualTitle = raw.evidenceType === 'visual_only' || raw.position === 'title_card' || prevSeg?.evidenceType === 'visual_only';

      if (!isDifferentSpeaker && !isVisualTitle && prevSeg) {
        overlapsResolved++;
        const idealPrevEnd = parseFloat((startSec - 0.05).toFixed(2));
        const prevTextStr = (prevSeg.khmerTranslatedText || prevSeg.khmerText || prevSeg.originalChineseText || '').trim();
        const prevTextLen = prevTextStr.length || 3;
        const prevMinDur = Math.max(0.25, parseFloat((prevTextLen * 0.07).toFixed(2)));

        if (idealPrevEnd >= prevSeg.startSec + prevMinDur) {
          // Sufficient room: clamp previous end to leave 0.05s gap
          prevSeg.endSec = idealPrevEnd;
          prevSeg.duration = parseFloat((prevSeg.endSec - prevSeg.startSec).toFixed(2));
          prevSeg.end = formatSecondsToTimecode(prevSeg.endSec);
          prevSeg.endTime = prevSeg.end;
        } else if (startSec > prevSeg.startSec + 0.20) {
          // Tight room: clamp previous end directly to startSec (0.0s gap) without shifting current startSec
          prevSeg.endSec = parseFloat(startSec.toFixed(2));
          prevSeg.duration = parseFloat((prevSeg.endSec - prevSeg.startSec).toFixed(2));
          prevSeg.end = formatSecondsToTimecode(prevSeg.endSec);
          prevSeg.endTime = prevSeg.end;
          reviewNeeded = true;
          errors.push('កង្វះចន្លោះទំនេរសម្រាប់ gap 0.05s: រក្សា startSec ដើម្បីការពារ Audio Desync (Tight Subtitle Gap Warning)');
        } else {
          // Overlapping dialogue onset: keep startSec anchored and flag warning
          reviewNeeded = true;
          uncertainTiming = true;
          errors.push('រក្សា startSec របស់ឃ្លាដើម្បីការពារ Audio Desync (Overlapping Onset Warning)');
        }
      }
    }

    // Verify synchronization against audio duration (if audio is already generated)
    const existingAudioDuration = Number(raw.audioDurationSec || raw.audioDuration || raw.finalAudioDuration || 0);
    if (existingAudioDuration > 0.10) {
      const audioEndSec = parseFloat((startSec + existingAudioDuration).toFixed(2));
      if (endSec < audioEndSec - 0.08) {
        // Subtitle disappears before audio finishes: try to extend to audio completion if within slot
        const maxSafeEnd = (nextStartSec !== null && nextStartSec > startSec)
          ? parseFloat((nextStartSec - 0.04).toFixed(2))
          : (durationSec > 0 ? durationSec : audioEndSec);

        if (audioEndSec <= maxSafeEnd) {
          endSec = audioEndSec;
        } else {
          if (maxSafeEnd > startSec + 0.3) {
            endSec = maxSafeEnd;
          }
          reviewNeeded = true;
          errors.push(`ប្រវែងសំឡេង (${existingAudioDuration.toFixed(2)}s) លើសពី Slot Subtitle (${(maxSafeEnd - startSec).toFixed(2)}s)`);
        }
      } else if (endSec > audioEndSec + 0.60) {
        // Subtitle lingers excessively long after audio has completed: tighten to natural tail
        const naturalTailEnd = parseFloat((audioEndSec + 0.25).toFixed(2));
        if (naturalTailEnd >= startSec + 0.35) {
          endSec = naturalTailEnd;
        }
      }
    }

    // Clamp to canonical media duration if known
    if (durationSec > 0 && endSec > durationSec) {
      endSec = parseFloat(durationSec.toFixed(2));
      if (startSec >= endSec) {
        startSec = Math.max(0, parseFloat((endSec - 1.0).toFixed(2)));
      }
    }

    // Compute slotDuration: available time window until next speech onset
    let slotDuration = 0;
    if (nextStartSec !== null && nextStartSec > startSec) {
      slotDuration = parseFloat(Math.max(0.3, nextStartSec - startSec).toFixed(2));
    } else {
      const naturalEnd = (typeof raw.sourceEndSec === 'number' && raw.sourceEndSec > startSec)
        ? raw.sourceEndSec
        : (endSec > startSec ? endSec : startSec + 2.0);
      slotDuration = parseFloat(Math.max(0.3, naturalEnd - startSec).toFixed(2));
    }

    const finalDur = parseFloat((endSec - startSec).toFixed(2));
    prevEndSec = endSec;

    const canonicalSourceStart = typeof raw.sourceStartSec === 'number' ? raw.sourceStartSec : startSec;
    const canonicalSourceEnd = typeof raw.sourceEndSec === 'number' ? raw.sourceEndSec : endSec;
    const sourceSpeechDuration = parseFloat(Math.max(0.1, canonicalSourceEnd - canonicalSourceStart).toFixed(2));

    timedSegments.push({
      ...raw,
      ...(raw.sourceCueId ? { sourceCueId: raw.sourceCueId } : {}),
      id: idx + 1,
      segmentId: raw.segmentId || idx + 1,
      startSec: parseFloat(startSec.toFixed(2)),
      endSec: parseFloat(endSec.toFixed(2)),
      duration: finalDur,
      sourceSpeechDuration: sourceSpeechDuration,
      availableSlotDuration: slotDuration,
      slotDuration: slotDuration,
      start: formatSecondsToTimecode(startSec),
      end: formatSecondsToTimecode(endSec),
      startTime: formatSecondsToTimecode(startSec),
      endTime: formatSecondsToTimecode(endSec),
      sourceStartSec: canonicalSourceStart,
      sourceEndSec: canonicalSourceEnd,
      reviewNeeded,
      uncertainTiming,
      validationErrors: errors,
    });
  }

  const mappingBaseline = (Array.isArray(sourceCues) && sourceCues.length > 0)
    ? sourceCues
    : (segments.some((s) => Boolean(s?.sourceCueId)) ? segments : null);
  const strictMapping = mappingBaseline
    ? validateStrictSourceCueMapping(mappingBaseline, timedSegments)
    : null;

  const invalidTimingCount = timedSegments.filter((s) => !(
    typeof s.startSec === 'number' &&
    Number.isFinite(s.startSec) &&
    s.startSec >= 0 &&
    typeof s.endSec === 'number' &&
    Number.isFinite(s.endSec) &&
    s.endSec > s.startSec &&
    (durationSec <= 0 || s.endSec <= durationSec + 0.05)
  )).length;

  return {
    timedSegments,
    timingReport: {
      totalSegments: timedSegments.length,
      microDurationsCorrected,
      overlapsResolved,
      duplicatesRemoved,
      invalidTimingCount,
      timingValid: invalidTimingCount === 0,
      durationSec,
      ...(strictMapping ? {
        oneToOneMappingValid: strictMapping.valid && invalidTimingCount === 0,
        exactCueIdSetMatch: strictMapping.exactCueIdSetMatch,
        missingCueIds: strictMapping.missingSourceCueIds,
        duplicateCueIds: strictMapping.duplicateSourceCueIds,
        unexpectedCueIds: strictMapping.unexpectedSourceCueIds,
        mismatchedCueIds: strictMapping.mismatchedOrderCueIds,
      } : {}),
    },
  };
}

module.exports = {
  validateSubtitleTiming,
};
