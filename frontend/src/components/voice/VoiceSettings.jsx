import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Users, Scissors, Volume2, Sparkles } from 'lucide-react';
import { parseTimeToSeconds } from '../../utils/timestampUtils';
import { resolveSegmentAtTime } from '../../utils/timelineUtils';
import { subscribeDraftPreview } from '../../utils/sliderDraftPreview';

import ClipInspectorPanel from './ClipInspectorPanel';
import AudioDuckingPanel from './AudioDuckingPanel';
import ExportSettingsPanel from './ExportSettingsPanel';
import { DubbingStepButton } from '../../features/dubbing-runner';
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
    libraryName: 'ឃ្លាំង Microsoft Edge Neural',
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
    libraryName: 'ឃ្លាំង Microsoft Edge Neural',
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
  selectedClipKind = null,
  onSplitClip,
  onDeleteClip,
  currentTime = 0,
  subscribePlayhead = null,
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
  onReleaseSegmentToAutoAlign = null,
  videoClips = [],
  onToggleDeliveryType = null,
  duration = 0,
}) {
  const [isPlayingTest, setIsPlayingTest] = useState(false);
  const [playingSegmentId, setPlayingSegmentId] = useState(null);
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [livePlaybackSegId, setLivePlaybackSegId] = useState(null);
  const segmentsRef = useRef(scriptData?.segments || []);
  segmentsRef.current = scriptData?.segments || [];
  const liveFollowBoundsRef = useRef(null);
  const lastLiveSegIdRef = useRef(null);

  // If user explicitly clicks a different segment, sync live follow state immediately
  useEffect(() => {
    if (isPlaying) {
      lastLiveSegIdRef.current = selectedSegmentId;
      setLivePlaybackSegId(selectedSegmentId);
    } else {
      liveFollowBoundsRef.current = null;
      lastLiveSegIdRef.current = null;
      setLivePlaybackSegId(null);
    }
  }, [selectedSegmentId, isPlaying]);

  // Real-time edge-triggered Inspector auto-follow during active playback (zero App/MediaLibrary re-renders)
  useEffect(() => {
    liveFollowBoundsRef.current = null;
    if (!isPlaying || typeof subscribePlayhead !== 'function') return undefined;

    return subscribePlayhead((liveTime) => {
      if (!Number.isFinite(liveTime)) return;
      const segs = segmentsRef.current;
      if (!segs || segs.length === 0) return;

      const cached = liveFollowBoundsRef.current;
      if (cached && liveTime >= cached.start && liveTime < cached.end) {
        return;
      }

      const activeSeg = resolveSegmentAtTime(segs, liveTime);
      if (activeSeg) {
        const sStart = (typeof activeSeg.startSec === 'number' && !isNaN(activeSeg.startSec))
          ? activeSeg.startSec
          : (typeof activeSeg.audioStartSec === 'number' && !isNaN(activeSeg.audioStartSec) ? activeSeg.audioStartSec : 0);
        const sEnd = (typeof activeSeg.endSec === 'number' && !isNaN(activeSeg.endSec))
          ? activeSeg.endSec
          : (typeof activeSeg.audioEndSec === 'number' && !isNaN(activeSeg.audioEndSec) ? activeSeg.audioEndSec : sStart + 1.0);
        const segKey = activeSeg._uid || (activeSeg.id !== undefined && activeSeg.id !== null ? activeSeg.id : segs.indexOf(activeSeg));
        liveFollowBoundsRef.current = { start: sStart, end: sEnd, segKey };

        if (String(segKey) !== String(lastLiveSegIdRef.current)) {
          const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
          const typingInInspector = Boolean(
            activeEl &&
            (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') &&
            (activeEl.closest?.('.top-suite-col-right') || activeEl.closest?.('.inspector-card-group') || activeEl.closest?.('.clip-inspector-panel'))
          );
          if (typingInInspector) return;

          lastLiveSegIdRef.current = segKey;
          setLivePlaybackSegId(segKey);
        }
      } else {
        liveFollowBoundsRef.current = null;
      }
    });
  }, [isPlaying, subscribePlayhead]);

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

  // Check if user is currently typing in textarea to prevent jarring cursor shifts
  const isEditingTextarea = Boolean(
    typeof document !== 'undefined' &&
    document.activeElement &&
    document.activeElement.tagName === 'TEXTAREA' &&
    document.activeElement.closest('.inspector-card-group')
  );

  // During active playback, use real-time playhead segment unless user is typing in Inspector
  const effectiveSelectedSegmentId = (isPlaying && livePlaybackSegId !== null && livePlaybackSegId !== undefined && !isEditingTextarea)
    ? livePlaybackSegId
    : selectedSegmentId;

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
        if (effectiveSelectedSegmentId === null || effectiveSelectedSegmentId === undefined) return false;
        if (s._uid && String(s._uid) === String(effectiveSelectedSegmentId)) return true;
        if (s.id !== undefined && s.id !== null && String(s.id) === String(effectiveSelectedSegmentId)) return true;
        if (s.segmentId !== undefined && s.segmentId !== null && String(s.segmentId) === String(effectiveSelectedSegmentId)) return true;
        if (typeof effectiveSelectedSegmentId === 'number' && (idx === effectiveSelectedSegmentId || idx + 1 === effectiveSelectedSegmentId)) return true;
        if (/^\d+$/.test(String(effectiveSelectedSegmentId))) {
          const num = parseInt(effectiveSelectedSegmentId, 10);
          if (idx === num || idx + 1 === num) return true;
        }
        return false;
      })
    : -1;

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

  // Active characters that actually speak in the current episode script
  const activeEpisodeSpeakers = useMemo(() => {
    const segments = scriptData?.segments || [];
    if (!segments.length) {
      if (Array.isArray(activeSeries?.glossary?.characters) && activeSeries.glossary.characters.length > 0) {
        return activeSeries.glossary.characters.map((ch) => {
          const currentVoice = ch.voiceId || ch.khmerVoiceId || settings?.voiceId || 'km-KH-PisethNeural';
          const isVoiceFemale = String(currentVoice).toLowerCase().includes('sreymom');
          const isCharacterFemale = (ch.gender === 'female' || ch.gender === 'FEMALE');
          return {
            key: ch.id || ch.name,
            name: ch.khmerName || ch.name,
            count: 0,
            voiceId: currentVoice,
            isVoiceFemale,
            isFemale: isVoiceFemale,
            isCharacterFemale,
          };
        });
      }
      return [];
    }

    const speakerCounts = new Map();
    segments.forEach((seg) => {
      const name = (seg.speaker || seg.speakerName || 'តួអង្គ').trim();
      if (name && name !== 'Unknown') {
        speakerCounts.set(name, (speakerCounts.get(name) || 0) + 1);
      }
    });

    const list = [];
    for (const [name, count] of speakerCounts.entries()) {
      const reg = (speakerRegistry && (
        speakerRegistry[name] ||
        Object.values(speakerRegistry).find((r) => r && (r.name === name || r.speakerName === name || r.id === name))
      )) || {};

      const currentVoice = reg.voiceId || reg.khmerVoiceId || settings?.voiceId || 'km-KH-PisethNeural';
      const isVoiceFemale = String(currentVoice).toLowerCase().includes('sreymom');
      const isCharacterFemale = String(reg.gender || reg.speakerGender || '').toLowerCase() === 'female';

      list.push({
        key: reg.id || name,
        name,
        count,
        voiceId: currentVoice,
        isVoiceFemale,
        isFemale: isVoiceFemale,
        isCharacterFemale,
        userOverridden: Boolean(reg.userOverridden || reg.voiceAssignmentSource === 'manual'),
      });
    }

    // Sort by line count descending so main speakers appear first
    return list.sort((a, b) => b.count - a.count);
  }, [scriptData?.segments, speakerRegistry, settings?.voiceId, activeSeries?.glossary?.characters]);

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
      if (segmentAudioRef.current) {
        segmentAudioRef.current.pause();
        segmentAudioRef.current.removeAttribute('src');
        setPlayingSegmentId(null);
      }
      setRegeneratingId(segIdOrIndex);
      try {
        await onUpdateSegmentVoice(segIdOrIndex, newVoiceId, true, effectiveIndex);
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

  // Verified voices list with safe fallback
  const allVoices = (voiceCatalog?.voices && voiceCatalog.voices.length > 0)
    ? voiceCatalog.voices
    : DEFAULT_SUPPORTED_VOICES;

  const currentVoice = allVoices.find((v) => v.id.toLowerCase() === (settings.voiceId || '').toLowerCase()) ||
    allVoices[0];

  // Context-Aware 3-Tab Right Inspector ('clip' | 'audio' | 'visual')
  const [inspectorTab, setInspectorTab] = useState('clip');
  const prevSelectionKeyRef = useRef(null);

  // Collapsible Accordion sections (kept for smooth sub-section toggles)
  const [openSections, setOpenSections] = useState({
    clip: true,
    characters: true,
    mixing: true,
    export: true,
  });

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Auto-focus Clip tab ONLY when user explicitly selects a different segment/clip on Timeline
  useEffect(() => {
    const selKey = selectedSegmentId !== null && selectedSegmentId !== undefined
      ? `seg:${selectedSegmentId}`
      : (selectedClip?.id ? `clip:${selectedClip.id}` : null);
    if (selKey && selKey !== prevSelectionKeyRef.current) {
      setInspectorTab('clip');
      setOpenSections((prev) => ({ ...prev, clip: true }));
    }
    prevSelectionKeyRef.current = selKey;
  }, [selectedSegmentId, selectedClip?.id]);

  const voiceAudioRef = useRef(null);
  const bgAudioRef = useRef(null);
  const testAudioCtxRef = useRef(null);
  const voiceGainNodeRef = useRef(null);
  const bgGainNodeRef = useRef(null);
  const segmentAudioRef = useRef(null);
  const liveTestDuckRef = useRef(null);
  const liveTestKhmerRef = useRef(null);

  const voiceUrl = previewAudioUrl;
  const customBgmCandidate = (settings?.enableCustomBgm && settings?.customBgmUrl) ? settings.customBgmUrl : null;
  const cleanBgmCandidate = activeEpisode?.bgmAudioUrl || activeEpisode?.cleanBgmUrl || null;
  const bgUrl = customBgmCandidate || cleanBgmCandidate || (selectedVideo ? selectedVideo.videoUrl : null);
  const latestSettingsRef = useRef(settings);
  latestSettingsRef.current = settings;

  const applyLiveTestVolumes = useCallback((duckOverride = null, khmerOverride = null) => {
    const cur = latestSettingsRef.current || {};
    const hasCustomLoop = Boolean(cur.enableCustomBgm && cur.customBgmUrl);
    const isYtSafe = Boolean(cur.youtubeSafeAudio && !hasCustomLoop);
    const duckVal = duckOverride !== null && Number.isFinite(Number(duckOverride))
      ? Math.max(0, Math.min(1, Number(duckOverride)))
      : (liveTestDuckRef.current !== null ? liveTestDuckRef.current : (cur.duckingVolume !== undefined ? Number(cur.duckingVolume) : 0.15));
    const khmerVal = khmerOverride !== null && Number.isFinite(Number(khmerOverride))
      ? Math.max(0, Math.min(2.0, Number(khmerOverride)))
      : (liveTestKhmerRef.current !== null ? liveTestKhmerRef.current : (cur.khmerVolume !== undefined ? Number(cur.khmerVolume) : 1.0));

    if (voiceGainNodeRef.current) {
      try {
        const ctx = testAudioCtxRef.current;
        if (ctx) voiceGainNodeRef.current.gain.setValueAtTime(khmerVal <= 0.01 ? 0 : khmerVal, ctx.currentTime);
        else voiceGainNodeRef.current.gain.value = khmerVal <= 0.01 ? 0 : khmerVal;
      } catch (_) {}
    } else if (voiceAudioRef.current) {
      voiceAudioRef.current.muted = khmerVal <= 0.01;
      voiceAudioRef.current.volume = Math.min(1.0, Math.max(0, khmerVal));
    }

    if (bgAudioRef.current) {
      const effectiveDuck = isYtSafe ? 0 : duckVal;
      bgAudioRef.current.muted = effectiveDuck <= 0.001;
      bgAudioRef.current.volume = Math.min(1.0, Math.max(0, effectiveDuck));
    }
    if (bgGainNodeRef.current) {
      bgGainNodeRef.current.gain.value = isYtSafe ? 0 : duckVal;
    }
  }, []);

  // Real-time 60fps volume update while dragging Audio Mix sliders during "ស្តាប់សាកល្បង (Mix)"
  useEffect(() => {
    return subscribeDraftPreview(['duckingVolume', 'khmerVolume'], ({ key, value, cleared }) => {
      if (key === 'duckingVolume') {
        liveTestDuckRef.current = cleared ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
        applyLiveTestVolumes(liveTestDuckRef.current, null);
      } else if (key === 'khmerVolume') {
        liveTestKhmerRef.current = cleared ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
        applyLiveTestVolumes(null, liveTestKhmerRef.current);
      }
    });
  }, [applyLiveTestVolumes]);

  const handleChange = (field, value) => {
    const patch = (field && typeof field === 'object' && !Array.isArray(field))
      ? field
      : { [field]: value };
    const nextSettings = {
      ...(latestSettingsRef.current || {}),
      ...patch,
    };
    latestSettingsRef.current = nextSettings;
    onUpdateSettings(nextSettings);

    if (Object.prototype.hasOwnProperty.call(patch, 'khmerVolume')) {
      liveTestKhmerRef.current = null;
      applyLiveTestVolumes(null, patch.khmerVolume);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'duckingVolume') || Object.prototype.hasOwnProperty.call(patch, 'youtubeSafeAudio')) {
      liveTestDuckRef.current = null;
      applyLiveTestVolumes(nextSettings.duckingVolume, null);
    }
  };

  const stopTestAudio = () => {
    if (voiceAudioRef.current) {
      voiceAudioRef.current.ontimeupdate = null;
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
    if (testAudioCtxRef.current) {
      try { testAudioCtxRef.current.close(); } catch {}
      testAudioCtxRef.current = null;
    }
    setIsPlayingTest(false);
  };

  useEffect(() => {
    stopTestAudio();
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      segmentAudioRef.current.removeAttribute('src');
      setPlayingSegmentId(null);
    }
  }, [settings.voiceId, settings.speed]);

  const handleToggleTest = async () => {
    if (isPlayingTest) {
      stopTestAudio();
      return;
    }

    if (!voiceUrl) {
      alert('សូមចុច "Generate Khmer Voice (TTS)" ជាមុនសិនដើម្បីបង្កើតសំឡេងខ្មែរ AI!');
      return;
    }

    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      setPlayingSegmentId(null);
    }

    try {
      const vAudio = new Audio(voiceUrl);
      vAudio.crossOrigin = 'anonymous';
      voiceAudioRef.current = vAudio;

      const curSettings = latestSettingsRef.current || settings || {};
      const khmerBoost = curSettings.khmerVolume !== undefined ? Number(curSettings.khmerVolume) : 1.0;

      // Wire Web Audio GainNode so 20%–200% boost & real-time slider dragging actually work!
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const source = ctx.createMediaElementSource(vAudio);
          const gainNode = ctx.createGain();
          gainNode.gain.setValueAtTime(khmerBoost <= 0.01 ? 0 : Math.min(2.0, Math.max(0, khmerBoost)), ctx.currentTime);
          source.connect(gainNode);
          gainNode.connect(ctx.destination);
          testAudioCtxRef.current = ctx;
          voiceGainNodeRef.current = gainNode;
          vAudio.volume = 1.0;
        } else {
          vAudio.volume = Math.min(1.0, Math.max(0, khmerBoost));
        }
      } catch (_) {
        vAudio.volume = Math.min(1.0, Math.max(0, khmerBoost));
      }

      // If previewAudioUrl is a single segment MP3 (fallback when monolithic fullAudioUrl is absent),
      // align BGM start offset to that segment's actual timeline start time.
      const matchedSeg = Array.isArray(scriptData?.segments)
        ? scriptData.segments.find((s) => s?.audioUrl && s.audioUrl === voiceUrl)
        : null;
      const bgStartSec = matchedSeg
        ? (typeof matchedSeg.audioStartSec === 'number' ? matchedSeg.audioStartSec : (typeof matchedSeg.startSec === 'number' ? matchedSeg.startSec : 0))
        : 0;

      const hasCustomLoop = Boolean(curSettings.enableCustomBgm && curSettings.customBgmUrl);
      const initialDuck = (curSettings.youtubeSafeAudio && !hasCustomLoop)
        ? 0
        : (curSettings.duckingVolume !== undefined ? Number(curSettings.duckingVolume) : 0.15);

      if (bgUrl) {
        try {
          const isAudioOnlyBg = /\.(wav|mp3|m4a|ogg|aac|flac)(\?|$)/i.test(bgUrl);
          const bAudio = isAudioOnlyBg ? new Audio(bgUrl) : document.createElement('video');
          if (!isAudioOnlyBg) bAudio.src = bgUrl;
          bAudio.loop = Boolean(hasCustomLoop);
          bAudio.muted = initialDuck <= 0.001;
          bAudio.volume = Math.min(1.0, Math.max(0, initialDuck));
          bgAudioRef.current = bAudio;

          vAudio.ontimeupdate = () => {
            if (!bgAudioRef.current) return;
            const liveCur = latestSettingsRef.current || {};
            const liveHasCustomLoop = Boolean(liveCur.enableCustomBgm && liveCur.customBgmUrl);
            if (liveCur.youtubeSafeAudio && !liveHasCustomLoop) {
              bgAudioRef.current.muted = true;
              bgAudioRef.current.volume = 0;
              return;
            }
            const liveDuck = liveTestDuckRef.current !== null
              ? liveTestDuckRef.current
              : (liveCur.duckingVolume !== undefined ? Number(liveCur.duckingVolume) : 0.15);
            if (liveDuck <= 0.001) {
              bgAudioRef.current.muted = true;
              bgAudioRef.current.volume = 0;
              return;
            }
            const t = bgStartSec + vAudio.currentTime;
            const isSpeaking = matchedSeg
              ? true
              : Boolean(scriptData?.segments?.some((s) => {
                  const start = typeof s.audioStartSec === 'number' ? s.audioStartSec : (s.startSec !== undefined ? s.startSec : parseTimeToSeconds(s.start, 0));
                  const end = typeof s.audioEndSec === 'number' ? s.audioEndSec : (s.endSec !== undefined ? s.endSec : parseTimeToSeconds(s.end, start + 3.0));
                  return t >= start && t <= end;
                }));
            const targetVol = isSpeaking
              ? Math.min(1.0, Math.max(0, liveDuck))
              : Math.min(1.0, Math.max(0, liveDuck <= 0.05 ? liveDuck : liveDuck * 1.4));
            bgAudioRef.current.muted = targetVol <= 0.001;
            if (Math.abs(bgAudioRef.current.volume - targetVol) > 0.002) {
              bgAudioRef.current.volume = targetVol;
            }
          };

          bAudio.currentTime = Math.max(0, bgStartSec);
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
      if (res && (res.audioUrl || res.audioPath || res.audioFile)) {
        setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'voice_updated' }));
        if (selectedSegment && (String(selectedSegment.id) === segKey || selectedSegmentIndex === effectiveIndex)) {
          selectedSegment.textStatus = 'voice_updated';
          delete selectedSegment.regenError;
        }
        if (res.audioUrl) {
          playSegmentAudio(res.audioUrl, segId);
        }
        setTimeout(() => {
          setRegenStatusMap((prev) => prev[segKey] === 'voice_updated' ? { ...prev, [segKey]: 'ready' } : prev);
        }, 4000);
      } else {
        setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'error' }));
        if (selectedSegment && (String(selectedSegment.id) === segKey || selectedSegmentIndex === effectiveIndex)) {
          if (!selectedSegment.regenError) {
            selectedSegment.regenError = 'បង្កើតសំឡេងបរាជ័យ';
          }
        }
      }
    } catch (err) {
      console.error('Manual regenerate error:', err);
      setRegenStatusMap((prev) => ({ ...prev, [segKey]: 'error' }));
      if (selectedSegment && (String(selectedSegment.id) === segKey || selectedSegmentIndex === effectiveIndex)) {
        selectedSegment.regenError = err?.message || 'បង្កើតសំឡេងបរាជ័យ';
      }
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
      if (segmentAudioRef.current) {
        segmentAudioRef.current.pause();
        segmentAudioRef.current.removeAttribute('src');
      }
    };
  }, []);

  const renderVoiceOptions = () => (
    <>
      <optgroup label="ឃ្លាំង Microsoft Edge Neural (ពិសិដ្ឋ & ស្រីមុំ)" style={{ background: '#181A20', color: 'var(--accent-cyan)' }}>
        {allVoices.map(v => (
          <option key={v.id} value={v.id} style={{ background: '#1c1f26', color: '#fff' }}>
            {v.displayName || v.name}
          </option>
        ))}
      </optgroup>
    </>
  );

  const activeSegBadge = selectedSegment
    ? `#${selectedSegment.id ?? (selectedSegmentIndex >= 0 ? selectedSegmentIndex + 1 : '')}`
    : null;

  return (
    <div className="capcut-inspector-panel">
      {/* Context-Aware 3-Tab Inspector Header (Clip | Audio | Visual & Export) */}
      <div className="inspector-tabs-header" role="tablist" aria-label="Inspector Tabs">
        <button
          type="button"
          role="tab"
          data-testid="inspector-tab-clip"
          aria-selected={inspectorTab === 'clip'}
          className={`inspector-tab-btn ${inspectorTab === 'clip' ? 'active' : ''}`}
          onClick={() => setInspectorTab('clip')}
          title="កែសម្រួល Clip & ប្រយោគខ្មែរដែលកំពុងជ្រើស (Clip Inspector)"
        >
          <Scissors size={13} />
          <span>Clip</span>
          {activeSegBadge && <span className="inspector-tab-badge">{activeSegBadge}</span>}
        </button>

        <button
          type="button"
          role="tab"
          data-testid="inspector-tab-audio"
          aria-selected={inspectorTab === 'audio'}
          className={`inspector-tab-btn ${inspectorTab === 'audio' ? 'active' : ''}`}
          onClick={() => setInspectorTab('audio')}
          title="កំណត់សំឡេងតួអង្គ & លាយសំឡេង BGM/Ducking (Audio & Cast)"
        >
          <Volume2 size={13} />
          <span>សំឡេង</span>
        </button>

        <button
          type="button"
          role="tab"
          data-testid="inspector-tab-visual"
          aria-selected={inspectorTab === 'visual'}
          className={`inspector-tab-btn ${inspectorTab === 'visual' ? 'active' : ''}`}
          onClick={() => setInspectorTab('visual')}
          title="កំណត់ Subtitle, Blur, Logo, Sponsor & Export (Visual & Export)"
        >
          <Sparkles size={13} />
          <span>រូប &amp; Export</span>
        </button>
      </div>

      <div className="inspector-content">
        {/* TAB 1: Selected Clip & Dialogue Inspector */}
        {inspectorTab === 'clip' && (
          <ClipInspectorPanel
            isOpen={openSections.clip}
            onToggle={() => toggleSection('clip')}
            selectedSegment={selectedSegment}
            selectedSegmentIndex={selectedSegmentIndex}
            selectedClip={selectedClip}
            selectedClipKind={selectedClipKind}
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
            onReleaseSegmentToAutoAlign={onReleaseSegmentToAutoAlign}
            videoClips={videoClips}
            autoplayBlocked={autoplayBlockedId === String(selectedSegment?.id ?? selectedSegmentIndex)}
            playbackError={playbackErrorMap[String(selectedSegment?.id ?? selectedSegmentIndex)]}
            onUpdateSpeakerVoice={onUpdateSpeakerVoice}
            onAutoSplitSegment={onAutoSplitSegment}
            onToggleDeliveryType={onToggleDeliveryType}
          />
        )}

        {/* TAB 2: Character Voice Mapping + Audio Mixing / Ducking */}
        {inspectorTab === 'audio' && (
          <>
            <div className="inspector-card-group" data-testid="inspector-character-mapping-card">
              <button
                type="button"
                className="inspector-accordion-trigger"
                onClick={() => toggleSection('characters')}
                aria-expanded={openSections.characters}
              >
                <span className="inspector-accordion-title">
                  <Users size={14} color="var(--primary-accent)" />
                  <span>តួសំឡេង (Cast Voices)</span>
                  {activeEpisodeSpeakers.length > 0 && (
                    <span style={{ fontSize: '0.72rem', opacity: 0.7, marginLeft: 4 }}>
                      ({activeEpisodeSpeakers.length})
                    </span>
                  )}
                </span>
                {openSections.characters ? <ChevronDown size={14} color="var(--text-dim)" /> : <ChevronRight size={14} color="var(--text-dim)" />}
              </button>
              {openSections.characters && (
                <div className="inspector-accordion-body">
                  <span className="section-label">
                    សំឡេងគោល (Default Voice)
                  </span>
                  <select
                    value={settings?.voiceId || currentVoice?.id || 'km-KH-PisethNeural'}
                    onChange={(e) => handleChange('voiceId', e.target.value)}
                    className="inspector-select"
                  >
                    {renderVoiceOptions()}
                  </select>
                  {activeEpisodeSpeakers.length > 0 ? (
                    <div className="inspector-speaker-list">
                      {activeEpisodeSpeakers.map((spk) => {
                        return (
                          <div key={spk.key || spk.name} className="inspector-speaker-row">
                            <span className={`inspector-speaker-name ${spk.isCharacterFemale ? 'is-female' : 'is-male'}`}>
                              {spk.name} {spk.count > 0 && <span style={{ fontSize: '0.68rem', opacity: 0.6 }}>({spk.count} ឃ្លា)</span>}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateSpeakerVoice?.(
                                  spk.key || spk.name,
                                  spk.isVoiceFemale ? 'km-KH-PisethNeural' : 'km-KH-SreymomNeural'
                                )
                              }
                              className={`inspector-speaker-voice-btn ${spk.isVoiceFemale ? 'is-female' : 'is-male'}`}
                            >
                              {spk.isVoiceFemale ? 'ស្រី (ស្រីមុំ)' : 'ប្រុស (ពិសិដ្ឋ)'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: '8px 4px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      មិនទាន់មានតួអង្គក្នុងភាគនេះទេ (សូមបកប្រែ Script ជាមុនសិន)
                    </div>
                  )}
                </div>
              )}
            </div>

            <AudioDuckingPanel
              isOpen={openSections.mixing}
              onToggle={() => toggleSection('mixing')}
              settings={settings}
              onSettingChange={handleChange}
              isPlayingTest={isPlayingTest}
              onToggleTest={handleToggleTest}
              previewAudioUrl={previewAudioUrl}
            />
          </>
        )}

        {/* TAB 3: Visual Frame, Anti-Theft Blur, Subtitles, Logo & Export */}
        {inspectorTab === 'visual' && (
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
        )}
      </div>

      {/* Pinned Compact Episode AI Audio Strip */}
      {activeEpisode && (
        <div className="inspector-sticky-footer inspector-ep-footer">
          <span className="inspector-ep-footer-label">
            EP{activeEpisode.episodeNumber || activeEpisode.id}:
          </span>
          <div className="inspector-ep-footer-actions">
            <DubbingStepButton
              step="voice"
              episodes={[activeEpisode]}
              variant="pill"
              setupOptions={{ voiceId: settings?.voiceId }}
            />
            <DubbingStepButton
              step="all3"
              episodes={[activeEpisode]}
              variant="pill"
              setupOptions={{ voiceId: settings?.voiceId }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
