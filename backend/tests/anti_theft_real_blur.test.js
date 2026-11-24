import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  buildCornerBlurVideoFilterChain,
  buildAntiTheftBlurVideoFilterChain,
  generateKhmerAssSubtitleFile,
} = require('../services/ffmpegService');
const {
  normalizeGlobalBannerSettings,
  formatGlobalAntiTheftForExport,
} = require('../services/globalLogoSettingsService');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('1. buildAntiTheftBlurVideoFilterChain produces valid FFmpeg split->crop->gblur->overlay graph for 16:9, 9:16, 1:1 & simultaneous CornerMask Blur', () => {
  const configs = [
    { marqueePosition: 'bottom', antiTheftSize: 'large', antiTheftBottomPercent: 2, blurStrength: 20, aspectRatio: '16:9', verticalStyle: 'pad', size: '640x360' },
    { marqueePosition: 'top', antiTheftSize: 'medium', antiTheftBottomPercent: 2, blurStrength: 16, aspectRatio: '16:9', verticalStyle: 'pad', size: '640x360' },
    { marqueePosition: 'bottom', antiTheftSize: 'small', antiTheftBottomPercent: 2, blurStrength: 24, aspectRatio: '9:16', verticalStyle: 'pad', size: '360x640' },
    { marqueePosition: 'bottom', antiTheftSize: 'small', antiTheftBottomPercent: 2, blurStrength: 18, aspectRatio: '9:16', verticalStyle: 'crop', size: '360x640' },
    { marqueePosition: 'bottom', antiTheftSize: 'medium', antiTheftBottomPercent: 2, blurStrength: 18, aspectRatio: '1:1', verticalStyle: 'pad', size: '360x360' },
  ];

  for (const cfg of configs) {
    const chain = buildAntiTheftBlurVideoFilterChain({
      inputLabel: '[0:v:0]',
      outputLabel: '[v_out]',
      antiTheft: cfg,
      aspectRatio: cfg.aspectRatio,
      verticalStyle: cfg.verticalStyle,
    });
    assert.equal(chain.length, 3);
    assert.match(chain[0], /split\[v_at_bg\]\[v_at_fg\]/);
    assert.match(chain[1], /crop=w=iw:h=.*gblur=sigma=/);
    assert.match(chain[2], /overlay=x=0:y=.*\[v_out\]$/);

    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', `testsrc=duration=0.1:size=${cfg.size}:rate=10`,
        '-filter_complex', chain.join(';'),
        '-map', '[v_out]',
        '-f', 'null',
        '-',
      ],
      { stdio: 'pipe' }
    );
  }

  // Simultaneous CornerMask Real Blur + Anti-Theft Real Blur (zero filter label collision!)
  const combinedChain = [
    ...buildCornerBlurVideoFilterChain({
      inputLabel: '[0:v:0]',
      outputLabel: '[v_corner_blur]',
      cornerMask: { position: 'top-right', width: 220, height: 54, offsetX: 14, offsetY: 14, blurStrength: 18 },
      aspectRatio: '16:9',
    }),
    ...buildAntiTheftBlurVideoFilterChain({
      inputLabel: '[v_corner_blur]',
      outputLabel: '[v_at_blur]',
      antiTheft: { marqueePosition: 'bottom', antiTheftSize: 'large', antiTheftBottomPercent: 2, blurStrength: 20 },
      aspectRatio: '16:9',
    }),
  ];
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc=duration=0.1:size=640x360:rate=10',
      '-filter_complex', combinedChain.join(';'),
      '-map', '[v_at_blur]',
      '-f', 'null',
      '-',
    ],
    { stdio: 'pipe' }
  );
});

test('2. generateKhmerAssSubtitleFile skips dark ASS AntiTheftRibbon for blur style, uses 100% opaque #000000 for solid, and preserves dark default', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antitheft_blur_test_'));
  try {
    const blurAss = path.join(tmpDir, 'blur.ass');
    generateKhmerAssSubtitleFile({
      segments: [],
      outputPath: blurAss,
      aspectRatio: '16:9',
      antiTheft: { enabled: true, bgStyle: 'blur', blurStrength: 20, marqueeText: 'ហាមផុសបន្ត', watermarkText: 'Holiday Kh Drama' },
    });
    const blurContent = fs.readFileSync(blurAss, 'utf8');
    assert.equal(blurContent.includes('Dialogue: 1,0:00:00.00,'), false, 'Real blur must NOT draw a dark ASS AntiTheftRibbon');
    assert.match(blurContent, /AntiTheftMarquee/, 'Running marquee text must still be emitted on top of blur strip');
    assert.match(blurContent, /AntiTheftWatermark/, 'Watermark text must still be emitted');

    const solidAss = path.join(tmpDir, 'solid.ass');
    generateKhmerAssSubtitleFile({
      segments: [],
      outputPath: solidAss,
      aspectRatio: '16:9',
      antiTheft: { enabled: true, bgStyle: 'solid', marqueeText: 'ហាមផុសបន្ត' },
    });
    const solidContent = fs.readFileSync(solidAss, 'utf8');
    assert.match(solidContent, /Dialogue: 1,.*AntiTheftRibbon.*\\c&H000000&\\1a&H00&\\bord0\\shad0/, 'Solid style must be 100% opaque black');

    const darkAss = path.join(tmpDir, 'dark.ass');
    generateKhmerAssSubtitleFile({
      segments: [],
      outputPath: darkAss,
      aspectRatio: '16:9',
      antiTheft: { enabled: true, marqueeText: 'ហាមផុសបន្ត' },
    });
    const darkContent = fs.readFileSync(darkAss, 'utf8');
    assert.match(darkContent, /Dialogue: 1,.*AntiTheftRibbon.*\\c&H161618&/, 'Default dark style remains semi-transparent dark');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3. Global settings normalization, Frontend Overlay Preview, Inspector & Quick Popover wire Anti-Theft Real Blur end-to-end', () => {
  const norm = normalizeGlobalBannerSettings({ enableAntiTheft: true, antiTheftBgStyle: 'blur', antiTheftBlur: 24 });
  assert.equal(norm.antiTheftBgStyle, 'blur');
  assert.equal(norm.antiTheftBlur, 24);

  const exported = formatGlobalAntiTheftForExport(norm);
  assert.equal(exported.bgStyle, 'blur');
  assert.equal(exported.blurStrength, 24);

  const overlayJsx = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/player/AntiTheftOverlay.jsx'), 'utf8');
  const overlayCss = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/player/AntiTheftOverlay.css'), 'utf8');
  const panelJsx = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/voice/ExportSettingsPanel.jsx'), 'utf8');
  const controlsJsx = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/player/VideoTransformControls.jsx'), 'utf8');

  assert.match(overlayJsx, /backdropFilter:\s*`blur\(\$\{blurPx\}px\)`/);
  assert.match(overlayJsx, /bg-\$\{resolvedBgStyle\}/);
  assert.match(overlayCss, /\.anti-theft-marquee-ribbon\.bg-blur/);
  assert.match(overlayCss, /\.anti-theft-marquee-ribbon\.bg-solid/);
  assert.match(panelJsx, /select-antitheft-bg-style/);
  assert.match(panelJsx, /slider-antitheft-blur/);
  assert.match(controlsJsx, /popup-banner-style-blur/);
  assert.match(overlayJsx, /trimmedMarqueeText\s*&&/);

  // 4. Empty marqueeText ("") must NOT emit floating ❖ diamonds or fallback text in export or ASS
  const emptyExported = formatGlobalAntiTheftForExport({ enableAntiTheft: true, marqueeText: '', watermarkText: '' });
  assert.equal(emptyExported.marqueeText, '');
  assert.equal(emptyExported.watermarkText, '');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antitheft-empty-test-'));
  try {
    const emptyAss = path.join(tmpDir, 'empty_marquee.ass');
    generateKhmerAssSubtitleFile({
      segments: [],
      outputPath: emptyAss,
      aspectRatio: '16:9',
      antiTheft: { enabled: true, bgStyle: 'blur', blurStrength: 18, marqueeText: '', watermarkText: 'Holiday Kh Drama' },
    });
    const emptyContent = fs.readFileSync(emptyAss, 'utf8');
    assert.equal(emptyContent.includes('Dialogue: 3,'), false, 'Empty marqueeText must not emit AntiTheftMarquee dialogue or ❖ diamonds');
    assert.equal(emptyContent.includes('❖'), false, 'Empty marqueeText must never emit floating ❖ diamonds');
    assert.match(emptyContent, /AntiTheftWatermark/, 'Watermark must still emit when marqueeText is empty');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 5. Custom antiTheftHeight (18..120px) + XL/XXL presets normalize, export, and scale 1:1 in FFmpeg blur layout
  const normHeight = normalizeGlobalBannerSettings({ enableAntiTheft: true, antiTheftSize: 'xlarge', antiTheftHeight: 54 });
  assert.equal(normHeight.antiTheftSize, 'xlarge');
  assert.equal(normHeight.antiTheftHeight, 54);
  const exportedHeight = formatGlobalAntiTheftForExport(normHeight);
  assert.equal(exportedHeight.antiTheftHeight, 54);
  assert.equal(exportedHeight.ribbonHeight, 54);
  const customChain = buildAntiTheftBlurVideoFilterChain({
    inputLabel: '[0:v:0]',
    outputLabel: '[v_out]',
    antiTheft: exportedHeight,
    aspectRatio: '16:9',
  });
  // 54 * 2.56 = 138px on 1080p -> hFrac = 138/1080 = 0.1278
  assert.match(customChain[1], /ih\*0\.1278/);
});
