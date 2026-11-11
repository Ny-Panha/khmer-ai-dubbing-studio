# Khmer AI Dubbing Studio — Clean Unified 3-Step Auto-Pipeline & Batch UI Fix

Use the prompt below in your AI IDE (`/agents`, Cursor, Windsurf, or Claude Code) on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) to clean up the cluttered, overflowing UI in `GeminiRouteModal.jsx` (`localhost:5173/batch`), eliminate the annoying `"សូមជ្រើសរើសភាគជាមុនសិន"` popup, and make **1-Click Full 3-Step Auto-Production (`Translate Script ➔ AI Translate Voice ➔ AI បិទសំឡេងចិន`)** work seamlessly.

## 1. Exact Bugs Found in Your 2 Screenshots (`image_158954.jpg` & `image_158956.png`)

| Bug in Screenshot | Root Cause in [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) (`GeminiRouteModal.jsx`) | Clean Solution |
| :--- | :--- | :--- |
| **1. Popup `"⚠️ សូមជ្រើសរើសភាគជាមុនសិន"` when clicking `1. Translate Script (12 ភាគ)`** | The button label counts 12 remaining episodes, but `selectedEpIds` is empty (`0` checked), so `targetEpisodes.length === 0` blocks execution with a warning modal | **Smart Auto-Target Fallback:** If `selectedEpIds.size === 0` when the user clicks any Run/Translate/Voice/BGM button, automatically target all episodes needing that step (and check their checkboxes) instead of showing `"សូមជ្រើសរើសភាគជាមុនសិន"`! |
| **2. Broken Selection Pills (`✓ គ្រប់ភាគរួចរាល់ 100%` & `ទាំងអស់ (0 ភាគ)`)** | `pendingEpisodes` / `episodesWithVideo` filter checks the wrong property when episodes have failed jobs (`EP2`, `EP3`) or broken segments (`EP1: ខូច 268 ឃ្លា`) | Fix episode readiness calculation: an episode is only `100% Ready` when `scriptSegments.length > 0 && brokenCount === 0 && missingAudioCount === 0 && hasCleanBgm`. Count all 21 episodes accurately in `ទាំងអស់ (21 ភាគ)` and `ភាគមិនទាន់ចប់ / ខូច` |
| **3. Cluttered Top Header & Buttons Cut Off on the Right (`Run All 3 Steps (Auto-...` & `Open Export...`)** | 5 stacked header rows (Selection row + Expanded Setup + 3 big progress bars + 4 giant rainbow buttons + 8 filter/action buttons in `flex-nowrap`) take 75% of screen height and overflow horizontally | Collapse `Batch Script Setup` by default (`isScriptSetupExpanded = false`), combine the 3 progress stats into compact inline pills, and replace the 2 overflowing button rows with **1 Clean, Wrapping Studio Control Bar** |
| **4. Manual Step-by-Step Clicking vs. True 3-Step Auto-Pipeline** | Running Translate, Voice TTS, and Demucs separately requires manual babysitting, and if `EP1` has `268 ឃ្លាខូច` (`missingAudio`), it stops instead of auto-repairing and generating TTS + Clean BGM | Make **`🚀 ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន (Run Full 3-Step Pipeline)`** the primary workflow (both on the Top Bar and on every Episode Card `EP1`, `EP2`, `EP3`) so 1 click automatically runs: **`1. Translate/Repair Script ➔ 2. AI Voice (ពិសិដ្ឋ/ស្រីមុំ) ➔ 3. AI បិទសំឡេងចិន (Clean BGM)`** |

## 2. Copy-Paste Master Prompt for `/agents` (Clean UI + Unified 3-Step Auto-Pipeline)

### Role & Objective
You are a Principal React/Vite UI Architect working on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio). Follow the Spec-Kit SDD workflow to refactor `frontend/src/components/dashboard/GeminiRouteModal.jsx` (and its CSS / `route-runners/` cards) so the Batch Generate Studio UI is ultra-clean, never overflows horizontally, never blocks the user with `"សូមជ្រើសរើសភាគជាមុនសិន"`, and runs all 3 dubbing steps (`Translate Script ➔ AI Voice ➔ AI បិទសំឡេងចិន`) in one unified pipeline.

### Step 1: Fix Selection Logic & Eliminate `"សូមជ្រើសរើសភាគជាមុនសិន"` (`GeminiRouteModal.jsx`)
1. **Accurate Episode Counts:**
   - Ensure `allSelectableEpisodes` includes all episodes in the series (`episodes.length`, e.g., `21 ភាគ`), even if a previous job failed or has broken segments.
   - Define `incompleteEpisodes` as any episode where `!hasValidScript || brokenSegmentCount > 0 || missingVoiceCount > 0 || !hasCleanBgm`.
   - Fix the top selection pills so they show accurate counts:
     - `ទាំងអស់ (${episodes.length} ភាគ)`
     - `ភាគមិនទាន់ចប់ (${incompleteEpisodes.length} ភាគ)`
     - `២ ភាគដំបូង (2 EPs)`
     - `៤ ភាគដំបូង (4 EPs)`
     - `ដកជ្រើសរើស (Clear)` (only visible when `selectedEpIds.size > 0`)
2. **Smart Auto-Selection When Clicking Any Run Button (No More Warning Popup):**
   - In `handleRunAllThreeSteps`, `handleStartBatchTranslate`, `handleStartBatchTts`, and `handleStartBatchDemucs`:
   - If `selectedEpIds.size === 0`, **DO NOT** open the `"សូមជ្រើសរើសភាគជាមុនសិន"` warning dialog!
   - Instead, automatically select the relevant unfinished episodes for that action (e.g., `incompleteEpisodes` for `Run All 3 Steps`, `untranslatedOrBrokenEpisodes` for `Translate`, `missingVoiceEpisodes` for `AI Voice`, `missingBgmEpisodes` for `AI បិទសំឡេងចិន`), update `setSelectedEpIds(new Set(autoTargets.map(e => e.id)))`, and immediately start execution!

### Step 2: Unified 1-Click 3-Step Pipeline Engine (`Translate ➔ AI Voice ➔ AI បិទសំឡេងចិន`)
1. **Per-Episode & Batch 3-Step Orchestrator (`runEpisodeFullPipeline(ep, options)`):**
   - When the user clicks **`🚀 ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន (Auto-Run 3 Steps)`** on the top bar (or **`▶ ផលិតទាំង 3 ជំហាន`** on an individual Episode Card `EP1`, `EP2`, `EP3`), execute all 3 stages automatically for each target episode:
     - **Stage 1 (`📝 Translate & Auto-Repair Script`):**
       - If the episode has no script or failed previously (`EP2`, `EP3`), run `Translate Script` and wait for completion.
       - If the episode has broken/missing segments (like `EP1: ខូច 268 ឃ្លា`), automatically invoke the repair/re-translate handler for those broken segments first.
     - **Stage 2 (`🎙️ AI Translate Voice - ពិសិដ្ឋ & ស្រីមុំ`):**
       - Immediately after Stage 1 succeeds (or if the script is already ready), automatically generate Khmer TTS audio (`/api/generate-audio`) for all segments missing voice audio (`missingVoiceCount > 0`).
     - **Stage 3 (`🔇 AI បិទសំឡេងចិន - Demucs Clean BGM`):**
       - Automatically run vocal separation (`/api/audio/separate`) if `cleanBgm` is not yet generated, so the episode finishes at **100% Ready for Export**.

### Step 3: Declutter the Top Header & Toolbar (Compact, Clean, Zero Overflow)
Replace the 5 bloated top rows in `GeminiRouteModal.jsx` with a compact header that takes `< 140px` height and leaves 75%+ of the screen for the Episode Cards grid:

1. **Collapsible Script Setup Bar (`isScriptSetupExpanded = false` by default):**
   - Keep `Batch Script Setup` collapsed into a sleek 1-line summary bar (`⚙️ ទម្រង់: ⚡ Fast OCR • Mode A: សន្ទនាតួអង្គ • Auto Genre [កែសម្រួលទម្រង់ ▾]`) unless the user clicks to expand it.
2. **Compact 3-Stage Summary Pills (Replace the 3 Giant Full-Width Progress Bars):**
   - Render the 3 overall progress counters as 3 sleek horizontal summary cards in a single `grid-cols-3 gap-3` row:
     - `[📝 1. Script ខ្មែរ: 9/21 ភាគ (43%)]`
     - `[🎙️ 2. សំឡេងខ្មែរ AI: 0/21 ភាគ (0%)]`
     - `[🔇 3. បិទសំឡេងចិន BGM: 0/21 ភាគ (0%)]`
3. **Single Clean Action Toolbar (`flex-wrap`, No Cut-Off Buttons):**
   - **Left — Primary Master CTA Button:**
     - `🚀 ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន (${targetCount} ភាគ)` (Prominent gradient indigo-blue button).
   - **Center — Individual Step Triggers (Compact Secondary Buttons for running just 1 step when needed):**
     - `📝 1. Translate (${untranslatedCount})`
     - `🎙️ 2. សំឡេង AI (${missingVoiceCount})`
     - `🔇 3. បិទសំឡេងចិន (${missingBgmCount})`
     - `🔧 ជួសជុលឃ្លាខូច (${totalBrokenSegments})`
   - **Right — Utility & Export:**
     - `🛑 Stop All` (only shown when jobs are active)
     - Aspect Ratio (`16:9` | `9:16`) + `🎬 Export Studio`

### Step 4: Clean, Unified 3-Step Pipeline Card for Each Episode (`EP1`, `EP2`, `EP3`...)
Instead of rendering bloated, mismatched inner boxes inside `EP1`, `EP2`, and `EP3`, give every Episode Card a uniform, modern **3-Step Pipeline Tracker**:

1. **Card Header:**
   - Checkbox + `EP1` badge + Episode Title + Duration (`10:00.03`) + Assigned Key badge (`Key #1`).
2. **Compact 3-Step Pipeline Rows Inside Every Card:**
   - **Row 1 (`📝 1. Script ខ្មែរ`):** Shows status (`✅ 268 ឃ្លា` or `⚠️ ខូច 268 ឃ្លា` or `❌ បរាជ័យ Stage 2` or live progress `%`) + compact action button (`[🔧 ជួសជុល]` / `[↺ បកប្រែ]`).
   - **Row 2 (`🎙️ 2. សំឡេងខ្មែរ AI`):** Shows status (`0/268 ឃ្លា` or `✅ 268/268 ឃ្លា` or live `%`) + compact action button (`[🎙️ បញ្ចូលសំឡេង]`).
   - **Row 3 (`🔇 3. បិទសំឡេងចិន BGM`):** Shows status (`មិនទាន់បំបែក` or `✅ Clean BGM រួចរាល់` or live `%`) + compact action button (`[🔇 បិទសំឡេងចិន]`).
3. **Collapsible Console Log Drawer:**
   - Keep `>_ CONSOLE LOGS` collapsed into a clean 1-line status bar by default (expanding only when clicked or while actively streaming).
4. **Card Footer (2 Clean Buttons):**
   - Primary Card CTA: **`▶ ផលិតទាំង 3 ជំហាន (Run All 3 Steps)`** (automatically repairs/translates script ➔ generates AI voice ➔ separates Chinese vocal for that episode).
   - Secondary Card CTA: **`បើកក្នុង Studio ➔`**.

## 3. ប្រអប់បញ្ជាខ្លីជាភាសាខ្មែរ (Khmer Quick Command for `/agents`)

ចម្លង (Copy) ឃ្លាខាងក្រោមនេះដាក់ចូល `/agents` ក្នុង IDE ដើម្បីឱ្យវាសម្អាត UI និងដាក់មុខងារ Run ទាំង 3 Steps ស្វ័យប្រវត្តិ៖

> សូមអនុវត្តការកែលម្អ Clean Unified 3-Step Batch Pipeline ទាំង 4 Steps ក្នុង `clean_unified_3step_batch_pipeline_prompt.md` តាម Spec-Kit SDD workflow៖
> 1. **Step 1 (បំបាត់ផ្ទាំង `"សូមជ្រើសរើសភាគជាមុនសិន"` & កែចំនួនភាគ):** កែ `GeminiRouteModal.jsx` ឱ្យរាប់ចំនួនភាគក្នុង `ទាំងអស់ (21 ភាគ)` និង `ភាគមិនទាន់ចប់` បានត្រឹមត្រូវ ហើយបើអ្នកប្រើចុចប៊ូតុង Run ដោយមិនទាន់បាន Tick ជ្រើសរើសភាគ (`selectedEpIds.size === 0`) ត្រូវឱ្យវា Auto-Select ភាគដែលនៅសល់/ខូច រួចដំណើរការភ្លាម ដោយមិនត្រូវលោតផ្ទាំង `"សូមជ្រើសរើសភាគជាមុនសិន"` ទៀតទេ។
> 2. **Step 2 (មុខងារចុច ១ ដង រត់ទាំង 3 Steps ស្វ័យប្រវត្តិ):** បង្កើតមុខងារ `runEpisodeFullPipeline` សម្រាប់ប៊ូតុង **`🚀 ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន`** (ទាំងលើរបារខាងលើ និងក្នុងកាត `EP1`, `EP2`, `EP3` នីមួយៗ) ឱ្យវារត់បន្តគ្នាដោយស្វ័យប្រវត្តិ៖ **ទី1 បកប្រែ/ជួសជុល Script ខ្មែរ ➔ ទី2 បញ្ចូលសំឡេងខ្មែរ AI (ពិសិដ្ឋ/ស្រីមុំ) ➔ ទី3 បិទសំឡេងចិន (Demucs Clean BGM)** រហូតដល់ចប់ 100%។
> 3. **Step 3 (សម្អាត Header ខាងលើកុំឱ្យរញ៉េរញ៉ៃ ឬដាច់ប៊ូតុងខាងស្តាំ):** បង្រួម `Batch Script Setup` ទុកជា 1 បន្ទាត់ (`isScriptSetupExpanded = false` ជា Default) ដាក់របារ Progress ទាំង 3 ជា 3 ប្រអប់តូចៗជួរដេក (`grid-cols-3`) និងរៀបប៊ូតុងបញ្ជាឱ្យស្អាតក្នុងជួរតែមួយ (`flex-wrap`) កុំឱ្យដាច់ប៊ូតុងនៅគែមខាងស្តាំ។
> 4. **Step 4 (រៀបកាត `EP1`, `EP2`, `EP3` ឱ្យស្អាតដូចគ្នា):** ក្នុងកាតភាគនីមួយៗ បង្ហាញ 3 ជួរតូចៗច្បាស់ៗ (`1. 📝 Script ខ្មែរ`, `2. 🎙️ សំឡេងខ្មែរ AI`, `3. 🔇 បិទសំឡេងចិន BGM`) ជាមួយប៊ូតុង **`▶ ផលិតទាំង 3 ជំហាន`** នៅបាតកាត និងរត់តេស្តឱ្យចប់ 100%។
