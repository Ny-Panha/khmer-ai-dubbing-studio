# Project State Sync

- **Last Session**: Antigravity IDE (`2026-11-28`)
- **Active Branch**: `chore/full-project-cleanup`

## Summary
- **Added Player Playback Speed `1x / 2x / 3x / 4x` (`2026-11-28`)**:
  - Updated [useVideoPlayback.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useVideoPlayback.js), [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx), [VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/VideoPlayerPreview.jsx), and [PlayerControls.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/PlayerControls.jsx) with persisted `1x / 2x / 3x / 4x` speed buttons right beside the `Auto` toggle, preserved across episode switches & Auto-Next EP (`usePlayerAudioSync.js` + `webAudioScheduler.js` follow `v.playbackRate` in sync).
- **Added Auto-Next Episode Playback (`2026-11-28`)**:
  - Updated [useVideoPlayback.js](file:///e:/khmer_ai_dubbing_studio/frontend/src/hooks/useVideoPlayback.js) with `finishPlaybackAtEnd`, `onEpisodeEnded`, and `armAutoPlayNextEpisode` across physical media end, multi-clip end, and native `<video onEnded>`.
  - Wired persisted `autoNextEpisode` (`kads_auto_next_episode`, default `true`) + `handleEpisodePlaybackEnded` in [App.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/App.jsx), [VideoPlayerPreview.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/VideoPlayerPreview.jsx), and [PlayerControls.jsx](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/player/PlayerControls.jsx) (`Auto` toggle next to Play/Pause).
- **Completed P0 — Remove Hardcoded Character Data & Prevent Stale Character Memory**:
  - Removed all story-specific character names/IDs/aliases (`ស៊ូ មីង`, `លីន ហ្វាង`, `មេឃុំ`, `ម្តាយ ស៊ូ`, `លោកគ្រូពេទ្យ ចាង`, `char_ស៊ូ_មីង`, `苏铭`, `李天维 男主`, `灵虚圣地主峰讲坛`, etc.) from production prompts and files (`speakerIdentificationService.js`, `stage3VisionBatchRunner.js`, `stage6_generateModeSpecificScript.js`, `speakerRegistry.js`).
  - Separated `voiceGenderConfidence`, `characterIdentityConfidence`, `characterNameConfidence`, and `hasVerifiedName` in `speakerIdentificationService.js`; prevented fabricating personal character names from male/female voice detection alone; minted stable unnamed IDs (`char_unnamed_<gender>_<hash>`, `spk_unnamed_<gender>_<hash>`) via `buildStableUnnamedIds` without polluting `seriesSpeakerMap` or `glossary.characters`.
  - Added cross-series guard in `buildKnownCastIndex` and `buildVerifiedSeriesSpeakerMapPatch` (`seriesId` check + verified name requirement + unverified confidence guard).
  - Updated `chunkOrchestrator.js` cache key & metadata validation to verify `seriesId`, `episodeId`, `videoSignature`, `CHARACTER_RECOGNITION_VERSION`, and `computeSeriesRegistryRevision`, leaving Stage 3 OCR caches intact.
  - Added **`Rescan Characters`** backend (`rescanEpisodeOrSeriesCharacters` + `POST /api/dubbing/rescan-characters`) & frontend Cast Voices buttons (`VoiceSettings.jsx` + `useAudioDubbing.js` + `pipelineApi.js` + `App.jsx`) preserving original Chinese subtitles, Khmer translations, immutable `sourceCueId`, timeline positions, `manualCharacterOverridden` overrides, and existing TTS MP3s wherever `voiceId` stays unchanged.
  - Verified against real source video (`ss2` `ep_1`, 97 cues): cleared contaminated names (`ស៊ូ មីង`, `ដើមឈើបាច`, `តាប្រាក់`), preserved 97/97 Chinese/Khmer subtitles & timeline timestamps, preserved 85/97 unchanged-voice MP3s while marking 12 voice-changed segments outdated, and verified empty registry init & cold reload isolation.
- **Earlier Same-Day Fixes**:
  - `stage9_generateSegmentTTS.js` + `ttsService.js`: Fixed edge-tts `1 segments failed TTS synthesis`.
  - `VoiceSettings.jsx`: Fixed duplicate React key (`spk_male_ប្រព័ន្ធ`).
  - `waveformCache.js` + Timeline components: Enabled real Clean BGM track waveform.
  - `CornerMaskOverlay.jsx` + `ExportSettingsPanel.jsx` + FFmpeg filters: Enabled Free Move corner mask drag/resize + FFmpeg parity.

## Active Environment
- **Backend API**: `http://localhost:5000`
- **Frontend Studio**: `http://localhost:5175`

## Next Steps
- Inspect Cast Voices UI for `ss2` on `http://localhost:5175` if desired (`ស្កេនតួអង្គឡើងវិញ` / `ស្កេនរឿងទាំងមូល`), and decide when ready to commit & push `chore/full-project-cleanup`.
