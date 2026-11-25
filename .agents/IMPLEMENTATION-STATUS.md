# Speaker Assignment Accuracy Fix - Implementation Status

**Date:** 2025-01-18  
**Baseline Commit:** a29205729ee518c3ec14f1fcfab19f92eda1f15f  
**Current Accuracy:** 296/320 (92.50%)  
**Target Accuracy:** ≥310/320 (96.88%+)  

## Completed Tasks ✅

### Task 1: Bug Condition Exploration Tests
**Status:** ✅ COMPLETE  
**File:** `backend/tests/bugfix_speaker_assignment_exploration.test.js`  
**Details:**
- Created 15 test cases covering all 5 bug conditions:
  - **BC1 (Generic Identity):** 3 tests for `ប្រព័ន្ធ` inheriting wrong gender from series map
  - **BC2 (Character-Voice):** 3 tests for character gender overriding voice actor timbre  
  - **BC3 (Speaker Change):** 3 tests for consecutive cues missing speaker transitions
  - **BC4 (Ground Truth):** 2 tests for acoustic accuracy vs frozen GT mismatch
  - **BC5 (Specialized Voice):** 5 tests for distorted/screaming/short/off-screen/ambiguous audio
- Tests document expected failures on unfixed code
- Syntax validated with `node --check`

### Task 2: Preservation Property Tests
**Status:** ✅ COMPLETE  
**File:** `backend/tests/bugfix_speaker_assignment_preservation.test.js`  
**Test Results:** 15/15 PASSING ✅  
**Details:**
- Created 15 preservation tests to protect 296 correct assignments
- Tests cover:
  - Recurring character consistency (`ស៊ូ មីង`, `ប្រព័ន្ធ`)
  - Episodic role isolation
  - Gender detection priority order
  - Voice switch latency
  - 1:1 cue mapping
  - Per-episode accuracy baselines (Ep1: 97.67%, Ep4: 88.73%, Ep5: 90.91%, Ep20: 91.86%)
  - Overall accuracy baseline (92.50%)
- All tests PASS on current code (baseline verification successful)

### Task 3.1: Generic Identity Detection Helper
**Status:** ✅ COMPLETE  
**File:** `backend/models/speakerRegistry.js`  
**Function:** `isGenericSpeakerName(speakerName)`  
**Details:**
- Added new helper function to detect generic/broadcast identities
- Detects Khmer keywords: `ប្រព័ន្ធ`, `ឧទ្ទេសក`, `អ្នកសម្រាយរឿង`, etc.
- Detects Chinese keywords: `system`, `系统`, `旁白`, `规则警告`, etc.
- Detects narrator patterns: `/^narrator/i`, `/^system/i`, etc.
- Returns `true` for transient broadcast identities, `false` for recurring characters
- Function exported in module.exports

### Task 3.2: Reorder Priority - Voice Timbre BEFORE Visual Gender
**Status:** ✅ COMPLETE  
**File:** `backend/models/speakerRegistry.js`  
**Function:** `detectSpeakerGender()`  
**Details:**
- **Swapped priority order:**
  - **OLD:** Priority 1 = Visual Gender (character appearance) → Priority 2 = Voice Timbre
  - **NEW:** Priority 1 = Voice Actor Timbre (voiceGender/castGender) → Priority 2 = Visual Gender
- Added voice-character mismatch detection:
  - Sets `seg.voiceActorTimbre` (actual acoustic gender)
  - Sets `seg.characterGender` (visual/name-based gender)
  - Sets `seg.voiceCharacterMismatch = true` when they differ
- Preserves voice actor timbre as final classification for TTS voice selection
- Addresses Bug Condition 2 (Character vs Voice Actor Confusion)

### Task 3.3: Exempt Generic Identities from Series Map
**Status:** ✅ COMPLETE  
**File:** `backend/models/speakerRegistry.js`  
**Function:** `syncSegmentsWithSpeakerRegistry()`  
**Details:**
- Modified series map lookup logic:
  - **Lines 519-524**: For generic identities: `seriesEntry = null` (skip series map entirely)
  - For recurring characters: Continue using series map for consistency
  - Added `!isGenericName` check before series alias matching (line 510)
- Added comment explaining separation of persistent vs transient identities (lines 505-507)
- Modified `seriesGender` extraction (lines 539-544):
  - Only applies to non-generic identities: `!isGenericName` condition
  - Generic identities must be classified per-scene based on acoustic evidence
  - Prevents incorrect gender inheritance from cached announcements
- Added speaker change detection metadata (lines 634-650):
  - Track `prevSegmentSpeaker` and `prevSegmentGender` during iteration (lines 419-420, 650-651)
  - Detect speaker changes: `currentSpeaker !== prevSegmentSpeaker` (line 641)
  - Detect gender changes: `currentGender !== prevSegmentGender` (lines 642-644)
  - Store metadata on segments: `seg.speakerChangeDetected = true`, `seg.speakerChangedFrom`, `seg.genderChangedFrom` (lines 646-649)
- **Preservation Test Results:** 15/15 PASSING ✅ (verified after implementation)
- Addresses Bug Condition 1 (Generic Identity Gender Inheritance)
- Addresses Bug Condition 3 (Speaker Change Detection Failure) - partial (metadata layer only, full detection requires tasks 3.6, 3.11)

## Remaining Tasks 📋

### Task 3.4-3.13: Speaker Identification Service Enhancements
**Status:** ⏳ PENDING  
**File:** `backend/services/pipeline/speakerIdentificationService.js`  
**Functions to Modify:**
- `buildVerificationPrompt()` - Tasks 3.4, 3.5, 3.6, 3.7
- `formatAuxAudioHint()` - Task 3.8
- `buildFocusedRecheckPrompt()` - Task 3.9
- `findSuspectCuesForFocusedRecheck()` - Tasks 3.10, 3.11
- `buildVerifiedSeriesSpeakerMapPatch()` - Task 3.12

**Enhancements Required:**
1. **Voice Actor Timbre Instructions** (3.4):
   - Add explicit rule: "PRIORITY: Classify by voice actor acoustic timbre, NOT character identity"
   - Add examples of voice-character mismatch (female actress voicing boy, male actor voicing female for comedy)
   - Emphasize three metadata dimensions: character gender, voice actor timbre, dubbing voice

2. **Generic Identity Classification Rule** (3.5):
   - Add instruction: "For generic/broadcast identities (系统, ប្រព័ន្ធ, narrator), determine gender from CURRENT SCENE voice timbre"
   - Add flag indicating which cues are generic identities
   - Request explicit acoustic reasoning for generic identities

3. **Speaker Change Detection Instructions** (3.6):
   - Add rule: "Between consecutive cues, detect speaker changes through acoustic shifts and visual cues"
   - Add hint: "In rapid-switching scenes (danmaku, crowd), expect per-line speaker changes"
   - Request explicit continuity/change flag in response

4. **Specialized Voice Handling Guidance** (3.7):
   - Expand distortion handling: "For reverb/chorus effects, analyze underlying harmonic structure"
   - Add arousal adjustment: "For screaming/shouting, adjust pitch expectations (male 180-220Hz, female 250-350Hz)"
   - Add duration warning: "For clips <1.5s, reduce confidence and prioritize context window"
   - Add off-screen audio note: "For phone/intercom, expect compressed frequency range"
   - Request `review_needed` marking for genuinely ambiguous cases

5. **Specialized Audio Characteristics Annotation** (3.8):
   - Detect and annotate:
     - `hasReverb`: IQR > 60Hz with low voicedRatio
     - `hasDistortion`: high harmonic content
     - `isScreaming`: pitch > 220Hz + high energy
     - `isShortDuration`: duration < 1.5s
     - `suspectedOffScreen`: visual `faceCount === 0` + dialogue present
   - Include flags in `audioHint` object

6. **Ground Truth Dispute Flagging** (3.9):
   - Include original ground truth label in focused recheck
   - Request: "If acoustic evidence strongly conflicts with GT, flag as DISPUTED"
   - Return `groundTruthDisputed: true` and `disputeReason`

7. **Generic Identity Suspect Detection** (3.10):
   - Add condition: `isGenericSpeakerName(speaker) AND assignedFromSeriesMap: true` → suspect
   - Recheck with fresh acoustic+visual analysis

8. **Speaker Change Conflict Detection** (3.11):
   - For consecutive cues with identical speaker but acoustic suggests change (pitch shift >40Hz), mark suspect
   - Trigger focused recheck with explicit speaker change detection instruction

9. **Exempt Generic Identities from Series Map Patches** (3.12):
   - Skip adding generic identities to series speaker map patches
   - Only update series map for recurring named characters
   - Add comment explaining separation

### Task 3.13: Enhanced Acoustic Feature Detection
**Status:** ⏳ PENDING  
**File:** `backend/services/pipeline/stages/stage4_analyzeDialogueAudio.js`  
**Function:** `enrichCuesWithAcousticPitch()`  
**Enhancements Required:**
- Calculate additional acoustic features:
  - `pitchVariability`: standard deviation of pitch over time
  - `spectralCentroid`: average frequency weighted by magnitude
  - `harmonicToNoiseRatio`: voice clarity indicator
- Use these to populate specialized characteristic flags consumed by `formatAuxAudioHint`

### Task 3.14: Verify Exploration Tests Pass
**Status:** ⏳ PENDING  
**Details:**
- Re-run `backend/tests/bugfix_speaker_assignment_exploration.test.js`
- **EXPECTED:** All 15 tests PASS (confirms bugs are fixed)
- If failures: debug and iterate on implementation

### Task 3.15: Verify Preservation Tests Still Pass
**Status:** ✅ VERIFIED ON TASK 3.3 COMPLETION (15/15 passing)  
**Details:**
- Re-run `backend/tests/bugfix_speaker_assignment_preservation.test.js`
- **EXPECTED:** All 15 tests PASS (confirms no regressions)
- **CURRENT:** 15/15 PASSING ✅ (after Tasks 3.1-3.3)

### Task 4.1: Full Benchmark Verification
**Status:** ⏳ PENDING  
**Details:**
- Process all four benchmark episodes through updated pipeline
- Compare accuracy metrics:
  - Ep1 (86 cues): target ≥97.67% maintained
  - Ep4 (71 cues): target ≥95% (improvement from 88.73%)
  - Ep5 (77 cues): target ≥90.91% maintained
  - Ep20 (86 cues): target ≥95% (improvement from 91.86%)
  - Overall: target ≥310/320 (96.88%+)
- Document improvements by bug condition category
- Verify zero regressions on 296 currently correct assignments

### Task 4.2: Existing Test Suite Regression Check
**Status:** ⏳ PENDING  
**Details:**
- Run all 119 existing tests: `npm test` in backend directory
- Verify key suites pass:
  - `p0_speaker_id_and_voice_consistency.test.js` (9/9)
  - `single_clip_voice_switching.test.js` (3/3, <1500ms latency)
  - `proxy_preview.test.js` (4/4)
- If failures: debug and fix without breaking bug fixes

### Task 4.3: Real Browser Verification
**Status:** ⏳ PENDING  
**Details:**
- Restart backend server: `node backend/server.js`
- Ensure frontend dev server running: `http://localhost:5173`
- Run Playwright browser test with 16 male+female clips across 4 episodes
- Verify audio plays correctly, no console errors
- Spot-check fixed assignments audibly match voice timbre
- Verify waveform caching and smooth audio crossfades working

### Task 4.4: Final Accuracy Report
**Status:** ⏳ PENDING  
**Details:**
- Generate detailed report comparing baseline vs fixed
- Document bug condition fixes and remaining issues
- Identify disputed ground truth labels for review

### Task 5: Checkpoint
**Status:** ⏳ PENDING  
**Details:**
- Ensure all tests pass (exploration + preservation + existing suite)
- Verify accuracy improvement ≥310/320 (96.88%+) with zero regressions
- Verify performance maintained <1500ms voice switch latency

## Key Design Decisions

1. **Priority Reordering Rationale:**
   - Voice actor timbre is **authoritative** for TTS voice selection
   - Character visual gender is **secondary** - informational for context but not determinative
   - This aligns with the voice-actor-timbre methodology clarified in requirements

2. **Generic Identity Exemption Rationale:**
   - Recurring characters (e.g., `ស៊ូ មីង`) should maintain consistency across episodes → USE series map
   - Generic identities (e.g., `ប្រព័ន្ធ`, `系统`, narrators) change voice actors between episodes/scenes → SKIP series map
   - This prevents incorrect gender inheritance from cached announcements

3. **Speaker Change Detection Strategy:**
   - Track previous segment speaker + gender during iteration
   - Flag changes for downstream validation (multimodal verification can confirm/reject)
   - Helps detect rapid switching in danmaku/crowd scenes

4. **Preservation Test Strategy:**
   - 296 correct assignments are "frozen" - any regression is a failure
   - Tests verify existing behavior before fixes, then continue passing after
   - Protects against unintended side effects of bug fixes

## Next Steps

**Immediate Priority:**
1. Complete Tasks 3.4-3.13 (Speaker Identification Service enhancements)
2. Run exploration tests (Task 3.14) to verify bug fixes
3. Run full benchmark verification (Task 4.1)
4. Generate final accuracy report (Task 4.4)

**Risk Mitigation:**
- If accuracy regresses, roll back speakerIdentificationService.js changes and iterate
- If new bugs emerge, add targeted tests and fix incrementally
- Monitor Gemini API usage to ensure request capping maintained

**Success Criteria:**
- ✅ All preservation tests pass (15/15) - **ACHIEVED**
- ⏳ All exploration tests pass (15/15) - **PENDING**
- ⏳ Overall accuracy ≥310/320 (96.88%+) - **PENDING**
- ⏳ Zero regressions on 296 correct assignments - **TO BE VERIFIED**
- ⏳ Performance maintained <1500ms voice switch - **TO BE VERIFIED**
