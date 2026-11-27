const { spawn, spawnSync, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const ffmpeg = require("fluent-ffmpeg");
const { ffmpegHeavySemaphore, createAbortError } = require("../../utils/asyncSemaphore");
const { registerProcess, unregisterProcess } = require("../../utils/processRegistry");

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
          if (bestIdx >= 0 && bestDiff <= 0.20 && fs.existsSync(producedFiles[bestIdx]) && fs.statSync(producedFiles[bestIdx]).size > 400) {
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
        let brightChangePixels = 0;

        for (let r = 0; r < scaleH; r++) {
          for (let c = 0; c < scaleW; c++) {
            const p = r * scaleW + c;
            const d = Math.abs(fPrev[p] - fCurr[p]);
            sum += d;
            const isSubBox = (r >= 4 && r <= 28 && c >= 14 && c <= 114);
            if (isSubBox) {
              subSum += d;
              subPixels++;
              if (d >= 35 || fCurr[p] >= 200 || fPrev[p] >= 200) {
                strokePixels++;
              }
              if (d >= 35 && (fCurr[p] >= 180 || fPrev[p] >= 180)) {
                brightChangePixels++;
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
        const brightChangeRatio = brightChangePixels / (subPixels || 1);

        diffs.push({
          timestampSec: t,
          diff: parseFloat(avg.toFixed(2)),
          subDiff: parseFloat(subAvg.toFixed(2)),
          bgDiff: parseFloat(bgAvg.toFixed(2)),
          netSubDiff: parseFloat(netSubDiff.toFixed(2)),
          strokeDiff: parseFloat(strokeRatio.toFixed(3)),
          brightChangeRatio: parseFloat(brightChangeRatio.toFixed(4)),
          isChange: subAvg >= 11.5 || avg >= 14.0 || netSubDiff >= 7.0 || strokeRatio >= 0.08 || brightChangeRatio >= 0.0035,
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
    const bcr = diffs[i].brightChangeRatio || 0;
    const prevBcr = diffs[i - 1].brightChangeRatio || 0;
    const nextBcr = diffs[i + 1].brightChangeRatio || 0;
    // Catch short 1-3 char subtitles (e.g. 没人接, 好, 嗯, 啊) appearing on dark scenes where full-box subDiff is diluted
    const isBrightTextTransition = (bcr >= 0.0035 && bcr >= prevBcr && bcr >= nextBcr);

    if (isPeak || isSharpRise || isProminentLocal || isBrightTextTransition) {
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
 * Generates lightweight (120x68) JPEG snapshots every ~1 second (or ~2s for >10min videos)
 * so timeline thumbnails accurately reflect scene cuts and character appearances (~0.6s per 5min video).
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

  const totalDur = Math.max(1, Number(durationSec) || 30);
  const uploadsRoot = path.resolve(__dirname, '../../uploads');
  const thumbPrefix = 'thumb1s_';

  // Check if accurate 1s-resolution thumbnails already exist
  const existingFiles = fs.readdirSync(thumbDir)
    .filter(f => f.startsWith(thumbPrefix) && f.endsWith('.jpg'))
    .sort();

  const minExpectedThumbs = Math.min(10, Math.max(1, Math.floor(totalDur * 0.4)));
  if (existingFiles.length >= minExpectedThumbs) {
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

  // Extract keyframes using FFmpeg at 1 fps (<=10min) or 0.5 fps (>10min)
  const safeInput = getSafeCliPath(videoPath);
  const outPattern = path.join(thumbDir, `${thumbPrefix}%04d.jpg`);
  const fps = totalDur > 600 ? '0.5' : '1';

  await new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, [
      '-y',
      '-skip_frame', 'nokey',
      '-i', safeInput,
      '-an', '-sn',
      '-vf', `fps=${fps},scale=120:68`,
      '-q:v', '6',
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
    .filter(f => f.startsWith(thumbPrefix) && f.endsWith('.jpg'))
    .sort();

  // Clean up legacy coarse 4s-per-frame thumb_*.jpg files once new 1s thumbnails succeed
  if (files.length > 0) {
    try {
      for (const oldF of fs.readdirSync(thumbDir)) {
        if (oldF.startsWith('thumb_') && !oldF.startsWith(thumbPrefix) && oldF.endsWith('.jpg')) {
          fs.unlinkSync(path.join(thumbDir, oldF));
        }
      }
    } catch (_) {}
  }

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
  FFMPEG_PATH,
  FFPROBE_PATH,
  FFMPEG_VFR_ARGS,
  ffmpeg,
  resolveBinary,
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
};
