const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('+ ឃ្លា Add Segment: renders draft/no-audio segments on VOICE lanes and computes slotSpan cleanly', () => {
  const canvasPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx');
  const editorPath = path.resolve(__dirname, '../../frontend/src/components/TimelineEditor.jsx');
  const opsPath = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
  const cssPath = path.resolve(__dirname, '../../frontend/src/components/TimelineEditor.css');

  const canvasCode = fs.readFileSync(canvasPath, 'utf8');
  const editorCode = fs.readFileSync(editorPath, 'utf8');
  const opsCode = fs.readFileSync(opsPath, 'utf8');
  const cssCode = fs.readFileSync(cssPath, 'utf8');

  // 1. Voice lanes must not hide segments missing audioUrl when episode has voice or segment is user-added
  assert.ok(!canvasCode.includes('if (!hasAudio) return null;'), 'renderVoiceSegment must render draft box when hasAudio is false');
  assert.ok(canvasCode.includes('shouldRenderOnVoiceTrack'), 'TimelineTracksCanvas must define shouldRenderOnVoiceTrack');
  assert.ok(canvasCode.includes('is-pending-audio'), 'TimelineTracksCanvas must tag pending/draft voice clips with is-pending-audio');
  assert.ok(cssCode.includes('.voice-segment-block.is-pending-audio'), 'TimelineEditor.css must style pending/draft voice clip boxes');

  // 2. handleAddSegmentAtTime assigns free voice lane & explicit draft duration & userAdded
  assert.ok(opsCode.includes('userAdded: true'), 'handleAddSegmentAtTime must mark added segments with userAdded: true');
  assert.ok(opsCode.includes('audioDurationSec: draftDur'), 'handleAddSegmentAtTime must set explicit draft audioDurationSec');
  assert.ok(opsCode.includes('trackRow: targetRow'), 'handleAddSegmentAtTime must assign collision-free VOICE trackRow');

  // 3. Duration calculation falls back to slotSpan before hardcoded 2.5s
  assert.ok(editorCode.includes('const slotSpan ='), 'TimelineEditor must fall back to slotSpan for no-audio segments');
  assert.ok(canvasCode.includes('const slotSpan ='), 'TimelineTracksCanvas must fall back to slotSpan for no-audio segments');
});

test('+ ឃ្លា Add Segment: places new clip on VOICE 2 when VOICE 1 collides at playhead (Nha EP2 00:08.43 scenario)', async () => {
  const { resolveSegmentAtTime } = await import('../../frontend/src/utils/timelineUtils.js');
  const { getSegmentAudioDuration } = await import('../../frontend/src/utils/timestampUtils.js');

  const existingSegs = [
    { id: 2, startSec: 5.6, endSec: 6.92, audioStartSec: 5.6, audioEndSec: 6.92, audioDurationSec: 1.32 },
    { id: 3, startSec: 6.92, endSec: 9.25, audioStartSec: 6.92, audioEndSec: 9.25, audioDurationSec: 2.33 },
    { id: 4, startSec: 9.68, endSec: 11.72, audioStartSec: 9.68, audioEndSec: 11.72, audioDurationSec: 2.04 },
    { id: 5, startSec: 11.03, endSec: 13.38, audioStartSec: 11.03, audioEndSec: 13.38, audioDurationSec: 2.35 },
  ];

  // Simulate clicking "+ ឃ្លា" at playhead = 8.436s (inside #3 on VOICE 1)
  const safeTime = Math.floor(8.436 * 100) / 100; // 8.43
  let insertIdx = existingSegs.findIndex((s) => s.startSec > safeTime);
  if (insertIdx === -1) insertIdx = existingSegs.length;
  assert.equal(insertIdx, 2);

  const nextSegStart = existingSegs[insertIdx].startSec; // 9.68
  const safeEnd = Math.min(safeTime + 3.0, Math.max(safeTime + 1.0, parseFloat((nextSegStart - 0.1).toFixed(2))));
  assert.equal(safeEnd, 9.58);

  // Determine free VOICE row
  const rowEndTimes = [0, 0];
  const occupiedOnRow = new Map();
  existingSegs.forEach((seg) => {
    const sStart = seg.audioStartSec;
    const sDur = getSegmentAudioDuration(seg, seg.audioDurationSec || 2.5);
    const sEnd = sStart + sDur;
    let r = 0;
    if (sStart >= (rowEndTimes[0] || 0) - 0.05) {
      rowEndTimes[0] = sEnd;
      r = 0;
    } else if (sStart >= (rowEndTimes[1] || 0) - 0.05) {
      rowEndTimes[1] = sEnd;
      r = 1;
    } else {
      r = (rowEndTimes[0] || 0) <= (rowEndTimes[1] || 0) ? 0 : 1;
      rowEndTimes[r] = Math.max(rowEndTimes[r] || 0, sEnd);
    }
    if (!occupiedOnRow.has(r)) occupiedOnRow.set(r, []);
    occupiedOnRow.get(r).push([sStart, sEnd]);
  });

  let targetRow = 0;
  while (true) {
    const spans = occupiedOnRow.get(targetRow) || [];
    const overlaps = spans.some(([sStart, sEnd]) => safeTime < (sEnd - 0.02) && safeEnd > (sStart + 0.02));
    if (!overlaps) break;
    targetRow++;
  }

  // VOICE 1 (row 0) has #3 at 6.92..9.25 -> must pick VOICE 2 (row 1)!
  assert.equal(targetRow, 1, 'Colliding playhead on VOICE 1 must place new box on VOICE 2 (row 1)');

  const newSeg = {
    id: 'seg_test_new',
    startSec: safeTime,
    endSec: safeEnd,
    audioStartSec: safeTime,
    audioEndSec: safeEnd,
    audioDurationSec: parseFloat((safeEnd - safeTime).toFixed(2)),
    trackRow: targetRow,
    userAdded: true,
    userShifted: true,
  };

  const updated = [...existingSegs];
  updated.splice(insertIdx, 0, newSeg);

  // resolveSegmentAtTime must stay locked on the newly added segment even when playhead has sub-hundredth decimals (8.436s)
  const resolved = resolveSegmentAtTime(updated, 8.436);
  assert.equal(resolved?.id, 'seg_test_new', 'Playhead selection must stay on newly added box');

  // If user adds a second segment at same playhead (8.43s), resolveSegmentAtTime still picks newest one
  const secondSeg = { ...newSeg, id: 'seg_test_new_2', trackRow: 2 };
  updated.splice(insertIdx + 1, 0, secondSeg);
  const resolvedSecond = resolveSegmentAtTime(updated, 8.436);
  assert.equal(resolvedSecond?.id, 'seg_test_new_2', 'Second segment added at same timestamp must become active');
});

