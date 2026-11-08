# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Fix Recurring "Backend Down" 502 / Offline Notification & One-Command Dev Startup)
- **Timestamp**: 2026-11-08T12:30:00+07:00

## Summary of Completed Work

### 1. Step 1 Diagnosis Report (Crash vs Never Started)
- **Diagnosis Verdict**: Both **never started** (forgotten due to missing root script) and **watch restart collision (`EADDRINUSE`)**.
- **Root Cause Analysis**:
  1. **Root package script omitted**: Previously, the repository lacked a root-level `package.json`. Developers or agents starting only the frontend with `npm --prefix frontend run dev` left the backend unstarted. When Vite's proxy (`frontend/vite.config.js`) attempted to proxy `/api/sync-audio` or `/api/series/:id/sync` to `http://127.0.0.1:5000`, it caught `ECONNREFUSED` and returned HTTP 502:
     `{"success":false,"error":"Backend server is temporarily unreachable (ECONNREFUSED). Please verify backend is running on port 5000."}`
  2. **Node `--watch` Socket Release Lag**: When running `npm --prefix backend run dev` (`node --watch-path=... server.js`), file edits triggered Node watch restarts. Because `backend/server.js` lacked graceful termination and retry handling, Windows socket release delays resulted in:
     ```
     [CRITICAL] Uncaught Exception: Error: listen EADDRINUSE: address already in use 0.0.0.0:5000
         at Server.setupListenHandle [as _listen2] (node:net:2390:16)
         at listenInCluster (node:net:2499:12)
     ```
     leaving the backend in `Completed running 'server.js'. Waiting for file changes before restarting...` without listening on port 5000.
  3. **Fix in `backend/server.js`**: Added socket retry mechanism (5 retries with 500ms backoff on `EADDRINUSE`) and graceful `SIGINT`/`SIGTERM` process shutdown.

### 2. Step 2: One-Command Startup
- Created root [`package.json`](file:///e:/khmer_ai_dubbing_studio/package.json) with `concurrently`:
  - `"dev"`: `concurrently -n "BACKEND,FRONTEND" -c "blue,green" "npm --prefix backend run dev" "npm --prefix frontend run dev"`
  - `"start"`: `concurrently -n "BACKEND,FRONTEND" -c "blue,green" "npm --prefix backend start" "npm --prefix frontend run dev"`
  - `"dev:backend"`: `npm --prefix backend run dev`
  - `"dev:frontend"`: `npm --prefix frontend run dev`
  - `"build"`: `npm --prefix frontend run build`
  - `"test"`: `npm --prefix backend test`
- Running `npm run dev` now starts both Backend (port 5000) and Frontend (port 5173) together with unified, color-coded logging.

### 3. Step 3: Visible Failure Banner / Toast in UI
- **Event-Driven Offline Notification**:
  - In [`frontend/src/services/api.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/services/api.js): Added `notifyBackendOffline()` and `notifyBackendOnline()` custom DOM event emitters. `parseResponseJson` and `syncTimelineAudioApi` dispatch `backend-offline` on 502 or network failure, and `backend-online` on 200 OK.
  - In [`frontend/src/utils/projectStorage.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js): Created `syncSeriesToBackend(series)` helper replacing individual fetch calls, dispatching offline/online events for series state synchronization.
  - In [`frontend/src/hooks/useClipOperations.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useClipOperations.js): Integrated offline/online notifications into `handleAutoAlignNoOverlap`, `handleResetToSourceTiming`, `handleSplitClip`, `executeSync`, `handleToggleMuteSegment`, and `handleAutoSplitSegment`.
  - In [`frontend/src/hooks/useProjectPersistence.js`](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useProjectPersistence.js): Listens to `backend-offline` and `backend-online`. Instantly updates `isBackendOnline` (driving Navbar chip) and `backendOfflineBanner`.
  - In [`frontend/src/App.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx): Renders dismissible top warning banner:
    `"Backend offline — ការផ្លាស់ប្ដូររក្សាទុកតែក្នុងម៉ាស៊ីននេះសិន (changes saved locally only)"` with an `✕` dismiss button.
  - In [`frontend/src/index.css`](file:///e:/khmer_ai_dubbing_studio/frontend/src/index.css): Added `.backend-offline-banner` amber warning styling and smooth transition animation.
- **Resilience**: The Auto-Align and Reset Timing operations continue running locally without interruption; only user-facing feedback is updated.

### 4. Verification Evidence
1. **With Backend Stopped**:
   - Clicked "Auto-Align" in browser:
     - Header status chip immediately showed `Backend Offline` in red.
     - Dismissible warning banner appeared at top-center: `"Backend offline — ការផ្លាស់ប្ដូររក្សាទុកតែក្នុងម៉ាស៊ីននេះសិន (changes saved locally only)"`.
     - Console: Zero unhandled red errors (only the expected warning notice).
     - Timeline: Clips remained cleanly aligned locally.
     - Dismiss button (`✕`): Clicking dismiss hid the banner.
     - Evidence screenshot: [`backend_offline_banner.png`](file:///C:/Users/nhastar/.gemini/antigravity/brain/6ac10be3-1a63-456e-8d37-a5ad1ac624ae/backend_offline_banner.png).
2. **With Backend Started via Single Command (`npm run dev`)**:
   - Clicked "Auto-Align":
     - `/api/sync-audio` returned HTTP `200 OK`.
     - Header status chip showed `FFmpeg Online` in green.
     - Backend offline banner automatically cleared.
     - Evidence screenshot: [`backend_online_sync.png`](file:///C:/Users/nhastar/.gemini/antigravity/brain/6ac10be3-1a63-456e-8d37-a5ad1ac624ae/backend_online_sync.png).
3. **Build & Tests**:
   - `npm --prefix frontend run build` ➔ **PASS** (1.41s, 0 errors).
   - `node --test backend/tests/auto_align_voice.test.js` ➔ **3/3 PASS** (0.15s).

## Active Environment
- **Startup Command**: `npm run dev` (Starts BOTH Backend on port 5000 and Frontend on port 5173 with `concurrently`)
- **Backend API**: `http://localhost:5000` (Node.js/Express, online)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite, online)
- **Git Branch**: `main`

## Next Steps
- Await Nha's review and approval.
