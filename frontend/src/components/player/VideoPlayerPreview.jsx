import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { Video, Upload, Loader2, AlertCircle } from 'lucide-react';
import { parseTimeToSeconds } from '../../utils/timestampUtils';
import { mapSourceToTimelineTime, mapTimelineToSourceTime } from '../../utils/timelineUtils';
import { findLeadingSilenceFromChannels, computeSegmentAudioSyncTarget } from '../../utils/audioSyncUtils';
import { uploadVideoFile } from '../../services/api';
import { createAudioRecoveryManager } from '../../utils/audioAutoRecovery';
import { resolveDefaultAspectRatio, inferRenderedAspectRatio, sanitizeAspectRatio } from '../../utils/projectStorage';

import { PlayerTopBar, PlayerBottomBar } from './PlayerControls';
import LiveSubtitleOverlay from './LiveSubtitleOverlay';
import AntiTheftOverlay from './AntiTheftOverlay';
import LogoOverlay from './LogoOverlay';
import './VideoPlayerPreview.css';

function VideoPlayerPreview({
  selectedVideo,
  videoMetadata = null,
  seriesId,
  episodeId,
  scriptData,
  renderedVideo,
  setRenderedVideo = null,
  onResetToPreview = null,
  isRendering,
  onRenderVideo,
  videoRef,
  currentTime,
  playheadTimeRef = null,
  subscribePlayhead = null,
  duration,
  isPlaying = false,
  onPlayPause,
  onSeek,
  onTimeUpdate,
  onLoadedMetadata,
  voiceSettings = {},
  onUpdateVoiceSettings = null,
  onAspectRatioChange = null,
  onEnded,
  fullAudioUrl = null,
  audioGenerated = false,
  audioOutdated = false,
  onImportClick,
  onVideoSelected,
  videoClips = [],
}) {
  const [videoMeta, setVideoMeta] = useState({ width: 0, height: 0, ratio: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [canvasBounds, setCanvasBounds] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);
  const canvasContainerRef = useRef(null);

  const srcW = Number(videoMetadata?.width || selectedVideo?.width) || videoMeta.width || 0;
  const srcH = Number(videoMetadata?.height || selectedVideo?.height) || videoMeta.height || 0;
  const isSourceLandscape = srcW > 0 && srcH > 0
    ? srcW > srcH
    : Boolean(videoMeta?.ratio && videoMeta.ratio > 1.05);
  const defaultAspectRatio = resolveDefaultAspectRatio(srcW, srcH) || '16:9';
  const explicitAspectRatio = sanitizeAspectRatio(voiceSettings?.aspectRatio);
  const selectedAspectRatio = explicitAspectRatio || defaultAspectRatio;
  const renderedRatio = renderedVideo
    ? sanitizeAspectRatio(inferRenderedAspectRatio(renderedVideo, videoMeta, selectedAspectRatio))
    : null;
  const aspectRatio = explicitAspectRatio || renderedRatio || selectedAspectRatio;
  const verticalStyle = voiceSettings?.verticalStyle || 'pad';
  const showPreviewCropBlurBand = Boolean(
    !renderedVideo &&
    aspectRatio === '9:16' &&
    verticalStyle === 'crop' &&
    isSourceLandscape &&
    voiceSettings?.burnSubtitles
  );

  useLayoutEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return undefined;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const rawW = (rect && rect.width > 0) ? rect.width : (el.clientWidth || 0);
      const rawH = (rect && rect.height > 0) ? rect.height : (el.clientHeight || 0);
      const w = Math.max(0, Math.floor(rawW));
      const h = Math.max(0, Math.floor(rawH));
      setCanvasBounds((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    updateSize();
    const rafId = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(updateSize) : null;
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateSize);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', updateSize);
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    if (ro) ro.observe(el);
    return () => {
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', updateSize);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('fullscreenchange', updateSize);
      }
      if (ro) ro.disconnect();
    };
  }, []);
  const narrationAudioRef = useRef(null);
  const cleanBgAudioRef = useRef(null);
  const [cleanBgAudioUrl, setCleanBgAudioUrl] = useState(null);
  const fileInputRef = useRef(null);
  const activeSegmentAudiosRef = useRef({});
  const segmentAudioPoolRef = useRef({});
  const segmentAudioMetaRef = useRef(new Map());
  const leadingSilenceCacheRef = useRef(new Map());
  const leadingSilenceInflightRef = useRef(new Map());
  const audioProbeCtxRef = useRef(null);
  const lastPreloadCenterRef = useRef(-Infinity);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayPendingRef = useRef(false);
  const playStartTimeRef = useRef(0);

  // BUG-013: Bounded Audio Auto-Recovery State & Manager
  const [narrationError, setNarrationError] = useState(null);
  const recoveryManagerRef = useRef(null);
  if (!recoveryManagerRef.current) {
    recoveryManagerRef.current = createAudioRecoveryManager({
      onTerminalError: (err) => {
        setNarrationError(err);
      },
      onRetryScheduled: ({ attempt, maxAttempts, delayMs, reason }) => {
        console.warn(`[NarrationAutoRecovery] Scheduling retry #${attempt}/${maxAttempts} in ${delayMs}ms (${reason})`);
      },
      onSuccess: () => {
        setNarrationError(null);
      },
    });
  }

  // 🎙️ Real-time Segment Audio Priority:
  // When editing on the timeline, always prioritize direct segment playback for 0-latency instant preview on drag/move/edit.
  // Master narration audio is only a fallback when no individual segment audio clips exist.
  const hasSegmentAudios = Boolean(
    !renderedVideo &&
    scriptData?.segments?.some(s => s.audioUrl || s.audioFile || s.audioPath)
  );

  // Refs to hold latest values for RAF / preload loops without re-triggering effects
  const segAudioConfigRef = useRef({ voiceSettings, videoClips, scriptData, hasSegmentAudios, renderedVideo, cleanBgAudioUrl });
  useEffect(() => {
    segAudioConfigRef.current = { voiceSettings, videoClips, scriptData, hasSegmentAudios, renderedVideo, cleanBgAudioUrl };
  }, [voiceSettings, videoClips, scriptData, hasSegmentAudios, renderedVideo, cleanBgAudioUrl]);

  const stopAllSegmentAudios = useCallback(() => {
    Object.keys(activeSegmentAudiosRef.current).forEach((key) => {
      const item = activeSegmentAudiosRef.current[key];
      if (item?.cleanupMetadataListener) {
        try { item.cleanupMetadataListener(); } catch (_) {}
      }
      if (item?.audio && !item.audio.paused) {
        item.audio.pause();
      }
    });
    activeSegmentAudiosRef.current = {};
  }, []);

  const getSegmentAudio = useCallback((url, segStart = 0) => {
    if (!url) return null;
    let audio = segmentAudioPoolRef.current[url];
    if (!audio) {
      audio = new Audio(url);
      audio.preload = 'auto'; // Immediate preload for zero-delay speech start
      if ('preservesPitch' in audio) audio.preservesPitch = true;
      if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
      if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
      segmentAudioPoolRef.current[url] = audio;
    }
    segmentAudioMetaRef.current.set(url, { segStart, lastUsedMs: Date.now() });
    return audio;
  }, []);

  const probeUrlLeadingSilence = useCallback((url) => {
    if (!url || typeof window === 'undefined') return;
    if (leadingSilenceCacheRef.current.has(url) || leadingSilenceInflightRef.current.has(url)) return;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioCtx && !OfflineCtx) return;

    const task = (async () => {
      try {
        if (!audioProbeCtxRef.current || audioProbeCtxRef.current.state === 'closed') {
          audioProbeCtxRef.current = AudioCtx ? new AudioCtx() : new OfflineCtx(1, 24000, 24000);
        }
        const ctx = audioProbeCtxRef.current;
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) return;
        const arrayBuf = await res.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        const channels = [];
        for (let c = 0; c < audioBuf.numberOfChannels; c++) {
          channels.push(audioBuf.getChannelData(c));
        }
        const skipSec = findLeadingSilenceFromChannels(channels, audioBuf.sampleRate);
        if (leadingSilenceCacheRef.current.size >= 250) {
          const oldestKey = leadingSilenceCacheRef.current.keys().next().value;
          if (oldestKey !== undefined) leadingSilenceCacheRef.current.delete(oldestKey);
        }
        leadingSilenceCacheRef.current.set(url, skipSec);
      } catch (_) {
        // Leave uncached on decode/abort so a future retry can still probe safely
      } finally {
        leadingSilenceInflightRef.current.delete(url);
      }
    })();

    leadingSilenceInflightRef.current.set(url, task);
  }, []);

  const evictDistantSegmentAudios = useCallback((centerTime) => {
    const urls = Object.keys(segmentAudioPoolRef.current);
    if (urls.length <= 32) return;

    const activeUrls = new Set(
      Object.values(activeSegmentAudiosRef.current)
        .map((item) => item?.url)
        .filter(Boolean)
    );

    const candidates = urls
      .filter((url) => !activeUrls.has(url))
      .map((url) => {
        const meta = segmentAudioMetaRef.current.get(url);
        const segStart = meta?.segStart ?? centerTime;
        const dist = Math.abs(segStart - centerTime);
        const outsideWindow = segStart < (centerTime - 25) || segStart > (centerTime + 80);
        return { url, dist, outsideWindow, lastUsedMs: meta?.lastUsedMs ?? 0 };
      })
      .filter((c) => c.outsideWindow)
      .sort((a, b) => (b.dist - a.dist) || (a.lastUsedMs - b.lastUsedMs));

    let remaining = urls.length;
    for (const c of candidates) {
      if (remaining <= 28) break;
      const audio = segmentAudioPoolRef.current[c.url];
      if (audio) {
        try {
          if (!audio.paused) audio.pause();
          audio.removeAttribute('src');
          audio.load();
        } catch (_) {}
      }
      delete segmentAudioPoolRef.current[c.url];
      segmentAudioMetaRef.current.delete(c.url);
      remaining--;
    }
  }, []);

  const preloadSegmentsAroundTime = useCallback((centerTime) => {
    const { hasSegmentAudios: hsa, scriptData: sd } = segAudioConfigRef.current;
    if (!hsa || !sd?.segments || sd.segments.length === 0) return;

    const now = Number.isFinite(centerTime) ? centerTime : (currentTimeRef.current || 0);
    lastPreloadCenterRef.current = now;

    const upcoming = sd.segments
      .map((seg) => {
        const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
        const rawUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
        return { seg, s, rawUrl };
      })
      .filter(({ s, rawUrl }) => rawUrl && s >= (now - 2) && s <= (now + 45))
      .sort((a, b) => Math.abs(a.s - now) - Math.abs(b.s - now))
      .slice(0, 14);

    upcoming.forEach(({ seg, s, rawUrl }) => {
      getSegmentAudio(rawUrl, s);
      const rawOffset = (typeof seg.audioOffset === 'number' && !isNaN(seg.audioOffset)) ? seg.audioOffset : 0;
      if (rawOffset === 0 && !seg.userTrimmed) {
        probeUrlLeadingSilence(rawUrl);
      }
    });

    evictDistantSegmentAudios(now);
  }, [getSegmentAudio, probeUrlLeadingSilence, evictDistantSegmentAudios]);

  // Preload on-demand: proactively warm upcoming clips & probe Edge TTS leading silence around playhead
  useEffect(() => {
    if (!hasSegmentAudios || !scriptData?.segments || scriptData.segments.length === 0) return;

    preloadSegmentsAroundTime(currentTimeRef.current || 0);
    const interval = setInterval(() => preloadSegmentsAroundTime(), 1500);
    return () => clearInterval(interval);
  }, [hasSegmentAudios, scriptData?.segments, preloadSegmentsAroundTime]);

  // Immediately preload when playback starts or user scrubs to a new position (>= 2.5s jump)
  useEffect(() => {
    if (isPlaying) {
      preloadSegmentsAroundTime(currentTimeRef.current || 0);
    }
  }, [isPlaying, preloadSegmentsAroundTime]);

  useEffect(() => {
    if (!hasSegmentAudios) return;
    if (Math.abs((currentTime || 0) - lastPreloadCenterRef.current) >= 2.5) {
      preloadSegmentsAroundTime(currentTime || 0);
    }
  }, [currentTime, hasSegmentAudios, preloadSegmentsAroundTime]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const vidObj = await uploadVideoFile(file, { seriesId, episodeId });
      if (onVideoSelected) {
        onVideoSelected(vidObj);
      }
    } catch (err) {
      console.error('Video upload failed:', err);
      setUploadError(err.message || 'Video upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const triggerFileInput = () => {
    if (isUploading) return;
    if (fileInputRef.current) {
      fileInputRef.current.click();
    } else if (onImportClick) {
      onImportClick();
    }
  };

  // Stop audio and reset playback state cleanly when switching episodes or projects
  useEffect(() => {
    isPlayPendingRef.current = false;
    stopAllSegmentAudios();
    // Clear segment audio pool and pause cached audio elements cleanly
    Object.values(segmentAudioPoolRef.current).forEach((audio) => {
      try {
        if (audio) {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        }
      } catch (_) {}
    });
    segmentAudioPoolRef.current = {};
    segmentAudioMetaRef.current.clear();
    leadingSilenceCacheRef.current.clear();
    leadingSilenceInflightRef.current.clear();
    lastPreloadCenterRef.current = -Infinity;
    if (recoveryManagerRef.current) {
      recoveryManagerRef.current.cancelPending();
    }
    if (narrationAudioRef.current) {
      if (!narrationAudioRef.current.paused) narrationAudioRef.current.pause();
      narrationAudioRef.current.playbackRate = 1.0;
    }
  }, [episodeId, seriesId, stopAllSegmentAudios]);

  // Component unmount: cancel all pending recovery timers, audio pool, & probe AudioContext
  useEffect(() => {
    return () => {
      stopAllSegmentAudios();
      if (recoveryManagerRef.current) {
        recoveryManagerRef.current.cancelPending();
      }
      if (audioProbeCtxRef.current && typeof audioProbeCtxRef.current.close === 'function' && audioProbeCtxRef.current.state !== 'closed') {
        audioProbeCtxRef.current.close().catch(() => {});
      }
      audioProbeCtxRef.current = null;
    };
  }, [stopAllSegmentAudios]);

  // Track browser fullscreen state (supports Esc key and native exit)
  useEffect(() => {
    const handleFsChange = () => {
      const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(isFs);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  // 🎧 AI Vocal Separation (Demucs): Fetch separated clean BGM (no_vocals.wav) when Demucs is enabled
  useEffect(() => {
    if (!voiceSettings?.enableDemucs || !selectedVideo) {
      setCleanBgAudioUrl(null);
      return;
    }
    const videoRefName = selectedVideo?.videoUrl || selectedVideo?.filePath || selectedVideo?.fileName || selectedVideo?.name;
    if (!videoRefName) return;

    const controller = new AbortController();

    fetch('/api/audio/separation-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: videoRefName }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json().catch(() => null);
      })
      .then((data) => {
        if (data?.success && data?.available && data?.noVocalsUrl) {
          const fullUrl = data.noVocalsUrl;
          console.log('[VideoPlayerPreview] 🎧 Found separated clean BGM:', fullUrl);
          setCleanBgAudioUrl(fullUrl);
        } else {
          setCleanBgAudioUrl(null);
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setCleanBgAudioUrl(null);
      });

    return () => {
      controller.abort();
    };
  }, [selectedVideo, voiceSettings?.enableDemucs]);

  // Listen for instant Demucs separation completed event from DubbingModeTab
  useEffect(() => {
    const handleSepReady = (e) => {
      if (e.detail?.noVocalsUrl) {
        const fullUrl = e.detail.noVocalsUrl;
        console.log('[VideoPlayerPreview] 🎧 Instant event received clean BGM:', fullUrl);
        setCleanBgAudioUrl(fullUrl);
      }
    };
    window.addEventListener('demucs-separation-ready', handleSepReady);
    return () => window.removeEventListener('demucs-separation-ready', handleSepReady);
  }, []);

  // Reload narration audio buffer and reset retry attempts whenever master narration URL changes
  useEffect(() => {
    if (recoveryManagerRef.current) {
      recoveryManagerRef.current.reset(fullAudioUrl);
    }
    if (narrationAudioRef.current && fullAudioUrl) {
      try {
        const savedTime = currentTimeRef.current;
        narrationAudioRef.current.load();
        if (Number.isFinite(savedTime)) {
          narrationAudioRef.current.currentTime = savedTime;
        }
      } catch (err) {
        console.warn('[TimelineSync] Narration audio reload notice:', err);
      }
    }
  }, [fullAudioUrl]);

  // Core segment audio sync logic (extracted for 60Hz RAF loop precision)
  const syncSegmentAudiosAtTime = useCallback((now) => {
    const { voiceSettings: vs, scriptData: sd, hasSegmentAudios: hsa, renderedVideo: rv } = segAudioConfigRef.current;
    if (rv || !hsa) {
      stopAllSegmentAudios();
      return;
    }

    const v = videoRef?.current;
    const currentRate = v?.playbackRate || 1.0;
    const khmerVal = vs.khmerVolume !== undefined ? Number(vs.khmerVolume) : 1.0;
    const isKhmerMuted = khmerVal <= 0.01;
    const targetVol = isKhmerMuted ? 0 : Math.min(1.0, Math.max(0, khmerVal));

    const segments = sd?.segments || [];

    // High-performance window filter: only inspect segments within active window of now
    const nearbySegs = segments.map((seg, idx) => ({ seg, idx })).filter(({ seg }) => {
      if (seg.muted || seg.isMuted) return false;
      const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
      const rawAudioDur = (typeof seg.originalAudioDuration === 'number' && seg.originalAudioDuration > 0)
        ? seg.originalAudioDuration
        : ((typeof seg.rawAudioDur === 'number' && seg.rawAudioDur > 0)
          ? seg.rawAudioDur
          : ((typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
            ? seg.finalAudioDuration
            : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
              ? seg.audioDuration
              : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec)) ? seg.audioDurationSec : 2.5))));
      const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
      const effectiveEnd = (isTrimmed && typeof seg.audioEndSec === 'number')
        ? seg.audioEndSec
        : (s + rawAudioDur);
      return now >= (s - 0.25) && now < (effectiveEnd + 0.3);
    });

    // Cleanup active audios no longer in window
    Object.keys(activeSegmentAudiosRef.current).forEach((k) => {
      if (!nearbySegs.some(({ seg, idx }) => String(seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx)) === k)) {
        const item = activeSegmentAudiosRef.current[k];
        if (item?.cleanupMetadataListener) {
          try { item.cleanupMetadataListener(); } catch (_) {}
        }
        if (item?.audio) {
          if (!item.audio.paused) item.audio.pause();
          item.audio.playbackRate = currentRate;
        }
        delete activeSegmentAudiosRef.current[k];
      }
    });

    nearbySegs.forEach(({ seg, idx }) => {
      const segKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
      if (seg.muted || seg.isMuted) {
        if (activeSegmentAudiosRef.current[segKey]) {
          const item = activeSegmentAudiosRef.current[segKey];
          item.cleanupMetadataListener?.();
          item.audio.pause();
          delete activeSegmentAudiosRef.current[segKey];
        }
        return;
      }

      const rawUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
      if (!rawUrl) return;

      // If segment URL changed (regenerated clip while timeline open), tear down stale audio handle
      let activeItem = activeSegmentAudiosRef.current[segKey];
      if (activeItem && activeItem.url && activeItem.url !== rawUrl) {
        activeItem.cleanupMetadataListener?.();
        if (!activeItem.audio.paused) activeItem.audio.pause();
        delete activeSegmentAudiosRef.current[segKey];
        activeItem = null;
      }

      const existingAudio = activeItem?.audio || segmentAudioPoolRef.current[rawUrl];
      const knownDuration = (existingAudio && existingAudio.duration && !isNaN(existingAudio.duration) && existingAudio.duration > 0.2)
        ? existingAudio.duration
        : null;
      const detectedLeadSkipSec = leadingSilenceCacheRef.current.get(rawUrl) ?? 0;

      const syncTarget = computeSegmentAudioSyncTarget({
        seg,
        now,
        audioDuration: knownDuration,
        detectedLeadSkipSec,
        lookaheadSec: 0.035,
      });

      const {
        segStart,
        effectiveSegEnd,
        segAudioOffset,
        expectedOffset,
        segAudioEndLimit,
        inRange,
      } = syncTarget;

      // Warm leading-silence probe 250ms ahead if user jumped straight to an un-preloaded clip
      if (segAudioOffset === 0 && !seg.userTrimmed && !leadingSilenceCacheRef.current.has(rawUrl)) {
        probeUrlLeadingSilence(rawUrl);
      }

      // Smart Auto-Ducking on Overlapping Dialogues (50% Auto Duck):
      // If next dialogue starts while this one is still speaking, auto-duck this clip to 50% volume!
      const isOverlappedByNext = segments.some((nextSeg, nextIdx) => {
        if (nextIdx <= idx) return false;
        if (nextSeg.muted || nextSeg.isMuted) return false;
        const nextStart = (typeof nextSeg.audioStartSec === 'number' && !isNaN(nextSeg.audioStartSec))
          ? nextSeg.audioStartSec
          : (typeof nextSeg.startSec === 'number' && !isNaN(nextSeg.startSec)
            ? nextSeg.startSec
            : parseTimeToSeconds(nextSeg.audioStart ?? nextSeg.start, 0));
        return nextStart > segStart && nextStart < effectiveSegEnd && now >= (nextStart - 0.04);
      });

      const effectiveVol = isOverlappedByNext ? parseFloat((targetVol * 0.50).toFixed(2)) : targetVol;

      if (inRange) {
        if (!activeItem) {
          const audio = getSegmentAudio(rawUrl, segStart);
          if (audio) {
            audio.volume = effectiveVol;
            audio.playbackRate = currentRate;

            let cleanupMetadataListener = null;
            if (audio.readyState >= 1) {
              if (Math.abs(audio.currentTime - expectedOffset) > 0.015) {
                try {
                  const bounded = Number.isFinite(audio.duration) && audio.duration > 0
                    ? Math.min(expectedOffset, Math.max(0, audio.duration - 0.02))
                    : expectedOffset;
                  audio.currentTime = bounded;
                } catch (_) {}
              }
            } else {
              // Cold buffer guard: seek immediately to live timeline position once metadata decodes
              const onLoadedMetadata = () => {
                cleanupMetadataListener = null;
                const curItem = activeSegmentAudiosRef.current[segKey];
                if (!curItem || curItem.url !== rawUrl) return;
                const liveV = videoRef?.current;
                const { videoClips: liveVc } = segAudioConfigRef.current;
                const liveTlNow = (liveV && Array.isArray(liveVc) && liveVc.length > 0)
                  ? (mapSourceToTimelineTime(liveV.currentTime || 0, liveVc) ?? currentTimeRef.current)
                  : (liveV?.currentTime ?? currentTimeRef.current);
                const freshSkip = (segAudioOffset === 0 && !seg.userTrimmed)
                  ? (leadingSilenceCacheRef.current.get(rawUrl) ?? 0)
                  : 0;
                const liveBase = segAudioOffset + freshSkip;
                const liveExpected = liveBase + Math.max(0, (Number.isFinite(liveTlNow) ? liveTlNow : segStart) - segStart);
                const maxPos = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, audio.duration - 0.02) : liveExpected;
                try {
                  audio.currentTime = Math.max(0, Math.min(liveExpected, maxPos));
                } catch (_) {}
                curItem.lastSeekPerf = performance.now();
                curItem.cleanupMetadataListener = null;
              };
              audio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
              cleanupMetadataListener = () => {
                audio.removeEventListener('loadedmetadata', onLoadedMetadata);
              };
            }

            if (audio.paused) {
              audio.play().catch((err) => {
                if (err.name !== 'AbortError') console.warn('Segment audio play notice:', err);
              });
            }
            activeSegmentAudiosRef.current[segKey] = {
              audio,
              url: rawUrl,
              segKey,
              segStart,
              segEnd: effectiveSegEnd,
              segAudioEndLimit,
              hasEnded: false,
              lastSeekPerf: performance.now(),
              cleanupMetadataListener,
            };
          }
        } else {
          const audio = activeItem.audio;
          activeItem.segAudioEndLimit = segAudioEndLimit;
          if (audio.volume !== effectiveVol) audio.volume = effectiveVol;

          // Check if audio finished natural sentence duration or reached the split slice end limit
          if (audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration - 0.04) || (activeItem.segAudioEndLimit && audio.currentTime >= activeItem.segAudioEndLimit - 0.02)) {
            activeItem.hasEnded = true;
            if (!audio.paused) audio.pause();
          }

          if (!activeItem.hasEnded) {
            if (audio.paused) {
              audio.play().catch(() => {});
            }

            // Tight 3-Tier Sync (<= 35ms lock, 35-120ms hysteresis rate nudge, > 120ms debounced seek)
            if (audio.readyState >= 2 && !audio.seeking) {
              const drift = expectedOffset - audio.currentTime;
              const absDrift = Math.abs(drift);
              const isNudged = Math.abs(audio.playbackRate - currentRate) > 0.005;
              const nowPerf = performance.now();

              if (absDrift > 0.120 && (nowPerf - (activeItem.lastSeekPerf || 0)) >= 250) {
                try {
                  const maxPos = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, audio.duration - 0.02) : (expectedOffset + 0.015);
                  audio.currentTime = Math.max(0, Math.min(expectedOffset + 0.015, maxPos));
                } catch (_) {}
                activeItem.lastSeekPerf = nowPerf;
                if (audio.playbackRate !== currentRate) audio.playbackRate = currentRate;
              } else if (isNudged) {
                if (absDrift < 0.015) {
                  audio.playbackRate = currentRate;
                } else {
                  const rateMultiplier = drift > 0 ? 1.10 : 0.90;
                  audio.playbackRate = parseFloat((currentRate * rateMultiplier).toFixed(3));
                }
              } else if (absDrift >= 0.035) {
                const rateMultiplier = drift > 0 ? 1.10 : 0.90;
                audio.playbackRate = parseFloat((currentRate * rateMultiplier).toFixed(3));
              }
            }
          }
        }
      } else {
        if (activeSegmentAudiosRef.current[segKey]) {
          const item = activeSegmentAudiosRef.current[segKey];
          item.cleanupMetadataListener?.();
          if (!item.audio.paused) {
            item.audio.pause();
          }
          item.audio.playbackRate = currentRate;
          delete activeSegmentAudiosRef.current[segKey];
        }
      }
    });
  }, [videoRef, stopAllSegmentAudios, getSegmentAudio, probeUrlLeadingSilence]);

  // PERF: During playback, sync segment audio & Clean Demucs BGM via ~60Hz RAF loop (bypasses React re-render)
  useEffect(() => {
    if (!isPlaying) {
      stopAllSegmentAudios();
      return;
    }

    const { hasSegmentAudios: hsa, renderedVideo: rv, voiceSettings: vs0, cleanBgAudioUrl: bgUrl0 } = segAudioConfigRef.current;
    if (rv || (!hsa && !(vs0?.enableDemucs && bgUrl0))) {
      stopAllSegmentAudios();
      return;
    }

    // Pause master narration audio to prevent double-audio/echo when playing direct segments
    if (hsa && narrationAudioRef.current && !narrationAudioRef.current.paused) {
      narrationAudioRef.current.pause();
    }

    let animId;
    let lastSyncPerf = 0;
    const syncLoop = () => {
      const nowPerf = performance.now();
      if (nowPerf - lastSyncPerf >= 14) {
        lastSyncPerf = nowPerf;
        const v = videoRef?.current;
        const { videoClips: vc, hasSegmentAudios: curHsa, voiceSettings: vs, cleanBgAudioUrl: bgUrl } = segAudioConfigRef.current;

        if (curHsa) {
          const tlNow = (v && Array.isArray(vc) && vc.length > 0)
            ? (mapSourceToTimelineTime(v.currentTime || 0, vc) ?? currentTimeRef.current)
            : (v?.currentTime ?? currentTimeRef.current);
          syncSegmentAudiosAtTime(tlNow);
        }

        // Tight 60Hz Clean Demucs BGM sync
        const bg = cleanBgAudioRef.current;
        if (bg && vs?.enableDemucs && bgUrl && v && !v.paused && Number.isFinite(v.currentTime)) {
          const baseRate = v.playbackRate || 1.0;
          if (bg.playbackRate !== baseRate) bg.playbackRate = baseRate;
          if (bg.readyState >= 1 && !bg.seeking && Math.abs(bg.currentTime - v.currentTime) > 0.04) {
            bg.currentTime = v.currentTime;
          }
          if (bg.paused) bg.play().catch(() => {});
        }
      }
      animId = requestAnimationFrame(syncLoop);
    };
    animId = requestAnimationFrame(syncLoop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, syncSegmentAudiosAtTime, stopAllSegmentAudios, videoRef, hasSegmentAudios, cleanBgAudioUrl, voiceSettings?.enableDemucs]);

  // Helper: Idempotent audio play to prevent promise rejection warnings & duplicate starts
  const safePlayNarration = (a) => {
    if (!a || !a.paused || isPlayPendingRef.current) return;
    const nowTime = currentTimeRef.current;
    if (a.duration && Number.isFinite(a.duration) && nowTime >= a.duration) return;

    isPlayPendingRef.current = true;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        isPlayPendingRef.current = false;
      }).catch((err) => {
        isPlayPendingRef.current = false;
        if (err.name !== 'AbortError') {
          console.warn('[NarrationSync] Play notice:', err);
        }
      });
    } else {
      isPlayPendingRef.current = false;
    }
  };

  // Synchronize Khmer AI Voice & Clean Demucs BGM Playback with Canonical Timeline Playhead
  useEffect(() => {
    if (renderedVideo) {
      if (narrationAudioRef.current && !narrationAudioRef.current.paused) {
        narrationAudioRef.current.pause();
      }
      if (cleanBgAudioRef.current && !cleanBgAudioRef.current.paused) {
        cleanBgAudioRef.current.pause();
      }
      return;
    }

    const v = videoRef?.current;
    if (isPlaying) {
      if (cleanBgAudioRef.current && cleanBgAudioUrl && voiceSettings?.enableDemucs) {
        const bg = cleanBgAudioRef.current;
        if (v && Number.isFinite(v.currentTime) && Math.abs(bg.currentTime - v.currentTime) > 0.25) {
          bg.currentTime = v.currentTime;
        }
        if (bg.paused) {
          bg.play().catch(() => {});
        }
      }
    } else {
      if (cleanBgAudioRef.current && !cleanBgAudioRef.current.paused) {
        cleanBgAudioRef.current.pause();
      }
    }

    const a = narrationAudioRef.current;
    if (!a || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;

    if (isPlaying) {
      const targetTime = (v && Array.isArray(videoClips) && videoClips.length > 0)
        ? (mapSourceToTimelineTime(v.currentTime || 0, videoClips) ?? currentTimeRef.current)
        : currentTimeRef.current;
      if (a.duration && Number.isFinite(a.duration) && targetTime >= a.duration) {
        if (!a.paused) a.pause();
        return;
      }
      // Only snap if desync is severe (> 0.40s) before starting playback to prevent double-seek stall
      if (a.readyState >= 1 && !a.seeking && Number.isFinite(targetTime) && Math.abs(a.currentTime - targetTime) > 0.40) {
        const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
        a.currentTime = Math.min(targetTime, maxTime);
      }
      if (a.paused && (!a.duration || targetTime < a.duration)) {
        safePlayNarration(a);
      }
    } else {
      isPlayPendingRef.current = false;
      if (!a.paused) {
        a.pause();
      }
      a.playbackRate = v?.playbackRate || 1.0;
    }
  }, [isPlaying, renderedVideo, audioGenerated, fullAudioUrl, hasSegmentAudios, videoClips, videoRef, cleanBgAudioUrl, voiceSettings?.enableDemucs]);

  // Sync event hooks on video element (Robust 3-Tier Sync: 0-40ms lock, 40-450ms hysteresis nudge, >450ms seek)
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;

    // Helper to compute video canonical timeline time
    const getTargetTimelineTime = () => {
      let target = v.currentTime || 0;
      if (Array.isArray(videoClips) && videoClips.length > 0) {
        const mapped = mapSourceToTimelineTime(target, videoClips);
        if (Number.isFinite(mapped)) {
          return mapped;
        }
      }
      return target;
    };

    const handleSync = () => {
      // Sync Clean Demucs BGM (no_vocals.wav) with video regardless of segment vs master narration mode
      const { voiceSettings: vs, cleanBgAudioUrl: bgUrl } = segAudioConfigRef.current;
      const bg = cleanBgAudioRef.current;
      if (bg && !renderedVideo && vs?.enableDemucs && bgUrl && !v.paused) {
        if (bg.paused) bg.play().catch(() => {});
        if (Number.isFinite(v.currentTime) && Math.abs(bg.currentTime - v.currentTime) > 0.04) {
          bg.currentTime = v.currentTime;
        }
      }

      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;

      const targetTime = getTargetTimelineTime();

      if (a.duration && Number.isFinite(a.duration) && targetTime >= a.duration) {
        if (!a.paused) a.pause();
        return;
      }

      // Resume audio if video is playing and audio is unexpectedly paused
      if (!v.paused && a.paused && (!a.duration || targetTime < a.duration)) {
        safePlayNarration(a);
      }

      const baseRate = v.playbackRate || 1.0;
      const drift = targetTime - a.currentTime;
      const absDrift = Math.abs(drift);
      const isCurrentlyNudged = Math.abs(a.playbackRate - baseRate) > 0.005;
      const isStartupGrace = (performance.now() - playStartTimeRef.current) < 800;

      // Tier 3: Severe desync (> 0.45s) or explicit user seeking (suppressed during 800ms startup grace)
      if (v.seeking) {
        if (a.playbackRate !== baseRate) a.playbackRate = baseRate;
      } else if (absDrift > 0.45 && !isStartupGrace) {
        if (!a.seeking) {
          const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
          a.currentTime = Math.min(targetTime, maxTime);
          if (a.playbackRate !== baseRate) a.playbackRate = baseRate;
        }
      } else if (isCurrentlyNudged) {
        // Tier 2 Recovery Hysteresis: continue nudge until drift falls below 20ms
        if (absDrift < 0.020) {
          a.playbackRate = baseRate;
        } else {
          const rateMultiplier = drift > 0 ? 1.08 : 0.92;
          a.playbackRate = parseFloat((baseRate * rateMultiplier).toFixed(3));
        }
      } else if (absDrift >= 0.040) {
        // Tier 2 Activation: drift exceeded 40ms, apply bounded temporary rate nudge
        const rateMultiplier = drift > 0 ? 1.08 : 0.92;
        a.playbackRate = parseFloat((baseRate * rateMultiplier).toFixed(3));
      } else if (a.playbackRate !== baseRate) {
        // Tier 1: Drift is < 40ms; preserve nominal rate
        a.playbackRate = baseRate;
      }
    };

    const handlePlay = () => {
      const { voiceSettings: vs, cleanBgAudioUrl: bgUrl } = segAudioConfigRef.current;
      const bg = cleanBgAudioRef.current;
      if (bg && !renderedVideo && vs?.enableDemucs && bgUrl) {
        if (Number.isFinite(v.currentTime)) bg.currentTime = v.currentTime;
        bg.play().catch(() => {});
      }

      if (hasSegmentAudios && !renderedVideo) {
        const tlNow = getTargetTimelineTime();
        preloadSegmentsAroundTime(tlNow);
        syncSegmentAudiosAtTime(tlNow);
      }

      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
      playStartTimeRef.current = performance.now();
      const targetTime = getTargetTimelineTime();
      if (a.readyState >= 1 && Number.isFinite(targetTime)) {
        const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
        if (Math.abs(a.currentTime - targetTime) > 0.04) {
          a.currentTime = Math.min(targetTime, maxTime);
        }
      }
      safePlayNarration(a);
    };

    const handlePause = () => {
      isPlayPendingRef.current = false;
      stopAllSegmentAudios();
      const bg = cleanBgAudioRef.current;
      if (bg && !bg.paused) {
        bg.pause();
      }
      const a = narrationAudioRef.current;
      if (a) {
        if (!a.paused) a.pause();
        a.playbackRate = v.playbackRate || 1.0;
      }
    };

    const handleSeeking = () => {
      isPlayPendingRef.current = false;
      stopAllSegmentAudios();
      const bg = cleanBgAudioRef.current;
      if (bg) {
        if (!bg.paused) bg.pause();
        if (Number.isFinite(v.currentTime)) bg.currentTime = v.currentTime;
      }
      const a = narrationAudioRef.current;
      if (a) {
        if (!a.paused) a.pause();
        a.playbackRate = v.playbackRate || 1.0;
        const targetTime = getTargetTimelineTime();
        if (a.readyState >= 1 && Number.isFinite(targetTime)) {
          const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
          a.currentTime = Math.min(targetTime, maxTime);
        }
      }
    };

    const handleSeeked = () => {
      const { voiceSettings: vs, cleanBgAudioUrl: bgUrl } = segAudioConfigRef.current;
      const bg = cleanBgAudioRef.current;
      if (bg && !renderedVideo && vs?.enableDemucs && bgUrl) {
        if (Number.isFinite(v.currentTime)) bg.currentTime = v.currentTime;
        if (!v.paused) bg.play().catch(() => {});
      }

      if (hasSegmentAudios && !renderedVideo) {
        const tlNow = getTargetTimelineTime();
        preloadSegmentsAroundTime(tlNow);
        if (!v.paused) {
          syncSegmentAudiosAtTime(tlNow);
        }
      }

      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
      a.playbackRate = v.playbackRate || 1.0;

      const targetTime = getTargetTimelineTime();
      if (a.duration && Number.isFinite(a.duration) && targetTime >= a.duration) {
        if (!a.paused) a.pause();
        return;
      }
      if (a.readyState >= 1) {
        const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
        a.currentTime = Math.min(targetTime, maxTime);
      }
      if (!v.paused) {
        safePlayNarration(a);
      }
    };

    const handleVisibilityChange = () => {
      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
      const targetTime = getTargetTimelineTime();
      if (document.visibilityState === 'visible' && !v.paused) {
        if (a.duration && Number.isFinite(a.duration) && targetTime >= a.duration) {
          if (!a.paused) a.pause();
          return;
        }
        if (a.readyState >= 1 && !a.seeking) {
          const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
          a.currentTime = Math.min(targetTime, maxTime);
        }
        safePlayNarration(a);
      }
    };

    const handleRateChange = () => {
      const a = narrationAudioRef?.current;
      if (a && v) {
        a.playbackRate = v.playbackRate || 1.0;
      }
      const bg = cleanBgAudioRef?.current;
      if (bg && v) {
        bg.playbackRate = v.playbackRate || 1.0;
      }
    };

    // Single idempotent play listener (avoids play/playing race conditions)
    v.addEventListener('play', handlePlay);
    v.addEventListener('timeupdate', handleSync);
    v.addEventListener('seeking', handleSeeking);
    v.addEventListener('seeked', handleSeeked);
    v.addEventListener('pause', handlePause);
    v.addEventListener('ended', handlePause);
    v.addEventListener('ratechange', handleRateChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isPlayPendingRef.current = false;
      v.removeEventListener('play', handlePlay);
      v.removeEventListener('timeupdate', handleSync);
      v.removeEventListener('seeking', handleSeeking);
      v.removeEventListener('seeked', handleSeeked);
      v.removeEventListener('pause', handlePause);
      v.removeEventListener('ended', handlePause);
      v.removeEventListener('ratechange', handleRateChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopAllSegmentAudios();
      if (narrationAudioRef.current) {
        if (!narrationAudioRef.current.paused) narrationAudioRef.current.pause();
        narrationAudioRef.current.playbackRate = 1.0;
      }
    };
  }, [videoRef, renderedVideo, audioGenerated, fullAudioUrl, hasSegmentAudios, videoClips, preloadSegmentsAroundTime, syncSegmentAudiosAtTime, stopAllSegmentAudios]);

  // Pre-calculate speaking intervals once per script change (ultra-fast O(1) checks during 60fps playback)
  const speakingIntervals = React.useMemo(() => {
    if (!scriptData?.segments) return [];
    return scriptData.segments
      .filter((seg) => {
        const hasText = Boolean((seg.khmer || seg.textKhmer || seg.text || seg.original || '').trim());
        const hasAudio = Boolean(seg.audioFile || seg.audioPath || seg.audioUrl);
        return !seg.muted && !seg.isMuted && (hasText || hasAudio);
      })
      .map((seg) => {
        const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
          ? seg.audioStartSec
          : (typeof seg.startSec === 'number' && !isNaN(seg.startSec)
            ? seg.startSec
            : parseTimeToSeconds(seg.audioStart ?? seg.start, 0));
        const dur = (typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
          ? seg.audioDurationSec
          : (typeof seg.audioDuration === 'number' && !isNaN(seg.audioDuration)
            ? seg.audioDuration
            : 2.5);
        const e = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
          ? seg.audioEndSec
          : (s + dur);
        return { start: s, end: e };
      });
  }, [audioGenerated, fullAudioUrl, scriptData?.segments]);

  // Fast binary search helper for sorted time intervals
  const findIntervalAtTime = (intervals, t) => {
    if (!intervals || intervals.length === 0) return false;
    let low = 0;
    let high = intervals.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const intv = intervals[mid];
      if (t >= intv.start && t <= intv.end) return true;
      if (t < intv.start) high = mid - 1;
      else low = mid + 1;
    }
    return false;
  };

  // Real-time Live Smart Ducking during Video Preview (O(log N) optimized)
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;

    if (renderedVideo) {
      if (v.muted) v.muted = false;
      if (v.volume !== 1.0) v.volume = 1.0;
      return;
    }

    const duckVal = voiceSettings.duckingVolume !== undefined ? Number(voiceSettings.duckingVolume) : 0.15;
    const khmerVal = voiceSettings.khmerVolume !== undefined ? Number(voiceSettings.khmerVolume) : 1.0;

    const isSpeaking = findIntervalAtTime(speakingIntervals, currentTime);

    // Live Mute for muted video clips (Mute Original Audio per-clip)
    const isCurrentVideoClipMuted = Array.isArray(videoClips) && videoClips.some((c) => {
      const cStart = Number.isFinite(c.start) ? c.start : 0;
      const cEnd = Number.isFinite(c.end) ? c.end : 0;
      return c.isMuted && currentTime >= (cStart - 0.02) && currentTime < cEnd;
    });

    const isDemucsActive = Boolean(voiceSettings?.enableDemucs && cleanBgAudioUrl);

    if (duckVal === 0 || isCurrentVideoClipMuted || isDemucsActive) {
      if (!v.muted) v.muted = true;
      if (v.volume !== 0) v.volume = 0;
    } else {
      if (v.muted) v.muted = false;
      // Proportional volume scaling: never force a 25% floor when user requests quiet audio (e.g. 1% -> 0.01)
      const targetVol = isSpeaking
        ? Math.min(1.0, Math.max(0, duckVal))
        : (speakingIntervals.length > 0 && duckVal > 0.05
            ? Math.min(1.0, duckVal * 1.4)
            : Math.min(1.0, Math.max(0, duckVal)));

      if (Math.abs(v.volume - targetVol) > 0.001) {
        v.volume = targetVol;
      }
    }

    // Clean Demucs BGM playback during Live Preview (Zero Chinese Dialogue)
    if (cleanBgAudioRef.current && isDemucsActive) {
      const bgAudio = cleanBgAudioRef.current;
      const targetBgmVol = isSpeaking
        ? Math.min(1.0, Math.max(0, duckVal))
        : (speakingIntervals.length > 0 && duckVal > 0.05
            ? Math.min(1.0, duckVal * 1.4)
            : Math.min(1.0, Math.max(0, duckVal)));

      if (Math.abs(bgAudio.volume - targetBgmVol) > 0.001) {
        bgAudio.volume = targetBgmVol;
      }
    }

    if (narrationAudioRef.current) {
      // Narration audio volume is governed by khmerVolume setting.
      // Note: The master narration track synthesized by FFmpeg already contains digital silence between segments.
      // Therefore, narration audio is NOT muted during gaps, preventing timer jitter from silencing speech!
      const isMutedBySetting = khmerVal <= 0.01;
      const shouldMute = isMutedBySetting || !audioGenerated || !fullAudioUrl;
      if (narrationAudioRef.current.muted !== shouldMute) {
        narrationAudioRef.current.muted = shouldMute;
      }
      const targetKhmer = shouldMute
        ? 0
        : Math.min(1.0, Math.max(0, khmerVal > 0 ? (khmerVal >= 1.0 ? 1.0 : khmerVal) : 0));
      if (Math.abs(narrationAudioRef.current.volume - targetKhmer) > 0.01) {
        narrationAudioRef.current.volume = targetKhmer;
      }
    }
  }, [currentTime, audioGenerated, audioOutdated, fullAudioUrl, renderedVideo, scriptData, voiceSettings, videoClips, videoRef]);

  const episodeSourceKey = `${seriesId || ''}::${episodeId || ''}::${selectedVideo?.videoId || selectedVideo?.videoUrl || ''}`;
  const prevEpisodeSourceKeyRef = useRef(episodeSourceKey);
  const pendingSrcSwitchSeekRef = useRef(null);
  const rawVideoSrc = (typeof renderedVideo === 'string' ? renderedVideo : renderedVideo?.outputVideoUrl) || selectedVideo?.videoUrl;
  const currentVideoSrc = rawVideoSrc && renderedVideo && typeof renderedVideo === 'object' && renderedVideo.renderedAt
    ? `${rawVideoSrc}${rawVideoSrc.includes('?') ? '&' : '?'}v=${renderedVideo.renderedAt}`
    : rawVideoSrc;
  const prevVideoSrcRef = useRef(currentVideoSrc);
  useEffect(() => {
    const isSameEpisodeSource = prevEpisodeSourceKeyRef.current === episodeSourceKey;
    if (!isSameEpisodeSource) {
      pendingSrcSwitchSeekRef.current = null;
    }
    if (prevVideoSrcRef.current && prevVideoSrcRef.current !== currentVideoSrc) {
      if (isSameEpisodeSource) {
        const t = Number(currentTimeRef.current);
        if (Number.isFinite(t) && t > 0) {
          pendingSrcSwitchSeekRef.current = { timelineTime: t, applied: false, mediaTarget: t };
        }
      }
      isPlayPendingRef.current = false;
      stopAllSegmentAudios();
      if (narrationAudioRef.current && !narrationAudioRef.current.paused) {
        narrationAudioRef.current.pause();
      }
      if (cleanBgAudioRef.current && !cleanBgAudioRef.current.paused) {
        cleanBgAudioRef.current.pause();
      }
    }
    prevEpisodeSourceKeyRef.current = episodeSourceKey;
    prevVideoSrcRef.current = currentVideoSrc;
  }, [currentVideoSrc, episodeSourceKey, stopAllSegmentAudios]);

  const handleInternalLoadedMetadata = (e) => {
    if (onLoadedMetadata) onLoadedMetadata(e);
    const v = e.target;
    if (v && v.videoWidth && v.videoHeight) {
      const r = v.videoWidth / v.videoHeight;
      setVideoMeta({
        width: v.videoWidth,
        height: v.videoHeight,
        ratio: r,
      });
    }
    if (v && pendingSrcSwitchSeekRef.current && !pendingSrcSwitchSeekRef.current.applied) {
      const restoreTlTime = pendingSrcSwitchSeekRef.current.timelineTime;
      let targetMediaTime = restoreTlTime;
      if (!renderedVideo && Array.isArray(videoClips) && videoClips.length > 0) {
        const mapping = mapTimelineToSourceTime(restoreTlTime, videoClips);
        if (mapping.inClip && Number.isFinite(mapping.sourceTime)) {
          targetMediaTime = mapping.sourceTime;
        } else if (mapping.isGap && mapping.nextClip && Number.isFinite(mapping.nextClip.sourceStart)) {
          targetMediaTime = mapping.nextClip.sourceStart;
        }
      }
      const maxDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : targetMediaTime;
      const clampedTarget = Math.max(0, Math.min(Math.max(0, maxDur - 0.02), targetMediaTime));
      if (Number.isFinite(clampedTarget) && clampedTarget > 0) {
        pendingSrcSwitchSeekRef.current.applied = true;
        pendingSrcSwitchSeekRef.current.mediaTarget = clampedTarget;
        if (Math.abs((v.currentTime || 0) - clampedTarget) > 0.03) {
          v.currentTime = clampedTarget;
        } else {
          pendingSrcSwitchSeekRef.current = null;
        }
      } else {
        pendingSrcSwitchSeekRef.current = null;
      }
    }
  };

  const handleInternalTimeUpdate = useCallback((e) => {
    const pending = pendingSrcSwitchSeekRef.current;
    if (pending) {
      const v = e?.target || videoRef?.current;
      if (!pending.applied || !v || Math.abs((v.currentTime || 0) - pending.mediaTarget) > 0.15) {
        return;
      }
      pendingSrcSwitchSeekRef.current = null;
    }
    if (onTimeUpdate) onTimeUpdate(e);
  }, [onTimeUpdate, videoRef]);

  const handleInternalSeeked = useCallback(() => {
    if (pendingSrcSwitchSeekRef.current?.applied) {
      pendingSrcSwitchSeekRef.current = null;
    }
  }, []);

  // Derive canonical timeline time coordinate for video and subtitle presentation.
  // In multi-clip draft preview with non-zero sourceStart, map HTML5 video element source time to timeline coordinate.
  const effectiveTimelineTime = (() => {
    const v = videoRef?.current;
    if (v && !renderedVideo && Array.isArray(videoClips) && videoClips.length > 0) {
      const srcTime = Number.isFinite(v.currentTime) ? v.currentTime : null;
      if (srcTime !== null && !v.paused) {
        const mappedTl = mapSourceToTimelineTime(srcTime, videoClips);
        if (Number.isFinite(mappedTl)) {
          return mappedTl;
        }
      }
    }
    return Number.isFinite(currentTime) ? currentTime : 0;
  })();

  // Pre-index segment intervals once per script update for O(log N) lookup during playback
  const indexedSegments = React.useMemo(() => {
    if (!scriptData?.segments || scriptData.segments.length === 0) return [];
    return scriptData.segments.map((seg) => {
      // STEP 2B: subtitle clip = segment's own [startSec, endSec] only
      const s = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
        ? seg.startSec
        : parseTimeToSeconds(seg.start ?? seg.startTime, 0);

      let e = (typeof seg.endSec === 'number' && !isNaN(seg.endSec))
        ? seg.endSec
        : parseTimeToSeconds(seg.end ?? seg.endTime, s + 2.5);

      if (isNaN(e) || e <= s || (e - s) < 0.6) {
        const textLen = String(seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.original || '').trim().length || 8;
        e = s + Math.max(1.8, Math.min(6.0, textLen * 0.16));
      }
      return { start: s, end: e, seg };
    });
  }, [scriptData?.segments]);

  // Fast O(log N) active segment lookup for smooth 60fps subtitle overlay
  const activeSegment = React.useMemo(() => {
    if (!indexedSegments || indexedSegments.length === 0) return null;
    const t = effectiveTimelineTime;
    let low = 0;
    let high = indexedSegments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const item = indexedSegments[mid];
      if (t >= item.start && t < (item.end - 0.001)) {
        return item.seg;
      }
      if (t < item.start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return null;
  }, [indexedSegments, effectiveTimelineTime]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().catch((err) => {
          console.warn('Container requestFullscreen notice:', err);
          if (videoRef?.current && videoRef.current.requestFullscreen) {
            videoRef.current.requestFullscreen().catch(() => {});
          }
        });
      } else if (containerRef.current.webkitRequestFullscreen) {
        containerRef.current.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  };

  const safeAspectRatio = sanitizeAspectRatio(aspectRatio) || '16:9';
  const targetRatio = safeAspectRatio === '9:16'
    ? (9 / 16)
    : (safeAspectRatio === '1:1' ? 1 : (16 / 9));
  const frameModeClass = safeAspectRatio === '9:16'
    ? 'is-aspect-frame is-portrait-frame'
    : (safeAspectRatio === '1:1' ? 'is-aspect-frame is-square-frame' : 'is-aspect-frame is-landscape-frame');

  const framedStageStyle = React.useMemo(() => {
    const padPx = isFullscreen ? 24 : 16;
    const rawW = Number(canvasBounds.width) || 0;
    const rawH = Number(canvasBounds.height) || 0;
    const availW = Math.max(0, Math.floor(rawW - padPx));
    const availH = Math.max(0, Math.floor(rawH - padPx));

    // When container bounds are unmeasured (0) or collapsed, render a normal CSS aspect-ratio 16:9 box
    // without inline pixel sizes so it stays contained inside its container.
    if (rawW <= 0 || rawH <= 0 || availW <= 0 || availH <= 0) {
      const cssPad = rawW > 0 && availW <= 0 ? '0px' : `${padPx}px`;
      const cssHPad = rawH > 0 && availH <= 0 ? '0px' : `${padPx}px`;
      return {
        width: `calc(100% - ${cssPad})`,
        height: 'auto',
        aspectRatio: '16 / 9',
        maxWidth: `calc(100% - ${cssPad})`,
        maxHeight: `calc(100% - ${cssHPad})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000000',
      };
    }

    const fittedW = Math.floor(Math.min(availW, availH * targetRatio));
    const fittedH = Math.floor(fittedW / targetRatio);
    const stageW = Math.max(1, Math.min(availW, fittedW));
    const stageH = Math.max(1, Math.min(availH, fittedH));

    return {
      width: `${stageW}px`,
      height: `${stageH}px`,
      maxWidth: `${availW}px`,
      maxHeight: `${availH}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000000',
    };
  }, [targetRatio, isFullscreen, canvasBounds.width, canvasBounds.height]);

  const videoObjectFit = (!renderedVideo && aspectRatio === '9:16' && verticalStyle === 'crop') ? 'cover' : 'contain';

  return (
    <div className={`capcut-player-panel ${isFullscreen ? 'is-fullscreen-active' : ''}`} ref={containerRef}>
      {/* Video View Canvas (Synced dynamically to 16:9 / 9:16 / 1:1) */}
      <div
        ref={canvasContainerRef}
        className={`player-canvas-container is-stage-host ${isFullscreen ? 'is-fullscreen' : ''}`}
      >
        <div
          className={`player-canvas-area ${frameModeClass} ${isFullscreen ? 'is-fullscreen' : ''}`}
          data-aspect-ratio={aspectRatio}
          data-testid="player-aspect-frame"
          style={framedStageStyle}
        >
          {currentVideoSrc ? (
            <div className="player-stage-viewport" data-testid="player-stage-viewport">
              <video
                ref={videoRef}
                src={currentVideoSrc}
                muted={!renderedVideo && (voiceSettings.duckingVolume === 0)}
                onTimeUpdate={handleInternalTimeUpdate}
                onSeeked={handleInternalSeeked}
                onLoadedMetadata={handleInternalLoadedMetadata}
                onClick={onPlayPause}
                onDoubleClick={toggleFullscreen}
                onEnded={onEnded}
                style={{
                  width: '100%',
                  height: '100%',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: videoObjectFit,
                  cursor: 'pointer',
                  display: 'block',
                  backgroundColor: '#000000',
                }}
              />

              {/* Real-time Synchronized Khmer AI Dubbing Audio Element (Fallback for monolithic audio when no segment clips exist) */}
              {!renderedVideo && !hasSegmentAudios && audioGenerated && fullAudioUrl && (
                <audio
                  ref={narrationAudioRef}
                  src={fullAudioUrl}
                  preload="auto"
                  onLoadedMetadata={() => {
                    if (recoveryManagerRef.current) {
                      recoveryManagerRef.current.handleAudioSuccess();
                    }
                    const v = videoRef?.current;
                    const a = narrationAudioRef?.current;
                    if (a) {
                      if ('preservesPitch' in a) a.preservesPitch = true;
                      if ('mozPreservesPitch' in a) a.mozPreservesPitch = true;
                      if ('webkitPreservesPitch' in a) a.webkitPreservesPitch = true;
                    }
                    if (v && a) {
                      const t = Number.isFinite(currentTimeRef.current) ? currentTimeRef.current : (v.currentTime || 0);
                      if (Number.isFinite(t)) {
                        const maxDur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : t;
                        a.currentTime = Math.max(0, Math.min(t, maxDur));
                      }
                      if (!v.paused) {
                        safePlayNarration(a);
                      }
                    }
                  }}
                  onCanPlay={() => {
                    if (recoveryManagerRef.current) {
                      recoveryManagerRef.current.handleAudioSuccess();
                    }
                  }}
                  onError={(e) => {
                    console.warn('Narration audio load/decode error detected, executing bounded recovery:', e);
                    if (recoveryManagerRef.current && fullAudioUrl) {
                      recoveryManagerRef.current.handleError(fullAudioUrl, narrationAudioRef.current);
                    }
                  }}
                />
              )}

              {/* Clean Demucs BGM Audio Element (Zero Chinese speech during Live Preview) */}
              {!renderedVideo && voiceSettings?.enableDemucs && cleanBgAudioUrl && (
                <audio
                  ref={cleanBgAudioRef}
                  src={cleanBgAudioUrl}
                  preload="auto"
                  onLoadedMetadata={() => {
                    const v = videoRef?.current;
                    const bg = cleanBgAudioRef?.current;
                    if (v && bg) {
                      bg.currentTime = v.currentTime || 0;
                      if (!v.paused) bg.play().catch(() => {});
                    }
                  }}
                />
              )}

              {/* Narration Media Load Error / 404 Bounded Recovery Notification */}
              {narrationError && (
                <div
                  className="narration-error-banner"
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    right: 12,
                    backgroundColor: 'rgba(220, 38, 38, 0.95)',
                    color: '#ffffff',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    zIndex: 40,
                    backdropFilter: 'blur(4px)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{narrationError.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNarrationError(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ffffff',
                      cursor: 'pointer',
                      fontSize: '18px',
                      padding: '0 4px',
                      lineHeight: 1,
                    }}
                    title="បិទ"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Preview Blur Strip Approximation for 9:16 Crop with Landscape Source */}
              {showPreviewCropBlurBand && (
                <div
                  className="preview-crop-sub-blur-strip"
                  data-testid="preview-crop-sub-blur-strip"
                  aria-hidden="true"
                />
              )}

              {/* Subtitle Overlay */}
              <LiveSubtitleOverlay
                activeSegment={activeSegment}
                voiceSettings={voiceSettings}
                renderedVideo={renderedVideo}
                currentTime={effectiveTimelineTime}
                aspectRatio={aspectRatio}
                verticalStyle={verticalStyle}
                videoMeta={videoMeta}
              />

              {/* Anti-Theft Running Marquee & Watermark Live Overlay */}
              <AntiTheftOverlay
                voiceSettings={voiceSettings}
                renderedVideo={renderedVideo}
                aspectRatio={aspectRatio}
                verticalStyle={verticalStyle}
                videoMeta={videoMeta}
              />

              {/* Logo Watermark Live Overlay (សងខាង / ជ្រុងលើ) */}
              <LogoOverlay
                voiceSettings={voiceSettings}
                renderedVideo={renderedVideo}
                aspectRatio={aspectRatio}
                verticalStyle={verticalStyle}
                videoMeta={videoMeta}
              />
            </div>
          ) : (
            <div className="empty-player-placeholder">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <div
                onClick={triggerFileInput}
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: '50%',
                  background: 'rgba(76, 141, 255, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 4,
                  border: '1px solid rgba(76, 141, 255, 0.35)',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  transition: 'transform 0.15s ease'
                }}
                title="Click to Import Video File"
              >
                {isUploading ? (
                  <Loader2 size={24} className="pulse-glow" color="var(--primary-accent)" />
                ) : (
                  <Video size={24} color="var(--primary-accent)" />
                )}
              </div>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isUploading ? 'កំពុង Upload វីដេអូរឿងភាគ...' : 'No Video Loaded'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 260, textAlign: 'center', lineHeight: 1.4 }}>
                {isUploading
                  ? 'សូមរង់ចាំបន្តិច ប្រព័ន្ធកំពុងដំណើរការបញ្ចូលវីដេអូ...'
                  : 'Import an MP4 or MOV video file to preview and start dubbing'}
              </span>

              {uploadError && (
                <div style={{ color: 'var(--color-error)', fontSize: '0.74rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={13} />
                  <span>{uploadError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={triggerFileInput}
                disabled={isUploading}
                className="btn btn-primary"
                style={{
                  marginTop: 10,
                  height: 34,
                  padding: '0 16px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: isUploading ? 'not-allowed' : 'pointer'
                }}
              >
                {isUploading ? (
                  <>
                    <Loader2 size={13} className="pulse-glow" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload size={13} />
                    <span>Import Video</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Player Bottom Control Bar */}
      <PlayerBottomBar
        currentTime={currentTime}
        playheadTimeRef={playheadTimeRef}
        subscribePlayhead={subscribePlayhead}
        duration={duration}
        onSeek={onSeek}
        currentVideoSrc={currentVideoSrc}
        isPlaying={isPlaying}
        onPlayPause={onPlayPause}
        voiceSettings={voiceSettings}
        onUpdateVoiceSettings={onUpdateVoiceSettings}
        onAspectRatioChange={onAspectRatioChange}
        activeSegment={activeSegment}
        toggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
        renderedVideo={renderedVideo}
        onResetToPreview={onResetToPreview || (() => setRenderedVideo && setRenderedVideo(null))}
      />
    </div>
  );
}

export default React.memo(VideoPlayerPreview);
