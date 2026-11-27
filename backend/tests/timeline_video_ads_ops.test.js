import test from 'node:test';
import assert from 'node:assert/strict';
import {
  insertVideoAd,
  deleteVideoAd,
  deleteVideoClip,
  trimClip,
  moveClip,
  splitClip,
  isAdClip,
  isGapClip,
} from '../../frontend/src/utils/timelineOps.js';

function makeStory300() {
  return {
    videoClips: [
      {
        id: 'clip-story-1',
        trackRow: 0,
        trackId: 'video-1',
        start: 0,
        end: 300,
        sourceStart: 0,
        sourceEnd: 300,
        duration: 300,
        name: 'ep_10_source.mp4',
        isDialogue: false,
      },
    ],
    segments: [
      {
        id: 1,
        sourceCueId: 'cue_0_1000_1',
        sourceStartSec: 10,
        sourceEndSec: 13,
        startSec: 10,
        endSec: 13,
        audioStartSec: 10,
        audioEndSec: 12.5,
        audioDurationSec: 2.5,
        start: '00:10.00',
        end: '00:13.00',
        audioStart: '00:10.00',
        audioEnd: '00:12.50',
        khmerText: 'សួស្តីមុនពាណិជ្ជកម្ម',
        originalChineseText: '广告前你好',
      },
      {
        id: 2,
        sourceCueId: 'cue_0_15000_2',
        sourceStartSec: 150,
        sourceEndSec: 154,
        startSec: 150,
        endSec: 154,
        audioStartSec: 150,
        audioEndSec: 153.2,
        audioDurationSec: 3.2,
        start: '02:30.00',
        end: '02:34.00',
        audioStart: '02:30.00',
        audioEnd: '02:33.20',
        khmerText: 'សួស្តីក្រោយពាណិជ្ជកម្ម',
        originalChineseText: '广告后你好',
      },
    ],
  };
}

test('insertVideoAd: inserts 15s ad at 120s into 300s episode -> 315s timeline with ripple shift & immutable sourceCueId', () => {
  const base = makeStory300();
  const res = insertVideoAd(base, {
    adClip: {
      videoUrl: '/uploads/sponsor/sponsor_15s.mp4',
      name: 'sponsor_15s.mp4',
      duration: 15,
      adVolume: 0.85,
      hasAudio: true,
    },
    insertTime: 120,
    totalDuration: 300,
    placement: 'manual',
  });

  assert.equal(res.applied, true);
  assert.equal(res.state.videoClips.length, 3);

  const [part1, ad, part2] = res.state.videoClips;
  assert.equal(part1.start, 0);
  assert.equal(part1.end, 120);
  assert.equal(part1.sourceStart, 0);
  assert.equal(part1.sourceEnd, 120);
  assert.equal(isAdClip(part1), false);

  assert.equal(ad.start, 120);
  assert.equal(ad.end, 135);
  assert.equal(ad.sourceStart, 0);
  assert.equal(ad.sourceEnd, 15);
  assert.equal(ad.adVolume, 0.85);
  assert.equal(isAdClip(ad), true);
  assert.equal(isGapClip(ad), false);

  assert.equal(part2.start, 135);
  assert.equal(part2.end, 315);
  assert.equal(part2.sourceStart, 120);
  assert.equal(part2.sourceEnd, 300);

  // Segments: seg 1 (at 10s) untouched; seg 2 (at 150s) shifted by +15s to 165s while preserving sourceCueId & sourceStartSec
  const [s1, s2] = res.state.segments;
  assert.equal(s1.startSec, 10);
  assert.equal(s1.audioStartSec, 10);
  assert.equal(s1.sourceCueId, 'cue_0_1000_1');

  assert.equal(s2.startSec, 165);
  assert.equal(s2.endSec, 169);
  assert.equal(s2.audioStartSec, 165);
  assert.equal(s2.audioEndSec, 168.2);
  assert.equal(s2.sourceCueId, 'cue_0_15000_2');
  assert.equal(s2.sourceStartSec, 150);
  assert.equal(s2.sourceEndSec, 154);
  assert.equal(s2.khmerText, 'សួស្តីក្រោយពាណិជ្ជកម្ម');
});

test('insertVideoAd: supports pre-roll, post-roll, multiple ads, and duplicate placement guard', () => {
  const base = makeStory300();
  const pre = insertVideoAd(base, {
    adClip: { videoUrl: '/uploads/sponsor/pre.mp4', name: 'pre.mp4', duration: 10 },
    placement: 'preroll',
    dedupePlacement: true,
    totalDuration: 300,
  });
  assert.equal(pre.applied, true);
  assert.equal(pre.state.videoClips[0].start, 0);
  assert.equal(pre.state.videoClips[0].end, 10);
  assert.equal(pre.state.videoClips[1].start, 10);
  assert.equal(pre.state.videoClips[1].end, 310);
  assert.equal(pre.state.segments[0].startSec, 20);
  assert.equal(pre.state.segments[1].startSec, 160);

  // Duplicate pre-roll guard
  const dup = insertVideoAd(pre.state, {
    adClip: { videoUrl: '/uploads/sponsor/pre.mp4', name: 'pre.mp4', duration: 10 },
    placement: 'preroll',
    dedupePlacement: true,
    totalDuration: 310,
  });
  assert.equal(dup.applied, false);

  // Post-roll appends at end (310..325)
  const post = insertVideoAd(pre.state, {
    adClip: { videoUrl: '/uploads/sponsor/post.mp4', name: 'post.mp4', duration: 15 },
    placement: 'postroll',
    dedupePlacement: true,
    totalDuration: 310,
  });
  assert.equal(post.applied, true);
  const lastClip = post.state.videoClips[post.state.videoClips.length - 1];
  assert.equal(lastClip.start, 310);
  assert.equal(lastClip.end, 325);
  assert.equal(isAdClip(lastClip), true);
  assert.equal(post.state.segments[1].startSec, 160);
});

test('deleteVideoAd / deleteVideoClip on ad clip ripples timeline back cleanly', () => {
  const base = makeStory300();
  const inserted = insertVideoAd(base, {
    adClip: { id: 'ad-120', videoUrl: '/uploads/sponsor/s.mp4', name: 's.mp4', duration: 15 },
    insertTime: 120,
    totalDuration: 300,
  });
  assert.equal(inserted.applied, true);

  const deleted = deleteVideoClip(inserted.state, { clipId: 'ad-120', totalDuration: 315 });
  assert.equal(deleted.applied, true);
  assert.equal(deleted.state.videoClips.length, 2);
  assert.equal(deleted.state.videoClips[1].start, 120);
  assert.equal(deleted.state.videoClips[1].end, 300);
  assert.equal(deleted.state.segments[1].startSec, 150);
  assert.equal(deleted.state.segments[1].audioStartSec, 150);
  assert.equal(deleted.state.segments[1].sourceCueId, 'cue_0_15000_2');
});

test('trimClip & moveClip & splitClip work on ad clips respecting ad duration', () => {
  const base = makeStory300();
  const inserted = insertVideoAd(base, {
    adClip: { id: 'ad-trim', videoUrl: '/uploads/sponsor/s.mp4', name: 's.mp4', duration: 15 },
    insertTime: 120,
    totalDuration: 300,
  });

  // Trim ad right edge from 135 -> 130 (valid)
  const trimmed = trimClip(inserted.state, { clipId: 'ad-trim', edge: 'right', newTime: 130, maxSourceDuration: 300 });
  assert.equal(trimmed.applied, true);
  const adTrimmed = trimmed.state.videoClips.find((c) => c.id === 'ad-trim');
  assert.equal(adTrimmed.end, 130);
  assert.equal(adTrimmed.sourceEnd, 10);

  // Move trimmed ad inside the 5s free space [130..135] to 123..133 -> blocked by part1 [0..120], wait 122..132 is valid!
  const moved = moveClip(trimmed.state, { clipId: 'ad-trim', newStart: 122 });
  assert.equal(moved.applied, true);
  assert.equal(moved.state.videoClips.find((c) => c.id === 'ad-trim').start, 122);

  // Split ad clip preserves isAd metadata
  const split = splitClip(inserted.state, { splitTime: 127, activeClipId: 'ad-trim', totalDuration: 315 });
  assert.equal(split.applied, true);
  const adParts = split.state.videoClips.filter((c) => isAdClip(c));
  assert.equal(adParts.length, 2);
  assert.equal(adParts[0].videoUrl, '/uploads/sponsor/s.mp4');
  assert.equal(adParts[1].videoUrl, '/uploads/sponsor/s.mp4');
});
