require("dotenv").config();
const dns = require("dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

// Global process crash prevention handlers
process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL] Unhandled Rejection at:", promise, "reason:", reason);
});

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

function getFileSha256(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(fileBuffer).digest("hex");
  } catch {
    return null;
  }
}

const {
  generateStorytellingScript,
} = require("./services/geminiService");

const {
  runDubbingPipeline,
  CASCADE_MODELS,
  createJob,
  getJob,
  getAllJobs,
  updateJob,
  cancelJob,
  pauseJob,
  resumeJob,
  retryJob,
} = require("./services/pipeline");
const { productionJobQueue } = require("./services/pipeline/productionJobQueue");

const {
  SUPPORTED_VOICES,
  getSupportedVoices,
  validateVoiceId,
  generateSingleSegmentAudio,
  generateBatchSegmentsAudio,
  generateVoicePreview,
  generateSingleSegmentSpeech,
  generateBatchSpeech,
} = require("./services/ttsService");

const { detectSpeakerGender } = require("./models/speakerRegistry");

const {
  extractAudio,
  generateSrtFile,
  generateKhmerAssSubtitleFile,
  buildAssSubtitleVideoFilter,
  renderDubbedVideoWithDucking,
  renderDubbedVideo,
  createSynchronizedNarrationAudio,
  splitVideoIntoEpisodes,
  parseTimeToSec,
  getVideoMetadata,
} = require("./services/ffmpegService");

const {
  getNextAvailableEpisodeNumber,
  generateUniqueEpisodeId,
  createEpisode,
  sanitizeSeriesEpisodes,
  ensureEpisodeDirectories,
  getSeriesMetadata,
  saveSeriesMetadata,
  createNewEpisode,
  deleteEpisode,
} = require("./services/episodeService");

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS & JSON parsing
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Static uploads serving
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Safely decodes a URI component up to 3 times to unwrap single or double-encoded traversal sequences (%252e%252e -> %2e%2e -> ..)
 */
function safeDecodeURI(uri) {
  if (typeof uri !== "string") return "";
  let prev = uri;
  let decoded = uri;
  for (let i = 0; i < 3; i++) {
    try {
      decoded = decodeURIComponent(prev);
      if (decoded === prev) break;
      prev = decoded;
    } catch (_) {
      break;
    }
  }
  return decoded;
}

/**
 * Validates that candidatePath is strictly contained within baseDir,
 * resolving symlinks and normalizing separators/casing on Windows.
 */
function isSafeUploadPath(candidatePath, baseDir = uploadsDir) {
  if (!candidatePath || typeof candidatePath !== "string") return false;
  if (candidatePath.includes("\0")) return false;

  try {
    const canonicalBase = fs.realpathSync(path.resolve(baseDir));
    let canonicalTarget;
    if (fs.existsSync(candidatePath)) {
      canonicalTarget = fs.realpathSync(path.resolve(candidatePath));
    } else {
      canonicalTarget = path.resolve(candidatePath);
    }

    const normBase = process.platform === "win32" ? canonicalBase.toLowerCase() : canonicalBase;
    const normTarget = process.platform === "win32" ? canonicalTarget.toLowerCase() : canonicalTarget;

    const rel = path.relative(normBase, normTarget);
    // Target must be strictly inside base (not equal to base itself, not escaping with '..', not absolute)
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      return false;
    }

    // Disallow dotfiles / hidden folders anywhere in the relative path (e.g. .env, .git/config)
    const relParts = rel.split(/[\\/]/);
    if (relParts.some((part) => part.startsWith("."))) {
      return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}


// Resilient Media Streamer for /uploads (Prevents HTTP 416 Range Not Satisfiable crashes during live playback & regeneration)
app.get(/^\/uploads\/(.+\.(?:mp3|wav|ogg|m4a|aac|mp4|webm|mov))$/i, (req, res, next) => {
  const rawParam = req.params[0] || "";
  const reqRelPath = safeDecodeURI(rawParam);
  if (!reqRelPath || reqRelPath.includes("\0")) {
    return res.status(400).send("Invalid path");
  }

  // Pre-containment validation: resolve against uploads root
  const directPath = path.resolve(uploadsDir, reqRelPath);
  if (!isSafeUploadPath(directPath, uploadsDir)) {
    return res.status(403).send("Forbidden: Access denied");
  }

  let filePath = directPath;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const resolved = resolveMediaFile(reqRelPath);
    if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      if (!isSafeUploadPath(resolved, uploadsDir)) {
        return res.status(403).send("Forbidden: Access denied");
      }
      filePath = resolved;
    } else {
      return next();
    }
  }

  // Canonical containment check on final file
  if (!isSafeUploadPath(filePath, uploadsDir)) {
    return res.status(403).send("Forbidden: Access denied");
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return next();
  }

  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  res.setHeader("Accept-Ranges", "bytes");

  // If file is 0 bytes (e.g. freshly created)
  if (fileSize === 0) {
    res.writeHead(200, {
      "Content-Length": 0,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    return res.end();
  }

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  if (isNaN(start) || start >= fileSize || start < 0) {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  const clampedEnd = Math.min(isNaN(end) ? fileSize - 1 : end, fileSize - 1);
  const chunksize = (clampedEnd - start) + 1;
  const fileStream = fs.createReadStream(filePath, { start, end: clampedEnd });

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${clampedEnd}/${fileSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunksize,
    "Content-Type": contentType,
  });

  fileStream.pipe(res);
});

app.use("/uploads", express.static(uploadsDir));

// Fallback resolver: if direct path is not found by express.static, search with resolveMediaFile
app.get("/uploads/*", (req, res, next) => {
  const rawParam = req.params[0] || "";
  const reqRelPath = safeDecodeURI(rawParam);
  if (!reqRelPath || reqRelPath.includes("\0")) return next();

  const directPath = path.resolve(uploadsDir, reqRelPath);
  if (!isSafeUploadPath(directPath, uploadsDir)) {
    return res.status(403).send("Forbidden: Access denied");
  }

  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return res.sendFile(directPath);
  }

  const resolved = resolveMediaFile(reqRelPath);
  if (resolved) {
    if (!isSafeUploadPath(resolved, uploadsDir)) {
      return res.status(403).send("Forbidden: Access denied");
    }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return res.sendFile(resolved);
    }
  }
  next();
});

/**
 * Clean & sanitize project / drama name for folder & file paths
 */
function sanitizeProjectName(name) {
  if (!name) return "drama_project";
  let decoded = name;
  try {
    const candidate = Buffer.from(name, "latin1").toString("utf8");
    if (candidate && candidate !== name && !candidate.includes("\uFFFD")) {
      decoded = candidate;
    }
  } catch (_) {}

  const ext = path.extname(decoded).toLowerCase();
  const KNOWN_EXTS = [".mp4", ".mkv", ".avi", ".mov", ".webm", ".ts", ".flv", ".wmv", ".m4v", ".3gp"];
  const base = KNOWN_EXTS.includes(ext) ? path.basename(decoded, ext) : path.basename(decoded);
  const cleaned = base
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[/\\?%*:|"<>~#&!$;^{}`]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
  return cleaned || "drama_project";
}

function sanitizeEpisodeId(id) {
  if (!id) return "ep_1";
  const cleaned = String(id)
    .replace(/[/\\?%*:|"<>~#&!$;^{}`\s]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
  return cleaned || "ep_1";
}

/**
 * Ensure project folder structure exists:
 * For Episodes:
 * uploads/projects/<seriesName>/episodes/<episodeId>/
 *   ├── video/
 *   ├── audio/
 *   └── subtitles/
 * 
 * For Legacy Single Projects:
 * uploads/projects/<projectName>/
 *   ├── video/
 *   ├── audio/
 *   └── subtitles/
 */
function ensureProjectDirs(projectName, episodeId = null, seriesId = null) {
  const cleanSeries = sanitizeProjectName(seriesId || projectName || "drama_project");

  if (episodeId) {
    const cleanEpisode = sanitizeEpisodeId(episodeId);
    const seriesDir = path.join(uploadsDir, "projects", cleanSeries);
    const episodeDir = path.join(seriesDir, "episodes", cleanEpisode);
    const videoDir = path.join(episodeDir, "video");
    const audioDir = path.join(episodeDir, "audio");
    const subDir = path.join(episodeDir, "subtitles");

    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

    return {
      projectDir: episodeDir,
      seriesDir,
      episodeDir,
      videoDir,
      audioDir,
      subDir,
      cleanName: `${cleanSeries}_${cleanEpisode}`,
      cleanSeries,
      cleanEpisode,
      isEpisode: true,
    };
  }

  // Fallback for non-episode single project structure (100% backwards compatible)
  const projectDir = path.join(uploadsDir, "projects", cleanSeries);
  const videoDir = path.join(projectDir, "video");
  const audioDir = path.join(projectDir, "audio");
  const subDir = path.join(projectDir, "subtitles");

  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

  return {
    projectDir,
    seriesDir: projectDir,
    episodeDir: projectDir,
    videoDir,
    audioDir,
    subDir,
    cleanName: cleanSeries,
    cleanSeries,
    cleanEpisode: null,
    isEpisode: false,
  };
}

/**
 * Robust media resolver: finds media files in project subdirectories, episode directories, or uploads root
 */
function resolveMediaFile(filePathOrRel) {
  if (!filePathOrRel) return null;
  const cleanInput = String(filePathOrRel).split("?")[0].split("#")[0];
  if (path.isAbsolute(cleanInput) && fs.existsSync(cleanInput)) {
    return cleanInput;
  }
  const directInUploads = path.join(uploadsDir, cleanInput);
  if (fs.existsSync(directInUploads)) return directInUploads;

  const cleanBase = path.basename(cleanInput);
  const inRoot = path.join(uploadsDir, cleanBase);
  if (fs.existsSync(inRoot)) return inRoot;

  // Search projects directory (including episode subdirectories)
  const projectsDir = path.join(uploadsDir, "projects");
  if (fs.existsSync(projectsDir)) {
    try {
      const items = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const seriesPath = path.join(projectsDir, item.name);
          const directPaths = [
            path.join(seriesPath, "video", cleanBase),
            path.join(seriesPath, "audio", cleanBase),
            path.join(seriesPath, "subtitles", cleanBase),
            path.join(seriesPath, cleanBase),
          ];
          for (const tp of directPaths) {
            if (fs.existsSync(tp)) return tp;
          }

          // Check episodes subdirectories
          const epSubdir = path.join(seriesPath, "episodes");
          if (fs.existsSync(epSubdir)) {
            const epItems = fs.readdirSync(epSubdir, { withFileTypes: true });
            for (const epItem of epItems) {
              if (epItem.isDirectory()) {
                const epPath = path.join(epSubdir, epItem.name);
                const epTestPaths = [
                  path.join(epPath, "video", cleanBase),
                  path.join(epPath, "audio", cleanBase),
                  path.join(epPath, "subtitles", cleanBase),
                  path.join(epPath, cleanBase),
                ];
                for (const etp of epTestPaths) {
                  if (fs.existsSync(etp)) return etp;
                }
              }
            }
          }
        }
      }
    } catch {}
  }
  return directInUploads;
}

// Multer storage and file validation
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".mp4";
    cb(null, `temp_upload_${Date.now()}_${uuidv4().substring(0, 8)}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.mimetype.startsWith("video/") || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type: Please upload a valid video file (.mp4, .mov, .mkv, .webm)"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

/**
 * Health check endpoint
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Khmer AI Video Dubbing Studio API",
    version: "2.0.0",
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    models: CASCADE_MODELS,
  });
});

/**
 * Extract real video stream metadata via FFprobe
 */
app.post("/api/video-metadata", async (req, res) => {
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
 * Safely decodes multipart form filenames that may have been read as Latin-1 by Multer.
 * Checks for valid UTF-8 without corrupting already-valid UTF-8 strings.
 */
function decodeMultipartFilename(name) {
  if (!name || typeof name !== "string") return "";
  try {
    const candidate = Buffer.from(name, "latin1").toString("utf8");
    if (candidate && candidate !== name && !candidate.includes("\uFFFD")) {
      return candidate;
    }
  } catch (_) {}
  return name;
}

/**
 * Video upload endpoint
 */
app.post("/api/upload", (req, res) => {
  upload.single("video")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Video file too large: Maximum size is 500MB" });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    // Preserve exact original Khmer filename and display title
    const rawOriginalName = req.body?.originalFilename || decodeMultipartFilename(req.file.originalname);
    const safeOriginalFilename = rawOriginalName.trim();
    const safeDisplayTitle = (req.body?.displayTitle && typeof req.body.displayTitle === "string" && req.body.displayTitle.trim())
      ? req.body.displayTitle.trim()
      : safeOriginalFilename.replace(/\.[^/.]+$/, "").trim();

    const rawProjectName = req.body?.projectName || req.body?.seriesId || safeOriginalFilename;
    const rawEpisodeId = req.body?.episodeId || null;
    const rawSeriesId = req.body?.seriesId || null;
    const { videoDir, cleanName, cleanSeries, cleanEpisode, isEpisode } = ensureProjectDirs(rawProjectName, rawEpisodeId, rawSeriesId);
    const ext = path.extname(safeOriginalFilename).toLowerCase() || ".mp4";
    const targetFileName = isEpisode ? `${cleanEpisode}_source${ext}` : `${cleanName}_source${ext}`;
    const targetFilePath = path.join(videoDir, targetFileName);

    try {
      if (fs.existsSync(targetFilePath)) {
        fs.unlinkSync(targetFilePath);
      }
      fs.renameSync(req.file.path, targetFilePath);
    } catch {
      fs.copyFileSync(req.file.path, targetFilePath);
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
    }

    const relVideoPath = isEpisode
      ? `projects/${cleanSeries}/episodes/${cleanEpisode}/video/${targetFileName}`
      : `projects/${cleanName}/video/${targetFileName}`;
    const videoUrl = `/uploads/${relVideoPath}`;
    const fileHash = getFileSha256(targetFilePath);
    console.log(`[Upload] Drama Project: ${cleanSeries}${isEpisode ? ` [Episode: ${cleanEpisode}]` : ""}, Title: ${safeDisplayTitle}, File: ${targetFileName}, Size: ${(req.file.size / (1024 * 1024)).toFixed(2)} MB, SHA-256: ${fileHash}`);

    res.json({
      success: true,
      projectName: cleanSeries,
      seriesId: cleanSeries,
      episodeId: cleanEpisode,
      isEpisode,
      videoId: relVideoPath,
      videoPath: targetFilePath,
      videoUrl,
      fileName: safeOriginalFilename,
      originalFilename: safeOriginalFilename,
      displayTitle: safeDisplayTitle,
      storageFilename: targetFileName,
      size: (req.file.size / (1024 * 1024)).toFixed(1) + " MB",
      sizeBytes: req.file.size,
      sha256: fileHash,
    });
  });
});

/**
 * 1. Voices catalog endpoints
 */
app.get("/api/voices", (req, res) => {
  res.json({ success: true, voices: SUPPORTED_VOICES });
});

app.get("/api/tts/voices", (req, res) => {
  res.json({ success: true, ...getSupportedVoices() });
});

/**
 * 2. Generate Script endpoint using @google/genai Multimodal + Proxy 360p
 */
app.post("/api/generate-script", async (req, res) => {
  try {
    const {
      videoPath,
      videoId,
      videoFileName,
      mode = "dialogue",
      recapStyle = "standard",
      customPrompt = "",
      narratorGender = "male",
      genre = "auto",
      inputText = "",
      modelName,
      apiKey,
      requestId,
      projectId,
      seriesId,
      episodeId,
      seriesGlossary,
      jobId,
    } = req.body;

    const keyToUse = apiKey || process.env.GEMINI_API_KEY;
    if (!keyToUse) {
      return res.status(400).json({ success: false, error: "Gemini API Key មិនទាន់បានកំណត់ទេ (Gemini API key is required)" });
    }

    const rawVideoRef = videoPath || (videoFileName ? (path.isAbsolute(videoFileName) ? videoFileName : path.join(uploadsDir, videoFileName)) : null) || videoId;
    const resolvedVideoPath = rawVideoRef ? resolveMediaFile(rawVideoRef) : null;
    let promptText = customPrompt || inputText || "";

    // Requirement 5: Preserve useful context (character names, terminology, series glossary) between episodes
    if (seriesGlossary && typeof seriesGlossary === "object") {
      const glossaryParts = [];
      if (Array.isArray(seriesGlossary.characters) && seriesGlossary.characters.length > 0) {
        const charNames = seriesGlossary.characters
          .map((c) => `${c.name || c.id}${c.khmerName ? ` -> "${c.khmerName}"` : ""}${c.gender ? ` (${c.gender})` : ""}`)
          .join(", ");
        glossaryParts.push(`តួអង្គក្នុងរឿង (Character Names): ${charNames}`);
      }
      if (Array.isArray(seriesGlossary.terms) && seriesGlossary.terms.length > 0) {
        const termsList = seriesGlossary.terms
          .map((t) => `${t.term}${t.khmerTerm ? ` -> "${t.khmerTerm}"` : ""}`)
          .join(", ");
        glossaryParts.push(`ពាក្យបច្ចេកទេស/ឋានៈ (Key Terms): ${termsList}`);
      }
      if (glossaryParts.length > 0) {
        const glossaryNote = `[SERIES GLOSSARY CONSISTENCY (ភាពស៊ីសង្វាក់គ្នានៃឈ្មោះតួអង្គរវាងភាគ)]:\n${glossaryParts.join("\n")}\nសូមរក្សាឈ្មោះតួអង្គ និងពាក្យខាងលើឲ្យស្របតាមភាគមុនជានិច្ច តែត្រូវបកប្រែឈុតឆាក និងការសន្ទនាជាក់ស្តែងនៃភាគនេះ!`;
        promptText = promptText ? `${glossaryNote}\n\n${promptText}` : glossaryNote;
      }
    }

    console.log(`[Server] 🎬 ទទួលសំណើ Generate Script សម្រាប់ File: ${resolvedVideoPath || "(Text Prompt)"}${episodeId ? ` [Episode: ${episodeId}]` : ""}`);

    let result;
    let fileHash = null;

    if (resolvedVideoPath && fs.existsSync(resolvedVideoPath)) {
      fileHash = getFileSha256(resolvedVideoPath);
      console.log(`[GenerateScript] Processing video [Mode: ${mode}, Model: ${modelName || "default"}, SHA-256: ${fileHash}]: ${resolvedVideoPath}`);

      const ext = path.extname(resolvedVideoPath).toLowerCase();
      let mimeType = "video/mp4";
      if ([".mov", ".qt"].includes(ext)) mimeType = "video/quicktime";
      else if ([".webm"].includes(ext)) mimeType = "video/webm";
      else if ([".mkv"].includes(ext)) mimeType = "video/x-matroska";

      const resolvedSeriesSpeakerMap = {};
      if (req.body.seriesSpeakerMap && typeof req.body.seriesSpeakerMap === "object") {
        Object.assign(resolvedSeriesSpeakerMap, req.body.seriesSpeakerMap);
      }
      if (seriesGlossary && typeof seriesGlossary === "object") {
        if (seriesGlossary.seriesSpeakerMap && typeof seriesGlossary.seriesSpeakerMap === "object") {
          Object.assign(resolvedSeriesSpeakerMap, seriesGlossary.seriesSpeakerMap);
        }
        if (Array.isArray(seriesGlossary.characters)) {
          for (const char of seriesGlossary.characters) {
            const key = char.id || char.speakerId || char.name;
            if (key) {
              resolvedSeriesSpeakerMap[key] = {
                speakerId: key,
                speakerName: char.khmerName || char.name || key,
                voiceGender: char.voiceGender || (String(char.gender || "").toLowerCase() === "female" ? "female" : "male"),
                khmerVoiceId: char.khmerVoiceId || (String(char.gender || "").toLowerCase() === "female" ? "km-KH-SreymomNeural" : "km-KH-PisethNeural"),
                voiceAssignmentSource: "series_glossary",
              };
            }
          }
        }
      }

      const cleanTargetSeries = seriesId || "series_default";
      const cleanTargetEpisode = episodeId || "ep_1";

      // Concurrency Guard: Mutual exclusion with background job queue
      if (productionJobQueue.hasActiveJobForEpisode(cleanTargetSeries, cleanTargetEpisode)) {
        const activeJob = productionJobQueue.getActiveJobForEpisode(cleanTargetSeries, cleanTargetEpisode);
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_ACTIVE_JOB',
          error: `មិនអាចដំណើរការ Direct Pipeline បានទេ ព្រោះមាន Job កំពុងដំណើរការ (#${activeJob?.jobId || 'active'}) សម្រាប់ ${cleanTargetSeries}/${cleanTargetEpisode}`,
          existingJobId: activeJob?.jobId,
          status: activeJob?.status,
        });
      }

      // Acquire exclusive episode execution lock for direct pipeline
      productionJobQueue.acquireEpisodeLock(cleanTargetSeries, cleanTargetEpisode, 'direct_pipeline');

      try {
        console.log(`[GenerateScript] 🚀 Running Clean 10-Stage Dubbing Pipeline (Mode: ${mode}, Model: ${modelName || "default"})...`);
        result = await runDubbingPipeline({
          videoPath: resolvedVideoPath,
          mode,
          seriesId: cleanTargetSeries,
          episodeId: cleanTargetEpisode,
          apiKey: keyToUse,
          modelName: modelName || process.env.GEMINI_MODEL,
          customPrompt: promptText,
          narratorGender,
          seriesGlossary,
          genre,
          jobId: jobId || requestId,
        });
      } finally {
        productionJobQueue.releaseEpisodeLock(cleanTargetSeries, cleanTargetEpisode);
      }
    } else if (promptText && promptText.trim()) {
      console.log(`[GenerateScript] Processing text prompt (Mode: ${mode}): ${promptText.slice(0, 50)}...`);
      result = await generateStorytellingScript(promptText.trim(), keyToUse, {
        mode,
        recapStyle,
        customPrompt: promptText,
        narratorGender,
        genre,
        modelName,
      });
    } else {
      console.error(`[Server] ❌ Generate Script Error: File not found for '${rawVideoRef}' and no prompt text provided.`);
      return res.status(400).json({ success: false, error: `រកមិនឃើញ File វីដេអូ (${rawVideoRef || "គ្មាន File"}) ឬផ្តល់អត្ថបទសម្រាប់ដំណើរការ` });
    }

    res.json({
      success: true,
      videoId: rawVideoRef ? path.basename(rawVideoRef) : null,
      requestId: requestId || null,
      projectId: projectId || null,
      seriesId: seriesId || null,
      episodeId: episodeId || null,
      sha256: fileHash,
      ...result,
      data: {
        ...result,
        videoId: rawVideoRef ? path.basename(rawVideoRef) : null,
        requestId: requestId || null,
        seriesId: seriesId || null,
        episodeId: episodeId || null,
        sha256: fileHash,
      },
    });
  } catch (error) {
    const causeMsg = error.cause ? ` (${error.cause.message || error.cause.code || error.cause})` : "";
    let cleanMsg = `${error.message || "Gemini script generation failed"}${causeMsg}`;
    if (cleanMsg.includes("429") || cleanMsg.includes("Quota exceeded") || cleanMsg.includes("RESOURCE_EXHAUSTED")) {
      cleanMsg = "Gemini API Quota Exceeded (429)៖ កូតាសម្រាប់ម៉ូដែលនេះបានអស់ហើយ។ ប្រព័ន្ធបានប្តូរទៅប្រើម៉ូដែល flash-lite ឬសូមរង់ចាំបន្តិច/ប្តូរ Key ថ្មី។";
    } else if (cleanMsg === "fetch failed" || cleanMsg.startsWith("fetch failed")) {
      cleanMsg = `ការតភ្ជាប់ទៅកាន់ Google Gemini AI បរាជ័យ (${error.cause?.message || error.cause?.code || "Network / DNS Connection issue"})។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ឬ Gemini API Key។`;
    }
    console.error("❌ Generate Script Server Error:", cleanMsg);
    res.status(500).json({
      success: false,
      error: cleanMsg,
    });
  }
});

/**
 * 2.5 Background Long-Video Generation Job Endpoints
 */
app.post("/api/jobs/generate", async (req, res) => {
  try {
    const {
      videoPath,
      videoId,
      videoFileName,
      mode = "dialogue",
      customPrompt = "",
      narratorGender = "male",
      genre = "auto",
      seriesId = "series_default",
      episodeId = "ep_1",
      seriesGlossary,
      apiKey,
      modelName,
      chunkSizeSec = 300,
      overlapSec = 2,
    } = req.body;

    const rawVideoRef = videoPath || (videoFileName ? (path.isAbsolute(videoFileName) ? videoFileName : path.join(uploadsDir, videoFileName)) : null) || videoId;
    const resolvedVideoPath = rawVideoRef ? resolveMediaFile(rawVideoRef) : null;

    if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
      return res.status(400).json({ success: false, error: "រកមិនឃើញ File វីដេអូសម្រាប់ដំណើរការ Job ឡើយ" });
    }

    const keyToUse = apiKey || process.env.GEMINI_API_KEY;
    if (!keyToUse) {
      return res.status(400).json({ success: false, error: "Gemini API Key មិនទាន់បានកំណត់ទេ" });
    }

    const { getMediaDuration } = require("./services/ffmpegService");
    const durSec = await getMediaDuration(resolvedVideoPath).catch(() => 0);

    const { jobData, abortSignal } = createJob({
      seriesId,
      episodeId,
      videoPath: resolvedVideoPath,
      mode,
      totalDurationSec: durSec,
      chunkSizeSec,
      overlapSec,
      baseUploadsDir: uploadsDir,
    });

    // Run in background without blocking response
    runDubbingPipeline({
      videoPath: resolvedVideoPath,
      mode,
      seriesId,
      episodeId,
      apiKey: keyToUse,
      modelName: modelName || process.env.GEMINI_MODEL,
      customPrompt,
      narratorGender,
      seriesGlossary,
      genre,
      jobId: jobData.jobId,
      signal: abortSignal,
    }).then((result) => {
      console.log(`[Job ${jobData.jobId}] Pipeline finished successfully.`);
      updateJob(jobData.jobId, {
        status: 'completed',
        progress: 100,
        currentStage: 'completed',
        stageMessage: 'ការបង្កើតបានបញ្ចប់ដោយជោគជ័យ!',
        finalResult: result,
      });
    }).catch((err) => {
      console.error(`[Job ${jobData.jobId}] Background pipeline execution error:`, err.message);
      updateJob(jobData.jobId, {
        status: err.name === 'AbortError' ? 'cancelled' : 'failed',
        error: err.message,
        stageMessage: err.name === 'AbortError' ? 'Job was cancelled' : `បរាជ័យ: ${err.message}`,
      });
    });

    res.json({
      success: true,
      jobId: jobData.jobId,
      status: "running",
      message: "Background generation job started successfully",
      job: jobData,
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_ACTIVE_JOB' || err.httpStatus === 409) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_ACTIVE_JOB',
        error: err.message,
        existingJobId: err.existingJobId,
        status: err.status,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2.6 Production Job Queue & Dashboard Endpoints (Phase 4.4)
 */
app.get("/api/jobs", (req, res) => {
  try {
    const filter = req.query.filter || req.query.status || null;
    const jobs = getAllJobs(filter);
    const stats = productionJobQueue.getQueueSnapshot();
    res.json({
      success: true,
      total: jobs.length,
      jobs,
      stats,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/jobs/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (req.socket && typeof req.socket.setKeepAlive === "function") {
    req.socket.setKeepAlive(true, 10000);
  }

  // Initial event snapshot
  try {
    const jobs = getAllJobs();
    const stats = productionJobQueue.getQueueSnapshot();
    res.write(`event: init\ndata: ${JSON.stringify({ jobs, stats })}\n\n`);
  } catch (err) {
    console.warn("[SSE] Error sending init event:", err.message);
  }

  // Live updates handler
  const onJobChange = (eventPayload) => {
    try {
      const stats = productionJobQueue.getQueueSnapshot();
      res.write(`event: job_update\ndata: ${JSON.stringify({ ...eventPayload, stats })}\n\n`);
    } catch (_) {}
  };

  if (productionJobQueue.events && typeof productionJobQueue.events.on === "function") {
    productionJobQueue.events.on("job_change", onJobChange);
  }

  // 15s keepalive ping
  const keepAliveTimer = setInterval(() => {
    try {
      res.write(":keepalive\n\n");
    } catch (_) {}
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAliveTimer);
    if (productionJobQueue.events && typeof productionJobQueue.events.off === "function") {
      productionJobQueue.events.off("job_change", onJobChange);
    }
  });
});

app.get("/api/jobs/:jobId", (req, res) => {
  const { jobId } = req.params;
  const { seriesId, episodeId } = req.query;
  const job = getJob(jobId, seriesId, episodeId);
  if (!job) {
    return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
  }
  res.json({ success: true, job });
});

app.get("/api/jobs/:jobId/status", (req, res) => {
  const { jobId } = req.params;
  const { seriesId, episodeId } = req.query;
  const job = getJob(jobId, seriesId, episodeId);
  if (!job) {
    return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
  }
  res.json({
    success: true,
    jobId,
    status: job.status,
    progress: job.progress,
    stage: job.currentStage,
    message: job.stageMessage,
    chunks: job.chunks,
    finalResult: job.finalResult,
    error: job.error,
    updatedAt: job.updatedAt,
  });
});

app.post("/api/jobs/:jobId/pause", (req, res) => {
  const { jobId } = req.params;
  try {
    const { pauseJobRenderProcess } = require("./services/ffmpegService");
    pauseJobRenderProcess(jobId);
    const job = pauseJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
    }
    res.json({ success: true, message: `Job #${jobId} paused successfully`, job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/jobs/:jobId/resume", (req, res) => {
  const { jobId } = req.params;
  try {
    const job = resumeJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
    }
    res.json({ success: true, message: `Job #${jobId} resumed successfully`, job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/jobs/:jobId/retry", (req, res) => {
  const { jobId } = req.params;
  try {
    const job = retryJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
    }
    res.json({ success: true, message: `Job #${jobId} retried successfully`, job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/jobs/:jobId/cancel", (req, res) => {
  const { jobId } = req.params;
  const { cancelJobRenderProcess } = require("./services/ffmpegService");
  cancelJobRenderProcess(jobId);
  const job = cancelJob(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: `រកមិនឃើញ Job #${jobId} ឡើយ` });
  }
  res.json({ success: true, message: `Job #${jobId} cancelled successfully`, job });
});

/**
 * 3. Generate Audio endpoint (Single Segment 1-Click Regen OR Batch Segments)
 */
app.post("/api/generate-audio", async (req, res) => {
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
      segment,
      segments,
      voiceId = "km-KH-PisethNeural",
      speed = "normal",
      autoStretch = true,
      maxSpeed = 1.45,
      speakerMap = {},
      projectName,
      videoId,
      forceRegen = false,
      seriesId,
      episodeId,
    } = req.body;

    let extractedSeries = null;
    let extractedEpisode = null;
    const segAudio = segment?.audioPath || segment?.audioUrl;
    if (segAudio && typeof segAudio === "string") {
      const match = segAudio.match(/projects[/\\]([^/\\]+)(?:[/\\]episodes[/\\]([^/\\]+))?/);
      if (match && match[1]) {
        extractedSeries = match[1];
        if (match[2]) extractedEpisode = match[2];
      }
    }
    if (!extractedEpisode && Array.isArray(segments)) {
      for (const seg of segments) {
        const p = seg.audioPath || seg.audioUrl;
        if (p && typeof p === "string") {
          const match = p.match(/projects[/\\]([^/\\]+)(?:[/\\]episodes[/\\]([^/\\]+))?/);
          if (match && match[1]) {
            extractedSeries = match[1];
            if (match[2]) extractedEpisode = match[2];
            break;
          }
        }
      }
    }

    const rawEpisodeId = episodeId || segment?.episodeId || extractedEpisode || null;
    const rawSeriesId = seriesId || segment?.seriesId || extractedSeries || null;
    const rawProjectName = projectName || segment?.projectName || (videoId ? path.basename(videoId, path.extname(videoId)).replace(/_source$/, "") : (extractedSeries || "drama_project"));
    const { audioDir, cleanName, cleanSeries, cleanEpisode, isEpisode } = ensureProjectDirs(rawProjectName, rawEpisodeId, rawSeriesId);

    // ករណីទី 1: Single Segment Regeneration (1-Click Inspector)
    if (segment && typeof segment === "object") {
      const segGender = segment.voiceGender || segment.gender || segment.speakerGender || detectSpeakerGender(segment.speaker, segment.gender, segment.khmer || segment.khmerText);
      const requestedVoice = req.body.voiceId || voiceId;
      const targetVoice = requestedVoice
        ? validateVoiceId(requestedVoice)
        : validateVoiceId(segment.khmerVoiceId || segment.voice || segment.voiceId || (segGender === "female" || segGender === "FEMALE" ? "km-KH-SreymomNeural" : "km-KH-PisethNeural"));
      const isManual = Boolean(req.body.forceVoice || requestedVoice || segment.voiceAssignmentSource === "manual");

      const deliveryType = req.body.deliveryType || segment.deliveryType || "out_loud";
      const audioEffect = req.body.audioEffect || segment.audioEffect || (deliveryType === "inner_thought" ? "inner_thought_reverb" : "none");
      const deliveryOverride = Boolean(req.body.deliveryOverride !== undefined ? req.body.deliveryOverride : segment.deliveryOverride);
      const effectConfig = req.body.effectConfig || segment.effectConfig || null;

      console.log(`[TTS] Regenerating single segment #${segment.id} [${deliveryType}] with voice ${targetVoice}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""}...`);
      const updatedSegment = await generateSingleSegmentAudio(
        {
          ...segment,
          voice: targetVoice,
          voiceId: targetVoice,
          khmerVoiceId: targetVoice,
          gender: targetVoice.includes("Sreymom") ? "female" : (targetVoice.includes("Piseth") ? "male" : (segGender === "female" || segGender === "FEMALE" ? "female" : "male")),
          voiceGender: targetVoice.includes("Sreymom") ? "female" : (targetVoice.includes("Piseth") ? "male" : (segGender === "female" || segGender === "FEMALE" ? "female" : "male")),
          voiceAssignmentSource: isManual ? "manual" : (segment.voiceAssignmentSource || "automatic"),
          deliveryType,
          deliveryOverride,
          audioEffect,
          effectConfig,
          episodeId: cleanEpisode,
        },
        audioDir,
        {
          autoStretch,
          maxSpeed,
          forceVoice: isManual,
          voiceId: targetVoice,
          deliveryType,
          audioEffect,
          deliveryOverride,
          effectConfig,
          forceRegen: Boolean(forceRegen),
          episodeId: cleanEpisode,
        }
      );

      // Optionally re-sync master narration audio for Track A1 if allSegments is passed
      let fullAudioUrl = null;
      if (Array.isArray(req.body.allSegments) && req.body.allSegments.length > 0) {
        try {
          const fullAudioFilename = isEpisode ? `${cleanEpisode}_narration_khmer.mp3` : `${cleanName}_narration_khmer.mp3`;
          const fullAudioPath = path.join(audioDir, fullAudioFilename);
          const syncSegments = req.body.allSegments
            .map((s) => (s.id === updatedSegment.id ? updatedSegment : s))
            .filter((s) => s.audioPath && fs.existsSync(s.audioPath));
          if (syncSegments.length > 0) {
            await createSynchronizedNarrationAudio(syncSegments, fullAudioPath);
            fullAudioUrl = isEpisode
              ? `/uploads/projects/${cleanSeries}/episodes/${cleanEpisode}/audio/${fullAudioFilename}?t=${Date.now()}`
              : `/uploads/projects/${cleanName}/audio/${fullAudioFilename}?t=${Date.now()}`;
          }
        } catch (syncErr) {
          console.warn("[TTS] Could not re-sync master narration on single segment update:", syncErr.message);
        }
      }

      return res.json({
        success: true,
        projectName: cleanSeries,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        segment: updatedSegment,
        fullAudioUrl,
      });
    }

    // ករណីទី 2: Batch Generation សម្រាប់គ្រប់ឃ្លា
    if (Array.isArray(segments) && segments.length > 0) {
      console.log(`[TTS] Batch generating audio for ${segments.length} segments in ${cleanSeries}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""}...`);
      const updatedSegments = await generateBatchSegmentsAudio(segments, audioDir, {
        concurrency: 3,
        autoStretch,
        maxSpeed,
        speakerMap,
        episodeId: cleanEpisode,
      });

      const fullAudioFilename = isEpisode ? `${cleanEpisode}_narration_khmer.mp3` : `${cleanName}_narration_khmer.mp3`;
      const fullAudioPath = path.join(audioDir, fullAudioFilename);

      const syncSegments = updatedSegments
        .filter((s) => s.audioPath && fs.existsSync(s.audioPath))
        .map((s, idx) => ({
          ...s,
          audioPath: s.audioPath,
          startSec: typeof s.audioStartSec === "number" && !isNaN(s.audioStartSec)
            ? s.audioStartSec
            : (typeof s.startSec === "number" && !isNaN(s.startSec)
              ? s.startSec
              : parseTimeToSec(s.start, idx * 4)),
        }));

      if (syncSegments.length > 0) {
        try {
          await createSynchronizedNarrationAudio(syncSegments, fullAudioPath);
        } catch (syncErr) {
          console.warn("[TTS] Could not build master narration audio:", syncErr.message);
        }
      }

      const relAudioUrl = isEpisode
        ? `/uploads/projects/${cleanSeries}/episodes/${cleanEpisode}/audio/${fullAudioFilename}`
        : `/uploads/projects/${cleanName}/audio/${fullAudioFilename}`;
      return res.json({
        success: true,
        projectName: cleanSeries,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        voiceId,
        speed,
        fullAudioUrl: fs.existsSync(fullAudioPath) ? relAudioUrl : null,
        fullAudioPath: fs.existsSync(fullAudioPath) ? fullAudioPath : null,
        segments: updatedSegments,
      });
    }

    res.status(400).json({ success: false, error: "សូមបញ្ជូន segment ឬ segments!" });
  } catch (err) {
    console.error("TTS Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 4. Voice Preview endpoint
 */
app.post(["/api/preview-voice", "/api/tts/preview"], async (req, res) => {
  try {
    const { voiceId = "km-KH-PisethNeural", text = "" } = req.body;
    const preview = await generateVoicePreview(voiceId, text, uploadsDir);
    res.json({ success: true, ...preview });
  } catch (err) {
    console.error("Preview Voice Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. Video Render endpoint (Smart Ducking 85% + ASS Subtitles + Downloads Export)
 */
app.post("/api/render-video", async (req, res) => {
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
    const { videoDir, audioDir, subDir, cleanName, cleanSeries, cleanEpisode, isEpisode } = ensureProjectDirs(rawProjectName, rawEpisodeId, rawSeriesId);

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
    // If rendering an episode, the master narration MUST belong strictly to this episode!
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

    // Determine human-readable export title (Prioritize actual video title / display title)
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
        const candidate1 = path.join(__dirname, "../frontend/public", imgVal.replace(/^\//, ""));
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
 * 6. Fast Timeline Audio Sync
 */
app.post("/api/sync-audio", async (req, res) => {
  try {
    const { segments = [], projectName, videoId, episodeId, seriesId } = req.body;
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: "Segments array is required" });
    }

    let extractedSeries = null;
    let extractedEpisode = null;
    for (const seg of segments) {
      const p = seg.audioPath || seg.audioUrl;
      if (p && typeof p === "string") {
        const match = p.match(/projects[/\\]([^/\\]+)(?:[/\\]episodes[/\\]([^/\\]+))?/);
        if (match && match[1]) {
          extractedSeries = match[1];
          if (match[2]) extractedEpisode = match[2];
          break;
        }
      }
    }

    const rawEpisodeId = episodeId || extractedEpisode || null;
    const rawSeriesId = seriesId || extractedSeries || null;
    const rawProjectName = projectName || (videoId ? path.basename(videoId, path.extname(videoId)).replace(/_source$/, "") : (extractedSeries || "drama_project"));
    const { audioDir, cleanName, cleanSeries, cleanEpisode, isEpisode } = ensureProjectDirs(rawProjectName, rawEpisodeId, rawSeriesId);

    const syncSegs = segments
      .filter((s) => !s.muted && !s.isMuted)
      .map((s, idx) => {
        const foundAudioPath = resolveMediaFile(s.audioFile || s.audioPath || (s.audioUrl ? path.basename(s.audioUrl) : null));
        if (!foundAudioPath || !fs.existsSync(foundAudioPath)) return null;
        const secVal = typeof s.audioStartSec === "number" && !isNaN(s.audioStartSec)
          ? s.audioStartSec
          : (typeof s.startSec === "number" && !isNaN(s.startSec)
            ? s.startSec
            : parseTimeToSec(s.audioStart ?? s.start, idx * 4));
        return {
          ...s,
          audioPath: foundAudioPath,
          audioStartSec: secVal,
          startSec: secVal,
          audioDurationSec: s.audioDurationSec || s.audioDuration || 2.5,
        };
      })
      .filter(Boolean);

    const fullAudioFilename = isEpisode ? `${cleanEpisode}_narration_khmer.mp3` : `${cleanName}_narration_khmer.mp3`;
    const fullAudioPath = path.join(audioDir, fullAudioFilename);

    if (syncSegs.length === 0) {
      if (fs.existsSync(fullAudioPath)) {
        try { fs.unlinkSync(fullAudioPath); } catch (_) {}
      }
      return res.json({
        success: true,
        projectName: cleanSeries,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        fullAudioUrl: null,
        fullAudioPath: null,
      });
    }

    const fingerprint = crypto.createHash("sha256")
      .update(JSON.stringify(syncSegs.map((s) => ({ id: s.id, t: s.audioStartSec, p: s.audioPath }))))
      .digest("hex").slice(0, 16);

    console.log(`[Sync Audio] Re-syncing ${syncSegs.length} audio clips in ${cleanSeries}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""}/audio (Fingerprint: ${fingerprint})...`);
    await createSynchronizedNarrationAudio(syncSegs, fullAudioPath);

    // Save sidecar fingerprint metadata for strict episode isolation
    const metaPath = `${fullAudioPath}.meta.json`;
    try {
      fs.writeFileSync(metaPath, JSON.stringify({
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        isEpisode,
        fingerprint,
        segmentCount: syncSegs.length,
        syncedAt: Date.now(),
      }, null, 2), "utf8");
    } catch (_) {}

    const relAudioUrl = isEpisode
      ? `/uploads/projects/${cleanSeries}/episodes/${cleanEpisode}/audio/${fullAudioFilename}`
      : `/uploads/projects/${cleanName}/audio/${fullAudioFilename}`;
    res.json({
      success: true,
      projectName: cleanSeries,
      seriesId: cleanSeries,
      episodeId: cleanEpisode,
      fullAudioUrl: relAudioUrl,
      fullAudioPath,
      fingerprint,
    });
  } catch (error) {
    console.error("Audio sync error:", error);
    res.status(500).json({ error: error.message || "Failed to re-sync timeline audio" });
  }
});

/**
 * 7. Series & Episode Management Endpoints
 */
app.get("/api/series", (req, res) => {
  try {
    const projectsDir = path.join(uploadsDir, "projects");
    if (!fs.existsSync(projectsDir)) return res.json({ success: true, series: [] });
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const seriesList = [];
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const metaPath = path.join(projectsDir, ent.name, "series.json");
        if (fs.existsSync(metaPath)) {
          try {
            seriesList.push(JSON.parse(fs.readFileSync(metaPath, "utf-8")));
          } catch (_) {}
        }
      }
    }
    res.json({ success: true, series: seriesList });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/series", (req, res) => {
  try {
    const { series } = req.body;
    if (!series || !series.id) return res.status(400).json({ error: "series with id is required" });
    const saved = saveSeriesMetadata(series);
    res.json({ success: true, series: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/series/:seriesId", (req, res) => {
  try {
    const { seriesId } = req.params;
    const series = getSeriesMetadata(seriesId);
    res.json({ success: true, series });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/series/:seriesId/episodes", async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { customTitle, requestedNumber } = req.body || {};
    const newEp = await createNewEpisode(seriesId, { customTitle, requestedNumber });
    res.json({ success: true, episode: newEp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/series/:seriesId/episodes/:episodeId", (req, res) => {
  try {
    const { seriesId, episodeId } = req.params;
    const result = deleteEpisode(seriesId, episodeId);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/series/:seriesId/sync", (req, res) => {
  try {
    const { seriesId } = req.params;
    const { series } = req.body || {};
    if (!series) return res.status(400).json({ error: "series payload required" });
    const saved = saveSeriesMetadata(series);
    res.json({ success: true, series: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 6.5 Auto-Split Long Video (1-2 Hours) into Episodes
 */
app.post("/api/split-video-episodes", async (req, res) => {
  try {
    const { videoPath, videoId, seriesId, durationMinutes = 8 } = req.body;
    const rawVideoRef = videoPath || videoId;
    if (!rawVideoRef) {
      return res.status(400).json({ success: false, error: "videoPath or videoId is required" });
    }

    const inputVideoPath = resolveMediaFile(rawVideoRef);
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return res.status(404).json({ success: false, error: "Source video not found: " + rawVideoRef });
    }

    const targetSeries = seriesId || "drama_project";
    const cleanSeries = sanitizeProjectName(targetSeries);
    const targetDurationSec = Math.max(60, Number(durationMinutes || 8) * 60);

    const tempOutputDir = path.join(uploadsDir, "temp_splits", `split_${Date.now()}`);
    fs.mkdirSync(tempOutputDir, { recursive: true });

    const chunks = await splitVideoIntoEpisodes({
      inputVideoPath,
      targetDurationSec,
      outputDir: tempOutputDir,
      filePrefix: cleanSeries,
    });

    const createdEpisodes = [];
    for (const chunk of chunks) {
      const newEp = await createNewEpisode(cleanSeries, {
        customTitle: `ភាគទី ${chunk.episodeNumber} (EP${chunk.episodeNumber})`,
      });

      const { videoDir } = ensureEpisodeDirectories(cleanSeries, newEp.id);
      const epVideoFilename = `${cleanSeries}_${newEp.id}_source.mp4`;
      const epVideoDestPath = path.join(videoDir, epVideoFilename);

      fs.copyFileSync(chunk.outputPath, epVideoDestPath);
      try { fs.unlinkSync(chunk.outputPath); } catch (_) {}

      newEp.videoFile = `/uploads/projects/${cleanSeries}/episodes/${newEp.id}/video/${epVideoFilename}`;
      newEp.sourceVideoPath = epVideoDestPath;
      newEp.duration = chunk.duration;

      createdEpisodes.push(newEp);
    }

    try { fs.rmdirSync(tempOutputDir); } catch (_) {}

    const updatedSeries = getSeriesMetadata(cleanSeries);
    saveSeriesMetadata(updatedSeries);

    console.log(`[Split Endpoint] ✅ Successfully split video into ${createdEpisodes.length} episodes for "${cleanSeries}"`);
    res.json({
      success: true,
      message: `បានកាត់បំបែកវីដេអូជា ${createdEpisodes.length} ភាគជោគជ័យ!`,
      episodes: createdEpisodes,
      series: updatedSeries,
    });
  } catch (err) {
    console.error("[Split Video Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 7. Download Endpoint
 */
app.get("/api/download-export", (req, res) => {
  try {
    const { file, name } = req.query;
    if (!file) return res.status(400).send("File parameter is required");

    const cleanFile = decodeURIComponent(file).replace(/^\/uploads\//, "");
    const filePath = resolveMediaFile(cleanFile);

    if (!filePath || !fs.existsSync(filePath) || !isSafeUploadPath(filePath, uploadsDir)) {
      return res.status(404).send("File not found or access denied.");
    }

    const downloadName = name ? decodeURIComponent(name) : path.basename(filePath);

    res.download(filePath, downloadName, (err) => {
      if (err && !res.headersSent) {
        console.error("Download stream error:", err);
      }
    });
  } catch (err) {
    console.error("Download export route error:", err);
    res.status(500).send(err.message);
  }
});

// Start Server
let server = null;
if (require.main === module || process.env.NODE_ENV !== "test") {
  // Phase 4.3 Startup Crash Recovery: Scan and recover any dangling/interrupted jobs
  try {
    console.log("[Server Startup] 🔍 Running dangling jobs crash recovery check...");
    const recoveryResult = productionJobQueue.recoverDanglingJobs({
      baseUploadsDir: uploadsDir,
    });
    console.log(
      `[Server Startup] ✅ Crash recovery complete: ${recoveryResult.recoveredCount} recovered to queue, ${recoveryResult.failedCount} marked failed, ${recoveryResult.untouchedCount} untouched (Total: ${recoveryResult.totalScanned}).`
    );
  } catch (recErr) {
    console.warn("[Server Startup] ⚠️ Crash recovery warning:", recErr.message);
  }

  server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Khmer AI Dubbing Backend running on http://localhost:${PORT}`);
  });
  server.requestTimeout = 0;
  server.setTimeout(0);
  server.keepAliveTimeout = 1800000;
  server.headersTimeout = 1800000;
}

module.exports = { app, server, isSafeUploadPath, safeDecodeURI, resolveMediaFile };
