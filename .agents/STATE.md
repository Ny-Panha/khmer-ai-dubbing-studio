# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T22:23:00+07:00

## Summary
- User Question: "why check code then test then fix" + screenshots:
  1. `localhost:5173/quota` modal displaying `0/10 Ready` with `503 Busy` across all models.
  2. Clip #43 (`兽`) displaying error banner for Google Gemini 503 High Demand.
- Root Cause Identified:
  1. Permanent 503 Probe Freeze in `geminiQuotaTracker.js`:
     - When Google servers have a brief 503 "High Demand" spike, probing or requests record `lastProbeCode: 503` into `gemini_quota_usage.json`.
     - In `geminiQuotaTracker.js` (lines 701 and 942), there was NO TTL/expiration timestamp check on `lastProbeCode === 503`.
     - Consequently, even after Google's servers returned to normal, the models remained frozen in `liveStatus = 'busy'` indefinitely!
     - This caused `readyCascadeModelsCount` to stay at `0/10 Ready` and pushed all models to degraded priority.
- Implementation Details:
  1. `backend/services/geminiQuotaTracker.js`:
     - Added 45-second TTL check (`now - lastProbeAt < 45000`) for 503 / 504 codes in both `prioritizeAvailableModels` and `getPoolStatusSnapshot`.
     - Once 45 seconds pass after a spike, models automatically recover to `'ready'`, clearing the temporary 503 latency and error message.
     - `readyCascadeModelsCount` automatically restores to `10/10 Ready`.
  2. `backend/tests/gemini_quota_tracker_and_routes.test.js`:
     - Added test asserting that after 45s TTL, 503 models automatically recover to `liveStatus: 'ready'` with cleared latency.
- Verification & Benchmarks:
  - All 15 tests PASSED in `gemini_quota_tracker_and_routes.test.js` and `retranslate_fallback.test.js`.
  - Backend restarted with new code; live verified on `http://localhost:5000/api/gemini/keys-status`:
    - `readyCascadeModelsCount: 10 / 10` (All models healthy and ready).
    - Auto-recovery verified in production.

## Active Environment
- Backend Server: http://localhost:5000 (running, task-2440)
- Frontend Dev: http://localhost:5173 (running)
- Quota Monitor: 7/7 Keys Active, 10/10 Cascade Models Ready

## Next Steps for User
- Refresh browser (F5) in Studio or Quota modal.
- You will now see `10/10 Models Ready` in the Quota modal instead of `0/10 Ready`.
- On Clip #43 (`兽`), click `🔄 សាកម្តងទៀត` to retranslate smoothly.
