const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");
const audioSeparationService = require("./audioSeparationService");
const {
  isAdClip,
  resolveAdMediaPath,
  applyPlacementAdToTimeline,
  buildStoryAndAdAssemblyPlan,
} = require("./ffmpeg/ffmpegVideoAdsHelper");
const {
  FFMPEG_PATH,
  FFPROBE_PATH,
  attachAbortKill,
  checkQsvSupport,
  getSafeCliPath,
  getVideoDimensionsFast,
  getMediaDuration,
  getVideoMetadata,
  getMediaInfo,
  extractFramesAtTimestamps,
  extractFramesStreaming,
  extractSubtitleDifferenceGrid,
  detectSubtitleChangePoints,
  splitVideoIntoEpisodes,
  getOrCreateVideoThumbnails,
} = require("./ffmpeg/ffmpegProbeAndFrames");
const {
  parseTimeToSec,
  toSrtTime,
  buildAtempoFilter,
  detectSpeechBounds,
  trimTtsSilence,
  autoStretchTtsAudio,
  applyExactAudioSpeed,
  applyInnerThoughtAudioEffect,
  mergeTimeIntervals,
  buildDynamicDuckingFilter,
  extractAudio,
  extractValidTimestamp,
  resolveSegmentStartSec,
  computeAdaptiveCrossfadeDuration,
  computeOverlapCrossfadePlan,
  buildSegmentMixFilterChain,
  createSynchronizedNarrationAudio,
} = require("./ffmpeg/ffmpegAudioMixAndDucking");
const {
  hexToAssColor,
  formatSecondsToAssTime,
  sanitizeKhmerSubtitleText,
  SUBTITLE_SIZE_SCALE_MAP,
  resolveRenderAspectRatio,
  resolveAssSubtitleLayoutDefaults,
  generateKhmerAssSubtitleFile,
  buildAssSubtitleVideoFilter,
  generateSrtFile,
  buildVerticalVideoFilterChain,
  buildCornerBlurVideoFilterChain,
  computeAntiTheftRibbonLayout,
  buildAntiTheftBlurVideoFilterChain,
  normalizeYoutubeTransform,
  buildYoutubeTransformVideoFilterChain,
} = require("./ffmpeg/ffmpegSubtitleAndOverlayFilters");

/**
 * Render Video with Multi-clip Adelay + Smart Ducking 85% + ASS Subtitles
 */
let activeRenderProcess = null;
const jobRenderProcesses = new Map();

function registerJobRenderRecord(jobId, regRecord) {
  if (!jobId || !regRecord) return;
  let set = jobRenderProcesses.get(jobId);
  if (!(set instanceof Set)) {
    set = new Set(set ? [set] : []);
    jobRenderProcesses.set(jobId, set);
  }
  set.add(regRecord);
}

function unregisterJobRenderRecord(jobId, regRecord) {
  if (!jobId) return;
  const entry = jobRenderProcesses.get(jobId);
  if (entry instanceof Set) {
    entry.delete(regRecord);
    if (entry.size === 0) jobRenderProcesses.delete(jobId);
  } else if (!regRecord || entry === regRecord) {
    jobRenderProcesses.delete(jobId);
  }
}

function cancelJobRenderProcess(jobId) {
  if (!jobId) return false;
  const entry = jobRenderProcesses.get(jobId);
  if (!entry) return false;
  const records = entry instanceof Set ? Array.from(entry) : [entry];
  let cancelledAny = false;
  for (const reg of records) {
    if (reg && reg.proc && !reg.proc.killed) {
      try {
        reg.interrupted = true;
        reg.cancelled = true;
        reg.proc.kill("SIGTERM");
        cancelledAny = true;
      } catch (_) {}
      if (reg.tempOutputPath && fs.existsSync(reg.tempOutputPath)) {
        try { fs.unlinkSync(reg.tempOutputPath); } catch (_) {}
      }
    }
  }
  jobRenderProcesses.delete(jobId);
  return cancelledAny;
}

function pauseJobRenderProcess(jobId) {
  if (!jobId) return false;
  const entry = jobRenderProcesses.get(jobId);
  if (!entry) return false;
  const records = entry instanceof Set ? Array.from(entry) : [entry];
  let pausedAny = false;
  for (const reg of records) {
    if (reg && reg.proc && !reg.proc.killed) {
      try {
        reg.interrupted = true;
        reg.paused = true;
        reg.proc.kill("SIGTERM");
        pausedAny = true;
      } catch (_) {}
      if (reg.tempOutputPath && fs.existsSync(reg.tempOutputPath)) {
        try { fs.unlinkSync(reg.tempOutputPath); } catch (_) {}
      }
    }
  }
  jobRenderProcesses.delete(jobId);
  return pausedAny;
}


/**
 * Determines whether video clips actually contain user edits, cuts, or trims,
 * or if they are simply a contiguous 1-to-1 representation of the untouched source video.
 */
function detectActualCustomCuts(validClips = [], totalDuration = 0) {
  if (!Array.isArray(validClips) || validClips.length === 0) return false;
  if (validClips.length === 1) {
    const c = validClips[0];
    const sIn = Number(c.sourceStart) || 0;
    const sOut = Number(c.sourceEnd) || 0;
    const cStart = Number(c.start) || 0;
    const cEnd = Number(c.end) || 0;
    if (sIn > 0.05 || (sOut > 0 && totalDuration > 0 && Math.abs(sOut - totalDuration) > 0.5)) return true;
    if (Math.abs((sOut - sIn) - (cEnd - cStart)) > 0.1) return true;
    return false;
  }

  // If clips are continuous without gaps, shifts, or trims, treat as untouched original
  let prevEnd = 0;
  for (let i = 0; i < validClips.length; i++) {
    const c = validClips[i];
    const cStart = Number(c.start) || 0;
    const cEnd = Number(c.end) || 0;
    const sIn = Number(c.sourceStart ?? cStart) || 0;
    const sOut = Number(c.sourceEnd ?? cEnd) || 0;

    if (Math.abs(cStart - prevEnd) > 0.05) return true;
    if (Math.abs(sIn - cStart) > 0.05 || Math.abs(sOut - cEnd) > 0.05) return true;
    if (Math.abs((sOut - sIn) - (cEnd - cStart)) > 0.1) return true;

    prevEnd = cEnd;
  }
  return false;
}

function renderDubbedVideoWithDucking(options = {}) {
  if (!options.__bypassVideoAds) {
    const rawClips = Array.isArray(options.videoClips) ? options.videoClips : [];
    const hasExistingAds = rawClips.some((c) => isAdClip(c));
    const hasPlacementAd = Boolean(
      options.videoAdSettings?.enabled &&
      (options.videoAdSettings.placement === "preroll" || options.videoAdSettings.placement === "postroll")
    );
    if (hasExistingAds || hasPlacementAd) {
      return renderDubbedVideoWithAdsAssembly(options);
    }
  }

  const inputVideoPath = options.inputVideoPath || options.videoPath;
  const masterAudioPath = options.masterAudioPath || null;
  const fullAudioPath = options.fullAudioPath || null;
  const segments = options.segments || [];
  const outputVideoPath = options.outputVideoPath || options.outputPath;
  const soundMode = options.soundMode || "ducking";
  const bgVolume = options.bgVolume ?? options.duckingVolume ?? 0.15;
  const khmerVolume = options.khmerVolume ?? 1.3;
  const burnSubtitles = options.burnSubtitles !== false;
  const subtitleOptions = options.subtitleOptions || (options.subtitlePath ? { assSubtitlePath: options.subtitlePath } : {});
  const subtitleStyle = subtitleOptions?.subtitleStyle || options?.subtitleStyle || "banner";
  const aspectRatio = options.aspectRatio || null;
  const verticalStyle = options.verticalStyle || subtitleOptions?.verticalStyle || "pad";
  const videoClips = options.videoClips || [];
  const antiTheft = options.antiTheft || null;
  const cornerMask = options.cornerMask || null;
  const logoSettings = options.logoSettings || null;
  const youtubeTransform = normalizeYoutubeTransform(options.youtubeTransform || null);
  const youtubeSafeAudio = Boolean(youtubeTransform.youtubeSafeAudio || options.youtubeSafeAudio);
  const customBgmPath = (options.enableCustomBgm && options.customBgmPath && fs.existsSync(options.customBgmPath))
    ? options.customBgmPath
    : null;
  const hasCustomBgm = Boolean(customBgmPath);
  const framingKeyframes = options.framingKeyframes || [];
  const framingOverrides = options.framingOverrides || [];
  const allowOriginalAudio = Boolean(options.allowOriginalAudio);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const expectedDurationSec = Number(options.expectedDurationSec) || 0;

  return new Promise(async (resolve, reject) => {
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return reject(new Error(`រកមិនឃើញវីដេអូដើម៖ ${inputVideoPath}`));
    }

    const outDir = outputVideoPath ? path.dirname(outputVideoPath) : os.tmpdir();
    if (outputVideoPath && !fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // AI Vocal Separation (Demucs): If enabled (and not overridden by Custom BGM or YouTube Safe Audio), separate audio first
    let separatedBgAudioPath = (youtubeSafeAudio || hasCustomBgm) ? null : (options.separatedBgAudioPath || null);
    if (options.enableDemucs && !separatedBgAudioPath && !youtubeSafeAudio && !hasCustomBgm) {
      console.log(`[FFmpegService] 🧠 AI Vocal Separation (Demucs) is active for: ${inputVideoPath}`);
      try {
        const sepRes = await audioSeparationService.separateAudio({
          audioPath: inputVideoPath,
          separationPreset: options.separationPreset || 'turbo',
          model: options.separationModel || (options.separationPreset === 'ffmpeg_fast' ? 'ffmpeg_fast' : undefined),
          jobId: options.jobId || `render_demucs_${Date.now()}`,
        });
        if (!sepRes || !sepRes.noVocalsPath || !fs.existsSync(sepRes.noVocalsPath)) {
          throw new Error("Demucs separation completed but no_vocals.wav was not found.");
        }
        separatedBgAudioPath = sepRes.noVocalsPath;
        console.log(`[FFmpegService] ✅ Demucs separation ready: ${separatedBgAudioPath} (cached: ${Boolean(sepRes.isCached)})`);
      } catch (demucsErr) {
        console.error(`[FFmpegService] ❌ Demucs vocal separation failed:`, demucsErr);
        return reject(new Error(`AI Vocal Separation (Demucs) failed: ${demucsErr.message}. Rendering cancelled to protect audio quality.`));
      }
    }

    const activeMasterAudio = masterAudioPath || fullAudioPath;
    const hasValidMasterAudio = Boolean(activeMasterAudio && fs.existsSync(activeMasterAudio));

    const validSegments = segments
      .filter((seg) => !seg.muted && !seg.isMuted && (hasValidMasterAudio || (seg.audioPath && fs.existsSync(seg.audioPath)) || (seg.audioFile && fs.existsSync(seg.audioFile))))
      .map((seg) => ({
        ...seg,
        audioPath: seg.audioPath || seg.audioFile,
        startSeconds: Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? parseTimeToSec(seg.start, 0)),
        endSeconds: Number(seg.endSeconds ?? seg.endSec ?? seg.audioEndSec ?? parseTimeToSec(seg.end, 0)),
        duration: Number(seg.audioDuration ?? seg.duration ?? seg.audioDurationSec ?? 2.5),
      }));

    if (!hasValidMasterAudio && validSegments.length === 0 && !allowOriginalAudio) {
      return reject(new Error("មិនមាន File សំឡេងខ្មែរ TTS សម្រាប់យកមក Mix ឡើយ!"));
    }

    const isOriginalPassthrough = Boolean(!hasValidMasterAudio && validSegments.length === 0 && allowOriginalAudio);

    // Windows CLI Length Guard: If no master audio is pre-rendered and segment count > 20,
    // auto-assemble master narration audio using bounded hierarchical batching (BATCH_SIZE = 40)
    // to strictly prevent Windows CreateProcessW 32,767 character command-line overflow!
    if (!isOriginalPassthrough && !hasValidMasterAudio && (validSegments.length > 20 || options.enableDemucs || hasCustomBgm)) {
      console.log(`[FFmpegService] ⚠️ Master audio track not pre-rendered for ${validSegments.length} segments. Auto-assembling master narration track...`);
      const autoMasterAudioPath = path.join(
        outDir,
        `.tmp_auto_master_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`
      );
      createSynchronizedNarrationAudio(validSegments, autoMasterAudioPath)
        .then((builtPath) => {
          renderDubbedVideoWithDucking({
            ...options,
            separatedBgAudioPath,
            masterAudioPath: builtPath,
            fullAudioPath: builtPath,
          })
            .then((res) => {
              try { if (fs.existsSync(builtPath)) fs.unlinkSync(builtPath); } catch (_) {}
              resolve(res);
            })
            .catch((err) => {
              try { if (fs.existsSync(builtPath)) fs.unlinkSync(builtPath); } catch (_) {}
              reject(err);
            });
        })
        .catch((autoSyncErr) => {
          try { if (fs.existsSync(autoMasterAudioPath)) fs.unlinkSync(autoMasterAudioPath); } catch (_) {}
          reject(new Error(`Failed to auto-assemble master narration audio for render: ${autoSyncErr.message}`));
        });
      return;
    }

    console.log(
      `[FFmpegService] 🎬 ចាប់ផ្តើម Render វីដេអូ (${hasValidMasterAudio ? 'Master Audio Track' : validSegments.length + ' ឃ្លា'} | Mode: ${soundMode} | Ducking Volume: ${bgVolume})`
    );
    const startTime = Date.now();

    const safeInputVideo = getSafeCliPath(inputVideoPath);
    const args = ["-y", "-hwaccel", "auto", "-i", safeInputVideo];
    const filterComplexParts = [];
    let tempFilterScriptPath = null;

    // Pre-calculate valid clips so ducking filter knows about muted video clips
    const validClips = (Array.isArray(videoClips) ? videoClips : [])
      .filter((c) => Number(c.end) > Number(c.start))
      .sort((a, b) => Number(a.start) - Number(b.start));

    let probedMeta = null;
    if (isOriginalPassthrough || onProgress || hasCustomBgm) {
      try {
        probedMeta = await getVideoMetadata(inputVideoPath);
      } catch (_) {}
    }
    const effectiveExpectedDur = expectedDurationSec > 0
      ? expectedDurationSec
      : (probedMeta?.durationSec || 0);
    const hasCustomCutsForAudio = detectActualCustomCuts(validClips, effectiveExpectedDur);
    const editedClipsDur = hasCustomCutsForAudio
      ? validClips.reduce((sum, c) => sum + Math.max(0.1, Number(c.end) - Number(c.start)), 0)
      : 0;
    const targetAudioDurSec = (hasCustomCutsForAudio && editedClipsDur > 0)
      ? editedClipsDur
      : effectiveExpectedDur;

    if (isOriginalPassthrough) {
      if (hasCustomBgm) {
        args.push("-stream_loop", "-1", "-i", getSafeCliPath(customBgmPath));
        const safeBgVol = Number.isFinite(Number(bgVolume)) ? Math.max(0, Math.min(1, Number(bgVolume))) : 0.15;
        const trimPrefix = targetAudioDurSec > 0 ? `atrim=0:${targetAudioDurSec.toFixed(3)},asetpts=PTS-STARTPTS,` : "";
        filterComplexParts.push(
          `[1:a]${trimPrefix}aformat=sample_rates=44100:channel_layouts=stereo,volume=${safeBgVol.toFixed(3)}[final_audio]`
        );
      } else if (probedMeta && probedMeta.hasAudio === false) {
        filterComplexParts.push(`aevalsrc=0:s=44100:c=stereo[final_audio]`);
      } else if (youtubeSafeAudio) {
        filterComplexParts.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.0[final_audio]`);
      } else {
        filterComplexParts.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo[final_audio]`);
      }
    } else if (hasValidMasterAudio) {
      // 🚀 Fast Path: streamlined render using pre-synchronized master Khmer narration audio
      args.push("-i", getSafeCliPath(activeMasterAudio));

      if (hasCustomBgm) {
        // Custom Loop BGM Mode (Anti-Copyright User Music):
        // Input 0 = Video (original audio ignored/muted 100%)
        // Input 1 = Khmer Master Narration
        // Input 2 = Looped Custom BGM (-stream_loop -1) trimmed to video duration & ducked under Khmer speech
        args.push("-stream_loop", "-1", "-i", getSafeCliPath(customBgmPath));
        const safeBgVol = Number.isFinite(Number(bgVolume)) ? Math.max(0, Math.min(1, Number(bgVolume))) : 0.15;
        const effectiveBgDuck = safeBgVol <= 0.005 ? 0 : safeBgVol;
        const effectiveBgNormal = safeBgVol <= 0.005
          ? 0
          : Math.min(1.0, Number((safeBgVol <= 0.05 ? safeBgVol : safeBgVol * 1.4).toFixed(3)));
        const bgFilter = safeBgVol <= 0.005
          ? "volume=0.0"
          : ((validSegments.length > 0 && soundMode === "ducking")
              ? buildDynamicDuckingFilter(validSegments, effectiveBgDuck, effectiveBgNormal, validClips)
              : `volume=${effectiveBgDuck.toFixed(3)}`);
        const trimPrefix = targetAudioDurSec > 0
          ? `atrim=0:${targetAudioDurSec.toFixed(3)},asetpts=PTS-STARTPTS,`
          : "";
        console.log(`[FFmpegService] 🎵 Mixing Looped Custom BGM (${path.basename(customBgmPath)}, duck: ${effectiveBgDuck.toFixed(2)}, normal: ${effectiveBgNormal.toFixed(2)}) + Khmer voice (volume: ${khmerVolume.toFixed(2)})`);
        const amixOrder = targetAudioDurSec > 0 ? "[custom_bg][khmer_bus]" : "[khmer_bus][custom_bg]";
        filterComplexParts.push(
          `[2:a]${trimPrefix}aformat=sample_rates=44100:channel_layouts=stereo,${bgFilter}[custom_bg]`,
          `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${khmerVolume.toFixed(2)}[khmer_bus]`,
          `${amixOrder}amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[final_audio]`
        );
      } else if (!youtubeSafeAudio && separatedBgAudioPath && fs.existsSync(separatedBgAudioPath)) {
        // AI Vocal Separation Mode (Demucs):
        // Input 0 = Video
        // Input 1 = Khmer Master Narration
        // Input 2 = no_vocals.wav (Clean BGM & Sound Effects, Chinese dialogue stripped)
        args.push("-i", getSafeCliPath(separatedBgAudioPath));
        const safeBgVol = Number.isFinite(Number(bgVolume)) ? Math.max(0, Math.min(1, Number(bgVolume))) : 0.15;
        const effectiveBgDuck = safeBgVol <= 0.005 ? 0 : safeBgVol;
        const effectiveBgNormal = safeBgVol <= 0.005
          ? 0
          : Math.min(1.0, Number((safeBgVol <= 0.05 ? safeBgVol : safeBgVol * 1.4).toFixed(3)));
        const bgFilter = safeBgVol <= 0.005
          ? "volume=0.0"
          : ((validSegments.length > 0 && soundMode === "ducking")
              ? buildDynamicDuckingFilter(validSegments, effectiveBgDuck, effectiveBgNormal, validClips)
              : `volume=${effectiveBgDuck.toFixed(3)}`);
        console.log(`[FFmpegService] 🎚️ Mixing Demucs separated BGM (duck: ${effectiveBgDuck.toFixed(2)}, normal: ${effectiveBgNormal.toFixed(2)}) + Khmer voice (volume: ${khmerVolume.toFixed(2)})`);
        filterComplexParts.push(
          `[2:a]aformat=sample_rates=44100:channel_layouts=stereo,${bgFilter}[clean_bg]`,
          `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${khmerVolume.toFixed(2)}[khmer_bus]`,
          `[clean_bg][khmer_bus]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[final_audio]`
        );
      } else {
        const effectiveBgNormal = bgVolume <= 0.05 ? bgVolume : Math.min(1.0, Number((bgVolume * 1.5).toFixed(2)));
        const duckFilter = buildDynamicDuckingFilter(validSegments, bgVolume, effectiveBgNormal, validClips);
        if (soundMode === "replace" || bgVolume <= 0.01 || youtubeSafeAudio) {
          if (youtubeSafeAudio) {
            console.log(`[FFmpegService] 🛡️ YouTube Safe Audio active: muting original drama OST completely (volume=0.0)`);
          }
          filterComplexParts.push(
            `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.0[muted_bg]`,
            `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${khmerVolume.toFixed(2)}[khmer_bus]`,
            `[muted_bg][khmer_bus]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[final_audio]`
          );
        } else {
          filterComplexParts.push(
            `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,${duckFilter}[ducked_bg]`,
            `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${khmerVolume.toFixed(2)}[khmer_bus]`,
            `[ducked_bg][khmer_bus]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[final_audio]`
          );
        }
      }
    } else {
      // Fallback Path: Multi-segment adelay + smooth half-sine crossfade + amix with steady normalization guard
      validSegments.forEach((seg) => {
        args.push("-i", getSafeCliPath(seg.audioPath));
      });

      const preparedFallbackSegs = await Promise.all(validSegments.map(async (seg) => {
        const segStart = Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? 0);
        let segDur = Number(seg.finalAudioDuration || seg.audioDurationSec || seg.duration || 2.5);
        let trimDur = null;
        if (seg.audioTrimmed && typeof seg.audioEndSec === "number" && typeof seg.audioStartSec === "number" && seg.audioEndSec > seg.audioStartSec) {
          trimDur = Math.max(0.1, parseFloat((seg.audioEndSec - seg.audioStartSec).toFixed(3)));
          segDur = trimDur;
        } else if ((seg.audioTrimmed || seg.userTrimmed) && typeof seg.audioDurationSec === "number" && seg.audioDurationSec > 0) {
          trimDur = seg.audioDurationSec;
          segDur = trimDur;
        } else if (seg.audioPath && fs.existsSync(seg.audioPath)) {
          try {
            const probed = await getMediaDuration(seg.audioPath);
            if (Number.isFinite(probed) && probed > 0.05) {
              const rawOff = typeof seg.audioOffset === "number" && !isNaN(seg.audioOffset) ? seg.audioOffset : 0;
              const effOff = rawOff >= probed ? 0 : Math.max(0, rawOff);
              segDur = Math.max(0.05, parseFloat((probed - effOff).toFixed(3)));
            }
          } catch (_) {}
        }
        const rawOffset = typeof seg.audioOffset === "number" && !isNaN(seg.audioOffset) ? seg.audioOffset : 0;
        const audioOffset = (trimDur && rawOffset >= trimDur) ? 0 : Math.max(0, rawOffset);
        return { seg, segStart, segDur, trimDur, audioOffset };
      }));

      const fallbackCrossfadePlans = computeOverlapCrossfadePlan(
        preparedFallbackSegs.map((item) => ({
          startSec: item.segStart,
          durSec: item.segDur,
          endSec: item.segStart + item.segDur,
        }))
      );

      const delayedVoiceLabels = [];
      preparedFallbackSegs.forEach((item, index) => {
        const { segStart, trimDur, audioOffset } = item;
        const inputIndex = index + 1;
        const delayMs = Math.max(0, Math.round(segStart * 1000));
        const label = `v${inputIndex}`;
        const cfPlan = fallbackCrossfadePlans[index] || { fadeIn: null, fadeOut: null };

        const fadeFilters = [];
        if (cfPlan.fadeIn && cfPlan.fadeIn.durSec >= 0.015) {
          fadeFilters.push(`afade=t=in:st=0:d=${cfPlan.fadeIn.durSec.toFixed(3)}:curve=hsin`);
        }
        if (cfPlan.fadeOut && cfPlan.fadeOut.durSec >= 0.015) {
          fadeFilters.push(`afade=t=out:st=${cfPlan.fadeOut.relStartSec.toFixed(3)}:d=${cfPlan.fadeOut.durSec.toFixed(3)}:curve=hsin`);
        }
        const fadeChain = fadeFilters.length > 0 ? `${fadeFilters.join(",")},` : "";
        const volFilter = `volume=${khmerVolume.toFixed(2)}`;

        let trimFilter = "";
        if (trimDur && trimDur > 0) {
          trimFilter = `atrim=start=${audioOffset}:duration=${trimDur},asetpts=PTS-STARTPTS,`;
        } else if (audioOffset > 0) {
          trimFilter = `atrim=start=${audioOffset},asetpts=PTS-STARTPTS,`;
        }

        filterComplexParts.push(
          `[${inputIndex}:a]${trimFilter}aformat=sample_rates=44100:channel_layouts=stereo,${fadeChain}${volFilter},adelay=${delayMs}|${delayMs}[${label}]`
        );
        delayedVoiceLabels.push(`[${label}]`);
      });

      if (validSegments.length === 1) {
        filterComplexParts.push(`${delayedVoiceLabels[0]}anull[khmer_bus]`);
      } else {
        filterComplexParts.push(
          `${delayedVoiceLabels.join("")}amix=inputs=${validSegments.length}:duration=longest:dropout_transition=2147483647,volume=${validSegments.length},alimiter=limit=0.95[khmer_bus]`
        );
      }

      if (soundMode === "replace" || bgVolume <= 0.01 || youtubeSafeAudio) {
        filterComplexParts.push(
          `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.0[muted_bg]`,
          `[muted_bg][khmer_bus]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[final_audio]`
        );
      } else {
        const effectiveBgNormal = bgVolume <= 0.05 ? bgVolume : Math.min(1.0, Number((bgVolume * 1.5).toFixed(2)));
      const duckFilter = buildDynamicDuckingFilter(validSegments, bgVolume, effectiveBgNormal);
        filterComplexParts.push(
          `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,${duckFilter}[ducked_bg]`,
          `[ducked_bg][khmer_bus]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[final_audio]`
        );
      }
    }

    // Logo Watermark Input (សងខាង / ជ្រុងលើ)
    let logoInputIndex = -1;
    const hasLogo = Boolean(
      logoSettings &&
      (logoSettings.enabled || logoSettings.enableLogo) &&
      logoSettings.logoPath &&
      fs.existsSync(logoSettings.logoPath)
    );

    if (hasLogo) {
      const currentInputCount = args.reduce((acc, curr) => (curr === "-i" ? acc + 1 : acc), 0);
      logoInputIndex = currentInputCount;
      args.push("-i", getSafeCliPath(logoSettings.logoPath));
      console.log(`[FFmpegService] 🖼️ Logo watermark input detected at index [${logoInputIndex}:v]: ${path.basename(logoSettings.logoPath)}`);
    }

    // Sponsor Ads (Green Screen Video) Input
    let sponsorInputIndex = -1;
    let sponsorHasAudio = false;
    const sponsorSettings = options.sponsorSettings || null;
    const hasSponsor = Boolean(
      sponsorSettings &&
      (sponsorSettings.enabled || sponsorSettings.enableSponsor) &&
      sponsorSettings.sponsorPath &&
      fs.existsSync(sponsorSettings.sponsorPath)
    );
    const sponsorMuteAudio = sponsorSettings
      ? (sponsorSettings.muteAudio !== false && sponsorSettings.sponsorMuteAudio !== false)
      : true;

    if (hasSponsor) {
      const currentInputCount = args.reduce((acc, curr) => (curr === "-i" ? acc + 1 : acc), 0);
      sponsorInputIndex = currentInputCount;
      args.push("-stream_loop", "-1", "-i", getSafeCliPath(sponsorSettings.sponsorPath));
      if (!sponsorMuteAudio) {
        try {
          const spMeta = await getVideoMetadata(sponsorSettings.sponsorPath);
          sponsorHasAudio = Boolean(spMeta && spMeta.hasAudio);
        } catch (_) {
          sponsorHasAudio = false;
        }
      }
      console.log(`[FFmpegService] 🎬 Sponsor video input detected at index [${sponsorInputIndex}:v]: ${path.basename(sponsorSettings.sponsorPath)} (muteAudio=${sponsorMuteAudio}, hasAudio=${sponsorHasAudio})`);
    }

    // NLE multi-clip cuts and trims on VIDEO 1
    let baseVideoSource = "[0:v:0]";

    const hasCustomCuts = detectActualCustomCuts(validClips, effectiveExpectedDur);

    if (hasCustomCuts) {
      validClips.forEach((c, cIdx) => {
        const sIn = Math.max(0, Number(c.sourceStart) || 0);
        const dur = Math.max(0.1, Number(c.end) - Number(c.start));
        const sOut = Number(c.sourceEnd) && Number(c.sourceEnd) > sIn ? Number(c.sourceEnd) : (sIn + dur);
        filterComplexParts.push(
          `[0:v:0]trim=start=${sIn.toFixed(3)}:end=${sOut.toFixed(3)},setpts=PTS-STARTPTS[vtrim_${cIdx}]`
        );
      });
      const trimLabels = validClips.map((_, idx) => `[vtrim_${idx}]`).join('');
      filterComplexParts.push(`${trimLabels}concat=n=${validClips.length}:v=1:a=0[v_edited]`);
      baseVideoSource = "[v_edited]";
    }

    // បង្កើត .ass Subtitle និង Anti-theft Marquee ហើយ Burn លើវីដេអូ (CapCut Style 9:16 Blur Background ឬ 16:9)
    let tempAssPath = null;
    let videoMapArg = baseVideoSource.startsWith("[v_") ? baseVideoSource : "0:v:0";
    const sourceDimensions = getVideoDimensionsFast(inputVideoPath);

    const targetAspectRatio = resolveRenderAspectRatio(subtitleOptions.aspectRatio || aspectRatio, sourceDimensions);
    const hasAntiTheft = Boolean(antiTheft && (antiTheft.enabled || antiTheft.enableAntiTheft));
    const isBlurAntiTheft = Boolean(
      hasAntiTheft &&
      String(antiTheft.bgStyle || antiTheft.antiTheftBgStyle || "dark").toLowerCase() === "blur"
    );
    const hasCornerMask = Boolean(cornerMask && (cornerMask.enabled || cornerMask.enableCornerMask));
    const isBlurCornerMask = Boolean(hasCornerMask && String(cornerMask.style || "badge").toLowerCase() === "blur");
    const hasAssCornerMask = Boolean(hasCornerMask && !isBlurCornerMask);
    const hasBurnableSubs = Boolean(burnSubtitles && validSegments.length > 0);
    const shouldBurnAss = Boolean(hasBurnableSubs || hasAntiTheft || hasAssCornerMask);
    const isSourcePortrait = Boolean(
      sourceDimensions &&
      Number(sourceDimensions.height) > Number(sourceDimensions.width)
    );
    const shouldBlurVerticalSubBand = Boolean(
      targetAspectRatio === "9:16" &&
      hasBurnableSubs &&
      (verticalStyle === "crop" || isSourcePortrait)
    );

    const srcRatio =
      sourceDimensions && Number(sourceDimensions.width) > 0 && Number(sourceDimensions.height) > 0
        ? sourceDimensions.width / sourceDimensions.height
        : 16 / 9;
    const needsLandscape16x9Pad =
      targetAspectRatio === "16:9" &&
      sourceDimensions &&
      Number(sourceDimensions.width) > 0 &&
      Number(sourceDimensions.height) > 0 &&
      Math.abs(srcRatio - 16 / 9) > 0.05;

    // 0. YouTube Safe Edit transform (hflip -> zoom/crop -> eq color grade)
    // Strictly runs BEFORE aspect-ratio scale/pad, Corner Mask, Anti-Theft blur,
    // ASS Khmer subtitles, and Logo/Sponsor overlays so text and logos stay un-flipped.
    const ytTxFilters = buildYoutubeTransformVideoFilterChain({
      inputLabel: baseVideoSource,
      outputLabel: "[v_yt_tx]",
      youtubeTransform,
    });
    if (ytTxFilters.length > 0) {
      filterComplexParts.push(...ytTxFilters);
      baseVideoSource = "[v_yt_tx]";
      videoMapArg = "[v_yt_tx]";
    }

    // 1. Scale/pad canvas first (9:16, 16:9 pad, 1:1, or source passthrough)
    let canvasLabel = baseVideoSource;
    if (targetAspectRatio === "9:16") {
      filterComplexParts.push(
        ...buildVerticalVideoFilterChain({
          inputLabel: baseVideoSource,
          outputLabel: "[base_vert]",
          verticalStyle,
          blurSubtitleBand: shouldBlurVerticalSubBand,
          segments,
          framingOverrides,
          framingKeyframes,
        })
      );
      canvasLabel = "[base_vert]";
    } else if (needsLandscape16x9Pad) {
      filterComplexParts.push(
        `${baseVideoSource}scale='if(gt(a,16/9),1920,-2)':'if(gt(a,16/9),-2,1080)',pad=1920:1080:(1920-iw)/2:(1080-ih)/2:color=black,setsar=1[base_land]`
      );
      canvasLabel = "[base_land]";
    } else if (targetAspectRatio === "1:1") {
      filterComplexParts.push(
        `${baseVideoSource}scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(1080-iw)/2:(1080-ih)/2:color=black,setsar=1[base_sq]`
      );
      canvasLabel = "[base_sq]";
    }

    // 2. Apply Real Video Blur Corner Mask (crop + gblur + overlay) BEFORE burning ASS subtitles/logo
    if (isBlurCornerMask) {
      const blurInput = canvasLabel.startsWith("[") ? canvasLabel : `[${canvasLabel}]`;
      filterComplexParts.push(
        ...buildCornerBlurVideoFilterChain({
          inputLabel: blurInput,
          outputLabel: "[v_corner_blur]",
          cornerMask,
          aspectRatio: targetAspectRatio,
          verticalStyle,
        })
      );
      canvasLabel = "[v_corner_blur]";
    }

    // 2b. Apply Real Video Blur Anti-Theft Ribbon (crop + gblur + overlay) BEFORE burning ASS marquee text
    if (isBlurAntiTheft) {
      const atBlurInput = canvasLabel.startsWith("[") ? canvasLabel : `[${canvasLabel}]`;
      filterComplexParts.push(
        ...buildAntiTheftBlurVideoFilterChain({
          inputLabel: atBlurInput,
          outputLabel: "[v_at_blur]",
          antiTheft,
          aspectRatio: targetAspectRatio,
          verticalStyle,
          sourceDimensions,
        })
      );
      canvasLabel = "[v_at_blur]";
    }

    // 3. Burn ASS Subtitles / Anti-Theft / Badge or Solid Corner Mask on top of blurred/scaled canvas
    if (shouldBurnAss) {
      tempAssPath = path.join(
        path.dirname(outputVideoPath),
        `temp_subs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.ass`
      );

      // Determine total duration for anti-theft marquee loop
      let calculatedDuration = 0;
      if (Array.isArray(validClips) && validClips.length > 0) {
        calculatedDuration = Math.max(...validClips.map((c) => Number(c.end || c.sourceEnd || 0)));
      }
      if (calculatedDuration <= 0 && Array.isArray(validSegments) && validSegments.length > 0) {
        calculatedDuration = Math.max(...validSegments.map((s) => Number(s.endSeconds || (s.startSeconds + s.duration) || 0)));
      }

      generateKhmerAssSubtitleFile({
        segments: burnSubtitles ? validSegments : [],
        outputPath: tempAssPath,
        fontName: subtitleOptions.fontName || "Khmer OS Battambang",
        fontSize: subtitleOptions.fontSize,
        subtitleSize: subtitleOptions.subtitleSize,
        textColor: subtitleOptions.textColor || "#FFFFFF",
        outlineColor: subtitleOptions.outlineColor || "#000000",
        subtitleStyle,
        marginV: subtitleOptions.marginV ? Number(subtitleOptions.marginV) : null,
        aspectRatio: targetAspectRatio,
        verticalStyle,
        antiTheft: hasAntiTheft ? antiTheft : null,
        cornerMask: hasAssCornerMask ? cornerMask : null,
        totalDuration: calculatedDuration > 0 ? calculatedDuration : null,
        sourceDimensions,
      });

      const assFilter = buildAssSubtitleVideoFilter(tempAssPath);
      filterComplexParts.push(`${canvasLabel}${assFilter}[final_video]`);
      videoMapArg = "[final_video]";
    } else if (canvasLabel !== baseVideoSource) {
      videoMapArg = canvasLabel;
    }

    // Overlay Logo Watermark (សងខាង / Both Sides, Top-Left, or Top-Right)
    if (hasLogo && logoInputIndex >= 0) {
      const baseLogoSize = Number(logoSettings.size || logoSettings.logoSize) || 72;
      const outputCanvasW =
        targetAspectRatio === "9:16" || targetAspectRatio === "1:1"
          ? 1080
          : (needsLandscape16x9Pad ? 1920 : (Number(sourceDimensions?.width) || 1280));

      // Match Live Preview CSS pixel proportions proportionally to the actual export canvas
      // (~850px wide 16:9 Studio preview, ~400px wide 9:16 preview, ~450px for 1:1)
      const refPreviewW = targetAspectRatio === "9:16" ? 400 : (targetAspectRatio === "1:1" ? 450 : 850);
      const dynamicScale = Math.max(0.6, outputCanvasW / refPreviewW);
      const previewScaleFactor = targetAspectRatio === "9:16" ? 0.55 : 1.0;

      const scaledW = Math.max(28, Math.min(Math.round(outputCanvasW * 0.22), Math.round(baseLogoSize * previewScaleFactor * dynamicScale)));
      const scaledH = scaledW;
      const opacity = Math.max(0.1, Math.min(1.0, Number(logoSettings.opacity || logoSettings.logoOpacity) || 0.9));
      const baseMargin = Math.max(8, Math.min(80, Math.round((Number(logoSettings.margin || logoSettings.logoMargin) || 20) * (outputCanvasW / 1280))));
      const topMargin = (targetAspectRatio === "9:16" && verticalStyle !== "crop") ? (656 + baseMargin) : baseMargin;
      const sideMargin = baseMargin;
      const margin = baseMargin;
      const shape = logoSettings.shape || logoSettings.logoShape || "circle";
      const pos = logoSettings.position || logoSettings.logoPosition || "both";

      let logoPrepFilter = `[${logoInputIndex}:v]scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease,format=rgba`;
      if (shape === "circle") {
        logoPrepFilter += `,geq=r='p(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),min(W/2,H/2)),alpha(X,Y)*${opacity.toFixed(2)},0)'`;
      } else {
        logoPrepFilter += `,colorchannelmixer=aa=${opacity.toFixed(2)}`;
      }
      let vCurrent = videoMapArg.startsWith("[") ? videoMapArg : `[${videoMapArg}]`;
      if (videoMapArg === "0:v:0") {
        vCurrent = "[0:v:0]";
      }

      if (pos === "both") {
        // FFmpeg filter output pads are 1-to-1 and cannot be consumed twice without split
        logoPrepFilter += `,split[logo_left][logo_right]`;
        filterComplexParts.push(logoPrepFilter);
        filterComplexParts.push(
          `${vCurrent}[logo_left]overlay=${sideMargin}:${topMargin}[v_logo_left]`,
          `[v_logo_left][logo_right]overlay=main_w-overlay_w-${sideMargin}:${topMargin}[v_logo_both]`
        );
        videoMapArg = "[v_logo_both]";
      } else {
        logoPrepFilter += `[logo_prepared]`;
        filterComplexParts.push(logoPrepFilter);

        let overlayExpr = `${sideMargin}:${topMargin}`;
        if (pos === "top-right") {
          overlayExpr = `main_w-overlay_w-${sideMargin}:${topMargin}`;
        } else if (pos === "bottom-left") {
          overlayExpr = `${margin}:main_h-overlay_h-${margin}`;
        } else if (pos === "bottom-right") {
          overlayExpr = `main_w-overlay_w-${margin}:main_h-overlay_h-${margin}`;
        } else if (pos === "center") {
          overlayExpr = `(main_w-overlay_w)/2:(main_h-overlay_h)/2`;
        } else if (
          pos === "custom" ||
          (logoSettings.logoXPercent !== undefined && logoSettings.logoXPercent !== null &&
            logoSettings.logoYPercent !== undefined && logoSettings.logoYPercent !== null) ||
          (logoSettings.xPercent !== undefined && logoSettings.xPercent !== null &&
            logoSettings.yPercent !== undefined && logoSettings.yPercent !== null)
        ) {
          const rawX = logoSettings.logoXPercent ?? logoSettings.xPercent ?? 50;
          const rawY = logoSettings.logoYPercent ?? logoSettings.yPercent ?? 50;
          const numX = Number(rawX);
          const numY = Number(rawY);
          const xPct = Math.max(0, Math.min(100, Number.isFinite(numX) ? numX : 50)) / 100;
          const yPct = Math.max(0, Math.min(100, Number.isFinite(numY) ? numY : 50)) / 100;
          overlayExpr = `(main_w-overlay_w)*${xPct.toFixed(4)}:(main_h-overlay_h)*${yPct.toFixed(4)}`;
        }
        filterComplexParts.push(
          `${vCurrent}[logo_prepared]overlay=${overlayExpr}[v_logo_single]`
        );
        videoMapArg = "[v_logo_single]";
      }
    }

    // Overlay Sponsor Ads Video (Green Screen Chroma Key)
    let audioMapArg = "[final_audio]";
    if (hasSponsor && sponsorInputIndex >= 0) {
      const scalePercent = Math.max(10, Math.min(60, Number(sponsorSettings.scale || sponsorSettings.sponsorScale) || 25));
      const outputCanvasW =
        targetAspectRatio === "9:16" || targetAspectRatio === "1:1"
          ? 1080
          : (needsLandscape16x9Pad ? 1920 : (Number(sourceDimensions?.width) || 1920));
      const targetW = Math.round(outputCanvasW * (scalePercent / 100));
      // Ensure even dimensions for H.264
      const safeScaledW = Math.max(80, targetW - (targetW % 2));
      const pos = sponsorSettings.position || sponsorSettings.sponsorPosition || "bottom-left";
      const margin = Math.max(10, Math.min(100, Math.round(Number(sponsorSettings.margin || sponsorSettings.sponsorMargin || 20))));
      const topMargin = (targetAspectRatio === "9:16" && verticalStyle !== "crop") ? (656 + margin) : margin;
      const bottomMargin = (targetAspectRatio === "9:16" && verticalStyle !== "crop") ? (656 + margin) : margin;
      const useChromaKey = sponsorSettings.chromaKey !== false && sponsorSettings.sponsorChromaKey !== false;
      const sim = Math.max(0.1, Math.min(0.5, Number(sponsorSettings.chromaSimilarity || sponsorSettings.sponsorChromaSimilarity || 0.30)));
      const smooth = Math.max(0.05, Math.min(0.3, Number(sponsorSettings.chromaSmoothness || sponsorSettings.sponsorSmoothness || 0.10)));

      let sponsorPrepFilter = `[${sponsorInputIndex}:v]`;
      if (useChromaKey) {
        sponsorPrepFilter += `colorkey=0x00FF00:${sim.toFixed(2)}:${smooth.toFixed(2)},format=rgba,`;
      } else {
        sponsorPrepFilter += `format=rgba,`;
      }
      sponsorPrepFilter += `scale=${safeScaledW}:-2[sponsor_prepared]`;
      filterComplexParts.push(sponsorPrepFilter);

      let vCurrent = videoMapArg.startsWith("[") ? videoMapArg : `[${videoMapArg}]`;
      if (videoMapArg === "0:v:0") {
        vCurrent = "[0:v:0]";
      }

      const rawSponsorX = sponsorSettings.sponsorXPercent ?? sponsorSettings.xPercent;
      const rawSponsorY = sponsorSettings.sponsorYPercent ?? sponsorSettings.yPercent;
      const parsedSponsorX =
        rawSponsorX === null || rawSponsorX === undefined || rawSponsorX === "" ? NaN : Number(rawSponsorX);
      const parsedSponsorY =
        rawSponsorY === null || rawSponsorY === undefined || rawSponsorY === "" ? NaN : Number(rawSponsorY);
      const hasCustomSponsorCoords = Number.isFinite(parsedSponsorX) && Number.isFinite(parsedSponsorY);

      let overlayX = `${margin}`;
      let overlayY = `main_h-overlay_h-${bottomMargin}`;
      if (pos === "custom" || hasCustomSponsorCoords) {
        const xFrac = Math.max(0, Math.min(100, Number.isFinite(parsedSponsorX) ? parsedSponsorX : 50)) / 100;
        const yFrac = Math.max(0, Math.min(100, Number.isFinite(parsedSponsorY) ? parsedSponsorY : 50)) / 100;
        overlayX = `(main_w-overlay_w)*${xFrac.toFixed(4)}`;
        overlayY = `(main_h-overlay_h)*${yFrac.toFixed(4)}`;
      } else if (pos === "bottom-right") {
        overlayX = `main_w-overlay_w-${margin}`;
        overlayY = `main_h-overlay_h-${bottomMargin}`;
      } else if (pos === "top-left") {
        overlayX = `${margin}`;
        overlayY = `${topMargin}`;
      } else if (pos === "top-right") {
        overlayX = `main_w-overlay_w-${margin}`;
        overlayY = `${topMargin}`;
      } else if (pos === "bottom-center") {
        overlayX = `(main_w-overlay_w)/2`;
        overlayY = `main_h-overlay_h-${bottomMargin}`;
      }

      // Timing mode: loop vs interval vs custom
      const timingMode = sponsorSettings.timingMode || sponsorSettings.sponsorTimingMode || "loop";
      let enableExpr = "";
      let sponsorAudioGateExpr = null;
      if (timingMode === "interval") {
        const intervalSec = Math.max(10, Number(sponsorSettings.intervalSec || sponsorSettings.sponsorIntervalSec || 60));
        const durSec = Math.max(2, Number(sponsorSettings.durationSec || sponsorSettings.sponsorDurationSec || 10));
        enableExpr = `:enable='lt(mod(t,${intervalSec}),${durSec})'`;
        sponsorAudioGateExpr = `lt(mod(t,${intervalSec}),${durSec})`;
      } else if (timingMode === "custom") {
        const startSec = Math.max(0, Number(sponsorSettings.startSec || sponsorSettings.sponsorStartSec || 0));
        const endSec = Math.max(startSec + 1, Number(sponsorSettings.endSec || sponsorSettings.sponsorEndSec || 15));
        enableExpr = `:enable='between(t,${startSec},${endSec})'`;
        sponsorAudioGateExpr = `between(t,${startSec},${endSec})`;
      }

      filterComplexParts.push(
        `${vCurrent}[sponsor_prepared]overlay=x=${overlayX}:y=${overlayY}:shortest=1${enableExpr}[v_with_sponsor]`
      );
      videoMapArg = "[v_with_sponsor]";

      // Mix sponsor audio only when explicitly unmuted AND sponsor file has an audio stream
      if (!sponsorMuteAudio && sponsorHasAudio) {
        const spVol = Math.max(0.05, Math.min(1.5, Number(sponsorSettings.volume ?? sponsorSettings.sponsorVolume ?? 0.5)));
        const spVolFilter = sponsorAudioGateExpr
          ? `volume=eval=frame:volume='if(${sponsorAudioGateExpr},${spVol.toFixed(2)},0)'`
          : `volume=${spVol.toFixed(2)}`;
        filterComplexParts.push(
          `[${sponsorInputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,${spVolFilter}[sponsor_audio]`,
          `[final_audio][sponsor_audio]amix=inputs=2:duration=first:dropout_transition=0,volume=2,alimiter=limit=0.95[final_audio_with_sponsor]`
        );
        audioMapArg = "[final_audio_with_sponsor]";
      }
    }

    filterComplexParts.forEach((p, idx) => console.log(`[FFmpegService] Part [${idx}] len=${p.length}: ${p.slice(0, 100)}`));
    const fullFilterString = filterComplexParts.join(";");

    // In modern FFmpeg, pass filter complex graph directly to -filter_complex (prevents unrecognized option filter_complex_script error)
    args.push("-filter_complex", fullFilterString);

    args.push("-map", videoMapArg, "-map", audioMapArg);

    const isVideoFiltered = (videoMapArg !== "0:v:0" && videoMapArg !== "[0:v:0]");
    if (!hasBurnableSubs && !hasLogo && !hasSponsor && !isVideoFiltered && !hasCustomCuts) {
      args.push("-c:v", "copy");
    } else {
      if (checkQsvSupport()) {
        args.push("-c:v", "h264_qsv", "-preset", "veryfast", "-async_depth", "4", "-global_quality", "25");
      } else {
        args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-threads", "0");
      }
    }

    args.push(
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      "-shortest"
    );

    if (hasCustomCuts) {
      const cutTotalDuration = validClips.reduce((sum, c) => sum + (Number(c.end) - Number(c.start)), 0);
      if (cutTotalDuration > 0) {
        args.push("-t", cutTotalDuration.toFixed(2));
      }
    }

    const jobId = options.jobId || null;
    const targetDir = path.dirname(outputVideoPath);
    const safeJobId = jobId ? String(jobId).replace(/[^a-zA-Z0-9_-]/g, '_') : Date.now();
    const tempOutputVideoPath = path.join(
      targetDir,
      `.tmp_render_${safeJobId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp4`
    );

    args.push(getSafeCliPath(tempOutputVideoPath));
    if (activeRenderProcess && !activeRenderProcess.killed && !jobId) {
      try {
        console.log("[FFmpegService] 🛑 Aborting previous FFmpeg render process before starting new render...");
        activeRenderProcess.kill("SIGTERM");
      } catch (_) {}
    }
    const cliLength = args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ").length;
    console.log(`[FFmpegService] 📏 Total CLI command length: ${cliLength} characters (Windows max: 32,767)`);
    args.forEach((a, idx) => {
      if (a.length > 200) console.log(`[FFmpegService] ⚠️ Large Arg [${idx}] (${args[idx-1] || ''}): len=${a.length}, start=${a.slice(0, 100)}`);
    });
    let proc;
    try {
      proc = spawn(FFMPEG_PATH, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (spawnErr) {
      console.error(`[FFmpegService] ❌ Failed to spawn FFmpeg process:`, spawnErr);
      if (tempAssPath && fs.existsSync(tempAssPath)) {
        try { fs.unlinkSync(tempAssPath); } catch (_) {}
      }
      if (tempFilterScriptPath && fs.existsSync(tempFilterScriptPath)) {
        try { fs.unlinkSync(tempFilterScriptPath); } catch (_) {}
      }
      return reject(new Error(`FFmpeg Spawn Failed: ${spawnErr.message}`));
    }
    activeRenderProcess = proc;
    const regRecord = { proc, tempOutputPath: tempOutputVideoPath, interrupted: false, paused: false, cancelled: false };
    if (jobId) {
      registerJobRenderRecord(jobId, regRecord);
    }

    if (options.signal) {
      if (options.signal.aborted) {
        try { proc.kill("SIGTERM"); } catch (_) {}
        if (fs.existsSync(tempOutputVideoPath)) {
          try { fs.unlinkSync(tempOutputVideoPath); } catch (_) {}
        }
        if (jobId) unregisterJobRenderRecord(jobId, regRecord);
        const abortErr = new Error("Render cancelled via AbortSignal");
        abortErr.name = "AbortError";
        return reject(abortErr);
      }
      options.signal.addEventListener(
        "abort",
        () => {
          try {
            clearInterval(renderWatchdog);
            regRecord.interrupted = true;
            regRecord.cancelled = true;
            proc.kill("SIGTERM");
          } catch (_) {}
          if (fs.existsSync(tempOutputVideoPath)) {
            try { fs.unlinkSync(tempOutputVideoPath); } catch (_) {}
          }
          if (jobId) unregisterJobRenderRecord(jobId, regRecord);
        },
        { once: true }
      );
    }
    let stderrLog = "";
    let lastActivityTime = Date.now();
    const renderWatchdog = setInterval(() => {
      if (Date.now() - lastActivityTime > 120000 && !regRecord.cancelled && !regRecord.interrupted) {
        clearInterval(renderWatchdog);
        console.error(`[FFmpegService] ⚠️ Render watchdog timeout (no activity for 120s) - killing hanging FFmpeg process...`);
        try {
          proc.kill("SIGKILL");
        } catch (_) {}
      }
    }, 10000);

    proc.stderr.on("data", (data) => {
      lastActivityTime = Date.now();
      const text = data.toString();
      stderrLog += text;
      const timeMatch = text.match(/time=\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/i);
      if (timeMatch) {
        const hh = Number(timeMatch[1]) || 0;
        const mm = Number(timeMatch[2]) || 0;
        const ss = Number(timeMatch[3]) || 0;
        const fracStr = timeMatch[4] || "0";
        const frac = Number("0." + fracStr) || 0;
        const timeSec = hh * 3600 + mm * 60 + ss + frac;
        const timeStr = `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`;
        process.stdout.write(`\r[FFmpegService] ⏳ Rendering: time=${timeStr}`);
        if (onProgress && effectiveExpectedDur > 0) {
          const pct = Math.max(1, Math.min(99, Math.round((timeSec / effectiveExpectedDur) * 100)));
          try {
            onProgress({ percent: pct, timeSec, timeStr });
          } catch (_) {}
        }
      }
    });

    proc.on("close", (code) => {
      clearInterval(renderWatchdog);
      if (jobId) unregisterJobRenderRecord(jobId, regRecord);
      if (activeRenderProcess === proc) activeRenderProcess = null;

      if (tempAssPath && fs.existsSync(tempAssPath)) {
        try { fs.unlinkSync(tempAssPath); } catch (_) {}
      }
      if (tempFilterScriptPath && fs.existsSync(tempFilterScriptPath)) {
        try { fs.unlinkSync(tempFilterScriptPath); } catch (_) {}
      }

      if (regRecord.paused || regRecord.cancelled || regRecord.interrupted) {
        if (fs.existsSync(tempOutputVideoPath)) {
          try { fs.unlinkSync(tempOutputVideoPath); } catch (_) {}
        }
        const err = new Error(regRecord.paused ? "Render paused by user" : "Render cancelled by user");
        err.name = regRecord.paused ? "PauseError" : "AbortError";
        return reject(err);
      }

      if (code === 0 && fs.existsSync(tempOutputVideoPath)) {
        const stat = fs.statSync(tempOutputVideoPath);
        if (stat.size < 1000) {
          try { fs.unlinkSync(tempOutputVideoPath); } catch (_) {}
          return reject(new Error("Rendered video file is invalid or too small (partial output)"));
        }

        if (fs.existsSync(outputVideoPath)) {
          try { fs.unlinkSync(outputVideoPath); } catch (_) {}
        }
        try {
          fs.renameSync(tempOutputVideoPath, outputVideoPath);
        } catch (_) {
          fs.copyFileSync(tempOutputVideoPath, outputVideoPath);
          try { fs.unlinkSync(tempOutputVideoPath); } catch (_) {}
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[FFmpegService] ✅ Render វីដេអូជោគជ័យក្នុង ${elapsed}s ➜ ${outputVideoPath}`);
        resolve({
          success: true,
          outputVideoPath,
          renderTimeSeconds: Number(elapsed),
        });
      } else {
        if (fs.existsSync(tempOutputVideoPath)) {
          try { fs.unlinkSync(tempOutputVideoPath); } catch (_) {}
        }
        const errorLines = stderrLog
          .split(/\r?\n/)
          .filter((line) => /error|invalid|failed|cannot|no such|denied/i.test(line))
          .slice(-5)
          .join(" | ");
        const fallbackExcerpt = stderrLog.slice(-500).trim();
        const displayError = errorLines || fallbackExcerpt || `Process exited with code ${code}`;
        console.error(`[FFmpegService] ❌ Render បរាជ័យ (Code ${code}):\n`, displayError);
        reject(new Error(`ការ Render វីដេអូបរាជ័យ (FFmpeg Exit Code ${code}: ${displayError})`));
      }
    });

    proc.on("error", (err) => {
      clearInterval(renderWatchdog);
      if (jobId) unregisterJobRenderRecord(jobId, regRecord);
      if (activeRenderProcess === proc) activeRenderProcess = null;
      if (fs.existsSync(tempOutputVideoPath)) {
        try { fs.unlinkSync(tempOutputVideoPath); } catch (_) {}
      }
      if (tempAssPath && fs.existsSync(tempAssPath)) {
        try { fs.unlinkSync(tempAssPath); } catch (_) {}
      }
      if (tempFilterScriptPath && fs.existsSync(tempFilterScriptPath)) {
        try { fs.unlinkSync(tempFilterScriptPath); } catch (_) {}
      }
      reject(new Error(`FFmpeg Spawn Error: ${err.message}`));
    });
  });
}

// ============================================================================
// ផ្នែកទី 5: BACKWARD COMPATIBILITY HELPERS (SRT, METADATA, LEGACY RENDER)
// ============================================================================


/**
 * Merge multiple rendered episode MP4 files sequentially into a single Full Video MP4.
 * Uses fast lossless stream-copy concat demuxer when stream signatures match,
 * and falls back automatically to normalized H.264 + AAC filter_complex concat otherwise
 * (with hierarchical batching if > 20 inputs to stay safe under Windows CLI limits).
 */
async function mergeVideosConcat({
  inputVideoPaths = [],
  outputVideoPath,
  targetResolution = null,
  jobId = null,
  signal = null,
  onProgress = null,
} = {}) {
  const validInputs = (Array.isArray(inputVideoPaths) ? inputVideoPaths : []).filter(
    (p) => p && typeof p === "string" && fs.existsSync(p)
  );
  if (validInputs.length === 0) {
    throw new Error("មិនមានឯកសារវីដេអូសម្រាប់តភ្ជាប់ (merge) ទេ!");
  }
  if (!outputVideoPath) {
    throw new Error("outputVideoPath is required for mergeVideosConcat");
  }

  const outDir = path.dirname(outputVideoPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (signal?.aborted) {
    const abortErr = new Error("Merge cancelled via AbortSignal");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  const startTime = Date.now();
  const safeJobId = jobId ? String(jobId).replace(/[^a-zA-Z0-9_-]/g, "_") : Date.now();

  // Single input fast path
  if (validInputs.length === 1) {
    const tmpSingle = path.join(outDir, `.tmp_merge_single_${safeJobId}_${Date.now()}.mp4`);
    fs.copyFileSync(validInputs[0], tmpSingle);
    if (fs.existsSync(outputVideoPath)) {
      try { fs.unlinkSync(outputVideoPath); } catch (_) {}
    }
    try {
      fs.renameSync(tmpSingle, outputVideoPath);
    } catch (_) {
      fs.copyFileSync(tmpSingle, outputVideoPath);
      try { fs.unlinkSync(tmpSingle); } catch (_) {}
    }
    if (typeof onProgress === "function") {
      try { onProgress({ percent: 100, timeSec: 0, timeStr: "00:00:00.00" }); } catch (_) {}
    }
    return {
      success: true,
      outputVideoPath,
      mergedCount: 1,
      fastCopy: true,
      renderTimeSeconds: Number(((Date.now() - startTime) / 1000).toFixed(1)),
    };
  }

  // Probe stream signatures of every input (parallel batches of 8 for fast 45-episode inspection)
  const streamInfos = new Array(validInputs.length);
  const PROBE_BATCH = 8;
  for (let bStart = 0; bStart < validInputs.length; bStart += PROBE_BATCH) {
    const slice = validInputs.slice(bStart, bStart + PROBE_BATCH);
    await Promise.all(
      slice.map(async (filePath, offset) => {
        const info = await getMediaInfo(filePath);
        const vStream = (info.streams || []).find((s) => s.codec_type === "video") || {};
        const aStream = (info.streams || []).find((s) => s.codec_type === "audio") || null;
        const dur = parseFloat(info.format?.duration || vStream.duration || 0) || 0;
        let fps = 30;
        if (vStream.r_frame_rate) {
          const parts = String(vStream.r_frame_rate).split("/");
          if (parts.length === 2 && parseFloat(parts[1]) > 0) {
            fps = parseFloat(parts[0]) / parseFloat(parts[1]);
          }
        }
        streamInfos[bStart + offset] = {
          filePath,
          width: Number(vStream.width) || 0,
          height: Number(vStream.height) || 0,
          videoCodec: vStream.codec_name || "",
          pixFmt: vStream.pix_fmt || "",
          fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
          timeBase: vStream.time_base || "",
          hasAudio: Boolean(aStream && aStream.codec_name),
          audioCodec: aStream?.codec_name || "",
          sampleRate: Number(aStream?.sample_rate) || 0,
          channels: Number(aStream?.channels) || 0,
          durationSec: dur,
        };
      })
    );
  }

  const totalDurationSec = streamInfos.reduce((sum, m) => sum + (m.durationSec || 0), 0);
  const first = streamInfos[0];

  const allSameForFastCopy =
    first.width > 0 &&
    first.height > 0 &&
    first.hasAudio &&
    streamInfos.every(
      (m) =>
        m.width === first.width &&
        m.height === first.height &&
        m.videoCodec === first.videoCodec &&
        m.pixFmt === first.pixFmt &&
        m.hasAudio &&
        m.audioCodec === first.audioCodec &&
        m.sampleRate === first.sampleRate &&
        m.channels === first.channels &&
        Math.abs(m.fps - first.fps) <= 1.5
    );

  const runFfmpegProcess = (args, tempOutPath, expectedDur) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const abortErr = new Error("Merge cancelled via AbortSignal");
        abortErr.name = "AbortError";
        return reject(abortErr);
      }

      const proc = spawn(FFMPEG_PATH, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });

      const regRecord = { proc, tempOutputPath: tempOutPath, interrupted: false, paused: false, cancelled: false };
      if (jobId) {
        registerJobRenderRecord(jobId, regRecord);
      }

      const onAbort = () => {
        try {
          regRecord.interrupted = true;
          regRecord.cancelled = true;
          proc.kill("SIGTERM");
        } catch (_) {}
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      let stderrLog = "";
      proc.stderr.on("data", (data) => {
        const text = data.toString();
        stderrLog += text;
        const timeMatch = text.match(/time=\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/i);
        if (timeMatch && typeof onProgress === "function" && expectedDur > 0) {
          const hh = Number(timeMatch[1]) || 0;
          const mm = Number(timeMatch[2]) || 0;
          const ss = Number(timeMatch[3]) || 0;
          const fracStr = timeMatch[4] || "0";
          const frac = Number("0." + fracStr) || 0;
          const timeSec = hh * 3600 + mm * 60 + ss + frac;
          const pct = Math.max(1, Math.min(99, Math.round((timeSec / expectedDur) * 100)));
          const timeStr = `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`;
          try {
            onProgress({ percent: pct, timeSec, timeStr });
          } catch (_) {}
        }
      });

      proc.on("close", (code) => {
        if (signal) {
          try { signal.removeEventListener("abort", onAbort); } catch (_) {}
        }
        if (jobId) unregisterJobRenderRecord(jobId, regRecord);

        if (regRecord.paused || regRecord.cancelled || regRecord.interrupted) {
          if (fs.existsSync(tempOutPath)) {
            try { fs.unlinkSync(tempOutPath); } catch (_) {}
          }
          const err = new Error("Merge cancelled by user");
          err.name = "AbortError";
          return reject(err);
        }

        if (code === 0 && fs.existsSync(tempOutPath)) {
          const stat = fs.statSync(tempOutPath);
          if (stat.size < 1000) {
            try { fs.unlinkSync(tempOutPath); } catch (_) {}
            return reject(new Error("Merged video file is invalid or too small"));
          }
          resolve(tempOutPath);
        } else {
          if (fs.existsSync(tempOutPath)) {
            try { fs.unlinkSync(tempOutPath); } catch (_) {}
          }
          const errLines = stderrLog
            .split(/\r?\n/)
            .filter((line) => /error|invalid|failed|cannot|no such|denied/i.test(line))
            .slice(-5)
            .join(" | ");
          reject(new Error(`FFmpeg merge failed (code ${code}): ${errLines || stderrLog.slice(-400)}`));
        }
      });

      proc.on("error", (err) => {
        if (signal) {
          try { signal.removeEventListener("abort", onAbort); } catch (_) {}
        }
        if (jobId) unregisterJobRenderRecord(jobId, regRecord);
        if (fs.existsSync(tempOutPath)) {
          try { fs.unlinkSync(tempOutPath); } catch (_) {}
        }
        reject(err);
      });
    });

  // Helper to commit temp output atomically
  const finalizeOutput = (tmpPath, fastCopyUsed) => {
    if (fs.existsSync(outputVideoPath)) {
      try { fs.unlinkSync(outputVideoPath); } catch (_) {}
    }
    try {
      fs.renameSync(tmpPath, outputVideoPath);
    } catch (_) {
      fs.copyFileSync(tmpPath, outputVideoPath);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
    if (typeof onProgress === "function") {
      try { onProgress({ percent: 100, timeSec: totalDurationSec, timeStr: "done" }); } catch (_) {}
    }
    const elapsed = Number(((Date.now() - startTime) / 1000).toFixed(1));
    console.log(`[FFmpegService] ✅ Merged ${validInputs.length} videos (${fastCopyUsed ? "fast stream copy" : "normalized re-encode"}) in ${elapsed}s ➜ ${outputVideoPath}`);
    return {
      success: true,
      outputVideoPath,
      mergedCount: validInputs.length,
      fastCopy: fastCopyUsed,
      renderTimeSeconds: elapsed,
    };
  };

  // Attempt 1: Fast lossless concat demuxer when streams match cleanly
  if (allSameForFastCopy) {
    const listPath = path.join(outDir, `.tmp_concat_list_${safeJobId}_${Date.now()}.txt`);
    const tempFastOut = path.join(outDir, `.tmp_merge_fast_${safeJobId}_${Date.now()}.mp4`);
    try {
      const listContent = validInputs
        .map((p) => {
          const safeSrc = path.resolve(p).replace(/\\/g, "/").replace(/'/g, "'\\''");
          return `file '${safeSrc}'`;
        })
        .join("\n");
      fs.writeFileSync(listPath, listContent, "utf8");

      const args = [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", getSafeCliPath(listPath),
        "-c", "copy",
        "-movflags", "+faststart",
        getSafeCliPath(tempFastOut),
      ];
      await runFfmpegProcess(args, tempFastOut, totalDurationSec);
      const outDur = await getMediaDuration(tempFastOut).catch(() => 0);
      if (outDur > 0) {
        return finalizeOutput(tempFastOut, true);
      }
    } catch (fastErr) {
      if (fastErr?.name === "AbortError") throw fastErr;
      console.warn(`[FFmpegService] Fast concat copy fallback triggered (${fastErr.message}). Re-encoding cleanly...`);
      if (fs.existsSync(tempFastOut)) {
        try { fs.unlinkSync(tempFastOut); } catch (_) {}
      }
    } finally {
      if (fs.existsSync(listPath)) {
        try { fs.unlinkSync(listPath); } catch (_) {}
      }
    }
  }

  // Attempt 2: Normalized filter_complex concat (handles mixed resolutions/fps/audio, batched if > 20)
  const rawW = Number(targetResolution?.width) || first.width || 1920;
  const rawH = Number(targetResolution?.height) || first.height || 1080;
  const targetW = rawW % 2 === 0 ? rawW : rawW + 1;
  const targetH = rawH % 2 === 0 ? rawH : rawH + 1;
  const targetFps = Math.max(15, Math.min(60, Math.round(first.fps || 30)));

  const concatBatchDirect = async (batchInfos, batchOutPath, batchDur) => {
    const args = ["-y"];
    const filterParts = [];
    const pairLabels = [];

    batchInfos.forEach((info, idx) => {
      args.push("-i", getSafeCliPath(info.filePath));
      filterParts.push(
        `[${idx}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps},format=yuv420p[v${idx}]`
      );
      if (info.hasAudio) {
        filterParts.push(
          `[${idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,aresample=async=1[a${idx}]`
        );
      } else {
        const silentDur = Math.max(0.1, info.durationSec || 1).toFixed(3);
        filterParts.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${silentDur}[a${idx}]`
        );
      }
      pairLabels.push(`[v${idx}][a${idx}]`);
    });

    filterParts.push(`${pairLabels.join("")}concat=n=${batchInfos.length}:v=1:a=1[outv][outa]`);

    args.push("-filter_complex", filterParts.join(";"), "-map", "[outv]", "-map", "[outa]");
    if (checkQsvSupport()) {
      args.push("-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "23");
    } else {
      args.push("-c:v", "libx264", "-preset", "superfast", "-crf", "22", "-threads", "0");
    }
    args.push("-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", getSafeCliPath(batchOutPath));

    await runFfmpegProcess(args, batchOutPath, batchDur);
    return batchOutPath;
  };

  const MAX_DIRECT_INPUTS = 16;
  const tempMergeOut = path.join(outDir, `.tmp_merge_norm_${safeJobId}_${Date.now()}.mp4`);

  if (streamInfos.length <= MAX_DIRECT_INPUTS) {
    await concatBatchDirect(streamInfos, tempMergeOut, totalDurationSec);
    return finalizeOutput(tempMergeOut, false);
  }

  // Hierarchical chunked normalization -> fast concat of normalized chunks (Windows CLI safe)
  const intermediateChunks = [];
  try {
    for (let start = 0; start < streamInfos.length; start += MAX_DIRECT_INPUTS) {
      const slice = streamInfos.slice(start, start + MAX_DIRECT_INPUTS);
      const chunkDur = slice.reduce((sum, m) => sum + (m.durationSec || 0), 0);
      const chunkPath = path.join(outDir, `.tmp_merge_chunk_${safeJobId}_${start}_${Date.now()}.mp4`);
      await concatBatchDirect(slice, chunkPath, chunkDur);
      intermediateChunks.push(chunkPath);
    }

    const chunkListPath = path.join(outDir, `.tmp_concat_chunks_${safeJobId}_${Date.now()}.txt`);
    try {
      const listBody = intermediateChunks
        .map((p) => `file '${path.resolve(p).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
        .join("\n");
      fs.writeFileSync(chunkListPath, listBody, "utf8");
      await runFfmpegProcess(
        ["-y", "-f", "concat", "-safe", "0", "-i", getSafeCliPath(chunkListPath), "-c", "copy", "-movflags", "+faststart", getSafeCliPath(tempMergeOut)],
        tempMergeOut,
        totalDurationSec
      );
    } finally {
      if (fs.existsSync(chunkListPath)) {
        try { fs.unlinkSync(chunkListPath); } catch (_) {}
      }
    }

    return finalizeOutput(tempMergeOut, false);
  } finally {
    for (const cp of intermediateChunks) {
      if (fs.existsSync(cp)) {
        try { fs.unlinkSync(cp); } catch (_) {}
      }
    }
  }
}


async function renderDubbedVideoWithAdsAssembly(options = {}) {
  const inputVideoPath = options.inputVideoPath || options.videoPath;
  const outputVideoPath = options.outputVideoPath || options.outputPath;
  const outDir = outputVideoPath ? path.dirname(outputVideoPath) : os.tmpdir();
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let storyDur = Number(options.expectedDurationSec) || 0;
  if (!storyDur && inputVideoPath && fs.existsSync(inputVideoPath)) {
    try { storyDur = await getMediaDuration(inputVideoPath); } catch (_) {}
  }

  const { videoClips: effectiveClips, segments: effectiveSegments } = applyPlacementAdToTimeline({
    videoClips: options.videoClips || [],
    segments: options.segments || [],
    videoAdSettings: options.videoAdSettings || null,
    storyDurationSec: storyDur,
  });

  const plan = buildStoryAndAdAssemblyPlan(effectiveClips, effectiveSegments);
  if (!plan.hasAds) {
    return renderDubbedVideoWithDucking({
      ...options,
      videoClips: effectiveClips,
      segments: effectiveSegments,
      __bypassVideoAds: true,
    });
  }

  const startTime = Date.now();
  const stamp = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tempFiles = [];
  const tmpStoryPath = path.join(outDir, `.tmp_story_ads_${stamp}.mp4`);
  tempFiles.push(tmpStoryPath);

  const runSimpleFfmpeg = (ffArgs, targetPath) =>
    new Promise((res, rej) => {
      const child = spawn(FFMPEG_PATH, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...ffArgs, targetPath], {
        windowsHide: true,
      });
      if (options.signal) attachAbortKill(child, options.signal);
      let stderr = "";
      child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-1500); });
      child.once("error", rej);
      child.once("close", (code) => (code === 0 ? res(targetPath) : rej(new Error(stderr || `FFmpeg exited ${code}`))));
    });

  try {
    // 1. Render dubbed story timeline (without ads)
    await renderDubbedVideoWithDucking({
      ...options,
      outputVideoPath: tmpStoryPath,
      videoClips: plan.storyClips,
      segments: plan.storySegments,
      expectedDurationSec: plan.storyDurationSec || storyDur,
      __bypassVideoAds: true,
    });

    // 2. Inspect rendered story dimensions & fps so ads match 1:1
    const storyInfo = await getMediaInfo(tmpStoryPath);
    const vStream = (storyInfo.streams || []).find((s) => s.codec_type === "video") || {};
    const targetW = Number(vStream.width) || 1920;
    const targetH = Number(vStream.height) || 1080;
    let targetFps = 30;
    if (vStream.r_frame_rate) {
      const p = String(vStream.r_frame_rate).split("/");
      if (p.length === 2 && Number(p[1]) > 0) targetFps = Math.round((Number(p[0]) / Number(p[1])) * 100) / 100 || 30;
    }

    const piecePaths = [];
    for (let i = 0; i < plan.assembly.length; i++) {
      const item = plan.assembly[i];
      const piecePath = path.join(outDir, `.tmp_piece_${stamp}_${i}.mp4`);
      tempFiles.push(piecePath);

      if (item.type === "story") {
        const dur = Math.max(0.05, Number(item.storyEnd) - Number(item.storyStart));
        await runSimpleFfmpeg([
          "-ss", Number(item.storyStart).toFixed(3),
          "-i", getSafeCliPath(tmpStoryPath),
          "-t", dur.toFixed(3),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
          "-movflags", "+faststart",
        ], piecePath);
        piecePaths.push(piecePath);
      } else if (item.type === "ad") {
        const adMeta = await getMediaInfo(item.adPath).catch(() => ({ streams: [] }));
        const adHasAudio = Boolean((adMeta.streams || []).some((s) => s.codec_type === "audio"));
        const adVol = item.isMuted ? 0 : Math.max(0, Math.min(2.0, Number(item.adVolume ?? 1.0)));
        const durStr = Math.max(0.05, Number(item.duration)).toFixed(3);
        const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps},format=yuv420p`;

        const ffArgs = ["-ss", Number(item.sourceStart || 0).toFixed(3), "-i", getSafeCliPath(item.adPath)];
        if (!adHasAudio || adVol <= 0.001) {
          ffArgs.push(
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-map", "0:v:0", "-map", "1:a:0",
            "-t", durStr,
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
            "-shortest"
          );
        } else {
          ffArgs.push(
            "-map", "0:v:0", "-map", "0:a:0",
            "-t", durStr,
            "-vf", vf,
            "-af", `aformat=sample_rates=44100:channel_layouts=stereo,volume=${adVol.toFixed(3)},apad`,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"
          );
        }
        await runSimpleFfmpeg(ffArgs, piecePath);
        piecePaths.push(piecePath);
      }
    }

    await mergeVideosConcat({
      inputVideoPaths: piecePaths,
      outputVideoPath,
      targetResolution: { width: targetW, height: targetH },
      jobId: options.jobId,
      signal: options.signal,
    });

    return {
      success: true,
      outputVideoPath,
      hasVideoAds: true,
      renderTimeSeconds: Number(((Date.now() - startTime) / 1000).toFixed(1)),
    };
  } finally {
    for (const f of tempFiles) {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
  }
}

module.exports = {
  FFMPEG_PATH,
  FFPROBE_PATH,
  getOrCreateVideoThumbnails,
  checkQsvSupport,
  splitVideoIntoEpisodes,
  applyInnerThoughtAudioEffect,
  extractFramesAtTimestamps,
  extractFramesStreaming,
  extractSubtitleDifferenceGrid,
  detectSubtitleChangePoints,
  getMediaDuration,
  buildAtempoFilter,
  trimTtsSilence,
  autoStretchTtsAudio,
  applyExactAudioSpeed,
  hexToAssColor,
  formatSecondsToAssTime,
  sanitizeKhmerSubtitleText,
  resolveAssSubtitleLayoutDefaults,
  resolveRenderAspectRatio,
  SUBTITLE_SIZE_SCALE_MAP,
  generateKhmerAssSubtitleFile,
  buildAssSubtitleVideoFilter,
  buildVerticalVideoFilterChain,
  buildCornerBlurVideoFilterChain,
  computeAntiTheftRibbonLayout,
  buildAntiTheftBlurVideoFilterChain,
  normalizeYoutubeTransform,
  buildYoutubeTransformVideoFilterChain,
  buildDynamicDuckingFilter,
  renderDubbedVideoWithDucking,
  mergeVideosConcat,
  mergeTimeIntervals,
  extractAudio,
  toSrtTime,
  parseTimeToSec,
  extractValidTimestamp,
  resolveSegmentStartSec,
  computeAdaptiveCrossfadeDuration,
  computeOverlapCrossfadePlan,
  buildSegmentMixFilterChain,
  generateSrtFile,
  createSynchronizedNarrationAudio,
  getMediaInfo,
  getVideoMetadata,
  getVideoDimensionsFast,
  getSafeCliPath,
  detectSpeechBounds,
  cancelJobRenderProcess,
  pauseJobRenderProcess,
};
