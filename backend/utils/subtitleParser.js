/**
 * Subtitle Parser Utility for Khmer AI Dubbing Studio
 * Parses standard .srt and .json subtitle files into Canonical Segments.
 * Robust against Windows \r\n, comma/dot millisecond formats, and malformed blocks.
 */

const { createCanonicalSegment, parseTimeToSeconds, GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

/**
 * Parse an SRT timestamp string (e.g. "00:01:23,456" or "00:01:23.456") into float seconds.
 * 
 * @param {string} timeStr
 * @returns {number}
 */
function parseSrtTimestamp(timeStr = '') {
  if (!timeStr || typeof timeStr !== 'string') return NaN;
  const clean = timeStr.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    if (isNaN(hours) || isNaN(mins) || isNaN(secs)) return NaN;
    return parseFloat((hours * 3600 + mins * 60 + secs).toFixed(2));
  }
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    if (isNaN(mins) || isNaN(secs)) return NaN;
    return parseFloat((mins * 60 + secs).toFixed(2));
  }
  const val = parseFloat(clean);
  return isNaN(val) ? NaN : parseFloat(val.toFixed(2));
}

/**
 * Parse .srt subtitle text content into an array of canonical segments.
 * 
 * @param {string} srtText - Raw SRT text
 * @param {string} [mode=GENERATION_MODES.FAST_OCR]
 * @returns {{ success: boolean, segments: Array<object>, warnings: Array<string> }}
 */
function parseSrtContent(srtText = '', mode = GENERATION_MODES.FAST_OCR) {
  const warnings = [];
  if (!srtText || typeof srtText !== 'string' || srtText.trim().length === 0) {
    return { success: false, segments: [], warnings: ['SRT file is empty or invalid.'] };
  }

  // Normalize line endings
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n+/);
  const rawSegments = [];

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const block = blocks[bIdx].trim();
    if (!block) continue;

    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      warnings.push(`Block ${bIdx + 1} skipped: insufficient lines (${lines.length}).`);
      continue;
    }

    // Identify timestamp line (contains '-->')
    let timeLineIdx = -1;
    for (let l = 0; l < lines.length; l++) {
      if (lines[l].includes('-->')) {
        timeLineIdx = l;
        break;
      }
    }

    if (timeLineIdx === -1) {
      warnings.push(`Block ${bIdx + 1} skipped: missing "-->" timecode separator.`);
      continue;
    }

    const timeParts = lines[timeLineIdx].split('-->').map((p) => p.trim());
    if (timeParts.length !== 2) {
      warnings.push(`Block ${bIdx + 1} skipped: malformed timecode line "${lines[timeLineIdx]}".`);
      continue;
    }

    const startSec = parseSrtTimestamp(timeParts[0]);
    let endSec = parseSrtTimestamp(timeParts[1]);

    if (isNaN(startSec) || startSec < 0) {
      warnings.push(`Block ${bIdx + 1} skipped: invalid start timestamp "${timeParts[0]}".`);
      continue;
    }

    if (isNaN(endSec) || endSec <= startSec) {
      endSec = parseFloat((startSec + 1.5).toFixed(2));
      warnings.push(`Block ${bIdx + 1}: end time adjusted from "${timeParts[1]}" to ${endSec}s.`);
    }

    // Text lines follow the timestamp line
    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim(); // Strip HTML tags like <i>, <font>

    if (!text) {
      warnings.push(`Block ${bIdx + 1} skipped: text line is empty.`);
      continue;
    }

    rawSegments.push({
      startSec,
      endSec,
      originalChineseText: text,
      chineseText: text,
      source: 'external_srt',
    });
  }

  if (rawSegments.length === 0) {
    return {
      success: false,
      segments: [],
      validationErrors: warnings.length > 0 ? warnings : ['No valid subtitle segments could be parsed from SRT.'],
      warnings: warnings.length > 0 ? warnings : ['No valid subtitle segments could be parsed from SRT.'],
    };
  }

  // Convert to Canonical Segments
  const canonicalSegments = rawSegments.map((raw, idx) =>
    createCanonicalSegment(raw, idx, mode)
  );

  return {
    success: true,
    segments: canonicalSegments,
    validationErrors: warnings,
    warnings,
    count: canonicalSegments.length,
  };
}

/**
 * Parse .json subtitle text or object into an array of canonical segments.
 * 
 * @param {string|Array<object>} jsonInput
 * @param {string} [mode=GENERATION_MODES.FAST_OCR]
 * @returns {{ success: boolean, segments: Array<object>, warnings: Array<string> }}
 */
function parseJsonContent(jsonInput, mode = GENERATION_MODES.FAST_OCR) {
  const warnings = [];
  let parsedArray = null;

  try {
    if (typeof jsonInput === 'string') {
      const parsed = JSON.parse(jsonInput);
      parsedArray = Array.isArray(parsed) ? parsed : (parsed.segments || parsed.subtitles || parsed.items);
    } else if (Array.isArray(jsonInput)) {
      parsedArray = jsonInput;
    } else if (jsonInput && typeof jsonInput === 'object') {
      parsedArray = jsonInput.segments || jsonInput.subtitles || jsonInput.items;
    }
  } catch (err) {
    const errMsg = `JSON parse error: ${err.message}`;
    return { success: false, segments: [], validationErrors: [errMsg], warnings: [errMsg] };
  }

  if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
    const errMsg = 'JSON does not contain a valid array of subtitle segments.';
    return { success: false, segments: [], validationErrors: [errMsg], warnings: [errMsg] };
  }

  const rawSegments = [];
  for (let i = 0; i < parsedArray.length; i++) {
    const item = parsedArray[i];
    if (!item || typeof item !== 'object') continue;

    const startSec = parseTimeToSeconds(item.startSec ?? item.startTime ?? item.start ?? item.from, i * 2.5);
    let endSec = parseTimeToSeconds(item.endSec ?? item.endTime ?? item.end ?? item.to, startSec + 2.0);
    if (endSec <= startSec) endSec = startSec + 1.5;

    const text = String(
      item.originalChineseText ?? item.chineseText ?? item.text ?? item.originalText ?? item.content ?? ''
    ).trim();

    if (!text) {
      warnings.push(`Item #${i + 1} skipped: empty text.`);
      continue;
    }

    rawSegments.push({
      ...item,
      startSec,
      endSec,
      originalChineseText: text,
      chineseText: text,
      source: 'external_json',
    });
  }

  if (rawSegments.length === 0) {
    return {
      success: false,
      segments: [],
      validationErrors: warnings.length > 0 ? warnings : ['No valid items found in JSON.'],
      warnings: warnings.length > 0 ? warnings : ['No valid items found in JSON.'],
    };
  }

  const canonicalSegments = rawSegments.map((raw, idx) =>
    createCanonicalSegment(raw, idx, mode)
  );

  return {
    success: true,
    segments: canonicalSegments,
    validationErrors: warnings,
    warnings,
    count: canonicalSegments.length,
  };
}

module.exports = {
  parseSrtTimestamp,
  parseSrtContent,
  parseJsonContent,
};

