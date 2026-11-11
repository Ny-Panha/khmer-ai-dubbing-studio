# Plan: Full-Project Master Upgrade

## 1. Architecture & Component Boundary
- `frontend/src/utils/voiceCatalog.js` (new): `resolveVoiceMeta(seg)` → `{ id, gender: 'MALE'|'FEMALE', label, icon }` from a small catalog (Piseth / Sreymom) + gender hints (`voiceGender`, `speakerGender`, `gender`). Pure function, no React.
- `ScriptReviewTab.jsx`: `filterMode` extends to `'all' | 'male' | 'female' | 'missing'` (existing `'missing'` kept). Counts via one `useMemo` pass over `filteredSegments`.
- `EpisodesTab.jsx`: new optional prop `onRefreshSeries`; new state `splitNotice = { type, text }` rendered as inline banner above Episodes List. After success: close modal → `await onRefreshSeries()` → banner.
- `MediaLibrary.jsx`: pass existing `onRefreshSeries` prop down to `EpisodesTab`.
- `AudioDuckingPanel.jsx`: `toDb(gain) = 20*log10(gain)` readout next to `%`.
- `audioSeparationService.js`: `resolvePythonBinary()` candidates = `PYTHON_BIN` → `<repo>/.venv`, `<backend>/.venv` → `%LOCALAPPDATA%\Programs\Python\Python3{13..10}` → `python`/`python3`. Exported for tests. Existing FFmpeg fallback path untouched.

## 2. Data Contracts
- No API changes. `refreshSeriesFromServer()` already returns a Promise (useSeriesManager.js:752).

## 3. Risks & Rollback
- Refresh callback missing → banner still shows, list updates on next sync (no reload regression).
- All edits are additive/local; rollback = revert the listed files.

