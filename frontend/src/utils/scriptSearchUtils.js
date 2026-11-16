/**
 * Filter script segments by stable dialogue number (#1, #2, ... / "37" / "#37")
 * or by Khmer translation, Chinese source text, or speaker name.
 */
export function filterScriptSegments(segments = [], searchQuery = '') {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const rawTrimmed = String(searchQuery || '').trim();
  if (!rawTrimmed) return segments;

  // Normalize Khmer digits (០-៩) to ASCII (0-9) when user types numbers with Khmer keyboard
  const asciiQuery = rawTrimmed.replace(/[\u17e0-\u17e9]/g, (ch) =>
    String(ch.charCodeAt(0) - 0x17e0)
  );

  const matchLineNumber = (targetNum) => {
    const matches = segments.filter((seg) => Number(seg?.segmentId ?? seg?.id) === targetNum);
    if (matches.length > 0) return matches;
    const legacyAtIndex = segments[targetNum - 1];
    return legacyAtIndex && legacyAtIndex.id == null && legacyAtIndex.segmentId == null ? [legacyAtIndex] : [];
  };

  // Match the stable ID shown on each card; use the array position only for legacy items without IDs.
  const hashNumberMatch = asciiQuery.match(/^#\s*(\d+)$/);
  if (hashNumberMatch) {
    const targetNum = parseInt(hashNumberMatch[1], 10);
    return matchLineNumber(targetNum);
  }

  // Bare numbers use the same stable dialogue number; out-of-range numbers can still match text.
  const bareNumberMatch = asciiQuery.match(/^(\d+)$/);
  if (bareNumberMatch) {
    const targetNum = parseInt(bareNumberMatch[1], 10);
    if (targetNum >= 1 && targetNum <= segments.length) {
      return matchLineNumber(targetNum);
    }
  }

  const q = rawTrimmed.toLowerCase();
  const asciiLower = asciiQuery.toLowerCase();
  return segments.filter((seg) => {
    if (!seg || typeof seg !== 'object') return false;
    const km = (seg.khmer || seg.khmerText || seg.khmerTranslatedText || '').toLowerCase();
    const orig = (
      seg.original ||
      seg.chineseText ||
      seg.originalChineseText ||
      seg.originalText ||
      seg.chinese ||
      ''
    ).toLowerCase();
    const spk = (seg.speaker || seg.speakerName || '').toLowerCase();
    return (
      km.includes(q) ||
      orig.includes(q) ||
      spk.includes(q) ||
      (asciiLower !== q && (km.includes(asciiLower) || orig.includes(asciiLower) || spk.includes(asciiLower)))
    );
  });
}
