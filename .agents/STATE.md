# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Diagnosed & Fixed Voice/Khmer Subtitle Timing Mismatch vs CN Cues)
- **Timestamp**: 2026-11-08T13:32:00+07:00

## Latest Update: CN Cue Synchronization, Waveform Truthfulness & Overrun Fix
### 1. Step 1 Diagnosis Findings & Number Dump
- **Layer Classification**: **Branch (A) DATA** (Stage 5 Reconcile swallowed discrete visual cues) + **Branch (B) RENDER** (waveform & duration derivation).
- **Numbers for Segments #16-#20**:
  | Seg ID | startSec | endSec | audioStartSec | audioEndSec | audioDurationSec | sourceStartSec/sourceEndSec | True MP3 Dur |
  | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
  | #16 | 37.00 | 39.23 | 37.00 | 39.23 | 2.23s | 37.00 / 39.23 | 2.23s |
  | #17 | 39.91 | 42.50 | 39.91 | 41.78 | 1.872s | 39.91 / 42.50 | 1.872s |
  | #18 | 42.50 | 43.60 | 42.50 | 44.73 | 2.232s | 42.50 / 43.60 | 2.232s |
  | #19 | 43.60 | 47.29 | 44.75 | 46.98 | 2.232s | 43.60 / 47.29 | 2.232s |
  | #20 | 50.37 | 53.39 | 50.37 | 53.39 | 3.02s | 50.37 / 53.39 | 3.02s |
- **Raw OCR Visual Cues for Window 00:39 - 00:48**:
  - `36.25 - 38.75` (2.50s): "神明不要的孩子" [Male / Priest]
  - `40.00 - 41.25` (1.25s): "老子要" [Male / Father]
  - `41.25 - 42.50` (1.25s): "你凭什么" [Male / Priest]
  - `42.50 - 43.75` (1.25s): "挑战神堂" [Male / Priest]
  - `43.75 - 45.00` (1.25s): "凭什么" [Male / Priest]
  - `45.00 - 46.25` (1.25s): "凭他是老子的崽" [Male / Father]

### 2. Implementation Summary
1. **Stage 5 Reconcile Boundary Preservation (`stage5_reconcileTimelineEvidence.js`)**:
   - Visual OCR cues are discrete anchors. A segment is clamped to `nextVisual.startSec` so long ASR sentences cannot expand across visual boundaries.
   - Pre-deduplication now requires text equivalence (`areChineseTextsEquivalent`), preventing visual cues with different text or speakers from being dropped as false duplicates.
2. **Stage 9 TTS Duration Integrity (`stage9_generateSegmentTTS.js`)**:
   - In `canReuseExisting`, always calls `getMediaDuration` so `audioDurationSec`, `finalAudioDuration`, and `audioEndSec` reflect true MP3 file duration rather than inherited slot length.
3. **Render Box & Waveform Alignment (`TimelineTracksCanvas.jsx` & `VideoPlayerPreview.jsx`)**:
   - Voice clip box = `[audioStartSec, max(slotEnd, audioStartSec + realAudioDuration)]`.
   - Waveform bars mapped to `realAudioDuration` so no empty tail or artificial stretching occurs.
   - Live subtitles strictly use segment dialogue slot `[startSec, endSec]`, never leaking `audioEndSec`.
   - OVER badge truthful formula: `realAudioDuration - (slotEnd - slotStart)`.
4. **Episode 2 Stored Data Synchronized (`series.json`)**:
   - Corrected #17, #18, #19 to their probed MP3 durations (1.872s, 2.232s, 2.232s).
   - Segments #16-#20 now flow sequentially on Lane 0 (VOICE 1) without unnecessary collision stacking.

### 3. Verification Evidence
- `node --test backend/tests/*.test.js` ➔ **38/38 PASS** (0 failures).
- `npm --prefix frontend run build` ➔ **PASS** (617ms).
- Playback window 00:39 -> 00:48: Subtitles change strictly on cue boundaries, waveform maps to true audio duration, and no artificial stacking occurs.

## Previous Session Summary
1. **Decoupled Network I/O from Local Storage (`projectStorage.js` & `api.js`)**:
   - Added `syncSeriesApi(series)` and `deleteEpisodeApi(seriesId, episodeId)` into [`frontend/src/services/api.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js) with unified 502 offline detection and status tracking.
   - Refactored [`frontend/src/utils/projectStorage.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js) to delegate through `api.js` client functions rather than raw, unhandled `fetch` calls.
2. **Eliminated Pass-through Proxy Wrapper (`formatTime.js`)**:
   - Re-routed all component imports (`MediaLibrary.jsx`, `TimelineEditor.jsx`, `VideoPlayerPreview.jsx`, `VoiceSettings.jsx`, `useAudioDubbing.js`, `useClipOperations.js`, `projectStorage.js`, `timelineUtils.js`) directly to [`frontend/src/utils/timestampUtils.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/timestampUtils.js).
3. **Single Canonical Audio Duration Resolver**:
   - Added canonical `getSegmentAudioDuration(seg, fallback)` and `hasSegmentAudio(seg)` in `timestampUtils.js`.
   - Replaced fragile, duplicated 5-level ternary cascades across [`frontend/src/utils/timelineUtils.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/timelineUtils.js) (`alignVoiceClipsNoOverlap` and `resetSegmentsToSourceTiming`).
4. **Verification & Zero Regressions**:
   - `npm --prefix frontend run build` ➔ **PASS** (1.00s, 0 errors).
   - `node --test backend/tests/auto_align_voice.test.js` ➔ **3/3 PASS** (76ms).
   - `node --test backend/tests/phase1_translation_boundary.test.js` ➔ **7/7 PASS** (1.98s).

## Previous Session Summary

### 1. Bug 1: `isTrimmed` ReferenceError in Preview Sync Loop (Fixed & Verified)
- **Problem**: Playing preview with trimmed segments threw `Uncaught ReferenceError: isTrimmed is not defined at VideoPlayerPreview.jsx:353` inside `syncLoop` (requestAnimationFrame).
- **Root Cause**: In [`frontend/src/components/VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx), `isTrimmed` was defined at L304 inside the `nearbySegs.filter(...)` callback, but was referenced at L353, L375, and L377 inside the subsequent `nearbySegs.forEach(...)` callback where it was out of scope.
- **Fix**: Added per-segment declaration `const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);` right before `effectiveSegEnd` inside the `forEach` callback. Audited the full file and confirmed zero other out-of-scope uses exist.
- **Verification Evidence**:
  - Loaded `series_1793898268958` EP 1 with trimmed segments `#17 ✂` and `#18 ✂`.
  - Seeked preview to `40.0s` and played through to `45.0s` across the trimmed boundaries.
  - Video playhead reached `44.96s` smoothly.
  - Console captured **0 ReferenceErrors** and **0 unhandled errors**.
  - Evidence screenshot: [`preview_playback_verified.png`](file:///C:/Users/nhastar/.gemini/antigravity/brain/6ac10be3-1a63-456e-8d37-a5ad1ac624ae/preview_playback_verified.png).

### 2. Bug 2: Generate-Script Backend Diagnosis & Stability Verification
- **Diagnosis & Stack Trace Findings**:
  - The `WORKER_INTERRUPTED` error (`job_1794115891810_27bd3cf0`) occurred when task-1657 was cancelled during development while `ep_2` was processing in `chunkASR`. On the subsequent server startup, `backend/services/pipeline/recoveryEngine.js` marked the dangling job:
    ```json
    {
      "status": "failed",
      "error": "WORKER_INTERRUPTED",
      "stageMessage": "ការងារត្រូវបានរំខានដោយសារ Server បាន Restart ឬ Worker បានដាច់ (Worker Interrupted)"
    }
    ```
  - When the frontend received `WORKER_INTERRUPTED`, [`frontend/src/hooks/useScriptWorkflow.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useScriptWorkflow.js) (L255-261) triggered its fallback to direct synchronous generation (`generateScriptApi`).
  - At that exact moment, the replacement backend instance had crashed with `EADDRINUSE: address already in use 0.0.0.0:5000` because Windows had not yet released port 5000, causing Vite proxy to emit `ECONNRESET` / 502 ("Backend server is temporarily unreachable").
- **Verification & Endurance Test**:
  - Started the unified stack using `npm run dev`.
  - Executed `POST /api/jobs/generate` for `ep_2` (187.34s action drama video):
    - Vision OCR: 85 visual segments
    - Local SenseVoice-Small ASR: 30 Chinese speech segments ($0.00 cost)
    - Timeline Evidence Reconciliation: 79 reconciled segments
    - Mode A Faithful Translation: 79 lines translated across 4 batches via Gemini 3.5 Flash
    - Subtitle Validation & Timing Check: 100% verified, `.ass` generated
    - Saved to `series.json`: 79 script segments persisted
    - Final Status: `completed` (100% progress, 0 errors)
  - **Verdict**: Backend process survived continuously with **0 crashes, 0 unhandled rejections, and 0 hangs**. Port 5000 and 5173 remained online and healthy throughout the entire multi-stage pipeline run.

## Active Environment
- **Startup Command**: `npm run dev` (Starts BOTH Backend on port 5000 and Frontend on port 5173 with `concurrently`)
- **Backend API**: `http://localhost:5000` (Node.js/Express, online)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, online)
- **Git Branch**: `main`

## Next Steps
- Await Nha's review and approval.
