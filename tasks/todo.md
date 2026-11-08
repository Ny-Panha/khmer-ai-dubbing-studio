# Tasks: Diagnose & Fix Voice/Khmer Subtitle Timing Mismatch vs CN Cues

## Checkpoint 1: Step 1 Dump & Layer Fault Classification
- [x] Task 1.1: Extract exact numbers for segments #16-#20 from `series.json` and job data.
- [x] Task 1.2: Extract raw OCR visual cues for 00:39 - 00:48.
- [x] Task 1.3: Document layer fault: Branch (A) DATA (Reconcile merged cues) + Branch (B) RENDER (waveform & duration derivation).

## Checkpoint 2: Step 2A Pipeline Fix (Boundary Enforcement & Audio Integrity)
- [x] Task 2.1: [backend/services/pipeline/stages/stage5_reconcileTimelineEvidence.js] Enforce that visual OCR cue boundaries are never swallowed by ASR blocks when cue text/speaker changes.
- [x] Task 2.2: [backend/services/pipeline/stages/stage9_generateSegmentTTS.js] Ensure `canReuseExisting` audio checks always validate and update `audioDurationSec` using `getMediaDuration`.

## Checkpoint 3: Step 2B & Step 3 Render & OVER Truthfulness Fixes
- [x] Task 3.1: [frontend/src/components/timeline/TimelineTracksCanvas.jsx] Fix voice clip box end = `[audioStartSec, max(slotEnd, audioStartSec + realAudioDuration)]`.
- [x] Task 3.2: [frontend/src/components/timeline/TimelineTracksCanvas.jsx] Map waveform peaks to `realAudioDuration` so no empty tail or artificial stretching occurs.
- [x] Task 3.3: [frontend/src/components/timeline/TimelineTracksCanvas.jsx] Unify OVER badge truthfulness: `realAudioDuration - slotDur`.
- [x] Task 3.4: [frontend/src/components/VideoPlayerPreview.jsx] Apply the same audio clip boundary derivation to keep preview and timeline in 100% agreement.
- [x] Task 3.5: Retime Episode 2 stored segments #16-#20 in `series.json` to reflect true CN cue boundaries and exact MP3 durations.

## Checkpoint 4: Final Acceptance & Git Push
- [x] Task 4.1: Verify preview playback 00:39 -> 00:48 (subtitles change synchronously with CN cues, waveforms fill box, no artificial collision stacking).
- [x] Task 4.2: Run test suite (`node --test backend/tests/*.test.js` & frontend build).
- [x] Task 4.3: Update `.agents/STATE.md`.
- [x] Task 4.4: Git commit, push, and report HEAD + Step 1 numbers table.
