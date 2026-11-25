const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { execFileSync } = require("child_process");

const videoRoutes = require("../routes/videoRoutes");
const { uploadsDir } = require("../utils/pathUtils");
const { FFMPEG_PATH } = require("../services/ffmpegService");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createSyntheticMp4(outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync(
    FFMPEG_PATH,
    [
      "-y",
      "-f", "lavfi", "-i", "color=c=navy:s=320x180:d=1.5:r=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest",
      outPath,
    ],
    { stdio: "ignore", windowsHide: true }
  );
}

function createSyntheticMp3(outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync(
    FFMPEG_PATH,
    [
      "-y",
      "-f", "lavfi", "-i", "sine=frequency=520:duration=1.5",
      "-c:a", "libmp3lame", "-b:a", "128k",
      outPath,
    ],
    { stdio: "ignore", windowsHide: true }
  );
}

test("POST /api/render-video never deletes or overwrites input source file on _source title or exact filename collision", async () => {
  const uniqueId = `test_collision_${Date.now()}`;
  const projectDir = path.join(uploadsDir, "projects", uniqueId);
  const downloadsDir = path.join(os.homedir(), "Downloads");
  const createdDownloads = [];

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", videoRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  try {
    // Case A: displayTitle / videoTitle ends with "_source" (e.g., ss1_ep_28_source)
    const ep1VideoDir = path.join(projectDir, "episodes", "ep_1", "video");
    const ep1AudioDir = path.join(projectDir, "episodes", "ep_1", "audio");
    const ep1SourcePath = path.join(ep1VideoDir, "test_ep_1_source.mp4");
    const ep1AudioPath = path.join(ep1AudioDir, "ep_1_narration_khmer.mp3");
    createSyntheticMp4(ep1SourcePath);
    createSyntheticMp3(ep1AudioPath);
    const ep1SourceSha = sha256File(ep1SourcePath);
    const ep1SourceSize = fs.statSync(ep1SourcePath).size;

    const resA = await fetch(`http://127.0.0.1:${port}/api/render-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesId: uniqueId,
        episodeId: "ep_1",
        projectName: uniqueId,
        videoPath: ep1SourcePath,
        fullAudioPath: ep1AudioPath,
        videoTitle: "test_ep_1_source",
        displayTitle: "test_ep_1_source",
        aspectRatio: "16:9",
        burnSubtitles: false,
        logoSettings: { enabled: false },
        segments: [],
      }),
    });
    const dataA = await resA.json();
    assert.equal(resA.status, 200, `Case A failed: ${JSON.stringify(dataA)}`);
    assert.equal(dataA.success, true);
    if (dataA.outputFilename) {
      createdDownloads.push(path.join(downloadsDir, dataA.outputFilename));
    }
    const ep1OutPath = path.join(ep1VideoDir, dataA.outputFilename);
    assert.ok(fs.existsSync(ep1SourcePath), "Source MP4 must still exist after _source export");
    assert.equal(sha256File(ep1SourcePath), ep1SourceSha, "Source MP4 bytes must be untouched");
    assert.equal(fs.statSync(ep1SourcePath).size, ep1SourceSize);
    assert.notEqual(
      path.resolve(ep1OutPath).toLowerCase(),
      path.resolve(ep1SourcePath).toLowerCase(),
      "Output path must never equal input source path"
    );
    assert.ok(fs.existsSync(ep1OutPath), "Rendered dubbed export must exist");

    // Case B: meaningful videoTitle matches the exact input file stem in the same videoDir
    const ep2VideoDir = path.join(projectDir, "episodes", "ep_2", "video");
    const ep2AudioDir = path.join(projectDir, "episodes", "ep_2", "audio");
    const ep2SourcePath = path.join(ep2VideoDir, "custom_drama_clip.mp4");
    const ep2AudioPath = path.join(ep2AudioDir, "ep_2_narration_khmer.mp3");
    createSyntheticMp4(ep2SourcePath);
    createSyntheticMp3(ep2AudioPath);
    const ep2SourceSha = sha256File(ep2SourcePath);
    const ep2SourceSize = fs.statSync(ep2SourcePath).size;

    const resB = await fetch(`http://127.0.0.1:${port}/api/render-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesId: uniqueId,
        episodeId: "ep_2",
        projectName: uniqueId,
        videoPath: ep2SourcePath,
        fullAudioPath: ep2AudioPath,
        videoTitle: "custom_drama_clip",
        displayTitle: "custom_drama_clip",
        aspectRatio: "16:9",
        burnSubtitles: false,
        logoSettings: { enabled: false },
        segments: [],
      }),
    });
    const dataB = await resB.json();
    assert.equal(resB.status, 200, `Case B failed: ${JSON.stringify(dataB)}`);
    assert.equal(dataB.success, true);
    if (dataB.outputFilename) {
      createdDownloads.push(path.join(downloadsDir, dataB.outputFilename));
    }
    const ep2OutPath = path.join(ep2VideoDir, dataB.outputFilename);
    assert.ok(fs.existsSync(ep2SourcePath), "Source MP4 must still exist on exact-stem collision");
    assert.equal(sha256File(ep2SourcePath), ep2SourceSha, "Source MP4 bytes must be untouched on exact-stem collision");
    assert.equal(fs.statSync(ep2SourcePath).size, ep2SourceSize);
    assert.equal(dataB.outputFilename, "custom_drama_clip_Khmer_Dubbed.mp4");
    assert.ok(fs.existsSync(ep2OutPath), "Renamed output video must exist");
  } finally {
    try { if (typeof server.closeAllConnections === "function") server.closeAllConnections(); } catch (_) {}
    server.close();
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
    for (const dl of createdDownloads) {
      try { if (fs.existsSync(dl)) fs.unlinkSync(dl); } catch (_) {}
    }
  }
});
