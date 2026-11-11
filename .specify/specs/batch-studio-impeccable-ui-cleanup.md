# Spec: Batch Generate Studio Impeccable / Unslop UI Cleanup & Unification

## 1. Problem & Intent (Why)
- **Context & Background**: `frontend/src/components/dashboard/GeminiRouteModal.jsx` ("BATCH GENERATE STUDIO") accumulated redundant UI chrome: duplicate header cascade pills (`Auto Cascade`), duplicate Script Setup collapse toggles, cards nested inside cards (3-level borders in the 2x2 Script Setup grid), 3 oversized competing colored gradient step buttons stacked above secondary buttons, and a duplicate multi-step status tracker in the modal footer.
- **Problem Statement**: Apply `/impeccable critique`, `/impeccable distill`, `/impeccable quieter`, and `unslop` principles ("One Feature = One Home, One Status = One Place") to clean up and unify `GeminiRouteModal.jsx` without removing any feature, state variable, prop, event handler, or status calculation logic.

## 2. User Scenarios & Stories (What)
- **Scenario 1 (Clean Header)**: User opens Batch Generate Studio and sees a clean header with ONLY Title (`"BATCH GENERATE STUDIO"`), ONE key pool status pill (`"X/Y Keys Ready (Z RPM Pool)"`), optional Quota Console trigger, and Close button (`"✕"`) — without the duplicate `"Auto Cascade"` pill.
- **Scenario 2 (Single Episode Quick-Select Row)**: Below the header, user sees one compact row: `"ជ្រើសរើសភាគ៖ ២ ភាគ (2 EPs) | ៤ ភាគ (4 EPs) | ភាគនៅសល់ | 🌐 ទាំងអស់ | លុប"`.
- **Scenario 3 (Unified Collapsible Script Setup Bar)**:
  - **Collapsed state**: Renders a single summary line ONLY (`⚡ Fast OCR • Mode A: សន្ទនាតួអង្គ • បុរាណចិន / Xianxia • Auto Face Gender ▾`).
  - **Expanded state**: Renders the 4 Script Setup controls (`Pipeline Mode` + `Import .srt / .json`, `Dubbing Mode`, `Drama Genre`, `Direction & Character Presets`) as flat horizontal rows separated by subtle `1px` dividers — NO cards nested inside cards, maximum ONE border level.
  - **Direction text**: Renders as a single truncated line (`truncate`) by default with a `more` / `បង្រួម` toggle to expand the multi-line textarea so it never overflows its container.
- **Scenario 4 (3 Slim Step Status Rows — Replacing Big Cards & Duplicate Footer Tracker)**:
  - Replaces the 3 large colored step cards AND the duplicate bottom footer tracker with 3 slim status rows:
    1. `1. Translate (បកប្រែ Script ខ្មែរ)` — icon + label + count (`X/Y ភាគ`) + thin progress bar + status badge (`DONE` / `RUNNING %`).
    2. `2. សំឡេងខ្មែរ AI (Khmer AI Voice)` — icon + label + count + thin progress bar + status badge.
    3. `3. បំបែកសំឡេងដើម AI (Demucs Clean BGM)` — icon + label + count + thin progress bar + status badge.
  - Deletes the duplicate footer status tracker completely.
- **Scenario 5 (One Primary Contextual CTA + Quiet Secondary Row)**:
  - Renders ONE primary contextual CTA button based on current pipeline state (e.g., when Step 1 & 2 are DONE and Step 3 has 4 episodes left: `🎧 បន្ត Demucs AI (នៅសល់ 4 ភាគ)`), while also keeping direct step triggers accessible.
  - Moves `Re-Translate (FORCE)`, `🔧 ជួសជុលឃ្លាខូច & Generate ឡើងវិញ`, and `Kill Translate / Kill TTS / Kill Demucs` into a single quiet row of small text buttons, preserving all `StudioConfirmDialog` confirmation flows.

## 3. Scope & Boundaries
- **In Scope**: `frontend/src/components/dashboard/GeminiRouteModal.jsx` UI layout refactor, badge de-duplication, flat Script Setup rows, slim progress rows, contextual primary CTA + quiet secondary row, and regression tests in `backend/tests/ai_detection_and_dubbing_prompt_fix.test.js`.
- **Out of Scope**: Renaming state variables/props/handlers, changing backend routes, or altering segment-derived status logic (`geminiRouteHelpers.js`).

## 4. Acceptance Criteria (Pass/Fail standard)
- [x] Criteria 1: Header contains Title + 1 Keys Ready pill + Close button (`Auto Cascade` pill removed from `GeminiRouteModal.jsx`).
- [x] Criteria 2: Script Setup bar collapses into 1 summary line and expands into flat horizontal rows separated by subtle dividers (max 1 border level, no nested cards), with 1-line truncated Direction preview + `more`/`បង្រួម` toggle.
- [x] Criteria 3: 3 slim step status rows replace the 3 oversized colored cards and the duplicate footer status tracker is removed.
- [x] Criteria 4: 1 primary contextual CTA button + 1 quiet secondary row for `Re-Translate (FORCE)`, `ជួសជុលឃ្លាខូច & Generate ឡើងវិញ`, and `Kill` actions (preserving `StudioConfirmDialog`).
- [x] Criteria 5: `npm --prefix frontend run build`, `npm --prefix frontend run lint`, and `node --test` pass with 0 errors.

