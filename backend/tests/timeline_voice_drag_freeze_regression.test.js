const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Voice Clip Drag Freeze Regression Suite', () => {
  const rootDir = path.resolve(__dirname, '../..');

  const proxyHookPath = path.resolve(rootDir, 'frontend/src/hooks/useProxyPreview.js');
  const playerPreviewPath = path.resolve(rootDir, 'frontend/src/components/player/VideoPlayerPreview.jsx');
  const timelineEditorPath = path.resolve(rootDir, 'frontend/src/components/timeline/TimelineEditor.jsx');
  const videoPlaybackPath = path.resolve(rootDir, 'frontend/src/hooks/useVideoPlayback.js');

  assert.ok(fs.existsSync(proxyHookPath), 'useProxyPreview.js must exist');
  assert.ok(fs.existsSync(playerPreviewPath), 'VideoPlayerPreview.jsx must exist');
  assert.ok(fs.existsSync(timelineEditorPath), 'TimelineEditor.jsx must exist');
  assert.ok(fs.existsSync(videoPlaybackPath), 'useVideoPlayback.js must exist');

  const proxyCode = fs.readFileSync(proxyHookPath, 'utf8');
  const playerCode = fs.readFileSync(playerPreviewPath, 'utf8');
  const editorCode = fs.readFileSync(timelineEditorPath, 'utf8');
  const playbackCode = fs.readFileSync(videoPlaybackPath, 'utf8');

  // 1. useProxyPreview: Cache retention during background renders to prevent src flapping
  assert.ok(
    proxyCode.includes('lastValidProxyUrlRef'),
    'useProxyPreview must maintain lastValidProxyUrlRef'
  );
  assert.ok(
    proxyCode.includes('const effectiveProxyUrl = value?.state === \'fresh\' ? value.url : lastValidProxyUrlRef.current'),
    'useProxyPreview must keep effectiveProxyUrl valid while background proxy is queued/rendering'
  );

  // 2. VideoPlayerPreview: wasPlaying preservation across source switch
  assert.ok(
    playerCode.includes('const wasPlaying = Boolean(isPlayingRef.current || (videoRef?.current && !videoRef.current.paused))'),
    'VideoPlayerPreview must capture wasPlaying state before source switch'
  );
  assert.ok(
    playerCode.includes('shouldResumePlay && v && v.paused'),
    'VideoPlayerPreview must resume playback via v.play() if video was playing prior to src switch'
  );

  // 3. VideoPlayerPreview: timeupdate trap prevention
  assert.ok(
    playerCode.includes('isStale = (performance.now() - (pending.setAt || 0)) > 600'),
    'VideoPlayerPreview must have staleness escape so pendingSrcSwitchSeekRef never traps timeupdate indefinitely'
  );

  // 4. TimelineEditor: Video decoder seek-storm prevention during drag scrub
  assert.ok(
    editorCode.includes('if (videoRef?.current?.seeking)'),
    'TimelineEditor scheduleVoiceDragScrub must skip seek if video decoder is already seeking'
  );

  // 5. TimelineEditor: wasPlayingOnDrop playhead preservation
  assert.ok(
    editorCode.includes('const wasPlayingOnDrop = Boolean(isPlayingRef.current || (videoRef?.current && !videoRef.current.paused))'),
    'TimelineEditor handleMouseUp must record wasPlayingOnDrop before onUpdateSegments'
  );
  assert.ok(
    editorCode.includes('if (!wasPlayingOnDrop && onSeek && typeof droppedStart === \'number\')'),
    'TimelineEditor handleMouseUp must NOT seek playhead to droppedStart if video was playing'
  );

  // 6. useVideoPlayback: ReadyState 0 seek guard
  assert.ok(
    playbackCode.includes('if (videoRef.current.readyState === 0)'),
    'useVideoPlayback handleSeek must guard against seeking uninitialized video element'
  );

  // 7. TimelineEditor: Direct RAF coalesced GPU pointer translation
  assert.ok(
    editorCode.includes('mouseRafRef.current = requestAnimationFrame('),
    'TimelineEditor must coalesce pointer moves via mouseRafRef'
  );
  assert.ok(
    editorCode.includes('draggedElementRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`'),
    'TimelineEditor must use direct GPU translate3d on dragged DOM element'
  );

  // 8. TimelineEditor: Layout-thrashing prevention via cached lane bounds
  assert.ok(
    editorCode.includes('cachedVoiceLaneBoundsRef.current = measureVoiceLaneBounds(segRow)'),
    'TimelineEditor must cache voice lane bounds on mousedown to prevent layout thrashing on mousemove'
  );

  // 9. TimelineEditor.css: Dragged blocks must have transitions disabled and will-change: transform
  const cssPath = path.resolve(rootDir, 'frontend/src/components/timeline/TimelineEditor.css');
  assert.ok(fs.existsSync(cssPath), 'TimelineEditor.css must exist');
  const cssCode = fs.readFileSync(cssPath, 'utf8');
  assert.ok(
    cssCode.includes('.voice-segment-block.is-dragging'),
    'TimelineEditor.css must style .voice-segment-block.is-dragging'
  );
  assert.ok(
    cssCode.includes('will-change: transform;'),
    'TimelineEditor.css must set will-change: transform on dragging blocks'
  );
});
