const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const crypto = require("crypto");
const { autoStretchTtsAudio, getMediaDuration, applyInnerThoughtAudioEffect } = require("./ffmpegService");
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
 * សម្អាតអត្ថបទខ្មែរមុនពេលបញ្ជូនទៅ TTS
 */
function cleanTextForTts(text = "") {
  return String(text)
    .normalize("NFC")
    .replace(/[*_~`#<>[\]{}|\\]/g, " ")
    .replace(/^[\s\-–—….:,;!?«»"“”'()]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

const { EdgeTTS } = require("node-edge-tts");

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

    // Layer 1: node-edge-tts (លឿន និងមានស្ថេរភាពខ្ពស់បំផុត)
    try {
      const tts = new EdgeTTS({ voice: voiceId });
      await tts.ttsPromise(cleanText, tempPath);
      await validateTtsAudioFile(tempPath);
      atomicCommitFile(tempPath, outputPath);
      succeeded = true;
      return outputPath;
    } catch (err1) {
      cleanupTempFile(tempPath);
      lastError = err1;
      console.warn(`[TTSService] ⚠️ node-edge-tts warning (${err1.message}), attempt ${attempt + 1}/${maxRetries + 1}...`);
    }

    // Layer 2: msedge-tts stream
    if (!succeeded) {
      try {
        const tts = new MsEdgeTTS();
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
        lastError = err2;
        console.warn(`[TTSService] ⚠️ msedge-tts warning (${err2.message}), attempt ${attempt + 1}/${maxRetries + 1}...`);
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
          const proc = spawn("edge-tts", args);
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
        lastError = err3;
        console.warn(`[TTSService] ⚠️ edge-tts CLI warning (${err3.message}), attempt ${attempt + 1}/${maxRetries + 1}...`);
      }
    }

    // Check if error is transient and eligible for backoff retry
    if (attempt < maxRetries) {
      if (isTransientTtsError(lastError)) {
        console.warn(`[TTSService] ⏳ Transient error detected (${lastError.message}). Retrying with jittered exponential backoff...`);
        await sleepWithJitter(attempt);
        continue;
      } else {
        console.warn(`[TTSService] 🛑 Non-transient error detected (${lastError.message}). Skipping further Edge TTS retries.`);
        break;
      }
    }
  }

  // Layer 4: Fallback ទៅកាន់ Google Translate TTS
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

/**
 * 3. បង្កើតសំឡេងសម្រាប់ឃ្លាមួយ (Single Segment) រួមជាមួយ Auto Time-Stretch (atempo)
 */
async function generateSingleSegmentAudio(segment, uploadsDir, options = {}) {
  const { autoStretch = true, maxSpeed = 1.35, rate = "+0%", pitch = "+0Hz" } = options;

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const rawText = segment.khmer || segment.khmerText || segment.khmerTranslatedText || segment.text || "";
  const textToSpeak = cleanTextForTts(rawText);
  if (!textToSpeak) {
    throw new Error("អត្ថបទសម្រាប់បង្កើតសំឡេងទទេ (Empty text)!");
  }
  const registryVoice = (options.speakerRegistry && segment.speakerId && options.speakerRegistry[segment.speakerId]?.voiceId) ||
    (segment.speakerRegistry && segment.speakerId && segment.speakerRegistry[segment.speakerId]?.voiceId);
  const rawAssignedVoice = (segment.userOverridden && segment.voiceId)
    ? segment.voiceId
    : (registryVoice || options.voiceId || segment.khmerVoiceId || segment.voice || segment.voiceId);
  const segGender = segment.voiceGender || segment.gender || segment.speakerGender || (options.speakerRegistry && segment.speakerId && options.speakerRegistry[segment.speakerId]?.gender) || detectSpeakerGender(segment.speaker, segment.gender, textToSpeak);
  const voiceId = resolveKhmerVoice(options.forceVoice ? options.voiceId : rawAssignedVoice, segGender);

  const cleanId = String(segment.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "_");
  const epPrefix = options.episodeId ? `ep_${String(options.episodeId).replace(/[^a-zA-Z0-9_-]/g, "_")}_` : (segment.episodeId ? `ep_${String(segment.episodeId).replace(/[^a-zA-Z0-9_-]/g, "_")}_` : "");

  // Inner-Thought & Audio Effect Metadata
  const deliveryType = options.deliveryType || segment.deliveryType || "out_loud";
  const isThought = deliveryType === "inner_thought";
  const audioEffect = options.audioEffect || segment.audioEffect || (isThought ? "inner_thought_reverb" : "none");
  const effectConfig = options.effectConfig || segment.effectConfig || { inGain: 0.85, outGain: 0.75, delays: "40|90", decays: "0.3|0.15" };
  const deliveryOverride = Boolean(options.deliveryOverride !== undefined ? options.deliveryOverride : segment.deliveryOverride);

  // Compute exact cache key incorporating text, voiceId, deliveryType, effect settings, and rate
  const effectKey = isThought ? `${audioEffect}_${effectConfig.delays || "40|90"}_${effectConfig.decays || "0.3|0.15"}` : "clean";
  const cacheKey = `${textToSpeak}__${voiceId}__${deliveryType}__${effectKey}__${rate}`;
  const cacheHash = crypto.createHash("md5").update(cacheKey).digest("hex").substring(0, 8);
  const typeTag = isThought ? "thought" : "voice";
  const fileName = `${epPrefix}seg_${cleanId}_${voiceId}_${typeTag}_${cacheHash}.mp3`;
  const outputPath = path.join(uploadsDir, fileName);

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
  let appliedSpeed = 1.0;
  let usedCache = false;
  let rawFilePath = segment.rawAudioPath && fs.existsSync(segment.rawAudioPath) ? segment.rawAudioPath : null;
  let rawFileName = rawFilePath ? path.basename(rawFilePath) : null;

  // 1. Check if an exact cached version of this audio already exists and is valid
  if (!options.forceRegen && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 200) {
    try {
      const cachedDur = await getMediaDuration(outputPath);
      if (cachedDur && cachedDur > 0) {
        finalDuration = cachedDur;
        originalDuration = cachedDur;
        usedCache = true;
        console.log(`[TTSService] ⚡ Reusing verified cached audio for segment #${segment.id || 'N/A'} (${deliveryType}): ${fileName}`);
      }
    } catch (_) { }
  }

  // 2. If not cached, synthesize and apply appropriate effect
  if (!usedCache) {
    if (isThought) {
      // Step A: Ensure valid clean speech base exists
      const rawHash = crypto.createHash("md5").update(`${textToSpeak}__${voiceId}__raw__${rate}`).digest("hex").substring(0, 8);
      rawFileName = `${epPrefix}seg_${cleanId}_${voiceId}_raw_${rawHash}.mp3`;
      rawFilePath = path.join(uploadsDir, rawFileName);

      if (!fs.existsSync(rawFilePath) || fs.statSync(rawFilePath).size < 200) {
        try {
          if (voiceId === "google-km-standard") {
            await synthesizeWithGoogleFallback(textToSpeak, rawFilePath);
          } else {
            await synthesizeWithEdgeNeural(textToSpeak, voiceId, rawFilePath, rate, pitch);
          }
        } catch (edgeErr) {
          console.warn(`[TTSService] ⚠️ Edge TTS failed for raw thought base #${segment.id}, using Google TTS: ${edgeErr.message}`);
          await synthesizeWithGoogleFallback(textToSpeak, rawFilePath);
        }

        if (autoStretch && fs.existsSync(rawFilePath)) {
          try {
            await autoStretchTtsAudio({
              inputAudioPath: rawFilePath,
              targetDuration: targetDuration,
              maxSpeed: maxSpeed,
              minSpeed: 0.90,
              leadInCushionSec: 0.040,
              leadOutCushionSec: 0.060,
              microFadeMs: 8,
            });
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
      // Normal spoken dialogue
      try {
        if (voiceId === "google-km-standard") {
          await synthesizeWithGoogleFallback(textToSpeak, outputPath);
        } else {
          await synthesizeWithEdgeNeural(textToSpeak, voiceId, outputPath, rate, pitch);
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

      const probed = await getMediaDuration(outputPath);
      originalDuration = probed || targetDuration;
      finalDuration = originalDuration;
      const actualDuration = originalDuration;

      if (autoStretch && fs.existsSync(outputPath)) {
        // Dubbing Policy:
        // availableSlotDuration is the reference boundary for avoiding collision with subsequent dialogue.
        // If the speech is only slightly longer than the slot (<= 30%), a gentle speed adjustment (up to 1.25x) fits naturally.
        // But if dialogue is significantly longer than an artificially short visual slot (e.g. 4s sentence in 1.35s slot),
        // NEVER artificially crush or chipmunk the speech: keep full natural delivery (subsequent dialogue safely alternates to Track A2).
        const MIN_COLLISION_SAFETY_MARGIN_SEC = 0.100;
        const safeSlotTarget = Math.max(0.20, parseFloat((availableSlotDuration - MIN_COLLISION_SAFETY_MARGIN_SEC).toFixed(3)));

        const ratio = actualDuration / safeSlotTarget;
        const shouldStretch = ratio > 1.02 && ratio <= 1.30;
        const targetSpeed = Math.min(maxSpeed || 1.25, ratio);

        if (shouldStretch) {
          try {
            const stretchResult = await autoStretchTtsAudio({
              inputAudioPath: outputPath,
              targetDuration: safeSlotTarget,
              maxSpeed: targetSpeed,
              minSpeed: 1.0,
              leadInCushionSec: 0.040,
              leadOutCushionSec: 0.060,
              microFadeMs: 8,
              allowSlowdown: false,
            });
            finalDuration = stretchResult.finalDuration;
            originalDuration = stretchResult.originalDuration;
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
              leadInCushionSec: 0.040,
              leadOutCushionSec: 0.060,
              microFadeMs: 8,
              allowSlowdown: true,
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
      }

      rawFilePath = outputPath;
      rawFileName = fileName;
    }

    // Verify final output audio
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 200) {
      throw new Error(`Audio generation failed to produce valid audio file for segment #${segment.id || 'unknown'}`);
    }
  }

  // Preserve prior audio file until new file has succeeded; never delete raw base audio or active files
  const priorAudioPath = segment.audioPath || (segment.audioFile ? path.join(uploadsDir, segment.audioFile) : null);
  if (priorAudioPath && fs.existsSync(priorAudioPath) && priorAudioPath !== outputPath && priorAudioPath !== rawFilePath) {
    try {
      const baseName = path.basename(priorAudioPath);
      if (baseName.startsWith("seg_") && !baseName.includes(cacheHash) && !baseName.includes("_raw_")) {
        fs.unlinkSync(priorAudioPath);
      }
    } catch (_) { }
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
    effect: audioEffect,
    audioUrl: calculatedAudioUrl,
  });

  const incomingGender = segment.voiceGender || segment.gender;
  const isUnknown = incomingGender === "unknown" || incomingGender === "UNKNOWN";
  const resolvedGender = isUnknown ? "unknown" : (isFemale ? "female" : "male");
  const finalConfidence = isUnknown
    ? (typeof segment.genderConfidence === "number" ? segment.genderConfidence : null)
    : (typeof segment.genderConfidence === "number" ? segment.genderConfidence : 1.0);
  const resolvedKhmer = segment.khmer || segment.khmerText || segment.khmerTranslatedText || textToSpeak;

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
    sourceSpeechDuration: sourceSpeechDuration,
    availableSlotDuration: availableSlotDuration,
    finalAudioDuration: finalDuration,
    audioDuration: finalDuration,
    audioDurationSec: finalDuration,
    audioStartSec: startSec,
    audioEndSec: parseFloat((startSec + finalDuration).toFixed(2)),
    appliedSpeed: appliedSpeed,
    safetyMarginSec: parseFloat((availableSlotDuration - finalDuration).toFixed(3)),
    overlapPreventionStatus: (availableSlotDuration - finalDuration) >= 0.080 ? "SAFE" : ((availableSlotDuration - finalDuration) >= 0 ? "MARGIN_WARNING" : "COLLISION"),
    overlapRisk: (availableSlotDuration - finalDuration) >= 0.080 ? "SAFE" : "HIGH",
    lipSyncOffsetSec: parseFloat((finalDuration - sourceSpeechDuration).toFixed(3)),
    lipSyncStatus: Math.abs(finalDuration - sourceSpeechDuration) <= 0.150 ? "EXACT_MATCH" : (Math.abs(finalDuration - sourceSpeechDuration) <= 0.500 ? "ACCEPTABLE_PACING" : "LIP_SYNC_MISMATCH"),
    syncWarning: (availableSlotDuration - finalDuration) < 0 ? "exceeds_slot_at_max_tempo" : ((availableSlotDuration - finalDuration) < 0.080 ? "safety_margin_under_80ms" : null),
    overflowSec: finalDuration > availableSlotDuration ? parseFloat((finalDuration - availableSlotDuration).toFixed(3)) : 0,
    audioOutdated: false,
    ttsStatus: "ready",
    status: "audio_ready",
  };
}

const activeTtsJobs = new Map();

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
  const concurrency = Math.max(1, Math.min(10, Number(options.concurrency || 3)));
  const { autoStretch = true, maxSpeed = 1.35 } = options;
  const results = new Array(segments.length);
  let currentIndex = 0;

  const jobKey = options.jobKey || (options.episodeId ? `${options.seriesId || ''}:${options.episodeId}` : 'default');
  const jobState = { aborted: false };
  activeTtsJobs.set(jobKey, jobState);

  console.log(
    `[TTSService] 🎙️ ចាប់ផ្តើមបង្កើតសំឡេងខ្មែរចំនួន ${segments.length} ឃ្លា (Concurrency: ${concurrency}, Job: ${jobKey})...`
  );
  const startTime = Date.now();

  async function worker() {
    while (currentIndex < segments.length) {
      if (jobState.aborted || options.signal?.aborted) {
        console.log(`[TTSService] 🛑 TTS Generation stopped/killed for ${jobKey}`);
        break;
      }
      const idx = currentIndex++;
      const seg = segments[idx];

      const text = seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || "";
      if (!text || !String(text).trim()) {
        results[idx] = {
          ...seg,
          audioUrl: null,
          audioPath: null,
          audioFile: null,
          audioGenerated: false,
          audioDuration: 0,
          audioDurationSec: 0,
          ttsStatus: "empty_text",
        };
        continue;
      }

      if (idx > 0) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      try {
        const generateFn = options.generateSingleFn || generateSingleSegmentAudio;
        results[idx] = await generateFn(seg, uploadsDir, {
          autoStretch,
          maxSpeed,
          ...options,
        });
        const completedCount = results.filter(Boolean).length;
        const pct = Math.round((completedCount / segments.length) * 100);
        console.log(`[TTSService] 🎙️ [${completedCount}/${segments.length}] (${pct}%) Seg #${seg.id || idx + 1}: "${text.substring(0, 30)}..." [${results[idx]?.voiceId || 'Neural'}]`);
      } catch (err) {
        console.error(`[TTSService] ❌ បរាជ័យឃ្លា #${seg.id || idx + 1}:`, err.message);
        results[idx] = {
          ...seg,
          audioUrl: null,
          audioPath: null,
          audioFile: null,
          audioGenerated: false,
          ttsStatus: "error",
          status: "tts_error",
          error: err.message,
        };
      }
    }
  }

  try {
    const workers = Array.from(
      { length: Math.min(concurrency, segments.length) },
      () => worker()
    );
    await Promise.all(workers);
  } finally {
    activeTtsJobs.delete(jobKey);
  }

  const succeededCount = results.filter((r) => r && r.audioUrl).length;
  const failedCount = results.filter((r) => r && r.error).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[TTSService] ✅ បង្កើតសំឡេងទាំង ${segments.length} ឃ្លារួចរាល់ក្នុង ${elapsed}s (ជោគជ័យ: ${succeededCount}, បរាជ័យ: ${failedCount})!`
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
async function generateKhmerSpeech(text, outputPath, voiceId = "km-KH-PisethNeural") {
  const resolvedVoice = resolveKhmerVoice(voiceId);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    if (resolvedVoice === "google-km-standard") {
      await synthesizeWithGoogleFallback(text, outputPath);
    } else {
      await synthesizeWithEdgeNeural(text, resolvedVoice, outputPath);
    }
  } catch (err) {
    await synthesizeWithGoogleFallback(text, outputPath);
  }

  const stat = fs.statSync(outputPath);
  return {
    outputPath,
    size: stat.size,
    voiceId: resolvedVoice,
  };
}

async function generateSingleSegmentSpeech(segment, outputDir, options = {}) {
  return await generateSingleSegmentAudio(segment, outputDir, options);
}

async function generateBatchSpeech(segments, outputDir, options = {}) {
  return await generateBatchSegmentsAudio(segments, outputDir, options);
}

module.exports = {
  SUPPORTED_VOICES,
  getSupportedVoices,
  validateVoiceId,
  resolveKhmerVoice,
  cleanTextForTts,
  isTransientTtsError,
  sleepWithJitter,
  validateTtsAudioFile,
  atomicCommitFile,
  cleanupTempFile,
  synthesizeWithEdgeNeural,
  synthesizeWithGoogleFallback,
  generateSingleSegmentAudio,
  generateBatchSegmentsAudio,
  cancelTtsJob,
  generateVoicePreview,
  generateKhmerSpeech,
  generateSingleSegmentSpeech,
  generateBatchSpeech,
};