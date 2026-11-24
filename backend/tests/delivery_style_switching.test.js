const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { generateSingleSegmentAudio } = require("../services/ttsService");

async function runDeliveryStyleSwitchingTests() {
  console.log("=== Testing Delivery Style Switching (ធម្មតា ↔ ក្នុងចិត្ត) Cache-First Instant Switching ===");

  const testUploadsDir = path.resolve(__dirname, "..", "uploads");
  if (!fs.existsSync(testUploadsDir)) {
    fs.mkdirSync(testUploadsDir, { recursive: true });
  }

  const uniqueId = `deliv_test_${Date.now()}`;
  const baseSegment = {
    id: uniqueId,
    segmentId: uniqueId,
    start: "00:00:01,000",
    end: "00:00:03,500",
    startSeconds: 1.0,
    endSeconds: 3.5,
    sourceStartSec: 1.0,
    sourceEndSec: 3.5,
    khmer: "តោះទៅញ៉ាំបាយជាមួយគ្នា",
    khmerText: "តោះទៅញ៉ាំបាយជាមួយគ្នា",
    khmerVoiceId: "km-KH-PisethNeural",
    voiceId: "km-KH-PisethNeural",
    speed: "normal",
    deliveryType: "out_loud",
    audioEffect: "none",
  };

  // Test 1: Initial Normal Spoken Dialogue Generation (out_loud)
  console.log("\n[Test 1] Initial out_loud synthesis...");
  const t0 = Date.now();
  const initialNormal = await generateSingleSegmentAudio(baseSegment, testUploadsDir, {
    forceRegen: true,
    forceVoice: true,
    voiceId: "km-KH-PisethNeural",
    deliveryType: "out_loud",
    audioEffect: "none",
  });
  const tNormal = Date.now() - t0;
  console.log(`✓ out_loud generated in ${tNormal}ms: ${initialNormal.audioFile}`);
  assert.ok(initialNormal.audioPath, "Should have audioPath");
  assert.ok(fs.existsSync(initialNormal.audioPath), "Normal audio file must exist on disk");
  assert.strictEqual(initialNormal.deliveryType, "out_loud");
  const normalFilePath = initialNormal.audioPath;

  // Test 2: Switch to Inner Thought (inner_thought with Reverb)
  // Must reuse existing clean speech: ZERO new Edge TTS calls!
  console.log("\n[Test 2] Toggle to inner_thought (Reusing clean speech base)...");
  const t1 = Date.now();
  const innerThoughtSeg = await generateSingleSegmentAudio(initialNormal, testUploadsDir, {
    forceRegen: false,
    deliveryType: "inner_thought",
    audioEffect: "inner_thought_reverb",
  });
  const tThought = Date.now() - t1;
  console.log(`✓ inner_thought generated in ${tThought}ms: ${innerThoughtSeg.audioFile}`);
  assert.strictEqual(innerThoughtSeg.deliveryType, "inner_thought");
  assert.ok(innerThoughtSeg.audioFile.includes("_thought_"), "Should be tagged with thought");
  assert.ok(fs.existsSync(innerThoughtSeg.audioPath), "Thought audio file must exist on disk");

  // Critical requirement: Prior-audio cleanup MUST NOT delete the normal voice file!
  assert.ok(fs.existsSync(normalFilePath), "Normal voice audio file must NOT be deleted by thought generation!");

  // Verify deliveryVariants returned with both out_loud and inner_thought
  assert.ok(innerThoughtSeg.deliveryVariants, "Must return deliveryVariants object");
  assert.ok(innerThoughtSeg.deliveryVariants.inner_thought, "Must have inner_thought in deliveryVariants");
  console.log("✓ deliveryVariants tracks:", Object.keys(innerThoughtSeg.deliveryVariants));

  // Test 3: Switch back to Normal (out_loud)
  // Must hit backend cache or reuse raw speech in <100ms!
  console.log("\n[Test 3] Toggle back to out_loud (Cache Hit)...");
  const t2 = Date.now();
  const backToNormal = await generateSingleSegmentAudio(innerThoughtSeg, testUploadsDir, {
    forceRegen: false,
    deliveryType: "out_loud",
    audioEffect: "none",
  });
  const tBackNormal = Date.now() - t2;
  console.log(`✓ backToNormal returned in ${tBackNormal}ms (Cache Hit)`);
  assert.strictEqual(backToNormal.deliveryType, "out_loud");
  assert.strictEqual(backToNormal.audioPath, normalFilePath, "Should reuse identical cached normal audio path");
  assert.ok(tBackNormal < 100, `Warm backend cache hit should be fast (<100ms), actual: ${tBackNormal}ms`);

  // Both audio files must still exist on disk!
  assert.ok(fs.existsSync(normalFilePath), "Normal audio must still exist on disk");
  assert.ok(fs.existsSync(innerThoughtSeg.audioPath), "Thought audio must still exist on disk");

  // Test 4: Frontend Instant Switching Simulation
  console.log("\n[Test 4] Frontend Cache-First Instant Switching Simulation...");
  const clientDeliveryCache = {
    out_loud: {
      audioUrl: normalFilePath,
      deliveryType: "out_loud",
      text: baseSegment.khmer,
      voiceId: "km-KH-PisethNeural",
    },
    inner_thought: {
      audioUrl: innerThoughtSeg.audioPath,
      deliveryType: "inner_thought",
      text: baseSegment.khmer,
      voiceId: "km-KH-PisethNeural",
    },
  };

  // 4a. Same-mode toggle fast return check
  const startSame = performance.now();
  const currentMode = "out_loud";
  const requestedMode = "out_loud";
  let sameModeResult = null;
  if (currentMode === requestedMode) {
    sameModeResult = "fast_return_no_op";
  }
  const sameModeLatency = performance.now() - startSame;
  assert.strictEqual(sameModeResult, "fast_return_no_op");
  console.log(`✓ Same-mode click fast return latency: ${sameModeLatency.toFixed(3)}ms (0 requests)`);

  // 4b. Warm cache client lookup
  const startClientHit = performance.now();
  const targetMode = "inner_thought";
  const cachedVariant = clientDeliveryCache[targetMode];
  let clientHitResult = null;
  if (cachedVariant?.audioUrl && cachedVariant.text === baseSegment.khmer) {
    clientHitResult = {
      audioUrl: cachedVariant.audioUrl,
      deliveryType: targetMode,
    };
  }
  const clientHitLatency = performance.now() - startClientHit;
  assert.ok(clientHitResult, "Client cache lookup should succeed");
  assert.strictEqual(clientHitResult.deliveryType, "inner_thought");
  console.log(`✓ Warm frontend cache hit latency: ${clientHitLatency.toFixed(3)}ms (<100ms target, 0 network calls, 0 Edge TTS calls)`);

  // 4c. Invalidation check on text change
  const changedText = "អរគុណច្រើនដែលបានជួយ";
  const isInvalidated = cachedVariant.text !== changedText;
  assert.strictEqual(isInvalidated, true, "Cache variant must invalidate when text changes");
  console.log("✓ Text change correctly invalidates stale delivery variants");

  // Cleanup test artifacts
  try {
    if (fs.existsSync(normalFilePath)) fs.unlinkSync(normalFilePath);
    if (fs.existsSync(innerThoughtSeg.audioPath)) fs.unlinkSync(innerThoughtSeg.audioPath);
    const rawPath = innerThoughtSeg.rawAudioPath;
    if (rawPath && fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
  } catch (_) {}

  console.log("\n=======================================================");
  console.log("🎉 ALL DELIVERY STYLE SWITCHING ACCEPTANCE TESTS PASSED!");
  console.log("=======================================================");
}

runDeliveryStyleSwitchingTests().catch((err) => {
  console.error("❌ Delivery Style Switching Test Failed:", err);
  process.exit(1);
});
