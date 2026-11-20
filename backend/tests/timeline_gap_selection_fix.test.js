import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  deleteGap,
  deleteVideoClip,
  splitClip,
  isGapClip,
} from '../../frontend/src/utils/timelineOps.js';
import {
  bridgeClipGaps,
  autoSplitVideoBySegments,
} from '../../frontend/src/utils/timelineUtils.js';

const getFrontendFile = (rel) => fs.existsSync(rel) ? rel : path.resolve(process.cwd(), '..', rel);

describe('Gap Selection and Ripple Deletion Suite', () => {
  it('1. Static audit: Gap click and mouse-down handlers isolate Gap selection and clear segments', () => {
    const canvasCode = fs.readFileSync(getFrontendFile('frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8');
    assert.ok(canvasCode.includes("import { isGapClip } from '../../utils/timelineOps'"), 'TimelineTracksCanvas imports isGapClip');
    assert.ok(canvasCode.includes('if (isGapClip(clip)) {'), 'renderVideoClip onClick checks isGapClip');
    assert.ok(canvasCode.includes('if (setSelectedAudioId) setSelectedAudioId(null)'), 'Gap click clears setSelectedAudioId');
    assert.ok(canvasCode.includes('if (setSelectedSubId) setSelectedSubId(null)'), 'Gap click clears setSelectedSubId');
    assert.ok(canvasCode.includes('if (onSelectSegment) onSelectSegment(null)'), 'Gap click clears onSelectSegment');
    assert.ok(canvasCode.includes('!isGapClip(clip) &&'), 'isAssociatedWithSeg guards against Gap clips');

    const editorCode = fs.readFileSync(getFrontendFile('frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');
    assert.ok(editorCode.includes('if (isGapClip(clip)) {'), 'handleVideoMouseDown checks isGapClip');
    assert.ok(editorCode.includes('selectedSegmentIdRef.current = null;'), 'Gap mouse-down clears selectedSegmentIdRef');
  });

  it('2. Selection simulation: clicking Gap between #3 and #4 selects ONLY Gap; dialogue #3 and voice #3 remain unselected', () => {
    const clip3 = { id: 'clip-3', name: '#3 Speaker A', start: 5.0, end: 10.0, isDialogue: true, segmentIndex: 3, segmentId: 3 };
    const gap = { id: 'clip-gap-1', name: 'Gap', start: 10.0, end: 12.0, isDialogue: false };
    const clip4 = { id: 'clip-4', name: '#4 Speaker B', start: 12.0, end: 16.0, isDialogue: true, segmentIndex: 4, segmentId: 4 };

    const seg3 = { id: 3, _uid: 'seg-3', startSec: 5.0, endSec: 10.0 };
    const seg4 = { id: 4, _uid: 'seg-4', startSec: 12.0, endSec: 16.0 };

    const videoClips = [clip3, gap, clip4];
    const scriptSegments = [seg3, seg4];

    // Simulate clicking Gap clip:
    // Gap onClick sets activeClipId = gap.id, selectedClipKind = 'video', clears segment selection
    let activeClipId = null;
    let selectedClipKind = null;
    let selectedSegmentId = 99; // previously selected
    let selectedAudioId = 99;
    let selectedSubId = 99;

    const onSelectClipKind = (kind) => { selectedClipKind = kind; };
    const onSelectClip = (id) => { activeClipId = id; };
    const setSelectedAudioId = (id) => { selectedAudioId = id; };
    const setSelectedSubId = (id) => { selectedSubId = id; };
    const onSelectSegment = (id) => { selectedSegmentId = id; };

    // Simulate the Gap click logic
    const clickVideoClip = (clip) => {
      onSelectClipKind('video');
      onSelectClip(clip.id);
      if (isGapClip(clip)) {
        setSelectedAudioId(null);
        setSelectedSubId(null);
        onSelectSegment(null);
        return;
      }
      const targetSeg = scriptSegments?.find(s => s.id === clip.segmentId || s.id === clip.segmentIndex);
      if (targetSeg) {
        setSelectedAudioId(targetSeg.id);
        setSelectedSubId(targetSeg.id);
        onSelectSegment(targetSeg.id);
      }
    };

    clickVideoClip(gap);

    assert.equal(activeClipId, 'clip-gap-1', 'Active clip must be the Gap');
    assert.equal(selectedClipKind, 'video', 'Selected kind must be video');
    assert.equal(selectedSegmentId, null, 'Segment selection must be null');
    assert.equal(selectedAudioId, null, 'Audio selection must be null');
    assert.equal(selectedSubId, null, 'Sub selection must be null');

    // Canvas highlight evaluation for Gap
    const isGapSelected = (selectedClipKind === 'video' || !selectedClipKind) && activeClipId === gap.id;
    assert.equal(isGapSelected, true, 'Gap must have isSelected = true');

    // Canvas highlight evaluation for Dialogue Clip #3
    const isClip3DirectMatch = activeClipId === clip3.id;
    const isClip3Selected = (selectedClipKind === 'video' || !selectedClipKind) && isClip3DirectMatch;
    const isClip3Linked = !isClip3Selected && (selectedClipKind === 'voice' || selectedClipKind === 'subtitle') && (clip3.segmentId === selectedSegmentId);
    assert.equal(isClip3Selected, false, 'Dialogue #3 must NOT have isSelected');
    assert.equal(isClip3Linked, false, 'Dialogue #3 must NOT be linked');

    // Canvas highlight evaluation for Voice Segment #3
    const isVoice3DirectMatch = selectedSegmentId === seg3.id;
    const isVoice3AssociatedWithClip = activeClipId && videoClips.some(c => c.id === activeClipId && !isGapClip(c) && (c.segmentId === seg3.id || c.segmentIndex === 3));
    const isVoice3Selected = (selectedClipKind === 'voice' || !selectedClipKind) && isVoice3DirectMatch;
    const isVoice3Linked = !isVoice3Selected && selectedClipKind === 'video' && (isVoice3AssociatedWithClip || isVoice3DirectMatch);
    assert.equal(isVoice3Selected, false, 'Voice #3 must NOT be selected');
    assert.equal(isVoice3Linked, false, 'Voice #3 must NOT be linked');
  });

  it('3. Delete Gap fires R3 ripple: Gap is removed, subsequent clips and segments shift left by Gap duration', () => {
    const clip3 = { id: 'clip-3', name: '#3 Speaker A', start: 5.0, end: 10.0, isDialogue: true, segmentIndex: 3, segmentId: 3 };
    const gap = { id: 'clip-gap-mid', name: 'Gap', start: 10.0, end: 12.0, isDialogue: false }; // duration = 2.0s
    const clip4 = { id: 'clip-4', name: '#4 Speaker B', start: 12.0, end: 16.0, isDialogue: true, segmentIndex: 4, segmentId: 4 };

    const seg3 = { id: 3, _uid: 'seg-3', startSec: 5.0, endSec: 10.0, audioStartSec: 5.0, audioEndSec: 10.0 };
    const seg4 = { id: 4, _uid: 'seg-4', startSec: 12.0, endSec: 16.0, audioStartSec: 12.0, audioEndSec: 16.0 };

    const state = {
      videoClips: [clip3, gap, clip4],
      segments: [seg3, seg4],
    };

    const result = deleteGap(state, { clipId: 'clip-gap-mid' });
    assert.equal(result.applied, true, 'deleteGap must apply');

    // Gap removed
    assert.equal(result.state.videoClips.length, 2, 'Gap should be removed');
    assert.equal(result.state.videoClips.find(c => c.id === 'clip-gap-mid'), undefined);

    // Clip 3 untouched
    const resClip3 = result.state.videoClips.find(c => c.id === 'clip-3');
    assert.equal(resClip3.start, 5.0);
    assert.equal(resClip3.end, 10.0);

    // Clip 4 shifted left by 2.0s: start 12.0 -> 10.0, end 16.0 -> 14.0
    const resClip4 = result.state.videoClips.find(c => c.id === 'clip-4');
    assert.equal(resClip4.start, 10.0);
    assert.equal(resClip4.end, 14.0);

    // Seg 3 untouched
    const resSeg3 = result.state.segments.find(s => s.id === 3);
    assert.equal(resSeg3.startSec, 5.0);
    assert.equal(resSeg3.endSec, 10.0);

    // Seg 4 shifted left by 2.0s: startSec 12.0 -> 10.0, endSec 16.0 -> 14.0
    const resSeg4 = result.state.segments.find(s => s.id === 4);
    assert.equal(resSeg4.startSec, 10.0);
    assert.equal(resSeg4.endSec, 14.0);
    assert.equal(resSeg4.audioStartSec, 10.0);
    assert.equal(resSeg4.audioEndSec, 14.0);
  });

  it('4. Dialogue clip #4 click still selects #4 and pairs with voice segment #4', () => {
    const clip4 = { id: 'clip-4', name: '#4 Speaker B', start: 10.0, end: 14.0, isDialogue: true, segmentIndex: 4, segmentId: 4 };
    const seg4 = { id: 4, _uid: 'seg-4', startSec: 10.0, endSec: 14.0 };

    let activeClipId = null;
    let selectedClipKind = null;
    let selectedSegmentId = null;

    const clickVideoClip = (clip) => {
      selectedClipKind = 'video';
      activeClipId = clip.id;
      if (isGapClip(clip)) {
        selectedSegmentId = null;
        return;
      }
      if (clip.segmentId || clip.segmentIndex) {
        selectedSegmentId = clip.segmentId || clip.segmentIndex;
      }
    };

    clickVideoClip(clip4);

    assert.equal(activeClipId, 'clip-4');
    assert.equal(selectedClipKind, 'video');
    assert.equal(selectedSegmentId, 4);

    // Voice segment #4 is linked
    const isVoice4Associated = activeClipId === clip4.id && !isGapClip(clip4) && clip4.segmentId === seg4.id;
    assert.equal(isVoice4Associated, true, 'Voice #4 is associated with dialogue clip #4');
  });

  it('5. Gap object purity: timelineOps and timelineUtils never leak segmentId or segmentIndex onto Gaps', () => {
    // 5a: deleteVideoClip creates pure Gap
    const dialogueClips = [
      { id: 'clip-1', name: '#1', start: 0, end: 10, sourceStart: 0, sourceEnd: 10, isDialogue: true, segmentIndex: 1, segmentId: 1 },
      { id: 'clip-2', name: '#2', start: 10, end: 20, sourceStart: 10, sourceEnd: 20, isDialogue: true, segmentIndex: 2, segmentId: 2 },
    ];
    const delResult = deleteVideoClip({ videoClips: dialogueClips, segments: [] }, { clipId: 'clip-1', totalDuration: 20 });
    const createdGap = delResult.state.videoClips.find(c => isGapClip(c));
    assert.ok(createdGap, 'Gap must be created');
    assert.equal(createdGap.segmentId, undefined, 'Gap must not have segmentId');
    assert.equal(createdGap.segmentIndex, undefined, 'Gap must not have segmentIndex');

    // 5b: splitClip on a Gap creates two pure Gaps
    const gapClips = [
      { id: 'clip-gap-test', name: 'Gap', start: 0, end: 10, sourceStart: 0, sourceEnd: 10, isDialogue: false, segmentId: 99, segmentIndex: 99 },
    ];
    const splitResult = splitClip({ videoClips: gapClips, segments: [] }, { splitTime: 5.0 });
    assert.equal(splitResult.applied, true);
    splitResult.state.videoClips.forEach((c) => {
      assert.equal(c.segmentId, undefined, 'Split Gap must have stripped segmentId');
      assert.equal(c.segmentIndex, undefined, 'Split Gap must have stripped segmentIndex');
    });

    // 5c: bridgeClipGaps strips any stale segmentId/segmentIndex
    const bridged = bridgeClipGaps([
      { id: 'clip-gap-bridged', name: 'Gap', start: 0, end: 5, isDialogue: false, segmentId: 3, segmentIndex: 3 },
      { id: 'clip-real', name: '#4', start: 5, end: 10, isDialogue: true, segmentId: 4, segmentIndex: 4 },
    ]);
    const bridgedGap = bridged.find(c => c.name === 'Gap');
    assert.equal(bridgedGap.segmentId, undefined);
    assert.equal(bridgedGap.segmentIndex, undefined);

    // 5d: autoSplitVideoBySegments creates Gaps with no segmentId/segmentIndex
    const autoClips = autoSplitVideoBySegments(
      [{ id: 1, startSec: 5.0, endSec: 10.0, speaker: 'Test' }],
      15.0
    );
    const introGap = autoClips.find(c => c.name === 'Gap');
    assert.ok(introGap);
    assert.equal(introGap.segmentId, undefined);
    assert.equal(introGap.segmentIndex, undefined);

    const outroClip = autoClips.find(c => c.name === 'Outro');
    assert.ok(outroClip);
    assert.equal(outroClip.segmentId, undefined);
    assert.equal(outroClip.segmentIndex, undefined);
  });
});
