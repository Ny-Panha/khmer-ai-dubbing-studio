import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const audioFields = ['id', 'segmentId', 'audioPath', 'audioUrl', 'audioStartSec', 'startSec', 'startSeconds', 'start',
  'endSec', 'endSeconds', 'audioEndSec', 'audioDurationSec', 'duration', 'audioOffset', 'audioTrimmed',
  'userTrimmed', 'isMuted', 'muted', 'trackRow', 'khmerText'];

function pick(obj, fields) {
  return Object.fromEntries(fields.filter(key => obj[key] != null).map(key => [key, obj[key]]));
}

export function useProxyPreview({ seriesId, episodeId, videoUrl, clips, segments, settings, logo, framing, keyframes, aspectRatio, stem, active }) {
  const [result, setResult] = useState(null);
  const [epoch, setEpoch] = useState(0);
  const prevEpRef = useRef(null);
  const isInitialOpen = prevEpRef.current !== episodeId;
  if (isInitialOpen) {
    prevEpRef.current = episodeId;
  }

  const invalidate = useCallback(() => setEpoch(n => n + 1), []);
  const base = active && seriesId && episodeId && videoUrl ?
    '/api/series/' + encodeURIComponent(seriesId) + '/episodes/' + encodeURIComponent(episodeId) + '/proxy-preview' : null;
  const body = useMemo(() => JSON.stringify({
    videoUrl, clips: (clips || []).map(c => pick(c, ['start', 'end', 'sourceStart', 'sourceEnd', 'isMuted'])),
    segments: (segments || []).map(v => {
      const audio = pick(v, audioFields);
      if (!audio.audioPath && !audio.audioUrl && v.audioFile) audio.audioFile = v.audioFile;
      return audio;
    }),
    settings: { ...settings, aspectRatio }, editSignature: { logo, stem, framing, keyframes },
    immediate: isInitialOpen,
  }), [videoUrl, clips, segments, settings, logo, framing, keyframes, aspectRatio, stem, isInitialOpen]);

  useEffect(() => {
    if (!base) return;
    const controller = new AbortController();
    let timer;
    async function check(revision) {
      try {
        const response = await fetch(revision ? base + '?revision=' + encodeURIComponent(revision) : base, {
          method: revision ? 'GET' : 'POST', cache: 'no-store', signal: controller.signal,
          ...(revision ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Proxy unavailable');
        if (controller.signal.aborted) return;
        setResult(prev => prev?.base === base && prev.body === body && prev.epoch === epoch &&
          JSON.stringify(prev.value) === JSON.stringify(value) ? prev : { base, body, epoch, value });

        // While queued or rendering, keep polling GET with revision every 1000ms
        if (value.state === 'queued' || value.state === 'rendering') {
          const rev = value.revision || revision;
          timer = setTimeout(() => check(rev), 1000);
          return;
        }

        // Fresh or superseded: recheck every 5000ms
        if (value.state === 'fresh' || value.state === 'superseded') {
          timer = setTimeout(() => check(value.revision || revision), 5000);
          return;
        }

        // Stale or error: wait before re-submitting POST
        const retryDelay = value.state === 'error' ? 15000 : 2500;
        timer = setTimeout(() => check(null), retryDelay);
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ base, body, epoch, value: { state: 'error', error: error.message } });
        timer = setTimeout(() => check(null), 15000);
      }
    }
    timer = setTimeout(() => check(null), 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, body, epoch]);

  const value = result?.base === base
    ? (result.body === body && result.epoch === epoch ? result.value : { state: 'queued', queuedSeconds: 0 })
    : null;
  const media = useMemo(() => value?.state === 'fresh'
    ? { outputVideoUrl: value.url, aspectRatio, isProxyPreview: true } : null, [value, aspectRatio]);
  return { value, media, invalidate };
}
