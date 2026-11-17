# Dead-Code Audit & Removal Manifest

> **Branch:** `refactor/timeline-core-clean`  
> **Date:** 2026-11-17  
> **Status:** ✅ Phase 2 Completed & Verified (Owner Approved)  
> **Protocol:** Two-Phase Gated Dead-Code Audit & Removal

---

## 1. Executive Summary

This manifest documents the dead-code audit and removal executed across `frontend/src/` (115 files) and `backend/` (`routes/`, `services/`, `utils/`, 53 files) on branch `refactor/timeline-core-clean`.

### Protocol & Safety Gates
- **Phase 1 Audit**: Completed with zero false positives. Every deletion candidate was verified against zero repo-wide callers (`git grep -n -w`) across code and tests.
- **Gate Approval**: Project owner explicitly approved the manifest with the condition that all 4 batches be committed separately with test verifications, followed by a real end-to-end pipeline smoke test.
- **Phase 2 Deletions**: Executed across 4 isolated batches (Batches 1–4). **1,154 lines of dead code and 1 dead file were pruned cleanly**.
- **Real Pipeline Smoke Test**: Ran short episode through Stage 3 (OCR), Stage 4 (ASR & Pitch), Stage 6 (Translation), TTS Synthesis (Edge Neural), and FFmpeg Export with dynamic ducking and burned subtitles. **All stages passed 100%**.

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
| `frontend/src/context/StudioContext.jsx` (`StudioProvider`) | **ALIVE** | `StudioProvider` mounted in `App.jsx:793` wrapping the studio workspace. | Context provider for studio actions. (Only the unused hook `useStudioContext` was dead). |

---

## 3. Pruned Dead File

| File Path | Size | Lines | Commit | Verification |
| :--- | :---: | :---: | :---: | :--- |
| `frontend/src/App.css` | 63 B | 2 | `181dd1b` | `npm --prefix frontend run build` (2036 modules, built in 725ms) |

---

## 4. Pruned Dead Exports (14 Modules)

### A. Frontend Dead Exports (Batch 2 — Commit `9115923`)

| File Path | Export Name | Lines | Context |
| :--- | :--- | :---: | :--- |
| `frontend/src/context/StudioContext.jsx` | `useStudioContext` | 5 | Unused consumer hook. |
| `frontend/src/features/gemini-route/utils/geminiRouteSelectors.js` | `selectPartitionedSelectedEpisodes`, `selectStageCompletionFlags`, `selectedTotalBrokenCount` | 63 | Unused selector functions. |
| `frontend/src/utils/projectStorage.js` | `saveActiveProject`, `loadActiveProject` | 27 | Deprecated compatibility wrappers. |
| `frontend/src/utils/timelineUtils.js` | `resetSegmentsToSourceTiming` | 96 | Replaced by pure op `timelineOps.resetTiming`. |

### B. Backend Services Dead Exports (Batch 3 — Commit `103a212`)

| File Path | Export Name | Lines | Context |
| :--- | :--- | :---: | :--- |
| `backend/services/audioClassifierService.js` | `classifySegmentsFromMedia` | 30 | Unused acoustic classifier helper. |
| `backend/services/audioSeparationService.js` | `cancelSeparationJob` | 5 | Unused alias for `killSeparationJob`. |
| `backend/services/ffmpegService.js` | `inFlightProxyJobs`, `createGeminiProxyVideo`, `cleanupProxyFile`, `getActiveJobRenderProcess`, `renderDubbedVideo`, `measureAudioLoudnessDiagnostics` | 349 | Obsolete proxy generator, unused diagnostics, and deprecated render wrapper. |
| `backend/services/geminiModelCatalog.js` | `buildOrderedCascadeModels` | 25 | Unused cascade builder. |
| `backend/services/geminiQuotaTracker.js` | `DEFAULT_QUOTA_SETTINGS` | 1 | Unused export alias. |
| `backend/services/geminiService.js` | `sanitizeSubtitleDuration`, `getPromptForMode`, `validateAndSanitizeSegment`, `auditTimelineCoverage`, `generateDubbingScript`, `generateScriptFromMedia` | 396 | Legacy monolithic generator and validator functions superseded by pipeline stages. |

### C. Backend Pipeline Stages & TTS Dead Exports (Batch 4 — Commit `f592745`)

| File Path | Export Name | Lines | Context |
| :--- | :--- | :---: | :--- |
| `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js` | `generateBaseSamplingGrid` | 31 | Unused sampling grid generator. |
| `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js` | `groupTranscriptionWordsIntoSegments` | 82 | Obsolete transcribe parser. |
| `backend/services/pipeline/stages/stage6_generateModeSpecificScript.js` | `DRAMA_GENRES`, `CULTIVATION_DRAMA_GLOSSARY` | 14 | Unused constant object and empty string. |
| `backend/services/ttsService.js` | `generateKhmerSpeech`, `generateBatchSpeech` | 29 | Deprecated aliases. |

---

## 5. Actual Reclaimed Metrics

- **Dead Files Deleted:** 1 file (`frontend/src/App.css`)
- **Total Lines Deleted:** **1,154 lines** across 15 files
- **Net Diff (`git diff --stat`):** `15 files changed, 1 insertion(+), 1154 deletions(-)`
- **Living Code Regression:** **0%** — All living unit tests, acceptance tests, and builds remain 100% green.

---

## 6. Real Pipeline End-to-End Smoke Test Results

As required by the added condition, a live pipeline smoke test was executed across all stages using `backend/tests/run_real_pipeline_smoke_test.js` (Commit `63a71bc`):

```json
{
  "stage3": {
    "success": true,
    "segmentsCount": 1,
    "extractedChinese": "掌门师尊，弟子在此候命。"
  },
  "stage4": {
    "success": true,
    "audioSegmentsCount": 1,
    "audioGender": "female"
  },
  "stage6": {
    "success": true,
    "scriptSegmentsCount": 1,
    "khmerText": "លោកគ្រូធំ កូនសិស្សនៅទីនេះរង់ចាំបញ្ជា។"
  },
  "tts": {
    "success": true,
    "audioPath": "tts_audio/seg_1_km-KH-PisethNeural_voice_3f299610.mp3",
    "audioSize": 23348,
    "voiceUsed": "km-KH-PisethNeural"
  },
  "export": {
    "success": true,
    "outputPath": "smoke_exported_dubbed.mp4",
    "outputSize": 103515,
    "hasVideo": true,
    "hasAudio": true
  }
}
```

**Status:** ✅ **ALL STAGES PASSED (100% GREEN)**
