# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (SenseVoice Worker Optimization & Progress Logging)
- **Branch**: `feat/sensevoice-local-asr`
- **Timestamp**: 2026-11-15T14:25:00+07:00

## Summary: SenseVoice Worker Apparent Hang & Slowness Resolution
1. **`--prepare` Mode**:
   - Added `--prepare` CLI flag that downloads & caches models (`iic/SenseVoiceSmall`, `fsmn-vad`, `cam++`) with visible progress bar (loggers unsuppressed during prepare).
   - Logs `[SenseVoice Worker] models ready` upon completion.
2. **CPU Threading Utilization**:
   - Defaulted `--threads` to 8 (previously 2).
   - Applied `torch.set_num_threads(threads)` to PyTorch runtime before AutoModel initialization and passed to Sherpa-ONNX fallback.
3. **YIN Pitch Optimization (0.47s vs 2–3 mins)**:
   - Capped pitch calculation to the middle `min(2.0s, segment length)` slice of each audio segment.
   - Set `hop_size = 1024` (previously 512).
   - Output fields (`pitchHz`, `acousticF0`, `acousticGender`, `acousticConfidence`, `audioGender`) remain 100% contract-identical.
4. **CPU-Friendly Diarization Batching**:
   - Lowered `batch_size_s` from 300 to 60 in `model.generate()`.
5. **Real-time Per-Stage Logging**:
   - Added explicit timing logs (`stderr` with `flush=True`):
     - `[SenseVoice Worker] Model load start/done`
     - `[SenseVoice Worker] Generate start/done`
     - `[SenseVoice Worker] Pitch stage start/done` with progress reported every 10 segments.
     - `[SenseVoice Worker] Total funasr time` & `Total execution time`.

## Verification & Benchmarks (i5-1235U CPU-Only)
- **Test File**: `backend/uploads/projects/series_1794653630301/episodes/ep_1/video/ep_1_source.mp4` (Duration: 286.56s / 4.77 mins)
- **Stage Breakdown (Cached Standalone Run)**:
  - Model load: 17.39s (ModelScope check & weight loading into memory)
  - Generate (SenseVoice ASR + CAM++ diarization): 42.57s (**dominant stage**, ~7x real-time RTF ~0.145 on CPU)
  - Pitch analysis: **0.47s** (down from 2-3 minutes!)
  - Total FunASR pipeline: 66.91s
  - Total worker execution (including FFmpeg 16k mono extraction): 69.05s
  - Output segments: 16 valid Chinese dialogue segments
- **Stage 4 Real Pipeline Verification**:
  - `[Stage 4 Analyze Audio] ASR engine: sensevoice-local (funasr-sensevoice, wall time: 29.4s, 2 segments)`
- **Test Suite**:
  - `npm test` (`node --test tests/*.test.js`): **244 passed, 0 failed, 2 skipped** (17.08s).

## Active Environment
- Backend API: `http://localhost:5000`
- Frontend Vite: `http://localhost:5173`
- SenseVoice Worker: `backend/workers/sensevoice_worker.py` (CPU 8-thread optimized)

## Next Steps
- SenseVoice local worker is fully verified, non-blocking, and reports granular progress to stderr.
