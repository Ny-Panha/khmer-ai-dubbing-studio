import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSliderDragController } from '../../frontend/src/utils/sliderDraftPreview.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

test('1. createSliderDragController: zero commits during pointer drag, exactly ONE commit on release, immediate commit on keyboard', () => {
  const drafts = [];
  const commits = [];
  const ctrl = createSliderDragController({
    onDraft: (v) => drafts.push(v),
    onCommit: (v) => commits.push(v),
  });

  // Pointer drag across 10 positions from 0.15 -> 1.00 -> 0.42
  ctrl.startDrag(0.15);
  const steps = [0.0, 0.1, 0.25, 0.5, 0.75, 1.0, 0.8, 0.6, 0.42];
  for (const s of steps) {
    ctrl.input(s);
    assert.equal(ctrl.getState().draftValue, s, 'Displayed draft value must always equal live pointer input');
  }
  assert.equal(drafts.length, steps.length, 'Every drag step must emit a local draft update');
  assert.equal(commits.length, 0, 'ZERO commits must fire while pointer drag is in progress');

  // Release -> commits ONCE with final value
  ctrl.endDrag();
  assert.deepEqual(commits, [0.42], 'Exactly ONE commit with final value must fire on drag release');
  assert.equal(ctrl.getState().isDragging, false);
  assert.equal(ctrl.getState().draftValue, null);

  // Drag with no change -> 0 additional commits
  ctrl.startDrag(0.42);
  ctrl.endDrag();
  assert.equal(commits.length, 1, 'Pointer down+up without value change must not fire spurious commit');

  // Keyboard arrow (not dragging) -> single immediate commit
  ctrl.input(0.43);
  assert.deepEqual(commits, [0.42, 0.43], 'Keyboard arrow change must commit immediately as a single commit');
});

test('2. Static audit: ALL 16 Inspector/Settings sliders use SmoothRangeSlider (zero raw <input type="range"> left) & all 5 preview overlays subscribe', () => {
  const sliderComponents = [
    'frontend/src/components/voice/AudioDuckingPanel.jsx',
    'frontend/src/components/voice/ClipInspectorPanel.jsx',
    'frontend/src/components/voice/ExportSettingsPanel.jsx',
    'frontend/src/components/player/VideoTransformControls.jsx',
  ];

  let totalSmoothSliders = 0;
  for (const rel of sliderComponents) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const rawRanges = src.match(/type=["']range["']/g) || [];
    assert.equal(rawRanges.length, 0, `${rel} must have zero raw <input type="range"> elements (found ${rawRanges.length})`);
    const smoothMatches = src.match(/<SmoothRangeSlider\b/g) || [];
    assert.ok(smoothMatches.length > 0, `${rel} must use <SmoothRangeSlider>`);
    totalSmoothSliders += smoothMatches.length;
  }
  assert.equal(totalSmoothSliders, 16, `Expected all 16 Inspector/settings sliders converted, found ${totalSmoothSliders}`);

  // All 5 lightweight preview targets subscribe directly to inspector:draft-preview
  const previewTargets = [
    'frontend/src/components/player/CornerMaskOverlay.jsx',
    'frontend/src/components/player/LogoOverlay.jsx',
    'frontend/src/components/player/SponsorOverlay.jsx',
    'frontend/src/components/player/AntiTheftOverlay.jsx',
    'frontend/src/components/player/VideoPlayerPreview.jsx',
  ];
  for (const rel of previewTargets) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.match(src, /subscribeDraftPreview/, `${rel} must subscribe to lightweight draft preview bus`);
  }
});
