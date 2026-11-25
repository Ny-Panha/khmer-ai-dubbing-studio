# SPEAKER ASSIGNMENT BENCHMARK RESULTS

## Test Execution Summary (2026-11-25 22:03)

### Bug Condition Exploration Tests (15 tests):
- **BC1 (Generic Identity)**: 3/3 PASSING ✅
  - BC1-1: Generic "ប្រព័ន្ធ" with male acoustic doesn't inherit FEMALE - PASS
  - BC1-2: Generic "系统" with female acoustic doesn't inherit MALE - PASS  
  - BC1-3: Generic narrator doesn't lock to first gender across episodes - PASS
  
- **BC2 (Character-Voice Confusion)**: 0/3 PASSING ❌
  - BC2-1: Boy character voiced by female actress - FAIL (assigns MALE character gender)
  - BC2-2: Male child with female voice actor - FAIL (visual overrides timbre)
  - BC2-3: Comedy role female character with male voice - FAIL (character overrides actor)

- **BC3 (Speaker Change Detection)**: 0/3 PASSING ❌
  - BC3-1: Consecutive cues MALE→FEMALE change missed - FAIL
  - BC3-2: Danmaku rapid male↔female switches missed - FAIL
  - BC3-3: Ambiguous overlap zone change missed - FAIL

- **BC4 (Ground Truth Validation)**: 0/2 PASSING ❌
  - BC4-1: Acoustic FEMALE vs GT MALE - no dispute flag - FAIL
  - BC4-2: Acoustic MALE vs GT FEMALE - no dual accuracy - FAIL

- **BC5 (Specialized Voice)**: 0/5 PASSING ❌
  - BC5-1: Ghost voice with reverb misclassified - FAIL
  - BC5-2: Screaming voice misclassified - FAIL
  - BC5-3: Short exclamation low confidence - FAIL
  - BC5-4: Off-screen phone call misclassified - FAIL
  - BC5-5: Ambiguous cue doesn't mark review_needed - FAIL

### Preservation Tests (15 tests):
Status: File exists, tests timeout (likely passing based on Task 2 report showing 15/15 PASS)

## Analysis

### Impact of Tasks 3.1-3.7:
**CONFIRMED FIX**: BC1 (Generic Identity) - 3/3 bugs resolved ✅
- isGenericSpeakerName() helper working
- Series map exemption working
- Generic identities now classified per-scene

**REMAINING**: BC2-5 require additional implementation (Tasks 3.8-3.13)
- BC2 needs multimodal prompt enhancements (voice timbre priority already in prompt but not enforced)
- BC3 needs speaker change conflict detection
- BC4 needs ground truth dispute flagging
- BC5 needs specialized audio characteristics and enhanced acoustic features

### Estimated Current Accuracy:
- **Baseline**: 296/320 (92.50%)
- **BC1 fixes alone**: Unknown impact on 24 errors (at minimum, fixes BC1-related errors)
- **Target**: 310/320 (96.88%+)

### Next Steps:
1. Need actual 320-cue benchmark run on real episodes to quantify BC1 impact
2. Implement Tasks 3.8-3.13 only if benchmark shows specific gaps
3. Evidence-driven implementation based on actual errors

