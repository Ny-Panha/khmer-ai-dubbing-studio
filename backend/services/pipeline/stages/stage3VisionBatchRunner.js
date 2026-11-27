const fs = require('fs');
const path = require('path');
const { formatSecondsToTimecode } = require('../pipelineTypes');
const { createAbortError } = require('../../../utils/asyncSemaphore');
const { VISION_CASCADE_MODELS } = require('../../geminiModelCatalog');
const { geminiQuotaTracker } = require('../../geminiQuotaTracker');

function sleepOrAbort(ms, signal) {
  if (!signal) {
    return new Promise((r) => setTimeout(r, ms));
  }
  if (signal.aborted) {
    return Promise.reject(createAbortError('Stage 3 OCR aborted'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError('Stage 3 OCR aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const defaultCacheDir = path.resolve(__dirname, '../../../uploads/cache');

function getOcrCachePath(videoPath, startOffsetSec = 0, durationSec = 0, modelName = '', cacheDir = defaultCacheDir, ocrEngineMode = '') {
  try {
    // កែពី ../../../../uploads/cache មកជា ../../../uploads/cache ឱ្យត្រូវជាមួយ Stage 1, 4 និង 9
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const stat = fs.statSync(videoPath);
    const safeBase = path.basename(videoPath).replace(/[^a-zA-Z0-9_-]/g, '_');
    const signature = `${stat.size}_${Math.round(stat.mtimeMs)}`;
    const modeTag = ocrEngineMode ? `_${String(ocrEngineMode).replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
    return path.join(cacheDir, `ocr_${safeBase}_${signature}_${Math.round(startOffsetSec)}_${Math.round(durationSec)}_${modelName}${modeTag}.json`);
  } catch (_) {
    return null;
  }
}

function getOcrCheckpointPath(videoPath, startOffsetSec = 0, durationSec = 0, cacheDir = defaultCacheDir) {
  try {
    const checkpointDir = path.join(cacheDir, 'ocr_checkpoints');
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }
    const stat = fs.statSync(videoPath);
    const safeBase = path.basename(videoPath).replace(/[^a-zA-Z0-9_-]/g, '_');
    const signature = `${stat.size}_${Math.round(stat.mtimeMs)}`;
    return path.join(checkpointDir, `ocr_ckpt_${safeBase}_${signature}_${Math.round(startOffsetSec)}_${Math.round(durationSec)}.json`);
  } catch (_) {
    return null;
  }
}

function saveOcrCheckpoint(checkpointPath, data) {
  if (!checkpointPath || !data) return false;
  const tempPath = `${checkpointPath}.tmp.${Date.now()}_${process.pid}`;
  try {
    const dir = path.dirname(checkpointPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, checkpointPath);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    console.warn('[Stage 3 OCR] Failed to persist OCR checkpoint atomically:', err.message);
    return false;
  }
}

function loadOcrCheckpoint(checkpointPath) {
  if (!checkpointPath || !fs.existsSync(checkpointPath)) return null;
  try {
    const content = fs.readFileSync(checkpointPath, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.rawObservations)) {
      return parsed;
    }
  } catch (err) {
    console.warn('[Stage 3 OCR] Failed to load checkpoint:', err.message);
  }
  return null;
}

function needsIndependentRead(obs) {
  return !obs.userOverridden && (obs.isDeduped || obs.ocrEngine === 'rapidocr-local');
}

const HANZI_CHAR_REGEX = /[\u3400-\u4dbf\u4e00-\u9fa5]/;

function hasChineseHanzi(str = '') {
  return HANZI_CHAR_REGEX.test(String(str || ''));
}

function extractCueChunkOrigin(sourceCueId = '') {
  const m = String(sourceCueId || '').trim().match(/^cue_(\d+)_\d+_\d+$/);
  return m ? m[1] : null;
}

function isCrossChunkOriginPair(cueA, cueB) {
  const idA = String(cueA?.sourceCueId || '').trim();
  const idB = String(cueB?.sourceCueId || '').trim();
  if (!idA || !idB || idA === idB) return false;
  const originA = extractCueChunkOrigin(idA);
  const originB = extractCueChunkOrigin(idB);
  return Boolean(originA !== null && originB !== null && originA !== originB);
}

function normalizeChineseChars(str = '') {
  return String(str)
    .replace(/[\s\r\n\t,，.。!！?？:：;；"'"'《》\(\)（）—\-_·、]/g, '')
    .trim();
}

const ONSCREEN_TIME_CARD_PREFIX_REGEX = /^(?:几个月前|数月前|几年前|数年前|一年前|两年前|三年前|半年前|几天前|数日前|三日前|三天前|三天后|几日后|数日后|片刻后|半晌后|半个时辰后|一炷香后|次日|翌日|多年后|数年后|几月后|半年后|数月后|与此同时|另一边)/;
const ONSCREEN_TIME_CARD_EXACT_REGEX = /^(?:几个月前|数月前|几年前|数年前|一年前|两年前|三年前|半年前|几天前|数日前|三日前|三天前|三天后|几日后|数日后|片刻后|半晌后|半个时辰后|一炷香后|次日|翌日|多年后|数年后|几月后|半年后|数月后|与此同时|另一边)$/;

/**
 * Strip decorative brackets, music notes (♪/♫), and watermark noise from raw OCR subtitle text.
 * If OCR joined a side/corner time-card line with a dialogue line via newline (e.g. "几个月前\n再快一点"),
 * strips the time-card line and preserves only the spoken dialogue line.
 */
function stripDecorativeSubtitleNoise(str = '') {
  let cleaned = String(str || '')
    .replace(/[♪♫♬♩]+/g, '')
    .trim();

  if (cleaned.includes('\n')) {
    const parts = cleaned.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const nonTimeCardParts = parts.filter((p) => !ONSCREEN_TIME_CARD_EXACT_REGEX.test(p));
      if (nonTimeCardParts.length > 0 && nonTimeCardParts.length < parts.length) {
        cleaned = nonTimeCardParts.join('');
      }
    }
  }

  cleaned = cleaned
    .replace(/^《第[0-9一二三四五六七八九十百千万]+[集话章]》$/, '')
    .replace(/^[【〖『\[]([^】〗』\]]+)[】〗』\]]$/, '$1')
    .trim();
  return cleaned;
}

/**
 * Removes persistent on-screen time-card overlay prefixes (e.g. "几个月前") that OCR
 * accidentally glued onto 2+ consecutive spoken dialogue cues (e.g. "几个月前再快一点"
 * followed by "几个月前李天维首座正在讲道呢").
 * Never strips single-cue spoken dialogue, preserving natural speech like "一年前我见过他".
 */
function stripRepeatedLeadingTimeCardPrefix(cues = []) {
  if (!Array.isArray(cues) || cues.length < 2) return cues;
  const result = cues.map((c) => ({ ...c }));

  let i = 0;
  while (i < result.length) {
    const textI = String(result[i]?.originalChineseText || result[i]?.chineseText || result[i]?.textZh || '').trim();
    const matchI = textI.match(ONSCREEN_TIME_CARD_PREFIX_REGEX);
    if (!matchI) {
      i++;
      continue;
    }
    const prefix = matchI[0];
    const remI = textI.slice(prefix.length).replace(/^[\s:：,，\-—]+/, '').trim();
    if (remI.length < 2) {
      i++;
      continue;
    }

    let j = i + 1;
    while (j < result.length) {
      const prev = result[j - 1];
      const curr = result[j];
      const gap = (Number(curr.startSec) || 0) - (Number(prev.endSec) || 0);
      const textJ = String(curr?.originalChineseText || curr?.chineseText || curr?.textZh || '').trim();
      const remJ = textJ.startsWith(prefix)
        ? textJ.slice(prefix.length).replace(/^[\s:：,，\-—]+/, '').trim()
        : '';
      if (gap <= 2.0 && textJ.startsWith(prefix) && remJ.length >= 2) {
        j++;
      } else {
        break;
      }
    }

    if (j - i >= 2) {
      for (let k = i; k < j; k++) {
        const orig = String(result[k]?.originalChineseText || result[k]?.chineseText || result[k]?.textZh || '').trim();
        const stripped = orig.slice(prefix.length).replace(/^[\s:：,，\-—]+/, '').trim();
        if (stripped.length >= 2) {
          result[k].textZh = stripped;
          result[k].chineseText = stripped;
          result[k].originalChineseText = stripped;
          if (typeof result[k].ocrSubtitleText === 'string' && result[k].ocrSubtitleText.startsWith(prefix)) {
            result[k].ocrSubtitleText = stripped;
          }
        }
      }
    }
    i = j;
  }

  return result;
}

function sameSubtitleText(a, b) {
  const left = normalizeChineseChars(a);
  return left.length > 0 && left === normalizeChineseChars(b);
}

function isExactChineseSubtitleMatch(a = '', b = '') {
  const normA = normalizeChineseChars(a);
  const normB = normalizeChineseChars(b);
  return normA.length > 0 && normA === normB;
}

function computeNormalizedLevenshtein(s1 = '', s2 = '') {
  if (s1 === s2) return 0;
  const m = s1.length;
  const n = s2.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

function areChineseTextsEquivalent(a = '', b = '') {
  const normA = normalizeChineseChars(a);
  const normB = normalizeChineseChars(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // For Khmer or non-Chinese scripts, equivalence is exact normalized equality (prevents false phonetic character overlap)
  const hasChinese = /[\u4e00-\u9fa5]/.test(normA) && /[\u4e00-\u9fa5]/.test(normB);
  if (!hasChinese) {
    return false;
  }

  // Only allow ordered edit-distance tolerance for longer lines (>= 6 chars) to absorb minor ASR/OCR homophone noise
  // without merging short lines or 1-char negation differences (e.g. "我相信你" vs "我不相信你", "凶兆" vs "有一些凶兆").
  const minL = Math.min(normA.length, normB.length);
  const maxL = Math.max(normA.length, normB.length);
  if (minL >= 6 && minL / maxL >= 0.75) {
    const dist = computeNormalizedLevenshtein(normA, normB);
    if (1 - dist / maxL >= 0.78) return true;
  }
  return false;
}

const CASCADE_VISION_MODELS = VISION_CASCADE_MODELS;
const visionModelCooldownMap = new Map();

/**
 * Distinguishes HTTP 429, 503, 504, network failures, true client timeouts, and auth errors.
 */
function classifyVisionError(err) {
  if (!err) return { type: 'UNKNOWN', isRetryable: false, status: 0, message: '' };
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
    return { type: 'ABORT', isRetryable: false, status: 0, message: err.message || 'Aborted' };
  }
  const status = Number(err.status || err.statusCode || err.code) || 0;
  const rawMsg = String(err.message || err.toString() || '');
  const msgUpper = rawMsg.toUpperCase();

  // True client-side deadline or timeout
  if (
    msgUpper.includes('TIMEOUT: GEMINI VISION OCR') ||
    err.name === 'TimeoutError' ||
    err.code === 'ETIMEDOUT'
  ) {
    return { type: 'CLIENT_TIMEOUT', isRetryable: true, status: 504, message: rawMsg };
  }
  // Server-side gateway timeout
  if (status === 504 || msgUpper.includes('504') || msgUpper.includes('GATEWAY TIMEOUT') || msgUpper.includes('DEADLINE_EXCEEDED')) {
    return { type: 'SERVER_TIMEOUT', isRetryable: true, status: 504, message: rawMsg };
  }
  // Service Unavailable / High demand / Overloaded
  if (status === 503 || msgUpper.includes('503') || msgUpper.includes('UNAVAILABLE') || msgUpper.includes('HIGH DEMAND') || msgUpper.includes('OVERLOADED')) {
    return { type: 'SERVICE_UNAVAILABLE', isRetryable: true, status: 503, message: rawMsg };
  }
  // Rate limit / Resource exhausted
  if (
    status === 429 ||
    msgUpper.includes('429') ||
    msgUpper.includes('RESOURCE_EXHAUSTED') ||
    msgUpper.includes('RESOURCE HAS BEEN EXHAUSTED') ||
    msgUpper.includes('RATE LIMIT') ||
    msgUpper.includes('TOO MANY REQUESTS') ||
    msgUpper.includes('CHECK QUOTA')
  ) {
    return { type: 'RATE_LIMIT', isRetryable: true, status: 429, message: rawMsg };
  }
  // Network / Socket errors
  if (
    msgUpper.includes('ECONNRESET') ||
    msgUpper.includes('ENOTFOUND') ||
    msgUpper.includes('EAI_AGAIN') ||
    msgUpper.includes('FETCH FAILED') ||
    msgUpper.includes('NETWORK')
  ) {
    return { type: 'NETWORK_ERROR', isRetryable: true, status: 0, message: rawMsg };
  }
  // Auth errors
  if (status === 401 || status === 403 || msgUpper.includes('UNAUTHENTICATED') || msgUpper.includes('PERMISSION_DENIED')) {
    return { type: 'AUTH_ERROR', isRetryable: false, status, message: rawMsg };
  }

  return { type: 'OTHER', isRetryable: false, status, message: rawMsg };
}

/**
 * Respect server-provided Retry-After / RetryInfo when available.
 */
function extractRetryDelayMs(err, fallbackMs = 1500) {
  if (!err) return fallbackMs;
  const headerVal = err.response?.headers?.get?.('retry-after') || err.headers?.['retry-after'];
  if (headerVal) {
    const parsed = Number(headerVal);
    if (!isNaN(parsed) && parsed > 0) {
      return Math.min(30000, Math.max(1000, Math.ceil(parsed * 1000)));
    }
  }
  const details = err.statusDetails || err.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && (d['@type']?.includes('RetryInfo') || d.retryDelay)) {
        const sec = typeof d.retryDelay === 'string' ? parseFloat(d.retryDelay) : Number(d.retryDelay?.seconds || 0);
        if (!isNaN(sec) && sec > 0) {
          return Math.min(30000, Math.max(1000, Math.ceil(sec * 1000)));
        }
      }
    }
  }
  const match = String(err.message || '').match(/retry\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*s/i) ||
    String(err.message || '').match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (match) {
    const sec = parseFloat(match[1]);
    if (!isNaN(sec) && sec > 0) {
      return Math.min(30000, Math.max(1000, Math.ceil(sec * 1000)));
    }
  }
  return fallbackMs;
}

/**
 * Checks if an OCR vision error is retryable / temporary (429, 503, 504 Deadline Exceeded, timeouts).
 */
function isRetryableVisionError(err) {
  const classified = classifyVisionError(err);
  return classified.isRetryable;
}

function isTimeoutOrOverloadError(err) {
  const classified = classifyVisionError(err);
  return classified.type === 'SERVICE_UNAVAILABLE' ||
    classified.type === 'SERVER_TIMEOUT' ||
    classified.type === 'CLIENT_TIMEOUT' ||
    classified.type === 'NETWORK_ERROR';
}

let lastSuccessfulVisionModel = null;

/**
 * Helper: Call Gemini Vision with bounded retry/backoff, model cooldown handling,
 * and cancellation support for client timeouts and user aborts.
 * Point 1 & Point 2: Uses last successful model first, fast-splits large batches on timeout (<=16s),
 * and limits retries on cascade fallback models.
 */
async function callGeminiVisionWithRetry(
  aiClient,
  modelName,
  contents,
  maxRetries = 2,
  signal = null,
  onModelSuccess = null,
  batchMeta = {}
) {
  const isLastHealthy = lastSuccessfulVisionModel && (visionModelCooldownMap.get(lastSuccessfulVisionModel) || 0) <= Date.now();
  const preferred = isLastHealthy
    ? lastSuccessfulVisionModel
    : (modelName || geminiQuotaTracker.getPreferredPrimaryModel(CASCADE_VISION_MODELS[0]));
  const otherModels = CASCADE_VISION_MODELS.filter((m) => m !== preferred);
  const poolKeys = Array.isArray(aiClient?.pool?.keys) ? aiClient.pool.keys : [];
  const allCandidateModels = [preferred, ...otherModels];
  const now = Date.now();

  const prioritized = poolKeys.length > 0
    ? geminiQuotaTracker.prioritizeAvailableModels(allCandidateModels, poolKeys, now)
    : allCandidateModels;

  const topCandidates = prioritized.slice(0, 4);
  // Filter models not currently in cooldown
  let candidateList = topCandidates.filter((m) => (visionModelCooldownMap.get(m) || 0) <= Date.now());

  const telemetry = batchMeta?.telemetry || null;

  // If all models are in temporary cooldown, wait for shortest cooldown (Requirement 14)
  if (candidateList.length === 0 && topCandidates.length > 0) {
    const earliestExpiry = Math.min(...topCandidates.map((m) => visionModelCooldownMap.get(m) || 0));
    const waitMs = Math.min(10000, Math.max(1000, earliestExpiry - Date.now()));
    console.warn(`[Stage 3 OCR] ⏳ All cascade models in temporary cooldown. Waiting ${waitMs}ms before retrying...`);
    if (telemetry) telemetry.retrySleepMs = (telemetry.retrySleepMs || 0) + waitMs;
    await sleepOrAbort(waitMs, signal);
    visionModelCooldownMap.delete(preferred);
    candidateList = topCandidates.filter((m) => (visionModelCooldownMap.get(m) || 0) <= Date.now());
    if (candidateList.length === 0) candidateList = [preferred];
  }

  let lastErr = null;
  let classifiedLastErr = null;

  const explicitSize = Number(batchMeta?.batchSize);
  const batchSize = !isNaN(explicitSize) && explicitSize > 0
    ? explicitSize
    : (Array.isArray(contents)
        ? Math.max(1, contents.filter((c) => c && c.inlineData).length || contents.length)
        : 1);
  const fastSplitOnTimeout = Boolean(batchMeta?.fastSplitOnTimeout);

  // Point 1: 16s deadline for normal batches, 12s for sub-batches <= 4 (prevents 25s hangs)
  const timeoutMs = batchSize <= 4 ? 12000 : 16000;

  for (const currentModel of candidateList) {
    let attempt = 0;
    // For fallback models in cascade, limit to 1 attempt to fail fast and trigger batch split
    const modelMaxAttempts = (currentModel === candidateList[0]) ? maxRetries : 1;

    while (attempt < modelMaxAttempts) {
      if (signal?.aborted) {
        throw createAbortError('Stage 3 OCR aborted');
      }

      const abortController = new AbortController();
      let timeoutId = null;

      const onSignalAbort = () => {
        abortController.abort(signal?.reason || createAbortError('Stage 3 OCR aborted'));
      };
      if (signal) {
        signal.addEventListener('abort', onSignalAbort, { once: true });
      }

      timeoutId = setTimeout(() => {
        const tErr = new Error(`Timeout: Gemini Vision OCR on ${currentModel} exceeded ${timeoutMs}ms deadline`);
        tErr.name = 'TimeoutError';
        tErr.code = 'ETIMEDOUT';
        abortController.abort(tErr);
      }, timeoutMs);

      let abortReject;
      const abortPromise = new Promise((_, reject) => { abortReject = reject; });
      const onAbortEvent = () => {
        abortReject(abortController.signal.reason || createAbortError('Stage 3 OCR aborted'));
      };
      abortController.signal.addEventListener('abort', onAbortEvent, { once: true });

      const callStart = Date.now();
      try {
        if (telemetry) telemetry.attempts = (telemetry.attempts || 0) + 1;
        const callPromise = aiClient.models.generateContent({
          model: currentModel,
          contents,
          config: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            abortSignal: abortController.signal,
          },
        });

        const resp = await Promise.race([callPromise, abortPromise]);
        if (telemetry) {
          telemetry.apiTotalMs = (telemetry.apiTotalMs || 0) + (Date.now() - callStart);
          telemetry.successfulCalls = (telemetry.successfulCalls || 0) + 1;
          const um = resp?.usageMetadata || resp?.response?.usageMetadata || null;
          if (um) {
            telemetry.promptTokens = (telemetry.promptTokens || 0) + (Number(um.promptTokenCount ?? um.inputTokens ?? 0) || 0);
            telemetry.outputTokens = (telemetry.outputTokens || 0) + (Number(um.candidatesTokenCount ?? um.outputTokens ?? 0) || 0);
            telemetry.totalTokens = (telemetry.totalTokens || 0) + (Number(um.totalTokenCount ?? 0) || 0);
          }
        }
        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', onAbortEvent);
        if (signal) signal.removeEventListener('abort', onSignalAbort);

        // Success: record model as lastSuccessfulVisionModel & clear cooldown
        lastSuccessfulVisionModel = currentModel;
        visionModelCooldownMap.delete(currentModel);
        try {
          geminiQuotaTracker.recordModelProbeStatus(currentModel, { statusCode: 200, latencyMs: 1000 });
        } catch (_) {}

        if (typeof onModelSuccess === 'function') {
          onModelSuccess(currentModel);
        }
        return resp;
      } catch (err) {
        if (telemetry) telemetry.apiTotalMs = (telemetry.apiTotalMs || 0) + (Date.now() - callStart);
        if (timeoutId) clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', onAbortEvent);
        if (signal) signal.removeEventListener('abort', onSignalAbort);

        if (signal?.aborted || err?.name === 'AbortError' || abortController.signal?.reason?.name === 'AbortError') {
          throw createAbortError('Stage 3 OCR aborted');
        }

        lastErr = err;
        attempt++;
        const classified = classifyVisionError(err);
        classifiedLastErr = classified;

        if (!classified.isRetryable) {
          throw err;
        }

        // Point 2: Fast Batch Splitting on Timeout:
        // If a multi-frame batch (> 4 frames) times out, don't waste 200s cascading through all models!
        // Immediately throw so the scheduler fast-splits the batch into smaller halves (8+7).
        if (fastSplitOnTimeout && batchSize > 4 && (classified.type === 'CLIENT_TIMEOUT' || classified.type === 'SERVER_TIMEOUT')) {
          console.warn(`[Stage 3 OCR] ⚡ Batch of ${batchSize} frames timed out on ${currentModel} (${timeoutMs}ms). Fast-splitting batch into smaller halves...`);
          const splitErr = new Error(`Batch timeout on ${currentModel} (${batchSize} frames). Fast-splitting batch.`);
          splitErr.name = 'TimeoutError';
          splitErr.code = 'ERR_BATCH_TIMEOUT';
          splitErr.fastSplit = true;
          splitErr.status = 504;
          throw splitErr;
        }

        const serverRetryDelay = extractRetryDelayMs(err, Math.min(2500, 1000 * Math.pow(1.5, attempt)));

        if (attempt < modelMaxAttempts) {
          console.warn(`[Stage 3 OCR] Model ${currentModel} hit ${classified.type} (${err.message}). Retrying in ${serverRetryDelay}ms (attempt ${attempt}/${modelMaxAttempts})...`);
          if (telemetry) telemetry.retrySleepMs = (telemetry.retrySleepMs || 0) + serverRetryDelay;
          await sleepOrAbort(serverRetryDelay, signal);
        } else {
          // Model exhausted its attempts -> set cooldown (15s) and cascade to next model
          const modelCdMs = Math.max(15000, serverRetryDelay);
          visionModelCooldownMap.set(currentModel, Date.now() + modelCdMs);
          try {
            geminiQuotaTracker.recordModelProbeStatus(currentModel, {
              statusCode: classified.status || 503,
              message: err.message,
              latencyMs: 15000,
            });
          } catch (_) {}
          console.warn(`[Stage 3 OCR] Model ${currentModel} failed after ${modelMaxAttempts} attempt(s) (${err.message}). Cascading to next candidate model...`);
          break;
        }
      }
    }
  }

  const finalErr = new Error(`All cascade Gemini models exceeded quota/rate limits or timed out (429/503/504): ${lastErr?.message || 'unknown error'}`);
  if (classifiedLastErr) {
    finalErr.classification = classifiedLastErr.type;
    finalErr.statusCode = classifiedLastErr.status;
  }
  throw finalErr;
}

/**
 * Helper: Parse Gemini Vision JSON response and return frame observations.
 * Distinguishes verified empty subtitle frames from failed or missing OCR responses.
 * Never classifies OCR failure or missing frame responses as verified completed frames.
 */
function parseVisionResponseFrames(resp, batchFrames = [], _options = {}) {
  // Never auto-verify omitted/failed frames as completed_empty (Req #11).
  const autoVerifyOmitted = false;
  const rawText = typeof resp?.text === 'function' ? resp.text() : resp?.text;
  const clean = String(rawText || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed = {};
  try {
    parsed = JSON.parse(clean);
  } catch (jsonErr) {
    parsed = { frames: [] };
  }
  const returnedFrames = Array.isArray(parsed?.frames) ? parsed.frames : [];
  const claimedIndices = new Set();

  const batchObservations = [];
  for (let fIdx = 0; fIdx < batchFrames.length; fIdx++) {
    const batchFrame = batchFrames[fIdx];
    const targetTime = parseFloat(Number(batchFrame.timestampSec).toFixed(2));

    // 1. First try matching by timestamp within 0.20s tolerance
    let matchedIdx = -1;
    for (let rIdx = 0; rIdx < returnedFrames.length; rIdx++) {
      if (claimedIndices.has(rIdx)) continue;
      const rf = returnedFrames[rIdx];
      if (rf && typeof rf.timestampSec === 'number' && !isNaN(rf.timestampSec)) {
        if (Math.abs(rf.timestampSec - targetTime) <= 0.20) {
          matchedIdx = rIdx;
          break;
        }
      }
    }

    // 2. Fallback to positional index if not matched by timestamp
    if (matchedIdx === -1 && fIdx < returnedFrames.length && !claimedIndices.has(fIdx)) {
      const cand = returnedFrames[fIdx];
      if (!cand || typeof cand.timestampSec !== 'number' || isNaN(cand.timestampSec) || Math.abs(cand.timestampSec - targetTime) <= 0.50) {
        matchedIdx = fIdx;
      }
    }

    if (matchedIdx !== -1) {
      claimedIndices.add(matchedIdx);
      const f = returnedFrames[matchedIdx] || {};

      const hasExplicitHasText = typeof f.hasText === 'boolean';
      const rawChinese = String(f.textZh || f.chineseText || '').trim();
      const cText = stripDecorativeSubtitleNoise(rawChinese);
      const cleanChineseLen = hasChineseHanzi(cText) ? normalizeChineseChars(cText).length : 0;

      // If entry is empty object or missing explicit boolean / text, treat as missing response (or completed_empty in auto-verify mode)
      if (!hasExplicitHasText && cleanChineseLen === 0 && !f.position && !f.visualGender && !f.speakerGender) {
        if (autoVerifyOmitted) {
          batchObservations.push({
            timestampSec: targetTime,
            reportedSec: targetTime,
            hasText: false,
            textZh: '',
            chineseText: '',
            position: 'bottom_subtitle',
            isSharp: true,
            visualGender: 'unknown',
            speakerGender: 'unknown',
            speakerVisualHint: '',
            deliveryType: 'dialogue',
            genderConfidence: 0.5,
            ocrStatus: 'completed_empty',
            ocrFailed: false,
            isVerified: true,
            isVerifiedEmpty: true,
            reviewNeeded: false,
            uncertainOcr: false,
            failureReason: null,
          });
        } else {
          batchObservations.push({
            timestampSec: targetTime,
            reportedSec: targetTime,
            hasText: false,
            textZh: '',
            chineseText: '',
            position: 'bottom_subtitle',
            isSharp: false,
            visualGender: 'unknown',
            speakerGender: 'UNKNOWN',
            speakerVisualHint: '',
            deliveryType: 'dialogue',
            genderConfidence: 0.5,
            ocrStatus: 'missing',
            ocrFailed: true,
            isVerified: false,
            isVerifiedEmpty: false,
            reviewNeeded: true,
            uncertainOcr: true,
            failureReason: 'Model response omitted evaluation for this frame',
          });
        }
        continue;
      }

      const hasCleanText = Boolean(cleanChineseLen > 0 && f.hasText !== false);
      const isVerifiedEmpty = Boolean(f.hasText === false && cleanChineseLen === 0);
      const tSec = typeof f.timestampSec === 'number' && !isNaN(f.timestampSec)
        ? parseFloat(f.timestampSec.toFixed(2))
        : targetTime;

      const rawGender = String(f.visualGender || f.speakerGender || 'unknown').toLowerCase();
      const validGender = rawGender === 'female' ? 'female' : (rawGender === 'male' ? 'male' : 'unknown');
      const conf = typeof f.genderConfidence === 'number' && !isNaN(f.genderConfidence)
        ? Math.min(1.0, Math.max(0.0, f.genderConfidence))
        : (validGender === 'unknown' ? 0.5 : 0.85);
      const speakerVisualHint = String(f.speakerVisualHint || '').trim();
      const rawDelivery = String(f.deliveryType || 'dialogue').toLowerCase();
      const validDelivery = ['dialogue', 'inner_thought', 'narration'].includes(rawDelivery)
        ? rawDelivery
        : 'dialogue';

      const ocrStatus = hasCleanText ? 'verified_text' : (isVerifiedEmpty ? 'verified_empty' : (hasExplicitHasText ? 'verified_empty' : 'missing'));
      const isVerified = ocrStatus === 'verified_text' || ocrStatus === 'verified_empty';

      batchObservations.push({
        timestampSec: targetTime,
        reportedSec: tSec,
        hasText: hasCleanText,
        textZh: hasCleanText ? cText : '',
        chineseText: hasCleanText ? cText : '',
        position: f.position || 'bottom_subtitle',
        isSharp: f.isSharp !== false,
        visualGender: validGender,
        speakerGender: validGender,
        speakerVisualHint,
        deliveryType: validDelivery,
        genderConfidence: conf,
        ocrStatus,
        isVerified,
        isVerifiedEmpty: ocrStatus === 'verified_empty',
        ocrFailed: !isVerified,
        reviewNeeded: !isVerified || f.isSharp === false,
        uncertainOcr: !isVerified || f.isSharp === false,
        failureReason: isVerified ? null : 'Uncertain or unverified OCR frame',
      });
    } else {
      // Frame omitted by Gemini
      if (autoVerifyOmitted && returnedFrames.length > 0) {
        batchObservations.push({
          timestampSec: targetTime,
          reportedSec: targetTime,
          hasText: false,
          textZh: '',
          chineseText: '',
          position: 'bottom_subtitle',
          isSharp: true,
          visualGender: 'unknown',
          speakerGender: 'unknown',
          speakerVisualHint: '',
          deliveryType: 'dialogue',
          genderConfidence: 0.5,
          ocrStatus: 'completed_empty',
          ocrFailed: false,
          isVerified: true,
          isVerifiedEmpty: true,
          reviewNeeded: false,
          uncertainOcr: false,
          failureReason: null,
        });
      } else {
        batchObservations.push({
          timestampSec: targetTime,
          reportedSec: targetTime,
          hasText: false,
          textZh: '',
          chineseText: '',
          position: 'bottom_subtitle',
          isSharp: false,
          visualGender: 'unknown',
          speakerGender: 'UNKNOWN',
          speakerVisualHint: '',
          deliveryType: 'dialogue',
          genderConfidence: 0.5,
          ocrStatus: 'missing',
          ocrFailed: true,
          isVerified: false,
          isVerifiedEmpty: false,
          reviewNeeded: true,
          uncertainOcr: true,
          failureReason: 'Missing frame entry in Gemini response array',
        });
      }
    }
  }
  return batchObservations;
}

/**
 * Stage 3: Extract Chinese Subtitles
 * Inspects candidate frames across the video or chunk using high-coverage sampling,
 * fast FFmpeg streaming frame extraction, and batched Gemini Vision OCR.
 * 
 * @param {object} params
 * @param {string} params.videoPath
 * @param {number} params.durationSec
 * @param {object} params.aiClient - Google Gen AI instance
 * @param {string} [params.modelName='gemini-3.5-flash-lite']
 * @param {number} [params.baseStepSec=0.75] - Default ~0.75s between frames
 * @param {number} [params.startOffsetSec=0] - Offset for chunk processing
 * @param {AbortSignal} [params.signal=null] - Cancellation signal
 * @returns {Promise<{ rawObservations: Array, visualSegments: Array, ocrMeta: object }>}
 */

// Helper: Build Vision OCR prompt contents for a batch of frames
function buildVisionBatchContents(batch) {
  const contents = [];
  for (const item of batch) {
    if (fs.existsSync(item.filePath)) {
      const imgBuffer = fs.readFileSync(item.filePath);
      contents.push({
        text: `[FRAME_TIMESTAMP: ${item.timestampSec.toFixed(2)}s | Timecode: ${formatSecondsToTimecode(item.timestampSec)}]`,
      });
      contents.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: imgBuffer.toString('base64'),
        },
      });
    }
  }
  if (contents.length === 0) return null;

  contents.push({
    text: `You are an expert Chinese Video & Drama Multimodal OCR + Visual Speaker Analysis engine.
Analyze these ${batch.length} sequential video frames at the specified timestamps.

TASK:
Detect all burned-in Chinese dialogue subtitles in the center-bottom safe zone of each frame AND inspect the visible speaking character on screen.

RULES:
1. Examine the center-bottom subtitle area of each frame for burned-in Chinese dialogue text.
2. If dialogue subtitle text is clearly present, set "hasText": true and return the exact Chinese characters in both "textZh" and "chineseText" (strip decorative brackets like 【...】, music notes ♪, or watermarks).
3. If no dialogue subtitle text is present (e.g. background scenery, action without speaking, character reaction with no text), set "hasText": false, "textZh": "", and "chineseText": "".
4. "position": "bottom_subtitle" (for actor dialogue) or "title_card" (for standalone full-screen scene titles when NO bottom dialogue exists).
5. STRICT DIALOGUE-ONLY ISOLATION: When a centered bottom dialogue subtitle is present, extract ONLY that centered spoken dialogue line. NEVER concatenate side/corner yellow time-jump cards (e.g. '几个月前', '三天后', '一年前', '片刻后'), vertical character nameplates (e.g. '李天维 男主'), or vertical location banners (e.g. '灵虚圣地主峰讲坛') onto the dialogue text!
6. "isSharp": true if readable, false if blurry or motion-faded.
7. "visualGender" (and "speakerGender"): Inspect the visible speaking character's face, hair, costume, and open mouth to determine gender: "male", "female", or "unknown" if offscreen/ambiguous.
8. "speakerVisualHint": Short visual archetype tag for the speaker on screen (e.g. "male_lead_ancient", "female_lead_white_robe", "emperor", "maid", "ceo_suit", "offscreen_narrator").
9. "deliveryType": "dialogue" (speaking out loud with mouth moving), "inner_thought" (mouth closed with echoing/internal monologue or parenthetical subtitle), or "narration" (offscreen narrator / story recap).
10. "genderConfidence": Number between 0.0 and 1.0 indicating confidence in visualGender.
11. EXCLUDE WATERMARKS: Do NOT output creator watermarks, channel handles, or anti-theft stamps (e.g. '偷了...的视频', '抖音', '快手', account IDs). Only output genuine actor dialogue lines and standalone scene titles.
12. Preserve exact recognized Chinese characters across all video genres (Ancient/Xianxia, Modern CEO, Romance, Action, Comedy). Do NOT invent or summarize dialogue.

Return JSON ONLY matching this schema:
{
  "frames": [
{
  "timestampSec": 39.5,
  "hasText": true,
  "textZh": "我们今天必须完成这项工作",
  "chineseText": "我们今天必须完成这项工作",
  "position": "bottom_subtitle",
  "isSharp": true,
  "visualGender": "female",
  "speakerGender": "female",
  "speakerVisualHint": "female_lead_white_robe",
  "deliveryType": "dialogue",
  "genderConfidence": 0.9
}
  ]
}`,
  });
  return contents;
}

// Helper: Execute a single Vision OCR batch with model auto-cascade and cancellation
async function executeSingleVisionBatch(batchFrames, {
  checkAbort,
  geminiRequestedTimes,
  onApiCall,
  aiClient,
  getActiveWorkingModel,
  setActiveWorkingModel,
  signal,
  telemetry,
  fastOcrActive = false,
} = {}) {
  if (typeof checkAbort === 'function') checkAbort();
  const contents = buildVisionBatchContents(batchFrames);
  if (!contents) return [];

  if (geminiRequestedTimes) {
    for (const frame of batchFrames) geminiRequestedTimes.add(frame.timestampSec);
  }
  if (typeof onApiCall === 'function') onApiCall();

  const currentModel = typeof getActiveWorkingModel === 'function'
    ? getActiveWorkingModel()
    : 'gemini-3.5-flash-lite';
  const resp = await callGeminiVisionWithRetry(
    aiClient,
    currentModel,
    contents,
    2,
    signal,
    (winningModel) => {
      const latestModel = typeof getActiveWorkingModel === 'function' ? getActiveWorkingModel() : currentModel;
      if (winningModel && winningModel !== latestModel) {
        console.log(`[Stage 3 OCR] ⚡ Auto-Cascade switched active model: ${latestModel} -> ${winningModel}`);
        if (typeof setActiveWorkingModel === 'function') setActiveWorkingModel(winningModel);
      }
    },
    { batchSize: batchFrames.length, fastSplitOnTimeout: true, telemetry }
  );
  return parseVisionResponseFrames(resp, batchFrames, { autoVerifyOmitted: fastOcrActive });
}

function deduplicateFastOcrCues(rawCues = [], defaultGender = 'male') {
  if (!Array.isArray(rawCues) || rawCues.length === 0) return [];

  const sorted = [...rawCues].sort((a, b) => (a.startSec || 0) - (b.startSec || 0));
  const deduped = [];

  const defGen = (defaultGender || 'male').toLowerCase() === 'female' ? 'female' : 'male';
  const buildVoiceMeta = (gender) => {
    const isFemale = String(gender || '').toLowerCase() === 'female';
    return isFemale
      ? {
          voiceGender: 'female',
          voiceId: 'km-KH-SreymomNeural',
          voiceLabel: 'ស្រីមុំ (Sreymom)',
          avatar: '👩',
          badgeColor: '#ec4899',
        }
      : {
          voiceGender: 'male',
          voiceId: 'km-KH-PisethNeural',
          voiceLabel: 'ពិសិដ្ឋ (Piseth)',
          avatar: '👨',
          badgeColor: '#3b82f6',
        };
  };

  for (const cue of sorted) {
    const rawCueText = String(
      cue.originalChineseText || cue.chineseText || cue.textZh || cue.text ||
      cue.khmerTranslatedText || cue.khmerText || cue.khmer || ''
    ).trim();
    const cueText = stripDecorativeSubtitleNoise(rawCueText);
    if (!cueText) continue;

    const cStart = parseFloat(Number(cue.startSec || 0).toFixed(2));
    const cEnd = parseFloat(Number(cue.endSec || cStart + 1.25).toFixed(2));

    if (deduped.length === 0) {
      deduped.push({
        ...cue,
        startSec: cStart,
        endSec: cEnd,
        duration: parseFloat(Math.max(0.35, cEnd - cStart).toFixed(2)),
        textZh: cue.textZh || cueText,
        originalChineseText: cue.originalChineseText || cueText,
        chineseText: cue.chineseText || cueText,
        khmerTranslatedText: cue.khmerTranslatedText || cue.khmerText || cue.khmer || '',
        khmerText: cue.khmerText || cue.khmerTranslatedText || cue.khmer || '',
        khmer: cue.khmer || cue.khmerTranslatedText || cue.khmerText || '',
        visualGender: cue.visualGender || 'unknown',
        speakerVisualHint: cue.speakerVisualHint || '',
        deliveryType: cue.deliveryType || 'dialogue',
        source: cue.source || 'visual_ocr',
        evidenceSource: cue.evidenceSource || 'visual_ocr',
        evidenceType: cue.evidenceType || 'visual_only',
      });
      continue;
    }

    const prev = deduped[deduped.length - 1];
    const prevText = String(prev.originalChineseText || prev.chineseText || prev.textZh || '').trim();
    const isExactText = isExactChineseSubtitleMatch(prevText, cueText);
    const hasDistinctSourceIds = Boolean(prev.sourceCueId && cue.sourceCueId && prev.sourceCueId !== cue.sourceCueId);
    const allowCrossChunkMerge = !hasDistinctSourceIds || isCrossChunkOriginPair(prev, cue);

    if (isExactText) {
      const timeDiff = cStart - prev.startSec;
      const isChunkBoundaryRepeat = (Math.abs(timeDiff) <= 0.3) || (cStart < prev.endSec);
      const gap = parseFloat((cStart - prev.endSec).toFixed(2));
      const isContinuous = gap <= 0.25;

      if ((!hasDistinctSourceIds && isContinuous) || (allowCrossChunkMerge && isChunkBoundaryRepeat)) {
        if (cEnd > prev.endSec) {
          prev.endSec = parseFloat(Number(cEnd).toFixed(2));
          prev.duration = parseFloat(Math.max(0.35, prev.endSec - prev.startSec).toFixed(2));
          if (typeof prev.sourceEndSec === 'number') {
            prev.sourceEndSec = Math.max(prev.sourceEndSec, prev.endSec);
          }
        }
        if (cueText.length > prevText.length) {
          prev.textZh = cue.textZh || cueText;
          prev.originalChineseText = cue.originalChineseText || cueText;
          prev.chineseText = cue.chineseText || cueText;
        }
        if (!prev.sourceCueId && cue.sourceCueId) {
          prev.sourceCueId = cue.sourceCueId;
        }
        if (cue.ocrConfidence === 'low') {
          prev.ocrConfidence = 'low';
          prev.reviewNeeded = true;
          prev.ocrDisagreement = true;
          prev.uncertainOcr = true;
        }
        if (prev.visualGender === 'unknown' && cue.visualGender && cue.visualGender !== 'unknown') {
          prev.visualGender = cue.visualGender;
        }
        if (!prev.speakerVisualHint && cue.speakerVisualHint) {
          prev.speakerVisualHint = cue.speakerVisualHint;
        }
        if ((!prev.deliveryType || prev.deliveryType === 'dialogue') && cue.deliveryType && cue.deliveryType !== 'dialogue') {
          prev.deliveryType = cue.deliveryType;
        }
        continue;
      }
    }

    // Prevent overlaps between adjacent cues with different text
    if (cStart < prev.endSec) {
      prev.endSec = parseFloat(Math.max(prev.startSec + 0.35, cStart).toFixed(2));
      prev.duration = parseFloat(Math.max(0.35, prev.endSec - prev.startSec).toFixed(2));
    }

    deduped.push({
      ...cue,
      startSec: cStart,
      endSec: cEnd,
      duration: parseFloat(Math.max(0.35, cEnd - cStart).toFixed(2)),
      textZh: cue.textZh || cueText,
      originalChineseText: cue.originalChineseText || cueText,
      chineseText: cue.chineseText || cueText,
      khmerTranslatedText: cue.khmerTranslatedText || cue.khmerText || cue.khmer || '',
      khmerText: cue.khmerText || cue.khmerTranslatedText || cue.khmer || '',
      khmer: cue.khmer || cue.khmerTranslatedText || cue.khmerText || '',
      visualGender: cue.visualGender || 'unknown',
      speakerVisualHint: cue.speakerVisualHint || '',
      deliveryType: cue.deliveryType || 'dialogue',
      source: cue.source || 'visual_ocr',
      evidenceSource: cue.evidenceSource || 'visual_ocr',
      evidenceType: cue.evidenceType || 'visual_only',
    });
  }

  const cleanedDeduped = stripRepeatedLeadingTimeCardPrefix(deduped);

  return cleanedDeduped.map((seg, idx) => {
    const isUserOverridden = Boolean(seg.userOverridden || seg.manualCharacterOverridden);
    const hasStep1IdentifiedSpeaker = Boolean(
      isUserOverridden ||
      seg.voiceAssignmentSource === 'manual' ||
      seg.voiceAssignmentSource === 'multimodal_verified' ||
      seg.voiceAssignmentSource === 'series_glossary' ||
      seg.voiceAssignmentSource === 'local_system_rule' ||
      seg.voiceAssignmentSource === 'local_acoustic_visual' ||
      seg.speakerStatus === 'verified' ||
      seg.speakerStatus === 'review_needed' ||
      seg.speakerVerified === true ||
      Boolean(seg.speakerEvidence && seg.speakerEvidence.source)
    );
    let resolvedGender;
    let resolvedVoice;
    let voiceMeta;

    if (hasStep1IdentifiedSpeaker) {
      const existingVoice = seg.voiceId || seg.khmerVoiceId || seg.voice || '';
      const rawGender = String(seg.voiceGender || '').toLowerCase();
      if (rawGender === 'female' || rawGender === 'male') {
        resolvedGender = rawGender;
      } else if (seg.speakerStatus === 'review_needed' || seg.speakerGender === 'UNKNOWN') {
        resolvedGender = 'unknown';
      } else if (existingVoice.includes('Sreymom')) {
        resolvedGender = 'female';
      } else if (existingVoice.includes('Piseth')) {
        resolvedGender = 'male';
      } else {
        resolvedGender = defGen;
      }
      voiceMeta = buildVoiceMeta(resolvedGender);
      resolvedVoice = existingVoice || voiceMeta.voiceId;
      if (resolvedGender !== 'unknown') {
        if (resolvedVoice.includes('Sreymom')) {
          voiceMeta = buildVoiceMeta('female');
        } else if (resolvedVoice.includes('Piseth')) {
          voiceMeta = buildVoiceMeta('male');
        }
      }
    } else {
      // Rule 1: Non-overridden Fast OCR defaults ALWAYS re-derive voiceId/khmerVoiceId/voice from final voiceGender
      const rawVisual = String(seg.visualGender || seg.voiceGender || '').toLowerCase();
      if (rawVisual === 'female' || rawVisual === 'male') {
        resolvedGender = rawVisual;
      } else {
        resolvedGender = 'unknown';
      }
      voiceMeta = buildVoiceMeta(resolvedGender);
      resolvedVoice = voiceMeta.voiceId;
    }

    const resolvedSpeaker = hasStep1IdentifiedSpeaker ? (seg.speaker || seg.speakerName || 'តួអង្គ') : 'តួអង្គ';
    const resolvedSpeakerId = hasStep1IdentifiedSpeaker ? (seg.speakerId || `spk_review_${seg.sourceCueId || idx + 1}`) : `spk_ocr_${idx + 1}`;
    const resolvedUnverified = hasStep1IdentifiedSpeaker
      ? (seg.unverifiedSpeaker !== undefined ? Boolean(seg.unverifiedSpeaker) : (seg.speakerStatus === 'review_needed' || resolvedSpeaker === 'តួអង្គ'))
      : true;

    return {
      ...seg,
      id: idx + 1,
      segmentId: idx + 1,
      start: formatSecondsToTimecode(seg.startSec).substring(0, 5),
      end: formatSecondsToTimecode(seg.endSec).substring(0, 5),
      startTime: formatSecondsToTimecode(seg.startSec).substring(0, 5),
      endTime: formatSecondsToTimecode(seg.endSec).substring(0, 5),
      sourceStartSec: seg.startSec,
      sourceEndSec: seg.endSec,
      speechStartSec: seg.startSec,
      speechEndSec: seg.endSec,
      speechDuration: seg.duration,
      availableSlotDuration: seg.duration,
      slotDuration: seg.duration,

      visualGender: seg.visualGender || 'unknown',
      speakerVisualHint: seg.speakerVisualHint || '',
      deliveryType: seg.deliveryType || 'dialogue',

      ocrConfidence: seg.ocrConfidence || 'high',
      reviewNeeded: Boolean(seg.reviewNeeded),
      ocrDisagreement: Boolean(seg.ocrDisagreement),
      uncertainOcr: Boolean(seg.uncertainOcr || seg.ocrConfidence === 'low'),

      // STEP 3: Speaker/gender (preserve Step 1 multimodal identification if already run)
      speakerSource: hasStep1IdentifiedSpeaker ? (seg.speakerSource || seg.voiceAssignmentSource || 'multimodal_verified') : 'ocr_only',
      unverifiedSpeaker: resolvedUnverified,
      genderConfidence: hasStep1IdentifiedSpeaker ? (seg.genderConfidence ?? null) : null,
      voiceGender: resolvedGender,
      gender: resolvedGender,
      speakerGender: resolvedGender === 'unknown' ? 'UNKNOWN' : resolvedGender.toUpperCase(),
      speaker: resolvedSpeaker,
      speakerName: resolvedSpeaker,
      speakerId: resolvedSpeakerId,
      ...(seg.characterId ? { characterId: seg.characterId } : {}),
      ...(seg.voiceAssignmentSource ? { voiceAssignmentSource: seg.voiceAssignmentSource } : {}),
      ...(seg.speakerStatus ? { speakerStatus: seg.speakerStatus } : {}),
      ...(seg.speakerReviewNeeded !== undefined ? { speakerReviewNeeded: Boolean(seg.speakerReviewNeeded) } : {}),
      ...(seg.speakerEvidence ? { speakerEvidence: seg.speakerEvidence } : {}),
      ...(seg.recognitionConfidence !== undefined ? { recognitionConfidence: seg.recognitionConfidence } : {}),
      ...(seg.recognitionEvidence ? { recognitionEvidence: seg.recognitionEvidence } : {}),
      ...(seg.characterGender ? { characterGender: seg.characterGender } : {}),
      ...(seg.voiceActorTimbre ? { voiceActorTimbre: seg.voiceActorTimbre } : {}),
      voiceId: resolvedVoice,
      khmerVoiceId: resolvedVoice,
      voice: resolvedVoice,
      voiceLabel: voiceMeta.voiceLabel,
      avatar: voiceMeta.avatar,
      badgeColor: voiceMeta.badgeColor,

      audioUrl: null,
      audioFile: null,
      audioFileName: null,
      audioPath: null,
      audioDurationSec: 0,
      rawAudioDur: 0,
      ttsStatus: seg.ttsStatus || (seg.audioFile ? 'ready' : 'pending'),
      status: (seg.translationStatus === 'translated' || seg.khmerTranslatedText || seg.khmerText)
        ? 'translated'
        : (seg.status || 'needs_translation'),
      translationStatus: seg.translationStatus || (
        (seg.khmerTranslatedText || seg.khmerText) ? 'translated' : 'review_needed'
      ),
    };
  });
}

module.exports = {
  sleepOrAbort,
  defaultCacheDir,
  getOcrCachePath,
  getOcrCheckpointPath,
  saveOcrCheckpoint,
  loadOcrCheckpoint,
  needsIndependentRead,
  hasChineseHanzi,
  extractCueChunkOrigin,
  isCrossChunkOriginPair,
  normalizeChineseChars,
  stripDecorativeSubtitleNoise,
  stripRepeatedLeadingTimeCardPrefix,
  sameSubtitleText,
  isExactChineseSubtitleMatch,
  areChineseTextsEquivalent,
  CASCADE_VISION_MODELS,
  visionModelCooldownMap,
  classifyVisionError,
  extractRetryDelayMs,
  isRetryableVisionError,
  isTimeoutOrOverloadError,
  callGeminiVisionWithRetry,
  parseVisionResponseFrames,
  buildVisionBatchContents,
  executeSingleVisionBatch,
  deduplicateFastOcrCues,
};
