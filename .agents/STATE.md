# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T19:18:00+07:00

## Summary
- User Request: "Feature: Global Series Folder Selector with isolated multi-series workspaces. Add a compact folder dropdown to the top Navbar near the existing Episode Selector so user can switch between ss1, ss2 and other series without going back to Home Dashboard, while preserving active episode, video, timeline, subtitles, voice assignments, playhead, and running background jobs."
- Implementation Details:
  1. Top Navbar UI (`Navbar.jsx` & `Navbar.css`):
     - Added `Folder` icon and a styled `.navbar-series-switcher` dropdown right next to `/` and the Episode Switcher.
     - Dynamically lists all series from `seriesList` showing title, episode count (`ss1 (28 ភាគ)`, `ss2 (25 ភាគ)`), and highlights active series with `✓`.
     - Matched Studio dark theme styling.
     - Available globally across Studio, Batch, Export, and Jobs views.
  2. App Integration (`App.jsx`):
     - Passed `seriesList={series.seriesList}` and `onSwitchSeries={series.handleSwitchSeries}` into `MemoNavbar`.
     - Updated `MemoNavbar` comparator to re-render appropriately on series or seriesList changes.
  3. Multi-Series Workspace Isolation (`useSeriesManager.js` & `projectStorage.js`):
     - Implemented `getActiveEpisodeIdForSeries` and `setActiveEpisodeIdForSeries` to remember and restore the exact last-edited episode per series, avoiding unwanted resets to episode 1.
     - Saved full workspace snapshot (`video`, `metadata`, `scriptData`, `speakerRegistry`, `videoClips`, `voiceSettings`) before switching away.
     - Added `switchSeriesSeqRef` to discard stale server responses on rapid `ss1 -> ss2 -> ss1` toggling.
  4. Background Runner Isolation (`DubbingRunnerContext.jsx` & `dubbingExecutionAdapter.js`):
     - Scoped batch runner state and `stopStep` operations by `seriesId`.
     - Prioritized `context.seriesId || ep.seriesId` so background batch runs (e.g. Clean BGM on `ss1`) continue uninterrupted without leaking into `ss2`.
  5. Episode Selection Isolation (`useEpisodeSelection.js`):
     - Scoped modal selection by `seriesId` to prevent selected episode IDs from one series contaminating another.
  6. Regression Tests (`backend/tests/series_folder_selector_workspace.test.js`):
     - 7/7 automated tests covering Navbar rendering, App props, storage persistence, workspace snapshot, runner seriesId scoping, and adapter isolation.

- Verification:
  - `node --test backend/tests/series_folder_selector_workspace.test.js`: 7/7 PASSED.
  - `node --test backend/tests/cast_voice_switching.test.js`: 9/9 PASSED.
  - `npm run build`: Succeeded in 1.28s (0 errors).

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Available Series: ss1 (28 eps), ss2 (25 eps)

## Next Steps for User
- Refresh page in browser (F5).
- On top Navbar, click the new Folder dropdown `[📁 ss1 (28 ភាគ) ▼]` to switch to `ss2 (25 ភាគ)` instantly.
- Work on `ss2`, then switch back to `ss1` — all edits, video, timeline, and episode positions are preserved!
