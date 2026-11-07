# Tasks: Fast OCR Pipeline Implementation (Spec-Kit SDD)

> **Feature**: Fast OCR Pipeline Mode (`fast_ocr`)  
> **Status**: Ready for Implementation (Plan Approved)  
> **Plan Document**: [`.specify/plans/fast-ocr-pipeline-revision.md`](file:///e:/khmer_ai_dubbing_studio/.specify/plans/fast-ocr-pipeline-revision.md)  

---

## Task Checklist & Slices

### Slice 1: Backend Stage 3 OCR Hardening
- [ ] **Task 1.1**: Update `stage3_extractChineseSubtitles.js` to ensure Gemini Vision prompt returns `speakerGender` (`male`/`female`/`unknown`) and `genderConfidence` (0.0–1.0).
- [ ] **Task 1.2**: Implement observation voting aggregation (`genderVotes: { male, female, unknown }`) and explicit fallback voice rule:
  - `female` -> `km-KH-SreymomNeural`
  - `male` / `unknown` -> `km-KH-PisethNeural` (`reviewNeeded: false` so TTS is never blocked).
- [ ] **Task 1.3**: Add consecutive deduplication pass ($\ge 75\%$ Dice similarity, $\le 1.0\text{s}$ gap), enforce minimum duration 0.8s, and guarantee zero overlaps (`startSec >= prev.endSec`).
- *Verification*: Run unit test with adjacent duplicate frames and assert merged output + non-blocking unknown gender.

### Slice 2: Chunk Boundary Deduplication
- [ ] **Task 2.1**: Update `stitchAndDeduplicateSegments` in `chunkOrchestrator.js` to merge overlapping boundary segments across chunk margins ($\le 2.5\text{s}$ window, matching Chinese text).
- [ ] **Task 2.2**: Ensure strictly monotonic timecodes and sequential segment IDs (`1..N`).
- *Verification*: Run synthetic two-chunk boundary stitch test.

### Slice 3: Pipeline Orchestration, Job State & Safety
- [ ] **Task 3.1**: In `dubbingPipeline.js`, ensure `mode === GENERATION_MODES.FAST_OCR` is the single source of truth, bypass Stages 4 & 5, and mark `stages.analyzeDialogueAudio = 'skipped'` and `stages.reconcileTimelineEvidence = 'skipped'`.
- [ ] **Task 3.2**: In `jobRoutes.js` and `productionJobQueue.js`, persist `generationMode: 'fast_ocr'` on the episode and job records at run start so it survives reloads.
- [ ] **Task 3.3**: Enforce re-translate safety: create timestamped backups in `uploads/projects/{seriesId}/episodes/{episodeId}/backups/`, restrict overwrite to selected episode IDs, and mark audio clips as `audioOutdated: true` if text/timing changed.
- *Verification*: Verify job record on disk contains `generationMode: 'fast_ocr'` and stage states are `'skipped'`.

### Slice 4: Subtitle Parser & Import Endpoint
- [ ] **Task 4.1**: Enhance `backend/utils/subtitleParser.js` to handle `00:00:01,000 -->` SRT format, report malformed block warnings without aborting, enforce 5MB limit, and validate JSON schema.
- [ ] **Task 4.2**: Add subtitle import route in backend (`POST /api/scripts/import-subtitles`) to ingest `.srt`/`.json` directly into episode `scriptData`.
- *Verification*: Test SRT parsing on valid, malformed, and edge-case timestamp inputs.

### Slice 5: Frontend UI Studio Integration
- [ ] **Task 5.1**: Add drag-and-drop / file browser dropzone in `GeminiRouteModal.jsx` for `.srt` and `.json` with target episode selector and validation alert display.
- [ ] **Task 5.2**: Add interactive confirmation modal before dispatching `force: true` re-translation on existing scripts.
- [ ] **Task 5.3**: Wire `⚡ Fast OCR` badge to read directly from `ep.generationMode || ep.scriptData?.generationMode`.
- *Verification*: Verify UI in browser (`http://localhost:5173`), check file drag-and-drop, test modal confirmation, and verify badge persistence.

### Slice 6: Empirical Verification Protocol (5 Steps)
- [ ] **Task 6.1**: Step A — Run real episode in Fast Mode; verify Stage 4 & 5 are marked `'skipped'` in logs.
- [ ] **Task 6.2**: Step B — Run same episode in Mode A; output comparative diff table (segments, first/last timecodes).
- [ ] **Task 6.3**: Step C — Non-regression test for Mode A and Mode B.
- [ ] **Task 6.4**: Step D — End-to-end UI SRT import test.
- [ ] **Task 6.5**: Step E — Report measured wall-clock execution time (Fast Mode vs Mode A).

