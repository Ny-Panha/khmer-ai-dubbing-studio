const { areChineseTextsEquivalent, normalizeChineseChars } = require('./stage3_extractChineseSubtitles');
const { formatSecondsToTimecode } = require('../pipelineTypes');

/**
 * Stage 5: Reconcile Timeline Evidence
 * Fuses audio speech evidence (primary source) with visual OCR observations (optional source),
 * prioritizes spoken Chinese audio as ground truth to correct OCR mis-scans (cultivation levels,
 * character names, village names), deduplicates overlapping text across speech events,
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

  // 1. Correlate Visual Segments with Audio Speech Segments
  for (const vSeg of visualSegments) {
    let matchedAudio = null;
    let bestAudioIdx = -1;

    for (let aIdx = 0; aIdx < audioSegments.length; aIdx++) {
      if (usedAudioIndices.has(aIdx)) continue;
      const aSeg = audioSegments[aIdx];
      // Time overlap window (+/- 1.5s tolerance between speech and subtitle appearance)
      const timeOverlap = (vSeg.startSec <= aSeg.endSec + 1.5) && (aSeg.startSec <= vSeg.endSec + 1.5);
      const textMatch = areChineseTextsEquivalent(vSeg.originalChineseText, aSeg.spokenChineseText);

      const vNorm = normalizeChineseChars(vSeg.originalChineseText || '');
      const aNorm = normalizeChineseChars(aSeg.spokenChineseText || '');
      const substringMatch = (vNorm.length >= 2 && aNorm.length >= 2) && (vNorm.includes(aNorm) || aNorm.includes(vNorm));

      if (timeOverlap && (textMatch || substringMatch || vSeg.originalChineseText.length === 0)) {
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

      // Primary Truth: Chinese audio speech (ASR) takes precedence over OCR mis-scans (cultivation levels, character names, etc.)
      const audioSpeech = String(matchedAudio.spokenChineseText || '').trim();
      const ocrText = String(vSeg.originalChineseText || '').trim();
      const resolvedChinese = audioSpeech || ocrText;

      merged.push({
        startSec: parseFloat(sStart.toFixed(2)),
        endSec: parseFloat((sStart + dur).toFixed(2)),
        duration: dur,
        sourceStartSec: parseFloat(sStart.toFixed(2)),
        sourceEndSec: parseFloat((sStart + dur).toFixed(2)),
        originalChineseText: resolvedChinese,
        spokenAudioText: audioSpeech,
        ocrSubtitleText: ocrText,
        position: vSeg.position || 'bottom_subtitle',
        speakerId: matchedAudio.speakerId || 'spk_1',
        voiceGender: matchedAudio.audioGender || matchedAudio.acousticGender || 'unknown',
        genderConfidence: matchedAudio.acousticConfidence || matchedAudio.audioConfidence || 0.95,
        pitchHz: matchedAudio.acousticF0 || null,
        evidenceSource: 'audio_and_ocr',
        evidenceType: 'fused_visual_audio',
        confidence: 0.95,
        reviewNeeded: false,
        uncertainTiming: false,
        verifiedBoundary: true,
      });
    } else {
      // Visual-only evidence (burned-in subtitle without speech, on-screen title card, or sign)
      const isTitle = vSeg.position === 'title_card' || !vSeg.verifiedDisappearance;
      merged.push({
        startSec: vSeg.startSec,
        endSec: vSeg.endSec,
        duration: vSeg.duration,
        sourceStartSec: vSeg.startSec,
        sourceEndSec: vSeg.endSec,
        originalChineseText: vSeg.originalChineseText,
        spokenAudioText: '',
        ocrSubtitleText: vSeg.originalChineseText,
        position: vSeg.position || 'bottom_subtitle',
        speakerId: 'spk_narrator',
        voiceGender: 'unknown',
        genderConfidence: 0.5,
        evidenceSource: 'visual_ocr',
        evidenceType: 'visual_only',
        confidence: 0.75,
        reviewNeeded: isTitle,
        uncertainTiming: !vSeg.verifiedDisappearance,
        verifiedBoundary: Boolean(vSeg.verifiedDisappearance),
      });
    }
  }

  // 2. Add Audio-only Dialogue Segments or Fuse with Existing Overlapping Visual Segments
  for (let aIdx = 0; aIdx < audioSegments.length; aIdx++) {
    if (usedAudioIndices.has(aIdx)) continue;
    const aSeg = audioSegments[aIdx];
    if (aSeg.spokenChineseText && normalizeChineseChars(aSeg.spokenChineseText).length > 0) {
      // Check if an existing segment overlaps closely in time (within 1.0s)
      const overlappingIdx = merged.findIndex((m) => {
        const timeClose = Math.abs(m.startSec - aSeg.startSec) < 1.0 ||
          (aSeg.startSec >= m.startSec - 0.4 && aSeg.startSec <= m.endSec + 0.4);
        if (!timeClose) return false;
        if (areChineseTextsEquivalent(m.originalChineseText, aSeg.spokenChineseText)) return true;
        const mNorm = normalizeChineseChars(m.originalChineseText || '');
        const aNorm = normalizeChineseChars(aSeg.spokenChineseText || '');
        if (mNorm.length >= 2 && aNorm.length >= 2 && (mNorm.includes(aNorm) || aNorm.includes(mNorm))) return true;
        // If existing is visual_ocr, treat same time slot as the same dialogue
        if (m.evidenceSource === 'visual_ocr' || m.evidenceType === 'visual_only') return true;
        return false;
      });

      if (overlappingIdx !== -1) {
        // Upgrade existing visual segment with audio speech as primary truth
        const target = merged[overlappingIdx];
        const audioSpeech = String(aSeg.spokenChineseText || '').trim();
        target.spokenAudioText = audioSpeech;
        target.originalChineseText = audioSpeech || target.originalChineseText;
        target.evidenceSource = 'audio_and_ocr';
        target.evidenceType = 'fused_visual_audio';
        target.speakerId = aSeg.speakerId || target.speakerId;
        target.voiceGender = aSeg.audioGender || aSeg.acousticGender || target.voiceGender;
        target.genderConfidence = aSeg.acousticConfidence || aSeg.audioConfidence || target.genderConfidence;
        target.startSec = parseFloat(Math.min(target.startSec, aSeg.startSec).toFixed(2));
        target.endSec = parseFloat(Math.max(target.endSec, aSeg.endSec).toFixed(2));
        target.duration = parseFloat(Math.max(0.6, target.endSec - target.startSec).toFixed(2));
        target.sourceStartSec = target.startSec;
        target.sourceEndSec = target.endSec;
        target.reviewNeeded = false;
        target.uncertainTiming = false;
      } else {
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
          reviewNeeded: false,
          uncertainTiming: false,
          verifiedBoundary: true,
        });
      }
    }
  }

  // 3. Sort chronologically
  merged.sort((a, b) => a.startSec - b.startSec);

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

    // Check 1: Speaker identity - Different speakers must NEVER be merged
    const isSameSpeaker = !prev.speakerId || !seg.speakerId || prev.speakerId === seg.speakerId;

    // Check 2: True Mathematical Time Intersection
    const intersectStart = Math.max(prev.startSec, seg.startSec);
    const intersectEnd = Math.min(prev.endSec, seg.endSec);
    const overlapDuration = Math.max(0, parseFloat((intersectEnd - intersectStart).toFixed(2)));
    const minDur = Math.min(prev.duration, seg.duration);
    const overlapRatio = minDur > 0 ? parseFloat((overlapDuration / minDur).toFixed(2)) : 0;
    const hasTrueIntersection = overlapDuration >= 0.25 || overlapRatio >= 0.40;

    // Check 3: Text equivalence & Substring overlap
    const isEquivalent = areChineseTextsEquivalent(seg.originalChineseText, prev.originalChineseText);
    const sNorm = normalizeChineseChars(seg.originalChineseText || '');
    const pNorm = normalizeChineseChars(prev.originalChineseText || '');
    const isSub = (sNorm.length > 0 && pNorm.length > 0) && (sNorm.includes(pNorm) || pNorm.includes(sNorm));

    // Check 4: Source Provenance (Cross-sensor duplicate: e.g. OCR subtitle card + ASR speech)
    const prevSrc = prev.evidenceSource || (prev.evidenceSources && prev.evidenceSources[0]) || '';
    const curSrc = seg.evidenceSource || (seg.evidenceSources && seg.evidenceSources[0]) || '';
    const isCrossSensor = (prevSrc === 'visual_ocr' && curSrc === 'audio_asr') ||
                          (prevSrc === 'audio_asr' && curSrc === 'visual_ocr') ||
                          (prevSrc === 'visual_ocr' && curSrc === 'audio_and_ocr');

    // Merge ONLY when corroborated by TRUE mathematical intersection, same speaker, and text equivalence:
    const shouldMerge = isSameSpeaker && hasTrueIntersection && (
      (isCrossSensor && (isEquivalent || isSub || sNorm.length === 0 || pNorm.length === 0)) ||
      isEquivalent ||
      (isSub && (sNorm.length >= 3 || pNorm.length >= 3))
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

      // Keep most complete spoken text and preserve OCR text alongside
      if ((seg.spokenAudioText && seg.spokenAudioText.length > (prev.spokenAudioText || '').length) ||
          seg.originalChineseText.length > prev.originalChineseText.length) {
        prev.originalChineseText = seg.spokenAudioText || seg.originalChineseText;
      }
      if (seg.spokenAudioText && !prev.spokenAudioText) {
        prev.spokenAudioText = seg.spokenAudioText;
      }
      if (seg.ocrSubtitleText && !prev.ocrSubtitleText) {
        prev.ocrSubtitleText = seg.ocrSubtitleText;
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
};
