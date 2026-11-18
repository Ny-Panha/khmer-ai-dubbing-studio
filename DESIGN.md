---
name: DragonDub AI Studio
description: Darkroom console design system for DragonDub AI — a high-density bilingual Khmer + English video dubbing and multi-track timeline workstation.
colors:
  studio-cyan: "#38BDF8"
  studio-cyan-hover: "#7DD3FC"
  deep-sky-action: "#0369A1"
  deep-sky-hover: "#075985"
  obsidian-floor: "#090A0F"
  console-panel: "#12141D"
  surface-elevated: "#171A26"
  surface-raised: "#1E2231"
  surface-active: "#252A3D"
  terminal-well: "#07080C"
  ink-primary: "#F8FAFC"
  ink-secondary: "#A8B5C8"
  ink-dim: "#8E9EB5"
  ink-muted: "#7A8BA3"
  hairline-border: "rgba(255, 255, 255, 0.08)"
  hairline-border-hover: "rgba(255, 255, 255, 0.18)"
  status-emerald: "#047857"
  status-amber: "#F59E0B"
  status-crimson: "#EF4444"
  track-video-teal: "oklch(0.72 0.14 195)"
  voice-female-rose: "oklch(0.70 0.17 350)"
  voice-male-blue: "oklch(0.68 0.16 250)"
  track-subtitle-violet: "oklch(0.68 0.17 295)"
typography:
  display:
    fontFamily: "'Kantumruy Pro', 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Kantumruy Pro', 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0em"
  title:
    fontFamily: "'Kantumruy Pro', 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: "0em"
  body:
    fontFamily: "'Kantumruy Pro', 'Battambang', 'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0em"
  label:
    fontFamily: "'Kantumruy Pro', 'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.65
    letterSpacing: "0.02em"
  mono:
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "12px"
  full: "9999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
components:
  button-primary:
    backgroundColor: "{colors.deep-sky-action}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.deep-sky-hover}"
    textColor: "{colors.ink-primary}"
  button-secondary:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-primary}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-primary}"
  card-panel:
    backgroundColor: "{colors.console-panel}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "16px"
  input-select:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: "34px"
  nav-bar:
    backgroundColor: "{colors.console-panel}"
    textColor: "{colors.ink-primary}"
    padding: "0 16px"
    height: "48px"
  chip-status:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
    height: "28px"
---

# Design System: DragonDub AI Studio

## Overview

**Creative North Star: "The Darkroom Console"**

DragonDub AI Studio is a high-density, low-glare desktop video dubbing workstation modeled on precision darkroom consoles such as CapCut Pro, DaVinci Resolve, and Linear. Every surface exists to keep the editor's eye on the video frame, the multi-track timeline, and live Khmer dialogue scripts during multi-hour production sessions without eye fatigue or decorative clutter.

Depth is built through quiet tonal stepping from the deep obsidian floor outward to raised interactive surfaces, separated by crisp 1px hairlines rather than drop shadows or glowing neon halos. Color is rationed with discipline: one coherent Cyan/Deep Sky primary accent marks active selection, playheads, and primary calls to action, while semantic track colors (Rose, Blue, Violet, Emerald, Amber) are reserved strictly for voice gender, subtitle tracks, and live pipeline states.

*Note on current codebase state (pre-Phase 2 audit baseline):* The existing CSS currently drifts from this target in several places—mixing a legacy purple-cyan gradient (`#7C5CFC` to `#00E5FF`) on `.btn-primary`, hard-coded `#090A0F`/`#12141D`/`#0B132B` hex values bypassing tokens, micro font sizes (`10px–11.5px`) below the Khmer 13px floor, and desktop-locked `100vw`/`100vh` `overflow: hidden` rules. This document captures the incumbent foundation and establishes the single normative token system to enforce across all surfaces.

**Key Characteristics:**
- Low-glare obsidian tonal ramp (`#090A0F` → `#12141D` → `#171A26` → `#1E2231` → `#252A3D`) with crisp 1px hairline borders.
- Single Studio Cyan / Deep Sky primary accent family; zero decorative purple-cyan AI gradients on routine controls.
- Khmer-safe typography floor (`13px` minimum interactive size, `1.68` line height) paired with tabular `JetBrains Mono` for timecodes and metrics.
- Flat-by-default panels; shadows reserved for floating modals, popovers, and toast banners.
- Desktop-dense workstation layout that degrades cleanly to single-column scrollable stacks at 390px mobile without horizontal overflow.

## Colors

A disciplined dark-mode obsidian neutral ladder anchored by a single Studio Cyan / Deep Sky primary accent and strictly functional audio/track semantics.

### Primary
- **Studio Cyan** (`studio-cyan`): Active playhead scrubber, selected clip outline, active route/tab indicator, and focus rings on dark surfaces.
- **Studio Cyan Hover** (`studio-cyan-hover`): Hover highlight for cyan interactive borders and icon indicators.
- **Deep Sky Action** (`deep-sky-action`): Solid high-contrast filled background for primary action buttons (Export, Open Studio, Run Batch) where pure `#00E5FF` with white text would fail contrast.
- **Deep Sky Hover** (`deep-sky-hover`): Hover state for solid primary action buttons.

### Neutral
- **Obsidian Floor** (`obsidian-floor`): Root application canvas and outer workspace gutter separating top-level panels.
- **Console Panel** (`console-panel`): Primary structural panels (Navbar, Left Media panel, Right Inspector panel, Bottom Timeline shell, Home cards).
- **Surface Elevated** (`surface-elevated`): Secondary cards, form selects, toolbar containers, and status chips nested inside panels.
- **Surface Raised** (`surface-raised`): Hover backgrounds, active dropdown containers, and elevated inspector sub-cards.
- **Surface Active** (`surface-active`): Selected list rows, active episode cards, and pressed surface states.
- **Terminal Well** (`terminal-well`): Recessed dark backdrop exclusively for live Demucs, Auto-Fit, TTS, and Job SSE console log drawers.
- **Ink Primary** (`ink-primary`): Primary headings, active Khmer dialogue lines, and high-emphasis values.
- **Ink Secondary** (`ink-secondary`): Section labels, inactive tab text, helper descriptions, and metadata keys.
- **Ink Dim** (`ink-dim`): Secondary timestamps, separators, and muted captions (must still pass contrast where read as UI copy).
- **Ink Muted** (`ink-muted`): Disabled placeholders and structural dividers only—never interactive body labels.
- **Hairline Border** (`hairline-border`) & **Hairline Border Hover** (`hairline-border-hover`): 1px structural borders separating tonal surfaces.

### Semantic & Timeline Track Accents
- **Status Emerald** (`status-emerald`): Online backend dot, completed pipeline stages, audio ready state, and success confirmations.
- **Status Amber** (`status-amber`): Warnings, queued/running caution notices, quota thresholds, and offline banners.
- **Status Crimson** (`status-crimson`): Errors, audio overrun indicators, destructive delete/kill actions, and offline status.
- **Track Video Teal** (`track-video-teal`): `VIDEO 1` timeline clip track accent.
- **Voice Female Rose** (`voice-female-rose`): Female Khmer neural voice (`ស្រីមុំ` / Sreymom) timeline blocks and badges.
- **Voice Male Blue** (`voice-male-blue`): Male Khmer neural voice (`ពិសិដ្ឋ` / Piseth) timeline blocks and badges.
- **Track Subtitle Violet** (`track-subtitle-violet`): `SUBTITLES` timeline blocks and subtitle badges.

### Named Rules
- **The One Accent Rule.** Studio Cyan / Deep Sky is the sole brand accent across chrome and primary CTAs; Rose, Blue, and Violet are locked exclusively to character voice gender and subtitle track identity.
- **The No-Slop Gradient Rule.** Never apply purple-to-cyan decorative gradients to standard buttons, cards, or headers; use solid `deep-sky-action` with crisp borders for primary CTAs.
- **The Single Token Source Rule.** Every color in component CSS must resolve from `:root` custom properties in `frontend/src/styles/tokens.css`—no duplicate legacy palettes (`#0B132B` navy or ad-hoc slate hexes).

## Typography

**Display & UI Font:** `Inter` paired with `Kantumruy Pro` (fallback: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
**Body & Khmer Script Font:** `Inter`, `Kantumruy Pro`, `Battambang` (fallback: `system-ui, sans-serif`)
**Label / Mono Font:** `JetBrains Mono` (fallback: `'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, monospace`)

**Character:** Precision Latin geometric clarity from `Inter` seamlessly paired with `Kantumruy Pro`'s modern Khmer proportions, anchored by tabular `JetBrains Mono` for frame-accurate timecodes, percentages, and live log streams.

### Hierarchy
- **Display** (700, `1.25rem` / 20px, line-height `1.4`): Page-level titles on Home Dashboard and full-view Studio modal headers (`/batch`, `/export`, `/quota`, `/jobs`).
- **Headline** (700, `1.0625rem` / 17px, line-height `1.5`): Active series titles and major section headings.
- **Title** (600, `0.9375rem` / 15px, line-height `1.55`): Card titles, episode headers, and inspector group headings.
- **Body** (400, `0.875rem` / 14px, line-height `1.68`): Dialogue scripts, form controls, card descriptions, and modal prose.
- **Label** (600, `0.8125rem` / 13px, line-height `1.65`): Buttons, panel tabs, navigation pills, and interactive Khmer badges.
- **Mono** (600, `0.8125rem` / 13px, line-height `1.4`, `tabular-nums`): Timecodes (`00:00.00`), RPM/TPD quota metrics, Auto-Fit percentages (`96.4%`), and live terminal drawers.

### Named Rules
- **The Khmer 13px Floor Rule.** No interactive Khmer label, tab, button, or script row may drop below `13px` (`0.8125rem`) or `1.55` line-height, preventing clipped Khmer vowels and subscripts (`ស្រៈ / ជើងអក្សរ`).
- **The Tabular Numerals Rule.** Every live timecode, progress percentage, queue counter, and RPM metric must use `var(--font-mono)` with `font-variant-numeric: tabular-nums` so counters never jitter during playback or streaming updates.

## Layout

DragonDub AI uses a strict 4px spacing grid (`4px`, `8px`, `12px`, `16px`, `20px`, `24px`) across two layout modes sharing one `48px` top navigation bar:

- **Workstation Mode (`/studio`, desktop `>= 1024px`)**: Viewport-locked grid (`48px` navbar + `1fr` workspace with `6px` gutter). The workspace splits vertically into a resizable 3-column top suite (Left Media/Script panel, flexible Center Player Monitor `min-width: 300px`, Right Inspector panel) and a resizable bottom Multi-Track Timeline (`290px` default height) separated by `4px` draggable splitters.
- **Dashboard & Modal-Route Mode (`/home`, `/batch`, `/export`, `/quota`, `/jobs`)**: Centered or full-height scrollable containers (`max-width: 1240px` on Home; `1120px–1320px` on Batch/Export/Quota/Jobs studio views) with responsive CSS grids (`4` columns desktop → `2` columns `<= 1080px` → `1` column `<= 640px`).
- **Mobile Breakpoint (`<= 768px` / `390px` target)**: Root viewport lock (`overflow: hidden`) must relax on narrow viewports so pages scroll vertically without clipping, navbar items wrap or collapse cleanly without horizontal overflow, and full-screen modals adapt to `100%` width with safe `12px–16px` padding.

## Elevation & Depth

DragonDub AI uses **Flat Tonal Layering** by default. Panels sit on the Obsidian Floor separated by `6px` gaps and `1px` hairline borders (`rgba(255, 255, 255, 0.07)`), stepping upward in lightness (`#090A0F` → `#12141D` → `#171A26` → `#1E2231`) rather than casting drop shadows onto neighboring panels. Drop shadows and subtle `backdrop-filter: blur(12px)` are reserved strictly for floating overlays: modal dialogs, confirmation prompts, and fixed status banners.

### Shadow Vocabulary
- **Overlay Shadow** (`box-shadow: 0 16px 36px rgba(0, 0, 0, 0.65)`): Modal dialogs, shortcuts overlay, and confirm dialogs floating above the backdrop.
- **Toast Shadow** (`box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65)`): Fixed top banners (backend offline notice, toast notifications).
- **Focus Ring** (`box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.25)`): Keyboard focus state for inputs, selects, and interactive controls.

### Named Rules
- **The Flat-By-Default Rule.** Resting workstation panels, dashboard cards, and buttons carry zero drop shadow and zero neon outer glow; hierarchy comes from tonal contrast and 1px hairlines.

## Shapes

A compact, technical corner system tuned to high-density desktop tools:
- **Micro corners (`4px` / `xs`)**: Inline badges, timecode chips, compact queue tags, and aspect-ratio toggle buttons.
- **Control corners (`6px` / `sm`)**: All standard buttons, selects, inputs, navbar controls, and inspector sub-cards.
- **Panel corners (`10px` / `md`)**: Main workstation panels (Left, Center, Right, Timeline) and primary hero CTA buttons.
- **Modal & Dashboard Card corners (`12px` / `lg`)**: Home dashboard cards and floating modal shells.
- **Pill (`9999px` / `full`)**: Progress bar tracks, status dots, and semantic pill badges only.

All controls use `1px solid` borders; dashed borders are reserved strictly for drag-and-drop upload zones (never for queued status rows).

## Components

Precision, tactile controls that communicate state immediately through border, surface step, and crisp iconography rather than bounce or glow.

### Buttons
- **Shape:** Standard control radius (`6px`), `34px–36px` height on desktop (minimum `40px–44px` tap height on touch/mobile where space allows).
- **Primary:** Solid `deep-sky-action` (`#0284C7`) fill with crisp `#F8FAFC` text, `1px solid rgba(56, 189, 248, 0.4)`, padding `8px 16px`, weight `700`.
- **Hover / Focus:** Background steps to `deep-sky-hover` (`#0369A1`), border brightens to `#38BDF8`, keyboard focus displays `2px` Studio Cyan outline (`outline-offset: 2px`).
- **Secondary / Ghost / Danger:** Secondary uses `surface-elevated` (`#171A26`) + `hairline-border`; Ghost uses transparent background + `ink-secondary` stepping to `surface-raised` on hover; Danger/Kill uses subtle crimson tint (`rgba(239, 68, 68, 0.14)`) with `#EF4444` border/text.

### Chips & Status Badges
- **Style:** `surface-elevated` fill with `hairline-border`, `4px`–`6px` radius, `JetBrains Mono` tabular text for numbers/counts.
- **State:** Semantic variants (Emerald ready, Cyan active, Amber warning, Crimson error, Rose/Blue/Violet character tracks) use 12–14% tinted fills with 30–35% matching borders.

### Cards / Containers
- **Corner Style:** `10px` on workstation panels, `12px` on dashboard/modal containers, `6px` on nested inspector groups.
- **Background:** `console-panel` (`#12141D`) for outer cards; `surface-elevated` (`#171A26`) for one-level inner groups. Avoid 3+ nested bordered card layers.
- **Shadow Strategy:** Flat at rest (`box-shadow: none`); subtle border brightness increase (`hairline-border-hover`) on clickable cards.
- **Internal Padding:** `12px` inside compact workstation panels; `16px–20px` on dashboard/modal cards.

### Inputs / Fields
- **Style:** `surface-elevated` fill, `1px solid` `hairline-border`, `6px` radius, `34px` height, `13px–14px` Khmer-safe text (`line-height: 1.65`).
- **Focus:** Border transitions to `studio-cyan` with `0 0 0 2px rgba(0, 229, 255, 0.2)`.
- **Disabled:** `opacity: 0.45`, `cursor: not-allowed`.

### Navigation
- **Style:** Fixed `48px` top bar (`console-panel` background, `1px` bottom hairline), brand mark left, route pills center, aspect-ratio switcher / server status / primary Export CTA right.
- **Active State:** `surface-raised` fill with `studio-cyan` border and text; clear single active indicator per route.
- **Mobile Treatment:** At `<= 768px`, secondary chips hide or move into a clean scrollable/wrapping bar so the navbar never clips off-screen at 390px.

### Multi-Track Timeline & Live Console Drawers (Signature Components)
- **Timeline Tracks:** Fixed-height color-coded horizontal lanes (`VIDEO 1` teal, `KHMER VOICE 1` rose/blue by speaker gender, `SUBTITLES` violet) with a crisp `studio-cyan` playhead line, tabular ruler ticks, and exact waveform-matched voice clip widths.
- **Live Console Drawers:** Recessed `terminal-well` (`#07080C`) log containers using `JetBrains Mono` (`12px–13px`), crisp hairline border, and high-contrast `#E2E8F0` streaming log lines.

## Do's and Don'ts

### Do:
- **Do** enforce `>= 13px` font size and `>= 1.55–1.68` line-height on all Khmer interactive text, tabs, buttons, and subtitles.
- **Do** source every surface, text, border, radius, and spacing value from `frontend/src/styles/tokens.css` variables.
- **Do** use solid `deep-sky-action` (`#0284C7`) with `#F8FAFC` text for primary filled buttons to guarantee WCAG AA contrast (`>= 4.5:1`).
- **Do** use `font-family: var(--font-mono)` with `font-variant-numeric: tabular-nums` on every timecode, percentage, queue position, and RPM metric.
- **Do** provide visible `:focus-visible` outlines (`2px solid var(--primary-accent)`) on all interactive controls and preserve `>= 44px` touch targets on mobile.

### Don't:
- **Don't** apply purple-cyan gradients (`linear-gradient(135deg, #7C5CFC, #00E5FF)`) or glowing neon box-shadows to standard buttons or cards.
- **Don't** stack 3+ levels of bordered nested cards inside modals or inspector panels—use spacing and hairline dividers instead.
- **Don't** hard-code legacy `#0B132B` / `#141c2e` / `#111827` hex values or use `!important` overrides across component CSS files.
- **Don't** lock narrow mobile viewports (`<= 768px`) to `100vw`/`100vh` `overflow: hidden` in a way that clips content or forces horizontal scrolling at `390px`.
- **Don't** skip heading levels (`h1` → `h3`) or render clickable actions as unlabelled `<div>` elements without accessible semantics.
