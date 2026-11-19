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

function getOcrCachePath(videoPath, startOffsetSec = 0, durationSec = 0, modelName = '') {
  try {
    // កែពី ../../../../uploads/cache មកជា ../../../uploads/cache ឱ្យត្រូវជាមួយ Stage 1, 4 និង 9
    const cacheDir = path.resolve(__dirname, '../../../uploads/cache');
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

/**
 * Checks if an OCR vision error is retryable / temporary (429, 503, 504 Deadline Exceeded, timeouts).
 */
function isRetryableVisionError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  const msg = String(err.message || err.toString() || '').toUpperCase();
  return (
    status === 429 ||
    status === 503 ||
    status === 504 ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('EXHAUSTED') ||
    msg.includes('QUOTA') ||
    msg.includes('RATE LIMIT') ||
    msg.includes('TOO MANY REQUESTS') ||
    msg.includes('HIGH DEMAND') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('GATEWAY TIMEOUT') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('TIMEOUT')
  );
}

function isTimeoutOrOverloadError(err) {
  const msg = String(err?.message || '').toUpperCase();
  const status = err?.status || err?.code;
  return (
    status === 503 ||
    status === 504 ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('DEADLINE EXPIRED') ||
    msg.includes('GATEWAY TIMEOUT') ||
    msg.includes('HIGH DEMAND') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('TIMEOUT')
  );
}

/**
 * Helper: Call Gemini Vision with multi-model cascade and exponential backoff retry on 429 / 503 / 504
 */
async function callGeminiVisionWithRetry(aiClient, modelName, contents, maxRetries = 2, signal = null, onModelSuccess = null) {
  const preferred = modelName || geminiQuotaTracker.getPreferredPrimaryModel(CASCADE_VISION_MODELS[0]);
  const otherModels = CASCADE_VISION_MODELS.filter((m) => m !== preferred);
  const poolKeys = Array.isArray(aiClient?.pool?.keys) ? aiClient.pool.keys : [];
  const allCandidateModels = [preferred, ...otherModels];
  // Auto-demote exhausted models so healthy models (e.g. gemini-3.1-flash-lite) run first immediately
  const modelsToTry = poolKeys.length > 0
    ? geminiQuotaTracker.prioritizeAvailableModels(allCandidateModels, poolKeys)
    : allCandidateModels;
  let lastErr = null;

  for (const currentModel of modelsToTry) {
    let attempt = 0;
    while (attempt < maxRetries) {
      if (signal?.aborted) {
        throw createAbortError('Stage 3 OCR aborted');
      }
      let timeoutId = null;
      try {
        const timeoutMs = 25000;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Timeout: Gemini Vision OCR on ${currentModel} exceeded ${timeoutMs}ms deadline`));
          }, timeoutMs);
        });

        const callPromise = aiClient.models.generateContent({
          model: currentModel,
          contents,
          config: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        });

        const resp = await Promise.race([callPromise, timeoutPromise]);
        clearTimeout(timeoutId);

        if (typeof onModelSuccess === 'function') {
          onModelSuccess(currentModel);
        }
        return resp;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err?.name === 'AbortError' || signal?.aborted) {
          throw err?.name === 'AbortError' ? err : createAbortError('Stage 3 OCR aborted');
        }
        lastErr = err;
        attempt++;
        const isRetryable = isRetryableVisionError(err);
        if (!isRetryable) {
          throw err;
        }

        // Fast-fail: If Google hits 504/503/Timeout/Overload, DO NOT hang retry on the same dead model!
        // Immediately break to the next cascade model to prevent 4-5 minute stalls.
        if (isTimeoutOrOverloadError(err) || attempt >= maxRetries) {
          console.warn(`[Stage 3 OCR] Model ${currentModel} overloaded/timed out (${err.message}). Falling back immediately to next cascade model...`);
          geminiQuotaTracker.recordModelProbeStatus(currentModel, {
            statusCode: 504,
            message: err.message,
            latencyMs: 25000,
          });
          break;
        }

        const backoffMs = Math.min(2000, 1000 * attempt);
        await sleepOrAbort(backoffMs, signal);
      }
    }
  }

  throw lastErr || new Error('All cascade Gemini models exceeded quota/rate limits or timed out (429/503/504)');
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

  const cachePath = getOcrCachePath(videoPath, startOffsetSec, durationSec, effectiveModel);
  if (force && cachePath && fs.existsSync(cachePath)) {
    try { fs.unlinkSync(cachePath); } catch (_) {}
  }
  if (!force && cachePath && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached && Array.isArray(cached.visualSegments) && Array.isArray(cached.rawObservations) && cached.visualSegments.length > 0) {
        console.log(`[Stage 3 OCR] ⚡ Cache Hit: Reusing ${cached.visualSegments.length} visual segments from disk cache (${path.basename(cachePath)})`);
        return cached;
      }
    } catch (_) {}
  }

  const tempDir = path.join(os.tmpdir(), `sub_ocr_${Date.now()}_${process.pid}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const rawObservations = [];
  const evaluatedCueStates = [];
  let apiCallsCount = 0;
  let retriesCount = 0;
  let lastBatchError = null;
  let ocrWallTimeMs = 0;

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

    const diffMap = new Map();
    for (const d of frameDiffs) {
      diffMap.set(d.timestampSec, d);
    }

    // Schedule candidate frame timestamps:
    // (a) One frame shortly AFTER each change point (sampleASec) + mid-cue frame (sampleBSec)
    // (b) 0.75s baseline safety net deduplicated by timestamp (drops on static scenes)
    const scheduled = new Set();
    const candidateTimestamps = [];
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
        trySchedule(cs.sampleBSec, `cue_${cs.cueIndex}_sampleB`, 0.12);
      }
    } else {
      // Fallback: use raw changePoints if cueStates empty
      for (const cp of changePoints) {
        trySchedule(cp.timestampSec + 0.10, 'cp_onset', 0.12);
      }
    }

    // (b) Baseline safety net (0.75s grid deduplicated)
    const effectiveStep = Math.max(0.5, Number(baseStepSec) || 0.75);
    let curTime = safeStartSec === 0 ? 0.5 : safeStartSec + 0.3;
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

      if (!isCovered) {
        const idx = Math.round((curTime - safeStartSec) / stepDiff);
        const nearDiffs = frameDiffs.slice(Math.max(0, idx - 2), Math.min(frameDiffs.length, idx + 3));
        const maxNearDiff = nearDiffs.reduce((m, d) => Math.max(m, d.subDiff || d.diff || 0), 0);

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

    // Sort candidate frame timestamps chronologically
    candidateTimestamps.sort((a, b) => a.timestampSec - b.timestampSec);
    const sortedTimes = candidateTimestamps.map((c) => c.timestampSec);

    // 2. Extract candidate frames at scheduled timestamps
    checkAbort();
    let extractedFrames = [];
    try {
      extractedFrames = await extractFramesAtTimestamps(videoPath, sortedTimes, tempDir, { signal });
    } catch (extractErr) {
      if (extractErr?.name === 'AbortError' || signal?.aborted) {
        throw extractErr?.name === 'AbortError' ? extractErr : createAbortError('Stage 3 OCR aborted');
      }
      console.warn('[Stage 3 Extract Subtitles] Timestamp extraction error, attempting streaming fallback:', extractErr.message);
      const fps = Math.min(2.0, Math.max(0.8, parseFloat((1 / effectiveStep).toFixed(2))));
      extractedFrames = await extractFramesStreaming(videoPath, safeStartSec, durationSec, fps, tempDir, { signal });
    }

    if (!extractedFrames || extractedFrames.length === 0) {
      console.warn('[Stage 3 Extract Subtitles] No frames could be extracted for video');
      return {
        rawObservations: [],
        visualSegments: [],
        ocrMeta: { totalFramesSampled: 0, totalObservations: 0, detectedSegmentsCount: 0, modelUsed: effectiveModel },
      };
    }

    const framesToAnalyze = extractedFrames;
    console.log(`[Stage 3 Extract Subtitles] Detected ${changePoints.length} change points (${cueStates.length} candidate cue states). Prioritized ${framesToAnalyze.length} candidate frames for Vision OCR`);

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

    // Helper: Execute a batch call and push parsed frame observations
    async function executeVisionBatch(batch) {
      checkAbort();
      const contents = buildVisionBatchContents(batch);
      if (!contents) return;

      try {
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
          }
        );
        const rawText = typeof resp.text === 'function' ? resp.text() : resp.text;
        if (rawText) {
          const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          const parsed = JSON.parse(clean);
          const frames = Array.isArray(parsed.frames) ? parsed.frames : [];

          for (let fIdx = 0; fIdx < batch.length; fIdx++) {
            const fallbackTime = batch[fIdx].timestampSec;
            const f = frames[fIdx] || {};
            const tSec = typeof f.timestampSec === 'number' && !isNaN(f.timestampSec)
              ? parseFloat(f.timestampSec.toFixed(2))
              : fallbackTime;

            const rawChinese = String(f.textZh || f.chineseText || '').trim();
            const cText = stripDecorativeSubtitleNoise(rawChinese);
            const hasCleanText = Boolean(f.hasText && normalizeChineseChars(cText).length > 0);
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

            rawObservations.push({
              timestampSec: fallbackTime,
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
            });
          }
        }
      } catch (geminiErr) {
        if (geminiErr?.name === 'AbortError' || signal?.aborted) {
          throw geminiErr?.name === 'AbortError' ? geminiErr : createAbortError('Stage 3 OCR aborted');
        }
        retriesCount++;
        lastBatchError = geminiErr.message;
        console.error(`[Stage 3 Extract Subtitles] ❌ Batch OCR call failed at ${batch[0].timestampSec}s after full model cascade:`, geminiErr.message);
        throw new Error(`[Stage 3 Batch Failure] Batch at ${batch[0].timestampSec}s failed after cascade: ${geminiErr.message}`);
      }
    }

    // 3. Batch frames (15 frames per call) to Gemini Vision with Bounded Concurrency (2 batches at a time)
    console.log(`[Stage 3 Extract Subtitles] Running Gemini Vision OCR on ${framesToAnalyze.length} candidate frames...`);
    const ocrStartTime = Date.now();
    const BATCH_SIZE = 15;
    const batchList = [];
    for (let i = 0; i < framesToAnalyze.length; i += BATCH_SIZE) {
      batchList.push(framesToAnalyze.slice(i, i + BATCH_SIZE));
    }

    const CONCURRENCY = 2;
    for (let bIdx = 0; bIdx < batchList.length; bIdx += CONCURRENCY) {
      checkAbort();
      const activeBatches = batchList.slice(bIdx, bIdx + CONCURRENCY);
      await Promise.all(activeBatches.map((batch) => executeVisionBatch(batch)));

      if (bIdx + CONCURRENCY < batchList.length) {
        await sleepOrAbort(400, signal);
      }
    }
    ocrWallTimeMs = Date.now() - ocrStartTime;

    // Sort observations chronologically
    rawObservations.sort((a, b) => a.timestampSec - b.timestampSec);

    // Fast lookup helper to find observation closest to timestamp
    function getObservation(targetT) {
      let closest = null;
      let minD = 999;
      for (const obs of rawObservations) {
        const d = Math.abs(obs.timestampSec - targetT);
        if (d < minD) {
          minD = d;
          closest = obs;
        }
      }
      return minD <= 0.35 ? closest : { timestampSec: targetT, hasText: false, chineseText: '' };
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
        if (hasA && hasB && areChineseTextsEquivalent(textA, textB)) {
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
        console.log(`[Stage 3 OCR] Executing tie-break verification for ${statesNeedingTieBreak.length} candidate cue states...`);
        const tieTimes = statesNeedingTieBreak.map((n) => n.cueState.sampleTieSec);
        let tieFrames = [];
        try {
          tieFrames = await extractFramesAtTimestamps(videoPath, tieTimes, tempDir, { signal });
        } catch (tieErr) {
          if (tieErr?.name === 'AbortError' || signal?.aborted) {
            throw tieErr?.name === 'AbortError' ? tieErr : createAbortError('Stage 3 OCR aborted');
          }
          tieFrames = [];
        }

        if (tieFrames.length > 0) {
          await executeVisionBatch(tieFrames);
        }

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
          if (textTie && textB && areChineseTextsEquivalent(textTie, textB)) {
            // Majority (2 of 3) votes for Sample B
            resolvedText = textB.length >= textTie.length ? textB : textTie;
          } else if (textTie && textA && areChineseTextsEquivalent(textTie, textA)) {
            // Majority (2 of 3) votes for Sample A
            resolvedText = textA.length >= textTie.length ? textA : textTie;
          } else if (textA && textB && areChineseTextsEquivalent(textA, textB)) {
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

    if (apiCallsCount > 0 && retriesCount >= apiCallsCount) {
      console.warn(`[Stage 3 Extract Subtitles] Notice: Vision OCR batch calls failed (${lastBatchError}). Continuing with Audio ASR as primary source.`);
    }
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
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
      const isEquivalent = areChineseTextsEquivalent(prev.originalChineseText, cue.originalChineseText);

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
        const isContinuation = areChineseTextsEquivalent(obs.chineseText, currentSegment.originalChineseText);
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

  const ocrWallTimeSec = (ocrWallTimeMs / 1000).toFixed(1);
  console.log(`[Stage 3 Extract Subtitles] OCR engine: gemini-vision (${activeWorkingModel}, wall time: ${ocrWallTimeSec}s, api calls: ${apiCallsCount}, ${finalizedVisualSegments.length} cues)`);
  console.log(`[Stage 3 Extract Subtitles] Completed with ${finalizedVisualSegments.length} deduplicated visual segments detected from ${rawObservations.length} observations.`);

  const result = {
    rawObservations,
    visualSegments: finalizedVisualSegments,
    ocrMeta: {
      totalFramesSampled: rawObservations.length,
      totalObservations: rawObservations.length,
      detectedSegmentsCount: finalizedVisualSegments.length,
      baseStepSec,
      apiCallsCount,
      retriesCount,
      modelUsed: activeWorkingModel,
      ocrEngine: 'gemini-vision',
      wallTimeMs: ocrWallTimeMs,
      hasVisualSubtitles: finalizedVisualSegments.length > 0,
      ocrNotice: lastBatchError || null,
    },
  };

  if (cachePath && finalizedVisualSegments.length > 0) {
    try {
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
      console.log(`[Stage 3 OCR] 💾 Cached ${finalizedVisualSegments.length} segments to ${path.basename(cachePath)}`);
    } catch (_) {}
  }

  return result;
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
      resolvedGender = defGen;
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
  normalizeChineseChars,
  stripDecorativeSubtitleNoise,
  areChineseTextsEquivalent,
  deduplicateFastOcrCues,
  isRetryableVisionError,
  callGeminiVisionWithRetry,
  getOcrCachePath,
};
