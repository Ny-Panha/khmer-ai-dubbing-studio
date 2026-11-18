import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isVoiceDropTargetAllowed,
  clampVoiceDragY,
  resolveVoiceDropRow,
  computeVoiceDragPosition,
} from '../../frontend/src/utils/timelineUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

describe('Voice Clip Lane Isolation (Never Joins Video Track)', () => {
  it('1. Drop target validation: ONLY voice lanes are valid drop targets for voice clips (video/subs/clean-bgm rejected)', () => {
    assert.equal(isVoiceDropTargetAllowed('voice'), true);
    assert.equal(isVoiceDropTargetAllowed('VOICE'), true);
    assert.equal(isVoiceDropTargetAllowed('video'), false);
    assert.equal(isVoiceDropTargetAllowed('subs'), false);
    assert.equal(isVoiceDropTargetAllowed('clean-bgm'), false);
    assert.equal(isVoiceDropTargetAllowed(null), false);
    assert.equal(isVoiceDropTargetAllowed(undefined), false);
  });

  it('2. Upward drag past top voice lane clamps drop row to voice_0 (row 0) and ignores video lane pointer hits', () => {
    // Voice #9 on VOICE 1 (row 0) dragged straight upward into VIDEO track (clientY < firstLaneTop)
    const fromRow0Up = resolveVoiceDropRow({
      pointerLaneType: 'video',
      pointerLaneRow: 0,
      pointerClientY: 680,
      firstLaneTop: 715,
      lastLaneBottom: 862,
      deltaY: -60,
      curRow: 0,
      voiceRowCount: 4,
      laneHeight: 37,
    });
    assert.equal(fromRow0Up, 0);

    // Voice on VOICE 2 (row 1) dragged far upward past VOICE 1 into VIDEO track -> clamps to row 0 (VOICE 1)
    const fromRow1FarUp = resolveVoiceDropRow({
      pointerLaneType: 'video',
      pointerLaneRow: 0,
      pointerClientY: 600,
      firstLaneTop: 715,
      lastLaneBottom: 862,
      deltaY: -150,
      curRow: 1,
      voiceRowCount: 4,
      laneHeight: 37,
    });
    assert.equal(fromRow1FarUp, 0);

    // Normal voice-to-voice lane moves still work (VOICE 1 -> VOICE 2, VOICE 2 -> VOICE 1, VOICE 1 -> VOICE 3)
    const toVoice2 = resolveVoiceDropRow({
      pointerLaneType: 'voice',
      pointerLaneRow: 1,
      pointerClientY: 770,
      firstLaneTop: 715,
      lastLaneBottom: 862,
      deltaY: 42,
      curRow: 0,
      voiceRowCount: 4,
      laneHeight: 37,
    });
    assert.equal(toVoice2, 1);

    const backToVoice1 = resolveVoiceDropRow({
      pointerLaneType: 'voice',
      pointerLaneRow: 0,
      pointerClientY: 730,
      firstLaneTop: 715,
      lastLaneBottom: 862,
      deltaY: -40,
      curRow: 1,
      voiceRowCount: 4,
      laneHeight: 37,
    });
    assert.equal(backToVoice1, 0);
  });

  it('3. Drag ghost/preview vertical clamp stays strictly inside voice lanes area (never overlaps VIDEO track)', () => {
    // From VOICE 1 (row 0, top=715): dragging upward -46px or -200px clamps strictly to 0px
    const row0Up = clampVoiceDragY({
      deltaY: -46,
      curRow: 0,
      voiceRowCount: 4,
      laneHeight: 37,
      firstLaneTop: 715,
      lastLaneTop: 825,
      originLaneTop: 715,
    });
    assert.equal(row0Up.clampedY, 0);
    assert.equal(row0Up.minDeltaY, 0);

    const row0FarUp = clampVoiceDragY({
      deltaY: -200,
      curRow: 0,
      voiceRowCount: 4,
      laneHeight: 37,
      firstLaneTop: 715,
      lastLaneTop: 825,
      originLaneTop: 715,
    });
    assert.equal(row0FarUp.clampedY, 0);

    // From VOICE 2 (row 1, top=752): dragging upward -120px clamps strictly to -37px (VOICE 1 top=715, never VIDEO)
    const row1FarUp = clampVoiceDragY({
      deltaY: -120,
      curRow: 1,
      voiceRowCount: 4,
      laneHeight: 37,
      firstLaneTop: 715,
      lastLaneTop: 825,
      originLaneTop: 752,
    });
    assert.equal(row1FarUp.clampedY, -37);
    assert.equal(752 + row1FarUp.clampedY, 715);

    // Dragging downward past last voice lane clamps strictly to last voice lane top
    const row0FarDown = clampVoiceDragY({
      deltaY: 300,
      curRow: 0,
      voiceRowCount: 4,
      laneHeight: 37,
      firstLaneTop: 715,
      lastLaneTop: 825,
      originLaneTop: 715,
    });
    assert.equal(row0FarDown.clampedY, 110);
    assert.equal(715 + row0FarDown.clampedY, 825);
  });

  it('4. Voice clip snapping uses VOICE clips ONLY — never snaps to video clip edges/boundaries', () => {
    const segments = [
      { id: 8, audioStartSec: 11.71, audioEndSec: 13.49, trackRow: 0 },
      { id: 9, audioStartSec: 13.81, audioEndSec: 15.11, trackRow: 0 },
      { id: 10, audioStartSec: 15.45, audioEndSec: 16.92, trackRow: 0 },
    ];
    const rows = [0, 0, 0];

    // Video clip boundary exists at 13.81s and 13.90s — dragging #9 on VOICE 1 to 13.90s (end=15.20s, away from VOICE #8/#10) must NOT snap to video edges
    const nearVideoBoundary = computeVoiceDragPosition({
      origStart: 13.81,
      origEnd: 15.11,
      proposedStart: 13.90,
      draggedIndex: 1,
      curRow: 0,
      targetRow: 0,
      scriptSegments: segments,
      segmentRows: rows,
      snappingEnabled: true,
      shiftKey: false,
      pps: 45,
    });
    assert.equal(nearVideoBoundary.snapTime, null);
    assert.ok(Math.abs(nearVideoBoundary.newStart - 13.90) < 0.001);

    // Dragging #9 onto VOICE 2 (empty around 13s-16s) right next to video clip edges (13.49, 13.81, 15.11, 15.45) must NEVER snap
    for (const testStart of [13.46, 13.52, 13.78, 13.84, 15.08, 15.42]) {
      const res = computeVoiceDragPosition({
        origStart: 13.81,
        origEnd: 15.11,
        proposedStart: testStart,
        draggedIndex: 1,
        curRow: 0,
        targetRow: 1,
        scriptSegments: segments,
        segmentRows: rows,
        snappingEnabled: true,
        shiftKey: false,
        pps: 45,
      });
      assert.equal(res.snapTime, null, `VOICE 2 drag at ${testStart}s must NOT snap to any video edge`);
      assert.ok(Math.abs(res.newStart - testStart) < 0.001);
    }

    // Dragging #9 on VOICE 1 close to VOICE #8 end (13.49s) DOES snap to VOICE #8 and clamps cleanly without overlap
    const nearVoice8 = computeVoiceDragPosition({
      origStart: 13.81,
      origEnd: 15.11,
      proposedStart: 13.55,
      draggedIndex: 1,
      curRow: 0,
      targetRow: 0,
      scriptSegments: segments,
      segmentRows: rows,
      snappingEnabled: true,
      shiftKey: false,
      pps: 45,
    });
    assert.equal(nearVoice8.snapTime, 13.49);
    assert.equal(nearVoice8.newStart, 13.49);

    // Dragging #9 upward on VOICE 1 (clamped to row 0) + right past #10 STILL clamps against #10 (no overlap!)
    const pushIntoVoice10 = computeVoiceDragPosition({
      origStart: 13.81,
      origEnd: 15.11,
      proposedStart: 14.81,
      draggedIndex: 1,
      curRow: 0,
      targetRow: 0,
      scriptSegments: segments,
      segmentRows: rows,
      snappingEnabled: true,
      shiftKey: false,
      pps: 45,
    });
    assert.ok(pushIntoVoice10.newEnd <= 15.45 + 0.001, 'must stay before #10 start on same lane');
  });

  it('5. Static audit: TimelineEditor and TimelineTracksCanvas wire all 3 isolation guards while keeping video drag intact', () => {
    const editorSrc = fs.readFileSync(
      path.join(ROOT, 'frontend', 'src', 'components', 'timeline', 'TimelineEditor.jsx'),
      'utf8'
    );
    const canvasSrc = fs.readFileSync(
      path.join(ROOT, 'frontend', 'src', 'components', 'timeline', 'TimelineTracksCanvas.jsx'),
      'utf8'
    );

    // TimelineEditor wiring
    assert.match(editorSrc, /isVoiceDropTargetAllowed/);
    assert.match(editorSrc, /clampVoiceDragY/);
    assert.match(editorSrc, /resolveVoiceDropRow/);
    assert.match(editorSrc, /computeVoiceDragPosition/);
    assert.match(editorSrc, /if \(isExplicitVoiceDrag && !isVoiceDropTargetAllowed\(trackType\)\)/);
    assert.match(editorSrc, /if \(trackType === 'video' \|\| \(!isVoiceDropTargetAllowed\(trackType\) && trackType !== 'subs'\)\)/);
    // Video clip dragging behavior preserved
    assert.match(editorSrc, /if \(dragState\.itemType === 'video' && videoClips\)/);

    // TimelineTracksCanvas wiring
    assert.match(canvasSrc, /safeVoiceTranslateY/);
    assert.match(canvasSrc, /isVoiceDragActive = dragState\?\.itemType === 'audio'/);
    assert.match(canvasSrc, /isDraggedVoicePayload/);
    assert.match(canvasSrc, /Video track is NEVER a valid drop target for a voice clip/);
  });
});
