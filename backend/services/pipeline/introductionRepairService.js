const fs = require('fs');
const path = require('path');
const {
  classifyTextEvent,
  isIntroductionCategory,
  isNonSpokenMetadataCategory,
  areContinuousIntroductionEvents,
  scoreIntroTextCandidate,
  buildNarratorMetadataForIntro,
  extractNormalizedHanzi,
  NARRATOR_SPEAKER_LABEL,
  NARRATOR_SPEAKER_ID,
} = require('../../utils/textEventClassifier');
const { buildSpeakerRegistry } = require('../../models/speakerRegistry');
const { isPlaceholderTranslationText } = require('./stages/stage6PromptAndConsistency');

/**
 * Group & consolidate ONLY duplicate/fragmented continuous introduction cues inside
 * an already-generated episode's segment array, leaving all unaffected dialogue segments,
 * manual edits, sourceCueIds, and existing audio files 100% intact.
 */
function repairDuplicateIntroductionsInSegments(
  segments = [],
  { narratorGender = 'male', rawObservations = [] } = {}
) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return {
      segments: [],
      speakerRegistry: {},
      changed: false,
      consolidatedGroupsCount: 0,
      removedDuplicatesCount: 0,
      repairedCues: [],
      preservedAudioCount: 0,
    };
  }

  // Build connected clusters strictly using areContinuousIntroductionEvents
  const clusters = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const cn = String(seg.originalChineseText || seg.chineseText || seg.textZh || seg.original || '').trim();
    const textCat = classifyTextEvent({
      text: cn,
      textCategory: seg.textCategory,
      position: seg.position,
      orientation: seg.orientation,
      textRegion: seg.textRegion,
      deliveryType: seg.deliveryType,
    });

    const tagged = {
      ...seg,
      _origIdx: i,
      _classifiedCategory: textCat,
    };

    // Never merge non-intro manual overrides across clusters; protect manual segments unless obviously fragmented into identical intro
    let matchedCluster = null;
    for (let c = clusters.length - 1; c >= 0; c--) {
      const cl = clusters[c];
      const anchor = cl[cl.length - 1];
      const sCur = Number(seg.startSec ?? 0);
      const ePrev = Number(anchor.endSec ?? (Number(anchor.startSec ?? 0) + Number(anchor.duration ?? 0.5)));
      if (sCur - ePrev > 1.5) break;
      if (cl.some((member) => areContinuousIntroductionEvents(member, tagged, { maxGapSec: 0.75, rawObservations }))) {
        matchedCluster = cl;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.push(tagged);
    } else {
      clusters.push([tagged]);
    }
  }

  const narratorMeta = buildNarratorMetadataForIntro(narratorGender);
  const outSegments = [];
  const repairedCues = [];
  let consolidatedGroupsCount = 0;
  let removedDuplicatesCount = 0;
  let preservedAudioCount = 0;

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      const only = { ...cluster[0] };
      const origCat = only._classifiedCategory;
      delete only._origIdx;
      delete only._classifiedCategory;

      const isIntro = isIntroductionCategory(origCat);
      const isManual = Boolean(only.userOverridden || only.manualCharacterOverridden || only.voiceAssignmentSource === 'manual' || only.voiceOverride);

      // Even if cluster size is 1, repair misclassified speaker on an unspoken introduction card
      if (isIntro && !isManual && (only.speakerId !== NARRATOR_SPEAKER_ID || only.deliveryType !== 'narration' || only.textCategory !== origCat)) {
        const voiceChanged = Boolean(only.voiceId && only.voiceId !== narratorMeta.voiceId);
        const repaired = {
          ...only,
          textCategory: origCat,
          position: 'title_card',
          orientation: only.orientation || 'vertical',
          deliveryType: 'narration',
          speaker: narratorMeta.speaker,
          speakerName: narratorMeta.speakerName,
          speakerId: narratorMeta.speakerId,
          characterId: narratorMeta.characterId,
          voiceGender: narratorMeta.voiceGender,
          gender: narratorMeta.gender,
          speakerGender: narratorMeta.speakerGender,
          voiceId: narratorMeta.voiceId,
          khmerVoiceId: narratorMeta.khmerVoiceId,
          voice: narratorMeta.voice,
          voiceAssignmentSource: narratorMeta.voiceAssignmentSource,
          speakerStatus: 'verified',
          speakerVerified: true,
          speakerReviewNeeded: false,
          unverifiedSpeaker: false,
          ...(voiceChanged ? {
            audioGenerated: false,
            audioOutdated: true,
            ttsStatus: 'outdated',
            audioFile: null,
            audioPath: null,
            audioUrl: null,
            audioDurationSec: null,
          } : {}),
        };
        if (!voiceChanged && repaired.audioPath) preservedAudioCount++;
        outSegments.push(repaired);
        repairedCues.push({ segIndex: outSegments.length - 1, voiceChanged, textChanged: false, removedIds: [] });
      } else {
        if (only.audioPath || only.audioUrl) preservedAudioCount++;
        outSegments.push(only);
      }
      continue;
    }

    // Multiple segments collapsed into ONE continuous introduction event
    consolidatedGroupsCount++;
    removedDuplicatesCount += cluster.length - 1;

    // Pick winner candidate (longest sharp Hanzi phrase, preferring explicit intro/vertical read)
    const winner = cluster.reduce((best, cand) =>
      scoreIntroTextCandidate(cand) > scoreIntroTextCandidate(best) ? cand : best
    , cluster[0]);

    const manualMember = cluster.find((m) => m.manualTextOverridden || m.manualCharacterOverridden || m.userOverridden);
    const mergedStart = parseFloat(Math.min(...cluster.map((m) => Number(m.startSec ?? 0))).toFixed(2));
    const mergedEnd = parseFloat(Math.max(...cluster.map((m) => Number(m.endSec ?? (Number(m.startSec ?? 0) + Number(m.duration ?? 0.5))))).toFixed(2));
    const mergedDur = parseFloat(Math.max(0.35, mergedEnd - mergedStart).toFixed(2));

    const winnerChinese = String(
      (manualMember?.manualTextOverridden ? manualMember.originalChineseText : null) ||
      winner.originalChineseText ||
      winner.chineseText ||
      winner.textZh ||
      ''
    ).trim();

    const winnerCat = cluster
      .map((m) => m._classifiedCategory)
      .find((cat) => isIntroductionCategory(cat)) || winner._classifiedCategory;

    // Select best existing Khmer translation matching the surviving text (prefer manual translation first)
    const translationDonor =
      cluster.find((m) => m.manualTextOverridden && !isPlaceholderTranslationText(m.khmerTranslatedText)) ||
      cluster.find((m) => extractNormalizedHanzi(m.originalChineseText || m.chineseText) === extractNormalizedHanzi(winnerChinese) && !isPlaceholderTranslationText(m.khmerTranslatedText)) ||
      cluster.find((m) => m === winner && !isPlaceholderTranslationText(m.khmerTranslatedText)) ||
      cluster.find((m) => !isPlaceholderTranslationText(m.khmerTranslatedText)) ||
      winner;

    const chosenKhmer = String(
      translationDonor.khmerTranslatedText || translationDonor.khmerText || translationDonor.khmer || ''
    ).trim();

    const preserveManualVoice = Boolean(
      manualMember && (manualMember.userOverridden || manualMember.manualCharacterOverridden || manualMember.voiceOverride)
    );

    const activeVoiceId = preserveManualVoice
      ? (manualMember.voiceOverride || manualMember.khmerVoiceId || manualMember.voiceId || narratorMeta.voiceId)
      : narratorMeta.voiceId;

    const audioDonor = cluster.find(
      (m) =>
        m === translationDonor &&
        (m.khmerVoiceId || m.voiceId) === activeVoiceId &&
        m.audioPath &&
        fs.existsSync(m.audioPath) &&
        !isNonSpokenMetadataCategory(winnerCat)
    ) || null;

    const surviving = { ...winner };
    delete surviving._origIdx;
    delete surviving._classifiedCategory;

    const sourceIds = Array.from(new Set(cluster.map((m) => m.sourceCueId).filter(Boolean)));
    const needsTtsRegen = !audioDonor;

    const consolidatedSeg = {
      ...surviving,
      sourceCueId: winner.sourceCueId || cluster[0].sourceCueId || undefined,
      consolidatedFromSourceCueIds: sourceIds,
      startSec: mergedStart,
      endSec: mergedEnd,
      duration: mergedDur,
      sourceStartSec: mergedStart,
      sourceEndSec: mergedEnd,
      textZh: winnerChinese,
      originalChineseText: winnerChinese,
      chineseText: winnerChinese,
      originalText: winnerChinese,
      original: winnerChinese,
      khmerTranslatedText: chosenKhmer,
      khmerText: chosenKhmer,
      khmer: chosenKhmer,
      textCategory: winnerCat,
      position: 'title_card',
      orientation: winner.orientation || 'vertical',
      deliveryType: 'narration',
      skipTts: false,
      subtitleOnly: false,
      isMuted: false,
      isSilentScene: false,
      speaker: preserveManualVoice ? (manualMember.speaker || narratorMeta.speaker) : narratorMeta.speaker,
      speakerName: preserveManualVoice ? (manualMember.speakerName || manualMember.speaker || narratorMeta.speakerName) : narratorMeta.speakerName,
      speakerId: preserveManualVoice ? (manualMember.speakerId || narratorMeta.speakerId) : narratorMeta.speakerId,
      characterId: preserveManualVoice ? (manualMember.characterId || narratorMeta.characterId) : narratorMeta.characterId,
      gender: preserveManualVoice ? (manualMember.gender || manualMember.voiceGender || narratorMeta.gender) : narratorMeta.gender,
      voiceGender: preserveManualVoice ? (manualMember.voiceGender || narratorMeta.voiceGender) : narratorMeta.voiceGender,
      speakerGender: preserveManualVoice ? (manualMember.speakerGender || narratorMeta.speakerGender) : narratorMeta.speakerGender,
      voiceId: activeVoiceId,
      khmerVoiceId: activeVoiceId,
      voice: activeVoiceId,
      voiceAssignmentSource: preserveManualVoice ? 'manual' : 'automatic',
      speakerStatus: 'verified',
      speakerVerified: true,
      speakerReviewNeeded: false,
      unverifiedSpeaker: false,
      reviewNeeded: isPlaceholderTranslationText(chosenKhmer),
      ...(manualMember?.manualTextOverridden ? { manualTextOverridden: true } : {}),
      ...(preserveManualVoice ? {
        userOverridden: Boolean(manualMember.userOverridden),
        manualCharacterOverridden: Boolean(manualMember.manualCharacterOverridden),
        ...(manualMember.voiceOverride ? { voiceOverride: manualMember.voiceOverride } : {}),
      } : {
        userOverridden: false,
        manualCharacterOverridden: false,
      }),
      ...(audioDonor ? {
        audioPath: audioDonor.audioPath,
        audioFile: audioDonor.audioFile,
        audioUrl: audioDonor.audioUrl,
        audioDurationSec: audioDonor.audioDurationSec,
        audioGenerated: true,
        audioOutdated: false,
        ttsStatus: 'ready',
      } : {
        audioPath: null,
        audioFile: null,
        audioUrl: null,
        audioDurationSec: null,
        audioGenerated: false,
        audioOutdated: true,
        ttsStatus: 'outdated',
      }),
    };

    if (audioDonor) preservedAudioCount++;
    outSegments.push(consolidatedSeg);
    repairedCues.push({
      segIndex: outSegments.length - 1,
      voiceChanged: Boolean(!audioDonor),
      textChanged: true,
      removedIds: sourceIds.filter((id) => id !== consolidatedSeg.sourceCueId),
      needsTtsRegen,
    });
  }

  // Renumber id / segmentId sequentially AFTER consolidation
  const finalSegments = outSegments.map((s, idx) => ({
    ...s,
    id: idx + 1,
    segmentId: idx + 1,
  }));

  const regRes = buildSpeakerRegistry(finalSegments, {});

  return {
    segments: regRes.segments || finalSegments,
    speakerRegistry: regRes.speakerRegistry || regRes.registry || {},
    changed: consolidatedGroupsCount > 0 || repairedCues.length > 0,
    consolidatedGroupsCount,
    removedDuplicatesCount,
    repairedCues,
    preservedAudioCount,
  };
}

/**
 * Repair duplicate introductions on a saved episode cleanly without regenerating
 * unaffected dialogue segments or audio clips.
 */
async function repairEpisodeIntroductions({
  seriesMeta = null,
  episode = null,
  narratorGender = 'male',
  rawObservations = [],
  synthesizeSingleSegmentFn = null,
  uploadsRoot = null,
} = {}) {
  if (!episode) {
    throw new Error('Episode object is required for targeted introduction repair');
  }
  const sourceSegments = Array.isArray(episode.scriptData?.segments)
    ? episode.scriptData.segments
    : (Array.isArray(episode.scriptSegments) ? episode.scriptSegments : []);

  const repairRes = repairDuplicateIntroductionsInSegments(sourceSegments, {
    narratorGender: narratorGender || episode.narratorGender || seriesMeta?.narratorGender || 'male',
    rawObservations,
  });

  if (!repairRes.changed) {
    return {
      ...repairRes,
      synthesizedCount: 0,
    };
  }

  const nextSegments = [...repairRes.segments];
  let synthesizedCount = 0;

  // Resynthesize ONLY the consolidated introduction segment(s) that need audio
  const ttsTargets = repairRes.repairedCues.filter((r) => nextSegments[r.segIndex]?.audioOutdated);
  if (ttsTargets.length > 0 && typeof synthesizeSingleSegmentFn === 'function') {
    const resolvedUploadsRoot = uploadsRoot || path.resolve(__dirname, '../../uploads');
    for (const targetInfo of ttsTargets) {
      const targetSeg = nextSegments[targetInfo.segIndex];
      if (!targetSeg || isPlaceholderTranslationText(targetSeg.khmerTranslatedText)) continue;
      const ttsOut = await synthesizeSingleSegmentFn({
        segment: targetSeg,
        seriesMeta,
        episode,
        uploadsRoot: resolvedUploadsRoot,
      });
      if (ttsOut && ttsOut.audioPath) {
        nextSegments[targetInfo.segIndex] = {
          ...targetSeg,
          ...ttsOut,
          audioGenerated: true,
          audioOutdated: false,
          ttsStatus: 'ready',
        };
        synthesizedCount++;
      }
    }
  }

  return {
    ...repairRes,
    segments: nextSegments,
    synthesizedCount,
  };
}

module.exports = {
  repairDuplicateIntroductionsInSegments,
  repairEpisodeIntroductions,
};
