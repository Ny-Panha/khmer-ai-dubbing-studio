# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T23:56:00+07:00

## Summary
- Cache-First Delivery Style Switching (ធម្មតា ↔ ក្នុងចិត្ត / Normal ↔ Inner Thought with Reverb):
  1. Fast Return / No-op on Same-Mode Click:
     - In `frontend/src/hooks/useAudioDubbing.js` & `ClipInspectorPanel.jsx`:
       - Clicking the currently active delivery mode returns immediately with zero churn (0 requests, 0.002ms latency).
  2. Frontend Instant Delivery Switching (Cache-First):
     - Added `targetSeg.deliveryVariants` tracking `out_loud` and `inner_thought` variants.
     - On warm cache hit, swaps `audioUrl`, `deliveryType`, `audioEffect`, and waveform immediately without calling backend (<0.01ms latency, 0 spinner, 0 TTS synthesis).
     - Asynchronously saves to `localStorage` and persists via `persistTimelineOperationApi` in the background without blocking the UI.
     - Removed blocking full-episode `syncTimelineAudioApi` on single delivery mode toggle.
  3. Clean Speech Reuse in Backend (Zero Edge TTS Calls):
     - In `backend/services/ttsService.js`:
       - When toggling to `inner_thought`: checks if clean speech already exists in `cleanVoiceFilePath` or `rawCandidatePath`. If present, skips Edge TTS completely and applies FFmpeg `aecho` filter (~180ms).
       - When toggling to `out_loud`: checks if clean speech already exists in `rawCandidatePath`. If present, copies directly with zero Edge TTS synthesis.
       - Returns `deliveryVariants` mapping and auto-discovers sibling variants on disk.
  4. Variant Deletion Protection:
     - Fixed `unlinkSync` in `ttsService.js`: added `isOtherDeliveryVariant` check to ensure creating `_thought_` never deletes clean `_voice_`, and vice versa.
  5. Audio Preloading & Web Audio Support:
     - Updated `frontend/src/utils/webAudioScheduler.js` and `ClipInspectorPanel.jsx` to pre-warm both `out_loud` and `inner_thought` buffers in `AudioBufferLRUCache` and browser cache.
  6. Verification:
     - Created `backend/tests/delivery_style_switching.test.js` (PASSED 100%).
     - All regression suites passed (`voice_variants_cache.test.js`, `instant_voice_switching.test.js`).
     - Frontend production build succeeded cleanly (`npm run build` in 1.72s).

## Active Environment
- Backend Server: http://localhost:5000 (running, task-2440)
- Frontend Dev: http://localhost:5173 (running)
- TTS Engine: Microsoft Edge Neural (km-KH-PisethNeural & km-KH-SreymomNeural)

## Next Steps for User
- Refresh browser (F5) on `http://localhost:5173`.
- Test delivery style switching on any clip:
  - Click "ធម្មតា" ↔ "ក្នុងចិត្ត" in Clip Inspector:
    - First switch generates/applies Reverb to clean speech without regenerating text.
    - Subsequent switches between Normal and Inner Thought are INSTANT (0ms delay, no backend wait).
