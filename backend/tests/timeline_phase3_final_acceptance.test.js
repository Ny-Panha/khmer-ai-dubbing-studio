import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deleteSegment,
  deleteVideoClip,
  deleteGap,
  splitClip,
  autoAlign,
  trimClip,
  moveClip,
} from '../../frontend/src/utils/timelineOps.js';
import {
  mapSourceToTimelineTime,
} from '../../frontend/src/utils/timelineUtils.js';
import {
  updateSeriesMetadata,
  saveSeriesMetadata,
} from '../services/episodeService.js';

describe('Phase 3 Final Acceptance Suite — Monotonic Playback, R7 Duration & Full Sweep', () => {
  let tempProjectsDir;
  const seriesId = 'test_series_phase_3';
  const episodeId = 'ep_phase_3_1';

  beforeEach(() => {
    tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-phase-3-'));
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
      title: 'Disposable Phase 3 Episode',
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
    const series = { id: seriesId, title: 'Disposable Series Phase 3', episodes: [episode] };
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

  // ═════════════════════════════════════════════════════════════════
  // Check 1: Play 00:00-00:30 across boundaries (time never jumps backward)
  // ═════════════════════════════════════════════════════════════════
  it('Check 1: Monotonic playback mapping across clips with overlapping source ranges', () => {
    // Two clips where Clip B reuses source material that overlaps with Clip A:
    // Clip A: timeline [0, 15], source [0, 15]
    // Clip B: timeline [15, 30], source [5, 20] (source range [5, 15] overlaps with Clip A)
    const clips = [
      { id: 'clip-a', start: 0, end: 15, sourceStart: 0, sourceEnd: 15, isDialogue: true },
      { id: 'clip-b', start: 15, end: 30, sourceStart: 5, sourceEnd: 20, isDialogue: true },
    ];

    let currentClipIdx = 0;
    let lastTlTime = 0;

    // Simulate playback ticking forward:
    // Part 1: Playing through Clip A (source 0 -> 15, timeline 0 -> 15)
    for (let t = 0; t <= 14.5; t += 0.5) {
      const tl = mapSourceToTimelineTime(t, clips, currentClipIdx);
      assert.ok(tl !== null, `Must map time at source ${t}`);
      assert.ok(tl >= lastTlTime, `Timeline time must never decrease (was ${lastTlTime}, got ${tl})`);
      lastTlTime = tl;
    }

    // Transition: Video player transitions to Clip B (source jumps to 5.0)
    currentClipIdx = 1; // Advanced to Clip B

    // Part 2: Playing through Clip B (source 5.0 -> 20.0, timeline 15.0 -> 30.0)
    for (let t = 5.0; t <= 20.0; t += 0.5) {
      // With fromIndex = 1 (Clip B), sourceTime 7.0 MUST map to Clip B ([15 + (7-5)] = 17.0), NOT Clip A (7.0)!
      const tl = mapSourceToTimelineTime(t, clips, currentClipIdx);
      assert.ok(tl !== null, `Must map time at source ${t} on Clip B`);
      assert.ok(tl >= lastTlTime, `Timeline time must never jump backward across overlapping source ranges (was ${lastTlTime}, got ${tl})`);
      lastTlTime = tl;
    }

    assert.equal(lastTlTime, 30.0, 'Playback ends at 30.0 monotonically');
  });

  // ═════════════════════════════════════════════════════════════════
  // Check 2: Cut an opening Gap (header duration shrinks by the Gap length)
  // ═════════════════════════════════════════════════════════════════
  it('Check 2: Cutting opening Gap shrinks header duration / ruler length by exact Gap length (R7)', () => {
    // Initial: 30s video with an opening Gap of 5.0s and dialogue clip from 5.0 to 30.0
    const initialClips = [
      { id: 'clip-gap-1', name: 'Gap', start: 0, end: 5.0, sourceStart: 0, sourceEnd: 5.0, isDialogue: false },
      { id: 'clip-dialogue-1', name: 'Scene 1', start: 5.0, end: 30.0, sourceStart: 5.0, sourceEnd: 30.0, isDialogue: true },
    ];
    const initialSegments = [
      { id: 1, _uid: 'uid-1', startSec: 6.0, endSec: 10.0, khmerText: 'សួស្តី' },
    ];

    seedDiskEpisode(initialSegments, initialClips, 30.0);
    const diskBefore = readDiskEpisode();
    const clipsBeforeMax = diskBefore.videoClips.reduce((max, c) => Math.max(max, Number(c.end) || 0), 0);
    assert.equal(clipsBeforeMax, 30.0);

    // Delete opening Gap via pure op deleteGap
    const state = { videoClips: diskBefore.videoClips, segments: diskBefore.scriptData.segments };
    const res = deleteGap(state, { clipId: 'clip-gap-1' });

    assert.equal(res.applied, true, 'deleteGap must apply');
    assert.equal(res.state.videoClips.length, 1);
    assert.equal(res.state.videoClips[0].start, 0);
    assert.equal(res.state.videoClips[0].end, 25.0, 'Survivor clip end must shift left from 30.0 to 25.0');

    // Persist to series.json
    persistDiskState(res.state.videoClips, res.state.segments);

    const diskAfter = readDiskEpisode();
    const clipsAfterMax = diskAfter.videoClips.reduce((max, c) => Math.max(max, Number(c.end) || 0), 0);
    assert.equal(clipsAfterMax, 25.0, 'R7: Timeline duration must equal 25.0s (shrunk by exactly 5.0s Gap duration)');
    assert.deepEqual(diskAfter.scriptData.segments, initialSegments, 'Segments untouched by Gap delete');
  });

  // ═════════════════════════════════════════════════════════════════
  // Check 3: Delete -> Align -> Reload (nothing resurrects)
  // ═════════════════════════════════════════════════════════════════
  it('Check 3: Delete a segment -> Auto-Align -> reload from disk (tombstone & persistence prevent resurrection)', () => {
    const initialClips = [{ id: 'clip-1', start: 0, end: 20, isDialogue: true }];
    const initialSegments = [
      { id: 1, _uid: 'uid-stay-1', startSec: 1.0, endSec: 3.0, sourceStartSec: 1.0, sourceEndSec: 3.0, khmerText: 'មួយ' },
      { id: 2, _uid: 'uid-delete-me', startSec: 4.0, endSec: 6.0, sourceStartSec: 4.0, sourceEndSec: 6.0, khmerText: 'ពីរ' },
      { id: 3, _uid: 'uid-stay-2', startSec: 7.0, endSec: 9.0, sourceStartSec: 7.0, sourceEndSec: 9.0, khmerText: 'បី' },
    ];

    seedDiskEpisode(initialSegments, initialClips, 20);

    // Step A: Delete segment 2
    let state = { videoClips: initialClips, segments: initialSegments };
    const deleteRes = deleteSegment(state, { segKey: 'uid-delete-me' });
    assert.equal(deleteRes.applied, true);
    assert.equal(deleteRes.state.segments.length, 2);

    // Step B: Auto-Align survivor segments
    const alignRes = autoAlign(deleteRes.state, { totalDuration: 20 });
    assert.equal(alignRes.applied, true);
    assert.equal(alignRes.state.segments.length, 2, 'Auto-align must preserve survivor count (move-only)');

    // Persist to disk series.json
    persistDiskState(alignRes.state.videoClips, alignRes.state.segments);

    // Step C: Reload from disk
    const diskReloaded = readDiskEpisode();
    assert.equal(diskReloaded.scriptData.segments.length, 2);
    const reloadedUids = diskReloaded.scriptData.segments.map((s) => s._uid);
    assert.deepEqual(reloadedUids, ['uid-stay-1', 'uid-stay-2'], 'Deleted segment must never resurrect');
    assert.ok(!reloadedUids.includes('uid-delete-me'), 'Deleted UID is completely absent');
  });

  // ═════════════════════════════════════════════════════════════════
  // Check 4: Split a fresh episode's clip unselected
  // ═════════════════════════════════════════════════════════════════
  it('Check 4: Split fresh episode with empty/virtual clips materializes real clips at playhead', () => {
    // Fresh episode: empty videoClips array, totalDuration = 28.5
    seedDiskEpisode([], [], 28.5);
    const disk = readDiskEpisode();
    assert.equal(disk.videoClips.length, 0);

    const state = { videoClips: disk.videoClips, segments: disk.scriptData.segments };
    const splitRes = splitClip(state, {
      splitTime: 8.5,
      totalDuration: 28.5,
      clipDefaults: { name: 'Fresh Video.mp4', videoId: 'fresh-1' },
    });

    assert.equal(splitRes.applied, true, 'splitClip on virtual clip must apply');
    assert.equal(splitRes.state.videoClips.length, 2, 'Must materialize exactly 2 real clips');

    const [part1, part2] = splitRes.state.videoClips;
    assert.equal(part1.start, 0);
    assert.equal(part1.end, 8.5);
    assert.equal(part1.sourceStart, 0);
    assert.equal(part1.sourceEnd, 8.5);

    assert.equal(part2.start, 8.5);
    assert.equal(part2.end, 28.5);
    assert.equal(part2.sourceStart, 8.5);
    assert.equal(part2.sourceEnd, 28.5);

    // Persist to disk series.json
    persistDiskState(splitRes.state.videoClips, splitRes.state.segments);

    const diskAfter = readDiskEpisode();
    assert.equal(diskAfter.videoClips.length, 2, 'Disk must store both materialized clips');
    assert.equal(diskAfter.videoClips[0].end, 8.5);
    assert.equal(diskAfter.videoClips[1].end, 28.5);
  });

  // ═════════════════════════════════════════════════════════════════
  // Check 5: Ctrl+Z after each op restores exactly
  // ═════════════════════════════════════════════════════════════════
  it('Check 5: Undo stack faithfully reverts each operation to exact prior disk state', () => {
    const initialClips = [
      { id: 'clip-1', start: 0, end: 10, sourceStart: 0, sourceEnd: 10, isDialogue: true },
      { id: 'clip-2', start: 10, end: 20, sourceStart: 10, sourceEnd: 20, isDialogue: true },
    ];
    const initialSegments = [
      { id: 1, _uid: 'uid-1', startSec: 2.0, endSec: 4.0, duration: 2.0, khmerText: 'A' },
      { id: 2, _uid: 'uid-2', startSec: 6.0, endSec: 8.0, duration: 2.0, khmerText: 'B' },
    ];

    seedDiskEpisode(initialSegments, initialClips, 20);

    const undoStack = [];
    const pushUndo = (clips, segs) => {
      undoStack.push({
        clips: JSON.parse(JSON.stringify(clips)),
        segments: JSON.parse(JSON.stringify(segs)),
      });
    };

    let curClips = readDiskEpisode().videoClips;
    let curSegs = readDiskEpisode().scriptData.segments;

    // Op 1: Delete segment 1
    pushUndo(curClips, curSegs); // Snapshot 0
    const delSegRes = deleteSegment({ videoClips: curClips, segments: curSegs }, { segKey: 'uid-1' });
    curClips = delSegRes.state.videoClips;
    curSegs = delSegRes.state.segments;
    persistDiskState(curClips, curSegs);
    assert.equal(readDiskEpisode().scriptData.segments.length, 1);

    // Op 2: Split clip-2 at 15.0
    pushUndo(curClips, curSegs); // Snapshot 1
    const splitRes = splitClip({ videoClips: curClips, segments: curSegs }, { splitTime: 15.0, totalDuration: 20 });
    curClips = splitRes.state.videoClips;
    curSegs = splitRes.state.segments;
    persistDiskState(curClips, curSegs);
    assert.equal(readDiskEpisode().videoClips.length, 3);

    // Op 3: Move clip-1 right edge via trimClip to 8.0
    pushUndo(curClips, curSegs); // Snapshot 2
    const trimRes = trimClip({ videoClips: curClips, segments: curSegs }, { clipId: 'clip-1', edge: 'right', newTime: 8.0 });
    curClips = trimRes.state.videoClips;
    curSegs = trimRes.state.segments;
    persistDiskState(curClips, curSegs);
    assert.equal(readDiskEpisode().videoClips[0].end, 8.0);

    // Undo Op 3 (revert trim) -> Snapshot 2
    const snap2 = undoStack.pop();
    persistDiskState(snap2.clips, snap2.segments);
    assert.equal(readDiskEpisode().videoClips[0].end, 10.0, 'Clip-1 end must be restored to 10.0');
    assert.equal(readDiskEpisode().videoClips.length, 3, 'Must still have 3 clips before split undo');

    // Undo Op 2 (revert split) -> Snapshot 1
    const snap1 = undoStack.pop();
    persistDiskState(snap1.clips, snap1.segments);
    assert.equal(readDiskEpisode().videoClips.length, 2, 'Video clips restored to 2 clips');
    assert.equal(readDiskEpisode().scriptData.segments.length, 1, 'Segment 1 still deleted');

    // Undo Op 1 (revert delete) -> Snapshot 0
    const snap0 = undoStack.pop();
    persistDiskState(snap0.clips, snap0.segments);
    assert.deepEqual(readDiskEpisode().videoClips, initialClips, 'Initial clips 100% restored');
    assert.deepEqual(readDiskEpisode().scriptData.segments, initialSegments, 'Initial segments 100% restored');
  });
});
