# Spec: Full-Project Master Upgrade (5 Phases) — Evidence-Verified

## 1. Problem & Intent (Why)
- Source: `full_project_master_upgrade_prompt.md` (audit made from GitHub web view).
- Zero-Guessing Rule: every claim was re-verified against the local working tree on 2026-11-11 before touching code.

| Phase | Audit claim | Local evidence | Decision |
| :--- | :--- | :--- | :--- |
| 1 | `\uFFFD` in 6 files | 0 occurrences in `frontend/src` + `backend` (UTF-8 read). Only hit is the intentional mojibake *detector* regex in `projectStorage.js` | No text edits. Add regression test only |
| 2 | Batch Studio 3-step UI + Duplicate Active Job | Already implemented in previous session (uncommitted diff in `GeminiRouteModal.jsx`, `route-runners/*`, `jobRoutes.js`) | Out of scope (done) |
| 3a | `EpisodesTab.jsx` `alert()` + `window.location.reload()` | Confirmed lines 60, 84, 86, 90 | FIX |
| 3b | `ScriptReviewTab.jsx` hardcoded `'Sreymom' : 'Piseth'` | Confirmed line 238; filter only `all` / `missing` | FIX |
| 4 | Corrupted strings, no sticky CTA, no spinner | Strings clean; sticky footer exists (`inspector-sticky-footer`); 300ms spinner exists; play button exists | Only add dB readout on ducking sliders |
| 5a | Hardcoded `C:\Users\nhastar\...` Python path | Confirmed `audioSeparationService.js` lines 87–88 | FIX |
| 5b | Invalid model IDs in `GeminiQuotaModal.jsx` | All IDs exist in `backend/services/geminiModelCatalog.js` | No edit. Add regression test |

## 2. User Scenarios
- S1: User auto-splits a long video → episodes list updates in place with an inline banner, no browser `alert()` and no full page reload.
- S2: Split fails / no video → inline error banner (no `alert()`).
- S3: Script Review shows each line's real voice label (`👨 ពិសិដ្ឋ` / `👩 ស្រីមុំ`) resolved from a voice catalog, and user filters by `ទាំងអស់ / 👨 ប្រុស / 👩 ស្រី / ⚠️ ឃ្លាខូច`.
- S4: Demucs runs on any machine: `PYTHON_BIN` → project `.venv` → `%LOCALAPPDATA%` Python installs → `python`/`python3` on PATH.
- S5: Ducking sliders show `%` and `dB`.

## 3. Scope & Boundaries
- In scope: `EpisodesTab.jsx`, `MediaLibrary.jsx` (prop wiring), `ScriptReviewTab.jsx`, new `utils/voiceCatalog.js`, `AudioDuckingPanel.jsx`, `audioSeparationService.js`, new regression test.
- Out of scope: Phase 2 redesign, backend split API, TTS behaviour, any state/handler renames, `data-testid` removal.

## 4. Acceptance Criteria
- [ ] No `alert(` / `window.location.reload(` in `EpisodesTab.jsx`.
- [ ] No hardcoded `'Sreymom' : 'Piseth'` ternary in `ScriptReviewTab.jsx`; 4 filter pills present.
- [ ] No `nhastar` in `backend/services/*.js`; `resolvePythonBinary` exported & honours `PYTHON_BIN`.
- [ ] Regression test: zero `\uFFFD` in source; quota modal model IDs ⊆ backend catalog.
- [ ] `npm --prefix frontend run lint` 0 errors, `npm --prefix frontend run build` PASS, `node --test` PASS.

