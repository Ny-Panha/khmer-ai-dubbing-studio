const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  uploadsDir,
  isSafeUploadPath,
  safeDecodeURI,
  sanitizeProjectName,
  ensureProjectDirs,
  resolveMediaFile,
} = require("../utils/pathUtils");
const {
  getVideoMetadata,
  getOrCreateVideoThumbnails,
  renderDubbedVideoWithDucking,
  splitVideoIntoEpisodes,
} = require("../services/ffmpegService");
const {
  getSeriesMetadata,
  saveSeriesMetadata,
  withSeriesMetadataLock,
  ensureEpisodeDirectories,
} = require("../services/episodeService");
const {
  startBatchExportJob,
  getBatchExportJob,
  getLatestBatchExportJob,
  cancelBatchExportJob,
} = require("../services/batchExportService");
const { analyzeEpisodeFraming } = require("../services/smartReframeService");
const {
  getEffectiveGlobalLogoSettingsForExport,
  getEffectiveGlobalCornerMaskForExport,
  getEffectiveGlobalAntiTheftForExport,
} = require("../services/globalLogoSettingsService");

const router = express.Router();

/**
 * 1. Extract real video stream metadata via FFprobe
 */
router.post("/video-metadata", async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) return res.status(400).json({ error: "videoId is required" });
    const videoPath = resolveMediaFile(videoId);
    if (!videoPath || !fs.existsSync(videoPath)) return res.status(404).json({ error: "Video file not found" });

    const metadata = await getVideoMetadata(videoPath);
    res.json({ success: true, metadata });
  } catch (err) {
    console.error("Metadata extraction error:", err);
    res.status(500).json({ error: err.message || "Failed to extract video metadata" });
  }
});

/**
 * 2. Extract / Retrieve lightweight timeline video keyframe thumbnails (120x68)
 */
router.post("/video-thumbnails", async (req, res) => {
  try {
    const { videoId, videoPath: inputPath, episodeDir, duration } = req.body;
    const rawRef = inputPath || videoId;
    if (!rawRef) {
      return res.status(400).json({ error: "videoId or videoPath is required" });
    }

    const resolvedVideoPath = resolveMediaFile(rawRef);
    if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
      return res.status(404).json({ error: "Video file not found" });
    }

    // Determine episode directory if provided or deduce from path
    let targetEpisodeDir = episodeDir;
    if (!targetEpisodeDir && resolvedVideoPath.includes("episodes")) {
      const match = resolvedVideoPath.match(/^(.*episodes[/\\][^/\\]+)/);
      if (match) targetEpisodeDir = match[1];
    }

    const thumbnails = await getOrCreateVideoThumbnails(resolvedVideoPath, targetEpisodeDir, duration);
    res.json({ success: true, count: thumbnails.length, thumbnails });
  } catch (err) {
    console.error("Timeline thumbnail generation error:", err);
    res.status(500).json({ error: err.message || "Failed to generate video thumbnails" });
  }
});

router.get("/video-thumbnails", async (req, res) => {
  try {
    const { videoId, duration } = req.query;
    if (!videoId) return res.status(400).json({ error: "videoId is required" });
    const resolvedVideoPath = resolveMediaFile(videoId);
    if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
      return res.status(404).json({ error: "Video file not found" });
    }
    let targetEpisodeDir = null;
    if (resolvedVideoPath.includes("episodes")) {
      const match = resolvedVideoPath.match(/^(.*episodes[/\\][^/\\]+)/);
      if (match) targetEpisodeDir = match[1];
    }
    const thumbnails = await getOrCreateVideoThumbnails(resolvedVideoPath, targetEpisodeDir, Number(duration) || 30);
    res.json({ success: true, count: thumbnails.length, thumbnails });
  } catch (err) {
    console.error("Timeline thumbnail generation error:", err);
    res.status(500).json({ error: err.message || "Failed to generate video thumbnails" });
  }
});

/**
 * 3. Video Render endpoint (Smart Ducking 85% + ASS Subtitles + Downloads Export)
 */
router.post("/render-video", async (req, res) => {
  if (req.socket) {
    req.socket.setTimeout(0);
    if (typeof req.socket.setKeepAlive === "function") {
      req.socket.setKeepAlive(true, 10000);
    }
  }
  if (typeof res.setTimeout === "function") {
    res.setTimeout(0);
  }
  try {
    const {
      videoId,
      videoFileName,
      videoPath,
      projectName,
      segments = [],
      videoClips = [],
      fullAudioPath,
      soundMode = "ducking",
      duckingVolume = 0.15,
      bgVolume = null,
      khmerVolume = 1.3,
      enableDemucs = false,
      separationPreset = "turbo",
      burnSubtitles = true,
      subtitleColor = "white",
      subtitleSize = "medium",
      subtitleStyle = "banner",
      subtitleOptions = {},
      antiTheft = null,
      logoSettings = null,
      cornerMask = null,
      sponsorSettings = null,
      youtubeTransform = null,
    } = req.body;

    const rawVideoRef = videoPath || videoId || (videoFileName ? path.join(uploadsDir, videoFileName) : null);
    if (!rawVideoRef) {
      return res.status(400).json({ success: false, error: "videoId ឬ videoFileName ត្រូវបានទាមទារ" });
    }

    const inputVideoPath = resolveMediaFile(rawVideoRef);
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញវីដេអូដើម៖ ${rawVideoRef}` });
    }

    const rawEpisodeId = req.body?.episodeId || null;
    const rawSeriesId = req.body?.seriesId || null;
    const rawProjectName = projectName || path.basename(rawVideoRef, path.extname(rawVideoRef)).replace(/_source$/, "");
    const { videoDir, audioDir, cleanName, cleanSeries, cleanEpisode, isEpisode } = ensureProjectDirs(rawProjectName, rawEpisodeId, rawSeriesId);

    const effectiveBgVolume = bgVolume !== null ? Number(bgVolume) : Number(duckingVolume);
    const effectiveKhmerVolume = Number(khmerVolume) || 1.3;

    // Map segments with resolved audio paths
    const preparedSegments = segments.map((seg) => {
      const audioCandidate = seg.audioPath || seg.audioFile || (seg.audioUrl ? path.basename(seg.audioUrl) : null);
      const resolvedAudio = audioCandidate ? resolveMediaFile(audioCandidate) : null;
      return {
        ...seg,
        audioPath: resolvedAudio,
      };
    });

    // Resolve master narration audio file if available
    let resolvedMasterAudio = fullAudioPath ? resolveMediaFile(fullAudioPath) : null;

    // Strict Episode Audio Isolation Guard:
    if (isEpisode && resolvedMasterAudio) {
      const expectedEpAudioDir = path.resolve(audioDir);
      const actualMasterAudioDir = path.dirname(path.resolve(resolvedMasterAudio));
      if (expectedEpAudioDir.toLowerCase() !== actualMasterAudioDir.toLowerCase()) {
        console.warn(`[Render] ⚠️ Cross-episode master audio leak prevented! Audio ${resolvedMasterAudio} does not belong to ${cleanSeries}/${cleanEpisode}. Ignoring.`);
        resolvedMasterAudio = null;
      }
    }

    if (!resolvedMasterAudio || !fs.existsSync(resolvedMasterAudio)) {
      const epNarration = isEpisode ? `${cleanEpisode}_narration_khmer.mp3` : `${cleanName}_narration_khmer.mp3`;
      const candidateNarration = path.join(audioDir, epNarration);
      if (fs.existsSync(candidateNarration)) {
        resolvedMasterAudio = candidateNarration;
      }
    }

    // Verify sidecar metadata fingerprint if available
    if (resolvedMasterAudio && fs.existsSync(resolvedMasterAudio)) {
      const metaPath = `${resolvedMasterAudio}.meta.json`;
      if (fs.existsSync(metaPath)) {
        try {
          const sidecar = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          if (isEpisode && (sidecar.episodeId !== cleanEpisode || sidecar.seriesId !== cleanSeries)) {
            console.warn(`[Render] ⚠️ Stale master audio fingerprint detected: belongs to ${sidecar.seriesId}/${sidecar.episodeId}, not ${cleanSeries}/${cleanEpisode}. Discarding.`);
            resolvedMasterAudio = null;
          }
        } catch (_) {}
      }
    }

    // Determine human-readable export title
    const candidateExportTitle = req.body?.videoTitle || req.body?.displayTitle || req.body?.originalFilename || projectName;
    let safeExportTitle = "";
    if (candidateExportTitle && typeof candidateExportTitle === "string") {
      safeExportTitle = candidateExportTitle
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\.[^/.]+$/, "")
        .trim();
    }

    const hasMeaningfulTitle = Boolean(
      safeExportTitle &&
      !/^series_\d+/i.test(safeExportTitle) &&
      !/^ep_\d+/i.test(safeExportTitle) &&
      safeExportTitle.toLowerCase() !== "drama_recap" &&
      safeExportTitle.toLowerCase() !== "drama_project"
    );

    const rawAspectRatio = subtitleOptions.aspectRatio || req.body.aspectRatio || req.body.voiceSettings?.aspectRatio;
    let targetAspectRatio = rawAspectRatio;
    if (!targetAspectRatio) {
      let srcDims = req.body.sourceDimensions || null;
      if (!srcDims?.width || !srcDims?.height) {
        try {
          srcDims = await getVideoMetadata(inputVideoPath);
        } catch (_) {}
      }
      if (srcDims?.width && srcDims?.height) {
        targetAspectRatio = srcDims.height > srcDims.width ? "9:16" : (srcDims.width > srcDims.height ? "16:9" : "1:1");
      } else {
        console.warn("[RenderVideo] Source video metadata genuinely missing dimensions, falling back to 16:9 last-resort");
        targetAspectRatio = "16:9";
      }
    }
    const verticalStyle = subtitleOptions.verticalStyle || req.body.verticalStyle || req.body.voiceSettings?.verticalStyle || "pad";
    const ratioSuffix = targetAspectRatio === "9:16" && !safeExportTitle.includes("9-16")
      ? " [9-16 TikTok Reels]"
      : (targetAspectRatio === "1:1" && !safeExportTitle.includes("1-1") ? " [1-1 Square]" : "");

    const exportBaseName = hasMeaningfulTitle
      ? `${safeExportTitle}${ratioSuffix}`
      : (isEpisode ? `${cleanSeries}_${cleanEpisode}_Khmer_Dubbed${ratioSuffix}` : `${cleanName}_Khmer_Dubbed${ratioSuffix}`);

    const outputFilename = `${exportBaseName}.mp4`;
    const outputVideoPath = path.join(videoDir, outputFilename);

    // Direct destination in Windows Downloads folder
    const userDownloadsDir = path.join(os.homedir(), "Downloads");
    const downloadsExportPath = fs.existsSync(userDownloadsDir)
      ? path.join(userDownloadsDir, outputFilename)
      : null;

    // Clean up previous output in project directory
    if (fs.existsSync(outputVideoPath)) {
      try {
        fs.unlinkSync(outputVideoPath);
      } catch {}
    }

    console.log(
      `[Render] Starting video render for ${cleanSeries}${isEpisode ? ` [Episode: ${cleanEpisode}]` : ""} [Ratio: ${targetAspectRatio}] (MasterAudio: ${resolvedMasterAudio ? path.basename(resolvedMasterAudio) : 'None'}, Ducking: ${effectiveBgVolume}, Boost: ${effectiveKhmerVolume}, Subtitles: ${burnSubtitles})...`
    );

    // Prepare subtitle options with auto-scaling font size for 9:16 vs 16:9
    const finalSubOptions = {
      fontName: subtitleOptions.fontName || "Khmer OS Battambang",
      fontSize: subtitleOptions.fontSize || null,
      subtitleSize: subtitleOptions.subtitleSize || req.body?.subtitleSize || null,
      textColor: subtitleOptions.textColor || (subtitleColor === "yellow" ? "#FFE600" : "#FFFFFF"),
      outlineColor: subtitleOptions.outlineColor || "#000000",
      subtitleStyle: subtitleOptions.subtitleStyle || req.body?.subtitleStyle || subtitleStyle || "banner",
      aspectRatio: targetAspectRatio,
      verticalStyle,
      marginV: subtitleOptions.marginV || null,
    };

    // Resolve Logo Watermark (Global settings store; never read per-episode voiceSettings)
    let resolvedLogoPath = null;
    let tempLogoFile = null;
    const rawLogo = logoSettings || getEffectiveGlobalLogoSettingsForExport() || null;
    if (rawLogo && (rawLogo.enabled || rawLogo.enableLogo) && (rawLogo.image || rawLogo.logoImage)) {
      const imgVal = rawLogo.image || rawLogo.logoImage;
      if (typeof imgVal === "string" && imgVal.startsWith("data:image")) {
        const matches = imgVal.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
          tempLogoFile = path.join(videoDir, `temp_logo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`);
          fs.writeFileSync(tempLogoFile, Buffer.from(matches[2], "base64"));
          resolvedLogoPath = tempLogoFile;
        }
      } else if (typeof imgVal === "string") {
        const candidate1 = path.join(__dirname, "../../frontend/public", imgVal.replace(/^\//, ""));
        const candidate2 = path.join(uploadsDir, path.basename(imgVal));
        const candidate3 = resolveMediaFile(imgVal);
        if (fs.existsSync(candidate1)) resolvedLogoPath = candidate1;
        else if (fs.existsSync(candidate2)) resolvedLogoPath = candidate2;
        else if (candidate3 && fs.existsSync(candidate3)) resolvedLogoPath = candidate3;
      }
    }

    // Resolve Sponsor Ads Video (Green Screen MP4 / MOV / WebM)
    let resolvedSponsorPath = null;
    const rawSponsor = sponsorSettings || req.body?.voiceSettings?.sponsorSettings || req.body?.voiceSettings || null;
    if (rawSponsor && (rawSponsor.enableSponsor || rawSponsor.enabled) && (rawSponsor.sponsorVideoUrl || rawSponsor.sponsorVideoPath || rawSponsor.videoUrl || rawSponsor.videoPath)) {
      const vidVal = rawSponsor.sponsorVideoPath || rawSponsor.videoPath || rawSponsor.sponsorVideoUrl || rawSponsor.videoUrl;
      if (typeof vidVal === "string") {
        const candidate1 = path.join(__dirname, "../../frontend/public", vidVal.replace(/^\//, ""));
        const candidate2 = path.join(uploadsDir, path.basename(vidVal));
        const candidate3 = path.join(uploadsDir, "sponsor", path.basename(vidVal));
        const candidate4 = resolveMediaFile(vidVal);
        if (fs.existsSync(candidate1)) resolvedSponsorPath = candidate1;
        else if (fs.existsSync(candidate2)) resolvedSponsorPath = candidate2;
        else if (fs.existsSync(candidate3)) resolvedSponsorPath = candidate3;
        else if (candidate4 && fs.existsSync(candidate4)) resolvedSponsorPath = candidate4;
        else if (fs.existsSync(vidVal)) resolvedSponsorPath = vidVal;
      }
    }

    // Resolve Custom Loop BGM Music (.mp3 / .wav / .m4a / .ogg / .aac)
    let resolvedCustomBgmPath = null;
    const rawEnableCustomBgm = Boolean(
      req.body?.enableCustomBgm ?? req.body?.voiceSettings?.enableCustomBgm
    );
    const rawCustomBgmRef =
      req.body?.customBgmPath ||
      req.body?.customBgmUrl ||
      req.body?.voiceSettings?.customBgmPath ||
      req.body?.voiceSettings?.customBgmUrl ||
      null;
    if (rawEnableCustomBgm && typeof rawCustomBgmRef === "string" && rawCustomBgmRef.trim()) {
      const candidate1 = path.join(uploadsDir, "bgm", path.basename(rawCustomBgmRef));
      const candidate2 = path.join(uploadsDir, path.basename(rawCustomBgmRef));
      const candidate3 = resolveMediaFile(rawCustomBgmRef);
      if (fs.existsSync(candidate1) && isSafeUploadPath(candidate1, uploadsDir)) resolvedCustomBgmPath = candidate1;
      else if (fs.existsSync(candidate2) && isSafeUploadPath(candidate2, uploadsDir)) resolvedCustomBgmPath = candidate2;
      else if (candidate3 && fs.existsSync(candidate3) && isSafeUploadPath(candidate3, uploadsDir)) resolvedCustomBgmPath = candidate3;
    }

    const effectiveYoutubeTransform = youtubeTransform || req.body?.voiceSettings?.youtubeTransform || (
      req.body?.voiceSettings && (
        req.body.voiceSettings.enableMirrorFlip !== undefined ||
        req.body.voiceSettings.zoomScale !== undefined ||
        req.body.voiceSettings.enableColorGrade !== undefined ||
        req.body.voiceSettings.youtubeSafeAudio !== undefined
      )
        ? {
            enableMirrorFlip: Boolean(req.body.voiceSettings.enableMirrorFlip),
            zoomScale: Number(req.body.voiceSettings.zoomScale) || 1.0,
            enableColorGrade: Boolean(req.body.voiceSettings.enableColorGrade),
            youtubeSafeAudio: Boolean(req.body.voiceSettings.youtubeSafeAudio),
          }
        : null
    );

    let renderResult;
    try {
      renderResult = await renderDubbedVideoWithDucking({
        inputVideoPath,
        masterAudioPath: resolvedMasterAudio && fs.existsSync(resolvedMasterAudio) ? resolvedMasterAudio : null,
        fullAudioPath: resolvedMasterAudio && fs.existsSync(resolvedMasterAudio) ? resolvedMasterAudio : null,
        segments: preparedSegments,
        outputVideoPath,
        soundMode,
        enableDemucs: Boolean(enableDemucs),
        separationPreset,
        bgVolume: effectiveBgVolume,
        khmerVolume: effectiveKhmerVolume,
        burnSubtitles: Boolean(burnSubtitles),
        subtitleOptions: finalSubOptions,
        aspectRatio: targetAspectRatio,
        verticalStyle,
        videoClips,
        framingKeyframes: req.body?.framingKeyframes || [],
        framingOverrides: req.body?.framingOverrides || [],
        antiTheft: antiTheft || req.body?.voiceSettings?.antiTheft || getEffectiveGlobalAntiTheftForExport() || null,
        logoSettings: resolvedLogoPath ? {
          ...rawLogo,
          logoPath: resolvedLogoPath,
        } : null,
        cornerMask: cornerMask || req.body?.voiceSettings?.cornerMask || getEffectiveGlobalCornerMaskForExport() || null,
        sponsorSettings: resolvedSponsorPath ? {
          ...rawSponsor,
          sponsorPath: resolvedSponsorPath,
        } : null,
        youtubeTransform: effectiveYoutubeTransform,
        enableCustomBgm: Boolean(resolvedCustomBgmPath),
        customBgmPath: resolvedCustomBgmPath,
      });
    } finally {
      if (tempLogoFile && fs.existsSync(tempLogoFile)) {
        try { fs.unlinkSync(tempLogoFile); } catch {}
      }
    }

    // Automatically copy rendered MP4 to user's Windows Downloads directory
    if (downloadsExportPath && fs.existsSync(outputVideoPath)) {
      try {
        fs.copyFileSync(outputVideoPath, downloadsExportPath);
        console.log(`✅ [Export Success] Dubbed video saved directly to Downloads folder: ${downloadsExportPath}`);
      } catch (copyErr) {
        console.warn("Could not copy directly to Downloads folder:", copyErr.message);
      }
    }

    const relVideoPath = isEpisode
      ? `projects/${cleanSeries}/episodes/${cleanEpisode}/video/${outputFilename}`
      : `projects/${cleanName}/video/${outputFilename}`;
    const videoUrl = `/uploads/${relVideoPath}`;

    res.json({
      success: true,
      projectName: cleanSeries,
      seriesId: cleanSeries,
      episodeId: cleanEpisode,
      videoUrl,
      outputVideoUrl: videoUrl,
      outputFilename,
      downloadUrl: `/api/download-export?file=${encodeURIComponent(relVideoPath)}&name=${encodeURIComponent(outputFilename)}`,
      renderTimeSeconds: renderResult.renderTimeSeconds,
      savedToDownloads: Boolean(downloadsExportPath),
      downloadsPath: downloadsExportPath,
      aspectRatio: targetAspectRatio,
      verticalStyle,
    });
  } catch (err) {
    console.error("Render Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 3b. Secure Export Download Endpoint (validates path strictly within uploadsDir)
 */
router.get("/download-export", (req, res) => {
  try {
    const rawFile = req.query?.file;
    if (!rawFile || typeof rawFile !== "string") {
      return res.status(400).json({ success: false, error: "file query parameter is required" });
    }

    const decodedFile = safeDecodeURI(rawFile).trim();
    if (!decodedFile || decodedFile.includes("\0")) {
      return res.status(403).json({ success: false, error: "Access denied: invalid export path" });
    }

    const hasUploadsPrefix = /^[/\\]?uploads[/\\]/i.test(decodedFile);
    const cleanRel = decodedFile.replace(/^[/\\]?uploads[/\\]+/i, "");
    const resolvedPath =
      !hasUploadsPrefix && path.isAbsolute(decodedFile)
        ? path.resolve(decodedFile)
        : path.resolve(uploadsDir, cleanRel);

    if (!isSafeUploadPath(resolvedPath, uploadsDir)) {
      return res.status(403).json({ success: false, error: "Access denied: path outside uploads directory" });
    }

    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      return res.status(404).json({ success: false, error: "Export file not found" });
    }

    const rawName = req.query?.name ? safeDecodeURI(String(req.query.name)) : path.basename(resolvedPath);
    const safeDownloadName =
      path
        .basename(rawName)
        .replace(/[<>:"/\\|?*\r\n\t\0]/g, "_")
        .trim() || path.basename(resolvedPath);

    return res.download(resolvedPath, safeDownloadName);
  } catch (err) {
    console.error("[DownloadExport Error]:", err);
    return res.status(500).json({ success: false, error: err.message || "Download failed" });
  }
});

/**
 * 3c. Batch Export & Full Video Merge Async Job Endpoints
 */
router.post("/render-batch", async (req, res) => {
  try {
    const {
      seriesId,
      episodeIds = [],
      mode = "merge",
      allowOriginalAudio = false,
      exportSettings = {},
      episodeOverrides = {},
    } = req.body || {};

    const job = await startBatchExportJob({
      seriesId,
      episodeIds,
      mode,
      allowOriginalAudio: Boolean(allowOriginalAudio),
      exportSettings,
      episodeOverrides,
    });

    return res.json({ success: true, job });
  } catch (err) {
    console.error("[BatchRender Start Error]:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || "Failed to start batch export",
      skippedEpisodes: err.skippedEpisodes || [],
      jobId: err.jobId || null,
    });
  }
});

router.get("/render-batch/progress", (req, res) => {
  try {
    const { jobId, seriesId } = req.query || {};
    const job = jobId
      ? getBatchExportJob(String(jobId))
      : (seriesId ? getLatestBatchExportJob(String(seriesId)) : null);

    if (!job) {
      return res.status(404).json({ success: false, error: "Batch export job not found" });
    }
    return res.json({ success: true, job });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/render-batch/latest", (req, res) => {
  try {
    const { seriesId } = req.query || {};
    if (!seriesId) {
      return res.status(400).json({ success: false, error: "seriesId is required" });
    }
    const job = getLatestBatchExportJob(String(seriesId));
    return res.json({ success: true, job: job || null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/render-batch/kill", (req, res) => {
  try {
    const { jobId, seriesId } = req.body || {};
    const result = cancelBatchExportJob(jobId || null, seriesId || null);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Robustly matches an episode whose video corresponds to the split input video.
 * Checks canonical filesystem paths, resolveMediaFile results, normalized URL/rel paths, and episodeId.
 */
function findSourceEpisodeIndex(existingEpisodes = [], rawVideoRef, inputVideoPath, targetEpisodeId = null) {
  if (!Array.isArray(existingEpisodes) || existingEpisodes.length === 0) return -1;

  // 1. Direct ID match if caller provided episodeId
  if (targetEpisodeId) {
    const cleanTargetId = String(targetEpisodeId).trim().toLowerCase();
    const idIdx = existingEpisodes.findIndex(e => e && String(e.id).toLowerCase() === cleanTargetId);
    if (idIdx !== -1) return idIdx;
  }

  const resolvedInputCanonical = inputVideoPath ? path.resolve(inputVideoPath).toLowerCase() : null;

  const normalizeRef = (val) => {
    if (!val || typeof val !== "string") return "";
    return val
      .split("?")[0]
      .split("#")[0]
      .replace(/^[/\\]?uploads[/\\]?/i, "")
      .replace(/\\/g, "/")
      .toLowerCase()
      .trim();
  };

  const normRaw = normalizeRef(rawVideoRef);
  const normInput = inputVideoPath ? normalizeRef(inputVideoPath) : "";

  for (let i = 0; i < existingEpisodes.length; i++) {
    const ep = existingEpisodes[i];
    if (!ep) continue;

    const candidateRefs = [
      ep.sourceVideoPath,
      ep.video?.videoPath,
      ep.videoFile,
      ep.video?.videoId,
      ep.video?.videoUrl,
      ep.video?.fileName,
      ep.video?.storageFilename,
    ].filter(Boolean);

    // 2. Canonical absolute path matching (safest across platform/casing)
    if (resolvedInputCanonical) {
      for (const ref of candidateRefs) {
        try {
          const resolved = resolveMediaFile(ref) || (path.isAbsolute(ref) ? ref : null);
          if (resolved && path.resolve(resolved).toLowerCase() === resolvedInputCanonical) {
            return i;
          }
        } catch (_) {}
      }
    }

    // 3. Normalized relative path / videoId matching
    for (const ref of candidateRefs) {
      const normCandidate = normalizeRef(ref);
      if (normCandidate && (normCandidate === normRaw || normCandidate === normInput)) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * 4. Auto-Split Long Video (1-2 Hours) into Episodes
 */
router.post("/split-video-episodes", async (req, res) => {
  try {
    if (req.socket) {
      req.socket.setTimeout(0);
      req.socket.setKeepAlive(true, 10000);
    }
    if (typeof res.setTimeout === "function") {
      res.setTimeout(0);
    }

    const { videoPath, videoId, seriesId, episodeId, durationMinutes, durationSeconds, episodeCount, replaceEpisodes = false, deleteOriginalSource = true } = req.body;
    const rawVideoRef = videoPath || videoId;
    if (!rawVideoRef) {
      return res.status(400).json({ success: false, error: "videoPath or videoId is required" });
    }

    const epCountNum = (episodeCount !== undefined && episodeCount !== null && episodeCount !== "") ? Number(episodeCount) : null;
    const durMinNum = (durationMinutes !== undefined && durationMinutes !== null && durationMinutes !== "") ? Number(durationMinutes) : null;
    const durSecNum = (durationSeconds !== undefined && durationSeconds !== null && durationSeconds !== "") ? Number(durationSeconds) : null;

    const hasValidEpCount = epCountNum !== null && !isNaN(epCountNum) && epCountNum >= 2;
    const hasValidDurSec = durSecNum !== null && !isNaN(durSecNum) && durSecNum > 0;
    const hasValidDurMin = durMinNum !== null && !isNaN(durMinNum) && durMinNum > 0;

    if (!hasValidEpCount && !hasValidDurSec && !hasValidDurMin) {
      return res.status(400).json({
        success: false,
        error: "user must choose episode count or minutes"
      });
    }

    const inputVideoPath = resolveMediaFile(rawVideoRef);
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return res.status(404).json({ success: false, error: "Source video not found: " + rawVideoRef });
    }

    const meta = await getVideoMetadata(inputVideoPath);
    const totalDuration = meta?.duration || 0;

    let targetDurationSec;
    if (hasValidEpCount) {
      targetDurationSec = Math.max(10, totalDuration / epCountNum);
    } else if (hasValidDurSec) {
      targetDurationSec = Math.max(10, durSecNum);
    } else {
      targetDurationSec = Math.max(10, durMinNum * 60);
    }

    const targetSeries = seriesId || "drama_project";
    const cleanSeries = sanitizeProjectName(targetSeries);

    const tempOutputDir = path.join(uploadsDir, "temp_splits", `split_${Date.now()}`);
    fs.mkdirSync(tempOutputDir, { recursive: true });

    const chunks = await splitVideoIntoEpisodes({
      inputVideoPath,
      targetDurationSec,
      outputDir: tempOutputDir,
      filePrefix: cleanSeries,
    });

    const splitPersistResult = await withSeriesMetadataLock(cleanSeries, () => {
      const currentSeries = getSeriesMetadata(cleanSeries, { forceDisk: true }) || { id: cleanSeries, title: "រឿងភាគ", episodes: [] };
      const existing = currentSeries.episodes || [];
      const shouldReplace = Boolean(replaceEpisodes);

      // 1. Identify source episode: the entry whose video IS the split input
      const sourceIndex = findSourceEpisodeIndex(existing, rawVideoRef, inputVideoPath, episodeId);
      const sourceEpisodeFound = sourceIndex !== -1;

      // 2. Partition existing episodes around source:
      // When shouldReplace is false, we keep other existing episodes excluding the source episode.
      // When shouldReplace is true, existing episodes are completely replaced by chunks.
      const keptBefore = (sourceEpisodeFound && !shouldReplace)
        ? existing.slice(0, sourceIndex)
        : (!sourceEpisodeFound && !shouldReplace ? existing : []);
      const keptAfter = (sourceEpisodeFound && !shouldReplace)
        ? existing.slice(sourceIndex + 1)
        : [];

      const keptEpisodes = [...keptBefore, ...keptAfter];
      const occupiedIds = new Set(keptEpisodes.map((e) => String(e.id).toLowerCase()));
      const usedChunkIds = new Set();

      const builtEpisodes = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Target display index:
        const epDisplayNum = (sourceEpisodeFound ? sourceIndex : keptBefore.length) + i + 1;

        // Assign chunk episode ID avoiding any collision with kept episodes
        let epId = null;
        const candidatePrefId = `ep_${epDisplayNum}`;
        if (!occupiedIds.has(candidatePrefId.toLowerCase()) && !usedChunkIds.has(candidatePrefId.toLowerCase())) {
          epId = candidatePrefId;
        } else {
          let n = 1;
          while (occupiedIds.has(`ep_${n}`.toLowerCase()) || usedChunkIds.has(`ep_${n}`.toLowerCase())) {
            n++;
          }
          epId = `ep_${n}`;
        }
        usedChunkIds.add(epId.toLowerCase());

        const { videoDir } = ensureEpisodeDirectories(cleanSeries, epId);
        let epVideoFilename = `${cleanSeries}_${epId}_source.mp4`;
        let epVideoDestPath = path.join(videoDir, epVideoFilename);

        // Guard: Never overwrite the source input video file on disk
        if (inputVideoPath && path.resolve(epVideoDestPath).toLowerCase() === path.resolve(inputVideoPath).toLowerCase()) {
          epVideoFilename = `${cleanSeries}_${epId}_chunk_source.mp4`;
          epVideoDestPath = path.join(videoDir, epVideoFilename);
        }

        // Copy chunk to isolated episode video folder
        fs.copyFileSync(chunk.outputPath, epVideoDestPath);
        try { fs.unlinkSync(chunk.outputPath); } catch (_) {}

        const epVideoUrl = `/uploads/projects/${cleanSeries}/episodes/${epId}/video/${epVideoFilename}`;
        const epTitle = `ភាគទី ${epDisplayNum} (EP${epDisplayNum})`;

        let fileStatSize = 0;
        try { fileStatSize = fs.statSync(epVideoDestPath).size; } catch (_) {}

        const epObj = {
          id: epId,
          episodeNumber: epDisplayNum,
          title: epTitle,
          displayTitle: epTitle,
          status: "uploaded",
          videoFile: epVideoUrl,
          sourceVideoPath: epVideoDestPath,
          duration: chunk.duration,
          video: {
            videoId: `projects/${cleanSeries}/episodes/${epId}/video/${epVideoFilename}`,
            fileName: epVideoFilename,
            originalFilename: `${cleanSeries}_EP${epDisplayNum}.mp4`,
            displayTitle: epTitle,
            storageFilename: epVideoFilename,
            videoUrl: epVideoUrl,
            videoPath: epVideoDestPath,
            durationSec: chunk.duration,
            width: meta?.width || 1920,
            height: meta?.height || 1080,
            sizeMB: parseFloat((fileStatSize / (1024 * 1024)).toFixed(2)),
            size: (fileStatSize / (1024 * 1024)).toFixed(1) + " MB",
          },
          metadata: {
            duration: chunk.duration,
            durationSec: chunk.duration,
            width: meta?.width || 1920,
            height: meta?.height || 1080,
            resolution: meta?.resolution || (meta?.width ? `${meta.width}x${meta.height}` : "1920x1080"),
            hasAudio: meta?.hasAudio !== false,
          },
          scriptData: null,
          speakerRegistry: {},
          audioGenerated: false,
          audioOutdated: false,
          fullAudioPath: null,
          fullAudioUrl: null,
          videoClips: [],
          activeClipId: null,
          selectedSegmentId: null,
        };

        builtEpisodes.push(epObj);
      }

      try { fs.rmdirSync(tempOutputDir); } catch (_) {}

      // Construct final episodes list:
      // If source episode was found, chunks replace the source episode at its former index
      const finalEpisodes = sourceEpisodeFound
        ? (shouldReplace ? builtEpisodes : [...keptBefore, ...builtEpisodes, ...keptAfter])
        : (shouldReplace ? builtEpisodes : [...existing, ...builtEpisodes]);

      // Renumber display numbering (episodeNumber) 1..N across the final array
      for (let idx = 0; idx < finalEpisodes.length; idx++) {
        const ep = finalEpisodes[idx];
        const newNum = idx + 1;
        const oldNum = ep.episodeNumber;
        ep.episodeNumber = newNum;

        // Update generic titles to match new sequential number
        const isGeneric = !ep.title ||
          new RegExp(`^ភាគទី\\s*${oldNum}\\s*\\(EP${oldNum}\\)$`, 'i').test(ep.title.trim()) ||
          /^ភាគទី\s*[\d០-៩]+\s*\(EP[\d០-៩]+\)$/i.test(ep.title.trim()) ||
          /^\(EP[\d០-៩]+\)$/i.test(ep.title.trim());

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
      }

      currentSeries.episodes = finalEpisodes;
      saveSeriesMetadata(currentSeries);

      return { currentSeries, builtEpisodes, sourceEpisodeFound };
    });

    const { currentSeries, builtEpisodes, sourceEpisodeFound } = splitPersistResult;

    // Option A: Automatically delete the original uncut source video now that all chunks have been created and saved
    const shouldDeleteOriginal = (deleteOriginalSource !== false && deleteOriginalSource !== 'false');
    if (shouldDeleteOriginal && inputVideoPath && fs.existsSync(inputVideoPath)) {
      const isPathUsedByChunks = builtEpisodes.some(
        (ep) => ep.sourceVideoPath && path.resolve(ep.sourceVideoPath).toLowerCase() === path.resolve(inputVideoPath).toLowerCase()
      );
      if (!isPathUsedByChunks) {
        try {
          fs.unlinkSync(inputVideoPath);
          console.log(`[Split Endpoint] 🗑️ Cleaned up original uncut source video: ${inputVideoPath}`);
        } catch (delErr) {
          console.warn(`[Split Endpoint] Failed to delete original uncut video ${inputVideoPath}:`, delErr.message);
        }
      }
    }

    const totalSeriesCount = currentSeries.episodes.length;
    console.log(`[Split Endpoint] ✅ Successfully split video into ${builtEpisodes.length} episodes for "${cleanSeries}" (Series total: ${totalSeriesCount} episodes, source replaced: ${sourceEpisodeFound})`);

    res.json({
      success: true,
      message: `បានកាត់បំបែកវីដេអូជា ${builtEpisodes.length} ភាគជោគជ័យ! សរុបក្នុងរឿងមាន ${totalSeriesCount} ភាគ (${(targetDurationSec / 60).toFixed(0)} នាទី/ភាគ)`,
      episodes: builtEpisodes,
      series: currentSeries,
      totalEpisodes: totalSeriesCount,
      chunkCount: builtEpisodes.length,
      sourceReplaced: sourceEpisodeFound,
    });
  } catch (err) {
    console.error("[Split Video Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post(["/analyze-framing", "/video/analyze-framing"], async (req, res) => {
  try {
    const { seriesId, episodeId, videoPath: customVideoPath } = req.body;
    if (!seriesId || !episodeId) {
      return res.status(400).json({ success: false, error: "seriesId and episodeId are required" });
    }

    const seriesData = getSeriesMetadata(seriesId);
    if (!seriesData || !Array.isArray(seriesData.episodes)) {
      return res.status(404).json({ success: false, error: "Series or episodes not found" });
    }

    const ep = seriesData.episodes.find((e) => e.id === episodeId || String(e.episodeNumber) === String(episodeId));
    if (!ep) {
      return res.status(404).json({ success: false, error: "Episode not found" });
    }

    const rawVideoRef = customVideoPath || ep.videoPath || ep.sourceVideoPath || ep.videoFile;
    const resolvedVideoPath = resolveMediaFile(rawVideoRef, seriesId);
    if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
      return res.status(400).json({ success: false, error: "Valid video file not found for episode" });
    }

    const segments = ep.segments || [];
    if (segments.length === 0) {
      return res.json({ success: true, segments: [], count: 0, message: "No segments to analyze" });
    }

    console.log(`[SmartReframe] 🎯 Analyzing 9:16 Face Framing for ${seriesId} [${ep.id || ep.episodeNumber}] (${segments.length} segments)...`);
    const analyzed = await analyzeEpisodeFraming({ videoPath: resolvedVideoPath, segments });

    ep.segments = analyzed;
    ep.framingAnalyzed = true;
    ep.framingAnalyzedAt = new Date().toISOString();
    saveSeriesMetadata(seriesData);

    console.log(`[SmartReframe] ✅ Finished framing analysis for ${segments.length} segments.`);
    res.json({ success: true, segments: analyzed, count: analyzed.length });
  } catch (err) {
    console.error("[SmartReframe Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post(["/update-segment-crop", "/video/update-segment-crop"], async (req, res) => {
  try {
    const { seriesId, episodeId, segmentId, cropX, cropPosition, rangeStart, rangeEnd } = req.body;
    if (!seriesId || !episodeId || segmentId === undefined) {
      return res.status(400).json({ success: false, error: "seriesId, episodeId, and segmentId are required" });
    }

    const seriesData = getSeriesMetadata(seriesId);
    if (!seriesData || !Array.isArray(seriesData.episodes)) {
      return res.status(404).json({ success: false, error: "Series or episodes not found" });
    }

    const ep = seriesData.episodes.find((e) => e.id === episodeId || String(e.episodeNumber) === String(episodeId));
    if (!ep || !Array.isArray(ep.segments)) {
      return res.status(404).json({ success: false, error: "Episode or segments not found" });
    }

    const numCrop = Number(cropX);
    const clampedCrop = !isNaN(numCrop) ? Math.max(5, Math.min(95, numCrop)) : 50;
    const resolvedPos = cropPosition || (clampedCrop < 35 ? "left" : clampedCrop > 65 ? "right" : "center");

    let updated = false;
    const isGap = String(segmentId).startsWith("gap_") || rangeStart !== undefined;

    if (!isGap && Array.isArray(ep.segments)) {
      ep.segments = ep.segments.map((s, idx) => {
        const match = (s._uid && s._uid === segmentId) || (s.id !== undefined && String(s.id) === String(segmentId)) || (idx === Number(segmentId));
        if (match) {
          updated = true;
          return {
            ...s,
            cropX: clampedCrop,
            cropPosition: resolvedPos,
            manualCrop: true,
          };
        }
        return s;
      });
    }

    // Always purge any corrupt whole-episode overrides
    if (Array.isArray(ep.framingOverrides)) {
      ep.framingOverrides = ep.framingOverrides.filter((o) => !(o.startSec === 0 && o.endSec > 30));
    }

    if (!updated && (isGap || rangeStart !== undefined)) {
      const rStart = Number(rangeStart) || 0;
      const rEnd = Number(rangeEnd) || (rStart + 2);
      // Guard: Never create an override spanning the whole episode
      if (!(rStart === 0 && rEnd > 30) && (rEnd - rStart <= 35)) {
        ep.framingOverrides = ep.framingOverrides || [];
        const existingIdx = ep.framingOverrides.findIndex((o) => o.id === segmentId || (Math.abs(o.startSec - rStart) < 0.2));
        if (existingIdx >= 0) {
          ep.framingOverrides[existingIdx] = {
            ...ep.framingOverrides[existingIdx],
            cropX: clampedCrop,
            cropPosition: resolvedPos,
            startSec: rStart,
            endSec: rEnd,
            manualCrop: true,
          };
        } else {
          ep.framingOverrides.push({
            id: segmentId || `gap_${Date.now()}`,
            cropX: clampedCrop,
            cropPosition: resolvedPos,
            startSec: rStart,
            endSec: rEnd,
            manualCrop: true,
          });
        }
        updated = true;
      }
    }

    if (updated) {
      saveSeriesMetadata(seriesData);
    }

    res.json({ success: true, updated, cropX: clampedCrop, cropPosition: resolvedPos, framingOverrides: ep.framingOverrides || [] });
  } catch (err) {
    console.error("[Update Crop Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post(["/update-framing-keyframes", "/video/update-framing-keyframes"], async (req, res) => {
  try {
    const { seriesId, episodeId, keyframes = [] } = req.body;
    if (!seriesId || !episodeId) {
      return res.status(400).json({ success: false, error: "seriesId and episodeId are required" });
    }

    const seriesData = getSeriesMetadata(seriesId);
    if (!seriesData || !Array.isArray(seriesData.episodes)) {
      return res.status(404).json({ success: false, error: "Series or episodes not found" });
    }

    const ep = seriesData.episodes.find((e) => e.id === episodeId || String(e.episodeNumber) === String(episodeId));
    if (!ep) {
      return res.status(404).json({ success: false, error: "Episode not found" });
    }

    const cleanKeyframes = (Array.isArray(keyframes) ? keyframes : [])
      .map((k) => ({
        id: k.id || `kf_${Math.round(Number(k.time) * 1000)}_${Math.random().toString(36).substr(2, 4)}`,
        time: parseFloat(Number(k.time).toFixed(2)),
        cropX: Math.max(5, Math.min(95, Number(k.cropX) || 50)),
        cropPosition: k.cropPosition || (Number(k.cropX) < 35 ? "left" : Number(k.cropX) > 65 ? "right" : "center"),
      }))
      .filter((k) => Number.isFinite(k.time) && k.time >= 0)
      .sort((a, b) => a.time - b.time);

    ep.framingKeyframes = cleanKeyframes;
    if (ep.scriptData) {
      ep.scriptData.framingKeyframes = cleanKeyframes;
    }
    saveSeriesMetadata(seriesData);

    res.json({ success: true, keyframes: cleanKeyframes });
  } catch (err) {
    console.error("[Update Framing Keyframes Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.findSourceEpisodeIndex = findSourceEpisodeIndex;

module.exports = router;

