import { findLeadingSilenceFromChannels, computeSegmentAudioSyncTarget } from './audioSyncUtils.js';

export const CROSSFADE_MIN_OVERLAP_SEC = 0.015;
export const CROSSFADE_MAX_DURATION_SEC = 0.35;
export const CROSSFADE_MAX_CLIP_RATIO = 0.35;
export const CROSSFADE_MIN_START_SEPARATION_SEC = 0.02;

function roundSec3(val) {
  return Math.round(val * 1000) / 1000;
}

function clamp01(val) {
  if (!Number.isFinite(val)) return 0;
  return val <= 0 ? 0 : (val >= 1 ? 1 : val);
}

/**
 * Half-sine (raised-cosine / FFmpeg curve=hsin) fade-in gain in [0, 1].
 * Complementary to evalHalfSineFadeOut: fadeIn(u) + fadeOut(u) === 1.0 for all u in [0, 1].
 */
export function evalHalfSineFadeIn(u) {
  const t = clamp01(u);
  return 0.5 * (1 - Math.cos(Math.PI * t));
}

/**
 * Half-sine (raised-cosine / FFmpeg curve=hsin) fade-out gain in [0, 1].
 */
export function evalHalfSineFadeOut(u) {
  const t = clamp01(u);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/**
 * Build a Float32Array gain curve for Web Audio GainNode.gain.setValueCurveAtTime().
 */
export function buildHalfSineCurve(type, startU = 0, endU = 1, targetGain = 1.0, steps = 64) {
  const count = Math.max(2, Math.floor(steps));
  const curve = new Float32Array(count);
  const u0 = clamp01(startU);
  const u1 = clamp01(endU);
  const evalFn = type === 'in' ? evalHalfSineFadeIn : evalHalfSineFadeOut;
  for (let i = 0; i < count; i++) {
    const frac = i / (count - 1);
    const u = u0 + (u1 - u0) * frac;
    curve[i] = evalFn(u) * targetGain;
  }
  return curve;
}

/**
 * Compute adaptive crossfade fade duration strictly inside the overlap boundary,
 * matching backend ffmpegAudioMixAndDucking.js identically.
 */
export function computeAdaptiveCrossfadeDuration(overlapSec, prevDurSec, nextDurSec) {
  if (!Number.isFinite(overlapSec) || overlapSec < CROSSFADE_MIN_OVERLAP_SEC) {
    return 0;
  }
  const caps = [overlapSec, CROSSFADE_MAX_DURATION_SEC];
  if (Number.isFinite(prevDurSec) && prevDurSec > 0) {
    caps.push(prevDurSec * CROSSFADE_MAX_CLIP_RATIO);
  }
  if (Number.isFinite(nextDurSec) && nextDurSec > 0) {
    caps.push(nextDurSec * CROSSFADE_MAX_CLIP_RATIO);
  }
  const dur = Math.min(...caps);
  if (!Number.isFinite(dur) || dur < CROSSFADE_MIN_OVERLAP_SEC) {
    return 0;
  }
  return roundSec3(dur);
}

/**
 * Two-pass chronological overlap detector matching backend computeOverlapCrossfadePlan().
 * Expects items of shape { key, startSec, endSec, durSec } (order-independent).
 * Returns a Map<key, { fadeIn, fadeOut }>.
 */
export function computeOverlapCrossfadePlan(entries = []) {
  const planMap = new Map();
  if (!Array.isArray(entries) || entries.length === 0) return planMap;

  const items = entries.map((entry, idx) => {
    const startSec = Number.isFinite(entry.startSec) ? entry.startSec : 0;
    const durSec = Number.isFinite(entry.durSec) && entry.durSec > 0
      ? entry.durSec
      : (Number.isFinite(entry.endSec) && entry.endSec > startSec ? (entry.endSec - startSec) : 0);
    const endSec = Number.isFinite(entry.endSec) && entry.endSec > startSec
      ? entry.endSec
      : (startSec + durSec);
    return {
      key: entry.key !== undefined ? entry.key : String(idx),
      origIdx: idx,
      startSec,
      durSec: Math.max(0, endSec - startSec),
      endSec,
      fadeIn: null,
      fadeOut: null,
      audibleEndSec: endSec,
    };
  });

  const sorted = [...items].sort((a, b) => (a.startSec - b.startSec) || (a.origIdx - b.origIdx));

  // Pass 1: Outgoing fade-out for each clip overlapping an upcoming clip (same-lane OR multi-lane)
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur.durSec <= CROSSFADE_MIN_OVERLAP_SEC) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      if (next.startSec >= cur.endSec - CROSSFADE_MIN_OVERLAP_SEC) break;
      if (next.startSec - cur.startSec < CROSSFADE_MIN_START_SEPARATION_SEC) continue;
      if (next.durSec <= CROSSFADE_MIN_OVERLAP_SEC) continue;

      const overlapEnd = Math.min(cur.endSec, next.endSec);
      const overlapSec = overlapEnd - next.startSec;
      const fadeDur = computeAdaptiveCrossfadeDuration(overlapSec, cur.durSec, next.durSec);
      if (fadeDur >= CROSSFADE_MIN_OVERLAP_SEC) {
        const relStartSec = roundSec3(Math.max(0, next.startSec - cur.startSec));
        const endSec = roundSec3(next.startSec + fadeDur);
        cur.fadeOut = {
          startSec: roundSec3(next.startSec),
          endSec,
          durSec: fadeDur,
          relStartSec,
          targetKey: next.key,
        };
        cur.audibleEndSec = Math.min(cur.endSec, endSec);
        break;
      }
    }
  }

  // Pass 2: Incoming fade-in matching any preceding clip still audible at cur.startSec
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur.durSec <= CROSSFADE_MIN_OVERLAP_SEC) continue;

    let bestFadeInDur = 0;
    for (let p = i - 1; p >= 0; p--) {
      const prev = sorted[p];
      if (cur.startSec - prev.startSec < CROSSFADE_MIN_START_SEPARATION_SEC) continue;
      if (prev.audibleEndSec <= cur.startSec + CROSSFADE_MIN_OVERLAP_SEC) continue;

      let candidateDur = 0;
      if (prev.fadeOut && prev.fadeOut.targetKey === cur.key) {
        candidateDur = prev.fadeOut.durSec;
      } else {
        const overlapEnd = Math.min(prev.audibleEndSec, cur.endSec);
        const overlapSec = overlapEnd - cur.startSec;
        candidateDur = computeAdaptiveCrossfadeDuration(overlapSec, prev.durSec, cur.durSec);
      }
      if (candidateDur > bestFadeInDur) {
        bestFadeInDur = candidateDur;
      }
    }

    if (bestFadeInDur >= CROSSFADE_MIN_OVERLAP_SEC) {
      if (cur.fadeOut && bestFadeInDur > cur.fadeOut.relStartSec - 0.005) {
        bestFadeInDur = roundSec3(Math.max(0, cur.fadeOut.relStartSec - 0.005));
      }
      if (bestFadeInDur >= CROSSFADE_MIN_OVERLAP_SEC) {
        cur.fadeIn = {
          startSec: roundSec3(cur.startSec),
          endSec: roundSec3(cur.startSec + bestFadeInDur),
          durSec: bestFadeInDur,
        };
      }
    }
  }

  for (const item of items) {
    planMap.set(item.key, {
      fadeIn: item.fadeIn,
      fadeOut: item.fadeOut,
    });
  }
  return planMap;
}

/**
 * Evaluate exact instantaneous crossfade gain at a given timeline time (seconds).
 */
export function evalSegmentCrossfadeGainAtTime(timelineSec, plan, baseGain = 1.0) {
  if (!Number.isFinite(baseGain) || baseGain <= 0) return 0;
  if (!plan) return baseGain;

  let mult = 1.0;
  const { fadeIn, fadeOut } = plan;
  if (fadeIn && fadeIn.durSec > 0 && timelineSec < fadeIn.endSec) {
    if (timelineSec <= fadeIn.startSec) {
      mult *= 0;
    } else {
      mult *= evalHalfSineFadeIn((timelineSec - fadeIn.startSec) / fadeIn.durSec);
    }
  }
  if (fadeOut && fadeOut.durSec > 0 && timelineSec >= fadeOut.startSec) {
    if (timelineSec >= fadeOut.endSec) {
      mult = 0;
    } else {
      mult *= evalHalfSineFadeOut((timelineSec - fadeOut.startSec) / fadeOut.durSec);
    }
  }
  return mult * baseGain;
}

/**
 * Schedule sample-accurate Web Audio GainNode automation for smooth half-sine crossfades.
 * Guarantees strictly monotonic AudioParam events (never throws NotSupportedError on curve overlap).
 */
export function scheduleCrossfadeGainEnvelope(
  gainParam,
  {
    ctxNow = 0,
    timelineNow = 0,
    segStart = 0,
    playbackRate = 1.0,
    plan = null,
    targetGain = 1.0,
  } = {}
) {
  if (!gainParam) return;
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1.0;
  const safeTarget = Number.isFinite(targetGain) && targetGain > 0 ? targetGain : 0;

  if (typeof gainParam.cancelScheduledValues === 'function') {
    try { gainParam.cancelScheduledValues(ctxNow); } catch (_) {}
  }

  if (safeTarget <= 0) {
    try { gainParam.setValueAtTime(0, ctxNow); } catch (_) {}
    return;
  }

  const effectiveStartTl = Math.max(timelineNow, segStart);
  const startAtCtx = timelineNow < segStart
    ? ctxNow + ((segStart - timelineNow) / rate)
    : ctxNow;

  const fadeIn = plan?.fadeIn || null;
  const fadeOut = plan?.fadeOut || null;
  const hasCurveApi = typeof gainParam.setValueCurveAtTime === 'function';

  const applyCurve = (type, u0, u1, tStart, durCtx) => {
    const safeDur = Math.max(0.005, durCtx);
    if (hasCurveApi) {
      const curve = buildHalfSineCurve(type, u0, u1, safeTarget, 64);
      gainParam.setValueCurveAtTime(curve, tStart, safeDur);
    } else {
      const evalFn = type === 'in' ? evalHalfSineFadeIn : evalHalfSineFadeOut;
      gainParam.setValueAtTime(evalFn(u0) * safeTarget, tStart);
      if (typeof gainParam.linearRampToValueAtTime === 'function') {
        gainParam.linearRampToValueAtTime(evalFn(u1) * safeTarget, tStart + safeDur);
      }
    }
  };

  let minNextEventCtx = startAtCtx;

  if (fadeIn && fadeIn.durSec >= CROSSFADE_MIN_OVERLAP_SEC && effectiveStartTl < fadeIn.endSec - 0.002) {
    // Keep silent prior to future clip start if scheduled ahead
    if (startAtCtx > ctxNow + 0.002) {
      gainParam.setValueAtTime(0, ctxNow);
    }
    const uStart = clamp01((effectiveStartTl - fadeIn.startSec) / fadeIn.durSec);
    const remDurCtx = Math.max(0.005, (fadeIn.endSec - effectiveStartTl) / rate);
    applyCurve('in', uStart, 1.0, startAtCtx, remDurCtx);
    minNextEventCtx = startAtCtx + remDurCtx + 0.001;
  } else if (fadeOut && fadeOut.durSec >= CROSSFADE_MIN_OVERLAP_SEC && effectiveStartTl >= fadeOut.startSec) {
    if (effectiveStartTl >= fadeOut.endSec - 0.002) {
      gainParam.setValueAtTime(0, startAtCtx);
    } else {
      const uStart = clamp01((effectiveStartTl - fadeOut.startSec) / fadeOut.durSec);
      const remDurCtx = Math.max(0.005, (fadeOut.endSec - effectiveStartTl) / rate);
      applyCurve('out', uStart, 1.0, startAtCtx, remDurCtx);
    }
    return;
  } else {
    gainParam.setValueAtTime(safeTarget, startAtCtx);
    minNextEventCtx = startAtCtx + 0.001;
  }

  // Schedule upcoming fade-out curve if clip transitions into an overlapping next clip
  if (fadeOut && fadeOut.durSec >= CROSSFADE_MIN_OVERLAP_SEC && fadeOut.startSec > effectiveStartTl) {
    const rawFadeOutCtx = ctxNow + ((fadeOut.startSec - timelineNow) / rate);
    const fadeOutAtCtx = Math.max(rawFadeOutCtx, minNextEventCtx);
    const fadeOutDurCtx = Math.max(0.005, fadeOut.durSec / rate);
    applyCurve('out', 0.0, 1.0, fadeOutAtCtx, fadeOutDurCtx);
  }
}

/**
 * ConCaT-Inspired Bounded AudioBuffer LRU Cache
 * Keeps at most `maxBuffers` decoded AudioBuffer instances in memory (~12MB for 50 clips).
 * Pre-decodes upcoming clips and calculates dead-air leading silence automatically.
 */
export class AudioBufferLRUCache {
  constructor(maxBuffers = 50) {
    this.maxBuffers = maxBuffers;
    this.cache = new Map(); // url -> { buffer, lastUsedMs, leadSkipSec }
    this.inflight = new Map();
    this.controller = new AbortController();
  }

  has(url) {
    return this.cache.has(url);
  }

  get(url) {
    const entry = this.cache.get(url);
    if (entry) {
      entry.lastUsedMs = performance.now();
      return entry;
    }
    return null;
  }

  set(url, buffer, leadSkipSec = 0) {
    if (this.cache.size >= this.maxBuffers) {
      // Evict oldest unreferenced buffer
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache.entries()) {
        if (v.lastUsedMs < oldestTime) {
          oldestTime = v.lastUsedMs;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(url, {
      buffer,
      leadSkipSec,
      lastUsedMs: performance.now(),
    });
  }

  async loadAndDecode(url, audioContext) {
    if (!url || !audioContext) return null;
    const existing = this.get(url);
    if (existing) return existing;

    if (this.inflight.has(url)) {
      return this.inflight.get(url);
    }

    const { signal } = this.controller;
    const promise = (async () => {
      try {
        const response = await fetch(url, { cache: 'force-cache', signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading ${url}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (signal.aborted) return null;
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        if (signal.aborted) return null;

        // Compute leading silence from decoded PCM channels
        const channels = [];
        for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
          channels.push(audioBuffer.getChannelData(c));
        }
        const leadSkipSec = findLeadingSilenceFromChannels(channels, audioBuffer.sampleRate);

        this.set(url, audioBuffer, leadSkipSec);
        return this.get(url);
      } catch (err) {
        return null;
      } finally {
        if (!signal.aborted) this.inflight.delete(url);
      }
    })();

    this.inflight.set(url, promise);
    return promise;
  }

  cancelPending() {
    this.controller.abort();
    this.controller = new AbortController();
    this.inflight.clear();
  }

  clear() {
    this.cancelPending();
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

/**
 * ConCaT-Inspired Khmer Audio Web Audio Scheduler
 * Replaces imperative 60Hz HTMLAudioElement seek loops with sample-accurate Web Audio scheduling.
 * Video timeline serves as the authoritative master clock.
 */
export class WebAudioScheduler {
  constructor({ maxCachedBuffers = 50 } = {}) {
    this.ctx = null;
    this.masterGain = null;
    this.lruCache = new AudioBufferLRUCache(maxCachedBuffers);
    this.scheduledNodes = new Map(); // segKey -> { sourceNode, gainNode, segStart, segEnd, startedAtCtx, url }
    this.lastVideoTime = 0;
    this.lastPlaybackRate = 1.0;
    this.lastAudioDriftMs = 0;
  }

  isSupported() {
    return typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  ensureContext() {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume?.()?.catch?.(() => {});
      }
      return this.ctx;
    }
    if (!this.isSupported()) return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMasterVolume(volume, isMuted = false) {
    if (!this.masterGain || !this.ctx) return;
    // Allow true 0%–200% Khmer voice gain boost (matching Audio Mix slider 0.2x–2.0x)
    const target = isMuted ? 0 : Math.min(2.0, Math.max(0, Number(volume) || 0));
    try {
      this.masterGain.gain.setValueAtTime(target, this.ctx.currentTime);
    } catch (_) {}
  }

  stopAll() {
    for (const [key, item] of this.scheduledNodes.entries()) {
      try {
        if (item.sourceNode) {
          item.sourceNode.stop();
          item.sourceNode.disconnect();
        }
        if (item.gainNode) {
          item.gainNode.disconnect();
        }
      } catch (_) {}
    }
    this.scheduledNodes.clear();
  }

  /**
   * Pre-warm / pre-decode upcoming segment buffers into LRU cache.
   */
  preloadUpcoming(segments = [], now = 0, lookaheadSec = 15) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const upcoming = segments
      .map((seg) => {
        const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
        const rawUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
        return { seg, s, rawUrl };
      })
      .filter(({ seg, s, rawUrl }) => !seg.muted && !seg.isMuted && rawUrl && s >= (now - 1) && s <= (now + lookaheadSec))
      .sort((a, b) => a.s - b.s);

    for (const { rawUrl } of upcoming) {
      if (this.lruCache.inflight.size >= 2) break;
      if (!this.lruCache.has(rawUrl)) this.lruCache.loadAndDecode(rawUrl, ctx);
    }
  }

  /**
   * Pre-warm all voice and delivery variants for an active or inspected segment
   */
  preloadSegmentVariants(segment) {
    if (!segment) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (segment.audioUrl && !this.lruCache.has(segment.audioUrl)) {
      this.lruCache.loadAndDecode(segment.audioUrl, ctx);
    }
    if (segment.voiceAudioVariants && typeof segment.voiceAudioVariants === 'object') {
      for (const vKey of Object.keys(segment.voiceAudioVariants)) {
        const variantUrl = segment.voiceAudioVariants[vKey]?.audioUrl;
        if (variantUrl && !this.lruCache.has(variantUrl)) {
          this.lruCache.loadAndDecode(variantUrl, ctx);
        }
      }
    }
    if (segment.deliveryVariants && typeof segment.deliveryVariants === 'object') {
      for (const dKey of Object.keys(segment.deliveryVariants)) {
        const variantUrl = segment.deliveryVariants[dKey]?.audioUrl;
        if (variantUrl && !this.lruCache.has(variantUrl)) {
          this.lruCache.loadAndDecode(variantUrl, ctx);
        }
      }
    }
  }

  /**
   * Authoritative timeline sync tick (called from RAF or video timeupdate).
   * Schedules near-future narration segments (~1.5s - 2.5s lookahead) with sample-accurate Web Audio timing.
   */
  syncAtTimelineTime({
    timelineNow = 0,
    playbackRate = 1.0,
    segments = [],
    khmerVolume = 1.0,
    isKhmerMuted = false,
    lookaheadSec = 2.2,
  } = {}) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    this.lastVideoTime = timelineNow;
    const effectiveRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1.0;
    this.lastPlaybackRate = effectiveRate;

    this.setMasterVolume(khmerVolume, isKhmerMuted);
    // masterGain already applies khmerVolume (0..2.0); per-segment gainNode applies smooth crossfade envelopes (0.0..1.0)
    const targetVol = isKhmerMuted ? 0 : 1.0;

    // Resolve active segments & actual audio durations (preferring decoded PCM buffer duration when cached)
    const activeKeyMap = new Map();
    const nearbyCrossfadeEntries = [];
    const segMetaByIdx = new Map();
    if (Array.isArray(segments)) {
      for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx];
        if (seg.muted || seg.isMuted) continue;
        const key = String(seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx));
        const sStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
          ? seg.audioStartSec
          : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : 0);
        const sUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
        const rawDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
          ? seg.finalAudioDuration
          : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
            ? seg.audioDurationSec
            : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0) ? seg.audioDuration : 2.5));
        const sTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
        const rawOffset = typeof seg.audioOffset === 'number' && !isNaN(seg.audioOffset) ? seg.audioOffset : 0;
        const cachedEntry = sUrl ? this.lruCache.get(sUrl) : null;
        const leadSkipSec = (cachedEntry && rawOffset === 0 && !seg.userTrimmed) ? (cachedEntry.leadSkipSec || 0) : 0;
        const baseOffset = rawOffset + leadSkipSec;

        let effectiveDur = rawDur;
        let sEnd = sStart + rawDur;
        if (sTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) && seg.audioEndSec > sStart) {
          sEnd = seg.audioEndSec;
          effectiveDur = Math.max(0.05, sEnd - sStart);
        } else if (cachedEntry && cachedEntry.buffer && Number.isFinite(cachedEntry.buffer.duration) && cachedEntry.buffer.duration > baseOffset + 0.02) {
          effectiveDur = Math.max(0.05, cachedEntry.buffer.duration - baseOffset);
          sEnd = sStart + effectiveDur;
        }

        activeKeyMap.set(key, { segStart: sStart, segEnd: sEnd, url: sUrl });
        segMetaByIdx.set(idx, { key, segStart: sStart, segEnd: sEnd, durSec: effectiveDur, url: sUrl, cachedEntry, baseOffset });

        // Include nearby clips for O(1) chronological crossfade plan calculation
        if (sStart <= (timelineNow + lookaheadSec + 4.0) && sEnd >= (timelineNow - 6.0)) {
          nearbyCrossfadeEntries.push({
            key,
            startSec: sStart,
            endSec: sEnd,
            durSec: effectiveDur,
          });
        }
      }
    }

    const crossfadePlanMap = computeOverlapCrossfadePlan(nearbyCrossfadeEntries);

    // Cleanup finished, deleted, or moved segments
    for (const [key, item] of this.scheduledNodes.entries()) {
      const activeSeg = activeKeyMap.get(key);
      const isDeletedOrMuted = !activeSeg || !activeSeg.url;
      const itemRawEnd = item.rawSegEnd !== undefined ? item.rawSegEnd : item.segEnd;
      const isMovedOrModified = activeSeg && (
        Math.abs(activeSeg.segStart - item.segStart) > 0.025 ||
        Math.abs(activeSeg.segEnd - itemRawEnd) > 0.060 ||
        activeSeg.url !== item.url
      );
      const isPastOrSeeked = timelineNow > (item.segEnd + 0.15) || timelineNow < (item.segStart - (lookaheadSec + 0.5));

      if (isDeletedOrMuted || isMovedOrModified || isPastOrSeeked) {
        try {
          item.sourceNode.stop();
          item.sourceNode.disconnect();
          item.gainNode.disconnect();
        } catch (_) {}
        this.scheduledNodes.delete(key);
      }
    }

    if (!Array.isArray(segments) || segments.length === 0) return;

    // Filter segments in active scheduling window: [timelineNow - 0.05, timelineNow + lookaheadSec]
    for (let idx = 0; idx < segments.length; idx++) {
      const seg = segments[idx];
      if (seg.muted || seg.isMuted) {
        const segKey = String(seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx));
        if (this.scheduledNodes.has(segKey)) {
          const item = this.scheduledNodes.get(segKey);
          try {
            item.sourceNode.stop();
            item.sourceNode.disconnect();
            item.gainNode.disconnect();
          } catch (_) {}
          this.scheduledNodes.delete(segKey);
        }
        continue;
      }

      const meta = segMetaByIdx.get(idx);
      if (!meta || !meta.url) continue;

      const { key: segKey, segStart, segEnd: effectiveSegEnd, url: rawUrl, cachedEntry, baseOffset } = meta;

      // Outside current lookahead window
      if (segStart > (timelineNow + lookaheadSec) || effectiveSegEnd <= (timelineNow - 0.05)) {
        continue;
      }

      const crossfadePlan = crossfadePlanMap.get(segKey) || { fadeIn: null, fadeOut: null };
      // Allow clip to play smoothly through its crossfade fade-out end (never abruptly cut before overlap)
      const playbackEnd = crossfadePlan.fadeOut
        ? Math.min(effectiveSegEnd, crossfadePlan.fadeOut.endSec)
        : effectiveSegEnd;

      // Once clip has faded completely to 0% or finished playing, stop cleanly
      if (timelineNow >= playbackEnd) {
        if (this.scheduledNodes.has(segKey)) {
          const item = this.scheduledNodes.get(segKey);
          try {
            item.sourceNode.stop();
            item.sourceNode.disconnect();
            item.gainNode.disconnect();
          } catch (_) {}
          this.scheduledNodes.delete(segKey);
        }
        continue;
      }

      if (!cachedEntry) {
        // Trigger pre-decode if not yet in cache
        this.lruCache.loadAndDecode(rawUrl, ctx);
        continue;
      }

      const audioBuffer = cachedEntry.buffer;
      const crossfadeSig = [
        crossfadePlan.fadeIn ? `${crossfadePlan.fadeIn.startSec.toFixed(3)}:${crossfadePlan.fadeIn.durSec.toFixed(3)}` : 'none',
        crossfadePlan.fadeOut ? `${crossfadePlan.fadeOut.startSec.toFixed(3)}:${crossfadePlan.fadeOut.durSec.toFixed(3)}` : 'none',
        effectiveRate.toFixed(3),
        targetVol.toFixed(3),
      ].join('|');

      // If already scheduled, preserve running GainNode automation unless envelope/rate changed, and check drift
      if (this.scheduledNodes.has(segKey)) {
        const item = this.scheduledNodes.get(segKey);
        const itemRawEnd = item.rawSegEnd !== undefined ? item.rawSegEnd : item.segEnd;

        // If segment moved, trimmed, or URL changed, cancel old node and reschedule cleanly
        if (Math.abs(item.segStart - segStart) > 0.025 || Math.abs(itemRawEnd - effectiveSegEnd) > 0.060 || item.url !== rawUrl) {
          try {
            item.sourceNode.stop();
            item.sourceNode.disconnect();
            item.gainNode.disconnect();
          } catch (_) {}
          this.scheduledNodes.delete(segKey);
          // Fall through to schedule new BufferSourceNode below
        } else {
          if (item.sourceNode.playbackRate.value !== effectiveRate) {
            item.sourceNode.playbackRate.setValueAtTime(effectiveRate, ctx.currentTime);
          }
          if (item.crossfadeSig !== crossfadeSig) {
            try {
              scheduleCrossfadeGainEnvelope(item.gainNode.gain, {
                ctxNow: ctx.currentTime,
                timelineNow,
                segStart,
                playbackRate: effectiveRate,
                plan: crossfadePlan,
                targetGain: targetVol,
              });
              item.crossfadeSig = crossfadeSig;
              item.segEnd = playbackEnd;
            } catch (_) {}
          }

          // Measure audio drift relative to video playhead
          if (timelineNow >= segStart && timelineNow < playbackEnd) {
            const expectedPlayedSec = (timelineNow - segStart);
            const actualPlayedAudioSec = (ctx.currentTime - item.startedAtCtx) * effectiveRate;
            const driftSec = expectedPlayedSec - actualPlayedAudioSec;
            this.lastAudioDriftMs = Math.round(driftSec * 1000);

            // If drift exceeds 90ms (e.g. video decoder stalled or seeked), re-align smoothly
            if (Math.abs(driftSec) > 0.090) {
              try {
                item.sourceNode.stop();
                item.sourceNode.disconnect();
                item.gainNode.disconnect();
              } catch (_) {}
              this.scheduledNodes.delete(segKey);
              // Will re-schedule in the block below
            } else {
              continue;
            }
          } else {
            continue;
          }
        }
      }

      // Schedule new BufferSourceNode with sample-accurate GainNode crossfade automation
      try {
        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.playbackRate.setValueAtTime(effectiveRate, ctx.currentTime);

        const gainNode = ctx.createGain();
        scheduleCrossfadeGainEnvelope(gainNode.gain, {
          ctxNow: ctx.currentTime,
          timelineNow,
          segStart,
          playbackRate: effectiveRate,
          plan: crossfadePlan,
          targetGain: targetVol,
        });

        sourceNode.connect(gainNode);
        gainNode.connect(this.masterGain);

        const timeDelta = segStart - timelineNow;

        if (timeDelta > 0) {
          // Starts in the near future
          const startAtCtx = ctx.currentTime + (timeDelta / effectiveRate);
          const durationLimit = Math.min(audioBuffer.duration - baseOffset, playbackEnd - segStart);
          if (durationLimit > 0.02) {
            sourceNode.start(startAtCtx, baseOffset, durationLimit);
            this.scheduledNodes.set(segKey, {
              sourceNode,
              gainNode,
              segStart,
              segEnd: playbackEnd,
              rawSegEnd: effectiveSegEnd,
              startedAtCtx: startAtCtx,
              crossfadeSig,
              url: rawUrl,
            });
          }
        } else {
          // Segment should be actively playing right now
          const elapsedSec = (timelineNow - segStart);
          const playOffset = baseOffset + elapsedSec;
          const remainingSec = Math.min(audioBuffer.duration - playOffset, playbackEnd - timelineNow);

          if (playOffset < audioBuffer.duration && remainingSec > 0.02) {
            sourceNode.start(ctx.currentTime, playOffset, remainingSec);
            this.scheduledNodes.set(segKey, {
              sourceNode,
              gainNode,
              segStart,
              segEnd: playbackEnd,
              rawSegEnd: effectiveSegEnd,
              startedAtCtx: ctx.currentTime - (elapsedSec / effectiveRate),
              crossfadeSig,
              url: rawUrl,
            });
            this.lastAudioDriftMs = 0;
          }
        }
      } catch (err) {
        console.warn('[WebAudioScheduler] schedule error:', err);
      }
    }
  }

  getDiagnostics() {
    return {
      isSupported: this.isSupported(),
      contextState: this.ctx ? this.ctx.state : 'uninitialized',
      activeNodesCount: this.scheduledNodes.size,
      cachedBuffersCount: this.lruCache.size(),
      lastDriftMs: this.lastAudioDriftMs,
    };
  }

  destroy() {
    this.stopAll();
    this.lruCache.clear();
    if (this.ctx && this.ctx.state !== 'closed') {
      try { this.ctx.close(); } catch (_) {}
    }
    this.ctx = null;
    this.masterGain = null;
  }
}
