import { useCallback, useEffect, useMemo, useState } from 'react';

const audioFields = ['id', 'segmentId', 'audioPath', 'audioUrl', 'audioStartSec', 'startSec', 'startSeconds', 'start',
  'endSec', 'endSeconds', 'audioEndSec', 'audioDurationSec', 'duration', 'audioOffset', 'audioTrimmed',
  'userTrimmed', 'isMuted', 'muted', 'trackRow', 'khmerText', 'audioOutdated', 'playbackRate'];

function pick(obj, fields) {
  return Object.fromEntries(fields.filter(key => obj[key] != null).map(key => [key, obj[key]]));
}

export function useProxyPreview({ seriesId, episodeId, videoUrl, clips, segments, settings, logo, framing, keyframes, aspectRatio, stem, active }) {
  const [result, setResult] = useState(null);
  const [epoch, setEpoch] = useState(0);
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
  }), [videoUrl, clips, segments, settings, logo, framing, keyframes, aspectRatio, stem]);

  useEffect(() => {
    if (!base) return;
    const controller = new AbortController();
    let timer;
    async function check(revision) {
      try {
        const response = await fetch(revision ? base + '?revision=' + revision : base, {
          method: revision ? 'GET' : 'POST', cache: 'no-store', signal: controller.signal,
          ...(revision ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Proxy unavailable');
        if (controller.signal.aborted) return;
        setResult(prev => prev?.base === base && prev.body === body && prev.epoch === epoch &&
          JSON.stringify(prev.value) === JSON.stringify(value) ? prev : { base, body, epoch, value });
        // A newer editor snapshot owns this episode. Never re-submit the older
        // one from a poll. A local edit will start a new request.
        const retry = value.state === 'stale' || value.state === 'error';
        timer = setTimeout(() => check(retry ? null : value.revision || revision),
          value.state === 'error' ? 30000 : ['fresh', 'superseded'].includes(value.state) ? 5000 : 1000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ base, body, epoch, value: { state: 'error', error: error.message } });
        timer = setTimeout(() => check(null), 15000);
      }
    }
    timer = setTimeout(() => check(null), 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, body, epoch]);
  const value = result?.base === base && result.body === body && result.epoch === epoch ? result.value : null;
  const media = useMemo(() => value?.state === 'fresh'
    ? { outputVideoUrl: value.url, aspectRatio, isProxyPreview: true } : null, [value, aspectRatio]);
  return { value, media, invalidate };
}
