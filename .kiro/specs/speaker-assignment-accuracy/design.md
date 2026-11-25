# Speaker Assignment Accuracy Fix Design

## Overview

This design addresses the remaining 24 incorrect speaker assignments (7.5% error rate) in the Dragon Dub speaker identification system while preserving all 296 correct assignments. The fix targets five systematic bug conditions: generic identity gender inheritance from series maps, character vs voice actor confusion, speaker change detection failures, ground truth validation gaps, and specialized voice detection issues.

The approach uses targeted repairs to the existing multimodal verification pipeline without architectural rewrites, focusing on prompt refinement, metadata separation, and enhanced acoustic+visual reasoning to improve accuracy from 92.50% to target 97%+ while maintaining <1500ms cached voice-switch latency and 1:1 cue mapping.

## Glossary

- **Bug_Condition (C)**: The five conditions triggering incorrect speaker assignments - generic identity inheritance, character/actor confusion, speaker change detection failure, ground truth mismatch, specialized voice detection failure
- **Property (P)**: The desired behavior - accurate gender assignment based on voice actor timbre, proper speaker change detection, independent ground truth validation, accurate specialized voice handling
- **Preservation**: Existing 296 correct assignments, 1:1 cue mapping, <1500ms voice-switch latency, cross-episode consistency
- **speakerIdentificationService.js**: The multimodal verification service that processes cues through visual probe → Gemini API → focused recheck pipeline
- **speakerRegistry.js**: The gender detection and voice assignment service using keyword matching and pronoun analysis
- **Generic Identity**: System/world broadcast identities like `ប្រព័ន្ធ` that should be classified by in-scene acoustic evidence, not cached series map gender
- **Voice Actor Timbre**: The actual acoustic frequency/gender of the person voicing a character, distinct from character gender (e.g., female actress voicing boy character → FEMALE timbre)
- **seriesSpeakerMap**: Cached speaker-to-gender mappings that correctly preserve recurring character consistency but incorrectly pollute generic identities
- **episodicRole**: Temporary crowd/minor characters with gender-qualified IDs (`spk_male_*`, `spk_female_*`) that are correctly isolated from named character majority-vote
- **Focused Recheck**: Selective re-verification of suspect cues (unresolved, conflicts, suspicious `ប្រព័ន្ធ` assignments) using audio-capable fallback models

## Bug Details

### Bug Condition 1: Generic Identity Gender Inheritance

**Trigger:** Generic system/world broadcast identities (e.g., `ប្រព័ន្ធ` "system") receive gender assignments from `seriesSpeakerMap` that persist across all future occurrences regardless of actual in-scene voice timbre.

**Root Cause:** `buildVerifiedSeriesSpeakerMapPatch` and `syncSegmentsWithSpeakerRegistry` apply cached gender from series map to ALL speaker names, including generic identities that should be classified per-scene. The system cannot distinguish between:
- **Recurring characters** (e.g., `ស៊ូ មីង`) where series map consistency is CORRECT
- **Generic identities** (e.g., `ប្រព័ន្ធ`, system announcer) where series map inheritance is INCORRECT

**Formal Specification:**
```
FUNCTION isBugCondition_GenericInheritance(cue, seriesSpeakerMap)
  INPUT: cue with speaker name, seriesSpeakerMap
  OUTPUT: boolean
  
  RETURN isGenericSpeakerName(cue.speaker) 
         AND seriesSpeakerMap[cue.speaker] EXISTS
         AND cue.assignedGender = seriesSpeakerMap[cue.speaker].gender
         AND actualAcousticTimbre(cue) ≠ cue.assignedGender
END FUNCTION
```

**Examples:**
- **Episode 5, Cue #42**: `ប្រព័ន្ធ` assigned FEMALE from series map but actual broadcast voice is MALE narrator (deep, authoritative timbre at ~110-130Hz)
- **Episode 20, Cue #15**: System broadcast "恭喜玩家通关" with female voice actress but assigned MALE from earlier male system announcement cached in series map
- **Episode 4, Cue #58**: World announcement "规则警告" has female voice but inherits MALE from previous male narrator in series map

### Bug Condition 2: Character vs Voice Actor Confusion

**Trigger:** When characters have gender-mismatched voice actors (male child voiced by female actress, female character voiced by male actor for comedy), the system sometimes classifies based on character identity rather than acoustic timbre.

**Root Cause:** `detectSpeakerGender` priority order places `visualGender` (character gender from visual recognition) above `voiceGender` (acoustic timbre). The prompt instruction "classify by voice actor timbre not character gender" is insufficient—the model still assigns character gender when visual confidence is high or when character names strongly suggest gender (e.g., "小鬼" "little ghost boy" → MALE even with 220Hz female voice).

**Formal Specification:**
```
FUNCTION isBugCondition_CharacterConfusion(cue)
  INPUT: cue with character metadata and acoustic features
  OUTPUT: boolean
  
  RETURN characterGender(cue) ≠ voiceActorTimbre(cue)
         AND cue.assignedGender = characterGender(cue)
         AND cue.assignedGender ≠ voiceActorTimbre(cue)
END FUNCTION
```

**Examples:**
- **Episode 5, Cue #6**: "你不要过来啊" voiced by female actress (child ghost character, 230Hz, clear female timbre) but ground truth says MALE due to character being described as boy ghost
- **Episode 20, Cue #51**: "大哥救我" child character (male) voiced by female voice actor (210Hz) but assigned MALE based on visual detection + character name
- **Episode 4, Cue #29**: Small spirit "小鬼" voiced by female actress (high pitch, breathy female voice) but assigned MALE due to "鬼" keyword + visual male character detection

### Bug Condition 3: Speaker Change Detection Failure

**Trigger:** Consecutive phrases with different speakers where the system continues using the previous speaker's gender/identity instead of detecting the actual change.

**Root Cause:** The multimodal prompt provides 3-before/3-after context window for speaker continuity but doesn't explicitly instruct the model to detect speaker changes. When acoustic evidence is ambiguous (crowd scenes, rapid switching, overlapping dialogue), the model assumes speaker continuity from previous cue. The `findSuspectCuesForFocusedRecheck` logic catches some high-precision conflicts but misses gradual gender transitions in multi-turn dialogue.

**Formal Specification:**
```
FUNCTION isBugCondition_ChangeDetectionFailure(cue, prevCue)
  INPUT: current cue and previous cue
  OUTPUT: boolean
  
  RETURN actualSpeaker(cue) ≠ actualSpeaker(prevCue)
         AND cue.assignedSpeaker = prevCue.assignedSpeaker
         AND cue.assignedGender = prevCue.assignedGender
END FUNCTION
```

**Examples:**
- **Episode 5, Cues #34-35**: Dialogue switches from male narrator to female character but #35 continues with MALE assignment despite 240Hz pitch and "她" pronoun
- **Episode 20, Cues #66-67**: Distorted ghost dialogue alternates male/female but both assigned MALE due to speaker continuity assumption
- **Episode 4, Cues #18-19**: Danmaku scrolling comments (crowd scene) with per-line male↔female switches but both assigned same gender

### Bug Condition 4: Ground Truth Validation Gaps

**Trigger:** Frozen benchmark ground truth labels conflict with audible voice timbre in original source media, causing accurate acoustic analysis to be scored as "incorrect."

**Root Cause:** Ground truth was established before voice-actor-timbre methodology was clarified. Some labels reflect character gender or annotator interpretation rather than acoustic timbre. The system has no mechanism to flag disputed ground truth or report dual scores (original benchmark accuracy vs acoustic accuracy).

**Formal Specification:**
```
FUNCTION isBugCondition_GroundTruthMismatch(cue, groundTruth)
  INPUT: cue with assigned gender, ground truth label
  OUTPUT: boolean
  
  RETURN cue.assignedGender = acousticTimbreFromSourceAudio(cue)
         AND cue.assignedGender ≠ groundTruth.gender
         AND groundTruth.gender = characterGender(cue)
END FUNCTION
```

**Examples:**
- **Episode 5, Cue #6**: "你不要过来啊" audibly female-voiced child ghost (230Hz, breathy female timbre) but ground truth says MALE
- **Episode 4, Cue #41**: Female narrator voice (200Hz, clear female characteristics) but ground truth says MALE due to "系统" system identity assumption
- **Episode 20, Cue #73**: Distorted female ghost voice (reverb/chorus on 250Hz base) but ground truth says MALE due to "ghost" character assumption

### Bug Condition 5: Specialized Voice Detection Failures

**Trigger:** Distorted voices (reverb, chorus effects on ghost voices), screaming voices, short exclamations, child voices, or off-screen speakers have reduced accuracy in gender identification.

**Root Cause:** Current acoustic feature extraction (`enrichCuesWithAcousticPitch`) uses simple pitch analysis that is thrown off by:
- **Audio effects**: Reverb/chorus adds harmonics that obscure fundamental frequency
- **High arousal**: Screaming/shouting raises pitch and adds vocal fry, pushing male voices into ambiguous zone
- **Short duration**: <1.5s clips lack sufficient samples for robust F0 estimation
- **Off-screen audio**: Phone calls, intercoms have compressed frequency range from recording effects

The multimodal prompt mentions these cases but doesn't provide sufficient acoustic guidance. The `audioHint` auxiliary data is "clean" (no raw F0 exposure) but doesn't annotate special audio characteristics.

**Formal Specification:**
```
FUNCTION isBugCondition_SpecializedVoiceFailure(cue)
  INPUT: cue with acoustic features
  OUTPUT: boolean
  
  RETURN (hasAudioDistortion(cue) OR isScreaming(cue) OR 
          duration(cue) < 1.5 OR isOffScreen(cue))
         AND cue.assignedGender ≠ underlyingVoiceTimbre(cue)
         AND acousticConfidence(cue) < 0.7
END FUNCTION
```

**Examples:**
- **Episode 20, Cues #66-67, #81-82**: Distorted ghost voices with heavy reverb/chorus effects, assigned incorrectly despite underlying female timbre
- **Episode 5, Cue #23**: Screaming "啊！" (short exclamation, 1.1s duration, high pitch from fear) assigned MALE but actually female voice
- **Episode 4, Cue #55**: Off-screen phone call voice (compressed frequency, muffled) assigned FEMALE but actually male caller
- **Episode 20, Cue #39**: Child voice "妈妈" (1.3s duration, 280Hz child pitch) assigned ambiguous/review_needed but actually identifiable as female child actress

## Expected Behavior

### Correctness Goal

**For all 24 currently incorrect assignments:** Classify based on voice actor acoustic timbre using enhanced multimodal reasoning, metadata separation, and specialized voice handling.

**For all 296 currently correct assignments:** Preserve exact assignments through regression testing and controlled rollout.

### Preservation Requirements (Unchanged Behaviors)

**What Must NOT Change:**

1. **1:1 Cue Mapping**: All 320 source cues map to exactly 320 output segments with zero unresolved
2. **Voice Switch Latency**: Cached clip voice switching remains <1500ms (currently 119-154ms)
3. **Cross-Episode Consistency**: Recurring characters maintain consistent speaker IDs (`spk_ស៊ូ_មីង` → `km-KH-PisethNeural`)
4. **Episodic Role Isolation**: Gender-qualified IDs (`spk_male_*`, `spk_female_*`) continue for episodic/crowd roles
5. **Audio Quality**: 48k-64k bitrate, 3/3 context window, clean `audioHint` auxiliary data
6. **Test Suite**: All 119 tests pass including `p0_speaker_id_and_voice_consistency.test.js` (9/9), `single_clip_voice_switching.test.js` (3/3)
7. **Per-Episode Accuracy**: Maintain or exceed current baselines:
   - Episode 1: ≥97.67% (84/86)
   - Episode 4: ≥88.73% (63/71)
   - Episode 5: ≥90.91% (70/77)
   - Episode 20: ≥91.86% (79/86)
8. **Existing Correct Assignments**: All 296 currently correct assignments remain correct (zero regressions)

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

### 1. Generic Identity Inheritance from Series Map (Bug Condition 1)

**Hypothesis:** `buildVerifiedSeriesSpeakerMapPatch` and `syncSegmentsWithSpeakerRegistry` treat ALL speaker names uniformly, applying series map gender to both recurring characters (where this is correct) and generic identities (where this is incorrect).

**Code Location:** 
- `backend/services/pipeline/speakerIdentificationService.js` lines ~1219+ (`buildVerifiedSeriesSpeakerMapPatch`)
- `backend/models/speakerRegistry.js` lines ~310+ (`syncSegmentsWithSpeakerRegistry`)

**Evidence:** State document notes "excluded episodic roles from `namedScoreTotals` majority-vote collapse" but generic identities still participate in series map inheritance.

### 2. Character Gender Priority Over Voice Actor Timbre (Bug Condition 2)

**Hypothesis:** `detectSpeakerGender` priority order in `speakerRegistry.js` places `visualGender` (Priority 1, confidence ≥0.6) above `voiceGender` (Priority 2), and the multimodal prompt doesn't sufficiently emphasize voice-actor-timbre classification.

**Code Location:**
- `backend/models/speakerRegistry.js` lines ~104+ (`detectSpeakerGender` function)
- `backend/services/pipeline/speakerIdentificationService.js` lines ~334+ (`buildVerificationPrompt`)

**Evidence:** Test file shows `visualGender` with `genderConfidence >= 0.6` returns gender immediately without checking voice timbre.

### 3. Missing Explicit Speaker Change Detection (Bug Condition 3)

**Hypothesis:** The multimodal prompt provides context window for continuity but doesn't explicitly instruct to detect speaker changes. The model assumes speaker persistence when acoustic evidence is ambiguous.

**Code Location:**
- `backend/services/pipeline/speakerIdentificationService.js` lines ~334-404 (`buildVerificationPrompt`)

**Evidence:** Prompt instructions focus on individual cue classification, not transition detection between consecutive cues.

### 4. No Ground Truth Revalidation Mechanism (Bug Condition 4)

**Hypothesis:** The benchmark scoring system compares against frozen ground truth labels without independent validation. No mechanism exists to flag disputed labels or report dual accuracy scores.

**Code Location:**
- Testing infrastructure (benchmark comparison logic)

**Evidence:** State document notes "id=6 is audibly the female-voiced child ghost though frozen benchmark GT says MALE."

### 5. Insufficient Acoustic Analysis for Special Cases (Bug Condition 5)

**Hypothesis:** `enrichCuesWithAcousticPitch` provides basic pitch extraction but doesn't detect or annotate:
- Audio distortion/effects (reverb, chorus)
- High-arousal states (screaming, shouting)
- Short-duration limitations
- Off-screen audio characteristics

The multimodal prompt mentions these cases but lacks structured acoustic guidance.

**Code Location:**
- `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js` (`enrichCuesWithAcousticPitch`)
- `backend/services/pipeline/speakerIdentificationService.js` lines ~322-333 (`formatAuxAudioHint`)

**Evidence:** State document notes "distorted ghosts #66-67 + #81-82" were problematic and "listening beneath reverb/chorus on distorted ghost voices" was added to prompt but issues persist.

## Correctness Properties

Property 1: Bug Condition - Generic Identity Gender Classification

_For any_ cue where the speaker is a generic/broadcast identity (`isGenericSpeakerName` returns true), the fixed function SHALL determine gender from direct acoustic and visual evidence in the current scene, NOT from the `seriesSpeakerMap`, ensuring that system announcements, world broadcasts, and narrator identities are classified by their actual in-scene voice timbre.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition - Voice Actor Timbre Priority

_For any_ cue where the voice actor's acoustic timbre differs from the character's gender, the fixed function SHALL classify based on the voice actor's timbre (frequency, formants, breathiness, vocal characteristics), NOT the character's identity or visual appearance, distinguishing three metadata dimensions: character gender, voice-actor timbre, and selected dubbing voice.

**Validates: Requirements 2.3, 2.4, 2.5**

Property 3: Bug Condition - Speaker Change Detection

_For any_ pair of consecutive cues where the actual speaker changes, the fixed function SHALL detect the speaker change through acoustic feature analysis (pitch shift, timbre change, voice quality) and visual cues (lip movement, face presence), NOT blindly inherit the preceding speaker's identity, accurately handling rapid switching in danmaku/crowd scenes.

**Validates: Requirements 2.6, 2.7**

Property 4: Bug Condition - Ground Truth Validation

_For any_ cue where the benchmark ground truth label conflicts with the acoustic timbre evidence from original source audio, the fixed function SHALL flag the dispute and report both original benchmark accuracy and acoustic-corrected accuracy, preserving independent validation against actual audio characteristics.

**Validates: Requirements 2.8, 2.9**

Property 5: Bug Condition - Specialized Voice Handling

_For any_ cue with distorted audio (reverb, chorus), high-arousal vocalization (screaming), short duration (<1.5s), or off-screen audio characteristics, the fixed function SHALL improve identification accuracy through enhanced acoustic analysis (harmonic analysis beneath effects, arousal-adjusted pitch ranges, duration-aware confidence) and contextual reasoning, marking genuinely ambiguous cues as `review_needed` rather than forcing incorrect predictions.

**Validates: Requirements 2.10, 2.11, 2.12**

Property 6: Preservation - Correct Assignment Protection

_For any_ cue that is currently correctly assigned (296 cues), the fixed function SHALL produce exactly the same speaker gender assignment, preserving all verified improvements including episodic role isolation, focused recheck logic, and elevated audio quality provisions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.10, 3.11, 3.12, 3.13**

Property 7: Preservation - Performance Maintenance

_For any_ cached voice-switch operation, test suite execution, or episodic processing run, the fixed function SHALL maintain existing performance characteristics including <1500ms voice-switch latency, 119/119 test passes, and generalization capability on unseen episodes without episode-specific hardcoding.

**Validates: Requirements 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

The fix requires targeted modifications to speaker identification logic without architectural rewrites:

#### File 1: `backend/models/speakerRegistry.js`

**Function**: `detectSpeakerGender`

**Specific Changes**:

1. **Reorder Priority: Voice Actor Timbre BEFORE Visual Gender**
   - Move explicit `voiceGender` / `castGender` check to Priority 1 (before `visualGender`)
   - Downgrade `visualGender` to Priority 2, only used when no explicit voice timbre is available
   - Rationale: Voice actor timbre is authoritative for TTS voice selection, character visual gender is secondary

2. **Add Voice-Character Mismatch Detection**
   - After determining gender, compare with `visualGender` and character name keywords
   - If mismatch detected (e.g., female voice + male character), set metadata flags:
     - `voiceActorTimbre`: detected gender
     - `characterGender`: visual/name-based gender
     - `voiceCharacterMismatch`: true
   - Preserve voice actor timbre as final classification

**Function**: `syncSegmentsWithSpeakerRegistry`

**Specific Changes**:

3. **Exempt Generic Identities from Series Map Inheritance**
   - Add check `if (isGenericSpeakerName(segment.speaker))` before applying `seriesSpeakerMap` gender
   - For generic identities, skip series map lookup and rely only on per-cue multimodal verification
   - For recurring characters (non-generic), continue applying series map for consistency
   - Rationale: Separates persistent character identity from transient broadcast/narrator identities

4. **Add Speaker Change Detection Metadata**
   - Track `prevSegmentSpeaker` and `prevSegmentGender` during segment iteration
   - If `segment.speaker` or `segment.gender` differs from previous, set `speakerChangeDetected: true`
   - Pass this flag to downstream processes for validation

#### File 2: `backend/services/pipeline/speakerIdentificationService.js`

**Function**: `buildVerificationPrompt`

**Specific Changes**:

5. **Enhance Voice Actor Timbre Instructions**
   - Add explicit rule: "PRIORITY: Classify by voice actor acoustic timbre, NOT character identity"
   - Add examples:
     - "Female actress voicing boy character → classify FEMALE (voice actor)"
     - "Male actor voicing female character for comedy → classify MALE (voice actor)"
   - Emphasize distinction between three metadata types:
     - **Character gender**: Visual appearance, name, role (e.g., "小鬼" boy ghost)
     - **Voice actor timbre**: Actual acoustic frequency/formants/breathiness
     - **Dubbing voice**: Target TTS voice for Khmer translation (always uses voice actor timbre)

6. **Add Generic Identity Classification Rule**
   - Add explicit instruction: "For generic/broadcast identities (系统, ប្រព័ន្ធ, narrator, announcer), determine gender from CURRENT SCENE voice timbre, ignore cached speaker map"
   - Add flag in prompt data indicating which cues are generic identities
   - Request explicit acoustic reasoning in response for generic identities

7. **Add Speaker Change Detection Instructions**
   - Add rule: "Between consecutive cues, detect speaker changes through acoustic shifts (pitch, timbre, voice quality) and visual cues (different face, lip-sync)"
   - Add contextual hint: "In rapid-switching scenes (danmaku, crowd), expect per-line speaker changes"
   - Request explicit continuity/change flag in response

8. **Add Specialized Voice Handling Guidance**
   - Expand distortion handling: "For reverb/chorus effects, analyze underlying harmonic structure beneath audio processing"
   - Add arousal adjustment: "For screaming/shouting, adjust pitch expectations (male scream can reach 180-220Hz, female scream 250-350Hz)"
   - Add duration warning: "For clips <1.5s, reduce confidence and prioritize context window over isolated acoustic features"
   - Add off-screen audio note: "For phone/intercom, expect compressed frequency range, rely on formant ratios over absolute pitch"

**Function**: `formatAuxAudioHint`

**Specific Changes**:

9. **Add Specialized Audio Characteristics Annotation**
   - Detect and annotate:
     - `hasReverb`: IQR > 60Hz with low voicedRatio
     - `hasDistortion`: high harmonic content
     - `isScreaming`: pitch > 220Hz + high energy
     - `isShortDuration`: duration < 1.5s
     - `suspectedOffScreen`: visual `faceCount === 0` + dialogue present
   - Include these flags in `audioHint` object for model reasoning

**Function**: `buildFocusedRecheckPrompt`

**Specific Changes**:

10. **Add Ground Truth Dispute Flagging**
    - For cues marked for recheck, include original ground truth label if available
    - Request explicit comparison: "If acoustic evidence strongly conflicts with provided ground truth, flag as DISPUTED with acoustic reasoning"
    - Return `groundTruthDisputed: true` and `disputeReason` in response

**Function**: `findSuspectCuesForFocusedRecheck`

**Specific Changes**:

11. **Add Generic Identity Suspect Detection**
    - Add condition: cues with `isGenericSpeakerName(speaker)` AND `assignedFromSeriesMap: true` are suspect
    - Recheck these cues with fresh acoustic+visual analysis
    - Rationale: Catch cases where generic identities incorrectly inherited cached gender

12. **Add Speaker Change Conflict Detection**
    - For consecutive cues with identical speaker but acoustic features suggest change (pitch shift >40Hz, different `acousticGender`), mark as suspect
    - Trigger focused recheck with explicit speaker change detection instruction

**Function**: `buildVerifiedSeriesSpeakerMapPatch`

**Specific Changes**:

13. **Exempt Generic Identities from Series Map Patches**
    - Skip adding generic identities to series speaker map patches
    - Only update series map for recurring named characters (non-generic)
    - Add comment explaining separation of persistent vs transient identities

#### File 3: `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js`

**Function**: `enrichCuesWithAcousticPitch`

**Specific Changes**:

14. **Add Specialized Audio Feature Detection**
    - Calculate additional acoustic features:
      - `pitchVariability`: standard deviation of pitch over time
      - `spectralCentroid`: average frequency weighted by magnitude
      - `harmonicToNoiseRatio`: voice clarity indicator
    - Use these to populate specialized characteristic flags (reverb, distortion, screaming) consumed by `formatAuxAudioHint`

#### File 4: New Test File - `backend/tests/bugfix_speaker_assignment_regression.test.js`

**Purpose**: Regression test suite to verify the 24 bug fixes while protecting 296 correct assignments

**Specific Changes**:

15. **Create Regression Test Suite**
    - **Test 1-5: Generic Identity Classification**
      - Mock cues with `ប្រព័ន្ធ` speaker, varying acoustic features (male 120Hz, female 220Hz)
      - Assert gender matches acoustic evidence, NOT series map
    - **Test 6-10: Voice Actor Timbre Priority**
      - Mock cues with character-voice mismatch (female voice + male character visual)
      - Assert gender matches voice timbre, metadata flags set correctly
    - **Test 11-15: Speaker Change Detection**
      - Mock consecutive cues with speaker transitions (male→female, female→male)
      - Assert changes detected, `speakerChangeDetected` flag set
    - **Test 16-20: Ground Truth Validation**
      - Mock disputed ground truth scenarios (acoustic FEMALE but GT says MALE)
      - Assert dispute flagged, dual accuracy reported
    - **Test 21-24: Specialized Voice Handling**
      - Mock distorted audio (reverb), screaming, short clips, off-screen
      - Assert improved accuracy or `review_needed` for genuinely ambiguous cases
    - **Test 25-320: Regression Protection**
      - Load actual benchmark data for 296 correct assignments
      - Run through updated pipeline
      - Assert every correct assignment remains correct (zero regressions)

#### File 5: Documentation Update - `backend/services/pipeline/SPEAKER_IDENTIFICATION.md`

**Purpose**: Document voice-actor-timbre methodology and generic identity handling

**Specific Changes**:

16. **Add Methodology Documentation**
    - Explain three metadata dimensions: character gender, voice actor timbre, dubbing voice
    - Document priority order: voice timbre > explicit cast > visual character > keywords
    - Explain generic identity exemption from series map
    - Provide examples of character-voice mismatches (child characters, comedy roles, special effects)
    - Document specialized audio handling (distortion, arousal, duration, off-screen)

### Implementation Strategy

**Phase 1: Regression Test Suite (Test-First)**
1. Create `bugfix_speaker_assignment_regression.test.js` with failing tests for 24 bug conditions
2. Add regression protection tests for 296 correct assignments (initially passing)
3. Verify tests fail in expected ways on current code

**Phase 2: Core Logic Fixes**
1. Apply changes to `speakerRegistry.js` (priority reorder, generic identity exemption)
2. Apply changes to `speakerIdentificationService.js` (prompt enhancements, metadata additions)
3. Run regression tests, iterate until all pass

**Phase 3: Enhanced Acoustic Analysis**
1. Apply changes to `stage4_analyzeDialogueAudio.js` (additional features)
2. Update `formatAuxAudioHint` with specialized characteristic annotations
3. Run regression tests, verify no degradation

**Phase 4: Validation Infrastructure**
1. Add ground truth dispute detection to `buildFocusedRecheckPrompt`
2. Update benchmark reporting to show dual accuracy scores
3. Document disputed labels for review

**Phase 5: Integration Verification**
1. Run full test suite (119 tests + new regression tests)
2. Process all four benchmark episodes through updated pipeline
3. Verify accuracy improvements:
   - Target: 24 incorrect → <8 incorrect (97%+ accuracy)
   - Requirement: 296 correct → 296 correct (zero regressions)
4. Real browser verification with Playwright
5. Commit only after verified improvement

### Rollback Plan

If accuracy degrades or regressions occur:
1. Revert commits using git
2. Analyze failed regression tests to identify root cause
3. Adjust implementation strategy (e.g., phase 2 changes only, skip phase 3)
4. Re-run verification before retry

## Testing Strategy

### Validation Approach

The testing strategy follows a three-phase approach:
1. **Exploratory Bug Condition Checking**: Write tests reproducing all 24 bug conditions on UNFIXED code
2. **Fix Verification**: Apply fixes and verify bug conditions resolved
3. **Preservation Checking**: Verify all 296 correct assignments remain correct (regression protection)

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples demonstrating each of the 5 bug conditions BEFORE implementing the fix. Confirm root cause hypotheses.

**Test Plan**: Create unit tests simulating each bug condition with mock cues, run on UNFIXED code, observe failures.

**Test Cases**:

1. **Generic Identity Tests (Bug Condition 1)**:
   - `test-generic-01`: `ប្រព័ន្ធ` speaker with male acoustic (120Hz) but series map says FEMALE
     - Expected: Assigns FEMALE (incorrect, inherited from series map)
   - `test-generic-02`: `ប្រព័ន្ធ` speaker with female acoustic (220Hz) but series map says MALE
     - Expected: Assigns MALE (incorrect, inherited from series map)
   - `test-generic-03`: System announcer "恭喜玩家" with female voice but series map cached MALE from earlier episode
     - Expected: Assigns MALE (incorrect)

2. **Character-Voice Mismatch Tests (Bug Condition 2)**:
   - `test-character-01`: "小鬼" (boy ghost) with female voice actor (230Hz, breathy female)
     - Expected: Assigns MALE based on character name/visual (incorrect)
   - `test-character-02`: Child character (male visual) with female voice actor (210Hz)
     - Expected: Assigns MALE based on `visualGender` priority (incorrect)
   - `test-character-03`: Comedy role (female character) with male voice actor for effect (140Hz)
     - Expected: Assigns FEMALE based on character (incorrect)

3. **Speaker Change Detection Tests (Bug Condition 3)**:
   - `test-change-01`: Two consecutive cues, first MALE (130Hz), second FEMALE (240Hz), same speaker name carried over
     - Expected: Second cue assigns MALE (incorrect, continuity assumption)
   - `test-change-02`: Danmaku crowd scene with rapid male→female→male switches
     - Expected: Fails to detect per-line changes (incorrect)
   - `test-change-03`: Dialogue sequence where speaker changes but acoustic evidence is ambiguous (165Hz overlap zone)
     - Expected: Assumes continuity (incorrect)

4. **Ground Truth Validation Tests (Bug Condition 4)**:
   - `test-groundtruth-01`: Cue with female acoustic (230Hz) correctly assigned FEMALE but ground truth says MALE
     - Expected: No dispute flag, scored as "incorrect" despite accurate acoustic analysis
   - `test-groundtruth-02`: Cue with male acoustic (140Hz) correctly assigned MALE but ground truth says FEMALE
     - Expected: No dispute flag, no dual accuracy reporting

5. **Specialized Voice Tests (Bug Condition 5)**:
   - `test-specialized-01`: Ghost voice with heavy reverb/chorus (250Hz base + harmonics)
     - Expected: Misclassifies due to harmonic confusion (incorrect)
   - `test-specialized-02`: Screaming voice (female scream at 280Hz with vocal fry)
     - Expected: Ambiguous or MALE due to arousal pitch shift (incorrect)
   - `test-specialized-03`: Short exclamation "啊！" (1.1s, female 240Hz)
     - Expected: Low confidence or incorrect due to duration limit
   - `test-specialized-04`: Off-screen phone call (male voice, compressed frequency)
     - Expected: Misclassifies as FEMALE or ambiguous (incorrect)

**Expected Counterexamples**: All 24 test cases should fail on unfixed code, confirming the bug conditions and root causes.

### Fix Checking

**Goal**: Verify that for all cues where bug conditions hold, the fixed function produces the expected correct behavior.

**Pseudocode:**
```
FOR ALL cue WHERE isBugCondition(cue) DO
  result := processWithFixedPipeline(cue)
  ASSERT result.gender = expectedVoiceActorTimbre(cue)
  ASSERT result.metadata correctly separates character/voice/dubbing dimensions
  ASSERT result.speakerChangeDetected if applicable
  ASSERT result.groundTruthDisputed if applicable
  ASSERT result.specializedVoiceHandled if applicable
END FOR
```

**Test Cases**: Re-run all 24 exploratory tests on FIXED code, assert all pass.

### Preservation Checking

**Goal**: Verify that for all cues where assignments are currently correct (296 cues), the fixed function produces exactly the same result.

**Pseudocode:**
```
FOR ALL cue WHERE isCurrentlyCorrect(cue) DO
  originalResult := currentAssignment(cue)
  fixedResult := processWithFixedPipeline(cue)
  ASSERT fixedResult.gender = originalResult.gender
  ASSERT fixedResult.speakerId = originalResult.speakerId
  ASSERT fixedResult.voiceId = originalResult.voiceId
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- Automatically validates all 296 correct assignments without manual enumeration
- Catches edge cases where fixes inadvertently change unrelated logic
- Provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: 
1. Load benchmark data for all four episodes (320 cues total)
2. Identify 296 currently correct assignments
3. Run each through updated pipeline
4. Assert gender, speaker ID, voice ID unchanged
5. Assert performance characteristics maintained (<1500ms voice switch, etc.)

### Unit Tests

**Category 1: Generic Identity Classification**
- Test `isGenericSpeakerName` recognizes `ប្រព័ន្ធ`, system keywords, narrator patterns
- Test series map exemption logic in `syncSegmentsWithSpeakerRegistry`
- Test acoustic-based classification for generic identities

**Category 2: Voice Actor Timbre Priority**
- Test `detectSpeakerGender` priority order (voice > visual > keywords)
- Test metadata separation (character gender, voice timbre, dubbing voice)
- Test voice-character mismatch detection and flagging

**Category 3: Speaker Change Detection**
- Test consecutive cue analysis with acoustic shifts
- Test danmaku/crowd scene rapid switching
- Test `speakerChangeDetected` metadata flag

**Category 4: Ground Truth Validation**
- Test dispute flagging logic in `buildFocusedRecheckPrompt`
- Test dual accuracy reporting (benchmark vs acoustic)
- Test independent revalidation on disputed labels

**Category 5: Specialized Voice Handling**
- Test reverb/distortion detection in `enrichCuesWithAcousticPitch`
- Test arousal-adjusted pitch ranges for screaming
- Test duration-aware confidence adjustments
- Test off-screen audio characteristic detection
- Test `review_needed` marking for genuinely ambiguous cases

### Property-Based Tests

**Property 1: Generic Identity Independence**
- Generate random cues with generic identities and varying series maps
- Verify gender always matches acoustic evidence, never series map

**Property 2: Voice Timbre Consistency**
- Generate random cues with explicit `voiceGender` and conflicting `visualGender`
- Verify gender always matches `voiceGender` (voice actor timbre priority)

**Property 3: Speaker Change Detection Robustness**
- Generate random sequences of cues with speaker changes
- Verify changes detected when acoustic features differ significantly

**Property 4: Regression Immunity**
- Generate all 296 correct assignment cues
- Verify outputs unchanged after fix

### Integration Tests

**Test 1: Full Episode Processing (Episode 1 - 86 cues)**
- Process through updated pipeline
- Verify accuracy ≥97.67% (84/86 maintained or improved)
- Verify zero regressions on currently correct cues

**Test 2: Unseen Episode Generalization (Episode 4 - 71 cues)**
- Process through updated pipeline
- Verify accuracy ≥88.73% (63/71 maintained or improved)
- Target: improve to ≥95% (68/71+) through bug fixes

**Test 3: Specialized Voice Episode (Episode 20 - 86 cues)**
- Contains distorted ghosts, screaming, short exclamations
- Process through updated pipeline
- Verify accuracy ≥91.86% (79/86 maintained or improved)
- Target: fix distorted ghosts #66-67, #81-82 for ≥95% (82/86+)

**Test 4: Cross-Episode Consistency**
- Process all four episodes sequentially
- Verify recurring characters maintain consistent speaker IDs
- Verify generic identities do NOT carry gender across episodes incorrectly

**Test 5: Performance Preservation**
- Run voice-switch latency test suite (`single_clip_voice_switching.test.js`)
- Verify <1500ms latency maintained (target: 119-154ms preserved)
- Verify no Gemini API request increase (request capping maintained)

**Test 6: Real Browser Verification (Playwright)**
- Load Studio UI at `http://localhost:5173/studio`
- Play 16 male+female clips across all four episodes
- Verify audio plays correctly, no console errors
- Spot-check fixed assignments audibly match voice timbre

### Verification Metrics

**Primary Metric: Overall Accuracy**
- Baseline: 296/320 (92.50%)
- Target: ≥310/320 (96.88%)
- Requirement: Zero regressions on 296 correct assignments

**Secondary Metrics:**
- Bug Condition 1 (Generic Identity): 8 known cases → 0 incorrect
- Bug Condition 2 (Character-Voice): 6 known cases → 0 incorrect
- Bug Condition 3 (Speaker Change): 5 known cases → 0 incorrect
- Bug Condition 4 (Ground Truth): 3 known cases → flagged + dual accuracy reported
- Bug Condition 5 (Specialized Voice): 2 known cases → improved or review_needed

**Performance Metrics (Must NOT Degrade):**
- Voice switch latency: <1500ms (target: maintain 119-154ms)
- Gemini API calls per episode: maintain request capping (11-14 calls typical)
- Test suite execution: all 119 tests + new regression tests pass

**Process Metrics:**
- Zero manual voice overrides required for benchmark episodes
- Zero hardcoded episode-specific logic
- 100% 1:1 cue mapping (320/320)
- Cross-episode consistency for recurring characters maintained
