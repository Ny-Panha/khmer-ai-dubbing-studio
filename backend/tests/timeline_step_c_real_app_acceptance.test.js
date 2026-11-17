import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  autoAlign,
  resetTiming,
} from '../../frontend/src/utils/timelineOps.js';
import {
  persistEpisodeTimelineOperation,
  updateSeriesMetadata,
  saveSeriesMetadata,
} from '../services/episodeService.js';

describe('Phase 2 Step C: Real-App Checks on Disposable Episode Copy (Stored series.json)', () => {
  let tempProjectsDir;
  const seriesId = 'test_series_step_c';
  const episodeId = 'ep_step_c_1';

  beforeEach(() => {
    tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-step-c-'));
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
      title: 'Disposable Step C Episode',
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
    const series = { id: seriesId, title: 'Disposable Series C', episodes: [episode] };
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

  it('Check 1: Add a voice next to a same-text line -> Auto-Align -> added voice stays, count unchanged', async () => {
    // Initial segments: Two adjacent lines with identical text; second is user-added with audio
    const initialSegments = [
      {
        id: 1,
        _uid: 'uid-line-1',
        startSec: 2.0,
        endSec: 5.0,
        sourceStartSec: 2.0,
        sourceEndSec: 5.0,
        khmerText: 'សួស្តីបងប្អូនទាំងអស់គ្នា',
        chineseText: '大家好',
        audioFile: 'audio_1.mp3',
        audioDurationSec: 2.8,
        speaker: 'Narrator',
      },
      {
        id: 2,
        _uid: 'uid-line-2',
        userAdded: true,
        startSec: 5.2,
        endSec: 8.0,
        sourceStartSec: 5.2,
        sourceEndSec: 8.0,
        khmerText: 'សួស្តីបងប្អូនទាំងអស់គ្នា',
        chineseText: '大家好',
        audioFile: 'audio_2.mp3',
        audioDurationSec: 2.5,
        speaker: 'Narrator',
      },
    ];
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 20, name: 'Scene 1', isDialogue: true },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 20);

    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = autoAlign(currentState, { totalDuration: 20 });

    assert.equal(opResult.applied, true, 'autoAlign must apply');
    assert.equal(opResult.state.segments.length, 2, 'Segment count in == count out (move-only)');

    // Persist to stored series.json
    persistDiskState(undefined, opResult.state.segments);

    const diskAfterAlign = readDiskEpisode();
    assert.equal(diskAfterAlign.scriptData.segments.length, 2, 'File segment count must stay 2');
    assert.equal(diskAfterAlign.scriptData.segments[1]._uid, 'uid-line-2', 'User added voice must remain intact');
    assert.equal(diskAfterAlign.scriptData.segments[1].audioFile, 'audio_2.mp3', 'Added voice audio must be preserved');
    assert.deepEqual(diskAfterAlign.videoClips, initialVideoClips, 'Video clips must remain 100% untouched');
  });

  it('Check 2: Episode with subtitles -> Auto-Align -> segment count AND subtitle count unchanged, no subtitle sits at 00:00 unless its segment starts there', async () => {
    // Episode starting at 4.5s (gap from 0 to 4.5s)
    const initialSegments = [
      {
        id: 1,
        _uid: 'uid-sub-1',
        startSec: 4.5,
        endSec: 7.0,
        sourceStartSec: 4.5,
        sourceEndSec: 7.0,
        khmerText: 'ឈុតទី១',
        chineseText: '第一场',
        subTrackRow: 0,
        audioDurationSec: 2.2,
      },
      {
        id: 2,
        _uid: 'uid-sub-2',
        startSec: 8.0,
        endSec: 11.0,
        sourceStartSec: 8.0,
        sourceEndSec: 11.0,
        khmerText: 'ឈុតទី២',
        chineseText: '第二场',
        subTrackRow: 0,
        audioDurationSec: 2.5,
      },
    ];
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 30, name: 'Video 1', isDialogue: true },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 30);

    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = autoAlign(currentState, { totalDuration: 30 });

    assert.equal(opResult.applied, true, 'autoAlign must apply');
    assert.equal(opResult.state.segments.length, 2, 'Segment and subtitle count must stay 2');

    // Persist to stored series.json
    persistDiskState(undefined, opResult.state.segments);

    const diskAfterAlign = readDiskEpisode();
    const [seg1, seg2] = diskAfterAlign.scriptData.segments;

    // Subtitles belong to segments:
    assert.equal(seg1.khmerText, 'ឈុតទី១');
    assert.equal(seg2.khmerText, 'ឈុតទី២');

    // NO subtitle sits at 00:00 unless its segment started at 00:00!
    assert.ok(seg1.startSec >= 4.0, `Segment 1 subtitle must not snap to 00:00 (actual: ${seg1.startSec})`);
    assert.ok(seg2.startSec >= 7.0, `Segment 2 subtitle must not snap to 00:00 (actual: ${seg2.startSec})`);
  });

  it('Check 3: Auto-Align twice in a row -> second run changes nothing (idempotent)', async () => {
    const initialSegments = [
      {
        id: 1,
        _uid: 'uid-idem-1',
        startSec: 1.0,
        endSec: 4.0,
        sourceStartSec: 1.0,
        sourceEndSec: 4.0,
        audioDurationSec: 3.5, // Overruns into Seg 2
        khmerText: 'ឃ្លាទីមួយ',
      },
      {
        id: 2,
        _uid: 'uid-idem-2',
        startSec: 3.0,
        endSec: 6.0,
        sourceStartSec: 3.0,
        sourceEndSec: 6.0,
        audioDurationSec: 2.0,
        khmerText: 'ឃ្លាទីពីរ',
      },
      {
        id: 3,
        _uid: 'uid-idem-3',
        startSec: 7.0,
        endSec: 10.0,
        sourceStartSec: 7.0,
        sourceEndSec: 10.0,
        audioDurationSec: 2.5,
        khmerText: 'ឃ្លាទីបី',
      },
    ];
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 20, name: 'Video 1', isDialogue: true },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 20);

    // Run 1: Auto-Align
    const state1 = { videoClips: initialVideoClips, segments: initialSegments };
    const res1 = autoAlign(state1, { totalDuration: 20 });
    assert.equal(res1.applied, true);

    persistDiskState(undefined, res1.state.segments);
    const disk1 = readDiskEpisode();

    // Run 2: Auto-Align again on disk result
    const state2 = { videoClips: disk1.videoClips, segments: disk1.scriptData.segments };
    const res2 = autoAlign(state2, { totalDuration: 20 });
    assert.equal(res2.applied, true);

    // Assert second run produces identical state (idempotent)
    assert.deepEqual(
      res2.state.segments,
      disk1.scriptData.segments,
      'Second Auto-Align run must produce identical segments (strictly idempotent)'
    );
  });

  it('Check 4: Reset Timing -> segments return to source-anchored times, count unchanged', async () => {
    // Aligned segments where audio was clamped/trimmed away from source timing
    const alignedSegments = [
      {
        id: 1,
        _uid: 'uid-r1',
        startSec: 2.0,
        endSec: 4.5,
        sourceStartSec: 2.0,
        sourceEndSec: 5.0,
        audioStartSec: 2.0,
        audioEndSec: 4.5,
        audioDurationSec: 2.5,
        audioTrimmed: true,
        audioOverrun: true,
        overrunRatio: 0.45,
        khmerText: 'ឃ្លាទីមួយ',
        audioFile: 'a1.mp3',
      },
      {
        id: 2,
        _uid: 'uid-r2',
        startSec: 4.5,
        endSec: 8.0,
        sourceStartSec: 5.0, // Source was at 5.0, but clamped alignment moved it to 4.5
        sourceEndSec: 8.0,
        audioStartSec: 4.5,
        audioEndSec: 7.5,
        audioDurationSec: 3.0,
        audioTrimmed: false,
        khmerText: 'ឃ្លាទីពីរ',
        audioFile: 'a2.mp3',
      },
    ];
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 20, name: 'Video 1', isDialogue: true },
    ];

    seedDiskEpisode(alignedSegments, initialVideoClips, 20);

    const currentState = { videoClips: initialVideoClips, segments: alignedSegments };
    const opResult = resetTiming(currentState, { totalDuration: 20 });

    assert.equal(opResult.applied, true, 'resetTiming must apply');
    assert.equal(opResult.state.segments.length, 2, 'Count must remain 2');

    // Persist to stored series.json
    persistDiskState(undefined, opResult.state.segments);

    const diskAfterReset = readDiskEpisode();
    const [seg1, seg2] = diskAfterReset.scriptData.segments;

    // Segment 2 must return to its source-anchored startSec (5.0s, not 4.5s)
    assert.equal(seg2.startSec, 5.0, 'Segment 2 startSec must return to sourceStartSec (5.0s)');
    assert.equal(seg2.audioStartSec, 5.0, 'Segment 2 audioStartSec must return to 5.0s');

    // Flags reset
    assert.equal(seg1.audioTrimmed, false, 'audioTrimmed must be reset to false');
    assert.equal(seg1.audioOverrun, false, 'audioOverrun must be reset to false');

    assert.deepEqual(diskAfterReset.videoClips, initialVideoClips, 'Video clips must remain untouched');
  });

  it('Check 5: Ctrl+Z after align restores exactly', async () => {
    const initialSegments = [
      {
        id: 1,
        _uid: 'uid-z1',
        startSec: 1.0,
        endSec: 3.0,
        sourceStartSec: 1.0,
        sourceEndSec: 3.0,
        khmerText: 'ឃ្លា ១',
      },
      {
        id: 2,
        _uid: 'uid-z2',
        startSec: 4.0,
        endSec: 6.0,
        sourceStartSec: 4.0,
        sourceEndSec: 6.0,
        khmerText: 'ឃ្លា ២',
      },
    ];
    const initialVideoClips = [
      { id: 'clip-1', start: 0, end: 15, name: 'Video 1', isDialogue: true },
    ];

    seedDiskEpisode(initialSegments, initialVideoClips, 15);

    const undoSnapshot = {
      segments: JSON.parse(JSON.stringify(initialSegments)),
      videoClips: JSON.parse(JSON.stringify(initialVideoClips)),
    };

    // Run Auto-Align
    const currentState = { videoClips: initialVideoClips, segments: initialSegments };
    const opResult = autoAlign(currentState, { totalDuration: 15 });
    assert.equal(opResult.applied, true);

    // Persist aligned state
    persistDiskState(undefined, opResult.state.segments);

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
    assert.equal(diskAfterUndo.scriptData.segments.length, 2, 'Undo must restore exact 2 segments');
    assert.deepEqual(diskAfterUndo.scriptData.segments, initialSegments, 'Undo must restore exact prior segment data');
    assert.deepEqual(diskAfterUndo.videoClips, initialVideoClips, 'Undo must preserve exact video clips');
  });
});
