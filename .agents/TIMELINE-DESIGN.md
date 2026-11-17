# Timeline Core Redesign — TIMELINE-DESIGN.md

## Goal
Replace the patch-on-patch timeline editing layer with ONE clean architecture:
- ONE pure-function operations module (`timelineOps.js`)
- ONE store path: hooks call ops → update state → persist
- NO hidden coupling between tracks

## Data Model

### VideoClip
```js
{
  id: string,            // unique, stable across ops
  start: number,         // timeline placement start (seconds)
  end: number,           // timeline placement end (seconds)
  sourceStart: number,   // source media in-point
  sourceEnd: number,     // source media out-point
  name: string,          // display label
  trackRow: number,      // 0-based lane
  trackId: string,       // "video-1", "video-2"
  isDialogue: boolean,   // true = dialogue clip, false = Gap/Outro
  isMuted: boolean,
  segmentId?: number|string,
  segmentIndex?: number,
  hasVoice?: boolean,
}
```

### Segment (Voice/Subtitle)
```js
{
  _uid: string,          // globally unique, survives re-index
  id: number,            // 1-based display index
  segmentId: number,     // alias for id
  startSec: number,
  endSec: number,
  audioStartSec: number,
  audioEndSec: number,
  sourceStartSec: number,
  sourceEndSec: number,
  audioDurationSec: number,
  trackRow: number,      // voice lane (0 = VOICE 1)
  trackId: string,       // "voice-1"
  subTrackRow: number,   // subtitle lane
  subTrackId: string,    // "subs-1"
  userShifted: boolean,
  audioOverrun: boolean,
  // ... text fields, audio fields unchanged
}
```

### TimelineState
```js
{
  videoClips: VideoClip[],  // sorted by start
  segments: Segment[],      // sorted by startSec
}
```

## Op Signatures — `timelineOps.js`

Every op is a **pure function**: `(state, args) => { state, applied, reason? }`

```js
// R1 — Delete segment (voice/subtitle)
deleteSegment(state, { segKey }) =>
  { state: { videoClips: same, segments: filtered }, applied: true }
  // Invariants: videoClips deep-equal before/after; survivor ids/times unchanged

// R2 — Delete dialogue video clip → Gap merge
deleteVideoClip(state, { clipId, totalDuration }) =>
  { state: { videoClips: withGapMerge, segments: same }, applied: true }
  // Invariants: segments deep-equal; range becomes ONE merged Gap; [0, duration] continuous

// R3 — Delete Gap (film ripple)
deleteGap(state, { clipId }) =>
  { state: { videoClips: shifted, segments: same }, applied: true }
  // Invariants: segments deep-equal; later clips shift left by gap duration

// R4 — Split clip at playhead
splitClip(state, { splitTime, activeClipId, totalDuration }) =>
  { state: { videoClips: withSplit, segments: same }, applied: true }
  // Also: splitSegment(state, { segKey, splitTime }) for explicit segment split

// R5 — Auto-Align (move-only)
autoAlign(state, { totalDuration, options }) =>
  { state: { videoClips: same, segments: aligned }, applied: true }
  // Hard guard: segments.length in == out; aborts if mismatch

// trimClip, moveClip — same pure signatures
trimClip(state, { clipId, edge, newTime, maxSourceDuration }) => ...
moveClip(state, { clipId, newStart }) => ...
```

### Return Shape
```js
type OpResult = {
  state: TimelineState,     // The full new state
  applied: boolean,         // true if the op did something
  reason?: string,          // If !applied, why (shown as toast)
}
```

## Persistence / Tombstones / Undo

### Persistence
Every successful op triggers immediate persistence:
1. `saveTimelineOperationToLocalStorage(...)` — sync, tombstone-aware
2. `persistTimelineOperationApi(...)` — async backend

### Tombstones
Existing mechanism kept: when a segment/clip is deleted, its `_uid` is recorded
in a deletion log. Stale autosaves or hydration that try to restore a tombstoned
`_uid` are silently rejected. This prevents the "deleted voice comes back" bug.

### Undo/Redo
- `pushUndoSnapshot(videoClips, segments)` before every op
- `handleUndo/handleRedo` restores the exact snapshot (both tracks)
- One op = one undo step (R8)

## Playback Mapping (Monotonic)

The current `handleTimeUpdate` in `useVideoPlayback.js` can jump backward when
overlapping source ranges exist. Fix:

```
Invariant: while playing, the mapped timeline time `tlTime` never decreases.
```

Implementation:
- Track `lastMappedTlTime` in a ref
- After computing `tlTime = cStart + offset`, clamp: `tlTime = Math.max(lastMappedTlTime, tlTime)`
- Clip lookup starts from `activeClipIdxRef.current` and advances forward only

## Duration Display (R7)

```
Displayed duration = max(videoClip.end for all clips after edits)
```

NOT the raw source file length. Already partially implemented in `totalDuration`
memo inside `TimelineEditor.jsx`, but must be the SOLE source for the toolbar
timecode.

## File-by-File Replacement Plan

### Phase 1: Create `timelineOps.js` + Tests
**New file:** `frontend/src/utils/timelineOps.js`
- Imports: only `timestampUtils` (parseTimeToSeconds, formatMinSec, etc.)
- NO React, NO refs, NO API calls
- Pure functions: `deleteSegment`, `deleteVideoClip`, `deleteGap`, `splitClip`,
  `splitSegment`, `trimClip`, `moveClip`, `autoAlign`, `resetTiming`
- Each with the `(state, args) => OpResult` signature

**New file:** `frontend/src/utils/__tests__/timelineOps.test.js`
- R1: delete segment → videoClips unchanged, survivors keep ids/times
- R2: delete dialogue clip → gap merge, segments unchanged
- R3: delete gap → shift left, segments unchanged  
- R4: split → both video and segment variants
- R5: autoAlign → count guard, move-only

### Phase 2: Rewire `useClipOperations.js`
- Every handler calls `timelineOps.xxx()` instead of inline mutations
- Delete the duplicated logic from `timelineUtils.js` mutation functions
- Keep `timelineUtils.js` read-only helpers (normalize, map, resolve, etc.)

### Phase 3: Fix Playback Mapping
- In `useVideoPlayback.js`, add monotonic guard to `handleTimeUpdate`
- Track `lastMappedTlTime` ref, enforce non-decreasing during playback
- Reset on seek (user explicit seek resets the monotonic floor)

### Phase 4: Duration Display
- `TimelineEditor.jsx` `totalDuration` memo already computes `clipsMax`
- Ensure toolbar timecode uses ONLY this computed value
- Verify no other code path falls back to raw `duration` prop for display

## Acceptance Matrix

| Rule | Test | Real-App Check |
|------|------|----------------|
| R1 | deleteSegment: survivors deep-equal, videoClips identical | Delete 2 voices → file count -2, video clips identical |
| R2 | deleteVideoClip: gap merge, segments identical | Delete middle video clip → one joined Gap |
| R3 | deleteGap: shift left by exact duration | Delete opening Gap → film starts 00:00, duration shrinks |
| R4 | splitClip: two clips, fresh episode virtual | Split mid-video → two clips, save+reload persist |
| R5 | autoAlign: count guard, move-only | Auto-Align → file unchanged; added voice stays |
| R6 | Selection routing via selectedClipKind | (existing, verify not regressed) |
| R7 | Duration = end of last video clip | Header duration shrinks after Gap delete |
| R8 | Undo restores exact prior state | Ctrl+Z after each op → exact prior state |

## Migration Safety

The new `timelineOps.js` will be built ALONGSIDE the existing code. The switch
happens only when ALL tests pass. During migration:
- `timelineUtils.js` mutation functions are NOT deleted until rewiring is complete
- Components continue using the old path until the new one is verified
- The import switch is a single-commit atomic change
