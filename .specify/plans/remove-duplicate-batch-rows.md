# Technical Plan: Remove Duplicate Toolbar Rows & Double Icons

## 1. Component Architecture Changes

### A. `frontend/src/features/dubbing-runner/DubbingStepCardsBar.jsx`
- Replace double icons:
  - Import `FileText, Mic, VolumeX` from `lucide-react`.
  - In Card 1: replace `<Sparkles />` with `<FileText size={14} color="#38BDF8" />`, change text from `📝 1. Script ខ្មែរ:` to `1. Script ខ្មែរ:`.
  - In Card 2: keep `<Mic size={14} color="#F472B6" />`, change text from `🎙️ 2. សំឡេង AI:` to `2. សំឡេង AI:`.
  - In Card 3: replace `<Volume2 />` with `<VolumeX size={14} color="#34D399" />`, change text from `🔇 3. Clean BGM:` to `3. Clean BGM:`.

### B. `frontend/src/components/dashboard/GeminiRouteModal.jsx`
- Remove `btn-batch-primary-cta`, `btn-batch-primary-tts`, and `btn-batch-primary-demucs` from `batch-primary-execution-row`.
- Remove `data-testid="batch-card-view-filter"` and its 4 filter tab buttons.
- Keep `cardStageView = 'all'` so all episode cards render all 3 stage modules.
- Remove duplicate emojis from button labels:
  - In `btn-batch-run-all`: change `<span>🚀 ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន (Run All 3 Steps) (${targetCount} ភាគ)</span>` to `<span>ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន (${targetCount} ភាគ)</span>` (uses Lucide `<Zap size={14} />`).
  - In `btn-repair-broken-segments`: change `<span>🔧 ជួសជុល (${repairBrokenCount})</span>` to `<span>ជួសជុល (${repairBrokenCount})</span>` (uses Lucide `<Wrench size={12} />`).
  - In `step4-open-export-studio-btn`: change `<span>🎬 Export Studio</span>` to `<span>Export Studio</span>` (uses Lucide `<Film size={13} />`).
- Align `batch-actions-bar` as a single horizontal utility row:
  - Left group: `btn-batch-run-all`, `btn-repair-broken-segments`, `btn-batch-retranslate`, Kill button.
  - Right group: aspect ratio toggle (`16:9 | 9:16`), Export Studio button, compatibility hidden test buttons.

### C. `backend/tests/` Updates
- `backend/tests/clean_unified_3step_batch_pipeline.test.js`:
  - Update card header match regexes: `/1\. Script ខ្មែរ:/`, `/2\. សំឡេង AI:/`, `/3\. Clean BGM:/`.
- `backend/tests/ai_detection_and_dubbing_prompt_fix.test.js`:
  - Update Step 6 & Step 8 to read `combined` (modal + cardsBar) and check `<DubbingStepCardsBar />` and unified action row.

## 2. Verification Plan
- `node --test backend/tests/clean_unified_3step_batch_pipeline.test.js`
- `node --test backend/tests/reusable_1by1_dubbing_feature.test.js`
- `node --test backend/tests/full_project_master_upgrade.test.js`
- `node --test backend/tests/ai_detection_and_dubbing_prompt_fix.test.js`
- `npm --prefix frontend run build`

