# Project State (.agents/STATE.md)
Last Session: IDE - 2026-11-24T10:57:00+07:00

## Summary
- User Request: "create tmey men? kom create dak w knea mk yii"
  - Action Taken:
    1. Integrated `telegram_vip_bot` directly into the existing repository `Ny-Panha/khmer-ai-dubbing-studio`.
    2. Removed nested `.git` inside `telegram_vip_bot` so files are tracked as first-class project files.
    3. Updated root `.gitignore` to protect `telegram_vip_bot/.env` and `telegram_vip_bot/data/` while committing source code and assets.
    4. Committed and pushed to both `chore/full-project-cleanup` and merged into `main`.
    5. Pushed to `origin main` (Commit: `50df491`).
    6. Verified via GitHub API that `telegram_vip_bot` is live on `Ny-Panha/khmer-ai-dubbing-studio` branch `main`.

## Active Environment
- Render Target:
  - Repository: `Ny-Panha/khmer-ai-dubbing-studio`
  - Branch: `main`
  - Root Directory: `telegram_vip_bot`
- Backend Server: http://localhost:5000
- Frontend Dev: http://localhost:5173
- Active Series: ss1 (28 episodes)

## Next Steps for User
- On Render, proceed with:
  - Source Code: `Ny-Panha/khmer-ai-dubbing-studio`
  - Branch: `main`
  - Root Directory: `telegram_vip_bot`
