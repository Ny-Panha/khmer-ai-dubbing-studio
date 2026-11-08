# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Timeline Clean Spec — FreeCut/OpenCut Anatomy)
- **Timestamp**: 2026-11-08T10:41:00+07:00

## Summary of Completed Work

### 1. FreeCut/OpenCut Anatomy Applied to Timeline
- **Anatomy & Presentation ONLY**: Playback, drag, trim, snap, and windowing logic remain untouched.
- **1. Clip Anatomy**:
  - Every clip structured as **ONE label line** (12px, weight 500, single line truncate) + **ONE content row**.
  - **Zero icons inside clips**: Removed lock, speaker, badge, and avatar icons from voice, subtitle, and video clips.
  - **Voice clip label**: `"#N ប្រុស"` / `"#N ស្រី"` (+ OVER marker as text `" +0.4s"` in label when over). Content row: per-clip waveform bars.
  - **Subtitle clip**: Segment text as label line (no separate `#` badge) over a flat content row.
  - **Video clip**: Clean title over tiled filmstrip frames (`object-fit: cover`, never stretched).
- **2. Shape & Spacing**:
  - Row-filling rectangles with `border-radius: 6px`.
  - 2px gap between adjacent clips (`width = Math.max(2, (endSec - startSec) * pps - 2)`).
  - 4px vertical inset in track rows (e.g., Video 60px row -> 52px clip; Voice/Subs 48px rows -> 40px clips; Clean BGM 40px row -> 32px clip).
  - Zero pill shapes; removed all `box-shadow` glows from clips.
- **3. Low Chroma OKLCH Colours**:
  - Video clip bg: `oklch(0.40 0.04 250)`
  - Voice male bg: `oklch(0.32 0.05 250)`
  - Voice female bg: `oklch(0.32 0.05 350)`
  - Subtitle bg: `oklch(0.35 0.02 290)`
  - Clean BGM bg: `oklch(0.22 0.02 302)`
  - 1px border `oklch(0.25 0.01 250)` with subtle vertical gradient within own hue.
  - Gender carried by label text (`ប្រុស`/`ស្រី`).
  - OVER clips: label text highlighted in mark-out red `oklch(0.61 0.22 29)` — clip bg does not change.
- **4. Single Signal Colour (App Blue Accent)**:
  - App accent (blue `#38BDF8`) is the ONLY signal colour.
  - Selection: 2px solid accent outline (inset via `outline-offset: -2px`) + trim handles visible only on selected clip.
  - Playhead: 2px accent line with small top handle.
  - Deleted red selection outline, red playhead line, and red time flag badge.
- **5. Fixed 112px Track Headers**:
  - Fixed 112px wide, full untruncated names (`VIDEO`, `VOICE 1`, `VOICE 2`, `SUBTITLES`, `CLEAN BGM`).
  - 11-12px labels with exactly 2 mini toggles per header (mute/lock or eye/lock).
  - Row heights: VIDEO 60px, VOICE rows 48px, SUBTITLES 48px, CLEAN BGM 40px.
  - Separated by tonal step (floor `oklch(0.12 0 0)`, header `oklch(0.14 0.01 250)`) + 1px `oklch(0.25 0.01 250)` divider.
- **6. Ruler Spacing**:
  - Time labels in 12px mono, spaced at least ~100px apart across all zoom levels (`00:00`, `00:05`, `00:10` etc.).
  - Minor ticks visibly quieter than major ticks.
- **7. Zoom Cut-offs**:
  - Clips narrower than 5px render as flat colour slivers (no label, no waveform).
  - Labels render only when clip width >= 4 characters (>=32px).
  - Viewport windowing maintained as-is.

### 2. Verification & Visual Evidence
- **Build**: `npm --prefix frontend run build` ➔ **PASS** (1.31s, 0 errors).
- **Screenshots Captured**:
  - `timeline_default_zoom.png`: FreeCut anatomy with 60+ loaded segments at default zoom.
  - `timeline_zoomed_in.png`: Zoomed-in timeline displaying waveforms, `#N ប្រុស/ស្រី` labels, OVER tags in mark-out red, and accent selection trim handles.
  - Full-screen references: `timeline_default_zoom_full.png`, `timeline_zoomed_in_full.png`.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express, online)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, online)
- **Git Branch**: `main`

## Next Steps
- Await Nha's review and approval.
