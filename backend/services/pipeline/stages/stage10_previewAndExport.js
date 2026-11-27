const fs = require('fs');
const path = require('path');
const {
  generateKhmerAssSubtitleFile,
  generateSrtFile,
  renderDubbedVideoWithDucking,
  getVideoDimensionsFast,
  resolveRenderAspectRatio,
  getMediaDuration,
} = require('../../ffmpegService');
const { saveCheckpoint } = require('../checkpointManager');
const { scanEpisodeBrokenSegments } = require('../../../utils/translationQuality');

function buildExportReadinessReport(segments = [], { checkAudioOnDisk = false, hasMasterAudio = false } = {}) {
  const safeSegs = Array.isArray(segments) ? segments : [];
  const checkAudioFileFn = checkAudioOnDisk
    ? (seg) => {
        if (hasMasterAudio) return true;
        const p = seg?.audioPath;
        return Boolean(p && typeof p === 'string' && fs.existsSync(p) && fs.statSync(p).size > 200);
      }
    : null;
  const scan = scanEpisodeBrokenSegments({ scriptData: { segments: safeSegs } }, { checkAudioFileFn });
  const reviewNeededSegmentIds = safeSegs
    .filter((s) => Boolean(s?.reviewNeeded || s?.translationStatus === 'review_needed' || s?.ttsStatus === 'error' || s?.ttsStatus === 'failed'))
    .map((s, idx) => s.sourceCueId || s.segmentId || s.id || idx + 1);

  const reviewWarnings = [];
  if (scan.textBrokenCount > 0) {
    reviewWarnings.push(
      `មានឃ្លា ${scan.textBrokenCount}/${safeSegs.length} មិនទាន់មានអត្ថបទខ្មែរត្រឹមត្រូវ (IDs: ${scan.textBrokenSegmentIds.slice(0, 10).join(', ')})`
    );
  }
  if (checkAudioOnDisk && !hasMasterAudio && scan.voiceBrokenCount > 0) {
    reviewWarnings.push(
      `មានឃ្លា ${scan.voiceBrokenCount}/${safeSegs.length} ខ្វះ ឬបរាជ័យសំឡេង TTS (IDs: ${scan.voiceBrokenSegmentIds.slice(0, 10).join(', ')})`
    );
  }
  if (reviewNeededSegmentIds.length > 0 && reviewWarnings.length === 0) {
    reviewWarnings.push(
      `មានឃ្លា ${reviewNeededSegmentIds.length}/${safeSegs.length} ត្រូវការផ្ទៀងផ្ទាត់មុន Export (review_needed)`
    );
  }

  return {
    totalSegments: safeSegs.length,
    untranslatedCount: scan.textBrokenCount,
    untranslatedSegmentIds: scan.textBrokenSegmentIds,
    missingOrFailedAudioCount: scan.voiceBrokenCount,
    missingOrFailedAudioSegmentIds: scan.voiceBrokenSegmentIds,
    reviewNeededCount: reviewNeededSegmentIds.length,
    reviewNeededSegmentIds,
    hasIncompleteDialogue: scan.textBrokenCount > 0 || (checkAudioOnDisk && !hasMasterAudio && scan.voiceBrokenCount > 0),
    reviewNeeded: reviewWarnings.length > 0,
    reviewWarnings,
  };
}

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

  const sourceDimensions = getVideoDimensionsFast(videoPath);
  const options = exportOptions.subtitleOptions || {};
  const subtitleSize = options.subtitleSize ?? exportOptions.subtitleSize;
  const subtitleOptions = {
    textColor: options.textColor || exportOptions.subtitleColor || '#FFFFFF',
    subtitleSize,
    // Older stage callers used subtitleSize for an explicit number.
    fontSize: options.fontSize ?? exportOptions.fontSize ?? (Number(subtitleSize) || null),
    aspectRatio: resolveRenderAspectRatio(options.aspectRatio || exportOptions.aspectRatio, sourceDimensions),
    verticalStyle: options.verticalStyle || exportOptions.verticalStyle || 'pad',
  };
  generateKhmerAssSubtitleFile({
    segments,
    outputPath: assPath,
    ...subtitleOptions,
    sourceDimensions,
  });

  generateSrtFile(segments, srtPath);

  const assExists = fs.existsSync(assPath) && fs.statSync(assPath).size > 20;
  const srtExists = fs.existsSync(srtPath) && fs.statSync(srtPath).size > 10;

  const exportReadiness = buildExportReadinessReport(segments, {
    checkAudioOnDisk: Boolean(exportOptions.renderVideo),
    hasMasterAudio: Boolean(exportOptions.masterAudioPath && fs.existsSync(exportOptions.masterAudioPath)),
  });
  if (exportReadiness.reviewWarnings.length > 0) {
    console.warn(`[Stage 10 Export] ⚠️ Review warning(s): ${exportReadiness.reviewWarnings.join(' | ')}`);
  }
  if (exportOptions.renderVideo && exportOptions.blockOnIncomplete && exportReadiness.hasIncompleteDialogue) {
    const err = new Error(`Export blocked: ${exportReadiness.reviewWarnings.join('; ')}`);
    err.code = 'EXPORT_REVIEW_NEEDED';
    err.statusCode = 400;
    err.exportReadiness = exportReadiness;
    throw err;
  }

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
      subtitleOptions,
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
        stageStatus: exportReadiness.reviewNeeded ? 'review_needed' : 'completed',
        data: {
          assSubtitlePath: assExists ? assPath : null,
          srtSubtitlePath: srtExists ? srtPath : null,
          outputVideoPath,
          validationResult,
          exportReadiness,
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
    reviewNeeded: exportReadiness.reviewNeeded,
    reviewWarnings: exportReadiness.reviewWarnings,
    exportReadiness,
    exportedAt: Date.now(),
  };
}

module.exports = {
  previewAndExport,
  buildExportReadinessReport,
};
