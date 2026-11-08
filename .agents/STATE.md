# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (GeminiKeyPool 401 Disabling & 504 Deadline Exceeded Resilience)
- **Timestamp**: 2026-11-08T17:49:00+07:00

## Latest Update: Gemini Key Pool Dead Key Disabling (401/403) & 504 Timeout Resilience

### 1. Problem & Root Cause
- **Dead Key Cycling**: `GeminiKeyPool` treated 401/403 auth errors as temporary quota errors, continually cycling back to dead keys (#1 and #2) and wasting rotation attempts while valid keys were in 429 cooldowns.
- **Untruthful Status**: UI displayed all keys as "Ready" (including dead keys) because key status defaulted to standby on fetch errors and did not track runtime invalidation.
- **504 Timeouts**: `callGeminiVisionWithRetry` in Stage 3 only checked for 429/503. On 504 `DEADLINE_EXCEEDED`, it immediately threw without retry or model cascade.
- **Corrupted Chunk Cache**: In `stage3_extractChineseSubtitles.js`, batch failures were caught and logged as warnings, dropping frames silently while the chunk was saved to disk cache and marked `completed`.

### 2. Implementation Modifications
1. **`backend/services/geminiKeyManager.js`**:
   - Separated `isAuthOrInvalidKeyError(err)` (401, 403, unauthenticated, invalid key) from `isQuotaOrRateLimitError(err)` (429, 503, quota, rate limit).
   - Added process-level `globalInvalidKeys` set and `markKeyInvalid(key, statusOrReason)`.
   - On 401/403, permanently disables key for process lifetime, removes it from active rotation, and logs:
     `[GeminiKeyPool] ❌ Key #N invalid (401) — removed from pool, M keys remaining`.
   - Never retries an invalid key. Fails fast with explicit error if all keys in pool become invalid.
   - Preserves 429 quota rotate + 600ms retry-after behavior.
2. **`backend/routes/systemRoutes.js`**:
   - `/health`: `activeKeysCount` strictly reflects valid non-invalid keys.
   - `/gemini/keys-status`: Instantly returns `status: "invalid"`, `badge: "401 Key ខុស"`, `isInvalid: true` for known invalid keys; marks keys invalid on 401/403 responses; calculates `activeCount` exclusively from non-invalid ready keys.
3. **`backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`**:
   - Added `isRetryableVisionError(err)` recognizing 429, 503, 504, `DEADLINE_EXCEEDED`, `GATEWAY TIMEOUT`, `ETIMEDOUT`, `TIMEOUT`.
   - `callGeminiVisionWithRetry` cascades across alternative models (`gemini-3.5-flash-lite` -> `gemini-2.5-flash` -> `gemini-3.5-flash`) on 504 timeouts with backoff.
   - In `executeVisionBatch`, unrecoverable batch failure throws an explicit error rather than silently swallowing it.
4. **`backend/services/pipeline/chunkOrchestrator.js`**:
   - Wrapped chunk execution in try/catch; unrecoverable Stage 3 failure marks chunk as failed, logs clear error line, and throws with chunk index/timestamp.
   - Completed prior chunks are safely preserved in disk cache (`chunk_<hash>.json`), so subsequent job re-runs automatically resume at the failed chunk.
5. **`backend/tests/gemini_key_pool_and_504_retry.test.js`**:
   - Unit tests covering 401 dead key elimination, log format assertion, fast failure on total pool death, 429 preservation, 504 cascade recovery, and unrecoverable cascade chunk failure.

### 3. Verification & Evidence
- **New Unit Suite**: `node --test backend/tests/gemini_key_pool_and_504_retry.test.js` ➔ **7 passed, 0 failed**.
- **Full Backend Suite**: `node --test backend/tests/*.test.js` ➔ **65 tests: 64 passed, 1 skipped, 0 failed**.
- **Frontend Build**: `npm --prefix frontend run build` ➔ **PASS in 968ms**.

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- Production verification with full episode dubbing jobs under API quota constraints.

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
