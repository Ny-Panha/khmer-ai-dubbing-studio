# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Anti-Theft Banner Move & Live Drag Fix)
- **Timestamp**: 2026-11-15T03:04:45+07:00

## Summary: Anti-Theft Copyright Banner Drag & Move Fixed
1. **Direct Mouse Dragging for Bottom Banner**:
   - `AntiTheftOverlay.jsx` & `AntiTheftOverlay.css` now support direct mouse drag up/down.
   - User can click and drag anywhere on the black ribbon to slide it up or down in real time.
2. **On-Hover Nudge Buttons & Controls**:
   - Added hover indicator: `[↕ ចុចអូសឡើងលើ/ចុះក្រោម]` with quick buttons `[⬆ ឡើង] [⬇ ចុះ] [Reset] [✕]`.
3. **Banner Height Slider in Customize Toolbar**:
   - In `VideoTransformControls.jsx`, the `Banner ▾` popup now has a precise height slider (`1% - 60%`).
4. **Backend FFmpeg Sync**:
   - `ffmpegService.js` now uses `antiTheftBottomPercent` to render the banner at the exact customized position in the exported video.

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Active Series: `series_1793898268958` (Safe and intact)
