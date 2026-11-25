import { findLeadingSilenceFromChannels, computeSegmentAudioSyncTarget } from './audioSyncUtils.js';

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
    // masterGain already applies khmerVolume (0..2.0); per-segment gainNode handles ONLY overlap ducking (0.5x vs 1.0x)
    const targetVol = isKhmerMuted ? 0 : 1.0;

    // Build lookup of currently active segments to immediately prune deleted or moved items
    const activeKeyMap = new Map();
    if (Array.isArray(segments)) {
      for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx];
        if (seg.muted || seg.isMuted) continue;
        const key = String(seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx));
        const sStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
          ? seg.audioStartSec
          : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : 0);
        const sDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
          ? seg.finalAudioDuration
          : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
            ? seg.audioDurationSec
            : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0) ? seg.audioDuration : 2.5));
        const sTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
        const sEnd = (sTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
          ? seg.audioEndSec
          : (sStart + sDur);
        const sUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
        activeKeyMap.set(key, { segStart: sStart, segEnd: sEnd, url: sUrl });
      }
    }

    // Cleanup finished, deleted, or moved segments
    for (const [key, item] of this.scheduledNodes.entries()) {
      const activeSeg = activeKeyMap.get(key);
      const isDeletedOrMuted = !activeSeg || !activeSeg.url;
      const isMovedOrModified = activeSeg && (
        Math.abs(activeSeg.segStart - item.segStart) > 0.025 ||
        Math.abs(activeSeg.segEnd - item.segEnd) > 0.060 ||
        activeSeg.url !== item.url
      );
      const isPastOrSeeked = timelineNow > (item.segEnd + 0.15) || timelineNow < (item.segStart - 0.5);

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

      const rawUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
      if (!rawUrl) continue;

      const segStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : 0);

      const rawDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
        ? seg.finalAudioDuration
        : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
          ? seg.audioDurationSec
          : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0) ? seg.audioDuration : 2.5));

      const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
      const effectiveSegEnd = (isTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : (segStart + rawDur);

      // Outside current lookahead window
      if (segStart > (timelineNow + lookaheadSec) || effectiveSegEnd <= (timelineNow - 0.05)) {
        continue;
      }

      const segKey = String(seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx));

      // Overlap detection: Hard-clamp same-lane dialogues so two clips on the same track never clash;
      // apply gentle 50% auto-ducking on intentional multi-lane dialogue overlaps.
      let isOverlapped = false;
      let nextSameLaneStart = Infinity;
      const curTrackRow = typeof seg.trackRow === 'number' ? seg.trackRow : 0;
      const scanLimit = Math.min(segments.length, idx + 4);
      for (let nextIdx = idx + 1; nextIdx < scanLimit; nextIdx++) {
        const nextSeg = segments[nextIdx];
        if (nextSeg.muted || nextSeg.isMuted) continue;
        const nextTrackRow = typeof nextSeg.trackRow === 'number' ? nextSeg.trackRow : 0;
        const nextStart = (typeof nextSeg.audioStartSec === 'number' && !isNaN(nextSeg.audioStartSec))
          ? nextSeg.audioStartSec
          : (nextSeg.startSec || 0);
        if (nextStart > effectiveSegEnd) break;
        if (nextStart > segStart && nextStart < effectiveSegEnd) {
          if (curTrackRow === nextTrackRow) {
            nextSameLaneStart = Math.min(nextSameLaneStart, nextStart);
          } else if (timelineNow >= (nextStart - 0.04)) {
            isOverlapped = true;
          }
        }
      }

      const hardCappedEnd = nextSameLaneStart < Infinity
        ? Math.min(effectiveSegEnd, nextSameLaneStart)
        : effectiveSegEnd;

      // If playback already reached or passed next same-lane start, silence current segment
      if (timelineNow >= hardCappedEnd) {
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

      const effectiveVol = isOverlapped ? targetVol * 0.5 : targetVol;

      const cachedEntry = this.lruCache.get(rawUrl);
      if (!cachedEntry) {
        // Trigger pre-decode if not yet in cache
        this.lruCache.loadAndDecode(rawUrl, ctx);
        continue;
      }

      const audioBuffer = cachedEntry.buffer;
      const leadSkipSec = (seg.audioOffset === 0 && !seg.userTrimmed) ? (cachedEntry.leadSkipSec || 0) : 0;
      const baseOffset = (typeof seg.audioOffset === 'number' && !isNaN(seg.audioOffset) ? seg.audioOffset : 0) + leadSkipSec;

      // If already scheduled, adjust volume/rate if needed and check drift
      if (this.scheduledNodes.has(segKey)) {
        const item = this.scheduledNodes.get(segKey);

        // If segment moved, trimmed, or URL changed, cancel old node and reschedule cleanly
        if (Math.abs(item.segStart - segStart) > 0.025 || Math.abs(item.segEnd - effectiveSegEnd) > 0.060 || item.url !== rawUrl) {
          try {
            item.sourceNode.stop();
            item.sourceNode.disconnect();
            item.gainNode.disconnect();
          } catch (_) {}
          this.scheduledNodes.delete(segKey);
          // Fall through to schedule new BufferSourceNode below
        } else {
          if (item.gainNode.gain.value !== effectiveVol) {
            item.gainNode.gain.setValueAtTime(effectiveVol, ctx.currentTime);
          }
          if (item.sourceNode.playbackRate.value !== effectiveRate) {
            item.sourceNode.playbackRate.setValueAtTime(effectiveRate, ctx.currentTime);
          }

          // Measure audio drift relative to video playhead
          if (timelineNow >= segStart && timelineNow < hardCappedEnd) {
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

      // Schedule new BufferSourceNode
      try {
        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.playbackRate.setValueAtTime(effectiveRate, ctx.currentTime);

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(effectiveVol, ctx.currentTime);

        sourceNode.connect(gainNode);
        gainNode.connect(this.masterGain);

        const timeDelta = segStart - timelineNow;

        if (timeDelta > 0) {
          // Starts in the near future
          const startAtCtx = ctx.currentTime + (timeDelta / effectiveRate);
          const durationLimit = Math.min(audioBuffer.duration - baseOffset, hardCappedEnd - segStart);
          if (durationLimit > 0.02) {
            sourceNode.start(startAtCtx, baseOffset, durationLimit);
            this.scheduledNodes.set(segKey, {
              sourceNode,
              gainNode,
              segStart,
              segEnd: hardCappedEnd,
              startedAtCtx: startAtCtx,
              url: rawUrl,
            });
          }
        } else {
          // Segment should be actively playing right now
          const elapsedSec = (timelineNow - segStart);
          const playOffset = baseOffset + elapsedSec;
          const remainingSec = Math.min(audioBuffer.duration - playOffset, hardCappedEnd - timelineNow);

          if (playOffset < audioBuffer.duration && remainingSec > 0.02) {
            sourceNode.start(ctx.currentTime, playOffset, remainingSec);
            this.scheduledNodes.set(segKey, {
              sourceNode,
              gainNode,
              segStart,
              segEnd: hardCappedEnd,
              startedAtCtx: ctx.currentTime - (elapsedSec / effectiveRate),
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
