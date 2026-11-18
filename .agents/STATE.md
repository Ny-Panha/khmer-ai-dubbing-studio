# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T19:56:30+07:00

## Summary: Auto-Cut by Subs Cuts Cleanly at Every Dialogue Start (Zero Leftover Absorption) (COMPLETED)
- **Root Cause**: `autoSplitVideoBySegments` in `frontend/src/utils/timelineUtils.js` only created a Gap when `it.start > curTime + 0.15`, absorbing up to `0.15s` of the previous scene's tail into the head of the next dialogue clip (`45` absorbed gaps on `Pseudo_Spiritual_Root/ep_5` alone). Additionally, `normalizeClip` enforced a `0.1s` minimum length even on Gap clips, which could stretch sub-`0.10s` Gaps into overlapping the next dialogue clip on reload.
- **Changes Applied**:
  1. `frontend/src/utils/timelineUtils.js`:
     - Removed the `0.15s` absorption threshold in `autoSplitVideoBySegments`: whenever `targetStart > gapStart` (any positive space >= 0.01s before the next dialogue start), emits a pure `Gap` clip `[gapStart, targetStart]` (`isDialogue: false`, `isMuted: false`, no `segmentId`/`segmentIndex`) and starts the dialogue clip **exactly** at `it.start`.
     - Same exact-tail check for `Outro` (`outroEnd > outroStart`).
     - Preserved the existing overlap clamp (`if (it.start < curTime)` clamps previous clip end to `Math.max(prevClip.start + 0.2, it.start)`), `isMuted: false` on all clips, and pure Gap objects.
     - Updated `normalizeClip` to use `minClipLen = isGapClip(clip) ? 0.01 : 0.1` so sub-`0.10s` pure Gaps remain exact and non-overlapping after episode reload.
  2. `backend/tests/timeline_auto_cut_exact_starts.test.js` *(new)*: Unit + static regression suite verifying exact dialogue starts for `<= 0.15s` and larger gaps (`0.08s, 0.11s, 0.07s, 0.45s`), zero-gap touching clips, overlap clamping, `normalizeClips` reload contiguity, `isMuted: false`, and pure Gap objects.
- **Verification Evidence**:
  - Real-app Playwright E2E on `Pseudo_Spiritual_Root` / `ep_5` (read-only, `series.json` byte-identical `true`, `0` console/page errors):
    - Clicking `Auto-Cut by Subs` on `ep_5` produced `420` clips (`219` dialogues, `200` pure Gaps, `1` Outro, `0` muted, `0` impure Gaps — recovering all `45` formerly absorbed leftover gaps).
    - Verified former leftover spots: `#6->#7` (`Gap 10.76–10.87`, `#7` @ `10.87`), `#14->#15` (`Gap 27.29–27.37`, `#15` @ `27.37`), `#16->#17` (`Gap 33.10–33.17`, `#17` @ `33.17`), `#18->#19` (`Gap 36.16–36.25`, `#19` @ `36.25`).
    - Verified `#8/#9` gap test: dragging voice `#9` right to `15.98s` (after `#8` end `15.67s`) and clicking `Auto-Cut by Subs` created pure `Gap [15.67, 15.98]` and started video clip `#9` at exact `15.98s`.
  - Frontend production build (`npm --prefix frontend run build`): **PASS** (`614ms`, 0 errors).
  - New suite (`backend/tests/timeline_auto_cut_exact_starts.test.js`): **3 / 3 PASS**. Full timeline + auto-align suites: **122 / 123 PASS** (sole failure is pre-existing `timeline_continuous_playback_no_loop.test.js` test #2 live-disk fixture expectation).

## Active Environment
- **Backend API**: `http://localhost:5000` (HTTP 200)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server on `chore/full-project-cleanup`)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` and click `Auto-Cut by Subs` to get exact dialogue-aligned cuts with zero leftover heads.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T19:38:30+07:00

## Summary: Real-Time Playhead & Video Preview Scrubbing During Paused Voice-Clip Move Drag (COMPLETED)
- **Feature**: When paused and dragging a VOICE clip horizontally on the timeline, the red playhead line and preview video frame follow the dragged clip's current start time in real time (showing the exact burned-in Chinese subtitle / scene frame under the clip as the owner drags). On release, the playhead stays at the dropped clip's start.
- **Changes Applied (strictly scoped to PAUSED voice-clip MOVE drags — never trim, never video/subtitle drags, never during playback)**:
  1. `frontend/src/utils/timelineUtils.js`: Added pure helper `resolveVoiceDragScrubTime({ itemType, mode, isPlaying, dragStartSec, totalDuration })` returning clamped timeline seconds ONLY when `!isPlaying && itemType === 'audio' && mode === 'move'`, and `null` otherwise.
  2. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - Added RAF-throttled `scheduleVoiceDragScrub(targetSec, segKey)` + `cancelVoiceDragScrub()` using refs (`voiceDragSeekRafRef`, `pendingVoiceDragSeekRef`, `lastVoiceDragSeekRef`, `isPlayingRef`, `onSeekRef`) so drag seeks are throttled to animation frames without being cancelled by React state re-renders, immediately update the GPU playhead (`playheadRef`) + pill timecode, and invoke the existing manual `onSeek` path.
     - Wired `resolveVoiceDragScrubTime` + `scheduleVoiceDragScrub` into `processMouseMove` strictly inside the `dragState.itemType === 'audio'` & `dragState.mode === 'move'` branch.
     - On `handleMouseUp`: cancels any pending drag-scrub RAF and leaves the playhead + `manualFocusLockRef` at the exact dropped clip's start (`droppedStart`, respecting any no-overlap clamp from `moveClipOp`), or restores `origStart` if drop is rejected.
     - Preserved all frozen playback rules: guarded manual drag-start/drop/scrub seeks with `!isPlaying`, leaving active playback, auto-follow suppression, and paused snap-back guards untouched.
  3. `backend/tests/timeline_voice_drag_scrub.test.js` *(new)*: Unit & static audit suite covering scope guards (paused voice move only; suppressed during playback, trim, video/subtitle drags), RAF throttling, drop-point retention, and frozen playback guards.
- **Verification Evidence**:
  - Real-app Playwright E2E on `Pseudo_Spiritual_Root` / `ep_5` (paused, read-only, `series.json` byte-identical `true`):
    - Dragged voice `#2` smoothly across `00:02–00:05` (`2.99s -> 2.50s -> 1.99s -> 2.59s -> 3.19s -> 3.79s -> 4.39s -> 4.99s -> 4.19s`): red playhead (`phSec`) matched `clipSec` 1:1 (`0.00s` diff), `video.currentTime` tracked continuously (`0.001s` diff), **9 / 9 distinct decoded video frames** rendered live, and `video.paused` remained `true` throughout.
    - On release (`+600ms` paused): playhead and video stayed at dropped start (`4.19s`), zero snap-back.
    - Pressed Play after drop: playback advanced smoothly forward (`5.04s -> 8.46s`) with zero loop and zero snap-back.
    - Negative scope check: dragging video clip `#5` did NOT scrub-seek playhead; `0` console/page errors.
  - Frontend production build (`npm --prefix frontend run build`): **PASS** (`656ms`, 0 errors).
  - New suite (`backend/tests/timeline_voice_drag_scrub.test.js`): **2 / 2 PASS**. Full timeline + auto-align suites: **119 / 120 PASS** (sole failure is pre-existing `timeline_continuous_playback_no_loop.test.js` test #2 live-disk fixture expectation).

## Active Environment
- **Backend API**: `http://localhost:5000` (HTTP 200)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server on `chore/full-project-cleanup`)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` and drag any voice clip while paused to see the red playhead and preview video frame scrub live with the clip start.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T19:31:30+07:00

## Summary: Fix Playback Freeze/Stall at `~00:07` (`#5 -> Gap`) in Both Live Edit & Rendered Preview (COMPLETED)
- **Step 0 Diagnosis Findings on `Pseudo_Spiritual_Root` / `ep_5` (219 segments, 378 videoClips, 0 clip anomalies)**:
  1. **Stored Data Layout (`00:04–00:11`)**:
     - `videoClips` (all contiguous 1:1 `start === sourceStart`, `end === sourceEnd`): `#4 (4.84–6.50)`, `Gap (6.50–7.71)`, `#5 (7.71–8.91)`, `#6 (8.91–9.40)`, `#7 (9.40–10.70)` (prior snapshot before owner's edit: `#5 6.11–8.43`, `Gap 8.43–8.91`, `#6 8.91–9.40`).
     - Segment `#5`: `startSec: 7.71, endSec: 10.03, audioStartSec: 7.71, audioEndSec: 10.03, audioDurationSec: 2.32, trackRow: 2 (voice-3 / VOICE 3), userShifted: true` (overlaps `#6: 8.91–9.40` on `VOICE 1`).
     - Media GOP / buffer alignment right at `~00:07`: `Pseudo_Spiritual_Root_ep_5_source.mp4` (93.5 MB AV1, keyframes at `0.015s, 5.015s, 10.015s`, initial buffer `[0, 6.75s]`) and `EP5_Khmer_Dubbed.mp4` (275 MB H.264 3.65 Mbps, keyframes at `0.000s, 8.533s`, 1 GOP = ~3.9 MB, first 3MB chunk ended at `6.88s`). Seeking back to `00:05` landed inside the initial buffer / on the `5.015s` keyframe.
  2. **Console / Network Failures Reproduced**:
     - Zero JS console/page errors; severe HTTP Range stalls observed: `LIVE_EDIT_MODE` stalled 4+s (`seeking: true, readyState: 1, networkState: 2, ev: stalled`, `seeked` never fired, 19 `net::ERR_ABORTED` on source MP4, 1 hung `GET ..._ep_5_source.mp4` open 10.6+s); `RENDERED_MODE` stalled 2.56s at `00:07.00` and 3.89s at `00:08.42` (4 `suspend` events) and 3.56s `respMs` header wait on `bytes=589824-` on `EP5_Khmer_Dubbed.mp4` due to Chromium's single-writer `HttpCache` entry lock across concurrent/throttled `206` range requests.
     - HTTP/1.1 6-connection origin pool saturation on `localhost:5173`: SSE `/api/jobs/stream` (1 permanent slot) + unchunked 101.26 MB Demucs `no_vocals.wav` (`bytes 0-106180651/106180652`, held open 11+s) + `thumbnailUtils.js` firing 15–18 aborted MP4 range seeks while playing + `preloadSegmentsAroundTime` (`14` `new Audio` + `4` `fetch` = 19 concurrent requests) + `TimelineTracksCanvas` (`MAX_CONCURRENT = 8`).
  3. **Affected Preview Modes**: **BOTH** Live (Edit) preview AND Rendered preview suffered seek/buffer stalls at `~00:07`.
  4. **What the Engine Was Waiting On**: Primarily `<video>` waiting indefinitely for `seeked` / `canplay` (`readyState: 1`) due to Chromium `HttpCache` single-writer lock on concurrent `206` range streams + `3MB` chunking smaller than 1 GOP (`3.9MB`) + 101MB unchunked `no_vocals.wav` + 19+ concurrent requests starving the 6-socket HTTP/1.1 pool; compounded in `useVideoPlayback.js` by stale `currentTime` on Pause (up to 200ms behind `v.currentTime`, triggering an unnecessary backward re-seek right before `v.play()`), redundant re-seeking while `v.seeking` already targets the same timestamp, no `activeClipIdxRef` re-sync when `videoClips` changes, and no bounded forward-only stall watchdog.
- **Step 1 Fix Applied**:
  1. `backend/middleware/mediaStream.js`: Send `Cache-Control: no-store` on streamed byte-range media (`.mp4/.webm/.mov` and `>4MB .wav`) to bypass Chromium's single-writer `HttpCache` lock; raise video open-ended chunk size `3MB -> 8MB` (covers 2+ full 1080p GOPs in 1 request); chunk large `.wav` (`>4MB`) to `4MB`; keep `ETag`/`Last-Modified`/`Cache-Control: public, max-age=3600` for small audio clips; handle `HEAD` cleanly and destroy aborted streams on `res.on('close')`.
  2. `frontend/src/hooks/useVideoPlayback.js`: Sync exact mapped `currentTime` immediately on Pause (eliminating stale backward re-seek on Resume); skip redundant `v.currentTime` writes when `v.seeking` is already targeting that timestamp; re-align `activeClipIdxRef` when `videoClips` changes; add bounded forward-only (`+5ms`, max 2 nudges) stall/hung-seek recovery watchdog & `AbortError` retry while `intendedPlayingRef` is active (preserving all frozen timeline invariants: forward-only mapping, play-through-Gaps, paused snap-back guard).
  3. `frontend/src/components/player/VideoPlayerPreview.jsx`, `frontend/src/components/timeline/TimelineTracksCanvas.jsx`, `frontend/src/utils/thumbnailUtils.js`: Throttle concurrent audio preloads (`maxNewPerTick = 3`, `<= 2` leading-silence probes, `MAX_CONCURRENT = 3` in canvas), switch 101MB `cleanBgAudioRef` to `preload="metadata"` with `0.12s` drift threshold, yield filmstrip `thumbnailUtils` (`preload="metadata"`) whenever main `<video>` is playing/seeking, remove premature `break` on out-of-order `userShifted` segments, and sort+merge overlapping `speakingIntervals` (VOICE 3 overlapping VOICE 1).
  4. `backend/tests/timeline_playback_stall_guard.test.js` *(new)*: Regression suite for `mediaStream.js`, `useVideoPlayback.js`, connection-pool caps, VOICE 3 overlap handling, and `#5 -> Gap` monotonic mapping.
- **Verification Evidence**:
  - Real-app Playwright E2E on `Pseudo_Spiritual_Root` / `ep_5` (read-only, `series.json` byte-identical, with real 101.26 MB Demucs `no_vocals.wav` mounted): **24 / 24 PASS** across **Chrome + Edge**, **BOTH Live Edit & Rendered preview**, at `00:05`, `00:07`, `00:07.50`, `00:07.71` (Voice `#5` on VOICE 3), `00:08.42`, and Pause->Resume at `~7.5s` — clock & video advanced continuously past `00:09+` with **`maxFlatRun = 0`** on every case, `0` page errors, `0` console errors.
  - Frontend production build (`npm --prefix frontend run build`): **PASS** (`650ms`, 0 errors).
  - New suite (`backend/tests/timeline_playback_stall_guard.test.js`): **4 / 4 PASS**. Full timeline + auto-align suites: **117 / 118 PASS** (sole failure is pre-existing `timeline_continuous_playback_no_loop.test.js` test #2 whose hardcoded live `episodes[0]` Gap expectation drifted after earlier owner edits to `ep_5`; static audit & gap-playback tests #1, #3, #4 all PASS).

## Active Environment
- **Backend API**: `http://localhost:5000` (auto-reloaded with updated `mediaStream.js`, verified `8MB` MP4 / `4MB` WAV `206` with `Cache-Control: no-store`)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server on `chore/full-project-cleanup`)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Hard-refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` and test Play from `00:05` and `00:07` in both Live and Rendered modes.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T18:47:30+07:00

## Summary: Invalidate Cached `renderedVideo` Preview on Any Segment / Audio-Mix Mutation (COMPLETED)
- **Root Cause**: Editing or deleting segments on the timeline updated `scriptData.segments` and synced live audio, but never invalidated `renderedVideo` (unlike visual/export settings edits). As a result, Studio stayed in `🎬 Rendered` mode playing the stale pre-edit MP4 with the deleted voice baked into its audio track.
- **Changes Applied (reusing existing stale-render invalidation pattern — rendered MP4 files on disk are NEVER deleted)**:
  1. `frontend/src/App.jsx`: Added central `invalidateRenderedPreview(targetEpId)` callback — immediately calls `setRenderedVideo(null)` (hiding the green `🎬 Rendered` badge and falling back to live preview), stamps monotonic `renderInvalidatedAt = Math.max(Date.now(), prevRenderedAt + 1)` via `saveEpisodeState` and `handleSaveEpisodeBackground`, and wired `onInvalidateRenderedPreview` into `useClipOperations`, `useAudioDubbing`, `useUndoRedo`, and `useScriptWorkflow`.
  2. `frontend/src/hooks/useClipOperations.js`: Wired `invalidateRendered()` into all 13 timeline/segment mutation paths: `handleDeleteSegment`, `handleAddSegmentAtTime` (via `handleUpdateTimelineSegments`), `handleSplitClip` (segment & clip), `handleAutoSplitSegment`, `handleAutoSplitVideo`, `handleResetFullVideo`, `handleBridgeGaps` (merge/bridge), `handleAutoAlignNoOverlap`, `handleReleaseSegmentToAutoAlign`, `handleDeleteClip` (clip & Gap ripple), `handleUpdateClips`, `handleUpdateTimelineSegments` (drag/move `audioStartSec`/`trackRow`, trim, inline edits), `handleToggleMuteSegment`, and `handleToggleMuteVideoClip`.
  3. `frontend/src/hooks/useAudioDubbing.js`: Wired `invalidateRendered()` into all TTS/segment audio mutation paths: `handleRegenerateSingleSegment`, `handleGenerateAudio` (active & background episode when `!result.alreadyCompleted`), `handleUpdateSegmentSpeed`, `handleUpdateSegmentVoice`, `handleToggleDeliveryType`, `handleUpdateSegmentText`, `handleSplitSegment`, `handleUpdateSpeakerVoice`, and `handleTranslateSingleSegment`.
  4. `frontend/src/hooks/useUndoRedo.js`: Wired `onInvalidateRenderedPreview()` into BOTH `handleUndo` and `handleRedo`.
  5. `frontend/src/hooks/useScriptWorkflow.js`: Wired `onInvalidateRenderedPreview()` into `handleGenerateScript` and `handleUpdateScript` (covering `MediaLibrary` Add Segment, Bridge/Merge, and fallback delete/edit).
  6. `frontend/src/utils/projectStorage.js` & `backend/services/episodeService.js` & `frontend/src/hooks/useVideoRender.js`: Enforced monotonic `renderInvalidatedAt` cutoff across `saveEpisodeState`, `saveTimelineOperationToLocalStorage`, `persistEpisodeTimelineOperation` (`delete` & `restore`), and `syncSeriesMetadataSafely` so stale `renderedVideo` cannot resurrect on autosave/reload while fresh renders (`renderedAt > renderInvalidatedAt`) are accepted cleanly.
  7. `backend/tests/timeline_render_invalidation.test.js` *(new)*: Added backend persistence, frontend localStorage cutoff, and full static wiring audit tests.
- **Verification Evidence**:
  - Frontend production build (`npm --prefix frontend run build`): **PASS** (`1.14s`, 0 errors).
  - Relevant test suites (`timeline_render_invalidation`, `timeline_delete_persistence`, `timeline_user_shifted_anchors`, `timeline_voice_lane_isolation`, `series_persist_and_sync`, `workspace_player_containment`, `auto_align_voice`): **50 / 50 PASS** (0 fail).
  - Real-app Playwright E2E on `Pseudo_Spiritual_Root` (`ep_2` with real rendered MP4 on disk, original `series.json` & MP4 100% untouched):
    - Before delete: `🎬 Rendered` badge visible, `<video>` playing `*_EP2_Khmer_Dubbed.mp4`.
    - Delete voice `#2` (`10.3s–11.3s`): `🎬 Rendered` badge disappeared immediately, `<video>` switched to `Pseudo_Spiritual_Root_ep_2_source.mp4`, count dropped `252 -> 251`, `renderInvalidatedAt` stamped, MP4 kept on disk, live playback across `10.35s–11.015s` had **0** voice audios played (`playedSeg2Count: 0`).
    - Undo (`Ctrl+Z`): restored `#2` (`251 -> 252`), kept `🎬 Rendered` hidden, and advanced `renderInvalidatedAt`.
    - Add Segment (`ថែមឃ្លា`) & Drag/Move voice `#2` from Rendered state: `🎬 Rendered` badge disappeared immediately and player fell back to live source video (`0` page errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (restarted fresh on `chore/full-project-cleanup`)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server on `chore/full-project-cleanup`)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` — deleting, adding, moving, trimming, splitting, muting, regenerating, or undoing segments now exits `🎬 Rendered` mode immediately to live preview.

---

## Previous Session
- **Environment**: Codex CLI
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T18:23:22+07:00

## Summary: Released manual anchors #2 and #3 in the live ep_5
- Stopped the backend and verified port 5000 was clear before editing `E:\khmer_ai_dubbing_studio\backend\uploads\projects\Pseudo_Spiritual_Root\series.json`. The episode was `ep_5` with 219 segments.
- Disk before: #2 and #3 each had `userShifted=true, trackRow=1, trackId="voice-2"`. Disk after atomic save: both had `userShifted=false, trackRow=0, trackId="voice-1"`. The offline edit was verified against a backup to change only these six values.
- Restarted both services, reopened the episode in the real Studio and clicked Auto-Align. The toast said `Auto-Align: Aligned timeline ? Overrun: #4, #6, #47, #55, #58, #77, #95, #105 (+8 more) (audio longer than slot)`. Both clips rendered in the VOICE 1 lane (`voice_0`). Audio resync returned HTTP 200 / success. Studio updated the episode's audio and timeline metadata through its ordinary save.
- Reopened again after a fresh backend restart. The DOM, live API and disk all confirmed the released assignments. The live series is local ignored data. Only this shared-state entry is tracked.

## Active Environment
- Studio: `http://localhost:5173/studio`
- Backend API: `http://localhost:5000`

## Next Steps
- None for this release.

---

## Previous Session
- **Environment**: Codex CLI
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T18:08:52+07:00

## Summary: Burned Khmer subtitle size in the Rendered player
- The Studio player reads `renderedVideo.outputVideoUrl`. For single renders, `useVideoRender.handleRenderVideo -> renderVideoApi -> POST /api/render-video` sends the selected subtitleSize and no numeric fontSize. Download and playback reference the same MP4. ep_5's saved output is a batch MP4, 275,109,158 bytes, 1920x1080.
- In the pre-fix batch worker (batchExportService.js lines 651-656), an existing MP4 over 2 MiB counted as a completed render regardless of the requested subtitle size. Batch now checks the subtitle settings, filename and file revision. Fresh renders replace the old file after encoding and the Studio player uses the returned revision. Matching reruns still reuse the file.
- The separate pipeline Stage 10 sent `fontSize: exportOptions.subtitleSize || 52` twice (old lines 74 and 113). Before the fix its saved ASS contained literal preset names and FFmpeg burned 44 for both small and large in 16:9. Presets, numeric overrides and aspect-specific defaults now resolve in the common ASS writer. The export scale factors and default font sizes are preserved.
- Verified on an isolated excerpt of Pseudo_Spiritual_Root ep_5 with the episode's real Khmer speech and text. At 00:01.88, ASS PlayRes and encoded video both 1920x1080, small/medium/large resolved to 35/44/55. Actual yellow glyph bounds measured 170x22 / 214x27 / 266x35 px in Stage 10 and Studio batch files. Medium matched an independent single export at the same coordinates; the downloaded medium MP4 was byte-identical to the Studio copy. Checked browser playback of the versioned output. Consecutive batch renders above 2 MiB changed with the preset and an identical large rerun was reused. Original episode files were used read-only.
- Frontend production build passed. 23 relevant tests executed and passed including aspect-ratio framing, batch export, ASS sizing, Stage 10, the player and subtitle toggles. The aspect-ratio E2E was rerun with the local ep_2 fixture. One additional Demucs integration test returned early because its unrelated media fixture was absent.

## Active Environment
- Studio: `http://localhost:5173/studio`
- Backend API: `http://localhost:5000`

## Next Steps
- None for this fix. Existing burned MP4s pick up the requested size when rendered again.

---

## Previous Session
- **Environment**: Codex CLI
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T17:42:24+07:00

## Summary: Timeline clip containment and row alignment
- Step 0: `61daaad` removed the 290px `!important` height/min/max lock from `.capcut-bottom-timeline` in `frontend/src/styles/timeline.css`, allowing the inline panel height and existing component min/max to take effect. The component diff changed empty-lane typography, with no clip-height, vertical-offset or root rem-scale change. The underlying flex mismatch also reproduced with the old 290px shell and the current episode's four voice rows.
- The canvas ruler kept its 26px height while its header shrank. Both columns compressed their rows separately. Absolutely positioned video and voice clips kept their fixed 52px/40px heights and 4px top insets. At 1440x900, 3x timeline zoom and a 290px panel, VIDEO 1 was 45.97px tall and its clips crossed the bottom by 10.03px. VOICE 1 began 4px inside its own lane, but adjacent clips overlapped and header dividers were out of alignment.
- Changed `frontend/src/components/timeline/TimelineEditor.css` only for rendering: the ruler header holds its height, lanes shrink like headers, video fills its lane's inner box, and inset clips and drag placeholders are capped by the lane's actual height.
- Real Studio check in Chrome on `Pseudo_Spiritual_Root/ep_5` at 1440x900, 3x timeline zoom, with 275px, 290px and 378px rendered panels. All rendered clip rectangles were contained and every header matched its lane. VIDEO 1 reached the inner edge of the 1px divider, VOICE 1-4 retained 4px top/bottom insets, and the original VOICE 2-4 and CLEAN BGM lane boundaries matched the pre-fix measurements at the 275px and 290px panels. Exercised a populated VOICE 4 and subtitles in a disposable browser session with API writes intercepted.
- Frontend production build passed. Timeline and auto-align suites passed 111/111.

## Active Environment
- Studio: `http://localhost:5173/studio`
- Backend API: `http://localhost:5000`

## Next Steps
- None for this rendering fix.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T17:28:30+07:00

## Summary: Voice Clip Lane Isolation — Never Joins Video Track on Drag, Drop, Snap, or Ghost Preview (COMPLETED)
- **Step 0 Diagnosis (live on `Pseudo_Spiritual_Root` `ep_5`, `#9` after fresh restart of `:5000` & `:5173`)**:
  - **(a) Drop onto VIDEO track row**: Custom pointer drag (`TimelineEditor.jsx` `handleMouseUp`) ignored `.video-lane` hits and kept `trackRow: 0`, **but** dragging upward from Row 0 set `isHoveringOtherLane = Math.abs(deltaY) > 20` (`TimelineEditor.jsx` L980), bypassing same-lane no-overlap bounds so `#9` dropped overlapping `#10` (`14.81s–16.11s`). Separately, the HTML5 native drop path (`TimelineTracksCanvas.jsx` `.video-lane` `onDragOver`/`onDrop` L1162–1220 -> `TimelineEditor.jsx` `handleMoveVideoToTrack` L239–406) unconditionally accepted voice drags, highlighted `Drop to place on VIDEO 1`, snapped `dropTime` against `videoClips`, and did not reject `trackType === 'video'` for segments.
  - **(b) Snap to video clip edges**: Custom pointer drag (`TimelineEditor.jsx` `processMouseMove`) already iterated `scriptSegments` for same-lane voice drags (0 video-edge snaps on empty `VOICE 2`), while `.video-lane` `onDrop` (`TimelineTracksCanvas.jsx` L1195–1204) snapped dropped times to `videoClips` (`c.end`), and the `else if` snap block wasn't structurally isolated from `audio`. `useClipOperations.js` has no drag/drop/snap logic.
  - **(c) Drag ghost / preview overlapping VIDEO track (PRIMARY VISUAL BUG)**: `TimelineEditor.jsx` `processMouseMove` wrote unclamped `currentY: deltaY` (L970, L1073) and `TimelineTracksCanvas.jsx` `renderVoiceSegment` applied `transform: translateY(${dragState.currentY}px)` with `zIndex: 100` (L561–562). Live measurement on `ep_5` `#9`: dragging upward `-46px` placed `#9` at `top: 673..713` inside `.video-lane` (`669..715`, **40px / 100% overlap**); dragging `-120px` lifted it to `top: 599..639` past the video track and ruler.
- **Step 1 Changes Applied**:
  1. `frontend/src/utils/timelineUtils.js`: Added pure helpers `isVoiceDropTargetAllowed`, `clampVoiceDragY`, `resolveVoiceDropRow`, and `computeVoiceDragPosition` (voice-only snap targets, strict voice-lane drop validation, top/bottom voice-lane Y clamping).
  2. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - Wired `measureVoiceLaneBounds`, `clampVoiceDragY`, `resolveVoiceDropRow`, and `computeVoiceDragPosition` into `processMouseMove` and `handleMouseUp` for `itemType === 'audio'` (clamped strictly to voice lanes, upward drag past `voice_0` clamps to `0` & keeps same-lane bounds, snap targets strictly voice clips only).
     - Guarded `handleMoveVideoToTrack` so voice segments can never match video clips or drop onto `trackType === 'video'`.
     - Left video clip dragging behaviour (`itemType === 'video'`) 100% unchanged.
  3. `frontend/src/components/timeline/TimelineTracksCanvas.jsx`:
     - Defensively clamped `safeVoiceTranslateY` in `renderVoiceSegment` (only for `itemType === 'audio'`) and kept `.video-clip-ghost` inside `.voice-lane` (`height: calc(100% - 6px)`).
     - Suppressed `.video-lane` `isDragOver` during voice drags and rejected voice payloads in `.video-lane` `onDragOver` & `onDrop` before any video-edge snapping or commit.
  4. `backend/tests/timeline_voice_lane_isolation.test.js` *(new)*: Added 5 unit + static-audit tests covering all 3 requirements and video-drag preservation.
- **Verification Evidence**:
  - Timeline & Auto-Align suites (`node --test backend/tests/timeline_*.test.js backend/tests/auto_align_voice.test.js`): **111 / 111 PASS** (16 suites, 0 fail).
  - Frontend production build (`npm --prefix frontend run build`): **PASS** (`646ms`, 0 errors).
  - Real-app Playwright E2E on `Pseudo_Spiritual_Root` `ep_5` (`http://localhost:5173/studio`, original `series.json` byte-identical):
    - Dragging `#9` upward to VIDEO center and extreme `y=20`: `transform: translateY(0px)`, `b9Top: 719 >= videoBottom: 715` (`overlapsVideo: false`, `overlapPx: 0`), `dragOverLanes: ['voice_0']`, ghost inside `voice_0`, drops on `voice_0` without overlapping `#10`.
    - Normal voice-to-voice move `#9` `VOICE 1` -> `VOICE 2` works (`laneKey: 'voice_1'`).
    - Dragging `#9` on `VOICE 2` across all nearby video clip edges: `snapSamples: []` (0 snaps to video edges).
    - Dragging `#9` from `VOICE 2` far upward (`y=50`): clamps cleanly at `VOICE 1` (`translateY(-37px)`, `b9Top: 719 >= videoBottom: 715`, `overlapsVideo: false`) and drops on `voice_0`.
    - Real video playback advanced smoothly (`1.0s -> 1.662s`, `0` page errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (freshly restarted on `chore/full-project-cleanup`)
- **Frontend Studio**: `http://localhost:5173` (freshly restarted Vite dev server on `chore/full-project-cleanup`)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` and drag voice `#9` upward or across lanes to verify visually.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T16:53:00+07:00

## Summary: Inspector "ឲ្យ Auto-Align គ្រប់គ្រងវិញ" (Release to Auto-Align) Button for Manual `userShifted` Clips (COMPLETED)
- **Context**: Manually dragged clips (`userShifted: true`) are respected as fixed anchors by Auto-Align, so owners needed a way in the Inspector to hand a single clip back to Auto-Align control (e.g. `#4` on `ep_5` overlapping `#2`/`#3`).
- **Changes Applied**:
  1. `frontend/src/utils/timelineOps.js`: Added pure op `releaseSegmentFromManual(state, { segKey })` — clears `userShifted: false` and manual `trackRow` override (`trackRow: 0`, `trackId: 'voice-1'`) for that segment ONLY, restores canonical slot anchor (`startSec`/`endSec` from paired dialogue video clip or `sourceStartSec`), and preserves current `audioStartSec`/`audioEndSec` so Auto-Align is NOT auto-run.
  2. `frontend/src/hooks/useClipOperations.js`: Added `handleReleaseSegmentToAutoAlign` with single-undo snapshot, confirmation toast (`✅ បានប្រគល់ #N ឲ្យ Auto-Align គ្រប់គ្រងវិញ — ចុច Auto-Align ដើម្បីរៀបទីតាំង`), and immediate persistence to `series.json`.
  3. `frontend/src/components/voice/ClipInspectorPanel.jsx`: Rendered the manual-anchor notice + `"ឲ្យ Auto-Align គ្រប់គ្រងវិញ"` (`data-testid="btn-release-auto-align"`) button strictly when `Boolean(selectedSegment?.userShifted)` is `true` (hidden on non-shifted segments).
  4. `frontend/src/App.jsx` & `frontend/src/components/voice/VoiceSettings.jsx`: Wired `onReleaseSegmentToAutoAlign`.
  5. `backend/tests/timeline_user_shifted_anchors.test.js`: Added unit + static tests (Tests 6–7) covering single-segment release, no auto-align on click, subsequent Auto-Align snapping back to slot without overlapping `#2`/`#3`, and conditional Inspector rendering.
- **Verification Evidence**:
  - Frontend build (`npm --prefix frontend run build`): **PASS** (`748ms`, 0 errors).
  - Full timeline suites (`node --test backend/tests/timeline_*.test.js backend/tests/auto_align_voice.test.js`): **106 / 106 PASS** (0 fail).
  - Real-app Playwright E2E on `Pseudo_Spiritual_Root` (`ep_5`, original `series.json` restored cleanly):
    - Non-shifted `#1`: `0` release buttons rendered.
    - Manual `#4`: `"ឲ្យ Auto-Align គ្រប់គ្រងវិញ"` visible → clicked → toast confirmed release, button hid, `#4` persisted (`userShifted: false`, `trackRow: 0`, `startSec: 4.45`, `audioStartSec: 2.88` unchanged), `#2`/`#3` stayed `userShifted: true`.
    - Reloaded page → `#4` still released (`userShifted: false`, button hidden).
    - Clicked `Auto-Align` → `#4` moved cleanly to `4.45s` (`trackRow: 0`), no longer overlapping `#2` (`end 2.52s`) or `#3` (`end 4.18s`), and toast showed `Aligned 1 clip • 2 manual untouched (#2, #3)`. Zero page errors.

## Active Environment
- **Backend API**: `http://localhost:5000` (running on `chore/full-project-cleanup`)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server on `chore/full-project-cleanup`)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Select `#4` in the Inspector → click `"ឲ្យ Auto-Align គ្រប់គ្រងវិញ"` → click `Auto-Align` to snap `#4` back onto its slot without overlapping `#2`/`#3`.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T16:42:00+07:00

## Summary: Manual Move Sets `userShifted` Anchor, Auto-Align Honours Anchors, Delete `Reset Timing`, Extended Summary Toast (COMPLETED)
- **Root Cause**: `autoAlign` in `frontend/src/utils/timelineOps.js` respected manual positions only when `seg.userShifted` was `true`, but `moveClip` (voice drag/drop commit path) never set `userShifted: true`, and `POST /api/sync-timeline-audio` skipped persisting `trackRow`/`userShifted`/`startSec` on fingerprint cache hits (e.g. vertical lane-only drags) and omitted `startSec`/`endSec` on post-sync writes.
- **Changes Applied**:
  1. `frontend/src/utils/timelineOps.js`:
     - `moveClip`: sets `userShifted: true`, persists dropped `audioStartSec`, `audioEndSec`, `trackRow`, `trackId`, and preserves `sourceStartSec`/`sourceEndSec`.
     - `autoAlign`: treats all `userShifted` clips as immutable fixed anchors (never modifies start, end, duration, or lane on any row), aligns only non-shifted clips around them (re-laning non-shifted clips that collide with a Lane-0 anchor), and returns `report` (`alignedCount`, `movedClipNumbers`, `untouchedCount`, `untouchedClipNumbers`, `relanedClips`, `overrunClips`).
     - Deleted `resetTiming` completely.
  2. `frontend/src/components/timeline/TimelineEditor.jsx` & `TimelineTracksCanvas.jsx`:
     - Kept `userShifted` (and secondary-lane) clips rendered on their stored `trackRow` at their stored `audioStartSec`.
     - Updated cross-track drop (`handleMoveVideoToTrack`) to preserve `sourceStartSec`/`sourceEndSec`, set `userShifted: true`, and sync immediately.
     - Removed `onResetToSourceTiming` prop & wiring.
  3. `frontend/src/components/timeline/TimelineToolbar.jsx` & `frontend/src/App.jsx`:
     - Completely removed the `Reset Timing` button, icon import, handler callback, and prop wiring (grep-proof **0 hits** for `resetTiming` across `frontend/src`).
  4. `frontend/src/hooks/useClipOperations.js`:
     - Deleted `handleResetToSourceTiming` and `resetTiming` import.
     - Extended `handleAutoAlignNoOverlap` to always show a visible summary toast reporting aligned count, untouched `userShifted` clips by clip number (e.g. `#4`), and overrun clips.
  5. `backend/routes/audioRoutes.js`:
     - Extracted `persistSyncedSegmentsToSeriesJson` and invoked it on BOTH fingerprint cache-hit AND post-FFmpeg sync paths, persisting `userShifted`, `trackRow`, `trackId`, `startSec`, `endSec`, `audioStartSec`, `audioEndSec`, `sourceStartSec`, `sourceEndSec`, and trimming/overrun flags to `series.json`.
  6. Tests updated/added: `backend/tests/auto_align_voice.test.js`, `backend/tests/timeline_step_c_real_app_acceptance.test.js`, `backend/tests/timeline_ui_workflow_fix.test.js`, and new `backend/tests/timeline_user_shifted_anchors.test.js`.
- **Verification Evidence**:
  - Grep check across `frontend/src` for `resetTiming|Reset Timing|ResetToSourceTiming`: **0 hits**.
  - Production build (`npm --prefix frontend run build`): **PASS** (`618ms`, 0 errors).
  - Full timeline test suite (`node --test backend/tests/timeline_*.test.js backend/tests/auto_align_voice.test.js`): **104 / 104 PASS** (0 fail).
  - Real-app Playwright E2E on `Pseudo_Spiritual_Root` (`ep_1`, restarted backend `:5000` + frontend `:5173`, original `series.json` restored cleanly):
    - `Reset Timing` button count in DOM: `0`.
    - Dragged `#4` from Lane 1 (`12s`, `left: 540px`) → Lane 2 (`14s`, `left: 630px`) → persisted to `series.json` (`userShifted: true`, `trackRow: 1`, `audioStartSec: 14`).
    - Reloaded page → `#4` stayed on Lane 2 (`left: 630px`, `audioStartSec: 14`, `userShifted: true`).
    - Clicked `Auto-Align` → `#4` stayed untouched on Lane 2 (`left: 630px`, `audioStartSec: 14`, `userShifted: true`), drifted non-shifted `#6` aligned cleanly back to `14.8s` on Lane 1, and visible toast reported: `⚠️Auto-Align: Aligned 1 clip • 5 manual untouched (#4, #16, #21, #50, #74) • Overrun: ...`. Zero page errors.

## Active Environment
- **Backend API**: `http://localhost:5000` (restarted fresh on `chore/full-project-cleanup`)
- **Frontend Studio**: `http://localhost:5173` (restarted fresh Vite dev server on `chore/full-project-cleanup`)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` — manually dragged voice clips stay locked across reload & Auto-Align, and `Reset Timing` is removed.

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T14:14:00+07:00

## Summary: Make Logo Settings Global (Single Source of Truth Across All Episodes & Series) (COMPLETED)
- **Scope**: Logo settings family ONLY (`enableLogo`, `logoImage`, `logoPosition`, `logoSize`, `logoOpacity`, `logoShape`, `logoMargin`, `logoXPercent`, `logoYPercent`). All other visual settings (subtitles, sponsor, watermark, corner mask, ducking, aspect ratio, etc.) preserve their existing per-episode behaviour untouched.
- **Minimal Changes Applied**:
  1. `backend/services/globalLogoSettingsService.js` *(new)*: Dedicated atomic server-side store (`backend/uploads/cache/global_logo_settings.json`) with normalization, stale-write timestamp guard, `stripLogoSettingsFromObject`, and `getEffectiveGlobalLogoSettingsForExport`.
  2. `backend/routes/systemRoutes.js`: Added `GET /api/logo-settings` and `PUT`/`POST /api/logo-settings`.
  3. `backend/routes/videoRoutes.js` & `backend/services/batchExportService.js`: Switched export fallback to `getEffectiveGlobalLogoSettingsForExport()` (removed per-episode `req.body?.voiceSettings?.logoSettings` fallback).
  4. `backend/services/ffmpegService.js`: Guarded `logoXPercent !== null && logoYPercent !== null` so `null` coords never hijack preset corners (e.g. `top-left`) and preserved `0%` coordinates cleanly.
  5. `backend/services/episodeService.js`: Stripped `logo*` keys from `ep.voiceSettings` on write in `syncSeriesMetadataSafely` (while leaving reads untouched so first-time migration can seed from the active episode).
  6. `frontend/src/utils/logoSettingsStorage.js` *(new)*: Dedicated global client store (`KHMER_AI_GLOBAL_LOGO_SETTINGS_V1`) with serialized/coalesced server sync, one-time migration (`resolveInitialLogoSeed` / `migrateGlobalLogoSettingsIfNeeded`), `stripLogoSettings`, and `buildLogoExportPayload`.
  7. `frontend/src/utils/projectStorage.js`: Removed `logo*` keys from `DEFAULT_VOICE_SETTINGS`; stripped `logo*` keys in `resolveStickyVoiceSettings`, `loadSavedVoiceSettings`, `saveVoiceSettings`, and `saveEpisodeState` so episode `voiceSettings` never override or store logo keys.
  8. `frontend/src/context/WorkspaceContext.jsx`: Added dedicated `globalLogoSettings` / `setGlobalLogoSettings` state.
  9. `frontend/src/hooks/useSeriesManager.js`: Stripped `logo*` keys from `getCurrentWorkspaceSnapshot` and `handleSaveEpisodeBackground`.
  10. `frontend/src/hooks/useVideoRender.js`: Updated `buildLogoOptions` (used by both single and batch export) to read strictly from the global logo store (`globalLogoSettingsRef` / `globalLogoSettings` / `loadGlobalLogoSettings()`).
  11. `frontend/src/App.jsx`: Added mount hydration & one-time migration (seeding from active episode customized logo / legacy voiceSettings / defaults, then ignoring per-episode logo values forever), routed `logo*` edits in `handleUpdateVoiceSettings` strictly to the global store while still invalidating stale `renderedVideo`, and passed combined `studioSettings` to `VideoPlayerPreview` and `VoiceSettings`.
  12. `backend/tests/global_logo_settings.test.js` *(new)*: Unit, persistence, migration, episode-stripping, and static export-wiring tests.
- **Verification Evidence**:
  - Frontend production build (`npm --prefix frontend run build`): **PASS** (`605ms`, 0 errors).
  - Relevant test suites (`global_logo_settings.test.js`, `aspect_ratio_and_crop.test.js`, `workspace_player_containment.test.js`, `sponsor_ads_end_to_end.test.js`): **21/21 PASS** (0 fail).
  - Real-app E2E verification (`http://localhost:5173/studio` + restarted backend `:5000`, Edge headless):
    - First-time migration from `Solo Leveling` EP1 seeded `top-left / 68px / 0.75` to `KHMER_AI_GLOBAL_LOGO_SETTINGS_V1` + `GET /api/logo-settings`.
    - Edited logo on `Pseudo_Spiritual_Root` EP1 -> `bottom-right / square / 96px / 0.85` -> live preview `.logo-overlay-item.shape-square` + server store synced (`localVoiceHasLogoKeys: []`, disk `ep_1.voiceSettings` logo keys: `[]`).
    - Switched to `Pseudo_Spiritual_Root` EP2 (legacy `top-left / 68px / circle`) -> stayed `bottom-right / square / 96px / 0.85`.
    - Switched to different series (`Solo Leveling`) -> stayed `bottom-right / square / 96px / 0.85` with live preview overlay.
    - Reloaded page -> stayed identical (`bottom-right / square / 96px / 0.85`, 0 page errors).
    - Real `/api/render-video` export from `Pseudo_Spiritual_Root` EP2 logged `scale=144:144 ... colorchannelmixer=aa=0.85` + `overlay=main_w-overlay_w-30:main_h-overlay_h-30` and frame pixel diff proved burned logo at bottom-right (`bottomRightMeanDiff: 30.75` vs `topLeftMeanDiff: 1.37`).

## Active Environment
- **Backend API**: `http://localhost:5000` (restarted cleanly with latest global logo store endpoints & export fallback)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` — logo settings now persist globally across all episodes, series, reloads, and single/batch exports.

---

## Previous Session
- **Environment**: Antigravity IDE (`design-ui-designer` + Impeccable v4.9.1)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T13:53:00+07:00

## Summary: Full-Site UI Overhaul — PHASE 2 Visual-Only Fixes Across All 6 Routes (COMPLETED)
- **Scope**: Visual/CSS/A11y-semantics ONLY — zero feature, pipeline, routing, content, or timeline behavior changes. All 8 approved steps executed in exact order, rebuilt, re-screenshotted (`1440px` + `390px`), and committed individually.
- **Audit Health Score (Before → After)**: **`6 / 20 (Poor)` → `15 / 20 (Good)` (+9 points)**
  - Accessibility: `1/4 → 3/4` | Performance: `3/4 → 3/4` | Theming: `1/4 → 3/4` | Responsive: `0/4 → 3/4` | Implementation Integrity: `1/4 → 3/4`
  - Impeccable 1440px Live Detector: **`2,272 → 1,450` (-36.2%)**; `/home` dropped **`77 → 0`** (100% clean!); `overused-font` → `0`, `gradient-text` → `0`, `skipped-heading` → `0`, `gray-on-color` `44 → 1`, `ai-color-palette` `113 → 10`, CSS `!important` `157 → 76` (-52%).
  - Horizontal Overflow (`overflowX` & `navOverflow`): **`+152px` (1440px) & `+1,202px` (390px) → `0px`** across ALL 6 routes!
- **Atomic Commits Per Step**:
  1. `d166fe9` **Global Tokens** (`PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `frontend/index.html`, `frontend/src/index.css`, `frontend/src/styles/tokens.css`): Unified Obsidian Darkroom Console tokens, AA `#0369A1` primary CTA (`5.9:1`), AA `#047857` success CTA (`5.4:1`), AA `#8E9EB5` dimmed ink, `Kantumruy Pro` + `IBM Plex Sans` + `JetBrains Mono` (removed duplicate Google Fonts `@import` & `Inter`), universal `:focus-visible`, `prefers-reduced-motion`, exponential motion.
  2. `1689b66` **Shared Shell & Components** (`layout.css`, `Navbar.css/jsx`, `components.css`, `modals.css`): Fixed root CSS grid `minmax(0, 1fr)` & responsive Navbar (0px overflow at 1440px & 390px), retired purple-cyan AI gradient `.btn-primary` & neon glows, added unified modal shell primitives.
  3. `040329b` **Page 1 — `/home`** (`HomeDashboard.css`, `layout.css` 16px root `rem` fix): Flat tonal cards, clear `h1`/`h2` scale (`22px`/`16px`), AA CTA contrast, clean 390px mobile stacking — **`77 → 0` Impeccable findings**.
  4. `61daaad` **Page 2 — `/studio`** (`timeline.css`, `TimelineEditor.css`, `MediaLibrary.css`, `MediaUploadTab.jsx`, `EpisodesTab.jsx`, `VoiceSettings.css`, `VideoPlayerPreview.css`): **Timeline behavior 100% frozen** (zero timeline JS/JSX edits; preserved frozen CSS test assertions). Fixed 1440px Right Inspector clipping (`13 → 0` clipped controls), unified 3 conflicting CTA styles (retired coral `#FF8577` glow pills & purple-cyan gradient), fixed empty-lane `1.9:1` contrast, added clean 390px vertical reflow.
  5. `d951bd2` **Page 3 — `/batch`** (`DubbingStepCardsBar.jsx`, `GeminiRouteModal.jsx`, `MediaLibrary.css`): Fixed Step 1 (`1. Script ខ្មែរ:`) text overlap collision at 1440px & 390px via 2-row flex-column cards, fixed 390px episode grid overflow (`minmax(min(100%, 330px), 1fr)`), fixed `H2→H4` skipped heading, fixed 390px Script Setup toggle overlap, aligned Obsidian modal shell.
  6. `8ac8b8f` **Page 4 — `/quota`** (`GeminiQuotaModal.jsx`): Fixed P0 390px vertical header collapse & footer clipping, replaced `gradient-text` `<h2>` with crisp `<h1>`, removed cyan halo glows, aligned Obsidian tokens.
  7. `a87370a` **Page 5 — `/jobs`** (`JobDashboardModal.jsx`, `JobQueueList.jsx`): Fixed 390px 4-col stat card overflow via responsive 2×2 `.studio-stat-grid-4`, promoted `<h1>`, added search `aria-label`, aligned Obsidian tokens.
  8. `6323a06` **Page 6 — `/export` + `ShortcutsModal`** (`BatchExportStudioModal.jsx`, `ShortcutsModal.jsx`): Removed duplicate `× ✕` close icon, flattened nested outer episode box, promoted `<h1>`, fixed `ShortcutsModal` tokens & dialog a11y.
- **Verification Evidence**:
  - Vite Production Build (`npm --prefix frontend run build`): **PASS** (`648ms`, 0 errors).
  - Full Frozen Timeline + Batch Regression Tests: **117 / 117 PASS** (`90` timeline + `27` batch, 0 fail).
  - After Screenshots Captured: `.agents/ui-audit/after/{home,studio,batch,export,quota,jobs}-{1440,390}.png` (`0` console/page errors across all 12 captures).
- **Remaining P2/P3 Items (Tracked for Optional Follow-Up)**:
  - `[P2]` Inner episode cards in `GeminiRouteModal.jsx` (4,574 lines), `BatchExportStudioModal.jsx`, `GeminiQuotaModal.jsx`, and `ScriptReviewTab.jsx` still contain legacy inline `0.62rem–0.70rem` micro-font badges & inline hexes (responsible for the remaining `undersized-ui-text` / `tiny-text` counts).
  - `[P2]` Add an `.sr-only` `<h1>` landmark inside `/studio` workspace and `aria-label` attributes on remaining 8 inspector range sliders.
  - `[P3]` Frozen timeline CSS assertions in `backend/tests/timeline_*.test.js` intentionally lock `border-left: 3px` on track headers (`5` `side-tab`) and `border-top: 2px` on voice clips (`12` `border-accent-on-rounded`) — left untouched per timeline freeze rule.

## Active Environment
- **Backend API**: `http://localhost:5000` (HTTP 200 OK)
- **Frontend Studio**: `http://localhost:5173` (HTTP 200 OK)
- **Branch**: `chore/full-project-cleanup` (8 new UI commits ahead of previous baseline)

## Next Steps
- Review the refreshed UI in browser (`http://localhost:5173/home`, `/studio`, `/batch`, `/export`, `/quota`, `/jobs`) or compare `.agents/ui-audit/before/` vs `.agents/ui-audit/after/` screenshots, and push branch when ready.

---

## Previous Session
- **Environment**: Antigravity IDE (`design-ui-designer` + Impeccable v4.9.1)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-18T12:35:00+07:00

## Summary: Full-Site UI Audit — SETUP + PHASE 1 AUDIT ONLY (COMPLETED, Awaiting Fix Order Approval)
- **Scope**: Strictly SETUP + PHASE 1 AUDIT ONLY — zero application code edits.
- **SETUP Completed**:
  1. Verified Impeccable design skill (`v4.9.1`) installed in `.agents/skills/impeccable`.
  2. Completed `/impeccable init` → wrote `PRODUCT.md` (schema v1).
  3. Completed `/impeccable document` → wrote `DESIGN.md` & `.impeccable/design.json` (schema v2 — *"The Darkroom Console"*).
- **PHASE 1 Audit Completed**:
  - Verified live servers: Backend `http://localhost:5000` (200 OK) & Frontend `http://localhost:5173` (200 OK).
  - Captured fresh screenshots at `1440×900` & `390×844` across all 6 canonical routes (`/home`, `/studio` + sub-tabs, `/batch`, `/export`, `/quota`, `/jobs`) into `.agents/ui-audit/before/`.
  - Ran `impeccable detect` static scan (`7` findings) + live browser scans (`2,272` findings at 1440px, `475` at 390px) + Playwright DOM/A11y/CSS scan (`279` non-token CSS hexes, `1,542` inline JSX hexes, `157` `!important`, `1` `:focus-visible`, `0` `prefers-reduced-motion`).
  - Baseline **Audit Health Score: 6 / 20 (Poor)** — A11y `1/4`, Performance `3/4`, Theming `1/4`, Responsive `0/4`, Implementation Integrity `1/4`.
  - Wrote full report + 8-step ranked fix order to `.agents/UI-AUDIT.md`.

## Active Environment
- **Backend API**: `http://localhost:5000` (HTTP 200 OK)
- **Frontend Studio**: `http://localhost:5173` (HTTP 200 OK)
- **Branch**: `chore/full-project-cleanup`

## Next Steps
- **STOPPED after Phase 1**: Waiting for owner approval of the 8-step ranked fix order in `.agents/UI-AUDIT.md` before starting **PHASE 2 (Visual-Only Fixes, page by page with before/after screenshots & commits)**.

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T21:54:00+07:00

## Summary: Batch Generate Studio (/batch) UI & Label Fixes — Step 4 Numbering, Compact Queued Demucs Row, True Auto-Fit % (COMPLETED)
- **Scope**: UI + label fixes ONLY (zero pipeline, queue, or job behaviour changes).
- **Minimal Changes Applied**:
  1. `frontend/src/components/dashboard/GeminiRouteModal.jsx`:
     - **Step Number**: Renumbered in-card Demucs row (idle/done & queued) from `🔇 3.` to `🔇 4.` so card steps read `1 -> 2 -> 3 -> 4` matching the top step boxes (`1 Script`, `2 Voice`, `3 Auto-Fit`, `4 Clean BGM`).
     - **Queued Demucs Row**: Replaced the dashed placeholder box with ONE compact single-line status row (`29px` height, solid border) showing real queue position (`Queue លេខ X / Y`) computed strictly from remaining waiting episodes after the currently running episode in the active Demucs queue (`activeDemucsEpisodeIds`, `runnerStates.clean_bgm.queuedEpIds`, or `runnerStates.all3.queuedEpIds`). Finished and non-queued episodes never display a queued label. Actively running episode preserves the full rich `EpisodeDemucsProgressCard` (progress %, Kill button, console logs).
     - **Auto-Fit Label**: Replaced hardcoded `Subtitle ១០០%` (visually resembling `900%`) with the true fit percentage derived from stored `ep.scriptData.segments` (`audioDurationSec ?? finalAudioDuration ?? audioDuration` vs `endSec - startSec`, `< 0.10s` & `!audioTrimmed`) formatted to 1 decimal (e.g. `96.4%`, `99.3%`, `87.3%`, `97.3%`); falls back to no percentage on legacy segments lacking duration metadata.
  2. `frontend/src/components/dashboard/route-runners/EpisodeDemucsProgressCard.jsx`:
     - Renumbered header labels from `🔇 3.` to `🔇 4.` for running/done/queued states.
  3. `backend/tests/ai_detection_and_dubbing_prompt_fix.test.js` & `backend/tests/autofit_live_console.test.js`:
     - Updated static step-number assertions from `🔇 3.` to `🔇 4.`.
- **Verification Evidence**:
  - Frontend production build (`npm --prefix frontend run build`): **PASS** (730ms, 0 errors).
  - Batch test suites (`ai_detection_and_dubbing_prompt_fix.test.js`, `autofit_live_console.test.js`, `clean_unified_3step_batch_pipeline.test.js`, `reusable_1by1_dubbing_feature.test.js`): **27/27 PASS**.
  - Real-app verification after full backend (`:5000`) & Vite (`:5173`) restart at `http://localhost:5173/batch` (Edge headless, 0 console/page errors):
    - Idle: 23 cards all read `1-2-3-4` (`hasDemucs3: false`), zero `Subtitle ១០០%`/`900%`, Auto-Fit displays true stored percentages (`EP2 96.4%`, `EP3 99.3%`, `EP4 87.3%`, `EP5 97.3%`, `EP6 96.9%`), 0 queued rows.
    - Running `4. Clean BGM` 1-by-1: `EP1`/`EP2` (not queued) show done (`queuePos: null`), `EP3` (running) shows full progress card + `🛑 Kill` + `CONSOLE LOGS`, `EP4..EP23` show compact `29px` solid rows (`Queue លេខ 1 / 20` .. `Queue លេខ 20 / 20`).
    - Advancing to `EP5`: `EP3`/`EP4` clear queued state (`isQueuedRow: false`), `EP5` renders rich running card + `🛑 Kill`, `EP6..EP23` update live (`Queue លេខ 1 / 18`, `EP8` shifted `5 / 20` -> `3 / 18`, `EP10` shifted `7 / 20` -> `5 / 18`). After `Stop`: `0` queued rows.

## Active Environment
- **Backend API**: `http://localhost:5000` (freshly restarted)
- **Frontend Studio**: `http://localhost:5173` (freshly restarted Vite dev server)
- **Branch**: `chore/full-project-cleanup` (committed & pushed)

## Next Steps
- Refresh browser at `http://localhost:5173/batch` to verify visually.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T21:43:00+07:00

## Summary: Draggable Sponsor Ads Overlay in Preview + Percent-Based FFmpeg Export Sync (COMPLETED)
- **Step 0 — Fresh Restart & Real-App Reproduction**:
  - Restarted backend (`:5000`) and Vite (`:5173`) cleanly.
  - Reproduced in live Studio UI (`http://localhost:5173/studio`): uploaded sponsor video, enabled Sponsor Ads, attempted pointer drag on `.sponsor-overlay-container` — **not selectable / drag completely ignored** (`pointerEvents: "none"`, `cursor: "auto"`, `elementFromPoint` hit `<video>` underneath; `SponsorOverlay` lacked `onUpdateVoiceSettings` and drag handlers; Position dropdown lacked `"custom"`; `ffmpegService.js` had no custom percent x/y support).
- **Changes Applied**:
  1. `frontend/src/components/player/SponsorOverlay.jsx` & `SponsorOverlay.css`: Wrapped in full-frame `.sponsor-overlay-root`, enabled `pointer-events: auto` (`cursor: grab`/`grabbing`, emerald hover/drag outline + live `X% | Y%` badge), implemented pointer drag (`onPointerDown` + window `pointermove`/`pointerup`/`pointercancel`, clamped within frame bounds), saving percent-based `{ sponsorPosition: 'custom', sponsorXPercent, sponsorYPercent }` via `onUpdateVoiceSettings` (drag = move only; scale, chroma key, sensitivity, loop timing, mute unchanged).
  2. `frontend/src/components/player/VideoPlayerPreview.jsx`: Passed `onUpdateVoiceSettings` to `<SponsorOverlay />`.
  3. `frontend/src/components/voice/ExportSettingsPanel.jsx`: Added `<option value="custom">✨ ទីតាំងសេរី (Custom Drag)</option>` to Sponsor Position dropdown; selecting any preset clears `sponsorXPercent: null, sponsorYPercent: null` atomically; displays active `Custom: X% · Y%` hint.
  4. `frontend/src/App.jsx`: Added `sponsorXPercent: null` and `sponsorYPercent: null` to `VISUAL_SETTING_DEFAULTS` so every drag invalidates stale renders and persists to `localStorage` + `series.json`.
  5. `frontend/src/hooks/useVideoRender.js`: Forwarded `sponsorXPercent`/`sponsorYPercent` (`xPercent`/`yPercent`) in `buildSponsorOptions()` (used by both single and batch export).
  6. `backend/services/ffmpegService.js`: Added custom percent positioning (`overlay=x=(main_w-overlay_w)*xFrac:y=(main_h-overlay_h)*yFrac`), handling `0%` cleanly without falsy fallback, mapping identically to 16:9, 9:16, and 1:1 output resolutions.
  7. `backend/tests/sponsor_ads_end_to_end.test.js`: Extended static audit and added real FFmpeg export test verifying dragged custom percent `(80%, 15%)` on both 16:9 (`1280x720`) and 9:16 (`1080x1920`) plus `(0%, 0%)` top-left corner edge case.
- **Verification Evidence**:
  - Frontend build (`npm --prefix frontend run build`): **PASS** (987ms, 0 errors); `oxlint`: **0 errors**.
  - Test suites (`node --test backend/tests/sponsor_ads_end_to_end.test.js backend/tests/timeline_*.test.js`): **93/93 PASS** (16 suites, 0 fail).
  - Real-app verification (`http://localhost:5173/studio`, Edge headless, 0 console/page errors):
    - Dragged from `bottom-left` -> moved smoothly, dropdown switched to `custom`; switched preset `top-left` -> moved cleanly to `top-left`; dragged again to `(X: 59.9%, Y: 18.8%)` (`relCenterX: 0.5742, relCenterY: 0.2663`).
    - Reloaded page -> persisted identically (`persistDeltaX: 0, persistDeltaY: 0`, `series.json` saved `sponsorPosition: "custom", sponsorXPercent: 59.9, sponsorYPercent: 18.8`).
    - Short real FFmpeg export frame grab (`1280x720`) rendered `DragonDub AI` chroma-keyed banner at exact matching relative position (`exportRelCenterX: 0.5754` vs preview `0.5742`, delta `0.0012`).

## Active Environment
- **Backend API**: `http://localhost:5000` (running with latest `ffmpegService.js`)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server)
- **Branch**: `chore/full-project-cleanup` (pushed to `origin/chore/full-project-cleanup`)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio`, enable Sponsor Ads, and drag the banner directly in the preview player.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T21:38:00+07:00

## Summary: Remove "EP... AI Audio" Quick Action Footer Bar from VoiceSettings (COMPLETED)
- **Changes Applied**:
  1. `frontend/src/components/voice/VoiceSettings.jsx`: Removed the bottom `EP{activeEpisode.episodeNumber || activeEpisode.id} AI Audio:` footer bar (`▶ បង្កើតសំឡេង AI` and `▶ ផលិតទាំង 3 ជំហាន` buttons) and its unused `DubbingStepButton` import.
  2. `backend/tests/reusable_1by1_dubbing_feature.test.js`: Updated `Step 3c` test to remove the `VoiceSettings` `DubbingStepButton` assertion (kept `EpisodesTab` and `DubbingModeTab`).
- **Verification**:
  - Frontend build (`npm --prefix frontend run build`): **PASS** (1.34s, 0 errors).
  - Test (`node --test backend/tests/reusable_1by1_dubbing_feature.test.js`): **10/10 PASS**.

## Active Environment
- **Backend API**: `http://localhost:5000`
- **Frontend Studio**: `http://localhost:5173`
- **Branch**: `chore/full-project-cleanup`

## Next Steps
- Refresh browser at `http://localhost:5173/studio` to confirm the `EP... AI Audio` bar is gone from the right panel.

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T20:57:00+07:00

## Summary: Fix Sponsor Ads (Green Screen Video) End-to-End Flow (COMPLETED)
- **Step 0 — Fresh Restart & Real-App Reproduction**:
  - Restarted backend (`:5000`) and Vite (`:5173`) cleanly.
  - Reproduced upload in the live Studio UI: `POST /api/upload-sponsor-video` returned `200 OK` and saved the MP4 to `backend/uploads/sponsor/sponsor_*.mp4` (4 prior owner uploads were also already saved there), yet:
    - `(a)` Panel preview stayed on placeholder `<Tv>` icon (`sponsorVideoUrl` was `undefined` in state & `localStorage`, while `sponsorVideoPath` was set; `playerOverlayRendered: false`).
    - `(b)` After page reload, `enableSponsor` reverted to `false` (overwritten by stale `ep.voiceSettings` from `series.json`).
    - `(c)` Single export `ffmpegService` already had `colorkey` + `scale` + `overlay` + `-stream_loop -1`, but hardcoded `1920` width scaling (making 25% = 37.5% on 720p), ignored `muteAudio: false`, and `batchExportService.js` dropped `sponsorSettings` completely.
- **Step 1 — Break Points Traced**:
  1. **Upload handler stale-closure overwrite**: `ExportSettingsPanel.jsx` called `onSettingChange('sponsorVideoUrl', ...)` then `onSettingChange('sponsorVideoPath', ...)` back-to-back; `VoiceSettings.jsx` `handleChange` spread stale render-closure `settings`, so the second call wiped `sponsorVideoUrl` back to `undefined`.
  2. **Persistence across reload**: `App.jsx` `VISUAL_SETTING_DEFAULTS` / `RENDER_INVALIDATING_SETTING_KEYS` omitted all `sponsor*` keys, and `handleUpdateVoiceSettings` only background-saved on `ratioChanged`, so `ep.voiceSettings` in `series.json` never saved sponsor changes and overwrote `localStorage` on reload.
  3. **Live preview invisible while paused**: `SponsorOverlay.jsx` used `display: none` on the hidden source `<video>` and skipped canvas drawing when `vid.paused`, leaving a blank canvas until Play.
  4. **Backend export gaps**: `batchExportService.js` never resolved/forwarded `sponsorSettings`; `ffmpegService.js` hardcoded `1920` for non-9:16 width scaling and ignored `muteAudio: false`.
- **Step 2 — Minimal Changes Applied**:
  1. `frontend/src/components/voice/VoiceSettings.jsx`: Added `latestSettingsRef` and atomic object-patch support in `handleChange`.
  2. `frontend/src/components/voice/ExportSettingsPanel.jsx`: Updated upload, sample, and delete actions to pass `{ sponsorVideoUrl, sponsorVideoPath }` atomically and clear `e.target.value = ''`.
  3. `frontend/src/App.jsx`: Added `sponsor*` defaults to `VISUAL_SETTING_DEFAULTS` (invalidating stale renders) and persisted `hasRenderAffectingChange` patches via `handleSaveEpisodeBackground`.
  4. `frontend/src/components/player/SponsorOverlay.jsx` & `SponsorOverlay.css`: Fixed offscreen `<video>` decode (`opacity: 0; preload="auto"`), drew initial chroma-keyed frame even while paused, reset `videoLoaded` on URL change, and fixed CSS `justify-content: center`.
  5. `frontend/src/hooks/useVideoRender.js`: Added `buildSponsorOptions` to `handleStartBatchRender` deps.
  6. `backend/services/batchExportService.js`: Added `resolveSponsorInputForBatch` and forwarded `sponsorSettings` to `renderDubbedVideoWithDucking`.
  7. `backend/services/ffmpegService.js`: Computed sponsor scale width from actual `outputCanvasW` (`1080` for 9:16/1:1, `1920` when padded, else `sourceDimensions.width`) and mixed sponsor audio only when explicitly unmuted (`muteAudio === false`) and audio stream exists.
  8. `backend/tests/sponsor_ads_end_to_end.test.js`: Added static audit + real FFmpeg 10s export test verifying green chroma-key removal, 25% scale at bottom-center, full-duration looping, muted sponsor audio (`<= -50 dB`), and Sponsor OFF unchanged.
- **Verification Evidence**:
  - Frontend build (`npm --prefix frontend run build`): **PASS** (743ms, 0 errors); `oxlint`: **0 errors**.
  - Test suites (`node --test backend/tests/sponsor_ads_end_to_end.test.js backend/tests/timeline_*.test.js`): **92/92 PASS** (16 suites, 0 fail).
  - Real-app verification (`http://localhost:5173/studio`, Edge headless, 0 console/page errors): upload immediately displays panel `<video>` preview + chroma-keyed live player canvas (`centerRGBA: [249,204,21,255]`, `cornerRGBA: [0,0,0,0]`), persists to `series.json` & survives page reload; 30s real export with owner's `DragonDub AI` green-screen MP4 rendered crisp bottom-center banner at `t=25s` with all green removed.

## Active Environment
- **Backend API**: `http://localhost:5000` (restarted with latest backend fix, Status 200 OK)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server)
- **Branch**: `chore/full-project-cleanup` (pushed to `origin/chore/full-project-cleanup`)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` and test uploading green-screen MP4 in Sponsor Ads.

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T19:48:00+07:00

## Summary: Fix Voice Clip Box Extent & Waveform Alignment on Legacy & Recent Episodes (COMPLETED — UI-Only)
- **Step 0 — Stored Data Findings (`Pseudo_Spiritual_Root` `series.json`)**:
  - **Affected legacy episode (`ep_1`, seg `#10`)**: Has `startSec: 21.6`, `endSec: 24.4` (slot `2.8s`), `speed: 1`, `audioUrl`/`audioPath`/`audioFile`, `audioGenerated: true`. Missing ALL duration & waveform metadata (`finalAudioDuration`, `audioDurationSec`, `audioDuration`, `originalAudioDuration`, `rawAudioDur`, `appliedSpeed`, `audioStartSec`, `audioEndSec`, `peaks`, `waveform` are all absent). Actual MP3 duration via `ffprobe`: `2.580s` (and other `ep_1` clips like `#1`: `0.907s`/`1.4s`, `#3`: `1.363s`/`2.2s`, `#19`: `1.427s`/`1.8s`, `#24`: `3.059s`/`3.5s`, `#30`: `0.623s`/`1.2s`).
  - **Recent working episode (`ep_2`, seg `#10`)**: Has `startSec: 31.33`, `endSec: 32.28` (`0.95s` slot), `finalAudioDuration: 0.951`, `audioDurationSec: 0.95`, `audioDuration: 0.951`, `originalAudioDuration: 0.951`, `rawAudioDur: 0.951`, `appliedSpeed: 1`, `audioStartSec: 31.33`, `audioEndSec: 32.28`. Neither episode stores `peaks`/`waveform` arrays in `series.json`.
  - **Second visual root cause confirmed in DOM**: `TimelineTracksCanvas.jsx` computed waveform bar count as `Math.min(40, Math.max(4, Math.floor(((renderedDuration * pps) - 10) / 6)))`, while `.waveform-bar` + `gap` is `4px` pitch (`2px + 2px`). Dividing by `6` and capping at `40` bars (`158px`) caused bars to end at `40–64%` of every clip box even when box width matched audio duration.
- **Step 1 — Minimal UI-Only Fix (`frontend/src/components/timeline/TimelineTracksCanvas.jsx`)**:
  - Added `resolvePeaksDuration` and `resolveVoiceAudioExtent` with exact fallback order: **peaks/waveform-derived extent -> `finalAudioDuration` -> `audioDurationSec` / `audioDuration` / `originalAudioDuration` / `rawAudioDur` (scaled by `appliedSpeed`) -> browser-probed actual audio duration from `audioUrl` (`PROBED_AUDIO_DURATION_CACHE`, UI-only in-memory `<audio preload="metadata">` for visible legacy segments lacking metadata, never persisted) -> `slotSpan` (only when segment has no audio/peaks)**.
  - Fixed waveform bar count to match the true `4px` bar pitch inside the `10px` box inset (`Math.min(400, Math.max(4, Math.floor((waveformWidthPx - 8) / 4)))`) and support real `peaks` arrays when present, so box end == waveform end across all clips and zoom levels.
  - Preserved unchanged: overrun segments (`extent >= slot`) keep slot box + red indication; VIDEO and SUBTITLE rendering untouched; drag/trim/select hitbox = visible box; zero stored data or timing mutations.
- **Regression Test Added**:
  - `backend/tests/timeline_voice_true_extent_rendering.test.js`: Added tests #7 & #8 covering fallback order, 4px bar pitch without 40-bar cutoff, and legacy metadata-less segment rendering.
- **Verification Evidence**:
  - Timeline regression suites (`node --test backend/tests/timeline_*.test.js`): **90/90 PASS** across 15 suites (0 fail).
  - Frontend build (`npm --prefix frontend run build`): **PASS** (628ms, 0 errors); `oxlint`: **0 errors**.
  - Real-app verification (`http://localhost:5173/studio`, Edge headless, read-only route guard, 0 console/page errors):
    - `Pseudo_Spiritual_Root` `ep_1` `#8`–`#12`, `#15`–`#16`: boxes hug true probed MP3 durations (`#10`: `21.6s–24.2s`, `114px`) and waveform fills `96–100%` of inner width (`leftGapPx: 5`, `rightGapPx: 5–7`); overrun `#13`/`#14`/`#16` keep slot boxes (`#16 +0.4s` red).
    - `Pseudo_Spiritual_Root` `ep_2` `#7`–`#16`: zero regression, waveform fills `94–100%` of inner width edge-to-edge.

## Active Environment
- **Backend API**: `http://localhost:5000` (Status 200 OK)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server)
- **Branch**: `chore/full-project-cleanup` (pushed to `origin/chore/full-project-cleanup`)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173/studio` on `Pseudo_Spiritual_Root` EP1 & EP2 to verify visually.

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T19:36:00+07:00

## Summary: Remove "Auto-Fit Speed" Button from Timeline Toolbar (COMPLETED)
- **Changes Applied**:
  1. `frontend/src/components/timeline/TimelineToolbar.jsx`: Removed `⚡ Auto-Fit Speed` button, `onAutoFitSpeechSpeed` prop, and unused `Zap` icon import.
  2. `frontend/src/components/timeline/TimelineEditor.jsx`: Removed `onAutoFitSpeechSpeed` prop & forwarding.
  3. `frontend/src/App.jsx`: Removed `handleAutoFitSpeechSpeed` wrapper & prop pass.
  4. `frontend/src/hooks/useClipOperations.js`: Removed `handleAutoFitSpeechSpeed`, its export, and unused `autoFitSpeechSpeedApi` import.
  - Batch Studio Stage 3 Auto-Fit Speed (`GeminiRouteModal`, `DubbingRunnerContext`, backend `/api/audio/autofit-speed`) left untouched.
- **Verification**:
  - Frontend build (`npm --prefix frontend run build`): **PASS** (687ms, 0 errors); `oxlint`: 0 errors (413 warnings).
  - Timeline + Auto-Fit suites: **91/91 PASS** (16 suites, 0 fail).

## Active Environment
- **Backend API**: `http://localhost:5000` (Status 200 OK)
- **Frontend Studio**: `http://localhost:5173` (Vite dev server)
- **Branch**: `chore/full-project-cleanup` (pushed to `origin/chore/full-project-cleanup`)

## Next Steps
- Refresh browser (`Ctrl + F5`) at `http://localhost:5173` to confirm the toolbar without `Auto-Fit Speed`.

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T19:32:00+07:00

## Summary: Auto-Cut by Subs Bug Diagnosis & Server Restart Verification (COMPLETED — No Code Defect Found)
- **Step 0 — Fresh Restart & Real-App Reproduction**:
  - Cleanly stopped stale backend (`:5000`) and Vite (`:5173`) processes and started fresh backend (`node backend/server.js`) and frontend (`npm --prefix frontend run dev`) servers.
  - Reproduced `Full Video -> Auto-Cut by Subs -> Switch Episode -> Switch Back` across 4 real episodes of `Pseudo_Spiritual_Root` (`ep_1`, `ep_3`, `ep_4`, `ep_5`) in Edge headless with real disk persistence enabled:
    - `ep_5`: `Full Video` (1 clip) -> `Auto-Cut by Subs` -> **376 clips** on disk (`mutedCount: 0`), 36 visible in DOM (`muted: 0`), persisted across EP1 switch & return.
    - `ep_3`: `Full Video` (1 clip) -> `Auto-Cut by Subs` -> **432 clips** on disk (`mutedCount: 0`), 33 visible in DOM (`muted: 0`), persisted across EP1 switch & return.
    - `ep_4` (347 tombstones, immediate 50ms switch): `Full Video` -> `Auto-Cut by Subs` -> **343 clips** on disk (`mutedCount: 0`), 32 visible in DOM, persisted across EP1 switch & return.
    - `ep_1`: `Full Video` (1 clip) -> `Auto-Cut by Subs` -> **324 clips** on disk (`mutedCount: 0`), 36 visible in DOM (`muted: 0`).
  - Browser console errors: **0**, page errors: **0**, error toasts: **0**.
- **Step 1 — Root Cause Diagnosis (`b8501fb` & `039ffa1` audit)**:
  - Audited every line of commits `b8501fb` and `039ffa1`: `autoSplitVideoBySegments`, `handleAutoSplitVideo`, `TimelineToolbar`, `useWorkspaceMedia` (`videoClipsUpdatedAt` auto-bump), and `episodeService` persistence have zero defects and zero remaining references to `onToggleMuteAllCuts`.
  - Root cause of both the earlier `"onToggleMuteAllCuts is not defined"` toast and the broken toolbar behavior was the stale Vite HMR / un-refreshed browser tab from before the server restart. No speculative code edits were made (minimal-change discipline).
- **Verification**:
  - Frontend build (`npm --prefix frontend run build`): **PASS** (0 errors).
  - Full timeline suites (`node --test backend/tests/timeline_*.test.js`): **88/88 PASS** (15 suites, 0 fail).

## Active Environment
- **Backend API**: `http://localhost:5000` (freshly restarted, Status 200 OK)
- **Frontend Studio**: `http://localhost:5173` (freshly restarted Vite dev server)
- **Branch**: `chore/full-project-cleanup` (pushed to `origin/chore/full-project-cleanup`)

## Next Steps
- Hard refresh browser tab (`Ctrl + F5` / `Ctrl + Shift + R`) at `http://localhost:5173` to clear stale HMR state from before the server restart.

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T19:20:00+07:00

## Summary: Play Through Gap Clips During Timeline Playback & Gap Preview Mapping (COMPLETED)
- **Root Cause**:
  - Earlier playback-loop fix skipped Gap clips during active-clip tracking, transition lookahead (`nextDialogueClip`), and `timelineUtils` timeline↔source mapping (`if (isGapClip(c)) continue`), causing Play to jump over real source footage carried by Gap clips.
- **Minimal Changes Applied**:
  1. `frontend/src/hooks/useVideoPlayback.js`:
     - Removed `isGapClip` skip loops in `handleTimeUpdate` so active-clip tracking includes Gaps as playable spans.
     - On clip end (`srcNow >= sEnd - 0.03`), transitions to the immediate `nextClip = videoClips[currentClipIdx + 1]` (including Gaps): seeks forward only if `nextSrcStart > srcNow + 0.15`, advances smoothly on contiguous spans (`nextSrcStart >= srcNow - 0.15`), never seeks backward, and pauses cleanly at the end when no next span exists.
  2. `frontend/src/utils/timelineUtils.js`:
     - Updated `mapTimelineToSourceTime` and `mapSourceToTimelineTime` to include Gap clips' source ranges (`[sourceStart, sourceEnd]`, falling back to `[start, end]`) so playhead inside a Gap maps to real source time (for continuous playback AND paused click-seek preview), while tagging `isGap: isGapClip(c)`.
  3. `backend/tests/timeline_continuous_playback_no_loop.test.js` & `backend/tests/timeline_paused_selection_seek_stability.test.js`:
     - Updated regression tests to assert continuous play-through across `#3 -> Gap -> #4`, forward seek into non-contiguous Gaps, clean pause at end, zero backward seeks, Gap source-footage mapping, and preserved paused click/seek stability.
- **Verification Evidence**:
  - Frontend build (`npm --prefix frontend run build`): **PASS** (611ms, 0 errors); `oxlint`: **0 errors** (416 warnings).
  - Full timeline regression suites (`node --test backend/tests/timeline_*.test.js`): **88/88 PASS** across 15 suites (0 fail).
  - Real-app verification (`http://localhost:5173/studio`, Edge headless on `Pseudo_Spiritual_Root` EP1): played from `00:00` continuously through opening Gap `[0..4s]` into `#1`/`#2` (`0.182s -> 0.613s -> 1.435s -> 2.312s -> 3.157s -> 3.988s -> 4.521s -> 5.476s -> 6.343s`), clock advanced monotonically `00:00 -> 00:06`, `backwardJumps = 0`, paused Gap click remained locked at `00:00`.

## Active Environment
- **Backend API**: `http://localhost:5000` (`/api/health` = 200 OK)
- **Frontend Studio**: `http://localhost:5173`
- **Branch**: `chore/full-project-cleanup` (pushed to `origin/chore/full-project-cleanup`)

## Next Steps
- Ready for owner testing in browser (`http://localhost:5173`).

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-17T19:16:00+07:00

## Summary: Remove "Mute Voice Cuts" Feature & Decouple "Auto-Cut by Subs" (Cut-Only) (COMPLETED)
- **Problem Solved**:
  - Clicking "Auto-Cut by Subs" previously auto-muted dialogue cuts (`isMuted: Boolean(it.hasVoice)`) and surfaced the "Mute Voice Cuts" / "Mute All" bulk-mute controls in the timeline toolbar, track header (`VIDEO 1` mute), and clip inspector.
- **Changes Applied**:
  1. `frontend/src/utils/timelineUtils.js` (`autoSplitVideoBySegments`):
     - Removed `hasVoiceAudio` / `hasVoice` mute-at-cut coupling and set `isMuted: false` on all dialogue cuts, Gaps, and Outro. Running Auto-Cut by Subs now ONLY cuts — never mutes any clip.
  2. `frontend/src/hooks/useClipOperations.js`:
     - Removed `handleToggleMuteAllCuts` and its export. Preserved per-clip mute (`handleToggleMuteVideoClip`) and segment mute (`handleToggleMuteSegment`).
  3. `frontend/src/App.jsx`, `frontend/src/components/timeline/TimelineEditor.jsx`, `frontend/src/components/voice/VoiceSettings.jsx`:
     - Removed `handleToggleMuteAllCuts` / `onToggleMuteAllCuts` callback & prop threading.
  4. `frontend/src/components/timeline/TimelineToolbar.jsx`:
     - Removed the "Mute Voice Cuts" / "Voice Muted" button, `onToggleMuteAllCuts` prop, and unused `Volume2`/`VolumeX` imports. Updated Auto-Cut tooltip to describe cutting only.
  5. `frontend/src/components/timeline/TimelineTrackHeaders.jsx`:
     - Removed `onToggleMuteAllCuts` prop, unused `areAllCutsMuted`, and `onToggleMuteAllCuts(true)` call inside `handleToggleVideoMute`. Track-level mute/unmute (`setMutedTracks`) remains intact.
  6. `frontend/src/components/timeline/TimelineTracksCanvas.jsx`:
     - Removed unused `areAllCutsMuted` block. Preserved per-clip mute rendering (`is-clip-muted`, `clip-mini-muted-badge`) and track mute dimming (`is-track-muted`).
  7. `frontend/src/components/voice/ClipInspectorPanel.jsx`:
     - Removed `onToggleMuteAllCuts` prop and the "Mute All / Unmute All" shortcut button. Preserved per-clip mute (`onToggleMuteVideoClip`) and segment mute (`onToggleMuteSegment`).
  8. `backend/tests/timeline_voice_cut_mute_gap_simple.test.js` & `backend/tests/timeline_ui_workflow_fix.test.js`:
     - Updated assertions to enforce cut-only Auto-Cut (`isMuted === false` on all cuts, runtime + static check) and complete removal of Mute Voice Cuts, while verifying per-clip mute and track mute stay intact.
- **Shared Parts Kept Untouched**:
  - Per-clip `clip.isMuted` (`handleToggleMuteVideoClip`, `VideoPlayerPreview.jsx` `isCurrentVideoClipMuted`, `ffmpegService.js` `buildDynamicDuckingFilter` `.filter((c) => c.isMuted)`, `TimelineTracksCanvas.jsx` `is-clip-muted` / `clip-mini-muted-badge`) and track-level mute (`mutedTracks`).
- **Verification Evidence**:
  - Frontend build (`npm --prefix frontend run build`): **PASS** (650ms, 0 errors).
  - Full timeline suites (`node --test backend/tests/timeline_*.test.js`): **87/87 PASS** (0 fail).
  - Real-app Edge verification (`http://localhost:5173/studio`, read-only sync guard on `Pseudo_Spiritual_Root` EP1, 257 segments): `Full Video` (1 clip) → click `Auto-Cut by Subs` → 23 visible cut clips rendered in viewport, `mutedClips = 0`, `mutedBadges = 0`, `slicingButtons = ["Full Video", "Auto-Cut by Subs"]`, `hasMuteVoiceCutsAnywhere = false`, `hasMuteAllBtn = false`.

## Active Environment
- **Backend API**: `http://localhost:5000` (`/api/health` = 200 OK)
- **Frontend Studio**: `http://localhost:5173`
- **Branch**: `chore/full-project-cleanup` (pushed to `origin/chore/full-project-cleanup`)

## Next Steps
- Ready for owner testing in browser (`http://localhost:5173`).

---

## Previous Session
- **Environment**: Antigravity IDE (`engineering-minimal-change-engineer` discipline)
- **Branch**: `chore/full-project-cleanup` (branched from `refactor/timeline-core-clean` at `31323e1`)
- **Timestamp**: 2026-11-17T19:05:00+07:00

## Summary: Full Project Cleanup & Repair (Phases 0–4 COMPLETED)
- **Phase 0 (`b5e2eec`)**: Completed repo-wide dead-code, logging, broken-wiring, and CSS inventory; wrote `.agents/FULL-FIX-PLAN.md` with grep evidence per item.
- **Phase 1 — Dead Code Removal**:
  - **Batch 1A Frontend (`6926613`)**: Removed 3 dead files (`WorkflowStepper.jsx`, `WorkflowStepper.css`, `features/gemini-route/hooks/index.js`) and dead exports/helpers (`PlayerTopBar`, `checkEpisodeScriptHealthy`, `killTtsApi`, `killTranslateJobApi`, `stripGapSegmentFields`, `getSourceSubtitleEnd`, unused `formatTimecode`) — 12 files, +2/-319 lines.
  - **Batch 1B Backend (`d8b5c50`)**: Removed 3 dead exports in `backend/models/speakerRegistry.js` (`switchSpeakerOrSegmentVoice`, `DEFAULT_VOICES`, `detectGenderFromAcousticPitch`) — 1 file, -78 lines.
- **Phase 2 — Broken Wiring Fixes (1 fix per commit)**:
  - `e41f0ec`: Replaced non-existent `./AiToolsTab` barrel export in `frontend/src/components/media/index.js` with `./DubbingModeTab`.
  - `ec3c98a`: Fixed 404 abort endpoint in `DubbingRunnerContext.jsx:128` (`/api/jobs/:jobId/kill` -> `/api/jobs/:jobId/cancel`).
  - `6b50792`: Removed duplicate `selectedClip`/`onSplitClip`/`onDeleteClip` JSX props on `<VoiceSettings>` in `App.jsx`.
  - `677c766`: Replaced `window.location.reload()` fallback in `EpisodesTab.jsx:107` with SPA `onRefreshSeries()` (turned `full_project_master_upgrade.test.js` Phase 3a GREEN).
  - `1001346`: Exported `getVideoDimensionsFast` from `backend/services/ffmpegService.js` (consumed by `aspect_ratio_and_crop.test.js`).
- **Phase 3 — UI Code Cleanup (`43e3d3d`, zero visual change)**:
  - Removed unreachable `return` in `DubbingRunnerContext.jsx:605`, dead voice-preview state/handlers in `VoiceSettings.jsx`, dead state/handlers/imports in `EpisodesTab.jsx` & `DubbingModeTab.jsx`, unused imports across 7 UI components, and strictly unused CSS blocks in `Navbar.css`, `VoiceSettings.css`, `MediaLibrary.css`, `VideoPlayerPreview.css`, `styles/modals.css` — 16 files, +17/-700 lines (CSS bundle `87.31 kB` -> `79.00 kB`).
- **Phase 4 — Final Verification (ALL PASSED)**:
  - Frozen timeline regression suites: **87/87 PASS** (0 fail).
  - Full backend test suite (`node --test backend/tests/*.test.js`): **316/323 PASS** (improved from 315 -> 316; 5 pre-existing unrelated failures + 2 skipped; 0 regressions).
  - Frontend production build: **PASS** (2036 modules, 615ms, 0 errors); `oxlint`: **0 errors**, warnings `473 -> 417`.
  - Live backend health check: `GET http://localhost:5000/api/health` -> **HTTP 200 OK** (`6/6` Gemini keys active) + fresh `backend/server.js` module boot verified clean.
  - Real pipeline smoke test (`backend/tests/run_real_pipeline_smoke_test.js`): **ALL STAGES PASSED** (Stage 3 OCR -> Stage 4 ASR -> Stage 6 Translation -> Edge Neural TTS 23,684 bytes -> FFmpeg `h264_qsv` Export 102,827 bytes).

## Active Environment
- **Backend API**: `http://localhost:5000` (`/api/health` = 200 OK)
- **Frontend Studio**: `http://localhost:5173`
- **Branch**: `chore/full-project-cleanup` (pushed to `origin/chore/full-project-cleanup`)

## Next Steps
- Review "Needs Owner" items in `.agents/FULL-FIX-PLAN.md` (Section 3) before deciding on follow-up cleanup or merging `chore/full-project-cleanup`.

---

## Previous Session
- **Environment**: Antigravity IDE
- **Branch**: `refactor/timeline-core-clean`
- **Timestamp**: 2026-11-17T16:42:00+07:00

## Summary: Bug Fix — Prevent Playing Loop & Enforce Monotonic Forward Playback Across Gaps (COMPLETED)
- **Problem Diagnosed**:
  - Owner reproduction: press Play — playback reaches the end of a segment and loops it: the picture jumps backward and replays the same section forever instead of continuing to the next segment.
  - **Step 1 — Backward Seek Call Site & Root Cause Identified**:
    1. **Primary backward seek call site (`TimelineEditor.jsx:595` -> `useClipOperations.js:593`)**:
       - When the user had clicked a video clip or Gap prior to playing (`selectedClipKind === 'video'`), the auto-follow `useEffect` in `TimelineEditor.jsx` ran `onSelectClip(matchClip.id)` whenever a new segment started.
       - `onSelectClip` dispatched to `handleSelectClip(clipId)` in `useClipOperations.js`, which called `handleSeek(target.start)` without checking if playback was active (`!isVideoPlaying`).
       - `handleSeek` mapped `target.start` to source start time and set `videoRef.current.currentTime = targetTime`, actively seeking the `<video>` element backward (e.g. from 7.363s backward to 5.400s). The picture jumped back and replayed the segment in an infinite loop.
    2. **Secondary transition stall at Gaps (`useVideoPlayback.js:214`)**:
       - In `useVideoPlayback.js`, clip transition evaluated `nextClip = videoClips[currentClipIdx + 1]`. When the next clip was a Gap (e.g. 8.76s -> 12.0s between voice #3 and voice #4), it attempted to transition into the Gap instead of skipping to the next real dialogue clip (`#4` at 12.0s).
- **Key Changes Implemented (Step 2 — Invariant Enforcement)**:
  1. `frontend/src/hooks/useClipOperations.js`:
     - Updated `handleSelectClip(clipId, shouldSeek = true)`.
     - Added `const isVideoPlaying = Boolean(videoRef?.current && !videoRef.current.paused);` and guarded `handleSeek` with `if (shouldSeek && !isVideoPlaying && target && handleSeek)`.
     - Selecting a clip while playing never triggers a seek; paused manual clicks continue to seek normally.
  2. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - In auto-follow `useEffect`, passed `onSelectClip(matchClip.id, false)` to explicitly suppress seeking during active playback.
  3. `frontend/src/hooks/useVideoPlayback.js`:
     - Imported `isGapClip` from `../utils/timelineOps`.
     - In `handleTimeUpdate`:
       - Active clip tracking skips Gap clips (`if (isGapClip(c)) continue;`).
       - On clip transition (`srcNow >= sEnd - 0.03`): Scans forward past Gaps to find `nextDialogueClip`.
       - Invariant: Only seeks forward if `nextSrcStart > srcNow + 0.15` and never backward.
       - If no next dialogue clip can be resolved, cleanly pauses playback (`v.pause(); setIsPlaying(false)`), never looping back.
  4. `backend/tests/timeline_continuous_playback_no_loop.test.js`:
     - Created regression suite:
       - Test 1: Static code audit of `useClipOperations`, `TimelineEditor`, and `useVideoPlayback`.
       - Test 2: Continuous playback simulation across segment boundaries and VIDEO Gap for 35+ seconds: asserts all seeks move forward (`to >= from`), Gap between #3 and #4 is bridged forward to 12.0s, and playback reaches 35+ seconds without looping.
       - Test 3: Paused click stability on Gap and dialogue clips remains 100% intact.
- **Verification Evidence**:
  - Production build: `npm run build --prefix frontend` (Vite build passed in 660ms, 0 errors).
  - Test suites: **87 passed, 0 failed** across 15 timeline suites (`node --test backend/tests/timeline_*.test.js`), 100% green.

## Active Environment
- **Backend API**: `http://localhost:5000` (`/api/health`)
- **Frontend Studio**: `http://localhost:5173`
- **Branch**: `refactor/timeline-core-clean`

## Next Steps
- Changes committed and pushed to `origin/refactor/timeline-core-clean`.

## Summary: Bug Fix — Lock Playhead & Manual Selection While Paused (COMPLETED)
- **Problem Diagnosed**:
  - Owner reproduction: clicking a Gap clip on the VIDEO track selects the Gap and seeks the playhead to the click point (~00:08.3). About 2 seconds later with NO further input, selection and playhead snap back automatically to dialogue segment #2 (playhead to ~00:05) and the Gap is deselected.
  - **Investigation Breakdown (Both Suspects Identified & Linked in a Fatal Sync Loop)**:
    1. **Suspect 1 (Root cause of playhead jump)**:
       - `mapTimelineToSourceTime` in `frontend/src/utils/timelineUtils.js` treated Gap clips as real media clips, mapping through synthetic/stale `sourceStart` ranges.
       - In `useVideoPlayback.js`, `handleTimeUpdate` ran on `<video>` `timeupdate` events while PAUSED, re-derived timeline time `tlTime` from `<video>.currentTime` (which remained at or mapped to ~5s via first-match over overlapping ranges), and called `setCurrentTime(tlTime)`, actively moving the playhead away from the click point back to ~00:05.
    2. **Suspect 2 (Root cause of Gap deselection)**:
       - In `TimelineEditor.jsx`, the auto-follow `useEffect` ran even when paused, and its video cut tracking (`if (selectedClipKind === 'video')`) lacked an `isPlaying` check.
       - When `currentTime` snapped back to ~00:05, auto-follow resolved dialogue segment #2 and called `onSelectClip` for dialogue clip #2, overriding the user's manual Gap selection.
- **Key Changes Implemented**:
  1. `frontend/src/utils/timelineUtils.js`:
     - Imported `isGapClip` from `./timelineOps.js`.
     - In `mapTimelineToSourceTime`: Skipped Gap clips (`if (isGapClip(c)) continue;`). When clicking/scrubbing in a Gap, returns `{ inClip: false, sourceTime: null, isGap: true, nextClip }`, where `nextClip` finds the next non-gap clip.
     - In `mapSourceToTimelineTime`: Skipped Gap clips (`if (isGapClip(c)) continue;`), ensuring source media positions map only to actual video clips.
  2. `frontend/src/hooks/useVideoPlayback.js`:
     - In `handleTimeUpdate`: Guarded with `if (!isPlaying) return;` so that background media element events (`timeupdate`/`seeked`) while paused NEVER overwrite authoritative timeline `currentTime`.
  3. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - In auto-follow `useEffect`: Added `if (!isPlaying) return;` so paused playback sync never overrides manual selection.
     - In video cut tracking: Added `isPlaying &&` check (`if (isPlaying && selectedClipKind === 'video' && onSelectClip && ...)`).
     - In `handleVideoMouseDown`: Cleared `lastPlayheadSegKeyRef.current = null` on Gap click, and anchored `lastPlayheadSegKeyRef.current = segKey` on dialogue clip click.
  4. `backend/tests/timeline_paused_selection_seek_stability.test.js`:
     - Comprehensive regression suite verifying:
       - Static audit of `useVideoPlayback.js`, `TimelineEditor.jsx`, and `timelineUtils.js`.
       - Gap click simulation: Seek to 8.3s while paused, 5 idle seconds with multiple background `timeupdate` events -> playhead remains at 8.3s, Gap remains selected.
       - Dialogue clip click stability: Seek to dialogue clip while paused -> playhead and dialogue selection remain stable.
       - Normal playback tracking: When `isPlaying = true`, playhead and active clip follow playback smoothly.
- **Verification Evidence**:
  - Production build: `npm run build --prefix frontend` (Vite build passed in 621ms, 0 errors).
  - Test suites: **84 passed, 0 failed** across 14 timeline suites (`node --test backend/tests/timeline_*.test.js`), 100% green.
- **Result**: Manual click selection is authoritative. While paused, playback sync never changes selection or moves playhead. Normal playback tracking while playing is fully preserved.

## Active Environment
- **Backend API**: `http://localhost:5000` (`/api/health`)
- **Frontend Studio**: `http://localhost:5173`
- **Branch**: `refactor/timeline-core-clean`

## Next Steps
- Changes committed and pushed to `origin/refactor/timeline-core-clean`.

## Summary: UI-Only Fix — Voice Clip Box Waveform True Extent Alignment (COMPLETED)
- **Problem Diagnosed**:
  - In `frontend/src/components/timeline/TimelineTracksCanvas.jsx`, voice clip boxes previously rendered for the entire dialogue segment slot (`startSec` to `endSec`) even when the audio/waveform was shorter (e.g. clip #34 where waveform was ~40% of the box, leaving a long empty box tail).
- **Owner's Rules & Solutions**:
  1. **A VOICE clip's box ends where its waveform ends (no empty tail)**:
     - In `TimelineTracksCanvas.jsx` (`internalSegmentRows` and `renderVoiceSegment`), computed the audio's true extent `rawAudioExtent` from audio metadata (`finalAudioDuration`, or `audioDurationSec / appliedSpeed`, etc.).
     - Computed `renderedDuration = (hasAudio && rawAudioExtent < slotDur) ? rawAudioExtent : slotSpan` (respecting manual tighter user trim if set).
     - Defined `rawEnd = rawStart + renderedDuration` and `endSec = isDragging ? (dragState?.mode === 'move' ? (startSec + renderedDuration) : dragState.currentEnd) : ...`.
     - Computed visible box width `audioWidth = Math.max(2, (endSec - startSec) * pps - 2)`.
  2. **Overrun segments (`audio extent >= slot duration`)**:
     - Retained slot-width box, existing red-border, and overrun indicators unchanged.
  3. **No-audio / draft segments**:
     - Retained slot-width box so it stays visible and selectable (`• គ្មានសំឡេង` / draft hint).
  4. **Hitbox, Drag, and Trim**:
     - The visible shortened box serves as the exact clickable and draggable hitbox.
     - While dragging to move, the clip box and ghost retain `renderedDuration` without jumping to slot width.
     - Trim handles sit at the exact visual edges (left at `rawStart`, right at `rawEnd`).
     - Passed `{ ...seg, renderedEnd: rawEnd, renderedDuration }` to `handleAudioMouseDown` and updated `TimelineEditor.jsx` to honor `seg.renderedEnd`.
  5. **VIDEO and SUBTITLE clips**:
     - Unchanged. Subtitles legitimately span the dialogue slot.
  6. **Zero Stored Data / Backend Impact**:
     - Strictly UI canvas rendering; no stored data, no segment timing mutations, no backend code changed.
- **Verification Evidence**:
  - Production build: `npm run build --prefix frontend` (Vite build passed in 598ms, 0 errors).
  - Test suites: **80 passed, 0 failed** across 13 timeline suites (`node --test backend/tests/timeline_*.test.js`), including new regression suite `backend/tests/timeline_voice_true_extent_rendering.test.js`.
  - Owner's scenario (#34): Slot 5.0s, audio duration 2.0s (~40%) -> box ends cleanly at 2.0s with waveform filling the box, no empty tail; normal clips filling slot remain unchanged; overrun clips keep warning; no-audio clips remain selectable.

## Active Environment
- **Backend API**: `http://localhost:5000` (`/api/health`)
- **Frontend Studio**: `http://localhost:5173`
- **Branch**: `refactor/timeline-core-clean`

## Next Steps
- Branch is clean, tests passing, pushed to origin. Ready for testing in UI.

## Summary: Fix Gap Clip Selection & Segment Decoupling on Video Track (COMPLETED)
- **Problem Diagnosed**:
  - Clicking a Gap clip on the VIDEO track selected the neighbouring dialogue clip (#3) instead of the Gap, preventing Gap selection and deletion.
  - Root cause: Video-clip `onClick` in `TimelineTracksCanvas.jsx` and `handleVideoMouseDown` in `TimelineEditor.jsx` resolved an associated segment via `clip.segmentId` / `clip.segmentIndex`. When a Gap clip carried a stale `segmentIndex` (or when bridged), clicking the Gap selected segment #3; `App.jsx` synced clip selection back to dialogue clip #3.
- **Key Changes Implemented**:
  1. `frontend/src/components/timeline/TimelineTracksCanvas.jsx`:
     - Imported `isGapClip` from `../../utils/timelineOps`.
     - In `renderVideoClip` `onClick`: If `isGapClip(clip)` is true, selects ONLY the clip (`onSelectClipKind('video')`, `onSelectClip(clip.id)`), clears segment selection (`setSelectedAudioId(null)`, `setSelectedSubId(null)`, `onSelectSegment(null)`), and skips the associated-segment lookup entirely. Dialogue clips retain previous association behavior.
     - In `renderVideoClip`: Added `!isGapClip(clip)` guard to `isAssociatedWithSeg` so Gaps never evaluate as linked to segments.
     - In `renderVoiceBlock` and `renderSubtitleBlock`: Added `!isGapClip(c)` guard so voice/subtitle segments never link to Gap clips.
     - In virtualization filter: Guarded `!isGapClip(clip)` on segment ID match.
  2. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - In `handleVideoMouseDown`: If `isGapClip(clip)` is true, selects ONLY the clip (`onSelectClipKind('video')`, `onSelectClip(clip.id)`), clears `selectedSegmentIdRef`, `lastSyncedInspectorIdRef`, and calls `setSelectedSubId(null)`, `setSelectedAudioId(null)`, `onSelectSegment(null)`, skipping the `targetSeg` lookup.
  3. `frontend/src/utils/timelineOps.js`:
     - Added `stripGapSegmentFields(clip)` helper.
     - In `ok(state)`: Automatically strips `segmentId` and `segmentIndex` from all Gap clips in returned `videoClips`.
     - In `deleteVideoClip`: Explicitly stripped `segmentId` and `segmentIndex` from created `gap`, `fillGap`, `endGap`, and merged adjacent Gaps.
     - In `deleteGap`: Explicitly stripped `segmentId` and `segmentIndex` from merged adjacent Gaps.
     - In `splitClip`: Stripped `segmentId` and `segmentIndex` from both parts when splitting a Gap.
  4. `frontend/src/utils/timelineUtils.js`:
     - In `bridgeClipGaps`: Stripped `segmentId` and `segmentIndex` from any Gap clips in the returned array.
     - In `autoSplitVideoBySegments`: Explicitly stripped `segmentId` and `segmentIndex` from newly generated Gap clips and Outro clips.
  5. `backend/tests/timeline_gap_selection_fix.test.js`:
     - Created comprehensive regression suite covering static audit, selection isolation simulation, R3 ripple on delete, dialogue clip #4 pair retention, and Gap object purity across all utils.
- **Verification Evidence**:
  - Full timeline test suites (16 suites): **74 passed, 0 failed** (`node --test backend/tests/timeline_*.test.js`).
  - Production build: `npm run build --prefix frontend` (Vite build passed in 622ms, 0 errors).
  - Real-app simulation: Clicking Gap between #3 and #4 selects ONLY Gap with selection border (`isSelected = true`); #3 has `isSelected = false, isLinked = false`; pressing Delete removes the Gap and fires the R3 ripple left; clicking dialogue clip #4 selects #4 and links voice segment #4 as before.

## Active Environment
- **Backend API**: `http://localhost:5000` (`/api/health`)
- **Frontend Studio**: `http://localhost:5173`
- **Branch**: `refactor/timeline-core-clean`

## Next Steps
- Push changes to origin.
- Report completion and STOP per prompt.
- **Problem Diagnosed**:
  - Browser showed `502 (Bad Gateway)` / `ECONNREFUSED` on all API endpoints (`/api/health`, `/api/series`, `/api/tts/voices`, etc.) because Vite dev server on `:5173` could not connect to backend on `:5000`.
  - Direct execution of `node backend/server.js` revealed a startup crash: `ReferenceError: generateStorytellingScript is not defined at geminiService.js:1245:3` (an earlier dead-code pruning commit had removed the function body while leaving the export referenced by `scriptRoutes.js`).
  - `dev.ps1` previously waited 30s blindly without inspecting if the child process died, then launched frontend anyway.
- **Key Fixes Implemented**:
  1. `backend/services/geminiService.js`:
     - Restored full `generateStorytellingScript(promptText, customApiKey, options)` implementation.
  2. `backend/server.js`:
     - Implemented fail-fast startup crash guard: If an uncaught exception or rejection happens before `app.listen()` (`!isServerReady`), log `[CRITICAL] Startup Exception` and call `process.exit(1)`. Once listening (`isServerReady = true`), keep top-level resilience guards to prevent socket disconnects from terminating Node.
  3. `dev.ps1`:
     - In `Wait-ForBackend` and `Wait-ForFrontend`, added `$Process` parameter and `$Process.HasExited` check. If child exits prematurely, fail fast immediately, output exit code, and provide manual debug hints.
     - Passed `$backendProc` and `$frontendProc` from `Start-DevProcess`.
     - In `Free-Port`, unified `Get-NetTCPConnection` and `netstat -ano` using `HashSet[int]` to avoid duplicate `taskkill` calls.
     - In the keep-alive loop, added real-time monitoring of `$backendProc.HasExited` and `$frontendProc.HasExited` to alert user if either service stops during a session.
  4. `start.bat`:
     - Added `cd /d "%~dp0"` to guarantee correct directory resolution when double-clicked.
     - Added `%ERRORLEVEL%` check with `pause` so terminal windows stay open with error details instead of flashing and closing.
  5. `backend/tests/timeline_ui_workflow_fix.test.js`:
     - Aligned Step 3 tooltip regex assertion to match `#${segmentNumber}` or `#${idx + 1}`.
- **Verification Evidence**:
  - Full timeline test suites (15 suites): **69 passed, 0 failed** (`node --test backend/tests/timeline_*.test.js`).
  - Queue dispatch suite: **5 passed, 0 failed** (`node --test backend/tests/queue_dispatch_and_payload.test.js`).
  - Production build: `npm run build --prefix frontend` (Vite build passed in 935ms, 0 errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (`/api/health`)
- **Frontend Studio**: `http://localhost:5173` (Vite dev proxy -> `http://127.0.0.1:5000`)

## Next Steps
- Run `.\dev.ps1` or double-click `start.bat` to launch full stack.

## Summary: Spec Amendment — Rule R3 in timelineOps.deleteGap (CapCut Ripple) (COMPLETED)
- **Scope**: Fixed Rule R3 in `frontend/src/utils/timelineOps.js` (`deleteGap`) and aligned test expectations, persistence, and documentation without touching R1 or R2 (single-item deletes stay track-independent).
- **Owner's Case & Correct Behavior**:
  - Deleting a middle Gap joins the film (`||`) and ripples later VIDEO clips AND all segments that start at or after the Gap's end left by the same Gap duration $D$ (CapCut ripple).
  - A voice belongs to its clip and moves with the film.
  - Segments starting before the Gap's end are untouched (deep-equal).
  - IDs, `_uid`, source times (`sourceStartSec`/`sourceEndSec`), and each segment's subtitle stay attached; only timeline times (`startSec`/`endSec`/`audioStartSec`/`audioEndSec` and clip `start`/`end`) shift.
- **Key Changes Implemented**:
  1. `frontend/src/utils/timelineOps.js`:
     - Updated `deleteGap` to ripple segments whose start is >= gapEnd - 0.001 left by D, preserving segments before gapEnd via `deepClone`.
  2. Persistence & Hook Wiring:
     - `backend/services/episodeService.js`: Supported optional `segments` payload on `operation: 'delete'` with `track: 'videoClips'` to persist shifted segments in a single locked `series.json` update.
     - `frontend/src/utils/projectStorage.js`: Synchronized `segments` on `delete` when `track === 'videoClips'`.
     - `frontend/src/hooks/useClipOperations.js`: Updated `handleDeleteClip` to set and persist `opResult.state.segments` when deleting a Gap clip.
     - `frontend/src/components/timeline/TimelineEditor.jsx`: Threaded `opResult.state.segments` to `onUpdateClips(newClips, newSegments)`.
  3. Tests & Specifications:
     - `backend/tests/timeline_pure_ops_r1_r4.test.js`:
       - R3.1: opening Gap delete shifts later video clips and segments starting at/after Gap end left by D.
       - R3.2: middle Gap delete shifts subsequent clips and segments; prior clips and segments are deep-equal untouched.
       - R3.3: reject non-gap clip delete.
       - R3.4: sync case: clips `[#5, Gap 0.5s, #6]` with voices at their clips -> after `deleteGap`, video #6 and voice #6 both start 0.5s earlier and remain aligned.
     - `backend/tests/timeline_step_a_real_app_acceptance.test.js`:
       - Updated Check 3 opening Gap acceptance to verify shifted segments and undo restoration.
       - Added Check 4 middle Gap acceptance to verify prior segments untouched, subsequent segments shifted, and undo restoration.
     - `backend/tests/timeline_phase3_final_acceptance.test.js`:
       - Updated Check 2 to reflect the amended R3 segment shift.
     - `.agents/TIMELINE-DESIGN.md`:
       - Updated Rule R3 text, invariants, and acceptance matrix to reflect CapCut ripple behavior.
- **Verification Evidence**:
  - Full timeline test suites (14 suites): **65 passed, 0 failed** (`node --test`).
  - Production build: `npm run build --prefix frontend` (Vite build passed with 0 errors).

## Summary: Phase 2 — Dead-Code Removal & Real Pipeline Smoke Test (COMPLETED)
- **Scope**: Full execution of approved dead-code removal across 4 isolated batches + end-to-end pipeline smoke test on branch `refactor/timeline-core-clean`.
- **Batch Execution & Commits**:
  1. **Batch 1 (`181dd1b`) — Frontend Dead File**:
     - Deleted `frontend/src/App.css` (0 imports repo-wide).
     - Build verification: `npm --prefix frontend run build` (built in 725ms, 0 errors).
  2. **Batch 2 (`9115923`) — Frontend Dead Exports**:
     - Pruned `useStudioContext` from `StudioContext.jsx`.
     - Pruned `selectPartitionedSelectedEpisodes`, `selectStageCompletionFlags`, `selectedTotalBrokenCount` from `geminiRouteSelectors.js`.
     - Pruned `saveActiveProject`, `loadActiveProject` from `projectStorage.js`.
     - Pruned `resetSegmentsToSourceTiming` from `timelineUtils.js`.
     - Verification: `npm --prefix frontend run build` + 54 timeline unit tests passing (100% green).
  3. **Batch 3 (`103a212`) — Backend Services Dead Exports**:
     - Pruned `classifySegmentsFromMedia` from `audioClassifierService.js`.
     - Pruned `cancelSeparationJob` from `audioSeparationService.js`.
     - Pruned `inFlightProxyJobs`, `createGeminiProxyVideo`, `cleanupProxyFile`, `getActiveJobRenderProcess`, `renderDubbedVideo`, `measureAudioLoudnessDiagnostics` from `ffmpegService.js`.
     - Pruned `buildOrderedCascadeModels` from `geminiModelCatalog.js`.
     - Pruned `DEFAULT_QUOTA_SETTINGS` from `geminiQuotaTracker.js`.
     - Pruned `sanitizeSubtitleDuration`, `getPromptForMode`, `validateAndSanitizeSegment`, `auditTimelineCoverage`, `generateDubbingScript`, `generateScriptFromMedia` from `geminiService.js`.
     - Verification: Node syntax parsing + regression suites passing (100% green).
  4. **Batch 4 (`f592745`) — Pipeline Stages & TTS Dead Exports**:
     - Pruned `generateBaseSamplingGrid` from `stage3_extractChineseSubtitles.js`.
     - Pruned `groupTranscriptionWordsIntoSegments` from `stage4_analyzeDialogueAudio.js`.
     - Pruned `DRAMA_GENRES`, `CULTIVATION_DRAMA_GLOSSARY` from `stage6_generateModeSpecificScript.js`.
     - Pruned `generateKhmerSpeech`, `generateBatchSpeech` from `ttsService.js`.
     - Verification: Node syntax parsing + 37 timeline regression tests passing (100% green).
- **Net Reclaimed Metrics**:
  - `git diff --stat f3a6abd..f592745`: **15 files changed, 1 insertion(+), 1154 deletions(-)**.
  - 1 dead file deleted (`frontend/src/App.css`).
  - 0% regression on living code.
- **End-to-End Real Pipeline Smoke Test (`63a71bc`)**:
  - Executed `backend/tests/run_real_pipeline_smoke_test.js`:
    - Step 0: Real 4.0s video generated (1080x1920 with audio tone).
    - Step 1 (Stage 3 OCR): Extracted 1 Chinese segment (`"掌门师尊，弟子在此候命。"`).
    - Step 2 (Stage 4 ASR & Pitch): Extracted 1 speech segment with gender detection.
    - Step 3 (Stage 6 Translation): Generated Mode A translation (`"លោកគ្រូធំ កូនសិស្សនៅទីនេះរង់ចាំបញ្ជា。"`).
    - Step 4 (TTS Synthesis): Generated Edge Neural audio file (`23,348 bytes`, `2.53s duration`).
    - Step 5 (Small Export): FFmpeg exported dubbed video with dynamic ducking and burned ASS subtitles (`103,515 bytes`).
    - Result: **ALL STAGES PASSED (100% GREEN)**.

## Active Environment
- **Branch**: `refactor/timeline-core-clean` (pushed to origin)
- **Frontend Dev URL**: `http://localhost:5173`
- **Backend API**: `http://localhost:8080`

## Next Steps
- Spec amendment on `timelineOps.deleteGap` (R3) completed and verified. Stopped per prompt.
- Ready for final review / PR creation by the project owner.
- **Scope**: Rigorous audit of `frontend/src/` (115 files) and `backend/` (`routes/`, `services/`, `utils/`, 53 files) on branch `refactor/timeline-core-clean`.
- **Protocol Adherence**: Strictly **AUDIT ONLY**. Zero files or functions deleted. Manifest generated at `.agents/DEAD-CODE-MANIFEST.md`. Stopped at gate awaiting owner approval.
- **Immediate Hotfix**:
  - Resolved `ReferenceError: useMemo is not defined` in `frontend/src/hooks/useVideoPlayback.js` by adding `useMemo` to React imports. Committed (`44d1fbe`) and pushed.
- **Audit Findings**:
  - **Dead Files (1 file)**:
    - `frontend/src/App.css` (63 bytes, 2 lines): Completely unreferenced repo-wide.
  - **Dead Exported Functions & Constants (27 symbols across 13 modules, ~796 lines)**:
    - Frontend:
      - `StudioContext.jsx`: `useStudioContext` (3 lines)
      - `geminiRouteSelectors.js`: `selectPartitionedSelectedEpisodes` (27 lines), `selectStageCompletionFlags` (11 lines)
      - `projectStorage.js`: `saveActiveProject` (7 lines), `loadActiveProject` (12 lines)
      - `timelineUtils.js`: `resetSegmentsToSourceTiming` (85 lines)
    - Backend:
      - `audioClassifierService.js`: `classifySegmentsFromMedia` (23 lines)
      - `audioSeparationService.js`: `cancelSeparationJob` (3 lines)
      - `ffmpegService.js`: `createGeminiProxyVideo` (111 lines), `cleanupProxyFile` (8 lines), `getActiveJobRenderProcess` (3 lines), `renderDubbedVideo` (9 lines), `measureAudioLoudnessDiagnostics` (24 lines)
      - `geminiModelCatalog.js`: `buildOrderedCascadeModels` (23 lines)
      - `geminiQuotaTracker.js`: `DEFAULT_QUOTA_SETTINGS` (1 line)
      - `geminiService.js`: `sanitizeSubtitleDuration` (17 lines), `getPromptForMode` (21 lines), `validateAndSanitizeSegment` (120 lines), `auditTimelineCoverage` (67 lines), `generateDubbingScript` (117 lines), `generateScriptFromMedia` (16 lines)
      - `stage3_extractChineseSubtitles.js`: `generateBaseSamplingGrid` (20 lines)
      - `stage4_analyzeDialogueAudio.js`: `groupTranscriptionWordsIntoSegments` (27 lines)
      - `stage6_generateModeSpecificScript.js`: `DRAMA_GENRES` (8 lines), `CULTIVATION_DRAMA_GLOSSARY` (1 line)
      - `ttsService.js`: `generateKhmerSpeech` (22 lines), `generateBatchSpeech` (3 lines)
  - **Suspects Debunked & Kept Active**:
    - `usePlaybackEngine.js`, `useStudioActions.js`, `formatTime.js`, `cleanKhmer.js`, `features/dubbing-runner/`, `features/gemini-route/`, `context/` are all alive, mounted, and verified.
- **Verification**:
  - Frontend build (`npm --prefix frontend run build`): **2036 modules transformed**, built in 601ms (0 errors).
  - Living timeline test suites: **56/56 passing (100% green)**.

## Active Environment
- **Branch**: `refactor/timeline-core-clean`
- **Frontend Dev URL**: `http://localhost:5173`
- **Backend API**: `http://localhost:8080`

## Next Steps (Phase 2 - After Owner Approval)
1. Delete Batch 1: Remove `frontend/src/App.css`.
2. Delete Batch 2: Remove dead exports in `StudioContext.jsx`, `geminiRouteSelectors.js`, `projectStorage.js`, `timelineUtils.js`.
3. Delete Batch 3: Remove dead exports in `audioClassifierService.js`, `audioSeparationService.js`, `ffmpegService.js`, `geminiModelCatalog.js`, `geminiQuotaTracker.js`, `geminiService.js`.
4. Delete Batch 4: Remove dead exports in `stage3_extractChineseSubtitles.js`, `stage4_analyzeDialogueAudio.js`, `stage6_generateModeSpecificScript.js`, `ttsService.js`.
5. Run build and tests after each batch and commit separately.

---

## Prior Sessions History
### Final Cleanup — Retiring Legacy Editing Functions & Tests
- **Scope**: Final cleanup step on branch `refactor/timeline-core-clean`:
  0. **Hotfix Runtime ReferenceError**:
     - Added missing `useMemo` to the React import in `frontend/src/hooks/useVideoPlayback.js` (`import { useState, useCallback, useRef, useEffect, useMemo } from 'react';`).
  1. **Zero Production Callers Proof**:
     - Executed: `git grep -n -E "deleteClipById|deleteSegmentByIdOrIndex|splitClipAtTime|autoAlignVoiceSegments" frontend/src/ ":!frontend/src/utils/timelineUtils.js"`
     - Result: **0 occurrences** (command exited with code 1, zero lines matched across all production files in `frontend/src/`).
  2. **Deleted 4 Legacy Functions from `frontend/src/utils/timelineUtils.js`**:
     - `splitClipAtTime` (removed lines 189–254)
     - `deleteClipById` (removed lines 410–583)
     - `deleteSegmentByIdOrIndex` (removed lines 480–575)
     - `autoAlignVoiceSegments` (removed lines 824–1039)
     - Preserved all read-only and calculation helpers: `isSegmentMatch`, `findSegmentIndex`, `bridgeClipGaps`, `autoSplitVideoBySegments`, `normalizeClips`, `trimClip`, `moveClip`, `mapSourceToTimelineTime`, `resetSegmentsToSourceTiming`.
  3. **Retired 4 Legacy Test Suites**:
     - Removed files with `git rm`:
       - `backend/tests/timeline_ripple_delete_auto_left.test.js`
       - `backend/tests/split_clip_selection_priority.test.js`
       - `backend/tests/split_canonical_timing_ep2.test.js`
       - `backend/tests/timeline_unlimited_voice_lanes.test.js`
  4. **Ported 2 Living Suites to Pure `timelineOps`**:
     - `backend/tests/auto_align_voice.test.js`:
       - Ported from `autoAlignVoiceSegments` to `timelineOps.autoAlign` and `timelineOps.resetTiming`.
       - Updated ID expectation in Test 1 to verify Rule R5: survivors retain their real segment IDs (e.g. `aligned[2].id === 5`) instead of arbitrary sequential renumbering.
       - Result: **9/9 passed**.
     - `backend/tests/timeline_toolbar_split_under_playhead.test.js`:
       - Ported from `splitClipAtTime` to `timelineOps.splitClip` and `timelineOps.splitSegment`.
       - Verified playhead-under-cursor splitting for standard video, virtual fresh-episode video, Gap clips, and selected segments.
       - Result: **6/6 passed**.
  5. **Verification**:
     - Frontend build (`npm --prefix frontend run build`): **2036 modules transformed**, built in 618ms (0 errors).
     - Timeline core pure ops suite:
       - `timeline_pure_ops_r1_r4.test.js`: **17/17 passed**
       - `timeline_step_a_real_app_acceptance.test.js`: **3/3 passed**
       - `timeline_step_b_real_app_acceptance.test.js`: **4/4 passed**
       - `timeline_step_c_real_app_acceptance.test.js`: **5/5 passed**
       - `timeline_step_d_real_app_acceptance.test.js`: **5/5 passed**
       - `timeline_phase3_final_acceptance.test.js`: **5/5 passed**
       - `auto_align_voice.test.js`: **9/9 passed**
       - `timeline_toolbar_split_under_playhead.test.js`: **6/6 passed**
       - `timeline_clip_selection_kind.test.js`: **5/5 passed**
       - `timeline_no_overlap_snap.test.js`: **2/2 passed**
       - **Total Timeline Core Tests: 56/56 PASSED (100% green)**.
     - Backend full suite (`node --test backend/tests/*.test.js`): **294 passed, 7 failed** (all 7 failures are pre-existing outside-timeline tests, including the known tooltip regex expectation in `timeline_ui_workflow_fix.test.js`).
- **Git State**: Branch `refactor/timeline-core-clean` clean and ready to commit & push.

## Active Environment
- Branch: `refactor/timeline-core-clean`
- Backend API: `http://localhost:5000`
- Frontend: `http://localhost:5173`

## Next Steps
- Rebuild Timeline Clean Core project is 100% complete and fully verified.
- Branch `refactor/timeline-core-clean` is ready for review by the repository owner (never merge to main directly).

## Prior Summary: Codex Global Configuration Optimization (Max Agent Capability)
- **Scope**: Tuned global Codex CLI configuration (`C:\Users\nhastar\.codex\config.toml`) to maximize agent power, reasoning depth, and autonomous capabilities.
- **Config Highlights**:
  - `model = "gpt-reserve"`: Set to priority-1 specialized agentic coding model.
  - `model_reasoning_effort = "max"` & `plan_mode_reasoning_effort = "max"`: Maximized reasoning depth for complex problem solving.
  - `approval_policy = "on-request"`: Proactive execution without unnecessary friction.
  - `model_verbosity = "high"`: Thorough code analysis, detailed step-by-step verification.
  - `[features]`: Enabled `multi_agent_v2`, `agent_message_board`, `runtime_agent_instances`, `subagent_thread_environments`, `code_mode`, `skill_search`, `goals`, `browser_use`, `tool_suggest`, `unified_exec`.
- **Validation**: Verified with `codex doctor` — 79 feature flags enabled, 6 overrides active, configuration parsed and validated with 0 errors.

## Prior Summary: Phase 2 Step D — Rewire TRIM and MOVE to Pure TimelineOps
- **Scope**: Re-wired all clip and segment TRIM and drag-MOVE paths to pure ops `timelineOps.trimClip` and `timelineOps.moveClip` in `TimelineEditor.jsx`. Replaced inline mutations and array splices. Preserved `pushUndoSnapshot` (one snapshot per completed drag on mouse-up, never per mouse-move), persistence on drag-end, snapping/magnet calculations (snapping determines target time; op validates and applies it), and selection updates. Subtitles remain strictly attached to their segments and follow segment moves. Overlapping video moves are rejected with explanatory reasons via toast notifications. Delete (Step A), Split (Step B), and Auto-Align/Reset (Step C) preserved. Old utils preserved.
- **Changes Applied**:
  1. `frontend/src/utils/timelineOps.js`:
     - Extended `trimClip` to handle both video clips and voice/subtitle segments:
       - Video left trim / right trim: clamps to source duration, checks overlap against adjacent clips on same track row, updates `start`/`end` and `sourceStart`/`sourceEnd`.
       - Segment left trim / right trim: clamps to `MIN_CLIP_DURATION (0.2s)`, updates `startSec`/`endSec`, `audioStartSec`/`audioEndSec`, `duration`/`audioDurationSec`, and sets `audioTrimmed: true, userTrimmed: true`.
       - Non-destructive: leaves other clips and segments completely untouched.
       - Uses `findSegIdx(segments, clipId)` helper to avoid undeclared references and safely handles numeric segment IDs (e.g. index 0).
     - Extended `moveClip` to handle both video clips and voice/subtitle segments:
       - Video move: prevents overlapping clips on the same video track (`Math.max(safeStart, other.start) < Math.min(safeEnd, other.end) - 0.001`), returning `applied: false` with explanatory reason instead of overlapping.
       - Segment move: moves segment along timeline (`startSec`, `endSec`, `audioStartSec`, `audioEndSec`), preserving duration and maintaining attached subtitles (`khmerText`, etc.) with optional `subTrackRow` support.
       - Non-destructive: survivors retain original IDs and times.
  2. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - Imported `trimClip as trimClipOp, moveClip as moveClipOp` from `../../utils/timelineOps`.
     - Rewired `handleMouseUp`:
       - Audio/subtitle move: dispatches to `moveClipOp(currentState, { clipId, newStart, trackRow, subTrackRow })`. If rejected, shows reason via toast; if applied, calls `onUpdateSegments(opResult.state.segments, false, true)` (pushing exactly one undo snapshot).
       - Audio/subtitle trim: dispatches to `trimClipOp(currentState, { clipId, edge, newTime })`. If rejected, shows reason via toast; if applied, calls `onUpdateSegments(opResult.state.segments, false, true)`.
       - Video trim: dispatches to `trimClipOp(currentState, { clipId, edge, newTime, maxSourceDuration })`. If rejected, shows reason via toast; if applied, calls `onUpdateClips(opResult.state.videoClips)`.
       - Video move: dispatches to `moveClipOp(currentState, { clipId, newStart, trackRow })`. If rejected, shows reason via toast; if applied, syncs associated segments and calls `onUpdateClips(opResult.state.videoClips, updatedSegs)`.
  3. `backend/tests/timeline_step_d_real_app_acceptance.test.js`:
     - Created real-app acceptance test verifying operations against stored `series.json` on disk:
       - Check 1: Trim clip right edge -> only its end changes in file; survivor clips and segments remain untouched.
       - Check 2: Drag voice to new slot -> only it moves, attached subtitle follows.
       - Check 3: Attempt overlapping video move -> rejected with visible reason, disk file completely unchanged.
       - Check 4: Ctrl+Z restores exact prior state across trim and move operations.
       - Check 5: Trim segment left and right edges -> updates audioTrimmed, startSec/endSec, keeping survivors untouched.
- **Verification**:
  - `npm --prefix frontend run build`: **2036 modules transformed**, built in 729ms (0 errors).
  - Pure Ops R1-R4: `backend/tests/timeline_pure_ops_r1_r4.test.js` (**17/17 passed**).
  - Toolbar Split Under Playhead: `backend/tests/timeline_toolbar_split_under_playhead.test.js` (**6/6 passed**).
  - Auto-Align Voice Suite: `backend/tests/auto_align_voice.test.js` (**9/9 passed**).
  - Step A Real-App Acceptance: `backend/tests/timeline_step_a_real_app_acceptance.test.js` (**3/3 passed**).
  - Step B Real-App Acceptance: `backend/tests/timeline_step_b_real_app_acceptance.test.js` (**4/4 passed**).
  - Step C Real-App Acceptance: `backend/tests/timeline_step_c_real_app_acceptance.test.js` (**5/5 passed**).
  - Step D Real-App Acceptance: `backend/tests/timeline_step_d_real_app_acceptance.test.js` (**5/5 passed**).
  - Frontend lint (`oxlint`): **0 errors**.
  - Total timeline clean core tests: **49/49 passed**. Pre-existing failure: 1 in `backend/tests/timeline_ui_workflow_fix.test.js` (tooltip regex expectation).
- **Git State**: Committed (`e4c330e`) and pushed to `origin/refactor/timeline-core-clean`.

## Active Environment
- Branch: `refactor/timeline-core-clean` (pushed to origin)
- Backend API: `http://localhost:5000`
- Frontend: `http://localhost:5173`

## Next Steps
- Phase 3: Playback mapping monotonic fix in `useVideoPlayback.js` (monotonic timeline time, lookup from last mapped clip).
- Phase 4: Duration display verification (R7).
- Phase 5: Clean up old unused utils and final acceptance sweep.

## Last Session
- **Environment**: Antigravity IDE
- **Branch**: `refactor/timeline-core-clean`
- **Timestamp**: 2026-11-17T14:24:00+07:00

## Summary: Phase 2 Step C — Rewire AUTO-ALIGN and RESET TIMING to Pure TimelineOps
- **Scope**: Re-wired AUTO-ALIGN (`handleAutoAlignNoOverlap`) and RESET TIMING (`handleResetToSourceTiming`) to pure ops `timelineOps.autoAlign` and `timelineOps.resetTiming`. Completely removed the old step-2 segment-to-cut sync block and snap-to-00:00 lead shift (pure ops define behavior now, move-only, zero hidden cross-track coupling). Subtitles belong strictly to their segments. Delete (Step A) and Split (Step B) preserved. Trim/move left untouched. Old utils preserved.
- **Changes Applied**:
  1. `frontend/src/utils/timelineOps.js`:
     - Preserved `seg.id` and `seg.segmentId` on `autoAlign` and `resetTiming` so non-contiguous survivor IDs (e.g. after deletion) and user-added segment IDs are never renumbered.
     - Preserved `sourceStartSec` and `sourceEndSec` across `autoAlign` passes so `resetTiming` can always return segments to their source-anchored times.
     - In `resetTiming`, prioritized `sourceStartSec` over `startSec` so edited or aligned segments accurately return to original source times.
     - Cleaned up `overrunRatio` handling to avoid `overrunRatio: undefined` property leaks across JSON serialization passes (ensuring strict idempotency).
  2. `frontend/src/hooks/useClipOperations.js`:
     - Imported `autoAlign as autoAlignOp, resetTiming as resetTimingOp` from `../utils/timelineOps`.
     - Rewired `handleAutoAlignNoOverlap`:
       - Dispatches to `autoAlignOp(currentState, { totalDuration, options })`.
       - Enforces hard count guard: aborts write-back with toast and console warning if `alignedSegments.length !== currentSegments.length`.
       - Compares timeline signatures; if unchanged, returns early without modifying state or pushing undo.
       - Pushes single undo snapshot, writes back to `scriptData`, and triggers master narration re-sync via `syncTimelineAudioApi`.
     - Rewired `handleResetToSourceTiming`:
       - Dispatches to `resetTimingOp(currentState, { totalDuration })`.
       - Pushes single undo snapshot, writes back to `scriptData`, and triggers master narration re-sync via `syncTimelineAudioApi`.
  3. `backend/tests/timeline_step_c_real_app_acceptance.test.js`:
     - Created real-app acceptance test verifying operations against stored `series.json` on disk:
       - Check 1: Add a voice next to a same-text line -> Auto-Align -> added voice stays, count unchanged (move-only).
       - Check 2: Episode with subtitles -> Auto-Align -> segment count AND subtitle count unchanged, no subtitle sits at 00:00 unless its segment starts there (no snap-to-00:00).
       - Check 3: Auto-Align twice in a row -> second run changes nothing (strictly idempotent).
       - Check 4: Reset Timing -> segments return to source-anchored times, count unchanged.
       - Check 5: Ctrl+Z after align restores exact prior state from stored file.
- **Verification**:
  - `npm --prefix frontend run build`: **2036 modules transformed**, built in 647ms (0 errors).
  - Pure Ops R1-R4: `backend/tests/timeline_pure_ops_r1_r4.test.js` (**17/17 passed**).
  - Toolbar Split Under Playhead: `backend/tests/timeline_toolbar_split_under_playhead.test.js` (**6/6 passed**).
  - Auto-Align Voice Suite: `backend/tests/auto_align_voice.test.js` (**9/9 passed**).
  - Step A Real-App Acceptance: `backend/tests/timeline_step_a_real_app_acceptance.test.js` (**3/3 passed**).
  - Step B Real-App Acceptance: `backend/tests/timeline_step_b_real_app_acceptance.test.js` (**4/4 passed**).
  - Step C Real-App Acceptance: `backend/tests/timeline_step_c_real_app_acceptance.test.js` (**5/5 passed**).
  - Total timeline clean core tests: **44/44 passed**. Pre-existing failure: 1 in `backend/tests/timeline_ui_workflow_fix.test.js` (tooltip regex expectation).
- **Git State**: Committed (`d1ba32f`) and pushed to `origin/refactor/timeline-core-clean`.

## Active Environment
- Branch: `refactor/timeline-core-clean` (pushed to origin)
- Backend API: `http://localhost:5000`
- Frontend: `http://localhost:5173`

## Next Steps
- Phase 2 Step D: Rewire TRIM and MOVE to `timelineOps.trimClip` and `timelineOps.moveClip`.
- Phase 3: Playback mapping monotonic fix in `useVideoPlayback.js`.
- Phase 4: Duration display verification (R7).

## Last Session
- **Environment**: Antigravity IDE
- **Branch**: `refactor/timeline-core-clean`
- **Timestamp**: 2026-11-17T14:18:00+07:00

## Summary: Phase 2 Step B — Rewire SPLIT to Pure TimelineOps
- **Scope**: Re-wired SPLIT operations only in `useClipOperations` (`handleSplitClip`), removing ~300 lines of brittle inline text-splitting, timing computation, and manual slicing (`executeSplitSegment`). Split now dispatches cleanly to `timelineOps.splitSegment` and `timelineOps.splitClip`. Split routing in `TimelineEditor` / `TimelineToolbar` verified. Delete (Step A) preserved. Auto-align, trim, move left untouched. Old utils preserved.
- **Changes Applied**:
  1. `frontend/src/utils/timelineOps.js`:
     - Declared `roundedSplit` before `isVirtualOrEmpty` duration checks to prevent Temporal Dead Zone ReferenceError.
     - Enhanced `splitClip` to accept `clipDefaults` (e.g. `name`, `videoUrl`, `videoId`) for fresh episode virtual clip materialization.
     - Updated `splitSegment` to return `newSegmentId: uid2`.
     - Removed unused `formatTimecode` import and unused `slotEnd` declaration.
  2. `frontend/src/hooks/useClipOperations.js`:
     - Imported `splitClip as splitClipOp, splitSegment as splitSegmentOp` from `../utils/timelineOps`.
     - Rewired `handleSplitClip`:
       - Dispatches to `splitSegmentOp` only when a segment is explicitly selected and playhead is inside it. Selects `newSegmentId` upon split, pushes single undo snapshot, updates scriptData, and re-syncs timeline audio if generated.
       - Dispatches to `splitClipOp` under playhead (dialogue, Gap, or fresh episode virtual clip) without requiring selection. Selects first resulting part (`activeClipId: firstPart.id`), pushes single undo snapshot, and updates `videoClips` + `videoClipsUpdatedAt`.
       - If neither op applies, shows in-app toast with `clipOpResult.reason` (no silent failure).
  3. `backend/tests/timeline_step_b_real_app_acceptance.test.js`:
     - Created real-app acceptance test verifying operations against stored `series.json` on disk:
       - Check 1: Split unselected dialogue clip at playhead -> 2 clips, segments identical in file; Ctrl+Z restores exact prior state.
       - Check 2: Split Gap -> 2 Gaps, segments identical in file; Ctrl+Z restores exact prior state.
       - Check 3: Split on fresh episode with no script -> 2 materialized clips in file; Ctrl+Z restores exact prior state.
       - Check 4: Split selected segment (text halves split) -> videoClips identical in file; Ctrl+Z restores exact prior state.
- **Verification**:
  - `npm --prefix frontend run build`: **2036 modules transformed**, built in 620ms (0 errors).
  - Pure Ops R1-R4: `backend/tests/timeline_pure_ops_r1_r4.test.js` (**17/17 passed**).
  - Toolbar Split Under Playhead: `backend/tests/timeline_toolbar_split_under_playhead.test.js` (**6/6 passed**).
  - Step A Real-App Acceptance: `backend/tests/timeline_step_a_real_app_acceptance.test.js` (**3/3 passed**).
  - Step B Real-App Acceptance: `backend/tests/timeline_step_b_real_app_acceptance.test.js` (**4/4 passed**).
  - Frontend lint (`oxlint`): **0 errors**.
  - Total timeline clean core tests: **30/30 passed**. Pre-existing failure: 1 in `backend/tests/timeline_ui_workflow_fix.test.js` (tooltip regex expectation).
- **Git State**: Committed (`4bcb1d4`) and pushed to `origin/refactor/timeline-core-clean`.

## Active Environment
- Branch: `refactor/timeline-core-clean` (pushed to origin)
- Backend API: `http://localhost:5000`
- Frontend: `http://localhost:5173`

## Next Steps
- Phase 2 Step C: Rewire AUTO-ALIGN and RESET TIMING to `timelineOps.autoAlign` and `timelineOps.resetTiming`.
- Phase 2 Step D: Rewire TRIM and MOVE to `timelineOps.trimClip` and `timelineOps.moveClip`.
- Phase 3: Playback mapping monotonic fix in `useVideoPlayback.js`.
- Phase 4: Duration display verification (R7).

## Last Session
- **Environment**: Antigravity IDE
- **Branch**: `refactor/timeline-core-clean`
- **Timestamp**: 2026-11-17T14:07:00+07:00

## Summary: Phase 2 Step A — Rewire DELETE to Pure TimelineOps
- **Scope**: Re-wired DELETE operations only in `useClipOperations`, `TimelineEditor`, and `MediaLibrary`. Split, align, trim, move left untouched. Old utils preserved.
- **Changes Applied**:
  1. `frontend/src/utils/timelineOps.js`: Exported `isGapClip` helper.
  2. `frontend/src/hooks/useClipOperations.js`:
     - Rewired `handleDeleteClip`: Determines if target clip is a Gap via `isGapClip(targetClip)` and calls `deleteGapOp` or `deleteVideoClipOp`.
     - Rewired `handleDeleteSegment`: Calls `deleteSegmentOp`.
     - If `!opResult.applied`, displays `opResult.reason` via `showInAppToast` and halts without modifying state or pushing undo.
     - Preserved exact persistence (`saveTimelineOperationToLocalStorage`, `persistTimelineOperationApi`), single snapshot `pushUndoSnapshot`, audio sync (`syncTimelineAudioApi`), and selection cleanup.
  3. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - Rewired `handleDeleteSelected`: If deleting video, calls `onDeleteClip(activeClipId)` or falls back to `deleteGapOp` / `deleteVideoClipOp`. If deleting subtitle, calls `onDeleteSegment(selectedSegKey)` or falls back to `deleteSegmentOp`.
  4. `frontend/src/components/media/MediaLibrary.jsx`:
     - Rewired `handleDeleteSegment` fallback to call `deleteSegmentOp`.
  5. `backend/tests/timeline_ripple_delete_auto_left.test.js`:
     - Updated static audit assertions in Test 13 to check for `deleteSegmentOp` / `deleteVideoClipOp` / `deleteGapOp`.
- **Verification**:
  - `npm --prefix frontend run build`: **2036 modules transformed**, 0 errors.
  - Unit tests:
    - Pure Ops R1-R4: `backend/tests/timeline_pure_ops_r1_r4.test.js` (**17/17 passed**).
    - Step A Real-App Acceptance: `backend/tests/timeline_step_a_real_app_acceptance.test.js` (**3/3 passed**).
      - Check 1: Delete a voice -> count -1, video clips identical in disk `series.json`; Ctrl+Z restores exact prior state.
      - Check 2: Delete a middle video clip -> segments identical in disk `series.json`, range becomes one joined Gap; Ctrl+Z restores exact prior state.
      - Check 3: Delete an opening Gap -> film starts 00:00, segments identical in disk `series.json`; Ctrl+Z restores exact prior state.
    - Full timeline suite: **75/75 passed** across 14 suites (1 pre-existing failure in `timeline_ui_workflow_fix.test.js` for tooltip regex expectation).
- **Git State**: Committed (`5855a97`) and pushed to `origin/refactor/timeline-core-clean`.

## Active Environment
- Branch: `refactor/timeline-core-clean` (pushed to origin)
- Backend API: `http://localhost:5000`
- Frontend: `http://localhost:5173`

## Next Steps
- **Phase 2 Step B**: Rewire SPLIT (`handleSplitClip`, `executeSplitSegment`) to `timelineOps.splitClip` and `timelineOps.splitSegment`.
- Phase 2 Step C: Rewire AUTO-ALIGN and RESET TIMING to `timelineOps.autoAlign` and `timelineOps.resetTiming`.
- Phase 2 Step D: Rewire TRIM and MOVE to `timelineOps.trimClip` and `timelineOps.moveClip`.
- Phase 3: Playback mapping monotonic fix in `useVideoPlayback.js`.
- Phase 4: Duration display verification (R7).

## Summary: Unconditional Video Split Under Playhead & Fresh Episode Virtual Materialization
- **Problem Solved**: Toolbar scissors failed with "គ្មាន clip នៅត្រង់ playhead ទេ" on fresh episodes when video clips were unselected, and unselected segments previously hijacked playhead splits.
- **Unconditional Split Resolution**:
  - In `useClipOperations.handleSplitClip`: If a segment is explicitly selected AND the playhead is inside it, split that segment (unchanged). OTHERWISE split the video clip under the playhead (`splitClipAtTime`), with no requirement that it be clicked or active first.
  - After video split, `firstPart.id` is selected as `activeClipId` and `selectedClipKind` is set to `'video'`.
- **Fresh Episode Virtual Clip Materialization**:
  - When `videoClips` is empty or virtual, `handleSplitClip` resolves `totalDur` across `duration`, `videoRef`, `selectedVideo`, and `videoMetadata`.
  - Splits the virtual clip into two real clips `[0, roundedSplit]` and `[roundedSplit, totalDur]` with continuous source ranges.
  - Materializes clips into state via `setVideoClips` and `setVideoClipsUpdatedAt`, ensuring persistence across save and reload.
- **Toolbar Split Button Enabling**:
  - `TimelineToolbar` split button is enabled whenever playhead is strictly inside any video clip, virtual full-length video, or an explicitly selected segment (`canSplit`). It is never disabled solely because nothing is selected.
  - Existing toast is retained only when playhead is truly inside nothing (e.g. beyond video end).
- **Verification**:
  - Unit tests: `backend/tests/timeline_toolbar_split_under_playhead.test.js` (**5/5 passed**).
  - Full suite: **53/53 passed** across 10 timeline and split test suites.
  - Frontend build: **2035 modules transformed** in 1.13s (0 errors).
  - Frontend lint: **0 errors** (466 existing warnings).
  - Real-app simulation: Fresh episode with zero segments and no clip clicked, playhead at 00:07 splits into two clips `[0, 7]` and `[7, 286.5]` with continuous source ranges, first part selected, and both clips preserved across save/reload.

## Active Environment
- Branch: `fix/delete-no-ripple`; Backend API `http://localhost:5000`; Frontend `http://localhost:5173`.

## Next Steps
- Pushed `fix/delete-no-ripple` (commit `af40dee`) to origin.
- Ready for owner testing.


## Last Session
- **Environment**: Antigravity IDE
- **Branch**: `fix/delete-no-ripple`
- **Timestamp**: 2026-11-17T12:46:00+07:00

## Summary: Move-Only Auto-Align (Segment Deletion Bug Fix)
- **Problem**: Auto-Align silently deleted voice segments that users manually added in gaps when their Khmer or Chinese text matched an adjacent line within 2.5s, discarding the added segment's audio.
- **Removed Anti-Duplication Pass**: Removed step 2 from `autoAlignVoiceSegments` in `frontend/src/utils/timelineUtils.js` entirely. Auto-Align strictly obeys the move-only principle (segment count in == segment count out, always).
- **Added Hard Guard**: Added hard check in `handleAutoAlignNoOverlap` (`frontend/src/hooks/useClipOperations.js`): if `alignedSegments.length !== currentSegments.length`, aborts the write-back, keeps original segments, logs `console.warn`, and surfaces a visible in-app toast.
- **Tests & Verification**:
  - `backend/tests/auto_align_voice.test.js`: **9/9 passed** (including identical Khmer text 1.0s apart with audio preserved, identical Chinese text, and handler guard aborting on mismatch).
  - Extended timeline test suite: **42/42 passed** (0 failures).
  - Frontend build: **2035 modules transformed** in 939ms (0 errors).
  - Frontend lint: **0 errors** (466 existing warnings).
  - Real-app verification on owner's episode (`Pseudo_Spiritual_Root` Ep 2): Added voice segment in gap with identical Khmer text; Auto-Align preserved 253/253 segments with audio intact.

## Active Environment
- Branch: `fix/delete-no-ripple`; Backend API `http://localhost:5000`; Frontend `http://localhost:5173`.

## Next Steps
- Pushed `fix/delete-no-ripple` (commit `af40dee`) to origin.
- Ready for owner testing.


## Last Session
- **Environment**: Codex CLI + local Edge acceptance run
- **Branch**: `fix/delete-no-ripple` based on `fix/timeline-clip-selection`
- **Timestamp**: 2026-11-17T10:48:57+07:00

## Summary: Durable CapCut-Style Timeline Editing
- Implemented track-independent remove-only deletion, stable selection-kind dispatch, first-class Gap merge/split/delete behavior, exact undo/redo persistence, and backend/local tombstones so stale autosaves, hydration, or Auto-Align cannot resurrect deleted dialogue.
- Audited production delete callers: `useClipOperations.handleDeleteSegment`, the direct `TimelineEditor` fallback, and `MediaLibrary` fallback pass `{ ripple: false, preserveIds: true }`; `useClipOperations.handleDeleteClip` passes remove-only, Gap, and duration options. Gap deletion is the deliberate video-only ripple case.
- Focused tests: **27/27 passed**. Frontend build passed (2035 modules; existing large-chunk warning). Frontend lint exited successfully with existing warnings. Real disposable-series UI checks passed for two voice deletes, Auto-Align, episode switching/reload, middle clip Gap, split/delete opening Gap, and Ctrl+Z/redo; stored tracks matched expected values.
- Disposable series and acceptance scripts were removed. Main was not changed.

## Active Environment
- Branch: `fix/delete-no-ripple`; Backend API `http://localhost:5000`; Frontend `http://localhost:5173`.
- Shared local acceptance servers remain listening on ports 5000 and 5173.

## Next Steps
- No pending implementation work. `fix/delete-no-ripple` was pushed to origin at commit `64b1840`; main remains untouched.

## Last Session
- **Environment**: Copilot SDK in VS Code
- **Branch**: `fix/delete-no-ripple` based on `fix/timeline-clip-selection` (`1d5e464`)
- **Timestamp**: 2026-11-17T09:20:00+07:00

## Summary: Track-Independent Deletes and First-Class Gaps
- Video delete now changes only `videoClips`, leaving dialogue segments/subtitles/audio timings intact; segment delete changes only segments (including that segment's subtitle row), leaving video clips intact. The audio master re-sync after segment delete remains in place.
- Timeline toolbar fallback and Delete/Backspace shortcuts stop dispatching when the selected track has no valid item, rather than falling through to the other track.
- Dialogue video delete remains remove-only and creates/fills/merges Gap clips. Gap delete is the explicit exception: it shifts only later video clips left by the Gap duration, preserving source ranges and all dialogue segment data.
- Splitting while targeting the video track now prioritizes the video clip under the playhead, including Gaps; a split Gap remains two Gap clips. Segment split retains priority when video is not explicitly selected and a segment contains the playhead.
- `deleteClipById`/`deleteSegmentByIdOrIndex` legacy defaults remain unchanged for callers that omit remove-only options.
- Production `deleteSegmentByIdOrIndex` callers: `useClipOperations.handleDeleteSegment`, the direct `TimelineEditor.handleDeleteSelected` fallback, and `MediaLibrary` standalone fallback; all pass `{ ripple: false, preserveIds: true }`. `MediaLibrary` delegates to the central handler when provided. Production `deleteClipById` caller: only `useClipOperations.handleDeleteClip`, passing remove-only, Gap, and duration options. Legacy/test callers omitting options retain ripple/re-index behavior.
- Verification: focused timeline/selection/split and Gap behavior tests **22/22**; frontend build passed (**2035 modules**, existing large-chunk warning). Frontend lint exited successfully with existing warnings. Related timeline/Auto-Align/search suite had an unrelated pre-existing tooltip expectation failure in `timeline_ui_workflow_fix.test.js`.
- Full backend test run was stopped after long-running integration tests showed network `EACCES` and service-dependent failures; it did not produce a complete suite result.
- Real-app save/read-back and Ctrl+Z remain unverified; no destructive test was run on the user's stored episodes.

## Active Environment
- Branch: `fix/delete-no-ripple`, based on `fix/timeline-clip-selection`; main untouched.
- Frontend build and local shell tests are available. The shared browser currently reports a domain-policy block; do not perform live deletes without a disposable episode/copy and explicit save/restore test target.
- Pre-existing `.agents/` deletions, replacement agent files, and the prior Code Reviewer state note remain unrelated and must not be staged.

## Next Steps
- Run save/read-back and Ctrl+Z acceptance checks only against a disposable episode/copy; visually verify Gap split/delete behavior and that the voice track is unchanged.
- Push `fix/delete-no-ripple`; do not merge to main.

## Last Session
- **Environment**: Antigravity IDE (`fix/timeline-clip-selection`)
- **Branch**: `fix/timeline-clip-selection` (tracking `origin/fix/timeline-clip-selection`)
- **Timestamp**: 2026-11-16T22:27:00+07:00

## Summary: CapCut-Style Per-Clip Timeline Selection & Focused Inspector
1. **Problem Solved**:
   - Previously, clicking either a video cut or a voice segment bidirectionally selected both clips (`isSelected = activeClipId === clip.id || isAssociatedWithSeg`), lighting up both clips with solid cyan borders and trim handles.
   - Under CapCut behavior, clicking a VIDEO clip selects only that video clip, clicking a VOICE clip selects only that voice clip, and clicking a SUBTITLE clip selects only that subtitle clip. The paired counterpart clip shows a faint dashed outline (`.is-linked-clip`), maintaining visual pairing without stealing primary selection.
   - Inspector focus dynamically adjusts: clicking a VIDEO clip focuses the video/cut context (timing, Mute Original Audio, Split at Playhead, Delete Clip); clicking a VOICE clip focuses the dialogue voice section (Chinese text, Khmer translation, Khmer neural voice, audio playback/regen).

2. **Where Selection Kind State Lives & How It Flows**:
   - **Root State (`frontend/src/hooks/useWorkspaceMedia.js`)**:
     - Added `const [selectedClipKind, setSelectedClipKind] = useState(null)` (`'video' | 'voice' | 'subtitle' | null`).
     - Exported and threaded through `App.jsx` to `TimelineEditor`, `TimelineTracksCanvas`, `VoiceSettings`, `ClipInspectorPanel`, and `useShortcuts`.
   - **Click Handlers**:
     - `TimelineTracksCanvas.jsx`: Clicking a video cut sets `onSelectClipKind('video')`; clicking a voice block sets `onSelectClipKind('voice')`; clicking a subtitle block sets `onSelectClipKind('subtitle')`.
     - `TimelineEditor.jsx`: `handleAudioMouseDown` sets `'voice'`, `handleVideoMouseDown` sets `'video'`, `handleSubMouseDown` sets `'subtitle'`.
     - Empty timeline background click in `handleBackgroundMouseDown` clears selection (`onSelectClipKind(null)`, `onSelectClip(null)`, `onSelectSegment(null)`).

3. **Highlight Rules & Faint-Link Outline Choice**:
   - **Primary Selection**: Only clips of the clicked kind matching the active ID get `isSelected = true` (solid 2px `#38BDF8` border + visible trim handles).
   - **Faint Linked Counterpart (`.is-linked-clip`)**:
     - Choice made: subtle dashed border `1px dashed rgba(56, 189, 248, 0.45)` with `outline-offset: -1px` and no trim handles.
     - When VIDEO clip is selected, matching VOICE clip receives `.is-linked-clip`.
     - When VOICE clip is selected, matching VIDEO clip receives `.is-linked-clip`.
     - Completely decoupled `isAssociatedWithSeg` from producing full `selected` style on its own.

4. **Inspector Focus Behavior**:
   - In `ClipInspectorPanel.jsx`: When `selectedClipKind === 'video'` and `targetVideoClip` exists, it focuses the video cut inspector section (Film badge, duration, timing, Mute Original Video Audio, Split at Playhead, Delete Clip).
   - When `selectedClipKind === 'voice'`, it renders dialogue & voice controls as usual.
   - **Playback Auto-Follow**: In `TimelineEditor.jsx`, when the playhead crosses into a new segment during playback, it updates the segment context and syncs the active video clip if `selectedClipKind === 'video'`, without fighting or yanking manual selection mid-play.

5. **Operation Safety & Preserved Semantics**:
   - Delete & Split operations check `selectedClipKind`:
     - Delete on VIDEO clip (`selectedClipKind === 'video'`) calls `onDeleteClip(activeClipId)`.
     - Delete on VOICE clip (`selectedClipKind === 'voice'`) calls `onDeleteSegment(selectedSegmentId)`.
     - Linked video-voice ripple deletion semantics (`d800e42`) and Auto-Align single-lane packing (`fix/voice-single-lane`) remain 100% intact.

6. **Verification Results**:
   - **Unit Tests**:
     - `backend/tests/timeline_clip_selection_kind.test.js`: 5/5 passed.
     - `backend/tests/timeline_*.test.js` + `auto_align_voice.test.js` + `playback_60fps_optimization.test.js`: 40/40 passed (0 failures).
   - **Frontend Build**: `npm run build --prefix frontend` built cleanly in 735ms (0 errors).
   - **Real-App Episode Verification (`Pseudo_Spiritual_Root` Episode 2 & Episode 3)**:
     - (a) Clicking VIDEO clip #7: only VIDEO clip #7 shows solid cyan border and trim handles; VOICE clip #7 shows faint dashed `.is-linked-clip` outline.
     - (b) Clicking VOICE clip #7: only VOICE clip #7 shows solid cyan border and trim handles; VIDEO clip #7 shows faint dashed `.is-linked-clip` outline.
     - (c) Split & Delete from each selection kind delete the targeted item while keeping video-voice ripple alignment in sync.
     - (d) Playback auto-follow tracks active segment without fighting manual kind selection.

7. **Git Status**:
   - Branch: `fix/timeline-clip-selection` (based on `fix/voice-single-lane`).
   - Committed (commit `7efa726`) and pushed to `origin/fix/timeline-clip-selection`.
   - Main branch untouched.

## Active Environment
- Backend API: `http://localhost:5000` (live daemon)
- Frontend UI: `http://localhost:5173` (Vite dev server)
- Branch: `fix/timeline-clip-selection`

## Next Steps
- Verify in browser at `http://localhost:5173`.
- Create PR on GitHub: https://github.com/Ny-Panha/khmer-ai-dubbing-studio/pull/new/fix/timeline-clip-selection

## Next Steps
- Review `fix/voice-single-lane` on GitHub or test further user scenarios on the frontend UI.


## Summary: Linked Video-Voice Synchronized Deletion & Auto-Align Re-Anchor Fix
1. **Root Cause of Desynchronization on Delete**:
   - When user deleted a dialogue video cut (`handleDeleteClip`), the video clip was removed from `videoClips`, but the matching voice segment in `scriptData.segments` was NOT removed, leaving orphan voice audio at `00:00` while video showed clip `#2` (mismatching all subsequent pairs).
   - When user deleted a `Gap` clip (00:00 - 00:04.5), clips were shifted, but dialogue indices in `videoClips` stayed static while voice segments re-indexed, creating label drift (e.g. `#5` video vs `#4` voice).
2. **Fix Applied**:
   - **Linked Dialogue Deletion**: In `handleDeleteClip`, deleting a dialogue clip automatically detects its matching voice segment using `findAssociatedSegmentIndices`, deletes BOTH the video clip and voice segment, and shifts remaining clips/segments left by the exact duration in lockstep.
   - **Gap Deletion**: Deleting a `Gap` clip only shifts subsequent video cuts and voice cues left by `gapDur` without deleting any voice segments, maintaining 100% pairing.
   - **Sequentially Synced Re-Indexing**: In `deleteClipById` and `deleteSegmentByIdOrIndex`, remaining dialogue clips and voice segments are re-indexed sequentially (`#1, #2, #3...`) so video labels and voice labels are always 1:1 identical.
   - **Smart Auto-Align Repair**: In `handleAutoAlignNoOverlap`, clicking **`Auto-Align`** anchors each voice segment to the start of its matching dialogue video cut, snapping any desynchronized timeline back into 100% alignment.
3. **Verification**:
   - Unit test suite: `backend/tests/timeline_ripple_delete_auto_left.test.js` (8/8 passed).
   - Frontend build (`npm run build --prefix frontend`): Passed in 848ms (0 errors).

## Summary: 60FPS Video Playback & Auto-Follow Segments Fix (/agents)
1. **Auto-Follow Active Dialogue Clip & Real-time Inspector Sync (`TimelineEditor.jsx`)**:
   - **Root Cause**: In the earlier optimization turn, guarding selection with `if (!isPlaying)` stopped the timeline from auto-highlighting the active clip (e.g. staying locked on `#122` instead of advancing to `#123`) and prevented the Inspector from displaying the active dialogue in real time.
   - **Fix Applied**: Restored seamless auto-tracking in `TimelineEditor.jsx`. As the playhead crosses into each dialogue segment, `setSelectedAudioId(segKey)`, `setSelectedSubId(segKey)`, and `onSelectSegment(segKey)` fire accurately, updating both the timeline clip border in cyan and loading the current Chinese & Khmer dialogue in the Inspector panel.
   - Guarded only when user is actively editing text in the Inspector (`isEditingText`), preserving manual typing without interrupting playback tracking.

2. **Disable CPU-Heavy Audio Buffer Decoding during Playback (`VideoPlayerPreview.jsx`)**:
   - **Root Cause**: The background silence detector was invoking `AudioContext.decodeAudioData` up to 14 times concurrently while the video was playing, stealing CPU/audio thread cycles.
   - **Fix Applied**: `probeUrlLeadingSilence` now returns early when `isPlayingRef.current` is active, deferring heavy decoding to paused/idle time.
   - **Fast Sorted Window Filtering**: In `syncSegmentAudiosAtTime`, replaced `.map().filter()` with a direct loop that breaks early when segments pass beyond the active window (`s > now + 5`), and constrained auto-ducking overlap check to adjacent dialogues instead of full-array scans.

3. **Backend Video Range Stream 3MB Chunk Cap (`backend/middleware/mediaStream.js`)**:
   - **Root Cause**: Open-ended Range requests (`Range: bytes=0-`) were piped uncapped (500MB+ into a single HTTP stream), choking Vite's dev proxy and Node.js socket buffers on seek/play.
   - **Fix Applied**: Capped open-ended video range responses to 3MB chunks (`Content-Range: bytes start-(start+3MB-1)/fileSize`), allowing HTML5 `<video>` to buffer incrementally and seek instantaneously.

4. **Timeline Canvas Viewport Hysteresis (`TimelineTracksCanvas.jsx`)**:
   - Upgraded visible range buffer to 8 seconds with 2.0s hysteresis, preventing continuous SVG canvas rebuilds while playhead scrolls.

5. **Verification**:
   - Frontend build (`npm run build --prefix frontend`): Passed in 778ms (0 errors).
   - Optimization test suite (`node --test backend/tests/playback_60fps_optimization.test.js`): 4 passed / 0 failed.
   - Regression test suites (`timeline_voice_cut_mute_gap_simple.test.js`, `audio_sync_delay_fix.test.js`, etc.): 16 passed / 0 failed.

## Summary: Gemini 503 High Demand Fast-Fail & Timeline UI ឃ្លា Polish
1. **503 High Demand Fast-Fail (`geminiKeyManager.js` & `geminiService.js`)**:
   - **Root Cause**: 503 "This model is currently experiencing high demand" is a Google server-side model overload, not an API Key quota limit. Previously, `runWithPool` treated 503 as a rate limit and rotated Key #1 -> Key #2 -> Key #3 -> Key #4 on the exact same overloaded model!
   - **Fix Applied**: Added `isModelOverloadOrUnavailable(err)`. On 503 or 504, `runWithPool` fast-fails immediately (0ms delay) without burning keys or triggering key cooldowns, allowing the caller's model cascade (`callGeminiVisionWithRetry` and `generateContentWithModelFallback`) to immediately switch models (e.g. fallback to `gemini-3.1-flash-lite`).
   - Added unit test #8 in `gemini_key_pool_and_504_retry.test.js` verifying 503 throws on the first attempt without rotating keys.

2. **Accurate Quota Modal Header & Backend Sync (`geminiQuotaTracker.js`)**:
   - Backend `isDailyExhausted` now checks `(inCooldown && keyModelCd.cooldownType === 'rpd_limit') || (rec.todayRequests >= dailyRpdPerKey)`.
   - When a key reaches or exceeds the daily limit (e.g. 521 requests >= 500 limit), it is accurately marked exhausted and deducted from `readyKeys` and `totalRPM`, eliminating header badge discrepancy (e.g. no more "6/6 keys ready" while Key #4 shows "0 Left").

3. **Timeline UI ឃ្លា & Gender Alignment (`TimelineTracksCanvas.jsx` & `TimelineEditor.jsx`)**:
   - **Voice Gender Resolution**: In `renderVoiceSegment`, enhanced female detection to check `speakerName.includes('ស្រី')`, `seg.voiceGender`, and `female` tokens. Voice clips with female speakers now correctly render `#1 ស្រី` in pink (`voice-female`), aligning 1:1 with the `#1 ស្រី` video cut directly above it.
   - **Responsive Video Clip Labels**: Video cuts on VIDEO 1 now render compact IDs (`#10`) on narrow clips (< 52px) and clean gender names (`#10 ស្រី` or `#10 ប្រុស`) on medium clips (52px - 90px), eliminating awkwardly truncated overflow text like `#10 ស្រី ចាប់...`.

4. **Verification**:
   - All backend test suites passed: 15 passed / 0 failed.
   - Frontend build (`npm run build --prefix frontend`): Passed in 1.56s.
   - Backend daemon live on `http://localhost:5000`.

## Summary: Gemini Quota Modal De-Slop (/agents-design) & False 401 Quota Ban Fix
1. **Frontend UI De-Slop & Polish (`GeminiQuotaModal.jsx`)**:
   - **Symmetrical 3x2 Grid**: Upgraded key cards layout from ragged `repeat(auto-fit, minmax(205px, 1fr))` (which previously orphaned Key #6 alone on row 2) to a balanced `repeat(auto-fit, minmax(280px, 1fr))` making exactly 3 columns x 2 rows on desktop.
   - **Prominent Reset Time Badge**: Added clear highlight badge in Today section: `⏰ Reset ម៉ោង 3:00 PM (សល់ Xh Ym)` so the user clearly sees when Google's Pacific Midnight quota window resets.
   - **Progress & Usage Polish**: Added mini progress bars inside each key card showing real-time utilization (`todayRequests / perKeyDailyLimit`), tabular numbers (`fontVariantNumeric: 'tabular-nums'`), and clean subdued borders (`border-slate-800`), eliminating excessive neon box-shadows per `/agents-design` guidelines.
   - **Accurate Key Status**: Keys hitting the daily 500 RPD cap now show `🔴 អស់ Quota ថ្ងៃនេះ (429)` instead of a false `❌ 401 Key ខុស`.

2. **Stage 3 OCR Auto-Model Cascade Optimization**:
   - **Root Cause of Long Stalls**: When a primary model (e.g. `gemini-3.5-flash-lite`) was 429 exhausted, Stage 3 still forced it to run first on EVERY batch (up to 48 batches per chunk), looping through all 6 keys twice with backoff delays, wasting ~45s per batch (total ~35 minutes).
   - **Fix Applied**:
     - `callGeminiVisionWithRetry`: Prioritizes across ALL models (including preferred) with `geminiQuotaTracker.prioritizeAvailableModels` so exhausted models are immediately demoted to the end, and healthy cascade models (e.g. `gemini-3.1-flash-lite`) run first at 0ms delay.
     - `activeWorkingModel`: Dynamically remembers the winning cascade model across batches, skipping dead models for all subsequent batches.
     - `geminiKeyManager.js`: Reduced 429 key rotation retry from 2 full passes to 1 pass and trimmed rotation delay from 600ms to 200ms.

3. **Verification**:
   - Frontend build (`npm run build --prefix frontend`): Passed in 590ms.
   - Backend test suite (`gemini_key_pool_and_504_retry.test.js` & `gemini_quota_tracker_and_routes.test.js`): 13 passed / 0 failed.
   - Fast OCR rule test (`fast_ocr_rule.test.js`): Passed.

## Active Environment
- Backend API: `http://localhost:5000` (live daemon)
- Frontend UI: `http://localhost:5173` (Vite dev server)
- Branch: `chore/remove-ppocr-local`

## Next Steps
- Pushed commits to `origin/chore/remove-ppocr-local`.
- When ready, merge `chore/remove-ppocr-local` via Pull Request.
