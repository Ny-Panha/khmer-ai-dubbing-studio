# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Feature Added: Local SenseVoice-Small ASR for Standard Pipeline)
- **Timestamp**: 2026-11-15T09:58:00+07:00
- **Branch**: `feat/sensevoice-local-asr` (Commit: `4b0730b`)

## Summary: Added SenseVoice-Small Local ASR Engine & Watermark Logo Free Drag & Drop
1. **Free Drag & Drop Watermark Logo (`LogoOverlay.jsx`, `VideoTransformControls.jsx`, `ffmpegService.js`)**:
   - Enabled 360° free dragging of the logo watermark anywhere on the video canvas (not restricted to 4 corner snaps).
   - Real-time coordinates pill during drag: shows `X: % | Y: %` live.
   - Synchronized with FFmpeg video export via `(main_w-overlay_w)*xPct : (main_h-overlay_h)*yPct` so rendered video matches the exact preview position 100%.
   - Added quick presets: ↖ Top-Left, ↗ Top-Right, 🎯 Center, ↙ Bottom-Left, ↘ Bottom-Right, ↔ Both.
2. **Worker Implementation (`backend/workers/sensevoice_worker.py`)**:
   - Primary: FunASR with `SenseVoiceSmall` + `FSMN-VAD` (sentence timestamps) + `CAM++` (speaker diarization).
   - CPU-only execution (zero CUDA assumption), models downloaded and cached locally.
   - Built-in YIN fundamental frequency (F0) pitch estimation per speech segment.
   - Secondary on-device fallback to `sherpa-onnx` using existing local ONNX model in `backend/models/sense-voice`.
3. **Speaker & Pitch Contract Preservation**:
   - `speakerId`: Multi-speaker clustered labels (`spk_1`, `spk_2`, etc.).
   - `pitchHz` & `acousticF0`: Real fundamental pitch in Hertz (e.g. 142.86 Hz male, 215.4 Hz female).
   - `audioGender` & `acousticGender`: Reliable male/female classification, ensuring Stage 5 Reconcile receives 100% of the required data without gender degradation.
4. **Node Wrapper (`backend/services/senseVoiceService.js`)**:
   - Mirroring Demucs audio separation worker pattern: process registry tracking, graceful termination (`taskkill /T /F` on Windows), 300s episode timeout, and comprehensive stderr error surfacing without swallowing.
5. **Routing & Visible Fallback (`stage4_analyzeDialogueAudio.js` & `dubbingPipeline.js`)**:
   - Standard pipeline routes to local SenseVoice ASR first.
   - On worker failure, missing model, or timeout: cleanly catches the error and falls back to Cloud Gemini ASR (`gemini-3.5-transcribe` / multimodal).
   - Visible logging in both console and job progress: `ASR engine: sensevoice-local` or `ASR engine: gemini (fallback — <reason>)`.
6. **Clean BGM Runner Fix (`DubbingRunnerContext.jsx`)**:
   - Resolved premature abort bug where a single idle poll while Demucs was processing triggered `Demucs process ended unexpectedly`. Increased idle threshold to 10 ticks (12s) and network grace period to 15 ticks (18s).
7. **Verification & Evidence**:
   - `backend/tests/sensevoice_worker.test.js`: 2/2 passed.
   - `backend/tests/sensevoice_fallback.test.js`: 1/1 passed.
   - `backend/tests/stage4_sense_voice_integration.test.js`: 1/1 passed.
   - Frontend build: `npm run build` passed with 0 errors.

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Active Series: `series_1793898268958` (Safe and intact)
- Active Branch: `feat/sensevoice-local-asr` (Pushed to origin, unmerged to main)

## Next Steps
- Run full episode Generate Script in Standard Mode from the UI to observe live progress log: `ASR engine: sensevoice-local`.
