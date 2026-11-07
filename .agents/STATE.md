# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Demucs Separation Speed Diagnosis, Pinned `htdemucs`, and Truthful Model Label)
- **Timestamp**: 2026-11-08T00:15:00+07:00

## Summary of Completed Work

### 1. Demucs Model & Hardware Diagnosis (Step 1)
- **Diagnosed Backend Console Log**:
  - Found console log line from Nha's EP1 run:
    `[AudioSeparation] 🎧 Launching Demucs separation for: ep_1_source.mp4 (Model: htdemucs, Device: auto, Overlap: 0.25)`
  - **REAL Model**: `htdemucs`
  - **REAL Device**: `cpu` (PyTorch version `2.15.0+cpu` with `torch.cuda.is_available() == False`).
  - **Root Cause of Slowness**: `htdemucs_ft` was **never** passed in the backend. In the pushed backend, every default was already `htdemucs`. The ~7%/min separation speed (~14 minutes total for 03:42 EP1) is pure single-model CPU speed running Demucs without GPU acceleration.

### 2. Explicitly Pinned Model at All Call Sites (Step 2)
- Added `model: 'htdemucs'` explicitly to both primary invocation points:
  - [`backend/routes/audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js): Line ~487 (`separateAudio({ audioPath: inputVideoPath, model: 'htdemucs' })`).
  - [`backend/services/ffmpegService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js): Line ~1088 (`separateAudio({ audioPath: inputVideoPath, model: 'htdemucs', jobId })`).
  - Service and worker defaults maintained at `'htdemucs'`.

### 3. Two-Stems Output Verification (Step 3)
- Verified [`backend/workers/demucs_worker.py`](file:///e:/khmer_ai_dubbing_studio/backend/workers/demucs_worker.py):
  - Line 195 already specifies `--two-stems=vocals`.
  - Output folder logic isolates `vocals.wav` and `no_vocals.wav` and copies them directly to `output_dir` (matching service cache checks).

### 4. Truthful UI Model Label (Step 4)
- [`frontend/src/components/dashboard/route-runners/EpisodeDemucsProgressCard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/route-runners/EpisodeDemucsProgressCard.jsx):
  - Removed both hardcoded `htdemucs_ft` strings (lines ~99 and ~274).
  - Dynamically computes `modelName = liveStats?.model || ep?.demucsModel || ep?.model || 'htdemucs'`.
  - Terminal title now truthfully displays `CONSOLE LOGS (Demucs AI Model: {modelName})`.
  - Dynamic message shows `AI Deep Learning Stem Separation ({modelName})...`.
- Backend support:
  - [`backend/services/audioSeparationService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/audioSeparationService.js): Included `model` in `activeSeparationProgress`.
  - [`backend/routes/audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js): Included `model` in `/api/audio/separation-progress` response.

### 5. Verification & Cache Notes (Step 5)
- **Separation Verification**:
  - EP1 (03:42, 222.8s) run completed 100% in **14 minutes and 26 seconds** (866s wall-clock) at ~7.2%/min on CPU.
  - Launch log confirmed: `(Model: htdemucs, Device: auto, Overlap: 0.25)`.
  - API progress check returns `model: 'htdemucs'`.
  - Cache directory computed with `model = 'htdemucs'` is saved at `uploads/cache/separation/0410e96ce17bdcf2538435006f208317/`.
- **Frontend Build**: `npm --prefix frontend run build` ➔ **PASS** (574ms, 0 errors).
- **Backend API**: Verified online at `http://localhost:5000`.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express, online)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, online)
- **Git Branch**: `main`

## Next Steps
- **PROMPT 1**: Fast OCR plan revision (incorporate speakerGender fallback, OCR dedupe/merge, external SRT full stack, re-translate safety, persist generationMode, and skip Stage 4/5 safely).
- **PROMPT 4 / Performance Step 3**: Virtualize ScriptReviewTab segment list + window TimelineTracksCanvas clips.
- Git HEAD: `a84b8edb2b8e18c640ee509b6713aa9cab1829c1` (pushed to `origin/main`).
