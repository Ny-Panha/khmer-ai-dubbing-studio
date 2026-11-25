# Bugfix Requirements Document

## Introduction

The Dragon Dub speaker identification system currently achieves 92.50% accuracy (296/320 correct assignments, 24 incorrect, 0 unresolved) across four benchmark episodes. Despite significant improvements from the baseline (91.97% with 6 unresolved cues), 24 speaker gender assignments remain incorrect. These errors stem from systematic issues where the AI incorrectly applies gender metadata from series speaker maps to generic broadcast identities, confuses character identity with voice actor timbre, and fails to detect actual speaker changes between consecutive phrases.

This bugfix addresses the remaining 7.5% error rate by correcting the bug conditions that cause misassignment, while preserving all verified improvements including 1:1 cue mapping, zero unresolved assignments, voice-switch latency fixes, and cross-episode consistency.

## Bug Analysis

### Current Behavior (Defect)

**1. Generic Identity Gender Inheritance**

1.1 WHEN a generic system/world broadcast identity (e.g., `ប្រព័ន្ធ` "system") appears in the series speaker map with a gender assignment THEN the system incorrectly forces all future occurrences to use that gender even when the actual in-scene broadcast voice has different timbre

1.2 WHEN episodic/crowd roles appear with gender-qualified speaker IDs (`spk_male_*`, `spk_female_*`) THEN the system correctly isolates them, but generic identities like `ប្រព័ន្ធ` still inherit incorrect gender from the series map

**2. Character vs Voice Actor Confusion**

2.1 WHEN a character is male but voiced by a female voice actor (e.g., child characters, small spirits) THEN the system sometimes classifies based on character gender instead of the actual acoustic timbre of the voice actor

2.2 WHEN on-screen characters are present during dialogue THEN the system sometimes assigns the speaker identity based on character presence rather than acoustic evidence of who is actually speaking

**3. Speaker Change Detection Failure**

3.1 WHEN consecutive phrases have different speakers THEN the system sometimes continues using the gender/identity from the previous phrase instead of detecting the actual speaker change

3.2 WHEN dialogue switches rapidly in scrolling danmaku or crowd scenes with per-line male↔female switches THEN the system fails to detect these granular speaker changes

**4. Ground Truth Mismatch**

4.1 WHEN the frozen benchmark ground truth label conflicts with the audible voice timbre in the original source media THEN the system is scored as "incorrect" even when its acoustic analysis is accurate (e.g., `ep_5` cue `id=6` "你不要过来啊" is audibly a female-voiced child ghost but GT says `MALE`)

**5. Specialized Voice Detection**

5.1 WHEN voices are distorted (reverb, chorus effects on ghost voices) THEN the system struggles to classify the underlying timbre correctly

5.2 WHEN screaming voices, short exclamations, or child voices appear THEN the system has reduced accuracy in identifying the speaker gender

5.3 WHEN off-screen speakers (phone calls, intercoms) provide audio-only cues THEN the system sometimes misidentifies them or confuses them with silent on-screen listeners

### Expected Behavior (Correct)

**1. Generic Identity Gender Isolation**

2.1 WHEN a generic system/world broadcast identity appears THEN the system SHALL determine gender from direct acoustic and visual evidence in the current scene, NOT from the series speaker map

2.2 WHEN `ប្រព័ន្ធ` or similar generic identities are used THEN the system SHALL verify the actual broadcast voice timbre in-scene rather than inheriting cached gender

**2. Voice Actor Timbre Priority**

2.3 WHEN a character is voiced by an actor with specific acoustic timbre THEN the system SHALL classify based on the voice actor's timbre (female actress voicing boy → `FEMALE`), not the character's identity

2.4 WHEN evaluating speaker identity THEN the system SHALL distinguish three separate metadata dimensions: character gender, original voice-actor timbre, and selected dubbing voice

2.5 WHEN on-screen characters are present THEN the system SHALL prioritize direct acoustic and visual speaking evidence (lip movement, audio-visual sync) over character-name assumptions

**3. Accurate Speaker Change Detection**

2.6 WHEN consecutive phrases occur THEN the system SHALL detect actual speaker changes by analyzing acoustic features and visual cues, not blindly inherit the preceding speaker's identity

2.7 WHEN rapid speaker switching occurs (danmaku, crowd scenes) THEN the system SHALL detect per-line gender/identity changes

**4. Ground Truth Validation**

2.8 WHEN benchmark results show "incorrect" assignments THEN the system SHALL independently revalidate disputed ground-truth labels against original audio evidence

2.9 WHEN ground truth conflicts with acoustic evidence THEN the system SHALL preserve both the original benchmark score and a corrected benchmark score reflecting acoustic accuracy

**5. Specialized Voice Handling**

2.10 WHEN voices have distortion effects (reverb, chorus) THEN the system SHALL analyze the underlying timbre beneath the audio processing

2.11 WHEN encountering screaming voices, short exclamations, child voices, or off-screen speakers THEN the system SHALL improve identification accuracy through enhanced acoustic analysis and contextual reasoning

2.12 WHEN speaker cues are genuinely ambiguous THEN the system SHALL mark them as `review_needed` rather than forcing an incorrect male/female prediction

### Unchanged Behavior (Regression Prevention)

**3. Preserved Improvements**

3.1 WHEN processing all 320 source cues THEN the system SHALL CONTINUE TO maintain strict 1:1 Khmer translation mapping with zero unresolved assignments

3.2 WHEN switching voices in cached clips THEN the system SHALL CONTINUE TO complete the operation in <1500ms (currently 119-154ms)

3.3 WHEN processing recurring characters like `ស៊ូ មីង` THEN the system SHALL CONTINUE TO maintain cross-episode consistency (`spk_ស៊ូ_មីង` → `km-KH-PisethNeural`)

3.4 WHEN handling episodic/crowd roles THEN the system SHALL CONTINUE TO use gender-qualified speaker IDs (`spk_male_*`, `spk_female_*`) and exclude them from `namedScoreTotals` majority-vote collapse

3.5 WHEN providing audio for verification THEN the system SHALL CONTINUE TO use elevated bitrate (48k-64k), expanded context window (3/3 before/after turns), and clean `audioHint` auxiliary data

**4. Performance & Testing**

3.6 WHEN running the test suite THEN the system SHALL CONTINUE TO pass all 119 tests including `p0_speaker_id_and_voice_consistency.test.js`, `single_clip_voice_switching.test.js`, and `proxy_preview.test.js`

3.7 WHEN processing episodes THEN the system SHALL CONTINUE TO use targeted verification with Gemini request capping, selective focused re-verification (`findSuspectCuesForFocusedRecheck`), and audio-capable fallback models

3.8 WHEN benchmarking on previously unseen episodes THEN the system SHALL CONTINUE TO demonstrate generalization capability without episode-specific hardcoding

**5. Accuracy Preservation**

3.9 WHEN processing Episode 1 (86 cues) THEN the system SHALL CONTINUE TO achieve ≥97.67% accuracy (84/86 or better)

3.10 WHEN processing Episode 4 (71 cues) THEN the system SHALL CONTINUE TO achieve ≥88.73% accuracy (63/71 or better)

3.11 WHEN processing Episode 5 (77 cues) THEN the system SHALL CONTINUE TO achieve ≥90.91% accuracy (70/77 or better)

3.12 WHEN processing Episode 20 (86 cues) THEN the system SHALL CONTINUE TO achieve ≥91.86% accuracy (79/86 or better)

3.13 WHEN processing waveform caching and audio crossfades THEN the system SHALL CONTINUE TO provide smooth audio transitions
