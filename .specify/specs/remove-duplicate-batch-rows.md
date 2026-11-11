# Specification: Remove Duplicate Toolbar Rows & Double Icons in GeminiRouteModal & DubbingStepCardsBar

## 1. Problem Statement & Motivation (WHAT & WHY)
Inside `GeminiRouteModal.jsx` (Batch Generate Studio), the 3 core production steps (`1. Script ខ្មែរ`, `2. សំឡេង AI`, `3. Clean BGM`) are currently rendered in duplicate across 3 separate rows:
1. **Row 1 (`<DubbingStepCardsBar />`)**: Renders 3 step cards with double icons (Lucide SVG + emoji: `✨ 📝`, `🎙️ 🎙️`, `🔊 🔇`).
2. **Row 2 (`batch-primary-execution-row`)**: Renders `btn-batch-primary-cta` (`📝 1. Translate Script`), `btn-batch-primary-tts` (`🎙️ 2. AI Translate Voice`), and `btn-batch-primary-demucs` (`🔇 3. AI បិទសំឡេងចិន`), creating a redundant second copy of the same 3 triggers.
3. **Row 3 (`batch-card-view-filter`)**: Renders filter switcher tabs `[🎛️ ទាំង 3 | 📝 Translate | 🎙️ Voice | 🔇 Clean BGM]`, creating a redundant 3rd repetition of the 3 steps, pushing critical utilities (`Re-Translate`, aspect ratio `16:9 | 9:16`, `Export Studio`) into clutter.

## 2. In-Scope Requirements
1. **`DubbingStepCardsBar.jsx`**:
   - Single clean SVG icon per card header:
     - Card 1: `<FileText size={14} color="#38BDF8" /> 1. Script ខ្មែរ:` (no emoji)
     - Card 2: `<Mic size={14} color="#F472B6" /> 2. សំឡេង AI:` (no emoji)
     - Card 3: `<VolumeX size={14} color="#34D399" /> 3. Clean BGM:` (no emoji)
2. **`GeminiRouteModal.jsx`**:
   - Delete duplicate step buttons `btn-batch-primary-cta`, `btn-batch-primary-tts`, and `btn-batch-primary-demucs`.
   - Delete `batch-card-view-filter` tabs (`filter-view-all`, `filter-view-translate`, `filter-view-tts`, `filter-view-demucs`) and lock `cardStageView` to `'all'` so episode cards always show all 3 stages cleanly.
   - Collapse remaining controls into ONE single compact horizontal utility row (`data-testid="batch-actions-bar"`):
     - **Left group (`data-testid="batch-primary-execution-row"`)**:
       - `btn-batch-run-all`: `<Zap size={14} /> ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន (${targetCount} ភាគ)` (no `🚀` emoji)
       - `btn-repair-broken-segments` (if broken count > 0): `<Wrench size={12} /> ជួសជុល (${repairBrokenCount})` (no `🔧` emoji)
       - `btn-batch-retranslate`: `<RotateCcw size={11} /> Re-Translate`
       - `🛑 Kill` button (if active translate jobs running)
     - **Right group**:
       - Aspect Ratio toggle (`16:9` | `9:16`) (`data-testid="step4-aspect-toggle"`)
       - `step4-open-export-studio-btn`: `<Film size={13} /> Export Studio` (no `🎬` emoji)
       - Hidden compatibility buttons: `btn-batch-translate`, `btn-batch-tts`, `btn-batch-demucs`
3. **Tests**:
   - Update tests in `backend/tests/` to assert the single clean `<DubbingStepCardsBar />` and unified single actions bar.
   - All tests pass (100%), `npm --prefix frontend run build` passes with 0 errors.

## 3. Out-of-Scope
- No modifications to audio separation service, timeline editor, or database persistence.
- No changes to 1-by-1 sequential runner logic in `DubbingRunnerContext.jsx`.

