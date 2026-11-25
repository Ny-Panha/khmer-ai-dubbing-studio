import { useState, useEffect } from 'react';

const idle = { status: 'idle', url: null, progress: 0, elapsedSeconds: 0, duration: 0, bytes: 0, error: null };
const readyCache = new Map();

export async function prefetchSourceProxyStatus(seriesId, episodeId, videoUrl, signal) {
  if (!seriesId || !episodeId || !videoUrl || signal?.aborted) return;
  const key = JSON.stringify([seriesId, episodeId, videoUrl]);
  if (readyCache.has(key)) return;
  try {
    const query = new URLSearchParams({ videoUrl });
    const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(episodeId)}/source-proxy?${query}`, { signal });
    if (!res.ok || signal?.aborted) return;
    const data = await res.json();
    if (!signal?.aborted && data?.status === 'ready' && data?.url) {
      const value = { ...idle, ...data, progress: 100, elapsedSeconds: data.renderSeconds || data.elapsedSeconds || 0 };
      readyCache.delete(key);
      readyCache.set(key, value);
      if (readyCache.size > 12) readyCache.delete(readyCache.keys().next().value);
    }
  } catch (_) {}
}

export function useSourceProxy({ seriesId, episodeId, videoUrl, active = true }) {
  const key = active && seriesId && episodeId && videoUrl ? JSON.stringify([seriesId, episodeId, videoUrl]) : null;
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!key || readyCache.has(key)) return;
    const controller = new AbortController();
    let timer;
    let firstCheck = true;
    const check = async (immediate = false) => {
      try {
        const query = new URLSearchParams({ videoUrl });
        if (immediate) query.set('immediate', 'true');
        const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(episodeId)}/source-proxy?${query}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (controller.signal.aborted) return;

        const value = { ...idle, ...data, elapsedSeconds: data.renderSeconds || data.elapsedSeconds || 0 };
        readyCache.delete(key);
        if (data.status === 'ready') {
          value.progress = 100;
          readyCache.set(key, value);
          if (readyCache.size > 12) readyCache.delete(readyCache.keys().next().value);
        } else if (data.status === 'missing' || (firstCheck && data.status === 'error')) {
          // Don't start an encode while playing, or for episodes the user only passed through.
          timer = setTimeout(() => check(!window.__timelineIsPlaying), window.__timelineIsPlaying ? 5000 : 800);
        } else if (data.status === 'queued' || data.status === 'transcoding') {
          timer = setTimeout(() => check(), window.__timelineIsPlaying ? 5000 : 1000);
        }
        firstCheck = false;
        setResult({ key, value });
      } catch (err) {
        if (!controller.signal.aborted) setResult({ key, value: { ...idle, status: 'error', error: err.message } });
      }
    };
    timer = setTimeout(check, 80);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, seriesId, episodeId, videoUrl]);

  const data = readyCache.get(key) || (result?.key === key ? result.value : idle);
  return { ...data, isReady: data.status === 'ready' && Boolean(data.url) };
}
