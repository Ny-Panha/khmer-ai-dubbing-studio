const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { createAbortError } = require("../../utils/asyncSemaphore");
const { parseTimeToSec, toSrtTime } = require("../../models/timestampUtils");
const {
  FFMPEG_PATH,
  ffmpeg,
  getSafeCliPath,
  getMediaDuration,
} = require("./ffmpegProbeAndFrames");


function buildAtempoFilter(speedFactor) {
  const filters = [];
  let remaining = speedFactor;

  while (remaining > 2.0) {
    filters.push("atempo=2.0");
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }

  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(",");
}

/**
 * Detect silence and speech boundaries in an audio file
 * @param {string} filePath
 * @param {string} [noiseThreshold="-50dB"]
 * @param {number} [minSilenceDuration=0.03]
 * @returns {Promise<{ totalDur: number, leadingSilence: number, tailSilence: number, hasSpeech: boolean }>}
 */
function detectSpeechBounds(filePath, noiseThreshold = "-50dB", minSilenceDuration = 0.03) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return resolve({ totalDur: 0, leadingSilence: 0, tailSilence: 0, hasSpeech: false });
    }
    const safePath = getSafeCliPath(filePath);
    const proc = spawn(FFMPEG_PATH, [
      "-i", safePath,
      "-af", `silencedetect=noise=${noiseThreshold}:d=${minSilenceDuration}`,
      "-f", "null", "-"
    ]);
    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", () => {
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):([0-9.]+)/);
      let totalDur = 0;
      if (durMatch) {
        totalDur = parseFloat(durMatch[1]) * 3600 + parseFloat(durMatch[2]) * 60 + parseFloat(durMatch[3]);
      }
      // Parse all silence events sequentially:
      const silenceBlocks = [];
      const lines = stderr.split('\n');
      let currentSilenceStart = null;

      for (const line of lines) {
        const startMatch = line.match(/silence_start:\s*([0-9.-]+)/);
        if (startMatch) {
          currentSilenceStart = parseFloat(startMatch[1]);
        }
        const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
        if (endMatch) {
          const end = parseFloat(endMatch[1]);
          const dur = parseFloat(endMatch[2]);
          const start = currentSilenceStart !== null ? currentSilenceStart : Math.max(0, end - dur);
          silenceBlocks.push({ start, end, dur });
          currentSilenceStart = null;
        }
      }

      // Leading silence ONLY if the silence block started at or near 0 (<= 0.05s)
      let leadingSilence = 0;
      if (silenceBlocks.length > 0 && silenceBlocks[0].start <= 0.05) {
        leadingSilence = silenceBlocks[0].end;
      }

      // Tail silence is the start of the last silence block if it ends near file duration
      let tailSilence = totalDur;
      if (silenceBlocks.length > 0) {
        const lastBlock = silenceBlocks[silenceBlocks.length - 1];
        if (lastBlock.end >= totalDur - 0.10 && lastBlock.start > leadingSilence) {
          tailSilence = lastBlock.start;
        }
      }

      resolve({
        totalDur: Number(totalDur.toFixed(3)),
        duration: Number(totalDur.toFixed(3)),
        leadingSilence: Number(leadingSilence.toFixed(3)),
        speechStart: Number(leadingSilence.toFixed(3)),
        tailSilence: Number(tailSilence.toFixed(3)),
        speechEnd: Number(tailSilence.toFixed(3)),
        hasSpeech: totalDur > 0 && (totalDur - leadingSilence) > 0.05,
      });
    });
    proc.on("error", () => {
      resolve({ totalDur: 0, duration: 0, leadingSilence: 0, speechStart: 0, tailSilence: 0, speechEnd: 0, hasSpeech: false });
    });
  });
}

/**
 * Strip dead leading & trailing Edge TTS padding silence from any generated TTS clip
 * while preserving a crisp 25ms acoustic cushion for initial aspirated Khmer consonants
 * (ក ខ ច ឆ ត ថ ប ផ ស) and 60ms trailing decay.
 */
async function trimTtsSilence(
  inputAudioPath,
  {
    leadInCushionSec = 0.025,
    leadOutCushionSec = 0.060,
    microFadeMs = 8,
    minLeadingSilenceToTrimSec = 0.060,
    minTrailingSilenceToTrimSec = 0.140,
    noiseThreshold = "-45dB",
  } = {}
) {
  if (!inputAudioPath || !fs.existsSync(inputAudioPath)) {
    throw new Error(`រកមិនឃើញ File សំឡេង TTS៖ ${inputAudioPath}`);
  }

  const bounds = await detectSpeechBounds(inputAudioPath, noiseThreshold, 0.02);
  const totalDur = bounds.totalDur || (await getMediaDuration(inputAudioPath));
  if (!totalDur || totalDur <= 0.25 || !bounds.hasSpeech) {
    return {
      outputPath: inputAudioPath,
      trimmed: false,
      trimmedLeadSec: 0,
      originalDuration: totalDur || 0,
      finalDuration: totalDur || 0,
      leadInSec: bounds.leadingSilence || 0,
    };
  }

  let safeStart = 0;
  if (bounds.leadingSilence > minLeadingSilenceToTrimSec) {
    safeStart = Math.max(0, parseFloat((bounds.leadingSilence - leadInCushionSec).toFixed(3)));
  }

  let safeEnd = totalDur;
  if (bounds.tailSilence > safeStart + 0.15 && (totalDur - bounds.tailSilence) > minTrailingSilenceToTrimSec) {
    safeEnd = Math.min(totalDur, parseFloat((bounds.tailSilence + leadOutCushionSec).toFixed(3)));
  }

  const needsTrim = (safeStart > 0.015 || safeEnd < totalDur - 0.050) && (safeEnd > safeStart + 0.20);
  if (!needsTrim) {
    return {
      outputPath: inputAudioPath,
      trimmed: false,
      trimmedLeadSec: 0,
      originalDuration: totalDur,
      finalDuration: totalDur,
      leadInSec: bounds.leadingSilence,
    };
  }

  const dir = path.dirname(inputAudioPath);
  const ext = path.extname(inputAudioPath);
  const base = path.basename(inputAudioPath, ext);
  const tempTrimPath = path.join(dir, `.tmp_trim_${base}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);

  const fadeSec = (microFadeMs / 1000).toFixed(3);
  const clippedDur = Math.max(0.1, safeEnd - safeStart);
  const fadeOutStart = Math.max(0, clippedDur - microFadeMs / 1000).toFixed(3);

  const trimOk = await new Promise((resolve) => {
    const trimArgs = [
      "-y",
      "-i", getSafeCliPath(inputAudioPath),
      "-af", `atrim=start=${safeStart.toFixed(3)}:end=${safeEnd.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeSec},afade=t=out:st=${fadeOutStart}:d=${fadeSec}`,
      "-c:a", "libmp3lame",
      "-q:a", "2",
      getSafeCliPath(tempTrimPath),
    ];
    const p = spawn(FFMPEG_PATH, trimArgs, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    if (p.stderr) p.stderr.on("data", () => {});
    p.on("close", (code) => {
      try {
        resolve(code === 0 && fs.existsSync(tempTrimPath) && fs.statSync(tempTrimPath).size >= 250);
      } catch (_) {
        resolve(false);
      }
    });
    p.on("error", () => resolve(false));
  });

  if (!trimOk) {
    try { if (fs.existsSync(tempTrimPath)) fs.unlinkSync(tempTrimPath); } catch (_) {}
    return {
      outputPath: inputAudioPath,
      trimmed: false,
      trimmedLeadSec: 0,
      originalDuration: totalDur,
      finalDuration: totalDur,
      leadInSec: bounds.leadingSilence,
    };
  }

  try {
    if (fs.existsSync(inputAudioPath)) {
      fs.unlinkSync(inputAudioPath);
    }
    fs.renameSync(tempTrimPath, inputAudioPath);
  } catch (_) {
    try {
      fs.copyFileSync(tempTrimPath, inputAudioPath);
    } finally {
      try { if (fs.existsSync(tempTrimPath)) fs.unlinkSync(tempTrimPath); } catch (_) {}
    }
  }

  const finalDuration = (await getMediaDuration(inputAudioPath)) || totalDur;
  return {
    outputPath: inputAudioPath,
    trimmed: true,
    trimmedLeadSec: safeStart,
    originalDuration: totalDur,
    finalDuration,
    leadInSec: Number(Math.max(0, bounds.leadingSilence - safeStart).toFixed(3)),
  };
}

/**
 * Auto Time-Stretch TTS Audio to fit timeline segment duration.
 * PRESERVES 100% of the initial consonant and syllable:
 * - Guarantees a 25ms+ acoustic lead-in cushion before speech onset.
 * - If natural leading silence <= 60ms, does NOT trim the start at all.
 * - Trims excessive trailing dead silence (Edge TTS tail silence) with a 60ms decay cushion.
 * - Applies atempo only if required, maintaining timeline sync and zero audio clipping.
 */
async function autoStretchTtsAudio({
  inputAudioPath,
  targetDuration,
  maxSpeed = 1.50,
  minSpeed = 0.95,
  leadInCushionSec = 0.025,  // 25ms lead-in: eliminates Edge TTS +220ms lag while protecting Khmer aspirated consonants (ក ខ ច ឆ ត ថ ប ផ ស)
  leadOutCushionSec = 0.060, // 60ms decay cushion protects final syllable and tail consonants
  microFadeMs = 8,           // 8ms micro-fade within silence cushion to eliminate boundary clicks
  allowSlowdown = false,     // Only allow stretching down if explicitly requested (e.g. for mouth sync, never when fitting slot)
  isPreTrimmed = false,
  currentDuration = null,
}) {
  if (!fs.existsSync(inputAudioPath)) {
    throw new Error(`រកមិនឃើញ File សំឡេង TTS៖ ${inputAudioPath}`);
  }

  const dir = path.dirname(inputAudioPath);
  const ext = path.extname(inputAudioPath);
  const base = path.basename(inputAudioPath, ext);
  const trimmedPath = path.join(dir, `${base}_trimmed${ext}`);
  const stretchedPath = path.join(dir, `${base}_synced${ext}`);

  let activeSourcePath = inputAudioPath;
  let actualDuration;
  let leadingSilence = 0;
  let safeStart = 0;

  if (isPreTrimmed && typeof currentDuration === 'number' && currentDuration > 0) {
    actualDuration = currentDuration;
  } else {
    // 1. Measure natural speech boundaries using conservative threshold
    const bounds = await detectSpeechBounds(inputAudioPath, "-50dB", 0.03);
    const totalDur = bounds.totalDur || (await getMediaDuration(inputAudioPath));
    leadingSilence = bounds.leadingSilence || 0;

    // Determine safe trim boundaries that strictly PRESERVE speech onset:
    if (bounds.leadingSilence > 0.060) {
      safeStart = Math.max(0, parseFloat((bounds.leadingSilence - leadInCushionSec).toFixed(3)));
    }

    // Trim trailing dead silence while keeping leadOutCushionSec of room decay
    let safeEnd = totalDur;
    if (bounds.tailSilence > 0 && totalDur - bounds.tailSilence > 0.12) {
      safeEnd = Math.min(totalDur, bounds.tailSilence + leadOutCushionSec);
    }

    const needsTrim = safeStart > 0.02 || (safeEnd > 0 && safeEnd < totalDur - 0.05);

    if (needsTrim && safeEnd > safeStart + 0.2) {
      await new Promise((resolve) => {
        const trimArgs = [
          "-y",
          "-i", getSafeCliPath(inputAudioPath),
          "-af", `atrim=start=${safeStart.toFixed(3)}:end=${safeEnd.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${(microFadeMs / 1000).toFixed(3)},afade=t=out:st=${Math.max(0, (safeEnd - safeStart) - (microFadeMs / 1000)).toFixed(3)}:d=${(microFadeMs / 1000).toFixed(3)}`,
          "-c:a", "libmp3lame",
          "-q:a", "2",
          getSafeCliPath(trimmedPath),
        ];
        const p = spawn(FFMPEG_PATH, trimArgs);
        p.on("close", (code) => {
          if (code === 0 && fs.existsSync(trimmedPath)) {
            activeSourcePath = trimmedPath;
            resolve(true);
          } else {
            resolve(false);
          }
        });
        p.on("error", () => resolve(false));
      });
    }

    actualDuration = await getMediaDuration(activeSourcePath);
  }

  if (!actualDuration || !targetDuration || targetDuration <= 0.2) {
    if (activeSourcePath !== inputAudioPath && fs.existsSync(trimmedPath)) {
      try {
        fs.renameSync(trimmedPath, inputAudioPath);
      } catch (_) {}
    }
    return {
      outputPath: inputAudioPath,
      originalDuration: actualDuration,
      finalDuration: actualDuration,
      appliedSpeed: 1.0,
      leadInSec: Number((leadingSilence - safeStart).toFixed(3)),
      effectiveLeadInCushionSec: Number((leadingSilence - safeStart).toFixed(3)),
    };
  }

  // 2. Compute speed ratio to fit targetDuration
  // 2. Compute speed ratio to fit targetDuration (No silent 5% deadband)
  let appliedSpeed = 1.0;
  if (actualDuration > targetDuration) {
    const rawRatio = actualDuration / targetDuration;
    // Accelerate immediately whenever audio exceeds slot (up to maxSpeed 1.35x)
    appliedSpeed = Math.min(rawRatio, maxSpeed);
  } else if (allowSlowdown && actualDuration < targetDuration * 0.85) {
    const rawRatio = actualDuration / targetDuration;
    appliedSpeed = Math.max(rawRatio, minSpeed);
  }

  // Only bypass stretching if appliedSpeed is 1.0 and audio is fully within targetDuration
  if (Math.abs(appliedSpeed - 1.0) <= 0.005 && actualDuration <= targetDuration) {
    if (activeSourcePath !== inputAudioPath && fs.existsSync(trimmedPath)) {
      try {
        fs.renameSync(trimmedPath, inputAudioPath);
      } catch (_) {}
    }
    return {
      outputPath: inputAudioPath,
      originalDuration: actualDuration,
      finalDuration: actualDuration,
      appliedSpeed: 1.0,
      leadInSec: Number((leadingSilence - safeStart).toFixed(3)),
      effectiveLeadInCushionSec: Number((leadingSilence - safeStart).toFixed(3)),
    };
  }

  // 3. Apply FFmpeg atempo filter
  const atempoFilter = buildAtempoFilter(appliedSpeed);

  await new Promise((resolve, reject) => {
    const stretchArgs = [
      "-y",
      "-i", getSafeCliPath(activeSourcePath),
      "-filter:a", atempoFilter,
      "-c:a", "libmp3lame",
      "-q:a", "2",
      getSafeCliPath(stretchedPath),
    ];

    const proc = spawn(FFMPEG_PATH, stretchArgs);
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(stretchedPath)) {
        resolve();
      } else {
        reject(new Error(`FFmpeg atempo failed (Code ${code})`));
      }
    });
    proc.on("error", reject);
  });

  try {
    fs.renameSync(stretchedPath, inputAudioPath);
  } catch (renameErr) {
    fs.copyFileSync(stretchedPath, inputAudioPath);
    try { fs.unlinkSync(stretchedPath); } catch (_) {}
  }
  if (fs.existsSync(trimmedPath)) {
    try { fs.unlinkSync(trimmedPath); } catch (_) {}
  }

  const finalDuration = isPreTrimmed
    ? parseFloat((actualDuration / appliedSpeed).toFixed(3))
    : ((await getMediaDuration(inputAudioPath)) || parseFloat((actualDuration / appliedSpeed).toFixed(3)));

  console.log(
    `[FFmpegService] 🎚️ Auto-Stretch: ${actualDuration.toFixed(2)}s ➜ ${finalDuration.toFixed(2)}s (Target: ${targetDuration.toFixed(2)}s | Speed: ${appliedSpeed.toFixed(2)}x | Lead-in Cushion: ${((leadingSilence - safeStart) * 1000).toFixed(0)}ms)`
  );

  return {
    outputPath: inputAudioPath,
    originalDuration: actualDuration,
    finalDuration: finalDuration,
    appliedSpeed: Number(appliedSpeed.toFixed(2)),
    leadInSec: Number((leadingSilence - safeStart).toFixed(3)),
    effectiveLeadInCushionSec: Number(((leadingSilence - safeStart) / appliedSpeed).toFixed(3)),
  };
}

/**
 * Applies an EXACT mathematical audio speed multiplier via FFmpeg `atempo` (single pass on natural 1.0x TTS).
 * Guarantees measured output duration = inputDuration / speedFactor within <1% without Edge TTS prosody drift
 * and without stacking TTS rate + atempo.
 */
async function applyExactAudioSpeed(inputAudioPath, speedFactor = 1.0) {
  if (!inputAudioPath || !fs.existsSync(inputAudioPath)) {
    throw new Error(`Audio file not found for exact speed scaling: ${inputAudioPath}`);
  }
  const parsed = Number(speedFactor);
  const targetSpeed = Number.isFinite(parsed) ? Math.max(0.5, Math.min(4.0, parsed)) : 1.0;
  const originalDuration = await getMediaDuration(inputAudioPath);

  if (Math.abs(targetSpeed - 1.0) <= 0.001) {
    return {
      outputPath: inputAudioPath,
      originalDuration,
      finalDuration: originalDuration,
      appliedSpeed: 1.0,
    };
  }

  const ext = path.extname(inputAudioPath) || ".mp3";
  const baseName = path.basename(inputAudioPath, ext);
  const dirName = path.dirname(inputAudioPath);
  const rand = Math.random().toString(36).slice(2, 7);
  const scaledPath = path.join(dirName, `.tmp_speed_${baseName}_${Date.now()}_${rand}${ext}`);
  const atempoFilter = buildAtempoFilter(targetSpeed);

  await new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i", getSafeCliPath(inputAudioPath),
      "-filter:a", atempoFilter,
      "-c:a", "libmp3lame",
      "-q:a", "2",
      getSafeCliPath(scaledPath),
    ];
    const proc = spawn(FFMPEG_PATH, args);
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(scaledPath)) {
        resolve();
      } else {
        try { if (fs.existsSync(scaledPath)) fs.unlinkSync(scaledPath); } catch (_) {}
        reject(new Error(`FFmpeg exact atempo (${targetSpeed}x) failed with code ${code}`));
      }
    });
    proc.on("error", reject);
  });

  try {
    fs.renameSync(scaledPath, inputAudioPath);
  } catch (_) {
    fs.copyFileSync(scaledPath, inputAudioPath);
    try { fs.unlinkSync(scaledPath); } catch (_) {}
  }

  const finalDuration = await getMediaDuration(inputAudioPath);
  console.log(
    `[FFmpegService] 🎚️ Exact Clip Speed: ${originalDuration.toFixed(3)}s ➜ ${finalDuration.toFixed(3)}s (atempo=${targetSpeed.toFixed(4)}x | expected=${(originalDuration / targetSpeed).toFixed(3)}s)`
  );

  return {
    outputPath: inputAudioPath,
    originalDuration,
    finalDuration,
    appliedSpeed: Number(targetSpeed.toFixed(4)),
  };
}

// ============================================================================
// ផ្នែកទី 3: KHMER .ASS SUBTITLE GENERATOR (UTF-8 BOM + NFC Shaping)
// ============================================================================

/**
 * Merges overlapping or nearby time intervals to prevent ducking chatter
 * and dramatically shorten the FFmpeg complex filter command line string on Windows.
 */
function mergeTimeIntervals(rawIntervals, mergeGap = 0.3) {
  if (!rawIntervals || rawIntervals.length === 0) return [];
  const sorted = rawIntervals
    .map((iv) => ({ start: Math.max(0, Number(iv.start)), end: Math.max(0, Number(iv.end)) }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return [];

  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= prev.end + mergeGap) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push({ start: curr.start, end: curr.end });
    }
  }
  return merged;
}


function buildDynamicDuckingFilter(segments, bgDuckVolume = 0.15, bgNormalVolume = 1.0, videoClips = []) {
  const MAX_TERMS_PER_VOLUME_EXPR = 35;
  const mutedClipWindows = (Array.isArray(videoClips) ? videoClips : [])
    .filter((c) => c.isMuted)
    .map((c) => {
      const s = Math.max(0, Number(c.start || 0)).toFixed(2);
      const e = Math.max(0, Number(c.end || 0)).toFixed(2);
      return `between(t,${s},${e})`;
    });

  const hasMutedClips = mutedClipWindows.length > 0;

  if (!segments || segments.length === 0) {
    if (hasMutedClips) {
      if (mutedClipWindows.length <= MAX_TERMS_PER_VOLUME_EXPR) {
        const mutedCondition = mutedClipWindows.join("+");
        return `volume='if(gt(${mutedCondition},0),0.0,${bgNormalVolume.toFixed(2)})':eval=frame`;
      }
      const filters = [`volume=${bgNormalVolume.toFixed(2)}`];
      for (let i = 0; i < mutedClipWindows.length; i += MAX_TERMS_PER_VOLUME_EXPR) {
        const cond = mutedClipWindows.slice(i, i + MAX_TERMS_PER_VOLUME_EXPR).join("+");
        filters.push(`volume='if(gt(${cond},0),0.0,1.0)':eval=frame`);
      }
      return filters.join(",");
    }
    return `volume=${bgNormalVolume.toFixed(2)}`;
  }

  const rawIntervals = segments.map((seg) => {
    const startSec = Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? parseTimeToSec(seg.start, 0));
    const duration = Number(
      seg.audioDuration ?? seg.duration ?? seg.audioDurationSec ?? (seg.endSeconds ? seg.endSeconds - startSec : 2.5)
    );
    return {
      start: Math.max(0, startSec - 0.1),
      end: startSec + duration + 0.1,
    };
  });

  const mergedIntervals = mergeTimeIntervals(rawIntervals, 0.3);
  const timeWindows = mergedIntervals.map((iv) => `between(t,${iv.start.toFixed(2)},${iv.end.toFixed(2)})`);

  // Fast single-filter path when expression fits comfortably inside FFmpeg eval parser stack
  if (timeWindows.length <= MAX_TERMS_PER_VOLUME_EXPR && mutedClipWindows.length <= MAX_TERMS_PER_VOLUME_EXPR) {
    const conditionExpr = timeWindows.join("+");
    if (hasMutedClips) {
      const mutedCondition = mutedClipWindows.join("+");
      return `volume='if(gt(${mutedCondition},0),0.0,if(gt(${conditionExpr},0),${bgDuckVolume.toFixed(2)},${bgNormalVolume.toFixed(2)}))':eval=frame`;
    }
    return `volume='if(gt(${conditionExpr},0),${bgDuckVolume.toFixed(2)},${bgNormalVolume.toFixed(2)})':eval=frame`;
  }

  // Chunked filter chain for long videos (100-500+ segments) to avoid FFmpeg eval memory exhaustion
  const filters = [`volume=${bgNormalVolume.toFixed(2)}`];
  const duckRatio = bgNormalVolume > 0 ? (bgDuckVolume / bgNormalVolume) : bgDuckVolume;
  for (let i = 0; i < timeWindows.length; i += MAX_TERMS_PER_VOLUME_EXPR) {
    const chunkCond = timeWindows.slice(i, i + MAX_TERMS_PER_VOLUME_EXPR).join("+");
    filters.push(`volume='if(gt(${chunkCond},0),${duckRatio.toFixed(4)},1.0)':eval=frame`);
  }
  for (let i = 0; i < mutedClipWindows.length; i += MAX_TERMS_PER_VOLUME_EXPR) {
    const mutedChunkCond = mutedClipWindows.slice(i, i + MAX_TERMS_PER_VOLUME_EXPR).join("+");
    filters.push(`volume='if(gt(${mutedChunkCond},0),0.0,1.0)':eval=frame`);
  }
  return filters.join(",");
}


function extractAudio(videoPath, outputAudioPath, options = {}) {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      return reject(createAbortError("Audio extraction aborted"));
    }
    if (!fs.existsSync(videoPath)) {
      return reject(new Error(`Input video not found: ${videoPath}`));
    }

    const dir = path.dirname(outputAudioPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let settled = false;
    let aborted = false;
    let command = ffmpeg(videoPath);

    // Fast input seek (-ss BEFORE -i) for instant seek on large videos (2GB+ / 3h+)
    if (typeof options.startSec === "number" && options.startSec > 0) {
      command = command.inputOptions([`-ss ${options.startSec}`]);
    }

    command = command
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .audioChannels(1)
      .outputOptions(["-threads", "2"]);

    if (typeof options.durationSec === "number" && options.durationSec > 0) {
      command = command.setDuration(options.durationSec);
    }

    const onAbort = () => {
      aborted = true;
      try {
        command.kill("SIGTERM");
      } catch (_) {}
      if (!settled) {
        settled = true;
        reject(createAbortError("Audio extraction aborted"));
      }
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanupSignal = () => {
      if (options?.signal) {
        try {
          options.signal.removeEventListener("abort", onAbort);
        } catch (_) {}
      }
    };

    command
      .output(outputAudioPath)
      .on("end", () => {
        cleanupSignal();
        if (settled) return;
        settled = true;
        if (aborted || options?.signal?.aborted) {
          return reject(createAbortError("Audio extraction aborted"));
        }
        resolve(outputAudioPath);
      })
      .on("error", (err) => {
        cleanupSignal();
        if (settled) return;
        settled = true;
        if (aborted || options?.signal?.aborted) {
          return reject(createAbortError("Audio extraction aborted"));
        }
        reject(err);
      })
      .run();
  });
}


function extractValidTimestamp(val) {
  if (val === null || val === undefined) return null;
  // 1. Direct number check
  if (typeof val === "number") {
    if (Number.isFinite(val) && val >= 0) {
      return val;
    }
    return null;
  }
  // 2. String representation check (timecode "00:01:23.456", "01:30", decimal string "14.25", "0")
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const parsed = parseTimeToSec(trimmed, null);
    if (parsed !== null && Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return null;
  }
  return null;
}

/**
 * Safely resolves a segment's start offset in seconds across compatible schema aliases (BUG-012.1).
 * Enforces unified candidate precedence for both Number and String representations:
 * 1. audioStartSec (highest precedence, audio override)
 * 2. startSec (standard pipeline segment offset)
 * 3. startSeconds (canonical timeline offset alias)
 * 4. seg.start (legacy string timecode or numeric string)
 * 5. fallback (defaulting to 0 for single clips, or idx * 4 for unanchored batches)
 * 
 * Strict numeric validation guarantees:
 * - Number.isFinite() rejects Infinity, -Infinity, NaN.
 * - Negative values (< 0) are rejected.
 * - 0 is preserved as a valid timeline offset.
 */
function resolveSegmentStartSec(seg, fallback = 0) {
  if (!seg) return fallback;

  // 1. audioStartSec (highest precedence, whether Number or String)
  const candidateAudioStart = extractValidTimestamp(seg.audioStartSec);
  if (candidateAudioStart !== null) {
    return candidateAudioStart;
  }

  // 2. startSec (standard pipeline offset, whether Number or String)
  const candidateStartSec = extractValidTimestamp(seg.startSec);
  if (candidateStartSec !== null) {
    return candidateStartSec;
  }

  // 3. startSeconds (canonical timeline offset alias, whether Number or String)
  const candidateStartSeconds = extractValidTimestamp(seg.startSeconds);
  if (candidateStartSeconds !== null) {
    return candidateStartSeconds;
  }

  // 4. seg.start (legacy timecode property)
  if (seg.start !== undefined && seg.start !== null) {
    const candidateStart = extractValidTimestamp(seg.start);
    if (candidateStart !== null) {
      return candidateStart;
    }
  }

  // 5. Fallback
  return fallback;
}

/**
 * Build FFmpeg audio filter chain for a single narration segment in the master mix.
 * - Preserves intentional multi-lane overlaps (user placed clip on a different voice trackRow) with 40% ducking.
 * - Eliminates unintentional same-lane dialogue collisions:
 *   * Mild/moderate overrun (<= 1.35x): gentle atempo compression + 25ms soft fade + hard stop before next speaker.
 *   * Extreme overrun (> 1.35x): 1.30x atempo + smooth 60ms fade-out + hard stop 30ms before next speaker.
 */
function buildSegmentMixFilterChain(seg, nextOverlap = null, startMs = 0) {
  const rawOffset = typeof seg.audioOffset === "number" && !isNaN(seg.audioOffset) ? seg.audioOffset : 0;
  const dur = typeof seg.durSec === "number" && !isNaN(seg.durSec) ? seg.durSec : null;
  const audioOffset = (dur && rawOffset >= dur) ? 0 : Math.max(0, rawOffset);

  let trimPrefix = "";
  if (dur > 0 && (seg.audioTrimmed || seg.userTrimmed || audioOffset > 0)) {
    trimPrefix = `atrim=start=${audioOffset}:duration=${dur},asetpts=PTS-STARTPTS,`;
  }

  if (!nextOverlap) {
    return `${trimPrefix}adelay=${startMs}|${startMs}`;
  }

  const segRow = typeof seg.trackRow === "number" ? seg.trackRow : 0;
  const nextRow = typeof nextOverlap.trackRow === "number" ? nextOverlap.trackRow : 0;
  const isIntentionalMultiLane = segRow !== nextRow && Boolean(seg.userShifted || nextOverlap.userShifted || segRow > 0 || nextRow > 0);

  if (isIntentionalMultiLane) {
    const duckRelSec = Math.max(0.15, parseFloat((nextOverlap.startSec - seg.startSec).toFixed(2)));
    return `${trimPrefix}volume=eval=frame:volume='if(gte(t,${duckRelSec}),0.40,1.0)',adelay=${startMs}|${startMs}`;
  }

  // Same-lane dialogue collision guard: finish cleanly before next speaker onset (zero talking over each other)
  const slotAvailSec = Math.max(0.18, parseFloat((nextOverlap.startSec - seg.startSec - 0.03).toFixed(3)));
  if (dur && dur > slotAvailSec + 0.01) {
    const ratio = dur / slotAvailSec;
    if (ratio <= 1.35 && slotAvailSec >= 0.30) {
      const fitTempo = parseFloat(Math.max(1.01, Math.min(1.35, ratio)).toFixed(3));
      const fadeDur = Math.min(0.025, slotAvailSec * 0.15);
      const fadeStart = Math.max(0, parseFloat((slotAvailSec - fadeDur).toFixed(3)));
      return `${trimPrefix}atempo=${fitTempo},atrim=0:${slotAvailSec},afade=t=out:st=${fadeStart}:d=${fadeDur.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${startMs}|${startMs}`;
    }
    const fitTempo = 1.30;
    const fadeDur = Math.min(0.06, slotAvailSec * 0.25);
    const fadeStart = Math.max(0, parseFloat((slotAvailSec - fadeDur).toFixed(3)));
    return `${trimPrefix}atempo=${fitTempo},atrim=0:${slotAvailSec},afade=t=out:st=${fadeStart}:d=${fadeDur.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${startMs}|${startMs}`;
  }

  return `${trimPrefix}adelay=${startMs}|${startMs}`;
}

function createSynchronizedNarrationAudio(segments, outputAudioPath, options = {}) {
  return new Promise(async (resolve, reject) => {
    if (!segments || segments.length === 0) {
      return reject(new Error("No segments provided for synchronization"));
    }
    const validSegs = segments.filter((s) => !s.muted && !s.isMuted && s.audioPath && fs.existsSync(s.audioPath));
    if (validSegs.length === 0) {
      return reject(new Error("No valid audio files found for segments"));
    }
    const outDir = path.dirname(outputAudioPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const tempOutputPath = path.join(
      outDir,
      `.tmp_sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`
    );
    const safeTempPath = getSafeCliPath(tempOutputPath);

    const finalizeAtomicSwap = () => {
      try {
        if (fs.existsSync(tempOutputPath)) {
          if (fs.existsSync(outputAudioPath)) {
            try { fs.unlinkSync(outputAudioPath); } catch (_) {}
          }
          fs.renameSync(tempOutputPath, outputAudioPath);
        }
      } catch (swapErr) {
        try {
          fs.copyFileSync(tempOutputPath, outputAudioPath);
          fs.unlinkSync(tempOutputPath);
        } catch (_) {}
      }
    };

    if (validSegs.length === 1) {
      const secVal = resolveSegmentStartSec(validSegs[0], 0);
      const startMs = Math.max(0, Math.round(secVal * 1000));
      const seg0 = validSegs[0];
      const rawOffset = typeof seg0.audioOffset === "number" && !isNaN(seg0.audioOffset) ? seg0.audioOffset : 0;
      let dur = typeof seg0.audioDurationSec === "number" && !isNaN(seg0.audioDurationSec) ? seg0.audioDurationSec : (typeof seg0.durSec === "number" ? seg0.durSec : null);
      if (seg0.audioTrimmed && typeof seg0.audioEndSec === "number" && typeof seg0.audioStartSec === "number" && seg0.audioEndSec > seg0.audioStartSec) {
        dur = Math.max(0.1, parseFloat((seg0.audioEndSec - seg0.audioStartSec).toFixed(3)));
      }
      const audioOffset = (dur && rawOffset >= dur) ? 0 : Math.max(0, rawOffset);
      let trimPrefix = "";
      if (dur > 0 && (seg0.audioTrimmed || seg0.userTrimmed || audioOffset > 0)) {
        trimPrefix = `atrim=start=${audioOffset}:duration=${dur},asetpts=PTS-STARTPTS,`;
      }
      const filters = startMs > 0 ? [`${trimPrefix}adelay=${startMs}|${startMs}`] : (trimPrefix ? [`${trimPrefix}anull`] : ["anull"]);
      return ffmpeg()
        .input(getSafeCliPath(validSegs[0].audioPath))
        .audioFilters(filters)
        .audioCodec("libmp3lame")
        .audioFrequency(44100)
        .audioChannels(2)
        .audioBitrate("128k")
        .output(safeTempPath)
        .on("end", () => {
          finalizeAtomicSwap();
          resolve(outputAudioPath);
        })
        .on("error", (err) => {
          if (fs.existsSync(tempOutputPath)) {
            try { fs.unlinkSync(tempOutputPath); } catch (_) {}
          }
          reject(err);
        })
        .run();
    }

    // Helper: Re-verify segment audio file right before spawning FFmpeg.
    // If a concurrent single-segment voice switch deleted & replaced the old MP3 while earlier
    // batches were running, transparently pick up the replacement MP3 for that segment (or skip
    // cleanly if still mid-TTS) so /api/sync-audio never crashes with HTTP 500 ENOENT.
    const resolveLiveSegmentAudioPath = (seg) => {
      if (!seg || !seg.audioPath) return null;
      if (fs.existsSync(seg.audioPath)) return seg.audioPath;
      try {
        const dir = path.dirname(seg.audioPath);
        const base = path.basename(seg.audioPath);
        const prefixMatch = base.match(/^(.+?_seg_[^_]+_)/i);
        if (prefixMatch && fs.existsSync(dir)) {
          const prefix = prefixMatch[1];
          const candidates = fs.readdirSync(dir)
            .filter((f) => f.startsWith(prefix) && f.endsWith(".mp3") && !f.startsWith(".tmp_"))
            .map((f) => {
              const full = path.join(dir, f);
              let mtimeMs = 0;
              try { mtimeMs = fs.statSync(full).mtimeMs; } catch (_) {}
              return { full, mtimeMs };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
          if (candidates.length > 0 && fs.existsSync(candidates[0].full)) {
            return candidates[0].full;
          }
        }
      } catch (_) {}
      return null;
    };

    // Helper: Mix a single batch of up to 40 segments safely (resilient to concurrent voice-switch file swaps)
    const mixBatch = (segs, outPath, isWav = false, allowRetry = true, nextBatchBoundarySeg = null) => {
      return new Promise((resBatch, rejBatch) => {
        try {
          const liveSegs = [];
          for (const seg of segs) {
            const livePath = resolveLiveSegmentAudioPath(seg);
            if (livePath) {
              liveSegs.push(livePath === seg.audioPath ? seg : { ...seg, audioPath: livePath });
            }
          }
          if (liveSegs.length === 0) {
            return resBatch(null);
          }

          const command = ffmpeg();
          const filterParts = [];
          const mixInputs = [];

          const preparedSegs = liveSegs.map((seg, idx) => {
            const secVal = resolveSegmentStartSec(seg, idx * 4);
            let dur = typeof seg.audioDurationSec === "number" && !isNaN(seg.audioDurationSec) && seg.audioDurationSec > 0
              ? seg.audioDurationSec
              : 3.0;
            if (seg.audioTrimmed && typeof seg.audioEndSec === "number" && typeof seg.audioStartSec === "number" && seg.audioEndSec > seg.audioStartSec) {
              dur = Math.max(0.1, parseFloat((seg.audioEndSec - seg.audioStartSec).toFixed(3)));
            }
            return {
              ...seg,
              startSec: secVal,
              durSec: dur,
              endSec: secVal + dur,
            };
          });

          const preparedBoundaryNext = nextBatchBoundarySeg
            ? {
                ...nextBatchBoundarySeg,
                startSec: resolveSegmentStartSec(nextBatchBoundarySeg, preparedSegs.length * 4),
              }
            : null;

          preparedSegs.forEach((seg, idx) => {
            command.input(getSafeCliPath(seg.audioPath));
            const startMs = Math.max(0, Math.round(seg.startSec * 1000));
            const futureSegs = preparedBoundaryNext
              ? [...preparedSegs.slice(idx + 1), preparedBoundaryNext]
              : preparedSegs.slice(idx + 1);
            const nextOverlap = futureSegs.find((next) => next.startSec > seg.startSec && next.startSec < seg.endSec) || null;
            const filterChain = buildSegmentMixFilterChain(seg, nextOverlap, startMs);
            filterParts.push(`[${idx}:a]${filterChain}[a${idx}]`);
            mixInputs.push(`[a${idx}]`);
          });

          const N = liveSegs.length;
          const filterStr = filterParts.join(";") + ";" + mixInputs.join("") + "amix=inputs=" + N + ":duration=longest:dropout_transition=2147483647,volume=" + N + ",alimiter=limit=0.95[outa]";
          command.complexFilter(filterStr);

          if (isWav) {
            command.outputOptions(["-map [outa]", "-threads 0", "-c:a pcm_s16le", "-f wav"]);
          } else {
            command.outputOptions(["-map [outa]", "-threads 0", "-q:a 4"]);
            command.audioCodec("libmp3lame");
          }

          command.output(getSafeCliPath(outPath))
            .on("end", () => resBatch(outPath))
            .on("error", (err) => {
              const msg = String(err?.message || "");
              if (allowRetry && /No such file or directory|Error opening input/i.test(msg)) {
                console.warn(`[FFmpegService] ⚠️ Concurrent audio file swap detected during sync batch — retrying batch with live files...`);
                return mixBatch(segs, outPath, isWav, false).then(resBatch).catch(rejBatch);
              }
              return rejBatch(err);
            })
            .run();
        } catch (spawnErr) {
          rejBatch(spawnErr);
        }
      });
    };

    const BATCH_SIZE = 40;
    try {
      if (validSegs.length <= BATCH_SIZE) {
        // Direct Single Pass
        const singleOut = await mixBatch(validSegs, tempOutputPath, false);
        if (!singleOut) {
          return reject(new Error("No valid audio files remained during synchronization"));
        }
        finalizeAtomicSwap();
        console.log(`[FFmpegService] 🎙️ Master Narration បាន Sync រួចរាល់ (${validSegs.length} segments | Steady Loudness Guard active)`);
        return resolve(outputAudioPath);
      }

      // Hierarchical Batching (Prevents Windows ENAMETOOLONG CLI Limit for hundreds of clips)
      console.log(`[FFmpegService] 🎙️ Hierarchical Audio Sync: Dividing ${validSegs.length} segments into batches of ${BATCH_SIZE}...`);
      const intermediateChunkPaths = [];

      for (let b = 0; b < validSegs.length; b += BATCH_SIZE) {
        const batchNum = Math.floor(b / BATCH_SIZE) + 1;
        const batchSegs = validSegs.slice(b, b + BATCH_SIZE);
        const nextBoundarySeg = validSegs[b + BATCH_SIZE] || null;
        const batchWavPath = path.join(outDir, `.tmp_sync_batch_${Date.now()}_${batchNum}.wav`);
        const builtChunk = await mixBatch(batchSegs, batchWavPath, true, true, nextBoundarySeg);
        if (builtChunk) {
          intermediateChunkPaths.push(builtChunk);
        }
      }

      if (intermediateChunkPaths.length === 0) {
        return reject(new Error("No valid audio batches remained during synchronization"));
      }

      // Final mix of intermediate batch WAVs into single MP3
      await new Promise((resFinal, rejFinal) => {
        try {
          const finalCmd = ffmpeg();
          intermediateChunkPaths.forEach((p) => finalCmd.input(getSafeCliPath(p)));
          const M = intermediateChunkPaths.length;
          const mixFilter = `amix=inputs=${M}:duration=longest:dropout_transition=2147483647,volume=${M},alimiter=limit=0.95[outa]`;
          finalCmd.complexFilter(mixFilter);
          finalCmd.outputOptions(["-map [outa]", "-threads 0", "-q:a 4"]);
          finalCmd.audioCodec("libmp3lame")
            .output(safeTempPath)
            .on("end", () => resFinal())
            .on("error", rejFinal)
            .run();
        } catch (fErr) {
          rejFinal(fErr);
        }
      });

      // Cleanup intermediate WAV files
      for (const cp of intermediateChunkPaths) {
        try { if (fs.existsSync(cp)) fs.unlinkSync(cp); } catch (_) {}
      }

      finalizeAtomicSwap();
      console.log(`[FFmpegService] 🎙️ Master Narration បាន Sync រួចរាល់ (${validSegs.length} segments via ${intermediateChunkPaths.length} batches)`);
      if (options && options.jobId) {
        try {
          const { saveCheckpoint } = require("../pipeline/checkpointManager");
          saveCheckpoint({
            jobId: options.jobId,
            seriesId: options.seriesId || "series_default",
            episodeId: options.episodeId || "ep_1",
            stage: "master_narration_audio",
            stageIndex: 9.5,
            stageStatus: "completed",
            data: {
              outputAudioPath,
              segmentCount: validSegs.length,
            },
            baseUploadsDir: options.baseUploadsDir || null,
          });
        } catch (_) {}
      }
      resolve(outputAudioPath);
    } catch (err) {
      if (fs.existsSync(tempOutputPath)) {
        try { fs.unlinkSync(tempOutputPath); } catch (_) {}
      }
      console.error(`[FFmpegService] ❌ createSynchronizedNarrationAudio error:`, err.message);
      reject(new Error(`FFmpeg Audio Sync Error: ${err.message}`));
    }
  });
}


/**
 * Apply subtle, cinematic inner-thought audio effect (aecho reverb) for internal monologue.
 * Intimate, clear speech with dreamy psychoacoustic reflection.
 *
 * @param {Object} options
 * @param {string} options.inputAudioPath - Path to clean speech source file
 * @param {string} options.outputPath - Destination path for effected file
 * @param {Object} [options.effectConfig={}] - Configurable parameters (inGain, outGain, delays, decays)
 * @returns {Promise<{ outputPath: string, duration: number, sizeBytes: number, effect: string, effectConfig: object }>}
 */
async function applyInnerThoughtAudioEffect({
  inputAudioPath,
  outputPath,
  effectConfig = {},
}) {
  if (!fs.existsSync(inputAudioPath)) {
    throw new Error(`រកមិនឃើញ File សំឡេងដើម៖ ${inputAudioPath}`);
  }

  const inGain = effectConfig.inGain ?? 0.85;
  const outGain = effectConfig.outGain ?? 0.75;
  const delays = effectConfig.delays ?? "40|90";
  const decays = effectConfig.decays ?? "0.3|0.15";

  const echoFilter = `aecho=${inGain}:${outGain}:${delays}:${decays}`;
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Safe atomic write strategy: write to unique temp file first
  const tempPath = path.join(
    outDir,
    `temp_effect_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`
  );

  const safeInput = getSafeCliPath(inputAudioPath);
  const safeTemp = getSafeCliPath(tempPath);

  await new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, [
      "-y",
      "-i", safeInput,
      "-af", echoFilter,
      "-c:a", "libmp3lame",
      "-q:a", "2",
      safeTemp,
    ]);

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 200) {
        resolve();
      } else {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }
        reject(new Error(`FFmpeg aecho failed with exit code ${code}: ${stderr.slice(-300)}`));
      }
    });
    proc.on("error", (err) => {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      reject(err);
    });
  });

  // Verify resulting audio duration
  const duration = await getMediaDuration(tempPath);
  if (!duration || duration <= 0) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw new Error("Effected audio duration probe failed");
  }

  // Atomically replace destination
  try {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    fs.renameSync(tempPath, outputPath);
  } catch (renameErr) {
    fs.copyFileSync(tempPath, outputPath);
    try { fs.unlinkSync(tempPath); } catch (_) {}
  }

  const sizeBytes = fs.statSync(outputPath).size;
  return {
    outputPath,
    duration,
    sizeBytes,
    effect: "inner_thought_reverb",
    effectConfig: { inGain, outGain, delays, decays },
  };
}




module.exports = {
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
  buildSegmentMixFilterChain,
  createSynchronizedNarrationAudio,
};
