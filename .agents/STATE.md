# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Fix Stacked/Overlapping Dialogue — Audio Clamping & Trim-Aware Mix)
- **Timestamp**: 2026-11-08T11:35:00+07:00

## Summary of Completed Work

### 1. Step 0 Diagnosis Report
- **(a) Audio Trimming in Mix Paths**:
  - **Pre-rendered master narration track (`createSynchronizedNarrationAudio` in `backend/services/ffmpegService.js`)**: Audio was placed **WHOLE** without `atrim`! In lines 1874-1881 and 1930-1956, `trimPrefix` was only constructed if `seg.audioOffset` was defined. For standard frontend segments, `audioOffset` was undefined, so `trimPrefix` remained empty and `durSec` used the whole probed file duration `audioDurationSec`.
  - **Fallback mix path (`renderDubbedVideoWithDucking` lines 1208-1243)**: Audio was placed **WHOLE**! Zero `atrim` filter was present before `adelay + amix`.
- **(b) `atempo` Stretch Cap**:
  - In `backend/services/ttsService.js` (L376, L533-534): `maxSpeed` defaults to `1.35x`. However, stretching only occurs when `ratio > 1.02 && ratio <= 1.30`. Lines with > 30% overrun were NOT stretched at all and played at 1.0x (OVER).
  - In `backend/services/ffmpegService.js` (`autoStretchTtsAudio` L433, L518): `maxSpeed` defaults to `1.35x`, capping speed stretch at 1.35x.

### 2. Step 1: Overwrite Semantics in `autoAlignVoiceSegments`
- In [`frontend/src/utils/timelineUtils.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/timelineUtils.js):
  - Added `getSourceSubtitleEnd(s)` helper checking `speechEndSec`, `slotDuration`/`availableSlotDuration`, and `sourceEndSec`.
  - When segment N collides with previous Lane 0 clip ONLY because previous audio overruns N's start:
    - Verifies subtitle slots themselves do not genuinely overlap in source timing (`N.startSec >= prevLane0.sourceSubtitleEnd - 0.05`).
    - Calculates cut duration `prevLane0.audioEndSec - N.startSec` and ratio `cutDur / origAudioDur`.
    - If `cutRatio <= 0.40`: resolves on Lane 0 by clamping `prevLane0.audioEndSec = N.startSec`, updating its `duration`/`audioDurationSec`, setting `audioTrimmed: true`, and keeping segment N on VOICE 1 (`targetRow = 0`) at its exact start time (0% drift, never shifted forward).
    - Drops to VOICE 2 (Lane 1) ONLY when subtitle slots genuinely overlap (e.g. #12 vs #13 visual card) or when trim cut > 40%.
    - Updated `resetSegmentsToSourceTiming` to reset `audioTrimmed: false` and restore natural audio duration.

### 3. Step 2: Mix Honours the Trim
- In [`backend/services/ffmpegService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js):
  - In `createSynchronizedNarrationAudio` (single-segment and `mixBatch`): calculates `trimDur` from `seg.audioTrimmed`, `seg.userTrimmed`, or clamped `audioEndSec - audioStartSec`. Applies `atrim=start=${audioOffset}:duration=${trimDur},asetpts=PTS-STARTPTS,` so trimmed tails are never heard under the next line.
  - In `renderDubbedVideoWithDucking` fallback path: adds `trimFilter` before `aformat`, `volume`, and `adelay`.
- In [`backend/routes/audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js):
  - Mapped `audioTrimmed: Boolean(s.audioTrimmed)` and `audioEndSec: s.audioEndSec` in `/api/sync-audio`.
  - Updated cache fingerprint to include `audioTrimmed` and `audioEndSec`, guaranteeing cache invalidation when a segment is trimmed.

### 4. Step 3: Visible Flag & Preview Sync
- In [`frontend/src/components/timeline/TimelineTracksCanvas.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTracksCanvas.jsx):
  - Trimmed voice clip label gains `" ✂"` suffix: `#N ប្រុស ✂` / `#N ស្រី +0.4s ✂` (text only, 0 new icons/pills per clean spec).
  - Respects `audioTrimmed` so clip width ends exactly at clamped `audioEndSec`.
  - In `internalSegmentRows`, respects `typeof seg.trackRow === 'number'` and `audioTrimmed` without artificially pushing clips to lane 1.
- In [`frontend/src/components/media/ScriptReviewTab.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/ScriptReviewTab.jsx):
  - Preserves duration OVER alert / badge when `audioTrimmed` is true so users know which lines to shorten or re-generate.
- In [`frontend/src/components/VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx):
  - Stops preview playback cleanly at `audioEndSec` when trimmed (`segAudioEndLimit`), preventing tail audio bleed during real-time preview.

### 5. Verification Evidence
- **Real Episode 1 Test (`series_1793898268958` EP1)**:
  - **Before Auto-Align**: `#17 ស្រី +1.1s (track 0)`, `#18 ប្រុស (track 1)`, `#19 ស្រី (track 0)`.
  - **After Auto-Align**: `#17 ស្រី +1.1s ✂ (track 0)`, `#18 ប្រុស +0.1s ✂ (track 0)`, `#19 ស្រី (track 0)`. All 3 sit on VOICE 1!
  - **Undo**: Restores pre-align state with `#18` on track 1.
  - **Reset Timing**: Restores source timing with `#18` on track 1.
  - **Export Mix**: Master narration track generated via `createSynchronizedNarrationAudio` with `atrim` cuts; 0 tail bleed.
  - **Unit Tests**: `node --test backend/tests/auto_align_voice.test.js` ➔ **3/3 PASS** (0.15s).
  - **Frontend Build**: `npm --prefix frontend run build` ➔ **PASS** (1.29s, 0 errors).
  - **Console**: Verified **0 console errors**.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express, online)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, online)
- **Git Branch**: `main`

## Next Steps
- Await Nha's review and approval.
