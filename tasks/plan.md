# Implementation Plan: Diagnose & Fix Voice/Khmer Subtitle Timing Mismatch vs CN Cues

## Overview
Resolve the timing mismatch between audio voice clips, Khmer subtitles, and burned-in Chinese video cues in `khmer-ai-dubbing-studio`.
Diagnosis of segment window 00:39-00:48 on Episode 2 (`series_1793898268958`) revealed a dual root cause:
1. **DATA Layer (Stage 5 Reconciliation)**: The Reconcile stage merged distinct visual OCR cues across speaker and text boundaries into bloated ASR blocks (swallowing "老子要" [40.0-41.25] and "你凭什么" [41.25-42.5] into Segment #17, and swallowing "凭什么" [43.75-45.0] and "凭他是老子的崽" [45.0-46.25] into Segment #19).
2. **PIPELINE / DATA Layer (Stage 9 TTS Re-use)**: When reusing existing audio files, `stage9_generateSegmentTTS.js` omitted `getMediaDuration()`, leaving `audioDurationSec` set to the inherited slot duration (3.69s) rather than the true MP3 duration (1.872s).
3. **RENDER Layer (`TimelineTracksCanvas` & `VideoPlayerPreview`)**: Voice clip box end, waveform bounds, and OVER badge (`+1.1s`) derived width and offsets from bloated duration fields instead of the real audio duration.

## Architecture Decisions
- **Decision 1 (Stage 5 Boundary Enforcement)**: In `stage5_reconcileTimelineEvidence.js`, visual OCR cue boundaries are primary anchors. A segment must NEVER cross an OCR cue boundary where the cue text or speaker changes. Long ASR sentences must be partitioned across the intersecting visual cues rather than expanding a visual cue to swallow adjacent cues.
- **Decision 2 (Stage 9 Audio Integrity)**: In `stage9_generateSegmentTTS.js`, whenever existing audio is reused (`canReuseExisting`), always probe the true media duration via `getMediaDuration` to guarantee `audioDurationSec` and `finalAudioDuration` reflect exact MP3 duration.
- **Decision 3 (Render Normalization & Waveform Alignment)**:
  - Voice clip box = `[audioStartSec, max(slotEnd, audioStartSec + realAudioDuration)]`
  - Waveform peaks inside the voice clip box must be mapped to `realAudioDuration` (or if box extends to slotEnd, the waveform only spans the actual audio duration portion with zero stretching).
  - Subtitle clip = segment's own `[startSec, endSec]`.
- **Decision 4 (OVER Truthfulness)**:
  - OVER badge must strictly equal `realAudioDuration - (endSec - startSec)`. If `realAudioDuration <= slotDur`, no positive OVER badge is rendered.

## Task List & Checkpoints

### Phase 1: Step 1 Dump & Analysis
- [x] Dump numbers for segments #16-#20 from stored episode data.
- [x] Dump raw OCR visual cue list for window 00:39 - 00:48.
- [x] Classify layer fault: Confirmed **Branch (A) DATA** (OCR cue swallowing) + **Branch (B) RENDER** (waveform & duration derivation).

### Phase 2: Pipeline Fixes (Step 2A)
- [ ] Task 1: Update `stage5_reconcileTimelineEvidence.js` to ensure visual OCR cue boundaries are never swallowed by ASR blocks.
- [ ] Task 2: Update `stage9_generateSegmentTTS.js` so `canReuseExisting` always probes true audio duration via `getMediaDuration`.

### Phase 3: Render Fixes & Truthful OVER Badge (Step 2B & Step 3)
- [ ] Task 3: In `TimelineTracksCanvas.jsx` and `VideoPlayerPreview.jsx`, ensure voice box = `[audioStartSec, max(slotEnd, audioStartSec + realAudioDuration)]` and waveform bars map to `realAudioDuration`.
- [ ] Task 4: In `TimelineTracksCanvas.jsx`, unify OVER badge formula: `realAudioDuration - (slotEnd - slotStart)`.
- [ ] Task 5: Retime / synchronize Episode 2 data so segments #16-#20 reflect true cues and real audio duration.

### Phase 4: Verification, State Sync & Commit
- [ ] Checkpoint: Play 00:39 -> 00:48 in browser. Verify subtitle matches CN cue changes, waveform fills box correctly, and no artificial collision stacking occurs.
- [ ] Update `.agents/STATE.md`.
- [ ] Git commit and push to `origin/main`.
