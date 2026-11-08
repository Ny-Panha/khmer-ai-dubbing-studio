# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Playback Auto-Follow Speaking Segment & Catch-Up on Edit Blur)
- **Timestamp**: 2026-11-08T18:32:00+07:00

## Latest Update: Playback Auto-Follow Speaking Segment & Catch-Up on Edit Blur

### 1. Problem & Root Cause
- **Playback Freeze**: In `frontend/src/components/TimelineEditor.jsx` (~L388-427), the auto-follow playhead line effect synced timeline selection and Inspector to the segment under the playhead, with comments stating it should work "both during playback and when paused". However, the early-return guard included `isPlaying` (`if (!scriptSegments || ... || isPlaying) return;`).
- **Consequence**: During video playback, as the playhead crossed between segments, player overlay subtitles updated, but the timeline highlight and the Inspector remained frozen on the old clip until playback was paused.

### 2. Implementation Modifications
1. **`frontend/src/components/TimelineEditor.jsx`**:
   - **Removal of `isPlaying` Guard**: Removed `isPlaying` from the early-return check. Preserved all other safety guards (`dragState`, `isScrubbing`, `isScrubbingRef.current`, and `isEditingText`).
   - **Manual Override Stability (`lastPlayheadSegKeyRef`)**:
     - Auto-follow only triggers when the playhead crosses into a *new* segment (`String(segKey) !== String(lastPlayheadSegKeyRef.current)`).
     - If the user clicks a different clip during playback, the selection holds for the remainder of that segment and only resumes following when the playhead advances into the next segment (no frame-by-frame re-yanking).
   - **Editing Protection & Blur Catch-Up**:
     - `isEditingInspectorText`: Detects active focus in `INPUT` / `TEXTAREA` inside `.top-suite-col-right`, `.inspector-card-group`, or `.clip-inspector-panel`.
     - When user is typing, `followSyncSkippedDueToEditingRef.current` is set to `true`, and auto-follow is skipped to prevent yanking the Inspector away mid-keystroke.
     - `focusout` Event Listener: On input blur, after a 50ms active element settle check, if `followSyncSkippedDueToEditingRef` is true, it immediately resolves the segment at `currentTimeRef.current` and syncs timeline selection and Inspector, even while paused.
     - Manual timeline clicks clear `followSyncSkippedDueToEditingRef` so deliberate clip selections are never overwritten by the blur listener.
   - **Viewport Auto-Follow Audit (~L1188)**:
     - Verified that `updatePlayheadAndScroll` already executes during playback inside `useEffect` guarded by `if (!isPlaying) return;` using `requestAnimationFrame`. When `screenX > rightThreshold` (85% viewport width), it smoothly pages forward. No changes needed.
2. **`backend/routes/audioRoutes.js`**:
   - Added validation guard on `/generate-audio` single segment regeneration to reject empty Khmer text with HTTP 400 and descriptive warning rather than failing silently.
3. **`backend/tests/timeline_playback_autofollow.test.js`**:
   - Static architecture audit: verifies `isPlaying` is removed from auto-follow guard, `isEditingText` and scrubbing guards are preserved, focusout listener is registered, and `lastPlayheadSegKeyRef` is tracked.
   - State machine simulation: verifies playback segment progression, typing protection, blur catch-up, manual click override holding until next segment, and silence gap handling.

### 3. Verification & Evidence
- **New Unit Suite**: `node --test backend/tests/timeline_playback_autofollow.test.js` ➔ **2 passed, 0 failed**.
- **Full Backend Suite**: `node --test backend/tests/*.test.js` ➔ **67 tests: 66 passed, 1 skipped, 0 failed** (25.6s).
- **Frontend Production Build**: `npm --prefix frontend run build` ➔ **PASS in 1.19s** (0 errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- End-to-end user test in browser: play an episode, watch inspector and highlights follow speaking segments, test editing in inspector while playing.
