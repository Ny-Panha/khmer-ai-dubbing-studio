# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Z-Index Hierarchy Fix: Subtitle Over Banner)
- **Timestamp**: 2026-11-15T03:18:30+07:00

## Summary: Subtitle Z-Index Priority Fixed
1. **Fixed Layer Stacking**:
   - `AntiTheftOverlay.css`: `.anti-theft-overlay-root` set to `z-index: 1` (was 18).
   - `VideoPlayerPreview.css`: `.live-subtitle-overlay` set to `z-index: 20` (was 10), and `.preview-crop-sub-blur-strip` set to `z-index: 0`.
   - `VideoPlayerPreview.jsx`: Reordered JSX elements so `<AntiTheftOverlay>` is rendered before `<LiveSubtitleOverlay>`.
2. **Outcome**:
   - The anti-theft banner ("រក្សាសិទ្ធិដោយ ៖ DragonDub AI") sits directly on top of the raw video to cover source watermarks/Chinese subs.
   - The yellow Khmer subtitles ("ចប់ហើយ លើកនេះចប់ពិតមែនហើយ") sit on top of the anti-theft ribbon at `z-index: 20`, perfectly visible, clear, and unblurred.
3. **Verification**:
   - `npm --prefix frontend run build` completed with 0 errors (632ms).
   - `backend/tests/workspace_player_containment.test.js` all 7 tests pass.

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Active Series: `series_1793898268958` (Safe and intact)
