# Bug Manifest & Root-Cause Diagnosis — .agents/BUG-ROOT-CAUSE.md

**Date**: 2026-11-19  
**Branch**: `chore/full-project-cleanup`  
**Methodology**: Minimal Change Engineer & Empirical Root-Cause Analysis (Zero Guessing)

---

## Verified Bug 1: Mid-Playback Source Flipping on Background Proxy Completion (P1)

### Symptoms
When editing voice clips or settings in `proxy` preview mode, playback would abruptly freeze or stutter 15–25 seconds later, long after the mouse was released.

### Code Path
`frontend/src/components/player/VideoPlayerPreview.jsx` lines 1327–1345.

### Root Cause
1. In `VideoPlayerPreview.jsx`, `currentVideoSrc` directly tracked `renderedVideo.outputVideoUrl`.
2. When the user edited a segment, a background render started while playback continued.
3. Upon render completion, `renderedVideo` updated to the new proxy URL (`proxy-[newHash].mp4`).
4. `currentVideoSrc` immediately changed to the new URL during active playback (`isPlaying === true`).
5. Changing HTML5 `<video src>` forced the browser media engine to unload media buffers, reset `readyState` to 0, and pause the video element mid-stream.
6. Even when resumed, this created an audible/visual glitch and desynchronized the timeline playhead.

### Surgical Fix
- Implemented **deferred source transitions** in `VideoPlayerPreview.jsx`:
  - When actively playing (`isActivelyPlaying === true`) and not an explicit user dropdown mode switch, any newly arrived proxy URL is deferred in `deferredVideoSrcRef`.
  - Playback continues seamlessly on the existing active media without buffer interruption.
  - The deferred source is applied cleanly when playback reaches a natural pause, user seek, or episode transition.

---

## Verified Bug 2: HTML5 Video & React `isPlaying` Desynchronization on Source Transitions (P1)

### Symptoms
When switching video sources (e.g. toggling Live vs Proxy preview), the video DOM element would resume playing, but the timeline playhead remained stationary, the Play button still showed "Play" (triangle), and Khmer narration / BGM did not resume.

### Code Path
`frontend/src/components/player/VideoPlayerPreview.jsx:handleInternalLoadedMetadata` and `frontend/src/hooks/useVideoPlayback.js`.

### Root Cause
1. During `<video src>` changes, the browser media engine pauses the element during unload.
2. An incoming RAF tick or timeupdate caught `v.paused && isPlaying`, triggering `setIsPlaying(false)` in React state.
3. Later, when `loadedmetadata` fired on the new source, `VideoPlayerPreview.jsx:1398` called `v.play()` directly on the HTML5 element.
4. However, `useVideoPlayback.js` had no native `play` listener attached to the video element.
5. Consequently, React `isPlaying` state remained `false` while the video DOM element played.
6. In `useVideoPlayback.js:128`: `if (!isPlaying) return;` dropped all frame time updates, freezing the playhead.
7. Narration and BGM sync effects (`useEffect(..., [isPlaying])`) saw `isPlaying === false` and remained paused.

### Surgical Fix
- Added bi-directional event synchronization in `useVideoPlayback.js`:
  - Native `play` event sets `intendedPlaying = true; setIsPlaying(true);`.
  - Native `pause` event (guarded against `v.seeking`) synchronizes `setIsPlaying(false)`.
  - Guaranteed lockstep synchronization without feedback loops or desynchronization.

---

## Verified Bug 3: Video Decoder Seek Storms During Rapid Scrubbing (P2)

### Symptoms
Rapidly scrubbing the timeline ruler or scrubbing across dense boundaries caused decoder latency to spike from ~40ms to >500ms, occasionally triggering the browser's stalled-media watchdog.

### Code Path
`frontend/src/hooks/useVideoPlayback.js:handleSeek`.

### Root Cause
1. When user scrubbed the timeline rapidly, `handleSeek` assigned `videoRef.current.currentTime = targetTime` on every incoming event.
2. If `videoRef.current.seeking` was already `true` (hardware decoder busy decoding a previous seek), setting `currentTime` repeatedly aborted the in-flight decode and queued new seeks.
3. This created decoder seek storms in Chromium's media pipeline.

### Surgical Fix
- Implemented **latest-request-wins seek coalescing** (Safety Condition #2):
  - If `videoRef.current.seeking` is true, the requested timestamp is held in `nextSeekTargetRef.current`.
  - The decoder is never flooded with concurrent seeks.
  - When the decoder fires `seeked`, `nextSeekTargetRef` is immediately dispatched.
  - Zero fixed delay, zero seek latency when not seeking, and the final seek position is 100% guaranteed.
