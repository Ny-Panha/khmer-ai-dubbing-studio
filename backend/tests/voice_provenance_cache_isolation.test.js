const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

const {
  generateSingleSegmentAudio,
  cleanTextForTts,
  computeTextSha256,
  buildEffectConfigKey,
  verifyAudioFileProvenance,
} = require("../services/ttsService");
const { doesSegmentNeedTts } = require("../routes/audioRoutes");

function createSynthToneMp3(outPath, freqHz = 140, durSec = 1.2) {
  const res = spawnSync(
    ffmpegInstaller.path,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freqHz}:duration=${durSec}`,
      "-ar",
      "24000",
      "-ac",
      "1",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "48k",
      outPath,
    ],
    { windowsHide: true }
  );
  assert.equal(res.status, 0, `ffmpeg failed creating test tone: ${res.stderr?.toString()}`);
}

test("1. Never reuse rawAudioPath across different voice IDs or copy Piseth into Sreymom cache", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice_prov_cross_"));
  try {
    const segId = "clip_52_cross";
    const text = "ខ្ញុំនឹងគន់គូរផ្លូវថ្មី";
    const maleSeg = await generateSingleSegmentAudio(
      {
        id: segId,
        khmer: text,
        voiceId: "km-KH-PisethNeural",
        speed: 1.0,
        userCustomSpeed: true,
        deliveryType: "out_loud",
        audioEffect: "none",
      },
      tmpDir,
      { forceRegen: true, forceVoice: true, voiceId: "km-KH-PisethNeural" }
    );
    assert.equal(maleSeg.actualVoiceId, "km-KH-PisethNeural");
    assert.equal(maleSeg.rawVoiceId, "km-KH-PisethNeural");
    assert.equal(maleSeg.ttsStatus, "ready");
    assert.ok(maleSeg.rawAudioPath && fs.existsSync(maleSeg.rawAudioPath));

    const maleBytesSha = crypto.createHash("sha256").update(fs.readFileSync(maleSeg.audioPath)).digest("hex");

    // Now switch to Female PASSING Male's rawAudioPath & rawVoiceId (the exact Clip #52 reproduction!)
    const femaleSeg = await generateSingleSegmentAudio(
      {
        ...maleSeg,
        voiceId: "km-KH-SreymomNeural",
        khmerVoiceId: "km-KH-SreymomNeural",
        voice: "km-KH-SreymomNeural",
        voiceOverride: "km-KH-SreymomNeural",
      },
      tmpDir,
      { forceRegen: false, forceVoice: true, voiceId: "km-KH-SreymomNeural" }
    );

    assert.equal(femaleSeg.voiceId, "km-KH-SreymomNeural");
    assert.equal(femaleSeg.actualVoiceId, "km-KH-SreymomNeural");
    assert.equal(femaleSeg.rawVoiceId, "km-KH-SreymomNeural");
    assert.equal(femaleSeg.ttsStatus, "ready");
    assert.ok(femaleSeg.audioFile.includes("km-KH-SreymomNeural"));
    assert.ok(femaleSeg.rawAudioPath && femaleSeg.rawAudioPath.includes("km-KH-SreymomNeural"));
    assert.notEqual(femaleSeg.rawAudioPath, maleSeg.rawAudioPath);

    const femaleBytesSha = crypto.createHash("sha256").update(fs.readFileSync(femaleSeg.audioPath)).digest("hex");
    assert.notEqual(femaleBytesSha, maleBytesSha, "Sreymom MP3 bytes MUST NOT equal Piseth MP3 bytes!");

    const sreymomProv = verifyAudioFileProvenance(
      femaleSeg.audioPath,
      {
        voiceId: "km-KH-SreymomNeural",
        textHash: computeTextSha256(text),
        pitch: "+0Hz",
        originalSpeed: 1.0,
        deliveryType: "out_loud",
        effectConfigKey: "clean",
      },
      { uploadsDir: tmpDir }
    );
    assert.equal(sreymomProv.valid, true, `Expected valid Sreymom provenance: ${sreymomProv.reason}`);

    // Also test inner_thought delivery path never copies Male rawAudioPath into Female raw/thought cache
    const femaleThought = await generateSingleSegmentAudio(
      {
        ...maleSeg,
        voiceId: "km-KH-SreymomNeural",
        deliveryType: "inner_thought",
        audioEffect: "inner_thought_reverb",
      },
      tmpDir,
      { forceRegen: false, forceVoice: true, voiceId: "km-KH-SreymomNeural", deliveryType: "inner_thought" }
    );
    assert.equal(femaleThought.actualVoiceId, "km-KH-SreymomNeural");
    assert.ok(femaleThought.audioPath.includes("km-KH-SreymomNeural_thought_"));
    const thoughtSha = crypto.createHash("sha256").update(fs.readFileSync(femaleThought.audioPath)).digest("hex");
    assert.notEqual(thoughtSha, maleBytesSha);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("2. Invalidate contaminated legacy cache files without valid v2 provenance (never trust filenames alone)", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice_prov_legacy_"));
  try {
    const text = "សាកល្បងសំឡេងពិត";
    const cleaned = cleanTextForTts(text);
    const cacheHash = crypto
      .createHash("md5")
      .update(`${cleaned}__km-KH-SreymomNeural__out_loud__clean__+0%__custom__lt1`)
      .digest("hex")
      .substring(0, 8);
    const natHash = crypto
      .createHash("md5")
      .update(`${cleaned}__km-KH-SreymomNeural__natural1x`)
      .digest("hex")
      .substring(0, 8);

    // Poison BOTH the Sreymom voice file AND Sreymom base1x file with fake legacy audio + v1 sidecar
    const poisonedVoicePath = path.join(tmpDir, `ep_ep_8_seg_52_km-KH-SreymomNeural_voice_${cacheHash}.mp3`);
    const poisonedBase1xPath = path.join(tmpDir, `ep_ep_8_seg_52_km-KH-SreymomNeural_base1x_${natHash}.mp3`);
    createSynthToneMp3(poisonedVoicePath, 130, 0.9);
    fs.copyFileSync(poisonedVoicePath, poisonedBase1xPath);
    const poisonedSha = crypto.createHash("sha256").update(fs.readFileSync(poisonedVoicePath)).digest("hex");

    // Even write a fake legacy v1 sidecar (no provenanceVersion/contentSha256/originalSpeed) claiming it's Sreymom
    fs.writeFileSync(
      poisonedVoicePath.replace(/\.mp3$/, ".json"),
      JSON.stringify({ text: cleaned, voiceId: "km-KH-SreymomNeural", timestamp: Date.now() })
    );

    const res = await generateSingleSegmentAudio(
      {
        id: 52,
        episodeId: "ep_8",
        khmer: text,
        voiceId: "km-KH-SreymomNeural",
        speed: 1.0,
        userCustomSpeed: true,
        rawAudioPath: poisonedBase1xPath,
      },
      tmpDir,
      { episodeId: "ep_8", forceRegen: false, forceVoice: true, voiceId: "km-KH-SreymomNeural" }
    );

    assert.equal(res._wasNewlySynthesized, true, "Contaminated legacy cache MUST be invalidated and re-synthesized!");
    assert.equal(res.actualVoiceId, "km-KH-SreymomNeural");
    assert.equal(res.ttsStatus, "ready");
    const realSha = crypto.createHash("sha256").update(fs.readFileSync(res.audioPath)).digest("hex");
    assert.notEqual(realSha, poisonedSha, "Poisoned bytes must be replaced with real Sreymom synthesis!");

    // Wait: now warm call MUST reuse the newly verified v2 cache!
    const warm = await generateSingleSegmentAudio(
      {
        ...res,
        voiceId: "km-KH-SreymomNeural",
      },
      tmpDir,
      { episodeId: "ep_8", forceRegen: false, forceVoice: true, voiceId: "km-KH-SreymomNeural" }
    );
    assert.equal(warm._wasNewlySynthesized, false, "Verified v2 cache must hit instantly on second call");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("3. Preserve speed, effects, trimming, and timeline position across voice switches + never contaminate cache on speed/effect change", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice_prov_preserve_"));
  try {
    const segBase = {
      id: 52,
      episodeId: "ep_8",
      khmer: "តោះទៅមុខទៀត",
      voiceId: "km-KH-PisethNeural",
      speed: 1.25,
      userCustomSpeed: true,
      deliveryType: "inner_thought",
      audioEffect: "inner_thought_reverb",
      effectConfig: { inGain: 0.85, outGain: 0.75, delays: "40|90", decays: "0.3|0.15" },
      startSec: 120.0,
      endSec: 123.0,
      audioStartSec: 120.4,
      audioEndSec: 122.1,
      audioOffset: 0.35,
      audioTrimmed: true,
      userTrimmed: true,
      audioTrimStartSec: 0.35,
      audioTrimEndSec: 2.05,
      userShifted: true,
    };

    const maleRes = await generateSingleSegmentAudio(segBase, tmpDir, {
      episodeId: "ep_8",
      forceRegen: true,
      forceVoice: true,
      preserveTrim: true,
      voiceId: "km-KH-PisethNeural",
    });

    const femaleRes = await generateSingleSegmentAudio(
      { ...maleRes, voiceId: "km-KH-SreymomNeural" },
      tmpDir,
      { episodeId: "ep_8", forceRegen: false, forceVoice: true, voiceId: "km-KH-SreymomNeural" }
    );

    assert.equal(femaleRes.actualVoiceId, "km-KH-SreymomNeural");
    assert.equal(femaleRes.appliedSpeed, 1.25);
    assert.equal(femaleRes.deliveryType, "inner_thought");
    assert.equal(femaleRes.audioOffset, 0.35);
    assert.equal(femaleRes.audioTrimmed, true);
    assert.equal(femaleRes.userTrimmed, true);
    assert.equal(femaleRes.audioStartSec, 120.4);
    assert.equal(femaleRes.audioEndSec, 122.1);
    assert.equal(femaleRes.userShifted, true);
    assert.equal(femaleRes.voiceAudioVariants["km-KH-PisethNeural"]?.provenanceVerified, true);
    assert.equal(femaleRes.voiceAudioVariants["km-KH-SreymomNeural"]?.provenanceVerified, true);
    assert.notEqual(
      crypto.createHash("sha256").update(fs.readFileSync(femaleRes.audioPath)).digest("hex"),
      crypto.createHash("sha256").update(fs.readFileSync(maleRes.audioPath)).digest("hex")
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("4. doesSegmentNeedTts rejects segments with mismatched rawVoiceId / actualVoiceId / contaminated sidecar", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice_prov_needs_"));
  try {
    const pisethFile = path.join(tmpDir, "ep_ep_8_seg_52_km-KH-PisethNeural_voice_11111111.mp3");
    createSynthToneMp3(pisethFile, 140, 0.8);
    const needTts = doesSegmentNeedTts(
      {
        id: 52,
        khmer: "សូមបន្ថែមប្រេងចង្កៀង",
        voiceId: "km-KH-SreymomNeural",
        rawAudioPath: pisethFile,
        rawVoiceId: "km-KH-PisethNeural",
        audioPath: pisethFile,
        audioSignature: "fake",
      },
      tmpDir
    );
    assert.equal(needTts, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("5. Frontend voiceCacheUtils rejects unverified/legacy variants and mismatched speed/delivery/text/voice", async () => {
  const utils = await import("../../frontend/src/utils/voiceCacheUtils.js");
  const validVariant = {
    voiceId: "km-KH-SreymomNeural",
    actualVoiceId: "km-KH-SreymomNeural",
    audioUrl: "/uploads/projects/ss1/episodes/ep_8/audio/ep_ep_8_seg_52_km-KH-SreymomNeural_voice_d5b7d0e1.mp3",
    audioFile: "ep_ep_8_seg_52_km-KH-SreymomNeural_voice_d5b7d0e1.mp3",
    text: "សូមបន្ថែមប្រេងចង្កៀង",
    speed: 1,
    pitch: "+0Hz",
    deliveryType: "narration",
    audioEffect: "none",
    provenanceVerified: true,
  };

  assert.equal(
    utils.isVerifiedVoiceVariantHit(validVariant, {
      targetVoiceId: "km-KH-SreymomNeural",
      currentText: "សូមបន្ថែមប្រេងចង្កៀង",
      speed: "normal",
      deliveryType: "narration",
      audioEffect: "none",
    }),
    true
  );

  // Legacy variant without provenanceVerified MUST NOT hit client cache
  assert.equal(
    utils.isVerifiedVoiceVariantHit({ ...validVariant, provenanceVerified: undefined }, {
      targetVoiceId: "km-KH-SreymomNeural",
      currentText: "សូមបន្ថែមប្រេងចង្កៀង",
      speed: "normal",
      deliveryType: "narration",
    }),
    false
  );

  // Speed change must miss
  assert.equal(
    utils.isVerifiedVoiceVariantHit(validVariant, {
      targetVoiceId: "km-KH-SreymomNeural",
      currentText: "សូមបន្ថែមប្រេងចង្កៀង",
      speed: 1.5,
      deliveryType: "narration",
    }),
    false
  );

  // Delivery change must miss
  assert.equal(
    utils.isVerifiedVoiceVariantHit(validVariant, {
      targetVoiceId: "km-KH-SreymomNeural",
      currentText: "សូមបន្ថែមប្រេងចង្កៀង",
      speed: "normal",
      deliveryType: "inner_thought",
      audioEffect: "inner_thought_reverb",
    }),
    false
  );

  // Filename of Piseth disguised under Sreymom key must miss
  assert.equal(
    utils.isVerifiedVoiceVariantHit({
      ...validVariant,
      audioFile: "ep_ep_8_seg_52_km-KH-PisethNeural_voice_92f13f3f.mp3",
    }, {
      targetVoiceId: "km-KH-SreymomNeural",
      currentText: "សូមបន្ថែមប្រេងចង្កៀង",
      speed: "normal",
      deliveryType: "narration",
    }),
    false
  );
});

test("6. Cache cleanup preserves verified speed variants for same text while unlinking superseded old-text MP3 artifacts", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice_prov_cleanup_"));
  try {
    const segId = 77;
    const text1 = "ពាក្យចាស់ដំបូង";
    const text2 = "ពាក្យថ្មីក្រោយពេលកែ";

    const s1 = await generateSingleSegmentAudio(
      { id: segId, episodeId: "ep_8", khmer: text1, voiceId: "km-KH-PisethNeural", speed: 1.0, userCustomSpeed: true },
      tmpDir,
      { episodeId: "ep_8", forceRegen: true, voiceId: "km-KH-PisethNeural" }
    );
    assert.ok(fs.existsSync(s1.audioPath));

    // Change speed to 1.25x on SAME text -> 1.0x file must still be preserved or 1.25x verified
    const s125 = await generateSingleSegmentAudio(
      { ...s1, speed: 1.25, userCustomSpeed: true },
      tmpDir,
      { episodeId: "ep_8", forceRegen: false, voiceId: "km-KH-PisethNeural", speed: 1.25, userCustomSpeed: true }
    );
    assert.ok(fs.existsSync(s1.audioPath), "Verified same-text speed variant (1.0x) must remain cached");
    assert.ok(fs.existsSync(s125.audioPath));

    // Edit text and regenerate -> old-text MP3 (s125.audioPath) must be unlinked cleanly!
    const sEdited = await generateSingleSegmentAudio(
      { ...s125, khmer: text2, khmerText: text2 },
      tmpDir,
      { episodeId: "ep_8", forceRegen: false, voiceId: "km-KH-PisethNeural", speed: 1.25, userCustomSpeed: true }
    );
    assert.ok(fs.existsSync(sEdited.audioPath));
    assert.equal(fs.existsSync(s125.audioPath), false, "Superseded old-text MP3 must be unlinked after text edit");
    assert.equal(fs.existsSync(s125.audioPath.replace(/\.mp3$/, ".json")), false, "Stale sidecar for old text must be unlinked too");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
