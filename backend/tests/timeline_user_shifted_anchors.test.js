const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  moveClip,
  autoAlign,
  releaseSegmentFromManual,
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

test('6. releaseSegmentFromManual clears userShifted & trackRow for ONLY that segment, does NOT auto-align yet, and subsequent autoAlign snaps it back to slot without overlapping #2/#3', () => {
  const videoClips = [
    { id: 'vc-1', segmentId: 1, start: 0.27, end: 0.96, name: '#1' },
    { id: 'vc-2', segmentId: 2, start: 1.40, end: 2.52, name: '#2' },
    { id: 'vc-3', segmentId: 3, start: 2.55, end: 3.70, name: '#3' },
    { id: 'vc-4', segmentId: 4, start: 3.85, end: 5.85, name: '#4' },
    { id: 'vc-5', segmentId: 5, start: 6.11, end: 8.43, name: '#5' },
  ];
  const segments = [
    { id: 1, _uid: 's1', startSec: 0.27, endSec: 0.96, audioStartSec: 0.27, audioEndSec: 0.96, audioDurationSec: 0.69, trackRow: 0, userShifted: false },
    { id: 2, _uid: 's2', startSec: 1.40, endSec: 2.52, audioStartSec: 1.40, audioEndSec: 2.52, audioDurationSec: 1.12, trackRow: 1, userShifted: true },
    { id: 3, _uid: 's3', startSec: 2.55, endSec: 3.70, audioStartSec: 2.55, audioEndSec: 3.70, audioDurationSec: 1.15, trackRow: 2, userShifted: true },
    // #4 was dragged ~1.3s early to 2.55s on Lane 1, overlapping #2/#3
    { id: 4, _uid: 's4', startSec: 2.55, endSec: 4.55, sourceStartSec: 3.85, sourceEndSec: 5.85, audioStartSec: 2.55, audioEndSec: 4.55, audioDurationSec: 2.0, trackRow: 1, userShifted: true },
    { id: 5, _uid: 's5', startSec: 6.11, endSec: 8.43, audioStartSec: 6.11, audioEndSec: 8.43, audioDurationSec: 2.32, trackRow: 0, userShifted: false },
  ];

  // Release ONLY #4
  const rel = releaseSegmentFromManual({ videoClips, segments }, { segKey: 's4' });
  assert.equal(rel.applied, true);
  assert.equal(rel.clipNumber, 4);

  const rel2 = rel.state.segments.find((s) => s.id === 2);
  const rel3 = rel.state.segments.find((s) => s.id === 3);
  const rel4 = rel.state.segments.find((s) => s.id === 4);

  // Other manual segments untouched
  assert.equal(rel2.userShifted, true);
  assert.equal(rel2.trackRow, 1);
  assert.equal(rel3.userShifted, true);
  assert.equal(rel3.trackRow, 2);

  // #4 cleared userShifted & manual trackRow override, WITHOUT moving audioStartSec yet
  assert.equal(rel4.userShifted, false);
  assert.equal(rel4.trackRow, 0);
  assert.equal(rel4.trackId, 'voice-1');
  assert.equal(rel4.audioStartSec, 2.55, 'Release must NOT auto-run Auto-Align (audioStartSec stays until owner clicks Auto-Align)');
  assert.equal(rel4.startSec, 3.85, 'Canonical slot startSec restored to 3.85s for next Auto-Align');

  // Releasing a non-shifted segment is a no-op
  const noopRes = releaseSegmentFromManual(rel.state, { segKey: 's5' });
  assert.equal(noopRes.applied, false);

  // Owner clicks Auto-Align afterwards -> #4 snaps to 3.85s and no longer overlaps #2 or #3
  const aligned = autoAlign(rel.state, { totalDuration: 60 });
  assert.equal(aligned.applied, true);
  const aligned4 = aligned.state.segments.find((s) => s.id === 4);
  assert.equal(aligned4.audioStartSec, 3.85, '#4 moved cleanly to slot start 3.85s');
  assert.equal(aligned4.trackRow, 0);
  assert.equal(aligned4.userShifted, false);
  assert.ok(aligned4.audioStartSec >= rel2.audioEndSec && aligned4.audioStartSec >= rel3.audioEndSec, '#4 no longer overlaps #2 or #3');
  assert.deepEqual(aligned.report.untouchedClipNumbers, [2, 3], 'Only #2 and #3 remain manual untouched');
});

test('7. ClipInspectorPanel shows Release to Auto-Align button ONLY for userShifted segments and NO yellow warning banner', () => {
  const inspectorPath = path.join(ROOT_DIR, 'frontend', 'src', 'components', 'voice', 'ClipInspectorPanel.jsx');
  const src = fs.readFileSync(inspectorPath, 'utf8');
  assert.match(src, /Boolean\(selectedSegment\?\.userShifted\)\s*&&\s*onReleaseSegmentToAutoAlign/);
  assert.match(src, /ឲ្យ Auto-Align គ្រប់គ្រងវិញ/);
  assert.match(src, /data-testid="btn-release-auto-align"/);
  assert.ok(!src.includes('data-testid="manual-position-release-banner"'), 'Intrusive yellow warning banner must be removed');
  assert.ok(!src.includes('ទីតាំងដៃ (Auto-Align មិនប៉ះ)'), 'Intrusive warning title must be removed');
});

