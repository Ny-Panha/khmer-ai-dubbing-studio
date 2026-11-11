# Specification: AI Detection, OCR, Gender & Dubbing Prompt Upgrade

## 1. Goal & Scope
Upgrade DragonDub AI's Chinese-to-Khmer subtitle extraction, multimodal speaker/gender detection, Gemini translation prompt architecture, speaker registry gender heuristics, and Dubbing Mode UI controls across 4 focused deliverables:
1. **Step 1**: Upgrade Chinese Subtitle Detection & Multimodal Visual Gender OCR (`stage3_extractChineseSubtitles.js` & `ffmpegService.js`).
2. **Step 2**: Upgrade Gemini Dubbing & Translation Prompt Architecture (`geminiService.js` & `stage6_generateModeSpecificScript.js`).
3. **Step 3**: Strengthen Speaker & Gender Registry Heuristics (`speakerRegistry.js`).
4. **Step 4**: Fix Dubbing Mode Tab UI Truncation & Add Smart Prompt Presets (`DubbingModeTab.jsx`, `MediaLibrary.jsx`, `MediaLibrary.css`).

## 2. Requirements Breakdown

### Step 1: Subtitle Detection & Multimodal Visual Gender OCR
- **Center-Bottom Subtitle ROI (`ffmpegService.js`)**: Constrain the subtitle ROI crop/pixel-diff region in `extractSubtitleDifferenceGrid` / `detectSubtitleChangePoints` to the center-bottom subtitle safe zone (`crop=w=0.72*iw:h=0.16*ih:x=0.14*iw:y=0.78*ih` or normalized center-bottom safe bounds) so corner watermarks/logos do not trigger false splits.
- **Short-Cue Sensitivity (`0.35s` floor)**: Preserve short Chinese dialogue exclamations (`0.35s – 0.60s`) as distinct cues (`minDur >= 0.35s`) and merge consecutive identical OCR frames only when `areChineseTextsEquivalent(textA, textB)` is true and the gap is `< 0.20s` (with chunk-boundary overlap dedup preserved).
- **Multimodal Visual Speaker & Gender Extraction (`stage3_extractChineseSubtitles.js`)**: Upgrade the Gemini Vision OCR prompt (`buildVisionBatchContents`) to extract:
  - `textZh` / `chineseText`: Exact Chinese subtitle text (strip decorative brackets, music notes `♪`, or watermarks).
  - `visualGender`: `"male"` | `"female"` | `"unknown"` from the visible speaking character's face, hair, costume, and open mouth.
  - `speakerVisualHint`: Short tag (e.g., `"male_lead_ancient"`, `"female_lead_white_robe"`, `"emperor"`, `"maid"`, `"ceo_suit"`, `"offscreen_narrator"`).
  - `deliveryType`: `"dialogue"` | `"inner_thought"` | `"narration"`.
- Pass `visualGender`, `speakerVisualHint`, and `deliveryType` inside each cue object into Stage 6 (`stage6_generateModeSpecificScript.js`) and `geminiService.js`.

### Step 2: Gemini Dubbing & Translation Prompt Architecture
- **Pre-Translation `castRegistry` & Genre Locking**: Require `detectedGenre` (`"ancient" | "ceo" | "modern" | "action" | "comedy"`) and `castRegistry` (`speakerId`, `speakerLabelKh`, `voiceGender`, `roleArchetype`, `selfPronounKh`, `addressPronounKh`) in `SCRIPT_RESPONSE_SCHEMA`, `buildDialoguePrompt()`, `buildRecapPrompt()`, and Stage 6 Mode A batch translation prompts.
- **3-Signal Gender & Turn-Taking Rules (`ប្រុស` vs `ស្រី`)**: Combine (1) Visual Evidence (`visualGender`, `speakerVisualHint`), (2) Conversational Turn-Taking (Cue `N` addressing male title -> Cue `N` female/subordinate, reply Cue `N+1` male, and vice versa), and (3) Pronoun & Kinship Context.
- **Genre-Specific Khmer Vocabulary & Lip-Sync Pacing Rule**: Enforce genre-authentic Khmer registers (`ancient`, `ceo`/`modern`, `action`, `comedy`) and strict Khmer TTS pacing (`<= 5.5 syllables/sec`, `~4.5 to 5.5 Khmer words/sec` max).

### Step 3: Speaker & Gender Registry Heuristics (`speakerRegistry.js`)
- Expand `FEMALE_KEYWORDS` and `MALE_KEYWORDS` with Chinese & Khmer kinship, royal, wuxia/xianxia, and modern drama pronouns/titles.
- Upgrade `detectSpeakerGender` to support both `(speakerName, explicitGender, khmerText)` and passing a `segment` object `(segment, context)` with 3-tier priority:
  1. Priority 1: Explicit `segment.visualGender` (`"male"` / `"female"`) when confidence is high.
  2. Priority 2: Explicit `segment.voiceGender` / `segment.gender` / `explicitGender` from Gemini's `castRegistry`.
  3. Priority 3: Speaker title/name keywords (`FEMALE_KEYWORDS` before `MALE_KEYWORDS`) and 1st-person self-pronouns (`ខ្ញុំម្ចាស់ / នាងខ្ញុំ / 臣妾 / 奴婢 / 本宫` -> `FEMALE`, `ទូលបង្គំ / ខ្ញុំបាទ / យើងខ្ញុំព្រះករុណា / 朕 / 微臣 / 本王` -> `MALE`), strictly distinguishing self-pronouns from addressed pronouns.

### Step 4: Dubbing Mode Tab UI Truncation & Smart Prompt Presets
- **Fix Top Tab Truncation (`MediaLibrary.jsx` & `MediaLibrary.css`)**: Prevent `.media-tab-btn` from truncating into `2. ...` on narrow left sidebars.
- **Add 1-Click Smart Prompt Chips (`DubbingModeTab.jsx`)**: Add 4 quick-insert direction chips (`🎭 ស្គាល់ភេទតាមមុខតួអង្គ (Auto Face Gender)`, `👑 រាជស័ព្ទបុរាណចិន (Royal/Xianxia)`, `💼 សន្ទនាអគ្គនាយក (Modern CEO)`, `⚡ ឃ្លាខ្លីត្រូវមាត់ 100% (Strict Lip-Sync)`) above the `ឈ្មោះតួអង្គ / DIRECTION` textarea, and display the active summary pill `"OCR + Visual Speaker Gender + Direct Translate"` inside the `⚡ Fast OCR Mode` card.

