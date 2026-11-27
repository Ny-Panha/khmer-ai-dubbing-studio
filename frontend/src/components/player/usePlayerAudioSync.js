import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { parseTimeToSeconds } from '../../utils/timestampUtils';
import { mapSourceToTimelineTime } from '../../utils/timelineUtils';
import { findLeadingSilenceFromChannels, computeSegmentAudioSyncTarget } from '../../utils/audioSyncUtils';
import { createAudioRecoveryManager } from '../../utils/audioAutoRecovery';
import {
  WebAudioScheduler,
  computeOverlapCrossfadePlan,
  evalSegmentCrossfadeGainAtTime,
} from '../../utils/webAudioScheduler';

/**
 * Compute sorted and merged speaking intervals once per script change
 * (O(log N) safe even with overlapping VOICE 2/3 tracks).
 */
export function buildSpeakingIntervals(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const raw = segments
    .filter((seg) => {
      const hasAudio = Boolean(
        seg.audioFile ||
        seg.audioPath ||
        seg.audioUrl ||
        (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0)
      );
      return !seg.muted && !seg.isMuted && hasAudio;
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
    })
    .sort((a, b) => (a.start - b.start) || (a.end - b.end));

  const merged = [];
  for (const cur of raw) {
    if (merged.length === 0 || cur.start > merged[merged.length - 1].end) {
      merged.push({ ...cur });
    } else if (cur.end > merged[merged.length - 1].end) {
      merged[merged.length - 1].end = cur.end;
    }
  }
  return merged;
}

/**
 * Fast O(log N) binary search helper for sorted speaking time intervals.
 */
export function findIntervalAtTime(intervals, t) {
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
}

/**
 * Custom hook encapsulating VideoPlayerPreview's real-time audio synchronization engine:
 * - WebAudioScheduler + HTMLAudio pool segment playback with 60Hz RAF sync
 * - Edge TTS leading-silence probing & bounded lookahead preloading
 * - Clean Demucs BGM fetching & synchronized playback
 * - 3-Tier Video-to-Audio drift sync & O(log N) Live Smart Ducking (plus YouTube Safe Audio mute)
 */
export function usePlayerAudioSync({
  selectedVideo,
  seriesId,
  episodeId,
  scriptData,
  renderedVideo,
  proxyStatus,
  isVisualBaked = null,
  isAudioBaked = null,
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
}) {
  const speakingIntervals = useMemo(
    () => buildSpeakingIntervals(scriptData?.segments),
    [audioGenerated, fullAudioUrl, scriptData?.segments]
  );

  const narrationAudioRef = useRef(null);
  const cleanBgAudioRef = useRef(null);
  const videoRefName = selectedVideo?.videoUrl || selectedVideo?.filePath || selectedVideo?.fileName || selectedVideo?.name;
  const [cleanBgAudio, setCleanBgAudio] = useState(null);
  const cleanBgAudioUrl = cleanBgAudio?.videoPath === videoRefName ? cleanBgAudio?.url : null;

  const activeSegmentAudiosRef = useRef({});
  const segmentAudioPoolRef = useRef({});
  const segmentAudioMetaRef = useRef(new Map());
  const leadingSilenceCacheRef = useRef(new Map());
  const leadingSilenceInflightRef = useRef(new Map());
  const leadingSilenceFailureRef = useRef(new Map());
  const audioProbeCtxRef = useRef(null);
  const lastPreloadCenterRef = useRef(-Infinity);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isPlayPendingRef = useRef(false);
  const playStartTimeRef = useRef(0);
  const lastBgmSeekMsRef = useRef(0);

  // ConCaT-inspired Web Audio scheduling & bounded buffer LRU cache
  const webAudioSchedulerRef = useRef(null);
  if (!webAudioSchedulerRef.current) {
    webAudioSchedulerRef.current = new WebAudioScheduler({ maxCachedBuffers: 50 });
  }
  const [useWebAudioState, setUseWebAudioState] = useState(
    voiceSettings?.useWebAudioScheduler ?? true
  );
  const effectiveUseWebAudioRef = useRef(useWebAudioState);
  useEffect(() => {
    effectiveUseWebAudioRef.current = useWebAudioState;
    if (!useWebAudioState && webAudioSchedulerRef.current) {
      webAudioSchedulerRef.current.stopAll();
    }
  }, [useWebAudioState]);

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
  // When proxy preview is rendering or queued (not yet fresh), automatically fall back to live segment audio so user always hears sound!
  // Master narration audio is only a fallback when no individual segment audio clips exist.
  const isFreshProxy = Boolean(renderedVideo?.isProxyPreview && proxyStatus?.state === 'fresh');
  const effectiveAudioBaked = typeof isAudioBaked === 'boolean'
    ? isAudioBaked
    : Boolean(renderedVideo && (!renderedVideo.isProxyPreview || isFreshProxy));
  const effectiveVisualBaked = typeof isVisualBaked === 'boolean'
    ? isVisualBaked
    : Boolean(renderedVideo && !renderedVideo.isProxyPreview);
  const hasSegmentAudios = Boolean(
    !effectiveAudioBaked &&
    scriptData?.segments?.some(s => s.audioUrl || s.audioFile || s.audioPath)
  );

  // Refs to hold latest values for RAF / preload loops without re-triggering effects
  const segAudioConfigRef = useRef({
    voiceSettings,
    videoClips,
    scriptData,
    hasSegmentAudios,
    renderedVideo,
    cleanBgAudioUrl,
    isFreshProxy,
    isAudioBaked: effectiveAudioBaked,
    isVisualBaked: effectiveVisualBaked,
  });
  useEffect(() => {
    segAudioConfigRef.current = {
      voiceSettings,
      videoClips,
      scriptData,
      hasSegmentAudios,
      renderedVideo,
      cleanBgAudioUrl,
      isFreshProxy,
      isAudioBaked: effectiveAudioBaked,
      isVisualBaked: effectiveVisualBaked,
    };
  }, [
    voiceSettings,
    videoClips,
    scriptData,
    hasSegmentAudios,
    renderedVideo,
    cleanBgAudioUrl,
    isFreshProxy,
    effectiveAudioBaked,
    effectiveVisualBaked,
  ]);

  const stopAllSegmentAudios = useCallback(() => {
    if (webAudioSchedulerRef.current) {
      try { webAudioSchedulerRef.current.stopAll(); } catch (_) {}
    }
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
      try { audio.load(); } catch (_) {}
      segmentAudioPoolRef.current[url] = audio;
    }
    segmentAudioMetaRef.current.set(url, { segStart, lastUsedMs: Date.now() });
    return audio;
  }, []);

  const probeUrlLeadingSilence = useCallback((url) => {
    if (!url || typeof window === 'undefined') return;
    // CRITICAL PERF: Never decode audio buffers in background during active video playback or while video is seeking/buffering!
    if (isPlayingRef.current) return;
    const activeVideo = videoRef?.current;
    if (activeVideo && (activeVideo.seeking || activeVideo.readyState < 2)) return;
    if (leadingSilenceCacheRef.current.has(url) || leadingSilenceInflightRef.current.has(url)) return;
    // Cap concurrent probes to 2 so paused preloading never starves the 6-socket HTTP/1.1 origin pool
    if (leadingSilenceInflightRef.current.size >= 2) return;
    // Respect failure backoff & terminal 404/403 stop so errors never storm every 1.5s
    const failState = leadingSilenceFailureRef.current.get(url);
    if (failState && (failState.count >= 3 || Date.now() < failState.retryAfterMs)) return;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioCtx && !OfflineCtx) return;

    const recordFailure = (isTerminal = false) => {
      const prev = leadingSilenceFailureRef.current.get(url) || { count: 0, retryAfterMs: 0 };
      const nextCount = isTerminal ? 99 : prev.count + 1;
      const delayMs = isTerminal ? Infinity : Math.min(60000, 5000 * (3 ** Math.min(prev.count, 3)));
      leadingSilenceFailureRef.current.set(url, {
        count: nextCount,
        retryAfterMs: isTerminal ? Infinity : Date.now() + delayMs,
      });
    };

    const controller = new AbortController();
    leadingSilenceInflightRef.current.set(url, controller);
    (async () => {
      try {
        if (!audioProbeCtxRef.current || audioProbeCtxRef.current.state === 'closed') {
          audioProbeCtxRef.current = AudioCtx ? new AudioCtx() : new OfflineCtx(1, 24000, 24000);
        }
        const ctx = audioProbeCtxRef.current;
        const res = await fetch(url, { cache: 'force-cache', signal: controller.signal });
        if (!res.ok) {
          recordFailure(res.status === 404 || res.status === 403 || res.status === 410);
          return;
        }
        const arrayBuf = await res.arrayBuffer();
        if (controller.signal.aborted) return;
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        if (controller.signal.aborted) return;
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
        leadingSilenceFailureRef.current.delete(url);
      } catch (_) {
        if (!controller.signal.aborted) recordFailure(false);
      } finally {
        if (!controller.signal.aborted) leadingSilenceInflightRef.current.delete(url);
      }
    })();

  }, [videoRef]);

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

  const unlockAudioContext = useCallback(() => {
    const scheduler = webAudioSchedulerRef.current;
    if (effectiveUseWebAudioRef.current && scheduler?.isSupported()) {
      scheduler.ensureContext();
    }
  }, []);

  const preloadSegmentsAroundTime = useCallback((centerTime, { forcePlaying = false } = {}) => {
    const { hasSegmentAudios: hsa, scriptData: sd } = segAudioConfigRef.current;
    if (!hsa || !sd?.segments || sd.segments.length === 0) return;

    const now = Number.isFinite(centerTime) ? centerTime : (currentTimeRef.current || 0);
    lastPreloadCenterRef.current = now;

    // Audio preloading is ONLY needed during active playback.
    // While paused, video frame decoding has 100% exclusive priority on HTTP/1.1 sockets!
    if (!forcePlaying && !isPlayingRef.current) return;

    // Keep preload window compact & bounded so segment audio fetches never saturate the 6-connection HTTP/1.1 pool
    const activeVideo = videoRef?.current;
    if (activeVideo && (activeVideo.seeking || activeVideo.readyState < 3)) return;

    const lookAheadSec = 6;
    const maxClips = 6;
    const maxNewPerTick = 3;

    // ConCaT-inspired Web Audio lookahead preloading
    const scheduler = webAudioSchedulerRef.current;
    if (effectiveUseWebAudioRef.current && scheduler?.isSupported()) {
      scheduler.preloadUpcoming(sd.segments, now, lookAheadSec);
      return;
    }

    const upcoming = sd.segments
      .map((seg) => {
        const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
        const rawUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
        return { seg, s, rawUrl };
      })
      .filter(({ s, rawUrl }) => rawUrl && s >= (now - 2) && s <= (now + lookAheadSec))
      .sort((a, b) => Math.abs(a.s - now) - Math.abs(b.s - now))
      .slice(0, maxClips);

    let createdThisTick = 0;
    upcoming.forEach(({ seg, s, rawUrl }) => {
      const alreadyPooled = Boolean(segmentAudioPoolRef.current[rawUrl]);
      if (!alreadyPooled) {
        if (createdThisTick >= maxNewPerTick) return;
        createdThisTick += 1;
      }
      getSegmentAudio(rawUrl, s);
      const rawOffset = (typeof seg.audioOffset === 'number' && !isNaN(seg.audioOffset)) ? seg.audioOffset : 0;
      if (rawOffset === 0 && !seg.userTrimmed) {
        probeUrlLeadingSilence(rawUrl);
      }
    });

    evictDistantSegmentAudios(now);
  }, [getSegmentAudio, probeUrlLeadingSilence, evictDistantSegmentAudios, videoRef]);

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

  // Stop audio and reset playback state cleanly when switching episodes or projects
  useEffect(() => {
    isPlayPendingRef.current = false;
    stopAllSegmentAudios();
    webAudioSchedulerRef.current?.lruCache.cancelPending();
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
    for (const probe of leadingSilenceInflightRef.current.values()) probe.abort();
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

  // Component unmount: cancel all pending recovery timers, audio pool, Web Audio scheduler & probe AudioContext
  useEffect(() => {
    return () => {
      stopAllSegmentAudios();
      if (webAudioSchedulerRef.current) {
        try { webAudioSchedulerRef.current.destroy(); } catch (_) {}
      }
      if (recoveryManagerRef.current) {
        recoveryManagerRef.current.cancelPending();
      }
      for (const probe of leadingSilenceInflightRef.current.values()) probe.abort();
      if (audioProbeCtxRef.current && typeof audioProbeCtxRef.current.close === 'function' && audioProbeCtxRef.current.state !== 'closed') {
        audioProbeCtxRef.current.close().catch(() => {});
      }
      audioProbeCtxRef.current = null;
    };
  }, [stopAllSegmentAudios]);

  // 🎧 AI Vocal Separation (Demucs): Fetch separated clean BGM (no_vocals.wav) when Demucs is enabled
  useEffect(() => {
    if (!voiceSettings?.enableDemucs || !videoRefName) {
      setCleanBgAudio(null);
      return;
    }

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
        if (controller.signal.aborted) return;
        if (data?.success && data?.available && data?.noVocalsUrl) {
          const fullUrl = data.noVocalsUrl;
          console.log('[VideoPlayerPreview] 🎧 Found separated clean BGM:', fullUrl);
          setCleanBgAudio({ videoPath: videoRefName, url: fullUrl });
        } else {
          setCleanBgAudio(null);
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setCleanBgAudio(null);
      });

    return () => {
      controller.abort();
    };
  }, [videoRefName, voiceSettings?.enableDemucs]);

  // Listen for instant Demucs separation completed event from DubbingModeTab
  useEffect(() => {
    const handleSepReady = (e) => {
      if (e.detail?.videoPath === videoRefName && e.detail?.noVocalsUrl) {
        const fullUrl = e.detail.noVocalsUrl;
        console.log('[VideoPlayerPreview] 🎧 Instant event received clean BGM:', fullUrl);
        setCleanBgAudio({ videoPath: videoRefName, url: fullUrl });
      }
    };
    window.addEventListener('demucs-separation-ready', handleSepReady);
    return () => window.removeEventListener('demucs-separation-ready', handleSepReady);
  }, [videoRefName]);

  // Instantly purge stale scheduled audio nodes when clips are moved, trimmed, or deleted
  useEffect(() => {
    const handleSegmentsChanged = () => {
      stopAllSegmentAudios();
    };
    window.addEventListener('timeline:segments-changed', handleSegmentsChanged);
    window.addEventListener('timeline:audio-invalidated', handleSegmentsChanged);
    return () => {
      window.removeEventListener('timeline:segments-changed', handleSegmentsChanged);
      window.removeEventListener('timeline:audio-invalidated', handleSegmentsChanged);
    };
  }, [stopAllSegmentAudios]);

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
  const syncSegmentAudiosAtTime = useCallback((now, { allowFallbackFromWebAudio = false } = {}) => {
    const scheduler = webAudioSchedulerRef.current;
    const useWebAudio = effectiveUseWebAudioRef.current && scheduler?.isSupported();
    if (useWebAudio && !allowFallbackFromWebAudio) {
      stopAllSegmentAudios();
      return;
    }

    const { voiceSettings: vs, scriptData: sd, hasSegmentAudios: hsa, isAudioBaked: ab } = segAudioConfigRef.current;
    if (ab || !hsa) {
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
    const nearbySegs = [];
    for (let idx = 0; idx < segments.length; idx++) {
      const seg = segments[idx];
      if (seg.muted || seg.isMuted) continue;
      const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
      if (s > (now + 0.35)) {
        continue;
      }
      const rawAudioDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
        ? seg.finalAudioDuration
        : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
          ? seg.audioDurationSec
          : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
            ? seg.audioDuration
            : ((typeof seg.originalAudioDuration === 'number' && seg.originalAudioDuration > 0)
              ? seg.originalAudioDuration
              : ((typeof seg.rawAudioDur === 'number' && seg.rawAudioDur > 0)
                ? seg.rawAudioDur
                : 2.5))));
      const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
      const effectiveEnd = (isTrimmed && typeof seg.audioEndSec === 'number')
        ? seg.audioEndSec
        : (s + rawAudioDur);
      if (now >= (s - 0.25) && now < (effectiveEnd + 0.3)) {
        nearbySegs.push({ seg, idx });
      }
    }

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

    // Build smooth adaptive crossfade plan for nearby overlapping clips (same-lane & multi-lane)
    const crossfadeEntries = [];
    for (let idx = 0; idx < segments.length; idx++) {
      const sItem = segments[idx];
      if (sItem.muted || sItem.isMuted) continue;
      const sKey = String(sItem._uid || (sItem.id !== undefined && sItem.id !== null ? sItem.id : idx));
      const sStart = (typeof sItem.audioStartSec === 'number' && !isNaN(sItem.audioStartSec))
        ? sItem.audioStartSec
        : (typeof sItem.startSec === 'number' && !isNaN(sItem.startSec)
          ? sItem.startSec
          : parseTimeToSeconds(sItem.audioStart ?? sItem.start, 0));
      if (sStart > (now + 4.0)) continue;
      const sUrl = sItem.audioUrl || (sItem.audioPath ? `/uploads/${sItem.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
      const pooled = sUrl ? segmentAudioPoolRef.current[sUrl] : null;
      const loadedDur = (pooled && Number.isFinite(pooled.duration) && pooled.duration > 0.2) ? pooled.duration : null;
      const fallbackDur = (typeof sItem.finalAudioDuration === 'number' && sItem.finalAudioDuration > 0)
        ? sItem.finalAudioDuration
        : ((typeof sItem.audioDurationSec === 'number' && !isNaN(sItem.audioDurationSec))
          ? sItem.audioDurationSec
          : ((typeof sItem.audioDuration === 'number' && sItem.audioDuration > 0) ? sItem.audioDuration : 2.5));
      const sTrimmed = Boolean(sItem.audioTrimmed || sItem.userTrimmed);
      const rawOff = (typeof sItem.audioOffset === 'number' && !isNaN(sItem.audioOffset)) ? sItem.audioOffset : 0;
      const leadSkip = (sUrl && rawOff === 0 && !sItem.userTrimmed) ? (leadingSilenceCacheRef.current.get(sUrl) ?? 0) : 0;
      const effectiveDur = (sTrimmed && typeof sItem.audioEndSec === 'number' && sItem.audioEndSec > sStart)
        ? Math.max(0.05, sItem.audioEndSec - sStart)
        : (loadedDur ? Math.max(0.05, loadedDur - Math.max(0, rawOff + leadSkip)) : fallbackDur);
      const sEnd = sStart + effectiveDur;
      if (sEnd < (now - 4.0)) continue;
      crossfadeEntries.push({ key: sKey, startSec: sStart, endSec: sEnd, durSec: effectiveDur });
    }
    const crossfadePlanMap = computeOverlapCrossfadePlan(crossfadeEntries);

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

      // If segment URL changed (regenerated clip while timeline open) or position moved, tear down stale audio handle
      let activeItem = activeSegmentAudiosRef.current[segKey];
      const isStartMoved = activeItem?.segStart !== undefined && Math.abs(activeItem.segStart - (seg.audioStartSec ?? seg.startSec ?? 0)) > 0.025;
      if (activeItem && ((activeItem.url && activeItem.url !== rawUrl) || isStartMoved)) {
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

      // Warm leading-silence probe only when paused or seeking (never during active playback)
      if (!isPlayingRef.current && segAudioOffset === 0 && !seg.userTrimmed && !leadingSilenceCacheRef.current.has(rawUrl)) {
        probeUrlLeadingSilence(rawUrl);
      }

      // Smooth adaptive half-sine crossfade across overlapping same-lane & multi-lane clips
      const crossfadePlan = crossfadePlanMap.get(String(segKey)) || { fadeIn: null, fadeOut: null };
      const isCrossfadeFadedOut = Boolean(crossfadePlan.fadeOut && now >= crossfadePlan.fadeOut.endSec);
      const effectiveVol = isCrossfadeFadedOut
        ? 0
        : Math.min(1.0, Math.max(0, evalSegmentCrossfadeGainAtTime(now, crossfadePlan, targetVol)));

      if (inRange && !isCrossfadeFadedOut) {
        if (!activeItem) {
          const audio = getSegmentAudio(rawUrl, segStart);
          if (audio) {
            audio.volume = effectiveVol;
            audio.playbackRate = currentRate;

            let cleanupMetadataListener = null;
            if (audio.readyState >= 1) {
              const isNaturalStart = Math.abs(expectedOffset) <= 0.055;
              const curPos = audio.currentTime || 0;
              // Avoid cold seek at natural clip start: starting from 0 immediately eliminates decoder flush & play latency.
              // Only seek if clip was previously paused mid-way or user initiated playback mid-segment.
              const needsSeek = (!isNaturalStart && Math.abs(curPos - expectedOffset) > 0.035) ||
                (isNaturalStart && curPos > 0.04);
              if (needsSeek) {
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
              startedAtPerf: performance.now(),
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

            // Tight 3-Tier Sync (<= 65ms lock, 65-220ms hysteresis rate nudge, > 220ms debounced seek)
            if (audio.readyState >= 2 && !audio.seeking) {
              const drift = expectedOffset - audio.currentTime;
              const absDrift = Math.abs(drift);
              const isNudged = Math.abs(audio.playbackRate - currentRate) > 0.005;
              const nowPerf = performance.now();
              const isStartupGrace = (nowPerf - (activeItem.startedAtPerf || 0)) < 650;

              if (absDrift > 0.220 && !isStartupGrace && (nowPerf - (activeItem.lastSeekPerf || 0)) >= 450) {
                try {
                  const maxPos = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, audio.duration - 0.02) : (expectedOffset + 0.015);
                  audio.currentTime = Math.max(0, Math.min(expectedOffset + 0.015, maxPos));
                } catch (_) {}
                activeItem.lastSeekPerf = nowPerf;
                if (audio.playbackRate !== currentRate) audio.playbackRate = currentRate;
              } else if (isNudged) {
                if (absDrift < 0.020) {
                  audio.playbackRate = currentRate;
                } else {
                  const rateMultiplier = drift > 0 ? 1.08 : 0.92;
                  audio.playbackRate = parseFloat((currentRate * rateMultiplier).toFixed(3));
                }
              } else if (absDrift >= 0.065) {
                const rateMultiplier = drift > 0 ? 1.08 : 0.92;
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

    const { hasSegmentAudios: hsa, isAudioBaked: ab, voiceSettings: vs0, cleanBgAudioUrl: bgUrl0 } = segAudioConfigRef.current;
    const hasExtBg0 = Boolean((vs0?.enableCustomBgm && vs0?.customBgmUrl) || (vs0?.enableDemucs && bgUrl0));
    if (ab || (!hsa && !hasExtBg0)) {
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
        const { videoClips: vc, hasSegmentAudios: curHsa, voiceSettings: vs, cleanBgAudioUrl: bgUrl, scriptData: sd } = segAudioConfigRef.current;

        if (curHsa) {
          const tlNow = (v && Array.isArray(vc) && vc.length > 0)
            ? (mapSourceToTimelineTime(v.currentTime || 0, vc) ?? currentTimeRef.current)
            : (v?.currentTime ?? currentTimeRef.current);

          const scheduler = webAudioSchedulerRef.current;
          const useWebAudio = effectiveUseWebAudioRef.current && scheduler?.isSupported();
          if (useWebAudio) {
            const khmerVal = vs?.khmerVolume !== undefined ? Number(vs.khmerVolume) : 1.0;
            const isKhmerMuted = khmerVal <= 0.01;
            scheduler.syncAtTimelineTime({
              timelineNow: tlNow,
              playbackRate: v?.playbackRate || 1.0,
              segments: sd?.segments || [],
              khmerVolume: khmerVal,
              isKhmerMuted,
              lookaheadSec: 2.2,
            });
            if (scheduler.isBlockedBySuspendedContext?.()) {
              // Auto-fallback to HTMLAudio pool when browser keeps AudioContext suspended during active playback
              syncSegmentAudiosAtTime(tlNow, { allowFallbackFromWebAudio: true });
            }
            const diag = scheduler.getDiagnostics();
            if (diag && Number.isFinite(diag.lastDriftMs)) {
              setAudioDriftMs(diag.lastDriftMs);
            }
          } else {
            syncSegmentAudiosAtTime(tlNow);
          }
        }

        // Measure real FPS and dropped frames for Diagnostics panel
        const tsNow = performance.now();
        const timestamps = fpsFrameTimestampsRef.current;
        timestamps.push(tsNow);
        while (timestamps.length > 0 && (tsNow - timestamps[0]) > 1000) {
          timestamps.shift();
        }
        if (timestamps.length >= 4) {
          const windowSec = (tsNow - timestamps[0]) / 1000;
          if (windowSec > 0.25) {
            const fps = Math.round((timestamps.length - 1) / windowSec);
            setMeasuredFps(fps);
          }
        }
        if (v && v.getVideoPlaybackQuality) {
          try {
            const q = v.getVideoPlaybackQuality();
            if (q && typeof q.droppedVideoFrames === 'number') {
              setDroppedVideoFrames(q.droppedVideoFrames);
            }
          } catch (_) {}
        }

        // Authoritative Demucs BGM / Custom Loop BGM sync (0.20s drift threshold + 500ms cooldown avoids re-seeking large streams on minor jitter)
        const bg = cleanBgAudioRef.current;
        const isLoopBgm = Boolean(vs?.enableCustomBgm && vs?.customBgmUrl);
        const hasActiveExternalBg = isLoopBgm || Boolean(vs?.enableDemucs && bgUrl);
        if (bg && hasActiveExternalBg && v && !v.paused && !v.seeking && Number.isFinite(v.currentTime)) {
          const baseRate = v.playbackRate || 1.0;
          if (bg.playbackRate !== baseRate) bg.playbackRate = baseRate;
          const expectedBgTime = (isLoopBgm && Number.isFinite(bg.duration) && bg.duration > 0)
            ? (v.currentTime % bg.duration)
            : v.currentTime;
          const bgDrift = Math.abs(bg.currentTime - expectedBgTime);
          const nowMs = performance.now();
          if (bg.readyState >= 2 && !bg.seeking && bgDrift > 0.20 && (nowMs - (lastBgmSeekMsRef.current || 0) >= 500)) {
            lastBgmSeekMsRef.current = nowMs;
            bg.currentTime = expectedBgTime;
          }
          if (bg.paused) bg.play().catch(() => {});
        }
      }
      animId = requestAnimationFrame(syncLoop);
    };
    animId = requestAnimationFrame(syncLoop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, effectiveAudioBaked, syncSegmentAudiosAtTime, stopAllSegmentAudios, videoRef, hasSegmentAudios, cleanBgAudioUrl, voiceSettings?.enableDemucs]);

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
    if (effectiveAudioBaked) {
      if (narrationAudioRef.current && !narrationAudioRef.current.paused) {
        narrationAudioRef.current.pause();
      }
      if (cleanBgAudioRef.current && !cleanBgAudioRef.current.paused) {
        cleanBgAudioRef.current.pause();
      }
      return;
    }

    const v = videoRef?.current;
    const isLoopBgm = Boolean(voiceSettings?.enableCustomBgm && voiceSettings?.customBgmUrl);
    const hasExtBg = isLoopBgm || Boolean(cleanBgAudioUrl && voiceSettings?.enableDemucs);
    if (isPlaying) {
      if (cleanBgAudioRef.current && hasExtBg) {
        const bg = cleanBgAudioRef.current;
        if (v && Number.isFinite(v.currentTime)) {
          const targetBgT = (isLoopBgm && Number.isFinite(bg.duration) && bg.duration > 0)
            ? (v.currentTime % bg.duration)
            : v.currentTime;
          if (Math.abs(bg.currentTime - targetBgT) > 0.25) {
            bg.currentTime = targetBgT;
          }
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
  }, [isPlaying, effectiveAudioBaked, audioGenerated, fullAudioUrl, hasSegmentAudios, videoClips, videoRef, cleanBgAudioUrl, voiceSettings?.enableDemucs]);

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
      // Clean Demucs BGM / Custom Loop BGM play resumption; authoritative seeking is delegated to syncLoop
      const { voiceSettings: vs, cleanBgAudioUrl: bgUrl, isAudioBaked: ab } = segAudioConfigRef.current;
      const bg = cleanBgAudioRef.current;
      const hasExtBg = Boolean((vs?.enableCustomBgm && vs?.customBgmUrl) || (vs?.enableDemucs && bgUrl));
      if (bg && !ab && hasExtBg && !v.paused && !v.seeking) {
        if (bg.paused) bg.play().catch(() => {});
      }

      const a = narrationAudioRef.current;
      if (!a || ab || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;

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
      // If video is currently seeking, defer audio synchronization to handleSeeked once video frames decode
      if (v.seeking) {
        return;
      }

      const { voiceSettings: vs, cleanBgAudioUrl: bgUrl, isAudioBaked: ab } = segAudioConfigRef.current;
      const bg = cleanBgAudioRef.current;
      const isLoopBgm = Boolean(vs?.enableCustomBgm && vs?.customBgmUrl);
      const hasExtBg = isLoopBgm || Boolean(vs?.enableDemucs && bgUrl);
      if (bg && !ab && hasExtBg) {
        if (Number.isFinite(v.currentTime)) {
          bg.currentTime = (isLoopBgm && Number.isFinite(bg.duration) && bg.duration > 0)
            ? (v.currentTime % bg.duration)
            : v.currentTime;
        }
        bg.play().catch(() => {});
      }

      if (hasSegmentAudios && !ab) {
        const tlNow = getTargetTimelineTime();
        const scheduler = webAudioSchedulerRef.current;
        const useWebAudio = effectiveUseWebAudioRef.current && scheduler?.isSupported();
        if (useWebAudio) {
          scheduler.ensureContext();
        }
        preloadSegmentsAroundTime(tlNow, { forcePlaying: true });
        if (!useWebAudio) {
          syncSegmentAudiosAtTime(tlNow);
        }
      }

      const a = narrationAudioRef.current;
      if (!a || ab || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
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
      if (bg && !bg.paused) {
        bg.pause();
      }
      const a = narrationAudioRef.current;
      if (a && !a.paused) {
        a.pause();
        a.playbackRate = v.playbackRate || 1.0;
      }
    };

    const handleSeeked = () => {
      const { voiceSettings: vs, cleanBgAudioUrl: bgUrl, isAudioBaked: ab } = segAudioConfigRef.current;
      const bg = cleanBgAudioRef.current;
      const isLoopBgm = Boolean(vs?.enableCustomBgm && vs?.customBgmUrl);
      const hasExtBg = isLoopBgm || Boolean(vs?.enableDemucs && bgUrl);
      if (bg && !ab && hasExtBg && !v.paused) {
        if (Number.isFinite(v.currentTime)) {
          bg.currentTime = (isLoopBgm && Number.isFinite(bg.duration) && bg.duration > 0)
            ? (v.currentTime % bg.duration)
            : v.currentTime;
        }
        bg.play().catch(() => {});
      }

      if (hasSegmentAudios && !ab) {
        const tlNow = getTargetTimelineTime();
        preloadSegmentsAroundTime(tlNow);
        const scheduler = webAudioSchedulerRef.current;
        const useWebAudio = effectiveUseWebAudioRef.current && scheduler?.isSupported();
        if (!v.paused && !useWebAudio) {
          syncSegmentAudiosAtTime(tlNow);
        }
      }

      const a = narrationAudioRef.current;
      if (!a || ab || !audioGenerated || !fullAudioUrl || hasSegmentAudios || v.paused) return;
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
      const { isAudioBaked: ab } = segAudioConfigRef.current;
      if (!a || ab || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
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
  }, [videoRef, effectiveAudioBaked, audioGenerated, fullAudioUrl, hasSegmentAudios, videoClips, preloadSegmentsAroundTime, syncSegmentAudiosAtTime, stopAllSegmentAudios]);


  // Real-time Live Smart Ducking during Video Preview (O(log N) optimized)
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;

    // When audio is baked into the final MP4, restore video element to full volume
    // and let the baked mix handle everything. For un-fresh proxy previews that have
    // live narration, the <video> stays muted so live audio takes priority.
    if (effectiveAudioBaked) {
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

    const isCustomBgmActive = Boolean(voiceSettings?.enableCustomBgm && voiceSettings?.customBgmUrl);
    const isYoutubeSafeAudio = Boolean(voiceSettings?.youtubeSafeAudio && !isCustomBgmActive);
    const isDemucsActive = Boolean(isCustomBgmActive || (!isYoutubeSafeAudio && voiceSettings?.enableDemucs && cleanBgAudioUrl));

    if (isYoutubeSafeAudio || isDemucsActive) {
      if (!v.muted) v.muted = true;
      if (v.volume !== 0) v.volume = 0;
    } else if (isCurrentVideoClipMuted) {
      // Live Mute for muted video clips on dialogue (bit slg yy)
      if (!v.muted) v.muted = true;
      if (v.volume !== 0) v.volume = 0;
    } else if (duckVal === 0) {
      // Simple Ducking with 0% ducking: Mute during voice cues (bit slg yy), but UNMUTE during Gaps (berk slg simple)
      if (isSpeaking) {
        if (!v.muted) v.muted = true;
        if (v.volume !== 0) v.volume = 0;
      } else {
        if (v.muted) v.muted = false;
        if (v.volume !== 1.0) v.volume = 1.0;
      }
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
    if (cleanBgAudioRef.current) {
      const bgAudio = cleanBgAudioRef.current;
      if (isYoutubeSafeAudio) {
        if (!bgAudio.muted) bgAudio.muted = true;
        if (bgAudio.volume !== 0) bgAudio.volume = 0;
      } else if (isDemucsActive) {
        if (bgAudio.muted) bgAudio.muted = false;
        const targetBgmVol = isSpeaking
          ? Math.min(1.0, Math.max(0, duckVal))
          : (speakingIntervals.length > 0 && duckVal > 0.05
              ? Math.min(1.0, duckVal * 1.4)
              : Math.min(1.0, Math.max(0, duckVal)));

        if (Math.abs(bgAudio.volume - targetBgmVol) > 0.001) {
          bgAudio.volume = targetBgmVol;
        }
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
  }, [currentTime, audioGenerated, audioOutdated, fullAudioUrl, effectiveAudioBaked, scriptData, voiceSettings, videoClips, videoRef, cleanBgAudioUrl]);

  return {
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
  };
}
