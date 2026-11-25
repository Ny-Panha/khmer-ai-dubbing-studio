# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T17:46:00+07:00

## Summary
- **Targeted Speaker Identification Accuracy Repair & Cached Voice-Switch Latency Fix (`PASS`):**
  1. **Speaker Identification Minimal Repairs (`backend/services/pipeline/speakerIdentificationService.js`, `backend/models/speakerRegistry.js`):**
     - **Audio Clarity & Context:** Raised batch audio bitrate (`24k` → `48k` Pass 1, `64k` focused re-check), expanded surrounding dialogue turn context (`2/1` → `3/3` before/after), and replaced noisy raw cluster exposure with clean auxiliary `audioHint` (never classifying by raw F0 alone).
     - **Domain-Specific Prompt Rules (Zero Hardcoding):** Clarified voice-actor timbre classification for children/small spirits (female actress voicing a boy → `FEMALE`), listening beneath reverb/chorus on distorted ghost voices, per-line male↔female switches in scrolling danmaku/crowd scenes, off-screen callers vs silent on-screen listeners, and verifying actual broadcast voice in-scene rather than carrying over system/announcer gender.
     - **Episodic/Crowd Role Gender Isolation:** Minted gender-qualified `speakerId` (`spk_male_*` / `spk_female_*`) for episodic/crowd roles (`isEpisodicRoleSpeakerName`) and excluded episodic roles from `namedScoreTotals` majority-vote collapse in `syncSegmentsWithSpeakerRegistry` while preserving canonical recurring character IDs (`spk_ស៊ូ_មីង`, `spk_ប្រព័ន្ធ`).
     - **Selective Focused Re-Verification & Audio-Capable Fallback:** Added `findSuspectCuesForFocusedRecheck` to reprocess ONLY affected cues (unresolved, high-precision clean-audio conflicts, suspicious `ប្រព័ន្ធ` on non-system dialogue/inner thoughts) in compact groups (capped at 4), routing audio verification fallback through `AUDIO_MULTIMODAL_FALLBACK_MODELS` instead of audio-weak `gemini-3.1-flash-lite`.
  2. **Cached Voice-Switch Latency Investigation & Fix (`backend/routes/audioRoutes.js`, `backend/services/ttsService.js`, `backend/services/episodeService.js`):**
     - **Root Cause of `3344ms`:** Every cached single-clip voice switch was reading/parsing 9.3–17MB `series.json` 3x, running 28-episode `applySafeDiskHydration` 2x, and atomically rewriting `series.json` 2x (`prePersistPromise` + post-persist).
     - **Fix (without relaxing `<1500ms` threshold):** Added `hasProvenanceVerifiedSegmentCache` to skip redundant pre-persist writes on cache hits, reused mtime+size-validated `getSeriesMetadata` cache for peer scan, and added `{ skipHydration: true, useStatCache: true, skipSanitize: true }` for single-segment metadata updates.
     - **Result:** Standalone cached voice-switch latency dropped from `3344ms` (load) / `505ms` (idle) → **`119–154ms`** (`858–930ms` even concurrently alongside FFmpeg proxy encoding + Chrome), passing `single_clip_voice_switching.test.js` (`3/3`, `<1500ms`).
  3. **Verification Results (ALL source cues as denominator, including unresolved):**
     - **Original 3-Episode Benchmark (`ss1` `ep_1`, `ep_5`, `ep_20` — 249 source cues):**
       - Baseline (`8a1afa8`): `229/249` (`91.97%`), `14` wrong, `6` unresolved (`20` problematic cues).
       - After Repair: **`233/249` (`93.57%`, `+1.60%`)**, `16` wrong, **`0` unresolved** (`1:1 = 249/249`):
         - `ep_1`: `84/86` (`97.67%`, `2` wrong, `0` unresolved, `spkIDCalls=11`)
         - `ep_5`: `70/77` (`90.91%`, `7` wrong — note `id=6` `"你不要过来啊"` is audibly the female-voiced child ghost in source media though frozen benchmark GT says `MALE`, `0` unresolved, `spkIDCalls=12`)
         - `ep_20`: `79/86` (`91.86%`, `7` wrong, `0` unresolved — fixed all 6 unresolved cues + distorted ghosts `#66–67` + `#81–82`, `spkIDCalls=14`)
     - **Unseen Holdout Episode (`ss1` `ep_4` — 71 source cues):**
       - Baseline `ss1`: `42/71` (`59.15%`, `29` wrong).
       - After Repair: **`63/71` (`88.73%`, `+29.58%`)**, `8` wrong, **`0` unresolved**, `1:1 = 71/71`, `spkIDCalls=9`.
     - **Combined 4-Episode Total (320 source cues):** **`296/320` (`92.50%`)**, `24` wrong, **`0` unresolved**, `100%` 1:1 mapping, `100%` cross-episode consistency (`ស៊ូ មីង` → `spk_ស៊ូ_មីង` / `km-KH-PisethNeural`; `ប្រព័ន្ធ` → `spk_ប្រព័ន្ធ` / `km-KH-SreymomNeural`).
     - **Regression Suites & Build:** `119/119` passed across 15 backend suites (including `p0_speaker_id_and_voice_consistency.test.js` `9/9`, `single_clip_voice_switching.test.js` `3/3`, `proxy_preview.test.js` `4/4`), `npm --prefix frontend run build` passed (`0` errors, `2053` modules, `7.64s`).
     - **Real Browser Verification (Playwright Google Chrome on `http://localhost:5173/studio`):** `0` console errors, `0` page errors, `64` HTTP `200`/`206` MP3 responses, `16/16` real Male+Female clips WebAudio-decoded & played across all 4 episodes (`ep_1`, `ep_4`, `ep_5`, `ep_20`). Temporary `test_repair_ss1` project deleted after verification.

## Active Environment
- Backend Server: `http://localhost:5000` (restart backend when idle so updated `audioRoutes.js`, `episodeService.js`, `speakerIdentificationService.js` load in memory)
- Frontend Dev: `http://localhost:5173` (Vite v8.3.5 running)
- Branch: `chore/full-project-cleanup`

## Next Steps
- Restart `backend/server.js` when idle to load updated backend routes/services in the live Studio server.
- Unrelated local working-tree edits (OCR completeness files from earlier tasks) remain unstaged/untouched.
