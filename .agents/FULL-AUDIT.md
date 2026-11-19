# Full Subsystem Architecture Audit — .agents/FULL-AUDIT.md

**Date**: 2026-11-19  
**Branch**: `chore/full-project-cleanup`  
**Engineer**: Lead Principal Engineer (Minimal Change Engineer Methodology)

---

## 1. Frontend React Components and Hooks
- **`App.jsx`**: Central application state coordinator.
  - Mounts: `VideoPlayerPreview`, `TimelineEditor`, `InspectorPanel`, `SubtitlesView`, `ExportModal`, `SettingsModal`.
  - State hooks:
    - `useSeries`: manages series, episode selection, and background persistence (`handleSaveEpisodeBackground`).
    - `useMedia`: manages video selection, videoClips, active clip, selected segment.
    - `useProxyPreview`: manages full-mix 480p preview proxy polling, debounced POST enqueue, and `lastValidProxyUrlRef`.
    - `useSourceProxy`: manages fast 480p Source Proxy for Live Preview mode.
    - `usePlaybackEngine`: manages `currentTime`, `duration`, `isPlaying`, playhead RAF loop, seek handlers.
    - `useAudioDubbing`: manages Edge TTS generation, segment audio pooling, voice settings.
- **`VideoPlayerPreview.jsx`**:
  - Encapsulates HTML5 `<video>` element, canvas rendering for 9:16 / 1:1 / 16:9 aspect ratios, smart subtitle overlay, audio synchronization engine (both segment audio pool and master narration), and header status bar.
- **`TimelineEditor.jsx`**:
  - Multi-track timeline (Video, Dialogue/Voice 1..N, Subtitles 1..N, BGM).
  - Handles mouse/touch drag, move, trim-left, trim-right, split, ripple, zoom, and auto-follow.
  - Uses `TimelineTracksCanvas.jsx` for virtualized canvas rendering with 8s buffer and 2s hysteresis.

---

## 2. Backend APIs and Services
- **`server.js`**: Express server on port 5000 with CORS, raw range streaming support, error handling, crash recovery for dangling jobs.
- **`routes/seriesRoutes.js`**:
  - `GET /api/series`: lists series.
  - `GET /api/series/:id`: metadata and episodes.
  - `POST /api/series/:id/episodes/:epId/proxy-preview`: queue or status of full-mix proxy preview.
  - `GET /api/series/:id/episodes/:epId/proxy-preview`: status check for active proxy preview.
  - `GET /api/series/:id/episodes/:epId/source-proxy`: status or immediate enqueue of fast 480p Source Proxy.
- **`services/sourceProxyService.js`**:
  - Fast H.264/AAC 480p proxy of raw source video with keyframe interval (GOP 30) for fast seeking (<100ms) without decoding 1080p AV1 in real time. Deduplicated by sha256 hash.
- **`services/proxyPreviewService.js`**:
  - Queued rendering of proxy preview with cuts, audio mix, and keyframes. Debounced 2s on user edits (capped at 5s).
- **`services/proxyPreviewRenderer.js`**:
  - FFmpeg pipeline constructing complex filtergraph for timeline video cuts, portrait letterboxing/framing, and voice audio placement.

---

## 3. Timeline Editing and Segment Operations
- **`timelineOps.js`**:
  - Pure function invariants: `(state, args) => { state, applied, reason }`.
  - `deleteSegment`: deletes voice/subtitle segment without touching videoClips.
  - `deleteVideoClip`: converts dialogue range to merged Gap clip; continuous timeline duration [0, duration].
  - `deleteGap`: ripples film left by exact gap duration D. Segments starting >= gap end shift left by D.
  - `splitClip`: splits video clip or segment at playhead. Micro-segment guard prevents clips < 0.3s.
  - `autoAlign`: moves non-shifted voice clips around fixed `userShifted` anchors. Hard count guard: `segments.length in == out`.
  - `trimClip`: trims left/right edge with min-duration (0.2s) and boundary checks.
  - `moveClip`: moves video clip or segment with non-overlap validation on the target row.

---

## 4. Voice Clip Drag, Move, Resize, Ripple, and Gap Behavior
- **Dragging Lifecycle**:
  - `handleMouseDown`: captures initial coordinates (`origStart`, `origEnd`, `origRow`).
  - `handleMouseMove`: calculates deltaX -> `newStart`, deltaY -> lane shift (`trackRow`).
  - `scheduleVoiceDragScrub`: scrubs video frame to clip start during paused drag, guarded by `videoRef.current.seeking`.
  - `handleMouseUp`: invokes `moveClipOp`.
    - If `wasPlayingOnDrop` is true, does NOT jump playhead back to clip start.
    - If paused, locks focus for 900ms and seeks video to dropped clip start.

---

## 5. Video Playback and Source Selection
- **Source Hierarchy**:
  1. `renderedVideo` (Proxy Preview MP4: `proxy-[hash].mp4`) if in `proxy` preview mode.
  2. `sourceProxy.url` (`source-proxy.mp4`) if in `live` preview mode and source proxy is ready.
  3. `selectedVideo.videoUrl` (raw uploaded video) fallback if source proxy is transcoding or disabled.
- **Invariant**: Switching preview mode or invalidating proxy preview MUST NOT drop active playback.

---

## 6. Source Proxy Generation, Cache, and Invalidation
- Stored at `uploads/source_proxies/[sourceHash]/source-proxy.mp4`.
- Validated via `source-proxy.json` manifest.
- Reused across all episodes sharing the same source video. Zero duplicate transcode jobs.

---

## 7. Proxy Preview Generation and Rendering
- Stored at `uploads/projects/[seriesId]/episodes/[episodeId]/proxy-[revision].mp4`.
- Cached via `proxy-preview.json`.
- Fingerprint based on files mtime and JSON snapshot of clips and voice segments.

---

## 8. HTML5 Video Seeking, Buffering, and Decoding
- Seeking is mediated by `useVideoPlayback.js:handleSeek`.
- Video element `readyState` checked: rejects seeks when `readyState === 0`.
- Stale frame guard in rVFC loop: ignores queued frames while `pendingSeekTargetRef` is active.

---

## 9. Khmer TTS Narration Scheduling
- Two distinct modes:
  1. `hasSegmentAudios === true`: individual segment audio elements cached in `segmentAudioPoolRef`, synchronized within 60Hz loop by `syncSegmentAudiosAtTime`.
  2. `hasSegmentAudios === false`: master narration audio (`fullAudioUrl`) synchronized via `narrationAudioRef`.
- When `renderedVideo` is active, segment and master audios are paused because the audio mix is baked into the proxy MP4.

---

## 10. BGM and Audio Synchronization
- Clean BGM (`no_vocals.wav`) from Demucs stem isolation:
  - Synchronized via `cleanBgAudioRef` during live playback when `voiceSettings.enableDemucs` is true.
  - Automatically muted/paused during proxy preview mode.

---

## 11. Playhead and Timeline Synchronization
- Dual synchronization architecture:
  - High-frequency GPU playhead: direct DOM transform on `playheadRef` via `requestVideoFrameCallback` (or `requestAnimationFrame`).
  - Low-frequency React state update: throttled to ~200ms (~5fps) in `useVideoPlayback.js` to eliminate unnecessary React tree re-renders.

---

## 12. React State Updates and useEffect Dependencies
- Verified dependency arrays across `VideoPlayerPreview.jsx`, `useVideoPlayback.js`, and `useProxyPreview.js`.
- Identified critical dependency: `isPlaying` must be accurately synced between HTML5 `<video>` events and React state.

---

## 13. Event Listeners, Timers, and rAF Loops
- All rAF loops in `TimelineTracksCanvas.jsx` and `TimelineEditor.jsx` include proper cleanup in effect returns.
- Polling timers in `useProxyPreview.js` and `useSourceProxy.js` are properly cleared on unmount.

---

## 14. Async Operations and Race Conditions
- Video source changes reset media element. If `v.play()` is invoked before or after `loadedmetadata` without synchronizing React `isPlaying`, the UI and audio engines stall.

---

## 15. File Loading, Uploads, Persistence, and Error Handling
- Safe path resolution in `backend/utils/pathUtils.js` enforces upload boundaries.
- Episode state saved asynchronously via `handleSaveEpisodeBackground` with local state fallback.

---

## 16. Export and Rendering Pipelines
- Export executes via `backend/workers/exportWorker.js` and `ffmpegService.js` using identical segment coordinate mappings as `timelineOps.js`.

---

## 17. Resource Cleanup and Memory Usage
- Media element audio pool enforces maximum active element count.
- Canvas virtualizer renders only the viewport + 8s buffer.
