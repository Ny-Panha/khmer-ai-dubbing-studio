import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateSingleSegmentAudio } = require('../services/ttsService');
const { getMediaDuration, createSynchronizedNarrationAudio } = require('../services/ffmpegService');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

test('1. Exact Clip Speed accuracy (<1% error): 1.05x, 1.50x, 0.75x, and explicit 1.00x never stack with Auto-Fit and match export mix', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip_speed_exact_'));
  const text = 'ថ្ងៃនេះមេឃស្រឡះល្អណាស់ សូមអញ្ជើញចូលរួមពិធីជួបជុំជាមួយយើងទាំងអស់គ្នា នៅពេលល្ងាចនេះផងដែរ។';
  try {
    // Baseline true 1.00x natural duration
    const baseSeg = await generateSingleSegmentAudio(
      { id: 1, khmer: text, startSec: 0, endSec: 20.0, speed: 1.0, userCustomSpeed: true },
      tmpDir,
      { voiceId: 'km-KH-PisethNeural', speed: 1.0, userCustomSpeed: true, autoStretch: true, forceRegen: true }
    );
    const naturalDur = await getMediaDuration(baseSeg.audioPath);
    assert.ok(naturalDur > 3.0, `Expected baseline > 3.0s for tight 1% math check, got ${naturalDur}s`);
    assert.equal(baseSeg.appliedSpeed, 1.0);

    // Tight slot that would trigger Auto-Fit (1.40x) if not overridden by manual Clip Speed
    const tightEnd = parseFloat((naturalDur / 1.4).toFixed(2));

    // (a) 1.05x on tight slot -> MUST equal naturalDur / 1.05 within 1% (NO stacking with 1.40x Auto-Fit!)
    const seg105 = await generateSingleSegmentAudio(
      { id: 1, khmer: text, startSec: 0, endSec: tightEnd, speed: 1.05, userCustomSpeed: true },
      tmpDir,
      { voiceId: 'km-KH-PisethNeural', speed: 1.05, userCustomSpeed: true, autoStretch: true, forceRegen: true }
    );
    const dur105 = await getMediaDuration(seg105.audioPath);
    const exp105 = naturalDur / 1.05;
    const err105 = Math.abs(dur105 - exp105) / exp105;
    assert.ok(err105 <= 0.01, `1.05x duration ${dur105.toFixed(3)}s drifted ${(err105 * 100).toFixed(2)}% from expected ${exp105.toFixed(3)}s (>1%)`);
    assert.equal(seg105.appliedSpeed, 1.05);

    // (b) 1.50x on tight slot -> MUST equal naturalDur / 1.50 within 1%
    const seg150 = await generateSingleSegmentAudio(
      { id: 1, khmer: text, startSec: 0, endSec: tightEnd, speed: 1.5, userCustomSpeed: true },
      tmpDir,
      { voiceId: 'km-KH-PisethNeural', speed: 1.5, userCustomSpeed: true, autoStretch: true, forceRegen: true }
    );
    const dur150 = await getMediaDuration(seg150.audioPath);
    const exp150 = naturalDur / 1.5;
    const err150 = Math.abs(dur150 - exp150) / exp150;
    assert.ok(err150 <= 0.01, `1.50x duration ${dur150.toFixed(3)}s drifted ${(err150 * 100).toFixed(2)}% from expected ${exp150.toFixed(3)}s (>1%)`);
    assert.equal(seg150.appliedSpeed, 1.5);

    // (c) Explicit 1.00x (userCustomSpeed: true) on tight slot -> MUST return exact naturalDur within 1% (NOT Auto-Fit!)
    const segBack100 = await generateSingleSegmentAudio(
      { id: 1, khmer: text, startSec: 0, endSec: tightEnd, speed: 1.0, userCustomSpeed: true },
      tmpDir,
      { voiceId: 'km-KH-PisethNeural', speed: 1.0, userCustomSpeed: true, autoStretch: true, forceRegen: true }
    );
    const durBack100 = await getMediaDuration(segBack100.audioPath);
    const errBack100 = Math.abs(durBack100 - naturalDur) / naturalDur;
    assert.ok(errBack100 <= 0.01, `Explicit 1.00x duration ${durBack100.toFixed(3)}s drifted ${(errBack100 * 100).toFixed(2)}% from natural ${naturalDur.toFixed(3)}s (>1%)`);
    assert.equal(segBack100.appliedSpeed, 1.0);

    // (d) Short export mix of the 1.05x segment matches preview segment duration (export never re-applies speed)
    const exportedNarration = path.join(tmpDir, 'export_105_mix.mp3');
    await createSynchronizedNarrationAudio([{ ...seg105, audioStartSec: 0, startSec: 0 }], exportedNarration);
    const exportDur = await getMediaDuration(exportedNarration);
    assert.ok(
      Math.abs(exportDur - dur105) <= 0.08,
      `Exported narration duration (${exportDur.toFixed(3)}s) must match preview 1.05x MP3 duration (${dur105.toFixed(3)}s)`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('2. Static audit: UI reflects Auto-Fit appliedSpeed honestly, manual Clip Speed sets userCustomSpeed=true & persists immediately', () => {
  const dubbingSrc = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/hooks/useAudioDubbing.js'), 'utf8');
  const inspectorSrc = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/voice/ClipInspectorPanel.jsx'), 'utf8');

  assert.match(dubbingSrc, /const customFlag = true;/, 'Manual Clip Speed in useAudioDubbing must set userCustomSpeed=true even for 1.0x');
  assert.match(dubbingSrc, /persistTimelineOperationApi\(\{\s*seriesId,\s*episodeId,\s*operation:\s*'update_segments'/s, 'handleUpdateSegmentSpeed must immediately persist updated segment speed/audio to series.json');
  assert.match(inspectorSrc, /hasAutoFitSpeed/, 'ClipInspectorPanel must surface active Auto-Fit appliedSpeed instead of falsely showing 1.00x');
});
