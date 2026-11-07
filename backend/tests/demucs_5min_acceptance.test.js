/**
 * DragonDub AI - Demucs 5-Minute Audio Separation Acceptance Test
 * Tests local Demucs stem separation on ep_3_source.mp4 (5 minutes 25 seconds).
 */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { extractAudio } = require('../services/ffmpegService');
const { separateAudio } = require('../services/audioSeparationService');

const videoPath = path.join(__dirname, '../uploads/projects/series_1793272088927/episodes/ep_3/video/ep_3_source.mp4');
const testOutputDir = path.join(__dirname, '../uploads/temp/demucs_5min_test');

test('Demucs 5-Minute Video Separation Acceptance Test', async (t) => {
  if (!fs.existsSync(videoPath)) {
    console.warn(`[DemucsTest] Video file not found at ${videoPath}, skipping test.`);
    return;
  }

  if (!fs.existsSync(testOutputDir)) {
    fs.mkdirSync(testOutputDir, { recursive: true });
  }

  const rawAudioPath = path.join(testOutputDir, 'ep3_raw_audio.wav');

  // Step 1: Extract Audio from Video
  await t.test('1. Extract Audio from 5-minute source video', async () => {
    if (!fs.existsSync(rawAudioPath)) {
      console.log('[DemucsTest] Extracting WAV audio from video via FFmpeg...');
      await extractAudio(videoPath, rawAudioPath);
    }
    assert.strictEqual(fs.existsSync(rawAudioPath), true, 'Extracted audio must exist');
    const stat = fs.statSync(rawAudioPath);
    assert.ok(stat.size > 1000000, 'Extracted audio must be > 1MB');
    console.log(`[DemucsTest] Audio extracted: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  });

  // Step 2: Run Demucs Separation
  await t.test('2. Separate Chinese Vocals from BGM via Demucs', async () => {
    console.log('[DemucsTest] Running Demucs separation (vocals + no_vocals)...');
    const startTime = Date.now();
    
    const result = await separateAudio({
      audioPath: rawAudioPath,
      outputDir: testOutputDir,
      model: 'htdemucs',
      device: 'auto',
    });

    const elapsedSec = (Date.now() - startTime) / 1000;
    console.log('[DemucsTest] Separation Result:', result);
    console.log(`[DemucsTest] Total Wall Time: ${elapsedSec.toFixed(1)}s`);

    assert.strictEqual(result.status, 'success', 'Demucs separation must report success');
    assert.strictEqual(fs.existsSync(result.vocalsPath), true, 'vocals.wav must exist');
    assert.strictEqual(fs.existsSync(result.noVocalsPath), true, 'no_vocals.wav must exist');

    const vStat = fs.statSync(result.vocalsPath);
    const nvStat = fs.statSync(result.noVocalsPath);

    console.log(`[DemucsTest] vocals.wav size: ${(vStat.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[DemucsTest] no_vocals.wav size: ${(nvStat.size / 1024 / 1024).toFixed(2)} MB`);

    assert.ok(vStat.size > 500000, 'vocals.wav must be non-empty');
    assert.ok(nvStat.size > 500000, 'no_vocals.wav must be non-empty');
  });
});

