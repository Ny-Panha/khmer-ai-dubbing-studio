# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (`fix/pool-503-model-busy` - Stage 3 Sticky Cascade & Accurate Progress)
- **Timestamp**: 2026-11-15T16:38:00+07:00
- **Branch**: `fix/pool-503-model-busy`

## Summary: Stage 3 OCR Sticky Model Cascade & UI Progress Accuracy
1. **Stage 3 OCR 503 Immediate Cascade & Sticky Model (`stage3_extractChineseSubtitles.js`)**:
   - Imported `isModelUnavailableError` from `geminiKeyManager.js`.
   - In `callGeminiVisionWithRetry`: when `err?.modelUnavailable === true || isModelUnavailableError(err)`, Stage 3 now breaks immediately to cascade without burning a 2nd retry on the same model.
   - Tagged `resp.modelUsed = currentModel` and made `effectiveModel` sticky in `executeVisionBatch`, preventing all subsequent frame batches from re-trying the dead/overloaded model.
   - Added unit test 9 in `gemini_key_pool_and_504_retry.test.js`: verified immediate cascade on 503 on attempt 1.
2. **Frontend Progress Bar & Step Highlight Accuracy (`DubbingModeTab.jsx`)**:
   - Removed `else if (prev < 95 && target < 95) return prev + 1;` from the ticker in `DubbingModeTab.jsx`.
   - The progress bar and step indicators now accurately reflect the real backend stage progress (`displayProgress`), stopping at Step 2 (Chunks/OCR, ~25%) while OCR runs instead of falsely ticking to 95% and highlighting Step 4 ("4. Script Khmer").
3. **Pre-existing Suite Pass (`EpisodesTab.jsx`)**:
   - Replaced `window.location.reload()` with `onRefreshSeries()` in `EpisodesTab.jsx`, bringing the entire backend test suite to **250 PASS / 0 FAIL / 2 SKIPPED (100% PASS)**.
   - Frontend build: **PASS** (611ms).

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Active Series: `series_1794653630301`
- Active Branch: `fix/pool-503-model-busy`

## Next Steps
- Restart Backend (`npm --prefix backend start`) or trigger Generate Script to verify the sticky cascade and smooth accurate progress in the browser UI.
