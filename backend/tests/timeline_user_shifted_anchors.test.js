const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  moveClip,
  autoAlign,
} = require('../../frontend/src/utils/timelineOps.js');

const ROOT_DIR = path.join(__dirname, '..', '..');
const FRONTEND_SRC = path.join(ROOT_DIR, 'frontend', 'src');

function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

test('1. Manual move (time shift OR lane change) sets userShifted: true and persists audioStartSec + trackRow', () => {
  const baseSegments = [
    { id: 1, _uid: 's1', startSec: 0.5, endSec: 2.0, audioStartSec: 0.5, audioEndSec: 2.0, audioDurationSec: 1.5, trackRow: 0 },
    { id: 4, _uid: 's4', startSec: 3.7, endSec: 5.7, audioStartSec: 3.7, audioEndSec: 5.7, audioDurationSec: 2.0, trackRow: 0 },
  ];

  // Time shift on same lane
  const timeShift = moveClip({ videoClips: [], segments: baseSegments }, { clipId: 's4', newStart: 6.25, trackRow: 0 });
  assert.equal(timeShift.applied, true);
  const shifted4 = timeShift.state.segments[1];
  assert.equal(shifted4.userShifted, true, 'Time shift must mark userShifted: true');
  assert.equal(shifted4.audioStartSec, 6.25);
  assert.equal(shifted4.audioEndSec, 8.25);
  assert.equal(shifted4.trackRow, 0);
  assert.equal(shifted4.sourceStartSec, 3.7, 'Preserves original sourceStartSec');

  // Lane-only change (same time, moved to VOICE 2 -> trackRow: 1)
  const laneChange = moveClip({ videoClips: [], segments: baseSegments }, { clipId: 's4', newStart: 3.7, trackRow: 1 });
  assert.equal(laneChange.applied, true);
  const laned4 = laneChange.state.segments[1];
  assert.equal(laned4.userShifted, true, 'Lane-only change must mark userShifted: true');
  assert.equal(laned4.audioStartSec, 3.7);
  assert.equal(laned4.trackRow, 1);
  assert.equal(laned4.trackId, 'voice-2');
});

test('2. Auto-Align honours userShifted clips as fixed anchors (any lane) and aligns non-shifted clips around them', () => {
  const segments = [
    { id: 1, _uid: 's1', startSec: 0.5, endSec: 2.0, audioStartSec: 0.5, audioEndSec: 2.0, audioDurationSec: 1.5, trackRow: 0, userShifted: false },
    { id: 2, _uid: 's2', startSec: 2.5, endSec: 4.0, audioStartSec: 3.1, audioEndSec: 4.6, audioDurationSec: 1.5, trackRow: 0, userShifted: false }, // drifted non-shifted
    { id: 4, _uid: 's4', startSec: 4.5, endSec: 6.5, audioStartSec: 5.8, audioEndSec: 7.8, audioDurationSec: 2.0, trackRow: 1, userShifted: true },  // manual anchor on VOICE 2
    { id: 5, _uid: 's5', startSec: 7.0, endSec: 8.5, audioStartSec: 8.4, audioEndSec: 9.9, audioDurationSec: 1.5, trackRow: 2, userShifted: false }, // drifted non-shifted on wrong lane
  ];

  const res = autoAlign({ videoClips: [], segments }, { totalDuration: 60 });
  assert.equal(res.applied, true);
  assert.equal(res.state.segments.length, 4);

  const byId = new Map(res.state.segments.map((s) => [s.id, s]));

  // #4 (userShifted anchor) must be 100% untouched
  const seg4 = byId.get(4);
  assert.equal(seg4.userShifted, true);
  assert.equal(seg4.audioStartSec, 5.8, 'userShifted #4 audioStartSec must never change');
  assert.equal(seg4.audioEndSec, 7.8, 'userShifted #4 audioEndSec must never change');
  assert.equal(seg4.trackRow, 1, 'userShifted #4 trackRow must stay VOICE 2 (1)');

  // #2 & #5 (non-shifted) must align to canonical slot starts on Lane 0
  const seg2 = byId.get(2);
  assert.equal(seg2.audioStartSec, 2.5);
  assert.equal(seg2.trackRow, 0);
  assert.equal(seg2.userShifted, false);

  const seg5 = byId.get(5);
  assert.equal(seg5.audioStartSec, 7.0);
  assert.equal(seg5.trackRow, 0);
  assert.equal(seg5.userShifted, false);

  // Report summarizes aligned + untouched manual anchors
  assert.equal(res.report.alignedCount, 2, 'Two non-shifted clips (#2 and #5) were aligned');
  assert.equal(res.report.untouchedCount, 1);
  assert.deepEqual(res.report.untouchedClipNumbers, [4]);
});

test('3. Auto-Align re-lanes a non-shifted clip when a Lane-0 userShifted anchor occupies its time window', () => {
  const segments = [
    { id: 4, _uid: 's4', startSec: 4.0, endSec: 7.0, audioStartSec: 4.0, audioEndSec: 7.0, audioDurationSec: 3.0, trackRow: 0, userShifted: true },
    { id: 5, _uid: 's5', startSec: 5.0, endSec: 6.5, audioStartSec: 5.0, audioEndSec: 6.5, audioDurationSec: 1.5, trackRow: 0, userShifted: false },
  ];

  const res = autoAlign({ videoClips: [], segments }, { totalDuration: 60 });
  assert.equal(res.applied, true);

  const seg4 = res.state.segments.find((s) => s.id === 4);
  const seg5 = res.state.segments.find((s) => s.id === 5);

  // Lane-0 anchor #4 is never trimmed or moved
  assert.equal(seg4.trackRow, 0);
  assert.equal(seg4.audioStartSec, 4.0);
  assert.equal(seg4.audioEndSec, 7.0);
  assert.equal(seg4.userShifted, true);

  // Non-shifted #5 keeps its canonical start 5.0s and moves to VOICE 2 (trackRow: 1) around anchor #4
  assert.equal(seg5.audioStartSec, 5.0);
  assert.equal(seg5.trackRow, 1);
  assert.equal(res.report.untouchedCount, 1);
  assert.deepEqual(res.report.untouchedClipNumbers, [4]);
});

test('4. Reset Timing is completely deleted — zero case-insensitive hits for resetTiming across frontend/src', () => {
  const files = walkFiles(FRONTEND_SRC);
  const hits = [];
  const pattern = /resetTiming|Reset Timing|ResetToSourceTiming/i;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (pattern.test(content)) {
      hits.push(path.relative(ROOT_DIR, filePath));
    }
  }

  assert.deepEqual(hits, [], `Found forbidden resetTiming references in: ${hits.join(', ')}`);
  assert.equal(typeof require('../../frontend/src/utils/timelineOps.js').resetTiming, 'undefined');
});

test('5. Backend sync-timeline-audio persists userShifted + trackRow + startSec on BOTH cache-hit and post-sync paths', () => {
  const audioRoutesPath = path.join(ROOT_DIR, 'backend', 'routes', 'audioRoutes.js');
  const src = fs.readFileSync(audioRoutesPath, 'utf8');

  assert.match(src, /const persistSyncedSegmentsToSeriesJson = async \(\) =>/);
  const calls = src.match(/await persistSyncedSegmentsToSeriesJson\(\);/g) || [];
  assert.ok(calls.length >= 2, `Expected persistSyncedSegmentsToSeriesJson to be called on cache-hit AND post-sync (found ${calls.length})`);
  assert.match(src, /userShifted:\s*Boolean\(updated\.userShifted\)/);
  assert.match(src, /startSec:\s*typeof updated\.startSec === "number"/);
});
