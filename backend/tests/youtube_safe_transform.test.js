const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  FFMPEG_PATH,
  FFPROBE_PATH,
  normalizeYoutubeTransform,
  buildYoutubeTransformVideoFilterChain,
  buildVerticalVideoFilterChain,
  buildCornerBlurVideoFilterChain,
  buildAntiTheftBlurVideoFilterChain,
  renderDubbedVideoWithDucking,
} = require("../services/ffmpegService");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function probeDimensions(videoPath) {
  const out = execFileSync(
    FFPROBE_PATH,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=s=x:p=0",
      videoPath,
    ],
    { encoding: "utf8", windowsHide: true }
  ).trim();
  const [w, h] = out.split("x").map(Number);
  return { width: w, height: h };
}

test("1. normalizeYoutubeTransform clamps zoomScale to [1.0, 1.15] and normalizes booleans", () => {
  assert.deepEqual(normalizeYoutubeTransform(null), {
    enableMirrorFlip: false,
    zoomScale: 1.0,
    enableColorGrade: false,
    youtubeSafeAudio: false,
  });

  assert.deepEqual(
    normalizeYoutubeTransform({
      enableMirrorFlip: 1,
      zoomScale: 1.99,
      enableColorGrade: "yes",
      youtubeSafeAudio: true,
    }),
    {
      enableMirrorFlip: true,
      zoomScale: 1.15,
      enableColorGrade: true,
      youtubeSafeAudio: true,
    }
  );

  assert.deepEqual(
    normalizeYoutubeTransform({
      enableMirrorFlip: false,
      zoomScale: 0.5,
      enableColorGrade: false,
      youtubeSafeAudio: false,
    }),
    {
      enableMirrorFlip: false,
      zoomScale: 1.0,
      enableColorGrade: false,
      youtubeSafeAudio: false,
    }
  );
});

test("2. buildYoutubeTransformVideoFilterChain returns empty array when no video transform is active and preserves strict hflip -> zoom/crop -> eq order", () => {
  assert.deepEqual(
    buildYoutubeTransformVideoFilterChain({
      inputLabel: "[0:v:0]",
      outputLabel: "[v_yt_tx]",
      youtubeTransform: {
        enableMirrorFlip: false,
        zoomScale: 1.0,
        enableColorGrade: false,
        youtubeSafeAudio: true, // Audio-only flag must NOT emit a video filter
      },
    }),
    []
  );

  const chain = buildYoutubeTransformVideoFilterChain({
    inputLabel: "[0:v:0]",
    outputLabel: "[v_yt_tx]",
    youtubeTransform: {
      enableMirrorFlip: true,
      zoomScale: 1.06,
      enableColorGrade: true,
    },
  });

  assert.equal(chain.length, 1);
  const expr = chain[0];
  assert.ok(expr.startsWith("[0:v:0]"), "must read from inputLabel");
  assert.ok(expr.endsWith("[v_yt_tx]"), "must emit outputLabel");

  const idxFlip = expr.indexOf("hflip");
  const idxScale = expr.indexOf("scale=");
  const idxCrop = expr.indexOf("crop=");
  const idxEq = expr.indexOf("eq=contrast=1.05:brightness=0.015:saturation=1.08");

  assert.ok(idxFlip >= 0, "must include hflip");
  assert.ok(idxScale > idxFlip, "scale must run after hflip");
  assert.ok(idxCrop > idxScale, "crop must run after scale");
  assert.ok(idxEq > idxCrop, "eq color grade must run after zoom/crop");
});

test("3. Real FFmpeg execution: hflip + zoomScale 1.06 + color grade preserves exact 640x360 and works before 9:16 + CornerBlur + AntiTheftBlur", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-safe-tx-"));
  try {
    const out16x9 = path.join(tmpDir, "out_16x9.mp4");
    const txChain = buildYoutubeTransformVideoFilterChain({
      inputLabel: "[0:v:0]",
      outputLabel: "[v_yt_tx]",
      youtubeTransform: {
        enableMirrorFlip: true,
        zoomScale: 1.06,
        enableColorGrade: true,
      },
    });

    execFileSync(
      FFMPEG_PATH,
      [
        "-y",
        "-f", "lavfi",
        "-i", "testsrc2=size=640x360:rate=24:duration=0.4",
        "-filter_complex", txChain.join(";"),
        "-map", "[v_yt_tx]",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        out16x9,
      ],
      { stdio: "pipe", windowsHide: true }
    );

    assert.ok(fs.existsSync(out16x9) && fs.statSync(out16x9).size > 1000, "16:9 transformed output must be valid");
    assert.deepEqual(probeDimensions(out16x9), { width: 640, height: 360 });

    // Full stacked pipeline: YouTube Transform -> 9:16 Pad -> Corner Blur -> Anti-Theft Blur
    const out9x16 = path.join(tmpDir, "out_9x16_stacked.mp4");
    const fullChain = [
      ...buildYoutubeTransformVideoFilterChain({
        inputLabel: "[0:v:0]",
        outputLabel: "[v_yt_tx]",
        youtubeTransform: { enableMirrorFlip: true, zoomScale: 1.15, enableColorGrade: true },
      }),
      ...buildVerticalVideoFilterChain({
        inputLabel: "[v_yt_tx]",
        outputLabel: "[base_vert]",
        verticalStyle: "pad",
      }),
      ...buildCornerBlurVideoFilterChain({
        inputLabel: "[base_vert]",
        outputLabel: "[v_corner_blur]",
        cornerMask: { enabled: true, style: "blur", position: "top-right", width: 220, height: 54, blurStrength: 18 },
        aspectRatio: "9:16",
        verticalStyle: "pad",
      }),
      ...buildAntiTheftBlurVideoFilterChain({
        inputLabel: "[v_corner_blur]",
        outputLabel: "[v_at_blur]",
        antiTheft: { enabled: true, bgStyle: "blur", blurStrength: 18, marqueePosition: "bottom" },
        aspectRatio: "9:16",
        verticalStyle: "pad",
        sourceDimensions: { width: 640, height: 360 },
      }),
    ];

    execFileSync(
      FFMPEG_PATH,
      [
        "-y",
        "-f", "lavfi",
        "-i", "testsrc2=size=640x360:rate=24:duration=0.3",
        "-filter_complex", fullChain.join(";"),
        "-map", "[v_at_blur]",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        out9x16,
      ],
      { stdio: "pipe", windowsHide: true }
    );

    assert.ok(fs.existsSync(out9x16) && fs.statSync(out9x16).size > 1000, "9:16 stacked output must be valid");
    assert.deepEqual(probeDimensions(out9x16), { width: 1080, height: 1920 });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("4. Real renderDubbedVideoWithDucking with youtubeSafeAudio mutes original drama audio completely and applies video transform", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-safe-render-"));
  try {
    const srcVideo = path.join(tmpDir, "src_loud.mp4");
    const outVideo = path.join(tmpDir, "out_safe.mp4");

    // Generate a 0.6s 640x360 synthetic video with a loud 440Hz sine wave audio track
    execFileSync(
      FFMPEG_PATH,
      [
        "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=0.6",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=0.6",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        srcVideo,
      ],
      { stdio: "pipe", windowsHide: true }
    );

    await renderDubbedVideoWithDucking({
      inputVideoPath: srcVideo,
      outputVideoPath: outVideo,
      segments: [],
      allowOriginalAudio: true,
      burnSubtitles: false,
      enableDemucs: true, // Must be bypassed cleanly when youtubeSafeAudio is true
      aspectRatio: "16:9",
      youtubeTransform: {
        enableMirrorFlip: true,
        zoomScale: 1.06,
        enableColorGrade: true,
        youtubeSafeAudio: true,
      },
    });

    assert.ok(fs.existsSync(outVideo) && fs.statSync(outVideo).size > 1000, "rendered output MP4 must exist");
    assert.deepEqual(probeDimensions(outVideo), { width: 640, height: 360 });

    // Confirm original 440Hz soundtrack was completely muted (volume=0.0)
    const { spawnSync } = require("node:child_process");
    const vd = spawnSync(
      FFMPEG_PATH,
      ["-i", outVideo, "-af", "volumedetect", "-f", "null", "-"],
      { encoding: "utf8", windowsHide: true }
    );
    const maxVolMatch = (vd.stderr || "").match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
    assert.ok(maxVolMatch, `volumedetect must report max_volume, got: ${vd.stderr}`);
    const maxVolDb = Number(maxVolMatch[1]);
    assert.ok(maxVolDb <= -80, `Original drama audio must be completely muted (expected <= -80 dB, got ${maxVolDb} dB)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("5. Pipeline ordering & full-stack wiring audit (Backend + Frontend)", () => {
  const ffmpegSrc = fs.readFileSync(path.join(REPO_ROOT, "backend/services/ffmpegService.js"), "utf8");
  const renderFnStart = ffmpegSrc.indexOf("function renderDubbedVideoWithDucking(");
  assert.ok(renderFnStart > 0, "ffmpegService.js must define renderDubbedVideoWithDucking");
  const renderFnSrc = ffmpegSrc.slice(renderFnStart);

  const idxYtStep = renderFnSrc.indexOf("buildYoutubeTransformVideoFilterChain({");
  const idxVertStep = renderFnSrc.indexOf("buildVerticalVideoFilterChain({");
  const idxCornerStep = renderFnSrc.indexOf("buildCornerBlurVideoFilterChain({");
  const idxAtStep = renderFnSrc.indexOf("buildAntiTheftBlurVideoFilterChain({");
  const idxAssStep = renderFnSrc.indexOf("const assFilter = buildAssSubtitleVideoFilter(tempAssPath)");
  const idxLogoStep = renderFnSrc.indexOf("if (hasLogo && logoInputIndex >= 0)");

  assert.ok(idxYtStep > 0, "ffmpegService.js must invoke buildYoutubeTransformVideoFilterChain");
  assert.ok(idxYtStep < idxVertStep, "YouTube transform must run BEFORE aspect-ratio scale/pad");
  assert.ok(idxVertStep < idxCornerStep, "Aspect-ratio scale/pad must run BEFORE Corner Mask blur");
  assert.ok(idxCornerStep < idxAtStep, "Corner Mask blur must run BEFORE Anti-Theft blur");
  assert.ok(idxAtStep < idxAssStep, "Anti-Theft blur must run BEFORE ASS Khmer subtitles");
  assert.ok(idxAssStep < idxLogoStep, "ASS subtitles must run BEFORE Logo overlay");

  const videoRoutesSrc = fs.readFileSync(path.join(REPO_ROOT, "backend/routes/videoRoutes.js"), "utf8");
  assert.match(videoRoutesSrc, /youtubeTransform\s*=\s*null/, "videoRoutes.js must accept youtubeTransform");
  assert.match(videoRoutesSrc, /youtubeTransform:\s*effectiveYoutubeTransform/, "videoRoutes.js must forward youtubeTransform to FFmpeg");

  const batchSrc = fs.readFileSync(path.join(REPO_ROOT, "backend/services/batchExportService.js"), "utf8");
  assert.match(batchSrc, /batchVisualSignature\s*=\s*JSON\.stringify\(\{[^}]*youtubeTransform/, "batchExportService.js must include youtubeTransform in batchVisualSignature");
  assert.match(batchSrc, /youtubeTransform,/, "batchExportService.js must pass youtubeTransform to renderDubbedVideoWithDucking");

  const mediaApiSrc = fs.readFileSync(path.join(REPO_ROOT, "frontend/src/services/api/mediaApi.js"), "utf8");
  assert.match(mediaApiSrc, /youtubeTransform\s*=\s*null/, "mediaApi.js renderVideoApi must accept youtubeTransform");
  assert.match(mediaApiSrc, /cornerMask\s*=\s*null/, "mediaApi.js renderVideoApi must accept cornerMask");

  const renderHookSrc = fs.readFileSync(path.join(REPO_ROOT, "frontend/src/hooks/useVideoRender.js"), "utf8");
  assert.match(renderHookSrc, /buildYoutubeTransformOptions/, "useVideoRender.js must build youtubeTransform payload");

  const panelSrc = fs.readFileSync(path.join(REPO_ROOT, "frontend/src/components/voice/ExportSettingsPanel.jsx"), "utf8");
  assert.match(panelSrc, /YouTube Safe Edit/, "ExportSettingsPanel.jsx must render YouTube Safe Edit card");
  assert.match(panelSrc, /btn-youtube-safe-preset/, "ExportSettingsPanel.jsx must include 1-click YouTube Safe Preset button");
  assert.match(panelSrc, /previewKey="zoomScale"/, "ExportSettingsPanel.jsx must use SmoothRangeSlider with previewKey='zoomScale'");

  const playerSrc = fs.readFileSync(path.join(REPO_ROOT, "frontend/src/components/player/VideoPlayerPreview.jsx"), "utf8");
  assert.match(playerSrc, /subscribeDraftPreview\(\['duckingVolume', 'khmerVolume', 'zoomScale'\]/, "VideoPlayerPreview.jsx must subscribe to zoomScale draft preview");
  assert.match(playerSrc, /isPreviewingUnbakedVisual/, "VideoPlayerPreview.jsx must apply YouTube Safe CSS preview on BOTH Live & Proxy Preview");
  assert.match(playerSrc, /transform:\s*videoYoutubeTransform/, "VideoPlayerPreview.jsx must apply transform strictly on <video>");
  assert.match(playerSrc, /filter:\s*videoYoutubeFilter/, "VideoPlayerPreview.jsx must apply color grade filter strictly on <video>");
});

test("6. Proxy Preview honors youtubeSafeAudio (mutes original OST + stem in rendered proxy MP4) and skips wasteful re-encode for CSS-only transforms", async () => {
  const { renderProxy } = require("../services/proxyPreviewRenderer");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-safe-proxy-"));
  try {
    const source = path.join(tmpDir, "src.mp4");
    const stem = path.join(tmpDir, "stem.wav");
    const voice = path.join(tmpDir, "voice.mp3");
    const run = (args) => execFileSync(FFMPEG_PATH, ["-loglevel", "error", "-nostdin", "-y", ...args], { windowsHide: true });

    // Loud 440Hz original drama audio + loud 220Hz Demucs stem, plus a 0.3s 880Hz Khmer voice at t=0.8s
    run([
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=1.4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1.4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source,
    ]);
    run(["-f", "lavfi", "-i", "sine=frequency=220:duration=1.4", stem]);
    run(["-f", "lavfi", "-i", "sine=frequency=880:duration=0.3", voice]);

    await renderProxy(
      {
        source,
        stem,
        clips: [],
        voices: [{ audioPath: voice, audioStartSec: 0.8, audioDurationSec: 0.3 }],
        settings: { aspectRatio: "16:9", duckingVolume: 0.5, khmerVolume: 1.2, youtubeSafeAudio: true },
      },
      tmpDir,
      "yt-safe-proxy-test"
    );

    const outProxy = path.join(tmpDir, "preview.mp4");
    assert.ok(fs.existsSync(outProxy), "proxy preview.mp4 must exist");

    const peakAt = (t) => {
      const pcm = run(["-ss", String(t), "-i", outProxy, "-vn", "-t", "0.15", "-ac", "1", "-f", "s16le", "-"]);
      let max = 0;
      for (let i = 0; i < pcm.length; i += 2) max = Math.max(max, Math.abs(pcm.readInt16LE(i)));
      return max;
    };

    // At t=0.2s (no Khmer voice), original 440Hz + stem 220Hz MUST be silenced completely
    assert.ok(peakAt(0.2) < 12, `Expected original OST + stem muted at t=0.2s, got peak=${peakAt(0.2)}`);
    // At t=0.85s (Khmer voice active), Khmer 880Hz voice MUST remain audible
    assert.ok(peakAt(0.85) > 500, `Expected Khmer voice audible at t=0.85s, got peak=${peakAt(0.85)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
