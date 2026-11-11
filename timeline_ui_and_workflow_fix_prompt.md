# Khmer AI Dubbing Studio — Timeline UI, Features & Workflow Fix Prompt

Use the prompt below in your AI IDE (Cursor, Windsurf, Claude Code, or Antigravity CLI) on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) to fix the exact UI bugs, broken button flows, and track layout issues in `TimelineEditor.jsx`, `TimelineToolbar.jsx`, `TimelineTrackHeaders.jsx`, `TimelineTracksCanvas.jsx`, and `TimelineEditor.css`.

## 1. Visual & Functional Bugs Identified in Your Timeline Screenshots

| Component | Bug Found in Screenshot & Code | Root Cause in [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio) | Exact Fix |
| :--- | :--- | :--- | :--- |
| **`+ + ឃ្លា` Button (`TimelineToolbar.jsx`)** | Displays duplicate plus signs (`+ + ឃ្លា`) | Renders `<Plus size={12} />` icon next to literal string `"+ ឃ្លា"` | Change label to `<Plus size={13} /> <span>ថែមឃ្លា</span>` |
| **Messy Toolbar Flow (`TimelineToolbar.jsx`)** | Rainbow button borders (`Auto-Align`, `Reset Timing`, `Snap ON`, `BGM Muted`) mix clip edits, destructive resets, and view toggles in random order | All 12+ actions are dumped into flat button groups without step-by-step dubbing workflow hierarchy | Group toolbar into 4 logical workflow zones: **1. History & Clip Edit** -> **2. Video Cut Mode** -> **3. Voice Sync & Timing** -> **4. View, Timecode & Zoom** |
| **Duplicate / Desynced Mute Controls (`TimelineToolbar.jsx` & `TimelineTrackHeaders.jsx`)** | `[🔊 Mute]` and `[🔇 BGM Muted]` in top toolbar do not update the speaker icons on `VIDEO 1` and `CLEAN BGM` track headers | `mutedTracks` state in `TimelineEditor.jsx` is local and disconnected from `onToggleMuteAllCuts` and `voiceSettings.duckingVolume` | Remove redundant `[Mute]` / `[BGM Muted]` clutter from top toolbar (or two-way bind them) so clicking Mute on `VIDEO 1` or `CLEAN BGM` track headers directly updates audio output and toolbar state |
| **`CLEAN B` Truncated Header (`TimelineTrackHeaders.jsx`)** | `CLEAN BGM` is cut off as `CLEAN B` and collides with `[🔊] [S] [🔒]` icons | Track header column is too narrow and squeezes title + 3 buttons onto one tight line | Widen `.capcut-track-headers` to `148px` with flex `justify-content: space-between` and `white-space: nowrap` |
| **Empty `VOICE 2` Track & Cramped `#...` Clips (`TimelineTracksCanvas.jsx`)** | All 19 segments pile onto `VOICE 1` (`#2...`, `#7...`, `#12...` truncated), while `VOICE 2` sits completely empty | Segments default to `row: 0` (`VOICE 1`) with no automatic speaker-lane routing (`ប្រុស` vs `ស្រី`) or checkerboard staggering | Route `ប្រុស` (Male / `VOICE 1`) and `ស្រី` (Female / `VOICE 2`) automatically (or stagger overlapping clips), and show compact `#ID` pills on narrow clips (`< 56px`) with full Khmer dialogue tooltip on hover |
| **Playhead Blends into Selected Clip (`TimelineEditor.css`)** | Cyan playhead stem (`#00e5ff`) merges visually into the cyan border of selected clip `#6 ប្រុស` | Both `.capcut-playhead-line` and `.selected` clip border use the same cyan accent color | Style the playhead in high-contrast **CapCut Coral Red (`#ff3b5c`)** with a top timecode pill, keeping cyan (`#00e5ff`) exclusively for selected clips |

## 2. Copy-Paste Prompt for Your AI IDE (English + Khmer Specs)

### Role & Task
You are a Senior React/Vite NLE Timeline Engineer working on [Ny-Panha/khmer-ai-dubbing-studio](https://github.com/Ny-Panha/khmer-ai-dubbing-studio). Refactor `frontend/src/components/TimelineEditor.jsx`, `frontend/src/components/TimelineEditor.css`, `frontend/src/components/timeline/TimelineToolbar.jsx`, `frontend/src/components/timeline/TimelineTrackHeaders.jsx`, and `frontend/src/components/timeline/TimelineTracksCanvas.jsx` to fix the UI layout, feature connections, and user workflow.

### Step 1: Fix `TimelineToolbar.jsx` Workflow Order & Button States
Reorganize the top toolbar into a clean 3-section bar (Left Workflow Actions, Center Timecode Readout, Right View & Zoom Controls) with consistent dark NLE styling:

1. **Left Section — Logical 3-Stage Dubbing Flow:**
   - **Group A — History & Clip Actions:**
     - `Undo` (`Ctrl+Z`) & `Redo` (`Ctrl+Y`) icon buttons.
     - `Split` (`<Scissors size={13} /> Split`, `Ctrl+B`) — enabled when playhead is over an unlocked clip/segment.
     - `Delete` (`<Trash2 size={13} />`, `Del`) — subtle danger hover state, disabled when `!canDelete`.
     - `Add Segment` (`<Plus size={13} /> <span>ថែមឃ្លា</span>`) — **FIX BUG:** remove the duplicate `+` sign from the text so it never renders `+ + ឃ្លា`.
   - **Group B — Video Slicing Mode (Segmented Pill Toggle):**
     - Group `Full Video` (`onResetFullVideo`) and `Auto-Cut` (`onAutoSplitVideo`) as a unified segmented control (`[🎞️ Full Video | ✂️ Auto-Cut by Subs]`). Highlight `Auto-Cut` as active when `videoClips.length > 1`, and `Full Video` as active when `videoClips.length <= 1`.
   - **Group C — Voice Timing & Alignment Actions:**
     - `✨ Auto-Align` (`onAutoAlignNoOverlap`) — aligns voice clips and resolves overlaps.
     - `🔗 Bridge Gaps` (`onBridgeGaps`) — expose this existing prop as a clean button next to `Auto-Align` to close dead silence gaps when needed.
     - `↺ Reset Timing` (`onResetToSourceTiming`) — use a neutral secondary button style (remove the loud yellow border) and ask for confirmation or show a tooltip `"កំណត់ម៉ោងសំឡេងតាមវីដេអូដើមវិញ (Reset to original timestamps)"`.
2. **Center Section — Live Studio Timecode Display:**
   - Add a crisp monospace timecode pill in the center of the toolbar showing:
     `<span className="timeline-timecode-current">{formatMinSec(currentTime)}</span> / <span className="timeline-timecode-total">{formatMinSec(duration)}</span>`
3. **Right Section — Toggles & Zoom Navigation:**
   - **Toggle Pills (Unified Active/Inactive Styling):**
     - `🧲 Snap` (`snappingEnabled` toggle — subtle cyan pill when ON, muted dark pill when OFF).
     - `💬 Subs` (`showSubtitlesTrack` toggle — subtle violet pill when `Subs ON`, muted dark pill when `Subs OFF`).
   - **Zoom & Playhead Controls:**
     - Zoom Out (`-`), Zoom Slider (`0.5x` to `3.0x`), Zoom In (`+`), Fit Timeline (`⤢`), and Auto-Center Playhead (`🎯` `autoCenter`).

### Step 2: Fix `TimelineTrackHeaders.jsx` Truncation & Two-Way Mute Binding
1. **Fix `CLEAN BGM` Text Truncation (`CLEAN B` Bug):**
   - Increase track header column width in `TimelineEditor.css` from `~95px` to `148px` (`min-width: 148px; max-width: 148px`).
   - Layout each track header row (`VIDEO 1`, `VOICE 1`, `VOICE 2`, `SUBTITLES`, `CLEAN BGM`) with a colored left status bar (`3px` wide: cyan for `VIDEO`, blue/pink for `VOICE`, violet for `SUBTITLES`, emerald/amber for `CLEAN BGM`), full non-truncated track title (`font-size: 11px; font-weight: 600; white-space: nowrap`), and a compact right-aligned control group (`Mute`, `Solo`, `Lock` at `22px x 22px` each).
2. **Unify Audio Mute Logic Between Track Headers and Toolbar:**
   - Connect `CLEAN BGM` track header's Mute button directly to `voiceSettings.duckingVolume` (`onUpdateVoiceSettings({ ...voiceSettings, duckingVolume: isBgmMuted ? 0.15 : 0 })`) in addition to `mutedTracks.cleanBgm`, so muting `CLEAN BGM` on the track header or toolbar stays 100% synchronized.
   - Connect `VIDEO 1` track header's Mute button directly to `onToggleMuteAllCuts` so muting `VIDEO 1` actually mutes the source video clips.
   - Visually dim any muted track lane in `TimelineTracksCanvas.jsx` (`opacity: 0.45`, grayscale waveform) and show a small `MUTED` badge when muted.

### Step 3: Fix `VOICE 1` & `VOICE 2` Multi-Lane Routing & Narrow Clip Rendering (`TimelineTracksCanvas.jsx`)
1. **Smart Multi-Track Voice Distribution (`VOICE 1` vs `VOICE 2`):**
   - Stop leaving `VOICE 2` completely empty when all segments default to `row: 0`.
   - When segments do not have an explicit manual `row` assigned:
     - Automatically route **Male speaker segments (`ប្រុស` / `Piseth`)** to `VOICE 1` (`row: 0`) and **Female speaker segments (`ស្រី` / `Sreymom`)** to `VOICE 2` (`row: 1`), **OR** if all segments share one gender, automatically alternate/stagger overlapping or back-to-back segments (`gap < 0.15s`) onto `VOICE 2` so clips never collide or squash each other!
   - Update the track header labels or sub-badges to show track purpose clearly:
     - `VOICE 1` (with subtle `👨/គោល` indicator)
     - `VOICE 2` (with subtle `👩/បន្ទាប់` indicator)
2. **Fix Unreadable `#2...` / `#...` Narrow Voice Clips:**
   - Apply distinct semantic colors to voice clips based on speaker gender:
     - Male (`ប្រុស`): Deep studio blue background (`oklch(0.28 0.08 250)`) with electric blue top accent bar.
     - Female (`ស្រី`): Deep studio rose background (`oklch(0.28 0.09 350)`) with rose-pink top accent bar.
   - Responsive Clip Label Rendering based on calculated clip pixel width (`clipWidthPx`):
     - If `clipWidthPx < 48px`: Render only the compact badge `#6` centered, hiding the `ប្រុស/ស្រី` text so it never cuts off as `#...`.
     - If `48px <= clipWidthPx < 95px`: Render `#6 ប្រុស` cleanly.
     - If `clipWidthPx >= 95px`: Render `#6 ប្រុស` on top + 1-line preview of the Khmer dialogue text (`segment.text` or `segment.khmerText`) in `Kantumruy Pro` (`11px`).
   - Add a rich floating tooltip (`title` or custom hover popover) on every voice clip showing:
     `#${idx + 1} [${speaker}] (${start}s - ${end}s)\n"${khmerText}"`

### Step 4: Fix Playhead Scrubber vs. Selected Clip Contrast (`TimelineEditor.css`)
1. Change `.capcut-playhead-line` and `.capcut-playhead-stem` from cyan (`#00e5ff`) to **CapCut Coral Red (`#ff3b5c`)** with a subtle glow (`0 0 6px rgba(255, 59, 92, 0.5)`) and `z-index: 60`.
2. Keep `#00e5ff` (bright cyan) strictly for `.selected` clip borders and trim handles (`[ | ]`) so the playhead never blends into the active clip edge.

## 3. សង្ខេបចំណុចដែលត្រូវកែ (Khmer Quick Summary for Your IDE)

ប្រសិនបើអ្នកចង់បញ្ជាខ្លីៗជាភាសាខ្មែរទៅកាន់ Agent ក្នុង IDE អាចប្រើប្រអប់ខាងក្រោមនេះ៖

> សូមអនុវត្តការកែសម្រួលក្នុង `timeline_ui_and_workflow_fix_prompt.md` លើ `TimelineEditor.jsx`, `TimelineToolbar.jsx`, `TimelineTrackHeaders.jsx`, `TimelineTracksCanvas.jsx` និង `TimelineEditor.css` ដូចខាងក្រោម៖
> 1. **កែប៊ូតុង `+ + ឃ្លា` លើ Toolbar:** លុបសញ្ញា `+` ស្ទួនចេញ ដោយដាក់ `<Plus size={13} /> <span>ថែមឃ្លា</span>` និងរៀបលំដាប់ប៊ូតុងលើ Toolbar តាម Flow ការងារ (1. Undo/Redo/Split/Delete/ថែមឃ្លា -> 2. Full Video / Auto-Cut -> 3. Auto-Align / Bridge Gaps / Reset Timing -> 4. Timecode កណ្តាល -> 5. Snap / Subs / Zoom)។
> 2. **ភ្ជាប់ប៊ូតុង Mute ឱ្យស៊ីគ្នា (Sync Mute State):** ភ្ជាប់ប៊ូតុង Mute នៅក្បាល Track `VIDEO 1` ជាមួយ `onToggleMuteAllCuts` និងក្បាល Track `CLEAN BGM` ជាមួយ `voiceSettings.duckingVolume` ព្រមទាំងពង្រីកទទឹងជួរក្បាល Track (`148px`) កុំឱ្យពាក្យ `CLEAN BGM` ដាច់សល់ត្រឹម `CLEAN B`។
> 3. **ប្រើប្រាស់ `VOICE 2` ឱ្យមានប្រយោជន៍ និងកែ Clip តូចៗកុំឱ្យចេញ `#...`:** បែងចែកឃ្លាសន្ទនាដោយស្វ័យប្រវត្តិ (ឧ. តួប្រុស `VOICE 1`, តួស្រី ឬឃ្លាជាន់គ្នាដាក់ចុះមក `VOICE 2`) បែងចែកពណ៌ប្រុស (ខៀវ) និងស្រី (ផ្កាឈូក) ហើយបើ Clip ខ្លីពេក (`< 48px`) បង្ហាញតែលេខ `#2` និងបង្ហាញអត្ថបទពេញពេលដាក់ Mouse ពីលើ (Tooltip)។
> 4. **ប្តូរពណ៌បន្ទាត់ Playhead ជាពណ៌ក្រហម (`#ff3b5c`):** ដើម្បីកុំឱ្យវាជាន់ពណ៌ផ្ទៃខៀវខ្ចី (`#00e5ff`) របស់ប្រអប់ Clip ដែលកំពុង Select (`#6 ប្រុស`)។
