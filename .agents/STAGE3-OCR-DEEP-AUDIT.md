# STAGE 3 RAPIDOCR PERFORMANCE, ACCURACY & DYNAMIC DURATION DEEP AUDIT

**Audit Date:** 2026-11-20  
**Target Branch:** `chore/full-project-cleanup`  
**Latest Baseline Commit:** `e13171e`  
**Auditor:** Minimal Change Engineer / Antigravity IDE  
**Status:** AUDIT COMPLETED — PENDING EXPLICIT APPROVAL (NO PRODUCTION CODE MODIFIED)

---

## 1. Executive Summary

A comprehensive, line-by-line audit of Stage 3 Hybrid Chinese Subtitle Extraction was conducted across `backend/workers/local_chinese_ocr_worker.py`, `backend/services/ocr/localChineseOcrService.js`, `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js`, `backend/services/pipeline/chunkOrchestrator.js`, and `backend/scripts/run_hybrid_ocr_benchmark.js`.

While commit `e13171e` successfully introduced the persistent Python worker architecture (reducing process spawn overhead by ~25s), the audit identified **two critical P0 subtitle-loss bugs** in the deduplication logic, an **unreliable benchmark extrapolation**, and architectural friction points for dynamic-duration videos (5m, 10m, 15m, 20m+).

---

## 2. Standardized Audit Findings Table

| Priority | File | Exact Lines | Verified Evidence | Root Cause | User Impact | Minimal Proposed Fix | Required Test |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P0** | `backend/workers/local_chinese_ocr_worker.py` | 230–243 | Subtitle text occupies <1% of the $1536 \times 248$ ROI. When Chinese text changes from dialogue A to dialogue B on static drama backgrounds, `cv2.absdiff(roi, prev_roi).mean()` is only **0.54**, which is `< 1.8`. Also `(cue_idx is None or prev_cue_idx is None or cue_idx == prev_cue_idx)` matches when `cueIndex == -1` (baseline safety net) or `None`. | Whole-ROI mean pixel difference dilutes small localized subtitle changes by dividing by ~380,000 pixels. | **Catastrophic Subtitle Loss:** Consecutive frames with completely different Chinese lines are falsely deduplicated. Even worse, if Sample A is empty and Sample B contains text, Sample B inherits `hasText: false`, causing the Hybrid Router to mark the cue as `verified_empty` and permanently drop the subtitle. | Replace whole-ROI mean diff with localized text-contour/morphological edge difference OR tight text-box max difference; and restrict dedup strictly to positive, verified non-negative cue IDs (`cue_idx > 0 and cue_idx == prev_cue_idx`). | Dual-sample different-text test on static background verifying `is_deduped == False` and OCR correctly runs. |
| **P0** | `backend/services/ocr/localChineseOcrService.js` | 288–306 | `deduplicateSubtitleFrames` checks `if (!curr.isStaticSubtitleSample || !prev.isStaticSubtitleSample) continue;` | In `stage3_extractChineseSubtitles.js:828–860`, candidate frames are never stamped with `isStaticSubtitleSample`. Property is always `undefined`. | JavaScript deduplication is completely dead code (deduplicates 0 frames). 100% of deduplication was inadvertently shifted onto the flawed Python worker. | Either stamp `isStaticSubtitleSample` in Stage 3 candidate generator for verified static cue samples (`cueIndex > 0 && !sceneCut && !isShortCue`), or align JS deduplication contracts. | Unit test verifying `deduplicateSubtitleFrames` actually deduplicates valid static cue frames when properly tagged. |
| **P1** | `backend/scripts/run_hybrid_ocr_benchmark.js` | 137–142, 169–185 | Benchmark only tests a **60-second window** (`durationSec: 60.0`) and uses `mockAiClient`. Claims of "Projected 5-Min Video Time: ~80–120s" are purely mathematical extrapolations. | Benchmark extrapolated 60s performance assuming 60% deduplication. In reality, 60s local OCR took **128.41s**. For 585 frames at ~1s/frame on CPU, raw execution is ~570s (~9.5 minutes). | Developers/users believe 5-minute video Stage 3 takes 80s, when in production it actually takes ~9 to 10 minutes unless safely optimized. | Update benchmark to support full-duration execution and report actual measured per-frame timings without synthetic assumptions. | Benchmark comparison test on full 5-minute test asset. |
| **P1** | `backend/services/pipeline/stages/stage3_extractChineseSubtitles.js` & `chunkOrchestrator.js` | `stage3:775–785`, `chunkOrchestrator:86–115` | Baseline sampling interval uses `curTime = safeStartSec === 0 ? 0.5 : safeStartSec + 0.3`. Chunk 0 samples at [0.5, 2.0, 3.5...], Chunk 1 (`startOffsetSec = 300`) samples at [300.3, 301.8...]. | Offset asymmetry across 300s chunk boundaries with 2-second overlap (`generateChunkPlan`). | Subtitles appearing between 300.0s and 300.3s risk missing the baseline safety net if change-point detection has a threshold miss during scene transitions. | Align boundary baseline sample offset to exact integer multiples of `intervalSec` relative to global video time. | Multi-chunk boundary subtitle continuity test (298s–303s). |
| **P2** | `backend/services/ocr/localChineseOcrService.js` | 360–385 | If persistent Python worker fails on a corrupted frame, fallback spawns legacy CLI mode in chunks of 60 frames. | Fallback creates fresh Python processes without streaming. | Fallback works correctly, but incurs ~2.5s cold-boot penalty per 60 frames. | Add retry with a single fresh persistent worker before falling back to legacy CLI mode. | Worker crash recovery integration test. |

---

## 3. Current Stage 3 Architecture Analysis

The pipeline for Stage 3 subtitle extraction operates as follows:
1. **Dynamic Duration Check & Chunking (`dubbingPipeline.js` & `chunkOrchestrator.js`)**:
   - Videos $\le 150$s: Single chunk execution.
   - Videos $> 150$s: Partitioned into 300s (5-minute) chunks with a 2-second overlap (`chunkOverlapSec = 2`).
   - Each chunk executes `stage3_extractChineseSubtitles.js` independently and outputs an isolated checkpoint file.
2. **Visual Change-Point Detection (`ffmpegService.extractSubtitleDifferenceGrid`)**:
   - Generates a downscaled subtitle-band difference grid over time.
   - Identifies candidate cue boundaries where pixel changes exceed thresholds.
   - Yields dual temporal samples per cue: `sampleASec` (cue onset $+ 0.12$s) and `sampleBSec` (cue midpoint).
3. **Baseline Safety Net Sampling**:
   - Samples frames every $1.5$s (`cueIndex: -1`) to ensure dialogue missed by change-point detection (e.g. low contrast text or high camera pan) is not lost.
4. **Local RapidOCR Execution (`localChineseOcrService.js` & `local_chinese_ocr_worker.py`)**:
   - Candidate frames are sent to a persistent Python worker (`--persistent`) over `stdin` JSON streaming.
   - Worker runs ONNXRuntime models (`ch_PP-OCRv4_det_infer.onnx`, `ch_ppocr_mobile_v2.0_cls_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx`).
5. **Hybrid Router & Gemini Vision Fallback (`stage3_extractChineseSubtitles.js`)**:
   - Dual-sample cues with confident matching local OCR bypass Gemini entirely.
   - Cues with low confidence, mismatched dual samples, or text near thresholds route to Gemini Vision.
   - Dual samples both lacking text and meeting stability criteria are marked `verified_empty`.

---

## 4. Confirmed Bottlenecks and Root Causes

### Bottleneck 1: CPU Inference Duration (~1.0s / Frame)
- **Measurement**: RapidOCR ONNX inference on Windows CPU takes **$950\text{ms} - 1200\text{ms}$** per frame with text, and **$600\text{ms} - 800\text{ms}$** for empty frames.
- **For 585 frames (5-minute video)**:
  - If 0 frames are deduplicated: $585 \times 0.95\text{s} \approx 555\text{s}$ (**9.25 minutes**).
  - Spawning Python repeatedly previously added $10 \times 2.5\text{s} = 25\text{s}$.
  - The persistent worker solved the 25s process spawn overhead, but CPU inference itself remains the dominant time factor.

### Bottleneck 2: Faulty Deduplication Compromising Correctness
- To bring the execution down from 9.5 minutes to ~2.5–3.5 minutes, deduplication was attempted in `local_chinese_ocr_worker.py:230–243`.
- **The flaw**: It used `cv2.absdiff(roi, prev_roi).mean() < 1.8`.
- In a $1536 \times 248$ subtitle ROI, a completely new subtitle line only changes ~0.5% to 1.0% of the pixels. A dramatic text change on a static drama background produces a mean ROI diff of only **0.54**!
- Because $0.54 < 1.8$, the worker falsely treated brand-new dialogue as identical to previous dialogue.

---

## 5. Risks of Losing Chinese Subtitles (Critical Safety Audit)

1. **Risk of Falsely Merging Sequential Dialogue Lines (High Severity)**:
   - When a character speaks two sentences consecutively on a static camera shot, dialogue 2 is skipped and assigned dialogue 1's text.
2. **Risk of False "Verified Empty" Subtitle Loss (Catastrophic Severity)**:
   - In a cue, Sample A occurs at $t_{\text{start}} + 0.12$s. If the subtitle animation or fade-in hasn't fully rendered, Sample A is OCR-empty (`hasText: false`).
   - Sample B occurs at midpoint where subtitle is crisp.
   - The buggy deduplication matches Sample B to Sample A because background pixel diff is $< 1.8$.
   - Sample B is given `hasText: false`.
   - Hybrid Router checks `!rA.hasText && !rB.hasText`, assumes the cue has no subtitles, marks it `verified_empty`, and skips Gemini. **The subtitle is permanently lost.**
3. **Risk of Safety Net Frames Overriding Cues**:
   - Safety net frames have `cueIndex: -1`. The condition `(cue_idx is None or prev_cue_idx is None or cue_idx == prev_cue_idx)` treats `-1 == -1` as true, deduplicating baseline safety net frames against each other even if they are 1.5 seconds apart!

---

## 6. Dynamic Video Duration Compatibility Assessment

| Video Duration | Frame Count (Est.) | Single Chunk vs Multi-Chunk | Estimated Raw OCR Time (No Dedup) | Memory Profile | Safety Concerns |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **5 minutes** (300s) | ~585 frames | 1 chunk (or 2 chunks if >150s) | ~9.2 minutes | ~400 MB RSS | Manageable within memory, but duration is too slow for user workflow without safe dedup. |
| **10 minutes** (600s) | ~1,170 frames | 2 chunks of 300s | ~18.5 minutes | ~420 MB RSS (worker recycled per chunk) | Subtitle continuity across 300s boundary must be preserved by `chunkOrchestrator`. |
| **15 minutes** (900s) | ~1,755 frames | 3 chunks of 300s | ~27.8 minutes | ~420 MB RSS | Without safe deduplication, 28 minutes exceeds acceptable web job limits. |
| **20+ minutes** (1200s+) | ~2,340+ frames | 4+ chunks of 300s | ~37+ minutes | ~450 MB RSS | High risk of SSE timeout or client disconnect if stage progress is not continuously streamed. |

**Assessment**: The multi-chunk architecture in `chunkOrchestrator.js` cleanly bounds memory because each 300s chunk runs Stage 3 in a separate call and releases its persistent worker. However, CPU OCR throughput remains the primary bottleneck for long videos.

---

## 7. Benchmark Reliability Assessment

- The current benchmark `backend/scripts/run_hybrid_ocr_benchmark.js` tested only 60 seconds with 131 frames.
- It took **128.41 seconds** to process 131 frames (~0.98s per frame).
- The printed claims that a 5-minute video would take "80–120s" and "0–3 Gemini batches" were **extrapolations based on the flawed 1.8 mean diff deduplication**.
- When deduplication is corrected to prevent subtitle loss, only truly identical frames (e.g. Sample A and Sample B within the same short cue on a static shot) can be safely skipped.
- A realistic benchmark must run on the full 5-minute video file (`ep_1_source.mp4`) and verify that every subtitle cue is preserved without dropped lines.

---

## 8. Prioritized Minimal-Change Fix Plan

### Step 1: Fix Deduplication in `local_chinese_ocr_worker.py` (P0)
- Never deduplicate across cues (`cue_idx > 0 && cue_idx == prev_cue_idx` only; never for `cue_idx == -1` or `None`).
- Replace whole-ROI mean difference with localized high-contrast text edge difference:
  - Apply Sobel or Otsu thresholding on the subtitle ROI to extract candidate text pixels.
  - Compute difference **only within the text-stroke mask**.
  - If text strokes differ by $> 5\%$, do NOT deduplicate.
- Never deduplicate an empty result (`prev_res['hasText'] == False`) onto a frame that contains text strokes.

### Step 2: Activate Safe JS Deduplication in `stage3_extractChineseSubtitles.js` (P0)
- In `stage3_extractChineseSubtitles.js`, explicitly tag candidate frames where Sample A and Sample B belong to the exact same static cue (`cueState.duration < 2.0 && !sceneCut`) with `isStaticSubtitleSample: true`.
- Pass this tag cleanly to `localChineseOcrService.js`.

### Step 3: Align Chunk Boundary Offsets (P1)
- In `stage3_extractChineseSubtitles.js:775`, align baseline sampling offset so that chunk transitions (e.g. 300s) sample consistently relative to global video time rather than introducing a $+0.3$s dead zone.

### Step 4: Full 5-Minute Ground-Truth Benchmark & Verification (P1)
- Run the full 286-second video benchmark with ground-truth subtitle comparison to prove zero Chinese dialogue loss and measure genuine wall-clock performance.

---

## 9. Tests Required Before Implementation

1. **`backend/tests/stage3_ocr_dedup_safety.test.js`**:
   - Synthetic frame test with two different Chinese texts on identical black background: must verify RapidOCR is called for both frames and texts are preserved (`hasText: true` for both, distinct text strings).
   - Empty-to-Text cue test: Sample A is black frame, Sample B has subtitle text: must verify Sample B is NOT deduped to Sample A and is correctly recognized.
2. **`backend/tests/stage3_chunk_boundary.test.js`**:
   - Subtitle crossing 300s chunk boundary (299.5s to 301.5s): verify detection and chunk stitch deduplication.
3. **Full 286-Second Video Regression Test**:
   - Full regression of `ep_1_source.mp4` verifying 100% dialogue extraction matching the golden transcript.

---
*Audit completed without touching production code. Ready for review and authorization.*
