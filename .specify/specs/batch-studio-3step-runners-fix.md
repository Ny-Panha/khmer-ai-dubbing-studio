# Spec: Batch Generate Studio UI & 3-Step AI Runners Upgrade

## 1. Problem Statement & User Intent (Why)
- Users in `localhost:5173/batch` (`GeminiRouteModal.jsx`) cannot easily see or trigger **1. Translate Script**, **2. AI Translate Voice**, and **3. AI បិទសំឡេងចិន (Demucs Clean BGM)** because:
  1. The top action bar only showed a single contextual primary CTA plus a quiet secondary row, obscuring the primary batch runners.
  2. Episode cards only rendered runner progress when an active job was running, leaving users uncertain about the status of each individual step and without 1-click action buttons on the card itself (like repair or voice generation).
  3. Clicking batch translation when an episode already had a running or queued job produced an alarming red error banner: `Duplicate Active Job: An active job (#job_...) is already running`.
- **Intent**: Provide a clear 2-row batch control bar with 4 prominent action buttons, display all 3 stage modules inside every episode card by default (with a stage filter switcher), provide direct 1-click inline action buttons on each episode card, and filter out/skip active jobs with an informative notice instead of a scary red error.

## 2. User Scenarios & Stories (What)
- **Scenario 1 (Top Batch Bar)**: User opens Batch Generate Studio and sees 4 big, color-coded primary buttons: `📝 1. Translate Script`, `🎙️ 2. AI Translate Voice`, `🔇 3. AI បិទសំឡេងចិន`, and `⚡ Run All 3 Steps (Auto-Pipeline)`. Below it, a view filter allows switching between `🎛️ បង្ហាញទាំង 3 មុខងារ (All 3 Steps)` (default), `Translate`, `Voice AI`, and `Demucs`.
- **Scenario 2 (Episode Cards with 3 Stages)**: Inside every episode card (`EP1`, `EP2`...), user clearly sees 3 dedicated stage modules:
  - Stage 1: `📝 1. Translate Script` with inline action (`[📝 បកប្រែ Script]`, `[🔧 ជួសជុលឃ្លាខូច]`, `[↺ បកប្រែឡើងវិញ]`, `[🛑 Kill]`).
  - Stage 2: `🎙️ 2. AI Translate Voice` with inline action (`[🎙️ បង្កើតសំឡេងខ្មែរ AI]`, `[🛑 Kill]`, `[🔊 បង្កើតឡើងវិញ]`).
  - Stage 3: `🔇 3. AI បិទសំឡេងចិន (Demucs Clean BGM)` with inline action (`[🔇 បិទសំឡេងចិន]`, `[🛑 Kill]`, `[↺ ធ្វើម្ដងទៀត]`).
- **Scenario 3 (Duplicate Active Job Guard)**: When user clicks `Translate` on an episode that is already running or queued (with `force: false`), the system gracefully skips it and informs the user (`"បានដាក់បញ្ចូល Queue ចំនួន X ភាគ • រំលង Y ភាគដែលកំពុងដំណើរការស្រាប់"`), avoiding red error banners. When `force: true`, the existing job is cancelled and cleanly replaced.

## 3. Scope & Component Boundaries
- **In Scope**:
  - `frontend/src/components/dashboard/GeminiRouteModal.jsx` (Top Batch Action Bar, View Filter, Episode Card 3-Stage Layout, Inline Action Handlers, Duplicate Job Guard).
  - `backend/routes/jobRoutes.js` (Force re-translation cancels active episode lock/job cleanly).
  - `backend/tests/ai_detection_and_dubbing_prompt_fix.test.js` (Automated verification).
- **Out of Scope**:
  - Modifications to audio generation models or Demucs worker algorithms.

## 4. Acceptance Criteria
- [ ] Top action bar renders 4 primary buttons: `btn-batch-primary-translate`, `btn-batch-primary-tts`, `btn-batch-primary-demucs`, and `btn-batch-run-all`.
- [ ] Card view filter segmented control exists with `all`, `translate`, `tts`, and `demucs`, defaulting to `all`.
- [ ] Every episode card in `all` view renders Stage 1 (Translate), Stage 2 (Voice AI), and Stage 3 (Demucs Clean BGM).
- [ ] Episode cards have direct 1-click inline action buttons (`btn-inline-translate`, `btn-inline-tts`, `btn-inline-demucs`).
- [ ] `executeBatchTranslateEnqueue` skips already-active episodes when `force: false` and notifies via informational status toast without throwing `Duplicate Active Job` red banner.

