import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  autoSplitVideoBySegments,
  doesClipMatchSegment,
  findAssociatedSegmentIndices,
  resolveForwardPlaybackTransition,
} from '../../frontend/src/utils/timelineUtils.js';
import { splitClip, splitSegment } from '../../frontend/src/utils/timelineOps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Micro-Clip Seek-Storm Guard & Canonical Segment ID Sync (#185/#187)', () => {
  it('1. autoSplitVideoBySegments uses canonical seg.id (not drifted idx+1) after +ឃ្លា insertions', () => {
    // Reproduces ep_5 where 2 earlier insertions shifted array idx+1 by +2 relative to seg.id
    const segments = [
      { id: 1001, audioStartSec: 0.5, audioEndSec: 2.0, speaker: 'Inserted A' },
      { id: 1002, audioStartSec: 2.5, audioEndSec: 4.0, speaker: 'Inserted B' },
      { id: 185, audioStartSec: 522.09, audioEndSec: 523.63, speaker: 'តួអង្គទី២' },
      { id: 186, audioStartSec: 523.81, audioEndSec: 525.53, speaker: 'តួអង្គទី១' },
      { id: 187, audioStartSec: 525.61, audioEndSec: 527.71, speaker: 'តួអង្គទី២' },
    ];

    const clips = autoSplitVideoBySegments(segments, 535.0, 'ep_5.mp4');
    const dialogueClips = clips.filter((c) => c.isDialogue);

    const clip185 = dialogueClips.find((c) => c.segmentId === 185);
    const clip187 = dialogueClips.find((c) => c.segmentId === 187);

    assert.ok(clip185, 'Must produce video clip for segmentId 185');
    assert.ok(clip187, 'Must produce video clip for segmentId 187');

    // Canonical labels & segmentIndex must match seg.id (never drifted idx+1)
    assert.equal(clip185.segmentIndex, 185);
    assert.equal(clip185.name, '#185 តួអង្គទី២');
    assert.equal(clip187.segmentIndex, 187);
    assert.equal(clip187.name, '#187 តួអង្គទី២');

    // #187 must appear ONLY ONCE in dialogue clips
    const clipsLabeled187 = dialogueClips.filter((c) => String(c.name || '').startsWith('#187 '));
    assert.equal(clipsLabeled187.length, 1, '#187 must appear exactly once on VIDEO track');
  });

  it('2. doesClipMatchSegment & findAssociatedSegmentIndices prefer canonical segmentId over drifted legacy segmentIndex', () => {
    // Exact legacy ep_5 disk clip at 08:42 (522.09s): segmentId=185, drifted segmentIndex=187
    const legacyClipAt0842 = {
      id: 'clip-seg-legacy-338',
      start: 522.09,
      end: 523.63,
      sourceStart: 522.09,
      sourceEnd: 523.63,
      name: '#187 តួអង្គទី២',
      isDialogue: true,
      segmentId: 185,
      segmentIndex: 187,
    };

    const seg185 = { id: 185, startSec: 522.09, endSec: 523.63, speaker: 'តួអង្គទី២' };
    const seg187 = { id: 187, startSec: 526.84, endSec: 528.94, speaker: 'តួអង្គទី២' };

    assert.equal(doesClipMatchSegment(legacyClipAt0842, seg185), true, 'Must match real segment #185');
    assert.equal(doesClipMatchSegment(legacyClipAt0842, seg187), false, 'Must NOT cross-match drifted #187');
    assert.equal(doesClipMatchSegment(legacyClipAt0842, 185), true);
    assert.equal(doesClipMatchSegment(legacyClipAt0842, 187), false);

    // Legacy clip with NO segmentId still falls back to segmentIndex
    const oldClipWithoutSegId = { id: 'clip-old', segmentIndex: 12 };
    assert.equal(doesClipMatchSegment(oldClipWithoutSegId, { id: 12 }), true);

    // findAssociatedSegmentIndices returns only seg185 (index 0), never drifted seg187 (index 1)
    const assoc = findAssociatedSegmentIndices(legacyClipAt0842, [seg185, seg187]);
    assert.deepEqual(assoc, [0]);
  });

  it('3. splitClip and splitSegment reject splits that would create < 0.3s micro-clips', () => {
    const state = {
      videoClips: [
        { id: 'c1', start: 520.0, end: 522.0, sourceStart: 520.0, sourceEnd: 522.0, name: '#185', isDialogue: true },
      ],
      segments: [
        { id: 185, _uid: 'u185', startSec: 520.0, endSec: 522.0, audioStartSec: 520.0, audioEndSec: 522.0, khmerText: 'សួស្តី អ្នកទាំងអស់គ្នា' },
      ],
    };

    // Attempt 0.25s micro-clip on left or right edge
    const tinyLeftClip = splitClip(state, { splitTime: 520.25, activeClipId: 'c1', totalDuration: 600 });
    assert.equal(tinyLeftClip.applied, false, 'splitClip must reject 0.25s left sliver');
    assert.equal(tinyLeftClip.state.videoClips.length, 1);

    const tinyRightClip = splitClip(state, { splitTime: 521.80, activeClipId: 'c1', totalDuration: 600 });
    assert.equal(tinyRightClip.applied, false, 'splitClip must reject 0.20s right sliver');
    assert.equal(tinyRightClip.state.videoClips.length, 1);

    // Valid >= 0.3s split succeeds
    const validClipSplit = splitClip(state, { splitTime: 521.0, activeClipId: 'c1', totalDuration: 600 });
    assert.equal(validClipSplit.applied, true);
    assert.equal(validClipSplit.state.videoClips.length, 2);

    // Attempt 0.25s micro-segment split
    const tinySegSplit = splitSegment(state, { segKey: 'u185', splitTime: 520.25 });
    assert.equal(tinySegSplit.applied, false, 'splitSegment must reject 0.25s micro-segment');
    assert.equal(tinySegSplit.state.segments.length, 1);

    // Valid >= 0.3s segment split succeeds
    const validSegSplit = splitSegment(state, { segKey: 'u185', splitTime: 521.0 });
    assert.equal(validSegSplit.applied, true);
    assert.equal(validSegSplit.state.segments.length, 2);
  });

  it('4. resolveForwardPlaybackTransition flows through contiguous micro-Gaps with 0 seeks & coalesces chained non-contiguous micro-slivers', () => {
    // Case A: Contiguous ep_5 micro-Gap (0.08s) -> flows naturally with zero seek
    const contiguousClips = [
      { id: 'c1', start: 523.81, end: 525.53, sourceStart: 523.81, sourceEnd: 525.53 },
      { id: 'g1', start: 525.53, end: 525.61, sourceStart: 525.53, sourceEnd: 525.61, name: 'Gap', isDialogue: false },
      { id: 'c2', start: 525.61, end: 527.71, sourceStart: 525.61, sourceEnd: 527.71 },
    ];
    const flowRes = resolveForwardPlaybackTransition(contiguousClips, 0, 525.52, 600);
    assert.equal(flowRes.action, 'flow', 'Contiguous micro-Gap must flow naturally with 0 seeks');
    assert.equal(flowRes.nextClipIdx, 1);

    // Case B: Chained non-contiguous micro-slivers (< 0.25s each) -> coalesces to 1 seek directly to c3
    const stormClips = [
      { id: 'c0', start: 0.0, end: 5.0, sourceStart: 0.0, sourceEnd: 5.0 },
      { id: 'micro1', start: 5.0, end: 5.20, sourceStart: 10.0, sourceEnd: 10.20 },
      { id: 'micro2', start: 5.20, end: 5.35, sourceStart: 20.0, sourceEnd: 20.15 },
      { id: 'c3', start: 5.35, end: 15.35, sourceStart: 30.0, sourceEnd: 40.0 },
    ];
    const coalesced = resolveForwardPlaybackTransition(stormClips, 0, 4.98, 600);
    assert.equal(coalesced.action, 'seek');
    assert.equal(coalesced.nextClipIdx, 3, 'Must coalesce past chained non-contiguous micro-slivers');
    assert.equal(coalesced.targetSrc, 30.0);
    assert.equal(coalesced.skippedMicroCount, 2);

    // Case C: Non-contiguous micro-clip followed by CONTIGUOUS clip -> do NOT skip (1 seek flows straight into c2)
    const singleJumpThenContiguous = [
      { id: 'c0', start: 0.0, end: 5.0, sourceStart: 0.0, sourceEnd: 5.0 },
      { id: 'micro1', start: 5.0, end: 5.20, sourceStart: 10.0, sourceEnd: 10.20 },
      { id: 'c2', start: 5.20, end: 10.0, sourceStart: 10.20, sourceEnd: 15.0 },
    ];
    const keepRes = resolveForwardPlaybackTransition(singleJumpThenContiguous, 0, 4.98, 600);
    assert.equal(keepRes.action, 'seek');
    assert.equal(keepRes.nextClipIdx, 1, 'Must NOT skip micro-clip when next clip is contiguous with it');
    assert.equal(keepRes.targetSrc, 10.0);
    assert.equal(keepRes.skippedMicroCount, 0);
  });

  it('5. Static audit: useVideoPlayback guards stale rVFC frames & seek cooldown; TimelineTracksCanvas normalizes legacy clip labels', () => {
    const playbackCode = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useVideoPlayback.js'), 'utf8');
    const canvasCode = fs.readFileSync(path.join(rootDir, 'frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8');

    assert.ok(playbackCode.includes('resolveForwardPlaybackTransition'), 'useVideoPlayback must use resolveForwardPlaybackTransition');
    assert.ok(playbackCode.includes('pendingSeekStartedMsRef'), 'useVideoPlayback must track pendingSeekStartedMsRef for stale rVFC guard');
    assert.ok(playbackCode.includes('lastTransitionSeekMsRef'), 'useVideoPlayback must enforce transition seek cooldown');
    assert.ok(canvasCode.includes('doesClipMatchSegment'), 'TimelineTracksCanvas must match clips via doesClipMatchSegment');
    assert.ok(canvasCode.includes('clip.segmentId ?? clip.segmentIndex'), 'TimelineTracksCanvas must display canonical segmentId on video clips');
  });
});
