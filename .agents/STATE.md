# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (`chore/remove-ppocr-local`)
- **Branch**: `chore/remove-ppocr-local` (tracking `origin/chore/remove-ppocr-local`)
- **Timestamp**: 2026-11-16T13:52:00+07:00

## Summary: Timeline Selective Voice Clip Muting (kelang ot voice baj bit slg te)
1. **Selective Clip Muting Based on Actual Voice Audio (`timelineUtils.js` & `useClipOperations.js`)**:
   - `autoSplitVideoBySegments` and `handleToggleMuteAllCuts` now check `hasVoiceAudio` (presence of `audioFile`, `audioPath`, `audioUrl`, or `audioDurationSec > 0`).
   - Only video cuts that ACTUALLY have voice audio generated get `isMuted: true` (bit slg yy).
   - Video cuts that do NOT have voice audio (`kelang ot voice`) and `Gap` clips remain `isMuted: false` (berk slg simple) so ambient drama audio is never silenced!

2. **Decoupled Track Header Mute from Cut Mutes (`TimelineTrackHeaders.jsx` & `TimelineTracksCanvas.jsx`)**:
   - Removed `areAllCutsMuted` triggering track-level mute. The `VIDEO 1` track header and lane will no longer falsely show full-track red `🔇` or dim the whole lane when dialogue cuts are muted.

3. **Speaking Intervals Strict Audio Guard (`VideoPlayerPreview.jsx`)**:
   - `speakingIntervals` now requires actual audio (`hasAudio`), preventing un-voiced segments from falsely ducking or muting the video audio.

4. **Verification**:
   - Created & updated unit test: `backend/tests/timeline_voice_cut_mute_gap_simple.test.js` (PASSED).
   - Frontend build (`npm run build --prefix frontend`): Passed in 3.71s.
   - All tests: 15 passed / 0 failed.

## Summary: Gemini Quota Modal De-Slop (/agents-design) & False 401 Quota Ban Fix
1. **Frontend UI De-Slop & Polish (`GeminiQuotaModal.jsx`)**:
   - **Symmetrical 3x2 Grid**: Upgraded key cards layout from ragged `repeat(auto-fit, minmax(205px, 1fr))` (which previously orphaned Key #6 alone on row 2) to a balanced `repeat(auto-fit, minmax(280px, 1fr))` making exactly 3 columns x 2 rows on desktop.
   - **Prominent Reset Time Badge**: Added clear highlight badge in Today section: `⏰ Reset ម៉ោង 3:00 PM (សល់ Xh Ym)` so the user clearly sees when Google's Pacific Midnight quota window resets.
   - **Progress & Usage Polish**: Added mini progress bars inside each key card showing real-time utilization (`todayRequests / perKeyDailyLimit`), tabular numbers (`fontVariantNumeric: 'tabular-nums'`), and clean subdued borders (`border-slate-800`), eliminating excessive neon box-shadows per `/agents-design` guidelines.
   - **Accurate Key Status**: Keys hitting the daily 500 RPD cap now show `🔴 អស់ Quota ថ្ងៃនេះ (429)` instead of a false `❌ 401 Key ខុស`.

2. **Stage 3 OCR Auto-Model Cascade Optimization**:
   - **Root Cause of Long Stalls**: When a primary model (e.g. `gemini-3.5-flash-lite`) was 429 exhausted, Stage 3 still forced it to run first on EVERY batch (up to 48 batches per chunk), looping through all 6 keys twice with backoff delays, wasting ~45s per batch (total ~35 minutes).
   - **Fix Applied**:
     - `callGeminiVisionWithRetry`: Prioritizes across ALL models (including preferred) with `geminiQuotaTracker.prioritizeAvailableModels` so exhausted models are immediately demoted to the end, and healthy cascade models (e.g. `gemini-3.1-flash-lite`) run first at 0ms delay.
     - `activeWorkingModel`: Dynamically remembers the winning cascade model across batches, skipping dead models for all subsequent batches.
     - `geminiKeyManager.js`: Reduced 429 key rotation retry from 2 full passes to 1 pass and trimmed rotation delay from 600ms to 200ms.

3. **Verification**:
   - Frontend build (`npm run build --prefix frontend`): Passed in 590ms.
   - Backend test suite (`gemini_key_pool_and_504_retry.test.js` & `gemini_quota_tracker_and_routes.test.js`): 13 passed / 0 failed.
   - Fast OCR rule test (`fast_ocr_rule.test.js`): Passed.

## Active Environment
- Backend API: `http://localhost:5000` (live daemon)
- Frontend UI: `http://localhost:5173` (Vite dev server)
- Branch: `chore/remove-ppocr-local`

## Next Steps
- Pushed commits to `origin/chore/remove-ppocr-local`.
- When ready, merge `chore/remove-ppocr-local` via Pull Request.
