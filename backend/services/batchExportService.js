const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  uploadsDir,
  isSafeUploadPath,
  sanitizeProjectName,
  sanitizeEpisodeId,
  resolveMediaFile,
} = require("../utils/pathUtils");
const {
  getSeriesMetadata,
  saveSeriesMetadata,
  updateSeriesMetadata,
  withSeriesMetadataLock,
  ensureEpisodeDirectories,
} = require("./episodeService");
const {
  renderDubbedVideoWithDucking,
  mergeVideosConcat,
  getVideoMetadata,
  getMediaDuration,
  cancelJobRenderProcess,
} = require("./ffmpegService");

const batchExportJobs = new Map();
const batchJobControllers = new Map();
const latestSeriesJobMap = new Map();

const MAX_RETAINED_JOBS = 40;

function pruneOldJobs() {
  if (batchExportJobs.size <= MAX_RETAINED_JOBS) return;
  const completedJobs = [];
  for (const [id, job] of batchExportJobs.entries()) {
    if (job.status !== "running") {
      completedJobs.push({ id, updatedAt: job.updatedAt || job.createdAt || 0 });
    }
  }
  completedJobs.sort((a, b) => a.updatedAt - b.updatedAt);
  const toRemove = Math.max(0, batchExportJobs.size - MAX_RETAINED_JOBS);
  for (let i = 0; i < toRemove && i < completedJobs.length; i++) {
    batchExportJobs.delete(completedJobs[i].id);
  }
}

function sanitizeExportSegment(text, fallback = "Drama") {
  if (!text || typeof text !== "string") return fallback;
  const cleaned = text
    .replace(/[<>:"/\\|?*\r\n\t]/g, "")
    .replace(/\.+$/g, "")
    .trim();
  return cleaned || fallback;
}

function isGenericOrCorruptedSeriesTitle(title) {
  if (!title || typeof title !== "string") return true;
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (/^រឿងភាគ\s*\(Series\s*\d+\)$/i.test(trimmed)) return true;
  if (/^Series\s*\d+$/i.test(trimmed)) return true;
  if (/^series_\d+/i.test(trimmed)) return true;
  if (/^(drama_project|drama_recap)$/i.test(trimmed)) return true;
  if (trimmed.includes("\uFFFD")) return true;
  return false;
}

function resolveDownloadsDirectory(customDir = null) {
  if (customDir && typeof customDir === "string") {
    return fs.existsSync(customDir) ? customDir : null;
  }
  const envDownloadsDir = process.env.DRAGONDUB_DOWNLOADS_DIR;
  if (envDownloadsDir && typeof envDownloadsDir === "string") {
    return fs.existsSync(envDownloadsDir) ? envDownloadsDir : null;
  }
  const userDownloadsDir = path.join(os.homedir(), "Downloads");
  return fs.existsSync(userDownloadsDir) ? userDownloadsDir : null;
}

function resolveLogoInputForBatch(logoSettings, workDir) {
  if (!logoSettings || !(logoSettings.enabled || logoSettings.enableLogo)) {
    return { logoPath: null, tempLogoFile: null };
  }
  const imgVal = logoSettings.image || logoSettings.logoImage;
  if (!imgVal || typeof imgVal !== "string") {
    return { logoPath: null, tempLogoFile: null };
  }

  if (imgVal.startsWith("data:image")) {
    const matches = imgVal.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (matches) {
      const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
      if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
      const tempLogoFile = path.join(
        workDir,
        `.tmp_batch_logo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`
      );
      fs.writeFileSync(tempLogoFile, Buffer.from(matches[2], "base64"));
      return { logoPath: tempLogoFile, tempLogoFile };
    }
    return { logoPath: null, tempLogoFile: null };
  }

  const candidate1 = path.join(__dirname, "../../frontend/public", imgVal.replace(/^\//, ""));
  const candidate2 = path.join(uploadsDir, path.basename(imgVal));
  const candidate3 = resolveMediaFile(imgVal);
  if (fs.existsSync(candidate1)) return { logoPath: candidate1, tempLogoFile: null };
  if (fs.existsSync(candidate2) && isSafeUploadPath(candidate2, uploadsDir)) {
    return { logoPath: candidate2, tempLogoFile: null };
  }
  if (candidate3 && fs.existsSync(candidate3) && isSafeUploadPath(candidate3, uploadsDir)) {
    return { logoPath: candidate3, tempLogoFile: null };
  }
  return { logoPath: null, tempLogoFile: null };
}

function resolveSponsorInputForBatch(sponsorSettings) {
  if (!sponsorSettings || !(sponsorSettings.enabled || sponsorSettings.enableSponsor)) {
    return null;
  }
  const vidVal =
    sponsorSettings.sponsorVideoPath ||
    sponsorSettings.videoPath ||
    sponsorSettings.sponsorVideoUrl ||
    sponsorSettings.videoUrl;
  if (!vidVal || typeof vidVal !== "string") {
    return null;
  }
  const candidate1 = path.join(__dirname, "../../frontend/public", vidVal.replace(/^\//, ""));
  const candidate2 = path.join(uploadsDir, path.basename(vidVal));
  const candidate3 = path.join(uploadsDir, "sponsor", path.basename(vidVal));
  const candidate4 = resolveMediaFile(vidVal);
  if (fs.existsSync(candidate1)) return candidate1;
  if (fs.existsSync(candidate2) && isSafeUploadPath(candidate2, uploadsDir)) return candidate2;
  if (fs.existsSync(candidate3) && isSafeUploadPath(candidate3, uploadsDir)) return candidate3;
  if (candidate4 && fs.existsSync(candidate4) && isSafeUploadPath(candidate4, uploadsDir)) return candidate4;
  if (fs.existsSync(vidVal) && isSafeUploadPath(vidVal, uploadsDir)) return vidVal;
  return null;
}

function isWithinDirectory(candidatePath, dirPath) {
  try {
    const canonCandidate = path.resolve(candidatePath);
    const canonDir = path.resolve(dirPath);
    const normCand = process.platform === "win32" ? canonCandidate.toLowerCase() : canonCandidate;
    const normDir = process.platform === "win32" ? canonDir.toLowerCase() : canonDir;
    const rel = path.relative(normDir, normCand);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch (_) {
    return false;
  }
}

/**
 * Inspect an episode's video + Khmer audio readiness with strict episode isolation.
 */
function inspectEpisodeExportReadiness(cleanSeries, ep, indexFallback = 0, override = null) {
  const cleanEpisode = sanitizeEpisodeId(ep.id || `ep_${ep.episodeNumber || indexFallback + 1}`);
  const episodeNumber = Number(ep.episodeNumber) || indexFallback + 1;
  const epTitle = ep.displayTitle || ep.title || `ភាគទី ${episodeNumber} (EP${episodeNumber})`;
  const { videoDir, audioDir } = ensureEpisodeDirectories(cleanSeries, cleanEpisode);

  // 1. Resolve source video cleanly inside uploadsDir
  const rawVideoRef =
    ep.sourceVideoPath ||
    ep.video?.videoPath ||
    ep.video?.videoId ||
    ep.videoFile ||
    ep.video?.videoUrl;

  const resolvedVideoPath = rawVideoRef ? resolveMediaFile(rawVideoRef) : null;
  const hasVideo = Boolean(
    resolvedVideoPath &&
      fs.existsSync(resolvedVideoPath) &&
      isSafeUploadPath(resolvedVideoPath, uploadsDir)
  );

  if (!hasVideo) {
    return {
      episodeId: ep.id,
      cleanEpisode,
      episodeNumber,
      title: epTitle,
      hasVideo: false,
      hasVoice: false,
      skipReason: "មិនទាន់មានវីដេអូដើម (No Video)",
    };
  }

  // 2. Resolve master Khmer narration audio with strict episode audio folder isolation
  const rawMasterCandidate =
    override?.fullAudioPath ||
    ep.fullAudioPath ||
    ep.fullAudioUrl ||
    null;

  let resolvedMasterAudio = rawMasterCandidate ? resolveMediaFile(rawMasterCandidate) : null;
  if (resolvedMasterAudio) {
    const resolvedMasterDir = path.dirname(path.resolve(resolvedMasterAudio));
    const resolvedEpAudioDir = path.resolve(audioDir);
    const sameDir =
      process.platform === "win32"
        ? resolvedMasterDir.toLowerCase() === resolvedEpAudioDir.toLowerCase()
        : resolvedMasterDir === resolvedEpAudioDir;
    if (!sameDir || !isSafeUploadPath(resolvedMasterAudio, uploadsDir) || !fs.existsSync(resolvedMasterAudio)) {
      resolvedMasterAudio = null;
    }
  }

  if (!resolvedMasterAudio) {
    const defaultNarration = path.join(audioDir, `${cleanEpisode}_narration_khmer.mp3`);
    if (fs.existsSync(defaultNarration) && isSafeUploadPath(defaultNarration, uploadsDir)) {
      resolvedMasterAudio = defaultNarration;
    }
  }

  if (resolvedMasterAudio && fs.existsSync(resolvedMasterAudio)) {
    const metaPath = `${resolvedMasterAudio}.meta.json`;
    if (fs.existsSync(metaPath)) {
      try {
        const sidecar = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (
          (sidecar.episodeId && sanitizeEpisodeId(sidecar.episodeId) !== cleanEpisode) ||
          (sidecar.seriesId && sanitizeProjectName(sidecar.seriesId) !== cleanSeries)
        ) {
          resolvedMasterAudio = null;
        }
      } catch (_) {}
    }
  }

  // 3. Prepare segments & verify segment audio files belong strictly to this episode's audioDir
  const rawSegments = Array.isArray(override?.segments)
    ? override.segments
    : (Array.isArray(ep.scriptData?.segments) ? ep.scriptData.segments : []);

  const preparedSegments = rawSegments.map((seg) => {
    const audioCandidate =
      seg.audioPath ||
      seg.audioFile ||
      (seg.audioUrl ? path.basename(String(seg.audioUrl)) : null);
    let resolvedSegAudio = null;
    if (audioCandidate) {
      // Prioritize episode's own audioDir before global search to prevent cross-episode collision
      const baseCandidate = path.join(audioDir, path.basename(String(audioCandidate).split("?")[0]));
      if (fs.existsSync(baseCandidate) && isWithinDirectory(baseCandidate, audioDir)) {
        resolvedSegAudio = baseCandidate;
      } else {
        const globalResolved = resolveMediaFile(audioCandidate);
        if (
          globalResolved &&
          fs.existsSync(globalResolved) &&
          isWithinDirectory(globalResolved, audioDir) &&
          isSafeUploadPath(globalResolved, uploadsDir)
        ) {
          resolvedSegAudio = globalResolved;
        }
      }
    }
    return {
      ...seg,
      audioPath: resolvedSegAudio,
    };
  });

  const hasValidMasterAudio = Boolean(resolvedMasterAudio && fs.existsSync(resolvedMasterAudio));
  const validVoiceSegmentsCount = preparedSegments.filter(
    (s) => !s.muted && !s.isMuted && s.audioPath && fs.existsSync(s.audioPath)
  ).length;
  const hasVoice = hasValidMasterAudio || validVoiceSegmentsCount > 0;

  // 4. Check Demucs clean BGM availability inside uploadsDir
  const rawBgmRef = override?.cleanBgmPath || ep.cleanBgmPath || ep.bgmAudioUrl || null;
  let resolvedBgmPath = rawBgmRef ? resolveMediaFile(rawBgmRef) : null;
  if (resolvedBgmPath && (!fs.existsSync(resolvedBgmPath) || !isSafeUploadPath(resolvedBgmPath, uploadsDir))) {
    resolvedBgmPath = null;
  }

  return {
    episodeId: ep.id,
    cleanEpisode,
    episodeNumber,
    title: epTitle,
    videoDir,
    audioDir,
    inputVideoPath: resolvedVideoPath,
    masterAudioPath: resolvedMasterAudio,
    preparedSegments,
    videoClips: Array.isArray(override?.videoClips) ? override.videoClips : (ep.videoClips || []),
    separatedBgAudioPath: resolvedBgmPath,
    videoMetaWidth: Number(ep.metadata?.width || ep.video?.width) || 0,
    videoMetaHeight: Number(ep.metadata?.height || ep.video?.height) || 0,
    durationSec: Number(ep.duration || ep.metadata?.durationSec || ep.video?.durationSec) || 0,
    hasVideo: true,
    hasVoice,
    skipReason: hasVoice ? null : "មិនទាន់មានសំឡេងខ្មែរ (No Voice)",
    rawEpisode: ep,
  };
}

/**
 * Analyze selected episodes for eligibility & skipped warnings before launching a batch job.
 */
function analyzeBatchExportPlan({
  series,
  episodeIds = null,
  allowOriginalAudio = false,
  episodeOverrides = {},
}) {
  const cleanSeries = sanitizeProjectName(series.id);
  const allEpisodes = Array.isArray(series.episodes) ? [...series.episodes] : [];

  // Preserve sequential episode order regardless of checkbox click order
  allEpisodes.sort((a, b) => (Number(a.episodeNumber) || 0) - (Number(b.episodeNumber) || 0));

  const selectedIdSet =
    Array.isArray(episodeIds) && episodeIds.length > 0
      ? new Set(episodeIds.map((id) => String(id)))
      : null;

  const targetEpisodes = selectedIdSet
    ? allEpisodes.filter((ep) => ep && selectedIdSet.has(String(ep.id)))
    : allEpisodes;

  const eligible = [];
  const skipped = [];

  targetEpisodes.forEach((ep, idx) => {
    const override = episodeOverrides && ep.id ? episodeOverrides[ep.id] : null;
    const plan = inspectEpisodeExportReadiness(cleanSeries, ep, idx, override);
    if (!plan.hasVideo) {
      skipped.push({
        episodeId: plan.episodeId,
        episodeNumber: plan.episodeNumber,
        title: plan.title,
        reason: plan.skipReason,
        code: "NO_VIDEO",
      });
      return;
    }

    if (!plan.hasVoice && !allowOriginalAudio) {
      skipped.push({
        episodeId: plan.episodeId,
        episodeNumber: plan.episodeNumber,
        title: plan.title,
        reason: plan.skipReason,
        code: "NO_VOICE",
      });
      return;
    }

    eligible.push({
      ...plan,
      useOriginalAudio: !plan.hasVoice && Boolean(allowOriginalAudio),
    });
  });

  return {
    cleanSeries,
    selectedCount: targetEpisodes.length,
    eligible,
    skipped,
  };
}

function buildEpRangeTag(episodeNumbers = []) {
  if (!Array.isArray(episodeNumbers) || episodeNumbers.length === 0) return "All";
  const sorted = [...new Set(episodeNumbers.map((n) => Number(n)).filter((n) => n > 0))].sort((a, b) => a - b);
  if (sorted.length === 1) return `EP${sorted[0]}`;
  let isContiguous = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      isContiguous = false;
      break;
    }
  }
  if (isContiguous) return `EP${sorted[0]}-EP${sorted[sorted.length - 1]}`;
  if (sorted.length <= 5) return sorted.map((n) => `EP${n}`).join("_");
  return `EP${sorted[0]}-${sorted[sorted.length - 1]}_${sorted.length}eps`;
}

function formatPublicJobSnapshot(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    seriesId: job.seriesId,
    seriesTitle: job.seriesTitle,
    mode: job.mode,
    allowOriginalAudio: job.allowOriginalAudio,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    currentIndex: job.currentIndex,
    totalCount: job.totalCount,
    currentEpisodeId: job.currentEpisodeId,
    currentEpisodeNumber: job.currentEpisodeNumber,
    currentEpisodeTitle: job.currentEpisodeTitle,
    currentEpisodePercent: typeof job.currentEpisodePercent === "number" ? job.currentEpisodePercent : 0,
    skippedEpisodes: job.skippedEpisodes,
    outputs: job.outputs,
    mergedResult: job.mergedResult,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    elapsedSeconds: job.completedAt
      ? Number(((job.completedAt - job.createdAt) / 1000).toFixed(1))
      : Number(((Date.now() - job.createdAt) / 1000).toFixed(1)),
  };
}

/**
 * Start a background Batch Export / Full Video Merge job.
 */
async function startBatchExportJob({
  seriesId,
  episodeIds = [],
  mode = "merge",
  allowOriginalAudio = false,
  exportSettings = {},
  episodeOverrides = {},
  downloadsDir = null,
}) {
  if (!seriesId) {
    const err = new Error("seriesId ត្រូវបានទាមទារ");
    err.statusCode = 400;
    throw err;
  }

  const normalizedMode = mode === "separate" ? "separate" : "merge";
  const cleanSeries = sanitizeProjectName(seriesId);

  // Prevent concurrent conflicting batch export jobs for the same series
  const prevJobId = latestSeriesJobMap.get(cleanSeries);
  if (prevJobId) {
    const prevJob = batchExportJobs.get(prevJobId);
    if (prevJob && prevJob.status === "running") {
      const err = new Error("កំពុងដំណើរការ Batch Export / Merge សម្រាប់រឿងនេះរួចហើយ! សូមរង់ចាំ ឬចុច Stop ជាមុនសិន។");
      err.statusCode = 409;
      err.jobId = prevJobId;
      throw err;
    }
  }

  const series = getSeriesMetadata(cleanSeries, { forceDisk: true });
  if (!series || !Array.isArray(series.episodes) || series.episodes.length === 0) {
    const err = new Error(`រកមិនឃើញរឿងភាគ (${cleanSeries}) ឬមិនទាន់មានភាគណាមួយទេ`);
    err.statusCode = 404;
    throw err;
  }

  const plan = analyzeBatchExportPlan({
    series,
    episodeIds,
    allowOriginalAudio: Boolean(allowOriginalAudio),
    episodeOverrides,
  });

  if (plan.selectedCount === 0) {
    const err = new Error("សូមជ្រើសរើសយ៉ាងតិច ១ ភាគសម្រាប់ Export!");
    err.statusCode = 400;
    throw err;
  }

  if (plan.eligible.length === 0) {
    const noVoiceCount = plan.skipped.filter((s) => s.code === "NO_VOICE").length;
    const msg = noVoiceCount > 0
      ? `មិនអាច Export បានទេ! ភាគដែលបានជ្រើសរើស (${plan.skipped.length} ភាគ) មិនទាន់មានសំឡេងខ្មែរទេ។ សូមបង្កើតសំឡេង TTS ជាមុន ឬធីក "Allow Original Audio"`
      : `មិនអាច Export បានទេ! ភាគដែលបានជ្រើសរើសមិនទាន់មានវីដេអូដើមទេ។`;
    const err = new Error(msg);
    err.statusCode = 400;
    err.skippedEpisodes = plan.skipped;
    throw err;
  }

  pruneOldJobs();

  const jobId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const controller = new AbortController();
  batchJobControllers.set(jobId, controller);

  const seriesDisplayTitle = !isGenericOrCorruptedSeriesTitle(series.title)
    ? sanitizeExportSegment(series.title, cleanSeries).slice(0, 60)
    : cleanSeries;

  const job = {
    jobId,
    seriesId: cleanSeries,
    seriesTitle: seriesDisplayTitle,
    mode: normalizedMode,
    allowOriginalAudio: Boolean(allowOriginalAudio),
    status: "running",
    progress: 1,
    stage: `ចាប់ផ្ដើម ${normalizedMode === "merge" ? "Export & Merge ១ វីដេអូពេញ" : "Batch Export ដាច់ដោយឡែក"} (${plan.eligible.length} ភាគ)...`,
    currentIndex: 0,
    totalCount: plan.eligible.length,
    currentEpisodeId: plan.eligible[0]?.episodeId || null,
    currentEpisodeNumber: plan.eligible[0]?.episodeNumber || null,
    currentEpisodeTitle: plan.eligible[0]?.title || "",
    currentEpisodePercent: 0,
    skippedEpisodes: plan.skipped,
    outputs: [],
    mergedResult: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
  };

  batchExportJobs.set(jobId, job);
  latestSeriesJobMap.set(cleanSeries, jobId);

  // Fire-and-forget async execution so HTTP returns immediately without proxy timeouts
  runBatchExportWorker({
    job,
    plan,
    seriesTitle: seriesDisplayTitle,
    exportSettings,
    controller,
    downloadsDir,
  }).catch((unexpectedErr) => {
    console.error(`[BatchExport] Unhandled worker error for ${jobId}:`, unexpectedErr);
    if (job.status === "running") {
      job.status = "failed";
      job.error = unexpectedErr.message;
      job.stage = `❌ បរាជ័យ៖ ${unexpectedErr.message}`;
      job.updatedAt = Date.now();
    }
  });

  return formatPublicJobSnapshot(job);
}

async function runBatchExportWorker({
  job,
  plan,
  seriesTitle,
  exportSettings = {},
  controller,
  downloadsDir = null,
}) {
  const signal = controller.signal;
  const cleanSeries = job.seriesId;
  const seriesDir = path.join(uploadsDir, "projects", cleanSeries);
  const exportsDir = path.join(seriesDir, "exports");
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const targetDownloadsDir = resolveDownloadsDirectory(downloadsDir);

  const rawLogo = exportSettings.logoSettings || null;
  const { logoPath: resolvedLogoPath, tempLogoFile } = resolveLogoInputForBatch(rawLogo, exportsDir);
  const rawSponsor = exportSettings.sponsorSettings || null;
  const resolvedSponsorPath = resolveSponsorInputForBatch(rawSponsor);

  const totalCount = plan.eligible.length;
  const isMergeMode = job.mode === "merge";
  const renderWeight = isMergeMode ? 80 : 100;

  // Determine uniform aspectRatio if user explicitly selected one, or probe EP1 when merging so all episodes align cleanly
  let batchForcedAspectRatio = exportSettings.aspectRatio || null;
  let mergeTargetDimensions = null;
  if (isMergeMode && !batchForcedAspectRatio && plan.eligible[0]) {
    const firstEp = plan.eligible[0];
    let w = firstEp.videoMetaWidth;
    let h = firstEp.videoMetaHeight;
    if (!w || !h) {
      try {
        const meta = await getVideoMetadata(firstEp.inputVideoPath);
        w = meta?.width || 0;
        h = meta?.height || 0;
      } catch (_) {}
    }
    if (w && h) {
      batchForcedAspectRatio = h > w ? "9:16" : (w > h ? "16:9" : "1:1");
    } else {
      batchForcedAspectRatio = "16:9";
    }
  }
  if (isMergeMode) {
    if (batchForcedAspectRatio === "9:16") mergeTargetDimensions = { width: 1080, height: 1920 };
    else if (batchForcedAspectRatio === "1:1") mergeTargetDimensions = { width: 1080, height: 1080 };
    else if (batchForcedAspectRatio === "16:9") mergeTargetDimensions = { width: 1920, height: 1080 };
  }

  const verticalStyle = exportSettings.verticalStyle || "pad";
  const effectiveBgVolume =
    exportSettings.bgVolume !== undefined && exportSettings.bgVolume !== null
      ? Number(exportSettings.bgVolume)
      : (exportSettings.duckingVolume !== undefined ? Number(exportSettings.duckingVolume) : 0.15);
  const effectiveKhmerVolume = Number(exportSettings.khmerVolume) || 1.3;
  const soundMode = exportSettings.soundMode || "ducking";
  const burnSubtitles = exportSettings.burnSubtitles !== false;
  const subtitleColor = exportSettings.subtitleColor || "white";
  const subtitleSize = exportSettings.subtitleSize || "medium";
  const subtitleStyle = exportSettings.subtitleStyle || "banner";
  const enableDemucs = Boolean(exportSettings.enableDemucs);
  const antiTheft = exportSettings.antiTheft || null;

  const renderedFilePaths = [];
  let mergedTempOrTargetPath = null;

  try {
    for (let i = 0; i < totalCount; i++) {
      if (signal.aborted) {
        const abortErr = new Error("Batch export cancelled by user");
        abortErr.name = "AbortError";
        throw abortErr;
      }

      const epPlan = plan.eligible[i];
      job.currentIndex = i + 1;
      job.currentEpisodeId = epPlan.episodeId;
      job.currentEpisodeNumber = epPlan.episodeNumber;
      job.currentEpisodeTitle = epPlan.title;
      job.currentEpisodePercent = 0;

      let epAspectRatio = batchForcedAspectRatio;
      if (!epAspectRatio) {
        let w = epPlan.videoMetaWidth;
        let h = epPlan.videoMetaHeight;
        if (!w || !h) {
          try {
            const meta = await getVideoMetadata(epPlan.inputVideoPath);
            w = meta?.width || 0;
            h = meta?.height || 0;
          } catch (_) {}
        }
        epAspectRatio = w && h ? (h > w ? "9:16" : (w > h ? "16:9" : "1:1")) : "16:9";
      }

      const ratioSuffix =
        epAspectRatio === "9:16"
          ? " [9-16 TikTok Reels]"
          : epAspectRatio === "1:1"
          ? " [1-1 Square]"
          : "";

      const audioTag = epPlan.useOriginalAudio ? "_OriginalAudio" : "_Khmer_Dubbed";
      const epOutputFilename = `${seriesTitle}_EP${epPlan.episodeNumber}${audioTag}${ratioSuffix}.mp4`;
      const epOutputPath = path.join(epPlan.videoDir, epOutputFilename);

      const epStartPct = Math.round((i / totalCount) * renderWeight);
      const epEndPct = Math.round(((i + 1) / totalCount) * renderWeight);

      // Check if episode video is already fully rendered on disk
      let alreadyRenderedOnDisk = false;
      if (fs.existsSync(epOutputPath) && !exportSettings.forceReRender) {
        try {
          const stat = fs.statSync(epOutputPath);
          if (stat.size > 2 * 1024 * 1024) {
            alreadyRenderedOnDisk = true;
          }
        } catch (_) {}
      }

      let renderRes = null;
      if (alreadyRenderedOnDisk) {
        console.log(`[BatchExport] ⚡ Episode EP${epPlan.episodeNumber} is already rendered (${epOutputFilename}). Reusing existing file.`);
        renderRes = { outputVideoPath: epOutputPath, renderTimeSeconds: 0 };
        job.currentEpisodePercent = 100;
        job.stage = `ភាគ ${i + 1}/${totalCount} (EP${epPlan.episodeNumber}): ប្រើប្រាស់វីដេអូដែល Render រួចស្រាប់ (Skip)...`;
        job.updatedAt = Date.now();
      } else {
        if (fs.existsSync(epOutputPath)) {
          try { fs.unlinkSync(epOutputPath); } catch (_) {}
        }

        job.progress = Math.max(job.progress, epStartPct);
        job.stage = `ភាគ ${i + 1}/${totalCount} (EP${epPlan.episodeNumber}): កំពុង Render 0%${epPlan.useOriginalAudio ? " (សំឡេងដើម)" : " សំឡេងខ្មែរ & Subtitles"}...`;
        job.updatedAt = Date.now();

        let expectedDur = epPlan.durationSec || 0;
        if (!expectedDur) {
          try {
            expectedDur = await getMediaDuration(epPlan.inputVideoPath);
          } catch (_) {}
        }

        const subtitleOptions = {
          ...(exportSettings.subtitleOptions || {}),
          fontName: exportSettings.subtitleOptions?.fontName || "Khmer OS Battambang",
          fontSize: exportSettings.subtitleOptions?.fontSize || null,
          subtitleSize: exportSettings.subtitleOptions?.subtitleSize || exportSettings.subtitleSize || null,
          textColor:
            exportSettings.subtitleOptions?.textColor ||
            (subtitleColor === "yellow" ? "#FFE600" : "#FFFFFF"),
          outlineColor: exportSettings.subtitleOptions?.outlineColor || "#000000",
          subtitleStyle: exportSettings.subtitleOptions?.subtitleStyle || subtitleStyle,
          aspectRatio: epAspectRatio,
          verticalStyle,
          marginV: exportSettings.subtitleOptions?.marginV || null,
        };

        renderRes = await renderDubbedVideoWithDucking({
          jobId: job.jobId,
          signal,
          inputVideoPath: epPlan.inputVideoPath,
          masterAudioPath: epPlan.hasVoice ? epPlan.masterAudioPath : null,
          fullAudioPath: epPlan.hasVoice ? epPlan.masterAudioPath : null,
          segments: epPlan.hasVoice ? epPlan.preparedSegments : [],
          outputVideoPath: epOutputPath,
          soundMode,
          enableDemucs: epPlan.hasVoice ? enableDemucs : false,
          separatedBgAudioPath: epPlan.hasVoice && enableDemucs ? epPlan.separatedBgAudioPath : null,
          bgVolume: effectiveBgVolume,
          khmerVolume: effectiveKhmerVolume,
          burnSubtitles: epPlan.hasVoice ? burnSubtitles : false,
          subtitleOptions,
          aspectRatio: epAspectRatio,
          verticalStyle,
          videoClips: epPlan.videoClips,
          antiTheft,
          logoSettings: resolvedLogoPath ? { ...rawLogo, logoPath: resolvedLogoPath } : null,
          sponsorSettings: resolvedSponsorPath ? { ...rawSponsor, sponsorPath: resolvedSponsorPath } : null,
          allowOriginalAudio: epPlan.useOriginalAudio,
          expectedDurationSec: expectedDur,
          onProgress: ({ percent }) => {
            const epPct = Math.max(1, Math.min(99, Number(percent) || 0));
            job.currentEpisodePercent = epPct;
            const scaled = epStartPct + Math.round((epPct / 100) * Math.max(1, epEndPct - epStartPct));
            job.progress = Math.max(job.progress, Math.min(renderWeight, scaled));
            job.stage = `ភាគ ${i + 1}/${totalCount} (EP${epPlan.episodeNumber}): កំពុង Encode FFmpeg ${epPct}% (សរុប ${job.progress}%)...`;
            job.updatedAt = Date.now();
          },
        });
      }

      job.currentEpisodePercent = 100;

      const relVideoPath = `projects/${cleanSeries}/episodes/${epPlan.cleanEpisode}/video/${epOutputFilename}`;
      const videoUrl = `/uploads/${relVideoPath}`;
      const downloadUrl = `/api/download-export?file=${encodeURIComponent(relVideoPath)}&name=${encodeURIComponent(epOutputFilename)}`;

      // Update episode metadata in series.json atomically under per-series mutex
      try {
        await withSeriesMetadataLock(cleanSeries, () =>
          updateSeriesMetadata(cleanSeries, (latestSeries) => {
            if (!latestSeries || !Array.isArray(latestSeries.episodes)) return false;
            const targetEp = latestSeries.episodes.find((e) => String(e.id) === String(epPlan.episodeId));
            if (!targetEp) return false;
            targetEp.renderedVideo = {
              success: true,
              videoUrl,
              outputVideoUrl: videoUrl,
              outputFilename: epOutputFilename,
              downloadUrl,
              renderedAt: Date.now(),
              usedOriginalAudio: epPlan.useOriginalAudio,
              aspectRatio: epAspectRatio,
              verticalStyle,
            };
            if (epPlan.hasVoice) {
              targetEp.status = "completed";
            }
            targetEp.lastModified = Date.now();
            return true;
          })
        );
      } catch (metaErr) {
        console.warn(`[BatchExport] Warning saving episode metadata for ${epPlan.episodeId}:`, metaErr.message);
      }

      renderedFilePaths.push(epOutputPath);

      let epDownloadsPath = null;
      if (!isMergeMode && targetDownloadsDir && fs.existsSync(epOutputPath)) {
        try {
          epDownloadsPath = path.join(targetDownloadsDir, epOutputFilename);
          fs.copyFileSync(epOutputPath, epDownloadsPath);
        } catch (cpErr) {
          console.warn(`[BatchExport] Could not copy ${epOutputFilename} to Downloads:`, cpErr.message);
          epDownloadsPath = null;
        }
      }

      job.outputs.push({
        episodeId: epPlan.episodeId,
        episodeNumber: epPlan.episodeNumber,
        title: epPlan.title,
        outputFilename: epOutputFilename,
        videoUrl,
        outputVideoUrl: videoUrl,
        downloadUrl,
        savedToDownloads: Boolean(epDownloadsPath),
        downloadsPath: epDownloadsPath,
        usedOriginalAudio: epPlan.useOriginalAudio,
        renderTimeSeconds: renderRes?.renderTimeSeconds || 0,
        aspectRatio: epAspectRatio,
        verticalStyle,
      });

      job.progress = Math.max(job.progress, epEndPct);
      job.updatedAt = Date.now();
    }

    // Mode B: Concatenate all rendered episodes into 1 Full Video
    if (isMergeMode) {
      if (signal.aborted) {
        const abortErr = new Error("Merge cancelled by user");
        abortErr.name = "AbortError";
        throw abortErr;
      }

      const rangeTag = buildEpRangeTag(plan.eligible.map((e) => e.episodeNumber));
      const mergeRatioSuffix =
        batchForcedAspectRatio === "9:16"
          ? " [9-16 TikTok Reels]"
          : batchForcedAspectRatio === "1:1"
          ? " [1-1 Square]"
          : "";
      const mergedFilename = `${seriesTitle}_Full_${rangeTag}_Khmer_Dubbed${mergeRatioSuffix}.mp4`;
      const mergedOutputPath = path.join(exportsDir, mergedFilename);
      mergedTempOrTargetPath = mergedOutputPath;

      if (fs.existsSync(mergedOutputPath)) {
        try { fs.unlinkSync(mergedOutputPath); } catch (_) {}
      }

      job.currentEpisodeId = null;
      job.currentEpisodeNumber = null;
      job.currentEpisodeTitle = `ផ្គុំ ${renderedFilePaths.length} ភាគ ចូលគ្នាជា ១ វីដេអូពេញ...`;
      job.currentEpisodePercent = 0;
      job.progress = Math.max(job.progress, 81);
      job.stage = `🎞️ កំពុងផ្គុំ (Merge) ${renderedFilePaths.length} ភាគ បញ្ចូលគ្នាជា ១ វីដេអូពេញ (0%)...`;
      job.updatedAt = Date.now();

      const mergeRes = await mergeVideosConcat({
        inputVideoPaths: renderedFilePaths,
        outputVideoPath: mergedOutputPath,
        targetResolution: mergeTargetDimensions,
        jobId: job.jobId,
        signal,
        onProgress: ({ percent }) => {
          const mergePct = Math.max(1, Math.min(99, Number(percent) || 0));
          job.currentEpisodePercent = mergePct;
          const scaled = 80 + Math.round((mergePct / 100) * 18);
          job.progress = Math.max(job.progress, Math.min(98, scaled));
          job.stage = `🎞️ កំពុងផ្គុំ (Merge) ${renderedFilePaths.length} ភាគ (${mergePct}% | សរុប ${job.progress}%)...`;
          job.updatedAt = Date.now();
        },
      });

      job.currentEpisodePercent = 100;

      let mergedDownloadsPath = null;
      if (targetDownloadsDir && fs.existsSync(mergedOutputPath)) {
        try {
          mergedDownloadsPath = path.join(targetDownloadsDir, mergedFilename);
          fs.copyFileSync(mergedOutputPath, mergedDownloadsPath);
          console.log(`[BatchExport] ✅ Full Merged Video saved to Downloads: ${mergedDownloadsPath}`);
        } catch (dlErr) {
          console.warn("[BatchExport] Could not copy merged video to Downloads:", dlErr.message);
          mergedDownloadsPath = null;
        }
      }

      const relMergedPath = `projects/${cleanSeries}/exports/${mergedFilename}`;
      const mergedVideoUrl = `/uploads/${relMergedPath}`;
      const mergedDownloadUrl = `/api/download-export?file=${encodeURIComponent(relMergedPath)}&name=${encodeURIComponent(mergedFilename)}`;

      job.mergedResult = {
        success: true,
        outputFilename: mergedFilename,
        videoUrl: mergedVideoUrl,
        outputVideoUrl: mergedVideoUrl,
        downloadUrl: mergedDownloadUrl,
        mergedCount: mergeRes?.mergedCount || renderedFilePaths.length,
        fastCopy: Boolean(mergeRes?.fastCopy),
        renderTimeSeconds: mergeRes?.renderTimeSeconds || 0,
        savedToDownloads: Boolean(mergedDownloadsPath),
        downloadsPath: mergedDownloadsPath,
        aspectRatio: batchForcedAspectRatio || "16:9",
        verticalStyle,
      };
    }

    job.status = "completed";
    job.progress = 100;
    job.completedAt = Date.now();
    job.updatedAt = job.completedAt;
    const skippedSuffix =
      job.skippedEpisodes.length > 0
        ? ` (រំលង ${job.skippedEpisodes.length} ភាគអត់ Voice)`
        : "";
    job.stage = isMergeMode
      ? `🎉 Export & Merge ១ វីដេអូពេញ (${renderedFilePaths.length} ភាគ) ជោគជ័យ 100%!${skippedSuffix}`
      : `🎉 Batch Export ${renderedFilePaths.length} ភាគដាច់ដោយឡែក ជោគជ័យ 100%!${skippedSuffix}`;

    return job;
  } catch (err) {
    if (err?.name === "AbortError" || signal.aborted) {
      job.status = "cancelled";
      job.stage = "🛑 បានបញ្ឈប់ការ Export (Cancelled)";
      job.error = null;
      if (mergedTempOrTargetPath && fs.existsSync(mergedTempOrTargetPath)) {
        try { fs.unlinkSync(mergedTempOrTargetPath); } catch (_) {}
      }
    } else {
      job.status = "failed";
      job.error = err?.message || "Batch export failed";
      job.stage = `❌ បរាជ័យ៖ ${job.error}`;
    }
    job.completedAt = Date.now();
    job.updatedAt = job.completedAt;
    return job;
  } finally {
    batchJobControllers.delete(job.jobId);
    if (tempLogoFile && fs.existsSync(tempLogoFile)) {
      try { fs.unlinkSync(tempLogoFile); } catch (_) {}
    }
  }
}

function getBatchExportJob(jobId) {
  if (!jobId) return null;
  const job = batchExportJobs.get(jobId);
  return formatPublicJobSnapshot(job);
}

function getLatestBatchExportJob(seriesId) {
  if (!seriesId) return null;
  const cleanSeries = sanitizeProjectName(seriesId);
  const jobId = latestSeriesJobMap.get(cleanSeries);
  if (!jobId) return null;
  return formatPublicJobSnapshot(batchExportJobs.get(jobId));
}

function cancelBatchExportJob(jobId, seriesId = null) {
  let targetId = jobId;
  if (!targetId && seriesId) {
    targetId = latestSeriesJobMap.get(sanitizeProjectName(seriesId));
  }
  if (!targetId) return { success: false, message: "No active batch export job specified" };

  const job = batchExportJobs.get(targetId);
  const controller = batchJobControllers.get(targetId);
  if (controller) {
    try { controller.abort(); } catch (_) {}
  }
  cancelJobRenderProcess(targetId);

  if (job && job.status === "running") {
    job.status = "cancelled";
    job.stage = "🛑 បានបញ្ឈប់ការ Export (Cancelled)";
    job.completedAt = Date.now();
    job.updatedAt = job.completedAt;
  }

  return {
    success: true,
    job: formatPublicJobSnapshot(job),
  };
}

module.exports = {
  inspectEpisodeExportReadiness,
  analyzeBatchExportPlan,
  startBatchExportJob,
  getBatchExportJob,
  getLatestBatchExportJob,
  cancelBatchExportJob,
};
