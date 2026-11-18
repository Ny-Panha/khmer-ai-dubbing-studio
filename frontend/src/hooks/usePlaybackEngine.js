import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useVideoPlayback } from './useVideoPlayback';
import { mapSourceToTimelineTime } from '../utils/timelineUtils';

/**
 * High-frequency 60fps playback engine hook.
 * Wraps useVideoPlayback and drives a requestAnimationFrame loop over refs/subscribers
 * so playhead scrubbing and transport timecodes stay at 60fps without triggering
 * full-tree React re-renders of MediaLibrary or VoiceSettings.
 */
export function usePlaybackEngine(params) {
  const playback = useVideoPlayback(params);
  const { videoRef, videoClips, renderedVideo } = params || {};
  const { currentTime, isPlaying, duration } = playback;

  const playheadTimeRef = useRef(currentTime || 0);
  const subscribersRef = useRef(new Set());
  const rafIdRef = useRef(null);
  const videoClipsRef = useRef(videoClips);
  videoClipsRef.current = videoClips;
  const renderedVideoRef = useRef(renderedVideo);
  renderedVideoRef.current = renderedVideo;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const lastMappedIdxRef = useRef(0);
  const lastMappedTlTimeRef = useRef(0);

  const notifySubscribers = useCallback((nextTime) => {
    playheadTimeRef.current = nextTime;
    subscribersRef.current.forEach((listener) => {
      try {
        listener(nextTime);
      } catch (_) {}
    });
  }, []);

  // Keep ref synchronized when paused or seeking (never reset/fight 60fps RAF loop during active playback)
  useEffect(() => {
    if (isPlaying) return;
    if (Number.isFinite(currentTime)) {
      lastMappedTlTimeRef.current = currentTime;
      lastMappedIdxRef.current = 0;
      notifySubscribers(currentTime);
    }
  }, [currentTime, isPlaying, notifySubscribers]);

  // 60fps requestAnimationFrame loop while video is actively playing
  useEffect(() => {
    if (!isPlaying || typeof requestAnimationFrame === 'undefined') {
      if (rafIdRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return undefined;
    }

    const tick = () => {
      const v = videoRef?.current;
      if (v && !v.paused && !v.ended) {
        const rawMediaTime = Number.isFinite(v.currentTime) ? v.currentTime : 0;
        let nextTimelineTime = rawMediaTime;
        const clips = videoClipsRef.current;
        if (!renderedVideoRef.current && Array.isArray(clips) && clips.length > 0) {
          const mapped = mapSourceToTimelineTime(rawMediaTime, clips, lastMappedIdxRef.current);
          if (typeof mapped === 'number' && Number.isFinite(mapped)) {
            nextTimelineTime = Math.max(lastMappedTlTimeRef.current || 0, mapped);
            lastMappedTlTimeRef.current = nextTimelineTime;
          }
        }
        notifySubscribers(nextTimelineTime);
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isPlaying, videoRef, notifySubscribers]);

  const subscribePlayhead = useCallback((listener) => {
    if (typeof listener !== 'function') return () => {};
    subscribersRef.current.add(listener);
    return () => {
      subscribersRef.current.delete(listener);
    };
  }, []);

  return useMemo(
    () => ({
      ...playback,
      playheadTimeRef,
      subscribePlayhead,
    }),
    [playback, subscribePlayhead]
  );
}

