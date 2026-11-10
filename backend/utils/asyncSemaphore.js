/**
 * Bounded Async Semaphore Utility
 * Prevents CPU/RAM thrashing by capping simultaneous heavy subprocess executions
 * (FFmpeg frame extraction/pixel-diff and Python Sherpa-ONNX ASR workers) process-wide.
 */

function createAbortError(message = 'Operation was aborted') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function clampConcurrency(rawVal, fallback = 2, min = 1, max = 4) {
  const parsed = Number(rawVal);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function createSemaphore(maxConcurrency = 2, name = 'semaphore') {
  const limit = clampConcurrency(maxConcurrency, 2, 1, 8);
  let active = 0;
  const waiters = [];

  const acquire = ({ signal = null } = {}) => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(`[${name}] Aborted before acquiring semaphore permit`));
    }

    if (active < limit) {
      active++;
      let released = false;
      return Promise.resolve(() => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        while (waiters.length > 0 && active < limit) {
          const next = waiters.shift();
          if (next && !next.settled) {
            next.grant();
          }
        }
      });
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        settled: false,
        onAbort: null,
        grant() {
          if (this.settled) return;
          this.settled = true;
          if (signal && this.onAbort) {
            signal.removeEventListener('abort', this.onAbort);
          }
          active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active = Math.max(0, active - 1);
            while (waiters.length > 0 && active < limit) {
              const next = waiters.shift();
              if (next && !next.settled) {
                next.grant();
              }
            }
          });
        },
        abort() {
          if (this.settled) return;
          this.settled = true;
          const idx = waiters.indexOf(this);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(createAbortError(`[${name}] Aborted while waiting for semaphore permit`));
        },
      };

      if (signal) {
        waiter.onAbort = () => waiter.abort();
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }

      waiters.push(waiter);
    });
  };

  const run = async (fn, { signal = null } = {}) => {
    const release = await acquire({ signal });
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const getStats = () => ({
    name,
    limit,
    active,
    queued: waiters.length,
  });

  return {
    limit,
    acquire,
    run,
    getStats,
  };
}

const ffmpegHeavyLimit = clampConcurrency(process.env.DRAGONDUB_MAX_HEAVY_FFMPEG, 2, 1, 4);
const senseVoiceLimit = clampConcurrency(process.env.DRAGONDUB_MAX_SENSEVOICE_WORKERS, 2, 1, 4);

const ffmpegHeavySemaphore = createSemaphore(ffmpegHeavyLimit, 'ffmpeg-heavy');
const senseVoiceSemaphore = createSemaphore(senseVoiceLimit, 'sense-voice-asr');

module.exports = {
  createSemaphore,
  createAbortError,
  clampConcurrency,
  ffmpegHeavySemaphore,
  senseVoiceSemaphore,
};

