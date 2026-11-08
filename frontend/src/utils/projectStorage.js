import { SCHEMA_VERSION } from './formatTime.js';
import { notifyBackendOffline, notifyBackendOnline } from '../services/api';

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
  aspectRatio: '16:9',
  enableAntiTheft: false,
  marqueeText: '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»',
  marqueeSpeed: 'normal',
  marqueePosition: 'bottom',
  marqueeTextColor: '#FFE600',
  enableWatermark: true,
  watermarkText: 'រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama',
  watermarkPosition: 'above-ticker',
  watermarkColor: '#38BDF8',
  enableLogo: true,
  logoImage: '/assets/dragon_town_logo.jpg',
  logoPosition: 'both',
  logoSize: 72,
  logoOpacity: 0.9,
  logoShape: 'circle',
  logoMargin: 20,
};

/**
 * Load saved voice settings from localStorage
 */
export function loadSavedVoiceSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_VOICE_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_VOICE_SETTINGS;
}

/**
 * Save voice settings to localStorage
 */
export function saveVoiceSettings(settings) {
  try {
    localStorage.setItem(STORAGE_VOICE_SETTINGS_KEY, JSON.stringify(settings));
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

    // 2. Validate and enforce sequential 1..N episode numbers and unique IDs
    const seenIds = new Set();
    const episodes = s.episodes || [];

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
  setActiveSeriesId(initialSeries.id);
  setActiveEpisodeId(initialSeries.episodes[0].id);
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
    id: s.id,
    startSec: s.startSec ?? s.start ?? 0,
    endSec: s.endSec ?? s.end ?? 0,
    khmerText: s.khmerText || s.khmerTranslatedText || s.khmer || '',
    chineseText: s.chineseText || s.originalChineseText || s.originalText || s.original || '',
    speaker: s.speaker || s.speakerName || 'Narrator',
    speakerId: s.speakerId || null,
    voiceGender: s.voiceGender || s.speakerGender || s.gender || 'male',
    voiceId: s.voiceId || s.khmerVoiceId || null,
    audioUrl: s.audioUrl || s.audioFile || s.rawAudioPath || null,
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

        // For the active episode currently open, keep slimmed essential segment data in localStorage
        if (ep.id === activeEpId && hasSegments) {
          return {
            ...ep,
            audioGenerated: Boolean(ep.audioGenerated || ep.fullAudioUrl),
            hasAudio: Boolean(ep.hasAudio || ep.audioGenerated || ep.fullAudioUrl),
            fullAudioUrl: ep.fullAudioUrl || null,
            fullAudioPath: ep.fullAudioPath || null,
            scriptData: {
              ...ep.scriptData,
              hasScript: true,
              totalSegments: totalCount,
              segments: ep.scriptData.segments.map(trimSegmentForStorage),
            },
          };
        }

        // For inactive episodes, keep metadata & summary count without the 4MB segment array
        if (hasSegments || ep.scriptData?.hasScript || ep.status === 'translated' || ep.status === 'voicing' || ep.status === 'completed') {
          return {
            ...ep,
            status: (ep.status === 'uploaded' || !ep.status) ? 'translated' : ep.status,
            audioGenerated: Boolean(ep.audioGenerated || ep.fullAudioUrl),
            hasAudio: Boolean(ep.hasAudio || ep.audioGenerated || ep.fullAudioUrl),
            fullAudioUrl: ep.fullAudioUrl || null,
            fullAudioPath: ep.fullAudioPath || null,
            scriptData: {
              mode: ep.scriptData?.mode || 'dialogue',
              genre: ep.scriptData?.genre || 'auto',
              hasScript: true,
              totalSegments: totalCount,
              updatedAt: ep.scriptData?.updatedAt || Date.now(),
              segments: [], // Offload bulky array from localStorage to backend server truth (series.json)
            },
          };
        }

        return ep;
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
          episodes: (s.episodes || []).map((e) => ({
            id: e.id,
            episodeNumber: e.episodeNumber,
            title: e.title,
            displayTitle: e.displayTitle,
            duration: e.duration || 0,
            status: e.status || 'idle',
            video: e.video ? { videoId: e.video.videoId, fileName: e.video.fileName, videoPath: e.video.videoPath, duration: e.video.duration } : null,
            hasScript: Boolean(e.scriptData?.segments?.length || e.scriptData?.hasScript),
            totalSegments: e.scriptData?.segments?.length || e.scriptData?.totalSegments || 0,
            audioGenerated: Boolean(e.audioGenerated || e.fullAudioUrl),
            hasAudio: Boolean(e.hasAudio || e.audioGenerated || e.fullAudioUrl),
            fullAudioUrl: e.fullAudioUrl || null,
            fullAudioPath: e.fullAudioPath || null,
            scriptData: e.scriptData ? { mode: e.scriptData.mode, hasScript: true, totalSegments: e.scriptData.segments?.length || e.scriptData.totalSegments || 0 } : null,
          })),
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

  setActiveSeriesId(series.id);
  setActiveEpisodeId(episode.id);

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
  fetch(`/api/series/${series.id}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ series }),
  })
    .then((res) => {
      if (res.status === 502 || !res.ok) {
        notifyBackendOffline();
      } else {
        notifyBackendOnline();
      }
    })
    .catch((err) => {
      if (/ECONNREFUSED|unreachable|Failed to fetch|NetworkError/i.test(err?.message || '')) {
        notifyBackendOffline();
      }
    });
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
    const mergedScriptData = (stateData.scriptData && (stateData.scriptData.segments?.length > 0 || stateData.scriptData.title))
      ? stateData.scriptData
      : (stateData.clearScript ? null : (prevEp.scriptData || stateData.scriptData));

    const mergedSpeakerRegistry = (stateData.speakerRegistry && Object.keys(stateData.speakerRegistry).length > 0)
      ? stateData.speakerRegistry
      : (prevEp.speakerRegistry || {});

    const mergedFullAudioPath = stateData.fullAudioPath || (stateData.clearScript ? null : prevEp.fullAudioPath);
    const mergedFullAudioUrl = stateData.fullAudioUrl || (stateData.clearScript ? null : prevEp.fullAudioUrl);

    const mergedAudioGenerated = stateData.clearAudio
      ? false
      : Boolean(stateData.audioGenerated || prevEp.audioGenerated || mergedFullAudioUrl);

    const mergedAudioOutdated = stateData.clearAudio
      ? false
      : Boolean(stateData.audioOutdated || prevEp.audioOutdated);

    const mergedVideoClips = (Array.isArray(stateData.videoClips) && stateData.videoClips.length > 0)
      ? stateData.videoClips
      : (prevEp.videoClips || []);

    const updatedEp = {
      ...prevEp,
      ...stateData,
      scriptData: mergedScriptData,
      speakerRegistry: mergedSpeakerRegistry,
      audioGenerated: mergedAudioGenerated,
      audioOutdated: mergedAudioOutdated,
      fullAudioPath: mergedFullAudioPath,
      fullAudioUrl: mergedFullAudioUrl,
      videoClips: mergedVideoClips,
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
    } else if (
      (updatedEp.scriptData?.segments && updatedEp.scriptData.segments.length > 0) ||
      updatedEp.scriptData?.hasScript ||
      (typeof updatedEp.scriptData?.totalSegments === 'number' && updatedEp.scriptData.totalSegments > 0)
    ) {
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
  if ((series.episodes || []).length <= 1) {
    return false;
  }

  series.episodes = series.episodes.filter((e) => String(e.id) !== String(episodeId));

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

  list[sIdx] = series;
  saveSeriesList(list);

  if (String(getActiveEpisodeId()) === String(episodeId)) {
    setActiveEpisodeId(series.episodes[0].id);
  }

  // Background sync delete on backend
  try {
    fetch(`/api/series/${series.id}/episodes/${episodeId}`, {
      method: 'DELETE',
    }).catch(() => {});
    syncSeriesToBackend(series);
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

  Object.values(registry).forEach((spk) => {
    if (spk.name && spk.name !== 'Unknown' && !characters.some((c) => c.name === spk.name)) {
      characters.push({
        id: spk.id || spk.speakerId,
        name: spk.name,
        khmerName: spk.khmerName || spk.name,
        gender: spk.gender || 'male',
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
        gender: seg.gender || seg.speakerGender || 'male',
        voiceId: seg.voiceId || null,
      });
    }
  });

  return { characters, terms: [] };
}

/**
 * Compatibility wrapper: saveActiveProject
 */
export function saveActiveProject(projectData) {
  const seriesId = getActiveSeriesId();
  const episodeId = getActiveEpisodeId();
  if (seriesId && episodeId) {
    saveEpisodeState(seriesId, episodeId, projectData);
  }
}

/**
 * Compatibility wrapper: loadActiveProject
 */
export function loadActiveProject() {
  const { episode } = loadActiveSeriesAndEpisode();
  if (!episode || !episode.video) return null;
  return {
    ...episode,
    videoId: episode.video.videoId,
    fileName: episode.video.fileName,
    videoUrl: episode.video.videoUrl,
    videoPath: episode.video.videoPath,
    size: episode.video.size,
  };
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
