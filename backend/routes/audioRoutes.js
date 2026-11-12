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
  cleanTextForTts,
  isPlaceholderOrEmptyTtsText,
  generateSingleSegmentAudio,
  generateBatchSegmentsAudio,
  getTtsJobProgress,
  resolvePriorSegmentAudioPath,
  cancelTtsJob,
  generateVoicePreview,
} = require("../services/ttsService");
const { detectSpeakerGender } = require("../models/speakerRegistry");
const { createSynchronizedNarrationAudio, parseTimeToSec, autoStretchTtsAudio, getMediaDuration } = require("../services/ffmpegService");
const audioSeparationService = require("../services/audioSeparationService");
const { withSeriesMetadataLock, updateSeriesMetadata } = require("../services/episodeService");

const router = express.Router();

const activeSyncJobs = new Map();
const activeBatchStages = new Map();
const autoFitProgressMap = new Map();

function countUniqueSegmentMp3s(mp3s = []) {
  const uniqueSegIds = new Set();
  for (const f of mp3s) {
    if (!f || f.startsWith(".tmp")) continue;
    const m = f.match(/seg_([^_]+)_/);
    uniqueSegIds.add(m && m[1] ? m[1] : f);
  }
  return uniqueSegIds.size;
}

function doesSegmentNeedTts(seg, audioDir, batchSpeedInfo = null, batchExplicitCustom = false) {
  if (!seg || typeof seg !== "object") return false;
  if (seg.ttsStatus === "empty_text") return false;
  const raw = seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || "";
  if (typeof raw !== "string" || !raw.trim() || !cleanTextForTts(raw) || isPlaceholderOrEmptyTtsText(raw)) return false;

  if (seg.audioOutdated) return true;
  if (seg.ttsStatus === "pending" || seg.ttsStatus === "error" || seg.status === "tts_error") return true;

  const existingPath = resolvePriorSegmentAudioPath(seg, audioDir);
  if (!existingPath) return true;

  const ownInfo = speedToEdgeRate(seg.speed ?? seg.rate);
  if ((seg.userCustomSpeed || ownInfo.isCustomNonDefault) && seg.ttsRate && ownInfo.valid && seg.ttsRate !== ownInfo.rate) {
    return true;
  }
  if (!seg.userCustomSpeed && batchExplicitCustom && batchSpeedInfo?.valid && seg.ttsRate && seg.ttsRate !== batchSpeedInfo.rate) {
    return true;
  }

  if (seg.voiceId) {
    const validVoice = validateVoiceId(seg.voiceId);
    if (validVoice !== "google-km-standard" && !path.basename(existingPath).includes(validVoice)) {
      return true;
    }
  }

  return false;
}

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

    // Prefer exact in-flight job counters when batch TTS or master narration sync is running
    const batchKey = `${cleanSeries}:${cleanEpisode}`;
    const activeJob = getTtsJobProgress(cleanSeries, cleanEpisode);
    const batchStage = activeBatchStages.get(batchKey);

    if (activeJob || batchStage) {
      const effTotal = activeJob?.total || batchStage?.total || total;
      if (batchStage?.stage === "syncing" && !activeJob) {
        return res.json({
          success: true,
          isRunning: true,
          isDone: false,
          current: effTotal,
          total: effTotal,
          percent: 98,
          lastFile: null,
          stage: "syncing",
          seriesId: cleanSeries,
          episodeId: cleanEpisode,
        });
      }
      const rawCurrent = activeJob ? activeJob.completed : 0;
      const current = effTotal > 0 ? Math.min(effTotal, rawCurrent) : rawCurrent;
      const percent = effTotal > 0 ? Math.min(99, Math.round((current / effTotal) * 100)) : 0;
      return res.json({
        success: true,
        isRunning: true,
        isDone: false,
        current,
        total: effTotal,
        percent,
        lastFile: activeJob?.lastFile || null,
        stage: batchStage?.stage || activeJob?.stage || "synthesizing",
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
      });
    }

    let current = 0;
    let lastFile = null;
    let isDone = false;

    if (fs.existsSync(epAudioDir)) {
      try {
        const dirEntries = await fs.promises.readdir(epAudioDir);
        const mp3s = dirEntries.filter((f) => f.endsWith(".mp3") && !f.includes("narration") && !f.startsWith(".tmp"));
        const uniqueCount = countUniqueSegmentMp3s(mp3s);
        current = total > 0 ? Math.min(total, uniqueCount) : uniqueCount;
        if (mp3s.length > 0) {
          lastFile = mp3s[mp3s.length - 1];
        }
        isDone = dirEntries.includes(`${cleanEpisode}_narration_khmer.mp3`);
      } catch (_) {}
    }

    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const stage = isDone ? "completed" : (current > 0 ? "idle" : "starting");

    return res.json({
      success: true,
      isRunning: false,
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
      voiceId: rawBodyVoiceId,
      speed: rawBodySpeed,
      rate: rawBodyRate,
      userCustomSpeed: rawBodyUserCustomSpeed,
      autoStretch = true,
      maxSpeed = 1.50,
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

    // Guard empty or untranslated placeholder single-segment text BEFORE ensureProjectDirs so rejected 400 calls never create empty project/drama_project dirs
    if (segment && typeof segment === "object") {
      const earlyRawText = segment.khmer || segment.khmerText || segment.khmerTranslatedText || segment.text || "";
      const earlyTextToSpeak = typeof earlyRawText === "string" ? cleanTextForTts(earlyRawText) : "";
      if (!earlyTextToSpeak || isPlaceholderOrEmptyTtsText(earlyRawText)) {
        const segNum = segment.index || segment.id || "";
        const isPlaceholder = earlyTextToSpeak === "សន្ទនា";
        const emptyMsg = isPlaceholder
          ? (segNum
            ? `Segment #${segNum} មានតែពាក្យជំនួស "សន្ទនា" (មិនទាន់បកប្រែពិតប្រាកដទេ) — សូមបកប្រែឡើងវិញសិន`
            : 'មានតែពាក្យជំនួស "សន្ទនា" (មិនទាន់បកប្រែពិតប្រាកដទេ) — សូមបកប្រែឡើងវិញសិន')
          : (segNum
            ? `Segment #${segNum} គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន`
            : "គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន");
        console.warn(`[TTS 400 Guard] ${emptyMsg}`);
        return res.status(400).json({
          success: false,
          error: emptyMsg,
          message: emptyMsg,
        });
      }
    }

    const { audioDir, cleanName, cleanSeries, cleanEpisode, isEpisode } = ensureProjectDirs(rawProjectName, rawEpisodeId, rawSeriesId);

    // ករណីទី 1: Single Segment Regeneration (1-Click Inspector)
    if (segment && typeof segment === "object") {
      const rawText = segment.khmer || segment.khmerText || segment.khmerTranslatedText || segment.text || "";
      const textToSpeak = typeof rawText === "string" ? rawText.trim() : "";

      const normKnownGender = (g) => {
        const s = String(g || "").trim().toLowerCase();
        if (s === "female" || s === "f" || s === "ស្រី" || s === "girl" || s === "woman") return "female";
        if (s === "male" || s === "m" || s === "ប្រុស" || s === "boy" || s === "man") return "male";
        return "";
      };
      const segSpeakerName = String(segment.speaker || segment.speakerName || "").trim();
      const segGender =
        normKnownGender(segment.voiceGender) ||
        normKnownGender(segment.gender) ||
        normKnownGender(segment.speakerGender) ||
        normKnownGender(detectSpeakerGender(segSpeakerName, "", segment.khmer || segment.khmerText)) ||
        "unknown";
      const requestedVoice = rawBodyVoiceId || null;
      const isSegManual = Boolean(segment.userOverridden || segment.voiceAssignmentSource === "manual" || segment.voiceOverride);
      const isManual = Boolean(req.body.forceVoice || requestedVoice || isSegManual);
      const derivedGenderVoice = segGender === "female"
        ? "km-KH-SreymomNeural"
        : (segGender === "male" ? "km-KH-PisethNeural" : null);
      const targetVoice = requestedVoice
        ? validateVoiceId(requestedVoice)
        : (isSegManual
            ? validateVoiceId(segment.voiceOverride || segment.khmerVoiceId || segment.voiceId || segment.voice || derivedGenderVoice || "km-KH-PisethNeural")
            : validateVoiceId(derivedGenderVoice || segment.khmerVoiceId || segment.voice || segment.voiceId || "km-KH-PisethNeural"));

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
      const segHadNonDefaultSpeed = Boolean(speedToEdgeRate(segOwnRawSpeed).isCustomNonDefault);
      const hasExplicitUserSpeed = rawBodyUserCustomSpeed !== undefined
        ? Boolean(rawBodyUserCustomSpeed)
        : (hasBodySpeed || hasBodyRate
          ? Boolean(speedInfo.isCustomNonDefault || (segment.userCustomSpeed && !segHadNonDefaultSpeed))
          : Boolean(speedInfo.isCustomNonDefault || segment.userCustomSpeed));
      const resolvedSegSpeed = (speedInfo.valid && speedInfo.provided)
        ? (typeof speedInfo.requested === "string" && speedInfo.requested.trim().toLowerCase() === "normal"
          ? "normal"
          : (speedInfo.numericSpeed ?? 1.0))
        : (segment.speed ?? "normal");

      // Protect split sibling audio files from prior-file cleanup if any other segment still points to the same file
      const singleSharedAudioPaths = new Set();
      try {
        let peerSegments = Array.isArray(req.body.allSegments) ? req.body.allSegments : null;
        if (!peerSegments && isEpisode && cleanSeries && cleanEpisode) {
          const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
          if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
            const ep = (meta.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
            if (Array.isArray(ep?.scriptData?.segments)) peerSegments = ep.scriptData.segments;
          }
        }
        if (peerSegments) {
          for (const peer of peerSegments) {
            if (!peer || String(peer.id) === String(segment.id)) continue;
            const peerPath = resolvePriorSegmentAudioPath(peer, audioDir);
            if (peerPath) singleSharedAudioPaths.add(path.resolve(peerPath));
          }
        }
      } catch (_) {}

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
          sharedAudioPaths: singleSharedAudioPaths,
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

      // Persist updated single segment into series.json immediately under per-series mutex
      if (isEpisode && cleanSeries && cleanEpisode) {
        try {
          const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
          await withSeriesMetadataLock(cleanSeries, () => {
            if (!fs.existsSync(metaPath)) return;
            updateSeriesMetadata(cleanSeries, (seriesMeta) => {
              const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
              if (!targetEp || !targetEp.scriptData || !Array.isArray(targetEp.scriptData.segments)) {
                return false;
              }
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
              targetEp.scriptData.updatedAt = Date.now();
              if (fullAudioUrl) {
                targetEp.fullAudioUrl = fullAudioUrl;
                const hasRemainingOutdatedSpoken = targetEp.scriptData.segments.some((s) => {
                  const txt = String(s?.khmer || s?.khmerText || s?.khmerTranslatedText || s?.text || "").trim();
                  return Boolean(txt) && s?.ttsStatus !== "empty_text" && !isPlaceholderOrEmptyTtsText(txt) && Boolean(s?.audioOutdated || s?.ttsStatus === "outdated");
                });
                if (!hasRemainingOutdatedSpoken) {
                  targetEp.audioOutdated = false;
                }
              }
              targetEp.audioGenerated = true;
              targetEp.hasAudio = true;
              return true;
            });
          });
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
        return typeof raw === "string" && !isPlaceholderOrEmptyTtsText(raw);
      });

      if (!hasAnyText) {
        console.warn(`[TTS] Batch audio request has 0 segments with real Khmer text (${segments.length} segments skipped).`);
        return res.json({
          success: true,
          projectName: cleanSeries,
          seriesId: cleanSeries,
          episodeId: cleanEpisode,
          voiceId: rawBodyVoiceId || "km-KH-PisethNeural",
          speed,
          fullAudioUrl: null,
          fullAudioPath: null,
          segments: segments.map((s) => ({
            ...s,
            audioUrl: null,
            audioPath: null,
            audioFile: null,
            ttsStatus: "empty_text",
            audioGenerated: false,
            audioOutdated: true,
          })),
          skippedEmptyCount: segments.length,
          validCount: 0,
          summaryMessage: `រំលង ${segments.length} ឃ្លា (គ្មានអត្ថបទ)`,
        });
      }

      const batchRequestedSpeed = hasBodyRate ? rawBodyRate : (hasBodySpeed ? rawBodySpeed : undefined);
      const batchSpeedInfo = speedToEdgeRate(batchRequestedSpeed);
      if (batchSpeedInfo.provided && !batchSpeedInfo.valid) {
        console.warn(`[TTS] ⚠️ Route /generate-audio batch requested speed ${JSON.stringify(batchSpeedInfo.requested)} cannot be applied (${batchSpeedInfo.reason})`);
      }
      const batchExplicitCustom = Boolean(rawBodyUserCustomSpeed) || batchSpeedInfo.isCustomNonDefault;

      // Fast Path: If master narration audio already exists, all valid segments have ready files on disk,
      // and forceRegen is false, return immediately without re-rendering any TTS clips.
      const needsAnySegmentWork = segments.some((s) =>
        doesSegmentNeedTts(s, audioDir, batchSpeedInfo, batchExplicitCustom)
      );
      if (!forceRegen && !needsAnySegmentWork && fs.existsSync(fullAudioPath) && fs.statSync(fullAudioPath).size > 1000) {
        const relAudioUrl = isEpisode
          ? `/uploads/projects/${cleanSeries}/episodes/${cleanEpisode}/audio/${fullAudioFilename}`
          : `/uploads/projects/${cleanName}/audio/${fullAudioFilename}`;
        console.log(`[TTS] Master narration & all segment audio already exist for ${cleanEpisode || cleanName} (${fs.statSync(fullAudioPath).size} bytes). Skipping duplicate generation.`);
        if (isEpisode && cleanSeries && cleanEpisode) {
          try {
            const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
            await withSeriesMetadataLock(cleanSeries, () => {
              if (!fs.existsSync(metaPath)) return;
              updateSeriesMetadata(cleanSeries, (seriesMeta) => {
                const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
                if (!targetEp || (targetEp.audioGenerated && targetEp.fullAudioUrl && !targetEp.audioOutdated)) return false;
                targetEp.audioGenerated = true;
                targetEp.audioOutdated = false;
                targetEp.fullAudioUrl = relAudioUrl;
                targetEp.fullAudioPath = fullAudioPath;
                targetEp.hasAudio = true;
                return true;
              });
            });
          } catch (_) {}
        }
        const uploadsRoot = path.resolve(__dirname, "..", "uploads");
        const mappedSegments = segments.map((s) => {
          const raw = s.khmer || s.khmerText || s.khmerTranslatedText || s.text || "";
          if (!raw.trim() || s.ttsStatus === "empty_text" || isPlaceholderOrEmptyTtsText(raw)) {
            return {
              ...s,
              audioUrl: null,
              audioPath: null,
              audioFile: null,
              ttsStatus: "empty_text",
              audioGenerated: false,
              audioOutdated: true,
            };
          }
          const verifiedPath = resolvePriorSegmentAudioPath(s, audioDir);
          if (verifiedPath && (!s.audioPath || !s.audioFile)) {
            const relSeg = path.relative(uploadsRoot, verifiedPath).replace(/\\/g, "/");
            return {
              ...s,
              audioPath: s.audioPath || verifiedPath,
              audioFile: s.audioFile || path.basename(verifiedPath),
              audioUrl: s.audioUrl || `/uploads/${relSeg}`,
              ttsStatus: "ready",
            };
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
          voiceId: rawBodyVoiceId || "km-KH-PisethNeural",
          speed,
          fullAudioUrl: relAudioUrl,
          fullAudioPath,
          segments: mappedSegments,
          skippedEmptyCount,
          validCount,
          summaryMessage: skippedEmptyCount > 0 ? `✅ សំឡេងខ្មែរមានរួចរាល់ ${validCount} ឃ្លា (រក្សាទុកដើម, រំលង ${skippedEmptyCount} ឃ្លា គ្មានអត្ថបទ)` : `✅ សំឡេងខ្មែរមានរួចរាល់ ${validCount} ឃ្លា (រក្សាទុកដើម)`,
        });
      }

      const batchKey = cleanEpisode ? `${cleanSeries}:${cleanEpisode}` : cleanSeries;
      console.log(`[TTS] Batch generating audio for ${segments.length} segments in ${cleanSeries}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""} (forceRegen=${Boolean(forceRegen)}, batchSpeed=${batchRequestedSpeed ?? "default"}, batchRate=${batchSpeedInfo.valid ? batchSpeedInfo.rate : "INVALID"})...`);
      let updatedSegments;
      let narrationSynced = false;
      try {
        activeBatchStages.set(batchKey, { stage: "synthesizing", total: segments.length });
        updatedSegments = await generateBatchSegmentsAudio(segments, audioDir, {
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

        // Save updated segments to series.json IMMEDIATELY under per-series mutex so individual segment playback and inspector work!
        if (isEpisode && cleanSeries && cleanEpisode) {
          try {
            const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
            await withSeriesMetadataLock(cleanSeries, () => {
              if (!fs.existsSync(metaPath)) return;
              updateSeriesMetadata(cleanSeries, (seriesMeta) => {
                const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
                if (!targetEp) return false;
                if (!targetEp.scriptData) targetEp.scriptData = {};
                if (Array.isArray(targetEp.scriptData.segments) && targetEp.scriptData.segments.length > updatedSegments.length) {
                  const updatedMap = new Map(updatedSegments.map((s) => [String(s.id ?? s.index), s]));
                  targetEp.scriptData.segments = targetEp.scriptData.segments.map((s) => updatedMap.get(String(s.id ?? s.index)) || s);
                } else {
                  targetEp.scriptData.segments = updatedSegments;
                }
                targetEp.scriptData.hasScript = targetEp.scriptData.segments.length > 0;
                targetEp.scriptData.totalSegments = targetEp.scriptData.segments.length;
                targetEp.scriptData.updatedAt = Date.now();
                targetEp.audioGenerated = true;
                targetEp.hasAudio = true;
                console.log(`[TTS] Immediately persisted ${targetEp.scriptData.segments.length} segments with audio to series.json for episode ${cleanEpisode}`);
                return true;
              });
            });
          } catch (saveErr) {
            console.warn("[TTS] Error saving updated segments to series.json:", saveErr.message);
          }
        }

        const syncSegments = updatedSegments
          .filter((s) => s.audioPath && s.ttsStatus !== "empty_text" && fs.existsSync(s.audioPath))
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
          activeBatchStages.set(batchKey, { stage: "syncing", total: segments.length });
          try {
            await createSynchronizedNarrationAudio(syncSegments, fullAudioPath);
            narrationSynced = fs.existsSync(fullAudioPath);
          } catch (syncErr) {
            console.warn("[TTS] Could not build master narration audio:", syncErr.message);
          }
        }
      } finally {
        activeBatchStages.delete(batchKey);
      }

      const relAudioUrl = isEpisode
        ? `/uploads/projects/${cleanSeries}/episodes/${cleanEpisode}/audio/${fullAudioFilename}`
        : `/uploads/projects/${cleanName}/audio/${fullAudioFilename}`;

      // Auto-persist audio status in series.json under per-series mutex for episode isolation
      if (isEpisode && cleanSeries && cleanEpisode) {
        try {
          const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
          await withSeriesMetadataLock(cleanSeries, () => {
            if (!fs.existsSync(metaPath)) return;
            updateSeriesMetadata(cleanSeries, (seriesMeta) => {
              const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
              if (!targetEp) return false;
              targetEp.audioGenerated = true;
              targetEp.hasAudio = true;
              if (fs.existsSync(fullAudioPath)) {
                targetEp.fullAudioUrl = relAudioUrl;
                targetEp.fullAudioPath = fullAudioPath;
              }
              const hasRemainingOutdatedSpoken = Array.isArray(targetEp.scriptData?.segments) &&
                targetEp.scriptData.segments.some((s) => {
                  const txt = String(s?.khmer || s?.khmerText || s?.khmerTranslatedText || s?.text || "").trim();
                  return Boolean(txt) && s?.ttsStatus !== "empty_text" && !isPlaceholderOrEmptyTtsText(txt) && Boolean(s?.audioOutdated || s?.ttsStatus === "outdated");
                });
              if (narrationSynced && !hasRemainingOutdatedSpoken) {
                targetEp.audioOutdated = false;
              }
              console.log(`[TTS] Auto-persisted audioGenerated=true (audioOutdated=${Boolean(targetEp.audioOutdated)}) in series.json for episode ${cleanEpisode}`);
              return true;
            });
          });
        } catch (saveErr) {
          console.warn("[TTS] Could not persist audio status in series.json:", saveErr.message);
        }
      }

      const skippedEmptyCount = updatedSegments.filter(
        (s) => s.ttsStatus === 'empty_text' || isPlaceholderOrEmptyTtsText(s.khmer || s.khmerText || s.khmerTranslatedText || s.text || '')
      ).length;
      const validGeneratedCount = updatedSegments.length - skippedEmptyCount;
      const summaryMessage = skippedEmptyCount > 0
        ? `ជោគជ័យ ${validGeneratedCount} ឃ្លា (រំលង ${skippedEmptyCount} ឃ្លា គ្មានអត្ថបទ)`
        : `ជោគជ័យ ${validGeneratedCount} ឃ្លា (100%)`;

      return res.json({
        success: true,
        projectName: cleanSeries,
        seriesId: cleanSeries,
        episodeId: cleanEpisode,
        voiceId: rawBodyVoiceId || "km-KH-PisethNeural",
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

    // Auto-persist Clean BGM into series.json under per-series mutex for episode tracking
    try {
      const match = inputVideoPath.match(/projects[/\\]([^/\\]+)[/\\]episodes[/\\]([^/\\]+)/);
      const pSeriesId = (match && match[1]) || req.body.seriesId;
      const pEpisodeId = (match && match[2]) || req.body.episodeId;
      if (pSeriesId && pEpisodeId) {
        const cleanPSeries = sanitizeProjectName(pSeriesId);
        const cleanPEp = sanitizeEpisodeId(pEpisodeId);
        const metaPath = path.join(uploadsDir, "projects", cleanPSeries, "series.json");
        await withSeriesMetadataLock(cleanPSeries, () => {
          if (!fs.existsSync(metaPath)) return;
          updateSeriesMetadata(cleanPSeries, (sMeta) => {
            const targetEp = (sMeta?.episodes || []).find(
              (e) => sanitizeEpisodeId(e.id) === cleanPEp || String(e.id) === String(pEpisodeId)
            );
            if (!targetEp) return false;
            targetEp.bgmAudioUrl = noVocalsUrl;
            targetEp.cleanBgmPath = sepRes.noVocalsPath;
            targetEp.isDemucsDone = true;
            targetEp.hasDemucs = true;
            console.log(`[AudioSeparation] ✅ Auto-persisted clean BGM into series.json for episode ${cleanPEp}`);
            return true;
          });
        });
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
      logs: progressData?.logs || [],
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

/**
 * 7. Auto-Fit Speech Speed (1.05x - 1.50x)
 * Speeds up overflowing / red / trimmed segments so they fit their subtitle slot without cutting off words.
 */
router.post(["/audio/autofit-speed", "/autofit-speed"], async (req, res) => {
  const {
    seriesId,
    episodeId,
    maxSpeed = 1.50,
    targetSegmentIds = null,
    segments: clientSegments = null,
  } = req.body;

  const progressKey = `${seriesId}:${episodeId}`;

  try {
    if (!seriesId) {
      return res.status(400).json({ success: false, error: "seriesId is required" });
    }

    const seriesMetaPath = path.join(uploadsDir, "projects", seriesId, "series.json");
    if (!fs.existsSync(seriesMetaPath)) {
      return res.status(404).json({ success: false, error: `Series not found: ${seriesId}` });
    }

    let seriesData = JSON.parse(fs.readFileSync(seriesMetaPath, "utf8"));
    const episodes = seriesData.episodes || [];
    const epIndex = episodes.findIndex((e) => String(e.id) === String(episodeId) || Number(e.episodeNumber) === Number(episodeId));
    if (epIndex === -1) {
      return res.status(404).json({ success: false, error: `Episode not found: ${episodeId}` });
    }

    const ep = episodes[epIndex];
    let segments = clientSegments && Array.isArray(clientSegments) && clientSegments.length > 0
      ? clientSegments
      : (ep.scriptData?.segments || []);

    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ success: false, error: "No segments found to auto-fit" });
    }

    const initialLogs = [
      {
        time: new Date().toLocaleTimeString(),
        message: `⚡ [EP${ep.episodeNumber || ep.id}] ចាប់ផ្តើមវិភាគសំឡេងដែលវែងលើស (${segments.length} segments)...`,
      },
    ];

    autoFitProgressMap.set(progressKey, {
      status: 'running',
      progress: 5,
      current: 0,
      total: segments.length,
      fittedCount: 0,
      message: `កំពុងវិភាគសំឡេង ${segments.length} ឃ្លា...`,
      logs: initialLogs,
    });

    const targetSet = Array.isArray(targetSegmentIds) && targetSegmentIds.length > 0
      ? new Set(targetSegmentIds.map(String))
      : null;

    let fittedCount = 0;
    const updatedSegments = [...segments];

    for (let i = 0; i < updatedSegments.length; i++) {
      const seg = { ...updatedSegments[i] };
      if (targetSet && !targetSet.has(String(seg.id ?? i))) {
        continue;
      }

      // Check audio file existence
      const resolvedAudio = resolveMediaFile(seg.audioFile || seg.audioPath || (seg.audioUrl ? path.basename(seg.audioUrl) : null));
      if (!resolvedAudio || !fs.existsSync(resolvedAudio)) {
        continue;
      }

      const slotStart = typeof seg.startSec === "number" ? seg.startSec : parseTimeToSec(seg.start, i * 4);
      const slotEnd = typeof seg.endSec === "number" ? seg.endSec : parseTimeToSec(seg.end, slotStart + 2.5);
      const slotDur = Math.max(0.2, slotEnd - slotStart);

      const currentDur = await getMediaDuration(resolvedAudio);
      if (!currentDur || currentDur <= 0) continue;

      const overSec = currentDur - slotDur;
      const isRedOrTrimmed = overSec >= 0.10 || Boolean(seg.audioTrimmed);

      if (isRedOrTrimmed) {
        // Target slot duration with safe margin (e.g. 50ms)
        const safeTarget = Math.max(0.25, parseFloat((slotDur - 0.05).toFixed(3)));
        const ratio = currentDur / safeTarget;
        const speedToApply = Math.min(Number(maxSpeed || 1.50), Math.max(1.05, ratio));

        try {
          const stretchRes = await autoStretchTtsAudio({
            inputAudioPath: resolvedAudio,
            targetDuration: safeTarget,
            maxSpeed: speedToApply,
            minSpeed: 1.0,
            allowSlowdown: false,
          });

          const newDur = stretchRes.finalDuration;
          seg.audioDurationSec = newDur;
          seg.audioDuration = newDur;
          seg.finalAudioDuration = newDur;
          seg.rawAudioDur = newDur;
          seg.originalAudioDuration = newDur;
          seg.audioStartSec = slotStart;
          seg.audioEndSec = parseFloat((slotStart + newDur).toFixed(2));
          seg.audioTrimmed = false;
          seg.userTrimmed = false;
          seg.speed = parseFloat(stretchRes.appliedSpeed.toFixed(2));
          seg.appliedSpeed = parseFloat(stretchRes.appliedSpeed.toFixed(2));
          seg.userCustomSpeed = false;
          seg.audioOutdated = false;

          updatedSegments[i] = seg;
          fittedCount++;

          const pEntry = autoFitProgressMap.get(progressKey);
          if (pEntry) {
            pEntry.current = i + 1;
            pEntry.fittedCount = fittedCount;
            pEntry.progress = Math.min(85, Math.round(((i + 1) / segments.length) * 80) + 5);
            pEntry.message = `⚡ Auto-Stretch Seg #${seg.id ?? (i + 1)} (${fittedCount} ឃ្លា fit)...`;
            pEntry.logs.push({
              time: new Date().toLocaleTimeString(),
              message: `⚡ Auto-Stretch: ${currentDur.toFixed(2)}s ➔ ${newDur.toFixed(2)}s (Target: ${safeTarget.toFixed(2)}s | Speed: ${stretchRes.appliedSpeed.toFixed(2)}x)`,
            });
            if (pEntry.logs.length > 50) pEntry.logs.shift();
          }
        } catch (stretchErr) {
          console.warn(`[Auto-Fit Speed] Failed to stretch segment #${seg.id}: ${stretchErr.message}`);
          const pEntry = autoFitProgressMap.get(progressKey);
          if (pEntry) {
            pEntry.logs.push({
              time: new Date().toLocaleTimeString(),
              message: `⚠️ Stretch warning Seg #${seg.id ?? (i + 1)}: ${stretchErr.message}`,
            });
          }
        }
      } else {
        if (typeof seg.audioStartSec !== "number" || isNaN(seg.audioStartSec)) {
          seg.audioStartSec = slotStart;
          seg.audioEndSec = parseFloat((slotStart + currentDur).toFixed(2));
          updatedSegments[i] = seg;
        }
      }
    }

    ep.autoFitted = true;
    if (ep.scriptData) {
      ep.scriptData.autoFitted = true;
      ep.scriptData.segments = updatedSegments;
      ep.scriptData.updatedAt = Date.now();
    }
    episodes[epIndex] = ep;
    seriesData.episodes = episodes;
    fs.writeFileSync(seriesMetaPath, JSON.stringify(seriesData, null, 2), "utf8");

    if (fittedCount > 0) {
      const pEntry = autoFitProgressMap.get(progressKey);
      if (pEntry) {
        pEntry.progress = 90;
        pEntry.message = `កំពុង Sync Master Narration...`;
        pEntry.logs.push({
          time: new Date().toLocaleTimeString(),
          message: `🎙️ Hierarchical Audio Sync: Dividing ${updatedSegments.length} segments into batches of 40...`,
        });
      }

      // Re-sync master narration audio
      try {
        const { audioDir, cleanSeries, cleanEpisode, isEpisode } = ensureProjectDirs(seriesId, episodeId, seriesId);
        const fullAudioFilename = isEpisode ? `${cleanEpisode}_narration_khmer.mp3` : `${cleanSeries}_narration_khmer.mp3`;
        const fullAudioPath = path.join(audioDir, fullAudioFilename);

        const syncSegs = updatedSegments
          .filter((s) => !s.muted && !s.isMuted)
          .map((s) => {
            const foundPath = resolveMediaFile(s.audioFile || s.audioPath || (s.audioUrl ? path.basename(s.audioUrl) : null));
            if (!foundPath || !fs.existsSync(foundPath)) return null;
            return {
              ...s,
              audioPath: foundPath,
              audioStartSec: typeof s.audioStartSec === "number" ? s.audioStartSec : s.startSec,
              startSec: typeof s.startSec === "number" ? s.startSec : s.audioStartSec,
              audioEndSec: s.audioEndSec,
              audioDurationSec: s.audioDurationSec,
              audioOffset: 0,
              audioTrimmed: false,
            };
          })
          .filter(Boolean);

        if (syncSegs.length > 0) {
          await createSynchronizedNarrationAudio(syncSegs, fullAudioPath);
          const pEntrySync = autoFitProgressMap.get(progressKey);
          if (pEntrySync) {
            pEntrySync.logs.push({
              time: new Date().toLocaleTimeString(),
              message: `🎙️ Master Narration បាន Sync រួចរាល់ (${syncSegs.length} segments via batches)`,
            });
          }
        }
      } catch (syncErr) {
        console.warn(`[Auto-Fit Speed] Notice re-syncing master narration: ${syncErr.message}`);
      }
    } else {
      episodes[epIndex] = ep;
      seriesData.episodes = episodes;
      fs.writeFileSync(seriesMetaPath, JSON.stringify(seriesData, null, 2), "utf8");
    }

    const finalLogs = autoFitProgressMap.get(progressKey)?.logs || [];
    finalLogs.push({
      time: new Date().toLocaleTimeString(),
      message: `✅ Auto-Fit Speed ជោគជ័យ: បានពន្លឿន ${fittedCount} ឃ្លា ឱ្យ Fit ស្មើនឹង Subtitle ១០០%`,
    });

    autoFitProgressMap.set(progressKey, {
      status: 'completed',
      progress: 100,
      current: segments.length,
      total: segments.length,
      fittedCount,
      message: `✅ Auto-Fit រួចរាល់: បានពន្លឿន ${fittedCount} ឃ្លា`,
      logs: finalLogs,
    });

    return res.json({
      success: true,
      fittedCount,
      totalCount: segments.length,
      segments: updatedSegments,
      logs: finalLogs,
      message: `⚡ បានពន្លឿន ${fittedCount} ឃ្លា (1.05x - ${maxSpeed}x) ឱ្យនិយាយទាន់ និងចប់គ្រប់អក្សរដោយជោគជ័យ!`
    });
  } catch (error) {
    console.error("[Auto-Fit Speed] Error:", error);
    const pEntryErr = autoFitProgressMap.get(progressKey);
    if (pEntryErr) {
      pEntryErr.status = 'error';
      pEntryErr.error = error.message;
      pEntryErr.logs.push({
        time: new Date().toLocaleTimeString(),
        message: `❌ បរាជ័យ: ${error.message}`,
      });
    }
    return res.status(500).json({ success: false, error: error.message || "Failed to auto-fit speed" });
  }
});

/**
 * 7B. Auto-Fit Real-time Progress & Console Logs Endpoint
 */
router.get(["/audio/autofit-progress", "/autofit-progress"], (req, res) => {
  try {
    const { seriesId, episodeId } = req.query;
    const key = `${seriesId}:${episodeId}`;
    const entry = autoFitProgressMap.get(key) || {
      status: 'idle',
      progress: 0,
      current: 0,
      total: 0,
      fittedCount: 0,
      message: '',
      logs: [],
    };
    return res.json({ success: true, ...entry });
  } catch (err) {
    return res.json({ success: true, status: 'idle', progress: 0, logs: [] });
  }
});

module.exports = router;

