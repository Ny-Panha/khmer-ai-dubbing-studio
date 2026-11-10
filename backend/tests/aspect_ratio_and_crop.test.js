const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const {
  renderDubbedVideoWithDucking,
  generateKhmerAssSubtitleFile,
  resolveAssSubtitleLayoutDefaults,
  SUBTITLE_SIZE_SCALE_MAP,
  buildVerticalVideoFilterChain,
  getVideoDimensionsFast,
} = require('../services/ffmpegService');

const {
  resolveDefaultAspectRatio,
  resolveStickyVoiceSettings,
  isRenderedRatioMismatch,
  inferRenderedAspectRatio,
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

test('Aspect Ratio: Sticky persistence preserves last user choice across episode switches & stale renderedVideo', () => {
  // User manually selected 16:9 -> switching to episode with stale 9:16 voiceSettings MUST stay 16:9
  const afterSwitch = resolveStickyVoiceSettings({
    prevSettings: { aspectRatio: '16:9', voiceId: 'km-KH-PisethNeural' },
    savedGlobalSettings: { aspectRatio: '16:9' },
    episodeVoiceSettings: { aspectRatio: '9:16', duckingVolume: 0.2 },
  });
  assert.equal(afterSwitch.aspectRatio, '16:9', 'Sticky 16:9 must never be overwritten by stale ep.voiceSettings');
  assert.equal(afterSwitch.duckingVolume, 0.2, 'Other per-episode voiceSettings must still merge cleanly');

  // After browser reload (prevSettings fresh, savedGlobalSettings has sticky 9:16) -> must keep 9:16
  const afterReload = resolveStickyVoiceSettings({
    prevSettings: { aspectRatio: null },
    savedGlobalSettings: { aspectRatio: '9:16' },
    episodeVoiceSettings: { aspectRatio: '16:9' },
  });
  assert.equal(afterReload.aspectRatio, '9:16', 'Saved localStorage ratio must win on reload');

  // User has NEVER manually clicked (null everywhere) -> must stay null so source dimensions govern default
  const untouched = resolveStickyVoiceSettings({
    prevSettings: { aspectRatio: null },
    savedGlobalSettings: { aspectRatio: null },
    episodeVoiceSettings: { aspectRatio: '9:16' },
  });
  assert.equal(untouched.aspectRatio, null, 'Stale episode aspectRatio must not override unclicked default (null)');

  // Legacy renderedVideo mismatch guard
  const staleVertRender = { outputFilename: 'ភាគទី 2 (EP2) [9-16 TikTok Reels].mp4' };
  assert.equal(inferRenderedAspectRatio(staleVertRender, { width: 1920, height: 1080 }), '9:16');
  assert.equal(isRenderedRatioMismatch(staleVertRender, '16:9', { width: 1920, height: 1080 }), true);
  assert.equal(isRenderedRatioMismatch(staleVertRender, '9:16', { width: 1920, height: 1080 }), false);

  const explicitLandRender = { outputFilename: 'ep_vert.mp4', aspectRatio: '16:9' };
  assert.equal(isRenderedRatioMismatch(explicitLandRender, '9:16', { width: 1080, height: 1920 }), true);
  assert.equal(isRenderedRatioMismatch(explicitLandRender, '16:9', { width: 1080, height: 1920 }), false);
});

test('Aspect Ratio & 9:16 Framing: End-to-end render verification (a)-(e)', async () => {
  const ep2Source = path.resolve(__dirname, '../uploads/test_media/ep_2_source.mp4');
  if (!fs.existsSync(ep2Source)) {
    console.log('[Aspect Ratio Test] ep_2_source.mp4 not found, skipping render test');
    return;
  }

  const outDir = path.resolve(__dirname, '../uploads/test_verification_export');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
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

  // (f) Square (1:1) source forced to 16:9 -> 1920x1080
  const tempSquareSource = path.join(outDir, 'test_square_source.mp4');
  if (!fs.existsSync(tempSquareSource)) {
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=darkgreen:s=1080x1080:d=3" -i "${tempToneAudio}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${tempSquareSource}"`
    );
  }
  const outF = path.join(outDir, 'test_out_scenario_f_square_to_16x9.mp4');
  await renderDubbedVideoWithDucking({
    inputVideoPath: tempSquareSource,
    masterAudioPath: tempToneAudio,
    fullAudioPath: tempToneAudio,
    outputVideoPath: outF,
    aspectRatio: '16:9',
    burnSubtitles: false,
  });
  const probeF = probeVideo(outF);
  assert.equal(probeF.width, 1920);
  assert.equal(probeF.height, 1080);
});

test('9:16 Vertical Filter Chain: buildVerticalVideoFilterChain blurs subtitle band only when requested', () => {
  // 1. 9:16 crop with subtitle band blur enabled (prior to ASS burn)
  const cropBlurChain = buildVerticalVideoFilterChain({
    inputLabel: '[0:v:0]',
    outputLabel: '[base_vert]',
    verticalStyle: 'crop',
    blurSubtitleBand: true,
  });
  assert.equal(cropBlurChain.length, 3);
  assert.ok(cropBlurChain[0].includes('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,setsar=1,split[v_vert_main][v_vert_band_src]'));
  assert.equal(
    cropBlurChain[1],
    '[v_vert_band_src]crop=1080:328:0:1592,boxblur=luma_radius=24:luma_power=2:chroma_radius=24:chroma_power=2,eq=brightness=-0.08[v_vert_sub_blur]'
  );
  assert.equal(cropBlurChain[2], '[v_vert_main][v_vert_sub_blur]overlay=0:1592[base_vert]');

  // 2. 9:16 crop without blur (burnSubtitles=false) stays single-step untouched
  const cropNoBlur = buildVerticalVideoFilterChain({
    inputLabel: '[0:v:0]',
    outputLabel: '[final_video]',
    verticalStyle: 'crop',
    blurSubtitleBand: false,
  });
  assert.deepEqual(cropNoBlur, [
    '[0:v:0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,setsar=1[final_video]',
  ]);

  // 3. 9:16 pad mode without blur stays byte-for-byte untouched
  const padChain = buildVerticalVideoFilterChain({
    inputLabel: '[0:v:0]',
    outputLabel: '[base_vert]',
    verticalStyle: 'pad',
    blurSubtitleBand: false,
  });
  assert.deepEqual(padChain, [
    '[0:v:0]scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(1080-iw)/2:(1920-ih)/2:color=black,setsar=1[base_vert]',
  ]);
});

test('9:16 Crop Export: Blurs bottom source subtitle band while keeping upper frame sharp & pad/16:9 untouched', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub-blur-band-'));
  try {
    const toneWav = path.join(tmpDir, 'tone.wav');
    execSync(`ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -c:a pcm_s16le "${toneWav}"`, { stdio: 'ignore' });

    // Synthetic 1280x720 landscape source with high-contrast vertical stripes in BOTH:
    // - upper subject region (y=120..260 -> scaled y=320..693)
    // - bottom Chinese subtitle region (y=604..648 -> scaled y=1610..1728)
    const synthLandscape = path.join(tmpDir, 'synth_landscape.mp4');
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=#1b2436:s=1280x720:d=2,geq=lum='if((between(Y,120,260)+between(Y,604,648))*gt(mod(X,12),5),245,35)':cb=128:cr=128" -i "${toneWav}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${synthLandscape}"`,
      { stdio: 'ignore' }
    );

    const synthPortrait = path.join(tmpDir, 'synth_portrait.mp4');
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=#1b2436:s=720x1280:d=2,geq=lum='if((between(Y,220,380)+between(Y,1072,1150))*gt(mod(X,16),7),245,35)':cb=128:cr=128" -i "${toneWav}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${synthPortrait}"`,
      { stdio: 'ignore' }
    );

    const outUnblurred = path.join(tmpDir, 'out_crop_unblurred.mp4');
    const outBlurred = path.join(tmpDir, 'out_crop_blurred.mp4');
    const outPad = path.join(tmpDir, 'out_pad.mp4');
    const out16x9 = path.join(tmpDir, 'out_16x9.mp4');
    const outPortraitBlur = path.join(tmpDir, 'out_portrait_blurred.mp4');

    await renderDubbedVideoWithDucking({
      inputVideoPath: synthLandscape,
      masterAudioPath: toneWav,
      fullAudioPath: toneWav,
      outputVideoPath: outUnblurred,
      aspectRatio: '9:16',
      verticalStyle: 'crop',
      burnSubtitles: false,
    });

    await renderDubbedVideoWithDucking({
      inputVideoPath: synthLandscape,
      masterAudioPath: toneWav,
      fullAudioPath: toneWav,
      outputVideoPath: outBlurred,
      aspectRatio: '9:16',
      verticalStyle: 'crop',
      burnSubtitles: true,
      segments: [{ startSec: 0.1, duration: 1.8, khmerText: 'សាកល្បងអក្សរខ្មែរច្បាស់' }],
    });

    await renderDubbedVideoWithDucking({
      inputVideoPath: synthLandscape,
      masterAudioPath: toneWav,
      fullAudioPath: toneWav,
      outputVideoPath: outPad,
      aspectRatio: '9:16',
      verticalStyle: 'pad',
      burnSubtitles: true,
      segments: [{ startSec: 0.1, duration: 1.8, khmerText: 'សាកល្បងម៉ូដ Pad' }],
    });

    await renderDubbedVideoWithDucking({
      inputVideoPath: synthLandscape,
      masterAudioPath: toneWav,
      fullAudioPath: toneWav,
      outputVideoPath: out16x9,
      aspectRatio: '16:9',
      burnSubtitles: true,
      segments: [{ startSec: 0.1, duration: 1.8, khmerText: 'សាកល្បង 16:9' }],
    });

    await renderDubbedVideoWithDucking({
      inputVideoPath: synthPortrait,
      masterAudioPath: toneWav,
      fullAudioPath: toneWav,
      outputVideoPath: outPortraitBlur,
      aspectRatio: '9:16',
      verticalStyle: 'pad',
      burnSubtitles: true,
      segments: [{ startSec: 0.1, duration: 1.8, khmerText: 'សាកល្បងវីដេអូបញ្ឈរ' }],
    });

    const pBlur = probeVideo(outBlurred);
    assert.equal(pBlur.width, 1080);
    assert.equal(pBlur.height, 1920);

    const pPad = probeVideo(outPad);
    assert.equal(pPad.width, 1080);
    assert.equal(pPad.height, 1920);

    const p16 = probeVideo(out16x9);
    assert.equal(p16.width, 1280);
    assert.equal(p16.height, 720);

    const pPort = probeVideo(outPortraitBlur);
    assert.equal(pPort.width, 1080);
    assert.equal(pPort.height, 1920);

    // Extract raw luma frames at t=1.0s and compare horizontal edge contrast in upper vs bottom band
    const rawUnblurred = path.join(tmpDir, 'unblurred.gray');
    const rawBlurred = path.join(tmpDir, 'blurred.gray');
    const rawPad = path.join(tmpDir, 'pad.gray');
    const rawPortrait = path.join(tmpDir, 'portrait.gray');
    execSync(`ffmpeg -y -ss 1.0 -i "${outUnblurred}" -frames:v 1 -f rawvideo -pix_fmt gray "${rawUnblurred}"`, { stdio: 'ignore' });
    execSync(`ffmpeg -y -ss 1.0 -i "${outBlurred}" -frames:v 1 -f rawvideo -pix_fmt gray "${rawBlurred}"`, { stdio: 'ignore' });
    execSync(`ffmpeg -y -ss 1.0 -i "${outPad}" -frames:v 1 -f rawvideo -pix_fmt gray "${rawPad}"`, { stdio: 'ignore' });
    execSync(`ffmpeg -y -ss 1.0 -i "${outPortraitBlur}" -frames:v 1 -f rawvideo -pix_fmt gray "${rawPortrait}"`, { stdio: 'ignore' });

    const bufUnblur = fs.readFileSync(rawUnblurred);
    const bufBlur = fs.readFileSync(rawBlurred);
    const bufPad = fs.readFileSync(rawPad);
    const bufPort = fs.readFileSync(rawPortrait);
    const measureBandEdgeEnergy = (buf, yStart, yEnd) => {
      let sumDiff = 0;
      let count = 0;
      for (let y = yStart; y < yEnd; y += 2) {
        const rowOff = y * 1080;
        for (let x = 200; x < 860; x += 2) {
          sumDiff += Math.abs(buf[rowOff + x + 16] - buf[rowOff + x]);
          count++;
        }
      }
      return sumDiff / Math.max(1, count);
    };

    const upperBefore = measureBandEdgeEnergy(bufUnblur, 340, 660);
    const upperAfter = measureBandEdgeEnergy(bufBlur, 340, 660);
    const subBandBefore = measureBandEdgeEnergy(bufUnblur, 1615, 1700);
    const subBandAfter = measureBandEdgeEnergy(bufBlur, 1615, 1700);
    const padBandEnergy = measureBandEdgeEnergy(bufPad, 1170, 1210);
    const portSubBandAfter = measureBandEdgeEnergy(bufPort, 1615, 1700);
    const portUpperAfter = measureBandEdgeEnergy(bufPort, 340, 560);

    // Bottom subtitle band high-frequency contrast must drop drastically (unreadable soft shapes)
    assert.ok(subBandBefore > 80, `Expected high-contrast stripes in unblurred subtitle band, got ${subBandBefore}`);
    assert.ok(
      subBandAfter < subBandBefore * 0.15,
      `Expected subtitle band edge contrast to drop >85% after blur (${subBandBefore.toFixed(1)} -> ${subBandAfter.toFixed(1)})`
    );

    // Upper region outside the bottom band must stay sharp and unaffected
    assert.ok(
      Math.abs(upperAfter - upperBefore) < upperBefore * 0.08,
      `Expected upper region sharpness to remain intact (${upperBefore.toFixed(1)} vs ${upperAfter.toFixed(1)})`
    );

    // Pad mode must leave the landscape bottom inside the letterbox sharp/unblurred
    assert.ok(padBandEnergy > 40, `Expected pad mode landscape bottom band unblurred (${padBandEnergy.toFixed(1)})`);

    // Native portrait source with burnSubtitles must also blur its bottom subtitle band while preserving upper frame
    assert.ok(
      portSubBandAfter < 10 && portUpperAfter > 50,
      `Expected native portrait bottom band blurred (${portSubBandAfter.toFixed(1)}) and upper sharp (${portUpperAfter.toFixed(1)})`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ASS Subtitle Size Scaling & Distinct Pill vs Banner Styles', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub-sub-style-'));
  try {
    // 1. Single-source layout defaults + scale multipliers
    assert.equal(SUBTITLE_SIZE_SCALE_MAP.small, 0.8);
    assert.equal(SUBTITLE_SIZE_SCALE_MAP.medium, 1.0);
    assert.equal(SUBTITLE_SIZE_SCALE_MAP.large, 1.25);

    assert.deepEqual(
      resolveAssSubtitleLayoutDefaults({ aspectRatio: '9:16', verticalStyle: 'crop', sourceDimensions: { width: 1920, height: 1080 } }),
      { playResX: 1080, playResY: 1920, defaultFontSize: 44 }
    );
    assert.deepEqual(
      resolveAssSubtitleLayoutDefaults({ aspectRatio: '9:16', verticalStyle: 'pad', sourceDimensions: { width: 1920, height: 1080 } }),
      { playResX: 1080, playResY: 1920, defaultFontSize: 48 }
    );
    assert.deepEqual(
      resolveAssSubtitleLayoutDefaults({ aspectRatio: '16:9', verticalStyle: 'pad', sourceDimensions: { width: 1920, height: 1080 } }),
      { playResX: 1920, playResY: 1080, defaultFontSize: 44 }
    );
    assert.deepEqual(
      resolveAssSubtitleLayoutDefaults({ aspectRatio: '1:1' }),
      { playResX: 1080, playResY: 1080, defaultFontSize: 52 }
    );

    // 2. Distinct Pill vs Banner vs Cinema ASS style definitions
    const bannerAss = path.join(tmpDir, 'banner.ass');
    const pillAss = path.join(tmpDir, 'pill.ass');
    const cinemaAss = path.join(tmpDir, 'cinema.ass');

    generateKhmerAssSubtitleFile({
      segments: [{ startSec: 0, duration: 2, khmerText: 'សាកល្បង Banner' }],
      outputPath: bannerAss,
      subtitleStyle: 'banner',
      aspectRatio: '16:9',
    });
    generateKhmerAssSubtitleFile({
      segments: [{ startSec: 0, duration: 2, khmerText: 'សាកល្បង Pill' }],
      outputPath: pillAss,
      subtitleStyle: 'pill',
      aspectRatio: '16:9',
    });
    generateKhmerAssSubtitleFile({
      segments: [{ startSec: 0, duration: 2, khmerText: 'សាកល្បង Cinema' }],
      outputPath: cinemaAss,
      subtitleStyle: 'cinema',
      textColor: '#FFE600',
      aspectRatio: '16:9',
    });

    const bannerTxt = fs.readFileSync(bannerAss, 'utf8');
    const pillTxt = fs.readFileSync(pillAss, 'utf8');
    const cinemaTxt = fs.readFileSync(cinemaAss, 'utf8');

    assert.ok(
      bannerTxt.includes('Style: Default,Khmer OS Battambang,44,&H00FFFFFF,&H000000FF,&H00000000,&H3208080c,-1,0,0,0,100,100,0,0,3,10,0,2,60,60,80,1'),
      'Banner must keep solid BorderStyle 3, outline 10, backBox &H3208080c'
    );
    assert.ok(
      pillTxt.includes('Style: Default,Khmer OS Battambang,44,&H00FFFFFF,&H000000FF,&H64000000,&H6408080c,-1,0,0,0,100,100,0,0,3,6,0,2,60,60,80,1'),
      'Pill must use lighter translucent chip BorderStyle 3, outline 6, backBox &H6408080c'
    );
    assert.ok(
      cinemaTxt.includes('Style: Default,Khmer OS Battambang,44,&H0000E6FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1.5,2,60,60,80,1'),
      'Cinema + yellow must keep BorderStyle 1, outline 2.5, shadow 1.5, backBox &H80000000'
    );

    // 3. Render entry logs effective settings & resolves small / medium / large / explicit / null
    const toneWav = path.join(tmpDir, 'tone.wav');
    const srcVid = path.join(tmpDir, 'src.mp4');
    execSync(`ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1.2" -c:a pcm_s16le "${toneWav}"`, { stdio: 'ignore' });
    execSync(`ffmpeg -y -f lavfi -i "color=c=navy:s=1280x720:d=1.2" -i "${toneWav}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${srcVid}"`, { stdio: 'ignore' });

    const capturedLogs = [];
    const origLog = console.log;
    console.log = (...args) => {
      const line = args.map(String).join(' ');
      if (line.includes('🎬 ASS burn:')) capturedLogs.push(line);
      origLog(...args);
    };

    try {
      for (const [idx, opts] of [
        { subtitleSize: 'small', subtitleStyle: 'banner' },
        { subtitleSize: 'medium', subtitleStyle: 'pill' },
        { subtitleSize: 'large', subtitleStyle: 'cinema', textColor: '#FFE600' },
        { fontSize: 62, subtitleSize: 'small', subtitleStyle: 'banner' },
        { subtitleStyle: 'banner' },
      ].entries()) {
        await renderDubbedVideoWithDucking({
          inputVideoPath: srcVid,
          masterAudioPath: toneWav,
          fullAudioPath: toneWav,
          outputVideoPath: path.join(tmpDir, `out_${idx}.mp4`),
          aspectRatio: '9:16',
          verticalStyle: 'crop',
          burnSubtitles: true,
          subtitleOptions: opts,
          segments: [{ startSec: 0.1, duration: 0.9, khmerText: 'សាកល្បងទំហំអក្សរ' }],
        });
      }
    } finally {
      console.log = origLog;
    }

    assert.equal(capturedLogs.length, 5);
    assert.equal(capturedLogs[0], '🎬 ASS burn: style=banner color=#FFFFFF fontSize=35 (size=small) playRes=1080x1920');
    assert.equal(capturedLogs[1], '🎬 ASS burn: style=pill color=#FFFFFF fontSize=44 (size=medium) playRes=1080x1920');
    assert.equal(capturedLogs[2], '🎬 ASS burn: style=cinema color=#FFE600 fontSize=55 (size=large) playRes=1080x1920');
    assert.equal(capturedLogs[3], '🎬 ASS burn: style=banner color=#FFFFFF fontSize=62 (size=explicit) playRes=1080x1920');
    assert.equal(capturedLogs[4], '🎬 ASS burn: style=banner color=#FFFFFF fontSize=44 (size=null) playRes=1080x1920');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

