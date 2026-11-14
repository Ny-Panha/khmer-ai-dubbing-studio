# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Branch: `feat/upload-new-series`)
- **Timestamp**: 2026-11-14T17:34:40+07:00

## Summary: Brand-New Series Upload Flow & Series Switcher
1. **Target Choice in `MediaUploadTab.jsx`**:
   - Added quiet target choice row: `(a) Series បច្ចុប្បន្ន — <title>` (default, unchanged) vs `(b) ＋ Series ថ្មី`.
   - Added Khmer guards: empty title block (`សូមបញ្ចូលឈ្មោះ Series ថ្មី!`) and duplicate series guard (`Series នេះមានរួចហើយ!`).
   - Creates brand-new series via existing `POST /api/series` with empty episodes, empty glossary (`characters: []`, `terms: []`), and empty cast.
   - Uploads video into `newSeriesId` without touching SS1 (`series_1793898268958`).
2. **Series Switcher in `EpisodesTab.jsx`**:
   - Expanded existing Series / Drama panel in `MediaLibrary` (`EpisodesTab`) into a series selector dropdown reusing `seriesList` and `activeSeries`.
   - Powered by `useSeriesManager.handleSwitchSeries` (single source of truth, zero duplicate state, no second dropdown at Header).
3. **Verification**:
   - Verified stored `series.json` on disk: `episodes: []`, `glossary: { characters: [], terms: [] }`, `cast: []` (Condition 2 PASS).
   - Verified SS1 (`series_1793898268958`) retains 21 episodes, Script/Voice/BGM intact (Untouched PASS).
   - Frontend build (`vite build`) passed in 771ms with 0 errors.

## Active Environment
- Backend API: `http://localhost:5000` (Listening)
- Frontend Vite: `http://localhost:5173` (Listening)
- Telegram Bot: `dragontown_member_bot` (Active, PID task-432)

## Next Steps
- Commit and push `feat/upload-new-series` to remote (do not merge to main).
