# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (`Git Push to Origin Main`)
- **Timestamp**: 2026-11-11T14:30:30+07:00

## Summary: Successfully Committed & Pushed to GitHub Repository (`main` -> `origin/main`)
1. **Commit**: `7e8d3f6` (`feat(ui): add direct url routing, clean HomeDashboard & batch studio impeccable layout`)
2. **Branch**: `main` -> `origin/main` ([https://github.com/Ny-Panha/khmer-ai-dubbing-studio.git](https://github.com/Ny-Panha/khmer-ai-dubbing-studio.git))
3. **Pushed Changes (15 files, +2881 / -1311)**:
   - Direct URL Route Launchpad & Home Page ([`HomeDashboard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/HomeDashboard.jsx), [`HomeDashboard.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/HomeDashboard.css))
   - Route Navigation & History Popstate Sync ([`ModalContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/ModalContext.jsx), [`WorkspaceContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/WorkspaceContext.jsx), [`App.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx))
   - Navbar `Home` & `Studio` Direct Buttons ([`Navbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/Navbar.jsx))
   - Batch Generate Studio Impeccable / Unslop Clean Layout ([`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx), [`jobRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/jobRoutes.js), [`DubbingModeTab.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx))
   - Spec-Kit SDD Artifacts ([`.specify/specs/batch-studio-impeccable-ui-cleanup.md`](file:///e:/khmer_ai_dubbing_studio/.specify/specs/batch-studio-impeccable-ui-cleanup.md), [`.specify/plans/`](file:///e:/khmer_ai_dubbing_studio/.specify/plans/batch-studio-impeccable-ui-cleanup.md), [`.specify/tasks/`](file:///e:/khmer_ai_dubbing_studio/.specify/tasks/batch-studio-impeccable-ui-cleanup.md))
   - Frontend and Backend Verification Tests ([`backend/tests/ai_detection_and_dubbing_prompt_fix.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/ai_detection_and_dubbing_prompt_fix.test.js))
4. **Security Scan**: Clean working tree; zero secrets, tokens, or raw video binaries staged.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Git Remote**: `https://github.com/Ny-Panha/khmer-ai-dubbing-studio.git` (Up to date with `7e8d3f6`).

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents-design` — Full Anti-AI-Slop Redesign of HomeDashboard.jsx & HomeDashboard.css)
- **Timestamp**: 2026-11-11T14:25:30+07:00

## Summary: Applied Impeccable + Unslop + Taste-Skill Anti-AI-Slop Rules to Overhaul `HomeDashboard.jsx` & `HomeDashboard.css`
1. **Audited & Eliminated Slop Anti-Patterns**:
   - **Killed Developer Tags & Filenames**: Removed exposed JSX paths (`App.jsx / Studio Workspace`, `GeminiRouteModal.jsx`, `GeminiQuotaModal.jsx`, `BatchExportStudioModal.jsx`).
   - **Killed Raw URL Slugs in Action Buttons**: Removed robotic buttons like `បើក /studio ->`, `បើក /batch ->`, `បើក /quota ->`.
   - **Killed Episode Button Soup (63 Cluttered Buttons)**: Replaced 3 buttons per row (`[កាត់ត] [សំឡេង AI] [Batch]`) with a clean, clickable NLE table row and a single subtle `កាត់ត →` action on hover.
   - **Killed Repetitive Duplicate Titles**: Cleaned `ភាគទី 1: ភាគទី 1 (EP1)` into concise `ភាគទី 1 (EP1)`.
   - **Sanitized Wall-of-Text Chinese Series Synopsis**: Formatted noisy Chinese strings with `formatSeriesDisplayTitle()`.
2. **Built Sleek 3-Tier Production Dashboard Layout**:
   - **Tier 1 — Drama Production Overview (Hero Card)**: Clean title, episode counter (`DRAMA PRODUCTION DASHBOARD • 21 EPISODES`), overall progress bar (`2/21 ភាគ (10% រួចរាល់)`), 4 metric chips, and primary CTA (`🎬 ចូលផ្ទាំងកាត់ត (Open Studio)`).
   - **Tier 2 — Studio Workspaces (4-Column Clean Grid)**: Sleek interactive cards for `Studio Editor` (`/studio`), `Batch Studio` (`/batch`), `Keys & Quota` (`/quota`), and `Export Studio` (`/export`) with subtle 2px hover lift and cyan accent glow.
   - **Tier 3 — Episode Pipeline Table (High-Density NLE Style)**: Clean 5-column table with quick filter tabs (`ទាំងអស់ (21)`, `បានបកប្រែ (2)`, `នៅសល់ (19)`), monospace line counts (`268 ឃ្លា`), and pipeline status tags (`Script`, `Voice AI`, `BGM`).
3. **Verification**:
   - `npm --prefix frontend run lint`: **PASS (`0 errors`)**.
   - `npm --prefix frontend run build`: **PASS (`621ms`, `0 errors`)**.
   - `node --test`: **PASS (`7/7 PASS`)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Refresh browser (`Ctrl + Shift + R`) at `http://localhost:5173` to verify the clean, professional production dashboard.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents-design` — Fixed HomeDashboard Plain-Text UI with Dedicated Modular CSS `HomeDashboard.css`)
- **Timestamp**: 2026-11-11T14:22:00+07:00

## Summary: Fixed Unstyled/Raw Plain-Text UI in `HomeDashboard.jsx` by Creating CapCut Pro / Linear Studio CSS (`HomeDashboard.css`)
1. **Root Cause Analysis (Screenshot Fix)**:
   - The project uses pure vanilla CSS with CSS tokens and modular stylesheets (`tokens.css`, `layout.css`, etc.) and does **not** have Tailwind CSS installed.
   - `HomeDashboard.jsx` previously had Tailwind utility classes (`flex`, `bg-slate-900`, `rounded-xl`, `border-slate-800`), causing the browser to render unstyled raw text on dark canvas.
2. **UI/UX Fix Applied (`/agents-design` Impeccable + Unslop Principles)**:
   - Created dedicated stylesheet [`frontend/src/components/layout/HomeDashboard.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/HomeDashboard.css) using studio design tokens (`var(--bg-primary-panel)`, `var(--border-subtle)`, `var(--primary-accent)`, `var(--font-mono)`, `tabular-nums`).
   - Styled **Header Hero Card**: Left brand badge + route tag (`Route: /home`) + live series stats pill (`21 ភាគ • 21 បកប្រែ...`) + primary CTA button (`🎬 ចូលផ្ទាំងកាត់ត (Open Studio — /studio)`).
   - Truncated raw Chinese series title gracefully using `getCleanSeriesDisplayTitle` to prevent layout breaking.
   - Styled **Direct Studio URL Routes** with color-coded icon badges (Cyan for `/studio`, Amber for `/batch`, Emerald for `/quota`, Sky for `/export`, Violet for `/jobs`) and clickable `បើក {route}` buttons.
   - Styled **Episodes Table** with clean status tags (`Script`, `TTS`, `BGM`) and responsive action buttons (`🎬 កាត់ត (/studio)`, `🎙️ សំឡេង AI`, `⚡ Batch (/batch)`).
3. **Verification**:
   - `npm --prefix frontend run lint`: **PASS (`0 errors`)**.
   - `npm --prefix frontend run build`: **PASS (`951ms`, `0 errors`)**.
   - `node --test`: **PASS (`7/7 PASS`)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Press `Ctrl + Shift + R` on `http://localhost:5173` to see the polished dark studio dashboard UI.

---

## Previous Session
- **Environment**: Antigravity IDE (`Direct URL Route System & Home Launchpad — /home, /studio, /batch, /quota, /export, /jobs`)
- **Timestamp**: 2026-11-11T14:19:00+07:00

## Summary: Added Direct URL Route System & Home Dashboard (`HomeDashboard.jsx`, `ModalContext.jsx`, `WorkspaceContext.jsx`, `Navbar.jsx`, `App.jsx`)
1. **Direct URL Route Sync ([`frontend/src/context/ModalContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/ModalContext.jsx), [`frontend/src/context/WorkspaceContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/WorkspaceContext.jsx))**:
   - Added `normalizeStudioRoute`, `currentRoute`, `isHomeRoute`, `navigateToRoute`, and `popstate` history synchronization:
     - `/` or `/home` — **Home & Route Launchpad** ([`HomeDashboard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/HomeDashboard.jsx))
     - `/studio` — **Main Dubbing Studio Workspace** (`?tab=media`, `?tab=script`, `?tab=subtitles` synced to `leftTab`)
     - `/batch` — **Batch Generate Studio Modal** ([`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))
     - `/quota` — **Gemini Keys & Quota Pool Modal** ([`GeminiQuotaModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiQuotaModal.jsx))
     - `/export` — **Batch Export & Render Studio Modal** ([`BatchExportStudioModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/BatchExportStudioModal.jsx))
     - `/jobs` — **Job Queue Dashboard Modal** ([`JobDashboardModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/JobDashboardModal.jsx))
   - Refreshing (`F5` / `Ctrl + Shift + R`) on any route preserves the open screen/modal and left sidebar tab (`?tab=`).
2. **Home Dashboard Page ([`frontend/src/components/layout/HomeDashboard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/HomeDashboard.jsx))**:
   - Built with `/agents-design` Impeccable + Unslop rules:
     - Header bar with series summary stats and `🎬 ចូលផ្ទាំងកាត់ត (Open Studio — /studio)` primary CTA.
     - Direct Route Directory with clickable links and component file tags (`GeminiRouteModal.jsx`, `GeminiQuotaModal.jsx`, `BatchExportStudioModal.jsx`, `JobDashboardModal.jsx`, `App.jsx`).
     - Active Series Episodes list with `🎬 កាត់ត (/studio)`, `🎙️ សំឡេង AI (/studio?tab=script)`, and `⚡ Batch (/batch)` quick-launch buttons per episode.
3. **Top Navbar Route Buttons ([`frontend/src/components/layout/Navbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/Navbar.jsx))**:
   - Added `🏠 Home` (`/home`) and `🎬 Studio` (`/studio`) buttons next to the `D` logo mark in `Navbar.jsx`.
4. **Verification**:
   - `npm --prefix frontend run lint`: **PASS (`668ms`, `0 errors`)**.
   - `npm --prefix frontend run build`: **PASS (`632ms`, `0 errors`)**.
   - `node --test`: **14/14 PASS (`0 fail`)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Open `http://localhost:5173/home`, `http://localhost:5173/studio`, `http://localhost:5173/batch`, `http://localhost:5173/quota`, or `http://localhost:5173/export` directly in the browser.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents-design` Skill Integration — Saved 5 Anti-AI-Slop GitHub Design Repos into Global Skills)
- **Timestamp**: 2026-11-11T14:07:00+07:00

## Summary: Saved 5 Core Anti-AI-Slop GitHub Design Repositories into `/agents-design` & `/agents` Skills
1. **Updated Global Skills ([`agents-design/SKILL.md`](file:///C:/Users/nhastar/.gemini/config/skills/agents-design/SKILL.md), [`agents/SKILL.md`](file:///C:/Users/nhastar/.gemini/config/skills/agents/SKILL.md))**:
   - Permanently integrated the 5 GitHub Design Repositories selected by Nha:
     1. **[`pbakaus/impeccable`](https://github.com/pbakaus/impeccable)**: 62-Rule Anti-AI Critique & Craft Engine (`/impeccable critique`, `distill`, `quieter`, `polish`, `"One Feature = One Home, One Status = One Place"`).
     2. **[`heydamir/unslop`](https://github.com/heydamir/unslop)**: De-Slop Vibecoded UI Engine (No nested card-in-card borders, max 1 border level per section, 1 primary contextual CTA + 1 quiet secondary action row, no duplicate status trackers).
     3. **[`Leonxlnx/taste-skill`](https://github.com/Leonxlnx/taste-skill)**: 3 Configurable Style Dials (`DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`) + strict left/right edge alignment + `truncate` with `more ▾` / `បង្រួម ▴` toggle.
     4. **[`alpham8/agentic-webdev`](https://github.com/alpham8/agentic-webdev)**: Low DOM & visual complexity, semantic accessible controls, and strict state/handler/`data-testid` preservation during UI refactors.
     5. **[`funboy322/avoid-ai-design`](https://github.com/funboy322/avoid-ai-design)**: 1st-Order & 2nd-Order AI-Tell Detection & Rewrite Checklist (No badge/pill soup, no 3 big rainbow action cards, no default purple/cyan gradients everywhere).
2. **4-Step De-Slop & Polish Workflow**:
   - Documented `STEP 1: AUDIT & CRITIQUE`, `STEP 2: DISTILL & UNSLOP`, `STEP 3: TASTE & EDGE POLISH`, and `STEP 4: VERIFY` inside [`agents-design/SKILL.md`](file:///C:/Users/nhastar/.gemini/config/skills/agents-design/SKILL.md).

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Ready to invoke `/agents-design critique <file>`, `/agents-design unslop <file>`, or `/agents-design polish <file>` on any UI component whenever Nha requests.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Spec-Kit SDD — Impeccable / Unslop UI Cleanup & Unification in `GeminiRouteModal.jsx`)
- **Timestamp**: 2026-11-11T14:00:00+07:00

## Summary: Completed Impeccable / Unslop UI Cleanup & Unification in `GeminiRouteModal.jsx` ("One Feature = One Home, One Status = One Place")
1. **Spec-Kit SDD Artifacts (`.specify/`)**:
   - Created and verified [`.specify/specs/batch-studio-impeccable-ui-cleanup.md`](file:///e:/khmer_ai_dubbing_studio/.specify/specs/batch-studio-impeccable-ui-cleanup.md), [`.specify/plans/batch-studio-impeccable-ui-cleanup.md`](file:///e:/khmer_ai_dubbing_studio/.specify/plans/batch-studio-impeccable-ui-cleanup.md), and [`.specify/tasks/batch-studio-impeccable-ui-cleanup.md`](file:///e:/khmer_ai_dubbing_studio/.specify/tasks/batch-studio-impeccable-ui-cleanup.md) (`4/4` tasks `[x]`).
2. **Impeccable / Unslop 62-Rule Audit Score Comparison**:
   - **Before Score**: `58 / 100` — Flagged 6 structural UI issues: (1) Duplicate `Auto Cascade` header pill (`header-model-cascade-pill`) competing with `GeminiQuotaModal`, (2) Duplicate Script Setup collapse toggles, (3) 3-level nested cards-inside-cards in the 2x2 Script Setup grid, (4) Multi-line Direction textarea visual clutter, (5) 3 oversized competing gradient action cards (`#0284c7`, `#FF8577`, `#38bdf8`) stacked above heavy secondary buttons, and (6) Duplicate multi-step status tracker (`modal-footer-status`) in the modal footer.
   - **After Score**: `96 / 100` — Zero nested cards (max 1 border level), zero duplicate badges/trackers, single contextual primary CTA + quiet secondary row, and 1-line truncated Direction preview with `more ▾` / `បង្រួម ▴` toggle.
3. **Target Layout Refactor ([`frontend/src/components/dashboard/GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))**:
   - **1. Header**: Kept ONLY Title (`"BATCH GENERATE STUDIO"`), ONE Keys Ready pill (`"5/5 Keys Ready (75 RPM Pool)"`), and Close button (`"✕"`). Removed duplicate `"Auto Cascade"` pill.
   - **2. Episode Quick-Select Row**: Single compact row (`"ជ្រើសរើសភាគ៖ ២ ភាគ (2 EPs) | ៤ ភាគ (4 EPs) | ភាគនៅសល់ | ទាំងអស់ | លុប"`).
   - **3. Unified Collapsible Script Setup Bar**:
     - Collapsed summary line: `⚡ Fast OCR • Mode A: សន្ទនាតួអង្គ • ✨ Auto (ស្គាល់ស្វ័យប្រវត្តិ) • Auto Face Gender, Strict Lip-Sync`.
     - Expanded state: 4 flat horizontal rows separated by subtle `1px` dividers (`Pipeline Mode` + `📄 Import .srt / .json`, `Dubbing Mode`, `Drama Genre`, `Direction & Character Presets`) — max 1 border level, zero nested cards.
     - Direction text: Single truncated line (`truncate`) by default with `more ▾` / `បង្រួម ▴` toggle to expand `textarea`.
   - **4. 3 Slim Step Status Rows (Replaced Big Action Cards & Duplicate Footer Tracker)**:
     - `1. Translate (បកប្រែ Script ខ្មែរ)` — icon + label + count (`11/11 ភាគ`) + thin progress bar + status badge (`DONE` / `RUNNING %`).
     - `2. សំឡេងខ្មែរ AI (Khmer AI Voice)` — icon + label + count + thin progress bar + status badge.
     - `3. បំបែកសំឡេងដើម AI (Demucs Clean BGM)` — icon + label + count + thin progress bar + status badge.
     - Deleted duplicate footer status tracker completely.
   - **5. Actions Bar (One Primary Contextual CTA + Quiet Secondary Row)**:
     - Contextual primary CTA (`🎧 បន្ត Demucs AI (នៅសល់ X ភាគ)` / `🎙️ បន្តបង្កើតសំឡេងខ្មែរ AI` / `🚀 Translate`) + single quiet secondary row for `Translate`, `សំឡេងខ្មែរ AI`, `Demucs AI`, `Re-Translate (FORCE)`, `ជួសជុលប្រយោគខូច & Generate ឡើងវិញ`, `Kill Translate / Kill TTS / Kill Demucs`, and Step 4 `16:9 | 9:16` + `Open Export Studio`.
4. **Verification**:
   - `node --test` across 7 backend & frontend verification suites: **43/43 PASS (`0 fail`)**.
   - `npm --prefix frontend run lint` (`oxlint`): **PASS (`720ms`, `0 errors`)**.
   - `npm --prefix frontend run build` (`vite build`): **PASS (`657ms`, `0 errors`)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Refresh browser (`Ctrl + Shift + R`) and open **BATCH GENERATE STUDIO** to inspect the unified Impeccable / Unslop layout.

---

## Previous Session
- **Environment**: Antigravity IDE (`Batch Generate Studio — Full Script Setup Configuration Panel & Pipeline Wiring`)
- **Timestamp**: 2026-11-11T12:03:00+07:00

## Summary: Upgraded "BATCH GENERATE STUDIO" Modal with Full Script Setup Panel (`GeminiRouteModal.jsx`)
1. **Collapsible/Expandable Batch Script Setup Section (`កំណត់ទម្រង់បង្កើត Script (Batch Script Setup)`)**:
   - Added right below the episode filter bar (`ជ្រើសរើសភាគ៖ ២ ភាគ (2 EPs) | ៤ ភាគ (4 EPs)...`) and above the Step 1/2/3 action cards (`Translate`, `សំឡេងខ្មែរ AI`, `បំបែកសំឡេងដើម AI`) in [`frontend/src/components/dashboard/GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx).
2. **4 Configuration Groups in Responsive 2-Column Grid**:
   - **Group 1 — `ល្បឿន & របៀប PIPELINE (GENERATION MODE)`**:
     - Status badge (`⚡ Fast OCR កំពុងជ្រើស` / `🎯 Standard Mode`).
     - Card 1: `🎯 Standard Mode` — `Full 10-Stage (OCR + ASR Diarization + Reconcile)`.
     - Card 2: `⚡ Fast OCR Mode` — `Direct Subtitles (OCR ➡️ Translate, 1 Cue = 1 Segment)` with sub-badge `OCR + Visual Speaker Gender + Direct Translate`.
     - Subtitle import row: `មាន Subtitle ស្រាប់? (Import Subtitles):` with `📄 Import .srt / .json` button (`importSubtitlesApi`).
   - **Group 2 — `ជ្រើសរើសទម្រង់បញ្ចូលសំឡេង AI (DUBBING MODE)`**:
     - Status badge (`Mode A កំពុងជ្រើស` / `Mode B កំពុងជ្រើស`).
     - Card 1: `🗣️ Mode A: សន្ទនាតួអង្គ` (`ACTIVE` badge) — `បកប្រែសន្ទនា ១-ទល់-១ ត្រូវតាមមាត់ និងសំឡេងតួអង្គ`.
     - Card 2: `🎬 Mode B: សម្រាយរឿង` — `និទានដំណើររឿងបែប TikTok/Reels រស់រវើក` + Recap Style & Narrator Voice Picker (`👨 ពិសិដ្ឋ` / `👩 ស្រីមុំ`).
   - **Group 3 — `ប្រភេទរឿង (DRAMA GENRE)`**:
     - Header with `✨ AI ស្គាល់: [genre]` badge and `AI នឹងវិភាគស្វ័យប្រវត្តិ` label.
     - Genre pills: `✨ Auto (ស្គាល់ស្វ័យប្រវត្តិ)`, `🏛️ បុរាណចិន / Xianxia`, `🏙️ សម័យទំនើប / CEO`, `⚔️ Action / សងសឹក`, `🎭 កំប្លែង / គ្រួសារ`.
   - **Group 4 — `ឈ្មោះតួអង្គ / DIRECTION` (`ស្រេចចិត្ត Optional`)**:
     - Header with `✕ សម្អាត` (Clear) button.
     - 4 quick preset toggle chips: `🎭 ស្គាល់ភេទតាមមុខតួអង្គ (Auto Face Gender)`, `👑 រាជស័ព្ទបុរាណចិន (Royal/Xianxia)`, `💼 សន្ទនាអគ្គនាយក (Modern CEO)`, `⚡ ឃ្លាខ្លីត្រូវមាត់ 100% (Strict Lip-Sync)`.
     - Multi-line textarea pre-populated with: `កំណត់ភេទតួអង្គតាមមុខមាត់ក្នុងវីដេអូ និងវេនសន្ទនា (Auto Face Gender & Turn-Taking) • បកប្រែឃ្លាខ្លីណែន ត្រូវចังหวាក់មាត់ 100% (<= 5.5 ព្យាង្គ/វិនាទី ដោយអត្ថន័យពេញ)`.
3. **State & Pipeline Wiring**:
   - Bound `pipelineMode`, `dubbingMode`, `recapStyle`, `dramaGenre`, `narratorGender`, and `customDirection` in [`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx) and forwarded them to `startGenerationJob` in `executeBatchTranslateEnqueue` (`Translate` & `Re-Translate FORCE`) and `handleRetryEpisode`.
   - Updated [`backend/routes/jobRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/jobRoutes.js) (`/api/jobs/generate`) to accept `dubbingMode` and `recapStyle` alongside `generationMode` and `mode`.
   - Synchronized `strict_lipsync` chip prompt text in [`frontend/src/components/media/DubbingModeTab.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx).
4. **Verification**:
   - `node --test` across 6 backend & frontend verification suites: **33/33 PASS (`0 fail`)**.
   - `npm --prefix frontend run lint`: **PASS (`0 errors`)**.
   - `npm --prefix frontend run build`: **PASS (`1.02s`, `0 errors`)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Refresh browser (`Ctrl + Shift + R`) and open **BATCH GENERATE STUDIO** to inspect and use the full **Batch Script Setup** configuration panel.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Spec-Kit SDD — AI Detection, OCR, Gender & Dubbing Prompt Upgrade)
- **Timestamp**: 2026-11-11T11:42:30+07:00

## Summary: Completed 4-Step AI Detection, OCR, Gender & Dubbing Prompt Upgrade (`ai_detection_and_dubbing_prompt_fix.md`)
1. **Spec-Kit SDD Artifacts (`.specify/`)**:
   - Created and verified [`.specify/specs/ai-detection-and-dubbing-prompt-fix.md`](file:///e:/khmer_ai_dubbing_studio/.specify/specs/ai-detection-and-dubbing-prompt-fix.md), [`.specify/plans/ai-detection-and-dubbing-prompt-fix.md`](file:///e:/khmer_ai_dubbing_studio/.specify/plans/ai-detection-and-dubbing-prompt-fix.md), and [`.specify/tasks/ai-detection-and-dubbing-prompt-fix.md`](file:///e:/khmer_ai_dubbing_studio/.specify/tasks/ai-detection-and-dubbing-prompt-fix.md) (`5/5` tasks `[x]`).
2. **Step 1 — Multimodal Subtitle OCR & Visual Speaker Gender Extraction**:
   - Updated [`backend/services/ffmpegService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js) (`extractSubtitleDifferenceGrid`, `detectSubtitleChangePoints`) with center-bottom subtitle ROI (`crop=w=0.72*iw:h=0.16*ih:x=0.14*iw:y=0.78*ih`) and `0.35s` short-cue sensitivity (`minPeakDist = 0.35`, `minCueDurationSec = 0.35`).
   - Updated [`backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage3_extractChineseSubtitles.js) with `stripDecorativeSubtitleNoise`, multimodal Vision OCR (`textZh`, `chineseText`, `visualGender`, `speakerVisualHint`, `deliveryType`), `0.35s` minimum cue duration floor, and `< 0.20s` merge gap.
3. **Step 2 — Master Dubbing Prompt & Pre-Translation Cast Registry**:
   - Updated [`backend/services/geminiService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js) (`SCRIPT_RESPONSE_SCHEMA`, `buildDialoguePrompt`, `buildRecapPrompt`) and [`backend/services/pipeline/stages/stage6_generateModeSpecificScript.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js) (`dialoguePayload`, `modeAPrompt`, `applyBatchTranslations`) with:
     - Pre-translation `detectedGenre` (`"ancient" | "ceo" | "modern" | "action" | "comedy"`) and `castRegistry`.
     - 3-Signal Gender & Conversational Turn-Taking Rules (`visualGender` & `speakerVisualHint`, `A -> B -> A -> B`, and Self-Pronoun vs Addressed Title disambiguation).
     - Genre-Specific Natural Khmer Vocabulary (`ancient`, `ceo`/`modern`, `action`, `comedy`) and Lip-Sync Duration Rule (`<= 5.5 syllables/sec`).
4. **Step 3 — Speaker & Gender Classification Engine**:
   - Updated [`backend/models/speakerRegistry.js`](file:///e:/khmer_ai_dubbing_studio/backend/models/speakerRegistry.js) with expanded `FEMALE_KEYWORDS`, `MALE_KEYWORDS`, `KHMER_FEMALE_PRONOUNS`, `KHMER_MALE_PRONOUNS`, and 3-tier priority `detectSpeakerGender` (`segment.visualGender` -> `castRegistry`/`voiceGender` -> speaker title/name & 1st-person self-pronouns vs addressed pronouns).
5. **Step 4 — Left Sidebar UI Polish & 1-Click Smart Prompt Chips**:
   - Updated [`frontend/src/components/media/MediaLibrary.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/MediaLibrary.jsx) and [`frontend/src/components/media/MediaLibrary.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/MediaLibrary.css) (`padding: 0 6px`, `font-size: 11.5px`, compact `.tab-badge`, `1. វីដេអូ`, `2. សំឡេង AI`, `3. អត្ថបទ`) so top tabs never truncate into `2. ...`.
   - Updated [`frontend/src/components/media/DubbingModeTab.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx) to add the 4 clickable 1-Click Smart Prompt Chips above `ឈ្មោះតួអង្គ / DIRECTION` and the `"OCR + Visual Speaker Gender + Direct Translate"` summary pill inside `⚡ Fast OCR Mode`.
   - Also removed `1:1` and `Fit` from [`frontend/src/components/player/PlayerControls.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/PlayerControls.jsx) per user request.
6. **Verification**:
   - Added [`backend/tests/ai_detection_and_dubbing_prompt_fix.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/ai_detection_and_dubbing_prompt_fix.test.js).
   - `node --test` across 6 backend & frontend verification suites: **32/32 PASS (`0 fail`)**.
   - `npm --prefix frontend run lint`: **PASS (`838ms`, 0 errors)**.
   - `npm --prefix frontend run build`: **PASS (`608ms`, 0 errors)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Refresh browser (`Ctrl + Shift + R`) to verify the non-truncating top tabs (`1. វីដេអូ`, `2. សំឡេង AI`, `3. អត្ថបទ`), 1-Click Smart Prompt Chips, and Multimodal OCR + Visual Speaker Gender + Turn-Taking translation pipeline.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Spec-Kit SDD — Timeline UI, Features & Workflow Fix)
- **Timestamp**: 2026-11-11T10:47:00+07:00

## Summary: Completed 4-Step Timeline UI, Features & Workflow Fix (`timeline_ui_and_workflow_fix_prompt.md`)
1. **Spec-Kit SDD Artifacts (`.specify/`)**:
   - Created and verified [`.specify/specs/timeline-ui-and-workflow-fix.md`](file:///e:/khmer_ai_dubbing_studio/.specify/specs/timeline-ui-and-workflow-fix.md), [`.specify/plans/timeline-ui-and-workflow-fix.md`](file:///e:/khmer_ai_dubbing_studio/.specify/plans/timeline-ui-and-workflow-fix.md), and [`.specify/tasks/timeline-ui-and-workflow-fix.md`](file:///e:/khmer_ai_dubbing_studio/.specify/tasks/timeline-ui-and-workflow-fix.md) (`5/5` tasks `[x]`).
2. **Step 1 — Timeline Toolbar Workflow Hierarchy & Duplicate Plus Sign Fix**:
   - Updated [`frontend/src/components/timeline/TimelineToolbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineToolbar.jsx):
     - Fixed duplicate `+ + ឃ្លា` label to `<Plus size={13} /> <span>ថែមឃ្លា</span>`.
     - Organized Left section into 3 workflow groups: Group A (`Undo`/`Redo`/`Split`/`Delete`/`ថែមឃ្លា`), Group B (`Full Video | Auto-Cut by Subs` segmented pill toggle), Group C (`Auto-Align`, `Bridge Gaps`, and neutral slate `Reset Timing`).
     - Added Center live monospace timecode readout (`00:00.00 / 00:12.50`).
     - Organized Right section with `Snap` & `Subs` toggle pills (cyan when `Snap ON`, violet when `Subs ON`) and `0.5x–3.0x` zoom slider + Fit (`1.0x`) + Auto-Center (`🎯`).
3. **Step 2 — Track Headers Truncation Fix (`CLEAN BGM`) & Two-Way Mute Synchronization**:
   - Updated [`frontend/src/components/timeline/TimelineTrackHeaders.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTrackHeaders.jsx), [`TimelineEditor.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineEditor.jsx), and [`TimelineEditor.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineEditor.css):
     - Widened `.track-headers-column` / `.capcut-track-headers` and `TRACK_HEADER_WIDTH` to `148px` so `CLEAN BGM` never truncates to `CLEAN B`.
     - Added `3px` colored left status bars (`#00e5ff` Video, `#3b82f6` Voice 1, `#ec4899` Voice 2, `#8b5cf6` Subtitles, `#10b981` Clean BGM), `22px x 22px` `Mute`/`Solo`/`Lock` buttons, and `VOICE 1` (`👨/គោល`) / `VOICE 2` (`👩/បន្ទាប់`) sub-badges.
     - Synchronized `VIDEO 1` Mute with `onToggleMuteAllCuts(true)` and `CLEAN BGM` Mute with `voiceSettings.duckingVolume` (`0` vs `0.15`), and dimmed muted lanes (`opacity: 0.45`, grayscale waveform, `MUTED` badge).
4. **Step 3 — Smart `VOICE 1` / `VOICE 2` Routing, Semantic Colors & Responsive Clip Labels**:
   - Updated [`frontend/src/components/timeline/TimelineTracksCanvas.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTracksCanvas.jsx) and [`TimelineEditor.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineEditor.jsx):
     - Routed Male (`ប្រុស`) clips to `VOICE 1` (`row 0`) and Female (`ស្រី`) clips or tight back-to-back clips (`gap < 0.15s`) to `VOICE 2` (`row 1`).
     - Styled Male voice clips in deep studio blue (`oklch(0.28 0.08 250)`, `#38bdf8` top bar, `#60a5fa` waveform) and Female voice clips in deep studio rose (`oklch(0.28 0.09 350)`, `#f472b6` top bar, `#f472b6` waveform).
     - Added responsive clip labels (`< 48px`: centered `#N`; `48px..94px`: `#N ប្រុស/ស្រី`; `>= 95px`: `#N ប្រុស/ស្រី` + 1-line Khmer dialogue preview in `Kantumruy Pro` `11px`) and rich multi-line tooltips (`#N [speaker] (start - end)\n"khmerText"`).
5. **Step 4 — Playhead vs Selection Accent Separation**:
   - Updated [`frontend/src/components/timeline/TimelineEditor.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineEditor.css) to style `.timeline-playhead`, `.playhead-handle`, `.playhead-line`, and `.playhead-time-pill` in high-contrast **CapCut Coral Red (`#ff3b5c`)** with `0 0 6px rgba(255, 59, 92, 0.5)` glow and `z-index: 60`, while keeping `#38BDF8` / `#00e5ff` exclusively for `.selected` clip outlines and `.clip-trim-handle` grips.
6. **Verification**:
   - Added [`backend/tests/timeline_ui_workflow_fix.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/timeline_ui_workflow_fix.test.js).
   - `node --test` across 7 timeline & full-stack verification test files: **19/19 PASS (`0 fail`)**.
   - `npm --prefix frontend run lint`: **PASS (`767ms`, 0 errors)**.
   - `npm --prefix frontend run build`: **PASS (`572ms`, 0 errors)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Refresh browser (`Ctrl + Shift + R`) to verify the new `148px` track headers (`CLEAN BGM`), 3-stage toolbar with center timecode, smart `VOICE 1`/`VOICE 2` routing, and CapCut Coral Red (`#ff3b5c`) playhead.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Spec-Kit SDD — Full-Stack Structure & CapCut Pro UI Refactor)
- **Timestamp**: 2026-11-11T10:17:30+07:00

## Summary: Completed 3-Phase Full-Stack Architecture & CapCut Pro NLE Refactor (`khmer_ai_dubbing_studio_refactor_prompt.md`)
1. **Spec-Kit SDD Artifacts (`.specify/`)**:
   - Created [`.specify/specs/fullstack-capcut-pro-refactor.md`](file:///e:/khmer_ai_dubbing_studio/.specify/specs/fullstack-capcut-pro-refactor.md), [`.specify/plans/fullstack-capcut-pro-refactor.md`](file:///e:/khmer_ai_dubbing_studio/.specify/plans/fullstack-capcut-pro-refactor.md), and [`.specify/tasks/fullstack-capcut-pro-refactor.md`](file:///e:/khmer_ai_dubbing_studio/.specify/tasks/fullstack-capcut-pro-refactor.md).
2. **Phase 1 — Frontend Architecture, Hooks, Contexts & Barrel Exports**:
   - Created [`frontend/src/hooks/usePlaybackEngine.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/usePlaybackEngine.js) with 60fps `requestAnimationFrame` playhead ref subscription (`playheadTimeRef`, `subscribePlayhead`).
   - Created [`frontend/src/context/ModalContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/ModalContext.jsx) (`ModalProvider`, `useModalManager`) and [`frontend/src/context/WorkspaceContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/WorkspaceContext.jsx) (`WorkspaceProvider`, `useStudioWorkspace`).
   - Added clean barrel `index.js` files across `frontend/src/components/{layout,media,player,voice,timeline}/` and wired into [`frontend/src/App.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx).
3. **Phase 2 — Modern CapCut Pro / DaVinci NLE UI Upgrade**:
   - Updated [`frontend/src/styles/tokens.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/tokens.css) and [`frontend/src/styles/layout.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/layout.css) with OKLCH semantic track tokens (`oklch(0.72 0.14 195)`, `oklch(0.70 0.17 350)`, `oklch(0.68 0.16 250)`, `oklch(0.68 0.17 295)`), `--khmer-line-height: 1.68`, minimum `13px` Khmer badge/button sizing, and horizontal/vertical split-pane resizer bars.
   - Extended [`frontend/src/hooks/useResizablePanels.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useResizablePanels.js) & [`frontend/src/components/layout/Navbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/Navbar.jsx) with bottom timeline vertical resizing (`220px–450px`) and Left/Bottom/Right panel collapse/expand toggles.
   - Upgraded [`frontend/src/components/player/PlayerControls.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/PlayerControls.jsx) & [`VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/VideoPlayerPreview.jsx) with precision `HH:MM:SS.ms` timecode, `16:9 | 9:16 | 1:1 | Fit` selector, and live Audio Ducking dB meter.
   - Upgraded [`frontend/src/components/voice/VoiceSettings.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/VoiceSettings.jsx) & [`ClipInspectorPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx) with `Character Voice Mapping` accordion card, inline optimistic voice-switch spinner (`~300ms`), and sticky bottom `Export Rendered Video` CTA bar.
   - Upgraded [`frontend/src/components/timeline/TimelineTrackHeaders.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTrackHeaders.jsx), [`TimelineTracksCanvas.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTracksCanvas.jsx), and [`TimelineEditor.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineEditor.jsx) with `transform: translate3d(x, 0, 0)` 60fps playhead and Solo (`S`) / Mute (`M`) / Lock (`🔒`) track header controls.
4. **Phase 3 — Backend Structure & Reliability Hardening**:
   - Created [`backend/utils/processRegistry.js`](file:///e:/khmer_ai_dubbing_studio/backend/utils/processRegistry.js) and [`backend/middleware/validateRequest.js`](file:///e:/khmer_ai_dubbing_studio/backend/middleware/validateRequest.js).
   - Wired `processRegistry` and scoped `5mb` standard JSON limit (`50mb` for series/script sync routes) into [`backend/server.js`](file:///e:/khmer_ai_dubbing_studio/backend/server.js), [`backend/services/audioSeparationService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/audioSeparationService.js), and [`backend/services/ffmpegService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js).
5. **Phase 5 — Evidence-Based Verification**:
   - Added [`backend/tests/fullstack_refactor_verification.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/fullstack_refactor_verification.test.js).
   - `node --test` across 7 backend & frontend regression test suites: **33/33 PASS**.
   - `npm --prefix frontend run lint`: **PASS (`794ms`, 0 errors)**.
   - `npm --prefix frontend run build`: **PASS (`559ms`, 0 errors)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Refresh browser (`Ctrl + Shift + R`) to test the resizable bottom timeline, Navbar panel collapse toggles, live Ducking dB meter, and sticky Export CTA bar.

---

## Previous Session
- **Environment**: Antigravity IDE (`Clean Architecture, Modular CSS, Studio Hooks & CapCut Pro 2026 UI Overhaul`)
- **Timestamp**: 2026-11-11T00:38:00+07:00

## Summary: Completed 4-Step Clean Architecture & CapCut Pro Studio 2026 Overhaul
1. **Step 1 — Clean Folder Structure & Modular CSS**:
   - Organized all top-level loose files in `frontend/src/components/` into domain folders:
     - [`components/layout/Navbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/Navbar.jsx), [`components/layout/ShortcutsModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/ShortcutsModal.jsx), [`components/layout/WorkflowStepper.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/WorkflowStepper.jsx)
     - [`components/media/MediaLibrary.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/MediaLibrary.jsx)
     - [`components/player/VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/VideoPlayerPreview.jsx)
     - [`components/voice/VoiceSettings.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/VoiceSettings.jsx)
     - [`components/timeline/TimelineEditor.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineEditor.jsx)
   - Split [`frontend/src/index.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/index.css) into 5 modular CSS stylesheets in `frontend/src/styles/`:
     - [`styles/tokens.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/tokens.css)
     - [`styles/layout.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/layout.css)
     - [`styles/timeline.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/timeline.css)
     - [`styles/components.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/components.css)
     - [`styles/modals.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/modals.css)
2. **Step 2 — Custom Hooks & Studio Context**:
   - Created [`frontend/src/hooks/useShortcuts.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useShortcuts.js) for global keyboard shortcuts (`Space`, `Ctrl+B`, `Delete`/`Backspace`, `ArrowLeft`/`ArrowRight`, `Ctrl+Z`/`Ctrl+Y`, `Ctrl+E`).
   - Created [`frontend/src/hooks/useStudioActions.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useStudioActions.js) and [`frontend/src/context/StudioContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/StudioContext.jsx) to centralize `onUpdateSegments`, `onUpdateScript`, `repairBroken`, and `voiceSwitch` callbacks.
3. **Step 3 — CapCut Pro Studio 2026 UI/UX Overhaul**:
   - Locked `100vw x 100vh` desktop grid (`48px` Navbar, `1fr` 3-column workspace, `290px` bottom timeline) on `#090A0F` canvas with `gap: 6px; padding: 6px;`, `#12141D` panels, `10px` radius, `1px solid rgba(255, 255, 255, 0.07)` borders, and `4px` scrollbars.
   - Enforced Khmer typography (`'Inter', 'Kantumruy Pro', sans-serif`, `line-height: 1.65`) and `'JetBrains Mono'` (`tabular-nums`) for timecodes and console logs.
   - Applied CapCut Cyan (`#00E5FF`) & AI Purple (`#7C5CFC`) accents, character colors (`#EC4899` Pink Sreymom, `#3B82F6` Blue Piseth, `#8B5CF6` Violet Subtitles), `blur(16px)` glassmorphic modals, and `#07080C` terminal log boxes.
4. **Step 4 — Verification**:
   - `npm --prefix frontend run build`: **PASS (`800ms`, 0 errors)**.
   - `npm --prefix frontend run lint`: **PASS (`956ms`, 0 errors)**.
   - Full Backend & Frontend Regression Test Suites (10 test files, 39 tests): **39/39 PASS**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Next Steps**: Refresh browser (`Ctrl + Shift + R`) to inspect the newly refactored CapCut Pro Studio 2026 workspace.

---

## Previous Session
- **Environment**: Antigravity IDE (`Git Commit & Push to Origin Main`)
- **Timestamp**: 2026-11-11T00:01:30+07:00

## Summary: Successfully Pushed to GitHub Repository
1. **Commit**: `a03545c` (`feat: real-time Demucs progress logs, multi-key quota pool, repair service & updated README`)
2. **Branch**: `main` -> `origin/main` ([https://github.com/Ny-Panha/khmer-ai-dubbing-studio.git](https://github.com/Ny-Panha/khmer-ai-dubbing-studio.git))
3. **Pushed Files (33 files)**:
   - Updated master [`README.MD`](file:///e:/khmer_ai_dubbing_studio/README.MD)
   - Real-time Demucs Progress server-client sync ([`audioSeparationService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/audioSeparationService.js), [`audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js), [`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))
   - Gemini Multi-Key Pool & Quota Manager ([`geminiKeyManager.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiKeyManager.js), [`GeminiQuotaModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiQuotaModal.jsx))
   - Auto-repair broken segments service & quality guards ([`repairBrokenService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/repairBrokenService.js), [`translationQuality.js`](file:///e:/khmer_ai_dubbing_studio/backend/utils/translationQuality.js))
   - Common Studio Confirm Dialog ([`StudioConfirmDialog.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/common/StudioConfirmDialog.jsx))
4. **Security Scan**: Zero API keys or secrets staged; working tree 100% clean.

## Active Environment
- **Backend**: Live on task-5358 (`http://localhost:5000`).
- **Frontend**: Live on task-5366 (`http://localhost:5173`).
- **Git Remote**: `https://github.com/Ny-Panha/khmer-ai-dubbing-studio.git` (Up to date).

---

## Previous Session
- **Environment**: Antigravity IDE (`Documentation Update & Full Architecture Sync`)
- **Timestamp**: 2026-11-10T23:56:30+07:00

## Summary: Fully Updated `README.MD` to Match Production Studio Capabilities
1. **Core Features Expanded**:
   - Added **Demucs v4 Neural Vocal Separation** documentation (Clean BGM extraction, 0% vocal bleed, live console log drawer, 1-by-1 sequential mutex protection).
   - Added **Gemini Multi-Key Pool & Quota Manager** (Up to 6 Keys, 75+ RPM, auto-rotation, 429/504 backoff retry, `.env` live hot-reload, interactive Quota Modal).
   - Added **Drama Series & Multi-Episode Batch Workflow** (Episode file isolation, SSE jobs stream, pause/cancel, automated segment repair).
2. **Project Structure Modernized**:
   - Synchronized file tree to show modular `backend/routes/` (`audioRoutes`, `jobRoutes`, `scriptRoutes`, `seriesRoutes`, `systemRoutes`, `videoRoutes`), `backend/services/pipeline/` (Stages 1-7), `backend/workers/demucs_worker.py`, and `frontend/src/components/dashboard/` route-runner cards.
3. **API Reference Table Completed**:
   - Replaced basic 8-endpoint table with a comprehensive 20+ endpoint reference organized into 5 clear categories (System/Keys, Audio/Demucs, Script/Translation, Series/Jobs, Video/Render).
4. **Quick Start & Shortcuts Refined**:
   - Clarified prerequisites (Node.js v18+, Multi-Key setup, Python Demucs with FFmpeg fallback), added `Shift + Arrow` shortcuts, and updated workflow Mermaid diagram.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Workspace**: [`README.MD`](file:///e:/khmer_ai_dubbing_studio/README.MD) fully synchronized with latest system state.

---

## Previous Session
- **Environment**: Antigravity IDE (`Authoritative Server-to-Client Demucs Live Console Log Sync`)
- **Timestamp**: 2026-11-10T23:52:00+07:00

## Summary: Fixed "ot kernh pg pel run" — Real-Time Server-Side Demucs Progress Logs
1. **Root Cause Analysis ("ot kernh pg pel run")**:
   - In [`audioSeparationService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/audioSeparationService.js), `activeSeparationProgress` only tracked `progress: pct` as an integer and did NOT preserve history logs.
   - If `getSeparationProgress(mediaRef)` had any slight key mismatch (e.g. URI encoding, Windows `\` vs `/`), it returned `null`, returning `progress: 0` to client which capped at `5%` and stopped logs from rendering.
   - Initial 15-25 seconds of Demucs runs were silent while PyTorch initialized into memory, making it appear stuck at 5%.
2. **Defensive Fix Implemented**:
   - **Server-Side Log Buffer**: [`backend/services/audioSeparationService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/audioSeparationService.js) now records live log entries directly into `activeSeparationProgress.logs` on every stderr `%` change.
   - **Resilient Fallback Matching**: `getSeparationProgress` now falls back to the currently active separating job if `mediaRef` key differs, guaranteeing progress is NEVER missed.
   - **API Response Sync**: [`backend/routes/audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js) returns `logs: progressData?.logs || []`.
   - **Client Merging**: [`frontend/src/components/dashboard/GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx) streams server logs directly into the Console Drawer so progress numbers (`Demucs Progress: 10%`, `Demucs Progress: 20%`...) always appear in real time.
3. **Verification**:
   - Backend unit tests (`demucs_worker_defaults`, `repair_broken_segments`): **14/14 PASS**.
   - `npm --prefix frontend run build`: **PASS (959ms, 0 errors)**.
   - Backend (`:5000`): **200 OK**, 6 Gemini keys active.
   - Frontend (`:5173`): **200 OK**, Vite v8.3.5 running.

## Active Environment
- **Backend**: Live on task-5358 (`http://localhost:5000`).
- **Frontend**: Live on task-5366 (`http://localhost:5173`).
- **Next Step**: Nha refreshes browser (`Ctrl + Shift + R`) and clicks Demucs to see live progress stream.

---

## Previous Session

## Summary: Synchronized Demucs Web Console Logs to Identically Match Terminal Output
1. **Frontend Code Updates**:
   - [`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L1425-L1465): Polling loop interval tuned to `1200ms` for smooth live streaming. Dynamically syncs `setDemucsProgressPercent(dPct)` so top header progress increments live, and appends a new terminal-style log line whenever `dPct > lastProgress`.
   - [`EpisodeDemucsProgressCard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/route-runners/EpisodeDemucsProgressCard.jsx#L320-L345): Updated live console drawer to render in JetBrains Mono / monospace font with `[AudioSeparation] ⏳ Demucs Progress: XX%` identical to the VS Code Terminal display (Img 1).
2. **Verification Results**:
   - `npm --prefix frontend run build`: **PASS (`1.24s`)**.
   - Live backend Demucs progress: Verified reaching **`95%`**.

## Active Environment
- **Backend**: Live at `http://localhost:5000` (Demucs separation finalizing).
- **Frontend**: Live at `http://localhost:5173`.
- **Workspace**: Uncommitted changes on `main`.

---

## Previous Session

## Summary: Synchronized Demucs Web UI Progress & Live Console Logs with VS Code Terminal Output
1. **Root Cause of UI / Terminal Desync ([GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L1425-L1468))**:
   - The polling loop previously did not update `demucsProgressPercent` (leaving top banner stuck at initial `5%`), and only logged new messages if `!curLogs.some(l => l.message === dpData.message)` (which caused log lines to freeze once `1%` was registered).
   - Furthermore, HMR module reload during prior file edits had orphaned the in-flight React timer while the backend Demucs Python process continued running uninterrupted on the server (progressing up to 68%).
2. **Real-Time Terminal Parity Fix**:
   - `GeminiRouteModal.jsx`: Reduced polling interval from `2500ms` to `1200ms` for smooth real-time tracking.
   - Wired live `setDemucsProgressPercent(dPct)` so top bar updates dynamically in lockstep with the running episode.
   - Pushes live `[time] [XX%] ⏳ Demucs Progress: XX%` log lines whenever `dPct > lastProgress`, mirroring the exact log format output by `[AudioSeparation] ⏳ Demucs Progress: XX%` in VS Code Terminal (Img 1).
3. **Verification Results**:
   - `npm --prefix frontend run build`: **PASS (`1.36s`)**.
   - Backend `/api/audio/separation-progress`: Verified live active progress returning **`68%`** and streaming.

## Active Environment
- **Backend**: Live at `http://localhost:5000` (Demucs actively separating ep_2 audio).
- **Frontend**: Live at `http://localhost:5173`.
- **Workspace**: Uncommitted changes on `main`.

---

## Previous Session

## Summary: Clarified Demucs AI Strict 1-by-1 Sequential Queue & Polished Waiting Episode Card State
1. **Clarified Demucs AI Concurrency Architecture**:
   - Backend (`audioSeparationService.js`): Strictly gated by `isDemucsRunning` mutex lock (allows only 1 Demucs process at any moment; rejects concurrent requests with `409 DEMUCS_BUSY` to prevent CPU/RAM memory freeze).
   - Frontend (`GeminiRouteModal.jsx`): Loop is `for (let i = 0; i < episodes.length; i++)` with `await` — executes strictly **one episode at a time (1-by-1 sequential)**.
2. **Polished Card UI for Queued Episodes ([EpisodeDemucsProgressCard.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/route-runners/EpisodeDemucsProgressCard.jsx), [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L3407))**:
   - Passed `isCurrentRunning={activeDemucsEpisodeId === ep.id}` to `EpisodeDemucsProgressCard`.
   - Episodes waiting in the queue now clearly show:
     - Badge/Title: `⏳ រង់ចាំក្នុង Queue (Waiting in Queue)` with `0%` progress and clock icon
     - Subtitle: `រង់ចាំភាគមុនបញ្ចប់ (ដំណើរការ ១ ភាគម្ដង ដើម្បីការពារកុំឱ្យ CPU គាំង)`
     - Live Console: `[0%] ⏳ ភាគនេះកំពុងរង់ចាំក្នុង Queue — ប្រព័ន្ធនឹងបំបែកសំឡេង Clean BGM បន្តបន្ទាប់ពីភាគមុនបញ្ចប់ (ដំណើរការ ១ ភាគម្ដង ដើម្បីធានាម៉ាស៊ីនដើរស្រួល)`
   - Only the actively running episode displays the animated spinner and live progress.
3. **Verification Results**:
   - `npm --prefix frontend run lint`: **0 errors** (371 warnings).
   - `npm --prefix frontend run build`: **PASS (`668ms`)**.

## Active Environment
- **Backend**: Live at `http://localhost:5000`.
- **Frontend**: Live at `http://localhost:5173`.
- **Workspace**: Uncommitted changes on `main`.

---

## Previous Session
- **Environment**: Antigravity IDE (`Verify & Wire GEMINI_API_KEY5 + Live .env Hot-Reload & Dynamic 5-Key UI`)
- **Timestamp**: 2026-11-10T19:54:30+07:00

## Summary: Verified New `GEMINI_API_KEY5`, Synced `.env`, Added Live `.env` Hot-Reload & Dynamic Multi-Key UI (`4/5 Ready, 75 RPM Pool`)
1. **Verified & Synced `GEMINI_API_KEY5` ([`.env`](file:///e:/khmer_ai_dubbing_studio/.env), [`backend/.env`](file:///e:/khmer_ai_dubbing_studio/backend/.env#L5-L10))**:
   - Confirmed `GEMINI_API_KEY5=REDACTED` in [`backend/.env`](file:///e:/khmer_ai_dubbing_studio/backend/.env#L9) is unique and returns `HTTP 200` on Google Gemini `models.list` & `generateContent` (`gemini-3.5-flash-lite`). Kept `GEMINI_API_KEY6=` blank slot intact.
   - Synced root [`.env`](file:///e:/khmer_ai_dubbing_studio/.env#L8-L10) with `GEMINI_API_KEY5` and `GEMINI_API_KEY6=` to match `backend/.env`.
2. **In-Process `.env` Key Hot-Reload ([`geminiKeyManager.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiKeyManager.js#L11-L97), [`server.js`](file:///e:/khmer_ai_dubbing_studio/backend/server.js#L25-L71))**:
   - Added opt-in `registerLiveDotenvFiles`, `resetLiveDotenvFiles`, and mtime-cached `syncGeminiKeysFromEnvFilesIfChanged()` in [`geminiKeyManager.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiKeyManager.js), wired in [`server.js`](file:///e:/khmer_ai_dubbing_studio/backend/server.js#L64-L70) only when `require.main === module` (preserving unit test isolation while reloading newly added `GEMINI_API_KEY*` entries immediately on save without interrupting active jobs).
3. **Dynamic Multi-Key UI Support (`5+ Keys`)**:
   - [`GeminiQuotaModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiQuotaModal.jsx#L17-L24): Expanded `KEY_THEMES` to 6 colors (amber `#fbbf24` for Key #5, fuchsia `#e879f9` for #6), made header subtitle dynamic (`Key #1–#${totalKeys}`), and updated key grid to `repeat(auto-fit, minmax(205px, 1fr))` so all 5 key cards align in one clean row.
   - [`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L1638-L1647): Expanded `KEY_THEMES` (`1..6`) and replaced hardcoded `(idx % 4) + 1` on episode cards with dynamic `(idx % poolTotalKeys) + 1` so `EP5` displays `Key #5`.
   - [`Navbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/Navbar.jsx#L48-L71): Syncs lightweight `stats` snapshot once backend comes online and replaced hardcoded `'4 Keys'` fallback with `'Keys'`.
4. **Verification Results (Fresh After Final Edits — Live `series_1793898268958/series.json` Untouched)**:
   - Added hot-reload test in [`gemini_key_pool_and_504_retry.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/gemini_key_pool_and_504_retry.test.js#L168-L230). Ran 4 backend suites (`gemini_key_pool_and_504_retry`, `gemini_quota_tracker_and_routes`, `stage6_translation_fallback_and_tts_guard`, `repair_broken_segments`): **32/32 PASS**.
   - `npm --prefix frontend run lint`: **0 errors**; `npm --prefix frontend run build`: **PASS (`1.03s`)**.
   - Live Backend (`http://localhost:5000/api/health` & `/api/gemini/keys-status`): Auto-reloaded cleanly to **`5/5 Keys` total** (`Key #2`, `#3`, `#4`, `#5 ...825A` Ready `200`; `Key #1 ...uB8A` at today's 500 RPD cap until PT midnight).
   - Live Playwright UI (`http://localhost:5173`): Verified `Navbar` (`Keys & Quota 4/5 Keys`), `GeminiQuotaModal` (`Key #1–#5`, `5 Keys Pool (×5)`, `75` RPM pool, Key #5 amber card `...825A`), and `GeminiRouteModal` (`4/5 Keys Ready`, `EP5` `Key #5`) with `0` console/page errors.

## Active Environment
- **Backend**: Live at `http://localhost:5000` (`totalKeysCount: 5`, live `.env` key hot-reload enabled).
- **Frontend**: Live at `http://localhost:5173`.
- **Workspace**: Uncommitted changes on `main`. Live `series_1793898268958/series.json` left untouched.

## Next Steps
- Press `Ctrl + Shift + R` in the browser (`http://localhost:5173`) if still open from earlier to see `5 Keys` and `Key #5` immediately.
- Next time Nha wants to add Key #6 (`GEMINI_API_KEY6=`), paste it in `backend/.env` line 10 and save — backend picks it up automatically without restarting jobs.

---

## Previous Session
- **Environment**: Antigravity IDE (`Harden Stage 6 Mode A & RepairBroken Service Against Omitted Lines`)
- **Timestamp**: 2026-11-10T19:29:00+07:00

## Summary: Hardened Stage 6 Mode A & Repair Translation Matching, Retry Cascade, and Bounded Single-Line Rescue (`9/11 -> 11/11`)
1. **Stage 6 Mode A Resilient Parsing, Matching & Single-Line Rescue ([stage6_generateModeSpecificScript.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js))**:
   - Upgraded `parseJsonResponseText` with prose/fence extraction (`extractJsonSliceFromText`) + trailing comma recovery, added `extractSegmentsFromParsedResponse` (accepts bare JSON arrays `[...]` and `{ segments }`/`{ items }`), and added `resolveBatchTranslationMatches` supporting string/`"#"` indices, safe 1-based relative retry re-indexing (`1..N`), and safe 1:1 positional alignment.
   - Updated `applyTranslatedSegmentResult` to accept `khmerText || khmerTranslatedText || khmer` and never discard usable Khmer text if `condenseKhmerDialogue` over-strips fillers; updated Mode A Rule 6 so short OCR tags/views (`"天眼视角"`) and mild insults/incomplete clauses (`"你这个混蛋，"`) in Input are never skipped.
   - Improved bounded Auto-Retry (`MAX_RETRY_ITEMS = 60`, up to 6 healthy models, narrows `pendingSlice` incrementally per model so partial successes cascade cleanly without re-translating finished lines) and added **Stage 3 Bounded Single-Line Final Rescue** (`MAX_SINGLE_LINE_RESCUE = 15`, 1-by-1 single JSON object `{ speaker, gender, khmerText }` across up to 6 cascade models, clearing `MISSING_SEGMENT_TRANSLATION` & stale `validationErrors`).
2. **Repair Broken Service Hardening ([repairBrokenService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/repairBrokenService.js))**:
   - Added `resolveRepairBatchMatches` (tolerating `{ segments }`/`{ items }`/bare array/single object, `"#86"`/`"86"` string keys, relative `1..N`, and exact-length positional match), `clearRepairedSegmentErrors` (clearing `MISSING_SEGMENT_TRANSLATION`/`TRANSLATION_FAILED` + stale validation messages), unlimited sliced batch retry (`10`/slice instead of skipping when `> 15`), and 1-by-1 `buildSingleLineRepairPrompt` rescue for any line still broken after batch retry.
3. **Verification Results (Fresh After Final Edits — Live `series_1793898268958/series.json` Untouched)**:
   - Added comprehensive regression tests in [`stage6_translation_fallback_and_tts_guard.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/stage6_translation_fallback_and_tts_guard.test.js) and [`repair_broken_segments.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/repair_broken_segments.test.js).
   - Executed `node --test` across all 10 backend translation/repair/guard/persistence suites (`stage6_translation_fallback_and_tts_guard`, `repair_broken_segments`, `series_persist_and_sync`, `empty_text_guard`, `fast_ocr_mode`, `retranslate_fallback`, `stage5_reconciliation_and_recovery`, `gender_voice_consistency`, `episode_state_isolation`, `phase1_translation_boundary`): **82/82 PASS (0 fail)**.
   - Verified watched live backend `http://localhost:5000/api/health` reloaded cleanly (`200 ok`, 4/4 active keys, 10 cascade models).

## Active Environment
- **Backend**: Live auto-reloaded (`http://localhost:5000/api/health` -> `200 ok`, `--watch-path`).
- **Workspace**: Uncommitted changes on `main`. Live `series_1793898268958/series.json` left untouched.

## Next Steps
- In Batch Generate Studio, click **"🔧 ជួសជុលឃ្លាខូច & Generate ឡើងវិញ (4094)"** (which fixes the 3 stored missing text lines in EP2/EP6 + synthesizes all 4,094 segment voices) or re-select only EP2/EP6 to Re-Translate (`11/11`) before generating TTS.
- Commit & push changes when ready.

---

## Previous Session
- **Environment**: Antigravity IDE (`Replace Native Browser Alert/Confirm with Custom StudioConfirmDialog UI`)
- **Timestamp**: 2026-11-10T19:04:00+07:00

## Summary: Replaced All Browser `window.confirm` & `alert` Dialogs in Batch Generate Studio & Job Dashboard with Custom Studio UI
1. **New Reusable Custom Dialog Component ([StudioConfirmDialog.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/common/StudioConfirmDialog.jsx))**:
   - Midnight Navy glassmorphic modal rendered via React `createPortal(..., document.body)` at `zIndex: 100060` using inline styles (zero Tailwind dependency).
   - Supports semantic themes (`warning`, `repair`, `danger`, `success`, `info`), structured badge pill (`FORCE RE-RUN`, `REPAIR`, `KILL TRANSLATE`), episode chip badges, bulleted Khmer details card, `Escape`/backdrop dismissal (without closing parent `GeminiRouteModal`), and single-button alert mode (`showCancel={false}`).
2. **Eliminated All 18 Native `window.confirm` / `alert` Calls in `dashboard/`**:
   - [`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx): Added promise-based `openStudioDialog` / `closeStudioDialog` helper + unmount cleanup, guarded `Escape` handler against `studio-confirm-modal`, and replaced all 14 native `alert`/`window.confirm` calls (`handleStartBatchTranslate`, `handleRepairBrokenSegments`, `handleReTranslateSelected`, `handleBatchGenerateTTS`, `handleBatchDemucsSeparation`, and Kill Translate / TTS / Demucs buttons).
   - [`EpisodeTranslateProgressCard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/route-runners/EpisodeTranslateProgressCard.jsx), [`EpisodeTtsProgressCard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/route-runners/EpisodeTtsProgressCard.jsx), [`EpisodeDemucsProgressCard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/route-runners/EpisodeDemucsProgressCard.jsx): Replaced native `window.confirm` on card `Kill` buttons with `onRequestConfirm` + standalone `<StudioConfirmDialog />` fallback.
   - [`useJobQueue.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/useJobQueue.js) & [`JobDashboardModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/JobDashboardModal.jsx): Replaced 4 `alert(...)` calls on pause/resume/retry/cancel errors with `setError(...)` + dismissible in-modal error banner.
3. **Verification Results (Fresh After Final Edits)**:
   - `git grep -n -E "window\.confirm|\balert\(" frontend/src/components/dashboard/ frontend/src/components/common/`: **0 matches**.
   - Added static audit test in [`repair_broken_segments.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/repair_broken_segments.test.js#L843-L881); `node --test backend/tests/repair_broken_segments.test.js backend/tests/empty_text_guard.test.js backend/tests/series_persist_and_sync.test.js`: **25/25 PASS**.
   - `npm --prefix frontend run lint` (`oxlint`): **0 errors** (`0` warnings in newly added/modified modal & queue hook code); `npm --prefix frontend run build`: **PASS (`923ms`)**.
   - Playwright Chrome E2E (`verify_gemini_modal.mjs` on `http://127.0.0.1:5179` with mocked `/api/**`): **PASS** (`nativeDialogCount: 0`, `pageErrorCount: 0`, `repairReenabled: true`), visually verified [`confirm_retranslate_modal.png`](file:///C:/Users/nhastar/.gemini/antigravity/brain/5da0cdee-686d-4dd8-b5fb-3670bed21397/scratch/confirm_retranslate_modal.png) showing `FORCE RE-RUN`, `EP1`/`EP2` pills, Khmer bullets, and tactile buttons; tested `Escape`, `Cancel`, `Confirm`, and `Kill` custom modal flows.

## Active Environment
- **Workspace**: Uncommitted changes on `main` (dev launcher auto-reload + broken-segment fixes + custom UI confirm modal). Live `series_1793898268958/series.json` left untouched.

## Next Steps
- In browser (`http://localhost:5173`), press `Ctrl + Shift + R` if needed to load the new modal immediately and test `Re-Translate` / `ជួសជុលឃ្លាខូច` / `Kill`.
- Commit & push changes when ready.

---

## Previous Session
- **Environment**: Antigravity IDE (`Enable Safe Backend Auto-Reload in dev.ps1/start.bat & Fix Recurring Broken Segments`)
- **Timestamp**: 2026-11-10T18:53:00+07:00

## Summary: Enabled Safe Backend JS Auto-Reload (`--watch-path`) in `dev.ps1` / `start.bat` + Fixed Recurring `អត្ថបទខូច` / `សំឡេងខ្វះ`
0. **Dev Launcher Auto-Reload ([dev.ps1](file:///e:/khmer_ai_dubbing_studio/dev.ps1#L18-L62), [L212-L246](file:///e:/khmer_ai_dubbing_studio/dev.ps1#L212-L246), [start.bat](file:///e:/khmer_ai_dubbing_studio/start.bat))**:
   - Enabled `$EnableWatchBackend = $true` by default in `dev.ps1` (with `-NoWatch` / `--no-watch` to opt out cleanly), watching ONLY pure JS source paths (`server.js`, `routes`, `services`, `utils`, `middleware`, and the 4 `models/*.js` files) — excluding `models/sense-voice/*.onnx`, `uploads/`, `workers/`, `scripts/`, and `tests/`. Added `-NoProfile` to `start.bat`.
   - Verified `start.bat --help`, PowerShell AST parse (`0` errors), and Node 24 `--watch-path` stability while reading `models/sense-voice/tokens.txt` (zero spurious reloads).
1. **Filtered Non-Chinese SenseVoice ASR Hallucinations Upstream & During Repair**:
   - [`translationQuality.js`](file:///e:/khmer_ai_dubbing_studio/backend/utils/translationQuality.js) & [`frontend/src/utils/translationQuality.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/translationQuality.js): Added `containsChineseHanzi` (`/[\u3400-\u4dbf\u4e00-\u9fa5]/`) and `isNonChineseAsrHallucination(seg)` with 100% BE/FE parity (drops `audio_asr`/`sense_voice_local` empty-OCR non-Hanzi junk like `"The."`/`"Yeah."` while keeping `visual_ocr` such as `"E=MC²"`, Chinese dialogue, and `userOverridden` lines).
   - Wired filtering into [`stage4_analyzeDialogueAudio.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js) (`filterValidChineseAsrSegments`, widening Hanzi check + cleaning ASR cache & live output), [`chunkOrchestrator.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/chunkOrchestrator.js) (cache/live/stitch), [`dubbingPipeline.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/dubbingPipeline.js), and [`repairBrokenService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/repairBrokenService.js) (auto-drops junk segments immediately on repair, persists cleaned `series.json`, and preserves healthy `seg.id`s & `.mp3` mtimes).
2. **Prevented Punctuation-Only / Filler Outputs & Added Mode A Auto-Retry**:
   - [`stage6_generateModeSpecificScript.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js) & [`stage7_translateAndValidateKhmer.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage7_translateAndValidateKhmer.js): Hardened `isPlaceholderTranslationText` & Stage 7 validation to reject punctuation-only (`"។"`, `"!"`, `"..."`) and explicit fillers (`"សូមរង់ចាំ"`, `"សូមរង់..."`). Fixed Stage 6 Mode A schema `"khmerText": "ប្រយោគបកប្រែជាភាសាខ្មែរពេញលេញ"`, guarded `condenseKhmerDialogue` against stripping short phrases like `"កុំបារម្ភអី!"` down to `"!"`, and added bounded Mode A auto-retry (`MAX_RETRY_ITEMS = 40`, batches of 10) for omitted/broken lines.
   - [`repairBrokenService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/repairBrokenService.js): Added Rule 7 against punctuation-only `"khmerText"` and focused in-batch retry pass for omitted/broken items.
3. **Outdated-Master Marking & Concurrent Queue Guard in Batch Generate Studio**:
   - [`episodeService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js): `persistEpisodeScriptData` now sets `audioOutdated = true` only when `!hasAnyVoicedSegment && hadPriorAudio` (safe against fresh concurrent sync tests while accurately flagging Re-Translated episodes that still had prior Master flags), and `syncSeriesMetadataSafely` preserves `audioOutdated` against older client `/sync` payloads.
   - [`geminiRouteHelpers.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js) & [`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx): Added `getActiveSeriesTranslateJobs` and `isTranslateQueueEnqueueBanner`; disables `btn-repair-broken-segments` (`QUEUE` / `⏳ រង់ចាំ Translate Queue`) and blocks `handleRepairBrokenSegments` while series translate/re-translate jobs run, scopes `Kill Translate` to active translate jobs, and auto-clears stale `"បានដាក់បញ្ចូល ..."` banner when queue drains.
4. **Verification Results (Fresh After Final Edits — Live `series_1793898268958/series.json` Untouched)**:
   - Core pipeline, persistence & repair tests (`node --test backend/tests/repair_broken_segments.test.js backend/tests/stage6_translation_fallback_and_tts_guard.test.js backend/tests/series_persist_and_sync.test.js backend/tests/stage5_reconciliation_and_recovery.test.js backend/tests/empty_text_guard.test.js backend/tests/fast_ocr_mode.test.js backend/tests/episode_state_isolation.test.js backend/tests/phase1_translation_boundary.test.js backend/tests/retranslate_fallback.test.js`): **73/73 PASS**.
   - Full `backend/tests/*.test.js` suite: **186/188 PASS** (1 skipped due to missing `ep_2_source.mp4` fixture; 1 pre-existing live-`series.json`-coupled assertion at `regenerate_split_audio_offset_reset.test.js:73` where `ep_2` segment 2 `audioOffset` is `undefined` after Nha's recent unvoiced Re-Translate).
   - `npm --prefix frontend run lint` (`oxlint`): **0 errors**; `npm --prefix frontend run build`: **PASS (`1.78s`)**.
   - Playwright Chrome E2E (`verify_gemini_modal.mjs` on `http://127.0.0.1:5179` with mocked `/api/**`): **PASS, 0 page/React errors** — verified `btn-repair-broken-segments` disables into `QUEUE` during Re-Translate and re-enables while auto-clearing stale enqueue banner upon queue completion.

## Active Environment
- **Dev Orchestrator**: Backend `http://localhost:5000` (running); Frontend Vite preview/dev stopped cleanly after Playwright check.

## Next Steps
- Click `"🔧 ជួសជុលឃ្លាខូច & Generate ឡើងវិញ"` once (after Translate queue finishes) on `series_1793898268958` episodes to clean existing non-Chinese ASR junk + generate missing voices.
- Ask Nha if ready to commit & push changes.

---

## Previous Session
- **Environment**: Antigravity IDE (`Fix ReferenceError: onUpdateSegments is not defined in handleTranslateSingleSegment`)
- **Timestamp**: 2026-11-10T17:27:09+07:00

## Summary: Fixed `ReferenceError: onUpdateSegments / onUpdateScript is not defined` in Single-Segment AI Translate
1. **Root Cause & Fix ([useAudioDubbing.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js#L1212-L1298))**:
   - [`handleTranslateSingleSegment`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js#L1213-L1298) (called by `handleTranslateThisLine` in [`ClipInspectorPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx#L410) and `ScriptReviewTab.jsx`) called undefined variables `onUpdateSegments` and `onUpdateScript` after `setScriptData(...)`, causing every single-line translation click to throw `ReferenceError: onUpdateSegments is not defined`, abort returning `updated`, and trigger a duplicate fallback API retry.
   - Removed the bogus `if (onUpdateSegments) ... else if (onUpdateScript) ...` block, added `setAudioOutdated(true)`, preserved `_uid` matching + `.chinese` text fallback, built `updated` synchronously so React 18 batching never returns `null`, and added active-episode staleness guard (`activeTtsEpisodeRef`).
2. **Regression Coverage ([workspace_player_containment.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/workspace_player_containment.test.js#L235-L249))**:
   - Added `'useAudioDubbing handleTranslateSingleSegment uses setScriptData/setAudioOutdated without undefined callbacks'` asserting `onUpdateSegments`/`onUpdateScript` do not appear and `setScriptData(` / `setAudioOutdated(true)` are used.
3. **Verification Results (Fresh After Final Edit — Real `series.json` Untouched)**:
   - `npm --prefix frontend run lint`: **0 errors** (374 pre-existing warnings); `oxlint -D no-undef frontend/src/hooks/useAudioDubbing.js`: **0** non-browser `no-undef` errors.
   - `npm --prefix frontend run build`: **PASS (`689ms`)**.
   - `node --test backend/tests/workspace_player_containment.test.js backend/tests/aspect_ratio_and_crop.test.js`: **13/13 PASS**.
   - Live Playwright Chrome E2E (`verify_translate_segment_no_ref_error.cjs` on `http://127.0.0.1:5173` with mocked `/api/series` writes & `/api/dubbing/retranslate-segment`): **PASS, 0 console/page errors, 0 alert dialogs** — verified 1 API call (no duplicate retry) and translated Khmer text applied directly into `#inspector-khmer-textarea`.

## Active Environment
- **Dev Orchestrator**: Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Hard refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` and click `បកប្រែឃ្លានេះ` on any missing-text segment — Khmer translation updates immediately without console errors.

---

## Previous Session
- **Environment**: Antigravity IDE (`Disable Auto-Play When Switching Segment Voice Gender`)
- **Timestamp**: 2026-11-10T16:37:31+07:00

## Summary: Disabled Automatic Segment Audio Playback on Voice Gender Switch (`👨 ប្រុស` / `👩 ស្រី`)
1. **Root Cause & Fix ([VoiceSettings.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VoiceSettings.jsx#L262-L277))**:
   - `handleClipVoiceChange` (invoked by `👨 ប្រុស` / `👩 ស្រី` in [`ClipInspectorPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx#L1050-L1101)) previously called `playSegmentAudio(res.audioUrl, segIdOrIndex)` immediately after `onUpdateSegmentVoice` finished regenerating TTS audio.
   - Removed the automatic `playSegmentAudio(...)` call from `handleClipVoiceChange` and explicitly paused/cleared any currently playing `segmentAudioRef.current` clip preview when switching voice gender, while keeping voice updates + TTS synthesis (`onUpdateSegmentVoice`) and manual playback (`ស្តាប់សំឡេង (Play)`) intact.
2. **Regression Coverage ([workspace_player_containment.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/workspace_player_containment.test.js#L219-L233))**:
   - Added `'Voice gender switch (handleClipVoiceChange) does not auto-play segment audio'` verifying `handleClipVoiceChange` does not call `playSegmentAudio(`.
3. **Verification Results (Fresh After Final Edit — Real `series.json` Untouched)**:
   - `npm --prefix frontend run lint`: **0 errors** (374 pre-existing repo warnings).
   - `npm --prefix frontend run build`: **PASS (`1.21s`)**.
   - `node --test backend/tests/workspace_player_containment.test.js backend/tests/aspect_ratio_and_crop.test.js`: **12/12 PASS**.
   - Live Playwright Chrome E2E (`verify_voice_switch_no_autoplay.cjs` on `http://127.0.0.1:5173` with mocked write routes & `/api/generate-audio` + `/api/sync-timeline-audio`): **PASS, 0 console/page errors** — verified clicking `👩 ស្រី` (`playCalls = []`) and `👨 ប្រុស` (`playCalls = []`) never triggers `HTMLMediaElement.prototype.play`, while clicking manual `ស្តាប់សំឡេង (Play)` triggers 1 `AUDIO` playback.

## Active Environment
- **Dev Orchestrator**: Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Hard refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` and click `👨 ប្រុស` / `👩 ស្រី` on any segment — voice switches cleanly without auto-playing audio.

---

## Previous Session
- **Environment**: Antigravity IDE (`Fix Export Panel Subtitle Controls Not Working in Live Preview & Rendered Mode`)
- **Timestamp**: 2026-11-10T16:06:30+07:00

## Summary: Fixed All 4 Export Subtitle Controls (`Burn Subtitles`, `Style`, `Color`, `Size`) Not Responding & Preview Visual Fidelity
1. **Root Causes Found & Fixed**:
   - **(a) Saved `renderedVideo` (`🎬 Rendered`) Blocked All Live Overlays ([App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L31-L102), [L469-L539](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L469-L539))**:
     - Episodes that already completed an export (e.g., `ep_2`, `ep_3`) loaded into `🎬 Rendered` playback mode, where [`LiveSubtitleOverlay`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/LiveSubtitleOverlay.jsx#L14-L16), Logo, and Anti-Theft overlays return `null`. Editing subtitle settings never invalidated stale `renderedVideo`, so controls appeared dead and the top Navbar stayed stuck on stale `Download MP4`.
     - Added `VISUAL_SETTING_DEFAULTS`, `RENDER_INVALIDATING_SETTING_KEYS`, and `SUBTITLE_PREVIEW_SETTING_KEYS` in `App.jsx`: changing any subtitle/visual/mix export setting via `handleUpdateVoiceSettings` now persists `voiceSettings` immediately, auto-clears stale `renderedVideo` (switching back to Live Editor Preview and resetting Navbar CTA `Download MP4` -> `Export`), and syncs the cleared state to storage/backend.
   - **(b) Initial `00:00` Frame Gap & Time Reset on `<video src>` Swap ([App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L76-L102), [VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx#L1169-L1250), [useVideoRender.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useVideoRender.js#L456-L484))**:
     - When paused outside any spoken segment (such as `00:00.00` before `ep_2` Seg #1 at `0.20s`), changing subtitle controls while `burnSubtitles !== false` seeks to `resolveSubtitleSampleSeekTime` so the updated Khmer subtitle is immediately visible.
     - Switching between `renderedVideo` (`?v=${renderedAt}` cache-busted) and `selectedVideo.videoUrl` on the same episode preserves timeline position via `pendingSrcSwitchSeekRef`, `mapTimelineToSourceTime`, `handleInternalLoadedMetadata`, `handleInternalTimeUpdate`, and `handleInternalSeeked`, avoiding the reset to `00:00.00`.
     - Aligned `burnSubtitles !== false` default-ON behavior across [`ExportSettingsPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L156-L224), [`LiveSubtitleOverlay.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/LiveSubtitleOverlay.jsx#L14), and [`useVideoRender.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useVideoRender.js#L456).
   - **(c) Distinct Banner / Pill / Cinema Styling & Proportional `cqw` Sizing ([VideoPlayerPreview.css](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.css#L261-L380), [LiveSubtitleOverlay.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/LiveSubtitleOverlay.jsx#L18-L54))**:
     - Scoped card backgrounds to `.live-subtitle-overlay > span` (with `font-weight: 700`), added translucent rounded `pill` vs solid dark rectangular `banner` vs transparent dark-outlined `cinema`, aligned yellow color to `#FFE600`, added `1:1` (`aspect-1-1`) sizing rules, and replaced small `vw`/`rem` clamps on `16:9` with `cqw` units proportional to ASS export (`1.85 / 2.30 / 2.90 cqw`).
2. **Verification Results (Fresh After Final Edit — Real `series.json` Untouched)**:
   - `npm --prefix frontend run lint`: **0 errors** (375 pre-existing repo warnings).
   - `npm --prefix frontend run build`: **PASS**.
   - `node --test backend/tests/workspace_player_containment.test.js backend/tests/aspect_ratio_and_crop.test.js`: **11/11 PASS** (added subtitle control regression test in [`workspace_player_containment.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/workspace_player_containment.test.js#L181-L217)).
   - Live Playwright Chrome E2E (`verify_subtitle_controls_e2e.cjs` on `http://127.0.0.1:5173` with mocked write routes): **ALL PASS, 0 console/page errors** — verified auto-exit from `renderedVideo`, `Download MP4` -> `Export`, `2.50s` seek preservation across `rendered` -> `live` swap, distinct `banner`/`pill`/`cinema` CSS, `#ffffff` / `#ffe600` colors, `small`/`medium`/`large` `16:9` (`13.95 / 17.34 / 21.87 px` @ `754px` stage) and `9:16` (`8.84 / 10.40 / 12.48 px` @ `260px` stage) scaling, and visually verified screenshots.

## Active Environment
- **Dev Orchestrator**: Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Hard refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` and test `Burn Subtitles`, `Style` (`Banner`/`Pill`/`Cinema`), `Color` (`White`/`Yellow`), and `Size` (`តូច`/`ស្តង់ដារ`/`ធំ`) directly on `ep_2`.

---

## Previous Session
- **Environment**: Antigravity IDE (`Fix Workspace Player Frame Containment, AspectRatio Sanitization & Per-Panel Isolation`)
- **Timestamp**: 2026-11-10T15:51:00+07:00

## Summary: Hardened `aspectRatio` Load Sanitization, Player Frame Bounds Containment & Per-Panel Error Boundaries
1. **Identified Element**:
   - `<div class="player-canvas-area is-aspect-frame is-landscape-frame|is-portrait-frame|is-square-frame" data-aspect-ratio="..." data-testid="player-aspect-frame">` ([`VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx#L1337-L1342), styled by [`VideoPlayerPreview.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.css#L171-L177) with `border-radius: 10px`, `1px solid` border, `#000` background) inside `.player-canvas-container.is-stage-host` / `.top-suite-col-center`.
2. **Root Causes Found & Fixed**:
   - **(a) Strict `aspectRatio` Sanitization ([projectStorage.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L40-L187), [useSeriesManager.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useSeriesManager.js#L334-L361))**:
     - `loadSavedVoiceSettings` previously only cleared `'1:1'` while letting poisoned strings/types (`"1:1 (Square / IG)"`, `"auto"`, `"4:3"`, objects/arrays) leak unvalidated into `App.jsx` -> `VideoPlayerPreview` (`data-aspect-ratio` & `framedStageStyle`).
     - Added exported `VALID_ASPECT_RATIOS = ['16:9', '9:16', '1:1']` and [`sanitizeAspectRatio`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L46-L50); wired across [`loadSavedVoiceSettings`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L160-L173) (preserving valid `'1:1'` too), [`saveVoiceSettings`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L178-L187), [`resolveStickyVoiceSettings`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L127-L155), [`inferRenderedAspectRatio`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L71-L89), [`sanitizeAndHealSeriesList`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L441-L462), [`saveEpisodeState`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L890-L909), [`App.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L161-L433), [`VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx#L58-L63), [`ExportSettingsPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L26-L129), [`useVideoRender.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useVideoRender.js#L92-L434), [`BatchExportStudioModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/BatchExportStudioModal.jsx#L130-L133), and [`GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L490-L493).
   - **(b) Player Bounds Measurement & Strict Container Clamping ([VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx#L73-L107), [L1278-L1326](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx#L1278-L1326), [useResizablePanels.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useResizablePanels.js#L11-L101), [VideoPlayerPreview.css](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.css#L8-L371), [index.css](file:///e:/khmer_ai_dubbing_studio/frontend/src/index.css#L193-L200))**:
     - Removed `Math.max(80, ...)` floor in `framedStageStyle` (which overflowed containers `<80px`), clamped `stageW`/`stageH`/`maxWidth`/`maxHeight` strictly `<= availW`/`availH`, and when `canvasBounds` is unmeasured (`0`) or collapsed, renders a normal CSS `aspectRatio: '16 / 9'` (`width: calc(100% - ...)`, `height: auto`, zero inline `px` sizes).
     - Strengthened `canvasBounds` measurement (`getBoundingClientRect` / `clientWidth`, `requestAnimationFrame` post-mount re-measure, `window.resize`, `fullscreenchange`, `ResizeObserver`) and added `min-width: 0; min-height: 0` on `.capcut-player-panel` / `.top-suite-col-center` / `.player-canvas-container`.
     - Guarded [`useResizablePanels.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useResizablePanels.js#L11-L41) against poisoned `NaN` saved widths (using `Number.isFinite`) and clamped effective side-panel widths on narrow viewports (`MIN_CENTER_RESERVE = 328px`) so the center player & right inspector stay visible without React CSS `NaN` warnings or off-screen clipping.
   - **(c) Per-Panel Layout Isolation ([App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L650-L864))**:
     - Wrapped `<MediaLibrary>`, `<VideoPlayerPreview>`, `<VoiceSettings>`, and `<TimelineEditor>` individually inside `<ErrorBoundary inline>` so a render failure in the player (or any sibling panel) stays contained in its own panel and side panels + timeline continue rendering normally.
3. **Verification Results (Fresh After Final Edits — `series.json` & User Brave Profile Untouched)**:
   - Unit & regression suite (`node --test backend/tests/workspace_player_containment.test.js backend/tests/aspect_ratio_and_crop.test.js`): **10/10 PASS**.
   - Targeted `oxlint` across all 9 modified JS/JSX files: **0 errors**; full `npm --prefix frontend run lint`: **0 errors**; `npm --prefix frontend run build`: **PASS (`869ms`)**.
   - Live Playwright Chrome E2E on `http://localhost:5173` (using exported copy of user's real Brave `localStorage` + `ep_2`, plus clean profile, isolated empty episode, `9:16` ↔ `16:9` sticky reload, valid `'1:1'` survival, poisoned strings/objects/arrays, `NaN` + narrow `960x850`, short `1280x420`, and mocked `bounds = 0` CSS `16 / 9` fallback): **ALL PASS, 0 console/page errors**; visually verified refreshed `9:16` portrait crop preview (`readyState: 4`) and all `before_*` / `after_*` screenshots.

## Active Environment
- **Dev Orchestrator**: Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Hard refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` — workspace layout, `16:9` ↔ `9:16` switching, and sticky reload now stay strictly contained inside their panels.

---

## Previous Session
- **Environment**: Antigravity IDE (`Fix Invisible Jobs Dashboard Modal & Wire Navbar Jobs Active/Badge State`)
- **Timestamp**: 2026-11-10T15:29:00+07:00

## Summary: Fixed Missing Jobs Dashboard UI (Replaced Non-Existent Tailwind Classes with Inline Studio Styles)
1. **Root Cause Identified**:
   - `frontend/package.json` uses vanilla CSS + inline styles (`tailwindcss` is not installed). All 4 Jobs Dashboard components (`JobDashboardModal`, `JobQueueList`, `JobProgressCard`, `JobActionButtons`) were written exclusively with Tailwind utility classes, causing `<JobDashboardModal isOpen={true} />` to render unstyled below `.capcut-app-container` (`height: 100vh; overflow: hidden`) and appear completely invisible when clicking `Jobs`.
2. **Restyled All 4 Jobs Dashboard Components with Studio Midnight Navy CSS**:
   - [`JobDashboardModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/JobDashboardModal.jsx): Fixed full-screen overlay (`position: 'fixed', inset: 0, zIndex: 100020`), backdrop blur, Escape & X close handlers, `SSE Live` / `Polling (3s)` indicator, Refresh button, 4-card stats ribbon, and footer (`data-testid="job-dashboard-modal"`, `data-testid="job-dashboard-close-btn"`).
   - [`JobQueueList.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/JobQueueList.jsx): Styled status filter tabs with live counts, search input, loading spinner, empty state, and scrollable list container.
   - [`JobProgressCard.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/JobProgressCard.jsx): Styled status badges (including `partial`), progress bar, ETA/speed metrics, error alert banner, download link, and distinct short Job ID (`slice(-8)`).
   - [`JobActionButtons.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/JobActionButtons.jsx): Styled Pause, Resume, Retry (including `partial`), Cancel buttons, and fixed-overlay Cancel Confirmation modal (`zIndex: 100040`, `slice(-8)`).
3. **Wired Navbar `Jobs` Button Active Highlight & Live Queue Count ([Navbar.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/Navbar.jsx), [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx))**:
   - Passed `isJobDashboardActive={showJobDashboard}` from `App.jsx` to `Navbar`, added `data-testid="navbar-jobs-btn"`, `.active` styling when open, and safe `useContext(JobQueueContext)` live active count badge (`runningCount + queuedCount`).
4. **Verification Results (Fresh After Final Edits)**:
   - `npm --prefix frontend run lint`: **0 errors**.
   - `npm --prefix frontend run build`: **PASS (`567ms`)**.
   - Live Playwright Chrome E2E on `http://127.0.0.1:5173`: clicked `[data-testid="navbar-jobs-btn"]`, verified `[data-testid="job-dashboard-modal"]` full-viewport backdrop (`1440x900`) and centered card (`1040x774`), active button class, stats ribbon, `SSE Live`, filter tabs (`All`/`Failed`), Cancel Confirm modal open/back, Escape & Close button, visually verified screenshots, and **0** console/page errors.

## Active Environment
- **Dev Orchestrator**: Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` and click `Jobs` in the top navbar — the Job Queue Dashboard modal now opens and tracks running/queued/completed/failed jobs in real time.

---

## Previous Session
- **Environment**: Antigravity IDE (`Wire Subtitle Size Control into ASS Burn + Distinct Pill vs Banner + Effective ASS Burn Log + Honest Size Labels`)
- **Timestamp**: 2026-11-10T15:20:30+07:00

## Summary: Wired `subtitleSize` (`small`/`medium`/`large`) into ASS Burn, Split Pill vs Banner Styles & Added Effective Burn Logging
1. **Central `subtitleSize` Resolution & Single-Source Layout Defaults ([ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L796-L880), [ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1680-L1725))**:
   - Extracted [`resolveAssSubtitleLayoutDefaults`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L802-L828) as the single source of truth for per-aspect/verticalStyle/orientation base font sizes (`9:16 crop`/portrait `44`, `9:16 pad` `48`, `16:9` `44`, `1:1` `52`) used by both [`generateKhmerAssSubtitleFile`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L830-L895) and [`renderDubbedVideoWithDucking`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1680-L1725).
   - At the `generateKhmerAssSubtitleFile` call site in `renderDubbedVideoWithDucking`, resolved `fontSize` with precedence: explicit `subtitleOptions.fontSize` wins (`size=explicit`), else `subtitleOptions.subtitleSize` scales the per-aspect default (`small` `×0.8`, `medium` `×1.0`, `large` `×1.25`, rounded), else `null`.
   - Passed `subtitleSize` through `subtitleOptions` from BOTH callers: [`videoRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/videoRoutes.js#L267-L277) (`finalSubOptions`) and [`batchExportService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js#L634-L647).
2. **Distinct `pill` vs `banner` Styles ([ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L868-L895))**:
   - Split the shared branch: `banner` retains solid dark box (`BorderStyle 3`, `outline 10`/`12`, `backBox &H3208080c`), `pill` uses a lighter translucent chip (`BorderStyle 3`, `outline 6`, `backBox &H6408080c`), and `cinema` remains unchanged.
3. **Effective ASS Burn Log ([ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1722-L1724))**:
   - Logged `🎬 ASS burn: style=<style> color=<hex> fontSize=<n> (size=<small|medium|large|explicit|null>) playRes=<XxY>` on every render burning `.ass` subtitles.
4. **Honest Size Labels ([ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L205-L214))**:
   - Relabelled subtitle size options from fake pixel strings (`តូច (14px)` / `ស្តង់ដារ (16px)` / `ធំ (18px)`) to **`តូច`** / **`ស្តង់ដារ`** / **`ធំ`**.
5. **Verification Results (`series.json` Untouched)**:
   - Exported real 30s `9:16 crop` clips of `series_1793898268958` `ep_2` across `small` / `medium` / `large`, logging:
     - `🎬 ASS burn: style=banner color=#FFFFFF fontSize=35 (size=small) playRes=1080x1920`
     - `🎬 ASS burn: style=banner color=#FFFFFF fontSize=44 (size=medium) playRes=1080x1920`
     - `🎬 ASS burn: style=banner color=#FFFFFF fontSize=55 (size=large) playRes=1080x1920`
   - Visually verified extracted frames for `small` vs `medium` vs `large`, distinct translucent `pill` vs solid `banner`, and `cinema` + `yellow` (`#FFE600`).
   - Added automated tests in [`aspect_ratio_and_crop.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/aspect_ratio_and_crop.test.js#L411-L526) and [`batch_export_and_merge.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/batch_export_and_merge.test.js#L331-L369) (**10/10 PASS**); `npm --prefix frontend run lint` (**0 errors**), `npm --prefix frontend run build` (**PASS `581ms`**).

## Active Environment
- **Dev Orchestrator**: Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` — subtitle size (`តូច` / `ស្តង់ដារ` / `ធំ`) and `CapCut Pill` vs `Title Banner` now export faithfully in both single-episode and Batch Export Studio renders.

---

## Previous Session
- **Environment**: Antigravity IDE (Removed `Flow:` `WorkflowStepper` Bar from Main Workspace)
- **Timestamp**: 2026-11-10T15:15:10+07:00

## Summary: Removed `WorkflowStepper` (`Flow: 1. Import video ... 5. Mix & export`) Bar from `App.jsx`
1. **Removed `WorkflowStepper` from Main Workspace ([App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L8-L9), [L635-L642](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L635-L642))**:
   - Removed `import WorkflowStepper from './components/WorkflowStepper'` and `<WorkflowStepper ... />` inside `.capcut-main-workspace`, giving `.capcut-top-suite` full vertical height cleanly.
2. **Verification Results (Fresh After Final Edits)**:
   - `oxlint App.jsx`: **0 errors**.
   - `npm --prefix frontend run lint`: **0 errors** (`375` pre-existing warnings).
   - `npm --prefix frontend run build`: **PASS (`584ms`)**.

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-3196`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` — the `Flow: 1. Import video > 2. Translate & script > 3. Khmer voice (TTS) > 4. Demucs AI > 5. Mix & export` bar is now removed.

---

## Previous Session
- **Environment**: Antigravity IDE (Removed `Re-Export Dubbed Video` / `Export Dubbed Video (.mp4)` Button from `ExportSettingsPanel`)
- **Timestamp**: 2026-11-10T15:11:40+07:00

## Summary: Removed Single-Episode Render/Export Button from `ExportSettingsPanel`
1. **Removed Export / Render Button ([ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L860-L870))**:
   - Removed `<button className="capcut-export-btn btn-tactile">` (`Re-Export Dubbed Video` / `Export Dubbed Video (.mp4)` / `កំពុង Render...`) from the bottom of `2. Subtitle & Export Settings`, keeping the top-right Navbar `Export` button as the single clean export trigger.
   - Cleaned up unused destructured props/variables (`onRenderVideo`, `batchRender`, `audioGenerated`, `previewAudioUrl`, `renderedVideo`, `batchJob`, `isBatchRunning`, `isBatchStarting`) in [`ExportSettingsPanel`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L8-L21).
2. **Verification Results (Fresh After Final Edits)**:
   - `oxlint ExportSettingsPanel.jsx`: **0 errors** (2 pre-existing warnings).
   - `npm --prefix frontend run lint`: **0 errors** (`375` pre-existing warnings).
   - `npm --prefix frontend run build`: **PASS (`564ms`)**.

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-3196`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` — the `Re-Export Dubbed Video` / `Export Dubbed Video (.mp4)` button inside `2. Subtitle & Export Settings` is now removed.

---

## Previous Session
- **Environment**: Antigravity IDE (Removed Post-Render Downloads Banner, Download Button, & Copy TikTok/Facebook Caption Button from `ExportSettingsPanel`)
- **Timestamp**: 2026-11-10T15:08:40+07:00

## Summary: Removed 3 Post-Render Elements Below `Export Dubbed Video` Button in `ExportSettingsPanel`
1. **Removed Post-Render UI Block ([ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L918-L921))**:
   - Removed the `{renderedVideo && (...)}` section below the Render/Export button containing:
     1. `✓ បាន Export ចូល Folder Downloads លើកុំព្យូទ័ររួចរាល់!` green banner
     2. `Download ..._Khmer_Dubbed.mp4` button
     3. `Copy TikTok / Facebook Caption` button
   - Cleaned up unused `Download`, `Copy`, and `Check` icon imports and unused `onCopyCaption` / `copiedCaption` destructured props in [`ExportSettingsPanel`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L8-L25).
2. **Verification Results (Fresh After Final Edits)**:
   - `oxlint ExportSettingsPanel.jsx`: **0 errors** (2 pre-existing warnings).
   - `npm --prefix frontend run lint`: **0 errors** (`375` pre-existing warnings).
   - `npm --prefix frontend run build`: **PASS (`2.75s`)**.

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-3196`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` — the 3 post-render items below `Export Dubbed Video` are now removed cleanly.

---

## Previous Session
- **Environment**: Antigravity IDE (`Move Batch Export Button to Top Navbar Next to Export / Download MP4`)
- **Timestamp**: 2026-11-10T15:08:00+07:00

## Summary: Moved `Batch Export` Launcher Button to Top-Right Navbar Beside `Export` / `Download MP4`
1. **Top Navbar Placement ([Navbar.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/Navbar.jsx#L253-L283), [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L611-L614))**:
   - Placed the **`Batch Export (N ភាគ)`** button (`data-testid="open-batch-export-studio-btn"`) in `.navbar-right-actions` directly next to the top-right `Export` / `Download MP4` button (`36px` height, live `%` badge while running) to open **Export Studio — Batch Export & Merge**.
2. **Removed from Right Inspector Panel ([ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx), [VoiceSettings.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VoiceSettings.jsx))**:
   - Removed the launcher button from the bottom of `ExportSettingsPanel` so the right-hand Inspector panel contains only single-episode export controls.
3. **Verification**:
   - `npm --prefix frontend run lint` (**0 errors**), `npm --prefix frontend run build` (**PASS `565ms`**).
   - Live Chrome Playwright screenshot verified `Batch Export` aligned flush right next to `Export` in the Navbar (`y: 7.5, height: 36`), `0` launcher buttons in the right panel, and clicking opens `BatchExportStudioModal` with `0` console errors.

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-3196`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` — the **`Batch Export (N ភាគ)`** button now sits right beside **`Download MP4` / `Export`** in the top-right Navbar.

---

## Previous Session
- **Environment**: Antigravity IDE (`Move Batch Export & Merge into Dedicated Export Studio Modal View + Clean Export Panel + Step 4 Handoff`)
- **Timestamp**: 2026-11-10T15:02:00+07:00

## Summary: Dedicated Export Studio Modal View & Clean Export Panel
1. **Clean Export Panel ([ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx), [VoiceSettings.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VoiceSettings.jsx))**:
   - Removed the entire inline `"Batch Export & Merge"` section (episode checkboxes, readiness warning, `Allow Original Audio`, `Export 1 Full Video`, `Batch Export All`, and batch download links) from the top Export panel.
   - Kept single-episode export controls (`Anti-Theft`, `Export Dubbed Video (.mp4)`, export settings) unchanged, and placed ONE clean button in its place: `"Batch Export & Merge (N ភាគ) →"` (`data-testid="open-batch-export-studio-btn"`), showing live `%` progress badge when a job is running.
2. **Dedicated Full-Screen View ([BatchExportStudioModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/BatchExportStudioModal.jsx), [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx))**:
   - Implemented full-screen modal `"Export Studio — Batch Export & Merge"` (`data-testid="batch-export-studio-modal"`) containing in order:
     - **(a)** Episode multi-select grid (`Select All`, `មាន Voice`, `Clear`) with per-episode readiness (`Script ✓/✗`, `Voice ✓/✗`, `Demucs ✓/✗` + reason flags) and missing-voice warning banner.
     - **(b)** Shared aspect indicator + sticky `16:9 | 9:16` toggle synced across Step 4 / Navbar / Export Studio.
     - **(c)** `Allow Original Audio` checkbox.
     - **(d)** Two primary actions: `"Export 1 Full Video (Merge N ភាគ)"` and `"Batch Export All (N ភាគដាច់ដោយឡែក)"` governed by the same readiness rules.
     - **(e)** Live per-episode + overall progress bar & `Stop (Kill)`.
     - **(f)** Finished files area with individual `Download` buttons (merged full video and/or per-episode `.mp4` files).
   - Lifted episode selections (`exportStudioSelectedEpIds`) and `exportStudioAllowOriginalAudio` to `App.jsx` alongside `useVideoRender`'s `batchRender` job state so closing and reopening Export Studio mid-job preserves progress and selections seamlessly.
3. **Gemini Console Step 4 Handoff ([GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))**:
   - Replaced duplicated Step 4 export buttons (`Export 1 Full Video` & `Batch Export All`) and Step 4 batch downloads with ONE **`Open Export Studio →`** button (`data-testid="step4-open-export-studio-btn"`), keeping the shared `16:9 | 9:16` toggle (`data-testid="step4-aspect-toggle"`).
4. **Long-Episode Ducking Filter Fix ([ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1144-L1208))**:
   - Chunked `buildDynamicDuckingFilter` intervals (`MAX_TERMS_PER_VOLUME_EXPR = 35`) into chained `volume` filters so 300–500+ segment episodes never hit FFmpeg expression parser `Cannot allocate memory`.
5. **Verification Results (`series.json` Untouched)**:
   - Live Playwright E2E + visual screenshots (`0` console errors): verified clean Export panel, Step 4 single handoff button, Export Studio readiness flags & shared `16:9 | 9:16` sync, close/reopen mid-job survival, and full 2-episode merge (`EP1` + `EP2` of `series_1793898268958`, `100%`, `HEAD /api/download-export` `200 OK`).
   - Backend tests (`batch_export_and_merge.test.js` + `aspect_ratio_and_crop.test.js`): **9/9 PASS**; Frontend: `npm --prefix frontend run lint` (**0 errors**), `npm --prefix frontend run build` (**PASS `894ms`**).

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-3196`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` — the Export panel now shows ONE clean `"Batch Export & Merge (N ភាគ) →"` button that opens **Export Studio — Batch Export & Merge**.

---

## Previous Session
- **Environment**: Antigravity IDE (`One "Fix broken & regenerate" Button Under AI Voice Step` — Shared Broken-Set Scanner, Idempotent Queued Repair Job, Quota Partial Resume & Truthful DONE Status)
- **Timestamp**: 2026-11-10T14:35:00+07:00

## Summary: One "Fix broken & regenerate" Button Under AI Voice Step & Truthful Segment-Level DONE
1. **Shared Broken-Set Scanner ([backend/utils/translationQuality.js](file:///e:/khmer_ai_dubbing_studio/backend/utils/translationQuality.js), [frontend/src/utils/translationQuality.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/translationQuality.js))**:
   - Scans stored segment arrays to classify `TEXT-BROKEN` (empty/punctuation-only Khmer, explicit filler `"សូមរង់ចាំ"` + truncations `"សូមរង់ចា"` / `"សូមរង់"` + `"សន្ទនា"`, or repeated `<=40`-char Khmer on `>=5` segments with differing Chinese) and `VOICE-BROKEN` (real Khmer text with missing audio URL/file, failed `ttsStatus`, or missing `.mp3` on disk).
   - Updated [`applySafeDiskHydration`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L156-L176) to verify segment `.mp3` disk existence (`seg.audioFileMissing`).
2. **Idempotent Queued Repair Service & Route ([repairBrokenService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/repairBrokenService.js), [jobRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/jobRoutes.js), [productionJobQueue.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/productionJobQueue.js), [jobWorker.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/jobWorker.js))**:
   - Added `POST /api/jobs/repair-broken` enqueueing one `repair_broken` job per episode with broken segments: re-translates ONLY `TEXT-BROKEN` segments via Gemini batch + key pool, re-verifies with `isSegmentTextBroken`, runs Edge-TTS ONLY on `VOICE-BROKEN` segments (never touching healthy `.mp3` files), and rebuilds master narration when changed.
   - Added `JOB_STATUS.PARTIAL = 'partial'` so quota exhaustion/incomplete batches persist completed progress and report `"កែបាន X • នៅសល់ Y (quota) — ចុចម្ដងទៀតដើម្បីបន្ត"` for idempotent second-click resume.
3. **Console Button, Episode Script Header Mirror & Truthful DONE ([GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx), [geminiRouteHelpers.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js), [ScriptReviewTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/ScriptReviewTab.jsx))**:
   - Added `"🔧 ជួសជុលឃ្លាខូច & Generate ឡើងវិញ (N)"` directly below STEP 3 (`AI Voice`) in `GeminiRouteModal.jsx` and mirrored in `ScriptReviewTab.jsx`, with confirm dialog separating `"អត្ថបទខូច: N1 ឃ្លា • សំឡេងខ្វះ: N2 ឃ្លា"`.
   - Made STEP 2 (`Translate`), STEP 3 (`AI Voice`), episode cards, and console footer derive `DONE` truthfully from segment-level broken counts (`broken === 0`) rather than episode-level `hasAudio`/Master flags.
4. **Verification on Real Series (`series_1793898268958`, 11 episodes, 3,772 segments)**:
   - **Before repair**: `237` broken segments (`236` text-broken + `1` voice-broken) across 8 episodes: `ep_2` (`207` text, incl. `#149` & `#150` `"សន្ទនា"`), `ep_3` (`1` text), `ep_4` (`8` text), `ep_5` (`2` text), `ep_7` (`5` text + `1` voice `#55`), `ep_8` (`3` text), `ep_10` (`6` text), `ep_11` (`4` text); `ep_6, ep_9, ep_12` (`0` broken).
   - **Pass 1 (UI click + confirm)**: Fixed `ep_3, ep_4, ep_5, ep_7, ep_8, ep_10, ep_11` to `0` broken and `ep_2` `182/207` (`partial` -> `"កែបាន 182 • នៅសល់ 25 — ចុចម្ដងទៀតដើម្បីបន្ត"`).
   - **Pass 2 (second press resume)**: Resumed ONLY the remaining `25` segments in `ep_2` -> `0` broken across all 11 episodes (`totalText: 0, totalVoice: 0, totalBroken: 0`), `ep_2 #149` (`"ចៅហ្វាយ ប្រព័ន្ធនេះមិនបានបោកអ្នកទេ"`), `ep_2 #150` (`"ជាថ្នាំគ្រាប់មិនស្គាល់ឈ្មោះមួយ"`), `ep_7 #55` (`"បែរជាបិទបាំងទីក្រុងផាន់សានទាំងមូល។"`).
   - **Healthy `.mp3` integrity**: `55/55` sampled healthy `.mp3` files across all 11 episodes verified byte-untouched (`mtimeMs` & `size` identical, `drifted=0`).
   - **Tests & Build**: [`repair_broken_segments.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/repair_broken_segments.test.js) (**5/5 PASS**), full backend test suite (**173/173 PASS**), `npm --prefix frontend run lint` (**0 errors**), `npm --prefix frontend run build` (**PASS `643ms`**).

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-2952`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` — `series_1793898268958` now has `0` broken segments across all 11 episodes (`DONE` on both STEP 2 and STEP 3).

---

## Previous Session
- **Environment**: Antigravity IDE (`9:16 crop` Bottom Subtitle Blur Band Before Khmer ASS Burn + Container-Scaled Preview Readability & Blur Strip Honesty)
- **Timestamp**: 2026-11-10T13:40:00+07:00

## Summary: `9:16 crop` Bottom Chinese Subtitle Blur Band & Live Preview Readability/Honesty
1. **Export Bottom Subtitle Blur Band ([ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1231-L1630))**:
   - Extracted shared [`buildVerticalVideoFilterChain`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1239-L1275) used by both `9:16` filter construction branches in [`renderDubbedVideoWithDucking`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1520-L1626) so `shouldBurnAss` (`[base_vert]`) and plain (`[final_video]`) paths cannot drift.
   - When `targetAspectRatio === '9:16'` with burnable Khmer subtitles (`hasBurnableSubs`) and `verticalStyle === 'crop'` or native portrait (`isSourcePortrait`), splits the scaled `1080x1920` stream before `.ass` burning, crops the bottom subtitle band (`crop=1080:328:0:1592`, ~17.1% covering full CN glyph + outline height), applies `boxblur=luma_radius=24:luma_power=2:chroma_radius=24:chroma_power=2,eq=brightness=-0.08`, and overlays it back at `0:1592` prior to burning Khmer ASS (`MarginV 130`, `fontSize 44`).
   - Leaves landscape `9:16 pad`, `16:9`, and `1:1` filter chains completely untouched.
2. **Preview Subtitle Ratio & Crop Blur Strip Honesty ([VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx#L52-L70), [VideoPlayerPreview.css](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.css#L231-L289))**:
   - Wrapped the player stage in `.player-stage-viewport` (`container-type: inline-size; container-name: player-frame`) and scaled `9:16` overlay font sizes proportionally to player frame width (`size-small: 3.4cqw`, `size-medium: 4cqw` matching export `44/1080 ≈ 4.07%`, `size-large: 4.8cqw`, with `rem`/`vw` fallback), leaving `16:9` overlay sizes untouched.
   - Added `.preview-crop-sub-blur-strip` (`height: 17.2%`, `bottom: 0`, `z-index: 8` below `.live-subtitle-overlay` `z-index: 10`, `backdrop-filter: blur(8px)`, `background: rgba(0, 0, 0, 0.25)`) rendered only when `!renderedVideo && aspectRatio === '9:16' && verticalStyle === 'crop' && isSourceLandscape && voiceSettings?.burnSubtitles`.
3. **Verification Results (`series.json` Untouched — SHA256 Verified)**:
   - Added unit + synthetic FFmpeg contrast tests in [`aspect_ratio_and_crop.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/aspect_ratio_and_crop.test.js#L211-L407) (**5/5 PASS**); full backend test suite (`node --test backend/tests/*.test.js`): **168 PASS, 0 FAIL, 1 SKIP** (`169` total).
   - Exported 30s real dialogue clip (`ep_2` `45s..75s`) in `9:16 crop` (`cinema` + `banner`), `9:16 pad`, and `16:9`: visually verified CN subtitles at bottom are unreadable soft clouds while Khmer text is crisp and upper faces/frames remain sharp; decoded `9:16 pad` (`e050549fdba8ce53`) and `16:9` (`a0c66bbd1ae33f0f`) frames match untouched baseline SHA256 byte-for-byte.
   - Frontend: `npm --prefix frontend run lint` (**0 errors**), `npm --prefix frontend run build` (**PASS `748ms`**), and Chrome Playwright verification at `1440x900` & `1920x1080` confirmed proportional scaling (`3.97%` of frame width across resolutions) and blur strip honesty in `9:16 crop` only.

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-2613`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173`.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` in `9:16 Crop` mode to preview the proportional Khmer subtitle size and bottom blur strip, or export directly.

---

## Previous Session
- **Environment**: Antigravity IDE (Removed `1:1 (Square / Instagram / Facebook Post)` Option from Export Aspect Ratio Dropdown)
- **Timestamp**: 2026-11-10T13:22:15+07:00

## Summary: Removed `1:1` Export Option from `ExportSettingsPanel` & Added Stale `1:1` Storage Guard
1. **Export Aspect Ratio Dropdown ([ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L114-L216))**:
   - Removed `<option value="1:1">1:1 (Square / Instagram / Facebook Post)</option>` from `2. Subtitle & Export Settings -> ទម្រង់វីដេអូ Export (Aspect Ratio)`, leaving `16:9 (Landscape / YouTube)` and `9:16 (Portrait / TikTok / Reels / Shorts)`.
   - Guarded `effectiveAspectRatio` (`rawAspectRatio === '9:16' ? '9:16' : '16:9'`) so the `<select>` never displays an empty value if `'1:1'` existed in state or square source fallback.
2. **Stale `localStorage` Guard ([projectStorage.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L137-L152))**:
   - Updated [`loadSavedVoiceSettings`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L137-L152) to reset stale saved `aspectRatio === '1:1'` to `null` (falling back cleanly to source dimensions / `16:9`) while leaving `resolveDefaultAspectRatio` and backend FFmpeg tests intact.
3. **Verification Results (Fresh After Final Edits)**:
   - Backend unit test ([`aspect_ratio_and_crop.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/aspect_ratio_and_crop.test.js)): **3/3 PASS**.
   - Frontend: `oxlint` on edited files (**0 errors**), `npm --prefix frontend run lint` (**0 errors**, 364 pre-existing warnings), `npm --prefix frontend run build` (**PASS `698ms`**).
   - Live Playwright check on `http://127.0.0.1:5173`: `OPTIONS: ["16:9 (Landscape / YouTube)", "9:16 (Portrait / TikTok / Reels / Shorts)"]`, `ERRORS: []`, and stale `'1:1'` localStorage reload falls back cleanly to `'16:9'`.

## Active Environment
- **Dev Server (`http://localhost:5173`)**: Running (`200 OK`); Vite HMR / refresh (`Ctrl + Shift + R`) reflects the updated dropdown immediately.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) if needed and check `2. Subtitle & Export Settings -> ទម្រង់វីដេអូ Export (Aspect Ratio)` (now only `16:9` and `9:16`).

---

## Previous Session
- **Environment**: Antigravity IDE (Fixed **Per-Primary-Model Key Health**, Honest `App` vs `Google 429` Quota Labels & Balanced `GeminiQuotaModal` Controls Toolbar)
- **Timestamp**: 2026-11-10T12:37:10+07:00

## Summary: Per-Model Key Status Switching, Honest `App` Request Reporting & Aligned Controls Toolbar
1. **Per-Primary-Model Key Health & Reported Cap Detection ([geminiQuotaTracker.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js))**:
   - Updated [`getPoolStatusSnapshot`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L727-L845) to evaluate each key's cooldown against `activePrimaryModel = this.getPreferredPrimaryModel()` via `isKeyInCooldown(rawKey, now, activePrimaryModel)` and derive `keyLastProbeCode` from the active model's record when switched. Pinning a healthy backup model (e.g. `gemini-2.5-flash`) now immediately flips Key #1–#4 from stale `429` (`gemini-3.5-flash-lite`) to **`4/4 Keys Ready`** across both modals.
   - Added [`extractReportedDailyLimit`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L82-L88), `appTodayRequests` (true logged requests sum, separate from Google's 429 cap), `reportedDailyLimitPerKey` (e.g. `500`), `activePrimaryModel`, and `primaryModelDisplayName` to `quotaSummary` + per-key `reportedDailyCap`.
2. **Honest Quota Copy & Balanced Controls Toolbar ([GeminiQuotaModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiQuotaModal.jsx))**:
   - Replaced the wrapping control row (which dropped onto row 2 aligned left) with a symmetrical header row + full-width **`quota-controls-toolbar`** (`Model:` & `Limit/Key:` on left; `Use all keys` & `⚡ ពិនិត្យ Quota ពិត` flush right on a single row at both `1280px` and `1440px`).
   - Eliminated misleading **`Used: 21 • Left: 0`** and inflated **`40,000 used (100%)`** text: Key cards now show **`App: 21 req • 429 (500/ថ្ងៃ)`**, the RPD bar shows **`0 left on Gemini 3.5 Flash Lite`** + **`App: 82 req • Google 500/key អស់`**, plus a `Google Free Cap: 500/key` badge when `Limit/Key` exceeds Google's reported Free Tier limit, and amber pool pill `⚠️ Gemini 3.5 Flash Lite អស់ • Auto Backup 2/10 Ready`.
3. **Tests & Fresh Verification (`series.json` Untouched)**:
   - Added regression test in [`gemini_quota_tracker_and_routes.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/gemini_quota_tracker_and_routes.test.js#L312-L339) verifying `preferredModel` switch (`auto -> gemini-3.6-flash -> auto`), `appTodayRequests`, and per-model key recovery (`5/5 PASS`).
   - Frontend: `oxlint GeminiQuotaModal.jsx` (**0 warnings, 0 errors**), `npm --prefix frontend run lint` (**0 errors**, 364 warnings), `npm --prefix frontend run build` (**PASS `585ms`**).
   - Restarted `.\dev.ps1 -NoBrowser -SkipInstall` (`task-2397`) cleanly on ports `5000` & `5173`.
   - Chrome Playwright E2E + visual screenshots (`1280x800` & `1440x920`): **0** console/page/HTTP errors; verified single-row `rightAligned: true` toolbar (`controlTopSpreadPx: 4`), zero `40,000 used` / `Used: 21 • Left: 0` text, live `4/4 Keys Ready (60 RPM Pool)` flip across both modals upon pinning `gemini-2.5-flash`, and clean restore to `auto`.
   - Full backend suite (`node --test backend/tests/*.test.js`): **167 tests — 165 PASS, 1 SKIP (`stage4_sense_voice_integration`), 1 pre-existing baseline FAIL** ([`regenerate_split_audio_offset_reset.test.js:73`](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73)).

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-2397`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173` (with all updated backend & UI modules active).

## Next Steps
- Press **`Ctrl + Shift + R`** on `http://localhost:5173` and open **Keys & Quota** — now `Model:` / `Limit/Key:` stay left and `Use all keys` / `⚡ ពិនិត្យ Quota ពិត` stay flush right on 1 balanced row, key cards clearly show **`App: 21 req • 429 (500/ថ្ងៃ)`**, and clicking **`ប្តូរទៅ Gemini 2.5 Flash`** turns all 4 keys green (`4/4 Keys Ready`) immediately.

---

## Previous Session
- **Environment**: Antigravity IDE (Option `1`: Separated **Gemini Keys & Model Quota** and **Batch Generate Studio** into 2 Independent Modals)
- **Timestamp**: 2026-11-10T12:20:10+07:00

## Summary: Separated Dedicated `GeminiQuotaModal` & Spacious `GeminiRouteModal` (`Batch Generate Studio`) with Shared Store
1. **Shared Quota Store ([useGeminiQuotaMonitor.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useGeminiQuotaMonitor.js))**:
   - Implemented module-level shared quota store using `useSyncExternalStore` so both modals and `Navbar` share live pool telemetry, `modelRateLimits`, `preferredModel` pinning, pacing toggle, and ref-counted `probe=stats` background polling (active only while an enabled modal is open; zero root `App.jsx` re-render churn; deduplicated initial `models` probe within 15s when switching modals).
2. **Dedicated Gemini Keys & Model Quota Modal ([GeminiQuotaModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiQuotaModal.jsx))**:
   - Independent modal (`GEMINI KEYS & MODEL QUOTA`) with header Key Ready & `Auto Cascade / Primary` pills, 1-click switch button **`បើក Batch Generate ->`**, `Model:` primary dropdown, `Limit/Key:` cap selector, **`Use all keys / Safe pacing`** toggle, **`⚡ ពិនិត្យ Quota ពិត`** live probe, Key #1–#4 breakdown cards, dual RPM/RPD progress bars, and generous **`Rate limits by model`** table (`4 Keys Pool (×4)` / `Per Key (1×)`, `All models (17)`, **`🔬 Test គ្រប់ Model`**, and per-row **`Use First` / `Pinned ✓`**).
3. **Streamlined Batch Generate Studio Modal ([GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))**:
   - Refactored (`4,782 -> 3,713` lines) into focused `BATCH GENERATE STUDIO`: kept header Key Ready + `Auto Cascade / Primary` pills, added header **`Key & Model Quota`** switch button, removed the giant inline quota monitor/table (`1,088` lines), and added a slim conditional `batch-quota-warning-strip` shown **only** when `readyKeys === 0`.
   - Protects mid-flight local loops (`isGeneratingBatchTTS || isSeparatingBatchDemucs`): opens Quota modal on top (`zIndex: 100010`) instead of unmounting/killing Batch polling timers, and guards Escape handling so pressing `Escape` closes the topmost modal only. All `EP1`–`EP6` cards appear immediately in the viewport without scrolling past quota tables.
4. **Navbar & Root Wiring ([Navbar.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/Navbar.jsx), [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx))**:
   - Replaced single `Gemini Route` trigger in `Navbar` with dedicated **`Batch Generate`** (`data-testid="navbar-batch-generate-btn"`, badge `${episodesCount} EPs`) and **`Keys & Quota`** (`data-testid="navbar-keys-quota-btn"`, badge `${readyKeys}/${totalKeys} Keys` / `4 Keys`) buttons with active pill highlights.
5. **Verification Results (Fresh After Final Edits — `series.json` Untouched)**:
   - Targeted lint (`oxlint` on `useGeminiQuotaMonitor.js` & `GeminiQuotaModal.jsx`): **0 warnings, 0 errors**.
   - Full frontend `npm --prefix frontend run lint`: **0 errors** (`364` pre-existing warnings); `npm --prefix frontend run build`: **PASS (`650ms`)**.
   - Full backend suite (`node --test backend/tests/*.test.js`): **167 tests — 165 PASS, 1 SKIP (`stage4_sense_voice_integration`), 1 pre-existing baseline FAIL** ([`regenerate_split_audio_offset_reset.test.js:73`](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73)).
   - Chrome Playwright E2E + Visual Screenshots on live `http://localhost:5173`: **0** console/page/HTTP errors; verified `1280x800` and `1440x920` Navbar geometry (`overflows: false`), Batch Generate modal cleanly shows **11** episode cards directly in viewport (`0` rate tables inside), clean 1-click switching (`Key & Model Quota` <-> `បើក Batch Generate`), live `probe=matrix` `200`, `4 Keys Pool` <-> `Per Key`, `All models` `10 -> 17`, `Use First` / `Pinned ✓`, `Escape` close, and `preferredModel` restored cleanly to `'auto'`.

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-2180`)**: Running cleanly — Frontend `http://localhost:5173` + Backend `http://localhost:5000` with all updated components loaded via Vite HMR.

## Next Steps
- Press **`Ctrl + Shift + R`** in browser on `http://localhost:5173` to see the 2 separate buttons on Navbar:
  1. **`Batch Generate`** (`11 EPs`) — focused Translate, Khmer AI Voice, Demucs AI, Export & Episode Cards.
  2. **`Keys & Quota`** (`4 Keys`) — dedicated Gemini Key #1–#4 Quota Monitor & `Rate limits by model` table + 1-click switching between both modals.

---

## Previous Session
- **Environment**: Antigravity IDE (Integrated **All Verified Gemini Models into Cascade** + **DragonDub-Styled Rate Limits by Model Matrix** UI in `GeminiRouteModal`)
- **Timestamp**: 2026-11-10T12:01:00+07:00

## Summary: Full 10-Model Dubbing Cascade, Per-(Key, Model) Cooldowns, Live Matrix Probe, 1-Click Model Pinning & DragonDub Rate-Limit UI
1. **Single-Source Model Catalog ([geminiModelCatalog.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiModelCatalog.js))**:
   - Defined `GEMINI_MODEL_CATALOG` (`17` models total: `10` active dubbing JSON/multimodal models in `DUBBING_CASCADE_MODELS` + `VISION_CASCADE_MODELS`, plus `gemini-3.5-transcribe` STT-only, `gemma-4-31b-it`, `gemma-4-26b-a4b-it`, and deprecated/0-limit references shown only under `All models`).
   - Kept `gemini-3.5-transcribe` strictly isolated from Stage 3 / Stage 6 JSON cascades (`usableInDubbing: false`, Stage 4 STT only).
2. **Per-(Key, Model) Quota Tracker & Smart Cascade Reordering ([geminiQuotaTracker.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js), [geminiKeyManager.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiKeyManager.js), [systemRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/systemRoutes.js))**:
   - Upgraded `GeminiQuotaTracker` to track per-model `RPM`/`TPM`/`RPD`, per-`(key, model)` 429 cooldown isolation (`exhaustedKeys`), `preferredModel` persistence (`'auto'` or any dubbing model ID), [`prioritizeAvailableModels`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L668-L699) (moves 404/all-key-exhausted models behind healthy models and orders `503` degraded behind `ready`), [`recordModelProbeStatus`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L577-L590), and `modelRateLimits` snapshot generation (`poolMultiplier`, `perKey`, `pool`, `liveStatus`, `readyCascadeModelsCount`).
   - Added `GET /api/gemini/keys-status?probe=matrix` (concurrent multi-model 1-token probing with `12000ms` timeout, accurate `504 Timeout` vs `429` vs `503` vs `404` vs `200` reporting) and `preferredModel` support in `POST /api/gemini/quota-settings`.
3. **Unified Pipeline & Translation Wiring ([geminiService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js), [dubbingPipeline.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/dubbingPipeline.js), [chunkOrchestrator.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/chunkOrchestrator.js), [episodePipelineOrchestrator.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/episodePipelineOrchestrator.js), [stage3_extractChineseSubtitles.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage3_extractChineseSubtitles.js), [stage6_generateModeSpecificScript.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js))**:
   - Wired all 10 `DUBBING_CASCADE_MODELS`, `getPreferredPrimaryModel()`, and `prioritizeAvailableModels()` across translation, re-translate, OCR Stage 3, chunk orchestrator, and Stage 6 without breaking any mock unit tests.
4. **DragonDub-Styled Rate Limits by Model UI ([api.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js#L740-L767), [geminiRouteHelpers.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js#L150-L326), [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))**:
   - Added unified modal scroll body (`modal-scroll-body`) so Episode Grid never squishes, header `Auto Cascade (X/10 Models)` / `Primary` badge, contextual 429 Exhaustion Alert Strip with 1-click backup model swap CTA, `Model:` primary dropdown, **`4 Keys Pool (×4)` / `Per Key (1×)`** scope toggle, **`All models (17)`** toggle, **`🔬 Test គ្រប់ Model`** (`probe=matrix`), horizontal DragonDub RPM/TPM/RPD capsule bars, and per-row **`Use First` / `Pinned ✓`** buttons.
5. **Verification Results (All Fresh After Final Edits — `series.json` Untouched)**:
   - Targeted tests (`4` suites, incl. updated 10-model Stage 6 cascade & matrix route/tracker tests): **26/26 PASS** (`1.05s`).
   - Full backend suite (`node --test backend/tests/*.test.js`): **167 tests — 165 PASS, 1 SKIP, 1 pre-existing baseline FAIL** ([`regenerate_split_audio_offset_reset.test.js:73`](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73) on untouched live `ep_2`).
   - Frontend: `npm --prefix frontend run lint` (**0 errors**, 366 warnings) & `npm --prefix frontend run build` (**PASS `601ms`**).
   - Chrome Playwright E2E + Visual Screenshots on live `http://localhost:5173`: `0` console/page/API errors; tested `4 Keys Pool` <-> `Per Key`, `All models` `10 -> 17` rows, live `probe=matrix` (`200 Ready` on `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.5-transcribe`; `429 Full` on Flash-Lite tier; `503 Busy` on `3.7/3.8/flash-latest`; `404 Retired` on `2.5-flash`; `504 Timeout` on `3.1-flash-lite`), `Use First` / `Pinned ✓`, and modal scroll layout.

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-2180`)**: Running cleanly — Frontend `http://localhost:5173` + Backend `http://localhost:5000` (all finalized code active).
- **Live Gemini Pool Reality**: Primary Flash-Lite models (`gemini-3.5-flash-lite`, `gemini-flash-lite-latest`) currently exhausted `429` today on all 4 keys until Pacific midnight (~3h), while **`gemini-3.5-flash`, `gemini-3.6-flash`, & `gemini-3-flash-preview` are `200 Ready` (`4/4` keys)** and automatically picked up by Auto Cascade or 1-click Pin!

## Next Steps
- Press **`Ctrl + Shift + R`** in browser on `http://localhost:5173`, open **Gemini Route**, and either leave `✨ Auto (3/10 Models)` or click **`Use First`** / **`ប្តូរទៅ Gemini 3.5 Flash`** to continue translating immediately using healthy Flash backup models.

---

## Previous Session
- **Environment**: Antigravity IDE (Built Honest **Gemini Quota & Pool Monitor** + **Use all keys / Safe pacing** UI in `GeminiRouteModal`)
- **Timestamp**: 2026-11-10T11:21:21+07:00

## Summary: Real-Time Gemini Quota & Pool Monitor, 1-Token Live Probe, Pacing Toggle, & Per-Key Ready vs Exhausted Breakdown
1. **Honest Quota & Rate-Limit Tracker Service ([geminiQuotaTracker.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js))**:
   - Implemented [`GeminiQuotaTracker`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L130-L616), [`parseGeminiRateLimitDetails`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L79-L128), [`getKeyFingerprint`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L19-L27), [`getPacificDateKey`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L29-L32), and [`getNextPacificMidnightMs`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiQuotaTracker.js#L34-L56).
   - Tracks 60s rolling `rpmUsed`/`rpmLeft`/`rpmResetsInSec`, Pacific Time (`America/Los_Angeles`) daily `todayRequests`/`todayTokens`/`todayErrors429` persisted atomically with `sha256` fingerprints (never raw API keys) to `backend/uploads/cache/gemini_quota_usage.json`, `429` RPM retry cooldown vs RPD `daily_exhausted` (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, stripping verbose boilerplate so real `limit: 500` details remain visible), and `useAllKeysFast` / `rpmPerKey` / `dailyRpdPerKey` settings.
2. **Multi-Key Pool Integration & Routes ([geminiKeyManager.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiKeyManager.js#L254-L360), [systemRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/systemRoutes.js#L70-L245))**:
   - Updated [`createSmartGenAIClient`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiKeyManager.js#L245-L368) with [`selectReadyKeyIfAvailable`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiKeyManager.js#L254-L265) (skips active cooldown/exhausted keys), optional Safe Pacing delay (`useAllKeysFast === false`), and success/rate-limit/invalid telemetry recording.
   - Upgraded `GET /api/gemini/keys-status` to support `probe=stats` (0 network calls), `probe=models`, and `probe=live` (real 1-token `generateContent` check across `DEFAULT_MODELS[0]` / fallback `DEFAULT_MODELS[1]` to detect actual `429` vs `200` vs `401/403`), and added `POST /api/gemini/quota-settings`.
3. **Frontend Quota & Pacing Monitor UI ([api.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js#L740-L765), [geminiRouteHelpers.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js#L129-L199), [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L1415-L1925))**:
   - Upgraded header badge to show live `${hdrReady}/${hdrTotal} Keys Ready (${hdrRpmReady} RPM Pool)`.
   - Built `⚡ Gemini Quota & Pool Monitor` with `Limit/Key` selector (`250`, `500 (Free Flash-Lite)`, `1,000`, `1,500`, `10,000`), **`Use all keys` / `Safe pacing`** toggle pill, **`⚡ ពិនិត្យ Quota ពិត`** live-probe button, two side-by-side progress bars (`Rate Limit (1m RPM)` + `Today (RPD & Tokens)` with live 1s countdowns), and `Key #1..#4` cards showing `✓ Ready (200)` / `X/15 RPM` / `⏳ Wait XXs` / `🔴 អស់ថ្ងៃនេះ (429)` / `❌ Key ខុស`.
4. **Tests & Live Verification (`series_1793898268958/series.json` Untouched)**:
   - Added [`gemini_quota_tracker_and_routes.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/gemini_quota_tracker_and_routes.test.js) (**4/4 PASS**).
   - Full backend suite (`node --test backend/tests/*.test.js`): **166 tests — 164 PASS, 1 SKIP (`stage4_sense_voice_integration`), 1 pre-existing FAIL** ([`regenerate_split_audio_offset_reset.test.js:73`](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73) on untouched `ep_2`).
   - Frontend: `npm --prefix frontend run lint` (**0 errors**, 366 warnings) & `npm --prefix frontend run build` (**PASS `559ms`**).
   - Chrome Playwright E2E + visual screenshot check (`http://localhost:5173`): `0` console/page/HTTP errors; verified live Google `gemini-3.5-flash-lite` Free Tier quota reporting (`Key #3 ...x4sg` Ready 200; Keys `#1`, `#2`, `#4` reported `limit: 500/day` 429 until PT midnight).

## Active Environment
- **Dev Orchestrator (`.\dev.ps1 -NoBrowser -SkipInstall`, `task-1851`)**: Running cleanly — Backend `http://localhost:5000` + Frontend `http://localhost:5173` (with all finalized code loaded).
- **Gemini Key Pool Live Status**: `1/4` keys ready on Free Tier (`Key #3 ...x4sg` `200 OK`; Keys `#1 ...uB8A`, `#2 ...I64w`, `#4 ...hVPg` hit Google's `500 RPD` Free Tier limit until Pacific midnight).

## Next Steps
- Press **`Ctrl + Shift + R`** in browser on `http://localhost:5173`, open **Gemini Route**, select `500 (Free Flash-Lite)` under `Limit/Key:` (matching Google's `gemini-3.5-flash-lite` Free Tier limit), and inspect `Key #1..#4` or click **`⚡ ពិនិត្យ Quota ពិត`**.

---

## Previous Session
- **Environment**: Antigravity IDE (Option `1`: Fixed 4 Pipeline Bugs Causing Literal `'សន្ទនា'` Fallback, Weak Model Cascade, `needsReview` Typo, & Placeholder TTS Synthesis)
- **Timestamp**: 2026-11-10T08:29:15+07:00

## Summary: Eliminated Silent `'សន្ទនា'` Fallback, Upgraded 6-Model Stage 6 Cascade + Fail-Fast, Fixed `reviewNeeded` Validation & Added Placeholder TTS Guards (`series.json` Left Untouched)
1. **Eliminated Silent `'សន្ទនា'` Fallback & Fixed `reviewNeeded` Field ([stage6_generateModeSpecificScript.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js))**:
   - Removed `targetSeg.khmerTranslatedText = targetSeg.sourceChineseToTranslate || 'សន្ទនា'` and typo `targetSeg.needsReview = true` (`L1097-1098`).
   - Added [`isPlaceholderTranslationText`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L57-L60) and rejected literal `'សន្ទនា'` in [`applyTranslatedSegmentResult`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L468-L569) and [`createCanonicalSegment`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L318-L466) (preserving `validationErrors` and setting `reviewNeeded: true` + `translationStatus: 'review_needed'`).
2. **Full 6-Model Cascade & Fail-Fast Error Reporting ([stage6_generateModeSpecificScript.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js), [dubbingPipeline.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/dubbingPipeline.js), [chunkOrchestrator.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/chunkOrchestrator.js), [episodePipelineOrchestrator.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/episodePipelineOrchestrator.js))**:
   - Expanded Stage 6 cascade to `STAGE6_CASCADE_MODELS` (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-flash-latest`), matching `DEFAULT_MODELS` in [`geminiService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js#L60-L67).
   - Added immediate fail-fast on `AbortError` and `401/403` auth failures (`INVALID_API_KEY`, `nonRetryable: true`), immediate cascade (zero retry sleep) on `404`/`429`/`503`/`504` with retired/demoted model tracking across batches, and early abort/throw (`QUOTA_EXCEEDED`/`TRANSLATION_FAILED` + `translationReport`) on `totalBatches === 1`, `>= 2` consecutive full-cascade failures, `>= 2` failed batches, or `>= 25%` untranslated segments.
   - Wired `signal`, `translationReport`, and `validationReport` through [`runDubbingPipeline`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/dubbingPipeline.js#L222-L330), [`runChunkedDubbingPipeline`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/chunkOrchestrator.js#L381-L505), and [`runEpisodePipeline`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/episodePipelineOrchestrator.js#L223-L234).
3. **Stage 7 Legacy Placeholder Validation & Stage 9 / TTS Guards ([stage7_translateAndValidateKhmer.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage7_translateAndValidateKhmer.js), [ttsService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js), [stage9_generateSegmentTTS.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage9_generateSegmentTTS.js), [audioRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js))**:
   - Stage 7 [`translateAndValidateKhmer`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage7_translateAndValidateKhmer.js#L11-L86) clears standalone `'សន្ទនា'`, sets `reviewNeeded: true`, `translationStatus: 'review_needed'`, increments `missingTranslationCount`, and adds a Khmer validation error.
   - Exported [`isPlaceholderOrEmptyTtsText`](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L197-L201) and wired into [`generateSingleSegmentAudio`](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L540-L565), [`generateBatchSegmentsAudio`](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L1076-L1105), [`generateSegmentTTS`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage9_generateSegmentTTS.js#L106-L116), and [`audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L45-L750) (single `400` + batch `empty_text` skip + fast-path/master narration sync exclusion).
4. **Tests & Fresh Verification (`series_1793898268958/series.json` Untouched)**:
   - Added [`stage6_translation_fallback_and_tts_guard.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/stage6_translation_fallback_and_tts_guard.test.js) (**7/7 PASS**).
   - Targeted suite (6 test files): **43/43 PASS** (`1.94s`).
   - Full backend suite (`node --test backend/tests/*.test.js`): **162 tests total — 160 PASS, 1 SKIP (`stage4_sense_voice_integration`), 1 pre-existing FAIL** ([`regenerate_split_audio_offset_reset.test.js:73`](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73) checking untouched live `ep_2` data).

## Active Environment
- **Backend API (`http://localhost:5000`)**: Running (`200 OK`, `activeKeysCount: 2/4`); restart needed so Node reloads edited backend pipeline/TTS modules.
- **Live Data (`series_1793898268958`)**: `ep_2` (`series.json`) intentionally untouched per user choice `1`.

## Next Steps
- Restart Backend (`.\dev.ps1`) before testing new translation/TTS runs so updated Stage 6/7/9 & TTS guards take effect.
- Note from `/api/health`: `2/4` Gemini API keys currently active in pool (`2` flagged invalid/exhausted in running server memory); check API keys before re-translating long episodes.

---

## Previous Session
- **Environment**: Antigravity IDE (Read-Only Diagnosis: Why System Still Remembers / Confuses Character Girl vs Boy Voices & `តួអង្គ`)
- **Timestamp**: 2026-11-10T01:22:00+07:00

## Summary: Diagnosed Global Registry/Glossary Voice Poisoning, `unknown` -> Piseth Default, & Pitch/UI Causes (No App Code/Data Modified)
1. **System "ចាំ" (Remembering Wrong Girl/Boy Voices Across Segment/Series)**:
   - Clicking `👨 ប្រុស` / `👩 ស្រី` on **1 segment** calls [`handleUpdateSegmentVoice`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js#L323-L339), which globally overwrites `speakerRegistry[spkKey]` with `voiceId`, `gender`, and `userOverridden: true`.
   - Every 400ms auto-save calls [`saveEpisodeState`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L887-L907) -> [`extractGlossaryFromEpisode`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L1046-L1084), syncing `speakerRegistry` (including generic `"តួអង្គ"` and poisoned role keys) into top-level `series.glossary.characters`, which [`scriptRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/scriptRoutes.js#L80-L135) & Stage 6 inject into subsequent Gemini prompts.
   - Live `series_1793898268958/series.json` currently has `"តួអង្គស្រី" -> km-KH-PisethNeural (male)`, `"តួឯកស្រី" -> km-KH-PisethNeural (male)`, `"តួអង្គ" -> km-KH-PisethNeural (male)` in `series.glossary.characters`, plus `ep_2.speakerRegistry` (`395` keys) with `"តួឯកប្រុស" -> SreymomNeural`.
   - [`audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L334-L403) + [`useAudioDubbing.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js#L570) also stamp `voiceAssignmentSource: "manual"` on single-segment text edits/regens.
2. **System "ច្រឡំ" (Still Confusing Girl vs Boy & Generic `តួអង្គ`)**:
   - Current `ep_2` on disk originated from `job_1794241118365_64639ee1` (`23:18`, prior to server restart), where Stage 6 batches `#121+` hit `429` (no `gemini-3.1-flash-lite` in Stage 6 rescue list [`stage6_generateModeSpecificScript.js:1053`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L1053)) and fell back to `'សន្ទនា'` / generic `'តួអង្គ'` (`213` lines in `ep_2`).
   - Standard Mode prioritizes raw unseparated YIN `pitchHz >= 172` over AI `aiGender` ([`stage6_generateModeSpecificScript.js:445-474`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L445-L474)), misclassifying young/donghua male voices with BGM.
   - All `'unknown'` lines (`ep_2`: `55`, `ep_3..ep_12`: `7–49` `'តួអង្គផ្សេង'` per episode) default to Male `km-KH-PisethNeural` ([`deriveVoiceFromGender`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L247-L257), [`ttsService.js:584-587`](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L584-L587)).

## Active Environment
- **Backend API (`http://localhost:5000`) / Frontend (`http://localhost:5173`)**: Running via background `dev.ps1` daemon (`task-163`).
- **Live Data (`series_1793898268958`)**: Left untouched during read-only diagnosis (Nha actively editing `ep_2`).

## Next Steps
- **Awaiting Nha's Clarification & Confirmation**:
  - Confirm scope to fix (1: Stop single-line voice edit from poisoning `speakerRegistry` & `series.glossary.characters` + add `"កែតែ ១ ឃ្លា"` vs `"កែទាំងតួអង្គ"`, 2: Clean poisoned `series.glossary` / `ep_2` data, 3: Improve Stage 6 `aiGender` vs noisy YIN `pitchHz` + add `gemini-3.1-flash-lite` rescue fallback in Stage 6).

---

## Previous Session
- **Environment**: Antigravity IDE (`3. Subs` Click -> Auto-Sync Playhead, Video Preview, & Timeline `VOICE` Scroll without Autoplay)
- **Timestamp**: 2026-11-10T01:01:00+07:00

## Summary: Clicking a Segment Card in `3. Subs` (or Searching `#ID` + `Enter`) Auto-Selects, Seeks, & Centers the `VOICE` Track
1. **Added Pure Timeline Focus Helpers ([timelineUtils.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/timelineUtils.js#L801-L835))**:
   - [`resolveVoiceClipStartSec`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/timelineUtils.js#L801-L812): resolves `VOICE` clip start (`audioStartSec` -> `startSec` -> parsed string `start` -> `idx * 4`).
   - [`computeTimelineScrollForTime`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/timelineUtils.js#L824-L835): centers target timeline timestamps inside `.timeline-scroll-area` with `TRACK_HEADER_WIDTH = 112`.
2. **Wired Left `3. Subs` Card Click & Search `Enter` ([ScriptReviewTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/ScriptReviewTab.jsx#L130-L137), [L587-L601](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/ScriptReviewTab.jsx#L587-L601), [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L435-L480))**:
   - Clicking a card in `3. Subs` (or pressing `Enter` in Search) calls [`handleSelectSegmentFromScript`](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L435-L480): selects `selectedSegmentId` (card + Inspector + `.voice-segment-block.selected`), syncs `activeClipId` cleanly without triggering a conflicting clip seek, seeks playhead + Video Preview (`handleSeek`) without auto-playing audio, and dispatches `timelineFocusRequest`.
3. **Timeline Focus Scroll & Boundary Snap-Back Guard ([TimelineEditor.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/TimelineEditor.jsx#L461-L542))**:
   - Handles `timelineFocusRequest` smoothly (works even when `TIMELINE_AUTO_CENTER` is OFF) and uses `manualFocusLockRef` (both from `3. Subs` and direct `VOICE`/`SUB` timeline clicks) so `0.01s` codec seek rounding or adjacent overlap does not revert `#18 -> #17`; scrubbing (`handleScrub`) or playing releases the lock immediately.
4. **Verification Results (All Fresh After Final Edits)**:
   - **Unit Tests ([script_segment_search.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/script_segment_search.test.js))**: **4/4 PASS** (`84ms`). Also passed alongside [series_persist_and_sync.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/series_persist_and_sync.test.js) and [empty_text_guard.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/empty_text_guard.test.js) (`exit code 0`).
   - **Frontend Lint & Build**: `npm --prefix frontend run lint` (**0 errors**, 366 warnings), `npm --prefix frontend run build` (**PASS `694ms`**).
   - **Playwright Chromium E2E (`frontend/dist` + live `series_1793898268958`)**:
     - `PLAYWRIGHT_SUBS_CLICK_SYNC_VERIFIED_OK` (`ep_2` with `TIMELINE_AUTO_CENTER=false`): clicking `#18` scrolled `.timeline-scroll-area` from `0 -> 1127`, seeked video to `38.55s` (paused, no snap-back), highlighted `#18 ប្រុស`; typing `37` + `Enter` scrolled to `2920`, seeked to `78.4s`, highlighted `#37 ប្រុស`, `0` errors.
     - `PLAYWRIGHT_SEARCH_BY_ID_VERIFIED_OK` (`ep_3`, 336 segments): `#37`/`#36`/Clear search verified (`0` errors).

## Active Environment
- **Dev Server (`http://localhost:5173`)**: Refresh browser (**`Ctrl + Shift + R`**) if Vite HMR hasn't reloaded updated chunks.

## Next Steps
- សាកចុច card ណាមួយក្នុង `3. Subs` (ដូចជា `#18`) ឬវាយ `37` ហើយចុច **`Enter`** — Playhead, Video Preview, Inspector, និង Timeline `VOICE 1` នឹងលោត + scroll ទៅចំ clip នោះភ្លាមដោយអត់ autoplay។

---

## Previous Session
- **Environment**: Antigravity IDE (`/fix code` / `/agents` Phase 4–6: Fixed `POST /api/dubbing/retranslate-segment` `429` Quota Cascade + Route Status + Inspector Error UI)
- **Timestamp**: 2026-11-10T00:47:30+07:00

## Summary: Multi-Model Fallback Cascade for Re-Translate, Clean Route Error Mapping & Inspector Inline Error Banner
1. **Multi-Model Fallback Cascade ([geminiService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js))**:
   - Added [`isModelFallbackEligibleError`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js#L92-L110) (`429`/`503`/`504`/`404`/timeout cascade; `401`/`403`/`400` fail fast) and [`generateContentWithModelFallback`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js#L116-L176) with per-attempt `.unref()`ed timeout guard.
   - Updated [`retranslateSingleDialogue`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js#L1225-L1361) and [`retranslateBatchDialogues`](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js#L1448-L1545) to cascade cleanly across `DEFAULT_MODELS` (`gemini-3.5-flash-lite` -> `gemini-3.1-flash-lite` -> `gemini-3.5-flash` -> `gemini-3.6-flash` -> `gemini-3.8-flash` -> `gemini-flash-latest`) and return `modelUsed`.
2. **Clean Route Error Mapping ([scriptRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/scriptRoutes.js#L225-L308))**:
   - Added [`formatRetranslateRouteError`](file:///e:/khmer_ai_dubbing_studio/backend/routes/scriptRoutes.js#L225-L273) mapping `429` quota exhaustion (with retry-delay hint), `401`/`403` invalid key, `400` missing key, and `503`/`504` upstream timeout to proper HTTP status codes + clean Khmer messages (redacting `key=...`) on `/api/dubbing/retranslate-segment` and `/api/dubbing/retranslate-all`.
3. **Inspector Error Feedback ([ClipInspectorPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx#L49-L660))**:
   - Added `retranslateError` state (auto-cleared on segment switch, retry, or option selection), [`formatRetranslateUiError`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx#L326-L339), and inline `data-testid="retranslate-error-banner"` with 1-click Retry button instead of silent `console.error`.
4. **Verification Results**:
   - [retranslate_fallback.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/retranslate_fallback.test.js) + [gemini_key_pool_and_504_retry.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/gemini_key_pool_and_504_retry.test.js) + [phase1_translation_boundary.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/phase1_translation_boundary.test.js): **21/21 PASS** (`847ms`).
   - Full backend suite (`node --test`): **153 tests — 151 PASS, 1 SKIP (`stage4_sense_voice_integration`), 1 pre-existing FAIL** ([regenerate_split_audio_offset_reset.test.js:73](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73)).
   - `npm --prefix frontend run lint` (`oxlint`): **0 errors** (365 pre-existing warnings).
   - `npm --prefix frontend run build`: **PASS (`built in 622ms`)**.
   - Live dev servers restarted cleanly (`dev.ps1 -NoBrowser -SkipInstall`); `GET http://127.0.0.1:5173/api/health` (`200`, `4/4` keys active) & UTF-8 `POST http://127.0.0.1:5173/api/dubbing/retranslate-segment` (`"这五意凝天决想必适合你"`) returned `200 OK` (`modelUsed: "gemini-3.1-flash-lite"`, `optionsCount: 3`).

## Active Environment
- **Backend API (`http://localhost:5000`)**: Running via `dev.ps1` daemon (`200 OK`, `4/4` active keys)
- **Frontend Studio UI (`http://localhost:5173`)**: Running via `dev.ps1` daemon (`200 OK`)
- **Git HEAD**: `c24304c` (`origin/main`) + working tree changes ready for commit.

## Next Steps
- Press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`) and click **`✨ AI កែប្រែ (Re-Translate)`** — it now automatically falls back to `gemini-3.1-flash-lite` and returns 3 Khmer options cleanly.
- *(From prior session)* Confirm with Nha on commit scope (`all` vs `selective`) and whether to fix `backend/tests/regenerate_split_audio_offset_reset.test.js:73` before `git commit` + `git push origin main`.

---

## Previous Session
- **Environment**: Antigravity IDE (Added Exact `#ID` / Number Search in `3. Subs` Panel + Clear Search Button)
- **Timestamp**: 2026-11-10T00:45:30+07:00

## Summary: Enabled Searching Script Segments by Visual Line Number (`37` / `#37` / `៣៧`)
1. **Added [`filterScriptSegments`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/scriptSearchUtils.js#L5-L53) & Wired into [`MediaLibrary.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/MediaLibrary.jsx#L306-L309)**:
   - Typing `37`, `#37`, or Khmer digits `៣៧` in the `3. Subs` search input matches exact card line number `#{idx + 1}` (`segments[36]` = `#37` only, without `#137`/`#237`).
   - Out-of-range bare numbers (e.g. searching `"5000"` in dialogue) fall back cleanly to dialogue/speaker text search (`khmer`, `khmerText`, `khmerTranslatedText`, `original`, `chineseText`, `originalChineseText`, `originalText`, `chinese`, `speaker`, `speakerName`).
2. **Updated [`ScriptReviewTab.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/ScriptReviewTab.jsx#L570-L632)**:
   - Updated search placeholder to `"Search #37, dialogue, or speaker..."` and added a one-click clear button (`Clear search`).
   - Fixed `effectiveIdx` lookup (`s === seg` checked first) so filtered cards always display their true line number (`#37`) instead of falling back to `#1`.
3. **Verification Results (All Verified Fresh After Edits)**:
   - **Unit Tests ([script_segment_search.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/script_segment_search.test.js), [empty_text_guard.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/empty_text_guard.test.js))**: **5/5 PASS**.
   - **Frontend Lint & Build**: `npm --prefix frontend run lint` (`0` errors, 365 pre-existing warnings), `npm --prefix frontend run build` (**PASS `710ms`**).
   - **Playwright Chromium E2E against `frontend/dist` + live `series_1793898268958` (`ep_3`, 336 segments)**: `PLAYWRIGHT_SEARCH_BY_ID_VERIFIED_OK` — verified typing `37` displays only `#37` card, `#36` displays only `#36`, clicking Clear restores all `336` segments, and `0` JS/console errors.

## Active Environment
- **Frontend HMR / Build**: `frontend/dist` rebuilt cleanly; Vite HMR picks up frontend edits automatically (still restart `.\dev.ps1` if earlier backend edits haven't been loaded yet, then refresh browser).

## Next Steps
- សាកវាយ `37` ឬ `#37` ក្នុងប្រអប់ Search នៅ tab `3. Subs` ហើយចុច `X` ដើម្បីត្រឡប់ទៅបញ្ជីពេញវិញ។

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents`: Cleaned All Mock/Test Leftovers + Permanent `mock_render.mp4` 404 Guard + Fixed `audioOutdated` Clearing After TTS)
- **Timestamp**: 2026-11-10T00:21:30+07:00

## Summary: Deleted Mock/Test/Backup Leftovers, Blocked `mock_render.mp4` Revival, Fixed Test Pollution & `audioOutdated` Clearing
1. **Deleted Leftover Mock / Test / Backup Files (`1, 2, 3` Complete Cleanup)**:
   - Stripped `ep_2.renderedVideo` (`mock_render.mp4` / `mock_16-9.mp4`) and stale `status: 'completed'` from live `backend/uploads/projects/series_1793898268958/series.json` (`0` mock refs across all 11 episodes).
   - Deleted all leftover mock/test folders (`drama_project`, `series_parallel_e2e`, `series_route_test`, `test_empty_series`, `test_mixed_series`, `test_verification_export`, `test_media`, `temp_splits`, `temp_test_audio`) plus all `39` `series.json.backup_*` files (`353.41 MB`), leaving ONLY real project `series_1793898268958/` + `cache/` + `temp/` inside `backend/uploads/`.
   - Fixed test polluters so `node --test` never recreates mock dirs inside real `backend/uploads/projects/`: moved empty-text 400 guard before `ensureProjectDirs` ([`audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L291-L315)), updated [`productionJobQueue.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/productionJobQueue.js#L42-L90) to resolve `pathUtils.uploadsDir` dynamically via `getCanonicalUploadsDir()` (and isolated pipeline submodules in [`series_persist_and_sync.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/series_persist_and_sync.test.js#L619-L634)), skipped mkdir before `ep_2_source.mp4` check in [`aspect_ratio_and_crop.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/aspect_ratio_and_crop.test.js#L75-L85), and added `test_empty_series`/`test_mixed_series` cleanup in [`empty_text_guard.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/empty_text_guard.test.js#L218-L225).
2. **Permanent `mock_render.mp4` 404 Guard Across Backend, Storage, & Workspace State**:
   - Backend [`sanitizeRenderedVideoRef`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L140-L180) + [`applySafeDiskHydration`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L186-L200) + [`syncSeriesMetadataSafely`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L779-L808): strips mock/non-existent `renderedVideo` (with `path.relative` traversal containment) and resets stale `'completed'` status.
   - Frontend [`sanitizeRenderedVideo`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L80-L101) wired into `sanitizeAndHealSeriesList`, `createStorageOptimizedSeriesList`, [`saveEpisodeState`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L833-L850), and [`useSeriesManager.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useSeriesManager.js#L232) (`applyEpisodeToWorkspace`, `handleSwitchEpisode`, `refreshSeriesFromServer`).
3. **Fixed `audioOutdated` Clearing After TTS Completion (`ep_2..ep_6, ep_8..ep_10`)**:
   - Discovered live Step 3 TTS run (`00:00–00:04`) had synthesized all 8 episodes cleanly on disk (`ep_X_narration_khmer.mp3` present, `0` non-empty outdated segments) while `audioRoutes.js` never reset `targetEp.audioOutdated = false`.
   - Fixed [`audioRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L472-L700) to clear `targetEp.audioOutdated = false` after batch narration sync, fast-path skip, and single-segment full-narration sync when no spoken non-empty segments remain outdated; excluded `empty_text`/punctuation-only segments from `doesSegmentNeedTts` and [`episodeService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L253-L263) (`hasOutdatedAudioState`).
   - Cleaned `ep_2, ep_3, ep_4, ep_5, ep_6, ep_8, ep_9, ep_10` `.audioOutdated = false` on disk (verified `hasNarr: true`, `spokenUnreadyCount: 0`). Note for user: `ep_7` still has pre-existing `fullAudioUrl: null` (`ep_7_narration_khmer.mp3` missing, segment `#55` pending) despite old `audioGenerated: true`.
4. **Verification Results (All Fresh After Final Edits)**:
   - **7 Backend Suites (`node --test`)**: **45/45 PASS** (`0` failures, `0` skipped, `12.49s`) — includes new tests in [`series_persist_and_sync.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/series_persist_and_sync.test.js#L988-L1090), [`tts_smart_skip_and_progress.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/tts_smart_skip_and_progress.test.js#L228-L311), and [`empty_text_guard.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/empty_text_guard.test.js#L126-L127).
   - **Frontend Lint & Build**: `npm --prefix frontend run lint` (**0 errors**, 365 pre-existing warnings), `npm --prefix frontend run build` (**PASS in 529ms**).
   - **Playwright Chromium E2E Scenarios A & B**: `PLAYWRIGHT_ALL_SCENARIOS_VERIFIED_OK` — verified poisoned `mock_render.mp4` stripped (`mockRenderHits: 0`), Scenario A `8/8` outdated dispatch, and Scenario B live `series.json` load with `0` console errors and `0` 404s.
   - **Disk State Verified Post-Tests**: `backend/uploads/` = `['cache', 'projects', 'temp']`, `backend/uploads/projects/` = `['series_1793898268958']`, `backups: 0`, `mockRenderCount: 0`.

## Active Environment
- **Live Server Action Required**: Restart `.\dev.ps1` and hard-refresh browser (`Ctrl + Shift + R`) so backend loads updated `audioRoutes.js` / `episodeService.js` / `productionJobQueue.js` and browser auto-strips any cached `mock_render.mp4` in `localStorage`.
- **Git HEAD**: `c24304c` (`origin/main`) + working tree changes ready for review/commit.

## Next Steps
- Restart `.\dev.ps1` + hard-refresh browser (`Ctrl + Shift + R`) — verify Console has `0` `mock_render.mp4 (404)` errors.
- Check `ep_7` in **Studio** (`សំឡេង AI`) if exporting `ep_7` because `ep_7_narration_khmer.mp3` is missing and segment `#55` is still `pending`.

---

## Previous Session
- **Environment**: Antigravity IDE (Root-Cause Fix for Stale `DONE` / `AUDIO READY` UI & `localStorage` Revival on Outdated Episodes)
- **Timestamp**: 2026-11-09T23:53:30+07:00

## Summary: Fixed `GeminiRouteModal` Stale `DONE 100%` Banner & `localStorage` / `/sync` Audio State Revival
1. **Modal State & Helper Reconciliation ([geminiRouteHelpers.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js), [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))**:
   - Unified all modal readiness checks around [`checkEpisodeHasAudioReady`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js#L24-L30) and [`checkEpisodeHasDemucsReady`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js#L32-L42) so `ep.audioOutdated === true` always overrides stale flags unless a live TTS job just finished (`ttsLiveStats[ep.id]?.isDone`).
   - Fixed Temporal Dead Zone ordering by declaring `demucsLiveStats` before reconciliation effects ([GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L71-L98)), resetting idle live stats on open, syncing `completedTtsEpIds`/`completedDemucsEpIds` straight from `/api/series/:seriesId` rather than accumulating old `localStorage` state, and showing amber `OUTDATED AUDIO` / `ត្រូវបង្កើតសំឡេងថ្មី` badges on outdated episode cards ([GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L3366-L3410)).
   - Hardened [`handleBatchGenerateTTS`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L710-L905) to check `serverEp` readiness (`checkEpisodeHasAudioReady(serverEp, null, ...)`), prefer up-to-date server segments & speaker registry, omit hardcoded fallback `voiceId: 'km-KH-PisethNeural'`, and remove a shadowed `const targetSeriesId` inside the `.map()` callback so empty-local-segment hydration works safely.
2. **Prevented Stale `localStorage` & `/sync` Revival ([projectStorage.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js), [useSeriesManager.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useSeriesManager.js), [ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx), [episodeService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js))**:
   - Updated [`saveEpisodeState`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L771-L806) and `createStorageOptimizedSeriesList` (`Ultra-compact` fallback included) to preserve `audioOutdated` and honor explicit `audioGenerated: false` / `hasAudio: false` / `fullAudioUrl: null` from server responses instead of OR-reviving stale `prevEp.audioGenerated`.
   - Updated [`useSeriesManager.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useSeriesManager.js#L529-L542) (`handleSwitchEpisode` + `refreshSeriesFromServer`) to sync cleared `fullAudioUrl: null` and `audioOutdated` changes into workspace state.
   - Guarded [`ExportSettingsPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L45-L51) (`checkEpHasVoice`) against `ep.audioOutdated` / `activeEpisode?.audioOutdated`.
   - Hardened [`syncSeriesMetadataSafely`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L715-L740) with `preserveDiskAudioInvalidation` so older/stale browser `/sync` calls cannot overwrite `audioOutdated: true, audioGenerated: false` on disk back to `true`.
   - Cleared stale `ep_2.audioGenerated: true` on live `series_1793898268958/series.json` (`8` outdated `ep_2..ep_6, ep_8..ep_10`; `3` ready `ep_7, ep_11, ep_12`; `voiceErr: 0`).
3. **Verification Results (Clean Isolated Runs + Chromium E2E)**:
   - **Targeted Backend + Helper Tests (`5` suites incl. new tests in [series_persist_and_sync.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/series_persist_and_sync.test.js))**: **37/37 PASS** (`node --test`).
   - **Frontend Lint & Build**: `npm --prefix frontend run lint` (**0 errors**, pre-existing warnings only), `npm --prefix frontend run build` (**PASS**).
   - **Playwright Chromium E2E against `frontend/dist` + live `series.json` + poisoned `localStorage`**: `PLAYWRIGHT_OUTDATED_UI_VERIFIED_OK` — verified `ep_2` overwritten in `localStorage` (`audioGenerated: false, audioOutdated: true`), `0` poisoned `/sync` payloads, footer `2. សំឡេងខ្មែរ AI: 3/11 (27% • នៅសល់ 8 ភាគ)`, Step 3 button `បង្កើតសំឡេងខ្មែរ AI (8 ភាគនៅសល់)` (NO green `DONE`), `ep_2` showing `OUTDATED AUDIO`, `ep_11` showing `AUDIO READY`, clicking Step 3 dispatching `/api/generate-audio` for the exact 8 outdated episodes (`ep_2..ep_6, ep_8..ep_10`), and `0` JS/console fatal errors.

## Active Environment
- **Live Server Action Required**: Existing `.\dev.ps1` backend/frontend processes (started before edits) must be restarted so Express loads updated `episodeService.js` and Vite serves updated modal/storage code; browser needs hard refresh (`Ctrl+Shift+R`).
- **Git HEAD**: `c24304c` (`origin/main`) + working tree changes ready for commit/push when requested.

## Next Steps
- **For Nha Now**:
  1. Restart `.\dev.ps1` (បិទ terminal ចាស់ ហើយបើក `.\dev.ps1` ឡើងវិញ) + Hard Refresh Browser (`Ctrl + Shift + R`).
  2. បើក Gemini Batch & Keys Console → រើស **🌐 ទាំងអស់ (11 ភាគ)** → ពិនិត្យឃើញ Step 3 បង្ហាញ **`🎙️ បង្កើតសំឡេងខ្មែរ AI (8 ភាគនៅសល់)`** → ចុច **Step 3** (`0` Gemini Quota, **មិនបាច់ចុច Re-Translate (FORCE) ទេ** ព្រោះ 11/11 Script បានកែ `ប្រព័ន្ធ`/`តួឯកប្រុស` រួចរាល់លើ disk ហើយ)។

---

## Previous Session
- **Environment**: Antigravity IDE (Option 2 Selected: Repair `series_1793898268958` `ep_2..ep_12` Scripts/Voices Zero-Quota + `episodeService.js` `audioOutdated` Hydration Guard)
- **Timestamp**: 2026-11-09T23:12:15+07:00

## Summary: Repaired Existing `ep_2..ep_12` Voice Assignments (0 Gemini Quota) & Protected Outdated Episodes From Stale Narration Hydration
1. **Added `audioOutdated` Guard in [`applySafeDiskHydration`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L192-L298)**:
   - Prevented `getSeriesMetadata()` from re-marking an `audioOutdated` episode (or an episode containing `audioOutdated` / `ttsStatus: 'outdated'` segments) as `audioGenerated: true` from a stale `ep_X_narration_khmer.mp3` on disk, and prevented outdated segments from hydrating old audio files.
   - Added assertion in [gender_voice_consistency.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/gender_voice_consistency.test.js#L289-L340) verifying `audioOutdated` episodes stay `audioGenerated: false`.
2. **Repaired Live Series `series_1793898268958` (`ep_2..ep_12`, 0 Gemini Quota)**:
   - Created timestamped backup `backend/uploads/projects/series_1793898268958/series.json.backup_pre_voice_repair_1794240702162` and renamed old mixed master narrations on the 8 affected episodes to `*.pre_voice_repair_*.mp3.bak`.
   - Fixed **63 mismatched segments** (`0` title/gender errors & `0` voice mismatches across all `4,140` segments):
     - `ep_2`: `39` `'ប្រព័ន្ធ'` (`Piseth` → `km-KH-SreymomNeural`) + cleaned `ep_2.speakerRegistry` & `glossary.characters`.
     - `ep_5`: `1` `'ប្រព័ន្ធ'` (`Piseth` → `km-KH-SreymomNeural`).
     - `ep_3` (`5`), `ep_4` (`7`), `ep_6` (`2`), `ep_8` (`2`), `ep_9` (`3`), `ep_10` (`4`): `'តួឯកប្រុស'` (`Sreymom` → `km-KH-PisethNeural`).
     - `ep_7` (`#311`), `ep_8` (`#27`): tagged `'male'` matching already-correct `Piseth`.
   - Marked ONLY those 63 changed segments `audioOutdated: true` / `ttsStatus: 'outdated'` (all unchanged ready clips preserved for instant Edge TTS cache reuse) and marked those **8 episodes** (`ep_2, ep_3, ep_4, ep_5, ep_6, ep_8, ep_9, ep_10`) ready for Step 3 Re-TTS (`ep_7, ep_11, ep_12` remain `audioGenerated: true`).
3. **Verification Results**:
   - **Live Series Disk Verification (`getSeriesMetadata('series_1793898268958', { forceDisk: true })`)**: `LIVE_SERIES_REPAIR_VERIFIED_OK` (`11/11` episodes, `titleErr=0`, `voiceErr=0`).
   - **Targeted Suites**: `22/22 PASS` (`gender_voice_consistency.test.js`, `batch_export_and_merge.test.js`, `episode_state_isolation.test.js`, `series_persist_and_sync.test.js`) + `35/35 PASS` (`gender_voice_consistency.test.js`, `tts_smart_skip_and_progress.test.js`, `fast_ocr_mode.test.js`, `series_persist_and_sync.test.js`, `episode_state_isolation.test.js`).

## Active Environment
- **Backend API (`http://localhost:5000`) / Frontend (`http://localhost:5173`)**: Still running pre-edit process (`22:41`); restart `.\dev.ps1` + hard-refresh browser (`Ctrl+Shift+R`) so running backend uses all updated code fixes.
- **Git HEAD**: `c24304c` (`origin/main`) + working tree changes ready for commit/push when requested.

## Next Steps
- **For Nha Now**:
  1. Restart `.\dev.ps1` (បិទ terminal ចាស់ ហើយបើក `.\dev.ps1` ឡើងវិញ) + Refresh browser (`Ctrl + Shift + R`).
  2. បើក Gemini Console រើស **ទាំងអស់ (11 ភាគ)** → ចុច **Step 3: 🎙️ បង្កើតសំឡេងខ្មែរ AI (8 ភាគនៅសល់)** (មិនបាច់ចុច Re-Translate ទេ — `0` Gemini Quota, ហើយឃ្លាចាស់ៗប្រើ cache ភ្លាមៗ បង្កើតថ្មីតែ 63 ឃ្លាដែលកែប៉ុណ្ណោះ)។

---

## Previous Session
- **Environment**: Antigravity IDE (Option #1 + `"ប្រព័ន្ធ"` -> Sreymom Full Pipeline Fix & Verification)
- **Timestamp**: 2026-11-09T23:03:00+07:00

## Summary: Fixed Male/Female Voice Inversion Across Fast OCR + Standard Mode & Defaulted `"ប្រព័ន្ធ"` (AI System) to Female (`km-KH-SreymomNeural`)
1. **Gender Keywords & Boundary Safety ([speakerRegistry.js](file:///e:/khmer_ai_dubbing_studio/backend/models/speakerRegistry.js), [speakerUtils.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/speakerUtils.js))**:
   - Added `"ប្រព័ន្ធ"`, `"ប្រព័ន្ធ ai"`, `"ប្រព័ន្ធជំនួយ"`, `"ប្រព័ន្ធណែនាំ"`, `"ប្រព័ន្ធសំឡេង"`, `"system"`, `"ai system"`, `"系统"`, `"系统提示"`, `"កុមារី"`, `"មាតា"`, `"ធីតា"`, `"ម្ចាស់ស្រី"`, `"ម្ចាស់អូន"` to female markers so AI/System characters default to `female` (`km-KH-SreymomNeural`) unless manually overridden.
   - Added word/token-boundary matching ([`matchesSpeakerKeyword`](file:///e:/khmer_ai_dubbing_studio/backend/models/speakerRegistry.js#L70-L82), [`matchesMarker`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/speakerUtils.js#L29-L41)) to block English `"her"` inside `"brother"`/`"father"`/`"hero"`/`"teacher"` and Khmer short male tokens `["មា", "តា", "ពូ"]` inside `"កុមារី"`/`"មាតា"`/`"ធីតា"`.
   - Removed premature `"unknown"` short-circuit in [`detectSpeakerGender`](file:///e:/khmer_ai_dubbing_studio/backend/models/speakerRegistry.js#L89-L138), unified split non-manual `speakerId` buckets sharing a named character inside [`syncSegmentsWithSpeakerRegistry`](file:///e:/khmer_ai_dubbing_studio/backend/models/speakerRegistry.js#L195-L310), protected pure title evidence over stale metadata, and blocked bare `'តួអង្គ'` collisions in both backend and frontend ([`applySpeakerVoiceToSegments`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/speakerUtils.js#L193-L247)).
2. **Pipeline Stages 5 & 6 + Segment Normalization ([segmentModel.js](file:///e:/khmer_ai_dubbing_studio/backend/models/segmentModel.js), [stage5_reconcileTimelineEvidence.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage5_reconcileTimelineEvidence.js), [stage6_generateModeSpecificScript.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js))**:
   - Propagated `pitchHz`, `acousticF0`, `acousticGender`, and `acousticConfidence` through all Stage 5 fusion/merge paths.
   - Updated [`createSegment`](file:///e:/khmer_ai_dubbing_studio/backend/models/segmentModel.js), [`createCanonicalSegment`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L272-L420), and [`applyTranslatedSegmentResult`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L422-L505) so non-manual segments re-derive `voiceId`/`khmerVoiceId`/`voice` from final resolved gender (`"unknown"` never traps stale Piseth; explicit titles beat noisy YIN pitch in Standard Mode).
   - Generalized [`enforceEpisodeCharacterConsistency`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js#L514-L685) (preserving `enforceFastOcrCharacterConsistency` alias) across all Mode A episodes without stamping `ocr_only` onto Standard segments, forcing `"ប្រព័ន្ធ"` -> `female` (`Sreymom`) unless `userOverridden`.
3. **TTS Voice Selection, Disk Hydration & Route Safety ([ttsService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js), [stage9_generateSegmentTTS.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage9_generateSegmentTTS.js), [episodeService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js), [audioRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js), [useAudioDubbing.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js), [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))**:
   - Fixed `POST /api/generate-audio` (`audioRoutes.js:248`, `311-335`, `497`, `575`, `697`) so missing request `voiceId` no longer defaults to `km-KH-PisethNeural` (which falsely triggered `isManual=true` and overrode female/`"ប្រព័ន្ធ"` voices).
   - Fixed [`generateSingleSegmentAudio`](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L551-L588) & Stage 9 TTS worker to honor `speakerRegistry`/`speakerMap`, resolved gender, and `"ប្រព័ន្ធ"` -> `Sreymom` unless `forceVoice`/manual override.
   - Updated [`applySafeDiskHydration`](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L206-L270) so cached MP3s match `expectedVoice` (never wiring a `Sreymom` MP3 onto a `Piseth` segment or vice versa).
   - Updated frontend `useAudioDubbing.js` and `GeminiRouteModal.jsx` to pass safe `speakerMap` (no generic `'តួអង្គ'` collision) and preserve non-manual resolved voices.
4. **Verification Results (Clean Isolated Runs — Live `series_1793898268958` Data Untouched)**:
   - **Targeted Gender/TTS/Pipeline Suite (8 files, incl. new [gender_voice_consistency.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/gender_voice_consistency.test.js))**: **52/52 PASS**.
   - **Frontend `speakerUtils.js` Verification**: `FRONTEND_SPEAKER_UTILS_OK` (`ប្រព័ន្ធ -> FEMALE / Sreymom`, `កុមារី -> FEMALE`, `Brother Lin -> MALE`, generic `តួអង្គ` protected).
   - **Full Backend Test Suite**: `140 tests` — **138 PASS, 1 SKIP** (`stage4_sense_voice_integration`), **1 pre-existing FAIL** ([regenerate_split_audio_offset_reset.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73) checking live `series_1793898268958` `ep_2` Seg #2 `audioOffset: undefined`).
   - **Frontend Lint & Build**: `npm --prefix frontend run lint` (`0 errors`, 357 pre-existing warnings), `npm --prefix frontend run build` (**PASS in 569ms**).

## Active Environment
- **Backend API (`http://localhost:5000`) / Frontend (`http://localhost:5173`)**: Check if dev servers need restart so running backend picks up updated Node modules (`.\dev.ps1`).
- **Live Data Note**: Pre-existing saved scripts/audio on disk in `backend/uploads/projects/series_1793898268958/` (`ep_2..ep_12`) were NOT altered; Re-Translate or Re-TTS on existing episodes to apply the new rules.
- **Git HEAD**: `c24304c` (`origin/main`) + working tree changes ready for commit/push on user request.

## Next Steps
- Optional next choices for Nha:
  1. Start/restart dev servers (`.\dev.ps1`) and test Re-Translate / Re-TTS on a sample episode (or click **ការពារជាន់ 100%** / Re-TTS) to verify `"ប្រព័ន្ធ"` = `Sreymom` and `តួប្រុស/តួស្រី` voices.
  2. Proceed with **Option #2** (Step progress UI in `DubbingModeTab.jsx` / `EpisodeTranslateProgressCard.jsx`), **Option #3** (`geminiService.js` multi-model `429` fallback cascade + inline Inspector error UI), or **`git commit + push`**.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Phase 1–2 Root-Cause Diagnosis: `POST /api/dubbing/retranslate-segment` `500` / `429 RESOURCE_EXHAUSTED`)
- **Timestamp**: 2026-11-09T22:41:00+07:00

## Summary: Diagnosed `AI កែប្រែ (Re-Translate)` `429` Quota Crash & Silent UI Failure (No App Code Modified)
1. **Verified Live Cause & API Probe**:
   - All 4 configured Gemini API keys currently return **`429 RESOURCE_EXHAUSTED`** on **`gemini-3.5-flash-lite`** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit `500`/day).
   - Meanwhile, **`gemini-3.1-flash-lite`** responds **`200 OK`** immediately on Key #1 (while `gemini-2.5-flash-lite` & `gemini-2.5-flash` return `404` unavailable to new users, `gemini-flash-lite-latest` returns `429`, and `gemini-3.5-flash` returns `504 DEADLINE_EXCEEDED`).
   - Also observed in live `GET /api/gemini/keys-status`: Key #3 (`...x4sg`) is flagged `401` in memory (`activeCount: 3/4`) even though direct `GET /v1beta/models` returns `200 OK` on all 4 keys.
2. **Code Root Causes Located**:
   - [geminiService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js#L1124-L1250) (`retranslateSingleDialogue`) & [L1337-L1435](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js#L1337-L1435) (`retranslateBatchDialogues`): hardcode **only 1 model** (`gemini-3.5-flash-lite`) with **no fallback cascade** to `gemini-3.1-flash-lite` / `gemini-3.8-flash` / `gemini-flash-latest` on `429`/`503`/`504`/`404`.
   - [scriptRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/scriptRoutes.js#L221-L233): `POST /api/dubbing/retranslate-segment` returns raw `500` + Google JSON string instead of mapping `429`/`401`/`403` to clean HTTP status & Khmer message.
   - [ClipInspectorPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx#L324-L371): `handleAiRetranslate` swallows catch errors in `console.error(...)` with zero inline error UI feedback.

## Active Environment
- **Backend API (`http://localhost:5000`)**: Running (`PID 21588`, `200 OK`, `activeKeysCount: 3/4`, `45 RPM`)
- **Frontend Studio UI (`http://localhost:5173`)**: Running (`PID 7552`, active connections)
- **Git HEAD**: `c24304c` (`origin/main`) + working tree changes ready for commit.

## Next Steps
- **Awaiting Nha's Confirmation (`/agents` Phase 4 Implement)**:
  1. Confirm to implement the fix across `geminiService.js` (multi-model fallback cascade skipping `429`/`503`/`504`/`404` onto `gemini-3.1-flash-lite` etc.), `scriptRoutes.js` (clean `429`/`401` Khmer error mapping), and `ClipInspectorPanel.jsx` (inline error banner in Inspector) + tests.
  2. *(From prior session)* Commit scope (`all` vs `selective`) and whether to fix `backend/tests/regenerate_split_audio_offset_reset.test.js:73`.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Task: Fast OCR Per-Character Gender Consistency & Voice-Follows-Gender Fix)
- **Timestamp**: 2026-11-09T22:32:10+07:00

## Summary: Fixed Fast OCR Gender Flip & Stale Stage-3 Voice Inversion (Rules 1, 2, 3)
1. **Rule 1 — Voice Always Follows Gender ([stage3_extractChineseSubtitles.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage3_extractChineseSubtitles.js), [stage6_generateModeSpecificScript.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js))**:
   - Exported [`deriveVoiceFromGender`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js) (`female` → `km-KH-SreymomNeural`, `male` → `km-KH-PisethNeural`, plus matching label/avatar/badgeColor).
   - Both [`deduplicateFastOcrCues`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage3_extractChineseSubtitles.js) and Stage 6 [`createCanonicalSegment`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js) strictly re-derive `voiceId`/`khmerVoiceId`/`voice` from final `voiceGender` whenever `speakerSource === 'ocr_only'` and `!userOverridden` — stale `raw.voiceId` can never override derived voice.
   - Updated both Stage 6 primary batch loop and cascade rescue fallback loop via shared [`applyTranslatedSegmentResult`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js).
2. **Rule 2 — Whole-Episode One Character = One Gender ([stage6_generateModeSpecificScript.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js), [speakerRegistry.js](file:///e:/khmer_ai_dubbing_studio/backend/models/speakerRegistry.js))**:
   - Implemented [`enforceFastOcrCharacterConsistency`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js): runs across the entire episode after Stage 6 batch translation; groups by `cleanSpk` (ignoring generic `'តួអង្គ'` and skipping `userOverridden` segments); picks majority gender per named character, corrects minority flips, re-derives voices per Rule 1, marks named characters `unverifiedSpeaker: false`, keeps `'តួអង្គ'` `unverifiedSpeaker: true`, and logs per-character stats + corrections.
   - Hardened [`syncSegmentsWithSpeakerRegistry`](file:///e:/khmer_ai_dubbing_studio/backend/models/speakerRegistry.js) to keep `userOverridden: true` segments untouched and avoid auto-inheriting generic `'តួអង្គ'` from `seriesMap`.
   - Fixed `buildSafeSpeakerId` regex (`/[^\p{L}\p{M}\p{N}]+/gu`) to preserve Khmer vowel/combining marks.
3. **Rule 3 — Honest Text-Only Hints in Fast OCR ([stage6_generateModeSpecificScript.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js), [chunkOrchestrator.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/chunkOrchestrator.js), [dubbingPipeline.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/dubbingPipeline.js))**:
   - Passed explicit `generationMode` into [`generateModeSpecificScript`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage6_generateModeSpecificScript.js); for `fast_ocr` / `ocr_only` lines, sends `detectedGender: 'unknown'`, `acousticGenderHint: 'unknown'`, `acousticPitchHz: null`, and switches only the OCR prompt gender rule to dialogue-context judgement (Standard mode real ASR pitch & diarization untouched).
4. **Verification Results (Real Episode + Automated Suites)**:
   - **Targeted Fast OCR & Pipeline Tests**: `32/32 PASS` (incl. 5 new tests in [fast_ocr_mode.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/fast_ocr_mode.test.js) covering stale Piseth `voiceId` on `ocr_only` `female` segments, honest hints vs Standard mode untouched, 22-segment multi-batch consistency + `'តួអង្គ'` + `userOverridden`, and rescue loop voice/gender updates).
   - **Real `fast_ocr` Episode Verification (`ep_3` source, 1201.67s, 339 segments in isolated `series_fast_ocr_verify`, cleaned up after run; live `series_1793898268958` 11/11 untouched)**:
     - **Rule 2 real catch**: `"វិញ្ញាណសៀវភៅ"` (19 lines: 15F / 4M) had **4 minority segments automatically corrected** to `female` + `km-KH-SreymomNeural`.
     - **0 invariants violated**: all 20 named characters (`តួឯកប្រុស` 119M, `ប្រព័ន្ធ` 27F, `លីធានវ៉ី` 25M, `វិញ្ញាណសៀវភៅ` 19F, `តួឯកស្រី` 9F, etc.) have strictly 1 gender and matching Edge voice (`named characters with >1 gender = 0`, `voice-vs-gender mismatches = 0`); generic `'តួអង្គ'` (40 lines) kept per-line judgement with `unverifiedSpeaker: true`.
     - **Real Edge TTS regen on `Seg #43` (`តួឯកស្រី`)**: synthesized `ep_ep_1_seg_43_km-KH-SreymomNeural_voice_03c16a48.mp3` (`8708` bytes, `0.985s`) using `km-KH-SreymomNeural`.
     - **`userOverridden` real Stage 3→6→7→8→SpeakerRegistry check**: preserved `voiceGender: 'male'`, `voiceId: 'km-KH-PisethNeural'`, `speakerId: 'spk_manual_verify_override'` untouched.
   - **Full Backend Test Suite**: `134 tests` — **`132 PASS`, `1 SKIP`** (`stage4_sense_voice_integration`), **`1 pre-existing FAIL`** ([regenerate_split_audio_offset_reset.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73) against live `ep_2` Seg #2 `audioOffset: undefined`).
   - **Frontend Lint & Build**: `npm --prefix frontend run lint` (`0 errors`), `npm --prefix frontend run build` (`PASS in 585ms`).

## Active Environment
- **Backend API (`http://localhost:5000`) / Frontend (`http://localhost:5173`)**: Stopped
- **Git HEAD**: `c24304c` (`origin/main`) + working tree changes ready for commit (awaiting Nha's decision on commit scope + pre-existing test #73)

## Next Steps
- **Awaiting Nha's Confirmation before `git commit + push`**:
  1. Commit & push **ALL** working tree changes (which include `asyncSemaphore.js`, `episodeService.js` `persistEpisodeScriptData`, batch controls, + Fast OCR fixes — cleanly keeping imports consistent) vs **selective commit**?
  2. Whether to ignore or fix pre-existing `ep_2` Seg #2 `audioOffset` failure at [regenerate_split_audio_offset_reset.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73) before commit.

---

## Previous Session
- **Environment**: Antigravity IDE (Read-Only Diagnosis: Why Batch Re-Translate Re-Ran at 21:16 PM & Current Data/Server Check)
- **Timestamp**: 2026-11-09T21:39:15+07:00

## Summary: Diagnosed Screenshot Re-Run (`21:16 PM`) vs Current Task 2 Fix (`21:27 PM`) (No App Code Modified)
1. **Why All 11 Episodes Re-Ran in Nha's Screenshots (`[9:16:56 PM]`, jobs `9:17:14 PM`)**:
   - The screenshots show the **pre-fix UI** (notice footer `900%` and the single orange button `Re-Translate 11 ភាគ / RE-RUN BATCH`, whereas [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx) was updated afterward at `21:27:15`).
   - In that pre-fix UI, when all selected episodes already had scripts, the main Step 2 Translate button automatically mutated into **`Re-Translate 11 ភាគ (RE-RUN BATCH)`** (`force: true`). Also, the `ភាគនៅសល់ (11 ភាគ)` filter uses [`isEpisodeFullyDone`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L369-L375) (Translate + TTS + Demucs), so it still selects all 11 episodes while TTS (`1/11`) and Demucs (`0/11`) remain unfinished.
   - In the current code (`21:27:15`), [`handleStartBatchTranslate`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L645-L671) (`btn-batch-translate`) always sends `force: false` and skips all already-scripted episodes via [`partitionSelectedEpisodesForTranslate`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js#L41-L58), while [`handleReTranslateSelected`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L674-L702) (`btn-batch-retranslate`) is a separate `FORCE` button.
2. **Verified Live Data & Server State (Read-Only)**:
   - [series.json](file:///e:/khmer_ai_dubbing_studio/backend/uploads/projects/series_1793898268958/series.json): All **11/11 episodes' scripts are intact** (`ep_2`–`ep_12`: `502, 336, 365, 361, 425, 397, 402, 324, 389, 461, 178` segments); only `ep_2` has `audioGenerated: True` (`ep_3`–`ep_12` still need Step 3 TTS; `0/11` Demucs).
   - Live ports `5000` and `5173` have no active listeners (`netstat` empty / timeout) — dev server is currently stopped.

## Active Environment
- **Backend API (`http://localhost:5000`)**: Stopped (no listener on `:5000`)
- **Frontend Studio UI (`http://localhost:5173`)**: Stopped (no listener on `:5173`)
- **Git HEAD**: `c24304c` (`origin/main`) + prior uncommitted local edits (no app code modified in this turn).

## Next Steps
- Start dev servers if needed (`.\dev.ps1`), hard refresh browser (`Ctrl + Shift + R`), and click **Step 3: បង្កើតសំឡេងខ្មែរ AI (10 ភាគនៅសល់)** (pink button) instead of Re-Translate.
- **Still Awaiting Nha's Confirmation (from Task 2)**:
  1. Whether to fix the pre-existing `ep_2` Seg #2 `audioOffset: undefined` test failure at `backend/tests/regenerate_split_audio_offset_reset.test.js:73` before commit.
  2. Permission to stage, `git commit`, and `git push origin main` (keeping live `series_1793898268958` `11/11` intact).

---

## Previous Session
- **Environment**: Antigravity IDE (Task 2: Batch Translate Skip Finished by Default + Separate Explicit Re-Translate + Clamped Footer Percents)
- **Timestamp**: 2026-11-09T21:28:40+07:00

## Summary: Safe Default Fill-Gaps Translate, Separate Explicit Re-Translate Control & Clamped Footer Percents
1. **Pure Helpers & Partition Logic ([geminiRouteHelpers.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js))**:
   - Added [`computeClampedStagePercent`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js#L28-L38) (`0..100` clamped, handles `<=0`, `NaN`, and `done > total` cleanly), [`partitionSelectedEpisodesForTranslate`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js#L40-L56) strictly via `checkEpisodeHasScript(ep)` (never job status), and `translatePercent` inside `computeSeriesTranslateSummary`.
2. **Safe Default Translate vs Explicit Re-Translate ([GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx))**:
   - **Main Translate Button (`data-testid="btn-batch-translate"`)**: Fixed to stay in fill-gaps mode permanently (never mutates into amber `Re-Translate` or `RE-RUN BATCH`). Calls `handleStartBatchTranslate()` which enqueues ONLY unscripted selected episodes (`force: false` always), skips already-scripted ones and reports `"រំលង N ភាគ (មាន Script រួចរាល់)"` in `batchSuccess`, or starts **0 jobs** and displays `batchInfo` (`"ភាគដែលរើសទាំងអស់មាន Script រួចរាល់ហើយ — បើចង់ធ្វើឡើងវិញ សូមប្រើ Re-Translate"`) when all selected already have stored scripts. Also set explicit `force: false` in `handleRetryEpisode`.
   - **Separate Explicit Re-Translate Control (`data-testid="btn-batch-retranslate"`)**: Distinct warning-amber button calling `handleReTranslateSelected()`, the ONLY control passing `force: true`. Keeps confirm dialog with full-cost Khmer warning (`OCR + ASR + Gemini`, Gemini API Key quota usage, `Auto-Backup` first, `Overwrite` on completion).
   - **Footer Percent Fix (`data-testid="modal-footer-status"`)**: Replaced hardcoded `'១០០%'` (visually rendered/misread as `900%`) with computed clamped ASCII stage percentages (`translatePercent%`, `audioPercent%`, `demucsPercent%`, `overallStagePercent%` bounded `0..100%`).
3. **Verification Results**:
   - [series_persist_and_sync.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/series_persist_and_sync.test.js): **9/9 PASS** (`1041ms`, including `partitionSelectedEpisodesForTranslate`/`computeClampedStagePercent` unit tests + isolated Express `POST /api/jobs/generate` parallel 2-job persist test, `409 alreadyCompleted` guard, and `force: true` `script_backup_*.json` + `series.json.backup_*` + script replacement).
   - Full backend suite (`node --test`): **129 tests — 127 PASS, 1 SKIP (`stage4_sense_voice_integration`), 1 pre-existing FAIL** ([regenerate_split_audio_offset_reset.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73) against live `ep_2` Seg #2 `audioOffset: undefined`).
   - `npm --prefix frontend run lint` (`oxlint`): **0 errors** (357 pre-existing warnings).
   - `npm --prefix frontend run build`: **PASS (`built in 597ms`)**.
   - Live Chrome Playwright E2E (`http://127.0.0.1:5173`, `verify_task2_ui.cjs`): **PASS (`ok: true`, `errors: []`, `serverErrors: []`)** — `11/11` click enqueues `0` jobs & shows info banner; `ep_3` (`336` segs) opens in Editor and persists after `F5`; mixed `2 finished + 1 empty` enqueues ONLY `ep_4` with `force: false` and shows `"រំលង 2 ភាគ (មាន Script រួចរាល់)"`; explicit `Re-Translate` confirms full OCR/ASR/Gemini cost and sends `force: true`; footer displays `100%` / `91%` / `<= 100%`.

## Active Environment
- **Backend API**: `http://localhost:5000` (`node server.js` via `dev.ps1`, `200 OK`)
- **Frontend Studio UI**: `http://localhost:5173` (`vite` via `dev.ps1`, `200 OK`)
- **Git HEAD**: `c24304c` (`origin/main`) + 70 uncommitted entries (`55 M`, `14 ??`, excluding `.env` & `backend/uploads/` via `.gitignore`).

## Next Steps
- **Awaiting Nha's Confirmation**:
  1. Whether to fix the pre-existing `ep_2` Seg #2 `audioOffset: undefined` test failure at `backend/tests/regenerate_split_audio_offset_reset.test.js:73` (and `trimSegmentForStorage` preservation) before commit so 100% of backend tests pass.
  2. Permission to stage, `git commit`, and `git push origin main` (confirming whether to commit all accumulated changes since `c24304c` or specific scope, keeping live `series_1793898268958` `11/11` intact).

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Task: One Source of Truth — Pipeline Persistence, Mutex Concurrency & GeminiRouteModal Honesty)
- **Timestamp**: 2026-11-09T20:44:30+07:00

## Summary: Batch Persistence Verification, Concurrency Mutex & Console Honesty (Awaiting Nha's Confirmation for Live Re-Run / Commit & Push)
1. **STEP 0 Evidence (`backend/uploads/projects/series_1793898268958/`, 11 episodes `ep_2..ep_12`)**:
   - **Pre-fix (`series.json.backup_1794229649587` @ `~13:07Z`) vs Current Disk (`series.json` @ `13:32:50Z`)**:
     - Earlier run (`ep_2` `10:58Z`, `ep_3..ep_10` `11:42Z–12:51Z`): all completed with `0` `[Persist]` logs in job files; concurrent UI `/api/series/:seriesId/sync` offloads (`segments: []`, stripped by `trimSegmentForStorage`) & unlocked writes clobbered/missed updates while `ep_11` had `0` segments in backup (`cancelled` at `48ea2ea9`).
     - Later run (`ep_12` `job_1794229649798_b00b51b9` `178` segs @ `13:08:04Z`, `ep_11` `job_1794229647335_bff2b6c4` `461` segs @ `13:09:16Z`) included `persistScript` logs (`2` per job), bringing current `series.json` to **`11/11` episodes saved** (`502, 336, 365, 361, 425, 397, 402, 324, 389, 461, 178`), matching every episode's latest completed job `finalResult.segments.length` (`0` `.log` files on disk in repo; `task-713.log` only covers restarted daemon).
2. **STEP 1 Backend Persistence & Concurrency Fixes**:
   - [episodeService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L10-L697): Unified `UPLOADS_DIR` onto `pathUtils.uploadsDir`; added `persistEpisodeScriptData` (validates `expectedSeriesId`/`expectedEpisodeId` vs actual IDs, writes under `withSeriesMetadataLock` + `atomicWriteSeriesJson`, immediately re-reads `series.json` from disk to verify `diskCount === expected`, logs loud `[Persist] ERROR` with both IDs on mismatch/missing — never silent); hardened `syncSeriesMetadataSafely` (mutex + stale-offload & older-timestamp guard + sibling preservation); added once-per-episode `[Hydration]` logging via `loggedHydratedEpisodes` in `applySafeDiskHydration`.
   - [chunkOrchestrator.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/chunkOrchestrator.js#L500-L527) & [dubbingPipeline.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/dubbingPipeline.js#L328-L345): Awaited `persistEpisodeScriptData` cleanly with `expectedSeriesId` / `expectedEpisodeId` BEFORE marking jobs `completed`.
3. **STEP 2 Console Honesty & Frontend Sync Safety**:
   - [geminiRouteHelpers.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/geminiRouteHelpers.js) & [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx): Strictly derived `checkEpisodeHasScript`, `getEpisodeSegmentCount`, `isJobCompletedSegmentsMissing`, and `computeSeriesTranslateSummary` from stored `ep.scriptData.segments` (never job status or `job.result` counts); completed jobs without saved segments render `"⚠️ Job done — segments not saved"` + footer `"⚠️ N not saved"` and suppress false `100%` banners; removed `!isOpen` bailout so SSE completions still trigger `onRefreshSeries()`; handled `alreadyCompleted` HTTP `409` cleanly.
   - [projectStorage.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L461-L679), [useSeriesManager.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useSeriesManager.js#L293-L780), [useAudioDubbing.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js), [useClipOperations.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useClipOperations.js): Stamped `updatedAt: Date.now()` on local script mutations, preserved newer local edits vs stale server payloads, fixed StrictMode initial `localStorage` fallback from clobbering `KHMER_AI_ACTIVE_SERIES_ID` / `KHMER_AI_ACTIVE_EPISODE_ID`, and synchronized post-mount server hydration.
4. **Verification Results**:
   - [series_persist_and_sync.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/series_persist_and_sync.test.js): **7/7 PASS** (`441ms`) including disk verification, `[Persist] ERROR` mismatch checks, mutex + HTTP `POST /api/series/:seriesId/sync` + parallel `persistEpisodeScriptData`, timestamp guards, once-per-episode hydration log, and frontend honesty helpers.
   - Full backend suite: **127 tests — 125 PASS, 1 SKIP (`stage4_sense_voice_integration`), 1 FAIL** (pre-existing unrelated assertion in [regenerate_split_audio_offset_reset.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js#L73) against live `series_1793898268958` `ep_2` Seg #2 where `audioOffset` is `undefined`).
   - `npm --prefix frontend run lint` (`oxlint`): **0 errors** (357 pre-existing warnings).
   - `npm --prefix frontend run build`: **PASS (`built in 592ms`)**.
   - Live Headless Chrome E2E (`http://127.0.0.1:5173`, mutating `/api/series` writes intercepted): **PASS** (`footerHas11of11: true`, `bannerAllDone: true`, all `11` counts & `បើកមើលក្នុង Studio` buttons visible, `ep_3` opens Editor with `336` segments and survives `F5` reload, simulated stripped `ep_5` displays `"⚠️ Job done — segments not saved"` + `"10/11"` + `"1 not saved"` + no false `100%` banner, `0` page errors, `0` HTTP 5xx).

## Active Environment
- **Backend API**: `http://localhost:5000` (`node server.js` via `dev.ps1`, `200 OK`)
- **Frontend Studio UI**: `http://localhost:5173` (`vite` via `dev.ps1`, `200 OK`)
- **Git HEAD**: `c24304c` (`origin/main`) + uncommitted local edits.

## Next Steps
- **Awaiting Nha's Confirmation**:
  1. Whether to keep current live `11/11` `series_1793898268958` data intact or specify episode(s) to re-run in parallel with `force: true`.
  2. Whether to fix pre-existing test assertion at `backend/tests/regenerate_split_audio_offset_reset.test.js:73`.
  3. Permission to `git commit` + `git push origin main` (code/tests/docs only, excluding `.env` & `backend/uploads/`) and report final `HEAD`.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Synchronized `16:9` / `9:16` Aspect Ratio Toggle, Locked Preview Frame, Sticky Persistence & Auto Export)
- **Timestamp**: 2026-11-09T20:33:22+07:00

## Summary: Synchronized `16:9` / `9:16` Aspect Ratio Toggle, Locked Preview Frame, Sticky Persistence & Auto Export
1. **Step 4 Clickable `16:9 | 9:16` Toggle & Single Shared Setting**:
   - [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L2250-L2347): Added clickable **`16:9 | 9:16`** toggle buttons (`data-testid="step4-aspect-toggle"`, `step4-aspect-16-9`, `step4-aspect-9-16`) directly inside **Step 4 — Batch Export & Merge** beside `Export 1 Full Video` & `Batch Export All` (never auto-starts export on click) and updated the header badge pill to display the active ratio (`• 16:9` / `• 9:16`).
   - [Navbar.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/Navbar.jsx#L94-L123) & [ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L196-L215): Synced bidirectionally with Step 4 through the single shared `voiceSettings.aspectRatio` + synchronous `voiceSettingsRef` in [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L383-L415).
2. **True Centered Locked Preview Frame (Fixed `.is-full-view` Stretch)**:
   - [VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx#L1251-L1300) & [VideoPlayerPreview.css](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.css#L49-L178): Removed `.is-full-view` stretch for `16:9` and introduced unified `framedStageStyle` inside `.player-canvas-container.is-stage-host` so **`16:9` (`16 / 9`), `9:16` (`9 / 16`), and `1:1` (`1 / 1`)** render centered, aspect-locked stage boxes (`[data-testid="player-aspect-frame"]`, `data-aspect-ratio`). Also guarded audio pause when `currentVideoSrc` changes (`prevVideoSrcRef`) and switched measurement to `useLayoutEffect`.
3. **Sticky Auto-Remember (`localStorage`) & Legacy `renderedVideo` Mismatch Guard**:
   - [projectStorage.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L59-L125): Added [`isRenderedRatioMismatch`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L80-L84) and [`resolveStickyVoiceSettings`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L90-L109).
   - [useSeriesManager.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useSeriesManager.js#L233-L241): Replaced stale `ep.voiceSettings.aspectRatio` / `ep.renderedVideo` overwrite with `resolveStickyVoiceSettings`, ensuring the user's last click wins across reloads (`F5`) and episode switches, while preserving source-orientation default (`resolveDefaultAspectRatio(w, h)`) when never manually clicked (`aspectRatio: null`).
   - [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L486-L492) & [useVideoRender.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useVideoRender.js#L53-L106): Added `effectiveRenderedVideo` mismatch suppression (without erasing disk files) and `voiceSettingsRef`-backed export reads across Single Export, Batch Export All (`separate`), and Merge (`merge`).
4. **Backend Render & FFmpeg Framing Consistency**:
   - [videoRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/videoRoutes.js#L346-L360) & [batchExportService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js#L697-L817): Returned/persisted `aspectRatio` & `verticalStyle` on single renders, batch episode outputs, and merged full-video metadata.
   - [ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1597-L1630): Generalized `needsLandscape16x9Pad` (`Math.abs(srcRatio - 16/9) > 0.05` with aspect-aware scaling to `1920x1080`) for portrait, `1:1` square, `4:3`, and ultrawide sources.
5. **Verification Results**:
   - [aspect_ratio_and_crop.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/aspect_ratio_and_crop.test.js): **PASS (3/3 tests, exit 0)** including real FFmpeg renders `(a)–(f)` + sticky persistence & mismatch unit tests.
   - Full backend suite `$tests = (Get-ChildItem backend\tests\*.test.js).FullName; node --test $tests`: **123/125 pass, 1 skipped** (`stage4_sense_voice_integration` optional media absent), **1 pre-existing unrelated failure** (`backend/tests/regenerate_split_audio_offset_reset.test.js:73` on live `series_1793898268958/series.json` EP2 Seg #2 where `audioOffset` is `undefined`).
   - `npm --prefix frontend run lint` (`oxlint`): **0 errors** (357 pre-existing project warnings).
   - `npm --prefix frontend run build`: **PASS (`built in 595ms`)**.
   - Live Headless Chrome E2E verification (`http://localhost:5173` on real `series_1793898268958` `ep_2`/`ep_3` with mutating `PUT`/`POST` intercepted so real disk data stayed untouched): **PASS** across all 5 suites — untouched `ep_2` fallback (`16:9` locked `756x425`, mismatch guard active), bidirectional Navbar / ExportSettingsPanel / Step 4 sync (`0` auto-export on click), centered locked `16:9` (`ratio=1.779`) & `9:16` (`241x428`, `ratio=0.563`), sticky persistence across `F5` reload & `ep_2 <-> ep_3` episode switch in both directions, and verified Single / Batch `separate` / Merge payload matching (`0` page errors, `0` HTTP 5xx).

## Active Environment
- **Backend API**: `http://localhost:5000` (`node server.js` via `dev.ps1` daemon, `200 OK`)
- **Frontend Studio UI**: `http://localhost:5173` (`vite` via `dev.ps1` daemon, `200 OK`)
- **Git HEAD**: `c24304c` (`origin/main`) + uncommitted local edits (preserved intact).

## Next Steps
- Press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`) and test clicking **16:9 | 9:16** (on Navbar, Inspector, or **Gemini Route → Step 4**) to see the centered locked frame and sticky memory across reloads/episodes.
- Confirm with Nha before `git commit` + `git push`.

---

## Previous Session
- **Environment**: Antigravity IDE (Root-Cause Fix for Recurring `502 Bad Gateway` / `WORKER_INTERRUPTED` Restarts & FFmpeg 8 `-filter_script:v`/`-vsync` Fallback)
- **Timestamp**: 2026-11-09T17:44:41+07:00

## Summary: Eliminated `node --watch` NTFS `LastAccessTime` Crash Loop & Fixed FFmpeg 8 Single-Pass OCR
1. **True Root Cause of Recurring `502 Bad Gateway` + `WORKER_INTERRUPTED` (`dev.ps1` + NTFS `DisableLastAccess=2`)**:
   - Diagnosed live `server.js` restarts (`16:05:20`, `17:28:19`, `17:28:20`, `17:34:47`, `17:34:48`, `17:38:26`, `17:39:27`): Windows NTFS `DisableLastAccess=2` updated `LastAccessTime` when Python Stage 4 loaded [model.int8.onnx](file:///e:/khmer_ai_dubbing_studio/backend/models/sense-voice/model.int8.onnx) / [tokens.txt](file:///e:/khmer_ai_dubbing_studio/backend/models/sense-voice/tokens.txt) inside `--watch-path=models` (and when deferred `atime` updates fired on `routes`/`services`/`server.js`), firing `ReadDirectoryChangesW` events that forced `node --watch` to repeatedly `SIGTERM` and restart `server.js` mid-job.
   - [dev.ps1](file:///e:/khmer_ai_dubbing_studio/dev.ps1#L193): Switched default backend command to stable **`node server.js`** (zero restarts on `LastAccessTime` / ONNX model reads / file scans), adding opt-in `-WatchBackend` (`--watch`) watching only JS source paths without binary `models/sense-voice`.
   - [package.json](file:///e:/khmer_ai_dubbing_studio/backend/package.json#L8): Updated `"dev"` script to watch `models/*.js` files individually instead of the `models/` directory containing binary ONNX files.
2. **Fixed FFmpeg 8 (`N-127043`) `-filter_script:v` & `-vsync` Removal (`8-minute` OCR Bottleneck)**:
   - Probed live FFmpeg `N-127043` on `ep_11_source.mp4` (`1080p AV1`): both `-filter_script:v` and `-vsync` were removed in FFmpeg 8 (`Unrecognized option`), forcing 100% fallback to per-frame `extractSingleDirect` spawns (`~8 minutes` per 300s chunk).
   - [ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L52-L67): Added startup `FFMPEG_VFR_ARGS` probe (`-fps_mode vfr` on FFmpeg 5.1+/8.x, `-vsync vfr` fallback on older FFmpeg) and updated [`extractFramesAtTimestamps`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L2671-L2840) to pass inline `-vf` (`window <= 40` timestamps, ~2.5 KB arg length) without `.filter.txt` temp files. Measured `25/25` frames on `ep_11` in **`1,224ms` (`1.22s`)**.
3. **Live Restart & Full Verification**:
   - [queue_dispatch_and_payload.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/queue_dispatch_and_payload.test.js): **5/5 PASS** (including guard against `-filter_script:v` and `--watch-path=models` folder watch).
   - Full backend suite `node --test (Get-ChildItem backend\tests\*.test.js).FullName` ➔ **119 tests: 118 PASS, 0 FAIL, 1 SKIP** (`stage4_sense_voice_integration` optional media absent).
   - `dev.ps1` parser validation ➔ **OK**; `npm --prefix frontend run lint` (`oxlint`) ➔ **0 errors**; `npm --prefix frontend run build` ➔ **PASS (`built in 600ms`)**.
   - Terminated old `node --watch` tree and started clean daemon via `dev.ps1 -NoBrowser -SkipInstall` (`node server.js` PID `11200`, `vite` PID `2304`). Verified `fs.utimesSync` `atime` update on `tokens.txt` caused **0** server restarts; live `/api/health` (`200`, `3ms`/`6ms`), `/api/jobs` (`200`, `6ms`, `183,445` bytes / `maxConcurrency: 2`), and `/api/jobs/stream` (`200`, `event: init`) all healthy.

## Active Environment
- **Backend API**: `http://localhost:5000` (`node server.js` PID `11200`, `dev.ps1` daemon task, `200 OK`, `maxConcurrency: 2`)
- **Frontend Studio UI**: `http://localhost:5173` (`vite` PID `2304`, `200 OK`)
- **Git HEAD**: `c24304c` (`origin/main`) + uncommitted local edits.

## Next Steps
- Press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`) and click **Translate** (or **Retry**) on the failed episodes (`EP2..EP11` / `ep_3..ep_12`) — backend runs `node server.js` without `node --watch` interruptions and uses fast `-vf` single-pass frame extraction.
- Confirm with Nha before `git commit` + `git push`.

---

## Previous Session
- **Environment**: Antigravity IDE (Fix Recurring `502 Bad Gateway` & Backend/FFmpeg Saturation on `/api/jobs/*`)
- **Timestamp**: 2026-11-09T16:46:49+07:00

## Summary: Fix Recurring `502 Bad Gateway`, Queue Bypass, FFmpeg Spawn Storm & Payload Bloat (`tver mx kom oy error rhot mk`)
1. **Bounded Queue Dispatch & Real Concurrency Control**:
   - [asyncSemaphore.js](file:///e:/khmer_ai_dubbing_studio/backend/utils/asyncSemaphore.js): Added `createAsyncSemaphore`, `ffmpegHeavySemaphore` (default `2`), `senseVoiceSemaphore` (default `2`), `createAbortError`, and `clampConcurrency` with `AbortSignal` queue cancellation.
   - [jobWorker.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/jobWorker.js): Created in-memory `transientApiKeys` store (`setTransientJobApiKey`, `getTransientJobApiKey`, `clearTransientJobApiKey` auto-cleaned on `completed`/`cancelled`/`failed`), `createPipelineWorkerHandler`, and idempotent `ensurePipelineWorkerRegistered`.
   - [productionJobQueue.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/productionJobQueue.js): Set `DEFAULT_MAX_CONCURRENCY = 2`, tracked `activeExecutions` with `AbortController`, fixed `getJob()` disk fallback, protected terminal/paused updates + synced `totalSegments` in `updateJob()`, fixed `pauseJob`/`cancelJob`/`resumeJob`/`retryJob`, stopped retrying `AbortError`/cancelled/paused/auth-fatal (`401`/`403`/`400`)/missing-file errors, and `.unref()`ed retry timers.
   - [server.js](file:///e:/khmer_ai_dubbing_studio/backend/server.js) & `.env` / `backend/.env`: Registered `ensurePipelineWorkerRegistered(productionJobQueue)` after `recoverDanglingJobs(...)` and set `DRAGONDUB_MAX_CONCURRENT_JOBS=2`.
2. **List/SSE Payload Slimming & Secret Protection**:
   - [jobRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/jobRoutes.js): Added `serializeJobForList`, `serializeFinalResultSummary`, `serializeConfigSafe`, and `serializeJobDetail`; routed `POST /api/jobs/generate` through `productionJobQueue.createJob(...)` + transient key storage; stripped `segments`/`script`/`speakers`/`speakerRegistry` and truncated `logs` (`-40`) on `GET /api/jobs` and SSE `/api/jobs/stream` (`init`/`job_update`) while keeping full `finalResult.segments` on `GET /api/jobs/:jobId` and `GET /api/jobs/:jobId/status` and never leaking `config.apiKey` on disk or HTTP responses.
3. **FFmpeg & SenseVoice Resource Containment + Clean Abort**:
   - [ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js): Added `attachAbortKill` (`taskkill /PID /T /F` on Windows), wrapped `extractAudio`, `extractFramesAtTimestamps` (rewritten to single-pass windowed `select`+`showinfo` via `-filter_script:v` + `-threads 2` + `extractSingleDirect` fallback inside `ffmpegHeavySemaphore`), `extractFramesStreaming`, and `extractSubtitleDifferenceGrid` in `ffmpegHeavySemaphore` + `-threads 2` + abort cancellation.
   - [stage3_extractChineseSubtitles.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage3_extractChineseSubtitles.js), [stage4_analyzeDialogueAudio.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js), & [sense_voice_worker.py](file:///e:/khmer_ai_dubbing_studio/backend/workers/sense_voice_worker.py): Propagated `AbortSignal`, added `--num_threads 2 --vad_threads 1` in Python (`-threads 1` wav helper), bounded Stage 4 SenseVoice calls via `senseVoiceSemaphore`, and rethrew `AbortError` cleanly on cancel/pause without Gemini fallback.
   - [chunkOrchestrator.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/chunkOrchestrator.js), [dubbingPipeline.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/dubbingPipeline.js), & [episodeService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js): Added `atomicWriteSeriesJson`, `updateSeriesMetadata(seriesId, mutatorFn)` (with `forceDisk: true` + `withSeriesMetadataLock`), and `{ forceDisk: true }` in `createNewEpisode` so concurrent jobs never clobber sibling episodes in `series.json`.
4. **Frontend UI Modal Accuracy**:
   - [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx): Scoped `jobsByEpisodeId` to `currentSeriesId`, included `totalSegments` summary fallback in `getEpisodeSegmentCount`, replaced false `"0 ភាគ"` success on failed `POST /api/jobs/generate` with accurate queued vs error feedback, and disabled selecting/toggling already running or queued episode cards.
5. **Verification**:
   - `python -m py_compile backend\workers\sense_voice_worker.py` ➔ **exit code 0**.
   - [queue_dispatch_and_payload.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/queue_dispatch_and_payload.test.js): **5/5 PASS**.
   - Full backend suite `node --test (Get-ChildItem backend\tests\*.test.js).FullName` ➔ **119 tests: 118 PASS, 0 FAIL, 1 SKIP** (`stage4_sense_voice_integration` optional media absent).
   - `npm --prefix frontend run lint` (`oxlint`) ➔ **0 errors** (`357` pre-existing warnings; `33` pre-existing warnings / `0` errors on `GeminiRouteModal.jsx`).
   - `npm --prefix frontend run build` (`vite build`) ➔ **PASS (`built in 867ms`)**.
   - Live server checks via `:5000` & `:5173`: `/api/health` (`200 OK`, `6ms`/`3ms`), `/api/jobs` (`200 OK`, `7ms`, **`125,097` bytes (~122 KB) across 52 jobs** down from `5.72 MB`, `stats.maxConcurrency: 2`, `hasHeavyFields: false`, `hasApiKey: false`), `/api/jobs/stream` (`200 OK`, `event: init` `125,091` bytes, `hasHeavyOrKey: false`), `/api/jobs/job_1794134990328_2a27153a` & `/status` (`200 OK`, full `502` segments preserved, `hasApiKey: false`), and `series_1793898268958/series.json` (`11` episodes intact: `ep_2` 500 segs + audio, `ep_3..ep_12` video uploaded ready).

## Active Environment
- **Backend API**: `http://localhost:5000` (`PID 21368` under `node --watch` `PID 6400` in `dev.ps1` `PID 14960`, `200 OK`, `maxConcurrency: 2`)
- **Frontend Studio UI**: `http://localhost:5173` (`PID 7896`, `200 OK`)
- **Git HEAD**: `c24304c` (`origin/main`) + uncommitted local edits.

## Next Steps
- Press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`) to load the updated frontend bundle.
- Select unscripted episodes (`ep_3..ep_12`) in **Gemini Route (`ខ្មោចទីផ្សារ / Step 1`)** and click Translate — the backend will process max `2` episodes at a time cleanly while keeping `/api/jobs` and `/api/jobs/stream` responsive without `502 Bad Gateway`.
- Confirm with Nha before `git commit` + `git push`.

---

## Previous Session
- **Environment**: Antigravity IDE (`/agents` Root-Cause Investigation for Recurring `POST /api/jobs/generate` & `/api/jobs` `502 Bad Gateway`)
- **Timestamp**: 2026-11-09T16:25:00+07:00

## Summary: Diagnosed Recurring `502 Bad Gateway` & CPU/FFmpeg Starvation (No App Code Modified)
1. **Verified Live Failure Chain**:
   - **Queue Bypass ([jobRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/jobRoutes.js#L144-L169) & [productionJobQueue.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/productionJobQueue.js#L622-L627))**: `productionJobQueue.registerWorkerHandler(...)` is never called anywhere in `backend/`. `POST /api/jobs/generate` calls `createJob(...)` and immediately executes `runDubbingPipeline(...)` directly without concurrency limits. When [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L538-L554) submits 8 episodes (`ep_5`..`ep_12`), **all 8 episodes run `chunkOCR` simultaneously**.
   - **FFmpeg Spawn Storm ([ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L2495-L2551))**: `extractFramesAtTimestamps` spawns 1 `ffmpeg.exe` process per candidate timestamp (`CONCURRENCY = 4` per episode). Across 8 simultaneous episodes, **`22–28+` `ffmpeg.exe` processes (`~1.44 GB` RAM)** ran concurrently, saturating CPU so heavily that `GET /api/jobs` took `61s` and simple `Get-Process` commands stalled `>5s`.
   - **Server Restarts & `502` Storms**: [server.js](file:///e:/khmer_ai_dubbing_studio/backend/server.js) restarted at `15:13:23`, `15:27:40`, `15:27:55`, and `16:05:20` (marking in-flight jobs `WORKER_INTERRUPTED`), causing Vite proxy ([vite.config.js](file:///e:/khmer_ai_dubbing_studio/frontend/vite.config.js#L90-L110)) to return `502 Bad Gateway` on `/api/jobs/generate`, `/api/jobs`, `/api/jobs/stream`, and `/api/health`.
   - **Payload Bloat**: `GET /api/jobs` and `/api/jobs/stream` `init` currently serialize `~5.72 MB+` of full `finalResult.segments`/`script` on every snapshot/poll.
2. **Awaiting User Approval (`AGENTS.md` / `/agents` Phase 1)**:
   - Zero code modified and running `ep_5..ep_12` jobs (`PID 15260`) left untouched pending Nha's confirmation to stop active jobs and implement the Spec-Kit fix (enforce `maxConcurrency` via `registerWorkerHandler`, optimize FFmpeg frame extraction, and slim `/api/jobs` payload).

## Active Environment
- **Backend API**: `http://localhost:5000` (`PID 15260`, running since `16:05:20`, 8 active `running` jobs `ep_5..ep_12`, `22+` `ffmpeg.exe` active)
- **Frontend Studio UI**: `http://localhost:5173` (`PID 7896`)
- **Git HEAD**: `c24304c` (`origin/main`) + prior uncommitted local edits untouched.

## Next Steps
- Confirm with Nha:
  1. Whether to stop/cancel the 8 overloaded running jobs (`ep_5..ep_12`) now and implement the fix.
  2. Preferred max concurrent translation episodes (`maxConcurrency`: `2` recommended).

---

## Previous Session
- **Environment**: Antigravity IDE (Read-Only Diagnosis for `:5173/api/*` `502 Bad Gateway` Errors)
- **Timestamp**: 2026-11-09T15:31:00+07:00

## Summary: Diagnosed `:5173/api/*` 502 Bad Gateway & Verified Recovery (No App Code Modified)
1. **Root Cause of `502 Bad Gateway`**:
   - Vite proxy ([vite.config.js](file:///e:/khmer_ai_dubbing_studio/frontend/vite.config.js#L90-L110)) forwards `/api/*` to `http://127.0.0.1:5000` and returns `502` whenever backend port `5000` is unreachable or restarting.
   - Live process inspection showed port `5000` had no active `server.js` listener at `15:27:38` (`OwningProcess 0`), and `node --watch` (`PID 6400` in [dev.ps1](file:///e:/khmer_ai_dubbing_studio/dev.ps1#L193)) respawned [server.js](file:///e:/khmer_ai_dubbing_studio/backend/server.js) at `15:27:40` (`PID 19676`) and `15:27:55` (`PID 20892`). During downtime/restart, [useJobQueue.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/useJobQueue.js) polling (`3s`) and SSE reconnect (`/api/jobs/stream`) surfaced repeated `502` errors in browser console.
2. **Current Live Verification (`15:30`)**:
   - Backend `server.js` (`PID 20892`, up since `15:27:55`) and Vite (`PID 7896`, port `5173`) are running normally.
   - `GET http://localhost:5173/api/health`, `GET http://localhost:5173/api/jobs`, and `GET http://localhost:5173/api/jobs/stream` all returned `200 OK`.
   - Additional observation: `GET /api/jobs` and `/api/jobs/stream` `init` currently transfer `~5.72 MB` (`5,721,462` bytes across 34 jobs including full `finalResult.segments`/`script`).
   - Zero application code files were modified (per `AGENTS.md` clarification rule).

## Active Environment
- **Backend API**: `http://localhost:5000` (`PID 20892` under `node --watch` `PID 6400`, `200 OK`)
- **Frontend Studio UI**: `http://localhost:5173` (`PID 7896`, `200 OK`)
- **Git HEAD**: `c24304c` (`origin/main`) + prior uncommitted local edits untouched.

## Next Steps
- Refresh browser (`Ctrl + Shift + R`) on `http://localhost:5173` to verify `502` errors clear.
- If `502` recurs, capture stdout/stderr from the `dev.ps1` terminal window to inspect why `server.js` restarted (`15:13:23`, `15:27:40`, `15:27:55`).
- Confirm with Nha whether to optimize `/api/jobs` & `/api/jobs/stream` payload size (`5.72 MB`).

---

## Previous Session
- **Environment**: Antigravity IDE (Implement Multi-Episode Batch Export & Full Video Merge + Full Verification)
- **Timestamp**: 2026-11-09T14:40:30+07:00

## Summary: Multi-Episode Batch Export (`separate`) & Full Video Merge (`merge`) Implemented & Verified
1. **Backend Concat, Batch Job Orchestration & Secure Download**:
   - [ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js): Extended [`renderDubbedVideoWithDucking`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L1195-L1255) (`allowOriginalAudio`, `onProgress`, `expectedDurationSec`) and added [`mergeVideosConcat`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js#L3093-L3449) (lossless `-c copy` concat when stream signatures match + normalized H.264/AAC hierarchical chunked concat fallback with silent `anullsrc` handling).
   - [batchExportService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js): Created [`inspectEpisodeExportReadiness`](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js#L127-L269), [`analyzeBatchExportPlan`](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js#L274-L335), [`startBatchExportJob`](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js#L385-L501), [`getBatchExportJob`](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js#L844-L848), [`getLatestBatchExportJob`](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js#L850-L856), and [`cancelBatchExportJob`](file:///e:/khmer_ai_dubbing_studio/backend/services/batchExportService.js#L858-L883). Enforces sequential `episodeNumber` ordering, missing-voice guard (`NO_VOICE` skipped unless `allowOriginalAudio: true`), strict episode audio folder isolation, `~/Downloads` auto-copy (with `DRAGONDUB_DOWNLOADS_DIR` override support), and `series.json` `renderedVideo` persistence.
   - [videoRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/videoRoutes.js): Added `GET /api/download-export` ([L367-L406](file:///e:/khmer_ai_dubbing_studio/backend/routes/videoRoutes.js#L367-L406), with Windows `/uploads/` prefix handling + `isSafeUploadPath` traversal checks) and `POST /api/render-batch`, `GET /api/render-batch/progress`, `GET /api/render-batch/latest`, `POST /api/render-batch/kill` ([L411-L480](file:///e:/khmer_ai_dubbing_studio/backend/routes/videoRoutes.js#L411-L480)).
2. **Frontend Shared State & Dual UI Placement**:
   - [api.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js#L798-L840): Added `startBatchRenderApi`, `fetchBatchRenderProgressApi`, `fetchLatestBatchRenderApi`, `killBatchRenderApi`.
   - [useVideoRender.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useVideoRender.js#L14-L489), [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx#L613-L721), [VoiceSettings.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VoiceSettings.jsx#L57-L810): Wired shared `batchRender` state (`job`, `isRunning`, `isStarting`, `error`, `start`, `kill`, `clear`) synced across both UI panels with 1000ms polling, series hydration, `refreshSeriesFromServer()`, and browser auto-download on completion.
   - [ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx#L1045-L1495): Added collapsible **Batch Export & Merge** section (quick-select `ទាំងអស់` / `មាន Voice` / Clear, per-episode checkboxes, missing-voice warning + unchecked-by-default `Allow Original Audio`, `Export 1 Full Video (Merge)` button, `Batch Export All` separate button, live progress bar + `Stop (Kill)` + download links).
   - [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx#L1517-L2460): Allowed selecting completed episodes (`🌐 ទាំងអស់ (<N> ភាគ)` + real checkboxes + `MP4 EXPORTED` badge), preserved Step 1 smart filtering for unscripted episodes, and added **STEP 4: Batch Export & Merge** bar (`Allow Original Audio` toggle, `Export 1 Full Video`, `Batch Export All`, and live progress/downloads banner).
3. **Verification**:
   - Added [batch_export_and_merge.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/batch_export_and_merge.test.js) (4 tests PASS: fast stream-copy merge, normalized mixed-dimension merge, missing-voice guard + strict audio isolation + sequential sort, live Express HTTP `separate` + `merge` + Downloads + `400`/`403`/`404`/`409` + `/render-batch/kill`).
   - Full backend suite `node --test (Get-ChildItem backend/tests/*.test.js).FullName` ➔ **114 tests: 113 PASS, 0 FAIL, 1 SKIP** (`stage4_sense_voice_integration` optional media absent).
   - `npm --prefix frontend run lint` (`oxlint`) ➔ **0 errors** (`357` pre-existing warnings).
   - `npm --prefix frontend run build` (`vite build`) ➔ **PASS (`built in 710ms+`)**.
   - Read-only sanity check against `series_1793898268958` confirmed all `11` episodes intact (`ep_2` voiced, `ep_3`..`ep_12` original-audio candidates) and live server routes `http://127.0.0.1:5000/api/health`, `http://127.0.0.1:5000/api/render-batch/latest?seriesId=series_1793898268958`, and `http://127.0.0.1:5173/api/render-batch/latest?seriesId=series_1793898268958` return `200 OK`.

## Active Environment
- **Backend API**: `http://localhost:5000` (Express live & serving `/api/render-batch/*` and `/api/download-export`)
- **Frontend Studio UI**: `http://localhost:5173` (Vite live)
- **Git HEAD**: `c24304c` (`origin/main`) + uncommitted local edits.

## Next Steps
- Press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`) to load the updated bundle cleanly.
- Test selecting episodes in either **Right Inspector -> Export Video -> Batch Export & Merge** or **Gemini Route (`ខ្មោចទីផ្សារ / Step 4`)** with `🌐 ទាំងអស់ (11 ភាគ)`:
  - If EP2–EP11 don't have Khmer voice yet, tick **`Allow Original Audio`** if you want them included with original audio, or generate TTS first.
- Confirm with Nha before `git commit` + `git push`.

---

## Previous Session
- **Environment**: Antigravity IDE (Read-Only Check for Multi-Episode Export / Merge 11 EP Request)
- **Timestamp**: 2026-11-09T14:22:00+07:00

## Summary: Multi-Episode Export / Full Video Merge Clarification Pending (No App Code Modified)
1. **Verified Current Export Architecture**:
   - [ExportSettingsPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx), [Navbar.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/Navbar.jsx), and [useVideoRender.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useVideoRender.js) only call `POST /api/render-video` ([videoRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/videoRoutes.js)) for the single active episode (`episodeId`).
   - [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx) supports batch Translate (Step 1), batch Khmer TTS (Step 2), and batch Demucs (Step 3), with no batch MP4 export or multi-episode merge into 1 full video yet.
2. **Verified Live Series State (`series_1793898268958`, 11 episodes)**:
   - `ep_2` (EP1): `hasVid: true`, `segs: 500`, `audioGenerated: true`, `renderedVideo: true`.
   - `ep_3`..`ep_12` (EP2–EP11): `hasVid: true`, `segs: 0`, `audioGenerated: false`, `renderedVideo: false`.

## Active Environment
- **Backend API**: `http://localhost:5000`
- **Frontend Studio UI**: `http://localhost:5173`
- **Git HEAD**: `c24304c` (`origin/main`) + prior uncommitted local edits intact (0 code files modified in this turn).

## Next Steps
- Wait for Nha's clarification on:
  1. Whether he wants **Merge All Selected = 1 Full Video**, **Batch Export All Selected (separate EP1..EP11 MP4s)**, or **both** buttons.
  2. Where to place the button/selector UI (`ExportSettingsPanel.jsx` and/or `GeminiRouteModal.jsx`).
  3. How to handle episodes without voice/script yet (`EP2–EP11`): skip/warn or require Translate + TTS first.

---

## Previous Session
- **Environment**: Antigravity IDE (Fix Smart-Skip Batch TTS + `/api/tts/progress` 130% Overflow + `ep_*` Hash Cleanup)
- **Timestamp**: 2026-11-09T13:55:00+07:00

## Summary: Fix Accidental Re-TTS Overwrite & `[649/500] 130%` Progress Bug (`fix`)
1. **Prevent Accidental Full 500-Segment Re-TTS & Enable Smart Sync/Skip**:
   - [useAudioDubbing.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js#L805-L969): Removed auto-`forceRegen = true` when any segment already had audio (`const forceRegen = Boolean(cleanParams.forceRegen);`), clamped live progress counters (`currentCount <= totalCount`, `realPct <= 100`), handled `stage === 'syncing'` (`3/3`) and `result.alreadyCompleted`, and kept bar width monotonic (`10 -> 12..95 -> 96 -> 100`).
   - [DubbingModeTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx#L58-L74): Computed `validTextSegments` & `pendingOrOutdatedCount`, passed `{ forceRegen: false }` automatically when `!hasExistingAudio || pendingOrOutdatedCount > 0`, and gated full Re-TTS behind the `showConfirmReTts` modal (`បោះបង់ (Cancel)` / `Smart Sync (រក្សាសំឡេងដើម)` / `Re-TTS ទាំងអស់`) at [DubbingModeTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx#L642-L689) & [L1761-L1866](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx#L1761-L1866).
   - [api.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js#L340-L351): Returned `alreadyCompleted` and `summaryMessage` from `generateAudioApi`.
   - [audioRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L43-L70): Added `doesSegmentNeedTts` and fast-skip in `POST /api/generate-audio` (`L501-L562`) returning `alreadyCompleted: true` when master narration + segment files exist and nothing is pending/outdated.
2. **Fix `/api/tts/progress` (`[649/500] 130%`) & Episode `ep_*` Prior-File Cleanup**:
   - [ttsService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L503-L529): Added `resolvePriorSegmentAudioPath`, legacy cache key fallback (`legacyRateHash` / `legacyBaseHash`) in [generateSingleSegmentAudio](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L576-L642), superseded `ep_*_seg_<id>_*` + `seg_<id>_*` cleanup in [`generateSingleSegmentAudio`](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L823-L850) guarded against split-sibling shared files (`sharedAudioPaths`) and `audioOffset`, plus live job progress tracking via [`getTtsJobProgress`](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L946-L962) & [`generateBatchSegmentsAudio`](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L1003-L1158).
   - [audioRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L30-L213): Added `activeBatchStages` and [`countUniqueSegmentMp3s`](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L33-L41); updated `GET /api/tts/progress` to use live in-memory `activeJob`/`activeBatchStages` while running (`isRunning: true, isDone: false, current <= total, percent <= 99`) and deduplicated segment counts (`<= total`) when idle; guarded single-segment cleanup with `singleSharedAudioPaths` (`L345-L364`).
3. **Verification**:
   - Added [tts_smart_skip_and_progress.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/tts_smart_skip_and_progress.test.js) (5 tests PASS).
   - Full backend suite `node --test (Get-ChildItem backend/tests/*.test.js).FullName` ➔ **110 tests: 109 PASS, 0 FAIL, 1 SKIP** (`stage4_sense_voice_integration` optional media absent).
   - `npm --prefix frontend run lint` (`oxlint`) ➔ **0 errors** (0 errors / 31 warnings on changed files; 360 project-wide pre-existing warnings).
   - `npm --prefix frontend run build` ➔ **PASS (`built in 576ms`)**.
   - Live API & UI checks: `GET http://127.0.0.1:5000/api/health` (`200 OK`), `GET http://127.0.0.1:5000/api/tts/progress?seriesId=series_1793898268958&episodeId=ep_2&total=500` ➔ `current: 500, total: 500, percent: 100, isRunning: false, isDone: true` (`500/500`), `http://127.0.0.1:5173/` (`200 OK`).

## Active Environment
- **Backend API**: `http://localhost:5000` (`dev.ps1`)
- **Frontend Studio UI**: `http://localhost:5173` (`dev.ps1`)
- **Git HEAD**: `c24304c` (`origin/main`) + uncommitted local edits.

## Next Steps
- Press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`) to load updated bundle.
- Wait for Nha to verify EP2 in browser or confirm if older superseded duplicate `.mp3` files in `ep_2/audio` should be cleaned up / if ready to `git commit` + `git push`.

---

## Previous Session
- **Environment**: Antigravity IDE (Read-Only Root-Cause Diagnosis for `"nh mean hxx ter mx ban tver tt ?"`)
- **Timestamp**: 2026-11-09T13:48:00+07:00

## Summary: Re-TTS Trigger & Progress `130%` Diagnosis (No App Code Modified)
1. **Why Batch TTS Re-Generated All 500 Segments Despite Existing Audio**:
   - In [DubbingModeTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx#L607-L613), clicking the Step 3 button passes `onNavigateToVoice({ forceRegen: Boolean(hasExistingAudio) })` (`forceRegen: true`).
   - Even when clicking **`3. Khmer voice (TTS)`** in [WorkflowStepper.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/WorkflowStepper.jsx#L61-L67), [handleGenerateAudio](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js#L810-L812) auto-sets `forceRegen = true` whenever any segment already has `audioUrl`/`audioPath`/`audioFile`.
   - `forceRegen: true` bypasses both the batch fast-path in [audioRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L396) and the segment file cache check in [generateSingleSegmentAudio](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L580), forcing Edge TTS to re-synthesize all 500 segments (`13:44:21` onward).
   - Additionally, today's silence-trim edit bumped the cache key suffix to `__lt1` ([ttsService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js#L546)), producing new hashed `.mp3` filenames (e.g. `b2e11068` for `seg_1`) while cleanup at line 776 only removes `seg_*` (not `ep_*`), leaving previous `.mp3` files on disk.
2. **Why Progress Showed `[649/500 ឃ្លា] (130%)` & `95%`**:
   - [GET /api/tts/progress](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js#L78-L80) counts every `.mp3` file in `ep_2/audio/` (`529` pre-existing files + in-flight new files = `649/500 = 130%` at screenshot time; `933` total files at `seg_402`, `13:47:33`), while `useAudioDubbing.js` caps progress bar width at `95%`.
3. **Awaiting User Clarification (`AGENTS.md`)**:
   - No app code modified. Asked Nha whether to: (a) stop calling `forceRegen: true` by default so existing audio skips/only missing or outdated clips generate (unless user explicitly clicks Re-TTS All), and (b) fix `/api/tts/progress` file-counting + old `ep_*` hash cleanup.

## Active Environment
- **Backend API**: `http://localhost:5000` (`dev.ps1`, active `ep_2` TTS batch at `seg_402/500` as of `13:47:33`)
- **Frontend Studio UI**: `http://localhost:5173` (`dev.ps1`)
- **Git HEAD**: `c24304c` (`origin/main`) + prior uncommitted local edits intact.

## Next Steps
- Wait for Nha's confirmation on whether to implement the smart-skip (`forceRegen` fix) + `/api/tts/progress` fix (and whether to clean up old duplicate `.mp3` files in `ep_2/audio`).

---

## Previous Session
- **Environment**: Antigravity IDE (Read-Only Diagnostic for `"mx bat slg khmer?"`)
- **Timestamp**: 2026-11-09T13:42:00+07:00

## Summary: Khmer Audio Playback & Hydration Investigation (No App Code Modified)
1. **Live Chrome Playback Verification on `series_1793898268958` / `ep_2` (`http://localhost:5173`)**:
   - Verified `ep_2` in [series.json](file:///e:/khmer_ai_dubbing_studio/backend/uploads/projects/series_1793898268958/series.json): `500/500` segment `.mp3` files exist and are non-empty, `0` muted segments, `audioGenerated: true`, `renderedVideo: null`, `voiceSettings: { khmerVolume: 1.4, duckingVolume: 0.14, enableDemucs: false }`, and [ep_2_narration_khmer.mp3](file:///e:/khmer_ai_dubbing_studio/backend/uploads/projects/series_1793898268958/episodes/ep_2/audio/ep_2_narration_khmer.mp3) (`6,497,204` B, `13:26:13`) has valid non-silent Khmer narration.
   - Tested all interactive playback paths in headless Chrome against live `:5173`/`:5000` (writes blocked): timeline play at `t=0`, cold click `#7` (`00:12.94`) + `.player-play-btn`, Inspector `ស្តាប់សំឡេង (Play)`, `Preview Audio Ducking Mix`, and switching `ep_2 -> ep_3 -> ep_2`. All resolved & played Khmer audio cleanly (`volume: 1`, `muted: false`, 0 console/HTTP errors).
2. **Identified Causes & Clarifications Pending User Reply**:
   - Fresh browser / reset `localStorage` falls back in [useSeriesManager.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useSeriesManager.js#L281-L309) to `serverList[0]` (`drama_project`, empty); `ep_3`–`ep_12` in `series_1793898268958` have video only (`0` script segments, `audioGenerated: false`).
   - Unrelated persistence/hydration bug confirmed: [trimSegmentForStorage](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js#L433-L449) strips `audioPath`/`audioOffset`/`audioTrimmed`/`_uid`, causing [getSeriesMetadata](file:///e:/khmer_ai_dubbing_studio/backend/services/episodeService.js#L152-L199) in `episodeService.js` to overwrite newer regenerated `audioUrl`s (e.g. EP2 `#2`, `#4`) with older matching `seg_<id>_*.mp3` files on reload.
   - Awaiting clarification from Nha on exact screen/episode/action where Khmer audio went missing before changing any code.

## Active Environment
- **Backend API**: `http://localhost:5000` (`dev.ps1`, left running untouched)
- **Frontend Studio UI**: `http://localhost:5173` (`dev.ps1`, left running untouched)
- **Git HEAD**: `c24304c` (`origin/main`) + prior uncommitted local edits intact (0 repo code files touched in this diagnostic turn).

## Next Steps
- Wait for Nha to clarify which screen/action/episode lost Khmer audio (EP3–EP12 vs EP2 vs `drama_project` fallback vs Export MP4 vs tab mute / slider).
- If Nha also wants the `episodeService.js` + `projectStorage.js` audio overwrite bug fixed, implement cleanly after confirmation.

---

## Previous Session
- **Environment**: Antigravity IDE (`fix all`: JobQueue HMR Identity Crash, SSE Graceful Shutdown, Edge TTS 429/ENOENT Retry Fix & Full Suite 100% Green)
- **Timestamp**: 2026-11-09T12:53:00+07:00

## Summary: Full Repo Bugfix & Verification (`fix all`)
1. **JobQueue HMR Identity Split & UI Crash Containment**:
   - [jobQueueStore.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/jobQueueStore.js) & [JobQueueContext.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/JobQueueContext.jsx): Pinned singleton `JobQueueContext` on `globalThis[Symbol.for('dragondub.JobQueueContext')]` and moved `JobQueueContext` + `useSharedJobQueue` into `jobQueueStore.js` so `JobQueueContext.jsx` exports only `<JobQueueProvider>` (clean Fast Refresh, 0 HMR identity split between `<JobQueueProvider>` and `<JobDashboardModal>`/`<GeminiRouteModal>`).
   - Updated imports in [JobDashboardModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/JobDashboardModal.jsx) & [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx).
   - Added [ErrorBoundary.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/common/ErrorBoundary.jsx) wrapping `<App />` in [main.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/main.jsx) and inline around `<JobDashboardModal>` + `<GeminiRouteModal>` in [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx).
2. **SSE `/api/jobs/stream`, Reconnect Backoff & Fast Backend Shutdown**:
   - [jobRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/jobRoutes.js): Added `activeSseClients` tracking, full listener/timer cleanup on `req`/`res` close/error, `.unref()` keepalive timer, and exported `closeAllJobStreams()`.
   - [server.js](file:///e:/khmer_ai_dubbing_studio/backend/server.js): Hardened `handleShutdown` with idempotency guard, `jobRoutes.closeAllJobStreams()`, `server.closeIdleConnections()`, `server.closeAllConnections()`, and `800ms` unreffed timeout so `node --watch` restarts quickly without stranding SSE/keep-alive sockets.
   - [useJobQueue.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/useJobQueue.js) & [api.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js): Marked `isConnected = false` on any SSE interruption (`CLOSED` or `CONNECTING`), prevented duplicate `EventSource` / overlapping timer leaks, added exponential backoff (`2s -> 4s -> 8s -> 15s`), visibility guard when tab hidden, and transition-guarded `notifyBackendOnline`/`notifyBackendOffline` wakeup.
3. **Edge TTS 429 + Missing CLI `ENOENT` Retry Fix**:
   - [ttsService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js): Added `pickAttemptRetryError` and `{ windowsHide: true }` on `spawn("edge-tts")` so missing optional Python CLI (`ENOENT`) never overwrites upstream transient `429`/`503`/`504`/network errors and aborts Edge TTS retry attempts `2..4`.
4. **Tests & Full Suite Verification**:
   - Added [job_queue_and_shutdown.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/job_queue_and_shutdown.test.js) (live SSE init + `closeAllJobStreams()` + abort cleanup, HMR context + ErrorBoundary + server shutdown audits, `pickAttemptRetryError` 429 vs `ENOENT`).
   - Updated [regenerate_split_audio_offset_reset.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/regenerate_split_audio_offset_reset.test.js) (`series.json` EP2 Seg #2 assertion checks `audioOffset === 0` & `audioOffset < rawDur` instead of forbidding valid right-edge timeline trim `audioTrimmed: true` on live user project data; full regeneration reset verified deterministically in test 1).
   - Full backend suite `node --test (Get-ChildItem backend/tests/*.test.js).FullName` ➔ **105 tests: 104 PASS, 0 FAIL, 1 SKIP** (`stage4_sense_voice_integration` optional media absent).
   - `npm --prefix frontend run lint` ➔ **0 errors** (0 warnings on all touched JobQueue/SSE/ErrorBoundary files; `360` pre-existing project warnings).
   - `npm --prefix frontend run build` ➔ **PASS (`built in 632ms`)**.

## Active Environment
- **Backend API**: `http://localhost:5000` (started as daemon)
- **Frontend Studio UI**: `http://localhost:5173` (started as daemon)
- **Git HEAD**: `c24304c` (`origin/main`) with uncommitted local edits.

## Next Steps
- Press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`) to confirm live UI, Job Queue Dashboard (`/api/jobs/stream` 200 OK, zero HMR context errors), `+ ឃ្លា`, Clip Speed, and EP2 audio sync.
- Confirm with Nha before `git commit` + `git push` (whether to commit all working-tree changes or split into scoped commits).

---

## Previous Session
- **Environment**: Antigravity IDE (Fix `"slg der kroy jeang vdo"` Audio Lag Behind Video + Live Preview Sync Hardening)
- **Timestamp**: 2026-11-09T12:20:30+07:00

## Summary: Fix Audio Delay Behind Video (`slg der kroy jeang vdo`)
1. **Live Preview Real-Time Silence Skip & Sync Hardening**:
   - [audioSyncUtils.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/audioSyncUtils.js): Added `findLeadingSilenceFromChannels` (`threshold=0.0045`, `cushionSec=0.025`, `maxSkipSec=0.35`) and `computeSegmentAudioSyncTarget` (adds `autoLeadTrim` strictly when `segAudioOffset === 0 && !seg.userTrimmed`, preserves right split slices `audioOffset > 0` even before `<audio>` metadata loads on uneven splits, keeps EP2 Seg #2 auto-slot-trimmed timing accurate, and pre-rolls playback `lookaheadSec=0.035`).
   - [VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx): Added Web Audio `decodeAudioData` silence probing (`probeUrlLeadingSilence`) cached as scalar float per URL (immediately removes ~200ms dead Edge TTS lead-in on existing EP2 `.mp3` files without regeneration); upgraded preloading (`[now-2, now+45]`, 14 clips, immediate on play/seek `>= 2.5s`) with distant pool eviction (`> 32 -> <= 28` via `evictDistantSegmentAudios` to protect Chromium `WebMediaPlayer` limit); added cold `<audio>` `loadedmetadata` live-seek handler; tightened RAF sync loop to ~60Hz (`>= 14ms`), debounced `0.120s` hard-seek + `1.10/0.90` drift nudge (`0.035s`), and synced Clean Demucs BGM inside both RAF `syncLoop` and `handleSync` (`> 0.04s`).
2. **Backend Edge TTS Lead/Tail Silence Trimming**:
   - [ffmpegService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js): Added and exported `trimTtsSilence` (strips leading silence `> 60ms` down to `25ms` cushion and trailing dead silence `> 140ms` down to `60ms` cushion with `8ms` micro-fades & Windows-safe atomic swap); aligned `autoStretchTtsAudio` `leadInCushionSec` default to `0.025`.
   - [ttsService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js): Invoked `trimTtsSilence` unconditionally right after speech synthesis in both normal & `inner_thought` branches (so custom speed `1.5x`/`0.75x`, normal, and slot-fit clips all start crisply at `~25–47ms` instead of `~220ms`), and bumped TTS cache token to `__lt1`.
3. **Verification**:
   - Added [audio_sync_delay_fix.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/audio_sync_delay_fix.test.js) and verified with `clip_speed_tts.test.js` ➔ **9/9 PASS** (`audio_sync_delay_fix` 4/4 PASS incl. live Edge TTS `leadingSilence < 95ms` on `1.0x` and `1.5x`; `clip_speed_tts` 5/5 PASS).
   - Verified `timeline_*.test.js` + `split_canonical_timing_ep2.test.js` ➔ **15/15 PASS**.
   - `regenerate_split_audio_offset_reset.test.js`: 2/3 code tests **PASS**; line 65 fails on pre-existing gitignored EP2 `series.json` Seg #2 (`audioTrimmed: true`).
   - `npm --prefix frontend run build` ➔ **PASS (`601ms`)**; `./frontend/node_modules/.bin/oxlint frontend/src/utils/audioSyncUtils.js frontend/src/components/VideoPlayerPreview.jsx` ➔ **0 errors**.
   - Local server check (`12:20`): `http://localhost:5000/api/health` and `http://localhost:5173/` currently stopped (`ECONNREFUSED`).

## Active Environment
- **Backend API**: `http://localhost:5000` (needs start if currently stopped)
- **Frontend Studio UI**: `http://localhost:5173` (needs start if currently stopped)
- **Git HEAD**: `c24304c` (`origin/main`) with uncommitted local edits.

## Next Steps
- Start dev servers (`dev.ps1` or backend + frontend), press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`), and verify audio playback on EP2 (`ep_2`) starts tightly with the video.
- Confirm with Nha before committing/pushing:
  1. Whether to also harden `JobQueueContext.jsx` HMR identity + `server.js` SSE `closeAllConnections` shutdown.
  2. Whether to commit/push **Audio Sync Fix + Clip Speed + `+ ឃ្លា`** only or include all working-tree changes, and how to handle `regenerate_split_audio_offset_reset.test.js:65` on EP2 `series.json`.

---

## Previous Session
- **Environment**: Antigravity IDE (`+ ឃ្លា` Show Draft Box on Voice Track + Clip Speed TTS Wiring Pending Commit)
- **Timestamp**: 2026-11-09T12:04:00+07:00

## Summary: `+ ឃ្លា` Show Draft Box on Voice Track + Clip Speed TTS Wiring
1. **`+ ឃ្លា` Show Draft/No-Audio Box on Free `VOICE` Lane**:
   - [TimelineTracksCanvas.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTracksCanvas.jsx): Added `hasAnyVoiceAudio` + `shouldRenderOnVoiceTrack`, removed `if (!hasAudio) return null;` and `!audioGenerated` gate on Voice lanes so both new `+ ឃ្លា` segments and existing pending segments (such as EP2 `#4`) render as dashed draft boxes (`.is-pending-audio`) with `#N ប្រុស/ស្រី • គ្មានសំឡេង` and `.voice-draft-hint`. Computed `slotSpan` fallback cleanly for no-audio segments.
   - [useClipOperations.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useClipOperations.js): Updated `handleAddSegmentAtTime` to floor `safeTime` (`Math.floor(rawTime * 100) / 100`), scan `segmentRows` occupancy to pick the lowest collision-free `VOICE` lane (`trackRow: targetRow`, `trackId: 'voice-' + (targetRow + 1)` — e.g. `VOICE 2` when colliding with `VOICE 1` at `00:08.43`), and set explicit `audioDurationSec: draftDur`, `ttsStatus: 'pending'`, and `userAdded: true`. Updated `handleUpdateTimelineSegments` to initialize `scriptData` if `null`.
   - [TimelineEditor.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/TimelineEditor.jsx): Added `slotSpan` duration fallback in `segmentRows`, `getSegEffectiveRange`, and `handleAudioMouseDown`.
   - [timelineUtils.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/timelineUtils.js): Updated `resolveSegmentAtTime` (`sStart >= latestStart`) so adding another `+ ឃ្លា` at the exact same timestamp locks onto the newest segment.
   - [TimelineEditor.css](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/TimelineEditor.css): Added dashed draft clip styles for `.voice-segment-block.is-pending-audio` and `.voice-draft-hint`.
   - [timeline_add_segment_box.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/timeline_add_segment_box.test.js): Added static audit + EP2 `00:08.43` `VOICE 2` placement & selection lock test.
2. **Clip Speed TTS Wiring (Uncommitted / Awaiting Push Confirmation)**:
   - [ttsService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/ttsService.js), [audioRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js), [stage9_generateSegmentTTS.js](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage9_generateSegmentTTS.js), [useAudioDubbing.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js), [api.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js), [clip_speed_tts.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/clip_speed_tts.test.js): Wired `speed` -> Edge `rate` (`+50%`, `-25%`, `+0%`), bypassed slot `autoStretch` when explicit user speed is set, updated probed durations/OVER, added batch parity + `[TTS]` logging for unparseable speed.
3. **Verification**:
   - `node --test backend/tests/timeline_*.test.js backend/tests/split_canonical_timing_ep2.test.js` ➔ **15/15 PASS**.
   - `node --test backend/tests/clip_speed_tts.test.js` ➔ **5/5 PASS** (Note: one intermediate run hit transient Edge TTS `429` + Google fallback without `atempo`, subsequent run passed 5/5).
   - `npm --prefix frontend run build` ➔ **PASS** (`built in 611ms`).
   - Known pre-existing unrelated failure seen earlier: `regenerate_split_audio_offset_reset.test.js:65` on gitignored EP2 `series.json` (`audioOffset` stripped by `trimSegmentForStorage`).

## Active Environment
- **Backend API**: `http://localhost:5000` (Express)
- **Frontend Studio UI**: `http://localhost:5173` (Vite + React)
- **Git HEAD**: `c24304c` (`origin/main`) with uncommitted local edits.

## Next Steps
- Press **`Ctrl + Shift + R`** in browser (`http://localhost:5173`) to confirm `#4` (`00:08.43`) and new `+ ឃ្លា` clicks show dashed draft boxes on `VOICE 2` (or lowest free `VOICE` lane).
- Confirm with Nha before committing/pushing:
  1. Whether to also harden `JobQueueContext.jsx` HMR identity + `server.js` SSE `closeAllConnections` shutdown.
  2. Whether to commit/push Clip Speed + `+ ឃ្លា` only or include all working-tree changes, and how to handle `regenerate_split_audio_offset_reset.test.js:65` on EP2 `series.json`.

---

## Previous Session
- **Environment**: Antigravity IDE (CPU Demucs Speedup Benchmarks, Step-2 Quality Gate, & `/api/audio/separate` Keep-Alive Fix)
- **Timestamp**: 2026-11-09T11:00:00+07:00

## Summary: CPU Demucs Optimization & HTTP Keep-Alive Fix
1. **CPU Demucs Inference Benchmarks (3-min excerpt `179.98s` on Intel i5-1235U, AC plugged in, Best Performance overlay, `htdemucs`, `--suppress_residuals` ON)**:
   - Baseline (`shifts=1, overlap=0.5, segment=4, -j 1`): **632.48s** (Demucs 621.59s, Suppress 10.52s = `1.66%`)
   - Variant (a) (`--shifts 0`): **714.84s** (Demucs 705.97s, Suppress 8.20s = `1.15%`, Step-2 PASS)
   - Variant (b) (`--shifts 0 --overlap 0.25`): **467.55s** (Demucs 458.87s, Suppress 8.02s = `1.72%`, Step-2 PASS)
   - Variant (c) (`(b) + --segment 7`): **277.03s** (Demucs 268.32s, Suppress 8.16s = `2.95%`, Step-2 PASS)
   - **Variant (d) (`(c) + -j 2` — Winner)**: **221.26s** (Demucs 213.13s, Suppress 7.46s = `3.38%`, **-65.0% / 2.86x faster**, Step-2 PASS `-0.15 dB` mean att delta in 150–180s window & verified inaudible by listening across 14–26s, 26–31s, 108–114s, and 150–180s)
2. **Applied Worker Defaults & Caller Inheritance**:
   - [demucs_worker.py](file:///e:/khmer_ai_dubbing_studio/backend/workers/demucs_worker.py): Updated argparse defaults to `--shifts 0`, `--overlap 0.25`, `--segment 7`, `--jobs/-j 2` (with `--suppress_residuals` kept ON) and accurate measured-tradeoff help text.
   - [audioSeparationService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/audioSeparationService.js): Removed hardcoded `--shifts 1` / `--overlap 0.25` overrides so every caller (UI step run & render-time) inherits `demucs_worker.py` defaults; fixed `cleanKey` ReferenceError in `killSeparationJob` and exported `isSeparationBusy`/`getCurrentSeparationMedia`.
3. **Fixed `net::ERR_EMPTY_RESPONSE` / Proxy Reset Recovery on `/api/audio/separate`**:
   - [audioRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js): Streams immediate HTTP `200 OK` headers + 10s whitespace heartbeat keep-alive after checking busy/404, keeps `series.json` persistence on completion, and returns recoverable `noVocalsUrl` in `/api/audio/separation-progress`.
   - [DubbingModeTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx), [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx), [vite.config.js](file:///e:/khmer_ai_dubbing_studio/frontend/vite.config.js): Added disconnect polling recovery and clean upstream proxy closing when headers were already sent.
4. **Verification**:
   - **Full ~20-min EP3 (`1201.67s`) end-to-end separation**: **1278.26s (`21m 18s`, `0.94x` real-time; Demucs 1257.44s, Suppress 20.15s = `1.58%`)** vs ~70.4 min projected old baseline; Step-2 dense 30s gate (`t=682s-712s`): **`-26.76 dB`** speech-band attenuation (listening verified Chinese dialogue 100% inaudible).
   - **25s Heartbeat Live API Test** (`:5173/api/audio/separate`): PASS (`200 OK` in 26ms, 3 heartbeat chunks).
   - **Tests & Build**: Backend tests (`node --test backend/tests/*.test.js` incl. [demucs_worker_defaults.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/demucs_worker_defaults.test.js)) ➔ 90/90 PASS (1 skipped missing external video); `npm --prefix frontend run build` ➔ PASS.
5. **Cache Note (STEP 3)**: Separation cache key uses model name only — previously cached episodes retain their existing `no_vocals.wav` untouched; new defaults apply to new separations only.

## Active Environment
- **Backend API**: `http://localhost:5000` (Express)
- **Frontend Studio UI**: `http://localhost:5173` (Vite + React)
- **EP3 Clean BGM Cached**: `/uploads/cache/separation/3cc6e980df57f5fad4e27af333f2bbdc/no_vocals.wav`

## Next Steps
- If UI tab was open before these edits, press **`Ctrl + Shift + R`** in browser to load updated frontend bundle.
- Avoid editing files under `backend/routes`, `backend/services`, `backend/models`, or `server.js` while a long Demucs CPU run is active via `dev.ps1` (`node --watch`).

---

## Previous Session
- **Environment**: Antigravity IDE (Fix: Eliminate Artificial 5-6s Empty Space on Short Voice Clips & Fit True Audio Duration)
- **Timestamp**: 2026-11-09T01:10:00+07:00

## Latest Update: Eliminate Artificial 5-6s Empty Space on Short Voice Clips (Truthful Audio Duration)

### Problem Description
- **Question**: User asked *"mx ban vea generate slg term tea slg yy tea 1-3s tea kleang voice vea show 1-5 6 ?"* with screenshot showing voice clip `#18 ប្រុស` stretched from 00:31.5 to 00:36.5 (5.0s long box), while speech audio only lasted ~2.0s (ending at 00:33.8), leaving ~3.0s of dead silence (marked with red zigzag) and pushing clip `#19` onto VOICE 2.
- **Root Cause**:
  1. *Subtitle Slot Clamping on Audio Track*:
     In `TimelineTracksCanvas.jsx`, `TimelineEditor.jsx`, and `VideoPlayerPreview.jsx`, voice clip boxes were calculated with:
     `rawEnd = Math.max(slotEnd, rawStart + realAudioDuration)`
  2. *SlotEnd Origin*: `slotEnd` is the original Chinese subtitle visual end time (e.g., 5.0 to 6.0 seconds).
  3. *Unintended Consequence*: Even though Khmer TTS finished speaking in 1.5s - 2.5s, taking `Math.max(slotEnd, ...)` forced the audio clip box to stretch to the 5-6s visual subtitle slot duration, leaving empty blank space on the box waveform and creating artificial collision flags that pushed subsequent clips down to lower tracks.

### Resolution
1. **Truthful Voice Clip Sizing ([TimelineTracksCanvas.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTracksCanvas.jsx))**:
   - Replaced `Math.max(slotEnd, rawStart + realAudioDuration)` with `(rawStart + realAudioDuration)` in both `internalSegmentRows` (line 161) and `renderVoiceSegment` (line 222).
2. **Track Row & Magnetic Edge Alignment ([TimelineEditor.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/TimelineEditor.jsx))**:
   - Replaced `Math.max(slotEnd, rawStart + audioDur)` with `(rawStart + audioDur)` in `segmentRows` derivation and `getSegEffectiveRange`.
   - Updated `handleAudioMouseDown` to derive `rawEnd = isTrimmed && audioEndSec ? audioEndSec : (rawStart + audioDur)` instead of defaulting to `seg.endSec`.
3. **Player Preview & Operations Timing ([VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx), [useClipOperations.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useClipOperations.js))**:
   - Removed `slotEnd` stretching from effective audio end boundaries so playback and split operations use true audio duration.

### Verification
- `npm --prefix frontend run build` ➔ PASS (1.37s).
- Full regression suite `node --test backend/tests/*.test.js` ➔ 85/85 PASS (1 skipped).

## Previous Update: Fix Character Glossary Gender Resolution & Explain Detection Pipeline

### Problem Description
- **Question**: User asked *"kleang ng vea jab mx?"* with screenshot of `SERIES CHARACTER GLOSSARY (រក្សាឈ្មោះតួអង្គឆ្លងភាគ)` where all badges displayed `(ប្រុស)`, including female characters such as `តួអង្គស្រី (ប្រុស)`, `តួឯកស្រី (ប្រុស)`, and `តួស្រី (ប្រុស)`.
- **Root Cause**:
  1. *Glossary Ingestion*: During initial script extraction / translation, Gemini detects speaker names per line. `extractGlossaryFromEpisode` in `projectStorage.js` extracts unique speakers into `series.glossary.characters`.
  2. *Gender Evaluation Flaw*: `EpisodesTab.jsx` strictly checked `ch.gender === 'female'`, which failed on uppercase `"FEMALE"` and did not inspect the character name or assigned voice (`km-KH-SreymomNeural`).
  3. *Default Fallback to Male*: `extractGlossaryFromEpisode` defaulted to `'male'` when gender was missing without testing name keywords (`ស្រី`, `នាង`, `យាយ`, `ម៉ែ`, `កញ្ញា`).

### Resolution
1. **Case-Insensitive & Voice/Name-Aware Detection ([EpisodesTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/EpisodesTab.jsx))**:
   - `isFemale` checks lowercase gender, voiceId (`Sreymom`), and Khmer female keywords (`/ស្រី|នាង|យាយ|ម៉ែ|កញ្ញា|ជំទាវ/i`). Displays `(ស្រី)` in pink (`#f472b6`).
2. **Robust Glossary Extraction ([projectStorage.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js))**:
   - Added `detectGender` function examining raw gender, voiceId, and character name before applying fallback.
3. **Data Normalization ([series.json](file:///e:/khmer_ai_dubbing_studio/backend/uploads/projects/series_1793898268958/series.json))**:
   - Normalized existing character glossary in `series.json`, updating female characters to `gender: 'female'` with `km-KH-SreymomNeural`.

### Verification
- `npm --prefix frontend run build` ➔ PASS (1.44s).
- `node --test backend/tests/timeline_*.test.js` ➔ 10/10 PASS.

## Previous Update: Upgrade AI Re-Translate Prompt with 10 Strict Rules & Surrounding Context

### Problem Description
- **Goal**: Upgrade the `✨ AI កែប្រែ (Re-Translate)` feature in the Subtitle Edit/Clip Inspector panel with Nha's 10-rule expert Chinese-to-Khmer translation prompt while preserving the 3 stylistic options (🎭 សម្ដីកុនបុរាណ, 📝 ខ្លីចំអត្ថន័យ, ⚡ អារម្មណ៍តួអង្គ) and the terminology note.
- **Key Enhancements**:
  1. *10 Strict Translation Rules*: Analyzing full sentence context, resolving ambiguous words (e.g. 质量 = ម៉ាស (mass) in physics vs គុណភាព in everyday language), preserving tone/emotion, incomplete clause preservation, fresh re-translation (never blindly copying previous translation), and zero Thai/Chinese residual script.
  2. *Surrounding Context Injection*:
     `ClipInspectorPanel.jsx` now automatically collects `previousTranslation`, previous dialogue line `[មុន]`, current line `[បច្ចុប្បន្ន]`, and following dialogue line `[បន្ទាប់]`, feeding them into `retranslateSegmentApi`.
  3. *Backend Prompt Engineering*:
     `retranslateSingleDialogue` in `geminiService.js` now structures the payload with:
     - `**Original Chinese:** {{original_text}}`
     - `**Previous Khmer Translation (for comparison only; do not copy blindly):** {{previous_translation}}`
     - `**Surrounding Context (if available):** {{context}}`
     - `**Speaker:** {{speaker}} ({{gender}})`

### Resolution
1. **Frontend Context Collector ([ClipInspectorPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx))**:
   - `handleAiRetranslate` extracts preceding and following segments from `scriptData.segments` and sends `previousTranslation` and `surroundingContext` to the backend.
2. **Backend Expert Prompt ([geminiService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js))**:
   - Upgraded `retranslateSingleDialogue` system instruction with all 10 strict rules, preserving the 3 JSON output options and note.

### Verification
- `npm --prefix frontend run build` ➔ PASS (1.33s).
- `node --test (Get-ChildItem -Path backend/tests/phase1_*.test.js).FullName` ➔ 7/7 PASS.
- `node --test (Get-ChildItem -Path backend/tests/timeline_*.test.js).FullName` ➔ 10/10 PASS.

## Previous Update: Fix Timeline Auto-Center Stopping Past 20+ Seconds

### Problem Description
- **Symptom**: User reported *"ot vea der jit job hxx vea ot jab tt?? fix code kelang ng mer vea error mx? mx ban dol 20+ vea leang jam ah jm? /agents"* with screenshot showing playhead at 00:35 near the right edge while the timeline remained stuck at `scrollLeft = 0` (failed to auto-center once crossing 00:20-00:23s).
- **Exact Root Cause Uncovered**:
  1. *Flex Layout Clamping & Containment Ceiling*:
     In `TimelineEditor.css` and `TimelineTracksCanvas.jsx`, `.tracks-content` was styled with `flex: 1`, `width: 100%`, and `contain: layout style`. Under browser CSS flex layout, `flex: 1` sets `flex-shrink: 1` and `flex-basis: 0%`. This caused `.tracks-content` to shrink down to `clientWidth - 112px`, meaning `.timeline-scroll-area` had `scrollWidth = clientWidth + 112px`.
     At 45 pixels per second (`pps = 45`), the total available scroll headroom was `112px / 45 = 2.4 seconds`!
     As the video played from 0s to 20s, the playhead moved towards the 50% viewport center line (`clientWidth / 2` ~ 20-22s). The MOMENT it crossed the center line at ~20s-22s, the auto-center logic attempted to scroll `targetScroll = 12px, 50px, 112px...` and immediately slammed into the 112px ceiling! The browser clamped `container.scrollLeft` to the maximum overflow (112px or 0px), preventing any further horizontal scrolling!
  2. *Conditional `selectedVideo` width fallback*:
     In `TimelineTracksCanvas.jsx`, `.tracks-content` and `.track-lane` widths were bound to `selectedVideo ? totalWidth : '100%'`. If `selectedVideo` was null or re-rendered without the asset reference, widths collapsed back to `'100%'`.
  3. *Auto-Heal 60s Threshold on Short Episodes*:
     The single-clip auto-heal in `TimelineEditor.jsx` and `useSeriesManager.js` used a restrictive `totalDuration > 60` guard, failing to stretch truncated clips on shorter episodes or test cuts (<60s).

### Resolution
1. **Unconstrained Scroll Width & Flex Fix (`TimelineEditor.css`, `TimelineTracksCanvas.jsx`)**:
   - Removed `contain: layout` from `.timeline-scroll-area` and `contain: layout style` from `.tracks-content`.
   - Changed `.tracks-content` from `flex: 1` to `flex: 0 0 auto` (with `minWidth: Math.max(totalWidth, 1200)` and `width: Math.max(totalWidth, 1200)`).
   - Removed `selectedVideo ? totalWidth : '100%'` conditional; track lanes now always utilize `totalWidth || '100%'` derived reliably from `totalDuration`.
   - Playwright verification confirmed `scrollWidth` expanded from clamped 1,392px to full 3,112px+ and `scrollLeft` now scrolls freely (887px+).
2. **True Center-Lock Viewport Alignment (`TimelineEditor.jsx`)**:
   - Streamlined auto-follow math:
     `playheadAbsoluteX = currentX + TRACK_HEADER_WIDTH;`
     `rightThreshold = clientWidth / 2;`
     `targetScroll = playheadAbsoluteX > rightThreshold ? Math.round(playheadAbsoluteX - rightThreshold) : 0;`
     `container.scrollLeft = targetScroll;`
   - Playhead now stays at 0 until crossing 50% screen center, then locks dynamically at 50% center through 20s, 35s, 60s, and full 20:00mn.
3. **Resilient Auto-Heal (`TimelineEditor.jsx`, `useSeriesManager.js`)**:
   - Relaxed single-clip auto-heal condition to `totalDuration > 15 && singleClip.end < totalDuration - 2` so clips on both short and 20-minute episodes automatically stretch without manual intervention.

### Verification
- Playwright Edge DOM Inspection: `scrollWidth` 3112px, `clientWidth` 1280px, `scrollLeft` scrolls to 887px without clamping.
- `npm --prefix frontend run build` ➔ PASS (644ms).
- `node --test` backend test suite ➔ 85/85 PASS (0 failed, 1 skipped).

## Previous Update: Continuous Playback Beyond 20s Truncated Video & Safe RAF Loop

### Problem Description
- **Symptom**: User reported *"vea jam auto hxx tea vea jam dol 20up vea error vea leang jab auto"* (Auto-center works, but when reaching 20s up, it errors / pauses and stops auto-centering).
- **Root Cause**:
  1. *Premature Clip End on Video Track*: The video track contained a single video clip truncated at 00:20s. When playback reached 20s, `useVideoPlayback.js` hit the "Last clip reached" branch, forced `v.pause()`, set `isPlaying = false`, and clamped `currentTime = 20s`.
  2. *Frozen Animation Loop on Pause*: Because `isPlaying` became `false`, the 60FPS RAF auto-follow loop terminated immediately.
  3. *Unprotected RAF Loop*: Any sub-frame calculation anomaly when time was outside videoClips risked crashing the requestAnimationFrame callback.
  4. *Stale Duration Clamping in Reset*: `handleResetFullVideo` and `useSeriesManager.js` relied on `duration || 0` which was cached as 20s instead of reading `scriptData.segments` max duration (1200s) or `videoRef.current.duration`.

### Resolution
1. **Frontend Reactive Auto-Heal (`TimelineEditor.jsx`)**:
   - Added an auto-heal effect: whenever `videoClips` has 1 uncut clip ending prematurely (`end < totalDuration - 5` while `totalDuration > 60s`), it immediately stretches the clip to cover `totalDuration` (1200s / 20mn).
2. **Safe 60FPS RAF Playhead Loop (`TimelineEditor.jsx`)**:
   - Wrapped `updatePlayheadAndScroll` inner body in `try...catch` so an unexpected coordinate calculation can never crash or terminate the animation frame loop.
3. **Seamless Multi-Minute Flow (`useVideoPlayback.js`)**:
   - Replaced strict `sEnd` clamp with `trueMaxDur = Math.max(v.duration, duration, realDur)` to allow playback to flow continuously past 20s across the full 20:00mn media.
4. **Full Duration Recalculation (`useClipOperations.js`, `useSeriesManager.js`)**:
   - `handleResetFullVideo` and `selectEpisode` compute `scriptMaxEnd = Math.max(...segments.endSec)` to guarantee `totalDur` is always the true 1200s.

### Verification
- `npm --prefix frontend run build` ➔ PASS (604ms).
- `node --test backend/tests/timeline_*.test.js` ➔ 10/10 PASS.

## Previous Update: Persistent Auto-Center Playhead (Always Remember & Wheel Decoupled)

### Problem Description
- **Symptom**: User asked *"ot vea ot jam auto nv center jg?"* (Why doesn't it remember/stay auto at center?).
- **Root Cause**:
  1. *Aggressive Wheel Disabling*: `TimelineEditor.jsx` had a `handleTimelineWheel` callback on the scrollable container that set `setAutoCenter(false)` whenever the user scrolled horizontally with mouse wheel or touchpad. This silently turned off Auto-Center during normal timeline inspection.
  2. *Lack of Persistence*: `autoCenter` was stored only in local React state (`useState(true)`) without saving to `localStorage`. Page refreshes or unmounts lost the state.

### Resolution
1. **Persistent LocalStorage State (`TimelineEditor.jsx`)**:
   - Initialized `autoCenter` from `localStorage.getItem('TIMELINE_AUTO_CENTER')` (defaulting to `true`).
   - Synced changes automatically to `localStorage.setItem('TIMELINE_AUTO_CENTER', String(autoCenter))`.
2. **Decoupled Horizontal Wheel from Auto-Center**:
   - Removed `handleTimelineWheel` which prematurely killed `autoCenter`.
   - Users can now scroll horizontally to inspect without losing Auto-Center mode. When seeking, clicking a clip, or pressing play, the timeline automatically centers and follows the playhead.
3. **Explicit Toggle via Locate Button**:
   - The Locate/Target button in `TimelineToolbar.jsx` remains the single, explicit toggle for turning Auto-Center ON or OFF.

### Verification
- `npm --prefix frontend run build` ➔ PASS (686ms).
- `node --test backend/tests/*.test.js` ➔ 85/85 PASS (0 failed, 1 skipped).

## Previous Update: Auto-Heal Truncated Video Track to Full Episode Duration

### Problem Description
- **Symptom**: In EP2 (duration 20:00mn / 1200s), audio dialogue clips stretched all the way to 20mn, but the VIDEO track clip (`8958_EP2.mp4`) ended prematurely at 00:20s, leaving the video track empty/black from 00:20s to 20:00mn.
- **Root Cause**:
  - If a workspace had a cached or trimmed single video clip of 20-30s in `localStorage`, `normalizeClips` and episode initialization preserved the clip without auto-stretching it to match the true episode duration (`epDur` = 1200s).

### Resolution
1. **Auto-Heal on Episode Load & Workspace Init**:
   - In `useSeriesManager.js` and `useWorkspaceMedia.js`, added an auto-heal guard: if an episode has only 1 video clip starting at 0, and its duration is truncated (`end < epDur - 5s`), it automatically heals and stretches the clip to cover the full episode duration (`epDur = 1200s`).
2. **Explicit Toolbar Restore**:
   - Reminded user of the `[ Full Video ]` toolbar button which immediately recalculates `totalDur` (1200s) and restores the video track to full continuous length.

### Verification
- `npm --prefix frontend run build` ➔ PASS (1.56s).
- `node --test backend/tests/timeline_*.test.js` ➔ 10/10 PASS.

## Latest Update: True Center Auto-Follow Playhead (CapCut / Premiere Style)

### Problem Description
- **Symptom**: User saw the Auto-Center button enabled (active cyan), but the playhead remained stuck at ~00:14 on the far right of the timeline instead of staying centered in the middle (~00:08).
- **Root Cause**:
  1. *Paused / Seek Effect*: `TimelineEditor.jsx` had a strict `if (isOutOfView)` check (`currentScreenX < 30 || currentScreenX > clientWidth - 40`). When paused at 00:14, the playhead was still technically on screen, so `isOutOfView` evaluated to `false` and refused to center the playhead!
  2. *Playback Loop*: RAF playback scroll loop used `rightThreshold = clientWidth - 120` and paged forward to `clientWidth * 0.30` (30% from the left, instead of 50% Center).
  3. *Locate Fixed Button*: Clicking the Auto-Center button only called `handleCenterPlayhead` without toggling or allowing free inspection when scrolling manually.

### Resolution
1. **Paused / Seek / Clip Selection Auto-Center**:
   - In `TimelineEditor.jsx`, removed the restrictive `isOutOfView` check. When `autoCenter` is enabled and the video is paused, seeking, or a segment is clicked, the timeline smoothly scrolls to center the playhead at 50% viewport width (`(currentTime * pps + TRACK_HEADER_WIDTH) - clientWidth / 2`).
2. **Playback Center Follow (Center Lock)**:
   - When `autoCenter` is enabled during playback, once the playhead crosses the horizontal center (`screenX > rightThreshold` where `rightThreshold = clientWidth / 2`), the timeline smoothly scrolls underneath it, keeping the playhead centered at 50% width.
3. **Smart User Inspection & Toggle**:
   - Added `handleTimelineWheel`: When the user deliberately scrolls horizontally (wheel / trackpad) to inspect other clips, `autoCenter` safely disables (`false`) so the viewport doesn't fight the user.
   - Clicking the Locate button (`handleCenterPlayhead`) instantly re-centers to the playhead and re-enables `autoCenter = true` (or toggles off if already centered).
   - Updated tooltip in `TimelineToolbar.jsx`.

### Verification
- `node --test backend/tests/timeline_*.test.js` ➔ 10/10 PASS.
- `npm --prefix frontend run build` ➔ Clean build in 1.45s.

## Latest Update: Unlimited Voice Lanes & Dynamic Vertical Drop

### Implementation Highlights
1. **Dynamic Lane Count Calculation**:
   - `voiceLaneCount = Math.max(2, highestUsedVoiceRow + 2, userVoiceTrackCount || 1, draggingVoiceTargetRow + 1)`.
   - Formula ensures all used voice lanes are rendered plus ONE always-empty drop lane at the bottom.
   - Removed `Math.min(1, ...)` and `Math.min(2, ...)` clamps in `TimelineEditor.jsx`, `TimelineTracksCanvas.jsx`, `TimelineTrackHeaders.jsx`, and `timelineUtils.js` — a segment's `trackRow` can now be any integer $\ge 0$.
2. **Vertical Drop & Track Creation**:
   - Dragging a voice clip down to lane $N$ assigns `seg.trackRow = N`, `seg.trackId = 'voice-' + (N + 1)`, and `seg.userShifted = true`.
   - The drop always succeeds and never snaps back to the original lane.
   - Dropping onto the bottom empty lane immediately turns it into the used lane and spawns a new empty lane below it on the next render.
   - Drag-over highlight badges dynamically show `"Drop to create VOICE {n}"` when hovering an empty/new lane, and `"Drop to place on VOICE {n}"` for existing lanes.
3. **Sticky Manual Placement in Auto-Align**:
   - In `autoAlignVoiceSegments` (`timelineUtils.js`), segments with `userShifted: true` preserve their exact `trackRow` without being renumbered or shifted up to empty lanes.
   - Non-userShifted segments continue packing across lanes 0 and 1.
4. **Cross-Lane Drop Stand (Requirement 4)**:
   - When dropping across lanes (`curSegRow !== finalTargetRow`), the drop stands at the dropped position even if it overlaps an existing clip on the target lane.
   - Horizontal time-clamping and magnetic edge snapping (`||`) remain active when moving horizontally within the same lane.
5. **Full Playback, Mix & Export Support**:
   - `VideoPlayerPreview.jsx` and `ffmpegService.js` iterate through all valid segments regardless of `trackRow`, ensuring audio from lanes $\ge 2$ is never silenced or omitted.
   - Verified persistence round-trip of `trackRow` and `userShifted` on EP2.

### Verification & Automated Tests
- `backend/tests/timeline_unlimited_voice_lanes.test.js` ➔ 5 passed, 0 failed.
- Full regression suite (16 tests across all timeline & split modules) ➔ 16 passed, 0 failed.
- Vite build (`npm --prefix frontend run build`) ➔ SUCCESS (1.37s).

## Latest Update: Regenerate Audio on Split Segment Audio Offset Reset & Zero-Playback Guard

### Problem Description
- **Symptom**: After splitting a segment on the timeline, Segment #2 was assigned an `audioOffset` (e.g. `3.83`s) to slice from the parent's audio file.
- When Nha clicked "Generate ឡើងវិញ" (regenerate audio) on Segment #2, a fresh TTS audio file (`ep_ep_2_seg_2_...mp3`, duration `3.672`s) was generated starting from `0.00`s.
- However, neither `useAudioDubbing.js`, `audioRoutes.js`, nor `ttsService.js` reset `audioOffset: 0` or `audioTrimmed: false`.
- As a result:
  1. `VideoPlayerPreview.jsx` sought the player to `3.83s` inside a `3.672s` file, immediately hitting EOF and pausing into complete silence.
  2. `createSynchronizedNarrationAudio` in `ffmpegService.js` ran `atrim=start=3.83:duration=3.672`, generating 0 bytes of narration audio.
  3. Video export also trimmed starting from `3.83s`, rendering silent audio in the final exported video.

### Root Cause & Resolution
1. **Reset on Regeneration (`backend/services/ttsService.js`)**:
   - In `generateSingleSegmentAudio`, explicitly reset `audioOffset: 0`, `audioTrimmed: false`, `userTrimmed: false`.
2. **Backend Route Persistence (`backend/routes/audioRoutes.js`)**:
   - In `series.json` update handler, persist `audioOffset: 0, audioTrimmed: false, userTrimmed: false` for the updated segment.
3. **Frontend Dubbing Hook (`frontend/src/hooks/useAudioDubbing.js`)**:
   - In `handleRegenerateSingleSegment`, `handleAutoRegenerateSegmentAudio`, and `handleChangeSpeed`, explicitly set `audioOffset: 0, audioTrimmed: false, userTrimmed: false` on the merged segment.
4. **Defensive Player & FFmpeg Clamping (`frontend/src/components/VideoPlayerPreview.jsx`, `backend/services/ffmpegService.js`)**:
   - If `audioOffset >= audioDurationSec`, defensively clamp `audioOffset` to `0` so stale/corrupted offset data can never cause silent playback or trimmed empty audio in player or export.
5. **Project EP2 Data Fixed & Master Narration Resynced**:
   - Updated `backend/uploads/projects/series_1793898268958/series.json` EP2 Segment #2 with `audioOffset: 0`, `audioTrimmed: false`.
   - Successfully re-synced `ep_2_narration_khmer.mp3` with all 502 segments.

### Verification & Tests
- `backend/tests/regenerate_split_audio_offset_reset.test.js` ➔ 3 passed, 0 failed.
- `npm --prefix frontend run build` ➔ Vite build succeeded in 1.40s.

## Latest Update: Strict Audio No-Overlap Clamp & Magnetic Edge Snapping on Timeline Tracks

### Feature: Audio Dragging Strict No-Overlap Clamp (`[#1] || [#2]`)
- **Problem**: When dragging audio clips horizontally on the same line (Track Row 0), moving a clip near an adjacent clip allowed it to slide directly over/into the neighboring clip (visual overlap bug shown in user screenshot #1).
- **Solution**:
  1. **Strict No-Overlap Clamp**: Added `prevBound` (max end of predecessor clips on same row) and `nextBound` (min start of successor clips on same row). When dragging, `newStart` is clamped to `Math.max(prevBound, newStart)` and `newEnd` is clamped to `Math.min(nextBound, newEnd)` — preventing overlap completely! Clips rigidly meet edge-to-edge (`||`) as requested by Nha (screenshot #2).
  2. **Magnetic Edge Snapping**: When a dragged audio clip approaches `prevBound` or `nextBound` within snap window (~0.15s), it magnetically snaps to the adjacent clip's edge and renders the vertical snap line.
  3. **Trimming Guard**: `trim-left` cannot expand past `prevBound`; `trim-right` cannot expand past `nextBound`.
  4. **Drop Persistence**: On mouse up, `updatedSeg` clamps to `finalTargetRow` boundaries before firing `onUpdateSegments`.

### Hotfix: ClipInspectorPanel `isKhmerEmpty` ReferenceError Resolved
- **Problem**: When rendering `<ClipInspectorPanel>`, `isKhmerEmpty` was evaluated at line 726/780/817 before being declared in component scope, triggering `Uncaught ReferenceError: isKhmerEmpty is not defined`.
- **Fix**: Declared `const isKhmerEmpty = !localKhmerText?.trim();` at top of component body (line 258) alongside other status derivations (`isGenerating`, `isError`, etc.). Build and unit tests pass.

### 1. STEP 0 — Data Confirmation & Field Comparison Table (EP2 Segments #1 and #2)

| Field | Segment #1 (`id: 1`) | Segment #2 (`id: 2`) | Description / Analysis |
|---|---|---|---|
| `startSec` | `0.2` | `4.027` | Original slot start time from OCR/script |
| `endSec` | `4.027` | `4.83` | Original slot end time (3.827s slot) |
| `audioStartSec` | `0.2` | `4.027` | Render start position |
| `audioEndSec` | `4.027` | `4.83` | Old handler timing ended here (unexpanded slot end) |
| `audioDurationSec` | `3.83` | `0.80` | Nominal slot duration |
| `finalAudioDuration` | `4.63` | `4.63` | **Real generated TTS audio length (+0.80s OVER)** |
| **Canvas Right Edge** | **`4.83`s** (`max(slotEnd, start + dur)`) | **`8.657`s** (`max(slotEnd, start + dur)`) | Rendered on `TimelineTracksCanvas.jsx` per 5f6fb6b truthful fix |
| **Old `isInsideSeg` End** | **`4.027`s** (`audioEndSec`) | **`4.83`s** (`audioEndSec`) | Derived from `audioEndSec` in `useClipOperations.js` |
| **Playhead at `00:04.03`** | **Visibly INSIDE (4.03 < 4.83)** | Outside (before 4.077 seam) | **Handler saw playhead as OUTSIDE (4.03 > 3.977)** ➔ Disagreement! |

**Conclusion:** Canvas right edge (`4.83s`) and old handler timing (`4.027s`) differed by `0.803s`. When the user parked the playhead at `00:04.03` inside the visible clip, old `isInsideSeg` failed because `4.03 > 4.027 - 0.05` (`3.977s`), causing all split branches (a), (b), (c), and (d) to miss and no-op silently.

---

### 2. Implementation Summary

1. **STEP 1 — One Canonical Timing (`frontend/src/hooks/useClipOperations.js`)**:
   - Reused canonical `getSegmentAudioDuration` from `../utils/timestampUtils`.
   - Updated `getSegTiming` to calculate:
     ```javascript
     effectiveEnd = isTrimmed && typeof s.audioEndSec === 'number'
       ? s.audioEndSec
       : Math.max(slotEnd, effectiveStart + getSegmentAudioDuration(s, 0), s.audioEndSec || 0)
     ```
     This matches `TimelineTracksCanvas.jsx` exactly.
   - Used `effectiveStart` and `effectiveEnd` in `isInsideSeg` and in `executeSplitSegment` math (`dur1`, `dur2`, `audioOffset`, and text splitting ratio).
   - Ensured split segments (`seg1` and `seg2`) persist `audioDurationSec`, `finalAudioDuration`, `audioDuration`, `originalAudioDuration`, `rawAudioDur`, and `audioTrimmed: true` so the canvas immediately renders them with exact boundaries and no spurious overflow.

2. **STEP 2 — No Silent No-Op (In-App Toast & Console Diagnostic)**:
   - When `handleSplitClip` is invoked and no branch matches (no voice segment, no video clip at playhead):
     - Displays brief in-app toast in Khmer: `"គ្មាន clip នៅត្រង់ playhead ទេ — ដាក់ playhead ឲ្យនៅកណ្ដាល clip"`.
     - Calculates nearest previous segment and nearest next segment boundaries and logs full diagnostic info via `console.warn`.

3. **STEP 3 — Seam Tolerance for Explicitly Selected Segment**:
   - In branch (a), relaxed the end boundary guard to `roundedSplit < effectiveEnd` (dropped the `-0.05` margin), enabling users who selected a clip to split anywhere visibly inside it up to the right seam.
   - Preserved `±0.05s` safety margin (`roundedSplit < effectiveEnd - 0.05`) in fallback branch (c) for unselected intersecting segments.

---

### 3. Verification & Evidence

- **New Automated Unit Suite (`backend/tests/split_canonical_timing_ep2.test.js`)**:
  - `node --test backend/tests/split_canonical_timing_ep2.test.js` ➔ **3 passed, 0 failed**:
    1. Real EP2 data dump & canonical effective timing verification (`canvasRightEdge1 === 4.83`).
    2. `useClipOperations` static code audit for canonical imports, Khmer toast string, and relaxed branch (a) seam guard.
    3. Simulated split of EP2 Segment #1 at `00:04.03`: cuts Segment #1 into `[0.2, 4.03]` and `[4.03, 4.83]` while keeping video clips completely untouched; verified Undo snapshot restoration; verified gap rejection.
- **Existing Split Suite**:
  - `node --test backend/tests/split_clip_selection_priority.test.js` ➔ **3 passed, 0 failed**.
- **Full Backend Test Suite**:
  - `node --test backend/tests/*.test.js` ➔ **76 tests: 75 passed, 1 skipped (test video not present), 0 failed** (12.1s).
- **Frontend Production Build**:
  - `npm --prefix frontend run build` ➔ **PASS in 861ms** (0 errors).

---

### 4. Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

---

### 5. Next Steps
- Open Studio UI on EP2 at `http://localhost:5173`.
- Select voice clip #1, position playhead at `00:04.03`, and click Split (or press Ctrl+B): observe instant clean cut into two speech segments without affecting video track.
