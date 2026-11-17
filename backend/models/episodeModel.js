/**
 * Canonical Episode and Series Data Models
 * Enforces reliable episode numbering, unique IDs, and data integrity.
 */

/**
 * Extracts and determines the next available episode number for a series.
 * Rules:
 * 1. Checks existing episodes' explicit episodeNumber, id patterns, and title patterns.
 * 2. Does NOT rely on array length (which fails when episodes are deleted or re-added).
 * 3. Preserves intentional numbering gaps (e.g. if Ep 1 and Ep 4 exist, next is 5).
 * 4. Strictly prevents duplicate episode numbers.
 *
 * @param {Array<Object>} episodes - Current array of episode objects
 * @returns {number} The next positive integer episode number
 */
function getNextAvailableEpisodeNumber(episodes = []) {
  if (!Array.isArray(episodes) || episodes.length === 0) {
    return 1;
  }

  const existingNumbers = new Set();

  for (const ep of episodes) {
    if (!ep) continue;

    // 1. Check explicit numeric episodeNumber
    if (typeof ep.episodeNumber === 'number' && !isNaN(ep.episodeNumber) && ep.episodeNumber > 0) {
      existingNumbers.add(Math.floor(ep.episodeNumber));
    } else {
      let found = false;
      // 2. Parse from ep.id (e.g. "ep_2", "ep_2_179310234")
      if (typeof ep.id === 'string') {
        const match = ep.id.match(/^ep_(\d+)(?:_.*)?$/i);
        if (match) {
          const parsed = parseInt(match[1], 10);
          if (!isNaN(parsed) && parsed > 0) {
            existingNumbers.add(parsed);
            found = true;
          }
        }
      }

      // 3. Parse from title (e.g. "ភាគទី 2", "EP2", "Episode 2")
      if (!found && typeof ep.title === 'string') {
        const match = ep.title.match(/(?:ភាគ|ភាគទី|EP|Episode)\s*[:#\s]*(\d+)/i);
        if (match) {
          const parsed = parseInt(match[1], 10);
          if (!isNaN(parsed) && parsed > 0) {
            existingNumbers.add(parsed);
          }
        }
      }
    }
  }

  if (existingNumbers.size === 0) {
    return 1;
  }

  // Find the highest existing episode number
  const maxNumber = Math.max(...existingNumbers);
  let candidate = maxNumber + 1;

  // Collision safety: guarantee candidate is not already present
  while (existingNumbers.has(candidate)) {
    candidate++;
  }

  return candidate;
}

/**
 * Generates a unique, filesystem-safe episode ID independent of display numbers.
 *
 * @param {number} episodeNumber
 * @param {Array<Object>} existingEpisodes
 * @returns {string} Unique episode identifier
 */
function generateUniqueEpisodeId(episodeNumber, existingEpisodes = []) {
  const existingIds = new Set((existingEpisodes || []).filter(Boolean).map((e) => String(e.id)));
  const baseId = `ep_${episodeNumber}`;

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  // If baseId already exists, append unique timestamp hash
  let uniqueId = `ep_${episodeNumber}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  while (existingIds.has(uniqueId)) {
    uniqueId = `ep_${episodeNumber}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  }
  return uniqueId;
}

/**
 * Factory for creating a clean, isolated episode object
 *
 * @param {Object} params
 * @param {number} [params.episodeNumber]
 * @param {string} [params.title]
 * @param {string} [params.id]
 * @param {Array<Object>} [params.existingEpisodes]
 * @returns {Object} Canonical Episode object
 */
function createEpisode({
  episodeNumber = null,
  title = null,
  id = null,
  existingEpisodes = [],
} = {}) {
  const resolvedNumber = (typeof episodeNumber === 'number' && episodeNumber > 0)
    ? episodeNumber
    : getNextAvailableEpisodeNumber(existingEpisodes);

  const resolvedId = id || generateUniqueEpisodeId(resolvedNumber, existingEpisodes);
  const resolvedTitle = title || `ភាគទី ${resolvedNumber} (EP${resolvedNumber})`;

  return {
    id: resolvedId,
    episodeNumber: resolvedNumber,
    title: resolvedTitle,
    displayTitle: resolvedTitle,
    status: 'idle', // 'idle' | 'uploaded' | 'translating' | 'translated' | 'voicing' | 'completed'
    video: null,
    metadata: null,
    scriptData: null,
    speakerRegistry: {},
    audioGenerated: false,
    audioOutdated: false,
    fullAudioPath: null,
    fullAudioUrl: null,
    duration: 0,
    videoClips: [],
    activeClipId: null,
    selectedSegmentId: null,
    renderedVideo: null,
    voiceSettings: null,
    lastModified: Date.now(),
  };
}

function getSegmentIdentityKeys(segment) {
  if (!segment || typeof segment !== 'object') return [];
  const keys = [];
  if (segment._uid !== undefined && segment._uid !== null && String(segment._uid)) {
    keys.push(`uid:${String(segment._uid)}`);
  }
  if (segment.id !== undefined && segment.id !== null && String(segment.id)) {
    keys.push(`id:${String(segment.id)}`);
  }
  if (segment.segmentId !== undefined && segment.segmentId !== null && String(segment.segmentId)) {
    keys.push(`segmentId:${String(segment.segmentId)}`);
  }
  if (keys.length === 0) {
    const start = segment.startSec ?? segment.start ?? '';
    const end = segment.endSec ?? segment.end ?? '';
    const text = segment.chineseText ?? segment.originalText ?? segment.khmerText ?? segment.text ?? '';
    keys.push(`fallback:${String(start)}|${String(end)}|${String(text)}`);
  }
  return keys;
}

function isSegmentDeletedByTombstone(segment, tombstones) {
  if (segment?._uid !== undefined && segment?._uid !== null && String(segment._uid)) {
    return tombstones.has(`uid:${String(segment._uid)}`);
  }
  return getSegmentIdentityKeys(segment).some((key) => tombstones.has(key));
}

function getVideoClipIdentity(clip) {
  return clip?.id === undefined || clip?.id === null ? null : String(clip.id);
}

/**
 * Validates, heals, and enforces strict uniqueness on episode numbers and IDs in a series
 *
 * @param {Object} series
 * @returns {Object} Sanitized series
 */
function sanitizeSeriesEpisodes(series) {
  if (!series || !Array.isArray(series.episodes)) return series;

  // Natural numeric sort episodes so ep_1, ep_2, ... ep_9, ep_10, ep_11 are always ordered correctly
  series.episodes.sort((a, b) => {
    const numA = (a && a.episodeNumber !== undefined && a.episodeNumber !== null && !isNaN(Number(a.episodeNumber))) ? Number(a.episodeNumber) : null;
    const numB = (b && b.episodeNumber !== undefined && b.episodeNumber !== null && !isNaN(Number(b.episodeNumber))) ? Number(b.episodeNumber) : null;
    if (numA !== null && numB !== null && numA !== numB) {
      return numA - numB;
    }
    const matchA = String(a?.id || '').match(/^ep_(\d+)/i);
    const matchB = String(b?.id || '').match(/^ep_(\d+)/i);
    const idNumA = matchA ? parseInt(matchA[1], 10) : Number.MAX_SAFE_INTEGER;
    const idNumB = matchB ? parseInt(matchB[1], 10) : Number.MAX_SAFE_INTEGER;
    if (idNumA !== idNumB) return idNumA - idNumB;
    return String(a?.id || '').localeCompare(String(b?.id || ''), undefined, { numeric: true, sensitivity: 'base' });
  });

  const seenIds = new Set();
  const sanitizedEpisodes = [];

  for (let i = 0; i < series.episodes.length; i++) {
    const ep = series.episodes[i];
    if (!ep) continue;

    const cloned = { ...ep };
    const expectedNum = i + 1;
    const oldNum = cloned.episodeNumber;

    cloned.episodeNumber = expectedNum;

    // 2. Resolve ID uniqueness
    let epId = cloned.id ? String(cloned.id).trim() : `ep_${expectedNum}`;
    while (seenIds.has(epId)) {
      epId = `ep_${expectedNum}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    }
    cloned.id = epId;
    seenIds.add(epId);

    // 3. Ensure title and displayTitle exist and are healed
    const isGeneric = !cloned.title ||
      new RegExp(`^ភាគទី\\s*${oldNum}\\s*\\(EP${oldNum}\\)$`, 'i').test(cloned.title.trim()) ||
      /^ភាគទី\s*[\d០-៩]+\s*\(EP[\d០-៩]+\)$/i.test(cloned.title.trim()) ||
      /^\(EP[\d០-៩]+\)$/i.test(cloned.title.trim()) ||
      /^ភាគទី\s*[\d០-៩]+$/i.test(cloned.title.trim()) ||
      /^Episode\s*[\d]+$/i.test(cloned.title.trim());

    if (isGeneric) {
      cloned.title = `ភាគទី ${expectedNum} (EP${expectedNum})`;
      cloned.displayTitle = cloned.title;
    } else if (typeof cloned.title === 'string' && /^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i.test(cloned.title)) {
      const rest = cloned.title.replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '').trim();
      cloned.title = `ភាគទី ${expectedNum}: ${rest}`;
      if (cloned.displayTitle) {
        const restDisplay = cloned.displayTitle.replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '').trim();
        cloned.displayTitle = `ភាគទី ${expectedNum}: ${restDisplay}`;
      }
    }

    // 4. Ensure scriptData.segments contains zero null / non-object entries
    if (cloned.scriptData && Array.isArray(cloned.scriptData.segments)) {
      const deletedSegmentKeys = new Set(
        (Array.isArray(cloned.deletedSegmentKeys) ? cloned.deletedSegmentKeys : []).map(String)
      );
      cloned.scriptData.segments = cloned.scriptData.segments.filter((seg) =>
        seg && typeof seg === 'object' &&
        !isSegmentDeletedByTombstone(seg, deletedSegmentKeys)
      );
    }

    if (Array.isArray(cloned.videoClips)) {
      const deletedVideoClipIds = new Set(
        (Array.isArray(cloned.deletedVideoClipIds) ? cloned.deletedVideoClipIds : []).map(String)
      );
      cloned.videoClips = cloned.videoClips.filter((clip) => {
        const clipId = getVideoClipIdentity(clip);
        return clip && typeof clip === 'object' && (!clipId || !deletedVideoClipIds.has(clipId));
      });
    }

    sanitizedEpisodes.push(cloned);
  }

  series.episodes = sanitizedEpisodes;
  return series;
}

module.exports = {
  getNextAvailableEpisodeNumber,
  generateUniqueEpisodeId,
  createEpisode,
  getSegmentIdentityKeys,
  isSegmentDeletedByTombstone,
  getVideoClipIdentity,
  sanitizeSeriesEpisodes,
};
