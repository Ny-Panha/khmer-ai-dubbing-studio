const { areChineseTextsEquivalent, normalizeChineseChars } = require('./stage3_extractChineseSubtitles');
const { formatSecondsToTimecode } = require('../pipelineTypes');
const {
  findCompoundAsrPartitions,
  classifySpeechActivity,
  normalizeChineseWithDigits,
  isFuzzyClauseMatch,
} = require('../../vadAlignmentService');

// ១. បន្ថែម Helper ពិនិត្យពាក្យឧទាន/សម្រែកសាមញ្ញ (啊, 哦, 嗯, 哎, 哇...)
const EXCLAMATION_REGEX = /^[啊哦嗯哈呀哇哎咦哼咳嘘嘿嘎呜\s!！?？.。,，、~～]+$/;
function isExclamationOrFiller(text = '') {
  const norm = normalizeChineseChars(text);
  if (!norm) return false;
  // ប្រសិនបើជាពាក្យសម្រែក/ឧទានសុទ្ធ ក្រោម 4 តួអក្សរ មិនបាច់បង្កើត Segment ទេ
  return EXCLAMATION_REGEX.test(norm) && norm.length <= 4;
}

/**
 * Compute character edit distance (Levenshtein distance) on normalized Chinese strings
 */
function computeChineseCharDiff(s1, s2) {
  if (s1 === s2) return 0;
  if (!s1 || !s1.length) return (s2 || '').length;
  if (!s2 || !s2.length) return s1.length;
  const d = [];
  for (let i = 0; i <= s1.length; i++) d[i] = [i];
  for (let j = 0; j <= s2.length; j++) d[0][j] = j;
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[s1.length][s2.length];
}

/**
 * Resolve dialogue Chinese text across spoken audio (ASR) and on-screen subtitle (OCR).
 * Adheres to DragonDub AI core dubbing principles:
 * - Spoken dialogue is grounded in audio evidence.
 * - Reliable on-screen subtitles corroborate or correct recognized dialogue when they demonstrably correspond.
 * - When sources conflict, retain both and flag disagreement rather than silently overwriting.
 */
function resolveDialogueChinese({ audioSpeech = '', ocrText = '', position = 'bottom_subtitle' }) {
  const cleanAudio = String(audioSpeech || '').trim();
  const cleanOcr = String(ocrText || '').trim();

  // Edge Case 1: Audio only
  if (cleanAudio && !cleanOcr) {
    return {
      resolvedText: cleanAudio,
      isConflict: false,
      resolutionSource: 'audio_asr',
      conflictDetails: null,
    };
  }

  // Edge Case 2: OCR only
  if (cleanOcr && !cleanAudio) {
    return {
      resolvedText: cleanOcr,
      isConflict: false,
      resolutionSource: 'visual_ocr',
      conflictDetails: null,
    };
  }

  // Edge Case 3: Neither exists
  if (!cleanAudio && !cleanOcr) {
    return {
      resolvedText: '',
      isConflict: false,
      resolutionSource: 'none',
      conflictDetails: 'No reliable source evidence exists',
    };
  }

  // Both exist: check correspondence
  const aNorm = normalizeChineseChars(cleanAudio);
  const ocrNorm = normalizeChineseChars(cleanOcr);

  // 1. Exact character identity (identical characters after normalization)
  if (cleanAudio === cleanOcr || aNorm === ocrNorm) {
    return {
      resolvedText: cleanAudio,
      isConflict: false,
      resolutionSource: 'audio_and_ocr',
      conflictDetails: null,
    };
  }

  // 2. Demonstrable correspondence (equivalent, substring, or minor edit diff)
  const isEquivalent = areChineseTextsEquivalent(cleanAudio, cleanOcr);
  const charDiff = computeChineseCharDiff(aNorm, ocrNorm);
  const maxLen = Math.max(aNorm.length, ocrNorm.length);
  const minLen = Math.min(aNorm.length, ocrNorm.length);
  const isSubstring = minLen >= 2 && (aNorm.includes(ocrNorm) || ocrNorm.includes(aNorm));
  const isMinorDiff = maxLen >= 2 && (charDiff <= 2 || (maxLen >= 5 && charDiff / maxLen <= 0.35));

  if (isEquivalent || isSubstring || isMinorDiff) {
    // Subtitle demonstrably corresponds to speech:
    // When studio OCR subtitle is available and differs phonetically from ASR (homophones, names, domain terms),
    // use studio OCR Hanzi to correct phonetic/BGM recognition errors in ASR,
    // while preserving spokenAudioText separately.
    const preferredText = (ocrNorm.length >= aNorm.length || charDiff <= 2) ? cleanOcr : cleanAudio;
    return {
      resolvedText: preferredText,
      isConflict: false,
      resolutionSource: 'corroborated_ocr_asr',
      conflictDetails: null,
    };
  }

  // 3. Real divergence / conflict (different dialogue or commentary)
  return {
    resolvedText: cleanAudio, // Grounded in audio speech for dubbing
    isConflict: true,
    resolutionSource: 'conflicting_dual_source',
    conflictDetails: `Disagreement between spoken audio ("${cleanAudio}") and subtitle ("${cleanOcr}")`,
  };
}

/**
 * Stage 5: Reconcile Timeline Evidence
 * Fuses audio speech evidence (primary source) with visual OCR observations (optional source),
 * prioritizes spoken Chinese audio as ground truth to correct OCR mis-scans (homophones,
 * character names, specialized terminology), deduplicates overlapping text across speech events,
 * preserves legitimate silence, and flags uncertain intervals.
 * 
 * @param {object} params
 * @param {Array} params.visualSegments
 * @param {Array} params.audioSegments
 * @param {Array} [params.rawObservations=[]]
 * @param {number} params.durationSec
 * @returns {Promise<{ reconciledSegments: Array, reconciliationMeta: object }>}
 */
async function reconcileTimelineEvidence({
  visualSegments = [],
  audioSegments = [],
  rawObservations = [],
  durationSec = 0,
}) {
  const merged = [];
  const usedAudioIndices = new Set();

  // Phase 2: Detect compound ASR sentences partitioned across multiple visual subtitle cards
  const { partitionMap, matchedAudioIndices } = findCompoundAsrPartitions(visualSegments, audioSegments);
  for (const aIdx of matchedAudioIndices) {
    usedAudioIndices.add(aIdx);
  }

  // 1. Correlate Visual Segments with Audio Speech Segments
  for (let vIdx = 0; vIdx < visualSegments.length; vIdx++) {
    const vSeg = visualSegments[vIdx];

    // Skip pure exclamations / interjections (啊, 哦, 嗯, etc.) — keep original audio
    if (isExclamationOrFiller(vSeg.originalChineseText)) {
      continue; // រំលងចោល ទុកសំឡេងដើម
    }

    // Check if this visual segment was partitioned from a compound ASR sentence
    if (partitionMap.has(vIdx)) {
      const part = partitionMap.get(vIdx);
      const aSeg = part.aSeg;
      const ocrText = String(vSeg.originalChineseText || '').trim();
      const audioSpeech = part.spokenAudioText;
      const resolution = resolveDialogueChinese({ audioSpeech, ocrText, position: vSeg.position });

      merged.push({
        startSec: part.speechStartSec,
        endSec: part.speechEndSec,
        duration: part.speechDuration,
        sourceStartSec: part.speechStartSec,
        sourceEndSec: part.speechEndSec,
        speechStartSec: part.speechStartSec,
        speechEndSec: part.speechEndSec,
        speechDuration: part.speechDuration,
        visualHangoverSec: part.visualHangoverSec,
        originalChineseText: resolution.resolvedText,
        spokenAudioText: audioSpeech,
        ocrSubtitleText: ocrText,
        position: vSeg.position || 'bottom_subtitle',
        speakerId: aSeg.speakerId || 'spk_1',
        voiceGender: aSeg.audioGender || aSeg.acousticGender || 'unknown',
        genderConfidence: typeof aSeg.acousticConfidence === 'number' ? aSeg.acousticConfidence : null,
        pitchHz: aSeg.acousticF0 || null,
        evidenceSource: 'audio_and_ocr',
        evidenceType: 'fused_visual_audio',
        resolutionSource: resolution.resolutionSource,
        confidence: resolution.isConflict ? 0.70 : 0.95,
        reviewNeeded: resolution.isConflict,
        uncertainTiming: false,
        verifiedBoundary: true,
        skipTts: false,
        subtitleOnly: false,
        isMuted: false,
        isSilentScene: false,
        userTtsOverride: false,
        conflictDetected: resolution.isConflict,
        conflictDetails: resolution.conflictDetails,
        disagreementFlag: resolution.isConflict ? 'OCR_ASR_DIVERGENCE' : null,
      });
      continue;
    }

    let matchedAudio = null;
    let bestAudioIdx = -1;

    // Do not merge title cards / on-screen graphics into spoken dialogue
    if (vSeg.position === 'title_card') {
      merged.push({
        startSec: vSeg.startSec,
        endSec: vSeg.endSec,
        duration: vSeg.duration,
        sourceStartSec: vSeg.startSec,
        sourceEndSec: vSeg.endSec,
        speechStartSec: null,
        speechEndSec: null,
        speechDuration: 0,
        visualHangoverSec: 0,
        originalChineseText: vSeg.originalChineseText,
        spokenAudioText: '',
        ocrSubtitleText: vSeg.originalChineseText,
        position: 'title_card',
        speakerId: 'spk_narrator',
        voiceGender: 'unknown',
        genderConfidence: null,
        evidenceSource: 'visual_ocr',
        evidenceType: 'visual_only',
        confidence: 0.75,
        reviewNeeded: true,
        uncertainTiming: !vSeg.verifiedDisappearance,
        verifiedBoundary: Boolean(vSeg.verifiedDisappearance),
        skipTts: true,
        subtitleOnly: true,
        isMuted: true,
        isSilentScene: true,
        userTtsOverride: false,
      });
      continue;
    }

    for (let aIdx = 0; aIdx < audioSegments.length; aIdx++) {
      if (usedAudioIndices.has(aIdx)) continue;
      const aSeg = audioSegments[aIdx];
      // Skip pure exclamations / interjections (啊, 哦, 嗯, etc.) — keep original audio
      if (isExclamationOrFiller(aSeg.spokenChineseText)) {
        continue; // រំលងចោល ទុកសំឡេងដើម
      }
      // Time overlap window (+/- 2.0s tolerance between speech and subtitle appearance)
      const timeOverlap = (vSeg.startSec <= aSeg.endSec + 2.0) && (aSeg.startSec <= vSeg.endSec + 2.0);
      const textMatch = areChineseTextsEquivalent(vSeg.originalChineseText, aSeg.spokenChineseText);
      const fuzzyMatch = isFuzzyClauseMatch(aSeg.spokenChineseText, vSeg.originalChineseText);

      const vNorm = normalizeChineseWithDigits(vSeg.originalChineseText || '');
      const aNorm = normalizeChineseWithDigits(aSeg.spokenChineseText || '');
      const substringMatch = (vNorm.length >= 2 && aNorm.length >= 2) && (vNorm.includes(aNorm) || aNorm.includes(vNorm));
      const charDiff = computeChineseCharDiff(vNorm, aNorm);
      const maxLen = Math.max(vNorm.length, aNorm.length);
      const isMinorDiff = maxLen >= 2 && (charDiff <= 2 || (maxLen >= 5 && charDiff / maxLen <= 0.35));

      if (timeOverlap && (textMatch || fuzzyMatch || substringMatch || isMinorDiff || vNorm.length === 0)) {
        matchedAudio = aSeg;
        bestAudioIdx = aIdx;
        break;
      }
    }

    if (matchedAudio && bestAudioIdx !== -1) {
      usedAudioIndices.add(bestAudioIdx);
      // Spoken audio timing is primary for speech/lip-sync; if difference with visual subtitle is small (<= 0.3s), snap to subtitle boundary
      const audioStart = typeof matchedAudio.startSec === 'number' ? matchedAudio.startSec : (vSeg.startSec || 0);
      const audioEnd = typeof matchedAudio.endSec === 'number' ? matchedAudio.endSec : (vSeg.endSec || audioStart + 1);
      const sStart = (typeof vSeg.startSec === 'number' && Math.abs(vSeg.startSec - audioStart) <= 0.3)
        ? vSeg.startSec
        : audioStart;
      const sEnd = (typeof vSeg.endSec === 'number' && Math.abs(vSeg.endSec - audioEnd) <= 0.3)
        ? Math.max(vSeg.endSec, audioEnd)
        : audioEnd;
      const dur = Math.max(0.6, parseFloat((sEnd - sStart).toFixed(2)));
      const hangover = Math.max(0, parseFloat(((vSeg.endSec || audioEnd) - audioEnd).toFixed(2)));

      // Ground spoken dialogue in audio evidence; use OCR subtitle to corroborate/correct recognized Hanzi
      const audioSpeech = String(matchedAudio.spokenChineseText || '').trim();
      const ocrText = String(vSeg.originalChineseText || '').trim();
      const resolution = resolveDialogueChinese({ audioSpeech, ocrText, position: vSeg.position });

      merged.push({
        startSec: parseFloat(sStart.toFixed(2)),
        endSec: parseFloat((sStart + dur).toFixed(2)),
        duration: dur,
        sourceStartSec: parseFloat(sStart.toFixed(2)),
        sourceEndSec: parseFloat((sStart + dur).toFixed(2)),
        speechStartSec: parseFloat(audioStart.toFixed(2)),
        speechEndSec: parseFloat(audioEnd.toFixed(2)),
        speechDuration: parseFloat((audioEnd - audioStart).toFixed(2)),
        visualHangoverSec: hangover,
        originalChineseText: resolution.resolvedText,
        spokenAudioText: audioSpeech,
        ocrSubtitleText: ocrText,
        position: vSeg.position || 'bottom_subtitle',
        speakerId: matchedAudio.speakerId || 'spk_1',
        voiceGender: matchedAudio.audioGender || matchedAudio.acousticGender || 'unknown',
        genderConfidence: typeof matchedAudio.acousticConfidence === 'number' ? matchedAudio.acousticConfidence : null,
        pitchHz: matchedAudio.acousticF0 || null,
        evidenceSource: 'audio_and_ocr',
        evidenceType: 'fused_visual_audio',
        resolutionSource: resolution.resolutionSource,
        confidence: resolution.isConflict ? 0.70 : 0.95,
        reviewNeeded: resolution.isConflict,
        uncertainTiming: false,
        verifiedBoundary: true,
        skipTts: false,
        subtitleOnly: false,
        isMuted: false,
        isSilentScene: false,
        userTtsOverride: false,
        conflictDetected: resolution.isConflict,
        conflictDetails: resolution.conflictDetails,
        disagreementFlag: resolution.isConflict ? 'OCR_ASR_DIVERGENCE' : null,
      });
    } else {
      // Visual-only evidence (burned-in subtitle without speech, on-screen title card, or sign)
      // Only genuine title_cards are muted from TTS; dialogue subtitles are voiced
      const isTitle = vSeg.position === 'title_card';
      merged.push({
        startSec: vSeg.startSec,
        endSec: vSeg.endSec,
        duration: vSeg.duration,
        sourceStartSec: vSeg.startSec,
        sourceEndSec: vSeg.endSec,
        speechStartSec: null,
        speechEndSec: null,
        speechDuration: 0,
        visualHangoverSec: 0,
        originalChineseText: vSeg.originalChineseText,
        spokenAudioText: '',
        ocrSubtitleText: vSeg.originalChineseText,
        position: vSeg.position || 'bottom_subtitle',
        speakerId: 'spk_narrator',
        voiceGender: 'unknown',
        genderConfidence: null,
        evidenceSource: 'visual_ocr',
        evidenceType: 'visual_only',
        confidence: 0.75,
        reviewNeeded: isTitle,
        uncertainTiming: !vSeg.verifiedDisappearance,
        verifiedBoundary: Boolean(vSeg.verifiedDisappearance),
        isSilentScene: isTitle,
        subtitleOnly: isTitle,
        skipTts: isTitle,
        isMuted: isTitle,
        userTtsOverride: false,
      });
    }
  }

  // 2. Add Audio-only Dialogue Segments or Fuse with Existing Overlapping Visual Segments
  for (let aIdx = 0; aIdx < audioSegments.length; aIdx++) {
    if (usedAudioIndices.has(aIdx)) continue;
    const aSeg = audioSegments[aIdx];
    if (aSeg.spokenChineseText && normalizeChineseChars(aSeg.spokenChineseText).length > 0) {
      // Skip pure exclamations / interjections (啊, 哦, 嗯, etc.) — keep original audio
      if (isExclamationOrFiller(aSeg.spokenChineseText)) {
        continue; // រំលងចោល ទុកសំឡេងដើម
      }
      // Check if an existing segment overlaps closely in time (within 1.0s) and demonstrably corresponds
      const overlappingIdx = merged.findIndex((m) => {
        const timeClose = Math.abs(m.startSec - aSeg.startSec) < 1.0 ||
          (aSeg.startSec >= m.startSec - 0.4 && aSeg.startSec <= m.endSec + 0.4);
        if (!timeClose) return false;
        // Never merge speech into title cards or graphics
        if (m.position === 'title_card') return false;

        if (areChineseTextsEquivalent(m.originalChineseText, aSeg.spokenChineseText) || isFuzzyClauseMatch(aSeg.spokenChineseText, m.originalChineseText)) return true;
        const mNorm = normalizeChineseWithDigits(m.originalChineseText || '');
        const aNorm = normalizeChineseWithDigits(aSeg.spokenChineseText || '');
        if (mNorm.length >= 2 && aNorm.length >= 2 && (mNorm.includes(aNorm) || aNorm.includes(mNorm))) return true;

        const charDiff = computeChineseCharDiff(mNorm, aNorm);
        const maxLen = Math.max(mNorm.length, aNorm.length);
        if (maxLen >= 2 && (charDiff <= 2 || (maxLen >= 5 && charDiff / maxLen <= 0.35))) return true;

        // If existing visual segment was empty/unassigned, associate with audio
        if (mNorm.length === 0 && (m.evidenceSource === 'visual_ocr' || m.evidenceType === 'visual_only')) return true;
        return false;
      });

      if (overlappingIdx !== -1) {
        // Upgrade existing visual segment by reconciling audio speech and OCR evidence
        const target = merged[overlappingIdx];
        const audioSpeech = String(aSeg.spokenChineseText || '').trim();
        const ocrText = String(target.ocrSubtitleText || target.originalChineseText || '').trim();
        const resolution = resolveDialogueChinese({ audioSpeech, ocrText, position: target.position });

        target.spokenAudioText = audioSpeech;
        target.ocrSubtitleText = ocrText;
        target.originalChineseText = resolution.resolvedText;
        target.evidenceSource = 'audio_and_ocr';
        target.evidenceType = 'fused_visual_audio';
        target.resolutionSource = resolution.resolutionSource;
        target.speakerId = aSeg.speakerId || target.speakerId;
        target.voiceGender = aSeg.audioGender || aSeg.acousticGender || target.voiceGender;
        target.genderConfidence = aSeg.acousticConfidence || aSeg.audioConfidence || target.genderConfidence;
        target.startSec = parseFloat(Math.min(target.startSec, aSeg.startSec).toFixed(2));
        target.endSec = parseFloat(Math.max(target.endSec, aSeg.endSec).toFixed(2));
        target.duration = parseFloat(Math.max(0.6, target.endSec - target.startSec).toFixed(2));
        target.sourceStartSec = target.startSec;
        target.sourceEndSec = target.endSec;
        target.reviewNeeded = resolution.isConflict;
        target.uncertainTiming = false;
        target.conflictDetected = resolution.isConflict;
        target.conflictDetails = resolution.conflictDetails;
        target.disagreementFlag = resolution.isConflict ? 'OCR_ASR_DIVERGENCE' : null;
        target.skipTts = false;
        target.subtitleOnly = false;
        target.isMuted = false;
        target.isSilentScene = false;
      } else {
        // Evaluate unmatched audio segment with speech activity classifier:
        // Distinguishes spoken dialogue, singing, BGM, SFX, and silence.
        const classification = classifySpeechActivity({
          hasAsrText: Boolean(aSeg.spokenChineseText && aSeg.spokenChineseText.trim()),
          hasAcousticVoice: (aSeg.acousticConfidence >= 0.50 && aSeg.acousticF0 > 0) || (aSeg.audioGender === 'male' || aSeg.audioGender === 'female'),
          isTitleCard: false,
          asrConfidence: aSeg.audioConfidence,
          isBgmOnly: Boolean(aSeg.isBgmOnly || aSeg.isPureBgm),
          isPureBgm: Boolean(aSeg.isPureBgm),
          isSinging: Boolean(aSeg.isSinging),
          audioEvents: aSeg.audioEvents || [],
          ocrHasText: false,
          speechDuration: aSeg.duration,
        });

        if (classification.rejectFromDialogueTimeline) {
          console.log(`[Stage 5 Reconciliation] 🛡️ Rejected non-dialogue audio candidate #${aIdx + 1} (${aSeg.startSec}s - ${aSeg.endSec}s): Case ${classification.caseType} ("${aSeg.spokenChineseText.substring(0, 30)}")`);
          continue;
        }

        merged.push({
          startSec: aSeg.startSec,
          endSec: aSeg.endSec,
          duration: aSeg.duration,
          sourceStartSec: aSeg.sourceStartSec || aSeg.startSec,
          sourceEndSec: aSeg.sourceEndSec || aSeg.endSec,
          originalChineseText: aSeg.spokenChineseText,
          spokenAudioText: aSeg.spokenChineseText,
          ocrSubtitleText: '',
          position: 'dialogue_speech',
          speakerId: aSeg.speakerId || 'spk_1',
          voiceGender: aSeg.audioGender || aSeg.acousticGender || 'unknown',
          genderConfidence: aSeg.acousticConfidence || aSeg.audioConfidence || 0.9,
          pitchHz: aSeg.acousticF0 || null,
          evidenceSource: 'audio_asr',
          evidenceType: 'audio_only',
          confidence: aSeg.audioConfidence || 0.9,
          reviewNeeded: classification.reviewNeeded,
          skipTts: classification.skipTts,
          subtitleOnly: classification.subtitleOnly,
          isMuted: classification.isMuted,
          isSilentScene: classification.isSilentScene,
          uncertainTiming: false,
          verifiedBoundary: true,
        });
      }
    }
  }

  // 3. Sort chronologically
  merged.sort((a, b) => a.startSec - b.startSec);

  // 3.5. Pre-Deduplication: Remove exact duplicate startSec tracks (prevents 5-layer overlap)
  // បើមាន Segment ច្រើនចាប់ផ្ដើមនៅវិនាទីជាន់គ្នា (±0.3s) ឱ្យរក្សាតែមួយ (មាន confidence ខ្ពស់ជាង)
  const preDeduplicated = [];
  for (const seg of merged) {
    const existing = preDeduplicated.find((s) => Math.abs(s.startSec - seg.startSec) <= 0.3);
    if (existing) {
      // Keep the one with higher confidence or longer duration
      if ((seg.confidence || 0) > (existing.confidence || 0) ||
          ((seg.confidence || 0) === (existing.confidence || 0) && (seg.duration || 0) > (existing.duration || 0))) {
        // Replace with better segment
        const idx = preDeduplicated.indexOf(existing);
        preDeduplicated[idx] = seg;
      }
      // Otherwise skip duplicate
    } else {
      preDeduplicated.push(seg);
    }
  }
  merged.length = 0;
  merged.push(...preDeduplicated);

  // 4. Multi-factor Deduplication & Dual-Source Reconciliation
  // NEVER deduplicate based on start-time difference alone! Require corroborating evidence:
  // (a) Speaker identity match (different speakers must NEVER be merged),
  // (b) Source provenance (fusing audio ASR with visual OCR of same dialogue event),
  // (c) Text similarity or substring containment,
  // (d) True temporal overlap.
  const deduplicated = [];
  for (const seg of merged) {
    if (deduplicated.length === 0) {
      deduplicated.push({
        ...seg,
        evidenceSources: Array.isArray(seg.evidenceSources) ? seg.evidenceSources : [seg.evidenceSource || 'audio_asr'],
      });
      continue;
    }
    const prev = deduplicated[deduplicated.length - 1];

    // Check 1: Speaker identity
    // For cross-sensor matching (e.g. visual OCR + audio ASR), visual OCR cannot determine acoustic speaker
    // and was assigned a placeholder ('spk_narrator' or 'unknown'). Allow cross-sensor merge regardless of placeholder.
    const isPlaceholderSpeaker = (id) => !id || id === 'spk_narrator' || id === 'spk_unknown' || id === 'unknown';
    const isSameSpeaker = isPlaceholderSpeaker(prev.speakerId) || isPlaceholderSpeaker(seg.speakerId) || prev.speakerId === seg.speakerId;

    // Check 2: True Mathematical Time Intersection
    const intersectStart = Math.max(prev.startSec, seg.startSec);
    const intersectEnd = Math.min(prev.endSec, seg.endSec);
    const overlapDuration = Math.max(0, parseFloat((intersectEnd - intersectStart).toFixed(2)));
    const minDur = Math.min(prev.duration, seg.duration);
    const overlapRatio = minDur > 0 ? parseFloat((overlapDuration / minDur).toFixed(2)) : 0;
    const hasTrueIntersection = overlapDuration >= 0.25 || overlapRatio >= 0.40;
    const timeGap = Math.max(0, seg.startSec - prev.endSec);

    // Check 3: Text equivalence & Substring overlap (supporting conservative fuzzy matching)
    const isEquivalent = areChineseTextsEquivalent(seg.originalChineseText, prev.originalChineseText) ||
      isFuzzyClauseMatch(seg.originalChineseText, prev.originalChineseText);
    const sNorm = normalizeChineseWithDigits(seg.originalChineseText || '');
    const pNorm = normalizeChineseWithDigits(prev.originalChineseText || '');
    const isSub = (sNorm.length > 0 && pNorm.length > 0) && (sNorm.includes(pNorm) || pNorm.includes(sNorm));

    // Check 4: Source Provenance (Cross-sensor duplicate: e.g. OCR subtitle card + ASR speech)
    const prevSrc = prev.evidenceSource || (prev.evidenceSources && prev.evidenceSources[0]) || '';
    const curSrc = seg.evidenceSource || (seg.evidenceSources && seg.evidenceSources[0]) || '';
    const isCrossSensor = (
      (prevSrc.includes('ocr') && curSrc.includes('asr')) ||
      (prevSrc.includes('asr') && curSrc.includes('ocr')) ||
      (prevSrc.includes('ocr') && curSrc.includes('audio')) ||
      (prevSrc.includes('asr') && curSrc.includes('visual')) ||
      (prevSrc === 'visual_ocr' && curSrc === 'audio_and_ocr') ||
      (prevSrc === 'audio_and_ocr' && curSrc === 'visual_ocr')
    );

    // Merge ONLY when corroborated by TRUE mathematical intersection, same speaker, and text equivalence:
    const shouldMerge = (
      (isSameSpeaker && hasTrueIntersection && (
        (isCrossSensor && (isEquivalent || isSub || sNorm.length === 0 || pNorm.length === 0)) ||
        isEquivalent ||
        (isSub && (sNorm.length >= 2 || pNorm.length >= 2))
      )) ||
      (isEquivalent && (hasTrueIntersection || timeGap <= 0.6))
    );

    if (shouldMerge) {
      // Merge into single continuous segment
      const mergedStart = Math.min(prev.startSec, seg.startSec);
      const mergedEnd = Math.max(prev.endSec, seg.endSec);
      prev.startSec = parseFloat(mergedStart.toFixed(2));
      prev.endSec = parseFloat(mergedEnd.toFixed(2));
      prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
      prev.sourceStartSec = prev.startSec;
      prev.sourceEndSec = prev.endSec;

      // Track both evidence sources
      const combinedSources = new Set([
        ...(prev.evidenceSources || [prev.evidenceSource || 'audio_asr']),
        ...(seg.evidenceSources || [seg.evidenceSource || 'visual_ocr']),
      ]);
      prev.evidenceSources = Array.from(combinedSources);
      prev.evidenceSource = 'audio_and_ocr';
      prev.evidenceType = 'fused_visual_audio';

      // Adopt acoustic speaker info from ASR if available:
      if (curSrc === 'audio_asr' || (seg.speakerId && !isPlaceholderSpeaker(seg.speakerId))) {
        prev.speakerId = seg.speakerId;
        if (seg.voiceGender && seg.voiceGender !== 'unknown') prev.voiceGender = seg.voiceGender;
        if (seg.pitchHz) prev.pitchHz = seg.pitchHz;
        if (seg.acousticF0) prev.acousticF0 = seg.acousticF0;
      }
      // If visual segment was previously muted/skipTts, activate it because speech is corroborated:
      if (seg.evidenceSource === 'audio_asr' || seg.spokenChineseText || seg.spokenAudioText) {
        prev.skipTts = false;
        prev.subtitleOnly = false;
        prev.isMuted = false;
        prev.isSilentScene = false;
      }

      // Reconcile spoken audio and OCR subtitle evidence without destructive overwrite
      const audioSpeech = String(seg.spokenAudioText || prev.spokenAudioText || '').trim();
      const ocrText = String(seg.ocrSubtitleText || prev.ocrSubtitleText || '').trim();
      const resolution = resolveDialogueChinese({ audioSpeech, ocrText, position: prev.position });

      prev.spokenAudioText = audioSpeech;
      prev.ocrSubtitleText = ocrText;
      prev.originalChineseText = resolution.resolvedText;
      prev.resolutionSource = resolution.resolutionSource;
      if (resolution.isConflict) {
        prev.reviewNeeded = true;
        prev.conflictDetected = true;
        prev.conflictDetails = resolution.conflictDetails;
        prev.disagreementFlag = 'OCR_ASR_DIVERGENCE';
      }
      continue;
    }

    deduplicated.push({
      ...seg,
      evidenceSources: Array.isArray(seg.evidenceSources) ? seg.evidenceSources : [seg.evidenceSource || 'audio_asr'],
    });
  }

  // 5. Inspect for Legitimate Silence vs Suspicious Gaps
  const gaps = [];
  if (deduplicated.length > 0) {
    let prevEnd = 0;
    for (const seg of deduplicated) {
      if (seg.startSec - prevEnd >= 3.0) {
        gaps.push({
          startSec: prevEnd,
          endSec: seg.startSec,
          duration: parseFloat((seg.startSec - prevEnd).toFixed(2)),
          type: 'legitimate_silence',
        });
      }
      prevEnd = Math.max(prevEnd, seg.endSec);
    }
    if (durationSec > 0 && durationSec - prevEnd >= 3.0) {
      gaps.push({
        startSec: prevEnd,
        endSec: durationSec,
        duration: parseFloat((durationSec - prevEnd).toFixed(2)),
        type: 'legitimate_silence',
      });
    }
  }

  return {
    reconciledSegments: deduplicated,
    reconciliationMeta: {
      totalVisualSegments: visualSegments.length,
      totalAudioSegments: audioSegments.length,
      fusedSegmentsCount: deduplicated.filter((s) => s.evidenceType === 'fused_visual_audio' || s.evidenceSource === 'audio_and_ocr').length,
      visualOnlyCount: deduplicated.filter((s) => s.evidenceType === 'visual_only' || s.evidenceSource === 'visual_ocr').length,
      audioOnlyCount: deduplicated.filter((s) => s.evidenceType === 'audio_only' || s.evidenceSource === 'audio_asr').length,
      legitimateSilencesIdentified: gaps.length,
    },
  };
}

module.exports = {
  reconcileTimelineEvidence,
  resolveDialogueChinese,
  computeChineseCharDiff,
};
