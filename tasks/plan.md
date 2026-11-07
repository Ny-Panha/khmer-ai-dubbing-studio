# /agents-design — Full Studio Modern UI/UX Master Plan

## 1. Executive Summary & Design Vision
Transformation of **DragonDub AI Studio** into a world-class, professional audio-video workstation UI, synthesizing the aesthetics and interaction models of three premier design inspirations:
- **MotionSites.ai**: Tactile micro-motion, smooth spring transitions (`cubic-bezier(0.16, 1, 0.3, 1)`), snappy hover depth, and active button depressions (`scale(0.96)`).
- **WebsitePrompts.ai**: Clean modern layout hierarchy, minimal typography, balanced whitespace, and purposeful contrast without visual clutter.
- **GetLayers.ai**: 4-tier component depth system (Canvas → Suite Panel → Elevated Card → Floating Glass Capsule), subtle borders (`rgba(255, 255, 255, 0.07)`), and soft ambient shadows.

---

## 2. The 4-Tier Layer Depth Architecture (GetLayers.ai System)

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Floating Action Bar / Modals / Active Tooltips (z-50)         │
│          Background: #203156 / #273D6B | Blur: 12px | Glow: Coral/Cyan│
├────────────────────────────────────────────────────────────────────────┤
│ Layer 2: Interactive Cards / Timeline Clips / Toolbars (z-20)          │
│          Background: #192744 | Border: rgba(255,255,255,0.08)          │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 1: Major Suite Containers (Media, Player, Inspector) (z-10)       │
│          Background: #141E33 | Border: rgba(255,255,255,0.06)          │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 0: Root Desktop Canvas Backdrop (z-0)                            │
│          Background: #0B132B (Deep Midnight Navy)                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Micro-Interactions & Physics Easing (MotionSites.ai System)

- **Hover Transition**: `all 0.15s cubic-bezier(0.16, 1, 0.3, 1)`
- **Hover Lift**: `transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4)`
- **Active Click**: `transform: scale(0.96)`
- **Modal Entry**: `opacity: 0 -> 1; transform: scale(0.98) -> scale(1) (200ms ease-out)`
- **Pill State Switching**: Fluid tab background sliding without layout shift

---

## 4. Typography & Spacing Standard (WebsitePrompts.ai System)

- **Khmer Font Stack**: `'Kantumruy Pro', 'Battambang', system-ui, sans-serif` (optimal line-height `1.55` to prevent diacritic clipping).
- **English / Numeric Font Stack**: `'Plus Jakarta Sans', 'Inter', system-ui, sans-serif` for labels; `JetBrains Mono` or `monospace` for timecodes.
- **Hierarchy Scale**:
  - H1 / Suite Titles: `0.95rem` / `font-bold` / `#F8FAFC`
  - Body / Subtitles: `0.78rem` / `font-medium` / `#CBD5E1`
  - Meta Labels / Badges: `0.65rem` / `font-semibold` / `#94A3B8`
- **Zero-Clutter Rule**: Replace heavy solid borders with subtle `1px solid rgba(255, 255, 255, 0.07)` and generous 12px–16px padding.

---

## 5. Implementation Roadmap (Phases & Slices)

### Phase 1: Global Motion & Layer Tokens (Core Foundation)
- Update `frontend/src/index.css` with 4-tier layer tokens, spring animations, and unified typography utilities.

### Phase 2: Top Suite — Floating Navbar & Workflow Stepper
- [Navbar.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/Navbar.jsx)
- [WorkflowStepper.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/WorkflowStepper.jsx)

### Phase 3: Left Suite — Media Library & Episode Cards
- [MediaLibrary.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/MediaLibrary.jsx)
- [EpisodesTab.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/media/EpisodesTab.jsx)
- [DubbingModeTab.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx)
- [ScriptReviewTab.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/media/ScriptReviewTab.jsx)

### Phase 4: Center Stage — Video Player & Overlay Controls
- [VideoPlayerPreview.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx)
- [PlayerControls.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/player/PlayerControls.jsx)

### Phase 5: Right Suite — Voice Inspector & Export Panels
- [VoiceSettings.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/VoiceSettings.jsx)
- [CharacterVoicesPanel.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/voice/CharacterVoicesPanel.jsx)
- [AudioDuckingPanel.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/voice/AudioDuckingPanel.jsx)
- [ExportSettingsPanel.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/voice/ExportSettingsPanel.jsx)

### Phase 6: Popups & Modals — Gemini Multi-Key Route Studio
- [GeminiRouteModal.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx)
- [JobDashboardModal.jsx](file:///c:/Users/nhastar/Desktop/khmer_ai_dubbing_studio/frontend/src/components/dashboard/JobDashboardModal.jsx)

---

## 6. Verification & Quality Gates (5-Axis Review)
1. **Visual Accuracy**: Inspect in real browser at `http://localhost:5173`.
2. **Interactive States**: Every button and card must have `:hover`, `:active`, and `:disabled` feedback.
3. **Responsive Spacing**: No unintended horizontal scrollbars or clipping.
4. **Zero Broken Logic**: State, API calls, and audio-video sync remain 100% functional.
5. **Clean Production Build**: `npm --prefix frontend run build` must compile with 0 errors.
