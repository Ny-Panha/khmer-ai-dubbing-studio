# Khmer AI Dubbing Studio — Reusable 1-by-1 Sequential Dubbing Feature (`1. Script`, `2. សំឡេង AI`, `3. Clean BGM`)

Use this Spec-Kit SDD prompt in `/agents` on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) to build a **Single Reusable Feature Module (`frontend/src/features/dubbing-runner/`)** that wraps your existing single-episode functions (`startGenerationJob`, `generateAudioApi`, `separateAudioApi`) into:
1. **Strict 1-by-1 Sequential Execution (`EP1 ចប់ 100% ➔ ចាំរត់ EP2 ➔ ... ➔ EP21`)** for **Box 1 (`1. Script ខ្មែរ`)**, **Box 2 (`2. សំឡេង AI`)**, and **Box 3 (`3. Clean BGM`)**.
2. **Reusable Hook + UI Components (`useDubbingFeature`, `<DubbingStepCardsBar />`, `<DubbingStepButton />`)** that can be imported and called on **any page** across the entire project (`/batch`, `EpisodesTab`, `DubbingModeTab`, `VoiceSettings`, and individual `EP1..EP21` cards).

## 1. Architecture Overview (1 Shared Feature Used Everywhere)

| Feature File to Create / Update | Purpose & Responsibility in [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) | Where It Is Called |
| :--- | :--- | :--- |
| **`frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx` & `useDubbingFeature.js`** | Central state & execution engine wrapping `startGenerationJob` + `getJobStatus` (`Step 1`), `generateAudioApi` (`Step 2`), and `separateAudioApi` + `getSeparationProgress` (`Step 3`) from `frontend/src/services/api.js`. Executes either **1 episode** OR a **strict `for..of await` 1-by-1 loop (`EP1 ➔ EP2 ➔ ... ➔ EP21`)** | Imported in `App.jsx`, `GeminiRouteModal.jsx`, `EpisodesTab.jsx`, `DubbingModeTab.jsx`, `VoiceSettings.jsx` |
| **`frontend/src/features/dubbing-runner/DubbingStepCardsBar.jsx`** | The 3 interactive progress/trigger cards (`1. Script ខ្មែរ`, `2. សំឡេង AI`, `3. Clean BGM`). Clicking Card `1`, `2`, or `3` runs that step **1-by-1 from `EP1` to `EP21`** (skipping already-completed episodes unless `force: true`) | Rendered at the top of `GeminiRouteModal.jsx` (`/batch`) and optionally in `EpisodesTab.jsx` |
| **`frontend/src/features/dubbing-runner/DubbingStepButton.jsx`** | Reusable button (`<DubbingStepButton step="translate \| voice \| clean_bgm" target={epOrEpisodes} />`) that calls the exact same `useDubbingFeature()` function with live progress `%` and `[Stop]` toggle | Used inside every Episode Card (`EP1..EP21`), `DubbingModeTab.jsx`, `EpisodesTab.jsx`, and `VoiceSettings.jsx` |

## 2. Copy-Paste Master Prompt for `/agents` (English + Khmer SDD Spec)

### Role & Objective
You are a Principal React/Vite Feature Architect working on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio). Follow the Spec-Kit SDD workflow to create a reusable, cross-page feature module under `frontend/src/features/dubbing-runner/` and integrate it into `GeminiRouteModal.jsx`, `EpisodesTab.jsx`, `DubbingModeTab.jsx`, and `VoiceSettings.jsx`.

### Step 1: Create the Shared 1-by-1 Sequential Engine (`frontend/src/features/dubbing-runner/useDubbingFeature.js`)
Wrap the existing single-episode API functions from `frontend/src/services/api.js` into a single reusable provider/hook (`DubbingRunnerProvider` & `useDubbingFeature`):

1. **Core Single-Episode Step Runners (Wait 100% Until Completion Before Returning):**
   - **`runSingleTranslate(episode, setupOptions)`:**
     - Calls `startGenerationJob({ videoId: episode.videoId || episode.video, seriesId, episodeId: episode.id, ...setupOptions })` from `frontend/src/services/api.js`.
     - Polls `getJobStatus(jobId)` (or listens to `JobQueueContext`) until `job.status === 'completed'` or `'failed'`. Resolves only when that single episode's script is 100% saved!
   - **`runSingleVoice(episode, voiceOptions)`:**
     - Loads the episode's `scriptSegments`, builds `speakerMap`, and calls `generateAudioApi({ segments, voiceId, seriesId, episodeId: episode.id, speakerMap, videoId })` (plus `syncTimelineAudioApi` if applicable).
     - Waits until all segments for that single episode have generated audio before resolving.
   - **`runSingleCleanBgm(episode)`:**
     - Calls `separateAudioApi({ videoId: episode.videoId || episode.video, seriesId, episodeId: episode.id, twoStems: 'vocals', model: 'htdemucs' })`.
     - Polls `getSeparationProgress(jobId)` until `100%` complete before resolving.

2. **Strict 1-by-1 Sequential Queue Runner (`runSequentialStep(stepType, episodesList, options)`):**
   - Supports `stepType`: `'translate'` (`1. Script ខ្មែរ`), `'voice'` (`2. សំឡេង AI`), or `'clean_bgm'` (`3. Clean BGM`).
   - **Auto-Target Logic (No `"សូមជ្រើសរើសភាគជាមុនសិន"` Blocking):**
     - If `episodesList` (or `selectedEpIds`) is empty, automatically target all episodes in the series that still need `stepType` (or all 21 episodes if `options.force === true`).
   - **Strict 1-by-1 `for...of` Loop (`EP1 ➔ EP2 ➔ ... ➔ EP21`):**
     ```js
     for (let idx = 0; idx < queueEpisodes.length; idx++) {
       if (abortControllerRef.current[stepType]?.signal.aborted) break;
       const ep = queueEpisodes[idx];
       setRunnerState(stepType, {
         status: 'running',
         currentEpId: ep.id,
         currentEpIndex: idx + 1,
         totalEps: queueEpisodes.length,
       });
       // Wait 100% for this 1 episode to finish before moving to the next episode!
       await executeSingleEpisodeStep(stepType, ep, options);
       await refreshSeriesEpisodes(); // Refresh UI immediately after each episode finishes
     }
     ```
   - Never fire `Promise.all` or `Promise.allSettled` across 21 episodes at once! Always wait for Episode `N` to complete before starting Episode `N + 1`.
   - Expose `stopStep(stepType)` to cleanly cancel the active episode job and halt the 1-by-1 loop at any time.

### Step 2: Create Reusable UI Components (`DubbingStepCardsBar.jsx` & `DubbingStepButton.jsx`)
Build 2 clean, reusable UI components inside `frontend/src/features/dubbing-runner/` that call `useDubbingFeature()`:

1. **`<DubbingStepCardsBar episodes={episodes} selectedEpIds={selectedEpIds} setupOptions={...} />`:**
   - Renders the 3 interactive cards (`1. Script ខ្មែរ`, `2. សំឡេង AI`, `3. Clean BGM`) in a clean 3-column grid:
     - **Card 1 (`📝 1. Script ខ្មែរ`):** Shows `X/21 ភាគ` completed, current active episode (`កំពុងរត់ EP10 (10/21) • 45%`), and a built-in **`[▶ Run 1-by-1]` / `[🛑 Stop]`** button. Clicking starts the 1-by-1 sequential script translation from `EP1` to `EP21`.
     - **Card 2 (`🎙️ 2. សំឡេង AI`):** Shows `X/21 ភាគ` voiced, current active episode (`កំពុងរត់ EP1 (1/21)`), and a built-in **`[▶ Run 1-by-1]` / `[🛑 Stop]`** button. Clicking starts the 1-by-1 sequential Khmer AI voice generation from `EP1` to `EP21`.
     - **Card 3 (`🔇 3. Clean BGM`):** Shows `X/21 ភាគ` separated, current active episode (`កំពុងរត់ EP1 (1/21)`), and a built-in **`[▶ Run 1-by-1]` / `[🛑 Stop]`** button. Clicking starts the 1-by-1 sequential Chinese vocal removal (Demucs Clean BGM) from `EP1` to `EP21`.
2. **`<DubbingStepButton step="translate | voice | clean_bgm" episodes={targetEpisodes} variant="card | pill | full" />`:**
   - A universal button component that can be dropped into ANY page or card:
     - Pass `episodes={[ep]}` (1 episode) on an Episode Card (`EP1`), in `EpisodesTab.jsx`, `DubbingModeTab.jsx`, or `VoiceSettings.jsx` to run just that 1 episode.
     - Pass `episodes={allEpisodes}` (21 episodes) on `/batch` (`GeminiRouteModal.jsx`) to run 1-by-1 across all episodes.
     - Automatically displays live state: Idle (`📝 បកប្រែ Script` / `🎙️ សំឡេង AI` / `🔇 Clean BGM`), Waiting in 1-by-1 Queue (`⏳ រង់ចាំលេខរៀង #3...`), Running (`🔄 កំពុងរត់ 65% [Stop]`), or Completed (`✅ រួចរាល់ [↺]`).

### Step 3: Replace Duplicated Code Across All Pages with the Reusable Feature
1. **In `GeminiRouteModal.jsx` (`/batch`):**
   - Replace the duplicated `handleStartBatchTranslate`, `handleBatchGenerateTTS`, `handleBatchSeparateVocal`, and the bloated 2 rows of rainbow buttons with `<DubbingStepCardsBar />` at the top and `<DubbingStepButton />` inside each Episode Card (`EP1..EP21`).
   - Remove the `"សូមជ្រើសរើសភាគជាមុនសិន"` blocking modal so clicking `1. Script ខ្មែរ`, `2. សំឡេង AI`, or `3. Clean BGM` immediately runs the 1-by-1 loop (`EP1 ➔ EP2 ➔ ... ➔ EP21`).
2. **In `EpisodesTab.jsx`, `DubbingModeTab.jsx`, and `VoiceSettings.jsx`:**
   - Import and use `useDubbingFeature()` / `<DubbingStepButton />` so single-episode and multi-episode actions share 100% of the same code, progress state, and error handling across the entire app.

## 3. ប្រអប់បញ្ជាខ្លីជាភាសាខ្មែរ (Khmer Quick Command for `/agents`)

ចម្លង (Copy) ឃ្លាខាងក្រោមនេះដាក់ចូល `/agents` ក្នុង IDE ដើម្បីឱ្យវាបង្កើត Reusable Feature និងមុខងាររត់ម្ដង 1 ភាគ (ពី 1 ដល់ 21)៖

> សូមអនុវត្តការបង្កើត Reusable 1-by-1 Sequential Dubbing Feature តាម `reusable_1by1_dubbing_feature_prompt.md` ក្នុង Spec-Kit SDD workflow៖
> 1. **Step 1 (`frontend/src/features/dubbing-runner/useDubbingFeature.js`):** ប្រមូល Function ដែលមានស្រាប់ក្នុង `api.js` (`startGenerationJob`, `generateAudioApi`, `separateAudioApi`) មកបង្កើតជា Hook/Context រួមតែមួយ ដែលគាំទ្រទាំងការរត់ **១ ភាគ (`runSingleEpisode`)** និងការរត់ជា **Loop ម្ដង ១ ភាគបន្តកន្ទុយគ្នា (`for...of await` ពី `EP1` ដល់ `EP21`)** សម្រាប់ទាំង 3 មុខងារ៖ **ទី1 `1. Script ខ្មែរ`**, **ទី2 `2. សំឡេង AI`**, និង **ទី3 `3. Clean BGM`** (ចប់ ១ ភាគ 100% ទើបចាប់ផ្តើមរត់ភាគបន្ទាប់ មិនបាញ់ទាំង 21 ភាគព្រមគ្នាទេ និងមិនលោតផ្ទាំង `"សូមជ្រើសរើសភាគជាមុនសិន"` ឡើយ)។
> 2. **Step 2 (`DubbingStepCardsBar.jsx` & `DubbingStepButton.jsx`):** បង្កើត Reusable UI Components សម្រាប់ប្រអប់ទាំង 3 (`1. Script ខ្មែរ`, `2. សំឡេង AI`, `3. Clean BGM`) និងប៊ូតុង `<DubbingStepButton />` ដែលអាចចុច Run / Stop ម្ដង ១ ភាគពី `1 ដល់ 21` ព្រមទាំងបង្ហាញភាគដែលកំពុងរត់ (`ឧ. កំពុងរត់ EP10/21`) និងភាគដែលកំពុងរង់ចាំលេខរៀង (`⏳ រង់ចាំលេខរៀង`)។
> 3. **Step 3 (ហៅប្រើ Feature នេះគ្រប់ Page ក្នុង Project):** យក `useDubbingFeature`, `<DubbingStepCardsBar />`, និង `<DubbingStepButton />` ទៅជំនួសកូដស្ទួនក្នុង `GeminiRouteModal.jsx` (ទាំងរបារប្រអប់ `1, 2, 3` ខាងលើ និងក្នុងកាត `EP1..EP21` នីមួយៗ), `EpisodesTab.jsx`, `DubbingModeTab.jsx`, និង `VoiceSettings.jsx` រួចរត់ Unit Tests, `oxlint`, និង `vite build` ឱ្យចប់ 100%។
