# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T02:18:00+07:00

## Summary
- **Standalone Hongguo Downloader — Phase 1 Source Investigation (BLOCKED before Phase 2; zero pipeline/UI/OCR/TTS code modified):**
  1. Investigated `https://hongguoduanju.com/detail?series_id=7709114780467858456` (`谁让这个文盲修仙的第七季`, `series_id=7709114780467858456`) via official SSR `_ROUTER_DATA`, public player JS bundles, and live HTTP + `ffprobe` checks on Windows without phone/USB/ADB/emulator.
  2. **Episode Enumeration:** `seriesDetail` reports `episode_cnt = 210` with all `210` `vid_list` IDs, but guest PC access is capped at `accessible_episode_cnt = 5` (`pcPlaybackAuthState = "guest"`, `pcAuthenticatedPlayback = false`, `protectedPlayback = true`).
  3. **Preview vs Full Stream Root Cause:** The public `<video>` SEO path `/video/public/<vid>/360p.mp4` is a `10.066667s` (`946,754` bytes, `640x360`, `h264`/`aac`) preview (explaining `yt-dlp`'s `10.066s, 360p` output).
  4. **Exact Access / Encryption Blockers:**
     - **Episodes 1–5:** `POST /api/video/protected/play-info` returns `200` `720p` (`1280x720`) **encrypted DASH** (`format="dash"`, `kid` + `player_access_key`, `encrypt: true`); `POST /api/video/protected/fallback-play-info` returns `200` unencrypted `640x360` MP4 (`89.28s` Ep 1, `95.81s` Ep 2, `90.42s` Ep 5).
     - **Episodes 6–210 (205 of 210 episodes):** Both `POST /api/video/protected/play-info` and `POST /api/video/protected/fallback-play-info` return **HTTP `403 Forbidden`** (`{"error":"protected_playback_unavailable"}` / `{"error":"public_fallback_unavailable"}`), gated behind account login / App QR unlock (`"扫码进入App端，免费看全集"`).
     - **Android APK (`com.phoenix.read.oversea.gp` v7.4.3.32):** Uses `TTVideoEngine` + `libavmdlv2.so` private cache (`ttvideo_offline`), account `identity` lock (`t_series_download_task`), `spade_a` encryption (`LocalFileSourceInfo`), and zero official MP4 export.
  5. Stopped at Phase 1 per strict gate ("Only proceed when an authorized downloadable full-video source is verified").
- **Previous Sessions:**
  - APK Static Analysis (`base.apk` + `split_config.arm64_v8a.apk`) completed at `2026-11-25T01:30:00+07:00`.
  - Step 1 Chinese Subtitle Extraction audit pending user approval (`C:\Users\nhastar\.gemini\antigravity\brain\7be44cdf-da55-41d3-8821-7b28ac6a3da6\scratch\`).

## Active Environment
- Backend Server: http://localhost:5000 (not restarted)
- Frontend Dev: http://localhost:5173
- Branch: `chore/full-project-cleanup`
- Phase 1 Scratch Artifacts: `C:\Users\nhastar\.gemini\antigravity\brain\61e00ff1-7170-494c-a5b5-5f4f64973742\scratch\`

## Next Steps for User
- **If pursuing Hongguo web source:** Provide or verify an authorized/licensed source or authenticated session where full episodes `6–210` are legitimately served without DRM/encryption lock, before implementing Phase 2 `hongguo_downloader.py`.
- **Recommended path:** Import authorized/owned `.mp4` files directly via `hongguo_importer.py`.
