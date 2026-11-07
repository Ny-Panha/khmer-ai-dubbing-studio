const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

function getFileSha256(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  } catch {
    return null;
  }
}

function sanitizeIdentifier(id, fallback = 'default') {
  if (!id) return fallback;
  const cleaned = String(id)
    .replace(/[/\\?%*:|"<>~#&!$;^{}`\s]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
  return cleaned || fallback;
}

/**
 * Stage 1: Ingest Episode
 * Validates original source media, guarantees episode directory isolation,
 * records SHA-256 hash, and generates unique jobId.
 * 
 * @param {object} params
 * @param {string} params.videoPath
 * @param {string} [params.seriesId]
 * @param {string} [params.episodeId]
 * @param {string} [params.baseUploadsDir]
 * @returns {Promise<object>} Ingestion context
 */
async function ingestEpisode({
  videoPath,
  seriesId = 'series_default',
  episodeId = 'ep_1',
  baseUploadsDir = null,
}) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`[Stage 1 Ingest] Source video file not found at: ${videoPath}`);
  }

  const stat = fs.statSync(videoPath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`[Stage 1 Ingest] Invalid video file (empty or directory): ${videoPath}`);
  }

  const safeSeriesId = sanitizeIdentifier(seriesId, 'series_default');
  const safeEpisodeId = sanitizeIdentifier(episodeId, 'ep_1');
  const uploadsDir = baseUploadsDir || path.resolve(__dirname, '../../../uploads');

  const episodeDir = path.join(uploadsDir, 'projects', safeSeriesId, 'episodes', safeEpisodeId);
  const videoDir = path.join(episodeDir, 'video');
  const audioDir = path.join(episodeDir, 'audio');
  const subtitlesDir = path.join(episodeDir, 'subtitles');

  for (const dir of [videoDir, audioDir, subtitlesDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const fileHash = getFileSha256(videoPath);
  const jobId = `job_${Date.now()}_${uuidv4().substring(0, 8)}`;

  return {
    jobId,
    videoPath: path.resolve(videoPath),
    videoFileName: path.basename(videoPath),
    videoSizeBytes: stat.size,
    fileHash,
    seriesId: safeSeriesId,
    episodeId: safeEpisodeId,
    episodeDir,
    videoDir,
    audioDir,
    subtitlesDir,
    ingestedAt: Date.now(),
  };
}

module.exports = {
  ingestEpisode,
  getFileSha256,
  sanitizeIdentifier,
};
