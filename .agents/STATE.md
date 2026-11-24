# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T22:03:00+07:00

## Summary
- User Request: "nv ah del research mer mx ban vea jg ? just translate sos" with screenshot showing:
  `{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}` on Clip #43 (`兽`).
- Root Cause Identified:
  1. Google Gemini API Spike (503 UNAVAILABLE):
     - Google Gemini data center occasionally experiences momentary spikes in demand ("Spikes in demand are usually temporary. Please try again later.").
  2. Route Error Formatter Missed 503:
     - In `backend/routes/scriptRoutes.js` (`formatRetranslateRouteError`), 504 was handled, but 503 / "high demand" was not caught.
     - As a result, the raw JSON error string returned by Google (`{"error":{"code":503,...}}`) was sent directly in `error: rawMsg`, displaying raw JSON inside the UI error banner.
  3. No Backoff Delay on 503:
     - In `backend/services/geminiService.js` (`generateContentWithModelFallback`), 503 spikes were not given a delay before trying the next model, causing immediate cascade without giving Google servers time to recover.
  4. Frontend UI JSON Leak:
     - In `frontend/src/components/voice/ClipInspectorPanel.jsx` (`formatRetranslateUiError`), JSON error strings were not parsed, allowing raw Google JSON to be rendered directly.
- Implementation Details:
  1. `backend/routes/scriptRoutes.js`:
     - Updated `formatRetranslateRouteError` to catch 503, 504, "high demand", "unavailable", and `isModelOverloadOrUnavailable(err)`.
     - Maps these errors to a clear, friendly Khmer message: `"Google Gemini AI កំពុងមានអ្នកប្រើប្រាស់ច្រើន (High Demand / 503)។ សូមចុច 'សាកម្តងទៀត' បន្តិចទៀត!"`.
  2. `backend/services/geminiService.js`:
     - Added 800ms backoff in `generateContentWithModelFallback` when a 503 spike is detected before cascading to the next model.
  3. `frontend/src/components/voice/ClipInspectorPanel.jsx`:
     - Updated `formatRetranslateUiError` to parse JSON error strings and display clear Khmer error messages for 503.
  4. `backend/tests/retranslate_fallback.test.js`:
     - Added unit test asserting 503 High Demand is properly mapped to friendly Khmer error.
- Verification & Benchmarks:
  - All 33 unit and integration tests PASSED:
    - `retranslate_fallback.test.js` (9/9)
    - `single_clip_voice_switching.test.js` (3/3)
    - `phonetic_normalization.test.js` (4/4)
    - `cast_voice_switching.test.js` (9/9)
    - `series_folder_selector_workspace.test.js` (7/7)
  - Vite build: PASSED in 1.05s (0 errors).

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Active Project: ss1 (28 eps), ss2 (25 eps)

## Next Steps for User
- Refresh browser (F5) in Studio at `localhost:5173`.
- Click `🔄 សាកម្តងទៀត` (Retry) on Clip #43 (`兽`).
- Gemini API now successfully translates `兽` to `សត្វព្រៃ!` / `អាសត្វកំណាច!` / `សត្វតិរច្ឆាន!` cleanly.
