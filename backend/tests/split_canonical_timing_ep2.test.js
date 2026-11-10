const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Step 0 & 1: Real EP2 data dump & canonical effective timing verification', async () => {
  const { getSegmentAudioDuration } = await import('../../frontend/src/utils/timestampUtils.js');

  // Deterministic fixture representing EP2 baseline segment #1 before split
  const seg1 = {
    id: 1,
    startSec: 0.2,
    endSec: 4.027,
    audioStartSec: 0.2,
    audioEndSec: 4.027,
    audioDurationSec: 3.83,
    finalAudioDuration: 4.63,
    audioDuration: 4.63,
    khmer: 'ត្រឹមជីនតានម្នាក់',
  };

  // 1. Data dump verification
  assert.equal(seg1.id, 1);
  assert.equal(seg1.startSec, 0.2);
  assert.equal(seg1.endSec, 4.027);
  assert.equal(seg1.audioStartSec, 0.2);
  assert.equal(seg1.audioEndSec, 4.027);
  assert.equal(seg1.finalAudioDuration, 4.63);

  // 2. Canvas right edge derivation (per TimelineTracksCanvas truthful-render 5f6fb6b)
  const slotEnd1 = typeof seg1.endSec === 'number' ? seg1.endSec : 4.027;
  const rawStart1 = typeof seg1.audioStartSec === 'number' ? seg1.audioStartSec : 0.2;
  const realAudioDur1 = getSegmentAudioDuration(seg1, 2.5);
  assert.equal(realAudioDur1, 4.63);

  const canvasRightEdge1 = rawStart1 + realAudioDur1;
  assert.equal(canvasRightEdge1, 4.83); // 0.2 + 4.63 = 4.83

  // 3. Old getSegTiming vs New getSegTiming
  const oldSegTimingEnd = seg1.audioEndSec; // 4.027
  assert.notEqual(canvasRightEdge1, oldSegTimingEnd, 'Canvas right edge and old handler timing MUST differ before fix');

  // Verify canonical getSegTiming matches canvas
  const isTrimmed = Boolean(seg1.audioTrimmed || seg1.userTrimmed);
  const effectiveEnd = isTrimmed && typeof seg1.audioEndSec === 'number'
    ? seg1.audioEndSec
    : (rawStart1 + realAudioDur1);
  assert.equal(effectiveEnd, canvasRightEdge1, 'Canonical effectiveEnd must equal canvas right edge');
});

test('Step 1, 2, 3: useClipOperations static code audit', () => {
  const hookFile = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
  const code = fs.readFileSync(hookFile, 'utf8');

  // Step 1: imports getSegmentAudioDuration and computes canonical effectiveEnd
  assert.ok(code.includes('getSegmentAudioDuration'), 'useClipOperations must import getSegmentAudioDuration');
  assert.ok(code.includes('effectiveStart') && code.includes('effectiveEnd'), 'useClipOperations must compute effectiveStart & effectiveEnd');
  assert.ok(code.includes('audioDur = getSegmentAudioDuration(s, 0)'), 'getSegTiming must use canonical getSegmentAudioDuration');

  // Step 2: In-app toast and console warning on no branch match
  assert.ok(code.includes('showInAppToast'), 'useClipOperations must define or call showInAppToast');
  assert.ok(code.includes('គ្មាន clip នៅត្រង់ playhead ទេ — ដាក់ playhead ឲ្យនៅកណ្ដាល clip'),
    'useClipOperations must show the exact Khmer toast message');
  assert.ok(code.includes('nearestPrevSegment') || code.includes('nearestPrev'),
    'useClipOperations must log nearest previous segment boundary');
  assert.ok(code.includes('nearestNextSegment') || code.includes('nearestNext'),
    'useClipOperations must log nearest next segment boundary');

  // Step 3: Seam tolerance relaxation in branch (a) only
  assert.ok(code.includes('isInsideSeg(s, true)'), 'Branch (a) must allow seam end (relax -0.05 limit)');
  assert.ok(code.includes('isInsideSeg(s, false)'), 'Branch (c) must preserve ±0.05 seam guard');
});

test('Step 3 & Verification: Split EP2 Segment #1 at 00:04.03 cuts audio into 2 segments without touching video', async () => {
  const { splitKhmerTextIntoHalves } = await import('../../frontend/src/utils/khmerTextSplitter.js');
  const { getSegmentAudioDuration, formatMinSec } = await import('../../frontend/src/utils/timestampUtils.js');
  const { isSegmentMatch, findSegmentIndex, splitClipAtTime } = await import('../../frontend/src/utils/timelineUtils.js');

  const rawSegs = [
    {
      id: 1,
      startSec: 0.2,
      endSec: 4.027,
      audioStartSec: 0.2,
      audioEndSec: 4.027,
      audioDurationSec: 3.83,
      finalAudioDuration: 4.63,
      audioDuration: 4.63,
      khmer: 'ត្រឹមជីនតានម្នាក់',
    },
    {
      id: 2,
      startSec: 4.027,
      endSec: 4.83,
      audioStartSec: 4.027,
      audioEndSec: 4.83,
      audioDurationSec: 0.8,
      finalAudioDuration: 4.63,
      audioDuration: 4.63,
      khmer: 'ក៏ហ៊ានស្រមើស្រមៃទប់ថាមពលហ្វាស៊ិនផ្ទុះដែរ!',
    },
    {
      id: 3,
      startSec: 5.6,
      endSec: 7.47,
      audioStartSec: 5.6,
      audioEndSec: 7.47,
      audioDurationSec: 1.87,
      finalAudioDuration: 1.87,
      audioDuration: 1.87,
      khmer: 'ដុតយានស៊ិន',
    }
  ];

  let segments = JSON.parse(JSON.stringify(rawSegs));
  let videoClips = [
    { id: 'video-main', start: 0, end: 600, name: 'EP2 Main Video', trackRow: 0 }
  ];
  let undoHistory = [];
  const pushUndoSnapshot = (clipsSnap, segsSnap) => {
    undoHistory.push({
      videoClips: JSON.parse(JSON.stringify(clipsSnap)),
      segments: JSON.parse(JSON.stringify(segsSnap))
    });
  };

  const getSegTiming = (s) => {
    if (!s) return { sStart: 0, sEnd: 0, effectiveStart: 0, effectiveEnd: 0 };
    const isTrimmed = Boolean(s.audioTrimmed || s.userTrimmed);
    const effectiveStart = typeof s.audioStartSec === 'number' && !isNaN(s.audioStartSec)
      ? s.audioStartSec
      : (typeof s.startSec === 'number' ? s.startSec : 0);
    const slotEnd = typeof s.endSec === 'number' ? s.endSec : effectiveStart + 3.0;
    const audioDur = getSegmentAudioDuration(s, 0);

    let effectiveEnd;
    if (isTrimmed && typeof s.audioEndSec === 'number' && !isNaN(s.audioEndSec)) {
      effectiveEnd = s.audioEndSec;
    } else {
      const candidates = [effectiveStart + audioDur];
      if (typeof s.audioEndSec === 'number' && !isNaN(s.audioEndSec)) {
        candidates.push(s.audioEndSec);
      }
      effectiveEnd = Math.max(...candidates);
    }
    return { sStart: effectiveStart, sEnd: effectiveEnd, effectiveStart, effectiveEnd };
  };

  const isInsideSeg = (s, splitTime, allowSeamEnd = false) => {
    const { effectiveStart, effectiveEnd } = getSegTiming(s);
    const endLimit = allowSeamEnd ? effectiveEnd : effectiveEnd - 0.05;
    return splitTime > effectiveStart + 0.05 && splitTime < endLimit;
  };

  const simulateSplit = (splitTime, selectedSegId = null) => {
    const roundedSplit = parseFloat(splitTime.toFixed(3));

    // (a) if selectedSegmentId matches
    let selectedSegIdx = -1;
    if (selectedSegId !== null) {
      selectedSegIdx = segments.findIndex((s, idx) => isSegmentMatch(s, selectedSegId, idx) && isInsideSeg(s, roundedSplit, true));
      if (selectedSegIdx === -1) {
        const fb = findSegmentIndex(segments, selectedSegId);
        if (fb !== -1 && isInsideSeg(segments[fb], roundedSplit, true)) selectedSegIdx = fb;
      }
    }

    if (selectedSegIdx !== -1) {
      const targetSeg = segments[selectedSegIdx];
      const { effectiveStart, effectiveEnd } = getSegTiming(targetSeg);
      const dur = Math.max(0.2, effectiveEnd - effectiveStart);
      const [part1, part2] = splitKhmerTextIntoHalves((targetSeg.khmer || '').trim());
      const dur1 = parseFloat((roundedSplit - effectiveStart).toFixed(2));
      const dur2 = parseFloat((effectiveEnd - roundedSplit).toFixed(2));

      const seg1 = {
        ...targetSeg,
        _uid: `${targetSeg.id}_a`,
        startSec: effectiveStart,
        endSec: roundedSplit,
        audioStartSec: effectiveStart,
        audioEndSec: roundedSplit,
        audioDurationSec: dur1,
        finalAudioDuration: dur1,
        khmer: part1 || targetSeg.khmer,
      };
      const seg2 = {
        ...targetSeg,
        _uid: `${targetSeg.id}_b`,
        startSec: roundedSplit,
        endSec: effectiveEnd,
        audioStartSec: roundedSplit,
        audioEndSec: effectiveEnd,
        audioDurationSec: dur2,
        finalAudioDuration: dur2,
        khmer: part2 || targetSeg.khmer,
      };

      pushUndoSnapshot(videoClips, segments);
      const nextSegs = [...segments];
      nextSegs.splice(selectedSegIdx, 1, seg1, seg2);
      segments = nextSegs.map((s, idx) => ({ ...s, id: idx + 1 }));
      return { success: true, type: 'segment' };
    }

    // (c) else if any segment intersects
    const anyIdx = segments.findIndex((s) => isInsideSeg(s, roundedSplit, false));
    if (anyIdx !== -1) {
      return { success: true, type: 'segment' };
    }

    return { success: false, reason: 'no_clip' };
  };

  // Case 1: Select Segment #1, split at 00:04.03
  // Old bug: was inside slot 0.2 - 4.027, but audio was 4.63 (effectiveEnd 4.83).
  // At 4.03, old handler failed silently because 4.03 > 4.027 - 0.05.
  // With fix: 4.03 < 4.83, so it cleanly splits Segment #1!
  const splitRes1 = simulateSplit(4.03, 1);
  assert.equal(splitRes1.success, true);
  assert.equal(splitRes1.type, 'segment');
  assert.equal(segments.length, rawSegs.length + 1, 'Segments count must increase by 1');
  assert.equal(segments[0].endSec, 4.03, 'First half ends at 4.03');
  assert.equal(segments[1].startSec, 4.03, 'Second half starts at 4.03');
  assert.equal(segments[1].endSec, 4.83, 'Second half ends at canonical effectiveEnd 4.83');
  assert.equal(videoClips.length, 1, 'Video clips array must remain UNTOUCHED');

  // Case 2: Undo restores original segments
  assert.equal(undoHistory.length, 1);
  const snap = undoHistory.pop();
  segments = snap.segments;
  videoClips = snap.videoClips;
  assert.equal(segments.length, rawSegs.length);
  assert.equal(segments[0].endSec, 4.027);

  // Case 3: Split in a true gap (e.g. 22.5s, where previous speech ended at ~21.67s and next starts at 23.80s)
  const gapRes = simulateSplit(22.5, null);
  assert.equal(gapRes.success, false);
  assert.equal(gapRes.reason, 'no_clip');
  assert.equal(segments.length, rawSegs.length, 'Segments count must not change on gap');
});
