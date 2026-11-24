const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const crypto = require("crypto");
const { autoStretchTtsAudio, applyExactAudioSpeed, trimTtsSilence, getMediaDuration, applyInnerThoughtAudioEffect } = require("./ffmpegService");
const { parseTimeToSec } = require("../models/timestampUtils");
const { detectSpeakerGender } = require("../models/speakerRegistry");

/**
 * Check if a TTS error is transient (temporary network/rate-limit issue)
 * vs permanent/fatal (bad request, invalid parameters, missing credentials)
 */
function isTransientTtsError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const code = (err.code || "").toUpperCase();
  const status = Number(err.statusCode || err.status || 0);

  // 429 Too Many Requests, 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit")) return true;
  if (msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;

  // Network, Socket, DNS, and Connection drops
  if (["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EPIPE"].includes(code)) return true;
  if (
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("socket closed") ||
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("stream error") ||
    msg.includes("disconnected") ||
    msg.includes("connection reset")
  ) {
    return true;
  }

  return false;
}

/**
 * Pick transient error from an attempt's layer failures so optional CLI absence (ENOENT)
 * never masks an upstream transient error (e.g. HTTP 429/503/504/timeout).
 */
function pickAttemptRetryError(attemptErrors = []) {
  const valid = (attemptErrors || []).filter(Boolean);
  const transient = valid.find((err) => isTransientTtsError(err));
  if (transient) return transient;
  return valid.find((err) => err.code !== "ENOENT") || valid[valid.length - 1] || null;
}

/**
 * Exponential backoff with random jitter to prevent thundering herd on Edge TTS
 */
function sleepWithJitter(attempt, baseMs = 600) {
  const exp = Math.min(attempt, 4);
  const delay = Math.round(baseMs * Math.pow(2, exp));
  const jitter = Math.floor(Math.random() * 400); // 0-400ms jitter
  return new Promise((resolve) => setTimeout(resolve, delay + jitter));
}

/**
 * Validate that a generated TTS audio file exists, has sufficient byte size,
 * and contains decodable audio via FFprobe
 */
async function validateTtsAudioFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`TTS audio file does not exist: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (stat.size < 250) {
    throw new Error(`TTS audio file is too small (${stat.size} bytes < 250 bytes): ${filePath}`);
  }
  const duration = await getMediaDuration(filePath);
  if (!duration || duration < 0.10) {
    throw new Error(`TTS audio duration is invalid or too short (${duration || 0}s < 0.10s): ${filePath}`);
  }
  return { size: stat.size, duration };
}

/**
 * Compute unique content signature for segment speech synthesis (Smart TTS Cache v2)
 * Based on normalized spoken Khmer text, voice ID, speed/rate, and pitch.
 * Changes to any of these parameters invalidate the signature, ensuring fresh synthesis.
 */
function computeSegmentAudioSignature(text, voiceId, speed = 'normal', pitch = 0) {
  const clean = cleanTextForTts(text || '');
  const speedStr = String(speed ?? 'normal');
  const pitchStr = String(pitch ?? 0);
  const voiceStr = String(voiceId || 'km-KH-PisethNeural');
  return crypto.createHash('sha256')
    .update(`${clean}__${voiceStr}__${speedStr}__${pitchStr}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Compute unique content signature for the master narration track (Master Audio Content Signature).
 * Strictly incorporates segment IDs, ordering, audio files, startSec, audioOffset, and individual audio signatures.
 * If any clip is shifted on the timeline, reordered, offset, or regenerated, this signature changes,
 * preventing stale master narration reuse.
 */
function computeMasterAudioSignature(syncSegments = []) {
  if (!Array.isArray(syncSegments) || syncSegments.length === 0) return null;
  const canonicalEntries = syncSegments.map((s, idx) => {
    const segId = String(s.id ?? s.index ?? idx);
    const fileName = s.audioPath ? path.basename(s.audioPath) : (s.audioFile ? path.basename(s.audioFile) : '');
    const startSec = (typeof s.audioStartSec === "number" && !isNaN(s.audioStartSec))
      ? s.audioStartSec.toFixed(3)
      : ((typeof s.startSec === "number" && !isNaN(s.startSec))
        ? s.startSec.toFixed(3)
        : (typeof s.start === "number" ? s.start.toFixed(3) : '0.000'));
    const offset = (typeof s.audioOffset === "number" && !isNaN(s.audioOffset)) ? s.audioOffset.toFixed(3) : "0.000";
    const sig = s.audioSignature || '';
    return `${segId}:${fileName}:${startSec}:${offset}:${sig}`;
  });
  return crypto.createHash('sha256')
    .update(canonicalEntries.join('\n'))
    .digest('hex')
    .substring(0, 32);
}

/**
 * Helper to safely atomically commit a temporary file to destination path
 */
function atomicCommitFile(tempPath, targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    // Cross-device link fallback or Windows file locking fallback
    fs.copyFileSync(tempPath, targetPath);
    try { fs.unlinkSync(tempPath); } catch (_) { }
  }
}

/**
 * Clean up temporary file safely
 */
function cleanupTempFile(tempPath) {
  if (tempPath && fs.existsSync(tempPath)) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) { }
  }
}

/**
 * បញ្ជីសំឡេងខ្មែរទាំងអស់ដែលគាំទ្រក្នុង Khmer AI Dubbing Studio
 */
const SUPPORTED_VOICES = [
  {
    id: "km-KH-PisethNeural",
    name: "Microsoft Edge — ប្រុស (ពិសិដ្ឋ)",
    displayName: "Microsoft Edge — ប្រុស (ពិសិដ្ឋ)",
    gender: "male",
    speakerGender: "MALE",
    provider: "edge",
    providerName: "Microsoft Edge TTS (Neural)",
    isDefault: true,
    description: "សំឡេងបុរសខ្មែរ ម៉ឺងម៉ាត់ ច្បាស់ សមស្របសម្រាប់តួប្រុស និងការសម្រាយរឿង",
  },
  {
    id: "km-KH-SreymomNeural",
    name: "Microsoft Edge — ស្រី (ស្រីមុំ)",
    displayName: "Microsoft Edge — ស្រី (ស្រីមុំ)",
    gender: "female",
    speakerGender: "FEMALE",
    provider: "edge",
    providerName: "Microsoft Edge TTS (Neural)",
    isDefault: false,
    description: "សំឡេងស្ត្រីខ្មែរ ស្រទន់ ពិរោះបែបកុនភាគ សមស្របសម្រាប់តួស្រី",
  },
  {
    id: "google-km-standard",
    name: "Google Khmer Standard",
    displayName: "Google Translate — ស្រី (Standard)",
    gender: "female",
    speakerGender: "FEMALE",
    provider: "google",
    providerName: "Google Translate TTS",
    isDefault: false,
    description: "សំឡេងស្ត្រីស្តង់ដាររបស់ Google Translate (សម្រាប់ Fallback)",
  },
];

function getSupportedVoices() {
  return {
    provider: "edge-tts",
    providerName: "Microsoft Edge Neural TTS",
    voices: SUPPORTED_VOICES,
    defaultVoice: "km-KH-PisethNeural",
  };
}

function validateVoiceId(voiceId) {
  if (!voiceId || String(voiceId).toLowerCase() === "km") return "km-KH-PisethNeural";
  const found = SUPPORTED_VOICES.find((v) => v.id.toLowerCase() === String(voiceId).toLowerCase());
  return found ? found.id : "km-KH-PisethNeural";
}

/**
 * ជ្រើសរើស Voice ID ស្វ័យប្រវត្តិតាមភេទ ឬឈ្មោះតួអង្គ
 */
function resolveKhmerVoice(requestedVoice, gender = "male") {
  if (requestedVoice) {
    const found = SUPPORTED_VOICES.find(
      (v) => v.id.toLowerCase() === String(requestedVoice).toLowerCase()
    );
    if (found) return found.id;
  }
  const normGender = String(gender || "").toLowerCase();
  return normGender === "female" || normGender === "girl"
    ? "km-KH-SreymomNeural"
    : "km-KH-PisethNeural";
}

/**
 * ធ្វើ Normalization លើសូរអក្សរឡាតាំងដែល AI Edge TTS ច្រើនបញ្ចេញសូរខុស
 * ឧ. "កម្រិត A" -> "កម្រិត អា" (ជំនួសសូរអង់គ្លេស /eɪ/ "អេ" ដែលស្តាប់ទៅច្រឡំនឹង "អេស/S")
 */
function normalizePhoneticsForTts(text = "") {
  if (!text || typeof text !== "string") return "";

  let result = text;

  // 1. Specific Rank / Grade / Level patterns: កម្រិត A, ថ្នាក់ A, លំដាប់ A, Rank A, Level A, Class A
  result = result.replace(
    /(កម្រិត|កំរិត|ថ្នាក់|លំដាប់|ចំណាត់ថ្នាក់|Rank|rank|Level|level|Class|class)\s*A(?=[\s\u1780-\u17FF.,!?+«»"“”'()]|$)/g,
    "$1 អា"
  );

  // 2. Standalone uppercase letter 'A' when isolated or adjacent to Khmer characters
  // Avoid modifying words like AI, API, ASR, Apple, Auto, BGM, etc.
  result = result.replace(
    /(^|[\s\u1780-\u17FF(«"“'—–\-])A(?=[\s\u1780-\u17FF.,!?);:»”'—–\-+]|$)/g,
    "$1អា"
  );

  return result;
}

/**
 * សម្អាតអត្ថបទខ្មែរមុនពេលបញ្ជូនទៅ TTS
 */
function cleanTextForTts(text = "") {
  const phoneticallyNormalized = normalizePhoneticsForTts(String(text));
  return phoneticallyNormalized
    .normalize("NFC")
    .replace(/[*_~`#<>[\]{}|\\]/g, " ")
    .replace(/^[\s\-–—….:,;!?«»"“”'()]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check whether text is empty or an untranslated pipeline placeholder (e.g. literal "សន្ទនា")
 */
function isPlaceholderOrEmptyTtsText(text = "") {
  const cleaned = cleanTextForTts(text);
  if (!cleaned) return true;
  return cleaned === "សន្ទនា";
}

const { EdgeTTS } = require("node-edge-tts");

/**
 * Convert a requested speed (numeric multiplier e.g. 1.5, 0.75; preset "normal"/"slow"/"fast";
 * or Edge rate "+50%"/"-25%") into an Edge TTS prosody rate string (e.g. "+50%", "-25%", "+0%").
 * Never silently treats invalid non-empty inputs as default "+0%"; returns { valid: false, reason }.
 */
function speedToEdgeRate(requestedSpeed) {
  if (requestedSpeed === undefined || requestedSpeed === null || requestedSpeed === "") {
    return { provided: false, valid: true, rate: "+0%", numericSpeed: 1.0, isCustomNonDefault: false, requested: requestedSpeed };
  }

  if (typeof requestedSpeed === "string") {
    const trimmed = requestedSpeed.trim();
    if (!trimmed) {
      return { provided: false, valid: true, rate: "+0%", numericSpeed: 1.0, isCustomNonDefault: false, requested: requestedSpeed };
    }
    const lower = trimmed.toLowerCase();
    if (lower === "normal" || lower === "default") {
      return { provided: true, valid: true, rate: "+0%", numericSpeed: 1.0, isCustomNonDefault: false, requested: requestedSpeed };
    }
    if (lower === "slow") {
      return { provided: true, valid: true, rate: "-25%", numericSpeed: 0.75, isCustomNonDefault: true, requested: requestedSpeed };
    }
    if (lower === "fast") {
      return { provided: true, valid: true, rate: "+25%", numericSpeed: 1.25, isCustomNonDefault: true, requested: requestedSpeed };
    }

    const pctMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)%$/);
    if (pctMatch) {
      const pctRaw = Number(pctMatch[1]);
      if (!Number.isFinite(pctRaw) || pctRaw <= -100 || pctRaw > 300) {
        return { provided: true, valid: false, rate: null, numericSpeed: null, isCustomNonDefault: false, requested: requestedSpeed, reason: "percentage_out_of_range" };
      }
      const pct = Math.round(pctRaw);
      const rate = pct === 0 ? "+0%" : (pct > 0 ? `+${pct}%` : `${pct}%`);
      const numericSpeed = parseFloat((1 + pct / 100).toFixed(4));
      return { provided: true, valid: true, rate, numericSpeed, isCustomNonDefault: pct !== 0, requested: requestedSpeed };
    }

    const numMatch = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*x?$/i);
    if (numMatch) {
      const s = Number(numMatch[1]);
      if (!Number.isFinite(s) || s <= 0 || s > 4.0) {
        return { provided: true, valid: false, rate: null, numericSpeed: null, isCustomNonDefault: false, requested: requestedSpeed, reason: "numeric_out_of_range" };
      }
      const pct = s >= 1 ? Math.round((s - 1) * 100) : -Math.round((1 - s) * 100);
      const rate = pct === 0 ? "+0%" : (pct > 0 ? `+${pct}%` : `${pct}%`);
      return { provided: true, valid: true, rate, numericSpeed: s, isCustomNonDefault: pct !== 0, requested: requestedSpeed };
    }

    return { provided: true, valid: false, rate: null, numericSpeed: null, isCustomNonDefault: false, requested: requestedSpeed, reason: "unparseable_speed_string" };
  }

  if (typeof requestedSpeed === "number") {
    if (!Number.isFinite(requestedSpeed) || requestedSpeed <= 0 || requestedSpeed > 4.0) {
      return { provided: true, valid: false, rate: null, numericSpeed: null, isCustomNonDefault: false, requested: requestedSpeed, reason: "numeric_out_of_range" };
    }
    const pct = requestedSpeed >= 1
      ? Math.round((requestedSpeed - 1) * 100)
      : -Math.round((1 - requestedSpeed) * 100);
    const rate = pct === 0 ? "+0%" : (pct > 0 ? `+${pct}%` : `${pct}%`);
    return { provided: true, valid: true, rate, numericSpeed: requestedSpeed, isCustomNonDefault: pct !== 0, requested: requestedSpeed };
  }

  return { provided: true, valid: false, rate: null, numericSpeed: null, isCustomNonDefault: false, requested: requestedSpeed, reason: "unsupported_speed_type" };
}

/**
 * Resolve effective speed, Edge rate, and explicit user-speed flag from options + segment payload.
 * Precedence: explicit options.rate > explicit options.speed > segment.speed > segment.rate.
 */
function resolveSegmentSpeed(segment = {}, options = {}) {
  const hasOptRate = options.rate !== undefined && options.rate !== null && options.rate !== "";
  const hasOptSpeed = options.speed !== undefined && options.speed !== null && options.speed !== "";
  const segSpeedRaw = (segment && segment.speed !== undefined && segment.speed !== null && segment.speed !== "")
    ? segment.speed
    : (segment && segment.rate !== undefined && segment.rate !== null && segment.rate !== "" ? segment.rate : undefined);

  const chosenRaw = hasOptRate ? options.rate : (hasOptSpeed ? options.speed : segSpeedRaw);
  const parsed = speedToEdgeRate(chosenRaw);

  if (parsed.provided && !parsed.valid && !options._suppressInvalidSpeedLog) {
    console.warn(`[TTS] ⚠️ Segment #${segment?.id ?? "N/A"} requested speed ${JSON.stringify(parsed.requested)} cannot be applied (${parsed.reason}) — synthesis rate will remain unmodified (+0%) instead of requested speed`);
  }

  const effectiveRate = parsed.valid ? parsed.rate : "+0%";
  const explicitUserFlag = options.userCustomSpeed !== undefined
    ? Boolean(options.userCustomSpeed)
    : Boolean(segment?.userCustomSpeed);
  const hasExplicitUserSpeed = Boolean(explicitUserFlag || parsed.isCustomNonDefault);

  return {
    ...parsed,
    rate: effectiveRate,
    hasExplicitUserSpeed,
    speedApplyFailed: Boolean(parsed.provided && !parsed.valid),
  };
}

/**
 * 1. បង្កើតសំឡេងតាមរយៈ Microsoft Edge Neural TTS
 * ស្រទាប់ទី 1: node-edge-tts (verified & stable)
 * ស្រទាប់ទី 2: msedge-tts stream
 * ស្រទាប់ទី 3: edge-tts CLI
 * ស្រទាប់ទី 4: Google Translate TTS Fallback
 */
async function synthesizeWithEdgeNeural(text, voiceId, outputPath, rate = "+0%", pitch = "+0Hz", options = {}) {
  const cleanText = cleanTextForTts(text);
  if (!cleanText) {
    throw new Error("អត្ថបទសម្រាប់បង្កើតសំឡេងទទេ (Empty text)!");
  }

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 3;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const randTag = crypto.randomBytes(4).toString("hex");
    const tempFileName = `.tmp_tts_${Date.now()}_${randTag}.mp3`;
    const tempPath = path.join(outDir, tempFileName);

    let succeeded = false;
    const attemptErrors = [];

    // Layer 1: node-edge-tts (លឿន និងមានស្ថេរភាពខ្ពស់បំផុត)
    try {
      const tts = new EdgeTTS({
        voice: voiceId,
        rate: rate || "+0%",
        pitch: pitch || "+0Hz",
      });
      await tts.ttsPromise(cleanText, tempPath);
      await validateTtsAudioFile(tempPath);
      atomicCommitFile(tempPath, outputPath);
      succeeded = true;
      return outputPath;
    } catch (err1) {
      cleanupTempFile(tempPath);
      attemptErrors.push(err1);
      lastError = err1;
      console.warn(`[TTSService] ⚠️ node-edge-tts warning (${err1.message}), attempt ${attempt + 1}/${maxRetries + 1}...`);
    }

    // Layer 2: msedge-tts stream
    if (!succeeded) {
      let tts = null;
      try {
        tts = new MsEdgeTTS();
        await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(cleanText, { rate, pitch });

        await new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(tempPath);
          audioStream.pipe(writeStream);
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
          audioStream.on("error", reject);
        });

        await validateTtsAudioFile(tempPath);
        atomicCommitFile(tempPath, outputPath);
        succeeded = true;
        return outputPath;
      } catch (err2) {
        cleanupTempFile(tempPath);
        attemptErrors.push(err2);
        lastError = err2;
        console.warn(`[TTSService] ⚠️ msedge-tts warning (${err2.message}), attempt ${attempt + 1}/${maxRetries + 1}...`);
      } finally {
        try { tts?.close?.(); } catch (_) { }
      }
    }

    // Layer 3: edge-tts CLI (បើមានក្នុងម៉ាស៊ីន)
    if (!succeeded) {
      try {
        await new Promise((resolve, reject) => {
          const args = [
            "--voice", voiceId,
            "--text", cleanText,
            `--rate=${rate}`,
            `--pitch=${pitch}`,
            "--write-media", tempPath,
          ];
          const proc = spawn("edge-tts", args, { windowsHide: true });
          proc.on("close", (code) => {
            if (code === 0) {
              resolve(tempPath);
            } else {
              reject(new Error(`Edge TTS CLI exited with code ${code}`));
            }
          });
          proc.on("error", (err) => reject(err));
        });

        await validateTtsAudioFile(tempPath);
        atomicCommitFile(tempPath, outputPath);
        succeeded = true;
        return outputPath;
      } catch (err3) {
        cleanupTempFile(tempPath);
        attemptErrors.push(err3);
        // Preserve upstream transient/network error instead of clobbering it with missing optional CLI ENOENT
        if (err3.code !== "ENOENT" || !lastError) {
          lastError = err3;
        }
        console.warn(`[TTSService] ⚠️ edge-tts CLI warning (${err3.message}), attempt ${attempt + 1}/${maxRetries + 1}...`);
      }
    }

    const retryError = pickAttemptRetryError(attemptErrors);
    if (retryError) {
      lastError = retryError;
    }

    // Check if any layer error is transient and eligible for backoff retry
    if (attempt < maxRetries) {
      if (isTransientTtsError(retryError)) {
        console.warn(`[TTSService] ⏳ Transient error detected (${retryError.message}). Retrying with jittered exponential backoff...`);
        await sleepWithJitter(attempt);
        continue;
      } else {
        console.warn(`[TTSService] 🛑 Non-transient error detected (${retryError?.message}). Skipping further Edge TTS retries.`);
        break;
      }
    }
  }

  // Layer 4: Fallback ទៅកាន់ Google Translate TTS
  if (rate && rate !== "+0%") {
    console.warn(`[TTS] ⚠️ Requested rate ${rate} (speed=${options.requestedSpeed ?? rate}) cannot be applied on Google Translate TTS Fallback`);
  }
  console.warn(`[TTSService] ⚠️ Edge TTS attempts exhausted (${lastError?.message}), using Google Translate TTS Fallback...`);
  return await synthesizeWithGoogleFallback(cleanText, outputPath, options);
}

/**
 * 2. បង្កើតសំឡេងតាមរយៈ Google Translate TTS Khmer (Fallback)
 */
function synthesizeWithGoogleFallback(text, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const cleanText = cleanTextForTts(text).slice(0, 200);
    if (!cleanText) {
      return reject(new Error("អត្ថបទសម្រាប់បង្កើតសំឡេងទទេ (Empty text)!"));
    }
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const randTag = crypto.randomBytes(4).toString("hex");
    const tempFileName = `.tmp_gtts_${Date.now()}_${randTag}.mp3`;
    const tempPath = path.join(outDir, tempFileName);

    const encodedText = encodeURIComponent(cleanText);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=km&client=tw-ob`;

    const fileStream = fs.createWriteStream(tempPath);
    const req = https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          timeout: 12000,
        },
        (response) => {
          if (response.statusCode !== 200) {
            fileStream.close();
            cleanupTempFile(tempPath);
            return reject(new Error(`Google TTS HTTP Status ${response.statusCode}`));
          }
          response.pipe(fileStream);
          fileStream.on("finish", async () => {
            fileStream.close();
            try {
              await validateTtsAudioFile(tempPath);
              atomicCommitFile(tempPath, outputPath);
              resolve(outputPath);
            } catch (valErr) {
              cleanupTempFile(tempPath);
              reject(valErr);
            }
          });
        }
      );

    req.on("error", (err) => {
      fileStream.close();
      cleanupTempFile(tempPath);
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      fileStream.close();
      cleanupTempFile(tempPath);
      reject(new Error("Google TTS request timed out"));
    });
  });
}

function resolvePriorSegmentAudioPath(segment = {}, uploadsDir = "") {
  if (!segment) return null;
  const safeUploadsDir = typeof uploadsDir === "string" && uploadsDir.trim() ? uploadsDir.trim() : null;
  const resolvedBase = safeUploadsDir ? path.resolve(safeUploadsDir) : null;
  const candidates = [];
  if (segment.audioPath && typeof segment.audioPath === "string") {
    candidates.push(segment.audioPath);
  }
  if (segment.audioFile && typeof segment.audioFile === "string") {
    if (safeUploadsDir) candidates.push(path.join(safeUploadsDir, path.basename(segment.audioFile)));
    else candidates.push(segment.audioFile);
  }
  if (segment.audioUrl && typeof segment.audioUrl === "string") {
    const cleanUrl = segment.audioUrl.split("?")[0];
    if (cleanUrl) {
      if (safeUploadsDir) candidates.push(path.join(safeUploadsDir, path.basename(cleanUrl)));
      else candidates.push(cleanUrl);
    }
  }
  for (const cand of candidates) {
    try {
      const resolved = path.resolve(cand);
      const insideDir = resolvedBase ? (resolved.startsWith(resolvedBase + path.sep) || resolved === resolvedBase) : true;
      if (insideDir && fs.existsSync(resolved) && fs.statSync(resolved).size > 200) {
        return resolved;
      }
    } catch (_) {}
  }
  return null;
}

/**
 * 3. បង្កើតសំឡេងសម្រាប់ឃ្លាមួយ (Single Segment) រួមជាមួយ Auto Time-Stretch (atempo)
 */
async function generateSingleSegmentAudio(segment, uploadsDir, options = {}) {
  const { autoStretch = true, maxSpeed = 1.50, pitch = "+0Hz" } = options;

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const speedInfo = resolveSegmentSpeed(segment, options);
  const rate = speedInfo.rate;
  const hasExplicitUserSpeed = speedInfo.hasExplicitUserSpeed;
  const effectiveAutoStretch = Boolean(autoStretch) && !hasExplicitUserSpeed;

  const rawText = segment.khmer || segment.khmerText || segment.khmerTranslatedText || segment.text || "";
  const textToSpeak = cleanTextForTts(rawText);
  if (!textToSpeak || isPlaceholderOrEmptyTtsText(rawText)) {
    throw new Error(
      textToSpeak === "សន្ទនា"
        ? "អត្ថបទ \"សន្ទនា\" ជាពាក្យជំនួសទទេ (Empty text / Untranslated placeholder)!"
        : "អត្ថបទសម្រាប់បង្កើតសំឡេងទទេ (Empty text)!"
    );
  }
  const normalizeKnownGender = (g) => {
    const v = String(g || "").trim().toLowerCase();
    if (v === "female" || v === "f" || v === "ស្រី" || v === "girl" || v === "woman") return "female";
    if (v === "male" || v === "m" || v === "ប្រុស" || v === "boy" || v === "man") return "male";
    return "";
  };
  const speakerKeyName = String(segment.speaker || segment.speakerName || "").trim();
  const isGenericSpk = !speakerKeyName || speakerKeyName === "តួអង្គ" || speakerKeyName.toLowerCase() === "speaker";
  const spkReg = options.speakerRegistry || segment.speakerRegistry || {};
  const regEntry =
    (segment.speakerId && spkReg[segment.speakerId]) ||
    (!isGenericSpk && spkReg[speakerKeyName]) ||
    Object.values(spkReg).find((r) => r && (
      (r.speakerId && (r.speakerId === segment.speakerId || r.id === segment.speakerId)) ||
      (!isGenericSpk && (r.speakerName === speakerKeyName || r.name === speakerKeyName))
    )) ||
    null;
  const mapVoice = options.speakerMap
    ? ((segment.speakerId && options.speakerMap[segment.speakerId]) || (!isGenericSpk && options.speakerMap[speakerKeyName]) || null)
    : null;
  const registryVoice = regEntry?.voiceId || regEntry?.khmerVoiceId || mapVoice || null;
  const regIsManual = Boolean(regEntry?.userOverridden) || regEntry?.voiceAssignmentSource === "manual";
  const isManualSegment = Boolean(segment.userOverridden || segment.voiceAssignmentSource === "manual" || segment.voiceOverride) || regIsManual;

  const knownSegGender = regIsManual
    ? (normalizeKnownGender(regEntry?.voiceGender || regEntry?.gender) || normalizeKnownGender(segment.voiceGender))
    : (
        normalizeKnownGender(segment.voiceGender) ||
        normalizeKnownGender(segment.gender) ||
        normalizeKnownGender(segment.speakerGender) ||
        normalizeKnownGender(regEntry?.voiceGender || regEntry?.gender) ||
        normalizeKnownGender(detectSpeakerGender(speakerKeyName, "", textToSpeak))
      );

  const segGender = knownSegGender || "unknown";
  let rawAssignedVoice;
  if (options.forceVoice && options.voiceId) {
    rawAssignedVoice = options.voiceId;
  } else if (regIsManual && registryVoice) {
    rawAssignedVoice = registryVoice;
  } else if (isManualSegment) {
    rawAssignedVoice = segment.voiceOverride || segment.khmerVoiceId || segment.voiceId || segment.voice || registryVoice || options.voiceId;
  } else if (registryVoice) {
    rawAssignedVoice = registryVoice;
  } else if (knownSegGender === "female" || knownSegGender === "male") {
    rawAssignedVoice = knownSegGender === "female" ? "km-KH-SreymomNeural" : "km-KH-PisethNeural";
  } else {
    rawAssignedVoice = segment.khmerVoiceId || segment.voice || segment.voiceId || options.voiceId;
  }
  const voiceId = resolveKhmerVoice(rawAssignedVoice, segGender);

  console.log(`[TTS] Segment #${segment.id || 'N/A'} synthesis params: voice=${voiceId}, rate=${rate}, requestedSpeed=${speedInfo.requested ?? 'default'}, userCustomSpeed=${hasExplicitUserSpeed}, autoStretch=${effectiveAutoStretch}`);

  const cleanId = String(segment.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "_");
  const epPrefix = options.episodeId ? `ep_${String(options.episodeId).replace(/[^a-zA-Z0-9_-]/g, "_")}_` : (segment.episodeId ? `ep_${String(segment.episodeId).replace(/[^a-zA-Z0-9_-]/g, "_")}_` : "");

  // Inner-Thought & Audio Effect Metadata
  const deliveryType = options.deliveryType || segment.deliveryType || "out_loud";
  const isThought = deliveryType === "inner_thought";
  const audioEffect = options.audioEffect || segment.audioEffect || (isThought ? "inner_thought_reverb" : "none");
  const effectConfig = options.effectConfig || segment.effectConfig || { inGain: 0.85, outGain: 0.75, delays: "40|90", decays: "0.3|0.15" };
  const deliveryOverride = Boolean(options.deliveryOverride !== undefined ? options.deliveryOverride : segment.deliveryOverride);

  // Compute exact cache key incorporating text, voiceId, deliveryType, effect settings, rate, and stretch mode
  const effectKey = isThought ? `${audioEffect}_${effectConfig.delays || "40|90"}_${effectConfig.decays || "0.3|0.15"}` : "clean";
  const speedCacheMode = hasExplicitUserSpeed ? "custom" : (effectiveAutoStretch ? "fit" : "raw");
  const cacheKey = `${textToSpeak}__${voiceId}__${deliveryType}__${effectKey}__${rate}__${speedCacheMode}__lt1`;
  const cacheHash = crypto.createHash("md5").update(cacheKey).digest("hex").substring(0, 8);
  const legacyRateHash = crypto.createHash("md5").update(`${textToSpeak}__${voiceId}__${deliveryType}__${effectKey}__${rate}__${speedCacheMode}`).digest("hex").substring(0, 8);
  const legacyBaseHash = crypto.createHash("md5").update(`${textToSpeak}__${voiceId}__${deliveryType}__${effectKey}`).digest("hex").substring(0, 8);
  const typeTag = isThought ? "thought" : "voice";
  let fileName = `${epPrefix}seg_${cleanId}_${voiceId}_${typeTag}_${cacheHash}.mp3`;
  let outputPath = path.join(uploadsDir, fileName);

  const startSec = Number(segment.startSeconds ?? segment.startSec ?? parseTimeToSec(segment.start, 0));
  const endSec = Number(segment.endSeconds ?? segment.endSec ?? parseTimeToSec(segment.end, startSec + 2.5));

  // Explicit Three-Duration Model:
  // 1. sourceSpeechDuration: original dialogue timing reference for lip-sync evaluation (immutable reference)
  const sourceSpeechDuration = (typeof segment.sourceSpeechDuration === 'number' && segment.sourceSpeechDuration > 0)
    ? segment.sourceSpeechDuration
    : (typeof segment.sourceEndSec === 'number' && typeof segment.sourceStartSec === 'number' && segment.sourceEndSec > segment.sourceStartSec)
      ? parseFloat((segment.sourceEndSec - segment.sourceStartSec).toFixed(2))
      : parseFloat((endSec - startSec).toFixed(2));

  // 2. availableSlotDuration: hard non-overlap boundary until next dialogue onset
  const availableSlotDuration = (typeof segment.availableSlotDuration === 'number' && segment.availableSlotDuration > 0)
    ? segment.availableSlotDuration
    : (typeof segment.slotDuration === 'number' && segment.slotDuration > 0)
      ? segment.slotDuration
      : (typeof options.targetDurationSec === 'number' && options.targetDurationSec > 0 ? options.targetDurationSec : sourceSpeechDuration);

  const targetDuration = availableSlotDuration;

  let finalDuration = targetDuration;
  let originalDuration = targetDuration;
  let appliedSpeed = hasExplicitUserSpeed ? (speedInfo.numericSpeed || 1.0) : 1.0;
  let usedCache = false;
  let rawFilePath = segment.rawAudioPath && fs.existsSync(segment.rawAudioPath) ? segment.rawAudioPath : null;
  let rawFileName = rawFilePath ? path.basename(rawFilePath) : null;

  // 1. Check if an exact cached version of this audio already exists and is valid
  let cacheCandidatePath = null;
  if (!options.forceRegen && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 200) {
    cacheCandidatePath = outputPath;
  } else if (
    !options.forceRegen &&
    !segment.audioOutdated &&
    segment.ttsStatus !== "pending" &&
    segment.ttsStatus !== "error" &&
    segment.ttsStatus !== "generating" &&
    (!segment.ttsRate || segment.ttsRate === rate)
  ) {
    const existingPrior = resolvePriorSegmentAudioPath(segment, uploadsDir);
    if (existingPrior) {
      const priorBase = path.basename(existingPrior);
      if (priorBase.includes(legacyRateHash) || priorBase.includes(legacyBaseHash)) {
        cacheCandidatePath = existingPrior;
      }
    }
  }

  if (cacheCandidatePath) {
    try {
      const knownDur = (typeof segment.audioDuration === 'number' && segment.audioDuration > 0)
        ? segment.audioDuration
        : ((typeof segment.audioDurationSec === 'number' && segment.audioDurationSec > 0)
          ? segment.audioDurationSec
          : null);
      const cachedDur = knownDur || (await getMediaDuration(cacheCandidatePath));
      if (cachedDur && cachedDur > 0) {
        outputPath = cacheCandidatePath;
        fileName = path.basename(cacheCandidatePath);
        finalDuration = cachedDur;
        originalDuration = cachedDur;
        usedCache = true;
        console.log(`[TTSService] ⚡ Reusing verified cached audio for segment #${segment.id || 'N/A'} (${deliveryType}, rate=${rate}): ${fileName}`);
      }
    } catch (_) { }
  }

  // 2. If not cached, synthesize and apply appropriate effect
  if (!usedCache) {
    if (isThought) {
      // Step A: Ensure valid clean speech base exists
      const rawHash = crypto.createHash("md5").update(`${textToSpeak}__${voiceId}__raw__${rate}__${speedCacheMode}__lt1`).digest("hex").substring(0, 8);
      rawFileName = `${epPrefix}seg_${cleanId}_${voiceId}_raw_${rawHash}.mp3`;
      rawFilePath = path.join(uploadsDir, rawFileName);

      if (options.forceRegen || !fs.existsSync(rawFilePath) || fs.statSync(rawFilePath).size < 200) {
        // Always synthesize natural 1.0x speech (+0%) so exact speed is applied once via FFmpeg atempo (zero stacking/prosody drift)
        try {
          if (voiceId === "google-km-standard") {
            await synthesizeWithGoogleFallback(textToSpeak, rawFilePath);
          } else {
            await synthesizeWithEdgeNeural(textToSpeak, voiceId, rawFilePath, "+0%", pitch, { requestedSpeed: speedInfo.requested });
          }
        } catch (edgeErr) {
          console.warn(`[TTSService] ⚠️ Edge TTS failed for raw thought base #${segment.id}, using Google TTS: ${edgeErr.message}`);
          await synthesizeWithGoogleFallback(textToSpeak, rawFilePath);
        }

        // Strip Edge TTS ~200ms leading & ~800ms trailing dead silence immediately after synthesis
        if (fs.existsSync(rawFilePath)) {
          try {
            await trimTtsSilence(rawFilePath, { leadInCushionSec: 0.025, leadOutCushionSec: 0.060, microFadeMs: 8 });
          } catch (trimErr) {
            console.warn(`[TTSService] ⚠️ trimTtsSilence warning (thought raw): ${trimErr.message}`);
          }
        }

        if (hasExplicitUserSpeed && fs.existsSync(rawFilePath)) {
          const exactTargetSpeed = Number(speedInfo.numericSpeed || 1.0);
          if (Math.abs(exactTargetSpeed - 1.0) > 0.001) {
            const exactRes = await applyExactAudioSpeed(rawFilePath, exactTargetSpeed);
            appliedSpeed = exactRes.appliedSpeed;
          } else {
            appliedSpeed = 1.0;
          }
          console.log(`[TTS] Segment #${segment.id || 'N/A'} (inner_thought) explicit user speed (ttsRate=+0%, requestedRate=${rate}, atempo=${appliedSpeed}x) — skipped slot autoStretch`);
        } else if (effectiveAutoStretch && fs.existsSync(rawFilePath)) {
          try {
            const stretchRes = await autoStretchTtsAudio({
              inputAudioPath: rawFilePath,
              targetDuration: targetDuration,
              maxSpeed: maxSpeed,
              minSpeed: 0.90,
              leadInCushionSec: 0.025,
              leadOutCushionSec: 0.060,
              microFadeMs: 8,
            });
            if (stretchRes?.appliedSpeed) appliedSpeed = stretchRes.appliedSpeed;
          } catch (_) { }
        }
      }

      // Step B: Apply configurable subtle FFmpeg aecho effect to separate output file
      const effectRes = await applyInnerThoughtAudioEffect({
        inputAudioPath: rawFilePath,
        outputPath: outputPath,
        effectConfig: effectConfig,
      });

      finalDuration = effectRes.duration;
      originalDuration = await getMediaDuration(rawFilePath) || finalDuration;
    } else {
      // Normal spoken dialogue — always synthesize at natural 1.0x (+0%) so exact speed is applied once via FFmpeg atempo
      try {
        if (voiceId === "google-km-standard") {
          await synthesizeWithGoogleFallback(textToSpeak, outputPath);
        } else {
          await synthesizeWithEdgeNeural(textToSpeak, voiceId, outputPath, "+0%", pitch, { requestedSpeed: speedInfo.requested });
        }
      } catch (edgeErr) {
        console.warn(`[TTSService] ⚠️ Edge TTS failed for segment #${segment.id}, using Google TTS: ${edgeErr.message}`);
        await synthesizeWithGoogleFallback(textToSpeak, outputPath);
      }

      // Verify generated audio file existence and non-zero size
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 200) {
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch (_) { }
        }
        throw new Error(`TTS audio file is missing or invalid (<200 bytes) for segment #${segment.id || 'unknown'}`);
      }

      // Always trim Edge TTS dead ~200ms leading & ~800ms trailing padding before duration measurement / slot fit
      let trimRes = null;
      try {
        trimRes = await trimTtsSilence(outputPath, { leadInCushionSec: 0.025, leadOutCushionSec: 0.060, microFadeMs: 8 });
      } catch (trimErr) {
        console.warn(`[TTSService] ⚠️ trimTtsSilence warning: ${trimErr.message}`);
      }

      const actualDuration = (trimRes && typeof trimRes.finalDuration === 'number' && trimRes.finalDuration > 0)
        ? trimRes.finalDuration
        : ((await getMediaDuration(outputPath)) || targetDuration);
      originalDuration = actualDuration;
      finalDuration = actualDuration;

      if (effectiveAutoStretch && fs.existsSync(outputPath)) {
        // Dubbing Policy:
        // availableSlotDuration is the reference boundary for avoiding collision with subsequent dialogue.
        // If the speech is only slightly longer than the slot (<= 30%), a gentle speed adjustment (up to 1.25x) fits naturally.
        // But if dialogue is significantly longer than an artificially short visual slot (e.g. 4s sentence in 1.35s slot),
        // NEVER artificially crush or chipmunk the speech: keep full natural delivery (subsequent dialogue safely alternates to Track A2).
        const MIN_COLLISION_SAFETY_MARGIN_SEC = 0.100;
        const safeSlotTarget = Math.max(0.20, parseFloat((availableSlotDuration - MIN_COLLISION_SAFETY_MARGIN_SEC).toFixed(3)));

        const ratio = actualDuration / safeSlotTarget;
        // Auto-fit speech speed (1.05x - 1.50x): Speed up overflowing speech so dialogue finishes all words without cut
        const maxAllowedStretchSpeed = Math.max(1.50, maxSpeed || 1.50);
        const shouldStretch = ratio > 1.02;
        const targetSpeed = Math.min(maxAllowedStretchSpeed, ratio);

        if (shouldStretch) {
          try {
            const stretchResult = await autoStretchTtsAudio({
              inputAudioPath: outputPath,
              targetDuration: safeSlotTarget,
              maxSpeed: targetSpeed,
              minSpeed: 1.0,
              leadInCushionSec: 0.025,
              leadOutCushionSec: 0.060,
              microFadeMs: 8,
              allowSlowdown: false,
              isPreTrimmed: true,
              currentDuration: actualDuration,
            });
            finalDuration = stretchResult.finalDuration;
            originalDuration = stretchResult.finalDuration;
            appliedSpeed = stretchResult.appliedSpeed;
          } catch (stretchErr) {
            console.warn(`[TTSService] ⚠️ autoStretchTtsAudio error (${stretchErr.message}), keeping original audio duration`);
          }
        } else if (
          actualDuration >= 0.80 &&
          sourceSpeechDuration >= 0.80 &&
          actualDuration < sourceSpeechDuration * 0.50 &&
          sourceSpeechDuration <= availableSlotDuration
        ) {
          // Slow down only if non-short dialogue is unnaturally rushed compared to mouth movement
          // (Skip short segments <0.8s to preserve crisp Khmer monosyllabic/disyllabic delivery)
          try {
            const stretchResult = await autoStretchTtsAudio({
              inputAudioPath: outputPath,
              targetDuration: sourceSpeechDuration,
              maxSpeed: 1.0,
              minSpeed: 0.92,
              leadInCushionSec: 0.025,
              leadOutCushionSec: 0.060,
              microFadeMs: 8,
              allowSlowdown: true,
              isPreTrimmed: true,
              currentDuration: actualDuration,
            });
            finalDuration = stretchResult.finalDuration;
            originalDuration = stretchResult.originalDuration;
            appliedSpeed = stretchResult.appliedSpeed;
          } catch (_) { }
        } else {
          finalDuration = actualDuration;
          originalDuration = actualDuration;
          appliedSpeed = 1.0;
        }
      } else if (hasExplicitUserSpeed && fs.existsSync(outputPath)) {
        // Manual Clip Speed ALWAYS wins over Auto-Fit: apply exact FFmpeg atempo ONCE on natural 1.0x TTS
        const exactTargetSpeed = Number(speedInfo.numericSpeed || 1.0);
        if (Math.abs(exactTargetSpeed - 1.0) > 0.001) {
          const exactRes = await applyExactAudioSpeed(outputPath, exactTargetSpeed);
          finalDuration = exactRes.finalDuration;
          originalDuration = exactRes.finalDuration;
          appliedSpeed = exactRes.appliedSpeed;
        } else {
          finalDuration = actualDuration;
          originalDuration = actualDuration;
          appliedSpeed = 1.0;
        }
        console.log(`[TTS] Segment #${segment.id || 'N/A'} explicit user speed (ttsRate=+0%, requestedRate=${rate}, atempo=${appliedSpeed}x) — skipped slot autoStretch (natural=${actualDuration.toFixed(3)}s -> final=${finalDuration.toFixed(3)}s, slot=${availableSlotDuration.toFixed(3)}s)`);
      } else {
        finalDuration = actualDuration;
        originalDuration = actualDuration;
        appliedSpeed = 1.0;
      }

      rawFilePath = outputPath;
      rawFileName = fileName;
    }

    // Verify final output audio
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 200) {
      throw new Error(`Audio generation failed to produce valid audio file for segment #${segment.id || 'unknown'}`);
    }
  }

  // Preserve prior audio file until new file has succeeded; never delete raw base audio, split-shared files, or unrelated segments
  const priorAudioPath = resolvePriorSegmentAudioPath(segment, uploadsDir);
  if (priorAudioPath) {
    const resolvedPrior = path.resolve(priorAudioPath);
    const resolvedUploadsDir = path.resolve(uploadsDir);
    const resolvedOut = path.resolve(outputPath);
    const resolvedRaw = rawFilePath ? path.resolve(rawFilePath) : null;
    const isSharedWithOtherSegment = Boolean(options.sharedAudioPaths && options.sharedAudioPaths.has(resolvedPrior));
    if (
      path.dirname(resolvedPrior) === resolvedUploadsDir &&
      resolvedPrior !== resolvedOut &&
      resolvedPrior !== resolvedRaw &&
      !isSharedWithOtherSegment &&
      !segment.audioOffset
    ) {
      try {
        const baseName = path.basename(resolvedPrior);
        const expectedPrefix = `${epPrefix}seg_${cleanId}_`;
        const isOtherVoiceVariant = (
          (baseName.includes("Piseth") && !voiceId.includes("Piseth")) ||
          (baseName.includes("Sreymom") && !voiceId.includes("Sreymom"))
        );
        if (
          (baseName.startsWith(expectedPrefix) || (!epPrefix && baseName.startsWith(`seg_${cleanId}_`))) &&
          !baseName.includes(cacheHash) &&
          !baseName.includes("_raw_") &&
          !isOtherVoiceVariant
        ) {
          fs.unlinkSync(resolvedPrior);
        }
      } catch (_) { }
    }
  }

  const isFemale = voiceId.includes("Sreymom");
  const uploadsRoot = path.resolve(__dirname, "..", "uploads");
  const relPath = path.relative(uploadsRoot, outputPath).replace(/\\/g, "/");
  const cacheBustTime = Date.now();
  const calculatedAudioUrl = `/uploads/${relPath}?t=${cacheBustTime}`;

  console.log(`[TTSService] 🎙️ Verified valid audio for segment #${segment.id || 'N/A'} [${deliveryType}]:`, {
    file: fileName,
    sizeBytes: fs.statSync(outputPath).size,
    durationSec: finalDuration,
    rate,
    appliedSpeed,
    userCustomSpeed: hasExplicitUserSpeed,
    effect: audioEffect,
    audioUrl: calculatedAudioUrl,
  });

  const incomingGender = segment.voiceGender || segment.gender;
  const isUnknown = incomingGender === "unknown" || incomingGender === "UNKNOWN";
  const resolvedGender = (!knownSegGender && isUnknown) ? "unknown" : (isFemale ? "female" : "male");
  const finalConfidence = isUnknown
    ? (typeof segment.genderConfidence === "number" ? segment.genderConfidence : null)
    : (typeof segment.genderConfidence === "number" ? segment.genderConfidence : 1.0);
  const resolvedKhmer = segment.khmer || segment.khmerText || segment.khmerTranslatedText || textToSpeak;
  const resolvedSpeedValue = (speedInfo.valid && speedInfo.provided)
    ? (typeof speedInfo.requested === "string" && speedInfo.requested.trim().toLowerCase() === "normal"
      ? "normal"
      : (speedInfo.numericSpeed ?? 1.0))
    : (segment.speed ?? "normal");

  const existingVariants = (segment.voiceAudioVariants && typeof segment.voiceAudioVariants === "object")
    ? { ...segment.voiceAudioVariants }
    : {};
  const otherVoice = voiceId.includes("Piseth") ? "km-KH-SreymomNeural" : "km-KH-PisethNeural";
  const updatedVariants = {
    ...existingVariants,
    [voiceId]: {
      voiceId: voiceId,
      audioUrl: calculatedAudioUrl,
      audioFile: fileName,
      audioPath: outputPath,
      audioDurationSec: finalDuration,
      speed: resolvedSpeedValue,
      text: resolvedKhmer,
      timestamp: Date.now(),
    },
  };

  // Auto-discover if the other voice variant already exists in uploadsDir
  if (!updatedVariants[otherVoice] && uploadsDir && fs.existsSync(uploadsDir)) {
    try {
      const prefix = `${epPrefix}seg_${cleanId}_${otherVoice}_`;
      const files = fs.readdirSync(uploadsDir);
      const match = files.find((f) => f.startsWith(prefix) && f.endsWith(".mp3") && !f.includes("_raw_"));
      if (match) {
        const otherPath = path.join(uploadsDir, match);
        const otherRel = path.relative(uploadsRoot, otherPath).replace(/\\/g, "/");
        updatedVariants[otherVoice] = {
          voiceId: otherVoice,
          audioUrl: `/uploads/${otherRel}`,
          audioFile: match,
          audioPath: otherPath,
          text: resolvedKhmer,
          timestamp: Date.now(),
        };
      }
    } catch (_) {}
  }

  return {
    ...segment,
    id: segment.segmentId || segment.id,
    segmentId: segment.segmentId || segment.id,
    sourceStartSec: typeof segment.sourceStartSec === "number" ? segment.sourceStartSec : startSec,
    sourceEndSec: typeof segment.sourceEndSec === "number" ? segment.sourceEndSec : endSec,
    originalChineseText: segment.originalChineseText || segment.original || segment.originalText || "",
    originalText: segment.originalChineseText || segment.original || segment.originalText || "",
    original: segment.originalChineseText || segment.original || segment.originalText || "",
    khmerTranslatedText: resolvedKhmer,
    khmerText: resolvedKhmer,
    khmer: resolvedKhmer,
    voice: voiceId,
    voiceId: voiceId,
    khmerVoiceId: voiceId,
    gender: resolvedGender,
    speakerGender: resolvedGender.toUpperCase(),
    voiceGender: resolvedGender,
    speakerId: segment.speakerId || null,
    speakerName: segment.speakerName || segment.speaker || "តួអង្គ",
    voiceAssignmentSource: options.forceVoice ? "manual" : (segment.voiceAssignmentSource || "automatic"),
    genderConfidence: finalConfidence,
    deliveryType,
    deliveryOverride,
    deliveryConfidence: typeof segment.deliveryConfidence === "number" ? segment.deliveryConfidence : 1.0,
    deliveryReviewNeeded: false,
    audioEffect,
    effectConfig: isThought ? effectConfig : null,
    rawAudioPath: rawFilePath,
    rawAudioFile: rawFileName,
    audioFileName: fileName,
    audioFile: fileName,
    audioPath: outputPath,
    audioUrl: calculatedAudioUrl,
    originalAudioDuration: originalDuration,
    rawAudioDur: hasExplicitUserSpeed ? finalDuration : originalDuration,
    sourceSpeechDuration: sourceSpeechDuration,
    availableSlotDuration: availableSlotDuration,
    finalAudioDuration: finalDuration,
    audioDuration: finalDuration,
    audioDurationSec: finalDuration,
    audioStartSec: startSec,
    audioEndSec: parseFloat((startSec + finalDuration).toFixed(2)),
    speed: resolvedSpeedValue,
    userCustomSpeed: hasExplicitUserSpeed,
    ttsRate: rate,
    appliedSpeed: appliedSpeed,
    ...(speedInfo.speedApplyFailed ? { speedWarning: `unapplied:${speedInfo.requested}` } : {}),
    audioOffset: 0,
    audioTrimmed: false,
    userTrimmed: false,
    safetyMarginSec: parseFloat((availableSlotDuration - finalDuration).toFixed(3)),
    overlapPreventionStatus: (availableSlotDuration - finalDuration) >= 0.080 ? "SAFE" : ((availableSlotDuration - finalDuration) >= 0 ? "MARGIN_WARNING" : "COLLISION"),
    overlapRisk: (availableSlotDuration - finalDuration) >= 0.080 ? "SAFE" : "HIGH",
    lipSyncOffsetSec: parseFloat((finalDuration - sourceSpeechDuration).toFixed(3)),
    lipSyncStatus: Math.abs(finalDuration - sourceSpeechDuration) <= 0.150 ? "EXACT_MATCH" : (Math.abs(finalDuration - sourceSpeechDuration) <= 0.500 ? "ACCEPTABLE_PACING" : "LIP_SYNC_MISMATCH"),
    syncWarning: (availableSlotDuration - finalDuration) < 0 ? "exceeds_slot_at_max_tempo" : ((availableSlotDuration - finalDuration) < 0.080 ? "safety_margin_under_80ms" : null),
    overflowSec: finalDuration > availableSlotDuration ? parseFloat((finalDuration - availableSlotDuration).toFixed(3)) : 0,
    audioOutdated: false,
    audioSignature: computeSegmentAudioSignature(resolvedKhmer, voiceId, resolvedSpeedValue, segment.pitch),
    ttsStatus: "ready",
    status: "audio_ready",
    voiceAudioVariants: updatedVariants,
    _wasNewlySynthesized: !usedCache,
  };
}

const activeTtsJobs = new Map();

function getTtsJobProgress(seriesId = '', episodeId = '') {
  const s = seriesId ? String(seriesId).trim() : '';
  const e = episodeId ? String(episodeId).trim() : '';
  const exactKey = e ? `${s}:${e}` : (s || 'default');
  const direct = activeTtsJobs.get(exactKey);
  if (direct) return direct;
  if (e) {
    for (const state of activeTtsJobs.values()) {
      if (state.episodeId === e && (!s || state.seriesId === s)) {
        return state;
      }
    }
  }
  return null;
}

function cancelTtsJob(targetKey = 'all') {
  let count = 0;
  console.log(`[TTSService] 🛑 Kill TTS command received for: ${targetKey}`);
  if (!targetKey || targetKey === 'all') {
    for (const [key, state] of activeTtsJobs.entries()) {
      state.aborted = true;
      count++;
    }
    activeTtsJobs.clear();
  } else {
    for (const [key, state] of activeTtsJobs.entries()) {
      if (key === targetKey || key.includes(targetKey)) {
        state.aborted = true;
        activeTtsJobs.delete(key);
        count++;
      }
    }
  }
  return { cancelled: true, count };
}

/**
 * 4. បង្កើតសំឡេងសម្រាប់គ្រប់ឃ្លាទាំងអស់ (Batch Parallel Generation, Concurrency = 3 default)
 */
async function generateBatchSegmentsAudio(segments = [], uploadsDir, options = {}) {
  const { autoStretch = true, maxSpeed = 1.50 } = options;
  const results = new Array(segments.length);

  const hasBatchRate = options.rate !== undefined && options.rate !== null && options.rate !== "";
  const hasBatchSpeed = options.speed !== undefined && options.speed !== null && options.speed !== "";
  const batchSpeedRaw = hasBatchRate ? options.rate : (hasBatchSpeed ? options.speed : undefined);
  const batchSpeedInfo = speedToEdgeRate(batchSpeedRaw);
  if (batchSpeedInfo.provided && !batchSpeedInfo.valid) {
    console.warn(`[TTS] ⚠️ Batch requested speed ${JSON.stringify(batchSpeedInfo.requested)} cannot be applied (${batchSpeedInfo.reason}) — segments without valid per-segment speed will remain at +0%`);
  }
  const batchExplicitUserSpeed = Boolean(options.userCustomSpeed) || batchSpeedInfo.isCustomNonDefault;

  // Detect any audio files shared across split clips so regenerating one segment never unlinks a sibling's file
  const pathRefCounts = new Map();
  for (const s of segments) {
    const resolvedPrior = resolvePriorSegmentAudioPath(s, uploadsDir);
    if (resolvedPrior) {
      pathRefCounts.set(resolvedPrior, (pathRefCounts.get(resolvedPrior) || 0) + 1);
    }
  }
  const sharedAudioPaths = new Set(
    Array.from(pathRefCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([p]) => p)
  );

  const jobKey = options.jobKey || (options.episodeId ? `${options.seriesId || ''}:${options.episodeId}` : 'default');
  const jobState = {
    aborted: false,
    seriesId: options.seriesId || null,
    episodeId: options.episodeId || null,
    total: segments.length,
    completed: 0,
    skippedEmpty: 0,
    failed: 0,
    lastFile: null,
    stage: 'synthesizing',
    startedAt: Date.now(),
  };
  activeTtsJobs.set(jobKey, jobState);

  // Fast pre-filter: empty/placeholder text handled immediately in 0ms
  const pendingIndices = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || "";
    const cleanedTextToSpeak = cleanTextForTts(text);
    if (!cleanedTextToSpeak || isPlaceholderOrEmptyTtsText(text)) {
      results[i] = {
        ...seg,
        audioUrl: null,
        audioPath: null,
        audioFile: null,
        audioGenerated: false,
        audioDuration: 0,
        audioDurationSec: 0,
        ttsStatus: "empty_text",
        _wasNewlySynthesized: false,
      };
      jobState.skippedEmpty++;
      jobState.completed++;
    } else {
      pendingIndices.push(i);
    }
  }

  // Base concurrency: 4 if pending >= 8, else 3 (bounded between 1 and 6)
  const userRequestedConcurrency = Number(options.concurrency);
  const baseConcurrency = !isNaN(userRequestedConcurrency) && userRequestedConcurrency > 0
    ? Math.max(1, Math.min(6, userRequestedConcurrency))
    : (pendingIndices.length >= 8 ? 4 : 3);

  let activeConcurrency = baseConcurrency;
  let consecutiveErrors = 0;
  let consecutiveSuccesses = 0;

  console.log(
    `[TTSService] 🎙️ ចាប់ផ្តើមបង្កើតសំឡេងខ្មែរចំនួន ${segments.length} ឃ្លា (${pendingIndices.length} pending, Concurrency: ${baseConcurrency}, Job: ${jobKey}, BatchRate: ${batchSpeedInfo.valid ? batchSpeedInfo.rate : 'INVALID'})...`
  );
  const startTime = Date.now();

  let nextPendingIndex = 0;

  async function worker(workerId) {
    while (nextPendingIndex < pendingIndices.length) {
      if (jobState.aborted || options.signal?.aborted) {
        console.log(`[TTSService] 🛑 TTS Generation stopped/killed for ${jobKey}`);
        break;
      }

      // If concurrency was backed off due to network errors, let higher-index workers yield
      if (workerId >= activeConcurrency) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (workerId >= activeConcurrency) continue;
      }

      const currentQueuePos = nextPendingIndex++;
      if (currentQueuePos >= pendingIndices.length) break;
      const idx = pendingIndices[currentQueuePos];
      const seg = segments[idx];

      const text = seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || "";
      const cleanedTextToSpeak = cleanTextForTts(text);

      try {
        const generateFn = options.generateSingleFn || generateSingleSegmentAudio;

        const segHasUserFlag = Boolean(seg.userCustomSpeed);
        const hasSegSpeed = seg.speed !== undefined && seg.speed !== null && seg.speed !== "";
        const hasSegRate = seg.rate !== undefined && seg.rate !== null && seg.rate !== "";
        const segOwnRaw = hasSegSpeed ? seg.speed : (hasSegRate ? seg.rate : undefined);
        const segOwnInfo = speedToEdgeRate(segOwnRaw);
        const segHasOwnCustomSpeed = segHasUserFlag || segOwnInfo.isCustomNonDefault || Boolean(segOwnInfo.provided && !segOwnInfo.valid);

        let perSegOptions;
        if (segHasOwnCustomSpeed) {
          if (segOwnInfo.provided && !segOwnInfo.valid) {
            console.warn(`[TTS] ⚠️ Batch Segment #${seg.id || idx + 1} requested speed ${JSON.stringify(segOwnInfo.requested)} cannot be applied (${segOwnInfo.reason})`);
          }
          perSegOptions = {
            ...options,
            autoStretch: false,
            maxSpeed,
            rate: segOwnInfo.valid ? segOwnInfo.rate : undefined,
            speed: segOwnRaw !== undefined ? segOwnRaw : (segHasUserFlag ? 1.0 : seg.speed),
            userCustomSpeed: true,
            _suppressInvalidSpeedLog: true,
            sharedAudioPaths,
          };
        } else if (batchExplicitUserSpeed || (batchSpeedInfo.provided && !batchSpeedInfo.valid)) {
          perSegOptions = {
            ...options,
            autoStretch: batchExplicitUserSpeed ? false : autoStretch,
            maxSpeed,
            rate: batchSpeedInfo.valid ? batchSpeedInfo.rate : undefined,
            speed: batchSpeedRaw,
            userCustomSpeed: batchExplicitUserSpeed,
            _suppressInvalidSpeedLog: batchSpeedInfo.provided && !batchSpeedInfo.valid,
            sharedAudioPaths,
          };
        } else {
          perSegOptions = {
            ...options,
            autoStretch,
            maxSpeed,
            rate: "+0%",
            speed: segOwnRaw !== undefined ? segOwnRaw : "normal",
            userCustomSpeed: false,
            sharedAudioPaths,
          };
        }

        results[idx] = await generateFn(seg, uploadsDir, perSegOptions);
        jobState.completed++;
        if (results[idx]?.audioFileName) {
          jobState.lastFile = results[idx].audioFileName;
        }

        const wasNewlySynth = Boolean(results[idx]?._wasNewlySynthesized);
        if (wasNewlySynth) {
          consecutiveSuccesses++;
          consecutiveErrors = 0;
          if (consecutiveSuccesses >= 5 && activeConcurrency < baseConcurrency) {
            activeConcurrency = baseConcurrency;
          }
          // Small pacing delay between network Edge TTS requests to avoid bursting WebSocket
          const pacingDelay = consecutiveErrors > 0 ? 250 : 35;
          await new Promise((resolve) => setTimeout(resolve, pacingDelay));
        }

        const completedCount = jobState.completed;
        const pct = Math.round((completedCount / segments.length) * 100);
        console.log(`[TTSService] 🎙️ [${completedCount}/${segments.length}] (${pct}%) Seg #${seg.id || idx + 1}: "${cleanedTextToSpeak.substring(0, 30)}..." [${results[idx]?.voiceId || 'Neural'}, rate=${perSegOptions.rate || '+0%'}, fit=${perSegOptions.autoStretch}${wasNewlySynth ? '' : ' (cached)'}]`);
      } catch (err) {
        consecutiveErrors++;
        consecutiveSuccesses = 0;
        // Adaptive backoff on network/server errors (e.g. 429)
        if (consecutiveErrors >= 2 && activeConcurrency > 2) {
          console.warn(`[TTSService] ⚠️ Network pressure detected (${consecutiveErrors} consecutive errors) — backing off concurrency to 2`);
          activeConcurrency = 2;
        }

        const isEmptyErr = err.message && (err.message.includes("Empty text") || err.message.includes("ទទេ"));
        if (isEmptyErr) {
          console.warn(`[TTSService] ⚠️ រំលងឃ្លា #${seg.id || idx + 1} (គ្មានអត្ថបទខ្មែរ)`);
          jobState.skippedEmpty++;
        } else {
          console.error(`[TTSService] ❌ បរាជ័យឃ្លា #${seg.id || idx + 1}:`, err.message);
          jobState.failed++;
          // Brief pause after error before next attempt
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        jobState.completed++;
        results[idx] = {
          ...seg,
          audioUrl: null,
          audioPath: null,
          audioFile: null,
          audioGenerated: false,
          audioDuration: 0,
          audioDurationSec: 0,
          ttsStatus: isEmptyErr ? "empty_text" : "error",
          status: isEmptyErr ? "empty_text" : "tts_error",
          error: isEmptyErr ? null : err.message,
          _wasNewlySynthesized: false,
          _failed: !isEmptyErr,
        };
      }
    }
  }

  try {
    const workerCount = Math.min(baseConcurrency, pendingIndices.length);
    if (workerCount > 0) {
      const workers = Array.from({ length: workerCount }, (_, i) => worker(i));
      await Promise.all(workers);
    }
  } finally {
    activeTtsJobs.delete(jobKey);
  }

  const succeededCount = results.filter((r) => r && r.audioUrl).length;
  const failedCount = results.filter((r) => r && r.error).length;
  const newlySynthesizedCount = results.filter((r) => r && r._wasNewlySynthesized).length;
  const reusedCount = results.filter((r) => r && r.audioGenerated && !r._wasNewlySynthesized).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  results.telemetry = {
    totalDurationMs: Date.now() - startTime,
    totalSegments: segments.length,
    pendingSegments: pendingIndices.length,
    succeededCount,
    failedCount,
    newlySynthesizedCount,
    reusedCount,
    skippedEmptyCount: jobState.skippedEmpty,
    activeConcurrency: baseConcurrency,
  };

  console.log(
    `[TTSService] ✅ បង្កើតសំឡេងទាំង ${segments.length} ឃ្លារួចរាល់ក្នុង ${elapsed}s (បង្កើតថ្មី: ${newlySynthesizedCount}, ប្រើឡើងវិញ: ${reusedCount}, ជោគជ័យ: ${succeededCount}, បរាជ័យ: ${failedCount})!`
  );

  return results;
}

/**
 * 5. បង្កើតសំឡេងខ្លីសម្រាប់ Preview Voice
 */
async function generateVoicePreview(voiceId = "km-KH-PisethNeural", customText = "", uploadsDir) {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const resolvedVoice = resolveKhmerVoice(voiceId);
  const sampleText =
    customText ||
    (resolvedVoice.includes("Sreymom")
      ? "សួស្តី! នាងខ្ញុំឈ្មោះស្រីមុំ ជាសំឡេងបញ្ចូលកុនភាគខ្មែរដោយស្វ័យប្រវត្តិ។"
      : "សួស្តី! ខ្ញុំបាទឈ្មោះពិសិដ្ឋ ជាសំឡេងសម្រាយរឿង និងបញ្ចូលសំឡេងកុនភាគខ្មែរ។");

  const previewFileName = `preview_${resolvedVoice}.mp3`;
  const previewPath = path.join(uploadsDir, previewFileName);

  if (!fs.existsSync(previewPath) || customText) {
    if (resolvedVoice === "google-km-standard") {
      await synthesizeWithGoogleFallback(sampleText, previewPath);
    } else {
      await synthesizeWithEdgeNeural(sampleText, resolvedVoice, previewPath);
    }
  }

  return {
    voiceId: resolvedVoice,
    audioUrl: `/uploads/${previewFileName}`,
    audioPath: previewPath,
  };
}

/**
 * Backward compatibility aliases
 */
async function generateSingleSegmentSpeech(segment, outputDir, options = {}) {
  return await generateSingleSegmentAudio(segment, outputDir, options);
}

module.exports = {
  SUPPORTED_VOICES,
  getSupportedVoices,
  validateVoiceId,
  resolveKhmerVoice,
  cleanTextForTts,
  isPlaceholderOrEmptyTtsText,
  speedToEdgeRate,
  resolveSegmentSpeed,
  isTransientTtsError,
  pickAttemptRetryError,
  sleepWithJitter,
  validateTtsAudioFile,
  computeSegmentAudioSignature,
  computeMasterAudioSignature,
  atomicCommitFile,
  cleanupTempFile,
  synthesizeWithEdgeNeural,
  synthesizeWithGoogleFallback,
  generateSingleSegmentAudio,
  generateBatchSegmentsAudio,
  getTtsJobProgress,
  resolvePriorSegmentAudioPath,
  cancelTtsJob,
  generateVoicePreview,
  generateSingleSegmentSpeech,
};