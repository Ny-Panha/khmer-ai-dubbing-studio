/**
 * Video Thumbnail Extractor for CapCut-Style Filmstrips & Media Library
 * Extracts lightweight keyframe snapshots from video using HTML5 Video + Canvas
 */

export function generateVideoThumbnails(videoUrl, duration = 30, count = null) {
  return new Promise((resolve) => {
    if (!videoUrl) {
      resolve([]);
      return;
    }

    const dur = duration > 0 ? duration : 30;
    const targetCount = typeof count === 'number' && count > 0
      ? count
      : Math.min(12, Math.max(6, Math.floor(dur / 25)));

    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.src = videoUrl;
    v.muted = true;
    v.preload = 'auto';

    const thumbs = [];
    const times = [];
    const step = dur / (targetCount + 1);
    for (let i = 1; i <= targetCount; i++) {
      times.push(Math.min(dur - 0.2, Math.max(0.2, parseFloat((i * step).toFixed(2)))));
    }

    let currentIdx = 0;
    let seekTimer = null;
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 68;
    const ctx = canvas.getContext('2d');

    const finish = () => {
      if (seekTimer) clearTimeout(seekTimer);
      v.onseeked = null;
      v.onerror = null;
      v.onloadeddata = null;
      v.removeAttribute('src');
      v.load();
      resolve(thumbs);
    };

    const overallTimeout = setTimeout(finish, 8000);

    const seekNext = () => {
      if (currentIdx >= times.length) {
        clearTimeout(overallTimeout);
        finish();
        return;
      }
      if (seekTimer) clearTimeout(seekTimer);
      // If a single seek hangs for more than 700ms, skip to next timestamp
      seekTimer = setTimeout(() => {
        currentIdx++;
        seekNext();
      }, 700);
      v.currentTime = times[currentIdx];
    };

    v.onloadeddata = () => {
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
      clearTimeout(timeoutId);
      finish();
    };
  });
}
