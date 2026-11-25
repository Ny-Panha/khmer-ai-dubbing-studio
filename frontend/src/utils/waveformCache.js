import { parseTimeToSeconds } from './timestampUtils';

// Bounded LRU cache of real decoded waveform peaks keyed by [seriesId, episodeId, audioUrl, audioSignature].
export const decodedPeaks = new Map();
const loadedEpisodes = new Map(); // `${seriesId}::${episodeId}` -> Promise<void> | true

export function resolveSegAudioUrl(seg) {
  if (!seg) return null;
  if (typeof seg.audioUrl === 'string' && seg.audioUrl) return seg.audioUrl;
  if (typeof seg.audioPath === 'string' && seg.audioPath) {
    return `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}`;
  }
  return null;
}

export function waveformKey(seriesId, episodeId, seg) {
  return JSON.stringify([seriesId, episodeId, resolveSegAudioUrl(seg), seg?.audioSignature || null]);
}

export function storedPeaks(seg) {
  if (!seg) return null;
  return [seg.peaks, seg.peaks?.peaks, seg.waveform, seg.waveform?.peaks]
    .find((peaks) => Array.isArray(peaks) && peaks.length > 0) || null;
}

function setBoundedPeak(key, peaks) {
  if (decodedPeaks.has(key)) decodedPeaks.delete(key);
  else if (decodedPeaks.size >= 1024) decodedPeaks.delete(decodedPeaks.keys().next().value);
  decodedPeaks.set(key, peaks);
}

export function measurePeaks(buffer) {
  const len = Math.max(1, Math.min(128, buffer.length));
  const bins = new Array(len).fill(0);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const samples = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const start = Math.floor((i * samples.length) / len);
      const end = Math.floor(((i + 1) * samples.length) / len);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(samples[j]);
        if (abs > peak) peak = abs;
      }
      const pct = Math.min(100, Math.round(peak * 100));
      const quantized = peak > 0.002 && pct === 0 ? 1 : pct;
      if (quantized > bins[i]) bins[i] = quantized;
    }
  }
  return bins;
}

let sharedDecodeCtx = null;
function getDecodeContext() {
  if (typeof window === 'undefined') return null;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) return null;
  if (!sharedDecodeCtx) sharedDecodeCtx = new OfflineCtx(1, 1, 24000);
  return sharedDecodeCtx;
}

export async function loadEpisodeWaveformPeaks(seriesId, episodeId, signal) {
  if (!seriesId || !episodeId) return false;
  const epCacheKey = `${seriesId}::${episodeId}`;
  const cached = loadedEpisodes.get(epCacheKey);
  if (cached === true) return false;
  if (cached) {
    await cached;
    return false;
  }

  let hydratedAny = false;
  const loadPromise = (async () => {
    try {
      const url = `/api/series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(episodeId)}/waveform-peaks`;
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const peaksMap = data?.peaks;
      if (peaksMap && typeof peaksMap === 'object') {
        for (const [k, vals] of Object.entries(peaksMap)) {
          if (Array.isArray(vals) && vals.length > 0 && !decodedPeaks.has(k)) {
            setBoundedPeak(k, vals);
            hydratedAny = true;
          }
        }
      }
      loadedEpisodes.set(epCacheKey, true);
      if (loadedEpisodes.size > 24) loadedEpisodes.delete(loadedEpisodes.keys().next().value);
    } catch (_) {
      loadedEpisodes.delete(epCacheKey);
    }
  })();

  loadedEpisodes.set(epCacheKey, loadPromise);
  await loadPromise;
  return hydratedAny;
}

async function persistEpisodeWaveformPeaks(seriesId, episodeId, batchMap) {
  if (!seriesId || !episodeId || !batchMap || batchMap.size === 0) return;
  try {
    const peaks = Object.fromEntries(batchMap.entries());
    await fetch(`/api/series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(episodeId)}/waveform-peaks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peaks }),
    });
  } catch (_) {}
}

export async function ensureWaveformPeaks({
  seriesId,
  episodeId,
  segments = [],
  visibleRange = { start: 0, end: 180 },
  signal,
  onBatchReady = null,
  maxItems = Infinity,
  concurrency = 4,
}) {
  if (!seriesId || !episodeId || !Array.isArray(segments) || segments.length === 0) return;
  if (signal?.aborted) return;

  const hydrated = await loadEpisodeWaveformPeaks(seriesId, episodeId, signal);
  if (signal?.aborted) return;
  if (hydrated) onBatchReady?.();

  const ctx = getDecodeContext();
  if (!ctx) return;

  const visibleMissing = [];
  const otherMissing = [];
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    const url = resolveSegAudioUrl(seg);
    if (!url || storedPeaks(seg)) continue;
    const key = waveformKey(seriesId, episodeId, seg);
    if (decodedPeaks.has(key)) continue;
    const start = seg.audioStartSec ?? seg.startSec ?? parseTimeToSeconds(seg.start, idx * 4);
    const end = seg.audioEndSec ?? seg.endSec ?? start + 3;
    if (end >= visibleRange.start && start <= visibleRange.end) {
      visibleMissing.push({ key, url });
    } else {
      otherMissing.push({ key, url });
    }
  }

  const queue = [...visibleMissing, ...otherMissing].slice(0, maxItems);
  if (queue.length === 0) return;

  const newlyDecoded = new Map();
  let flushTimer = null;
  const scheduleFlush = () => {
    if (flushTimer || signal?.aborted) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!signal?.aborted) onBatchReady?.();
    }, 24);
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length && !signal?.aborted) {
      if (typeof window !== 'undefined' && window.__timelineIsPlaying) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      const item = queue[cursor++];
      if (!item || decodedPeaks.has(item.key)) continue;
      try {
        const res = await fetch(item.url, { signal, cache: 'force-cache', priority: 'low' });
        if (!res.ok || signal?.aborted) continue;
        const bytes = await res.arrayBuffer();
        if (signal?.aborted) return;
        const buffer = await ctx.decodeAudioData(bytes);
        if (signal?.aborted) return;
        const peaks = measurePeaks(buffer);
        setBoundedPeak(item.key, peaks);
        newlyDecoded.set(item.key, peaks);
        scheduleFlush();
      } catch (_) {
        if (signal?.aborted) return;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!signal?.aborted) onBatchReady?.();
  }

  if (newlyDecoded.size > 0 && !signal?.aborted) {
    void persistEpisodeWaveformPeaks(seriesId, episodeId, newlyDecoded);
  }
}

export async function prefetchEpisodeWaveformPeaks(seriesId, episodeId, segments, signal) {
  if (!seriesId || !episodeId || signal?.aborted) return;
  if (typeof window !== 'undefined' && window.__timelineIsPlaying) return;
  await ensureWaveformPeaks({
    seriesId,
    episodeId,
    segments,
    visibleRange: { start: 0, end: 180 },
    signal,
    maxItems: 16,
    concurrency: 2,
  });
}
