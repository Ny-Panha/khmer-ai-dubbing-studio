/**
 * Gemini AI Dubbing Pipeline & Quota Settings API
 * DragonDub AI Studio - Frontend Services
 */

import { parseResponseJson } from './client.js';

/**
 * Generate Khmer Storytelling Script using Gemini AI
 * @param {Object} params
 */
export async function generateScriptApi({ 
  videoId, 
  mode = 'dialogue', 
  generationMode = 'standard',
  recapStyle = 'standard', 
  narratorGender = 'male',
  genre = 'auto',
  customPrompt = '', 
  inputText = '', 
  apiKey,
  requestId,
  projectId,
  seriesId,
  episodeId,
  seriesGlossary,
  force = false,
  confirmed = false,
  signal 
}) {
  const res = await fetch('/api/generate-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      videoId,
      mode,
      generationMode,
      recapStyle,
      narratorGender,
      genre,
      customPrompt: customPrompt || inputText,
      inputText: inputText ? inputText.trim() : undefined,
      apiKey: apiKey || undefined,
      requestId,
      projectId,
      seriesId,
      episodeId,
      seriesGlossary,
      force,
      confirmed,
    }),
  });

  let data;
  try {
    data = await parseResponseJson(res, 'Failed to generate script with Gemini AI');
  } catch (err) {
    err.videoId = videoId;
    err.requestId = requestId;
    err.seriesId = seriesId;
    err.episodeId = episodeId;
    throw err;
  }

  return {
    success: true,
    data: data.data,
    videoId: data.videoId || videoId,
    requestId: data.requestId || requestId,
    projectId: data.projectId || projectId,
    seriesId: data.seriesId || seriesId,
    episodeId: data.episodeId || episodeId,
  };
}

/**
 * ✨ AI Single Segment Re-Translation with 3 Classical Cinema Options
 * @param {string} chineseText
 * @param {Object} [context]
 */
export async function retranslateSegmentApi(chineseText, context = {}) {
  const apiKey = context.apiKey || localStorage.getItem('GEMINI_API_KEY') || '';
  const res = await fetch('/api/dubbing/retranslate-segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chineseText, apiKey, context }),
  });
  return await parseResponseJson(res, 'Failed to retranslate segment dialogue');
}

/**
 * Batch AI Re-Translate Segments (1-Click Auto Compact: "📝 ខ្លីចំអត្ថន័យ")
 * @param {{ segments: Array, seriesId?: string, episodeId?: string, options?: Object, apiKey?: string, signal?: AbortSignal }} params
 */
export async function retranslateAllSegmentsApi({
  segments = [],
  seriesId = null,
  episodeId = null,
  options = {},
  apiKey = null,
  signal = null,
} = {}) {
  const effectiveApiKey = apiKey || localStorage.getItem('GEMINI_API_KEY') || '';
  const res = await fetch('/api/dubbing/retranslate-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      segments,
      seriesId,
      episodeId,
      options: {
        style: 'compact',
        ...options,
      },
      apiKey: effectiveApiKey,
    }),
  });
  return await parseResponseJson(res, 'Failed to batch retranslate segments');
}

/**
 * Rescan characters directly from current episode or current series source videos,
 * preserving Chinese subtitles, Khmer translations, immutable sourceCueId, timeline timestamps,
 * manual overrides, and unchanged-voice TTS audio files.
 */
export async function rescanCharactersApi({
  seriesId,
  episodeId = null,
  scope = 'episode',
  clearStaleRegistry = true,
  apiKey = null,
  signal = null,
} = {}) {
  const effectiveApiKey = apiKey || localStorage.getItem('GEMINI_API_KEY') || '';
  const res = await fetch('/api/dubbing/rescan-characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      seriesId,
      episodeId,
      scope,
      clearStaleRegistry,
      apiKey: effectiveApiKey,
    }),
  });
  return await parseResponseJson(res, 'Failed to rescan characters');
}

/**
 * Fetch realtime Gemini API keys status and quota health
 * @param {{ probe?: 'models' | 'live' | 'matrix' | 'stats', model?: string, allModels?: boolean, signal?: AbortSignal }} [options]
 */
export async function fetchGeminiKeysStatusApi({ probe = 'models', model = '', allModels = false, signal } = {}) {
  const params = new URLSearchParams();
  if (probe) params.set('probe', probe);
  if (model) params.set('model', model);
  if (allModels) params.set('allModels', 'true');
  const qs = params.toString();
  const res = await fetch(`/api/gemini/keys-status${qs ? `?${qs}` : ''}`, { signal });
  return await parseResponseJson(res, 'Failed to fetch Gemini keys status');
}

/**
 * Update Gemini Multi-Key Pacing, Primary Model & Quota Limit Settings
 * @param {{ useAllKeysFast?: boolean, rpmPerKey?: number, dailyRpdPerKey?: number, preferredModel?: string, resetDailyStats?: boolean }} payload
 */
export async function updateGeminiQuotaSettingsApi(payload = {}, { signal } = {}) {
  const res = await fetch('/api/gemini/quota-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return await parseResponseJson(res, 'Failed to update Gemini quota settings');
}

