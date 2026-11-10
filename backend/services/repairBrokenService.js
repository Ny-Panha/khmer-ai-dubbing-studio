const fs = require('fs');
const path = require('path');
const { uploadsDir: DEFAULT_UPLOADS_DIR } = require('../utils/pathUtils');
const {
  getSegmentKhmerText,
  getSegmentChineseText,
  isSegmentTextBroken,
  scanEpisodeBrokenSegments,
} = require('../utils/translationQuality');
const {
  getSeriesMetadata,
  updateSeriesMetadata,
  withSeriesMetadataLock,
  ensureEpisodeDirectories,
} = require('./episodeService');
const {
  extractAllGeminiKeys,
  createSmartGenAIClient,
  isQuotaOrRateLimitError,
} = require('./geminiKeyManager');
const {
  DEFAULT_MODELS,
  KHMER_DUBBING_BASE_SYSTEM_PROMPT,
  resolveValidModelName,
  generateContentWithModelFallback,
  safeParseOrRepairJson,
  sanitizeKhmerDialogue,
} = require('./geminiService');
const {
  generateBatchSegmentsAudio,
} = require('./ttsService');
const {
  createSynchronizedNarrationAudio,
} = require('./ffmpegService');
const { parseTimeToSec } = require('../models/timestampUtils');

const REPAIR_BATCH_SIZE = 25;

function createAbortError(message = 'Repair job was cancelled by user') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function buildDiskAudioChecker(epAudioDir, baseUploadsDir = DEFAULT_UPLOADS_DIR) {
  const resolvedUploads = path.resolve(baseUploadsDir);
  return function checkAudioExistsOnDisk(seg) {
    if (!seg || typeof seg !== 'object') return false;
    if (seg.audioPath && typeof seg.audioPath === 'string') {
      try {
        if (fs.existsSync(seg.audioPath) && fs.statSync(seg.audioPath).size > 0) {
          return true;
        }
      } catch (_) {}
    }
    if (typeof seg.audioUrl === 'string' && seg.audioUrl.startsWith('/uploads/')) {
      const rel = seg.audioUrl.slice('/uploads/'.length).split('?')[0];
      const candidate = path.resolve(resolvedUploads, rel);
      const relFromUploads = path.relative(resolvedUploads, candidate);
      if (!relFromUploads.startsWith('..') && !path.isAbsolute(relFromUploads)) {
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
            return true;
          }
        } catch (_) {}
      }
    }
    if (seg.audioFile && typeof seg.audioFile === 'string' && epAudioDir) {
      const candidate = path.join(epAudioDir, path.basename(seg.audioFile));
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
          return true;
        }
      } catch (_) {}
    }
    return false;
  };
}

function buildSpeakerMap(ep, series) {
  const speakerMap = {};
  const regSource =
    (ep?.speakerRegistry && Object.keys(ep.speakerRegistry).length > 0)
      ? ep.speakerRegistry
      : (series?.glossary?.characters || {});

  Object.values(regSource)
    .sort((a, b) => (a?.lineCount || 0) - (b?.lineCount || 0))
    .forEach((spk) => {
      if (spk && spk.voiceId) {
        const key = spk.id || spk.speakerId || spk.name;
        if (key) speakerMap[key] = spk.voiceId;
        const isGeneric =
          !spk.name ||
          spk.name === 'តួអង្គ' ||
          String(spk.name).toLowerCase() === 'speaker';
        if (!isGeneric) speakerMap[spk.name] = spk.voiceId;
      }
    });

  return speakerMap;
}

function buildBatchTranslationPrompt(inputLines) {
  return `អ្នកគឺជាអ្នកដឹកនាំការបញ្ចូលសំឡេង និងជាអ្នកជំនាញបកប្រែកុនភាគចិន-ខ្មែរអាជីព។
សូមបកប្រែប្រយោគចិនទាំងអស់ខាងក្រោមនេះជាភាសាខ្មែរសម្រាប់បញ្ចូលសំឡេងកុនភាគ (Cinema Drama Spoken Khmer) ឱ្យបានត្រឹមត្រូវន័យដើម ១០០% (ហាមបកខុសចំនួនលេខ, ហាមច្រឡំអត្ថន័យ) ស្របតាមបរិបទជាក់ស្តែងនៃសាច់រឿង។

ច្បាប់តឹងរ៉ឹង៖
1. 1 Segment = 1 Translation: ឃ្លានីមួយៗត្រូវបកប្រែដាច់ដោយឡែកពីគ្នា ស្របតាម "sourceChineseToTranslate" របស់វា។
2. "prevContext" / "nextContext" (បើមាន) គឺសម្រាប់តែជាបរិបទជួយយល់ន័យឱ្យកាន់តែច្បាស់ប៉ុណ្ណោះ។ ហាមដាច់ខាតកុំយកបរិបទមកបកប្រែជំនួស "sourceChineseToTranslate"!
3. កំហិតពាក្យខ្មែរយ៉ាងតឹងរ៉ឹងតាម "maxKhmerWords": ត្រូវបកប្រែឱ្យខ្លី ចំខ្លឹមសារ មិនលើសពីចំនួន "maxKhmerWords" ឡើយ។
4. ហាមដាច់ខាតកុំប្រើពាក្យបំពេញទទេដូចជា "សន្ទនា", "សូមរង់ចាំ", "សូមរង់..." ឬ "..." ឱ្យសោះ!
5. ហាមដាច់ខាតកុំបកប្រែចេញអត្ថបទខ្មែរដូចគ្នាលើបន្ទាត់ដែលប្រយោគចិនខុសគ្នា!
6. ហាមមានតួអក្សរចិន (\u4E00-\u9FFF) ឬតួអក្សរថៃនៅក្នុង "khmerText" ដាច់ខាត (100% Khmer Script Only)!

បញ្ជីប្រយោគត្រូវបកប្រែ៖
${JSON.stringify(inputLines, null, 2)}

សូមបញ្ចេញលទ្ធផលជា JSON Array នៃវត្ថុដែលមានទម្រង់៖
[
  {
    "id": 1,
    "khmerText": "អត្ថបទខ្មែរដែលបានបកប្រែរួច"
  }
]`;
}

/**
 * Runs a single queued repair job for ONE episode:
 *  1) Scans stored segments on disk (text-broken + voice-broken).
 *  2) Re-translates ONLY text-broken segments via Gemini key pool + model cascade,
 *     re-checking every output with the junk detector and persisting each batch atomically.
 *  3) Generates Edge-TTS voice ONLY for segments that now have real text and lack valid audio,
 *     leaving all healthy segments' text and .mp3 files byte-untouched.
 *  4) Re-syncs episode master narration if any segment audio changed.
 *  5) Reports honest 'completed' (remaining == 0) or 'partial' (quota/remaining > 0).
 */
async function runRepairBrokenSegmentsJob(job, deps = {}) {
  const seriesId = job?.seriesId || 'series_default';
  const episodeId = job?.episodeId || 'ep_1';
  const projectsDir = deps.projectsDir || path.join(DEFAULT_UPLOADS_DIR, 'projects');
  const baseUploadsDir = deps.baseUploadsDir || DEFAULT_UPLOADS_DIR;
  const abortSignal = deps.signal || null;
  const queue = deps.queue || null;

  const reportProgress = (progress, currentStage, stageMessage) => {
    if (queue && job?.jobId && typeof queue.updateJob === 'function') {
      queue.updateJob(job.jobId, {
        progress,
        currentStage,
        stageMessage,
      });
    }
  };

  if (abortSignal?.aborted) {
    throw createAbortError();
  }

  const seriesMeta = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
  const targetEp = (seriesMeta?.episodes || []).find((e) => String(e.id) === String(episodeId));
  if (!targetEp || !targetEp.scriptData || !Array.isArray(targetEp.scriptData.segments)) {
    const err = new Error(`Episode ${episodeId} has no stored script segments to repair`);
    err.nonRetryable = true;
    throw err;
  }

  const epDirInfo =
    projectsDir === path.join(DEFAULT_UPLOADS_DIR, 'projects')
      ? ensureEpisodeDirectories(seriesId, episodeId)
      : {
          audioDir: path.join(projectsDir, seriesId, 'episodes', episodeId, 'audio'),
        };
  if (!fs.existsSync(epDirInfo.audioDir)) {
    fs.mkdirSync(epDirInfo.audioDir, { recursive: true });
  }

  const checkAudioFileFn =
    typeof deps.checkAudioFileFn === 'function'
      ? deps.checkAudioFileFn
      : buildDiskAudioChecker(epDirInfo.audioDir, baseUploadsDir);

  let workingSegments = targetEp.scriptData.segments.map((s) => ({ ...s }));
  const initialScan = scanEpisodeBrokenSegments(
    { id: episodeId, scriptData: { segments: workingSegments } },
    { checkAudioFileFn }
  );

  if (initialScan.totalBrokenCount === 0) {
    return {
      success: true,
      status: 'completed',
      episodeId,
      fixedCount: 0,
      remainingCount: 0,
      textFixed: 0,
      voiceFixed: 0,
      remainingTextBroken: 0,
      remainingVoiceBroken: 0,
      remainingBroken: 0,
      message: 'គ្មានឃ្លាខូចទេ — គ្រប់ឃ្លារួចរាល់ 100%!',
    };
  }

  reportProgress(
    5,
    'repair_scan',
    `🔍 រកឃើញឃ្លាខូចសរុប ${initialScan.totalBrokenCount} ឃ្លា (អត្ថបទខូច: ${initialScan.textBrokenCount} • សំឡេងខ្វះ: ${initialScan.voiceBrokenCount})`
  );

  let textFixed = 0;
  let quotaExhausted = false;
  let quotaErrorMessage = null;

  // ── PHASE A: Re-translate ONLY TEXT-BROKEN segments ──
  if (initialScan.textBrokenIndices.length > 0) {
    const transientKey = deps.transientApiKey || null;
    const aiClient =
      typeof deps.translateBatchFn === 'function'
        ? null
        : deps.aiClient ||
          (() => {
            const availableKeys = extractAllGeminiKeys(transientKey);
            if (!availableKeys || availableKeys.length === 0) {
              const err = new Error('Gemini API Key មិនទាន់បានកំណត់ទេ');
              err.nonRetryable = true;
              throw err;
            }
            return createSmartGenAIClient(availableKeys.join(','));
          })();

    const primaryModel = resolveValidModelName(job?.config?.modelName || process.env.GEMINI_MODEL);
    const fallbackModels = deps.fallbackModels || DEFAULT_MODELS;
    const brokenIndices = initialScan.textBrokenIndices;
    const totalBatches = Math.ceil(brokenIndices.length / REPAIR_BATCH_SIZE);

    for (let b = 0; b < totalBatches; b++) {
      if (abortSignal?.aborted) {
        throw createAbortError();
      }

      const sliceIndices = brokenIndices.slice(b * REPAIR_BATCH_SIZE, (b + 1) * REPAIR_BATCH_SIZE);
      const inputLines = [];
      const indexBySegId = new Map();

      for (const segIdx of sliceIndices) {
        const seg = workingSegments[segIdx];
        if (!seg) continue;
        const segId = seg.id !== undefined && seg.id !== null ? seg.id : segIdx + 1;
        const chineseText = getSegmentChineseText(seg);
        const spokenContext = String(seg.spokenAudioText || '').trim();
        const sourceToTranslate = chineseText || spokenContext;
        if (!sourceToTranslate) {
          continue;
        }

        const rawDur =
          typeof seg.duration === 'number' && seg.duration > 0
            ? seg.duration
            : parseFloat(Math.max(0.6, (seg.endSec || 0) - (seg.startSec || 0)).toFixed(2));
        const reliableSpeechDur =
          Number.isFinite(seg.speechDuration) && seg.speechDuration > 0 ? seg.speechDuration : null;
        const effectiveDur = reliableSpeechDur || Math.min(rawDur, 4.5);
        const maxWords = Math.min(16, Math.max(3, Math.ceil(effectiveDur * 3.2)));

        const prevChinese = segIdx > 0 ? getSegmentChineseText(workingSegments[segIdx - 1]) : '';
        const nextChinese =
          segIdx + 1 < workingSegments.length ? getSegmentChineseText(workingSegments[segIdx + 1]) : '';

        indexBySegId.set(String(segId), segIdx);
        inputLines.push({
          id: segId,
          sourceChineseToTranslate: sourceToTranslate,
          ...(prevChinese ? { prevContext: prevChinese } : {}),
          ...(nextChinese ? { nextContext: nextChinese } : {}),
          speaker: seg.speaker || seg.speakerName || 'តួអង្គ',
          durationSec: parseFloat(effectiveDur.toFixed(2)),
          maxKhmerWords: maxWords,
        });
      }

      if (inputLines.length === 0) continue;

      const pct = 10 + Math.round(((b + 0.5) / totalBatches) * 45);
      reportProgress(
        pct,
        'repair_translate',
        `✨ កំពុងបកប្រែឃ្លាខូច Batch ${b + 1}/${totalBatches} (${inputLines.length} ឃ្លា)...`
      );

      let parsedItems = null;
      try {
        if (typeof deps.translateBatchFn === 'function') {
          parsedItems = await deps.translateBatchFn(inputLines, { batchIndex: b, totalBatches, signal: abortSignal });
        } else {
          const prompt = buildBatchTranslationPrompt(inputLines);
          const { response: res } = await generateContentWithModelFallback(
            aiClient,
            primaryModel,
            () => ({
              contents: [prompt],
              config: {
                systemInstruction: KHMER_DUBBING_BASE_SYSTEM_PROMPT,
                temperature: 0.25,
                responseMimeType: 'application/json',
              },
            }),
            {
              models: fallbackModels,
              logTag: 'repairBrokenSegments',
              timeoutMs: deps.timeoutMs ?? 45000,
            }
          );
          const rawText = typeof res?.text === 'function' ? res.text() : res?.text || '';
          parsedItems = safeParseOrRepairJson(rawText);
        }
      } catch (batchErr) {
        if (batchErr?.name === 'AbortError' || abortSignal?.aborted) {
          throw createAbortError();
        }
        if (isQuotaOrRateLimitError(batchErr) || batchErr?.status === 429 || batchErr?.status === 503) {
          quotaExhausted = true;
          quotaErrorMessage = batchErr.message || '429 Quota exceeded';
          console.warn(
            `[RepairBroken] ⚠️ Quota exhausted at batch ${b + 1}/${totalBatches} for ${seriesId}/${episodeId}: ${quotaErrorMessage}`
          );
          break;
        }
        console.warn(
          `[RepairBroken] ⚠️ Batch ${b + 1}/${totalBatches} failed for ${seriesId}/${episodeId}:`,
          batchErr.message
        );
        continue;
      }

      let batchFixedCount = 0;
      if (Array.isArray(parsedItems)) {
        for (const item of parsedItems) {
          if (!item || item.id === undefined || item.id === null || !item.khmerText) continue;
          const targetIdx = indexBySegId.get(String(item.id));
          if (targetIdx === undefined) continue;

          const origSeg = workingSegments[targetIdx];
          const origChinese = getSegmentChineseText(origSeg);
          const cleanKhmer = sanitizeKhmerDialogue(String(item.khmerText).trim(), origChinese);
          const candidateSeg = {
            ...origSeg,
            khmerTranslatedText: cleanKhmer,
            khmerText: cleanKhmer,
            khmer: cleanKhmer,
          };

          // Re-verify with the junk detector: still-junk stays broken and is reported honestly
          if (isSegmentTextBroken(candidateSeg)) {
            continue;
          }

          delete candidateSeg.audioFileMissing;
          workingSegments[targetIdx] = {
            ...candidateSeg,
            textStatus: 'retranslated',
            reviewNeeded: false,
            translationStatus: 'translated',
            // Invalidate any stale/filler audio refs so Phase B synthesizes fresh audio for this repaired line
            audioUrl: null,
            audioPath: null,
            audioFile: null,
            audioGenerated: false,
            audioOutdated: true,
            ttsStatus: 'pending',
          };
          batchFixedCount += 1;
          textFixed += 1;
        }
      }

      // Persist each repaired batch atomically so progress survives mid-job quota exhaustion
      if (batchFixedCount > 0) {
        await withSeriesMetadataLock(
          seriesId,
          () =>
            updateSeriesMetadata(
              seriesId,
              (freshSeries) => {
                const ep = (freshSeries?.episodes || []).find((e) => String(e.id) === String(episodeId));
                if (!ep || !ep.scriptData) return false;
                ep.scriptData.segments = workingSegments;
                ep.scriptData.hasScript = workingSegments.length > 0;
                ep.scriptData.totalSegments = workingSegments.length;
                ep.scriptData.updatedAt = Date.now();
                ep.audioOutdated = true;
                ep.lastModified = Date.now();
                return true;
              },
              { projectsDir }
            ),
          { projectsDir }
        );
      }
    }
  }

  if (abortSignal?.aborted) {
    throw createAbortError();
  }

  // ── PHASE B: Generate Edge-TTS voice ONLY for VOICE-BROKEN segments ──
  const postTextScan = scanEpisodeBrokenSegments(
    { id: episodeId, scriptData: { segments: workingSegments } },
    { checkAudioFileFn }
  );

  let voiceFixed = 0;
  if (postTextScan.voiceBrokenIndices.length > 0) {
    reportProgress(
      62,
      'repair_tts',
      `🎙️ កំពុងបង្កើតសំឡេងខ្មែរ AI សម្រាប់ ${postTextScan.voiceBrokenIndices.length} ឃ្លាដែលខ្វះ/ទើបកែរួច...`
    );

    const voiceSubset = postTextScan.voiceBrokenIndices.map((idx) => workingSegments[idx]);
    const speakerMap = buildSpeakerMap(targetEp, seriesMeta);
    const batchTtsFn = deps.generateBatchTtsFn || generateBatchSegmentsAudio;

    const voicedSubset = await batchTtsFn(voiceSubset, epDirInfo.audioDir, {
      concurrency: 3,
      seriesId,
      episodeId,
      speakerMap,
      signal: abortSignal,
      ...(deps.generateSingleTtsFn ? { generateSingleFn: deps.generateSingleTtsFn } : {}),
    });

    if (abortSignal?.aborted) {
      throw createAbortError();
    }

    for (let k = 0; k < postTextScan.voiceBrokenIndices.length; k++) {
      const targetIdx = postTextScan.voiceBrokenIndices[k];
      const voicedSeg = voicedSubset[k];
      if (!voicedSeg) continue;
      const merged = {
        ...workingSegments[targetIdx],
        ...voicedSeg,
      };
      if (merged.audioUrl && !merged.error && merged.ttsStatus !== 'error') {
        delete merged.audioFileMissing;
        merged.audioOutdated = false;
        voiceFixed += 1;
      }
      workingSegments[targetIdx] = merged;
    }
  }

  // Rebuild master narration if any segment audio was newly synthesized
  const narrationFilename = `${episodeId}_narration_khmer.mp3`;
  const fullAudioPath = path.join(epDirInfo.audioDir, narrationFilename);
  const relAudioUrl = `/uploads/projects/${seriesId}/episodes/${episodeId}/audio/${narrationFilename}`;
  let narrationSynced = fs.existsSync(fullAudioPath);

  if (voiceFixed > 0) {
    reportProgress(88, 'repair_sync', '🎧 កំពុងផ្គុំ Master Narration ឡើងវិញ...');
    const syncSegments = workingSegments
      .filter((s) => s && s.audioPath && s.ttsStatus !== 'empty_text' && fs.existsSync(s.audioPath))
      .map((s, idx) => ({
        ...s,
        audioPath: s.audioPath,
        startSec:
          typeof s.audioStartSec === 'number' && !Number.isNaN(s.audioStartSec)
            ? s.audioStartSec
            : typeof s.startSec === 'number' && !Number.isNaN(s.startSec)
              ? s.startSec
              : parseTimeToSec(s.start, idx * 4),
      }));

    if (syncSegments.length > 0) {
      const syncFn = deps.syncNarrationFn || createSynchronizedNarrationAudio;
      try {
        await syncFn(syncSegments, fullAudioPath);
        narrationSynced = fs.existsSync(fullAudioPath);
      } catch (syncErr) {
        console.warn(`[RepairBroken] ⚠️ Master narration sync warning for ${episodeId}:`, syncErr.message);
      }
    }
  }

  // Final stored-segment verification
  const finalScan = scanEpisodeBrokenSegments(
    { id: episodeId, scriptData: { segments: workingSegments } },
    { checkAudioFileFn }
  );

  await withSeriesMetadataLock(
    seriesId,
    () =>
      updateSeriesMetadata(
        seriesId,
        (freshSeries) => {
          const ep = (freshSeries?.episodes || []).find((e) => String(e.id) === String(episodeId));
          if (!ep || !ep.scriptData) return false;
          ep.scriptData.segments = workingSegments;
          ep.scriptData.hasScript = workingSegments.length > 0;
          ep.scriptData.totalSegments = workingSegments.length;
          ep.scriptData.updatedAt = Date.now();
          ep.lastModified = Date.now();

          if (finalScan.totalBrokenCount === 0 && workingSegments.length > 0) {
            ep.audioGenerated = true;
            ep.hasAudio = true;
            ep.audioOutdated = false;
            if (narrationSynced) {
              ep.fullAudioUrl = relAudioUrl;
              ep.fullAudioPath = fullAudioPath;
            }
          } else if (finalScan.voiceBrokenCount > 0) {
            ep.audioOutdated = true;
          }
          return true;
        },
        { projectsDir }
      ),
    { projectsDir }
  );

  const fixedCount = Math.max(0, initialScan.totalBrokenCount - finalScan.totalBrokenCount);
  const remainingCount = finalScan.totalBrokenCount;

  if (remainingCount > 0) {
    const message = quotaExhausted
      ? `កែបាន ${fixedCount} • នៅសល់ ${remainingCount} (quota) — ចុចម្ដងទៀតដើម្បីបន្ត`
      : `កែបាន ${fixedCount} • នៅសល់ ${remainingCount} — ចុចម្ដងទៀតដើម្បីបន្ត`;

    return {
      success: true,
      status: 'partial',
      episodeId,
      fixedCount,
      remainingCount,
      textFixed,
      voiceFixed,
      remainingTextBroken: finalScan.textBrokenCount,
      remainingVoiceBroken: finalScan.voiceBrokenCount,
      remainingBroken: remainingCount,
      reason: quotaExhausted ? 'quota' : 'incomplete',
      ...(quotaErrorMessage ? { quotaError: quotaErrorMessage } : {}),
      message,
    };
  }

  return {
    success: true,
    status: 'completed',
    episodeId,
    fixedCount,
    remainingCount: 0,
    textFixed,
    voiceFixed,
    remainingTextBroken: 0,
    remainingVoiceBroken: 0,
    remainingBroken: 0,
    message: `✅ ជួសជុលឃ្លាខូច & Generate សំឡេងរួចរាល់ 100% (${fixedCount} ឃ្លា)!`,
  };
}

module.exports = {
  REPAIR_BATCH_SIZE,
  buildDiskAudioChecker,
  runRepairBrokenSegmentsJob,
};
