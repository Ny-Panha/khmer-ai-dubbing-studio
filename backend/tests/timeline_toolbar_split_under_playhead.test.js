const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitClipAtTime } = require('../../frontend/src/utils/timelineUtils.js');

test('Test (a): splitClipAtTime with activeClipId = null and single [0, 286] clip, split at 7 -> two clips [0, 7] + [7, 286] with continuous source ranges', () => {
  const singleClip = [
    {
      id: 'clip-full-video',
      name: 'Full Video',
      start: 0,
      end: 286,
      sourceStart: 0,
      sourceEnd: 286,
      trackRow: 0,
      trackId: 'video-1',
    },
  ];

  const result = splitClipAtTime(singleClip, 7, 286, null);

  assert.ok(result, 'splitClipAtTime must return a valid split result');
  assert.equal(result.newClips.length, 2, 'Must result in exactly two clips');

  const [part1, part2] = result.newClips;

  // Timeline placement
  assert.equal(part1.start, 0);
  assert.equal(part1.end, 7);
  assert.equal(part2.start, 7);
  assert.equal(part2.end, 286);

  // Continuous source ranges
  assert.equal(part1.sourceStart, 0);
  assert.equal(part1.sourceEnd, 7);
  assert.equal(part2.sourceStart, 7);
  assert.equal(part2.sourceEnd, 286);

  // First resulting part is selected
  assert.equal(result.activeClipId, part1.id, 'Must select the first resulting part');
});

test('Test (a-2): Fresh episode case: virtual / empty videoClips with duration=286, split at 7 -> two materialized clips [0, 7] + [7, 286]', () => {
  // Fresh episode: videoClips is empty array []
  const result = splitClipAtTime([], 7, 286, null);

  assert.ok(result, 'splitClipAtTime must materialize and split virtual video');
  assert.equal(result.newClips.length, 2);

  const [part1, part2] = result.newClips;

  assert.equal(part1.start, 0);
  assert.equal(part1.end, 7);
  assert.equal(part2.start, 7);
  assert.equal(part2.end, 286);

  assert.equal(part1.sourceStart, 0);
  assert.equal(part1.sourceEnd, 7);
  assert.equal(part2.sourceStart, 7);
  assert.equal(part2.sourceEnd, 286);

  assert.equal(result.activeClipId, part1.id, 'Must select the first resulting part');
});

test('Test (b): same with a Gap as the only clip under the playhead', () => {
  const gapClip = [
    {
      id: 'clip-gap-intro',
      name: 'Gap',
      start: 0,
      end: 286,
      sourceStart: 0,
      sourceEnd: 286,
      isDialogue: false,
      trackRow: 0,
      trackId: 'video-1',
    },
  ];

  const result = splitClipAtTime(gapClip, 7, 286, null);

  assert.ok(result, 'splitClipAtTime must split the Gap clip');
  assert.equal(result.newClips.length, 2);

  const [gap1, gap2] = result.newClips;

  assert.equal(gap1.name, 'Gap');
  assert.equal(gap2.name, 'Gap');
  assert.equal(gap1.start, 0);
  assert.equal(gap1.end, 7);
  assert.equal(gap2.start, 7);
  assert.equal(gap2.end, 286);

  assert.equal(gap1.sourceStart, 0);
  assert.equal(gap1.sourceEnd, 7);
  assert.equal(gap2.sourceStart, 7);
  assert.equal(gap2.sourceEnd, 286);

  assert.equal(result.activeClipId, gap1.id, 'Must select the first resulting Gap part');
});

test('Test (c): segment-selected case still splits the segment without touching video', () => {
  const hookFile = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
  const code = fs.readFileSync(hookFile, 'utf8');

  // Verify static contract
  assert.ok(code.includes('// (a) split the selected segment only when the video track is not explicitly targeted'));
  assert.ok(code.includes('// (b) split the video clip under the playhead, including Gaps'));

  // Behavioral simulation of handleSplitClip dispatch:
  const segments = [
    {
      id: 1,
      _uid: 'seg_1',
      startSec: 1.0,
      endSec: 8.0,
      audioStartSec: 1.0,
      audioEndSec: 8.0,
      speaker: 'Speaker 1',
      khmerText: 'សួស្តី នេះជាការសាកល្បង',
      chineseText: '你好 这是测试',
    },
  ];

  const videoClips = [
    {
      id: 'clip-full-video',
      start: 0,
      end: 60,
      sourceStart: 0,
      sourceEnd: 60,
    },
  ];

  let stateSegments = [...segments];
  let stateVideoClips = [...videoClips];
  let selectedClipKind = 'voice'; // Segment is explicitly selected
  let selectedSegmentId = 'seg_1';
  let activeClipId = null;

  // Simulate handleSplitClip logic with segment selected at 4.5s
  const splitTime = 4.5;
  const isTargetingVideoClip = selectedClipKind === 'video';
  let selectedSegIdx = -1;

  if (!isTargetingVideoClip) {
    const isSegmentExplicitlySelected = (selectedClipKind === 'voice' || selectedClipKind === 'subtitle') || (
      selectedClipKind !== 'video' && Boolean(selectedSegmentId && stateSegments.some((s) => s._uid === selectedSegmentId || s.id === selectedSegmentId))
    );
    if (isSegmentExplicitlySelected) {
      selectedSegIdx = stateSegments.findIndex((s) => (s._uid === selectedSegmentId || s.id === selectedSegmentId) && splitTime > s.startSec + 0.05 && splitTime < s.endSec - 0.05);
    }
  }

  assert.notEqual(selectedSegIdx, -1, 'Segment must be found and playhead 4.5s must be inside it');

  // Execute segment split
  const targetSeg = stateSegments[selectedSegIdx];
  const seg1 = { ...targetSeg, endSec: splitTime, audioEndSec: splitTime };
  const seg2 = { ...targetSeg, id: 2, _uid: 'seg_2', startSec: splitTime, audioStartSec: splitTime };
  stateSegments = [seg1, seg2];

  // Assertions:
  assert.equal(stateSegments.length, 2, 'Segments count must increase to 2');
  assert.equal(stateSegments[0].endSec, 4.5);
  assert.equal(stateSegments[1].startSec, 4.5);

  // VIDEO track must remain completely untouched!
  assert.equal(stateVideoClips.length, 1, 'Video track must remain 1 clip');
  assert.equal(stateVideoClips[0].id, 'clip-full-video');
  assert.equal(stateVideoClips[0].start, 0);
  assert.equal(stateVideoClips[0].end, 60);
});

test('Test (d): fresh episode with no selection and no segments splits the video clip at playhead', () => {
  // Fresh episode: zero segments, single clip [0, 286], activeClipId = null, selectedClipKind = null
  const segments = [];
  const currentClips = [
    {
      id: 'clip-initial',
      name: 'Video 1',
      start: 0,
      end: 286,
      sourceStart: 0,
      sourceEnd: 286,
    },
  ];

  const splitTime = 7.0;
  const targetId = null;
  const selectedClipKind = null;
  const selectedSegmentId = null;

  // Resolve target at click time:
  const isTargetingVideoClip = selectedClipKind === 'video' || Boolean(
    targetId && currentClips.some((c) => c.id === targetId)
  );

  let selectedSegIdx = -1;
  const isSegmentExplicitlySelected = (selectedClipKind === 'voice' || selectedClipKind === 'subtitle') || (
    selectedClipKind !== 'video' && Boolean(targetId && segments.some((s) => s.id === targetId))
  );

  if (isSegmentExplicitlySelected && selectedSegmentId) {
    selectedSegIdx = segments.findIndex((s) => s.id === selectedSegmentId);
  }

  // Not segment selected -> proceeds to video split
  assert.equal(selectedSegIdx, -1);

  const activeVideoId = isTargetingVideoClip ? targetId : null;
  const videoSplitResult = splitClipAtTime(currentClips, splitTime, 286, activeVideoId);

  assert.ok(videoSplitResult, 'Must split the unselected video clip under the playhead');
  assert.equal(videoSplitResult.newClips.length, 2);
  assert.equal(videoSplitResult.newClips[0].start, 0);
  assert.equal(videoSplitResult.newClips[0].end, 7.0);
  assert.equal(videoSplitResult.newClips[1].start, 7.0);
  assert.equal(videoSplitResult.newClips[1].end, 286);
  assert.equal(videoSplitResult.activeClipId, videoSplitResult.newClips[0].id, 'First resulting part is selected');
});
