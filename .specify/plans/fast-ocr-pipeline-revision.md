# Technical Plan: Fast OCR Pipeline Architecture & Revision (Spec-Kit SDD)

> **Feature**: Fast OCR Pipeline Mode (`fast_ocr`)  
> **Status**: Approved & Revised Architecture Plan  
> **Target System**: Khmer AI Dubbing Studio (`DragonDub AI`)  
> **Core Objective**: Accelerate video dubbing by bypassing CPU/GPU-heavy Audio Diarization (Stage 4) and Reconciliation (Stage 5), extracting high-accuracy Chinese dialogue directly via Gemini Vision OCR, deduplicating segments, maintaining series glossary translation quality, and supporting external SRT/JSON subtitles.

---

## 1. Executive Summary & Design Vision

The **Fast OCR Pipeline Mode** (`mode: 'fast_ocr'`) provides a high-speed ingestion and translation path (3–5x faster execution) for drama episodes with burned-in Chinese subtitles. By utilizing Gemini Vision OCR directly on candidate video frames, the studio eliminates the need for heavyweight Whisper/SenseVoice audio transcription (Stage 4) and complex multi-pass timeline reconciliation (Stage 5), while guaranteeing that all segments undergo the **exact same series glossary-grounded Khmer translation** (`translateAndValidateKhmer`) and synthesis pipeline.

---

## 2. Core Architecture & Architectural Invariants

### 2.1 The Single Source of Truth (`ONE TRIGGER`)
- **Single Source of Truth**: `mode === GENERATION_MODES.FAST_OCR` (`'fast_ocr'`).
- **Elimination of Conflicting Flags**: Any legacy or auxiliary flags such as `options.fastOcrOnly` are strictly prohibited and removed. The `mode` parameter in the API request body, job state, and pipeline execution is the sole determinant of pipeline execution logic.
- **No Shortcut Translator**: Fast OCR bypasses **only** Stage 4 (Audio Diarization) and Stage 5 (Reconciliation). It feeds visual segments directly into:
  - **Stage 6**: `generateModeSpecificScript` (enforcing character persona, cultural context, and tone).
  - **Stage 7**: `translateAndValidateKhmer` (applying `seriesGlossary`, forbidden terms filters, and translation validation).
  
```text
Standard Mode A / B:
[Stage 1 Ingest] ─→ [Stage 2 Media Analysis] ─→ [Stage 3 Vision OCR] ─→ [Stage 4 ASR Diarization] ─→ [Stage 5 Reconcile] ─→ [Stage 6 Script] ─→ [Stage 7 Khmer Glossary] ─→ [Stage 8 Timing] ─→ [Stage 9 TTS] ─→ [Stage 10 Export]

Fast OCR Mode:
[Stage 1 Ingest] ─→ [Stage 2 Media Analysis] ─→ [Stage 3 Vision OCR + Dedupe] ─┬──────────────────────────────────────────→ [Stage 6 Script] ─→ [Stage 7 Khmer Glossary] ─→ [Stage 8 Timing] ─→ [Stage 9 TTS] ─→ [Stage 10 Export]
                                                                               │
                                                                 [Stage 4: SKIPPED]
                                                                 [Stage 5: SKIPPED]
```

---

## 3. Detailed Technical Specifications (8 Pillars)

### Pillar 1: Speaker & Gender Extraction with Non-Blocking TTS Fallback
- **Problem**: In standard modes, Stage 4 (ASR & Diarization) provides speaker identification and vocal gender classification. Bypassing Stage 4 removes this audio source.
- **Gemini Vision OCR Multi-modal Extraction**:
  - In `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`, the Gemini Vision prompt requires frame-level visual gender estimation:
    - `speakerGender`: `"male" | "female" | "unknown"` (estimated from visible character cues, mouth movement, or subtitle context).
    - `genderConfidence`: Float between `0.0` and `1.0`.
- **Observation Voting & Aggregation**:
  - When continuous frames are grouped into a segment, aggregate observations into a `genderVotes` object: `{ male: N, female: N, unknown: N }`.
  - Resolve segment-level `speakerGender` and `genderConfidence` using majority vote.
- **Non-blocking TTS Fallback Voice Rule**:
  - **Female Resolution**: If resolved gender is `female` (with confidence > 0.5), assign `voiceGender = 'female'` and `khmerVoiceId = 'km-KH-SreymomNeural'`.
  - **Male / Unknown Resolution**: If resolved gender is `male` or `unknown`, assign `voiceGender = 'male'` and `khmerVoiceId = 'km-KH-PisethNeural'`.
  - **Unknown Voice Safety**: When `speakerGender` is `'UNKNOWN'`, it is explicitly assigned `voiceGender = 'male'` with `khmerVoiceId = 'km-KH-PisethNeural'`. It is marked with `reviewNeeded = false` so that **TTS generation is never blocked or rejected**.
  - **Inspector UI Editing**: In the Segment Inspector and Character Voices Panel (`CharacterVoicesPanel.jsx` / `VoiceSettings.jsx`), the gender dropdown remains fully interactive, allowing users to override `unknown` to `female` or another custom voice at any time before or after TTS generation.

---

### Pillar 2: Segment Deduplication & Boundary Merging
- **Stage 3 OCR Deduplication**:
  - Consecutive segment pass:
    - Text similarity check: `areChineseTextsEquivalent(segA, segB)` (identical text or normalized character Dice coefficient $\ge 0.75$).
    - Temporal adjacency check: `(seg[i].startSec - seg[i-1].endSec) <= 1.0s` or overlapping.
    - Merge action:
      ```javascript
      prev.endSec = Math.max(prev.endSec, curr.endSec);
      prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
      prev.originalChineseText = curr.originalChineseText.length > prev.originalChineseText.length 
        ? curr.originalChineseText 
        : prev.originalChineseText;
      ```
  - **Enforcement Rules**:
    - **Minimum Duration**: Every visual segment must satisfy `duration >= 0.8s` (`endSec = parseFloat((startSec + Math.max(0.8, duration)).toFixed(2))`).
    - **Zero Overlaps**: Ensure strict temporal monotonicity across all segments: `seg[i].startSec >= seg[i-1].endSec`. If any overlap exists, clamp `seg[i-1].endSec = seg[i].startSec`.
- **Chunk Boundary Deduplication (`chunkOrchestrator.js`)**:
  - At chunk stitch boundaries (where adjacent chunks overlap by 2.0s):
    - In `stitchAndDeduplicateSegments(allChunkSegments)`:
    - Identify boundary candidates where `Math.abs(seg.startSec - prev.startSec) < 2.5s || seg.startSec < prev.endSec + 0.6s` and `areChineseTextsEquivalent(seg.text, prev.text)`.
    - Fuse into single segment: `mergedStart = Math.min(prev.startSec, seg.startSec)`, `mergedEnd = Math.max(prev.endSec, seg.endSec)`.
    - Renumber sequential IDs (`1..N`) cleanly.

---

### Pillar 3: External SRT & JSON Subtitle Import (Full-Stack)
- **Frontend UI (`frontend/src/components/dashboard/GeminiRouteModal.jsx`)**:
  - Drag-and-drop / file browser dropzone accepting `.srt` and `.json` files.
  - Target episode selector dropdown: Allows assigning the imported subtitle directly to a specific episode in the series.
  - Client-side validation:
    - File size ceiling: Maximum **5MB** per file.
    - File extension check: `.srt` or `.json`.
    - Structured error & warning display: If lines are malformed, display a friendly alert with line numbers and parsed segment count preview.
- **Backend SRT Parser (`backend/utils/subtitleParser.js`)**:
  - Parse format: `00:00:01,000 --> 00:00:03,500` (supporting comma `,` and period `.`, `\r\n` and `\n`).
  - Strip formatting HTML tags (`<i>`, `<b>`, `<font>`).
  - Malformed line resilience: Skip or auto-correct malformed blocks without crashing; emit detailed warnings array in response payload.
  - Automatic timing correction: If `endSec <= startSec`, adjust `endSec = startSec + 1.5s`.
- **Expected JSON Subtitle Schema**:
  ```json
  {
    "segments": [
      {
        "startSec": 1.25,
        "endSec": 3.80,
        "chineseText": "我们今天必须完成这项工作",
        "speakerGender": "female",
        "speakerName": "តួអង្គស្រី"
      }
    ]
  }
  ```
  - Tolerant parser accepts synonyms: `startSec` / `startTime` / `start`, `endSec` / `endTime` / `end`, `chineseText` / `originalChineseText` / `text`.
  - Returns: `{ success: true, segments: CanonicalSegment[], warnings: string[], count: number }`.

---

### Pillar 4: Re-Translate Safety & Non-Destructive Invalidation
When initiating a translation run on an episode that already has translated script data:
- **(a) Interactive Confirmation Dialog**:
  - If `targetEp.scriptData?.segments?.length > 0` and the user triggers a re-run, prompt a modal confirmation:
    > "ភាគ [Episode Name] មាន Script បកប្រែរួចហើយ។ តើអ្នកពិតជាចង់ Re-translate ឡើងវិញមែនទេ?"
  - The request is dispatched only after user confirmation with `force: true`.
- **(b) Timestamped Script Backup**:
  - Before writing new script data to disk or memory, automatically create a backup file:
    `uploads/projects/{seriesId}/episodes/{episodeId}/backups/script_backup_{timestamp}.json`
  - Retain the latest 5 rolling backups; automatically prune older backups.
- **(c) Scope Limited to Selected Episodes Only**:
  - Re-translation jobs run exclusively on the target episodes selected in the modal. All unselected episodes in the series are strictly preserved.
- **TTS Clip Invalidation Rule**:
  - **If Chinese text or segment duration changes**: Existing audio clips for the altered segments are marked `audioOutdated: true` (or purged from disk/timeline) so that stale audio is never mixed into export.
  - **If text and timing are identical**: Preserve existing generated audio files and voice assignments, saving unnecessary TTS synthesis cost.

---

### Pillar 5: Persistent Generation Mode
- **Persistence Across Sessions & Reloads**:
  - When a job is initiated in Fast OCR mode:
    1. Set `ep.generationMode = 'fast_ocr'` on the episode record in `series.json`.
    2. Set `job.generationMode = 'fast_ocr'` and `job.mode = 'fast_ocr'` in `productionJobQueue`.
    3. Persist `generationMode: 'fast_ocr'` in `ep.scriptData.generationMode` upon pipeline completion.
- **UI State & Badging**:
  - The `⚡ Fast OCR` badge in `GeminiRouteModal.jsx`, `EpisodesTab.jsx`, and `ScriptReviewTab.jsx` directly evaluates `ep.generationMode || ep.scriptData?.generationMode`.
  - The badge persists across page refreshes, episode switching, and server restarts.

---

### Pillar 6: Unified Pipeline Trigger & Glossary Enforcement
- **Single Source of Truth**: `mode === GENERATION_MODES.FAST_OCR`.
- **Translation Quality Parity**:
  - The visual segments output from Stage 3 feed directly into `stage6_generateModeSpecificScript.js` and `stage7_translateAndValidateKhmer.js`.
  - Both stages strictly apply:
    - Full `seriesGlossary` (character names, titles, Kung Fu techniques, location terms).
    - Cultural Cambodian dubbing idioms and emotional naturalization.
    - Quality gates (forbidden word filter, sentence length balancing, anti-hallucination checks).
  - Fast OCR is a **speed optimization for extraction and synchronization**, NOT a downgraded translation.

---

### Pillar 7: Evidence-Based Empirical Verification Protocol
Replace theoretical estimates with a 5-step empirical verification suite:

1. **Step A: Fast OCR Mode Execution & Skip Verification**:
   - Run a real episode through Fast OCR mode.
   - Capture terminal/server logs verifying:
     - Stage 4 log: `[Pipeline] ⚡ Fast OCR Mode activated: Bypassing Stage 4 (ASR) & Stage 5 (Reconciliation)`
     - Job state inspection: `job.stages.analyzeDialogueAudio === 'skipped'` and `job.stages.reconcileTimelineEvidence === 'skipped'`.
2. **Step B: Head-to-Head Comparative Diff with Mode A**:
   - Run the exact same episode in Mode A (`dialogue`).
   - Compare and output a markdown diff table containing:
     - Total segment count (Fast OCR vs Mode A).
     - First segment start timecode.
     - Last segment end timecode.
     - Total subtitle coverage seconds.
3. **Step C: Mode A & Mode B Non-Regression Test**:
   - Execute standard Mode A and Mode B runs on benchmark media.
   - Confirm 100% completion through all 10 stages without any altered behavior or regression.
4. **Step D: External SRT UI Upload Verification**:
   - Upload a sample `.srt` file via the new UI dropzone in `GeminiRouteModal.jsx`.
   - Confirm end-to-end import: parsing, validation alert, script population, and timeline rendering.
5. **Step E: Wall-Clock Duration Benchmark**:
   - Measure real wall-clock elapsed time (e.g. `Fast Mode: 48.2s` vs `Mode A: 194.5s`).
   - Report actual measured execution seconds with zero estimated percentages.

---

### Pillar 8: Stage Machine Progress & Skip State Management
- **Explicit Skipped State**:
  - When Stage 4 and Stage 5 are bypassed in Fast OCR mode:
    ```javascript
    updateJob(jobId, {
      stages: {
        analyzeDialogueAudio: 'skipped',
        reconcileTimelineEvidence: 'skipped',
      },
    });
    ```
- **State Machine Resiliency**:
  - `productionJobQueue.js`, `useSharedJobQueue()`, and `useSeriesAutoRun` state machines must treat the `'skipped'` status as a satisfied dependency.
  - The state machine will immediately progress from Stage 3 (Extract Subtitles) directly to Stage 6 (Generate Script) without polling timeouts or stalls.
- **UI Stepper Representation**:
  - The Studio Stepper and Progress Bars render Stage 4 and Stage 5 with a sleek `[Skipped ⚡]` indicator rather than an active spinner or pending state.

---

## 4. Component & File Impact Matrix

| Component / File | Scope of Change | Verification Check |
|---|---|---|
| [`backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/stages/stage3_extractChineseSubtitles.js) | Vision prompt gender extraction, observation voting, dedupe pass, min duration & zero overlaps | Unit test with consecutive frames |
| [`backend/services/pipeline/chunkOrchestrator.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/chunkOrchestrator.js) | Boundary dedupe in `stitchAndDeduplicateSegments` | Multi-chunk synthetic test |
| [`backend/services/pipeline/dubbingPipeline.js`](file:///e:/khmer_ai_dubbing_studio/backend/services/pipeline/dubbingPipeline.js) | Bypass Stages 4 & 5, mark `'skipped'` in job state, preserve glossary | Server logs inspection |
| [`backend/routes/jobRoutes.js`](file:///e:/khmer_ai_dubbing_studio/backend/routes/jobRoutes.js) | Store `ep.generationMode` at run start, enforce `force: true` backup | File backup on disk |
| [`backend/utils/subtitleParser.js`](file:///e:/khmer_ai_dubbing_studio/backend/utils/subtitleParser.js) | Standard SRT timecode parser, JSON schema validator, malformed line reporting | Subtitle parser test suite |
| [`frontend/src/components/dashboard/GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx) | Subtitle file dropzone, target episode picker, re-translate confirm modal, persist badge | UI inspection in browser |

---

## 5. Rollback Strategy & Non-Breaking Guarantees
- **No Changes to Mode A / Mode B**: Standard Mode A (`dialogue`) and Mode B (`recap`) execution paths, prompts, and stages remain 100% untouched.
- **Reversible Feature Flagging**: If any issue arises during Fast OCR execution, the system defaults cleanly to standard Mode A pipeline without data loss.
- **Safe Rollback**: All backups are written to disk under `uploads/projects/{seriesId}/episodes/{episodeId}/backups/`, ensuring zero data loss for existing translated scripts.

