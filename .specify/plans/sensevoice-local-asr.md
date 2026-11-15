# Plan: SenseVoice-Small Local ASR for Standard Pipeline

## 1. Architecture & Component Boundary
- Target Files to Create / Modify:
  - `backend/workers/sensevoice_worker.py` [NEW]
  - `backend/services/senseVoiceService.js` [NEW]
  - `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js` [MODIFY]
  - `backend/services/pipeline/dubbingPipeline.js` [MODIFY]
  - `backend/tests/sensevoice_worker.test.js` [NEW]
- Data Flow & State Management:
  - FFmpeg extracts 16kHz audio -> `senseVoiceService` spawns `sensevoice_worker.py`
  - Output stdout JSON parsed with `{ speechSegments, audioMeta }`
  - If error/timeout: catches cleanly, logs fallback reason, calls existing Gemini ASR
  - Stage 5 Reconcile consumes `speakerId`, `voiceGender`, and `pitchHz/acousticF0`

## 2. API & Data Contracts
- Segment shape:
  - `startSec` (float), `endSec` (float), `duration` (float)
  - `spokenChineseText` (string)
  - `speakerId` (string, e.g. `spk_1`, `spk_2`)
  - `audioGender` (string: `male` | `female` | `unknown`)
  - `pitchHz` (float, F0 in Hz)
  - `acousticGender` (string: `male` | `female`)
  - `source`: `sense_voice_local`

## 3. Risks, Security & Rollback
- Reversible branch: `feat/sensevoice-local-asr`.
- Out of scope: Fast OCR mode, OCR stages, Stage 6 Translate, TTS, Demucs, Export.
- Visible fallback guaranteed (no silent degradation).
