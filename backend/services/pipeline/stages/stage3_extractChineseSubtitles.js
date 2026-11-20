const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  extractFramesStreaming,
  extractFramesAtTimestamps,
  extractSubtitleDifferenceGrid,
  detectSubtitleChangePoints,
} = require('../../ffmpegService');
const { formatSecondsToTimecode } = require('../pipelineTypes');
const { createAbortError } = require('../../../utils/asyncSemaphore');
const { VISION_CASCADE_MODELS } = require('../../geminiModelCatalog');
const { geminiQuotaTracker } = require('../../geminiQuotaTracker');
const {
  checkLocalChineseOcrStatus,
  isLocalChineseOcrAvailable,
  runLocalChineseOcr,
} = require('../../ocr/localChineseOcrService');

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

function getOcrCachePath(videoPath, startOffsetSec = 0, durationSec = 0, modelName = '', cacheDir = defaultCacheDir) {
  try {
    // កែពី ../../../../uploads/cache មកជា ../../../uploads/cache ឱ្យត្រូវជាមួយ Stage 1, 4 និង 9
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const stat = fs.statSync(videoPath);
    const safeBase = path.basename(videoPath).replace(/[^a-zA-Z0-9_-]/g, '_');
    const signature = `${stat.size}_${Math.round(stat.mtimeMs)}`;
    return path.join(cacheDir, `ocr_${safeBase}_${signature}_${Math.round(startOffsetSec)}_${Math.round(durationSec)}_${modelName}.json`);
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

function normalizeChineseChars(str = '') {
  return String(str)
    .replace(/[\s\r\n\t,，.。!！?？:：;；"'"'《》\(\)（）—\-_·、]/g, '')
    .trim();
}

/**
 * Strip decorative brackets, music notes (♪/♫), and watermark noise from raw OCR subtitle text.
 */
function stripDecorativeSubtitleNoise(str = '') {
  const cleaned = String(str || '')
    .replace(/[♪♫♬♩]+/g, '')
    .trim()
    .replace(/^《第[0-9一二三四五六七八九十百千万]+[集话章]》$/, '')
    .replace(/^[【〖『\[]([^】〗』\]]+)[】〗』\]]$/, '$1')
    .trim();
  return cleaned;
}

function sameSubtitleText(a, b) {
  const left = normalizeChineseChars(a);
  return left.length > 0 && left === normalizeChineseChars(b);
}

function areChineseTextsEquivalent(a = '', b = '') {
  const normA = normalizeChineseChars(a);
  const normB = normalizeChineseChars(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.length >= 2 && normB.length >= 2) {
    if (normA.includes(normB) || normB.includes(normA)) return true;
    const minL = Math.min(normA.length, normB.length);
    let common = 0;
    for (const ch of normA) {
      if (normB.includes(ch)) common++;
    }
    if (common / minL >= 0.75) return true;
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
        if (telemetry) telemetry.apiTotalMs = (telemetry.apiTotalMs || 0) + (Date.now() - callStart);
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
function parseVisionResponseFrames(resp, batchFrames = []) {
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
      const cleanChineseLen = normalizeChineseChars(cText).length;

      // If entry is empty object or missing explicit boolean / text, treat as missing response
      if (!hasExplicitHasText && cleanChineseLen === 0 && !f.position && !f.visualGender && !f.speakerGender) {
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
async function extractChineseSubtitles({
  videoPath,
  durationSec,
  aiClient,
  modelName = null,
  baseStepSec = 0.75,
  startOffsetSec = 0,
  force = false,
  signal = null,
  onProgress = null,
  enableLocalOcr = true,
  cacheDir = defaultCacheDir,
}) {
  let activeWorkingModel = modelName || geminiQuotaTracker.getPreferredPrimaryModel(CASCADE_VISION_MODELS[0]);
  const effectiveModel = activeWorkingModel;
  const checkAbort = () => {
    if (signal?.aborted) {
      throw createAbortError('Stage 3 OCR aborted');
    }
  };

  checkAbort();

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`[Stage 3 Extract Subtitles] Video file not found: ${videoPath}`);
  }
  if (!aiClient) {
    throw new Error('[Stage 3 Extract Subtitles] Gemini AI client is required');
  }

  const cachePath = getOcrCachePath(videoPath, startOffsetSec, durationSec, effectiveModel, cacheDir);
  if (force && cachePath && fs.existsSync(cachePath)) {
    try { fs.unlinkSync(cachePath); } catch (_) {}
  }
  if (!force && cachePath && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const hasUnresolved = Boolean(
        cached.hasUnresolvedFrames ||
        cached.isComplete === false ||
        cached.ocrMeta?.hasUnresolvedFrames ||
        cached.ocrMeta?.isComplete === false ||
        (Array.isArray(cached.rawObservations) && cached.rawObservations.some((o) => o.ocrFailed || o.isVerified === false || o.ocrStatus === 'failed' || o.ocrStatus === 'missing'))
      );
      if (!hasUnresolved && cached.ocrMeta?.independentSamples && Array.isArray(cached.visualSegments) && Array.isArray(cached.rawObservations) && cached.visualSegments.length > 0) {
        console.log(`[Stage 3 OCR] ⚡ Cache Hit: Reusing ${cached.visualSegments.length} visual segments from disk cache (${path.basename(cachePath)})`);
        return cached;
      } else if (hasUnresolved) {
        console.warn(`[Stage 3 OCR] ⚠️ Cache at ${path.basename(cachePath)} contains unresolved/failed frames. Rejecting incomplete cache.`);
      }
    } catch (_) {}
  }

  const checkpointPath = getOcrCheckpointPath(videoPath, startOffsetSec, durationSec, cacheDir);
  if (force && checkpointPath && fs.existsSync(checkpointPath)) {
    try { fs.unlinkSync(checkpointPath); } catch (_) {}
  }

  const completedMap = new Map();
  const unresolvedMap = new Map();
  const localReads = new Map();
  let resumedFromCheckpoint = false;
  if (!force && checkpointPath) {
    const ckpt = loadOcrCheckpoint(checkpointPath);
    if (ckpt) {
      if (ckpt.independentSamples && Array.isArray(ckpt.pendingLocalReads)) {
        for (const row of ckpt.pendingLocalReads) {
          if (Number.isFinite(row?.timestampSec) && row.ocrStatus !== 'failed') localReads.set(row.timestampSec, row);
        }
      }
      for (const obs of ckpt.rawObservations) {
        if (obs && typeof obs.timestampSec === 'number') {
          const t = parseFloat(obs.timestampSec.toFixed(2));
          const isVerified = Boolean(obs.isVerified && !obs.ocrFailed && obs.ocrStatus !== 'failed' && obs.ocrStatus !== 'missing');
          if (!ckpt.independentSamples && needsIndependentRead(obs)) continue;
          if (isVerified) {
            completedMap.set(t, obs);
          } else {
            unresolvedMap.set(t, obs);
          }
        }
      }
      resumedFromCheckpoint = true;
      console.log(`[Stage 3 OCR] ⚡ Resuming from checkpoint (${path.basename(checkpointPath)}): ${completedMap.size} completed frame observations loaded (${unresolvedMap.size} unresolved to retry).`);
    }
  }

  const localOnResume = new Set(localReads.keys());
  function saveProgress(data) {
    return saveOcrCheckpoint(checkpointPath, {
      ...data,
      independentSamples: true,
      pendingLocalReads: [...localReads.values()].filter(row => !completedMap.has(row.timestampSec)),
    });
  }

  const verifiedOnResume = new Set(completedMap.keys());
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub_ocr_'));

  const rawObservations = [];
  const evaluatedCueStates = [];
  let apiCallsCount = 0;
  let retriesCount = 0;
  let lastBatchError = null;
  let ocrWallTimeMs = 0;
  let ffmpegPrepassMs = 0;
  let frameExtractionMs = 0;
  let localOcrMs = 0;
  let geminiVerificationMs = 0;
  let localTelemetry = { imageDecodeMs: 0, inferenceMs: 0, avgInferenceMs: 0, workerCpuMs: 0, workerPeakRssMb: null };
  const geminiRequestedTimes = new Set();
  let tieBreakMs = 0;
  let batchSplitsCount = 0;
  let dedupedFramesCount = 0;
  let localOcrFramesCount = 0;
  let actualOcrFramesCount = 0;
  let workerStartupMs = 0;
  let rapidOcrInitMs = 0;
  let avgMsPerFrame = 0;
  let localVerifiedCount = 0;
  let geminiVerifiedCount = 0;
  let geminiBatchCount = 0;
  let isLocalOcrActive = false;
  const telemetry = {
    apiTotalMs: 0,
    retrySleepMs: 0,
  };

  const stage3StartTime = Date.now();
  const prepassStartTime = Date.now();
  try {
    checkAbort();
    // 1. STEP 1: Change-driven sampling pre-pass (local FFmpeg pixel-diff, zero API calls)
    const { changePoints = [], cueStates = [], frameDiffs = [] } = await detectSubtitleChangePoints(
      videoPath,
      startOffsetSec,
      durationSec,
      5.0,
      { signal }
    ).catch((preErr) => {
      if (preErr?.name === 'AbortError' || signal?.aborted) {
        throw preErr?.name === 'AbortError' ? preErr : createAbortError('Stage 3 OCR aborted');
      }
      console.warn('[Stage 3 Extract Subtitles] Pre-pass change point detection failed, falling back to grid:', preErr.message);
      return { changePoints: [], cueStates: [], frameDiffs: [] };
    });

    // Helper: Inspect maximum subtitle pixel diff between two timestamps
    // P0: Strictly inspect d.subDiff; never fall back to full-frame d.diff when subDiff === 0
    function getMaxSubtitleDiffBetween(startT, endT) {
      if (!Array.isArray(frameDiffs) || frameDiffs.length === 0) return 999;
      const minT = Math.min(startT, endT);
      const maxT = Math.max(startT, endT);
      const inRange = frameDiffs.filter((d) => d && typeof d.timestampSec === 'number' && d.timestampSec >= minT && d.timestampSec <= maxT);
      if (inRange.length === 0) return 999;
      return inRange.reduce(
        (max, d) => Math.max(max, typeof d?.subDiff === 'number' ? d.subDiff : (typeof d?.diff === 'number' ? d.diff : 0)),
        0
      );
    }

    // Schedule candidate frame timestamps:
    // (a) One frame shortly AFTER each change point (sampleASec) + mid-cue frame (sampleBSec)
    // (b) 0.75s baseline safety net deduplicated by timestamp (drops on static scenes)
    const scheduled = new Set();
    const candidateTimestamps = [];
    // Keep the original anchor grid for baseline coverage. Independently read
    // every cue sample, including timestamps previously linked to an anchor.
    const cueSamples = new Map();
    const additionalSamples = new Set();
    const safeStartSec = Math.max(0, Number(startOffsetSec) || 0);
    const endSec = durationSec > 0 ? safeStartSec + durationSec : (cueStates.length > 0 ? cueStates[cueStates.length - 1].endSec : safeStartSec + 10);

    function trySchedule(t, reason, minGap = 0.12) {
      const rounded = parseFloat(Number(t).toFixed(2));
      if (rounded < safeStartSec || rounded > endSec) return false;
      for (const ex of scheduled) {
        if (Math.abs(ex - rounded) < minGap) return false;
      }
      scheduled.add(rounded);
      candidateTimestamps.push({ timestampSec: rounded, reason });
      return true;
    }

    // (a) Change-point frames & mid-cue frames
    if (cueStates.length > 0) {
      for (const cs of cueStates) {
        trySchedule(cs.sampleASec, `cue_${cs.cueIndex}_sampleA`, 0.12);

        cueSamples.set(cs.sampleASec, cs);
        cueSamples.set(cs.sampleBSec, cs);
        // Low grid difference affects anchor spacing only. It cannot prove text equality.
        if (getMaxSubtitleDiffBetween(cs.sampleASec, cs.sampleBSec) >= 2.5) {
          trySchedule(cs.sampleBSec, `cue_${cs.cueIndex}_sampleB`, 0.12);
        }
      }
    } else {
      // Fallback: use raw changePoints if cueStates empty
      for (const cp of changePoints) {
        trySchedule(cp.timestampSec + 0.10, 'cp_onset', 0.12);
      }
    }

    // (b) Baseline safety net (0.75s grid deduplicated)
    const effectiveStep = Math.max(0.5, Number(baseStepSec) || 0.75);
    // Align chunk boundary: start immediately at safeStartSec when safeStartSec > 0 to eliminate boundary dead-zones
    let curTime = safeStartSec === 0 ? 0.5 : safeStartSec;
    const stepDiff = 0.2; // 5 fps pre-pass step

    while (curTime < endSec) {
      const rounded = parseFloat(curTime.toFixed(2));
      let isCovered = false;
      for (const ex of scheduled) {
        if (Math.abs(ex - rounded) <= 0.40) {
          isCovered = true;
          break;
        }
      }

      if (!isCovered && cueSamples.has(rounded)) {
        isCovered = true;
      }

      if (!isCovered) {
        // Keep independent reads at the former static baseline timestamps.
        const insideCue = cueStates.find((cs) => rounded >= cs.startSec && rounded <= cs.endSec);
        if (insideCue) {
          const diffFromA = getMaxSubtitleDiffBetween(insideCue.sampleASec, rounded);
          if (diffFromA < 2.5) {
            additionalSamples.add(rounded);
            isCovered = true;
          }
        }
      }

      if (!isCovered) {
        const idx = Math.round((curTime - safeStartSec) / stepDiff);
        const nearDiffs = frameDiffs.slice(Math.max(0, idx - 2), Math.min(frameDiffs.length, idx + 3));
        const maxNearDiff = nearDiffs.reduce(
          (m, d) => Math.max(m, typeof d?.subDiff === 'number' ? d.subDiff : (typeof d?.diff === 'number' ? d.diff : 0)),
          0
        );

        if (maxNearDiff >= 8.0 || frameDiffs.length === 0) {
          trySchedule(rounded, 'baseline_active', 0.20);
        } else {
          // Static scene: drop frame count! Sparse anchor only if gap >= 4.0s
          let hasRecentAnchor = false;
          for (const ex of scheduled) {
            if (Math.abs(ex - rounded) < 4.0) {
              hasRecentAnchor = true;
              break;
            }
          }
          if (!hasRecentAnchor) {
            trySchedule(rounded, 'baseline_static_sparse', 0.20);
          }
        }
      }
      curTime += effectiveStep;
    }

    for (const t of [...cueSamples.keys(), ...additionalSamples]) {
      if (!scheduled.has(t)) trySchedule(t, 'independent_sample', 0);
    }

    // Sort candidate frame timestamps chronologically
    candidateTimestamps.sort((a, b) => a.timestampSec - b.timestampSec);
    const sortedTimes = candidateTimestamps.map((c) => c.timestampSec);
    const totalCandidateFrames = candidateTimestamps.length;

    // P1: Resume Checkpoint without re-decoding: Only extract frames that are NOT yet verified in completedMap
    const timesToExtract = sortedTimes.filter((t) => !completedMap.has(parseFloat(Number(t).toFixed(2))));

    // 2. Extract candidate frames at scheduled timestamps
    checkAbort();
    let extractedFrames = [];
    const extractStartTime = Date.now();
    if (timesToExtract.length > 0) {
      try {
        extractedFrames = await extractFramesAtTimestamps(videoPath, timesToExtract, tempDir, { signal });
      } catch (extractErr) {
        if (extractErr?.name === 'AbortError' || signal?.aborted) {
          throw extractErr?.name === 'AbortError' ? extractErr : createAbortError('Stage 3 OCR aborted');
        }
        console.warn('[Stage 3 Extract Subtitles] Timestamp extraction error, attempting streaming fallback:', extractErr.message);
        const fps = Math.min(2.0, Math.max(0.8, parseFloat((1 / effectiveStep).toFixed(2))));
        extractedFrames = await extractFramesStreaming(videoPath, safeStartSec, durationSec, fps, tempDir, { signal });
      }
    } else {
      console.log(`[Stage 3 OCR] ⚡ All candidate frames already verified in checkpoint (${completedMap.size} frames). Skipping FFmpeg frame extraction.`);
    }
    frameExtractionMs = Date.now() - extractStartTime;
    ffmpegPrepassMs = Math.max(0, Date.now() - prepassStartTime - frameExtractionMs);

    const framesToAnalyze = extractedFrames || [];
    console.log(`[Stage 3 Extract Subtitles] Detected ${changePoints.length} change points (${cueStates.length} candidate cue states). Prioritized ${framesToAnalyze.length} pending frames for Vision OCR (${completedMap.size} already verified in checkpoint)`);

    // Helper: Build Vision OCR prompt contents
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
4. "position": "bottom_subtitle" (for actor dialogue) or "title_card" (for on-screen titles).
5. "isSharp": true if readable, false if blurry or motion-faded.
6. "visualGender" (and "speakerGender"): Inspect the visible speaking character's face, hair, costume, and open mouth to determine gender: "male", "female", or "unknown" if offscreen/ambiguous.
7. "speakerVisualHint": Short visual archetype tag for the speaker on screen (e.g. "male_lead_ancient", "female_lead_white_robe", "emperor", "maid", "ceo_suit", "offscreen_narrator").
8. "deliveryType": "dialogue" (speaking out loud with mouth moving), "inner_thought" (mouth closed with echoing/internal monologue or parenthetical subtitle), or "narration" (offscreen narrator / story recap).
9. "genderConfidence": Number between 0.0 and 1.0 indicating confidence in visualGender.
10. EXCLUDE WATERMARKS: Do NOT output creator watermarks, channel handles, or anti-theft stamps (e.g. '偷了...的视频', '抖音', '快手', account IDs). Only output genuine actor dialogue lines and scene titles.
11. Preserve exact recognized Chinese characters across all video genres (Ancient/Xianxia, Modern CEO, Romance, Action, Comedy). Do NOT invent or summarize dialogue.

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

    // Helper: Execute a single batch with model auto-cascade and cancellation
    async function executeSingleVisionBatch(batchFrames) {
      checkAbort();
      const contents = buildVisionBatchContents(batchFrames);
      if (!contents) return [];

      for (const frame of batchFrames) geminiRequestedTimes.add(frame.timestampSec);
      apiCallsCount++;
      const resp = await callGeminiVisionWithRetry(
        aiClient,
        activeWorkingModel,
        contents,
        2,
        signal,
        (winningModel) => {
          if (winningModel && winningModel !== activeWorkingModel) {
            console.log(`[Stage 3 OCR] ⚡ Auto-Cascade switched active model: ${activeWorkingModel} -> ${winningModel}`);
            activeWorkingModel = winningModel;
          }
        },
        { batchSize: batchFrames.length, fastSplitOnTimeout: true, telemetry }
      );
      return parseVisionResponseFrames(resp, batchFrames);
    }

    // 2.5 HYBRID LOCAL CHINESE OCR & VERIFICATION ROUTER
    const availabilityStart = Date.now();
    const effectiveEnableLocalOcr = (enableLocalOcr !== false) && (process.env.ENABLE_LOCAL_CHINESE_OCR !== 'false');
    if (effectiveEnableLocalOcr && framesToAnalyze.length) {
      try {
        isLocalOcrActive = await isLocalChineseOcrAvailable();
      } catch (_) {
        isLocalOcrActive = false;
      }
    }

    const localAvailabilityMs = Date.now() - availabilityStart;
    if (effectiveEnableLocalOcr && (isLocalOcrActive || localReads.size) && framesToAnalyze.length > 0) {
      const pendingForLocalOcr = framesToAnalyze
        .filter((f) => !completedMap.has(f.timestampSec) && !localReads.has(f.timestampSec))
        .map((f, idx) => {
          const t = parseFloat(f.timestampSec.toFixed(2));
          const matchedCue = cueSamples.get(t);
          return {
            ...f,
            id: f.id || `f_${idx}_${t}`,
            cueIndex: matchedCue ? matchedCue.cueIndex : -1,
            isShortCue: matchedCue ? matchedCue.duration <= 1.0 : false,
            sceneCut: changePoints.some((cp) => Math.abs(cp.timestampSec - t) <= 0.15),
          };
        });
      if (pendingForLocalOcr.length || localReads.size) {
        const localOcrStart = Date.now();
        let localResults = [];
        if (isLocalOcrActive && pendingForLocalOcr.length) {
          console.log(`[Stage 3 OCR] ⚡ Running RapidOCR Local Chinese OCR on ${pendingForLocalOcr.length} candidate frames...`);
          if (typeof onProgress === 'function') {
            onProgress({
              stage: 'stage3_local_ocr',
              completedBatches: 0,
              totalBatches: 1,
              completedFrames: completedMap.size,
              totalFrames: totalCandidateFrames,
              localCompleted: 0,
              localTotal: pendingForLocalOcr.length,
              percent: 25,
              modelUsed: 'rapidocr-local',
              retriesCount,
              statusMessage: `1. Local Chinese OCR: 0/${pendingForLocalOcr.length} frames (RapidOCR)...`,
            });
          }

          try {
            const ocrRun = await runLocalChineseOcr({
              frames: pendingForLocalOcr,
              onBatchComplete: (rows) => {
                for (const row of rows) {
                  if (row.ocrStatus !== 'failed') localReads.set(row.timestampSec, row);
                }
                saveProgress({
                  version: 1, videoPath, startOffsetSec, durationSec, updatedAt: Date.now(),
                  rawObservations: [...completedMap.values(), ...unresolvedMap.values()],
                  totalCandidateFrames, completed: false,
                });
              },
              signal,
              onProgress: (p) => {
                if (typeof onProgress === 'function') {
                  onProgress({
                    stage: 'stage3_local_ocr',
                    completedBatches: 0,
                    totalBatches: 1,
                    completedFrames: completedMap.size + (p.completed || 0),
                    totalFrames: totalCandidateFrames,
                    localCompleted: p.completed,
                    localTotal: pendingForLocalOcr.length,
                    percent: Math.min(60, 25 + Math.round(((p.completed || 0) / Math.max(1, pendingForLocalOcr.length)) * 35)),
                    modelUsed: 'rapidocr-local',
                    retriesCount,
                    statusMessage: `Local Chinese OCR: ${p.completed}/${pendingForLocalOcr.length} frames (${p.percent}%)`,
                  });
                }
              },
            });
            localResults = ocrRun.results || [];
            workerStartupMs = ocrRun.workerStartupMs || 0;
            rapidOcrInitMs = ocrRun.rapidOcrInitMs || 0;
            actualOcrFramesCount = ocrRun.actualOcrFramesCount ?? localResults.length;
            const { imageDecodeMs, inferenceMs, avgInferenceMs, workerCpuMs, workerPeakRssMb } = ocrRun;
            localTelemetry = { imageDecodeMs, inferenceMs, avgInferenceMs, workerCpuMs, workerPeakRssMb };
            dedupedFramesCount = ocrRun.dedupedFramesCount || 0;
            avgMsPerFrame = ocrRun.avgMsPerFrame || 0;
          } catch (localErr) {
            if (localErr?.name === 'AbortError' || signal?.aborted) {
              throw localErr?.name === 'AbortError' ? localErr : createAbortError('Stage 3 OCR aborted');
            }
            console.warn(`[Stage 3 OCR] ⚠️ Local Chinese OCR failed (${localErr.message}). Falling back to Gemini Vision for all frames.`);
            localResults = [];
          }
        }
        localOcrMs = Date.now() - localOcrStart;
        localOcrFramesCount = localResults.length;
        const localMap = new Map(localReads);
        for (const row of localResults) localMap.set(row.timestampSec, row);

        if (localMap.size) {
          // HYBRID VERIFICATION ROUTER (Section 5):
          // A. LOCAL VERIFIED:
          // 1. Both sampleA and sampleB empty with confidence >= 0.70
          // 2. Both sampleA and sampleB have text, are equivalent, and confidence >= 0.70
          if (cueStates.length > 0) {
            for (const cs of cueStates) {
              const tA = parseFloat(cs.sampleASec.toFixed(2));
              const tB = parseFloat(cs.sampleBSec.toFixed(2));
              const rA = localMap.get(tA);
              const rB = localMap.get(tB);

              if (!rA || !rB || tA === tB) continue;

              const confA = rA.confidence || 0;
              const confB = rB.confidence || 0;
              const textA = rA.hasText ? (rA.chineseText || rA.textZh || '') : '';
              const textB = rB.hasText ? (rB.chineseText || rB.textZh || '') : '';

              if (!rA.hasText && !rB.hasText && confA >= 0.70 && confB >= 0.70) {
                if (!completedMap.has(tA)) {
                  completedMap.set(tA, {
                    timestampSec: tA,
                    reportedSec: tA,
                    hasText: false,
                    textZh: '',
                    chineseText: '',
                    confidence: confA,
                    isSharp: true,
                    position: 'bottom_subtitle',
                    visualGender: 'unknown',
                    speakerGender: 'UNKNOWN',
                    speakerVisualHint: '',
                    deliveryType: 'dialogue',
                    genderConfidence: 0.5,
                    ocrStatus: 'verified_empty',
                    isVerified: true,
                    isVerifiedEmpty: true,
                    ocrFailed: false,
                    reviewNeeded: false,
                    uncertainOcr: false,
                    ocrEngine: 'rapidocr-local',
                  });
                  localVerifiedCount++;
                }
                if (!completedMap.has(tB)) {
                  completedMap.set(tB, {
                    timestampSec: tB,
                    reportedSec: tB,
                    hasText: false,
                    textZh: '',
                    chineseText: '',
                    confidence: confB,
                    isSharp: true,
                    position: 'bottom_subtitle',
                    visualGender: 'unknown',
                    speakerGender: 'UNKNOWN',
                    speakerVisualHint: '',
                    deliveryType: 'dialogue',
                    genderConfidence: 0.5,
                    ocrStatus: 'verified_empty',
                    isVerified: true,
                    isVerifiedEmpty: true,
                    ocrFailed: false,
                    reviewNeeded: false,
                    uncertainOcr: false,
                    ocrEngine: 'rapidocr-local',
                  });
                  localVerifiedCount++;
                }
              } else if (rA.hasText && rB.hasText && sameSubtitleText(textA, textB) && confA >= 0.70 && confB >= 0.70) {
                const resolvedText = textA.length >= textB.length ? textA : textB;
                if (!completedMap.has(tA)) {
                  completedMap.set(tA, {
                    timestampSec: tA,
                    reportedSec: tA,
                    hasText: true,
                    textZh: resolvedText,
                    chineseText: resolvedText,
                    confidence: confA,
                    isSharp: confA >= 0.70,
                    position: 'bottom_subtitle',
                    visualGender: 'unknown',
                    speakerGender: 'UNKNOWN',
                    speakerVisualHint: '',
                    deliveryType: 'dialogue',
                    genderConfidence: 0.5,
                    ocrStatus: 'verified_text',
                    isVerified: true,
                    isVerifiedEmpty: false,
                    ocrFailed: false,
                    reviewNeeded: false,
                    uncertainOcr: false,
                    ocrEngine: 'rapidocr-local',
                  });
                  localVerifiedCount++;
                }
                if (!completedMap.has(tB)) {
                  completedMap.set(tB, {
                    timestampSec: tB,
                    reportedSec: tB,
                    hasText: true,
                    textZh: resolvedText,
                    chineseText: resolvedText,
                    confidence: confB,
                    isSharp: confB >= 0.70,
                    position: 'bottom_subtitle',
                    visualGender: 'unknown',
                    speakerGender: 'UNKNOWN',
                    speakerVisualHint: '',
                    deliveryType: 'dialogue',
                    genderConfidence: 0.5,
                    ocrStatus: 'verified_text',
                    isVerified: true,
                    isVerifiedEmpty: false,
                    ocrFailed: false,
                    reviewNeeded: false,
                    uncertainOcr: false,
                    ocrEngine: 'rapidocr-local',
                  });
                  localVerifiedCount++;
                }
              }
            }
          }

          // Baseline frames: high-confidence local text continues without Gemini;
          // Empty frames require independent supporting evidence before marking verified_empty
          for (const cand of candidateTimestamps) {
            const t = cand.timestampSec;
            if (completedMap.has(t)) continue;
            const loc = localMap.get(t);
            if (!loc) continue;

            if (loc.hasText && (loc.confidence || 0) >= 0.85) {
              // High-confidence local text continues without Gemini
              completedMap.set(t, {
                timestampSec: t,
                reportedSec: t,
                hasText: true,
                textZh: loc.chineseText || loc.textZh || '',
                chineseText: loc.chineseText || loc.textZh || '',
                confidence: loc.confidence,
                isSharp: loc.confidence >= 0.70,
                position: 'bottom_subtitle',
                visualGender: 'unknown',
                speakerGender: 'UNKNOWN',
                speakerVisualHint: '',
                deliveryType: 'dialogue',
                genderConfidence: 0.5,
                ocrStatus: 'verified_text',
                isVerified: true,
                isVerifiedEmpty: false,
                ocrFailed: false,
                reviewNeeded: false,
                uncertainOcr: false,
                ocrEngine: 'rapidocr-local',
              });
              localVerifiedCount++;
            } else if (!loc.hasText && (loc.confidence || 0) >= 0.70) {
              // Independent supporting evidence: verify empty ONLY if surrounded by verified empty frames
              // within a static window where max subtitle difference is < 1.0 (subDiff < 1.0)
              const prevVerified = Array.from(completedMap.values())
                .filter((o) => o.timestampSec < t && o.isVerifiedEmpty)
                .pop();
              const hasIndependentEmptyContext = Boolean(
                prevVerified &&
                Math.abs(t - prevVerified.timestampSec) <= 1.5 &&
                getMaxSubtitleDiffBetween(prevVerified.timestampSec, t) < 1.0
              );

              if (hasIndependentEmptyContext) {
                completedMap.set(t, {
                  timestampSec: t,
                  reportedSec: t,
                  hasText: false,
                  textZh: '',
                  chineseText: '',
                  confidence: loc.confidence,
                  isSharp: true,
                  position: 'bottom_subtitle',
                  visualGender: 'unknown',
                  speakerGender: 'UNKNOWN',
                  speakerVisualHint: '',
                  deliveryType: 'dialogue',
                  genderConfidence: 0.5,
                  ocrStatus: 'verified_empty',
                  isVerified: true,
                  isVerifiedEmpty: true,
                  ocrFailed: false,
                  reviewNeeded: false,
                  uncertainOcr: false,
                  ocrEngine: 'rapidocr-local',
                });
                localVerifiedCount++;
              }
              // If no independent supporting evidence, frame remains unverified and routes to Gemini Vision
            }
          }

          console.log(`[Stage 3 OCR] 🎯 Hybrid Router: ${localVerifiedCount} frame observations verified locally (${completedMap.size} total verified). Queuing remaining uncertain frames for Gemini...`);

          for (const t of completedMap.keys()) unresolvedMap.delete(t);

          // Checkpoint save after local OCR
          if (checkpointPath) {
            saveProgress({
              version: 1,
              videoPath,
              startOffsetSec: Math.round(startOffsetSec),
              durationSec: Math.round(durationSec),
              updatedAt: Date.now(),
              rawObservations: [...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values())].sort((a, b) => a.timestampSec - b.timestampSec),
              completedBatchesCount: 0,
              totalCandidateFrames,
              completed: unresolvedMap.size === 0 && completedMap.size === totalCandidateFrames,
              hasUnresolvedFrames: unresolvedMap.size > 0,
              unresolvedCount: unresolvedMap.size,
            });
          }
        }
      }
    }

    // 3. Adaptive Batch Scheduler with Per-Batch Checkpointing & Concurrency Backoff
    console.log(`[Stage 3 Extract Subtitles] Running Gemini Vision OCR on ${framesToAnalyze.length} pending candidate frames (${completedMap.size} already verified)...`);
    const INITIAL_BATCH_SIZE = 15;

    // Filter candidate frames against completed observations from checkpoint
    const pendingFrames = framesToAnalyze.filter((f) => {
      const t = parseFloat(f.timestampSec.toFixed(2));
      return !completedMap.has(t);
    });

    const batchQueue = [];
    for (let i = 0; i < pendingFrames.length; i += INITIAL_BATCH_SIZE) {
      const slice = pendingFrames.slice(i, i + INITIAL_BATCH_SIZE);
      const startT = slice[0].timestampSec.toFixed(2);
      const endT = slice[slice.length - 1].timestampSec.toFixed(2);
      batchQueue.push({
        batchId: `batch_${startT}_${endT}_${i}`,
        frames: slice,
        splitDepth: 0,
      });
    }

    let completedBatchesCount = Math.floor(completedMap.size / INITIAL_BATCH_SIZE);
    let totalBatchesEstimated = completedBatchesCount + batchQueue.length;
    let adaptiveConcurrency = 2; // starts at 2, reduces to 1 on overload
    let consecutiveSuccesses = 0;
    let failedBatchesCount = 0;
    let recoveredBatchesCount = 0;
    const inFlightBatchKeys = new Set(); // Prevents concurrent retries of same batch (Requirement 13)

    const reportProgress = (statusMsg = '') => {
      if (typeof onProgress === 'function') {
        onProgress({
          stage: 'stage3_ocr',
          completedBatches: completedBatchesCount,
          totalBatches: Math.max(completedBatchesCount, totalBatchesEstimated),
          completedFrames: completedMap.size,
          totalFrames: totalCandidateFrames,
          modelUsed: activeWorkingModel,
          retriesCount,
          concurrency: adaptiveConcurrency,
          statusMessage: statusMsg,
        });
      }
    };

    reportProgress(resumedFromCheckpoint ? `Resumed (${completedMap.size}/${totalCandidateFrames} frames from checkpoint)` : 'Starting Vision OCR...');

    const geminiBatchStart = Date.now();
    while (batchQueue.length > 0) {
      checkAbort();

      const currentWave = [];
      while (currentWave.length < adaptiveConcurrency && batchQueue.length > 0) {
        const nextBatch = batchQueue.shift();
        if (inFlightBatchKeys.has(nextBatch.batchId)) continue;
        inFlightBatchKeys.add(nextBatch.batchId);
        currentWave.push(nextBatch);
      }

      if (currentWave.length === 0) break;

      const waveResults = await Promise.allSettled(
        currentWave.map(async (batch) => {
          checkAbort();
          const observations = await executeSingleVisionBatch(batch.frames);
          return { batch, observations };
        })
      );

      for (let wIdx = 0; wIdx < waveResults.length; wIdx++) {
        const item = waveResults[wIdx];
        const originalBatch = currentWave[wIdx];
        inFlightBatchKeys.delete(originalBatch.batchId);

        if (item.status === 'fulfilled') {
          const obsList = item.value.observations || [];
          const verifiedObsList = obsList.filter((obs) => obs.isVerified);
          const unverifiedObsList = obsList.filter((obs) => !obs.isVerified);

          for (const obs of verifiedObsList) {
            const t = parseFloat(obs.timestampSec.toFixed(2));
            const existing = completedMap.get(t);
            if (existing && existing.userOverridden) continue;
            if (existing && existing.hasText && existing.chineseText && (!obs.hasText || !obs.chineseText)) continue;
            completedMap.set(t, { ...obs, ocrEngine: 'gemini-vision' });
            unresolvedMap.delete(t);
            geminiVerifiedCount++;
          }

          if (unverifiedObsList.length > 0) {
            console.warn(`[Stage 3 OCR] ⚠️ Batch at ${originalBatch.frames[0]?.timestampSec}s returned ${verifiedObsList.length}/${obsList.length} verified frames (${unverifiedObsList.length} missing/unresolved).`);

            const missingFramesToRetry = originalBatch.frames.filter((f) => {
              const t = parseFloat(f.timestampSec.toFixed(2));
              return !completedMap.has(t);
            });

            if (missingFramesToRetry.length > 0 && (originalBatch.splitDepth || 0) < 3) {
              const subBatch = {
                batchId: `${originalBatch.batchId}_retry_unres_${Date.now()}`,
                frames: missingFramesToRetry,
                splitDepth: (originalBatch.splitDepth || 0) + 1,
              };
              totalBatchesEstimated += 1;
              batchQueue.unshift(subBatch);
              console.log(`[Stage 3 OCR] 🔄 Queued retry for ${missingFramesToRetry.length} unresolved frame(s)...`);
            } else {
              for (const unres of unverifiedObsList) {
                const t = parseFloat(unres.timestampSec.toFixed(2));
                unresolvedMap.set(t, unres);
              }
              failedBatchesCount++;
            }
          }

          if (verifiedObsList.length > 0) {
            completedBatchesCount++;
            geminiBatchCount++;
            consecutiveSuccesses++;

            // Conservative recovery: recover to concurrency 2 after 3 consecutive successes
            if (consecutiveSuccesses >= 3 && adaptiveConcurrency < 2) {
              adaptiveConcurrency = 2;
              console.log('[Stage 3 OCR] ⚡ Concurrency recovered to 2 after demonstrated successes');
            }
          }

          // Persist atomically after each verified batch (Requirement 7)
          if (checkpointPath) {
            saveProgress({
              version: 1,
              videoPath,
              startOffsetSec: Math.round(startOffsetSec),
              durationSec: Math.round(durationSec),
              updatedAt: Date.now(),
              rawObservations: [...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values())].sort((a, b) => a.timestampSec - b.timestampSec),
              completedBatchesCount,
              totalCandidateFrames,
              completed: unresolvedMap.size === 0 && completedMap.size === totalCandidateFrames,
              hasUnresolvedFrames: unresolvedMap.size > 0,
              unresolvedCount: unresolvedMap.size,
            });
          }

          reportProgress(`Batch processed (${completedMap.size}/${totalCandidateFrames} frames verified${unresolvedMap.size > 0 ? `, ${unresolvedMap.size} unresolved` : ''})`);
        } else {
          // Failure on this batch
          retriesCount++;
          const batchErr = item.reason || new Error('Batch failed');
          if (batchErr?.name === 'AbortError' || signal?.aborted) {
            throw batchErr?.name === 'AbortError' ? batchErr : createAbortError('Stage 3 OCR aborted');
          }

          lastBatchError = batchErr.message;
          consecutiveSuccesses = 0;

          // Adaptive concurrency reduction (Requirement 5)
          if (adaptiveConcurrency > 1) {
            console.warn(`[Stage 3 OCR] ⚠️ Overload detected on batch at ${originalBatch.frames[0]?.timestampSec}s. Reducing concurrency to 1.`);
            adaptiveConcurrency = 1;
          }

          // Adaptive batch splitting without discarding source frames (Requirement 6)
          if (originalBatch.frames.length > 1) {
            batchSplitsCount++;
            const mid = Math.ceil(originalBatch.frames.length / 2);
            const subBatch1 = {
              batchId: `${originalBatch.batchId}_s1`,
              frames: originalBatch.frames.slice(0, mid),
              splitDepth: (originalBatch.splitDepth || 0) + 1,
            };
            const subBatch2 = {
              batchId: `${originalBatch.batchId}_s2`,
              frames: originalBatch.frames.slice(mid),
              splitDepth: (originalBatch.splitDepth || 0) + 1,
            };
            totalBatchesEstimated += 1;
            batchQueue.unshift(subBatch2);
            batchQueue.unshift(subBatch1);
            console.warn(
              `[Stage 3 OCR] 🔀 Batch at ${originalBatch.frames[0]?.timestampSec}s failed (${lastBatchError}). Split into sub-batches (${subBatch1.frames.length} & ${subBatch2.frames.length} frames) without discarding frames. (Total splits: ${batchSplitsCount})`
            );
            recoveredBatchesCount++;
          } else {
            // Single frame batch that failed repeatedly across all models
            // Mark unresolved OCR as failed/review_needed without classifying as completed
            const failedFrame = originalBatch.frames[0];
            const fallbackObs = {
              timestampSec: failedFrame.timestampSec,
              reportedSec: failedFrame.timestampSec,
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
              ocrStatus: 'failed',
              ocrFailed: true,
              isVerified: false,
              isVerifiedEmpty: false,
              reviewNeeded: true,
              uncertainOcr: true,
              failureReason: lastBatchError || 'Exhausted retries across cascade models',
            };
            const t = parseFloat(failedFrame.timestampSec.toFixed(2));
            unresolvedMap.set(t, fallbackObs);
            failedBatchesCount++;
            console.warn(`[Stage 3 OCR] ⚠️ Frame at ${failedFrame.timestampSec}s unresolved after retries. Marked as review_needed (not completed).`);

            if (checkpointPath) {
              saveProgress({
                version: 1,
                videoPath,
                startOffsetSec: Math.round(startOffsetSec),
                durationSec: Math.round(durationSec),
                updatedAt: Date.now(),
                rawObservations: [...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values())].sort((a, b) => a.timestampSec - b.timestampSec),
                completedBatchesCount,
                totalCandidateFrames,
                completed: false,
                hasUnresolvedFrames: true,
                unresolvedCount: unresolvedMap.size,
              });
            }
          }
        }
      }

      const pacingMs = adaptiveConcurrency === 1 ? 750 : 350;
      if (batchQueue.length > 0) {
        await sleepOrAbort(pacingMs, signal);
      }
    }
    geminiVerificationMs = Date.now() - geminiBatchStart;

    // Account for all candidate frames:
    for (const c of candidateTimestamps) {
      const t = parseFloat(Number(c.timestampSec).toFixed(2));
      if (!completedMap.has(t) && !unresolvedMap.has(t)) {
        unresolvedMap.set(t, {
          timestampSec: t,
          reportedSec: t,
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
          failureReason: 'Frame unreached during batch execution',
        });
      }
    }
    function getObservation(targetT) {
      const roundedT = parseFloat(Number(targetT).toFixed(2));
      if (completedMap.has(roundedT)) {
        return completedMap.get(roundedT);
      }
      if (unresolvedMap.has(roundedT)) {
        return unresolvedMap.get(roundedT);
      }
      return { timestampSec: targetT, hasText: false, chineseText: '', isVerified: false, ocrStatus: 'missing', ocrFailed: true };
    }

    // 4. STEP 2: Double-Read Verification per Candidate Cue State
    evaluatedCueStates.length = 0;
    const statesNeedingTieBreak = [];

    if (cueStates.length > 0) {
      for (const cs of cueStates) {
        const obsA = getObservation(cs.sampleASec);
        const obsB = getObservation(cs.sampleBSec);

        const hasA = Boolean(obsA && obsA.hasText && obsA.chineseText);
        const hasB = Boolean(obsB && obsB.hasText && obsB.chineseText);
        const textA = hasA ? obsA.chineseText : '';
        const textB = hasB ? obsB.chineseText : '';

        // If neither frame contained text, this state is non-dialogue (motion or silence)
        if (!hasA && !hasB) {
          continue;
        }

        // If both reads have text and are equivalent -> ACCEPT with high confidence
        if (hasA && hasB && sameSubtitleText(textA, textB)) {
          const resolvedText = textA.length >= textB.length ? textA : textB;
          const gA = obsA.visualGender || obsA.speakerGender || 'unknown';
          const gB = obsB.visualGender || obsB.speakerGender || 'unknown';
          const resolvedVisualGender = gA === gB ? gA : (gA !== 'unknown' ? gA : gB);
          const resolvedVisualHint = obsA.speakerVisualHint || obsB.speakerVisualHint || '';
          const resolvedDelivery = (obsA.deliveryType && obsA.deliveryType !== 'dialogue')
            ? obsA.deliveryType
            : (obsB.deliveryType || 'dialogue');
          evaluatedCueStates.push({
            ...cs,
            textZh: resolvedText,
            originalChineseText: resolvedText,
            chineseText: resolvedText,
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            visualGender: resolvedVisualGender,
            speakerVisualHint: resolvedVisualHint,
            deliveryType: resolvedDelivery,
            genderVotes: {
              [gA]: 1,
              [gB]: (gA === gB ? 2 : 1),
            },
          });
        } else if (hasA && hasB && !sameSubtitleText(textA, textB)) {
          // Both frames have valid distinct Chinese dialogue text!
          // Split at transition peak in frameDiffs or midpoint so neither line is dropped
          let splitT = parseFloat(((cs.sampleASec + cs.sampleBSec) / 2).toFixed(2));
          const idxA = Math.round((cs.sampleASec - safeStartSec) / stepDiff);
          const idxB = Math.round((cs.sampleBSec - safeStartSec) / stepDiff);
          let maxD = 0;
          for (let k = Math.max(0, idxA); k <= Math.min(frameDiffs.length - 1, idxB); k++) {
            const d = frameDiffs[k];
            if (d && (d.subDiff || 0) > maxD) {
              maxD = d.subDiff;
              splitT = d.timestampSec;
            }
          }
          const s1 = cs.startSec;
          const e1 = parseFloat(Math.max(s1 + 0.35, Math.min(cs.endSec - 0.35, splitT)).toFixed(2));
          const s2 = e1;
          const e2 = cs.endSec;

          const gA = obsA.visualGender || obsA.speakerGender || 'unknown';
          const gB = obsB.visualGender || obsB.speakerGender || 'unknown';

          evaluatedCueStates.push({
            ...cs,
            startSec: s1,
            endSec: e1,
            duration: parseFloat((e1 - s1).toFixed(2)),
            textZh: textA,
            originalChineseText: textA,
            chineseText: textA,
            ocrConfidence: obsA.isSharp ? 'high' : 'medium',
            reviewNeeded: !obsA.isSharp,
            ocrDisagreement: false,
            uncertainOcr: !obsA.isSharp,
            visualGender: gA,
            speakerVisualHint: obsA.speakerVisualHint || '',
            deliveryType: obsA.deliveryType || 'dialogue',
            genderVotes: { [gA]: 1 },
          });

          evaluatedCueStates.push({
            ...cs,
            startSec: s2,
            endSec: e2,
            duration: parseFloat((e2 - s2).toFixed(2)),
            textZh: textB,
            originalChineseText: textB,
            chineseText: textB,
            ocrConfidence: obsB.isSharp ? 'high' : 'medium',
            reviewNeeded: !obsB.isSharp,
            ocrDisagreement: false,
            uncertainOcr: !obsB.isSharp,
            visualGender: gB,
            speakerVisualHint: obsB.speakerVisualHint || '',
            deliveryType: obsB.deliveryType || 'dialogue',
            genderVotes: { [gB]: 1 },
          });
        } else if (hasA && !hasB && obsA.isSharp) {
          // Short dialogue cue (< 1s): textA appeared at startSec and ended before sampleBSec
          let disappearT = parseFloat((cs.sampleBSec - 0.05).toFixed(2));
          const idxA = Math.round((cs.sampleASec - safeStartSec) / stepDiff);
          const idxB = Math.round((cs.sampleBSec - safeStartSec) / stepDiff);
          for (let k = Math.max(0, idxA); k <= Math.min(frameDiffs.length - 1, idxB); k++) {
            const d = frameDiffs[k];
            if (d && (d.isChange || d.subDiff >= 10.0)) {
              disappearT = d.timestampSec;
              break;
            }
          }
          const eSec = parseFloat(Math.max(cs.startSec + 0.35, Math.min(cs.endSec, disappearT)).toFixed(2));
          const gA = obsA.visualGender || obsA.speakerGender || 'unknown';
          evaluatedCueStates.push({
            ...cs,
            endSec: eSec,
            duration: parseFloat((eSec - cs.startSec).toFixed(2)),
            textZh: textA,
            originalChineseText: textA,
            chineseText: textA,
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            visualGender: gA,
            speakerVisualHint: obsA.speakerVisualHint || '',
            deliveryType: obsA.deliveryType || 'dialogue',
            genderVotes: { [gA]: 1 },
          });
        } else if (!hasA && hasB && obsB.isSharp) {
          // Dialogue cue appeared near sampleBSec
          let appearT = parseFloat((cs.sampleASec + 0.05).toFixed(2));
          const idxA = Math.round((cs.sampleASec - safeStartSec) / stepDiff);
          const idxB = Math.round((cs.sampleBSec - safeStartSec) / stepDiff);
          for (let k = Math.min(frameDiffs.length - 1, idxB); k >= Math.max(0, idxA); k--) {
            const d = frameDiffs[k];
            if (d && (d.isChange || d.subDiff >= 10.0)) {
              appearT = d.timestampSec;
              break;
            }
          }
          const sSec = parseFloat(Math.max(cs.startSec, Math.min(cs.endSec - 0.35, appearT)).toFixed(2));
          const gB = obsB.visualGender || obsB.speakerGender || 'unknown';
          evaluatedCueStates.push({
            ...cs,
            startSec: sSec,
            duration: parseFloat((cs.endSec - sSec).toFixed(2)),
            textZh: textB,
            originalChineseText: textB,
            chineseText: textB,
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            visualGender: gB,
            speakerVisualHint: obsB.speakerVisualHint || '',
            deliveryType: obsB.deliveryType || 'dialogue',
            genderVotes: { [gB]: 1 },
          });
        } else {
          // Disagreement (either one frame had text and one didn't, or different texts)
          statesNeedingTieBreak.push({
            cueState: cs,
            obsA,
            obsB,
          });
        }
      }

      // Execute tie-break read if any disagreements occurred
      if (statesNeedingTieBreak.length > 0) {
        checkAbort();
        const tieBreakStart = Date.now();
        console.log(`[Stage 3 OCR] Executing tie-break verification for ${statesNeedingTieBreak.length} candidate cue states...`);
        const tieTimes = [...new Set(statesNeedingTieBreak.map((n) => n.cueState.sampleTieSec))]
          .filter(t => !completedMap.has(t));
        const tieExtractStart = Date.now();
        let tieFrames = [];
        try {
          if (tieTimes.length) tieFrames = await extractFramesAtTimestamps(videoPath, tieTimes, tempDir, { signal });
        } catch (tieErr) {
          if (tieErr?.name === 'AbortError' || signal?.aborted) {
            throw tieErr?.name === 'AbortError' ? tieErr : createAbortError('Stage 3 OCR aborted');
          }
          tieFrames = [];
        }

        frameExtractionMs += Date.now() - tieExtractStart;
        const tieVisionStart = Date.now();
        if (tieFrames.length > 0) {
          for (let ti = 0; ti < tieFrames.length; ti += 15) {
            const tieSlice = tieFrames.slice(ti, ti + 15);
            try {
              const tieObsList = await executeSingleVisionBatch(tieSlice);
              for (const tobs of tieObsList) {
                const t = parseFloat(tobs.timestampSec.toFixed(2));
                if (tobs.isVerified) {
                  completedMap.set(t, tobs);
                  unresolvedMap.delete(t);
                } else {
                  unresolvedMap.set(t, tobs);
                }

              }
              if (checkpointPath) {
                saveProgress({
                  version: 1,
                  videoPath,
                  startOffsetSec: Math.round(startOffsetSec),
                  durationSec: Math.round(durationSec),
                  updatedAt: Date.now(),
                  rawObservations: [...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values())].sort((a, b) => a.timestampSec - b.timestampSec),
                  completedBatchesCount,
                  totalCandidateFrames,
                  completed: unresolvedMap.size === 0,
                  hasUnresolvedFrames: unresolvedMap.size > 0,
                  unresolvedCount: unresolvedMap.size,
                });
              }
            } catch (tieErr) {
              checkAbort();
              console.warn(`[Stage 3 OCR] Tie-break batch call failed: ${tieErr.message}`);
            }
          }
        }
        geminiVerificationMs += Date.now() - tieVisionStart;
        tieBreakMs = Date.now() - tieBreakStart;

        // Resolve each disagreement using tie-break read
        for (const item of statesNeedingTieBreak) {
          const { cueState: cs, obsA, obsB } = item;
          const obsTie = getObservation(cs.sampleTieSec);

          const textA = (obsA && obsA.hasText) ? obsA.chineseText : '';
          const textB = (obsB && obsB.hasText) ? obsB.chineseText : '';
          const textTie = (obsTie && obsTie.hasText) ? obsTie.chineseText : '';

          let resolvedText = '';
          let ocrConfidence = 'high';
          let reviewNeeded = false;
          let ocrDisagreement = false;
          let uncertainOcr = false;

          // Check pairwise majority
          if (textTie && textB && sameSubtitleText(textTie, textB)) {
            // Majority (2 of 3) votes for Sample B
            resolvedText = textB.length >= textTie.length ? textB : textTie;
          } else if (textTie && textA && sameSubtitleText(textTie, textA)) {
            // Majority (2 of 3) votes for Sample A
            resolvedText = textA.length >= textTie.length ? textA : textTie;
          } else if (textA && textB && sameSubtitleText(textA, textB)) {
            resolvedText = textA.length >= textB.length ? textA : textB;
          } else {
            // Still unresolved! Keep majority / first non-empty read BUT flag as low confidence
            resolvedText = textA || textB || textTie;
            ocrConfidence = 'low';
            reviewNeeded = true;
            ocrDisagreement = true;
            uncertainOcr = true;
          }

          if (resolvedText) {
            const votes = { male: 0, female: 0, unknown: 0 };
            let resolvedVisualHint = '';
            let resolvedDelivery = 'dialogue';
            [obsA, obsB, obsTie].forEach((o) => {
              if (!o) return;
              const g = o.visualGender || o.speakerGender;
              if (g) votes[g] = (votes[g] || 0) + 1;
              if (!resolvedVisualHint && o.speakerVisualHint) resolvedVisualHint = o.speakerVisualHint;
              if (resolvedDelivery === 'dialogue' && o.deliveryType && o.deliveryType !== 'dialogue') {
                resolvedDelivery = o.deliveryType;
              }
            });
            const resolvedVisualGender = votes.female > votes.male && votes.female > 0
              ? 'female'
              : (votes.male > votes.female && votes.male > 0 ? 'male' : 'unknown');

            evaluatedCueStates.push({
              ...cs,
              textZh: resolvedText,
              originalChineseText: resolvedText,
              chineseText: resolvedText,
              ocrConfidence,
              reviewNeeded,
              ocrDisagreement,
              uncertainOcr,
              visualGender: resolvedVisualGender,
              speakerVisualHint: resolvedVisualHint,
              deliveryType: resolvedDelivery,
              genderVotes: votes,
            });
          }
        }
      }
    }

    rawObservations.length = 0;
    rawObservations.push(...Array.from(completedMap.values()), ...Array.from(unresolvedMap.values()));
    rawObservations.sort((a, b) => a.timestampSec - b.timestampSec);
    const hasUnresolvedFrames = unresolvedMap.size > 0;
    const isComplete = !hasUnresolvedFrames;

    if (apiCallsCount > 0 && retriesCount >= apiCallsCount) {
      console.warn(`[Stage 3 Extract Subtitles] Notice: Vision OCR batch calls failed (${lastBatchError}). Continuing with Audio ASR as primary source.`);
    }

  function resolveGenderFromVotes(genderVotes = {}, explicitVisualGender = null) {
    const mCount = genderVotes.male || 0;
    const fCount = genderVotes.female || 0;
    const uCount = genderVotes.unknown || 0;
    const total = mCount + fCount + uCount;

    let resolvedGender = 'unknown';
    let resolvedConfidence = 0.5;

    if (fCount > mCount && fCount > 0) {
      resolvedGender = 'female';
      resolvedConfidence = parseFloat((fCount / Math.max(1, total)).toFixed(2));
    } else if (mCount > fCount && mCount > 0) {
      resolvedGender = 'male';
      resolvedConfidence = parseFloat((mCount / Math.max(1, total)).toFixed(2));
    } else if (explicitVisualGender === 'female' || explicitVisualGender === 'male') {
      resolvedGender = explicitVisualGender;
      resolvedConfidence = 0.85;
    }

    const voiceGender = resolvedGender === 'female' ? 'female' : 'male';
    const khmerVoiceId = voiceGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';

    return {
      visualGender: resolvedGender,
      speakerGender: resolvedGender.toUpperCase(),
      voiceGender,
      gender: voiceGender,
      genderConfidence: resolvedConfidence,
      khmerVoiceId,
      voiceId: khmerVoiceId,
    };
  }

  // STEP 2B: Recover valid rawObservations with text that were not covered in evaluatedCueStates
  if (Array.isArray(rawObservations) && rawObservations.length > 0) {
    const uncapturedObservations = rawObservations.filter((obs) => {
      if (!obs.hasText || !obs.chineseText || normalizeChineseChars(obs.chineseText).length === 0) {
        return false;
      }
      const isCovered = evaluatedCueStates.some((c) => {
        return (c.startSec - 0.25 <= obs.timestampSec && obs.timestampSec <= c.endSec + 0.25) &&
          sameSubtitleText(c.originalChineseText, obs.chineseText);
      });
      return !isCovered;
    });

    if (uncapturedObservations.length > 0) {
      console.log(`[Stage 3 OCR] Recovering ${uncapturedObservations.length} valid subtitle observation(s) outside primary cue states...`);
      const stepDiff = 0.2;
      const safeStartSec = Math.max(0, Number(startOffsetSec) || 0);
      const endSec = durationSec > 0 ? safeStartSec + durationSec : (safeStartSec + 10);
      for (const obs of uncapturedObservations) {
        const t = obs.timestampSec;
        const tIdx = Math.round((t - safeStartSec) / stepDiff);
        let onset = Math.max(safeStartSec, t - 0.5);
        for (let k = tIdx; k >= Math.max(0, tIdx - 10); k--) {
          const d = frameDiffs[k];
          if (d && (d.isChange || d.subDiff >= 10.0)) {
            onset = d.timestampSec;
            break;
          }
        }
        let offset = Math.min(endSec, t + 1.0);
        for (let k = tIdx + 1; k <= Math.min(frameDiffs.length - 1, tIdx + 12); k++) {
          const d = frameDiffs[k];
          if (d && (d.isChange || d.subDiff >= 10.0)) {
            offset = d.timestampSec;
            break;
          }
        }
        const sSec = parseFloat(Math.max(safeStartSec, onset).toFixed(2));
        const eSec = parseFloat(Math.max(sSec + 0.35, offset).toFixed(2));
        const dur = parseFloat((eSec - sSec).toFixed(2));

        evaluatedCueStates.push({
          startSec: sSec,
          endSec: eSec,
          duration: dur,
          textZh: obs.chineseText,
          originalChineseText: obs.chineseText,
          chineseText: obs.chineseText,
          ocrConfidence: obs.isSharp ? 'high' : 'medium',
          reviewNeeded: !obs.isSharp,
          ocrDisagreement: false,
          uncertainOcr: !obs.isSharp,
          visualGender: obs.visualGender || 'unknown',
          speakerVisualHint: obs.speakerVisualHint || '',
          deliveryType: obs.deliveryType || 'dialogue',
          genderVotes: { [obs.visualGender || 'unknown']: 1 },
        });
      }
    }
  }

  // STEP 3: Boundaries from change points & Deduplication
  const visualSegments = [];

  if (evaluatedCueStates && evaluatedCueStates.length > 0) {
    evaluatedCueStates.sort((a, b) => a.startSec - b.startSec);

    // Pass 2: Merge adjacent states ONLY when Chinese text is equivalent AND gap < 0.20s
    for (const cue of evaluatedCueStates) {
      if (visualSegments.length === 0) {
        visualSegments.push({ ...cue });
        continue;
      }
      const prev = visualSegments[visualSegments.length - 1];
      const isAdjacent = (cue.startSec - prev.endSec) < 0.20;
      const isEquivalent = sameSubtitleText(prev.originalChineseText, cue.originalChineseText);

      if (isAdjacent && isEquivalent) {
        prev.endSec = Math.max(prev.endSec, cue.endSec);
        prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
        if (cue.originalChineseText.length > prev.originalChineseText.length) {
          prev.originalChineseText = cue.originalChineseText;
          prev.chineseText = cue.originalChineseText;
          prev.textZh = cue.originalChineseText;
        }
        if (cue.ocrConfidence === 'low') {
          prev.ocrConfidence = 'low';
          prev.reviewNeeded = true;
          prev.ocrDisagreement = true;
          prev.uncertainOcr = true;
        }
        if (!prev.speakerVisualHint && cue.speakerVisualHint) {
          prev.speakerVisualHint = cue.speakerVisualHint;
        }
        if ((!prev.deliveryType || prev.deliveryType === 'dialogue') && cue.deliveryType && cue.deliveryType !== 'dialogue') {
          prev.deliveryType = cue.deliveryType;
        }
        if (cue.genderVotes) {
          for (const [k, v] of Object.entries(cue.genderVotes)) {
            prev.genderVotes[k] = (prev.genderVotes[k] || 0) + v;
          }
        }
      } else {
        // Prevent overlaps between distinct consecutive cues
        if (cue.startSec < prev.endSec) {
          prev.endSec = parseFloat(Math.max(prev.startSec + 0.35, cue.startSec).toFixed(2));
          prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
        }
        visualSegments.push({ ...cue });
      }
    }
  } else {
    // Fallback: Group continuous frame observations if cueStates was empty
    let currentSegment = null;
    for (let i = 0; i < rawObservations.length; i++) {
      const obs = rawObservations[i];
      if (!obs.hasText) {
        if (currentSegment) {
          const endSec = parseFloat(obs.timestampSec.toFixed(2));
          const dur = Math.max(0.35, parseFloat((endSec - currentSegment.startSec).toFixed(2)));
          const genderData = resolveGenderFromVotes(currentSegment.genderVotes, currentSegment.visualGender);
          visualSegments.push({
            ...currentSegment,
            endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
            duration: dur,
            verifiedDisappearance: true,
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            ...genderData,
          });
          currentSegment = null;
        }
        continue;
      }

      if (!currentSegment) {
        const startSec = parseFloat(obs.timestampSec.toFixed(2));
        const genderVotes = { male: 0, female: 0, unknown: 0 };
        const obsGender = obs.visualGender || obs.speakerGender;
        if (obsGender) genderVotes[obsGender] = (genderVotes[obsGender] || 0) + 1;

        currentSegment = {
          textZh: obs.chineseText,
          originalChineseText: obs.chineseText,
          startSec,
          lastObservedSec: startSec,
          position: obs.position,
          isSharp: obs.isSharp,
          frameCount: 1,
          source: 'visual_ocr',
          visualGender: obsGender || 'unknown',
          speakerVisualHint: obs.speakerVisualHint || '',
          deliveryType: obs.deliveryType || 'dialogue',
          genderVotes,
        };
      } else {
        const isContinuation = sameSubtitleText(obs.chineseText, currentSegment.originalChineseText);
        if (isContinuation) {
          currentSegment.lastObservedSec = parseFloat(obs.timestampSec.toFixed(2));
          currentSegment.frameCount++;
          if (obs.chineseText.length > currentSegment.originalChineseText.length) {
            currentSegment.originalChineseText = obs.chineseText;
            currentSegment.textZh = obs.chineseText;
          }
          const obsGender = obs.visualGender || obs.speakerGender;
          if (obsGender) {
            currentSegment.genderVotes[obsGender] = (currentSegment.genderVotes[obsGender] || 0) + 1;
          }
          if (!currentSegment.speakerVisualHint && obs.speakerVisualHint) {
            currentSegment.speakerVisualHint = obs.speakerVisualHint;
          }
          if (currentSegment.deliveryType === 'dialogue' && obs.deliveryType && obs.deliveryType !== 'dialogue') {
            currentSegment.deliveryType = obs.deliveryType;
          }
        } else {
          const endSec = parseFloat(obs.timestampSec.toFixed(2));
          const dur = Math.max(0.35, parseFloat((endSec - currentSegment.startSec).toFixed(2)));
          const genderData = resolveGenderFromVotes(currentSegment.genderVotes, currentSegment.visualGender);
          visualSegments.push({
            ...currentSegment,
            endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
            duration: dur,
            verifiedDisappearance: true,
            ocrConfidence: 'high',
            reviewNeeded: false,
            ocrDisagreement: false,
            uncertainOcr: false,
            ...genderData,
          });

          const startSec = parseFloat(obs.timestampSec.toFixed(2));
          const genderVotes = { male: 0, female: 0, unknown: 0 };
          const obsGender = obs.visualGender || obs.speakerGender;
          if (obsGender) genderVotes[obsGender] = (genderVotes[obsGender] || 0) + 1;

          currentSegment = {
            textZh: obs.chineseText,
            originalChineseText: obs.chineseText,
            startSec,
            lastObservedSec: startSec,
            position: obs.position,
            isSharp: obs.isSharp,
            frameCount: 1,
            source: 'visual_ocr',
            visualGender: obsGender || 'unknown',
            speakerVisualHint: obs.speakerVisualHint || '',
            deliveryType: obs.deliveryType || 'dialogue',
            genderVotes,
          };
        }
      }
    }

    if (currentSegment) {
      const estimatedEnd = currentSegment.lastObservedSec > currentSegment.startSec
        ? parseFloat((currentSegment.lastObservedSec + baseStepSec).toFixed(2))
        : parseFloat((currentSegment.startSec + 1.2).toFixed(2));
      const dur = Math.max(0.35, parseFloat((estimatedEnd - currentSegment.startSec).toFixed(2)));
      const genderData = resolveGenderFromVotes(currentSegment.genderVotes, currentSegment.visualGender);
      visualSegments.push({
        ...currentSegment,
        endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
        duration: dur,
        verifiedDisappearance: currentSegment.frameCount > 1,
        ocrConfidence: 'high',
        reviewNeeded: false,
        ocrDisagreement: false,
        uncertainOcr: false,
        ...genderData,
      });
    }
  }

  // Finalize segments with valid timecodes, gender resolution, and minimum duration 0.35s (supports rapid short cues)
  const finalizedVisualSegments = visualSegments.map((s, idx) => {
    const rawDur = parseFloat((s.endSec - s.startSec).toFixed(2));
    const dur = Math.max(0.35, rawDur);
    const endSec = parseFloat((s.startSec + dur).toFixed(2));
    const genderData = resolveGenderFromVotes(s.genderVotes, s.visualGender);
    const resolvedChinese = s.originalChineseText || s.chineseText || s.textZh || '';

    return {
      ...s,
      id: idx + 1,
      segmentId: idx + 1,
      endSec,
      duration: dur,
      textZh: resolvedChinese,
      originalChineseText: resolvedChinese,
      chineseText: resolvedChinese,
      visualGender: genderData.visualGender || s.visualGender || 'unknown',
      speakerVisualHint: s.speakerVisualHint || '',
      deliveryType: s.deliveryType || 'dialogue',
      ocrConfidence: s.ocrConfidence || 'high',
      reviewNeeded: Boolean(s.reviewNeeded),
      ocrDisagreement: Boolean(s.ocrDisagreement),
      uncertainOcr: Boolean(s.uncertainOcr || s.ocrConfidence === 'low'),
      source: 'visual_ocr',
      ...genderData,
    };
  });

  ocrWallTimeMs = Date.now() - stage3StartTime;

  const performance = {
    wallTimeMs: ocrWallTimeMs,
    totalStage3Ms: ocrWallTimeMs,
    ffmpegPrepassMs,
    frameExtractionMs,
    localOcrMs,
    geminiVerificationMs,
    retrySleepMs: telemetry.retrySleepMs,
    tieBreakMs,
    candidateFramesCount: totalCandidateFrames,
    localCheckpointReusedFramesCount: sortedTimes.filter(t => localOnResume.has(t) && !verifiedOnResume.has(t)).length,
    checkpointReusedFramesCount: sortedTimes.filter(t => verifiedOnResume.has(t)).length,
    localAvailabilityMs,
    ...localTelemetry,
    localOcrFramesCount,
    actualOcrFramesCount,
    localVerifiedCount,
    geminiVerifiedCount,
    geminiActualAttemptsCount: telemetry.attempts || 0,
    geminiBatchCount,
    geminiFallbackFramesCount: geminiRequestedTimes.size,
    dedupedFramesCount,
    unresolvedFramesCount: unresolvedMap.size,
    finalChineseCuesCount: finalizedVisualSegments.length,
    workerStartupMs,
    rapidOcrInitMs,
    avgMsPerFrame,
    peakMemoryMb: parseFloat((process.resourceUsage().maxRSS / 1024).toFixed(1)),
  };

  const ocrEngineLabel = isLocalOcrActive ? (geminiRequestedTimes.size > 0 ? 'hybrid-rapidocr-gemini' : 'rapidocr-local') : 'gemini-vision';
  const ocrWallTimeSec = (ocrWallTimeMs / 1000).toFixed(1);
  console.log(`[Stage 3 Extract Subtitles] OCR engine: ${ocrEngineLabel} (${activeWorkingModel}, wall time: ${ocrWallTimeSec}s, local OCR: ${(localOcrMs / 1000).toFixed(1)}s, api: ${(telemetry.apiTotalMs / 1000).toFixed(1)}s, prepass: ${(ffmpegPrepassMs / 1000).toFixed(1)}s, calls: ${apiCallsCount}, localVerified: ${localVerifiedCount}, geminiVerified: ${geminiVerifiedCount}, deduped: ${dedupedFramesCount}, ${finalizedVisualSegments.length} cues)`);
  console.log(`[Stage 3 Extract Subtitles] Completed with ${finalizedVisualSegments.length} deduplicated visual segments detected from ${rawObservations.length} observations.`);

  const result = {
    rawObservations,
    visualSegments: finalizedVisualSegments,
    hasUnresolvedFrames,
    isComplete,
    unresolvedFrames: Array.from(unresolvedMap.values()),
    ocrMeta: {
      independentSamples: true,
      totalFramesSampled: rawObservations.length,
      totalObservations: rawObservations.length,
      detectedSegmentsCount: finalizedVisualSegments.length,
      verifiedFramesCount: completedMap.size,
      unresolvedFramesCount: unresolvedMap.size,
      hasUnresolvedFrames,
      isComplete,
      status: isComplete ? 'completed' : 'review_needed',
      baseStepSec,
      apiCallsCount,
      retriesCount,
      batchSplitsCount,
      dedupedFramesCount,
      performance,
      modelUsed: activeWorkingModel,
      ocrEngine: ocrEngineLabel,
      wallTimeMs: ocrWallTimeMs,
      totalStage3Ms: ocrWallTimeMs,
      ffmpegPrepassMs,
      frameExtractionMs,
      localOcrMs,
      geminiVerificationMs,
      workerStartupMs,
      rapidOcrInitMs,
      avgMsPerFrame,
      actualOcrFramesCount,
      localVerifiedCount,
      geminiVerifiedCount,
      geminiBatchCount,
      hasVisualSubtitles: finalizedVisualSegments.length > 0,
      ocrNotice: lastBatchError || (hasUnresolvedFrames ? `${unresolvedMap.size} unresolved frame(s) require review` : null),
      adaptiveConcurrency,
      failedBatchesCount,
      recoveredBatchesCount,
      completedBatchesCount,
      resumedFromCheckpoint,
    },
  };

  // Only cache on disk if completely resolved with NO unresolved frames
  if (cachePath && isComplete && finalizedVisualSegments.length > 0) {
    try {
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
      console.log(`[Stage 3 OCR] 💾 Cached ${finalizedVisualSegments.length} segments to ${path.basename(cachePath)}`);
    } catch (_) {}
  } else if (cachePath && !isComplete) {
    console.warn(`[Stage 3 OCR] ⚠️ Skipping disk cache write: ${unresolvedMap.size} frame(s) remain unresolved.`);
  }

  if (checkpointPath && fs.existsSync(checkpointPath)) {
    try {
      saveProgress({
        ...(loadOcrCheckpoint(checkpointPath) || {}),
        completed: isComplete,
        hasUnresolvedFrames,
        unresolvedCount: unresolvedMap.size,
        finalizedAt: Date.now(),
      });
    } catch (_) {}
  }

    return result;
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

/**
 * Deduplicate raw OCR cues for Fast OCR mode and external subtitle imports.
 * Drops chunk-boundary repeats (equivalent CN text within 0.3s or overlapping).
 * Merges truly continuous duplicates of the same text when gap < 0.20s by extending endSec.
 * Supports short dialogue cues down to 0.35s and preserves visualGender, speakerVisualHint, and deliveryType.
 * Applies Fast OCR speaker/gender defaults: speakerSource: 'ocr_only', unverifiedSpeaker: true.
 *
 * @param {Array<object>} rawCues
 * @param {string} [defaultGender='male']
 * @returns {Array<object>}
 */
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
    const rawCueText = String(cue.originalChineseText || cue.chineseText || cue.textZh || cue.text || '').trim();
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
        textZh: cueText,
        originalChineseText: cueText,
        chineseText: cueText,
        visualGender: cue.visualGender || 'unknown',
        speakerVisualHint: cue.speakerVisualHint || '',
        deliveryType: cue.deliveryType || 'dialogue',
        source: 'visual_ocr',
        evidenceSource: 'visual_ocr',
        evidenceType: 'visual_only',
      });
      continue;
    }

    const prev = deduped[deduped.length - 1];
    const prevText = String(prev.originalChineseText || prev.chineseText || prev.textZh || '').trim();
    const isEq = areChineseTextsEquivalent(prevText, cueText);

    if (isEq) {
      const timeDiff = cStart - prev.startSec;
      const isChunkBoundaryRepeat = (Math.abs(timeDiff) <= 0.3) || (cStart < prev.endSec);
      const isContinuous = (cStart - prev.endSec) < 0.20;

      if (isContinuous || isChunkBoundaryRepeat) {
        if (cEnd > prev.endSec) {
          prev.endSec = parseFloat(Number(cEnd).toFixed(2));
          prev.duration = parseFloat(Math.max(0.35, prev.endSec - prev.startSec).toFixed(2));
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
      textZh: cueText,
      originalChineseText: cueText,
      chineseText: cueText,
      visualGender: cue.visualGender || 'unknown',
      speakerVisualHint: cue.speakerVisualHint || '',
      deliveryType: cue.deliveryType || 'dialogue',
      source: 'visual_ocr',
      evidenceSource: 'visual_ocr',
      evidenceType: 'visual_only',
    });
  }

  return deduped.map((seg, idx) => {
    const isUserOverridden = Boolean(seg.userOverridden);
    let resolvedGender;
    let resolvedVoice;
    let voiceMeta;

    if (isUserOverridden) {
      const existingVoice = seg.voiceId || seg.khmerVoiceId || seg.voice || '';
      const rawGender = String(seg.voiceGender || '').toLowerCase();
      if (rawGender === 'female' || rawGender === 'male') {
        resolvedGender = rawGender;
      } else if (existingVoice.includes('Sreymom')) {
        resolvedGender = 'female';
      } else if (existingVoice.includes('Piseth')) {
        resolvedGender = 'male';
      } else {
        resolvedGender = defGen;
      }
      voiceMeta = buildVoiceMeta(resolvedGender);
      resolvedVoice = existingVoice || voiceMeta.voiceId;
      if (resolvedVoice.includes('Sreymom')) {
        voiceMeta = buildVoiceMeta('female');
      } else if (resolvedVoice.includes('Piseth')) {
        voiceMeta = buildVoiceMeta('male');
      }
    } else {
      // Rule 1: Non-overridden Fast OCR defaults ALWAYS re-derive voiceId/khmerVoiceId/voice from final voiceGender
      const rawVisual = String(seg.visualGender || seg.voiceGender || '').toLowerCase();
      if (rawVisual === 'female' || rawVisual === 'male') {
        resolvedGender = rawVisual;
      } else {
        resolvedGender = defGen;
      }
      voiceMeta = buildVoiceMeta(resolvedGender);
      resolvedVoice = voiceMeta.voiceId;
    }

    const resolvedSpeaker = isUserOverridden ? (seg.speaker || seg.speakerName || 'តួអង្គ') : 'តួអង្គ';
    const resolvedSpeakerId = isUserOverridden ? (seg.speakerId || `spk_ocr_${idx + 1}`) : `spk_ocr_${idx + 1}`;
    const resolvedUnverified = isUserOverridden
      ? (seg.unverifiedSpeaker !== undefined ? Boolean(seg.unverifiedSpeaker) : (resolvedSpeaker === 'តួអង្គ'))
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

      // STEP 3: Speaker/gender WITHOUT ASR
      speakerSource: 'ocr_only',
      unverifiedSpeaker: resolvedUnverified,
      genderConfidence: isUserOverridden ? (seg.genderConfidence ?? null) : null,
      voiceGender: resolvedGender,
      gender: resolvedGender,
      speakerGender: resolvedGender.toUpperCase(),
      speaker: resolvedSpeaker,
      speakerName: resolvedSpeaker,
      speakerId: resolvedSpeakerId,
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
      ttsStatus: 'pending',
      status: 'needs_translation',
    };
  });
}

module.exports = {
  extractChineseSubtitles,
  parseVisionResponseFrames,
  normalizeChineseChars,
  stripDecorativeSubtitleNoise,
  areChineseTextsEquivalent,
  deduplicateFastOcrCues,
  isRetryableVisionError,
  isTimeoutOrOverloadError,
  classifyVisionError,
  extractRetryDelayMs,
  callGeminiVisionWithRetry,
  getOcrCachePath,
  getOcrCheckpointPath,
  saveOcrCheckpoint,
  loadOcrCheckpoint,
  CASCADE_VISION_MODELS,
  visionModelCooldownMap,
};
