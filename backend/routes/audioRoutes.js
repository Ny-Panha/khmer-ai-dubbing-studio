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
  computeSegmentAudioSignature,
  computeMasterAudioSignature,
  PROVENANCE_VERSION,
  computeTextSha256,
  buildEffectConfigKey,
  writeAudioProvenance,
  verifyAudioFileProvenance,
} = require("../services/ttsService");
const { detectSpeakerGender } = require("../models/speakerRegistry");
const { createSynchronizedNarrationAudio, parseTimeToSec, autoStretchTtsAudio, getMediaDuration } = require("../services/ffmpegService");
const audioSeparationService = require("../services/audioSeparationService");
const { withSeriesMetadataLock, updateSeriesMetadata } = require("../services/episodeService");
const { getGeminiClient } = require("../services/geminiService");
const {
  findOverflowShortenCandidates,
  autoShortenOverflowingSegments,
} = require("../services/pipeline/stages/stage9_generateSegmentTTS");

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

function isSpokenSegment(seg) {
  if (!seg || typeof seg !== "object") return false;
  if (seg.ttsStatus === "empty_text") return false;
  const raw = seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || "";
  return Boolean(typeof raw === "string" && raw.trim() && cleanTextForTts(raw) && !isPlaceholderOrEmptyTtsText(raw));
}

function doesSegmentNeedTts(seg, audioDir, batchSpeedInfo = null, batchExplicitCustom = false) {
  if (!seg || typeof seg !== "object") return false;
  if (seg.ttsStatus === "empty_text") return false;
  const raw = seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || "";
  if (typeof raw !== "string" || !raw.trim() || !cleanTextForTts(raw) || isPlaceholderOrEmptyTtsText(raw)) return false;

  // Support caller passing boolean isForce / forceRegen as 2nd arg: doesSegmentNeedTts(seg, isForce, voiceId)
  if (typeof audioDir === 'boolean') {
    if (audioDir) return true; // forceRegen is true
    audioDir = (typeof batchSpeedInfo === 'string' && batchSpeedInfo.includes(path.sep)) ? batchSpeedInfo : path.dirname(seg?.audioPath || '');
  }

  if (seg.audioOutdated || seg.force || seg.forceRegen) return true;
  if (seg.ttsStatus === "pending" || seg.ttsStatus === "error" || seg.status === "tts_error") return true;

  const existingPath = resolvePriorSegmentAudioPath(seg, typeof audioDir === 'string' ? audioDir : '');
  if (!existingPath) return true;

  // Verify physical file validity (size >= 500 bytes)
  try {
    const stat = fs.statSync(existingPath);
    if (stat.size < 500) return true;
  } catch (_) {
    return true;
  }

  // Smart TTS Cache v2: verify content signature
  const targetVoice = seg.voiceId || seg.khmerVoiceId || "km-KH-PisethNeural";
  const currentSig = computeSegmentAudioSignature(raw, targetVoice, seg.speed ?? seg.rate, seg.pitch);
  if (seg.rawVoiceId && seg.rawVoiceId !== targetVoice) {
    return true;
  }
  if (seg.actualVoiceId && seg.actualVoiceId !== targetVoice) {
    return true;
  }
  const deliveryType = seg.deliveryType || "out_loud";
  const audioEffect = seg.audioEffect || (deliveryType === "inner_thought" ? "inner_thought_reverb" : "none");
  const effectConfigKey = buildEffectConfigKey(deliveryType, audioEffect, seg.effectConfig || null);
  const textHash = computeTextSha256(raw);
  const ownSpeedInfo = speedToEdgeRate(seg.speed ?? seg.rate);
  const expectedOrigSpeed = Number(ownSpeedInfo.numericSpeed ?? 1.0);

  if (seg.audioSignature) {
    if (seg.audioSignature !== currentSig) {
      return true;
    }
    // Even if signature matches on segment object, verify sidecar provenance if a sidecar exists (or is legacy contaminated)
    const sidecarPath = existingPath.replace(/\.[^.]+$/, ".json");
    if (fs.existsSync(sidecarPath)) {
      const prov = verifyAudioFileProvenance(
        existingPath,
        {
          voiceId: targetVoice,
          textHash,
          pitch: String(seg.pitch || "+0Hz"),
          deliveryType,
          effectConfigKey,
          originalSpeed: expectedOrigSpeed,
        },
        { uploadsDir: typeof audioDir === "string" ? audioDir : undefined }
      );
      if (!prov.valid && !prov.isLegacy) {
        return true;
      }
      if (prov.isLegacy) {
        try {
          const legacyMeta = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
          if (legacyMeta?.voiceId && legacyMeta.voiceId !== targetVoice) return true;
        } catch (_) {
          return true;
        }
      }
    }
  } else {
    const prov = verifyAudioFileProvenance(
      existingPath,
      {
        voiceId: targetVoice,
        textHash,
        pitch: String(seg.pitch || "+0Hz"),
        deliveryType,
        effectConfigKey,
        originalSpeed: expectedOrigSpeed,
      },
      { uploadsDir: typeof audioDir === "string" ? audioDir : undefined }
    );
    if (prov.valid) {
      seg.audioSignature = currentSig;
    } else {
      return true; // Missing signature and no verified provenance -> MUST re-synthesize!
    }
  }

  const ownInfo = speedToEdgeRate(seg.speed ?? seg.rate);
  if ((seg.userCustomSpeed || ownInfo.isCustomNonDefault) && seg.ttsRate && ownInfo.valid && seg.ttsRate !== ownInfo.rate) {
    return true;
  }
  if (!seg.userCustomSpeed && batchExplicitCustom && batchSpeedInfo?.valid && seg.ttsRate && seg.ttsRate !== batchSpeedInfo.rate) {
    return true;
  }

  if (seg.voiceId && !seg.audioSignature) {
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
      const isStep1VerifiedAudio = Boolean(
        segment.speakerStatus === "verified" ||
        segment.speakerVerified === true ||
        segment.voiceAssignmentSource === "multimodal_verified" ||
        segment.voiceAssignmentSource === "series_glossary"
      );
      const segGender =
        normKnownGender(segment.voiceGender) ||
        normKnownGender(segment.gender) ||
        normKnownGender(segment.speakerGender) ||
        (isStep1VerifiedAudio ? "" : normKnownGender(detectSpeakerGender(segSpeakerName, "", ""))) ||
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

      // Protect split sibling audio files from prior-file cleanup if any other segment still points to the same file.
      // Fast path: when caller passes skipPeerDiskScan + sharedAudioFiles (computed in-memory), skip pre-TTS 17MB series.json disk scan.
      const singleSharedAudioPaths = new Set();
      try {
        if (req.body.skipPeerDiskScan) {
          const sharedList = Array.isArray(req.body.sharedAudioFiles) ? req.body.sharedAudioFiles : [];
          for (const ref of sharedList) {
            const peerPath = resolvePriorSegmentAudioPath({ audioPath: ref, audioFile: ref, audioUrl: ref }, audioDir);
            if (peerPath) singleSharedAudioPaths.add(path.resolve(peerPath));
          }
        } else {
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
        }
      } catch (_) {}

      const resolvedGender = segGender !== "unknown" ? segGender : (segment.voiceGender || segment.gender || "unknown");
      const resolvedSpeakerGender = resolvedGender === "female" ? "FEMALE" : (resolvedGender === "male" ? "MALE" : "UNKNOWN");
      const isFemaleVoice = targetVoice.includes("Sreymom");
      const isUnknownVoice = resolvedGender === "unknown" && !isManual;
      const resolvedVoiceMeta = {
        voice: targetVoice,
        voiceId: targetVoice,
        khmerVoiceId: targetVoice,
        gender: resolvedGender,
        voiceGender: resolvedGender,
        speakerGender: resolvedSpeakerGender,
        voiceLabel: isFemaleVoice ? "ស្រីមុំ (Sreymom)" : (isUnknownVoice ? "ពិសិដ្ឋ (Piseth - Fallback)" : "ពិសិដ្ឋ (Piseth)"),
        avatar: isFemaleVoice ? "👩" : (isUnknownVoice ? "👤" : "👨"),
        badgeColor: isFemaleVoice ? "#ec4899" : (isUnknownVoice ? "#64748b" : "#38bdf8"),
        voiceAssignmentSource: isManual ? "manual" : (isUnknownVoice ? "fallback" : (segment.voiceAssignmentSource || "automatic")),
        userOverridden: isManual ? true : Boolean(segment.userOverridden),
        isFallback: isUnknownVoice,
        reviewNeeded: isUnknownVoice || Boolean(segment.reviewNeeded),
      };

      // Persist manual voice assignment immediately in parallel with Edge TTS so a mid-generation
      // reload preserves the chosen voice without adding any latency to TTS synthesis!
      let prePersistPromise = Promise.resolve();
      if (isEpisode && cleanSeries && cleanEpisode && isManual) {
        const metaPathPre = path.join(uploadsDir, "projects", cleanSeries, "series.json");
        prePersistPromise = withSeriesMetadataLock(cleanSeries, () => {
          if (!fs.existsSync(metaPathPre)) return;
          updateSeriesMetadata(cleanSeries, (seriesMeta) => {
            const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
            if (!targetEp || !targetEp.scriptData || !Array.isArray(targetEp.scriptData.segments)) {
              return false;
            }
            const segIdx = targetEp.scriptData.segments.findIndex((s) => String(s.id) === String(segment.id));
            if (segIdx !== -1) {
              targetEp.scriptData.segments[segIdx] = {
                ...targetEp.scriptData.segments[segIdx],
                ...resolvedVoiceMeta,
                audioOutdated: true,
              };
            }
            if (req.body.speakerUpdate && req.body.speakerUpdate.key && req.body.speakerUpdate.entry) {
              const spkKey = String(req.body.speakerUpdate.key);
              targetEp.speakerRegistry = {
                ...(targetEp.speakerRegistry || {}),
                [spkKey]: {
                  ...((targetEp.speakerRegistry && targetEp.speakerRegistry[spkKey]) || {}),
                  ...req.body.speakerUpdate.entry,
                },
              };
            }
            targetEp.scriptData.updatedAt = Date.now();
            return true;
          });
        }).catch(() => {});
      }

      console.log(`[TTS] Regenerating single segment #${segment.id} [${deliveryType}] with voice ${targetVoice}, rate=${resolvedRate} (requestedSpeed=${requestedSpeedRaw ?? "default"}, userCustomSpeed=${hasExplicitUserSpeed})${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""}...`);
      const updatedSegment = await generateSingleSegmentAudio(
        {
          ...segment,
          ...resolvedVoiceMeta,
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
          ...(req.body.preserveTrim !== undefined ? { preserveTrim: Boolean(req.body.preserveTrim) } : {}),
          episodeId: cleanEpisode,
          sharedAudioPaths: singleSharedAudioPaths,
          ...(speedInfo.provided && !speedInfo.valid ? { _suppressInvalidSpeedLog: true } : {}),
        }
      );

      const rawSingleTxt = updatedSegment.khmer || updatedSegment.khmerText || updatedSegment.khmerTranslatedText || updatedSegment.text || "";
      const singleSig = computeSegmentAudioSignature(rawSingleTxt, targetVoice, updatedSegment.speed ?? updatedSegment.rate, updatedSegment.pitch);
      updatedSegment.audioSignature = singleSig;

      if (
        updatedSegment.voiceMismatch ||
        updatedSegment.ttsStatus !== "ready" ||
        (updatedSegment.actualVoiceId && updatedSegment.actualVoiceId !== targetVoice)
      ) {
        return res.status(502).json({
          success: false,
          code: "VOICE_MISMATCH",
          voiceMismatch: true,
          requestedVoiceId: targetVoice,
          actualVoiceId: updatedSegment.actualVoiceId || null,
          error: updatedSegment.error || `Generated audio voice (${updatedSegment.actualVoiceId || "unknown"}) did not match requested voice (${targetVoice})`,
        });
      }

      if (updatedSegment.audioPath && fs.existsSync(updatedSegment.audioPath)) {
        try {
          const provCheck = verifyAudioFileProvenance(
            updatedSegment.audioPath,
            {
              voiceId: targetVoice,
              textHash: updatedSegment.textHash || computeTextSha256(rawSingleTxt),
              pitch: String(updatedSegment.pitch || "+0Hz"),
            },
            { uploadsDir: audioDir }
          );
          if (!provCheck.valid) {
            writeAudioProvenance(updatedSegment.audioPath, {
              voiceId: targetVoice,
              actualVoiceId: updatedSegment.actualVoiceId || targetVoice,
              rawVoiceId: updatedSegment.rawVoiceId || targetVoice,
              text: rawSingleTxt,
              textHash: updatedSegment.textHash || computeTextSha256(rawSingleTxt),
              pitch: String(updatedSegment.pitch || "+0Hz"),
              rate: updatedSegment.ttsRate || resolvedRate || "+0%",
              originalSpeed: Number(speedInfo.numericSpeed ?? 1.0),
              appliedSpeed: Number(updatedSegment.appliedSpeed ?? 1.0),
              speedCacheMode: hasExplicitUserSpeed ? "custom" : (autoStretch ? "fit" : "raw"),
              deliveryType,
              audioEffect,
              effectConfig,
              audioSignature: singleSig,
              audioDurationSec: updatedSegment.audioDurationSec || updatedSegment.duration,
            });
          }
        } catch (_) {}
      }

      await prePersistPromise;

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
                const existingSeg = targetEp.scriptData.segments[segIdx] || {};
                const preservedTrimmed = Boolean(updatedSegment.audioTrimmed || updatedSegment.userTrimmed);
                targetEp.scriptData.segments[segIdx] = {
                  ...existingSeg,
                  ...updatedSegment,
                  ...resolvedVoiceMeta,
                  audioOutdated: false,
                  textStatus: "ready",
                  audioOffset: updatedSegment.audioOffset ?? existingSeg.audioOffset ?? 0,
                  audioTrimmed: preservedTrimmed,
                  userTrimmed: preservedTrimmed,
                  audioTrimStartSec: updatedSegment.audioTrimStartSec ?? existingSeg.audioTrimStartSec,
                  audioTrimEndSec: updatedSegment.audioTrimEndSec ?? existingSeg.audioTrimEndSec,
                };
              }
              if (req.body.speakerUpdate && req.body.speakerUpdate.key && req.body.speakerUpdate.entry) {
                const spkKey = String(req.body.speakerUpdate.key);
                targetEp.speakerRegistry = {
                  ...(targetEp.speakerRegistry || {}),
                  [spkKey]: {
                    ...((targetEp.speakerRegistry && targetEp.speakerRegistry[spkKey]) || {}),
                    ...req.body.speakerUpdate.entry,
                  },
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
              } else {
                // Invalidate stale pre-mixed master narration so Export rebuilds fresh audio with this updated voice
                targetEp.fullAudioUrl = null;
                targetEp.fullAudioPath = null;
                const staleMasterName = isEpisode ? `${cleanEpisode}_narration_khmer.mp3` : `${cleanName}_narration_khmer.mp3`;
                const staleMasterPath = path.join(audioDir, staleMasterName);
                fs.promises.unlink(staleMasterPath).catch(() => {});
                fs.promises.unlink(`${staleMasterPath}.meta.json`).catch(() => {});
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
      // master audio content signature matches current timeline positions, and forceRegen is false,
      // return immediately without re-rendering any TTS clips or re-merging master narration.
      const needsAnySegmentWork = segments.some((s) =>
        doesSegmentNeedTts(s, audioDir, batchSpeedInfo, batchExplicitCustom)
      );

      const fastSyncSegments = segments
        .filter(isSpokenSegment)
        .map((s, idx) => {
          const verifiedPath = resolvePriorSegmentAudioPath(s, audioDir);
          return {
            ...s,
            audioPath: s.audioPath || verifiedPath,
            startSec: typeof s.audioStartSec === "number" && !isNaN(s.audioStartSec)
              ? s.audioStartSec
              : (typeof s.startSec === "number" && !isNaN(s.startSec)
                ? s.startSec
                : parseTimeToSec(s.start, idx * 4)),
          };
        });
      const sigPath = `${fullAudioPath}.sig`;
      const currentFastMasterSig = computeMasterAudioSignature(fastSyncSegments);
      let recordedMasterSig = fs.existsSync(sigPath) ? fs.readFileSync(sigPath, "utf8").trim() : null;
      if (!recordedMasterSig && isEpisode && cleanSeries && cleanEpisode) {
        try {
          const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
          if (fs.existsSync(metaPath)) {
            const seriesMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
            const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
            recordedMasterSig = targetEp?.masterAudioSignature || null;
          }
        } catch (_) {}
      }
      const isFastMasterSigValid = Boolean(currentFastMasterSig && recordedMasterSig && recordedMasterSig === currentFastMasterSig);

      if (!forceRegen && !needsAnySegmentWork && fs.existsSync(fullAudioPath) && fs.statSync(fullAudioPath).size > 1000 && isFastMasterSigValid) {
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
          const targetVoice = s.voiceId || s.khmerVoiceId || rawBodyVoiceId || "km-KH-PisethNeural";
          const sig = computeSegmentAudioSignature(raw, targetVoice, s.speed ?? s.rate, s.pitch);
          const verifiedPath = resolvePriorSegmentAudioPath(s, audioDir);
          if (verifiedPath && (!s.audioPath || !s.audioFile)) {
            const relSeg = path.relative(uploadsRoot, verifiedPath).replace(/\\/g, "/");
            return {
              ...s,
              audioPath: s.audioPath || verifiedPath,
              audioFile: s.audioFile || path.basename(verifiedPath),
              audioUrl: s.audioUrl || `/uploads/${relSeg}`,
              ttsStatus: "ready",
              audioSignature: sig,
            };
          }
          return {
            ...s,
            audioSignature: s.audioSignature || sig,
          };
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
          telemetry: {
            totalDurationMs: 0,
            masterAudioMergeMs: 0,
            totalSegmentsCount: segments.length,
            reusedSegmentsCount: validCount,
            synthesizedSegmentsCount: 0,
            failedCount: 0,
            skippedEmptyCount,
            masterAudioSignature: currentFastMasterSig,
            masterMergeSkipped: true,
          },
        });
      }

      const batchKey = cleanEpisode ? `${cleanSeries}:${cleanEpisode}` : cleanSeries;
      const batchStartTime = Date.now();
      let masterAudioMergeMs = 0;
      console.log(`[TTS] Batch generating audio for ${segments.length} segments in ${cleanSeries}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""} (forceRegen=${Boolean(forceRegen)}, batchSpeed=${batchRequestedSpeed ?? "default"}, batchRate=${batchSpeedInfo.valid ? batchSpeedInfo.rate : "INVALID"})...`);
      let updatedSegments;
      let narrationSynced = false;
      let failedSegments = [];
      let hasAnyFailures = false;
      let newlySynthesizedCount = 0;
      let reusedCount = 0;
      let currentMasterSig = null;
      try {
        activeBatchStages.set(batchKey, { stage: "synthesizing", total: segments.length });
        updatedSegments = await generateBatchSegmentsAudio(segments, audioDir, {
          concurrency: 4,
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

        // Post-TTS Auto-Shorten Pass: condense only segments still overflowing slot (>0.15s) or containing Hanzi leaks
        // Allows skipping Gemini AI auto-shorten for Zero-Gemini workflows (e.g. imported Khmer subtitles)
        const disableGeminiShorten =
          req.body.disableAiAutoShorten === true ||
          req.body.enableAiAutoShorten === false ||
          req.body.autoShortenOverflow === false ||
          req.body.isZeroGemini === true;

        if (autoStretch !== false && !disableGeminiShorten && !batchExplicitCustom) {
          try {
            const overflowCandidates = findOverflowShortenCandidates(updatedSegments, { maxOverflowThresholdSec: 0.15 });
            if (overflowCandidates.length > 0) {
              const aiClient = getGeminiClient();
              if (aiClient?.models?.generateContent) {
                const shortenRes = await autoShortenOverflowingSegments({
                  segments: updatedSegments,
                  audioDir,
                  aiClient,
                  ttsOptions: {
                    seriesId: cleanSeries,
                    episodeId: cleanEpisode,
                    speakerMap,
                  },
                });
                if (shortenRes.shortenedCount > 0) {
                  updatedSegments = shortenRes.segments;
                }
              }
            }
          } catch (shortenErr) {
            console.warn("[TTS] Post-TTS auto-shorten pass notice:", shortenErr?.message || shortenErr);
          }
        }

        failedSegments = (updatedSegments || []).filter((s) => {
          if (!isSpokenSegment(s)) return false;
          return s.ttsStatus === "error" || s.status === "tts_error" || Boolean(s.error) || Boolean(s._failed) || !s.audioPath || !fs.existsSync(s.audioPath);
        });
        hasAnyFailures = failedSegments.length > 0;

        newlySynthesizedCount = (updatedSegments || []).filter((s) => s && s._wasNewlySynthesized).length;
        reusedCount = (updatedSegments || []).filter((s) => s && s.audioGenerated && !s._wasNewlySynthesized && !s._failed).length;

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
                targetEp.audioGenerated = !hasAnyFailures && (updatedSegments || []).some((s) => s.audioGenerated && !s._failed);
                targetEp.audioOutdated = hasAnyFailures;
                targetEp.hasAudio = (updatedSegments || []).some((s) => s.audioPath && fs.existsSync(s.audioPath));

                // Invalidate rendered video cache whenever audio generation runs (modified audio or failure)
                const prevRenderedAt = Number(targetEp.renderedVideo?.renderedAt || 0);
                targetEp.renderedVideo = null;
                targetEp.renderInvalidatedAt = Math.max(Date.now(), Number(targetEp.renderInvalidatedAt || 0) + 1, prevRenderedAt > 0 ? prevRenderedAt + 1 : 0);

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

        currentMasterSig = computeMasterAudioSignature(syncSegments);
        const sigPath = `${fullAudioPath}.sig`;
        let recordedMasterSig = fs.existsSync(sigPath) ? fs.readFileSync(sigPath, "utf8").trim() : null;
        if (!recordedMasterSig && isEpisode && cleanSeries && cleanEpisode) {
          try {
            const metaPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
            if (fs.existsSync(metaPath)) {
              const seriesMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
              const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(cleanEpisode));
              recordedMasterSig = targetEp?.masterAudioSignature || null;
            }
          } catch (_) {}
        }
        const isMasterSigValid = Boolean(currentMasterSig && recordedMasterSig && recordedMasterSig === currentMasterSig);

        if (!forceRegen && !hasAnyFailures && newlySynthesizedCount === 0 && fs.existsSync(fullAudioPath) && fs.statSync(fullAudioPath).size > 1000 && isMasterSigValid) {
          console.log(`[TTS] ⚡ Master Audio Signature matched (${currentMasterSig.substring(0, 8)}) and all ${reusedCount} clips verified. Skipping redundant master audio merge.`);
          narrationSynced = true;
        } else if (syncSegments.length > 0) {
          activeBatchStages.set(batchKey, { stage: "syncing", total: segments.length });
          const masterMergeStart = Date.now();
          try {
            await createSynchronizedNarrationAudio(syncSegments, fullAudioPath);
            narrationSynced = fs.existsSync(fullAudioPath);
            if (narrationSynced && currentMasterSig) {
              try { fs.writeFileSync(sigPath, currentMasterSig, "utf8"); } catch (_) {}
            }
            masterAudioMergeMs = Date.now() - masterMergeStart;
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
              if (Array.isArray(updatedSegments) && updatedSegments.length > 0) {
                const segMap = new Map(updatedSegments.map((s) => [String(s.id), s]));
                if (Array.isArray(targetEp.scriptData?.segments)) {
                  targetEp.scriptData.segments = targetEp.scriptData.segments.map((s) => {
                    const fresh = segMap.get(String(s.id));
                    return fresh ? { ...s, ...fresh } : s;
                  });
                }
              }
              targetEp.audioGenerated = !hasAnyFailures && (updatedSegments || []).some((s) => s.audioGenerated);
              targetEp.hasAudio = fs.existsSync(fullAudioPath);
              if (fs.existsSync(fullAudioPath)) {
                targetEp.fullAudioUrl = relAudioUrl;
                targetEp.fullAudioPath = fullAudioPath;
              }
              if (narrationSynced && currentMasterSig) {
                targetEp.masterAudioSignature = currentMasterSig;
              }
              const hasRemainingOutdatedSpoken = Array.isArray(targetEp.scriptData?.segments) &&
                targetEp.scriptData.segments.some((s) => {
                  if (!isSpokenSegment(s)) return false;
                  return Boolean(
                    s?.audioOutdated ||
                    s?.ttsStatus === "outdated" ||
                    s?.ttsStatus === "error" ||
                    s?.status === "tts_error" ||
                    Boolean(s?.error) ||
                    Boolean(s?._failed) ||
                    !s?.audioPath ||
                    !fs.existsSync(s?.audioPath)
                  );
                });
              if (narrationSynced && !hasRemainingOutdatedSpoken && !hasAnyFailures) {
                targetEp.audioOutdated = false;
              } else {
                targetEp.audioOutdated = true;
              }

              // Invalidate rendered video cache whenever audio generation runs, unless already invalidated above
              if (targetEp.renderedVideo !== null) {
                const prevRenderedAt = Number(targetEp.renderedVideo?.renderedAt || 0);
                targetEp.renderedVideo = null;
                targetEp.renderInvalidatedAt = Math.max(Date.now(), Number(targetEp.renderInvalidatedAt || 0) + 1, prevRenderedAt > 0 ? prevRenderedAt + 1 : 0);
              }

              console.log(`[TTS] Auto-persisted audioGenerated=${targetEp.audioGenerated} (audioOutdated=${Boolean(targetEp.audioOutdated)}) in series.json for episode ${cleanEpisode}`);
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
      const validGeneratedCount = updatedSegments.length - skippedEmptyCount - (failedSegments ? failedSegments.length : 0);
      const summaryMessage = (failedSegments && failedSegments.length > 0)
        ? `⚠️ បង្កើតសំឡេងបាន ${validGeneratedCount} ឃ្លា (បរាជ័យ ${failedSegments.length} ឃ្លា - សូមចុច Generate ម្តងទៀត)`
        : (skippedEmptyCount > 0
          ? `ជោគជ័យ ${validGeneratedCount} ឃ្លា (រំលង ${skippedEmptyCount} ឃ្លា គ្មានអត្ថបទ)`
          : `ជោគជ័យ ${validGeneratedCount} ឃ្លា (100%)`);

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
        failedCount: failedSegments ? failedSegments.length : 0,
        summaryMessage,
        telemetry: {
          totalDurationMs: Date.now() - batchStartTime,
          masterAudioMergeMs,
          totalSegmentsCount: segments.length,
          reusedSegmentsCount: reusedCount,
          synthesizedSegmentsCount: newlySynthesizedCount,
          failedCount: failedSegments ? failedSegments.length : 0,
          skippedEmptyCount,
          masterAudioSignature: currentMasterSig,
          masterMergeSkipped: Boolean(narrationSynced && masterAudioMergeMs === 0),
        },
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
    const { videoPath, videoFileName, videoId, separationPreset } = req.body;
    const rawVideoRef = videoPath || videoId || videoFileName;
    if (!rawVideoRef) {
      return res.status(400).json({ success: false, error: "Missing video reference" });
    }
    let inputVideoPath = resolveMediaFile(rawVideoRef);
    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      // Fallback: search episode videoFile or originalFilename across series
      const projectsDir = path.join(uploadsDir, "projects");
      if (fs.existsSync(projectsDir)) {
        try {
          const sDirs = fs.readdirSync(projectsDir);
          for (const sDir of sDirs) {
            const sMetaPath = path.join(projectsDir, sDir, "series.json");
            if (fs.existsSync(sMetaPath)) {
              const sData = JSON.parse(fs.readFileSync(sMetaPath, "utf8"));
              for (const ep of Object.values(sData.episodes || {})) {
                if (
                  ep.originalFilename === rawVideoRef ||
                  ep.videoFile === rawVideoRef ||
                  ep.sourceVideoPath === rawVideoRef ||
                  path.basename(ep.sourceVideoPath || "") === rawVideoRef ||
                  path.basename(ep.videoFile || "") === rawVideoRef
                ) {
                  const candidate = ep.sourceVideoPath || (ep.videoFile ? resolveMediaFile(ep.videoFile) : null);
                  if (candidate && fs.existsSync(candidate)) {
                    inputVideoPath = candidate;
                    break;
                  }
                }
              }
              if (inputVideoPath && fs.existsSync(inputVideoPath)) break;
            }
          }
        } catch (_) {}
      }
    }

    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      return res.json({ success: true, available: false, cached: false, inProgress: false });
    }
    const found = typeof audioSeparationService.findAnyCachedSeparationDir === "function"
      ? audioSeparationService.findAnyCachedSeparationDir(inputVideoPath, separationPreset || null)
      : { cacheDir: audioSeparationService.getSeparationCacheDir(inputVideoPath), modelKey: "htdemucs" };
    const noVocalsPath = path.join(found.cacheDir, "no_vocals.wav");
    if (fs.existsSync(noVocalsPath)) {
      const relPath = path.relative(uploadsDir, noVocalsPath).replace(/\\/g, "/");
      return res.json({
        success: true,
        available: true,
        noVocalsUrl: `/uploads/${relPath}`,
        noVocalsPath,
        model: found.modelKey,
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
    const {
      videoPath,
      videoFileName,
      videoId,
      separationPreset = 'turbo',
      model,
      force = false,
    } = req.body;
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

    const sepOptions = {
      audioPath: inputVideoPath,
      separationPreset,
      force: Boolean(force),
    };
    if (model) {
      sepOptions.model = model;
    }
    const sepRes = await audioSeparationService.separateAudio(sepOptions);
    stopHeartbeat();
    const relPath = path.relative(uploadsDir, sepRes.noVocalsPath).replace(/\\/g, "/");
    const noVocalsUrl = `/uploads/${relPath}`;
    const resolvedPreset = sepRes.separationPreset || separationPreset || 'turbo';

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
            targetEp.separationPreset = resolvedPreset;
            console.log(`[AudioSeparation] ✅ Auto-persisted clean BGM (${resolvedPreset}) into series.json for episode ${cleanPEp}`);
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
        model: sepRes.model,
        separationPreset: resolvedPreset,
        processingTimeSec: sepRes.processingTimeSec,
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
    const activeMedia = typeof audioSeparationService.getCurrentSeparationMedia === 'function'
      ? audioSeparationService.getCurrentSeparationMedia()
      : null;
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
      queuePosition: progressData?.queuePosition || 0,
      queueLength: typeof audioSeparationService.getSeparationQueueLength === 'function' ? audioSeparationService.getSeparationQueueLength() : 0,
      message: progressData ? progressData.message : '',
      error: progressData?.error || null,
      model: progressData?.model || 'htdemucs',
      separationPreset: progressData?.separationPreset || 'turbo',
      logs: progressData?.logs || [],
      noVocalsUrl,
      noVocalsPath,
      activeMedia,
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

    // Persist segment timing, lane placement, and userShifted anchor flags to series.json.
    // Must run on BOTH cache-hit (e.g. lane-only drag) AND after FFmpeg sync so reload never loses edits.
    const persistSyncedSegmentsToSeriesJson = async () => {
      if (!cleanSeries || !cleanEpisode) return;
      try {
        const seriesJsonPath = path.join(uploadsDir, "projects", cleanSeries, "series.json");
        await withSeriesMetadataLock(cleanSeries, () => {
          if (!fs.existsSync(seriesJsonPath)) return;
          updateSeriesMetadata(cleanSeries, (seriesMeta) => {
            const targetEp = (seriesMeta?.episodes || []).find(
              (e) => String(e.id) === String(cleanEpisode) || String(e.episodeNumber) === String(cleanEpisode)
            );
            if (!targetEp || !targetEp.scriptData || !Array.isArray(targetEp.scriptData.segments)) return false;

            const byUid = new Map();
            const byId = new Map();
            for (const seg of segments) {
              if (!seg) continue;
              if (seg._uid) byUid.set(String(seg._uid), seg);
              if (seg.id !== undefined && seg.id !== null) byId.set(String(seg.id), seg);
              else if (seg.segmentId !== undefined && seg.segmentId !== null) byId.set(String(seg.segmentId), seg);
            }

            targetEp.scriptData.segments = targetEp.scriptData.segments.map((s, idx) => {
              const updated =
                (s._uid && byUid.get(String(s._uid))) ||
                byId.get(String(s.id ?? s.segmentId ?? (idx + 1)));
              if (!updated) return s;

              const nextTrackRow = typeof updated.trackRow === "number" ? updated.trackRow : (typeof s.trackRow === "number" ? s.trackRow : 0);
              const merged = {
                ...s,
                startSec: typeof updated.startSec === "number" ? updated.startSec : s.startSec,
                endSec: typeof updated.endSec === "number" ? updated.endSec : s.endSec,
                duration: typeof updated.duration === "number" ? updated.duration : s.duration,
                audioStartSec: typeof updated.audioStartSec === "number" ? updated.audioStartSec : s.audioStartSec,
                audioEndSec: typeof updated.audioEndSec === "number" ? updated.audioEndSec : s.audioEndSec,
                audioDurationSec: typeof updated.audioDurationSec === "number" ? updated.audioDurationSec : s.audioDurationSec,
                sourceStartSec: typeof updated.sourceStartSec === "number" ? updated.sourceStartSec : s.sourceStartSec,
                sourceEndSec: typeof updated.sourceEndSec === "number" ? updated.sourceEndSec : s.sourceEndSec,
                start: updated.start !== undefined ? updated.start : s.start,
                end: updated.end !== undefined ? updated.end : s.end,
                startTime: updated.startTime !== undefined ? updated.startTime : s.startTime,
                endTime: updated.endTime !== undefined ? updated.endTime : s.endTime,
                audioStart: updated.audioStart !== undefined ? updated.audioStart : s.audioStart,
                audioEnd: updated.audioEnd !== undefined ? updated.audioEnd : s.audioEnd,
                trackRow: nextTrackRow,
                trackId: updated.trackId || `voice-${nextTrackRow + 1}`,
                subTrackRow: typeof updated.subTrackRow === "number" ? updated.subTrackRow : s.subTrackRow,
                subTrackId: updated.subTrackId !== undefined ? updated.subTrackId : s.subTrackId,
                audioTrimmed: Boolean(updated.audioTrimmed),
                userTrimmed: updated.userTrimmed !== undefined ? Boolean(updated.userTrimmed) : s.userTrimmed,
                audioOverrun: Boolean(updated.audioOverrun),
                userShifted: Boolean(updated.userShifted),
              };
              if (updated.overrunRatio !== undefined) {
                merged.overrunRatio = updated.overrunRatio;
              } else {
                delete merged.overrunRatio;
              }
              return merged;
            });

            targetEp.scriptData.updatedAt = Date.now();
            console.log(`[Sync Audio] ✅ Auto-persisted ${segments.length} synced segments to series.json for ${cleanSeries} [${cleanEpisode}]`);
            return true;
          });
        });
      } catch (saveErr) {
        console.warn("[Sync Audio] Could not auto-persist synced segments to series.json:", saveErr.message);
      }
    };

    // Fast-path: Check if matching synchronized audio already exists on disk with identical fingerprint
    if (fs.existsSync(fullAudioPath) && fs.existsSync(metaPath)) {
      try {
        const existingMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (existingMeta && existingMeta.fingerprint === fingerprint) {
          console.log(`[Sync Audio] ✨ Cache hit for ${cleanSeries}${cleanEpisode ? ` [Episode: ${cleanEpisode}]` : ""}/audio (Fingerprint: ${fingerprint}). Skipping re-render.`);
          await persistSyncedSegmentsToSeriesJson();
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
      await persistSyncedSegmentsToSeriesJson();
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

    // Persist segment timing, lane placement, and userShifted anchor flags IMMEDIATELY before FFmpeg runs
    // so an immediate page reload after dragging never loses the move while FFmpeg is still mixing audio.
    await persistSyncedSegmentsToSeriesJson();

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

    await persistSyncedSegmentsToSeriesJson();

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

    await withSeriesMetadataLock(seriesId, () => updateSeriesMetadata(seriesId, (latestSeries) => {
      const latestEp = (latestSeries.episodes || []).find((candidate) => String(candidate.id) === String(episodeId));
      if (!latestEp?.scriptData || !Array.isArray(latestEp.scriptData.segments)) return false;

      const fittedByIdentity = new Map(updatedSegments.map((segment) => [
        String(segment._uid || segment.id || segment.segmentId),
        segment,
      ]));
      const fitFields = [
        'audioStartSec', 'audioEndSec', 'audioDurationSec', 'audioDuration',
        'finalAudioDuration', 'rawAudioDur', 'audioTrimmed', 'userTrimmed',
        'speed', 'appliedSpeed', 'userCustomSpeed', 'audioOutdated', 'ttsStatus',
      ];
      latestEp.scriptData.segments = latestEp.scriptData.segments.map((segment) => {
        const fitted = fittedByIdentity.get(String(segment._uid || segment.id || segment.segmentId));
        if (!fitted) return segment;
        const next = { ...segment };
        for (const field of fitFields) {
          if (fitted[field] !== undefined) next[field] = fitted[field];
        }
        return next;
      });
      latestEp.autoFitted = true;
      latestEp.scriptData.autoFitted = true;
      latestEp.scriptData.updatedAt = Math.max(Date.now(), Number(latestEp.scriptData.updatedAt || 0) + 1);
      return true;
    }));

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

router.doesSegmentNeedTts = doesSegmentNeedTts;

module.exports = router;

