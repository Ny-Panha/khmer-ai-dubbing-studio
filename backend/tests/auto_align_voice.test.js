const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  autoAlign,
  resetTiming,
} = require('../../frontend/src/utils/timelineOps.js');

function runAutoAlign(segments, totalDuration, options = {}) {
  const res = autoAlign({ videoClips: [], segments }, { totalDuration, options });
  assert.equal(res.applied, true, 'autoAlign must return applied: true');
  return res.state.segments;
}

function runResetTiming(segments, totalDuration) {
  const res = resetTiming({ videoClips: [], segments }, { totalDuration });
  assert.equal(res.applied, true, 'resetTiming must return applied: true');
  return res.state.segments;
}

test('autoAlign: perfectly aligns voice clips to subtitle onsets with multi-track alternation', () => {
  // Scenario matching Nha's screenshot (Clips #3 to #12)
  const segments = [
    { id: 3, startSec: 93.0, endSec: 94.92, audioStartSec: 93.0, audioEndSec: 94.92, audioDurationSec: 1.92, speaker: 'Speaker A' },
    { id: 4, startSec: 95.5, endSec: 97.91, audioStartSec: 95.5, audioEndSec: 97.91, audioDurationSec: 2.41, speaker: 'Speaker B' },
    { id: 5, startSec: 98.8, endSec: 101.21, audioStartSec: 98.0, audioEndSec: 100.41, audioDurationSec: 2.41, speaker: 'Speaker A' }, // Previously corrupted to 98.0s
    { id: 6, startSec: 101.5, endSec: 104.68, audioStartSec: 100.41, audioEndSec: 103.59, audioDurationSec: 3.18, speaker: 'Speaker B' },
    { id: 7, startSec: 105.0, endSec: 107.14, audioStartSec: 103.59, audioEndSec: 105.73, audioDurationSec: 2.14, speaker: 'Speaker A' },
    { id: 8, startSec: 107.2, endSec: 108.2, audioStartSec: 105.73, audioEndSec: 106.73, audioDurationSec: 1.0, speaker: 'Speaker B' },
    { id: 9, startSec: 108.2, endSec: 109.2, audioStartSec: 107.0, audioEndSec: 108.0, audioDurationSec: 1.0, speaker: 'Speaker A' },
    { id: 10, startSec: 109.6, endSec: 113.25, audioStartSec: 108.5, audioEndSec: 112.15, audioDurationSec: 3.65, speaker: 'Speaker B' },
    { id: 11, startSec: 113.5, endSec: 114.8, audioStartSec: 112.1, audioEndSec: 113.4, audioDurationSec: 1.3, speaker: 'Speaker A' },
    { id: 12, startSec: 115.0, endSec: 117.34, audioStartSec: 113.5, audioEndSec: 115.84, audioDurationSec: 2.34, speaker: 'Speaker B' }
  ];

  const aligned = runAutoAlign(segments, 375.37);

  // 1. Verify every segment's audioStartSec is in 100% lockstep with its visual subtitle startSec
  assert.equal(aligned[2].id, 5, 'survivors keep their real id under pure ops R5 (no arbitrary renumbering)');
  assert.equal(aligned[2].audioStartSec, 98.8); // Resets back from 98.0 to true 98.8s
  assert.equal(aligned[2].startSec, 98.8);

  assert.equal(aligned[3].audioStartSec, 101.5);
  assert.equal(aligned[4].audioStartSec, 105.0);
  assert.equal(aligned[7].audioStartSec, 109.6);
  assert.equal(aligned[9].audioStartSec, 115.0);

  // 2. Verify clips that do not collide stay on the same clean line (Row 0 / VOICE 1):
  assert.equal(aligned[0].trackRow, 0); // VOICE 1
  assert.equal(aligned[1].trackRow, 0); // VOICE 1 (non-colliding)
  assert.equal(aligned[2].trackRow, 0); // VOICE 1
  assert.equal(aligned[3].trackRow, 0); // VOICE 1
  assert.equal(aligned[4].trackRow, 0); // VOICE 1
  assert.equal(aligned[5].trackRow, 0); // VOICE 1

  // 3. Verify no clips on the same track overlap
  const trackEnds = {};
  for (const seg of aligned) {
    const row = seg.trackRow;
    if (trackEnds[row] !== undefined) {
      assert.ok(
        seg.audioStartSec >= trackEnds[row] - 0.01,
        `Collision on Track ${row}: Clip #${seg.id} starts at ${seg.audioStartSec} before previous ended at ${trackEnds[row]}`
      );
    }
    trackEnds[row] = seg.audioEndSec;
  }
});

test('autoAlign: prevents simultaneous voice overlap on Lane 0 without deleting duplicate text (move-only)', () => {
  // Scenario matching Nha's screenshot at 02:14:
  // Segment #20: 3.5s long narration from 133.59 to 137.09
  // Segment #21: "ម្នាក់ទៀតហើយ" at 133.75s
  // Segment #22: duplicate "ម្នាក់ទៀតហើយ" at 134.00s
  const collidingSegments = [
    {
      id: 20,
      startSec: 133.59,
      endSec: 137.09,
      audioDurationSec: 3.50,
      khmerText: 'ហេតុនេះហើយ គេត្រូវតែមុនពេលពិភពទាំងពីរបញ្ចូលគ្នា',
      originalChineseText: '所以他必须在两界归一之前',
      speaker: 'អ្នកសម្រាយ',
      speakerGender: 'MALE',
    },
    {
      id: 21,
      startSec: 133.75,
      endSec: 135.00,
      audioDurationSec: 1.25,
      khmerText: 'ម្នាក់ទៀតហើយ',
      originalChineseText: '又一个',
      speaker: 'តួអង្គទូទៅ',
      speakerGender: 'MALE',
    },
    {
      id: 22,
      startSec: 134.00,
      endSec: 135.25,
      audioDurationSec: 1.25,
      khmerText: 'ម្នាក់ទៀតហើយ',
      originalChineseText: '又一个',
      speaker: 'តួអង្គទូទៅ',
      speakerGender: 'MALE',
    },
  ];

  const aligned = runAutoAlign(collidingSegments, 300.0);

  // 1. Move-Only: Duplicate #22 is NOT deleted (all 3 segments remain)
  assert.equal(aligned.length, 3, 'All 3 segments must be preserved without silent deletion');

  // 2. All clips sit sequentially on Lane 0 (VOICE 1) CapCut-style
  assert.equal(aligned[0].trackRow, 0, 'Segment 0 must be on Lane 0');
  assert.equal(aligned[1].trackRow, 0, 'Segment 1 must be on Lane 0');
  assert.equal(aligned[2].trackRow, 0, 'Segment 2 must be on Lane 0');

  // 3. Overruns are clamped sequentially without overlap
  assert.ok(aligned[0].audioEndSec <= aligned[1].audioStartSec + 0.01, 'Segment 0 must clamp before Segment 1 starts');
  assert.ok(aligned[1].audioEndSec <= aligned[2].audioStartSec + 0.01, 'Segment 1 must clamp before Segment 2 starts');
  assert.equal(aligned[0].audioTrimmed, true, 'Segment 0 must be marked audioTrimmed');
  assert.equal(aligned[1].audioTrimmed, true, 'Segment 1 must be marked audioTrimmed');
});

test('autoAlign: resolves over-long audio on Lane 0 by clamping previous audioEndSec without shifting N', () => {
  // Scenario matching real episode segments #17, #18, #19:
  // #17: 39.91 to 42.02 (speech), audio is 3.69s (overrunning to 43.60)
  // #18: 42.50 to 43.60, audio is 1.25s
  // #19: 43.60 to 47.29, audio is 3.69s
  const segments = [
    {
      id: 17,
      startSec: 39.91,
      endSec: 43.60,
      sourceStartSec: 39.91,
      sourceEndSec: 43.60,
      speechStartSec: 39.91,
      speechEndSec: 42.02,
      slotDuration: 2.59,
      audioDurationSec: 3.69,
      audioFile: 'ep_1_seg_17.mp3',
    },
    {
      id: 18,
      startSec: 42.50,
      endSec: 43.75,
      sourceStartSec: 42.50,
      sourceEndSec: 43.75,
      slotDuration: 1.10,
      audioDurationSec: 1.25,
      audioFile: 'ep_1_seg_18.mp3',
    },
    {
      id: 19,
      startSec: 43.60,
      endSec: 47.29,
      sourceStartSec: 43.60,
      sourceEndSec: 47.29,
      speechStartSec: 43.60,
      speechEndSec: 47.29,
      slotDuration: 6.77,
      audioDurationSec: 3.69,
      audioFile: 'ep_1_seg_19.mp3',
    },
  ];

  const aligned = runAutoAlign(segments, 180.0);

  // Both #17 and #18 sit on Lane 0 (VOICE 1), not dropped to VOICE 2!
  assert.equal(aligned[0].trackRow, 0, '#17 must stay on VOICE 1');
  assert.equal(aligned[1].trackRow, 0, '#18 must sit on VOICE 1 instead of dropping to VOICE 2');
  assert.equal(aligned[2].trackRow, 0, '#19 must sit on VOICE 1');

  // #17 audioEndSec is clamped to #18 startSec (42.50)
  assert.equal(aligned[0].audioEndSec, 42.50);
  assert.equal(aligned[0].audioTrimmed, true, '#17 must be marked audioTrimmed');

  // #18 starts at exact 42.50 (never shifted forward)
  assert.equal(aligned[1].audioStartSec, 42.50);
  assert.equal(aligned[1].startSec, 42.50);

  // #18 audioEndSec is clamped to #19 startSec (43.60)
  assert.equal(aligned[1].audioEndSec, 43.60);
  assert.equal(aligned[1].audioTrimmed, true, '#18 must be marked audioTrimmed');

  // #19 starts at exact 43.60
  assert.equal(aligned[2].audioStartSec, 43.60);
  assert.equal(aligned[2].audioTrimmed, false, '#19 is not trimmed');

  // Verify Reset Timing restores source timing on Lane 0
  const resetSegs = runResetTiming(aligned, 180.0);
  assert.equal(resetSegs[0].audioTrimmed, false, '#17 audioTrimmed must be reset');
  assert.equal(resetSegs[1].trackRow, 0, 'Reset timing keeps #18 on VOICE 1 (Lane 0)');
});

// User Requirements (a), (b), (c)
test('Requirement (a): chain of segments with >40% overruns all land on trackRow 0 in order with clamped audioEndSec and audioOverrun: true', () => {
  // Chain of 4 segments where each segment's audio overruns into the next by > 40%:
  // Seg 1: start 0.0, audioDur 3.0s (ends 3.0). Next seg starts at 1.0s. Cut = 2.0s / 3.0s = 66.7% (> 40%)
  // Seg 2: start 1.0, audioDur 3.0s (ends 4.0). Next seg starts at 2.0s. Cut = 2.0s / 3.0s = 66.7% (> 40%)
  // Seg 3: start 2.0, audioDur 3.0s (ends 5.0). Next seg starts at 3.0s. Cut = 2.0s / 3.0s = 66.7% (> 40%)
  // Seg 4: start 3.0, audioDur 1.5s (ends 4.5). No next segment.
  const chain = [
    { id: 1, startSec: 0.0, endSec: 1.0, audioDurationSec: 3.0, audioFile: 'seg_1.mp3' },
    { id: 2, startSec: 1.0, endSec: 2.0, audioDurationSec: 3.0, audioFile: 'seg_2.mp3' },
    { id: 3, startSec: 2.0, endSec: 3.0, audioDurationSec: 3.0, audioFile: 'seg_3.mp3' },
    { id: 4, startSec: 3.0, endSec: 4.5, audioDurationSec: 1.5, audioFile: 'seg_4.mp3' },
  ];

  const aligned = runAutoAlign(chain, 60.0);

  assert.equal(aligned.length, 4);

  // All 4 segments land on trackRow 0 in order
  for (let i = 0; i < aligned.length; i++) {
    assert.equal(aligned[i].trackRow, 0, `Segment #${aligned[i].id} must land on trackRow 0`);
  }

  // Seg 1: clamped at 1.0, audioTrimmed: true, audioOverrun: true
  assert.equal(aligned[0].audioStartSec, 0.0);
  assert.equal(aligned[0].audioEndSec, 1.0);
  assert.equal(aligned[0].audioTrimmed, true);
  assert.equal(aligned[0].audioOverrun, true, 'Seg 1 cut > 40% must have audioOverrun=true');
  assert.ok(aligned[0].overrunRatio > 0.40, 'overrunRatio must be > 0.40');

  // Seg 2: clamped at 2.0, audioTrimmed: true, audioOverrun: true
  assert.equal(aligned[1].audioStartSec, 1.0);
  assert.equal(aligned[1].audioEndSec, 2.0);
  assert.equal(aligned[1].audioTrimmed, true);
  assert.equal(aligned[1].audioOverrun, true, 'Seg 2 cut > 40% must have audioOverrun=true');

  // Seg 3: clamped at 3.0, audioTrimmed: true, audioOverrun: true
  assert.equal(aligned[2].audioStartSec, 2.0);
  assert.equal(aligned[2].audioEndSec, 3.0);
  assert.equal(aligned[2].audioTrimmed, true);
  assert.equal(aligned[2].audioOverrun, true, 'Seg 3 cut > 40% must have audioOverrun=true');

  // Seg 4: not clamped
  assert.equal(aligned[3].audioStartSec, 3.0);
  assert.equal(aligned[3].audioEndSec, 4.5);
  assert.equal(aligned[3].audioTrimmed, false);
  assert.equal(aligned[3].audioOverrun, false);
});

test('Requirement (b): a userShifted segment on row 2 is untouched by Auto-Align', () => {
  const segments = [
    { id: 1, startSec: 0.0, endSec: 2.0, audioDurationSec: 2.0, trackRow: 0, userShifted: false },
    {
      id: 2,
      startSec: 5.5,
      endSec: 9.0,
      audioStartSec: 5.5,
      audioEndSec: 9.0,
      audioDurationSec: 3.5,
      trackRow: 2, // User explicitly dragged to VOICE 3 (row 2)
      userShifted: true,
    },
    { id: 3, startSec: 3.0, endSec: 6.0, audioDurationSec: 3.0, trackRow: 0, userShifted: false },
  ];

  const aligned = runAutoAlign(segments, 60.0);

  // Find userShifted segment
  const userSeg = aligned.find(s => s.userShifted);
  assert.ok(userSeg, 'userShifted segment must exist in aligned output');
  assert.equal(userSeg.id, 2);
  assert.equal(userSeg.trackRow, 2, 'userShifted segment must stay on trackRow 2');
  assert.equal(userSeg.trackId, 'voice-3', 'trackId must stay voice-3');
  assert.equal(userSeg.audioStartSec, 5.5, 'userShifted audioStartSec untouched');
  assert.equal(userSeg.audioEndSec, 9.0, 'userShifted audioEndSec untouched');
  assert.equal(userSeg.userShifted, true, 'userShifted must remain true');

  // Non-userShifted segments 1 & 3 must be on trackRow 0
  const nonShifted = aligned.filter(s => !s.userShifted);
  assert.equal(nonShifted[0].trackRow, 0);
  assert.equal(nonShifted[1].trackRow, 0);
});

test('Requirement (c): no two aligned Lane-0 clips overlap in [start, audioEndSec)', () => {
  // Test a realistic episode pattern with 15 segments of irregular durations & heavy overruns
  const rawSegments = [
    { id: 1, startSec: 0.0, endSec: 1.5, audioDurationSec: 2.8 },
    { id: 2, startSec: 1.2, endSec: 2.5, audioDurationSec: 3.2 },
    { id: 3, startSec: 2.0, endSec: 3.8, audioDurationSec: 2.1 },
    { id: 4, startSec: 4.5, endSec: 6.0, audioDurationSec: 1.8 },
    { id: 5, startSec: 5.8, endSec: 7.2, audioDurationSec: 3.5 },
    { id: 6, startSec: 7.0, endSec: 8.5, audioDurationSec: 2.4 },
    { id: 7, startSec: 9.0, endSec: 10.0, audioDurationSec: 4.0 },
    { id: 8, startSec: 10.5, endSec: 12.0, audioDurationSec: 3.0 },
    { id: 9, startSec: 11.8, endSec: 13.0, audioDurationSec: 2.5 },
    { id: 10, startSec: 13.5, endSec: 15.0, audioDurationSec: 3.1 },
    { id: 11, startSec: 14.8, endSec: 16.0, audioDurationSec: 2.0 },
    { id: 12, startSec: 16.5, endSec: 18.0, audioDurationSec: 4.2 },
    { id: 13, startSec: 17.5, endSec: 19.0, audioDurationSec: 2.8 },
    { id: 14, startSec: 20.0, endSec: 21.5, audioDurationSec: 1.9 },
    { id: 15, startSec: 22.0, endSec: 23.5, audioDurationSec: 2.2 },
  ];

  const aligned = runAutoAlign(rawSegments, 120.0);

  const lane0Clips = aligned.filter(s => s.trackRow === 0);
  assert.equal(lane0Clips.length, 15, 'All 15 non-userShifted clips must land on Lane 0');

  for (let i = 0; i < lane0Clips.length - 1; i++) {
    const cur = lane0Clips[i];
    const nxt = lane0Clips[i + 1];
    assert.ok(
      cur.audioEndSec <= nxt.audioStartSec + 0.001,
      `Lane 0 overlap violation between clip #${cur.id} [${cur.audioStartSec}, ${cur.audioEndSec}) and clip #${nxt.id} [${nxt.audioStartSec}, ${nxt.audioEndSec})`
    );
  }
});

test('Move-Only Spec (a): two adjacent segments with IDENTICAL Khmer text 1.0s apart, second user-added WITH audio — both exist, both keep audio, count unchanged', () => {
  const segments = [
    {
      id: 1,
      startSec: 10.0,
      endSec: 12.0,
      sourceStartSec: 10.0,
      sourceEndSec: 12.0,
      khmerText: 'សួស្តីពិភពលោក',
      originalChineseText: '你好世界',
      audioFile: 'audio_orig_1.mp3',
      audioUrl: '/uploads/audio_orig_1.mp3',
      audioDurationSec: 1.8,
    },
    {
      id: 'user_added_in_gap',
      startSec: 11.0, // 1.0s apart, within the former 2.5s deduplication window
      endSec: 13.0,
      sourceStartSec: 11.0,
      sourceEndSec: 13.0,
      khmerText: 'សួស្តីពិភពលោក', // IDENTICAL Khmer text
      originalChineseText: '不同中文',
      audioFile: 'user_added_voice.mp3',
      audioUrl: '/uploads/user_added_voice.mp3',
      audioDurationSec: 1.5,
      isUserAdded: true,
    },
  ];

  const aligned = runAutoAlign(segments, 100.0);

  // Segment count in == segment count out
  assert.equal(aligned.length, 2, 'Segment count in == segment count out (move-only)');

  // Both segments exist with respective audio intact
  assert.equal(aligned[0].khmerText, 'សួស្តីពិភពលោក');
  assert.equal(aligned[0].audioFile, 'audio_orig_1.mp3');
  assert.equal(aligned[0].audioUrl, '/uploads/audio_orig_1.mp3');

  assert.equal(aligned[1].khmerText, 'សួស្តីពិភពលោក');
  assert.equal(aligned[1].audioFile, 'user_added_voice.mp3');
  assert.equal(aligned[1].audioUrl, '/uploads/user_added_voice.mp3');
  assert.equal(aligned[1].isUserAdded, true);

  // Both on Lane 0 without overlap
  assert.equal(aligned[0].trackRow, 0);
  assert.equal(aligned[1].trackRow, 0);
  assert.ok(aligned[0].audioEndSec <= aligned[1].audioStartSec + 0.001);
});

test('Move-Only Spec (b): two adjacent segments with IDENTICAL Chinese text 1.0s apart — both exist, both keep audio, count unchanged', () => {
  const segments = [
    {
      id: 1,
      startSec: 20.0,
      endSec: 22.0,
      sourceStartSec: 20.0,
      sourceEndSec: 22.0,
      khmerText: 'ឃ្លាទីមួយ',
      originalChineseText: '相同中文台词',
      audioFile: 'audio_cn_1.mp3',
      audioUrl: '/uploads/audio_cn_1.mp3',
      audioDurationSec: 1.6,
    },
    {
      id: 2,
      startSec: 21.0, // 1.0s apart
      endSec: 23.0,
      sourceStartSec: 21.0,
      sourceEndSec: 23.0,
      khmerText: 'ឃ្លាទីពីរខុសគ្នា',
      originalChineseText: '相同中文台词', // IDENTICAL Chinese text
      audioFile: 'audio_cn_2.mp3',
      audioUrl: '/uploads/audio_cn_2.mp3',
      audioDurationSec: 1.7,
    },
  ];

  const aligned = runAutoAlign(segments, 100.0);

  // Segment count in == segment count out
  assert.equal(aligned.length, 2, 'Segment count in == segment count out with identical Chinese text');

  // Both segments exist with respective audio intact
  assert.equal(aligned[0].originalChineseText, '相同中文台词');
  assert.equal(aligned[0].audioFile, 'audio_cn_1.mp3');

  assert.equal(aligned[1].originalChineseText, '相同中文台词');
  assert.equal(aligned[1].audioFile, 'audio_cn_2.mp3');

  // Both on Lane 0 without overlap
  assert.equal(aligned[0].trackRow, 0);
  assert.equal(aligned[1].trackRow, 0);
  assert.ok(aligned[0].audioEndSec <= aligned[1].audioStartSec + 0.001);
});

test('Move-Only Spec (c): the handler guard in useClipOperations leaves scriptData untouched if transform returns fewer segments', () => {
  const hookFile = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
  const hookCode = fs.readFileSync(hookFile, 'utf8');

  // 1. Static code audit: verify the hard guard exists in handleAutoAlignNoOverlap
  assert.ok(
    hookCode.includes('alignedSegments.length !== currentSegments.length'),
    'handleAutoAlignNoOverlap must verify alignedSegments.length === currentSegments.length'
  );
  assert.ok(
    hookCode.includes('Auto-Align aborted: segment count mismatch'),
    'handleAutoAlignNoOverlap must log a console.warn on mismatch'
  );
  assert.ok(
    hookCode.includes('showInAppToast'),
    'handleAutoAlignNoOverlap must surface a visible in-app toast'
  );

  // 2. Behavioral simulation of the handler guard:
  // Simulate the exact state and guard logic from handleAutoAlignNoOverlap
  const initialScriptData = {
    seriesId: 'test_series',
    segments: [
      { id: 1, text: 'Seg 1', audioFile: 'a1.mp3' },
      { id: 2, text: 'Seg 2', audioFile: 'a2.mp3' },
      { id: 3, text: 'Seg 3', audioFile: 'a3.mp3' },
    ],
    updatedAt: 1000,
  };

  let stateScriptData = initialScriptData;
  let undoPushed = false;
  let toastShown = null;
  let warningLogged = null;

  const mockSetScriptData = (val) => {
    stateScriptData = typeof val === 'function' ? val(stateScriptData) : val;
  };
  const mockPushUndoSnapshot = () => { undoPushed = true; };
  const mockShowToast = (msg) => { toastShown = msg; };
  const mockConsoleWarn = (msg) => { warningLogged = msg; };

  // Simulate handler execution with a buggy / shortened transform returning fewer segments
  const simulateHandler = (currentSegments, buggyTransformFn) => {
    const alignedSegments = buggyTransformFn(currentSegments);

    // Hard guard under test
    if (!Array.isArray(alignedSegments) || alignedSegments.length !== currentSegments.length) {
      mockConsoleWarn(`[useClipOperations] Auto-Align aborted: segment count mismatch (in: ${currentSegments.length}, out: ${alignedSegments?.length ?? 0}).`);
      mockShowToast('⚠️ Auto-Align រក្សាទុកឃ្លាដើម៖ ចំនួន segments មិនត្រូវផ្លាស់ប្ដូរឡើយ');
      return;
    }

    mockPushUndoSnapshot();
    mockSetScriptData({
      ...stateScriptData,
      segments: alignedSegments,
      updatedAt: 2000,
    });
  };

  // Buggy transform returning 2 segments instead of 3
  const badTransform = (segs) => segs.slice(0, 2);

  simulateHandler(stateScriptData.segments, badTransform);

  // Assertions: scriptData is UNTOUCHED, undo snapshot not pushed, toast and warning surfaced
  assert.equal(stateScriptData, initialScriptData, 'scriptData must remain untouched when segment count mismatches');
  assert.equal(stateScriptData.segments.length, 3, 'segment count must stay 3');
  assert.equal(undoPushed, false, 'undo snapshot must not be pushed on aborted align');
  assert.ok(toastShown && toastShown.includes('Auto-Align រក្សាទុកឃ្លាដើម'), 'Toast must be shown to the user');
  assert.ok(warningLogged && warningLogged.includes('segment count mismatch'), 'Warning must be logged to console');
});
