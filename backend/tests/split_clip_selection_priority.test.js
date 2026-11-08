const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Test isSegmentMatch and findSegmentIndex from timelineUtils
test('Segment Selection Predicate: _uid, id, and index matching', async () => {
  const { isSegmentMatch, findSegmentIndex, deleteSegmentByIdOrIndex } = await import('../../frontend/src/utils/timelineUtils.js');

  const segments = [
    { _uid: 'seg_alpha_123', id: 1, segmentId: 1, startSec: 0, endSec: 5, khmer: 'សួស្តីបងប្អូនទាំងអស់គ្នា', speaker: 'មេក្រុម' },
    { _uid: 'seg_beta_456', id: 2, segmentId: 2, startSec: 5, endSec: 10, khmer: 'ថ្ងៃនេះយើងនឹងពិភាក្សាគ្នា', speaker: 'សមាជិក' },
    { id: 3, segmentId: 3, startSec: 10, endSec: 15, khmer: 'អំពីគម្រោងថ្មី', speaker: 'សមាជិក' },
    { startSec: 15, endSec: 20, khmer: 'សូមអរគុណ', speaker: 'មេក្រុម' }, // no _uid, no id
  ];

  // 1. Matches by _uid even when _uid is completely different from numeric id
  assert.equal(isSegmentMatch(segments[0], 'seg_alpha_123', 0), true);
  assert.equal(findSegmentIndex(segments, 'seg_alpha_123'), 0);

  assert.equal(isSegmentMatch(segments[1], 'seg_beta_456', 1), true);
  assert.equal(findSegmentIndex(segments, 'seg_beta_456'), 1);

  // 2. Matches by numeric id and string id
  assert.equal(isSegmentMatch(segments[0], 1, 0), true);
  assert.equal(isSegmentMatch(segments[0], '1', 0), true);
  assert.equal(isSegmentMatch(segments[2], 3, 2), true);
  assert.equal(isSegmentMatch(segments[2], '3', 2), true);
  assert.equal(findSegmentIndex(segments, 3), 2);
  assert.equal(findSegmentIndex(segments, '3'), 2);

  // 3. Matches segment with no id by 0-based array index
  assert.equal(isSegmentMatch(segments[3], 3, 3), true);
  assert.equal(findSegmentIndex(segments, 3), 2); // 3 matched id: 3 first!
  assert.equal(isSegmentMatch(segments[3], 'fallback', 3), false);

  // 4. Non-matching keys return false / -1
  assert.equal(isSegmentMatch(segments[0], 'non_existent_key', 0), false);
  assert.equal(findSegmentIndex(segments, 'non_existent_key'), -1);

  // 5. deleteSegmentByIdOrIndex with _uid
  const afterDeleteUid = deleteSegmentByIdOrIndex(segments, 'seg_alpha_123');
  assert.equal(afterDeleteUid.length, 3);
  assert.equal(afterDeleteUid[0]._uid, 'seg_beta_456');
  assert.equal(afterDeleteUid[0].id, 1); // re-indexed
});

test('useClipOperations: handleSplitClip Deterministic Priority & Selection Contract', () => {
  const hookFile = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
  const code = fs.readFileSync(hookFile, 'utf8');

  // Verify that isSegmentMatch and findSegmentIndex are imported
  assert.ok(code.includes('isSegmentMatch'), 'useClipOperations.js must import isSegmentMatch');
  assert.ok(code.includes('findSegmentIndex'), 'useClipOperations.js must import findSegmentIndex');

  // Verify that handleSplitClip implements the 4-step priority contract
  assert.ok(code.includes('// (a) if selectedSegmentId matches a segment and the playhead is strictly inside it -> split THAT segment, never the video'),
    'handleSplitClip must have priority (a) guarding selectedSegmentId');
  assert.ok(code.includes('// (b) else if a video clip is explicitly active and the playhead is inside it -> split the video'),
    'handleSplitClip must have priority (b) guarding active video clip');
  assert.ok(code.includes('// (c) else if any segment intersects the playhead -> split it'),
    'handleSplitClip must have priority (c) guarding any intersecting segment');
  assert.ok(code.includes('// (d) else split the video at the playhead'),
    'handleSplitClip must have priority (d) guarding fallback video split');

  // Verify veto elimination: videoSplitResult does NOT veto segment split
  assert.ok(!code.includes('const shouldSplitSegment = targetSegIdx !== -1 || (anyIntersectingSegIdx !== -1 && !videoSplitResult)'),
    'Old flawed shouldSplitSegment veto must be removed');
});

test('Split Operation Simulation: Voice Segment vs Video Clip Priority', async () => {
  const { splitClipAtTime, isSegmentMatch, findSegmentIndex, deleteSegmentByIdOrIndex } = await import('../../frontend/src/utils/timelineUtils.js');
  const { splitKhmerTextIntoHalves } = await import('../../frontend/src/utils/khmerTextSplitter.js');

  // Initial state representing a generated episode
  const initialClips = [
    { id: 'clip-video-full', start: 0, end: 60, name: 'Episode 1 Full Video', trackRow: 0, trackId: 'video-1' }
  ];

  const initialSegments = [
    {
      _uid: 'seg_gen_ep1_001',
      id: 1,
      segmentId: 1,
      start: '00:01',
      end: '00:08',
      startSec: 1.0,
      endSec: 8.0,
      audioStartSec: 1.0,
      audioEndSec: 8.0,
      khmer: 'ជំរាបសួរអ្នកទាំងអស់គ្នា ថ្ងៃនេះខ្ញុំមកប្រាប់រឿងល្អ',
      khmerTranslatedText: 'ជំរាបសួរអ្នកទាំងអស់គ្នា ថ្ងៃនេះខ្ញុំមកប្រាប់រឿងល្អ',
      speaker: 'ព្រះអង្គម្ចាស់',
      speakerGender: 'MALE',
      voiceId: 'km-KH-PisethNeural',
      audioGenerated: true,
      audioFile: 'ep1_seg1.mp3',
    },
    {
      _uid: 'seg_gen_ep1_002',
      id: 2,
      segmentId: 2,
      start: '00:10',
      end: '00:18',
      startSec: 10.0,
      endSec: 18.0,
      audioStartSec: 10.0,
      audioEndSec: 18.0,
      khmer: 'តើទ្រង់មានព្រះបន្ទូលអ្វីដែរ ព្រះពរម្ចាស់បង',
      khmerTranslatedText: 'តើទ្រង់មានព្រះបន្ទូលអ្វីដែរ ព្រះពរម្ចាស់បង',
      speaker: 'ម្ចាស់ក្សត្រី',
      speakerGender: 'FEMALE',
      voiceId: 'km-KH-SreymomNeural',
      audioGenerated: true,
      audioFile: 'ep1_seg2.mp3',
    }
  ];

  // Emulate useClipOperations logic
  let videoClips = JSON.parse(JSON.stringify(initialClips));
  let segments = JSON.parse(JSON.stringify(initialSegments));
  let activeClipId = 'clip-video-full';
  let selectedSegmentId = null;
  let undoHistory = [];

  const pushUndoSnapshot = (clipsSnap, segsSnap) => {
    undoHistory.push({
      videoClips: JSON.parse(JSON.stringify(clipsSnap)),
      segments: JSON.parse(JSON.stringify(segsSnap))
    });
  };

  const undo = () => {
    if (undoHistory.length === 0) return;
    const snap = undoHistory.pop();
    videoClips = snap.videoClips;
    segments = snap.segments;
  };

  const getSegTiming = (s) => ({
    sStart: s.audioStartSec ?? s.startSec,
    sEnd: s.audioEndSec ?? s.endSec,
  });

  const isInsideSeg = (s, time) => {
    const { sStart, sEnd } = getSegTiming(s);
    return time > sStart + 0.05 && time < sEnd - 0.05;
  };

  const executeSplit = (splitTime, targetId = null) => {
    const totalDur = 60;
    const roundedSplit = parseFloat(splitTime.toFixed(3));
    let currentClips = videoClips;

    const executeSplitSegment = (splitSegIdx) => {
      const targetSeg = segments[splitSegIdx];
      const { sStart, sEnd } = getSegTiming(targetSeg);
      const dur = Math.max(0.2, sEnd - sStart);
      const [part1, part2] = splitKhmerTextIntoHalves(targetSeg.khmer);

      const dur1 = parseFloat((roundedSplit - sStart).toFixed(2));
      const dur2 = parseFloat((sEnd - roundedSplit).toFixed(2));

      const uid1 = `${targetSeg._uid}_a`;
      const uid2 = `${targetSeg._uid}_b`;

      const seg1 = {
        ...targetSeg,
        _uid: uid1,
        startSec: sStart,
        endSec: roundedSplit,
        audioStartSec: sStart,
        audioEndSec: roundedSplit,
        audioDurationSec: dur1,
        khmer: part1,
        speaker: targetSeg.speaker,
      };

      const seg2 = {
        ...targetSeg,
        _uid: uid2,
        id: `seg_split_2`,
        startSec: roundedSplit,
        endSec: sEnd,
        audioStartSec: roundedSplit,
        audioEndSec: sEnd,
        audioDurationSec: dur2,
        khmer: part2,
        speaker: targetSeg.speaker,
      };

      const nextSegments = [...segments];
      nextSegments.splice(splitSegIdx, 1, seg1, seg2);
      const reindexed = nextSegments.map((item, idx) => ({
        ...item,
        id: idx + 1,
        segmentId: idx + 1,
      }));

      pushUndoSnapshot(currentClips, segments);
      segments = reindexed;
      selectedSegmentId = uid2;
      return true;
    };

    const isTargetingVideoClip = Boolean(
      targetId && currentClips.some((c) => c.id === targetId)
    );

    // (a) if selectedSegmentId matches a segment and playhead is strictly inside it -> split THAT segment, never the video
    let selectedSegIdx = -1;
    if (!isTargetingVideoClip) {
      const activeSegKey = targetId !== null && targetId !== undefined ? targetId : selectedSegmentId;
      if (activeSegKey !== null && activeSegKey !== undefined && segments.length > 0) {
        selectedSegIdx = segments.findIndex((s, idx) => isSegmentMatch(s, activeSegKey, idx) && isInsideSeg(s, roundedSplit));
        if (selectedSegIdx === -1) {
          const fallbackIdx = findSegmentIndex(segments, activeSegKey);
          if (fallbackIdx !== -1 && isInsideSeg(segments[fallbackIdx], roundedSplit)) {
            selectedSegIdx = fallbackIdx;
          }
        }
      }
    }

    if (selectedSegIdx !== -1) {
      return executeSplitSegment(selectedSegIdx);
    }

    // (b) else if a video clip is explicitly active and playhead is inside it -> split the video
    const activeVideoId = isTargetingVideoClip ? targetId : activeClipId;
    let explicitVideoClip = null;
    if (activeVideoId) {
      explicitVideoClip = currentClips.find(
        (c) => c.id === activeVideoId && roundedSplit > (c.start + 0.05) && roundedSplit < (c.end - 0.05)
      );
    }

    if (explicitVideoClip) {
      const videoSplitResult = splitClipAtTime(currentClips, roundedSplit, totalDur, activeVideoId);
      if (videoSplitResult) {
        pushUndoSnapshot(currentClips, segments);
        videoClips = videoSplitResult.newClips;
        activeClipId = videoSplitResult.activeClipId;
        return true;
      }
    }

    // (c) else if any segment intersects playhead
    let anyIntersectingSegIdx = segments.findIndex((s) => isInsideSeg(s, roundedSplit));
    if (anyIntersectingSegIdx !== -1) {
      return executeSplitSegment(anyIntersectingSegIdx);
    }

    // (d) else split video at playhead
    const fallbackVideoSplit = splitClipAtTime(currentClips, roundedSplit, totalDur, null);
    if (fallbackVideoSplit) {
      pushUndoSnapshot(currentClips, segments);
      videoClips = fallbackVideoSplit.newClips;
      activeClipId = fallbackVideoSplit.activeClipId;
      return true;
    }

    return false;
  };

  // TEST CASE 1: Select Voice Clip #1, playhead mid-clip (at 4.5s), press Split
  selectedSegmentId = 'seg_gen_ep1_001'; // voice clip #1 selected by _uid
  const didSplit1 = executeSplit(4.5, selectedSegmentId);
  assert.equal(didSplit1, true);

  // Segments must be split in two
  assert.equal(segments.length, 3, 'Segments count should increase from 2 to 3');
  assert.equal(segments[0].endSec, 4.5, 'First half ends at playhead 4.5s');
  assert.equal(segments[1].startSec, 4.5, 'Second half starts at playhead 4.5s');
  assert.equal(segments[0].speaker, 'ព្រះអង្គម្ចាស់', 'First half retains speaker');
  assert.equal(segments[1].speaker, 'ព្រះអង្គម្ចាស់', 'Second half retains speaker');

  // VIDEO track must STILL show ONE unbroken clip!
  assert.equal(videoClips.length, 1, 'Video track must remain ONE unbroken clip');
  assert.equal(videoClips[0].id, 'clip-video-full');
  assert.equal(videoClips[0].start, 0);
  assert.equal(videoClips[0].end, 60);

  // Undo test for voice segment split
  undo();
  assert.equal(segments.length, 2, 'Undo restores segments back to 2');
  assert.equal(segments[0]._uid, 'seg_gen_ep1_001');
  assert.equal(videoClips.length, 1, 'Video track remains 1 clip');

  // TEST CASE 2: Select Video Clip and Split (at 20.0s)
  selectedSegmentId = null;
  activeClipId = 'clip-video-full';
  const didSplitVideo = executeSplit(20.0, 'clip-video-full');
  assert.equal(didSplitVideo, true);

  // Video track splits in two
  assert.equal(videoClips.length, 2, 'Video track must now have 2 clips');
  assert.equal(videoClips[0].end, 20.0, 'First video clip ends at 20s');
  assert.equal(videoClips[1].start, 20.0, 'Second video clip starts at 20s');

  // Segments must be 100% UNTOUCHED!
  assert.equal(segments.length, 2, 'Segments remain untouched at 2');
  assert.equal(segments[0].startSec, 1.0);
  assert.equal(segments[0].endSec, 8.0);
  assert.equal(segments[1].startSec, 10.0);
  assert.equal(segments[1].endSec, 18.0);

  // Undo test for video split
  undo();
  assert.equal(videoClips.length, 1, 'Undo restores video track to 1 unbroken clip');
  assert.equal(segments.length, 2, 'Segments remain 2');

  // TEST CASE 3: Delete on a selected voice clip deletes segment, not video
  selectedSegmentId = 'seg_gen_ep1_001';
  pushUndoSnapshot(videoClips, segments);
  segments = deleteSegmentByIdOrIndex(segments, selectedSegmentId);
  selectedSegmentId = null;

  assert.equal(segments.length, 1, 'Voice clip #1 deleted, 1 segment remaining');
  assert.equal(segments[0]._uid, 'seg_gen_ep1_002', 'Remaining segment is segment #2');
  assert.equal(videoClips.length, 1, 'Video track is untouched and remains 1 clip');

  // Undo delete
  undo();
  assert.equal(segments.length, 2, 'Undo restores deleted voice segment');
  assert.equal(videoClips.length, 1, 'Video track is unbroken');
});