# Plan: Clean Unified 3-Step Auto-Pipeline & Batch UI Fix

## 1. Architecture & Component Boundary
- `GeminiRouteModal.jsx`:
  - Readiness & Incomplete calculation:
    `const incompleteEpisodes = useMemo(() => episodes.filter(ep => !isEpisode100PercentDone(ep)), [episodes, ...])`
    where `isEpisode100PercentDone(ep)` checks: `hasScript && brokenCount === 0 && hasVoice && !audioOutdated && hasDemucs`.
  - Top Selection Pills:
    - `ទាំងអស់ (${episodes.length} ភាគ)`
    - `ភាគមិនទាន់ចប់ (${incompleteEpisodes.length} ភាគ)`
    - `២ ភាគដំបូង (2 EPs)`
    - `៤ ភាគដំបូង (4 EPs)`
    - `ដកជ្រើសរើស (Clear)` (when `selectedEpIds.size > 0`)
  - Auto-Targeting on Batch Actions:
    All handlers (`handleRunAll3StepsAutoPipeline`, `handleStartBatchTranslate`, `handleBatchGenerateTTS`, `handleBatchDemucsSeparation`) fallback automatically if `selectedEpIds.size === 0` to relevant target episodes and update `selectedEpIds`.
  - Auto-Pipeline Orchestrator:
    `runEpisodeFullPipeline(ep, options)`: runs Stage 1 (Translate / Repair), awaits completion or polls, runs Stage 2 (TTS), awaits completion, runs Stage 3 (Demucs).
  - Compact UI:
    - Default `isScriptSetupExpanded = false`.
    - Compact 3-stage progress summary pills (`grid grid-cols-3 gap-3`).
    - Unified single action bar with `flex-wrap` and `max-width: 100%`:
      - Master CTA `🚀 ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន`
      - Compact secondary triggers: `📝 1. Translate`, `🎙️ 2. សំឡេង AI`, `🔇 3. បិទសំឡេងចិន`, `🔧 ជួសជុល`
      - Right controls: `🛑 Stop All`, Aspect Ratio, `🎬 Export Studio`.
  - Episode Card 3-Step Pipeline Layout:
    - Top header: checkbox, EP badge, title, duration, Key badge.
    - 3 slim pipeline rows:
      - Row 1: Script status + compact action button
      - Row 2: AI Voice status + compact action button
      - Row 3: Demucs BGM status + compact action button
    - Collapsible console log drawer (default collapsed to 1 line).
    - Footer: `▶ ផលិតទាំង 3 ជំហាន (Auto-Run 3 Steps)` + `បើកក្នុង Studio ➔`.

## 2. Verification Plan
- Unit & regression test in `backend/tests/full_project_master_upgrade.test.js` or `backend/tests/batch_studio_clean_pipeline.test.js`.
- Lint & Build verification.

