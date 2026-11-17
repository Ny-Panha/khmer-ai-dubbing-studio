import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  splitClip,
  splitSegment,
  isGapClip,
} from '../../frontend/src/utils/timelineOps.js';
import {
  persistEpisodeTimelineOperation,
  updateSeriesMetadata,
  saveSeriesMetadata,
} from '../services/episodeService.js';

describe('Phase 2 Step B: Real-App Checks on Disposable Episode Copy (Stored series.json)', () => {
  let tempProjectsDir;
  const seriesId = 'test_series_step_b';
  const episodeId = 'ep_step_b_1';

  beforeEach(() => {
    tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-step-b-'));
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
      title: 'Disposable Step B Episode',
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
    const series = { id: seriesId, title: 'Disposable Series B', episodes: [episode] };
    saveSeriesMetadata(series, { projectsDir: tempProjectsDir });
    return series;
  }

  function readDiskEpisode() {
    const file = path.join(tempProjectsDir, seriesId, 'series.json');
    assert.ok(fs.existsSync(file), 'series.json must exist on disk');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.episodes.find((e) => e.id === episodeId);
  }

  function persistDiskState(newClips, newSegments) {
    updateSeriesMetadata(seriesId, (series) => {
      const ep = (series.episodes || []).find((e) => e.id === episodeId);
      if (ep) {
        if (newClips !== undefined) {
          ep.videoClips = newClips;
          ep.videoClipsUpdatedAt = Date.now();
        }
        if (newSegments !== undefined) {
          if (!ep.scriptData) ep.scriptData = {};
          ep.scriptData.segments = newSegments;
          ep.scriptData.updatedAt = Date.now();
        }
      }
    }, { projectsDir: tempProjectsDir });
  }

  it('Check 1: Split an unselected dialogue clip at the playhead -> two clips, segments identical in file; Ctrl+Z restores exactly', async () => {
    const initialSegments = [
      { id: 1, _uid: 'uid-s1', startSec: 1.0, endSec: 4.0, khmerText: 'សួស្តី' },
      { id: 2, _uid: 'uid-s2', startSec: 6.0, endSec: 9.0, khmerText: 'អរគុណ' },
    ];
    const initialVideoClips = [
      {
        id: 'clip-dialogue-1',
        name: 'Scene 1',
        start: 0,
        end: 20,
        sourceStart: 0,
        sourceEnd: 20,
        isDialogue: true,
        trackRow: 0,
        trackId: 'video-1',
      },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 20);

    const undoSnapshot = {
      segments: JSON.parse(JSON.stringify(initialSegments)),
      videoClips: JSON.parse(JSON.stringify(initialVideoClips)),
    };

    // Split at 8.0s with no active clip selection
    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = splitClip(currentState, {
      splitTime: 8.0,
      activeClipId: null,
      totalDuration: 20,
    });

    assert.equal(opResult.applied, true, 'splitClip op must apply');
    assert.equal(opResult.state.videoClips.length, 2, 'Must produce 2 video clips');
    assert.equal(opResult.activeClipId, opResult.state.videoClips[0].id, 'Must select the first resulting part');

    // Persist to disk series.json
    persistDiskState(opResult.state.videoClips, undefined);

    // Verify stored series.json file on disk
    const diskAfterSplit = readDiskEpisode();
    assert.equal(diskAfterSplit.videoClips.length, 2, 'Stored videoClips count must be 2');
    assert.equal(diskAfterSplit.videoClips[0].start, 0);
    assert.equal(diskAfterSplit.videoClips[0].end, 8.0);
    assert.equal(diskAfterSplit.videoClips[1].start, 8.0);
    assert.equal(diskAfterSplit.videoClips[1].end, 20);
    assert.deepEqual(diskAfterSplit.scriptData.segments, initialSegments, 'Segments must remain 100% identical in file');

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
    assert.equal(diskAfterUndo.videoClips.length, 1, 'Undo must restore exact 1 video clip');
    assert.deepEqual(diskAfterUndo.videoClips, initialVideoClips, 'Undo must restore exact prior videoClips');
    assert.deepEqual(diskAfterUndo.scriptData.segments, initialSegments, 'Undo must preserve exact segments');
  });

  it('Check 2: Split a Gap -> two Gaps, segments identical in file; Ctrl+Z restores exactly', async () => {
    const initialSegments = [
      { id: 1, _uid: 'uid-s1', startSec: 12.0, endSec: 15.0, khmerText: 'សួស្តី' },
    ];
    const initialVideoClips = [
      {
        id: 'clip-gap-1',
        name: 'Gap',
        start: 0,
        end: 10,
        sourceStart: 0,
        sourceEnd: 10,
        isDialogue: false,
        trackRow: 0,
        trackId: 'video-1',
      },
      {
        id: 'clip-dialogue-2',
        name: 'Scene 2',
        start: 10,
        end: 20,
        sourceStart: 10,
        sourceEnd: 20,
        isDialogue: true,
        trackRow: 0,
        trackId: 'video-1',
      },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 20);

    const undoSnapshot = {
      segments: JSON.parse(JSON.stringify(initialSegments)),
      videoClips: JSON.parse(JSON.stringify(initialVideoClips)),
    };

    // Split Gap at 4.0s
    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = splitClip(currentState, {
      splitTime: 4.0,
      activeClipId: null,
      totalDuration: 20,
    });

    assert.equal(opResult.applied, true, 'splitClip on Gap must apply');
    assert.equal(opResult.state.videoClips.length, 3, 'Must have 3 clips (2 gaps + 1 dialogue)');

    const [gapPart1, gapPart2, scene2] = opResult.state.videoClips;
    assert.equal(isGapClip(gapPart1), true, 'Part 1 must be Gap');
    assert.equal(isGapClip(gapPart2), true, 'Part 2 must be Gap');
    assert.equal(gapPart1.start, 0);
    assert.equal(gapPart1.end, 4.0);
    assert.equal(gapPart2.start, 4.0);
    assert.equal(gapPart2.end, 10.0);
    assert.equal(opResult.activeClipId, gapPart1.id, 'Must select the first resulting Gap part');

    // Persist to disk series.json
    persistDiskState(opResult.state.videoClips, undefined);

    const diskAfterSplit = readDiskEpisode();
    assert.equal(diskAfterSplit.videoClips.length, 3, 'Stored videoClips count must be 3');
    assert.equal(diskAfterSplit.videoClips[0].name, 'Gap');
    assert.equal(diskAfterSplit.videoClips[1].name, 'Gap');
    assert.deepEqual(diskAfterSplit.scriptData.segments, initialSegments, 'Segments must remain 100% identical in file');

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
    assert.equal(diskAfterUndo.videoClips.length, 2, 'Undo must restore exact 2 video clips');
    assert.deepEqual(diskAfterUndo.videoClips, initialVideoClips);
    assert.deepEqual(diskAfterUndo.scriptData.segments, initialSegments);
  });

  it('Check 3: Split on a fresh episode with no script -> two materialized clips in file; Ctrl+Z restores exactly', async () => {
    const initialSegments = [];
    const initialVideoClips = []; // Fresh episode: videoClips empty
    const episodeDur = 60;

    seedDiskEpisode(initialSegments, initialVideoClips, episodeDur);

    const undoSnapshot = {
      segments: JSON.parse(JSON.stringify(initialSegments)),
      videoClips: JSON.parse(JSON.stringify(initialVideoClips)),
    };

    // Split at 15.0s on fresh episode
    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = splitClip(currentState, {
      splitTime: 15.0,
      activeClipId: null,
      totalDuration: episodeDur,
      clipDefaults: { name: 'Full Video' },
    });

    assert.equal(opResult.applied, true, 'splitClip on virtual fresh video must apply');
    assert.equal(opResult.state.videoClips.length, 2, 'Must materialize into 2 clips');

    const [part1, part2] = opResult.state.videoClips;
    assert.equal(part1.start, 0);
    assert.equal(part1.end, 15.0);
    assert.equal(part2.start, 15.0);
    assert.equal(part2.end, 60.0);
    assert.equal(opResult.activeClipId, part1.id, 'Must select the first resulting part');

    // Persist to disk series.json
    persistDiskState(opResult.state.videoClips, undefined);

    const diskAfterSplit = readDiskEpisode();
    assert.equal(diskAfterSplit.videoClips.length, 2, 'Stored videoClips count must be 2 materialized clips');
    assert.equal(diskAfterSplit.videoClips[0].end, 15.0);
    assert.equal(diskAfterSplit.videoClips[1].start, 15.0);
    assert.deepEqual(diskAfterSplit.scriptData.segments, [], 'Segments remain empty');

    // Ctrl+Z Undo: Restore empty videoClips
    await persistEpisodeTimelineOperation({
      projectsDir: tempProjectsDir,
      seriesId,
      episodeId,
      operation: 'restore',
      segments: undoSnapshot.segments,
      videoClips: undoSnapshot.videoClips,
    });

    const diskAfterUndo = readDiskEpisode();
    assert.deepEqual(diskAfterUndo.videoClips, [], 'Undo must restore exact empty videoClips');
    assert.deepEqual(diskAfterUndo.scriptData.segments, []);
  });

  it('Check 4: Split a selected segment (text halves split) -> videoClips identical in file; Ctrl+Z restores exactly', async () => {
    const initialSegments = [
      {
        id: 1,
        _uid: 'uid-dialogue-1',
        startSec: 2.0,
        endSec: 10.0,
        audioStartSec: 2.0,
        audioEndSec: 10.0,
        khmerText: 'សួស្តីបងប្អូនទាំងអស់គ្នា នេះជាការសាកល្បង',
        chineseText: '大家好 这是测试',
        english: 'Hello everyone this is a test',
        speaker: 'Narrator',
      },
    ];
    const initialVideoClips = [
      { id: 'clip-uncut', start: 0, end: 30, name: 'Video 1', isDialogue: true },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 30);

    const undoSnapshot = {
      segments: JSON.parse(JSON.stringify(initialSegments)),
      videoClips: JSON.parse(JSON.stringify(initialVideoClips)),
    };

    // Split segment at 6.0s (playhead inside [2.0, 10.0])
    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = splitSegment(currentState, {
      segKey: 'uid-dialogue-1',
      splitTime: 6.0,
    });

    assert.equal(opResult.applied, true, 'splitSegment op must apply');
    assert.equal(opResult.state.segments.length, 2, 'Must split segment into 2 parts');
    assert.deepEqual(opResult.state.videoClips, initialVideoClips, 'Video clips must remain untouched');

    const [segPart1, segPart2] = opResult.state.segments;
    assert.equal(segPart1.startSec, 2.0);
    assert.equal(segPart1.endSec, 6.0);
    assert.equal(segPart2.startSec, 6.0);
    assert.equal(segPart2.endSec, 10.0);

    // Verify text halves split
    assert.ok(segPart1.khmerText.length > 0, 'Part 1 must have Khmer text');
    assert.ok(segPart2.khmerText.length > 0, 'Part 2 must have Khmer text');
    assert.ok(segPart1.chineseText.length > 0, 'Part 1 must have Chinese text');
    assert.ok(segPart2.chineseText.length > 0, 'Part 2 must have Chinese text');

    // Persist to disk series.json
    persistDiskState(undefined, opResult.state.segments);

    const diskAfterSplit = readDiskEpisode();
    assert.equal(diskAfterSplit.scriptData.segments.length, 2, 'Stored segments count must be 2');
    assert.equal(diskAfterSplit.scriptData.segments[0].endSec, 6.0);
    assert.equal(diskAfterSplit.scriptData.segments[1].startSec, 6.0);
    assert.deepEqual(diskAfterSplit.videoClips, initialVideoClips, 'Video clips in stored file must be 100% identical');

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
    assert.equal(diskAfterUndo.scriptData.segments.length, 1, 'Undo must restore exact 1 segment');
    assert.deepEqual(diskAfterUndo.scriptData.segments, initialSegments, 'Undo must restore exact prior segment data');
    assert.deepEqual(diskAfterUndo.videoClips, initialVideoClips, 'Undo must preserve exact video clips');
  });
});
