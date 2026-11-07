# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Classic Suite Restoration & Workspace Shell Retirement)
- **Timestamp**: 2026-11-08T00:58:00+07:00

## Summary of Completed Work

### 1. Classic Suite UI Restored (Nha's Decision)
- **Reversal from Single-Screen Workspace**: Restored the classic 3-column suite as the primary application UI (`App.jsx` structure as of `c3b10ea` adapted to current hooks):
  - **Navbar**: Brand mark + Gemini Route console launcher (with 4 Keys badge) + Job queue launcher + API Key config + Only filled Export button.
  - **WorkflowStepper (FLOW Stepper)**: Restored classic status display (Flow: 1. Import video ➔ 2. Translate & script ➔ 3. Khmer voice (TTS) ➔ 4. Demucs AI ➔ 5. Mix & export).
  - **Top 3-Column Suite**:
    - **Left Column**: Resizable `MediaLibrary` with 4 classic tabs (`Episodes`, `1. Video`, `2. Script`, `3. Subs` [virtualized `ScriptReviewTab`]).
    - **Centre Column**: `VideoPlayerPreview` with player monitor canvas, playhead scrubber, and fullscreen preview.
    - **Right Column**: Resizable `VoiceSettings` (Audio & Export inspector) with ClipInspector, AudioDucking, and ExportSettings.
  - **Bottom Column**: `TimelineEditor` multi-track editor (video track, audio track, subtitle track, clip split/delete, undo/redo, auto-align).

### 2. Single Translate Flow Preserved
- **Audited `DubbingModeTab` vs `GeminiRouteTab`**:
  - Kept `DubbingModeTab` as the single translate surface for the episode in the classic suite (Mode A dialogue vs Mode B recap, prompt/genre, live 0%-100% runner, console terminal logs, Demucs/TTS triggers).
  - Removed duplicate `GeminiRouteTab` from the suite tabs entirely.
  - `GeminiRouteModal` retained exclusively as the dedicated **BATCH & KEYS CONSOLE** (batch translation + Gemini key pool management).
  - Preserved single shared job queue (`JobQueueContext` / `useSharedJobQueue`) with zero duplicate polling.

### 3. Re-Translate Overwrite Confirmation Enforced
- Integrated overwrite-confirmation dialog into `DubbingModeTab` whenever generating/re-translating an episode that already has an existing script.
- Warns user before wiping edits, explains auto-backup, and requires explicit confirmation.

### 4. Clean Pass 3 Design Tokens Applied
- Applied OKLCH measured ramp: `--floor`, `--app`, `--panel`, `--muted`, `--line`, `--ink`, `--ink-dim`.
- Type scale: Labels 500/12px sentence case (no ALL-CAPS bars), body 400/14px, numbers in mono 12px (`var(--font-mono)`).
- Buttons: 36px height, `border-radius: 6px` (`var(--radius-sm)`), ghost-by-default with `var(--line)`, with Export as the only filled chrome button (+ translate CTA inside its panel).
- Zone separation: Value step + 1px `var(--line)` only, zero floating cards/shadows on outer workspace zones.

### 5. Retired Shell Deleted (Clean Repo)
Deleted 25 obsolete files (all recoverable from git history `5e46f19`, `ed2cc5e`):
- `components/workspace/`: `StageRail.jsx`, `StageRail.css`, `MediaPanel.jsx`, `MediaPanel.css`, `StageSettingsPanel.jsx`, `StageSettingsPanel.css`, `BottomStatusStrip.jsx`, `BottomStatusStrip.css`, `InlineTranslatePanel.jsx`, `WorkspaceToolbar.jsx`, `WorkspaceToolbar.css`, `WorkspaceLayout.css`
- `steps/`: `registry.js`, `demucs/DemucsPage.jsx`, `import/ImportPage.jsx`, `import/ImportPage.css`, `mix-export/MixExportPage.jsx`, `script/ScriptPage.jsx`, `script/ScriptPage.css`, `script/ThinSeekStrip.jsx`, `script/ThinSeekStrip.css`, `voice/VoicePage.jsx`
- `features/segment-list/`: `TranscriptSegmentList.jsx`, `TranscriptSegmentList.css`
- `components/media/`: `GeminiRouteTab.jsx`

### 6. Full Real Flow Verification & Evidence
- **Build**: `npm --prefix frontend run build` ➔ **PASS** (1.81s, 0 errors).
- **Backend API**: Verified online at `http://localhost:5000` (4 active Gemini keys).
- **Vite Proxy**: Verified online at `http://localhost:5173`.
- **Full End-to-End Test (Playwright)**:
  1. Loaded classic suite with 3-column layout + timeline editor (`classic_main_screen.png`).
  2. Selected episode and opened 2. Script tab with DubbingModeTab.
  3. Re-translate overwrite confirmation dialog verified and confirmed.
  4. Script translation runner executed with live progress and terminal logs (`translate_running.png`).
  5. Script segments loaded into virtualized `ScriptReviewTab`.
  6. Edited segment text and committed successfully.
  7. Single segment TTS voice regeneration executed and verified (`voice_generated.png`).
  8. Demucs vocal separation status checked.
  9. Video preview playback tested with audio synchronization.
  10. Export settings and Export button verified reachable.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express, online)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, online)
- **Git Branch**: `main`

## Next Steps
- Await Nha's review and approval.
