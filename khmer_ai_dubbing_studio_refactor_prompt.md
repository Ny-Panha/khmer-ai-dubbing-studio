# Khmer AI Dubbing Studio — Full-Stack Structure & UI Refactoring Prompt

Use the master prompt below in your AI IDE (Cursor, Windsurf, Claude Code, or Antigravity CLI) on the [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) repository to refactor the codebase architecture and upgrade the CapCut Pro desktop workstation UI.

## 1. Codebase Audit Summary

| Area | Current State in `khmer-ai-dubbing-studio` | Key Issue to Fix | Target Improvement |
| :--- | :--- | :--- | :--- |
| **Frontend State (`frontend/src/App.jsx`)** | Root component holds monolithic state (`useState`, `useRef`, `useEffect`), modal visibility flags, timeline sync, and `projectStorage.js` calls | High prop-drilling and frequent full-tree re-renders during `60fps` video playback and playhead scrubbing | Split into modular domain contexts/hooks (`useStudioWorkspace`, `usePlaybackEngine`, `useTimelineState`, `useModalManager`) |
| **Component Co-location (`frontend/src/components/`)** | Mixes top-level files (`MediaLibrary.jsx`, `Navbar.jsx`, `TimelineEditor.jsx`, `VideoPlayerPreview.jsx`, `VoiceSettings.jsx`) alongside subfolder directories (`media/`, `player/`, `timeline/`, `voice/`) | Fragmented imports and duplicated CSS between root components and feature folders | Consolidate each panel into its own feature directory (`media/`, `player/`, `timeline/`, `voice/`, `layout/`) with clean barrel exports |
| **Styling & Design System (`frontend/src/index.css`)** | Uses `oklch()` dark tokens (`--floor`, `--app`, `--panel`, `--muted`, `--line`, `--ink`, `--ink-dim`) and `--layer-0..2` with `Kantumruy Pro`, `Battambang`, and `Inter` fonts | Fixed panel widths, cramped Khmer script line-heights in dense inspector cards, and no resizable split panes | Add draggable split-pane gutters, Khmer-optimized line-height (`1.65`) and badge spacing, subtle glassmorphic floating toolbars, and micro-interaction states |
| **Backend API & Payload Handling (`backend/server.js`)** | Express server mounts `/api`, `/api/jobs`, `/api/series`, and `/uploads` (`mediaStreamMiddleware`) with `50mb` JSON/URL-encoded body limits and `.env` hot-reloading (`geminiKeyManager`) | Large `50mb` JSON bodies can spike Node.js heap memory; route controllers lack centralized request validation and unified error envelopes | Enforce streaming multipart uploads, add schema validation middleware, standardize `{ success, data, error }` JSON responses, and isolate worker IPC |

## 2. Copy-Paste Master Refactoring Prompt (English)

### Role & Objective
You are a Principal Full-Stack React & Node.js Architect and Senior DAW/NLE UI Designer. We are refactoring [Khmer AI Dubbing Studio (CapCut Pro Edition)](https://github.com/Ny-Panha/khmer-ai-dubbing-studio), an all-in-one AI video dubbing and drama storytelling desktop web studio built with React 18, Vite, Lucide-React, Node.js/Express, FFmpeg, PyTorch Demucs v4, Microsoft Edge Neural TTS (`km-KH-PisethNeural`, `km-KH-SreymomNeural`), and Google Gemini (`geminiKeyManager` multi-key pool).

Execute the following refactoring plan systematically without breaking existing API routes (`/api`, `/api/jobs`, `/api/series`, `/uploads`), keyboard shortcuts (`Space`, `Ctrl+B`, `Delete`, `Arrow` keys), or local storage persistence (`projectStorage.js`).

### Phase 1: Frontend Architecture & State Decoupling (`frontend/src/`)
1. **Decompose `frontend/src/App.jsx` State:**
   - Extract video playback and high-frequency `currentTime` tracking into `src/hooks/usePlaybackEngine.js` using `requestAnimationFrame` and refs so `currentTime` updates do not trigger full re-renders of `MediaLibrary` or `VoiceSettings`.
   - Extract modal state (`GeminiQuotaModal`, `GeminiRouteModal`, `JobDashboardModal`, `BatchExportStudioModal`, `ShortcutsModal`) into `src/context/ModalContext.jsx` (`useModalManager`).
   - Extract project/episode state and `projectStorage.js` persistence (`loadSavedVoiceSettings`, `saveVoiceSettings`, `saveEpisodeState`, `resolveDefaultAspectRatio`) into `src/context/WorkspaceContext.jsx`.
2. **Consolidate Feature Folder Structure:**
   - Move root-level panel files into their corresponding feature folders while preserving functionality:
     - `src/components/Navbar.jsx` & `Navbar.css` -> `src/components/layout/Navbar/`
     - `src/components/MediaLibrary.jsx` & `MediaLibrary.css` -> `src/components/media/MediaLibrary/`
     - `src/components/VideoPlayerPreview.jsx` & `VideoPlayerPreview.css` -> `src/components/player/VideoPlayerPreview/`
     - `src/components/VoiceSettings.jsx` & `VoiceSettings.css` -> `src/components/voice/VoiceSettings/`
     - `src/components/TimelineEditor.jsx` & `TimelineEditor.css` -> `src/components/timeline/TimelineEditor/`

### Phase 2: Modern CapCut Pro / DaVinci NLE UI Upgrade (`frontend/src/index.css` & Components)
1. **Refined OKLCH Token Hierarchy & Khmer Typography (`frontend/src/index.css`):**
   - Preserve and refine the existing `oklch()` studio tokens (`--floor`, `--app`, `--panel`, `--muted`, `--line`, `--ink`, `--ink-dim`, `--layer-0`, `--layer-1`, `--layer-2`).
   - Add semantic accent tokens for active timeline tracks:
     - Video Track Accent: teal/cyan (`oklch(0.72 0.14 195)`)
     - Female Voice (`km-KH-SreymomNeural`) Clip Pill: rose/pink (`oklch(0.70 0.17 350)`)
     - Male Voice (`km-KH-PisethNeural`) Clip Pill: electric blue (`oklch(0.68 0.16 250)`)
     - Subtitle Track Clip Pill: violet (`oklch(0.68 0.17 295)`)
   - Optimize Khmer script legibility (`Kantumruy Pro`, `Battambang`): set `--khmer-line-height: 1.68` and minimum `13px` font size on Khmer badges, subtitle editor rows, and buttons so stacked Khmer subscripts/superscripts (`ជើងអក្សរ` និង `ស្រៈលើ/ក្រោម`) never clip vertically.
2. **Resizable 3-Column & Bottom Timeline Split Workspace:**
   - Replace rigid panel dimensions with CSS Grid + interactive resize handles (`4px` hit target with hover highlight) between Left Panel (`MediaLibrary`, `280px–420px`), Center Monitor (`VideoPlayerPreview`, `1fr`), Right Inspector (`VoiceSettings`, `300px–420px`), and Bottom Multi-Track Timeline (`TimelineEditor`, `220px–450px`).
   - Add panel collapse/expand toggles in the top `Navbar` for smaller laptop screens (`1366x768` and `1440x900`).
3. **Center Player Monitor (`VideoPlayerPreview.jsx`) Polish:**
   - Frame the video canvas inside a recessed matte viewport (`background: var(--floor)`, subtle `1px solid var(--line)` border) with a floating glassmorphic transport bar (`Play/Pause`, precision timecode `HH:MM:SS.ms`, Aspect Ratio selector `16:9 | 9:16 | 1:1 | Fit`, and live Audio Ducking dB meter).
   - Ensure the live Khmer subtitle overlay scales proportionally to the video container height using `clamp()` and container queries.
4. **Right Inspector & 1-Click Voice Switcher (`VoiceSettings.jsx`):**
   - Organize the right panel into collapsible accordion cards (`Selected Clip Inspector`, `Character Voice Mapping`, `Smart Ducking & BGM Mix`, `Subtitle Styling`, and a sticky bottom `Export Rendered Video` CTA bar).
   - Add an inline optimistic loading spinner (`~300ms` audio regen indicator) on the `👩 ស្រីមុំ` / `👨 ពិសិដ្ឋ` 1-click voice toggle buttons.
5. **Multi-Track Timeline (`TimelineEditor.jsx`) UX:**
   - Make the Timeline Toolbar sticky with grouped icon+label buttons (`Split Ctrl+B`, `Auto-Cut by Subs`, `Bridge Gaps`, `Delete`) on the left, timecode readout in the center, and smooth zoom slider (`0.5x–3.0x`) on the right.
   - Render a sticky left track-header column (`VIDEO 1`, `KHMER VOICE 1`, `SUBTITLES`, `CLEAN BGM`) with Mute (`M`), Solo (`S`), and Lock (`🔒`) buttons.
   - Use hardware-accelerated `transform: translate3d(x, 0, 0)` for the red playhead scrubber so scrubbing stays at `60fps`.

### Phase 3: Backend Structure & Reliability Hardening (`backend/`)
1. **Standardized Controller & Validation Layer:**
   - Keep existing route signatures in `backend/routes/` (`systemRoutes`, `scriptRoutes`, `audioRoutes`, `videoRoutes`, `exportRoutes`, `jobRoutes`, `seriesRoutes`), but extract heavy inline route logic into controller functions and validate request payloads before invoking `dubbingPipeline`, `ffmpegService`, or `ttsService`.
2. **Memory-Safe Upload & Stream Handling (`backend/server.js`):**
   - Lower global `express.json({ limit: '5mb' })` for standard API endpoints and restrict high-payload limits strictly to subtitle/project import endpoints, relying on `multer` disk streaming and `mediaStreamMiddleware` for video/audio payloads.
3. **Graceful Subprocess & Worker Cleanup:**
   - Ensure `audioSeparationService.js` (Demucs worker) and `ffmpegService.js` register child process PIDs in a central process registry so cancelling a job or shutting down `server.js` cleanly terminates orphan Python/FFmpeg processes.

### Deliverables Expected from Assistant
1. Start by refactoring `frontend/src/index.css` and layout split-pane structure.
2. Refactor `frontend/src/App.jsx` into clean hooks/contexts without breaking any props.
3. Upgrade `Navbar`, `MediaLibrary`, `VideoPlayerPreview`, `VoiceSettings`, and `TimelineEditor` UI components.
4. Apply the backend hardening improvements in `backend/server.js` and `backend/routes/`.

## 3. ប្រអប់បញ្ជាជាភាសាខ្មែរ (Khmer Version of the Prompt)

អ្នកអាចចម្លង (Copy) Prompt ខាងក្រោមនេះដាក់ចូលក្នុង AI Coding IDE របស់អ្នក ប្រសិនបើអ្នកចង់បញ្ជាជាភាសាខ្មែរ៖

> សូមជួយ Refactor កូដ និងកែលម្អ UI ថ្មីសម្រាប់គម្រោង [Khmer AI Dubbing Studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) ដោយរក្សាមុខងារដើមទាំងអស់ឱ្យដើរធម្មតា៖
> 1. **រៀបចំរចនាសម្ព័ន្ធ Frontend (`frontend/src/App.jsx`):** បំបែក State ធំៗចេញពី `App.jsx` ទៅជា Custom Hooks និង Context (`usePlaybackEngine`, `ModalContext`, `WorkspaceContext`) ដើម្បីកុំឱ្យកម្មវិធីទាក់ (Lag) ពេលអូស Playhead លើ Timeline។
> 2. **រៀបចំ Folder របស់ Components ឱ្យមានរបៀបរៀបរយ:** ដាក់បញ្ចូល File នៅខាងក្រៅ (`Navbar.jsx`, `MediaLibrary.jsx`, `VideoPlayerPreview.jsx`, `VoiceSettings.jsx`, `TimelineEditor.jsx`) ទៅក្នុង Folder មុខងាររៀងៗខ្លួន (`layout/`, `media/`, `player/`, `voice/`, `timeline/`)។
> 3. **កែលម្អ UI បែប CapCut Pro / DaVinci Resolve (`frontend/src/index.css`):**
>    - បន្ថែមរបារអូសពង្រីក/បង្រួមផ្ទាំង (Resizable Split Panes) រវាងផ្ទាំងឆ្វេង កណ្តាល ស្តាំ និងផ្ទាំង Timeline ខាងក្រោម។
>    - កែសម្រួលកម្ពស់បន្ទាត់អក្សរខ្មែរ (`Kantumruy Pro` និង `Battambang` ប្រើ `line-height: 1.68`) ដើម្បីកុំឱ្យដាច់ស្រៈលើ-ក្រោម ឬជើងអក្សរនៅលើប៊ូតុង និងផ្ទាំងកែសម្រួល Subtitle។
>    - ធ្វើឱ្យបន្ទាត់ក្រហម (Red Playhead Scrubber) រត់រលូន `60fps` ដោយប្រើ `transform: translate3d()` និងបន្ថែមប៊ូតុង Mute/Lock នៅក្បាល Track នីមួយៗ។
>    - រៀបចំផ្ទាំងខាងស្តាំ (`VoiceSettings.jsx`) ជាប្រអប់ Accordion ស្អាតៗ និងដាក់ប៊ូតុង `Export Rendered Video` ឱ្យនៅជាប់ខាងក្រោមជានិច្ច (Sticky Footer CTA)។
> 4. **ពង្រឹង Backend (`backend/server.js`):** កាត់បន្ថយទំហំ JSON body limit ទូទៅឱ្យសមស្រប ដើម្បីកុំឱ្យស៊ី RAM ខ្លាំង និងគ្រប់គ្រងការបិទ Process របស់ FFmpeg / Demucs ឱ្យដាច់ស្រឡះពេលអ្នកប្រើប្រាស់ចុច Cancel Job។
