# Implementation Plan

## Overview

This task list implements the speaker assignment accuracy fix for the Dragon Dub system. The implementation follows test-first methodology to address 5 bug conditions causing 24 incorrect speaker assignments while protecting 296 correct assignments from regressions.

**Current Status**: 296/320 correct (92.50%), 24 incorrect, 0 unresolved  
**Target**: ≥310/320 correct (96.88%+), 0 regressions  
**Baseline Commit**: a29205729ee518c3ec14f1fcfab19f92eda1f15f

**Bug Conditions Being Fixed**:
1. Generic identity gender inheritance from series maps
2. Character vs voice actor confusion (character gender overriding timbre)
3. Speaker change detection failures
4. Ground truth validation gaps
5. Specialized voice detection issues (distorted, screaming, short clips, off-screen)

**Implementation Strategy**: Write failing tests first (exploration + preservation), implement targeted fixes to speaker identification logic, verify all tests pass, run full benchmark validation.

## Tasks

- [x] 1. Write bug condition exploration tests (BEFORE implementing fix)
  - **Property 1: Bug Condition** - Speaker Assignment Accuracy Bugs
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples demonstrating the 5 bug conditions exist
  - Create `backend/tests/bugfix_speaker_assignment_exploration.test.js`
  - Write 24 failing test cases covering all 5 bug conditions:
    - **Bug Condition 1 (Generic Identity)**: 3 tests for `ប្រព័ន្ធ` inheriting wrong gender from series map
    - **Bug Condition 2 (Character-Voice)**: 3 tests for character gender overriding voice actor timbre
    - **Bug Condition 3 (Speaker Change)**: 3 tests for consecutive cues missing speaker transitions
    - **Bug Condition 4 (Ground Truth)**: 2 tests for acoustic accuracy vs frozen GT mismatch
    - **Bug Condition 5 (Specialized Voice)**: 4 tests for distorted/screaming/short/off-screen audio
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bugs exist)
  - Document counterexamples found to understand root causes
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Protect 296 Correct Assignments
  - **IMPORTANT**: Follow observation-first methodology
  - Create `backend/tests/bugfix_speaker_assignment_preservation.test.js`
  - Load actual benchmark data for 296 currently correct assignments
  - Write property-based test verifying each correct assignment remains unchanged
  - Test coverage:
    - Gender assignment preservation (296 cues)
    - Speaker ID consistency (recurring characters)
    - Voice ID mapping (TTS voice selection)
    - Cross-episode consistency (`ស៊ូ មីង`, `ប្រព័ន្ធ`)
    - Performance characteristics (<1500ms voice switch)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.10, 3.11, 3.12, 3.13_

- [ ] 3. Fix speaker assignment accuracy bugs

  - [x] 3.1 Add generic identity detection helper function
    - Add `isGenericSpeakerName(speakerName)` function to `backend/models/speakerRegistry.js`
    - Detect generic/broadcast identities: `ប្រព័ន្ធ`, system keywords (系统, 恭喜玩家, 规则警告), narrator patterns
    - Return true for transient broadcast identities, false for recurring character names
    - Add unit tests for generic detection logic
    - _Bug_Condition: isBugCondition_GenericInheritance from design_
    - _Expected_Behavior: Property 1 - Generic identities classified by in-scene acoustic evidence_
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Reorder priority: voice actor timbre BEFORE visual gender
    - Modify `detectSpeakerGender` function in `backend/models/speakerRegistry.js`
    - Move `voiceGender` / `castGender` check to Priority 1 (before `visualGender`)
    - Downgrade `visualGender` to Priority 2 (only when no explicit voice timbre)
    - Add voice-character mismatch detection:
      - Set `voiceActorTimbre`: detected gender from voice
      - Set `characterGender`: visual/name-based gender
      - Set `voiceCharacterMismatch`: true when they differ
    - Preserve voice actor timbre as final classification
    - _Bug_Condition: isBugCondition_CharacterConfusion from design_
    - _Expected_Behavior: Property 2 - Voice actor timbre priority over character gender_
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 3.3 Exempt generic identities from series map inheritance
    - Modify `syncSegmentsWithSpeakerRegistry` in `backend/models/speakerRegistry.js`
    - Before applying `seriesSpeakerMap` gender, check `if (isGenericSpeakerName(segment.speaker))`
    - For generic identities: skip series map lookup, rely on per-cue multimodal verification
    - For recurring characters: continue applying series map for consistency
    - Add speaker change detection metadata:
      - Track `prevSegmentSpeaker` and `prevSegmentGender` during iteration
      - Set `speakerChangeDetected: true` when speaker/gender differs from previous
    - _Bug_Condition: isBugCondition_GenericInheritance, isBugCondition_ChangeDetectionFailure_
    - _Expected_Behavior: Property 1 - Generic identity isolation, Property 3 - Speaker change detection_
    - _Preservation: Recurring character consistency from design_
    - _Requirements: 2.1, 2.2, 2.6, 2.7_

  - [x] 3.4 Enhance voice actor timbre instructions in verification prompt
    - Modify `buildVerificationPrompt` in `backend/services/pipeline/speakerIdentificationService.js`
    - Add explicit rule: "PRIORITY: Classify by voice actor acoustic timbre, NOT character identity"
    - Add examples:
      - "Female actress voicing boy character → classify FEMALE (voice actor)"
      - "Male actor voicing female character for comedy → classify MALE (voice actor)"
    - Emphasize three metadata dimensions:
      - **Character gender**: Visual appearance, name, role
      - **Voice actor timbre**: Actual acoustic frequency/formants/breathiness
      - **Dubbing voice**: Target TTS voice (always uses voice actor timbre)
    - _Bug_Condition: isBugCondition_CharacterConfusion from design_
    - _Expected_Behavior: Property 2 - Voice actor timbre priority_
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 3.5 Add generic identity classification rule to prompt
    - Modify `buildVerificationPrompt` in `backend/services/pipeline/speakerIdentificationService.js`
    - Add instruction: "For generic/broadcast identities (系统, ប្រព័ន្ធ, narrator, announcer), determine gender from CURRENT SCENE voice timbre, ignore cached speaker map"
    - Add flag in prompt data indicating which cues are generic identities
    - Request explicit acoustic reasoning in response for generic identities
    - _Bug_Condition: isBugCondition_GenericInheritance from design_
    - _Expected_Behavior: Property 1 - Generic identity in-scene classification_
    - _Requirements: 2.1, 2.2_

  - [x] 3.6 Add speaker change detection instructions to prompt
    - Modify `buildVerificationPrompt` in `backend/services/pipeline/speakerIdentificationService.js`
    - Add rule: "Between consecutive cues, detect speaker changes through acoustic shifts (pitch, timbre, voice quality) and visual cues (different face, lip-sync)"
    - Add contextual hint: "In rapid-switching scenes (danmaku, crowd), expect per-line speaker changes"
    - Request explicit continuity/change flag in response
    - _Bug_Condition: isBugCondition_ChangeDetectionFailure from design_
    - _Expected_Behavior: Property 3 - Speaker change detection_
    - _Requirements: 2.6, 2.7_

  - [x] 3.7 Add specialized voice handling guidance to prompt
    - Modify `buildVerificationPrompt` in `backend/services/pipeline/speakerIdentificationService.js`
    - Expand distortion handling: "For reverb/chorus effects, analyze underlying harmonic structure beneath audio processing"
    - Add arousal adjustment: "For screaming/shouting, adjust pitch expectations (male scream 180-220Hz, female scream 250-350Hz)"
    - Add duration warning: "For clips <1.5s, reduce confidence and prioritize context window over isolated acoustic features"
    - Add off-screen audio note: "For phone/intercom, expect compressed frequency range, rely on formant ratios over absolute pitch"
    - Request `review_needed` marking for genuinely ambiguous cases
    - _Bug_Condition: isBugCondition_SpecializedVoiceFailure from design_
    - _Expected_Behavior: Property 5 - Specialized voice handling_
    - _Requirements: 2.10, 2.11, 2.12_

  - [x] 3.8 Add specialized audio characteristics annotation
    - Modify `formatAuxAudioHint` in `backend/services/pipeline/speakerIdentificationService.js`
    - Detect and annotate specialized characteristics:
      - `hasReverb`: IQR > 60Hz with low voicedRatio
      - `hasDistortion`: high harmonic content
      - `isScreaming`: pitch > 220Hz + high energy
      - `isShortDuration`: duration < 1.5s
      - `suspectedOffScreen`: visual `faceCount === 0` + dialogue present
    - Include these flags in `audioHint` object for model reasoning
    - _Bug_Condition: isBugCondition_SpecializedVoiceFailure from design_
    - _Expected_Behavior: Property 5 - Specialized voice handling_
    - _Requirements: 2.10, 2.11, 2.12_

  - [~] 3.9 Add ground truth dispute flagging to focused recheck
    - Modify `buildFocusedRecheckPrompt` in `backend/services/pipeline/speakerIdentificationService.js`
    - For cues marked for recheck, include original ground truth label if available
    - Request explicit comparison: "If acoustic evidence strongly conflicts with provided ground truth, flag as DISPUTED with acoustic reasoning"
    - Return `groundTruthDisputed: true` and `disputeReason` in response
    - _Bug_Condition: isBugCondition_GroundTruthMismatch from design_
    - _Expected_Behavior: Property 4 - Ground truth validation_
    - _Requirements: 2.8, 2.9_

  - [~] 3.10 Add generic identity suspect detection
    - Modify `findSuspectCuesForFocusedRecheck` in `backend/services/pipeline/speakerIdentificationService.js`
    - Add condition: cues with `isGenericSpeakerName(speaker)` AND `assignedFromSeriesMap: true` are suspect
    - Recheck these cues with fresh acoustic+visual analysis
    - _Bug_Condition: isBugCondition_GenericInheritance from design_
    - _Expected_Behavior: Property 1 - Generic identity verification_
    - _Requirements: 2.1, 2.2_

  - [~] 3.11 Add speaker change conflict detection to suspect logic
    - Modify `findSuspectCuesForFocusedRecheck` in `backend/services/pipeline/speakerIdentificationService.js`
    - For consecutive cues with identical speaker but acoustic features suggest change (pitch shift >40Hz, different `acousticGender`), mark as suspect
    - Trigger focused recheck with explicit speaker change detection instruction
    - _Bug_Condition: isBugCondition_ChangeDetectionFailure from design_
    - _Expected_Behavior: Property 3 - Speaker change detection_
    - _Requirements: 2.6, 2.7_

  - [~] 3.12 Exempt generic identities from series map patches
    - Modify `buildVerifiedSeriesSpeakerMapPatch` in `backend/services/pipeline/speakerIdentificationService.js`
    - Skip adding generic identities to series speaker map patches
    - Only update series map for recurring named characters (non-generic)
    - Add comment explaining separation of persistent vs transient identities
    - _Bug_Condition: isBugCondition_GenericInheritance from design_
    - _Expected_Behavior: Property 1 - Generic identity exclusion from series map_
    - _Preservation: Recurring character consistency_
    - _Requirements: 2.1, 2.2, 3.3_

  - [~] 3.13 Add specialized audio feature detection
    - Modify `enrichCuesWithAcousticPitch` in `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js`
    - Calculate additional acoustic features:
      - `pitchVariability`: standard deviation of pitch over time
      - `spectralCentroid`: average frequency weighted by magnitude
      - `harmonicToNoiseRatio`: voice clarity indicator
    - Use these to populate specialized characteristic flags consumed by `formatAuxAudioHint`
    - _Bug_Condition: isBugCondition_SpecializedVoiceFailure from design_
    - _Expected_Behavior: Property 5 - Specialized voice detection_
    - _Requirements: 2.10, 2.11, 2.12_

  - [~] 3.14 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Speaker Assignment Accuracy Fix
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - Run `backend/tests/bugfix_speaker_assignment_exploration.test.js`
    - **EXPECTED OUTCOME**: All 24 tests PASS (confirms bugs are fixed)
    - If any tests fail, debug and iterate on implementation
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

  - [~] 3.15 Verify preservation tests still pass
    - **Property 2: Preservation** - Protect 296 Correct Assignments
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run `backend/tests/bugfix_speaker_assignment_preservation.test.js`
    - **EXPECTED OUTCOME**: All preservation tests PASS (confirms no regressions)
    - Verify 296 correct assignments remain unchanged
    - Verify cross-episode consistency maintained
    - Verify performance characteristics preserved (<1500ms voice switch)
    - If any regressions detected, debug and adjust implementation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.10, 3.11, 3.12, 3.13_

- [ ] 4. Run full benchmark verification

  - [~] 4.1 Process all four benchmark episodes through updated pipeline
    - Run Episode 1 (86 cues): target ≥97.67% (84/86 maintained or improved)
    - Run Episode 4 (71 cues): target ≥95% (68/71+, up from 88.73%)
    - Run Episode 5 (77 cues): target ≥90.91% (70/77 maintained or improved)
    - Run Episode 20 (86 cues): target ≥95% (82/86+, up from 91.86%)
    - Calculate overall accuracy: target ≥310/320 (96.88%+)
    - Verify zero regressions on 296 currently correct assignments
    - Document improvements by bug condition category
    - _Requirements: 3.9, 3.10, 3.11, 3.12_

  - [~] 4.2 Run existing test suite (regression protection)
    - Run all 119 existing tests: `npm test` in backend directory
    - Verify `p0_speaker_id_and_voice_consistency.test.js` (9/9) passes
    - Verify `single_clip_voice_switching.test.js` (3/3) passes with <1500ms latency
    - Verify `proxy_preview.test.js` (4/4) passes
    - If any tests fail, debug and fix without breaking bug fixes
    - _Requirements: 3.6, 3.7, 3.8_

  - [~] 4.3 Real browser verification with Playwright
    - Restart backend server to load updated code: `node backend/server.js`
    - Ensure frontend dev server running: `http://localhost:5173`
    - Run Playwright browser test with 16 male+female clips across all 4 episodes
    - Verify audio plays correctly, no console errors
    - Spot-check fixed assignments audibly match voice timbre
    - Verify waveform caching and smooth audio crossfades working
    - _Requirements: 3.1, 3.2, 3.13_

  - [~] 4.4 Generate final accuracy report
    - Create detailed report comparing baseline vs fixed:
      - Overall accuracy: 296/320 (92.50%) → X/320 (target ≥97%)
      - Bug Condition 1 fixes: Generic identity cases resolved
      - Bug Condition 2 fixes: Character-voice confusion cases resolved
      - Bug Condition 3 fixes: Speaker change detection cases resolved
      - Bug Condition 4 fixes: Ground truth disputes flagged (dual accuracy)
      - Bug Condition 5 fixes: Specialized voice cases improved
      - Regressions: 0/296 (zero regressions requirement)
      - Performance: voice switch latency maintained (<1500ms)
    - Document remaining incorrect assignments (if any) for future work
    - Identify any disputed ground truth labels for review
    - _Requirements: All requirements validated_

- [~] 5. Checkpoint - Ensure all tests pass and accuracy targets met
  - Ensure all tests pass (exploration + preservation + existing suite)
  - Verify accuracy improvement: ≥310/320 (96.88%+) with zero regressions
  - Verify performance maintained: <1500ms voice switch latency
  - Ask user if questions arise or if further investigation needed


## Notes

**Test-First Methodology**: Tasks 1-2 write failing tests BEFORE implementing fixes (task 3). This confirms bugs exist and establishes regression protection baseline.

**Zero Regression Requirement**: All 296 currently correct assignments MUST remain correct after fixes. Task 2 preservation tests enforce this.

**Targeted Repairs**: Implementation uses targeted modifications to existing multimodal verification pipeline without architectural rewrites:
- `speakerRegistry.js`: Priority reorder, generic identity detection, metadata separation
- `speakerIdentificationService.js`: Prompt enhancements, suspect detection, series map exclusions
- `stage4_analyzeDialogueAudio.js`: Enhanced acoustic feature detection

**Performance Preservation**: Voice switch latency must remain <1500ms (currently 119-154ms). Task 4.2 verifies this.

**Ground Truth Disputes**: Task 3.9 adds dispute flagging for cases where acoustic evidence conflicts with frozen benchmark labels (e.g., Episode 5 Cue #6). These are scored as both "incorrect" (benchmark) and "acoustically correct" (dual accuracy).

**No Hardcoding**: Implementation must generalize to unseen episodes without episode-specific logic. Task 4.1 tests this.

**Real Browser Verification**: Task 4.3 uses Playwright to verify audio playback and spot-check fixed assignments audibly match voice timbre.
