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

test('Episode switch cancels old decodes and playback preloads only two selected audio URLs', async t => {
  const { WebAudioScheduler } = await import('../../frontend/src/utils/webAudioScheduler.js');
  const scheduler = new WebAudioScheduler();
  const calls = [];
  t.mock.method(globalThis, 'fetch', (url, { signal }) => {
    calls.push({ url, signal });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  });
  scheduler.ensureContext = () => ({});
  const segments = [2, 0, 1, 3].map(startSec => ({
    startSec,
    audioUrl: '/clip-' + startSec,
    voiceAudioVariants: { other: { audioUrl: '/unselected' } },
  }));
  scheduler.preloadUpcoming(segments, 0);
  scheduler.preloadUpcoming(segments, 0);
  assert.deepEqual(calls.map(call => call.url), ['/clip-0', '/clip-1']);
  const old = [...scheduler.lruCache.inflight.values()];
  scheduler.lruCache.cancelPending();
  scheduler.preloadUpcoming(segments, 0);
  await Promise.all(old);
  assert.ok(calls[0].signal.aborted);
  assert.equal(scheduler.lruCache.inflight.size, 2);
  scheduler.destroy();
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

  const videoPlayerSrc =
    fs.readFileSync(path.join(rootDir, 'frontend/src/components/player/VideoPlayerPreview.jsx'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(rootDir, 'frontend/src/components/player/usePlayerAudioSync.js'), 'utf8');
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

test('ConCaT Architecture: 5. WebAudioScheduler cleans up deleted or moved nodes immediately on sync tick', async () => {
  const { WebAudioScheduler } = await import('../../frontend/src/utils/webAudioScheduler.js');
  const scheduler = new WebAudioScheduler({ maxCachedBuffers: 50 });

  // Provide mock context so syncAtTimelineTime runs in Node test environment
  scheduler.ctx = { currentTime: 0 };
  scheduler.masterGain = { gain: { value: 1, setValueAtTime: () => {} } };

  let stoppedCount = 0;
  const mockNode = () => ({
    sourceNode: {
      stop: () => { stoppedCount++; },
      disconnect: () => {},
      playbackRate: { value: 1, setValueAtTime: () => {} },
    },
    gainNode: {
      disconnect: () => {},
      gain: { value: 1, setValueAtTime: () => {} },
    },
    segStart: 5.0,
    segEnd: 8.0,
    url: '/audio/seg1.mp3',
    startedAtCtx: 0,
  });

  scheduler.scheduledNodes.set('seg_1', mockNode());
  assert.equal(scheduler.scheduledNodes.size, 1);

  // Case A: seg_1 was DELETED from segments list -> must be stopped and pruned immediately
  scheduler.syncAtTimelineTime({
    timelineNow: 5.2,
    segments: [], // empty -> seg_1 deleted
  });
  assert.equal(scheduler.scheduledNodes.size, 0);
  assert.equal(stoppedCount, 1, 'Deleted segment must be stopped immediately');

  // Case B: seg_1 was MOVED from 5.0s to 10.0s -> stale node must be stopped and pruned immediately
  stoppedCount = 0;
  scheduler.scheduledNodes.set('seg_1', mockNode());
  scheduler.syncAtTimelineTime({
    timelineNow: 5.2,
    segments: [{ id: 'seg_1', audioStartSec: 10.0, audioEndSec: 13.0, audioUrl: '/audio/seg1.mp3' }],
  });
  assert.equal(scheduler.scheduledNodes.size, 0, 'Moved segment stale node must be purged');
  assert.equal(stoppedCount, 1, 'Moved segment stale node must be stopped');
});

test('ConCaT Architecture: 6. WebAudioScheduler stops same-lane clip when next adjacent clip starts (Zero-Bleed)', async () => {
  const { WebAudioScheduler } = await import('../../frontend/src/utils/webAudioScheduler.js');
  const scheduler = new WebAudioScheduler({ maxCachedBuffers: 50 });

  scheduler.ctx = { currentTime: 0 };
  scheduler.masterGain = { gain: { value: 1, setValueAtTime: () => {} } };

  let stoppedCount = 0;
  scheduler.scheduledNodes.set('seg_1', {
    sourceNode: {
      stop: () => { stoppedCount++; },
      disconnect: () => {},
      playbackRate: { value: 1, setValueAtTime: () => {} },
    },
    gainNode: {
      disconnect: () => {},
      gain: { value: 1, setValueAtTime: () => {} },
    },
    segStart: 0.1,
    segEnd: 1.2, // Seg 1 ends at 1.2s when next starts
    url: '/audio/seg1.mp3',
    startedAtCtx: 0,
  });

  // Seg 1 slot: 0.1s - 1.35s (overflowing). But Seg 2 starts at 1.2s on same lane (trackRow: 0).
  // When timeline reaches 1.201s, seg_1 must be hard-stopped so it does not bleed into seg_2!
  const segments = [
    { id: 'seg_1', audioStartSec: 0.1, audioEndSec: 1.35, trackRow: 0, audioUrl: '/audio/seg1.mp3' },
    { id: 'seg_2', audioStartSec: 1.2, audioEndSec: 2.5, trackRow: 0, audioUrl: '/audio/seg2.mp3' },
  ];

  scheduler.syncAtTimelineTime({
    timelineNow: 1.21,
    segments,
  });

  assert.equal(scheduler.scheduledNodes.has('seg_1'), false, 'seg_1 must be removed when timeline reaches seg_2 start');
  assert.equal(stoppedCount, 1, 'seg_1 must be stopped at seg_2 start to prevent audio collision');
});
