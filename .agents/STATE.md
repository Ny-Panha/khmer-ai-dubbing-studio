# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (`fix/dead-cascade-model`)
- **Branch**: `fix/dead-cascade-model`
- **Timestamp**: 2026-11-15T15:01:00+07:00

## Summary: Fix Dead Gemini Cascade Model (404 gemini-2.5-flash -> gemini-3.8-flash)
1. **Model Cascade Chains Updated**:
   - `backend/services/geminiModelCatalog.js`:
     - Replaced `gemini-2.5-flash` with `gemini-3.8-flash` at index 1 of `VISION_CASCADE_MODELS` (Stage 3 Vision OCR first fallback).
     - Filtered `gemini-3.8-flash` from rest of `VISION_CASCADE_MODELS` to prevent duplicate entries.
     - Marked `gemini-2.5-flash` catalog entry as `deprecated: true, inCascade: false, usableInDubbing: false, roleTag: '404 Retired'`, cleanly removing it from `DUBBING_CASCADE_MODELS`.
   - `frontend/src/components/dashboard/GeminiQuotaModal.jsx`:
     - Removed dead `gemini-2.5-flash` from `FALLBACK_CASCADE_OPTIONS` without duplicating existing `gemini-3.8-flash`.
   - `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx`:
     - Updated default fallback model for text repair from `gemini-2.5-flash` to `gemini-3.8-flash`.
   - `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js`:
     - Updated JSDoc comment cascade list to reference `gemini-3.8-flash`.
2. **Verification & Tests**:
   - `backend/tests/gemini_key_pool_and_504_retry.test.js`: Updated assertion from `gemini-2.5-flash` to `gemini-3.8-flash`.
   - `backend/tests/gemini_quota_tracker_and_routes.test.js`: Updated `VISION_CASCADE_MODELS[1]` assertion to `gemini-3.8-flash`, and adjusted ready cascade count assertion.
   - `backend/tests/stage6_translation_fallback_and_tts_guard.test.js`: Removed `gemini-2.5-flash` from mock conditions and verified traversal across all 10 cascade models.
   - All 241 backend tests pass (1 skipped, 0 fail).
   - Frontend Vite production build succeeded cleanly.

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)

## Next Steps
- Merge `fix/dead-cascade-model` via GitHub PR into `main` after review.
- If applying to `feat/sensevoice-local-asr`:
  `git checkout feat/sensevoice-local-asr`
  `git cherry-pick fix/dead-cascade-model`
  `git stash pop`
