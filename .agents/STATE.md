# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (`fix/voice-single-lane`)
- **Branch**: `fix/voice-single-lane` (tracking `origin/fix/voice-single-lane`)
- **Timestamp**: 2026-11-16T21:55:00+07:00

## Summary: CapCut-Style Single Voice Lane (Lane 0) on Auto-Align
1. **Problem Solved**:
   - Previously, when Khmer TTS dialogue audio overran the next segment's start time, the code only clamped if `cutRatio <= 40%`; otherwise, it dropped the clip to `VOICE 2` (Lane 1). Furthermore, `TimelineTracksCanvas.jsx` and `TimelineEditor.jsx` dynamically checked `isFemale` or `gapOnRow0 < 0.15` and forced alternating clips into `VOICE 2`, causing dialogue clips to scatter back and forth across VOICE 1 / VOICE 2 (e.g. 79 clips scattered to Lane 1 in EP3).
   - Under CapCut behavior, all auto-placed voice clips live sequentially on `VOICE 1` (Lane 0) in numeric order; clips NEVER drop to `VOICE 2/3` automatically. Clip N ends exactly where Clip N+1 begins, and overruns are resolved on Lane 0 by clamping previous clip's `audioEndSec` to next segment's `baseStart`.

2. **Automatic trackRow Assignment Sites Found & Fixed**:
   - **Site 1 (`frontend/src/utils/timelineUtils.js` - `autoAlignVoiceSegments`)**:
     - Removed all drops to VOICE 2 (both `cutRatio > 40%` and subtitle overlap). Non-userShifted segments are ALWAYS assigned `targetRow = 0`.
     - When previous Lane 0 clip overruns `baseStart`, clamps `prevLane0.audioEndSec = baseStart` (with `audioTrimmed = true`).
     - When clamp cuts > 40% of audio, marks segment with `audioOverrun: true` and `overrunRatio`.
     - Preserved `userShifted` segments (`trackRow`, `trackId`, `id`, `segmentId`, and start/end coordinates untouched).
   - **Site 2 (`frontend/src/utils/timelineUtils.js` - `resetSegmentsToSourceTiming`)**:
     - Removed automatic collision drop to row 1. Non-userShifted segments always stay on `trackRow = 0`.
   - **Site 3 (`frontend/src/components/timeline/TimelineEditor.jsx` - `segmentRows`)**:
     - Removed `resolveIsFemale` and `gapOnRow0 < 0.15` automatic lane routing. All non-userShifted segments return `0`.
   - **Site 4 (`frontend/src/components/timeline/TimelineTracksCanvas.jsx` - `internalSegmentRows` & `renderVoiceSegment`)**:
     - Removed `isFemale` and `gapOnRow0 < 0.15` routing.
     - Added `.has-audio-overrun` warning border/glow and `⚠️` badge on clips with `seg.audioOverrun === true`.
   - **Site 5 (`frontend/src/components/timeline/TimelineEditor.css`)**:
     - Added red warning styles for `.voice-segment-block.has-audio-overrun` (`border-color: rgba(239, 68, 68, 0.85)` and `#f87171` text).
   - **Site 6 (`backend/routes/audioRoutes.js` - `/sync-audio`)**:
     - Automatically persists aligned segments (`trackRow: 0`, `audioEndSec`, `audioTrimmed`, `audioOverrun`) into `series.json` under `withSeriesMetadataLock`.

3. **Verification Results**:
   - **Unit Tests**:
     - `backend/tests/auto_align_voice.test.js`: 6 passed / 0 failed (including requirements a, b, c).
     - `backend/tests/timeline_unlimited_voice_lanes.test.js`: 5 passed / 0 failed.
     - `backend/tests/timeline_ui_workflow_fix.test.js`: 4 passed / 0 failed.
   - **Frontend Build**: `npm run build --prefix frontend` built in 620ms (0 errors).
   - **Real-App Episode Verification (`Pseudo_Spiritual_Root` Episode 3)**:
     - Total segments: 266.
     - Stored `trackRow` distribution in `series.json`: `{ '0': 266 }` (100% of non-userShifted segments sit on Lane 0).
     - `#8 -> #9` seam check at ~00:12: `#8` ends at `12.67s` (`audioTrimmed: true`, `audioOverrun: true`), `#9` starts at `12.67s`. Perfect seam, 0 gap, 0 double-voice.
     - Total Lane 0 overlaps across all 266 segments: `0`.

4. **Git Status**:
   - Committed on `fix/voice-single-lane` (commit `618bce6`).
   - Pushed to `origin/fix/voice-single-lane`. Not merged to `main`.

## Active Environment
- Backend API: `http://localhost:5000` (live daemon)
- Frontend UI: `http://localhost:5173` (Vite dev server)
- Branch: `fix/voice-single-lane`

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
