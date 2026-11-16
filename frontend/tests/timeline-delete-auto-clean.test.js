import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignTimelineFromSegments,
  deleteSegmentByIdOrIndex,
} from '../src/utils/timelineUtils.js';

const makeSegment = (id, startSec, endSec, overrides = {}) => ({
  id,
  segmentId: id,
  startSec,
  endSec,
  audioStartSec: startSec,
  audioEndSec: endSec,
  duration: endSec - startSec,
  audioDurationSec: endSec - startSec,
  speaker: `Speaker ${id}`,
  trackRow: 2,
  ...overrides,
});

test('delete then shared alignment packs surviving voices and rebuilds exact dialogue ranges with full Gap coverage', () => {
  const before = [makeSegment(1, 0, 2), makeSegment(2, 2, 4), makeSegment(3, 4, 6)];
  const remaining = deleteSegmentByIdOrIndex(before, 2, { ripple: true });
  const aligned = alignTimelineFromSegments(remaining, [], 10, 'episode.mp4');

  assert.equal(aligned.segments.length, 2);
  assert.deepEqual(aligned.segments.map((segment) => segment.trackRow), [0, 0]);
  assert.deepEqual(aligned.segments.map((segment) => segment.audioStartSec), [0, 2]);

  const dialogue = aligned.videoClips.filter((clip) => clip.isDialogue);
  assert.equal(dialogue.length, aligned.segments.length);
  for (let i = 0; i < dialogue.length; i += 1) {
    assert.equal(dialogue[i].segmentId, aligned.segments[i].id);
    assert.equal(dialogue[i].start, aligned.segments[i].audioStartSec);
    assert.equal(dialogue[i].end, aligned.segments[i].audioEndSec);
  }

  let cursor = 0;
  for (const clip of aligned.videoClips) {
    assert.ok(clip.start >= cursor - 0.001, 'VIDEO 1 clips must not overlap');
    assert.ok(clip.start <= cursor + 0.001, 'VIDEO 1 must be fully covered without holes');
    cursor = clip.end;
  }
  assert.equal(cursor, 10);
});

test('shared alignment preserves the surviving dialogue clip source range after a ripple delete', () => {
  const remaining = [makeSegment(1, 2, 4)];
  const existingVideo = [{
    id: 'clip-seg-1',
    segmentId: 1,
    segmentIndex: 1,
    start: 2,
    end: 4,
    sourceStart: 8,
    sourceEnd: 10,
    isDialogue: true,
  }];

  const aligned = alignTimelineFromSegments(remaining, existingVideo, 10);
  const dialogue = aligned.videoClips.find((clip) => clip.isDialogue);

  assert.deepEqual(
    { start: dialogue.start, end: dialogue.end, sourceStart: dialogue.sourceStart, sourceEnd: dialogue.sourceEnd },
    { start: 2, end: 4, sourceStart: 8, sourceEnd: 10 }
  );
});

test('shared alignment keeps owner-dragged voice timing and lane unchanged', () => {
  const moved = makeSegment(2, 2, 3, {
    userShifted: true,
    trackRow: 1,
    startSec: 2,
    endSec: 3,
    audioStartSec: 7.25,
    audioEndSec: 8.25,
  });
  const aligned = alignTimelineFromSegments([makeSegment(1, 0, 1), moved], [], 10);
  const preserved = aligned.segments.find((segment) => segment.userShifted);

  assert.equal(preserved.audioStartSec, 7.25);
  assert.equal(preserved.audioEndSec, 8.25);
  assert.equal(preserved.trackRow, 1);
});

test('deleting an adjacent segment does not ripple an owner-dragged voice clip', () => {
  const before = [
    makeSegment(1, 0, 2),
    makeSegment(2, 2, 4),
    makeSegment(3, 4, 6, {
      userShifted: true,
      trackRow: 1,
      startSec: 4,
      endSec: 6,
      audioStartSec: 4.25,
      audioEndSec: 5.75,
    }),
  ];
  const remaining = deleteSegmentByIdOrIndex(before, 2, { ripple: true });
  const aligned = alignTimelineFromSegments(remaining, [], 10);
  const moved = aligned.segments.find((segment) => segment.userShifted);

  assert.equal(moved.audioStartSec, 4.25);
  assert.equal(moved.audioEndSec, 5.75);
  assert.equal(moved.trackRow, 1);
});

test('shared alignment restores a full-duration Gap when no dialogue remains', () => {
  const aligned = alignTimelineFromSegments([], [], 10);
  assert.deepEqual(aligned.segments, []);
  assert.equal(aligned.videoClips.length, 1);
  assert.deepEqual(
    { start: aligned.videoClips[0].start, end: aligned.videoClips[0].end, name: aligned.videoClips[0].name },
    { start: 0, end: 10, name: 'Gap' }
  );
});
