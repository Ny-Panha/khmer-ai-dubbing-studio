# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T18:00:00+07:00

## Summary
- User Request: "Use engineering-minimal-change-engineer to fix the Cast Voice Switching bug."
- Root Cause Analysis:
  1. Voice Button & Character Gender Coupling (`VoiceSettings.jsx`):
     - `spk.isFemale` was computed using `String(reg.voiceGender || reg.gender || '').toLowerCase() === 'female' || String(currentVoice).toLowerCase().includes('sreymom')`.
     - This coupled character biological gender (`gender === 'female'`) with the voice toggle button. Whenever a character had female detected gender, the button permanently showed `ស្រី (ស្រីមុំ)` with `.is-female` styling and always tried to switch to Piseth, ignoring the assigned voice.
  2. Missing Audio Re-generation on Voice Switch (`useAudioDubbing.js`):
     - `handleUpdateSpeakerVoice()` in `useAudioDubbing.js` only updated speaker metadata and marked `audioOutdated: true`, but never triggered actual TTS generation for matching segments. The user had to manually find segments and click regenerate.
- Fixes Applied:
  1. `frontend/src/components/voice/VoiceSettings.jsx`:
     - Decoupled voice gender `isVoiceFemale = String(currentVoice).toLowerCase().includes('sreymom')` from character biological gender `isCharacterFemale = (gender === 'female')`.
     - Button toggle dynamically switches: `spk.isVoiceFemale ? 'km-KH-PisethNeural' : 'km-KH-SreymomNeural'`.
     - Button label and color strictly reflect assigned voice: `spk.isVoiceFemale ? 'ស្រី (ស្រីមុំ)' : 'ប្រុស (ពិសិដ្ឋ)'`.
     - Character name tag styling preserves character identity (`isCharacterFemale`).
  2. `frontend/src/hooks/useAudioDubbing.js`:
     - Made `handleUpdateSpeakerVoice` async and integrated automatic TTS re-generation for all matching segments in the current episode.
     - Immediately marks matching segments with honest `textStatus: 'generating'`, `audioUrl: null`, `audioOutdated: true`.
     - Reuses existing `generateSingleSegmentAudio` per segment (no full-episode regeneration).
     - Protects against rapid toggle race conditions using `speakerRegenSeqRef`.
     - Applies cache-busting `?t=...` to new audio URLs and updates `textStatus: 'voice_updated'`.
     - Re-stitches timeline master audio with `syncTimelineAudioApi` so playback immediately plays the new voice.
     - Persists changes to `localStorage` and backend safely.
  3. Regression Tests (`backend/tests/cast_voice_switching.test.js`):
     - 5 test cases covering Male ↔ Female switching, character identity preservation, honest generating state, and real Edge TTS generation for Piseth and Sreymom.
- Verification:
  - `node --test backend/tests/cast_voice_switching.test.js`: 5/5 PASSED.
  - `node --test backend/tests/voice_instant_visual_assignment.test.js`: 2/2 PASSED.
  - `npm run build`: Succeeded in 1.90s with 0 errors.

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Active Series: ss2 (25 episodes)

## Next Steps for User
- Refresh page in browser (F5).
- In Cast Voices (Inspector), clicking a character's voice button will instantly toggle between ពិសិដ្ឋ and ស្រីមុំ.
- Matching segments will display `generating`, auto-generate real Edge TTS audio, and update playback without needing manual regeneration.
