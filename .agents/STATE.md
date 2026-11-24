# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T21:05:00+07:00

## Summary
- User Request: "mx yy A tv S vinh?" -> User chose option 2 to implement auto-phonetic normalization in backend so "កម្រិត A" automatically speaks as "កម្រិត អា" without confusing "S" (អេស) or requiring manual edits.
- Root Cause Identified:
  - In Edge TTS (`km-KH-PisethNeural` and `km-KH-SreymomNeural`), single Latin uppercase letter `A` is pronounced using English phoneme `/eɪ/` ("អេ").
  - In Khmer speech context (e.g. `កម្រិត A`), `/eɪ/` spoken quickly sounds confusingly like `S` ("អេស"). Cambodians expect `កម្រិត អា` (Rank A) vs `កម្រិត អេស` (Rank S).
- Implementation Details:
  1. `backend/services/ttsService.js`:
     - Added `normalizePhoneticsForTts(text)` inside `cleanTextForTts()`:
       - Normalizes Rank/Level patterns (e.g. `កម្រិត A`, `ថ្នាក់ A`, `លំដាប់ A`, `Rank A`, `Level A`, `Class A`) to `កម្រិត អា`.
       - Normalizes standalone uppercase `A` in Khmer sentences to `អា`.
       - Preserves full English words intact (e.g. `Apple`, `Admin`, `AI`, `Auto`, `Attack`, `DNA`).
       - Preserves other rank letters (`កម្រិត S`, `កម្រិត B`, `កម្រិត C`, `កម្រិត D`).
       - The displayed subtitle text remains clean `កម្រិត A` while the generated audio speaks `កម្រិត អា`.
  2. `backend/uploads/projects/ss1/series.json`:
     - Regenerated EP2 Segment 73 with Piseth Neural using the new phonetic normalization. Verified with Gemini ASR that it articulates `កាំបិត ជា ឧបករណ៍ កម្រិត A` with distinct "អា" pronunciation.
  3. `backend/tests/phonetic_normalization.test.js`:
     - Automated test suite verifying rank pattern replacements, word boundaries, and real Edge TTS audio synthesis.
- Verification & Benchmarks:
  - All 23 tests PASSED:
    - `backend/tests/phonetic_normalization.test.js` (4/4)
    - `backend/tests/single_clip_voice_switching.test.js` (3/3)
    - `backend/tests/cast_voice_switching.test.js` (9/9)
    - `backend/tests/series_folder_selector_workspace.test.js` (7/7)
  - Frontend Vite build: PASSED in 1.13s (0 errors).

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- Active Project: ss1 (28 eps), ss2 (25 eps)

## Next Steps for User
- Refresh browser (F5) in Studio at `localhost:5173`.
- Play Clip #73 in EP2:
  - Audio now speaks "កាំបិតជាឧបករណ៍កម្រិត អា" យ៉ាងច្បាស់ ដោយមិនច្រឡំជាមួយ S (អេស) ឡើយ។
  - Subtitle នៅតែបង្ហាញ "កម្រិត A" ស្អាតដដែល។
