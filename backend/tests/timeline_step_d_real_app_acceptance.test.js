import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  trimClip,
  moveClip,
} from '../../frontend/src/utils/timelineOps.js';
import {
  updateSeriesMetadata,
  saveSeriesMetadata,
} from '../services/episodeService.js';

describe('Phase 2 Step D: Real-App Checks on Disposable Episode Copy (Stored series.json)', () => {
  let tempProjectsDir;
  const seriesId = 'test_series_step_d';
  const episodeId = 'ep_step_d_1';

  beforeEach(() => {
    tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-step-d-'));
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
      title: 'Disposable Step D Episode',
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
    const series = { id: seriesId, title: 'Disposable Series D', episodes: [episode] };
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

  it('Check 1: Trim a clip right edge -> only its end changes in file; survivors unchanged', async () => {
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 10, sourceStart: 0, sourceEnd: 10, name: 'Scene 1', isDialogue: true, trackRow: 0 },
      { id: 'clip-2', start: 10, end: 20, sourceStart: 10, sourceEnd: 20, name: 'Scene 2', isDialogue: true, trackRow: 0 },
    ];
    const initialSegments = [
      { id: 1, _uid: 'uid-1', startSec: 2.0, endSec: 5.0, khmerText: 'សួស្តី', trackRow: 0, subTrackRow: 0 },
      { id: 2, _uid: 'uid-2', startSec: 6.0, endSec: 9.0, khmerText: 'ជំរាបសួរ', trackRow: 0, subTrackRow: 0 },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 25);
    const diskBefore = readDiskEpisode();
    assert.equal(diskBefore.videoClips[0].end, 10);

    const state = { videoClips: diskBefore.videoClips, segments: diskBefore.scriptData.segments };
    const result = trimClip(state, { clipId: 'clip-1', edge: 'right', newTime: 8.0, maxSourceDuration: 25 });

    assert.equal(result.applied, true, 'trimClip must apply');
    assert.equal(result.state.videoClips[0].end, 8.0);
    assert.equal(result.state.videoClips[0].sourceEnd, 8.0);
    assert.equal(result.state.videoClips[0].start, 0);

    // Persist to series.json
    persistDiskState(result.state.videoClips, result.state.segments);

    const diskAfter = readDiskEpisode();
    assert.equal(diskAfter.videoClips[0].end, 8.0, 'Disk clip-1 end must be trimmed to 8.0');
    assert.equal(diskAfter.videoClips[0].sourceEnd, 8.0);
    assert.equal(diskAfter.videoClips[0].start, 0, 'clip-1 start must remain unchanged');
    assert.equal(diskAfter.videoClips[1].start, 10, 'clip-2 start must remain unchanged');
    assert.equal(diskAfter.videoClips[1].end, 20, 'clip-2 end must remain unchanged');
    assert.deepEqual(diskAfter.scriptData.segments, initialSegments, 'Segments must remain untouched');
  });

  it('Check 2: Drag a voice to a new slot -> only it moves, subtitle follows', async () => {
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 20, sourceStart: 0, sourceEnd: 20, name: 'Scene 1', isDialogue: true, trackRow: 0 },
    ];
    const initialSegments = [
      {
        id: 1,
        _uid: 'uid-voice-1',
        startSec: 2.0,
        endSec: 4.5,
        duration: 2.5,
        audioStartSec: 2.0,
        audioEndSec: 4.5,
        audioDurationSec: 2.5,
        khmerText: 'សួស្តីពិភពលោក',
        trackRow: 0,
        subTrackRow: 0,
      },
      {
        id: 2,
        _uid: 'uid-voice-2',
        startSec: 6.0,
        endSec: 9.0,
        duration: 3.0,
        audioStartSec: 6.0,
        audioEndSec: 9.0,
        audioDurationSec: 3.0,
        khmerText: 'ជួបគ្នាថ្ងៃស្អែក',
        trackRow: 0,
        subTrackRow: 1,
      },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 25);
    const diskBefore = readDiskEpisode();

    const state = { videoClips: diskBefore.videoClips, segments: diskBefore.scriptData.segments };
    // Move voice 1 from 2.0 to 11.5 and switch subTrackRow to 2
    const result = moveClip(state, {
      clipId: 'uid-voice-1',
      newStart: 11.5,
      trackRow: 1,
      subTrackRow: 2,
    });

    assert.equal(result.applied, true, 'moveClip on segment must apply');
    assert.equal(result.state.segments[0].startSec, 11.5);
    assert.equal(result.state.segments[0].endSec, 14.0); // 11.5 + 2.5 dur
    assert.equal(result.state.segments[0].audioStartSec, 11.5);
    assert.equal(result.state.segments[0].audioEndSec, 14.0);
    assert.equal(result.state.segments[0].trackRow, 1);
    assert.equal(result.state.segments[0].subTrackRow, 2);
    assert.equal(result.state.segments[0].khmerText, 'សួស្តីពិភពលោក', 'Subtitle text follows segment');

    // Persist to series.json
    persistDiskState(result.state.videoClips, result.state.segments);

    const diskAfter = readDiskEpisode();
    const seg1 = diskAfter.scriptData.segments[0];
    const seg2 = diskAfter.scriptData.segments[1];

    assert.equal(seg1.startSec, 11.5);
    assert.equal(seg1.endSec, 14.0);
    assert.equal(seg1.trackRow, 1);
    assert.equal(seg1.subTrackRow, 2);
    assert.equal(seg1.khmerText, 'សួស្តីពិភពលោក');

    // Survivor segment 2 must be completely unchanged
    assert.equal(seg2.startSec, 6.0);
    assert.equal(seg2.endSec, 9.0);
    assert.equal(seg2.trackRow, 0);
    assert.equal(seg2.subTrackRow, 1);

    // videoClips must be completely untouched
    assert.deepEqual(diskAfter.videoClips, initialVideoClips);
  });

  it('Check 3: Attempt an overlapping video move -> rejected with a visible reason, file unchanged', async () => {
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 6, sourceStart: 0, sourceEnd: 6, name: 'Scene 1', isDialogue: true, trackRow: 0 },
      { id: 'clip-2', start: 10, end: 16, sourceStart: 10, sourceEnd: 16, name: 'Scene 2', isDialogue: true, trackRow: 0 },
    ];
    const initialSegments = [
      { id: 1, _uid: 'uid-1', startSec: 1.0, endSec: 3.0, khmerText: 'សួស្តី' },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 25);
    const diskBefore = readDiskEpisode();

    const state = { videoClips: diskBefore.videoClips, segments: diskBefore.scriptData.segments };
    // Attempt to move clip-2 (dur 6) to start at 3.0 -> would span [3, 9], overlapping clip-1 [0, 6]
    const result = moveClip(state, {
      clipId: 'clip-2',
      newStart: 3.0,
      trackRow: 0,
    });

    assert.equal(result.applied, false, 'Overlapping video move must be rejected');
    assert.ok(result.reason, 'Must provide an explanatory reason for the UI toast');
    assert.match(result.reason, /overlap/i, 'Reason must state overlap');

    // Ensure disk series.json was NOT mutated
    const diskAfter = readDiskEpisode();
    assert.deepEqual(diskAfter.videoClips, initialVideoClips, 'Disk videoClips must remain completely unchanged');
    assert.deepEqual(diskAfter.scriptData.segments, initialSegments, 'Disk segments must remain completely unchanged');
  });

  it('Check 4: Ctrl+Z restores exact prior state across trim and move operations', async () => {
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 10, sourceStart: 0, sourceEnd: 10, name: 'Scene 1', isDialogue: true, trackRow: 0 },
      { id: 'clip-2', start: 12, end: 20, sourceStart: 12, sourceEnd: 20, name: 'Scene 2', isDialogue: true, trackRow: 0 },
    ];
    const initialSegments = [
      { id: 1, _uid: 'uid-seg-1', startSec: 1.0, endSec: 4.0, duration: 3.0, khmerText: 'ឃ្លាទីមួយ', trackRow: 0, subTrackRow: 0 },
      { id: 2, _uid: 'uid-seg-2', startSec: 5.0, endSec: 8.0, duration: 3.0, khmerText: 'ឃ្លាទីពីរ', trackRow: 0, subTrackRow: 0 },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 25);

    // Undo stack simulating user history
    const undoStack = [];
    const pushUndo = (clips, segs) => {
      undoStack.push({
        clips: JSON.parse(JSON.stringify(clips)),
        segments: JSON.parse(JSON.stringify(segs)),
      });
    };

    // Step 1: User trims clip-1 right edge from 10 to 7
    let currentClips = readDiskEpisode().videoClips;
    let currentSegments = readDiskEpisode().scriptData.segments;
    pushUndo(currentClips, currentSegments); // snapshot 0

    const trimRes = trimClip({ videoClips: currentClips, segments: currentSegments }, {
      clipId: 'clip-1',
      edge: 'right',
      newTime: 7.0,
      maxSourceDuration: 25,
    });
    assert.equal(trimRes.applied, true);
    currentClips = trimRes.state.videoClips;
    currentSegments = trimRes.state.segments;
    persistDiskState(currentClips, currentSegments);

    const diskStep1 = readDiskEpisode();
    assert.equal(diskStep1.videoClips[0].end, 7.0);

    // Step 2: User moves seg-1 from 1.0 to 14.0
    pushUndo(currentClips, currentSegments); // snapshot 1

    const moveRes = moveClip({ videoClips: currentClips, segments: currentSegments }, {
      clipId: 'uid-seg-1',
      newStart: 14.0,
      trackRow: 0,
      subTrackRow: 0,
    });
    assert.equal(moveRes.applied, true);
    currentClips = moveRes.state.videoClips;
    currentSegments = moveRes.state.segments;
    persistDiskState(currentClips, currentSegments);

    const diskStep2 = readDiskEpisode();
    assert.equal(diskStep2.scriptData.segments[0].startSec, 14.0);

    // Undo 1: Revert move operation (restore snapshot 1)
    const snapshot1 = undoStack.pop();
    persistDiskState(snapshot1.clips, snapshot1.segments);

    const diskAfterUndo1 = readDiskEpisode();
    assert.equal(diskAfterUndo1.scriptData.segments[0].startSec, 1.0, 'Segment 1 must be restored to 1.0');
    assert.equal(diskAfterUndo1.videoClips[0].end, 7.0, 'Trim on clip-1 must still be active after reverting move');

    // Undo 2: Revert trim operation (restore snapshot 0)
    const snapshot0 = undoStack.pop();
    persistDiskState(snapshot0.clips, snapshot0.segments);

    const diskAfterUndo2 = readDiskEpisode();
    assert.deepEqual(diskAfterUndo2.videoClips, initialVideoClips, 'Video clips must be restored to initial state');
    assert.deepEqual(diskAfterUndo2.scriptData.segments, initialSegments, 'Segments must be restored to initial state');
  });

  it('Check 5: Trim segment left and right edges -> updates audioTrimmed, startSec/endSec, keeping survivors untouched', async () => {
    const initialSegments = [
      { id: 1, _uid: 'uid-seg-a', startSec: 2.0, endSec: 6.0, duration: 4.0, khmerText: 'ឃ្លា A' },
      { id: 2, _uid: 'uid-seg-b', startSec: 8.0, endSec: 12.0, duration: 4.0, khmerText: 'ឃ្លា B' },
    ];
    seedDiskEpisode(initialSegments, [], 20);

    // Trim left edge of seg A from 2.0 to 3.0
    const state = { videoClips: [], segments: initialSegments };
    const leftRes = trimClip(state, { clipId: 'uid-seg-a', edge: 'left', newTime: 3.0 });
    assert.equal(leftRes.applied, true);
    assert.equal(leftRes.state.segments[0].startSec, 3.0);
    assert.equal(leftRes.state.segments[0].endSec, 6.0);
    assert.equal(leftRes.state.segments[0].duration, 3.0);
    assert.equal(leftRes.state.segments[0].audioTrimmed, true);

    // Trim right edge of seg A from 6.0 to 5.0
    const rightRes = trimClip(leftRes.state, { clipId: 'uid-seg-a', edge: 'right', newTime: 5.0 });
    assert.equal(rightRes.applied, true);
    assert.equal(rightRes.state.segments[0].startSec, 3.0);
    assert.equal(rightRes.state.segments[0].endSec, 5.0);
    assert.equal(rightRes.state.segments[0].duration, 2.0);

    // Survivor seg B untouched
    assert.equal(rightRes.state.segments[1].startSec, 8.0);
    assert.equal(rightRes.state.segments[1].endSec, 12.0);

    persistDiskState([], rightRes.state.segments);
    const disk = readDiskEpisode();
    assert.equal(disk.scriptData.segments[0].startSec, 3.0);
    assert.equal(disk.scriptData.segments[0].endSec, 5.0);
    assert.equal(disk.scriptData.segments[1].startSec, 8.0);
  });
});
