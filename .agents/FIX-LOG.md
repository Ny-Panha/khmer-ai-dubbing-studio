# Surgical Fix Log — .agents/FIX-LOG.md

**Date**: 2026-11-19  
**Branch**: `chore/full-project-cleanup`  
**Discipline**: Minimal Change Engineer — Smallest Diff, Zero Scope Creep

---

## Summary of Changes

### 1. `frontend/src/components/player/VideoPlayerPreview.jsx`
- **Lines Changed**: +19, -2
- **Diff Explanation**:
  - Replaced immediate `currentVideoSrc` calculation with `targetVideoSrc` + `deferredVideoSrcRef`.
  - Added check: if actively playing and not an explicit dropdown mode toggle, defer applying newly finished background proxy renders until pause or seek.
  - Keeps active playback 100% continuous without buffer unload.

### 2. `frontend/src/hooks/useVideoPlayback.js`
- **Lines Changed**: +45, -0
- **Diff Explanation**:
  - Added `nextSeekTargetRef = useRef(null)`.
  - Added `useEffect` listening to native `play`, `pause`, and `seeked` events on `videoRef?.current`.
  - In `handleSeek`, if `videoRef.current.seeking` is true, stores latest target in `nextSeekTargetRef` and returns immediately.
  - In `seeked` event listener, dispatches `nextSeekTargetRef` if present.
  - Synchronizes React `isPlaying` state directly with HTML5 video element state, eliminating playhead freeze and audio desynchronization.

### 3. `backend/tests/playback_sync_and_deferred_source_regression.test.js`
- **Lines Added**: +103
- **Test Invariants Verified**:
  - `VideoPlayerPreview` deferred proxy hot-swap during active playback.
  - Latest-request-wins seek coalescing preserves final seek target without flooding decoder.
  - HTML5 video play/pause event sync prevents playhead freeze on source transitions.

---

## Stabilization Fixes: Voice Drag Freeze & HTTP Socket Saturation Elimination

### 4. `frontend/src/hooks/useVideoPlayback.js`
- **Diff Explanation**:
  - Disabled paused watchdog seek mutation: when `v.paused` is true, watchdog resets counters and returns without setting `v.currentTime = unfreezeTarget`.
  - Unified single-point play target in `handlePlayPause`: resolves target from `nextSeekTargetRef` or `mapTimelineToSourceTime` and executes exactly one seek.
  - Ensures decoder finishes range requests cleanly without aborted seeks.

### 5. `frontend/src/components/player/VideoPlayerPreview.jsx`
- **Diff Explanation**:
  - In `preloadSegmentsAroundTime`: added `if (!isPlayingRef.current) return;` so paused video has 100% exclusive priority over HTTP/1.1 sockets for video frame fetching.
  - Guarded `handlePlay` when `v.seeking` is true so audio playback does not race video frame loading.

### 6. `frontend/src/hooks/useClipOperations.js`
- **Diff Explanation**:
  - Added `persistTimeoutRef = useRef(null)` with 600ms trailing debounce for `persistTimelineOperationApi`.
  - Added `suppressNextBackendSync(5000)` on clip move to prevent 17.5 MB `POST /api/series/:id/sync` requests from `useSeriesManager` auto-persist effect.
  - Increased audio sync debounce to 800ms (`immediate`) / 1800ms (`non-immediate`).

### 7. `frontend/src/components/timeline/TimelineEditor.jsx`
- **Diff Explanation**:
  - Line 1458: Changed `onUpdateSegments(opResult.state.segments, false, true)` to `onUpdateSegments(opResult.state.segments, false, false)` so `immediate` is false.

### 8. `frontend/src/hooks/useProxyPreview.js`
- **Diff Explanation**:
  - Debounced proxy preview check to 1200ms when not initial open, eliminating fetch aborts and socket churn during editing.

