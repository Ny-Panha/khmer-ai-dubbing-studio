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
const { geminiQuotaTracker } = require("../services/geminiQuotaTracker");
const {
  GEMINI_MODEL_CATALOG,
  DUBBING_CASCADE_MODELS,
  isUsableDubbingModel,
} = require("../services/geminiModelCatalog");
const { CASCADE_MODELS } = require("../services/pipeline");
const { DEFAULT_MODELS } = require("../services/geminiService");
const {
  readGlobalLogoSettings,
  writeGlobalLogoSettings,
} = require("../services/globalLogoSettingsService");
const {
  readGlobalOverlaySettings,
  writeGlobalOverlaySettings,
} = require("../services/globalOverlaySettingsService");

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
 * - probe=stats : Instant local usage & cooldown snapshot (0 network calls, 0 tokens)
 * - probe=models (default) : Lightweight key auth check via models.list + local usage/cooldowns (0 tokens)
 * - probe=live : Real 1-token generateContent check per key to detect actual 429 RPM/RPD exhaustion vs 200 Ready
 * - probe=matrix : Live multi-model check across usable cascade models + primary per-key health check
 */
async function probeSingleKeyAndModel(key, modelId, timeoutMs = 8000) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "1" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const rawBody = await response.text().catch(() => "");
    let totalTokens = 1;
    if (response.status === 200) {
      try {
        const parsed = JSON.parse(rawBody);
        totalTokens = Number(parsed?.usageMetadata?.totalTokenCount) || 1;
      } catch (_) {}
    }
    return {
      status: response.status,
      rawBody,
      latencyMs,
      totalTokens,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      status: 0,
      rawBody: err?.message || "Network error",
      latencyMs: Date.now() - start,
      totalTokens: 0,
    };
  }
}

router.get("/gemini/keys-status", async (req, res) => {
  try {
    const keys = extractAllGeminiKeys();
    const probeMode = String(req.query.probe || "models").toLowerCase();
    const includeAllModels = String(req.query.allModels || "").toLowerCase() === "true";
    const invalidKeys = getGlobalInvalidKeys();
    const requestedModel = req.query.model ? String(req.query.model).trim() : "";
    const preferredPrimary = geminiQuotaTracker.getPreferredPrimaryModel(DUBBING_CASCADE_MODELS[0]);
    const primaryProbeModel =
      requestedModel && requestedModel !== "auto" && isUsableDubbingModel(requestedModel)
        ? requestedModel
        : preferredPrimary;

    const probeModels = Array.from(
      new Set([
        primaryProbeModel,
        ...(Array.isArray(DEFAULT_MODELS) ? DEFAULT_MODELS : []),
        ...(Array.isArray(CASCADE_MODELS) ? CASCADE_MODELS : []),
        ...DUBBING_CASCADE_MODELS,
      ])
    );

    if (!keys || keys.length === 0) {
      const emptySnap = geminiQuotaTracker.getPoolStatusSnapshot([], { invalidKeysSet: invalidKeys });
      return res.json({ success: true, probeMode, probedModel: primaryProbeModel, ...emptySnap });
    }

    if (probeMode === "live") {
      const fallbackPair = [primaryProbeModel, ...probeModels.filter((m) => m !== primaryProbeModel)].slice(0, 2);
      await Promise.all(
        keys.map(async (key) => {
          if (invalidKeys.has(key)) {
            geminiQuotaTracker.recordInvalid(key, 401, "Invalid API key");
            return;
          }

          for (const candidateModel of fallbackPair) {
            const probeRes = await probeSingleKeyAndModel(key, candidateModel);
            const { status, rawBody, latencyMs, totalTokens } = probeRes;

            if (status === 200) {
              geminiQuotaTracker.recordSuccess(key, {
                model: candidateModel,
                totalTokens,
                latencyMs,
                statusCode: 200,
                isProbe: true,
                updateKeyCooldown: true,
              });
              return;
            }

            if (status === 404 && candidateModel !== fallbackPair[fallbackPair.length - 1]) {
              geminiQuotaTracker.recordModelProbeStatus(candidateModel, { statusCode: 404, message: rawBody, latencyMs });
              continue;
            }

            if (status === 401 || status === 403) {
              markKeyAsInvalid(key, status);
              geminiQuotaTracker.recordInvalid(key, status, rawBody, {
                latencyMs,
                isProbe: true,
              });
              return;
            }

            if (status === 429) {
              geminiQuotaTracker.recordRateLimit(key, rawBody || "HTTP 429", {
                model: candidateModel,
                latencyMs,
                isProbe: true,
                updateKeyCooldown: true,
              });
              return;
            }

            if (status === 503) {
              geminiQuotaTracker.recordRateLimit(key, rawBody || "HTTP 503", {
                model: candidateModel,
                latencyMs,
                isProbe: true,
                updateKeyCooldown: true,
              });
              geminiQuotaTracker.recordModelProbeStatus(candidateModel, { statusCode: 503, message: rawBody, latencyMs });
              return;
            }

            geminiQuotaTracker.recordModelListProbe(key, {
              statusCode: status,
              latencyMs,
            });
            return;
          }
        })
      );
    } else if (probeMode === "matrix") {
      // 1. First probe primary model across ALL keys so top Key cards accurately reflect active pool health
      const readyPrimaryKeys = [];
      const fallbackValidKeys = [];
      await Promise.all(
        keys.map(async (key) => {
          if (invalidKeys.has(key)) {
            geminiQuotaTracker.recordInvalid(key, 401, "Invalid API key");
            return;
          }
          const probeRes = await probeSingleKeyAndModel(key, primaryProbeModel);
          const { status, rawBody, latencyMs, totalTokens } = probeRes;
          if (status === 200) {
            readyPrimaryKeys.push(key);
            geminiQuotaTracker.recordSuccess(key, {
              model: primaryProbeModel,
              totalTokens,
              latencyMs,
              statusCode: 200,
              isProbe: true,
              updateKeyCooldown: true,
            });
          } else if (status === 401 || status === 403) {
            markKeyAsInvalid(key, status);
            geminiQuotaTracker.recordInvalid(key, status, rawBody, { latencyMs, isProbe: true });
          } else if (status === 429) {
            fallbackValidKeys.push(key);
            geminiQuotaTracker.recordRateLimit(key, rawBody || "HTTP 429", {
              model: primaryProbeModel,
              latencyMs,
              isProbe: true,
              updateKeyCooldown: true,
            });
          } else if (status === 503) {
            fallbackValidKeys.push(key);
            geminiQuotaTracker.recordModelProbeStatus(primaryProbeModel, { statusCode: 503, message: rawBody, latencyMs });
          } else {
            fallbackValidKeys.push(key);
            geminiQuotaTracker.recordModelProbeStatus(primaryProbeModel, { statusCode: status, message: rawBody, latencyMs });
          }
        })
      );

      // Order keys so known healthy keys (e.g. Key #3) are tried first for the rest of the catalog
      const probeKeyOrder = [...readyPrimaryKeys, ...fallbackValidKeys].filter((k) => !invalidKeys.has(k));

      // 2. Test remaining active models across the pool with bounded concurrency (max 3 in-flight)
      const catalogTargets = GEMINI_MODEL_CATALOG
        .filter((entry) => {
          if (entry.id === primaryProbeModel) return false;
          if (entry.deprecated || entry.rpdLimit === 0) return false;
          if (entry.usableInDubbing) return true;
          if (entry.id === "gemini-3.5-transcribe") return true;
          return includeAllModels && entry.usableInApp;
        })
        .map((entry) => entry.id);

      const MATRIX_CONCURRENCY = 3;
      for (let i = 0; i < catalogTargets.length && probeKeyOrder.length > 0; i += MATRIX_CONCURRENCY) {
        const batch = catalogTargets.slice(i, i + MATRIX_CONCURRENCY);
        await Promise.all(
          batch.map(async (modelId, batchOffset) => {
            const startIdx = (i + batchOffset) % probeKeyOrder.length;
            let got200 = false;
            let saw429 = false;
            let sawTimeout = false;
            for (let kStep = 0; kStep < probeKeyOrder.length; kStep++) {
              const candidateKey = probeKeyOrder[(startIdx + kStep) % probeKeyOrder.length];
              if (invalidKeys.has(candidateKey)) continue;

              const probeRes = await probeSingleKeyAndModel(candidateKey, modelId, 12000);
              const { status, rawBody, latencyMs, totalTokens } = probeRes;

              if (status === 200) {
                geminiQuotaTracker.recordSuccess(candidateKey, {
                  model: modelId,
                  totalTokens,
                  latencyMs,
                  statusCode: 200,
                  isProbe: true,
                  updateKeyCooldown: false,
                });
                got200 = true;
                break;
              }
              if (status === 401 || status === 403) {
                markKeyAsInvalid(candidateKey, status);
                geminiQuotaTracker.recordInvalid(candidateKey, status, rawBody, { latencyMs, isProbe: true });
                continue;
              }
              if (status === 429) {
                saw429 = true;
                geminiQuotaTracker.recordRateLimit(candidateKey, rawBody || "HTTP 429", {
                  model: modelId,
                  latencyMs,
                  isProbe: true,
                  updateKeyCooldown: false,
                });
                // Continue trying another key in the pool in case another key has remaining quota
                continue;
              }
              if (status === 0 || status === 504) {
                sawTimeout = true;
                geminiQuotaTracker.recordModelProbeStatus(modelId, {
                  statusCode: 504,
                  message: rawBody || "Request timed out",
                  latencyMs,
                });
                break;
              }
              // 404 / 503 / 500 apply at model endpoint level
              geminiQuotaTracker.recordModelProbeStatus(modelId, {
                statusCode: status,
                message: rawBody,
                latencyMs,
              });
              break;
            }
            if (!got200 && saw429 && !sawTimeout) {
              const existingRec = geminiQuotaTracker._ensureModelRecord(modelId);
              if (existingRec && (!existingRec.lastProbeCode || existingRec.lastProbeCode === 200)) {
                geminiQuotaTracker.recordModelProbeStatus(modelId, { statusCode: 429, message: "429 Exhausted across pool keys" });
              }
            }
          })
        );
      }
    } else if (probeMode === "models") {
      await Promise.all(
        keys.map(async (key) => {
          if (invalidKeys.has(key)) {
            geminiQuotaTracker.recordInvalid(key, 401, "Invalid API key");
            return;
          }
          const start = Date.now();
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {
              signal: controller.signal,
            });
            clearTimeout(timer);
            const latencyMs = Date.now() - start;
            if (response.status === 401 || response.status === 403) {
              markKeyAsInvalid(key, response.status);
            }
            geminiQuotaTracker.recordModelListProbe(key, {
              statusCode: response.status,
              latencyMs,
            });
          } catch (_) {
            clearTimeout(timer);
          }
        })
      );
    }

    const snapshot = geminiQuotaTracker.getPoolStatusSnapshot(keys, { invalidKeysSet: invalidKeys });
    res.json({
      success: true,
      probeMode,
      probedModel: primaryProbeModel,
      ...snapshot,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Update Gemini Quota & Pacing Settings (Use All Keys Fast vs Safe Pacing, custom RPM/Daily limits, preferred primary model, or reset counter)
 */
router.post("/gemini/quota-settings", (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const settings = geminiQuotaTracker.updateSettings({
      useAllKeysFast: body.useAllKeysFast,
      rpmPerKey: body.rpmPerKey,
      dailyRpdPerKey: body.dailyRpdPerKey,
      preferredModel: body.preferredModel,
      resetDailyStats: Boolean(body.resetDailyStats),
    });
    const keys = extractAllGeminiKeys();
    const invalidKeys = getGlobalInvalidKeys();
    const snapshot = geminiQuotaTracker.getPoolStatusSnapshot(keys, { invalidKeysSet: invalidKeys });
    res.json({
      success: true,
      settings,
      ...snapshot,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Global Branding & Overlay Settings (Single Source of Truth across all episodes & series)
 * Covers: logo*, cornerMask*, sponsor*, anti-theft/marquee/watermark
 */
router.get("/overlay-settings", (req, res) => {
  try {
    const state = readGlobalOverlaySettings();
    res.json({
      success: true,
      ...state,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/overlay-settings", (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incoming =
      body.overlaySettings && typeof body.overlaySettings === "object"
        ? body.overlaySettings
        : body;
    const updatedAt = Number(body.updatedAt) || Date.now();
    const state = writeGlobalOverlaySettings(incoming, { updatedAt });
    res.json({
      success: true,
      ...state,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/overlay-settings", (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incoming =
      body.overlaySettings && typeof body.overlaySettings === "object"
        ? body.overlaySettings
        : body;
    const updatedAt = Number(body.updatedAt) || Date.now();
    const state = writeGlobalOverlaySettings(incoming, { updatedAt });
    res.json({
      success: true,
      ...state,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Global Logo Settings (Legacy alias — reads/writes the unified global overlay store)
 */
router.get("/logo-settings", (req, res) => {
  try {
    const state = readGlobalLogoSettings();
    res.json({
      success: true,
      ...state,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/logo-settings", (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incoming = body.logoSettings && typeof body.logoSettings === "object" ? body.logoSettings : body;
    const updatedAt = Number(body.updatedAt) || Date.now();
    const state = writeGlobalLogoSettings(incoming, { updatedAt });
    res.json({
      success: true,
      ...state,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/logo-settings", (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incoming = body.logoSettings && typeof body.logoSettings === "object" ? body.logoSettings : body;
    const updatedAt = Number(body.updatedAt) || Date.now();
    const state = writeGlobalLogoSettings(incoming, { updatedAt });
    res.json({
      success: true,
      ...state,
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

/**
 * Sponsor Video Upload (Green Screen MP4/MOV/WebM)
 */
router.post(["/upload-sponsor-video", "/sponsor/upload"], (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No sponsor video file provided" });
    }

    try {
      const sponsorDir = path.join(uploadsDir, "sponsor");
      if (!fs.existsSync(sponsorDir)) {
        fs.mkdirSync(sponsorDir, { recursive: true });
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || ".mp4";
      const targetFileName = `sponsor_${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;
      const targetFilePath = path.join(sponsorDir, targetFileName);

      try {
        fs.renameSync(req.file.path, targetFilePath);
      } catch {
        fs.copyFileSync(req.file.path, targetFilePath);
        try { fs.unlinkSync(req.file.path); } catch {}
      }

      const videoUrl = `/uploads/sponsor/${targetFileName}`;
      res.json({
        success: true,
        videoUrl,
        videoPath: targetFilePath,
        filename: targetFileName,
        originalName: req.file.originalname,
        size: req.file.size,
      });
    } catch (saveErr) {
      res.status(500).json({ success: false, error: saveErr.message });
    }
  });
});

module.exports = router;

