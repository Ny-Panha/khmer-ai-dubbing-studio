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

test('2. Audit ALL 23 Inspector/Settings SmoothRangeSlider instances: zero raw range inputs, every slider wires onCommit + onDraftChange, and every previewKey has subscribers', () => {
  const sliderComponentSpec = [
    { rel: 'frontend/src/components/voice/AudioDuckingPanel.jsx', expectedCount: 2 },
    { rel: 'frontend/src/components/voice/ClipInspectorPanel.jsx', expectedCount: 1 },
    { rel: 'frontend/src/components/voice/ExportSettingsPanel.jsx', expectedCount: 13 },
    { rel: 'frontend/src/components/player/VideoTransformControls.jsx', expectedCount: 7 },
  ];

  // Collect all keys actively subscribed via subscribeDraftPreview across overlays & player
  const subscriberFiles = [
    'frontend/src/components/player/CornerMaskOverlay.jsx',
    'frontend/src/components/player/LogoOverlay.jsx',
    'frontend/src/components/player/SponsorOverlay.jsx',
    'frontend/src/components/player/AntiTheftOverlay.jsx',
    'frontend/src/components/player/VideoPlayerPreview.jsx',
    'frontend/src/components/voice/VoiceSettings.jsx',
  ];
  const combinedSubscriberSrc = subscriberFiles
    .map((rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'))
    .join('\n');

  let totalSmoothSliders = 0;
  const discoveredPreviewKeys = new Set();

  for (const { rel, expectedCount } of sliderComponentSpec) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const rawRanges = src.match(/type=["']range["']/g) || [];
    assert.equal(rawRanges.length, 0, `${rel} must have zero raw <input type="range"> elements (found ${rawRanges.length})`);

    // Extract every individual <SmoothRangeSlider ... /> JSX element block
    const sliderTags = src.match(/<SmoothRangeSlider[\s\S]*?\/>/g) || [];
    assert.equal(sliderTags.length, expectedCount, `${rel} expected ${expectedCount} <SmoothRangeSlider> elements, found ${sliderTags.length}`);

    for (let i = 0; i < sliderTags.length; i++) {
      const tag = sliderTags[i];
      assert.match(tag, /\bonCommit=\{/, `${rel} slider #${i + 1} must wire onCommit handler (single commit on pointer release)`);
      assert.match(tag, /\bonDraftChange=\{/, `${rel} slider #${i + 1} must wire onDraftChange handler (live draft display without store commit)`);
      assert.doesNotMatch(tag, /\bonChange=\{/, `${rel} slider #${i + 1} must NOT pass direct onChange handler`);

      const pkMatch = tag.match(/\bpreviewKey=["']([^"']+)["']/);
      if (pkMatch) {
        discoveredPreviewKeys.add(pkMatch[1]);
      }
    }
    totalSmoothSliders += sliderTags.length;
  }
  assert.equal(totalSmoothSliders, 23, `Expected all 23 audited Inspector/Settings sliders across 4 files, found ${totalSmoothSliders}`);
  assert.ok(discoveredPreviewKeys.size >= 10, `Expected previewKey coverage across visual/audio sliders, found ${discoveredPreviewKeys.size}`);

  for (const key of discoveredPreviewKeys) {
    assert.ok(
      combinedSubscriberSrc.includes(key),
      `previewKey "${key}" used on SmoothRangeSlider must have an active subscriber via subscribeDraftPreview`
    );
  }

  for (const rel of subscriberFiles.slice(0, 5)) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.match(src, /subscribeDraftPreview/, `${rel} must subscribe to lightweight draft preview bus`);
  }

  // Verify SmoothRangeSlider itself forwards pointerup/pointercancel window listeners and separates pointer drag from direct commit
  const smoothSrc = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/common/SmoothRangeSlider.jsx'), 'utf8');
  assert.match(smoothSrc, /window\.addEventListener\(['"]pointerup['"]/, 'SmoothRangeSlider must listen to window pointerup so drag release outside element still commits once');
  assert.match(smoothSrc, /window\.addEventListener\(['"]pointercancel['"]/, 'SmoothRangeSlider must handle window pointercancel');
  assert.match(smoothSrc, /isDraggingRef\.current/, 'SmoothRangeSlider must track active pointer drag separately from keyboard changes');
});
