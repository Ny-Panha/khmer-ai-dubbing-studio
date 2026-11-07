const { spawn, spawnSync, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const ffmpeg = require("fluent-ffmpeg");
const audioSeparationService = require("./audioSeparationService");

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

function getSafeCliPath(targetPath) {
  if (process.platform !== "win32" || !targetPath) return targetPath;
  if (!/[^\x20-\x7E]/.test(targetPath)) return targetPath;

  try {
    if (fs.existsSync(targetPath)) {
      const short = execSync(`cmd.exe /c for %I in ("${targetPath}") do @echo %~sI`, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
      if (short && fs.existsSync(short)) return short;
    }
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    if (fs.existsSync(dir)) {
      const shortDir = execSync(`cmd.exe /c for %I in ("${dir}") do @echo %~sI`, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
      if (shortDir && fs.existsSync(shortDir)) {
        return path.join(shortDir, base);
      }
    }
  } catch (_) {}
  return targetPath;
}

// ============================================================================
// ផ្នែកទី 1: GEMINI PROXY VIDEO 360p (បង្រួមវីដេអូឱ្យ Upload លឿនជាងមុន 5-10 ដង)
// ============================================================================

// In-flight proxy video creation jobs to prevent race conditions and duplicate FFmpeg processes
const inFlightProxyJobs = new Map();

/**
 * បង្កើតវីដេអូ Proxy 540p @ 12fps (CRF 22) ច្បាស់សម្រាប់ Gemini OCR & Vision
 * @param {string} inputVideoPath
 * @param {object} options
 * @returns {Promise<string>}
 */
function createGeminiProxyVideo(inputVideoPath, options = {}) {
  if (!fs.existsSync(inputVideoPath)) {
    return Promise.reject(new Error(`រកមិនឃើញវីដេអូដើម៖ ${inputVideoPath}`));
  }

  const scaleHeight = Number(options.scaleHeight || 540);
  const fps = Number(options.fps || 12);
  const crf = Number(options.crf || 22);

  const dir = path.dirname(inputVideoPath);
  const ext = path.extname(inputVideoPath);
  const baseName = path.basename(inputVideoPath, ext);
  const proxyOutputPath = path.join(dir, `${baseName}_gemini_proxy.mp4`);

  // 1. If an existing complete proxy file already exists and is valid (> 100KB), reuse it
  if (fs.existsSync(proxyOutputPath)) {
    try {
      const stat = fs.statSync(proxyOutputPath);
      if (stat.size > 100 * 1024) {
        console.log(`[FFmpegService] ⚡ ប្រើប្រាស់ Proxy Video ដែលមានស្រាប់៖ ${path.basename(proxyOutputPath)} (${(stat.size / (1024 * 1024)).toFixed(2)}MB)`);
        return Promise.resolve(proxyOutputPath);
      } else {
        // Stale/truncated proxy from previous aborted run -> remove
        fs.unlinkSync(proxyOutputPath);
      }
    } catch (_) {}
  }

  // 2. If a proxy creation job is already running for this video, await that exact job (deduplication)
  if (inFlightProxyJobs.has(inputVideoPath)) {
    console.log(`[FFmpegService] ⏳ កំពុងរង់ចាំ Proxy Video ដែលកំពុងដំណើរការស្រាប់៖ ${path.basename(inputVideoPath)}`);
    return inFlightProxyJobs.get(inputVideoPath);
  }

  const jobPromise = new Promise((resolve) => {
    console.log(`[FFmpegService] 🗜️ កំពុងបង្រួមវីដេអូ Proxy ${scaleHeight}p @ ${fps}fps (CRF ${crf}) សម្រាប់ Gemini OCR & Vision...`);
    const startTime = Date.now();

    // Use a unique temporary file so that proxyOutputPath never exists until 100% finished
    const tempOutputPath = path.join(dir, `${baseName}_gemini_proxy.tmp_${Date.now()}_${process.pid}.mp4`);

    const safeInputPath = getSafeCliPath(inputVideoPath);
    const safeTempPath = getSafeCliPath(tempOutputPath);

    const args = [
      "-y",
      "-i", safeInputPath,
      "-vf", `scale='if(gt(iw,ih),-2,${scaleHeight})':'if(gt(iw,ih),${scaleHeight},-2)',fps=${fps}`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", String(crf),
      "-c:a", "aac",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "64k",
      "-movflags", "+faststart",
      safeTempPath,
    ];

    const ffmpegProcess = spawn(FFMPEG_PATH, args);
    let errorLog = "";

    ffmpegProcess.stderr.on("data", (data) => {
      errorLog += data.toString();
    });

    ffmpegProcess.on("close", (code) => {
      inFlightProxyJobs.delete(inputVideoPath);
      if (code === 0 && fs.existsSync(tempOutputPath)) {
        try {
          // Atomically rename temp file to final proxy output path
          if (fs.existsSync(proxyOutputPath)) {
            try { fs.unlinkSync(proxyOutputPath); } catch (_) {}
          }
          fs.renameSync(tempOutputPath, proxyOutputPath);

          const origSize = (fs.statSync(inputVideoPath).size / (1024 * 1024)).toFixed(2);
          const proxySize = (fs.statSync(proxyOutputPath).size / (1024 * 1024)).toFixed(2);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

          console.log(
            `[FFmpegService] ✅ បង្កើត Proxy រួចរាល់ក្នុង ${elapsed}s! (ទំហំថយពី ${origSize}MB ➜ ${proxySize}MB)`
          );
          resolve(proxyOutputPath);
        } catch (renameErr) {
          console.warn(`[FFmpegService] ⚠️ Rename failed, using temp proxy:`, renameErr.message);
          resolve(tempOutputPath);
        }
      } else {
        if (fs.existsSync(tempOutputPath)) {
          try { fs.unlinkSync(tempOutputPath); } catch (_) {}
        }
        console.error(`[FFmpegService] ❌ បរាជ័យក្នុងការបង្កើត Proxy (Code ${code}):`, errorLog.slice(-500));
        resolve(inputVideoPath);
      }
    });

    ffmpegProcess.on("error", (err) => {
      inFlightProxyJobs.delete(inputVideoPath);
      if (fs.existsSync(tempOutputPath)) {
        try { fs.unlinkSync(tempOutputPath); } catch (_) {}
      }
      console.warn(`[FFmpegService] ⚠️ FFmpeg Spawn Error, ប្រើវីដេអូដើមជំនួស៖`, err.message);
      resolve(inputVideoPath);
    });
  });

  inFlightProxyJobs.set(inputVideoPath, jobPromise);
  return jobPromise;
}

function cleanupProxyFile(proxyPath, originalPath) {
  if (proxyPath && proxyPath !== originalPath && fs.existsSync(proxyPath)) {
    try {
      fs.unlinkSync(proxyPath);
      console.log(`[FFmpegService] 🧹 បានលុប File Proxy បណ្ដោះអាសន្ន៖ ${path.basename(proxyPath)}`);
    } catch (err) {
      console.warn(`[FFmpegService] ⚠️ មិនអាចលុប Proxy File បានទេ៖`, err.message);
    }
  }
}

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
 * Auto Time-Stretch TTS Audio to fit timeline segment duration.
 * PRESERVES 100% of the initial consonant and syllable:
 * - Guarantees an 80ms acoustic lead-in cushion before speech onset.
 * - If natural leading silence <= 150ms, does NOT trim the start at all (retains natural human speech onset).
 * - Trims excessive trailing dead silence (Edge TTS tail silence) with an 80ms decay cushion.
 * - Applies atempo only if required, maintaining timeline sync and zero audio clipping.
 */
async function autoStretchTtsAudio({
  inputAudioPath,
  targetDuration,
  maxSpeed = 1.35,
  minSpeed = 0.95,
  leadInCushionSec = 0.040,  // 40ms lead-in: protects Khmer aspirated consonants (ក ខ ច ឆ ត ថ ប ផ ស) which need ~30-50ms onset
  leadOutCushionSec = 0.060, // 60ms decay cushion protects final syllable and tail consonants
  microFadeMs = 8,           // 8ms micro-fade within silence cushion to eliminate boundary clicks
  allowSlowdown = false,     // Only allow stretching down if explicitly requested (e.g. for mouth sync, never when fitting slot)
}) {
  if (!fs.existsSync(inputAudioPath)) {
    throw new Error(`រកមិនឃើញ File សំឡេង TTS៖ ${inputAudioPath}`);
  }

  const dir = path.dirname(inputAudioPath);
  const ext = path.extname(inputAudioPath);
  const base = path.basename(inputAudioPath, ext);
  const trimmedPath = path.join(dir, `${base}_trimmed${ext}`);
  const stretchedPath = path.join(dir, `${base}_synced${ext}`);

  // 1. Measure natural speech boundaries using conservative threshold
  const bounds = await detectSpeechBounds(inputAudioPath, "-50dB", 0.03);
  const totalDur = bounds.totalDur || (await getMediaDuration(inputAudioPath));

  // Determine safe trim boundaries that strictly PRESERVE speech onset:
  // Trim dead leading silence down to a crisp 15ms acoustic cushion, eliminating ~100ms TTS delay
  // while preserving initial consonants (ក, ខ, ច, ឆ, ត, ប, ស...) from clipping.
  let safeStart = 0;
  if (bounds.leadingSilence > 0.080) {
    safeStart = Math.max(0, parseFloat((bounds.leadingSilence - leadInCushionSec).toFixed(3)));
  }

  // Trim trailing dead silence while keeping leadOutCushionSec of room decay
  let safeEnd = totalDur;
  if (bounds.tailSilence > 0 && totalDur - bounds.tailSilence > 0.12) {
    safeEnd = Math.min(totalDur, bounds.tailSilence + leadOutCushionSec);
  }

  let activeSourcePath = inputAudioPath;
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

  const actualDuration = await getMediaDuration(activeSourcePath);

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
      leadInSec: Number((bounds.leadingSilence - safeStart).toFixed(3)),
    effectiveLeadInCushionSec: Number(((bounds.leadingSilence - safeStart) / appliedSpeed).toFixed(3)),
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
      leadInSec: Number((bounds.leadingSilence - safeStart).toFixed(3)),
    effectiveLeadInCushionSec: Number(((bounds.leadingSilence - safeStart) / appliedSpeed).toFixed(3)),
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

  const finalDuration = await getMediaDuration(inputAudioPath);

  console.log(
    `[FFmpegService] 🎚️ Auto-Stretch: ${actualDuration.toFixed(2)}s ➜ ${finalDuration.toFixed(2)}s (Target: ${targetDuration.toFixed(2)}s | Speed: ${appliedSpeed.toFixed(2)}x | Lead-in Cushion: ${((bounds.leadingSilence - safeStart) * 1000).toFixed(0)}ms)`
  );

  return {
    outputPath: inputAudioPath,
    originalDuration: actualDuration,
    finalDuration: finalDuration,
    appliedSpeed: Number(appliedSpeed.toFixed(2)),
    leadInSec: Number((bounds.leadingSilence - safeStart).toFixed(3)),
    effectiveLeadInCushionSec: Number(((bounds.leadingSilence - safeStart) / appliedSpeed).toFixed(3)),
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

function generateKhmerAssSubtitleFile({
  segments = [],
  outputPath,
  fontName = "Khmer OS Battambang",
  fontSize = null,
  textColor = "#FFFFFF",
  outlineColor = "#000000",
  subtitleStyle = "banner",
  marginV = null,
  aspectRatio = "16:9",
  antiTheft = null,
  totalDuration = null,
  sourceDimensions = null,
}) {
  let playResX = 1920;
  let playResY = 1080;
  let effFontSize = fontSize;
  let effMarginV = marginV;

  const isAntiTheftActive = Boolean(antiTheft && (antiTheft.enabled || antiTheft.enableAntiTheft));
  const marqueePos = antiTheft?.marqueePosition || antiTheft?.position || "bottom";

  // កំណត់ទំហំអក្សរ និងគម្លាតស្វ័យប្រវត្តិតាមទម្រង់វីដេអូ
  if (aspectRatio === "9:16") {
    playResX = 1080;
    playResY = 1920;
    effFontSize = fontSize || 48; // Clean, non-overlapping size for mobile (TikTok/Reels)
    effMarginV = marginV || 720; // Centered at y=1200 - sits snugly and covers foreign/Chinese subtitles 100%
  } else if (aspectRatio === "1:1") {
    playResX = 1080;
    playResY = 1080;
    effFontSize = fontSize || 52;
    effMarginV = marginV || (isAntiTheftActive && marqueePos === "bottom" ? 180 : 120);
  } else {
    // 16:9 YouTube Landscape
    playResX = 1920;
    playResY = 1080;
    effFontSize = fontSize || 44; // YouTube Landscape: ទំហំល្មមស្អាត មិនបាំងមុខតួអង្គ
    effMarginV = marginV || (isAntiTheftActive && marqueePos === "bottom" ? 150 : 80);
  }

  const primaryAssColor = hexToAssColor(textColor, "00");
  const outlineAssColor = hexToAssColor(outlineColor, "00");
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
  } else if (subtitleStyle === "pill" || subtitleStyle === "banner") {
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
      // 9:16 Frame (1080x1920). Centered landscape video is dynamically detected:
      let vTop = 656;
      let vBottom = 1264;
      if (sourceDimensions && sourceDimensions.width > 0 && sourceDimensions.height > 0) {
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
        // Sits exactly inside the bottom of the video frame - NEVER in black letterbox void!
        ribbonY = vBottom - ribbonH;
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
        ribbonY = 1080 - ribbonH - 16;
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
Style: Default,${fontName},${effFontSize},${primaryAssColor},&H000000FF,${outlineAssColor},${backBoxColor},-1,0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadowWidth},2,60,60,${effMarginV},1${antiTheftStyles}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogueLines = segments
    .filter((seg) => (seg.khmerText || seg.khmer) && String(seg.khmerText || seg.khmer).trim().length > 0)
    .map((seg) => {
      const startSec = Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? parseTimeToSec(seg.start, 0));
      const rawDur = Number(
        seg.audioDuration ?? seg.duration ?? seg.audioDurationSec ?? (seg.endSeconds ? seg.endSeconds - startSec : (seg.endSec ? seg.endSec - startSec : 2.5))
      );
      // Strictly prevent 0.01s or micro-durations from flashing in burned subtitles
      const safeDuration = (!rawDur || isNaN(rawDur) || rawDur < 0.6)
        ? Math.max(1.5, Math.min(6.0, String(seg.khmerText || seg.khmer || "").length * 0.16))
        : rawDur;
      const endSec = startSec + safeDuration;

      const startAss = formatSecondsToAssTime(startSec);
      const endAss = formatSecondsToAssTime(endSec);
      const cleanText = sanitizeKhmerSubtitleText(seg.khmerText || seg.khmer);
      const speakerName = String(seg.speaker || seg.speakerName || "Speaker").replace(/,/g, " ");

      return `Dialogue: 0,${startAss},${endAss},Default,${speakerName},0,0,0,,{\\fad(0,0)}${cleanText}`;
    });

  const allEvents = [...antiTheftEvents, ...dialogueLines];
  const fullAssContent = assHeader + allEvents.join("\n") + "\n";

  fs.writeFileSync(outputPath, "\uFEFF" + fullAssContent, "utf8");
  console.log(`[FFmpegService] 📝 បានបង្កើត File Subtitle ខ្មែរ (.ass)៖ ${path.basename(outputPath)} (Anti-theft: ${isAntiTheftActive ? 'Active' : 'Off'})`);

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
  const mutedClipWindows = (Array.isArray(videoClips) ? videoClips : [])
    .filter((c) => c.isMuted)
    .map((c) => {
      const s = Math.max(0, Number(c.start || 0)).toFixed(2);
      const e = Math.max(0, Number(c.end || 0)).toFixed(2);
      return `between(t,${s},${e})`;
    });

  const hasMutedClips = mutedClipWindows.length > 0;
  const mutedCondition = hasMutedClips ? mutedClipWindows.join("+") : null;

  if (!segments || segments.length === 0) {
    if (hasMutedClips) {
      return `volume='if(gt(${mutedCondition},0),0.0,${bgNormalVolume.toFixed(2)})':eval=frame`;
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
  const conditionExpr = timeWindows.join("+");

  if (hasMutedClips) {
    return `volume='if(gt(${mutedCondition},0),0.0,if(gt(${conditionExpr},0),${bgDuckVolume.toFixed(2)},${bgNormalVolume.toFixed(2)}))':eval=frame`;
  }

  return `volume='if(gt(${conditionExpr},0),${bgDuckVolume.toFixed(2)},${bgNormalVolume.toFixed(2)})':eval=frame`;
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

function getActiveJobRenderProcess(jobId) {
  return jobRenderProcesses.get(jobId) || null;
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
  const videoClips = options.videoClips || [];
  const antiTheft = options.antiTheft || null;
  const logoSettings = options.logoSettings || null;

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

    if (!hasValidMasterAudio && validSegments.length === 0) {
      return reject(new Error("មិនមាន File សំឡេងខ្មែរ TTS សម្រាប់យកមក Mix ឡើយ!"));
    }

    // Windows CLI Length Guard: If no master audio is pre-rendered and segment count > 20,
    // auto-assemble master narration audio using bounded hierarchical batching (BATCH_SIZE = 40)
    // to strictly prevent Windows CreateProcessW 32,767 character command-line overflow!
    if (!hasValidMasterAudio && (validSegments.length > 20 || options.enableDemucs)) {
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

    if (hasValidMasterAudio) {
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
        const delayMs = Math.max(0, Math.round(Number(seg.startSeconds) * 1000));
        const label = `v${inputIndex}`;

        const segStart = Number(seg.startSeconds || 0);
        const segDur = Number(seg.duration || seg.audioDurationSec || 2.5);
        const segEnd = segStart + segDur;
        const nextOverlap = validSegments.slice(index + 1).find((next) => {
          const nStart = Number(next.startSeconds || 0);
          return nStart > segStart && nStart < segEnd;
        });

        let volFilter = `volume=${khmerVolume.toFixed(2)}`;
        if (nextOverlap) {
          const duckRelSec = Math.max(0.15, parseFloat((Number(nextOverlap.startSeconds || 0) - segStart).toFixed(2)));
          volFilter = `volume=eval=frame:volume='if(gte(t,${duckRelSec}),${(khmerVolume * 0.5).toFixed(2)},${khmerVolume.toFixed(2)})'`;
        }

        filterComplexParts.push(
          `[${inputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,${volFilter},adelay=${delayMs}|${delayMs}[${label}]`
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

    // NLE multi-clip cuts and trims on VIDEO 1
    let baseVideoSource = "[0:v:0]";

    const hasCustomCuts = validClips.length > 1 || (
      validClips.length === 1 && (
        (Number(validClips[0].sourceStart) > 0.05) ||
        (Number(validClips[0].sourceEnd) > 0 && Math.abs(Number(validClips[0].sourceEnd) - Number(validClips[0].sourceStart) - (Number(validClips[0].end) - Number(validClips[0].start))) > 0.1)
      )
    );

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
    const targetAspectRatio = subtitleOptions.aspectRatio || aspectRatio || "16:9";
    const hasAntiTheft = Boolean(antiTheft && (antiTheft.enabled || antiTheft.enableAntiTheft));
    const shouldBurnAss = Boolean(burnSubtitles || hasAntiTheft);

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

      const sourceDimensions = getVideoDimensionsFast(inputVideoPath);

      generateKhmerAssSubtitleFile({
        segments: burnSubtitles ? validSegments : [],
        outputPath: tempAssPath,
        fontName: subtitleOptions.fontName || "Khmer OS Battambang",
        fontSize: subtitleOptions.fontSize ? Number(subtitleOptions.fontSize) : null,
        textColor: subtitleOptions.textColor || "#FFFFFF",
        outlineColor: subtitleOptions.outlineColor || "#000000",
        subtitleStyle,
        marginV: subtitleOptions.marginV ? Number(subtitleOptions.marginV) : null,
        aspectRatio: targetAspectRatio,
        antiTheft: hasAntiTheft ? antiTheft : null,
        totalDuration: calculatedDuration > 0 ? calculatedDuration : null,
        sourceDimensions,
      });

      const assFilter = buildAssSubtitleVideoFilter(tempAssPath);

      if (targetAspectRatio === "9:16") {
        // Professional TikTok/Reels Style: Clean Black Cinema Canvas (Matching Preview 100%) + Centered Video + Subtitles
        filterComplexParts.push(
          `${baseVideoSource}scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(1080-iw)/2:(1920-ih)/2:color=black[base_vert]`,
          `[base_vert]${assFilter}[final_video]`
        );
      } else {
        filterComplexParts.push(`${baseVideoSource}${assFilter}[final_video]`);
      }
      videoMapArg = "[final_video]";
    } else if (targetAspectRatio === "9:16") {
      // 9:16 Clean Black Canvas without subtitles or anti-theft
      filterComplexParts.push(
        `${baseVideoSource}scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(1080-iw)/2:(1920-ih)/2:color=black[final_video]`
      );
      videoMapArg = "[final_video]";
    }

    // Overlay Logo Watermark (សងខាង / Both Sides, Top-Left, or Top-Right)
    if (hasLogo && logoInputIndex >= 0) {
      const baseLogoSize = Number(logoSettings.size || logoSettings.logoSize) || 72;
      const scaledW = Math.max(40, Math.min(260, Math.round(baseLogoSize * 1.5)));
      const scaledH = scaledW;
      const opacity = Math.max(0.1, Math.min(1.0, Number(logoSettings.opacity || logoSettings.logoOpacity) || 0.9));
      const baseMargin = Math.max(10, Math.min(100, Math.round((Number(logoSettings.margin || logoSettings.logoMargin) || 20) * 1.5)));
      const topMargin = targetAspectRatio === "9:16" ? (656 + baseMargin) : baseMargin;
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
        }
        filterComplexParts.push(
          `${vCurrent}[logo_prepared]overlay=${overlayExpr}[v_logo_single]`
        );
        videoMapArg = "[v_logo_single]";
      }
    }

    const fullFilterString = filterComplexParts.join(";");

    // In modern FFmpeg, pass filter complex graph directly to -filter_complex (prevents unrecognized option filter_complex_script error)
    args.push("-filter_complex", fullFilterString);

    args.push("-map", videoMapArg, "-map", "[final_audio]");

    if (!burnSubtitles && !hasLogo && targetAspectRatio !== "9:16" && !hasCustomCuts) {
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
    const proc = spawn(FFMPEG_PATH, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
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

    proc.stderr.on("data", (data) => {
      const text = data.toString();
      stderrLog += text;
      const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
      if (timeMatch) {
        process.stdout.write(`\r[FFmpegService] ⏳ Rendering: time=${timeMatch[1]}`);
      }
    });

    proc.on("close", (code) => {
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
    if (!fs.existsSync(videoPath)) {
      return reject(new Error(`Input video not found: ${videoPath}`));
    }

    const dir = path.dirname(outputAudioPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let command = ffmpeg(videoPath);

    // Fast input seek (-ss BEFORE -i) for instant seek on large videos (2GB+ / 3h+)
    if (typeof options.startSec === "number" && options.startSec > 0) {
      command = command.inputOptions([`-ss ${options.startSec}`]);
    }

    command = command
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .audioChannels(1);

    if (typeof options.durationSec === "number" && options.durationSec > 0) {
      command = command.setDuration(options.durationSec);
    }

    command
      .output(outputAudioPath)
      .on("end", () => resolve(outputAudioPath))
      .on("error", (err) => reject(err))
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
    let startSec = typeof seg.startSec === "number" && !isNaN(seg.startSec)
      ? seg.startSec
      : parseTimeToSec(seg.start, index * 4);
    let endSec = typeof seg.endSec === "number" && !isNaN(seg.endSec)
      ? seg.endSec
      : parseTimeToSec(seg.end, startSec + 3.5);

    const srtDur = endSec - startSec;
    if (endSec <= startSec || isNaN(srtDur) || srtDur < 0.6) {
      const textLen = (seg.khmerText || seg.khmer || "").length || 8;
      endSec = parseFloat((startSec + Math.max(1.8, Math.min(6.0, textLen * 0.16))).toFixed(2));
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
      const audioOffset = typeof seg0.audioOffset === "number" && !isNaN(seg0.audioOffset) ? seg0.audioOffset : 0;
      const dur = typeof seg0.audioDurationSec === "number" && !isNaN(seg0.audioDurationSec) ? seg0.audioDurationSec : (typeof seg0.durSec === "number" ? seg0.durSec : null);
      let trimPrefix = "";
      if (audioOffset > 0 && dur > 0) {
        trimPrefix = `atrim=start=${audioOffset}:duration=${dur},asetpts=PTS-STARTPTS,`;
      } else if (dur > 0 && seg0.audioOffset !== undefined) {
        trimPrefix = `atrim=start=0:duration=${dur},asetpts=PTS-STARTPTS,`;
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

    // Helper: Mix a single batch of up to 40 segments safely
    const mixBatch = (segs, outPath, isWav = false) => {
      return new Promise((resBatch, rejBatch) => {
        try {
          const command = ffmpeg();
          const filterParts = [];
          const mixInputs = [];

          const preparedSegs = segs.map((seg, idx) => {
            const secVal = resolveSegmentStartSec(seg, idx * 4);
            const dur = typeof seg.audioDurationSec === "number" && !isNaN(seg.audioDurationSec) && seg.audioDurationSec > 0
              ? seg.audioDurationSec
              : 3.0;
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
            const audioOffset = typeof seg.audioOffset === "number" && !isNaN(seg.audioOffset) ? seg.audioOffset : 0;
            const dur = typeof seg.durSec === "number" && !isNaN(seg.durSec) ? seg.durSec : null;

            let trimPrefix = "";
            if (audioOffset > 0 && dur > 0) {
              trimPrefix = `atrim=start=${audioOffset}:duration=${dur},asetpts=PTS-STARTPTS,`;
            } else if (dur > 0 && seg.audioOffset !== undefined) {
              trimPrefix = `atrim=start=0:duration=${dur},asetpts=PTS-STARTPTS,`;
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

          const N = segs.length;
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
            .on("error", rejBatch)
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
        await mixBatch(validSegs, tempOutputPath, false);
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
        await mixBatch(batchSegs, batchWavPath, true);
        intermediateChunkPaths.push(batchWavPath);
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

function renderDubbedVideo(params) {
  // If master audio exists or segments array contains valid audio, delegate to renderDubbedVideoWithDucking
  const hasMaster = Boolean(params.khmerAudioPath && fs.existsSync(params.khmerAudioPath));
  const validSegs = (params.segments || []).filter((s) => (s.audioPath && fs.existsSync(s.audioPath)) || (s.audioFile && fs.existsSync(s.audioFile)));
  if (hasMaster || validSegs.length > 0) {
    return renderDubbedVideoWithDucking({
      inputVideoPath: params.videoPath,
      masterAudioPath: params.khmerAudioPath || null,
      fullAudioPath: params.khmerAudioPath || null,
      segments: validSegs,
      outputVideoPath: params.outputPath,
      soundMode: params.duckingVolume === 0 ? "replace" : "ducking",
      bgVolume: params.duckingVolume ?? 0.15,
      khmerVolume: params.khmerVolume ?? 1.3,
      burnSubtitles: Boolean(params.burnSubtitles),
      subtitleOptions: {
        textColor: params.subtitleColor === "yellow" ? "#FFE600" : "#FFFFFF",
        fontSize: params.subtitleSize === "large" ? 64 : params.subtitleSize === "small" ? 42 : 52,
      },
      videoClips: params.videoClips || [],
    }).then((res) => res.outputVideoPath);
  }

  // Fallback if full audio was pre-baked
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(params.videoPath)) {
      return reject(new Error(`Input video not found: ${params.videoPath}`));
    }
    if (!fs.existsSync(params.khmerAudioPath)) {
      return reject(new Error(`Khmer audio not found: ${params.khmerAudioPath}`));
    }

    const command = ffmpeg().input(params.videoPath).input(params.khmerAudioPath);
    const filterComplex = [];
    const duckVal = parseFloat(params.duckingVolume) || 0;
    const khmerVal = parseFloat(params.khmerVolume) || 1.3;

    if (duckVal === 0) {
      filterComplex.push(
        "[0:a]volume=0[original_bg]",
        `[1:a]volume=${khmerVal}[khmer_voice]`,
        "[original_bg][khmer_voice]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[a_out]"
      );
    } else {
      filterComplex.push(
        `[0:a]volume=${duckVal}[original_bg]`,
        `[1:a]volume=${khmerVal}[khmer_voice]`,
        "[original_bg][khmer_voice]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[a_out]"
      );
    }

    if (params.burnSubtitles && params.subtitlePath && fs.existsSync(params.subtitlePath)) {
      const escapedSubPath = params.subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:");
      filterComplex.push(`[0:v]subtitles='${escapedSubPath}'[v_out]`);
      command.complexFilter(filterComplex).outputOptions(["-map [v_out]", "-map [a_out]"]);
    } else {
      command.complexFilter(filterComplex).outputOptions(["-map 0:v", "-map [a_out]"]);
    }

    command
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-preset fast", "-pix_fmt yuv420p", "-shortest"])
      .output(params.outputPath)
      .on("end", () => resolve(params.outputPath))
      .on("error", reject)
      .run();
  });
}

/**
 * 🔊 Audio Loudness & Peak Diagnostics Tool (volumedetect)
 * Analyzes audio levels at the beginning, middle, and end of the timeline
 * to ensure uniform loudness and prevent audio clipping/distortion.
 * @param {string} audioPath
 * @returns {Promise<{ durationSec: number, beginning: object, middle: object, end: object, maxDifferenceDb: number, isBalanced: boolean }>}
 */
function measureAudioLoudnessDiagnostics(audioPath) {
  return new Promise((resolve, reject) => {
    if (!audioPath || !fs.existsSync(audioPath)) {
      return reject(new Error(`Audio file not found: ${audioPath}`));
    }
    const safePath = getSafeCliPath(audioPath);
    getMediaDuration(audioPath)
      .then((durSec) => {
        if (!durSec || durSec <= 0) {
          return resolve({
            durationSec: 0,
            beginning: { meanVolumeDb: 0, maxVolumeDb: 0, isClipping: false },
            middle: { meanVolumeDb: 0, maxVolumeDb: 0, isClipping: false },
            end: { meanVolumeDb: 0, maxVolumeDb: 0, isClipping: false },
            maxDifferenceDb: 0,
            isBalanced: true,
          });
        }

        const analyzeSegment = (startSec, durationSec) => {
          return new Promise((resSeg) => {
            let stderrRaw = "";
            let stderrSpeech = "";

            ffmpeg()
              .input(safePath)
              .seekInput(Math.max(0, startSec))
              .duration(durationSec)
              .audioFilters("volumedetect")
              .format("null")
              .output("-")
              .on("stderr", (line) => { stderrRaw += line + "\n"; })
              .on("end", () => {
                const rawMean = (stderrRaw.match(/mean_volume:\s+([-0-9.]+)\s+dB/) || [])[1] || "-99.0";
                const rawMax = (stderrRaw.match(/max_volume:\s+([-0-9.]+)\s+dB/) || [])[1] || "-99.0";

                // Secondary gated speech measurement excluding natural dialogue pauses
                ffmpeg()
                  .input(safePath)
                  .seekInput(Math.max(0, startSec))
                  .duration(durationSec)
                  .audioFilters("silenceremove=stop_periods=-1:stop_duration=0.08:stop_threshold=-45dB,volumedetect")
                  .format("null")
                  .output("-")
                  .on("stderr", (line) => { stderrSpeech += line + "\n"; })
                  .on("end", () => {
                    const speechMean = (stderrSpeech.match(/mean_volume:\s+([-0-9.]+)\s+dB/) || [])[1] || "-99.0";
                    const speechMax = (stderrSpeech.match(/max_volume:\s+([-0-9.]+)\s+dB/) || [])[1] || "-99.0";
                    const pSpeechMean = parseFloat(speechMean);
                    const pSpeechMax = parseFloat(speechMax);
                    const pRawMean = parseFloat(rawMean);
                    const pRawMax = parseFloat(rawMax);

                    resSeg({
                      meanVolumeDb: pRawMean,
                      maxVolumeDb: pRawMax,
                      speechMeanVolumeDb: pSpeechMean > -90 ? pSpeechMean : pRawMean,
                      speechMaxVolumeDb: pSpeechMax > -90 ? pSpeechMax : pRawMax,
                      isClipping: pRawMax >= -0.05,
                    });
                  })
                  .on("error", () => {
                    resSeg({
                      meanVolumeDb: parseFloat(rawMean),
                      maxVolumeDb: parseFloat(rawMax),
                      speechMeanVolumeDb: parseFloat(rawMean),
                      speechMaxVolumeDb: parseFloat(rawMax),
                      isClipping: parseFloat(rawMax) >= -0.05,
                    });
                  })
                  .run();
              })
              .on("error", () => {
                resSeg({ meanVolumeDb: -99.0, maxVolumeDb: -99.0, speechMeanVolumeDb: -99.0, speechMaxVolumeDb: -99.0, isClipping: false });
              })
              .run();
          });
        };

        const sampleDur = Math.min(15, Math.max(1, durSec / 4));
        const midStart = Math.max(0, (durSec - sampleDur) / 2);
        const endStart = Math.max(0, durSec - sampleDur);

        Promise.all([
          analyzeSegment(0, sampleDur),
          analyzeSegment(midStart, sampleDur),
          analyzeSegment(endStart, sampleDur),
        ]).then(([beginning, middle, end]) => {
          const rawMeans = [beginning.meanVolumeDb, middle.meanVolumeDb, end.meanVolumeDb].filter(v => v > -90);
          const speechMeans = [beginning.speechMeanVolumeDb, middle.speechMeanVolumeDb, end.speechMeanVolumeDb].filter(v => v > -90);
          const peaks = [beginning.maxVolumeDb, middle.maxVolumeDb, end.maxVolumeDb].filter(v => v > -90);

          const wholeWindowMeanVariationDb = rawMeans.length > 0 ? parseFloat((Math.max(...rawMeans) - Math.min(...rawMeans)).toFixed(2)) : 0;
          const speechActiveMeanVariationDb = speechMeans.length > 0 ? parseFloat((Math.max(...speechMeans) - Math.min(...speechMeans)).toFixed(2)) : 0;
          const peakVariationDb = peaks.length > 0 ? parseFloat((Math.max(...peaks) - Math.min(...peaks)).toFixed(2)) : 0;
          const isClipping = [beginning, middle, end].some(s => s.isClipping);

          // Defined using speech-active loudness metric (<4.0 dB) and peak variation (<5.0 dB) with zero clipping
          const isBalanced = speechActiveMeanVariationDb < 4.0 && peakVariationDb < 5.0 && !isClipping;
          const naturalPauseDetected = (wholeWindowMeanVariationDb - speechActiveMeanVariationDb) > 2.5;

          resolve({
            durationSec: durSec,
            beginning,
            middle,
            end,
            wholeWindowMeanVariationDb,
            speechActiveMeanVariationDb,
            peakVariationDb,
            meanDifferenceDb: wholeWindowMeanVariationDb,
            peakDifferenceDb: peakVariationDb,
            maxDifferenceDb: speechActiveMeanVariationDb,
            isClipping,
            isBalanced,
            naturalPauseDetected,
          });
        }).catch(reject);
      })
      .catch(reject);
  });
}
/**
 * Extract high-resolution video frames at specified timestamps using FFmpeg fast seek
 * @param {string} inputVideoPath
 * @param {number[]} timestampsSec Array of timestamps in seconds
 * @param {string} outputDir Directory where frames will be saved
 * @param {object} options
 * @returns {Promise<Array<{ timestampSec: number, filePath: string }>>}
 */
async function extractFramesAtTimestamps(inputVideoPath, timestampsSec = [], outputDir, options = {}) {
  if (!fs.existsSync(inputVideoPath)) {
    throw new Error(`រកមិនឃើញវីដេអូដើម៖ ${inputVideoPath}`);
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const safeInputPath = getSafeCliPath(inputVideoPath);
  const results = [];

  const extractSingle = (t) => {
    return new Promise((resolve) => {
      const safeSec = Math.max(0, Number(t) || 0);
      const outFileName = `frame_${safeSec.toFixed(2).replace(".", "_")}.jpg`;
      const outPath = path.join(outputDir, outFileName);

      const args = [
        "-y",
        "-ss", safeSec.toFixed(3),
        "-i", safeInputPath,
        "-vf", "scale=-2:360",
        "-vframes", "1",
        "-q:v", "3",
        outPath,
      ];

      const proc = spawn(FFMPEG_PATH, args, {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      proc.on("close", (code) => {
        if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
          resolve({ timestampSec: safeSec, filePath: outPath });
        } else {
          resolve(null);
        }
      });
      proc.on("error", (err) => {
        console.warn(`[FFmpegService] ⚠️ Frame extraction at ${safeSec}s failed:`, err.message);
        resolve(null);
      });
    });
  };

  // Process in concurrent pools of 4 to prevent blocking the event loop or exhausting OS process limits
  const CONCURRENCY = 4;
  for (let i = 0; i < timestampsSec.length; i += CONCURRENCY) {
    const chunk = timestampsSec.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map((t) => extractSingle(t)));
    for (const r of chunkResults) {
      if (r) results.push(r);
    }
  }

  return results;
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
 * @returns {Promise<Array<{ index: number, timestampSec: number, filePath: string }>>}
 */
function extractFramesStreaming(inputVideoPath, startSec = 0, durationSec = 0, fps = 1.4, outputDir = null) {
  return new Promise((resolve, reject) => {
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
      '-threads', '4',
      '-vf', `fps=${fps},scale=-2:360`,
      '-q:v', '3',
      outPattern
    );

    const proc = spawn(FFMPEG_PATH, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
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
      reject(err);
    });
  });
}

/**
 * Fast subtitle area difference grid extractor using raw 64x16 grayscale thumbnails.
 * Runs in ~1-2s for a 150-300s chunk and returns average pixel difference between consecutive intervals.
 * Used for local image comparison to prioritize useful frames around subtitle changes without missing content.
 */
function extractSubtitleDifferenceGrid(inputVideoPath, startSec = 0, durationSec = 0, fps = 1.5) {
  return new Promise((resolve) => {
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) return resolve([]);
    const safeInputPath = getSafeCliPath(inputVideoPath);
    const safeStartSec = Math.max(0, Number(startSec) || 0);

    const args = ['-y', '-ss', safeStartSec.toFixed(3)];
    if (durationSec > 0) {
      args.push('-t', Number(durationSec).toFixed(3));
    }
    args.push(
      '-i', safeInputPath,
      '-an', '-sn',
      '-threads', '4',
      '-vf', `fps=${fps},crop=iw:ih*0.25:0:ih*0.75,scale=64:16,format=gray`,
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      '-'
    );

    const proc = spawn(FFMPEG_PATH, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('close', () => {
      const buf = Buffer.concat(chunks);
      const frameSize = 64 * 16;
      const count = Math.floor(buf.length / frameSize);
      const step = 1 / fps;
      const diffs = [];

      for (let i = 0; i < count; i++) {
        const t = parseFloat((safeStartSec + i * step).toFixed(2));
        if (i === 0) {
          diffs.push({ timestampSec: t, diff: 99.0, isChange: true });
          continue;
        }
        const fPrev = buf.subarray((i - 1) * frameSize, i * frameSize);
        const fCurr = buf.subarray(i * frameSize, (i + 1) * frameSize);
        let sum = 0;
        for (let p = 0; p < frameSize; p++) {
          sum += Math.abs(fPrev[p] - fCurr[p]);
        }
        const avg = sum / frameSize;
        diffs.push({
          timestampSec: t,
          diff: parseFloat(avg.toFixed(2)),
          isChange: avg > 18.0,
        });
      }
      resolve(diffs);
    });
    proc.on('error', () => resolve([]));
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



/**
 * Splits a long video (e.g. 1-2 hours) into episode clips of specified duration (e.g. 8 mins)
 * using lossless fast stream copy (-c copy). Takes just a few seconds!
 */
async function splitVideoIntoEpisodes({
  inputVideoPath,
  targetDurationSec = 480, // Default 8 minutes
  outputDir,
  filePrefix = "ep",
}) {
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
    if (chunkDuration < 45 && chunks.length > 0) {
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

module.exports = {
  getOrCreateVideoThumbnails,
  checkQsvSupport,
  splitVideoIntoEpisodes,
  applyInnerThoughtAudioEffect,
  createGeminiProxyVideo,
  cleanupProxyFile,
  extractFramesAtTimestamps,
  extractFramesStreaming,
  extractSubtitleDifferenceGrid,
  getMediaDuration,
  buildAtempoFilter,
  autoStretchTtsAudio,
  hexToAssColor,
  formatSecondsToAssTime,
  sanitizeKhmerSubtitleText,
  generateKhmerAssSubtitleFile,
  buildAssSubtitleVideoFilter,
  buildDynamicDuckingFilter,
  renderDubbedVideoWithDucking,
  mergeTimeIntervals,
  extractAudio,
  toSrtTime,
  parseTimeToSec,
  extractValidTimestamp,
  resolveSegmentStartSec,
  generateSrtFile,
  renderDubbedVideo,
  createSynchronizedNarrationAudio,
  measureAudioLoudnessDiagnostics,
  getMediaInfo,
  getVideoMetadata,
  getSafeCliPath,
  detectSpeechBounds,
  cancelJobRenderProcess,
  pauseJobRenderProcess,
  getActiveJobRenderProcess,
};

