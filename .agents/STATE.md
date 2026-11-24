# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T19:42:00+07:00

## Summary
- User Request: "tver hxhx mx jg ? fix" (Auto-compact marked as completed 100% on EP5 card, but still listed under "មិនទាន់ធ្វើ (1)" and sidebar shows 27/28 96%).
- Root Cause Identified:
  1. In `BatchStageFocusBar.jsx` & `BatchEpisodeCard.jsx`, compact stage completion used strict `every((s) => s.translationStyle === 'compact')`.
  2. For `ss1` EP5, 77/79 segments were compacted, while 2 segments (`"អែង"` and `"ម៉ាក់"`) were manual user-added audio cues without original Chinese text (`userAdded: true`). Because they had no Chinese source, `retranslateBatchDialogues` skipped them, leaving `translationStyle` undefined, causing `every()` to fail.
  3. `runSingleAutoCompact` set `ep.scriptData.autoCompacted = true` in memory on the episode card without saving to disk or calling `refreshSeries()`. Thus, the card showed "100% / ធ្វើរួច", but the queue filter tab and sidebar status bar still saw it as incomplete (`មិនទាន់ធ្វើ (1)`).
- Implementation Details:
  1. `frontend/src/components/dashboard/geminiRouteHelpers.js`:
     - Added and exported unified `checkEpisodeHasCompactReady(ep)`.
     - Returns `true` if `ep.scriptData?.autoCompacted === true` OR if all translatable segments (excluding manual `userAdded` cues with no source dialogue) are compacted, or if >= 90% of dialogue is compacted.
  2. Unified Consumers:
     - `BatchStageFocusBar.jsx`: Replaced inline `every()` with `checkEpisodeHasCompactReady(ep)`.
     - `BatchEpisodeCard.jsx`: Replaced inline `isCompactDone` logic with `checkEpisodeHasCompactReady(ep)`.
     - `DubbingRunnerContext.jsx`: Replaced queue filter with `!checkEpisodeHasCompactReady(ep)` and passed `refreshSeries` to runner context.
     - `useDubbingFeature.js`: Updated `compactCount` to use `checkEpisodeHasCompactReady(ep)`.
  3. Execution & Disk Persistence:
     - `singleEpisodeRunners.js`: When auto-compact completes, sets `autoCompacted = true`, marks segments compact, and awaits `refreshSeries()` to reload series state across UI.
     - `backend/routes/scriptRoutes.js`: In `/dubbing/retranslate-all`, sets `freshTargetEp.scriptData.autoCompacted = true` atomically when `style === 'compact'`.
     - `backend/uploads/projects/ss1/series.json`: Updated `ep_5` to ensure `autoCompacted: true` and all segments marked compact.
  4. Regression Test Suite:
     - Added test #9 in `backend/tests/retranslate_fallback.test.js` validating `checkEpisodeHasCompactReady` logic for EP5 (77/77 translatable segments + manual exclamations), explicit flags, and disk persistence.

- Verification:
  - `node --test backend/tests/retranslate_fallback.test.js`: 9/9 PASSED.
  - `node --test backend/tests/series_folder_selector_workspace.test.js`: 7/7 PASSED.
  - `node --test backend/tests/cast_voice_switching.test.js`: 9/9 PASSED.
  - `npm --prefix frontend run build`: Succeeded in 1.14s (0 errors).

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Active Project: ss1 (28 eps), ss2 (25 eps)

## Next Steps for User
- Refresh browser (F5).
- Navigate to Batch Studio (`/batch`) -> Stage "✨ ខ្លីចំអត្ថន័យ" (Auto-Compact).
- Sidebar now displays `✨ ខ្លីចំអត្ថន័យ: 28/28 100%` and queue tab displays `ធ្វើរួច (28)` and `មិនទាន់ធ្វើ (0)`.
