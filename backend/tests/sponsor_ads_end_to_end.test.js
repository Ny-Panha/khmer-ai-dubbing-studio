const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { renderDubbedVideoWithDucking } = require('../services/ffmpegService');

describe('Sponsor Ads (Green Screen Video) End-to-End Suite', () => {
  it('1. Static audit: atomic setting patch, episode persistence, live paused preview, batch export, and FFmpeg canvas scaling/mute', () => {
    const voiceSettingsCode = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/components/voice/VoiceSettings.jsx'),
      'utf8'
    );
    const exportPanelCode = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/components/voice/ExportSettingsPanel.jsx'),
      'utf8'
    );
    const appCode = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/App.jsx'),
      'utf8'
    );
    const overlayCode = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/components/player/SponsorOverlay.jsx'),
      'utf8'
    );
    const batchCode = fs.readFileSync(
      path.resolve(__dirname, '../services/batchExportService.js'),
      'utf8'
    );
    const ffmpegCode = fs.readFileSync(
      path.resolve(__dirname, '../services/ffmpegService.js'),
      'utf8'
    );

    assert.ok(voiceSettingsCode.includes('latestSettingsRef'), 'VoiceSettings tracks latest settings ref so back-to-back updates never clobber');
    assert.ok(exportPanelCode.includes('sponsorVideoUrl: data.videoUrl') && exportPanelCode.includes('sponsorVideoPath: data.videoPath'),
      'ExportSettingsPanel updates sponsorVideoUrl and sponsorVideoPath atomically in one object patch');
    assert.ok(appCode.includes('enableSponsor: false') && appCode.includes('sponsorVideoUrl: null'),
      'App VISUAL_SETTING_DEFAULTS includes sponsor keys so changes persist and invalidate stale renders');
    assert.ok(overlayCode.includes('drawCurrentFrame()'),
      'SponsorOverlay draws initial chroma-keyed frame even while video is paused');
    assert.ok(batchCode.includes('resolveSponsorInputForBatch') && batchCode.includes('sponsorSettings: resolvedSponsorPath'),
      'batchExportService resolves and forwards sponsorSettings to renderDubbedVideoWithDucking');
    assert.ok(ffmpegCode.includes('const outputCanvasW =') && ffmpegCode.includes('const sponsorMuteAudio ='),
      'ffmpegService scales sponsor relative to outputCanvasW and respects muteAudio');
  });

  it('2. Real FFmpeg export: green-screen sponsor keyed out, scaled 25%, bottom-center, looped full duration, muted audio; OFF export unchanged', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponsor_e2e_'));
    try {
      const baseMp4 = path.join(tmpDir, 'base_10s.mp4');
      const narrationMp3 = path.join(tmpDir, 'narration_10s.mp3');
      const sponsorMp4 = path.join(tmpDir, 'sponsor_green_2s.mp4');
      const outOnMp4 = path.join(tmpDir, 'out_sponsor_on.mp4');
      const outOffMp4 = path.join(tmpDir, 'out_sponsor_off.mp4');

      // 10s dark-blue 1280x720 base video with silent audio
      execFileSync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=0x1E3A8A:s=1280x720:d=10:r=24',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-t', '10',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        baseMp4,
      ], { stdio: 'ignore' });

      // 10s silent narration track (only 0..1s tone, 1..10s pure silence to prove sponsor audio stays muted)
      execFileSync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1',
        '-af', 'apad=whole_dur=10',
        '-c:a', 'libmp3lame',
        narrationMp3,
      ], { stdio: 'ignore' });

      // 2s pure green #00FF00 640x360 sponsor with bright yellow center box + loud 880Hz audio tone
      execFileSync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=0x00FF00:s=640x360:d=2:r=24',
        '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
        '-vf', 'drawbox=x=100:y=90:w=440:h=180:color=0xFACC15@1.0:t=fill',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        sponsorMp4,
      ], { stdio: 'ignore' });

      // Export A: Sponsor Ads ON (Chroma Key ON, bottom-center, loop, scale 25%, muteAudio ON)
      const resOn = await renderDubbedVideoWithDucking({
        inputVideoPath: baseMp4,
        masterAudioPath: narrationMp3,
        fullAudioPath: narrationMp3,
        segments: [{ id: 1, startSec: 0, endSec: 1, khmer: 'តេស្ត' }],
        outputVideoPath: outOnMp4,
        burnSubtitles: false,
        aspectRatio: '16:9',
        sponsorSettings: {
          enabled: true,
          enableSponsor: true,
          sponsorPath: sponsorMp4,
          position: 'bottom-center',
          scale: 25,
          chromaKey: true,
          chromaSimilarity: 0.28,
          timingMode: 'loop',
          muteAudio: true,
        },
      });
      assert.equal(resOn.success, true, 'Sponsor ON render succeeds');
      assert.ok(fs.existsSync(outOnMp4), 'Sponsor ON output file exists');

      // Export B: Sponsor Ads OFF (normal export unchanged)
      const resOff = await renderDubbedVideoWithDucking({
        inputVideoPath: baseMp4,
        masterAudioPath: narrationMp3,
        fullAudioPath: narrationMp3,
        segments: [{ id: 1, startSec: 0, endSec: 1, khmer: 'តេស្ត' }],
        outputVideoPath: outOffMp4,
        burnSubtitles: false,
        aspectRatio: '16:9',
        sponsorSettings: null,
      });
      assert.equal(resOff.success, true, 'Sponsor OFF render succeeds');
      assert.ok(fs.existsSync(outOffMp4), 'Sponsor OFF output file exists');

      // Inspect RGB pixels at t=8s (after 4 loops of the 2s sponsor video!)
      // Canvas is 1280x720; scale 25% -> sponsor box is 320x180 centered at x=[480..800], y=[520..700]
      // Center of yellow banner: (x=640, y=610)
      // Green corner inside sponsor rect (must be keyed out -> dark blue base!): (x=490, y=530)
      const sampleRgb = (videoPath, sec, x, y) => {
        const raw = execFileSync('ffmpeg', [
          '-v', 'error',
          '-ss', String(sec),
          '-i', videoPath,
          '-frames:v', '1',
          '-vf', `format=rgb24,crop=1:1:${x}:${y}`,
          '-f', 'rawvideo',
          '-pix_fmt', 'rgb24',
          'pipe:1',
        ]);
        return { r: raw[0], g: raw[1], b: raw[2] };
      };

      const onCenter = sampleRgb(outOnMp4, 8, 640, 610);
      const onKeyedCorner = sampleRgb(outOnMp4, 8, 490, 530);
      const offCenter = sampleRgb(outOffMp4, 8, 640, 610);

      // Yellow sponsor banner visible at t=8s (proves loop + bottom-center + 25% scale)
      assert.ok(onCenter.r > 180 && onCenter.g > 150 && onCenter.b < 80,
        `Expected yellow sponsor banner at (640,610) t=8s, got RGB(${onCenter.r},${onCenter.g},${onCenter.b})`);
      // Green corner inside sponsor bounds keyed out -> shows dark blue base (0x1E3A8A) instead of green
      assert.ok(onKeyedCorner.b > onKeyedCorner.g && onKeyedCorner.g < 100,
        `Expected green keyed out to dark blue at (490,530) t=8s, got RGB(${onKeyedCorner.r},${onKeyedCorner.g},${onKeyedCorner.b})`);
      // Sponsor OFF output has NO yellow banner at bottom-center (remains dark blue)
      assert.ok(offCenter.b > offCenter.r && offCenter.r < 60,
        `Expected dark blue base with Sponsor OFF at (640,610), got RGB(${offCenter.r},${offCenter.g},${offCenter.b})`);

      // Verify sponsor audio was muted (t=3s..8s should be silent, max_volume <= -50 dB)
      const volRes = spawnSync('ffmpeg', [
        '-ss', '3', '-t', '5',
        '-i', outOnMp4,
        '-af', 'volumedetect',
        '-f', 'null', '-',
      ], { encoding: 'utf8' });
      const volMatch = String(volRes.stderr || '').match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      assert.ok(volMatch, 'volumedetect should report max_volume');
      const maxVolDb = parseFloat(volMatch[1]);
      assert.ok(maxVolDb <= -50, `Expected muted sponsor audio (max_volume <= -50 dB), got ${maxVolDb} dB`);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
