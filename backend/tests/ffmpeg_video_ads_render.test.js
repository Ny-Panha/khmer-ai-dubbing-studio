const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  FFMPEG_PATH,
  renderDubbedVideoWithDucking,
  getMediaInfo,
} = require('../services/ffmpegService');
const { applyPlacementAdToTimeline } = require('../services/ffmpeg/ffmpegVideoAdsHelper');
const { uploadsDir } = require('../utils/pathUtils');

test('Real FFmpeg Full-Screen Video Ads: mid-roll ad with audio + silent ad + duplicate guard', async () => {
  const workDir = path.join(uploadsDir, 'sponsor', `_test_ads_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  const storyVideo = path.join(workDir, 'story_10s.mp4');
  const storyAudio = path.join(workDir, 'story_voice.mp3');
  const adWithAudio = path.join(workDir, 'ad_audio_4s.mp4');
  const adNoAudio = path.join(workDir, 'ad_silent_3s.mp4');
  const outMp4 = path.join(workDir, 'rendered_with_ads.mp4');

  try {
    // 1. Create synthetic 10s 1280x720 story video + 1.5s Khmer-slot voice MP3
    spawnSync(FFMPEG_PATH, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:d=10:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', storyVideo,
    ], { stdio: 'ignore' });

    spawnSync(FFMPEG_PATH, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=1.5',
      '-c:a', 'libmp3lame', '-ar', '24000', '-ac', '1', storyAudio,
    ], { stdio: 'ignore' });

    // 2. Create 4s ad with audio (720x1280 portrait to verify aspect normalization!)
    spawnSync(FFMPEG_PATH, [
      '-y', '-f', 'lavfi', '-i', 'color=c=gold:s=720x1280:d=4:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2', adWithAudio,
    ], { stdio: 'ignore' });

    // 3. Create 3s silent ad (video-only, no audio stream!)
    spawnSync(FFMPEG_PATH, [
      '-y', '-f', 'lavfi', '-i', 'color=c=green:s=640x360:d=3:r=30',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', adNoAudio,
    ], { stdio: 'ignore' });

    // Build timeline: Story Part1 [0..5s] + Ad1 (with audio) [5..9s] + Story Part2 [9..14s] + Ad2 (no audio, postroll) [14..17s]
    const videoClips = [
      { id: 'c1', start: 0, end: 5, sourceStart: 0, sourceEnd: 5 },
      { id: 'ad1', start: 5, end: 9, sourceStart: 0, sourceEnd: 4, duration: 4, isAd: true, clipType: 'sponsor_ad', videoPath: adWithAudio, adVolume: 0.9 },
      { id: 'c2', start: 9, end: 14, sourceStart: 5, sourceEnd: 10 },
      { id: 'ad2', start: 14, end: 17, sourceStart: 0, sourceEnd: 3, duration: 3, isAd: true, clipType: 'sponsor_ad', videoPath: adNoAudio, adVolume: 1.0, adPlacement: 'postroll' },
    ];

    const segments = [
      { id: 1, sourceCueId: 'cue_1', startSec: 1, endSec: 2.5, audioStartSec: 1, audioEndSec: 2.5, audioDurationSec: 1.5, audioPath: storyAudio, khmerText: 'មុនពាណិជ្ជកម្ម' },
      { id: 2, sourceCueId: 'cue_2', startSec: 10, endSec: 11.5, audioStartSec: 10, audioEndSec: 11.5, audioDurationSec: 1.5, audioPath: storyAudio, khmerText: 'ក្រោយពាណិជ្ជកម្ម' },
    ];

    // Verify duplicate postroll ad guard when same postroll is passed in videoAdSettings
    const deduped = applyPlacementAdToTimeline({
      videoClips,
      segments,
      videoAdSettings: { enabled: true, placement: 'postroll', videoPath: adNoAudio, durationSec: 3 },
      storyDurationSec: 10,
    });
    assert.equal(deduped.injected, false, 'Repeated postroll ad must not be duplicated');
    assert.equal(deduped.videoClips.length, 4);

    // Render full video with ads
    const res = await renderDubbedVideoWithDucking({
      inputVideoPath: storyVideo,
      segments,
      videoClips,
      outputVideoPath: outMp4,
      aspectRatio: '16:9',
      burnSubtitles: false,
      duckingVolume: 0.15,
      khmerVolume: 1.3,
      videoAdSettings: { enabled: true, placement: 'postroll', videoPath: adNoAudio, durationSec: 3, volume: 1.0 },
    });

    assert.equal(res.success, true);
    assert.equal(res.hasVideoAds, true);
    assert.ok(fs.existsSync(outMp4), 'Output MP4 must exist');

    const info = await getMediaInfo(outMp4);
    const dur = Number(info.format.duration);
    const vStream = info.streams.find((s) => s.codec_type === 'video');
    const aStream = info.streams.find((s) => s.codec_type === 'audio');
    assert.ok(dur >= 16.5 && dur <= 17.6, `Expected ~17.0s (10s story + 4s ad1 + 3s ad2), got ${dur}s`);
    assert.equal(vStream.width, 1280);
    assert.equal(vStream.height, 720);
    assert.ok(aStream && aStream.codec_name === 'aac', 'Output must have normalized AAC audio stream');
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
});
