const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  uploadsDir,
  sanitizeProjectName,
  sanitizeEpisodeId,
  ensureProjectDirs,
  resolveMediaFile,
} = require("../utils/pathUtils");
const {
  SUPPORTED_VOICES,
  getSupportedVoices,
  validateVoiceId,
  speedToEdgeRate,
  generateSingleSegmentAudio,
  generateBatchSegmentsAudio,
  cancelTtsJob,
  generateVoicePreview,
} = require("../services/ttsService");
const { detectSpeakerGender } = require("../models/speakerRegistry");
const { createSynchronizedNarrationAudio, parseTimeToSec } = require("../services/ffmpegService");
const audioSeparationService = require("../services/audioSeparationService");

const router = express.Router();

const activeSyncJobs = new Map();

/**
 * 1. Voices catalog endpoints
 */
router.get("/voices", (req, res) => {
  res.json({ success: true, voices: SUPPORTED_VOICES });
});

router.get("/tts/voices", (req, res) => {
  res.json({ success: true, ...getSupportedVoices() });
});

/**
 * 2. Voice Preview endpoints
 */
router.post(["/preview-voice", "/tts/preview"], async (req, res) => {
  try {
    const { voiceId = "km-KH-PisethNeural", text = "" } = req.body;
    const preview = await generateVoicePreview(voiceId, text, uploadsDir);
    res.json({ success: true, ...preview });
  } catch (err) {
    console.error("Preview Voice Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// In-memory cache for episode total segment counts to prevent blocking disk I/O on 17MB+ series.json
const cachedEpisodeTotals = new Map();

/**
 * 3. TTS Real-time Segment Progress endpoint (Zero-blocking Event Loop)
 */
router.get("/tts/progress", async (req, res) => {
  try {
    const { seriesId, episodeId, total: queryTotal } = req.query;
    if (!seriesId || !episodeId) {
      return res.json({ success: true, isRunning: false, current: 0, total: 0, percent: 0 });
    }

    const cleanSeries = sanitizeProjectName(seriesId);
    const cleanEpisode = sanitizeEpisodeId(episodeId);
    const epAudioDir = path.join(uploadsDir, "projects", cleanSeries, "episodes", cleanEpisode, "audio");

    let current = 0;
    let lastFile = null;
    let isDone = false;

    if (fs.existsSync(epAudioDir)) {
      try {
        const dirEntries = await fs.promises.readdir(epAudioDir);
        const mp3s = dirEntries.filter((f) => f.endsWith(".mp3") && !f.includes("narration"));
        current = mp3s.length;
        if (current > 0) {
          lastFile = mp3s[current - 1];
        }
        isDone = dirEntries.includes(`${cleanEpisode}_narration_khmer.mp3`);
      } catch (_) {}
    }

    // Determine total segments without re-reading huge series.json synchronously
    let total = 0;
    const cacheKey = `${cleanSeries}_${cleanEpisode}`;
    const parsedQueryTotal = parseInt(queryTotal, 10);

    if (!isNaN(parsedQueryTotal) && parsedQueryTotal > 0) {
      total = parsedQueryTotal;
      cachedEpisodeTotals.set(cacheKey, { total, cachedAt: Date.now() });
    } else {
      const cached = cachedEpisodeTotals.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < 30000) {
        total = cached.total;
      } else {
        try {
          const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
          if (fs.existsSync(metaPath)) {
            const raw = await fs.promises.readFile(metaPath, "utf8");
            const meta = JSON.parse(raw);
            const ep = (meta.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
            total = ep?.scriptData?.segments?.length || ep?.scriptData?.totalSegments || 0;
            cachedEpisodeTotals.set(cacheKey, { total, cachedAt: Date.now() });
          }
        } catch (_) {}
      }
    }

    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const stage = isDone ? 'completed' : (percent >= 98 ? 'syncing' : (current > 0 ? 'synthesizing' : 'starting'));

    return res.json({
      success: true,
      isRunning: current > 0 && !isDone,
      isDone,
      current,
      total,
      percent: isDone ? 100 : percent,
      lastFile,
      stage,
      seriesId: cleanSeries,
      episodeId: cleanEpisode,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 3.1. Kill / Cancel Active TTS Synthesis Process
 */
router.post("/tts/kill", (req, res) => {
  try {
    const { seriesId, episodeId, all } = req.body || {};
    const key = (all || (!seriesId && !episodeId)) ? 'all' : (episodeId ? `${seriesId || ''}:${episodeId}` : (seriesId || 'all'));
    const result = cancelTtsJob(key);
    return res.json({ success: true, result });
  } catch (err) {
    console.error("[TTS Kill] Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 4. Generate Audio endpoint (Single Segment 1-Click Regen OR Batch Segments)
 */
router.post("/generate-audio", async (req, res) => {
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
      speed: rawBodySpeed,
      rate: rawBodyRate,
      userCustomSpeed: rawBodyUserCustomSpeed,
      autoStretch = true,
      maxSpeed = 1.45,
      speakerMap = {},
      projectName,
      videoId,
      forceRegen = false,
      seriesId,
      episodeId,
    } = req.body;
    const hasBodySpeed = rawBodySpeed !== undefined && rawBodySpeed !== null && rawBodySpeed !== "";
    const hasBodyRate = rawBodyRate !== undefined && rawBodyRate !== null && rawBodyRate !== "";
    const speed = hasBodySpeed ? rawBodySpeed : (hasBodyRate ? rawBodyRate : "normal");

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
      const rawText = segment.khmer || segment.khmerText || segment.khmerTranslatedText || segment.text || "";
      const textToSpeak = typeof rawText === "string" ? rawText.trim() : "";
      if (!textToSpeak) {
        const segNum = segment.index || segment.id || "";
        const emptyMsg = segNum
          ? `Segment #${segNum} គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន`
          : "គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន";
        console.warn(`[TTS 400 Guard] ${emptyMsg}`);
        return res.status(400).json({
          success: false,
          error: emptyMsg,
          message: emptyMsg,
        });
      }

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

      const segOwnRawSpeed = (segment.speed !== undefined && segment.speed !== null && segment.speed !== "")
        ? segment.speed
        : (segment.rate !== undefined && segment.rate !== null && segment.rate !== "" ? segment.rate : undefined);
      const requestedSpeedRaw = hasBodyRate
        ? rawBodyRate
        : (hasBodySpeed ? rawBodySpeed : segOwnRawSpeed);
      const speedInfo = speedToEdgeRate(requestedSpeedRaw);
      if (speedInfo.provided && !speedInfo.valid) {
        console.warn(`[TTS] ⚠️ Route /generate-audio single segment #${segment.id || "N/A"} requested speed ${JSON.stringify(speedInfo.requested)} cannot be applied (${speedInfo.reason})`);
      }
      const resolvedRate = speedInfo.valid ? speedInfo.rate : "+0%";
      const hasExplicitUserSpeed = rawBodyUserCustomSpeed !== undefined
        ? Boolean(rawBodyUserCustomSpeed)
        : Boolean(speedInfo.isCustomNonDefault || segment.userCustomSpeed);
      const resolvedSegSpeed = (speedInfo.valid && speedInfo.provided)
        ? (typeof speedInfo.requested === "string" && speedInfo.requested.trim().toLowerCase() === "normal"
          ? "normal"
          : (speedInfo.numericSpeed ?? 1.0))
        : (segment.speed ?? "normal");

      console.log(`[TTS] Regenerating single segment #${segment.id} [${deliveryType}] with voice ${targetVoice}, rate=${resolvedRate} (requestedSpeed=${requestedSpeedRaw ?? "default"}, userCustomSpeed=${hasExplicitUserSpeed})${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""}...`);
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
          speed: resolvedSegSpeed,
          userCustomSpeed: hasExplicitUserSpeed,
          episodeId: cleanEpisode,
        },
        audioDir,
        {
          autoStretch,
          maxSpeed,
          rate: speedInfo.valid ? resolvedRate : undefined,
          speed: speedInfo.provided ? requestedSpeedRaw : undefined,
          userCustomSpeed: hasExplicitUserSpeed,
          forceVoice: isManual,
          voiceId: targetVoice,
          deliveryType,
          audioEffect,
          deliveryOverride,
          effectConfig,
          forceRegen: Boolean(forceRegen),
          episodeId: cleanEpisode,
          ...(speedInfo.provided && !speedInfo.valid ? { _suppressInvalidSpeedLog: true } : {}),
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

      // Persist updated single segment into series.json immediately
      if (isEpisode && cleanSeries && cleanEpisode) {
        try {
          const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
          if (fs.existsSync(metaPath)) {
            const fileContent = await fs.promises.readFile(metaPath, "utf8");
            const seriesMeta = JSON.parse(fileContent);
            const targetEp = (seriesMeta.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
            if (targetEp && targetEp.scriptData && Array.isArray(targetEp.scriptData.segments)) {
              const segIdx = targetEp.scriptData.segments.findIndex((s) => String(s.id) === String(updatedSegment.id));
              if (segIdx !== -1) {
                targetEp.scriptData.segments[segIdx] = {
                  ...targetEp.scriptData.segments[segIdx],
                  ...updatedSegment,
                  audioOffset: 0,
                  audioTrimmed: false,
                  userTrimmed: false,
                };
              }
              if (fullAudioUrl) {
                targetEp.fullAudioUrl = fullAudioUrl;
              }
              targetEp.audioGenerated = true;
              targetEp.hasAudio = true;
              await fs.promises.writeFile(metaPath, JSON.stringify(seriesMeta, null, 2), "utf8");
            }
          }
        } catch (_) {}
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
      const fullAudioFilename = isEpisode ? `${cleanEpisode}_narration_khmer.mp3` : `${cleanName}_narration_khmer.mp3`;
      const fullAudioPath = path.join(audioDir, fullAudioFilename);

      const hasAnyText = segments.some((s) => {
        const raw = s.khmer || s.khmerText || s.khmerTranslatedText || s.text || "";
        return Boolean(typeof raw === "string" && raw.trim());
      });

      if (!hasAnyText) {
        console.warn(`[TTS] Batch audio request has 0 segments with text (${segments.length} segments skipped).`);
        return res.json({
          success: true,
          projectName: cleanSeries,
          seriesId: cleanSeries,
          episodeId: cleanEpisode,
          voiceId,
          speed,
          fullAudioUrl: null,
          fullAudioPath: null,
          segments: segments.map((s) => ({ ...s, ttsStatus: "empty_text", audioGenerated: false, audioOutdated: true })),
          skippedEmptyCount: segments.length,
          validCount: 0,
          summaryMessage: `រំលង ${segments.length} ឃ្លា (គ្មានអត្ថបទ)`,
        });
      }

      // Fast Path: If master narration audio already exists and forceRegen is false, return immediately without re-rendering
      // (unless segments are marked outdated or have an unapplied custom speed rate change).
      const hasOutdatedOrSpeedChange = segments.some((s) => {
        if (s.audioOutdated) return true;
        const ownInfo = speedToEdgeRate(s.speed ?? s.rate);
        return Boolean((s.userCustomSpeed || ownInfo.isCustomNonDefault) && s.ttsRate && ownInfo.valid && s.ttsRate !== ownInfo.rate);
      });
      if (!forceRegen && !hasOutdatedOrSpeedChange && fs.existsSync(fullAudioPath) && fs.statSync(fullAudioPath).size > 1000) {
        const relAudioUrl = isEpisode
          ? `/uploads/projects/${cleanSeries}/episodes/${cleanEpisode}/audio/${fullAudioFilename}`
          : `/uploads/projects/${cleanName}/audio/${fullAudioFilename}`;
        console.log(`[TTS] Master narration audio already exists for ${cleanEpisode || cleanName} (${fs.statSync(fullAudioPath).size} bytes). Skipping duplicate generation.`);
        if (isEpisode && cleanSeries && cleanEpisode) {
          try {
            const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
            if (fs.existsSync(metaPath)) {
              const fileContent = await fs.promises.readFile(metaPath, "utf8");
              const seriesMeta = JSON.parse(fileContent);
              const targetEp = (seriesMeta.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
              if (targetEp && (!targetEp.audioGenerated || !targetEp.fullAudioUrl)) {
                targetEp.audioGenerated = true;
                targetEp.fullAudioUrl = relAudioUrl;
                targetEp.fullAudioPath = fullAudioPath;
                targetEp.hasAudio = true;
                await fs.promises.writeFile(metaPath, JSON.stringify(seriesMeta, null, 2), "utf8");
              }
            }
          } catch (_) {}
        }
        const mappedSegments = segments.map((s) => {
          const raw = s.khmer || s.khmerText || s.khmerTranslatedText || s.text || "";
          if (!raw.trim()) {
            return { ...s, ttsStatus: "empty_text", audioGenerated: false, audioOutdated: true };
          }
          return s;
        });
        const skippedEmptyCount = mappedSegments.filter((s) => s.ttsStatus === "empty_text").length;
        const validCount = mappedSegments.length - skippedEmptyCount;
        return res.json({
          success: true,
          alreadyCompleted: true,
          projectName: cleanSeries,
          seriesId: cleanSeries,
          episodeId: cleanEpisode,
          voiceId,
          speed,
          fullAudioUrl: relAudioUrl,
          fullAudioPath,
          segments: mappedSegments,
          skippedEmptyCount,
          validCount,
          summaryMessage: skippedEmptyCount > 0 ? `ជោគជ័យ ${validCount} ឃ្លា (រំលង ${skippedEmptyCount} ឃ្លា គ្មានអត្ថបទ)` : `ជោគជ័យ ${validCount} ឃ្លា (100%)`,
        });
      }

      const batchRequestedSpeed = hasBodyRate ? rawBodyRate : (hasBodySpeed ? rawBodySpeed : undefined);
      const batchSpeedInfo = speedToEdgeRate(batchRequestedSpeed);
      if (batchSpeedInfo.provided && !batchSpeedInfo.valid) {
        console.warn(`[TTS] ⚠️ Route /generate-audio batch requested speed ${JSON.stringify(batchSpeedInfo.requested)} cannot be applied (${batchSpeedInfo.reason})`);
      }

      console.log(`[TTS] Batch generating audio for ${segments.length} segments in ${cleanSeries}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""} (batchSpeed=${batchRequestedSpeed ?? "default"}, batchRate=${batchSpeedInfo.valid ? batchSpeedInfo.rate : "INVALID"})...`);
      const updatedSegments = await generateBatchSegmentsAudio(segments, audioDir, {
        concurrency: 3,
        autoStretch,
        maxSpeed,
        speed: hasBodySpeed ? rawBodySpeed : undefined,
        rate: hasBodyRate ? rawBodyRate : undefined,
        userCustomSpeed: rawBodyUserCustomSpeed !== undefined ? Boolean(rawBodyUserCustomSpeed) : undefined,
        speakerMap,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        forceRegen: Boolean(forceRegen),
      });

      // Save updated segments to series.json IMMEDIATELY so individual segment playback and inspector work!
      if (isEpisode && cleanSeries && cleanEpisode) {
        try {
          const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
          if (fs.existsSync(metaPath)) {
            const fileContent = await fs.promises.readFile(metaPath, "utf8");
            const seriesMeta = JSON.parse(fileContent);
            const targetEp = (seriesMeta.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
            if (targetEp) {
              if (!targetEp.scriptData) targetEp.scriptData = {};
              if (Array.isArray(targetEp.scriptData.segments) && targetEp.scriptData.segments.length > updatedSegments.length) {
                const updatedMap = new Map(updatedSegments.map((s) => [String(s.id ?? s.index), s]));
                targetEp.scriptData.segments = targetEp.scriptData.segments.map((s) => updatedMap.get(String(s.id ?? s.index)) || s);
              } else {
                targetEp.scriptData.segments = updatedSegments;
              }
              targetEp.scriptData.hasScript = true;
              targetEp.scriptData.totalSegments = targetEp.scriptData.segments.length;
              targetEp.audioGenerated = true;
              targetEp.hasAudio = true;
              await fs.promises.writeFile(metaPath, JSON.stringify(seriesMeta, null, 2), "utf8");
              console.log(`[TTS] Immediately persisted ${targetEp.scriptData.segments.length} segments with audio to series.json for episode ${cleanEpisode}`);
            }
          }
        } catch (saveErr) {
          console.warn("[TTS] Error saving updated segments to series.json:", saveErr.message);
        }
      }

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

      // Auto-persist audio status in series.json for episode isolation
      if (isEpisode && cleanSeries && cleanEpisode) {
        try {
          const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
          if (fs.existsSync(metaPath)) {
            const fileContent = await fs.promises.readFile(metaPath, "utf8");
            const seriesMeta = JSON.parse(fileContent);
            const targetEp = (seriesMeta.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
            if (targetEp) {
              targetEp.audioGenerated = true;
              targetEp.hasAudio = true;
              if (fs.existsSync(fullAudioPath)) {
                targetEp.fullAudioUrl = relAudioUrl;
                targetEp.fullAudioPath = fullAudioPath;
              }
              await fs.promises.writeFile(metaPath, JSON.stringify(seriesMeta, null, 2), "utf8");
              console.log(`[TTS] Auto-persisted audioGenerated=true in series.json for episode ${cleanEpisode}`);
            }
          }
        } catch (saveErr) {
          console.warn("[TTS] Could not persist audio status in series.json:", saveErr.message);
        }
      }

      const skippedEmptyCount = updatedSegments.filter(s => s.ttsStatus === 'empty_text' || !((s.khmer || s.khmerText || s.khmerTranslatedText || s.text || '').trim())).length;
      const validGeneratedCount = updatedSegments.length - skippedEmptyCount;
      const summaryMessage = skippedEmptyCount > 0
        ? `ជោគជ័យ ${validGeneratedCount} ឃ្លា (រំលង ${skippedEmptyCount} ឃ្លា គ្មានអត្ថបទ)`
        : `ជោគជ័យ ${validGeneratedCount} ឃ្លា (100%)`;

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
        skippedEmptyCount,
        validCount: validGeneratedCount,
        summaryMessage,
      });
    }

    res.status(400).json({ success: false, error: "សូមបញ្ជូន segment ឬ segments!" });
  } catch (err) {
    console.error("TTS Error:", err);
    if (err.message && (err.message.includes("Empty text") || err.message.includes("ទទេ"))) {
      return res.status(400).json({ success: false, error: err.message, message: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. AI Vocal Separation (Demucs) Status & On-demand Endpoints
 */
router.post("/audio/separation-status", async (req, res) => {
  try {
    const { videoPath, videoFileName, videoId } = req.body;
    const rawVideoRef = videoPath || videoId || videoFileName;
    if (!rawVideoRef) {
      return res.status(400).json({ success: false, error: "Missing video reference" });
    }
    const inputVideoPath = resolveMediaFile(rawVideoRef);
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return res.status(404).json({ success: false, error: "Video file not found" });
    }
    const cacheDir = audioSeparationService.getSeparationCacheDir(inputVideoPath);
    const noVocalsPath = path.join(cacheDir, "no_vocals.wav");
    if (fs.existsSync(noVocalsPath)) {
      const relPath = path.relative(uploadsDir, noVocalsPath).replace(/\\/g, "/");
      return res.json({
        success: true,
        available: true,
        noVocalsUrl: `/uploads/${relPath}`,
        noVocalsPath,
      });
    }
    return res.json({
      success: true,
      available: false,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/audio/separate", async (req, res) => {
  if (req.socket) {
    req.socket.setTimeout(0);
    if (typeof req.socket.setKeepAlive === "function") {
      req.socket.setKeepAlive(true, 10000);
    }
  }
  if (typeof res.setTimeout === "function") {
    res.setTimeout(0);
  }

  let heartbeatTimer = null;
  let streamStarted = false;

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  res.on("close", stopHeartbeat);

  try {
    const { videoPath, videoFileName, videoId } = req.body;
    const rawVideoRef = videoPath || videoId || videoFileName;
    const inputVideoPath = resolveMediaFile(rawVideoRef);
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return res.status(404).json({ success: false, error: "Video file not found" });
    }

    // Check busy lock before streaming 200 keep-alive headers so 409 conflict remains an immediate HTTP 409 JSON response
    if (typeof audioSeparationService.isSeparationBusy === "function" && audioSeparationService.isSeparationBusy()) {
      const activeMedia = typeof audioSeparationService.getCurrentSeparationMedia === "function"
        ? audioSeparationService.getCurrentSeparationMedia()
        : null;
      return res.status(409).json({
        success: false,
        busy: true,
        error: `Demucs AI កំពុងដំណើរការបំបែកសំឡេង (${activeMedia || 'វីដេអូផ្សេង'})។ សូមរង់ចាំឱ្យចប់ជាមុនសិន ទើបអាចបំបែកភាគបន្ទាប់បាន។`,
      });
    }

    // Start chunked 200 keep-alive stream (whitespace newlines before final JSON payload)
    // to prevent net::ERR_EMPTY_RESPONSE / Vite 502 idle header timeouts during long CPU Demucs runs.
    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    res.write(" \n");
    streamStarted = true;

    heartbeatTimer = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(" \n");
        } catch (_) {
          stopHeartbeat();
        }
      } else {
        stopHeartbeat();
      }
    }, 10000);

    const sepRes = await audioSeparationService.separateAudio({ audioPath: inputVideoPath, model: 'htdemucs' });
    stopHeartbeat();
    const relPath = path.relative(uploadsDir, sepRes.noVocalsPath).replace(/\\/g, "/");
    const noVocalsUrl = `/uploads/${relPath}`;

    // Auto-persist Clean BGM into series.json for episode tracking (even if client socket closed mid-run)
    try {
      const match = inputVideoPath.match(/projects[/\\]([^/\\]+)[/\\]episodes[/\\]([^/\\]+)/);
      const pSeriesId = (match && match[1]) || req.body.seriesId;
      const pEpisodeId = (match && match[2]) || req.body.episodeId;
      if (pSeriesId && pEpisodeId) {
        const metaPath = path.join(uploadsDir, "projects", pSeriesId, "series.json");
        if (fs.existsSync(metaPath)) {
          const rawMeta = await fs.promises.readFile(metaPath, "utf8");
          const sMeta = JSON.parse(rawMeta);
          const targetEp = (sMeta.episodes || []).find((e) => String(e.id) === String(pEpisodeId));
          if (targetEp) {
            targetEp.bgmAudioUrl = noVocalsUrl;
            targetEp.cleanBgmPath = sepRes.noVocalsPath;
            targetEp.isDemucsDone = true;
            targetEp.hasDemucs = true;
            await fs.promises.writeFile(metaPath, JSON.stringify(sMeta, null, 2), "utf8");
            console.log(`[AudioSeparation] ✅ Auto-persisted clean BGM into series.json for episode ${pEpisodeId}`);
          }
        }
      }
    } catch (saveErr) {
      console.warn("[AudioSeparation] Could not auto-persist to series.json:", saveErr.message);
    }

    if (!res.writableEnded && !res.destroyed) {
      return res.end(JSON.stringify({
        success: true,
        noVocalsUrl,
        noVocalsPath: sepRes.noVocalsPath,
        isCached: sepRes.isCached,
      }));
    }
  } catch (err) {
    stopHeartbeat();
    if (!streamStarted && (err.statusCode === 409 || err.status === 409 || err.code === 'DEMUCS_BUSY' || err.isBusy)) {
      return res.status(409).json({ success: false, busy: true, error: err.message });
    }
    console.error("[AudioSeparation] Error handling /api/audio/separate:", err);
    if (!res.writableEnded && !res.destroyed) {
      const payload = JSON.stringify({
        success: false,
        busy: Boolean(err.isBusy || err.status === 409),
        error: err.message,
      });
      if (streamStarted) {
        return res.end(payload);
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }
});

router.get("/audio/separation-progress", (req, res) => {
  try {
    const { videoPath, videoFileName, videoId } = req.query;
    const rawVideoRef = videoPath || videoId || videoFileName;
    const progressData = audioSeparationService.getSeparationProgress(rawVideoRef);
    let noVocalsUrl = null;
    const noVocalsPath = progressData?.noVocalsPath || null;
    if (noVocalsPath && fs.existsSync(noVocalsPath)) {
      const relPath = path.relative(uploadsDir, noVocalsPath).replace(/\\/g, "/");
      noVocalsUrl = `/uploads/${relPath}`;
    }
    return res.json({
      success: true,
      progress: progressData ? progressData.progress : 0,
      status: progressData ? progressData.status : 'idle',
      message: progressData ? progressData.message : '',
      error: progressData?.error || null,
      model: progressData?.model || 'htdemucs',
      noVocalsUrl,
      noVocalsPath,
    });
  } catch (err) {
    return res.json({ success: true, progress: 0, status: 'idle', model: 'htdemucs' });
  }
});

router.post("/audio/separate-kill", (req, res) => {
  try {
    const { videoPath, jobId } = req.body || {};
    const result = audioSeparationService.killSeparationJob(jobId || videoPath || 'all');
    return res.json({ success: true, result });
  } catch (err) {
    console.error("[AudioSeparation] Failed to kill separation process:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 6. Fast Timeline Audio Sync
 */
router.post("/sync-audio", async (req, res) => {
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
          audioEndSec: typeof s.audioEndSec === "number" ? s.audioEndSec : undefined,
          audioDurationSec: s.audioDurationSec || s.audioDuration || 2.5,
          audioOffset: typeof s.audioOffset === "number" && !isNaN(s.audioOffset) ? s.audioOffset : 0,
          audioTrimmed: Boolean(s.audioTrimmed),
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
      .update(JSON.stringify(syncSegs.map((s) => ({
        id: s.id,
        t: s.audioStartSec,
        e: s.audioEndSec,
        dur: s.audioDurationSec,
        trimmed: Boolean(s.audioTrimmed),
        p: s.audioPath
      }))))
      .digest("hex").slice(0, 16);

    const metaPath = `${fullAudioPath}.meta.json`;
    const relAudioUrl = isEpisode
      ? `/uploads/projects/${cleanSeries}/episodes/${cleanEpisode}/audio/${fullAudioFilename}`
      : `/uploads/projects/${cleanName}/audio/${fullAudioFilename}`;

    // Fast-path: Check if matching synchronized audio already exists on disk with identical fingerprint
    if (fs.existsSync(fullAudioPath) && fs.existsSync(metaPath)) {
      try {
        const existingMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (existingMeta && existingMeta.fingerprint === fingerprint) {
          console.log(`[Sync Audio] ✨ Cache hit for ${cleanSeries}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""}/audio (Fingerprint: ${fingerprint}). Skipping re-render.`);
          return res.json({
            success: true,
            projectName: cleanSeries,
            seriesId: cleanSeries,
            episodeId: cleanEpisode,
            fullAudioUrl: relAudioUrl,
            fullAudioPath,
            fingerprint,
            cached: true,
          });
        }
      } catch (_) {}
    }

    // In-flight mutex: If a sync is already running for this exact file, await it instead of spawning duplicate FFmpeg processes
    if (activeSyncJobs.has(fullAudioPath)) {
      console.log(`[Sync Audio] ⏳ Joining in-flight sync for ${fullAudioPath}...`);
      await activeSyncJobs.get(fullAudioPath);
      return res.json({
        success: true,
        projectName: cleanSeries,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        fullAudioUrl: relAudioUrl,
        fullAudioPath,
        fingerprint,
      });
    }

    const syncPromise = (async () => {
      console.log(`[Sync Audio] Re-syncing ${syncSegs.length} audio clips in ${cleanSeries}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""}/audio (Fingerprint: ${fingerprint})...`);
      await createSynchronizedNarrationAudio(syncSegs, fullAudioPath);

      // Save sidecar fingerprint metadata for strict episode isolation
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
    })();

    activeSyncJobs.set(fullAudioPath, syncPromise);
    try {
      await syncPromise;
    } finally {
      activeSyncJobs.delete(fullAudioPath);
    }

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

module.exports = router;

