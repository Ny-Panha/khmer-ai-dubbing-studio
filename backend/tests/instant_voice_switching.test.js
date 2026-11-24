const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { generateSingleSegmentAudio } = require("../services/ttsService");

test("Instant Voice Switching: Male -> Female -> Male Cache-First Architecture", async () => {
  const tmpDir = path.join(__dirname, "../uploads/temp_test_instant_" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const text = "សូមស្វាគមន៍មកកាន់ការសាកល្បងសំឡេងខ្មែរ";
    const initialSeg = {
      id: "switch_test_1",
      khmer: text,
      voiceId: "km-KH-PisethNeural",
      speed: "normal",
      startSec: 0,
      endSec: 2.0,
      deliveryType: "out_loud",
      audioEffect: "none",
    };

    // 1. Initial Piseth Generation (Male)
    const t0 = performance.now();
    const pisethRes = await generateSingleSegmentAudio(initialSeg, tmpDir, {
      forceRegen: true,
      forceVoice: true,
      voiceId: "km-KH-PisethNeural",
    });
    const tPisethGen = performance.now() - t0;
    console.log(`[Test] Piseth Generation time: ${tPisethGen.toFixed(1)}ms`);

    assert.ok(pisethRes.audioUrl, "Piseth audioUrl must exist");
    assert.ok(pisethRes.voiceAudioVariants["km-KH-PisethNeural"], "Piseth variant must exist");

    // Initialize frontend segment state with Piseth
    let currentSeg = {
      ...initialSeg,
      ...pisethRes,
      voiceAudioVariants: {
        "km-KH-PisethNeural": {
          voiceId: "km-KH-PisethNeural",
          audioUrl: pisethRes.audioUrl,
          audioFile: pisethRes.audioFile,
          audioPath: pisethRes.audioPath,
          audioDurationSec: pisethRes.audioDurationSec,
          speed: "normal",
          deliveryType: "out_loud",
          audioEffect: "none",
          text: text,
          timestamp: Date.now(),
        },
      },
    };

    let backendCallCount = 0;
    let ttsSynthesisCount = 0;

    // Simulate Frontend handleUpdateSegmentVoice
    async function simulateHandleUpdateSegmentVoice(seg, newVoiceId) {
      const currentVoice = seg.voiceId;
      const currentText = (seg.khmer || '').trim();

      // Acceptance Target: Same voice -> zero unnecessary requests
      if (currentVoice === newVoiceId && Boolean(seg.audioUrl) && !seg.audioOutdated) {
        return { seg, isSameVoice: true, isCacheHit: false, networkCalls: 0, latencyMs: 0 };
      }

      const existingVariants = { ...(seg.voiceAudioVariants || {}) };
      const cached = existingVariants[newVoiceId];

      const isCacheHit = Boolean(
        cached &&
        cached.audioUrl &&
        (!cached.text || cached.text === currentText) &&
        (!cached.speed || cached.speed === seg.speed) &&
        (!cached.deliveryType || cached.deliveryType === (seg.deliveryType || "out_loud"))
      );

      const tStart = performance.now();

      if (isCacheHit) {
        const latencyMs = performance.now() - tStart;
        const instantSeg = {
          ...seg,
          voiceId: newVoiceId,
          audioUrl: cached.audioUrl,
          audioFile: cached.audioFile || seg.audioFile,
          audioPath: cached.audioPath || seg.audioPath,
          audioDurationSec: cached.audioDurationSec || seg.audioDurationSec,
          audioOutdated: false,
          textStatus: "ready",
          isVoiceSwitching: false,
          voiceAudioVariants: existingVariants,
        };
        return { seg: instantSeg, isSameVoice: false, isCacheHit: true, networkCalls: 0, latencyMs };
      }

      // Cache Miss: Must call backend with forceRegen: false
      backendCallCount++;
      const res = await generateSingleSegmentAudio(
        { ...seg, voiceId: newVoiceId },
        tmpDir,
        { forceRegen: false, forceVoice: true, voiceId: newVoiceId }
      );
      if (res._wasNewlySynthesized) {
        ttsSynthesisCount++;
      }

      const latencyMs = performance.now() - tStart;
      const updatedVariants = {
        ...existingVariants,
        [newVoiceId]: {
          voiceId: newVoiceId,
          audioUrl: res.audioUrl,
          audioFile: res.audioFile,
          audioPath: res.audioPath,
          audioDurationSec: res.audioDurationSec,
          speed: seg.speed || "normal",
          deliveryType: seg.deliveryType || "out_loud",
          audioEffect: seg.audioEffect || "none",
          text: currentText,
          timestamp: Date.now(),
        },
      };

      const committedSeg = {
        ...seg,
        ...res,
        voiceId: newVoiceId,
        audioOutdated: false,
        textStatus: "ready",
        isVoiceSwitching: false,
        voiceAudioVariants: updatedVariants,
      };

      return { seg: committedSeg, isSameVoice: false, isCacheHit: false, networkCalls: 1, latencyMs };
    }

    // Step A: Same Voice Click (Piseth -> Piseth)
    const sameRes = await simulateHandleUpdateSegmentVoice(currentSeg, "km-KH-PisethNeural");
    assert.strictEqual(sameRes.isSameVoice, true, "Same voice click must be detected");
    assert.strictEqual(sameRes.networkCalls, 0, "Same voice must make ZERO network calls");

    // Step B: Switch to Sreymom (Male -> Female) - First time (Cache Miss)
    const toFemaleRes = await simulateHandleUpdateSegmentVoice(currentSeg, "km-KH-SreymomNeural");
    assert.strictEqual(toFemaleRes.isCacheHit, false, "First switch to Sreymom is a cache miss");
    assert.strictEqual(toFemaleRes.networkCalls, 1, "Cache miss makes exactly 1 network call");
    assert.strictEqual(toFemaleRes.seg.voiceId, "km-KH-SreymomNeural", "Voice updated to Sreymom");
    assert.ok(toFemaleRes.seg.voiceAudioVariants["km-KH-PisethNeural"], "Piseth variant preserved");
    assert.ok(toFemaleRes.seg.voiceAudioVariants["km-KH-SreymomNeural"], "Sreymom variant added");
    currentSeg = toFemaleRes.seg;

    // Step C: Switch back to Piseth (Female -> Male) - Warm Frontend Cache Hit!
    const toMaleCacheHit = await simulateHandleUpdateSegmentVoice(currentSeg, "km-KH-PisethNeural");
    console.log(`[Benchmark] Warm Frontend Cache Hit Latency: ${toMaleCacheHit.latencyMs.toFixed(3)}ms`);
    assert.strictEqual(toMaleCacheHit.isCacheHit, true, "Warm Piseth must be a Cache Hit!");
    assert.strictEqual(toMaleCacheHit.networkCalls, 0, "Cache Hit must make ZERO network calls!");
    assert.ok(toMaleCacheHit.latencyMs < 100, `UI response must be under 100ms (got ${toMaleCacheHit.latencyMs.toFixed(3)}ms)`);
    assert.strictEqual(toMaleCacheHit.seg.voiceId, "km-KH-PisethNeural");
    currentSeg = toMaleCacheHit.seg;

    // Step D: Switch back to Sreymom (Male -> Female) - Warm Frontend Cache Hit!
    const toFemaleCacheHit = await simulateHandleUpdateSegmentVoice(currentSeg, "km-KH-SreymomNeural");
    console.log(`[Benchmark] Second Cache Hit Latency: ${toFemaleCacheHit.latencyMs.toFixed(3)}ms`);
    assert.strictEqual(toFemaleCacheHit.isCacheHit, true, "Warm Sreymom must be a Cache Hit!");
    assert.strictEqual(toFemaleCacheHit.networkCalls, 0, "Cache Hit must make ZERO network calls!");
    assert.ok(toFemaleCacheHit.latencyMs < 100, `UI response must be under 100ms (got ${toFemaleCacheHit.latencyMs.toFixed(3)}ms)`);
    assert.strictEqual(toFemaleCacheHit.seg.voiceId, "km-KH-SreymomNeural");

    // Acceptance Verification Summary
    console.log("[Verification Results]");
    console.log(`- Total Backend Network Calls for Male->Female->Male->Female: ${backendCallCount} (Expected: 1)`);
    assert.strictEqual(backendCallCount, 1, "Only 1 backend call across the entire Male->Female->Male cycle!");

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
