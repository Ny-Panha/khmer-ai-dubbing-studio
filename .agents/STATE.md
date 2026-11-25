# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T16:17:00+07:00

## Summary
- **Smooth Episode Switching + Instant Timeline + Stable Playback (`PASS` — continued from Codex's partial working tree):**
  1. **Preserved Codex Changes & Completed Implementation:**
     - **Episode Switching & Per-Episode Metadata (`backend/routes/seriesRoutes.js`, `frontend/src/hooks/useSeriesManager.js`, `frontend/src/utils/projectStorage.js`, `frontend/src/services/api/mediaApi.js`):**
       - Preserved per-episode `GET /api/series/:seriesId/episodes/:episodeId` with ETag/`304`, coalesced partial-episode sync (`Prefer: return=minimal` + `sessionStorage` recovery), and bounded LRU workspace cache.
       - Added deterministic fallback IDs (`clip-${ep.id}-full`, `asset-${ep.id}`), cached normalized clips & duration inside `readWorkspace`, fixed `validate()` metadata race, and wired bounded adjacent-episode preloading (`idx - 1`, `idx + 1`) for episode metadata, read-only `source-proxy` status, and waveform peaks.
     - **Playback & Audio Isolation (`frontend/src/hooks/useVideoPlayback.js`, `frontend/src/App.jsx`, `frontend/src/components/player/VideoPlayerPreview.jsx`, `frontend/src/components/player/usePlayerAudioSync.js`, `frontend/src/utils/webAudioScheduler.js`, `frontend/src/components/media/DubbingModeTab.jsx`):**
       - Preserved Codex's episode-change video source guard (`!episodeChanged`), Demucs `videoPath` scoping, and `AbortController` audio decode cancellation.
       - Added `episodeKey` reset in `useVideoPlayback.js` so switching while playing cleanly pauses and resets `intendedPlayingRef`, `lastMappedTimelineTimeRef`, `activeClipIdxRef`, and seek refs (fixing the EP25→EP26 audio miss and leaked timestamp).
     - **Real Decoded Waveform Peaks & Persistence Without TTS (`backend/routes/seriesRoutes.js`, `frontend/src/utils/waveformCache.js`, `frontend/src/components/timeline/TimelineTracksCanvas.jsx`, `frontend/src/components/timeline/TimelineEditor.css`):**
       - Preserved Codex's removal of fake `FALLBACK_WAVEFORM_PATTERN` bars and SVG waveform rendering.
       - Added lightweight episode-scoped `GET/POST /api/series/:seriesId/episodes/:episodeId/waveform-peaks` (`waveform-peaks.json` sidecar, never touching `series.json` or TTS provenance) and `waveformCache.js` (bounded 1024-entry LRU, concurrency-4 post-paint decode, batch persistence, and adjacent-episode prefetch).
       - Eliminated duplicate `internalSegmentRows` work and $O(N^2)$ `videoClips.findIndex` in `TimelineTracksCanvas.jsx`.
     - **Proxy Caching & Playback Priority (`backend/services/proxyPreviewRenderer.js`, `backend/services/proxyPreviewService.js`, `backend/services/sourceProxyService.js`, `frontend/src/hooks/useProxyPreview.js`, `frontend/src/hooks/useSourceProxy.js`, `frontend/src/utils/thumbnailUtils.js`):**
       - Preserved Codex's `PRIORITY_BELOW_NORMAL` / `-threads 2` throttling, single active + 1 waiting `sourceProxyService` queue, and `1200ms` transient-navigation debounce in `useProxyPreview.js`.
       - Added bounded episode-scoped LRU caches in `useProxyPreview.js` and `useSourceProxy.js`, deferred `JSON.stringify` out of render in `useProxyPreview.js`, deferred proxy `POST` during active playback, and yielded `proxyPreviewService.drain()` while `sourceProxyService.activeJobs.size > 0`.
  2. **Verification Results (`ss1` EP24–EP26, Before vs After):**
     - **Backend Regression Suites (`node --test`, 10 suites):** **63 passed, 0 failed** (`concat_playback_and_timeline`, `source_proxy`, `proxy_preview`, `timeline_playback_stall_guard`, `timeline_voice_true_extent_rendering`, `timeline_continuous_playback_no_loop`, `playback_sync_and_deferred_source_regression`, `stability_no_phantom_restart_and_proxy_guard`, `episode_state_isolation`, `series_persist_and_sync`).
     - **Frontend Build & Lint:** `npm --prefix frontend run build` (`0` errors, `2053` modules) and `npm --prefix frontend run lint` (`0` errors, `610` pre-existing warnings).
     - **Playwright `bench.cjs` (Before vs After on `ss1` EP24–EP26):**
       - Full-series `GET /api/series/ss1` during 30 rapid switches: **30 -> 0**.
       - End-state video/script alignment after 30 rapid switches: **Before: stuck on EP25 video while UI/script on EP26 -> After: EP26 video, script, voice, and waveform aligned (`valid: true`, `script: true`)**.
       - Warm UI / voice / waveform (clean run): **Before: 112–169ms (fake fallback bars) -> After: 33–90ms (median 61.5ms; EP24 33–44ms, EP25 53–90ms, EP26 60–73ms) with real decoded & persisted peaks**.
       - Warm first video frame (clean run): **Before: EP24/EP26 missing frame, EP25 136–158ms (wrong/unmatched proxy) -> After: 240–279ms median 278.5ms (<300ms target on warm proxy/source-proxy)**.
       - Playback samples (3/3): **Before: 2/3 failed (`missing Play`) -> After: 3/3 passed (`advance: 1.36–1.38s`, `stalls: 0`, `first: 87–97ms`, `dropped: 0–1/42`)**.
       - Unnecessary TTS requests: **0**. Page/console errors: **0**.
     - **Playwright `ident.cjs` (EP24 -> EP25 -> EP26 -> EP25 audio SHA-256 + edit persistence):**
       - **Before/Mid-Codex:** EP26 failed (`missing: true`, leaked EP25 audio/timestamp `t=10.33s`).
       - **After:** **4/4 episodes verified** with exact disk SHA-256 MP3 match (`ctx: running`, `wrongAudio: []`), `edits: { returned: true, persisted: true, reloaded: true, neighborsUnchanged: true, restored: true }`, `tts: []`, `errors: []`.
     - **Playwright `rapid.cjs` (30 rapid Next/Prev switches, paused + playing):** `end.ep: ep_26`, `valid: true`, `script: true`, `requestCount: 0`, `errors: []`.

## Active Environment
- Backend Server: `http://localhost:5000` (restart backend server to load updated `seriesRoutes.js` & `proxyPreviewService.js` when testing live)
- Frontend Dev: `http://localhost:5173`
- Branch: `chore/full-project-cleanup`

## Next Steps
- Unrelated local working-tree changes (OCR / speaker-ID / series-deletion-ghost from earlier tasks) were intentionally left unstaged/untouched per task restrictions.
