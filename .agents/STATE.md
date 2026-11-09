# Antigravity Shared State (Sync Memory)

## Last Session
- **Environment**: Antigravity IDE (CPU Demucs Speedup Benchmarks, Step-2 Quality Gate, & `/api/audio/separate` Keep-Alive Fix)
- **Timestamp**: 2026-11-09T11:00:00+07:00

## Summary: CPU Demucs Optimization & HTTP Keep-Alive Fix
1. **CPU Demucs Inference Benchmarks (3-min excerpt `179.98s` on Intel i5-1235U, AC plugged in, Best Performance overlay, `htdemucs`, `--suppress_residuals` ON)**:
   - Baseline (`shifts=1, overlap=0.5, segment=4, -j 1`): **632.48s** (Demucs 621.59s, Suppress 10.52s = `1.66%`)
   - Variant (a) (`--shifts 0`): **714.84s** (Demucs 705.97s, Suppress 8.20s = `1.15%`, Step-2 PASS)
   - Variant (b) (`--shifts 0 --overlap 0.25`): **467.55s** (Demucs 458.87s, Suppress 8.02s = `1.72%`, Step-2 PASS)
   - Variant (c) (`(b) + --segment 7`): **277.03s** (Demucs 268.32s, Suppress 8.16s = `2.95%`, Step-2 PASS)
   - **Variant (d) (`(c) + -j 2` — Winner)**: **221.26s** (Demucs 213.13s, Suppress 7.46s = `3.38%`, **-65.0% / 2.86x faster**, Step-2 PASS `-0.15 dB` mean att delta in 150–180s window & verified inaudible by listening across 14–26s, 26–31s, 108–114s, and 150–180s)
2. **Applied Worker Defaults & Caller Inheritance**:
   - [demucs_worker.py](file:///e:/khmer_ai_dubbing_studio/backend/workers/demucs_worker.py): Updated argparse defaults to `--shifts 0`, `--overlap 0.25`, `--segment 7`, `--jobs/-j 2` (with `--suppress_residuals` kept ON) and accurate measured-tradeoff help text.
   - [audioSeparationService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/audioSeparationService.js): Removed hardcoded `--shifts 1` / `--overlap 0.25` overrides so every caller (UI step run & render-time) inherits `demucs_worker.py` defaults; fixed `cleanKey` ReferenceError in `killSeparationJob` and exported `isSeparationBusy`/`getCurrentSeparationMedia`.
3. **Fixed `net::ERR_EMPTY_RESPONSE` / Proxy Reset Recovery on `/api/audio/separate`**:
   - [audioRoutes.js](file:///e:/khmer_ai_dubbing_studio/backend/routes/audioRoutes.js): Streams immediate HTTP `200 OK` headers + 10s whitespace heartbeat keep-alive after checking busy/404, keeps `series.json` persistence on completion, and returns recoverable `noVocalsUrl` in `/api/audio/separation-progress`.
   - [DubbingModeTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/DubbingModeTab.jsx), [GeminiRouteModal.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx), [vite.config.js](file:///e:/khmer_ai_dubbing_studio/frontend/vite.config.js): Added disconnect polling recovery and clean upstream proxy closing when headers were already sent.
4. **Verification**:
   - **Full ~20-min EP3 (`1201.67s`) end-to-end separation**: **1278.26s (`21m 18s`, `0.94x` real-time; Demucs 1257.44s, Suppress 20.15s = `1.58%`)** vs ~70.4 min projected old baseline; Step-2 dense 30s gate (`t=682s-712s`): **`-26.76 dB`** speech-band attenuation (listening verified Chinese dialogue 100% inaudible).
   - **25s Heartbeat Live API Test** (`:5173/api/audio/separate`): PASS (`200 OK` in 26ms, 3 heartbeat chunks).
   - **Tests & Build**: Backend tests (`node --test backend/tests/*.test.js` incl. [demucs_worker_defaults.test.js](file:///e:/khmer_ai_dubbing_studio/backend/tests/demucs_worker_defaults.test.js)) ➔ 90/90 PASS (1 skipped missing external video); `npm --prefix frontend run build` ➔ PASS.
5. **Cache Note (STEP 3)**: Separation cache key uses model name only — previously cached episodes retain their existing `no_vocals.wav` untouched; new defaults apply to new separations only.

## Active Environment
- **Backend API**: `http://localhost:5000` (Express)
- **Frontend Studio UI**: `http://localhost:5173` (Vite + React)
- **EP3 Clean BGM Cached**: `/uploads/cache/separation/3cc6e980df57f5fad4e27af333f2bbdc/no_vocals.wav`

## Next Steps
- If UI tab was open before these edits, press **`Ctrl + Shift + R`** in browser to load updated frontend bundle.
- Avoid editing files under `backend/routes`, `backend/services`, `backend/models`, or `server.js` while a long Demucs CPU run is active via `dev.ps1` (`node --watch`).

---

## Previous Session
- **Environment**: Antigravity IDE (Fix: Eliminate Artificial 5-6s Empty Space on Short Voice Clips & Fit True Audio Duration)
- **Timestamp**: 2026-11-09T01:10:00+07:00

## Latest Update: Eliminate Artificial 5-6s Empty Space on Short Voice Clips (Truthful Audio Duration)

### Problem Description
- **Question**: User asked *"mx ban vea generate slg term tea slg yy tea 1-3s tea kleang voice vea show 1-5 6 ?"* with screenshot showing voice clip `#18 ប្រុស` stretched from 00:31.5 to 00:36.5 (5.0s long box), while speech audio only lasted ~2.0s (ending at 00:33.8), leaving ~3.0s of dead silence (marked with red zigzag) and pushing clip `#19` onto VOICE 2.
- **Root Cause**:
  1. *Subtitle Slot Clamping on Audio Track*:
     In `TimelineTracksCanvas.jsx`, `TimelineEditor.jsx`, and `VideoPlayerPreview.jsx`, voice clip boxes were calculated with:
     `rawEnd = Math.max(slotEnd, rawStart + realAudioDuration)`
  2. *SlotEnd Origin*: `slotEnd` is the original Chinese subtitle visual end time (e.g., 5.0 to 6.0 seconds).
  3. *Unintended Consequence*: Even though Khmer TTS finished speaking in 1.5s - 2.5s, taking `Math.max(slotEnd, ...)` forced the audio clip box to stretch to the 5-6s visual subtitle slot duration, leaving empty blank space on the box waveform and creating artificial collision flags that pushed subsequent clips down to lower tracks.

### Resolution
1. **Truthful Voice Clip Sizing ([TimelineTracksCanvas.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/timeline/TimelineTracksCanvas.jsx))**:
   - Replaced `Math.max(slotEnd, rawStart + realAudioDuration)` with `(rawStart + realAudioDuration)` in both `internalSegmentRows` (line 161) and `renderVoiceSegment` (line 222).
2. **Track Row & Magnetic Edge Alignment ([TimelineEditor.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/TimelineEditor.jsx))**:
   - Replaced `Math.max(slotEnd, rawStart + audioDur)` with `(rawStart + audioDur)` in `segmentRows` derivation and `getSegEffectiveRange`.
   - Updated `handleAudioMouseDown` to derive `rawEnd = isTrimmed && audioEndSec ? audioEndSec : (rawStart + audioDur)` instead of defaulting to `seg.endSec`.
3. **Player Preview & Operations Timing ([VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/VideoPlayerPreview.jsx), [useClipOperations.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useClipOperations.js))**:
   - Removed `slotEnd` stretching from effective audio end boundaries so playback and split operations use true audio duration.

### Verification
- `npm --prefix frontend run build` ➔ PASS (1.37s).
- Full regression suite `node --test backend/tests/*.test.js` ➔ 85/85 PASS (1 skipped).

## Previous Update: Fix Character Glossary Gender Resolution & Explain Detection Pipeline

### Problem Description
- **Question**: User asked *"kleang ng vea jab mx?"* with screenshot of `SERIES CHARACTER GLOSSARY (រក្សាឈ្មោះតួអង្គឆ្លងភាគ)` where all badges displayed `(ប្រុស)`, including female characters such as `តួអង្គស្រី (ប្រុស)`, `តួឯកស្រី (ប្រុស)`, and `តួស្រី (ប្រុស)`.
- **Root Cause**:
  1. *Glossary Ingestion*: During initial script extraction / translation, Gemini detects speaker names per line. `extractGlossaryFromEpisode` in `projectStorage.js` extracts unique speakers into `series.glossary.characters`.
  2. *Gender Evaluation Flaw*: `EpisodesTab.jsx` strictly checked `ch.gender === 'female'`, which failed on uppercase `"FEMALE"` and did not inspect the character name or assigned voice (`km-KH-SreymomNeural`).
  3. *Default Fallback to Male*: `extractGlossaryFromEpisode` defaulted to `'male'` when gender was missing without testing name keywords (`ស្រី`, `នាង`, `យាយ`, `ម៉ែ`, `កញ្ញា`).

### Resolution
1. **Case-Insensitive & Voice/Name-Aware Detection ([EpisodesTab.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/media/EpisodesTab.jsx))**:
   - `isFemale` checks lowercase gender, voiceId (`Sreymom`), and Khmer female keywords (`/ស្រី|នាង|យាយ|ម៉ែ|កញ្ញា|ជំទាវ/i`). Displays `(ស្រី)` in pink (`#f472b6`).
2. **Robust Glossary Extraction ([projectStorage.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/utils/projectStorage.js))**:
   - Added `detectGender` function examining raw gender, voiceId, and character name before applying fallback.
3. **Data Normalization ([series.json](file:///e:/khmer_ai_dubbing_studio/backend/uploads/projects/series_1793898268958/series.json))**:
   - Normalized existing character glossary in `series.json`, updating female characters to `gender: 'female'` with `km-KH-SreymomNeural`.

### Verification
- `npm --prefix frontend run build` ➔ PASS (1.44s).
- `node --test backend/tests/timeline_*.test.js` ➔ 10/10 PASS.

## Previous Update: Upgrade AI Re-Translate Prompt with 10 Strict Rules & Surrounding Context

### Problem Description
- **Goal**: Upgrade the `✨ AI កែប្រែ (Re-Translate)` feature in the Subtitle Edit/Clip Inspector panel with Nha's 10-rule expert Chinese-to-Khmer translation prompt while preserving the 3 stylistic options (🎭 សម្ដីកុនបុរាណ, 📝 ខ្លីចំអត្ថន័យ, ⚡ អារម្មណ៍តួអង្គ) and the terminology note.
- **Key Enhancements**:
  1. *10 Strict Translation Rules*: Analyzing full sentence context, resolving ambiguous words (e.g. 质量 = ម៉ាស (mass) in physics vs គុណភាព in everyday language), preserving tone/emotion, incomplete clause preservation, fresh re-translation (never blindly copying previous translation), and zero Thai/Chinese residual script.
  2. *Surrounding Context Injection*:
     `ClipInspectorPanel.jsx` now automatically collects `previousTranslation`, previous dialogue line `[មុន]`, current line `[បច្ចុប្បន្ន]`, and following dialogue line `[បន្ទាប់]`, feeding them into `retranslateSegmentApi`.
  3. *Backend Prompt Engineering*:
     `retranslateSingleDialogue` in `geminiService.js` now structures the payload with:
     - `**Original Chinese:** {{original_text}}`
     - `**Previous Khmer Translation (for comparison only; do not copy blindly):** {{previous_translation}}`
     - `**Surrounding Context (if available):** {{context}}`
     - `**Speaker:** {{speaker}} ({{gender}})`

### Resolution
1. **Frontend Context Collector ([ClipInspectorPanel.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/voice/ClipInspectorPanel.jsx))**:
   - `handleAiRetranslate` extracts preceding and following segments from `scriptData.segments` and sends `previousTranslation` and `surroundingContext` to the backend.
2. **Backend Expert Prompt ([geminiService.js](file:///e:/khmer_ai_dubbing_studio/backend/services/geminiService.js))**:
   - Upgraded `retranslateSingleDialogue` system instruction with all 10 strict rules, preserving the 3 JSON output options and note.

### Verification
- `npm --prefix frontend run build` ➔ PASS (1.33s).
- `node --test (Get-ChildItem -Path backend/tests/phase1_*.test.js).FullName` ➔ 7/7 PASS.
- `node --test (Get-ChildItem -Path backend/tests/timeline_*.test.js).FullName` ➔ 10/10 PASS.

## Previous Update: Fix Timeline Auto-Center Stopping Past 20+ Seconds

### Problem Description
- **Symptom**: User reported *"ot vea der jit job hxx vea ot jab tt?? fix code kelang ng mer vea error mx? mx ban dol 20+ vea leang jam ah jm? /agents"* with screenshot showing playhead at 00:35 near the right edge while the timeline remained stuck at `scrollLeft = 0` (failed to auto-center once crossing 00:20-00:23s).
- **Exact Root Cause Uncovered**:
  1. *Flex Layout Clamping & Containment Ceiling*:
     In `TimelineEditor.css` and `TimelineTracksCanvas.jsx`, `.tracks-content` was styled with `flex: 1`, `width: 100%`, and `contain: layout style`. Under browser CSS flex layout, `flex: 1` sets `flex-shrink: 1` and `flex-basis: 0%`. This caused `.tracks-content` to shrink down to `clientWidth - 112px`, meaning `.timeline-scroll-area` had `scrollWidth = clientWidth + 112px`.
     At 45 pixels per second (`pps = 45`), the total available scroll headroom was `112px / 45 = 2.4 seconds`!
     As the video played from 0s to 20s, the playhead moved towards the 50% viewport center line (`clientWidth / 2` ~ 20-22s). The MOMENT it crossed the center line at ~20s-22s, the auto-center logic attempted to scroll `targetScroll = 12px, 50px, 112px...` and immediately slammed into the 112px ceiling! The browser clamped `container.scrollLeft` to the maximum overflow (112px or 0px), preventing any further horizontal scrolling!
  2. *Conditional `selectedVideo` width fallback*:
     In `TimelineTracksCanvas.jsx`, `.tracks-content` and `.track-lane` widths were bound to `selectedVideo ? totalWidth : '100%'`. If `selectedVideo` was null or re-rendered without the asset reference, widths collapsed back to `'100%'`.
  3. *Auto-Heal 60s Threshold on Short Episodes*:
     The single-clip auto-heal in `TimelineEditor.jsx` and `useSeriesManager.js` used a restrictive `totalDuration > 60` guard, failing to stretch truncated clips on shorter episodes or test cuts (<60s).

### Resolution
1. **Unconstrained Scroll Width & Flex Fix (`TimelineEditor.css`, `TimelineTracksCanvas.jsx`)**:
   - Removed `contain: layout` from `.timeline-scroll-area` and `contain: layout style` from `.tracks-content`.
   - Changed `.tracks-content` from `flex: 1` to `flex: 0 0 auto` (with `minWidth: Math.max(totalWidth, 1200)` and `width: Math.max(totalWidth, 1200)`).
   - Removed `selectedVideo ? totalWidth : '100%'` conditional; track lanes now always utilize `totalWidth || '100%'` derived reliably from `totalDuration`.
   - Playwright verification confirmed `scrollWidth` expanded from clamped 1,392px to full 3,112px+ and `scrollLeft` now scrolls freely (887px+).
2. **True Center-Lock Viewport Alignment (`TimelineEditor.jsx`)**:
   - Streamlined auto-follow math:
     `playheadAbsoluteX = currentX + TRACK_HEADER_WIDTH;`
     `rightThreshold = clientWidth / 2;`
     `targetScroll = playheadAbsoluteX > rightThreshold ? Math.round(playheadAbsoluteX - rightThreshold) : 0;`
     `container.scrollLeft = targetScroll;`
   - Playhead now stays at 0 until crossing 50% screen center, then locks dynamically at 50% center through 20s, 35s, 60s, and full 20:00mn.
3. **Resilient Auto-Heal (`TimelineEditor.jsx`, `useSeriesManager.js`)**:
   - Relaxed single-clip auto-heal condition to `totalDuration > 15 && singleClip.end < totalDuration - 2` so clips on both short and 20-minute episodes automatically stretch without manual intervention.

### Verification
- Playwright Edge DOM Inspection: `scrollWidth` 3112px, `clientWidth` 1280px, `scrollLeft` scrolls to 887px without clamping.
- `npm --prefix frontend run build` ➔ PASS (644ms).
- `node --test` backend test suite ➔ 85/85 PASS (0 failed, 1 skipped).

## Previous Update: Continuous Playback Beyond 20s Truncated Video & Safe RAF Loop

### Problem Description
- **Symptom**: User reported *"vea jam auto hxx tea vea jam dol 20up vea error vea leang jab auto"* (Auto-center works, but when reaching 20s up, it errors / pauses and stops auto-centering).
- **Root Cause**:
  1. *Premature Clip End on Video Track*: The video track contained a single video clip truncated at 00:20s. When playback reached 20s, `useVideoPlayback.js` hit the "Last clip reached" branch, forced `v.pause()`, set `isPlaying = false`, and clamped `currentTime = 20s`.
  2. *Frozen Animation Loop on Pause*: Because `isPlaying` became `false`, the 60FPS RAF auto-follow loop terminated immediately.
  3. *Unprotected RAF Loop*: Any sub-frame calculation anomaly when time was outside videoClips risked crashing the requestAnimationFrame callback.
  4. *Stale Duration Clamping in Reset*: `handleResetFullVideo` and `useSeriesManager.js` relied on `duration || 0` which was cached as 20s instead of reading `scriptData.segments` max duration (1200s) or `videoRef.current.duration`.

### Resolution
1. **Frontend Reactive Auto-Heal (`TimelineEditor.jsx`)**:
   - Added an auto-heal effect: whenever `videoClips` has 1 uncut clip ending prematurely (`end < totalDuration - 5` while `totalDuration > 60s`), it immediately stretches the clip to cover `totalDuration` (1200s / 20mn).
2. **Safe 60FPS RAF Playhead Loop (`TimelineEditor.jsx`)**:
   - Wrapped `updatePlayheadAndScroll` inner body in `try...catch` so an unexpected coordinate calculation can never crash or terminate the animation frame loop.
3. **Seamless Multi-Minute Flow (`useVideoPlayback.js`)**:
   - Replaced strict `sEnd` clamp with `trueMaxDur = Math.max(v.duration, duration, realDur)` to allow playback to flow continuously past 20s across the full 20:00mn media.
4. **Full Duration Recalculation (`useClipOperations.js`, `useSeriesManager.js`)**:
   - `handleResetFullVideo` and `selectEpisode` compute `scriptMaxEnd = Math.max(...segments.endSec)` to guarantee `totalDur` is always the true 1200s.

### Verification
- `npm --prefix frontend run build` ➔ PASS (604ms).
- `node --test backend/tests/timeline_*.test.js` ➔ 10/10 PASS.

## Previous Update: Persistent Auto-Center Playhead (Always Remember & Wheel Decoupled)

### Problem Description
- **Symptom**: User asked *"ot vea ot jam auto nv center jg?"* (Why doesn't it remember/stay auto at center?).
- **Root Cause**:
  1. *Aggressive Wheel Disabling*: `TimelineEditor.jsx` had a `handleTimelineWheel` callback on the scrollable container that set `setAutoCenter(false)` whenever the user scrolled horizontally with mouse wheel or touchpad. This silently turned off Auto-Center during normal timeline inspection.
  2. *Lack of Persistence*: `autoCenter` was stored only in local React state (`useState(true)`) without saving to `localStorage`. Page refreshes or unmounts lost the state.

### Resolution
1. **Persistent LocalStorage State (`TimelineEditor.jsx`)**:
   - Initialized `autoCenter` from `localStorage.getItem('TIMELINE_AUTO_CENTER')` (defaulting to `true`).
   - Synced changes automatically to `localStorage.setItem('TIMELINE_AUTO_CENTER', String(autoCenter))`.
2. **Decoupled Horizontal Wheel from Auto-Center**:
   - Removed `handleTimelineWheel` which prematurely killed `autoCenter`.
   - Users can now scroll horizontally to inspect without losing Auto-Center mode. When seeking, clicking a clip, or pressing play, the timeline automatically centers and follows the playhead.
3. **Explicit Toggle via Locate Button**:
   - The Locate/Target button in `TimelineToolbar.jsx` remains the single, explicit toggle for turning Auto-Center ON or OFF.

### Verification
- `npm --prefix frontend run build` ➔ PASS (686ms).
- `node --test backend/tests/*.test.js` ➔ 85/85 PASS (0 failed, 1 skipped).

## Previous Update: Auto-Heal Truncated Video Track to Full Episode Duration

### Problem Description
- **Symptom**: In EP2 (duration 20:00mn / 1200s), audio dialogue clips stretched all the way to 20mn, but the VIDEO track clip (`8958_EP2.mp4`) ended prematurely at 00:20s, leaving the video track empty/black from 00:20s to 20:00mn.
- **Root Cause**:
  - If a workspace had a cached or trimmed single video clip of 20-30s in `localStorage`, `normalizeClips` and episode initialization preserved the clip without auto-stretching it to match the true episode duration (`epDur` = 1200s).

### Resolution
1. **Auto-Heal on Episode Load & Workspace Init**:
   - In `useSeriesManager.js` and `useWorkspaceMedia.js`, added an auto-heal guard: if an episode has only 1 video clip starting at 0, and its duration is truncated (`end < epDur - 5s`), it automatically heals and stretches the clip to cover the full episode duration (`epDur = 1200s`).
2. **Explicit Toolbar Restore**:
   - Reminded user of the `[ Full Video ]` toolbar button which immediately recalculates `totalDur` (1200s) and restores the video track to full continuous length.

### Verification
- `npm --prefix frontend run build` ➔ PASS (1.56s).
- `node --test backend/tests/timeline_*.test.js` ➔ 10/10 PASS.

## Latest Update: True Center Auto-Follow Playhead (CapCut / Premiere Style)

### Problem Description
- **Symptom**: User saw the Auto-Center button enabled (active cyan), but the playhead remained stuck at ~00:14 on the far right of the timeline instead of staying centered in the middle (~00:08).
- **Root Cause**:
  1. *Paused / Seek Effect*: `TimelineEditor.jsx` had a strict `if (isOutOfView)` check (`currentScreenX < 30 || currentScreenX > clientWidth - 40`). When paused at 00:14, the playhead was still technically on screen, so `isOutOfView` evaluated to `false` and refused to center the playhead!
  2. *Playback Loop*: RAF playback scroll loop used `rightThreshold = clientWidth - 120` and paged forward to `clientWidth * 0.30` (30% from the left, instead of 50% Center).
  3. *Locate Fixed Button*: Clicking the Auto-Center button only called `handleCenterPlayhead` without toggling or allowing free inspection when scrolling manually.

### Resolution
1. **Paused / Seek / Clip Selection Auto-Center**:
   - In `TimelineEditor.jsx`, removed the restrictive `isOutOfView` check. When `autoCenter` is enabled and the video is paused, seeking, or a segment is clicked, the timeline smoothly scrolls to center the playhead at 50% viewport width (`(currentTime * pps + TRACK_HEADER_WIDTH) - clientWidth / 2`).
2. **Playback Center Follow (Center Lock)**:
   - When `autoCenter` is enabled during playback, once the playhead crosses the horizontal center (`screenX > rightThreshold` where `rightThreshold = clientWidth / 2`), the timeline smoothly scrolls underneath it, keeping the playhead centered at 50% width.
3. **Smart User Inspection & Toggle**:
   - Added `handleTimelineWheel`: When the user deliberately scrolls horizontally (wheel / trackpad) to inspect other clips, `autoCenter` safely disables (`false`) so the viewport doesn't fight the user.
   - Clicking the Locate button (`handleCenterPlayhead`) instantly re-centers to the playhead and re-enables `autoCenter = true` (or toggles off if already centered).
   - Updated tooltip in `TimelineToolbar.jsx`.

### Verification
- `node --test backend/tests/timeline_*.test.js` ➔ 10/10 PASS.
- `npm --prefix frontend run build` ➔ Clean build in 1.45s.

## Latest Update: Unlimited Voice Lanes & Dynamic Vertical Drop

### Implementation Highlights
1. **Dynamic Lane Count Calculation**:
   - `voiceLaneCount = Math.max(2, highestUsedVoiceRow + 2, userVoiceTrackCount || 1, draggingVoiceTargetRow + 1)`.
   - Formula ensures all used voice lanes are rendered plus ONE always-empty drop lane at the bottom.
   - Removed `Math.min(1, ...)` and `Math.min(2, ...)` clamps in `TimelineEditor.jsx`, `TimelineTracksCanvas.jsx`, `TimelineTrackHeaders.jsx`, and `timelineUtils.js` — a segment's `trackRow` can now be any integer $\ge 0$.
2. **Vertical Drop & Track Creation**:
   - Dragging a voice clip down to lane $N$ assigns `seg.trackRow = N`, `seg.trackId = 'voice-' + (N + 1)`, and `seg.userShifted = true`.
   - The drop always succeeds and never snaps back to the original lane.
   - Dropping onto the bottom empty lane immediately turns it into the used lane and spawns a new empty lane below it on the next render.
   - Drag-over highlight badges dynamically show `"Drop to create VOICE {n}"` when hovering an empty/new lane, and `"Drop to place on VOICE {n}"` for existing lanes.
3. **Sticky Manual Placement in Auto-Align**:
   - In `autoAlignVoiceSegments` (`timelineUtils.js`), segments with `userShifted: true` preserve their exact `trackRow` without being renumbered or shifted up to empty lanes.
   - Non-userShifted segments continue packing across lanes 0 and 1.
4. **Cross-Lane Drop Stand (Requirement 4)**:
   - When dropping across lanes (`curSegRow !== finalTargetRow`), the drop stands at the dropped position even if it overlaps an existing clip on the target lane.
   - Horizontal time-clamping and magnetic edge snapping (`||`) remain active when moving horizontally within the same lane.
5. **Full Playback, Mix & Export Support**:
   - `VideoPlayerPreview.jsx` and `ffmpegService.js` iterate through all valid segments regardless of `trackRow`, ensuring audio from lanes $\ge 2$ is never silenced or omitted.
   - Verified persistence round-trip of `trackRow` and `userShifted` on EP2.

### Verification & Automated Tests
- `backend/tests/timeline_unlimited_voice_lanes.test.js` ➔ 5 passed, 0 failed.
- Full regression suite (16 tests across all timeline & split modules) ➔ 16 passed, 0 failed.
- Vite build (`npm --prefix frontend run build`) ➔ SUCCESS (1.37s).

## Latest Update: Regenerate Audio on Split Segment Audio Offset Reset & Zero-Playback Guard

### Problem Description
- **Symptom**: After splitting a segment on the timeline, Segment #2 was assigned an `audioOffset` (e.g. `3.83`s) to slice from the parent's audio file.
- When Nha clicked "Generate ឡើងវិញ" (regenerate audio) on Segment #2, a fresh TTS audio file (`ep_ep_2_seg_2_...mp3`, duration `3.672`s) was generated starting from `0.00`s.
- However, neither `useAudioDubbing.js`, `audioRoutes.js`, nor `ttsService.js` reset `audioOffset: 0` or `audioTrimmed: false`.
- As a result:
  1. `VideoPlayerPreview.jsx` sought the player to `3.83s` inside a `3.672s` file, immediately hitting EOF and pausing into complete silence.
  2. `createSynchronizedNarrationAudio` in `ffmpegService.js` ran `atrim=start=3.83:duration=3.672`, generating 0 bytes of narration audio.
  3. Video export also trimmed starting from `3.83s`, rendering silent audio in the final exported video.

### Root Cause & Resolution
1. **Reset on Regeneration (`backend/services/ttsService.js`)**:
   - In `generateSingleSegmentAudio`, explicitly reset `audioOffset: 0`, `audioTrimmed: false`, `userTrimmed: false`.
2. **Backend Route Persistence (`backend/routes/audioRoutes.js`)**:
   - In `series.json` update handler, persist `audioOffset: 0, audioTrimmed: false, userTrimmed: false` for the updated segment.
3. **Frontend Dubbing Hook (`frontend/src/hooks/useAudioDubbing.js`)**:
   - In `handleRegenerateSingleSegment`, `handleAutoRegenerateSegmentAudio`, and `handleChangeSpeed`, explicitly set `audioOffset: 0, audioTrimmed: false, userTrimmed: false` on the merged segment.
4. **Defensive Player & FFmpeg Clamping (`frontend/src/components/VideoPlayerPreview.jsx`, `backend/services/ffmpegService.js`)**:
   - If `audioOffset >= audioDurationSec`, defensively clamp `audioOffset` to `0` so stale/corrupted offset data can never cause silent playback or trimmed empty audio in player or export.
5. **Project EP2 Data Fixed & Master Narration Resynced**:
   - Updated `backend/uploads/projects/series_1793898268958/series.json` EP2 Segment #2 with `audioOffset: 0`, `audioTrimmed: false`.
   - Successfully re-synced `ep_2_narration_khmer.mp3` with all 502 segments.

### Verification & Tests
- `backend/tests/regenerate_split_audio_offset_reset.test.js` ➔ 3 passed, 0 failed.
- `npm --prefix frontend run build` ➔ Vite build succeeded in 1.40s.

## Latest Update: Strict Audio No-Overlap Clamp & Magnetic Edge Snapping on Timeline Tracks

### Feature: Audio Dragging Strict No-Overlap Clamp (`[#1] || [#2]`)
- **Problem**: When dragging audio clips horizontally on the same line (Track Row 0), moving a clip near an adjacent clip allowed it to slide directly over/into the neighboring clip (visual overlap bug shown in user screenshot #1).
- **Solution**:
  1. **Strict No-Overlap Clamp**: Added `prevBound` (max end of predecessor clips on same row) and `nextBound` (min start of successor clips on same row). When dragging, `newStart` is clamped to `Math.max(prevBound, newStart)` and `newEnd` is clamped to `Math.min(nextBound, newEnd)` — preventing overlap completely! Clips rigidly meet edge-to-edge (`||`) as requested by Nha (screenshot #2).
  2. **Magnetic Edge Snapping**: When a dragged audio clip approaches `prevBound` or `nextBound` within snap window (~0.15s), it magnetically snaps to the adjacent clip's edge and renders the vertical snap line.
  3. **Trimming Guard**: `trim-left` cannot expand past `prevBound`; `trim-right` cannot expand past `nextBound`.
  4. **Drop Persistence**: On mouse up, `updatedSeg` clamps to `finalTargetRow` boundaries before firing `onUpdateSegments`.

### Hotfix: ClipInspectorPanel `isKhmerEmpty` ReferenceError Resolved
- **Problem**: When rendering `<ClipInspectorPanel>`, `isKhmerEmpty` was evaluated at line 726/780/817 before being declared in component scope, triggering `Uncaught ReferenceError: isKhmerEmpty is not defined`.
- **Fix**: Declared `const isKhmerEmpty = !localKhmerText?.trim();` at top of component body (line 258) alongside other status derivations (`isGenerating`, `isError`, etc.). Build and unit tests pass.

### 1. STEP 0 — Data Confirmation & Field Comparison Table (EP2 Segments #1 and #2)

| Field | Segment #1 (`id: 1`) | Segment #2 (`id: 2`) | Description / Analysis |
|---|---|---|---|
| `startSec` | `0.2` | `4.027` | Original slot start time from OCR/script |
| `endSec` | `4.027` | `4.83` | Original slot end time (3.827s slot) |
| `audioStartSec` | `0.2` | `4.027` | Render start position |
| `audioEndSec` | `4.027` | `4.83` | Old handler timing ended here (unexpanded slot end) |
| `audioDurationSec` | `3.83` | `0.80` | Nominal slot duration |
| `finalAudioDuration` | `4.63` | `4.63` | **Real generated TTS audio length (+0.80s OVER)** |
| **Canvas Right Edge** | **`4.83`s** (`max(slotEnd, start + dur)`) | **`8.657`s** (`max(slotEnd, start + dur)`) | Rendered on `TimelineTracksCanvas.jsx` per 5f6fb6b truthful fix |
| **Old `isInsideSeg` End** | **`4.027`s** (`audioEndSec`) | **`4.83`s** (`audioEndSec`) | Derived from `audioEndSec` in `useClipOperations.js` |
| **Playhead at `00:04.03`** | **Visibly INSIDE (4.03 < 4.83)** | Outside (before 4.077 seam) | **Handler saw playhead as OUTSIDE (4.03 > 3.977)** ➔ Disagreement! |

**Conclusion:** Canvas right edge (`4.83s`) and old handler timing (`4.027s`) differed by `0.803s`. When the user parked the playhead at `00:04.03` inside the visible clip, old `isInsideSeg` failed because `4.03 > 4.027 - 0.05` (`3.977s`), causing all split branches (a), (b), (c), and (d) to miss and no-op silently.

---

### 2. Implementation Summary

1. **STEP 1 — One Canonical Timing (`frontend/src/hooks/useClipOperations.js`)**:
   - Reused canonical `getSegmentAudioDuration` from `../utils/timestampUtils`.
   - Updated `getSegTiming` to calculate:
     ```javascript
     effectiveEnd = isTrimmed && typeof s.audioEndSec === 'number'
       ? s.audioEndSec
       : Math.max(slotEnd, effectiveStart + getSegmentAudioDuration(s, 0), s.audioEndSec || 0)
     ```
     This matches `TimelineTracksCanvas.jsx` exactly.
   - Used `effectiveStart` and `effectiveEnd` in `isInsideSeg` and in `executeSplitSegment` math (`dur1`, `dur2`, `audioOffset`, and text splitting ratio).
   - Ensured split segments (`seg1` and `seg2`) persist `audioDurationSec`, `finalAudioDuration`, `audioDuration`, `originalAudioDuration`, `rawAudioDur`, and `audioTrimmed: true` so the canvas immediately renders them with exact boundaries and no spurious overflow.

2. **STEP 2 — No Silent No-Op (In-App Toast & Console Diagnostic)**:
   - When `handleSplitClip` is invoked and no branch matches (no voice segment, no video clip at playhead):
     - Displays brief in-app toast in Khmer: `"គ្មាន clip នៅត្រង់ playhead ទេ — ដាក់ playhead ឲ្យនៅកណ្ដាល clip"`.
     - Calculates nearest previous segment and nearest next segment boundaries and logs full diagnostic info via `console.warn`.

3. **STEP 3 — Seam Tolerance for Explicitly Selected Segment**:
   - In branch (a), relaxed the end boundary guard to `roundedSplit < effectiveEnd` (dropped the `-0.05` margin), enabling users who selected a clip to split anywhere visibly inside it up to the right seam.
   - Preserved `±0.05s` safety margin (`roundedSplit < effectiveEnd - 0.05`) in fallback branch (c) for unselected intersecting segments.

---

### 3. Verification & Evidence

- **New Automated Unit Suite (`backend/tests/split_canonical_timing_ep2.test.js`)**:
  - `node --test backend/tests/split_canonical_timing_ep2.test.js` ➔ **3 passed, 0 failed**:
    1. Real EP2 data dump & canonical effective timing verification (`canvasRightEdge1 === 4.83`).
    2. `useClipOperations` static code audit for canonical imports, Khmer toast string, and relaxed branch (a) seam guard.
    3. Simulated split of EP2 Segment #1 at `00:04.03`: cuts Segment #1 into `[0.2, 4.03]` and `[4.03, 4.83]` while keeping video clips completely untouched; verified Undo snapshot restoration; verified gap rejection.
- **Existing Split Suite**:
  - `node --test backend/tests/split_clip_selection_priority.test.js` ➔ **3 passed, 0 failed**.
- **Full Backend Test Suite**:
  - `node --test backend/tests/*.test.js` ➔ **76 tests: 75 passed, 1 skipped (test video not present), 0 failed** (12.1s).
- **Frontend Production Build**:
  - `npm --prefix frontend run build` ➔ **PASS in 861ms** (0 errors).

---

### 4. Active Environment
- **Backend API**: `http://localhost:5000` (Node.js/Express)
- **Frontend Studio UI**: `http://localhost:5173` (React 19 + Vite)
- **Git Branch**: `main`

---

### 5. Next Steps
- Open Studio UI on EP2 at `http://localhost:5173`.
- Select voice clip #1, position playhead at `00:04.03`, and click Split (or press Ctrl+B): observe instant clean cut into two speech segments without affecting video track.
