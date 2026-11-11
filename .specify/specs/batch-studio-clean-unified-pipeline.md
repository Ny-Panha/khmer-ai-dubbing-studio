# Spec: Clean Unified 3-Step Auto-Pipeline & Batch UI Fix

## 1. Problem & Intent (Why)
- Source: `clean_unified_3step_batch_pipeline_prompt.md` and user screenshots.
- In `GeminiRouteModal.jsx`:
  1. Top header is bloated (>5 stacked rows, taking 75% screen height, cut off on right).
  2. Clicking batch buttons when `selectedEpIds.size === 0` pops up a blocking dialog `"សូមជ្រើសរើសភាគជាមុនសិន"`.
  3. Top pills show broken counts (`✓ គ្រប់ភាគល្អរាល់ 100%`, `ទាំងអស់ (0 ភាគ)`).
  4. Running 3 steps (Translate, TTS, Demucs) requires manual clicking instead of a true continuous pipeline.

## 2. User Scenarios
- S1: User opens `/batch`. Top header is compact (<140px), script setup is collapsed by default into 1 summary line, 3 progress bars are compact pills in 1 row (`grid-cols-3`), toolbar wraps cleanly with 0 horizontal overflow.
- S2: Top selection pills accurately show `ទាំងអស់ (${episodes.length} ភាគ)`, `ភាគមិនទាន់ចប់ (${incompleteEpisodes.length} ភាគ)`, `២ ភាគដំបូង (2 EPs)`, `៤ ភាគដំបូង (4 EPs)`, and `ដកជ្រើសរើស (Clear)` when selected.
- S3: User clicks `🚀 ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន` without checking checkboxes → System automatically targets incomplete episodes and runs Stage 1 (Translate/Repair) ➔ Stage 2 (AI Voice TTS) ➔ Stage 3 (Demucs Vocal Separation) with 0 blocker popups.
- S4: In each Episode Card (`EP1`, `EP2`...), 3 clean horizontal rows display the status and direct actions for each step, console logs are collapsed into 1 line by default, and a primary footer button `▶ ផលិតទាំង 3 ជំហាន` runs all 3 steps for that episode.

## 3. Scope & Boundaries
- In scope: `frontend/src/components/dashboard/GeminiRouteModal.jsx`, `frontend/src/components/dashboard/GeminiRouteModal.css`, and related runner components if needed.
- Out of scope: Backend separation or TTS algorithms, breaking API changes.

## 4. Acceptance Criteria
- [ ] No popup `"សូមជ្រើសរើសភាគជាមុនសិន"` when clicking any Batch Action button with 0 checked.
- [ ] Top selection pills show accurate counts for all 21 episodes.
- [ ] Script setup collapsed by default; 3 progress stats rendered in compact grid row; toolbar wrapped with no horizontal scroll.
- [ ] `runEpisodeFullPipeline` orchestrates Translate/Repair ➔ TTS ➔ Demucs per episode and in batch.
- [ ] `npm --prefix frontend run lint` 0 errors, `npm --prefix frontend run build` PASS, regression tests PASS.

