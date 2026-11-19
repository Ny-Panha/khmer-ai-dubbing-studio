import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

test('ConCaT Architecture: 1. AudioBufferLRUCache maintains bounded memory and LRU eviction', async () => {
  const { AudioBufferLRUCache } = await import('../../frontend/src/utils/webAudioScheduler.js');
  const cache = new AudioBufferLRUCache(3);

  assert.equal(cache.size(), 0);
  assert.equal(cache.has('/audio/clip1.mp3'), false);

  // Add 3 clips
  cache.set('/audio/clip1.mp3', { length: 24000 }, 0.05);
  cache.set('/audio/clip2.mp3', { length: 48000 }, 0.08);
  cache.set('/audio/clip3.mp3', { length: 72000 }, 0.02);
  assert.equal(cache.size(), 3);
  assert.equal(cache.has('/audio/clip1.mp3'), true);

  // Access clip1 to make it freshly used
  const entry1 = cache.get('/audio/clip1.mp3');
  assert.ok(entry1);
  assert.equal(entry1.leadSkipSec, 0.05);

  // Add 4th clip: clip2 should be evicted (as clip1 was touched and clip3 is newer)
  cache.set('/audio/clip4.mp3', { length: 12000 }, 0.01);
  assert.equal(cache.size(), 3);
  assert.equal(cache.has('/audio/clip4.mp3'), true);
  assert.equal(cache.has('/audio/clip1.mp3'), true, 'Recently accessed clip1 must be preserved');
  assert.equal(cache.has('/audio/clip2.mp3'), false, 'Oldest unaccessed clip2 must be evicted');

  cache.clear();
  assert.equal(cache.size(), 0);
});

test('ConCaT Architecture: 2. WebAudioScheduler fallback & state lifecycle', async () => {
  const { WebAudioScheduler } = await import('../../frontend/src/utils/webAudioScheduler.js');
  const scheduler = new WebAudioScheduler({ maxCachedBuffers: 50 });

  // In Node.js environment without window.AudioContext, isSupported() must return false cleanly
  assert.equal(scheduler.isSupported(), false);
  const diag = scheduler.getDiagnostics();
  assert.equal(diag.isSupported, false);
  assert.equal(diag.activeNodesCount, 0);

  // Calling syncAtTimelineTime, stopAll, preloadUpcoming must not throw when unsupported
  assert.doesNotThrow(() => {
    scheduler.syncAtTimelineTime({
      timelineNow: 5.0,
      playbackRate: 1.0,
      segments: [{ id: 1, audioStartSec: 4.8, audioEndSec: 7.2, audioUrl: '/test.mp3' }],
    });
    scheduler.stopAll();
    scheduler.destroy();
  });
});

test('ConCaT Architecture: 3. Accurate magnetic snap to 0, playhead, and clip boundaries', async () => {
  const { computeVoiceDragPosition } = await import('../../frontend/src/utils/timelineUtils.js');

  const segments = [
    { id: 1, trackRow: 0, audioStartSec: 5.0, audioEndSec: 8.0 },
    { id: 2, trackRow: 0, audioStartSec: 10.0, audioEndSec: 13.0 },
  ];

  // A. Snap to 0s
  const snapZero = computeVoiceDragPosition({
    origStart: 2.0,
    origEnd: 4.0,
    proposedStart: 0.05, // very close to 0 (< 8/45 = 0.177s)
    draggedIndex: -1,
    curRow: 0,
    targetRow: 0,
    scriptSegments: segments,
    segmentRows: [0, 0],
    snappingEnabled: true,
    pps: 45,
  });
  assert.equal(snapZero.newStart, 0, 'Should snap cleanly to 0s');
  assert.equal(snapZero.snapTime, 0, 'Snap guide should highlight 0s');

  // B. Snap to Playhead (currentTime = 7.5s)
  const snapPlayhead = computeVoiceDragPosition({
    origStart: 15.0,
    origEnd: 17.0,
    proposedStart: 7.55, // within 0.177s of playhead 7.5
    draggedIndex: -1,
    curRow: 1, // on voice row 1 so no row 0 collision
    targetRow: 1,
    scriptSegments: segments,
    segmentRows: [0, 0],
    snappingEnabled: true,
    pps: 45,
    currentLiveTime: 7.5,
  });
  assert.equal(snapPlayhead.newStart, 7.5, 'Should snap cleanly to playhead 7.5s');
  assert.equal(snapPlayhead.snapTime, 7.5, 'Snap guide should highlight playhead');

  // C. Snap to adjacent clip boundary (segment 1 ends at 8.0)
  const snapClip = computeVoiceDragPosition({
    origStart: 15.0,
    origEnd: 18.0,
    proposedStart: 8.08, // within 0.177s of previous clip end 8.0
    draggedIndex: 1, // segment 2
    curRow: 0,
    targetRow: 0,
    scriptSegments: segments,
    segmentRows: [0, 0],
    snappingEnabled: true,
    pps: 45,
  });
  assert.equal(snapClip.newStart, 8.0, 'Should snap cleanly to adjacent clip boundary at 8.0s');
  assert.equal(snapClip.snapTime, 8.0);

  // D. Snapping disabled: no snap to 0 or playhead or clip
  const noSnap = computeVoiceDragPosition({
    origStart: 2.0,
    origEnd: 4.0,
    proposedStart: 0.05,
    draggedIndex: -1,
    curRow: 0,
    targetRow: 0,
    scriptSegments: segments,
    segmentRows: [0, 0],
    snappingEnabled: false,
    pps: 45,
    currentLiveTime: 7.5,
  });
  assert.equal(noSnap.newStart, 0.05, 'When snapping is OFF, exact pointer position is preserved');
  assert.equal(noSnap.snapTime, null, 'No snap guide line when snapping is OFF');
});

test('ConCaT Architecture: 4. Static Invariant Audit: Cooperative priority, gesture semantics, and Diagnostics panel', () => {
  const thumbnailSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/utils/thumbnailUtils.js'), 'utf8');
  assert.ok(
    thumbnailSrc.includes('window.__timelineIsActiveScrubbing') &&
    thumbnailSrc.includes('window.__timelineIsDragging') &&
    thumbnailSrc.includes('window.__timelineIsPlaying'),
    'thumbnailUtils must cooperatively yield when timeline is scrubbing, dragging, or playing'
  );

  const proxyPreviewSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useProxyPreview.js'), 'utf8');
  assert.ok(
    proxyPreviewSrc.includes('window.__timelineIsPlaying') &&
    proxyPreviewSrc.includes('12000'),
    'useProxyPreview must back off polling during active playback to prioritize video decoder'
  );

  const sourceProxySrc = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useSourceProxy.js'), 'utf8');
  assert.ok(
    sourceProxySrc.includes('window.__timelineIsPlaying') &&
    sourceProxySrc.includes('5000'),
    'useSourceProxy must back off polling during active playback'
  );

  const timelineEditorSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');
  assert.ok(
    timelineEditorSrc.includes('window.__timelineIsDragging = true') &&
    timelineEditorSrc.includes('window.__timelineIsDragging = false') &&
    timelineEditorSrc.includes('window.__timelineIsPlaying = isPlaying'),
    'TimelineEditor must publish cooperative timeline state flags to window'
  );
  assert.ok(
    timelineEditorSrc.includes('currentLiveTime: currentTimeRef.current || 0'),
    'TimelineEditor must pass currentLiveTime to computeVoiceDragPosition for magnetic playhead snap'
  );

  const videoPlayerSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/components/player/VideoPlayerPreview.jsx'), 'utf8');
  assert.ok(
    videoPlayerSrc.includes('WebAudioScheduler'),
    'VideoPlayerPreview must integrate WebAudioScheduler'
  );
  assert.ok(
    videoPlayerSrc.includes('player-diagnostics-panel') &&
    videoPlayerSrc.includes('btn-diagnostics-pill'),
    'VideoPlayerPreview must render collapsible Diagnostics panel and toggle button'
  );
  assert.ok(
    videoPlayerSrc.includes('seekStartMsRef.current') &&
    videoPlayerSrc.includes('setSeekLatencyMs'),
    'VideoPlayerPreview must measure and display real seek latency'
  );
  assert.ok(
    videoPlayerSrc.includes('getVideoPlaybackQuality') &&
    videoPlayerSrc.includes('droppedVideoFrames'),
    'VideoPlayerPreview must monitor dropped frames via getVideoPlaybackQuality'
  );
  assert.ok(
    videoPlayerSrc.includes('btn-engine-toggle') &&
    videoPlayerSrc.includes('Web Audio (ConCaT)') &&
    videoPlayerSrc.includes('HTMLAudio Pool'),
    'VideoPlayerPreview must allow runtime toggling between Web Audio and HTMLAudio Pool'
  );
});
