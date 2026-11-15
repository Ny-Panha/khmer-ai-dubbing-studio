# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Feature Added: Local SenseVoice-Small ASR for Standard Pipeline)
- **Timestamp**: 2026-11-15T09:58:00+07:00
- **Branch**: `feat/sensevoice-local-asr` (Commit: `a4577f5`)

## Summary: Added SenseVoice-Small Local ASR Engine with Visible Gemini Fallback
1. **Worker Implementation (`backend/workers/sensevoice_worker.py`)**:
   - Primary: FunASR with `SenseVoiceSmall` + `FSMN-VAD` (sentence timestamps) + `CAM++` (speaker diarization).
   - CPU-only execution (zero CUDA assumption), models downloaded and cached locally.
   - Built-in YIN fundamental frequency (F0) pitch estimation per speech segment.
   - Secondary on-device fallback to `sherpa-onnx` using existing local ONNX model in `backend/models/sense-voice`.
2. **Speaker & Pitch Contract Preservation**:
   - `speakerId`: Multi-speaker clustered labels (`spk_1`, `spk_2`, etc.).
   - `pitchHz` & `acousticF0`: Real fundamental pitch in Hertz (e.g. 142.86 Hz male, 215.4 Hz female).
   - `audioGender` & `acousticGender`: Reliable male/female classification, ensuring Stage 5 Reconcile receives 100% of the required data without gender degradation.
3. **Node Wrapper (`backend/services/senseVoiceService.js`)**:
   - Mirroring Demucs audio separation worker pattern: process registry tracking, graceful termination (`taskkill /T /F` on Windows), 300s episode timeout, and comprehensive stderr error surfacing without swallowing.
4. **Routing & Visible Fallback (`stage4_analyzeDialogueAudio.js` & `dubbingPipeline.js`)**:
   - Standard pipeline routes to local SenseVoice ASR first.
   - On worker failure, missing model, or timeout: cleanly catches the error and falls back to Cloud Gemini ASR (`gemini-3.5-transcribe` / multimodal).
   - Visible logging in both console and job progress: `ASR engine: sensevoice-local` or `ASR engine: gemini (fallback — <reason>)`.
5. **Verification & Evidence**:
   - `backend/tests/sensevoice_worker.test.js`: 2/2 passed (error surfacing and file validation).
   - `backend/tests/sensevoice_fallback.test.js`: 1/1 passed (forced failure triggers visible Gemini fallback with reason).
   - `backend/tests/stage4_sense_voice_integration.test.js`: 1/1 passed on real video chunk (`spk_2_male`, pitch 142.86Hz, Chinese text verbatim).
   - Frontend build: `npm run build` passed in 877ms with 0 errors.

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Active Series: `series_1793898268958` (Safe and intact)
- Active Branch: `feat/sensevoice-local-asr` (Pushed to origin, unmerged to main)

## Next Steps
- Run full episode Generate Script in Standard Mode from the UI to observe live progress log: `ASR engine: sensevoice-local`.
