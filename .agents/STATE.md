# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Timeline Audio Strict No-Overlap Clamp & Edge Snapping)
- **Timestamp**: 2026-11-08T19:44:00+07:00

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
