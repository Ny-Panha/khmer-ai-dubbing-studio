# Plan: Timeline UI, Features & Workflow Fix

## 1. Architecture & Component Boundary
- **Step 1 — `TimelineToolbar.jsx` & `TimelineEditor.jsx`**:
  - Pass `duration={totalDuration}` from `TimelineEditor.jsx` to `TimelineToolbar.jsx`.
  - Organize `TimelineToolbar.jsx` into 3 sections:
    - `.toolbar-left-actions`:
      - Group A (`.timeline-tool-group`): `Undo`, `Redo`, `Split`, `Delete`, and `Add Segment` (`<Plus size={13} /> <span>ថែមឃ្លា</span>`).
      - Group B (`.timeline-tool-group.timeline-segmented-pill`): `Full Video` (`active` when `videoClips.length <= 1`) and `Auto-Cut` (`active` when `videoClips.length > 1`).
      - Group C (`.timeline-tool-group`): `Auto-Align` (`onAutoAlignNoOverlap`), `Bridge Gaps` (`onBridgeGaps`), and `Reset Timing` (`onResetToSourceTiming` with neutral secondary style and Khmer tooltip `"កំណត់ម៉ោងសំឡេងតាមវីដេអូដើមវិញ (Reset to original timestamps)"`).
    - `.toolbar-center-timecode`:
      - `<span className="timeline-timecode-current">{formatMinSec(currentTime)}</span> / <span className="timeline-timecode-total">{formatMinSec(duration)}</span>`.
    - `.toolbar-right-actions`:
      - Toggle pills: `Snap` (`snappingEnabled ? 'Snap ON' : 'Snap OFF'`) and `Subs` (`showSubtitlesTrack ? 'Subs ON' : 'Subs OFF'`, preserving exact class string `className={\`timeline-pill-tool \${showSubtitlesTrack ? 'tool-magnet active' : 'tool-magnet'}\`}` required by `timeline_subtitles_toggle.test.js` with `data-subs-toggle="true"` for violet active styling).
      - Zoom & Playhead group: Zoom Out (`-`), Zoom Slider (`min="0.5" max="3.0" step="0.1"`), Zoom In (`+`), Fit Timeline (`Maximize2`), Auto-Center Playhead (`LocateFixed`).
- **Step 2 — `TimelineTrackHeaders.jsx`, `TimelineEditor.jsx` & `TimelineEditor.css`**:
  - Update `TRACK_HEADER_WIDTH = 148` in `TimelineEditor.jsx` and `.track-headers-column` (`width: 148px; min-width: 148px; max-width: 148px`) in `TimelineEditor.css`.
  - Pass `videoClips`, `onToggleMuteAllCuts`, `voiceSettings`, and `onUpdateVoiceSettings` to `TimelineTrackHeaders.jsx`, and pass `mutedTracks` to `TimelineTracksCanvas.jsx`.
  - Synchronize `VIDEO 1` mute state with `areAllCutsMuted` (`videoClips`) + `mutedTracks.video_0` / `mutedTracks.video`, calling `onToggleMuteAllCuts(true)` when toggled.
  - Synchronize `CLEAN BGM` mute state with `voiceSettings?.duckingVolume === 0 || Boolean(mutedTracks.cleanBgm)`, calling `onUpdateVoiceSettings({ ...voiceSettings, duckingVolume: isBgmMuted ? 0.15 : 0 })` and updating `mutedTracks.cleanBgm`.
  - Render `3px` colored left status bar on each track header, sub-badges `👨/គោល` on `VOICE 1` and `👩/បន្ទាប់` on `VOICE 2`, and `22px x 22px` `Mute`, `Solo`, `Lock` buttons.
- **Step 3 — `TimelineEditor.jsx` & `TimelineTracksCanvas.jsx`**:
  - In `TimelineEditor.jsx` (`segmentRows` useMemo) and `TimelineTracksCanvas.jsx` (`internalSegmentRows` useMemo), implement smart multi-lane voice routing for unshifted segments (`!seg.userShifted`):
    - Detect whether the episode has both Male and Female segments (`hasBothGenders`).
    - If `hasBothGenders`: route Male (`ប្រុស` / `Piseth`) to `VOICE 1` (`0`) and Female (`ស្រី` / `Sreymom`) to `VOICE 2` (`1`) (falling back to the alternate lane if a same-gender clip overlaps on the primary lane).
    - If single-gender: route non-colliding segments to `VOICE 1` (`0`), and automatically stagger overlapping or tight back-to-back segments (`rawStart < (rowEndTimes[0] || 0) + 0.15` when previous segment had a tight gap/overlap) onto `VOICE 2` (`1`) so `VOICE 2` is actively utilized and clips never collide or squash each other.
  - In `TimelineTracksCanvas.jsx`:
    - Visually dim muted lanes (`opacity: 0.45`, `.is-track-muted` with grayscale waveform) and display a `<span className="track-muted-badge">MUTED</span>` badge.
    - Responsive voice clip label rendering based on `audioWidth` (`clipWidthPx`):
      - `audioWidth < 48`: compact `#${idx + 1}` badge centered (`clip-compact-id`).
      - `48 <= audioWidth < 95`: `#${idx + 1} ${isFemale ? 'ស្រី' : 'ប្រុស'}${overMarker}${trimMarker}`.
      - `audioWidth >= 95`: `#${idx + 1} ${isFemale ? 'ស្រី' : 'ប្រុស'}${overMarker}${trimMarker}${pendingMarker}` on top + 1-line Khmer dialogue preview in `Kantumruy Pro` (`11px`) alongside waveform bars.
    - Update voice clip tooltip `title` to `#${idx + 1} [${speakerLabel}] (${startSec.toFixed(1)}s - ${endSec.toFixed(1)}s)\n"${khmerPreview || '(មិនទាន់មានអត្ថបទ / រង់ចាំសំឡេង)'}"`.
- **Step 4 — `TimelineEditor.css` & `TimelineTracksCanvas.jsx`**:
  - Style `.timeline-playhead`, `.playhead-line`, `.capcut-playhead-line`, `.playhead-handle`, and `.capcut-playhead-stem` in CapCut Coral Red (`#ff3b5c`) with `box-shadow: 0 0 6px rgba(255, 59, 92, 0.5)` and `z-index: 60`, plus a `.playhead-time-pill` badge connected to `playheadTimeTextRef`.
  - Keep `#00e5ff` / `#38BDF8` strictly for `.selected` clip borders and `.clip-trim-handle`.

