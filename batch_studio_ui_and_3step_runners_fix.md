# Khmer AI Dubbing Studio — Batch Generate Studio UI & 3-Step AI Runners Fix

Use the master prompt below in your AI IDE (`/agents`, Cursor, Windsurf, or Claude Code) on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) to fix `GeminiRouteModal.jsx` (`localhost:5173/batch`) and `frontend/src/components/dashboard/route-runners/` so that **1. Translate Script**, **2. AI Translate Voice**, and **3. AI បិទសំឡេងចិន (Demucs Clean BGM)** are all clearly visible and actionable on both the **Top Batch Action Bar** and inside **every Episode Card (`EP1`, `EP2`, `EP3`...)**, and to fix the `Duplicate Active Job` error banner.

## 1. Root Cause Analysis from Your Repository Code

| Issue in Screenshot (`localhost:5173/batch`) | Root Cause in [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) (`GeminiRouteModal.jsx`) | Exact Fix |
| :--- | :--- | :--- |
| **Missing `Translate Script`, `AI Translate Voice`, and `AI បិទសំឡេងចិន` on Episode Cards (`EP1`, `EP2`, `EP3`)** | `GeminiRouteModal.jsx` conditionally renders only **one** runner card at a time (`EpisodeTranslateProgressCard.jsx` OR `EpisodeTtsProgressCard.jsx` OR `EpisodeDemucsProgressCard.jsx`) based on a tiny grey tab switcher (`[Translate \| សំឡេងខ្មែរ AI \| Demucs AI]`), hiding the other 2 stages completely | Render all **3 Stage Modules** inside every Episode Card (with an `"All 3 Steps"` default view + individual stage filter) so every episode always displays status + action buttons for **1. Translate Script**, **2. AI Translate Voice**, and **3. AI បិទសំឡេងចិន** |
| **Hidden / Confusing Top Batch Action Buttons** | The top toolbar hides `សំឡេងខ្មែរ AI` and `Demucs AI` inside a tiny unstyled grey pill group (`[Translate \| សំឡេងខ្មែរ AI \| Demucs AI]`) and only shows 1 blue CTA button (`🚀 Translate (19 ភាគនៅសល់)`) | Replace the tiny grey switcher with **3 Prominent Colored Batch Action Buttons** side-by-side (`1. 📝 Translate Script`, `2. 🎙️ AI Translate Voice`, `3. 🔇 AI បិទសំឡេងចិន`) + a Master **`⚡ Run All 3 Steps (Auto-Pipeline)`** button |
| **Scary Red Error: `Duplicate Active Job: An active job (#job_...) is already running`** | `executeBatchTranslateEnqueue` calls `startGenerationJob` on all selected episodes using `Promise.allSettled()` without skipping episodes that are already `running` or `queued` in `jobsByEpisodeId` | Filter out episodes that already have an active/queued job in `jobsByEpisodeId[ep.id]` before calling `startGenerationJob` (when `force: false`), and auto-cancel/replace active jobs when `force: true` (`Re-Translate (FORCE)`) |
| **`EP1` Broken Segments (`⚠️ នៅខ្វះ/ខូច 268 ឃ្លា — សំឡេងខ្វះ 268`) Has No Direct Fix Button on the Card** | `EP1` shows `"ចុច 🔧 ជួសជុលឃ្លាខូច"` in text, but the actual repair/TTS buttons are only in the top bar or hidden under other tabs | Add direct 1-click inline action buttons right inside the Episode Card footer/body: `[🔧 ជួសជុល & បកប្រែ]`, `[🎙️ បង្កើតសំឡេង AI]`, and `[🔇 បិទសំឡេងចិន]` |

## 2. Copy-Paste Master Prompt for Your AI IDE (English + Khmer SDD Spec)

### Role & Objective
You are a Senior React/Vite Studio UI Engineer working on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio). Follow the Spec-Kit SDD workflow to refactor `frontend/src/components/dashboard/GeminiRouteModal.jsx` (and its CSS) along with `frontend/src/components/dashboard/route-runners/EpisodeTranslateProgressCard.jsx`, `EpisodeTtsProgressCard.jsx`, and `EpisodeDemucsProgressCard.jsx`.

### Step 1: Upgrade Top Batch Action Bar with All 3 Primary AI Stage Buttons (`GeminiRouteModal.jsx`)
Replace the confusing single CTA + tiny grey `[Translate | សំឡេងខ្មែរ AI | Demucs AI]` switcher with a clear **2-Row Studio Batch Control Bar**:

1. **Primary Batch Execution Row (Big, Clear, Color-Coded Buttons Always Visible):**
   - **Button 1 — Translate Script (`Blue #3b82f6`):**
     `📝 1. Translate Script (${remainingTranslateCount} ភាគ)` — triggers batch script translation for selected episodes.
   - **Button 2 — AI Translate Voice (`Pink/Purple #ec4899`):**
     `🎙️ 2. AI Translate Voice (${remainingTtsCount} ភាគ)` — triggers batch Khmer Edge Neural TTS (`ពិសិដ្ឋ` & `ស្រីមុំ`) generation for selected episodes that have scripts.
   - **Button 3 — AI បិទសំឡេងចិន (`Emerald/Teal #10b981`):**
     `🔇 3. AI បិទសំឡេងចិន / Clean BGM (${remainingDemucsCount} ភាគ)` — triggers batch Demucs v4 vocal separation (removing Chinese vocals while keeping BGM) for selected episodes.
   - **Button 4 — Run All 3 Steps (`Gradient Indigo/Cyan`):**
     `⚡ Run All 3 Steps (Auto-Pipeline)` — sequentially or concurrently runs `Translate Script -> AI Translate Voice -> AI បិទសំឡេងចិន` for selected episodes.
2. **Secondary Utility & View Filter Row:**
   - **View Filter Segmented Control (`បង្ហាញលើកាតភាគនីមួយៗ`):**
     - `🎛️ បង្ហាញទាំង 3 មុខងារ (All 3 Steps)` (**DEFAULT ACTIVE!**)
     - `📝 1. Translate Script`
     - `🎙️ 2. AI Translate Voice`
     - `🔇 3. AI បិទសំឡេងចិន`
   - **Repair & Force Controls:**
     - `↺ Re-Translate (FORCE)`
     - `🔧 ជួសជុលប្រយោគខូច & Generate សំឡេងឡើងវិញ (${brokenCount})`
     - `🛑 Kill Active Jobs` (visible when any Translate, TTS, or Demucs job is running/queued)
   - **Right Export Controls:**
     - Aspect Ratio (`16:9` | `9:16`) + `🎬 Open Export Studio`

### Step 2: Show All 3 AI Sections Inside Every Episode Card (`GeminiRouteModal.jsx` & `route-runners/`)
When the view filter is set to the default **`🎛️ បង្ហាញទាំង 3 មុខងារ (All 3 Steps)`**, render all 3 stage blocks inside each Episode Card (`EP1`, `EP2`, `EP3`...) so the user never wonders where `Translate Script`, `AI Translate Voice`, or `AI បិទសំឡេងចិន` went:

1. **Stage 1 Block — `📝 1. Translate Script (បកប្រែសេណារីយ៉ូ)` (`EpisodeTranslateProgressCard.jsx`):**
   - Shows segment count (`ឧ. 268 ឃ្លា`), active Gemini Key badge (`Key #1..#6`), progress bar (`0%–100%`), and collapsible console logs when running.
   - Inline Action Button on the card:
     - If not translated: `[📝 បកប្រែ Script]`
     - If broken/missing lines: `[🔧 ជួសជុលឃ្លាខូច]` + `[↺ បកប្រែឡើងវិញ]`
     - If running/queued: `[🛑 Kill]`
     - If completed: `✅ បកប្រែរួចរាល់ (${segmentCount} ឃ្លា)` + `[↺ Re-run]`
2. **Stage 2 Block — `🎙️ 2. AI Translate Voice (បញ្ចូលសំឡេងខ្មែរ AI)` (`EpisodeTtsProgressCard.jsx`):**
   - Shows voiced segment count (`ឧ. សំឡេង: 0/268 ឃ្លា` or `268/268 ឃ្លា`), male/female voice distribution (`👨 ពិសិដ្ឋ` / `👩 ស្រីមុំ`), and live TTS progress bar.
   - Inline Action Button on the card:
     - If missing audio (`missingAudioCount > 0`): `[🎙️ បង្កើតសំឡេងខ្មែរ AI (${missingAudioCount} ឃ្លា)]`
     - If running: live progress `%` + `[🛑 Kill]`
     - If all voiced: `✅ សំឡេងខ្មែរ AI រួចរាល់` + `[🔊 បង្កើតឡើងវិញ]`
3. **Stage 3 Block — `🔇 3. AI បិទសំឡេងចិន (Demucs Clean BGM)` (`EpisodeDemucsProgressCard.jsx`):**
   - Rename/clarify the label in Khmer so it explicitly says **`🔇 3. AI បិទសំឡេងចិន (រក្សាភ្លេង BGM ដើម)`**.
   - Shows vocal separation status (`មិនទាន់បំបែក` / `កំពុងបិទសំឡេងចិន... %` / `✅ បានបិទសំឡេងចិន & រក្សាភ្លេង BGM`).
   - Inline Action Button on the card:
     - If not separated: `[🔇 បិទសំឡេងចិន (AI Clean BGM)]`
     - If running: live Demucs progress `%` + `[🛑 Kill]`
     - If separated: `✅ បិទសំឡេងចិនរួចរាល់` + `[↺ ធ្វើម្ដងទៀត]`

### Step 3: Fix `Duplicate Active Job` Error in `executeBatchTranslateEnqueue` (`GeminiRouteModal.jsx`)
1. Before calling `startGenerationJob` across selected episodes in `executeBatchTranslateEnqueue` (and the batch TTS / Demucs handlers):
   - Check `jobsByEpisodeId[ep.id]` (and active queue status) first.
   - When `force === false`: automatically skip any episode that already has an active `running` or `queued` job instead of sending a duplicate POST request that fails with `Duplicate Active Job: An active job (#job_...) is already running`.
   - When `force === true` (`Re-Translate (FORCE)`): kill/cancel the existing active job for that episode first before enqueuing the fresh job.
2. Replace the alarming red `Duplicate Active Job` error banner with a clean informational count in the green/blue status toast (e.g., `"បានដាក់បញ្ចូល Queue ចំនួន X ភាគ • រំលង Y ភាគដែលកំពុងដំណើរការស្រាប់"`).

## 3. ប្រអប់បញ្ជាខ្លីជាភាសាខ្មែរ (Khmer Quick Command for `/agents`)

អ្នកអាចចម្លង (Copy) ឃ្លាខាងក្រោមនេះដាក់ចូល `/agents` ក្នុង IDE ដើម្បីឱ្យវាអនុវត្តតាមឯកសារ `batch_studio_ui_and_3step_runners_fix.md`៖

> សូមអនុវត្តការកែលម្អ Batch Generate Studio UI ទាំង 3 Steps ក្នុង `batch_studio_ui_and_3step_runners_fix.md` តាម Spec-Kit SDD workflow៖
> 1. **Step 1 (`GeminiRouteModal.jsx` Top Action Bar):** កែរបារប៊ូតុងខាងលើដោយដាក់ប៊ូតុងធំៗច្បាស់ៗទាំង 3 មុខងារនៅជិតគ្នា៖ **`📝 1. Translate Script`**, **`🎙️ 2. AI Translate Voice`**, និង **`🔇 3. AI បិទសំឡេងចិន (Clean BGM)`** រួមជាមួយប៊ូតុង **`⚡ Run All 3 Steps`** និងកំណត់ Default View ជា **`🎛️ បង្ហាញទាំង 3 មុខងារ (All 3 Steps)`** (ជំនួសប៊ូតុងពណ៌ប្រផេះតូចៗដែលលាក់មុខងារទាំងនេះ)។
> 2. **Step 2 (`GeminiRouteModal.jsx` & `route-runners/`):** នៅក្នុងកាតភាគនីមួយៗ (`EP1`, `EP2`, `EP3`...) ត្រូវបង្ហាញប្រអប់មុខងារទាំង 3 ក្នុងពេលតែមួយ (**`1. Translate Script`**, **`2. AI Translate Voice`**, និង **`3. AI បិទសំឡេងចិន / Clean BGM`**) ជាមួយប៊ូតុងចុចដំណើរការផ្ទាល់លើកាតនីមួយៗ (`[📝 បកប្រែ Script]`, `[🔧 ជួសជុលឃ្លាខូច]`, `[🎙️ បង្កើតសំឡេងខ្មែរ AI]`, `[🔇 បិទសំឡេងចិន]`)។
> 3. **Step 3 (Fix `Duplicate Active Job` Error):** ក្នុង `executeBatchTranslateEnqueue` ត្រូវត្រួតពិនិត្យ `jobsByEpisodeId` ដើម្បីរំលង (Skip) ភាគណាដែលកំពុងរត់ ឬនៅក្នុង Queue ស្រាប់ដោយស្វ័យប្រវត្តិ (ពេល `force: false`) កុំឱ្យលោតផ្ទាំងក្រហម `Duplicate Active Job` ទៀត ព្រមទាំងរត់តេស្តឱ្យចប់ 100%។
