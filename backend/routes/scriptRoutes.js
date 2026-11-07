const express = require("express");
const fs = require("fs");
const path = require("path");
const { uploadsDir, getFileSha256, resolveMediaFile } = require("../utils/pathUtils");
const { extractAllGeminiKeys } = require("../services/geminiKeyManager");
const {
  generateStorytellingScript,
  retranslateSingleDialogue,
  retranslateBatchDialogues,
} = require("../services/geminiService");
const { runDubbingPipeline } = require("../services/pipeline");
const { productionJobQueue } = require("../services/pipeline/productionJobQueue");

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

/**
 * AI In-App Re-Translation Endpoints (Classical Cinema Quality)
 */
router.post("/dubbing/retranslate-segment", async (req, res) => {
  try {
    const { chineseText, context = {} } = req.body;
    if (!chineseText || !String(chineseText).trim()) {
      return res.status(400).json({ success: false, error: "Chinese dialogue text is required" });
    }
    const result = await retranslateSingleDialogue(chineseText, req.body.apiKey, context);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[API] /api/dubbing/retranslate-segment error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/dubbing/retranslate-all", async (req, res) => {
  try {
    const { segments = [], seriesId, episodeId, options = {} } = req.body;
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ success: false, error: "Segments array is required" });
    }
    const updated = await retranslateBatchDialogues(segments, req.body.apiKey, options);
    res.json({ success: true, segments: updated });
  } catch (err) {
    console.error("[API] /api/dubbing/retranslate-all error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

