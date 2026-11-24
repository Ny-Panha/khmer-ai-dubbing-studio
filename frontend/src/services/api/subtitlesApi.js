/**
 * Subtitles Import (.srt / .json) & Timeline Audio Sync API
 * DragonDub AI Studio - Frontend Services
 */

import { parseResponseJson, notifyBackendOffline, notifyBackendOnline } from './client.js';

/**
 * Fast Re-sync of Timeline Audio positions without re-generating TTS
 * @param {Array} segments 
 * @param {string} [projectName]
 * @param {string} [videoId]
 * @param {string} [episodeId]
 * @param {string} [seriesId]
 */
export async function syncTimelineAudioApi(segments, projectName, videoId, episodeId = null, seriesId = null) {
  try {
    const res = await fetch('/api/sync-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, projectName, videoId, episodeId, seriesId }),
    });
    const data = await parseResponseJson(res, 'Failed to re-sync timeline audio');
    notifyBackendOnline();
    return data;
  } catch (err) {
    if (err.status === 502 || /ECONNREFUSED|unreachable|Failed to fetch|NetworkError/i.test(err?.message || '')) {
      notifyBackendOffline();
    }
    throw err;
  }
}

/**
 * STEP 4: Import Subtitles (.srt / .json)
 */
export async function importSubtitlesApi({
  fileContent,
  fileType = 'srt',
  seriesId,
  episodeId,
  defaultGender = 'male',
  apiKey,
  force = false,
  confirmed = false,
  importMode = 'auto',
  skipTranslation = false,
  subtitleLanguage = 'auto',
}) {
  const res = await fetch('/api/dubbing/import-subtitles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileContent,
      fileType,
      seriesId,
      episodeId,
      defaultGender,
      apiKey,
      force,
      confirmed,
      importMode,
      skipTranslation,
      subtitleLanguage,
    }),
  });
  return await parseResponseJson(res, 'Failed to import subtitles');
}

