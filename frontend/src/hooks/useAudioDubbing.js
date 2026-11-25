import { useState, useRef, useEffect } from 'react';
import { 
  generateAudioApi, 
  generateSingleSegmentAudio, 
  syncTimelineAudioApi, 
  persistTimelineOperationApi,
  fetchTtsVoices,
  retranslateSegmentApi,
} from '../services/api';
import { saveTimelineOperationToLocalStorage, suppressNextBackendSync } from '../utils/projectStorage';
import { getSpeakerId, detectSpeakerGender } from '../utils/speakerUtils';
import { formatTimecode, parseTimeToSeconds } from '../utils/timestampUtils';
import { splitKhmerTextIntoHalves } from '../utils/khmerTextSplitter';
import { cleanKhmerText } from '../utils/khmerTextSplitter';
import {
  normalizeVoiceSpeedKey,
  normalizeEffectConfigKey,
  isFilenameCompatibleWithVoice,
  isVerifiedVoiceVariantHit,
  isVerifiedSegmentAudioForVoice,
} from '../utils/voiceCacheUtils';

const isCustomClipSpeed = (spd) => {
  if (spd === undefined || spd === null || spd === '') return false;
  if (typeof spd === 'string') {
    const norm = spd.trim().toLowerCase().replace(/x$/, '');
    if (!norm || norm === 'normal' || norm === 'default' || norm === '+0%' || norm === '-0%' || norm === '0%') {
      return false;
    }
    const parsed = Number(norm);
    return Number.isFinite(parsed) ? Math.abs(parsed - 1) > 1e-6 : true;
  }
  if (typeof spd === 'number') {
    return !Number.isFinite(spd) || Math.abs(spd - 1) > 1e-6;
  }
  return true;
};

/**
 * Custom hook to manage all Khmer AI Speech synthesis, voice switching, and audio sync
 */
export function useAudioDubbing({
  scriptData,
  setScriptData,
  speakerRegistry,
  setSpeakerRegistry,
  voiceSettings,
  setVoiceSettings,
  videoRef,
  setIsPlaying,
  setSelectedSegmentId = null,
  selectedVideo = null,
  seriesId = null,
  episodeId = null,
  onSaveEpisodeBackground = null,
  audioGenerated: propAudioGenerated,
  setAudioGenerated: propSetAudioGenerated,
  audioOutdated: propAudioOutdated,
  setAudioOutdated: propSetAudioOutdated,
  fullAudioPath: propFullAudioPath,
  setFullAudioPath: propSetFullAudioPath,
  fullAudioUrl: propFullAudioUrl,
  setFullAudioUrl: propSetFullAudioUrl,
  onInvalidateRenderedPreview = null,
}) {
  const invalidateRendered = (targetEpId = null) => {
    if (typeof onInvalidateRenderedPreview === 'function') {
      onInvalidateRenderedPreview(targetEpId || episodeId || null);
    }
  };
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [generatingAudioEpisodeId, setGeneratingAudioEpisodeId] = useState(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioStage, setAudioStage] = useState('');
  const [voiceSwitchError, setVoiceSwitchError] = useState(null);
  const voiceSwitchErrorTimerRef = useRef(null);
  const clearVoiceSwitchError = () => {
    if (voiceSwitchErrorTimerRef.current) {
      clearTimeout(voiceSwitchErrorTimerRef.current);
      voiceSwitchErrorTimerRef.current = null;
    }
    setVoiceSwitchError(null);
  };
  const showVoiceSwitchError = (msg) => {
    if (voiceSwitchErrorTimerRef.current) {
      clearTimeout(voiceSwitchErrorTimerRef.current);
    }
    setVoiceSwitchError(msg);
    voiceSwitchErrorTimerRef.current = setTimeout(() => {
      voiceSwitchErrorTimerRef.current = null;
      setVoiceSwitchError(null);
    }, 6500);
  };

  const [internalAudioGenerated, setInternalAudioGenerated] = useState(false);
  const audioGenerated = propAudioGenerated !== undefined ? propAudioGenerated : internalAudioGenerated;
  const setAudioGenerated = propSetAudioGenerated || setInternalAudioGenerated;

  const [internalAudioOutdated, setInternalAudioOutdated] = useState(false);
  const audioOutdated = propAudioOutdated !== undefined ? propAudioOutdated : internalAudioOutdated;
  const setAudioOutdated = propSetAudioOutdated || setInternalAudioOutdated;

  const [internalFullAudioPath, setInternalFullAudioPath] = useState(null);
  const fullAudioPath = propFullAudioPath !== undefined ? propFullAudioPath : internalFullAudioPath;
  const setFullAudioPath = propSetFullAudioPath || setInternalFullAudioPath;

  const [internalFullAudioUrl, setInternalFullAudioUrl] = useState(null);
  const fullAudioUrl = propFullAudioUrl !== undefined ? propFullAudioUrl : internalFullAudioUrl;
  const setFullAudioUrl = propSetFullAudioUrl || setInternalFullAudioUrl;
  const [ttsVoiceCatalog, setTtsVoiceCatalog] = useState(null);
  const syncAudioTimeoutRef = useRef(null);
  const audioProgressTimerRef = useRef(null);
  const segmentRegenSeqRef = useRef({});
  const speakerRegenSeqRef = useRef({});
  const activeTtsEpisodeRef = useRef(episodeId);
  activeTtsEpisodeRef.current = episodeId;
  const scriptDataRef = useRef(scriptData);
  scriptDataRef.current = scriptData;

  const getProjectName = () => {
    if (selectedVideo?.fileName) return selectedVideo.fileName.replace(/\.[^/.]+$/, '').trim();
    if (selectedVideo?.name) return selectedVideo.name.replace(/\.[^/.]+$/, '').trim();
    if (selectedVideo?.title) return selectedVideo.title.replace(/\.[^/.]+$/, '').trim();
    if (selectedVideo?.videoId) return String(selectedVideo.videoId).replace(/\.[^/.]+$/, '').replace(/_source$/, '').trim();
    if (selectedVideo?.id) return String(selectedVideo.id).replace(/\.[^/.]+$/, '').replace(/_source$/, '').trim();
    if (scriptData?.title) return scriptData.title.trim();
    return 'drama_project';
  };
  const getVideoId = () => selectedVideo?.videoId || selectedVideo?.id || selectedVideo?.filename || null;

const FALLBACK_VOICE_CATALOG = {
  provider: 'edge-tts',
  defaultVoice: 'km-KH-PisethNeural',
  voices: [
    {
      id: 'km-KH-PisethNeural',
      displayName: 'Microsoft Edge — ប្រុស (ពិសិដ្ឋ)',
      gender: 'MALE',
      lang: 'km-KH',
      isDefault: true,
    },
    {
      id: 'km-KH-SreymomNeural',
      displayName: 'Microsoft Edge — ស្រី (ស្រីមុំ)',
      gender: 'FEMALE',
      lang: 'km-KH',
      isDefault: false,
    },
  ],
};

  // Fetch verified TTS voices on mount with fallback and retry
  useEffect(() => {
    let isMounted = true;
    let retryTimer = null;

    const loadVoices = (attempt = 1) => {
      fetchTtsVoices()
        .then((data) => {
          if (isMounted && data) {
            setTtsVoiceCatalog(data);
            if (data.defaultVoice && setVoiceSettings) {
              setVoiceSettings((prev) => ({
                ...prev,
                voiceId: prev.voiceId || data.defaultVoice,
              }));
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.warn(`[TTS] Voices load attempt ${attempt} notice:`, err.message);
          // Set fallback voices immediately so the UI is responsive
          setTtsVoiceCatalog((prev) => prev || FALLBACK_VOICE_CATALOG);
          if (attempt < 3) {
            retryTimer = setTimeout(() => {
              if (isMounted) loadVoices(attempt + 1);
            }, 2000);
          }
        });
    };

    loadVoices(1);

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (syncAudioTimeoutRef.current) clearTimeout(syncAudioTimeoutRef.current);
      if (audioProgressTimerRef.current) clearInterval(audioProgressTimerRef.current);
    };
  }, []);

  // Update a Character's assigned voice across the whole project and auto-regenerate matching segments in current episode
  const handleUpdateSpeakerVoice = async (speakerId, newVoiceId, newSpeed = 'normal') => {
    const isFemale = String(newVoiceId || '').toLowerCase().includes('sreymom');
    const voiceLabel = isFemale ? 'ស្រីមុំ (Sreymom)' : 'ពិសិដ្ឋ (Piseth)';
    const avatar = isFemale ? '👩' : '👨';
    const badgeColor = isFemale ? '#ec4899' : '#38bdf8';

    const existing = (speakerRegistry && speakerRegistry[speakerId]) || {};
    const targetName = (existing.speakerName || existing.name || (typeof speakerId === 'string' && !speakerId.startsWith('spk_') ? speakerId : '')).trim();

    // Preserve existing detected gender identity - manual voice selection must not change character gender!
    const preservedGender = existing.gender || 'UNKNOWN';
    const preservedVoiceGender = existing.voiceGender || (preservedGender === 'FEMALE' ? 'female' : (preservedGender === 'MALE' ? 'male' : 'unknown'));

    const updatedSpk = {
      ...existing,
      id: speakerId,
      speakerId: speakerId,
      speakerName: targetName || existing.speakerName || speakerId,
      name: targetName || existing.name || speakerId,
      gender: preservedGender,
      voiceGender: preservedVoiceGender,
      speakerGender: preservedGender,
      voiceId: newVoiceId,
      khmerVoiceId: newVoiceId,
      voice: newVoiceId,
      voiceLabel,
      avatar,
      badgeColor,
      speed: newSpeed,
      userOverridden: true,
      voiceAssignmentSource: 'manual',
    };

    const newReg = {
      ...(speakerRegistry || {}),
      [speakerId]: updatedSpk,
    };
    if (targetName && targetName !== speakerId) {
      newReg[targetName] = {
        ...updatedSpk,
        speakerName: targetName,
        name: targetName,
      };
    }

    setSpeakerRegistry(newReg);

    const isMatchingSegment = (seg) => {
      if (!seg) return false;
      const rawName = (seg.speaker || seg.speakerName || '').trim();
      return (
        seg.speakerId === speakerId ||
        (targetName && (rawName === targetName || seg.speakerName === targetName)) ||
        (existing.id && seg.speakerId === existing.id) ||
        (typeof speakerId === 'string' && rawName && rawName.length >= 2 && (speakerId === rawName || speakerId.includes(rawName))) ||
        (typeof speakerId === 'string' && seg.speakerId && seg.speakerId === speakerId)
      );
    };

    // Synchronously read current segments from ref or prop BEFORE calling setState
    const currentSegments = scriptDataRef.current?.segments || scriptData?.segments || [];
    if (!Array.isArray(currentSegments) || currentSegments.length === 0) {
      return currentSegments;
    }

    // Determine segments to update and build regeneration plan synchronously
    const segmentsToRegen = [];
    const updatedSegments = currentSegments.map((seg) => {
      if (!isMatchingSegment(seg)) return seg;

      const segPreservedVoiceGender = seg.voiceGender || preservedVoiceGender;
      const segPreservedGender = seg.gender || segPreservedVoiceGender;
      const segPreservedSpeakerGender = seg.speakerGender || (segPreservedGender === 'female' ? 'FEMALE' : (segPreservedGender === 'male' ? 'MALE' : 'UNKNOWN'));
      const hasText = Boolean((seg.khmer || seg.khmerText || seg.khmerTranslatedText || '').trim());

      // Preserve existing custom speed if user set one
      const activeSpeed = seg.userCustomSpeed && seg.speed ? seg.speed : newSpeed;

      // Extract existing variants and perform Client-side cache lookup
      const currentVoice = seg.voiceId || seg.khmerVoiceId || seg.voice || 'km-KH-PisethNeural';
      const currentSegText = (seg.khmer || seg.khmerText || seg.khmerTranslatedText || '').trim();
      const segDelivery = seg.deliveryType || 'out_loud';
      const segEffect = seg.audioEffect || (segDelivery === 'inner_thought' ? 'inner_thought_reverb' : 'none');
      const currentVariants = {
        ...(seg.voiceAudioVariants || {}),
        ...(isVerifiedSegmentAudioForVoice(seg, currentVoice) ? {
          [currentVoice]: {
            voiceId: currentVoice,
            actualVoiceId: seg.actualVoiceId || currentVoice,
            audioUrl: seg.audioUrl,
            audioFile: seg.audioFile,
            audioPath: seg.audioPath,
            audioDurationSec: seg.audioDurationSec,
            speed: seg.speed || activeSpeed,
            pitch: seg.pitch || '+0Hz',
            deliveryType: segDelivery,
            audioEffect: segEffect,
            effectConfig: seg.effectConfig || null,
            effectConfigKey: normalizeEffectConfigKey(segDelivery, segEffect, seg.effectConfig || null),
            text: currentSegText,
            provenanceVerified: Boolean(seg.actualVoiceId === currentVoice || seg.voiceAudioVariants?.[currentVoice]?.provenanceVerified),
            timestamp: Date.now(),
          }
        } : {})
      };

      const cachedVariant = currentVariants[newVoiceId];
      const isLocalCacheHit = isVerifiedVoiceVariantHit(cachedVariant, {
        targetVoiceId: newVoiceId,
        currentText: currentSegText,
        speed: activeSpeed,
        pitch: seg.pitch || '+0Hz',
        deliveryType: seg.deliveryType || 'out_loud',
        audioEffect: seg.audioEffect || (seg.deliveryType === 'inner_thought' ? 'inner_thought_reverb' : 'none'),
        effectConfig: seg.effectConfig || null,
      });

      // Safe reuse: if segment already has valid verified audio for this exact voiceId and is not outdated, or local cache hit
      const hasValidAudioForTarget = ((currentVoice === newVoiceId) &&
        isVerifiedSegmentAudioForVoice(seg, newVoiceId)) || isLocalCacheHit;

      // Preserve previous audio references so waveforms remain visible and playback works during generation
      const previousAudioUrl = isLocalCacheHit ? cachedVariant.audioUrl : (seg.audioUrl || seg.previousAudioUrl || null);
      const previousAudioFile = isLocalCacheHit ? (cachedVariant.audioFile || seg.audioFile) : (seg.audioFile || seg.previousAudioFile || null);
      const previousAudioPath = isLocalCacheHit ? (cachedVariant.audioPath || seg.audioPath) : (seg.audioPath || seg.previousAudioPath || null);
      const effectiveAudioUrl = isLocalCacheHit ? cachedVariant.audioUrl : seg.audioUrl;
      const effectiveAudioFile = isLocalCacheHit ? (cachedVariant.audioFile || seg.audioFile) : seg.audioFile;
      const effectiveAudioPath = isLocalCacheHit ? (cachedVariant.audioPath || seg.audioPath) : seg.audioPath;
      const effectiveAudioDur = isLocalCacheHit ? (cachedVariant.audioDurationSec || seg.audioDurationSec) : seg.audioDurationSec;

      const segUpdated = {
        ...seg,
        voiceId: newVoiceId,
        khmerVoiceId: newVoiceId,
        voice: newVoiceId,
        voiceGender: segPreservedVoiceGender,
        gender: segPreservedGender,
        speakerGender: segPreservedSpeakerGender,
        voiceLabel,
        avatar,
        badgeColor,
        voiceOverride: newVoiceId,
        voiceAssignmentSource: 'manual',
        userOverridden: true,
        speed: activeSpeed,
        voiceProvider: 'edge-tts',
        audioOutdated: !hasValidAudioForTarget,
        audioUrl: effectiveAudioUrl,
        audioFile: effectiveAudioFile,
        audioPath: effectiveAudioPath,
        audioDurationSec: effectiveAudioDur,
        previousAudioUrl,
        previousAudioFile,
        previousAudioPath,
        voiceAudioVariants: currentVariants,
        ...(hasText && !hasValidAudioForTarget ? {
          textStatus: 'generating',
          isVoiceSwitching: true,
        } : {
          textStatus: hasValidAudioForTarget ? 'ready' : (seg.textStatus || 'ready'),
          isVoiceSwitching: false,
        }),
      };

      if (hasText && !hasValidAudioForTarget) {
        segmentsToRegen.push(segUpdated);
      }
      return segUpdated;
    });

    // Update ref immediately to prevent race conditions
    if (scriptDataRef.current) {
      scriptDataRef.current = {
        ...scriptDataRef.current,
        segments: updatedSegments,
        updatedAt: Date.now(),
      };
    }

    // Immediately update UI with initial generating state without clearing audio
    setScriptData((prev) => ({
      ...(prev || {}),
      segments: updatedSegments,
      updatedAt: Date.now(),
    }));

    setAudioOutdated(segmentsToRegen.length > 0);
    invalidateRendered();

    // Persist manual voice assignment metadata immediately
    if (seriesId && episodeId) {
      try {
        saveTimelineOperationToLocalStorage(seriesId, episodeId, {
          segments: updatedSegments,
          updatedAt: Date.now(),
        });
      } catch (_) {}
    }

    const saveFn = onSaveEpisodeBackground || handleSaveEpisodeBackground;
    if (saveFn) {
      saveFn({
        scriptData: {
          ...(scriptDataRef.current || scriptData || {}),
          segments: updatedSegments,
          updatedAt: Date.now(),
        },
        speakerRegistry: newReg,
        audioOutdated: segmentsToRegen.length > 0,
      });
    }

    if (segmentsToRegen.length === 0) {
      return updatedSegments;
    }

    // Sequence token and episode pinning for concurrency safety
    const spkToken = String(speakerId || targetName || 'all');
    speakerRegenSeqRef.current[spkToken] = (speakerRegenSeqRef.current[spkToken] || 0) + 1;
    const currentSeq = speakerRegenSeqRef.current[spkToken];
    const episodeAtStart = episodeId;

    const dramaName = getProjectName();
    const videoId = getVideoId();

    try {
      // Controlled concurrency queue (2 parallel requests to avoid Edge TTS / backend saturation)
      const CONCURRENCY_LIMIT = 2;
      let nextIndex = 0;

      const runNext = async () => {
        while (nextIndex < segmentsToRegen.length) {
          // If user switched voice again or changed episode, discard immediately
          if (speakerRegenSeqRef.current[spkToken] !== currentSeq || activeTtsEpisodeRef.current !== episodeAtStart) {
            console.log(`[CastVoiceSwitch] Discarding stale audio queue for speaker ${spkToken}`);
            return;
          }

          const seg = segmentsToRegen[nextIndex++];
          try {
            const activeSpeed = seg.userCustomSpeed && seg.speed ? seg.speed : newSpeed;
            const rawMatchesSpeakerTarget = (seg.rawVoiceId === newVoiceId) && isFilenameCompatibleWithVoice(seg.rawAudioPath, newVoiceId);
            const res = await generateSingleSegmentAudio(
              {
                ...seg,
                voiceId: newVoiceId,
                textStatus: 'ready',
                rawAudioPath: rawMatchesSpeakerTarget ? seg.rawAudioPath : null,
                rawAudioFile: rawMatchesSpeakerTarget ? seg.rawAudioFile : null,
                rawVoiceId: rawMatchesSpeakerTarget ? seg.rawVoiceId : null,
              },
              {
                speed: activeSpeed,
                userCustomSpeed: Boolean(seg.userCustomSpeed),
                voiceId: newVoiceId,
                forceRegen: false,
                preserveTrim: true,
                projectName: dramaName,
                videoId: videoId,
                episodeId: episodeAtStart,
                seriesId,
              }
            );

            // Double check sequence validity after network call
            if (speakerRegenSeqRef.current[spkToken] !== currentSeq || activeTtsEpisodeRef.current !== episodeAtStart) {
              return;
            }

            const returnedSpeakerVoice = res?.actualVoiceId || res?.voiceId || res?.khmerVoiceId;
            if (!res || res.voiceMismatch || res.ttsStatus !== 'ready' || returnedSpeakerVoice !== newVoiceId) {
              throw new Error(res?.error || `Generated voice (${returnedSpeakerVoice || 'unknown'}) did not match requested voice (${newVoiceId})`);
            }

            // Progressive Commit: Commit each successful segment immediately
            const cacheBustedUrl = res?.audioUrl
              ? (res.audioUrl.includes('?t=') ? res.audioUrl : `${res.audioUrl}?t=${Date.now()}`)
              : null;

            setScriptData((prev) => {
              if (!prev?.segments) return prev;
              const nextSegs = prev.segments.map((s) => {
                if (String(s.id) !== String(seg.id)) return s;
                const segDelivery = s.deliveryType || 'out_loud';
                const segEffect = s.audioEffect || (segDelivery === 'inner_thought' ? 'inner_thought_reverb' : 'none');
                const segVariants = {
                  ...(s.voiceAudioVariants || {}),
                  ...(res?.voiceAudioVariants || {}),
                  ...(res?.audioUrl ? {
                    [newVoiceId]: {
                      voiceId: newVoiceId,
                      actualVoiceId: returnedSpeakerVoice,
                      audioUrl: cacheBustedUrl || res.audioUrl,
                      audioFile: res.audioFile,
                      audioPath: res.audioPath,
                      audioDurationSec: res.audioDurationSec || res.audioDuration,
                      speed: activeSpeed,
                      pitch: res.pitch || s.pitch || '+0Hz',
                      deliveryType: segDelivery,
                      audioEffect: segEffect,
                      effectConfig: s.effectConfig || null,
                      effectConfigKey: normalizeEffectConfigKey(segDelivery, segEffect, s.effectConfig || null),
                      text: res.khmer || res.khmerText || s.khmer || s.khmerText || '',
                      textHash: res.textHash || null,
                      provenanceVerified: true,
                      timestamp: Date.now(),
                    }
                  } : {})
                };
                return {
                  ...s,
                  ...(res || {}),
                  audioUrl: cacheBustedUrl || s.audioUrl,
                  voiceId: newVoiceId,
                  khmerVoiceId: newVoiceId,
                  voice: newVoiceId,
                  voiceLabel,
                  avatar,
                  badgeColor,
                  audioOutdated: false,
                  textStatus: 'voice_updated',
                  isVoiceSwitching: false,
                  voiceAudioVariants: segVariants,
                  previousAudioUrl: null,
                  previousAudioFile: null,
                  previousAudioPath: null,
                };
              });

              if (scriptDataRef.current) {
                scriptDataRef.current = {
                  ...prev,
                  segments: nextSegs,
                  updatedAt: Date.now(),
                };
              }

              return {
                ...prev,
                segments: nextSegs,
                updatedAt: Date.now(),
              };
            });
          } catch (err) {
            console.warn(`[CastVoiceSwitch] Auto-regen failed for segment #${seg.id}:`, err?.message || err);

            // Double check sequence validity after network call
            if (speakerRegenSeqRef.current[spkToken] !== currentSeq || activeTtsEpisodeRef.current !== episodeAtStart) {
              return;
            }

            // Safe Rollback: restore previous audio so waveform/playback are never lost
            setScriptData((prev) => {
              if (!prev?.segments) return prev;
              const nextSegs = prev.segments.map((s) => {
                if (String(s.id) !== String(seg.id)) return s;
                return {
                  ...s,
                  audioUrl: s.previousAudioUrl || s.audioUrl,
                  audioFile: s.previousAudioFile || s.audioFile,
                  audioPath: s.previousAudioPath || s.audioPath,
                  textStatus: 'error',
                  regenError: err?.message || 'TTS generation failed',
                  audioOutdated: true,
                  isVoiceSwitching: false,
                };
              });

              if (scriptDataRef.current) {
                scriptDataRef.current = {
                  ...prev,
                  segments: nextSegs,
                  updatedAt: Date.now(),
                };
              }

              return {
                ...prev,
                segments: nextSegs,
                updatedAt: Date.now(),
              };
            });
          }
        }
      };

      const workers = [];
      for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, segmentsToRegen.length); i++) {
        workers.push(runNext());
      }
      await Promise.all(workers);

      // Verify sequence is still current after full queue completion
      if (speakerRegenSeqRef.current[spkToken] !== currentSeq || activeTtsEpisodeRef.current !== episodeAtStart) {
        return null;
      }

      setAudioGenerated(true);
      invalidateRendered();

      const latestSegments = scriptDataRef.current?.segments || [];
      const stillOutdated = latestSegments.some((s) => s.audioOutdated);
      setAudioOutdated(stillOutdated);

      // Re-stitch timeline audio master track
      if (latestSegments.some((s) => s.audioFile || s.audioPath || s.audioUrl)) {
        syncTimelineAudioApi(latestSegments, dramaName, videoId, episodeAtStart, seriesId)
          .then((syncRes) => {
            if (syncRes && syncRes.fullAudioUrl) {
              const cacheBusted = `${syncRes.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
              setFullAudioUrl(cacheBusted);
              setFullAudioPath(syncRes.fullAudioPath);
              setAudioGenerated(true);
            }
          })
          .catch((syncErr) => console.warn('Auto re-sync timeline audio error:', syncErr?.message || syncErr));
      }

      // Final persistent save
      if (seriesId && episodeAtStart) {
        try {
          saveTimelineOperationToLocalStorage(seriesId, episodeAtStart, {
            segments: latestSegments,
            updatedAt: Date.now(),
          });
        } catch (_) {}
      }
      if (saveFn) {
        saveFn({
          scriptData: {
            ...(scriptDataRef.current || scriptData || {}),
            segments: latestSegments,
            updatedAt: Date.now(),
          },
          speakerRegistry: newReg,
          audioOutdated: stillOutdated,
        });
      }

      return latestSegments;
    } catch (batchErr) {
      console.warn('[CastVoiceSwitch] Auto-regen queue error:', batchErr);
      return updatedSegments;
    }
  };

  // Override an individual segment's speaking rate and auto-regenerate its speech audio
  const handleUpdateSegmentSpeed = async (segIdOrIndex, newSpeed, autoRegen = true, targetIndex = null) => {
    if (!scriptData?.segments) return;
    const segIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < scriptData.segments.length
      ? targetIndex
      : scriptData.segments.findIndex((s, idx) => 
          s.id === segIdOrIndex || idx === segIdOrIndex || 
          String(s.id) === String(segIdOrIndex) || String(idx) === String(segIdOrIndex)
        );
    if (segIdx === -1) return;

    const targetSeg = scriptData.segments[segIdx];
    const targetVoiceId = targetSeg.voiceId || (targetSeg.speakerGender === 'FEMALE' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural');

    // Manual Clip Speed ALWAYS wins over Auto-Fit (including explicit 1.0x so Auto-Fit cannot silently re-stretch it)
    const customFlag = true;
    const numericSpeed = Number(newSpeed);
    const normalizedSpeed = Number.isFinite(numericSpeed) ? Number(numericSpeed.toFixed(4)) : newSpeed;

    // Fast Return / No-op: Same-speed selection is a no-op, unless explicitly overriding Auto-Fit
    const prevSpeedNum = typeof targetSeg.speed === 'number' ? targetSeg.speed : (parseFloat(targetSeg.speed) || 1.0);
    const isSameSpeed = Math.abs(prevSpeedNum - normalizedSpeed) < 0.005;
    if (isSameSpeed && targetSeg.userCustomSpeed && (targetSeg.audioUrl || targetSeg.audioPath)) {
      return targetSeg;
    }

    const currentKhmerText = (targetSeg.khmer || targetSeg.khmerText || targetSeg.khmerTranslatedText || '').trim();
    const segKey = String(targetSeg._uid || targetSeg.id || segIdx);
    const currentSeq = (segmentRegenSeqRef.current[segKey] || 0) + 1;
    segmentRegenSeqRef.current[segKey] = currentSeq;

    // Preserve existing trimming, offsets, delivery type, effect, and variants
    const preservedOffset = targetSeg.audioOffset || 0;
    const preservedTrimmed = Boolean(targetSeg.audioTrimmed || targetSeg.userTrimmed);
    const preservedDeliveryType = targetSeg.deliveryType || 'out_loud';
    const preservedEffect = targetSeg.audioEffect || 'none';

    const updatedSeg = {
      ...targetSeg,
      speed: normalizedSpeed,
      appliedSpeed: Number.isFinite(numericSpeed) ? normalizedSpeed : (targetSeg.appliedSpeed || 1.0),
      userCustomSpeed: customFlag,
      audioOffset: preservedOffset,
      audioTrimmed: preservedTrimmed,
      userTrimmed: preservedTrimmed,
      deliveryType: preservedDeliveryType,
      audioEffect: preservedEffect,
      textStatus: autoRegen ? 'generating' : targetSeg.textStatus,
      audioOutdated: true,
    };

    const newSegments = [...scriptData.segments];
    newSegments[segIdx] = updatedSeg;

    setScriptData((prev) => (prev ? {
      ...prev,
      segments: newSegments,
      updatedAt: Date.now(),
    } : prev));
    invalidateRendered();

    if (autoRegen && currentKhmerText) {
      try {
      const rawMatchesTarget = (targetSeg.rawVoiceId === targetVoiceId) && isFilenameCompatibleWithVoice(targetSeg.rawAudioPath, targetVoiceId);
      const regenerated = await generateSingleSegmentAudio({
        ...updatedSeg,
        rawAudioPath: rawMatchesTarget ? targetSeg.rawAudioPath : null,
        rawAudioFile: rawMatchesTarget ? targetSeg.rawAudioFile : null,
        rawVoiceId: rawMatchesTarget ? targetSeg.rawVoiceId : null,
      }, {
        speed: normalizedSpeed,
        userCustomSpeed: customFlag,
        voiceId: targetVoiceId,
        deliveryType: preservedDeliveryType,
        audioEffect: preservedEffect,
        forceRegen: false, // Reuses natural 1.0x audio cache of the SAME voice via FFmpeg atempo!
        preserveTrim: true,
        projectName: getProjectName(),
        videoId: getVideoId(),
        episodeId,
        seriesId,
      });

      if (segmentRegenSeqRef.current[segKey] !== currentSeq) {
        return null; // Discard stale in-flight response
      }

      const returnedVoice = regenerated?.actualVoiceId || regenerated?.voiceId || regenerated?.khmerVoiceId;
      if (!regenerated || regenerated.voiceMismatch || regenerated.ttsStatus !== 'ready' || returnedVoice !== targetVoiceId) {
        throw new Error(regenerated?.error || `Generated voice (${returnedVoice || 'unknown'}) did not match requested voice (${targetVoiceId})`);
      }

      // Preserve all existing verified voiceAudioVariants (only update active voice entry with new speed)
      const mergedVoiceVariants = {
        ...(targetSeg.voiceAudioVariants || {}),
        ...(regenerated.voiceAudioVariants || {}),
        [targetVoiceId]: {
          ...(targetSeg.voiceAudioVariants?.[targetVoiceId] || {}),
          voiceId: targetVoiceId,
          actualVoiceId: returnedVoice,
          audioUrl: regenerated.audioUrl,
          audioFile: regenerated.audioFile,
          audioPath: regenerated.audioPath,
          audioDurationSec: regenerated.audioDurationSec || regenerated.audioDuration,
          speed: normalizedSpeed,
          pitch: regenerated.pitch || targetSeg.pitch || '+0Hz',
          deliveryType: preservedDeliveryType,
          audioEffect: preservedEffect,
          effectConfig: targetSeg.effectConfig || null,
          effectConfigKey: normalizeEffectConfigKey(preservedDeliveryType, preservedEffect, targetSeg.effectConfig || null),
          text: currentKhmerText,
          textHash: regenerated.textHash || null,
          provenanceVerified: true,
          timestamp: Date.now(),
        },
      };

        const mergedDeliveryVariants = {
          ...(targetSeg.deliveryVariants || {}),
          ...(regenerated.deliveryVariants || {}),
        };

        const finalDuration = regenerated.audioDurationSec || regenerated.audioDuration || (targetSeg.audioDurationSec / normalizedSpeed);

        const committedSeg = {
          ...targetSeg,
          ...regenerated,
          audioOffset: preservedOffset,
          audioTrimmed: preservedTrimmed,
          userTrimmed: preservedTrimmed,
          audioTrimStartSec: targetSeg.audioTrimStartSec,
          audioTrimEndSec: targetSeg.audioTrimEndSec,
          speed: normalizedSpeed,
          appliedSpeed: regenerated?.appliedSpeed ?? normalizedSpeed,
          userCustomSpeed: customFlag,
          audioDurationSec: finalDuration,
          audioDuration: finalDuration,
          finalAudioDuration: finalDuration,
          audioStartSec: targetSeg.audioStartSec ?? targetSeg.startSec,
          audioEndSec: parseFloat(((targetSeg.audioStartSec ?? targetSeg.startSec) + finalDuration).toFixed(2)),
          audioOutdated: false,
          textStatus: 'ready',
          voiceAudioVariants: mergedVoiceVariants,
          deliveryVariants: mergedDeliveryVariants,
        };

        const finalSegments = [...scriptData.segments];
        const matchIdx = finalSegments.findIndex((s, i) => i === segIdx || String(s.id) === String(targetSeg.id));
        if (matchIdx !== -1) {
          finalSegments[matchIdx] = committedSeg;
        }

        setScriptData((prev) => (prev ? {
          ...prev,
          segments: finalSegments,
          updatedAt: Date.now(),
        } : prev));
        setAudioGenerated(true);

        // Async background persistence without blocking UI
        if (seriesId && episodeId) {
          saveTimelineOperationToLocalStorage(seriesId, episodeId, {
            segments: finalSegments,
            updatedAt: Date.now(),
          });
          persistTimelineOperationApi({
            seriesId,
            episodeId,
            operation: 'update_segments',
            segments: finalSegments,
            updatedAt: Date.now(),
          }).catch((persistErr) => {
            console.warn('[useAudioDubbing] Failed to persist clip speed update:', persistErr?.message || persistErr);
          });
        }
        invalidateRendered();

        const stillOutdated = finalSegments.some((s) => s.audioOutdated);
        setFullAudioUrl(null);
        setFullAudioPath(null);
        setAudioOutdated(stillOutdated);

        return committedSeg;
      } catch (err) {
        if (segmentRegenSeqRef.current[segKey] !== currentSeq) {
          return null;
        }
        console.warn('Auto-regen segment audio on speed change failed:', err);
        return null;
      }
    }
    return updatedSeg;
  };

  // Override an individual segment's voice (instant visual + persisted assignment; async TTS with clean rollback on failure)
  const handleUpdateSegmentVoice = async (segIdOrIndex, newVoiceId, autoRegen = true, targetIndex = null) => {
    if (!scriptData?.segments) return;
    const segIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < scriptData.segments.length
      ? targetIndex
      : scriptData.segments.findIndex((s, idx) => 
          s.id === segIdOrIndex || idx === segIdOrIndex || 
          String(s.id) === String(segIdOrIndex) || String(idx) === String(segIdOrIndex)
        );
    if (segIdx === -1) return;

    clearVoiceSwitchError();

    const targetSeg = scriptData.segments[segIdx];
    const segDisplayNum = targetSeg.id ?? (segIdx + 1);
    const segKey = String(targetSeg?.id ?? segIdx);

    // Fast return: only short-circuit if active voice AND audio provenance match without mismatch/contamination
    const currentVoice = targetSeg.voiceOverride || targetSeg.khmerVoiceId || targetSeg.voiceId || targetSeg.voice;
    const isSameVoice = currentVoice === newVoiceId;
    const isAlreadyReady = isVerifiedSegmentAudioForVoice(targetSeg, newVoiceId) &&
      (targetSeg.textStatus === 'ready' || targetSeg.textStatus === 'voice_updated');
    if (isSameVoice && isAlreadyReady) {
      return targetSeg;
    }

    // Sequence token to prevent race conditions & stale responses
    const currentSeq = (segmentRegenSeqRef.current[segKey] || 0) + 1;
    segmentRegenSeqRef.current[segKey] = currentSeq;

    const isFemale = (newVoiceId || '').includes('Sreymom');
    const activeSpeed = targetSeg.userCustomSpeed ? targetSeg.speed : (voiceSettings.speed || 'normal');
    const updatedVoiceLabel = isFemale ? 'ស្រីមុំ (Sreymom)' : 'ពិសិដ្ឋ (Piseth)';
    const updatedAvatar = isFemale ? '👩' : '👨';
    const updatedBadgeColor = isFemale ? '#ec4899' : '#38bdf8';
    const currentKhmerText = (targetSeg.khmer || targetSeg.khmerText || targetSeg.khmerTranslatedText || '').trim();
    const willRegen = Boolean(autoRegen && currentKhmerText);

    // Individual segment override remains strictly segment-scoped without mutating character gender or registry
    const preservedGender = targetSeg.voiceGender || targetSeg.gender || 'unknown';
    const preservedSpeakerGender = targetSeg.speakerGender || (preservedGender === 'female' ? 'FEMALE' : (preservedGender === 'male' ? 'MALE' : 'UNKNOWN'));
    const spkKey = targetSeg.speakerId || targetSeg.speaker || null;
    const speakerEntryPatch = null;
    const prevSpeakerEntry = spkKey && speakerRegistry ? speakerRegistry[spkKey] : null;

    // Preserve previous audio references so waveforms remain visible and playback works during generation
    const previousAudioUrl = targetSeg.audioUrl || targetSeg.previousAudioUrl || null;
    const previousAudioFile = targetSeg.audioFile || targetSeg.previousAudioFile || null;
    const previousAudioPath = targetSeg.audioPath || targetSeg.previousAudioPath || null;

    // Full rollback snapshot so any TTS failure restores the exact previous voice, color/label, and audio
    const prevSegSnapshot = {
      voice: targetSeg.voice,
      voiceId: targetSeg.voiceId,
      khmerVoiceId: targetSeg.khmerVoiceId,
      speakerGender: targetSeg.speakerGender,
      voiceGender: targetSeg.voiceGender,
      gender: targetSeg.gender,
      voiceLabel: targetSeg.voiceLabel,
      avatar: targetSeg.avatar,
      badgeColor: targetSeg.badgeColor,
      voiceAssignmentSource: targetSeg.voiceAssignmentSource,
      userOverridden: targetSeg.userOverridden,
      genderConfidence: targetSeg.genderConfidence,
      speed: targetSeg.speed,
      audioUrl: targetSeg.audioUrl,
      audioFile: targetSeg.audioFile,
      audioPath: targetSeg.audioPath,
      audioDurationSec: targetSeg.audioDurationSec,
      audioOutdated: targetSeg.audioOutdated,
      textStatus: targetSeg.textStatus,
      voiceAudioVariants: targetSeg.voiceAudioVariants,
    };

    // Fast path: when auto-regenerating a single text-ready segment, /api/generate-audio
    // persists both the manual assignment (pre-TTS in parallel) & final audio directly to series.json.
    // Suppress redundant 1MB+ full-series /sync uploads so they never contend on series.json!
    if (willRegen) {
      suppressNextBackendSync(5000);
    }

    const assignedFields = {
      voice: newVoiceId,
      voiceId: newVoiceId,
      khmerVoiceId: newVoiceId,
      voiceOverride: newVoiceId,
      speakerGender: preservedSpeakerGender,
      voiceGender: preservedGender,
      gender: preservedGender,
      voiceLabel: updatedVoiceLabel,
      avatar: updatedAvatar,
      badgeColor: updatedBadgeColor,
      voiceAssignmentSource: 'manual',
      userOverridden: true,
      genderConfidence: targetSeg.genderConfidence ?? (preservedGender === 'unknown' ? 0.5 : 0.85),
      speed: activeSpeed,
      voiceProvider: 'edge-tts',
      audioOutdated: true,
      previousAudioUrl,
      previousAudioFile,
      previousAudioPath,
    };

    // 0. Extract & normalize existing variants (only snapshot current audio if verified compatible with currentVoiceKey)
    const currentVoiceKey = targetSeg.voiceOverride || targetSeg.khmerVoiceId || targetSeg.voiceId || targetSeg.voice || 'km-KH-PisethNeural';
    const currentDelivery = targetSeg.deliveryType || 'out_loud';
    const currentEffect = targetSeg.audioEffect || (currentDelivery === 'inner_thought' ? 'inner_thought_reverb' : 'none');
    const existingVariants = {
      ...(targetSeg.voiceAudioVariants || {}),
      ...(isVerifiedSegmentAudioForVoice(targetSeg, currentVoiceKey) ? {
        [currentVoiceKey]: {
          voiceId: currentVoiceKey,
          actualVoiceId: targetSeg.actualVoiceId || currentVoiceKey,
          audioUrl: targetSeg.audioUrl,
          audioFile: targetSeg.audioFile,
          audioPath: targetSeg.audioPath,
          audioDurationSec: targetSeg.audioDurationSec,
          speed: activeSpeed,
          pitch: targetSeg.pitch || '+0Hz',
          deliveryType: currentDelivery,
          audioEffect: currentEffect,
          effectConfig: targetSeg.effectConfig || null,
          effectConfigKey: normalizeEffectConfigKey(currentDelivery, currentEffect, targetSeg.effectConfig || null),
          text: currentKhmerText,
          provenanceVerified: Boolean(targetSeg.actualVoiceId === currentVoiceKey || targetSeg.voiceAudioVariants?.[currentVoiceKey]?.provenanceVerified),
          timestamp: Date.now(),
        }
      } : {})
    };

    // Client-side cache lookup before calling backend: Click -> Verified Local Cache -> Play
    const cachedVariant = existingVariants[newVoiceId];
    const isLocalCacheHit = isVerifiedVoiceVariantHit(cachedVariant, {
      targetVoiceId: newVoiceId,
      currentText: currentKhmerText,
      speed: activeSpeed,
      pitch: targetSeg.pitch || '+0Hz',
      deliveryType: currentDelivery,
      audioEffect: currentEffect,
      effectConfig: targetSeg.effectConfig || null,
    });

    const preservedOffset = targetSeg.audioOffset || 0;
    const preservedTrimmed = Boolean(targetSeg.audioTrimmed || targetSeg.userTrimmed);
    const preservedAudioStartSec = (typeof targetSeg.audioStartSec === 'number' && !isNaN(targetSeg.audioStartSec))
      ? targetSeg.audioStartSec
      : (targetSeg.startSec ?? 0);

    if (isLocalCacheHit) {
      console.log(`[useAudioDubbing] ⚡ Client-side instant verified voice switch cache hit for seg #${segDisplayNum} (${newVoiceId})`);
      const hitDur = cachedVariant.audioDurationSec || targetSeg.audioDurationSec || 2.5;
      const instantSeg = {
        ...targetSeg,
        ...assignedFields,
        audioUrl: cachedVariant.audioUrl,
        audioFile: cachedVariant.audioFile || targetSeg.audioFile,
        audioPath: cachedVariant.audioPath || targetSeg.audioPath,
        rawAudioPath: null,
        rawAudioFile: null,
        rawVoiceId: newVoiceId,
        actualVoiceId: newVoiceId,
        audioSignature: null,
        audioDurationSec: hitDur,
        audioDuration: hitDur,
        finalAudioDuration: hitDur,
        audioStartSec: preservedAudioStartSec,
        audioEndSec: preservedTrimmed && typeof targetSeg.audioEndSec === 'number'
          ? targetSeg.audioEndSec
          : parseFloat((preservedAudioStartSec + hitDur).toFixed(2)),
        audioOffset: preservedOffset,
        audioTrimmed: preservedTrimmed,
        userTrimmed: preservedTrimmed,
        audioTrimStartSec: targetSeg.audioTrimStartSec,
        audioTrimEndSec: targetSeg.audioTrimEndSec,
        userShifted: Boolean(targetSeg.userShifted),
        trackRow: targetSeg.trackRow,
        trackId: targetSeg.trackId,
        audioOutdated: false,
        textStatus: 'ready',
        isVoiceSwitching: false,
        voiceAudioVariants: existingVariants,
      };

      const instantSegments = [...scriptData.segments];
      instantSegments[segIdx] = instantSeg;

      if (spkKey && speakerEntryPatch) {
        setSpeakerRegistry((prev) => ({
          ...prev,
          [spkKey]: {
            ...(prev[spkKey] || {}),
            ...speakerEntryPatch,
          }
        }));
      }

      setScriptData((prev) => (prev ? {
        ...prev,
        segments: instantSegments,
        updatedAt: Date.now(),
      } : prev));
      invalidateRendered();

      if (seriesId && episodeId) {
        try {
          saveTimelineOperationToLocalStorage(seriesId, episodeId, {
            segments: instantSegments,
            updatedAt: Date.now(),
          });
          persistTimelineOperationApi({
            seriesId,
            episodeId,
            operation: 'update_segments',
            segments: instantSegments,
            updatedAt: Date.now(),
          }).catch(() => {});
        } catch (_) {}
      }

      setFullAudioUrl(null);
      setFullAudioPath(null);
      setAudioGenerated(true);
      setAudioOutdated(instantSegments.some((s) => s.audioOutdated));
      return instantSeg;
    }

    // Waveform preservation: keep targetSeg.audioUrl so waveform stays visible during synthesis
    const updatedSeg = {
      ...targetSeg,
      ...assignedFields,
      voiceAudioVariants: existingVariants,
      ...(willRegen ? {
        textStatus: 'generating',
        isVoiceSwitching: true,
      } : {}),
    };

    const newSegments = [...scriptData.segments];
    newSegments[segIdx] = updatedSeg;

    // 1. Update UI IMMEDIATELY in the same frame (Inspector + timeline clip color & ប្រុស/ស្រី label)
    if (spkKey && speakerEntryPatch) {
      setSpeakerRegistry((prev) => ({
        ...prev,
        [spkKey]: {
          ...(prev[spkKey] || {}),
          ...speakerEntryPatch,
        }
      }));
    }

    setScriptData((prev) => (prev ? {
      ...prev,
      segments: newSegments,
      updatedAt: Date.now(),
    } : prev));
    invalidateRendered();

    // 2. Persist the manual voice assignment immediately to localStorage (survives mid-generation reload!)
    const reloadSafeSeg = {
      ...updatedSeg,
      textStatus: prevSegSnapshot.audioUrl ? 'ready' : 'pending',
    };
    const reloadSafeSegments = [...newSegments];
    reloadSafeSegments[segIdx] = reloadSafeSeg;
    if (seriesId && episodeId) {
      try {
        saveTimelineOperationToLocalStorage(seriesId, episodeId, {
          segments: reloadSafeSegments,
          updatedAt: Date.now(),
        });
      } catch (_) {}
    }

    if (!willRegen) {
      // No Khmer text yet (or autoRegen disabled): persist assignment directly to backend right away
      if (seriesId && episodeId) {
        persistTimelineOperationApi({
          seriesId,
          episodeId,
          operation: 'update_segments',
          segments: reloadSafeSegments,
          updatedAt: Date.now(),
        }).catch(() => {});
      }
      return updatedSeg;
    }

    // 3. Async TTS generation (non-blocking UI; backend TTS cache reused only if provenance-verified)
    const sharedAudioFiles = [];
    const targetRef = targetSeg.audioPath || targetSeg.audioFile || (targetSeg.audioUrl ? targetSeg.audioUrl.split('?')[0] : null);
    if (targetRef) {
      const targetBase = String(targetRef).split('/').pop().split('\\').pop();
      for (let i = 0; i < scriptData.segments.length; i++) {
        if (i === segIdx) continue;
        const peer = scriptData.segments[i];
        const peerRef = peer?.audioPath || peer?.audioFile || (peer?.audioUrl ? peer.audioUrl.split('?')[0] : null);
        if (peerRef && String(peerRef).split('/').pop().split('\\').pop() === targetBase) {
          sharedAudioFiles.push(peerRef);
          break;
        }
      }
    }

    try {
      const rawMatchesTarget = (targetSeg.rawVoiceId === newVoiceId) && isFilenameCompatibleWithVoice(targetSeg.rawAudioPath, newVoiceId);
      const regenerated = await generateSingleSegmentAudio(
        {
          ...updatedSeg,
          textStatus: 'ready',
          audioFile: prevSegSnapshot.audioFile,
          audioPath: prevSegSnapshot.audioPath,
          rawAudioPath: rawMatchesTarget ? targetSeg.rawAudioPath : null,
          rawAudioFile: rawMatchesTarget ? targetSeg.rawAudioFile : null,
          rawVoiceId: rawMatchesTarget ? targetSeg.rawVoiceId : null,
        },
        {
          speed: activeSpeed,
          userCustomSpeed: Boolean(targetSeg.userCustomSpeed),
          voiceId: newVoiceId,
          forceRegen: false,
          preserveTrim: true,
          projectName: getProjectName(),
          videoId: getVideoId(),
          episodeId,
          seriesId,
          skipPeerDiskScan: true,
          sharedAudioFiles,
          timeoutMs: 25000,
          maxAttempts: 2,
          ...(spkKey && speakerEntryPatch ? { speakerUpdate: { key: spkKey, entry: speakerEntryPatch } } : {}),
        }
      );

      // Discard stale in-flight response if a newer voice switch already occurred
      if (segmentRegenSeqRef.current[segKey] !== currentSeq) {
        console.log(`[useAudioDubbing] Discarding stale voice response for segment #${segKey} (seq mismatch ${currentSeq} vs ${segmentRegenSeqRef.current[segKey]})`);
        return null;
      }

      const returnedActualVoice = regenerated?.actualVoiceId || regenerated?.voiceId || regenerated?.khmerVoiceId;
      if (
        !regenerated ||
        regenerated.voiceMismatch ||
        regenerated.ttsStatus !== 'ready' ||
        returnedActualVoice !== newVoiceId ||
        !isFilenameCompatibleWithVoice(regenerated.audioFile || regenerated.audioPath || regenerated.audioUrl, newVoiceId)
      ) {
        throw new Error(regenerated?.error || `Generated voice (${returnedActualVoice || 'unknown'}) did not match requested voice (${newVoiceId})`);
      }

      suppressNextBackendSync(2500);
      const committedVariants = {
        ...existingVariants,
        ...(regenerated.voiceAudioVariants || {}),
        [newVoiceId]: {
          voiceId: newVoiceId,
          actualVoiceId: returnedActualVoice,
          audioUrl: regenerated.audioUrl,
          audioFile: regenerated.audioFile,
          audioPath: regenerated.audioPath,
          audioDurationSec: regenerated.audioDurationSec || regenerated.audioDuration,
          speed: activeSpeed,
          pitch: regenerated.pitch || targetSeg.pitch || '+0Hz',
          deliveryType: currentDelivery,
          audioEffect: currentEffect,
          effectConfig: targetSeg.effectConfig || null,
          effectConfigKey: normalizeEffectConfigKey(currentDelivery, currentEffect, targetSeg.effectConfig || null),
          text: currentKhmerText,
          textHash: regenerated.textHash || null,
          provenanceVerified: true,
          timestamp: Date.now(),
        },
      };

      const committedDur = regenerated.audioDurationSec || regenerated.audioDuration || targetSeg.audioDurationSec || 2.5;
      const committedSeg = {
        ...regenerated,
        ...assignedFields,
        audioUrl: regenerated.audioUrl,
        audioFile: regenerated.audioFile,
        audioPath: regenerated.audioPath,
        rawAudioPath: regenerated.rawAudioPath,
        rawAudioFile: regenerated.rawAudioFile,
        rawVoiceId: regenerated.rawVoiceId || returnedActualVoice,
        actualVoiceId: returnedActualVoice,
        audioDurationSec: committedDur,
        audioDuration: committedDur,
        finalAudioDuration: regenerated.finalAudioDuration || committedDur,
        audioStartSec: preservedAudioStartSec,
        audioEndSec: preservedTrimmed && typeof targetSeg.audioEndSec === 'number'
          ? targetSeg.audioEndSec
          : parseFloat((preservedAudioStartSec + committedDur).toFixed(2)),
        audioOffset: preservedOffset,
        audioTrimmed: preservedTrimmed,
        userTrimmed: preservedTrimmed,
        audioTrimStartSec: targetSeg.audioTrimStartSec,
        audioTrimEndSec: targetSeg.audioTrimEndSec,
        userShifted: Boolean(targetSeg.userShifted),
        trackRow: targetSeg.trackRow,
        trackId: targetSeg.trackId,
        audioOutdated: false,
        textStatus: 'ready',
        isVoiceSwitching: false,
        voiceAudioVariants: committedVariants,
      };

      let stillOutdated = false;
      setScriptData((prev) => {
        if (!prev || !Array.isArray(prev.segments)) return prev;
        const nextSegs = [...prev.segments];
        const matchIdx = nextSegs.findIndex((s, i) => i === segIdx || String(s.id) === String(targetSeg.id));
        if (matchIdx !== -1) {
          nextSegs[matchIdx] = { ...nextSegs[matchIdx], ...committedSeg };
        }
        stillOutdated = nextSegs.some((s) => s.audioOutdated);
        return {
          ...prev,
          segments: nextSegs,
          updatedAt: Date.now(),
        };
      });
      setFullAudioUrl(null);
      setFullAudioPath(null);
      setAudioGenerated(true);
      setAudioOutdated(stillOutdated);
      return committedSeg;
    } catch (err) {
      if (segmentRegenSeqRef.current[segKey] !== currentSeq) {
        return null;
      }
      console.warn('Auto-regen segment audio failed — reverting voice assignment:', err);
      // Full rollback: restore previous voice, color/label, speakerRegistry, and prior audio
      let revertedSegments = null;
      setScriptData((prev) => {
        if (!prev || !Array.isArray(prev.segments)) return prev;
        const rolledBack = [...prev.segments];
        const matchIdx = rolledBack.findIndex((s, i) => i === segIdx || String(s.id) === String(targetSeg.id));
        if (matchIdx !== -1) {
          rolledBack[matchIdx] = {
            ...rolledBack[matchIdx],
            ...prevSegSnapshot,
            isVoiceSwitching: false,
          };
        }
        revertedSegments = rolledBack;
        return { ...prev, segments: rolledBack, updatedAt: Date.now() };
      });
      if (spkKey) {
        setSpeakerRegistry((prev) => {
          const next = { ...(prev || {}) };
          if (prevSpeakerEntry) {
            next[spkKey] = prevSpeakerEntry;
          } else {
            delete next[spkKey];
          }
          return next;
        });
      }
      if (seriesId && episodeId && revertedSegments) {
        try {
          saveTimelineOperationToLocalStorage(seriesId, episodeId, {
            segments: revertedSegments,
            updatedAt: Date.now(),
          });
        } catch (_) {}
        persistTimelineOperationApi({
          seriesId,
          episodeId,
          operation: 'update_segments',
          segments: revertedSegments,
          updatedAt: Date.now(),
        }).catch(() => {});
      }
      const errDetail = err?.message || 'មិនអាចភ្ជាប់ទៅ Backend បានទេ';
      showVoiceSwitchError(
        `❌ បរាជ័យក្នុងការបង្កើតសំឡេង #${segDisplayNum} (${updatedVoiceLabel}) — បានត្រឡប់ទៅសំឡេងដើមវិញ (${errDetail})`
      );
      return null;
    }
  };

  // 1-Click Fast Toggle Delivery Style (ធម្មតា ↔ ក្នុងចិត្ត) with Cache-First Instant Switching
  const handleToggleDeliveryType = async (segIdOrIndex, newDeliveryType = null, autoRegen = true, targetIndex = null) => {
    if (!scriptData?.segments) return null;
    const segIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < scriptData.segments.length
      ? targetIndex
      : scriptData.segments.findIndex((s, idx) => 
          (s._uid && String(s._uid) === String(segIdOrIndex)) ||
          s.id === segIdOrIndex || idx === segIdOrIndex || 
          String(s.id) === String(segIdOrIndex) || String(idx) === String(segIdOrIndex)
        );
    if (segIdx === -1) return null;

    const targetSeg = scriptData.segments[segIdx];
    const currentDelivery = targetSeg.deliveryType || 'out_loud';
    const nextDelivery = newDeliveryType || (currentDelivery === 'inner_thought' ? 'out_loud' : 'inner_thought');

    // Fast Return / No-op: clicking the active mode returns immediately with zero churn
    if (currentDelivery === nextDelivery && (targetSeg.audioUrl || targetSeg.audioPath || !autoRegen)) {
      return targetSeg;
    }

    const isThought = nextDelivery === 'inner_thought';
    const audioEffect = isThought ? 'inner_thought_reverb' : 'none';
    const activeVoiceId = targetSeg.khmerVoiceId || targetSeg.voiceId || voiceSettings.voiceId || 'km-KH-PisethNeural';
    const activeSpeed = targetSeg.userCustomSpeed ? targetSeg.speed : (voiceSettings.speed || 'normal');
    const currentKhmerText = (targetSeg.khmer || targetSeg.khmerText || targetSeg.khmerTranslatedText || '').trim();

    // Invalidate cached delivery variants if text or voice does not match
    const existingDeliveryVariants = (targetSeg.deliveryVariants && typeof targetSeg.deliveryVariants === 'object')
      ? { ...targetSeg.deliveryVariants }
      : {};

    // Record current audio into existingDeliveryVariants only if verified compatible with activeVoiceId
    if (isVerifiedSegmentAudioForVoice(targetSeg, activeVoiceId) && (!existingDeliveryVariants[currentDelivery] || existingDeliveryVariants[currentDelivery]?.text !== currentKhmerText)) {
      const curEff = targetSeg.audioEffect || (currentDelivery === 'inner_thought' ? 'inner_thought_reverb' : 'none');
      existingDeliveryVariants[currentDelivery] = {
        deliveryType: currentDelivery,
        audioEffect: curEff,
        effectConfig: targetSeg.effectConfig || null,
        effectConfigKey: normalizeEffectConfigKey(currentDelivery, curEff, targetSeg.effectConfig || null),
        audioUrl: targetSeg.audioUrl,
        audioFile: targetSeg.audioFile,
        audioPath: targetSeg.audioPath,
        audioDurationSec: targetSeg.audioDurationSec || targetSeg.audioDuration,
        voiceId: activeVoiceId,
        actualVoiceId: targetSeg.actualVoiceId || activeVoiceId,
        speed: activeSpeed,
        pitch: targetSeg.pitch || '+0Hz',
        text: currentKhmerText,
        provenanceVerified: Boolean(targetSeg.actualVoiceId === activeVoiceId || targetSeg.deliveryVariants?.[currentDelivery]?.provenanceVerified),
        timestamp: Date.now(),
      };
    }

    // Check client delivery cache (require exact voice, speed, pitch, text, effectConfig, and verified provenance)
    const cachedTargetVariant = existingDeliveryVariants[nextDelivery];
    const isLocalDeliveryHit = Boolean(
      cachedTargetVariant?.audioUrl &&
      cachedTargetVariant.provenanceVerified === true &&
      String(cachedTargetVariant.text || '').trim() === currentKhmerText &&
      cachedTargetVariant.voiceId === activeVoiceId &&
      (!cachedTargetVariant.actualVoiceId || cachedTargetVariant.actualVoiceId === activeVoiceId) &&
      isFilenameCompatibleWithVoice(cachedTargetVariant.audioFile || cachedTargetVariant.audioPath || cachedTargetVariant.audioUrl, activeVoiceId) &&
      normalizeVoiceSpeedKey(cachedTargetVariant.speed) === normalizeVoiceSpeedKey(activeSpeed) &&
      String(cachedTargetVariant.pitch || '+0Hz') === String(targetSeg.pitch || '+0Hz') &&
      (cachedTargetVariant.effectConfigKey || normalizeEffectConfigKey(nextDelivery, audioEffect, cachedTargetVariant.effectConfig || null)) === normalizeEffectConfigKey(nextDelivery, audioEffect, targetSeg.effectConfig || null)
    );

    const segKey = String(targetSeg._uid || targetSeg.id || segIdx);
    const currentSeq = (segmentRegenSeqRef.current[segKey] || 0) + 1;
    segmentRegenSeqRef.current[segKey] = currentSeq;

    // Instant Client Cache Hit: <100ms response, zero TTS synthesis, zero network requests
    if (isLocalDeliveryHit) {
      const updatedDeliveryVariants = {
        ...existingDeliveryVariants,
        [nextDelivery]: {
          ...cachedTargetVariant,
          timestamp: Date.now(),
        },
      };

      const committedSeg = {
        ...targetSeg,
        deliveryType: nextDelivery,
        deliveryOverride: true,
        deliveryConfidence: 1.0,
        deliveryReviewNeeded: false,
        audioEffect,
        audioUrl: cachedTargetVariant.audioUrl,
        audioFile: cachedTargetVariant.audioFile || targetSeg.audioFile,
        audioPath: cachedTargetVariant.audioPath || targetSeg.audioPath,
        audioDurationSec: cachedTargetVariant.audioDurationSec || targetSeg.audioDurationSec,
        audioDuration: cachedTargetVariant.audioDurationSec || targetSeg.audioDuration,
        textStatus: 'ready',
        audioOutdated: false,
        deliveryVariants: updatedDeliveryVariants,
      };

      const newSegments = [...scriptData.segments];
      newSegments[segIdx] = committedSeg;

      setScriptData((prev) => (prev ? {
        ...prev,
        segments: newSegments,
        updatedAt: Date.now(),
      } : prev));

      // Asynchronous background persistence without blocking UI
      if (seriesId && episodeId) {
        try {
          saveTimelineOperationToLocalStorage(seriesId, episodeId, {
            segments: newSegments,
            updatedAt: Date.now(),
          });
        } catch (_) {}
        persistTimelineOperationApi({
          seriesId,
          episodeId,
          operation: 'update_segments',
          segments: newSegments,
          updatedAt: Date.now(),
        }).catch(() => {});
      }

      setAudioGenerated(true);
      return committedSeg;
    }

    // Cache Miss: Generate or effect audio via backend (forceRegen: false reuses clean speech)
    const updatedSeg = {
      ...targetSeg,
      deliveryType: nextDelivery,
      deliveryOverride: true,
      deliveryConfidence: 1.0,
      deliveryReviewNeeded: false,
      audioEffect,
      textStatus: autoRegen ? 'generating' : targetSeg.textStatus,
      audioOutdated: true,
      deliveryVariants: existingDeliveryVariants,
    };

    const newSegments = [...scriptData.segments];
    newSegments[segIdx] = updatedSeg;

    setScriptData((prev) => (prev ? {
      ...prev,
      segments: newSegments,
      updatedAt: Date.now(),
    } : prev));
    invalidateRendered();

    if (autoRegen && currentKhmerText) {
      try {
        const rawMatchesDelivVoice = (updatedSeg.rawVoiceId === activeVoiceId) && isFilenameCompatibleWithVoice(updatedSeg.rawAudioPath, activeVoiceId);
        const regenerated = await generateSingleSegmentAudio({
          ...updatedSeg,
          rawAudioPath: rawMatchesDelivVoice ? updatedSeg.rawAudioPath : null,
          rawAudioFile: rawMatchesDelivVoice ? updatedSeg.rawAudioFile : null,
          rawVoiceId: rawMatchesDelivVoice ? updatedSeg.rawVoiceId : null,
        }, {
          speed: activeSpeed,
          voiceId: activeVoiceId,
          deliveryType: nextDelivery,
          audioEffect,
          deliveryOverride: true,
          forceRegen: false, // Reuses provenance-verified clean speech of the same voice!
          preserveTrim: true,
          projectName: getProjectName(),
          videoId: getVideoId(),
          episodeId,
          seriesId,
        });

        if (segmentRegenSeqRef.current[segKey] !== currentSeq) {
          return null;
        }

        const returnedDelivVoice = regenerated?.actualVoiceId || regenerated?.voiceId || regenerated?.khmerVoiceId;
        if (!regenerated || regenerated.voiceMismatch || regenerated.ttsStatus !== 'ready' || returnedDelivVoice !== activeVoiceId) {
          throw new Error(regenerated?.error || `Generated voice (${returnedDelivVoice || 'unknown'}) did not match requested voice (${activeVoiceId})`);
        }

        const mergedDeliveryVariants = {
          ...existingDeliveryVariants,
          ...(regenerated.deliveryVariants || {}),
          [nextDelivery]: {
            deliveryType: nextDelivery,
            audioEffect,
            effectConfig: regenerated.effectConfig || targetSeg.effectConfig || null,
            effectConfigKey: normalizeEffectConfigKey(nextDelivery, audioEffect, regenerated.effectConfig || targetSeg.effectConfig || null),
            audioUrl: regenerated.audioUrl,
            audioFile: regenerated.audioFile,
            audioPath: regenerated.audioPath,
            audioDurationSec: regenerated.audioDurationSec || regenerated.audioDuration,
            voiceId: activeVoiceId,
            actualVoiceId: returnedDelivVoice,
            speed: activeSpeed,
            pitch: regenerated.pitch || targetSeg.pitch || '+0Hz',
            text: currentKhmerText,
            textHash: regenerated.textHash || null,
            provenanceVerified: true,
            timestamp: Date.now(),
          },
        };

        const finalSegments = [...scriptData.segments];
        const matchIdx = finalSegments.findIndex((s, i) => i === segIdx || String(s.id) === String(targetSeg.id));
        const committedSeg = {
          ...regenerated,
          deliveryType: nextDelivery,
          deliveryOverride: true,
          audioEffect,
          textStatus: 'voice_updated',
          audioOutdated: false,
          deliveryVariants: mergedDeliveryVariants,
        };

        if (matchIdx !== -1) {
          finalSegments[matchIdx] = committedSeg;
        }

        setScriptData((prev) => (prev ? {
          ...prev,
          segments: finalSegments,
          updatedAt: Date.now(),
        } : prev));
        setAudioGenerated(true);
        invalidateRendered();

        // Non-blocking async background persistence
        if (seriesId && episodeId) {
          try {
            saveTimelineOperationToLocalStorage(seriesId, episodeId, {
              segments: finalSegments,
              updatedAt: Date.now(),
            });
          } catch (_) {}
          persistTimelineOperationApi({
            seriesId,
            episodeId,
            operation: 'update_segments',
            segments: finalSegments,
            updatedAt: Date.now(),
          }).catch(() => {});
        }

        return committedSeg;
      } catch (err) {
        if (segmentRegenSeqRef.current[segKey] !== currentSeq) {
          return null;
        }
        console.warn('Auto-regen inner thought audio failed:', err);
        const errorSegments = [...scriptData.segments];
        const matchIdx = errorSegments.findIndex((s, i) => i === segIdx || String(s.id) === String(targetSeg.id));
        if (matchIdx !== -1) {
          errorSegments[matchIdx] = {
            ...targetSeg,
            textStatus: 'error',
            regenError: err.message || 'Inner thought generation failed',
          };
        }
        setScriptData((prev) => (prev ? {
          ...prev,
          segments: errorSegments,
          updatedAt: Date.now(),
        } : prev));
        return null;
      }
    }
    return updatedSeg;
  };

  // Update an individual segment's Khmer subtitle text with optional auto-regeneration
  const handleUpdateSegmentText = async (segIdOrIndex, newText, autoRegen = false, targetIndex = null) => {
    if (!scriptData?.segments) return null;
    const segIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < scriptData.segments.length
      ? targetIndex
      : scriptData.segments.findIndex((s, idx) => 
          s.id === segIdOrIndex || idx === segIdOrIndex || 
          String(s.id) === String(segIdOrIndex) || String(idx) === String(segIdOrIndex)
        );
    if (segIdx === -1) return null;

    const targetSeg = scriptData.segments[segIdx];
    const segKey = String(targetSeg?.id ?? segIdx);
    const cleanText = (newText || '').trim();

    // Sequence token to prevent stale out-of-order in-flight responses from overwriting newer edits
    const currentSeq = (segmentRegenSeqRef.current[segKey] || 0) + 1;
    segmentRegenSeqRef.current[segKey] = currentSeq;

    const updatedSeg = {
      ...targetSeg,
      khmer: newText,
      khmerText: newText,
      khmerTranslatedText: newText,
      audioOutdated: true,
      textStatus: autoRegen ? 'generating' : 'text_updated',
    };

    setScriptData((prev) => {
      if (!prev?.segments) return prev;
      const idx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < prev.segments.length
        ? targetIndex
        : prev.segments.findIndex((s, i) => s.id === segIdOrIndex || i === segIdOrIndex || String(s.id) === String(segIdOrIndex) || String(i) === String(segIdOrIndex));
      if (idx === -1) return prev;
      const nextSegs = [...prev.segments];
      nextSegs[idx] = {
        ...nextSegs[idx],
        khmer: newText,
        khmerText: newText,
        khmerTranslatedText: newText,
        audioOutdated: true,
        textStatus: autoRegen ? 'generating' : 'text_updated',
      };
      return { ...prev, segments: nextSegs, updatedAt: Date.now() };
    });
    invalidateRendered();

    if (autoRegen && cleanText) {
      const dramaName = getProjectName();
      const videoId = getVideoId();
      const targetVoiceId = updatedSeg.voiceId || (updatedSeg.speakerGender === 'FEMALE' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural');
      const activeSpeed = updatedSeg.userCustomSpeed ? updatedSeg.speed : (voiceSettings.speed || 'normal');

      try {
        console.log(`🎙️ [Auto-Regen] Generating audio for segment #${segKey} ("${cleanText}")...`);
        const regenerated = await generateSingleSegmentAudio({
          ...updatedSeg,
          projectName: dramaName,
          videoId: videoId,
          seriesId,
          episodeId,
        }, {
          speed: activeSpeed,
          voiceId: targetVoiceId,
          projectName: dramaName,
          videoId: videoId,
          seriesId,
          episodeId,
          forceRegen: true,
        });

        // If user changed the text again while this request was in flight, discard the stale result!
        if (segmentRegenSeqRef.current[segKey] !== currentSeq) {
          console.log(`[Auto-Regen] Discarding stale audio response for segment #${segKey} (seq mismatch ${currentSeq} vs ${segmentRegenSeqRef.current[segKey]})`);
          return null;
        }

        const rawStart = (typeof targetSeg.audioStartSec === 'number' && !isNaN(targetSeg.audioStartSec))
          ? targetSeg.audioStartSec
          : (typeof targetSeg.startSec === 'number' && !isNaN(targetSeg.startSec) ? targetSeg.startSec : 0);
        const effAudioStart = typeof regenerated?.audioStartSec === 'number' ? regenerated.audioStartSec : rawStart;
        const effAudioDur = typeof regenerated?.audioDurationSec === 'number' ? regenerated.audioDurationSec : (targetSeg.audioDurationSec || 2.5);
        const effAudioEnd = parseFloat((effAudioStart + effAudioDur).toFixed(2));
        const cacheBustedUrl = regenerated?.audioUrl 
          ? (regenerated.audioUrl.includes('?t=') ? regenerated.audioUrl : `${regenerated.audioUrl}?t=${Date.now()}`)
          : null;

        const currentItem = (scriptData?.segments && scriptData.segments[segIdx]) || targetSeg;
        const isTextStillCurrent = (currentItem?.khmer || '').trim() === cleanText;

        const curDeliv = currentItem?.deliveryType || 'out_loud';
        const curEff = currentItem?.audioEffect || (curDeliv === 'inner_thought' ? 'inner_thought_reverb' : 'none');
        const textVariants = {
          ...(regenerated?.voiceAudioVariants || {}),
          [targetVoiceId]: {
            voiceId: targetVoiceId,
            actualVoiceId: regenerated?.actualVoiceId || targetVoiceId,
            audioUrl: cacheBustedUrl,
            audioFile: regenerated.audioFile,
            audioPath: regenerated.audioPath,
            audioDurationSec: effAudioDur,
            speed: activeSpeed,
            pitch: regenerated?.pitch || currentItem?.pitch || '+0Hz',
            deliveryType: curDeliv,
            audioEffect: curEff,
            effectConfig: currentItem?.effectConfig || null,
            effectConfigKey: normalizeEffectConfigKey(curDeliv, curEff, currentItem?.effectConfig || null),
            text: newText,
            textHash: regenerated?.textHash || null,
            provenanceVerified: true,
            timestamp: Date.now(),
          },
        };

        const merged = {
          ...currentItem,
          ...regenerated,
          audioOffset: 0,
          audioTrimmed: false,
          userTrimmed: false,
          audioUrl: cacheBustedUrl,
          khmer: newText,
          khmerText: newText,
          khmerTranslatedText: newText,
          audioStartSec: effAudioStart,
          audioEndSec: effAudioEnd,
          audioDurationSec: effAudioDur,
          voiceId: targetVoiceId,
          speed: activeSpeed,
          voiceAudioVariants: textVariants,
          audioOutdated: !isTextStillCurrent,
          textStatus: isTextStillCurrent ? 'voice_updated' : 'text_updated',
        };
        if (isTextStillCurrent) {
          delete merged.regenError;
        }

        setScriptData((prev) => {
          if (!prev?.segments) return prev;
          const idx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < prev.segments.length
            ? targetIndex
            : prev.segments.findIndex((s, i) => s.id === segIdOrIndex || i === segIdOrIndex || String(s.id) === String(segIdOrIndex) || String(i) === String(segIdOrIndex));
          if (idx === -1) return prev;

          const nextSegs = [...prev.segments];
          nextSegs[idx] = {
            ...nextSegs[idx],
            ...merged,
          };
          return { ...prev, segments: nextSegs, updatedAt: Date.now() };
        });

        setAudioGenerated(true);
        invalidateRendered();

        const allUpdatedSegments = (scriptData?.segments || []).map((s, i) => {
          if (s.id === segIdOrIndex || i === segIdx || String(s.id) === String(segIdOrIndex)) {
            return merged;
          }
          return s;
        });

        if (allUpdatedSegments && allUpdatedSegments.some((s) => s.audioFile || s.audioPath || s.audioUrl)) {
          // Trigger non-blocking background timeline audio sync to keep UI lightning fast (<1.5s)
          syncTimelineAudioApi(allUpdatedSegments, dramaName, videoId, episodeId, seriesId)
            .then((syncRes) => {
              if (syncRes?.fullAudioUrl) {
                const cacheBusted = `${syncRes.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
                setFullAudioUrl(cacheBusted);
                setFullAudioPath(syncRes.fullAudioPath);
                setAudioGenerated(true);
              }
            })
            .catch((syncErr) => {
              console.warn('Auto re-sync timeline audio notice:', syncErr.message);
            });
        }

        const stillOutdated = allUpdatedSegments ? allUpdatedSegments.some((s) => s.audioOutdated) : false;
        setAudioOutdated(stillOutdated);

        return merged;
      } catch (err) {
        console.warn('Auto-regen text speech error:', err);
        setScriptData((prev) => {
          if (!prev?.segments) return prev;
          const idx = prev.segments.findIndex((s, i) => s.id === segIdOrIndex || i === segIdOrIndex || String(s.id) === String(segIdOrIndex) || String(i) === String(segIdOrIndex));
          if (idx === -1) return prev;
          const nextSegs = [...prev.segments];
          nextSegs[idx] = {
            ...nextSegs[idx],
            audioOutdated: true,
            textStatus: 'error',
            regenError: err.message,
          };
          return { ...prev, segments: nextSegs, updatedAt: Date.now() };
        });
        return null;
      }
    }
    return updatedSeg;
  };

  // Split a long segment into two consecutive segments (e.g. 10-18 words each)
  const handleSplitSegment = async (segIdOrIndex, targetIndex = null) => {
    if (!scriptData?.segments) return null;
    const segIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < scriptData.segments.length
      ? targetIndex
      : scriptData.segments.findIndex((s, idx) => 
          s.id === segIdOrIndex || idx === segIdOrIndex || 
          String(s.id) === String(segIdOrIndex) || String(idx) === String(segIdOrIndex)
        );
    if (segIdx === -1) return null;

    const targetSeg = scriptData.segments[segIdx];
    const fullText = (targetSeg.khmer || '').trim();
    const [part1, part2] = splitKhmerTextIntoHalves(fullText);
    if (!part2) {
      alert('ឃ្លានេះខ្លីល្មមហើយ មិនចាំបាច់ពុះទៀតទេ!');
      return null;
    }

    const s = (typeof targetSeg.audioStartSec === 'number' && !isNaN(targetSeg.audioStartSec))
      ? targetSeg.audioStartSec
      : (typeof targetSeg.startSec === 'number' && !isNaN(targetSeg.startSec)
        ? targetSeg.startSec
        : parseTimeToSeconds(targetSeg.start, 0));
    const e = (typeof targetSeg.audioEndSec === 'number' && !isNaN(targetSeg.audioEndSec))
      ? targetSeg.audioEndSec
      : (typeof targetSeg.endSec === 'number' && !isNaN(targetSeg.endSec)
        ? targetSeg.endSec
        : parseTimeToSeconds(targetSeg.end, s + 4.5));

    const dur = Math.max(2.0, e - s);
    const midSec = Number((s + dur / 2).toFixed(2));

    const uid1 = `seg_${Date.now()}_a_${Math.random().toString(36).substr(2, 4)}`;
    const uid2 = `seg_${Date.now()}_b_${Math.random().toString(36).substr(2, 4)}`;
    const hasAudio = Boolean(targetSeg.audioGenerated || targetSeg.audioFile || targetSeg.audioUrl);

    const seg1 = {
      ...targetSeg,
      _uid: uid1,
      start: formatTimecode(s),
      end: formatTimecode(midSec),
      khmer: part1,
      audioStartSec: s,
      audioEndSec: midSec,
      audioDurationSec: Number((dur / 2).toFixed(2)),
      audioGenerated: hasAudio,
      audioFile: targetSeg.audioFile || null,
      audioPath: targetSeg.audioPath || null,
      audioUrl: targetSeg.audioUrl || null,
      audioFileName: targetSeg.audioFileName || null,
      audioOutdated: false,
    };

    const seg2 = {
      ...targetSeg,
      _uid: uid2,
      id: `${targetSeg.id || segIdx + 1}_b`,
      start: formatTimecode(midSec),
      end: formatTimecode(e),
      khmer: part2,
      audioStartSec: midSec,
      audioEndSec: e,
      audioDurationSec: Number((dur / 2).toFixed(2)),
      audioGenerated: hasAudio,
      audioFile: targetSeg.audioFile || null,
      audioPath: targetSeg.audioPath || null,
      audioUrl: targetSeg.audioUrl || null,
      audioFileName: targetSeg.audioFileName || null,
      audioOutdated: false,
    };

    const newSegments = [...scriptData.segments];
    newSegments.splice(segIdx, 1, seg1, seg2);

    // Re-index all segments cleanly
    const reindexed = newSegments.map((sItem, idx) => ({
      ...sItem,
      id: idx + 1,
      segmentId: idx + 1,
    }));

    setScriptData((prev) => (prev ? {
      ...prev,
      segments: reindexed,
      updatedAt: Date.now(),
    } : prev));
    invalidateRendered();

    if (setSelectedSegmentId) {
      setSelectedSegmentId(uid2);
    }

    // Auto-generate audio for both new parts
    const targetVoiceId = targetSeg.voiceId || (targetSeg.speakerGender === 'FEMALE' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural');
    const activeSpeed = targetSeg.userCustomSpeed ? targetSeg.speed : (voiceSettings.speed || 'normal');
    
    try {
      const [res1, res2] = await Promise.all([
        generateSingleSegmentAudio(seg1, { speed: activeSpeed, voiceId: targetVoiceId, forceRegen: true }).catch(() => null),
        generateSingleSegmentAudio(seg2, { speed: activeSpeed, voiceId: targetVoiceId, forceRegen: true }).catch(() => null),
      ]);

      const finalSegments = [...reindexed];
      if (res1) {
        finalSegments[segIdx] = { ...finalSegments[segIdx], ...res1, audioOutdated: false };
      }
      if (res2) {
        finalSegments[segIdx + 1] = { ...finalSegments[segIdx + 1], ...res2, audioOutdated: false };
      }

      setScriptData((prev) => (prev ? {
        ...prev,
        segments: finalSegments,
        updatedAt: Date.now(),
      } : prev));
      setAudioGenerated(true);

      syncTimelineAudioApi(finalSegments, getProjectName(), getVideoId(), episodeId, seriesId)
        .then((syncRes) => {
          if (syncRes.fullAudioUrl) {
            const cacheBusted = `${syncRes.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
            setFullAudioUrl(cacheBusted);
            setFullAudioPath(syncRes.fullAudioPath);
          }
        })
        .catch(() => {});
    } catch (err) {
      console.warn('Auto-regen split segments error:', err);
    }

    return reindexed;
  };

  // Generate Speech Audio for All Segments via Multi-Voice TTS API
  const handleGenerateAudio = async (overrideParams = {}) => {
    if (!scriptData || !scriptData.segments || scriptData.segments.length === 0) {
      alert('សូមបង្កើត Script ឬបកប្រែជាមុនសិន!');
      return;
    }

    const isEvent = Boolean(overrideParams && (overrideParams.nativeEvent || overrideParams._reactName || typeof overrideParams.preventDefault === 'function'));
    const cleanParams = isEvent ? {} : (overrideParams || {});

    const activeVoiceId = cleanParams.voiceId || voiceSettings.voiceId || 'km-KH-PisethNeural';
    const activeSpeed = cleanParams.speed || voiceSettings.speed || 'normal';
    const forceRegen = Boolean(cleanParams.forceRegen);

    if (videoRef?.current && !videoRef.current.paused) {
      videoRef.current.pause();
      if (setIsPlaying) setIsPlaying(false);
    }

    if (activeVoiceId !== voiceSettings.voiceId || activeSpeed !== voiceSettings.speed) {
      if (setVoiceSettings) {
        setVoiceSettings((prev) => ({
          ...prev,
          voiceId: activeVoiceId,
          speed: activeSpeed,
        }));
      }
    }

    const speakerMap = {};
    const sortedSpeakers = Object.values(speakerRegistry || {}).sort((a, b) => (a.lineCount || 0) - (b.lineCount || 0));
    sortedSpeakers.forEach((spk) => {
      if (spk.voiceId) {
        if (spk.id) speakerMap[spk.id] = spk.voiceId;
        const isGeneric = !spk.name || spk.name === 'តួអង្គ' || String(spk.name).toLowerCase() === 'speaker';
        if (!isGeneric) speakerMap[spk.name] = spk.voiceId;
      }
    });

    const targetEpisodeId = episodeId;
    setGeneratingAudioEpisodeId(targetEpisodeId);
    setIsGeneratingAudio(true);
    setAudioProgress(10);
    setAudioStage('1/3 កំពុងរៀបចំឃ្លាសន្ទនា និង Voice Mapping...');

    if (audioProgressTimerRef.current) {
      clearInterval(audioProgressTimerRef.current);
      audioProgressTimerRef.current = null;
    }

    try {
      const sanitizedSegments = (scriptData.segments || []).map((seg) => {
        const isManualOverride = Boolean(seg.userOverridden || seg.voiceAssignmentSource === 'manual' || seg.voiceOverride);
        const rawGender = String(seg.voiceGender || seg.speakerGender || seg.gender || '').toUpperCase().trim();
        const explicitKnown = (rawGender === 'FEMALE' || rawGender === 'GIRL' || rawGender === 'WOMAN')
          ? 'FEMALE'
          : ((rawGender === 'MALE' || rawGender === 'BOY' || rawGender === 'MAN') ? 'MALE' : '');
        const hasVerifiedStep1Voice = Boolean(
          seg.speakerStatus === 'verified' ||
          seg.voiceAssignmentSource === 'multimodal_verified' ||
          seg.voiceAssignmentSource === 'series_glossary' ||
          (explicitKnown && !seg.unverifiedSpeaker)
        );
        // Never reassign verified Step 1 voices using translated Khmer dialogue text or transliterated name substrings
        const titleGender = hasVerifiedStep1Voice ? explicitKnown : detectSpeakerGender(seg.speaker, '', '');
        const detectedGender = isManualOverride
          ? (explicitKnown || titleGender || 'UNKNOWN')
          : (hasVerifiedStep1Voice
              ? explicitKnown
              : (titleGender !== 'UNKNOWN' ? titleGender : (explicitKnown || 'UNKNOWN')));
        const existingVoice = seg.voiceOverride || seg.khmerVoiceId || seg.voiceId || seg.voice;
        const resolvedVoice = isManualOverride
          ? (existingVoice || (detectedGender === 'FEMALE' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural'))
          : (detectedGender === 'FEMALE'
              ? 'km-KH-SreymomNeural'
              : (detectedGender === 'MALE'
                  ? 'km-KH-PisethNeural'
                  : (existingVoice || 'km-KH-PisethNeural')));

        const base = !seg.userShifted ? { ...seg, userShifted: false } : { ...seg };
        delete base.autoShifted;
        return {
          ...base,
          speakerGender: detectedGender,
          voiceGender: detectedGender === 'FEMALE' ? 'female' : (detectedGender === 'MALE' ? 'male' : 'unknown'),
          gender: detectedGender === 'FEMALE' ? 'female' : (detectedGender === 'MALE' ? 'male' : 'unknown'),
          voiceId: resolvedVoice,
          khmerVoiceId: resolvedVoice,
        };
      });

      // 1. Guard against empty-text segments in batch generation
      const validSegments = sanitizedSegments.filter((seg) => {
        const txt = (seg.khmer || seg.khmerText || seg.khmerTranslatedText || '').trim();
        return Boolean(txt);
      });
      const skippedEmptyCount = sanitizedSegments.length - validSegments.length;

      if (validSegments.length === 0) {
        const alertMsg = 'មិនមានឃ្លាណាដែលមានអត្ថបទខ្មែរសម្រាប់បង្កើតសំឡេងទេ! សូមបកប្រែ ឬវាយអត្ថបទជាមុនសិន។';
        alert(alertMsg);
        setIsGeneratingAudio(false);
        setGeneratingAudioEpisodeId(null);
        return;
      }

      setAudioProgress(12);
      setAudioStage(
        skippedEmptyCount > 0
          ? `2/3 Microsoft Edge Neural AI កំពុងបង្កើតសំឡេង (0/${validSegments.length} ឃ្លា, រំលង ${skippedEmptyCount} ឃ្លាខ្វះអត្ថបទ)...`
          : `2/3 Microsoft Edge Neural AI កំពុងបង្កើតសំឡេងខ្មែរ (0/${validSegments.length})...`
      );

      const dramaName = selectedVideo?.fileName
        ? selectedVideo.fileName.replace(/\.[^/.]+$/, '').trim()
        : (scriptData?.title || 'drama_project');
      const targetEpisodeId = episodeId;
      const targetSeriesId = seriesId;

      // Start live progress poller to track real percentage & segment count from backend
      if (audioProgressTimerRef.current) {
        clearInterval(audioProgressTimerRef.current);
      }
      if (targetSeriesId && targetEpisodeId) {
        audioProgressTimerRef.current = setInterval(async () => {
          try {
            const pRes = await fetch(`/api/tts/progress?seriesId=${encodeURIComponent(targetSeriesId)}&episodeId=${encodeURIComponent(targetEpisodeId)}&total=${validSegments.length}`);
            const pData = await pRes.json();
            if (pData && pData.success && typeof pData.current === 'number') {
              const totalCount = pData.total || validSegments.length;
              const currentCount = totalCount > 0 ? Math.min(totalCount, Math.max(0, pData.current)) : Math.max(0, pData.current);
              if (pData.stage === 'syncing') {
                setAudioProgress((prev) => Math.max(prev, 96));
                setAudioStage('3/3 កំពុង Syncing Master Narration Timeline...');
              } else {
                const pct = totalCount > 0 ? Math.min(95, Math.max(12, Math.round((currentCount / totalCount) * 82) + 12)) : 12;
                setAudioProgress((prev) => Math.max(prev, pct));
                const realPct = totalCount > 0 ? Math.min(100, Math.round((currentCount / totalCount) * 100)) : 0;
                setAudioStage(`2/3 Microsoft Edge Neural AI: [${currentCount}/${totalCount} ឃ្លា] (${realPct}%)...`);
                console.log(`[TTS Progress] 🎙️ ${currentCount}/${totalCount} (${realPct}%) ${pData.lastFile || ''}`);
              }
            }
          } catch (_) {}
        }, 800);
      }

      const result = await generateAudioApi({
        segments: validSegments,
        voiceId: activeVoiceId,
        speed: activeSpeed,
        speakerMap,
        projectName: dramaName,
        videoId: selectedVideo?.videoId,
        seriesId: targetSeriesId,
        episodeId: targetEpisodeId,
        forceRegen,
      });

      if (audioProgressTimerRef.current) {
        clearInterval(audioProgressTimerRef.current);
        audioProgressTimerRef.current = null;
      }

      if (!result.alreadyCompleted) {
        setAudioProgress((prev) => Math.max(prev, 96));
        setAudioStage('3/3 កំពុង Syncing Master Narration Timeline...');
      }

      const updatedMap = new Map((result.segments || []).map((s) => [String(s.id), s]));
      const mergedSegments = (scriptData?.segments || []).map((s) => updatedMap.get(String(s.id)) || s);

      const failedCount = Number(result?.failedCount || 0);
      const hasFailures = failedCount > 0;

      // Episode switch protection: If user switched episodes during generation,
      // DO NOT attach EP1 audio to EP2 workspace! Save to background store instead.
      if (targetEpisodeId && targetEpisodeId !== activeTtsEpisodeRef.current) {
        console.log(`[Stale TTS Guard] Dropping audio state overwrite for episode ${targetEpisodeId} (active is ${activeTtsEpisodeRef.current})`);
        if (onSaveEpisodeBackground) {
          onSaveEpisodeBackground(targetEpisodeId, {
            scriptData: { ...scriptData, segments: mergedSegments, updatedAt: Date.now() },
            fullAudioPath: result.fullAudioPath,
            fullAudioUrl: result.fullAudioUrl,
            audioGenerated: !hasFailures,
            audioOutdated: hasFailures ? true : false,
            ...((!result.alreadyCompleted || hasFailures) ? { renderedVideo: null, renderInvalidatedAt: Date.now() } : {}),
          });
        }
        return;
      }

      if (hasFailures) {
        const completedCount = Math.max(0, validSegments.length - failedCount);
        const partialPct = validSegments.length > 0 ? Math.round((completedCount / validSegments.length) * 100) : 0;
        setAudioProgress(partialPct);
        setAudioStage(`⚠️ សំយោគបាន ${completedCount}/${validSegments.length} ឃ្លា (${failedCount} ឃ្លាបរាជ័យ - សូមចុច Generate TTS ម្តងទៀត)`);
        setAudioOutdated(true);
        setAudioGenerated(false);
      } else {
        setAudioProgress(100);
        const summaryMsg = result.alreadyCompleted
          ? (result.summaryMessage || `✅ សំឡេងខ្មែរ AI មានរួចរាល់ ${validSegments.length} ឃ្លា (រក្សាទុកដើម)!`)
          : skippedEmptyCount > 0
            ? `✅ បង្កើតសំឡេង AI ជោគជ័យ ${validSegments.length} ឃ្លា (រំលង ${skippedEmptyCount} ឃ្លា គ្មានអត្ថបទ)!`
            : `✅ បង្កើតសំឡេងខ្មែរ AI ជោគជ័យ ${validSegments.length} ឃ្លា (100%)!`;
        setAudioStage(summaryMsg);
        setAudioGenerated(true);
        setAudioOutdated(false);
      }

      setScriptData((prev) => {
        if (!prev?.segments) return prev;
        return {
          ...prev,
          segments: prev.segments.map((s) => {
            const updated = updatedMap.get(String(s.id));
            if (!updated) return s;
            const segVoiceId = updated.voiceId || updated.khmerVoiceId || s.voiceId || s.khmerVoiceId || activeVoiceId;
            const segDelivery = updated.deliveryType || s.deliveryType || 'out_loud';
            const segEffect = updated.audioEffect || s.audioEffect || (segDelivery === 'inner_thought' ? 'inner_thought_reverb' : 'none');
            const returnedVoice = updated.actualVoiceId || segVoiceId;
            const isVerifiedBatchVoice = !updated.voiceMismatch && updated.ttsStatus === 'ready' && returnedVoice === segVoiceId;
            const updatedVariants = {
              ...(s.voiceAudioVariants || {}),
              ...(updated.voiceAudioVariants || {}),
              ...(updated.audioUrl && isVerifiedBatchVoice ? {
                [segVoiceId]: {
                  voiceId: segVoiceId,
                  actualVoiceId: returnedVoice,
                  audioUrl: updated.audioUrl,
                  audioFile: updated.audioFile,
                  audioPath: updated.audioPath,
                  audioDurationSec: updated.audioDurationSec || updated.audioDuration,
                  speed: updated.speed || s.speed,
                  pitch: updated.pitch || s.pitch || '+0Hz',
                  deliveryType: segDelivery,
                  audioEffect: segEffect,
                  effectConfig: updated.effectConfig || s.effectConfig || null,
                  effectConfigKey: normalizeEffectConfigKey(segDelivery, segEffect, updated.effectConfig || s.effectConfig || null),
                  text: updated.khmer || updated.khmerText || s.khmer || s.khmerText || '',
                  textHash: updated.textHash || null,
                  provenanceVerified: true,
                  timestamp: Date.now(),
                },
              } : {}),
            };
            return {
              ...s,
              ...updated,
              voiceAudioVariants: updatedVariants,
            };
          }),
          updatedAt: Date.now(),
        };
      });
      setFullAudioPath(result.fullAudioPath);
      setFullAudioUrl(result.fullAudioUrl);
      if (!result.alreadyCompleted || hasFailures) {
        invalidateRendered(targetEpisodeId);
      }

      if (!hasFailures) {
        setTimeout(() => {
          setAudioProgress(0);
          setAudioStage('');
        }, 3000);
      }
    } catch (err) {
      if (audioProgressTimerRef.current) clearInterval(audioProgressTimerRef.current);
      setAudioProgress(0);
      setAudioStage('');
      console.error(err);
      alert('Error generating audio: ' + err.message);
    } finally {
      if (audioProgressTimerRef.current) clearInterval(audioProgressTimerRef.current);
      setIsGeneratingAudio(false);
      setGeneratingAudioEpisodeId(null);
    }
  };

  // Regenerate Audio for a Single Segment
  const handleRegenerateSingleSegment = async (segId, overrideSpeed = null, targetIndex = null, overrideText = null) => {
    if (!scriptData?.segments) return null;
    const segIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < scriptData.segments.length
      ? targetIndex
      : scriptData.segments.findIndex((s, idx) => 
          s.id === segId || idx === segId || 
          String(s.id) === String(segId) || String(idx) === String(segId)
        );
    if (segIdx === -1) return null;

    const baseSeg = scriptData.segments[segIdx];
    const segNum = baseSeg.index || baseSeg.episodeNumber || (segIdx + 1);

    // Compute textToUse FIRST
    const rawCandidate = (typeof overrideText === 'string')
      ? overrideText
      : (baseSeg.khmer || baseSeg.khmerText || baseSeg.khmerTranslatedText || '');
    const textToUse = typeof rawCandidate === 'string' ? rawCandidate.trim() : '';

    // Guard: If empty after trim, refuse gracefully without calling the API
    if (!textToUse) {
      const emptyMsg = `Segment #${segNum} គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន`;
      console.warn(`[TTS Guard] ${emptyMsg}`);
      alert(emptyMsg);

      if (setSelectedSegmentId) {
        setSelectedSegmentId(baseSeg.id ?? segIdx);
      }

      // Select / focus that segment's text in the Inspector so the user lands exactly where the fix happens
      setTimeout(() => {
        const el = document.getElementById('inspector-khmer-textarea') || document.querySelector('textarea[placeholder*="ភាសាខ្មែរ"]');
        if (el) {
          el.focus();
          el.select?.();
        }
      }, 60);

      return null;
    }

    const segKey = String(baseSeg?.id ?? segIdx);

    const currentSeq = (segmentRegenSeqRef.current[segKey] || 0) + 1;
    segmentRegenSeqRef.current[segKey] = currentSeq;

    const targetSeg = {
      ...baseSeg,
      khmer: textToUse,
      khmerText: textToUse,
      khmerTranslatedText: textToUse,
    };

    const targetVoiceId = targetSeg.voiceId || (targetSeg.speakerGender === 'FEMALE' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural');
    const activeSpeed = overrideSpeed !== null
      ? overrideSpeed
      : (targetSeg.userCustomSpeed ? targetSeg.speed : (voiceSettings.speed || 'normal'));

    try {
      const dramaName = getProjectName();
      const videoId = getVideoId();

      const updatedSeg = await generateSingleSegmentAudio(targetSeg, {
        speed: activeSpeed,
        userCustomSpeed: overrideSpeed !== null ? isCustomClipSpeed(overrideSpeed) : Boolean(targetSeg.userCustomSpeed),
        voiceId: targetVoiceId,
        forceRegen: true,
        projectName: dramaName,
        videoId: videoId,
        episodeId,
        seriesId,
      });

      if (segmentRegenSeqRef.current[segKey] !== currentSeq) {
        console.log(`[Regen] Discarding stale audio response for segment #${segKey}`);
        return null;
      }

      const rawStart = (typeof targetSeg.audioStartSec === 'number' && !isNaN(targetSeg.audioStartSec))
        ? targetSeg.audioStartSec
        : (typeof targetSeg.startSec === 'number' && !isNaN(targetSeg.startSec) ? targetSeg.startSec : 0);
      const effAudioStart = typeof updatedSeg.audioStartSec === 'number' ? updatedSeg.audioStartSec : rawStart;
      const effAudioDur = typeof updatedSeg.audioDurationSec === 'number' ? updatedSeg.audioDurationSec : (targetSeg.audioDurationSec || 2.5);
      const effAudioEnd = parseFloat((effAudioStart + effAudioDur).toFixed(2));
      const cacheBustedUrl = updatedSeg?.audioUrl
        ? (updatedSeg.audioUrl.includes('?t=') ? updatedSeg.audioUrl : `${updatedSeg.audioUrl}?t=${Date.now()}`)
        : null;

      const currentItem = (scriptData?.segments && scriptData.segments[segIdx]) || baseSeg || targetSeg;
      const curDeliv = updatedSeg?.deliveryType || currentItem?.deliveryType || 'out_loud';
      const curEff = updatedSeg?.audioEffect || currentItem?.audioEffect || (curDeliv === 'inner_thought' ? 'inner_thought_reverb' : 'none');
      const prevTxt = (baseSeg.khmer || baseSeg.khmerText || baseSeg.khmerTranslatedText || '').trim();
      const currentItemVariants = (prevTxt === textToUse)
        ? ((currentItem?.voiceAudioVariants && typeof currentItem.voiceAudioVariants === 'object')
          ? currentItem.voiceAudioVariants
          : (targetSeg.voiceAudioVariants || {}))
        : {};
      const updatedVariants = {
        ...currentItemVariants,
        ...(updatedSeg?.voiceAudioVariants || {}),
        [targetVoiceId]: {
          voiceId: targetVoiceId,
          actualVoiceId: updatedSeg?.actualVoiceId || targetVoiceId,
          audioUrl: cacheBustedUrl,
          audioFile: updatedSeg.audioFile,
          audioPath: updatedSeg.audioPath,
          audioDurationSec: effAudioDur,
          speed: activeSpeed,
          pitch: updatedSeg?.pitch || currentItem?.pitch || '+0Hz',
          deliveryType: curDeliv,
          audioEffect: curEff,
          effectConfig: updatedSeg?.effectConfig || currentItem?.effectConfig || null,
          effectConfigKey: normalizeEffectConfigKey(curDeliv, curEff, updatedSeg?.effectConfig || currentItem?.effectConfig || null),
          text: textToUse,
          textHash: updatedSeg?.textHash || null,
          provenanceVerified: true,
          timestamp: Date.now(),
        },
      };

      const merged = {
        ...currentItem,
        ...updatedSeg,
        audioOffset: 0,
        audioTrimmed: false,
        userTrimmed: false,
        khmer: textToUse,
        khmerText: textToUse,
        khmerTranslatedText: textToUse,
        audioUrl: cacheBustedUrl,
        audioStartSec: effAudioStart,
        audioEndSec: effAudioEnd,
        audioDurationSec: effAudioDur,
        voiceId: targetVoiceId,
        speed: activeSpeed,
        userCustomSpeed: overrideSpeed !== null ? isCustomClipSpeed(overrideSpeed) : Boolean(targetSeg.userCustomSpeed),
        voiceAudioVariants: updatedVariants,
        audioOutdated: false,
        textStatus: 'voice_updated',
      };
      delete merged.regenError;

      setScriptData((prev) => {
        if (!prev?.segments) return prev;
        const idx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < prev.segments.length
          ? targetIndex
          : prev.segments.findIndex((s, i) => s.id === segId || i === segId || String(s.id) === String(segId) || String(i) === String(segId));
        if (idx === -1) return prev;

        const nextSegs = [...prev.segments];
        nextSegs[idx] = {
          ...nextSegs[idx],
          ...merged,
        };
        return { ...prev, segments: nextSegs, updatedAt: Date.now() };
      });

      setAudioGenerated(true);
      invalidateRendered();

      const allUpdatedSegments = (scriptData?.segments || []).map((s, i) => {
        if (s.id === segId || i === segIdx || String(s.id) === String(segId)) {
          return merged;
        }
        return s;
      });

      if (allUpdatedSegments && allUpdatedSegments.some((s) => s.audioFile || s.audioPath || s.audioUrl)) {
        // Trigger non-blocking background timeline audio sync to keep UI lightning fast (<1.5s)
        syncTimelineAudioApi(allUpdatedSegments, dramaName, videoId, episodeId, seriesId)
          .then((syncRes) => {
            if (syncRes?.fullAudioUrl) {
              const cacheBusted = `${syncRes.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
              setFullAudioUrl(cacheBusted);
              setFullAudioPath(syncRes.fullAudioPath);
              setAudioGenerated(true);
            }
          })
          .catch((syncErr) => {
            console.warn('Auto re-sync timeline audio notice:', syncErr.message);
          });
      }

      const stillOutdated = allUpdatedSegments ? allUpdatedSegments.some((s) => s.audioOutdated) : false;
      setAudioOutdated(stillOutdated);

      return merged;
    } catch (err) {
      console.error('Failed to regenerate single segment:', err);
      setScriptData((prev) => {
        if (!prev?.segments) return prev;
        const idx = prev.segments.findIndex((s, i) => s.id === segId || i === segId || String(s.id) === String(segId) || String(i) === String(segId));
        if (idx === -1) return prev;
        const nextSegs = [...prev.segments];
        nextSegs[idx] = {
          ...nextSegs[idx],
          audioOutdated: true,
          textStatus: 'error',
          regenError: err.message,
        };
        return { ...prev, segments: nextSegs, updatedAt: Date.now() };
      });
      return null;
    }
  };

  // Update Voice Settings & synchronize segment speed
  const handleUpdateVoiceSettings = (newSettings) => {
    const speedChanged = newSettings.speed !== voiceSettings.speed;
    const voiceChanged = newSettings.voiceId !== voiceSettings.voiceId;

    if (audioGenerated && (speedChanged || voiceChanged)) {
      setAudioOutdated(true);
    }

    if (speedChanged && scriptData?.segments) {
      const updatedSegments = scriptData.segments.map((seg) => ({
        ...seg,
        speed: seg.userCustomSpeed ? seg.speed : newSettings.speed,
        audioOutdated: true,
      }));
      setScriptData((prev) => (prev ? {
        ...prev,
        segments: updatedSegments,
        updatedAt: Date.now(),
      } : prev));
    }

    setVoiceSettings(newSettings);
  };

  // ✨ One-Click AI Translation Remedy for Missing-Text Segments
  const handleTranslateSingleSegment = async (segIdOrIndex, targetIndex = null) => {
    if (!scriptData?.segments) return null;
    const matchSegment = (s, idx) => (
      (s._uid && String(s._uid) === String(segIdOrIndex)) ||
      s.id === segIdOrIndex || idx === segIdOrIndex ||
      String(s.id) === String(segIdOrIndex) || String(idx) === String(segIdOrIndex)
    );
    const segIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < scriptData.segments.length
      ? targetIndex
      : scriptData.segments.findIndex(matchSegment);
    if (segIdx === -1) return null;

    const targetEpisodeId = episodeId;
    const targetSeg = scriptData.segments[segIdx];
    const textToTranslate = (
      targetSeg.chineseText ||
      targetSeg.originalChineseText ||
      targetSeg.originalText ||
      targetSeg.original ||
      targetSeg.chinese ||
      ''
    ).trim();
    if (!textToTranslate) {
      alert(`Segment #${targetSeg.id || segIdx + 1} មិនមានអត្ថបទចិនដើមសម្រាប់បកប្រែទេ!`);
      return null;
    }

    try {
      console.log(`[Translate Segment] Retranslating segment #${targetSeg.id || segIdx + 1} ("${textToTranslate}")...`);
      const rawStart = Number(targetSeg.startSec ?? targetSeg.startTime ?? 0);
      const rawEnd = Number(targetSeg.endSec ?? targetSeg.endTime ?? 0);
      const segDurationSec = Number(targetSeg.duration) > 0
        ? Number(targetSeg.duration)
        : (rawEnd > rawStart ? Number((rawEnd - rawStart).toFixed(2)) : undefined);
      const res = await retranslateSegmentApi(textToTranslate, {
        speaker: targetSeg.speaker,
        gender: targetSeg.voiceGender || targetSeg.speakerGender || targetSeg.gender,
        durationSec: segDurationSec,
      });

      if (targetEpisodeId && targetEpisodeId !== activeTtsEpisodeRef.current) {
        return null;
      }

      if (res && Array.isArray(res.options) && res.options.length > 0) {
        const compactOpt =
          res.options.find((opt) => opt?.style === 'compact' || String(opt?.label || '').includes('ខ្លីចំអត្ថន័យ')) ||
          res.options[1] ||
          res.options[0];
        const bestText = cleanKhmerText(compactOpt?.text || res.options[0].text);
        if (bestText) {
          const buildUpdatedSegment = (baseSeg) => {
            const nextSeg = {
              ...baseSeg,
              khmer: bestText,
              khmerText: bestText,
              khmerTranslatedText: bestText,
              audioOutdated: true,
              textStatus: 'text_updated',
              reviewNeeded: false,
              ttsStatus: 'pending',
            };
            delete nextSeg.regenError;
            if (Array.isArray(nextSeg.validationErrors)) {
              nextSeg.validationErrors = nextSeg.validationErrors.filter((e) => !e.includes('មិនទាន់មានអត្ថបទបកប្រែ'));
            }
            return nextSeg;
          };

          const updated = buildUpdatedSegment(targetSeg);
          const nextScriptUpdatedAt = Date.now();
          setScriptData((prev) => {
            if (!prev?.segments) return prev;
            const liveIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < prev.segments.length
              ? targetIndex
              : prev.segments.findIndex(matchSegment);
            if (liveIdx === -1) return prev;
            const nextSegs = [...prev.segments];
            nextSegs[liveIdx] = buildUpdatedSegment(prev.segments[liveIdx]);
            return {
              ...prev,
              segments: nextSegs,
              updatedAt: nextScriptUpdatedAt,
            };
          });
          setAudioOutdated(true);
          invalidateRendered(targetEpisodeId);

          return updated;
        }
      }
    } catch (err) {
      console.error('[Translate Segment] Failed:', err);
      alert(`បរាជ័យក្នុងការបកប្រែឃ្លា #${targetSeg.id || segIdx + 1}: ${err.message}`);
    }
    return null;
  };

  return {
    isGeneratingAudio,
    generatingAudioEpisodeId,
    setIsGeneratingAudio,
    audioProgress,
    audioStage,
    audioGenerated,
    setAudioGenerated,
    audioOutdated,
    setAudioOutdated,
    fullAudioPath,
    setFullAudioPath,
    fullAudioUrl,
    setFullAudioUrl,
    ttsVoiceCatalog,
    voiceSwitchError,
    clearVoiceSwitchError,
    syncAudioTimeoutRef,
    handleGenerateAudio,
    handleUpdateVoiceSettings,
    handleUpdateSegmentVoice,
    handleUpdateSegmentText,
    handleUpdateSegmentSpeed,
    handleRegenerateSingleSegment,
    handleTranslateSingleSegment,
    handleSplitSegment,
    handleUpdateSpeakerVoice,
    handleToggleDeliveryType,
  };
}

