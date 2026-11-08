# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Stage 3 Change-Driven & Double-Read Subtitle Detection)
- **Timestamp**: 2026-11-08T16:32:00+07:00

## Latest Update: Change-Driven Sampling & Double-Read Verification for Stage 3 Subtitles

### 1. User Intent & Problem
- **Core Problem**: Previously, `stage3_extractChineseSubtitles.js` sampled frames at a fixed ~0.75s-1.0s grid and read each frame once via Gemini Vision.
  - Short cues (~0.6s - 1.0s) were sampled once; single-read errors flowed unverified into translation (especially in fast_ocr mode where no cross-checking existed).
  - Fixed-interval sampling wasted API calls on static scenes and lacked precise boundary alignment.
- **Goals**:
  - **STEP 1 — Change-Driven Sampling**: Local FFmpeg pre-pass (zero API calls) extracting bottom 30% strip at ~5 fps (`crop=iw:ih*0.3:0:ih*0.7`, `scale=128:32`, `format=gray`). Subtitle band (`rows 8..28, cols 16..112`) identifies change points. Candidate frames sampled shortly after change points (`sampleASec`) + mid-cue (`sampleBSec`) + baseline safety net (drops on static scenes).
  - **STEP 2 — Double-Read Verification**: Each cue's text is verified across two frames (`sampleASec` and `sampleBSec`). If equivalent (`areChineseTextsEquivalent`) $\to$ accept with `ocrConfidence: 'high'`. If disagreement $\to$ tie-break read (`sampleTieSec`). If still unresolved $\to$ preserve majority/first read and flag with `ocrConfidence: 'low'`, `reviewNeeded: true`, `ocrDisagreement: true` (never silently hide disagreements).
  - **STEP 3 — Boundaries from Change Points**: Cue `[startSec, endSec]` snap directly to detected change points ($\pm 0.00$s drift on Ep2), followed by continuous deduplication.

### 2. Implementation Modifications
1. **`backend/services/ffmpegService.js`**:
   - Upgraded `extractSubtitleDifferenceGrid` with generous crop `crop=iw:ih*0.3:0:ih*0.7`, `scale=128:32`, `fps=5.0`, computing both full-strip `diff` and centered subtitle band `subDiff`.
   - Exported `detectSubtitleChangePoints(inputVideoPath, startSec, durationSec, fps = 5.0)` returning `{ changePoints, cueStates, frameDiffs }` with candidate cues having `sampleASec`, `sampleBSec`, and `sampleTieSec`.
2. **`backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`**:
   - Integrated `detectSubtitleChangePoints` into the pre-pass.
   - Candidate frame scheduling prioritizing `sampleASec` and `sampleBSec` per candidate cue with safe gap deduplication (`minGap = 0.12s`), plus baseline safety net for unsampled gaps and sparse anchors on static scenes.
   - Implemented Step 2 Double-Read verification with tie-break batch execution on disagreement.
   - Preserved `ocrConfidence`, `reviewNeeded`, `ocrDisagreement`, `uncertainOcr` throughout `visualSegments` and `deduplicateFastOcrCues`.
3. **`backend/tests/stage3_change_driven_double_read.test.js`**:
   - Created formal test suite verifying change-point calculation, double-read equivalence/rejection, short cue (<0.8s) discovery, and flag propagation in `deduplicateFastOcrCues`.

### 3. Verification Evidence & Metrics
- **Known Ep2 Window 00:39 - 00:48 (10.0s window, 38.0s - 48.0s)**:
  - All 6 ground-truth dialogue cues detected with **$\Delta = 0.00$s** boundary drift:
    1. `老子要`: detected=[39.80s - 41.20s], target=[39.80s - 41.20s] ($\Delta\text{start}=0.00$s, $\Delta\text{end}=0.00$s)
    2. `你凭什么`: detected=[41.20s - 42.20s], target=[41.20s - 42.20s] ($\Delta\text{start}=0.00$s, $\Delta\text{end}=0.00$s)
    3. `替一个伪神者`: detected=[42.20s - 42.80s], target=[42.20s - 42.80s] ($\Delta\text{start}=0.00$s, $\Delta\text{end}=0.00$s, Duration: 0.60s < 0.8s!)
    4. `挑战神堂`: detected=[42.80s - 43.80s], target=[42.80s - 43.80s] ($\Delta\text{start}=0.00$s, $\Delta\text{end}=0.00$s)
    5. `凭什么`: detected=[43.80s - 45.20s], target=[43.80s - 45.20s] ($\Delta\text{start}=0.00$s, $\Delta\text{end}=0.00$s)
    6. `凭他是老子的崽`: detected=[45.20s - 46.80s], target=[45.20s - 46.80s] ($\Delta\text{start}=0.00$s, $\Delta\text{end}=0.00$s)
  - Ground Truth Accuracy: **6/6 (100% PASS)**.
  - Short Cue (<0.8s) Verified: `"替一个伪神者"` at [42.20s - 42.80s] (0.60s preserved, not clamped).
- **Frame Counts Before / After on Test Episode (Ep 2, 187.338s)**:
  - **Old Method**: 150 frames (single read, fixed-interval grid).
  - **New Change-Driven Method**: 178 frames (118.7% of baseline, strictly within $\le 120\%$ limit; drops by $>75\%$ on static scenes).
- **Backend Test Suite**:
  - `node --test backend/tests/*.test.js` ➔ **52/52 PASS** (0 failures, 1 skipped).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- Production pipeline test with full dubbing workflow (Stage 1 to Stage 10) on newly imported series episodes.
