# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (`chore/remove-ppocr-local`)
- **Branch**: `chore/remove-ppocr-local` (pushed to `origin/chore/remove-ppocr-local`, based on `feat/ppocr-local-ocr` @ `aa63cad`)
- **Timestamp**: 2026-11-15T22:52:00+07:00

## Summary: Complete Removal of Local PP-OCR Engine & Dead Model Catalog Retirement
1. **PP-OCR Stage 3 Engine Removal (Owner Decision)**:
   - **Reason**: At ~4s-5s/frame on this CPU-only machine, local PP-OCR was ~12x slower than Gemini Vision OCR and had no utility. Owner decided to remove it completely without dormant code or toggles.
   - **Deleted Files**:
     - `backend/workers/ppocr_worker.py` (Local PaddleOCR worker)
     - `backend/services/ppocrService.js` (Node service wrapper)
     - `backend/benchmark_ppocr_stage3.js` (Benchmark script)
     - `backend/tests/ppocr_local_ocr.test.js` (PP-OCR specific unit tests; Test 4 Fast OCR 1:1 rule extracted to `backend/tests/fast_ocr_rule.test.js`)
   - **Stage 3 Cleaned (`backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`)**:
     - Removed `ppocrService` require, `ocrEngine` parameter, and all PP-OCR execution / tie-break branches.
     - Unconditionally runs Gemini Vision OCR with bounded concurrency.
     - Standardized engine log: `[Stage 3 Extract Subtitles] OCR engine: gemini-vision (<model>, wall time: Xs, api calls: N, M cues)`.
   - **Intact Kept Features**:
     - Change-driven sampling pre-pass (local FFmpeg pixel-diff).
     - Prioritized candidate frames selection.
     - Double-read verification + tie-break reading.
     - Fast OCR deduplication (`deduplicateFastOcrCues`).
     - Disk cache/resumption (`getOcrCachePath`).
     - Owner's 1:1 rule logging (`cues detected: X -> segments stored: Y`) in `chunkOrchestrator.js` and `dubbingPipeline.js`.
2. **Dead Model Retirement (Mirrored from 0fd8897)**:
   - `backend/services/geminiModelCatalog.js`:
     - Replaced dead `gemini-2.5-flash` with `gemini-3.8-flash` in `VISION_CASCADE_MODELS`.
     - Marked catalog entry `gemini-2.5-flash` as `deprecated: true, inCascade: false, usableInDubbing: false, roleTag: '404 Retired'`.
   - Updated cascade tests and frontend fallback references:
     - `backend/tests/gemini_key_pool_and_504_retry.test.js`
     - `backend/tests/gemini_quota_tracker_and_routes.test.js`
     - `backend/tests/stage6_translation_fallback_and_tts_guard.test.js`
     - `frontend/src/components/dashboard/GeminiQuotaModal.jsx`
     - `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`
     - `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js`
3. **Verification**:
   - Repo-wide grep for `ppocr`, `PP_OCR`, `PaddleOCR`, `paddleocr`, `OCR_ENGINE`, `extractSubtitlesPPOCR`: **0 hits in all backend, frontend, test, and config files**.
   - Backend boots cleanly with zero missing module/require errors.
   - Backend test suite: **240 passed**.
   - Real-app live verification on Episode 1:
     `[Stage 3 Extract Subtitles] OCR engine: gemini-vision (gemini-3.5-flash-lite, wall time: 5.5s, api calls: 1, 4 cues)`
     `[Stage 3 Extract Subtitles] Completed with 4 deduplicated visual segments detected from 12 observations.`

## Active Environment
- Backend API: `http://localhost:5000`
- Frontend UI: `http://localhost:5173`
- Branch: `chore/remove-ppocr-local` (tracking `origin/chore/remove-ppocr-local`)

## Next Steps
- Open PR for `chore/remove-ppocr-local` into `main` or base branch when ready.
- Do NOT merge directly to main.
