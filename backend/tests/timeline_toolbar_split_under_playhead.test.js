const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitClip, splitSegment } = require('../../frontend/src/utils/timelineOps.js');

test('Test (a): splitClip with activeClipId = null and single [0, 286] clip, split at 7 -> two clips [0, 7] + [7, 286] with continuous source ranges', () => {
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

  const result = splitClip({ videoClips: singleClip, segments: [] }, { splitTime: 7, totalDuration: 286, activeClipId: null });

  assert.ok(result && result.applied, 'splitClip must return a valid split result');
  assert.equal(result.state.videoClips.length, 2, 'Must result in exactly two clips');

  const [part1, part2] = result.state.videoClips;

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
  const result = splitClip({ videoClips: [], segments: [] }, { splitTime: 7, totalDuration: 286, activeClipId: null });

  assert.ok(result && result.applied, 'splitClip must materialize and split virtual video');
  assert.equal(result.state.videoClips.length, 2);

  const [part1, part2] = result.state.videoClips;

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

  const result = splitClip({ videoClips: gapClip, segments: [] }, { splitTime: 7, totalDuration: 286, activeClipId: null });

  assert.ok(result && result.applied, 'splitClip must split the Gap clip');
  assert.equal(result.state.videoClips.length, 2);

  const [gap1, gap2] = result.state.videoClips;

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
  assert.ok(code.includes('timelineOps.splitSegment') || code.includes('splitSegment'));

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

  // Execute segment split via timelineOps.splitSegment
  const splitResult = splitSegment({ videoClips, segments }, { segKey: 'seg_1', splitTime: 4.5 });
  assert.ok(splitResult && splitResult.applied, 'splitSegment must return applied: true');

  const { videoClips: nextClips, segments: nextSegments } = splitResult.state;

  // Assertions:
  assert.equal(nextSegments.length, 2, 'Segments count must increase to 2');
  assert.equal(nextSegments[0].endSec, 4.5);
  assert.equal(nextSegments[1].startSec, 4.5);

  // VIDEO track must remain completely untouched!
  assert.equal(nextClips.length, 1, 'Video track must remain 1 clip');
  assert.equal(nextClips[0].id, 'clip-full-video');
  assert.equal(nextClips[0].start, 0);
  assert.equal(nextClips[0].end, 60);
});

test('Test (d): fresh episode with no selection and no segments splits the video clip at playhead', () => {
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

  const isTargetingVideoClip = selectedClipKind === 'video' || Boolean(
    targetId && currentClips.some((c) => c.id === targetId)
  );

  const activeVideoId = isTargetingVideoClip ? targetId : null;
  const videoSplitResult = splitClip({ videoClips: currentClips, segments }, { splitTime, totalDuration: 286, activeClipId: activeVideoId });

  assert.ok(videoSplitResult && videoSplitResult.applied, 'Must split the unselected video clip under the playhead');
  assert.equal(videoSplitResult.state.videoClips.length, 2);
  assert.equal(videoSplitResult.state.videoClips[0].start, 0);
  assert.equal(videoSplitResult.state.videoClips[0].end, 7.0);
  assert.equal(videoSplitResult.state.videoClips[1].start, 7.0);
  assert.equal(videoSplitResult.state.videoClips[1].end, 286);
  assert.equal(videoSplitResult.activeClipId, videoSplitResult.state.videoClips[0].id, 'First resulting part is selected');
});

test('Test (e): TimelineEditor and DubbingModeTab imports and references contract', () => {
  const timelineEditorSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');
  assert.ok(timelineEditorSrc.includes('isSegmentMatch'), 'TimelineEditor must import isSegmentMatch');
  assert.ok(timelineEditorSrc.includes('parseTimeToSeconds'), 'TimelineEditor must import parseTimeToSeconds');

  const dubbingModeTabSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/media/DubbingModeTab.jsx'), 'utf8');
  assert.ok(dubbingModeTabSrc.includes('activeSeries = null'), 'DubbingModeTab must accept activeSeries prop');
  assert.ok(dubbingModeTabSrc.includes('resolvedSeriesId = seriesId || activeSeries?.id || activeEpisode?.seriesId || episodeId'), 'DubbingModeTab must resolve seriesId safely without reference error');
});
