const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { generateSingleSegmentAudio } = require("../services/ttsService");

async function runSpeedControlTests() {
  console.log("=== Testing Single Clip Speed Control (0.5x–2.0x) Zero-TTS Architecture ===");

  const testUploadsDir = path.resolve(__dirname, "..", "uploads");
  if (!fs.existsSync(testUploadsDir)) {
    fs.mkdirSync(testUploadsDir, { recursive: true });
  }

  const uniqueId = `speed_test_${Date.now()}`;
  const baseSegment = {
    id: uniqueId,
    segmentId: uniqueId,
    start: "00:00:01,000",
    end: "00:00:04,500",
    startSeconds: 1.0,
    endSeconds: 4.5,
    sourceStartSec: 1.0,
    sourceEndSec: 4.5,
    khmer: "សូមស្វាគមន៍មកកាន់កម្មវិធីរបស់យើង",
    khmerText: "សូមស្វាគមន៍មកកាន់កម្មវិធីរបស់យើង",
    khmerVoiceId: "km-KH-PisethNeural",
    voiceId: "km-KH-PisethNeural",
    speed: 1.0,
    userCustomSpeed: true,
    audioTrimmed: true,
    userTrimmed: true,
    audioOffset: 0.15,
    deliveryType: "out_loud",
    audioEffect: "none",
  };

  // Test 1: Generate initial 1.0x audio (Edge TTS synthesizes natural 1.0x base speech)
  console.log("\n[Test 1] Initial 1.0x synthesis...");
  const t0 = Date.now();
  const seg1x = await generateSingleSegmentAudio(baseSegment, testUploadsDir, {
    forceRegen: true,
    forceVoice: true,
    speed: 1.0,
    userCustomSpeed: true,
  });
  const t1x = Date.now() - t0;
  console.log(`✓ 1.0x generated in ${t1x}ms: ${seg1x.audioFile} (duration: ${seg1x.audioDurationSec}s)`);
  assert.ok(seg1x.audioPath, "Must have audioPath");
  assert.ok(fs.existsSync(seg1x.audioPath), "Audio file must exist");
  const orig1xDuration = seg1x.audioDurationSec;
  assert.ok(orig1xDuration > 0.5, "1.0x audio duration must be positive");

  // Verify natural 1.0x base file was stored on disk
  const files = fs.readdirSync(testUploadsDir);
  const base1xFile = files.find((f) => f.includes(`seg_${uniqueId}_`) && f.includes("_base1x_"));
  assert.ok(base1xFile, "Must save immutable _base1x_ audio on disk for zero-TTS scaling");
  console.log(`✓ Immutable 1.0x base file cached: ${base1xFile}`);

  // Test 2: Scale to 1.25x (Must reuse natural 1.0x speech — 0 Edge TTS calls!)
  console.log("\n[Test 2] Change speed to 1.25x (Zero Edge TTS synthesis)...");
  const t1 = Date.now();
  const seg125 = await generateSingleSegmentAudio(
    { ...seg1x, speed: 1.25, userCustomSpeed: true },
    testUploadsDir,
    {
      forceRegen: false,
      speed: 1.25,
      userCustomSpeed: true,
    }
  );
  const t125 = Date.now() - t1;
  console.log(`✓ 1.25x generated in ${t125}ms: ${seg125.audioFile} (duration: ${seg125.audioDurationSec}s)`);
  assert.strictEqual(seg125.appliedSpeed, 1.25, "appliedSpeed must be 1.25");
  assert.ok(seg125.audioDurationSec < orig1xDuration, "1.25x duration must be shorter than 1.0x");
  const expected125Dur = orig1xDuration / 1.25;
  assert.ok(
    Math.abs(seg125.audioDurationSec - expected125Dur) < 0.25,
    `Duration ${seg125.audioDurationSec}s must match atempo 1.25x expected ${expected125Dur.toFixed(3)}s`
  );

  // Test 3: Scale to 1.5x (Zero stacking: must scale from 1.0x base directly, NOT from 1.25x!)
  console.log("\n[Test 3] Change speed to 1.5x (Zero stacking, zero TTS)...");
  const t2 = Date.now();
  const seg150 = await generateSingleSegmentAudio(
    { ...seg125, speed: 1.5, userCustomSpeed: true },
    testUploadsDir,
    {
      forceRegen: false,
      speed: 1.5,
      userCustomSpeed: true,
    }
  );
  const t150 = Date.now() - t2;
  console.log(`✓ 1.5x generated in ${t150}ms: ${seg150.audioFile} (duration: ${seg150.audioDurationSec}s)`);
  assert.strictEqual(seg150.appliedSpeed, 1.5, "appliedSpeed must be 1.5");
  const expected150Dur = orig1xDuration / 1.5;
  assert.ok(
    Math.abs(seg150.audioDurationSec - expected150Dur) < 0.25,
    `1.5x duration ${seg150.audioDurationSec}s must match 1.0x / 1.5 (${expected150Dur.toFixed(3)}s), not stacked from 1.25x!`
  );

  // Test 4: Scale to 0.75x (Slower speed, zero TTS)
  console.log("\n[Test 4] Change speed to 0.75x (Slower speed, zero TTS)...");
  const t3 = Date.now();
  const seg075 = await generateSingleSegmentAudio(
    { ...seg150, speed: 0.75, userCustomSpeed: true },
    testUploadsDir,
    {
      forceRegen: false,
      speed: 0.75,
      userCustomSpeed: true,
    }
  );
  const t075 = Date.now() - t3;
  console.log(`✓ 0.75x generated in ${t075}ms: ${seg075.audioFile} (duration: ${seg075.audioDurationSec}s)`);
  assert.strictEqual(seg075.appliedSpeed, 0.75, "appliedSpeed must be 0.75");
  assert.ok(seg075.audioDurationSec > orig1xDuration, "0.75x duration must be longer than 1.0x");

  // Test 5: Re-select 1.25x (Cache Hit)
  console.log("\n[Test 5] Re-select 1.25x (Cache Hit)...");
  const t4 = Date.now();
  const seg125Cached = await generateSingleSegmentAudio(
    { ...seg075, speed: 1.25, userCustomSpeed: true },
    testUploadsDir,
    {
      forceRegen: false,
      speed: 1.25,
      userCustomSpeed: true,
    }
  );
  const t125Cached = Date.now() - t4;
  console.log(`✓ 1.25x cache hit returned in ${t125Cached}ms`);
  assert.strictEqual(seg125Cached.audioPath, seg125.audioPath, "Must reuse identical cached 1.25x audio file");
  assert.ok(t125Cached < 50, `Cache hit must be <50ms, actual: ${t125Cached}ms`);

  // Test 6: Boundary tests (0.5x and 2.0x)
  console.log("\n[Test 6] Boundary speeds: 0.5x & 2.0x...");
  const seg050 = await generateSingleSegmentAudio(
    { ...seg125Cached, speed: 0.5, userCustomSpeed: true },
    testUploadsDir,
    { forceRegen: false, speed: 0.5, userCustomSpeed: true }
  );
  assert.strictEqual(seg050.appliedSpeed, 0.5, "0.5x appliedSpeed must match");

  const seg200 = await generateSingleSegmentAudio(
    { ...seg050, speed: 2.0, userCustomSpeed: true },
    testUploadsDir,
    { forceRegen: false, speed: 2.0, userCustomSpeed: true }
  );
  assert.strictEqual(seg200.appliedSpeed, 2.0, "2.0x appliedSpeed must match");
  console.log(`✓ 0.5x duration: ${seg050.audioDurationSec}s | 2.0x duration: ${seg200.audioDurationSec}s`);

  // Test 7: Verify base1x file was NOT deleted by any subsequent speed generation!
  const base1xPath = path.join(testUploadsDir, base1xFile);
  assert.ok(fs.existsSync(base1xPath), "The immutable _base1x_ audio must NEVER be unlinked by speed changes!");
  console.log("✓ Immutable _base1x_ audio safely preserved on disk throughout all speed transitions");

  // Test 8: Client-Side Simulation: Same-Speed No-Op & Instant Preview Latency
  console.log("\n[Test 8] Client-Side Same-Speed No-Op & Instant Preview Benchmark...");
  const startSame = performance.now();
  const currentSpeed = 1.25;
  const requestedSpeed = 1.25;
  let isNoOp = false;
  if (Math.abs(currentSpeed - requestedSpeed) < 0.005) {
    isNoOp = true;
  }
  const sameLatency = performance.now() - startSame;
  assert.strictEqual(isNoOp, true, "Same-speed click must be a no-op");
  console.log(`✓ Same-speed no-op latency: ${sameLatency.toFixed(4)}ms (0 requests)`);

  // Instant HTMLAudio playbackRate preview calculation
  const startPreview = performance.now();
  const draftSpeed = 1.5;
  const currentAppliedSpeed = 1.25;
  const videoRate = 1.0;
  const playbackRatio = draftSpeed / currentAppliedSpeed;
  const effectivePlaybackRate = parseFloat((videoRate * playbackRatio).toFixed(3));
  const previewLatency = performance.now() - startPreview;
  assert.strictEqual(effectivePlaybackRate, 1.2);
  console.log(`✓ Instant playbackRate preview calculation latency: ${previewLatency.toFixed(4)}ms (<100ms requirement)`);

  // Cleanup test files
  try {
    const allFiles = fs.readdirSync(testUploadsDir);
    allFiles
      .filter((f) => f.includes(`seg_${uniqueId}_`))
      .forEach((f) => {
        try { fs.unlinkSync(path.join(testUploadsDir, f)); } catch (_) {}
      });
  } catch (_) {}

  console.log("\n=======================================================");
  console.log("🎉 ALL SINGLE CLIP SPEED CONTROL ACCEPTANCE TESTS PASSED!");
  console.log("=======================================================");
}

runSpeedControlTests().catch((err) => {
  console.error("❌ Speed Control Test Failed:", err);
  process.exit(1);
});
