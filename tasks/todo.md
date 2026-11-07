# Tasks: DragonDub AI Studio Full UI Redesign (/agents-design)

## Checkpoint 1: Foundations & Top Navigation (Phase 1 & 2)
- [x] Task 1.1: [frontend/src/index.css] - Add 4-tier layer depth variables (`--layer-0` to `--layer-3`), spring motion curves, `.capcut-app-container` shell fix, and typography utilities. (Verify: `npm --prefix frontend run build` - PASS)
- [x] Task 1.2: [frontend/src/components/Navbar.jsx] - Modernize floating glass navbar, episode selector dropdown, and status pills. (Verify: Browser inspection at `http://localhost:5173`)
- [x] Task 1.3: [frontend/src/components/WorkflowStepper.jsx] - Refactor 4-step workflow bar with pill indicators and active glow. (Verify: Browser inspection at `http://localhost:5173`)

## Checkpoint 2: Left Suite & Media Library (Phase 3)
- [x] Task 2.1: [frontend/src/components/MediaLibrary.jsx] - Refactor left tab buttons, header bar, and layout container. (Verify: Tab switching works smoothly)
- [x] Task 2.2: [frontend/src/components/media/MediaUploadTab.jsx] - Modernize active video card, metadata pills, and dashed drag-and-drop zone. (Verify: Clean pro upload UI)
- [x] Task 2.3: [frontend/src/components/media/DubbingModeTab.jsx] - Polish script segment hub, Mode A vs Mode B cards, and Demucs/TTS trigger buttons. (Verify: Tactile cards and progress tracks)

## Checkpoint 3: Center Stage & Video Preview (Phase 4)
- [x] Task 3.1: [frontend/src/components/VideoPlayerPreview.jsx] - Modernize video player frame, aspect ratio container, and ambient drop glow. (Verify: Video plays without layout shift)
- [x] Task 3.2: [frontend/src/components/player/PlayerControls.jsx] - Refactor floating player toolbar (Play, Pause, Speed, Safe Zone, Anti-Theft toggle). (Verify: Interactive controls respond cleanly)

## Checkpoint 4: Right Suite — Voice & Export Panels (Phase 5)
- [x] Task 4.1: [frontend/src/components/VoiceSettings.jsx] - Modernize container for Right Inspector and tactile test buttons. (Verify: Panel switching works smoothly)
- [x] Task 4.2: [frontend/src/components/voice/ExportSettingsPanel.jsx] - Polish export resolution, format pills, and render trigger button with `.capcut-export-btn`. (Verify: Export triggers cleanly)

## Checkpoint 5: Popups & Modals (Phase 6)
- [x] Task 5.1: [frontend/src/components/dashboard/GeminiRouteModal.jsx] - Modernize Gemini Multi-Key Route Studio modal with `backdrop-blur-md`, spring modal scale, clean episode cards, and batch execution buttons (`🚀 Translate`, `🎙️ បង្កើតសំឡេងខ្មែរ AI` & `🎧 បំបែកសំឡេងដើម AI`). (Verify: Modal opens smoothly and batch actions fire)
- [x] Task 5.2: [frontend/src/components/dashboard/JobDashboardModal.jsx] - Refactor queue dashboard modal with real-time job progress bar and log console. (Verify: Job logs stream cleanly)

## Checkpoint 6: Final Integration & 5-Axis Review
- [x] Task 6.1: Full production build test (`npm --prefix frontend run build` - PASS in 626ms).
- [x] Task 6.2: 5-Axis quality, security, and performance review.
- [x] Task 6.3: Sync state to `.agents/STATE.md`.
