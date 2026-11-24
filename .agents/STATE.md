# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T21:44:00+07:00

## Summary
- User Request: "error" with screenshot showing:
  `Failed to generate single audio segment: Could not read response stream (Cannot read properties of null (reading 'text'))` on text `ម៉ាក់`.
- Root Cause Identified:
  1. In `frontend/src/services/api/audioApi.js` (`generateSingleSegmentAudio`):
     - `maxAttempts` defaulted to 1.
     - When an error or timeout occurred on `attempt = 0`, the `catch` block did `if (attempt === 0) continue;` unconditionally without checking `if (attempt + 1 < maxAttempts)`.
     - With `maxAttempts = 1`, `continue` terminated the loop without retrying, leaving `res = null`.
     - `res = null` was then passed to `parseResponseJson(res)`.
  2. In `frontend/src/services/api/client.js` (`parseResponseJson`):
     - `parseResponseJson` called `await res.text()` without guarding `if (!res)`.
     - When `res` was null, it threw `TypeError: Cannot read properties of null (reading 'text')`, masking the underlying network or timeout error.
  3. In `frontend/src/hooks/useAudioDubbing.js` (`handleUpdateSegmentText`):
     - `seriesId` and `episodeId` were omitted in the parameters sent to `generateSingleSegmentAudio`.
  4. Timeout Duration:
     - `timeoutMs` was previously set to 15000ms (15s), which is too aggressive for Edge TTS WebSocket handshakes under network jitter, causing premature aborts.
- Implementation Details:
  1. `frontend/src/services/api/client.js`:
     - Added `if (!res)` guard in `parseResponseJson` to eliminate null dereference and return clean error messages.
  2. `frontend/src/services/api/audioApi.js`:
     - Defaulted `timeoutMs` to 30000ms (30s) and `maxAttempts` to 2.
     - Guarded retry loop with `attempt + 1 < maxAttempts` so errors are never swallowed.
     - Tracked `lastErr` and verified `res` before calling `parseResponseJson`.
  3. `frontend/src/hooks/useAudioDubbing.js`:
     - In `handleUpdateSegmentText`, passed `seriesId` and `episodeId`.
     - In `handleUpdateSegmentVoice`, increased timeout to 25s with 2 attempts.
- Verification & Benchmarks:
  - All 23 tests PASSED:
    - `single_clip_voice_switching.test.js` (3/3)
    - `phonetic_normalization.test.js` (4/4)
    - `cast_voice_switching.test.js` (9/9)
    - `series_folder_selector_workspace.test.js` (7/7)
  - Vite build: PASSED in 2.09s (0 errors).

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Active Project: ss1 (28 eps), ss2 (25 eps)

## Next Steps for User
- Refresh browser (F5) in Studio at `localhost:5173`.
- Click the retry button (`សាកម្តងទៀត`) on the segment or type new text; the generation will now succeed smoothly without the stream error.
