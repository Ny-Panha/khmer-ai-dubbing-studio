import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  autoAlign,
  resetTiming,
  moveClip,
} from '../../frontend/src/utils/timelineOps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Auto-Align & Reset Timing Fix (EP5 219-seg #4 misalignment, re-laning, baseline, and visible reports)', () => {
  it('1. EP5 stored scenario: Auto-Align moves userShifted #4/#5 to true slot starts, re-lanes blocked #3 to VOICE 2, and reports overrun #2', () => {
    const ep5Sample = [
      {
        id: 1, _uid: 'seg_1',
        startSec: 0.27, endSec: 0.96, audioStartSec: 0.27, audioEndSec: 0.96,
        sourceStartSec: 0.27, sourceEndSec: 0.97,
        audioDurationSec: 0.69, finalAudioDuration: 0.69, originalAudioDuration: 0.691,
        audioUrl: '/uploads/a1.mp3', trackRow: 0, userShifted: false,
      },
      {
        id: 3, _uid: 'seg_3',
        startSec: 1.36, endSec: 2.72, audioStartSec: 1.36, audioEndSec: 2.72,
        sourceStartSec: 1.40, sourceEndSec: 3.20,
        audioDurationSec: 1.36, finalAudioDuration: 1.36, originalAudioDuration: 1.365,
        audioUrl: '/uploads/a3.mp3', trackRow: 0, userShifted: true,
      },
      {
        id: 2, _uid: 'seg_2',
        startSec: 3.59, endSec: 4.71, audioStartSec: 3.59, audioEndSec: 4.71,
        sourceStartSec: 0.97, sourceEndSec: 2.84,
        audioDurationSec: 1.12, finalAudioDuration: 1.12, originalAudioDuration: 1.123,
        audioUrl: '/uploads/a2.mp3', trackRow: 0, userShifted: true,
      },
      {
        id: 4, _uid: 'seg_4',
        startSec: 4.89, endSec: 7.66, audioStartSec: 4.84, audioEndSec: 7.61,
        sourceStartSec: 2.84, sourceEndSec: 6.11,
        audioDurationSec: 2.77, finalAudioDuration: 2.77, originalAudioDuration: 2.765,
        audioUrl: '/uploads/a4.mp3', trackRow: 1, userShifted: true,
      },
      {
        id: 5, _uid: 'seg_5',
        startSec: 8.07, endSec: 10.39, audioStartSec: 8.07, audioEndSec: 10.39,
        sourceStartSec: 6.11, sourceEndSec: 8.91,
        audioDurationSec: 2.32, finalAudioDuration: 2.32, originalAudioDuration: 2.323,
        audioUrl: '/uploads/a5.mp3', trackRow: 2, userShifted: true,
      },
      {
        id: 6, _uid: 'seg_6',
        startSec: 8.91, endSec: 9.40, audioStartSec: 8.91, audioEndSec: 9.40,
        sourceStartSec: 8.91, sourceEndSec: 11.71,
        audioDurationSec: 0.49, finalAudioDuration: 0.68, originalAudioDuration: 0.68,
        audioUrl: '/uploads/a6.mp3', trackRow: 0, userShifted: false, audioTrimmed: true,
      },
    ];

    const state = { videoClips: [{ id: 'clip-1', start: 0, end: 600 }], segments: ep5Sample };
    const res = autoAlign(state, { totalDuration: 600 });

    assert.equal(res.applied, true);
    assert.equal(res.state.segments.length, ep5Sample.length, 'Move-only count guard');

    const byId = Object.fromEntries(res.state.segments.map((s) => [s.id, s]));
    // Chronological order restored: 1, 2, 3, 4, 5, 6
    assert.deepEqual(res.state.segments.map((s) => s.id), [1, 2, 3, 4, 5, 6]);

    // #4 moves to its exact true slot start 2.84 on VOICE 1 (Lane 0)
    assert.equal(byId[4].startSec, 2.84);
    assert.equal(byId[4].audioStartSec, 2.84);
    assert.equal(byId[4].trackRow, 0);
    assert.equal(byId[4].userShifted, false);

    // #5 moves from VOICE 3 back to true slot start 6.11 on VOICE 1
    assert.equal(byId[5].startSec, 6.11);
    assert.equal(byId[5].audioStartSec, 6.11);
    assert.equal(byId[5].trackRow, 0);

    // #3 is blocked on Lane 0 by #2's tail (0.97 + 1.12 = 2.09 > 1.40) -> placed at EXACT 1.40 on VOICE 2
    assert.equal(byId[3].startSec, 1.40);
    assert.equal(byId[3].audioStartSec, 1.40);
    assert.equal(byId[3].trackRow, 1);

    // #2 flagged as overrun and explicitly named in report
    assert.equal(byId[2].audioOverrun, true);
    assert.ok(res.report.overrunClips.some((c) => c.clipNumber === 2), 'Overrun clip #2 must be named in report');
    assert.ok(res.report.relanedClips.some((c) => c.clipNumber === 3 && c.lane === 2), 'Re-laned clip #3 on VOICE 2 must be named');
    assert.ok(res.report.movedCount >= 4, 'At least #2/#3/#4/#5 must be reported as moved');

    // Strictly idempotent on second run
    const res2 = autoAlign(res.state, { totalDuration: 600 });
    assert.deepEqual(res2.state.segments, res.state.segments, 'Second Auto-Align must be strictly idempotent');
  });

  it('2. Blocked lane on #4 + overrunning #4: Auto-Align places #4 at exact slot start on VOICE 2, re-lanes #5, and names overrun clips', () => {
    const segs = [
      {
        id: 2, _uid: 's2', startSec: 1.0, endSec: 3.0, sourceStartSec: 1.0, sourceEndSec: 3.0,
        audioDurationSec: 3.2, audioUrl: '/a2.mp3', trackRow: 0, // runs 1.0 -> 4.2, blocking #4 at 3.7!
      },
      {
        id: 4, _uid: 's4', startSec: 4.6, endSec: 8.6, audioStartSec: 4.6, audioEndSec: 8.6,
        sourceStartSec: 3.7, sourceEndSec: 6.0,
        audioDurationSec: 4.0, audioUrl: '/a4.mp3', trackRow: 0, userShifted: true, // runs 3.7 -> 7.7, overrunning #5 at 6.1!
      },
      {
        id: 5, _uid: 's5', startSec: 6.1, endSec: 8.0, sourceStartSec: 6.1, sourceEndSec: 8.0,
        audioDurationSec: 1.8, audioUrl: '/a5.mp3', trackRow: 2, userShifted: true,
      },
    ];

    const res = autoAlign({ videoClips: [], segments: segs }, { totalDuration: 30 });
    const byId = Object.fromEntries(res.state.segments.map((s) => [s.id, s]));

    // #4 placed at exact true slot start 3.7 and re-laned to VOICE 2 (trackRow 1) because #2 ends at 4.2
    assert.equal(byId[4].startSec, 3.7);
    assert.equal(byId[4].audioStartSec, 3.7);
    assert.equal(byId[4].trackRow, 1);
    assert.equal(byId[4].audioOverrun, true);

    // #5 placed at exact true slot start 6.1 on VOICE 1 (since Lane 0 ended at 4.2 <= 6.1!)
    assert.equal(byId[5].startSec, 6.1);
    assert.equal(byId[5].audioStartSec, 6.1);
    assert.equal(byId[5].trackRow, 0);

    const overrunNums = res.report.overrunClips.map((c) => c.clipNumber);
    assert.deepEqual(overrunNums, [2, 4], 'Both overrunning clips #2 and #4 must be named');
  });

  it('3. Drag #4 away (even without initial sourceStartSec) -> Reset Timing restores #4 to original timing and clears userShifted/trackRow', () => {
    const legacySegs = [
      { id: 1, _uid: 'l1', startSec: 0.5, endSec: 2.0, audioDurationSec: 1.2, audioUrl: '/1.mp3', trackRow: 0 },
      { id: 4, _uid: 'l4', startSec: 3.7, endSec: 6.0, audioDurationSec: 2.0, audioUrl: '/4.mp3', trackRow: 0 },
    ];
    // Move #4 away to 9.5s on VOICE 3
    const moved = moveClip({ videoClips: [], segments: legacySegs }, { clipId: 'l4', newStart: 9.5, trackRow: 2 });
    assert.equal(moved.applied, true);
    assert.equal(moved.state.segments[1].startSec, 9.5);
    assert.equal(moved.state.segments[1].sourceStartSec, 3.7, 'moveClip must preserve original sourceStartSec before moving');
    assert.equal(moved.state.segments[1].trackRow, 2);

    // Reset Timing must bring #4 back to 3.7s on VOICE 1 and clear userShifted
    const reset = resetTiming(moved.state, { totalDuration: 30 });
    assert.equal(reset.applied, true);
    assert.equal(reset.report.createdBaseline, false);
    const seg4 = reset.state.segments.find((s) => s.id === 4);
    assert.equal(seg4.startSec, 3.7);
    assert.equal(seg4.audioStartSec, 3.7);
    assert.equal(seg4.trackRow, 0);
    assert.equal(seg4.userShifted, false);
    assert.ok(reset.report.movedClipNumbers.includes(4));
  });

  it('4. Reset Timing without any prior snapshot creates a real baseline and flags createdBaseline=true (never silent no-op)', () => {
    const noBaselineSegs = [
      { id: 1, _uid: 'nb1', startSec: 1.0, endSec: 3.0, audioDurationSec: 2.5, audioUrl: '/1.mp3' },
      { id: 2, _uid: 'nb2', startSec: 3.0, endSec: 5.0, audioDurationSec: 1.5, audioUrl: '/2.mp3' },
    ];
    const res = resetTiming({ videoClips: [], segments: noBaselineSegs }, { totalDuration: 20 });
    assert.equal(res.applied, true);
    assert.equal(res.report.createdBaseline, true);
    assert.equal(res.report.baselineSnapshot.length, 2);
    assert.equal(res.state.segments[0].sourceStartSec, 1.0);
    assert.equal(res.state.segments[1].sourceStartSec, 3.0);
    assert.ok(res.report.overrunClips.some((c) => c.clipNumber === 1), 'Overrunning #1 still named in Reset report');
  });

  it('5. Static audit: visible toasts fire on Auto-Align/Reset Timing and re-laned trackRow > 0 renders visually', () => {
    const opsHookCode = fs.readFileSync(path.join(__dirname, '../../frontend/src/hooks/useClipOperations.js'), 'utf8');
    const editorCode = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');
    const canvasCode = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8');

    assert.ok(opsHookCode.includes('buildAutoAlignToastMessage'), 'Auto-Align builds visible summary/overrun toast');
    assert.ok(!opsHookCode.includes('handleResetToSourceTiming'), 'Reset Timing feature removed from useClipOperations');
    assert.ok(opsHookCode.includes('originalTimingSnapshot'), 'useClipOperations wires originalTimingSnapshot');
    assert.ok(editorCode.includes('(seg.userShifted || seg.trackRow > 0)'), 'TimelineEditor renders auto-aligned multi-lane clips on assigned VOICE row');
    assert.ok(canvasCode.includes('(seg.userShifted || seg.trackRow > 0)'), 'TimelineTracksCanvas renders auto-aligned multi-lane clips on assigned VOICE row');
  });
});
