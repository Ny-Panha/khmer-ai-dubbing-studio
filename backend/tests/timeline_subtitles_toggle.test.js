const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Timeline Subtitles Toggle: Static Architecture & VIEW-ONLY Boundary Audit', () => {
  const timelineEditorPath = path.resolve(__dirname, '../../frontend/src/components/TimelineEditor.jsx');
  const timelineToolbarPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineToolbar.jsx');
  const trackHeadersPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTrackHeaders.jsx');
  const tracksCanvasPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx');
  const playerPreviewPath = path.resolve(__dirname, '../../frontend/src/components/VideoPlayerPreview.jsx');
  const videoRoutesPath = path.resolve(__dirname, '../routes/videoRoutes.js');

  const editorCode = fs.readFileSync(timelineEditorPath, 'utf8');
  const toolbarCode = fs.readFileSync(timelineToolbarPath, 'utf8');
  const headersCode = fs.readFileSync(trackHeadersPath, 'utf8');
  const canvasCode = fs.readFileSync(tracksCanvasPath, 'utf8');
  const playerCode = fs.readFileSync(playerPreviewPath, 'utf8');
  const routesCode = fs.readFileSync(videoRoutesPath, 'utf8');

  // 1. TimelineEditor: Initial state, persistence & wiring
  assert.ok(editorCode.includes("localStorage.getItem('TIMELINE_SHOW_SUBTITLES')"), 'Must read from localStorage');
  assert.ok(editorCode.includes('return false; // Default state on first run: OFF'), 'Default state on first run must be OFF (false)');
  assert.ok(editorCode.includes("localStorage.setItem('TIMELINE_SHOW_SUBTITLES'"), 'Must persist changes to localStorage');
  assert.ok(editorCode.includes('const showSubtitles = Boolean(showSubtitlesTrack);'), 'Must control showSubtitles via showSubtitlesTrack');
  assert.ok(editorCode.includes('showSubtitlesTrack={showSubtitlesTrack}'), 'Must pass showSubtitlesTrack to Toolbar');
  assert.ok(editorCode.includes('setShowSubtitlesTrack={setShowSubtitlesTrack}'), 'Must pass setShowSubtitlesTrack to Toolbar');
  assert.ok(editorCode.includes('showSubtitles={showSubtitles}'), 'Must pass showSubtitles to Canvas and Headers');

  // 2. TimelineToolbar: Toggle placement, visual style & text
  assert.ok(toolbarCode.includes('showSubtitlesTrack'), 'Toolbar must accept showSubtitlesTrack');
  assert.ok(toolbarCode.includes('setShowSubtitlesTrack'), 'Toolbar must accept setShowSubtitlesTrack');
  assert.ok(toolbarCode.includes("showSubtitlesTrack ? 'Subs ON' : 'Subs OFF'"), "Must display 'Subs ON' / 'Subs OFF'");
  assert.ok(toolbarCode.includes("className={`timeline-pill-tool ${showSubtitlesTrack ? 'tool-magnet active' : 'tool-magnet'}`}"), 'Must use same visual style as Snap button');

  // 3. Track Headers & Canvas: Disappearance on OFF state
  assert.ok(headersCode.includes('{showSubtitles && Array.from({ length: Math.max(1, subRowCount) }).map('), 'Headers must omit subtitle headers when showSubtitles is false');
  assert.ok(canvasCode.includes('{showSubtitles && Array.from({ length: subRowCount }).map('), 'Canvas must omit subtitle lanes when showSubtitles is false');
  assert.ok(canvasCode.includes('if (prev.showSubtitles !== next.showSubtitles) return false;'), 'Canvas memoization must invalidate on showSubtitles toggle');

  // 4. VIEW ONLY Hard Boundary: Player preview and Render Pipeline are unaffected
  assert.ok(!playerCode.includes('TIMELINE_SHOW_SUBTITLES'), 'VideoPlayerPreview must NOT read timeline toggle state');
  assert.ok(!playerCode.includes('showSubtitlesTrack'), 'VideoPlayerPreview must NOT depend on timeline toggle state');
  assert.ok(!routesCode.includes('TIMELINE_SHOW_SUBTITLES'), 'Backend render pipeline must NOT read timeline toggle state');
  assert.ok(routesCode.includes('burnSubtitles: Boolean(burnSubtitles)'), 'Backend export pipeline burns subtitles regardless of timeline track visibility');
});
