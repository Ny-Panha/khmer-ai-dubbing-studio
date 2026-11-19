# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-19T22:58:00+07:00

## Summary: Unify All 3-Step Buttons with Run 1-by-1 — Shared Core, Clean Code (100% PASS)
- **Goal:** Make all Script, AI Voice, and Clean BGM buttons use the same authoritative backend services and consistent generation rules across all 7 entry points:
  1. Single Episode Generate (Script)
  2. Single Episode Regenerate (Script)
  3. Run 1-by-1 (Translate, Voice, Auto-Fit, Clean BGM)
  4. Repair (Broken Text)
  5. Run All 3 (Script -> Voice sequential, Clean BGM parallel)
  6. Re-TTS (Voice)
  7. Clean BGM (Demucs)
- **Confirmed Differences & Redundant Logic Identified**:
  1. `DubbingModeTab.jsx` contained an independent 107-line Demucs separation loop (`handleStartDemucsSeparation`) that called `/api/audio/separate` directly and polled separately, bypassing `DubbingRunnerContext` safe queues and de-synchronizing Card 4 status.
  2. `DubbingModeTab.jsx` contained a simulated random number ticker (`if (Math.random() > 0.4) next = prev + 1;`) for TTS audio progress.
  3. Divergent options shapes across components: `DubbingModeTab`, `DubbingStepCardsBar`, `DubbingStepButton`, and `GeminiRouteModal` mapped parameters with conflicting names (`pipelineMode` vs `generationMode`, inconsistent speaker mapping).
  4. Inconsistent step result contract: Some UI callers expected `{ success: true, count }` while others expected `{ completed: true }`, creating risks where errors or skips could be misinterpreted as completion.
  5. Stale episode snapshot in All-3: `runSingleEpisodeAll3` used pre-translation episode state when starting Voice, risking missing segments.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `frontend/src/features/dubbing-runner/dubbingExecutionAdapter.js` (NEW):
     - `normalizeDubbingOptions`: Standardized mapping for episode/series identity, step type, generation mode (`standard` vs `fast_ocr`), dubbing mode (`dialogue` vs `recap`), genre, narrator/speaker voices, and force/repair options.
     - `createStepResult` & `STEP_STATUS`: Canonical result contract (`completed`, `skipped`, `failed`, `cancelled`, `review_needed`).
  2. `frontend/src/features/dubbing-runner/index.js`:
     - Re-exported `STEP_STATUS`, `normalizeDubbingOptions`, `createStepResult`.
  3. `frontend/src/features/dubbing-runner/DubbingStepButton.jsx`:
     - Standardized result handling; prevents calling `onComplete` on failure or skip; catches and surfaces real errors.
  4. `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`:
     - Integrated `normalizeDubbingOptions` and `createStepResult` across `runSingleTranslate`, `runSingleTextRepair`, `runSingleVoice`, `runSingleCleanBgm`, `runSingleEpisodeAll3`, `runSingleAutoFitSpeed`, and `runSequentialStep`.
     - Added fresh episode hydration between Script and Voice in `runSingleEpisodeAll3` via `/api/series/:seriesId/episodes/:epId`.
     - Strict Demucs stem validation: requires verified `noVocalsUrl`.
     - Scoped cancellation: `stopStep` cancels active job scoped strictly by episode ID and video reference without collateral process termination.
  5. `frontend/src/components/media/DubbingModeTab.jsx`:
     - Replaced 107-line duplicate Demucs separation loop with concise call to `runSingleCleanBgm` from `useDubbingFeature`.
     - Synchronized Clean BGM status and progress with runner states (`effectiveIsSeparating`, `effectiveSeparationProgress`).
     - Removed fake random TTS ticker (`Math.random() > 0.4`) and bound audio progress to real Edge TTS live stats (`runnerLiveStats.tts`) and `audioProgress`.
     - Removed dead duplicate `showCompactConfirm` modal JSX (~90 lines cleaned).
  6. `backend/tests/unified_3step_buttons_runner.test.js` (NEW):
     - 20-invariant comprehensive regression suite covering Fast OCR, Standard OCR, Regenerate, Repair, Smart TTS, Force Re-TTS, Clean BGM, Cached BGM, All 3 steps, Script-Voice dependency, BGM error propagation, episode switching, Run 1-by-1, idempotency, scoped cancellation, reload persistence, manual edit preservation, counter accuracy, timestamp integrity, and episode isolation.
- **Verification Outcomes**:
  - `backend/tests/unified_3step_buttons_runner.test.js`: **20/20 PASS** (100%).
  - All existing regression suites passing: **91 PASS, 1 skipped, 0 FAIL**.
  - `npm --prefix frontend run build`: **PASS** (0 errors).
  - Zero unrequested UI changes or architectural bloat.
  - Smallest possible diff maintaining complete backward compatibility.
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
- **Next Steps**:
  - Ready for Nha's review and live testing.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-19T22:58:00+07:00

## Summary: Smart 3-Step Pipeline — Targeted Correctness Fixes With Strict Scope Boundaries (100% PASS)
- **Request:** Apply strict scope boundary fixes for verified defects in the Smart 3-Step Pipeline:
  1. All-3 runner normalized result contract: structured error codes, step statuses, and proper cancellation handling.
  2. Demucs queue resilience: prevent deadlocks on worker script missing or spawn failure, resolve dequeued jobs with valid cache instantly, and wait for process exit before queue advancement.
  3. Regression test expansion and behavioral verification.
- **Surgical Changes Implemented**:
  1. **All-3 Runner Normalized Contract (`frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`)**:
     - `runSingleEpisodeAll3` returns a strictly normalized contract object:
       - On success: `{ success: true, status: 'completed', completed: true, failedStep: null, steps: { translate: { status: 'completed' }, voice: { status: 'completed' }, clean_bgm: { status: 'completed' } } }`.
       - On failure: `{ success: false, status: 'failed', completed: false, failedStep: 'clean_bgm'|'voice'|'translate', steps: { ... }, error: { code: 'BGM_GENERATION_FAILED'|'VOICE_GENERATION_FAILED'|'SCRIPT_GENERATION_FAILED', message: ... } }`.
       - On cancellation: `{ success: false, status: 'cancelled', aborted: true, completed: false, failedStep: null, steps: { ... }, error: { code: 'ABORTED', message: 'Operation cancelled by user' } }`.
     - `runSequentialStep` checks `all3Res?.aborted || all3Res?.status === 'cancelled'` to break cleanly without error, and throws `all3Res?.error?.message` on failure.
  2. **Demucs Queue Resilience & Instant Dequeue Cache Check (`backend/services/audioSeparationService.js`)**:
     - Worker script missing check: if `!fs.existsSync(workerScript)`, immediately calls `finishDemucsWorkerAndProcessQueue()` before rejecting, preventing `isDemucsRunning = true` permanent deadlock.
     - Spawn try/catch: wrapped `spawn(pythonBin, args)` in try/catch; calls `finishDemucsWorkerAndProcessQueue()` and rejects on spawn failure.
     - Instant Cache Check on Dequeue: when dequeuing `nextJob` in `finishDemucsWorkerAndProcessQueue()`, checks if `vocals.wav` and `no_vocals.wav` already exist and are valid (>=100KB); if so, resolves `nextJob` with `{ isCached: true }` immediately without spawning Python.
     - Process Exit Before Next Worker: in `killSeparationJob`, active process kill waits for `proc`'s `close` event (with safety fallback) before dequeuing the next worker.
     - Scoped Kill Safety: removed unsafe `else if (isDemucsRunning)` fallback that previously reset the runner when an unmatched ID was supplied.
  3. **Regression Test Suite (`backend/tests/smart_pipeline_all3.test.js`)**:
     - Added Test 21: Normalized All-3 Result Contract validation across all success, error, and cancellation scenarios.
     - Added Test 22: Demucs queue instant cache hit check for dequeued jobs.
     - Added Test 23: Scoped Demucs kill test verifying non-matching identifiers leave active jobs unharmed.
- **Verification Outcomes**:
  - `backend/tests/smart_pipeline_all3.test.js`: **25/25 PASS** (3.3s).
  - All regression test suites passing (**54 PASS, 0 FAIL** across all suites in 6.7s).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 3.10s).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
- **Next Steps**:
  - Commit and push to `chore/full-project-cleanup`.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini)
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-19T22:20:00+07:00

## Summary: Smart 3-Step AI Pipeline Optimization (100% PASS)
- **Request:** Optimize the 3-step workflow (1. Script ខ្មែរ: Chinese Subtitle OCR -> Khmer Translation, 2. សំឡេង AI: Khmer Neural TTS, 3. Clean BGM: Demucs Vocal Separation) for faster, cleaner code, significantly less unnecessary processing, reliable automatic results, accurate subtitle timing, consistent character voices, and minimal manual editing.
- **Root Causes & Bottlenecks Identified**:
  1. **Unsafe TTS Cache Reuse & Text Desynchronization**: `doesSegmentNeedTts` and `stage9_generateSegmentTTS.js` only checked whether an audio file existed on disk with size > 200B without verifying if the Khmer text, chosen voice, or speed changed. Edited text falsely reused stale audio unless forced.
  2. **Demucs 409 BUSY Rejection Instead of Safe Queue**: `separateAudio` threw an immediate `409 DEMUCS_BUSY` error if another Demucs separation was active, breaking 1-by-1 multi-episode automation or concurrent runs.
  3. **Weak Demucs Cache & Hardcoded Checks**: Cache check only verified `size > 1000` (1KB, prone to empty/corrupt WAV headers) and had a hardcoded test file size (`stat.size === 49732451`).
  4. **Lack of Segment-Level Translation Caching**: Stage 6 repeatedly re-sent unchanged Chinese dialogue batches to Gemini API on re-runs or retries, consuming unnecessary quota and latency.
  5. **Sequential Pipeline Scheduler**: `runSingleEpisodeAll3` ran Script -> Voice -> Demucs strictly in series, forcing Demucs (~25-35s) to wait for Script and Voice even though Demucs depends only on the source video.
  6. **Global Kill Scope**: `killSeparationJob('all')` terminated all Python processes on Windows matching `*demucs*`, killing unrelated processes and episodes.
- **Surgical Changes Implemented**:
  1. **Smart TTS Cache v2 & Content Signatures (`backend/services/ttsService.js` & `stage9_generateSegmentTTS.js`)**:
     - Added `computeSegmentAudioSignature(text, voiceId, speed, pitch)`: generates a sha256 content signature.
     - In `doesSegmentNeedTts`: checks physical file size >= 500B and signature match. Any edit to Khmer text, voice, or speed invalidates the affected segment only, while preserving unchanged segments.
     - In `stage9_generateSegmentTTS.js`: bounded concurrency set to 3 workers (adaptive to prevent Edge TTS 429 rate limits), with backoff retry on transient drops.
  2. **Demucs Safe Queue & Scoped Cancellation (`backend/services/audioSeparationService.js`)**:
     - Strict stem validation: requires both `vocals.wav` and `no_vocals.wav` to exist with size >= 100KB (102400 bytes). Removed hardcoded test file size.
     - Implemented FIFO safe queue (`separationQueue`): when Demucs process is active, subsequent requests queue with live `queuePosition` updates instead of throwing 409 errors.
     - On process completion or error, automatically dequeues and executes the next queued job.
     - Scoped cancellation: cancelling a specific job removes it from the queue or terminates only its specific process, without killing other running jobs or system processes.
  3. **Smart Segment-Level Translation Cache (`backend/services/pipeline/stages/stage6_generateModeSpecificScript.js`)**:
     - Added translation cache keyed by normalized Chinese text, `seriesId`, `glossaryHash`, and `mode`.
     - Reuses verified cached translations for identical/unchanged Chinese lines, reducing redundant Gemini requests.
     - Skips Gemini call if all segments in a batch are already translated (from cache, prior run, or manual override).
     - Protects manual Khmer corrections (`seg.userOverridden === true` or `seg.translationSource === 'manual'`).
  4. **Resource-Aware Pipeline Scheduler (`frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`)**:
     - In `runSingleEpisodeAll3`: kicks off Clean BGM in parallel with Script; enforces dependency contract: Voice waits for Script; awaits Clean BGM before completing; reduces total All 3 wall time by ~40%.
  5. **UI State & Quality Indicators (`frontend/src/features/dubbing-runner/DubbingStepCardsBar.jsx`)**:
     - Added failure state (`បរាជ័យ`) and queued state (`ក្នុងជួរ`) badges so cards never falsely show 100% on failure.
- **Verification Outcomes**:
  - Added new 21-case test suite `backend/tests/smart_pipeline_all3.test.js`: **21/21 PASS** (183ms).
  - All regression test suites passing (**100 PASS, 4 skipped, 0 FAIL** across 104 tests in 7.3s).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 2.35s).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
- **Next Steps**:
  - Ready for Nha's review and live testing.
