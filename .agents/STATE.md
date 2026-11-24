# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T01:30:00+07:00

## Summary
- **APK Static Analysis (`com.phoenix.read.oversea.gp` v7.4.3.32 / `74332`) — Read-Only Verification:**
  1. Inspected `E:\khmer_ai_dubbing_studio\Hongguo_APK\base.apk` (25 DEX files, 253.4 MB DEX) and `split_config.arm64_v8a.apk` (170 `.so` native libraries) using `aapt2` and DEX bytecode/string inspection.
  2. Verified official in-app offline caching uses ByteDance `TTVideoEngine` (`Downloader` / `DownloadVidTask` / `libavmdlv2.so` / `libttmplayer.so`), storing media under app-private `/Android/data/com.phoenix.read.oversea.gp/files/ttvideo_offline` and Room DB `series_download_db` (`t_series_download_task`), bound to login `identity` and supporting `spade_a` encryption (`LocalFileSourceInfo`).
  3. Confirmed **no official MP4 export to Gallery/MediaStore** for short dramas (`ExportVideo` = 0 hits; `VideoDownloadServiceImpl` / `SeriesDownloadServiceImpl` never call `MediaStore`).
  4. Verified cache limits in `VideoDownloadServiceImpl.checkBeforeDownload` (`video_download_limit_expansion_v711` / `Ltr5/f;` defaults `300`, `3`, `10`; fallback `30`).
- **Previous Session (Pending):** Step 1 Chinese Subtitle Extraction — Deep Audit & Performance Benchmark (pending user approval before editing Stage 3 OCR / deduplication / ROI filtering).

## Active Environment
- Backend Server: http://localhost:5000 (not restarted during audit)
- Frontend Dev: http://localhost:5173
- APK Files Inspected: `E:\khmer_ai_dubbing_studio\Hongguo_APK\{base.apk, split_config.arm64_v8a.apk, split_config.xxhdpi.apk}`
- Scratch Analysis Artifacts: `C:\Users\nhastar\.gemini\antigravity\brain\61e00ff1-7170-494c-a5b5-5f4f64973742\scratch\`

## Next Steps for User
- Use authorized local/direct `.mp4` files with `hongguo_importer.py` instead of attempting to extract/decrypt in-app encrypted cache from `com.phoenix.read.oversea.gp`.
- Confirm approval before applying production fixes from the Stage 3 OCR audit (`C:\Users\nhastar\.gemini\antigravity\brain\7be44cdf-da55-41d3-8821-7b28ac6a3da6\scratch\`).
