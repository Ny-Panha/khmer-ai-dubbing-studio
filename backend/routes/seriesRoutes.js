const express = require("express");
const fs = require("fs");
const path = require("path");
const { uploadsDir } = require("../utils/pathUtils");
const {
  getSeriesMetadata,
  withSeriesMetadataLock,
  syncSeriesMetadataSafely,
  persistEpisodeTimelineOperation,
  createNewEpisode,
  deleteEpisode,
} = require("../services/episodeService");

const router = express.Router();
const proxyPreview = require("../services/proxyPreviewService");

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
          if (meta) {
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
    if (!series || !series.id) return res.status(400).json({ error: "series with id is required" });
    const saved = await syncSeriesMetadataSafely(series.id, series);
    res.json({ success: true, series: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

router.patch("/:seriesId/episodes/:episodeId/timeline", async (req, res) => {
  try {
    const { seriesId, episodeId } = req.params;
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
    const saved = await syncSeriesMetadataSafely(seriesId, series);
    res.json({ success: true, series: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

