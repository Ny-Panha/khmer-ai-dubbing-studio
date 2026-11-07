const { getVideoMetadata, getMediaDuration } = require('../../ffmpegService');

/**
 * Stage 2: Analyze Source Media
 * Uses FFprobe to obtain duration, frame rate, resolution, aspect ratio,
 * and audio streams, establishing the canonical time reference.
 * 
 * @param {object} params
 * @param {string} params.videoPath
 * @returns {Promise<object>} Media metadata analysis
 */
async function analyzeSourceMedia({ videoPath }) {
  if (!videoPath) {
    throw new Error('[Stage 2 Analyze] Missing videoPath');
  }

  let metadata = null;
  let durationSec = 0;

  try {
    metadata = await getVideoMetadata(videoPath);
    durationSec = metadata?.durationSec || 0;
  } catch (probeErr) {
    console.warn(`[Stage 2 Analyze] getVideoMetadata warning (${probeErr.message}), falling back to getMediaDuration...`);
    durationSec = await getMediaDuration(videoPath).catch(() => 0);
  }

  if (!durationSec || durationSec <= 0) {
    throw new Error(`[Stage 2 Analyze] Failed to determine valid video duration for ${videoPath}`);
  }

  const fps = parseFloat(metadata?.fps) || 30;
  const width = parseInt(metadata?.width, 10) || 1920;
  const height = parseInt(metadata?.height, 10) || 1080;
  const aspectRatio = width >= height ? `${(width / height).toFixed(2)}:1` : `1:${(height / width).toFixed(2)}`;
  const hasAudio = metadata?.hasAudio !== false;
  const audioSampleRate = metadata?.audioSampleRate || 44100;
  const audioChannels = metadata?.audioChannels || 2;

  return {
    videoPath,
    durationSec: parseFloat(durationSec.toFixed(2)),
    fps,
    width,
    height,
    aspectRatio,
    hasAudio,
    audioSampleRate,
    audioChannels,
    analyzedAt: Date.now(),
  };
}

module.exports = {
  analyzeSourceMedia,
};
