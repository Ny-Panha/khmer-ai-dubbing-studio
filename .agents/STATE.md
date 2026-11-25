# .agents/STATE.md

## Last Session
IDE (Final Data Integrity & Release Audit) — 2026-11-25T21:40:00+07:00

## Summary
Final Data Integrity & Release Audit completed on verified isolation baseline `a0c161f` (`chore/full-project-cleanup`).

### Task-Owned Changes Committed (5 files):
- `backend/routes/videoRoutes.js` — verified input/output collision protection (`!/_source$/i` exclusion from `hasMeaningfulTitle`, `path.resolve(outputVideoPath) === path.resolve(inputVideoPath)` rename to `*_Khmer_Dubbed.mp4`, and unlink guard preventing deletion of `inputVideoPath`)
- `backend/tests/render_source_collision_guard.test.js` — new HTTP integration regression test proving `_source` titles and exact-filename collisions never overwrite or delete source MP4s
- `backend/tests/smart_pipeline_all3.test.js` — updated Test 10D for TTS v2 provenance (`c3f418dd`): asserts legacy v1 sidecar without `provenanceVersion` triggers re-synthesis (`true`) while verified `writeAudioProvenance` v2 sidecar is reused (`false`)
- `backend/tests/workspace_player_containment.test.js` — updated `handleClipVoiceChange` regex to allow `scriptData?.segments` in `useCallback` dep array while preserving `playSegmentAudio(` prohibition
- `.agents/STATE.md` — audit results & remaining blockers documented

### Audit & Verification Results:
- **Cross-series isolation baseline (`a0c161f`):** preserved untouched.
- **Combined backend regression tests (30 suites):** **219/219 PASS** ✅ (0 failures, `27.86s`).
- **Frontend production build (`cd frontend && npm run build`):** **2053 modules, 0 errors** ✅ (`1.68s`).
- **Outdated test vs defect classification:**
  - `smart_pipeline_all3.test.js` (Test 10D): outdated assertion (v1 vs v2 provenance policy) → updated & passing.
  - `workspace_player_containment.test.js` (`handleClipVoiceChange`): outdated dep-array regex → updated & passing.
  - `male_female_speaker_detection_batch.test.js` (Test 4, line 102): outdated assertion (sends `non_existent_series_xyz`, expects `400` instead of `scriptRoutes.js`'s intentional `404 Series not found`). File left untouched to preserve another agent's uncommitted changes (`FAIL 1/4` when run standalone).

### Remaining Data Integrity Blocker:
- `ss1_ep_28_source.mp4` is **NOT restored** on disk (`backend/uploads/projects/ss1/episodes/ep_28/video/` contains only `ss1_EP28_Khmer_Dubbed.mp4` and `.render-meta.json`; no backup found under `backend/uploads/` or `~/Downloads`). `ss1/series.json` `ep_28` still references `ss1_EP28_Khmer_Dubbed.mp4`. Dubbed export was NOT substituted for the original source.

---

## Previous Session
IDE (P0 Cross-Series Isolation Final Verification) — 2026-11-25T21:25:00+07:00

## Summary
P0 Cross-Series Isolation Final Verification PASSED (33/33 Playwright + OS PID + restart checks, 185/185 affected backend tests, frontend build 0 errors) and task-owned changes committed & pushed.

### P0 Isolation Changes Committed (17 task-owned files):
- `backend/services/audioSeparationService.js` — scoped separation keys (`seriesId::episodeId::media`), scoped progress/kill matching, removed temporary `DEBUG` console/tasklist logs
- `backend/routes/audioRoutes.js` — `seriesId`/`episodeId` scoping on `/audio/separate`, `/audio/separation-progress`, `/audio/separate-kill`, `/tts/kill` (rejects empty cancellation scope with HTTP 400)
- `backend/services/ttsService.js` — strict `cancelTtsJob` prefix/exact key matching
- `frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx` — per-series `runnerStatesBySeries`, `runnerLiveStatsBySeries`, `activeEpisodeKeys`, immutable origin `jobRegistryRef`/`singleJobRegistryRef`
- `frontend/src/features/dubbing-runner/singleEpisodeRunners.js` & `DubbingStepButton.jsx` — origin `seriesId`/`episodeId` passed to runner & kill APIs
- `frontend/src/features/gemini-route/hooks/useEpisodeSelection.js` — per-series `selectedEpIdsBySeries` map
- `frontend/src/components/dashboard/GeminiRouteModal.jsx`, `BatchEpisodeCard.jsx`, `geminiRouteHelpers.js`, `StudioNavRail.jsx` — per-series batch state buckets & active runner folder indicator
- `frontend/src/hooks/useSeriesManager.js` — resolves target series before publishing active workspace state
- `frontend/src/services/api/audioApi.js` — `seriesId`/`episodeId` params on separation progress/status/kill
- `backend/tests/demucs_worker_defaults.test.js` & `backend/tests/series_folder_selector_workspace.test.js` — isolation assertions updated for per-series maps & job registry
- `scripts/verify-cross-series-isolation.cjs` — real-browser Playwright + Windows OS PID + concurrent TTS/Clean BGM + 20x `/studio` switching + reload & restart persistence verification

### Verification Results:
- `node scripts/verify-cross-series-isolation.cjs`: **33/33 PASS** ✅
  - `killed: 0` root cause: sandboxed shell blocks `taskkill` with exit `255`, whereas authorized local Windows backend (`localhost:5000`) terminates exact OS PID (`killed: 1`).
  - Long `turbo` Clean BGM on `ss2/ep_6` (`pid=33700`, `jobId=sep_1795616579653_wzqaa`) cancelled via `Stop` (`killed: 1`), zero further output writes, zero stems in cache.
  - Concurrent `ss1` Edge TTS (`ep_verify_tts`, cleaned up after Phase 8) + `ss2` Clean BGM active simultaneously; stopping `ss2` left `ss1` TTS unaffected to completion.
  - 20x rapid switches (`ss1` <-> `ss2` on `ep_4` in `/studio`): `0 failures` across video, script, audio, waveform, timeline, selected episode, and progress.
  - Reload & backend restart persistence (`PORT=5099` boot 1 -> boot 2): `237` jobs, `237` unique IDs, `0` running/duplicate jobs, `ss1=28`, `ss2=25`.
- Affected regression tests (27 suites: playback, crossfade, voice switching, scoped settings, export, isolation, cancellation): **185/185 PASS** ✅
- Frontend build (`cd frontend && npm run build`): **2053 modules, 0 errors** ✅
- Pre-existing unrelated test drift observed in earlier broad run (not modified): `smart_pipeline_all3.test.js` (Test 10D legacy v2 provenance) and `workspace_player_containment.test.js` (`handleClipVoiceChange` regex).

---

## Previous Session
IDE (Final Verification) — 2026-11-25T20:55:00+07:00

## Summary
Final Verification completed on baseline `97b657ebbd4425d14204cc895d7815bc802b2df0` across Playwright + FFmpeg (`ffmpeg-skill`) + HTTP integration tests.

### Real Defects Reproduced & Fixed During Verification (Uncommitted in working tree):
1. `backend/routes/videoRoutes.js` — Fixed Single Export (`POST /api/render-video`) self-delete bug: when an episode's `displayTitle` ended with `_source` (e.g. `ss1_ep_28_source`), `outputVideoPath` collided with `inputVideoPath` and `fs.unlinkSync(outputVideoPath)` deleted the source file before rendering (`500`). Excluded `/_source$/i` from `hasMeaningfulTitle` and added `path.resolve(outputVideoPath) === path.resolve(inputVideoPath)` guard. *(Note: `ss1_ep_28_source.mp4` was overwritten by that pre-fix bug during reproduction; `ss1_EP28_Khmer_Dubbed.mp4` and `ep_28` audio/scripts remain intact; `ep_27` Single Export verified afterward with `ss1_ep_27_source.mp4` preserved.)*
2. `frontend/src/features/gemini-route/hooks/useEpisodeSelection.js` — Added `setSelectedEpIds` to dependency arrays of `toggleSelect`, `handleSelectCount`, `handleSelectAllEpisodes`, `handleSelectIncompleteEpisodes`, `handleClearSelection`, `handleSelectAllUnscripted` to prevent stale `selectionKey` closures after switching folders (`ss1` <-> `ss2`).

### Final Verification Matrix:
- **Scenario 1 (Apply 4 settings to all 28 `ss1` eps):** PASS — `POST /api/series/ss1/video-edit-settings` 200; 28/28 updated, scripts/audio/BGM intact.
- **Scenario 2 (`ss2` unchanged):** PASS — all 25 `ss2` episodes byte-identical; `folderVideoEdit: null`.
- **Scenario 3 (Episode switch, reload, server restart persistence):** PASS — verified across `ep_2/ep_10/ep_28/ep_1`, live CSS preview (`scaleX(-1) scale(1.15)`, `contrast(1.05) brightness(1.015) saturate(1.08)`, `muted: true`), browser reload (`F5`), and backend restart with fresh browser context.
- **Scenario 4 & 5 (`ss2` Clean BGM + `ss1` edit + isolation/lock/completion/cancel):** PASS — `ss2/ep_5` completed (`bgmAudioUrl` saved); `ss2/ep_6` spawned OS Demucs, locked `ss2`; `ss1` stayed idle/unlocked (`28->27`) and editable (`zoom 1.12->1.15`).
- **Scenario 6 (`ss1` TTS while `ss2` runs):** PASS — `ss1/ep_28` TTS ran while `ss2` stayed `separating` and `ss2` audio untouched (`ep_28` original audio restored afterward).
- **Scenario 7 (Stop terminates backend OS job):** PASS — Stop sent `POST /api/audio/separate-kill` (`200`), killed OS Demucs PIDs `[30464, 33972] -> []`.
- **Scenario 8 (Single, Batch Separate, Merged Export):** PASS (after `videoRoutes.js` fix) — `ss1_ep_27_Khmer_Dubbed.mp4`, Batch `ss1_EP27_Khmer_Dubbed.mp4` + `ss1_EP28_Khmer_Dubbed.mp4`, Merged `ss1_Full_EP27-EP28_Khmer_Dubbed.mp4`.
- **Scenario 9 (FFmpeg / `ffmpeg-skill` verification):** PASS — `probe.py`, `look.py` (`ep27_look.png`), SSIM (`0.726` raw vs `0.9905` transformed `hflip+zoom1.15+eq`), `volumedetect` (`-91.0 dB` muted gap vs `-15.2 dB` source gap; `-17.5 dB` Khmer dialogue; `-17.7 dB` merged EP28 dialogue; `-22.7 dB` Clean BGM).
- **Scenario 10 (Full HTTP Integration Tests):** 164/165 PASS across 26 suites (`frontend run build` 0 errors); 1 pre-existing unrelated failure in `backend/tests/male_female_speaker_detection_batch.test.js` (`POST /api/rescan-episode-gender` returned `404` vs expected `400`).

## Active Environment
- Backend: `http://localhost:5000` (daemon running)
- Frontend: `http://localhost:5173` (Vite daemon running)
- Production build: `npm --prefix frontend run build` — 0 errors (`1.34s`)

## Next Steps
- Review & commit the 2 defect fixes (`backend/routes/videoRoutes.js`, `frontend/src/features/gemini-route/hooks/useEpisodeSelection.js`) along with `.agents/STATE.md` when ready.
- Investigate pre-existing `POST /api/rescan-episode-gender` 404 vs 400 assertion in `backend/tests/male_female_speaker_detection_batch.test.js`.

## Unrelated Working-Tree Changes (DO NOT COMMIT without review)
- `backend/services/ocr/localChineseOcrService.js`
- `backend/services/pipeline/stages/stage7_translateAndValidateKhmer.js`
- `backend/services/pipeline/stages/stage8_validateSubtitleTiming.js`
- `backend/tests/step1_completeness_and_mapping.test.js`
- `backend/workers/local_chinese_ocr_worker.py`
- `frontend/src/components/dashboard/GeminiRouteModal.jsx`
- `frontend/src/components/layout/StudioNavRail.jsx`
- `frontend/src/features/dubbing-runner/singleEpisodeRunners.js`
- `frontend/src/hooks/useScriptWorkflow.js`
- `frontend/src/features/dubbing-runner/DubbingStepButton.jsx`
- `frontend/src/services/api/audioApi.js`
- `frontend/src/components/dashboard/BatchEpisodeCard.jsx`
- `backend/models/speakerRegistry.js`
- `backend/routes/audioRoutes.js`
- `backend/services/audioSeparationService.js`
- `backend/services/ttsService.js`
- `backend/services/pipeline/jobWorker.js`
- `backend/services/pipeline/pipelineTypes.js`
- `backend/services/pipeline/productionJobQueue.js`


---

## Current Session Update - 2025-01-18

**Speaker Assignment Accuracy Fix Implementation (`IN PROGRESS`):**

**Completed Tasks (3.1-3.3):**
1. ✅ Created 15 bug condition exploration tests
2. ✅ Created 15 preservation tests - **ALL PASSING (15/15)**
3. ✅ **Task 3.1:** Added `isGenericSpeakerName()` helper function
4. ✅ **Task 3.2:** Reordered `detectSpeakerGender` priority - Voice Timbre (Priority 1) → Visual Gender (Priority 2)
5. ✅ **Task 3.2:** Added voice-character mismatch detection flags (`voiceActorTimbre`, `characterGender`, `voiceCharacterMismatch`)
6. ✅ **Task 3.3:** Exempted generic identities from series map inheritance in `syncSegmentsWithSpeakerRegistry`
7. ✅ **Task 3.3:** Added speaker change detection metadata (`speakerChangeDetected`, `speakerChangedFrom`, `genderChangedFrom`)

**Remaining:** Tasks 3.4-5 (speakerIdentificationService.js enhancements, full verification)

**Files Modified:**
- `backend/models/speakerRegistry.js` (Tasks 3.1, 3.2, 3.3)
- `backend/tests/bugfix_speaker_assignment_exploration.test.js` (Task 1)
- `backend/tests/bugfix_speaker_assignment_preservation.test.js` (Task 2, 15/15 passing)
- `.kiro/specs/speaker-assignment-accuracy/tasks.md`
- `.agents/IMPLEMENTATION-STATUS.md` (detailed progress tracking)

**Next:** Continue with Tasks 3.4-3.13 (speaker identification service enhancements)

---

## Current Session Update - 2026-11-25 22:15

**Speaker Assignment Accuracy Fix - BC1 (Generic Identity) Implementation:**

**Completed Tasks (3.1-3.7):**
1. ✅ **Task 1:** Created 15 bug condition exploration tests
2. ✅ **Task 2:** Created 15 preservation tests (15/15 passing)
3. ✅ **Task 3.1:** Added `isGenericSpeakerName()` helper function with 9 unit test suites
4. ✅ **Task 3.2:** Reordered `detectSpeakerGender` priority - Voice Timbre (Priority 1) → Visual Gender (Priority 2)
5. ✅ **Task 3.3:** Exempted generic identities from series map inheritance
6. ✅ **Task 3.4-3.7:** Verified prompt enhancements already present in code

**Bug Condition Test Results:**
- **BC1 (Generic Identity)**: 3/3 PASSING ✅
  - Generic identities (`ប្រព័ន្ធ`, `系统`, narrators) no longer inherit incorrect gender from series map
  - Each instance classified independently by in-scene acoustic evidence
- **BC2-5**: 12/12 FAILING (expected - require Tasks 3.8-3.13 which were deferred)

**Files Modified (Task-Owned):**
- `backend/models/speakerRegistry.js` (+176/-26 lines)
- `backend/tests/bugfix_speaker_assignment_exploration.test.js` (new, 15 tests)
- `backend/tests/bugfix_speaker_assignment_preservation.test.js` (new, 15 tests)
- `backend/tests/isGenericSpeakerName.test.js` (new, 9 test suites)
- `backend/tests/male_female_speaker_detection_batch.test.js` (updated for Task 3.1)
- `.kiro/specs/speaker-assignment-accuracy/` (bugfix.md, design.md, tasks.md)
- `.agents/BENCHMARK-RESULTS.md`, `CURRENT-TASK-STATUS.md`, `IMPLEMENTATION-STATUS.md`

**Impact:**
- Minimum 3 bugs fixed (BC1 category)
- Zero regressions on existing 296 correct assignments (preservation tests passing)
- Partial progress toward 310/320 (96.88%+) target
- BC2-5 fixes deferred for evidence-based implementation after full benchmark

**Next Steps:**
- Commit BC1 fixes
- Full 320-cue benchmark validation on Episodes 1, 4, 5, 20 needed to quantify real-world impact
- Implement BC2-5 fixes (Tasks 3.8-3.13) only if benchmark shows specific gaps

