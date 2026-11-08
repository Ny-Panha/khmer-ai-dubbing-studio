# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Export Format Follows Source Video + 9:16 Full-Bleed Center Crop)
- **Timestamp**: 2026-11-08T16:55:00+07:00

## Latest Update: Export Format Follows Source Video & Full-Bleed 9:16 Crop Style

### 1. Step 0 Trace & Findings
- **Data Flow Trace**:
  - `stage2_analyzeSourceMedia.js` extracts `{ width, height, aspectRatio, resolution }` via `getVideoMetadata(inputVideoPath)`.
  - `episodePipelineOrchestrator.js` attaches `mediaAnalysis` to checkpoints and persists `metadata: { width, height, resolution, fps, durationSec }` and `video: { width, height, resolution }` in `series.json`.
  - `backend/routes/videoRoutes.js` (`/api/video-metadata` and `/api/split-video-episodes`) extracts and returns probed `width, height, resolution` instead of hardcoded 1080p.
  - `frontend/src/hooks/useWorkspaceMedia.js` queries `/api/video-metadata` and sets `selectedVideo` and `videoMetadata` with probed `{ width, height, resolution }`.
  - `frontend/src/hooks/useSeriesManager.js` preserves `width, height, resolution` on `episode.video` and `episode.metadata`.
  - Exact paths used: `videoMetadata.width/height`, `selectedVideo.width/height`, `activeEpisode.metadata.width/height`, `activeEpisode.video.width/height`.

### 2. Implementation Summary
1. **Frontend (`frontend/src/`)**:
   - `utils/projectStorage.js`:
     - Changed default `aspectRatio: '16:9'` to `aspectRatio: null`, added `verticalStyle: 'pad'`.
     - Exported `resolveDefaultAspectRatio(width, height)`:
       - `height > width` $\to$ `'9:16'` (portrait)
       - `width > height` $\to$ `'16:9'` (landscape)
       - `width === height` $\to$ `'1:1'` (square)
       - Missing/zero $\to$ `null` (triggers last-resort fallback with warning).
   - `services/api.js`:
     - In `renderVideoApi`, removed blanket `'16:9'` default. Defaults to `null`, resolves dynamically from source dimensions, falls back to `'16:9'` with console warning only if metadata missing.
   - `hooks/useVideoRender.js`:
     - Resolves `effectiveAspectRatio` from source video metadata or active episode metadata. Passes `aspectRatio` and `verticalStyle` to `/api/render-video`.
   - `components/voice/ExportSettingsPanel.jsx`:
     - Receives `videoMetadata` and `activeEpisode`.
     - Displays explainable source hint next to Aspect Ratio dropdown: `Source: 1080×1920 — vertical` or `Source: 1920×1080 — horizontal`.
     - Displays conditional **Vertical Framing Style** selector when `effectiveAspectRatio === '9:16'`:
       - `Pad — black bars, full frame visible` (default cinema letterbox)
       - `Crop — full-bleed center crop` (full phone screen, no bars).
   - `components/VoiceSettings.jsx` & `App.jsx`:
     - Wired `videoMetadata` and `activeEpisode` props down to `ExportSettingsPanel`.

2. **Backend (`backend/`)**:
   - `services/ffmpegService.js`:
     - In `renderDubbedVideoWithDucking`:
       - Resolves `targetAspectRatio` from `sourceDimensions` when not explicitly specified (no manual select).
       - In `9:16` Crop mode: applies `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,setsar=1`.
       - In `9:16` Pad mode: applies `scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(1080-iw)/2:(1920-ih)/2:color=black,setsar=1`.
       - In `16:9` manual override on vertical source: applies `scale=-2:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(1920-iw)/2:(1080-ih)/2:color=black,setsar=1`.
       - In `1:1` manual override: applies `scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(1080-iw)/2:(1080-ih)/2:color=black,setsar=1`.
       - Dynamically checks `isVideoFiltered` to prevent `Streamcopy requested for output stream fed from a complex filtergraph` error.
       - Adjusts watermark logo topMargin in 9:16 pad mode (`656 + baseMargin`) vs crop mode (`baseMargin`).
     - In `generateKhmerAssSubtitleFile`:
       - In `9:16` Crop mode or naturally vertical video: uses `PlayResX: 1080, PlayResY: 1920`, `effFontSize = 44`, `effMarginV = 130` (or 180 when marquee is bottom). Subtitle bounding box sits safely inside the 1080-width canvas with 60px side margins, never cut at sides.
       - In `9:16` Pad mode with landscape source: keeps `effMarginV = 720` to center subtitles on the letterbox video band.
   - `routes/videoRoutes.js`:
     - In `/api/render-video`: Reads `rawAspectRatio` and `verticalStyle`. Auto-detects aspect ratio from video metadata if omitted or empty.
     - In `/api/split-video-episodes`: Uses probed metadata width/height instead of hardcoded 1920x1080.

### 3. Verification Results (a)-(e)
All 5 required verification scenarios tested end-to-end with FFmpeg and ffprobe:
- **(a) Vertical source episode, no manual select**:
  - Source: 1080×1920 vertical video
  - Export: **1080×1920** (DAR 9:16) — **PASS**
- **(b) Landscape source, no manual select**:
  - Source: 1920×1080 Ep2 landscape video
  - Export: **1920×1080** (DAR 16:9) — **PASS**
- **(c) Landscape source + 9:16 Pad**:
  - Export: **1080×1920** with top & bottom black cinema bars, full frame visible — **PASS**
- **(d) Landscape source + 9:16 Crop**:
  - Export: **1080×1920** full-bleed (zero black bars), frame centre-filled, Khmer subtitle burned at 00:41 with pristine readability inside safe margins — **PASS**
- **(e) Manual select overrides source default**:
  - (e1) Vertical source + manual 16:9 $\to$ **1920×1080** (pillarbox pad) — **PASS**
  - (e2) Landscape source + manual 9:16 $\to$ **1080×1920** (center crop) — **PASS**

### 4. Test Suite & Build Status
- **Frontend Build**: `npm --prefix frontend run build` ➔ **PASS** (0 errors, 1.05s).
- **Backend Test Suite**: `node --test backend/tests/*.test.js` ➔ **54 PASS, 0 FAIL, 1 SKIPPED**.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- Production pipeline test with full dubbing workflow on diverse portrait/landscape drama episodes.
