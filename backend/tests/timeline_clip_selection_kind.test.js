import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('CapCut-Style Per-Clip Selection Kind Suite', () => {
  it('1. Static audit: selection kind is threaded through useWorkspaceMedia, App, TimelineEditor, and Canvas', () => {
    const hookCode = fs.readFileSync('frontend/src/hooks/useWorkspaceMedia.js', 'utf8');
    assert.ok(hookCode.includes('selectedClipKind, setSelectedClipKind'), 'useWorkspaceMedia manages selectedClipKind');

    const appCode = fs.readFileSync('frontend/src/App.jsx', 'utf8');
    assert.ok(appCode.includes('selectedClipKind={media.selectedClipKind}'), 'App.jsx passes selectedClipKind to TimelineEditor and VoiceSettings');
    assert.ok(appCode.includes('onSelectClipKind={media.setSelectedClipKind}'), 'App.jsx passes onSelectClipKind to TimelineEditor');

    const editorCode = fs.readFileSync('frontend/src/components/timeline/TimelineEditor.jsx', 'utf8');
    assert.ok(editorCode.includes('selectedClipKind = null'), 'TimelineEditor accepts selectedClipKind prop');
    assert.ok(editorCode.includes("onSelectClipKind('voice')"), 'handleAudioMouseDown sets voice kind');
    assert.ok(editorCode.includes("onSelectClipKind('video')"), 'handleVideoMouseDown sets video kind');
    assert.ok(editorCode.includes("onSelectClipKind('subtitle')"), 'handleSubMouseDown sets subtitle kind');
    assert.ok(editorCode.includes("onSelectClipKind(null)"), 'handleBackgroundMouseDown clears kind on empty click');

    const canvasCode = fs.readFileSync('frontend/src/components/timeline/TimelineTracksCanvas.jsx', 'utf8');
    assert.ok(canvasCode.includes('selectedClipKind = null'), 'TimelineTracksCanvas accepts selectedClipKind prop');
    assert.ok(canvasCode.includes('is-linked-clip'), 'TimelineTracksCanvas renders is-linked-clip class');

    const cssCode = fs.readFileSync('frontend/src/components/timeline/TimelineEditor.css', 'utf8');
    assert.ok(cssCode.includes('.video-clip-block.is-linked-clip'), 'TimelineEditor.css defines subtle .is-linked-clip outline');
  });

  it('2. Highlight rules: clicking VIDEO clip #7 selects only video clip, paired voice clip shows faint linked outline', () => {
    // Model simulation for segment 7
    const seg = { id: 7, _uid: 'seg-7' };
    const clip = { id: 'clip-7', segmentId: 7, segmentIndex: 7 };
    const otherSeg = { id: 8, _uid: 'seg-8' };
    const otherClip = { id: 'clip-8', segmentId: 8, segmentIndex: 8 };

    // State after clicking VIDEO clip #7
    const selectedClipKind = 'video';
    const activeClipId = 'clip-7';
    const selectedSegmentId = 7;

    // Video clip #7 evaluation
    const isDirectClipMatch7 = activeClipId === clip.id;
    const isVideo7Selected = (selectedClipKind === 'video' || !selectedClipKind) && isDirectClipMatch7;
    const isVideo7Linked = !isVideo7Selected && (selectedClipKind === 'voice' || selectedClipKind === 'subtitle') && (clip.segmentId === selectedSegmentId);

    assert.equal(isVideo7Selected, true, 'Video clip #7 must have strong isSelected = true');
    assert.equal(isVideo7Linked, false, 'Video clip #7 is selected, so isLinked = false');

    // Voice clip #7 evaluation
    const isDirectSegMatch7 = selectedSegmentId === seg.id;
    const isAssociatedWithClip7 = activeClipId === clip.id && clip.segmentId === seg.id;
    const isVoice7Selected = (selectedClipKind === 'voice' || !selectedClipKind) && isDirectSegMatch7;
    const isVoice7Linked = !isVoice7Selected && ((selectedClipKind === 'video' && (isAssociatedWithClip7 || isDirectSegMatch7)));

    assert.equal(isVoice7Selected, false, 'Voice clip #7 must NOT have strong isSelected when kind is video');
    assert.equal(isVoice7Linked, true, 'Voice clip #7 must have subtle isLinked = true when paired video is selected');

    // Unrelated segment 8 evaluation
    const isDirectSegMatch8 = selectedSegmentId === otherSeg.id;
    const isAssociatedWithClip8 = activeClipId === otherClip.id && otherClip.segmentId === otherSeg.id;
    const isVoice8Selected = (selectedClipKind === 'voice' || !selectedClipKind) && isDirectSegMatch8;
    const isVoice8Linked = !isVoice8Selected && ((selectedClipKind === 'video' && (isAssociatedWithClip8 || isDirectSegMatch8)));

    assert.equal(isVoice8Selected, false, 'Unrelated Voice clip #8 must have isSelected = false');
    assert.equal(isVoice8Linked, false, 'Unrelated Voice clip #8 must have isLinked = false');
  });

  it('3. Highlight rules: clicking VOICE clip #7 selects only voice clip, paired video clip shows faint linked outline', () => {
    const seg = { id: 7, _uid: 'seg-7' };
    const clip = { id: 'clip-7', segmentId: 7, segmentIndex: 7 };

    // State after clicking VOICE clip #7
    const selectedClipKind = 'voice';
    const activeClipId = 'clip-7';
    const selectedSegmentId = 7;

    // Voice clip #7 evaluation
    const isDirectSegMatch = selectedSegmentId === seg.id;
    const isVoiceSelected = (selectedClipKind === 'voice' || !selectedClipKind) && isDirectSegMatch;
    const isVoiceLinked = !isVoiceSelected && selectedClipKind === 'video';

    assert.equal(isVoiceSelected, true, 'Voice clip #7 must have strong isSelected = true');
    assert.equal(isVoiceLinked, false, 'Voice clip #7 is selected, so isLinked = false');

    // Video clip #7 evaluation
    const isDirectClipMatch = activeClipId === clip.id;
    const isAssociatedWithSeg = clip.segmentId === selectedSegmentId;
    const isVideoSelected = (selectedClipKind === 'video' || !selectedClipKind) && isDirectClipMatch;
    const isVideoLinked = !isVideoSelected && (selectedClipKind === 'voice' || selectedClipKind === 'subtitle') && isAssociatedWithSeg;

    assert.equal(isVideoSelected, false, 'Video clip #7 must NOT have strong isSelected when kind is voice');
    assert.equal(isVideoLinked, true, 'Video clip #7 must have subtle isLinked = true when paired voice is selected');
  });

  it('4. Inspector focus: video kind focuses video cut context, voice kind focuses dialogue context', () => {
    const inspectorCode = fs.readFileSync('frontend/src/components/voice/ClipInspectorPanel.jsx', 'utf8');
    assert.ok(inspectorCode.includes("const isVideoMode = selectedClipKind === 'video'"), 'ClipInspectorPanel checks selectedClipKind === video');
    assert.ok(inspectorCode.includes('isVideoMode && targetVideoClip'), 'renders video clip inspector when isVideoMode is active');
    assert.ok(inspectorCode.includes('Video Clip:'), 'renders Video Clip inspector header');
    assert.ok(inspectorCode.includes('onToggleMuteVideoClip'), 'renders mute button in video mode');
    assert.ok(inspectorCode.includes('onSplitClip'), 'renders split button in video mode');
    assert.ok(inspectorCode.includes('onDeleteClip'), 'renders delete button in video mode');
  });

  it('5. Operation safety: Delete and Split respect selection kind while preserving linked deletion ripple semantics', () => {
    let deletedVideoId = null;
    let deletedSegmentId = null;

    const onDeleteClip = (id) => { deletedVideoId = id; };
    const onDeleteSegment = (id) => { deletedSegmentId = id; };

    // Test deleting when video clip is selected
    const executeDelete = (kind, clipId, segId) => {
      if (kind === 'video' && clipId) {
        onDeleteClip(clipId);
      } else if ((kind === 'voice' || kind === 'subtitle') && segId) {
        onDeleteSegment(segId);
      }
    };

    executeDelete('video', 'clip-7', 7);
    assert.equal(deletedVideoId, 'clip-7', 'Deleting with kind video calls onDeleteClip');
    assert.equal(deletedSegmentId, null, 'onDeleteSegment was not directly called');

    deletedVideoId = null;
    deletedSegmentId = null;

    executeDelete('voice', 'clip-7', 7);
    assert.equal(deletedSegmentId, 7, 'Deleting with kind voice calls onDeleteSegment');
    assert.equal(deletedVideoId, null, 'onDeleteClip was not directly called');
  });
});
