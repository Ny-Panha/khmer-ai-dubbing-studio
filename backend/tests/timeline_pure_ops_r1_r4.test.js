import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteSegment,
  deleteVideoClip,
  deleteGap,
  splitClip,
  splitSegment,
} from '../../frontend/src/utils/timelineOps.js';

describe('Timeline Core Pure Ops Suite — Rules R1 to R4', () => {

  // ═══════════════════════════════════════════════════════════════════
  // Rule R1: Delete Segment
  // ═══════════════════════════════════════════════════════════════════
  describe('Rule R1: deleteSegment', () => {
    it('R1.1: Only the targeted segment is removed; survivors keep ids and times (no ripple, no renumber)', () => {
      const initialVideoClips = [
        { id: 'clip-1', start: 0, end: 15, name: 'Video 1', isDialogue: true },
      ];
      // 5 segments: [0, 1, 2, 3, 4]
      const initialSegments = [
        { id: 1, _uid: 'uid-1', startSec: 0.0, endSec: 2.0, audioStartSec: 0.0, audioEndSec: 2.0, trackRow: 0, subTrackRow: 0 },
        { id: 2, _uid: 'uid-2', startSec: 2.5, endSec: 4.5, audioStartSec: 2.5, audioEndSec: 4.5, trackRow: 0, subTrackRow: 1 },
        { id: 3, _uid: 'uid-3', startSec: 5.0, endSec: 7.0, audioStartSec: 5.0, audioEndSec: 7.0, trackRow: 0, subTrackRow: 0 },
        { id: 4, _uid: 'uid-4', startSec: 7.5, endSec: 9.5, audioStartSec: 7.5, audioEndSec: 9.5, trackRow: 0, subTrackRow: 1 },
        { id: 5, _uid: 'uid-5', startSec: 10.0, endSec: 12.0, audioStartSec: 10.0, audioEndSec: 12.0, trackRow: 0, subTrackRow: 0 },
      ];

      const state = { videoClips: initialVideoClips, segments: initialSegments };

      // Delete index 2 (id: 3, _uid: 'uid-3')
      const result = deleteSegment(state, { segKey: 'uid-3' });

      assert.equal(result.applied, true, 'deleteSegment must apply successfully');
      assert.equal(result.state.segments.length, 4, 'Segment count must decrease by exactly 1');

      // Check survivor IDs and times
      const survivorIds = result.state.segments.map((s) => s.id);
      assert.deepEqual(survivorIds, [1, 2, 4, 5], 'Survivors must retain original IDs without renumbering');

      const survivorUids = result.state.segments.map((s) => s._uid);
      assert.deepEqual(survivorUids, ['uid-1', 'uid-2', 'uid-4', 'uid-5'], 'Survivors must retain original UIDs');

      // Check NO ripple on survivor 4 and 5
      assert.equal(result.state.segments[2].startSec, 7.5, 'Survivor 4 startSec must not ripple left');
      assert.equal(result.state.segments[2].endSec, 9.5, 'Survivor 4 endSec must not change');
      assert.equal(result.state.segments[3].startSec, 10.0, 'Survivor 5 startSec must not ripple left');

      // Video clips must be deep-equal before and after
      assert.deepEqual(result.state.videoClips, initialVideoClips, 'videoClips must be deep-equal before/after');
    });

    it('R1.2: Deleting the opening segment does NOT snap remaining segments to 00:00', () => {
      const initialSegments = [
        { id: 1, _uid: 'uid-1', startSec: 1.5, endSec: 3.5, audioStartSec: 1.5, audioEndSec: 3.5 },
        { id: 2, _uid: 'uid-2', startSec: 4.0, endSec: 6.0, audioStartSec: 4.0, audioEndSec: 6.0 },
      ];
      const state = { videoClips: [], segments: initialSegments };

      const result = deleteSegment(state, { segKey: 1 });
      assert.equal(result.applied, true);
      assert.equal(result.state.segments.length, 1);
      assert.equal(result.state.segments[0].id, 2);
      assert.equal(result.state.segments[0].startSec, 4.0, 'Survivor must not snap to 00:00');
    });

    it('R1.3: Subtitle track row belongs to segment and is preserved on survivors', () => {
      const initialSegments = [
        { id: 1, _uid: 'uid-1', startSec: 0, endSec: 2, trackRow: 0, trackId: 'voice-1', subTrackRow: 1, subTrackId: 'subs-2' },
        { id: 2, _uid: 'uid-2', startSec: 3, endSec: 5, trackRow: 1, trackId: 'voice-2', subTrackRow: 2, subTrackId: 'subs-3' },
      ];
      const state = { videoClips: [], segments: initialSegments };

      const result = deleteSegment(state, { segKey: 'uid-1' });
      assert.equal(result.applied, true);
      assert.equal(result.state.segments[0].subTrackRow, 2);
      assert.equal(result.state.segments[0].subTrackId, 'subs-3');
      assert.equal(result.state.segments[0].trackRow, 1);
      assert.equal(result.state.segments[0].trackId, 'voice-2');
    });

    it('R1.4: Non-existent segment returns applied: false with reason', () => {
      const initialSegments = [{ id: 1, _uid: 'uid-1', startSec: 0, endSec: 2 }];
      const state = { videoClips: [], segments: initialSegments };

      const result = deleteSegment(state, { segKey: 'non-existent' });
      assert.equal(result.applied, false);
      assert.ok(result.reason, 'Must return a reason');
      assert.deepEqual(result.state.segments, initialSegments);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Rule R2: Delete Dialogue Video Clip (turns into ONE Gap)
  // ═══════════════════════════════════════════════════════════════════
  describe('Rule R2: deleteVideoClip', () => {
    it('R2.1: Deleting a middle dialogue clip turns its span into ONE Gap, video track covers [0, duration] continuously', () => {
      const initialVideoClips = [
        { id: 'clip-a', start: 0, end: 10, name: 'Scene A', isDialogue: true },
        { id: 'clip-b', start: 10, end: 20, name: 'Scene B', isDialogue: true },
        { id: 'clip-c', start: 20, end: 30, name: 'Scene C', isDialogue: true },
      ];
      const initialSegments = [
        { id: 1, _uid: 'seg-1', startSec: 2, endSec: 5 },
        { id: 2, _uid: 'seg-2', startSec: 12, endSec: 15 },
      ];
      const state = { videoClips: initialVideoClips, segments: initialSegments };

      const result = deleteVideoClip(state, { clipId: 'clip-b', totalDuration: 30 });
      assert.equal(result.applied, true);

      // Segments must be deep-equal before and after
      assert.deepEqual(result.state.segments, initialSegments, 'segments must be deep-equal before/after');

      // Video clips must have 3 clips: Clip A, Gap, Clip C
      assert.equal(result.state.videoClips.length, 3);
      assert.equal(result.state.videoClips[0].id, 'clip-a');
      assert.equal(result.state.videoClips[0].start, 0);
      assert.equal(result.state.videoClips[0].end, 10);

      // Middle clip is now a Gap [10, 20]
      const gapClip = result.state.videoClips[1];
      assert.equal(gapClip.name, 'Gap');
      assert.equal(gapClip.isDialogue, false);
      assert.equal(gapClip.start, 10);
      assert.equal(gapClip.end, 20);

      assert.equal(result.state.videoClips[2].id, 'clip-c');
      assert.equal(result.state.videoClips[2].start, 20);
      assert.equal(result.state.videoClips[2].end, 30);
    });

    it('R2.2: Deleting a dialogue clip adjacent to an existing Gap merges into ONE joined Gap', () => {
      const initialVideoClips = [
        { id: 'clip-a', start: 0, end: 10, name: 'Scene A', isDialogue: true },
        { id: 'clip-gap-1', start: 10, end: 15, name: 'Gap', isDialogue: false },
        { id: 'clip-b', start: 15, end: 25, name: 'Scene B', isDialogue: true },
        { id: 'clip-c', start: 25, end: 35, name: 'Scene C', isDialogue: true },
      ];
      const state = { videoClips: initialVideoClips, segments: [] };

      // Delete Clip B which is right after Gap [10, 15]
      const result = deleteVideoClip(state, { clipId: 'clip-b', totalDuration: 35 });
      assert.equal(result.applied, true);

      // Must have merged into ONE Gap covering [10, 25]!
      assert.equal(result.state.videoClips.length, 3, 'Must have Clip A, merged Gap, Clip C');
      assert.equal(result.state.videoClips[0].id, 'clip-a');
      assert.equal(result.state.videoClips[0].end, 10);

      const mergedGap = result.state.videoClips[1];
      assert.equal(mergedGap.name, 'Gap');
      assert.equal(mergedGap.start, 10);
      assert.equal(mergedGap.end, 25, 'Gap [10, 15] and former Clip B [15, 25] must merge into [10, 25]');

      assert.equal(result.state.videoClips[2].id, 'clip-c');
      assert.equal(result.state.videoClips[2].start, 25);
    });

    it('R2.3: Deleting an opening dialogue clip creates a Gap starting at 00:00 (no black span)', () => {
      const initialVideoClips = [
        { id: 'clip-a', start: 0, end: 12, name: 'Scene A', isDialogue: true },
        { id: 'clip-b', start: 12, end: 24, name: 'Scene B', isDialogue: true },
      ];
      const state = { videoClips: initialVideoClips, segments: [] };

      const result = deleteVideoClip(state, { clipId: 'clip-a', totalDuration: 24 });
      assert.equal(result.applied, true);

      assert.equal(result.state.videoClips.length, 2);
      assert.equal(result.state.videoClips[0].name, 'Gap');
      assert.equal(result.state.videoClips[0].start, 0);
      assert.equal(result.state.videoClips[0].end, 12);
      assert.equal(result.state.videoClips[1].id, 'clip-b');
      assert.equal(result.state.videoClips[1].start, 12);
    });

    it('R2.4: Calling deleteVideoClip on a Gap rejects with reason directing to deleteGap', () => {
      const initialVideoClips = [
        { id: 'clip-gap-1', start: 0, end: 10, name: 'Gap', isDialogue: false },
      ];
      const state = { videoClips: initialVideoClips, segments: [] };

      const result = deleteVideoClip(state, { clipId: 'clip-gap-1' });
      assert.equal(result.applied, false);
      assert.ok(result.reason.includes('deleteGap'));
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Rule R3: Delete Gap (Film Ripple Left)
  // ═══════════════════════════════════════════════════════════════════
  describe('Rule R3: deleteGap', () => {
    it('R3.1: Deleting opening Gap cuts film span, shifts later video clips AND segments starting at/after gap end left by exact Gap duration, film starts at 00:00', () => {
      const initialVideoClips = [
        { id: 'clip-gap-1', start: 0, end: 8.5, name: 'Gap', isDialogue: false },
        { id: 'clip-a', start: 8.5, end: 18.5, name: 'Scene A', isDialogue: true },
        { id: 'clip-b', start: 18.5, end: 30.0, name: 'Scene B', isDialogue: true },
      ];
      const initialSegments = [
        { id: 1, _uid: 'seg-1', startSec: 10.0, endSec: 12.0, sourceStartSec: 10.0, sourceEndSec: 12.0, khmerText: 'សំឡេង ១' },
      ];
      const state = { videoClips: initialVideoClips, segments: initialSegments };

      const result = deleteGap(state, { clipId: 'clip-gap-1' });
      assert.equal(result.applied, true);

      // Video track: Clip A and Clip B shifted left by 8.5s
      assert.equal(result.state.videoClips.length, 2);
      assert.equal(result.state.videoClips[0].id, 'clip-a');
      assert.equal(result.state.videoClips[0].start, 0.0, 'Film must start at 00:00');
      assert.equal(result.state.videoClips[0].end, 10.0);

      assert.equal(result.state.videoClips[1].id, 'clip-b');
      assert.equal(result.state.videoClips[1].start, 10.0);
      assert.equal(result.state.videoClips[1].end, 21.5);

      // Segment after opening gap shifted left by exact Gap duration (8.5s)
      assert.equal(result.state.segments.length, 1);
      assert.equal(result.state.segments[0].id, 1, 'id unchanged');
      assert.equal(result.state.segments[0]._uid, 'seg-1', '_uid unchanged');
      assert.equal(result.state.segments[0].sourceStartSec, 10.0, 'sourceStartSec unchanged');
      assert.equal(result.state.segments[0].sourceEndSec, 12.0, 'sourceEndSec unchanged');
      assert.equal(result.state.segments[0].khmerText, 'សំឡេង ១', 'subtitle unchanged');
      assert.equal(result.state.segments[0].startSec, 1.5, 'startSec shifted left by 8.5s (10.0 -> 1.5)');
      assert.equal(result.state.segments[0].endSec, 3.5, 'endSec shifted left by 8.5s (12.0 -> 3.5)');
    });

    it('R3.2: Deleting middle Gap shifts subsequent clips AND segments starting at/after gap end left; prior clips and segments remain untouched', () => {
      const initialVideoClips = [
        { id: 'clip-a', start: 0, end: 10, name: 'Scene A', isDialogue: true },
        { id: 'clip-gap-mid', start: 10, end: 16, name: 'Gap', isDialogue: false },
        { id: 'clip-b', start: 16, end: 26, name: 'Scene B', isDialogue: true },
      ];
      const initialSegments = [
        { id: 1, _uid: 'seg-before', startSec: 2.0, endSec: 5.0, sourceStartSec: 2.0, sourceEndSec: 5.0, khmerText: 'មុន Gap' },
        { id: 2, _uid: 'seg-after', startSec: 18.0, endSec: 22.0, sourceStartSec: 18.0, sourceEndSec: 22.0, khmerText: 'ក្រោយ Gap' },
      ];
      const state = { videoClips: initialVideoClips, segments: initialSegments };

      // Gap duration is 6.0s
      const result = deleteGap(state, { clipId: 'clip-gap-mid' });
      assert.equal(result.applied, true);

      assert.equal(result.state.videoClips.length, 2);
      // Clip A untouched
      assert.equal(result.state.videoClips[0].id, 'clip-a');
      assert.equal(result.state.videoClips[0].start, 0);
      assert.equal(result.state.videoClips[0].end, 10);

      // Clip B shifted left by 6.0s (16 -> 10, 26 -> 20)
      assert.equal(result.state.videoClips[1].id, 'clip-b');
      assert.equal(result.state.videoClips[1].start, 10);
      assert.equal(result.state.videoClips[1].end, 20);

      // Segment before gap is deep-equal untouched
      assert.deepEqual(result.state.segments[0], initialSegments[0], 'segments before gap are deep-equal untouched');

      // Segment after gap shifted left by exact Gap duration (6.0s), ids and source times unchanged
      assert.equal(result.state.segments[1].id, 2);
      assert.equal(result.state.segments[1]._uid, 'seg-after');
      assert.equal(result.state.segments[1].sourceStartSec, 18.0, 'sourceStartSec unchanged');
      assert.equal(result.state.segments[1].sourceEndSec, 22.0, 'sourceEndSec unchanged');
      assert.equal(result.state.segments[1].khmerText, 'ក្រោយ Gap', 'subtitle text unchanged');
      assert.equal(result.state.segments[1].startSec, 12.0, 'startSec shifted left by 6.0s (18.0 -> 12.0)');
      assert.equal(result.state.segments[1].endSec, 16.0, 'endSec shifted left by 6.0s (22.0 -> 16.0)');
    });

    it('R3.3: Calling deleteGap on a non-gap dialogue clip rejects with reason', () => {
      const initialVideoClips = [
        { id: 'clip-dialogue', start: 0, end: 10, name: 'Scene 1', isDialogue: true },
      ];
      const state = { videoClips: initialVideoClips, segments: [] };

      const result = deleteGap(state, { clipId: 'clip-dialogue' });
      assert.equal(result.applied, false);
      assert.ok(result.reason.includes('deleteVideoClip'));
    });

    it('R3.4: Sync case — clips [#5, Gap 0.5s, #6] with voices at their clips -> after deleteGap, video #6 and voice #6 both start 0.5s earlier and remain aligned', () => {
      const initialVideoClips = [
        { id: 'clip-5', start: 0, end: 5.0, name: 'Clip #5', isDialogue: true },
        { id: 'clip-gap-mid', start: 5.0, end: 5.5, name: 'Gap', isDialogue: false },
        { id: 'clip-6', start: 5.5, end: 10.0, name: 'Clip #6', isDialogue: true },
      ];
      const initialSegments = [
        { id: 5, _uid: 'voice-5', startSec: 1.0, endSec: 3.0, audioStartSec: 1.0, audioEndSec: 3.0, sourceStartSec: 1.0, sourceEndSec: 3.0, khmerText: 'សំឡេង ៥' },
        { id: 6, _uid: 'voice-6', startSec: 5.5, endSec: 7.5, audioStartSec: 5.5, audioEndSec: 7.5, sourceStartSec: 5.5, sourceEndSec: 7.5, khmerText: 'សំឡេង ៦' },
      ];
      const state = { videoClips: initialVideoClips, segments: initialSegments };

      const result = deleteGap(state, { clipId: 'clip-gap-mid' });
      assert.equal(result.applied, true);

      // Video clips: Clip #5 untouched, Clip #6 shifted left by 0.5s
      assert.equal(result.state.videoClips.length, 2);
      assert.equal(result.state.videoClips[0].id, 'clip-5');
      assert.equal(result.state.videoClips[0].start, 0);
      assert.equal(result.state.videoClips[0].end, 5.0);

      const video6 = result.state.videoClips[1];
      assert.equal(video6.id, 'clip-6');
      assert.equal(video6.start, 5.0, 'video #6 starts 0.5s earlier (5.5 -> 5.0)');
      assert.equal(video6.end, 9.5);

      // Voice #5 untouched
      assert.deepEqual(result.state.segments[0], initialSegments[0], 'voice #5 before gap is deep-equal untouched');

      // Voice #6 shifted left by 0.5s
      const voice6 = result.state.segments[1];
      assert.equal(voice6.id, 6, 'id unchanged');
      assert.equal(voice6._uid, 'voice-6', '_uid unchanged');
      assert.equal(voice6.sourceStartSec, 5.5, 'sourceStartSec unchanged');
      assert.equal(voice6.sourceEndSec, 7.5, 'sourceEndSec unchanged');
      assert.equal(voice6.khmerText, 'សំឡេង ៦', 'subtitle unchanged');
      assert.equal(voice6.startSec, 5.0, 'voice #6 starts 0.5s earlier (5.5 -> 5.0)');
      assert.equal(voice6.endSec, 7.0);
      assert.equal(voice6.audioStartSec, 5.0);
      assert.equal(voice6.audioEndSec, 7.0);

      // Crucial: video #6 and voice #6 both start at 5.0s and remain aligned
      assert.equal(video6.start, voice6.startSec, 'video #6 and voice #6 start times remain aligned');
      assert.equal(video6.start, voice6.audioStartSec, 'video #6 and voice #6 audioStartSec remain aligned');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Rule R4: Split (Video and Segment)
  // ═══════════════════════════════════════════════════════════════════
  describe('Rule R4: splitClip & splitSegment', () => {
    it('R4.1: splitClip cuts dialogue clip at playhead whether or not anything is selected', () => {
      const initialVideoClips = [
        { id: 'clip-1', start: 0, end: 20, sourceStart: 0, sourceEnd: 20, name: 'Video 1', isDialogue: true },
      ];
      const initialSegments = [
        { id: 1, _uid: 'seg-1', startSec: 2, endSec: 6 },
      ];
      const state = { videoClips: initialVideoClips, segments: initialSegments };

      // Split at playhead 7.5s with activeClipId = null (nothing selected)
      const result = splitClip(state, { splitTime: 7.5, activeClipId: null, totalDuration: 20 });
      assert.equal(result.applied, true);

      // Segments must be deep-equal untouched
      assert.deepEqual(result.state.segments, initialSegments, 'segments must be deep-equal untouched');

      // Video clips must be split into two
      assert.equal(result.state.videoClips.length, 2);
      assert.equal(result.state.videoClips[0].id, 'clip-1');
      assert.equal(result.state.videoClips[0].start, 0);
      assert.equal(result.state.videoClips[0].end, 7.5);
      assert.equal(result.state.videoClips[0].sourceStart, 0);
      assert.equal(result.state.videoClips[0].sourceEnd, 7.5);

      assert.equal(result.state.videoClips[1].start, 7.5);
      assert.equal(result.state.videoClips[1].end, 20);
      assert.equal(result.state.videoClips[1].sourceStart, 7.5);
      assert.equal(result.state.videoClips[1].sourceEnd, 20);
    });

    it('R4.2: splitClip cuts a Gap at playhead into two Gaps', () => {
      const initialVideoClips = [
        { id: 'clip-gap-1', start: 0, end: 10, sourceStart: 0, sourceEnd: 10, name: 'Gap', isDialogue: false },
      ];
      const state = { videoClips: initialVideoClips, segments: [] };

      const result = splitClip(state, { splitTime: 4.0 });
      assert.equal(result.applied, true);

      assert.equal(result.state.videoClips.length, 2);
      assert.equal(result.state.videoClips[0].name, 'Gap');
      assert.equal(result.state.videoClips[0].start, 0);
      assert.equal(result.state.videoClips[0].end, 4.0);

      assert.equal(result.state.videoClips[1].name, 'Gap');
      assert.equal(result.state.videoClips[1].start, 4.0);
      assert.equal(result.state.videoClips[1].end, 10.0);
    });

    it('R4.3: Fresh episode with no clips materializes virtual clip and cuts at playhead', () => {
      const state = { videoClips: [], segments: [] };

      const result = splitClip(state, { splitTime: 15.0, totalDuration: 45.0 });
      assert.equal(result.applied, true);

      assert.equal(result.state.videoClips.length, 2);
      assert.equal(result.state.videoClips[0].start, 0);
      assert.equal(result.state.videoClips[0].end, 15.0);

      assert.equal(result.state.videoClips[1].start, 15.0);
      assert.equal(result.state.videoClips[1].end, 45.0);
    });

    it('R4.4: splitClip returns applied: false when playhead is outside all clips', () => {
      const initialVideoClips = [
        { id: 'clip-1', start: 0, end: 10, sourceStart: 0, sourceEnd: 10 },
      ];
      const state = { videoClips: initialVideoClips, segments: [] };

      // Playhead at 15.0 (outside clip range [0, 10])
      const result = splitClip(state, { splitTime: 15.0 });
      assert.equal(result.applied, false);
      assert.ok(result.reason.includes('គ្មាន clip'));
    });

    it('R4.5: splitSegment splits selected segment and its text into halves when playhead is inside it', () => {
      const initialVideoClips = [
        { id: 'clip-1', start: 0, end: 30, name: 'Video 1' },
      ];
      const initialSegments = [
        {
          id: 1,
          _uid: 'uid-seg-1',
          startSec: 2.0,
          endSec: 8.0,
          audioStartSec: 2.0,
          audioEndSec: 8.0,
          khmerTranslatedText: 'ខ្ញុំចង់រៀន ភាសាខ្មែរជាមួយអ្នក',
          english: 'I want to learn Khmer with you',
          chineseText: '我想和你一起学习高棉语。',
        },
      ];
      const state = { videoClips: initialVideoClips, segments: initialSegments };

      const result = splitSegment(state, { segKey: 'uid-seg-1', splitTime: 5.0 });
      assert.equal(result.applied, true);

      // videoClips must be deep-equal untouched
      assert.deepEqual(result.state.videoClips, initialVideoClips, 'videoClips must be deep-equal untouched');

      // Segments must be split into two
      assert.equal(result.state.segments.length, 2);
      assert.equal(result.state.segments[0].startSec, 2.0);
      assert.equal(result.state.segments[0].endSec, 5.0);
      assert.equal(result.state.segments[1].startSec, 5.0);
      assert.equal(result.state.segments[1].endSec, 8.0);

      // Text must be divided
      assert.ok(result.state.segments[0].khmerTranslatedText.length > 0);
      assert.ok(result.state.segments[1].khmerTranslatedText.length > 0);
    });

    it('R4.6: splitSegment returns applied: false when playhead is outside segment boundaries', () => {
      const initialSegments = [
        { id: 1, _uid: 'uid-1', startSec: 2.0, endSec: 6.0, audioStartSec: 2.0, audioEndSec: 6.0 },
      ];
      const state = { videoClips: [], segments: initialSegments };

      // Playhead at 10.0 (outside [2.0, 6.0])
      const result = splitSegment(state, { segKey: 'uid-1', splitTime: 10.0 });
      assert.equal(result.applied, false);
      assert.ok(result.reason.includes('not inside'));
    });
  });
});
