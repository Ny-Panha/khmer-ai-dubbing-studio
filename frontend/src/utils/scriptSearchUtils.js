/**
 * Filter script segments by displayed card number (#1, #2, ... / "37" / "#37")
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

  // Explicit "#37" -> match exact visual card line number (#idx + 1), or fallback to numeric seg.id if out of bounds
  const hashNumberMatch = asciiQuery.match(/^#\s*(\d+)$/);
  if (hashNumberMatch) {
    const targetNum = parseInt(hashNumberMatch[1], 10);
    if (targetNum >= 1 && targetNum <= segments.length) {
      return [segments[targetNum - 1]];
    }
    return segments.filter((seg) => {
      const segIdNum = Number(seg?.segmentId ?? seg?.id);
      return Number.isInteger(segIdNum) && segIdNum === targetNum;
    });
  }

  // Bare number "37" -> prioritize exact card number (#37 = idx + 1) when in range;
  // otherwise fallback to dialogue/speaker text search (e.g. searching "5000" inside dialogue)
  const bareNumberMatch = asciiQuery.match(/^(\d+)$/);
  if (bareNumberMatch) {
    const targetNum = parseInt(bareNumberMatch[1], 10);
    if (targetNum >= 1 && targetNum <= segments.length) {
      return [segments[targetNum - 1]];
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
