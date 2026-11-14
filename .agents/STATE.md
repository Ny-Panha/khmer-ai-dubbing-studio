# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Video Position Lock & Move Removal)
- **Timestamp**: 2026-11-15T03:13:30+07:00

## Summary: Video Frame Movement Locked (Fixed & Stationary)
1. **Completely Disabled Video Canvas Drag / Pan**:
   - In `VideoPlayerPreview.jsx`, removed mouse drag pan logic (`isPanning`, `effectivePanX`, `effectivePanY`, `livePan`) on standard video.
   - Video element style is strictly locked to `transform: 'none'` with `cursor: 'pointer'`. Normal clicks strictly trigger Play / Pause.
   - Preserved only the 9:16 portrait crop horizontal framing drag when explicitly in 9:16 portrait mode.
2. **Cleaned Customize Toolbar**:
   - In `VideoTransformControls.jsx`, removed video zoom in/out, 100% badge, and the `+ Move` (Hand tool) button that caused video shifting.
   - Retained only the controls Nha wants to customize:
     - `Logo ▾` (Watermark corner positions ↖ ↗ ↙ ↘ ↔ & size slider)
     - `Banner ▾` (Copyright ribbon position ⬇ ⬆ & height slider 1% - 60%)
3. **Verification**:
   - `npm --prefix frontend run build` completed with 0 errors (799ms).

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Active Series: `series_1793898268958` (Safe and intact)

## Next Steps
- User can freely adjust Logo and Banner overlays without worrying about the video shifting off-center.
