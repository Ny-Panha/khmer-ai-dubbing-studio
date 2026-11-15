# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (PP-OCRv5 Mobile Local OCR Integration)
- **Branch**: `feat/ppocr-local-ocr` (pushed to `origin/feat/ppocr-local-ocr`, based on `feat/sensevoice-local-asr`)
- **Timestamp**: 2026-11-15T18:55:00+07:00

## Summary: Stage 3 Local PP-OCRv5 Mobile Worker Integration
1. **Audit & Contract Preservation (Step 0)**:
   - Stage 3 contract (`timestampSec`, `hasText`, `chineseText`, `position`, `isSharp`, `visualGender`, `speakerGender`, `speakerVisualHint`, `deliveryType`, `genderConfidence`) preserved 100%.
   - Position classification accurately mapped from bounding box coordinates (`bottom_subtitle` vs `title_card`).
2. **Local Worker (`backend/workers/ppocr_worker.py`) (Step 1)**:
   - Built PaddleOCR PP-OCRv5 mobile det + rec (`PP-OCRv5_mobile_det`, `PP-OCRv5_mobile_rec`), Chinese (`ch`), CPU-only.
   - Fixed Windows Torch/Paddle DLL clash (`import torch` upfront to avoid `shm.dll [WinError 127]`).
   - Fixed Paddle 3.3.1 PIR oneDNN issue (`enable_mkldnn=False`).
   - Added `--prepare` mode with visible download progress and `[PP-OCR Worker] models ready` (exit 0).
   - Added `--threads` (default 8) and `--limit_side_len` CLI parameters.
   - Noise & Watermark filtering: rejects disclaimers (`剧情为虚构演绎`, `切勿当真`, `普法科普`, `A[I]生成`), platforms/logos (`抖音`, `快手`, `小红书`), and creator handles (`@...`, `ID:...`).
3. **Node Service (`backend/services/ppocrService.js`) (Step 1)**:
   - Spawns python worker with process registry tracking (`registerProcess`, `terminateChildProcess`).
   - Dynamic timeout scaling: `Math.max(300000, frames.length * 6000)` prevents timeouts on large candidate batches.
   - Graceful abort signal propagation (`createAbortError`).
4. **Stage 3 Engine Swap & Routing (`stage3_extractChineseSubtitles.js`) (Step 2 & 3)**:
   - Default primary engine: `ppocr-local`. Configurable via `OCR_ENGINE` env variable (`ppocr-local` or `gemini-vision`).
   - Automatic fallback to Gemini Vision if PP-OCR worker fails (crashes, times out, or error) with visible log: `[Stage 3 Extract Subtitles] ⚠️ PP-OCR local worker failed (...). Falling back to Gemini Vision OCR...`.
   - Preserved change-driven frame selection, cue boundaries, dedupe, and double-read tie-break verification.
   - Standardized engine log: `[Stage 3 Extract Subtitles] OCR engine: ppocr-local (PP-OCRv5 mobile, wall time: Xs, N cues)`.
5. **Owner's 1:1 Rule Logging (Step 3)**:
   - `chunkOrchestrator.js` & `dubbingPipeline.js`: Added `cues detected: X -> segments stored: Y` logging.
   - Emits loud warning if `X !== Y` in Fast OCR mode (`⚠️ WARNING: Fast OCR 1:1 rule mismatch!`).
6. **Tests & Benchmarks (Step 4)**:
   - Unit tests (`backend/tests/ppocr_local_ocr.test.js`): **5 PASS / 0 FAIL**:
     1. PP-OCR Worker contract verification (frames in -> lines and boxes out): PASS
     2. PP-OCR Noise filter (disclaimers/watermarks): PASS
     3. PP-OCR Wrapper empty frames handling: PASS
     4. Fast OCR 1:1 rule logging: PASS
     5. Stage 3 Forced-Failure fallback to Gemini Vision: PASS
   - Standalone Benchmark on `SaveTik.co_7703366571728653622-hd` (286.56s):
     - Change points: 310 (candidate cue states) -> 568 candidate frames.
     - Per-frame CPU execution: ~5.1s/frame on CPU.
     - 30s benchmark slice: 61 frames + 5 tie-breaks processed in 330.6s -> 17 clean deduplicated cues detected.
     - First 10 Cues text extracted:
       1. [0.8s -> 2.6s] "假如有天我失手鲨了人"
       2. [2.6s -> 4.2s] "只要学电影里把屍体藏好"
       3. [4.2s -> 5.2s] "是不是就就沒事了？"
       4. [5.6s -> 7.0s] "你可以试试看"
       5. [7.0s -> 9.4s] "在凶手脑子里那叫完美犯罪"
       6. [9.8s -> 10.6s] "在法医眼里"
       7. [10.6s -> 13.4s] "你接下来每一步都是在花式递交证据"
       8. [13.4s -> 14.4s] "少唬我！"
       9. [15.2s -> 16.8s] "我现在就趁着夜黑风高"
       10. [17.0s -> 18.6s] "把人装进麻袋里"
     - Wall time honesty report: Target <60s is missed on CPU because sequential deep learning inference across 568 frames at ~5.1s/frame takes ~48 mins without GPU/oneDNN. Dominant cost is CPU conv2d tensor evaluation without PIR oneDNN support.

## Active Environment
- Backend API: `http://localhost:5000`
- Frontend Vite: `http://localhost:5173`
- Active Branch: `feat/ppocr-local-ocr`
- OCR Worker: `backend/workers/ppocr_worker.py`
- Python Binary: `Python 3.11` with `paddlepaddle 3.3.1` and `paddleocr 3.7.0`
- Models Cached: `C:\Users\nhastar\.paddlex\official_models\PP-OCRv5_mobile_det` and `rec`

## Next Steps
- Real-app verification on 1 episode in Fast OCR mode when no batch job is running.
- Pull request `feat/ppocr-local-ocr` ready for review on GitHub.
