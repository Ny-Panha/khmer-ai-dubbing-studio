import { SCHEMA_VERSION } from './timestampUtils.js';
import { syncSeriesApi, deleteEpisodeApi, persistTimelineOperationApi } from '../services/api.js';
import { stripLogoSettings, stripCustomizeSettings } from './logoSettingsStorage.js';

export const STORAGE_SERIES_LIST_KEY = 'KHMER_AI_SERIES_LIST_V2';
export const STORAGE_ACTIVE_SERIES_ID_KEY = 'KHMER_AI_ACTIVE_SERIES_ID';
export const STORAGE_ACTIVE_EPISODE_ID_KEY = 'KHMER_AI_ACTIVE_EPISODE_ID';
export const STORAGE_ACTIVE_PROJECT_KEY = 'KHMER_AI_ACTIVE_PROJECT_V3';
export const STORAGE_VOICE_SETTINGS_KEY = 'KHMER_AI_DUBBING_VOICE_SETTINGS';
export const STORAGE_GLOBAL_VIDEO_EDIT_SETTINGS_KEY = 'KHMER_AI_GLOBAL_VIDEO_EDIT_SETTINGS_V1';
export const STORAGE_VIDEO_EDIT_SCOPE_KEY = 'KHMER_AI_VIDEO_EDIT_SCOPE_V1';

export const VIDEO_EDIT_SETTING_KEYS = Object.freeze([
  'enableMirrorFlip',
  'zoomScale',
  'enableColorGrade',
  'youtubeSafeAudio',
]);

export const VALID_VIDEO_EDIT_SCOPES = Object.freeze(['episode', 'folder', 'global']);

export const DEFAULT_VIDEO_EDIT_SETTINGS = Object.freeze({
  enableMirrorFlip: false,
  zoomScale: 1.0,
  enableColorGrade: false,
  youtubeSafeAudio: false,
});

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
  antiTheftBgStyle: 'dark',
  antiTheftBlur: 18,
  antiTheftHeight: null,
  enableCornerMask: false,
  cornerMaskText: '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»',
  cornerMaskStyle: 'badge',
  cornerMaskPosition: 'top-right',
  cornerMaskWidth: 220,
  cornerMaskHeight: 54,
  cornerMaskOpacity: 0.95,
  cornerMaskBlur: 18,
  cornerMaskOffsetX: 14,
  cornerMaskOffsetY: 14,
  enableMirrorFlip: false,
  zoomScale: 1.0,
  enableColorGrade: false,
  youtubeSafeAudio: false,
  enableCustomBgm: false,
  customBgmUrl: null,
  customBgmPath: null,
  customBgmName: null,
  customBgmDuration: 0,
};

// The floating Customize toolbar controls are shared across all episodes.
// Logo settings live in their dedicated global store; these non-logo visual keys
// inherit the last explicitly saved workspace settings instead of stale episode data.
// Note: Video Edit Settings (enableMirrorFlip, zoomScale, enableColorGrade, youtubeSafeAudio)
// are managed by the explicit 3-scope resolver (Current Episode / Current Folder / All Folders).
export const STICKY_CUSTOMIZE_SETTING_KEYS = Object.freeze([
  'enableCornerMask', 'cornerMaskText', 'cornerMaskStyle', 'cornerMaskPosition',
  'cornerMaskWidth', 'cornerMaskHeight', 'cornerMaskOpacity', 'cornerMaskBlur',
  'cornerMaskOffsetX', 'cornerMaskOffsetY',
  'enableAntiTheft', 'marqueeText', 'marqueeSpeed', 'marqueePosition',
  'marqueeTextColor', 'antiTheftSize', 'antiTheftHeight', 'antiTheftBottomPercent', 'antiTheftBgStyle', 'antiTheftBlur',
  'enableWatermark', 'watermarkText', 'watermarkPosition', 'watermarkColor',
  'enableCustomBgm', 'customBgmUrl', 'customBgmPath', 'customBgmName', 'customBgmDuration',
]);

export function normalizeVideoEditSettings(input, fallback = DEFAULT_VIDEO_EDIT_SETTINGS) {
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_VIDEO_EDIT_SETTINGS;
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const rawZoom = src.zoomScale !== undefined ? src.zoomScale : (src.zoom !== undefined ? src.zoom : base.zoomScale);
  const parsedZoom = Number(rawZoom);
  const baseZoom = Number(base.zoomScale);
  const zoomScale = Number.isFinite(parsedZoom)
    ? Math.max(1.0, Math.min(1.15, Math.round(parsedZoom * 100) / 100))
    : (Number.isFinite(baseZoom) ? Math.max(1.0, Math.min(1.15, Math.round(baseZoom * 100) / 100)) : 1.0);

  return {
    enableMirrorFlip: src.enableMirrorFlip !== undefined ? Boolean(src.enableMirrorFlip) : Boolean(base.enableMirrorFlip),
    zoomScale,
    enableColorGrade: src.enableColorGrade !== undefined ? Boolean(src.enableColorGrade) : Boolean(base.enableColorGrade),
    youtubeSafeAudio: src.youtubeSafeAudio !== undefined ? Boolean(src.youtubeSafeAudio) : Boolean(base.youtubeSafeAudio),
  };
}

export function areVideoEditSettingsEqual(a, b) {
  const normA = normalizeVideoEditSettings(a);
  const normB = normalizeVideoEditSettings(b);
  return (
    normA.enableMirrorFlip === normB.enableMirrorFlip &&
    Math.abs(normA.zoomScale - normB.zoomScale) < 0.001 &&
    normA.enableColorGrade === normB.enableColorGrade &&
    normA.youtubeSafeAudio === normB.youtubeSafeAudio
  );
}

export function isRenderedYoutubeTransformMismatch(renderedVideo, activeSettings = null) {
  if (!renderedVideo || typeof renderedVideo !== 'object' || renderedVideo.isProxyPreview) return false;
  if (!renderedVideo.youtubeTransform || typeof renderedVideo.youtubeTransform !== 'object') return false;
  return !areVideoEditSettingsEqual(renderedVideo.youtubeTransform, activeSettings);
}

export function loadPreferredVideoEditScope() {
  try {
    if (typeof localStorage === 'undefined') return 'folder';
    const raw = localStorage.getItem(STORAGE_VIDEO_EDIT_SCOPE_KEY);
    return VALID_VIDEO_EDIT_SCOPES.includes(raw) ? raw : 'folder';
  } catch {
    return 'folder';
  }
}

export function savePreferredVideoEditScope(scope) {
  const normalized = VALID_VIDEO_EDIT_SCOPES.includes(scope) ? scope : 'folder';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_VIDEO_EDIT_SCOPE_KEY, normalized);
    }
  } catch {}
  return normalized;
}

export function loadGlobalVideoEditSettingsRecord() {
  try {
    if (typeof localStorage === 'undefined') {
      return { initialized: false, settings: { ...DEFAULT_VIDEO_EDIT_SETTINGS }, updatedAt: 0 };
    }
    const raw = localStorage.getItem(STORAGE_GLOBAL_VIDEO_EDIT_SETTINGS_KEY);
    if (!raw) {
      return { initialized: false, settings: { ...DEFAULT_VIDEO_EDIT_SETTINGS }, updatedAt: 0 };
    }
    const parsed = JSON.parse(raw);
    const payload = parsed?.settings || parsed;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { initialized: false, settings: { ...DEFAULT_VIDEO_EDIT_SETTINGS }, updatedAt: 0 };
    }
    return {
      initialized: true,
      settings: normalizeVideoEditSettings(payload),
      updatedAt: Number(parsed?.updatedAt) || 0,
    };
  } catch {
    return { initialized: false, settings: { ...DEFAULT_VIDEO_EDIT_SETTINGS }, updatedAt: 0 };
  }
}

export function saveGlobalVideoEditSettings(settings, { updatedAt = Date.now() } = {}) {
  const existing = loadGlobalVideoEditSettingsRecord();
  const normalized = normalizeVideoEditSettings(settings, existing.settings);
  const ts = Math.max(Number(updatedAt) || Date.now(), Number(existing.updatedAt || 0));
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        STORAGE_GLOBAL_VIDEO_EDIT_SETTINGS_KEY,
        JSON.stringify({ version: 1, updatedAt: ts, settings: normalized })
      );
    }
  } catch {}
  return { initialized: true, settings: normalized, updatedAt: ts };
}

export function resolveEffectiveVideoEditSettings({
  episode = null,
  series = null,
  globalRecord = null,
} = {}) {
  const glob = globalRecord || loadGlobalVideoEditSettingsRecord();
  const globVe = glob?.initialized && glob?.settings ? glob.settings : null;
  const globAt = Number(glob?.updatedAt || 0);

  const folderVe = series?.videoEditSettings && typeof series.videoEditSettings === 'object'
    ? series.videoEditSettings
    : null;
  const folderAt = Number(folderVe?.updatedAt || 0);

  const epVe = episode?.videoEditSettings && typeof episode.videoEditSettings === 'object'
    ? episode.videoEditSettings
    : null;
  const epAt = Number(epVe?.updatedAt || 0);

  if (epVe && epVe.scope === 'episode' && epAt >= folderAt && epAt >= globAt) {
    return normalizeVideoEditSettings(epVe);
  }
  if (folderVe && folderAt >= globAt) {
    return normalizeVideoEditSettings(folderVe);
  }
  if (globVe) {
    return normalizeVideoEditSettings(globVe);
  }
  if (epVe) {
    return normalizeVideoEditSettings(epVe);
  }
  return { ...DEFAULT_VIDEO_EDIT_SETTINGS };
}

export function applyVideoEditSettingsToSeriesList(seriesList, {
  scope = 'folder',
  seriesId = null,
  episodeId = null,
  settings = null,
  updatedAt = Date.now(),
} = {}) {
  if (!Array.isArray(seriesList)) return [];
  const normScope = VALID_VIDEO_EDIT_SCOPES.includes(scope) ? scope : 'folder';
  const normalizedEdit = normalizeVideoEditSettings(settings);
  const ts = Number(updatedAt) || Date.now();
  const scopedRecord = { ...normalizedEdit, updatedAt: ts };

  const patchEpisode = (ep, epScope) => {
    const prevEffective = ep.videoEditSettings
      ? normalizeVideoEditSettings(ep.videoEditSettings)
      : (ep.voiceSettings ? normalizeVideoEditSettings(ep.voiceSettings) : { ...DEFAULT_VIDEO_EDIT_SETTINGS });
    const changed = !areVideoEditSettingsEqual(prevEffective, normalizedEdit);
    const rvMismatch = isRenderedYoutubeTransformMismatch(ep.renderedVideo, normalizedEdit);
    const invalidateRender = changed || rvMismatch;
    const prevRenderedAt = Number(ep.renderedVideo?.renderedAt || 0);
    const nextVoice = stripLogoSettings({
      ...(ep.voiceSettings && typeof ep.voiceSettings === 'object' ? ep.voiceSettings : {}),
      ...normalizedEdit,
    });
    const nextEp = {
      ...ep,
      videoEditSettings: { ...normalizedEdit, updatedAt: ts, scope: epScope },
      voiceSettings: nextVoice,
      lastModified: Math.max(ts, Number(ep.lastModified || 0) + 1),
    };
    if (invalidateRender) {
      nextEp.renderedVideo = null;
      nextEp.renderInvalidatedAt = Math.max(ts, Number(ep.renderInvalidatedAt || 0) + 1, prevRenderedAt > 0 ? prevRenderedAt + 1 : 0);
      if (nextEp.status === 'completed') {
        nextEp.status = nextEp.audioGenerated ? 'voicing' : ((nextEp.scriptData?.segments?.length > 0) ? 'translated' : (nextEp.video ? 'uploaded' : 'idle'));
      }
    }
    return nextEp;
  };

  return seriesList.map((series) => {
    if (!series) return series;
    if (normScope === 'global') {
      return {
        ...series,
        videoEditSettings: { ...scopedRecord },
        episodes: (series.episodes || []).map((ep) => patchEpisode(ep, 'global')),
      };
    }
    if (String(series.id) !== String(seriesId)) {
      return series;
    }
    if (normScope === 'folder') {
      return {
        ...series,
        videoEditSettings: { ...scopedRecord },
        episodes: (series.episodes || []).map((ep) => patchEpisode(ep, 'folder')),
      };
    }
    // normScope === 'episode'
    return {
      ...series,
      episodes: (series.episodes || []).map((ep) =>
        String(ep.id) === String(episodeId) ? patchEpisode(ep, 'episode') : ep
      ),
    };
  });
}

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
  resolvedVideoEditSettings = null,
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
  // Current global Customize values win across episode switches. Only explicitly
  // stored keys override episode values; non-Customize editing stays per-episode.
  const stickyCustomize = {};
  for (const key of STICKY_CUSTOMIZE_SETTING_KEYS) {
    if (safeGlobal && Object.prototype.hasOwnProperty.call(safeGlobal, key)) {
      stickyCustomize[key] = safeGlobal[key];
    }
  }
  const effectiveVideoEdit = resolvedVideoEditSettings
    ? normalizeVideoEditSettings(resolvedVideoEditSettings)
    : {};
  return {
    ...base,
    ...epClean,
    ...stickyCustomize,
    ...effectiveVideoEdit,
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

// In-memory cache for series list to eliminate repeated JSON.parse / localStorage reads on UI thread
let cachedSeriesList = null;
let cachedRawSeriesString = null;

/**
 * Load all series from localStorage with automatic legacy migration & Mojibake auto-healing
 */
export function loadSeriesList() {
  try {
    const raw = localStorage.getItem(STORAGE_SERIES_LIST_KEY);
    if (raw) {
      if (cachedSeriesList && raw === cachedRawSeriesString) {
        return cachedSeriesList;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedRawSeriesString = raw;
        cachedSeriesList = sanitizeAndHealSeriesList(parsed);
        return cachedSeriesList;
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
      id: series.id,
      title: series.title,
      createdAt: series.createdAt,
      glossary: series.glossary || { characters: [], terms: [] },
      genre: series.genre || 'auto',
      detectedGenre: series.detectedGenre || 'modern',
      ...(series.videoEditSettings ? { videoEditSettings: series.videoEditSettings } : {}),
      episodes: (series.episodes || []).map((ep) => {
        const hasSegments = Array.isArray(ep.scriptData?.segments) && ep.scriptData.segments.length > 0;
        const totalCount = ep.scriptData?.segments?.length || ep.scriptData?.totalSegments || 0;
        const resolvedAudioOutdated = Boolean(ep.audioOutdated);
        const resolvedAudioGenerated = Boolean(ep.audioGenerated || (!resolvedAudioOutdated && ep.fullAudioUrl));
        const resolvedHasAudio = Boolean(ep.hasAudio || resolvedAudioGenerated);
        const cleanVoiceSettings = ep.voiceSettings && typeof ep.voiceSettings === 'object' && !Array.isArray(ep.voiceSettings)
          ? stripLogoSettings(ep.voiceSettings)
          : null;

        // For the active episode currently open, keep slimmed essential segment data in localStorage
        if (ep.id === activeEpId && hasSegments) {
          return {
            id: ep.id,
            episodeNumber: ep.episodeNumber,
            title: ep.title,
            displayTitle: ep.displayTitle,
            duration: ep.duration || 0,
            status: ep.status || 'idle',
            video: ep.video ? { videoId: ep.video.videoId, fileName: ep.video.fileName, videoPath: ep.video.videoPath, duration: ep.video.duration } : null,
            videoFile: ep.videoFile || null,
            sourceVideoPath: ep.sourceVideoPath || null,
            originalFilename: ep.originalFilename || null,
            audioGenerated: resolvedAudioGenerated,
            hasAudio: resolvedHasAudio,
            audioOutdated: resolvedAudioOutdated,
            fullAudioUrl: ep.fullAudioUrl || null,
            fullAudioPath: ep.fullAudioPath || null,
            renderedVideo: sanitizeRenderedVideo(ep.renderedVideo),
            ...(ep.renderInvalidatedAt ? { renderInvalidatedAt: ep.renderInvalidatedAt } : {}),
            ...(ep.videoEditSettings ? { videoEditSettings: ep.videoEditSettings } : {}),
            ...(cleanVoiceSettings ? { voiceSettings: cleanVoiceSettings } : {}),
            generationMode: ep.generationMode || ep.scriptData?.generationMode,
            lastModified: ep.lastModified,
            updatedAt: ep.updatedAt,
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
            id: ep.id,
            episodeNumber: ep.episodeNumber,
            title: ep.title,
            displayTitle: ep.displayTitle,
            duration: ep.duration || 0,
            status: (ep.status === 'uploaded' || !ep.status) ? 'translated' : ep.status,
            video: ep.video ? { videoId: ep.video.videoId, fileName: ep.video.fileName, videoPath: ep.video.videoPath, duration: ep.video.duration } : null,
            videoFile: ep.videoFile || null,
            sourceVideoPath: ep.sourceVideoPath || null,
            originalFilename: ep.originalFilename || null,
            audioGenerated: resolvedAudioGenerated,
            hasAudio: resolvedHasAudio,
            audioOutdated: resolvedAudioOutdated,
            fullAudioUrl: ep.fullAudioUrl || null,
            fullAudioPath: ep.fullAudioPath || null,
            renderedVideo: sanitizeRenderedVideo(ep.renderedVideo),
            ...(ep.renderInvalidatedAt ? { renderInvalidatedAt: ep.renderInvalidatedAt } : {}),
            ...(ep.videoEditSettings ? { videoEditSettings: ep.videoEditSettings } : {}),
            ...(cleanVoiceSettings ? { voiceSettings: cleanVoiceSettings } : {}),
            generationMode: ep.generationMode || ep.scriptData?.generationMode,
            lastModified: ep.lastModified,
            updatedAt: ep.updatedAt,
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

        return {
          id: ep.id,
          episodeNumber: ep.episodeNumber,
          title: ep.title,
          displayTitle: ep.displayTitle,
          duration: ep.duration || 0,
          status: ep.status || 'idle',
          video: ep.video ? { videoId: ep.video.videoId, fileName: ep.video.fileName, videoPath: ep.video.videoPath, duration: ep.video.duration } : null,
          videoFile: ep.videoFile || null,
          sourceVideoPath: ep.sourceVideoPath || null,
          originalFilename: ep.originalFilename || null,
          renderedVideo: sanitizeRenderedVideo(ep.renderedVideo),
          ...(ep.renderInvalidatedAt ? { renderInvalidatedAt: ep.renderInvalidatedAt } : {}),
          ...(ep.videoEditSettings ? { videoEditSettings: ep.videoEditSettings } : {}),
          ...(cleanVoiceSettings ? { voiceSettings: cleanVoiceSettings } : {}),
        };
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
    const serialized = JSON.stringify(optimized);
    localStorage.setItem(STORAGE_SERIES_LIST_KEY, serialized);
    cachedRawSeriesString = serialized;
    cachedSeriesList = sanitizeAndHealSeriesList(optimized);
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
        const serializedUltra = JSON.stringify(ultraCompact);
        localStorage.setItem(STORAGE_SERIES_LIST_KEY, serializedUltra);
        cachedRawSeriesString = serializedUltra;
        cachedSeriesList = sanitizeAndHealSeriesList(ultraCompact);
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
 * Active Episode ID (Global & Per-Series)
 */
export function getActiveEpisodeId() {
  return localStorage.getItem(STORAGE_ACTIVE_EPISODE_ID_KEY) || null;
}

export function setActiveEpisodeId(id) {
  if (id) localStorage.setItem(STORAGE_ACTIVE_EPISODE_ID_KEY, String(id));
  else localStorage.removeItem(STORAGE_ACTIVE_EPISODE_ID_KEY);
}

export function getActiveEpisodeIdForSeries(seriesId) {
  if (!seriesId) return null;
  return localStorage.getItem(`capcut_active_episode_id_${seriesId}`) || null;
}

export function setActiveEpisodeIdForSeries(seriesId, episodeId) {
  if (!seriesId) return;
  if (episodeId) {
    localStorage.setItem(`capcut_active_episode_id_${seriesId}`, String(episodeId));
  } else {
    localStorage.removeItem(`capcut_active_episode_id_${seriesId}`);
  }
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

  let episodeId = getActiveEpisodeIdForSeries(series.id) || getActiveEpisodeId();
  let episode = (series.episodes || []).find((e) => String(e.id) === String(episodeId)) || series.episodes?.[0];

  if (!episode) {
    episode = createDefaultEpisode(1);
    series.episodes = [episode];
    saveSeriesList(seriesList);
  }

  // Only set active series ID if seriesId was empty, preserving valid target IDs like "ss2"
  if (!seriesId) {
    setActiveSeriesId(series.id);
  }
  setActiveEpisodeId(episode.id);
  setActiveEpisodeIdForSeries(series.id, episode.id);

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
 * Helper to sync series state to backend with coalescing, single-flight serialization,
 * transient retry, and visible offline detection toast on persistent failure.
 */
const pendingSeriesSyncState = new Map();

const pendingEpisodePrefix = 'KHMER_PENDING_EPISODE_SYNC:';

// Other episodes in localStorage contain compact summaries. Retain each edited episode
// until its own full snapshot is acknowledged, including across a reload in this tab.
export async function restorePendingEpisodeSyncs() {
  if (typeof sessionStorage === 'undefined') return;
  const keys = Object.keys(sessionStorage).filter((key) => key.startsWith(pendingEpisodePrefix));
  for (const key of keys) {
    const raw = sessionStorage.getItem(key);
    if (!raw) continue;
    try {
      const payload = JSON.parse(raw);
      await syncSeriesApi(payload);
      if (sessionStorage.getItem(key) === raw) sessionStorage.removeItem(key);
    } catch (err) {
      surfaceSyncFailureToast(err);
    }
  }
}

function surfaceSyncFailureToast(err) {
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
}

async function runCoalescedSeriesSync(seriesId) {
  const entry = pendingSeriesSyncState.get(seriesId);
  if (!entry || entry.inFlight || !entry.latestSeries) return;
  entry.inFlight = true;
  const snapshot = entry.latestSeries;
  const savedEpisodes = entry.changedEpisodes;
  entry.changedEpisodes = new Map();
  entry.latestSeries = null;

  try {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await syncSeriesApi(snapshot);
        for (const [id, saved] of savedEpisodes) {
          if (entry.changedEpisodes.has(id) || !saved.raw) continue;
          if (sessionStorage.getItem(saved.key) === saved.raw) sessionStorage.removeItem(saved.key);
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const isTransient = /502|503|ECONNRESET|ECONNREFUSED|temporarily unreachable|Failed to fetch|NetworkError/i.test(String(err?.message || ''));
        if (attempt === 0 && isTransient) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        break;
      }
    }
    if (lastErr) {
      surfaceSyncFailureToast(lastErr);
    }
  } finally {
    entry.inFlight = false;
    if (entry.latestSeries) {
      runCoalescedSeriesSync(seriesId);
    } else if (!entry.timer) {
      pendingSeriesSyncState.delete(seriesId);
    }
  }
}

export function syncSeriesToBackend(series, changedEpisode = null) {
  if (!series?.id) return;
  const sid = String(series.id);
  let entry = pendingSeriesSyncState.get(sid);
  if (!entry) {
    entry = { latestSeries: null, timer: null, inFlight: false, changedEpisodes: new Map() };
    pendingSeriesSyncState.set(sid, entry);
  }
  if (changedEpisode) {
    const key = pendingEpisodePrefix + JSON.stringify([sid, changedEpisode.id]);
    const { id, title, glossary, genre, detectedGenre } = series;
    const payload = { id, title, glossary, genre, detectedGenre, episodes: [changedEpisode] };
    let raw;
    try {
      raw = JSON.stringify(payload);
      sessionStorage.setItem(key, raw);
    } catch { raw = null; }
    entry.changedEpisodes.set(changedEpisode.id, { episode: changedEpisode, key, raw });
    if (!entry.latestSeries || entry.partial) {
      entry.partial = true;
      entry.latestSeries = { ...payload, episodes: [...entry.changedEpisodes.values()].map((edit) => edit.episode) };
    } else {
      entry.latestSeries = { ...series, episodes: series.episodes.map((ep) => entry.changedEpisodes.get(ep.id)?.episode || ep) };
    }
  } else {
    entry.partial = false;
    entry.latestSeries = { ...series, episodes: series.episodes.map((ep) => entry.changedEpisodes.get(ep.id)?.episode || ep) };
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    runCoalescedSeriesSync(sid);
  }, 300);
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

const _suppressBackendSyncMap = new Map();

/**
 * Temporarily skip redundant full-series POST /api/series/:id/sync when a targeted backend
 * endpoint (e.g. persistTimelineOperationApi or single-segment /api/generate-audio) already
 * persisted the mutation on disk.
 * Can be scoped to a specific episode (`${seriesId}:${episodeId}`) so unrelated saves are never blocked.
 */
export function suppressNextBackendSync(durationMs = 2500, targetKey = null) {
  const until = Date.now() + Math.max(0, Number(durationMs) || 0);
  const key = targetKey ? String(targetKey) : '__global__';
  const existing = _suppressBackendSyncMap.get(key) || 0;
  if (until > existing) {
    _suppressBackendSyncMap.set(key, until);
  }
}

export function isBackendSyncSuppressed(targetKey = null) {
  const now = Date.now();
  const globalUntil = _suppressBackendSyncMap.get('__global__') || 0;
  if (globalUntil > now) return true;
  if (targetKey) {
    const keyUntil = _suppressBackendSyncMap.get(String(targetKey)) || 0;
    if (keyUntil > now) return true;
  }
  return false;
}

export function clearSuppressedBackendSync(targetKey = null) {
  if (targetKey) {
    _suppressBackendSyncMap.delete(String(targetKey));
  } else {
    _suppressBackendSyncMap.clear();
  }
}

export const PENDING_TIMELINE_WRITES_KEY = 'KHMER_AI_PENDING_TIMELINE_WRITES';

export function getPendingTimelineWrites() {
  try {
    const raw = localStorage.getItem(PENDING_TIMELINE_WRITES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

export function recordPendingTimelinePersist({ seriesId, episodeId, operation = 'update_segments', segments = [], updatedAt = null }) {
  if (!seriesId || !episodeId || !Array.isArray(segments)) return;
  try {
    const all = getPendingTimelineWrites();
    const key = `${seriesId}:${episodeId}`;
    all[key] = {
      seriesId,
      episodeId,
      operation,
      segments,
      updatedAt: Number(updatedAt) || Date.now(),
    };
    localStorage.setItem(PENDING_TIMELINE_WRITES_KEY, JSON.stringify(all));
  } catch (_) {}
}

export function clearPendingTimelinePersist(seriesId, episodeId, updatedAt = null) {
  if (!seriesId || !episodeId) return;
  try {
    const all = getPendingTimelineWrites();
    const key = `${seriesId}:${episodeId}`;
    if (all[key]) {
      if (updatedAt && all[key].updatedAt && Number(all[key].updatedAt) > Number(updatedAt)) {
        return; // A newer edit was recorded while in flight; do not clear
      }
      delete all[key];
      localStorage.setItem(PENDING_TIMELINE_WRITES_KEY, JSON.stringify(all));
    }
  } catch (_) {}
}

export async function flushAllPendingTimelinePersists() {
  const all = getPendingTimelineWrites();
  const keys = Object.keys(all);
  if (keys.length === 0) return [];

  // Filter out pending writes for series that no longer exist in localStorage
  const currentList = loadSeriesList();
  const knownSeriesIds = new Set((currentList || []).map((s) => String(s.id)));

  const results = [];
  for (const key of keys) {
    const item = all[key];
    if (item && item.seriesId && item.episodeId && Array.isArray(item.segments)) {
      // Skip and clear pending writes for series that have been deleted locally
      if (!knownSeriesIds.has(String(item.seriesId))) {
        clearPendingTimelinePersist(item.seriesId, item.episodeId, item.updatedAt);
        results.push({ key, success: false, error: 'Series deleted — pending write cleared' });
        continue;
      }
      try {
        const res = await persistTimelineOperationApi({
          seriesId: item.seriesId,
          episodeId: item.episodeId,
          operation: item.operation || 'update_segments',
          segments: item.segments,
        });
        clearPendingTimelinePersist(item.seriesId, item.episodeId, item.updatedAt);
        results.push({ key, success: true, res });
      } catch (err) {
        // If backend returns 410 Gone (series deleted), clear the pending write permanently
        if (err?.status === 410 || /deleted|gone/i.test(err?.message || '')) {
          clearPendingTimelinePersist(item.seriesId, item.episodeId, item.updatedAt);
          results.push({ key, success: false, error: 'Series deleted on backend — pending write cleared' });
        } else {
          console.warn(`[projectStorage] Failed to flush pending timeline write for ${key}:`, err?.message || err);
          results.push({ key, success: false, error: err?.message || err });
        }
      }
    }
  }
  return results;
}

/**
 * Save specific episode state into series list in localStorage
 */
export function saveEpisodeState(seriesId, episodeId, stateData, options = {}) {
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

    const prevVeAt = Number(prevEp.videoEditSettings?.updatedAt || 0);
    const incVeAt = Number(stateData.videoEditSettings?.updatedAt || 0);
    const mergedVideoEditSettings = (stateData.videoEditSettings && incVeAt >= prevVeAt)
      ? stateData.videoEditSettings
      : (prevEp.videoEditSettings || stateData.videoEditSettings || null);

    const rawVoiceSettings = stateData.voiceSettings !== undefined
      ? stateData.voiceSettings
      : prevEp.voiceSettings;
    const sanitizedVoiceSettings = rawVoiceSettings && typeof rawVoiceSettings === 'object' && !Array.isArray(rawVoiceSettings)
      ? stripLogoSettings({ ...rawVoiceSettings, aspectRatio: sanitizeAspectRatio(rawVoiceSettings.aspectRatio) })
      : (rawVoiceSettings === null ? null : stripLogoSettings(prevEp.voiceSettings) || null);
    if (mergedVideoEditSettings && prevVeAt > incVeAt && sanitizedVoiceSettings && typeof sanitizedVoiceSettings === 'object') {
      Object.assign(sanitizedVoiceSettings, normalizeVideoEditSettings(mergedVideoEditSettings));
    }

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
      ...(mergedVideoEditSettings ? { videoEditSettings: mergedVideoEditSettings } : {}),
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
            const existing = mergedCharacters[existingIdx];
            const isExistingManual = Boolean(existing.userOverridden || existing.voiceAssignmentSource === 'manual');
            const isNewManual = Boolean(ch.userOverridden || ch.voiceAssignmentSource === 'manual');
            mergedCharacters[existingIdx] = {
              ...existing,
              ...ch,
              gender: (existing.gender && existing.gender !== 'unknown') ? existing.gender : (ch.gender || 'unknown'),
              voiceId: isExistingManual ? existing.voiceId : (isNewManual ? ch.voiceId : (existing.voiceId || ch.voiceId)),
              khmerVoiceId: isExistingManual ? (existing.khmerVoiceId || existing.voiceId) : (isNewManual ? (ch.khmerVoiceId || ch.voiceId) : (existing.khmerVoiceId || ch.voiceId)),
              voiceAssignmentSource: isExistingManual ? 'manual' : (isNewManual ? 'manual' : (existing.voiceAssignmentSource || ch.voiceAssignmentSource || 'series_glossary')),
              userOverridden: isExistingManual || isNewManual,
            };
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

    // Background sync to backend for server-side persistence (skip when caller already persisted directly or when scoped-suppressed)
    const episodeKey = `${seriesId}:${episodeId}`;
    const isSuppressed = isBackendSyncSuppressed(episodeKey);
    if (!options?.skipBackendSync && (options?.forceBackendSync || !isSuppressed)) {
      try {
        syncSeriesToBackend(series, updatedEp);
      } catch (_) {}
    }

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
  const inheritedVe = series.videoEditSettings || resolveEffectiveVideoEditSettings({ series });
  if (series.videoEditSettings || loadGlobalVideoEditSettingsRecord().initialized) {
    newEp.videoEditSettings = {
      ...normalizeVideoEditSettings(inheritedVe),
      updatedAt: Number(series.videoEditSettings?.updatedAt || loadGlobalVideoEditSettingsRecord().updatedAt || Date.now()),
      scope: series.videoEditSettings ? 'folder' : 'global',
    };
    newEp.voiceSettings = {
      ...normalizeVideoEditSettings(inheritedVe),
    };
  }

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
 * Delete a series from localStorage list (resets to default series if last one removed)
 */
export function deleteSeriesFromList(seriesId) {
  const list = loadSeriesList();
  const filtered = list.filter((s) => String(s.id) !== String(seriesId));
  const final = filtered.length > 0 ? filtered : [createDefaultSeries('រឿងភាគ (Series 1)')];
  saveSeriesList(final);
  return final;
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
  const segments = scriptData?.segments || [];
  const segSpeakerNames = new Set(
    segments.map((seg) => (seg.speaker || seg.speakerName || '').trim()).filter(Boolean)
  );

  const detectGender = (spk, name, fallback) => {
    const rawG = String(spk?.voiceGender || spk?.gender || spk?.speakerGender || '').toLowerCase();
    if (rawG === 'female' || rawG === 'male') return rawG;
    if (name && /ស្រី|នាង|យាយ|ម៉ែ|កញ្ញា|ជំទាវ/i.test(name)) return 'female';
    if (name && /ប្រុស|លោក|តា|ពូ|ឪពុក/i.test(name)) return 'male';
    return fallback || 'unknown';
  };

  const isIgnoredPlaceholderOrPositional = (name, id) => {
    const nm = String(name || '').trim().toLowerCase();
    const sid = String(id || '').trim();
    if (!nm || nm === 'unknown' || nm === 'តួអង្គ' || nm === 'តួ' || nm === 'speaker' || /^speaker[\s_-]*\d+$/i.test(nm)) return true;
    if (/^spk_(?:ocr|review|generic|unknown)_\d+$/i.test(sid) || /^spk_\d+$/i.test(sid)) return true;
    return false;
  };

  Object.values(registry).forEach((spk) => {
    const spkName = (spk.name || spk.speakerName || '').trim();
    const spkId = spk.id || spk.speakerId || spkName;
    if (!isIgnoredPlaceholderOrPositional(spkName, spkId) && !characters.some((c) => c.name === spkName)) {
      // If episode has segments, do not include phantom characters from old/other series
      if (segSpeakerNames.size > 0 && !segSpeakerNames.has(spkName) && !segSpeakerNames.has(spk.id)) {
        return;
      }
      const isManual = Boolean(spk.userOverridden || spk.voiceAssignmentSource === 'manual');
      characters.push({
        id: spkId,
        speakerId: spkId,
        characterId: spk.characterId || null,
        name: spkName,
        khmerName: spk.khmerName || spkName,
        aliases: Array.isArray(spk.aliases) ? spk.aliases : [spkName],
        gender: detectGender(spk, spkName, 'unknown'),
        voiceId: spk.voiceId || spk.khmerVoiceId || null,
        khmerVoiceId: spk.khmerVoiceId || spk.voiceId || null,
        voiceAssignmentSource: isManual ? 'manual' : (spk.voiceAssignmentSource || 'automatic'),
        userOverridden: isManual,
      });
    }
  });

  segments.forEach((seg) => {
    const rawSpeaker = (seg.speaker || seg.speakerName || '').trim();
    const segSpkId = seg.speakerId || rawSpeaker;
    if (!isIgnoredPlaceholderOrPositional(rawSpeaker, segSpkId) && !characters.some((c) => c.name === rawSpeaker)) {
      const isManual = Boolean(seg.userOverridden || seg.voiceAssignmentSource === 'manual' || seg.voiceOverride);
      characters.push({
        id: segSpkId,
        speakerId: segSpkId,
        characterId: seg.characterId || null,
        name: rawSpeaker,
        khmerName: rawSpeaker,
        aliases: Array.isArray(seg.aliases) ? seg.aliases : [rawSpeaker],
        gender: detectGender(seg, rawSpeaker, 'unknown'),
        voiceId: isManual ? (seg.voiceOverride || seg.voiceId || seg.khmerVoiceId || null) : (seg.voiceId || seg.khmerVoiceId || null),
        khmerVoiceId: isManual ? (seg.voiceOverride || seg.khmerVoiceId || seg.voiceId || null) : (seg.khmerVoiceId || seg.voiceId || null),
        voiceAssignmentSource: isManual ? 'manual' : (seg.voiceAssignmentSource || 'automatic'),
        userOverridden: isManual,
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
