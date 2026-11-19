# DragonDub AI Studio — Full-Site UI & Technical Audit (Phase 1 Baseline)

- **Audit Date:** 2026-11-18
- **Tooling:** Impeccable v4.9.1 (`impeccable detect` static + live browser at `1440×900` & `390×844`) + Playwright Chromium DOM/Visual Audit + Source CSS/JSX Inspection
- **Design Authorities:** `PRODUCT.md` (schema v1) & `DESIGN.md` / `.impeccable/design.json` (schema v2 — *"The Darkroom Console"*)
- **Mode:** **PHASE 1 — AUDIT ONLY** (zero application source edits made)
- **Screenshots Baseline:** `.agents/ui-audit/before/{route}-{1440|390}.png`

---

## 1. Route & Surface Inventory

Every canonical route defined in `frontend/src/context/ModalContext.jsx` was verified live on `http://localhost:5173` (paired with live Express backend `http://localhost:5000`, HTTP `200 OK`) at both **1440×900** and **390×844**:

| # | Route | Component / Surface | 1440px Capture | 390px Capture |
|---|---|---|---|---|
| 0 | *(Global Chrome)* | `Navbar.jsx` (`48px` top bar across all routes) + `ShortcutsModal.jsx` | Included on all routes | Included on all routes |
| 1 | `/home` (`/` alias) | `HomeDashboard.jsx` — Project overview, 4 workspace cards, episode pipeline table | `before/home-1440.png` | `before/home-390.png` |
| 2 | `/studio` | `App.jsx` 3-column workstation (`MediaLibrary` [4 tabs: Episodes, Media, AI Dubbing, Script] + `VideoPlayerPreview` + `VoiceSettings` Inspector + `TimelineEditor`) | `before/studio-1440.png` (+ `episodes`, `dubbing`, `script`) | `before/studio-390.png` (+ sub-tabs) |
| 3 | `/batch` | `GeminiRouteModal.jsx` + `DubbingStepCardsBar.jsx` — 4-stage Batch Generate Studio | `before/batch-1440.png` | `before/batch-390.png` |
| 4 | `/export` | `BatchExportStudioModal.jsx` — Batch Export & Merge Studio | `before/export-1440.png` | `before/export-390.png` |
| 5 | `/quota` | `GeminiQuotaModal.jsx` — Gemini Keys & Model Quota Pool | `before/quota-1440.png` | `before/quota-390.png` |
| 6 | `/jobs` | `JobDashboardModal.jsx` — Production Job Queue Dashboard | `before/jobs-1440.png` | `before/jobs-390.png` |

---

## 2. Audit Health Score (Baseline — Before Fixes)

| # | Dimension | Score | Key Verified Finding |
|---|---|---|---|
| 1 | **Accessibility (A11y)** | **1 / 4** | WCAG AA contrast failures (`1.9:1` to `4.1:1`) on primary CTAs & dimmed labels; only `1` `:focus-visible` rule and `0` `prefers-reduced-motion` rules app-wide; `8–9` unlabelled inputs on `/studio` & modals; missing `<h1>` on 5/6 routes; `H2→H4` skipped heading on `/batch`. |
| 2 | **Performance** | **3 / 4** | Vite build & `@tanstack/react-virtual` are lean (0 console/page errors across all 12 captures), but heavy `backdrop-filter: blur(16px)` on stacked full-screen modals + `157` `!important` cascade overrides and inline JSX style object recreation in 4 large dashboard modals create unnecessary style recalc churn. |
| 3 | **Theming** | **1 / 4** | Severe token bypass: `279` hard-coded hex values in non-token CSS files and **`1,542` inline hex colors inside JSX**, mixing 3 incompatible palettes (Obsidian `#090A0F`, legacy Tavola Navy `#0B132B`/`#141c2e`, and Tailwind Slate `#0F172A`/`#111827`). |
| 4 | **Responsive Design** | **0 / 4** | **Desktop-broken at 1440px** (`+152px` horizontal overflow from Navbar pushes Batch Export & Studio Right Inspector off-screen) and **completely broken at 390px** (`+1,202px` overflow chops 75% of `/home` & `/studio`, `/quota` header collapses into a 60px vertical column covering 95% of viewport, `/jobs` 4-col stat grid overflows). |
| 5 | **Implementation Integrity** | **1 / 4** | Impeccable detector flagged **2,272 findings at 1440px** and **475 findings at 390px** + 7 static codebase warnings: 3 conflicting primary button styles on `/studio` alone (glowing salmon pill, purple-cyan AI gradient, solid sky blue), thick `side-tab` borders, nested card stacks, gradient `<h2>` text, and `10–11.5px` micro-Khmer text violating the 13px floor. |
| **Total** | | **6 / 20** | **Poor (major overhaul needed)** |

---

## 3. Implementation Integrity Verdict

**FAIL** — The codebase does **not** yet express one coherent product-specific design system. Instead, it carries visual sediment from at least three prior styling passes:
1. Legacy **Tavola Coral + Midnight Navy** (`#FF8577` glowing coral pills + `#0B132B` / `#141c2e` backgrounds in `MediaUploadTab.jsx`, `EpisodesTab.jsx`, `MediaLibrary.css`).
2. **AI-Slop Purple-Cyan Neon** (`linear-gradient(135deg, #7C5CFC, #00E5FF)` on `.btn-primary` in `components.css`, cyan/sky zero-offset box-shadow glows, `background-clip: text` gradient heading on `/quota`, thick `3px` colored left borders on timeline headers).
3. **Ad-hoc Inline JSX Tailwind-Slate Modals** (`1,542` inline hex literals in `GeminiRouteModal.jsx`, `BatchExportStudioModal.jsx`, `GeminiQuotaModal.jsx`, `JobDashboardModal.jsx`, `DubbingStepCardsBar.jsx`) that completely ignore `frontend/src/styles/tokens.css`.

### Deterministic Detector Summary & False-Positive Calibration
- **Static scan (`impeccable detect frontend/src`):** 7 findings — 5× `side-tab` (`TimelineEditor.css:436–455`), 1× `overused-font` (`Inter` in `index.css:2`), 1× advisory `bounce-easing` (`tokens.css:40`).
- **Live URL scan (`1440×900`):** 2,272 findings across 6 routes (`/home`: 77, `/studio`: 188, `/batch`: 753, `/export`: 267, `/quota`: 298, `/jobs`: 689).
- **Live URL scan (`390×844`):** 475 findings across 5 routes (`/jobs` timed out on Puppeteer `networkidle` due to continuous SSE/3s polling; audited via Playwright DOM + screenshot capture instead).
- **False-positive / architecture note:** Because `/batch`, `/export`, `/quota`, and `/jobs` mount as `position: fixed` full-screen modals *over* the still-mounted `/studio` workspace, `impeccable detect` includes underlying Studio/Timeline DOM elements (e.g., `.caption-item-card`, `.voice-segment-block`, `.timeline-scroll-area`) in modal URL counts. In our per-page breakdown below, underlying Studio bleed-through is credited once to `/studio` rather than double-counted on modals.
- **`overused-font` calibration:** `Inter` is flagged as overused for Latin UI. Per `PRODUCT.md`, `Kantumruy Pro` is our primary Khmer typeface; elevating `Kantumruy Pro` (or pairing a distinctive technical sans like `IBM Plex Sans` / `Plus Jakarta` — avoiding `Inter` as first family) while keeping `Kantumruy Pro` primary resolves the default-font look and improves Khmer/Latin baseline harmony.

---

## 4. Executive Summary

- **Audit Health Score:** **6 / 20 (Poor)**
- **Total Issues Catalogued (deduplicated across global + 6 routes):**
  - **P0 Blocking:** 8
  - **P1 Major:** 14
  - **P2 Minor:** 11
  - **P3 Polish:** 5
- **Top 5 Critical Issues:**
  1. **[P0] Global Grid & Navbar Overflow (`+152px` at 1440px, `+1,202px` at 390px):** `.capcut-navbar` expands the root CSS Grid to `1,592px`, slicing off the Batch Export button AND Studio's Right Inspector Panel even on a 1440px desktop, and chopping 75% of `/home` & `/studio` off-screen on 390px mobile.
  2. **[P0] `/quota` Mobile Layout Collapse (390px):** Header flex row refuses to wrap, squishing title + badges + description into a ~60px vertical column occupying 95% of viewport height and hiding the entire quota dashboard.
  3. **[P0] `/batch` Step 1 Card Text Collision (1440px & 390px):** In `DubbingStepCardsBar.jsx`, `1. Script ខ្មែរ: 0/1` physically overlaps `0%` badge due to fixed-width `flexShrink: 0` right buttons colliding inside `minmax(230px, 1fr)`.
  4. **[P0] `/studio` 3-Way Primary Button Clash & AI-Slop Tells:** Glowing salmon pill (`#FF8577`), purple-cyan gradient button (`#7C5CFC→#00E5FF`), and solid blue button (`#0284C7`) sit side-by-side on the same screen alongside `side-tab` left borders and `1,542` inline JSX hex overrides.
  5. **[P0/P1] Systemic WCAG AA & Khmer Readability Failures:** Primary CTAs fail contrast (`4.1:1` on `#0284C7`, `3.8:1` on `#059669`), muted labels drop to `1.9:1–3.9:1`, `25–59` Khmer UI elements per route render at `8.7px–11.5px` (violating the `13px` Khmer floor), and `:focus-visible` / `prefers-reduced-motion` are essentially absent.

---

## 5. Per-Page Audit Findings (P0 → P3)

### Page 0: Global Chrome — `Navbar.jsx`, `layout.css`, `tokens.css`, `components.css`, `modals.css`

- **[P0] Navbar & Root Grid Horizontal Overflow (`+152px` at 1440px, `+1,202px` at 390px)**
  - **Location:** `frontend/src/styles/layout.css:10-54`, `frontend/src/components/layout/Navbar.css:4-298`, `frontend/src/components/layout/Navbar.jsx`
  - **Category:** Responsive / Layout
  - **Impact:** At `1440×900`, `.capcut-navbar` (`scrollWidth: 1592px`) expands the implicit single grid column of `.capcut-app-container` to `1592px` while `overflow: hidden` clips the rightmost `152px` — cutting the Batch Export navbar button in half AND slicing `152px` off the Studio Right Inspector panel. At `390×844`, `1,202px` overflows off-screen, making `/home` and `/studio` unusable on mobile.
  - **WCAG/Standard:** WCAG 1.4.10 Reflow (AA)
  - **Recommendation:** Add `grid-template-columns: minmax(0, 1fr)` and `max-width: 100%` on `.capcut-app-container`; constrain `.capcut-navbar` to `width: 100%; min-width: 0; overflow-x: auto` or compact button padding/labels + hide non-essential desktop chips (`panel toggles`, `shortcuts`, `aspect switcher`) below `1280px` / `768px`; relax `html, body, #root` `overflow: hidden` at `<= 1024px` so mobile routes scroll vertically.
  - **Suggested command:** `$impeccable adapt`

- **[P0] Global Token Fragmentation (`279` CSS hex + `1,542` inline JSX hex + `157` `!important`)**
  - **Location:** `frontend/src/styles/tokens.css`, `components.css`, `layout.css`, `timeline.css`, `modals.css`, and JSX dashboard modals
  - **Category:** Theming / Implementation Integrity
  - **Impact:** Changing a single palette/type/spacing token cannot update the app; 3 conflicting dark surface ramps (`#090A0F`, `#0B132B`, `#0F172A`) and 3 button aesthetics coexist across screens.
  - **Recommendation:** Consolidate `tokens.css` to the single `DESIGN.md` token scale (color, type, spacing, radius, shadow, control heights), eliminate `!important` overrides where specificity suffices, and migrate shared button/card/badge/modal classes into `components.css` & `modals.css`.
  - **Suggested command:** `$impeccable extract`

- **[P1] WCAG AA Contrast Failures on Primary CTA & Dimmed Ink Tokens**
  - **Location:** `frontend/src/styles/tokens.css:45-48`, `HomeDashboard.css:106`, `Navbar.css` (`.navbar-export-btn.download-ready`), `TimelineEditor.css` (`.empty-lane-placeholder-text`)
  - **Category:** Accessibility
  - **Impact:** `#ffffff` on `#0284C7` measures `4.1:1` (< 4.5:1); `#ffffff` on `#059669` measures `3.8:1`; `--text-dim: #64748B` measures `3.4:1–4.0:1` on dark panels; `--text-muted: #475569` drops to `2.0:1`; empty timeline lane placeholder `#3d3d3d` on `#060606` is `1.9:1`.
  - **WCAG/Standard:** WCAG 1.4.3 Contrast Minimum (AA — 4.5:1)
  - **Recommendation:** Darken filled primary button token to `#0369A1` (hover `#075985`, `5.9:1` with `#F8FAFC`), darken emerald filled CTA to `#047857` (`5.4:1`), lift `--text-dim` to `#8FA3BC` (`>= 5.8:1` on `#12141D`) and empty-lane placeholder to `#7E8DA3` (`>= 5.5:1`).
  - **Suggested command:** `$impeccable colorize`

- **[P1] Missing Keyboard Focus Indicators & Reduced Motion Support**
  - **Location:** Global (`frontend/src/styles/components.css`, `tokens.css`) — only `1` `:focus-visible` rule and `0` `@media (prefers-reduced-motion: reduce)` rules across all 17 CSS files.
  - **Category:** Accessibility
  - **Impact:** Keyboard users navigating controls cannot see focus rings; motion-sensitive users have no reduced-motion fallback for spin/translate/spring transitions.
  - **WCAG/Standard:** WCAG 2.4.7 Focus Visible (AA), WCAG 2.3.3 Animation from Interactions
  - **Recommendation:** Add a single universal `:is(button, a, input, select, textarea, [tabindex]):focus-visible { outline: 2px solid var(--primary-accent); outline-offset: 2px; }` rule and a purposeful `@media (prefers-reduced-motion: reduce)` block preserving state visibility while disabling transforms/pulse motion.
  - **Suggested command:** `$impeccable harden`

- **[P1] AI-Slop Purple-Cyan Gradient & Neon Glow on `.btn-primary` + Bounce Easing**
  - **Location:** `frontend/src/styles/components.css:191-217`, `frontend/src/styles/tokens.css:40,58-59,97-100`
  - **Category:** Implementation Integrity / Component Consistency
  - **Impact:** `.btn-primary` uses `linear-gradient(135deg, #7C5CFC 0%, #00E5FF 100%) !important` with neon purple/cyan drop shadow — a textbook AI-slop tell clashing with Navbar's solid blue Export button and `DESIGN.md`'s *No-Slop Gradient Rule*. `--spring-snappy` uses bounce easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`).
  - **Recommendation:** Replace `.btn-primary` gradient + glow with solid `var(--btn-primary-bg)` (`#0369A1`, border `rgba(56, 189, 248, 0.45)`, zero drop-shadow at rest); replace `--spring-snappy` with smooth exponential `cubic-bezier(0.22, 1, 0.36, 1)`.
  - **Suggested command:** `$impeccable polish`

- **[P2] Default-Font (`Inter`) Dominance & Duplicate Google Fonts Load**
  - **Location:** `frontend/index.html:11`, `frontend/src/index.css:2`, `frontend/src/styles/tokens.css:6-8`
  - **Category:** Typography / Performance
  - **Impact:** Google Fonts is loaded TWICE (`<link>` in `index.html` AND `@import url(...)` in `index.css` — render-blocking duplicate request!), and `Inter` is flagged as `overused-font` across all 6 routes (60–91% of rendered text).
  - **Recommendation:** Remove duplicate `@import url(...)` from `index.css` (keep single `<link>` in `index.html` including `JetBrains Mono`), and pair `Kantumruy Pro` + `IBM Plex Sans` (or `DM Sans`) as primary UI stack so both Khmer and Latin look crisp and intentional.
  - **Suggested command:** `$impeccable typeset`

---

### Page 1: `/home` (`HomeDashboard.jsx` & `HomeDashboard.css`)
- **Captures:** `before/home-1440.png` (clean visual structure on desktop except clipped navbar right edge), `before/home-390.png` (**severely broken**: content pushed/clipped `+1,202px` off right edge!)
- **Detector counts (1440px):** 77 findings (`69` undersized-ui-text, `6` low-contrast, `1` overused-font, `1` flat-type-hierarchy).

- **[P0] 390px Mobile Clipping & Horizontal Cut-Off (`overflowX: +1,202px`)**
  - **Location:** `frontend/src/components/layout/HomeDashboard.css:6-25`, inherited from `layout.css` grid expansion.
  - **Category:** Responsive Design
  - **Impact:** Hero card, CTA button, workspace card descriptions, and episode table are cut off at the right edge of 390px screens (`body-text-viewport-edge`: `div.home-dashboard-view reaches 1127px past 390px`).
  - **Recommendation:** Fix root grid `minmax(0, 1fr)` + add `@media (max-width: 768px)` rules in `HomeDashboard.css` (`padding: 16px 12px 32px`, stack hero top & table rows cleanly into mobile cards).
  - **Suggested command:** `$impeccable adapt`

- **[P1] Hero CTA & Table Header Contrast Failures + Micro Text (`10.5px–11.5px`)**
  - **Location:** `HomeDashboard.css:78,106,146,187` and `.home-pipe-indicator` (`10.5px`), `.home-table-cols-head` (`#64748b` on `#0e1017` = `4.0:1`).
  - **Category:** Accessibility / Typography
  - **Impact:** `69` functional indicators render at `10.5px`; `25` Khmer text nodes drop below `13px`; primary CTA `#ffffff` on `#0284c7` is `4.1:1`.
  - **Recommendation:** Use `--btn-primary-bg` (`#0369A1`), lift table column header ink to `--text-secondary`, raise Khmer badges/labels/eyebrows to `>= 12px` Latin / `>= 13px` Khmer.
  - **Suggested command:** `$impeccable typeset`

- **[P2] Flat Type Hierarchy (`body 12px, h2 14px, h1 17px` — ratio `1.21:1`) & Resting Card Shadows**
  - **Location:** `HomeDashboard.css:36,91,230,237`
  - **Category:** Typography / Elevation
  - **Impact:** `h1` (`17px`) barely separates from `h2` (`14px`); cards carry resting drop shadows and cyan hover glow contradicting *The Flat-By-Default Rule*.
  - **Recommendation:** Scale `h1` to `1.25rem` (`20px`) and `h2` to `1rem` (`16px`) (`>= 1.25:1` step); remove resting box-shadows and cyan hover glow, keeping crisp tonal step + border highlight.
  - **Suggested command:** `$impeccable layout`

- **[P3] Hard-Coded Hexes & User-Select None on Entire Page**
  - **Location:** `HomeDashboard.css:14,93,106,119,167`
  - **Category:** Theming / UX Polish
  - **Impact:** `user-select: none` on `.home-dashboard-view` blocks copying series/episode names; hard-coded hex values bypass `tokens.css`.
  - **Recommendation:** Remove global `user-select: none` (keep on buttons only) and replace all hexes with CSS tokens.
  - **Suggested command:** `$impeccable polish`

---

### Page 2: `/studio` (`MediaLibrary`, `VideoPlayerPreview`, `VoiceSettings`, `TimelineEditor`)
- **Captures:** `before/studio-1440.png` (+ `episodes`, `dubbing`, `script`), `before/studio-390.png`
- **Detector counts (1440px):** 188 findings (`123` undersized-ui-text, `19` ai-color-palette, `15` border-accent-on-rounded, `12` low-contrast, `12` tiny-text, `5` nested-cards, `1` edge-flush-cards, `1` overused-font) + `5` static `side-tab` borders.

- **[P0] Right Inspector Panel Clipped `152px` Off-Screen Even at 1440px Desktop**
  - **Location:** `frontend/src/styles/layout.css:32-94`, `frontend/src/components/voice/VoiceSettings.css`
  - **Category:** Layout / Responsive
  - **Impact:** On a standard `1440×900` monitor, the Right Inspector header (`Character Voice Mappin...`), Reset button, Demucs checkbox copy, slider values (`15%`, `130%`), and Aspect Ratio label are physically sliced off the right viewport edge (`13` clipped interactive controls at 1440px!).
  - **Recommendation:** Fix root grid width containment (`minmax(0, 1fr)`), ensure `.top-suite-col-right` respects `min-width: 0; box-sizing: border-box`, and wrap internal inspector rows cleanly (`flex-wrap: wrap`).
  - **Suggested command:** `$impeccable layout`

- **[P0] Unusable 390px Mobile Layout (`46` Clipped Controls, Locked 3-Column Row)**
  - **Location:** `frontend/src/styles/layout.css:57-124`, `frontend/src/styles/timeline.css:6-18`
  - **Category:** Responsive Design
  - **Impact:** At `390px`, the 3-column horizontal `.capcut-top-suite` forces Player + Inspector completely off-screen (`+1,202px` overflow) while locking timeline height to `290px !important`.
  - **Recommendation:** Add `@media (max-width: 900px)` stacking `.capcut-top-suite` vertically (`flex-direction: column; overflow: visible`), hiding vertical splitters, allowing natural page scroll, and giving Player + Panels `width: 100%`.
  - **Suggested command:** `$impeccable adapt`

- **[P0] Three Conflicting Primary Button Styles & AI-Slop Tells on One Screen**
  - **Location:** `MediaUploadTab.jsx:745` (`linear-gradient(#FF8577, #f43f5e)` coral glow pill), `EpisodesTab.jsx:249,1074` (same coral gradient), `VideoPlayerPreview.jsx:2221` (`.btn-primary` purple-cyan gradient glow), `Navbar.jsx` (solid blue).
  - **Category:** Component Consistency / Implementation Integrity
  - **Impact:** Immediately reads as stitched-together AI templates; `EpisodesTab` "+ Series ថ្មី" wraps awkwardly onto 2 lines inside a coral pill right beside a purple-cyan "+ Add Episode" button.
  - **Recommendation:** Unify ALL primary buttons across `MediaUploadTab`, `EpisodesTab`, `DubbingModeTab`, and `VideoPlayerPreview` to the single `.btn-primary` token class (solid `#0369A1`, `6px` radius, zero glow, single-line `white-space: nowrap`).
  - **Suggested command:** `$impeccable distill`

- **[P1] Thick `side-tab` Left Accent Borders & `border-accent-on-rounded` on Timeline**
  - **Location:** `frontend/src/components/timeline/TimelineEditor.css:436-455` (`border-left: 3px solid #00e5ff/#3b82f6/#ec4899/#8b5cf6/#10b981`) and `.voice-segment-block` (`border-top: 2px` + `border-radius: 6px`).
  - **Category:** Implementation Integrity (AI-Slop Detector)
  - **Impact:** Triggers 5 static `side-tab` warnings + 15 live `border-accent-on-rounded` warnings.
  - **Recommendation:** Replace thick left bars on track headers with a crisp `6px` circular color dot indicator inside each track header, and use uniform `1px` borders with tonal tint on voice clip blocks (preserving exact Pink/Blue/Violet semantic recognition).
  - **Suggested command:** `$impeccable polish`

- **[P1] Tiny Khmer Typography (`8.7px–11.8px`), Low Contrast (`1.9:1–3.9:1`), & Unlabelled Form Controls**
  - **Location:** `MediaLibrary.css:33,70` (`11.5px` tab buttons, `10px` badges), `VoiceSettings.css:112,117,144` (`0.74rem`), `ScriptReviewTab.jsx` (`#inspector-khmer-textarea` `11.76px`, `CN` badge `8.68px`, speaker name `9.24px`), `MediaUploadTab.jsx` (`10.08px` series pills), `TimelineEditor.css` (`.empty-lane-placeholder-text` `10.08px` at `1.9:1`). Also `8` visible inputs/selects lack `aria-label` or `<label>` and route has no `<h1>`.
  - **Category:** Accessibility / Typography
  - **Impact:** Khmer subscripts clip and blur; screen readers cannot identify 8 inspector sliders/selects.
  - **Recommendation:** Enforce `>= 13px` on all Khmer labels/textareas/tabs and `>= 11px–12px` on compact mono badges; add visually hidden `<h1>` ("DragonDub Studio Editor") and `aria-label` to all unlabelled sliders/selects/inputs.
  - **Suggested command:** `$impeccable typeset`

- **[P2] Nested Bordered Cards (`5` instances) & Undersized Touch Targets (`28` under `24×24px`)**
  - **Location:** `MediaUploadTab.jsx`, `ScriptReviewTab.jsx` (`.caption-item-card`), `VoiceSettings.jsx` (`.inspector-card-group` inner Demucs card), `TimelineTrackHeaders.jsx` (tiny `M`/`S`/`Lock` buttons).
  - **Category:** Layout / Accessibility (WCAG 2.5.8)
  - **Impact:** Card-inside-card-inside-card creates visual clutter; track header micro-buttons are `< 24×24px`.
  - **Recommendation:** Flatten inner sub-boxes in Inspector & Media tab using `1px` top hairline dividers instead of nested bordered cards; ensure icon controls meet `>= 24×24px` (desktop) / `>= 36–44px` (mobile) hit area.
  - **Suggested command:** `$impeccable distill`

- **[P2] Legacy Tavola Navy Hexes in `MediaLibrary.css` & `VoiceSettings.css`**
  - **Location:** `MediaLibrary.css:121,130,142` (`#141c2e`, `#1a243a`, `#0B132B`), `VoiceSettings.css:103` (`#111827`).
  - **Category:** Theming
  - **Recommendation:** Replace with `var(--bg-secondary-panel)`, `var(--bg-elevated-panel)`, `var(--bg-desktop)`.
  - **Suggested command:** `$impeccable extract`

---

### Page 3: `/batch` (`GeminiRouteModal.jsx` & `DubbingStepCardsBar.jsx`)
- **Captures:** `before/batch-1440.png`, `before/batch-390.png`
- **Detector counts (1440px, including backdrop):** 753 total — modal-owned highlights: `skipped-heading (H2→H4)`, `24` dark-glow, `44` gray-on-color, `29` nested-cards, `389` undersized-ui-text, `198` tiny-text.

- **[P0] Step 1 Card Text Overlap Collision (`1. Script ខ្មែរ:` collides with `0%` & `0/1`)**
  - **Location:** `frontend/src/features/dubbing-runner/DubbingStepCardsBar.jsx:46-97`
  - **Category:** Layout / Alignment (Visible at BOTH 1440px AND 390px!)
  - **Impact:** In Card 1 (`1. Script ខ្មែរ`), 3 right-hand buttons (`Run 1-by-1`, `ធ្វើឡើងវិញ`, `ជួសជុល`) plus the `0%` pill have `flexShrink: 0`, forcing them directly over the left text (`1. Script ខ្មែរ: 0/1`) so it reads as garbled overlapping text (`1. Script ខ្មែរ0%1`).
  - **Recommendation:** Switch step cards to a clean 2-row flex-column layout (Row 1: icon + title + `X/Y` + `%` badge; Row 2: action buttons cleanly aligned with `gap: 6px; flex-wrap: wrap`), eliminating overlap permanently at every width.
  - **Suggested command:** `$impeccable layout`

- **[P0] 390px Mobile Episode Card Overflow (`minmax(370px, 1fr)` > `358px` inner width)**
  - **Location:** `frontend/src/components/dashboard/GeminiRouteModal.jsx:3265`
  - **Category:** Responsive Design
  - **Impact:** Episode grid enforces `minmax(370px, 1fr)` inside a `390px` screen (minus modal padding = ~350px), pushing every episode card's right edge (`• Key #1` badge and action buttons) off-screen!
  - **Recommendation:** Change to `gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))'` and allow per-step action rows inside episode cards to wrap cleanly on narrow screens.
  - **Suggested command:** `$impeccable adapt`

- **[P1] Skipped Heading Level (`H2 → H4`) & Missing `H1` + `29` Nested Cards**
  - **Location:** `GeminiRouteModal.jsx:2017` (`<h2>`) → `GeminiRouteModal.jsx:3449` (`<h4>`), plus 4 nested card layers (Modal shell → Episode container → Episode card → 4 bordered step rows).
  - **Category:** Accessibility / Implementation Integrity
  - **Impact:** Breaks screen-reader landmark outline (`skipped-heading`); heavy bordered nesting creates dense visual boxes.
  - **WCAG/Standard:** WCAG 1.3.1 Info and Relationships (A)
  - **Recommendation:** Change modal header to `<h1>` (or `<h2>` with episode step headings as `<h3>`—no skipped levels); replace 4 inner bordered step sub-cards with clean hairline-separated rows (`border-top: 1px solid var(--border-subtle)`) inside each episode card.
  - **Suggested command:** `$impeccable distill`

- **[P1] `59` Khmer Text Nodes Below `13px` (`0.62rem–0.72rem`) + `44` Gray-on-Color + `24` Dark Glows**
  - **Location:** `DubbingStepCardsBar.jsx:76-140` (`0.62rem`–`0.72rem` inline styles), `GeminiRouteModal.jsx` (inline `#0f172a` / `#38bdf8` glows / gray subtitles on tinted pills).
  - **Category:** Typography / Accessibility / Theming
  - **Impact:** Khmer labels on step cards and episode sub-rows render at `9.9px–11.5px`; muted gray text sits on colored translucent boxes (`gray-on-color`).
  - **Recommendation:** Move modal styles to a clean CSS module/stylesheet (`DashboardModals.css`) backed by `tokens.css`, enforce `>= 13px` on Khmer text, remove zero-offset cyan glows, and use `--text-primary` / high-contrast tinted ink on badges.
  - **Suggested command:** `$impeccable typeset`

---

### Page 4: `/quota` (`GeminiQuotaModal.jsx`)
- **Captures:** `before/quota-1440.png`, `before/quota-390.png` (**catastrophic mobile breakage**)
- **Detector counts (1440px, including backdrop):** 298 total — modal-owned highlights: `1` gradient-text (`<h2>`), `2` dark-glow, `27` tiny-text, `7` nested-cards, `27` distinct font sizes!

- **[P0] Complete 390px Mobile Header Collapse (95% of Screen Consumed by Vertical Text Column)**
  - **Location:** `frontend/src/components/dashboard/GeminiQuotaModal.jsx:275-350`
  - **Category:** Responsive Design
  - **Impact:** Because the modal header is a non-wrapping horizontal flex row holding an icon, title + 2 badges + long Khmer subtitle, AND a `white-space: nowrap` "បើក Batch Generate" button + close `X` button, at `390px` the title & description column collapses to ~60px width — stacking one word per line vertically for ~720px and pushing the entire Quota panel off-screen, while clipping the bottom footer!
  - **WCAG/Standard:** WCAG 1.4.10 Reflow (AA)
  - **Recommendation:** Allow modal header to wrap cleanly (`flex-wrap: wrap`) on `<= 768px`, give the title block `min-width: 220px; flex: 1`, move the `បើក Batch Generate` button onto a full-width second row on mobile, and allow footer bar to wrap (`flex-wrap: wrap`).
  - **Suggested command:** `$impeccable adapt`

- **[P1] AI-Slop Gradient Heading (`background-clip: text`), Neon Glows, & `27` Ad-Hoc Font Sizes**
  - **Location:** `GeminiQuotaModal.jsx:293-305` (`WebkitBackgroundClip: 'text'` gradient `<h2>`), modal container `#38bdf8` glow shadow, and inline `fontSize` proliferation (`27` unique pixel sizes on one screen!).
  - **Category:** Typography / Implementation Integrity
  - **Impact:** Directly triggers `gradient-text` and `dark-glow` slop flags; `43` Khmer text elements render `< 13px` (`9.2px–11.5px`).
  - **Recommendation:** Replace gradient heading with crisp `#F8FAFC` `<h1>` (`20px`, weight `700`), remove zero-offset cyan glows, snap all font sizes to the 6-step `DESIGN.md` type scale, and make the `Rate limits by model` table horizontally scrollable inside a clean wrapper on 390px.
  - **Suggested command:** `$impeccable typeset`

- **[P2] Nested Cards & Hard-Coded Inline Hexes**
  - **Location:** `GeminiQuotaModal.jsx` (outer modal → monitor card → key cards → inner progress bars).
  - **Category:** Theming / Component Consistency
  - **Recommendation:** Use shared `.studio-modal-shell` + `.studio-modal-section` classes backed by `tokens.css`.
  - **Suggested command:** `$impeccable extract`

---

### Page 5: `/jobs` (`JobDashboardModal.jsx`, `JobQueueList.jsx`, `JobProgressCard.jsx`)
- **Captures:** `before/jobs-1440.png`, `before/jobs-390.png`
- **Detector counts (1440px, including backdrop):** 689 total — modal-owned highlights: `low-contrast`, `tiny-text`, `nested-cards`, `23` unique font sizes.

- **[P0] 390px Mobile 4-Column Stat Card Grid Overflow**
  - **Location:** `frontend/src/components/dashboard/JobDashboardModal.jsx:217-260` (`gridTemplateColumns: 'repeat(4, minmax(0, 1fr))'`)
  - **Category:** Responsive Design
  - **Impact:** At `390px`, all 4 stat cards stay in a single horizontal row (~72px wide each), causing `Completed` to overflow past its card border and Khmer labels (`កំពុងដំណើរការ`) to break awkwardly mid-syllable (`កំពុងដំណើរ` / `ការ`).
  - **WCAG/Standard:** WCAG 1.4.10 Reflow (AA)
  - **Recommendation:** Replace inline 4-col grid with a responsive CSS class (`.jobs-stats-grid`: `repeat(4, 1fr)` desktop → `repeat(2, 1fr)` at `<= 640px`), fixing alignment and legibility cleanly.
  - **Suggested command:** `$impeccable adapt`

- **[P1] Missing `<h1>`, Unlabelled Search Input, & Undersized Khmer Filter Chips**
  - **Location:** `JobDashboardModal.jsx:103` (`<h2>`), filter bar & search `<input>` (`inputsNoLabel: +1`), `46` Khmer elements `< 13px`.
  - **Category:** Accessibility / Typography
  - **Impact:** Screen readers lack an accessible label on the job search box; Khmer filter pills & footer text drop below `13px`.
  - **Recommendation:** Promote modal title to `<h1>`, add `aria-label="ស្វែងរកតាម Series, Ep, ឬ Job ID"` to the search input, and enforce `>= 13px` Khmer label sizing.
  - **Suggested command:** `$impeccable harden`

- **[P2] Inline Navy/Slate Hex Overrides & Inconsistent Modal Header/Footer Chrome**
  - **Location:** `JobDashboardModal.jsx` (uses `#0F172A` / `#1E293B` navy tint vs `#12141D` obsidian on Home/Studio).
  - **Category:** Component Consistency / Theming
  - **Recommendation:** Adopt the shared `.studio-modal-shell`, `.studio-modal-header`, and `.studio-modal-footer` system so `/batch`, `/export`, `/quota`, and `/jobs` feel like one unified app.
  - **Suggested command:** `$impeccable extract`

---

### Page 6: `/export` (`BatchExportStudioModal.jsx`)
- **Captures:** `before/export-1440.png`, `before/export-390.png`
- **Detector counts (1440px, including backdrop):** 267 total — modal-owned highlights: `tiny-text`, `low-contrast`, `nested-cards`, `22` font sizes.

- **[P1] Duplicate Close Icon (`× ✕ បិទ (Close)`) & Inconsistent Modal Header**
  - **Location:** `frontend/src/components/dashboard/BatchExportStudioModal.jsx:364` (renders `<X />` Lucide icon AND literal `✕` glyph side-by-side: `× ✕ បិទ (Close)`!).
  - **Category:** Component Consistency / Polish
  - **Impact:** Visibly broken double-X close button on both 1440px and 390px; header stacks awkwardly on 390px.
  - **Recommendation:** Remove the literal `✕` character so only the Lucide `<X />` icon + `បិទ (Close)` renders, and adopt the unified `.studio-modal-header` pattern.
  - **Suggested command:** `$impeccable clarify`

- **[P1] Undersized Khmer Status Chips (`Script ✗`, `Voice ✗`, `គ្មានវីដេអូ`) & Contrast on Disabled/Muted States**
  - **Location:** `BatchExportStudioModal.jsx` episode cards (`46` Khmer nodes `< 13px`) and dark-navy `#0B132B`/`#0F172A` inline backgrounds.
  - **Category:** Typography / Accessibility
  - **Impact:** Status indicators and episode metadata drop below the 13px Khmer floor; low contrast on muted episode cards.
  - **Recommendation:** Standardize typography to the `DESIGN.md` scale (`>= 13px` for Khmer labels, `12px` mono for status tokens) and replace inline hexes with `tokens.css` variables.
  - **Suggested command:** `$impeccable typeset`

- **[P2] 3-Level Nested Bordered Boxes & Mobile Button Padding**
  - **Location:** `BatchExportStudioModal.jsx` (Modal → Section box → Episode card → Status chip boxes).
  - **Category:** Layout / Component Consistency
  - **Recommendation:** Remove outer bordered wrapper box around the episode grid (use clean section header + hairline divider), and ensure primary export action buttons use the unified `.btn-primary` / `.btn-secondary` system with `>= 44px` height on mobile.
  - **Suggested command:** `$impeccable distill`

- **[P3] Missing `<h1>` & Modal Chrome Parity**
  - **Location:** `BatchExportStudioModal.jsx` header title.
  - **Category:** Accessibility
  - **Recommendation:** Use `<h1>` inside modal dialog with `role="dialog" aria-modal="true" aria-labelledby`.
  - **Suggested command:** `$impeccable harden`

---

## 6. Patterns & Systemic Issues

1. **Single Grid Overflow Cascading Everywhere:** `.capcut-navbar` (`1592px` natural width) without `grid-template-columns: minmax(0, 1fr)` breaks BOTH 1440px desktop (`+152px` cut off on right) AND 390px mobile (`+1,202px` cut off) on every single route.
2. **Inline Style Sprawl Across Dashboard Modals:** `1,542` inline JSX hex colors across `/batch`, `/export`, `/quota`, and `/jobs` bypass `tokens.css` completely, creating 3 different dark background hues (`#090A0F` obsidian vs `#0B132B` navy vs `#0F172A` slate) and 22–27 ad-hoc font sizes per route.
3. **Khmer Micro-Typography Drift:** Despite `tokens.css` explicitly declaring `--khmer-min-font-size: 13px`, actual components render `25–59` Khmer strings per route at `8.7px–11.5px`.
4. **WCAG AA Contrast & Focus Debt:** Primary filled CTAs (`#0284C7` = `4.1:1`, `#059669` = `3.8:1`) and dimmed text (`#64748B` = `3.4–4.0:1`, `#475569` = `2.0:1`) fail 4.5:1; keyboard `:focus-visible` and `prefers-reduced-motion` are missing globally.
5. **Visual Identity Collision (AI-Slop Tells):** Coral neon pills (`#FF8577`), purple-cyan gradients (`#7C5CFC → #00E5FF`), cyan zero-offset glows, gradient `<h2>` text, and thick `side-tab` left borders clash against the clean Darkroom Console aesthetic.

---

## 7. Positive Findings (Preserve During Phase 2)

- **Zero runtime errors:** `0` console errors and `0` page errors across all 12 live captures (6 routes × 2 viewports).
- **Clean Studio Desktop Architecture:** The resizable 3-column workstation + bottom multi-track timeline (`useResizablePanels.js`) is well-engineered and fluid when unconstrained by the navbar grid overflow.
- **Strong Tabular Numerals & Terminal Drawers:** `JetBrains Mono` with `tabular-nums` is already established on timecodes, quota counters, and console log drawers (`#07080C`).
- **Clear Functional Track Semantics:** Rose (Sreymom female), Blue (Piseth male), Violet (Subtitles), and Emerald (Ready/BGM) make timeline scanning fast once toned into uniform borders without `side-tab` bars.
- **Solid Desktop Baseline on `/home`:** `HomeDashboard.jsx` already has the cleanest card hierarchy, proper `<h1>→<h2>` heading order, and clearest visual structure to serve as our reference rhythm.

---

## 8. ONE Ranked Fix Order for Phase 2 (Awaiting Approval)

Per Phase 2 rules (**visual changes ONLY — zero feature, logic, routing, or content changes**; rebuild + re-screenshot at `1440px` & `390px` + compare before/after + commit per stage):

1. **Step 1 — Global Design Tokens (`DESIGN.md` → `frontend/src/styles/tokens.css`, `frontend/index.html`, `frontend/src/index.css`)**
   - Unify ONE color palette (Obsidian ramp + accessible `#0369A1` Primary CTA + `#047857` Emerald CTA + `#8FA3BC` AA-compliant `--text-dim`), ONE 6-step type scale (`>= 13px` Khmer floor), ONE 4px spacing scale, ONE radius/shadow set (flat-by-default), smooth exponential motion (`prefers-reduced-motion` support), universal `:focus-visible` ring, and deduplicate Google Fonts (`Kantumruy Pro` + `IBM Plex Sans` + `JetBrains Mono`).
2. **Step 2 — Shared Components & App Shell (`layout.css`, `Navbar.css`, `Navbar.jsx`, `components.css`, `modals.css`, new `DashboardModals.css`)**
   - Fix root grid `minmax(0, 1fr)` + responsive Navbar (0px overflow at 1440px AND 390px!), eliminate purple-cyan `.btn-primary` gradient & neon glows, create unified `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.studio-modal-shell` / `.studio-modal-header` / `.studio-modal-footer` primitives, and remove redundant `!important` rules.
3. **Step 3 — Page 1: `/home` (`HomeDashboard.jsx`, `HomeDashboard.css`)** *(Fastest baseline win + validates shell at 1440px & 390px)*
   - Fix 390px mobile stacking, hero CTA contrast (`5.9:1`), `h1`/`h2` type step (`20px`/`16px`), `>= 13px` Khmer chips, flat resting cards, and full token adoption.
4. **Step 4 — Page 2: `/studio` (`MediaUploadTab.jsx`, `EpisodesTab.jsx`, `DubbingModeTab.jsx`, `ScriptReviewTab.jsx`, `MediaLibrary.css`, `VideoPlayerPreview.jsx/css`, `VoiceSettings.jsx/css`, `TimelineEditor.css`, `timeline.css`)** *(Highest daily-use P0 impact)*
   - Fix 1440px Right Inspector clipping & 390px responsive vertical stack; unify all 3 conflicting primary CTA styles (retire coral neon pill & purple-cyan gradient); replace `side-tab` left bars with clean track dots; fix `1.9:1` empty-lane contrast, `< 13px` Khmer text, nested cards, missing `<h1>`, and 8 unlabelled inputs.
5. **Step 5 — Page 3: `/batch` (`DubbingStepCardsBar.jsx`, `GeminiRouteModal.jsx`)** *(2 P0 layout/overlap bugs)*
   - Fix Step 1 (`1. Script ខ្មែរ` / `0%`) overlap collision at 1440px & 390px; fix `minmax(min(100%, 340px), 1fr)` mobile card overflow; fix `H2→H4` skipped heading; flatten nested episode step cards; raise Khmer text to `>= 13px` and adopt shared modal CSS tokens.
6. **Step 6 — Page 4: `/quota` (`GeminiQuotaModal.jsx`)** *(P0 390px collapse + gradient heading)*
   - Fix 390px header vertical collapse & footer clipping; replace `background-clip: text` gradient heading with crisp `<h1>`; remove cyan glows; snap 27 font sizes to token scale; make model rate-limit table cleanly scrollable on mobile.
7. **Step 7 — Page 5: `/jobs` (`JobDashboardModal.jsx`, `JobQueueList.jsx`, `JobProgressCard.jsx`)** *(P0 390px stat-card overflow)*
   - Fix 4-col stat grid to `2×2` on mobile (`<= 640px`); promote `<h1>` + label search input; unify modal chrome & Khmer sizing (`>= 13px`).
8. **Step 8 — Page 6: `/export` (`BatchExportStudioModal.jsx`) + `ShortcutsModal.jsx`** *(Clean finish + final cross-site polish)*
   - Remove duplicate `× ✕` close icon; flatten 3-level nested boxes; adopt unified modal chrome, accessible primary buttons, `>= 13px` Khmer status labels; run final full-site before/after Impeccable audit & update `.agents/STATE.md`.

---

## 9. Recommended Impeccable Commands (Summary)

1. **[P0] `$impeccable adapt`**: Fix global Navbar/Grid horizontal overflow (`1440px` + `390px`), `/quota` mobile header collapse, `/jobs` 4-col mobile stat grid, `/batch` mobile card grid, and `/studio` mobile stacking.
2. **[P0] `$impeccable extract`**: Consolidate `tokens.css` and extract shared button/card/modal primitives to eliminate `1,542` inline JSX hex overrides and 3-way CTA conflicts.
3. **[P0] `$impeccable layout`**: Fix `/batch` Step 1 text collision (`DubbingStepCardsBar.jsx`), `/studio` Right Inspector clipping, and `/home` type/card rhythm.
4. **[P1] `$impeccable typeset` + `$impeccable colorize`**: Enforce `>= 13px` Khmer legibility floor, WCAG AA `>= 4.5:1` contrast on CTAs & dimmed text, and replace default `Inter`-first stack.
5. **[P1] `$impeccable distill` + `$impeccable harden`**: Flatten nested bordered cards, fix `H2→H4` skipped headings & missing `<h1>`/input labels, and add global `:focus-visible` + `prefers-reduced-motion`.
6. **[P2] `$impeccable polish`**: Remove remaining `side-tab` left borders, cyan/coral neon glows, bounce easing, and `/export` double `× ✕` close icon, then re-run `$impeccable audit` to verify score improvement.
