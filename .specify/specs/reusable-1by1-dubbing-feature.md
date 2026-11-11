# Spec: Reusable 1-by-1 Sequential Dubbing Feature (`1. Script`, `2. សំឡេង AI`, `3. Clean BGM`)

## 1. Problem Statement & Motivation
In `Ny-Panha/khmer-ai-dubbing-studio`, running dubbing steps across 21 episodes currently suffers from two major design problems:
1. **Concurrency and Quota Violations:** In previous iterations, batch executions attempted to run jobs concurrently across many episodes at once or relied on fragmented implementations scattered in `GeminiRouteModal.jsx`, `EpisodesTab.jsx`, `DubbingModeTab.jsx`, and `VoiceSettings.jsx`. Concurrent TTS and Demucs on a local machine cause CPU exhaustion, audio buffer corruption, and Gemini RPM/TPM quota spikes.
2. **Duplicated & Inconsistent Logic:**
   - Single-episode translation, TTS audio generation, and Demucs separation are reimplemented separately in 4 different places.
   - When a user wants to run a single step sequentially (e.g. "Run Step 2: AI Voice from EP1 to EP21 1-by-1" or "Run Step 3: Demucs from EP1 to EP21 1-by-1"), there is no unified hook or state manager to monitor `[Current EP / Total EPs]`, active percent, or offer a global `[Stop]` toggle.
   - False blocking warning `"⚠️ សូមជ្រើសរើសភាគជាមុនសិន"` occurs if the user triggers a step without manually checking checkboxes.

## 2. Requirements & Acceptance Criteria

### Requirement 1: Single Source of Truth Engine (`frontend/src/features/dubbing-runner/`)
- Create `DubbingRunnerContext.jsx` and `useDubbingFeature.js`.
- Provide `DubbingRunnerProvider` wrapping the application so running states are globally tracked and reactive across all pages.
- Expose methods:
  - `runSingleTranslate(ep, options)`: Translates/repairs script for 1 episode and resolves only when script is 100% saved on disk.
  - `runSingleVoice(ep, options)`: Generates Edge/Khmer TTS for all missing/outdated segments for 1 episode.
  - `runSingleCleanBgm(ep, options)`: Runs Demucs AI vocal separation for 1 episode until clean BGM is ready on disk.
  - `runSequentialStep(stepType, episodesList, options)`: Runs `stepType` (`'translate' | 'voice' | 'clean_bgm' | 'all3'`) in a strict `for...of await` loop sequentially (`EP1 ➔ EP2 ➔ ... ➔ EPN`), awaiting 100% completion of episode `N` before starting `N+1`.
  - `stopStep(stepType)`: Instantly aborts the active loop and kills background running jobs via abort controller and kill endpoints.

### Requirement 2: Smart Auto-Targeting (Zero Blocking Warnings)
- If `episodesList` is empty or 0 checkboxes are checked, `runSequentialStep` automatically targets all episodes in the active series needing that step (or all episodes if `force: true`).
- NEVER displays `"⚠️ សូមជ្រើសរើសភាគជាមុនសិន"` blocking dialog.

### Requirement 3: Reusable UI Components
- `<DubbingStepCardsBar episodes={episodes} selectedEpIds={selectedEpIds} setupOptions={...} />`:
  - Renders 3 interactive cards (`1. Script ខ្មែរ`, `2. សំឡេង AI`, `3. Clean BGM`).
  - Displays total ready (`X/21 ភាគ`), active episode progress (`កំពុងរត់ EP10 (10/21) • 45%`), and `[▶ Run 1-by-1]` / `[🛑 Stop]` button.
- `<DubbingStepButton step="translate | voice | clean_bgm | all3" episodes={target} variant="card | pill | full" />`:
  - Displays dynamic state: Idle, In Queue (`⏳ រង់ចាំលេខរៀង #X...`), Running (`🔄 កំពុងរត់ X% [Stop]`), or Done (`✅ រួចរាល់`).
  - Usable in Episode Cards, `EpisodesTab`, `DubbingModeTab`, and `VoiceSettings`.

### Requirement 4: Cross-Page Integration
- Replace fragmented batch & single-episode duplicate functions in:
  - `frontend/src/components/dashboard/GeminiRouteModal.jsx`
  - `frontend/src/components/media/EpisodesTab.jsx`
  - `frontend/src/components/media/DubbingModeTab.jsx`
  - `frontend/src/components/voice/VoiceSettings.jsx`
- Maintain 100% backward compatibility for all existing test suites.

