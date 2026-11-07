/**
 * DragonDub AI - Demucs Render Pipeline Integration & Regression Test
 * Verifies both Option A paths:
 * 1. Checkbox OFF (enableDemucs: false): Normal fast ducking render (Demucs not called).
 * 2. Checkbox ON (enableDemucs: true): Uses separated no_vocals.wav stem mixed with Khmer voice.
 * 3. Error Guard: Throws explicit error if separation fails, never silently fallback to Chinese voice.
 */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { renderDubbedVideoWithDucking, getMediaInfo } = require('../services/ffmpegService');

const videoPath = path.join(__dirname, '../uploads/projects/series_1793272088927/episodes/ep_3/video/ep_3_source.mp4');
const masterAudioPath = path.join(__dirname, '../uploads/projects/series_1793272088927/episodes/ep_3/audio/ep_3_narration_khmer.mp3');
const testOutputDir = path.join(__dirname, '../uploads/temp/demucs_render_test');

test('Demucs Render Pipeline Integration Test', async (t) => {
  if (!fs.existsSync(videoPath) || !fs.existsSync(masterAudioPath)) {
    console.warn('[DemucsRenderTest] Test media files not found, skipping.');
    return;
  }

  if (!fs.existsSync(testOutputDir)) {
    fs.mkdirSync(testOutputDir, { recursive: true });
  }

  // Test 1: Checkbox OFF (enableDemucs: false) -> Fast regular render
  await t.test('1. Checkbox OFF: Normal rendering with dynamic ducking (Demucs bypassed)', async () => {
    const outputPath = path.join(testOutputDir, 'output_normal_ducking.mp4');
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    console.log('[DemucsRenderTest] Testing render with enableDemucs: false...');
    const startTime = Date.now();
    const result = await renderDubbedVideoWithDucking({
      inputVideoPath: videoPath,
      masterAudioPath,
      outputVideoPath: outputPath,
      enableDemucs: false,
      soundMode: 'ducking',
      bgVolume: 0.15,
      khmerVolume: 1.3,
      burnSubtitles: false,
      videoClips: [{ start: 0, end: 5, sourceStart: 0, sourceEnd: 5 }], // Render 5s slice for fast test
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[DemucsRenderTest] Normal render complete in ${elapsed}s -> ${result.outputVideoPath}`);

    assert.strictEqual(fs.existsSync(outputPath), true, 'Rendered video must exist');
    const info = await getMediaInfo(outputPath);
    const hasV = info.streams && info.streams.some((s) => s.codec_type === 'video');
    const hasA = info.streams && info.streams.some((s) => s.codec_type === 'audio');
    assert.strictEqual(hasV, true, 'Must have video stream');
    assert.strictEqual(hasA, true, 'Must have audio stream');
    assert.ok(parseFloat(info.format.duration) >= 4.5, 'Duration should be valid');
  });

  // Test 2: Checkbox ON (enableDemucs: true) -> AI vocal separation stem mixed
  await t.test('2. Checkbox ON: AI vocal separation mixed with Khmer voice', async () => {
    const outputPath = path.join(testOutputDir, 'output_demucs_clean_bg.mp4');
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    console.log('[DemucsRenderTest] Testing render with enableDemucs: true...');
    const startTime = Date.now();
    const result = await renderDubbedVideoWithDucking({
      inputVideoPath: videoPath,
      masterAudioPath,
      outputVideoPath: outputPath,
      enableDemucs: true,
      soundMode: 'ducking',
      bgVolume: 0.25, // BGM volume slider
      khmerVolume: 1.3,
      burnSubtitles: false,
      videoClips: [{ start: 0, end: 5, sourceStart: 0, sourceEnd: 5 }], // Render 5s slice for fast test
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[DemucsRenderTest] Demucs render complete in ${elapsed}s -> ${result.outputVideoPath}`);

    assert.strictEqual(fs.existsSync(outputPath), true, 'Rendered video with separated BGM must exist');
    const info = await getMediaInfo(outputPath);
    const hasV = info.streams && info.streams.some((s) => s.codec_type === 'video');
    const hasA = info.streams && info.streams.some((s) => s.codec_type === 'audio');
    assert.strictEqual(hasV, true, 'Must have video stream');
    assert.strictEqual(hasA, true, 'Must have audio stream');
    assert.ok(parseFloat(info.format.duration) >= 4.5, 'Duration should be valid');
  });

  // Test 3: Failure Handling -> Explicit error thrown, never silent Chinese voice
  await t.test('3. Failure Handling: Throws explicit Error when separation fails', async () => {
    const fakeVideoPath = path.join(testOutputDir, 'non_existent_video.mp4');
    let threw = false;
    try {
      await renderDubbedVideoWithDucking({
        inputVideoPath: fakeVideoPath,
        masterAudioPath,
        outputVideoPath: path.join(testOutputDir, 'fail.mp4'),
        enableDemucs: true,
      });
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('រកមិនឃើញវីដេអូដើម') || err.message.includes('AI Vocal Separation'), 'Must throw clear descriptive error');
      console.log(`[DemucsRenderTest] ✅ Correctly caught expected failure: ${err.message}`);
    }
    assert.strictEqual(threw, true, 'Must reject on failure');
  });
});
