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
    const previewCode = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx'),
      'utf8'
    );
    const renderHookCode = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/hooks/useVideoRender.js'),
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
    assert.ok(exportPanelCode.includes('value="custom"') && exportPanelCode.includes('sponsorXPercent: null'),
      'ExportSettingsPanel supports custom sponsor position and clears custom percent on preset pick');
    assert.ok(appCode.includes('enableSponsor: false') && appCode.includes('sponsorVideoUrl: null') && appCode.includes('sponsorXPercent: null') && appCode.includes('sponsorYPercent: null'),
      'App VISUAL_SETTING_DEFAULTS includes sponsor keys including sponsorXPercent/sponsorYPercent so changes persist and invalidate stale renders');
    assert.ok(overlayCode.includes('drawCurrentFrame()') && overlayCode.includes('onPointerDown={handlePointerDown}') && overlayCode.includes("sponsorPosition: 'custom'"),
      'SponsorOverlay draws initial chroma-keyed frame even while paused and supports pointer dragging into percent-based custom coordinates');
    assert.ok(previewCode.includes('<SponsorOverlay') && previewCode.includes('onUpdateVoiceSettings={onUpdateVoiceSettings}'),
      'VideoPlayerPreview passes onUpdateVoiceSettings to SponsorOverlay');
    assert.ok(renderHookCode.includes('sponsorXPercent') && renderHookCode.includes('sponsorYPercent'),
      'useVideoRender buildSponsorOptions forwards sponsorXPercent and sponsorYPercent');
    assert.ok(batchCode.includes('resolveSponsorInputForBatch') && batchCode.includes('sponsorSettings: resolvedSponsorPath'),
      'batchExportService resolves and forwards sponsorSettings to renderDubbedVideoWithDucking');
    assert.ok(ffmpegCode.includes('const outputCanvasW =') && ffmpegCode.includes('const sponsorMuteAudio =') && ffmpegCode.includes('hasCustomSponsorCoords'),
      'ffmpegService scales sponsor relative to outputCanvasW, respects muteAudio, and maps custom percent x/y per output resolution');
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

  it('3. Real FFmpeg export: dragged custom percent x/y maps accurately to 16:9 (1280x720), 9:16 (1080x1920), and (0%, 0%) corner', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponsor_custom_pos_'));
    try {
      const baseMp4 = path.join(tmpDir, 'base_4s.mp4');
      const narrationMp3 = path.join(tmpDir, 'narration_4s.mp3');
      const sponsorMp4 = path.join(tmpDir, 'sponsor_green_2s.mp4');
      const out16x9 = path.join(tmpDir, 'out_16x9_custom.mp4');
      const out9x16 = path.join(tmpDir, 'out_9x16_custom.mp4');
      const outZero = path.join(tmpDir, 'out_16x9_zero.mp4');

      execFileSync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=0x1E3A8A:s=1280x720:d=4:r=24',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-t', '4',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        baseMp4,
      ], { stdio: 'ignore' });

      execFileSync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-t', '4',
        '-c:a', 'libmp3lame',
        narrationMp3,
      ], { stdio: 'ignore' });

      execFileSync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=0x00FF00:s=640x360:d=2:r=24',
        '-vf', 'drawbox=x=100:y=90:w=440:h=180:color=0xFACC15@1.0:t=fill',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        sponsorMp4,
      ], { stdio: 'ignore' });

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

      // A. 16:9 export with dragged custom percent (X=80%, Y=15%, scale=25%)
      // 1280x720, overlay=320x180 -> x=(1280-320)*0.80=768, y=(720-180)*0.15=81 -> center=(928, 171)
      const res16x9 = await renderDubbedVideoWithDucking({
        inputVideoPath: baseMp4,
        masterAudioPath: narrationMp3,
        fullAudioPath: narrationMp3,
        segments: [{ id: 1, startSec: 0, endSec: 1, khmer: 'តេស្ត' }],
        outputVideoPath: out16x9,
        burnSubtitles: false,
        aspectRatio: '16:9',
        sponsorSettings: {
          enabled: true,
          sponsorPath: sponsorMp4,
          position: 'custom',
          sponsorXPercent: 80,
          sponsorYPercent: 15,
          scale: 25,
          chromaKey: true,
          chromaSimilarity: 0.28,
          timingMode: 'loop',
          muteAudio: true,
        },
      });
      assert.equal(res16x9.success, true, '16:9 custom position render succeeds');
      const p16Center = sampleRgb(out16x9, 2, 928, 171);
      const p16KeyedCorner = sampleRgb(out16x9, 2, 775, 88);
      const p16OldBottomLeft = sampleRgb(out16x9, 2, 180, 610);
      assert.ok(p16Center.r > 180 && p16Center.g > 150 && p16Center.b < 80,
        `16:9 custom (80%,15%): expected yellow banner at (928,171), got RGB(${p16Center.r},${p16Center.g},${p16Center.b})`);
      assert.ok(p16KeyedCorner.b > p16KeyedCorner.g && p16KeyedCorner.g < 100,
        `16:9 custom (80%,15%): expected keyed-out dark blue corner at (775,88), got RGB(${p16KeyedCorner.r},${p16KeyedCorner.g},${p16KeyedCorner.b})`);
      assert.ok(p16OldBottomLeft.b > p16OldBottomLeft.r && p16OldBottomLeft.r < 60,
        `16:9 custom (80%,15%): old bottom-left (180,610) must stay dark blue, got RGB(${p16OldBottomLeft.r},${p16OldBottomLeft.g},${p16OldBottomLeft.b})`);

      // B. 9:16 export (1080x1920) with SAME dragged custom percent (X=80%, Y=15%, scale=25%)
      // 1080x1920, overlay=270x152 -> x=(1080-270)*0.80=648, y=(1920-152)*0.15=265 -> center=(783, 341)
      const res9x16 = await renderDubbedVideoWithDucking({
        inputVideoPath: baseMp4,
        masterAudioPath: narrationMp3,
        fullAudioPath: narrationMp3,
        segments: [{ id: 1, startSec: 0, endSec: 1, khmer: 'តេស្ត' }],
        outputVideoPath: out9x16,
        burnSubtitles: false,
        aspectRatio: '9:16',
        verticalStyle: 'pad',
        sponsorSettings: {
          enabled: true,
          sponsorPath: sponsorMp4,
          position: 'custom',
          sponsorXPercent: 80,
          sponsorYPercent: 15,
          scale: 25,
          chromaKey: true,
          chromaSimilarity: 0.28,
          timingMode: 'loop',
          muteAudio: true,
        },
      });
      assert.equal(res9x16.success, true, '9:16 custom position render succeeds');
      const p916Center = sampleRgb(out9x16, 2, 783, 341);
      const p916BottomLeft = sampleRgb(out9x16, 2, 150, 1750);
      assert.ok(p916Center.r > 180 && p916Center.g > 150 && p916Center.b < 80,
        `9:16 custom (80%,15%): expected yellow banner at (783,341), got RGB(${p916Center.r},${p916Center.g},${p916Center.b})`);
      assert.ok(p916BottomLeft.r < 30 && p916BottomLeft.g < 30 && p916BottomLeft.b < 30,
        `9:16 custom (80%,15%): bottom-left pad (150,1750) must stay black, got RGB(${p916BottomLeft.r},${p916BottomLeft.g},${p916BottomLeft.b})`);

      // C. Edge case: (0%, 0%) must NOT fall back to 50%
      // 1280x720, overlay=320x180 -> x=0, y=0 -> center=(160, 90)
      const resZero = await renderDubbedVideoWithDucking({
        inputVideoPath: baseMp4,
        masterAudioPath: narrationMp3,
        fullAudioPath: narrationMp3,
        segments: [{ id: 1, startSec: 0, endSec: 1, khmer: 'តេស្ត' }],
        outputVideoPath: outZero,
        burnSubtitles: false,
        aspectRatio: '16:9',
        sponsorSettings: {
          enabled: true,
          sponsorPath: sponsorMp4,
          position: 'custom',
          sponsorXPercent: 0,
          sponsorYPercent: 0,
          scale: 25,
          chromaKey: true,
          chromaSimilarity: 0.28,
          timingMode: 'loop',
          muteAudio: true,
        },
      });
      assert.equal(resZero.success, true, '16:9 (0%, 0%) render succeeds');
      const pZeroTopLeft = sampleRgb(outZero, 2, 160, 90);
      assert.ok(pZeroTopLeft.r > 180 && pZeroTopLeft.g > 150 && pZeroTopLeft.b < 80,
        `16:9 custom (0%,0%): expected yellow banner at top-left (160,90), got RGB(${pZeroTopLeft.r},${pZeroTopLeft.g},${pZeroTopLeft.b})`);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
