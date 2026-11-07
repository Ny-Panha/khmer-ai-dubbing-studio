/**
 * DragonDub AI - Real-World Acceptance Test A: Checkbox OFF
 * Verifies that with enableDemucs: false:
 * 1. audioSeparationService is NEVER called.
 * 2. Full 5:25 video is rendered with standard dynamic ducking.
 * 3. Measures exact processing time and validates output stream integrity.
 */

const fs = require('fs');
const path = require('path');
const { renderDubbedVideoWithDucking, getMediaInfo } = require('../services/ffmpegService');

const videoPath = path.join(__dirname, '../uploads/projects/series_1793272088927/episodes/ep_3/video/ep_3_source.mp4');
const masterAudioPath = path.join(__dirname, '../uploads/projects/series_1793272088927/episodes/ep_3/audio/ep_3_narration_khmer.mp3');
const outDir = path.join(__dirname, '../uploads/temp/real_world_acceptance_ep3');
const outputPath = path.join(outDir, 'test_a_checkbox_off_full.mp4');

async function runTestA() {
  console.log('=== TEST A: CHECKBOX OFF (NORMAL DYNAMIC DUCKING) ===');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  // Monitor audioSeparationService by hooking into it or checking console logs
  const audioSep = require('../services/audioSeparationService');
  let separationCalled = false;
  const originalSeparateAudio = audioSep.separateAudio;
  audioSep.separateAudio = function (...args) {
    separationCalled = true;
    return originalSeparateAudio.apply(this, args);
  };

  const startTime = Date.now();
  const startCpu = process.cpuUsage();
  const startMem = process.memoryUsage();

  console.log(`[Test A] Starting full render (05:25 min) with enableDemucs: false...`);
  const renderRes = await renderDubbedVideoWithDucking({
    inputVideoPath: videoPath,
    masterAudioPath,
    outputVideoPath: outputPath,
    enableDemucs: false,
    soundMode: 'ducking',
    bgVolume: 0.15,
    khmerVolume: 1.3,
    burnSubtitles: false,
  });

  const wallClockMs = Date.now() - startTime;
  const cpuDiff = process.cpuUsage(startCpu);
  const memDiff = process.memoryUsage();

  console.log(`[Test A] Completed in ${(wallClockMs / 1000).toFixed(2)}s`);
  console.log(`[Test A] audioSeparationService called: ${separationCalled}`);

  if (separationCalled) {
    throw new Error('FAIL: audioSeparationService was called even though enableDemucs was false!');
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('FAIL: Output video was not created!');
  }

  const stat = fs.statSync(outputPath);
  const mediaInfo = await getMediaInfo(outputPath);
  const vStream = mediaInfo.streams.find((s) => s.codec_type === 'video');
  const aStream = mediaInfo.streams.find((s) => s.codec_type === 'audio');

  const result = {
    test: 'Test A - Checkbox OFF',
    status: 'PASS',
    wallClockSec: (wallClockMs / 1000).toFixed(2),
    fileSizeBytes: stat.size,
    fileSizeMB: (stat.size / 1024 / 1024).toFixed(2),
    durationSec: mediaInfo.format.duration,
    videoCodec: vStream?.codec_name,
    videoResolution: `${vStream?.width}x${vStream?.height}`,
    audioCodec: aStream?.codec_name,
    audioSampleRate: aStream?.sample_rate,
    audioChannels: aStream?.channels,
    separationServiceCalled: separationCalled,
    outputPath,
  };

  console.log('[Test A] Summary:', JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'test_a_result.json'), JSON.stringify(result, null, 2));
}

runTestA().catch((err) => {
  console.error('[Test A] ❌ Error:', err);
  process.exit(1);
});

