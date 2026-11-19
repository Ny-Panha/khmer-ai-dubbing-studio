import { useState, useEffect, useRef } from 'react';

/**
 * Hook to manage Source Video Proxy for fast, smooth LIVE multi-clip playback.
 * 
 * - When an episode opens, requests/checks Source Proxy with immediate=true.
 * - Polls progress while transcoding.
 * - When ready, provides url for LIVE playback.
 * - While transcoding or on error, provides clean status and leaves LIVE playback on raw source.
 */
export function useSourceProxy({ seriesId, episodeId, videoUrl, active = true }) {
  const [proxyData, setProxyData] = useState({
    status: 'idle',
    url: null,
    progress: 0,
    elapsedSeconds: 0,
    duration: 0,
    bytes: 0,
    error: null,
  });

  const pollTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (!active || !seriesId || !episodeId || !videoUrl) {
      setProxyData({
        status: 'idle',
        url: null,
        progress: 0,
        elapsedSeconds: 0,
        duration: 0,
        bytes: 0,
        error: null,
      });
      return;
    }

    let isCancelled = false;

    const checkSourceProxy = async (immediate = false) => {
      try {
        const query = new URLSearchParams();
        if (immediate) query.set('immediate', 'true');
        if (videoUrl) query.set('videoUrl', videoUrl);

        const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(episodeId)}/source-proxy?${query.toString()}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (isCancelled || !isMountedRef.current) return;

        if (data.status === 'ready') {
          setProxyData({
            status: 'ready',
            url: data.url,
            progress: 100,
            elapsedSeconds: data.renderSeconds || 0,
            duration: data.duration || 0,
            bytes: data.bytes || 0,
            error: null,
          });
        } else if (data.status === 'transcoding') {
          setProxyData(prev => ({
            ...prev,
            status: 'transcoding',
            progress: data.progress || 0,
            elapsedSeconds: data.elapsedSeconds || 0,
            error: null,
          }));

          // Poll every 1s while transcoding (back off during active live playback)
          const isPlaying = typeof window !== 'undefined' && Boolean(window.__timelineIsPlaying);
          pollTimerRef.current = setTimeout(() => {
            if (!isCancelled && isMountedRef.current) {
              checkSourceProxy(false);
            }
          }, isPlaying ? 5000 : 1000);
        } else if (data.status === 'error') {
          setProxyData(prev => ({
            ...prev,
            status: 'error',
            error: data.error || 'Source proxy transcode failed',
          }));
        } else {
          setProxyData(prev => ({
            ...prev,
            status: data.status || 'idle',
          }));
        }
      } catch (err) {
        if (!isCancelled && isMountedRef.current) {
          setProxyData(prev => ({
            ...prev,
            status: 'error',
            error: err.message,
          }));
        }
      }
    };

    // Trigger initial check with immediate=true on episode open
    checkSourceProxy(true);

    return () => {
      isCancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [seriesId, episodeId, videoUrl, active]);

  return {
    url: proxyData.url,
    status: proxyData.status,
    isReady: proxyData.status === 'ready' && Boolean(proxyData.url),
    progress: proxyData.progress,
    elapsedSeconds: proxyData.elapsedSeconds,
    duration: proxyData.duration,
    bytes: proxyData.bytes,
    error: proxyData.error,
  };
}
