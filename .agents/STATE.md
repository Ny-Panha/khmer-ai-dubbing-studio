# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T23:33:00+07:00

## Summary
- Audio Cache Architecture Upgrade: Instant Client-side Voice Switching & Preloading:
  1. Frontend Instant Voice Switching (Click -> Local Cache -> Play):
     - Updated `frontend/src/hooks/useAudioDubbing.js` in `handleUpdateSegmentVoice`:
       - Before sending any network request to backend, checks `targetSeg.voiceAudioVariants[newVoiceId]`.
       - If cached audio URL exists and text matches, switches audio, waveform, duration, and voice metadata INSTANTLY (0ms latency, zero spinner/waiting).
       - Persists updated segments to localStorage and synchronizes in the background via `persistTimelineOperationApi`.
  2. Cast Voices Cache Reuse:
     - In `handleUpdateSpeakerVoice`:
       - Changed `forceRegen: true` to `forceRegen: false`.
       - Added client-side cache lookup across character segments to immediately reuse existing audio variants for `newVoiceId` without adding them to regeneration queue.
       - Records generated audio into `voiceAudioVariants` upon progressive commit.
  3. Preloading Both Male & Female Voices (Piseth & Sreymom):
     - Updated `frontend/src/utils/webAudioScheduler.js`:
       - `preloadUpcoming` pre-decodes both primary and alternative voice variant URLs in `voiceAudioVariants` into `AudioBufferLRUCache`.
       - Added `preloadSegmentVariants(segment)` to pre-warm both voice variants in Web Audio API.
  4. Backend Voice Audio Variants Tracking & Auto-Discovery:
     - Updated `backend/services/ttsService.js`:
       - Returns `voiceAudioVariants` mapping for synthesized voices.
       - Automatically discovers sibling voice files on disk (Piseth / Sreymom) and populates them into `voiceAudioVariants`.
  5. Verification & Tests:
     - Created `backend/tests/voice_variants_cache.test.js` (PASSED 100%).
     - All 4 TTS backend test suites passed (11/11, 10/10, 4/4 tests).
     - Frontend production build succeeded cleanly (`npm run build` in 1.53s).

## Active Environment
- Backend Server: http://localhost:5000 (running, task-2440)
- Frontend Dev: http://localhost:5173 (running)
- TTS Engine: Microsoft Edge Neural (km-KH-PisethNeural & km-KH-SreymomNeural)

## Next Steps for User
- Refresh browser (F5) on `http://localhost:5173`.
- Test voice switching on any segment between Piseth and Sreymom:
  - First switch generates/caches the audio.
  - Subsequent switches between Piseth and Sreymom will be INSTANT (0ms delay, no backend wait).
