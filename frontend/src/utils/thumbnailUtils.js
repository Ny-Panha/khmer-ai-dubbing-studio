/**
 * Video Thumbnail Extractor for CapCut-Style Filmstrips & Media Library
 * Extracts lightweight keyframe snapshots from video using HTML5 Video + Canvas
 */

export function generateVideoThumbnails(videoUrl, duration = 30, count = null, signal) {
  return new Promise((resolve) => {
    if (!videoUrl || signal?.aborted) {
      resolve([]);
      return;
    }

    const dur = duration > 0 ? duration : 30;
    const targetCount = typeof count === 'number' && count > 0
      ? count
      : Math.min(8, Math.max(5, Math.floor(dur / 45)));

    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'metadata';

    const thumbs = [];
    const times = [];
    const step = dur / (targetCount + 1);
    for (let i = 1; i <= targetCount; i++) {
      times.push(Math.min(dur - 0.2, Math.max(0.2, parseFloat((i * step).toFixed(2)))));
    }

    let currentIdx = 0;
    let seekTimer = null;
    let startDelayTimer = null;
    let deferTimer = null;
    let finished = false;
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 68;
    const ctx = canvas.getContext('2d');

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(overallTimeout);
      signal?.removeEventListener('abort', finish);
      if (seekTimer) clearTimeout(seekTimer);
      if (startDelayTimer) clearTimeout(startDelayTimer);
      if (deferTimer) clearTimeout(deferTimer);
      v.onseeked = null;
      v.onerror = null;
      v.onloadeddata = null;
      v.onloadedmetadata = null;
      v.removeAttribute('src');
      v.load();
      resolve(thumbs);
    };

    const overallTimeout = setTimeout(finish, 12000);
    signal?.addEventListener('abort', finish, { once: true });

    const isMainPlayerBusy = () => {
      if (typeof document === 'undefined') return false;
      if (typeof window !== 'undefined' && (window.__timelineIsActiveScrubbing || window.__timelineIsDragging || window.__timelineIsPlaying)) {
        return true;
      }
      const mainVideo = document.querySelector('.player-stage-viewport video');
      return Boolean(mainVideo && (mainVideo.seeking || !mainVideo.paused || mainVideo.readyState < 3));
    };

    const seekNext = () => {
      if (finished) return;
      if (currentIdx >= times.length) {
        clearTimeout(overallTimeout);
        finish();
        return;
      }
      if (isMainPlayerBusy()) {
        if (deferTimer) clearTimeout(deferTimer);
        deferTimer = setTimeout(seekNext, 350);
        return;
      }
      if (seekTimer) clearTimeout(seekTimer);
      // If a single seek hangs for more than 900ms, skip to next timestamp
      seekTimer = setTimeout(() => {
        currentIdx++;
        seekNext();
      }, 900);
      v.currentTime = times[currentIdx];
    };

    v.onloadedmetadata = () => {
      seekNext();
    };

    v.onseeked = () => {
      if (seekTimer) clearTimeout(seekTimer);
      try {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        thumbs.push(canvas.toDataURL('image/jpeg', 0.55));
      } catch {
        // Fallback if drawImage fails
      }
      currentIdx++;
      seekNext();
    };

    v.onerror = () => {
      clearTimeout(overallTimeout);
      finish();
    };

    // Defer hidden filmstrip loading briefly so the main <video> player gets full HTTP/1.1 & decoder priority on load
    startDelayTimer = setTimeout(() => {
      if (!finished) {
        v.src = videoUrl;
      }
    }, 1200);
  });
}
