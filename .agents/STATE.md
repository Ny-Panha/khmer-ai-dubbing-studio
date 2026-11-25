# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T16:23:00+07:00

## Summary
- **P0: Accurate Speaker Identification (Step 1) & Character Voice Consistency (Step 1 → Step 2 + Cross-Episode Memory) (`PASS`):**
  1. **Root Causes Fixed:**
     - **Keyword & Text-Bias Removal (`backend/models/speakerRegistry.js`, `backend/models/segmentModel.js`, `backend/services/geminiService.js`, `frontend/src/utils/speakerUtils.js`, `frontend/src/hooks/useAudioDubbing.js`):**
       - Removed bare `"មីង"` from `FEMALE_KEYWORDS` (stopped poisoning male protagonist `"ស៊ូ មីង"` into female).
       - Stopped `detectSpeakerGender` / `createSegment` / `normalizeScriptData` / frontend Step 2 dispatch from overriding verified Step 1 speaker gender/voice using translated Khmer text.
       - Added `isEpisodicRoleSpeakerName` to block generic/numbered/crowd descriptors (`ស្ត្រីទី១..៣`, `បុរសចំណាស់`, `អ្នកអត្ថាធិប្បាយ`, `UNKNOWN`, etc.) from polluting cross-episode `seriesSpeakerMap`, and fixed `getSpeakerId` to preserve Khmer combining marks (`\p{M}`).
     - **Local Acoustic Diarization + Visual Probe (`backend/services/audioClassifierService.js`, `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js`, `backend/workers/cue_visual_probe.py`):**
       - Added `computeAcousticCueFeatures` (150ms/75ms YIN F0, p25/p75/IQR, voicedRatio, Goertzel 6-band spectral centroid, `bgmSuspected`, conservative ambiguous bounds) and `clusterCueSpeakers` (`ac_spk_*`).
       - Added OpenCV + YuNet `cue_visual_probe.py` (`--mode images` / `--mode montage`) reusing native FFmpeg keyframe extraction (`3-col` contact sheet).
     - **Multimodal Step 1 Speaker Verification & Stage 6-9 Protection (`backend/services/pipeline/speakerIdentificationService.js`, `backend/services/pipeline/dubbingPipeline.js`, `backend/services/pipeline/chunkOrchestrator.js`, `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`, `backend/services/pipeline/stages/stage3VisionBatchRunner.js`, `backend/services/pipeline/stages/stage6_generateModeSpecificScript.js`, `backend/services/pipeline/stages/stage6PromptAndConsistency.js`, `backend/services/pipeline/stages/stage9_generateSegmentTTS.js`, `backend/services/ttsService.js`, `backend/routes/audioRoutes.js`, `backend/routes/scriptRoutes.js`, `backend/routes/jobRoutes.js`):**
       - Added `identifySpeakersForCues` running local acoustic + visual probing first, resolving deterministic system cues locally, and batching uncertain cues in compact scene windows (10 cues / 35s `24kbps` MP3 + 3-col montage) with 1:1 `sourceCueId` preservation, missing-cue retry, `internalSpeakerTurns`, `speakerEvidence`, and `review_needed` fallback (never guessing solely from raw pitch thresholds or Khmer text).
       - Fixed `createCanonicalSegment`, `applyTranslatedSegmentResult`, `enforceEpisodeCharacterConsistency`, and `syncSegmentsWithSpeakerRegistry` to preserve Step 1 verified metadata & `speakerId` unconditionally and lock Step 2 TTS provenance (`actualVoiceId` cache verification).
  2. **Verification Results (Real Media `ss1` `ep_1`, `ep_5`, `ep_20` — 249 cues total):**
     - **Baseline (existing `ss1` before fix):** `ep_1` `73.26%` (`63/86`, `23` wrong), `ep_5` `81.33%` (`61/75`, `14` wrong), `ep_20` `91.86%` (`79/86`, `7` wrong) — Aggregate: `203/247` (`82.19%`), `44` wrong.
     - **After P0 Fix (measured via `eval_3_episodes.js`):**
       - `ep_1`: `1:1 = 86/86`, **`98.84%` (`85/86` verified)**, `wrong = 1`, `reviewNeeded = 0`, `spkIDCalls = 9`, `ttsClips = 16`.
       - `ep_5`: `1:1 = 77/77`, **`88.31%` (`68/77` verified)**, `wrong = 9`, `reviewNeeded = 0`, `spkIDCalls = 9`, `ttsClips = 16`.
       - `ep_20`: `1:1 = 86/86`, **`95.00%` (`76/80` verified)**, `wrong = 4`, `reviewNeeded = 6`, `spkIDCalls = 10`, `ttsClips = 16`.
       - **Aggregate:** **`229/243` (`94.24%` verified voice accuracy)**, `14` wrong (`-68.2%` errors), `6` marked `review_needed`, `100%` 1:1 cue completeness, `100%` cross-episode consistency (`ស៊ូ មីង` → `spk_ស៊ូ_មីង` / `km-KH-PisethNeural` across `ep_1`, `ep_5`, `ep_20`; `ប្រព័ន្ធ` → `spk_ប្រព័ន្ធ` / `km-KH-SreymomNeural` across `ep_1`, `ep_5`, `ep_20`).
     - **Backend Regression Suites (`node --test`):** **110/110 passed** across 11 suites (`p0_speaker_id_and_voice_consistency`, `accurate_speaker_detection_and_voice_assignment`, `speaker_identity_and_series_voice_memory`, `gender_voice_consistency`, `ai_detection_and_dubbing_prompt_fix`, `cast_voice_switching`, `voice_provenance_cache_isolation`, `stage6_khmer_translation_quality_rules`, `step1_completeness_and_mapping`, `series_persist_and_sync`, `tts_smart_skip_and_progress`). Note: `single_clip_voice_switching.test.js` hit cached audio (`⚡ Reusing provenance-verified cached audio`) cleanly in `2/3` subtests, failing only the `<1500ms` latency threshold (`3344ms` under Windows disk I/O).
     - **Frontend Build:** `npm --prefix frontend run build` passed (`0` errors, `2052` modules, `8.57s`).
     - **Real Browser Playback Verification (Playwright Chromium on `http://localhost:5173/studio`):** **0 console errors, 0 page errors**, 24 HTTP `200`/`206` audio responses, **12/12 real generated `.mp3` clips played & WebAudio-decoded** (6 Male `km-KH-PisethNeural` + 6 Female `km-KH-SreymomNeural` across `ep_1`, `ep_5`, `ep_20`; non-zero RMS `0.084–0.107`, `duration 0.92–2.53s`, `currentTime` advancing cleanly). Temporary `test_p0_ss1` project deleted after verification.

## Active Environment
- Backend Server: `http://localhost:5000` (restart backend server cleanly when testing live API routes so updated backend modules load in memory)
- Frontend Dev: `http://localhost:5173` (Vite v8.3.5 running)
- Branch: `chore/full-project-cleanup`

## Next Steps
- Restart `backend/server.js` when idle if testing live `/api/jobs/start` or `/api/generate-script` in the running Studio UI.
- Unrelated local working-tree edits (OCR completeness files from earlier tasks) remain unstaged/untouched.
