# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE
- **Branch**: `fix/delete-no-ripple`
- **Timestamp**: 2026-11-17T13:08:00+07:00

## Summary: Fix ReferenceErrors in DubbingModeTab & TimelineEditor
- **Problems Fixed**:
  1. `DubbingModeTab.jsx`: `ReferenceError: activeSeries is not defined` during 1-Click Auto Compact "📝 ខ្លីចំអត្ថន័យ" batch execution. `activeSeries` was referenced without being in scope or props.
  2. `TimelineEditor.jsx`: `ReferenceError: isSegmentMatch is not defined` in `canSplit` memo. Neither `isSegmentMatch` nor `parseTimeToSeconds` were imported.
- **Changes Applied**:
  - `TimelineEditor.jsx`: Imported `isSegmentMatch` from `../../utils/timelineUtils` and `parseTimeToSeconds` from `../../utils/timestampUtils`.
  - `DubbingModeTab.jsx`: Added `activeSeries = null` and `apiKey = null` to props; resolved series ID safely via `const resolvedSeriesId = seriesId || activeSeries?.id || activeEpisode?.seriesId || episodeId;` and forwarded `apiKey`.
  - `MediaLibrary.jsx`: Passed `activeSeries={activeSeries}` and `apiKey={apiKey}` to `<DubbingModeTab />`.
  - `backend/tests/timeline_toolbar_split_under_playhead.test.js`: Added Test (e) verifying reference/import contracts.
- **Verification**:
  - `npm --prefix frontend run build`: **2035 modules transformed**, 0 errors.
  - `node --test backend/tests/timeline_toolbar_split_under_playhead.test.js`: **6/6 passed**.

## Active Environment
- Branch: `fix/delete-no-ripple`; Backend API `http://localhost:5000`; Frontend `http://localhost:5173`.

## Next Steps
- Pushed commit `acaaa37` to `origin/fix/delete-no-ripple`.
- Ready for testing.

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
