const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { execSync } = require("child_process");
const express = require("express");

const videoRoutes = require("../routes/videoRoutes");
const { mergeVideosConcat } = require("../services/ffmpegService");
const { getSeriesMetadata, saveSeriesMetadata } = require("../services/episodeService");
const {
  inspectEpisodeExportReadiness,
  analyzeBatchExportPlan,
} = require("../services/batchExportService");
const { uploadsDir } = require("../utils/pathUtils");

function createSyntheticMp4(targetPath, { width = 320, height = 180, durationSec = 1.2, withAudio = true, freq = 440, color = "navy" } = {}) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (withAudio) {
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=${color}:s=${width}x${height}:r=25:d=${durationSec}" -f lavfi -i "sine=frequency=${freq}:sample_rate=44100:duration=${durationSec}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 -shortest "${targetPath}"`,
      { stdio: "ignore", windowsHide: true }
    );
  } else {
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=${color}:s=${width}x${height}:r=25:d=${durationSec}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -an "${targetPath}"`,
      { stdio: "ignore", windowsHide: true }
    );
  }
}

function createSyntheticMp3(targetPath, { durationSec = 1.0, freq = 520 } = {}) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  execSync(
    `ffmpeg -y -f lavfi -i "sine=frequency=${freq}:sample_rate=44100:duration=${durationSec}" -c:a libmp3lame -b:a 128k "${targetPath}"`,
    { stdio: "ignore", windowsHide: true }
  );
}

function probeFull(filePath) {
  const raw = execSync(
    `ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,width,height -of json "${filePath}"`,
    { windowsHide: true }
  ).toString();
  const parsed = JSON.parse(raw);
  const vStream = (parsed.streams || []).find((s) => s.codec_type === "video") || null;
  const aStream = (parsed.streams || []).find((s) => s.codec_type === "audio") || null;
  return {
    duration: parseFloat(parsed.format?.duration || 0) || 0,
    vStream,
    aStream,
  };
}

async function pollUntilBatchDone(baseUrl, jobId, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${baseUrl}/api/render-batch/progress?jobId=${encodeURIComponent(jobId)}`);
    const body = await res.json();
    if (body?.job && body.job.status !== "running") {
      return body.job;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for batch job ${jobId}`);
}

test("mergeVideosConcat: fast stream-copy concat with matching stream specs", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd_merge_fast_"));
  try {
    const clip1 = path.join(tmpDir, "ep1.mp4");
    const clip2 = path.join(tmpDir, "ep2.mp4");
    const mergedOut = path.join(tmpDir, "merged_fast.mp4");

    createSyntheticMp4(clip1, { width: 320, height: 180, durationSec: 1.5, freq: 440, color: "navy" });
    createSyntheticMp4(clip2, { width: 320, height: 180, durationSec: 1.5, freq: 660, color: "darkgreen" });

    const res = await mergeVideosConcat({
      inputVideoPaths: [clip1, clip2],
      outputVideoPath: mergedOut,
      jobId: `test_fast_${Date.now()}`,
    });

    assert.equal(res.success, true);
    assert.equal(res.mergedCount, 2);
    assert.equal(res.fastCopy, true, "Identical stream specs should use fast stream-copy concat");
    assert.ok(fs.existsSync(mergedOut), "Merged output file must exist");

    const info = probeFull(mergedOut);
    assert.equal(info.vStream?.width, 320);
    assert.equal(info.vStream?.height, 180);
    assert.ok(info.aStream, "Merged output must contain audio stream");
    assert.ok(info.duration >= 2.7 && info.duration <= 3.3, `Expected ~3.0s combined duration, got ${info.duration}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test("mergeVideosConcat: normalized re-encode fallback for mixed dimensions and video-only clip", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd_merge_norm_"));
  try {
    const clip1 = path.join(tmpDir, "ep1_land.mp4");
    const clip2 = path.join(tmpDir, "ep2_square_noaudio.mp4");
    const mergedOut = path.join(tmpDir, "merged_norm.mp4");

    createSyntheticMp4(clip1, { width: 320, height: 180, durationSec: 1.2, withAudio: true, color: "blue" });
    createSyntheticMp4(clip2, { width: 240, height: 240, durationSec: 1.2, withAudio: false, color: "red" });

    const res = await mergeVideosConcat({
      inputVideoPaths: [clip1, clip2],
      outputVideoPath: mergedOut,
      targetResolution: { width: 320, height: 180 },
      jobId: `test_norm_${Date.now()}`,
    });

    assert.equal(res.success, true);
    assert.equal(res.mergedCount, 2);
    assert.equal(res.fastCopy, false, "Mixed resolution / missing audio should fall back to normalized concat");
    assert.ok(fs.existsSync(mergedOut), "Merged normalized output must exist");

    const info = probeFull(mergedOut);
    assert.equal(info.vStream?.width, 320);
    assert.equal(info.vStream?.height, 180);
    assert.ok(info.aStream, "Normalized output must synthesize silent audio for video-only clips");
    assert.ok(info.duration >= 2.1 && info.duration <= 2.8, `Expected ~2.4s combined duration, got ${info.duration}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test("analyzeBatchExportPlan: sequential ordering, missing-voice guard, and strict episode audio isolation", () => {
  const seriesId = `test_batch_plan_${Date.now()}`;
  const seriesDir = path.join(uploadsDir, "projects", seriesId);
  try {
    const ep1Vid = path.join(seriesDir, "episodes/ep_1/video/ep_1_src.mp4");
    const ep2Vid = path.join(seriesDir, "episodes/ep_2/video/ep_2_src.mp4");
    const ep3Vid = path.join(seriesDir, "episodes/ep_3/video/ep_3_src.mp4");
    const ep1Master = path.join(seriesDir, "episodes/ep_1/audio/ep_1_narration_khmer.mp3");
    const ep3Master = path.join(seriesDir, "episodes/ep_3/audio/ep_3_narration_khmer.mp3");

    createSyntheticMp4(ep1Vid, { durationSec: 1.0 });
    createSyntheticMp4(ep2Vid, { durationSec: 1.0 });
    createSyntheticMp4(ep3Vid, { durationSec: 1.0 });
    createSyntheticMp3(ep1Master, { durationSec: 1.0 });
    createSyntheticMp3(ep3Master, { durationSec: 1.0 });

    const seriesObj = {
      id: seriesId,
      title: "Test Batch Plan Drama",
      episodes: [
        { id: "ep_3", episodeNumber: 3, title: "EP3", sourceVideoPath: ep3Vid, fullAudioPath: ep3Master },
        // Inject cross-episode leaked fullAudioPath pointing at ep_1 into ep_2 to verify strict isolation rejects it
        { id: "ep_2", episodeNumber: 2, title: "EP2", sourceVideoPath: ep2Vid, fullAudioPath: ep1Master },
        { id: "ep_1", episodeNumber: 1, title: "EP1", sourceVideoPath: ep1Vid, fullAudioPath: ep1Master },
      ],
    };

    const ep2Readiness = inspectEpisodeExportReadiness(seriesId, seriesObj.episodes[1], 1);
    assert.equal(ep2Readiness.hasVideo, true);
    assert.equal(ep2Readiness.hasVoice, false, "Cross-episode audio path pointing into ep_1 must be rejected for ep_2");

    // Pass reversed/unsorted selection ['ep_3', 'ep_1', 'ep_2']
    const planStrict = analyzeBatchExportPlan({
      series: seriesObj,
      episodeIds: ["ep_3", "ep_1", "ep_2"],
      allowOriginalAudio: false,
    });
    assert.deepEqual(planStrict.eligible.map((e) => e.episodeId), ["ep_1", "ep_3"]);
    assert.equal(planStrict.skipped.length, 1);
    assert.equal(planStrict.skipped[0].episodeId, "ep_2");
    assert.equal(planStrict.skipped[0].code, "NO_VOICE");

    const planWithOrig = analyzeBatchExportPlan({
      series: seriesObj,
      episodeIds: ["ep_3", "ep_1", "ep_2"],
      allowOriginalAudio: true,
    });
    assert.deepEqual(planWithOrig.eligible.map((e) => e.episodeId), ["ep_1", "ep_2", "ep_3"]);
    assert.equal(planWithOrig.eligible[1].useOriginalAudio, true);
    assert.equal(planWithOrig.skipped.length, 0);
  } finally {
    try { fs.rmSync(seriesDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test("HTTP Batch Export & Merge workflow + secure /api/download-export endpoints", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", videoRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const seriesId = `test_batch_http_${Date.now()}`;
  const seriesDir = path.join(uploadsDir, "projects", seriesId);
  const tempDownloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd_dl_"));
  const prevDownloadsEnv = process.env.DRAGONDUB_DOWNLOADS_DIR;
  process.env.DRAGONDUB_DOWNLOADS_DIR = tempDownloadsDir;

  try {
    const ep1Vid = path.join(seriesDir, "episodes/ep_1/video/ep_1_src.mp4");
    const ep2Vid = path.join(seriesDir, "episodes/ep_2/video/ep_2_src.mp4");
    const ep3Vid = path.join(seriesDir, "episodes/ep_3/video/ep_3_src.mp4");
    const ep1Master = path.join(seriesDir, "episodes/ep_1/audio/ep_1_narration_khmer.mp3");
    const ep3Master = path.join(seriesDir, "episodes/ep_3/audio/ep_3_narration_khmer.mp3");

    createSyntheticMp4(ep1Vid, { width: 320, height: 180, durationSec: 1.2, color: "navy" });
    createSyntheticMp4(ep2Vid, { width: 320, height: 180, durationSec: 1.2, color: "maroon" });
    createSyntheticMp4(ep3Vid, { width: 320, height: 180, durationSec: 1.2, color: "teal" });
    createSyntheticMp3(ep1Master, { durationSec: 1.2, freq: 440 });
    createSyntheticMp3(ep3Master, { durationSec: 1.2, freq: 587 });

    saveSeriesMetadata({
      id: seriesId,
      title: "HTTP Batch Test Series",
      episodes: [
        {
          id: "ep_1",
          episodeNumber: 1,
          title: "ភាគទី 1 (EP1)",
          status: "completed",
          sourceVideoPath: ep1Vid,
          videoFile: `/uploads/projects/${seriesId}/episodes/ep_1/video/ep_1_src.mp4`,
          audioGenerated: true,
          fullAudioPath: ep1Master,
          metadata: { width: 320, height: 180, durationSec: 1.2 },
          duration: 1.2,
          video: { videoPath: ep1Vid, width: 320, height: 180, durationSec: 1.2 },
          scriptData: {
            segments: [{ startSec: 0.1, duration: 0.9, khmerText: "សាកល្បងអក្សរខ្មែរ Batch EP1" }],
          },
        },
        {
          id: "ep_2",
          episodeNumber: 2,
          title: "ភាគទី 2 (EP2)",
          status: "uploaded",
          sourceVideoPath: ep2Vid,
          videoFile: `/uploads/projects/${seriesId}/episodes/ep_2/video/ep_2_src.mp4`,
          audioGenerated: false,
          metadata: { width: 320, height: 180, durationSec: 1.2 },
          duration: 1.2,
          video: { videoPath: ep2Vid, width: 320, height: 180, durationSec: 1.2 },
        },
        {
          id: "ep_3",
          episodeNumber: 3,
          title: "ភាគទី 3 (EP3)",
          status: "completed",
          sourceVideoPath: ep3Vid,
          videoFile: `/uploads/projects/${seriesId}/episodes/ep_3/video/ep_3_src.mp4`,
          audioGenerated: true,
          fullAudioPath: ep3Master,
          metadata: { width: 320, height: 180, durationSec: 1.2 },
          duration: 1.2,
          video: { videoPath: ep3Vid, width: 320, height: 180, durationSec: 1.2 },
          scriptData: {
            segments: [{ startSec: 0.1, duration: 0.9, khmerText: "សាកល្បងអក្សរខ្មែរ Batch EP3" }],
          },
        },
      ],
    });

    // 1. Selecting ONLY unvoiced ep_2 with allowOriginalAudio:false returns 400 with NO_VOICE details
    const failRes = await fetch(`${baseUrl}/api/render-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesId,
        episodeIds: ["ep_2"],
        mode: "separate",
        allowOriginalAudio: false,
      }),
    });
    assert.equal(failRes.status, 400);
    const failBody = await failRes.json();
    assert.equal(failBody.success, false);
    assert.equal(failBody.skippedEpisodes?.[0]?.code, "NO_VOICE");

    // 2. Batch Separate mode (ep_1 voiced + ep_2 original audio override)
    const sepStart = await fetch(`${baseUrl}/api/render-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesId,
        episodeIds: ["ep_2", "ep_1"],
        mode: "separate",
        allowOriginalAudio: true,
        exportSettings: {
          aspectRatio: "16:9",
          burnSubtitles: false,
          soundMode: "ducking",
          bgVolume: 0.15,
          khmerVolume: 1.2,
        },
      }),
    });
    assert.equal(sepStart.status, 200);
    const sepStartJson = await sepStart.json();
    assert.equal(sepStartJson.success, true);

    const sepDone = await pollUntilBatchDone(baseUrl, sepStartJson.job.jobId);
    assert.equal(sepDone.status, "completed", `Expected completed, got ${sepDone.status}: ${sepDone.error}`);
    assert.equal(sepDone.outputs.length, 2);
    assert.deepEqual(sepDone.outputs.map((o) => o.episodeId), ["ep_1", "ep_2"], "Must preserve sequential EP1->EP2 order");
    assert.equal(sepDone.outputs[0].usedOriginalAudio, false);
    assert.equal(sepDone.outputs[1].usedOriginalAudio, true);
    assert.equal(sepDone.outputs[0].savedToDownloads, true);
    assert.equal(sepDone.outputs[1].savedToDownloads, true);
    assert.ok(fs.existsSync(sepDone.outputs[0].downloadsPath));
    assert.ok(fs.existsSync(sepDone.outputs[1].downloadsPath));

    const updatedSeriesAfterSep = getSeriesMetadata(seriesId, { forceDisk: true });
    const ep1Saved = updatedSeriesAfterSep.episodes.find((e) => e.id === "ep_1");
    const ep2Saved = updatedSeriesAfterSep.episodes.find((e) => e.id === "ep_2");
    assert.ok(ep1Saved?.renderedVideo?.downloadUrl, "ep_1 renderedVideo must persist in series.json");
    assert.ok(ep2Saved?.renderedVideo?.usedOriginalAudio === true, "ep_2 renderedVideo metadata must record usedOriginalAudio");

    // Verify GET /api/render-batch/latest
    const latestRes = await fetch(`${baseUrl}/api/render-batch/latest?seriesId=${encodeURIComponent(seriesId)}`);
    assert.equal(latestRes.status, 200);
    const latestJson = await latestRes.json();
    assert.equal(latestJson.job?.jobId, sepStartJson.job.jobId);

    // 3. Batch Merge mode (all 3 episodes -> 1 Full Video, honouring subtitleSize='large' & pill style)
    const batchAssLogs = [];
    const origConsoleLog = console.log;
    console.log = (...args) => {
      const line = args.map(String).join(" ");
      if (line.includes("ASS burn:")) batchAssLogs.push(line);
      origConsoleLog(...args);
    };
    let mergeDone;
    try {
      const mergeStart = await fetch(`${baseUrl}/api/render-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId,
          episodeIds: ["ep_1", "ep_2", "ep_3"],
          mode: "merge",
          allowOriginalAudio: true,
          exportSettings: {
            aspectRatio: "16:9",
            burnSubtitles: true,
            subtitleStyle: "pill",
            subtitleColor: "yellow",
            subtitleSize: "large",
            soundMode: "ducking",
          },
        }),
      });
      assert.equal(mergeStart.status, 200);
      const mergeStartJson = await mergeStart.json();
      mergeDone = await pollUntilBatchDone(baseUrl, mergeStartJson.job.jobId);
    } finally {
      console.log = origConsoleLog;
    }
    assert.ok(
      batchAssLogs.length >= 2 &&
        batchAssLogs.every((l) => l.includes("style=pill color=#FFE600 fontSize=55 (size=large) playRes=1920x1080")),
      `Batch export must honour subtitleSize='large' & pill style; got logs: ${JSON.stringify(batchAssLogs)}`
    );
    assert.equal(mergeDone.status, "completed", `Expected completed, got ${mergeDone.status}: ${mergeDone.error}`);
    assert.equal(mergeDone.outputs.length, 3);
    assert.ok(mergeDone.mergedResult?.success, "mergedResult must succeed");
    assert.equal(mergeDone.mergedResult.mergedCount, 3);
    assert.equal(mergeDone.mergedResult.savedToDownloads, true);
    assert.ok(fs.existsSync(mergeDone.mergedResult.downloadsPath), "Full merged video must be copied into Downloads");

    const mergedDiskPath = path.join(seriesDir, "exports", mergeDone.mergedResult.outputFilename);
    assert.ok(fs.existsSync(mergedDiskPath), "Merged file must exist inside exports directory");
    const mergedProbe = probeFull(mergedDiskPath);
    assert.ok(mergedProbe.duration >= 3.2 && mergedProbe.duration <= 4.1, `Expected ~3.6s merged duration, got ${mergedProbe.duration}`);
    assert.ok(mergedProbe.aStream, "Merged MP4 must have audio stream");

    // 4. Download endpoint security + valid fetch (both relative and /uploads/-prefixed forms)
    const dlOk = await fetch(`${baseUrl}${mergeDone.mergedResult.downloadUrl}`);
    assert.equal(dlOk.status, 200);
    const dlBytes = Buffer.from(await dlOk.arrayBuffer());
    assert.equal(dlBytes.length, fs.statSync(mergedDiskPath).size, "Downloaded byte count must match file size on disk");

    const dlPrefixed = await fetch(
      `${baseUrl}/api/download-export?file=${encodeURIComponent(`/uploads/projects/${seriesId}/exports/${mergeDone.mergedResult.outputFilename}`)}`
    );
    assert.equal(dlPrefixed.status, 200, "/uploads/-prefixed relative export path must resolve inside uploadsDir on Windows");

    const dlNotFound = await fetch(
      `${baseUrl}/api/download-export?file=${encodeURIComponent(`projects/${seriesId}/exports/nonexistent_file.mp4`)}`
    );
    assert.equal(dlNotFound.status, 404);

    for (const maliciousPath of [
      "../.env",
      "%252e%252e/.env",
      "../../package.json",
      "/etc/passwd",
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
    ]) {
      const travRes = await fetch(`${baseUrl}/api/download-export?file=${encodeURIComponent(maliciousPath)}`);
      assert.equal(travRes.status, 403, `Expected 403 Forbidden for traversal path: ${maliciousPath}`);
    }

    // 5. Concurrent job guard (409) & POST /api/render-batch/kill cancellation
    const longSeriesId = `test_batch_kill_${Date.now()}`;
    const longSeriesDir = path.join(uploadsDir, "projects", longSeriesId);
    try {
      const longEp1 = path.join(longSeriesDir, "episodes/ep_1/video/long_1.mp4");
      const longEp2 = path.join(longSeriesDir, "episodes/ep_2/video/long_2.mp4");
      createSyntheticMp4(longEp1, { width: 640, height: 360, durationSec: 8, color: "navy" });
      createSyntheticMp4(longEp2, { width: 640, height: 360, durationSec: 8, color: "purple" });

      saveSeriesMetadata({
        id: longSeriesId,
        title: "Cancel Test Series",
        episodes: [
          { id: "ep_1", episodeNumber: 1, title: "EP1", sourceVideoPath: longEp1, metadata: { width: 640, height: 360, durationSec: 8 } },
          { id: "ep_2", episodeNumber: 2, title: "EP2", sourceVideoPath: longEp2, metadata: { width: 640, height: 360, durationSec: 8 } },
        ],
      });

      const killJobStart = await fetch(`${baseUrl}/api/render-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId: longSeriesId,
          episodeIds: ["ep_1", "ep_2"],
          mode: "merge",
          allowOriginalAudio: true,
          exportSettings: { aspectRatio: "9:16", verticalStyle: "pad", burnSubtitles: false },
        }),
      });
      assert.equal(killJobStart.status, 200);
      const killStartJson = await killJobStart.json();

      // Immediate duplicate start on same series must return 409 Conflict
      const dupStart = await fetch(`${baseUrl}/api/render-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId: longSeriesId,
          episodeIds: ["ep_1"],
          mode: "separate",
          allowOriginalAudio: true,
        }),
      });
      assert.equal(dupStart.status, 409, "Concurrent batch export on same series must return 409 Conflict");

      const killRes = await fetch(`${baseUrl}/api/render-batch/kill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: killStartJson.job.jobId, seriesId: longSeriesId }),
      });
      assert.equal(killRes.status, 200);
      const killJson = await killRes.json();
      assert.equal(killJson.success, true);
      assert.equal(killJson.job?.status, "cancelled");

      // Wait briefly for child FFmpeg process exit before cleaning up files
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      try { fs.rmSync(longSeriesDir, { recursive: true, force: true }); } catch (_) {}
    }
  } finally {
    if (prevDownloadsEnv === undefined) {
      delete process.env.DRAGONDUB_DOWNLOADS_DIR;
    } else {
      process.env.DRAGONDUB_DOWNLOADS_DIR = prevDownloadsEnv;
    }
    server.close();
    try { fs.rmSync(seriesDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(tempDownloadsDir, { recursive: true, force: true }); } catch (_) {}
  }
});
