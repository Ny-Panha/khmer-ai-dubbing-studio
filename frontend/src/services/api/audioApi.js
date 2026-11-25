/**
 * Khmer AI Neural TTS & Demucs Vocal Separation Audio API
 * DragonDub AI Studio - Frontend Services
 */

import { parseResponseJson } from './client.js';

/**
 * Fetch verified supported TTS voices from backend
 */
export async function fetchTtsVoices() {
  const res = await fetch('/api/tts/voices');
  return await parseResponseJson(res, 'Failed to fetch supported TTS voices');
}

/**
 * Generate real short voice preview audio from backend
 * @param {Object} params
 * @param {string} params.text
 * @param {string} [params.voiceId='km']
 * @param {string} [params.speed='normal']
 */
export async function previewVoiceApi({ text, voiceId = 'km-KH-PisethNeural', speed = 'normal' }) {
  const res = await fetch('/api/tts/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceId, speed }),
  });
  return await parseResponseJson(res, 'Failed to generate voice preview');
}

/**
 * Generate Khmer Speech Audio via TTS API (Microsoft Edge Neural TTS)
 * @param {Array|Object} params - segments array OR { segments, voiceId, speed, seriesId, episodeId }
 */
export async function generateAudioApi(params) {
  const isObject = !Array.isArray(params) && typeof params === 'object';
  const segments = isObject ? params.segments : params;
  const voiceId = isObject ? (params.voiceId || 'km-KH-PisethNeural') : 'km-KH-PisethNeural';
  const hasParamSpeed = isObject && params.speed !== undefined && params.speed !== null && params.speed !== '';
  const speed = hasParamSpeed ? params.speed : 'normal';
  const speakerMap = isObject ? (params.speakerMap || {}) : {};
  const projectName = isObject ? params.projectName : undefined;
  const videoId = isObject ? params.videoId : undefined;
  const seriesId = isObject ? params.seriesId : undefined;
  const episodeId = isObject ? params.episodeId : undefined;
  const forceRegen = isObject && params.forceRegen !== undefined ? Boolean(params.forceRegen) : false;
  const autoShortenOverflow = isObject && params.autoShortenOverflow !== undefined ? params.autoShortenOverflow : undefined;
  const disableAiAutoShorten = isObject && params.disableAiAutoShorten !== undefined ? Boolean(params.disableAiAutoShorten) : undefined;
  const isZeroGemini = isObject && params.isZeroGemini !== undefined ? Boolean(params.isZeroGemini) : undefined;

  const res = await fetch('/api/generate-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segments,
      voiceId,
      speed,
      speakerMap,
      projectName,
      videoId,
      seriesId,
      episodeId,
      forceRegen,
      autoShortenOverflow,
      disableAiAutoShorten,
      isZeroGemini,
    }),
  });

  const data = await parseResponseJson(res, 'Failed to generate audio speech with TTS');

  return {
    success: data.success !== false,
    alreadyCompleted: Boolean(data.alreadyCompleted),
    summaryMessage: data.summaryMessage,
    projectName: data.projectName,
    seriesId: data.seriesId || seriesId,
    episodeId: data.episodeId || episodeId,
    voiceId: data.voiceId || voiceId,
    speed: data.speed || speed,
    fullAudioPath: data.fullAudioPath,
    fullAudioUrl: data.fullAudioUrl,
    segments: data.segments,
    failedCount: Number(data.failedCount || 0),
    skippedEmptyCount: Number(data.skippedEmptyCount || 0),
    validCount: Number(data.validCount || 0),
    telemetry: data.telemetry,
    error: data.error,
  };
}

/**
 * Regenerate TTS audio for a single segment
 * @param {Object} segment 
 * @param {string|Object} [options='normal'] - speed string or { speed, voiceId, projectName, videoId, seriesId, episodeId }
 */
export async function generateSingleSegmentAudio(segment, options = {}) {
  const rawText = segment?.khmer || segment?.khmerText || segment?.khmerTranslatedText || segment?.text || '';
  if (!rawText || !String(rawText).trim()) {
    const segNum = segment?.index || segment?.id || '';
    const err = new Error(segNum ? `Segment #${segNum} គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន` : 'គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន');
    err.status = 400;
    throw err;
  }
  const isObj = typeof options === 'object' && options !== null;
  const hasOptSpeed = isObj
    ? (options.speed !== undefined && options.speed !== null && options.speed !== '')
    : (options !== undefined && options !== null && options !== '');
  const speed = hasOptSpeed
    ? (isObj ? options.speed : options)
    : (segment?.userCustomSpeed && segment?.speed !== undefined && segment?.speed !== null && segment?.speed !== '' ? segment.speed : undefined);
  const userCustomSpeed = isObj && options.userCustomSpeed !== undefined ? Boolean(options.userCustomSpeed) : undefined;
  const voiceId = isObj ? (options.voiceId || 'km-KH-PisethNeural') : 'km-KH-PisethNeural';
  const projectName = isObj ? (options.projectName || segment.projectName) : segment.projectName;
  const videoId = isObj ? (options.videoId || segment.videoId) : segment.videoId;
  const seriesId = isObj ? (options.seriesId || segment.seriesId) : segment.seriesId;
  const episodeId = isObj ? (options.episodeId || segment.episodeId) : segment.episodeId;
  const deliveryType = isObj ? (options.deliveryType || segment.deliveryType || 'out_loud') : (segment.deliveryType || 'out_loud');
  const audioEffect = isObj ? (options.audioEffect || segment.audioEffect || (deliveryType === 'inner_thought' ? 'inner_thought_reverb' : 'none')) : (segment.audioEffect || 'none');
  const deliveryOverride = isObj && options.deliveryOverride !== undefined ? options.deliveryOverride : Boolean(segment.deliveryOverride);
  const effectConfig = isObj ? (options.effectConfig || segment.effectConfig) : segment.effectConfig;
  const forceRegen = isObj && options.forceRegen !== undefined ? Boolean(options.forceRegen) : false;
  const preserveTrim = isObj && options.preserveTrim !== undefined ? Boolean(options.preserveTrim) : undefined;
  const timeoutMs = isObj && typeof options.timeoutMs === 'number' ? options.timeoutMs : 30000;
  const maxAttempts = isObj && typeof options.maxAttempts === 'number' ? options.maxAttempts : 2;
  const skipPeerDiskScan = isObj ? Boolean(options.skipPeerDiskScan) : false;
  const sharedAudioFiles = isObj && Array.isArray(options.sharedAudioFiles) ? options.sharedAudioFiles : undefined;
  const speakerUpdate = isObj && options.speakerUpdate && typeof options.speakerUpdate === 'object' ? options.speakerUpdate : undefined;

  const payload = JSON.stringify({
    segment: {
      ...segment,
      voice: voiceId,
      voiceId,
      khmerVoiceId: voiceId,
      deliveryType,
      audioEffect,
      deliveryOverride,
      effectConfig,
      audioOutdated: true,
      seriesId,
      episodeId,
    },
    ...(speed !== undefined ? { speed } : {}),
    ...(userCustomSpeed !== undefined ? { userCustomSpeed } : {}),
    ...(skipPeerDiskScan ? { skipPeerDiskScan: true } : {}),
    ...(preserveTrim !== undefined ? { preserveTrim } : {}),
    ...(sharedAudioFiles ? { sharedAudioFiles } : {}),
    ...(speakerUpdate ? { speakerUpdate } : {}),
    voiceId,
    forceVoice: true,
    deliveryType,
    audioEffect,
    deliveryOverride,
    effectConfig,
    projectName,
    videoId,
    seriesId,
    episodeId,
    forceRegen,
  });

  // Safe retry for transient 502 / ECONNRESET during server reload with configurable timeout
  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.status !== 502 && res.status !== 503) {
        break;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
      if (attempt + 1 < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (err.name === 'AbortError') {
        throw new Error(`TTS request timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
      }
      throw err;
    }
    if (attempt + 1 < maxAttempts && (res.status === 502 || res.status === 503)) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!res) {
    if (lastErr) {
      if (lastErr.name === 'AbortError') {
        throw new Error(`TTS request timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
      }
      throw lastErr;
    }
    throw new Error('Failed to generate single audio segment: No response received from server');
  }

  const data = await parseResponseJson(res, 'Failed to generate single audio segment');
  return data.segment;
}

/**
 * Trigger AI Vocal Separation (Demucs Turbo / Studio / FFmpeg Instant Clean BGM) for a single episode or video
 */
export async function separateAudioApi({ videoPath, seriesId = null, episodeId = null, twoStems = 'vocals', model, separationPreset = 'turbo', force = false, signal } = {}) {
  const payload = { videoPath, seriesId, episodeId, twoStems, separationPreset, force: Boolean(force) };
  if (model) {
    payload.model = model;
  }
  const res = await fetch('/api/audio/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return await parseResponseJson(res, 'Failed to trigger audio separation');
}

/**
 * Poll AI Vocal Separation progress for a given videoPath
 */
export async function getSeparationProgressApi(videoPath, { seriesId = null, episodeId = null, signal } = {}) {
  const params = new URLSearchParams({ videoPath: videoPath || '' });
  if (seriesId) params.set('seriesId', seriesId);
  if (episodeId) params.set('episodeId', episodeId);
  const res = await fetch(`/api/audio/separation-progress?${params.toString()}`, { signal });
  return await parseResponseJson(res, 'Failed to get separation progress');
}

/**
 * Check AI Vocal Separation final status for a given videoPath
 */
export async function getSeparationStatusApi(videoPath, { seriesId = null, episodeId = null, signal } = {}) {
  const res = await fetch('/api/audio/separation-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoPath, seriesId, episodeId }),
    signal,
  });
  return await parseResponseJson(res, 'Failed to check separation status');
}

/**
 * Kill active AI Vocal Separation process
 */
export async function killSeparationApi({ videoPath = '', jobId = '', seriesId = null, episodeId = null } = {}) {
  const res = await fetch('/api/audio/separate-kill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoPath, jobId, seriesId, episodeId }),
  });
  return await parseResponseJson(res, 'Failed to kill separation');
}

/**
 * Auto-Fit Speech Speed (1.05x - 1.50x) for red/overflowing/trimmed clips
 */
export async function autoFitSpeechSpeedApi({ seriesId, episodeId, maxSpeed = 1.50, targetSegmentIds = null, segments = null } = {}) {
  const res = await fetch('/api/audio/autofit-speed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seriesId, episodeId, maxSpeed, targetSegmentIds, segments }),
  });
  return await parseResponseJson(res, 'Failed to auto-fit speech speed');
}

