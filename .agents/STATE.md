# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Graceful Empty-Text Voice Guard & Split Clip Selection Priority)
- **Timestamp**: 2026-11-08T18:41:00+07:00

## Latest Update: Voice-Generate Refuses Empty-Text Segments Gracefully & Split Clip Priority

### 1. Problem & Context
- **Empty-Text Crash/Raw Error**: In `fast_ocr` mode (and manual workflows), segments can legitimately have empty Khmer text (e.g. stage 6 flags them `reviewNeeded`). Previously, sending them to `POST /api/generate-audio` caused `ttsService` to throw `"អត្ថបទសម្រាប់បង្កើតសំឡេងទទេ (Empty text)!"` as an unhandled HTTP 500 error, presenting a raw failure to the user.
- **Split Clip Ambiguity**: Split shortcut (Ctrl+B) and Split button could pick the wrong clip when both video and voice clips were present or selected.

### 2. Implementation Modifications

1. **`frontend/src/hooks/useAudioDubbing.js`**:
   - `handleRegenerateSingleSegment`:
     - Computes `textToUse` first. If empty after trimming, blocks the API call.
     - Displays Khmer in-app alert: `"Segment #N គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន"`.
     - Calls `setSelectedSegmentId` and auto-focuses `#inspector-khmer-textarea` in the Inspector so the user is directed straight to the edit field.
   - Batch Generation (`handleGenerateAudio`):
     - Filters out empty-text segments into `validSegments`.
     - Tracks `skippedEmptyCount` and skips empty segments gracefully.
     - Reports the skipped count in `audioStage` (e.g. `✅ បង្កើតសំឡេង AI ជោគជ័យ 501 ឃ្លា (រំលង 1 ឃ្លាដែលខ្វះអត្ថបទ)!`).
     - Safely merges updated audio segments back into the complete segment array using `updatedMap`.

2. **`frontend/src/components/voice/ClipInspectorPanel.jsx`**:
   - Added `id="inspector-khmer-textarea"` to the Khmer textarea for deterministic programmatic focus.
   - Disabled the Regenerate button when `localKhmerText` is empty, with tooltip `"មិនអាចបង្កើតសំឡេងបានទេ — គ្មានអត្ថបទខ្មែរ (Missing text)"` and `opacity: 0.45, cursor: not-allowed`. Typing immediately re-enables it.

3. **`frontend/src/components/media/ScriptReviewTab.jsx`**:
   - Card Indicators: Added red left border (`3px solid #ef4444`) and red badge `<AlertCircle /> ខ្វះអត្ថបទ` when Khmer text is empty, and amber badge `<AlertTriangle /> Review` for other review-needed lines.
   - Disabled per-segment Regenerate button on cards when text is empty with clear tooltip.
   - Added Filter Chips above the list: `"ទាំងអស់"` (All) and `"ខ្វះអត្ថបទ"` (Missing text) with real-time count badges, allowing instant filtering across 500+ segments.
   - Updated `rowVirtualizer` and index mapping so that even when filtered, `effectiveIdx` targets the exact underlying segment in `scriptData.segments`.

4. **`backend/routes/audioRoutes.js`**:
   - Single segment regeneration route checks `textToSpeak`. If empty, returns HTTP 400 with Khmer error message (`"Segment #N គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន"`).
   - In the route `catch` block, catches any `"Empty text"` or `"ទទេ"` error and returns HTTP 400 instead of 500.

5. **Split Clip Selection Priority (`TimelineEditor.jsx`, `useClipOperations.js`, `timelineUtils.js`)**:
   - Explicitly prioritizes splitting based on `lastSelectedType === 'video'` vs voice segment.
   - Aligns segment matching predicate with `isSegmentMatch` and `findSegmentIndex`.

### 3. Verification & Evidence
- **New Unit Suite (`empty_text_guard.test.js`)**:
  - `node --test backend/tests/empty_text_guard.test.js` ➔ **2 passed, 0 failed** (verifies static frontend/backend guards, HTTP 400 response with Khmer message, and real project EP2 segment #5 data).
- **Split Clip Unit Suite (`split_clip_selection_priority.test.js`)**:
  - `node --test backend/tests/split_clip_selection_priority.test.js` ➔ **3 passed, 0 failed**.
- **Full Backend Suite**:
  - `node --test backend/tests/*.test.js` ➔ **72 tests: 71 passed, 1 skipped (test video not present), 0 failed** (51.3s).
- **Frontend Production Build**:
  - `npm --prefix frontend run build` ➔ **PASS in 2.32s** (0 errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- Verify in browser on EP2 (502 segments) that segment #5 is flagged with red badge "ខ្វះអត្ថបទ" and filtering to "ខ្វះអត្ថបទ" isolates it cleanly.
