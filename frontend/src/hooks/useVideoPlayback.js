import { useState, useCallback, useRef, useEffect } from 'react';
import { mapTimelineToSourceTime } from '../utils/timelineUtils';

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

  const handleLoadedMetadata = () => {
    if (videoRef?.current) {
      const dur = videoRef.current.duration || 0;
      if (dur > 0) {
        setDuration((prevDur) => {
          if (!prevDur || prevDur === 0 || Math.abs(prevDur - dur) > 0.5) {
            return dur;
          }
          return prevDur;
        });
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
      if (v.paused && isPlaying) setIsPlaying(false);
      return;
    }

    // Check if HTML5 video has reached the physical end of file
    if (v.ended || (realDur > 0 && currentMediaTime >= realDur - 0.15)) {
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
      if (v.paused && isPlaying) setIsPlaying(false);
      return;
    }

    const srcNow = currentMediaTime;

    // Fast O(1) active clip tracking: check current clip bounds first before scanning array
    let currentClipIdx = activeClipIdxRef.current;
    if (currentClipIdx < 0 || currentClipIdx >= videoClips.length) {
      currentClipIdx = 0;
    }
    const checkClip = videoClips[currentClipIdx];
    const checkStart = Number.isFinite(checkClip?.sourceStart) ? checkClip.sourceStart : (checkClip?.start || 0);
    const checkEnd = Number.isFinite(checkClip?.sourceEnd) ? checkClip.sourceEnd : (checkClip?.end || realDur);

    if (srcNow < (checkStart - 0.04) || srcNow >= checkEnd) {
      // Check if it seamlessly advanced to the next adjacent clip
      if (currentClipIdx + 1 < videoClips.length) {
        const nextC = videoClips[currentClipIdx + 1];
        const nStart = Number.isFinite(nextC?.sourceStart) ? nextC.sourceStart : (nextC?.start || 0);
        const nEnd = Number.isFinite(nextC?.sourceEnd) ? nextC.sourceEnd : (nextC?.end || realDur);
        if (srcNow >= (nStart - 0.04) && srcNow < nEnd) {
          currentClipIdx = currentClipIdx + 1;
        } else {
          currentClipIdx = videoClips.findIndex((c) => {
            const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
            const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
            return srcNow >= (sStart - 0.03) && srcNow < sEnd;
          });
        }
      } else {
        currentClipIdx = videoClips.findIndex((c) => {
          const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
          const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
          return srcNow >= (sStart - 0.03) && srcNow < sEnd;
        });
      }
      if (currentClipIdx !== -1) {
        activeClipIdxRef.current = currentClipIdx;
      }
    }

    if (currentClipIdx !== -1) {
      const c = videoClips[currentClipIdx];
      const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
      const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
      const cStart = Number.isFinite(c.start) ? c.start : 0;
      const cEnd = Number.isFinite(c.end) ? c.end : (cStart + (sEnd - sStart));

      const offset = Math.max(0, srcNow - sStart);
      const tlTime = parseFloat((cStart + offset).toFixed(2));

      // Optimized state update (~200ms, ~5fps for React tree) while GPU playhead runs at 60fps
      const now = performance.now();
      if (v.paused || (now - lastStateUpdateTimeRef.current >= 200)) {
        lastStateUpdateTimeRef.current = now;
        setCurrentTime(tlTime);
      }

      // Handle transition to next clip or end of timeline
      if (srcNow >= sEnd - 0.03) {
        if (currentClipIdx < videoClips.length - 1) {
          const nextClip = videoClips[currentClipIdx + 1];
          const nextSrcStart = Number.isFinite(nextClip?.sourceStart) 
            ? nextClip.sourceStart 
            : (Number.isFinite(nextClip?.start) ? nextClip.start : 0);

          // CRITICAL PLAYBACK LOOP GUARD:
          // 1. NEVER seek backward during forward playback (nextSrcStart <= srcNow)! That causes infinite loops.
          // 2. Only seek forward if next clip has a genuine forward gap (>0.15s in source media).
          // 3. Contiguous clips (difference <= 0.15s) flow naturally through HTML5 video decoder with zero seek/stutter.
          if (nextSrcStart > srcNow + 0.15 && !v.seeking) {
            v.currentTime = nextSrcStart;
          }
        } else {
          // Last clip reached
          // If only 1 clip exists and real video has more content, allow video to play to full duration
          const trueMaxDur = Math.max(v.duration || 0, duration || 0, realDur || 0);
          if (videoClips.length === 1 && trueMaxDur > sEnd + 0.5) {
            setCurrentTime(srcNow);
          } else {
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

    if (v.paused && isPlaying) {
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

  const handleSeek = useCallback((time) => {
    activeClipIdxRef.current = 0;
    const rawTime = typeof time === 'number' && Number.isFinite(time) ? time : 0;
    const realDur = videoRef?.current?.duration || 0;
    const totalDur = Math.max(duration > 0 ? duration : 0, realDur > 0 ? realDur : 0);
    const clampedTime = Math.max(0, totalDur > 0 ? Math.min(totalDur, rawTime) : rawTime);
    setCurrentTime(clampedTime);

    if (videoRef?.current) {
      let targetTime = clampedTime;
      if (renderedVideo) {
        targetTime = clampedTime;
      } else if (videoClips && videoClips.length > 0) {
        const mapping = mapTimelineToSourceTime(clampedTime, videoClips);
        if (mapping.inClip && Number.isFinite(mapping.sourceTime)) {
          targetTime = mapping.sourceTime;
        } else if (mapping.isGap && mapping.nextClip && Number.isFinite(mapping.nextClip.sourceStart)) {
          targetTime = mapping.nextClip.sourceStart;
        }
      }

      if (Number.isFinite(targetTime) && Math.abs((videoRef.current.currentTime || 0) - targetTime) > 0.03) {
        videoRef.current.currentTime = targetTime;
      }
    }
  }, [duration, renderedVideo, videoClips, videoRef]);

  const handlePlayPause = useCallback(() => {
    if (!videoRef?.current) return;
    const v = videoRef.current;
    const realDur = v.duration || 0;
    const totalDur = Math.max(duration > 0 ? duration : 0, realDur > 0 ? realDur : 0);

    if (v.paused) {
      if (v.ended || (totalDur > 0 && currentTime >= totalDur - 0.2)) {
        handleSeek(0);
      } else if (!renderedVideo && videoClips && videoClips.length > 0) {
        const safeNow = Number.isFinite(currentTime) ? currentTime : 0;
        const mapping = mapTimelineToSourceTime(safeNow, videoClips);
        if (mapping.inClip && Number.isFinite(mapping.sourceTime)) {
          if (Math.abs(v.currentTime - mapping.sourceTime) > 0.04) {
            v.currentTime = mapping.sourceTime;
          }
        } else if (mapping.isGap && mapping.nextClip && Number.isFinite(mapping.nextClip.sourceStart)) {
          // In gap: cue video to next clip start without forcing premature timeline jump
          v.currentTime = mapping.nextClip.sourceStart;
        }
      }
      if (!v.src && !v.currentSrc) return;
      if (v.error) {
        try { v.load(); } catch (_) {}
      }
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
          })
          .catch((e) => {
            setIsPlaying(false);
            if (e.name !== 'AbortError' && e.name !== 'NotSupportedError') {
              console.error('Playback error:', e);
            }
          });
      } else {
        setIsPlaying(true);
      }
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, [currentTime, duration, renderedVideo, videoClips, handleSeek, videoRef]);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  return {
    currentTime,
    setCurrentTime,
    duration,
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
