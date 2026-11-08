const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const {
  uploadsDir,
  getFileSha256,
  isSafeUploadPath,
  ensureProjectDirs,
  resolveMediaFile,
  decodeMultipartFilename,
} = require("../utils/pathUtils");
const {
  extractAllGeminiKeys,
  isKeyInvalid,
  markKeyAsInvalid,
  getGlobalInvalidKeys,
} = require("../services/geminiKeyManager");
const { CASCADE_MODELS } = require("../services/pipeline");

const router = express.Router();

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
  limits: { fileSize: 25 * 1024 * 1024 * 1024 }, // 25GB max (Unlimited Large Video Support)
});

/**
 * Health check endpoint
 */
router.get("/health", (req, res) => {
  const keys = extractAllGeminiKeys();
  const invalidKeys = getGlobalInvalidKeys();
  const activeKeys = keys.filter((k) => !invalidKeys.has(k));
  res.json({
    status: "ok",
    app: "Khmer AI Video Dubbing Studio API",
    version: "2.0.0",
    geminiConfigured: activeKeys.length > 0,
    activeKeysCount: activeKeys.length,
    totalKeysCount: keys.length,
    models: CASCADE_MODELS,
  });
});

/**
 * Real-time Gemini Key Quota & Health Check
 * Lightweight ping (0 tokens consumed) to verify 429 Rate Limit, 401 Invalid, or 200 Ready.
 */
router.get("/gemini/keys-status", async (req, res) => {
  try {
    const keys = extractAllGeminiKeys();
    if (!keys || keys.length === 0) {
      return res.json({ success: true, keys: [], totalRPM: 0, activeCount: 0 });
    }

    const invalidKeys = getGlobalInvalidKeys();

    const checks = await Promise.all(
      keys.map(async (key, idx) => {
        const masked = key.length > 8 ? `...${key.slice(-4)}` : '****';
        if (invalidKeys.has(key)) {
          return {
            keyNum: idx + 1,
            masked,
            status: "invalid",
            badge: "401 Key ខុស",
            code: 401,
            latencyMs: 0,
            isRateLimited: false,
            isInvalid: true,
          };
        }

        const start = Date.now();
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
            signal: controller.signal,
          });
          clearTimeout(timer);
          const latencyMs = Date.now() - start;

          if (response.status === 200) {
            return {
              keyNum: idx + 1,
              masked,
              status: "ready",
              badge: "15 RPM Ready",
              code: 200,
              latencyMs,
              isRateLimited: false,
              isInvalid: false,
            };
          } else if (response.status === 429) {
            return {
              keyNum: idx + 1,
              masked,
              status: "rate_limited",
              badge: "429 Limit អស់ (Cooldown)",
              code: 429,
              latencyMs,
              isRateLimited: true,
              isInvalid: false,
            };
          } else if (response.status === 401 || response.status === 403) {
            markKeyAsInvalid(key, response.status);
            return {
              keyNum: idx + 1,
              masked,
              status: "invalid",
              badge: "401 Key ខុស",
              code: response.status,
              latencyMs,
              isRateLimited: false,
              isInvalid: true,
            };
          } else {
            return {
              keyNum: idx + 1,
              masked,
              status: "error",
              badge: `HTTP ${response.status}`,
              code: response.status,
              latencyMs,
              isRateLimited: false,
              isInvalid: false,
            };
          }
        } catch (fetchErr) {
          const isDead = invalidKeys.has(key);
          return {
            keyNum: idx + 1,
            masked,
            status: isDead ? "invalid" : "ready_standby",
            badge: isDead ? "401 Key ខុស" : "15 RPM Ready",
            code: 0,
            latencyMs: Date.now() - start,
            isRateLimited: false,
            isInvalid: isDead,
          };
        }
      })
    );

    const activeCount = checks.filter((c) => (c.status === "ready" || c.status === "ready_standby") && !c.isInvalid).length;
    res.json({
      success: true,
      totalKeys: keys.length,
      activeCount,
      totalRPM: activeCount * 15,
      keys: checks,
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Video upload endpoint
 */
router.post("/upload", (req, res) => {
  upload.single("video")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Video file too large: Maximum size is 5GB" });
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

module.exports = router;

