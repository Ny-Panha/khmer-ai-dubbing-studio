# Tasks: Reusable 1-by-1 Sequential Dubbing Feature

## Task Breakdown & Execution Order

- [ ] **Task 1: API Layer Priming (`frontend/src/services/api.js`)**
  - Add and export `separateAudioApi({ videoPath, seriesId, episodeId })`, `getSeparationProgressApi(videoPath)`, and `killSeparationApi({ videoPath, jobId })`.
  - Verify with export check.

- [ ] **Task 2: Shared 1-by-1 Sequential Engine (`frontend/src/features/dubbing-runner/`)**
  - Create `DubbingRunnerContext.jsx` with `DubbingRunnerProvider`.
  - Create `useDubbingFeature.js` exposing:
    - `runSingleTranslate`, `runSingleVoice`, `runSingleCleanBgm`, `runSingleEpisodeAll3`
    - `runSequentialStep(stepType, episodesList, options)`
    - `stopStep(stepType)`
    - `getStepRunnerState(stepType)`
  - Create `index.js` barrel export.

- [ ] **Task 3: Reusable UI Components (`DubbingStepCardsBar.jsx` & `DubbingStepButton.jsx`)**
  - Create `DubbingStepCardsBar.jsx`: 3-card grid with active episode indicator, progress bar, and 1-by-1 Run/Stop buttons.
  - Create `DubbingStepButton.jsx`: universal button supporting `step="translate" | "voice" | "clean_bgm" | "all3"`.

- [ ] **Task 4: Provider Integration in `App.jsx`**
  - Wrap app tree with `<DubbingRunnerProvider>` inside `StudioProvider`.
  - Pass `activeSeries` and `refreshSeries` to synchronize state automatically.

- [ ] **Task 5: Integration in `GeminiRouteModal.jsx`**
  - Replace manual batch handlers with `useDubbingFeature` and `<DubbingStepCardsBar />`.
  - Integrate `<DubbingStepButton />` into Episode Cards (`EP1..EP21`).
  - Preserve all data-testids for 100% regression suite compatibility.

- [ ] **Task 6: Cross-Page Integration (`EpisodesTab.jsx`, `DubbingModeTab.jsx`, `VoiceSettings.jsx`)**
  - Integrate `useDubbingFeature` and `<DubbingStepButton />` for unified single-episode / batch triggering.

- [ ] **Task 7: Automated Verification & Test Suite**
  - Write `backend/tests/reusable_1by1_dubbing_feature.test.js`.
  - Run all test suites (`node --test backend/tests/*.test.js`).
  - Run `npm --prefix frontend run lint` and `npm --prefix frontend run build`.

- [ ] **Task 8: Sync State Memory (`.agents/STATE.md`)**
  - Document all architectural additions and next steps.

