const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractFramesStreaming, extractFramesAtTimestamps, extractSubtitleDifferenceGrid } = require('../../ffmpegService');
const { formatSecondsToTimecode } = require('../pipelineTypes');

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

/**
 * Generate comprehensive sampling timestamps across the entire video or chunk
 * Removes arbitrary sample ceiling so dialogue lines are never skipped.
 * 
 * @param {number} durationSec
 * @param {number} [stepSec=0.75] - ~1.33 fps (ensures every >= 1.0s subtitle is sampled)
 * @param {number} [startOffsetSec=0]
 * @returns {number[]}
 */
function generateBaseSamplingGrid(durationSec, stepSec = 0.75, startOffsetSec = 0) {
  const times = [];
  if (!durationSec || durationSec <= 0) {
    return [parseFloat((startOffsetSec + 0.5).toFixed(2))];
  }

  const effectiveStep = Math.max(0.4, Number(stepSec) || 0.75);
  let cur = startOffsetSec === 0 ? 0.5 : startOffsetSec + 0.3; // standard 0.5s start for initial video
  const endSec = startOffsetSec + durationSec;

  while (cur < endSec) {
    times.push(parseFloat(cur.toFixed(2)));
    cur += effectiveStep;
  }

  if (times.length === 0 && durationSec > 0) {
    times.push(parseFloat((startOffsetSec + durationSec / 2).toFixed(2)));
  }
  return times;
}

const CASCADE_VISION_MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash'];

/**
 * Helper: Call Gemini Vision with multi-model cascade and exponential backoff retry on 429 / 503
 */
async function callGeminiVisionWithRetry(aiClient, modelName, contents, maxRetries = 2) {
  const modelsToTry = [modelName, ...CASCADE_VISION_MODELS.filter((m) => m !== modelName)];
  let lastErr = null;

  for (const currentModel of modelsToTry) {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const resp = await aiClient.models.generateContent({
          model: currentModel,
          contents,
          config: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        });
        return resp;
      } catch (err) {
        lastErr = err;
        attempt++;
        const isQuotaOrBusy = err.message && (
          err.message.includes('429') ||
          err.message.includes('503') ||
          err.message.includes('RESOURCE_EXHAUSTED') ||
          err.message.includes('High Demand')
        );
        if (!isQuotaOrBusy) {
          throw err;
        }
        if (attempt >= maxRetries) {
          console.warn(`[Stage 3 OCR] Model ${currentModel} hit 429/busy. Falling back to alternative cascade model...`);
          break;
        }
        const backoffMs = Math.min(8000, 2000 * attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw lastErr || new Error('All cascade Gemini models exceeded quota/rate limits (429)');
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
 * @returns {Promise<{ rawObservations: Array, visualSegments: Array, ocrMeta: object }>}
 */
async function extractChineseSubtitles({
  videoPath,
  durationSec,
  aiClient,
  modelName = 'gemini-3.5-flash-lite',
  baseStepSec = 0.75,
  startOffsetSec = 0,
}) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`[Stage 3 Extract Subtitles] Video file not found: ${videoPath}`);
  }
  if (!aiClient) {
    throw new Error('[Stage 3 Extract Subtitles] Gemini AI client is required');
  }

  const cachePath = getOcrCachePath(videoPath, startOffsetSec, durationSec, modelName);
  if (cachePath && fs.existsSync(cachePath)) {
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
  let apiCallsCount = 0;
  let retriesCount = 0;
  let lastBatchError = null;

  try {
    // 1. Fast subtitle area difference grid using lightweight FFmpeg filter (~1s)
    const diffGrid = await extractSubtitleDifferenceGrid(videoPath, startOffsetSec, durationSec, 1.5).catch(() => []);
    const diffMap = new Map();
    for (const d of diffGrid) {
      diffMap.set(d.timestampSec, d);
    }

    // 2. Fast Streaming Extraction of 360p candidate frames
    const effectiveStep = Math.max(1.0, baseStepSec || 1.2);
    const fps = Math.min(2.0, Math.max(0.8, parseFloat((1 / effectiveStep).toFixed(2))));
    let extractedFrames = [];

    try {
      extractedFrames = await extractFramesStreaming(
        videoPath,
        startOffsetSec,
        durationSec,
        fps,
        tempDir
      );
    } catch (streamErr) {
      console.warn('[Stage 3 Extract Subtitles] Streaming extraction failed, falling back to timestamp extraction:', streamErr.message);
      const candidateTimes = generateBaseSamplingGrid(durationSec, effectiveStep, startOffsetSec);
      extractedFrames = await extractFramesAtTimestamps(videoPath, candidateTimes, tempDir);
    }

    if (!extractedFrames || extractedFrames.length === 0) {
      console.warn('[Stage 3 Extract Subtitles] No frames could be extracted for video');
      return {
        rawObservations: [],
        visualSegments: [],
        ocrMeta: { totalFramesSampled: 0, totalObservations: 0, detectedSegmentsCount: 0, modelUsed: modelName },
      };
    }

    // 3. Filter useful frames for Gemini Vision:
    // Anchor frames (~1.8s) + all frames where subtitle area changed significantly
    const framesToAnalyze = [];
    for (let fIdx = 0; fIdx < extractedFrames.length; fIdx++) {
      const f = extractedFrames[fIdx];
      const diffObj = diffMap.get(f.timestampSec);
      const isAnchor = fIdx === 0 || fIdx === extractedFrames.length - 1 || (fIdx % 2 === 0);
      const isChange = diffObj ? diffObj.isChange : true;

      if (isAnchor || isChange) {
        framesToAnalyze.push(f);
      }
    }

    console.log(`[Stage 3 Extract Subtitles] Extracted ${extractedFrames.length} frames, prioritized ${framesToAnalyze.length} candidate frames for Vision OCR`);

    // 4. Batch frames (15 frames per call) to Gemini Vision with Bounded Concurrency (2 batches at a time)
    const BATCH_SIZE = 15;
    const batchList = [];
    for (let i = 0; i < framesToAnalyze.length; i += BATCH_SIZE) {
      batchList.push(framesToAnalyze.slice(i, i + BATCH_SIZE));
    }

    const CONCURRENCY = 2;
    for (let bIdx = 0; bIdx < batchList.length; bIdx += CONCURRENCY) {
      const activeBatches = batchList.slice(bIdx, bIdx + CONCURRENCY);

      await Promise.all(
        activeBatches.map(async (batch) => {
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

          if (contents.length === 0) return;

          contents.push({
            text: `You are an expert Chinese Video & Drama OCR engine.
Analyze these ${batch.length} sequential video frames at the specified timestamps.

TASK:
Detect all burned-in Chinese dialogue subtitles in the lower area of each frame.

RULES:
1. Examine the lower area of each frame for burned-in Chinese dialogue text.
2. If dialogue subtitle text is clearly present, set "hasText": true and return the exact Chinese characters in "chineseText".
3. If no dialogue subtitle text is present (e.g. background scenery, action without speaking, character reaction with no text), set "hasText": false and "chineseText": "".
4. "position": "bottom_subtitle" (for actor dialogue) or "title_card" (for on-screen titles).
5. "isSharp": true if readable, false if blurry or motion-faded.
6. "speakerGender": Estimate speaking actor gender from visible character cues or speech context: "male", "female", or "unknown" if ambiguous.
7. "genderConfidence": Number between 0.0 and 1.0 indicating confidence in speakerGender.
8. EXCLUDE WATERMARKS: Do NOT output creator watermarks, channel handles, or anti-theft stamps (e.g. '偷了...的视频', '抖音', '快手', account IDs). Only output genuine actor dialogue lines and scene titles.
9. Preserve exact recognized Chinese characters across all video genres (Modern, Romance, Action, Period, Comedy, etc.). Do NOT invent or summarize dialogue.

Return JSON ONLY matching this schema:
{
  "frames": [
    {
      "timestampSec": 39.5,
      "hasText": true,
      "chineseText": "我们今天必须完成这项工作",
      "position": "bottom_subtitle",
      "isSharp": true,
      "speakerGender": "female",
      "genderConfidence": 0.85
    }
  ]
}`,
          });

          try {
            apiCallsCount++;
            const resp = await callGeminiVisionWithRetry(aiClient, modelName, contents);
            const rawText = typeof resp.text === 'function' ? resp.text() : resp.text;
            if (rawText) {
              const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
              const parsed = JSON.parse(clean);
              const frames = Array.isArray(parsed.frames) ? parsed.frames : [];

              for (let fIdx = 0; fIdx < frames.length; fIdx++) {
                const f = frames[fIdx];
                const fallbackTime = batch[fIdx] ? batch[fIdx].timestampSec : 0;
                const tSec = typeof f.timestampSec === 'number' && !isNaN(f.timestampSec)
                  ? parseFloat(f.timestampSec.toFixed(2))
                  : fallbackTime;

                const cText = String(f.chineseText || '').trim();
                const hasCleanText = Boolean(f.hasText && normalizeChineseChars(cText).length > 0);
                const rawGender = String(f.speakerGender || 'unknown').toLowerCase();
                const validGender = rawGender === 'female' ? 'female' : (rawGender === 'male' ? 'male' : 'unknown');
                const conf = typeof f.genderConfidence === 'number' && !isNaN(f.genderConfidence)
                  ? Math.min(1.0, Math.max(0.0, f.genderConfidence))
                  : (validGender === 'unknown' ? 0.5 : 0.85);

                rawObservations.push({
                  timestampSec: tSec,
                  hasText: hasCleanText,
                  chineseText: hasCleanText ? cText : '',
                  position: f.position || 'bottom_subtitle',
                  isSharp: f.isSharp !== false,
                  speakerGender: validGender,
                  genderConfidence: conf,
                });
              }
            }
          } catch (geminiErr) {
            retriesCount++;
            lastBatchError = geminiErr.message;
            console.warn(`[Stage 3 Extract Subtitles] Batch OCR call failed at ${batch[0].timestampSec}s:`, geminiErr.message);
          }
        })
      );

      if (bIdx + CONCURRENCY < batchList.length) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // 5. Interpolate observations for visually stable unanalyzed frames so timing resolution is complete
    for (const f of extractedFrames) {
      const existing = rawObservations.find((o) => Math.abs(o.timestampSec - f.timestampSec) < 0.2);
      if (!existing && rawObservations.length > 0) {
        const closest = rawObservations.reduce((prev, curr) => {
          return Math.abs(curr.timestampSec - f.timestampSec) < Math.abs(prev.timestampSec - f.timestampSec) ? curr : prev;
        }, rawObservations[0]);

        if (closest && Math.abs(closest.timestampSec - f.timestampSec) <= 1.5) {
          rawObservations.push({
            timestampSec: f.timestampSec,
            hasText: closest.hasText,
            chineseText: closest.chineseText,
            position: closest.position,
            isSharp: closest.isSharp,
            speakerGender: closest.speakerGender || 'unknown',
            genderConfidence: closest.genderConfidence || 0.5,
            interpolated: true,
          });
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

  // Sort observations chronologically
  rawObservations.sort((a, b) => a.timestampSec - b.timestampSec);

  function resolveGenderFromVotes(genderVotes = {}) {
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
    }

    // Fallback voice rule: female -> female voice, male/unknown -> male voice (never block TTS)
    const voiceGender = resolvedGender === 'female' ? 'female' : 'male';
    const khmerVoiceId = voiceGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';

    return {
      speakerGender: resolvedGender.toUpperCase(),
      voiceGender,
      gender: voiceGender,
      genderConfidence: resolvedConfidence,
      khmerVoiceId,
      voiceId: khmerVoiceId,
    };
  }

  // Group continuous frame observations into visual candidate segments
  const visualSegments = [];
  let currentSegment = null;

  for (let i = 0; i < rawObservations.length; i++) {
    const obs = rawObservations[i];
    if (!obs.hasText) {
      if (currentSegment) {
        // Text disappeared: close segment
        const endSec = parseFloat(obs.timestampSec.toFixed(2));
        const dur = Math.max(0.8, parseFloat((endSec - currentSegment.startSec).toFixed(2)));
        const genderData = resolveGenderFromVotes(currentSegment.genderVotes);
        visualSegments.push({
          ...currentSegment,
          endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
          duration: parseFloat(dur.toFixed(2)),
          lastObservedSec: currentSegment.lastObservedSec,
          verifiedDisappearance: true,
          ...genderData,
        });
        currentSegment = null;
      }
      continue;
    }

    if (!currentSegment) {
      // New text segment begins
      const startSec = parseFloat(obs.timestampSec.toFixed(2));
      const genderVotes = { male: 0, female: 0, unknown: 0 };
      if (obs.speakerGender) genderVotes[obs.speakerGender] = (genderVotes[obs.speakerGender] || 0) + 1;

      currentSegment = {
        originalChineseText: obs.chineseText,
        startSec,
        lastObservedSec: startSec,
        position: obs.position,
        isSharp: obs.isSharp,
        frameCount: 1,
        source: 'visual_ocr',
        genderVotes,
      };
    } else {
      // Check continuation of existing line vs new dialogue line
      const isContinuation = areChineseTextsEquivalent(obs.chineseText, currentSegment.originalChineseText);
      if (isContinuation) {
        currentSegment.lastObservedSec = parseFloat(obs.timestampSec.toFixed(2));
        currentSegment.frameCount++;
        if (obs.chineseText.length > currentSegment.originalChineseText.length) {
          currentSegment.originalChineseText = obs.chineseText;
        }
        if (obs.speakerGender) {
          currentSegment.genderVotes[obs.speakerGender] = (currentSegment.genderVotes[obs.speakerGender] || 0) + 1;
        }
      } else {
        // Text changed to a different subtitle line
        const endSec = parseFloat(obs.timestampSec.toFixed(2));
        const dur = Math.max(0.8, parseFloat((endSec - currentSegment.startSec).toFixed(2)));
        const genderData = resolveGenderFromVotes(currentSegment.genderVotes);
        visualSegments.push({
          ...currentSegment,
          endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
          duration: parseFloat(dur.toFixed(2)),
          verifiedDisappearance: true,
          ...genderData,
        });

        const startSec = parseFloat(obs.timestampSec.toFixed(2));
        const genderVotes = { male: 0, female: 0, unknown: 0 };
        if (obs.speakerGender) genderVotes[obs.speakerGender] = (genderVotes[obs.speakerGender] || 0) + 1;

        currentSegment = {
          originalChineseText: obs.chineseText,
          startSec,
          lastObservedSec: startSec,
          position: obs.position,
          isSharp: obs.isSharp,
          frameCount: 1,
          source: 'visual_ocr',
          genderVotes,
        };
      }
    }
  }

  // Close trailing active segment
  if (currentSegment) {
    const estimatedEnd = currentSegment.lastObservedSec > currentSegment.startSec
      ? parseFloat((currentSegment.lastObservedSec + baseStepSec).toFixed(2))
      : parseFloat((currentSegment.startSec + 1.5).toFixed(2));
    const dur = Math.max(0.8, parseFloat((estimatedEnd - currentSegment.startSec).toFixed(2)));
    const genderData = resolveGenderFromVotes(currentSegment.genderVotes);
    visualSegments.push({
      ...currentSegment,
      endSec: parseFloat((currentSegment.startSec + dur).toFixed(2)),
      duration: parseFloat(dur.toFixed(2)),
      verifiedDisappearance: currentSegment.frameCount > 1,
      ...genderData,
    });
  }

  // Pass 2: Merge consecutive segments with identical/near-identical Chinese text (deduplication)
  const deduplicatedSegments = [];
  for (let i = 0; i < visualSegments.length; i++) {
    const seg = visualSegments[i];
    if (deduplicatedSegments.length === 0) {
      deduplicatedSegments.push({ ...seg });
      continue;
    }
    const prev = deduplicatedSegments[deduplicatedSegments.length - 1];
    const isAdjacent = (seg.startSec - prev.endSec) <= 1.0;
    const isTextMatch = areChineseTextsEquivalent(seg.originalChineseText, prev.originalChineseText);

    if (isAdjacent && isTextMatch) {
      // Merge into prev
      prev.endSec = Math.max(prev.endSec, seg.endSec);
      prev.duration = parseFloat((prev.endSec - prev.startSec).toFixed(2));
      if (seg.originalChineseText.length > prev.originalChineseText.length) {
        prev.originalChineseText = seg.originalChineseText;
      }
      prev.frameCount = (prev.frameCount || 1) + (seg.frameCount || 1);
      if (prev.voiceGender === 'male' && prev.genderConfidence < 0.6 && seg.genderConfidence >= 0.7) {
        prev.speakerGender = seg.speakerGender;
        prev.voiceGender = seg.voiceGender;
        prev.gender = seg.gender;
        prev.khmerVoiceId = seg.khmerVoiceId;
        prev.genderConfidence = seg.genderConfidence;
      }
    } else {
      deduplicatedSegments.push({ ...seg });
    }
  }

  // Finalize segments with minimum duration 0.8s and valid timecodes
  const finalizedVisualSegments = deduplicatedSegments.map((s, idx) => {
    const dur = Math.max(0.8, parseFloat((s.endSec - s.startSec).toFixed(2)));
    const endSec = parseFloat((s.startSec + dur).toFixed(2));
    return {
      ...s,
      id: idx + 1,
      segmentId: idx + 1,
      endSec,
      duration: dur,
      uncertainOcr: false,
      reviewNeeded: false,
    };
  });

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
      modelUsed: modelName,
      hasVisualSubtitles: finalizedVisualSegments.length > 0,
      ocrNotice: lastBatchError || null,
    },
  };

  if (cachePath && finalizedVisualSegments.length > 0) {
    try {
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
      console.log(`[Stage 3 OCR] 💾 Cached ${visualSegments.length} segments to ${path.basename(cachePath)}`);
    } catch (_) {}
  }

  return result;
}

/**
 * Deduplicate raw OCR cues for Fast OCR mode and external subtitle imports.
 * Drops chunk-boundary repeats (equivalent CN text within 0.3s or overlapping).
 * Merges truly continuous duplicates of the same text by extending endSec.
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
  const defVoice = defGen === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';
  const defVoiceLabel = defGen === 'female' ? 'ស្រីមុំ (Sreymom)' : 'ពិសិដ្ឋ (Piseth)';
  const defAvatar = defGen === 'female' ? '👩' : '👨';
  const defColor = defGen === 'female' ? '#ec4899' : '#3b82f6';

  for (const cue of sorted) {
    const cueText = String(cue.originalChineseText || cue.chineseText || cue.text || '').trim();
    if (!cueText) continue;

    const cStart = parseFloat(Number(cue.startSec || 0).toFixed(2));
    const cEnd = parseFloat(Number(cue.endSec || cStart + 1.25).toFixed(2));

    if (deduped.length === 0) {
      deduped.push({
        ...cue,
        startSec: cStart,
        endSec: cEnd,
        duration: parseFloat(Math.max(0.6, cEnd - cStart).toFixed(2)),
        originalChineseText: cueText,
        chineseText: cueText,
        source: 'visual_ocr',
        evidenceSource: 'visual_ocr',
        evidenceType: 'visual_only',
      });
      continue;
    }

    const prev = deduped[deduped.length - 1];
    const prevText = String(prev.originalChineseText || prev.chineseText || '').trim();
    const isEq = areChineseTextsEquivalent(prevText, cueText);

    if (isEq) {
      const timeDiff = cStart - prev.startSec;
      const isChunkBoundaryRepeat = (Math.abs(timeDiff) <= 0.3) || (cStart < prev.endSec);
      const isContinuous = (cStart <= prev.endSec + 0.35);

      if (isContinuous || isChunkBoundaryRepeat) {
        if (cEnd > prev.endSec) {
          prev.endSec = parseFloat(Number(cEnd).toFixed(2));
          prev.duration = parseFloat(Math.max(0.6, prev.endSec - prev.startSec).toFixed(2));
        }
        continue;
      }
    }

    deduped.push({
      ...cue,
      startSec: cStart,
      endSec: cEnd,
      duration: parseFloat(Math.max(0.6, cEnd - cStart).toFixed(2)),
      originalChineseText: cueText,
      chineseText: cueText,
      source: 'visual_ocr',
      evidenceSource: 'visual_ocr',
      evidenceType: 'visual_only',
    });
  }

  return deduped.map((seg, idx) => {
    const isUserOverridden = Boolean(seg.userOverridden);
    const resolvedGender = isUserOverridden ? (seg.voiceGender || defGen) : defGen;
    const resolvedVoice = isUserOverridden ? (seg.voiceId || defVoice) : defVoice;

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

      // STEP 3: Speaker/gender WITHOUT ASR
      speakerSource: 'ocr_only',
      unverifiedSpeaker: true,
      genderConfidence: null,
      voiceGender: resolvedGender,
      gender: resolvedGender,
      speakerGender: resolvedGender.toUpperCase(),
      speaker: 'តួអង្គ',
      speakerName: 'តួអង្គ',
      speakerId: `spk_ocr_${idx + 1}`,
      voiceId: resolvedVoice,
      khmerVoiceId: resolvedVoice,
      voice: resolvedVoice,
      voiceLabel: defVoiceLabel,
      avatar: defAvatar,
      badgeColor: defColor,

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
  areChineseTextsEquivalent,
  generateBaseSamplingGrid,
  deduplicateFastOcrCues,
};
