import { SCHEMA_VERSION } from './timestampUtils.js';
import { syncSeriesApi, deleteEpisodeApi } from '../services/api.js';
import { stripLogoSettings } from './logoSettingsStorage.js';

export const STORAGE_SERIES_LIST_KEY = 'KHMER_AI_SERIES_LIST_V2';
export const STORAGE_ACTIVE_SERIES_ID_KEY = 'KHMER_AI_ACTIVE_SERIES_ID';
export const STORAGE_ACTIVE_EPISODE_ID_KEY = 'KHMER_AI_ACTIVE_EPISODE_ID';
export const STORAGE_ACTIVE_PROJECT_KEY = 'KHMER_AI_ACTIVE_PROJECT_V3';
export const STORAGE_VOICE_SETTINGS_KEY = 'KHMER_AI_DUBBING_VOICE_SETTINGS';

export const DEFAULT_VOICE_SETTINGS = {
  voiceId: 'km-KH-PisethNeural',
  speed: 'normal',
  previewText: 'សួស្តី! នេះជាសំឡេងខ្មែរ AI សម្រាប់បញ្ចូលសំឡេងរឿងភាគ',
  duckingVolume: 0.15,
  khmerVolume: 1.3,
  enableDemucs: false,
  burnSubtitles: true,
  subtitleColor: 'white',
  subtitleSize: 'medium',
  aspectRatio: null,
  verticalStyle: 'pad',
  enableAntiTheft: false,
  marqueeText: '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»',
  marqueeSpeed: 'normal',
  marqueePosition: 'bottom',
  marqueeTextColor: '#FFE600',
  enableWatermark: true,
  watermarkText: 'រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama',
  watermarkPosition: 'above-ticker',
  watermarkColor: '#38BDF8',
  enableCornerMask: false,
  cornerMaskText: '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»',
  cornerMaskStyle: 'badge',
  cornerMaskPosition: 'top-right',
  cornerMaskWidth: 220,
  cornerMaskHeight: 54,
  cornerMaskOpacity: 0.95,
};

export const VALID_ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1']);

/**
 * Strictly validate aspectRatio against supported framing modes ('16:9' | '9:16' | '1:1').
 * Any invalid/poisoned value returns null so callers fall back cleanly to follow-source default.
 */
export function sanitizeAspectRatio(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return VALID_ASPECT_RATIOS.includes(trimmed) ? trimmed : null;
}

/**
 * Determine default export aspect ratio based on source video dimensions.
 * Portrait (height > width) -> '9:16'
 * Landscape (width > height) -> '16:9'
 * Square (width === height) -> '1:1'
 * Returns null if dimensions are missing/invalid.
 */
export function resolveDefaultAspectRatio(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return null;
  if (h > w) return '9:16';
  if (w > h) return '16:9';
  return '1:1';
}

/**
 * Infer the aspect ratio of an exported/rendered video object or URL.
 */
export function inferRenderedAspectRatio(renderedVideo, fallbackDims = null, fallbackRatio = '16:9') {
  const safeFallback = sanitizeAspectRatio(fallbackRatio) || fallbackRatio;
  if (!renderedVideo) return null;
  if (typeof renderedVideo === 'object' && renderedVideo.aspectRatio) {
    const explicit = sanitizeAspectRatio(renderedVideo.aspectRatio);
    if (explicit) return explicit;
  }
  const ref = String(
    typeof renderedVideo === 'string'
      ? renderedVideo
      : (renderedVideo.outputFilename || renderedVideo.outputVideoUrl || renderedVideo.videoUrl || '')
  );
  if (ref.includes('[9-16') || ref.includes('9-16 TikTok')) return '9:16';
  if (ref.includes('[1-1') || ref.includes('1-1 Square')) return '1:1';
  if (fallbackDims?.width && fallbackDims?.height) {
    return resolveDefaultAspectRatio(fallbackDims.width, fallbackDims.height) || safeFallback;
  }
  return safeFallback;
}

export function sanitizeRenderedVideo(renderedVideo) {
  if (!renderedVideo) return null;
  const refs = typeof renderedVideo === 'string'
    ? [renderedVideo]
    : [
        renderedVideo.outputVideoUrl,
        renderedVideo.videoUrl,
        renderedVideo.downloadUrl,
        renderedVideo.outputFilename,
      ];
  const hasMockRef = refs.some(
    (ref) => typeof ref === 'string' && /(?:^|\/|\\)mock_(?:render|16-9|9-16|1-1)/i.test(ref.trim())
  );
  if (hasMockRef) return null;
  if (typeof renderedVideo === 'string') {
    return renderedVideo.trim() ? renderedVideo : null;
  }
  const hasAnyUrl = Boolean(
    renderedVideo.outputVideoUrl || renderedVideo.videoUrl || renderedVideo.downloadUrl
  );
  return hasAnyUrl ? renderedVideo : null;
}

/**
 * Determine whether an episode's existing renderedVideo contradicts an explicit/target aspect ratio.
 */
export function isRenderedRatioMismatch(renderedVideo, targetAspectRatio, fallbackDims = null) {
  if (!renderedVideo || !targetAspectRatio) return false;
  const renderedRatio = inferRenderedAspectRatio(renderedVideo, fallbackDims, null);
  return Boolean(renderedRatio && renderedRatio !== targetAspectRatio);
}

/**
 * Merge episode voice settings into current workspace settings while NEVER letting
 * stale episode metadata or legacy rendered outputs overwrite the user's sticky aspectRatio.
 */
export function resolveStickyVoiceSettings({
  prevSettings = null,
  savedGlobalSettings = null,
  episodeVoiceSettings = null,
} = {}) {
  const safePrev = prevSettings && typeof prevSettings === 'object' && !Array.isArray(prevSettings)
    ? prevSettings
    : {};
  const safeGlobal = savedGlobalSettings && typeof savedGlobalSettings === 'object' && !Array.isArray(savedGlobalSettings)
    ? savedGlobalSettings
    : null;
  const base = stripLogoSettings({
    ...DEFAULT_VOICE_SETTINGS,
    ...safePrev,
  });
  const stickyRatio =
    sanitizeAspectRatio(base.aspectRatio) ||
    sanitizeAspectRatio(safeGlobal?.aspectRatio) ||
    null;
  const epClean = episodeVoiceSettings && typeof episodeVoiceSettings === 'object' && !Array.isArray(episodeVoiceSettings)
    ? stripLogoSettings({ ...episodeVoiceSettings })
    : {};
  delete epClean.aspectRatio;
  return {
    ...base,
    ...epClean,
    aspectRatio: stickyRatio,
  };
}

/**
 * Read raw legacy voiceSettings from localStorage before logo-key stripping (used once for migration)
 */
export function readLegacyVoiceSettingsRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_VOICE_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Load saved voice settings from localStorage
 */
export function loadSavedVoiceSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_VOICE_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const merged = stripLogoSettings({ ...DEFAULT_VOICE_SETTINGS, ...parsed });
        merged.aspectRatio = sanitizeAspectRatio(merged.aspectRatio);
        return merged;
      }
    }
  } catch {}
  return { ...DEFAULT_VOICE_SETTINGS };
}

/**
 * Save voice settings to localStorage
 */
export function saveVoiceSettings(settings) {
  try {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    const normalized = stripLogoSettings({
      ...settings,
      aspectRatio: sanitizeAspectRatio(settings.aspectRatio),
    });
    localStorage.setItem(STORAGE_VOICE_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {}
}

/**
 * Extracts and determines the next available episode number for a series.
 * Rules:
 * 1. Checks existing episodes' explicit episodeNumber, id patterns, and title patterns.
 * 2. Does NOT rely on array length (which fails when episodes are deleted or re-added).
 * 3. Preserves intentional numbering gaps (e.g. if Ep 1 and Ep 4 exist, next is 5).
 * 4. Strictly prevents duplicate episode numbers.
 */
export function getNextAvailableEpisodeNumber(episodes = []) {
  if (!Array.isArray(episodes) || episodes.length === 0) {
    return 1;
  }

  const existingNumbers = new Set();
  for (const ep of episodes) {
    if (!ep) continue;

    if (typeof ep.episodeNumber === 'number' && !isNaN(ep.episodeNumber) && ep.episodeNumber > 0) {
      existingNumbers.add(Math.floor(ep.episodeNumber));
    } else {
      let found = false;
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

  const maxNumber = Math.max(...existingNumbers);
  let candidate = maxNumber + 1;

  while (existingNumbers.has(candidate)) {
    candidate++;
  }

  return candidate;
}

/**
 * Generates a unique, filesystem-safe episode ID independent of display numbers.
 */
export function generateUniqueEpisodeId(episodeNumber, existingEpisodes = []) {
  const existingIds = new Set((existingEpisodes || []).filter(Boolean).map((e) => String(e.id)));
  const baseId = `ep_${episodeNumber}`;

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let uniqueId = `ep_${episodeNumber}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  while (existingIds.has(uniqueId)) {
    uniqueId = `ep_${episodeNumber}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  }
  return uniqueId;
}

/**
 * Factory for a new empty episode
 */
export function createDefaultEpisode(episodeNumber = null, title = null, id = null, existingEpisodes = []) {
  const resolvedNumber = (typeof episodeNumber === 'number' && episodeNumber > 0)
    ? episodeNumber
    : getNextAvailableEpisodeNumber(existingEpisodes);

  const resolvedId = id || generateUniqueEpisodeId(resolvedNumber, existingEpisodes);
  const resolvedTitle = (typeof title === 'string' && title.trim())
    ? title.trim()
    : `ភាគទី ${resolvedNumber} (EP${resolvedNumber})`;

  return {
    id: resolvedId,
    episodeNumber: resolvedNumber,
    title: resolvedTitle,
    displayTitle: resolvedTitle,
    status: 'idle', // 'idle' | 'uploaded' | 'translating' | 'translated' | 'voicing' | 'completed'
    video: null, // { videoId, fileName, videoUrl, videoPath, size, sizeBytes }
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

/**
 * Factory for a new series
 */
export function createDefaultSeries(title = 'រឿងភាគ (Series 1)', seriesId = null) {
  const sId = seriesId || `series_${Date.now()}`;
  return {
    id: sId,
    title,
    createdAt: Date.now(),
    glossary: {
      characters: [], // [{ name, khmerName, gender, voiceId }]
      terms: [], // [{ term, khmerTerm }]
    },
    episodes: [
      createDefaultEpisode(1, 'ភាគទី ១ (EP1)'),
    ],
  };
}

/**
 * Load raw active project from legacy storage (for migration)
 */
/**
 * Detects if a string is corrupted or contains Latin-1 Mojibake / garbage artifacts
 */
export function isCorruptedOrMojibakeTitle(str) {
  if (!str || typeof str !== 'string') return false;
  if (str.includes('\uFFFD')) return true;
  // Common Latin-1 artifacts when decoding UTF-8 Khmer / emoji
  if (/áž|áŸ|á•|á\x9E|ðŸ|â€|ò\||á\|/.test(str)) return true;
  if (/^រឿងភាគ[៖:]\s*[òðá\u00C0-\u00FF]/.test(str)) return true;
  if (/[áàâäãåòóôõöðø][|\s_]+[áàâäãåòóôõöðø]/.test(str)) return true;
  // If string contains multiple pipe characters mixed with letters like ò|||á|||
  if (/(\|{2,}|\|\s*\|)/.test(str)) return true;
  return false;
}

/**
 * Sanitizes and heals series and episodes that may contain stale Mojibake from previous bugs
 */
export function sanitizeAndHealSeriesList(list) {
  if (!Array.isArray(list) || list.length === 0) return list;
  let hasChanges = false;

  for (const s of list) {
    if (!s) continue;

    // 1. Check if series title is corrupted
    if (isCorruptedOrMojibakeTitle(s.title)) {
      let recoveredTitle = null;
      for (const ep of s.episodes || []) {
        const candidate = ep.video?.displayTitle || ep.video?.originalFilename || ep.displayTitle;
        if (candidate && !isCorruptedOrMojibakeTitle(candidate)) {
          recoveredTitle = extractSeriesName(candidate);
          break;
        }
      }
      s.title = recoveredTitle || 'រឿងភាគ (Series 1)';
      hasChanges = true;
    }

    // 2. Validate and enforce sequential 1..N episode numbers and unique IDs (numerically sorted)
    const seenIds = new Set();
    const episodes = s.episodes || [];
    episodes.sort((a, b) => {
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

    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      if (!ep) continue;

      const expectedNum = i + 1;
      const oldNum = ep.episodeNumber;

      if (ep.episodeNumber !== expectedNum) {
        ep.episodeNumber = expectedNum;
        hasChanges = true;
      }

      // Ensure unique episode ID
      let epId = ep.id ? String(ep.id).trim() : `ep_${expectedNum}`;
      while (seenIds.has(epId)) {
        epId = `ep_${expectedNum}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
        hasChanges = true;
      }
      if (ep.id !== epId) {
        ep.id = epId;
        hasChanges = true;
      }
      seenIds.add(epId);

      // 3. Heal title and displayTitle if generic, corrupted, or outdated
      const isGeneric = !ep.title ||
        new RegExp(`^ភាគទី\\s*${oldNum}\\s*\\(EP${oldNum}\\)$`, 'i').test(ep.title.trim()) ||
        /^ភាគទី\s*[\d០-៩]+\s*\(EP[\d០-៩]+\)$/i.test(ep.title.trim()) ||
        /^\(EP[\d០-៩]+\)$/i.test(ep.title.trim()) ||
        /^ភាគទី\s*[\d០-៩]+$/i.test(ep.title.trim()) ||
        /^Episode\s*[\d]+$/i.test(ep.title.trim()) ||
        isCorruptedOrMojibakeTitle(ep.title);

      if (isGeneric) {
        const cleanVidTitle = ep.video?.displayTitle || (ep.video?.originalFilename ? ep.video.originalFilename.replace(/\.[^/.]+$/, '').trim() : null);
        if (cleanVidTitle && !isCorruptedOrMojibakeTitle(cleanVidTitle)) {
          ep.title = `ភាគទី ${expectedNum}: ${cleanVidTitle}`;
        } else {
          ep.title = `ភាគទី ${expectedNum} (EP${expectedNum})`;
        }
        ep.displayTitle = ep.title;
        hasChanges = true;
      } else if (typeof ep.title === 'string' && /^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i.test(ep.title)) {
        const rest = ep.title.replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '').trim();
        ep.title = `ភាគទី ${expectedNum}: ${rest}`;
        if (ep.displayTitle) {
          const restDisplay = ep.displayTitle.replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '').trim();
          ep.displayTitle = `ភាគទី ${expectedNum}: ${restDisplay}`;
        }
        hasChanges = true;
      }

      if (isCorruptedOrMojibakeTitle(ep.displayTitle)) {
        ep.displayTitle = ep.title;
        hasChanges = true;
      }

      if (ep.video && isCorruptedOrMojibakeTitle(ep.video.fileName)) {
        if (ep.video.originalFilename && !isCorruptedOrMojibakeTitle(ep.video.originalFilename)) {
          ep.video.fileName = ep.video.originalFilename;
        } else {
          ep.video.fileName = 'video_source.mp4';
        }
        hasChanges = true;
      }

      if (ep.renderedVideo && !sanitizeRenderedVideo(ep.renderedVideo)) {
        ep.renderedVideo = null;
        if (ep.status === 'completed') {
          ep.status = (ep.audioGenerated && !ep.audioOutdated)
            ? 'voicing'
            : ((Array.isArray(ep.scriptData?.segments) && ep.scriptData.segments.length > 0) ? 'translated' : (ep.video ? 'uploaded' : 'idle'));
        }
        hasChanges = true;
      } else if (
        ep.renderedVideo &&
        typeof ep.renderedVideo === 'object' &&
        ep.renderedVideo.aspectRatio !== undefined &&
        !sanitizeAspectRatio(ep.renderedVideo.aspectRatio)
      ) {
        delete ep.renderedVideo.aspectRatio;
        hasChanges = true;
      }

      if (ep.voiceSettings !== undefined && ep.voiceSettings !== null) {
        if (typeof ep.voiceSettings !== 'object' || Array.isArray(ep.voiceSettings)) {
          ep.voiceSettings = null;
          hasChanges = true;
        } else if (ep.voiceSettings.aspectRatio !== undefined) {
          const cleanRatio = sanitizeAspectRatio(ep.voiceSettings.aspectRatio);
          if (ep.voiceSettings.aspectRatio !== cleanRatio) {
            ep.voiceSettings = { ...ep.voiceSettings, aspectRatio: cleanRatio };
            hasChanges = true;
          }
        }
      }
    }
  }

  if (hasChanges) {
    try {
      localStorage.setItem(STORAGE_SERIES_LIST_KEY, JSON.stringify(list));
    } catch {}
  }
  return list;
}

/**
 * Load raw active project from legacy storage (for migration)
 */
function loadActiveProjectLegacy() {
  try {
    const raw = localStorage.getItem(STORAGE_ACTIVE_PROJECT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Load all series from localStorage with automatic legacy migration & Mojibake auto-healing
 */
export function loadSeriesList() {
  try {
    const raw = localStorage.getItem(STORAGE_SERIES_LIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return sanitizeAndHealSeriesList(parsed);
      }
    }
  } catch (err) {
    console.warn('[Storage] Error loading series list:', err);
  }

  // Automatic Migration from Single Project to Series / EP1
  const legacy = loadActiveProjectLegacy();
  const legacyCleanName = legacy?.fileName && !isCorruptedOrMojibakeTitle(legacy.fileName)
    ? legacy.fileName.replace(/\.[^/.]+$/, '')
    : null;

  const initialSeries = createDefaultSeries(
    legacyCleanName ? `រឿងភាគ៖ ${legacyCleanName}` : 'រឿងភាគ (Series 1)'
  );

  if (legacy && (legacy.videoId || legacy.videoUrl)) {
    initialSeries.episodes[0] = {
      ...initialSeries.episodes[0],
      title: legacyCleanName ? `ភាគទី ១: ${legacyCleanName}` : 'ភាគទី ១ (EP1)',
      status: legacy.renderedVideo ? 'completed' : (legacy.audioGenerated ? 'voicing' : (legacy.scriptData ? 'translated' : 'uploaded')),
      video: {
        videoId: legacy.videoId,
        fileName: legacyCleanName ? legacy.fileName : 'video_source.mp4',
        originalFilename: legacyCleanName ? legacy.fileName : 'video_source.mp4',
        displayTitle: legacyCleanName || 'ភាគទី ១',
        videoUrl: legacy.videoUrl,
        videoPath: legacy.videoPath,
        size: legacy.size,
      },
      metadata: legacy.metadata || null,
      scriptData: legacy.scriptData || null,
      speakerRegistry: legacy.speakerRegistry || {},
      audioGenerated: Boolean(legacy.audioGenerated),
      audioOutdated: Boolean(legacy.audioOutdated),
      fullAudioPath: legacy.fullAudioPath || null,
      fullAudioUrl: legacy.fullAudioUrl || null,
      duration: legacy.duration || 0,
      videoClips: legacy.videoClips || [],
      activeClipId: legacy.activeClipId || null,
      selectedSegmentId: legacy.selectedSegmentId || null,
      renderedVideo: legacy.renderedVideo || null,
      voiceSettings: legacy.voiceSettings || null,
      lastModified: legacy.lastModified || Date.now(),
    };
  }

  saveSeriesList([initialSeries]);
  if (!getActiveSeriesId()) setActiveSeriesId(initialSeries.id);
  if (!getActiveEpisodeId()) setActiveEpisodeId(initialSeries.episodes[0].id);
  return [initialSeries];
}

/**
 * Safely clean legacy and stale keys from localStorage to reclaim quota space
 */
export function cleanStaleStorageKeys() {
  try {
    const keysToRemove = [
      'KHMER_AI_ACTIVE_PROJECT_V2',
      'KHMER_AI_ACTIVE_PROJECT_V1',
      'KHMER_AI_SERIES_LIST_V1',
      'KHMER_AI_PROJECT_V1',
      'KHMER_AI_WORKSPACE_BACKUP',
    ];
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || key === 'undefined' || key === 'null') {
        localStorage.removeItem(key);
      }
    }
  } catch (_) {}
}

/**
 * Trims heavy redundant pipeline properties from segment objects for compact localStorage saving
 */
function trimSegmentForStorage(s) {
  if (!s) return s;
  return {
    _uid: s._uid,
    id: s.id,
    segmentId: s.segmentId,
    startSec: s.startSec ?? s.start ?? 0,
    endSec: s.endSec ?? s.end ?? 0,
    ...(typeof s.duration === 'number' ? { duration: s.duration } : {}),
    ...(typeof s.sourceStartSec === 'number' ? { sourceStartSec: s.sourceStartSec } : {}),
    ...(typeof s.sourceEndSec === 'number' ? { sourceEndSec: s.sourceEndSec } : {}),
    ...(typeof s.audioStartSec === 'number' ? { audioStartSec: s.audioStartSec } : {}),
    ...(typeof s.audioEndSec === 'number' ? { audioEndSec: s.audioEndSec } : {}),
    ...(typeof s.audioDurationSec === 'number' ? { audioDurationSec: s.audioDurationSec } : {}),
    ...(typeof s.finalAudioDuration === 'number' ? { finalAudioDuration: s.finalAudioDuration } : {}),
    ...(typeof s.appliedSpeed === 'number' ? { appliedSpeed: s.appliedSpeed } : {}),
    ...(typeof s.trackRow === 'number' ? { trackRow: s.trackRow } : {}),
    ...(s.trackId ? { trackId: s.trackId } : {}),
    ...(typeof s.subTrackRow === 'number' ? { subTrackRow: s.subTrackRow } : {}),
    ...(s.subTrackId ? { subTrackId: s.subTrackId } : {}),
    ...(s.userShifted !== undefined ? { userShifted: Boolean(s.userShifted) } : {}),
    ...(s.userSubShifted !== undefined ? { userSubShifted: Boolean(s.userSubShifted) } : {}),
    ...(s.userTrimmed !== undefined ? { userTrimmed: Boolean(s.userTrimmed) } : {}),
    ...(s.audioTrimmed !== undefined ? { audioTrimmed: Boolean(s.audioTrimmed) } : {}),
    ...(typeof s.audioOffset === 'number' ? { audioOffset: s.audioOffset } : {}),
    ...(s.audioOverrun !== undefined ? { audioOverrun: Boolean(s.audioOverrun) } : {}),
    ...(typeof s.overrunRatio === 'number' ? { overrunRatio: s.overrunRatio } : {}),
    ...(s.muted !== undefined ? { muted: Boolean(s.muted) } : {}),
    ...(s.isMuted !== undefined ? { isMuted: Boolean(s.isMuted) } : {}),
    khmerText: s.khmerText || s.khmerTranslatedText || s.khmer || '',
    chineseText: s.chineseText || s.originalChineseText || s.originalText || s.original || '',
    speaker: s.speaker || s.speakerName || 'Narrator',
    speakerId: s.speakerId || null,
    voiceGender: s.voiceGender || s.speakerGender || s.gender || 'male',
    voiceId: s.voiceId || s.khmerVoiceId || null,
    audioUrl: s.audioUrl || s.audioFile || s.rawAudioPath || null,
    ...(s.audioPath ? { audioPath: s.audioPath } : {}),
    ...(s.audioFile ? { audioFile: s.audioFile } : {}),
    audioOutdated: Boolean(s.audioOutdated),
    speed: s.speed || 1.0,
    ttsStatus: s.ttsStatus || null,
  };
}

/**
 * Optimizes seriesList for localStorage:
 * Offloads bulky 5,000+ segment arrays of inactive episodes from localStorage,
 * preserving lightweight summary markers (hasScript, totalSegments, status).
 * Full segments are safely persisted and retrieved from the server truth (series.json).
 */
function createStorageOptimizedSeriesList(seriesList) {
  if (!Array.isArray(seriesList)) return [];
  const activeEpId = getActiveEpisodeId();

  return seriesList.map((series) => {
    return {
      ...series,
      episodes: (series.episodes || []).map((ep) => {
        const hasSegments = Array.isArray(ep.scriptData?.segments) && ep.scriptData.segments.length > 0;
        const totalCount = ep.scriptData?.segments?.length || ep.scriptData?.totalSegments || 0;
        const resolvedAudioOutdated = Boolean(ep.audioOutdated);
        const resolvedAudioGenerated = Boolean(ep.audioGenerated || (!resolvedAudioOutdated && ep.fullAudioUrl));
        const resolvedHasAudio = Boolean(ep.hasAudio || resolvedAudioGenerated);

        // For the active episode currently open, keep slimmed essential segment data in localStorage
        if (ep.id === activeEpId && hasSegments) {
          return {
            ...ep,
            audioGenerated: resolvedAudioGenerated,
            hasAudio: resolvedHasAudio,
            audioOutdated: resolvedAudioOutdated,
            fullAudioUrl: ep.fullAudioUrl || null,
            fullAudioPath: ep.fullAudioPath || null,
            renderedVideo: sanitizeRenderedVideo(ep.renderedVideo),
            scriptData: {
              ...ep.scriptData,
              hasScript: true,
              totalSegments: totalCount,
              segments: (ep.scriptData.segments || [])
                .filter((s) => s && typeof s === 'object')
                .map(trimSegmentForStorage)
                .filter(Boolean),
            },
          };
        }

        // For inactive episodes, keep metadata & summary count without the 4MB segment array
        if (hasSegments || (ep.scriptData?.hasScript && totalCount > 0)) {
          return {
            ...ep,
            status: (ep.status === 'uploaded' || !ep.status) ? 'translated' : ep.status,
            audioGenerated: resolvedAudioGenerated,
            hasAudio: resolvedHasAudio,
            audioOutdated: resolvedAudioOutdated,
            fullAudioUrl: ep.fullAudioUrl || null,
            fullAudioPath: ep.fullAudioPath || null,
            renderedVideo: sanitizeRenderedVideo(ep.renderedVideo),
            scriptData: {
              mode: ep.scriptData?.mode || 'dialogue',
              generationMode: ep.scriptData?.generationMode || ep.generationMode,
              genre: ep.scriptData?.genre || 'auto',
              hasScript: totalCount > 0,
              totalSegments: totalCount,
              updatedAt: ep.scriptData?.updatedAt || 0,
              segments: [], // Offload bulky array from localStorage to backend server truth (series.json)
            },
          };
        }

        return ep.renderedVideo
          ? { ...ep, renderedVideo: sanitizeRenderedVideo(ep.renderedVideo) }
          : ep;
      }),
    };
  });
}

/**
 * Save series list to localStorage with quota-safety and automatic payload trimming
 */
export function saveSeriesList(seriesList) {
  if (!Array.isArray(seriesList)) return;
  try {
    const optimized = createStorageOptimizedSeriesList(seriesList);
    localStorage.setItem(STORAGE_SERIES_LIST_KEY, JSON.stringify(optimized));
  } catch (err) {
    if (err.name === 'QuotaExceededError' || err.code === 22 || err.number === -2147024882) {
      console.warn('[Storage] QuotaExceededError: cleaning legacy caches and applying ultra-compact save...');
      try {
        cleanStaleStorageKeys();
        
        // Ultra-compact fallback: keep only structural ids & titles
        const ultraCompact = seriesList.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          glossary: s.glossary || { characters: [], terms: [] },
          episodes: (s.episodes || []).map((e) => {
            const isOutdated = Boolean(e.audioOutdated);
            const hasGen = Boolean(e.audioGenerated || (!isOutdated && e.fullAudioUrl));
            return {
              id: e.id,
              episodeNumber: e.episodeNumber,
              title: e.title,
              displayTitle: e.displayTitle,
              duration: e.duration || 0,
              status: e.status || 'idle',
              video: e.video ? { videoId: e.video.videoId, fileName: e.video.fileName, videoPath: e.video.videoPath, duration: e.video.duration } : null,
              hasScript: (e.scriptData?.segments?.length || e.scriptData?.totalSegments || 0) > 0,
              totalSegments: e.scriptData?.segments?.length || e.scriptData?.totalSegments || 0,
              audioGenerated: hasGen,
              hasAudio: Boolean(e.hasAudio || hasGen),
              audioOutdated: isOutdated,
              fullAudioUrl: e.fullAudioUrl || null,
              fullAudioPath: e.fullAudioPath || null,
              scriptData: e.scriptData
                ? {
                    mode: e.scriptData.mode,
                    hasScript: (e.scriptData.segments?.length || e.scriptData.totalSegments || 0) > 0,
                    totalSegments: e.scriptData.segments?.length || e.scriptData.totalSegments || 0,
                    updatedAt: e.scriptData.updatedAt || 0,
                  }
                : null,
            };
          }),
        }));
        localStorage.setItem(STORAGE_SERIES_LIST_KEY, JSON.stringify(ultraCompact));
        console.log('[Storage] ✅ Ultra-compact series list saved cleanly to localStorage.');
      } catch (innerErr) {
        console.warn('[Storage] Could not write to localStorage; server truth is safely active on disk.');
      }
    } else {
      console.warn('[Storage] Error saving series list:', err);
    }
  }
}

/**
 * Active Series ID
 */
export function getActiveSeriesId() {
  return localStorage.getItem(STORAGE_ACTIVE_SERIES_ID_KEY) || null;
}

export function setActiveSeriesId(id) {
  if (id) localStorage.setItem(STORAGE_ACTIVE_SERIES_ID_KEY, String(id));
  else localStorage.removeItem(STORAGE_ACTIVE_SERIES_ID_KEY);
}

/**
 * Active Episode ID
 */
export function getActiveEpisodeId() {
  return localStorage.getItem(STORAGE_ACTIVE_EPISODE_ID_KEY) || null;
}

export function setActiveEpisodeId(id) {
  if (id) localStorage.setItem(STORAGE_ACTIVE_EPISODE_ID_KEY, String(id));
  else localStorage.removeItem(STORAGE_ACTIVE_EPISODE_ID_KEY);
}

/**
 * Load active series and active episode cleanly
 */
export function loadActiveSeriesAndEpisode() {
  const seriesList = loadSeriesList();
  let seriesId = getActiveSeriesId();
  let series = seriesList.find((s) => s.id === seriesId) || seriesList[0];

  if (!series) {
    series = createDefaultSeries();
    seriesList.push(series);
    saveSeriesList(seriesList);
  }

  let episodeId = getActiveEpisodeId();
  let episode = (series.episodes || []).find((e) => e.id === episodeId) || series.episodes?.[0];

  if (!episode) {
    episode = createDefaultEpisode(1);
    series.episodes = [episode];
    saveSeriesList(seriesList);
  }

  if (!seriesId || series.id === seriesId) {
    setActiveSeriesId(series.id);
    if (!episodeId || episode.id === episodeId) {
      setActiveEpisodeId(episode.id);
    }
  }

  return {
    seriesList,
    series,
    episode,
  };
}

/**
 * Extracts a clean drama series name from an episode title or filename
 * e.g. "រឿងភាគចិន ភាគ១" -> "រឿងភាគចិន", "My Drama Ep 2" -> "My Drama"
 */
export function extractSeriesName(title) {
  if (!title || typeof title !== 'string') return 'រឿងភាគ (Series 1)';
  const stripped = title
    .replace(/[\s_-]*(?:ភាគ|ភាគទី|ep|episode|e)[\s_-]*[\d០-៩]+.*$/i, '')
    .trim();
  return stripped && stripped.length >= 2 ? stripped : title.trim();
}

/**
 * Helper to sync series state to backend with offline detection
 */
export function syncSeriesToBackend(series) {
  if (!series?.id) return;
  syncSeriesApi(series).catch((err) => {
    console.warn('[Storage] Failed to sync series to backend:', err?.message || err);
    const message = '⚠️ បរាជ័យក្នុងការរក្សាទុកទៅ Server — សូមពិនិត្យ Backend ហើយព្យាយាមម្ដងទៀត!';
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('timeline:toast', { detail: { message } }));
    }
    if (typeof document !== 'undefined') {
      let toast = document.getElementById('timeline-split-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'timeline-split-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.style.position = 'fixed';
        toast.style.bottom = '32px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toast.style.maxWidth = 'min(92vw, 760px)';
        toast.style.backgroundColor = 'rgba(127, 29, 29, 0.96)';
        toast.style.color = '#fef2f2';
        toast.style.padding = '10px 20px';
        toast.style.borderRadius = '14px';
        toast.style.fontSize = '13.5px';
        toast.style.fontWeight = '500';
        toast.style.zIndex = '99999';
        toast.style.pointerEvents = 'none';
        toast.style.boxShadow = '0 12px 30px -4px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(248, 113, 113, 0.35)';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.style.opacity = '1';
      if (toast._hideTimer) clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => {
        if (toast) toast.style.opacity = '0';
      }, 4500);
    }
  });
}

function getLocalSegmentIdentityKeys(segment) {
  if (!segment || typeof segment !== 'object') return [];
  const keys = [];
  if (segment._uid !== undefined && segment._uid !== null && String(segment._uid)) keys.push(`uid:${String(segment._uid)}`);
  if (segment.id !== undefined && segment.id !== null && String(segment.id)) keys.push(`id:${String(segment.id)}`);
  if (segment.segmentId !== undefined && segment.segmentId !== null && String(segment.segmentId)) keys.push(`segmentId:${String(segment.segmentId)}`);
  if (keys.length === 0) {
    keys.push(`fallback:${String(segment.startSec ?? segment.start ?? '')}|${String(segment.endSec ?? segment.end ?? '')}|${String(segment.chineseText ?? segment.originalText ?? segment.khmerText ?? segment.text ?? '')}`);
  }
  return keys;
}

function uniqueKeys(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(String))];
}

/** Update local episode state immediately for a delete or undo/redo without a stale full-series sync. */
export function saveTimelineOperationToLocalStorage({
  seriesId,
  episodeId,
  operation = 'delete',
  track = null,
  items = null,
  deletedItem = null,
  segments = null,
  videoClips = null,
}) {
  if (!seriesId || !episodeId) return null;
  const list = loadSeriesList();
  const series = list.find((entry) => entry.id === seriesId);
  const episode = series?.episodes?.find((entry) => entry.id === episodeId);
  if (!series || !episode) return null;

  const now = Date.now();
  const timestamps = {};
  const tombstonesUpdatedAt = Math.max(now, Number(episode.timelineTombstonesUpdatedAt || 0) + 1);
  const mergeTombstones = (existing, add = [], remove = []) => {
    const removed = new Set(remove.map(String));
    const next = new Set(uniqueKeys(existing).filter((key) => !removed.has(key)));
    add.forEach((key) => key && next.add(String(key)));
    return [...next];
  };

  if (operation === 'delete' && track === 'segments' && Array.isArray(items)) {
    const updatedAt = Math.max(now, Number(episode.scriptData?.updatedAt || 0) + 1);
    episode.deletedSegmentKeys = mergeTombstones(
      episode.deletedSegmentKeys,
      deletedItem ? getLocalSegmentIdentityKeys(deletedItem) : []
    );
    episode.timelineTombstonesUpdatedAt = tombstonesUpdatedAt;
    episode.scriptData = {
      ...(episode.scriptData || {}),
      segments: items,
      hasScript: items.length > 0,
      totalSegments: items.length,
      explicitClear: items.length === 0,
      updatedAt,
    };
    timestamps.updatedAt = updatedAt;
  } else if (operation === 'delete' && track === 'videoClips' && Array.isArray(items)) {
    const updatedAt = Math.max(now, Number(episode.videoClipsUpdatedAt || 0) + 1);
    episode.videoClips = items;
    episode.videoClipsUpdatedAt = updatedAt;
    if (deletedItem?.id !== undefined && deletedItem?.id !== null) {
      episode.deletedVideoClipIds = mergeTombstones(episode.deletedVideoClipIds, [String(deletedItem.id)]);
    }
    if (Array.isArray(segments)) {
      const segUpdatedAt = Math.max(now, Number(episode.scriptData?.updatedAt || 0) + 1);
      episode.scriptData = {
        ...(episode.scriptData || {}),
        segments,
        hasScript: segments.length > 0,
        totalSegments: segments.length,
        explicitClear: segments.length === 0,
        updatedAt: segUpdatedAt,
      };
      timestamps.updatedAt = segUpdatedAt;
    }
    episode.timelineTombstonesUpdatedAt = tombstonesUpdatedAt;
    timestamps.videoClipsUpdatedAt = updatedAt;
  } else if (operation === 'restore' && Array.isArray(segments) && Array.isArray(videoClips)) {
    const oldSegments = episode.scriptData?.segments || [];
    const restoredSegmentKeys = new Set(segments.flatMap((segment) => getLocalSegmentIdentityKeys(segment)));
    const oldDeletedSegmentKeys = new Set(uniqueKeys(episode.deletedSegmentKeys));
    const addedSegmentTombstones = oldSegments
      .filter((segment) => !getLocalSegmentIdentityKeys(segment).some((key) => restoredSegmentKeys.has(key)))
      .flatMap((segment) => getLocalSegmentIdentityKeys(segment));
    const clearedSegmentTombstones = [...restoredSegmentKeys].filter((key) => oldDeletedSegmentKeys.has(key));
    episode.deletedSegmentKeys = mergeTombstones(episode.deletedSegmentKeys, addedSegmentTombstones, clearedSegmentTombstones);

    const oldClips = Array.isArray(episode.videoClips) ? episode.videoClips : [];
    const restoredClipIds = new Set(videoClips.map((clip) => String(clip?.id ?? '')).filter(Boolean));
    const oldDeletedClipIds = new Set(uniqueKeys(episode.deletedVideoClipIds));
    const addedClipTombstones = oldClips.map((clip) => String(clip?.id ?? '')).filter((id) => id && !restoredClipIds.has(id));
    const clearedClipTombstones = [...restoredClipIds].filter((id) => oldDeletedClipIds.has(id));
    episode.deletedVideoClipIds = mergeTombstones(episode.deletedVideoClipIds, addedClipTombstones, clearedClipTombstones);
    episode.timelineTombstonesUpdatedAt = tombstonesUpdatedAt;

    const updatedAt = Math.max(now, Number(episode.scriptData?.updatedAt || 0) + 1);
    const videoClipsUpdatedAt = Math.max(now, Number(episode.videoClipsUpdatedAt || 0) + 1);
    episode.scriptData = {
      ...(episode.scriptData || {}),
      segments,
      hasScript: segments.length > 0,
      totalSegments: segments.length,
      explicitClear: segments.length === 0,
      updatedAt,
    };
    episode.videoClips = videoClips;
    episode.videoClipsUpdatedAt = videoClipsUpdatedAt;
    timestamps.updatedAt = updatedAt;
    timestamps.videoClipsUpdatedAt = videoClipsUpdatedAt;
  } else if (operation === 'update_segments' && Array.isArray(segments)) {
    const updatedAt = Math.max(now, Number(episode.scriptData?.updatedAt || 0) + 1);
    episode.scriptData = {
      ...(episode.scriptData || {}),
      segments,
      hasScript: segments.length > 0,
      totalSegments: segments.length,
      explicitClear: segments.length === 0,
      updatedAt,
    };
    timestamps.updatedAt = updatedAt;
  } else {
    return null;
  }

  const prevRenderedAt = Number(episode.renderedVideo?.renderedAt || 0);
  episode.renderedVideo = null;
  episode.renderInvalidatedAt = Math.max(now, Number(episode.renderInvalidatedAt || 0) + 1, prevRenderedAt > 0 ? prevRenderedAt + 1 : 0);
  if (episode.status === 'completed') {
    episode.status = episode.audioGenerated ? 'voicing' : 'translated';
  }
  episode.lastModified = Math.max(now, Number(episode.lastModified || 0) + 1);
  saveSeriesList(list);
  return timestamps;
}

/**
 * Save specific episode state into series list in localStorage
 */
export function saveEpisodeState(seriesId, episodeId, stateData) {
  if (!seriesId || !episodeId || !stateData) return;
  try {
    const list = loadSeriesList();
    const sIdx = list.findIndex((s) => s.id === seriesId);
    if (sIdx === -1) return;

    const series = list[sIdx];
    const eIdx = (series.episodes || []).findIndex((e) => e.id === episodeId);
    if (eIdx === -1) return;

    const prevEp = series.episodes[eIdx];
    const vid = stateData.video || prevEp.video;

    // Separate clean displayTitle and originalFilename supporting full Khmer Unicode
    const rawFileName = vid?.originalFilename || vid?.fileName || null;
    const cleanDisplayTitle = vid?.displayTitle || (rawFileName ? rawFileName.replace(/\.[^/.]+$/, '').trim() : null);

    // Determine episode title: preserve existing custom title, or if it was the default generic "ភាគទី X (EPX)", update to show the title
    let episodeTitle = stateData.title || prevEp.title;
    const isGenericDefault = !episodeTitle || /^ភាគទី\s*[\d០-៩]+\s*\(EP[\d០-៩]+\)$/i.test(episodeTitle) || /^Episode\s*\d+$/i.test(episodeTitle);

    if (isGenericDefault && cleanDisplayTitle) {
      episodeTitle = `ភាគទី ${prevEp.episodeNumber || (eIdx + 1)}: ${cleanDisplayTitle}`;
    }

    // Auto-update Series title if series title is generic default OR corrupted, and a Khmer title is present
    const isSeriesGenericOrCorrupted = !series.title ||
      /^រឿងភាគ\s*\(Series\s*\d+\)$/i.test(series.title) ||
      /^Series\s*\d+$/i.test(series.title) ||
      isCorruptedOrMojibakeTitle(series.title) ||
      /^រឿងភាគ[៖:]\s*[òðá\u00C0-\u00FF]/.test(series.title);

    if (isSeriesGenericOrCorrupted && cleanDisplayTitle && !isCorruptedOrMojibakeTitle(cleanDisplayTitle)) {
      const derivedSeriesName = extractSeriesName(cleanDisplayTitle);
      if (derivedSeriesName && !isCorruptedOrMojibakeTitle(derivedSeriesName)) {
        series.title = derivedSeriesName;
      }
    }

    // Defensive Preservation Guard: Never wipe valid scriptData, audio, or clips with nulls on stale/uninitialized updates
    const incomingScriptUpdatedAt = Number(stateData.scriptData?.updatedAt || 0);
    const previousScriptUpdatedAt = Number(prevEp.scriptData?.updatedAt || 0);
    const staleScriptSnapshot = Boolean(
      stateData.scriptData &&
      prevEp.scriptData &&
      incomingScriptUpdatedAt < previousScriptUpdatedAt
    );
    const mergedScriptCandidate = staleScriptSnapshot ? prevEp.scriptData : stateData.scriptData;
    const mergedScriptData = (mergedScriptCandidate && (
      mergedScriptCandidate.segments?.length > 0 ||
      mergedScriptCandidate.title ||
      mergedScriptCandidate.explicitClear
    ))
      ? mergedScriptCandidate
      : (stateData.clearScript ? null : (prevEp.scriptData || stateData.scriptData));
    const deletedSegmentKeys = new Set(uniqueKeys(prevEp.deletedSegmentKeys));
    const mergedScriptDataWithDeletes = mergedScriptData && Array.isArray(mergedScriptData.segments)
      ? (() => {
          const keptSegments = mergedScriptData.segments.filter((segment) =>
            segment?._uid !== undefined && segment?._uid !== null && String(segment._uid)
              ? !deletedSegmentKeys.has(`uid:${String(segment._uid)}`)
              : !getLocalSegmentIdentityKeys(segment).some((key) => deletedSegmentKeys.has(key))
          );
          return keptSegments.length === mergedScriptData.segments.length
            ? mergedScriptData
            : {
                ...mergedScriptData,
                segments: keptSegments,
                hasScript: keptSegments.length > 0,
                totalSegments: keptSegments.length,
                explicitClear: keptSegments.length === 0,
              };
        })()
      : mergedScriptData;

    const mergedSpeakerRegistry = (stateData.speakerRegistry && Object.keys(stateData.speakerRegistry).length > 0)
      ? stateData.speakerRegistry
      : (prevEp.speakerRegistry || {});

    const mergedFullAudioPath = (stateData.clearAudio || stateData.clearScript)
      ? null
      : (stateData.fullAudioPath !== undefined ? stateData.fullAudioPath : prevEp.fullAudioPath);
    const mergedFullAudioUrl = (stateData.clearAudio || stateData.clearScript)
      ? null
      : (stateData.fullAudioUrl !== undefined ? stateData.fullAudioUrl : prevEp.fullAudioUrl);

    const mergedAudioOutdated = (stateData.clearAudio || stateData.clearScript)
      ? false
      : (stateData.audioOutdated !== undefined ? Boolean(stateData.audioOutdated) : Boolean(prevEp.audioOutdated));

    const mergedAudioGenerated = (stateData.clearAudio || stateData.clearScript)
      ? false
      : stateData.audioGenerated !== undefined
        ? Boolean(stateData.audioGenerated || (!mergedAudioOutdated && mergedFullAudioUrl))
        : Boolean(prevEp.audioGenerated || (!mergedAudioOutdated && mergedFullAudioUrl));

    const mergedHasAudio = (stateData.clearAudio || stateData.clearScript)
      ? false
      : (stateData.hasAudio !== undefined ? Boolean(stateData.hasAudio) : mergedAudioGenerated);

    const incomingVideoClipsUpdatedAt = Number(stateData.videoClipsUpdatedAt || 0);
    const previousVideoClipsUpdatedAt = Number(prevEp.videoClipsUpdatedAt || 0);
    const staleVideoClipsSnapshot = incomingVideoClipsUpdatedAt < previousVideoClipsUpdatedAt;
    const rawVideoClips = !staleVideoClipsSnapshot && Array.isArray(stateData.videoClips) && (
      stateData.videoClips.length > 0 || incomingVideoClipsUpdatedAt > 0
    )
      ? stateData.videoClips
      : (prevEp.videoClips || []);
    const deletedVideoClipIds = new Set(uniqueKeys(prevEp.deletedVideoClipIds));
    const mergedVideoClips = rawVideoClips.filter((clip) => !deletedVideoClipIds.has(String(clip?.id ?? '')));

    const mergedRenderInvalidatedAt = Math.max(
      Number(prevEp.renderInvalidatedAt || 0),
      Number(stateData.renderInvalidatedAt || 0)
    );
    const rawMergedRenderedVideo = (stateData.clearAudio || stateData.clearScript)
      ? null
      : (stateData.renderedVideo !== undefined
        ? sanitizeRenderedVideo(stateData.renderedVideo)
        : sanitizeRenderedVideo(prevEp.renderedVideo));
    const mergedRenderedVideo = (
      rawMergedRenderedVideo &&
      mergedRenderInvalidatedAt > 0 &&
      Number(rawMergedRenderedVideo.renderedAt || 0) <= mergedRenderInvalidatedAt
    )
      ? null
      : rawMergedRenderedVideo;

    const rawVoiceSettings = stateData.voiceSettings !== undefined
      ? stateData.voiceSettings
      : prevEp.voiceSettings;
    const sanitizedVoiceSettings = rawVoiceSettings && typeof rawVoiceSettings === 'object' && !Array.isArray(rawVoiceSettings)
      ? stripLogoSettings({ ...rawVoiceSettings, aspectRatio: sanitizeAspectRatio(rawVoiceSettings.aspectRatio) })
      : (rawVoiceSettings === null ? null : stripLogoSettings(prevEp.voiceSettings) || null);

    const updatedEp = {
      ...prevEp,
      ...stateData,
      scriptData: mergedScriptDataWithDeletes,
      speakerRegistry: mergedSpeakerRegistry,
      audioGenerated: mergedAudioGenerated,
      hasAudio: mergedHasAudio,
      audioOutdated: mergedAudioOutdated,
      fullAudioPath: mergedFullAudioPath,
      fullAudioUrl: mergedFullAudioUrl,
      renderedVideo: mergedRenderedVideo,
      ...(mergedRenderInvalidatedAt > 0 ? { renderInvalidatedAt: mergedRenderInvalidatedAt } : {}),
      videoClips: mergedVideoClips,
      videoClipsUpdatedAt: staleVideoClipsSnapshot
        ? previousVideoClipsUpdatedAt
        : Number(stateData.videoClipsUpdatedAt || prevEp.videoClipsUpdatedAt || 0),
      voiceSettings: sanitizedVoiceSettings,
      title: episodeTitle,
      displayTitle: cleanDisplayTitle
        ? `ភាគទី ${prevEp.episodeNumber || (eIdx + 1)}: ${cleanDisplayTitle}`
        : (prevEp.displayTitle || episodeTitle),
      episodeNumber: prevEp.episodeNumber || (eIdx + 1),
      originalFilename: rawFileName || prevEp.originalFilename,
      id: episodeId,
      schemaVersion: SCHEMA_VERSION,
      lastModified: Date.now(),
    };

    if (vid) {
      updatedEp.video = {
        ...vid,
        fileName: rawFileName || vid.fileName,
        originalFilename: rawFileName || vid.originalFilename || vid.fileName,
        displayTitle: cleanDisplayTitle || vid.displayTitle,
      };
    }

    // Auto-update episode status
    if (updatedEp.renderedVideo) {
      updatedEp.status = 'completed';
    } else if (updatedEp.audioGenerated && !updatedEp.audioOutdated) {
      updatedEp.status = 'voicing';
    } else if (Array.isArray(updatedEp.scriptData?.segments) && updatedEp.scriptData.segments.length > 0) {
      updatedEp.status = 'translated';
    } else if (updatedEp.video?.videoId || updatedEp.video?.videoUrl) {
      updatedEp.status = 'uploaded';
    } else {
      updatedEp.status = 'idle';
    }

    series.episodes[eIdx] = updatedEp;

    // Auto-update series glossary if speakerRegistry or scriptData has characters
    if (stateData.speakerRegistry || stateData.scriptData) {
      const extracted = extractGlossaryFromEpisode(
        stateData.scriptData || prevEp.scriptData,
        stateData.speakerRegistry || prevEp.speakerRegistry
      );
      if (extracted.characters.length > 0) {
        const mergedCharacters = [...(series.glossary?.characters || [])];
        for (const ch of extracted.characters) {
          const existingIdx = mergedCharacters.findIndex((m) => m.name.toLowerCase() === ch.name.toLowerCase());
          if (existingIdx !== -1) {
            mergedCharacters[existingIdx] = { ...mergedCharacters[existingIdx], ...ch };
          } else {
            mergedCharacters.push(ch);
          }
        }
        series.glossary = {
          ...(series.glossary || {}),
          characters: mergedCharacters,
        };
      }
    }

    list[sIdx] = series;
    saveSeriesList(list);

    // Also sync to active project key for backwards compatibility
    if (getActiveEpisodeId() === episodeId) {
      try {
        const legacySave = {
          ...updatedEp,
          videoId: updatedEp.video?.videoId,
          fileName: updatedEp.video?.fileName,
          videoUrl: updatedEp.video?.videoUrl,
          videoPath: updatedEp.video?.videoPath,
          size: updatedEp.video?.size,
        };
        localStorage.setItem(STORAGE_ACTIVE_PROJECT_KEY, JSON.stringify(legacySave));
      } catch (_) {}
    }

    // Background sync to backend for server-side persistence
    try {
      syncSeriesToBackend(series);
    } catch (_) {}

    return list;
  } catch (err) {
    console.warn('[Storage] Error saving episode state:', err);
    return null;
  }
}

/**
 * Add a new Episode to a series using reliable numbering and ID isolation
 */
export function addNewEpisodeToSeries(seriesId, customTitle = null) {
  const list = loadSeriesList();
  const sIdx = list.findIndex((s) => s.id === seriesId);
  if (sIdx === -1) return null;

  const series = list[sIdx];
  const existing = series.episodes || [];
  const nextNum = getNextAvailableEpisodeNumber(existing);
  const safeTitle = (typeof customTitle === 'string' && customTitle.trim()) ? customTitle.trim() : null;
  const newEp = createDefaultEpisode(nextNum, safeTitle || `ភាគទី ${nextNum} (EP${nextNum})`, null, existing);

  series.episodes = [...existing, newEp];
  list[sIdx] = series;
  saveSeriesList(list);

  // Background sync to backend for server-side persistence
  try {
    syncSeriesToBackend(series);
  } catch (_) {}

  return newEp;
}

/**
 * Delete an episode from a series (preserves remaining episodes)
 */
export function deleteEpisodeFromSeries(seriesId, episodeId) {
  const list = loadSeriesList();
  let sIdx = list.findIndex((s) => String(s.id) === String(seriesId));
  if (sIdx === -1 || !list[sIdx]?.episodes?.some((e) => String(e.id) === String(episodeId))) {
    sIdx = list.findIndex((s) => s.episodes?.some((e) => String(e.id) === String(episodeId)));
  }
  if (sIdx === -1 && list.length > 0) {
    sIdx = 0;
  }
  if (sIdx === -1) return false;

  const series = list[sIdx];

  series.episodes = (series.episodes || []).filter((e) => String(e.id) !== String(episodeId));

  // If the only episode was deleted, create a fresh empty EP1 so the series remains valid
  if (series.episodes.length === 0) {
    const freshEp = createDefaultEpisode(1, 'ភាគទី ១ (EP1)', null, []);
    series.episodes = [freshEp];
    setActiveEpisodeId(freshEp.id);
  } else {
    // Renumber remaining episodes sequentially (1..N)
    series.episodes.forEach((ep, idx) => {
      const newNum = idx + 1;
      const oldNum = ep.episodeNumber;
      ep.episodeNumber = newNum;

      const isGeneric = !ep.title ||
        new RegExp(`^ភាគទី\\s*${oldNum}\\s*\\(EP${oldNum}\\)$`, 'i').test(ep.title.trim()) ||
        /^ភាគទី\s*[\d០-៩]+\s*\(EP[\d០-៩]+\)$/i.test(ep.title.trim()) ||
        /^\(EP[\d០-៩]+\)$/i.test(ep.title.trim()) ||
        /^ភាគទី\s*[\d០-៩]+$/i.test(ep.title.trim()) ||
        /^Episode\s*[\d]+$/i.test(ep.title.trim());

      if (isGeneric) {
        ep.title = `ភាគទី ${newNum} (EP${newNum})`;
        ep.displayTitle = ep.title;
      } else if (typeof ep.title === 'string' && /^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i.test(ep.title)) {
        const rest = ep.title.replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '').trim();
        ep.title = `ភាគទី ${newNum}: ${rest}`;
        if (ep.displayTitle) {
          const restDisplay = ep.displayTitle.replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '').trim();
          ep.displayTitle = `ភាគទី ${newNum}: ${restDisplay}`;
        }
      }
    });

    if (String(getActiveEpisodeId()) === String(episodeId)) {
      setActiveEpisodeId(series.episodes[0].id);
    }
  }

  list[sIdx] = series;
  saveSeriesList(list);

  // Background sync delete on backend (DELETE endpoint persists deletion directly without clobbering series.json)
  try {
    deleteEpisodeApi(series.id, episodeId).catch(() => {});
  } catch (_) {}

  return true;
}

/**
 * Update Series Title
 */
export function updateSeriesTitle(seriesId, newTitle) {
  if (!seriesId || !newTitle) return;
  const list = loadSeriesList();
  const sIdx = list.findIndex((s) => s.id === seriesId);
  if (sIdx === -1) return;
  list[sIdx].title = newTitle;
  saveSeriesList(list);
}

/**
 * Extract glossary character names & terms from an episode
 */
export function extractGlossaryFromEpisode(scriptData, speakerRegistry) {
  const characters = [];
  const registry = speakerRegistry || {};

  const detectGender = (spk, name, fallback) => {
    const rawG = String(spk?.gender || spk?.speakerGender || '').toLowerCase();
    if (rawG === 'female' || rawG === 'male') return rawG;
    if (spk?.voiceId && spk.voiceId.includes('Sreymom')) return 'female';
    if (spk?.voiceId && spk.voiceId.includes('Piseth')) return 'male';
    if (name && /ស្រី|នាង|យាយ|ម៉ែ|កញ្ញា|ជំទាវ/i.test(name)) return 'female';
    return fallback || 'male';
  };

  Object.values(registry).forEach((spk) => {
    if (spk.name && spk.name !== 'Unknown' && !characters.some((c) => c.name === spk.name)) {
      characters.push({
        id: spk.id || spk.speakerId,
        name: spk.name,
        khmerName: spk.khmerName || spk.name,
        gender: detectGender(spk, spk.name, 'male'),
        voiceId: spk.voiceId || null,
      });
    }
  });

  (scriptData?.segments || []).forEach((seg) => {
    const rawSpeaker = (seg.speaker || '').trim();
    if (rawSpeaker && rawSpeaker !== 'Unknown' && !characters.some((c) => c.name === rawSpeaker)) {
      characters.push({
        name: rawSpeaker,
        khmerName: rawSpeaker,
        gender: detectGender(seg, rawSpeaker, 'male'),
        voiceId: seg.voiceId || null,
      });
    }
  });

  return { characters, terms: [] };
}

/**
 * Compatibility wrapper: clearActiveProject
 */
export function clearActiveProject() {
  const seriesId = getActiveSeriesId();
  const episodeId = getActiveEpisodeId();
  if (seriesId && episodeId) {
    const list = loadSeriesList();
    const sIdx = list.findIndex((s) => s.id === seriesId);
    if (sIdx !== -1) {
      const eIdx = list[sIdx].episodes.findIndex((e) => e.id === episodeId);
      if (eIdx !== -1) {
        list[sIdx].episodes[eIdx] = createDefaultEpisode(
          list[sIdx].episodes[eIdx].episodeNumber,
          list[sIdx].episodes[eIdx].title
        );
        saveSeriesList(list);
      }
    }
  }
}
