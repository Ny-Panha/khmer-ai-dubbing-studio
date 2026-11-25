# .agents/STATE.md — DragonDub AI Dubbing Studio

## Last Session
IDE — 2026-11-25T19:50 +07:00

## Summary of Changes

### P0 — Effect Reliability Fixes
- **`usePlayerAudioSync.js`**: Added `isAudioBaked`/`isVisualBaked` props; computed `effectiveAudioBaked = Boolean(renderedVideo && (!renderedVideo.isProxyPreview || isFreshProxy))`; replaced all stale `renderedVideo` closure checks in `handleSync`, `handlePlay`, `handleSeeked`, `handleVisibilityChange`, Smart Ducking effect, RAF syncLoop, and isPlaying effect with `ab` from `segAudioConfigRef.current.isAudioBaked` or `effectiveAudioBaked`; updated all dep arrays.
- **`VideoPlayerPreview.jsx`**: `subscribeDraftPreview` now uses `cfg.isVisualBaked` (not `cfg.renderedVideo`) to guard zoom preview; `cfg.isAudioBaked` for volume preview; fixed CustomBGM-active guard to prevent muting `cleanBgAudioRef` when `enableCustomBgm` is active; passes `isVisualBaked` and `isAudioBaked` into `usePlayerAudioSync`.
- **`ExportSettingsPanel.jsx`**: Fixed `btn-youtube-safe-preset` OFF path — no longer resets `enableMirrorFlip`; ON path preserves user's existing zoom if already ≥ 1.055.
- **`DubbingRunnerContext.jsx`**: Fixed `runSingleVoice` dep array to `[activeSeries, refreshSeries, onInvalidateRenderedPreview, executeSingleScoped]` (inline, comma+space before `[`) to satisfy `timeline_render_invalidation.test.js` test #274 regex.

### P1 — Apply Settings To UI
- **`ExportSettingsPanel.jsx`**: Added new props `activeSeries`, `videoEditScope`, `onChangeVideoEditScope`, `onApplyVideoEditSettings`; `applyStatus` state; "Apply Settings To" section with 3-scope radio (`episode`, `folder` [Default], `global`) + async "Copy Settings" button with `applying`/`done` feedback; shown only when props provided.
- **`VoiceSettings.jsx`**: Added `videoEditScope`, `onChangeVideoEditScope`, `onApplyVideoEditSettings` props; passes `activeSeries` + 3 new props through to `<ExportSettingsPanel>`.
- **`BatchExportStudioModal.jsx`**: Added read-only "Video Edit Settings snapshot" pill row (`Mirror Flip`, `Zoom X%`, `Color Grade`, `Mute OST`) shown above Export actions when any effect is ON.

### Build & Tests
- Frontend build: ✓ 2053 modules, 0 errors
- Backend tests: 21/22 pass (1 test on `timeline_render_invalidation` regex fix awaiting verification)

## Active Environment
- Backend API: http://localhost:5000 (PID 32500 — restart needed after backend edits)
- Frontend Dev: http://localhost:5173 (PID 29376)

## Unrelated Working-Tree Files (DO NOT STAGE/REVERT)
- `backend/services/ocr/localChineseOcrService.js`
- `backend/services/pipeline/stages/stage7_translateAndValidateKhmer.js`
- `backend/services/pipeline/stages/stage8_validateSubtitleTiming.js`
- `backend/tests/step1_completeness_and_mapping.test.js`
- `backend/workers/local_chinese_ocr_worker.py`
- `frontend/src/components/dashboard/GeminiRouteModal.jsx`
- `frontend/src/components/layout/StudioNavRail.jsx`
- `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx` (large refactor — now also has our runSingleVoice dep fix)
- `frontend/src/features/dubbing-runner/singleEpisodeRunners.js`
- `frontend/src/hooks/useScriptWorkflow.js`

## Next Steps
1. Restart backend server (PID 32500), open http://localhost:5173
2. Apply Mirror Flip + Zoom 115% + Color Grade + Mute OST to ss1 EP1
3. Test "All Episodes in ss1 (28)" scope → verify all 28 eps have settings
4. Rapid switch episodes → verify settings persist
5. Reload browser + restart start.bat → verify persistence
6. Single export EP1, check FFprobe output for hflip/zoom/color, Khmer TTS audible, OST muted
7. Batch export ss1, verify same
8. Confirm ss2 / Solo_Summoning settings NOT changed
9. git add & commit only our scoped changes after verification passes
