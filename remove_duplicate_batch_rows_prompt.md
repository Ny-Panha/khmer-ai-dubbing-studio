# Khmer AI Dubbing Studio — Remove Duplicate Toolbar Rows & Double Icons (`GeminiRouteModal.jsx` Lines 2916–3322)

Use the prompt below in `/agents` on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) to remove the duplicate button rows and double icons inside `frontend/src/components/dashboard/GeminiRouteModal.jsx` and `frontend/src/features/dubbing-runner/DubbingStepCardsBar.jsx`.

## 1. Why There Are 3 Duplicate Rows in Your Red Box (`GeminiRouteModal.jsx` Lines 2916–3322)

When `/agents` added `<DubbingStepCardsBar />` at **Line 2916** of [GeminiRouteModal.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/dashboard/GeminiRouteModal.jsx), it **did not remove** the old buttons on **Lines 2947–3165**, resulting in the same 3 items (`1. Script`, `2. Voice`, `3. Clean BGM`) repeating **3 times**:

| Row in Screenshot | Location in `GeminiRouteModal.jsx` | What Is Wrong | Action to Take |
| :--- | :--- | :--- | :--- |
| **Row 1: `<DubbingStepCardsBar />`** | **Lines 2916–2921** (`DubbingStepCardsBar.jsx`) | Has double icons (`✨ 📝`, `🎙️ 🎙️`, `🔊 🔇`) on each card | **KEEP THIS ROW** as the single source of truth for `1. Script ខ្មែរ`, `2. សំឡេង AI`, and `3. Clean BGM` (`▶ Run 1-by-1`), and remove the duplicate emojis |
| **Row 2: `batch-primary-execution-row`** | **Lines 2947–3080** | Repeats `📝 1. Translate Script (0)`, `🎙️ 2. AI Translate Voice (2)`, and `🔇 3. AI បិទសំឡេងចិន (19)` right below `<DubbingStepCardsBar />`, plus double icons (`⚡ 🚀`, `🔧 🛠️`) | **DELETE** the 3 duplicate buttons (`btn-batch-primary-translate`, `btn-batch-primary-tts`, `btn-batch-primary-demucs` on Lines 3000–3054) |
| **Row 3: `batch-card-view-filter` + Utilities** | **Lines 3083–3322** | Repeats `[⊞ ទាំង 3 \| 📝 Translate \| 🎙️ Voice \| 🔇 Clean BGM]` a **3rd time** (Lines 3085–3165) and puts `Re-Translate`, `16:9 \| 9:16`, and `🎞️ 🎬 Export Studio` on a separate 3rd row | **DELETE** the `batch-card-view-filter` tabs (Lines 3085–3165, always show all 3 steps on episode cards) and merge `ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន`, `ជួសជុល`, `Re-Translate`, `16:9 \| 9:16`, and `Export Studio` into **1 single compact bar** |

## 2. Copy-Paste Cleanup Prompt for `/agents`

### Role & Objective
You are refactoring `frontend/src/components/dashboard/GeminiRouteModal.jsx` (Lines 2916–3322) and `frontend/src/features/dubbing-runner/DubbingStepCardsBar.jsx` in [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) to eliminate redundant button rows and duplicate icons.

### Step 1: Keep `<DubbingStepCardsBar />` as the ONLY 3-Step Bar (`DubbingStepCardsBar.jsx` & `GeminiRouteModal.jsx` Lines 2916–2921)
1. In `frontend/src/features/dubbing-runner/DubbingStepCardsBar.jsx`:
   - Remove the duplicate emoji icons (`📝`, `🎙️`, `🔇`) next to the Lucide SVG icons (`<Sparkles />`, `<Mic />`, `<Volume2 />`) so each card header displays **only 1 clean SVG icon**:
     - Card 1: `<FileText size={15} /> 1. Script ខ្មែរ` (`19/21 ភាគ` • `90%` • `[▶ Run 1-by-1]`)
     - Card 2: `<Mic size={15} /> 2. សំឡេង AI` (`19/21 ភាគ` • `90%` • `[▶ Run 1-by-1]`)
     - Card 3: `<VolumeX size={15} /> 3. Clean BGM (បិទសំឡេងចិន)` (`2/21 ភាគ` • `10%` • `[▶ Run 1-by-1]`)

### Step 2: Delete Duplicate Step Buttons & Filter Tabs (`GeminiRouteModal.jsx` Lines 2947–3322)
1. **Delete Duplicate Step Buttons (Lines 3000–3054):**
   - Remove `btn-batch-primary-translate` (`1. Translate Script`), `btn-batch-primary-tts` (`2. AI Translate Voice`), and `btn-batch-primary-demucs` (`3. AI បិទសំឡេងចិន`) from `GeminiRouteModal.jsx` because `<DubbingStepCardsBar />` directly above already provides those exact 3 controls!
2. **Delete Redundant View Filter Switcher (Lines 3085–3165):**
   - Remove `data-testid="batch-card-view-filter"` (`[⊞ ទាំង 3 | 📝 Translate | 🎙️ Voice | 🔇 Clean BGM]`) and lock `cardViewFilter` to `'all'` so users don't see a 3rd row of `Translate / Voice / Clean BGM` buttons.
3. **Combine Remaining Actions into ONE Single Clean Utility Row (`justify-between items-center`):**
   - Directly below `<DubbingStepCardsBar />`, render **ONLY 1 single horizontal utility row**:
     - **Left group:**
       - `<Zap size={14} /> ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន (${incompleteCount} ភាគ)` (`data-testid="btn-batch-run-all"` — remove duplicate `🚀` emoji)
       - `<Wrench size={14} /> ជួសជុលឃ្លាខូច (${totalBrokenCount})` (`data-testid="btn-repair-broken-segments"` — remove duplicate `🛠️` emoji)
       - `<RotateCcw size={13} /> Re-Translate` (`data-testid="btn-batch-retranslate"`)
     - **Right group:**
       - Aspect Ratio pill (`16:9` | `9:16`) (`data-testid="step4-aspect-toggle"`)
       - `<Film size={14} /> Export Studio` (`data-testid="step4-open-export-studio-btn"` — remove duplicate `🎬` emoji)
4. **Update Existing Tests:**
   - Update any unit tests in `backend/tests/` or `frontend/` that asserted the presence of the deleted duplicate buttons (`btn-batch-primary-translate`, `btn-batch-primary-tts`, `btn-batch-primary-demucs`, `batch-card-view-filter`) so they test `<DubbingStepCardsBar />` instead, and verify all tests + `oxlint` + `vite build` pass 100%.

## 3. ប្រអប់បញ្ជាខ្លីជាភាសាខ្មែរ (Khmer Quick Command for `/agents`)

ចម្លង (Copy) ឃ្លាខាងក្រោមនេះដាក់ចូល `/agents` ក្នុង IDE ដើម្បីលុបប៊ូតុងស្ទួនទាំងអស់ចេញភ្លាម៖

> សូមសម្អាតប៊ូតុងស្ទួនក្នុង `GeminiRouteModal.jsx` (Lines 2916–3322) និង `DubbingStepCardsBar.jsx` តាម `remove_duplicate_batch_rows_prompt.md`៖
> 1. **រក្សាទុកតែជួរ `<DubbingStepCardsBar />` ១ ប៉ុណ្ណោះ** សម្រាប់មុខងារទាំង 3 (`1. Script ខ្មែរ`, `2. សំឡេង AI`, `3. Clean BGM` ដែលមានប៊ូតុង `▶ Run 1-by-1` ស្រាប់) ហើយលុប Emoji ស្ទួន (`📝`, `🎙️`, `🔇`, `🚀`, `🛠️`, `🎬`) ដែលជាន់គ្នាជាមួយ Lucide Icons ចេញ។
> 2. **លុបប៊ូតុងស្ទួននៅជួរទី 2 និងជួរទី 3 ចេញ (`Lines 3000–3165`):** លុបប៊ូតុង `1. Translate Script (0)`, `2. AI Translate Voice (2)`, `3. AI បិទសំឡេងចិន (19)` និងរបារ Filter `[ទាំង 3 | Translate | Voice | Clean BGM]` ចេញទាំងស្រុង ព្រោះវាស្ទួនគ្នា 3 ជាន់ជាមួយ `<DubbingStepCardsBar />`។
> 3. **បង្រួមប៊ូតុងជំនួយដែលនៅសល់ឱ្យនៅត្រឹម ១ ជួរគត់:** ផ្នែកខាងឆ្វេងដាក់ `[⚡ ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន]`, `[🔧 ជួសជុល (413)]`, `[↺ Re-Translate]` និងផ្នែកខាងស្តាំដាក់ `[16:9 | 9:16]` និង `[🎞️ Export Studio]` រួចអាប់ដេត Unit Tests, `oxlint`, និង `vite build` ឱ្យ Pass 100%។
