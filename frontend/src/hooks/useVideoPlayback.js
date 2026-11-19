import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { mapTimelineToSourceTime, mapSourceToTimelineTime, resolveForwardPlaybackTransition } from '../utils/timelineUtils';

/**
 * Custom hook to manage video playback state, playhead position, time update, and seeking
 */
export function useVideoPlayback({
  videoRef,
  videoClips,
  setVideoClips,
  renderedVideo,
  selectedVideo,
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
  const pendingSeekStartedMsRef = useRef(0);
  const lastTransitionSeekMsRef = useRef(0);
  const stallRecoveryCountRef = useRef(0);
  const [playRequestTick, setPlayRequestTick] = useState(0);

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

  // Bounded forward-only stall/hung-seek watchdog during active playback:
  // If <video> is attempting to play (!paused, !ended) but genuinely stuck in seeking or readyState < 3
  // with unchanged currentTime for >= 3.5s (e.g. hung HTTP range request), nudge strictly forward (+5ms)
  // to abort the stalled seek and resume cleanly without ever aborting normal 0.5-2s range buffering.
  useEffect(() => {
    if (renderedVideo?.isProxyPreview || (!isPlaying && !intendedPlayingRef.current)) return undefined;
    const v = videoRef?.current;
    if (!v) return undefined;

    let lastHealthyTime = Number.isFinite(v.currentTime) ? v.currentTime : 0;
    let stuckSinceMs = performance.now();

    const onClearSeek = () => {
      pendingSeekTargetRef.current = null;
      stuckSinceMs = performance.now();
      if (intendedPlayingRef.current && v.paused && !v.ended) {
        v.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    };

    v.addEventListener('seeked', onClearSeek);
    v.addEventListener('canplay', onClearSeek);

    const timer = window.setInterval(() => {
      if (!intendedPlayingRef.current || v.ended) return;
      const curT = Number.isFinite(v.currentTime) ? v.currentTime : 0;
      const nowMs = performance.now();

      // Only reset stall counters when playback actually advances while readyState >= 3 and not seeking
      if (!v.seeking && v.readyState >= 3 && Math.abs(curT - lastHealthyTime) >= 0.08) {
        lastHealthyTime = curT;
        stuckSinceMs = nowMs;
        stallRecoveryCountRef.current = 0;
        pendingSeekTargetRef.current = null;
        return;
      }

      const isStalled = (!v.paused && (v.seeking || v.readyState < 3)) || (v.paused && intendedPlayingRef.current && !v.ended && v.seeking);
      if (isStalled && (nowMs - stuckSinceMs) >= 3500 && stallRecoveryCountRef.current < 2) {
        stallRecoveryCountRef.current += 1;
        stuckSinceMs = nowMs;
        const maxDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (duration || curT + 1);
        const forwardTarget = Math.min(Math.max(0, maxDur - 0.05), curT + 0.005);
        if (forwardTarget > curT) {
          hasSeekedRef.current = true;
          pendingSeekTargetRef.current = forwardTarget;
          try {
            v.currentTime = forwardTarget;
          } catch (_) {}
        }
        try {
          const p = v.play();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              if (intendedPlayingRef.current) setIsPlaying(true);
            }).catch(() => {});
          }
        } catch (_) {}
      }
    }, 500);

    return () => {
      window.clearInterval(timer);
      v.removeEventListener('seeked', onClearSeek);
      v.removeEventListener('canplay', onClearSeek);
    };
  }, [isPlaying, playRequestTick, duration, videoRef, renderedVideo?.isProxyPreview]);

  const handleSeek = useCallback((time) => {
    hasSeekedRef.current = true;
    stallRecoveryCountRef.current = 0;
    activeClipIdxRef.current = 0;
    const rawTime = typeof time === 'number' && Number.isFinite(time) ? time : 0;
    const realDur = videoRef?.current?.duration || 0;
    const totalDur = timelineDuration > 0 ? timelineDuration : (duration > 0 ? duration : realDur);
    const clampedTime = Math.max(0, totalDur > 0 ? Math.min(totalDur, rawTime) : rawTime);
    setCurrentTime(clampedTime);
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

      if (Number.isFinite(targetTime) && Math.abs((videoRef.current.currentTime || 0) - targetTime) > 0.03) {
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

      if (v.ended || (totalDur > 0 && currentTime >= totalDur - 0.2)) {
        handleSeek(0);
      } else if (!renderedVideo && videoClips && videoClips.length > 0) {
        const safeNow = Number.isFinite(currentTime) ? currentTime : 0;
        const mapping = mapTimelineToSourceTime(safeNow, videoClips);
        if (mapping.inClip && Number.isFinite(mapping.sourceTime)) {
          const alreadySeekingToTarget = v.seeking
            && pendingSeekTargetRef.current !== null
            && Math.abs(pendingSeekTargetRef.current - mapping.sourceTime) <= 0.04;
          if (!alreadySeekingToTarget && Math.abs(v.currentTime - mapping.sourceTime) > 0.04) {
            hasSeekedRef.current = true;
            pendingSeekTargetRef.current = mapping.sourceTime;
            pendingSeekStartedMsRef.current = performance.now();
            v.currentTime = mapping.sourceTime;
          }
          const targetIdx = videoClips.findIndex(c => c.id === mapping.clip?.id);
          if (targetIdx !== -1) {
            activeClipIdxRef.current = targetIdx;
          }
        } else if (mapping.isGap && mapping.nextClip && Number.isFinite(mapping.nextClip.sourceStart)) {
          // In gap: cue video to next clip start without forcing premature timeline jump
          const nextSrcStart = mapping.nextClip.sourceStart;
          const alreadySeekingToTarget = v.seeking
            && pendingSeekTargetRef.current !== null
            && Math.abs(pendingSeekTargetRef.current - nextSrcStart) <= 0.04;
          if (!alreadySeekingToTarget && Math.abs(v.currentTime - nextSrcStart) > 0.04) {
            hasSeekedRef.current = true;
            pendingSeekTargetRef.current = nextSrcStart;
            pendingSeekStartedMsRef.current = performance.now();
            v.currentTime = nextSrcStart;
          }
          const targetIdx = videoClips.findIndex(c => c.id === mapping.nextClip?.id);
          if (targetIdx !== -1) {
            activeClipIdxRef.current = targetIdx;
          }
        }
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
