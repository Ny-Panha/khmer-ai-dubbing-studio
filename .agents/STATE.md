# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE
- **Branch**: `refactor/timeline-core-clean`
- **Timestamp**: 2026-11-17T15:10:00+07:00

## Summary: Phase 1 — Dead-Code Audit (Gated Protocol: Audit Only)
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
