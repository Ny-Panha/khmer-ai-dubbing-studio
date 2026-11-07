# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Re-TTS Button Execution & forceRegen Fix)
- **Timestamp**: 2026-11-07T18:19:00+07:00

## Summary of Completed Work
1. **Re-TTS Execution & Cache Bypass Fix (Option A)**:
   - **Root Cause**: Backend `/api/generate-audio` had a fast-path cache skip (`if (!forceRegen && fs.existsSync(fullAudioPath))`) returning instantly (`alreadyCompleted: true`) because `forceRegen` was never forwarded from frontend. In addition, the button passed browser click events directly into `handleGenerateAudio`.
   - **Files Fixed**:
     - [`frontend/src/services/api.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js): Added `forceRegen: isObject && params.forceRegen !== undefined ? Boolean(params.forceRegen) : false` to `generateAudioApi` payload.
     - [`frontend/src/hooks/useAudioDubbing.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useAudioDubbing.js): Sanitized `overrideParams` against browser SyntheticEvents, calculated `forceRegen` defaulting to `true` when re-synthesizing existing audio, and passed `forceRegen` to `generateAudioApi`.
     - [`frontend/src/components/media/DubbingModeTab.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx): Updated button `onClick` to pass `{ forceRegen: Boolean(hasExistingAudio) }`, swapped icon to `RefreshCw` when existing audio is ready to clearly convey regeneration.
2. **STEP 1 — Memoize Heavy Panels + Stabilize Props from App.jsx**:
   - Wrapped [`TimelineEditor.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/TimelineEditor.jsx), [`VideoPlayerPreview.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx), and [`ScriptReviewTab.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/ScriptReviewTab.jsx) in `React.memo`.
   - Stabilized all props and handlers from [`App.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx).
3. **STEP 2 — Single Jobs Poller Only**:
   - Created [`JobQueueContext.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/context/JobQueueContext.jsx) as single source of truth for background jobs (`useJobQueue`).
   - Deleted duplicate `setInterval(fetchJobsListApi, 1500)` pollers in `GeminiRouteTab.jsx` and `GeminiRouteModal.jsx`.
4. **Verification & Testing**:
   - `npm --prefix frontend run build`: **PASS** (1.46s, 0 errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5174` (React 18 + Vite, build passing)
- **Git Branch**: `main`

## Next Steps
- **Step 3**: Virtualize segment list (`ScriptReviewTab.jsx`) and timeline track windowing for massive DOM node reduction (from 19,000 nodes to < 500 nodes).
