import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { mapTimelineToSourceTime, mapSourceToTimelineTime, resolveForwardPlaybackTransition } from '../utils/timelineUtils';

function getUnfreezeTime(curT, maxDur) {
  const safeCur = Number.isFinite(curT) ? curT : 0;
  const safeMax = Number.isFinite(maxDur) && maxDur > 0 ? maxDur : safeCur + 1;
  if (safeCur >= safeMax - 0.03) {
    return Math.max(0, safeCur - 0.005);
  }
  return curT + 0.005;
}

/**
 * Custom hook to manage video playback state, playhead position, time update, and seeking
 */
export function useVideoPlayback({
  videoRef,
  videoClips,
  setVideoClips,
  renderedVideo,
  selectedVideo,
  episodeKey = null,
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;
  const lastMappedTimelineTimeRef = useRef(0);
  if (!isPlaying && Number.isFinite(currentTime)) {
    lastMappedTimelineTimeRef.current = currentTime;
  }
  const hasSeekedRef = useRef(false);
  const intendedPlayingRef = useRef(false);
  const pendingSeekTargetRef = useRef(null);
  const nextSeekTargetRef = useRef(null);
  const pendingSeekStartedMsRef = useRef(0);
  const lastTransitionSeekMsRef = useRef(0);
  const stallRecoveryCountRef = useRef(0);
  const pausedRecoveryCountRef = useRef(0);
  const pausedSeekingSinceMsRef = useRef(0);
  const isSeekInFlightRef = useRef(false);
  const [playRequestTick, setPlayRequestTick] = useState(0);
  const prevEpisodeKeyRef = useRef(episodeKey);

  // Cleanly reset playback state on episode change so active playback or seek state never leaks across episodes
  useEffect(() => {
    if (prevEpisodeKeyRef.current === episodeKey) return;
    prevEpisodeKeyRef.current = episodeKey;
    intendedPlayingRef.current = false;
    hasSeekedRef.current = false;
    pendingSeekTargetRef.current = null;
    nextSeekTargetRef.current = null;
    isSeekInFlightRef.current = false;
    lastMappedTimelineTimeRef.current = 0;
    activeClipIdxRef.current = 0;
    stallRecoveryCountRef.current = 0;
    pausedRecoveryCountRef.current = 0;
    pausedSeekingSinceMsRef.current = 0;
    const v = videoRef?.current;
    if (v && !v.paused) {
      try { v.pause(); } catch (_) {}
    }
    setIsPlaying(false);
  }, [episodeKey, videoRef]);

  // Duration follows the timeline (R7): when videoClips has been edited, duration equals the end of the last video clip
  const timelineDuration = useMemo(() => {
    if (renderedVideo) {
      return duration;
    }
    if (Array.isArray(videoClips) && videoClips.length > 0) {
      const maxEnd = videoClips.reduce((max, c) => Math.max(max, Number(c.end) || 0), 0);
      if (maxEnd > 0) return maxEnd;
    }
    return duration;
  }, [duration, videoClips, renderedVideo]);

  const handleLoadedMetadata = () => {
    if (videoRef?.current) {
      const v = videoRef.current;
      const dur = v.duration || 0;
      if (dur > 0) {
        setDuration((prevDur) => {
          if (!prevDur || prevDur === 0 || Math.abs(prevDur - dur) > 0.5) {
            return dur;
          }
          return prevDur;
        });
        // If a per-episode playhead time was restored while paused before metadata loaded,
        // cue the <video> frame directly to that restored timestamp without auto-playing.
        const desiredTlTime = Number.isFinite(currentTimeRef.current) ? currentTimeRef.current : 0;
        if (!isPlaying && desiredTlTime > 0.05) {
          let targetSrc = Math.min(dur, desiredTlTime);
          if (!renderedVideo && Array.isArray(videoClips) && videoClips.length > 0) {
            const mapping = mapTimelineToSourceTime(desiredTlTime, videoClips);
            if (mapping.inClip && Number.isFinite(mapping.sourceTime)) {
              targetSrc = Math.min(dur, Math.max(0, mapping.sourceTime));
              const targetIdx = videoClips.findIndex((c) => c.id === mapping.clip?.id);
              if (targetIdx !== -1) activeClipIdxRef.current = targetIdx;
            } else if (mapping.isGap && mapping.nextClip && Number.isFinite(mapping.nextClip.sourceStart)) {
              targetSrc = Math.min(dur, Math.max(0, mapping.nextClip.sourceStart));
            }
          }
          if (Number.isFinite(targetSrc) && Math.abs((v.currentTime || 0) - targetSrc) > 0.1) {
            hasSeekedRef.current = true;
            try {
              v.currentTime = targetSrc;
            } catch (_) {}
          }
        }
        if (setVideoClips) {
          setVideoClips((prevClips) => {
            if (!prevClips || prevClips.length === 0) {
              return [
                { 
                  id: `clip-${Date.now()}`, 
                  trackId: 'video-1',
                  trackRow: 0,
                  start: 0, 
                  end: dur, 
                  sourceStart: 0, 
                  sourceEnd: dur, 
                  duration: dur,
                  name: selectedVideo?.fileName || 'Full Video',
                  videoUrl: selectedVideo?.videoUrl,
                  videoId: selectedVideo?.videoId,
                },
              ];
            }
            if (prevClips.length === 1 && (!prevClips[0].end || prevClips[0].end <= 0.1 || Math.abs(prevClips[0].end - dur) > 1.0)) {
              return [
                { 
                  ...prevClips[0],
                  trackId: 'video-1',
                  trackRow: 0,
                  start: 0, 
                  end: dur, 
                  sourceStart: 0, 
                  sourceEnd: dur, 
                  duration: dur,
                  name: prevClips[0].name || selectedVideo?.fileName || 'Full Video',
                  videoUrl: prevClips[0].videoUrl || selectedVideo?.videoUrl,
                  videoId: prevClips[0].videoId || selectedVideo?.videoId,
                },
              ];
            }
            return prevClips;
          });
        }
      }
    }
  };

  const lastStateUpdateTimeRef = useRef(0);
  const activeClipIdxRef = useRef(0);

  const handleTimeUpdate = (explicitMediaTime) => {
    if (!videoRef?.current) return;
    const v = videoRef.current;

    // While PAUSED, playback sync must NEVER move the playhead away from where the user clicked/seeked.
    // Media element timeupdate/seeked events while paused must not overwrite authoritative timeline currentTime.
    if (!isPlaying) {
      return;
    }

    const realDur = v.duration || duration || 0;
    const currentMediaTime = (typeof explicitMediaTime === 'number' && Number.isFinite(explicitMediaTime))
      ? explicitMediaTime
      : v.currentTime;

    // 1. If renderedVideo is active, linear MP4
    if (renderedVideo) {
      const now = performance.now();
      if (!v.paused && now - lastStateUpdateTimeRef.current < 200) return;
      lastStateUpdateTimeRef.current = now;
      setCurrentTime(currentMediaTime);
      if (v.paused && isPlaying) {
        intendedPlayingRef.current = false;
        setIsPlaying(false);
      }
      return;
    }

    // Check if HTML5 video has reached the physical end of file
    if (v.ended || (realDur > 0 && currentMediaTime >= realDur - 0.15)) {
      intendedPlayingRef.current = false;
      v.pause();
      setIsPlaying(false);
      setCurrentTime(duration > 0 ? duration : realDur);
      return;
    }

    // 2. Draft preview with multi-clip timeline
    if (!videoClips || videoClips.length === 0) {
      const now = performance.now();
      if (!v.paused && now - lastStateUpdateTimeRef.current < 200) return;
      lastStateUpdateTimeRef.current = now;
      setCurrentTime(currentMediaTime);
      if (v.paused && isPlaying) {
        intendedPlayingRef.current = false;
        setIsPlaying(false);
      }
      return;
    }

    const srcNow = currentMediaTime;

    // Stale rVFC frame guard: while a forward or user seek is in flight, ignore queued pre-seek frames
    // until mediaTime lands near pendingSeekTargetRef (or seek clears after bounded timeout).
    const pendingTarget = pendingSeekTargetRef.current;
    if (pendingTarget !== null && Number.isFinite(pendingTarget)) {
      const elapsedMs = performance.now() - pendingSeekStartedMsRef.current;
      if (Math.abs(srcNow - pendingTarget) <= 0.25 || (!v.seeking && elapsedMs >= 250) || elapsedMs >= 1000) {
        pendingSeekTargetRef.current = null;
      } else {
        return;
      }
    }

    // Fast O(1) active clip tracking: continue from the LAST mapped playable clip (including Gaps)
    let currentClipIdx = activeClipIdxRef.current;
    if (currentClipIdx < 0 || currentClipIdx >= videoClips.length) {
      currentClipIdx = 0;
    }

    const checkClip = videoClips[currentClipIdx];
    const checkStart = Number.isFinite(checkClip?.sourceStart) ? checkClip.sourceStart : (checkClip?.start || 0);
    const checkEnd = Number.isFinite(checkClip?.sourceEnd) ? checkClip.sourceEnd : (checkClip?.end || realDur);

    if (srcNow < (checkStart - 0.04) || srcNow >= checkEnd) {
      let foundIdx = -1;
      // 1. Check forward in timeline order for next playable clip (including Gaps)
      for (let i = currentClipIdx + 1; i < videoClips.length; i++) {
        const c = videoClips[i];
        if (!c) continue;
        const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
        const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
        if (srcNow >= (sStart - 0.03) && srcNow < sEnd) {
          foundIdx = i;
          break;
        }
      }

      // 2. Fallback: only if seeking, search backward from currentClipIdx - 1 down to 0
      if (foundIdx === -1 && hasSeekedRef.current) {
        for (let i = currentClipIdx - 1; i >= 0; i--) {
          const c = videoClips[i];
          if (!c) continue;
          const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
          const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
          if (srcNow >= (sStart - 0.03) && srcNow < sEnd) {
            foundIdx = i;
            break;
          }
        }
      }

      if (foundIdx !== -1) {
        currentClipIdx = foundIdx;
        activeClipIdxRef.current = currentClipIdx;
      }
    }

    if (currentClipIdx !== -1 && videoClips[currentClipIdx]) {
      const c = videoClips[currentClipIdx];
      const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
      const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
      const cStart = Number.isFinite(c.start) ? c.start : 0;
      const cEnd = Number.isFinite(c.end) ? c.end : (cStart + (sEnd - sStart));

      const offset = Math.max(0, srcNow - sStart);
      let tlTime = parseFloat((cStart + offset).toFixed(2));

      // Monotonic guarantee: While isPlaying and user has not seeked, mapped timeline time must never decrease
      if (isPlaying && !hasSeekedRef.current && lastMappedTimelineTimeRef.current !== null && Number.isFinite(lastMappedTimelineTimeRef.current)) {
        if (tlTime < lastMappedTimelineTimeRef.current) {
          tlTime = lastMappedTimelineTimeRef.current;
        }
      }
      hasSeekedRef.current = false;
      lastMappedTimelineTimeRef.current = tlTime;

      // Optimized state update (~200ms, ~5fps for React tree) while GPU playhead runs at 60fps
      const now = performance.now();
      if (v.paused || (now - lastStateUpdateTimeRef.current >= 200)) {
        lastStateUpdateTimeRef.current = now;
        setCurrentTime(tlTime);
      }

      // Handle transition to next clip (including Gap spans) or end of timeline
      if (srcNow >= sEnd - 0.03) {
        const nextClipIdx = currentClipIdx + 1;
        const nextClip = nextClipIdx < videoClips.length ? videoClips[nextClipIdx] : null;

        if (nextClip) {
          const trans = resolveForwardPlaybackTransition(videoClips, currentClipIdx, srcNow, realDur);
          const nextSrcStart = Number.isFinite(trans.targetSrc)
            ? trans.targetSrc
            : (Number.isFinite(nextClip.sourceStart)
                ? nextClip.sourceStart
                : (Number.isFinite(nextClip.start) ? nextClip.start : 0));

          // CRITICAL INVARIANT:
          // 1. NEVER seek backward during forward playback (nextSrcStart <= srcNow)! That causes infinite loops.
          // 2. Only seek forward if next clip (including Gap) has a genuine forward jump (>0.15s in source media).
          // 3. Contiguous clips (difference <= 0.15s) flow naturally through HTML5 video decoder with zero seek/stutter.
          // 4. Coalesce chained non-contiguous micro-slivers and enforce a seek cooldown to prevent seek storms.
          if (nextSrcStart > srcNow + 0.15 && !v.seeking) {
            const seekNowMs = performance.now();
            if (seekNowMs - lastTransitionSeekMsRef.current >= 120) {
              lastTransitionSeekMsRef.current = seekNowMs;
              activeClipIdxRef.current = trans.nextClipIdx >= 0 ? trans.nextClipIdx : nextClipIdx;
              hasSeekedRef.current = true;
              pendingSeekTargetRef.current = nextSrcStart;
              pendingSeekStartedMsRef.current = seekNowMs;
              v.currentTime = nextSrcStart;
            }
          } else if (nextSrcStart >= srcNow - 0.15) {
            activeClipIdxRef.current = nextClipIdx;
          }
        } else {
          // Last clip reached -> STOP at the end, never loop back
          const trueMaxDur = Math.max(v.duration || 0, duration || 0, realDur || 0);
          if (videoClips.length === 1 && trueMaxDur > sEnd + 0.5) {
            setCurrentTime(srcNow);
          } else {
            intendedPlayingRef.current = false;
            v.pause();
            setIsPlaying(false);
            if (Number.isFinite(cEnd)) {
              setCurrentTime(cEnd);
            }
          }
        }
      }
    } else {
      const now = performance.now();
      if (v.paused || (now - lastStateUpdateTimeRef.current >= 200)) {
        lastStateUpdateTimeRef.current = now;
        setCurrentTime(srcNow);
      }
    }

    if (v.paused && isPlaying && !v.seeking) {
      intendedPlayingRef.current = false;
      setIsPlaying(false);
    }
  };

  const handleTimeUpdateRef = useRef(handleTimeUpdate);
  handleTimeUpdateRef.current = handleTimeUpdate;

  // Frame-accurate playhead loop: uses requestVideoFrameCallback when supported (Chrome, Edge, Safari, Firefox),
  // with requestAnimationFrame fallback. Frame metadata mediaTime guarantees zero-lag presentation timestamps.
  useEffect(() => {
    if (!isPlaying) return;
    const v = videoRef?.current;
    let frameCallbackId = null;
    let animId = null;
    let isActive = true;

    const onVideoFrame = (now, metadata) => {
      if (!isActive) return;
      handleTimeUpdateRef.current?.(metadata?.mediaTime);
      if (v && typeof v.requestVideoFrameCallback === 'function') {
        frameCallbackId = v.requestVideoFrameCallback(onVideoFrame);
      }
    };

    if (v && typeof v.requestVideoFrameCallback === 'function') {
      frameCallbackId = v.requestVideoFrameCallback(onVideoFrame);
    } else {
      const tick = () => {
        if (!isActive) return;
        handleTimeUpdateRef.current?.();
        animId = requestAnimationFrame(tick);
      };
      animId = requestAnimationFrame(tick);
    }

    return () => {
      isActive = false;
      if (frameCallbackId !== null && v && typeof v.cancelVideoFrameCallback === 'function') {
        v.cancelVideoFrameCallback(frameCallbackId);
      }
      if (animId !== null) {
        cancelAnimationFrame(animId);
      }
    };
  }, [isPlaying, videoRef]);

  // Keep activeClipIdxRef valid whenever videoClips changes (prevents stale clip index traps after edits)
  useEffect(() => {
    if (!Array.isArray(videoClips) || videoClips.length === 0) {
      activeClipIdxRef.current = 0;
      return;
    }
    if (activeClipIdxRef.current < 0 || activeClipIdxRef.current >= videoClips.length || !isPlaying) {
      const safeT = Number.isFinite(lastMappedTimelineTimeRef.current) ? lastMappedTimelineTimeRef.current : 0;
      const mapping = mapTimelineToSourceTime(safeT, videoClips);
      if (mapping.inClip && mapping.clipIndex >= 0) {
        activeClipIdxRef.current = mapping.clipIndex;
      } else if (mapping.isGap && mapping.nextClip) {
        const nextIdx = videoClips.findIndex((c) => c.id === mapping.nextClip.id);
        activeClipIdxRef.current = nextIdx >= 0 ? nextIdx : 0;
      } else {
        activeClipIdxRef.current = 0;
      }
    }
  }, [videoClips, isPlaying]);

  // Bounded stall/hung-seek watchdog:
  // Monitors video element during playback and paused seeks.
  // 1. During active playback: if seeking or readyState < 3 for >= 1200ms, nudge forward to abort stalled range request.
  // 2. While paused: if stuck in seeking for >= 400ms without progress, unfreeze by re-asserting latest seek target.
  useEffect(() => {
    if (renderedVideo?.isProxyPreview) return undefined;
    const v = videoRef?.current;
    if (!v) return undefined;

    let lastHealthyTime = Number.isFinite(v.currentTime) ? v.currentTime : 0;
    let stuckSinceMs = performance.now();

    const onClearSeek = () => {
      isSeekInFlightRef.current = false;
      pendingSeekTargetRef.current = null;
      pausedSeekingSinceMsRef.current = 0;
      stuckSinceMs = performance.now();
      stallRecoveryCountRef.current = 0;
      pausedRecoveryCountRef.current = 0;
      if (intendedPlayingRef.current && v.paused && !v.ended) {
        v.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    };

    v.addEventListener('seeked', onClearSeek);
    v.addEventListener('canplay', onClearSeek);

    const timer = window.setInterval(() => {
      if (v.ended) return;
      const curT = Number.isFinite(v.currentTime) ? v.currentTime : 0;
      const nowMs = performance.now();

      // When paused: video is stationary.
      // Do NEVER mutate v.currentTime via watchdog timers while paused,
      // because mutating currentTime interrupts Chrome's in-buffer frame decoding
      // and aborts ongoing seeks, wedging media pipelines into stalled states.
      if (v.paused) {
        lastHealthyTime = curT;
        stuckSinceMs = nowMs;
        stallRecoveryCountRef.current = 0;
        pausedSeekingSinceMsRef.current = 0;
        pausedRecoveryCountRef.current = 0;
        return;
      }

      // Only reset stall counters when playback actually advances while readyState >= 3 and not seeking
      if (!v.seeking && v.readyState >= 3 && Math.abs(curT - lastHealthyTime) >= 0.08) {
        lastHealthyTime = curT;
        stuckSinceMs = nowMs;
        stallRecoveryCountRef.current = 0;
        pausedRecoveryCountRef.current = 0;
        pendingSeekTargetRef.current = null;
        return;
      }

      // Active playback stall recovery:
      // If video is actively playing (!v.paused) but stuck in seeking or readyState < 3 for >= 3500ms,
      // nudge forward to abort stalled socket and resume.
      const isActiveStalled = !v.paused && (v.seeking || v.readyState < 3);
      if (isActiveStalled && (nowMs - stuckSinceMs) >= 3500 && stallRecoveryCountRef.current < 3) {
        stallRecoveryCountRef.current += 1;
        stuckSinceMs = nowMs;
        const maxDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (duration || curT + 1);
        const unfreezeTarget = getUnfreezeTime(curT, maxDur);
        hasSeekedRef.current = true;
        pendingSeekTargetRef.current = unfreezeTarget;
        pendingSeekStartedMsRef.current = nowMs;
        try {
          v.currentTime = unfreezeTarget;
        } catch (_) {}
        try {
          const p = v.play();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              if (intendedPlayingRef.current) setIsPlaying(true);
            }).catch(() => {});
          }
        } catch (_) {}
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
      v.removeEventListener('seeked', onClearSeek);
      v.removeEventListener('canplay', onClearSeek);
    };
  }, [isPlaying, playRequestTick, duration, videoRef, renderedVideo?.isProxyPreview]);

  // Bi-directional synchronization between native HTML5 <video> events and React state
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return undefined;

    const onNativePlay = () => {
      intendedPlayingRef.current = true;
      setIsPlaying(true);
    };

    const onNativePause = () => {
      if (v.seeking) return;
      intendedPlayingRef.current = false;
      setIsPlaying(false);
    };

    const drainNextSeek = () => {
      isSeekInFlightRef.current = false;
      pausedRecoveryCountRef.current = 0;
      if (nextSeekTargetRef.current !== null) {
        const next = nextSeekTargetRef.current;
        nextSeekTargetRef.current = null;
        if (Math.abs((v.currentTime || 0) - next) > 0.03) {
          isSeekInFlightRef.current = true;
          pendingSeekTargetRef.current = next;
          pendingSeekStartedMsRef.current = performance.now();
          try { v.currentTime = next; } catch (_) {}
        }
      }
    };

    v.addEventListener('play', onNativePlay);
    v.addEventListener('pause', onNativePause);
    v.addEventListener('seeked', drainNextSeek);

    return () => {
      v.removeEventListener('play', onNativePlay);
      v.removeEventListener('pause', onNativePause);
      v.removeEventListener('seeked', drainNextSeek);
    };
  }, [videoRef, selectedVideo?.videoUrl, renderedVideo, episodeKey, playRequestTick]);

  const handleSeek = useCallback((time, options = {}) => {
    const { skipStateCommit = false } = options || {};
    hasSeekedRef.current = true;
    stallRecoveryCountRef.current = 0;
    activeClipIdxRef.current = 0;
    const rawTime = typeof time === 'number' && Number.isFinite(time) ? time : 0;
    const realDur = videoRef?.current?.duration || 0;
    const totalDur = timelineDuration > 0 ? timelineDuration : (duration > 0 ? duration : realDur);
    const clampedTime = Math.max(0, totalDur > 0 ? Math.min(totalDur, rawTime) : rawTime);
    if (!skipStateCommit) {
      setCurrentTime(clampedTime);
    }
    currentTimeRef.current = clampedTime;
    lastMappedTimelineTimeRef.current = clampedTime;

    if (videoRef?.current) {
      let targetTime = clampedTime;
      if (renderedVideo) {
        targetTime = clampedTime;
      } else if (videoClips && videoClips.length > 0) {
        const mapping = mapTimelineToSourceTime(clampedTime, videoClips);
        if (mapping.inClip && Number.isFinite(mapping.sourceTime)) {
          targetTime = mapping.sourceTime;
          const targetIdx = videoClips.findIndex(c => c.id === mapping.clip?.id);
          if (targetIdx !== -1) {
            activeClipIdxRef.current = targetIdx;
          }
        } else if (mapping.isGap && mapping.nextClip && Number.isFinite(mapping.nextClip.sourceStart)) {
          targetTime = mapping.nextClip.sourceStart;
          const targetIdx = videoClips.findIndex(c => c.id === mapping.nextClip?.id);
          if (targetIdx !== -1) {
            activeClipIdxRef.current = targetIdx;
          }
        }
      }

      if (videoRef.current.readyState === 0) {
        return;
      }

      // Stale seek recovery: if in-flight seek takes > 1200ms, unlock
      const isSeekingStale = isSeekInFlightRef.current && (performance.now() - pendingSeekStartedMsRef.current > 1200);
      if (isSeekingStale) {
        isSeekInFlightRef.current = false;
      }

      // If video is currently seeking, coalesce seek requests:
      // Store latest requested time so the in-flight seek can finish downloading
      // its 206 byte-range chunk without being aborted prematurely.
      // Once 'seeked' fires, drainNextSeek immediately dispatches this target.
      if ((videoRef.current.seeking || isSeekInFlightRef.current) && !isSeekingStale) {
        nextSeekTargetRef.current = targetTime;
        return;
      }

      nextSeekTargetRef.current = null;
      if (Number.isFinite(targetTime) && Math.abs((videoRef.current.currentTime || 0) - targetTime) > 0.03) {
        isSeekInFlightRef.current = true;
        pendingSeekTargetRef.current = targetTime;
        pendingSeekStartedMsRef.current = performance.now();
        videoRef.current.currentTime = targetTime;
      }
    }
  }, [duration, timelineDuration, renderedVideo, videoClips, videoRef]);

  const lastPlayPauseTimeRef = useRef(0);
  const handlePlayPause = useCallback(() => {
    if (!videoRef?.current) return;
    const now = performance.now();
    if (now - lastPlayPauseTimeRef.current < 150) {
      return;
    }
    lastPlayPauseTimeRef.current = now;

    const v = videoRef.current;
    const realDur = v.duration || 0;
    const totalDur = timelineDuration > 0 ? timelineDuration : Math.max(duration > 0 ? duration : 0, realDur > 0 ? realDur : 0);

    if (v.paused) {
      intendedPlayingRef.current = true;
      stallRecoveryCountRef.current = 0;
      isSeekInFlightRef.current = false;

      // Unified single-point play target resolution:
      // Play target priority:
      // 1. If a seek target is already queued in nextSeekTargetRef, play from it.
      // 2. Otherwise, map the current timeline currentTime to video source time.
      let playTarget = null;
      if (nextSeekTargetRef.current !== null) {
        playTarget = nextSeekTargetRef.current;
        nextSeekTargetRef.current = null;
      } else if (!renderedVideo && videoClips && videoClips.length > 0) {
        const safeNow = Number.isFinite(currentTime) ? currentTime : 0;
        const mapping = mapTimelineToSourceTime(safeNow, videoClips);
        if (mapping.inClip && Number.isFinite(mapping.sourceTime)) {
          playTarget = mapping.sourceTime;
          const targetIdx = videoClips.findIndex(c => c.id === mapping.clip?.id);
          if (targetIdx !== -1) activeClipIdxRef.current = targetIdx;
        } else if (mapping.isGap && mapping.nextClip && Number.isFinite(mapping.nextClip.sourceStart)) {
          playTarget = mapping.nextClip.sourceStart;
          const targetIdx = videoClips.findIndex(c => c.id === mapping.nextClip?.id);
          if (targetIdx !== -1) activeClipIdxRef.current = targetIdx;
        }
      }

      const alreadySeekingToTarget = playTarget !== null && (
        (pendingSeekTargetRef.current !== null && Math.abs(pendingSeekTargetRef.current - playTarget) <= 0.04) ||
        (nextSeekTargetRef.current !== null && Math.abs(nextSeekTargetRef.current - playTarget) <= 0.04)
      );

      if (v.ended || (totalDur > 0 && currentTime >= totalDur - 0.2)) {
        handleSeek(0);
      } else if (!alreadySeekingToTarget && playTarget !== null && Math.abs((v.currentTime || 0) - playTarget) > 0.04) {
        hasSeekedRef.current = true;
        pendingSeekTargetRef.current = playTarget;
        pendingSeekStartedMsRef.current = performance.now();
        isSeekInFlightRef.current = true;
        try { v.currentTime = playTarget; } catch (_) {}
      }
      lastMappedTimelineTimeRef.current = currentTime;
      if (!v.src && !v.currentSrc) {
        intendedPlayingRef.current = false;
        return;
      }
      if (v.error) {
        try { v.load(); } catch (_) {}
      }
      setPlayRequestTick((t) => t + 1);
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            if (intendedPlayingRef.current) {
              setIsPlaying(true);
            }
          })
          .catch((e) => {
            if (e.name === 'AbortError' && intendedPlayingRef.current) {
              // Concurrent seek interrupted initial play(): retry once when seek/buffer completes
              let retried = false;
              const retryPlay = () => {
                if (retried) return;
                retried = true;
                v.removeEventListener('seeked', retryPlay);
                v.removeEventListener('canplay', retryPlay);
                if (!intendedPlayingRef.current || !v.paused || v.ended) return;
                v.play()
                  .then(() => {
                    if (intendedPlayingRef.current) setIsPlaying(true);
                  })
                  .catch(() => {
                    intendedPlayingRef.current = false;
                    setIsPlaying(false);
                  });
              };
              v.addEventListener('seeked', retryPlay, { once: true });
              v.addEventListener('canplay', retryPlay, { once: true });
              if (v.readyState >= 3 && !v.seeking) {
                window.setTimeout(retryPlay, 80);
              }
              return;
            }
            intendedPlayingRef.current = false;
            setIsPlaying(false);
            if (e.name !== 'AbortError' && e.name !== 'NotSupportedError') {
              console.error('Playback error:', e);
            }
          });
      } else {
        setIsPlaying(true);
      }
    } else {
      intendedPlayingRef.current = false;
      pendingSeekTargetRef.current = null;
      v.pause();
      setIsPlaying(false);
      // Sync exact timeline position immediately on pause so resuming Play never forces a stale backward seek
      const rawNow = Number.isFinite(v.currentTime) ? v.currentTime : currentTime;
      let exactTl = rawNow;
      if (!renderedVideo && Array.isArray(videoClips) && videoClips.length > 0) {
        const mapped = mapSourceToTimelineTime(rawNow, videoClips, activeClipIdxRef.current);
        if (typeof mapped === 'number' && Number.isFinite(mapped)) {
          exactTl = Math.max(lastMappedTimelineTimeRef.current || 0, mapped);
        }
      }
      if (Number.isFinite(exactTl)) {
        const rounded = parseFloat(exactTl.toFixed(2));
        lastMappedTimelineTimeRef.current = rounded;
        setCurrentTime(rounded);
      }
    }
  }, [currentTime, duration, timelineDuration, renderedVideo, videoClips, handleSeek, videoRef]);

  const handleVideoEnded = useCallback(() => {
    intendedPlayingRef.current = false;
    pendingSeekTargetRef.current = null;
    setIsPlaying(false);
  }, []);

  return {
    currentTime,
    setCurrentTime,
    duration: timelineDuration,
    rawDuration: duration,
    setDuration,
    isPlaying,
    setIsPlaying,
    handleLoadedMetadata,
    handleTimeUpdate,
    handleSeek,
    handlePlayPause,
    handleVideoEnded,
  };
}
