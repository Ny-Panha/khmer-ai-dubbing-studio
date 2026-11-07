/**
 * DragonDub AI - Bounded Audio Auto-Recovery Controller (BUG-013)
 *
 * Prevents infinite recovery retry loops when media files are missing (404/410),
 * access is forbidden (401/403), or transient server/network errors occur.
 */

export const MAX_RECOVERY_ATTEMPTS = 2;

export const ERROR_MESSAGES = {
  NOT_FOUND: 'សំឡេងអត្ថាធិប្បាយមិនទាន់មាន ឬបាត់បង់។ សូមបង្កើតសំឡេងឡើងវិញ។',
  ACCESS_DENIED: 'មិនមានសិទ្ធិចូលប្រើសំឡេងអត្ថាធិប្បាយនេះទេ (Access Denied)។',
  SERVER_ERROR: 'ម៉ាស៊ីនមេមានបញ្ហាបណ្ដោះអាសន្ន។ មិនអាចទាញយកសំឡេងបានទេ។',
  DECODE_ERROR: 'ទម្រង់សំឡេងមិនត្រឹមត្រូវ ឬខូចខាត (Decode Error)។',
  NETWORK_ERROR: 'បណ្ដាញមានបញ្ហាបណ្ដោះអាសន្នក្នុងការទាញយកសំឡេង។',
  GENERIC_ERROR: 'មិនអាចចាក់សំឡេងអត្ថាធិប្បាយបានទេ។ សូមបង្កើតសំឡេងឡើងវិញ។',
};

/**
 * Classifies an HTTP status code or network exception into a recovery strategy.
 *
 * @param {number|null} status - HTTP status code (if available)
 * @param {Error|null} error - Network error object
 * @returns {{ shouldRetry: boolean, isTerminal: boolean, reason: string, message: string }}
 */
export function classifyAudioError(status, error = null) {
  // 1. Missing Media (Terminal): 404 Not Found, 410 Gone
  if (status === 404 || status === 410) {
    return {
      shouldRetry: false,
      isTerminal: true,
      reason: 'NOT_FOUND',
      message: ERROR_MESSAGES.NOT_FOUND,
    };
  }

  // 2. Access Denied (Terminal): 401 Unauthorized, 403 Forbidden
  if (status === 401 || status === 403) {
    return {
      shouldRetry: false,
      isTerminal: true,
      reason: 'ACCESS_DENIED',
      message: ERROR_MESSAGES.ACCESS_DENIED,
    };
  }

  // 3. Rate-limited / Server Error (Transient): 429, 500, 502, 503, 504
  if (status === 429 || (status >= 500 && status < 600)) {
    return {
      shouldRetry: true,
      isTerminal: false,
      reason: 'SERVER_ERROR',
      message: ERROR_MESSAGES.SERVER_ERROR,
    };
  }

  // 4. Successful HTTP status (200 OK) but audio element error -> Decode error
  if (status >= 200 && status < 300) {
    return {
      shouldRetry: true,
      isTerminal: false,
      reason: 'DECODE_ERROR',
      message: ERROR_MESSAGES.DECODE_ERROR,
    };
  }

  // 5. Network / timeout error
  if (error) {
    if (error.name === 'AbortError') {
      return {
        shouldRetry: false,
        isTerminal: false,
        reason: 'ABORTED',
        message: '',
      };
    }
    return {
      shouldRetry: true,
      isTerminal: false,
      reason: 'NETWORK_ERROR',
      message: ERROR_MESSAGES.NETWORK_ERROR,
    };
  }

  // Default fallback
  return {
    shouldRetry: true,
    isTerminal: false,
    reason: 'GENERIC_ERROR',
    message: ERROR_MESSAGES.GENERIC_ERROR,
  };
}

/**
 * Creates a bounded auto-recovery manager state tracker.
 */
export function createAudioRecoveryManager({
  maxAttempts = MAX_RECOVERY_ATTEMPTS,
  onTerminalError = () => {},
  onRetryScheduled = () => {},
  onSuccess = () => {},
  checkAvailability = null, // Injectable for unit testing
} = {}) {
  let attempts = 0;
  let lastFailedUrl = null;
  let timerId = null;
  let isChecking = false;
  let abortController = null;

  const defaultCheck = async (url, signal) => {
    try {
      const resp = await fetch(url, { method: 'HEAD', signal });
      return { status: resp.status, error: null };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return { status: 0, error: err };
    }
  };

  const checkFn = checkAvailability || defaultCheck;

  const cancelPending = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    isChecking = false;
  };

  const reset = (newUrl = null) => {
    cancelPending();
    attempts = 0;
    lastFailedUrl = null;
    onSuccess();
  };

  const handleAudioSuccess = () => {
    reset();
  };

  const handleError = async (audioUrl, audioElement = null) => {
    if (!audioUrl) return;

    // Prevent concurrent check for same URL
    if (isChecking && lastFailedUrl === audioUrl) {
      return;
    }

    // If max attempts already exceeded for this URL
    if (attempts >= maxAttempts && lastFailedUrl === audioUrl) {
      onTerminalError({
        url: audioUrl,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        message: ERROR_MESSAGES.NOT_FOUND,
      });
      return;
    }

    cancelPending();
    isChecking = true;
    lastFailedUrl = audioUrl;

    abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

    try {
      const { status, error } = await checkFn(audioUrl, abortController?.signal);
      const classification = classifyAudioError(status, error);

      if (classification.isTerminal || !classification.shouldRetry) {
        attempts = maxAttempts; // Lock out further attempts
        onTerminalError({
          url: audioUrl,
          status,
          reason: classification.reason,
          message: classification.message,
        });
        return;
      }

      // Check retry limits
      if (attempts >= maxAttempts) {
        onTerminalError({
          url: audioUrl,
          status,
          reason: 'MAX_ATTEMPTS_EXCEEDED',
          message: classification.message || ERROR_MESSAGES.NOT_FOUND,
        });
        return;
      }

      attempts += 1;
      const delayMs = attempts * 1000; // Exponential backoff (1s, 2s)

      onRetryScheduled({
        url: audioUrl,
        attempt: attempts,
        maxAttempts,
        delayMs,
        reason: classification.reason,
      });

      timerId = setTimeout(() => {
        timerId = null;
        if (audioElement && typeof audioElement.load === 'function') {
          try {
            audioElement.load();
          } catch (_) {}
        }
      }, delayMs);
    } catch (err) {
      if (err.name === 'AbortError') return; // Cancelled
      if (attempts >= maxAttempts) {
        onTerminalError({
          url: audioUrl,
          reason: 'MAX_ATTEMPTS_EXCEEDED',
          message: ERROR_MESSAGES.NETWORK_ERROR,
        });
        return;
      }
      attempts += 1;
      const delayMs = attempts * 1000;
      timerId = setTimeout(() => {
        timerId = null;
        if (audioElement && typeof audioElement.load === 'function') {
          try {
            audioElement.load();
          } catch (_) {}
        }
      }, delayMs);
    } finally {
      isChecking = false;
    }
  };

  return {
    handleError,
    handleAudioSuccess,
    reset,
    cancelPending,
    getAttempts: () => attempts,
    getLastFailedUrl: () => lastFailedUrl,
    isChecking: () => isChecking,
    hasPendingTimer: () => timerId !== null,
  };
}
