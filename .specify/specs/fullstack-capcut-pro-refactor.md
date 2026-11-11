# Spec: Full-Stack CapCut Pro Studio Architecture & UI Refactor

## 1. Problem & Intent (Why)
- **Context & Background**: Khmer AI Dubbing Studio (CapCut Pro Edition) is an all-in-one AI video dubbing and drama storytelling desktop web workstation built with React 18, Vite, Lucide-React, Node.js/Express, FFmpeg, PyTorch Demucs v4, Microsoft Edge Neural TTS (`km-KH-PisethNeural`, `km-KH-SreymomNeural`), and Google Gemini (`geminiKeyManager`).
- **Problem Statement**:
  1. `frontend/src/App.jsx` holds modal visibility states, workspace persistence bindings, and high-frequency playback synchronization without dedicated `usePlaybackEngine`, `ModalContext` (`useModalManager`), and `WorkspaceContext` (`useStudioWorkspace`) abstractions.
  2. In `frontend/src/styles/tokens.css` & `layout.css`, the workspace lacks a vertical resizable splitter for the Bottom Timeline (`220px–450px`), panel collapse/expand toggles in `Navbar` for smaller laptop screens (`1366x768`, `1440x900`), OKLCH semantic track tokens, and collapsible accordion sections in `VoiceSettings.jsx`.
  3. On the backend (`backend/server.js`, `audioSeparationService.js`, `ffmpegService.js`), global `express.json({ limit: '50mb' })` applies to all routes instead of scoping high limits to script/series sync routes (`5mb` default), and child processes (Demucs Python / FFmpeg) need a centralized process registry (`processRegistry.js`) plus standardized request validation middleware.

## 2. User Scenarios & Stories (What)
- **Scenario 1 (60fps Playhead & Decoupled Contexts)**: User plays or scrubs the video timeline at `60fps`. `usePlaybackEngine` tracks high-frequency RAF frame progress and exposes a live playhead ref while `ModalContext` and `WorkspaceContext` isolate modal and storage state.
- **Scenario 2 (Resizable 3-Column + Bottom Timeline & Collapse Toggles)**: User drags horizontal splitters (`280px–420px` default range, clamped for viewport) or the vertical bottom timeline splitter (`220px–450px`), or clicks Left/Right/Bottom panel collapse buttons in `Navbar` on a laptop screen.
- **Scenario 3 (CapCut Pro Inspector, Player & Timeline UX)**:
  - Center Player Monitor displays a recessed matte viewport, precision `HH:MM:SS.ms` timecode, `16:9 | 9:16 | 1:1 | Fit` aspect ratio selector, live Audio Ducking dB meter, and `cqw`/`clamp()` Khmer subtitles.
  - Right Inspector (`VoiceSettings.jsx`) organizes settings into collapsible accordion cards (`Selected Clip Inspector`, `Character Voice Mapping`, `Smart Ducking & BGM Mix`, `Subtitle Styling`) with an inline optimistic loading spinner on `👩 ស្រីមុំ` / `👨 ពិសិដ្ឋ` voice toggle buttons and a sticky bottom `Export Rendered Video` CTA bar.
  - Multi-Track Timeline (`TimelineEditor.jsx`) uses hardware-accelerated `transform: translate3d(x, 0, 0)` for the playhead scrubber and sticky track headers (`VIDEO 1`, `KHMER VOICE 1`, `SUBTITLES`, `CLEAN BGM`) with Mute (`M`), Solo (`S`), and Lock (`🔒`) controls.
- **Scenario 4 (Backend Hardening & Process Cleanup)**:
  - Default JSON body limit is `5mb`, with `50mb` scoped to large script/series sync/export routes.
  - Cancelling a job or shutting down `server.js` cleanly terminates all registered FFmpeg and Demucs Python child processes via `processRegistry`.
  - Route payloads are validated cleanly before invoking `dubbingPipeline`, `ffmpegService`, or `ttsService`.

## 3. Scope & Boundaries
- **In Scope**:
  - Phase 1: `usePlaybackEngine.js`, `ModalContext.jsx` (`useModalManager`), `WorkspaceContext.jsx` (`useStudioWorkspace`), feature barrel exports (`layout/`, `media/`, `player/`, `voice/`, `timeline/`), and wiring into `App.jsx`.
  - Phase 2: OKLCH tokens & `--khmer-line-height: 1.68` (`13px` min Khmer badge/row/button size), vertical timeline splitter (`220px–450px`) + `Navbar` panel collapse toggles, `VideoPlayerPreview` live Audio Ducking dB meter + `Fit` ratio button, `VoiceSettings` collapsible accordion cards + sticky Export CTA, `TimelineEditor` `translate3d` playhead + Solo (`S`)/Mute (`M`)/Lock (`🔒`) track header buttons.
  - Phase 3: `backend/utils/processRegistry.js`, `backend/middleware/validateRequest.js`, scoped `5mb` / `50mb` JSON limits in `backend/server.js`, and integration into `audioSeparationService.js` & `ffmpegService.js`.
- **Out of Scope**:
  - Breaking existing API route URLs (`/api`, `/api/jobs`, `/api/series`, `/uploads`), keyboard shortcuts, or `projectStorage.js` data format.

## 4. Acceptance Criteria (Pass/Fail standard)
- [ ] Criteria 1: `usePlaybackEngine.js`, `ModalContext.jsx`, and `WorkspaceContext.jsx` are active in `App.jsx` with zero prop or test regressions.
- [ ] Criteria 2: Horizontal and vertical split-pane resizers + Navbar panel collapse toggles work smoothly and persist to `localStorage`.
- [ ] Criteria 3: `tokens.css` defines the OKLCH track tokens and `--khmer-line-height: 1.68`; `VoiceSettings`, `VideoPlayerPreview`, and `TimelineEditor` include all CapCut Pro NLE upgrades.
- [ ] Criteria 4: `backend/server.js` uses `5mb` default JSON limit (with `50mb` on heavy script/series routes), `validateRequest.js` guards route payloads, and `processRegistry.js` tracks & cleans up Demucs/FFmpeg child processes on cancel/shutdown.
- [ ] Criteria 5: `npm --prefix frontend run lint`, `npm --prefix frontend run build`, and backend test suites pass 100%.

