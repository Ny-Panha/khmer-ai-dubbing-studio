import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sliders } from 'lucide-react';
import { parseTimeToSeconds } from '../utils/timestampUtils';
import { previewVoiceApi } from '../services/api';

import ClipInspectorPanel from './voice/ClipInspectorPanel';
import AudioDuckingPanel from './voice/AudioDuckingPanel';
import ExportSettingsPanel from './voice/ExportSettingsPanel';
import './VoiceSettings.css';

const DEFAULT_SUPPORTED_VOICES = [
  {
    id: 'km-KH-PisethNeural',
    name: 'Microsoft Edge — ប្រុស (ពិសិដ្ឋ)',
    displayName: 'Microsoft Edge — ប្រុស (ពិសិដ្ឋ)',
    lang: 'km-KH',
    gender: 'MALE',
    quality: 'Neural',
    provider: 'edge-tts',
    providerName: 'Microsoft Edge TTS (Neural)',
    libraryId: 'edge-neural',
    libraryName: '🏛️ ឃ្លាំង Microsoft Edge Neural',
    notes: 'សំឡេងប្រុសខ្មែរបែប Neural ពី Microsoft Edge ច្បាស់និងមាំទាំ'
  },
  {
    id: 'km-KH-SreymomNeural',
    name: 'Microsoft Edge — ស្រី (ស្រីមុំ)',
    displayName: 'Microsoft Edge — ស្រី (ស្រីមុំ)',
    lang: 'km-KH',
    gender: 'FEMALE',
    quality: 'Neural',
    provider: 'edge-tts',
    providerName: 'Microsoft Edge TTS (Neural)',
    libraryId: 'edge-neural',
    libraryName: '🏛️ ឃ្លាំង Microsoft Edge Neural',
    notes: 'សំឡេងស្រីខ្មែរបែប Neural ពី Microsoft Edge រលូននិងពិរោះរណ្តំ'
  }
];

export default function VoiceSettings({
  settings,
  onUpdateSettings,
  voiceCatalog = null,
  audioOutdated = false,
  previewAudioUrl,
  onRenderVideo,
  isRendering,
  renderProgress = 0,
  renderStage = '',
  renderedVideo,
  selectedVideo,
  videoMetadata = null,
  activeEpisode = null,
  activeSeries = null,
  seriesId = null,
  episodeId = null,
  batchRender = null,
  selectedClip = null,
  onSplitClip,
  onDeleteClip,
  currentTime = 0,
  isPlaying = false,
  scriptData = null,
  onGenerateAudio,
  isGeneratingAudio = false,
  audioProgress = 0,
  audioStage = '',
  audioGenerated = false,
  onRegenerateSegment = null,
  onTranslateSegment = null,
  speakerRegistry = {},
  onUpdateSpeakerVoice = null,
  onUpdateSegmentVoice = null,
  onUpdateSegmentSpeed = null,
  selectedSegmentId = null,
  onSelectSegment = null,
  onDeleteSegment = null,
  onUpdateScript = null,
  onUpdateSegmentText = null,
  onSplitSegment = null,
  onAutoSplitSegment = null,
  onToggleMuteSegment = null,
  onToggleMuteVideoClip = null,
  onToggleMuteAllCuts = null,
  videoClips = [],
  onToggleDeliveryType = null,
  duration = 0,
}) {
  const [isPlayingTest, setIsPlayingTest] = useState(false);
  const [playingSegmentId, setPlayingSegmentId] = useState(null);
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [copiedCaption, setCopiedCaption] = useState(false);

  const getSegTimeBounds = (seg) => {
    const start = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec
      : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : 0);
    const dur = (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0)
      ? seg.audioDurationSec
      : (typeof seg.duration === 'number' && seg.duration > 0 ? seg.duration : 2.5);
    const end = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
      ? seg.audioEndSec
      : (typeof seg.endSec === 'number' && !isNaN(seg.endSec) ? seg.endSec : start + dur);
    return { start, end, dur };
  };

  // Find dialogue segment directly under playhead line | (currentTime)
  // PERF: Skip 666-segment linear scan during active playback — only compute when paused/seeking
  const playheadSegmentIndex = (scriptData?.segments && Number.isFinite(currentTime) && !isPlaying)
    ? scriptData.segments.findIndex((seg) => {
        const { start, end } = getSegTimeBounds(seg);
        return currentTime >= start && currentTime <= end;
      })
    : -1;

  const explicitSegmentIndex = scriptData?.segments
    ? scriptData.segments.findIndex((s, idx) => {
        if (selectedSegmentId === null || selectedSegmentId === undefined) return false;
        if (s._uid && String(s._uid) === String(selectedSegmentId)) return true;
        if (s.id !== undefined && s.id !== null && String(s.id) === String(selectedSegmentId)) return true;
        if (s.segmentId !== undefined && s.segmentId !== null && String(s.segmentId) === String(selectedSegmentId)) return true;
        if (typeof selectedSegmentId === 'number' && (idx === selectedSegmentId || idx + 1 === selectedSegmentId)) return true;
        if (/^\d+$/.test(String(selectedSegmentId))) {
          const num = parseInt(selectedSegmentId, 10);
          if (idx === num || idx + 1 === num) return true;
        }
        return false;
      })
    : -1;

  // Check if user is currently typing in textarea to prevent jarring cursor shifts
  const isEditingTextarea = Boolean(
    typeof document !== 'undefined' &&
    document.activeElement &&
    document.activeElement.tagName === 'TEXTAREA' &&
    document.activeElement.closest('.inspector-card-group')
  );

  // When user manually selects a segment, preserve that selection when paused so editing and typing are 100% stable.
  // Fall back to playhead segment if no explicit segment is selected
  const selectedSegmentIndex = (isEditingTextarea && explicitSegmentIndex !== -1)
    ? explicitSegmentIndex
    : (explicitSegmentIndex !== -1 ? explicitSegmentIndex : playheadSegmentIndex);

  const selectedSegment = selectedSegmentIndex !== -1 ? scriptData.segments[selectedSegmentIndex] : null;

  // When video is playing, avoid thrashing selectedSegmentId to prevent layout freezes and stuttering.
  // Segment selection is reserved for user clicks while editing or paused.

  const editingOriginalTextRef = useRef({});
  const debounceTimerRef = useRef({});
  const [regenStatusMap, setRegenStatusMap] = useState({}); // { [segKey]: 'text_updated' | 'generating' | 'voice_updated' | 'error' | 'ready' }
  const [autoplayBlockedId, setAutoplayBlockedId] = useState(null);
  const [playbackErrorMap, setPlaybackErrorMap] = useState({});

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimerRef.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Stop segment audio if user switches to a different segment
  useEffect(() => {
    if (segmentAudioRef.current && playingSegmentId !== null) {
      const currentId = String(selectedSegment?.id ?? selectedSegmentIndex);
      if (String(playingSegmentId) !== currentId) {
        segmentAudioRef.current.pause();
        segmentAudioRef.current.removeAttribute('src');
        setPlayingSegmentId(null);
      }
    }
  }, [selectedSegment?.id, selectedSegmentIndex, playingSegmentId]);

  const handleSegmentTextChange = useCallback((segIdx, newText) => {
    if (!scriptData?.segments) return;
    const targetSeg = scriptData.segments[segIdx];
    const segKey = String(targetSeg?.id ?? segIdx);
    if (editingOriginalTextRef.current[segKey] === undefined) {
      editingOriginalTextRef.current[segKey] = targetSeg?.khmer || targetSeg?.khmerText || '';
    }

    setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'text_updated' }));

    // Save text to state immediately with autoRegen: false (no auto TTS audio generation)
    if (onUpdateSegmentText) {
      onUpdateSegmentText(targetSeg?.id || segIdx, newText, false, segIdx);
    } else if (onUpdateScript) {
      const updated = [...scriptData.segments];
      updated[segIdx] = {
        ...updated[segIdx],
        khmer: newText,
        khmerText: newText,
        khmerTranslatedText: newText,
        audioOutdated: true,
      };
      onUpdateScript({
        ...scriptData,
        segments: updated,
      });
    }

    if (debounceTimerRef.current[segKey]) {
      clearTimeout(debounceTimerRef.current[segKey]);
      delete debounceTimerRef.current[segKey];
    }
  }, [scriptData, onUpdateSegmentText, onUpdateScript]);

  const handleSegmentTextBlur = useCallback(async (segIdx, explicitText = null) => {
    if (!scriptData?.segments) return;
    const targetSeg = scriptData.segments[segIdx];
    if (!targetSeg) return;

    const segKey = String(targetSeg?.id ?? segIdx);

    if (debounceTimerRef.current[segKey]) {
      clearTimeout(debounceTimerRef.current[segKey]);
      delete debounceTimerRef.current[segKey];
    }

    const currentText = (explicitText !== null && explicitText !== undefined)
      ? String(explicitText).trim()
      : (targetSeg.khmer || targetSeg.khmerText || '').trim();

    if (!currentText) return;

    const origText = editingOriginalTextRef.current[segKey];
    const hasChanged = origText !== undefined ? origText.trim() !== currentText : false;

    // Only persist text to state; DO NOT trigger TTS voice generation automatically!
    // The user will click the Generate button manually when ready.
    if (hasChanged) {
      if (onUpdateSegmentText) {
        await onUpdateSegmentText(targetSeg.id || segIdx, currentText, false, segIdx);
      }
      setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'text_updated' }));
    }
  }, [scriptData, onUpdateSegmentText]);

  const handleSegmentChineseChange = useCallback((segIdx, newChineseText) => {
    if (!scriptData?.segments) return;
    const targetSeg = scriptData.segments[segIdx];
    if (!targetSeg) return;

    if (onUpdateScript) {
      const updated = [...scriptData.segments];
      updated[segIdx] = {
        ...updated[segIdx],
        originalChineseText: newChineseText,
        chineseText: newChineseText,
        originalText: newChineseText,
        original: newChineseText,
        chinese: newChineseText,
      };
      onUpdateScript({
        ...scriptData,
        segments: updated,
      });
    }
  }, [scriptData, onUpdateScript]);

  const handleClipVoiceChange = useCallback(async (segIdOrIndex, newVoiceId, targetIndex = null) => {
    if (onUpdateSegmentVoice) {
      const effectiveIndex = typeof targetIndex === 'number' ? targetIndex : selectedSegmentIndex;
      setRegeneratingId(segIdOrIndex);
      try {
        const res = await onUpdateSegmentVoice(segIdOrIndex, newVoiceId, true, effectiveIndex);
        if (res && res.audioUrl) {
          playSegmentAudio(res.audioUrl, segIdOrIndex);
        }
      } finally {
        setRegeneratingId(null);
      }
    }
  }, [onUpdateSegmentVoice, selectedSegmentIndex]);

  const handleClipSpeedChange = useCallback(async (segIdOrIndex, newSpeed, targetIndex = null) => {
    if (onUpdateSegmentSpeed) {
      const effectiveIndex = typeof targetIndex === 'number' ? targetIndex : selectedSegmentIndex;
      setRegeneratingId(segIdOrIndex);
      try {
        const res = await onUpdateSegmentSpeed(segIdOrIndex, newSpeed, true, effectiveIndex);
        if (res && res.audioUrl) {
          playSegmentAudio(res.audioUrl, segIdOrIndex);
        }
      } finally {
        setRegeneratingId(null);
      }
    }
  }, [onUpdateSegmentSpeed, selectedSegmentIndex]);

  // Voice Preview State
  const [previewText, setPreviewText] = useState(
    settings.previewText || 'សួស្តី! នេះជាសំឡេងខ្មែរ AI សម្រាប់បញ្ចូលសំឡេងរឿងភាគ'
  );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewAudioObj, setPreviewAudioObj] = useState(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const previewAudioRef = useRef(null);
  const previewRequestIdRef = useRef(0);

  // Character preview state
  const [previewingSpeakerVoiceId, setPreviewingSpeakerVoiceId] = useState(null);
  const charPreviewAudioRef = useRef(null);

  // Verified voices list with safe fallback
  const allVoices = (voiceCatalog?.voices && voiceCatalog.voices.length > 0)
    ? voiceCatalog.voices
    : DEFAULT_SUPPORTED_VOICES;

  const currentVoice = allVoices.find((v) => v.id.toLowerCase() === (settings.voiceId || '').toLowerCase()) ||
    allVoices[0];

  // Collapsible Accordion sections
  const [openSections, setOpenSections] = useState({
    clip: true,
    mixing: true,
    export: true,
  });

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Auto open clip inspector when a segment or clip is selected
  useEffect(() => {
    if (selectedSegmentId !== null || selectedClip !== null || selectedSegment !== null) {
      setOpenSections((prev) => ({ ...prev, clip: true }));
    }
  }, [selectedSegmentId, selectedClip, selectedSegment]);

  const voiceAudioRef = useRef(null);
  const bgAudioRef = useRef(null);
  const voiceGainNodeRef = useRef(null);
  const bgGainNodeRef = useRef(null);
  const segmentAudioRef = useRef(null);

  const voiceUrl = previewAudioUrl;
  const bgUrl = selectedVideo ? selectedVideo.videoUrl : null;

  const handleChange = (field, value) => {
    onUpdateSettings({
      ...settings,
      [field]: value,
    });

    if (field === 'khmerVolume' && voiceGainNodeRef.current) {
      voiceGainNodeRef.current.gain.value = value;
    }
    if (field === 'duckingVolume') {
      if (bgGainNodeRef.current) bgGainNodeRef.current.gain.value = value;
      if (bgAudioRef.current) {
        bgAudioRef.current.volume = Math.min(1.0, Math.max(0, value));
        bgAudioRef.current.muted = value <= 0;
      }
    }
  };

  const stopTestAudio = () => {
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current.removeAttribute('src');
      voiceAudioRef.current = null;
    }
    if (bgAudioRef.current) {
      bgAudioRef.current.pause();
      bgAudioRef.current.removeAttribute('src');
      bgAudioRef.current = null;
    }
    if (voiceGainNodeRef.current) {
      try { voiceGainNodeRef.current.disconnect(); } catch {}
      voiceGainNodeRef.current = null;
    }
    if (bgGainNodeRef.current) {
      try { bgGainNodeRef.current.disconnect(); } catch {}
      bgGainNodeRef.current = null;
    }
    setIsPlayingTest(false);
  };

  const stopPreviewAudio = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.removeAttribute('src');
      try { previewAudioRef.current.load(); } catch {}
      previewAudioRef.current = null;
    }
    if (charPreviewAudioRef.current) {
      charPreviewAudioRef.current.pause();
      charPreviewAudioRef.current.removeAttribute('src');
      try { charPreviewAudioRef.current.load(); } catch {}
      charPreviewAudioRef.current = null;
    }
    setIsPlayingPreview(false);
    setPreviewingSpeakerVoiceId(null);
  };

  const handlePreviewCharacterVoice = async (voiceId, speakerName, customText = '') => {
    if (previewingSpeakerVoiceId === voiceId && charPreviewAudioRef.current && !charPreviewAudioRef.current.paused) {
      charPreviewAudioRef.current.pause();
      setPreviewingSpeakerVoiceId(null);
      return;
    }

    stopPreviewAudio();
    stopTestAudio();
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      setPlayingSegmentId(null);
    }

    setPreviewingSpeakerVoiceId(voiceId);
    try {
      const isMale = (voiceId || '').includes('Piseth');
      const textToUse = customText || (isMale 
        ? `ខ្ញុំបាទឈ្មោះ ${speakerName || 'តួអង្គប្រុស'} រីករាយណាស់ដែលបានជួបអ្នក`
        : `នាងខ្ញុំឈ្មោះ ${speakerName || 'តួអង្គស្រី'} រីករាយណាស់ដែលបានជួបអ្នក`);

      const result = await previewVoiceApi({
        text: textToUse,
        voiceId: voiceId,
        speed: settings.speed || 'normal'
      });

      const audio = new Audio(result.audioUrl);
      charPreviewAudioRef.current = audio;
      audio.onended = () => setPreviewingSpeakerVoiceId(null);
      audio.onerror = () => setPreviewingSpeakerVoiceId(null);
      await audio.play();
    } catch (err) {
      console.warn('Character voice preview failed:', err);
      setPreviewingSpeakerVoiceId(null);
    }
  };

  useEffect(() => {
    previewRequestIdRef.current += 1;
    stopPreviewAudio();
    stopTestAudio();
    setPreviewAudioObj(null);
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      segmentAudioRef.current.removeAttribute('src');
      setPlayingSegmentId(null);
    }
    setPreviewError(null);
  }, [settings.voiceId, settings.speed]);

  const handleTogglePreview = async () => {
    if (isPlayingPreview) {
      stopPreviewAudio();
      return;
    }

    stopTestAudio();
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      setPlayingSegmentId(null);
    }

    setPreviewError(null);
    setIsPreviewLoading(true);

    previewRequestIdRef.current += 1;
    const currentReqId = previewRequestIdRef.current;
    const targetVoiceId = settings.voiceId || currentVoice?.id || 'km-KH-PisethNeural';
    const targetSpeed = settings.speed || 'normal';

    try {
      const textToUse = (previewText || '').trim() || 'សួស្តី! នេះជាសំឡេងខ្មែរ AI សម្រាប់បញ្ចូលសំឡេងរឿងភាគ';
      const result = await previewVoiceApi({
        text: textToUse,
        voiceId: targetVoiceId,
        speed: targetSpeed,
      });

      if (previewRequestIdRef.current !== currentReqId) return;

      setPreviewAudioObj(result);

      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.removeAttribute('src');
      }

      const audio = new Audio(result.audioUrl);
      previewAudioRef.current = audio;

      audio.onended = () => setIsPlayingPreview(false);
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setPreviewError('មិនអាចចាក់សំឡេង Preview បានទេ (Decoding Error)');
        setIsPlayingPreview(false);
      };

      try {
        await audio.play();
        if (previewRequestIdRef.current === currentReqId) {
          setIsPlayingPreview(true);
        } else {
          audio.pause();
        }
      } catch (playErr) {
        if (playErr.name !== 'AbortError') {
          console.error('Playback promise error:', playErr);
          setPreviewError('Playback prevented: ' + playErr.message);
        }
        setIsPlayingPreview(false);
      }
    } catch (err) {
      if (previewRequestIdRef.current === currentReqId) {
        console.error('Preview error:', err);
        setPreviewError(err.message || 'Failed to preview voice');
      }
    } finally {
      if (previewRequestIdRef.current === currentReqId) {
        setIsPreviewLoading(false);
      }
    }
  };

  const handleToggleTest = async () => {
    if (isPlayingTest) {
      stopTestAudio();
      return;
    }

    if (!voiceUrl) {
      alert('សូមចុច "Generate Khmer Voice (TTS)" ជាមុនសិនដើម្បីបង្កើតសំឡេងខ្មែរ AI!');
      return;
    }

    stopPreviewAudio();
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      setPlayingSegmentId(null);
    }

    try {
      const vAudio = new Audio(voiceUrl);
      voiceAudioRef.current = vAudio;

      const khmerBoost = settings.khmerVolume !== undefined ? Number(settings.khmerVolume) : 1.0;
      vAudio.volume = Math.min(1.0, Math.max(0, khmerBoost >= 1.0 ? 1.0 : khmerBoost));

      const duckVal = settings.duckingVolume !== undefined ? Number(settings.duckingVolume) : 0.15;
      let bAudio = null;

      if (bgUrl && duckVal > 0) {
        try {
          bAudio = document.createElement('video');
          bAudio.src = bgUrl;
          bAudio.muted = false;
          bAudio.volume = Math.min(1.0, Math.max(0, duckVal));
          bgAudioRef.current = bAudio;

          vAudio.ontimeupdate = () => {
            const t = vAudio.currentTime;
            const isSpeaking = scriptData?.segments?.some((s) => {
              const start = typeof s.audioStartSec === 'number' ? s.audioStartSec : (s.startSec !== undefined ? s.startSec : parseTimeToSeconds(s.start, 0));
              const end = typeof s.audioEndSec === 'number' ? s.audioEndSec : (s.endSec !== undefined ? s.endSec : parseTimeToSeconds(s.end, start + 3.0));
              return t >= start && t <= end;
            });
            const targetVol = isSpeaking
              ? Math.min(1.0, Math.max(0, duckVal))
              : Math.min(1.0, Math.max(0, duckVal <= 0.05 ? duckVal : duckVal * 1.4));
            if (bgAudioRef.current && Math.abs(bgAudioRef.current.volume - targetVol) > 0.001) {
              bgAudioRef.current.volume = targetVol;
            }
          };

          bAudio.currentTime = 0;
          bAudio.play().catch(e => { if (e.name !== 'AbortError') console.warn('Background preview play:', e.message); });
        } catch (e) {
          console.warn('Background preview setup:', e);
        }
      }

      vAudio.currentTime = 0;
      vAudio.onended = () => stopTestAudio();
      vAudio.onerror = () => stopTestAudio();

      await vAudio.play();
      setIsPlayingTest(true);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Audio test playback failed:', err);
      }
      stopTestAudio();
    }
  };

  const playSegmentAudio = (url, segId, isUserGesture = false) => {
    if (!url) return;
    const segKey = String(segId);
    if (String(playingSegmentId) === segKey && segmentAudioRef.current && !segmentAudioRef.current.paused) {
      segmentAudioRef.current.pause();
      setPlayingSegmentId(null);
      return;
    }
    stopPreviewAudio();
    stopTestAudio();
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      segmentAudioRef.current.removeAttribute('src');
    }

    if (isUserGesture) {
      setAutoplayBlockedId((prev) => (prev === segKey ? null : prev));
    }
    setPlaybackErrorMap((prev) => {
      const next = { ...prev };
      delete next[segKey];
      return next;
    });

    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = 1.0;
    audio.muted = false;
    audio.src = url;
    segmentAudioRef.current = audio;
    setPlayingSegmentId(segId);

    console.log(`[AudioPlayback] 🔊 Starting audio playback for segment #${segId}:`, {
      url,
      volume: audio.volume,
      muted: audio.muted,
      isUserGesture,
    });

    audio.onended = () => {
      setPlayingSegmentId(null);
    };

    audio.onerror = (e) => {
      const errMsg = audio.error?.message || 'Audio file load or decode failed';
      console.warn(`[AudioPlayback] ❌ Error playing segment #${segId}:`, errMsg, e);
      setPlayingSegmentId(null);
      setPlaybackErrorMap((prev) => ({ ...prev, [segKey]: errMsg }));
    };

    audio.load();

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        if (err.name === 'NotAllowedError') {
          console.warn(`[AudioPlayback] ⚠️ Autoplay blocked by browser for segment #${segId}. User gesture required:`, err.message);
          setAutoplayBlockedId(segKey);
        } else if (err.name !== 'AbortError') {
          console.warn(`[AudioPlayback] ❌ Play promise error for segment #${segId}:`, err.message);
          setPlaybackErrorMap((prev) => ({ ...prev, [segKey]: err.message || 'Play failed' }));
        }
        setPlayingSegmentId(null);
      });
    }
  };

  const handleSingleRegen = async (segId, targetIndex = null, overrideText = null) => {
    if (!onRegenerateSegment && !onUpdateSegmentText) return;
    const effectiveIndex = typeof targetIndex === 'number' ? targetIndex : selectedSegmentIndex;
    const segKey = String(segId);
    setRegeneratingId(segId);
    setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'generating' }));
    try {
      let res = null;
      if (onRegenerateSegment) {
        res = await onRegenerateSegment(segId, null, effectiveIndex, overrideText);
      } else if (onUpdateSegmentText) {
        const seg = scriptData?.segments?.[effectiveIndex];
        const text = (typeof overrideText === 'string' && overrideText.trim())
          ? overrideText.trim()
          : (seg?.khmer || seg?.khmerText || '');
        res = await onUpdateSegmentText(segId, text, true, effectiveIndex);
      }
      if (res && res.audioUrl) {
        setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'voice_updated' }));
        if (selectedSegment && (String(selectedSegment.id) === segKey || selectedSegmentIndex === effectiveIndex)) {
          selectedSegment.textStatus = 'voice_updated';
          delete selectedSegment.regenError;
        }
        playSegmentAudio(res.audioUrl, segId);
        setTimeout(() => {
          setRegenStatusMap((prev) => prev[segKey] === 'voice_updated' ? { ...prev, [segKey]: 'ready' } : prev);
        }, 4000);
      } else {
        setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'error' }));
      }
    } catch (err) {
      console.error('Manual regenerate error:', err);
      setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'error' }));
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleCopyCaption = () => {
    if (!scriptData) return;
    const lines = scriptData.segments?.map(s => s.khmer).filter(Boolean).join('\n\n') || '';
    const captionText = `${scriptData.title || 'រឿងភាគចិន សម្រាយជាភាសាខ្មែរ'}\n\n${scriptData.summary || ''}\n\n${lines}`;
    navigator.clipboard.writeText(captionText);
    setCopiedCaption(true);
    setTimeout(() => setCopiedCaption(false), 2500);
  };

  useEffect(() => {
    return () => {
      stopTestAudio();
      stopPreviewAudio();
      if (segmentAudioRef.current) {
        segmentAudioRef.current.pause();
        segmentAudioRef.current.removeAttribute('src');
      }
    };
  }, []);

  const segmentsCount = scriptData?.segments?.length || 0;

  const renderVoiceOptions = () => (
    <>
      <optgroup label="🏛️ ឃ្លាំង Microsoft Edge Neural (ពិសិដ្ឋ & ស្រីមុំ)" style={{ background: '#181A20', color: 'var(--accent-cyan)' }}>
        {allVoices.map(v => (
          <option key={v.id} value={v.id} style={{ background: '#1c1f26', color: '#fff' }}>
            {v.displayName || v.name}
          </option>
        ))}
      </optgroup>
    </>
  );

  return (
    <div className="capcut-inspector-panel">
      {/* Inspector Header */}
      <div className="inspector-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Sliders size={14} color="var(--primary-accent)" />
          <span className="panel-title-tag">
            ការកំណត់សំឡេង & Export (Inspector)
          </span>
        </div>
      </div>

      <div className="inspector-content">
        {/* Section 0: Selected Clip & Dialogue Inspector */}
        <ClipInspectorPanel
          isOpen={openSections.clip}
          onToggle={() => toggleSection('clip')}
          selectedSegment={selectedSegment}
          selectedSegmentIndex={selectedSegmentIndex}
          selectedClip={selectedClip}
          onSegmentTextChange={handleSegmentTextChange}
          onSegmentTextBlur={handleSegmentTextBlur}
          onSegmentChineseChange={handleSegmentChineseChange}
          onSingleRegen={handleSingleRegen}
          onTranslateSegment={onTranslateSegment}
          regeneratingId={regeneratingId}
          regenStatus={regenStatusMap[String(selectedSegment?.id ?? selectedSegmentIndex)] || selectedSegment?.textStatus}
          onSplitSegment={onSplitSegment}
          onClipVoiceChange={handleClipVoiceChange}
          onClipSpeedChange={handleClipSpeedChange}
          settings={settings}
          playingSegmentId={playingSegmentId}
          onPlaySegmentAudio={playSegmentAudio}
          onDeleteSegment={onDeleteSegment}
          currentTime={currentTime}
          onSplitClip={onSplitClip}
          onDeleteClip={onDeleteClip}
          scriptData={scriptData}
          onSelectSegment={onSelectSegment}
          onToggleMuteSegment={onToggleMuteSegment}
          onToggleMuteVideoClip={onToggleMuteVideoClip}
          onToggleMuteAllCuts={onToggleMuteAllCuts}
          videoClips={videoClips}
          autoplayBlocked={autoplayBlockedId === String(selectedSegment?.id ?? selectedSegmentIndex)}
          playbackError={playbackErrorMap[String(selectedSegment?.id ?? selectedSegmentIndex)]}
          onUpdateSpeakerVoice={onUpdateSpeakerVoice}
          onAutoSplitSegment={onAutoSplitSegment}
          onToggleDeliveryType={onToggleDeliveryType}
        />

        {/* Section 1: Audio Mixing */}
        <AudioDuckingPanel
          isOpen={openSections.mixing}
          onToggle={() => toggleSection('mixing')}
          settings={settings}
          onSettingChange={handleChange}
          isPlayingTest={isPlayingTest}
          onToggleTest={handleToggleTest}
          previewAudioUrl={previewAudioUrl}
        />

        {/* Section 2: Subtitle & Export Settings */}
        <ExportSettingsPanel
          isOpen={openSections.export}
          onToggle={() => toggleSection('export')}
          settings={settings}
          onSettingChange={handleChange}
          onRenderVideo={onRenderVideo}
          isRendering={isRendering}
          renderProgress={renderProgress}
          renderStage={renderStage}
          selectedVideo={selectedVideo}
          videoMetadata={videoMetadata}
          activeEpisode={activeEpisode}
          batchRender={batchRender}
          audioGenerated={audioGenerated}
          previewAudioUrl={previewAudioUrl}
          renderedVideo={renderedVideo}
          onCopyCaption={handleCopyCaption}
          copiedCaption={copiedCaption}
        />
      </div>
    </div>
  );
}
