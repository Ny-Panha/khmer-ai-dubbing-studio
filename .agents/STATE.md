# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (Implemented Fast OCR Generation Mode & Subtitle Import)
- **Timestamp**: 2026-11-08T14:31:00+07:00

## Latest Update: Fast OCR Generation Mode & Subtitle Import (`fast_ocr`)

### 1. Architectural Map & Mode Plumbing
- **Generation Modes Supported**:
  - `standard` (Mode A/B): Full 10-stage pipeline (Stage 3 OCR ➔ Stage 4 Diarization ASR ➔ Stage 5 Reconcile ➔ Translate ➔ TTS).
  - `fast_ocr`: Direct Stage 3 OCR ➔ Stage 6/7 Khmer Translation (1 cue = 1 segment, bypassing Stage 4 ASR & Stage 5 Reconcile).
- **Mode Persistence**:
  - Persisted in `targetEp.generationMode` and `targetEp.scriptData.generationMode` in `series.json`.
  - Episode badges rendered in `EpisodesTab` (⚡ Fast OCR vs 🎯 Standard).
  - Header badge and interactive 2-way toggle in `DubbingModeTab`.

### 2. Fast Path OCR Deduplication Engine
- **Engine Function**: `deduplicateFastOcrCues(rawCues, defaultGender)` exported in `stage3_extractChineseSubtitles.js`.
- **Chunk-Boundary Repeat Suppression**: Drops cues if previous kept cue has equivalent Chinese text (`areChineseTextsEquivalent`) and starts within 0.3s or overlaps.
- **Continuous Merging**: Continuous duplicate cues (gap <= 0.35s) merge into a single segment by extending `endSec`.
- **Distant Repetition Preservation**: Repeated dialogues across scene transitions (>0.35s) remain separate segments.

### 3. Speaker / Gender Attribution Without ASR
- Fast segments receive `speakerSource: 'ocr_only'`, `unverifiedSpeaker: true`, `genderConfidence: null`.
- Voice gender defaults to `narratorGender` / series default gender without random guesses.
- Visual warning chip (`speaker?`) added to segment headers in `ScriptReviewTab.jsx`.

### 4. External Subtitle Import Engine (.srt / .json)
- Endpoint: `POST /api/dubbing/import-subtitles`.
- Uses `backend/utils/subtitleParser.js` (`parseSrtContent`, `parseJsonContent`).
- Strict line-by-line validation: malformed blocks and invalid timecodes return detailed errors; 0 segments imported on corrupt files.
- Imported cues pass through `deduplicateFastOcrCues` and batch translation into Khmer.

### 5. Re-Translate Safety & Backup Refusal Guard
- Force re-translate requires explicit confirmation (`force: true`, `confirmed: true`).
- Pre-overwrite snapshot backups:
  1. `episodes/<episodeId>/backups/script_backup_<timestamp>.json`
  2. `series.json.backup_<timestamp>`
- Guard refuses with status `500` if backups fail to write to disk.

### 6. Verification Results
1. **Fast-generate verification**: Stage 4 & 5 skipped, final segment count == deduped OCR count, timings on cue boundaries.
2. **Standard-generate verification**: Backward-compatible with baseline pipeline.
3. **Subtitle Import verification**: Valid SRT imports cues; malformed SRT outputs line validation errors and imports 0.
4. **Re-Translate Safety verification**: Both `script_backup` and `series.json.backup` snapshot files created on force re-translate.
5. **Test Suite & Build**:
   - `node --test backend/tests/*.test.js` ➔ **45/45 PASS** (0 failures, 1 skipped).
   - `npm --prefix frontend run build` ➔ **PASS** (1.44s, 0 errors).

## Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

## Next Steps
- End-to-end interactive verification of Fast OCR generation in studio browser.
