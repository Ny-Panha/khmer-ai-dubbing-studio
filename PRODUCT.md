# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Cambodian video content creators, drama recap editors, and dubbing studio operators — starting with the founder and internal production team, and designed to serve external Cambodian creators producing Khmer-dubbed drama episodes, movie recaps, Facebook Reels, TikToks, and YouTube videos.

## Product Purpose

**DragonDub AI** (Khmer AI Dubbing Studio) is an all-in-one web dubbing workstation that automates and refines end-to-end Khmer video dubbing and multi-episode drama production: importing source episodes, separating clean background music/SFX from source dialogue (Demucs v4), generating/translating Khmer dialogue scripts via a multi-key Gemini pool, synthesizing Khmer neural character voices (Microsoft Edge Neural TTS — Piseth & Sreymom — plus Google TTS fallback), fine-tuning cuts/subtitles/voices on a multi-track timeline, and rendering final MP4 exports with audio ducking, burned Khmer subtitles, logos, and sponsor overlays. Success means producing broadcast-ready Khmer-dubbed episodes rapidly with accurate timing, natural character voice assignment, zero original-dialogue bleed, and reliable batch throughput across full multi-episode series.

## Positioning

Unlike generic subtitle editors or cloud video tools that treat Khmer as an afterthought, DragonDub AI combines a CapCut-style multi-track web timeline with a local/hybrid 4-stage Cambodian drama dubbing pipeline (Multi-Key Gemini Script/Translation → Multi-Voice Khmer Neural TTS → Auto-Fit Speed Sync → Demucs v4 Clean BGM Separation) and FFmpeg batch rendering with native Khmer script safeguards.

## Operating Context

- **Primary workspace**: Desktop and laptop displays (1280px–1920px+) used during long multi-hour video dubbing, script editing, timeline cutting, and batch monitoring sessions.
- **Secondary viewport**: Mobile screens (~390px) must render cleanly without horizontal overflow or broken layouts — especially for monitoring and operating Home (`/home`), Batch Generate (`/batch`), Batch Export (`/export`), Gemini Quota (`/quota`), and Production Jobs (`/jobs`).
- **Core routes / surfaces**:
  - `/home` (`/`): Project overview, active series progress, quick route launchpad, and episode switcher.
  - `/studio`: 3-column desktop workstation (Left: Media/Episodes/AI Dubbing/Script & Subs; Center: Video Player Preview with live subtitle, logo, corner-mask, anti-theft, and draggable sponsor overlays; Right: Clip Inspector, Character Voices, Audio Ducking, Export Settings) plus resizable bottom Multi-Track Timeline (`VIDEO 1`, `KHMER VOICE 1`, `SUBTITLES`).
  - `/batch`: Multi-episode 4-stage Batch Generate Studio with live per-episode progress cards, queue position, and console log drawers.
  - `/export`: Batch Export & Render Studio for packaging multiple dubbed episodes into final MP4s.
  - `/quota`: Gemini Multi-Key Pool health, RPM/TPD quota monitor, and model routing settings.
  - `/jobs`: Production Job Queue Dashboard with SSE live status stream, logs, and cancel/repair actions.
- **Runtime environment**: Local React 19 + Vite frontend (`http://localhost:5173`) paired with local Node.js/Express + FFmpeg + Python Demucs backend (`http://localhost:5000`).

## Capabilities and Constraints

- **Bilingual Khmer + English UI**: Interface copy, subtitles, script rows, and controls mix Khmer and concise English technical terms. Khmer typography legibility is a strict product constraint: vowel marks and stacked subscripts (ស្រៈ និង ជើងអក្សរ) must never be clipped, and Khmer interactive text must remain readable (`>= 13px` minimum with generous line-height).
- **Existing styling & runtime architecture**: Plain modular CSS (`frontend/src/styles/` + co-located component CSS files) with CSS custom properties in `frontend/src/styles/tokens.css` (no Tailwind CSS runtime).
- **Workflow safety**: UI improvements must not alter pipeline execution, queue ordering, timeline math, audio sync, routing, or FFmpeg export behavior.
- **Undecided product facts**: External SaaS authentication, billing/pricing tiers, and cloud hosting architecture are not yet finalized (current focus is local/self-hosted workstation quality).

## Brand Commitments

- **Product Name**: **DragonDub AI** (subtitle / descriptor: Khmer AI Dubbing Studio).
- **Language & Voice**: Direct, practical bilingual Khmer + English studio terminology tailored to working Cambodian video editors.

## Evidence on Hand

- Live React + Vite frontend (`frontend/src/`) and Express backend (`backend/`) with real series data (`Pseudo_Spiritual_Root`, 23 episodes) and local media/sponsor assets.
- Automated backend/timeline/pipeline test suites (`backend/tests/*.test.js`).
- No external marketing testimonials, customer logos, or public SaaS pricing claims exist and must not be fabricated.

## Product Principles

1. **Khmer Script Legibility First**: Never sacrifice Khmer diacritic/subscript clarity for cramped micro-typography.
2. **Operate with Precision**: Every surface is a working production tool — prioritize scanability, live pipeline state clarity, and low visual noise over decorative flourish.
3. **Desktop Depth, Mobile Integrity**: Preserve dense workstation efficiency on desktop while keeping every route structurally clean and overflow-free at 390px.
4. **Truthful Pipeline State**: Progress bars, queue positions, key health, and voice/clip boundaries must reflect real runtime state rather than decorative placeholders.

## Accessibility & Inclusion

- Bilingual Khmer (`lang="km"`) and English legibility with unclipped Khmer glyphs (`>= 13px` body/interactive text) and clear contrast across dark studio surfaces.
- Full keyboard shortcut workflow (`Space`, `Ctrl+B`, `Delete`, Arrow scrub keys) and accessible focus/control sizing across workstation actions.
