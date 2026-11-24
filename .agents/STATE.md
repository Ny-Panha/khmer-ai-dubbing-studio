# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-25T00:31:00+07:00

## Summary
- Khmer SRT Import & Dubbing Workflow (Zero-Gemini API Key):
  1. Subtitle Parser Language Detection & Modes (`backend/utils/subtitleParser.js`):
     - Added `isKhmerText` via Unicode regex `[\u1780-\u17FF]`.
     - Supports `importMode`: `'auto'` (default), `'khmer_direct'`, `'chinese_translate'`, `'import_only'`.
     - For Khmer SRT or detected Khmer text: populates `khmerTranslatedText: text`, `khmerText: text`, `khmer: text`, `translationStatus: 'translated'`, `status: 'translated'`.
  2. OCR Deduplication & Equality Fix (`backend/services/pipeline/stages/stage3VisionBatchRunner.js`):
     - In `areChineseTextsEquivalent`: restricted 75% bag-of-characters matching strictly to CJK Han characters (`/[\u4e00-\u9fa5]/`), preventing different Khmer sentences from falsely colliding due to shared vowels/consonants.
     - Preserves `khmerTranslatedText`, `status: 'translated'`, and `translationStatus: 'translated'` during fast deduplication.
  3. Zero-Gemini Subtitle Import Route (`backend/routes/scriptRoutes.js`):
     - In `/api/dubbing/import-subtitles`: detects Khmer cues and honors `importMode` / `skipTranslation`.
     - When `isKhmerDirect` is true: completely skips `retranslateBatchDialogues` -> **0 Gemini API calls**.
     - Sets `freshTargetEp.scriptData.source = 'imported_khmer_subtitles'` and `status = 'translated'`.
  4. Batch TTS Auto-Shorten Pass Bypass (`backend/routes/audioRoutes.js` & `frontend/src/services/api/audioApi.js`):
     - Added flags `disableAiAutoShorten: true`, `enableAiAutoShorten: false`, `isZeroGemini: true`, `autoShortenOverflow: false`.
     - Completely bypasses Gemini AI rewriting pass during Batch TTS; audio time-stretch is handled cleanly via FFmpeg `atempo`.
  5. Frontend UI Mode Selection & Feedback:
     - In `frontend/src/components/media/DubbingModeTab.jsx` and `BatchScriptSetupPanel.jsx` / `GeminiRouteModal.jsx`:
       - Added Subtitle Import Mode selector:
         - `⚡ ស្វ័យប្រវត្តិ (Auto-Detect)`
         - `🇰🇭 Khmer SRT (0 Gemini API · បកប្រែរួច)`
         - `🇨🇳 Chinese SRT (Gemini AI · បកប្រែចិន ➜ ខ្មែរ)`
         - `📁 Import Only (មិនបកប្រែ)`
       - Dynamic button label and clear success banner indicating `⚡ 0 Gemini API · រួចរាល់សម្រាប់ Edge TTS`.
  6. Verification:
     - Created `backend/tests/khmer_srt_zero_gemini.test.js` (8/8 tests PASSED).
     - Regression tests `speed_control_instant.test.js`, `stage3_hybrid_ocr.test.js`, `subtitle_sync_and_zero_overlap_fixes.test.js` (34/34 tests PASSED).
     - Frontend production build succeeded (`npm run build` in 2.03s).

## Active Environment
- Backend Server: http://localhost:5000 (running)
- Frontend Dev: http://localhost:5173 (running)
- TTS Engine: Microsoft Edge Neural (km-KH-PisethNeural & km-KH-SreymomNeural)

## Next Steps for User
- Refresh browser (F5) on `http://localhost:5173`.
- In Dubbing Mode Tab or Batch Script Setup:
  - Choose `🇰🇭 Khmer SRT (0 Gemini API · បកប្រែរួច)` or `⚡ ស្វ័យប្រវត្តិ (Auto-Detect)`.
  - Click `Import Khmer .srt (0 API)` to upload pre-translated Khmer subtitles.
  - Subtitles will import instantly with 0 Gemini API calls, ready immediately for Edge TTS.
