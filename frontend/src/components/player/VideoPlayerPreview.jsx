import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Video, Upload, Loader2, AlertCircle, Activity } from 'lucide-react';
import { parseTimeToSeconds } from '../../utils/timestampUtils';
import { mapSourceToTimelineTime, mapTimelineToSourceTime } from '../../utils/timelineUtils';
import { uploadVideoFile } from '../../services/api';
import { resolveDefaultAspectRatio, inferRenderedAspectRatio, sanitizeAspectRatio } from '../../utils/projectStorage';
import { subscribeDraftPreview } from '../../utils/sliderDraftPreview';
import { usePlayerAudioSync } from './usePlayerAudioSync';

import { PlayerBottomBar } from './PlayerControls';
import LiveSubtitleOverlay from './LiveSubtitleOverlay';
import AntiTheftOverlay from './AntiTheftOverlay';
import LogoOverlay from './LogoOverlay';
import CornerMaskOverlay from './CornerMaskOverlay';
import SponsorOverlay from './SponsorOverlay';
import VideoTransformControls from './VideoTransformControls';
import './VideoPlayerPreview.css';

export function interpolateKeyframeCrop(keyframes, time) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return null;
  const sorted = [...keyframes]
    .filter((k) => Number.isFinite(k.time) && k.time >= 0)
    .sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return null;
  if (sorted.length === 1 || time <= sorted[0].time) return sorted[0].cropX;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].cropX;

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];
    if (time >= k0.time && time <= k1.time) {
      const dur = k1.time - k0.time;
      if (dur <= 0.001) return k0.cropX;
      const alpha = Math.max(0, Math.min(1, (time - k0.time) / dur));
      // Cosine ease-in-out for smooth camera pan
      const ease = (1 - Math.cos(alpha * Math.PI)) / 2;
      const val = k0.cropX + (k1.cropX - k0.cropX) * ease;
      return Math.round(val * 10) / 10;
    }
  }
  return sorted[sorted.length - 1].cropX;
}

function VideoPlayerPreview({
  selectedVideo,
  videoMetadata = null,
  seriesId,
  episodeId,
  scriptData,
  renderedVideo,
  previewMode, onPreviewMode, canViewRender, proxyStatus, sourceProxy = null,
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
  onSeeked = null,
  voiceSettings = {},
  onUpdateVoiceSettings = null,
  onAspectRatioChange = null,
  onUpdateSegments = null,
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

  const fileInputRef = useRef(null);

  // Diagnostics panel metrics state (FPS, dropped frames, seek latency, audio drift)
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [measuredFps, setMeasuredFps] = useState(0);
  const [droppedVideoFrames, setDroppedVideoFrames] = useState(0);
  const [seekLatencyMs, setSeekLatencyMs] = useState(null);
  const [audioDriftMs, setAudioDriftMs] = useState(0);
  const seekStartMsRef = useRef(null);
  const fpsFrameTimestampsRef = useRef([]);

  const {
    narrationAudioRef,
    cleanBgAudioRef,
    cleanBgAudioUrl,
    activeSegmentAudiosRef,
    currentTimeRef,
    isPlayingRef,
    isPlayPendingRef,
    webAudioSchedulerRef,
    effectiveUseWebAudioRef,
    setUseWebAudioState,
    narrationError,
    setNarrationError,
    recoveryManagerRef,
    isFreshProxy,
    hasSegmentAudios,
    segAudioConfigRef,
    stopAllSegmentAudios,
    safePlayNarration,
    unlockAudioContext,
  } = usePlayerAudioSync({
    selectedVideo,
    seriesId,
    episodeId,
    scriptData,
    renderedVideo,
    proxyStatus,
    isVisualBaked: Boolean(renderedVideo && !renderedVideo.isProxyPreview),
    isAudioBaked: Boolean(renderedVideo && (!renderedVideo.isProxyPreview || (renderedVideo.isProxyPreview && proxyStatus?.state === 'fresh'))),
    videoRef,
    currentTime,
    isPlaying,
    audioGenerated,
    audioOutdated,
    fullAudioUrl,
    voiceSettings,
    videoClips,
    setAudioDriftMs,
    fpsFrameTimestampsRef,
    setMeasuredFps,
    setDroppedVideoFrames,
  });

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


  // Zero-rerender live audio volume & YouTube zoom preview while dragging sliders
  useEffect(() => {
    return subscribeDraftPreview(['duckingVolume', 'khmerVolume', 'zoomScale'], ({ key, value, cleared }) => {
      const cfg = segAudioConfigRef.current || {};
      // Allow zoom preview on live & proxy-preview (unbaked visual); skip only on final baked MP4
      if (cfg.isVisualBaked) return;

      if (key === 'zoomScale') {
        if (!videoRef?.current) return;
        const mirror = Boolean(cfg.voiceSettings?.enableMirrorFlip);
        const rawZoom = cleared
          ? Number(cfg.voiceSettings?.zoomScale)
          : Number(value);
        const clampedZoom = Number.isFinite(rawZoom)
          ? Math.max(1.0, Math.min(1.15, rawZoom))
          : 1.0;
        const parts = [];
        if (mirror) parts.push('scaleX(-1)');
        if (clampedZoom > 1.005) parts.push(`scale(${clampedZoom.toFixed(3)})`);
        videoRef.current.style.transform = parts.length > 0 ? parts.join(' ') : 'none';
        return;
      }

      if (cleared || !Number.isFinite(value)) return;
      // Skip volume preview on baked audio (final render or fresh proxy)
      if (cfg.isAudioBaked) return;

      if (key === 'duckingVolume') {
        const isCustomBgmActive = Boolean(cfg.voiceSettings?.enableCustomBgm && cfg.voiceSettings?.customBgmUrl);
        const isYoutubeSafeAudio = Boolean(cfg.voiceSettings?.youtubeSafeAudio && !isCustomBgmActive);
        if (isYoutubeSafeAudio) {
          if (videoRef?.current) {
            videoRef.current.muted = true;
            videoRef.current.volume = 0;
          }
          // Only mute cleanBgAudio if it's not Custom BGM (Custom BGM should keep playing)
          if (cleanBgAudioRef.current && !isCustomBgmActive) {
            cleanBgAudioRef.current.muted = true;
            cleanBgAudioRef.current.volume = 0;
          }
          return;
        }
        const clamped = Math.min(1.0, Math.max(0, value));
        const isDemucs = Boolean(cfg.voiceSettings?.enableDemucs && cleanBgAudioRef.current);
        if (isDemucs && cleanBgAudioRef.current) {
          cleanBgAudioRef.current.muted = clamped <= 0.001;
          cleanBgAudioRef.current.volume = clamped;
        } else if (videoRef?.current) {
          videoRef.current.muted = clamped <= 0.001;
          videoRef.current.volume = clamped;
        }
      } else if (key === 'khmerVolume') {
        const clamped = Math.min(1.0, Math.max(0, value));
        const isMuted = value <= 0.01;
        if (webAudioSchedulerRef.current?.isSupported()) {
          webAudioSchedulerRef.current.setMasterVolume(value, isMuted);
        }
        if (narrationAudioRef.current) {
          narrationAudioRef.current.muted = isMuted;
          narrationAudioRef.current.volume = isMuted ? 0 : clamped;
        }
        const activeAudios = activeSegmentAudiosRef.current || {};
        Object.values(activeAudios).forEach((item) => {
          if (item?.audio) {
            item.audio.volume = isMuted ? 0 : clamped;
          }
        });
      }
    });
  }, [videoRef]);

  const episodeSourceKey = `${seriesId || ''}::${episodeId || ''}::${selectedVideo?.videoId || selectedVideo?.videoUrl || ''}`;
  const prevEpisodeSourceKeyRef = useRef(episodeSourceKey);
  const pendingSrcSwitchSeekRef = useRef(null);
  const fallbackLiveUrl = selectedVideo?.videoUrl || selectedVideo?.videoFile || (selectedVideo?.videoId ? (selectedVideo.videoId.startsWith('/') ? selectedVideo.videoId : `/uploads/${selectedVideo.videoId}`) : null);
  const effectiveLiveVideoUrl = (sourceProxy?.isReady && sourceProxy?.url) ? sourceProxy.url : fallbackLiveUrl;
  const rawVideoSrc = (typeof renderedVideo === 'string' ? renderedVideo : renderedVideo?.outputVideoUrl) || effectiveLiveVideoUrl;
  const targetVideoSrc = rawVideoSrc && renderedVideo && typeof renderedVideo === 'object' && renderedVideo.renderedAt
    ? `${rawVideoSrc}${rawVideoSrc.includes('?') ? '&' : '?'}v=${renderedVideo.renderedAt}`
    : rawVideoSrc;

  const prevPreviewModeRef = useRef(previewMode);
  const deferredVideoSrcRef = useRef(null);
  const prevVideoSrcRef = useRef(targetVideoSrc);

  const isExplicitModeSwitch = prevPreviewModeRef.current !== previewMode;
  prevPreviewModeRef.current = previewMode;

  const isActivelyPlaying = Boolean(isPlayingRef.current || (videoRef?.current && !videoRef.current.paused));

  // Safety Condition 1: Defer background proxy src hot-swapping during active playback to prevent buffer drops
  const episodeChanged = prevEpisodeSourceKeyRef.current !== episodeSourceKey;
  if (!episodeChanged && isActivelyPlaying && !isExplicitModeSwitch && prevVideoSrcRef.current && prevVideoSrcRef.current !== targetVideoSrc) {
    deferredVideoSrcRef.current = targetVideoSrc;
  } else if (episodeChanged || !isActivelyPlaying || isExplicitModeSwitch) {
    deferredVideoSrcRef.current = null;
  }

  const currentVideoSrc = (deferredVideoSrcRef.current && isActivelyPlaying) ? prevVideoSrcRef.current : targetVideoSrc;
  useEffect(() => {
    const isSameEpisodeSource = prevEpisodeSourceKeyRef.current === episodeSourceKey;
    if (!isSameEpisodeSource) {
      pendingSrcSwitchSeekRef.current = null;
    }
    if (prevVideoSrcRef.current && prevVideoSrcRef.current !== currentVideoSrc) {
      const wasPlaying = Boolean(isPlayingRef.current || (videoRef?.current && !videoRef.current.paused));
      if (isSameEpisodeSource) {
        const t = Number(currentTimeRef.current);
        if (Number.isFinite(t) && t > 0) {
          pendingSrcSwitchSeekRef.current = { timelineTime: t, applied: false, mediaTarget: t, wasPlaying, setAt: performance.now() };
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
      const shouldResumePlay = Boolean(pendingSrcSwitchSeekRef.current.wasPlaying);
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
      if (shouldResumePlay && v && v.paused) {
        v.play().catch(() => {});
      }
    }
  };

  const handleInternalTimeUpdate = useCallback((e) => {
    const pending = pendingSrcSwitchSeekRef.current;
    if (pending) {
      const v = e?.target || videoRef?.current;
      const isClose = v && Math.abs((v.currentTime || 0) - pending.mediaTarget) <= 0.15;
      const isStale = (performance.now() - (pending.setAt || 0)) > 600;
      if (!pending.applied && !isClose && !isStale) {
        return;
      }
      pendingSrcSwitchSeekRef.current = null;
    }
    if (onTimeUpdate) onTimeUpdate(e);
  }, [onTimeUpdate, videoRef]);

  const handleInternalSeeked = useCallback((e) => {
    if (seekStartMsRef.current !== null) {
      const lat = Math.round(performance.now() - seekStartMsRef.current);
      setSeekLatencyMs(lat);
      seekStartMsRef.current = null;
    }
    if (pendingSrcSwitchSeekRef.current?.applied) {
      pendingSrcSwitchSeekRef.current = null;
    }
    if (onSeeked) onSeeked(e);
  }, [onSeeked]);

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
    const list = scriptData.segments.map((seg, idx) => {
      const hasVoice = Boolean(
        seg.audioUrl ||
        seg.audioPath ||
        seg.rawAudioPath ||
        seg.audioFile ||
        seg.rawAudioFile ||
        seg.ttsStatus === 'ready' ||
        seg.status === 'audio_ready' ||
        (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0) ||
        (typeof seg.audioDuration === 'number' && seg.audioDuration > 0) ||
        (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0)
      );

      const s = (hasVoice && typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : ((typeof seg.startSec === 'number' && !isNaN(seg.startSec))
          ? seg.startSec
          : parseTimeToSeconds(seg.start ?? seg.startTime, idx * 4));

      const realAudioDur = hasVoice
        ? ((typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
          ? seg.finalAudioDuration
          : ((typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0 && !isNaN(seg.audioDurationSec))
            ? seg.audioDurationSec
            : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
              ? seg.audioDuration
              : ((typeof seg.originalAudioDuration === 'number' && seg.originalAudioDuration > 0)
                ? seg.originalAudioDuration
                : ((typeof seg.rawAudioDur === 'number' && seg.rawAudioDur > 0)
                  ? seg.rawAudioDur
                  : null)))))
        : null;

      const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
      let e;
      if (isTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec)) {
        e = seg.audioEndSec;
      } else if (realAudioDur && realAudioDur > 0) {
        // Subtitle strictly closes when voice speech finishes
        e = s + realAudioDur;
      } else if (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) {
        e = seg.endSec;
      } else {
        e = parseTimeToSeconds(seg.end ?? seg.endTime, s + 2.5);
      }

      if (isNaN(e) || e <= s || (e - s) < 0.2) {
        const textLen = String(seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.original || '').trim().length || 8;
        e = s + Math.max(1.2, Math.min(5.0, textLen * 0.16));
      }
      return { start: s, end: e, seg };
    });
    return list.sort((a, b) => a.start - b.start);
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

  const [isAnalyzingFraming, setIsAnalyzingFraming] = useState(false);
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [liveDragCropX, setLiveDragCropX] = useState(null);
  const dragStartXRef = useRef(0);
  const dragStartCropXRef = useRef(50);
  const hasDraggedRef = useRef(false);

  const is916Crop = !renderedVideo && aspectRatio === '9:16' && verticalStyle === 'crop' && isSourceLandscape;

  // Active framing lookup: maps playhead time to the active scene/segment (per-segment framing)
  const activeFramingInfo = React.useMemo(() => {
    const t = effectiveTimelineTime;
    const segs = indexedSegments || [];
    const allSegments = scriptData?.segments || [];

    // Filter out corrupted whole-episode overrides (e.g. from previous bug covering whole video)
    const validOverrides = (scriptData?.framingOverrides || []).filter(
      (o) => !(o.startSec === 0 && o.endSec > 30)
    );

    // 1. Direct match in an indexed speech segment (voice box)
    if (activeSegment) {
      const segCropX = activeSegment.cropX !== undefined && activeSegment.cropX !== null && !isNaN(Number(activeSegment.cropX))
        ? Number(activeSegment.cropX)
        : null;
      const resolvedCropX = segCropX !== null
        ? segCropX
        : (activeSegment.cropPosition === 'left' ? 20 : activeSegment.cropPosition === 'right' ? 80 : 50);

      return {
        type: 'segment',
        id: activeSegment._uid || activeSegment.id,
        segment: activeSegment,
        startSec: activeSegment.startSec,
        endSec: activeSegment.endSec,
        cropX: resolvedCropX,
        cropPosition: activeSegment.cropPosition || (resolvedCropX < 35 ? 'left' : resolvedCropX > 65 ? 'right' : 'center'),
      };
    }

    // 2. Video clip under playhead: resolve which segment is linked to this video cut
    if (Array.isArray(videoClips) && videoClips.length > 0) {
      const activeClip = videoClips.find((c) => t >= c.start && t < c.end);
      if (activeClip) {
        const linkedSeg = allSegments.find((s, idx) => {
          if (s.clipId && activeClip.id && String(s.clipId) === String(activeClip.id)) return true;
          if (activeClip.segmentId && (String(s.id) === String(activeClip.segmentId) || String(s._uid) === String(activeClip.segmentId))) return true;
          if (activeClip.segmentIndex && (s.id === activeClip.segmentIndex || (idx + 1) === activeClip.segmentIndex)) return true;
          return false;
        });

        if (linkedSeg) {
          const segCropX = linkedSeg.cropX !== undefined && linkedSeg.cropX !== null && !isNaN(Number(linkedSeg.cropX))
            ? Number(linkedSeg.cropX)
            : null;
          const resolvedCropX = segCropX !== null
            ? segCropX
            : (linkedSeg.cropPosition === 'left' ? 20 : linkedSeg.cropPosition === 'right' ? 80 : 50);

          return {
            type: 'segment',
            id: linkedSeg._uid || linkedSeg.id,
            segment: linkedSeg,
            startSec: activeClip.start,
            endSec: activeClip.end,
            cropX: resolvedCropX,
            cropPosition: linkedSeg.cropPosition || (resolvedCropX < 35 ? 'left' : resolvedCropX > 65 ? 'right' : 'center'),
          };
        }
      }
    }

    // 3. Spanning dialogue interval: each segment naturally owns the camera until the next segment begins
    if (segs.length > 0) {
      let prevSeg = null;
      let nextSeg = null;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].end <= t) {
          prevSeg = segs[i];
        } else if (segs[i].start > t && !nextSeg) {
          nextSeg = segs[i];
          break;
        }
      }

      // The active scene belongs to prevSeg (or nextSeg if before first segment)
      const targetSegItem = prevSeg || nextSeg;
      if (targetSegItem && targetSegItem.seg) {
        const sObj = targetSegItem.seg;
        const segCropX = sObj.cropX !== undefined && sObj.cropX !== null && !isNaN(Number(sObj.cropX))
          ? Number(sObj.cropX)
          : null;
        const resolvedCropX = segCropX !== null
          ? segCropX
          : (sObj.cropPosition === 'left' ? 20 : sObj.cropPosition === 'right' ? 80 : 50);

        return {
          type: 'segment',
          id: sObj._uid || sObj.id,
          segment: sObj,
          startSec: prevSeg ? prevSeg.end : 0,
          endSec: nextSeg ? nextSeg.start : (duration || 1000),
          cropX: resolvedCropX,
          cropPosition: sObj.cropPosition || (resolvedCropX < 35 ? 'left' : resolvedCropX > 65 ? 'right' : 'center'),
        };
      }
    }

    // 4. Custom localized override (only if reasonable duration <= 30s)
    const directOverride = validOverrides.find((o) => t >= o.startSec && t <= o.endSec && (o.endSec - o.startSec <= 30));
    if (directOverride) {
      return {
        type: 'override',
        id: directOverride.id,
        startSec: directOverride.startSec,
        endSec: directOverride.endSec,
        cropX: directOverride.cropX,
        cropPosition: directOverride.cropPosition,
      };
    }

    return {
      type: 'default',
      id: 'default',
      startSec: 0,
      endSec: duration || 1000,
      cropX: 50,
      cropPosition: 'center',
    };
  }, [effectiveTimelineTime, indexedSegments, scriptData?.framingOverrides, scriptData?.segments, activeSegment, videoClips, duration]);

  // Keyframe crop calculation (highest priority when keyframes exist)
  const keyframeCropX = React.useMemo(() => {
    const kfs = scriptData?.framingKeyframes;
    if (Array.isArray(kfs) && kfs.length > 0) {
      return interpolateKeyframeCrop(kfs, effectiveTimelineTime);
    }
    return null;
  }, [scriptData?.framingKeyframes, effectiveTimelineTime]);

  // 60FPS Silky-Smooth Keyframe Camera Pan Animation during Video Playback (bypasses 200ms React state updates)
  useEffect(() => {
    if (typeof subscribePlayhead !== 'function') return undefined;

    return subscribePlayhead((liveTime) => {
      const v = videoRef?.current;
      if (!v || !is916Crop || isDraggingCrop) return;

      const kfs = scriptData?.framingKeyframes;
      if (Array.isArray(kfs) && kfs.length > 0) {
        const cropVal = interpolateKeyframeCrop(kfs, liveTime);
        if (cropVal !== null) {
          v.style.objectPosition = `${cropVal}% 50%`;
        }
      }
    });
  }, [subscribePlayhead, is916Crop, isDraggingCrop, scriptData?.framingKeyframes, videoRef]);

  const activeCropX = React.useMemo(() => {
    if (keyframeCropX !== null) {
      return keyframeCropX;
    }
    if (activeFramingInfo.cropX !== undefined && activeFramingInfo.cropX !== null && !isNaN(Number(activeFramingInfo.cropX))) {
      return Number(activeFramingInfo.cropX);
    }
    if (activeFramingInfo.cropPosition === 'left') return 20;
    if (activeFramingInfo.cropPosition === 'right') return 80;
    return 50;
  }, [keyframeCropX, activeFramingInfo]);

  const effectiveCropX = liveDragCropX !== null ? liveDragCropX : activeCropX;

  // Toggle Keyframe (Add or Delete diamond at current playhead)
  const handleToggleKeyframe = useCallback(async () => {
    const t = effectiveTimelineTime;
    const kfs = [...(scriptData?.framingKeyframes || [])];
    const existingIdx = kfs.findIndex((k) => Math.abs(k.time - t) <= 0.35);

    let nextKfs = [];
    if (existingIdx >= 0) {
      // Delete keyframe
      nextKfs = kfs.filter((_, idx) => idx !== existingIdx);
    } else {
      // Add new keyframe with current effectiveCropX
      const curCrop = effectiveCropX;
      const resolvedPos = curCrop < 35 ? 'left' : curCrop > 65 ? 'right' : 'center';
      const newKf = {
        id: `kf_${Math.round(t * 1000)}_${Math.random().toString(36).substr(2, 4)}`,
        time: parseFloat(t.toFixed(2)),
        cropX: Math.round(curCrop),
        cropPosition: resolvedPos,
      };
      nextKfs = [...kfs, newKf].sort((a, b) => a.time - b.time);
    }

    if (scriptData) {
      scriptData.framingKeyframes = nextKfs;
    }
    if (onUpdateSegments && scriptData?.segments) {
      onUpdateSegments([...scriptData.segments]);
    }

    if (seriesId && episodeId) {
      try {
        await fetch('/api/video/update-framing-keyframes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seriesId, episodeId, keyframes: nextKfs }),
        });
      } catch (err) {
        console.warn('[Keyframe Update Warning]:', err);
      }
    }
  }, [effectiveTimelineTime, scriptData, effectiveCropX, onUpdateSegments, seriesId, episodeId]);

  // Jump to Prev / Next Keyframe
  const handleSeekToKeyframe = useCallback((dir) => {
    const t = effectiveTimelineTime;
    const kfs = (scriptData?.framingKeyframes || []).sort((a, b) => a.time - b.time);
    if (kfs.length === 0) return;

    if (dir === 'prev') {
      const prevs = kfs.filter((k) => k.time < t - 0.1);
      if (prevs.length > 0 && onSeek) {
        onSeek(prevs[prevs.length - 1].time);
      }
    } else {
      const nexts = kfs.filter((k) => k.time > t + 0.1);
      if (nexts.length > 0 && onSeek) {
        onSeek(nexts[0].time);
      }
    }
  }, [effectiveTimelineTime, scriptData?.framingKeyframes, onSeek]);

  const keyframeSaveTimerRef = useRef(null);
  const handleUpdateActiveCrop = useCallback(async (newCropVal, posName) => {
    const t = effectiveTimelineTime;
    const clampedCrop = Math.max(5, Math.min(95, Number(newCropVal)));
    const resolvedPos = posName || (clampedCrop < 35 ? 'left' : clampedCrop > 65 ? 'right' : 'center');

    // Immediately update live video preview style so dragging is instant and 60fps buttery smooth
    if (videoRef?.current && is916Crop) {
      videoRef.current.style.objectPosition = `${clampedCrop}% 50%`;
    }

    // If keyframes exist, updating crop near an existing keyframe updates that keyframe, or auto-creates one at playhead (CapCut style)
    const kfs = scriptData?.framingKeyframes;
    if (Array.isArray(kfs) && kfs.length > 0) {
      const existingKfIdx = kfs.findIndex((k) => Math.abs(k.time - t) <= 0.35);
      let nextKfs = [];
      if (existingKfIdx >= 0) {
        nextKfs = [...kfs];
        nextKfs[existingKfIdx] = {
          ...nextKfs[existingKfIdx],
          cropX: clampedCrop,
          cropPosition: resolvedPos,
        };
      } else {
        const newKf = {
          id: `kf_${Math.round(t * 1000)}_${Math.random().toString(36).substr(2, 4)}`,
          time: parseFloat(t.toFixed(2)),
          cropX: clampedCrop,
          cropPosition: resolvedPos,
        };
        nextKfs = [...kfs, newKf].sort((a, b) => a.time - b.time);
      }

      scriptData.framingKeyframes = nextKfs;
      if (onUpdateSegments && scriptData?.segments) {
        onUpdateSegments([...scriptData.segments]);
      }
      if (seriesId && episodeId) {
        if (keyframeSaveTimerRef.current) clearTimeout(keyframeSaveTimerRef.current);
        keyframeSaveTimerRef.current = setTimeout(() => {
          fetch('/api/video/update-framing-keyframes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seriesId, episodeId, keyframes: nextKfs }),
          }).catch(() => {});
        }, 200);
      }
      return;
    }
    const framing = activeFramingInfo;

    if (framing.type === 'segment' && framing.id) {
      const segId = framing.id;
      if (onUpdateSegments && scriptData?.segments) {
        const updated = scriptData.segments.map((s) => {
          const match = (s._uid && s._uid === segId) ||
                        (s.id !== undefined && s.id !== null && String(s.id) === String(segId)) ||
                        (framing.segment && (s === framing.segment || (s._uid && s._uid === framing.segment._uid) || (s.id !== undefined && s.id === framing.segment.id)));
          if (match) {
            return {
              ...s,
              cropX: clampedCrop,
              cropPosition: resolvedPos,
              manualCrop: true,
            };
          }
          return s;
        });

        // Purge any corrupted whole-episode overrides from scriptData
        if (scriptData) {
          if (Array.isArray(scriptData.framingOverrides)) {
            scriptData.framingOverrides = scriptData.framingOverrides.filter(
              (o) => !(o.startSec === 0 && o.endSec > 30)
            );
          }
        }

        onUpdateSegments(updated);
      }
    } else {
      // Localized override (only for tight intervals <= 30s)
      const rangeDur = (framing.endSec || 0) - (framing.startSec || 0);
      if (rangeDur <= 30) {
        const overrides = [...(scriptData?.framingOverrides || [])].filter((o) => !(o.startSec === 0 && o.endSec > 30));
        const existingIdx = overrides.findIndex((o) => o.id === framing.id || Math.abs(o.startSec - framing.startSec) < 0.2);
        const newOverride = {
          id: framing.id,
          startSec: framing.startSec,
          endSec: framing.endSec,
          cropX: clampedCrop,
          cropPosition: resolvedPos,
          manualCrop: true,
        };
        if (existingIdx >= 0) {
          overrides[existingIdx] = newOverride;
        } else {
          overrides.push(newOverride);
        }

        if (scriptData) {
          scriptData.framingOverrides = overrides;
        }
        if (onUpdateSegments && scriptData?.segments) {
          onUpdateSegments([...scriptData.segments]);
        }
      }
    }

    if (seriesId && episodeId) {
      try {
        await fetch('/api/video/update-segment-crop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seriesId,
            episodeId,
            segmentId: framing.id,
            cropX: clampedCrop,
            cropPosition: resolvedPos,
            rangeStart: framing.startSec,
            rangeEnd: framing.endSec,
          }),
        });
      } catch (err) {
        console.warn('[Update Crop Backend Warning]:', err);
      }
    }
  }, [activeFramingInfo, onUpdateSegments, scriptData, seriesId, episodeId]);

  const handleVideoMouseDown = useCallback((e) => {
    if (e.button !== 0) return;

    // Only allow drag for 9:16 portrait crop framing. Normal landscape video stays 100% locked!
    if (is916Crop) {
      dragStartXRef.current = e.clientX;
      dragStartCropXRef.current = effectiveCropX;
      hasDraggedRef.current = false;
      setIsDraggingCrop(true);

      const rect = videoRef?.current?.getBoundingClientRect();
      const frameW = rect?.width || 360;
      const sensitivity = 70.0 / Math.max(120, frameW);
      let latestVal = dragStartCropXRef.current;

      const onMouseMove = (moveEvt) => {
        const deltaX = moveEvt.clientX - dragStartXRef.current;
        if (Math.abs(deltaX) > 2) {
          hasDraggedRef.current = true;
        }
        const nextCrop = Math.max(5, Math.min(95, dragStartCropXRef.current - (deltaX * sensitivity)));
        latestVal = Math.round(nextCrop * 10) / 10;
        setLiveDragCropX(latestVal);
      };

      const onMouseUp = () => {
        setIsDraggingCrop(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        if (hasDraggedRef.current) {
          handleUpdateActiveCrop(latestVal);
        }
        setLiveDragCropX(null);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
  }, [is916Crop, effectiveCropX, videoRef, handleUpdateActiveCrop]);

  const handlePlayPauseWithAudioUnlock = useCallback(() => {
    unlockAudioContext?.();
    if (onPlayPause) {
      onPlayPause();
    }
  }, [unlockAudioContext, onPlayPause]);

  const handleVideoClick = useCallback((e) => {
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handlePlayPauseWithAudioUnlock();
  }, [handlePlayPauseWithAudioUnlock]);

  const handleAnalyzeFraming = useCallback(async () => {
    if (!seriesId || !episodeId || isAnalyzingFraming) return;
    setIsAnalyzingFraming(true);
    try {
      const res = await fetch('/api/video/analyze-framing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesId,
          episodeId,
          videoPath: selectedVideo?.path || selectedVideo?.filePath || null,
        }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.segments) && onUpdateSegments) {
        onUpdateSegments(data.segments);
      }
    } catch (err) {
      console.error('[Analyze Framing Failed]:', err);
    } finally {
      setIsAnalyzingFraming(false);
    }
  }, [seriesId, episodeId, selectedVideo, onUpdateSegments, isAnalyzingFraming]);

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
  const overlayRender = renderedVideo?.isProxyPreview ? null : renderedVideo;
  const renderProgressText = proxyStatus?.progress?.percent
    ? `កំពុង Render ${proxyStatus.progress.percent}% (${proxyStatus.elapsedSeconds || 0}s)`
    : `កំពុង Render (${proxyStatus?.elapsedSeconds || 0}s)`;
  const queuedText = (proxyStatus?.queuedSeconds ?? 0) > 0
    ? `Queued (${proxyStatus.queuedSeconds}s)`
    : 'Queued';
  const proxyActivity = proxyStatus?.state === 'superseded' ? 'Reopen episode to load newer edits' :
    proxyStatus?.state === 'rendering' ? renderProgressText : queuedText;
  const showLiveFallbackBadge = previewMode === 'proxy' && !renderedVideo?.isProxyPreview && isPlaying;

  const isLiveMode = previewMode === 'live';
  const isSourceProxyTranscoding = sourceProxy?.status === 'transcoding';
  const isSourceProxyReady = sourceProxy?.status === 'ready' && Boolean(sourceProxy?.url);

  let badgeText = '';
  let badgeState = 'stale';

  if (isLiveMode) {
    if (isSourceProxyTranscoding) {
      badgeText = `Source Proxy កំពុង Transcode ${sourceProxy.progress || 0}% (${sourceProxy.elapsedSeconds || 0}s)`;
      badgeState = 'rendering';
    } else if (isSourceProxyReady) {
      badgeText = `Live (Source Proxy 480p · ${sourceProxy.duration ? sourceProxy.duration.toFixed(1) + 's' : 'Ready'})`;
      badgeState = 'fresh';
    } else if (sourceProxy?.status === 'error') {
      badgeText = `Live (Original Source · Error: ${sourceProxy.error || 'Transcode failed'})`;
      badgeState = 'error';
    } else {
      badgeText = 'Live Preview (Original Source)';
      badgeState = 'stale';
    }
  } else {
    // Proxy Preview mode
    if (proxyStatus?.state === 'fresh') {
      badgeText = `${proxyStatus.duration.toFixed(1)}s · ${(proxyStatus.bytes / 1048576).toFixed(1)} MiB · Render ${proxyStatus.renderSeconds.toFixed(1)}s`;
      badgeState = 'fresh';
    } else {
      badgeText = `Preview មិនទាន់ថ្មី · ${proxyStatus?.error ? `Error: ${proxyStatus.error}` : proxyActivity}`;
      badgeState = proxyStatus?.state || 'stale';
      if (isSourceProxyTranscoding && !proxyStatus?.error && proxyStatus?.state !== 'rendering') {
        badgeText += ` · Source Proxy: ${sourceProxy.progress || 0}%`;
      }
    }
  }

  return (
    <div className={`capcut-player-panel ${isFullscreen ? 'is-fullscreen-active' : ''}`} ref={containerRef}>
      {(selectedVideo || currentVideoSrc) && (
        <div className="proxy-preview-controls">
          {/* Left: Playback Preview Mode + Compact Status */}
          <div className="monitor-topbar-left">
            {selectedVideo && onPreviewMode && (
              <>
                <select
                  aria-label="Preview playback mode"
                  className="monitor-mode-select"
                  value={previewMode}
                  onChange={e => onPreviewMode(e.target.value)}
                >
                  <option value="proxy">Proxy Preview</option>
                  <option value="live">Live Preview</option>
                  {canViewRender && <option value="rendered">Rendered</option>}
                </select>
                <span
                  className={`monitor-status-pill is-${badgeState}`}
                  title={badgeText}
                >
                  <span className="monitor-status-dot" aria-hidden="true" />
                  <span role="status" data-proxy-state={badgeState}>
                    {badgeState === 'fresh'
                      ? (isLiveMode ? 'Live' : 'Ready')
                      : badgeText}
                  </span>
                </span>
                {showLiveFallbackBadge && (
                  <span className="proxy-live-fallback-badge" role="status">
                    Live Fallback {isSourceProxyReady ? '(480p)' : '(Rendering...)'}
                  </span>
                )}
              </>
            )}
          </div>

          {/* Right: Unobstructed Overlay Controls (Logo / Mask / Banner) + Diagnostics Icon */}
          <div className="monitor-topbar-right">
            {currentVideoSrc && (
              <VideoTransformControls
                inline
                voiceSettings={voiceSettings}
                onUpdateVoiceSettings={onUpdateVoiceSettings}
                aspectRatio={aspectRatio}
              />
            )}
            {selectedVideo && onPreviewMode && (
              <button
                type="button"
                className={`btn-diagnostics-pill ${showDiagnostics ? 'is-active' : ''}`}
                onClick={() => setShowDiagnostics((prev) => !prev)}
                aria-label="Diagnostics"
                title={`ព័ត៌មានបច្ចេកទេស (Diagnostics${measuredFps > 0 ? ` • ${measuredFps} FPS` : ''}) — ${badgeText}`}
              >
                <Activity size={13} />
                {measuredFps > 0 && <span className="diagnostics-fps-mini">{measuredFps}</span>}
              </button>
            )}
          </div>
        </div>
      )}
      {showDiagnostics && (
        <div className="player-diagnostics-panel" data-testid="player-diagnostics-panel">
          {badgeText && (
            <div className="diagnostics-metric">
              <span className="metric-label">Preview:</span>
              <span className="metric-value">{badgeText}</span>
            </div>
          )}
          <div className="diagnostics-metric">
            <span className="metric-label">FPS:</span>
            <span className="metric-value">{measuredFps > 0 ? measuredFps : (isPlaying ? '60' : '0')} FPS</span>
          </div>
          <div className="diagnostics-metric">
            <span className="metric-label">Dropped:</span>
            <span className="metric-value">{droppedVideoFrames}</span>
          </div>
          <div className="diagnostics-metric">
            <span className="metric-label">Seek:</span>
            <span className="metric-value">{seekLatencyMs !== null ? `${seekLatencyMs}ms` : '--'}</span>
          </div>
          <div className="diagnostics-metric">
            <span className="metric-label">Drift:</span>
            <span className="metric-value">{audioDriftMs !== null ? `±${Math.abs(audioDriftMs)}ms` : '0ms'}</span>
          </div>
          <div className="diagnostics-metric diagnostics-engine-row">
            <span className="metric-label">Audio Engine:</span>
            <span className="metric-value badge-engine">{effectiveUseWebAudioRef.current && webAudioSchedulerRef.current?.isSupported() ? 'Web Audio (ConCaT)' : 'HTMLAudio Pool'}</span>
            <button
              type="button"
              className="btn-engine-toggle"
              onClick={() => setUseWebAudioState((prev) => !prev)}
              title="ប្តូររវាង Web Audio Scheduler និង HTMLAudio Element Pool"
            >
              {effectiveUseWebAudioRef.current && webAudioSchedulerRef.current?.isSupported() ? 'ប្រើ HTMLAudio' : 'ប្រើ Web Audio'}
            </button>
          </div>
        </div>
      )}
      {/* Video View Canvas (Synced dynamically to 16:9 / 9:16 / 1:1 — 100% Unobstructed) */}
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

              {(() => {
                const isPreviewingRawSource = !renderedVideo || (renderedVideo?.isProxyPreview && !isFreshProxy);
                // Proxy Preview MP4 never bakes hflip/zoom/eq so CSS preview stays 60fps in BOTH Live & Proxy Preview,
                // and disables only on final exported MP4 (where FFmpeg already baked the YouTube Safe transform).
                const isPreviewingUnbakedVisual = !renderedVideo || Boolean(renderedVideo?.isProxyPreview);
                const ytMirror = Boolean(isPreviewingUnbakedVisual && voiceSettings?.enableMirrorFlip);
                const rawYtZoom = Number(voiceSettings?.zoomScale);
                const ytZoom = isPreviewingUnbakedVisual && Number.isFinite(rawYtZoom)
                  ? Math.max(1.0, Math.min(1.15, rawYtZoom))
                  : 1.0;
                const ytColorGrade = Boolean(isPreviewingUnbakedVisual && voiceSettings?.enableColorGrade);
                const ytSafeAudio = Boolean(isPreviewingRawSource && voiceSettings?.youtubeSafeAudio);
                const transformParts = [];
                if (ytMirror) transformParts.push('scaleX(-1)');
                if (ytZoom > 1.005) transformParts.push(`scale(${ytZoom.toFixed(3)})`);
                const videoYoutubeTransform = transformParts.length > 0 ? transformParts.join(' ') : 'none';
                const videoYoutubeFilter = ytColorGrade
                  ? 'contrast(1.05) brightness(1.015) saturate(1.08)'
                  : 'none';

                return (
                  <video
                    ref={videoRef}
                    src={currentVideoSrc}
                    muted={isPreviewingRawSource && (voiceSettings.duckingVolume === 0 || ytSafeAudio)}
                    onTimeUpdate={handleInternalTimeUpdate}
                    onSeeking={() => { seekStartMsRef.current = performance.now(); }}
                    onSeeked={handleInternalSeeked}
                    onLoadedMetadata={handleInternalLoadedMetadata}
                    onMouseDown={handleVideoMouseDown}
                    onClick={handleVideoClick}
                    onDoubleClick={toggleFullscreen}
                    onEnded={onEnded}
                    style={{
                      width: '100%',
                      height: '100%',
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: videoObjectFit,
                      objectPosition: is916Crop
                        ? `${effectiveCropX}% 50%`
                        : '50% 50%',
                      transform: videoYoutubeTransform,
                      filter: videoYoutubeFilter,
                      transformOrigin: 'center center',
                      transition: (isDraggingCrop || (isPlaying && (scriptData?.framingKeyframes?.length || 0) > 0))
                        ? 'none'
                        : 'object-position 0.25s cubic-bezier(0.2, 0.8, 0.4, 1)',
                      cursor: is916Crop ? (isDraggingCrop ? 'grabbing' : 'grab') : 'pointer',
                      userSelect: 'none',
                      display: 'block',
                      backgroundColor: '#000000',
                    }}
                  />
                );
              })()}

              {/* Real-time Synchronized Khmer AI Dubbing Audio Element (Fallback for monolithic audio when no segment clips exist) */}
              {(!renderedVideo || (renderedVideo?.isProxyPreview && !isFreshProxy)) && !hasSegmentAudios && audioGenerated && fullAudioUrl && (
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

              {/* Clean Demucs BGM or Custom Loop BGM Audio Element (Zero Chinese speech during Live Preview) */}
              {(!renderedVideo || (renderedVideo?.isProxyPreview && !isFreshProxy)) &&
                ((voiceSettings?.enableCustomBgm && voiceSettings?.customBgmUrl) ||
                  (!voiceSettings?.youtubeSafeAudio && voiceSettings?.enableDemucs && cleanBgAudioUrl)) && (
                <audio
                  ref={cleanBgAudioRef}
                  src={(voiceSettings?.enableCustomBgm && voiceSettings?.customBgmUrl) ? voiceSettings.customBgmUrl : cleanBgAudioUrl}
                  loop={Boolean(voiceSettings?.enableCustomBgm && voiceSettings?.customBgmUrl)}
                  preload="metadata"
                  onLoadedMetadata={() => {
                    const v = videoRef?.current;
                    const bg = cleanBgAudioRef?.current;
                    if (v && bg) {
                      const rawT = v.currentTime || 0;
                      const isLoopBgm = Boolean(voiceSettings?.enableCustomBgm && voiceSettings?.customBgmUrl);
                      bg.currentTime = (isLoopBgm && Number.isFinite(bg.duration) && bg.duration > 0)
                        ? (rawT % bg.duration)
                        : rawT;
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

              {/* Anti-Theft Running Marquee & Watermark Live Overlay (z-index: 1) */}
              <AntiTheftOverlay
                voiceSettings={voiceSettings}
                renderedVideo={overlayRender}
                aspectRatio={aspectRatio}
                verticalStyle={verticalStyle}
                videoMeta={videoMeta}
                onUpdateVoiceSettings={onUpdateVoiceSettings}
              />

              {/* Subtitle Overlay (z-index: 20 - sits on top of anti-theft banner) */}
              <LiveSubtitleOverlay
                activeSegment={activeSegment}
                voiceSettings={voiceSettings}
                renderedVideo={overlayRender}
                currentTime={effectiveTimelineTime}
                aspectRatio={aspectRatio}
                verticalStyle={verticalStyle}
                videoMeta={videoMeta}
              />

              {/* Logo Watermark Live Overlay (សងខាង / ជ្រុងលើ) */}
              <LogoOverlay
                voiceSettings={voiceSettings}
                renderedVideo={overlayRender}
                aspectRatio={aspectRatio}
                verticalStyle={verticalStyle}
                videoMeta={videoMeta}
                onUpdateVoiceSettings={onUpdateVoiceSettings}
              />

              {/* Corner Disclaimer / Watermark Blocker Mask */}
              <CornerMaskOverlay
                voiceSettings={voiceSettings}
                renderedVideo={overlayRender}
                aspectRatio={aspectRatio}
                verticalStyle={verticalStyle}
                videoMeta={videoMeta}
              />

              {/* Sponsor Ads Live Overlay (Green Screen Video) */}
              <SponsorOverlay
                voiceSettings={voiceSettings}
                renderedVideo={overlayRender}
                aspectRatio={aspectRatio}
                verticalStyle={verticalStyle}
                videoMeta={videoMeta}
                currentTime={currentTime}
                isPlaying={isPlaying}
                onUpdateVoiceSettings={onUpdateVoiceSettings}
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
        onPlayPause={handlePlayPauseWithAudioUnlock}
        voiceSettings={voiceSettings}
        onUpdateVoiceSettings={onUpdateVoiceSettings}
        onAspectRatioChange={onAspectRatioChange}
        activeSegment={activeSegment}
        toggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
        renderedVideo={overlayRender}
        onResetToPreview={onResetToPreview || (() => setRenderedVideo && setRenderedVideo(null))}
        onUpdateActiveCrop={handleUpdateActiveCrop}
        onAnalyzeFraming={handleAnalyzeFraming}
        isAnalyzingFraming={isAnalyzingFraming}
        activeCropX={effectiveCropX}
        framingKeyframes={scriptData?.framingKeyframes || []}
        onToggleKeyframe={handleToggleKeyframe}
        onSeekToKeyframe={handleSeekToKeyframe}
      />
    </div>
  );
}

export default React.memo(VideoPlayerPreview);
