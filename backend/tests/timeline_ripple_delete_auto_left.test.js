const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

describe('Remove-only timeline delete', () => {
  const timelineUtilsPath = path.resolve(__dirname, '../../frontend/src/utils/timelineUtils.js');
  const timelineUtilsCode = fs.readFileSync(timelineUtilsPath, 'utf8');

  test('middle segment delete preserves survivor IDs and exact timing values', async () => {
    const { deleteSegmentByIdOrIndex, deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
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
    }));

    const updated = deleteSegmentByIdOrIndex(segments, segments[2]._uid, { ripple: false, preserveIds: true });
    const clips = segments.map((segment) => ({
      id: `clip-${segment.id}`,
      name: `#${segment.id} Speaker`,
      isDialogue: true,
      segmentId: segment.segmentId,
      segmentIndex: segment.id,
      start: segment.startSec,
      end: segment.endSec,
    }));
    const updatedClips = deleteClipById(clips, 'clip-3', {
      allowEmpty: true,
      ripple: false,
      preserveIds: true,
      gapOnDelete: true,
    });

    assert.deepEqual(updated.map((segment) => segment.id), [1, 2, 4, 5]);
    assert.deepEqual(updated.map((segment) => segment.segmentId), [1, 2, 4, 5]);
    assert.deepEqual(updated, segments.filter((segment) => segment.id !== 3));
    assert.deepEqual(updatedClips.filter((clip) => clip.isDialogue), clips.filter((clip) => clip.id !== 'clip-3'));
  });

  test('script hydration preserves non-sequential segment numbers', async () => {
    const { sanitizeScriptData } = await import(pathToFileURL(timelineUtilsPath));
    const segments = [1, 2, 4, 5].map((id) => ({ id, segmentId: id, chineseText: `line ${id}` }));

    const sanitized = sanitizeScriptData({ segments });

    assert.deepEqual(sanitized.segments.map((segment) => segment.id), [1, 2, 4, 5]);
    assert.deepEqual(sanitized.segments.map((segment) => segment.segmentId), [1, 2, 4, 5]);
  });

  test('middle video delete leaves survivor clips unchanged and inserts one exact Gap', async () => {
    const { deleteClipById, deleteSegmentByIdOrIndex } = await import(pathToFileURL(timelineUtilsPath));
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
    });
    const updatedSegments = deleteSegmentByIdOrIndex(segments, clips[2].segmentId, { ripple: false, preserveIds: true });

    assert.deepEqual(
      updated.filter((clip) => clip.isDialogue),
      clips.filter((clip) => clip.id !== 'clip-3')
    );
    const gaps = updated.filter((clip) => clip.name === 'Gap');
    assert.equal(gaps.length, 1);
    assert.deepEqual([gaps[0].start, gaps[0].end], [4, 6]);
    assert.deepEqual(updatedSegments.map((segment) => segment.id), [1, 2, 4, 5]);
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
      });
      assert.deepEqual(
        updatedClips.filter((clip) => clip.isDialogue),
        clips.filter((clip) => clip.id !== `clip-${id}`)
      );
      const gap = updatedClips.find((clip) => clip.name === 'Gap');
      assert.deepEqual([gap.start, gap.end], [(id - 1) * 2, id * 2]);
    }
  });

  test('deleted dialogue clip merges touching Gap neighbours into one span', async () => {
    const { deleteClipById } = await import(pathToFileURL(timelineUtilsPath));
    const clips = [
      { id: 'gap-left', name: 'Gap', start: 0, end: 2 },
      { id: 'clip-3', name: '#3 Speaker', isDialogue: true, segmentId: 3, start: 2, end: 4 },
      { id: 'gap-right', name: 'Gap', start: 4, end: 7 },
      { id: 'clip-4', name: '#4 Speaker', isDialogue: true, segmentId: 4, start: 7, end: 9 },
    ];

    const updated = deleteClipById(clips, 'clip-3', {
      allowEmpty: true,
      ripple: false,
      preserveIds: true,
      gapOnDelete: true,
    });

    assert.deepEqual(updated.filter((clip) => clip.name === 'Gap').map(({ start, end }) => [start, end]), [[0, 7]]);
    assert.deepEqual(updated.find((clip) => clip.id === 'clip-4'), clips[3]);
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
    const clipDeleteHandler = hookCode.slice(hookCode.indexOf('const handleDeleteClip'), hookCode.indexOf('// Update Clips'));
    const segmentDeleteHandler = hookCode.slice(hookCode.indexOf('const handleDeleteSegment'), hookCode.indexOf('// Update Timeline Subtitles'));

    assert.ok(hookCode.includes('deleteSegmentByIdOrIndex(segments, segmentKey, { ripple: false, preserveIds: true })'));
    assert.ok(hookCode.includes('deleteSegmentByIdOrIndex(scriptData.segments, segmentKey, { ripple: false, preserveIds: true })'));
    assert.ok(hookCode.includes('gapOnDelete: true'));
    assert.ok(editorCode.includes("selectedClipKind === 'video' && canDeleteVideo"));
    assert.ok(!editorCode.includes("lastSelectedType === 'video' || selectedClipKind === 'video'"));
    assert.ok(editorCode.includes('{ ripple: false, preserveIds: true }'));
    assert.ok(tracksCode.includes('const segmentNumber = seg.segmentId ?? seg.id ?? idx + 1;'));
    assert.ok(tracksCode.includes('const compactIdLabel = `#${segmentNumber}'));
    assert.equal((clipDeleteHandler.match(/pushUndoSnapshot\(/g) || []).length, 1);
    assert.equal((segmentDeleteHandler.match(/pushUndoSnapshot\(/g) || []).length, 1);
  });

  test('Auto-Align gap closing behavior remains available', () => {
    assert.ok(timelineUtilsCode.includes('export function bridgeClipGaps'));
    const hookCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js'), 'utf8');
    assert.ok(hookCode.includes('// 1. If leading gap exists'));
    assert.ok(hookCode.includes('setVideoClips(snappedClips)'));
  });
});
