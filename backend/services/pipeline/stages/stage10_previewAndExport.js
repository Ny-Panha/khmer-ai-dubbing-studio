const fs = require('fs');
const path = require('path');
const {
  generateKhmerAssSubtitleFile,
  generateSrtFile,
  renderDubbedVideoWithDucking,
  getVideoMetadata,
  getMediaDuration,
} = require('../../ffmpegService');
const { saveCheckpoint } = require('../checkpointManager');

/**
 * Stage 10: Preview and Export
 * Generates subtitle files (ASS/SRT), synchronizes timeline data,
 * and renders/validates exported dubbed video with audio ducking and Job isolation.
 * 
 * @param {object} params
 * @param {string} params.videoPath - Original video
 * @param {Array} params.segments - Canonical segments
 * @param {string} params.episodeDir - Episode root dir
 * @param {object} [params.exportOptions={}]
 * @param {string} [params.jobId=null]
 * @param {string} [params.seriesId='series_default']
 * @param {string} [params.episodeId='ep_1']
 * @param {AbortSignal} [params.signal=null]
 * @param {string} [params.baseUploadsDir=null]
 * @returns {Promise<object>} Export artifacts and validation result
 */
async function previewAndExport({
  videoPath,
  segments = [],
  episodeDir,
  exportOptions = {},
  jobId = null,
  seriesId = 'series_default',
  episodeId = 'ep_1',
  signal = null,
  baseUploadsDir = null,
}) {
  if (!episodeDir) {
    // កែពី ../../../../uploads មកជា ../../../uploads
    const uploadsDir = baseUploadsDir || path.resolve(__dirname, '../../../uploads');
    episodeDir = path.join(
      uploadsDir,
      'projects',
      String(seriesId).replace(/[/\\?%*:|"<>]/g, '_'),
      'episodes',
      String(episodeId).replace(/[/\\?%*:|"<>]/g, '_')
    );
  }
  if (!fs.existsSync(episodeDir)) {
    fs.mkdirSync(episodeDir, { recursive: true });
  }

  if (signal?.aborted) {
    const err = new Error('Export cancelled by user signal');
    err.name = 'AbortError';
    throw err;
  }

  const subtitlesDir = path.join(episodeDir, 'subtitles');
  if (!fs.existsSync(subtitlesDir)) {
    fs.mkdirSync(subtitlesDir, { recursive: true });
  }

  // 1. Generate Subtitle Files (.ass and .srt)
  const assPath = path.join(subtitlesDir, 'dialogue_khmer.ass');
  const srtPath = path.join(subtitlesDir, 'dialogue_khmer.srt');

  generateKhmerAssSubtitleFile({
    segments,
    outputPath: assPath,
    textColor: exportOptions.subtitleColor || '#FFFFFF',
    fontSize: exportOptions.subtitleSize || 52,
    aspectRatio: exportOptions.aspectRatio || '16:9',
    verticalStyle: exportOptions.verticalStyle || 'pad',
  });

  generateSrtFile(segments, srtPath);

  const assExists = fs.existsSync(assPath) && fs.statSync(assPath).size > 20;
  const srtExists = fs.existsSync(srtPath) && fs.statSync(srtPath).size > 10;

  // 2. Video Rendering if requested
  let outputVideoPath = null;
  let validationResult = { valid: true };

  if (exportOptions.renderVideo && videoPath && fs.existsSync(videoPath)) {
    if (signal?.aborted) {
      const err = new Error('Render cancelled before start');
      err.name = 'AbortError';
      throw err;
    }

    const videoOutDir = path.join(episodeDir, 'video');
    if (!fs.existsSync(videoOutDir)) {
      fs.mkdirSync(videoOutDir, { recursive: true });
    }
    const outFilename = `dubbed_export_${Date.now()}.mp4`;
    const targetOutPath = path.join(videoOutDir, outFilename);

    const renderRes = await renderDubbedVideoWithDucking({
      inputVideoPath: videoPath,
      videoPath,
      segments,
      outputVideoPath: targetOutPath,
      outputPath: targetOutPath,
      subtitlePath: assPath,
      subtitleOptions: {
        assSubtitlePath: assPath,
        srtSubtitlePath: srtPath,
        textColor: exportOptions.subtitleColor || '#FFFFFF',
        fontSize: exportOptions.subtitleSize || 52,
        aspectRatio: exportOptions.aspectRatio || '16:9',
        verticalStyle: exportOptions.verticalStyle || 'pad',
      },
      aspectRatio: exportOptions.aspectRatio,
      verticalStyle: exportOptions.verticalStyle || 'pad',
      burnSubtitles: exportOptions.burnSubtitles !== false,
      bgVolume: exportOptions.bgVolume ?? exportOptions.duckingVolume ?? 0.15,
      duckingVolume: exportOptions.duckingVolume ?? exportOptions.bgVolume ?? 0.15,
      khmerVolume: exportOptions.khmerVolume ?? 1.3,
      logoSettings: exportOptions.logoSettings || null,
      antiTheft: exportOptions.antiTheft || null,
      jobId,
      signal,
    });

    outputVideoPath = renderRes.outputVideoPath;

    // Validate rendered video with FFprobe
    if (outputVideoPath && fs.existsSync(outputVideoPath)) {
      const stat = fs.statSync(outputVideoPath);
      const renderedDur = await getMediaDuration(outputVideoPath).catch(() => 0);
      validationResult = {
        valid: stat.size > 100000 && renderedDur > 0,
        renderedSizeBytes: stat.size,
        renderedDurationSec: renderedDur,
      };
    } else {
      validationResult = { valid: false, error: 'Rendered video file not created' };
    }
  }

  // 3. Persist Stage 10 Checkpoint if Job ID provided
  if (jobId) {
    try {
      saveCheckpoint({
        jobId,
        seriesId,
        episodeId,
        stage: 'stage10_previewAndExport',
        stageIndex: 10,
        stageStatus: 'completed',
        data: {
          assSubtitlePath: assExists ? assPath : null,
          srtSubtitlePath: srtExists ? srtPath : null,
          outputVideoPath,
          validationResult,
        },
        baseUploadsDir,
      });
    } catch (_) {}
  }

  return {
    assSubtitlePath: assExists ? assPath : null,
    srtSubtitlePath: srtExists ? srtPath : null,
    outputVideoPath,
    validationResult,
    exportedAt: Date.now(),
  };
}

module.exports = {
  previewAndExport,
};
