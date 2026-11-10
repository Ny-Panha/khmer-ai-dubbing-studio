import { useState, useRef, useEffect } from 'react';
import { 
  generateAudioApi, 
  generateSingleSegmentAudio, 
  syncTimelineAudioApi, 
  fetchTtsVoices,
  retranslateSegmentApi,
} from '../services/api';
import { getSpeakerId, detectSpeakerGender } from '../utils/speakerUtils';
import { formatTimecode, parseTimeToSeconds } from '../utils/timestampUtils';
import { splitKhmerTextIntoHalves } from '../utils/khmerTextSplitter';
import { cleanKhmerText } from '../utils/cleanKhmer';

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
}) {
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [generatingAudioEpisodeId, setGeneratingAudioEpisodeId] = useState(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioStage, setAudioStage] = useState('');

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
  const activeTtsEpisodeRef = useRef(episodeId);
  activeTtsEpisodeRef.current = episodeId;

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

  // Update a Character's assigned voice across the whole project
  const handleUpdateSpeakerVoice = (speakerId, newVoiceId, newSpeed = 'normal') => {
    setSpeakerRegistry((prev) => {
      const existing = prev[speakerId] || {};
      const updatedSpk = {
        ...existing,
        id: speakerId,
        speakerId: speakerId,
        voiceId: newVoiceId,
        speed: newSpeed,
        userOverridden: true,
      };
      const newReg = {
        ...prev,
        [speakerId]: updatedSpk,
      };

      if (scriptData?.segments) {
        const updatedSegments = scriptData.segments.map((seg) => {
          const rawName = (seg.speaker || seg.speakerName || '').trim();
          const matches = 
            seg.speakerId === speakerId || 
            rawName === existing.name || 
            getSpeakerId(rawName) === speakerId;

          if (matches) {
            return {
              ...seg,
              speakerId: speakerId,
              voiceId: newVoiceId,
              speed: newSpeed,
              voiceProvider: 'edge-tts',
              audioOutdated: true,
            };
          }
          return seg;
        });
        setScriptData((sPrev) => (sPrev ? { ...sPrev, segments: updatedSegments, updatedAt: Date.now() } : sPrev));
        setAudioOutdated(true);
      }

      return newReg;
    });
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

    const customFlag = isCustomClipSpeed(newSpeed);
    const updatedSeg = {
      ...targetSeg,
      speed: newSpeed,
      userCustomSpeed: customFlag,
      audioOutdated: true,
    };

    const newSegments = [...scriptData.segments];
    newSegments[segIdx] = updatedSeg;

    setScriptData((prev) => (prev ? {
      ...prev,
      segments: newSegments,
      updatedAt: Date.now(),
    } : prev));

    const currentKhmerText = (updatedSeg.khmer || updatedSeg.khmerText || updatedSeg.khmerTranslatedText || '').trim();
    if (autoRegen && currentKhmerText) {
      try {
        const regenerated = await generateSingleSegmentAudio(updatedSeg, {
          speed: newSpeed,
          userCustomSpeed: customFlag,
          voiceId: targetVoiceId,
          forceRegen: true,
          projectName: getProjectName(),
          videoId: getVideoId(),
          episodeId,
          seriesId,
        });
        const finalSegments = [...newSegments];
        finalSegments[segIdx] = {
          ...regenerated,
          audioOffset: 0,
          audioTrimmed: false,
          userTrimmed: false,
          speed: newSpeed,
          userCustomSpeed: customFlag,
          audioOutdated: false,
        };
        setScriptData((prev) => (prev ? {
          ...prev,
          segments: finalSegments,
          updatedAt: Date.now(),
        } : prev));
        setAudioGenerated(true);

        const stillOutdated = finalSegments.some((s) => s.audioOutdated);
        setAudioOutdated(stillOutdated);

        if (finalSegments.some((s) => s.audioFile || s.audioPath || s.audioUrl)) {
          syncTimelineAudioApi(finalSegments, getProjectName(), getVideoId(), episodeId, seriesId)
            .then((res) => {
              if (res.fullAudioUrl) {
                const cacheBusted = `${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
                setFullAudioUrl(cacheBusted);
                setFullAudioPath(res.fullAudioPath);
                setAudioGenerated(true);
              }
            })
            .catch((syncErr) => {
              console.warn('Auto re-sync timeline audio error:', syncErr.message);
            });
        }
        return finalSegments[segIdx];
      } catch (err) {
        console.warn('Auto-regen segment audio on speed change failed:', err);
        return null;
      }
    }
    return updatedSeg;
  };

  // Override an individual segment's voice and auto-regenerate its speech audio
  const handleUpdateSegmentVoice = async (segIdOrIndex, newVoiceId, autoRegen = true, targetIndex = null) => {
    if (!scriptData?.segments) return;
    const segIdx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < scriptData.segments.length
      ? targetIndex
      : scriptData.segments.findIndex((s, idx) => 
          s.id === segIdOrIndex || idx === segIdOrIndex || 
          String(s.id) === String(segIdOrIndex) || String(idx) === String(segIdOrIndex)
        );
    if (segIdx === -1) return;

    const targetSeg = scriptData.segments[segIdx];
    const isFemale = (newVoiceId || '').includes('Sreymom');
    const isMale = (newVoiceId || '').includes('Piseth');
    const updatedGender = isMale ? 'MALE' : (isFemale ? 'FEMALE' : targetSeg.speakerGender);

    const activeSpeed = targetSeg.userCustomSpeed ? targetSeg.speed : (voiceSettings.speed || 'normal');

    const updatedVoiceGender = isFemale ? 'female' : 'male';
    const updatedSeg = {
      ...targetSeg,
      voiceId: newVoiceId,
      khmerVoiceId: newVoiceId,
      speakerGender: updatedGender,
      voiceGender: updatedVoiceGender,
      voiceAssignmentSource: 'manual',
      genderConfidence: 1.0,
      speed: activeSpeed,
      voiceProvider: 'edge-tts',
      audioOutdated: true,
    };

    const newSegments = [...scriptData.segments];
    newSegments[segIdx] = updatedSeg;

    if (targetSeg.speakerId || targetSeg.speaker) {
      const spkKey = targetSeg.speakerId || targetSeg.speaker;
      setSpeakerRegistry((prev) => ({
        ...prev,
        [spkKey]: {
          ...(prev[spkKey] || {}),
          id: spkKey,
          speakerId: spkKey,
          voiceId: newVoiceId,
          khmerVoiceId: newVoiceId,
          gender: updatedGender,
          voiceGender: updatedVoiceGender,
          voiceAssignmentSource: 'manual',
          userOverridden: true,
        }
      }));
    }

    setScriptData((prev) => (prev ? {
      ...prev,
      segments: newSegments,
      updatedAt: Date.now(),
    } : prev));

    const currentKhmerText = (updatedSeg.khmer || updatedSeg.khmerText || updatedSeg.khmerTranslatedText || '').trim();
    if (autoRegen && currentKhmerText) {
      try {
        const regenerated = await generateSingleSegmentAudio(updatedSeg, {
          speed: activeSpeed,
          voiceId: newVoiceId,
          forceRegen: true,
          projectName: getProjectName(),
          videoId: getVideoId(),
          episodeId,
          seriesId,
        });
        const finalSegments = [...newSegments];
        finalSegments[segIdx] = {
          ...regenerated,
          speakerGender: updatedGender,
          voiceId: newVoiceId,
          speed: activeSpeed,
          audioOutdated: false,
        };
        setScriptData((prev) => (prev ? {
          ...prev,
          segments: finalSegments,
          updatedAt: Date.now(),
        } : prev));
        setAudioGenerated(true);

        const stillOutdated = finalSegments.some((s) => s.audioOutdated);
        setAudioOutdated(stillOutdated);

        if (finalSegments.some((s) => s.audioFile || s.audioPath || s.audioUrl)) {
          syncTimelineAudioApi(finalSegments, getProjectName(), getVideoId(), episodeId, seriesId)
            .then((res) => {
              if (res.fullAudioUrl) {
                const cacheBusted = `${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
                setFullAudioUrl(cacheBusted);
                setFullAudioPath(res.fullAudioPath);
                setAudioGenerated(true);
              }
            })
            .catch((syncErr) => {
              console.warn('Auto re-sync timeline audio error:', syncErr.message);
            });
        }
        return finalSegments[segIdx];
      } catch (err) {
        console.warn('Auto-regen segment audio failed:', err);
        return null;
      }
    }
    return updatedSeg;
  };

  // 1-Click Toggle Inner-Thought Mode with Subtle FFmpeg aecho Effect & Caching
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
    const isThought = nextDelivery === 'inner_thought';
    const audioEffect = isThought ? 'inner_thought_reverb' : 'none';
    const activeVoiceId = targetSeg.khmerVoiceId || targetSeg.voiceId || voiceSettings.voiceId || 'km-KH-PisethNeural';
    const activeSpeed = targetSeg.userCustomSpeed ? targetSeg.speed : (voiceSettings.speed || 'normal');

    const updatedSeg = {
      ...targetSeg,
      deliveryType: nextDelivery,
      deliveryOverride: true,
      deliveryConfidence: 1.0,
      deliveryReviewNeeded: false,
      audioEffect,
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

    const currentKhmerText = (updatedSeg.khmer || updatedSeg.khmerText || updatedSeg.khmerTranslatedText || '').trim();
    if (autoRegen && currentKhmerText) {
      try {
        const regenerated = await generateSingleSegmentAudio(updatedSeg, {
          speed: activeSpeed,
          voiceId: activeVoiceId,
          deliveryType: nextDelivery,
          audioEffect,
          deliveryOverride: true,
          forceRegen: false, // Reuses cache if text and effect haven't changed!
          projectName: getProjectName(),
          videoId: getVideoId(),
          episodeId,
          seriesId,
        });

        const finalSegments = [...newSegments];
        finalSegments[segIdx] = {
          ...regenerated,
          deliveryType: nextDelivery,
          deliveryOverride: true,
          audioEffect,
          textStatus: 'voice_updated',
          audioOutdated: false,
        };

        setScriptData((prev) => (prev ? {
          ...prev,
          segments: finalSegments,
          updatedAt: Date.now(),
        } : prev));
        setAudioGenerated(true);

        const stillOutdated = finalSegments.some((s) => s.audioOutdated);
        setAudioOutdated(stillOutdated);

        if (finalSegments.some((s) => s.audioFile || s.audioPath || s.audioUrl)) {
          syncTimelineAudioApi(finalSegments, getProjectName(), getVideoId(), episodeId, seriesId)
            .then((res) => {
              if (res.fullAudioUrl) {
                const cacheBusted = `${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
                setFullAudioUrl(cacheBusted);
                setFullAudioPath(res.fullAudioPath);
                setAudioGenerated(true);
              }
            })
            .catch((syncErr) => console.warn('Auto re-sync timeline audio error:', syncErr.message));
        }

        return finalSegments[segIdx];
      } catch (err) {
        console.warn('Auto-regen inner thought audio failed:', err);
        // Preserves previous working audio and reports error clearly
        const errorSegments = [...newSegments];
        errorSegments[segIdx] = {
          ...targetSeg,
          textStatus: 'error',
          regenError: err.message || 'Inner thought generation failed',
        };
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
        }, {
          speed: activeSpeed,
          voiceId: targetVoiceId,
          projectName: dramaName,
          videoId: videoId,
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

        let returnedSeg = null;
        let allUpdatedSegments = null;

        setScriptData((prev) => {
          if (!prev?.segments) return prev;
          const idx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < prev.segments.length
            ? targetIndex
            : prev.segments.findIndex((s, i) => s.id === segIdOrIndex || i === segIdOrIndex || String(s.id) === String(segIdOrIndex) || String(i) === String(segIdOrIndex));
          if (idx === -1) return prev;

          const currentItem = prev.segments[idx];
          const isTextStillCurrent = (currentItem.khmer || '').trim() === cleanText;

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
            audioOutdated: !isTextStillCurrent,
            textStatus: isTextStillCurrent ? 'voice_updated' : 'text_updated',
          };

          const nextSegs = [...prev.segments];
          nextSegs[idx] = merged;
          returnedSeg = merged;
          allUpdatedSegments = nextSegs;
          return { ...prev, segments: nextSegs, updatedAt: Date.now() };
        });

        setAudioGenerated(true);

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

        return returnedSeg;
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
        const titleGender = detectSpeakerGender(seg.speaker, '', '');
        const detectedGender = (!isManualOverride && titleGender !== 'UNKNOWN')
          ? titleGender
          : (explicitKnown || detectSpeakerGender(seg.speaker, '', seg.khmer || seg.khmerText || seg.original));
        const resolvedGender = detectedGender !== 'UNKNOWN' ? detectedGender : 'MALE';
        const resolvedVoice = isManualOverride
          ? (seg.voiceOverride || seg.voiceId || seg.khmerVoiceId || (resolvedGender === 'FEMALE' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural'))
          : (detectedGender !== 'UNKNOWN'
              ? (resolvedGender === 'FEMALE' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural')
              : (seg.voiceId || seg.khmerVoiceId || 'km-KH-PisethNeural'));

        const base = !seg.userShifted ? { ...seg, userShifted: false } : { ...seg };
        delete base.autoShifted;
        return {
          ...base,
          speakerGender: resolvedGender,
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

      // Episode switch protection: If user switched episodes during generation,
      // DO NOT attach EP1 audio to EP2 workspace! Save to background store instead.
      if (targetEpisodeId && targetEpisodeId !== activeTtsEpisodeRef.current) {
        console.log(`[Stale TTS Guard] Dropping audio state overwrite for episode ${targetEpisodeId} (active is ${activeTtsEpisodeRef.current})`);
        if (onSaveEpisodeBackground) {
          onSaveEpisodeBackground(targetEpisodeId, {
            scriptData: { ...scriptData, segments: mergedSegments, updatedAt: Date.now() },
            fullAudioPath: result.fullAudioPath,
            fullAudioUrl: result.fullAudioUrl,
            audioGenerated: true,
            audioOutdated: false,
          });
        }
        return;
      }

      setAudioProgress(100);
      const summaryMsg = result.alreadyCompleted
        ? (result.summaryMessage || `✅ សំឡេងខ្មែរ AI មានរួចរាល់ ${validSegments.length} ឃ្លា (រក្សាទុកដើម)!`)
        : skippedEmptyCount > 0
          ? `✅ បង្កើតសំឡេង AI ជោគជ័យ ${validSegments.length} ឃ្លា (រំលង ${skippedEmptyCount} ឃ្លា គ្មានអត្ថបទ)!`
          : `✅ បង្កើតសំឡេងខ្មែរ AI ជោគជ័យ ${validSegments.length} ឃ្លា (100%)!`;
      setAudioStage(summaryMsg);

      setScriptData((prev) => {
        if (!prev?.segments) return prev;
        return {
          ...prev,
          segments: prev.segments.map((s) => updatedMap.get(String(s.id)) || s),
          updatedAt: Date.now(),
        };
      });
      setFullAudioPath(result.fullAudioPath);
      setFullAudioUrl(result.fullAudioUrl);
      setAudioGenerated(true);
      setAudioOutdated(false);

      setTimeout(() => {
        setAudioProgress(0);
        setAudioStage('');
      }, 3000);
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

      let returnedSeg = null;
      let allUpdatedSegments = null;

      setScriptData((prev) => {
        if (!prev?.segments) return prev;
        const idx = typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < prev.segments.length
          ? targetIndex
          : prev.segments.findIndex((s, i) => s.id === segId || i === segId || String(s.id) === String(segId) || String(i) === String(segId));
        if (idx === -1) return prev;

        const currentItem = prev.segments[idx];
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
          audioOutdated: false,
          textStatus: 'voice_updated',
        };

        const nextSegs = [...prev.segments];
        nextSegs[idx] = merged;
        returnedSeg = merged;
        allUpdatedSegments = nextSegs;
        return { ...prev, segments: nextSegs, updatedAt: Date.now() };
      });

      setAudioGenerated(true);

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

      return returnedSeg;
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
      const res = await retranslateSegmentApi(textToTranslate, {
        speaker: targetSeg.speaker,
        gender: targetSeg.voiceGender || targetSeg.speakerGender || targetSeg.gender,
      });

      if (targetEpisodeId && targetEpisodeId !== activeTtsEpisodeRef.current) {
        return null;
      }

      if (res && Array.isArray(res.options) && res.options.length > 0) {
        const bestText = cleanKhmerText(res.options[0].text);
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

