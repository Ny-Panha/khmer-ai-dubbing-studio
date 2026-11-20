const { spawn, spawnSync, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const ffmpeg = require("fluent-ffmpeg");
const audioSeparationService = require("./audioSeparationService");
const { buildDynamicVerticalCropXExpr } = require("./smartReframeService");
const { ffmpegHeavySemaphore, createAbortError } = require("../utils/asyncSemaphore");
const { registerProcess, unregisterProcess } = require("../utils/processRegistry");

function attachAbortKill(proc, signal, onAbortCallback) {
  if (proc && proc.pid) {
    registerProcess(proc, { type: "ffmpeg" });
  }
  if (!signal || !proc) return () => {};
  const onAbort = () => {
    try {
      unregisterProcess(proc);
      if (process.platform === "win32" && proc.pid) {
        spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      }
      proc.kill("SIGTERM");
    } catch (_) {}
    if (typeof onAbortCallback === "function") {
      onAbortCallback();
    }
  };
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    try {
      signal.removeEventListener("abort", onAbort);
    } catch (_) {}
  };
}

function resolveBinary(cmdName, fallbackPath) {
  try {
    const { execSync } = require("child_process");
    const sysPath = execSync(`where ${cmdName}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0].trim();
    if (sysPath && fs.existsSync(sysPath)) return sysPath;
  } catch (_) {}
  return fallbackPath;
}

const FFMPEG_PATH = resolveBinary("ffmpeg", ffmpegInstaller.path);
const FFPROBE_PATH = resolveBinary("ffprobe", ffprobeInstaller.path);

ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

// Probe whether this FFmpeg build supports -fps_mode (FFmpeg 5.1+/8.x removed -vsync)
const FFMPEG_VFR_ARGS = (() => {
  try {
    const helpRes = spawnSync(FFMPEG_PATH, ["-h", "long"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
    const combinedHelp = `${helpRes.stdout || ""}\n${helpRes.stderr || ""}`;
    if (/\bfps_mode\b/.test(combinedHelp)) {
      return ["-fps_mode", "vfr"];
    }
  } catch (_) {}
  return ["-vsync", "vfr"];
})();

let isQsvSupported = null;
function checkQsvSupport() {
  if (isQsvSupported !== null) return isQsvSupported;
  try {
    const { execSync } = require("child_process");
    execSync(`"${FFMPEG_PATH}" -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -c:v h264_qsv -f null -`, {
      stdio: "ignore",
      windowsHide: true,
    });
    isQsvSupported = true;
    console.log("[FFmpegService] 🚀 Intel QuickSync (h264_qsv) Hardware Acceleration ACTIVE!");
  } catch (_) {
    isQsvSupported = false;
    console.log("[FFmpegService] ℹ️ Intel QuickSync unavailable, using CPU multi-threading (-threads 0).");
  }
  return isQsvSupported;
}

const { parseTimeToSec, toSrtTime } = require("../models/timestampUtils");

/**
 * Resolves safe Windows 8.3 short path when the path contains non-ASCII characters or emojis,
 * preventing native Windows FFmpeg/FFprobe CLI path errors ("No such file or directory").
 */
function getVideoDimensionsFast(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const safePath = getSafeCliPath(filePath);
    const { execSync } = require("child_process");
    const out = execSync(
      `"${FFPROBE_PATH}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${safePath}"`,
      { encoding: "utf8", windowsHide: true, timeout: 3000 }
    ).trim();
    const parts = out.split("x");
    if (parts.length === 2) {
      const w = parseInt(parts[0], 10);
      const h = parseInt(parts[1], 10);
      if (w > 0 && h > 0) return { width: w, height: h };
    }
  } catch (_) {}
  return null;
}

const safeCliPathCache = new Map();

function getSafeCliPath(targetPath) {
  if (process.platform !== "win32" || !targetPath) return targetPath;
  if (!/[^\x20-\x7E]/.test(targetPath)) return targetPath;

  if (safeCliPathCache.has(targetPath)) {
    return safeCliPathCache.get(targetPath);
  }

  try {
    if (fs.existsSync(targetPath)) {
      const short = execSync(`cmd.exe /c for %I in ("${targetPath}") do @echo %~sI`, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
      if (short && fs.existsSync(short)) {
        safeCliPathCache.set(targetPath, short);
        return short;
      }
    }
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    if (fs.existsSync(dir)) {
      const shortDir = execSync(`cmd.exe /c for %I in ("${dir}") do @echo %~sI`, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
      if (shortDir && fs.existsSync(shortDir)) {
        const resolved = path.join(shortDir, base);
        safeCliPathCache.set(targetPath, resolved);
        return resolved;
      }
    }
  } catch (_) {}
  safeCliPathCache.set(targetPath, targetPath);
  return targetPath;
}

// ============================================================================
// ផ្នែកទី 1: GEMINI PROXY VIDEO 360p (បង្រួមវីដេអូឱ្យ Upload លឿនជាងមុន 5-10 ដង)
// ============================================================================

// In-flight proxy video creation jobs to prevent race conditions and duplicate FFmpeg processes
// ============================================================================
// ផ្នែកទី 2: MEDIA DURATION & AUTO TIME-STRETCH (silenceremove + atempo)
// ============================================================================

// Fast media duration cache keyed by filePath:mtime:size
const mediaDurationCache = new Map();

function getMediaDuration(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) return resolve(0);

    try {
      const stat = fs.statSync(filePath);
      const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}`;
      if (mediaDurationCache.has(cacheKey)) {
        return resolve(mediaDurationCache.get(cacheKey));
      }

      const safePath = getSafeCliPath(filePath);

      // Fast path 1: ffprobe -v error -show_entries format=duration (~50-80ms vs 14000ms)
      const probeProc = spawn(FFPROBE_PATH, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        safePath,
      ], { windowsHide: true });

      let probeOut = "";
      probeProc.stdout.on("data", (d) => { probeOut += d.toString(); });

      probeProc.on("close", (code) => {
        const val = parseFloat(probeOut.trim());
        if (code === 0 && !isNaN(val) && val > 0) {
          const finalDur = Number(val.toFixed(3));
          mediaDurationCache.set(cacheKey, finalDur);
          return resolve(finalDur);
        }

        // Fallback: spawn ffmpeg
        const proc = spawn(FFMPEG_PATH, ["-i", safePath, "-f", "null", "-"], { windowsHide: true });
        let stderr = "";
        proc.stderr.on("data", (data) => { stderr += data.toString(); });
        proc.on("close", () => {
          const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (match) {
            const hours = parseFloat(match[1]);
            const minutes = parseFloat(match[2]);
            const seconds = parseFloat(match[3]);
            const dur = Number((hours * 3600 + minutes * 60 + seconds).toFixed(3));
            mediaDurationCache.set(cacheKey, dur);
            resolve(dur);
          } else {
            resolve(0);
          }
        });
        proc.on("error", () => resolve(0));
      });

      probeProc.on("error", () => {
        // Fallback on probe spawn error
        const proc = spawn(FFMPEG_PATH, ["-i", safePath, "-f", "null", "-"], { windowsHide: true });
        let stderr = "";
        proc.stderr.on("data", (data) => { stderr += data.toString(); });
        proc.on("close", () => {
          const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (match) {
            const hours = parseFloat(match[1]);
            const minutes = parseFloat(match[2]);
            const seconds = parseFloat(match[3]);
            const dur = Number((hours * 3600 + minutes * 60 + seconds).toFixed(3));
            mediaDurationCache.set(cacheKey, dur);
            resolve(dur);
          } else {
            resolve(0);
          }
        });
        proc.on("error", () => resolve(0));
      });
    } catch (_) {
      resolve(0);
    }
  });
}

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
      if (activeRenderProcess === proc) activeRenderProcess = null;
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
      if (activeRenderProcess === proc) activeRenderProcess = null;
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

function hexToAssColor(hexColor = "#FFFFFF", alphaHex = "00") {
  const cleanHex = String(hexColor).replace("#", "").trim();
  if (cleanHex.length !== 6) return `&H${alphaHex}FFFFFF`;

  const r = cleanHex.substring(0, 2).toUpperCase();
  const g = cleanHex.substring(2, 4).toUpperCase();
  const b = cleanHex.substring(4, 6).toUpperCase();

  return `&H${alphaHex}${b}${g}${r}`;
}

function formatSecondsToAssTime(seconds) {
  const safeSec = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = Math.floor(safeSec % 60);
  const centisecs = Math.round((safeSec - Math.floor(safeSec)) * 100);

  if (centisecs === 100) {
    return formatSecondsToAssTime(Math.floor(safeSec) + 1);
  }

  return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centisecs).padStart(2, "0")}`;
}

function sanitizeKhmerSubtitleText(text = "") {
  return String(text)
    .normalize("NFC")
    .replace(/\r?\n/g, "\\N")
    .replace(/[{}]/g, "")
    .trim();
}

const SUBTITLE_SIZE_SCALE_MAP = {
  small: 0.8,
  medium: 1.0,
  large: 1.25,
};

function resolveRenderAspectRatio(requestedRatio, sourceDimensions) {
  if (requestedRatio) return requestedRatio;
  if (!sourceDimensions?.width || !sourceDimensions?.height) {
    console.warn("[FFmpegService] Source dimensions missing, falling back to 16:9 aspectRatio");
    return "16:9";
  }
  if (sourceDimensions.height > sourceDimensions.width) return "9:16";
  return sourceDimensions.height === sourceDimensions.width ? "1:1" : "16:9";
}

function resolveAssSubtitleLayoutDefaults({
  aspectRatio = "16:9",
  verticalStyle = "pad",
  sourceDimensions = null,
} = {}) {
  if (aspectRatio === "9:16") {
    const isSourcePortrait = Boolean(
      sourceDimensions && Number(sourceDimensions.height) > Number(sourceDimensions.width)
    );
    const isCropOrPortrait = verticalStyle === "crop" || isSourcePortrait;
    return {
      playResX: 1080,
      playResY: 1920,
      defaultFontSize: isCropOrPortrait ? 44 : 48,
    };
  }
  if (aspectRatio === "1:1") {
    return {
      playResX: 1080,
      playResY: 1080,
      defaultFontSize: 52,
    };
  }
  return {
    playResX: 1920,
    playResY: 1080,
    defaultFontSize: 44,
  };
}

function generateKhmerAssSubtitleFile({
  segments = [],
  outputPath,
  fontName = "Khmer OS Battambang",
  fontSize = null,
  subtitleSize = null,
  textColor = "#FFFFFF",
  outlineColor = "#000000",
  subtitleStyle = "banner",
  marginV = null,
  aspectRatio = "16:9",
  verticalStyle = "pad",
  antiTheft = null,
  cornerMask = null,
  totalDuration = null,
  sourceDimensions = null,
}) {
  const layoutDefaults = resolveAssSubtitleLayoutDefaults({
    aspectRatio,
    verticalStyle,
    sourceDimensions,
  });
  const playResX = layoutDefaults.playResX;
  const playResY = layoutDefaults.playResY;
  const explicitFontSize = Number(fontSize);
  const preset = String(subtitleSize ?? "").trim().toLowerCase();
  let effFontSize = layoutDefaults.defaultFontSize;
  let sizeLabel = "null";
  if (Number.isFinite(explicitFontSize) && explicitFontSize > 0) {
    effFontSize = explicitFontSize;
    sizeLabel = "explicit";
  } else if (Object.hasOwn(SUBTITLE_SIZE_SCALE_MAP, preset)) {
    effFontSize = Math.round(effFontSize * SUBTITLE_SIZE_SCALE_MAP[preset]);
    sizeLabel = preset;
  }
  let effMarginV = marginV;

  const isAntiTheftActive = Boolean(antiTheft && (antiTheft.enabled || antiTheft.enableAntiTheft));
  const marqueePos = antiTheft?.marqueePosition || antiTheft?.position || "bottom";

  // កំណត់គម្លាតស្វ័យប្រវត្តិតាមទម្រង់វីដេអូ
  if (aspectRatio === "9:16") {
    const isSourcePortrait = Boolean(sourceDimensions && sourceDimensions.height > sourceDimensions.width);
    if (verticalStyle === "crop" || isSourcePortrait) {
      // Full-bleed 9:16 crop or naturally vertical video: subtitles sit near the bottom of the full frame
      effMarginV = marginV || (isAntiTheftActive && marqueePos === "bottom" ? 180 : 130);
    } else {
      // Pad mode with landscape source: Centered at y=1200 - sits snugly on padded letterbox video
      effMarginV = marginV || 720;
    }
  } else if (aspectRatio === "1:1") {
    effMarginV = marginV || (isAntiTheftActive && marqueePos === "bottom" ? 180 : 120);
  } else {
    // 16:9 YouTube Landscape
    effMarginV = marginV || (isAntiTheftActive && marqueePos === "bottom" ? 150 : 80);
  }

  const primaryAssColor = hexToAssColor(textColor, "00");
  let outlineAssColor = hexToAssColor(outlineColor, "00");
  const shadowAssColor = "&H80000000";

  let borderStyle = 3;
  let outlineWidth = aspectRatio === "9:16" ? 12 : 10;
  let shadowWidth = 0;
  let backBoxColor = "&H3208080c"; // 80% opacity dark glass (rgba 0,0,0,0.80) matching Web Preview

  if (subtitleStyle === "cinema-soft" || subtitleStyle === "soft" || subtitleStyle === "clean" || subtitleStyle === "cinema") {
    borderStyle = 1;
    outlineWidth = 2.5;
    shadowWidth = 1.5;
    backBoxColor = "&H80000000";
  } else if (subtitleStyle === "glow") {
    borderStyle = 1;
    outlineWidth = 5;
    shadowWidth = 2;
    backBoxColor = "&H60000000";
  } else if (subtitleStyle === "pill") {
    borderStyle = 3;
    outlineWidth = 6;
    shadowWidth = 0;
    backBoxColor = "&H6408080c";
    outlineAssColor = hexToAssColor(outlineColor, "64");
  } else {
    // "banner" (default) — solid dark box that cleanly covers burned-in source subtitles
    borderStyle = 3;
    outlineWidth = aspectRatio === "9:16" ? 12 : 10;
    shadowWidth = 0;
    backBoxColor = "&H3208080c";
  }

  let antiTheftStyles = "";
  const antiTheftEvents = [];

  if (isAntiTheftActive) {
    const marqueeColorHex = antiTheft.marqueeTextColor || antiTheft.textColor || "#FFE600";
    const marqueeAssColor = hexToAssColor(marqueeColorHex, "00");
    const watermarkColorHex = antiTheft.watermarkColor || "#38BDF8";
    const watermarkAssColor = hexToAssColor(watermarkColorHex, "00");

    const antiTheftSize = antiTheft.antiTheftSize || "small";

    let ribbonH = 44;
    let ribbonY = 1024;
    let marqueeFontSize = 24;
    let watermarkFontSize = 24;
    let textY = ribbonY + 22;
    let watermarkY = ribbonY - 14;

    if (aspectRatio === "9:16") {
      // 9:16 Frame (1080x1920).
      let vTop = verticalStyle === "crop" ? 0 : 656;
      let vBottom = verticalStyle === "crop" ? 1920 : 1264;
      if (verticalStyle !== "crop" && sourceDimensions && sourceDimensions.width > 0 && sourceDimensions.height > 0) {
        const srcRatio = sourceDimensions.width / sourceDimensions.height;
        let scaledH = Math.round(1080 / srcRatio);
        if (scaledH % 2 !== 0) scaledH += 1;
        scaledH = Math.min(1920, Math.max(300, scaledH));
        vTop = Math.round((1920 - scaledH) / 2);
        vBottom = vTop + scaledH;
      }

      // Compact, beautiful proportions tailored to mobile vertical canvas
      if (antiTheftSize === "large") {
        ribbonH = 68;
        marqueeFontSize = 36;
        watermarkFontSize = 32;
      } else if (antiTheftSize === "medium") {
        ribbonH = 58;
        marqueeFontSize = 30;
        watermarkFontSize = 28;
      } else {
        // "small" (Compact & neat - Nha's recommendation): Sits cleanly on the video frame, crisp & legible
        ribbonH = 48;
        marqueeFontSize = 26;
        watermarkFontSize = 24;
      }

      if (marqueePos === "top") {
        ribbonY = vTop + 8;
        textY = ribbonY + Math.round(ribbonH / 2);
        watermarkY = ribbonY + ribbonH + 24;
      } else {
        // Sits cleanly inside the video frame. For 9:16 crop, sits directly above the 1592 blur subtitle band!
        if (verticalStyle === "crop") {
          ribbonY = Math.round(1592 - ribbonH - 8);
        } else {
          ribbonY = vBottom - ribbonH;
        }
        textY = ribbonY + Math.round(ribbonH / 2);
        watermarkY = ribbonY - 12;
      }
    } else if (aspectRatio === "1:1") {
      if (antiTheftSize === "large") {
        ribbonH = 60;
        marqueeFontSize = 32;
        watermarkFontSize = 30;
      } else if (antiTheftSize === "medium") {
        ribbonH = 52;
        marqueeFontSize = 28;
        watermarkFontSize = 26;
      } else {
        ribbonH = 44;
        marqueeFontSize = 24;
        watermarkFontSize = 22;
      }
      ribbonY = 1080 - ribbonH - 16;
      textY = ribbonY + Math.round(ribbonH / 2);
      if (marqueePos === "top") {
        ribbonY = 30;
        textY = ribbonY + Math.round(ribbonH / 2);
        watermarkY = ribbonY + ribbonH + 26;
      } else {
        watermarkY = ribbonY - 14;
      }
    } else {
      // 16:9 Landscape (1920x1080)
      if (antiTheftSize === "large") {
        ribbonH = 58;
        marqueeFontSize = 32;
        watermarkFontSize = 30;
      } else if (antiTheftSize === "medium") {
        ribbonH = 50;
        marqueeFontSize = 28;
        watermarkFontSize = 26;
      } else {
        ribbonH = 42;
        marqueeFontSize = 24;
        watermarkFontSize = 22;
      }

      if (marqueePos === "top") {
        ribbonY = 32;
        textY = ribbonY + Math.round(ribbonH / 2);
        watermarkY = ribbonY + ribbonH + 26;
      } else {
        const bottomPct = Number(antiTheft.antiTheftBottomPercent ?? antiTheft.bottomPercent);
        if (Number.isFinite(bottomPct) && bottomPct > 0) {
          ribbonY = Math.round(1080 - (1080 * (bottomPct / 100)) - ribbonH);
        } else {
          ribbonY = 1080 - ribbonH - 16;
        }
        textY = ribbonY + Math.round(ribbonH / 2);
        watermarkY = ribbonY - 12;
      }
    }

    antiTheftStyles = `
Style: AntiTheftRibbon,${fontName},10,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: AntiTheftMarquee,${fontName},${marqueeFontSize},${marqueeAssColor},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1,4,0,0,0,1
Style: AntiTheftWatermark,${fontName},${watermarkFontSize},${watermarkAssColor},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1.2,2,0,0,0,1`;

    // Calculate effective total duration in seconds
    let maxTimeSec = Number(totalDuration) || 0;
    if (maxTimeSec <= 0 && segments.length > 0) {
      segments.forEach((seg) => {
        const s = Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? parseTimeToSec(seg.start, 0));
        const d = Number(seg.audioDuration ?? seg.duration ?? seg.audioDurationSec ?? 2.5);
        if (s + d > maxTimeSec) maxTimeSec = s + d;
      });
    }
    if (maxTimeSec <= 0) maxTimeSec = 3600; // 1 hr default
    maxTimeSec += 2; // small safety padding

    const totalEndAss = formatSecondsToAssTime(maxTimeSec);

    // 1. Semi-transparent black background ribbon (Layer 1)
    antiTheftEvents.push(
      `Dialogue: 1,0:00:00.00,${totalEndAss},AntiTheftRibbon,,0,0,0,,{\\p1\\c&H161618&\\1a&H12&\\bord1.5\\3c&H505058&\\shad0\\pos(0,${ribbonY})}m 0 0 l ${playResX} 0 l ${playResX} ${ribbonH} l 0 ${ribbonH}{\\p0}`
    );

    // 2. Static Copyright Watermark Badge (Layer 2)
    const hasWatermark = antiTheft.enableWatermark !== false;
    const rawWmText = antiTheft.watermarkText || "រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama";
    if (hasWatermark && rawWmText.trim()) {
      const cleanWmText = sanitizeKhmerSubtitleText(rawWmText);
      const wmPos = antiTheft.watermarkPosition || "above-ticker";
      let posTag = `\\pos(${Math.round(playResX / 2)},${watermarkY})\\an2`;
      if (wmPos === "top-right") {
        posTag = `\\pos(${playResX - 50},${aspectRatio === "9:16" ? 140 : 50})\\an9`;
      } else if (wmPos === "top-left") {
        posTag = `\\pos(50,${aspectRatio === "9:16" ? 140 : 50})\\an7`;
      }
      antiTheftEvents.push(
        `Dialogue: 2,0:00:00.00,${totalEndAss},AntiTheftWatermark,,0,0,0,,{${posTag}\\fad(300,300)}${cleanWmText}`
      );
    }

    // 3. Continuous Running Marquee Ticker (Layer 3)
    const rawMarquee = antiTheft.marqueeText || "«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»";
    const cleanMarquee = sanitizeKhmerSubtitleText(rawMarquee);
    const repeatedMarquee = `${cleanMarquee}       ❖       ${cleanMarquee}       ❖       ${cleanMarquee}`;

    const speed = antiTheft.marqueeSpeed || "normal";
    const parsedSpeed = parseFloat(speed);
    const cycleDuration = (!isNaN(parsedSpeed) && parsedSpeed > 0)
      ? parsedSpeed
      : (speed === "fast" ? 9 : (speed === "slow" ? 20 : 13));

    const startX = playResX + 80;
    const estTextWidth = Math.max(playResX, repeatedMarquee.length * marqueeFontSize * 0.65);
    const endX = -Math.round(estTextWidth + 120);

    let t = 0;
    while (t < maxTimeSec) {
      const tStartAss = formatSecondsToAssTime(t);
      const tEndAss = formatSecondsToAssTime(Math.min(maxTimeSec, t + cycleDuration));
      antiTheftEvents.push(
        `Dialogue: 3,${tStartAss},${tEndAss},AntiTheftMarquee,,0,0,0,,{\\q2\\an4\\move(${startX},${textY},${endX},${textY})}${repeatedMarquee}`
      );
      t += cycleDuration;
    }
  }

  // 🛡️ Corner Blocker / Disclaimer Mask Events & Styles (Badge / Solid Black via ASS; Real Blur uses FFmpeg video filtergraph)
  let cornerMaskStyles = "";
  const cornerMaskEvents = [];
  const rawCornerMaskStyle = String(cornerMask?.style || "badge").toLowerCase();
  const isCornerMaskActive = Boolean(
    cornerMask &&
    (cornerMask.enabled || cornerMask.enableCornerMask) &&
    rawCornerMaskStyle !== "blur"
  );
  if (isCornerMaskActive) {
    let maxTimeSec = Number(totalDuration) || 0;
    if (maxTimeSec <= 0 && segments.length > 0) {
      segments.forEach((seg) => {
        const s = Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? parseTimeToSec(seg.start, 0));
        const d = Number(seg.audioDuration ?? seg.duration ?? seg.audioDurationSec ?? 2.5);
        if (s + d > maxTimeSec) maxTimeSec = s + d;
      });
    }
    if (maxTimeSec <= 0) maxTimeSec = 3600;
    maxTimeSec += 2;
    const totalEndAss = formatSecondsToAssTime(maxTimeSec);

    const baseW = Math.max(60, Math.min(500, Number(cornerMask.width) || 220));
    const baseH = Math.max(20, Math.min(200, Number(cornerMask.height) || 54));
    const rawOffsetX = cornerMask.offsetX ?? cornerMask.cornerMaskOffsetX;
    const rawOffsetY = cornerMask.offsetY ?? cornerMask.cornerMaskOffsetY;
    const baseOffX = Math.max(0, Math.min(200, Number.isFinite(Number(rawOffsetX)) ? Number(rawOffsetX) : 14));
    const baseOffY = Math.max(0, Math.min(200, Number.isFinite(Number(rawOffsetY)) ? Number(rawOffsetY) : 14));
    const scale = playResX / 1000;
    const maskW = Math.round(baseW * scale);
    const maskH = Math.round(baseH * scale);
    const offX = Math.round(baseOffX * scale);
    const offY = Math.round(baseOffY * scale);
    const maskPos = cornerMask.position || "top-right";
    const maskStyle = rawCornerMaskStyle;
    const maskText = cornerMask.text ?? "«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»";
    const is916Letterbox = aspectRatio === "9:16" && verticalStyle !== "crop";
    const letterboxTopY = Math.round(playResY * 0.342);

    let maskX = Math.max(0, playResX - maskW - offX);
    let maskY = is916Letterbox ? (letterboxTopY + offY) : offY;

    if (maskPos === "top-left") {
      maskX = offX;
      maskY = is916Letterbox ? (letterboxTopY + offY) : offY;
    } else if (maskPos === "bottom-right") {
      maskX = Math.max(0, playResX - maskW - offX);
      maskY = is916Letterbox ? Math.max(0, playResY - letterboxTopY - maskH - offY) : Math.max(0, playResY - maskH - offY);
    } else if (maskPos === "bottom-left") {
      maskX = offX;
      maskY = is916Letterbox ? Math.max(0, playResY - letterboxTopY - maskH - offY) : Math.max(0, playResY - maskH - offY);
    }

    const textFontSize = Math.max(16, Math.round(maskH * 0.28));
    cornerMaskStyles = `
Style: CornerMaskBox,${fontName},10,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: CornerMaskText,${fontName},${textFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,5,0,0,0,1`;

    const isSolid = maskStyle === "solid";
    const boxColor = isSolid ? "000000" : "121216";
    const boxAlpha = isSolid ? "00" : "18";
    const boxBorder = isSolid ? "\\bord0" : "\\bord1.5\\3c&H404050&";
    cornerMaskEvents.push(
      `Dialogue: 1,0:00:00.00,${totalEndAss},CornerMaskBox,,0,0,0,,{\\p1\\c&H${boxColor}&\\1a&H${boxAlpha}&${boxBorder}\\shad0\\pos(${maskX},${maskY})}m 0 0 l ${maskW} 0 l ${maskW} ${maskH} l 0 ${maskH}{\\p0}`
    );

    if (maskText && maskText.trim()) {
      const cleanMaskText = sanitizeKhmerSubtitleText(maskText);
      const textCenterX = maskX + Math.round(maskW / 2);
      const textCenterY = maskY + Math.round(maskH / 2);
      cornerMaskEvents.push(
        `Dialogue: 2,0:00:00.00,${totalEndAss},CornerMaskText,,0,0,0,,{\\pos(${textCenterX},${textCenterY})\\an5}${cleanMaskText}`
      );
    }
  }

  const assHeader = `[Script Info]
Title: Khmer AI Dubbing Studio Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${effFontSize},${primaryAssColor},&H000000FF,${outlineAssColor},${backBoxColor},-1,0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadowWidth},2,60,60,${effMarginV},1${antiTheftStyles}${cornerMaskStyles}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogueLines = segments
    .filter((seg) => (seg.khmerText || seg.khmer) && String(seg.khmerText || seg.khmer).trim().length > 0)
    .map((seg) => {
      const hasVoice = Boolean(
        seg.audioUrl || seg.audioPath || seg.rawAudioPath || seg.audioFile || seg.rawAudioFile ||
        seg.ttsStatus === "ready" || seg.status === "audio_ready" ||
        (typeof seg.finalAudioDuration === "number" && seg.finalAudioDuration > 0) ||
        (typeof seg.audioDuration === "number" && seg.audioDuration > 0) ||
        (typeof seg.audioDurationSec === "number" && seg.audioDurationSec > 0)
      );

      const startSec = Number(
        (hasVoice && seg.audioStartSec !== undefined && seg.audioStartSec !== null && !isNaN(Number(seg.audioStartSec)))
          ? seg.audioStartSec
          : (seg.startSec ?? seg.startSeconds ?? parseTimeToSec(seg.start, 0))
      );

      const realAudioDur = hasVoice
        ? (seg.finalAudioDuration ?? seg.audioDurationSec ?? seg.audioDuration ?? seg.originalAudioDuration ?? seg.rawAudioDur)
        : null;

      const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
      let rawDur;
      if (isTrimmed && typeof seg.audioEndSec === "number" && !isNaN(seg.audioEndSec)) {
        rawDur = seg.audioEndSec - startSec;
      } else if (realAudioDur && !isNaN(realAudioDur) && realAudioDur > 0) {
        rawDur = Number(realAudioDur);
      } else {
        rawDur = Number(seg.duration ?? (seg.endSec ? seg.endSec - startSec : (seg.endSeconds ? seg.endSeconds - startSec : 2.5)));
      }

      // Match voice clip timing: when voice is present, end right when speech ends (with minimal min clamp for ultra-short clips)
      const safeDuration = (!rawDur || isNaN(rawDur) || rawDur <= 0.1)
        ? Math.max(1.2, Math.min(5.0, String(seg.khmerText || seg.khmer || "").length * 0.16))
        : rawDur;
      const endSec = startSec + safeDuration;

      const startAss = formatSecondsToAssTime(startSec);
      const endAss = formatSecondsToAssTime(endSec);
      const cleanText = sanitizeKhmerSubtitleText(seg.khmerText || seg.khmer);
      const speakerName = String(seg.speaker || seg.speakerName || "Speaker").replace(/,/g, " ");

      return `Dialogue: 0,${startAss},${endAss},Default,${speakerName},0,0,0,,{\\fad(0,0)}${cleanText}`;
    });

  const allEvents = [...antiTheftEvents, ...cornerMaskEvents, ...dialogueLines];
  const fullAssContent = assHeader + allEvents.join("\n") + "\n";

  fs.writeFileSync(outputPath, "\uFEFF" + fullAssContent, "utf8");
  console.log(
    `🎬 ASS burn: style=${subtitleStyle} color=${textColor} fontSize=${effFontSize} (size=${sizeLabel}) playRes=${playResX}x${playResY}`
  );
  console.log(`[FFmpegService] 📝 បានបង្កើត File Subtitle ខ្មែរ (.ass)៖ ${path.basename(outputPath)} (Anti-theft: ${isAntiTheftActive ? 'Active' : 'Off'}, Corner-mask: ${isCornerMaskActive ? 'Active' : 'Off'})`);

  return outputPath;
}

function buildAssSubtitleVideoFilter(assFilePath, customFontsDir = null) {
  const safeAssPath = getSafeCliPath(assFilePath);
  const escapeFfmpegPath = (p) =>
    path
      .resolve(p)
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");

  const escapedAss = escapeFfmpegPath(safeAssPath);
  const defaultFontsDir =
    customFontsDir || path.join(__dirname, "..", "assets", "fonts");

  if (fs.existsSync(defaultFontsDir)) {
    const escapedFontsDir = escapeFfmpegPath(getSafeCliPath(defaultFontsDir));
    return `ass=filename='${escapedAss}':fontsdir='${escapedFontsDir}'`;
  }

  return `ass=filename='${escapedAss}'`;
}

// ============================================================================
// ផ្នែកទី 4: SMART AUDIO DUCKING (85%) + ADELAY MIX + VIDEO RENDER
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

/**
 * Render Video with Multi-clip Adelay + Smart Ducking 85% + ASS Subtitles
 */
let activeRenderProcess = null;
const jobRenderProcesses = new Map();

function cancelJobRenderProcess(jobId) {
  if (!jobId) return false;
  const reg = jobRenderProcesses.get(jobId);
  if (reg && reg.proc && !reg.proc.killed) {
    try {
      reg.interrupted = true;
      reg.cancelled = true;
      reg.proc.kill("SIGTERM");
    } catch (_) {}
    if (reg.tempOutputPath && fs.existsSync(reg.tempOutputPath)) {
      try { fs.unlinkSync(reg.tempOutputPath); } catch (_) {}
    }
    jobRenderProcesses.delete(jobId);
    return true;
  }
  return false;
}

function pauseJobRenderProcess(jobId) {
  if (!jobId) return false;
  const reg = jobRenderProcesses.get(jobId);
  if (reg && reg.proc && !reg.proc.killed) {
    try {
      reg.interrupted = true;
      reg.paused = true;
      reg.proc.kill("SIGTERM");
    } catch (_) {}
    if (reg.tempOutputPath && fs.existsSync(reg.tempOutputPath)) {
      try { fs.unlinkSync(reg.tempOutputPath); } catch (_) {}
    }
    jobRenderProcesses.delete(jobId);
    return true;
  }
  return false;
}

/**
 * Builds the FFmpeg filter_complex chain for 9:16 vertical output (1080x1920).
 * When blurSubtitleBand is enabled (9:16 crop or native portrait with burned Khmer captions),
 * blurs and slightly darkens the bottom source subtitle band BEFORE ASS subtitle burning
 * so source burned-in Chinese captions are unreadable soft shapes beneath Khmer text.
 */
function buildVerticalVideoFilterChain({
  inputLabel = "[0:v:0]",
  outputLabel = "[final_video]",
  verticalStyle = "pad",
  blurSubtitleBand = false,
  blurBandY = 1592,
  blurRadius = 24,
  blurPower = 2,
  darkenBrightness = -0.08,
  segments = [],
  framingOverrides = [],
  framingKeyframes = [],
} = {}) {
  const isCrop = verticalStyle === "crop";
  const rawCropX = isCrop ? buildDynamicVerticalCropXExpr(segments, 1080, framingOverrides, framingKeyframes) : "(in_w-1080)/2";
  const cropXExpr = (rawCropX && rawCropX.startsWith("'") && rawCropX.endsWith("'"))
    ? rawCropX
    : (rawCropX && rawCropX.includes("between") ? `'${rawCropX}'` : (rawCropX || "(in_w-1080)/2"));
  const baseScaleFilter = isCrop
    ? `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:${cropXExpr}:(in_h-1920)/2,setsar=1`
    : "scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(1080-iw)/2:(1920-ih)/2:color=black,setsar=1";

  if (!blurSubtitleBand) {
    return [`${inputLabel}${baseScaleFilter}${outputLabel}`];
  }

  // Align Y and strip height to even integers for yuv420p and clamp chroma blur within FFmpeg limits.
  const rawY = Math.round(Number(blurBandY));
  const y = Math.max(0, Math.min(1856, (Number.isFinite(rawY) ? rawY : 1592) & ~1));
  const h = Math.max(16, (1920 - y) & ~1);
  const requestedR = Math.max(2, Math.round(Number(blurRadius) || 24));
  const maxChromaR = Math.max(1, Math.floor(h / 4) - 1);
  const chromaR = Math.min(requestedR, maxChromaR);
  const power = Math.max(1, Math.round(Number(blurPower) || 2));
  const brightness = Number.isFinite(Number(darkenBrightness)) ? Number(darkenBrightness) : -0.08;

  return [
    `${inputLabel}${baseScaleFilter},split[v_vert_main][v_vert_band_src]`,
    `[v_vert_band_src]crop=1080:${h}:0:${y},boxblur=luma_radius=${requestedR}:luma_power=${power}:chroma_radius=${chromaR}:chroma_power=${power},eq=brightness=${brightness.toFixed(2)}[v_vert_sub_blur]`,
    `[v_vert_main][v_vert_sub_blur]overlay=0:${y}${outputLabel}`,
  ];
}

/**
 * Builds a true Gaussian-blur watermark mask filter chain (`split -> crop -> gblur -> overlay`)
 * matching the frontend CornerMaskOverlay preview position, size, offset, and blur strength.
 * Safe across all resolutions and YUV420P chroma dimensions (uses gblur instead of boxblur).
 */
function buildCornerBlurVideoFilterChain({
  inputLabel = "[0:v:0]",
  outputLabel = "[v_corner_blur]",
  cornerMask = null,
  aspectRatio = "16:9",
  verticalStyle = "pad",
} = {}) {
  const baseW = Math.max(60, Math.min(500, Number(cornerMask?.width) || 220));
  const baseH = Math.max(20, Math.min(200, Number(cornerMask?.height) || 54));
  const rawOffX = cornerMask?.offsetX ?? cornerMask?.cornerMaskOffsetX;
  const rawOffY = cornerMask?.offsetY ?? cornerMask?.cornerMaskOffsetY;
  const rawBlur = cornerMask?.blurStrength ?? cornerMask?.cornerMaskBlur;
  const baseOffX = Math.max(0, Math.min(200, Number.isFinite(Number(rawOffX)) ? Number(rawOffX) : 14));
  const baseOffY = Math.max(0, Math.min(200, Number.isFinite(Number(rawOffY)) ? Number(rawOffY) : 14));
  const blurSigma = Math.max(4, Math.min(40, Number.isFinite(Number(rawBlur)) ? Number(rawBlur) : 18));
  const pos = String(cornerMask?.position || "top-right");
  const is916Letterbox = aspectRatio === "9:16" && verticalStyle !== "crop";

  const wFrac = (baseW / 1000).toFixed(4);
  const hFrac = (baseH / 1000).toFixed(4);
  const offXFrac = (baseOffX / 1000).toFixed(4);
  const offYFrac = (baseOffY / 1000).toFixed(4);

  const buildX = (W, w) =>
    pos === "top-left" || pos === "bottom-left"
      ? `max(0,min(${W}-${w},trunc(${W}*${offXFrac}/2)*2))`
      : `max(0,min(${W}-${w},${W}-${w}-trunc(${W}*${offXFrac}/2)*2))`;

  const buildY = (W, H, h) => {
    if (pos === "bottom-left" || pos === "bottom-right") {
      return is916Letterbox
        ? `max(0,min(${H}-${h},trunc(${H}*0.658-${h}-${W}*${offYFrac})))`
        : `max(0,min(${H}-${h},${H}-${h}-trunc(${W}*${offYFrac}/2)*2))`;
    }
    return is916Letterbox
      ? `max(0,min(${H}-${h},trunc(${H}*0.342+${W}*${offYFrac})))`
      : `max(0,min(${H}-${h},trunc(${W}*${offYFrac}/2)*2))`;
  };

  const cropW = `min(iw,max(16,trunc(iw*${wFrac}/2)*2))`;
  const cropH = `min(ih,max(16,trunc(iw*${hFrac}/2)*2))`;
  const cropX = buildX("iw", "ow");
  const cropY = buildY("iw", "ih", "oh");
  const ovX = buildX("W", "w");
  const ovY = buildY("W", "H", "h");

  return [
    `${inputLabel}split[v_cm_bg][v_cm_fg]`,
    `[v_cm_fg]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',gblur=sigma=${blurSigma}[v_cm_blurred]`,
    `[v_cm_bg][v_cm_blurred]overlay=x='${ovX}':y='${ovY}'${outputLabel}`,
  ];
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

    // AI Vocal Separation (Demucs): If enabled, separate audio first and use no_vocals.wav as clean background audio
    let separatedBgAudioPath = options.separatedBgAudioPath || null;
    if (options.enableDemucs && !separatedBgAudioPath) {
      console.log(`[FFmpegService] 🧠 AI Vocal Separation (Demucs) is active for: ${inputVideoPath}`);
      try {
        const sepRes = await audioSeparationService.separateAudio({
          audioPath: inputVideoPath,
          model: 'htdemucs',
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
    if (!isOriginalPassthrough && !hasValidMasterAudio && (validSegments.length > 20 || options.enableDemucs)) {
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
    const args = ["-y", "-i", safeInputVideo];
    const filterComplexParts = [];
    let tempFilterScriptPath = null;

    // Pre-calculate valid clips so ducking filter knows about muted video clips
    const validClips = (Array.isArray(videoClips) ? videoClips : [])
      .filter((c) => Number(c.end) > Number(c.start))
      .sort((a, b) => Number(a.start) - Number(b.start));

    let probedMeta = null;
    if (isOriginalPassthrough || onProgress) {
      try {
        probedMeta = await getVideoMetadata(inputVideoPath);
      } catch (_) {}
    }
    const effectiveExpectedDur = expectedDurationSec > 0
      ? expectedDurationSec
      : (probedMeta?.durationSec || 0);

    if (isOriginalPassthrough) {
      if (probedMeta && probedMeta.hasAudio === false) {
        filterComplexParts.push(`aevalsrc=0:s=44100:c=stereo[final_audio]`);
      } else {
        filterComplexParts.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo[final_audio]`);
      }
    } else if (hasValidMasterAudio) {
      // 🚀 Fast Path: streamlined render using pre-synchronized master Khmer narration audio
      args.push("-i", getSafeCliPath(activeMasterAudio));

      if (separatedBgAudioPath && fs.existsSync(separatedBgAudioPath)) {
        // AI Vocal Separation Mode (Demucs):
        // Input 0 = Video
        // Input 1 = Khmer Master Narration
        // Input 2 = no_vocals.wav (Clean BGM & Sound Effects, Chinese dialogue stripped)
        args.push("-i", getSafeCliPath(separatedBgAudioPath));
        const effectiveBgDuck = Math.max(0.04, Math.min(0.20, Number(bgVolume) || 0.15));
        const effectiveBgNormal = Math.max(0.30, Math.min(1.0, Number((bgVolume * 2.0).toFixed(2))));
        const bgFilter = (validSegments.length > 0 && soundMode === "ducking")
          ? buildDynamicDuckingFilter(validSegments, effectiveBgDuck, effectiveBgNormal, validClips)
          : `volume=${effectiveBgDuck.toFixed(2)}`;
        console.log(`[FFmpegService] 🎚️ Mixing Demucs separated BGM (duck: ${effectiveBgDuck.toFixed(2)}, normal: ${effectiveBgNormal.toFixed(2)}) + Khmer voice (volume: ${khmerVolume.toFixed(2)})`);
        filterComplexParts.push(
          `[2:a]aformat=sample_rates=44100:channel_layouts=stereo,${bgFilter}[clean_bg]`,
          `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${khmerVolume.toFixed(2)}[khmer_bus]`,
          `[clean_bg][khmer_bus]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[final_audio]`
        );
      } else {
        const effectiveBgNormal = bgVolume <= 0.05 ? bgVolume : Math.min(1.0, Number((bgVolume * 1.5).toFixed(2)));
        const duckFilter = buildDynamicDuckingFilter(validSegments, bgVolume, effectiveBgNormal, validClips);
        if (soundMode === "replace" || bgVolume <= 0.01) {
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
      // Fallback Path: Multi-segment adelay + amix with steady normalization guard
      validSegments.forEach((seg) => {
        args.push("-i", getSafeCliPath(seg.audioPath));
      });

      const delayedVoiceLabels = [];
      validSegments.forEach((seg, index) => {
        const inputIndex = index + 1;
        const segStart = Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? 0);
        const delayMs = Math.max(0, Math.round(segStart * 1000));
        const label = `v${inputIndex}`;

        let segDur = Number(seg.duration || seg.audioDurationSec || 2.5);
        let trimDur = null;
        if (seg.audioTrimmed && typeof seg.audioEndSec === "number" && typeof seg.audioStartSec === "number" && seg.audioEndSec > seg.audioStartSec) {
          trimDur = Math.max(0.1, parseFloat((seg.audioEndSec - seg.audioStartSec).toFixed(3)));
          segDur = trimDur;
        } else if ((seg.audioTrimmed || seg.userTrimmed) && typeof seg.audioDurationSec === "number" && seg.audioDurationSec > 0) {
          trimDur = seg.audioDurationSec;
          segDur = trimDur;
        }
        const rawOffset = typeof seg.audioOffset === "number" && !isNaN(seg.audioOffset) ? seg.audioOffset : 0;
        const audioOffset = (trimDur && rawOffset >= trimDur) ? 0 : Math.max(0, rawOffset);

        const segEnd = segStart + segDur;
        const nextOverlap = validSegments.slice(index + 1).find((next) => {
          const nStart = Number(next.startSeconds ?? next.startSec ?? next.audioStartSec ?? 0);
          return nStart > segStart && nStart < segEnd;
        });

        let volFilter = `volume=${khmerVolume.toFixed(2)}`;
        if (nextOverlap) {
          const duckRelSec = Math.max(0.15, parseFloat((Number(nextOverlap.startSeconds ?? nextOverlap.startSec ?? nextOverlap.audioStartSec ?? 0) - segStart).toFixed(2)));
          volFilter = `volume=eval=frame:volume='if(gte(t,${duckRelSec}),${(khmerVolume * 0.5).toFixed(2)},${khmerVolume.toFixed(2)})'`;
        }

        let trimFilter = "";
        if (trimDur && trimDur > 0) {
          trimFilter = `atrim=start=${audioOffset}:duration=${trimDur},asetpts=PTS-STARTPTS,`;
        } else if (audioOffset > 0) {
          trimFilter = `atrim=start=${audioOffset},asetpts=PTS-STARTPTS,`;
        }

        filterComplexParts.push(
          `[${inputIndex}:a]${trimFilter}aformat=sample_rates=44100:channel_layouts=stereo,${volFilter},adelay=${delayMs}|${delayMs}[${label}]`
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

      if (soundMode === "replace" || bgVolume <= 0.01) {
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
      const scaledW = Math.max(40, Math.min(260, Math.round(baseLogoSize * 1.5)));
      const scaledH = scaledW;
      const opacity = Math.max(0.1, Math.min(1.0, Number(logoSettings.opacity || logoSettings.logoOpacity) || 0.9));
      const baseMargin = Math.max(10, Math.min(100, Math.round((Number(logoSettings.margin || logoSettings.logoMargin) || 20) * 1.5)));
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
        args.push("-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "23");
      } else {
        args.push("-c:v", "libx264", "-preset", "superfast", "-crf", "22", "-threads", "0");
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
      jobRenderProcesses.set(jobId, regRecord);
    }

    if (options.signal) {
      if (options.signal.aborted) {
        try { proc.kill("SIGTERM"); } catch (_) {}
        if (fs.existsSync(tempOutputVideoPath)) {
          try { fs.unlinkSync(tempOutputVideoPath); } catch (_) {}
        }
        if (jobId) jobRenderProcesses.delete(jobId);
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
          if (jobId) jobRenderProcesses.delete(jobId);
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
      if (jobId) jobRenderProcesses.delete(jobId);
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
      if (jobId) jobRenderProcesses.delete(jobId);
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

function wrapKhmerSubtitleText(text, maxLineChars = 28) {
  if (!text) return "";
  const clean = text.trim().replace(/\r?\n+/g, " ");
  if (clean.length <= maxLineChars) return clean;

  const words = clean.split(/\s+/);
  if (words.length > 1) {
    let line1 = "";
    let line2 = "";
    const targetHalf = Math.ceil(clean.length / 2);
    let currentLen = 0;

    for (const w of words) {
      if (currentLen + w.length <= targetHalf || !line1) {
        line1 = line1 ? line1 + " " + w : w;
        currentLen += w.length + 1;
      } else {
        line2 = line2 ? line2 + " " + w : w;
      }
    }
    if (line2) return line1 + "\n" + line2;
  }

  const isKhmerConsonant = (c) => c >= "\u1780" && c <= "\u17A2";
  const isCoeng = (c) => c === "\u17D2";
  const target = Math.ceil(clean.length / 2);
  let safeIdx = target;
  for (let offset = 0; offset <= 8; offset++) {
    const idx1 = target - offset;
    if (idx1 > 0 && idx1 < clean.length && isKhmerConsonant(clean[idx1]) && !isCoeng(clean[idx1 - 1])) {
      safeIdx = idx1;
      break;
    }
    const idx2 = target + offset;
    if (idx2 > 0 && idx2 < clean.length && isKhmerConsonant(clean[idx2]) && !isCoeng(clean[idx2 - 1])) {
      safeIdx = idx2;
      break;
    }
  }

  return clean.slice(0, safeIdx) + "\n" + clean.slice(safeIdx);
}

function generateSrtFile(segments, outputPath) {
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return null;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let srtContent = "";
  segments.forEach((seg, index) => {
    const hasVoice = Boolean(
      seg.audioUrl || seg.audioPath || seg.rawAudioPath || seg.audioFile || seg.rawAudioFile ||
      seg.ttsStatus === "ready" || seg.status === "audio_ready" ||
      (typeof seg.finalAudioDuration === "number" && seg.finalAudioDuration > 0) ||
      (typeof seg.audioDuration === "number" && seg.audioDuration > 0) ||
      (typeof seg.audioDurationSec === "number" && seg.audioDurationSec > 0)
    );

    let startSec = Number(
      (hasVoice && seg.audioStartSec !== undefined && seg.audioStartSec !== null && !isNaN(Number(seg.audioStartSec)))
        ? seg.audioStartSec
        : (typeof seg.startSec === "number" && !isNaN(seg.startSec) ? seg.startSec : parseTimeToSec(seg.start, index * 4))
    );

    const realAudioDur = hasVoice
      ? (seg.finalAudioDuration ?? seg.audioDurationSec ?? seg.audioDuration ?? seg.originalAudioDuration ?? seg.rawAudioDur)
      : null;

    const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
    let endSec;
    if (isTrimmed && typeof seg.audioEndSec === "number" && !isNaN(seg.audioEndSec)) {
      endSec = seg.audioEndSec;
    } else if (realAudioDur && !isNaN(realAudioDur) && realAudioDur > 0) {
      endSec = startSec + Number(realAudioDur);
    } else if (typeof seg.endSec === "number" && !isNaN(seg.endSec)) {
      endSec = seg.endSec;
    } else {
      endSec = parseTimeToSec(seg.end, startSec + 2.5);
    }

    const srtDur = endSec - startSec;
    if (endSec <= startSec || isNaN(srtDur) || srtDur <= 0.1) {
      const textLen = (seg.khmerText || seg.khmer || "").length || 8;
      endSec = parseFloat((startSec + Math.max(1.2, Math.min(5.0, textLen * 0.16))).toFixed(2));
    }

    const startTime = toSrtTime(startSec);
    const endTime = toSrtTime(endSec);

    srtContent += `${index + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    const formattedKhmer = wrapKhmerSubtitleText(seg.khmerText || seg.khmer || "");
    srtContent += `${formattedKhmer}\n\n`;
  });

  fs.writeFileSync(outputPath, srtContent, "utf-8");
  return outputPath;
}

function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error("File not found: " + filePath));
    }
    const safePath = getSafeCliPath(filePath);
    ffmpeg.ffprobe(safePath, (err, metadata) => {
      if (err) return reject(err);

      const vStream = metadata.streams.find((s) => s.codec_type === "video") || {};
      const aStream = metadata.streams.find((s) => s.codec_type === "audio") || {};
      const duration = parseFloat(metadata.format.duration || 0);

      let fps = 30;
      if (vStream.r_frame_rate) {
        const parts = vStream.r_frame_rate.split("/");
        if (parts.length === 2 && parseFloat(parts[1]) > 0) {
          fps = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]));
        }
      }

      const width = vStream.width || 0;
      const height = vStream.height || 0;
      resolve({
        duration,
        durationSec: duration,
        width,
        height,
        resolution: width > 0 && height > 0 ? `${width}x${height}` : "N/A",
        fps,
        videoCodec: vStream.codec_name || "unknown",
        audioCodec: aStream.codec_name || "none",
        audioChannels: aStream.channels || (aStream.codec_name ? 2 : 0),
        hasAudio: Boolean(aStream.codec_name),
        bitrate: metadata.format.bit_rate ? Math.round(metadata.format.bit_rate / 1000) : 0,
        sizeMB: metadata.format.size ? parseFloat((metadata.format.size / (1024 * 1024)).toFixed(2)) : 0,
      });
    });
  });
}

function getMediaInfo(filePath) {
  return new Promise((resolve, reject) => {
    const safePath = getSafeCliPath(filePath);
    ffmpeg.ffprobe(safePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata);
    });
  });
}

/**
 * Safely extracts a finite, non-negative timeline offset in seconds from a Number or String.
 * Rejects NaN, Infinity, -Infinity, negative values (< 0), empty strings, and malformed timecodes.
 * Treats numeric 0 and string "0" as completely valid.
 */
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
    const mixBatch = (segs, outPath, isWav = false, allowRetry = true) => {
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

          preparedSegs.forEach((seg, idx) => {
            command.input(getSafeCliPath(seg.audioPath));
            const startMs = Math.max(0, Math.round(seg.startSec * 1000));
            const nextOverlap = preparedSegs.slice(idx + 1).find((next) => next.startSec > seg.startSec && next.startSec < seg.endSec);
            let filterChain = "";
            const rawOffset = typeof seg.audioOffset === "number" && !isNaN(seg.audioOffset) ? seg.audioOffset : 0;
            const dur = typeof seg.durSec === "number" && !isNaN(seg.durSec) ? seg.durSec : null;
            const audioOffset = (dur && rawOffset >= dur) ? 0 : Math.max(0, rawOffset);

            let trimPrefix = "";
            if (dur > 0 && (seg.audioTrimmed || seg.userTrimmed || audioOffset > 0)) {
              trimPrefix = `atrim=start=${audioOffset}:duration=${dur},asetpts=PTS-STARTPTS,`;
            }

            if (nextOverlap) {
              const duckRelSec = Math.max(0.15, parseFloat((nextOverlap.startSec - seg.startSec).toFixed(2)));
              filterChain = `${trimPrefix}volume=eval=frame:volume='if(gte(t,${duckRelSec}),0.40,1.0)',adelay=${startMs}|${startMs}`;
            } else {
              filterChain = `${trimPrefix}adelay=${startMs}|${startMs}`;
            }
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
        const batchWavPath = path.join(outDir, `.tmp_sync_batch_${Date.now()}_${batchNum}.wav`);
        const builtChunk = await mixBatch(batchSegs, batchWavPath, true);
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
          const { saveCheckpoint } = require("./pipeline/checkpointManager");
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

async function extractFramesAtTimestamps(inputVideoPath, timestampsSec = [], outputDir, options = {}) {
  if (options?.signal?.aborted) {
    throw createAbortError("Frame extraction aborted");
  }
  if (!fs.existsSync(inputVideoPath)) {
    throw new Error(`រកមិនឃើញវីដេអូដើម៖ ${inputVideoPath}`);
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Deduplicate and sort timestamps chronologically
  const uniqueTimes = Array.from(
    new Set(
      (timestampsSec || [])
        .map((t) => parseFloat(Math.max(0, Number(t) || 0).toFixed(2)))
        .filter((t) => Number.isFinite(t))
    )
  ).sort((a, b) => a - b);

  if (uniqueTimes.length === 0) {
    return [];
  }

  const safeInputPath = getSafeCliPath(inputVideoPath);
  const signal = options?.signal || null;

  // Internal single-frame direct seek helper (MUST NOT re-acquire ffmpegHeavySemaphore)
  const extractSingleDirect = (safeSec) => {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(createAbortError("Frame extraction aborted"));
      }
      const outFileName = `frame_${safeSec.toFixed(2).replace(".", "_")}.jpg`;
      const outPath = path.join(outputDir, outFileName);

      const args = [
        "-y",
        "-ss", safeSec.toFixed(3),
        "-i", safeInputPath,
        "-an", "-sn",
        "-threads", "2",
        "-vf", "scale=-2:360",
        "-vframes", "1",
        "-q:v", "3",
        outPath,
      ];

      let settled = false;
      const proc = spawn(FFMPEG_PATH, args, {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      const detachAbort = attachAbortKill(proc, signal, () => {
        if (!settled) {
          settled = true;
          reject(createAbortError("Frame extraction aborted"));
        }
      });

      proc.on("close", (code) => {
        detachAbort();
        if (settled) return;
        settled = true;
        if (signal?.aborted) {
          return reject(createAbortError("Frame extraction aborted"));
        }
        if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 400) {
          resolve({ timestampSec: safeSec, filePath: outPath });
        } else {
          resolve(null);
        }
      });
      proc.on("error", (err) => {
        detachAbort();
        if (settled) return;
        settled = true;
        if (signal?.aborted) {
          return reject(createAbortError("Frame extraction aborted"));
        }
        console.warn(`[FFmpegService] ⚠️ Frame extraction at ${safeSec}s failed:`, err.message);
        resolve(null);
      });
    });
  };

  // Single-pass windowed select + showinfo helper (1 FFmpeg process per dense window)
  const extractWindowSinglePass = async (windowTimes, winIndex) => {
    if (signal?.aborted) {
      throw createAbortError("Frame extraction aborted");
    }

    const winStart = Math.max(0, windowTimes[0] - 0.25);
    const winEnd = windowTimes[windowTimes.length - 1] + 0.35;
    const winDur = Math.max(0.5, winEnd - winStart);

    const terms = windowTimes.map((t) => {
      const thresh = (t - 0.02).toFixed(3);
      return `(isnan(prev_selected_t)+lte(prev_selected_t,${thresh}))*gte(t,${thresh})`;
    });
    const filterGraph = `select='${terms.join("+")}',showinfo,scale=-2:360`;

    const prefix = `selw_${winIndex}_${Date.now()}_`;
    const outPattern = path.join(outputDir, `${prefix}%05d.jpg`);
    const safeOutPattern = getSafeCliPath(outPattern);

    let ptsList = [];
    try {
      ptsList = await new Promise((resolve, reject) => {
        if (signal?.aborted) {
          return reject(createAbortError("Frame extraction aborted"));
        }
        const args = [
          "-y",
          "-ss", winStart.toFixed(3),
          "-t", winDur.toFixed(3),
          "-copyts",
          "-i", safeInputPath,
          "-an", "-sn",
          "-threads", "2",
          "-vf", filterGraph,
          ...FFMPEG_VFR_ARGS,
          "-q:v", "3",
          safeOutPattern,
        ];

        let settled = false;
        const proc = spawn(FFMPEG_PATH, args, {
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
        });

        let stderrText = "";
        proc.stderr.on("data", (d) => {
          stderrText += d.toString("utf8");
        });

        const detachAbort = attachAbortKill(proc, signal, () => {
          if (!settled) {
            settled = true;
            reject(createAbortError("Frame extraction aborted"));
          }
        });

        proc.on("close", () => {
          detachAbort();
          if (settled) return;
          settled = true;
          if (signal?.aborted) {
            return reject(createAbortError("Frame extraction aborted"));
          }
          const extractedPts = [];
          const regex = /pts_time:\s*([0-9.]+)/g;
          let m;
          while ((m = regex.exec(stderrText)) !== null) {
            const val = parseFloat(m[1]);
            if (Number.isFinite(val)) extractedPts.push(val);
          }
          resolve(extractedPts);
        });

        proc.on("error", () => {
          detachAbort();
          if (settled) return;
          settled = true;
          if (signal?.aborted) {
            return reject(createAbortError("Frame extraction aborted"));
          }
          resolve([]);
        });
      });

      const producedFiles = fs
        .readdirSync(outputDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith(".jpg"))
        .sort()
        .map((f) => path.join(outputDir, f));

      const matchedResults = new Map();
      const missedTimes = [];

      if (producedFiles.length > 0 && producedFiles.length === ptsList.length) {
        for (const targetT of windowTimes) {
          let bestIdx = -1;
          let bestDiff = Infinity;
          for (let i = 0; i < ptsList.length; i++) {
            const diff = Math.abs(ptsList[i] - targetT);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestIdx = i;
            }
          }
          if (bestIdx >= 0 && bestDiff <= 0.45 && fs.existsSync(producedFiles[bestIdx]) && fs.statSync(producedFiles[bestIdx]).size > 400) {
            const destName = `frame_${targetT.toFixed(2).replace(".", "_")}.jpg`;
            const destPath = path.join(outputDir, destName);
            fs.copyFileSync(producedFiles[bestIdx], destPath);
            matchedResults.set(targetT, { timestampSec: targetT, filePath: destPath });
          } else {
            missedTimes.push(targetT);
          }
        }
      } else {
        missedTimes.push(...windowTimes);
      }

      // Remove temporary window files before any targeted fallback
      for (const pf of producedFiles) {
        try { fs.unlinkSync(pf); } catch (_) {}
      }

      for (const missedT of missedTimes) {
        if (signal?.aborted) throw createAbortError("Frame extraction aborted");
        const directRes = await extractSingleDirect(missedT);
        if (directRes) matchedResults.set(missedT, directRes);
      }

      return windowTimes.map((t) => matchedResults.get(t)).filter(Boolean);
    } finally {
      try {
        const leftovers = fs.readdirSync(outputDir).filter((f) => f.startsWith(prefix) && f.endsWith(".jpg"));
        for (const lf of leftovers) {
          try { fs.unlinkSync(path.join(outputDir, lf)); } catch (_) {}
        }
      } catch (_) {}
    }
  };

  return await ffmpegHeavySemaphore.run(async () => {
    // Partition sorted timestamps into contiguous windows (gap <= 12s, max 40 inline select clauses for safe CLI length)
    const windows = [];
    let currentWin = [];
    for (const t of uniqueTimes) {
      if (currentWin.length === 0) {
        currentWin.push(t);
      } else {
        const prev = currentWin[currentWin.length - 1];
        if ((t - prev) > 12.0 || currentWin.length >= 40) {
          windows.push(currentWin);
          currentWin = [t];
        } else {
          currentWin.push(t);
        }
      }
    }
    if (currentWin.length > 0) windows.push(currentWin);

    const results = [];
    for (let wIdx = 0; wIdx < windows.length; wIdx++) {
      if (signal?.aborted) {
        throw createAbortError("Frame extraction aborted");
      }
      const win = windows[wIdx];
      // For sparse 1-2 frame windows spaced > 4s apart, direct fast seek avoids decoding intermediate frames
      if (win.length === 1 || (win.length === 2 && (win[1] - win[0]) > 4.0)) {
        for (const t of win) {
          const singleRes = await extractSingleDirect(t);
          if (singleRes) results.push(singleRes);
        }
      } else {
        const winRes = await extractWindowSinglePass(win, wIdx);
        results.push(...winRes);
      }
    }

    return results;
  }, { signal });
}

/**
 * Fast streaming extraction of timestamped 360p frames using FFmpeg's fps filter.
 * Extracts frames at regular intervals across a given time window in a single FFmpeg process.
 * 
 * @param {string} inputVideoPath
 * @param {number} startSec
 * @param {number} durationSec
 * @param {number} fps - e.g. 1.4 (one frame every ~0.71s)
 * @param {string} outputDir
 * @param {object} [options={}]
 * @returns {Promise<Array<{ index: number, timestampSec: number, filePath: string }>>}
 */
function extractFramesStreaming(inputVideoPath, startSec = 0, durationSec = 0, fps = 1.4, outputDir = null, options = {}) {
  const signal = options?.signal || null;
  return ffmpegHeavySemaphore.run(() => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(createAbortError("Streaming frame extraction aborted"));
    }
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return reject(new Error(`Input video not found: ${inputVideoPath}`));
    }
    if (!outputDir) {
      return reject(new Error('Output directory required for streaming frame extraction'));
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeInputPath = getSafeCliPath(inputVideoPath);
    const safeStartSec = Math.max(0, Number(startSec) || 0);
    const outPattern = path.join(outputDir, 'frame_%05d.jpg');

    const args = [
      '-y',
      '-ss', safeStartSec.toFixed(3),
    ];
    if (durationSec > 0) {
      args.push('-t', Number(durationSec).toFixed(3));
    }
    args.push(
      '-i', safeInputPath,
      '-an', '-sn',
      '-threads', '2',
      '-vf', `fps=${fps},scale=-2:360`,
      '-q:v', '3',
      outPattern
    );

    let settled = false;
    const proc = spawn(FFMPEG_PATH, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const detachAbort = attachAbortKill(proc, signal, () => {
      if (!settled) {
        settled = true;
        reject(createAbortError("Streaming frame extraction aborted"));
      }
    });

    proc.on('close', (code) => {
      detachAbort();
      if (settled) return;
      settled = true;
      if (signal?.aborted) {
        return reject(createAbortError("Streaming frame extraction aborted"));
      }
      if (code !== 0) {
        console.warn(`[FFmpegService] Streaming frame extraction notice (code ${code}):`, stderr.slice(-300));
      }
      try {
        const files = fs.readdirSync(outputDir).filter((f) => f.startsWith('frame_') && f.endsWith('.jpg')).sort();
        const step = 1 / fps;
        const results = files.map((file, idx) => {
          const t = parseFloat((safeStartSec + idx * step).toFixed(2));
          return {
            index: idx + 1,
            timestampSec: t,
            filePath: path.join(outputDir, file),
          };
        });
        resolve(results);
      } catch (err) {
        reject(err);
      }
    });

    proc.on('error', (err) => {
      detachAbort();
      if (settled) return;
      settled = true;
      if (signal?.aborted) {
        return reject(createAbortError("Streaming frame extraction aborted"));
      }
      reject(err);
    });
  }), { signal });
}

/**
 * Fast subtitle area difference grid extractor using raw grayscale thumbnails.
 * Extracts small center-bottom safe-zone thumbnails at ~5 fps (`crop=w=0.72*iw:h=0.16*ih:x=0.14*iw:y=0.78*ih`)
 * so corner logos, floating watermarks, or background flashes do not trigger false splits.
 * Runs completely locally with FFmpeg in ~1-2s per chunk with zero API calls.
 */
function extractSubtitleDifferenceGrid(inputVideoPath, startSec = 0, durationSec = 0, fps = 5.0, options = {}) {
  const signal = options?.signal || null;
  const roiCrop = options?.roiCrop || 'crop=w=0.72*iw:h=0.16*ih:x=0.14*iw:y=0.78*ih';
  return ffmpegHeavySemaphore.run(() => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(createAbortError("Subtitle difference grid aborted"));
    }
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) return resolve([]);
    const safeInputPath = getSafeCliPath(inputVideoPath);
    const safeStartSec = Math.max(0, Number(startSec) || 0);
    const scaleW = 128;
    const scaleH = 32;

    const args = ['-y', '-ss', safeStartSec.toFixed(3)];
    if (durationSec > 0) {
      args.push('-t', Number(durationSec).toFixed(3));
    }
    args.push(
      '-i', safeInputPath,
      '-an', '-sn',
      '-threads', '2',
      '-vf', `fps=${fps},${roiCrop},scale=${scaleW}:${scaleH},format=gray`,
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      '-'
    );

    let settled = false;
    const proc = spawn(FFMPEG_PATH, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));

    const detachAbort = attachAbortKill(proc, signal, () => {
      if (!settled) {
        settled = true;
        reject(createAbortError("Subtitle difference grid aborted"));
      }
    });

    proc.on('close', () => {
      detachAbort();
      if (settled) return;
      settled = true;
      if (signal?.aborted) {
        return reject(createAbortError("Subtitle difference grid aborted"));
      }
      const buf = Buffer.concat(chunks);
      const frameSize = scaleW * scaleH;
      const count = Math.floor(buf.length / frameSize);
      const step = 1 / fps;
      const diffs = [];

      for (let i = 0; i < count; i++) {
        const t = parseFloat((safeStartSec + i * step).toFixed(2));
        if (i === 0) {
          diffs.push({ timestampSec: t, diff: 0, subDiff: 0, isChange: false });
          continue;
        }
        const fPrev = buf.subarray((i - 1) * frameSize, i * frameSize);
        const fCurr = buf.subarray(i * frameSize, (i + 1) * frameSize);
        let sum = 0;
        let subSum = 0;
        let subPixels = 0;
        let bgSum = 0;
        let bgPixels = 0;
        let strokePixels = 0;

        for (let r = 0; r < scaleH; r++) {
          for (let c = 0; c < scaleW; c++) {
            const p = r * scaleW + c;
            const d = Math.abs(fPrev[p] - fCurr[p]);
            sum += d;
            const isSubBox = (r >= 4 && r <= 28 && c >= 8 && c <= 120);
            if (isSubBox) {
              subSum += d;
              subPixels++;
              if (d >= 35 || fCurr[p] >= 200 || fPrev[p] >= 200) {
                strokePixels++;
              }
            } else {
              bgSum += d;
              bgPixels++;
            }
          }
        }
        const avg = sum / frameSize;
        const subAvg = subPixels > 0 ? subSum / subPixels : avg;
        const bgAvg = bgPixels > 0 ? bgSum / bgPixels : avg;
        const netSubDiff = Math.max(0, subAvg - (bgAvg * 0.5));
        const strokeRatio = strokePixels / (subPixels || 1);

        diffs.push({
          timestampSec: t,
          diff: parseFloat(avg.toFixed(2)),
          subDiff: parseFloat(subAvg.toFixed(2)),
          bgDiff: parseFloat(bgAvg.toFixed(2)),
          netSubDiff: parseFloat(netSubDiff.toFixed(2)),
          strokeDiff: parseFloat(strokeRatio.toFixed(3)),
          isChange: subAvg >= 11.5 || avg >= 14.0 || netSubDiff >= 7.0 || strokeRatio >= 0.08,
        });
      }
      resolve(diffs);
    });
    proc.on('error', () => {
      detachAbort();
      if (settled) return;
      settled = true;
      if (signal?.aborted) {
        return reject(createAbortError("Subtitle difference grid aborted"));
      }
      resolve([]);
    });
  }), { signal });
}

/**
 * Change-driven subtitle onset and candidate cue state detector.
 * Performs a fast local pre-pass (zero API calls) using consecutive center-bottom safe-zone pixel diffs
 * (`w=0.72*iw:h=0.16*ih:x=0.14*iw:y=0.78*ih`).
 * Supports short dialogue cues down to 0.35s (`minCueDurationSec = 0.35`).
 * Every detected change point starts a candidate cue state with sampleASec (onset) and sampleBSec (mid-cue).
 *
 * @param {string} inputVideoPath
 * @param {number} startSec
 * @param {number} durationSec
 * @param {number} [fps=5.0]
 * @param {object} [options={}]
 * @returns {Promise<{ changePoints: Array, cueStates: Array, frameDiffs: Array }>}
 */
async function detectSubtitleChangePoints(inputVideoPath, startSec = 0, durationSec = 0, fps = 5.0, options = {}) {
  const diffs = await extractSubtitleDifferenceGrid(inputVideoPath, startSec, durationSec, fps, options);
  if (!diffs || diffs.length === 0) {
    return { changePoints: [], cueStates: [], frameDiffs: [] };
  }

  const changePoints = [];
  const minPeakDist = typeof options?.minPeakDist === 'number' ? options.minPeakDist : 0.35; // preserves short cues down to 0.35s
  const minCueDurationSec = typeof options?.minCueDurationSec === 'number' ? options.minCueDurationSec : 0.35;

  for (let i = 1; i < diffs.length - 1; i++) {
    const prev = diffs[i - 1].subDiff;
    const curr = diffs[i].subDiff;
    const next = diffs[i + 1].subDiff;

    const isPeak = (curr >= 10.0 && curr >= prev && curr >= next);
    const isSharpRise = (curr >= 13.5 && curr > prev * 1.25);
    const isProminentLocal = (curr >= 8.5 && curr >= prev + 2.0 && curr >= next + 2.0);

    if (isPeak || isSharpRise || isProminentLocal) {
      const last = changePoints[changePoints.length - 1];
      if (!last || (diffs[i].timestampSec - last.timestampSec) >= minPeakDist) {
        changePoints.push(diffs[i]);
      } else if (curr > last.subDiff) {
        changePoints[changePoints.length - 1] = diffs[i];
      }
    }
  }

  // Construct candidate cue states between consecutive change points
  const safeStart = Math.max(0, Number(startSec) || 0);
  const endSec = durationSec > 0 ? safeStart + durationSec : (diffs[diffs.length - 1].timestampSec + 0.2);

  const cpTimes = changePoints.map((c) => c.timestampSec);
  if (cpTimes.length === 0 || cpTimes[0] > safeStart + 0.35) {
    cpTimes.unshift(parseFloat(safeStart.toFixed(2)));
  }
  if (cpTimes[cpTimes.length - 1] < endSec - 0.35) {
    cpTimes.push(parseFloat(endSec.toFixed(2)));
  }

  const cueStates = [];
  for (let i = 0; i < cpTimes.length - 1; i++) {
    const cStart = cpTimes[i];
    const cEnd = cpTimes[i + 1];
    const dur = parseFloat((cEnd - cStart).toFixed(2));
    if (dur >= minCueDurationSec) {
      cueStates.push({
        cueIndex: cueStates.length + 1,
        startSec: cStart,
        endSec: cEnd,
        duration: dur,
        sampleASec: parseFloat((cStart + Math.min(0.12, dur * 0.25)).toFixed(2)),
        sampleBSec: parseFloat(((cStart + cEnd) / 2).toFixed(2)),
        sampleTieSec: parseFloat((cStart + dur * 0.75).toFixed(2)),
      });
    }
  }

  return { changePoints, cueStates, frameDiffs: diffs };
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



/**
 * Splits a long video (e.g. 1-2 hours) into episode clips of specified duration (e.g. 8 mins)
 * using lossless fast stream copy (-c copy). Takes just a few seconds!
 */
async function splitVideoIntoEpisodes({
  inputVideoPath,
  targetDurationSec,
  outputDir,
  filePrefix = "ep",
}) {
  if (!targetDurationSec || Number(targetDurationSec) <= 0) {
    throw new Error("targetDurationSec must be specified and greater than 0");
  }
  if (!fs.existsSync(inputVideoPath)) {
    throw new Error("Input video file does not exist: " + inputVideoPath);
  }

  const meta = await getVideoMetadata(inputVideoPath);
  const totalDuration = meta.duration || 0;
  if (totalDuration <= 0) {
    throw new Error("Cannot determine duration of video: " + inputVideoPath);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const chunks = [];
  let currentStart = 0;
  let epIndex = 1;

  while (currentStart < totalDuration) {
    const chunkDuration = Math.min(targetDurationSec, totalDuration - currentStart);
    const minTailDuration = Math.min(15, targetDurationSec * 0.25);
    if (chunkDuration < minTailDuration && chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      prev.duration += chunkDuration;
      prev.end = totalDuration;
      break;
    }

    const chunkEnd = currentStart + chunkDuration;
    const outputFilename = `${filePrefix}_${epIndex}_source.mp4`;
    const outputPath = path.join(outputDir, outputFilename);

    chunks.push({
      episodeNumber: epIndex,
      start: currentStart,
      end: chunkEnd,
      duration: chunkDuration,
      outputFilename,
      outputPath,
    });

    currentStart += chunkDuration;
    epIndex++;
  }

  console.log(`[FFmpegService] ✂️ Splitting video (${totalDuration.toFixed(1)}s) into ${chunks.length} episodes (${(targetDurationSec / 60).toFixed(0)} min/ep)...`);

  const results = [];
  for (const chunk of chunks) {
    const safeIn = getSafeCliPath(inputVideoPath);
    const safeOut = getSafeCliPath(chunk.outputPath);

    const args = [
      "-y",
      "-ss", String(chunk.start.toFixed(3)),
      "-i", safeIn,
      "-t", String(chunk.duration.toFixed(3)),
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      safeOut,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let errLog = "";
      proc.stderr.on("data", (d) => { errLog += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0 && fs.existsSync(chunk.outputPath)) {
          results.push(chunk);
          resolve();
        } else {
          console.warn(`[FFmpegService] Fast copy failed for Ep ${chunk.episodeNumber}, attempting re-encode...`);
          const fallbackArgs = [
            "-y",
            "-ss", String(chunk.start.toFixed(3)),
            "-i", safeIn,
            "-t", String(chunk.duration.toFixed(3)),
            "-c:v", checkQsvSupport() ? "h264_qsv" : "libx264",
            "-preset", "superfast",
            "-crf", "22",
            "-c:a", "aac",
            safeOut,
          ];
          const proc2 = spawn(FFMPEG_PATH, fallbackArgs, { stdio: "ignore", windowsHide: true });
          proc2.on("error", reject);
          proc2.on("close", (c2) => {
            if (c2 === 0 && fs.existsSync(chunk.outputPath)) {
              results.push(chunk);
              resolve();
            } else {
              reject(new Error(`Failed to create episode clip: code ${c2}`));
            }
          });
        }
      });
      proc.on("error", reject);
    });
  }

  console.log(`[FFmpegService] ✅ Successfully split video into ${results.length} episodes!`);
  return results;
}

/**
 * Fast timeline thumbnail extraction using keyframe jumping (-skip_frame nokey)
 * Generates lightweight (120x68) JPEG snapshots every ~4 seconds.
 * Returns array of { index, timestampSec, url, filePath }
 */
async function getOrCreateVideoThumbnails(videoPath, episodeDir = null, durationSec = 30) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Determine thumbnails directory
  let thumbDir;
  if (episodeDir && typeof episodeDir === 'string') {
    thumbDir = path.join(episodeDir, 'thumbnails');
  } else {
    const parentDir = path.dirname(videoPath);
    thumbDir = path.join(parentDir, 'thumbnails');
  }

  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }

  // Check if thumbnails already exist
  const existingFiles = fs.readdirSync(thumbDir)
    .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
    .sort();

  const totalDur = Math.max(1, Number(durationSec) || 30);
  const uploadsRoot = path.resolve(__dirname, '../uploads');

  if (existingFiles.length >= 10) {
    const step = totalDur / existingFiles.length;
    return existingFiles.map((f, idx) => {
      const fullPath = path.join(thumbDir, f);
      const relPath = path.relative(uploadsRoot, fullPath).replace(/\\/g, '/');
      return {
        index: idx,
        timestampSec: parseFloat((idx * step).toFixed(2)),
        url: `/uploads/${relPath}`,
        filePath: fullPath,
      };
    });
  }

  // Extract keyframes using FFmpeg
  const safeInput = getSafeCliPath(videoPath);
  const outPattern = path.join(thumbDir, 'thumb_%04d.jpg');
  // Sample every ~4 seconds (fps = 0.25)
  const fps = '0.25';

  await new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, [
      '-y',
      '-skip_frame', 'nokey',
      '-i', safeInput,
      '-an', '-sn',
      '-vf', `fps=${fps},scale=120:68`,
      '-q:v', '5',
      outPattern
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        console.warn(`[FFmpegService] Thumbnail extraction notice (code ${code}):`, stderr.slice(-300));
      }
      resolve();
    });
    proc.on('error', reject);
  });

  const files = fs.readdirSync(thumbDir)
    .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
    .sort();

  const step = files.length > 0 ? totalDur / files.length : 1;
  return files.map((f, idx) => {
    const fullPath = path.join(thumbDir, f);
    const relPath = path.relative(uploadsRoot, fullPath).replace(/\\/g, '/');
    return {
      index: idx,
      timestampSec: parseFloat((idx * step).toFixed(2)),
      url: `/uploads/${relPath}`,
      filePath: fullPath,
    };
  });
}

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

  // Probe stream signatures of every input
  const streamInfos = [];
  for (const filePath of validInputs) {
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
    streamInfos.push({
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
    });
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
        Math.abs(m.fps - first.fps) <= 0.5 &&
        (!first.timeBase || !m.timeBase || m.timeBase === first.timeBase)
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
        jobRenderProcesses.set(jobId, regRecord);
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
        if (jobId) jobRenderProcesses.delete(jobId);

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
        if (jobId) jobRenderProcesses.delete(jobId);
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
  buildDynamicDuckingFilter,
  renderDubbedVideoWithDucking,
  mergeVideosConcat,
  mergeTimeIntervals,
  extractAudio,
  toSrtTime,
  parseTimeToSec,
  extractValidTimestamp,
  resolveSegmentStartSec,
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

