const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readRel(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function countLines(relPath) {
  return readRel(relPath).split(/\r?\n/).length;
}

test("Step 1 (Rule B — No 1-Function Files): cleanKhmer.js & formatTime.js removed, cleanKhmerText merged into khmerTextSplitter.js", () => {
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, "frontend/src/utils/cleanKhmer.js")),
    false,
    "cleanKhmer.js (1-function file) must be deleted"
  );
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, "frontend/src/utils/formatTime.js")),
    false,
    "formatTime.js (0-function re-export wrapper) must be deleted"
  );

  const splitterSrc = readRel("frontend/src/utils/khmerTextSplitter.js");
  assert.match(splitterSrc, /export function cleanKhmerText\(/, "khmerTextSplitter.js must export cleanKhmerText");
  assert.match(splitterSrc, /export function splitKhmerTextIntoHalves\(/);
  assert.match(splitterSrc, /export function isLongKhmerSubtitle\(/);
  assert.match(splitterSrc, /export function getLivePagedSubtitle\(/);

  // Verify updated callers no longer import deleted files
  const callers = [
    "frontend/src/components/media/ScriptReviewTab.jsx",
    "frontend/src/components/voice/ClipInspectorPanel.jsx",
    "frontend/src/hooks/useAudioDubbing.js",
    "frontend/src/components/dashboard/GeminiRouteModal.jsx",
    "frontend/src/components/media/EpisodesTab.jsx",
    "frontend/src/components/media/MediaUploadTab.jsx",
    "frontend/src/components/player/LiveSubtitleOverlay.jsx",
    "frontend/src/components/player/PlayerControls.jsx",
    "frontend/src/components/timeline/TimelineTracksCanvas.jsx",
  ];
  for (const rel of callers) {
    const src = readRel(rel);
    assert.doesNotMatch(src, /utils\/cleanKhmer/, `${rel} must not import deleted cleanKhmer.js`);
    assert.doesNotMatch(src, /utils\/formatTime/, `${rel} must not import deleted formatTime.js`);
  }
});

test("Step 2 (Rule A — Backend Multi-Function Modules): ffmpegService, stage3, and stage6 decomposed with 100% export compatibility", () => {
  // 2A: ffmpegService.js -> backend/services/ffmpeg/{ffmpegProbeAndFrames, ffmpegAudioMixAndDucking, ffmpegSubtitleAndOverlayFilters}.js
  const ffmpegSubModules = [
    "backend/services/ffmpeg/ffmpegProbeAndFrames.js",
    "backend/services/ffmpeg/ffmpegAudioMixAndDucking.js",
    "backend/services/ffmpeg/ffmpegSubtitleAndOverlayFilters.js",
  ];
  for (const rel of ffmpegSubModules) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} must exist`);
    const mod = require(path.join(REPO_ROOT, rel));
    const fnCount = Object.values(mod).filter((v) => typeof v === "function").length;
    assert.ok(fnCount >= 3, `${rel} must group 3+ cohesive functions (found ${fnCount})`);
  }

  const ffmpegService = require("../services/ffmpegService");
  for (const key of [
    "FFMPEG_PATH",
    "FFPROBE_PATH",
    "getVideoMetadata",
    "extractFramesAtTimestamps",
    "detectSubtitleChangePoints",
    "buildDynamicDuckingFilter",
    "buildAtempoFilter",
    "trimTtsSilence",
    "autoStretchTtsAudio",
    "applyExactAudioSpeed",
    "generateKhmerAssSubtitleFile",
    "buildVerticalVideoFilterChain",
    "buildCornerBlurVideoFilterChain",
    "buildAntiTheftBlurVideoFilterChain",
    "buildYoutubeTransformVideoFilterChain",
    "renderDubbedVideoWithDucking",
    "mergeVideosConcat",
  ]) {
    assert.notEqual(ffmpegService[key], undefined, `ffmpegService must re-export ${key}`);
  }
  assert.ok(countLines("backend/services/ffmpegService.js") < 1600, "ffmpegService.js should be slimmed down to < 1,600 lines");

  // 2B: stage3_extractChineseSubtitles.js -> stage3VisionBatchRunner.js
  const stage3RunnerPath = "backend/services/pipeline/stages/stage3VisionBatchRunner.js";
  assert.ok(fs.existsSync(path.join(REPO_ROOT, stage3RunnerPath)), "stage3VisionBatchRunner.js must exist");
  const stage3Runner = require("../services/pipeline/stages/stage3VisionBatchRunner");
  const s3FnCount = Object.values(stage3Runner).filter((v) => typeof v === "function").length;
  assert.ok(s3FnCount >= 10, `stage3VisionBatchRunner.js must export 10+ cohesive functions (found ${s3FnCount})`);
  const stage3 = require("../services/pipeline/stages/stage3_extractChineseSubtitles");
  for (const key of [
    "extractChineseSubtitles",
    "callGeminiVisionWithRetry",
    "parseVisionResponseFrames",
    "buildVisionBatchContents",
    "getOcrCachePath",
    "deduplicateFastOcrCues",
  ]) {
    assert.equal(typeof stage3[key], "function", `stage3_extractChineseSubtitles must export ${key}`);
  }

  // 2C: stage6_generateModeSpecificScript.js -> stage6PromptAndConsistency.js
  const stage6HelperPath = "backend/services/pipeline/stages/stage6PromptAndConsistency.js";
  assert.ok(fs.existsSync(path.join(REPO_ROOT, stage6HelperPath)), "stage6PromptAndConsistency.js must exist");
  const stage6Helper = require("../services/pipeline/stages/stage6PromptAndConsistency");
  const s6FnCount = Object.values(stage6Helper).filter((v) => typeof v === "function").length;
  assert.ok(s6FnCount >= 15, `stage6PromptAndConsistency.js must export 15+ cohesive functions (found ${s6FnCount})`);
  const stage6 = require("../services/pipeline/stages/stage6_generateModeSpecificScript");
  for (const key of [
    "generateModeSpecificScript",
    "createCanonicalSegment",
    "enforceEpisodeCharacterConsistency",
    "detectDramaGenre",
    "getGenrePromptGuidelines",
    "condenseKhmerDialogue",
  ]) {
    assert.equal(typeof stage6[key], "function", `stage6_generateModeSpecificScript must export ${key}`);
  }
  assert.ok(countLines("backend/services/pipeline/stages/stage6_generateModeSpecificScript.js") < 1200);
});

test("Step 3 (Rule A — Frontend Multi-Function Modules): DubbingRunnerContext, GeminiRouteModal, and VideoPlayerPreview decomposed cleanly", () => {
  // 3A: singleEpisodeRunners.js (5 single-episode runners)
  const runnersSrc = readRel("frontend/src/features/dubbing-runner/singleEpisodeRunners.js");
  for (const fn of [
    "runSingleTranslate",
    "runSingleTextRepair",
    "runSingleVoice",
    "runSingleCleanBgm",
    "runSingleAutoFitSpeed",
  ]) {
    assert.match(runnersSrc, new RegExp(`export async function ${fn}\\(`), `singleEpisodeRunners.js must export ${fn}`);
  }
  assert.ok(countLines("frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx") < 850);

  // 3B: BatchScriptSetupPanel.jsx & BatchEpisodeCard.jsx called by GeminiRouteModal.jsx
  const modalSrc = readRel("frontend/src/components/dashboard/GeminiRouteModal.jsx");
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "frontend/src/components/dashboard/BatchScriptSetupPanel.jsx")));
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "frontend/src/components/dashboard/BatchEpisodeCard.jsx")));
  assert.match(modalSrc, /import BatchScriptSetupPanel from '\.\/BatchScriptSetupPanel'/);
  assert.match(modalSrc, /import BatchEpisodeCard from '\.\/BatchEpisodeCard'/);
  assert.match(modalSrc, /<BatchScriptSetupPanel\b/);
  assert.match(modalSrc, /<BatchEpisodeCard\b/);
  assert.ok(countLines("frontend/src/components/dashboard/GeminiRouteModal.jsx") < 3200);

  // 3C: usePlayerAudioSync.js (3+ cohesive exports) called by VideoPlayerPreview.jsx
  const audioSyncSrc = readRel("frontend/src/components/player/usePlayerAudioSync.js");
  assert.match(audioSyncSrc, /export function buildSpeakingIntervals\(/);
  assert.match(audioSyncSrc, /export function findIntervalAtTime\(/);
  assert.match(audioSyncSrc, /export function usePlayerAudioSync\(/);
  const playerSrc = readRel("frontend/src/components/player/VideoPlayerPreview.jsx");
  assert.match(playerSrc, /import \{ usePlayerAudioSync \} from '\.\/usePlayerAudioSync'/);
  assert.match(playerSrc, /usePlayerAudioSync\(\{/);
  assert.ok(countLines("frontend/src/components/player/VideoPlayerPreview.jsx") < 1600);
});
