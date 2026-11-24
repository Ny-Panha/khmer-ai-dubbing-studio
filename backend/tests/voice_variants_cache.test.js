const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { generateSingleSegmentAudio } = require("../services/ttsService");

test("generateSingleSegmentAudio populates and returns voiceAudioVariants", async () => {
  const tmpDir = path.join(__dirname, "../uploads/temp_test_variants_" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const seg = {
      id: "var_test_1",
      khmer: "សួស្តីបងប្អូនទាំងអស់គ្នា",
      voiceId: "km-KH-PisethNeural",
      speed: "normal",
      startSec: 0,
      endSec: 2.0,
    };

    const resPiseth = await generateSingleSegmentAudio(seg, tmpDir, { forceRegen: true });
    assert.ok(resPiseth.voiceAudioVariants, "Should return voiceAudioVariants object");
    assert.ok(resPiseth.voiceAudioVariants["km-KH-PisethNeural"], "Should have Piseth variant");
    assert.strictEqual(resPiseth.voiceAudioVariants["km-KH-PisethNeural"].voiceId, "km-KH-PisethNeural");
    assert.ok(resPiseth.voiceAudioVariants["km-KH-PisethNeural"].audioUrl, "Should have audioUrl");

    // Now switch to Sreymom passing the previous voiceAudioVariants
    const resSreymom = await generateSingleSegmentAudio({
      ...resPiseth,
      voiceId: "km-KH-SreymomNeural",
      khmerVoiceId: "km-KH-SreymomNeural",
      voice: "km-KH-SreymomNeural",
    }, tmpDir, { forceRegen: true, forceVoice: true, voiceId: "km-KH-SreymomNeural" });

    assert.ok(resSreymom.voiceAudioVariants["km-KH-PisethNeural"], "Should preserve Piseth variant");
    assert.ok(resSreymom.voiceAudioVariants["km-KH-SreymomNeural"], "Should have Sreymom variant");
    assert.strictEqual(resSreymom.voiceAudioVariants["km-KH-SreymomNeural"].voiceId, "km-KH-SreymomNeural");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
