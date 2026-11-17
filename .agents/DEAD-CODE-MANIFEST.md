# Dead-Code Audit Manifest

> **Branch:** `refactor/timeline-core-clean`  
> **Date:** 2026-11-17  
> **Status:** ⚠️ Phase 1 Proposed (Awaiting Project Owner Approval)  
> **Protocol:** Two-Phase Gated Dead-Code Audit & Removal

---

## 1. Executive Summary

This manifest documents the exhaustive dead-code audit across `frontend/src/` (115 files) and `backend/` (`routes/`, `services/`, `utils/`, 53 files) on branch `refactor/timeline-core-clean`.

### Audit Methodology & Verification Standards
- **Zero-False-Positive Filter**: Every candidate file and exported symbol was checked using repo-wide word and path searches (`git grep -n -w`) across all JavaScript/JSX source code and automated test files.
- **Internal Helper Verification**: Functions exported but referenced within their own defining module are categorized as **ACTIVE INTERNAL HELPERS** and **KEPT** to avoid breaking living code.
- **Entry Points Protected**: Application entry points (`main.jsx`, `App.jsx`, `index.css`, `server.js`) and barrel re-exports (`index.js`) were strictly protected.
- **Zero Deletions in Phase 1**: In accordance with the protocol gate, **zero code or files have been deleted**. Deletions will only take place in Phase 2 after the project owner reviews and explicitly approves this manifest.

---

## 2. Suspects Audited & Kept (Proof of Life)

The prompt highlighted several potential suspects. Each was rigorously audited; all except `App.css` are **alive, actively mounted, or relied upon by runtime workflows and tests**.

| Suspect File / Directory | Status | Active Usage / Importer Proof | Reason to Keep |
| :--- | :---: | :--- | :--- |
| `frontend/src/hooks/usePlaybackEngine.js` | **ALIVE** | Imported in `App.jsx:119`, instantiated at L313 (`usePlaybackEngine(...)`), verified in `backend/tests/fullstack_refactor_verification.test.js:38`. | Core playback engine orchestrator linking video, audio, and timeline state. |
| `frontend/src/hooks/useStudioActions.js` | **ALIVE** | Imported in `App.jsx:127`, instantiated at L778, passed to `<StudioProvider value={studioActions}>` at L793. | Core action dispatcher for segment updates, voice switching, and repairs. |
| `frontend/src/utils/formatTime.js` | **ALIVE** | Delegation barrel re-exporting timestamp utilities. Imported in `TimelineTracksCanvas.jsx`, `PlayerControls.jsx`, `LiveSubtitleOverlay.jsx`, `EpisodesTab.jsx`, `MediaUploadTab.jsx`, `ScriptReviewTab.jsx`, `GeminiRouteModal.jsx`. | Core UI time-formatting helper. |
| `frontend/src/utils/cleanKhmer.js` | **ALIVE** | `cleanKhmerText` imported and invoked in `ScriptReviewTab.jsx:11`, `ClipInspectorPanel.jsx:9`, and `useAudioDubbing.js:6`. | Cleans and normalizes Khmer text before rendering or TTS synthesis. |
| `frontend/src/features/dubbing-runner/` | **ALIVE** | `DubbingRunnerProvider` mounted in `App.jsx:153`. `DubbingStepCardsBar` used in `GeminiRouteModal.jsx`. `DubbingStepButton` used in `DubbingModeTab.jsx`, `EpisodesTab.jsx`, `VoiceSettings.jsx`, `Navbar.jsx`. Covered by `dubbing_runner_modal.test.js`. | Active multi-step dubbing runner modal UI. |
| `frontend/src/features/gemini-route/` | **ALIVE** | `useEpisodeSelection.js` imported via `features/gemini-route/hooks/index.js` into `GeminiRouteModal.jsx`. `geminiRouteSelectors.js` provides active episode selectors used in `GeminiRouteModal.jsx`. | Active episode selection and batch orchestration feature. |
| `frontend/src/context/` (`JobQueueContext`, `ModalContext`, `WorkspaceContext`) | **ALIVE** | Mounted in `App.jsx` and `Navbar.jsx`. Verified in `job_queue_and_shutdown.test.js` and `fullstack_refactor_verification.test.js`. | Global state and UI modal management. |
| `frontend/src/context/StudioContext.jsx` (`StudioProvider`) | **ALIVE** | `StudioProvider` mounted in `App.jsx:793` wrapping the studio workspace. | Context provider for studio actions. (Only the unused hook `useStudioContext` is dead). |

---

## 3. Dead Files (Proposed for Deletion in Phase 2)

Only **1 dead file** was found across the entire repository with zero imports or references anywhere.

| File Path | Size | Lines | Grep Proof | Test Disposition |
| :--- | :---: | :---: | :--- | :--- |
| `frontend/src/App.css` | 63 B | 2 | `git grep -n "App.css"` returns 0 hits repo-wide. Contains only `/* Main App level overrides (modularized into components/) */`. | No tests reference this file. |

**Reclaim:** 1 file, 63 bytes, 2 lines.

---

## 4. Dead Exported Functions & Constants (Proposed for Deletion in Phase 2)

A total of **25 dead exported functions/constants** across 13 files have zero external callers and zero internal callers.

### A. Frontend Dead Exports

| # | File Path | Export Name | Lines | Size | Grep Proof & Context |
| :-: | :--- | :--- | :---: | :---: | :--- |
| 1 | `frontend/src/context/StudioContext.jsx` | `useStudioContext` | 19–21 | 3 | `git grep -n -w "useStudioContext"` returns 1 hit (its own definition). Never consumed by child components. |
| 2 | `frontend/src/features/gemini-route/utils/geminiRouteSelectors.js` | `selectPartitionedSelectedEpisodes` | 34–60 | 27 | `git grep -n -w "selectPartitionedSelectedEpisodes"` returns 1 hit (its own definition). |
| 3 | `frontend/src/features/gemini-route/utils/geminiRouteSelectors.js` | `selectStageCompletionFlags` | 182–192 | 11 | `git grep -n -w "selectStageCompletionFlags"` returns 1 hit (its own definition). |
| 4 | `frontend/src/utils/projectStorage.js` | `saveActiveProject` | 1323–1329 | 7 | `git grep -n -w "saveActiveProject"` returns 1 hit (its own definition). Obsolete compatibility wrapper. |
| 5 | `frontend/src/utils/projectStorage.js` | `loadActiveProject` | 1334–1345 | 12 | `git grep -n -w "loadActiveProject"` returns 1 hit (its own definition). Obsolete compatibility wrapper. |
| 6 | `frontend/src/utils/timelineUtils.js` | `resetSegmentsToSourceTiming` | 833–917 | 85 | `git grep -n -w "resetSegmentsToSourceTiming"` returns 0 code callers. Replaced by pure op `timelineOps.resetTiming` in Phase 2 Step C. |

**Frontend Dead Exports Subtotal:** 6 exports, 145 lines.

---

### B. Backend Dead Exports

| # | File Path | Export Name | Lines | Size | Grep Proof & Context |
| :-: | :--- | :--- | :---: | :---: | :--- |
| 7 | `backend/services/audioClassifierService.js` | `classifySegmentsFromMedia` | 231–253 | 23 | `git grep -n -w "classifySegmentsFromMedia"` returns 2 hits (def + export). 0 callers repo-wide. |
| 8 | `backend/services/audioSeparationService.js` | `cancelSeparationJob` | 519–521 | 3 | `git grep -n -w "cancelSeparationJob"` returns 2 hits (def + export). Unused alias for `killSeparationJob`. |
| 9 | `backend/services/ffmpegService.js` | `createGeminiProxyVideo` | 170–280 | 111 | `git grep -n -w "createGeminiProxyVideo"` returns 2 hits (def + export). Unused proxy transcoder prototype. |
| 10 | `backend/services/ffmpegService.js` | `cleanupProxyFile` | 281–288 | 8 | `git grep -n -w "cleanupProxyFile"` returns 2 hits (def + export). Companion cleanup for unused proxy. |
| 11 | `backend/services/ffmpegService.js` | `getActiveJobRenderProcess` | 1391–1393 | 3 | `git grep -n -w "getActiveJobRenderProcess"` returns 2 hits (def + export). 0 callers repo-wide. |
| 12 | `backend/services/ffmpegService.js` | `renderDubbedVideo` | 2826–2834 | 9 | `git grep -n -w "renderDubbedVideo"` returns 2 hits (def + export). Deprecated wrapper; production uses `renderDubbedVideoWithDucking`. |
| 13 | `backend/services/ffmpegService.js` | `measureAudioLoudnessDiagnostics` | 2907–2930 | 24 | `git grep -n -w "measureAudioLoudnessDiagnostics"` returns 2 hits (def + export). 0 callers repo-wide. |
| 14 | `backend/services/geminiModelCatalog.js` | `buildOrderedCascadeModels` | 301–323 | 23 | `git grep -n -w "buildOrderedCascadeModels"` returns 2 hits (def + export). 0 callers repo-wide. |
| 15 | `backend/services/geminiQuotaTracker.js` | `DEFAULT_QUOTA_SETTINGS` | 1065 | 1 | Export alias `DEFAULT_QUOTA_SETTINGS: DEFAULT_SETTINGS`. 0 callers repo-wide. |
| 16 | `backend/services/geminiService.js` | `sanitizeSubtitleDuration` | 22–38 | 17 | `git grep -n -w "sanitizeSubtitleDuration"` returns 2 hits (def + export). 0 callers repo-wide. |
| 17 | `backend/services/geminiService.js` | `getPromptForMode` | 456–476 | 21 | `git grep -n -w "getPromptForMode"` returns 2 hits (def + export). Obsolete prompt helper. |
| 18 | `backend/services/geminiService.js` | `validateAndSanitizeSegment` | 620–739 | 120 | `git grep -n -w "validateAndSanitizeSegment"` returns 2 hits (def + export). Obsolete monolithic sanitizer. |
| 19 | `backend/services/geminiService.js` | `auditTimelineCoverage` | 741–807 | 67 | `git grep -n -w "auditTimelineCoverage"` returns 2 hits (def + export). Obsolete coverage auditor. |
| 20 | `backend/services/geminiService.js` | `generateDubbingScript` | 1117–1233 | 117 | `git grep -n -w "generateDubbingScript"` returns 2 hits (def + export). Replaced by pipeline stage orchestrators. |
| 21 | `backend/services/geminiService.js` | `generateScriptFromMedia` | 1235–1250 | 16 | `git grep -n -w "generateScriptFromMedia"` returns 2 hits (def + export). Replaced by pipeline stages. |
| 22 | `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js` | `generateBaseSamplingGrid` | 96–115 | 20 | `git grep -n -w "generateBaseSamplingGrid"` returns 2 hits (def + export). 0 callers repo-wide. |
| 23 | `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js` | `groupTranscriptionWordsIntoSegments` | 219–245 | 27 | `git grep -n -w "groupTranscriptionWordsIntoSegments"` returns 2 hits (def + export). 0 callers repo-wide. |
| 24 | `backend/services/pipeline/stages/stage6_generateModeSpecificScript.js` | `DRAMA_GENRES` | 11–18 | 8 | `git grep -n -w "DRAMA_GENRES"` returns 2 hits (def + export). 0 callers repo-wide. |
| 25 | `backend/services/pipeline/stages/stage6_generateModeSpecificScript.js` | `CULTIVATION_DRAMA_GLOSSARY` | 62 | 1 | Empty constant string `''`. 0 callers repo-wide. |
| 26 | `backend/services/ttsService.js` | `generateKhmerSpeech` | 1264–1285 | 22 | `git grep -n -w "generateKhmerSpeech"` returns 2 hits (def + export). Legacy alias; production uses `generateSingleSegmentAudio`. |
| 27 | `backend/services/ttsService.js` | `generateBatchSpeech` | 1291–1293 | 3 | `git grep -n -w "generateBatchSpeech"` returns 2 hits (def + export). Legacy alias; production uses `generateBatchSegmentsAudio`. |

**Backend Dead Exports Subtotal:** 21 exports, 649 lines.

---

## 5. Total Reclaim Impact

- **Dead Files:** 1 file (`frontend/src/App.css`, 63 bytes, 2 lines)
- **Dead Functions / Constants:** 27 exported symbols across 13 modules
- **Total Lines of Dead Code to Reclaim:** **~796 lines**
- **Living Code Impact:** **0%** — No active production routes, components, pipeline stages, or automated tests reference any of the listed symbols.

---

## 6. Phase 2 Execution Plan (Awaiting Approval)

Once approved by the project owner, deletion will execute in **4 isolated, verifiable batches**:

1. **Batch 1 (Frontend Dead File):**
   - Delete `frontend/src/App.css`.
   - Verification: `npm --prefix frontend run build`.
   - Git Commit: `chore(frontend): remove unused App.css`.

2. **Batch 2 (Frontend Dead Exports):**
   - Remove dead exports from `StudioContext.jsx`, `geminiRouteSelectors.js`, `projectStorage.js`, `timelineUtils.js`.
   - Verification: `npm --prefix frontend run build` + frontend unit tests.
   - Git Commit: `refactor(frontend): prune dead exports in studio, storage, and timelineUtils`.

3. **Batch 3 (Backend Services Dead Exports):**
   - Remove dead exports from `audioClassifierService.js`, `audioSeparationService.js`, `ffmpegService.js`, `geminiModelCatalog.js`, `geminiQuotaTracker.js`, `geminiService.js`.
   - Verification: Node syntax parse + backend service tests.
   - Git Commit: `refactor(backend): prune obsolete functions in gemini, ffmpeg, and audio services`.

4. **Batch 4 (Backend Pipeline Stages & TTS Dead Exports):**
   - Remove dead exports from `stage3_extractChineseSubtitles.js`, `stage4_analyzeDialogueAudio.js`, `stage6_generateModeSpecificScript.js`, `ttsService.js`.
   - Verification: Full backend test suite (`npm test`).
   - Git Commit: `refactor(pipeline): prune unused helpers in stages 3, 4, 6, and ttsService`.

---

## 7. Protocol Gate (STOP HERE)

> [!IMPORTANT]
> **GATE ACTIVE:** In accordance with the prompt's instructions, **Phase 1 is AUDIT ONLY**. No files or functions have been removed. We are stopped at this gate awaiting the project owner's explicit confirmation before starting Phase 2.
