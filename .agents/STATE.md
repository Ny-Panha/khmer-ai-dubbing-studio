# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Single-Screen CapCut-Style Workspace Rework)
- **Timestamp**: 2026-11-07T21:55:00+07:00

## Summary of Completed Work

### 1. Architectural Pivot: Single-Screen Workspace (Supersedes 5-Page Wizard Shell)
Per Nha's decision, the 5-page wizard shell was replaced with ONE unified CapCut-style workspace screen with collapsible panels. Phases 1 & 2 content work is preserved and re-homed. The horizontal stepper is no longer navigation; stages are switched via the vertical Left Rail without unmounting centre components.

### 2. Workspace Panel Architecture

#### Top Bar & Left Rail
- **Navbar ([`frontend/src/components/Navbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/Navbar.jsx))**:
  - Series + episode selector, Gemini keys badge (clicking navigates directly to Script mode), Jobs queue modal, and Export button.
- **StageRail ([`frontend/src/components/workspace/StageRail.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/workspace/StageRail.jsx))**:
  - Vertical 5-stage status rail (1. Import, 2. Script, 3. Voice, 4. Demucs, 5. Mix & Export).
  - Collapsible between ~190px and ~56px icon-only mode.
  - Clicking any stage triggers `onSelectMode(step.id)` to switch `workspaceMode` without page unmount.
  - Stages are always clickable to view; gate status/lock icons indicate action availability.

#### Left Panel (Media Library & Series Manager)
- **MediaPanel ([`frontend/src/components/workspace/MediaPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/workspace/MediaPanel.jsx))**:
  - Width ~300px, collapsible to 0px with expand/collapse handle buttons.
  - Series title box & inline renaming.
  - Source Video Dropzone: automatically collapses to a slim bar (showing filename, duration, resolution, change, and remove buttons) once a video is loaded.
  - Scrollable episode list with real-time status pills (`Vid`, `Scr`, `Voice`, `BGM`, `Exp`).
  - Add Episode, Rename, Delete, and Auto-Split modal (`splitVideoEpisodesApi`).

#### Centre Working Column (Always Mounted, Zero Unmount)
- **VideoPlayerPreview ([`frontend/src/components/VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx))**:
  - Fixed on top of centre column inside `.workspace-centre-player-box`.
  - NEVER unmounts during mode switches; video playback, playhead, and audio continue uninterrupted.
- **ThinSeekStrip ([`frontend/src/steps/script/ThinSeekStrip.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/steps/script/ThinSeekStrip.jsx))**:
  - Mounted directly under the video player for timeline scrubbing, segment ticks, and active playhead position.
- **Bottom Working Area**:
  - When segments exist: renders **`WorkspaceToolbar`** (Re-Translate with safety confirmation modal, Auto-Align, Reset Timing, Add Line, Undo/Redo, Search, segment count, OVER timing badge, Key Pool status, and batch actions) + **`TranscriptSegmentList`** (virtualized with `@tanstack/react-virtual`, card text editing, timestamps, speaker/gender chips, delivery mode, audio preview, regeneration, and `⚠️ OVER` badge).
  - When in Script mode with 0 segments: renders **`InlineTranslatePanel`** with mode selector, single-click CTA button, 5-stage live progress bar, and Quota Manager.
  - When in Import mode with 0 segments: renders Episode Overview / Welcome Card with direct CTA to switch to Script mode.

#### Right Panel (Inspector & Contextual Stage Settings)
- Width ~320px, collapsible to 0px with expand/collapse handle buttons.
- **Top: ClipInspectorPanel ([`frontend/src/components/voice/ClipInspectorPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx))**:
  - Inspects and edits the selected segment: Khmer text, start/end time, delivery type, single TTS regeneration, voice selection, and speed.
- **Bottom: StageSettingsPanel ([`frontend/src/components/workspace/StageSettingsPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/workspace/StageSettingsPanel.jsx))**:
  - Contextual configuration based on `workspaceMode`:
    - `import`: Video technical metadata (resolution, duration, fps, file size) & active episode summary.
    - `script`: Translation mode configuration (Mode A 1:1 Dialogue vs Mode B Story Recap) & Series Glossary preview (characters & terms).
    - `voice`: Edge TTS voice catalog (Piseth, Sreymom), speech speed slider, voice volume, BGM ducking volume, and audition test listen button.
    - `demucs`: Demucs AI vocal separation controls, live progress (1-100%), kill process button (`POST /api/audio/separate-kill`), Clean BGM status badge, and prominent handling for HTTP 409 busy alerts (`Demucs AI កំពុងដំណើរការបំបែកសំឡេង...`).
    - `mix-export`: Audio ducking controls, Subtitle burn-in toggle & styles (Title Banner, CapCut Pill, Cinema Soft), video aspect ratio (16:9, 9:16, 1:1), and primary Render & Export Video CTA.

#### Bottom Strip (~32px)
- **BottomStatusStrip ([`frontend/src/components/workspace/BottomStatusStrip.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/workspace/BottomStatusStrip.jsx))**:
  - Left: Background Job Queue status (`Idle • Ready` or live running stage with worker ID).
  - Center: Realtime local activity badges (TTS synthesizing %, Demucs AI separation %, FFmpeg rendering %).
  - Right: Segment count (`💬 3 segments`), OVER warning count (`⚠️ 1 OVER`), Key Pool health (`Pool: 4/4 online • 60 RPM`), and active episode badge (`EP01`).

### 3. Verification & Quality Acceptance
- **Build**: `npm --prefix frontend run build` ➔ **PASS** (2.32s, 0 errors).
- **Screenshot Evidence (Artifact Directory: `C:\Users\nhastar\.gemini\antigravity\brain\0ecba6af-7642-4551-8d6b-1c88186a6633\`)**:
  - `screenshot-shell-script-mode.png` (167 KB): Full workspace in Script mode with all panels open (StageRail, MediaPanel, Centre Player + Seek Strip + TranscriptSegmentList, Right Inspector + StageSettings).
  - `screenshot-shell-voice-mode.png` (135 KB): Full workspace in Voice mode with TTS toolbar, Edge TTS voice settings, and OVER warning badge.
  - `screenshot-shell-collapsed.png` (75 KB): Both Left Media Panel and Right Inspector Panel collapsed, providing wide-screen editing canvas.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express, online)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, online)
- **Git Branch**: `main`

## Next Steps
- Await Nha's review and approval of the single-screen CapCut-style workspace shell.
