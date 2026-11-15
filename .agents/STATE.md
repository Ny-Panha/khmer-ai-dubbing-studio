# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (`fix/pool-503-model-busy`)
- **Timestamp**: 2026-11-15T15:31:00+07:00
- **Branch**: `fix/pool-503-model-busy`

## Summary: Gemini Key Pool 503 (Model Busy) Handling
1. **Isolated 503 / 504 Classifier (`isModelUnavailableError`)**:
   - In `backend/services/geminiKeyManager.js`, added `isModelUnavailableError(err)`: checks status 503 / 504 and messages containing `unavailable`, `high demand`, `deadline_exceeded`, or `deadline exceeded`.
   - Updated `isQuotaOrRateLimitError(err)` to return `false` whenever `isModelUnavailableError(err)` claims the error (removing 503 / high-demand overlap).
2. **Dedicated 503 / 504 Handling in `runWithPool`**:
   - **No Key Rotation**: 503/504 indicates Google model infrastructure overload; keys are not rotated.
   - **Attempt Budget**: At most 2 attempts total (initial attempt + 1 retry on the same key with ~2s backoff).
   - **Cascade Handoff**: On exhaustion after attempt 2, tags `err.modelUnavailable = true`, logs `[GeminiKeyPool] ⚠️ Model <modelName> busy (503) after 2 attempts — handing back for cascade switch.`, and throws the error for caller model cascade.
   - **Pacing / Quota Tracker**: Preserved `geminiQuotaTracker.recordRateLimit(currentKey, err, ...)` call to maintain cooldown tracking.
3. **Attempt Counts Per Error Class**:
   - **401 / 403 (Invalid Key)**: 1 attempt. Key is marked invalid and removed from rotation permanently. Next key continues.
   - **429 (Key Quota / Rate Limit)**: Up to `pool.getKeyCount() * 2` attempts (e.g. up to 12 attempts across 6 keys). Rotates key on every attempt.
   - **503 / 504 (Model Busy / Overload)**: At most 2 attempts on the exact same key without rotation, then thrown for cascade.
4. **Verification**:
   - Extended `backend/tests/gemini_key_pool_and_504_retry.test.js` with mocked test 8 covering (a) 503 always throws -> 2 attempts, 0 rotations, tagged; (b) 503 once then succeeds -> 2 attempts, 0 rotations; (c) 429 rotates key; (d) 401 invalidates key: **13/13 tests PASS**.
   - Full backend test suite: 246 passed.
   - **Caller Cascade Finding Reported (Per Rule 3)**:
     - `backend/services/geminiService.js: isModelFallbackEligibleError` and `backend/services/pipeline/stages/stage6_generateModeSpecificScript.js: canCascade` (Mode B) previously relied on `isQuotaOrRateLimitError` to cascade on 503. Because `isQuotaOrRateLimitError` now returns `false` for 503, callers without `isModelUnavailableError(err)` will not cascade on 503 unless updated.

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Active Series: `series_1794653630301`
- Active Branch: `fix/pool-503-model-busy`

## Next Steps
- Create PR for `fix/pool-503-model-busy` into `main`.
- In a follow-up task, update `isModelFallbackEligibleError` in `backend/services/geminiService.js` and `canCascade` in `stage6_generateModeSpecificScript.js` to also check `isModelUnavailableError(err)` or `err.modelUnavailable`.
