# Khmer AI Dubbing Studio — Full-Project Master Upgrade Prompt (All Modules)

Use this master specification in your AI IDE (`/agents`, Cursor, Windsurf, or Claude Code) on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) to fix and polish the **entire project end-to-end** (`Batch Studio` + `Left Media/Episodes/Script Panels` + `Right Voice/Export Inspector` + `UTF-8 Mojibake Cleanup` + `Backend Services & Quota Cascade`).

## 1. Whole-Project Code Audit Summary

| Module & File Path | Exact Bug / Issue Found in Repository | Target Fix |
| :--- | :--- | :--- |
| **1. Batch Generate Studio (`GeminiRouteModal.jsx` & `route-runners/`)** | Hides `EpisodeTranslateProgressCard`, `EpisodeTtsProgressCard`, and `EpisodeDemucsProgressCard` behind a tiny grey tab switcher so only 1 step shows at a time; throws red `Duplicate Active Job` error when clicking Translate | Show **all 3 primary Batch Action Buttons** on the top bar AND render **all 3 Stage Modules (`1. Translate Script`, `2. AI Translate Voice`, `3. AI បិទសំឡេងចិន`)** inside every Episode Card (`EP1`, `EP2`, `EP3`...) by default; skip already-active jobs in `executeBatchTranslateEnqueue` |
| **2. UTF-8 Corrupted Characters (`\uFFFD` / ``) Across 6 Files** | Broken UTF-8 characters (`\uFFFD`) appear in [EpisodesTab.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/media/EpisodesTab.jsx), [VoiceSettings.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/VoiceSettings.jsx), [AudioDuckingPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/AudioDuckingPanel.jsx), [ExportSettingsPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/ExportSettingsPanel.jsx), [BatchExportStudioModal.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/dashboard/BatchExportStudioModal.jsx), and [batchExportService.js](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/backend/services/batchExportService.js) | Scan the entire repository for `\uFFFD`, restore clean UTF-8 Khmer text and emoji icons, and add a unit test asserting zero `\uFFFD` characters across `frontend/src/` and `backend/` |
| **3. Episode Splitting & Script Review (`EpisodesTab.jsx` & `ScriptReviewTab.jsx`)** | [EpisodesTab.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/media/EpisodesTab.jsx) calls `window.location.reload()` (line 86) and `alert()` on episode split; [ScriptReviewTab.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/media/ScriptReviewTab.jsx) (line 238) hardcodes binary `'Sreymom' : 'Piseth'` label fallback | Replace `window.location.reload()` and `alert()` with reactive state refresh and inline status banners; resolve voice labels dynamically from the voice catalog and add 1-click gender/voice toggle + broken-segment filter in `ScriptReviewTab.jsx` |
| **4. Right Voice & Export Inspector (`VoiceSettings.jsx`, `ClipInspectorPanel.jsx`, `AudioDuckingPanel.jsx`, `ExportSettingsPanel.jsx`)** | Corrupted stage strings in [ExportSettingsPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/ExportSettingsPanel.jsx) and [AudioDuckingPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/AudioDuckingPanel.jsx); Export CTA scrolls out of view on smaller screens | Clean all Khmer labels, add live percentage/dB readouts on ducking sliders, show optimistic `~300ms` regen spinner in `ClipInspectorPanel.jsx`, and pin `Export Rendered Video` as a sticky bottom bar |
| **5. Backend Portability & Quota Cascade (`audioSeparationService.js`, `batchExportService.js`, `GeminiQuotaModal.jsx`)** | [audioSeparationService.js](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/backend/services/audioSeparationService.js) (lines 87–88) hardcodes `C:\Users\nhastar\...`; [GeminiQuotaModal.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/dashboard/GeminiQuotaModal.jsx) lists invalid fallback model IDs | Replace hardcoded `nhastar` Python path with cross-platform `PYTHON_BIN` / `.venv` / `where`/`which` discovery; synchronize `GeminiQuotaModal.jsx` model options with `geminiKeyManager.js` |

## 2. Copy-Paste Master Prompt for `/agents` (Full Project — 5 Phases)

### Role & Objective
You are the Principal Full-Stack Architect for [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio). Execute a complete, 5-Phase Whole-Project Upgrade following the Spec-Kit SDD workflow (`.specify/` Spec, Plan, Tasks + automated tests + `oxlint` + `vite build`).

### Phase 1: Global UTF-8 Mojibake (`\uFFFD`) Cleanup Across Frontend & Backend
1. Scan all files in `frontend/src/` and `backend/` for the replacement character `\uFFFD` (``) and restore clean UTF-8 Khmer text and emojis, specifically in:
   - [frontend/src/components/media/EpisodesTab.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/media/EpisodesTab.jsx) (lines 60, 66, 67, 84, 89, 90)
   - [frontend/src/components/voice/VoiceSettings.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/VoiceSettings.jsx) (lines 14, 15, 22, 23, 27, 28)
   - [frontend/src/components/voice/AudioDuckingPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/AudioDuckingPanel.jsx) (line 65)
   - [frontend/src/components/voice/ExportSettingsPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/ExportSettingsPanel.jsx) (lines 42, 48, 51)
   - [frontend/src/components/dashboard/BatchExportStudioModal.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/dashboard/BatchExportStudioModal.jsx) (lines 66, 68, 71, 73, 75, 82)
   - [backend/services/batchExportService.js](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/backend/services/batchExportService.js) (line 60)
2. Add a regression test verifying that zero source files in `frontend/src/` and `backend/` contain `\uFFFD`.

### Phase 2: Batch Generate Studio (`GeminiRouteModal.jsx` & `route-runners/`) 3-Step UI & Queue Fix
1. **Top Batch Action Bar (`GeminiRouteModal.jsx`):**
   - Replace the single primary button + tiny grey `[Translate | សំឡេងខ្មែរ AI | Demucs AI]` switcher with **4 prominent, color-coded Batch Action Buttons** always visible side-by-side:
     - `📝 1. Translate Script (${remainingTranslateCount} ភាគ)` (Studio Blue)
     - `🎙️ 2. AI Translate Voice (${remainingTtsCount} ភាគ)` (Studio Pink/Purple)
     - `🔇 3. AI បិទសំឡេងចិន / Clean BGM (${remainingDemucsCount} ភាគ)` (Studio Emerald)
     - `⚡ Run All 3 Steps (Auto-Pipeline)` (Gradient Indigo-Cyan)
   - Add a clear View Filter segmented control (`🎛️ បង្ហាញទាំង 3 មុខងារ (All 3 Steps)` as the **default active mode**, plus individual filters `1. Translate`, `2. Voice AI`, `3. បិទសំឡេងចិន`).
2. **Episode Cards (`EP1`, `EP2`, `EP3`... in `GeminiRouteModal.jsx` & `route-runners/`):**
   - When `All 3 Steps` is active (default), render all 3 runner modules (`EpisodeTranslateProgressCard.jsx`, `EpisodeTtsProgressCard.jsx`, and `EpisodeDemucsProgressCard.jsx`) inside every Episode Card simultaneously, each with its own status badge, progress bar, and direct 1-click action button (`[📝 បកប្រែ / ជួសជុល]`, `[🎙️ បង្កើតសំឡេងខ្មែរ AI]`, `[🔇 បិទសំឡេងចិន]`).
3. **Eliminate `Duplicate Active Job` Error (`executeBatchTranslateEnqueue`):**
   - Filter out any episode that already has an active `running` or `queued` job in `jobsByEpisodeId[ep.id]` when `force === false` (and auto-cancel/replace when `force === true`), showing an informational summary toast instead of a red error banner.

### Phase 3: Left Panel (`EpisodesTab.jsx` & `ScriptReviewTab.jsx`) Workflow Polish
1. **SPA Episode Split Without Page Reload ([EpisodesTab.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/media/EpisodesTab.jsx)):**
   - Remove `window.location.reload()` (line 86) and browser `alert()` calls. Instead, invoke the parent/context series refresh callback and display a sleek inline studio status banner.
2. **Script Review & Quality Guard ([ScriptReviewTab.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/media/ScriptReviewTab.jsx)):**
   - Replace the hardcoded binary voice label check `(seg.voiceId || seg.khmerVoiceId || '').includes('Sreymom') ? 'Sreymom' : 'Piseth'` with dynamic lookup from the voice catalog + clear gender badge (`👨 ពិសិដ្ឋ` / `👩 ស្រីមុំ`).
   - Add quick filter pills at the top of `ScriptReviewTab.jsx`: `ទាំងអស់ (${total})`, `👨 ប្រុស (${maleCount})`, `👩 ស្រី (${femaleCount})`, and `⚠️ ឃ្លាខូច/ខ្វះសំឡេង (${brokenCount})`.

### Phase 4: Right Panel (`VoiceSettings.jsx`, `ClipInspectorPanel.jsx`, `AudioDuckingPanel.jsx`, `ExportSettingsPanel.jsx`)
1. **[ClipInspectorPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/ClipInspectorPanel.jsx):** Show an optimistic inline loading spinner during 1-click voice switching (`👩 ស្រីមុំ` / `👨 ពិសិដ្ឋ`) and a direct `🔊 ស្តាប់សាកល្បង` button.
2. **[AudioDuckingPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/AudioDuckingPanel.jsx) & [ExportSettingsPanel.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/voice/ExportSettingsPanel.jsx):** Fix all corrupted UTF-8 strings, display clear stage indicators (`1/4 បង្កើតអក្សរខ្មែរ .ASS`, `2/4 បន្ថយសំឡេងដើម Smart Ducking`, `3/4 បញ្ចូលសំឡេងខ្មែរ AI & Clean BGM`, `4/4 Render វីដេអូ MP4`), and keep the primary `Export Rendered Video` button sticky at the bottom of the right panel.

### Phase 5: Backend Portability & Quota Modal Sync (`audioSeparationService.js` & `GeminiQuotaModal.jsx`)
1. **[backend/services/audioSeparationService.js](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/backend/services/audioSeparationService.js):** Remove the hardcoded `'C:\\Users\\nhastar\\AppData\\Local\\Programs\\Python\\Python311\\python.exe'` path (lines 87–88) and resolve Python dynamically via `process.env.PYTHON_BIN`, local `.venv`, and system `python` / `python3` discovery (with automatic FFmpeg vocal filter fallback if Demucs is unavailable).
2. **[frontend/src/components/dashboard/GeminiQuotaModal.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/dashboard/GeminiQuotaModal.jsx) & [BatchExportStudioModal.jsx](https://github.com/Ny-Panha/khmer-ai-dubbing-studio/blob/main/frontend/src/components/dashboard/BatchExportStudioModal.jsx):** Synchronize fallback model IDs with `backend/services/geminiKeyManager.js` and fix all unready episode badges (`⚠️ គ្មានវីដេអូ`, `⚠️ គ្មាន Script`, `⚠️ សំឡេងមិនទាន់អាប់ដេត`, `⚠️ គ្មានសំឡេង AI`).

## 3. ប្រអប់បញ្ជាខ្លីជាភាសាខ្មែរ (Khmer Master Command for `/agents`)

អ្នកអាចចម្លង (Copy) បញ្ជាខាងក្រោមនេះដាក់ចូល `/agents` ក្នុង IDE ដើម្បីឱ្យវាធ្វើការកែលម្អគម្រោងទាំងមូល (All 5 Phases)៖

> សូមអនុវត្តការកែលម្អគម្រោងទាំងមូល (All 5 Phases) ក្នុង `full_project_master_upgrade_prompt.md` តាម Spec-Kit SDD workflow រួមទាំងរត់ Unit Tests, `oxlint`, និង `vite build` ឱ្យចប់ 100%៖
> 1. **Phase 1 (UTF-8 Cleanup):** លុបនិងកែអក្សរខូច `\uFFFD` (``) ទាំងអស់ក្នុង `EpisodesTab.jsx`, `VoiceSettings.jsx`, `AudioDuckingPanel.jsx`, `ExportSettingsPanel.jsx`, `BatchExportStudioModal.jsx`, និង `batchExportService.js` ព្រមទាំងបង្កើត Unit Test ការពារកុំឱ្យមានអក្សរខូច `\uFFFD`។
> 2. **Phase 2 (`GeminiRouteModal.jsx` & `route-runners/`):** បង្ហាញប៊ូតុងធំៗទាំង 3 នៅរបារខាងលើ (`1. Translate Script`, `2. AI Translate Voice`, `3. AI បិទសំឡេងចិន / Clean BGM` + `⚡ Run All 3 Steps`) និងបង្ហាញប្រអប់មុខងារទាំង 3 ក្នុងកាតភាគនីមួយៗ (`EP1`, `EP2`, `EP3`...) ក្នុងពេលតែមួយជា Default (`All 3 Steps`) ព្រមទាំងកែ `executeBatchTranslateEnqueue` ឱ្យ Skip ភាគដែលកំពុងរត់ស្រាប់ កុំឱ្យលោត Error ក្រហម `Duplicate Active Job`។
> 3. **Phase 3 (`EpisodesTab.jsx` & `ScriptReviewTab.jsx`):** ដក `window.location.reload()` និង `alert()` ចេញពី `EpisodesTab.jsx` ជំនួសដោយការអាប់ដេត State ផ្ទាល់ និងបន្ថែមប៊ូតុង Filter (`ទាំងអស់`, `👨 ប្រុស`, `👩 ស្រី`, `⚠️ ឃ្លាខូច`) ក្នុង `ScriptReviewTab.jsx`។
> 4. **Phase 4 (`VoiceSettings.jsx`, `ClipInspectorPanel.jsx`, `AudioDuckingPanel.jsx`, `ExportSettingsPanel.jsx`):** កែអក្សរខ្មែរក្នុងដំណាក់កាល Export ទាំង 4 (`1/4` ដល់ `4/4`) និងដាក់ប៊ូតុង `Export Rendered Video` ឱ្យនៅជាប់ខាងក្រោម (Sticky Footer CTA)។
> 5. **Phase 5 (`audioSeparationService.js` & `GeminiQuotaModal.jsx`):** ដក Path កូដជាប់ឈ្មោះម៉ាស៊ីន `C:\Users\nhastar\...` ចេញពី `audioSeparationService.js` ជំនួសដោយការស្វែងរក `PYTHON_BIN` / `.venv` ស្វ័យប្រវត្តិ និងកែតម្រូវឈ្មោះ Model ក្នុង `GeminiQuotaModal.jsx` ឱ្យត្រូវជាមួយ `geminiKeyManager.js`។
