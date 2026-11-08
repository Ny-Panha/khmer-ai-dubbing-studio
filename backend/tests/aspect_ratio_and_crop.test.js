const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const {
  renderDubbedVideoWithDucking,
  generateKhmerAssSubtitleFile,
  getVideoDimensionsFast,
} = require('../services/ffmpegService');

const {
  resolveDefaultAspectRatio,
} = require('../../frontend/src/utils/projectStorage');

function probeVideo(filePath) {
  const json = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,display_aspect_ratio -of json "${filePath}"`
  ).toString();
  const info = JSON.parse(json);
  return info.streams[0];
}

test('Aspect Ratio: resolveDefaultAspectRatio unit tests', () => {
  assert.equal(resolveDefaultAspectRatio(1080, 1920), '9:16', '1080x1920 portrait must resolve to 9:16');
  assert.equal(resolveDefaultAspectRatio(720, 1280), '9:16', '720x1280 portrait must resolve to 9:16');
  assert.equal(resolveDefaultAspectRatio(1920, 1080), '16:9', '1920x1080 landscape must resolve to 16:9');
  assert.equal(resolveDefaultAspectRatio(1280, 720), '16:9', '1280x720 landscape must resolve to 16:9');
  assert.equal(resolveDefaultAspectRatio(1080, 1080), '1:1', '1080x1080 square must resolve to 1:1');
  assert.equal(resolveDefaultAspectRatio(0, 0), null, 'Missing dimensions must resolve to null');
  assert.equal(resolveDefaultAspectRatio(null, null), null, 'Null dimensions must resolve to null');
});

test('Aspect Ratio & 9:16 Framing: End-to-end render verification (a)-(e)', async () => {
  const outDir = path.resolve(__dirname, '../uploads/test_verification_export');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const ep2Source = path.resolve(__dirname, '../uploads/test_media/ep_2_source.mp4');
  if (!fs.existsSync(ep2Source)) {
    console.log('[Aspect Ratio Test] ep_2_source.mp4 not found, skipping render test');
    return;
  }

  const tempToneAudio = path.join(outDir, 'test_tone.wav');
  if (!fs.existsSync(tempToneAudio)) {
    execSync(`ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -c:a pcm_s16le "${tempToneAudio}"`);
  }

  const tempVertSource = path.join(outDir, 'test_vertical_source.mp4');
  if (!fs.existsSync(tempVertSource)) {
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=navy:s=1080x1920:d=3" -i "${tempToneAudio}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${tempVertSource}"`
    );
  }

  // (a) Vertical source episode, no manual select -> export is 1080x1920
  const outA = path.join(outDir, 'test_out_scenario_a.mp4');
  await renderDubbedVideoWithDucking({
    inputVideoPath: tempVertSource,
    masterAudioPath: tempToneAudio,
    fullAudioPath: tempToneAudio,
    outputVideoPath: outA,
    aspectRatio: null,
    burnSubtitles: false,
  });
  const probeA = probeVideo(outA);
  assert.equal(probeA.width, 1080);
  assert.equal(probeA.height, 1920);

  // (b) Landscape source -> 1920x1080
  const outB = path.join(outDir, 'test_out_scenario_b.mp4');
  await renderDubbedVideoWithDucking({
    inputVideoPath: ep2Source,
    masterAudioPath: tempToneAudio,
    fullAudioPath: tempToneAudio,
    outputVideoPath: outB,
    videoClips: [{ start: 0, end: 2.0, sourceStart: 39, sourceEnd: 41.0 }],
    aspectRatio: null,
    burnSubtitles: false,
  });
  const probeB = probeVideo(outB);
  assert.equal(probeB.width, 1920);
  assert.equal(probeB.height, 1080);

  // (c) Landscape source + 9:16 Pad -> 1080x1920 with bars
  const outC = path.join(outDir, 'test_out_scenario_c.mp4');
  await renderDubbedVideoWithDucking({
    inputVideoPath: ep2Source,
    masterAudioPath: tempToneAudio,
    fullAudioPath: tempToneAudio,
    outputVideoPath: outC,
    videoClips: [{ start: 0, end: 2.0, sourceStart: 39, sourceEnd: 41.0 }],
    aspectRatio: '9:16',
    verticalStyle: 'pad',
    burnSubtitles: false,
  });
  const probeC = probeVideo(outC);
  assert.equal(probeC.width, 1080);
  assert.equal(probeC.height, 1920);

  // (d) Landscape source + 9:16 Crop -> 1080x1920 full-bleed with Khmer subtitles
  const outD = path.join(outDir, 'test_out_scenario_d.mp4');
  await renderDubbedVideoWithDucking({
    inputVideoPath: ep2Source,
    masterAudioPath: tempToneAudio,
    fullAudioPath: tempToneAudio,
    outputVideoPath: outD,
    videoClips: [{ start: 0, end: 3.0, sourceStart: 40.5, sourceEnd: 43.5 }],
    aspectRatio: '9:16',
    verticalStyle: 'crop',
    burnSubtitles: true,
    segments: [{ startSec: 0.5, duration: 2.0, khmerText: 'ឯងអាងអីមកប្រជែងជាមួយព្រះ?!' }],
  });
  const probeD = probeVideo(outD);
  assert.equal(probeD.width, 1080);
  assert.equal(probeD.height, 1920);

  // (e) Manual select overrides source default
  const outE1 = path.join(outDir, 'test_out_scenario_e1.mp4');
  await renderDubbedVideoWithDucking({
    inputVideoPath: tempVertSource,
    masterAudioPath: tempToneAudio,
    fullAudioPath: tempToneAudio,
    outputVideoPath: outE1,
    aspectRatio: '16:9',
    burnSubtitles: false,
  });
  const probeE1 = probeVideo(outE1);
  assert.equal(probeE1.width, 1920);
  assert.equal(probeE1.height, 1080);

  const outE2 = path.join(outDir, 'test_out_scenario_e2.mp4');
  await renderDubbedVideoWithDucking({
    inputVideoPath: ep2Source,
    masterAudioPath: tempToneAudio,
    fullAudioPath: tempToneAudio,
    outputVideoPath: outE2,
    videoClips: [{ start: 0, end: 2.0, sourceStart: 39, sourceEnd: 41.0 }],
    aspectRatio: '9:16',
    verticalStyle: 'crop',
    burnSubtitles: false,
  });
  const probeE2 = probeVideo(outE2);
  assert.equal(probeE2.width, 1080);
  assert.equal(probeE2.height, 1920);
});

