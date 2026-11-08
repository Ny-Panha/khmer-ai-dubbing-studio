# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Episode Split Source Replacement & Safe Re-Indexing)
- **Timestamp**: 2026-11-08T17:08:00+07:00

## Latest Update: Split Replaces Source Episode & Safe Sequential Re-Indexing

### 1. Problem & Root Cause
- **Problem**: Previously, uploading a full-length video (e.g. 03:29:16) created `ep_1`. Running Auto-Split in default mode (`replaceEpisodes = false`) appended chunks after `existing`, turning 11 chunks into `ep_2..ep_12` alongside `ep_1` (total 12 episodes) instead of replacing `ep_1` with the 11 chunks.
- **Specification**:
  - The episode whose video IS the split input is the split's SOURCE — its chunks always take its place at its index, regardless of `replaceEpisodes`.
  - `replaceEpisodes = false` governs only the OTHER existing episodes (`keptBefore` and `keptAfter` preserved).
  - `replaceEpisodes = true` replaces all episodes with chunks.
  - Zero disk deletion of source video: the original source video stays on disk where upload stored it; only metadata record is replaced.
  - Chunk IDs avoid ID and folder collisions with kept episodes; display numbering `episodeNumber` follows final array order 1..N with generic title healing.
  - Success message and response report final episode count of the series (`សរុបក្នុងរឿងមាន N ភាគ`).

### 2. Implementation Modifications
1. **`backend/routes/videoRoutes.js`**:
   - Added `findSourceEpisodeIndex(existingEpisodes, rawVideoRef, inputVideoPath, targetEpisodeId)` matching canonical filesystem paths via `path.resolve` & `resolveMediaFile`, normalized video relative paths/URLs, and explicit `episodeId`.
   - Partitioned existing episodes into `keptBefore` and `keptAfter` around `sourceIndex` when `sourceEpisodeFound && !shouldReplace`.
   - Guaranteed chunk episode IDs (`epId`) do not collide with any kept episode IDs (`occupiedIds`).
   - Guarded chunk video destination paths against overwriting `inputVideoPath` on disk.
   - Inserted chunks at the source episode's former index: `finalEpisodes = [...keptBefore, ...builtEpisodes, ...keptAfter]`.
   - Renumbered sequential display numbering `episodeNumber` (1..N) and healed auto-generated generic titles.
   - Success response reports `totalEpisodes: currentSeries.episodes.length` and Khmer message `សរុបក្នុងរឿងមាន ${totalSeriesCount} ភាគ`.
   - Exported `router.findSourceEpisodeIndex = findSourceEpisodeIndex`.
2. **`frontend/src/services/api.js`**:
   - Updated `splitVideoEpisodesApi` to accept and transmit `episodeId` in the JSON request body.
3. **`frontend/src/components/media/MediaUploadTab.jsx` & `frontend/src/components/media/EpisodesTab.jsx`**:
   - Passed `episodeId: activeEpisode?.id || selectedVideo?.episodeId` to `splitVideoEpisodesApi`.
   - Alert messages display final total episode count directly to user.
4. **`backend/tests/episode_split_source_replace.test.js`**:
   - Unit test for `findSourceEpisodeIndex` matching by canonical path, videoId, and episodeId.
   - **Scenario 1 Verification**: 1 long video in fresh series split into 11 chunks $\to$ series has EXACTLY 11 episodes, EP1 is the first chunk, no episode has full-video duration, source video file on disk preserved, all 11 chunks valid.
   - **Scenario 2 Verification**: 3 real episodes (`ep_1`, `ep_2`, `ep_3`), split `ep_2` with append mode $\to$ `ep_2` replaced at position 2, `ep_1` and `ep_3` video files on disk are 100% byte-identical, no ID collision, total 5 episodes.

### 3. Verification & Evidence
- **Backend Tests**: `node --test backend/tests/*.test.js` ➔ **58 tests: 57 passed, 1 skipped, 0 failed**.
- **Frontend Build**: `npm --prefix frontend run build` ➔ **PASS in 982ms**.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- Production verification with multi-hour uploaded drama series.
