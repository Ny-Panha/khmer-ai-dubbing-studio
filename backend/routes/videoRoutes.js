const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  uploadsDir,
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
  ensureEpisodeDirectories,
} = require("../services/episodeService");

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
      burnSubtitles = true,
      subtitleColor = "white",
      subtitleSize = "medium",
      subtitleStyle = "banner",
      subtitleOptions = {},
      antiTheft = null,
      logoSettings = null,
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

    const targetAspectRatio = subtitleOptions.aspectRatio || req.body.aspectRatio || "16:9";
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
      textColor: subtitleOptions.textColor || (subtitleColor === "yellow" ? "#FFE600" : "#FFFFFF"),
      outlineColor: subtitleOptions.outlineColor || "#000000",
      subtitleStyle: subtitleOptions.subtitleStyle || req.body?.subtitleStyle || subtitleStyle || "banner",
      aspectRatio: targetAspectRatio,
      marginV: subtitleOptions.marginV || null,
    };

    // Resolve Logo Watermark (Base64 DataURL or Image file path)
    let resolvedLogoPath = null;
    let tempLogoFile = null;
    const rawLogo = logoSettings || req.body?.voiceSettings?.logoSettings || null;
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
        bgVolume: effectiveBgVolume,
        khmerVolume: effectiveKhmerVolume,
        burnSubtitles: Boolean(burnSubtitles),
        subtitleOptions: finalSubOptions,
        aspectRatio: targetAspectRatio,
        videoClips,
        antiTheft: antiTheft || req.body?.voiceSettings?.antiTheft || null,
        logoSettings: resolvedLogoPath ? {
          ...rawLogo,
          logoPath: resolvedLogoPath,
        } : null,
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
    });
  } catch (err) {
    console.error("Render Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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

    const { videoPath, videoId, seriesId, durationMinutes, durationSeconds, episodeCount, replaceEpisodes = true } = req.body;
    const rawVideoRef = videoPath || videoId;
    if (!rawVideoRef) {
      return res.status(400).json({ success: false, error: "videoPath or videoId is required" });
    }

    const inputVideoPath = resolveMediaFile(rawVideoRef);
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return res.status(404).json({ success: false, error: "Source video not found: " + rawVideoRef });
    }

    const meta = await getVideoMetadata(inputVideoPath);
    const totalDuration = meta?.duration || 0;

    let targetDurationSec;
    if (episodeCount && Number(episodeCount) > 1) {
      targetDurationSec = Math.max(10, totalDuration / Number(episodeCount));
    } else if (durationSeconds && Number(durationSeconds) > 0) {
      targetDurationSec = Math.max(10, Number(durationSeconds));
    } else {
      targetDurationSec = Math.max(15, Number(durationMinutes || 1) * 60);
      // Auto-fallback: if video duration is shorter than or equal to target duration, split in half!
      if (totalDuration > 30 && targetDurationSec >= totalDuration) {
        targetDurationSec = Math.max(10, totalDuration / 2);
      }
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

    const currentSeries = getSeriesMetadata(cleanSeries) || { id: cleanSeries, title: "រឿងភាគ", episodes: [] };
    const existing = currentSeries.episodes || [];
    const shouldReplace = replaceEpisodes || existing.length <= 1;

    const builtEpisodes = [];
    const baseIndex = shouldReplace ? 0 : existing.length;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const epNum = baseIndex + i + 1;
      const epId = `ep_${epNum}`;
      const { videoDir } = ensureEpisodeDirectories(cleanSeries, epId);
      const epVideoFilename = `${cleanSeries}_${epId}_source.mp4`;
      const epVideoDestPath = path.join(videoDir, epVideoFilename);

      // Copy chunk to isolated episode video folder
      fs.copyFileSync(chunk.outputPath, epVideoDestPath);
      try { fs.unlinkSync(chunk.outputPath); } catch (_) {}

      const epVideoUrl = `/uploads/projects/${cleanSeries}/episodes/${epId}/video/${epVideoFilename}`;
      const epTitle = `ភាគទី ${epNum} (EP${epNum})`;

      let fileStatSize = 0;
      try { fileStatSize = fs.statSync(epVideoDestPath).size; } catch (_) {}

      const epObj = {
        id: epId,
        episodeNumber: epNum,
        title: epTitle,
        displayTitle: epTitle,
        status: "uploaded",
        videoFile: epVideoUrl,
        sourceVideoPath: epVideoDestPath,
        duration: chunk.duration,
        video: {
          videoId: `projects/${cleanSeries}/episodes/${epId}/video/${epVideoFilename}`,
          fileName: epVideoFilename,
          originalFilename: `${cleanSeries}_EP${epNum}.mp4`,
          displayTitle: epTitle,
          storageFilename: epVideoFilename,
          videoUrl: epVideoUrl,
          videoPath: epVideoDestPath,
          durationSec: chunk.duration,
          sizeMB: parseFloat((fileStatSize / (1024 * 1024)).toFixed(2)),
          size: (fileStatSize / (1024 * 1024)).toFixed(1) + " MB",
        },
        metadata: {
          duration: chunk.duration,
          durationSec: chunk.duration,
          width: 1920,
          height: 1080,
          resolution: "1920x1080",
          hasAudio: true,
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

    currentSeries.episodes = shouldReplace ? builtEpisodes : [...existing, ...builtEpisodes];
    saveSeriesMetadata(currentSeries);

    console.log(`[Split Endpoint] ✅ Successfully split video into ${builtEpisodes.length} episodes for "${cleanSeries}"`);
    res.json({
      success: true,
      message: `បានកាត់បំបែកវីដេអូជា ${builtEpisodes.length} ភាគជោគជ័យ! (${(targetDurationSec / 60).toFixed(0)} នាទី/ភាគ)`,
      episodes: builtEpisodes,
      series: currentSeries,
    });
  } catch (err) {
    console.error("[Split Video Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

