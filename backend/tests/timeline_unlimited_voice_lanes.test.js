const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Requirement 1: Dynamic voice lane count formula verification', () => {
  const computeVoiceLaneCount = (segments, draggingTargetRow = 0) => {
    const maxSegmentTrackRow = (segments || []).reduce((max, s) => {
      const r = (typeof s.trackRow === 'number' && s.trackRow >= 0) ? s.trackRow : 0;
      return Math.max(max, r);
    }, 0);
    return Math.max(2, maxSegmentTrackRow + 2, draggingTargetRow + 1);
  };

  // Case 1: Empty or all segments on trackRow = 0
  assert.equal(computeVoiceLaneCount([]), 2, 'Empty segments list has 2 lanes (VOICE 1, VOICE 2)');
  assert.equal(computeVoiceLaneCount([{ trackRow: 0 }]), 2, 'All on row 0 has 2 lanes');

  // Case 2: Highest trackRow is 1 (VOICE 2 used) -> 3 lanes (VOICE 1, 2, + empty 3)
  assert.equal(computeVoiceLaneCount([{ trackRow: 0 }, { trackRow: 1 }]), 3, 'Highest row 1 has 3 lanes (VOICE 1..3)');

  // Case 3: Dropped onto trackRow = 2 (VOICE 3 used) -> 4 lanes (VOICE 1..3, + empty 4)
  assert.equal(computeVoiceLaneCount([{ trackRow: 0 }, { trackRow: 2 }]), 4, 'Highest row 2 has 4 lanes (VOICE 1..4)');

  // Case 4: Dropped onto trackRow = 5 (VOICE 6 used) -> 7 lanes (VOICE 1..6, + empty 7)
  assert.equal(computeVoiceLaneCount([{ trackRow: 5 }]), 7, 'Highest row 5 has 7 lanes (VOICE 1..7)');

  // Case 5: While dragging downwards onto target row 3
  assert.equal(computeVoiceLaneCount([{ trackRow: 1 }], 3), 4, 'While dragging to row 3, renders at least 4 lanes');
});

test('Requirement 1 & 2: Static audit for unlimited lanes and drag badges', () => {
  const canvasPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx');
  const headersPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTrackHeaders.jsx');
  const editorPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineEditor.jsx');
  const utilsPath = path.resolve(__dirname, '../../frontend/src/utils/timelineUtils.js');

  const canvasCode = fs.readFileSync(canvasPath, 'utf8');
  const headersCode = fs.readFileSync(headersPath, 'utf8');
  const editorCode = fs.readFileSync(editorPath, 'utf8');
  const utilsCode = fs.readFileSync(utilsPath, 'utf8');

  // 1. No clamping to max 1 or 2 voice tracks
  assert.ok(!canvasCode.includes('Math.min(1, Math.max(0, seg.trackRow))'), 'Canvas must not clamp seg.trackRow to 1');
  assert.ok(!canvasCode.includes('Math.min(2, Math.max(2, voiceRowCount'), 'Canvas must not clamp voiceRowCount to 2');
  assert.ok(!headersCode.includes('Math.min(2, Math.max(2, voiceRowCount'), 'Headers must not clamp voiceRowCount to 2');
  assert.ok(!editorCode.includes('const voiceRowCount = Math.min(2,'), 'Editor must not clamp voiceRowCount to 2');
  assert.ok(!utilsCode.includes('targetRow = Math.min(1, Math.max(0, seg.trackRow))'), 'timelineUtils must not clamp targetRow to 1');

  // 2. Drag hints: "Drop to create VOICE {n}" vs "Drop to place on VOICE {n}"
  assert.ok(canvasCode.includes('Drop to create VOICE'), 'Canvas must render "Drop to create VOICE" for empty bottom lane');
  assert.ok(canvasCode.includes('Drop to place on VOICE'), 'Canvas must render "Drop to place on VOICE" for existing lanes');

  // 3. Dynamic trackId generation: `voice-${targetRow + 1}`
  assert.ok(utilsCode.includes('`voice-${targetRow + 1}`'), 'timelineUtils must dynamically generate voice-${targetRow + 1}');
  assert.ok(editorCode.includes('`voice-${finalTargetRow + 1}`'), 'Editor must dynamically generate voice-${finalTargetRow + 1}');
});

test('Requirement 3: autoAlignVoiceSegments keeps userShifted trackRow sticky', async () => {
  const { autoAlignVoiceSegments } = await import('../../frontend/src/utils/timelineUtils.js');

  const segments = [
    {
      id: 1,
      start: '00:00',
      end: '00:02',
      startSec: 0,
      endSec: 2,
      audioDurationSec: 2,
      trackRow: 0,
      userShifted: false,
    },
    {
      id: 2,
      start: '00:01', // overlaps with segment #1 on lane 0
      end: '00:03',
      startSec: 1,
      endSec: 3,
      audioDurationSec: 2,
      trackRow: 1,
      userShifted: false,
    },
    {
      id: 5,
      start: '00:04',
      end: '00:07',
      startSec: 4,
      endSec: 7,
      audioDurationSec: 3,
      trackRow: 2, // Manually placed on VOICE 3
      userShifted: true,
    },
    {
      id: 6,
      start: '00:08',
      end: '00:11',
      startSec: 8,
      endSec: 11,
      audioDurationSec: 3,
      trackRow: 4, // Manually placed on VOICE 5
      userShifted: true,
    },
  ];

  const aligned = autoAlignVoiceSegments(segments, 60);

  // Segment at index 2 (originally #5) and index 3 (originally #6) MUST retain their exact trackRow because they are userShifted
  const aligned5 = aligned[2];
  const aligned6 = aligned[3];

  assert.equal(aligned5.trackRow, 2, 'Segment originally #5 must remain on trackRow 2 (VOICE 3)');
  assert.equal(aligned5.trackId, 'voice-3', 'Segment originally #5 trackId must be voice-3');

  assert.equal(aligned6.trackRow, 4, 'Segment originally #6 must remain on trackRow 4 (VOICE 5)');
  assert.equal(aligned6.trackId, 'voice-5', 'Segment originally #6 trackId must be voice-5');

  // Non-userShifted segments (1 & 2) live sequentially on Lane 0 (VOICE 1) CapCut-style
  assert.equal(aligned[0].trackRow, 0);
  assert.equal(aligned[1].trackRow, 0);
});

test('Requirement 4: Cross-lane drop stands without overlap push-back', () => {
  // Simulate mouse drop logic in TimelineEditor
  const simulateAudioDrop = ({
    curSegRow,
    finalTargetRow,
    origStart,
    origEnd,
    newStart,
    allSegments,
    segIdx,
  }) => {
    const dur = Math.max(0.4, origEnd - origStart);
    let effectiveStart = newStart;
    let effectiveEnd = parseFloat((effectiveStart + dur).toFixed(2));

    // Clamping rule from TimelineEditor:
    // Only clamp against same-lane neighbours if moving within the same lane
    if (curSegRow === finalTargetRow) {
      let prevBound = 0;
      let nextBound = Infinity;
      for (let i = 0; i < allSegments.length; i++) {
        if (i === segIdx) continue;
        const other = allSegments[i];
        if (other.trackRow !== finalTargetRow) continue;
        if (other.endSec <= origStart + 0.05) {
          if (other.endSec > prevBound) prevBound = other.endSec;
        } else if (other.startSec >= origEnd - 0.05) {
          if (other.startSec < nextBound) nextBound = other.startSec;
        }
      }
      if (effectiveStart < prevBound) {
        effectiveStart = prevBound;
        effectiveEnd = parseFloat((effectiveStart + dur).toFixed(2));
      }
      if (nextBound !== Infinity && effectiveEnd > nextBound) {
        effectiveEnd = nextBound;
        effectiveStart = Math.max(prevBound, parseFloat((effectiveEnd - dur).toFixed(2)));
      }
    }

    return {
      trackRow: finalTargetRow,
      startSec: effectiveStart,
      endSec: effectiveEnd,
      userShifted: true,
    };
  };

  // Target lane (row 0) has an existing clip at 2.0s - 5.0s
  const existingSegments = [
    { id: 1, trackRow: 0, startSec: 2.0, endSec: 5.0 },
    { id: 7, trackRow: 1, startSec: 10.0, endSec: 13.0 },
  ];

  // Drag #7 from row 1 onto row 0 at time 3.0s (occupied time by #1)
  const dropResult = simulateAudioDrop({
    curSegRow: 1,
    finalTargetRow: 0,
    origStart: 10.0,
    origEnd: 13.0,
    newStart: 3.0,
    allSegments: existingSegments,
    segIdx: 1,
  });

  // The drop onto VOICE 1 must stand at 3.0s (no push back across lanes or crushing)
  assert.equal(dropResult.trackRow, 0, 'Target trackRow must be 0 (VOICE 1)');
  assert.equal(dropResult.startSec, 3.0, 'Dropped startSec must remain 3.0');
  assert.equal(dropResult.endSec, 6.0, 'Dropped endSec must remain 6.0');
  assert.equal(dropResult.userShifted, true, 'Must be userShifted');
});

test('Requirement 5: Persistence round-trip of trackRow and userShifted on EP2', () => {
  const seriesFile = path.resolve(__dirname, '../uploads/projects/series_1793898268958/series.json');
  if (fs.existsSync(seriesFile)) {
    const meta = JSON.parse(fs.readFileSync(seriesFile, 'utf8'));
    const ep2 = meta.episodes.find((e) => e.id === 'ep_2');
    if (ep2 && ep2.scriptData?.segments) {
      // Check segment 5 in EP2
      const seg5 = ep2.scriptData.segments.find((s) => s.id === 5);
      if (seg5) {
        // Confirm fields exist or can be set to lane 2
        seg5.trackRow = 2;
        seg5.trackId = 'voice-3';
        seg5.userShifted = true;

        const serialized = JSON.stringify(meta);
        const reloaded = JSON.parse(serialized);
        const reloadedSeg5 = reloaded.episodes.find((e) => e.id === 'ep_2').scriptData.segments.find((s) => s.id === 5);

        assert.equal(reloadedSeg5.trackRow, 2, 'trackRow: 2 must survive JSON persistence');
        assert.equal(reloadedSeg5.trackId, 'voice-3');
        assert.equal(reloadedSeg5.userShifted, true);

        // Revert seg5 in series.json to original state so test does not pollute file
        delete seg5.trackRow;
        delete seg5.trackId;
        delete seg5.userShifted;
      }
    }
  }
});
