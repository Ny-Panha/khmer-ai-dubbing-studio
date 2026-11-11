# Plan: Batch Generate Studio UI & 3-Step AI Runners Upgrade

## 1. Architecture & Component Boundaries
- **`frontend/src/components/dashboard/GeminiRouteModal.jsx`**:
  - Add state: `const [cardStageView, setCardStageView] = useState('all'); // 'all' | 'translate' | 'tts' | 'demucs'`
  - Top Action Bar refactor:
    - Row 1: Primary Execution Row with 4 buttons:
      - `📝 1. Translate Script (${targetTranslateLeft} ភាគ)` (`#0284c7` / `#38bdf8`)
      - `🎙️ 2. AI Translate Voice (${targetAudioLeft} ភាគ)` (`#ec4899`)
      - `🔇 3. AI បិទសំឡេងចិន (${targetDemucsLeft} ភាគ)` (`#10b981`)
      - `⚡ Run All 3 Steps (Auto-Pipeline)` (Gradient `#6366f1` -> `#06b6d4`)
    - Row 2: Secondary Utility & View Filter Row:
      - Segmented View Filter: `🎛️ បង្ហាញទាំង 3 មុខងារ (All 3 Steps)`, `📝 1. Translate Script`, `🎙️ 2. AI Translate Voice`, `🔇 3. AI បិទសំឡេងចិន`.
      - Utility buttons: `↺ Re-Translate (FORCE)`, `🔧 ជួសជុលប្រយោគខូច (${repairButtonCount})`, `🛑 Kill Active Jobs` (when active).
      - Export controls: `16:9 | 9:16` + `🎬 Open Export Studio`.
  - Episode Card 3-Stage Rendering:
    - Stage 1 Module: `📝 1. Translate Script` (`EpisodeTranslateProgressCard` when active/running; structured summary + inline buttons when idle/done).
    - Stage 2 Module: `🎙️ 2. AI Translate Voice` (`EpisodeTtsProgressCard` when active/running; structured summary + inline buttons when idle/done).
    - Stage 3 Module: `🔇 3. AI បិទសំឡេងចិន (រក្សាភ្លេង BGM ដើម)` (`EpisodeDemucsProgressCard` when active/running; structured summary + inline buttons when idle/done).
    - Single-stage filter mode: only renders the selected stage.
  - Duplicate Active Job Prevention:
    - Pre-filter out episodes where `jobsByEpisodeId.get(ep.id)` is `running` or `queued` when `force === false`.
    - Catch `409` / `DUPLICATE_ACTIVE_JOB` gracefully, adding to informational notice instead of error banner.
- **`backend/routes/jobRoutes.js`**:
  - In `POST /api/jobs/generate`, if `req.body.force === true` and `productionJobQueue.hasActiveJobForEpisode(seriesId, episodeId)`, cleanly cancel the previous job and release lock before creating the fresh job.

## 2. API & Data Contracts
- No breaking API changes. `/api/jobs/generate` continues accepting `{ seriesId, episodeId, videoPath, mode, force, ... }`.
- Client response for batch translation returns structured success count, active running count, and skipped active count.

## 3. Risks & Defensive Guards
- Preserves all existing `data-testid` attributes used by automated tests (`btn-batch-primary-cta`, `btn-batch-translate`, `btn-batch-tts`, `btn-batch-demucs`, `btn-batch-retranslate`, `btn-repair-broken-segments`, `step4-open-export-studio-btn`).
- Retains single-episode selection and mutex locks for Demucs AI (sequential 1-by-1 processing).

