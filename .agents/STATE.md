# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T19:58:00+07:00

## Summary
- User Request: "mx oy tea nh play on voice mx mean slg long long jg ?" (Why is there an echo / double-audio when playing over a voice segment?)
- Root Cause Identified:
  1. **Dual Audio Playback Engine Bug**: In `usePlayerAudioSync.js`, `handlePlay` and `handleSeeked` triggered `syncSegmentAudiosAtTime()` (HTML5 Audio pool) unconditionally without checking `effectiveUseWebAudioRef.current`. At the same time, `syncLoop` (running 60fps) triggered `scheduler.syncAtTimelineTime()` (Web Audio API scheduler). Both audio engines started playing the identical audio file with ~15-30ms offset, creating a literal comb-filtering echo/phaser ("សំឡេងឡងៗ").
  2. **Original Video Dialogue Bleed-Through**: In Player Controls, the ducking volume was at `-20.0 dB` (10%). When playing segment `#25` where original video has Chinese dialogue and dubbing has Khmer dialogue, the Chinese dialogue was still audible at 10% underneath the Khmer voice.
- Implementation Details:
  1. `frontend/src/components/player/usePlayerAudioSync.js`:
     - Added `useWebAudio` guard at top of `syncSegmentAudiosAtTime`: when Web Audio is active, immediately aborts and stops HTMLAudio to guarantee mutually exclusive single-engine playback.
     - In `handlePlay` and `handleSeeked`, guarded `syncSegmentAudiosAtTime` so it is never called when `useWebAudio` is active.
- Verification:
  - `npm --prefix frontend run build`: Succeeded in 5.07s (0 errors).
  - `node --test backend/tests/retranslate_fallback.test.js`: 9/9 PASSED.
  - `node --test backend/tests/series_folder_selector_workspace.test.js`: 7/7 PASSED.
  - `node --test backend/tests/cast_voice_switching.test.js`: 9/9 PASSED.

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Active Project: ss1 (28 eps), ss2 (25 eps)

## Next Steps for User
- Refresh browser (F5).
- Play the timeline at `#25`.
- The echo bug caused by dual audio engines is now fixed.
- If user also wants zero original Chinese dialogue underneath, set Ducking to 0% (`Mute / -∞ dB`) or enable Clean BGM (Demucs).
