# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Unlimited Voice Lanes — Free Vertical Drag & Drop & Dynamic Lane Creation)
- **Timestamp**: 2026-11-08T20:30:00+07:00

## Latest Update: Unlimited Voice Lanes & Dynamic Vertical Drop

### Implementation Highlights
1. **Dynamic Lane Count Calculation**:
   - `voiceLaneCount = Math.max(2, highestUsedVoiceRow + 2, userVoiceTrackCount || 1, draggingVoiceTargetRow + 1)`.
   - Formula ensures all used voice lanes are rendered plus ONE always-empty drop lane at the bottom.
   - Removed `Math.min(1, ...)` and `Math.min(2, ...)` clamps in `TimelineEditor.jsx`, `TimelineTracksCanvas.jsx`, `TimelineTrackHeaders.jsx`, and `timelineUtils.js` — a segment's `trackRow` can now be any integer $\ge 0$.
2. **Vertical Drop & Track Creation**:
   - Dragging a voice clip down to lane $N$ assigns `seg.trackRow = N`, `seg.trackId = 'voice-' + (N + 1)`, and `seg.userShifted = true`.
   - The drop always succeeds and never snaps back to the original lane.
   - Dropping onto the bottom empty lane immediately turns it into the used lane and spawns a new empty lane below it on the next render.
   - Drag-over highlight badges dynamically show `"Drop to create VOICE {n}"` when hovering an empty/new lane, and `"Drop to place on VOICE {n}"` for existing lanes.
3. **Sticky Manual Placement in Auto-Align**:
   - In `autoAlignVoiceSegments` (`timelineUtils.js`), segments with `userShifted: true` preserve their exact `trackRow` without being renumbered or shifted up to empty lanes.
   - Non-userShifted segments continue packing across lanes 0 and 1.
4. **Cross-Lane Drop Stand (Requirement 4)**:
   - When dropping across lanes (`curSegRow !== finalTargetRow`), the drop stands at the dropped position even if it overlaps an existing clip on the target lane.
   - Horizontal time-clamping and magnetic edge snapping (`||`) remain active when moving horizontally within the same lane.
5. **Full Playback, Mix & Export Support**:
   - `VideoPlayerPreview.jsx` and `ffmpegService.js` iterate through all valid segments regardless of `trackRow`, ensuring audio from lanes $\ge 2$ is never silenced or omitted.
   - Verified persistence round-trip of `trackRow` and `userShifted` on EP2.

### Verification & Automated Tests
- `backend/tests/timeline_unlimited_voice_lanes.test.js` ➔ 5 passed, 0 failed.
- Full regression suite (16 tests across all timeline & split modules) ➔ 16 passed, 0 failed.
- Vite build (`npm --prefix frontend run build`) ➔ SUCCESS (1.37s).

## Latest Update: Regenerate Audio on Split Segment Audio Offset Reset & Zero-Playback Guard

### Problem Description
- **Symptom**: After splitting a segment on the timeline, Segment #2 was assigned an `audioOffset` (e.g. `3.83`s) to slice from the parent's audio file.
- When Nha clicked "Generate ឡើងវិញ" (regenerate audio) on Segment #2, a fresh TTS audio file (`ep_ep_2_seg_2_...mp3`, duration `3.672`s) was generated starting from `0.00`s.
- However, neither `useAudioDubbing.js`, `audioRoutes.js`, nor `ttsService.js` reset `audioOffset: 0` or `audioTrimmed: false`.
- As a result:
  1. `VideoPlayerPreview.jsx` sought the player to `3.83s` inside a `3.672s` file, immediately hitting EOF and pausing into complete silence.
  2. `createSynchronizedNarrationAudio` in `ffmpegService.js` ran `atrim=start=3.83:duration=3.672`, generating 0 bytes of narration audio.
  3. Video export also trimmed starting from `3.83s`, rendering silent audio in the final exported video.

### Root Cause & Resolution
1. **Reset on Regeneration (`backend/services/ttsService.js`)**:
   - In `generateSingleSegmentAudio`, explicitly reset `audioOffset: 0`, `audioTrimmed: false`, `userTrimmed: false`.
2. **Backend Route Persistence (`backend/routes/audioRoutes.js`)**:
   - In `series.json` update handler, persist `audioOffset: 0, audioTrimmed: false, userTrimmed: false` for the updated segment.
3. **Frontend Dubbing Hook (`frontend/src/hooks/useAudioDubbing.js`)**:
   - In `handleRegenerateSingleSegment`, `handleAutoRegenerateSegmentAudio`, and `handleChangeSpeed`, explicitly set `audioOffset: 0, audioTrimmed: false, userTrimmed: false` on the merged segment.
4. **Defensive Player & FFmpeg Clamping (`frontend/src/components/VideoPlayerPreview.jsx`, `backend/services/ffmpegService.js`)**:
   - If `audioOffset >= audioDurationSec`, defensively clamp `audioOffset` to `0` so stale/corrupted offset data can never cause silent playback or trimmed empty audio in player or export.
5. **Project EP2 Data Fixed & Master Narration Resynced**:
   - Updated `backend/uploads/projects/series_1793898268958/series.json` EP2 Segment #2 with `audioOffset: 0`, `audioTrimmed: false`.
   - Successfully re-synced `ep_2_narration_khmer.mp3` with all 502 segments.

### Verification & Tests
- `backend/tests/regenerate_split_audio_offset_reset.test.js` ➔ 3 passed, 0 failed.
- `npm --prefix frontend run build` ➔ Vite build succeeded in 1.40s.

## Latest Update: Strict Audio No-Overlap Clamp & Magnetic Edge Snapping on Timeline Tracks

### Feature: Audio Dragging Strict No-Overlap Clamp (`[#1] || [#2]`)
- **Problem**: When dragging audio clips horizontally on the same line (Track Row 0), moving a clip near an adjacent clip allowed it to slide directly over/into the neighboring clip (visual overlap bug shown in user screenshot #1).
- **Solution**:
  1. **Strict No-Overlap Clamp**: Added `prevBound` (max end of predecessor clips on same row) and `nextBound` (min start of successor clips on same row). When dragging, `newStart` is clamped to `Math.max(prevBound, newStart)` and `newEnd` is clamped to `Math.min(nextBound, newEnd)` — preventing overlap completely! Clips rigidly meet edge-to-edge (`||`) as requested by Nha (screenshot #2).
  2. **Magnetic Edge Snapping**: When a dragged audio clip approaches `prevBound` or `nextBound` within snap window (~0.15s), it magnetically snaps to the adjacent clip's edge and renders the vertical snap line.
  3. **Trimming Guard**: `trim-left` cannot expand past `prevBound`; `trim-right` cannot expand past `nextBound`.
  4. **Drop Persistence**: On mouse up, `updatedSeg` clamps to `finalTargetRow` boundaries before firing `onUpdateSegments`.

### Hotfix: ClipInspectorPanel `isKhmerEmpty` ReferenceError Resolved
- **Problem**: When rendering `<ClipInspectorPanel>`, `isKhmerEmpty` was evaluated at line 726/780/817 before being declared in component scope, triggering `Uncaught ReferenceError: isKhmerEmpty is not defined`.
- **Fix**: Declared `const isKhmerEmpty = !localKhmerText?.trim();` at top of component body (line 258) alongside other status derivations (`isGenerating`, `isError`, etc.). Build and unit tests pass.

### 1. STEP 0 — Data Confirmation & Field Comparison Table (EP2 Segments #1 and #2)

| Field | Segment #1 (`id: 1`) | Segment #2 (`id: 2`) | Description / Analysis |
|---|---|---|---|
| `startSec` | `0.2` | `4.027` | Original slot start time from OCR/script |
| `endSec` | `4.027` | `4.83` | Original slot end time (3.827s slot) |
| `audioStartSec` | `0.2` | `4.027` | Render start position |
| `audioEndSec` | `4.027` | `4.83` | Old handler timing ended here (unexpanded slot end) |
| `audioDurationSec` | `3.83` | `0.80` | Nominal slot duration |
| `finalAudioDuration` | `4.63` | `4.63` | **Real generated TTS audio length (+0.80s OVER)** |
| **Canvas Right Edge** | **`4.83`s** (`max(slotEnd, start + dur)`) | **`8.657`s** (`max(slotEnd, start + dur)`) | Rendered on `TimelineTracksCanvas.jsx` per 5f6fb6b truthful fix |
| **Old `isInsideSeg` End** | **`4.027`s** (`audioEndSec`) | **`4.83`s** (`audioEndSec`) | Derived from `audioEndSec` in `useClipOperations.js` |
| **Playhead at `00:04.03`** | **Visibly INSIDE (4.03 < 4.83)** | Outside (before 4.077 seam) | **Handler saw playhead as OUTSIDE (4.03 > 3.977)** ➔ Disagreement! |

**Conclusion:** Canvas right edge (`4.83s`) and old handler timing (`4.027s`) differed by `0.803s`. When the user parked the playhead at `00:04.03` inside the visible clip, old `isInsideSeg` failed because `4.03 > 4.027 - 0.05` (`3.977s`), causing all split branches (a), (b), (c), and (d) to miss and no-op silently.

---

### 2. Implementation Summary

1. **STEP 1 — One Canonical Timing (`frontend/src/hooks/useClipOperations.js`)**:
   - Reused canonical `getSegmentAudioDuration` from `../utils/timestampUtils`.
   - Updated `getSegTiming` to calculate:
     ```javascript
     effectiveEnd = isTrimmed && typeof s.audioEndSec === 'number'
       ? s.audioEndSec
       : Math.max(slotEnd, effectiveStart + getSegmentAudioDuration(s, 0), s.audioEndSec || 0)
     ```
     This matches `TimelineTracksCanvas.jsx` exactly.
   - Used `effectiveStart` and `effectiveEnd` in `isInsideSeg` and in `executeSplitSegment` math (`dur1`, `dur2`, `audioOffset`, and text splitting ratio).
   - Ensured split segments (`seg1` and `seg2`) persist `audioDurationSec`, `finalAudioDuration`, `audioDuration`, `originalAudioDuration`, `rawAudioDur`, and `audioTrimmed: true` so the canvas immediately renders them with exact boundaries and no spurious overflow.

2. **STEP 2 — No Silent No-Op (In-App Toast & Console Diagnostic)**:
   - When `handleSplitClip` is invoked and no branch matches (no voice segment, no video clip at playhead):
     - Displays brief in-app toast in Khmer: `"គ្មាន clip នៅត្រង់ playhead ទេ — ដាក់ playhead ឲ្យនៅកណ្ដាល clip"`.
     - Calculates nearest previous segment and nearest next segment boundaries and logs full diagnostic info via `console.warn`.

3. **STEP 3 — Seam Tolerance for Explicitly Selected Segment**:
   - In branch (a), relaxed the end boundary guard to `roundedSplit < effectiveEnd` (dropped the `-0.05` margin), enabling users who selected a clip to split anywhere visibly inside it up to the right seam.
   - Preserved `±0.05s` safety margin (`roundedSplit < effectiveEnd - 0.05`) in fallback branch (c) for unselected intersecting segments.

---

### 3. Verification & Evidence

- **New Automated Unit Suite (`backend/tests/split_canonical_timing_ep2.test.js`)**:
  - `node --test backend/tests/split_canonical_timing_ep2.test.js` ➔ **3 passed, 0 failed**:
    1. Real EP2 data dump & canonical effective timing verification (`canvasRightEdge1 === 4.83`).
    2. `useClipOperations` static code audit for canonical imports, Khmer toast string, and relaxed branch (a) seam guard.
    3. Simulated split of EP2 Segment #1 at `00:04.03`: cuts Segment #1 into `[0.2, 4.03]` and `[4.03, 4.83]` while keeping video clips completely untouched; verified Undo snapshot restoration; verified gap rejection.
- **Existing Split Suite**:
  - `node --test backend/tests/split_clip_selection_priority.test.js` ➔ **3 passed, 0 failed**.
- **Full Backend Test Suite**:
  - `node --test backend/tests/*.test.js` ➔ **76 tests: 75 passed, 1 skipped (test video not present), 0 failed** (12.1s).
- **Frontend Production Build**:
  - `npm --prefix frontend run build` ➔ **PASS in 861ms** (0 errors).

---

### 4. Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

---

### 5. Next Steps
- Open Studio UI on EP2 at `http://localhost:5173`.
- Select voice clip #1, position playhead at `00:04.03`, and click Split (or press Ctrl+B): observe instant clean cut into two speech segments without affecting video track.
