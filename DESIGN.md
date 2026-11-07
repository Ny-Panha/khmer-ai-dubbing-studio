# DESIGN.md — DragonDub AI Clean Studio Design System

> **Source of Truth for DragonDub AI Studio (React 18 + Vite + Tailwind CSS)**  
> Inspired by the **Tavola Clean Midnight Navy Design System** (`demo.codeandchill.store/tavola`) combined with the **5 Design Pillars** from [DevDailyDrops](https://devdailydrops.pages.dev/design):  
> `Awesome Design MD` (Linear/Studio Architecture) + `Impeccable` (Anti-AI Look) + `Taste Skill` (Studio Dials) + `Vercel Guidelines` (A11y/Touch) + `Playwright MCP` (Visual Assertions).

---

## 1. Design Persona & Taste Dials (`Leonxlnx/taste-skill`)

DragonDub AI Studio is a **Premium Clean Audio/Video Workstation** (harmonized with Tavola dashboard aesthetics):

- **Variance Dial (Layout)**: `Medium-High` — Clean floating cards (`rounded-2xl` / `16px`), rounded pill navigation (`rounded-full`), and generous breathing room.
- **Motion Dial (Animations)**: `Snappy Pro` — Smooth transitions (`150ms–200ms` with `cubic-bezier(0.16, 1, 0.3, 1)` easing).
- **Density Dial (Spacing)**: `Balanced Modern` — High-clarity workspace without clunky borders, harsh pitch-black backgrounds, or unpainted voids.

---

## 2. Color Tokens (Tavola Clean Midnight Navy Palette)

DragonDub avoids muddy obsidian or saturated neon in favor of **Deep Midnight Navy with Soft Pastel Functional Accents**:

| Token Name | Hex / Value | Usage |
| :--- | :--- | :--- |
| **`--bg-desktop`** | `#0B132B` | App canvas & main backdrop (deep midnight navy) |
| **`--bg-primary-panel`** | `#141E33` | Main suites (Inspector, Player Container, Media Library) |
| **`--bg-secondary-panel`**| `#192744` | Control toolbars, sub-panels, cards |
| **`--bg-elevated-panel`** | `#203156` | Hover cards, active segment tiles, modals |
| **`--bg-active-card`** | `#273D6B` | Selected timeline clip / active speaker |
| **`--border-subtle`** | `rgba(255, 255, 255, 0.06)` | Clean, soft 1px panel boundaries |
| **`--border-subtle-hover`**| `rgba(255, 255, 255, 0.15)` | Interactive borders on hover |
| **`--primary-accent`** | `#FF8577` | **Tavola Coral / Peach** (Active pill nav, Primary CTAs, Playhead) |
| **`--primary-accent-hover`**| `#FFA094` | Soft Coral hover state |
| **`--accent-mint`** | `#34D399` | Soft Mint (Online, Saved, Generation Success, Voice Track) |
| **`--accent-cyan`** | `#38BDF8` | Ice Blue (Video Track, Timecode, Preview Info) |
| **`--accent-purple`** | `#818CF8` | Soft Indigo (Subtitle Tracks, Batch Tools) |
| **`--accent-yellow`** | `#FBBF24` | Warm Butter Yellow (Warnings, Highlights) |
| **`--timeline-playhead`** | `#FF8577` | Soft Coral scrubber needle with subtle glow |
| **`--track-video`** | `#38BDF8` | Ice Blue video track |
| **`--track-audio`** | `#34D399` | Soft Mint Khmer voice audio track |
| **`--track-subtitle`** | `#818CF8` | Soft Indigo subtitle track |

---

## 3. Typography & Khmer Script Rules

DragonDub renders **Bilingual Content (Khmer + English)** simultaneously.

```css
/* Priority Font Stacks */
--font-sans: 'Inter', 'Kantumruy Pro', -apple-system, BlinkMacSystemFont, sans-serif;
--font-khmer: 'Kantumruy Pro', 'Battambang', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
```

### Khmer Typography Safeguards:
1. **Never Clip Subscript Consonants (ជើងអក្សរ)**:
   - Always apply `line-height: 1.55` or `leading-relaxed` on Khmer text containers (`.khmer-text`, `.caption-text`, `.live-subtitle-overlay`).
   - Never use `leading-none` or `overflow-hidden` with tight padding on containers holding Khmer script.
2. **Font Sizes**:
   - `0.68rem` (`~11px`): Micro badges & track labels (`font-mono uppercase`).
   - `0.75rem` (`~12px`): Metadata, timecode, speaker tags.
   - `0.8125rem` (`~13px`): Secondary controls, status text, subtitles preview.
   - `0.875rem` (`~14px`): Primary body, dropdown items, button labels.
   - `0.9375rem` (`~15px`): Panel header titles.
   - `1.125rem` (`~18px`): Main episode titles.

---

## 4. Tavola Component Blueprints

### A. Floating Capsule Navigation Pill (Navbar)
```jsx
<div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141E33] border border-white/10 shadow-lg">
  <button className="px-3 py-1 rounded-full bg-[#FF8577] text-[#0B132B] font-bold text-xs shadow-md">
    Overview
  </button>
  <button className="px-3 py-1 rounded-full text-slate-400 hover:text-white text-xs font-medium">
    Orders
  </button>
</div>
```

### B. Primary CTA Button (Tavola Coral)
```jsx
<button className="h-[34px] px-4 bg-[#FF8577] hover:bg-[#FFA094] active:scale-[0.98] text-[#0B132B] font-bold text-[13px] rounded-full inline-flex items-center gap-2 transition-all duration-150 shadow-md">
  <Download className="w-4 h-4 fill-current" />
  <span>Export Video</span>
</button>
```

### C. Floating Studio Card
```jsx
<div className="bg-[#141E33] border border-white/[0.06] rounded-2xl p-4 shadow-xl">
  <h3 className="text-white font-semibold text-sm">Media Library</h3>
</div>
```

---

## 5. Visual Verification Checklist

1. **Fluid Responsive Viewport**: App must stretch `100vw x 100vh` without blank black margins or unpainted voids.
2. **Tavola Color Harmony**: Deep midnight navy backdrop (`#0B132B`), elevated cards (`#141E33`), floating pill navigation (`#FF8577` active).
3. **Multi-Track Alignment**: Video (`#38BDF8`), Voice (`#34D399`), Subtitle (`#818CF8`), Scrubber (`#FF8577`).
4. **Khmer Text Clarity**: Zero clipped subscripts on character dialogues or subtitle previews.
