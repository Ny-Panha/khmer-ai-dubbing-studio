const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Timeline Feature: Mute Voice Dialogue Clips (bit slg yy) & Keep Non-Voice / Gaps Unmuted (kelang ot voice baj bit slg te)', async () => {
  const timelineUtilsPath = path.resolve(__dirname, '../../frontend/src/utils/timelineUtils.js');
  const utilsContent = fs.readFileSync(timelineUtilsPath, 'utf8');

  // 1. Verify autoSplitVideoBySegments sets isMuted: false on gap clips
  assert.match(
    utilsContent,
    /name:\s*['"]Gap['"][\s\S]*?isDialogue:\s*false[\s\S]*?isMuted:\s*false/,
    'Gap clips must remain isMuted: false (berk slg simple)'
  );

  // 2. Verify autoSplitVideoBySegments checks hasVoiceAudio and sets isMuted: Boolean(it.hasVoice)
  assert.match(
    utilsContent,
    /hasVoice:\s*hasVoiceAudio/,
    'autoSplitVideoBySegments must check if segment has actual voice audio'
  );

  assert.match(
    utilsContent,
    /isMuted:\s*Boolean\(it\.hasVoice\)/,
    'Dialogue cuts only mute if they actually have voice audio (kelang ot voice baj bit te)'
  );

  // 3. Verify TimelineToolbar has 1-click Mute Voice Cuts button
  const toolbarPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineToolbar.jsx');
  const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');
  assert.match(toolbarContent, /Mute Voice Cuts/, 'TimelineToolbar must contain Mute Voice Cuts button');
  assert.match(toolbarContent, /Voice Muted/, 'TimelineToolbar must contain Voice Muted active state');

  // 4. Verify VideoPlayerPreview mutes dialogue cuts while preserving gaps on 0% ducking and checks hasAudio
  const previewPath = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx');
  const previewContent = fs.readFileSync(previewPath, 'utf8');
  assert.match(previewContent, /isCurrentVideoClipMuted/, 'VideoPlayerPreview must check clip-level mute');
  assert.match(previewContent, /!seg\.muted && !seg\.isMuted && hasAudio/, 'speakingIntervals must only count segments with actual audio');
  assert.match(previewContent, /duckVal === 0/, 'VideoPlayerPreview must handle 0% ducking cleanly for speech vs gap');

  // 5. Verify TimelineTracksCanvas renders mini muted indicator on muted video clips
  const canvasPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx');
  const canvasContent = fs.readFileSync(canvasPath, 'utf8');
  assert.match(canvasContent, /clip-mini-muted-badge/, 'TimelineTracksCanvas must render clip-mini-muted-badge');
  assert.match(canvasContent, /is-clip-muted/, 'TimelineTracksCanvas must apply is-clip-muted class');

  // 6. Verify Track Headers and Lane DO NOT mark entire video lane muted just because cuts are muted
  const headerPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTrackHeaders.jsx');
  const headerContent = fs.readFileSync(headerPath, 'utf8');
  assert.doesNotMatch(headerContent, /mutedTracks\.video \|\| areAllCutsMuted/, 'Track Header must not falsely mute whole track on cut mutes');
});
