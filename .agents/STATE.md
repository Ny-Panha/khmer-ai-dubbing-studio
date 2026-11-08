# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Empty-Text Leaks Fully Closed + One-Click Translate Remedy)
- **Timestamp**: 2026-11-08T19:30:00+07:00

## Latest Update: Close All Empty-Text Voice Generation Leaks & One-Click Translate Remedy

### 1. STEP 0 — Five-Path Verdict Table (EP2 Segment #5 Test Case)

| # | Voice Generation Path / Entry Point | Pre-Fix Behavior | Post-Fix Verdict |
|---|-------------------------------------|------------------|-------------------|
| 1 | **Segment-card Regenerate** (`ScriptReviewTab.jsx`) | Disabled button in UI | **GRACEFUL KHMER MESSAGE**: Disabled with tooltip; in-app Khmer toast if invoked; plus new One-Click `"បកប្រែឃ្លានេះ"` action |
| 2 | **Inspector Generate** (`ClipInspectorPanel.jsx`) | Leaked raw error banner `បរាជ័យ: Empty text!` + retry button | **GRACEFUL KHMER MESSAGE + ONE-CLICK REMEDY**: Shows amber alert with `"បកប្រែឃ្លានេះ"`; bottom button replaced with `"បកប្រែឃ្លានេះ"`; Generate re-enabled upon translation |
| 3 | **Voice Studio Re-TTS (whole episode)** (`useAudioDubbing.js`) | Hook filtered empty segs, but summary message lacked Khmer format | **SKIPPED-WITH-COUNT**: Gracefully skips empty lines and reports `✅ បង្កើតសំឡេង AI ជោគជ័យ N ឃ្លា (រំលង M ឃ្លា គ្មានអត្ថបទ)!` |
| 4 | **DubbingModeTab Batch Voice** (`useAudioDubbing.js`) | Hook filtered empty segs, but summary message lacked Khmer format | **SKIPPED-WITH-COUNT**: Gracefully skips empty lines and reports `✅ បង្កើតសំឡេង AI ជោគជ័យ N ឃ្លា (រំលង M ឃ្លា គ្មានអត្ថបទ)!` |
| 5 | **Batch & Keys Console STEP 3** (`GeminiRouteModal.jsx` & `/api/generate-audio`) | Sent all segments directly to backend batch route; backend threw 500 or omitted skipped count | **SKIPPED-WITH-COUNT**: Backend skips empty lines, marks `ttsStatus: "empty_text"`, returns `skippedEmptyCount` and `summaryMessage`, modal logs `(រំលង M ឃ្លា គ្មានអត្ថបទ)` without throwing |

---

### 2. STEP 1 — Uniform Rule Implementation
1. **Backend Batch Route (`backend/routes/audioRoutes.js`)**:
   - `hasAnyText` guard: if an entire batch has no text, returns HTTP 200 with `skippedEmptyCount = segments.length` and `summaryMessage: "រំលង N ឃ្លា (គ្មានអត្ថបទ)"` without failing.
   - Fast path & main execution: Maps empty segments to `ttsStatus: "empty_text", audioGenerated: false, audioOutdated: true`.
   - Never fails an entire batch job due to empty segments. Returns `skippedEmptyCount`, `validCount`, and `summaryMessage`.
   - Safe merge with `series.json`: Updates existing segments by ID/index to prevent dropped segments.

2. **Core TTS Service (`backend/services/ttsService.js`)**:
   - In `generateBatchSegmentsAudio`: Uses `cleanTextForTts(text)`. If empty, sets `ttsStatus: "empty_text"` directly and advances without calling speech synthesis.
   - In catch block: Catches any `"Empty text"` or `"ទទេ"` error, logs a clean Khmer warning (`⚠️ រំលងឃ្លា #N (គ្មានអត្ថបទខ្មែរ)`), sets `ttsStatus: "empty_text"`, and does not fail the batch.

3. **Pipeline Stage 9 (`stage9_generateSegmentTTS.js`)**:
   - Checks `cleanTextForTts` on each segment before calling TTS.
   - If empty, marks `seg.ttsStatus = 'empty_text'`, increments `skippedEmptyCount`, and records it in `ttsReport`.

4. **Frontend API Client (`frontend/src/services/api.js`)**:
   - Added client-side guard in `generateSingleSegmentAudio`: If Khmer text is empty, throws a clean 400 error (`"Segment #N គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន"`) before making the network request.

5. **Batch & Keys Modal (`frontend/src/components/dashboard/GeminiRouteModal.jsx`)**:
   - Computes `emptySegsCount` and displays `(រំលង N ឃ្លា គ្មានអត្ថបទ)` in progress logs.
   - Reads backend response `skippedEmptyCount` and updates the completion message accordingly.

---

### 3. STEP 2 — One-Click Remedy ("បកប្រែឃ្លានេះ" / "Translate This Line")
1. **`frontend/src/hooks/useAudioDubbing.js`**:
   - Added `handleTranslateSingleSegment`: Calls `retranslateSegmentApi`, sanitizes Khmer text with `cleanKhmerText`, updates segment in `scriptData`, clears `reviewNeeded`, and persists to `series.json`.
2. **`frontend/src/components/media/ScriptReviewTab.jsx`**:
   - Caption cards with empty Khmer text show a primary button: `"បកប្រែឃ្លានេះ"` with `<Sparkles />`.
   - Clicking it triggers single-segment translation immediately; upon completion, Khmer text populates and the normal Generate Voice button activates.
3. **`frontend/src/components/voice/ClipInspectorPanel.jsx`**:
   - When Khmer text is empty:
     - Replaces error banner with a remedy banner containing `"បកប្រែឃ្លានេះ"`.
     - Replaces the disabled bottom Regenerate button with a prominent `"បកប្រែឃ្លានេះ"` button.
     - As soon as text is populated, normal Generate/Regenerate voice controls are re-enabled.

---

### 4. Verification Evidence
- **Backend Tests**: `node --test backend/tests/*.test.js` ➔ **73 tests: 72 passed, 1 skipped, 0 failed** (11.9s).
- **Unit Guard Suite**: `node --test backend/tests/empty_text_guard.test.js` ➔ **3 passed, 0 failed**.
- **Split Canonical Timing Suite**: `node --test backend/tests/split_canonical_timing_ep2.test.js` ➔ **3 passed, 0 failed**.
- **Frontend Production Build**: `npm --prefix frontend run build` ➔ **PASS in 947ms** (0 errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`
