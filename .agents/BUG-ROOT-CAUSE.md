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

---

## Verified Bug 4: Paused Watchdog Mutating currentTime Interrupting In-Flight Decoding (P0)

### Symptoms
When moving or dragging voice clips in paused mode on dense episodes (`Pseudo_Spiritual_Root`, 221 segments), after Move 4–6 video currentTime would reset or freeze (`delta = 0.00s`), and media element logged `[media] stalled` or `ready state = 1` indefinitely.

### Code Path
`frontend/src/hooks/useVideoPlayback.js` lines 423–450.

### Root Cause
1. In `useVideoPlayback.js`, a stall watchdog timer ran every 1200ms.
2. Even when `v.paused === true`, if `v.seeking === true` during an in-flight byte-range fetch for video frames, the watchdog executed:
   `v.currentTime = unfreezeTarget;`
3. This unexpected mutation aborted Chrome's active media byte-range request for `source-proxy.mp4`, throwing Chrome into an aborted/stalled state where `networkState = 2`, `seeking = true`, and `readyState = 1`.

### Surgical Fix
- In `frontend/src/hooks/useVideoPlayback.js`:
  - When `v.paused` is true, the watchdog immediately resets internal counters and returns without mutating `v.currentTime`.
  - Paused video is allowed to finish decoding without artificial timer interference.

---

## Verified Bug 5: HTTP/1.1 Socket Saturation from Concurrent Full-State Sync Calls (P0)

### Symptoms
Dragging voice clips on episodes with large metadata (`Pseudo_Spiritual_Root`, 17.5 MB `series.json`) caused playback, scrubbing, and frame decoding to freeze. Network logs showed `net::ERR_ABORTED` and backend reported `BadRequestError: request aborted (ECONNABORTED)`.

### Code Path
- `frontend/src/hooks/useClipOperations.js` (lines 804, 852)
- `frontend/src/components/timeline/TimelineEditor.jsx` (line 1458)
- `frontend/src/hooks/useSeriesManager.js` (line 478)
- `frontend/src/utils/projectStorage.js` (line 1289)

### Root Cause
1. Chrome enforces a strict limit of **6 concurrent HTTP/1.1 connections** per origin (`localhost:5173`).
2. On every single voice clip drop:
   - `persistTimelineOperationApi` fired immediately (587 KB).
   - `TimelineEditor.jsx` passed `immediate = true` to `onUpdateSegments`, triggering `syncTimelineAudioApi` after only 350ms.
   - `useSeriesManager.js`'s 400ms debounced effect called `saveEpisodeState`, which triggered `syncSeriesToBackend(series)` -> `POST /api/series/Pseudo_Spiritual_Root/sync`, downloading 17.5 MB of JSON!
   - `useProxyPreview.js` fired `POST .../proxy-preview` (1 MB).
3. When the user performed consecutive moves, Chrome aborted earlier in-flight POST requests, causing reverse-proxy socket churn on Vite/Express.
4. All 6 sockets were saturated uploading and aborting multi-megabyte JSON payloads, queuing `<video>` range requests (`GET /uploads/source_proxies/.../source-proxy.mp4`) for up to 3 seconds in Chrome's network queue.
5. With no data arriving, `<video>` stayed in `seeking = true, readyState = 1`, freezing preview and playback.

### Surgical Fix
1. In `frontend/src/hooks/useClipOperations.js`:
   - Debounced `persistTimelineOperationApi` with a 600ms trailing timer (`persistTimeoutRef`).
   - Called `suppressNextBackendSync(5000)` on drop so `useSeriesManager` does not trigger redundant 17.5 MB full-series syncs while editing.
   - Synchronous local storage persistence (`saveTimelineOperationToLocalStorage`) remains instant at 0ms.
   - Increased audio sync debounce to 800ms (`immediate`) / 1800ms (`non-immediate`).
2. In `frontend/src/components/timeline/TimelineEditor.jsx`:
   - Line 1458: Passed `immediate = false` on drop so audio re-sync waits until editing operations settle.
3. In `frontend/src/components/player/VideoPlayerPreview.jsx`:
   - Added `if (!isPlayingRef.current) return;` to `preloadSegmentsAroundTime` so segment audio preloads never consume sockets while paused/dragging.
4. In `frontend/src/hooks/useProxyPreview.js`:
   - Increased check debounce to 1200ms when not initial open, preventing socket teardown during rapid edits.

