import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const audioFields = ['id', 'segmentId', 'audioPath', 'audioUrl', 'audioStartSec', 'startSec', 'startSeconds', 'start',
  'endSec', 'endSeconds', 'audioEndSec', 'audioDurationSec', 'duration', 'audioOffset', 'audioTrimmed',
  'userTrimmed', 'isMuted', 'muted', 'trackRow', 'khmerText'];

const proxyCache = new Map(); // sourceKey -> { spec, epoch, body, value }

function pick(obj, fields) {
  return Object.fromEntries(fields.filter(key => obj[key] != null).map(key => [key, obj[key]]));
}

function buildBody(videoUrl, clips, segments, settings, aspectRatio, logo, stem, framing, keyframes) {
  return JSON.stringify({
    videoUrl,
    clips: (clips || [])
      .filter(c => c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start)
      .map(c => pick(c, ['start', 'end', 'sourceStart', 'sourceEnd', 'isMuted'])),
    segments: (segments || []).map(v => {
      const audio = pick(v, audioFields);
      if (!audio.audioPath && !audio.audioUrl && v.audioFile) audio.audioFile = v.audioFile;
      return audio;
    }),
    settings: { ...settings, aspectRatio },
    editSignature: { logo, stem, framing, keyframes },
  });
}

export function useProxyPreview({ seriesId, episodeId, videoUrl, clips, segments, settings, logo, framing, keyframes, aspectRatio, stem, active }) {
  const [result, setResult] = useState(null);
  const [epoch, setEpoch] = useState(0);
  const prevEpRef = useRef(null);
  const lastValidProxyUrlRef = useRef(null);
  const sourceKey = JSON.stringify([seriesId, episodeId, videoUrl]);
  if (prevEpRef.current !== sourceKey) {
    prevEpRef.current = sourceKey;
    lastValidProxyUrlRef.current = proxyCache.get(sourceKey)?.value?.url || null;
  }

  const invalidate = useCallback(() => {
    proxyCache.delete(sourceKey);
    setEpoch(n => n + 1);
  }, [sourceKey]);
  const base = active && seriesId && episodeId && videoUrl ?
    '/api/series/' + encodeURIComponent(seriesId) + '/episodes/' + encodeURIComponent(episodeId) + '/proxy-preview' : null;
  const spec = useMemo(
    () => ({ videoUrl, clips, segments, settings, logo, framing, keyframes, aspectRatio, stem }),
    [videoUrl, clips, segments, settings, logo, framing, keyframes, aspectRatio, stem]
  );
  const specRef = useRef(spec);
  specRef.current = spec;

  useEffect(() => {
    if (!base) return;
    const controller = new AbortController();
    let timer;
    let builtBody = null;
    const getBody = () => {
      if (builtBody === null) {
        const s = specRef.current;
        builtBody = buildBody(s.videoUrl, s.clips, s.segments, s.settings, s.aspectRatio, s.logo, s.stem, s.framing, s.keyframes);
      }
      return builtBody;
    };
    async function check(revision) {
      try {
        const isPlayingLive = typeof window !== 'undefined' && Boolean(window.__timelineIsPlaying);
        if (!revision && isPlayingLive) {
          timer = setTimeout(() => check(null), 3000);
          return;
        }
        const body = revision ? null : getBody();
        const response = await fetch(revision ? base + '?revision=' + encodeURIComponent(revision) : base, {
          method: revision ? 'GET' : 'POST', cache: 'no-store', signal: controller.signal,
          ...(revision ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Proxy unavailable');
        if (controller.signal.aborted) return;
        const entryBody = getBody();
        if (value?.state === 'fresh' && value?.url) {
          proxyCache.delete(sourceKey);
          proxyCache.set(sourceKey, { spec, epoch, body: entryBody, value });
          if (proxyCache.size > 8) proxyCache.delete(proxyCache.keys().next().value);
        }
        setResult(prev => prev?.base === base && prev.spec === spec && prev.epoch === epoch &&
          JSON.stringify(prev.value) === JSON.stringify(value) ? prev : { base, sourceKey, spec, epoch, value });

        // While queued or rendering, keep polling GET with revision (relax during active live playback to free CPU)
        if (value.state === 'queued' || value.state === 'rendering') {
          const rev = value.revision || revision;
          const playingNow = typeof window !== 'undefined' && Boolean(window.__timelineIsPlaying);
          timer = setTimeout(() => check(rev), playingNow ? 6000 : 1000);
          return;
        }

        // Fresh or superseded: recheck every 5000ms (relax to 12000ms during active playback)
        if (value.state === 'fresh' || value.state === 'superseded') {
          const playingNow = typeof window !== 'undefined' && Boolean(window.__timelineIsPlaying);
          timer = setTimeout(() => check(value.revision || revision), playingNow ? 12000 : 5000);
          return;
        }

        // Stale or error: wait before re-submitting POST
        const retryDelay = value.state === 'error' ? 15000 : 2500;
        timer = setTimeout(() => check(null), retryDelay);
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ base, sourceKey, spec, epoch, value: { state: 'error', error: error.message } });
        timer = setTimeout(() => check(null), 15000);
      }
    }
    const cached = proxyCache.get(sourceKey);
    const cachedRevision = cached?.epoch === epoch ? cached.value?.revision : null;
    // A transient navigation target should never enqueue a full timeline render.
    timer = setTimeout(() => check(cachedRevision || null), cachedRevision ? 2500 : 1200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, sourceKey, spec, epoch]);

  const cachedEntry = proxyCache.get(sourceKey);
  const value = result?.sourceKey === sourceKey && result.base === base
    ? (result.spec === spec && result.epoch === epoch ? result.value : { state: 'queued', queuedSeconds: 0 })
    : (cachedEntry && cachedEntry.epoch === epoch ? cachedEntry.value : null);
  if (value?.state === 'fresh' && value?.url) {
    lastValidProxyUrlRef.current = value.url;
  }
  const effectiveProxyUrl = value?.state === 'fresh' ? value.url : lastValidProxyUrlRef.current;
  const media = useMemo(() => effectiveProxyUrl
    ? { outputVideoUrl: effectiveProxyUrl, aspectRatio, isProxyPreview: true } : null, [effectiveProxyUrl, aspectRatio]);
  return { value, media, invalidate };
}
