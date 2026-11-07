/**
 * REST API Client for Khmer AI Dubbing Studio Backend
 */

/**
 * Safely parse JSON responses from backend or handle proxy errors (like 502 Bad Gateway)
 * @param {Response} res
 * @param {string} defaultErrMsg
 */
async function parseResponseJson(res, defaultErrMsg = 'Request failed') {
  let text = '';
  try {
    text = await res.text();
  } catch (readErr) {
    throw new Error(`${defaultErrMsg}: Could not read response stream (${readErr.message})`);
  }

  let data = null;
  if (text && text.trim().length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      // Response is not JSON (e.g. 502 Bad Gateway HTML or empty string from proxy)
      if (res.status === 502) {
        const error = new Error('Backend server is temporarily unreachable or restarting (502 Bad Gateway). Please check if backend is running.');
        error.status = 502;
        throw error;
      }
      if (!res.ok) {
        const error = new Error(`${defaultErrMsg}: Server returned status ${res.status} (${res.statusText || 'Error'})`);
        error.status = res.status;
        throw error;
      }
    }
  }

  if (!res.ok) {
    let rawError = data?.error;
    if (rawError === 'fetch failed' || rawError?.startsWith('fetch failed')) {
      rawError = 'ការតភ្ជាប់ទៅកាន់ Google Gemini AI បរាជ័យ (Network / Gemini API fetch failed)។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ឬ API Key។';
    }
    const errorMsg = rawError || (res.status === 502 
      ? 'Backend server is temporarily unreachable or restarting (502 Bad Gateway).' 
      : `${defaultErrMsg} (status ${res.status})`);
    const error = new Error(errorMsg);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  if (data && data.success === false) {
    let rawError = data.error;
    if (rawError === 'fetch failed' || rawError?.startsWith('fetch failed')) {
      rawError = 'ការតភ្ជាប់ទៅកាន់ Google Gemini AI បរាជ័យ (Network / Gemini API fetch failed)។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ឬ API Key។';
    }
    const error = new Error(rawError || defaultErrMsg);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data || {};
}

/**
 * Check backend health status
 */
export async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { online: false, data: null };
    const text = await res.text();
    if (!text || !text.trim()) return { online: false, data: null };
    const data = JSON.parse(text);
    return { online: true, data };
  } catch {
    return { online: false, data: null };
  }
}

/**
 * Extract genuine media metadata via FFprobe
 * @param {string} videoId 
 */
export async function fetchVideoMetadata(videoId) {
  const res = await fetch('/api/video-metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId }),
  });
  const data = await parseResponseJson(res, 'Failed to extract video metadata');
  return data.metadata;
}

/**
 * Extract genuine keyframe thumbnails for timeline filmstrips
 * @param {string} videoId
 * @param {number} duration
 */
export async function fetchVideoThumbnails(videoId, duration = 30) {
  try {
    const res = await fetch('/api/video-thumbnails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, duration }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.success && Array.isArray(data.thumbnails)) {
      return data.thumbnails.map(t => (typeof t === 'string' ? t : t.url));
    }
  } catch (err) {
    console.warn('Backend video thumbnails fetch notice:', err.message);
  }
  return null;
}

/**
 * Upload video file to server with client validation
 * @param {File} file 
 * @param {Object} [options] - { seriesId, episodeId }
 */
export async function uploadVideoFile(file, options = {}) {
  if (!file) {
    throw new Error('Please select a video file.');
  }

  // Validate file type
  const validExtensions = ['.mp4', '.mov', '.mkv', '.webm', '.avi'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!file.type.startsWith('video/') && !validExtensions.includes(ext)) {
    throw new Error(`Unsupported file type (${ext}). Please select an MP4, MOV, MKV, or WEBM video.`);
  }

  // Unlimited Video Size Support (up to 25 GB)
  const maxBytes = 25 * 1024 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum limit is 25 GB.`);
  }

  // Support both object: uploadVideoFile(file, { seriesId, episodeId })
  // and legacy positional arguments: uploadVideoFile(file, seriesId, episodeId)
  const opts = (typeof options === 'string' || arguments.length > 2)
    ? { seriesId: arguments[1], episodeId: arguments[2] }
    : (options || {});

  const cleanOriginalName = file.name;
  const displayTitle = (opts.displayTitle || cleanOriginalName.replace(/\.[^/.]+$/, '')).trim();

  const formData = new FormData();
  formData.append('video', file, cleanOriginalName);
  formData.append('originalFilename', cleanOriginalName);
  formData.append('displayTitle', displayTitle);
  if (opts.seriesId) formData.append('seriesId', opts.seriesId);
  if (opts.episodeId) formData.append('episodeId', opts.episodeId);
  if (opts.projectName) formData.append('projectName', opts.projectName);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  const data = await parseResponseJson(res, 'Video upload failed');

  const decodedFileName = data.originalFilename || data.fileName || cleanOriginalName;
  const finalDisplayTitle = data.displayTitle || displayTitle || decodedFileName.replace(/\.[^/.]+$/, '');

  return {
    videoId: data.videoId || data.file?.filename,
    videoUrl: data.videoUrl || data.file?.url,
    videoPath: data.videoPath || data.file?.path,
    fileName: cleanOriginalName || decodedFileName,
    originalFilename: cleanOriginalName || decodedFileName,
    displayTitle: finalDisplayTitle,
    storageFilename: data.storageFilename || data.fileName,
    size: data.size || (file.size / (1024 * 1024)).toFixed(1) + ' MB',
    sizeBytes: data.sizeBytes || file.size,
    seriesId: data.seriesId || opts.seriesId || null,
    episodeId: data.episodeId || opts.episodeId || null,
    uploadedAt: Date.now(),
  };
}

/**
 * Generate Khmer Storytelling Script using Gemini AI
 * @param {Object} params
 * @param {string} params.videoId
 * @param {string} [params.mode='dialogue']
 * @param {string} [params.recapStyle='standard']
 * @param {string} [params.customPrompt='']
 * @param {string} [params.inputText='']
 * @param {string} [params.apiKey]
 * @param {string} [params.requestId]
 * @param {string} [params.projectId]
 * @param {AbortSignal} [params.signal]
 */
export async function generateScriptApi({ 
  videoId, 
  mode = 'dialogue', 
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
  signal 
}) {
  const res = await fetch('/api/generate-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      videoId,
      mode,
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
  const speed = isObject ? (params.speed || 'normal') : 'normal';
  const speakerMap = isObject ? (params.speakerMap || {}) : {};
  const projectName = isObject ? params.projectName : undefined;
  const videoId = isObject ? params.videoId : undefined;
  const seriesId = isObject ? params.seriesId : undefined;
  const episodeId = isObject ? params.episodeId : undefined;
  const forceRegen = isObject && params.forceRegen !== undefined ? Boolean(params.forceRegen) : false;

  const res = await fetch('/api/generate-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, voiceId, speed, speakerMap, projectName, videoId, seriesId, episodeId, forceRegen }),
  });

  const data = await parseResponseJson(res, 'Failed to generate audio speech with TTS');

  return {
    projectName: data.projectName,
    seriesId: data.seriesId || seriesId,
    episodeId: data.episodeId || episodeId,
    voiceId: data.voiceId || voiceId,
    speed: data.speed || speed,
    fullAudioPath: data.fullAudioPath,
    fullAudioUrl: data.fullAudioUrl,
    segments: data.segments,
  };
}

/**
 * Regenerate TTS audio for a single segment
 * @param {Object} segment 
 * @param {string|Object} [options='normal'] - speed string or { speed, voiceId, projectName, videoId, seriesId, episodeId }
 */
export async function generateSingleSegmentAudio(segment, options = 'normal') {
  const isObj = typeof options === 'object' && options !== null;
  const speed = isObj ? (options.speed || 'normal') : (options || 'normal');
  const voiceId = isObj ? (options.voiceId || 'km-KH-PisethNeural') : 'km-KH-PisethNeural';
  const projectName = isObj ? (options.projectName || segment.projectName) : segment.projectName;
  const videoId = isObj ? (options.videoId || segment.videoId) : segment.videoId;
  const seriesId = isObj ? (options.seriesId || segment.seriesId) : segment.seriesId;
  const episodeId = isObj ? (options.episodeId || segment.episodeId) : segment.episodeId;
  const deliveryType = isObj ? (options.deliveryType || segment.deliveryType || 'out_loud') : (segment.deliveryType || 'out_loud');
  const audioEffect = isObj ? (options.audioEffect || segment.audioEffect || (deliveryType === 'inner_thought' ? 'inner_thought_reverb' : 'none')) : (segment.audioEffect || 'none');
  const deliveryOverride = isObj && options.deliveryOverride !== undefined ? options.deliveryOverride : Boolean(segment.deliveryOverride);
  const effectConfig = isObj ? (options.effectConfig || segment.effectConfig) : segment.effectConfig;
  const forceRegen = isObj && options.forceRegen !== undefined ? options.forceRegen : true;

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
    speed,
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

  // Safe retry for transient 502 / ECONNRESET during server reload
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (res.status !== 502 && res.status !== 503) {
        break;
      }
    } catch (err) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
    if (attempt === 0 && (res.status === 502 || res.status === 503)) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const data = await parseResponseJson(res, 'Failed to generate single audio segment');
  return data.segment;
}

export async function renderVideoApi({
  videoId,
  projectName,
  seriesId,
  episodeId,
  segments = [],
  videoClips = [],
  fullAudioPath,
  duckingVolume = 0.15,
  khmerVolume = 1.3,
  enableDemucs = false,
  burnSubtitles = true,
  subtitleColor = 'white',
  subtitleSize = 'medium',
  subtitleStyle = 'banner',
  aspectRatio = '16:9',
  subtitleOptions = {},
  voiceId = 'km-KH-PisethNeural',
  speed = 'normal',
  speakerMap = {},
  antiTheft = null,
  logoSettings = null,
  videoTitle = null,
}) {
  const res = await fetch('/api/render-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      projectName,
      videoTitle,
      seriesId,
      episodeId,
      segments,
      videoClips,
      fullAudioPath,
      duckingVolume,
      khmerVolume,
      enableDemucs: Boolean(enableDemucs),
      burnSubtitles,
      subtitleColor,
      subtitleSize,
      subtitleStyle,
      aspectRatio,
      subtitleOptions,
      voiceId,
      speed,
      speakerMap,
      antiTheft,
      logoSettings,
    }),
  });

  return await parseResponseJson(res, 'Failed to render video with FFmpeg');
}

/**
 * Fast Re-sync of Timeline Audio positions without re-generating TTS
 * @param {Array} segments 
 * @param {string} [projectName]
 * @param {string} [videoId]
 * @param {string} [episodeId]
 * @param {string} [seriesId]
 */
export async function syncTimelineAudioApi(segments, projectName, videoId, episodeId = null, seriesId = null) {
  const res = await fetch('/api/sync-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, projectName, videoId, episodeId, seriesId }),
  });
  return await parseResponseJson(res, 'Failed to re-sync timeline audio');
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
 * ✨ Batch AI Re-Translation for All Segments (Cinema Drama Mode)
 * @param {Array} segments
 * @param {string} [seriesId]
 * @param {string} [episodeId]
 * @param {Object} [options]
 */
/**
 * Start Background Dubbing Pipeline Job (Async / Non-blocking)
 */
export async function startGenerationJob(params = {}) {
  const res = await fetch('/api/jobs/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return await parseResponseJson(res, 'Failed to start background dubbing job');
}

/**
 * Poll Background Dubbing Job Status
 */
export async function getJobStatus(jobId, { seriesId, episodeId, signal } = {}) {
  const query = new URLSearchParams();
  if (seriesId) query.set('seriesId', seriesId);
  if (episodeId) query.set('episodeId', episodeId);
  const qs = query.toString() ? `?${query.toString()}` : '';
  const res = await fetch(`/api/jobs/${jobId}/status${qs}`, { signal });
  return await parseResponseJson(res, `Failed to poll status for job ${jobId}`);
}

/**
 * Cancel Background Dubbing Job
 */
export async function cancelJobApi(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
  return await parseResponseJson(res, `Failed to cancel job ${jobId}`);
}


/**
 * Auto-Split a long video into episodes
 */
export async function splitVideoEpisodesApi({
  videoId,
  videoPath,
  sourceVideoPath,
  seriesId,
  durationMinutes = 1,
  chunkDurationMinutes,
  episodeCount,
}) {
  const actualRef = videoId || videoPath || sourceVideoPath;
  const actualDuration = Number(durationMinutes || chunkDurationMinutes) || 1;
  const res = await fetch('/api/split-video-episodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: actualRef,
      videoPath: videoPath || sourceVideoPath || actualRef,
      seriesId,
      durationMinutes: actualDuration,
      episodeCount: episodeCount ? Number(episodeCount) : undefined,
    }),
  });
  return await parseResponseJson(res, 'Failed to auto-split video into episodes');
}

/**
 * Fetch all background dubbing jobs with optional status filter (Phase 4.4 Dashboard)
 */
export async function fetchJobsListApi({ filter, signal } = {}) {
  const qs = filter && filter !== 'all' ? `?filter=${encodeURIComponent(filter)}` : '';
  const res = await fetch(`/api/jobs${qs}`, { signal });
  return await parseResponseJson(res, 'Failed to fetch jobs list');
}

/**
 * Fetch specific job details by Job ID
 */
/**
 * Pause a running or queued job
 */
export async function pauseJobApi(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/pause`, {
    method: 'POST',
  });
  return await parseResponseJson(res, `Failed to pause job ${jobId}`);
}

/**
 * Resume a paused or failed job
 */
export async function resumeJobApi(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/resume`, {
    method: 'POST',
  });
  return await parseResponseJson(res, `Failed to resume job ${jobId}`);
}

/**
 * Retry a failed or cancelled job
 */
export async function retryJobApi(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/retry`, {
    method: 'POST',
  });
  return await parseResponseJson(res, `Failed to retry job ${jobId}`);
}

/**
 * Fetch realtime Gemini API keys status and quota health
 */
export async function fetchGeminiKeysStatusApi({ signal } = {}) {
  const res = await fetch('/api/gemini/keys-status', { signal });
  return await parseResponseJson(res, 'Failed to fetch Gemini keys status');
}
