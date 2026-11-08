# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Removed all silent episode-split defaults & strictly explicit user-driven splitting)
- **Timestamp**: 2026-11-08T14:45:00+07:00

## Latest Update: Explicit Episode Splitting & Zero Silent Defaults

### 1. Problem & Architecture Violation Addressed
- Previously, uploading a video or opening split tools would auto-assume silent fallback defaults:
  1. `MediaUploadTab.jsx`: `splitMinutes` initialized to 20, fallback `targetMins = customMinutes || splitMinutes || 20`, sending `durationMinutes: Number(targetMins) || 20`.
  2. `EpisodesTab.jsx`: `splitMinutes` initialized to 20, sending `durationMinutes: Number(splitMinutes) || 8` (inconsistent fallback).
  3. `backend/routes/videoRoutes.js`: fallback `durationMinutes || 1`, silent split-in-half branch if `target >= totalDuration`, and `replaceEpisodes` defaulting to `true` (overwriting existing episodes).
  4. `backend/services/ffmpegService.js`: default parameter `targetDurationSec = 480` (8 minutes).

### 2. Required Behavior & Fixes Implemented
- **Default State**: By default there is NOTHING — an uploaded video is exactly ONE episode unless the user explicitly chooses to split it.
- **Both Split UIs (`MediaUploadTab.jsx` and `EpisodesTab.jsx`)**:
  - `splitValue` initialized to `''` (empty string).
  - Dual Mode support: Split by Minutes (នាទី/ភាគ) or Split by Episode Count (ចំនួនភាគសរុប).
  - Split button is strictly disabled (`disabled={!isValidSplit || isSplitting}`) until user enters a valid value > 0 (or >= 2 for episode count).
  - Estimated-episode preview box ONLY appears when a valid value > 0 is typed, computed directly from the REAL duration of the video.
  - Preset chips (`[5, 10, 15, 20, 30]` min or `[2, 3, 5, 10]` eps) only fill the input visibly upon active click (no auto-apply).
  - `replaceEpisodes` defaults to `false`. Explicit checkbox provided: unchecked appends new chunks to existing episodes; checked replaces.
  - Removed hardcoded 20-minute action button from `MediaUploadTab` long-video banner.
- **Frontend API Service (`api.js`)**:
  - `splitVideoEpisodesApi` forwards `replaceEpisodes: Boolean(replaceEpisodes)` and eliminates any fallback numbers.
- **Backend API (`backend/routes/videoRoutes.js`)**:
  - `POST /api/split-video-episodes` strictly validates that user chose either `episodeCount >= 2` or positive duration.
  - If neither is provided, rejects with status `400` and message `"user must choose episode count or minutes"`.
  - Deleted the silent `durationMinutes || 1` fallback and deleted the silent split-in-half branch.
  - `replaceEpisodes` defaults to `false`: `currentSeries.episodes = shouldReplace ? builtEpisodes : [...existing, ...builtEpisodes]`.
- **Backend Service (`backend/services/ffmpegService.js`)**:
  - `splitVideoIntoEpisodes`: removed `targetDurationSec = 480` default parameter and added strict assertion throwing if `<= 0`.

### 3. Verification Evidence
1. **Unit & Integration Suite**:
   - `node --test backend/tests/*.test.js` ➔ **48/48 PASS** (0 failures, 1 skipped).
   - Created dedicated test suite `backend/tests/episode_split_defaults.test.js` validating static audits, missing parameter rejection, 400 responses, and service error assertions.
2. **End-to-End Split Flow Verification**:
   - Initial uploaded video (no split) ➔ exactly 1 episode.
   - Split request with empty body `{}` ➔ returns 400.
   - Split request with `{ videoId }` but no duration/count ➔ returns 400 ("user must choose episode count or minutes").
   - Split 3 episodes with `replaceEpisodes: false` ➔ exactly 3 episodes from real duration appended (1 old + 3 new = 4 episodes).
   - Re-run split 2 episodes without replace ➔ old episodes intact (4 old + 2 new = 6 episodes).
   - Re-run split 2 episodes with `replaceEpisodes: true` ➔ existing episodes replaced (exactly 2 episodes).
3. **Frontend Production Build**:
   - `npm --prefix frontend run build` ➔ **PASS** (1.35s, 0 errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- Ready for full production dubbing and episode management in Studio.
