/**
 * Video Media Management, Splitting, Series Sync & FFmpeg Rendering API
 * DragonDub AI Studio - Frontend Services
 */

import { parseResponseJson, notifyBackendOffline, notifyBackendOnline } from './client.js';

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
 * Auto-Split a long video into episodes
 */
export async function splitVideoEpisodesApi({
  videoId,
  videoPath,
  sourceVideoPath,
  seriesId,
  episodeId,
  durationMinutes,
  chunkDurationMinutes,
  durationSeconds,
  episodeCount,
  replaceEpisodes = false,
}) {
  const actualRef = videoId || videoPath || sourceVideoPath;
  const parsedMin = (durationMinutes !== undefined && durationMinutes !== null && durationMinutes !== '')
    ? Number(durationMinutes)
    : ((chunkDurationMinutes !== undefined && chunkDurationMinutes !== null && chunkDurationMinutes !== '') ? Number(chunkDurationMinutes) : undefined);
  const parsedSec = (durationSeconds !== undefined && durationSeconds !== null && durationSeconds !== '')
    ? Number(durationSeconds)
    : undefined;
  const parsedCount = (episodeCount !== undefined && episodeCount !== null && episodeCount !== '')
    ? Number(episodeCount)
    : undefined;

  const res = await fetch('/api/split-video-episodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: actualRef,
      videoPath: videoPath || sourceVideoPath || actualRef,
      seriesId,
      episodeId,
      durationMinutes: parsedMin,
      durationSeconds: parsedSec,
      episodeCount: parsedCount,
      replaceEpisodes: Boolean(replaceEpisodes),
    }),
  });
  return await parseResponseJson(res, 'Failed to auto-split video into episodes');
}

/**
 * Synchronize series state with backend server
 * @param {Object} series
 */
export async function syncSeriesApi(series) {
  if (!series?.id) return { success: false };
  try {
    const res = await fetch(`/api/series/${series.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ series }),
    });
    if (res.status === 502 || !res.ok) {
      notifyBackendOffline();
    } else {
      notifyBackendOnline();
    }
    return await parseResponseJson(res, `Failed to sync series ${series.id}`);
  } catch (err) {
    if (/ECONNREFUSED|unreachable|Failed to fetch|NetworkError/i.test(err?.message || '')) {
      notifyBackendOffline();
    }
    throw err;
  }
}

/**
 * Delete an episode from a series on backend
 * @param {string} seriesId
 * @param {string} episodeId
 */
export async function deleteEpisodeApi(seriesId, episodeId) {
  if (!seriesId || !episodeId) return { success: false };
  try {
    const res = await fetch(`/api/series/${seriesId}/episodes/${episodeId}`, {
      method: 'DELETE',
    });
    return await parseResponseJson(res, `Failed to delete episode ${episodeId}`);
  } catch (err) {
    if (/ECONNREFUSED|unreachable|Failed to fetch|NetworkError/i.test(err?.message || '')) {
      notifyBackendOffline();
    }
    throw err;
  }
}

/**
 * Render complete video with FFmpeg, burning subtitles and blending audio
 */
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
  aspectRatio = null,
  verticalStyle = 'pad',
  sourceDimensions = null,
  subtitleOptions = {},
  voiceId = 'km-KH-PisethNeural',
  speed = 'normal',
  speakerMap = {},
  antiTheft = null,
  logoSettings = null,
  sponsorSettings = null,
  videoTitle = null,
}) {
  let effectiveAspectRatio = aspectRatio;
  if (!effectiveAspectRatio) {
    const w = Number(sourceDimensions?.width) || 0;
    const h = Number(sourceDimensions?.height) || 0;
    if (w && h) {
      effectiveAspectRatio = h > w ? '9:16' : (w > h ? '16:9' : '1:1');
    } else {
      console.warn('[renderVideoApi] Source video metadata genuinely missing dimensions, falling back to 16:9 last-resort.');
      effectiveAspectRatio = '16:9';
    }
  }

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
      aspectRatio: effectiveAspectRatio,
      verticalStyle: verticalStyle || 'pad',
      subtitleOptions: {
        ...subtitleOptions,
        aspectRatio: effectiveAspectRatio,
        verticalStyle: verticalStyle || 'pad',
      },
      voiceId,
      speed,
      speakerMap,
      antiTheft,
      logoSettings,
      sponsorSettings,
    }),
  });

  return await parseResponseJson(res, 'Failed to render video with FFmpeg');
}

