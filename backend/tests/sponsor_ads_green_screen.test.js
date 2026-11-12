const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { renderDubbedVideoWithDucking } = require("../services/ffmpegService");

describe("Sponsor Ads Green Screen Chroma Key Pipeline", () => {
  const sampleSponsorPath = path.join(__dirname, "../../frontend/public/assets/sample_sponsor_green.mp4");
  const tempDir = path.join(__dirname, "../../backend/uploads/temp_test_sponsor");
  const tempSourceVideo = path.join(tempDir, "source_test.mp4");
  const tempOutputVideo = path.join(tempDir, "output_with_sponsor.mp4");

  test("Step 1: Sample sponsor green screen video exists in public assets", () => {
    assert.strictEqual(fs.existsSync(sampleSponsorPath), true, "sample_sponsor_green.mp4 should exist in public assets");
  });

  test("Step 2: FFmpeg renderDubbedVideoWithDucking overlays green screen sponsor with colorkey filter", async () => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Create a 2-second dummy source video (with audio) and master audio if not exists
    const { execSync } = require("child_process");
    const tempAudio = path.join(tempDir, "audio_test.mp3");
    execSync(`ffmpeg -y -f lavfi -i color=c=black:s=640x360:d=2 -f lavfi -i anullsrc=r=44100:cl=stereo -t 2 -c:v libx264 -c:a aac -pix_fmt yuv420p "${tempSourceVideo}"`, { stdio: "ignore" });
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 2 -q:a 9 "${tempAudio}"`, { stdio: "ignore" });

    // Render with sponsor video
    const res = await renderDubbedVideoWithDucking({
      inputVideoPath: tempSourceVideo,
      outputVideoPath: tempOutputVideo,
      masterAudioPath: tempAudio,
      fullAudioPath: tempAudio,
      soundMode: "ducking",
      burnSubtitles: false,
      aspectRatio: "16:9",
      sponsorSettings: {
        enabled: true,
        sponsorPath: sampleSponsorPath,
        chromaKey: true,
        chromaSimilarity: 0.28,
        position: "bottom-left",
        scale: 25,
        timingMode: "loop",
      },
    });

    assert.strictEqual(res.success, true, "renderDubbedVideoWithDucking should succeed");
    assert.strictEqual(fs.existsSync(tempOutputVideo), true, "Output video should be created");
    const stat = fs.statSync(tempOutputVideo);
    assert.ok(stat.size > 1000, "Output video should be non-empty");

    // Clean up temp
    try {
      if (fs.existsSync(tempSourceVideo)) fs.unlinkSync(tempSourceVideo);
      if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio);
      if (fs.existsSync(tempOutputVideo)) fs.unlinkSync(tempOutputVideo);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch {}
  });

  test("Step 3: Frontend SponsorOverlay component and backend upload route are wired", () => {
    const overlayPath = path.join(__dirname, "../../frontend/src/components/player/SponsorOverlay.jsx");
    const exportPanelPath = path.join(__dirname, "../../frontend/src/components/voice/ExportSettingsPanel.jsx");
    const systemRoutesPath = path.join(__dirname, "../../backend/routes/systemRoutes.js");

    assert.strictEqual(fs.existsSync(overlayPath), true, "SponsorOverlay.jsx should exist");
    const overlayCode = fs.readFileSync(overlayPath, "utf8");
    assert.match(overlayCode, /sponsorChromaKey/);
    assert.match(overlayCode, /canvasRef/);

    const exportPanelCode = fs.readFileSync(exportPanelPath, "utf8");
    assert.match(exportPanelCode, /Sponsor Ads \(Green Screen Video\)/);
    assert.match(exportPanelCode, /sponsorChromaKey/);
    assert.match(exportPanelCode, /upload-sponsor-video/);

    const systemRoutesCode = fs.readFileSync(systemRoutesPath, "utf8");
    assert.match(systemRoutesCode, /\/upload-sponsor-video/);
  });
});
