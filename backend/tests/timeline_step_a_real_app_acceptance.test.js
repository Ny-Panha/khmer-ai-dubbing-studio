import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deleteSegment,
  deleteVideoClip,
  deleteGap,
  isGapClip,
} from '../../frontend/src/utils/timelineOps.js';
import {
  persistEpisodeTimelineOperation,
  saveSeriesMetadata,
} from '../services/episodeService.js';

describe('Phase 2 Step A: Real-App Checks on Disposable Episode Copy (Stored series.json)', () => {
  let tempProjectsDir;
  const seriesId = 'test_series_disposable';
  const episodeId = 'ep_disposable_1';

  beforeEach(() => {
    tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-step-a-'));
  });

  afterEach(() => {
    if (tempProjectsDir && fs.existsSync(tempProjectsDir)) {
      fs.rmSync(tempProjectsDir, { recursive: true, force: true });
    }
  });

  function seedDiskEpisode(segments, videoClips, duration = 30) {
    const episode = {
      id: episodeId,
      episodeNumber: 1,
      title: 'Disposable Episode',
      status: 'translated',
      duration,
      scriptData: {
        mode: 'dialogue',
        hasScript: segments.length > 0,
        totalSegments: segments.length,
        updatedAt: Date.now(),
        segments,
      },
      videoClips,
      videoClipsUpdatedAt: Date.now(),
    };
    const series = { id: seriesId, title: 'Disposable Series', episodes: [episode] };
    saveSeriesMetadata(series, { projectsDir: tempProjectsDir });
    return series;
  }

  function readDiskEpisode() {
    const file = path.join(tempProjectsDir, seriesId, 'series.json');
    assert.ok(fs.existsSync(file), 'series.json must exist on disk');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.episodes.find((e) => e.id === episodeId);
  }

  it('Check 1: Delete a voice -> count -1, video clips identical in file; Ctrl+Z restores exactly', async () => {
    const initialSegments = [
      { id: 1, _uid: 'uid-voice-1', startSec: 1.0, endSec: 3.0, khmerText: 'សួស្តី' },
      { id: 2, _uid: 'uid-voice-2', startSec: 4.0, endSec: 6.0, khmerText: 'អរគុណ' },
      { id: 3, _uid: 'uid-voice-3', startSec: 7.0, endSec: 9.0, khmerText: 'លាហើយ' },
    ];
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 10, name: 'Scene 1', isDialogue: true },
      { id: 'clip-2', start: 10, end: 20, name: 'Scene 2', isDialogue: true },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 20);

    // Save snapshot before op (Ctrl+Z history)
    const undoSnapshot = {
      segments: JSON.parse(JSON.stringify(initialSegments)),
      videoClips: JSON.parse(JSON.stringify(initialVideoClips)),
    };

    // Execute deleteSegment pure op
    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = deleteSegment(currentState, { segKey: 'uid-voice-2' });
    assert.equal(opResult.applied, true, 'deleteSegment op must apply');

    // Persist to backend/disk series.json
    await persistEpisodeTimelineOperation({
      projectsDir: tempProjectsDir,
      seriesId,
      episodeId,
      operation: 'delete',
      track: 'segments',
      items: opResult.state.segments,
      deletedItem: initialSegments[1],
      deletedIndex: 1,
    });

    // Verify from stored series.json file on disk
    const diskAfterDelete = readDiskEpisode();
    assert.equal(diskAfterDelete.scriptData.segments.length, 2, 'File segment count must be exactly initial - 1');
    assert.deepEqual(
      diskAfterDelete.scriptData.segments.map((s) => s.id),
      [1, 3],
      'Survivor IDs must be intact without renumbering'
    );
    assert.deepEqual(diskAfterDelete.videoClips, initialVideoClips, 'Video clips in stored file must be 100% identical');

    // Ctrl+Z Undo: Restore snapshot to stored series.json
    await persistEpisodeTimelineOperation({
      projectsDir: tempProjectsDir,
      seriesId,
      episodeId,
      operation: 'restore',
      segments: undoSnapshot.segments,
      videoClips: undoSnapshot.videoClips,
    });

    const diskAfterUndo = readDiskEpisode();
    assert.equal(diskAfterUndo.scriptData.segments.length, 3, 'Undo must restore exact 3 segments');
    assert.deepEqual(diskAfterUndo.scriptData.segments, initialSegments, 'Undo must restore exact prior segment data');
    assert.deepEqual(diskAfterUndo.videoClips, initialVideoClips, 'Undo must preserve exact video clips');
  });

  it('Check 2: Delete a middle video clip -> segments identical in file, one joined Gap; Ctrl+Z restores exactly', async () => {
    const initialSegments = [
      { id: 1, _uid: 'uid-v1', startSec: 2.0, endSec: 5.0, khmerText: 'សួស្តី' },
      { id: 2, _uid: 'uid-v2', startSec: 12.0, endSec: 15.0, khmerText: 'អរគុណ' },
    ];
    const initialVideoClips = [
      { id: 'clip-a', start: 0, end: 10, name: 'Scene A', isDialogue: true },
      { id: 'clip-b', start: 10, end: 20, name: 'Scene B', isDialogue: true },
      { id: 'clip-c', start: 20, end: 30, name: 'Scene C', isDialogue: true },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 30);

    const undoSnapshot = {
      segments: JSON.parse(JSON.stringify(initialSegments)),
      videoClips: JSON.parse(JSON.stringify(initialVideoClips)),
    };

    // Execute deleteVideoClip pure op on middle clip (clip-b)
    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = deleteVideoClip(currentState, { clipId: 'clip-b', totalDuration: 30 });
    assert.equal(opResult.applied, true, 'deleteVideoClip op must apply');

    // Persist to stored series.json
    await persistEpisodeTimelineOperation({
      projectsDir: tempProjectsDir,
      seriesId,
      episodeId,
      operation: 'delete',
      track: 'videoClips',
      items: opResult.state.videoClips,
      deletedItem: initialVideoClips[1],
    });

    // Verify stored series.json
    const diskAfterDelete = readDiskEpisode();
    assert.deepEqual(diskAfterDelete.scriptData.segments, initialSegments, 'Segments in stored file must be 100% identical');

    assert.equal(diskAfterDelete.videoClips.length, 3, 'Must have Clip A, Gap, Clip C');
    assert.equal(diskAfterDelete.videoClips[0].id, 'clip-a');
    assert.equal(diskAfterDelete.videoClips[1].name, 'Gap');
    assert.equal(diskAfterDelete.videoClips[1].isDialogue, false);
    assert.equal(diskAfterDelete.videoClips[1].start, 10);
    assert.equal(diskAfterDelete.videoClips[1].end, 20, 'Middle clip range [10, 20] must become one continuous Gap');
    assert.equal(diskAfterDelete.videoClips[2].id, 'clip-c');

    // Ctrl+Z Undo
    await persistEpisodeTimelineOperation({
      projectsDir: tempProjectsDir,
      seriesId,
      episodeId,
      operation: 'restore',
      segments: undoSnapshot.segments,
      videoClips: undoSnapshot.videoClips,
    });

    const diskAfterUndo = readDiskEpisode();
    assert.deepEqual(diskAfterUndo.videoClips, initialVideoClips, 'Undo must restore exact 3 video clips');
    assert.deepEqual(diskAfterUndo.scriptData.segments, initialSegments, 'Undo must keep segments intact');
  });

  it('Check 3: Delete an opening Gap -> film starts 00:00, segments identical; Ctrl+Z restores exactly', async () => {
    const initialSegments = [
      { id: 1, _uid: 'uid-1', startSec: 10.0, endSec: 13.0, khmerText: 'សួស្តី' },
    ];
    const initialVideoClips = [
      { id: 'clip-gap-lead', start: 0, end: 6.5, name: 'Gap', isDialogue: false },
      { id: 'clip-content-1', start: 6.5, end: 16.5, name: 'Scene 1', isDialogue: true },
      { id: 'clip-content-2', start: 16.5, end: 26.5, name: 'Scene 2', isDialogue: true },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 26.5);

    const undoSnapshot = {
      segments: JSON.parse(JSON.stringify(initialSegments)),
      videoClips: JSON.parse(JSON.stringify(initialVideoClips)),
    };

    // Execute deleteGap pure op on opening Gap
    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    assert.equal(isGapClip(initialVideoClips[0]), true, 'Opening clip must be recognized as Gap');

    const opResult = deleteGap(currentState, { clipId: 'clip-gap-lead' });
    assert.equal(opResult.applied, true, 'deleteGap op must apply');

    // Persist to stored series.json
    await persistEpisodeTimelineOperation({
      projectsDir: tempProjectsDir,
      seriesId,
      episodeId,
      operation: 'delete',
      track: 'videoClips',
      items: opResult.state.videoClips,
      deletedItem: initialVideoClips[0],
    });

    // Verify stored series.json
    const diskAfterDelete = readDiskEpisode();
    assert.deepEqual(diskAfterDelete.scriptData.segments, initialSegments, 'Segments in stored file must be 100% identical');

    assert.equal(diskAfterDelete.videoClips.length, 2, 'Gap removed, 2 clips remain');
    assert.equal(diskAfterDelete.videoClips[0].id, 'clip-content-1');
    assert.equal(diskAfterDelete.videoClips[0].start, 0.0, 'Film must start at 00:00');
    assert.equal(diskAfterDelete.videoClips[0].end, 10.0, 'Clip 1 end must shift left by 6.5s (16.5 -> 10.0)');
    assert.equal(diskAfterDelete.videoClips[1].id, 'clip-content-2');
    assert.equal(diskAfterDelete.videoClips[1].start, 10.0);
    assert.equal(diskAfterDelete.videoClips[1].end, 20.0);

    // Ctrl+Z Undo
    await persistEpisodeTimelineOperation({
      projectsDir: tempProjectsDir,
      seriesId,
      episodeId,
      operation: 'restore',
      segments: undoSnapshot.segments,
      videoClips: undoSnapshot.videoClips,
    });

    const diskAfterUndo = readDiskEpisode();
    assert.deepEqual(diskAfterUndo.videoClips, initialVideoClips, 'Undo must restore opening Gap and exact prior clips');
    assert.deepEqual(diskAfterUndo.scriptData.segments, initialSegments, 'Undo must preserve segments');
  });
});
