/**
 * Centralized Canonical Timestamp Management & Backward Compatibility Layer (Frontend ESM)
 * Schema Version: 2 (Canonical Numeric Seconds)
 */

export const SCHEMA_VERSION = 2;

/**
 * Result object for timestamp parsing
 * @typedef {Object} ParseResult
 * @property {boolean} valid - Whether the timestamp was successfully parsed
 * @property {number|null} value - Value in canonical numeric seconds
 * @property {string} reason - Parsing classification or error reason
 * @property {any} raw - Original input value
 */

/**
 * Parse any supported legacy timestamp representation to canonical numeric seconds.
 * 
 * Verified legacy formats:
 * - Numeric seconds: 4, 4.25, 0
 * - Explicit milliseconds (unit='ms' or >= 100000 with allowMs=true)
 * - Time strings: "MM:SS" (e.g. "00:04", "01:30")
 * - Time strings with hours: "HH:MM:SS" (e.g. "01:00:15")
 * - Time strings with fractions: "HH:MM:SS.mmm", "HH:MM:SS,mmm", "MM:SS.mmm", "00:05.12"
 * - Numeric string: "14.25", "4"
 * 
 * Rejects without guessing:
 * - Negative values (< 0)
 * - NaN, null, undefined, empty strings
 * - Malformed strings containing invalid characters
 * - Non-finite numbers (Infinity, -Infinity)
 * 
 * @param {any} input 
 * @param {Object} [options]
 * @param {boolean} [options.allowMs=false]
 * @param {string} [options.unit='s']
 * @returns {ParseResult}
 */
export function parseTimestampToSeconds(input, options = {}) {
  const { allowMs = false, unit = 's' } = options;

  if (input === null || input === undefined) {
    return { valid: false, value: null, reason: 'MISSING', raw: input };
  }

  // 1. Direct Numeric representation
  if (typeof input === 'number') {
    if (isNaN(input) || !isFinite(input)) {
      return { valid: false, value: null, reason: 'NOT_FINITE', raw: input };
    }
    if (input < 0) {
      return { valid: false, value: null, reason: 'NEGATIVE', raw: input };
    }
    if (unit === 'ms' || (allowMs && input >= 100000)) {
      return { valid: true, value: parseFloat((input / 1000).toFixed(3)), reason: 'EXPLICIT_MS', raw: input };
    }
    return { valid: true, value: parseFloat(input.toFixed(3)), reason: 'CANONICAL_NUMERIC_SECONDS', raw: input };
  }

  // 2. String representation
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return { valid: false, value: null, reason: 'EMPTY_STRING', raw: input };
    }
    if (trimmed.startsWith('-')) {
      return { valid: false, value: null, reason: 'NEGATIVE', raw: input };
    }

    // Standardize comma from SRT timestamps (00:00:04,250 -> 00:00:04.250)
    const normalizedStr = trimmed.replace(',', '.');

    // Check for colon-separated timecode ("HH:MM:SS" or "MM:SS")
    if (normalizedStr.includes(':')) {
      const parts = normalizedStr.split(':');
      if (parts.length === 3) {
        const h = Number(parts[0]);
        const m = Number(parts[1]);
        const s = Number(parts[2]);
        if (isNaN(h) || isNaN(m) || isNaN(s) || h < 0 || m < 0 || s < 0 || m >= 60 || s >= 60) {
          return { valid: false, value: null, reason: 'MALFORMED_TIMECODE_HH_MM_SS', raw: input };
        }
        const totalSec = h * 3600 + m * 60 + s;
        return { valid: true, value: parseFloat(totalSec.toFixed(3)), reason: 'PARSED_HH_MM_SS', raw: input };
      }
      if (parts.length === 2) {
        const m = Number(parts[0]);
        const s = Number(parts[1]);
        if (isNaN(m) || isNaN(s) || m < 0 || s < 0) {
          return { valid: false, value: null, reason: 'MALFORMED_TIMECODE_MM_SS', raw: input };
        }
        const totalSec = m * 60 + s;
        return { valid: true, value: parseFloat(totalSec.toFixed(3)), reason: 'PARSED_MM_SS', raw: input };
      }
      return { valid: false, value: null, reason: 'AMBIGUOUS_COLON_FORMAT', raw: input };
    }

    // Single numeric string (e.g. "14.25")
    const num = Number(normalizedStr);
    if (isNaN(num) || !isFinite(num)) {
      return { valid: false, value: null, reason: 'NON_NUMERIC_STRING', raw: input };
    }
    if (num < 0) {
      return { valid: false, value: null, reason: 'NEGATIVE', raw: input };
    }
    if (unit === 'ms' || (allowMs && num >= 100000)) {
      return { valid: true, value: parseFloat((num / 1000).toFixed(3)), reason: 'EXPLICIT_MS_STRING', raw: input };
    }
    return { valid: true, value: parseFloat(num.toFixed(3)), reason: 'PARSED_NUMERIC_STRING', raw: input };
  }

  return { valid: false, value: null, reason: 'UNSUPPORTED_TYPE', raw: input };
}

/**
 * Backward-compatible helper returning a float number or fallback
 * @param {any} input 
 * @param {number} [fallbackSec=0] 
 * @returns {number}
 */
export function parseTimeToSeconds(input, fallbackSec = 0) {
  const res = parseTimestampToSeconds(input);
  if (res.valid && res.value !== null) {
    return res.value;
  }
  return fallbackSec;
}

/**
 * Format float seconds to MM:SS
 * @param {number} sec 
 * @returns {string}
 */
export function formatMinSec(sec) {
  if (isNaN(sec) || sec < 0 || !isFinite(sec)) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format seconds into CapCut timecode string: HH:MM:SS.ms or MM:SS.ms
 * @param {number} sec - Total seconds
 * @param {boolean} [includeHours=false]
 * @returns {string}
 */
export function formatTimecode(sec, includeHours = false) {
  if (isNaN(sec) || sec < 0 || !isFinite(sec)) sec = 0;
  
  const totalHundredths = Math.round(sec * 100);
  const ms = totalHundredths % 100;
  const totalSec = Math.floor(totalHundredths / 100);
  const s = totalSec % 60;
  const m = Math.floor((totalSec % 3600) / 60);
  const h = Math.floor(totalSec / 3600);

  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  const mss = ms.toString().padStart(2, '0');

  if (includeHours || h > 0) {
    const hh = h.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}.${mss}`;
  }
  return `${mm}:${ss}.${mss}`;
}

/**
 * Safely migrate and normalize segment timestamps to canonical representation (Schema V2)
 * Preserves source timing, legitimate gaps, and overlapping dialogue.
 * 
 * @param {Object} seg 
 * @param {number} index 
 * @returns {{ segment: Object, migrated: boolean, alreadyCanonical: boolean, errors: Array<string> }}
 */
export function migrateSegmentTimestamps(seg = {}, index = 0) {
  const errors = [];
  let migrated = false;
  let alreadyCanonical = false;

  const hasCanonicalStart = typeof seg.startSec === 'number' && isFinite(seg.startSec) && seg.startSec >= 0;
  const hasCanonicalEnd = typeof seg.endSec === 'number' && isFinite(seg.endSec) && seg.endSec > seg.startSec;

  if (hasCanonicalStart && hasCanonicalEnd && seg.schemaVersion >= SCHEMA_VERSION) {
    alreadyCanonical = true;
  }

  // 1. Resolve Start Time
  let startRes = parseTimestampToSeconds(seg.startSec);
  if (!startRes.valid) {
    startRes = parseTimestampToSeconds(seg.start);
    if (startRes.valid) migrated = true;
  }

  // 2. Resolve End Time
  let endRes = parseTimestampToSeconds(seg.endSec);
  if (!endRes.valid) {
    endRes = parseTimestampToSeconds(seg.end);
    if (endRes.valid) migrated = true;
  }

  let finalStartSec = startRes.valid ? startRes.value : null;
  let finalEndSec = endRes.valid ? endRes.value : null;

  if (!startRes.valid) {
    errors.push(`Invalid or missing start timestamp: ${JSON.stringify(seg.startSec ?? seg.start)} (${startRes.reason})`);
    finalStartSec = index * 4.0;
  }

  if (!endRes.valid) {
    errors.push(`Invalid or missing end timestamp: ${JSON.stringify(seg.endSec ?? seg.end)} (${endRes.reason})`);
    finalEndSec = (finalStartSec || 0) + 3.5;
  } else if (finalStartSec !== null && finalEndSec <= finalStartSec) {
    errors.push(`End timestamp (${finalEndSec}s) must be greater than start timestamp (${finalStartSec}s)`);
    finalEndSec = finalStartSec + 3.0;
    migrated = true;
  }

  // 3. Audio Timing
  let audioStartRes = parseTimestampToSeconds(seg.audioStartSec);
  if (!audioStartRes.valid) {
    audioStartRes = parseTimestampToSeconds(seg.audioStart);
  }
  const audioStartSec = audioStartRes.valid ? audioStartRes.value : finalStartSec;

  const audioDurationSec = typeof seg.audioDurationSec === 'number' && isFinite(seg.audioDurationSec) && seg.audioDurationSec >= 0
    ? parseFloat(seg.audioDurationSec.toFixed(2))
    : 0;

  const audioEndSec = audioDurationSec > 0
    ? parseFloat((audioStartSec + audioDurationSec).toFixed(2))
    : (typeof seg.audioEndSec === 'number' ? seg.audioEndSec : finalEndSec);

  const sourceStartSec = typeof seg.sourceStartSec === 'number' && isFinite(seg.sourceStartSec)
    ? parseFloat(seg.sourceStartSec.toFixed(2))
    : parseFloat(finalStartSec.toFixed(2));
  const sourceEndSec = typeof seg.sourceEndSec === 'number' && isFinite(seg.sourceEndSec)
    ? parseFloat(seg.sourceEndSec.toFixed(2))
    : parseFloat(finalEndSec.toFixed(2));

  const updatedSegment = {
    ...seg,
    schemaVersion: SCHEMA_VERSION,
    sourceStartSec,
    sourceEndSec,
    startSec: parseFloat(finalStartSec.toFixed(2)),
    endSec: parseFloat(finalEndSec.toFixed(2)),
    start: formatMinSec(finalStartSec),
    end: formatMinSec(finalEndSec),
    audioStartSec: parseFloat(audioStartSec.toFixed(2)),
    audioEndSec: parseFloat(audioEndSec.toFixed(2)),
    audioDurationSec,
    audioStart: formatMinSec(audioStartSec),
    audioEnd: formatMinSec(audioEndSec),
    validationErrors: [...(seg.validationErrors || []), ...errors],
  };

  return {
    segment: updatedSegment,
    migrated: migrated || !alreadyCanonical,
    alreadyCanonical,
    errors,
  };
}

/**
 * Version and migrate project data safely
 * @param {Object} projectData 
 * @returns {{ success: boolean, project: Object, report: Object }}
 */
export function migrateProjectData(projectData = {}) {
  if (!projectData || typeof projectData !== 'object') {
    return {
      success: false,
      project: projectData,
      report: { error: 'Invalid project data object' },
    };
  }

  const currentVersion = projectData.schemaVersion || 1;
  const segments = Array.isArray(projectData.scriptData?.segments)
    ? projectData.scriptData.segments
    : (Array.isArray(projectData.segments) ? projectData.segments : []);

  let migratedCount = 0;
  let alreadyCanonicalCount = 0;
  let invalidCount = 0;
  const reviewRequired = [];

  const migratedSegments = segments.map((seg, idx) => {
    const res = migrateSegmentTimestamps(seg, idx);
    if (res.alreadyCanonical) {
      alreadyCanonicalCount++;
    } else {
      migratedCount++;
    }
    if (res.errors.length > 0) {
      invalidCount++;
      reviewRequired.push({ index: idx + 1, id: seg.id, errors: res.errors, raw: { start: seg.start, end: seg.end } });
    }
    return res.segment;
  });

  const isScriptDataWrapped = Boolean(projectData.scriptData);

  const migratedProject = {
    ...projectData,
    schemaVersion: SCHEMA_VERSION,
    lastMigratedAt: Date.now(),
    ...(isScriptDataWrapped
      ? {
          scriptData: {
            ...projectData.scriptData,
            schemaVersion: SCHEMA_VERSION,
            segments: migratedSegments,
          },
        }
      : {
          segments: migratedSegments,
        }),
  };

  const report = {
    recordsInspected: segments.length,
    migratedSafely: migratedCount,
    alreadyCanonical: alreadyCanonicalCount,
    invalidTimestamps: invalidCount,
    requiresManualReview: reviewRequired.length,
    reviewItems: reviewRequired,
    previousVersion: currentVersion,
    targetVersion: SCHEMA_VERSION,
  };

  return {
    success: invalidCount === 0 || migratedCount > 0,
    project: migratedProject,
    report,
  };
}
