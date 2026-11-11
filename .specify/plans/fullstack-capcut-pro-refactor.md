# Plan: Full-Stack CapCut Pro Studio Architecture & UI Refactor

## 1. Architecture & Component Boundary
- **Phase 1 — Frontend Hooks, Contexts & Barrel Exports**:
  - Create [`frontend/src/hooks/usePlaybackEngine.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/usePlaybackEngine.js) wrapping `useVideoPlayback` with `requestAnimationFrame` playhead ref subscription (`playheadTimeRef`, `subscribePlayhead`) so 60fps playhead scrubbing updates DOM transforms without forcing full-tree React re-renders.
  - Create [`frontend/src/context/ModalContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/ModalContext.jsx) exporting `ModalProvider` and `useModalManager`.
  - Create [`frontend/src/context/WorkspaceContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/WorkspaceContext.jsx) exporting `WorkspaceProvider` and `useStudioWorkspace` wrapping `projectStorage.js` helpers (`loadSavedVoiceSettings`, `saveVoiceSettings`, `saveEpisodeState`, `resolveDefaultAspectRatio`).
  - Add clean barrel `index.js` files inside `frontend/src/components/{layout,media,player,voice,timeline}/` while keeping direct `.jsx`/`.css` files at their existing paths so all existing test suite assertions remain 100% compatible.
- **Phase 2 — Modern CapCut Pro / DaVinci NLE UI Upgrade**:
  - Update [`frontend/src/styles/tokens.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/tokens.css) and [`frontend/src/styles/layout.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/styles/layout.css) with OKLCH semantic tokens (`oklch(0.72 0.14 195)`, `oklch(0.70 0.17 350)`, `oklch(0.68 0.16 250)`, `oklch(0.68 0.17 295)`), `--khmer-line-height: 1.68`, minimum `13px` Khmer badge/button typography, and horizontal/vertical split-pane resizer styles.
  - Extend [`frontend/src/hooks/useResizablePanels.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useResizablePanels.js) to support bottom timeline height resizing (`220px–450px`, default `290px`) and panel collapse toggles (`isLeftCollapsed`, `isRightCollapsed`, `isTimelineCollapsed`).
  - Add panel collapse/expand toggle buttons in [`frontend/src/components/layout/Navbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/layout/Navbar.jsx).
  - Enhance [`frontend/src/components/player/PlayerControls.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/PlayerControls.jsx) / [`VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/VideoPlayerPreview.jsx) with precision `HH:MM:SS.ms` readout, `16:9 | 9:16 | 1:1 | Fit` selector, and live Audio Ducking dB meter.
  - Enhance [`frontend/src/components/voice/VoiceSettings.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/VoiceSettings.jsx) & [`ClipInspectorPanel.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx) with collapsible accordion cards, inline optimistic spinner on `👩 ស្រីមុំ` / `👨 ពិសិដ្ឋ` toggle buttons, and sticky bottom `Export Rendered Video` CTA bar.
  - Enhance [`frontend/src/components/timeline/TimelineTrackHeaders.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTrackHeaders.jsx), [`TimelineTracksCanvas.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTracksCanvas.jsx), and [`TimelineEditor.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineEditor.jsx) with hardware-accelerated `transform: translate3d(x, 0, 0)` playhead scrubber and Solo (`S`), Mute (`M`), Lock (`🔒`) buttons on sticky track headers (`VIDEO 1`, `KHMER VOICE 1`, `SUBTITLES`, `CLEAN BGM`).
- **Phase 3 — Backend Structure & Reliability Hardening**:
  - Create [`backend/utils/processRegistry.js`](file:///e:/khmer_ai_dubbing_studio/backend/utils/processRegistry.js) to track active child processes (`pid`, `kind`, `jobId`, `mediaRef`) and cleanly terminate them on job cancel or server shutdown.
  - Wire `processRegistry` into [`backend/services/audioSeparationService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/audioSeparationService.js), [`backend/services/ffmpegService.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/ffmpegService.js), and [`backend/server.js`](file:///e:/khmer_ai_dubbing_studio/backend/server.js).
  - Create [`backend/middleware/validateRequest.js`](file:///e:/khmer_ai_dubbing_studio/backend/middleware/validateRequest.js) for standardized request validation & `{ success, data, error }` envelope helpers, and wire into [`backend/server.js`](file:///e:/khmer_ai_dubbing_studio/backend/server.js) along with scoped `5mb` default JSON body limit (`50mb` on series/script/video render routes).

## 2. API & Data Contracts
- All existing API routes (`/api`, `/api/jobs`, `/api/series`, `/uploads`) preserve their request/response formats.
- Validation middleware returns `{ success: false, error: "..." }` with HTTP `400` on malformed payloads.

## 3. Risks, Security & Rollback
- **Backward Compatibility**: All existing file paths referenced by `backend/tests/*.test.js` are preserved so zero existing tests break.
- **Process Safety**: `processRegistry.killAll()` and `killByJobOrMedia()` safely guard PID existence and use `taskkill /pid <pid> /T /F` on Windows (`win32`) plus `SIGTERM` fallback.

