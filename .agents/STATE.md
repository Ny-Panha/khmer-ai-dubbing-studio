# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T18:50:00+07:00

## Summary
- User Request: "CRITICAL BUG: Cast Voice Switching stuck in Generating. EP1 contains 86 segments, 21 segments remain broken/pending after Cast Voice switching, Timeline waveforms disappear, generation stuck for nearly one hour."
- Root Cause Analysis:
  1. React State Updater Race Condition (`useAudioDubbing.js`):
     - In `setScriptData((sPrev) => { ... segmentsToRegen.push(segUpdated); })`, `segmentsToRegen` was mutated inside React 18's asynchronous state updater.
     - The outer code immediately checked `if (segmentsToRegen.length === 0)` synchronously. Because React defers execution of updater callbacks, `segmentsToRegen` was empty (`[]`) when checked, causing `handleUpdateSpeakerVoice` to return early without ever calling TTS API!
     - Meanwhile, the deferred updater ran later and set `textStatus: 'generating'`, `audioUrl: null`, `audioFile: null`, leaving the 21 segments stranded in `generating` forever with waveforms wiped out.
  2. Same race condition with `finalSegments`:
     - Reading `finalSegments` synchronously after `setScriptData` resulted in `null`, missing `syncTimelineAudioApi` and persistence calls.
  3. Audio references wiped before generation:
     - Setting `audioUrl: null` immediately wiped waveforms from the timeline during synthesis.
  4. Unbounded `Promise.all()`:
     - Fired 21-50 concurrent TTS requests simultaneously, leading to network saturation.
  5. Lack of Request Timeout:
     - `fetch('/api/generate-audio')` had no timeout, allowing stalled network sockets to hang indefinitely.
  6. Overwriting Custom Speed:
     - Line `speed: newSpeed` previously overwrote custom clip speeds (`userCustomSpeed`).

- Fixes Applied:
  1. `frontend/src/hooks/useAudioDubbing.js`:
     - Added `scriptDataRef.current = scriptData` to track up-to-date state safely.
     - Pre-calculated `segmentsToRegen` and `updatedSegments` SYNCHRONOUSLY from `currentSegments` before invoking any state setter.
     - Preserved original audio references (`previousAudioUrl`, `previousAudioFile`, `previousAudioPath`) and kept `audioUrl` intact during generation so waveforms and playback never vanish.
     - Preserved custom speed (`seg.userCustomSpeed && seg.speed ? seg.speed : newSpeed`).
     - Added safe audio reuse: if a segment already has valid audio for the target voice and is not outdated, it reuses it without re-synthesizing.
     - Replaced unbounded `Promise.all()` with a controlled concurrency queue (`CONCURRENCY_LIMIT = 2`).
     - Implemented Progressive Commit: each completed segment updates state and timeline immediately.
     - Added Safe Rollback: if TTS fails or times out, it restores `previousAudioUrl` and marks status as `error` rather than remaining stuck in `generating`.
     - Validates `speakerRegenSeqRef` and `activeTtsEpisodeRef` to safely discard stale requests.
  2. `frontend/src/services/api/audioApi.js`:
     - Added 25-second `AbortController` timeout to `fetch('/api/generate-audio')` with retry and clean timeout exception.
  3. Data Recovery (`backend/uploads/projects/ss1/series.json`):
     - Recovered all 21 stuck segments for speaker `ស៊ូ មីង` in episode `ep_1` from existing disk audio files. All 86 segments are 100% restored with waveforms and audio intact.
  4. Regression Tests (`backend/tests/cast_voice_switching.test.js`):
     - Added comprehensive tests for deferred state updaters, waveform preservation, custom speed preservation, failure rollback, and safe audio reuse. 9/9 tests pass.

- Verification:
  - `node --test backend/tests/cast_voice_switching.test.js`: 9/9 PASSED.
  - `node --test backend/tests/voice_instant_visual_assignment.test.js`: 2/2 PASSED.
  - `npm run build`: Succeeded in 1.18s with 0 errors.
  - Disk verification: EP1 in `ss1` has 86 total segments, 0 generating, 0 missing audio.

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Recovered Series: ss1 (ep_1 restored: 86 segments healthy)

## Next Steps for User
- Refresh page (F5).
- EP1 in `ss1` is fully restored with all 86 waveforms visible.
- Clicking Cast Voice button will now progressively generate with controlled concurrency, waveforms stay visible, custom speed is preserved, and no segments can ever get stuck.
