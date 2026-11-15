const express = require("express");
const fs = require("fs");
const path = require("path");
const { uploadsDir, getFileSha256, resolveMediaFile } = require("../utils/pathUtils");
const {
  extractAllGeminiKeys,
  isAuthOrInvalidKeyError,
  isQuotaOrRateLimitError,
} = require("../services/geminiKeyManager");
const {
  generateStorytellingScript,
  retranslateSingleDialogue,
  retranslateBatchDialogues,
} = require("../services/geminiService");
const { runDubbingPipeline } = require("../services/pipeline");
const { productionJobQueue } = require("../services/pipeline/productionJobQueue");
const { GENERATION_MODES } = require("../services/pipeline/pipelineTypes");
const {
  getSeriesMetadata,
  saveSeriesMetadata,
  updateSeriesMetadata,
  withSeriesMetadataLock,
} = require("../services/episodeService");
const { parseSrtContent, parseJsonContent } = require("../utils/subtitleParser");
const { deduplicateFastOcrCues } = require("../services/pipeline/stages/stage3_extractChineseSubtitles");

const router = express.Router();

/**
 * Generate Script endpoint using @google/genai Multimodal + Proxy 360p
 */
router.post("/generate-script", async (req, res) => {
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
      videoPath,
      videoId,
      videoFileName,
      mode: rawMode = "dialogue",
      generationMode: rawGenMode,
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

    const generationMode = rawGenMode || (rawMode === 'fast_ocr' ? 'fast_ocr' : 'standard');
    const mode = generationMode === 'fast_ocr' ? GENERATION_MODES.FAST_OCR : rawMode;

    const availableKeys = extractAllGeminiKeys(apiKey);
    if (availableKeys.length === 0) {
      return res.status(400).json({ success: false, error: "Gemini API Key មិនទាន់បានកំណត់ទេ (Gemini API key is required)" });
    }
    const keyToUse = availableKeys.join(',');

    const rawVideoRef = videoPath || (videoFileName ? (path.isAbsolute(videoFileName) ? videoFileName : path.join(uploadsDir, videoFileName)) : null) || videoId;
    const resolvedVideoPath = rawVideoRef ? resolveMediaFile(rawVideoRef) : null;
    let promptText = customPrompt || inputText || "";

    // Preserve useful context (character names, terminology, series glossary) between episodes
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
    } else if (!rawVideoRef && promptText && promptText.trim()) {
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
      console.error(`[Server] ❌ Generate Script Error: File not found for '${rawVideoRef}'.`);
      return res.status(400).json({ success: false, error: `រកមិនឃើញ File វីដេអូ (${rawVideoRef || "គ្មាន File"}) នៅលើ Server ឡើយ។ សូម Upload វីដេអូម្តងទៀត។` });
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

function formatRetranslateRouteError(err) {
  const rawMsg = String(err?.message || err || "Failed to retranslate dialogue")
    .replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");
  const lowerMsg = rawMsg.toLowerCase();
  const status = err?.status || err?.statusCode;

  if (lowerMsg.includes("មិនរកឃើញ gemini_api_key")) {
    return {
      statusCode: 400,
      code: "MISSING_API_KEY",
      error: "Gemini API Key មិនទាន់បានកំណត់ទេ។ សូមបញ្ចូល API Key ក្នុង Settings ឬ .env ជាមុនសិន។",
    };
  }

  if (isAuthOrInvalidKeyError(err)) {
    return {
      statusCode: 401,
      code: "INVALID_API_KEY",
      error: "Gemini API Key មិនត្រឹមត្រូវ ឬអស់សុពលភាព (401/403)។ សូមពិនិត្យ API Key ក្នុង Settings ឬ .env ឡើងវិញ។",
    };
  }

  const isExplicitQuota =
    status === 429 ||
    lowerMsg.includes("429") ||
    lowerMsg.includes("resource_exhausted") ||
    lowerMsg.includes("quota") ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("too many requests");

  if (isExplicitQuota) {
    const retryMatch = rawMsg.match(/retry in\s+([0-9hms.]+)/i);
    const retryHint = retryMatch ? ` (អាចសាកម្ដងទៀតក្នុង ${retryMatch[1]})` : "";
    return {
      statusCode: 429,
      code: "QUOTA_EXCEEDED",
      error: `Gemini API Quota ពេញហើយ (429) លើគ្រប់ Model បម្រុងទាំងអស់${retryHint}។ សូមរង់ចាំបន្តិច ឬបន្ថែម/ប្តូរ API Key ថ្មី។`,
    };
  }

  if (isQuotaOrRateLimitError(err) || status === 504 || lowerMsg.includes("504") || lowerMsg.includes("deadline_exceeded")) {
    return {
      statusCode: 503,
      code: "UPSTREAM_UNAVAILABLE",
      error: "ការតភ្ជាប់ទៅកាន់ Google Gemini AI រអាក់រអួល ឬយឺតពេក (503/Timeout)។ សូមសាកល្បងម្ដងទៀត។",
    };
  }

  return {
    statusCode: 500,
    code: "RETRANSLATE_FAILED",
    error: rawMsg,
  };
}

/**
 * AI In-App Re-Translation Endpoints (Classical Cinema Quality)
 */
router.post("/dubbing/retranslate-segment", async (req, res) => {
  try {
    const { chineseText, context = {} } = req.body || {};
    if (!chineseText || !String(chineseText).trim()) {
      return res.status(400).json({ success: false, error: "Chinese dialogue text is required" });
    }
    const result = await retranslateSingleDialogue(chineseText, req.body?.apiKey, context);
    res.json({ success: true, ...result });
  } catch (err) {
    const formatted = formatRetranslateRouteError(err);
    console.error(`[API] /api/dubbing/retranslate-segment error (${formatted.statusCode}):`, formatted.error);
    res.status(formatted.statusCode).json({
      success: false,
      code: formatted.code,
      error: formatted.error,
    });
  }
});

router.post("/dubbing/retranslate-all", async (req, res) => {
  try {
    const { segments = [], seriesId, episodeId, options = {} } = req.body || {};
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ success: false, error: "Segments array is required" });
    }
    const targetOptions = {
      style: options.style || "compact",
      ...options,
    };
    const updated = await retranslateBatchDialogues(segments, req.body?.apiKey, targetOptions);

    // If seriesId and episodeId provided, atomically update series.json on disk
    if (seriesId && episodeId) {
      await withSeriesMetadataLock(seriesId, () =>
        updateSeriesMetadata(seriesId, (freshSeries) => {
          const freshTargetEp = (freshSeries?.episodes || []).find((e) => String(e.id) === String(episodeId));
          if (!freshTargetEp || !freshTargetEp.scriptData) return false;

          const segmentMap = new Map();
          updated.forEach((s) => segmentMap.set(String(s.id || s.index), s));

          freshTargetEp.scriptData.segments = (freshTargetEp.scriptData.segments || []).map((orig) => {
            const match = segmentMap.get(String(orig.id || orig.index));
            return match ? { ...orig, ...match } : orig;
          });
          freshTargetEp.scriptData.updatedAt = Date.now();
          return true;
        })
      );
    }

    res.json({ success: true, segments: updated, count: updated.length });
  } catch (err) {
    const formatted = formatRetranslateRouteError(err);
    console.error(`[API] /api/dubbing/retranslate-all error (${formatted.statusCode}):`, formatted.error);
    res.status(formatted.statusCode).json({
      success: false,
      code: formatted.code,
      error: formatted.error,
    });
  }
});

router.formatRetranslateRouteError = formatRetranslateRouteError;

/**
 * STEP 4: Subtitle Import endpoint (.srt / .json)
 * Parses external subtitles, validates line by line, deduplicates via deduplicateFastOcrCues,
 * translates to Khmer, and attaches to the target episode.
 */
router.post("/dubbing/import-subtitles", async (req, res) => {
  try {
    const {
      fileContent,
      fileType = "srt",
      seriesId = "series_default",
      episodeId = "ep_1",
      defaultGender = "male",
      apiKey,
      force = false,
      confirmed = false,
    } = req.body;

    if (!fileContent || typeof fileContent !== "string" || !fileContent.trim()) {
      return res.status(400).json({
        success: false,
        validationErrors: ["File content is empty or invalid."],
        error: "សូមជ្រើសរើស File Subtitle (.srt ឬ .json) ដែលមានទិន្នន័យត្រឹមត្រូវ!",
      });
    }

    // 1. Parse Subtitle
    const isJson = fileType === "json" || fileContent.trim().startsWith("{") || fileContent.trim().startsWith("[");
    const parseResult = isJson
      ? parseJsonContent(fileContent, GENERATION_MODES.FAST_OCR)
      : parseSrtContent(fileContent, GENERATION_MODES.FAST_OCR);

    // If parsing produced 0 segments or fatal errors, return detailed validation errors
    if (!parseResult.success || !Array.isArray(parseResult.segments) || parseResult.segments.length === 0) {
      return res.status(400).json({
        success: false,
        validationErrors: parseResult.warnings?.length > 0
          ? parseResult.warnings
          : ["File parsing produced 0 valid subtitle cues."],
        error: "ការអាន File Subtitle បរាជ័យ — សូមពិនិត្យ timecodes និង format!",
      });
    }

    // 2. Re-Translate Safety Check if Episode already has segments
    const seriesMeta = getSeriesMetadata(seriesId);
    const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(episodeId));
    if (targetEp?.scriptData?.segments?.length > 0) {
      if (!force || (confirmed !== true && force !== true)) {
        return res.status(409).json({
          success: false,
          requireConfirmation: true,
          validationErrors: parseResult.warnings || [],
          error: `ភាគ ${episodeId} មាន Script រួចហើយ (${targetEp.scriptData.segments.length} ឃ្លា)។ ការ Import ថ្មីនឹង overwrite ទិន្នន័យចាស់ សូមបញ្ជាក់ជាមុន!`,
          alreadyCompleted: true,
          episodeId,
          segmentsCount: targetEp.scriptData.segments.length,
        });
      }

      // Snapshot backups before overwrite
      try {
        const seriesCleanId = String(seriesId).replace(/[/\\?%*:|"<>]/g, '_');
        const episodeCleanId = String(episodeId).replace(/[/\\?%*:|"<>]/g, '_');
        const seriesDir = path.join(uploadsDir, 'projects', seriesCleanId);
        const episodeDir = path.join(seriesDir, 'episodes', episodeCleanId);
        const backupsDir = path.join(episodeDir, 'backups');
        if (!fs.existsSync(backupsDir)) {
          fs.mkdirSync(backupsDir, { recursive: true });
        }
        const now = Date.now();
        fs.writeFileSync(path.join(backupsDir, `script_backup_${now}.json`), JSON.stringify(targetEp.scriptData, null, 2), 'utf8');

        const seriesJsonPath = path.join(seriesDir, 'series.json');
        if (fs.existsSync(seriesJsonPath)) {
          const seriesBackupPath = path.join(seriesDir, `series.json.backup_${now}`);
          fs.copyFileSync(seriesJsonPath, seriesBackupPath);
        } else if (seriesMeta) {
          const seriesBackupPath = path.join(seriesDir, `series.json.backup_${now}`);
          fs.writeFileSync(seriesBackupPath, JSON.stringify(seriesMeta, null, 2), 'utf8');
        }
      } catch (backupErr) {
        return res.status(500).json({
          success: false,
          error: `Re-Translate Safety Error: Could not create required backups (${backupErr.message}). Import refused.`,
        });
      }
    }

    // 3. Fast OCR Deduplication & Normalization
    const dedupedCues = deduplicateFastOcrCues(parseResult.segments, defaultGender);
    if (dedupedCues.length === 0) {
      return res.status(400).json({
        success: false,
        validationErrors: ["All subtitle cues were dropped during deduplication."],
        error: "រកមិនឃើញអត្ថបទចិនត្រឹមត្រូវក្នុង File Subtitle នេះឡើយ!",
      });
    }

    // 4. Batch Translate Chinese Text to Khmer
    let finalizedSegments = dedupedCues;
    const availableKeys = extractAllGeminiKeys(apiKey);
    const keyToUse = availableKeys.length > 0 ? availableKeys.join(',') : undefined;

    if (keyToUse) {
      try {
        finalizedSegments = await retranslateBatchDialogues(dedupedCues, keyToUse, {
          narratorGender: defaultGender,
        });
      } catch (transErr) {
        console.warn(`[SubtitleImport] Batch translation warning: ${transErr.message}. Keeping raw segments.`);
      }
    }

    // 5. Persist to Episode & series.json under per-series mutex (re-reading latest disk state after async translation)
    await withSeriesMetadataLock(seriesId, () =>
      updateSeriesMetadata(seriesId, (freshSeries) => {
        const freshTargetEp = (freshSeries?.episodes || []).find((e) => String(e.id) === String(episodeId));
        if (!freshTargetEp) return false;
        freshTargetEp.scriptData = {
          mode: GENERATION_MODES.FAST_OCR,
          generationMode: 'fast_ocr',
          source: 'imported_subtitles',
          segments: finalizedSegments,
          hasScript: finalizedSegments.length > 0,
          totalSegments: finalizedSegments.length,
          updatedAt: Date.now(),
        };
        freshTargetEp.generationMode = 'fast_ocr';
        freshTargetEp.status = 'translated';
        return true;
      })
    );

    return res.json({
      success: true,
      message: `Import Subtitle ជោគជ័យ! (${finalizedSegments.length} ឃ្លា)`,
      count: finalizedSegments.length,
      segments: finalizedSegments,
      validationErrors: parseResult.warnings || [],
      warnings: parseResult.warnings || [],
    });
  } catch (err) {
    console.error("[API] /api/dubbing/import-subtitles error:", err);
    res.status(500).json({
      success: false,
      error: `Import Subtitle បរាជ័យ: ${err.message}`,
      validationErrors: [err.message],
    });
  }
});

module.exports = router;

