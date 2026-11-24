# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T20:23:00+07:00

## Summary
- User Request: Fix Single Clip Voice Switching performance and reliability (EP2 Clip #5 stuck in generating, waveform disappearing, slow switching).
- Root Cause Identified:
  1. `forceRegen: true`: In `useAudioDubbing.js` (L829), single segment voice switching passed `forceRegen: true`, completely bypassing existing TTS disk cache and triggering network synthesis every time.
  2. `audioUrl: null`: In `useAudioDubbing.js` (L744), the hook set `audioUrl: null` during switching, blanking out the waveform on the timeline and making playback unavailable during synthesis.
  3. Missing `prevSpeakerEntry` Declaration: In `useAudioDubbing.js`, `prevSpeakerEntry` was undeclared in `handleUpdateSegmentVoice`, throwing `ReferenceError` on failure rollback and leaving segments permanently stuck in generating.
  4. Disk Cache Variant Cleanup in `ttsService.js`: When generating audio for a voice (e.g. Sreymom), `ttsService.js` unlinked prior segment audio files even if they were for the other voice variant (Piseth), deleting the cached audio for previous voice.
  5. Timeout & Retries: `audioApi.js` hardcoded 25s timeout with 2 retry loops (up to 50s total wait).
- Implementation Details:
  1. `frontend/src/hooks/useAudioDubbing.js`:
     - Added early return if clicking already-active and ready voice.
     - Declared `prevSpeakerEntry` before catch block to eliminate `ReferenceError`.
     - Preserved `previousAudioUrl` and eliminated `audioUrl: null` so timeline waveforms stay visible.
     - Changed `forceRegen: true` to `forceRegen: false` to enable backend cache reuse.
     - Added `isVoiceSwitching: true` indicator and preserved `voiceAudioVariants`.
  2. `backend/services/ttsService.js`:
     - In prior audio cleanup, added `isOtherVoiceVariant` check so Piseth and Sreymom audio files for the same segment remain preserved concurrently on disk.
  3. `frontend/src/services/api/audioApi.js`:
     - Defaulted `forceRegen` to `false`. Added configurable `timeoutMs` (15s default) and `maxAttempts` (1 for single clip).
  4. `frontend/src/components/voice/ClipInspectorPanel.jsx`:
     - Updated `segVoiceId` resolution to check `voiceOverride` and `voice`.
  5. `backend/tests/single_clip_voice_switching.test.js`:
     - Added automated regression suite verifying instant cache hits, waveform safety, and error rollback.
- Verification & Benchmarks:
  - `node --test backend/tests/single_clip_voice_switching.test.js`: 3/3 PASSED.
  - Measured benchmark:
    - Piseth -> Sreymom: 824.2ms
    - Sreymom -> Piseth (Cache Hit): 757.2ms (100% verified cached audio reused)
    - Piseth -> Sreymom (Second Cache Hit): 645.9ms (100% verified cached audio reused)
  - Regression suite (19/19 tests PASSED):
    - `backend/tests/single_clip_voice_switching.test.js` (3/3)
    - `backend/tests/cast_voice_switching.test.js` (9/9)
    - `backend/tests/series_folder_selector_workspace.test.js` (7/7)
  - Vite build: PASSED in 1.39s (0 errors).

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Active Project: ss1 (28 eps), ss2 (25 eps)

## Next Steps for User
- Refresh browser (F5) in Studio.
- In Clip Inspector, toggle voice on Clip #5 or any clip:
  1. Waveform stays visible on the timeline.
  2. Toggling between ពិសិដ្ឋ and ស្រីមុំ reuses the cached audio instantly without waiting for network re-generation.
