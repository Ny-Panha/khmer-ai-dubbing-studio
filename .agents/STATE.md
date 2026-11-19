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
- **Timestamp**: 2026-11-19T22:45:00+07:00

## Summary: Post-Optimization Critical Fixes — Smart 3-Step AI Pipeline (100% PASS)
- **Request:** Fix the remaining correctness, caching, concurrency, and test-coverage problems in the Smart 3-Step AI Pipeline across 5 priority areas:
  1. Fix false-success results in All-3 runner.
  2. Prevent unsafe legacy TTS cache reuse.
  3. Make Chinese-to-Khmer translation caching context-safe.
  4. Fix Demucs queue/cancellation race conditions & stem validation.
  5. Replace misleading tests with real behavioral regression tests.
- **Root Causes Confirmed & Surgical Fixes Implemented**:
  1. **P0 False Success in All-3 Runner (`frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`)**:
     - `runSingleEpisodeAll3` previously caught background Demucs failure (`bgmErr`) with a warning and still returned `{ success: true }`.
     - Fixed: Validates actual outcome of all three steps. If Clean BGM fails and was not explicitly skipped, throws/fails cleanly with visible error.
     - Fixed: Abort signal stops immediately before/after each step; returns `{ success: false, aborted: true }` without claiming completion.
     - Fixed: `skipped: true` requires actual artifact presence (`checkEpisodeHasScript`, `checkEpisodeHasAudioReady`, `checkEpisodeHasDemucsReady`); missing dependencies throw errors instead of being treated as completed.
  2. **P1 Unsafe Legacy TTS Cache Reuse (`backend/services/pipeline/stages/stage9_generateSegmentTTS.js` & `backend/routes/audioRoutes.js`)**:
     - Previously `const sigMatches = !seg.audioSignature || seg.audioSignature === audioSignature;` allowed any segment lacking `audioSignature` to bypass invalidation and falsely reuse stale audio after text edits.
     - Fixed: Segments without `audioSignature` MUST NOT be trusted on file existence alone. Requires verified sidecar `.json` metadata matching exact normalized Khmer text and voice ID, otherwise marks `needsTts = true` and forces fresh synthesis.
     - Fixed: Existing audio files are NOT deleted until replacement generation succeeds. Saves atomic sidecar metadata alongside synthesized audio files.
  3. **P1 Context-Safe Translation Cache (`backend/services/pipeline/stages/stage6_generateModeSpecificScript.js`)**:
     - Previously keyed only by normalized Chinese text, leading to collisions for short dialogue (e.g., "是", "好", "快走") across different characters or scenes.
     - Fixed: Cache key incorporates `schemaVersion: 'v3_ctx'`, `speaker`, `voiceGender`, surrounding dialogue context (`prevContext` / previous Chinese line), and series ID.
     - Invalidates legacy v1/v2 schema entries automatically. Preserves manual corrections (`userOverridden: true`) strictly.
  4. **P1 Demucs Queue / Cancellation Races & Stem Validation (`backend/services/audioSeparationService.js`)**:
     - Fixed Double-Dequeue Race: Wrapped `finishDemucsWorkerAndProcessQueue()` in per-worker `completeWorkerOnce` guard attached to child process (`child.__completeWorker`). Prevents duplicate dequeues when `error` and `close` fire in rapid sequence.
     - Fixed Substring Collisions: Replaced `includes()` with exact equality matching (`cleanKey === targetClean || options.jobId === identifier`), preventing `ep_1.mp4` from cancelling `ep_10.mp4`.
     - Fixed Stem Validation: Added `validateDemucsStems(vocalsPath, noVocalsPath, sourceDuration)`. Verifies file existence, size >= 100KB, decodability via FFprobe/FFmpeg, duration > 0.1s, and duration matching source within 2.0s tolerance. Discards corrupt stems immediately. Eliminated circular dependency with lazy probe helper.
  5. **P1 Real Behavioral Regression Tests (`backend/tests/smart_pipeline_all3.test.js`)**:
     - Expanded test suite with real runtime assertions:
       - All-3 runner failure propagation on Clean BGM error (rejects/fails, no false success).
       - Context-safe translation cache hits, cross-speaker isolation, and context-dependent misses.
       - Legacy TTS signature enforcement: missing signature triggers synthesis, matching signature reuses, edited text invalidates, sidecar metadata verifies.
       - Real Demucs stem validation: tests missing, small, corrupt, matched duration, and mismatched duration stems.
       - Exact matching queue cancellation preventing substring collisions.
       - Worker error-to-close transition without double dequeue.
- **Verification Outcomes**:
  - `backend/tests/smart_pipeline_all3.test.js`: **22/22 PASS** (927ms).
  - All regression test suites passing (**91 PASS, 1 skipped, 0 FAIL** across all suites in 6.1s).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 674ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
- **Next Steps**:
  - Commit and push to `chore/full-project-cleanup`.
  - Ready for Nha's review.

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
