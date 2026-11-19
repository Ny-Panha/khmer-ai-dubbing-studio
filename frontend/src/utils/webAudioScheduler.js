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
    this.inflight = new Map(); // url -> Promise<AudioBuffer>
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

    const promise = (async () => {
      try {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading ${url}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

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
        this.inflight.delete(url);
      }
    })();

    this.inflight.set(url, promise);
    return promise;
  }

  clear() {
    this.cache.clear();
    this.inflight.clear();
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
    const target = isMuted ? 0 : Math.min(1.0, Math.max(0, Number(volume) || 0));
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
      .filter(({ s, rawUrl }) => rawUrl && s >= (now - 1) && s <= (now + lookaheadSec))
      .slice(0, 8);

    for (const item of upcoming) {
      if (!this.lruCache.has(item.rawUrl)) {
        this.lruCache.loadAndDecode(item.rawUrl, ctx);
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
    const targetVol = isKhmerMuted ? 0 : Math.min(1.0, Math.max(0, khmerVolume));

    // Cleanup finished segments
    for (const [key, item] of this.scheduledNodes.entries()) {
      // If timeline moved past segment end or backwards before segment start by > 0.3s (seeked)
      if (timelineNow > (item.segEnd + 0.15) || timelineNow < (item.segStart - 0.5)) {
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

      // Overlap ducking detection (50% ducking if overlapped by next segment)
      let isOverlapped = false;
      const scanLimit = Math.min(segments.length, idx + 4);
      for (let nextIdx = idx + 1; nextIdx < scanLimit; nextIdx++) {
        const nextSeg = segments[nextIdx];
        if (nextSeg.muted || nextSeg.isMuted) continue;
        const nextStart = (typeof nextSeg.audioStartSec === 'number' && !isNaN(nextSeg.audioStartSec))
          ? nextSeg.audioStartSec
          : (nextSeg.startSec || 0);
        if (nextStart > effectiveSegEnd) break;
        if (nextStart > segStart && nextStart < effectiveSegEnd && timelineNow >= (nextStart - 0.04)) {
          isOverlapped = true;
          break;
        }
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
        if (item.gainNode.gain.value !== effectiveVol) {
          item.gainNode.gain.setValueAtTime(effectiveVol, ctx.currentTime);
        }
        if (item.sourceNode.playbackRate.value !== effectiveRate) {
          item.sourceNode.playbackRate.setValueAtTime(effectiveRate, ctx.currentTime);
        }

        // Measure audio drift relative to video playhead
        if (timelineNow >= segStart && timelineNow < effectiveSegEnd) {
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
          const durationLimit = Math.min(audioBuffer.duration - baseOffset, effectiveSegEnd - segStart);
          if (durationLimit > 0.02) {
            sourceNode.start(startAtCtx, baseOffset, durationLimit);
            this.scheduledNodes.set(segKey, {
              sourceNode,
              gainNode,
              segStart,
              segEnd: effectiveSegEnd,
              startedAtCtx: startAtCtx,
              url: rawUrl,
            });
          }
        } else {
          // Segment should be actively playing right now
          const elapsedSec = (timelineNow - segStart);
          const playOffset = baseOffset + elapsedSec;
          const remainingSec = Math.min(audioBuffer.duration - playOffset, effectiveSegEnd - timelineNow);

          if (playOffset < audioBuffer.duration && remainingSec > 0.02) {
            sourceNode.start(ctx.currentTime, playOffset, remainingSec);
            this.scheduledNodes.set(segKey, {
              sourceNode,
              gainNode,
              segStart,
              segEnd: effectiveSegEnd,
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
