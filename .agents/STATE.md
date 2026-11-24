# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T03:03:00+07:00

## Summary
- **Phase 1.2 — Authenticated Full Episode Verification (`BLOCKED` — No AI Dubbing/OCR/Timeline/TTS/Playback code modified):**
  1. Owner manually logged into `hongguoduanju.com` as account **`nha`** in Brave (`media_1795550045034_9778e002.jpg`, `media_1795550524578_0a2e5929.jpg`); earlier screenshot showed `扫码下载安装「红果短剧App」` QR modal overlay on the series page.
  2. Added `"chrome-devtools-brave"` (`--browserUrl http://127.0.0.1:9222`) to `c:\Users\nhastar\.gemini\config\mcp_config.json`; after Antigravity restart, all 32 `chrome-devtools-brave` MCP tools loaded (`list_pages`, `select_page`, `evaluate_script`, `click`, `take_snapshot`, `list_network_requests`, `get_network_request`, etc.).
  3. **Exact Connection Blocker:** Calling `chrome-devtools-brave` `list_pages` against Brave (`brave://inspect/#remote-debugging`, `Server running at: 127.0.0.1:9222`) failed with: `Failed to fetch browser webSocket URL from http://127.0.0.1:9222/json/version: HTTP Not Found`. Brave's UI remote-debugging toggle (`DevToolsActivePort`) does not serve `/json/version` over HTTP for `--browserUrl` (requires `--wsEndpoint` or launching via `--executablePath`, or Google Chrome with `--autoConnect`).
  4. **Verification Status:** Post-login `accessible_episode_cnt`, playback/endpoint responses for Episodes `6, 10, 50, 100, 150, 210`, and Phase 2 `hongguo_downloader.py` remain **BLOCKED / NOT VERIFIED**.
- **Previous Verified Results (Phase 1.1, `dab019d`):**
  - Guest PC web (`series_id=7709114780467858456`, 210 `vid_list` IDs): `accessible_episode_cnt = 5`.
  - Ep 1–5 `fallback-play-info`: unencrypted `640x360` MP4s (`87.7s`–`95.8s`, `h264` + `aac`) downloaded & validated in `scratch/ep1_5/` via `ffprobe` and `hongguo_importer.validate()`. Ep 1–5 `play-info`: `720p` encrypted DASH (`kid` + `player_access_key`).
  - Ep 6, 100, 210 (guest): HTTP `403 Forbidden` (`protected_playback_unavailable` / `public_fallback_unavailable`).
  - Step 1 Chinese Subtitle Extraction audit pending user approval (`C:\Users\nhastar\.gemini\antigravity\brain\7be44cdf-da55-41d3-8821-7b28ac6a3da6\scratch\`).

## Active Environment
- Backend Server: http://localhost:5000 (not restarted)
- Frontend Dev: http://localhost:5173
- Branch: `chore/full-project-cleanup`
- Scratch Artifacts & Ep 1–5 Test MP4s: `C:\Users\nhastar\.gemini\antigravity\brain\61e00ff1-7170-494c-a5b5-5f4f64973742\scratch\`

## Next Steps for User
- **Option A (Fastest — 0 restarts, in current logged-in Brave tab):** In the `nha`-authenticated Brave tab (`https://hongguoduanju.com/detail?series_id=7709114780467858456`), open `F12` -> `Network` (filter `play-info`), click Episodes `6, 10, 50, 100, 150, 210`, and confirm whether they play video (`200`) or show HTTP `403` + the `扫码下载安装「红果短剧App」` QR modal (without sharing cookies/tokens).
- **Option B (Automated MCP in Brave without `/json/version` HTTP 404):** Update `chrome-devtools-brave` in `c:\Users\nhastar\.gemini\config\mcp_config.json` to either `--wsEndpoint ws://127.0.0.1:9222/devtools/browser/<id>` (using the active WebSocket path in Brave's `DevToolsActivePort`) or `--executablePath "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"` (removing `--browserUrl` so MCP launches a fresh Brave profile to sign into once), then reload Antigravity MCP servers.
- Do not build `hongguo_downloader.py` until an authorized unencrypted 210-episode source is verified.
