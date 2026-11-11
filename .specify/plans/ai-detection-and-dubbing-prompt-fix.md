# Implementation Plan: AI Detection, OCR, Gender & Dubbing Prompt Upgrade

## 1. Architecture & File Touchpoints
1. **`backend/services/ffmpegService.js`**:
   - Update `extractSubtitleDifferenceGrid` to use center-bottom subtitle safe-zone crop (`crop=w=0.72*iw:h=0.16*ih:x=0.14*iw:y=0.78*ih`) and sensitive center-band diff calculation so corner watermarks/logos do not cause false change points.
   - Update `detectSubtitleChangePoints` to lower `minPeakDist` (`0.35s`) and candidate cue state duration floor so rapid `0.35s – 0.60s` exclamations are captured.
2. **`backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`**:
   - Upgrade `buildVisionBatchContents` prompt and `extractSubtitlesFromFramesBatch` parser to extract `textZh` / `chineseText`, `visualGender` (`"male" | "female" | "unknown"`), `speakerVisualHint`, and `deliveryType` (`"dialogue" | "inner_thought" | "narration"`), while stripping decorative brackets/music notes `♪`/watermarks.
   - Update frame-to-cue merging and duration floors in `extractChineseSubtitles` and `deduplicateFastOcrCues` to preserve cues down to `0.35s`, merge adjacent identical cues within `< 0.20s` (while keeping chunk boundary overlap dedup intact), and pass `visualGender`, `speakerVisualHint`, and `deliveryType` on every cue object.
3. **`backend/services/geminiService.js` & `backend/services/pipeline/stages/stage6_generateModeSpecificScript.js`**:
   - Update `SCRIPT_RESPONSE_SCHEMA` in `geminiService.js` with `detectedGenre` and `castRegistry`.
   - Upgrade `KHMER_DUBBING_BASE_SYSTEM_PROMPT`, `buildDialoguePrompt()`, and `buildRecapPrompt()` in `geminiService.js` with `castRegistry`, 3-signal gender & turn-taking rules, genre-specific Khmer vocabulary (`ancient`, `ceo`/`modern`, `action`, `comedy`), and lip-sync pacing rules (`<= 5.5 syllables/sec`, `~4.5 to 5.5 Khmer words/sec` max).
   - Upgrade `stage6_generateModeSpecificScript.js` so `dialoguePayload` includes `visualGender`, `speakerVisualHint`, and `deliveryType`, `modeAPrompt` requests `detectedGenre` and `castRegistry` alongside `segments`, and `applyBatchTranslations` / `applyTranslatedSegmentResult` leverages `castRegistry` and `visualGender` to resolve speaker gender accurately.
4. **`backend/models/speakerRegistry.js`**:
   - Expand `FEMALE_KEYWORDS`, `MALE_KEYWORDS`, `KHMER_FEMALE_PRONOUNS`, and `KHMER_MALE_PRONOUNS` with all required Chinese & Khmer markers, plus 1st-person self-pronoun lists (`SELF_FEMALE_PRONOUNS`, `SELF_MALE_PRONOUNS`).
   - Upgrade `detectSpeakerGender` to accept either `(speakerName, explicitGender, khmerText)` or `(segmentObject, contextObject, khmerText)` and evaluate Priority 1 (`visualGender`), Priority 2 (`voiceGender` / `gender` / `explicitGender` from `castRegistry`), and Priority 3 (speaker title/name keywords + 1st-person self-pronouns vs addressed pronouns).
5. **`frontend/src/components/media/MediaLibrary.jsx`, `MediaLibrary.css`, & `DubbingModeTab.jsx`**:
   - Update `.media-tabs-header` and `.media-tab-btn` in `MediaLibrary.css` and tab labels in `MediaLibrary.jsx` so tabs never truncate into `2. ...`.
   - Add 1-Click Smart Prompt Chips above the `ឈ្មោះតួអង្គ / DIRECTION` textarea and the `"OCR + Visual Speaker Gender + Direct Translate"` summary badge inside the `⚡ Fast OCR Mode` card in `DubbingModeTab.jsx`.

## 2. Verification Strategy
- Run unit & integration test suite `backend/tests/ai_detection_and_dubbing_prompt_fix.test.js` covering Steps 1–4.
- Run existing regression suites (`fast_ocr_mode.test.js`, `stage3_change_driven_double_read.test.js`, `gender_voice_consistency.test.js`).
- Run `npm --prefix frontend run lint` (`oxlint`) and `npm --prefix frontend run build` (`vite build`).

