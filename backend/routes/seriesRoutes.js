const express = require("express");
const fs = require("fs");
const path = require("path");
const { uploadsDir, sanitizeProjectName, sanitizeEpisodeId, isSafeUploadPath } = require("../utils/pathUtils");
const {
  getSeriesMetadata,
  updateSeriesMetadata,
  withSeriesMetadataLock,
  syncSeriesMetadataSafely,
  persistEpisodeTimelineOperation,
  createNewEpisode,
  deleteEpisode,
  deleteSeries,
  renameSeries,
  resolveUniqueSeriesFolderId,
  resetEpisodeState,
  applyScopedVideoEditSettings,
} = require("../services/episodeService");
const { readGlobalVideoEditSettings } = require("../services/globalLogoSettingsService");

const router = express.Router();
const episodeEtags = new WeakMap();
const { createHash } = require("node:crypto");
const proxyPreview = require("../services/proxyPreviewService");
const sourceProxy = require("../services/sourceProxyService");

router.route("/:seriesId/episodes/:episodeId/source-proxy")
  .get(async (req, res) => {
    try {
      const immediate = req.query.immediate === "true" || req.query.immediate === "1";
      const status = await sourceProxy.getStatus(req.params.seriesId, req.params.episodeId, {
        immediate,
        videoUrl: req.query.videoUrl,
      });
      res.set("Cache-Control", "no-store").json(status);
    } catch (err) {
      res.status(400).json({ status: "error", error: err.message });
    }
  })
  .post(async (req, res) => {
    try {
      const status = await sourceProxy.getStatus(req.params.seriesId, req.params.episodeId, {
        immediate: true,
        videoUrl: req.body?.videoUrl || req.query.videoUrl,
      });
      res.json(status);
    } catch (err) {
      res.status(400).json({ status: "error", error: err.message });
    }
  });

router.route("/:seriesId/episodes/:episodeId/proxy-preview")
  .post((req, res) => {
    try {
      res.json(proxyPreview.request(req.params.seriesId, req.params.episodeId, req.body));
    } catch (err) { res.status(400).json({ error: err.message }); }
  })
  .get((req, res) => {
    try {
      res.set("Cache-Control", "no-store").json(proxyPreview.status(req.params.seriesId, req.params.episodeId, req.query.revision));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

router.get("/", (req, res) => {
  try {
    const projectsDir = path.join(uploadsDir, "projects");
    if (!fs.existsSync(projectsDir)) return res.json({ success: true, series: [] });
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const seriesList = [];
    for (const ent of entries) {
      if (ent.isDirectory()) {
        try {
          const meta = getSeriesMetadata(ent.name);
          if (meta && meta.id) {
            seriesList.push(meta);
          }
        } catch (_) {}
      }
    }
    res.json({ success: true, series: seriesList });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { series } = req.body;
    if (!series || (!series.id && !series.title)) {
      return res.status(400).json({ error: "series with id or title is required" });
    }
    const projectsDir = path.join(uploadsDir, "projects");
    const rawId = typeof series.id === "string" ? series.id.trim() : "";
    const rawTitle = typeof series.title === "string" ? series.title.trim() : "";
    const existingDirForRawId = rawId
      ? fs.existsSync(path.join(projectsDir, sanitizeProjectName(rawId)))
      : false;

    let targetId = rawId;
    if (
      rawTitle &&
      (!rawId || (/^series_\d+$/i.test(rawId) && !existingDirForRawId))
    ) {
      targetId = resolveUniqueSeriesFolderId(rawTitle, { projectsDir });
    }
    if (!targetId) {
      targetId = `series_${Date.now()}`;
    }

    const saved = await syncSeriesMetadataSafely(targetId, {
      ...series,
      id: targetId,
      title: rawTitle || targetId,
    });
    res.json({ success: true, series: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/:seriesId/speaker-identity", async (req, res) => {
  try {
    const { seriesId } = req.params;
    const {
      episodeId,
      targetKey,
      targetCharacterId,
      newName,
      newVoiceId,
      newGender,
      applyAcrossSeries = true,
    } = req.body || {};

    const cleanSeries = sanitizeProjectName(seriesId);
    const cleanNewName = typeof newName === "string" ? newName.trim() : "";
    if (!targetKey && !targetCharacterId) {
      return res.status(400).json({ success: false, error: "targetKey or targetCharacterId is required" });
    }
    if (!cleanNewName && !newVoiceId) {
      return res.status(400).json({ success: false, error: "newName or newVoiceId is required" });
    }

    const {
      getSpeakerId,
      buildCharacterId,
      isPlaceholderSpeakerName,
      isGenericSpeakerName,
      isEpisodicRoleSpeakerName,
      buildSpeakerRegistry,
    } = require("../models/speakerRegistry");
    const { buildVerifiedSeriesSpeakerMapPatch } = require("../services/pipeline/speakerIdentificationService");

    let updatedSegments = null;
    let updatedRegistry = null;
    let updatedSeriesMap = null;
    let updatedCount = 0;

    await withSeriesMetadataLock(cleanSeries, () =>
      updateSeriesMetadata(cleanSeries, (freshSeries) => {
        if (!freshSeries) return false;
        const targetEp = episodeId
          ? (freshSeries.episodes || []).find((e) => String(e.id) === String(episodeId))
          : null;
        if (episodeId && !targetEp) return false;

        const targetEpisodes = targetEp ? [targetEp] : (freshSeries.episodes || []);
        const inferredVoiceGender = newVoiceId
          ? (String(newVoiceId).toLowerCase().includes("sreymom") ? "female" : "male")
          : (String(newGender || "").toLowerCase() === "female"
              ? "female"
              : (String(newGender || "").toLowerCase() === "male" ? "male" : null));

        const nextSpeakerId = cleanNewName && !isPlaceholderSpeakerName(cleanNewName)
          ? getSpeakerId(cleanNewName, inferredVoiceGender || "unknown")
          : String(targetKey);
        const nextCharacterId = cleanNewName && !isPlaceholderSpeakerName(cleanNewName)
          ? buildCharacterId(cleanNewName, nextSpeakerId, {
              isGeneric: isGenericSpeakerName(cleanNewName),
              isEpisodic: isEpisodicRoleSpeakerName(cleanNewName),
            })
          : (targetCharacterId || `char_${nextSpeakerId.replace(/^spk_/, "")}`);

        const matchesCue = (seg) => {
          if (!seg) return false;
          if (targetKey && String(seg.speakerId || "") === String(targetKey)) return true;
          if (targetCharacterId && String(seg.characterId || "") === String(targetCharacterId)) return true;
          return false;
        };

        for (const ep of targetEpisodes) {
          if (!ep?.scriptData?.segments || !Array.isArray(ep.scriptData.segments)) continue;
          let epChanged = false;
          const nextSegs = ep.scriptData.segments.map((seg) => {
            if (!matchesCue(seg)) return seg;
            epChanged = true;
            if (targetEp && String(ep.id) === String(targetEp.id)) updatedCount++;

            const resolvedVoice = newVoiceId || seg.khmerVoiceId || seg.voiceId || seg.voice || "km-KH-PisethNeural";
            const isFemVoice = String(resolvedVoice).toLowerCase().includes("sreymom");
            const effectiveGender = inferredVoiceGender || (seg.voiceGender === "female" || seg.voiceGender === "male" ? seg.voiceGender : (isFemVoice ? "female" : "male"));
            const effectiveSpkGender = effectiveGender === "female" ? "FEMALE" : "MALE";
            const finalName = cleanNewName || seg.speakerName || seg.speaker || "តួអង្គ";
            const finalSpkId = cleanNewName ? nextSpeakerId : (seg.speakerId || nextSpeakerId);
            const finalCharId = cleanNewName ? nextCharacterId : (seg.characterId || nextCharacterId);

            return {
              ...seg,
              speaker: finalName,
              speakerName: finalName,
              speakerId: finalSpkId,
              characterId: finalCharId,
              aliases: Array.from(new Set([...(Array.isArray(seg.aliases) ? seg.aliases : []), finalName].filter((a) => a && !isPlaceholderSpeakerName(a)))),
              voiceId: resolvedVoice,
              khmerVoiceId: resolvedVoice,
              voice: resolvedVoice,
              voiceOverride: resolvedVoice,
              voiceGender: effectiveGender,
              gender: effectiveGender,
              speakerGender: effectiveSpkGender,
              voiceLabel: isFemVoice ? "ស្រីមុំ (Sreymom)" : "ពិសិដ្ឋ (Piseth)",
              avatar: isFemVoice ? "👩" : "👨",
              badgeColor: isFemVoice ? "#ec4899" : "#38bdf8",
              speakerStatus: "verified",
              speakerVerified: true,
              speakerReviewNeeded: false,
              reviewNeeded: false,
              unverifiedSpeaker: false,
              userOverridden: true,
              manualCharacterOverridden: true,
              voiceAssignmentSource: "manual",
              audioOutdated: newVoiceId && seg.voiceId !== resolvedVoice ? true : Boolean(seg.audioOutdated),
            };
          });

          if (epChanged) {
            ep.scriptData.segments = nextSegs;
            ep.scriptData.updatedAt = Date.now();
            const rebuilt = buildSpeakerRegistry(nextSegs, ep.speakerRegistry || {});
            // Clean superseded positional key when renamed cleanly
            if (cleanNewName && targetKey && String(targetKey) !== nextSpeakerId && rebuilt[targetKey]) {
              const anyStillUsingOld = nextSegs.some((s) => String(s.speakerId || "") === String(targetKey));
              if (!anyStillUsingOld) delete rebuilt[targetKey];
            }
            ep.speakerRegistry = rebuilt;
            ep.lastModified = Date.now();
            if (targetEp && String(ep.id) === String(targetEp.id)) {
              updatedSegments = nextSegs;
              updatedRegistry = rebuilt;
            }
          }
        }

        if (applyAcrossSeries && cleanNewName && !isPlaceholderSpeakerName(cleanNewName)) {
          const patchSourceSegs = updatedSegments || [];
          const patchReg = updatedRegistry || {};
          updatedSeriesMap = buildVerifiedSeriesSpeakerMapPatch(
            patchSourceSegs,
            patchReg,
            freshSeries.seriesSpeakerMap || {},
            { seriesId: cleanSeries }
          );
          freshSeries.seriesSpeakerMap = updatedSeriesMap;
        }
        return true;
      })
    );

    res.json({
      success: true,
      updatedCount,
      segments: updatedSegments,
      speakerRegistry: updatedRegistry,
      seriesSpeakerMap: updatedSeriesMap,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/:seriesId/rename", async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { title } = req.body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ success: false, error: "សូមបញ្ចូលឈ្មោះ Folder រឿងថ្មី!" });
    }
    const result = await renameSeries(seriesId, title.trim());
    if (!result.success) {
      return res.status(result.statusCode || 400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/:seriesId/video-edit-settings", async (req, res) => {
  try {
    const { seriesId } = req.params;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const scope = body.scope || "folder";
    const episodeId = body.episodeId || null;
    const settings = body.settings || body.videoEditSettings || body;
    const updatedAt = Number(body.updatedAt) || Date.now();
    const result = await applyScopedVideoEditSettings(seriesId, episodeId, settings, {
      scope,
      updatedAt,
    });
    res.json(result);
  } catch (err) {
    const status = /not found|required/i.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.get("/:seriesId", (req, res) => {
  try {
    const { seriesId } = req.params;
    const series = getSeriesMetadata(seriesId);
    res.json({ success: true, series });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:seriesId/episodes/:episodeId", (req, res) => {
  try {
    const episode = getSeriesMetadata(req.params.seriesId)?.episodes?.find((ep) => ep.id === req.params.episodeId);
    if (!episode) return res.status(404).json({ success: false, error: "Episode not found" });
    let etag = episodeEtags.get(episode);
    if (!etag) {
      etag = '"' + createHash("sha256").update(JSON.stringify(episode)).digest("base64url") + '"';
      episodeEtags.set(episode, etag);
    }
    res.set("ETag", etag);
    if (req.get("If-None-Match") === etag) return res.status(304).end();
    res.json({ success: true, episode });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.route("/:seriesId/episodes/:episodeId/waveform-peaks")
  .get((req, res) => {
    try {
      const cleanSeries = sanitizeProjectName(req.params.seriesId);
      const cleanEp = sanitizeEpisodeId(req.params.episodeId);
      const epDir = path.join(uploadsDir, "projects", cleanSeries, "episodes", cleanEp);
      if (!isSafeUploadPath(epDir, uploadsDir) || !fs.existsSync(epDir)) {
        return res.json({ success: true, peaks: {} });
      }
      const peaksPath = path.join(epDir, "waveform-peaks.json");
      if (!fs.existsSync(peaksPath)) {
        return res.json({ success: true, peaks: {} });
      }
      const raw = JSON.parse(fs.readFileSync(peaksPath, "utf8"));
      return res.json({ success: true, peaks: raw && typeof raw === "object" ? raw : {} });
    } catch (err) {
      return res.json({ success: true, peaks: {} });
    }
  })
  .post((req, res) => {
    try {
      const cleanSeries = sanitizeProjectName(req.params.seriesId);
      const cleanEp = sanitizeEpisodeId(req.params.episodeId);
      const epDir = path.join(uploadsDir, "projects", cleanSeries, "episodes", cleanEp);
      if (!isSafeUploadPath(epDir, uploadsDir) || !fs.existsSync(epDir)) {
        return res.status(404).json({ success: false, error: "Episode directory missing" });
      }
      const incoming = req.body?.peaks;
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
        return res.status(400).json({ success: false, error: "peaks map required" });
      }
      const peaksPath = path.join(epDir, "waveform-peaks.json");
      let merged = {};
      if (fs.existsSync(peaksPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(peaksPath, "utf8"));
          if (existing && typeof existing === "object" && !Array.isArray(existing)) {
            merged = existing;
          }
        } catch (_) {}
      }
      let added = 0;
      for (const [k, vals] of Object.entries(incoming)) {
        if (typeof k !== "string" || k.length > 400 || !Array.isArray(vals) || vals.length === 0) continue;
        merged[k] = vals.slice(0, 256).map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
        added++;
      }
      const keys = Object.keys(merged);
      if (keys.length > 400) {
        for (const oldKey of keys.slice(0, keys.length - 400)) {
          delete merged[oldKey];
        }
      }
      if (added > 0) {
        const tmpPath = `${peaksPath}.tmp_${process.pid}_${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify(merged), "utf8");
        fs.renameSync(tmpPath, peaksPath);
      }
      return res.json({ success: true, saved: added });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

router.post("/:seriesId/episodes", async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { customTitle, requestedNumber } = req.body || {};
    const newEp = await createNewEpisode(seriesId, { customTitle, requestedNumber });
    res.json({ success: true, episode: newEp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:seriesId/episodes/:episodeId", async (req, res) => {
  try {
    const { seriesId, episodeId } = req.params;
    const result = await withSeriesMetadataLock(seriesId, () => deleteEpisode(seriesId, episodeId));
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:seriesId", async (req, res) => {
  try {
    const { seriesId } = req.params;
    const result = await withSeriesMetadataLock(seriesId, () => deleteSeries(seriesId));
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/:seriesId/episodes/:episodeId/reset", async (req, res) => {
  try {
    const { seriesId, episodeId } = req.params;
    const { resetType } = req.body || {};
    const result = await resetEpisodeState(seriesId, episodeId, { resetType });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/:seriesId/episodes/:episodeId/timeline", async (req, res) => {
  try {
    const { seriesId, episodeId } = req.params;
    // Reject timeline operations for series whose directory no longer exists
    const cleanId = sanitizeProjectName(seriesId);
    const seriesDir = path.join(uploadsDir, "projects", cleanId);
    if (!fs.existsSync(seriesDir)) {
      return res.status(410).json({ success: false, error: `Series "${cleanId}" has been deleted`, gone: true });
    }
    const result = await persistEpisodeTimelineOperation({
      seriesId,
      episodeId,
      ...(req.body || {}),
    });
    res.json(result);
  } catch (err) {
    const status = /required|requires|Unsupported/.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post("/:seriesId/sync", async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { series } = req.body || {};
    if (!series) return res.status(400).json({ error: "series payload required" });
    // Reject sync requests for series whose directory no longer exists on disk
    // to prevent stale frontend state from resurrecting deleted folders.
    const cleanId = sanitizeProjectName(seriesId);
    const seriesDir = path.join(uploadsDir, "projects", cleanId);
    if (!fs.existsSync(seriesDir)) {
      return res.status(410).json({ success: false, error: `Series "${cleanId}" has been deleted`, gone: true });
    }
    const saved = await syncSeriesMetadataSafely(seriesId, series);
    res.json(req.get("Prefer") === "return=minimal" ? { success: true } : { success: true, series: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

