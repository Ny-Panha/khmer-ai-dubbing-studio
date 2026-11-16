const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Timeline Feature: Mute Voice Dialogue Clips (bit slg yy) & Keep Gaps Unmuted (berk slg simple)', async () => {
  const timelineUtilsPath = path.resolve(__dirname, '../../frontend/src/utils/timelineUtils.js');
  const utilsContent = fs.readFileSync(timelineUtilsPath, 'utf8');

  // 1. Verify autoSplitVideoBySegments sets isMuted: true on dialogue clips and isMuted: false on gap clips
  assert.match(
    utilsContent,
    /name:\s*['"]Gap['"][\s\S]*?isDialogue:\s*false[\s\S]*?isMuted:\s*false/,
    'Gap clips must remain isMuted: false (berk slg simple)'
  );

  assert.match(
    utilsContent,
    /name:\s*`#\$\{it\.index\}[\s\S]*?isDialogue:\s*true[\s\S]*?isMuted:\s*true/,
    'Dialogue cuts matching voice cues must have isMuted: true (bit slg yy)'
  );

  // 2. Verify TimelineToolbar has 1-click Mute Voice Cuts button
  const toolbarPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineToolbar.jsx');
  const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');
  assert.match(toolbarContent, /Mute Voice Cuts/, 'TimelineToolbar must contain Mute Voice Cuts button');
  assert.match(toolbarContent, /Voice Muted/, 'TimelineToolbar must contain Voice Muted active state');

  // 3. Verify VideoPlayerPreview mutes dialogue cuts while preserving gaps on 0% ducking
  const previewPath = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx');
  const previewContent = fs.readFileSync(previewPath, 'utf8');
  assert.match(previewContent, /isCurrentVideoClipMuted/, 'VideoPlayerPreview must check clip-level mute');
  assert.match(previewContent, /duckVal === 0/, 'VideoPlayerPreview must handle 0% ducking cleanly for speech vs gap');

  // 4. Verify TimelineTracksCanvas renders mini muted indicator on muted video clips
  const canvasPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx');
  const canvasContent = fs.readFileSync(canvasPath, 'utf8');
  assert.match(canvasContent, /clip-mini-muted-badge/, 'TimelineTracksCanvas must render clip-mini-muted-badge');
  assert.match(canvasContent, /is-clip-muted/, 'TimelineTracksCanvas must apply is-clip-muted class');
});
