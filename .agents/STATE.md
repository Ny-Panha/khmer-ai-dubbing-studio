# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Fix Auto-Align / Reset Timing Dying on Click — Cycle-Safe Snapshots)
- **Timestamp**: 2026-11-08T11:01:00+07:00

## Summary of Completed Work

### 1. Root Cause Analysis & Reproduction (Step 1)
- **Investigation & Finding**:
  - In `useClipOperations.js`, `handleAutoAlignNoOverlap` (~L378) and `handleResetToSourceTiming` (~L448) call `pushUndoSnapshot(videoClips, currentSegments)` first before executing.
  - In `useUndoRedo.js` (L17-28), snapshots were cloned using `JSON.parse(JSON.stringify(...))`. If any clip or segment object contained circular structures (such as React `MouseEvent` with `target: HTMLSpanElement` and React Fiber internals, as seen in commit `d1217f8`), it threw `TypeError: Converting circular structure to JSON`, crashing the entire handler before alignment or reset could execute.
  - Furthermore, in `App.jsx`, `useClipOperations` was being passed `pushUndoSnapshot: undoRedo.pushHistory` (which was `undefined` because `useUndoRedo` returns `pushUndoSnapshot`), rendering snapshots a no-op and breaking undo after alignment.

### 2. Cycle-Safe Snapshots Helper (Step 2)
- Added `safeClone(value)` in [`frontend/src/hooks/useUndoRedo.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useUndoRedo.js):
  - Uses `JSON.stringify` with a replacer tracking seen objects via `WeakSet`.
  - Replaces circular repeats with `undefined` (which JSON drops from objects) and drops functions/undefined.
  - For acyclic data, snapshots are 100% structurally identical to normal JSON cloning.
  - Applied `safeClone` at all 6 stringify sites in `useUndoRedo.js`:
    1. push `videoClips` (L47)
    2. push `segments` (L48)
    3. undo `videoClips` (L64)
    4. undo `segments` (L65)
    5. redo `videoClips` (L93)
    6. redo `segments` (L94)
  - Also added `pushHistory: pushUndoSnapshot` alias to `useUndoRedo` return object for backwards compatibility.

### 3. Belt & Braces Try/Catch Protection (Step 3)
- In [`frontend/src/hooks/useClipOperations.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useClipOperations.js):
  - Wrapped `pushUndoSnapshot` call in `handleAutoAlignNoOverlap` in `try / catch (err)` that logs a warning and allows alignment to proceed uninterrupted.
  - Wrapped `pushUndoSnapshot` call in `handleResetToSourceTiming` in `try / catch (err)` that logs a warning and allows timing reset to proceed uninterrupted.
  - Wrapped internal `pushUndoSnapshot` callback in `useClipOperations.js` with `try / catch` so no caller can crash from undo snapshot dispatching.

### 4. Source Disconnect & Event Bleed Fixes (Step 4)
- [`frontend/src/App.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx):
  - Corrected props passed to `useClipOperations` and `useAudioDubbing`: `pushUndoSnapshot: undoRedo.pushUndoSnapshot` and `pushHistory: undoRedo.pushUndoSnapshot`.
- [`frontend/src/components/timeline/TimelineToolbar.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineToolbar.jsx):
  - Wrapped `onClick` for both Auto-Align and Reset Timing buttons in zero-arg arrow functions (`() => onAutoAlignNoOverlap && onAutoAlignNoOverlap()`) so React `MouseEvent` (`e`) is never forwarded into timeline clip/segment handlers.

### 5. Verification & Visual Evidence
- **Build**: `npm --prefix frontend run build` ➔ **PASS** (1.71s, 0 errors).
- **Playwright Full Suite on EP1 (60+ voice files)**:
  - **Auto-Align**: Visibly re-lays voice clips, `canUndo` becomes `true`, clicking Undo restores pre-click state cleanly.
  - **Reset Timing**: Restores source timing, `canUndo` becomes `true`, clicking Undo restores pre-click state cleanly.
  - **Delete & Undo**: Selecting voice segment and deleting removes clip, `canUndo` becomes `true`, clicking Undo restores deleted segment.
  - **Console**: Verified **0 console errors** (completely clean).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express, online)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, online)
- **Git Branch**: `main`

## Next Steps
- Await Nha's review and approval.
