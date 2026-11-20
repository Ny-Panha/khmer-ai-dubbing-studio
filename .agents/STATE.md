# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T09:10:00+07:00

## Summary: Master Audio Content Signature, Timeline Drift Protection & Failure Guard (100% PASS)
- **Task:** Resolve risks identified by Nha:
  1. **P0 Master Audio Stale Timing on Voice Clip Movement**: Prevent skipping master audio merge if timeline positions (`startSec`, `audioStartSec`), segment ordering, or offsets change while MP3 clips remain identical.
  2. **P1 Failed Segments Impact on Completion**: Prevent `newlySynthesizedCount === 0` from falsely skipping master merge or clearing `audioOutdated: false` when 1 or more spoken segments fail synthesis (`failedCount > 0`).
  3. **P1 Comprehensive Test Coverage**: Add integration tests for `computeMasterAudioSignature`, real all-cached zero-merge re-run, timeline clip shifting forcing re-merge, and batch failure handling.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/ttsService.js`:
     - Added `computeMasterAudioSignature(syncSegments)` based on segment IDs, clip ordering, audio filenames, startSec (3 decimals), audioOffset, and individual audio signatures.
     - Exported `computeMasterAudioSignature`.
     - In `generateBatchSegmentsAudio` error handling, explicitly marked `_failed: !isEmptyErr`.
  2. `backend/routes/audioRoutes.js`:
     - Imported `computeMasterAudioSignature` and defined `isSpokenSegment(s)`.
     - In Fast Path (lines 705–735): checks `isFastMasterSigValid = Boolean(currentFastMasterSig && recordedMasterSig && recordedMasterSig === currentFastMasterSig)`. If timeline moved, skips out of Fast Path to re-render master narration.
     - In Batch Runner (lines 875–935):
       - Explicitly calculates `failedSegments` (spoken segments with `ttsStatus === "error"`, `_failed`, or missing audio file).
       - Computes `currentMasterSig` and compares with disk `.sig` or `targetEp.masterAudioSignature`.
       - Skip condition strictly requires: `!forceRegen && !hasAnyFailures && newlySynthesizedCount === 0 && fs.existsSync(fullAudioPath) && isMasterSigValid`.
       - On master audio sync success, writes sidecar `.sig` file and saves `targetEp.masterAudioSignature`.
       - `targetEp.audioOutdated = false` is ONLY set if `narrationSynced && !hasRemainingOutdatedSpoken && !hasAnyFailures`. If any failure occurred, `audioOutdated` remains `true`!
     - Telemetry returned in response includes: `failedCount`, `masterAudioSignature`, `masterMergeSkipped`.
  3. `backend/tests/tts_smart_skip_and_progress.test.js`:
     - Unit test for `computeMasterAudioSignature` verifying changes on startSec, offset, ordering, and audio files.
     - End-to-end integration test verifying: initial run creates `.sig`, second all-cached run skips merge (`masterMergeSkipped: true, masterAudioMergeMs: 0`), and third run with shifted `startSec` detects signature mismatch and re-merges master audio.
     - Integration test verifying failed segment in batch prevents false completion and keeps `audioOutdated: true`.
- **Verification Outcomes**:
  - `backend/tests/clip_speed_tts.test.js`, `tts_smart_skip_and_progress.test.js`, `stage6_translation_fallback_and_tts_guard.test.js`: **26/26 PASS** (100%).
  - Stage 3 hybrid OCR, cancellation, and series sync: **56/56 PASS** (100%).
  - `npm --prefix frontend run build`: **PASS** (629ms, 0 errors).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit and push verified fixes.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T08:58:00+07:00

## Summary: Fast Smart Incremental TTS, FFmpeg Trim Optimization & Adaptive Concurrency (100% PASS)
- **Task:** Optimize "បង្កើតសំឡេងខ្មែរ AI (Generate TTS)" button to run significantly faster for 5-minute videos (~138 segments) without changing voice models (`km-KH-PisethNeural`, `km-KH-SreymomNeural`), without breaking audio signatures, voice mapping, or timings, and without creating duplicate worker pools or redundant cache directories.
- **Root Causes of TTS Bottlenecks on Windows Addressed**:
  1. **Redundant Process Spawns in Silence Trimming & Slot Stretching**: `autoStretchTtsAudio` previously re-detected speech bounds and re-trimmed silence on files that `trimTtsSilence` had already trimmed, spawning up to 7 FFmpeg/FFprobe processes per segment (~800 process spawns on Windows for 138 segments).
  2. **Unconditional 60ms Artificial Sleep in Batch Workers**: `generateBatchSegmentsAudio` ran an artificial 60ms sleep before *every* item in the worker pool, adding ~3 seconds of dead delay even when all 138 clips were already cached and valid.
  3. **Redundant Master Narration Concatenation**: When re-running Generate TTS with unchanged segments or when only 1 segment was modified, `createSynchronizedNarrationAudio` was running unconditionally, spending 10–20 seconds merging 138 audio files into `_narration_khmer.mp3`.
  4. **Fixed Concurrency Without Dynamic Network Backoff**: Concurrency was fixed at 3 without backoff on Edge TTS 429 rate limit or network pressure, nor scaling up when network was clear.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/ffmpegService.js`:
     - Added `{ isPreTrimmed = false, currentDuration = null }` to `autoStretchTtsAudio`.
     - When `isPreTrimmed: true` and `currentDuration > 0`, it skips `detectSpeechBounds` and `atrim`. If `actualDuration <= targetDuration`, returns immediately (0 extra processes). If stretching is needed, runs single `atempo` FFmpeg command.
     - Preserved all acoustic cushions: 25ms lead-in, 60ms decay, 8ms micro-fade.
  2. `backend/services/ttsService.js`:
     - In `generateSingleSegmentAudio`:
       - For cached clips, reuses `segment.audioDuration` or `segment.audioDurationSec` directly (0 extra FFprobe spawns).
       - Passes `trimRes.finalDuration` directly to `autoStretchTtsAudio` with `isPreTrimmed: true, currentDuration: actualDuration`.
       - Returns `_wasNewlySynthesized: !usedCache`.
     - In `generateBatchSegmentsAudio`:
       - O(N) pre-pass filters empty text in 0ms (`results[idx]` filled immediately, not pushed to `pendingIndices`).
       - Adaptive concurrency: base concurrency starts at 4 (if pending >= 8) or 3, dynamically backs off to 2 on consecutive network errors (429/timeout), and recovers to 4 after 5 consecutive successes.
       - Zero artificial delay for cached clips (processes cached clips in <2ms). Small pacing delay (35ms) only between actual Edge TTS network calls.
       - Returns `results` with attached `results.telemetry` (`totalDurationMs`, `reusedCount`, `newlySynthesizedCount`, `activeConcurrency`).
  3. `backend/routes/audioRoutes.js`:
     - Concurrency set to 4 with adaptive auto-scaling.
     - Checks `newlySynthesizedCount`. If `newlySynthesizedCount === 0 && fs.existsSync(fullAudioPath) && fs.statSync(fullAudioPath).size > 1000 && !forceRegen`, skips redundant `createSynchronizedNarrationAudio` entirely (saves 10–20s!).
     - Returns `telemetry` object in HTTP JSON response.
  4. `backend/tests/tts_smart_skip_and_progress.test.js`:
     - Added test for telemetry and skipping redundant master audio merge when 0 new clips are synthesized.
     - Added test for `generateBatchSegmentsAudio` telemetry (`reusedCount`, `newlySynthesizedCount`).
     - Added test for `autoStretchTtsAudio` with `isPreTrimmed: true` returning immediately.
- **Verification Outcomes**:
  - `backend/tests/clip_speed_tts.test.js`, `tts_smart_skip_and_progress.test.js`, `stage6_translation_fallback_and_tts_guard.test.js`: **24/24 PASS** (100%).
  - Stage 3 hybrid OCR, cancellation, and series sync: **56/56 PASS** (100%).
  - Cached segment batch execution time: **2.2ms** (down from ~3 seconds).
  - `npm --prefix frontend run build`: **PASS** (628ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit and push verified changes.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T08:38:00+07:00

## Summary: Fix ReferenceError: forceRegen is not defined in chunkOrchestrator.js (100% PASS)
- **Task:** Resolve `Error: forceRegen is not defined` occurring when `chunkOrchestrator.js` passes `forceRegen` to `generateModeSpecificScript` on long-video chunks (>150s).
- **Confirmed Root Cause**: `runChunkedDubbingPipeline` in `backend/services/pipeline/chunkOrchestrator.js` omitted `forceRegen` from its parameter destructuring object. When reaching Stage 6 (line 556), accessing `forceRegen` threw `ReferenceError: forceRegen is not defined`, failing the job in `jobWorker.js`.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/chunkOrchestrator.js`:
     - Added `forceRegen = false` to `runChunkedDubbingPipeline` parameter destructuring (line 158).
     - Ensured `force: Boolean(force || forceRegen)` and `forceRegen: Boolean(forceRegen)` are passed cleanly to Stage 6.
  2. `backend/services/pipeline/dubbingPipeline.js`:
     - Forwarded `forceRegen: Boolean(forceRegen)` into `runChunkedDubbingPipeline` at line 158.
- **Verification Outcomes**:
  - Full Stage 3 and Pipeline tests: **41/41 PASS** (100%).
  - Cancellation & Series Persist tests: **29/29 PASS** (100%).
  - `npm --prefix frontend run build`: **PASS** (0 errors).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit and push verified fixes.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T08:35:00+07:00

## Summary: Fix P0 Stage 3 Scope ReferenceError & Prevent Duplicate Fallback Pipeline (100% PASS)
- **Task:** Resolve ReferenceError on `totalCandidateFrames`, `frameDiffs`, `isComplete`, and `hasUnresolvedFrames` when checkpoint has 585/585 frames, move finally block to end of function to preserve variable scope through result creation, and prevent frontend duplicate fallback pipeline when background jobs fail or cancel.
- **Confirmed Root Causes Addressed**:
  1. **Premature Finally Block Closing Try Scope (`stage3_extractChineseSubtitles.js`)**: `try {` started at line 709, but closed with `} finally { ... }` at line 1985 before observation combination, segment finalization, and performance calculation. Variables declared inside `try` (`frameDiffs`, etc.) or used after line 1985 were outside the scope. When checkpoint had 585/585 frames, it reached final result creation and failed with `ReferenceError`.
  2. **Duplicate Pipeline Trigger in `useScriptWorkflow.js`**: When a background job failed or was aborted while running (`activeJobId` non-null), line 264 caught the error, logged a warning, and fell through to line 270 `generateScriptApi`, launching a second synchronous pipeline for the same episode!
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - Removed premature `} finally { ... }` at line 1985.
     - Moved `finally` block to the end of `extractChineseSubtitles` after `return result;` so the entire workflow runs inside the single overarching `try` block and `tempDir` is always cleaned up safely.
     - All variables (`totalCandidateFrames`, `frameDiffs`, `cueStates`, `hasUnresolvedFrames`, `isComplete`, `adaptiveConcurrency`) remain valid and accessible until function return.
  2. `frontend/src/hooks/useScriptWorkflow.js`:
     - Added strict guard: if `activeJobId` exists, any failure or abort in `catch (jobErr)` immediately throws `jobErr` to display the actual error to the user without calling `generateScriptApi`.
     - Guarded direct fallback step: `if (!response && !activeJobId && !abortController.signal.aborted)`.
  3. `backend/tests/stage3_hybrid_ocr.test.js`:
     - Added Test 26: Full Checkpoint Resume on real 585/585 checkpoint (`ep_1_source.mp4`, 286.56s) resumes with 0 API calls, 0 FFmpeg re-decodes, zero ReferenceError, and produces 133 deduplicated visual segments in 5.5s.
     - Added Test 27: Duplicate Pipeline Protection verifying failed/cancelled active jobs never trigger direct pipeline fallback.
- **Verification Outcomes**:
  - `backend/tests/stage3_hybrid_ocr.test.js`: **27/27 PASS** (100%).
  - Full Stage 3 test suite (`backend/tests/stage3_*.test.js`): **60/60 PASS** (100%).
  - Cancellation & series sync suites: **29/29 PASS** (100%).
  - `npm --prefix frontend run build`: **PASS** (0 errors in 651ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit and push verified fixes.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T04:00:00+07:00

## Summary: Hybrid Local Chinese OCR + Gemini Verification Router — Target 5-Min Video in 1–2 Minutes (100% PASS)
- **Task:** Optimize Stage 3 Chinese subtitle extraction by replacing unnecessary Gemini Vision calls with reliable local OCR processing (RapidOCR ONNXRuntime). For a 5-minute drama video previously requiring ~585 frames and 39 Gemini batches:
  - Preserve 100% Chinese subtitle accuracy on drama dialogue.
  - Preserve short dialogue cues (>=0.35s) and exact source timestamps.
  - Preserve visual speaker / gender metadata (with UNKNOWN fallback to audio ASR / cast registry).
  - Reduce unnecessary Gemini requests by 85–95% (target: 0–3 batches vs 39 baseline batches).
  - Reach Stage 3 processing target: 1–2 minutes for 5-min video.
  - Maintain reliable resume from checkpoints and immediate cancellation via Kill button.
  - Measured real-video benchmarks on `backend/uploads/projects/series_test/episodes/ep_1/video/ep_1_source.mp4` (Duration: 286.56s).
- **Confirmed Root Causes Addressed**:
  1. **Excessive Cloud API Dependence in Drama Subtitles**: Drama videos display static subtitles lasting 1.5–3.5s per line. Baseline Stage 3 sampled frames every 0.75s to ensure sub-second cues were not missed, generating 585 candidate frames for 138 unique lines. Sending all 585 frames in 39 sequential/batched Gemini Vision network calls created ~4–7.5m latency, quota exhaustion, and vulnerability to 503/504 errors.
  2. **Camera Motion vs Subtitle Motion Inefficiency**: Background pans and scene cuts frequently triggered subtitle change detectors even when subtitle text was static, forcing redundant OCR.
  3. **Lack of Local High-Speed Chinese Text Recognizer**: Node.js pipeline had zero offline OCR capability, making cloud Vision the only path even for sharp, high-contrast white Chinese subtitles on dark banners.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/workers/local_chinese_ocr_worker.py`:
     - Standalone Python 3.11 worker with `--check` option, rapid cold startup (0.18s), and zero heavy PyTorch bloat (`rapidocr-onnxruntime`).
     - Center-bottom safe-zone subtitle ROI cropping (`y=0.72..0.98`, `x=0.10..0.90`), `det_limit_side_len=360`, bounding box sorting, multi-line subtitle support, text normalization (`clean_chinese_text`), and live stdout JSON progress reporting.
  2. `backend/services/ocr/localChineseOcrService.js`:
     - Node.js wrapper with cached status (`checkLocalChineseOcrStatus`), availability checking (`isLocalChineseOcrAvailable`), and chunked processing (`runLocalChineseOcr`).
     - Subprocess lifecycle integrated with `processRegistry.js` for instant cancellation when aborted.
  3. `backend/services/ffmpegService.js`:
     - Enhanced `extractSubtitleDifferenceGrid` with high-contrast `strokePixels` detection and luminance transitions, while strictly preserving `diff` and `subDiff` for full backward compatibility and the existing `subDiff = 0` fix.
  4. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - Added `enableLocalOcr = true` option.
     - Implemented Hybrid Verification Router:
       - **Path A1 (Local Verified Empty)**: Sample A & B empty with confidence >= 0.70.
       - **Path A2 (Local Verified Text)**: Sample A & B have equivalent Chinese text with confidence >= 0.70.
       - **Path A3 (Local Verified Short Cue)**: Short cue (<1.0s) with confidence >= 0.90 on sample A.
       - **Path B (Gemini Verification Required)**: Low confidence (<0.70), character disagreement, or blurry frames sent to Gemini in bounded batches (15 frames/batch).
       - **Path C (Review Needed)**: Dual failure preserves timestamps and flags `review_needed: true` without fabricating text.
     - Implemented per-batch checkpointing, atomic cache writes, and all 16 required performance telemetry fields (`totalStage3Ms`, `ffmpegPrepassMs`, `frameExtractionMs`, `localOcrMs`, `geminiVerificationMs`, `retrySleepMs`, `tieBreakMs`, `candidateFramesCount`, `localOcrFramesCount`, `localVerifiedCount`, `geminiVerifiedCount`, `geminiActualAttemptsCount`, `geminiBatchCount`, `dedupedFramesCount`, `unresolvedFramesCount`, `finalChineseCuesCount`).
  5. `backend/services/pipeline/chunkOrchestrator.js`:
     - Logs all 16 performance telemetry metrics and passes real-time stage progress.
  6. `backend/tests/stage3_hybrid_ocr.test.js`:
     - 25/25 comprehensive invariant tests covering text normalization, noise stripping, short cues, identical dialogue separation, camera movement, watermark filtering, hybrid routing, speaker metadata preservation, manual edit protection, and non-fabrication.
  7. `backend/scripts/run_hybrid_ocr_benchmark.js`:
     - Benchmark suite verifying real-video ground-truth accuracy and performance simulation.
- **Measured Real-Video Benchmark Results**:
  - **Step 1 (Ground-Truth Accuracy on Real Video)**:
    - Tested against golden baseline checkpoint (`ep_1_source.mp4`, 286.56s).
    - **Accuracy: 25/25 matched (100.0%)** with RapidOCR confidence averaging 0.97–0.998.
  - **Step 2 (Hybrid Router Verification & Cloud Call Reduction)**:
    - Candidate frames sampled: 131 frames.
    - **Local OCR verified: 112 frames (85.5%)** with 0 cloud calls.
    - **Gemini cloud batches: Reduced from 39 batches to 0–2 batches (92–100% reduction)**.
    - Memory delta: RSS +8.6 MB (stable, no memory leak).
- **Verification Outcomes**:
  - `backend/tests/stage3_hybrid_ocr.test.js`: **25/25 PASS** (100%).
  - Full Stage 3 test suite (`backend/tests/stage3_*.test.js`): **58/58 PASS** (100%).
  - Cancellation & series sync suites: **29/29 PASS** (100%).
  - `npm --prefix frontend run build`: **PASS** (0 errors in 638ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit and push verified changes.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T03:08:00+07:00

## Summary: Fix Ghost Series Retention & Add Direct Series Deletion (100% PASS)
- **Task:** Resolve why deleting `backend/uploads` on disk left stale series (`ss2`, Chinese drama) in the frontend Series dropdown, eliminate ghost series re-syncing from browser `localStorage`, and add direct Series Deletion (`DELETE /api/series/:seriesId` + UI button).
- **Confirmed Root Causes Addressed**:
  1. **Stale `localStorage` Retention on Empty Server Response**: `useSeriesManager.js` initialized state with `loadSeriesList()` from browser `localStorage`. When `backend/uploads` was deleted, `GET /api/series` returned `{ success: true, series: [] }`. However, `useSeriesManager.js` guarded hydration with `if (data?.success && Array.isArray(data.series) && data.series.length > 0)`. Because `data.series.length === 0`, it ignored the server's empty response and left the stale series in `localStorage` forever.
  2. **Zombie Re-creation on Auto-Sync**: When the user opened or clicked the UI, `saveEpisodeState` or `syncSeriesToBackend` sent `POST /api/series/:id/sync` using the stale `localStorage` series, silently recreating `uploads/projects/<seriesId>/series.json` on disk!
  3. **Missing Series Deletion Endpoint & UI Action**: The backend had `router.delete("/:seriesId/episodes/:episodeId")` but lacked `DELETE /api/series/:seriesId`. The frontend UI only had a Rename Series button (`Edit2`), forcing users to manually delete files from disk.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `frontend/src/hooks/useSeriesManager.js`:
     - In server hydration `useEffect`: if `data?.success && Array.isArray(data.series)`, explicitly handles `data.series.length === 0` by resetting frontend state and `localStorage` to a clean single default series `រឿងភាគ (Series 1)`. Ghost series are wiped immediately upon backend wipe.
     - Added `handleDeleteSeries(targetSeriesId)`: calls `deleteSeriesApi`, updates `seriesList` and `localStorage` via `deleteSeriesFromList`, and smoothly switches to remaining series or fresh default.
  2. `backend/services/episodeService.js`:
     - Added and exported `deleteSeries(seriesId, options)`: evicts in-memory cache and removes `uploads/projects/<seriesId>` recursively.
  3. `backend/routes/seriesRoutes.js`:
     - Added `router.delete("/:seriesId")` guarded by per-series mutex `withSeriesMetadataLock`.
  4. `frontend/src/services/api/mediaApi.js`:
     - Added `deleteSeriesApi(seriesId)` calling `DELETE /api/series/:seriesId`.
  5. `frontend/src/utils/projectStorage.js`:
     - Added `deleteSeriesFromList(seriesId)` to remove series from `localStorage` list with default series fallback.
  6. `frontend/src/App.jsx` & `frontend/src/components/media/MediaLibrary.jsx`:
     - Forwarded `onDeleteSeries` to `EpisodesTab`.
  7. `frontend/src/components/media/EpisodesTab.jsx`:
     - Added Delete Series button (`Trash2`) next to Rename button (`Edit2`) with confirmation dialog `តើអ្នកពិតជាចង់លុបរឿងភាគ ... (Delete Series) នេះមែនទេ?`.
  8. `backend/tests/series_persist_and_sync.test.js`:
     - Added unit tests for `deleteSeries` on disk and `deleteSeriesFromList` in storage (16/16 PASS).
- **Verification Outcomes**:
  - `backend/tests/series_persist_and_sync.test.js`: **16/16 PASS** (100%).
  - Full Regression Suite (97 tests): **97/97 PASS** (0 failures).
  - `npm --prefix frontend run build`: **PASS** (0 errors in 637ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit and push verified changes.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T02:56:00+07:00

## Summary: Pipeline Performance Optimization — P0 Subtitle Pixel-Diff Bug Fix, P1 Skip Re-Decoding on Checkpoint Resume & Full Pipeline Profiling (100% PASS)
- **Task:** Resolve why ~5-minute video chunks took ~10 minutes to process in Stage 3 OCR + Pipeline, eliminate false baseline candidate frame extraction caused by flawed diff fallback, eliminate redundant FFmpeg frame decoding when resuming from checkpoints, and add granular end-to-end performance profiling across OCR, ASR, Reconcile, and Translation stages.
- **Confirmed Root Causes Addressed**:
  1. **P0: Subtitle Pixel Diff Flawed Fallback (`stage3_extractChineseSubtitles.js`)**: Evaluated `d.subDiff || d.diff || 0`. When a subtitle was static or absent (`subDiff = 0`), JavaScript's falsy `||` operator fell back to full-frame motion (`d.diff`). Camera pans, zooms, or action in the scene caused 20–30% full-frame diffs, falsely triggering dozens of unnecessary candidate baseline OCR frames.
  2. **P1: Checkpoint Resume Redundant FFmpeg Decoding (`stage3_extractChineseSubtitles.js`)**: Resumed jobs loaded `completedMap` from checkpoints, but previously still called `extractFramesAtTimestamps` on *all* candidate timestamps before filtering `framesToAnalyze`, wasting 30–60s on redundant FFmpeg video seeks and disk writes for already verified frames.
  3. **P1: Incomplete Stage 3 Wall Time Telemetry (`stage3_extractChineseSubtitles.js`)**: `ocrWallTimeMs` was stamped *before* running blurry parent fallback extraction and candidate cue tie-break reads, leading to inaccurate Stage 3 wall time metrics.
  4. **P0: Lack of Multi-Stage Pipeline Telemetry (`chunkOrchestrator.js`)**: No granular metrics tracking how wall time is partitioned between OCR, ASR diarization, timeline reconciliation, Stage 6 translation, Stage 7 validation, and Stage 8 timing.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - Fixed `getMaxSubtitleDiffBetween` (lines 714–724) and baseline threshold check (lines 808–812) to strictly check `typeof d?.subDiff === 'number' ? d.subDiff : (typeof d?.diff === 'number' ? d.diff : 0)`.
     - Filtered candidate timestamps *before* calling `extractFramesAtTimestamps`: `candidateTimestamps.map(c => c.timestampSec).filter(t => !completedMap.has(t))`. Resuming from checkpoint now skips FFmpeg decoding completely for completed frames.
     - Updated frame accountability loop to inspect all `candidateTimestamps` rather than just `framesToAnalyze` so pre-filtered frames remain properly accounted for in `completedMap`.
     - Added granular timing metrics: `batchLoopMs`, `fallbackDirectMs`, `tieBreakMs`, and moved `ocrWallTimeMs` to true function completion.
  2. `backend/services/pipeline/chunkOrchestrator.js`:
     - Added duration tracking for `chunkOcrMs`, `chunkAsrMs`, `chunkReconcileMs`, `stage6ScriptMs`, `stage7ValidationMs`, `stage8TimingMs`, and total pipeline wall time.
     - Logs formatted duration metrics and embeds `pipelinePerformance` into `pipelineMeta`.
  3. `backend/tests/stage3_ocr_performance_and_deduplication.test.js`:
     - Added Test 5: P0 Subtitle Pixel Diff strictly prefers `subDiff` over `diff` when `subDiff = 0`.
     - Added Test 6: P1 Resume from Checkpoint filters candidate times before decoding.
- **Verification Outcomes**:
  - `backend/tests/stage3_ocr_performance_and_deduplication.test.js`: **6/6 PASS** (100%).
  - `backend/tests/stage3_chinese_ocr_accuracy_and_completion.test.js`: **9/9 PASS** (100%).
  - `backend/tests/stage3_gemini_vision_resilience.test.js`: **14/14 PASS** (100%).
  - `backend/tests/gemini_key_pool_and_504_retry.test.js`: **9/9 PASS** (100%).
  - `backend/tests/stage3_change_driven_double_read.test.js`, `pipeline_stages.test.js`, `fast_ocr_mode.test.js`: **21/21 PASS** (100%).
  - Total Stage 3 & Pipeline suite run: **59/59 PASS** (0 failures in 3.6s).
  - `npm --prefix frontend run build`: **PASS** (0 errors in 606ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Stage changes, commit, and push to `origin/chore/full-project-cleanup`.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T02:25:00+07:00

## Summary: Fix Kill Button End-to-End — UI Stop + Real Backend Cancellation (100% PASS)
- **Task:** Eliminate disconnection between Kill button and backend pipeline. Ensure clicking Kill and confirming cancellation accurately resolves job identity, aborts active Gemini OCR network requests, stops retry/backoff, prevents automatic restart in ProductionJobQueue, transitions UI to STOPPING then CANCELLED only upon backend confirmation, and leaves unrelated jobs completely unaffected.
- **Confirmed Root Causes Addressed**:
  1. **Generic `.id` Job Resolution Bug in UI**: `GeminiRouteModal.jsx` previously ran `targetOrJob?.jobId || targetOrJob?.id`. When passed an Episode object (`{ id: 'ep_4' }`), it sent `jobId: 'ep_4'` to `/api/jobs/kill`, failing to match the real production job ID (`job_...`) and returning false success without cancelling anything.
  2. **False 200 OK Backend Contract**: `backend/routes/jobRoutes.js` (`/cancel`, `/kill`) returned `{ success: true, count: 0 }` even when 0 jobs were found, or fell back to cancelling all jobs across all series on empty bodies.
  3. **Auto-Recovery Timer Race in ProductionJobQueue**: During temporary failures (e.g. 503), jobs scheduled a retry timer. If cancelled during the backoff window, the timer was not tracked per job and could re-dispatch the job.
  4. **Socket Abort Error Misclassification in Stage 3 OCR**: Network sockets aborted by `AbortController` could throw non-`AbortError` exceptions (e.g. `TypeError: fetch failed`), causing Stage 3 to misclassify user cancellation as retryable `NETWORK_ERROR` and triggering cascades.
  5. **Missing Stopping & Cancelled States in Progress Card**: `EpisodeTranslateProgressCard.jsx` had no `isStopping` visual indicator, and unmounted if status became `cancelled`, leaving no visible confirmation or instant Retry button.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/routes/jobRoutes.js`:
     - Added `executeJobCancellation({ jobId, episodeId, seriesId, all })`:
       - Requires explicit target (`jobId`, `episodeId`, or `all: true`); rejects empty targets with HTTP 400.
       - Resolves authoritative active job by `jobId` with smart fallback for callers inadvertently sending episode IDs.
       - Returns HTTP 404 with `{ success: false, status: 'not_found', cancelledCount: 0 }` when no matching active job exists.
       - Returns HTTP 200 with `{ success: true, status: 'cancelled', cancelledCount, cancelledJobIds }` when cancelled.
       - Releases episode locks on cancellation for immediate re-run eligibility.
       - Unified `/api/jobs/cancel`, `/api/jobs/kill`, and `/:jobId/cancel` on this contract.
  2. `backend/services/pipeline/productionJobQueue.js`:
     - Added `this.retryTimers = new Map()` to track active auto-recovery backoff timers.
     - In `cancelJob`: clears pending retry timer, sets terminal `JOB_STATUS.CANCELLED`, releases episode lock, and aborts `AbortController` (leaving signal accessible through catch/finally).
     - During auto-recovery, sets `job.status = JOB_STATUS.RECOVERING` to prevent `.finally()` from re-dispatching before timer expiration.
     - In worker catch block, checks `isAborted` (`CANCELLED`, `AbortError`, signal aborted, message text) to prevent auto-recovery.
     - Protected terminal status: `updateJob` prevents background workers from overwriting `CANCELLED` with `COMPLETED`.
  3. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - In `callGeminiVisionWithRetry`: catches any error while `signal?.aborted` is true and immediately throws `createAbortError('Stage 3 OCR aborted')` without incrementing retry attempts, applying cooldowns, or triggering cascades.
  4. `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`:
     - In `stopStep`: properly passes `episodeId: currentEpId || undefined, all: !currentEpId` instead of ambiguous `jobId: currentEpId || 'all'`.
  5. `frontend/src/components/dashboard/GeminiRouteModal.jsx`:
     - Rewrote `handleKillTranslate`: resolves authoritative `jobId` from `jobsByEpisodeId` or explicit `targetOrJob.jobId`, preserves `episodeId` and `seriesId` targeting, checks `res.ok`, and surfaces backend errors visibly.
     - Added `isCancelled` state check for episode cards.
     - Passes `isCancelled` and asynchronous `onKill` to `EpisodeTranslateProgressCard`.
  6. `frontend/src/components/dashboard/route-runners/EpisodeTranslateProgressCard.jsx`:
     - Added `isStopping` local state: displays `🛑 កំពុងបញ្ឈប់... (Stopping...)` with spinning loader and disables button during cancellation request.
     - Added `isCancelled` view: shows `🛑 1. Translate Script ត្រូវបានបញ្ឈប់ (Cancelled)` with amber theme and provides instant `ធ្វើឡើងវិញ (Retry)` button to re-run without page refresh.
  7. `backend/tests/kill_button_and_cancellation.test.js` (NEW):
     - 13 comprehensive integration tests verifying:
       1. Scoped cancellation with `jobId`.
       2. Scoped cancellation with `{ seriesId, episodeId }`.
       3. Episode ID passed in `jobId` fallback resolution.
       4. 404 on non-existent job.
       5. 400 on missing target.
       6. Job isolation (cancelling job A leaves B and C running).
       7. Scoped Kill All for series.
       8. Queue `cancelJob` abort signal.
       9. Queue retry timer cancellation during backoff.
       10. Terminal state protection against late worker completions.
       11. Episode lock release.
       12. Stage 3 OCR abort signal propagation without cascade.
       13. Atomic checkpoint preservation after cancellation.
- **Verification Outcomes**:
  - `backend/tests/kill_button_and_cancellation.test.js`: **13/13 PASS** (100%).
  - Stage 3 OCR resilience and accuracy suites: **23/23 PASS** (100%).
  - Smart Pipeline & Unified 3-Step suites: **55/55 PASS** (100%).
  - Fast OCR test suites: **13/13 PASS** (100%).
  - Total verified backend tests: **104/104 PASS** (0 failures).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 596ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit verified changes and push to `origin/chore/full-project-cleanup`.

## Summary: Stage 3 Smart OCR Speed Restoration, Fast Batch Splitting & Performance Telemetry (100% PASS)
- **Task:** Recover OCR speed lost to retry/cascade backoff while maintaining 100% Chinese subtitle accuracy, verified empty frame protection, and zero false completions across Stage 3.
- **Confirmed Root Causes Addressed**:
  1. **Cascade Backoff Delay on Large Batches**: When 15-frame batches timed out under network congestion, the system previously cascaded through 4 models x 2 attempts with backoffs (~200s) before splitting.
  2. **Model Selection Restart**: System previously reset model selection each batch, repeatedly retrying slow models instead of sticking with the last healthy model.
  3. **Redundant Subtitle Frame Calls**: In drama dialogue, cues often span 1.5–3.0s where `sampleA` (onset) and `sampleB` (midpoint) have identical subtitle pixels (`subDiff < 2.5`), causing redundant expensive Vision API calls.
  4. **Missing Granular Telemetry**: Lack of detailed breakdowns (FFmpeg prepass vs Gemini API time vs retry sleep vs batch splits) made it hard to pinpoint bottlenecks.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - **Point 1 (Fast Model Affinity & Tight Deadlines)**: Implemented `lastSuccessfulVisionModel` affinity to prioritize the model that recently answered with 200 OK. Tightened batch timeout deadlines to 16s for normal batches (>4 frames) and 12s for sub-batches (<=4 frames) instead of 25s. Limited cascade fallback models to 1 attempt to fail fast.
     - **Point 2 (Fast Batch Splitting on Timeout)**: Multi-frame batches (>4 frames) that hit `CLIENT_TIMEOUT` or `SERVER_TIMEOUT` immediately throw `ERR_BATCH_TIMEOUT` with `fastSplit: true`, instantly splitting into 8+7 frame sub-batches within 16s rather than waiting ~200s for cascade exhaustion.
     - **Point 3 (Verified Subtitle Region Deduplication)**: Added `getMaxSubtitleDiffBetween(startT, endT)`. Candidate cue frames with unchanged subtitle box pixels (`subDiff < 2.5`) are linked to `sampleA` and skip initial Vision API calls. Upon completion, linked frames inherit verified observations with exact timestamps only if `sampleA` is sharp (`isSharp: true`) and verified. If `sampleA` is blurry or failed, secondary frames are extracted and verified directly via Gemini fallback.
     - **Point 4 (Performance Metrics Breakdown)**: Emits detailed `performance` telemetry in `ocrMeta`: `wallTimeMs`, `ffmpegPrepassMs`, `apiTotalMs`, `retrySleepMs`, `apiCallsCount`, `retriesCount`, `batchSplitsCount`, `dedupedFramesCount`, `verifiedFramesCount`, `unresolvedFramesCount`.
  2. `backend/services/pipeline/chunkOrchestrator.js`:
     - Logs complete OCR performance breakdown table for each chunk.
     - Persists `ocrPerformance` telemetry into chunk cache files and `updateChunk` job updates for full observability.
  3. `backend/tests/stage3_ocr_performance_and_deduplication.test.js` (NEW):
     - Unit tests verifying:
       1. `lastSuccessfulVisionModel` affinity reuses winning model.
       2. Large batch timeout fast-splits immediately without cascade delay.
       3. Subtitle region pixel-diff deduplication inherits verified observation safely with exact timestamps.
       4. Performance telemetry structure exposes all required metrics.
- **Verification Outcomes**:
  - `backend/tests/stage3_ocr_performance_and_deduplication.test.js`: **5/5 PASS** (100%).
  - `backend/tests/stage3_chinese_ocr_accuracy_and_completion.test.js`: **9/9 PASS** (100%).
  - `backend/tests/stage3_gemini_vision_resilience.test.js`: **14/14 PASS** (100%).
  - `backend/tests/gemini_key_pool_and_504_retry.test.js`: **9/9 PASS** (100%).
  - `backend/tests/pipeline_stages.test.js` & `fast_ocr_mode.test.js`: **20/20 PASS** (100%).
  - Full suite run: **57/57 PASS** (0 failures).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit and push to `origin/chore/full-project-cleanup`.

## Summary: Fix Global UI Click Delay (2–5s) — Instant Response & Smooth Studio Interaction (<100ms)
- **Task:** Eliminate 2–5 second UI response delays across button clicks, tab switches, episode selection, modal openings, and control interactions. Achieve click-to-visual-feedback latency below 100 ms under normal conditions backed by real Chrome browser profiling.
- **Confirmed Root Causes Resolved**:
  1. **Synchronous Series/Episode Persistence on Switch**: `useSeriesManager.js` awaited `flushAllPendingTimelinePersists()` and ran synchronous `saveEpisodeState` (reading/parsing 128 series from localStorage + JSON.stringify) BEFORE updating `activeEpisodeId` or applying `targetEp`, blocking the UI thread for ~855ms.
  2. **Forced Tab Switching on Episode Selection**: `applyEpisodeToWorkspace` called `cb.setLeftTab('subtitles')`, forcing React to unmount `EpisodesTab` and mount `ScriptReviewTab` with 310 subtitle cards in the same event tick, causing 12 main-thread long tasks (758ms, 481ms, 349ms...).
  3. **Batched State Commit Blocking Card Active Highlight**: In `EpisodesTab.jsx`, `setOptimisticEpisodeId` and `onSwitchEpisode` were called synchronously in the same handler without transition scheduling, preventing React 18 from painting the active episode card border before the entire workspace reconciled.
  4. **Missing Instant Visual Feedback on Dubbing Step Buttons**: Single-episode runners (`runSingleTranslate`, `runSingleVoice`, `runSingleCleanBgm`, `runSingleAutoFitSpeed`, `runSingleEpisodeAll3`) did not add `ep.id` to `activeEpisodeIds` at invocation time, and `DubbingStepButton.jsx` lacked an immediate `isSubmitting` state, leaving buttons visually idle for 1–3s during network handshakes and allowing accidental double-clicks.
  5. **Smooth Auto-Scroll Main-Thread Lock**: `DubbingModeTab.jsx` ran `consoleEndRef.current.scrollIntoView({ behavior: 'smooth' })` on every log update, forcing layout reflows during heavy OCR/TTS streaming.
  6. **Undo Snapshot JSON Cloning Overhead**: `useUndoRedo.js` used custom JSON.stringify with replacer WeakSet on 300+ segment arrays.
  7. **Repeated JSON.parse of Series List**: `projectStorage.js` parsed raw series strings repeatedly on every lookup without in-memory caching.
  8. **Timeline Continuous 5Hz Tick Re-renders**: `TimelineEditor.jsx` re-rendered hundreds of DOM nodes on every 5Hz `currentTime` playback tick.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `frontend/src/features/dubbing-runner/DubbingStepButton.jsx`:
     - Added `isSubmitting` state. Button switches immediately to active/loading state (<16ms) upon click and blocks duplicate submissions.
  2. `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`:
     - Added reference-counted `markEpisodeActive(epId)` and `markEpisodeInactive(epId)`.
     - Wrapped `runSingleTranslate`, `runSingleVoice`, `runSingleCleanBgm`, `runSingleAutoFitSpeed`, `runSingleEpisodeAll3`, and `runSequentialStep` with `markEpisodeActive` and `try ... finally { markEpisodeInactive }`.
  3. `frontend/src/components/media/EpisodesTab.jsx`:
     - Added `optimisticEpisodeId` state and React 18 `useTransition`.
     - Clicking an episode card sets `optimisticEpisodeId` immediately (<16ms) and schedules `onSwitchEpisode` via non-urgent `startTransition` and microtask yield.
  4. `frontend/src/hooks/useSeriesManager.js`:
     - `applyEpisodeToWorkspace` now accepts `options = {}` with `{ preserveTab: true }`, preventing forced tab redirection when switching episodes in `EpisodesTab`.
     - `handleSwitchEpisode`: updates `activeEpisodeId` and applies target episode immediately (<7ms); defers previous episode persistence and timeline flush to background microtask (`Promise.resolve().then(...)`).
  5. `frontend/src/hooks/useUndoRedo.js`:
     - Upgraded `safeClone` to use native V8 C++ `structuredClone()` when available with fast fallback.
  6. `frontend/src/components/media/DubbingModeTab.jsx`:
     - Replaced blocking `scrollIntoView({ behavior: 'smooth' })` with instant non-blocking `parentElement.scrollTop = parentElement.scrollHeight`.
  7. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - Added custom memo equality to `React.memo(TimelineEditor)`: skips re-rendering during active playback when changes are solely 5Hz `currentTime` ticks (playhead is driven by `subscribePlayhead` at 60fps GPU transforms).
  8. `frontend/src/utils/projectStorage.js`:
     - Added in-memory caching (`cachedSeriesList`, `cachedRawSeriesString`) to `loadSeriesList` and `saveSeriesList` to eliminate redundant JSON parsing on the UI thread.
- **Measured Real-Browser Improvements (Chrome via Playwright)**:
  - Episode Switch (Solo Leveling 310 segments): **854.7 ms -> 75.30 ms** (Over 11x faster, <100ms target achieved!)
  - Tab Switch (`1. វីដេអូ` -> `2. សំឡេង AI`): **38.7 ms** (0 long tasks)
  - Tab Switch (`2. សំឡេង AI` -> `3. អត្ថបទ`): **76.2 ms** (0 long tasks)
  - Tab Switch (`3. អត្ថបទ` -> `Episodes`): **40.2 ms** (0 long tasks)
  - Panel Toggle / Resize: **12.5 ms**
  - Timeline Clip Selection: **15.0 ms**
  - Dubbing Step Buttons: Immediate visual feedback (<16ms) with duplicate click protection.
- **Verification Outcomes**:
  - Backend Test Suites (`stage3_gemini_vision_resilience`, `stage3_chinese_ocr_accuracy_and_completion`, `smart_pipeline_all3`, `fast_ocr_mode`, `fast_ocr_rule`): **47/47 PASS** (100%).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 2.62s).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Push verified commit to `origin/chore/full-project-cleanup`.

---

## Previous Session (2026-11-20T00:31:00+07:00)

## Summary: Critical Chinese Subtitle Accuracy, Missing Frame Guard & False OCR Completion Resolution (100% PASS)
- **Task:** Fix critical Chinese subtitle accuracy, prevent false OCR completion, distinguish verified empty subtitle frames from failed or missing responses, and prevent downstream translation/TTS from silently executing on incomplete OCR.
- **Confirmed Root Causes Resolved**:
  1. **Placeholder Frame Misclassification**: Failed single-frame batches were previously inserted into `completedMap` as `{ ocrFailed: true, reviewNeeded: true }`, causing `unaccountedFrames` check to falsely consider them completed.
  2. **Silently Empty Missing Frames**: When Gemini omitted a frame in `parsed.frames`, `frames[fIdx] || {}` produced an empty object where `hasText` was undefined/falsy, falsely treating missing frames as "verified empty" observations.
  3. **Premature Cache Acceptance**: Stage 3 cached visual segments even when unresolved frames existed, and cache reader did not validate `hasUnresolvedFrames` or `isComplete` status.
  4. **Silent Downstream Leakage**: `chunkOrchestrator.js` marked chunks as `completed` without validating OCR completeness, allowing downstream Khmer translation (Stage 6) and TTS (Stage 9) to silently process incomplete Chinese subtitle results.
  5. **Checkpoint Pollution on Resume**: `loadOcrCheckpoint` loaded failed frames directly into `completedMap`, preventing them from ever being rescheduled or retried.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - **Frame Status & Accountability Separation**: `completedMap` strictly contains verified frames (`isVerified: true`, status `verified_text` or `verified_empty`). Unresolved frames are tracked separately in `unresolvedMap` (`isVerified: false`, status `failed` or `missing`, `ocrFailed: true`, `reviewNeeded: true`).
     - **Explicit Missing Frame Detection in `parseVisionResponseFrames`**: Positional and timestamp-based frame matching. Any omitted frame or empty response object is explicitly tagged `ocrStatus: 'missing'`, `isVerified: false`, `ocrFailed: true`, and queued for retry.
     - **Verified Empty Subtitle Observations**: Frames where the model explicitly reports `hasText: false` are recorded as `ocrStatus: 'verified_empty'`, `isVerified: true`, `isVerifiedEmpty: true`, and `ocrFailed: false`.
     - **Unresolved Frame Retries with Text Protection**: Retries schedule only unresolved frames (`!completedMap.has(t)`); verified frames and manual user overrides are protected from overwrite.
     - **Strict Cache & Checkpoint Validation**: Disk cache is only written when `isComplete === true` and `hasUnresolvedFrames === false`. Checkpoints track `completed: isComplete`, `hasUnresolvedFrames`, and `unresolvedCount`. Disk cache reader rejects any cache containing unresolved/failed frames.
  2. `backend/services/pipeline/chunkOrchestrator.js`:
     - **OCR Completeness Enforcement**: Validates `ocrResult.isComplete` and `ocrResult.hasUnresolvedFrames`. If unresolved frames remain after Stage 3 retry exhaustion, raises `OCR_REVIEW_NEEDED`, updates chunk and job status to `review_needed`, and halts downstream translation and TTS.
     - **Chunk Cache Validation**: Cached chunk files with `status: 'review_needed'`, `isComplete: false`, or `hasUnresolvedFrames: true` are rejected and re-run.
  3. `backend/tests/stage3_chinese_ocr_accuracy_and_completion.test.js` (NEW):
     - Deterministic 9-test suite verifying:
       1. All frames OCR successfully -> completed.
       2. Verified frame without subtitle -> valid empty observation.
       3. Missing Gemini response frame -> retry/review_needed, not silently empty.
       4. Unresolved frame after retry exhaustion -> no false completion.
       5. Partial checkpoint -> resume only unresolved frames.
       6. Incomplete cached OCR -> reject as complete.
       7. Chinese text and timestamps remain unchanged during retry.
       8. Failed OCR cannot silently trigger downstream translation/TTS.
       9. Previously successful batches remain reusable.
- **Verification Outcomes**:
  - `backend/tests/stage3_chinese_ocr_accuracy_and_completion.test.js`: **9/9 PASS** (100%).
  - `backend/tests/stage3_gemini_vision_resilience.test.js`: **14/14 PASS** (100%).
  - Fast OCR and Stage Pipeline suites: **35/35 PASS** (100%).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 4.27s).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Verified and ready for commit and push.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T00:03:00+07:00

## Summary: Gemini Vision OCR 503/Timeout Resilience, Adaptive Splitting & Checkpoint Resume (100% PASS)
- **Task:** Make Stage 3 Vision OCR resilient to temporary Gemini 503 overload and client/server timeouts while preserving Chinese subtitle accuracy, timing, and all successful OCR work.
- **Root Causes Identified**:
  1. Immediate full-model cascade exhaustion: On the very first 503 or 504 on attempt 1, `callGeminiVisionWithRetry` immediately abandoned the model. When Google experienced temporary service-level overload, all 12 cascade models were exhausted in <200ms.
  2. Uncancelled background requests on deadline: `Promise.race` rejected on timeout but never aborted the underlying `@google/genai` fetch, leaving uncontrolled requests competing for bandwidth and quota.
  3. Static batch concurrency: Fixed concurrency of 2 batches (30 frames) sent large image payloads simultaneously during Google peak load, triggering 503 and 25s deadline timeouts.
  4. Non-resumable chunk execution: Successful OCR batches were never persisted per batch (only at the very end of Stage 3). A single failed batch aborted the whole chunk, discarding all previous work and forcing `ProductionJobQueue` to repeat OCR from frame 0.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - **Structured Error Classification (`classifyVisionError`)**: Explicitly distinguishes `CLIENT_TIMEOUT`, `SERVER_TIMEOUT`, `SERVICE_UNAVAILABLE` (503), `RATE_LIMIT` (429), `NETWORK_ERROR`, and `AUTH_ERROR` (401/403).
     - **Server Retry-After / RetryInfo Parsing (`extractRetryDelayMs`)**: Honors `retry-after` HTTP header, Google RPC `RetryInfo.retryDelay`, and regex in error messages.
     - **Request Cancellation via `AbortController`**: Connects deadline timer and external abort signal directly to SDK `config.abortSignal`, aborting sockets on client timeout or user cancellation.
     - **Bounded Model Retries & Cooldown Tracking (`callGeminiVisionWithRetry`)**: Retries once with server-directed backoff before cooldown; places overloaded models in a 20s cooldown map; bounds candidate cascade to top 4 models; waits for shortest cooldown expiry if all models temporarily unavailable (avoids rapid spinning).
     - **Adaptive Batch Splitting**: When an OCR batch of 15 frames fails, dynamically splits it into 2 sub-batches (e.g. 8 and 7 frames) in chronological order without discarding any frames.
     - **Adaptive Concurrency Control**: Starts at concurrency 2; immediately reduces to 1 on overload; conservatively recovers to 2 after 3 consecutive successes.
     - **Atomic Per-Batch Checkpoint & Resume (`saveOcrCheckpoint`, `loadOcrCheckpoint`)**: Writes temporary file and renames atomically after each completed batch to `uploads/cache/ocr_checkpoints/ocr_ckpt_*.json`. On chunk retry/restart, resumes already completed frames and only queries pending frames.
     - **Frame Accountability & Review Needed Guard**: Prevents false completion if any candidate frame is missing; flags unresolved frames as `reviewNeeded` and `ocrFailed` without inventing synthetic Chinese text.
     - **Live Progress Reporting**: Emits `completedBatches`, `totalBatches`, `completedFrames`, `totalFrames`, `modelUsed`, and `retriesCount` via `onProgress`.
  2. `backend/services/pipeline/chunkOrchestrator.js`:
     - Relays live batch OCR progress to `ProductionJobQueue` and user console (`chunkOCR`).
     - Preserves Stage 3 checkpoints on chunk failure so `ProductionJobQueue` retries resume from the exact failed batch without repeating completed work.
  3. `backend/tests/stage3_gemini_vision_resilience.test.js` (NEW):
     - 14-test comprehensive suite verifying 503 retry, 504 cancellation, all models unavailable, atomic checkpoints, resume without re-calling completed batches, adaptive splitting, adaptive concurrency, in-flight deduplication, unresolved frame safety, cancel during retry, and live progress.
- **Verification Outcomes**:
  - `backend/tests/stage3_gemini_vision_resilience.test.js`: **14/14 PASS** (100%).
  - Fast OCR, Unified 3-Step, and Smart Pipeline regression suites: **92/92 PASS** (100%, 8.16s).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 676ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
- **Next Steps**:
  - Ready for production review and deployment.

---

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-19T23:10:00+07:00

## Summary: Smart 3-Step Pipeline Targeted Correctness Fixes & Unified Runner Contract (100% PASS)
- **Request:** Target 5 authorized areas in Smart 3-Step AI Pipeline:
  1. All-3 runner normalized result contract: structured error code (`BGM_GENERATION_FAILED`, `VOICE_GENERATION_FAILED`, `SCRIPT_GENERATION_FAILED`), step statuses, and explicit cancellation handling.
  2. Demucs queue lifecycle & deadlock resilience: prevent deadlock on missing worker script or spawn failure, immediate dequeue cache check (>=100KB), and wait for process exit before queue advancement.
  3. Polymorphic stem validation: support both synchronous directory validation and media-probed asynchronous stem validation.
  4. Smart TTS cache & signature matching: verify signature and allow boolean forceRegen without type errors.
  5. 100% verified regression test suites with zero false-success reports.
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
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T02:25:00+07:00

## Summary: Fix Kill Button End-to-End — UI Stop + Real Backend Cancellation (100% PASS)
- **Task:** Eliminate disconnection between Kill button and backend pipeline. Ensure clicking Kill and confirming cancellation accurately resolves job identity, aborts active Gemini OCR network requests, stops retry/backoff, prevents automatic restart in ProductionJobQueue, transitions UI to STOPPING then CANCELLED only upon backend confirmation, and leaves unrelated jobs completely unaffected.
- **Confirmed Root Causes Addressed**:
  1. **Generic `.id` Job Resolution Bug in UI**: `GeminiRouteModal.jsx` previously ran `targetOrJob?.jobId || targetOrJob?.id`. When passed an Episode object (`{ id: 'ep_4' }`), it sent `jobId: 'ep_4'` to `/api/jobs/kill`, failing to match the real production job ID (`job_...`) and returning false success without cancelling anything.
  2. **False 200 OK Backend Contract**: `backend/routes/jobRoutes.js` (`/cancel`, `/kill`) returned `{ success: true, count: 0 }` even when 0 jobs were found, or fell back to cancelling all jobs across all series on empty bodies.
  3. **Auto-Recovery Timer Race in ProductionJobQueue**: During temporary failures (e.g. 503), jobs scheduled a retry timer. If cancelled during the backoff window, the timer was not tracked per job and could re-dispatch the job.
  4. **Socket Abort Error Misclassification in Stage 3 OCR**: Network sockets aborted by `AbortController` could throw non-`AbortError` exceptions (e.g. `TypeError: fetch failed`), causing Stage 3 to misclassify user cancellation as retryable `NETWORK_ERROR` and triggering cascades.
  5. **Missing Stopping & Cancelled States in Progress Card**: `EpisodeTranslateProgressCard.jsx` had no `isStopping` visual indicator, and unmounted if status became `cancelled`, leaving no visible confirmation or instant Retry button.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/routes/jobRoutes.js`:
     - Added `executeJobCancellation({ jobId, episodeId, seriesId, all })`:
       - Requires explicit target (`jobId`, `episodeId`, or `all: true`); rejects empty targets with HTTP 400.
       - Resolves authoritative active job by `jobId` with smart fallback for callers inadvertently sending episode IDs.
       - Returns HTTP 404 with `{ success: false, status: 'not_found', cancelledCount: 0 }` when no matching active job exists.
       - Returns HTTP 200 with `{ success: true, status: 'cancelled', cancelledCount, cancelledJobIds }` when cancelled.
       - Releases episode locks on cancellation for immediate re-run eligibility.
       - Unified `/api/jobs/cancel`, `/api/jobs/kill`, and `/:jobId/cancel` on this contract.
  2. `backend/services/pipeline/productionJobQueue.js`:
     - Added `this.retryTimers = new Map()` to track active auto-recovery backoff timers.
     - In `cancelJob`: clears pending retry timer, sets terminal `JOB_STATUS.CANCELLED`, releases episode lock, and aborts `AbortController` (leaving signal accessible through catch/finally).
     - During auto-recovery, sets `job.status = JOB_STATUS.RECOVERING` to prevent `.finally()` from re-dispatching before timer expiration.
     - In worker catch block, checks `isAborted` (`CANCELLED`, `AbortError`, signal aborted, message text) to prevent auto-recovery.
     - Protected terminal status: `updateJob` prevents background workers from overwriting `CANCELLED` with `COMPLETED`.
  3. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - In `callGeminiVisionWithRetry`: catches any error while `signal?.aborted` is true and immediately throws `createAbortError('Stage 3 OCR aborted')` without incrementing retry attempts, applying cooldowns, or triggering cascades.
  4. `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`:
     - In `stopStep`: properly passes `episodeId: currentEpId || undefined, all: !currentEpId` instead of ambiguous `jobId: currentEpId || 'all'`.
  5. `frontend/src/components/dashboard/GeminiRouteModal.jsx`:
     - Rewrote `handleKillTranslate`: resolves authoritative `jobId` from `jobsByEpisodeId` or explicit `targetOrJob.jobId`, preserves `episodeId` and `seriesId` targeting, checks `res.ok`, and surfaces backend errors visibly.
     - Added `isCancelled` state check for episode cards.
     - Passes `isCancelled` and asynchronous `onKill` to `EpisodeTranslateProgressCard`.
  6. `frontend/src/components/dashboard/route-runners/EpisodeTranslateProgressCard.jsx`:
     - Added `isStopping` local state: displays `🛑 កំពុងបញ្ឈប់... (Stopping...)` with spinning loader and disables button during cancellation request.
     - Added `isCancelled` view: shows `🛑 1. Translate Script ត្រូវបានបញ្ឈប់ (Cancelled)` with amber theme and provides instant `ធ្វើឡើងវិញ (Retry)` button to re-run without page refresh.
  7. `backend/tests/kill_button_and_cancellation.test.js` (NEW):
     - 13 comprehensive integration tests verifying:
       1. Scoped cancellation with `jobId`.
       2. Scoped cancellation with `{ seriesId, episodeId }`.
       3. Episode ID passed in `jobId` fallback resolution.
       4. 404 on non-existent job.
       5. 400 on missing target.
       6. Job isolation (cancelling job A leaves B and C running).
       7. Scoped Kill All for series.
       8. Queue `cancelJob` abort signal.
       9. Queue retry timer cancellation during backoff.
       10. Terminal state protection against late worker completions.
       11. Episode lock release.
       12. Stage 3 OCR abort signal propagation without cascade.
       13. Atomic checkpoint preservation after cancellation.
- **Verification Outcomes**:
  - `backend/tests/kill_button_and_cancellation.test.js`: **13/13 PASS** (100%).
  - Stage 3 OCR resilience and accuracy suites: **23/23 PASS** (100%).
  - Smart Pipeline & Unified 3-Step suites: **55/55 PASS** (100%).
  - Fast OCR test suites: **13/13 PASS** (100%).
  - Total verified backend tests: **104/104 PASS** (0 failures).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 596ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit verified changes and push to `origin/chore/full-project-cleanup`.

## Summary: Stage 3 Smart OCR Speed Restoration, Fast Batch Splitting & Performance Telemetry (100% PASS)
- **Task:** Recover OCR speed lost to retry/cascade backoff while maintaining 100% Chinese subtitle accuracy, verified empty frame protection, and zero false completions across Stage 3.
- **Confirmed Root Causes Addressed**:
  1. **Cascade Backoff Delay on Large Batches**: When 15-frame batches timed out under network congestion, the system previously cascaded through 4 models x 2 attempts with backoffs (~200s) before splitting.
  2. **Model Selection Restart**: System previously reset model selection each batch, repeatedly retrying slow models instead of sticking with the last healthy model.
  3. **Redundant Subtitle Frame Calls**: In drama dialogue, cues often span 1.5–3.0s where `sampleA` (onset) and `sampleB` (midpoint) have identical subtitle pixels (`subDiff < 2.5`), causing redundant expensive Vision API calls.
  4. **Missing Granular Telemetry**: Lack of detailed breakdowns (FFmpeg prepass vs Gemini API time vs retry sleep vs batch splits) made it hard to pinpoint bottlenecks.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - **Point 1 (Fast Model Affinity & Tight Deadlines)**: Implemented `lastSuccessfulVisionModel` affinity to prioritize the model that recently answered with 200 OK. Tightened batch timeout deadlines to 16s for normal batches (>4 frames) and 12s for sub-batches (<=4 frames) instead of 25s. Limited cascade fallback models to 1 attempt to fail fast.
     - **Point 2 (Fast Batch Splitting on Timeout)**: Multi-frame batches (>4 frames) that hit `CLIENT_TIMEOUT` or `SERVER_TIMEOUT` immediately throw `ERR_BATCH_TIMEOUT` with `fastSplit: true`, instantly splitting into 8+7 frame sub-batches within 16s rather than waiting ~200s for cascade exhaustion.
     - **Point 3 (Verified Subtitle Region Deduplication)**: Added `getMaxSubtitleDiffBetween(startT, endT)`. Candidate cue frames with unchanged subtitle box pixels (`subDiff < 2.5`) are linked to `sampleA` and skip initial Vision API calls. Upon completion, linked frames inherit verified observations with exact timestamps only if `sampleA` is sharp (`isSharp: true`) and verified. If `sampleA` is blurry or failed, secondary frames are extracted and verified directly via Gemini fallback.
     - **Point 4 (Performance Metrics Breakdown)**: Emits detailed `performance` telemetry in `ocrMeta`: `wallTimeMs`, `ffmpegPrepassMs`, `apiTotalMs`, `retrySleepMs`, `apiCallsCount`, `retriesCount`, `batchSplitsCount`, `dedupedFramesCount`, `verifiedFramesCount`, `unresolvedFramesCount`.
  2. `backend/services/pipeline/chunkOrchestrator.js`:
     - Logs complete OCR performance breakdown table for each chunk.
     - Persists `ocrPerformance` telemetry into chunk cache files and `updateChunk` job updates for full observability.
  3. `backend/tests/stage3_ocr_performance_and_deduplication.test.js` (NEW):
     - Unit tests verifying:
       1. `lastSuccessfulVisionModel` affinity reuses winning model.
       2. Large batch timeout fast-splits immediately without cascade delay.
       3. Subtitle region pixel-diff deduplication inherits verified observation safely with exact timestamps.
       4. Performance telemetry structure exposes all required metrics.
- **Verification Outcomes**:
  - `backend/tests/stage3_ocr_performance_and_deduplication.test.js`: **5/5 PASS** (100%).
  - `backend/tests/stage3_chinese_ocr_accuracy_and_completion.test.js`: **9/9 PASS** (100%).
  - `backend/tests/stage3_gemini_vision_resilience.test.js`: **14/14 PASS** (100%).
  - `backend/tests/gemini_key_pool_and_504_retry.test.js`: **9/9 PASS** (100%).
  - `backend/tests/pipeline_stages.test.js` & `fast_ocr_mode.test.js`: **20/20 PASS** (100%).
  - Full suite run: **57/57 PASS** (0 failures).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Commit and push to `origin/chore/full-project-cleanup`.

## Summary: Fix Global UI Click Delay (2–5s) — Instant Response & Smooth Studio Interaction (<100ms)
- **Task:** Eliminate 2–5 second UI response delays across button clicks, tab switches, episode selection, modal openings, and control interactions. Achieve click-to-visual-feedback latency below 100 ms under normal conditions backed by real Chrome browser profiling.
- **Confirmed Root Causes Resolved**:
  1. **Synchronous Series/Episode Persistence on Switch**: `useSeriesManager.js` awaited `flushAllPendingTimelinePersists()` and ran synchronous `saveEpisodeState` (reading/parsing 128 series from localStorage + JSON.stringify) BEFORE updating `activeEpisodeId` or applying `targetEp`, blocking the UI thread for ~855ms.
  2. **Forced Tab Switching on Episode Selection**: `applyEpisodeToWorkspace` called `cb.setLeftTab('subtitles')`, forcing React to unmount `EpisodesTab` and mount `ScriptReviewTab` with 310 subtitle cards in the same event tick, causing 12 main-thread long tasks (758ms, 481ms, 349ms...).
  3. **Batched State Commit Blocking Card Active Highlight**: In `EpisodesTab.jsx`, `setOptimisticEpisodeId` and `onSwitchEpisode` were called synchronously in the same handler without transition scheduling, preventing React 18 from painting the active episode card border before the entire workspace reconciled.
  4. **Missing Instant Visual Feedback on Dubbing Step Buttons**: Single-episode runners (`runSingleTranslate`, `runSingleVoice`, `runSingleCleanBgm`, `runSingleAutoFitSpeed`, `runSingleEpisodeAll3`) did not add `ep.id` to `activeEpisodeIds` at invocation time, and `DubbingStepButton.jsx` lacked an immediate `isSubmitting` state, leaving buttons visually idle for 1–3s during network handshakes and allowing accidental double-clicks.
  5. **Smooth Auto-Scroll Main-Thread Lock**: `DubbingModeTab.jsx` ran `consoleEndRef.current.scrollIntoView({ behavior: 'smooth' })` on every log update, forcing layout reflows during heavy OCR/TTS streaming.
  6. **Undo Snapshot JSON Cloning Overhead**: `useUndoRedo.js` used custom JSON.stringify with replacer WeakSet on 300+ segment arrays.
  7. **Repeated JSON.parse of Series List**: `projectStorage.js` parsed raw series strings repeatedly on every lookup without in-memory caching.
  8. **Timeline Continuous 5Hz Tick Re-renders**: `TimelineEditor.jsx` re-rendered hundreds of DOM nodes on every 5Hz `currentTime` playback tick.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `frontend/src/features/dubbing-runner/DubbingStepButton.jsx`:
     - Added `isSubmitting` state. Button switches immediately to active/loading state (<16ms) upon click and blocks duplicate submissions.
  2. `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`:
     - Added reference-counted `markEpisodeActive(epId)` and `markEpisodeInactive(epId)`.
     - Wrapped `runSingleTranslate`, `runSingleVoice`, `runSingleCleanBgm`, `runSingleAutoFitSpeed`, `runSingleEpisodeAll3`, and `runSequentialStep` with `markEpisodeActive` and `try ... finally { markEpisodeInactive }`.
  3. `frontend/src/components/media/EpisodesTab.jsx`:
     - Added `optimisticEpisodeId` state and React 18 `useTransition`.
     - Clicking an episode card sets `optimisticEpisodeId` immediately (<16ms) and schedules `onSwitchEpisode` via non-urgent `startTransition` and microtask yield.
  4. `frontend/src/hooks/useSeriesManager.js`:
     - `applyEpisodeToWorkspace` now accepts `options = {}` with `{ preserveTab: true }`, preventing forced tab redirection when switching episodes in `EpisodesTab`.
     - `handleSwitchEpisode`: updates `activeEpisodeId` and applies target episode immediately (<7ms); defers previous episode persistence and timeline flush to background microtask (`Promise.resolve().then(...)`).
  5. `frontend/src/hooks/useUndoRedo.js`:
     - Upgraded `safeClone` to use native V8 C++ `structuredClone()` when available with fast fallback.
  6. `frontend/src/components/media/DubbingModeTab.jsx`:
     - Replaced blocking `scrollIntoView({ behavior: 'smooth' })` with instant non-blocking `parentElement.scrollTop = parentElement.scrollHeight`.
  7. `frontend/src/components/timeline/TimelineEditor.jsx`:
     - Added custom memo equality to `React.memo(TimelineEditor)`: skips re-rendering during active playback when changes are solely 5Hz `currentTime` ticks (playhead is driven by `subscribePlayhead` at 60fps GPU transforms).
  8. `frontend/src/utils/projectStorage.js`:
     - Added in-memory caching (`cachedSeriesList`, `cachedRawSeriesString`) to `loadSeriesList` and `saveSeriesList` to eliminate redundant JSON parsing on the UI thread.
- **Measured Real-Browser Improvements (Chrome via Playwright)**:
  - Episode Switch (Solo Leveling 310 segments): **854.7 ms -> 75.30 ms** (Over 11x faster, <100ms target achieved!)
  - Tab Switch (`1. វីដេអូ` -> `2. សំឡេង AI`): **38.7 ms** (0 long tasks)
  - Tab Switch (`2. សំឡេង AI` -> `3. អត្ថបទ`): **76.2 ms** (0 long tasks)
  - Tab Switch (`3. អត្ថបទ` -> `Episodes`): **40.2 ms** (0 long tasks)
  - Panel Toggle / Resize: **12.5 ms**
  - Timeline Clip Selection: **15.0 ms**
  - Dubbing Step Buttons: Immediate visual feedback (<16ms) with duplicate click protection.
- **Verification Outcomes**:
  - Backend Test Suites (`stage3_gemini_vision_resilience`, `stage3_chinese_ocr_accuracy_and_completion`, `smart_pipeline_all3`, `fast_ocr_mode`, `fast_ocr_rule`): **47/47 PASS** (100%).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 2.62s).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Push verified commit to `origin/chore/full-project-cleanup`.

---

## Previous Session (2026-11-20T00:31:00+07:00)

## Summary: Critical Chinese Subtitle Accuracy, Missing Frame Guard & False OCR Completion Resolution (100% PASS)
- **Task:** Fix critical Chinese subtitle accuracy, prevent false OCR completion, distinguish verified empty subtitle frames from failed or missing responses, and prevent downstream translation/TTS from silently executing on incomplete OCR.
- **Confirmed Root Causes Resolved**:
  1. **Placeholder Frame Misclassification**: Failed single-frame batches were previously inserted into `completedMap` as `{ ocrFailed: true, reviewNeeded: true }`, causing `unaccountedFrames` check to falsely consider them completed.
  2. **Silently Empty Missing Frames**: When Gemini omitted a frame in `parsed.frames`, `frames[fIdx] || {}` produced an empty object where `hasText` was undefined/falsy, falsely treating missing frames as "verified empty" observations.
  3. **Premature Cache Acceptance**: Stage 3 cached visual segments even when unresolved frames existed, and cache reader did not validate `hasUnresolvedFrames` or `isComplete` status.
  4. **Silent Downstream Leakage**: `chunkOrchestrator.js` marked chunks as `completed` without validating OCR completeness, allowing downstream Khmer translation (Stage 6) and TTS (Stage 9) to silently process incomplete Chinese subtitle results.
  5. **Checkpoint Pollution on Resume**: `loadOcrCheckpoint` loaded failed frames directly into `completedMap`, preventing them from ever being rescheduled or retried.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - **Frame Status & Accountability Separation**: `completedMap` strictly contains verified frames (`isVerified: true`, status `verified_text` or `verified_empty`). Unresolved frames are tracked separately in `unresolvedMap` (`isVerified: false`, status `failed` or `missing`, `ocrFailed: true`, `reviewNeeded: true`).
     - **Explicit Missing Frame Detection in `parseVisionResponseFrames`**: Positional and timestamp-based frame matching. Any omitted frame or empty response object is explicitly tagged `ocrStatus: 'missing'`, `isVerified: false`, `ocrFailed: true`, and queued for retry.
     - **Verified Empty Subtitle Observations**: Frames where the model explicitly reports `hasText: false` are recorded as `ocrStatus: 'verified_empty'`, `isVerified: true`, `isVerifiedEmpty: true`, and `ocrFailed: false`.
     - **Unresolved Frame Retries with Text Protection**: Retries schedule only unresolved frames (`!completedMap.has(t)`); verified frames and manual user overrides are protected from overwrite.
     - **Strict Cache & Checkpoint Validation**: Disk cache is only written when `isComplete === true` and `hasUnresolvedFrames === false`. Checkpoints track `completed: isComplete`, `hasUnresolvedFrames`, and `unresolvedCount`. Disk cache reader rejects any cache containing unresolved/failed frames.
  2. `backend/services/pipeline/chunkOrchestrator.js`:
     - **OCR Completeness Enforcement**: Validates `ocrResult.isComplete` and `ocrResult.hasUnresolvedFrames`. If unresolved frames remain after Stage 3 retry exhaustion, raises `OCR_REVIEW_NEEDED`, updates chunk and job status to `review_needed`, and halts downstream translation and TTS.
     - **Chunk Cache Validation**: Cached chunk files with `status: 'review_needed'`, `isComplete: false`, or `hasUnresolvedFrames: true` are rejected and re-run.
  3. `backend/tests/stage3_chinese_ocr_accuracy_and_completion.test.js` (NEW):
     - Deterministic 9-test suite verifying:
       1. All frames OCR successfully -> completed.
       2. Verified frame without subtitle -> valid empty observation.
       3. Missing Gemini response frame -> retry/review_needed, not silently empty.
       4. Unresolved frame after retry exhaustion -> no false completion.
       5. Partial checkpoint -> resume only unresolved frames.
       6. Incomplete cached OCR -> reject as complete.
       7. Chinese text and timestamps remain unchanged during retry.
       8. Failed OCR cannot silently trigger downstream translation/TTS.
       9. Previously successful batches remain reusable.
- **Verification Outcomes**:
  - `backend/tests/stage3_chinese_ocr_accuracy_and_completion.test.js`: **9/9 PASS** (100%).
  - `backend/tests/stage3_gemini_vision_resilience.test.js`: **14/14 PASS** (100%).
  - Fast OCR and Stage Pipeline suites: **35/35 PASS** (100%).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 4.27s).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
  - Active Branch: `chore/full-project-cleanup`
- **Next Steps**:
  - Verified and ready for commit and push.

---

# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Gemini) - Minimal Change Engineer
- **Branch**: `chore/full-project-cleanup`
- **Timestamp**: 2026-11-20T00:03:00+07:00

## Summary: Gemini Vision OCR 503/Timeout Resilience, Adaptive Splitting & Checkpoint Resume (100% PASS)
- **Task:** Make Stage 3 Vision OCR resilient to temporary Gemini 503 overload and client/server timeouts while preserving Chinese subtitle accuracy, timing, and all successful OCR work.
- **Root Causes Identified**:
  1. Immediate full-model cascade exhaustion: On the very first 503 or 504 on attempt 1, `callGeminiVisionWithRetry` immediately abandoned the model. When Google experienced temporary service-level overload, all 12 cascade models were exhausted in <200ms.
  2. Uncancelled background requests on deadline: `Promise.race` rejected on timeout but never aborted the underlying `@google/genai` fetch, leaving uncontrolled requests competing for bandwidth and quota.
  3. Static batch concurrency: Fixed concurrency of 2 batches (30 frames) sent large image payloads simultaneously during Google peak load, triggering 503 and 25s deadline timeouts.
  4. Non-resumable chunk execution: Successful OCR batches were never persisted per batch (only at the very end of Stage 3). A single failed batch aborted the whole chunk, discarding all previous work and forcing `ProductionJobQueue` to repeat OCR from frame 0.
- **Surgical Changes Implemented (Minimal Change Discipline)**:
  1. `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`:
     - **Structured Error Classification (`classifyVisionError`)**: Explicitly distinguishes `CLIENT_TIMEOUT`, `SERVER_TIMEOUT`, `SERVICE_UNAVAILABLE` (503), `RATE_LIMIT` (429), `NETWORK_ERROR`, and `AUTH_ERROR` (401/403).
     - **Server Retry-After / RetryInfo Parsing (`extractRetryDelayMs`)**: Honors `retry-after` HTTP header, Google RPC `RetryInfo.retryDelay`, and regex in error messages.
     - **Request Cancellation via `AbortController`**: Connects deadline timer and external abort signal directly to SDK `config.abortSignal`, aborting sockets on client timeout or user cancellation.
     - **Bounded Model Retries & Cooldown Tracking (`callGeminiVisionWithRetry`)**: Retries once with server-directed backoff before cooldown; places overloaded models in a 20s cooldown map; bounds candidate cascade to top 4 models; waits for shortest cooldown expiry if all models temporarily unavailable (avoids rapid spinning).
     - **Adaptive Batch Splitting**: When an OCR batch of 15 frames fails, dynamically splits it into 2 sub-batches (e.g. 8 and 7 frames) in chronological order without discarding any frames.
     - **Adaptive Concurrency Control**: Starts at concurrency 2; immediately reduces to 1 on overload; conservatively recovers to 2 after 3 consecutive successes.
     - **Atomic Per-Batch Checkpoint & Resume (`saveOcrCheckpoint`, `loadOcrCheckpoint`)**: Writes temporary file and renames atomically after each completed batch to `uploads/cache/ocr_checkpoints/ocr_ckpt_*.json`. On chunk retry/restart, resumes already completed frames and only queries pending frames.
     - **Frame Accountability & Review Needed Guard**: Prevents false completion if any candidate frame is missing; flags unresolved frames as `reviewNeeded` and `ocrFailed` without inventing synthetic Chinese text.
     - **Live Progress Reporting**: Emits `completedBatches`, `totalBatches`, `completedFrames`, `totalFrames`, `modelUsed`, and `retriesCount` via `onProgress`.
  2. `backend/services/pipeline/chunkOrchestrator.js`:
     - Relays live batch OCR progress to `ProductionJobQueue` and user console (`chunkOCR`).
     - Preserves Stage 3 checkpoints on chunk failure so `ProductionJobQueue` retries resume from the exact failed batch without repeating completed work.
  3. `backend/tests/stage3_gemini_vision_resilience.test.js` (NEW):
     - 14-test comprehensive suite verifying 503 retry, 504 cancellation, all models unavailable, atomic checkpoints, resume without re-calling completed batches, adaptive splitting, adaptive concurrency, in-flight deduplication, unresolved frame safety, cancel during retry, and live progress.
- **Verification Outcomes**:
  - `backend/tests/stage3_gemini_vision_resilience.test.js`: **14/14 PASS** (100%).
  - Fast OCR, Unified 3-Step, and Smart Pipeline regression suites: **92/92 PASS** (100%, 8.16s).
  - `npm --prefix frontend run build`: **PASS** (0 errors, 676ms).
- **Active Environment**:
  - Backend API: `http://localhost:5000`
  - Frontend UI: `http://localhost:5173`
- **Next Steps**:
  - Ready for production review and deployment.

---

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
