# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (`fix/pool-503-model-busy` - Caller Cascade Eligibility Restoration)
- **Timestamp**: 2026-11-15T15:39:00+07:00
- **Branch**: `fix/pool-503-model-busy`

## Summary: Gemini 503 Model Busy Full Resolution & Caller Cascade Restoration
1. **Isolated 503 / 504 Classifier & Key Pool Handling (Commit `25bbb28`)**:
   - In `backend/services/geminiKeyManager.js`, added `isModelUnavailableError(err)`: checks status 503 / 504 and messages containing `unavailable`, `high demand`, `deadline_exceeded`, or `deadline exceeded`.
   - Updated `isQuotaOrRateLimitError(err)` to return `false` whenever `isModelUnavailableError(err)` claims the error (removing 503 / high-demand overlap).
   - In `runWithPool`: does NOT rotate keys on 503/504; limits to at most 2 attempts on same key with ~2s backoff, tags `err.modelUnavailable = true`, and logs clear handoff warning.
2. **Restored Caller Cascade Eligibility for 503**:
   - **`backend/services/geminiService.js`**:
     - Imported `isModelUnavailableError` from `geminiKeyManager.js`.
     - In `isModelFallbackEligibleError(err)`: returns `true` when `err.modelUnavailable === true || isModelUnavailableError(err)` (placed after `isAuthOrInvalidKeyError` so 401/403 fails fast).
     - Restores model fallback across `retranslateSingleDialogue`, `retranslateBatchDialogues`, and `generateContentWithModelFallback`.
   - **`backend/services/pipeline/stages/stage6_generateModeSpecificScript.js`**:
     - Imported `isModelUnavailableError` from `geminiKeyManager.js`.
     - In Mode B (line 2090): extended `canCascade` with `|| err?.modelUnavailable === true || isModelUnavailableError(err)`.
3. **Attempt Counts Per Error Class**:
   - **401 / 403 (Invalid Key)**: 1 attempt. Key is marked invalid and removed from rotation permanently. Next key continues.
   - **429 (Key Quota / Rate Limit)**: Up to `pool.getKeyCount() * 2` attempts (e.g. up to 12 attempts across 6 keys). Rotates key on every attempt.
   - **503 / 504 (Model Busy / Overload)**: At most 2 attempts on the exact same key without rotation, then thrown for caller cascade.
4. **Verification & Test Results**:
   - `node --test backend/tests/retranslate_fallback.test.js`: **8/8 PASS** (100%).
   - `node --test backend/tests/gemini_key_pool_and_504_retry.test.js`: **13/13 PASS** (100%).
   - Full backend test suite: **248 PASS** / 1 Fail / 2 Skipped (total 251 tests).
   - The sole remaining failure is `Phase 3a: EpisodesTab split uses SPA refresh + inline banner (no alert / reload)` in `full_project_master_upgrade.test.js:40:1`, which was proven pre-existing on branch base `03eb4f5` (introduced in commit `85652ca` on `main` where `window.location.reload()` was added to `EpisodesTab.jsx`).

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Active Series: `series_1794653630301`
- Active Branch: `fix/pool-503-model-busy`

## Next Steps
- Ready for PR into `main` from `fix/pool-503-model-busy`.
- (Optional UI maintenance) Clean up `window.location.reload()` in `EpisodesTab.jsx` line 107 in a separate frontend task so `full_project_master_upgrade.test.js` passes 100%.
