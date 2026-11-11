# Tasks: Full-Project Master Upgrade

- [ ] T1: `backend/services/audioSeparationService.js` — portable `resolvePythonBinary` + export (Verify: `node --test backend/tests/full_project_master_upgrade.test.js`)
- [ ] T2: `frontend/src/components/media/EpisodesTab.jsx` + `MediaLibrary.jsx` — remove `alert`/`reload`, inline banner + `onRefreshSeries` (Verify: grep + lint)
- [ ] T3: `frontend/src/utils/voiceCatalog.js` + `ScriptReviewTab.jsx` — dynamic voice label + 4 filter pills (Verify: test + lint)
- [ ] T4: `frontend/src/components/voice/AudioDuckingPanel.jsx` — dB readout (Verify: lint/build)
- [ ] T5: `backend/tests/full_project_master_upgrade.test.js` — `\uFFFD` scan, model-ID sync, no `nhastar`, no `alert/reload` (Verify: `node --test`)
- [ ] T6: Lint + build + full `node --test` + update `.agents/STATE.md`

