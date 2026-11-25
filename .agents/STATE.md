# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T11:08:00+07:00

## Summary
- **Voice Provenance Cache Isolation, Test Fixes & Full EP8 Browser Verification (`PASS`):**
  1. **Production Code Fixes:**
     - `backend/services/ttsService.js`: Fixed cache cleanup to preserve only provenance-verified speed variants (`isVerifiedSpeedVariant`) while unlinking superseded `deadbeef`/old-text `.mp3` + `.json` sidecars; preserved natural unscaled duration (`naturalSpeechDuration` / `naturalAudioDuration`) alongside exact processed duration (`originalAudioDuration`); preserved trim metadata (`audioOffset`/`audioTrimmed`/`userTrimmed`) on voice/speed/delivery switches while resetting on explicit fresh regeneration (`preserveTrim`).
     - `backend/routes/audioRoutes.js` & `frontend/src/services/api/audioApi.js`: Enforced v2 voice provenance checks in `doesSegmentNeedTts`, forwarded `preserveTrim` cleanly, and updated `/audio/autofit-speed` duration fields.
     - `backend/routes/videoRoutes.js`: Verified master narration `.sig` against `computeMasterAudioSignature` on `/render-video` so stale narration MP3s are never reused.
     - `frontend/src/hooks/useAudioDubbing.js`, `frontend/src/utils/voiceCacheUtils.js`, `frontend/src/components/voice/VoiceSettings.jsx`, `frontend/src/components/voice/ClipInspectorPanel.jsx`: Cache-first instant single-clip voice switching (`voiceAudioVariants` provenance checks), waveform preservation, honest generating UI state, and safe rollback on errors.
  2. **Test Suite Resolutions & Regression Verification (`PASS`):**
     - Resolved `voice_switch_fast_path.test.js`, `tts_smart_skip_and_progress.test.js`, `clip_speed_tts.test.js`, `inspector_smooth_sliders.test.js` (expanded to audit all 23 `<SmoothRangeSlider>` bindings and 6 preview subscribers), and added `voice_provenance_cache_isolation.test.js`.
     - Executed 19-suite backend batch (`node --test`): **81 passed, 0 failed** (`14.23s`).
     - `npm --prefix frontend run build`: **0 errors** (`762ms`, `2052` modules, chunk size warning only).
     - `npm --prefix frontend run lint`: **0 errors**, `604` pre-existing warnings (`825ms`).
  3. **EP8 Clip #52 Full Playwright Chrome Verification (`PASS`):**
     - Verified instant warm-cache voice switches (`Sreymom -> Piseth` `115.6ms`, `0` `/api/generate-audio` calls; `Piseth -> Sreymom` `213.3ms`, `0` calls) with distinct SHA-256 MP3 bytes.
     - Verified live UI audio playback (`ស្តាប់សំឡេង` -> `កំពុងចាក់`) with `HTMLAudioElement` advancing `currentTime` cleanly (`0.30s / 1.55s` Piseth, `0.49s / 1.61s` Sreymom, `error: null`).
     - Verified live `SmoothRangeSlider` pointer drag (`slider-ducking-volume`: `1.0 -> 0.59 draft -> 0.24 commit -> 1.0 restore`, `0` mutation API calls during drag).
     - Verified reload persistence (`km-KH-SreymomNeural`) and full `ep_8` Video Export (`POST /api/render-video` HTTP `200`, `63.75s` roundtrip / `56.4s` FFmpeg render, 77-segment Master Narration rebuilt cleanly, `ffprobe` 2 streams / `300s`, `93,627,410` bytes, `0` console/page errors).

## Active Environment
- Backend Server: `http://localhost:5000` (`node server.js`, background task `task-1346`)
- Frontend Dev: `http://localhost:5173` (`vite`, background task `task-1372`)
- Branch: `chore/full-project-cleanup`
- Note: Chrome DevTools MCP config (`C:\Users\nhastar\.gemini\config\mcp_config.json`) left untouched as requested.

## Next Steps
- None blocking — all requested fixes, tests, build/lint, browser verifications, commit, and push are completed.
