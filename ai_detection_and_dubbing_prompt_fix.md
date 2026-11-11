# Khmer AI Dubbing Studio — AI Detection, OCR, Gender & Dubbing Prompt Upgrade

Use the master prompt below in your AI IDE (`/agents`, Cursor, Windsurf, or Claude Code) on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) to upgrade the Gemini Vision OCR prompt, Speaker Gender (`ប្រុស` vs `ស្រី`) detection, Drama Genre register locking, and `DubbingModeTab.jsx` UI controls.

## 1. Why AI Detection Currently Misses Cues or Misclassifies Gender (`ប្រុស` vs `ស្រី`)

| Detection Layer | Current Behavior in [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) | Why It Fails in Practice | Exact Upgrade |
| :--- | :--- | :--- | :--- |
| **1. Fast OCR Gender Blindness (`stage3_extractChineseSubtitles.js`)** | In `Fast OCR Mode` (`fast_ocr`), Gemini Vision only extracts Chinese subtitle text and timestamps from frames without inspecting the speaker's face/costume on screen | Because audio diarization (`stage4`) is skipped in Fast OCR, downstream stages have zero visual gender evidence and default all 19 segments to `ប្រុស` (`male`) | Upgrade the `stage3` Gemini Vision OCR schema to extract **both** the Chinese subtitle AND visual speaker metadata (`visualGender: "male" \| "female"`, `speakerHint`, `isNarratorOrThought`) from the video frame |
| **2. Neutral Chinese Names & Male Fallback (`backend/models/speakerRegistry.js`)** | `detectSpeakerGender()` checks hardcoded `FEMALE_KEYWORDS` / `MALE_KEYWORDS` and falls back to `male` (`km-KH-PisethNeural`) or majority vote when a name is neutral | Chinese character names (e.g., 林峰, 苏婉, 师尊) or unlabelled OCR lines lack explicit `女/小姐` keywords, turning female lines into `ប្រុស` | Add **Visual Frame Gender Priority** + **Conversational Turn-Taking Inference** (if Speaker A addresses `"ព្រះនាង/អូន/នាង"`, the reply cue is locked to `female`) + expanded Chinese/Khmer kinship & Xianxia title dictionaries |
| **3. Missed Short Cues & Corner Watermark Noise (`stage3_extractChineseSubtitles.js`)** | `detectSubtitleChangePoints` uses a `0.75s` base interval and pixel-diff threshold `~5.0` across a wide bottom region | Fast exclamations (`0.35s–0.6s` like `"住手!"`, `"皇上!"`, `"是!"`) are skipped or merged, while animated corner logos trigger false splits | Crop FFmpeg pixel-diff ROI strictly to the center-bottom subtitle box (`x=0.14*W..0.86*W, y=0.78*H..0.93*H`), lower short-cue detection floor to `0.35s`, and deduplicate adjacent identical OCR strings with `< 0.25s` gap |
| **4. Genre & Pronoun Drift (`geminiService.js` & `stage6_generateModeSpecificScript.js`)** | `buildDialoguePrompt()` translates segments directly without locking a character cast table first | In `ancient` (`បុរាណចិន / Xianxia`) or `auto` mode, characters switch between modern (`ខ្ញុំ/អ្នក`) and royal/Xianxia (`ទូលបង្គំ/ខ្ញុំម្ចាស់/ម្ចាស់បង`) mid-episode, or sentences are too long for the clip duration | Require a structured `castRegistry[]` + `detectedGenre` header in Gemini's JSON response before `segments[]`, and enforce a strict **Khmer Lip-Sync Pacing Rule (`<= 5.5 syllables/sec`)** |
| **5. `DubbingModeTab.jsx` Truncated Tabs & Direction Input (`frontend/src/components/media/`)** | Top workflow tabs truncate as `2. ... 38s` / `3. ... 38s`, and `ឈ្មោះតួអង្គ / DIRECTION` is an empty textarea | Users have to manually type prompt rules every time to fix gender or tone | Fix top tab badge layout so Khmer tab titles never truncate, and add **1-Click Smart Detection Chips** above the `DIRECTION` textarea |

## 2. Copy-Paste Master Prompt for Your AI IDE (English + Khmer SDD Spec)

### Role & Objective
You are a Principal Multimodal AI Prompt Engineer and Full-Stack Developer working on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio). Follow the Spec-Kit SDD workflow to upgrade AI subtitle/speaker/gender/genre detection and translation quality across `backend/services/geminiService.js`, `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`, `backend/services/pipeline/stages/stage6_generateModeSpecificScript.js`, `backend/models/speakerRegistry.js`, and `frontend/src/components/media/DubbingModeTab.jsx` (and `MediaLibrary.jsx`).

### Step 1: Upgrade Vision OCR + Visual Speaker Gender Detection (`stage3_extractChineseSubtitles.js`)
1. **Center-Bottom Subtitle ROI & Short-Cue Sensitivity:**
   - In `detectSubtitleChangePoints`, constrain the FFmpeg crop/pixel-diff region to the center-bottom subtitle safe zone (`w=0.72*iw:h=0.16*ih:x=0.14*iw:y=0.78*ih`) so top/corner watermarks and TikTok/Reels logos never cause false triggers.
   - Support short dialogue cues down to `0.35s` (instead of dropping or missing cues shorter than `0.75s`), and merge consecutive cues only when the normalized Chinese text is identical and the gap is `< 0.20s`.
2. **Multimodal Visual Speaker & Gender Extraction in `Fast OCR` and `Standard` Modes:**
   - Update the Gemini Vision OCR prompt in `stage3_extractChineseSubtitles.js` so that for every detected subtitle frame, Gemini inspects **both the burned-in Chinese text AND the active speaker on screen**:
     - `textZh`: Exact Chinese subtitle text (strip decorative brackets, music notes `♪`, or watermark text).
     - `visualGender`: `"male"` | `"female"` | `"unknown"` based on the visible speaking character's face, hair, clothing/costume, and open mouth in that frame.
     - `speakerVisualHint`: Short tag such as `"male_lead_ancient"`, `"female_lead_white_robe"`, `"emperor"`, `"maid"`, `"ceo_suit"`, or `"offscreen_narrator"`.
     - `deliveryType`: `"dialogue"` | `"inner_thought"` | `"narration"`.
   - Pass `visualGender`, `speakerVisualHint`, and `deliveryType` inside each cue object into Stage 6 (`stage6_generateModeSpecificScript.js`) and `geminiService.js` so `Fast OCR Mode` has full visual gender awareness without needing heavy audio diarization!

### Step 2: Chain-of-Thought Cast Registry & Lip-Sync Khmer Prompt (`backend/services/geminiService.js` & `stage6_generateModeSpecificScript.js`)
Upgrade `buildDialoguePrompt()` and `buildRecapPrompt()` in `backend/services/geminiService.js` (and `stage6_generateModeSpecificScript.js`):

1. **Mandatory Pre-Translation `castRegistry` & Genre Locking:**
   - Instruct Gemini to first output `detectedGenre` (`"ancient" | "ceo" | "action" | "comedy"`) and a `castRegistry` array mapping every character before generating `segments`:
     ```json
     {
       "detectedGenre": "ancient",
       "castRegistry": [
         {
           "speakerId": "spk_male_1",
           "speakerLabelKh": "តួឯកប្រុស",
           "voiceGender": "male",
           "roleArchetype": "emperor_or_sect_leader",
           "selfPronounKh": "យើង / បង",
           "addressPronounKh": "នាង / អូន / ឯង"
         },
         {
           "speakerId": "spk_female_1",
           "speakerLabelKh": "តួឯកស្រី",
           "voiceGender": "female",
           "roleArchetype": "princess_or_consort",
           "selfPronounKh": "ខ្ញុំម្ចាស់ / អូន / នាងខ្ញុំ",
           "addressPronounKh": "ព្រះអង្គ / ម្ចាស់បង / លោកប្រុស"
         }
       ],
       "segments": [ ... ]
     }
     ```
2. **Strict Gender & Turn-Taking Rules (`ប្រុស` vs `ស្រី`):**
   - Never default all segments to `"male"`.
   - Combine 3 signals to determine `voiceGender` (`"male"` or `"female"`) for every segment:
     1. **Visual Evidence (`visualGender` & `speakerVisualHint`)** from Stage 3 OCR frames.
     2. **Conversational Turn-Taking:** If Cue `N` says `"皇上 / 师兄 / 总裁 / 老公"` (addressing a male), then Cue `N` is likely spoken by a female or subordinate, and the immediate reply in Cue `N+1` is spoken by that male character (and vice versa when Cue `N` addresses `"皇后 / 师妹 / 夫人 / 小姐 / 老婆"`).
     3. **Pronoun & Kinship Context** in the Chinese source text and Khmer translation.
3. **Genre-Specific Khmer Vocabulary & Lip-Sync Duration Rule:**
   - **`ancient` (`🏛️ បុរាណចិន / Xianxia`):** Enforce natural Khmer period-drama & Xianxia phrasing (`ព្រះអង្គ, ព្រះនាង, ទូលបង្គំ, ខ្ញុំម្ចាស់, ម្ចាស់បង, សិស្សប្អូន, គ្រូពេទ្យទេព, បក្ស, ថាមពលធាតុ`). Forbid modern English/slang words.
   - **`ceo` (`🏙️ សម័យទំនើប / CEO`):** Enforce modern C-drama romance/corporate phrasing (`លោកប្រធាន, អ្នកនាង, លេខា, អគ្គនាយក, បង, អូន, ខ្ញុំ`).
   - **`action` (`⚔️ Action / សងសឹក`):** Enforce punchy, high-impact short imperative clauses (`បញ្ឈប់ភ្លាម!, ថយក្រោយ!, ហ៊ានណាស់!`).
   - **`comedy` (`🎭 កំប្លែង / គ្រួសារ`):** Enforce lively everyday conversational Khmer with natural particles (`ណ៎ា, ហ្នឹងណា, ងាប់ហើយ, ម៉េចចឹង`).
   - **Lip-Sync Duration Constraint:** Calculate `durationSec = end - start` for each cue. Require the Khmer translation (`text` / `khmerText`) to match the exact speaking window (`~4.5 to 5.5 Khmer words/sec` max) so TTS (`km-KH-PisethNeural` / `km-KH-SreymomNeural`) speaks at natural speed (`1.0x–1.15x`) without rushing or clipping!

### Step 3: Smarter Gender Detection & Fallback in `backend/models/speakerRegistry.js`
1. Expand `FEMALE_KEYWORDS`, `MALE_KEYWORDS`, `KHMER_FEMALE_PRONOUNS`, and `KHMER_MALE_PRONOUNS` in `backend/models/speakerRegistry.js`:
   - Add Chinese & Khmer female markers: `师妹, 师姐, 娘娘, 贵妃, 王妃, 仙子, 姑娘, 丫鬟, 妈, 姐, 妹, 老婆, 闺蜜, ខ្ញុំម្ចាស់, នាងខ្ញុំ, ម្ចាស់បងស្រី, សិស្សប្អូនស្រី, អ្នកម្នាង, ព្រះមហេសី, អ្នកនាងតូច`.
   - Add Chinese & Khmer male markers: `师兄, 师尊, 师父, 王爷, 太子, 将军, 大哥, 朕, 本王, 本尊, 爸, 哥, 弟, 老公, ទូលបង្គំ, ព្រះអង្គម្ចាស់, ម្ចាស់បង, សិស្សច្បង, លោកម្ចាស់, លោកប្រធាន`.
2. Update `detectSpeakerGender(segment, context)`:
   - Priority 1: Explicit `segment.visualGender` (`"male"` / `"female"`) when confidence is high.
   - Priority 2: Explicit `segment.voiceGender` / `segment.gender` from Gemini's `castRegistry`.
   - Priority 3: Self-pronoun analysis in Khmer/Chinese (`ខ្ញុំម្ចាស់ / នាងខ្ញុំ` -> `female`, `ទូលបង្គំ / យើងខ្ញុំព្រះករុណា` -> `male`; carefully distinguish **self-pronouns** from **addressed pronouns** so a female saying `"ព្រះអង្គ!"` is NOT misclassified as male just because the word `"ព្រះអង្គ"` appears in her line!).

### Step 4: Polish `DubbingModeTab.jsx` & Top Step Tabs (`frontend/src/components/media/`)
1. **Fix Top Tab Truncation (`1. Video`, `2. ... 38s`, `3. ... 38s`):**
   - In `MediaLibrary.jsx` / `MediaLibrary.css`, adjust the step tab layout (`padding`, `font-size: 11.5px`, compact duration badge `38s`) so the tab titles (`1. វីដេអូ`, `2. បញ្ចូលសំឡេង AI`, `3. កែសម្រួលអត្ថបទ`) are readable without cutting off into `2. ...`.
2. **Add 1-Click Smart Prompt Chips under `ឈ្មោះតួអង្គ / DIRECTION` (`DubbingModeTab.jsx`):**
   - Directly above the `ឈ្មោះតួអង្គ / DIRECTION` textarea, render a row of clickable quick-insert chips that append helpful prompt hints into the direction box:
     - `🎭 ស្គាល់ភេទតាមមុខតួអង្គ (Auto Face Gender)`
     - `👑 រាជស័ព្ទបុរាណចិន (Royal/Xianxia)`
     - `💼 សន្ទនាអគ្គនាយក (Modern CEO)`
     - `⚡ ឃ្លាខ្លីត្រូវមាត់ 100% (Strict Lip-Sync)`
   - Show a clear active summary pill inside the `⚡ Fast OCR Mode` card confirming: `"OCR + Visual Speaker Gender + Direct Translate"`.

## 3. ប្រអប់បញ្ជាខ្លីជាភាសាខ្មែរ (Khmer Quick Command for `/agents`)

អ្នកអាចចម្លង (Copy) ឃ្លាខាងក្រោមនេះដាក់ចូល `/agents` ក្នុង IDE ដើម្បីឱ្យវាអនុវត្តតាមឯកសារ `ai_detection_and_dubbing_prompt_fix.md`៖

> សូមអនុវត្តការកែលម្អ AI Detection & Prompt ទាំង 4 Steps ក្នុង `ai_detection_and_dubbing_prompt_fix.md` តាម Spec-Kit SDD workflow៖
> 1. **Step 1 (`stage3_extractChineseSubtitles.js`):** កែលម្អ Gemini Vision OCR ឱ្យចាប់យកទាំងអក្សរចិន (`textZh`) និងមើលមុខ/សម្លៀកបំពាក់តួអង្គក្នុង Frame ដើម្បីកំណត់ភេទ (`visualGender: "male" | "female"`, `speakerVisualHint`) ទោះបីប្រើ `Fast OCR Mode` ក៏ដោយ ព្រមទាំងកាត់តំបន់ ROI ចំកណ្តាលខាងក្រោមដើម្បីកុំឱ្យជាប់ Logo/Watermark និងចាប់ឃ្លាខ្លីៗចាប់ពី `0.35s`។
> 2. **Step 2 (`geminiService.js` & `stage6_generateModeSpecificScript.js`):** កែ Prompt ក្នុង `buildDialoguePrompt` និង `buildRecapPrompt` ឱ្យបង្កើត `castRegistry` និង `detectedGenre` មុនពេលបកប្រែ `segments` ដើម្បីចាក់សោភេទតួអង្គ (`ប្រុស/ស្រី`) សព្វនាមតាមប្រភេទរឿង (`បុរាណចិន/Xianxia`, `CEO`, `Action`, `កំប្លែង`) និងកំណត់ប្រវែងពាក្យខ្មែរឱ្យត្រូវតាមមាត់ (`<= 5.5 ព្យាង្គ/វិនាទី`)។
> 3. **Step 3 (`speakerRegistry.js`):** បំបែកការវិភាគសព្វនាមខ្លួនឯង (`ខ្ញុំម្ចាស់/នាងខ្ញុំ` = ស្រី, `ទូលបង្គំ` = ប្រុស) ចេញពីសព្វនាមហៅគេ (ឧ. តួស្រីហៅ `"ព្រះអង្គ!"` មិនត្រូវច្រឡំថាជាសំឡេងប្រុសទេ) និងបន្ថែមពាក្យគន្លឹះតួអង្គចិន-ខ្មែរ។
> 4. **Step 4 (`DubbingModeTab.jsx` & `MediaLibrary.jsx`):** កែ Tab ខាងលើកុំឱ្យដាច់អក្សរ (`2. ... 38s`) និងបន្ថែមប៊ូតុង Quick Prompt Chips ពីលើប្រអប់ `ឈ្មោះតួអង្គ / DIRECTION` ព្រមទាំងរត់តេស្តឱ្យចប់ 100%។
