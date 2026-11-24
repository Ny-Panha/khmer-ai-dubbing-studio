# Project State (.agents/STATE.md)
Last Session: Antigravity IDE - 2026-11-25T04:44:00+07:00

## Summary
- **Hongguo PC Standalone Setup — Auto Fix & Runtime Verification (`start_hongguo.bat` VERIFIED / Official MP4 Export `BLOCKED` / No AI Dubbing, OCR, Timeline, TTS, or Playback code modified):**
  1. **Phase 1 Environment Detection (`PASS`):** Windows 11 Pro (`10.0.26300`, 64-bit), `12th Gen Intel(R) Core(TM) i5-1235U`, `31.69 GB` RAM (`14.76 GB` free), `WHPX(10.0.26300)` usable (`accel: 0`), `Android Studio 2026.2`, SDK `C:\Users\nhastar\AppData\Local\Android\Sdk`, AVD `Medium_Phone_API_37.0` (`android-37.0\google_apis_playstore\x86_64`, `x86_64,arm64-v8a` via `libndk_translation.so`). Split APKs in `Hongguo_APK/`: `base.apk` (`285,371,572` B), `split_config.arm64_v8a.apk` (`58,446,800` B), `split_config.xxhdpi.apk` (`726,391` B).
  2. **Phase 2 & 3 Auto-Fixes & Login (`PASS`):** Fixed stale AVD `.ini` path (`FTC` -> `nhastar`), tuned `Medium_Phone.avd\config.ini` (`hw.ramSize=6144`, `vm.heapSize=512`, disabled unused polling sensors, kept `hw.gpu.mode=auto`), installed all 3 split APKs cleanly (`com.phoenix.read.oversea.gp` v`7.4.3.32` / `versionCode=74332` / `primaryCpuAbi=arm64-v8a`), fixed Android 17 Gboard crash loop (`show_ime_with_hard_keyboard=0` + disabled crashing Gboard), and owner completed SMS + official login as account **`nha`**.
  3. **Phase 4 Playback & Cold Restart Verification (`PASS` with Ep 10 emulator caveat):** Series `谁让这个文盲修仙的第七季` (`第14季·全210集`) showed all `210` episodes unlocked. Verified >10s playback via screenshots + `dumpsys media.audio_flinger` (`uid: 10235`):
     - `Ep 1`, `Ep 5`, `Ep 6`, `Ep 50`, `Ep 100`, `Ep 150`, `Ep 210`: **PASS** (clear video + audio `+14.89s` to `+23.18s`).
     - `Ep 10`: **PARTIAL** — audio + seekbar progressed `+14.95s` (**PASS**), but emulator `SurfaceView` rendered solid green due to `c2.goldfish.hevc.decoder` `[hevc @ ...] PPS id out of range: 0 / Error parsing NAL unit #0`.
     - Cold Restart (`emu kill` + `-no-snapshot-load` cold boot): **PASS** — account `nha` and watch history persisted without phone/USB or re-login.
  4. **Phase 5 Official Full MP4 Export (`BLOCKED`):** In-app `下载到本地` saves app-private encrypted/offline cache (`7.2MB` for Ep 1 in `我的下载`; zero Export/Share-as-MP4 button; `MediaStore` & `/sdcard/{Movies,Download,DCIM}` contain `0` MP4s; `ttvideo_offline/` and `dataloader/*.mdl` restricted). No authorized official MP4 export exists.
  5. **Phase 6 One-Click PC Launcher (`PASS` — `start_hongguo.bat`):** Created CRLF-formatted `start_hongguo.bat` (auto-detects SDK + `Medium_Phone_API_37.0`, cleans stale locks only if `qemu-system-x86_64.exe` is absent, boots detached emulator, preserves installed package & login session, includes 2-attempt launch retry). Final verification (`task-897`) passed both cold launch (`BAT_EXIT_1=0`) and foreground reuse (`BAT_EXIT_2=0`, `MainFragmentActivity` focused).
- **Previous Investigated Web Limits (Phase 1.2 `d541fdc` & Phase 1.1 `dab019d`):**
  - `hongguoduanju.com` even when logged in as `nha` caps PC Web playback at Episodes `1–5` (`640x360` MP4s validated in `scratch/ep1_5/`) and returns HTTP `502 encrypted_resource_unavailable` / App-only redirect on Ep `6+`.
  - Step 1 Chinese Subtitle Extraction audit pending user approval (`C:\Users\nhastar\.gemini\antigravity\brain\7be44cdf-da55-41d3-8821-7b28ac6a3da6\scratch\`).

## Active Environment
- Backend Server: http://localhost:5000 (not restarted)
- Frontend Dev: http://localhost:5173
- Branch: `chore/full-project-cleanup`
- PC Hongguo Launcher: `E:\khmer_ai_dubbing_studio\start_hongguo.bat` (AVD: `Medium_Phone_API_37.0`, no phone/USB needed)
- Scratch Artifacts & Ep 1–5 Test MP4s: `C:\Users\nhastar\.gemini\antigravity\brain\61e00ff1-7170-494c-a5b5-5f4f64973742\scratch\`

## Next Steps for User
- **Watch Full 210 Episodes on PC (No Phone/USB):** Double-click `start_hongguo.bat` in `E:\khmer_ai_dubbing_studio\` to boot/reuse the standalone emulator and open Hongguo with your persisted **`nha`** session. (Note: occasional individual episodes such as Ep 10 hit an emulator HEVC green-screen decoder bug even though audio plays.)
- **AI Dubbing Studio Video Input:** Official full MP4 batch export from Hongguo App is `BLOCKED` (app-private cache only). Continue testing AI Dubbing Studio with the 5 verified unencrypted `360p` MP4s (`Episode_001.mp4`–`Episode_005.mp4` in `scratch/ep1_5/`) or external authorized `.mp4` files.
- Resume Step 1 Chinese Subtitle Extraction audit approval when ready to work on the dubbing pipeline.
