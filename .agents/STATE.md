# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Discrepancy Cleanup & Sync Push)
- **Timestamp**: 2026-11-07T20:08:00+07:00

## Summary of Completed Work
1. **Dead Code Cleanup (Discrepancy Resolution — Commit `153e947`)**:
   - **Deleted Unused Assets**: Removed leftover scaffold assets [`frontend/src/assets/hero.png`](file:///e:/khmer_ai_dubbing_studio/frontend/src/assets/hero.png), [`frontend/src/assets/react.svg`](file:///e:/khmer_ai_dubbing_studio/frontend/src/assets/react.svg), and [`frontend/src/assets/vite.svg`](file:///e:/khmer_ai_dubbing_studio/frontend/src/assets/vite.svg).
   - **Deleted Dead Timeline Functions**: Removed 3 unused exported functions in [`frontend/src/utils/timelineUtils.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/timelineUtils.js) (0 callers across repo): `pixelToTime`, `timeToPixel`, and `calculateTimelineGaps`.
   - **Verification**: `npm --prefix frontend run build` PASS (1.39s, 0 errors).
   - **Pushed to GitHub**: Pushed to `origin/main` (commit `153e947`).

2. **Performance Fix Step 3 (Frontend Only — Commit `673bca6`)**:
   - **Step 3A — Virtualize the Segment List ([`frontend/src/components/media/ScriptReviewTab.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/ScriptReviewTab.jsx))**:
     - **React Version & Library Compatibility**: React is `19.3.1`. Installed `@tanstack/react-virtual` (`^3.14.26`), which natively supports React 19 (`^16.8.0 || ... || ^19.0.0`). Zero peer dependency conflicts.
     - **Dynamic Height Virtualization**: Implemented `useVirtualizer` with `estimateSize: () => 140`, `overscan: 8`, `gap: 8`, and dynamic item measurement via `ref={rowVirtualizer.measureElement}` on each item wrapper.
     - **DOM Reduction**: In an episode with 383 segments:
       - *Before*: 383 mounted `CaptionItemCard` instances (~24 DOM nodes/card = ~9,192 DOM nodes in the list container).
       - *After*: Only visible cards + overscan are mounted (~15-25 cards = ~360-600 DOM nodes). Over **94% reduction** in DOM elements.
     - **Stability & Interactions Preserved**: Kept `CaptionItemCard` wrapped in `React.memo`, maintained `DebouncedScriptTextarea` (typing a character does NOT re-render the whole list), preserved card selection, playback preview, delivery type toggle, and delete actions. Removed `content-visibility: auto` from [`MediaLibrary.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/MediaLibrary.css) to eliminate height estimation jitter.
   - **Step 3B — Window Timeline Clips ([`frontend/src/components/timeline/TimelineTracksCanvas.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTracksCanvas.jsx))**:
     - **Visible Range Calculation**: Wire `scrollContainerRef={timelineBodyRef}` from [`TimelineEditor.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/TimelineEditor.jsx). Computed dynamic time window `[visibleStart - buffer, visibleEnd + buffer]` from `container.scrollLeft`, `container.clientWidth`, and `pps` with a generous 3s/15% buffer.
     - **Clips Windowing**: Filtered video clips, voice clips, and subtitle clips to render ONLY clips overlapping the visible time range (`clipEnd >= windowStart && clipStart <= windowEnd`), while always preserving actively dragged or selected items. Windowed ruler markers to eliminate hundreds of offscreen marker elements.
     - **DOM Reduction**: In an episode with 383 segments across video/voice/sub tracks:
       - *Before*: ~1,000+ clip DOM elements mounted simultaneously.
       - *After*: Only ~30-60 clip DOM elements mounted for the visible viewport.
     - **Timeline Geometry Preserved**: Track container width (`totalWidth`), scrollbar size, and clip absolute positioning (`left: startSec * pps`, `width: (endSec - startSec) * pps`) remain 100% intact. Scrolling and zooming feel identical. RAF hardware playhead transforms and 60fps playback remain unaffected.

2. **Verification & Quality Checks**:
   - Step 3A Build: `npm --prefix frontend run build` ➔ **PASS** (554ms, 0 errors).
   - Step 3B Build: `npm --prefix frontend run build` ➔ **PASS** (572ms, 0 errors).
   - Frontend Linter: `npm --prefix frontend run lint` (`oxlint`) ➔ **PASS** (0 errors).
   - Backend Pipeline Syntax Check: `node -e "require('./backend/services/pipeline')"` ➔ **PASS**.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, build passing)
- **Git Branch**: `main`

## Next Steps
- **Step 4 (Refactor)**: Split giant files (e.g. `GeminiRouteModal.jsx` 2,635 lines) + convert remaining backend `readFileSync`/`writeFileSync` hot paths to async `fs.promises`.
- **Fast OCR Implementation (Plan Approved by Nha)**:
  - Task checklist generated at [`.specify/tasks/fast-ocr.md`](file:///e:/khmer_ai_dubbing_studio/.specify/tasks/fast-ocr.md).
  - Execute Slice 1 through Slice 6 incrementally.
