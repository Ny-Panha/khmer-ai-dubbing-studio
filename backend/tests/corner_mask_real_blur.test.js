import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildCornerBlurVideoFilterChain,
  generateKhmerAssSubtitleFile,
} = require('../services/ffmpegService');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

test('1. buildCornerBlurVideoFilterChain produces valid FFmpeg split->crop->gblur->overlay graph for 16:9 and 9:16', () => {
  const configs = [
    { position: 'top-right', width: 220, height: 54, offsetX: 0, offsetY: 0, blurStrength: 20, aspectRatio: '16:9', verticalStyle: 'pad', size: '640x360' },
    { position: 'top-left', width: 180, height: 48, offsetX: 14, offsetY: 14, blurStrength: 18, aspectRatio: '16:9', verticalStyle: 'pad', size: '640x360' },
    { position: 'bottom-right', width: 200, height: 60, offsetX: 10, offsetY: 10, blurStrength: 24, aspectRatio: '9:16', verticalStyle: 'pad', size: '360x640' },
    { position: 'bottom-left', width: 160, height: 40, offsetX: 8, offsetY: 12, blurStrength: 12, aspectRatio: '9:16', verticalStyle: 'crop', size: '360x640' },
  ];

  for (const cfg of configs) {
    const chain = buildCornerBlurVideoFilterChain({
      inputLabel: '[0:v:0]',
      outputLabel: '[v_out]',
      cornerMask: cfg,
      aspectRatio: cfg.aspectRatio,
      verticalStyle: cfg.verticalStyle,
    });
    assert.equal(chain.length, 3);
    assert.match(chain[0], /split\[v_cm_bg\]\[v_cm_fg\]/);
    assert.match(chain[1], /crop=.*gblur=sigma=/);
    assert.match(chain[2], /overlay=.*\[v_out\]$/);

    // Execute against real FFmpeg to guarantee zero syntax or chroma-dimension failures
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
});

test('2. generateKhmerAssSubtitleFile skips dark ASS box for blur style, uses 100% opaque #000000 for solid, and honours offsetX/offsetY', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corner_mask_test_'));
  try {
    const blurAss = path.join(tmpDir, 'blur.ass');
    generateKhmerAssSubtitleFile({
      segments: [],
      outputPath: blurAss,
      aspectRatio: '16:9',
      cornerMask: { enabled: true, style: 'blur', position: 'top-right', width: 220, height: 54, offsetX: 0, offsetY: 0, blurStrength: 20 },
    });
    const blurContent = fs.readFileSync(blurAss, 'utf8');
    assert.equal(blurContent.includes('CornerMaskBox'), false, 'Real blur must NOT draw a dark ASS CornerMaskBox');

    const solidAss = path.join(tmpDir, 'solid.ass');
    generateKhmerAssSubtitleFile({
      segments: [],
      outputPath: solidAss,
      aspectRatio: '16:9',
      cornerMask: { enabled: true, style: 'solid', position: 'top-right', width: 200, height: 50, offsetX: 0, offsetY: 0, text: '' },
    });
    const solidContent = fs.readFileSync(solidAss, 'utf8');
    assert.match(solidContent, /CornerMaskBox/, 'Solid style must emit CornerMaskBox');
    assert.match(solidContent, /\\c&H000000&\\1a&H00&\\bord0/, 'Solid style must be 100% opaque pure black (#000000, alpha 00, no border)');
    // At 1920x1080 with offsetX=0, offsetY=0, width=200*1.92=384 -> maskX = 1920-384 = 1536, maskY = 0
    assert.match(solidContent, /\\pos\(1536,0\)/, 'Offset (0,0) must position top-right mask flush to the corner edge');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3. Frontend Preview & Render Payload wire real transparent blur, 100% opaque solid, blurStrength, and offsetX/offsetY', () => {
  const overlayJsx = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/player/CornerMaskOverlay.jsx'), 'utf8');
  const overlayCss = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/player/CornerMaskOverlay.css'), 'utf8');
  const panelJsx = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/voice/ExportSettingsPanel.jsx'), 'utf8');
  const renderHook = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/hooks/useVideoRender.js'), 'utf8');

  assert.match(overlayJsx, /cornerMaskStyle === 'solid' \|\| cornerMaskStyle === 'blur'\)\s*\?\s*1/s, 'Solid & Blur must render at opacity 1');
  assert.match(overlayJsx, /backdropFilter:\s*`blur\(\$\{blurPx\}px\)`/, 'Blur preview must bind dynamic blurPx');
  assert.doesNotMatch(overlayCss, /\.style-blur\s*\{[^}]*rgba\(0,\s*0,\s*0,\s*0\.65\)/, 'style-blur must not apply dark 0.65 black tint');
  assert.match(panelJsx, /cornerMaskOffsetX/, 'Inspector must expose Offset X slider');
  assert.match(panelJsx, /cornerMaskOffsetY/, 'Inspector must expose Offset Y slider');
  assert.match(panelJsx, /cornerMaskBlur/, 'Inspector must expose Blur Strength slider');
  assert.match(renderHook, /blurStrength:/, 'Render payload must forward blurStrength');
  assert.match(renderHook, /offsetX:/, 'Render payload must forward offsetX');
  assert.match(renderHook, /offsetY:/, 'Render payload must forward offsetY');
});
