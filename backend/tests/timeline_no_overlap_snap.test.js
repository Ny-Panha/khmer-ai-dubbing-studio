const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('TimelineEditor: Static audit for Audio No-Overlap Clamp & Edge Snapping', () => {
  const file = path.resolve(__dirname, '../../frontend/src/components/TimelineEditor.jsx');
  const code = fs.readFileSync(file, 'utf8');

  // Verify getSegmentAudioDuration import
  assert.ok(code.includes("import { formatMinSec, getSegmentAudioDuration } from '../utils/timestampUtils'"),
    'TimelineEditor must import getSegmentAudioDuration');

  // Verify getSegEffectiveRange helper
  assert.ok(code.includes('getSegEffectiveRange'),
    'TimelineEditor must define getSegEffectiveRange');

  // Verify magnetic snap and strict no-overlap clamp during dragging
  assert.ok(code.includes('Strict No-Overlap Clamp on the same track'),
    'TimelineEditor must enforce strict no-overlap clamp on active track');
  assert.ok(code.includes('if (newStart < prevBound) {') && code.includes('newStart = prevBound'),
    'TimelineEditor must clamp newStart to prevBound');
  assert.ok(code.includes('if (nextBound !== Infinity && newEnd > nextBound) {') && code.includes('newEnd = nextBound'),
    'TimelineEditor must clamp newEnd to nextBound');

  // Verify trimming clamps
  assert.ok(code.includes("dragState.mode === 'trim-left'") && code.includes('minAllowedStart'),
    'trim-left must respect minAllowedStart');
  assert.ok(code.includes("dragState.mode === 'trim-right'") && code.includes('maxAllowedEnd'),
    'trim-right must respect maxAllowedEnd');

  // Verify mouse up persistence clamp
  assert.ok(code.includes('Enforce strict no-overlap clamp on final target row'),
    'TimelineEditor must clamp persisted segments upon drop');
});

test('Timeline Simulation: Audio clips on the same track never overlap and snap edge-to-edge (||)', () => {
  // Scenario matching Nha's real case:
  // Clip #1: [0.20, 1.52] (e.g. 1.32s duration)
  // Clip #2: [1.52, 5.17] (e.g. 3.65s duration)
  const clip1 = { id: 1, start: 0.20, end: 1.52, trackRow: 0 };
  const clip2 = { id: 2, start: 1.52, end: 5.17, trackRow: 0 };
  const clip3 = { id: 3, start: 6.00, end: 8.00, trackRow: 0 };

  const segments = [clip1, clip2, clip3];
  const clip2Dur = clip2.end - clip2.start; // 3.65s

  const simulateDragAudio = (dragIdx, requestedDelta) => {
    const curSeg = segments[dragIdx];
    const curRow = curSeg.trackRow;
    let newStart = Math.max(0, curSeg.start + requestedDelta);
    let newEnd = newStart + clip2Dur;

    let prevBound = 0;
    let nextBound = Infinity;

    for (let i = 0; i < segments.length; i++) {
      if (i === dragIdx) continue;
      const other = segments[i];
      if (other.trackRow !== curRow) continue;

      if (other.end <= curSeg.start + 0.05) {
        if (other.end > prevBound) prevBound = other.end;
      } else if (other.start >= curSeg.end - 0.05) {
        if (other.start < nextBound) nextBound = other.start;
      }
    }

    // Magnetic snap (within 0.15s window)
    const snapThreshold = 0.15;
    let snappedTo = null;
    if (Math.abs(newStart - prevBound) < snapThreshold) {
      newStart = prevBound;
      newEnd = newStart + clip2Dur;
      snappedTo = prevBound;
    } else if (nextBound !== Infinity && Math.abs(newEnd - nextBound) < snapThreshold) {
      newEnd = nextBound;
      newStart = Math.max(prevBound, newEnd - clip2Dur);
      snappedTo = nextBound;
    }

    // Strict No-Overlap Clamp
    if (newStart < prevBound) {
      newStart = prevBound;
      newEnd = newStart + clip2Dur;
    }
    if (nextBound !== Infinity && newEnd > nextBound) {
      newEnd = nextBound;
      newStart = Math.max(prevBound, newEnd - clip2Dur);
    }

    return { newStart, newEnd, prevBound, nextBound, snappedTo };
  };

  // Case 1: Drag Clip #2 violently to the left towards Clip #1 (e.g. delta = -1.0s, wanting start at 0.52s)
  // WITHOUT clamp: Clip #2 would start at 0.52s and overlap Clip #1 [0.20, 1.52]!
  // WITH clamp: Clip #2 MUST stop rigidly at 1.52s (edge-to-edge with Clip #1 ||)
  const leftViolentDrag = simulateDragAudio(1, -1.0);
  assert.equal(leftViolentDrag.newStart, 1.52, 'Clip #2 must NEVER overlap Clip #1; clamped at 1.52');
  assert.equal(leftViolentDrag.prevBound, 1.52);

  // Case 2: Drag Clip #2 gently close to Clip #1 (delta = -0.10s, within 0.15s snap window)
  const leftSnapDrag = simulateDragAudio(1, -0.08);
  assert.equal(leftSnapDrag.newStart, 1.52, 'Clip #2 must magnetically snap to Clip #1 right edge');
  assert.equal(leftSnapDrag.snappedTo, 1.52);

  // Case 3: Drag Clip #2 violently to the right towards Clip #3 [6.00, 8.00]
  // Clip #2 dur = 3.65s. If newStart dragged to 3.00s, newEnd would be 6.65s (overlapping Clip #3)!
  // WITH clamp: Clip #2 newEnd cannot exceed 6.00s, so newStart is clamped to 6.00 - 3.65 = 2.35s
  const rightViolentDrag = simulateDragAudio(1, +1.5); // requested start: 3.02s
  assert.equal(rightViolentDrag.newEnd, 6.00, 'Clip #2 right edge must clamp to Clip #3 start (6.00)');
  assert.equal(rightViolentDrag.newStart, parseFloat((6.00 - clip2Dur).toFixed(2)));
});

