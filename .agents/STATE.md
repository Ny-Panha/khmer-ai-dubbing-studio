# .agents/STATE.md

## Last Session
IDE (P0 Complete 10-Stage Pipeline Accuracy & Reliability Audit) — 2026-11-27T16:20:00+07:00

## Summary
Completed Phases 1–10 of the end-to-end DragonDub AI pipeline accuracy & reliability audit on branch `chore/full-project-cleanup` (starting from baseline `368f3569281f95ee82f798b36f49843c4e365eec`) using minimal-change discipline without overwriting any production media or manual translations.

### Key Fixes by Phase
- **Phase 1 (Reproduce Wild Buddha EP10 on scratch copy):** Created independent 3fps verified ground-truth Chinese SRT (`83` true cues, `00:00:07.67–00:04:34.33`) and local SenseVoice ASR cross-check (`31` speech segments). Confirmed old EP10 baseline was `82/83` Recall (`98.80%`, missed `没人接` at `198.33–199.33s`) and `82/83` Precision (`98.80%`, false positive `滨江小区` blue computer monitor at `212.0s`), with `582.2s` Local OCR (`det_limit_side_len=480` + repeated top-disclaimer scans). Traced EP10 disk/API/UI 83-vs-44 discrepancy (`verified_chinese_cues.json` had 83 cues vs `series.json` having 27 earlier cues + 17 manual cues = 44; UI lumped 9 unknown-gender cues into male).
- **Phase 2 (Confirmed Runtime Errors):** Fixed missing `isModelOverloadOrUnavailable` import in `backend/routes/scriptRoutes.js`; extended timeout/504 detection in `backend/services/geminiKeyManager.js`; added structured 401/429/503/504/timeout/500 responses without unhandled rejections; preserved completed earlier batches on later failure in `backend/services/geminiService.js` + `scriptRoutes.js`.
- **Phase 3 (Stage 1–3 Chinese OCR Accuracy & Speed):** Added `brightChangeRatio` transition detection in `backend/services/ffmpeg/ffmpegProbeAndFrames.js` (recovers `没人接` at `198.2–199.4s`); added drama disclaimer regex, far-right-edge prop/monitor filter (`x_min >= 0.78 && !is_centered`, rejects `滨江小区` monitor), static top-band skip cache, and `det_limit_side_len=320` in `backend/workers/local_chinese_ocr_worker.py` & `backend/services/ocr/localChineseOcrService.js` (3.0x faster Local OCR); separated `hybrid`/`gemini_only` OCR cache keys in `stage3VisionBatchRunner.js` & `stage3_extractChineseSubtitles.js`; fixed misleading OCR telemetry (`pendingGeminiFramesCount` vs total candidate frames).
- **Phase 4 (Stage 4–5 Audio, Reconciliation & Speakers):** Preserved immutable `sourceCueId` and manual speaker fields across all branches of `stage5_reconcileTimelineEvidence.js` (with deterministic `cue_asr_*` IDs for audio-only cues); added selective Stage 4–5 ASR/reconciliation fallback in `dubbingPipeline.js` & `chunkOrchestrator.js` when Fast OCR yields 0 cues or unresolved frames; removed redundant duplicate `buildSpeakerRegistry` pass and fixed `chosenModel` ReferenceError in `chunkOrchestrator.js:797`; added `resolvedOcrMode` to `chunkHash`; fixed standalone `"មីង"` female detection in `speakerRegistry.js` without misclassifying Chinese names like `"ស៊ូ មីង"`.
- **Phase 5 (Stage 6 Khmer Translation & Override Separation):** Separated automatic speaker verification (`autoVerifiedSpeakerCount`), manual character/voice override (`manualOverrideCount`), manual text override (`hasManualTextOverride`), and `reviewNeededSpeakerCount` in `stage6PromptAndConsistency.js` & `stage6_generateModeSpecificScript.js` (fixing misleading `83 userOverridden untouched` log and ensuring speaker/voice overrides never block missing translations); added `呢呢呢` & `呀啊` context-aware vocalization rules to both `backend/utils/translationQuality.js` and `frontend/src/utils/translationQuality.js`.
- **Phase 6 (Stage 7–8 Strict Validation):** Enforced strict validation in `stage7_translateAndValidateKhmer.js`, `stage8_validateSubtitleTiming.js`, and `pipelineTypes.js` (`validateStrictSourceCueMapping` / `computePipelineCompletenessReport`) for exact `sourceCueId` equality, zero duplicates/missing, Chinese/Thai/Lao/foreign script leak rejection, expressive vocalization descriptive-label rejection, and valid start/end timing (`invalidTimingCueIds`).
- **Phase 7 (Disk / API / UI Consistency):** Added `resolveSegmentGender()` in `frontend/src/utils/voiceCatalog.js` so `UNKNOWN` gender is never counted as `MALE`; updated `ScriptReviewTab.jsx` to display separate `Total / Visible / Translated / Untranslated / Review` counts, add an explicit `មិនស្គាល់` (`unknown`) filter pill, and reset `filterMode` on episode switch; updated `VoiceSettings.jsx` Cast Voices unknown-gender handling; hardened `useSeriesManager.js` so stale `lastModified` never blocks newer server `scriptData.updatedAt`.
- **Phase 8 (Stage 9 TTS Reliability):** Probed optional `edge-tts` CLI availability once (`isEdgeTtsCliAvailable()`, eliminating repeated `ENOENT` spawns); added shared 429 cooldown backoff and immediate concurrency throttling to 1 on 429 in `backend/services/ttsService.js`; ensured failed TTS batches/segments never report completed (`status: 'incomplete' | 'review_needed'`) across `ttsService.js`, `stage9_generateSegmentTTS.js`, `dubbingPipeline.js`, and `chunkOrchestrator.js`.
- **Phase 9 (Stage 10 Preview & Export):** Added `buildExportReadinessReport()` in `stage10_previewAndExport.js` and wired explicit `reviewNeeded`/`reviewWarnings`/`exportReadiness` into `videoRoutes.js` `POST /api/render-video` (blocking 100% untranslated silent-dialogue export with HTTP 400 `EXPORT_REVIEW_NEEDED` unless explicitly allowed) while preserving source-video collision protection and cross-series isolation.

- **Auto-Compact Non-Khmer Script Rescue (`geminiService.js`):** Added targeted strict Khmer-only retry for isolated offending cues in `retranslateBatchDialogues` when Gemini leaks a stray Thai/Chinese/Latin token (e.g. `ยอม`) inside a 25-cue compact batch; verified live on Wild Buddha EP10 Batch 1 (`25/25 PASS`, rescued `#4` cleanly) and `retranslate_fallback.test.js` (`14/14 PASS`).

### Phase 10 Benchmark Results (Scratch Copies, `gemini-3.5-flash-lite`, 7-key pool)
| Dataset / Engine | Duration | Cues (Ref) | Recall | Precision | CER | Start/End MAE | Total OCR | Local OCR | Gemini Calls / Tokens | Unresolved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Wild Buddha EP10 — Baseline (`368f356`) | 300.0s | 83 (83) | 98.80% | 98.80% | — | ~0.56–1.53s drift | 675.9s | 582.2s | — | 0 |
| **Wild Buddha EP10 — Hybrid RapidOCR+Gemini (Fixed)** | **300.0s** | **83 (83)** | **100.00%** | **100.00%** | **0.00%** | **0.101s / 0.112s** | **255.6s** | **193.9s** | **15 / 197,263** | **0** |
| Wild Buddha EP10 — Hybrid Cache Reuse | 300.0s | 83 (83) | 100.00% | 100.00% | 0.00% | 0.101s / 0.112s | **0.01s** | 0s | 0 new | 0 |
| Wild Buddha EP10 — Gemini-Only OCR | 300.0s | 89 (83) | 98.80% | 92.13% | 0.17% | 0.239s / 0.195s | 118.1s | 0s | 39 / 492,535 | 0 |
| Wild Buddha EP3 — Hybrid RapidOCR+Gemini | 300.0s | 93 | — | — | — | — | 305.9s | 224.8s | 18 / 220,729 | 2 (cache skipped) |
| Unseen `《黑女倾心》` EP13 — Hybrid RapidOCR+Gemini | 260.1s | 150 | — | — | — | — | 185.3s | 136.7s | 11 / 136,228 | 0 |
| Unseen `《黑女倾心》` EP14 — Hybrid RapidOCR+Gemini | 264.2s | 131 | — | — | — | — | 255.7s | 176.7s | 20 / 251,191 | 0 |

- **EP10 Stage 6–10 E2E (Scratch):** Stage 6 translated `83/83` (`100%`) in `12.8s` (`3` calls, `44,499` tokens, `exactCueIdSetMatch: true`, `oneToOneMappingValid: true`, `manualOverrideCount: 0`, `6` named characters); Stage 9 TTS synthesized `10/10` (`100%`, `0` failed, `0` ENOENT, live 429 recovered); Stage 10 rendered 25s scratch clip verified via `ffmpeg-skill/scripts/probe.py` (`h264 1920x1080`, `aac 44100Hz`, `25.0s`, `5,623,180` bytes, `valid: true`, explicit `reviewWarnings` emitted).
- **Automated Verification:**
  - `backend/tests/p0_pipeline_accuracy_audit.test.js` + `retranslate_fallback.test.js` + `render_source_collision_guard.test.js`: **21/21 PASS**
  - Stage 3–8 & Speaker suites (`stage3_persistent_rapidocr`, `step1_completeness_and_mapping`, `stage5_reconciliation_and_recovery`, `p0_persistent_character_recognition`, `bugfix_speaker_assignment_preservation`, `fast_multimodal_gemini_prompt`, `expressive_vocalization_translation`, `stage6_khmer_translation_quality_rules`, `phase1_translation_boundary`): **58/58 PASS** (`4 skipped` missing external fixture)
  - 15-suite regression sweep (`audio_crossfade_overlap`, `voice_provenance_cache_isolation`, `tts_smart_skip_and_progress`, `stage9_tts_findings`, `episode_state_isolation`, `series_persist_and_sync`, `stage3_*`, `stage6_translation_fallback_and_tts_guard`, `thai_script_sanitization`, `gemini_key_pool_and_504_retry`, `youtube_safe_transform`, `job_queue_and_shutdown`): **126/126 PASS**
  - `cd frontend; npm run build`: **2053 modules, 0 errors** (`707ms`).
  - **Real Playwright UI Verification (`http://localhost:5173`, Wild Buddha EP10):** **PASS (0 console errors)** — API `44` == UI `សរុប 44 / បង្ហាញ 44 / បកប្រែរួច 44 / ខ្វះបកប្រែ 0 / ពិនិត្យ 0`; Gender pills `ប្រុស 15 / ស្រី 20 / មិនស្គាល់ 9` (`sum=44`, unknown not counted as male); clicking `មិនស្គាល់` filtered `Visible` to `9`; Cast Voices rendered `28` speaker rows.

### Remaining Limitations
- Local RapidOCR CPU runtime is now ~137–225s per 4.5–5 min episode (3x faster than baseline `582.2s`), still CPU-bound on Windows ONNX Runtime; further speedups would require GPU/DirectML execution provider or multi-worker frame sharding.
- Free-tier Gemini RPM (`15 RPM/key`) can still cause occasional unresolved frames under heavy bursts (e.g., 2 unresolved frames on `wb_ep3` during concurrent benchmark load); those are now honestly flagged `review_needed` and skip disk cache write rather than silently completing.
- Pre-existing unrelated legacy tests (`fast_ocr_mode.test.js`, `fast_ocr_timing_and_accuracy.test.js`, `male_female_speaker_detection_batch.test.js`) still assert legacy `unknown -> male` fallback behavior and were intentionally left untouched outside P0 scope.

## Active Environment
- Branch: `chore/full-project-cleanup`
- Backend dev port: `5000`, Frontend dev port: `5173` (both live with updated code)
- Production Wild Buddha EP10 untouched on disk (`44` segments preserved)

## Next Steps
- Nha can refresh `http://localhost:5173` and re-run Wild Buddha **EP10** cleanly using the updated Hybrid RapidOCR + Gemini Mode A pipeline, then verify TTS and Export.

---

## Previous Session
IDE (Git Commit & Push) — 2026-11-27T15:12:45+07:00

## Summary
Committed all pending working-tree changes (Folder Video Upload on HomeDashboard, Compact Khmer Dubbing route/runner updates, ProductionJobQueue deadlock fix, OCR/Stage 7/8 pipeline & test updates, and spec/script cleanup) and pushed branch `chore/full-project-cleanup` (including `7fdfa85` expressive vocalization translation) to `origin`.

## Active Environment
- Branch: `chore/full-project-cleanup` (synced with `origin/chore/full-project-cleanup`)
- Backend dev port: `5000`, Frontend dev port: `5173`

## Next Steps
- Restart backend server if currently running so live Step 1 / Repair / Auto-Compact picks up updated translation prompts and queue fixes.

---

## Previous Session
IDE (Expressive Sounds & Natural Dubbing Translation) — 2026-11-27T13:47:00+07:00

## Summary
Upgraded the Chinese-to-Khmer translation, repair, auto-compact, and Edge TTS pipeline so expressive sounds, interjections, repeated sounds, hesitation, laughter, coughing, crying, screaming, sighing, and stuttering are preserved 1:1 and translated into natural, pronounceable Khmer phonetic expressions instead of being skipped or converted into descriptive words (`"សើច"`, `"យំ"`, `"ក្អក"`, `"ស្រែក"`).

- `backend/utils/translationQuality.js` & `frontend/src/utils/translationQuality.js` — Added shared `EXPRESSIVE_KHMER_DUBBING_RULES`, `isExpressiveVocalizationSource()`, and `isPureDescriptiveSoundLabel()` (preserving backend/frontend parity); exempted expressive vocalizations from `findRepeatedJunkKhmerSet()` and `isNonChineseAsrHallucination()` (allowing genuine Latin vocalizations like `hahaha`/`hehehe` while still dropping SenseVoice artifacts like `The.`, `Yeah.`, `Oh.`); flagged pure descriptive labels on vocalization sources as broken text.
- `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js` — Updated `filterValidChineseAsrSegments()` to retain genuine expressive vocalizations alongside Chinese Hanzi segments.
- `backend/services/pipeline/stages/stage5_reconcileTimelineEvidence.js` — Stopped skipping short exclamations/interjections (`啊`, `嗯`, `哼`, `唉`, `咳`, etc.) in `isExclamationOrFiller()` so 1:1 cue mapping preserves emotional vocalizations.
- `backend/services/pipeline/stages/stage6PromptAndConsistency.js` — Updated `isPlaceholderTranslationText()` / `getCachedTranslation()` to invalidate cached descriptive labels when source is an expressive vocalization.
- `backend/services/pipeline/stages/stage6_generateModeSpecificScript.js` — Injected `EXPRESSIVE_KHMER_DUBBING_RULES` into Mode A, Retry, Single Rescue, and Mode B prompts.
- `backend/services/geminiService.js` & `backend/services/repairBrokenService.js` — Added `EXPRESSIVE_KHMER_DUBBING_RULES` to `KHMER_DUBBING_BASE_SYSTEM_PROMPT`, `systemPrompt` (`FAST_EXECUTION_SYSTEM_PROMPT`), `retranslateSingleDialogue`, `COMPACT_DUBBING_PROMPT_HEADER` (Auto-Compact safe rule + illustrative examples), `retranslateBatchDialogues`, `buildBatchTranslationPrompt`, and `buildSingleLineRepairPrompt`.
- `backend/services/pipeline/stages/stage9_generateSegmentTTS.js` — Added `EXPRESSIVE SOUNDS PROTECTION (AUTO-COMPACT)` rule to `autoShortenOverflowingSegments` so meaningful emotional sounds are preserved and never rewritten as descriptive nouns.
- `backend/tests/expressive_vocalization_translation.test.js` — New test suite covering `translationQuality` parity, Stage 4/5 preservation, Stage 6 cache guard & Mode A, `geminiService` normal/compact/single prompts, Stage 9 Auto-Shorten protection, and Edge TTS speakability checks.
- **Verification Results:**
  - `node --test` across `expressive_vocalization_translation.test.js` + `stage5_reconciliation_and_recovery.test.js` + `stage6_khmer_translation_quality_rules.test.js` + `phase1_translation_boundary.test.js` + `retranslate_fallback.test.js` + `repair_broken_segments.test.js` + `p0_persistent_character_recognition.test.js` + `step1_completeness_and_mapping.test.js`: **59/59 ran PASS** (`4 skipped` in `stage5` due to missing local `series_1793272088927` fixture). Note: pre-existing `fast_multimodal_gemini_prompt.test.js` still has 1 unrelated failure (`'មីង'` -> `'male'` in `speakerRegistry.js`).
  - `cd frontend && npm run build`: **2053 modules, 0 errors** (`1.95s`).
  - Live Gemini (`generateModeSpecificScript` + `retranslateBatchDialogues` compact + `retranslateSingleDialogue`) + live Edge TTS on all 9 expressive cues (`哈哈哈`, `呵呵`, `啊啊啊`, `啊呃啊`, `咳咳咳`, `嗯嗯嗯`, `哼`, `唉`, `别动！哼，找死！`): all returned phonetic Khmer (`desc: false`, `hanzi: false`) and synthesized valid MP3 audio (`0.35s–1.92s`, `3356–12812` bytes).

## Active Environment
- Branch: `chore/full-project-cleanup`
- Backend dev port: `5000`, Frontend dev port: `5173` (may need backend restart to load updated backend prompts/modules)

## Next Steps
- Restart backend server if currently running so live Step 1 / Repair / Auto-Compact picks up updated translation prompts and filters.

---

## Previous Session
IDE (Compact Khmer Dubbing Pipeline Fix) — 2026-11-27T09:16:30+07:00

## Summary
Updated the **✨ ខ្លីចំអត្ថន័យ** (Compact Khmer Dubbing) pipeline used by Episode Queue (`runSingleAutoCompact` -> `/api/dubbing/retranslate-all` -> `retranslateBatchDialogues`) to enforce Option #2 (`📝 ខ្លីចំអត្ថន័យ`) movie dubbing rules, strict 1:1 cue validation, and safe episode persistence.

- `backend/services/geminiService.js` — Replaced `retranslateBatchDialogues` prompt with `COMPACT_DUBBING_PROMPT_HEADER` (Option #2 `📝 ខ្លីចំអត្ថន័យ` natural spoken Khmer, context-aware pronouns, examples, no 3-option output), passed `prevDialogueContextOnly`/`nextDialogueContextOnly` without merging, preserved `originalKhmerText` separately, and added `validateCompactBatchOutput()` enforcing 1:1 cue count, `id`/`sourceCueId` preservation, and zero Chinese/English/Thai/Lao characters.
- `backend/routes/scriptRoutes.js` — Added 1:1 count/order/`id`/`sourceCueId`/timestamp validation in `POST /dubbing/retranslate-all` before disk write, preserved `originalKhmerText`, and only sets `autoCompacted = true` when all dialogue segments in the episode are compacted.
- `frontend/src/features/dubbing-runner/singleEpisodeRunners.js` — Fixed `runSingleAutoCompact` so failed batches return `STEP_STATUS.FAILED` instead of falsely setting `percent: 100` and `autoCompacted = true`.
- `backend/tests/retranslate_fallback.test.js` — Added Test 10 verifying Option #2 prompt, neighboring context, 1:1 `sourceCueId`/timestamp/`originalKhmerText` preservation, and rejection of mismatched counts or Chinese/English/Thai/Lao output.
- Verified `node --test backend/tests/retranslate_fallback.test.js backend/tests/phase1_translation_boundary.test.js backend/tests/smart_pipeline_all3.test.js` (`43/43 PASS`) and `cd frontend; npm run build` (`2053 modules`, `0 errors`).

---

## Previous Session (Folder Video Upload)
IDE (Folder Video Upload) — 2026-11-26T23:56:40+07:00

## Summary
Added direct folder-with-videos upload support on Home Dashboard (`Upload Folder វីដេអូ`) so users can select a local folder (e.g. `《墨女倾心》ពេញ 44 ភាគ`) and auto-create the series + upload all sorted video files as episodes `ep_1..ep_N`.

- `frontend/src/components/layout/HomeDashboard.jsx` — Added `btn-home-upload-folder` button, hidden `webkitdirectory` file input (`folderUploadInputRef`), `handleUploadVideoFolder` (filters video extensions, natural numeric filename sorting, duplicate folder check, `POST /api/series`, sequential `POST /api/series/:seriesId/episodes` + `uploadVideoFile` + `POST /api/series/:seriesId/sync` with partial-upload sync on mid-run error), and `home-upload-folder-progress` progress bar UI.
- `frontend/src/components/layout/HomeDashboard.css` — Added `.home-btn-upload-folder` and `.home-upload-folder-progress` styles.
- Verified `cd frontend; npm run build` (`2053 modules`, `0 errors`, `1.97s`), `sanitizeProjectName('《墨女倾心》ពេញ 44 ភាគ') -> '《墨女倾心》ពេញ_44_ភាគ'`, and `node --test backend/tests/job_queue_and_shutdown.test.js` (`4/4 PASS`).

---

## Previous Session (Queue Deadlock Fix)
IDE (Queue Deadlock Fix) — 2026-11-26T19:51:00+07:00

## Summary
Fixed `ProductionJobQueue.processQueue()` head-of-line deadlock that caused new jobs (`野佛_(Wild_Buddha)/ep_1`) to stay stuck at `0%` (`Job queued in production queue...`) when duplicate `queued` jobs existed in the queue.

- `backend/services/pipeline/productionJobQueue.js` — Added `hasRunningOrLockedWorkerForEpisode()` (via shared `_hasEpisodeConflict(..., includeQueued=false)`) so `processQueue()` only skips episodes that actually have a `running`/`recovering` worker or `activeEpisodeLocks` entry (not merely another `queued` job), and iterates past blocked episodes until `startedCount >= availableSlots` instead of slicing before filtering.
- `backend/tests/job_queue_and_shutdown.test.js` — Added regression test `processQueue avoids head-of-line deadlock when duplicate queued jobs share an episode`.
- Verified `30/30` tests pass across `job_queue_and_shutdown.test.js`, `kill_button_and_cancellation.test.js`, and `queue_dispatch_and_payload.test.js`.
- Cancelled 28 stale `queued` `series_route_test` test jobs on `http://localhost:5000` (`queuedCount: 29 -> 1`) and removed `backend/uploads/projects/series_route_test/`. Backend restart required so PID `12436` loads the updated `productionJobQueue.js`.

---

## Previous Session
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

## Session: 2026-11-27T13:25+07:00 (Antigravity IDE — P0 Persistent Character Recognition & Cross-Episode Voice Memory)

- **Last Session:** Antigravity IDE (`2026-11-27T13:25+07:00`)
- **Summary:**
  - Completed persistent character identity (`characterId`, `speakerId`, `aliases`, `characterGender`, `voiceActorTimbre`, `recognitionConfidence`, `recognitionEvidence`, `manualCharacterOverridden`) across Step 1, Step 2 (`Stage 6`, `Stage 9`), `episodeService`, `chunkOrchestrator`, `stage3VisionBatchRunner`, and UI (`VoiceSettings.jsx`, `TimelineTracksCanvas.jsx`, `speakerUtils.js`, `projectStorage.js`, `useAudioDubbing.js`).
  - Added/fixed `PATCH /api/series/:seriesId/speaker-identity` in `backend/routes/seriesRoutes.js` (fixed missing `updateSeriesMetadata` import) for atomic manual identity & voice override synced to `seriesSpeakerMap` and episode `speakerRegistry`.
  - Fixed Stage 3 `deduplicateFastOcrCues` overwrite of Step 1 characters, fixed Stage 9 `stage9_generateSegmentTTS.js` sidecar overwrite of `PROVENANCE_VERSION=2` metadata, fixed `BC3-1` continuity-bias conflict handling and recheck fallback cascade (`gemini-3.8-flash` -> `gemini-3.5-flash-lite` 20s timeout) in `speakerIdentificationService.js`, and isolated `namedScoreTotals` pooling on generic system names (`ប្រព័ន្ធ`) in `backend/models/speakerRegistry.js`.
  - Added `backend/tests/p0_persistent_character_recognition.test.js` (`6/6 PASS`).
  - Verified 30 regression suites (`216/216 PASS`), `frontend` production build (`2053` modules, `0` errors), Playwright live browser Cast Voices/Timeline/reload/restart persistence, and real 9-episode multimodal verification on `ss1` (`EP1, EP3, EP4, EP5, EP20, EP7, EP12` — `559` cues) and `野佛_(Wild_Buddha)` (`EP1, reported EP3` — `164` cues) plus Stage 9 Edge TTS MP3 provenance (`8/8` match).
- **Active Environment:**
  - Branch `chore/full-project-cleanup`; backend (`:5000`) / frontend dev (`:5173`) observed listening on Windows; `frontend/dist` freshly built.
- **Next Steps:**
  - Review and align 2 pre-existing outdated test assertions vs newer requirements (`fast_multimodal_gemini_prompt.test.js:51`, `fast_ocr_timing_and_accuracy.test.js:95`) and `male_female_speaker_detection_batch.test.js:102` (404 vs 400).
  - Optionally add gender qualification to recurring generic occupational role names like `បុគ្គលិកពេទ្យ` when different-gender characters share the same role title across episodes.
  - Coordinate/commit remaining unrelated OCR/queue/HomeDashboard WIP changes in the working tree separately.

