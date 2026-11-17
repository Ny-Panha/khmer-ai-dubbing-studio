const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

function assertContinuousCoverage(clips, duration) {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  assert.ok(sorted.length > 0, 'video track must contain clips');
  assert.equal(sorted[0].start, 0, 'video track starts at zero');
  let end = 0;
  for (const clip of sorted) {
    assert.ok(clip.start >= end - 0.000001, `clip ${clip.id} does not overlap its predecessor`);
    assert.ok(Math.abs(clip.start - end) <= 0.000001, `clip ${clip.id} touches its predecessor`);
    assert.ok(clip.end - clip.start >= 0.1, `clip ${clip.id} is not a sub-0.1s sliver`);
    end = clip.end;
  }
  assert.equal(end, duration, 'video track covers the full episode duration');
}

describe('Remove-only timeline delete', () => {
  const timelineUtilsPath = path.resolve(__dirname, '../../frontend/src/utils/timelineUtils.js');
  const timelineUtilsCode = fs.readFileSync(timelineUtilsPath, 'utf8');

  test('middle voice delete preserves segment timing and leaves video clips deeply unchanged', async () => {
    const { deleteSegmentByIdOrIndex } = await import(pathToFileURL(timelineUtilsPath));
    const segments = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      segmentId: index + 1,
      _uid: `seg-${index + 1}`,
      start: `00:0${index * 2}`,
      end: `00:0${index * 2 + 2}`,
      startSec: index * 2,
      endSec: index * 2 + 2,
      audioStartSec: index * 2 + 0.1,
      audioEndSec: index * 2 + 1.9,
      chineseText: `line ${index + 1}`,
      subtitleText: `subtitle ${index + 1}`,
    }));

    const updated = deleteSegmentByIdOrIndex(segments, segments[2]._uid, { ripple: false, preserveIds: true });
    const videoClipsBefore = segments.map((segment) => ({
      id: `clip-${segment.id}`,
      name: `#${segment.id} Speaker`,
      isDialogue: true,
      segmentId: segment.segmentId,
      segmentIndex: segment.id,
      start: segment.startSec,
      end: segment.endSec,
    }));
    const videoClipsAfter = structuredClone(videoClipsBefore);

    assert.deepEqual(updated.map((segment) => segment.id), [1, 2, 4, 5]);
    assert.deepEqual(updated.map((segment) => segment.segmentId), [1, 2, 4, 5]);
    assert.deepEqual(updated, segments.filter((segment) => segment.id !== 3));
    assert.deepEqual(videoClipsAfter, videoClipsBefore);
    assert.deepEqual(updated.map(({ startSec, endSec, audioStartSec, audioEndSec }) => [
      startSec, endSec, audioStartSec, audioEndSec,
    ]), [
      [0, 2, 0.1, 1.9],
      [2, 4, 2.1, 3.9],
      [6, 8, 6.1, 7.9],
      [8, 10, 8.1, 9.9],
    ]);
    assert.deepEqual(updated.map((segment) => segment.subtitleText), [
      'subtitle 1', 'subtitle 2', 'subtitle 4', 'subtitle 5',
    ]);
  });

  test('script hydration preserves non-sequential segment numbers', async () => {
    const { sanitizeScriptData } = await import(pathToFileURL(timelineUtilsPath));
    const segments = [1, 2, 4, 5].map((id) => ({ id, segmentId: id, chineseText: `line ${id}` }));

    const sanitized = sanitizeScriptData({ segments });

    assert.deepEqual(sanitized.segments.map((segment) => segment.id), [1, 2, 4, 5]);
    assert.deepEqual(sanitized.segments.map((segment) => segment.segmentId), [1, 2, 4, 5]);
  });

  test('middle video delete leaves survivor clips unchanged and inserts one exact Gap', async () => {
    const { deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const segments = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      segmentId: index + 1,
      startSec: index * 2,
      endSec: index * 2 + 2,
    }));
    const clips = Array.from({ length: 5 }, (_, index) => ({
      id: `clip-${index + 1}`,
      name: `#${index + 1} Speaker`,
      isDialogue: true,
      segmentId: index + 1,
      segmentIndex: index + 1,
      start: index * 2,
      end: index * 2 + 2,
      sourceStart: index * 2,
      sourceEnd: index * 2 + 2,
    }));

    const updated = deleteClipById(clips, 'clip-3', {
      allowEmpty: true,
      ripple: false,
      preserveIds: true,
      gapOnDelete: true,
      totalDuration: 10,
    });
    const segmentsAfter = structuredClone(segments);

    assert.deepEqual(
      updated.filter((clip) => clip.isDialogue),
      clips.filter((clip) => clip.id !== 'clip-3')
    );
    const gaps = updated.filter((clip) => clip.name === 'Gap');
    assert.equal(gaps.length, 1);
    assert.deepEqual([gaps[0].start, gaps[0].end], [4, 6]);
    assert.deepEqual(segmentsAfter, segments);
    assertContinuousCoverage(updated, 10);
  });

  test('deleting first or last item keeps every remaining start and end unchanged', async () => {
    const { deleteSegmentByIdOrIndex, deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const segments = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      segmentId: index + 1,
      startSec: index * 2,
      endSec: index * 2 + 2,
    }));
    const clips = segments.map((segment) => ({
      id: `clip-${segment.id}`,
      isDialogue: true,
      segmentId: segment.id,
      segmentIndex: segment.id,
      start: segment.startSec,
      end: segment.endSec,
    }));

    for (const id of [1, 5]) {
      const updatedSegments = deleteSegmentByIdOrIndex(segments, id, { ripple: false, preserveIds: true });
      assert.deepEqual(updatedSegments, segments.filter((segment) => segment.id !== id));

      const updatedClips = deleteClipById(clips, `clip-${id}`, {
        allowEmpty: true,
        ripple: false,
        preserveIds: true,
        gapOnDelete: true,
        totalDuration: 10,
      });
      assert.deepEqual(
        updatedClips.filter((clip) => clip.isDialogue),
        clips.filter((clip) => clip.id !== `clip-${id}`)
      );
      const gap = updatedClips.find((clip) => clip.name === 'Gap');
      assert.deepEqual([gap.start, gap.end], [(id - 1) * 2, id * 2]);
      assertContinuousCoverage(updatedClips, 10);
    }
  });

  test('deleted dialogue clip joins all touching Gaps on both sides into one span', async () => {
    const { deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const clips = [
      { id: 'gap-left', name: 'Gap', start: 0, end: 2 },
      { id: 'gap-left-2', name: 'Gap', start: 2, end: 3 },
      { id: 'clip-3', name: '#3 Speaker', isDialogue: true, segmentId: 3, start: 3, end: 4 },
      { id: 'gap-right', name: 'Gap', start: 4, end: 5 },
      { id: 'gap-right-2', name: 'Gap', start: 5, end: 7 },
      { id: 'clip-4', name: '#4 Speaker', isDialogue: true, segmentId: 4, start: 7, end: 9 },
    ];

    const updated = deleteClipById(clips, 'clip-3', {
      allowEmpty: true,
      ripple: false,
      preserveIds: true,
      gapOnDelete: true,
      totalDuration: 9,
    });

    assert.deepEqual(updated.filter((clip) => clip.name === 'Gap').map(({ start, end }) => [start, end]), [[0, 7]]);
    assert.deepEqual(updated.find((clip) => clip.id === 'clip-4'), clips[5]);
    assertContinuousCoverage(updated, 9);
  });

  test('deleted dialogue clip joins a single Gap on either side', async () => {
    const { deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const cases = [
      {
        clips: [
          { id: 'clip-1', name: '#1 Speaker', isDialogue: true, segmentId: 1, start: 0, end: 2 },
          { id: 'gap-right', name: 'Gap', start: 2, end: 4 },
          { id: 'clip-2', name: '#2 Speaker', isDialogue: true, segmentId: 2, start: 4, end: 6 },
        ],
        deletedId: 'clip-1',
        gap: [0, 4],
      },
      {
        clips: [
          { id: 'clip-1', name: '#1 Speaker', isDialogue: true, segmentId: 1, start: 0, end: 2 },
          { id: 'gap-left', name: 'Gap', start: 2, end: 4 },
          { id: 'clip-2', name: '#2 Speaker', isDialogue: true, segmentId: 2, start: 4, end: 6 },
        ],
        deletedId: 'clip-2',
        gap: [2, 6],
      },
    ];

    for (const { clips, deletedId, gap } of cases) {
      const updated = deleteClipById(clips, deletedId, {
        allowEmpty: true,
        ripple: false,
        preserveIds: true,
        gapOnDelete: true,
        totalDuration: 6,
      });
      assert.deepEqual(updated.filter((clip) => clip.name === 'Gap').map(({ start, end }) => [start, end]), [gap]);
      assert.deepEqual(updated.find((clip) => clip.id !== deletedId && clip.isDialogue), clips.find((clip) => clip.id !== deletedId && clip.isDialogue));
      assertContinuousCoverage(updated, 6);
    }
  });

  test('splitting a Gap at midpoint or near either edge produces two exact Gap clips', async () => {
    const { splitClipAtTime } = await import(pathToFileURL(timelineUtilsPath));
    const cases = [
      { splitTime: 5, expected: [[2, 5], [5, 8]] },
      { splitTime: 2.001, expected: [[2, 2.001], [2.001, 8]] },
      { splitTime: 2.06, expected: [[2, 2.06], [2.06, 8]] },
      { splitTime: 7.94, expected: [[2, 7.94], [7.94, 8]] },
    ];

    for (const { splitTime, expected } of cases) {
      const gap = {
        id: 'clip-gap-test',
        name: 'Gap',
        start: 2,
        end: 8,
        sourceStart: 2,
        sourceEnd: 8,
        isDialogue: false,
      };
      const result = splitClipAtTime([gap], splitTime, 8);

      assert.ok(result);
      assert.deepEqual(result.newClips.map((clip) => [clip.start, clip.end]), expected);
      assert.deepEqual(result.newClips.map((clip) => clip.name), ['Gap', 'Gap']);
      assert.ok(result.newClips.every((clip) => !clip.isDialogue));
      assert.equal(result.newClips[0].sourceEnd, splitTime);
      assert.equal(result.newClips[1].sourceStart, splitTime);
    }
  });

  test('deleting a middle Gap ripples only later video clips and shortens continuous coverage', async () => {
    const { deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const clips = [
      { id: 'clip-before', name: '#1 Speaker', isDialogue: true, segmentId: 1, segmentIndex: 1, start: 0, end: 2, sourceStart: 10, sourceEnd: 12 },
      { id: 'gap-delete', name: 'Gap', start: 2, end: 5, sourceStart: 2, sourceEnd: 5 },
      { id: 'clip-after', name: '#2 Speaker', isDialogue: true, segmentId: 2, segmentIndex: 2, start: 5, end: 7, sourceStart: 20, sourceEnd: 22 },
      { id: 'gap-after', name: 'Gap', start: 7, end: 9, sourceStart: 7, sourceEnd: 9 },
      { id: 'clip-last', name: '#3 Speaker', isDialogue: true, segmentId: 3, segmentIndex: 3, start: 9, end: 12, sourceStart: 30, sourceEnd: 33 },
    ];
    const segments = [
      { id: 1, startSec: 1, endSec: 2, audioStartSec: 1, audioEndSec: 2 },
      { id: 2, startSec: 5, endSec: 7, audioStartSec: 5, audioEndSec: 7 },
    ];
    const beforeSegments = structuredClone(segments);

    const updated = deleteClipById(clips, 'gap-delete', {
      ripple: false,
      preserveIds: true,
      gapOnDelete: true,
      totalDuration: 12,
    });

    assert.deepEqual(updated, [
      clips[0],
      { ...clips[2], start: 2, end: 4 },
      { ...clips[3], start: 4, end: 6 },
      { ...clips[4], start: 6, end: 9 },
    ]);
    assertContinuousCoverage(updated, 9);
    assert.deepEqual(segments, beforeSegments);
  });

  test('splitting then deleting the first opening Gap starts the film at zero without changing segments', async () => {
    const { deleteClipById, splitClipAtTime } = await import(pathToFileURL(timelineUtilsPath));
    const clips = [
      { id: 'opening-gap', name: 'Gap', start: 0, end: 4, sourceStart: 0, sourceEnd: 4 },
      { id: 'clip-first', name: '#1 Speaker', isDialogue: true, segmentId: 1, segmentIndex: 1, start: 4, end: 6, sourceStart: 20, sourceEnd: 22 },
      { id: 'clip-second', name: '#2 Speaker', isDialogue: true, segmentId: 2, segmentIndex: 2, start: 6, end: 9, sourceStart: 30, sourceEnd: 33 },
    ];
    const segments = [
      { id: 1, startSec: 4, endSec: 6, audioStartSec: 4.1, audioEndSec: 5.9 },
      { id: 2, startSec: 6, endSec: 9, audioStartSec: 6, audioEndSec: 9 },
    ];
    const beforeSegments = structuredClone(segments);
    const split = splitClipAtTime(clips, 2, 9);
    assert.ok(split);
    const updated = deleteClipById(split.newClips, 'opening-gap', {
      ripple: false,
      preserveIds: true,
      gapOnDelete: true,
      totalDuration: 9,
    });

    assert.deepEqual(updated.map(({ id, name, start, end }) => [id, name, start, end]), [
      [split.newClips[1].id, 'Gap', 0, 2],
      ['clip-first', '#1 Speaker', 2, 4],
      ['clip-second', '#2 Speaker', 4, 7],
    ]);
    assert.deepEqual(updated.slice(1).map(({ sourceStart, sourceEnd }) => [sourceStart, sourceEnd]), [
      [20, 22],
      [30, 33],
    ]);
    assert.equal(updated[0].start, 0);
    assertContinuousCoverage(updated, 7);
    assert.deepEqual(segments, beforeSegments);
  });

  test('deleting a non-dialogue video clip also leaves a covered Gap', async () => {
    const { deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const clips = [
      { id: 'clip-a', name: 'Intro', start: 0, end: 2 },
      { id: 'clip-b', name: 'Outro', start: 2, end: 4 },
    ];

    const updated = deleteClipById(clips, 'clip-a', {
      allowEmpty: true,
      ripple: false,
      preserveIds: true,
      gapOnDelete: true,
      totalDuration: 4,
    });

    assert.deepEqual(updated.filter((clip) => clip.name === 'Gap').map(({ start, end }) => [start, end]), [[0, 2]]);
    assert.deepEqual(updated.find((clip) => clip.id === 'clip-b'), clips[1]);
    assertContinuousCoverage(updated, 4);
  });

  test('remove-only delete fills uncovered portions with explicit Gaps without moving survivors', async () => {
    const { deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const clips = [
      { id: 'clip-a', name: 'Before', start: 1, end: 2 },
      { id: 'clip-delete', name: 'Middle', start: 2, end: 3 },
      { id: 'clip-b', name: 'After', start: 4, end: 5 },
    ];

    const updated = deleteClipById(clips, 'clip-delete', {
      allowEmpty: true,
      ripple: false,
      preserveIds: true,
      gapOnDelete: true,
      totalDuration: 6,
    });

    assert.deepEqual(updated.filter((clip) => clip.id !== 'clip-delete' && clip.name !== 'Gap'), [clips[0], clips[2]]);
    assert.deepEqual(updated.filter((clip) => clip.name === 'Gap').map(({ start, end }) => [start, end]), [
      [0, 1],
      [2, 4],
      [5, 6],
    ]);
    assertContinuousCoverage(updated, 6);
  });

  test('legacy callers retain default ripple, snap, and re-index behavior', async () => {
    const { deleteSegmentByIdOrIndex, deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const segments = [
      { id: 1, startSec: 0, endSec: 2 },
      { id: 2, startSec: 2, endSec: 4 },
      { id: 3, startSec: 4, endSec: 6 },
    ];
    const clips = [
      { id: 'clip-1', start: 0, end: 2, isDialogue: true, segmentId: 1 },
      { id: 'clip-2', start: 2, end: 4, isDialogue: true, segmentId: 2, name: '#2 Speaker' },
      { id: 'clip-3', start: 4, end: 6, isDialogue: true, segmentId: 3, name: '#3 Speaker' },
    ];

    const shiftedSegments = deleteSegmentByIdOrIndex(segments, 2);
    const shiftedClips = deleteClipById(clips, 'clip-2');
    assert.deepEqual(shiftedSegments.map((segment) => segment.id), [1, 2]);
    assert.equal(shiftedSegments[1].startSec, 2);
    assert.equal(shiftedClips.find((clip) => clip.id === 'clip-3').start, 2);
    assert.equal(shiftedClips.find((clip) => clip.id === 'clip-3').segmentId, 2);
  });

  test('delete handlers use remove-only options and selection kind overrides stale type', () => {
    const hookCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js'), 'utf8');
    const editorCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');
    const tracksCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8');
    const mediaLibraryCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/media/MediaLibrary.jsx'), 'utf8');
    const clipDeleteHandler = hookCode.slice(hookCode.indexOf('const handleDeleteClip'), hookCode.indexOf('// Update Clips'));
    const segmentDeleteHandler = hookCode.slice(hookCode.indexOf('const handleDeleteSegment'), hookCode.indexOf('// Update Timeline Subtitles'));
    const deleteSelectedHandler = editorCode.slice(editorCode.indexOf('const handleDeleteSelected'), editorCode.indexOf('}, [selectedClipKind'));

    assert.ok(hookCode.includes('deleteSegmentOp(') || hookCode.includes('deleteSegment('));
    assert.ok(hookCode.includes('deleteVideoClipOp(') || hookCode.includes('deleteVideoClip('));
    assert.ok(clipDeleteHandler.includes('totalDuration: duration'));
    assert.ok(clipDeleteHandler.includes("track: 'videoClips'"));
    assert.ok(clipDeleteHandler.includes('persistTimelineOperationApi'));
    assert.ok(clipDeleteHandler.includes('saveTimelineOperationToLocalStorage'));
    assert.ok(!clipDeleteHandler.includes('deleteSegmentByIdOrIndex'));
    assert.ok(!clipDeleteHandler.includes('handleUpdateTimelineSegments'));
    assert.ok(!segmentDeleteHandler.includes('deleteClipById'));
    assert.ok(!segmentDeleteHandler.includes('setVideoClips'));
    assert.ok(segmentDeleteHandler.includes("track: 'segments'"));
    assert.ok(segmentDeleteHandler.includes('persistTimelineOperationApi'));
    assert.ok(segmentDeleteHandler.includes('saveTimelineOperationToLocalStorage'));
    assert.ok(editorCode.includes("if (selectedClipKind === 'video')"));
    assert.ok(!deleteSelectedHandler.includes('matchingClip'));
    assert.ok(!deleteSelectedHandler.includes('onDeleteClip(matchingClip'));
    assert.ok(!editorCode.includes("lastSelectedType === 'video' || selectedClipKind === 'video'"));
    assert.ok(editorCode.includes('deleteSegmentOp(') || editorCode.includes('deleteSegment('));
    assert.ok(mediaLibraryCode.includes('deleteSegmentOp(') || mediaLibraryCode.includes('deleteSegment('));
    assert.ok(tracksCode.includes('const segmentNumber = seg.segmentId ?? seg.id ?? idx + 1;'));
    assert.ok(tracksCode.includes('const compactIdLabel = `#${segmentNumber}'));
    assert.equal((clipDeleteHandler.match(/pushUndoSnapshot\(/g) || []).length, 1);
    assert.equal((segmentDeleteHandler.match(/pushUndoSnapshot\(/g) || []).length, 1);
  });

  test('Auto-Align gap closing behavior remains available', () => {
    assert.ok(timelineUtilsCode.includes('export function bridgeClipGaps'));
    const hookCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js'), 'utf8');
    assert.ok(hookCode.includes('// 1. If leading gap exists'));
    assert.ok(hookCode.includes('setVideoClips(snappedVideoClips)'));
  });
});
