# Tasks: Batch Generate Studio UI & 3-Step AI Runners Upgrade

- [x] Task 1: Update `backend/routes/jobRoutes.js` to auto-cancel previous active jobs when `force: true` (`POST /api/jobs/generate`). (Verify: `node --test backend/tests/ai_detection_and_dubbing_prompt_fix.test.js` - PASS)
- [x] Task 2: Update `frontend/src/components/dashboard/GeminiRouteModal.jsx` with Duplicate Job Guard in `executeBatchTranslateEnqueue` (skip active jobs on `force: false` and show informational count). (Verify: `node --test` - PASS)
- [x] Task 3: Upgrade Top Batch Control Bar in `GeminiRouteModal.jsx` into 2-Row Layout with 4 Primary Execution Buttons + Secondary View Filter Segmented Control (`All 3 Steps` default). (Verify: `npm --prefix frontend run lint` - PASS)
- [x] Task 4: Upgrade Episode Cards in `GeminiRouteModal.jsx` to render all 3 Stage Modules with 1-click inline action buttons (`Translate`, `TTS`, `Demucs`). (Verify: `npm --prefix frontend run build` - PASS)
- [x] Task 5: Add automated tests for the 3-step runners and duplicate job guard in `backend/tests/ai_detection_and_dubbing_prompt_fix.test.js`. (Verify: Full test suite pass - 8/8 PASS)
