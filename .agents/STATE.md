# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T02:27:00+07:00

## Summary
- **Phase 1.1 — Hongguo Authenticated PC Playback Verification (No AI Dubbing systems modified):**
  1. **Official PC Login Workflow Verified (`hongguoduanju.com`):** Uses ByteDance `WebInterfaceSdk` (`aid: 513755`, chunks `57.16836a6409.js`, `32.01258fb02f.js`, `d.f8bcfe815c.js`) supporting 3 official login methods:
     - Phone + SMS code (`LOGIN_MOBILE_CODE`, supports `+855` Cambodia, `+86`, etc. via `sendCode` / `smsLogin`)
     - Hongguo App QR Scan (`LOGIN_SCAN_CODE` via `/passport/open/check_qrcode/`)
     - Douyin OAuth (`platform: "aweme"`, `platform_app_id: 23377` via `bindWithMobileLogin`)
     - Auth state exposed via `GET /api/pc/profile` and SSR `req.pcPlaybackAuthState` (`"guest"` vs `"authenticated"`).
  2. **Guest vs Authenticated Code Behavior (`f.486c0bc822.js`, `fk.a229907b0c.js`):**
     - Frontend episode selection (`canSelect`) and lock gating (`onPcLockEpisodeClick`, `onPcNextEpisode`) always enforce `index < seriesDetail.accessible_episode_cnt`.
     - Past `accessible_episode_cnt`, web UI shows the mobile App QR prompt (`"扫码进入App端，免费看全集"`).
  3. **Live Authenticated Verification (`accessible_episode_cnt` 5 -> 210) — BLOCKED:**
     - No authenticated user credentials/cookies available without user sign-in; `chrome_devtools` could not connect (`ENOENT: DevToolsActivePort` missing). Live post-login `accessible_episode_cnt` and Ep 6/100/210 server responses remain **NOT VERIFIED**.
  4. **Guest Playback Endpoint Matrix Tested (`series_id=7709114780467858456`):**
     - Ep 1–5: `play-info` returns `200` `720p` (`1280x720`) **encrypted DASH** (`kid` + `player_access_key`); `fallback-play-info` returns `200` unencrypted `640x360` MP4 (full duration).
     - Ep 6, 100, 210: Both `play-info` and `fallback-play-info` return **HTTP `403 Forbidden`** (`protected_playback_unavailable` / `public_fallback_unavailable`).
  5. **Ep 1–5 Fallback MP4 Download + FFprobe + `hongguo_importer.validate()` — PASS (`360p` only, Ep 1–5 only):**
     - `Episode_001.mp4`: `11,671,123` bytes, `89.281s`, `h264 640x360@30/1`, `aac 44100Hz ch=2`
     - `Episode_002.mp4`: `14,316,325` bytes, `95.806s`, `h264 640x360@30/1`, `aac 44100Hz ch=2`
     - `Episode_003.mp4`: `11,605,751` bytes, `87.702s`, `h264 640x360@30/1`, `aac 44100Hz ch=2`
     - `Episode_004.mp4`: `10,964,518` bytes, `90.813s`, `h264 640x360@30/1`, `aac 44100Hz ch=2`
     - `Episode_005.mp4`: `9,691,828` bytes, `90.419s`, `h264 640x360@30/1`, `aac 44100Hz ch=2`
     - Note: Web player sets `controlsList="nodownload"` (no official MP4 download UI button).
- **Previous Sessions:**
  - Phase 1 Source Investigation (`c99725b`) & APK Static Analysis (`base.apk` + `split_config.arm64_v8a.apk`) completed.
  - Step 1 Chinese Subtitle Extraction audit pending user approval (`C:\Users\nhastar\.gemini\antigravity\brain\7be44cdf-da55-41d3-8821-7b28ac6a3da6\scratch\`).

## Active Environment
- Backend Server: http://localhost:5000 (not restarted)
- Frontend Dev: http://localhost:5173
- Branch: `chore/full-project-cleanup`
- Scratch Artifacts & Ep 1–5 Test MP4s: `C:\Users\nhastar\.gemini\antigravity\brain\61e00ff1-7170-494c-a5b5-5f4f64973742\scratch\`

## Next Steps for User
- To verify Task 3 (`accessible_episode_cnt` after real login), enable Chrome remote debugging (`chrome://inspect/#remote-debugging`), sign into `hongguoduanju.com` legitimately in Chrome, and re-run authenticated verification.
- Until verified that all 210 episodes become accessible as unencrypted MP4s after login, **210-episode download support remains BLOCKED**; use `hongguo_importer.py` for authorized local MP4 files.
