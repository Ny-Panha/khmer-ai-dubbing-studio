# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Implemented Subtitle Track Show/Hide Toggle on Timeline)
- **Timestamp**: 2026-11-08T14:52:00+07:00

## Latest Update: Subtitle Track Show/Hide Toggle on Timeline (`Subs ON / Subs OFF`)

### 1. Architectural Intent & User Workflow
- **Context**: In Khmer Dubbing Studio, dialogue text is created and refined in the Script tab; audio synthesis and mixing happen on the timeline.
- **Problem**: When focusing on audio mixing and voice alignment, subtitle text clips on the timeline created visual noise and consumed vertical screen real estate.
- **Solution**: A clean view-only toggle on `TimelineToolbar` allows toggling subtitle tracks on/off on demand.

### 2. Implementation Specifications
1. **Toggle in TimelineToolbar**:
   - Positioned in `TimelineToolbar.jsx` directly next to the Snap toggle (`Magnet Snap`).
   - Styled identically to toolbar tools (`className="timeline-pill-tool tool-magnet (active)"`).
   - Clean text button displaying `Subs ON` (when active) and `Subs OFF` (when hidden). No pill container, no new icon set.
2. **OFF State Rendering Behavior**:
   - When OFF, both SUBTITLES 1 and SUBTITLES 2 rows (track headers in `TimelineTrackHeaders.jsx` and track lanes in `TimelineTracksCanvas.jsx`) completely disappear.
   - The timeline vertically shrinks to `VIDEO` / `VOICE 1` / `VOICE 2` / `CLEAN BGM`.
   - When ON, both subtitle rows and text clips restore to their exact timeline positions.
3. **Persistence & Default State**:
   - Default state on first run is strictly **OFF** (`false`) per user preference.
   - Persisted in `localStorage` under `TIMELINE_SHOW_SUBTITLES`, surviving page reloads and episode switches.
4. **VIEW ONLY Hard Boundary**:
   - Subtitle segment data (`scriptSegments`, `scriptData.segments`) is never mutated.
   - VideoPlayerPreview subtitle overlay and audio alignment algorithms (`onAutoAlignNoOverlap`, `onResetToSourceTiming`) remain completely unaffected.
   - Video render & export pipeline (`renderDubbedVideoWithDucking`, `renderVideoApi`) continues to burn subtitles into final MP4 exports regardless of timeline track visibility.

### 3. Verification Evidence
- **Unit & Static Architecture Suite**:
  - `node --test backend/tests/*.test.js` ➔ **49/49 PASS** (0 failures, 1 skipped).
  - Test file `backend/tests/timeline_subtitles_toggle.test.js` verified:
    1. `localStorage` reading, initial default `false` (OFF), and persistence effect.
    2. Toolbar text button presence and `Subs ON` / `Subs OFF` text rendering.
    3. Absence of subtitle headers and lanes when `showSubtitles` is false.
    4. VIEW-ONLY boundary: `VideoPlayerPreview` and `videoRoutes` export pipeline do not read timeline toggle state.
- **Frontend Production Build**:
  - `npm --prefix frontend run build` ➔ **PASS** (1.30s, 0 errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- Full production voice dubbing and video export testing with hidden/shown subtitle tracks.
