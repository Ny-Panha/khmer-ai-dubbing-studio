const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveSegmentAtTime } = require('../../frontend/src/utils/timelineUtils.js');

test('Playback Auto-Follow: Static Architecture & Guards Audit', () => {
  const timelineEditorPath = path.resolve(__dirname, '../../frontend/src/components/TimelineEditor.jsx');
  const code = fs.readFileSync(timelineEditorPath, 'utf8');

  // 1. isPlaying must NOT be in the auto-follow early return guard
  const autoFollowEffectMatch = code.match(/\/\/ Auto-follow playhead line[\s\S]*?useEffect\(\(\) => \{([\s\S]*?)\}, \[currentTime/);
  assert.ok(autoFollowEffectMatch, 'Auto-follow effect must be present in TimelineEditor.jsx');
  const effectBody = autoFollowEffectMatch[1];

  // The guard must NOT have `|| isPlaying`
  assert.ok(!effectBody.includes('|| isPlaying'), 'Auto-follow early-return guard must NOT contain isPlaying');
  assert.ok(effectBody.includes('isEditingText'), 'Auto-follow guard must check isEditingText');
  assert.ok(effectBody.includes('dragState || isScrubbing || isScrubbingRef.current'), 'Auto-follow must preserve dragState and isScrubbing guards');

  // 2. Catch-up after editing: focusout listener exists and references followSyncSkippedDueToEditingRef
  assert.ok(code.includes("document.addEventListener('focusout'"), 'Must register focusout listener for editing blur catch-up');
  assert.ok(code.includes('followSyncSkippedDueToEditingRef'), 'Must track followSyncSkippedDueToEditingRef');

  // 3. Viewport auto-follow during playback (Smart Professional Auto-Follow Viewport Bounds)
  assert.ok(code.includes('// Smart Professional Auto-Follow Viewport Bounds'), 'Viewport auto-follow comment must exist');
  assert.ok(code.includes('if (autoCenter && timelineBodyRef.current && !isScrubbing && !dragState)'), 'Viewport auto-follow guard must check autoCenter');
  assert.ok(code.includes('screenX > rightThreshold'), 'Viewport auto-follow must scroll when screenX > rightThreshold');

  // 4. Manual override guard (lastPlayheadSegKeyRef)
  assert.ok(code.includes('lastPlayheadSegKeyRef'), 'Must track lastPlayheadSegKeyRef to ensure manual click selection holds until next segment');
});

test('Playback Auto-Follow: State Machine & Transition Simulation', () => {
  const testSegments = [
    { id: 'seg_1', startSec: 0, endSec: 10, khmerText: 'ឃ្លាទី ១' },
    { id: 'seg_2', startSec: 10, endSec: 20, khmerText: 'ឃ្លាទី ២' },
    { id: 'seg_3', startSec: 20, endSec: 30, khmerText: 'ឃ្លាទី ៣' },
    // Gap from 30s to 40s
    { id: 'seg_4', startSec: 40, endSec: 50, khmerText: 'ឃ្លាទី ៤' },
  ];

  // State emulation mirroring TimelineEditor's logic
  let selectedSegmentId = null;
  let lastSyncedInspectorId = null;
  let lastPlayheadSegKey = null;
  let followSyncSkippedDueToEditing = false;
  let onSelectSegmentCalls = [];

  const onSelectSegment = (id) => {
    onSelectSegmentCalls.push(id);
    selectedSegmentId = id;
    lastSyncedInspectorId = id;
  };

  const runAutoFollowTick = (currentTime, isEditingText, dragState = false, isScrubbing = false) => {
    if (!testSegments || testSegments.length === 0 || !Number.isFinite(currentTime) || dragState || isScrubbing) return;

    const activeSeg = resolveSegmentAtTime(testSegments, currentTime);

    if (activeSeg) {
      const segKey = activeSeg._uid || (activeSeg.id !== undefined && activeSeg.id !== null ? activeSeg.id : testSegments.indexOf(activeSeg));
      const isNewSegment = String(segKey) !== String(lastPlayheadSegKey);

      if (isNewSegment) {
        if (isEditingText) {
          followSyncSkippedDueToEditing = true;
          return;
        }

        lastPlayheadSegKey = segKey;

        if (String(selectedSegmentId) !== String(segKey)) {
          selectedSegmentId = segKey;
        }

        if (String(lastSyncedInspectorId) !== String(segKey)) {
          lastSyncedInspectorId = segKey;
          onSelectSegment(segKey);
        }
      }
    } else {
      lastPlayheadSegKey = null;
    }
  };

  const simulateBlur = (currentPlayheadTime, isStillEditing = false) => {
    if (isStillEditing) return;
    if (followSyncSkippedDueToEditing) {
      followSyncSkippedDueToEditing = false;
      const activeSeg = resolveSegmentAtTime(testSegments, currentPlayheadTime);
      if (activeSeg) {
        const segKey = activeSeg.id;
        lastPlayheadSegKey = segKey;
        selectedSegmentId = segKey;
        lastSyncedInspectorId = segKey;
        onSelectSegment(segKey);
      }
    }
  };

  // 1. Playback starts at 2s (segment 1) -> auto-follow selects seg_1
  runAutoFollowTick(2.0, false);
  assert.equal(selectedSegmentId, 'seg_1', 'Playback at 2s must select seg_1');
  assert.equal(onSelectSegmentCalls.length, 1);
  assert.equal(onSelectSegmentCalls[0], 'seg_1');

  // Next ticks in segment 1 (e.g. 2.2s, 4s, 8s) do not re-yank or call onSelectSegment
  runAutoFollowTick(2.2, false);
  runAutoFollowTick(4.0, false);
  runAutoFollowTick(8.0, false);
  assert.equal(onSelectSegmentCalls.length, 1, 'Ticks within same segment must not re-trigger sync');

  // 2. Playhead crosses boundary into segment 2 at 10.2s -> selects seg_2
  runAutoFollowTick(10.2, false);
  assert.equal(selectedSegmentId, 'seg_2', 'Crossing into 10.2s must select seg_2');
  assert.equal(onSelectSegmentCalls.length, 2);
  assert.equal(onSelectSegmentCalls[1], 'seg_2');

  // 3. User types in Inspector mid-playback (isEditingText = true):
  // Playhead crosses into segment 3 at 20.5s -> follow-sync MUST BE SKIPPED
  runAutoFollowTick(20.5, true);
  assert.equal(selectedSegmentId, 'seg_2', 'Selection must NOT switch away while user is editing');
  assert.equal(followSyncSkippedDueToEditing, true, 'followSyncSkippedDueToEditing must be marked true');
  assert.equal(onSelectSegmentCalls.length, 2, 'onSelectSegment must NOT be called while editing');

  // Playhead moves further in segment 3 while still editing -> still protected
  runAutoFollowTick(22.0, true);
  assert.equal(selectedSegmentId, 'seg_2');

  // 4. User finishes editing and blurs at 24.0s (video continues or paused) -> CATCH-UP
  simulateBlur(24.0, false);
  assert.equal(selectedSegmentId, 'seg_3', 'On blur, selection must catch up to seg_3 under playhead');
  assert.equal(followSyncSkippedDueToEditing, false, 'Skipped flag must be cleared');
  assert.equal(onSelectSegmentCalls[2], 'seg_3', 'Inspector must be synced to seg_3 on blur');

  // 5. Manual click override during playback:
  // Playhead is in segment 3 at 25s. User manually clicks seg_1 from list/timeline
  selectedSegmentId = 'seg_1';
  lastSyncedInspectorId = 'seg_1';
  // Playhead advances at 26s, 28s (still inside segment 3)
  runAutoFollowTick(26.0, false);
  assert.equal(selectedSegmentId, 'seg_1', 'Manual click on seg_1 must HOLD while playhead is still in segment 3');
  runAutoFollowTick(28.0, false);
  assert.equal(selectedSegmentId, 'seg_1', 'Manual click on seg_1 must continue to HOLD');

  // Playhead leaves segment 3 and enters GAP at 35s -> gap preserves current selection
  runAutoFollowTick(35.0, false);
  assert.equal(selectedSegmentId, 'seg_1', 'In gap, selection is preserved');

  // Playhead enters NEXT segment (seg_4) at 41s -> follow resumes and selects seg_4!
  runAutoFollowTick(41.0, false);
  assert.equal(selectedSegmentId, 'seg_4', 'When playhead enters next segment, follow resumes and selects seg_4');
});
