# Full Project Cleanup & Repair Plan — `.agents/FULL-FIX-PLAN.md`

> **Branch:** `chore/full-project-cleanup` (branched from `refactor/timeline-core-clean` at `31323e1`)  
> **Date:** 2026-11-17  
> **Discipline:** Minimal Change Engineer — zero scope creep, zero UI redesign, frozen timeline invariants preserved, grep-proof required for every deletion.

---

## 0. Baseline Verification (Before Any Changes)

| Check | Command | Baseline Result |
| :--- | :--- | :--- |
| Frontend production build | `npm --prefix frontend run build` | **PASS** (2036 modules, 676ms, 0 errors) |
| Frontend linter | `npm --prefix frontend run lint` | **0 errors**, 473 warnings |
| Frozen timeline regression suites (15 suites) | `node --test backend/tests/timeline_*.test.js` | **87/87 PASS**, 0 FAIL |
| Full backend test suite (from repo root) | `node --test backend/tests/*.test.js` | **315 PASS**, 6 FAIL, 2 SKIPPED (323 total) |

**Pre-existing 6 failures (recorded before any edits):**
1. `backend/tests/full_project_master_upgrade.test.js` (`Phase 3a`): fails because `EpisodesTab.jsx:107` contains `window.location.reload()` (addressed in Phase 2 Fix 2.4).
2. `backend/tests/stage5_reconciliation_and_recovery.test.js` (4 tests): fails with `ENOENT` on hardcoded `backend/uploads/projects/series_1793272088927/series.json` → **Needs Owner**.
3. `backend/tests/stage6_translation_fallback_and_tts_guard.test.js` (1 test): Stage 6 retries 503-overloaded models twice while test expects 1 attempt per model → **Needs Owner**.

---

## 1. Phase 0 Inventory Findings

### (a) Dead Files & Dead Exports (Grep-Verified Zero References)

#### Frontend Dead Files (Batch 1A)
| File | Evidence (`git grep` / Reachability BFS) | Action |
| :--- | :--- | :--- |
| `frontend/src/components/layout/WorkflowStepper.jsx` | 0 JSX usages repo-wide; only referenced by unused barrel `components/layout/index.js:4`. | Delete file + remove export from `components/layout/index.js` |
| `frontend/src/components/layout/WorkflowStepper.css` | Only imported by dead `WorkflowStepper.jsx:3`; 0 other references. | Delete file |
| `frontend/src/features/gemini-route/hooks/index.js` | 0 importers repo-wide (`GeminiRouteModal.jsx:41` imports `useEpisodeSelection` directly); not checked by any test. | Delete file |

> **Kept Barrels (Proof of Life):** `frontend/src/components/{layout,media,player,timeline,voice}/index.js` are explicitly required by `backend/tests/fullstack_refactor_verification.test.js:43-46`. `frontend/src/services/api/index.js` has 22 active importers.

#### Frontend Dead Exports & Unexported Dead Helpers (Batch 1A)
| File | Symbol | Evidence (`git grep -n -w`) | Action |
| :--- | :--- | :--- | :--- |
| `frontend/src/components/player/PlayerControls.jsx` | `PlayerTopBar` | Returns `null`; 0 JSX usages repo-wide; only unused import in `VideoPlayerPreview.jsx:10` and `components/player/index.js:2`. | Delete symbol + clean unused import/re-export |
| `frontend/src/components/dashboard/geminiRouteHelpers.js` | `checkEpisodeScriptHealthy` | 0 references outside definition (L49–53). | Delete export |
| `frontend/src/services/api/audioApi.js` | `killTtsApi` | 0 references outside definition (L163–170). | Delete export |
| `frontend/src/services/api/jobsApi.js` | `killTranslateJobApi` | 0 references outside definition (L45–52). | Delete export |
| `frontend/src/utils/timelineOps.js` | `stripGapSegmentFields`, `getSourceSubtitleEnd` | 0 callers in repo or tests (`ok()` inlines the strip directly; `getSourceSubtitleEnd` at L922 unreferenced). | Delete dead helpers |
| `frontend/src/utils/timelineUtils.js` | `getSourceSubtitleEnd`, unused import `formatTimecode` | 0 callers in repo or tests (L817, L4). | Delete dead helper + unused import |

#### Backend Dead Exports (Batch 1B)
| File | Symbol | Evidence (`git grep -n -w`) | Action |
| :--- | :--- | :--- | :--- |
| `backend/models/speakerRegistry.js` | `DEFAULT_VOICES` | 0 callers outside definition (L676–687) & `module.exports` (L713). | Delete constant & export |
| `backend/models/speakerRegistry.js` | `detectGenderFromAcousticPitch` | 0 callers outside definition (L689–703) & `module.exports` (L715). | Delete function & export |
| `backend/models/speakerRegistry.js` | `switchSpeakerOrSegmentVoice` | 0 callers outside definition (L571–612) & `module.exports` (L719). | Delete function & export |

> **Internal-Only Exports Kept Safe:** All other 0-external-ref exports in `backend/` and `frontend/src/` (`checkQsvSupport`, `buildAtempoFilter`, `normalizeScriptData`, `resolveKhmerVoice`, `normalizeClip`, `safeClone`, etc.) are actively called internally inside their own files and are intentionally kept intact.

---

### (b) Leftover Debug / Diagnostic Logging Audit

- **Backend:** 0 leftover `DEBUG`/`TEMP`/`FIXME` diagnostic `console.log` statements found. (All `console.log` statements in `backend/` are structured operational server/pipeline logs; `productionJobQueue.js:815` is retry status logging).
- **Frontend:** 27 `console.log` calls found (`DubbingRunnerContext.jsx` ×11, `useAudioDubbing.js` ×6, `GeminiRouteModal.jsx` ×3, `VideoPlayerPreview.jsx` ×2, `useScriptWorkflow.js` ×2, `VoiceSettings.jsx` ×1, `useSeriesManager.js` ×1, `projectStorage.js` ×1). None are `DEBUG`/`TEMP` dumps — all are operational user-visible DevTools trace logs for batch jobs, TTS, Demucs, and stale-request guards → listed in **Needs Owner** rather than silently stripped.

---

### (c) Broken Wiring Findings (Phase 2 — 1 Fix Per Commit)

| ID | File & Line | Broken Wiring Evidence | Minimal Fix |
| :---: | :--- | :--- | :--- |
| **2.1** | `frontend/src/components/media/index.js:5` | `export { default as AiToolsTab } from './AiToolsTab';` imports a non-existent file (`AiToolsTab.jsx` does not exist; replaced by `DubbingModeTab.jsx`). | Replace broken re-export with `export { default as DubbingModeTab } from './DubbingModeTab';`. |
| **2.2** | `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx:128` | Aborting a running translation job sends `POST /api/jobs/${encodeURIComponent(jobId)}/kill`, which returns **404** because `backend/routes/jobRoutes.js` defines `POST /:jobId/cancel` (L696) and `POST /kill` (L668), not `/:jobId/kill`. | Change endpoint to `POST /api/jobs/${encodeURIComponent(jobId)}/cancel`. |
| **2.3** | `frontend/src/App.jsx:1026-1028` & `1050-1052` | `<VoiceSettings>` receives duplicate JSX props `selectedClip`, `onSplitClip`, and `onDeleteClip` twice (`react(jsx-no-duplicate-props)`). | Remove duplicate prop lines at L1026–1028. |
| **2.4** | `frontend/src/components/media/EpisodesTab.jsx:107` | Fallback branch calls `window.location.reload()` when `onSwitchSeries` is absent, violating SPA contract and failing `full_project_master_upgrade.test.js` (`Phase 3a`). `MediaLibrary.jsx` always passes `onRefreshSeries`. | Replace `window.location.reload()` with `if (typeof onRefreshSeries === 'function') await onRefreshSeries();`. |
| **2.5** | `backend/services/ffmpegService.js` (`module.exports`) | `backend/tests/aspect_ratio_and_crop.test.js:14` destructures `getVideoDimensionsFast` from `ffmpegService.js`, where it is defined (L99) and used internally (L1649) but missing from `module.exports` (resolves to `undefined`). | Export `getVideoDimensionsFast` in `module.exports`. |

---

### (d) UI Code Cleanup Findings (Phase 3 — Zero Visual Change)

1. **Unreachable code**:
   - `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx:605` — unreachable `return { success: false, aborted: true };` directly after `return { success: true, noVocalsUrl: sepRes?.noVocalsUrl };`.
2. **Dead UI state, handlers, and unused imports** (100% unreferenced in JSX and tests):
   - `frontend/src/components/voice/VoiceSettings.jsx` — dead voice-preview state/refs/handlers (`previewText`, `setPreviewText`, `isPreviewLoading`, `previewAudioObj`, `isPlayingPreview`, `previewError`, `previewAudioRef`, `previewRequestIdRef`, `previewingSpeakerVoiceId`, `charPreviewAudioRef`, `stopPreviewAudio`, `handlePreviewCharacterVoice`, `handleTogglePreview`, unused `previewVoiceApi` & `useDubbingFeature` imports, unused `segmentsCount`).
   - `frontend/src/components/media/EpisodesTab.jsx` — unused `uploadTargetEpisodeId` state, unused `handleEpisodeFileInput`, unused imports (`Film`, `FileText`, `Sparkles`, `Mic`, `Download`, `ArrowRight`, `AlertCircle`, `Play`, `Zap`, `checkEpisodeHasScript`, `getEpisodeSegmentCount`, `useDubbingFeature`).
   - `frontend/src/components/media/DubbingModeTab.jsx` — unused `internalProgress`/`internalStage`, `isOtherEpisodeGeneratingScript`, `getDirectionPlaceholder`, unused imports (`Languages`, `ChevronUp`, `FileUp`, `useDubbingFeature`).
   - `frontend/src/components/dashboard/GeminiRouteModal.jsx` — dead unused state/memos/imports (strictly excluding any identifier referenced in JSX or `backend/tests/`).
   - Unused imports/dead locals in `Navbar.jsx`, `MediaLibrary.jsx`, `MediaUploadTab.jsx`, `ScriptReviewTab.jsx`, `ExportSettingsPanel.jsx`, `ClipInspectorPanel.jsx`, `VideoPlayerPreview.jsx`, `TimelineEditor.jsx`, `TimelineTracksCanvas.jsx`, `TimelineTrackHeaders.jsx`, `VideoTransformControls.jsx`, `GeminiQuotaModal.jsx`.
3. **Strictly unused CSS blocks** (zero references across `frontend/src/`, `frontend/index.html`, and `backend/tests/`, excluding all dynamic class prefixes):
   - Verified standalone dead selectors in `Navbar.css`, `MediaLibrary.css`, `VideoPlayerPreview.css`, `VoiceSettings.css`, `styles/components.css`, `styles/modals.css`, `styles/timeline.css`.

---

## 2. Execution Roadmap

- **Phase 0**: Write `.agents/FULL-FIX-PLAN.md` → commit → push.
- **Phase 1**:
  - **Batch 1A (Frontend dead files & exports)** → build + full backend tests + timeline tests → commit → push.
  - **Batch 1B (Backend dead exports)** → build + full backend tests + timeline tests → commit → push.
- **Phase 2**: Fixes 2.1 through 2.5, **one fix per commit**, tests + build after each, push after each.
- **Phase 3**: UI dead-code / unreachable-branch / strictly-unused-CSS cleanup (zero visual change) → build + full backend tests + timeline tests → commit → push.
- **Phase 4**: Full backend test suite, frontend build, live server boot + `GET http://localhost:5000/api/health = 200`, real end-to-end pipeline smoke test (`backend/tests/run_real_pipeline_smoke_test.js` — Stage 3, Stage 4, Stage 6, TTS, Export), update `.agents/STATE.md` → commit → push.

---

## 3. Needs Owner List (Untouched — Ambiguous or Out-of-Scope)

1. **Dual SenseVoice workers**: `backend/services/senseVoiceService.js` + `backend/workers/sensevoice_worker.py` (covered by `sensevoice_worker.test.js` & `sensevoice_fallback.test.js`) exist alongside `backend/workers/sense_voice_worker.py` (invoked by `stage4_analyzeDialogueAudio.js`). Untouched pending owner decision on consolidation.
2. **Manual utility scripts in `backend/scripts/`**: `clearEpisodeCache.js`, `debugAndFixEpisode.js`, `repairMergedSegments.js`, `run_demucs_benchmarks.py`. Standalone CLI maintenance tools; kept untouched.
3. **Frontend operational `console.log` statements (27 calls)**: Live pipeline/runner/playback trace logs across 8 files. Kept untouched unless owner wants silent browser console.
4. **Pre-existing failure in `backend/tests/stage5_reconciliation_and_recovery.test.js` (4 tests)**: Depends on local disk file `backend/uploads/projects/series_1793272088927/series.json` (`backend/uploads` is strictly off-limits).
5. **Pre-existing failure in `backend/tests/stage6_translation_fallback_and_tts_guard.test.js` (1 test)**: Stage 6 cascade retries 503 models twice (`14` calls vs `10` expected). Left untouched to avoid altering live Gemini retry behavior without owner sign-off.
6. **`previewVoiceApi` in `frontend/src/services/api/audioApi.js` & `POST /api/tts/preview`**: Retained after removing dead preview handlers in `VoiceSettings.jsx` in case owner wants to re-wire voice preview UI later.
7. **Test CWD sensitivity (`npm --prefix backend test`)**: 4 timeline static-audit tests read `frontend/src/...` relative to CWD and pass from repo root (`node --test backend/tests/*.test.js`) but fail when run from `backend/`. Left untouched unless owner wants CWD-independent `__dirname` resolution.
8. **Dynamic CSS class families**: `pos-*`, `style-*`, `wm-*`, `badge-*`, and `TimelineEditor.css` clip states are retained untouched due to dynamic template-literal usage or test assertions.
9. **Local uncommitted `.agents/agents/` changes**: Kept local and unstaged per owner confirmation.
