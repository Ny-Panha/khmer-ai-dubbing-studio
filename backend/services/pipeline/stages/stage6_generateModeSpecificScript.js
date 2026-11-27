const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  GENERATION_MODES,
  formatSecondsToTimecode,
  validateStrictSourceCueMapping,
} = require('../pipelineTypes');
const { detectSpeakerGender } = require('../../../models/speakerRegistry');
const { isAuthOrInvalidKeyError, isQuotaOrRateLimitError } = require('../../geminiKeyManager');
const { geminiQuotaTracker } = require('../../geminiQuotaTracker');
const {
  stripPunctuationForSpeech,
} = require('../../../utils/translationQuality');
const {
  normalizeGenre,
  resolveEffectiveGenre,
} = require('../../../utils/dramaGenreUtils');
const {
  getTranslationCacheKey,
  getCachedTranslation,
  setCachedTranslation,
  STAGE6_CASCADE_MODELS,
  sanitizeStage6ErrorMsg,
  isModelNotFoundError,
  isAbortLikeError,
  createStage6AbortError,
  isPlaceholderTranslationText,
  cleanKhmerSpokenText,
  condenseKhmerDialogue,
  computeKhmerSimilarity,
  detectDuplicateTranslations,
  detectDramaGenre,
  getGenrePromptGuidelines,
  deriveVoiceFromGender,
  buildSafeSpeakerId,
  createCanonicalSegment,
  applyTranslatedSegmentResult,
  enforceEpisodeCharacterConsistency,
  enforceFastOcrCharacterConsistency,
  splitLongDialogueSegment,
  isTimeoutLikeError,
  buildStage6OrderedModels,
  parseJsonResponseText,
  extractSegmentsFromParsedResponse,
  resolveBatchTranslationMatches,
  applyBatchTranslations,
  computeKhmerSlotBudget,
  buildRetrySegmentPayload,
  clearRescuedSegmentFailureState,
  extractSingleLineRescueCandidate,
} = require('./stage6PromptAndConsistency');

async function generateModeSpecificScript({
  mode = GENERATION_MODES.MODE_A_DIALOGUE,
  generationMode = '',
  reconciledSegments = [],
  durationSec = 0,
  aiClient,
  modelName = null,
  userDirection = '',
  narratorGender = 'male',
  seriesGlossary = {},
  seriesId = null,
  episodeId = null,
  genre = 'auto',
  translationStyle = 'compact',
  force = false,
  forceRegen = false,
  useTranslationCache = true,
  signal = null,
  fallbackModels = STAGE6_CASCADE_MODELS,
  retryDelayMs = 1500,
  batchSize = null,
  translationBatchSize = null,
  concurrency = null,
  translationConcurrency: requestedConcurrency = null,
}) {
  if (signal?.aborted) {
    throw createStage6AbortError();
  }

  const cleanReqModel = String(modelName || '').trim();
  const resolvedInitialModel = (cleanReqModel && cleanReqModel !== 'auto')
    ? cleanReqModel
    : geminiQuotaTracker.getPreferredPrimaryModel(STAGE6_CASCADE_MODELS[0]);
  const poolKeys = Array.isArray(aiClient?.pool?.keys) ? aiClient.pool.keys : [];

  const isFastOcrMode = generationMode === GENERATION_MODES.FAST_OCR;
  const isForce = Boolean(force || forceRegen);
  const normMode = (mode === GENERATION_MODES.MODE_B_RECAP || mode === 'cinematic_recap' || mode === 'recap')
    ? GENERATION_MODES.MODE_B_RECAP
    : GENERATION_MODES.MODE_A_DIALOGUE;

  const usageStats = {
    requests: 0,
    attempts: 0,
    retryRequests: 0,
    rescueRequests: 0,
    promptTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const recordGeminiUsage = (resp, kind = 'batch') => {
    usageStats.requests += 1;
    usageStats.attempts += 1;
    if (kind === 'retry') usageStats.retryRequests += 1;
    if (kind === 'rescue') usageStats.rescueRequests += 1;
    const um = resp?.usageMetadata || resp?.response?.usageMetadata || null;
    if (um) {
      usageStats.promptTokens += Number(um.promptTokenCount ?? um.inputTokens ?? 0) || 0;
      usageStats.outputTokens += Number(um.candidatesTokenCount ?? um.outputTokens ?? 0) || 0;
      usageStats.totalTokens += Number(um.totalTokenCount ?? 0) || 0;
    }
  };

  if (normMode === GENERATION_MODES.MODE_A_DIALOGUE) {
    // ==========================================
    // MODE A: FAITHFUL LINE-BY-LINE DIALOGUE
    // ==========================================
    let dialogueList = [];
    for (const seg of reconciledSegments) {
      if (isFastOcrMode || seg?.sourceCueId) {
        dialogueList.push(seg);
      } else {
        const pieces = splitLongDialogueSegment(seg);
        dialogueList.push(...pieces);
      }
    }

    // Re-index strictly sequential IDs across all split dialogue items
    dialogueList = dialogueList.map((seg, idx) => ({
      ...seg,
      id: idx + 1,
      segmentId: idx + 1,
    }));

    if (dialogueList.length === 0) {
      const normRequested = normalizeGenre(genre);
      return {
        mode: normMode,
        genre: normRequested,
        detectedGenre: normRequested !== 'auto' ? normRequested : 'auto',
        summary: 'គ្មានការសន្ទនាក្នុងវីដេអូនេះទេ (Genuine Silence/No Dialogue Detected)',
        scriptSegments: [],
      };
    }

    // Sample dialogue text for automatic genre detection
    const sampleText = dialogueList.slice(0, 40).map(s => s.originalChineseText || '').join(' ');
    const normRequestedGenre = normalizeGenre(genre);
    let effectiveGenre = normRequestedGenre !== 'auto'
      ? normRequestedGenre
      : detectDramaGenre(sampleText, userDirection);
    if (effectiveGenre === 'ceo') effectiveGenre = 'modern';

    // Process translations in turbo batches of 45 lines for high throughput and speed (configurable via batchSize)
    const TRANSLATION_BATCH = Number.isInteger(batchSize) && batchSize > 0
      ? batchSize
      : (Number.isInteger(translationBatchSize) && translationBatchSize > 0 ? translationBatchSize : 45);
    let overallSummary = 'ការសន្ទនាក្នុងរឿងភាគ (Faithful Drama Dubbing)';

    const totalBatches = Math.ceil(dialogueList.length / TRANSLATION_BATCH);
    console.log(`[Stage 6 Mode A] 🌐 ចាប់ផ្តើមបកប្រែពាក្យសន្ទនាចិនទៅជាខ្មែរសរុប ${dialogueList.length} បន្ទាត់ (ចែកជា ${totalBatches} Batches)...`);

    const effectiveSeriesId = seriesId ? String(seriesId).trim() : '';
    const effectiveEpisodeId = episodeId ? String(episodeId).trim() : '';
    const canUseCache = Boolean(useTranslationCache && !isForce && effectiveSeriesId);

    const glossaryHash = crypto.createHash('md5')
      .update(JSON.stringify(seriesGlossary || {}))
      .digest('hex')
      .substring(0, 8);

    // Resumable episode-level Stage 6 translation checkpoint keyed by ordered (sourceCueId + chineseText)
    let episodeCheckpointPath = null;
    const getCueIdentityKey = (seg, idx) => {
      const cn = String(seg?.originalChineseText || seg?.chineseText || seg?.originalText || '').trim();
      const cid = String(seg?.sourceCueId || `idx_${idx + 1}`).trim();
      return `${cid}::${cn}`;
    };
    if (effectiveEpisodeId) {
      try {
        const ckptDir = path.join(__dirname, '..', '..', '..', 'uploads', 'cache', 'translation_checkpoints');
        const sigRaw = dialogueList.map((s, idx) => getCueIdentityKey(s, idx)).join('\n') + `|${normMode}|${glossaryHash}`;
        const sigHash = crypto.createHash('md5').update(sigRaw).digest('hex').slice(0, 12);
        const safeSeries = (effectiveSeriesId || 'standalone').replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeEp = effectiveEpisodeId.replace(/[^a-zA-Z0-9_-]/g, '_');
        episodeCheckpointPath = path.join(ckptDir, `tr_ckpt_${safeSeries}_${safeEp}_${sigHash}.json`);
        if (isForce && fs.existsSync(episodeCheckpointPath)) {
          fs.unlinkSync(episodeCheckpointPath);
        } else if (!isForce && useTranslationCache && fs.existsSync(episodeCheckpointPath)) {
          const epCkpt = JSON.parse(fs.readFileSync(episodeCheckpointPath, 'utf8'));
          if (epCkpt && epCkpt.entries && typeof epCkpt.entries === 'object') {
            let epResumedCount = 0;
            dialogueList.forEach((s, idx) => {
              if (s.userOverridden || s.translationSource === 'manual') return;
              if (s.khmerTranslatedText && !isPlaceholderTranslationText(s.khmerTranslatedText)) return;
              const entry = epCkpt.entries[getCueIdentityKey(s, idx)];
              if (entry && entry.khmerText && !isPlaceholderTranslationText(entry.khmerText)) {
                s.khmerTranslatedText = entry.khmerText;
                s.khmerText = entry.khmerText;
                s.khmer = entry.khmerText;
                const hasStep1State = Boolean(s.speakerStatus === 'verified' || s.speakerStatus === 'review_needed' || s.speakerVerified || s.voiceAssignmentSource === 'multimodal_verified' || s.voiceAssignmentSource === 'series_glossary');
                if (!hasStep1State && entry.speaker && (!s.speaker || s.speaker === 'តួអង្គ')) s.speaker = entry.speaker;
                if (!hasStep1State && entry.voiceGender && (!s.voiceGender || s.voiceGender === 'unknown')) s.voiceGender = entry.voiceGender;
                s.translationStatus = 'translated';
                s.isTranslationCached = true;
                epResumedCount++;
              }
            });
            if (epResumedCount > 0) {
              console.log(`[Stage 6 Checkpoint] ⚡ Resumed ${epResumedCount}/${dialogueList.length} verified translations from ${path.basename(episodeCheckpointPath)}.`);
            }
          }
        }
      } catch (_) {
        episodeCheckpointPath = null;
      }
    }
    const saveEpisodeTranslationCheckpoint = () => {
      if (!episodeCheckpointPath || !useTranslationCache) return;
      try {
        const dir = path.dirname(episodeCheckpointPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const entries = {};
        dialogueList.forEach((s, idx) => {
          const kh = String(s?.khmerTranslatedText || '').trim();
          if (kh && !isPlaceholderTranslationText(kh) && s?.translationStatus !== 'review_needed') {
            entries[getCueIdentityKey(s, idx)] = {
              khmerText: kh,
              speaker: s.speaker || 'តួអង្គ',
              voiceGender: s.voiceGender || s.visualGender || 'unknown',
            };
          }
        });
        fs.writeFileSync(episodeCheckpointPath, JSON.stringify({ updatedAt: Date.now(), count: Object.keys(entries).length, entries }, null, 2), 'utf8');
      } catch (_) {}
    };

    // Smart Translation Cache: reuse verified translations for unchanged Chinese dialogue
    let cachedHitsCount = 0;
    if (canUseCache) {
      for (let i = 0; i < dialogueList.length; i++) {
        const s = dialogueList[i];
        if (s.userOverridden || s.translationSource === 'manual') continue; // User manual edits are strictly protected!
        const targetChinese = String(s.originalChineseText || s.chineseText || s.originalText || '').trim();
        if (!targetChinese) continue;

        if (!s.khmerTranslatedText || isPlaceholderTranslationText(s.khmerTranslatedText)) {
          const prevSeg = i > 0 ? dialogueList[i - 1] : null;
          const prevContext = prevSeg ? (prevSeg.originalChineseText || prevSeg.chineseText || prevSeg.originalText || '') : '';
          const cached = getCachedTranslation(targetChinese, {
            seriesId: effectiveSeriesId,
            glossaryHash,
            mode: isFastOcrMode ? 'fast_ocr' : 'dialogue',
            speaker: s.speaker || '',
            voiceGender: s.voiceGender || s.visualGender || '',
            prevContext,
          });
          if (cached && cached.khmerText && !isPlaceholderTranslationText(cached.khmerText)) {
            s.khmerTranslatedText = cached.khmerText;
            const hasStep1State = Boolean(s.speakerStatus === 'verified' || s.speakerStatus === 'review_needed' || s.speakerVerified || s.voiceAssignmentSource === 'multimodal_verified' || s.voiceAssignmentSource === 'series_glossary');
            if (!hasStep1State && cached.speaker && (!s.speaker || s.speaker === 'តួអង្គ')) s.speaker = cached.speaker;
            if (!hasStep1State && cached.voiceGender && (!s.voiceGender || s.voiceGender === 'unknown')) s.voiceGender = cached.voiceGender;
            s.translationStatus = 'translated';
            s.isTranslationCached = true;
            cachedHitsCount++;
          }
        }
      }
      if (cachedHitsCount > 0) {
        console.log(`[Stage 6 Smart Cache] ⚡ Reused ${cachedHitsCount}/${dialogueList.length} verified cached Khmer translations for series "${effectiveSeriesId}".`);
      }
    }

    const batchFailures = [];
    const retiredModels = new Set();
    const quotaDemotedModels = new Set();
    let activePrimaryModel = resolvedInitialModel;
    let consecutiveFailures = 0;

    const healthyKeyCount = Array.isArray(poolKeys) && poolKeys.length > 0
      ? poolKeys.length
      : (aiClient?.pool?.keys?.length || 4);
    const translationConcurrency = Number.isInteger(concurrency) && concurrency > 0
      ? concurrency
      : (Number.isInteger(requestedConcurrency) && requestedConcurrency > 0
        ? requestedConcurrency
        : Math.min(4, Math.max(2, healthyKeyCount)));

    const batchDescriptors = [];
    for (let b = 0; b < dialogueList.length; b += TRANSLATION_BATCH) {
      batchDescriptors.push({
        b,
        batchNum: Math.floor(b / TRANSLATION_BATCH) + 1,
        batchSlice: dialogueList.slice(b, b + TRANSLATION_BATCH),
      });
    }

    async function processBatch(item) {
      const { b, batchNum, batchSlice } = item;
      if (signal?.aborted) {
        throw createStage6AbortError(`Stage 6 Mode A aborted before batch ${batchNum}/${totalBatches}`);
      }

      // If all segments in this batch are already validly translated (from cache, prior pass, or manual edit), skip Gemini call
      const batchNeedsTranslation = batchSlice.some((s) =>
        !s.userOverridden && (!s.khmerTranslatedText || isPlaceholderTranslationText(s.khmerTranslatedText))
      );
      if (!batchNeedsTranslation) {
        console.log(`[Stage 6 Mode A] ⚡ Batch ${batchNum}/${totalBatches} already 100% translated (Reusing verified cache).`);
        return true;
      }

      console.log(`[Stage 6 Mode A] ⏳ កំពុងបកប្រែ Batch ទី ${batchNum}/${totalBatches} (បន្ទាត់ ${b + 1} -> ${Math.min(dialogueList.length, b + TRANSLATION_BATCH)})...`);
      const dialoguePayload = batchSlice.map((s, idx) => {
        const globalIdx = b + idx;
        const nextSeg = dialogueList[globalIdx + 1];
        const rawDur = typeof s.duration === 'number' && s.duration > 0
          ? s.duration
          : parseFloat(Math.max(0.6, s.endSec - s.startSec).toFixed(2));

        // គណនា Slot ទំនេរពិតប្រាកដមុនពេលឃ្លាបន្ទាប់ចាប់ផ្តើម ដើម្បីការពារ Audio Timing Drift
        const slotUntilNext = (nextSeg && typeof nextSeg.startSec === 'number' && nextSeg.startSec > s.startSec)
          ? parseFloat((nextSeg.startSec - s.startSec).toFixed(2))
          : rawDur;

        const reliableSpeechDur = Number.isFinite(s.speechDuration) && s.speechDuration > 0
          ? s.speechDuration
          : null;
        const effectiveDur = Math.min(rawDur, slotUntilNext, reliableSpeechDur || rawDur, 4.5);

        // កំហិតពាក្យ និងតួអក្សរខ្មែរសមស្របនឹងល្បឿនអានពិតរបស់ Edge TTS Khmer (~16 តួអក្សរ/វិនាទី)
        const slotBudget = computeKhmerSlotBudget(effectiveDur);
        const maxWords = slotBudget.maxKhmerWords;
        const maxChars = slotBudget.maxKhmerChars;

        const segmentChinese = String(s.originalChineseText || s.chineseText || s.originalText || '').trim();
        const audioTranscript = String(s.spokenAudioText || '').trim();
        const targetToTranslate = segmentChinese || audioTranscript;
        const audioContext = (audioTranscript && audioTranscript !== targetToTranslate) ? audioTranscript : null;

        const hasRealAcousticPitch = Boolean((s.pitchHz && s.pitchHz > 0) || (s.acousticF0 && s.acousticF0 > 0));
        const pitchVal = s.pitchHz || s.acousticF0 || null;
        const resolvedAcousticGender = s.acousticGender || (pitchVal ? (pitchVal >= 170 ? 'female' : (pitchVal <= 155 ? 'male' : 'unknown')) : 'unknown');
        const pitchConf = typeof s.acousticConfidence === 'number' ? s.acousticConfidence : (pitchVal ? 0.80 : 0.0);
        const cueVoicePitchTag = pitchVal
          ? `${resolvedAcousticGender.toUpperCase()} (${Math.round(pitchVal)}Hz, conf=${pitchConf.toFixed(2)})`
          : 'UNKNOWN (no pitch)';
        const cueVisualFaceTag = s.visualGender || 'unknown';

        const isOcrSegment = isFastOcrMode || s.speakerSource === 'ocr_only';
        const fallbackGender = isOcrSegment ? 'unknown' : (s.voiceGender || 'unknown');

        return {
          index: globalIdx + 1,
          segmentId: s.segmentId || s.id || (globalIdx + 1),
          ...(s.sourceCueId ? { sourceCueId: s.sourceCueId } : {}),
          startTime: formatSecondsToTimecode(s.startSec),
          endTime: formatSecondsToTimecode(s.endSec),
          durationSec: slotBudget.durationSec,
          maxKhmerWords: maxWords,
          maxKhmerChars: maxChars,
          sourceChineseToTranslate: targetToTranslate,
          surroundingAudioContext: audioContext,
          ocrSubtitleText: s.ocrSubtitleText || '',
          originalChineseText: s.originalChineseText || '',
          visualGender: s.visualGender || 'unknown',
          speakerVisualHint: s.speakerVisualHint || '',
          deliveryType: s.deliveryType || 'out_loud',
          ...(s.speakerStatus === 'verified' ? {
            verifiedSpeakerLocked: true,
            verifiedSpeakerName: s.speakerName || s.speaker || '',
            verifiedSpeakerGender: s.speakerGender || 'UNKNOWN',
            verifiedSpeakerId: s.speakerId || '',
            speakerStatus: s.speakerStatus,
          } : {
            speakerStatus: s.speakerStatus || 'unverified',
          }),
          detectedGender: s.speakerStatus === 'verified' && s.voiceGender && s.voiceGender !== 'unknown'
            ? s.voiceGender
            : (hasRealAcousticPitch ? resolvedAcousticGender : fallbackGender),
          acousticGenderHint: hasRealAcousticPitch ? resolvedAcousticGender : fallbackGender,
          acousticPitchHz: pitchVal ? Math.round(pitchVal) : null,
          acousticConfidence: pitchVal ? pitchConf : null,
          cueVoicePitchTag,
          cueVisualFaceTag,
        };
      });

      const isOcrBatch = isFastOcrMode || batchSlice.some((s) => s.speakerSource === 'ocr_only');

      // Context Window: provide surrounding context lines so Gemini translates connected thoughts
      const previousContext = b > 0
        ? dialogueList.slice(Math.max(0, b - 5), b).map((p, pIdx) => {
            const gLabel = p.voiceGender && p.voiceGender !== 'unknown' ? ` (${p.voiceGender})` : '';
            const khmerPart = p.khmerTranslatedText ? ` ➜ "${p.khmerTranslatedText}"` : '';
            return `[#${b - 5 + pIdx + 1} ${p.speaker || 'តួ'}${gLabel}] ${p.originalChineseText}${khmerPart}`;
          }).join('\n')
        : '(ដើមភាគដំបូង គ្មានបរិបទមុន)';

      const upcomingContext = dialogueList.slice(b + TRANSLATION_BATCH, b + TRANSLATION_BATCH + 5)
        .map((u, uIdx) => `[#${b + TRANSLATION_BATCH + uIdx + 1}] ${u.originalChineseText}`).join('\n') || '(ចុងបញ្ចប់ភាគ)';

      // Series-Isolated Glossary (តួអង្គ និងពាក្យពិសេសដាច់ដោយឡែកតាមរឿង)
      let customGlossaryPrompt = '';
      if (seriesGlossary?.characters?.length > 0) {
        const charNames = seriesGlossary.characters
          .map((c) => `${c.name || c.id}${c.khmerName ? ` -> "${c.khmerName}"` : ''}`)
          .join(', ');
        customGlossaryPrompt += `\n[SERIES CHARACTER GLOSSARY]: ${charNames}`;
      }
      if (seriesGlossary?.terms?.length > 0) {
        const termList = seriesGlossary.terms
          .map((t) => `${t.term || t.key}${t.khmer ? ` -> "${t.khmer}"` : ''}`)
          .join(', ');
        customGlossaryPrompt += `\n[SERIES TERMS GLOSSARY]: ${termList}`;
      }

      const genreGlossarySection = '';

      const modeAPrompt = `
អ្នកគឺជាអ្នកបកប្រែ និងសម្រួលសាច់រឿងចិនទៅជាភាសាខ្មែរសម្រាប់ DragonDub AI (Master Theatrical Drama Dubbing Translator & Script Director).
MODE A - FAITHFUL DIALOGUE TRANSLATION (ការបកប្រែពាក្យសន្ទនាតាមបន្ទាត់អក្សរចិនដើម ១០០% Line-by-Line Chinese Dialogue).

1. MANDATORY PRE-TRANSLATION CAST REGISTRY & GENRE LOCKING:
- មុននឹងបកប្រែ "segments" អ្នកត្រូវតែកំណត់ "detectedGenre" ("ancient" | "ceo" | "modern" | "action" | "comedy") និងបង្កើត "castRegistry" (បញ្ជីតួអង្គដែលមាន speakerId, speakerLabelKh, voiceGender, roleArchetype, selfPronounKh, addressPronounKh) ដើម្បីចាក់សោភេទ (male/female) និងសព្វនាមឱ្យថេរ!
${getGenrePromptGuidelines(effectiveGenre)}
${genreGlossarySection}
${customGlossaryPrompt}

2. MANDATORY DUBBING TRANSLATION STYLE: 📝 ខ្លីចំអត្ថន័យ (COMPACT & PUNCHY SUBTITLE STYLE):
- ត្រូវបកប្រែជាភាសាខ្មែរ «ខ្លីបំផុត ចំខ្លឹមសារ ងាយយល់ ១០០%» (បែប Subtitle កុនចិន/ហុងកុង ទំនើប)។
- ហាមដាច់ខាតកុំបកប្រែវែងអន្លាយ ឬបន្ថែមពាក្យអូសបន្លាយឥតប្រយោជន៍! ឧទាហរណ៍ជាក់ស្ដែង៖
  * "每种50分" ➜ ត្រូវបក "មួយប្រភេទ ៥០ពិន្ទុ" (ហាមបកវែង "ប្រភេទនីមួយៗបាន ៥០ពិន្ទុ")
  * "给本座三" ➜ ត្រូវបក "យកមកឱ្យយើងទាំង ៣"
  * "全是合体大佬" ➜ ត្រូវបក "សុទ្ធតែកំពូលអ្នកក្បាច់គុន!"
  * "完了这次真的完了" ➜ ត្រូវបក "ចប់ហើយ លើកនេះចប់មែនទែនហើយ"
- គោរពកំហិតពាក្យ និងចំនួនតួអក្សរខ្លីបំផុតតាម "maxKhmerWords" និង "maxKhmerChars" ដើម្បីឱ្យសំឡេង TTS ខ្មែរនិយាយទាន់មាត់តួអង្គ (Lip-sync) និងមិនហៀរជាន់ឃ្លាបន្ទាប់! (ដោយសារភាសាខ្មែរអត់ដកឃ្លា សម្រាប់ឃ្លាខ្លី <=1.5s ត្រូវគោរព "maxKhmerChars" ជាដាច់ខាត ឧ. 0.6s "再快一点" ➜ "លឿនឡើង!", 1.2s "再晚就没座位了" ➜ "យឺតអស់កន្លែងហើយ!")

3. GENRE-SPECIFIC KHMER VOCABULARY & LIP-SYNC PACING RULE (<= 5.5 syllables/sec):
- រឿងបុរាណ / រាជវាំង / គុណនិយម (ancient)៖ ប្រើរាជស័ព្ទ និងពាក្យគុណនិយមខ្មែរពិតប្រាកដ (ព្រះអង្គ, ព្រះនាង, ទូលបង្គំ, ខ្ញុំម្ចាស់, ម្ចាស់បង, សិស្សប្អូន, គ្រូពេទ្យទេព, បក្ស, ថាមពលធាតុ)។
- រឿងសម័យទំនើប / អគ្គនាយក (ceo / modern)៖ ប្រើភាសាសន្ទនាទំនើបច្បាស់ៗ (លោកប្រធាន, អ្នកនាង, លេខា, អគ្គនាយក, បង, អូន, ខ្ញុំ)។ ហាមយកពាក្យគុណនិយមទៅប្រើក្នុងរឿងសម័យទំនើប!
- រឿង Action / ប្រយុទ្ធ (action)៖ ប្រើឃ្លាបញ្ជាខ្លីៗ មុតមាំ (បញ្ឈប់ភ្លាម!, ថយក្រោយ!, ហ៊ានណាស់!)។
- រឿងកំប្លែង (comedy)៖ ប្រើពាក្យសន្ទនារស់រវើក (ណ៎ា, ហ្នឹងណា, ងាប់ហើយ, ម៉េចចឹង)។
- Strict Lip-Sync Pacing (<= 5.5 syllables/sec, ~4.5 to 5.5 Khmer words/sec max): កំហិតពាក្យខ្មែរឱ្យត្រូវតាម "maxKhmerWords" ដើម្បីឱ្យសំឡេង TTS ខ្មែរត្រូវមាត់តួអង្គក្នុងរយៈពេល (endTime - startTime) ដោយមិនបាច់បង្ខំល្បឿន atempo > 1.35x។

3. ប្រភពអត្ថបទចិន និងបរិបទសំឡេង (SOURCE CHINESE VS AUDIO CONTEXT):
- "sourceChineseToTranslate" គឺជាអត្ថបទចិនគោលដៅតែមួយគត់ដែលត្រូវបកប្រែសម្រាប់ Segment នេះ (THE SOLE TRANSLATION TARGET)។
- "surroundingAudioContext" (បើមាន) គឺសម្រាប់តែជាបរិបទជួយយល់ន័យឱ្យកាន់តែច្បាស់ប៉ុណ្ណោះ។ ហាមដាច់ខាតកុំយក "surroundingAudioContext" ទាំងមូលមកបកប្រែជំនួស "sourceChineseToTranslate"!
- ហាមដាច់ខាតកុំបកប្រែប្រយោគផ្សំ ASR ពេញលេញមួយ ដដែលៗលើ Segment ជាច្រើនដែលជាឃ្លាតូចៗនៃប្រយោគនោះ។

4. រក្សាឈ្មោះ និងវចនានុក្រមតាមរឿងនីមួយៗ (SERIES GLOSSARY CONSISTENCY):
- រក្សាឈ្មោះតួអង្គ ទីកន្លែង ឋានៈ និងពាក្យពិសេសឱ្យស៊ីសង្វាក់គ្នាក្នុងភាគទាំងអស់នៃ Series ដដែល។
- កុំយកវចនានុក្រមរបស់ Series មួយទៅប្រើលើ Series ផ្សេងដោយស្វ័យប្រវត្តិ។

5. បកប្រែសម្រាប់សំឡេង DUBBING & កំហិតពាក្យតាម DURATIONS (STRICT WORD BUDGET FOR TTS):
- ប្រើភាសាខ្មែរដែលមនុស្សនិយាយពិតៗ។ បកប្រែឱ្យខ្លី ចំខ្លឹមសារ រក្សាអត្ថន័យ អារម្មណ៍ និងទំនាក់ទំនងរបស់តួអង្គ។
- កំហិតពាក្យខ្មែរយ៉ាងតឹងរ៉ឹងតាម "maxKhmerWords": ត្រូវបកប្រែឱ្យខ្លី ចំខ្លឹមសារ មិនលើសពីចំនួន "maxKhmerWords" ដែលបានកំណត់ឡើយ ដើម្បីការពារកុំឱ្យសំឡេង TTS អូសបន្លាយជាន់លើតួអង្គបន្ទាប់ — ប៉ុន្តែបើជិតលើសកំហិត ត្រូវកាត់ពាក្យអូសបន្លាយផ្សេងទៀតជំនួសវិញ ហាមដាច់ខាតកាត់ពាក្យកម្រិត (一点/有点/很/更) ឬប្រធានសំខាន់ចោល (មើលច្បាប់ទី 9 ខាងក្រោម)!
- ប្រសិនបើឃ្លាចិនដើមជាឃ្លាមិនទាន់ចប់ន័យ (Incomplete Clause, ឧ. បញ្ចប់ដោយសញ្ញាក្បៀស ，) ត្រូវបកប្រែត្រឹមឃ្លានោះ (Incomplete Clause) ដោយរក្សាភាពស៊ីសង្វាក់ជាមួយឃ្លាបន្ទាប់ ហាមខ្ចីន័យ ឬប្រយោគពីឃ្លាបន្ទាប់មកបញ្ចប់ប្រយោគដោយខ្លួនឯងជាដាច់ខាត!

6. អ្វីដែលត្រូវជៀសវាង (STRICT AVOIDANCE RULES):
- ហាមដាច់ខាតបកប្រែពាក្យតាមពាក្យ (Literal / robotic Google Translate)។
- ហាមដាច់ខាតកុំឱ្យសល់តួអក្សរចិន (Chinese Characters / Hanzi 汉字) នៅក្នុង "khmerText" ដាច់ខាត (100% Khmer Script Only)! រាល់ពាក្យកម្រិតថាមពល (ឧ. 金丹 ➜ ជីនតាន, 化神 ➜ ហ្វាស៊ិន, 元神 ➜ យានស៊ិន, 灵根 ➜ ឫសវិញ្ញាណ) ត្រូវតែសរសេរជាសូរសព្ទអក្សរខ្មែរ ហាមទុកតួអក្សរចិន!
- ហាមដាច់ខាតកុំឱ្យមានតួអក្សរថៃ (Thai characters) ឬពាក្យថៃណាមួយ 100%!
- កុំបន្ថែមឈ្មោះ Channel ឬ Watermark ក្រៅពី Input តែគ្រប់ index នៅក្នុង INPUT SEGMENTS ត្រូវតែបកប្រែ ១០០% (រួមទាំងឃ្លា OCR ខ្លីៗ ឈ្មោះជំនាញ/ទិដ្ឋភាព ឬឃ្លាជេរ/កំហឹងក្នុងសាច់រឿង) — ហាមរំលង index ណាមួយឡើយ!
- កុំប្ដូរឈ្មោះតួអង្គ ឬសំឡេងរបស់ Speaker ដោយគ្មានភស្តុតាង។

7. STRICT GENDER & CONVERSATIONAL TURN-TAKING RULES (ប្រុស vs ស្រី):
- ត្រូវរួមបញ្ចូលសញ្ញាទាំង ៣ (3 Signals) ដើម្បីកំណត់ភេទអ្នកនិយាយ ("male" ឬ "female") ឱ្យត្រឹមត្រូវ៖
  * Signal 1 (Visual Evidence): ពិនិត្យ "visualGender" និង "speakerVisualHint" ពីការស្កេនមុខ សក់ និងសម្លៀកបំពាក់តួអង្គក្នុងវីដេអូ។
  * Signal 2 (Conversational Turn-Taking A -> B -> A -> B): បើឃ្លាទី N ហៅឈ្មោះ ឬងារបុរស ("皇上 / 师兄 / 总裁 / 老公 / ព្រះអង្គ / ម្ចាស់បង / លោកប្រធាន") នោះអ្នកនិយាយឃ្លាទី N ច្រើនតែជាស្ត្រី (female) ឬកូនចៅ ហើយឃ្លាឆ្លើយតបបន្ទាប់ N+1 គឺជាបុរស (male) ឆ្លើយតប! ផ្ទុយទៅវិញ បើឃ្លាទី N ហៅស្ត្រី ("皇后 / 师妹 / 夫人 / 小姐 / 老婆 / ព្រះមហេសី / សិស្សប្អូនស្រី / អ្នកនាង") ឃ្លាទី N ច្រើនតែជាបុរស (male) និយាយ ហើយឃ្លាបន្ទាប់ N+1 គឺជាស្ត្រី (female) ឆ្លើយតប! ហាមដាច់ខាតឃើញពាក្យហៅងារបុរសក្នុងប្រយោគ ហើយដាក់អ្នកនិយាយជាប្រុស!
  * Signal 3 (Pronoun & Kinship Context):
    - ស្ត្រីហៅខ្លួនឯងថា៖ 臣妾, 奴婢, 本宫, 本妃, ខ្ញុំម្ចាស់, នាងខ្ញុំ, អូន ➜ gender: "female" (Sreymom)។
    - បុរសហៅខ្លួនឯងថា៖ 朕, 本王, 本尊, 本座, 微臣, ទូលបង្គំ, យើងខ្ញុំព្រះករុណា, បង, ខ្ញុំបាទ ➜ gender: "male" (Piseth)។
- ពិនិត្យ VOICE_PITCH (cueVoicePitchTag / acousticPitchHz) & VISUAL_FACE (cueVisualFaceTag):
  • បើ acousticPitchHz >= 170Hz (ឬ cueVoicePitchTag គឺ FEMALE) ឬ visualGender គឺ female: អ្នកត្រូវតែកំណត់ "gender": "female", "voiceGender": "female", និង "speaker": "ស្រី" (ឬ "តួឯកស្រី" / ឈ្មោះតួស្រី)។
  • បើ acousticPitchHz <= 155Hz (ឬ cueVoicePitchTag គឺ MALE) ឬ visualGender គឺ male: អ្នកត្រូវតែកំណត់ "gender": "male", "voiceGender": "male", និង "speaker": "ប្រុស" (ឬ "តួឯកប្រុស" / ឈ្មោះតួប្រុស)។
  • បើគ្មាន pitch Hz (unknown): ត្រូវវិនិច្ឆ័យ "speaker" និង "gender" ពី visualGender, speakerVisualHint, Turn-Taking (A -> B -> A) និង [Previous Lines] ឱ្យស៊ីសង្វាក់គ្នា។
- តួអង្គ «ប្រព័ន្ធ / AI System / 系统 / ទីប្រឹក្សាប្រព័ន្ធ» ត្រូវកំណត់ជា "speaker": "ប្រព័ន្ធ" និង "gender": "female" (សំឡេង Sreymom) ជាលំនាំដើម (លើកលែងតែបរិបទបញ្ជាក់ច្បាស់ថាជាតួបុរស)។
- ការលេងពាក្យក្នុងភាសាចិន (Chinese Puns / 谐音梗 / Slang)៖ ប្រសិនបើតួអង្គលេងពាក្យសូរសំឡេង ឬនិយាយពាក្យកំប្លុកកំប្លែង ត្រូវបកប្រែឱ្យស៊ីនឹងន័យកំប្លែង និងបរិបទសន្ទនាធម្មជាតិរបស់ខ្មែរ ហាមបកប្រែតាមសូរអក្សរឆ្គងៗរឹងៗ។
- "speaker": ឈ្មោះ ឬតួនាទីតួអង្គជាភាសាខ្មែរ (e.g. "តួឯកប្រុស", "តួឯកស្រី", "លោកប្រធាន", "អ្នកនាង", "អ្នកគ្រប់គ្រង", "មេទ័ព", "អ្នកភូមិ") តាមប្រភេទរឿង។
- "gender": "male" | "female" | "unknown" (សំឡេងប្រុសប្រើ Piseth, សំឡេងស្រីប្រើ Sreymom)។
${userDirection ? `User Custom Direction: ${userDirection}` : ''}

8. ព្រំដែនឃ្លា និងការការពារឃ្លាស្ទួន (STRICT CLAUSE BOUNDARY & ANTI-DUPLICATION):
- 1 Segment = 1 Translation: ឃ្លានីមួយៗត្រូវបកប្រែដាច់ដោយឡែកពីគ្នា ស្របតាម "sourceChineseToTranslate" របស់វា។
- ហាមដាច់ខាតកុំបកប្រែចេញអត្ថបទខ្មែរដូចគ្នា ២ បន្ទាត់ជាប់គ្នា លុះត្រាតែប្រយោគចិនដើមនៃបន្ទាត់ទាំងពីរជាពាក្យដដែលៗពិតប្រាកដ (ឧ. "对对对", "快走快走")។ បើប្រយោគចិនខុសគ្នា អត្ថបទខ្មែរត្រូវតែខុសគ្នា!
- ត្រូវផ្តល់លទ្ធផល "khmerText" មួយគត់សម្រាប់ index / segmentId នីមួយៗ ដោយមិនលុប ឬផ្លាស់ប្តូរលេខរៀងឡើយ។
- ហាមដាច់ខាតកុំឱ្យ "khmerText" ទទេ, មានតែសញ្ញាវណ្ណយុត្តិ (ដូចជា "។", "!", "?") ឬប្រើពាក្យជំនួស ("សន្ទនា", "សូមរង់ចាំ", "...")! គ្រប់ index ទាំងអស់ត្រូវតែមានពាក្យខ្មែរពិតប្រាកដដែលអាចអានជាសំឡេងបាន ១០០%!

9. ច្បាប់រក្សាពាក្យកម្រិត ប្រធានច្បាស់ និងភាសាខ្មែរធម្មជាតិ (ANTI-TRANSLATIONESE — MANDATORY QUALITY RULES):
- RULE 1 — រក្សាពាក្យកម្រិត និងបរិមាណ (KEEP DEGREE WORDS): ហាមដាច់ខាតកាត់ពាក្យកម្រិត/បរិមាណចោលដើម្បីឱ្យចុះ "maxKhmerWords"! ពាក្យកម្រិតដូចជា 一点/有点 (បន្តិច / ល្មមៗ / គ្រាន់បើបន្តិច), 很/非常 (ខ្លាំង / ណាស់ / មែនទែន), 更 (កាន់តែ), 太 (ពេក), 只/才 (ត្រឹមតែ / ទើបតែ) ត្រូវតែរក្សាទុកក្នុងអត្ថបទខ្មែរជានិច្ច។ បើប្រយោគលើសចំនួនពាក្យ ត្រូវបង្រួមពាក្យអូសបន្លាយកន្លែងផ្សេងជំនួស ហាមកាត់ពាក្យកម្រិតចោលឡើយ! (ឧ. "好一点的人" ➜ "មនុស្សគ្រាន់បើបន្តិច" ឬ "មនុស្សល្មមៗ" — ហាមកាត់ "បន្តិច/ល្មមៗ" ចោល!)
- RULE 2 — បញ្ជាក់ប្រធានឱ្យច្បាស់ (EXPLICIT SUBJECT): ពេលការលុបប្រធាន (Subject) ចោលធ្វើឱ្យវិលន័យ ឬច្រឡំថា «អ្នកណា» ជាអ្នកធ្វើអំពើ (ឧ. 舍不得 = បក្ស/គេ/ពួកគេ «មិនដាច់ចិត្តចំណាយ/លះបង់» នរណាម្នាក់ — ហាមបក 舍不得 ថា «មិនស្ដាយ» ព្រោះវាផ្ទុយន័យទាំងស្រុង!) ប្រយោគខ្មែរត្រូវតែបញ្ចេញឈ្មោះប្រធានឱ្យច្បាស់តាមបរិបទ (គេ / បក្ស / ពួកគេ / គាត់ / ខ្ញុំ / ឯង...)។ (ឧ. "连好一点的都舍不得" ➜ "សូម្បីរបស់ល្អបន្តិច ក៏គេមិនដាច់ចិត្តចំណាយដែរ" — ហាមសរសេរ "ក៏មិនស្ដាយ"!)
- RULE 3 — សំណួរភាសាខ្មែរធម្មជាតិ (NATURAL KHMER QUESTIONS — ONE MARKER ONLY): សំណួរបញ្ច្រាសចិន (难道...吗 / 难道...不是... / 不是...吗) ត្រូវបកជាភាសាខ្មែរនិយាយធម្មជាតិដោយ**រក្សាពាក្យបដិសេធ "មិនមែន" (不是)** និងប្រើពាក្យសួរខ្មែរ**តែមួយគត់** (ដូចជា "...ទេឬ?" ឬ "...មែនទេ?") — ហាមដាច់ខាតលុប "មិនមែន" ចោល, ហាមដាក់ពាក្យសួរជាន់គ្នា ២ ដង (ដូច "ឬមួយ..." នៅខាងដើម ហើយបូក "...ទេឬក៏អ្វី?" / "...ឬក៏អ្វី?" / "...ទេហ្ដេស?" / "...ទេឬ?" នៅខាងចុង), និងហាមចម្លងរចនាសម្ព័ន្ធប្រយោគចិនពាក្យតាមពាក្យ! (ឧ. "难道你不是来找我的" ➜ ត្រូវបក "ឯងមិនមែនមករកខ្ញុំទេឬ?" ឬ "ឯងមិនមែនមករកខ្ញុំមែនទេ?" — ហាមដាច់ខាត "ឬមួយឯងមិនមែនមករកខ្ញុំទេឬក៏អ្វី?" ឬកាត់ "មិនមែន" ចោល!)

SURROUNDING NARRATIVE CONTEXT:
[Previous Lines]:
${previousContext}

[Upcoming Lines Preview]:
${upcomingContext}

INPUT SEGMENTS TO TRANSLATE (Batch ${Math.floor(b / TRANSLATION_BATCH) + 1}):
${JSON.stringify(dialoguePayload, null, 2)}

Return JSON ONLY matching this schema:
{
  "summary": "សេចក្តីសង្ខេបសាច់រឿងខ្លី",
  "detectedGenre": "ancient" | "ceo" | "modern" | "action" | "comedy",
  "castRegistry": [
    {
      "speakerId": "spk_male_lead",
      "speakerLabelKh": "តួឯកប្រុស (ព្រះអង្គម្ចាស់)",
      "voiceGender": "male",
      "roleArchetype": "royal_male_lead",
      "selfPronounKh": "យើង / ទូលបង្គំ",
      "addressPronounKh": "នាង / ម្ចាស់អូន"
    }
  ],
  "segments": [
    {
      "index": ${b + 1},
      "segmentId": ${dialoguePayload[0]?.segmentId || (b + 1)},${dialoguePayload[0]?.sourceCueId ? `\n      "sourceCueId": ${JSON.stringify(dialoguePayload[0].sourceCueId)},` : ''}
      "speakerId": "spk_male_lead",
      "speaker": "តួឯកប្រុស",
      "gender": "male",
      "voiceGender": "male",
      "khmerText": "ប្រយោគបកប្រែជាភាសាខ្មែរពេញលេញ"
    }
  ]
}
`;

      let orderedBatchModels = buildStage6OrderedModels(activePrimaryModel, fallbackModels, retiredModels, quotaDemotedModels, poolKeys);
      if (orderedBatchModels.length === 0) {
        orderedBatchModels = buildStage6OrderedModels(resolvedInitialModel, fallbackModels, null, null, poolKeys);
      }

      let recovered = false;
      const modelErrors = [];

      for (let mIdx = 0; mIdx < orderedBatchModels.length; mIdx++) {
        if (signal?.aborted) {
          throw createStage6AbortError(`Stage 6 Mode A aborted during batch ${batchNum}`);
        }
        const candidateModel = orderedBatchModels[mIdx];
        if (mIdx > 0) {
          console.log(`[Stage 6 Mode A] 🛡️ Batch ${batchNum}/${totalBatches}: Cascading to '${candidateModel}'...`);
        }

        const maxSameModelAttempts = 2;
        for (let attempt = 0; attempt < maxSameModelAttempts; attempt++) {
          try {
            const resp = await aiClient.models.generateContent({
              model: candidateModel,
              contents: [modeAPrompt],
              config: {
                temperature: 0.2,
                responseMimeType: 'application/json',
              },
            });
            recordGeminiUsage(resp, 'batch');

            const parsed = parseJsonResponseText(resp);
            const { appliedCount, missingLocalIndices } = applyBatchTranslations({
              batchSlice,
              dialogueList,
              dialoguePayload,
              batchOffset: b,
              parsed,
              isFastOcrMode,
            });

            if (appliedCount === 0 && batchSlice.length > 0) {
              throw new Error(`Model '${candidateModel}' returned 0 usable Khmer translations for Batch ${batchNum}`);
            }

            if (parsed.summary && b === 0) overallSummary = parsed.summary;
            if (parsed.detectedGenre && normRequestedGenre === 'auto' && b === 0) {
              effectiveGenre = normalizeGenre(parsed.detectedGenre);
            }

            // Flag any individual omitted lines inside an otherwise successful partial batch
            for (const missIdx of missingLocalIndices) {
              const targetSeg = dialogueList[b + missIdx];
              if (targetSeg && isPlaceholderTranslationText(targetSeg.khmerTranslatedText)) {
                targetSeg.khmerTranslatedText = '';
                targetSeg.reviewNeeded = true;
                targetSeg.translationStatus = 'review_needed';
                targetSeg.translationWarning = targetSeg.translationWarning || 'MISSING_SEGMENT_TRANSLATION';
                targetSeg.validationErrors = [
                  ...(targetSeg.validationErrors || []),
                  `មិនមានលទ្ធផលបកប្រែពី AI សម្រាប់បន្ទាត់ #${b + missIdx + 1} (ត្រូវការ Review ឬបកប្រែឡើងវិញ)`,
                ];
              }
            }

            // Cache successful translations for future runs (Smart Translation Cache)
            if (canUseCache) {
              for (let sIdx = 0; sIdx < batchSlice.length; sIdx++) {
                const segIdx = b + sIdx;
                const seg = dialogueList[segIdx];
                if (seg && seg.khmerTranslatedText && !isPlaceholderTranslationText(seg.khmerTranslatedText)) {
                  const targetChinese = String(seg.originalChineseText || seg.chineseText || seg.originalText || '').trim();
                  const prevSeg = segIdx > 0 ? dialogueList[segIdx - 1] : null;
                  const prevContext = prevSeg ? (prevSeg.originalChineseText || prevSeg.chineseText || prevSeg.originalText || '') : '';
                  setCachedTranslation(targetChinese, {
                    khmerText: seg.khmerTranslatedText,
                    speaker: seg.speaker,
                    voiceGender: seg.voiceGender || seg.visualGender,
                    prevContext,
                    seriesId: effectiveSeriesId,
                    glossaryHash,
                    mode: isFastOcrMode ? 'fast_ocr' : 'dialogue',
                  });
                }
              }
            }

            activePrimaryModel = candidateModel;
            quotaDemotedModels.delete(candidateModel);
            recovered = true;
            saveEpisodeTranslationCheckpoint();
            if (mIdx > 0) {
              console.log(`[Stage 6 Mode A] ✅ Batch ${batchNum} rescued with '${candidateModel}'!`);
            }
            break;
          } catch (err) {
            if (isAbortLikeError(err, signal)) {
              throw err?.name === 'AbortError' ? err : createStage6AbortError();
            }

            const sanitizedMsg = sanitizeStage6ErrorMsg(err);

            // Fail-fast immediately on 401/403 authentication errors across ALL keys
            if (isAuthOrInvalidKeyError(err)) {
              const authErr = new Error(`[Stage 6 Mode A] Gemini API Key មិនត្រឹមត្រូវ ឬផុតសុពលភាព (${sanitizedMsg})`);
              authErr.status = Number(err?.status || err?.statusCode || 401);
              authErr.code = 'INVALID_API_KEY';
              authErr.nonRetryable = true;
              throw authErr;
            }

            const isNotFound = isModelNotFoundError(err);
            const isQuota = isQuotaOrRateLimitError(err);
            const isTimeout = isTimeoutLikeError(err);

            if (isNotFound) retiredModels.add(candidateModel);
            if (isQuota || isTimeout) quotaDemotedModels.add(candidateModel);

            // Cascade immediately on 404 / 429 / 503 / 504 without burning retry backoff on the same model
            const canRetrySameModel = !isNotFound && !isQuota && !isTimeout && attempt + 1 < maxSameModelAttempts;
            if (canRetrySameModel) {
              console.warn(`[Stage 6 Mode A] Retry '${candidateModel}' (attempt ${attempt + 1}/${maxSameModelAttempts}) for Batch ${batchNum}: ${sanitizedMsg}`);
              if (retryDelayMs > 0) {
                await new Promise((r) => setTimeout(r, retryDelayMs));
              }
              continue;
            }

            console.warn(`[Stage 6 Mode A] Batch ${batchNum} model '${candidateModel}' failed: ${sanitizedMsg}`);
            modelErrors.push({
              model: candidateModel,
              status: err?.status || err?.statusCode || null,
              isQuota,
              isNotFound,
              isTimeout,
              message: sanitizedMsg,
            });
            break;
          }
        }

        if (recovered) break;
      }

      if (recovered) {
        return true;
      }

      const lastModelErr = modelErrors[modelErrors.length - 1] || { message: 'Unknown translation error' };
      batchFailures.push({
        batchNum,
        startIndex: b + 1,
        endIndex: b + batchSlice.length,
        segmentCount: batchSlice.length,
        lastError: lastModelErr,
        errors: modelErrors,
      });

      for (let i = 0; i < batchSlice.length; i++) {
        const targetSeg = dialogueList[b + i];
        if (targetSeg && isPlaceholderTranslationText(targetSeg.khmerTranslatedText)) {
          targetSeg.khmerTranslatedText = '';
          targetSeg.reviewNeeded = true;
          targetSeg.translationStatus = 'review_needed';
          targetSeg.translationWarning = 'TRANSLATION_FAILED';
          targetSeg.validationErrors = [
            ...(targetSeg.validationErrors || []),
            `ការបកប្រែ AI បរាជ័យសម្រាប់ Batch ${batchNum}: ${lastModelErr.message}`,
          ];
        }
      }

      return false;
    }

    for (let i = 0; i < batchDescriptors.length; i += translationConcurrency) {
      if (signal?.aborted) {
        throw createStage6AbortError(`Stage 6 Mode A aborted during translation waves`);
      }
      const wave = batchDescriptors.slice(i, i + translationConcurrency);
      const waveResults = await Promise.all(wave.map((item) => processBatch(item)));
      const hasFailure = waveResults.some((res) => res === false);
      if (hasFailure) {
        consecutiveFailures++;
        if (totalBatches === 1 || consecutiveFailures >= 2) {
          console.error(`[Stage 6 Mode A] 🚨 Aborting Stage 6 early at Wave ${Math.floor(i / translationConcurrency) + 1} after ${consecutiveFailures} consecutive failure(s).`);
          break;
        }
      } else {
        consecutiveFailures = 0;
      }
    }

    const translatedSegmentsCount = dialogueList.filter((s) => !isPlaceholderTranslationText(s.khmerTranslatedText)).length;
    const untranslatedCount = dialogueList.length - translatedSegmentsCount;
    const failedRatio = dialogueList.length > 0 ? untranslatedCount / dialogueList.length : 0;

    if (
      batchFailures.length > 0 &&
      (totalBatches === 1 ||
        consecutiveFailures >= 2 ||
        batchFailures.length >= 2 ||
        translatedSegmentsCount === 0 ||
        failedRatio >= 0.25)
    ) {
      const allErrors = batchFailures.flatMap((bf) => bf.errors || []);
      const hasQuotaErr = allErrors.some((e) => e.isQuota);
      const hasNotFoundOnly = allErrors.length > 0 && allErrors.every((e) => e.isNotFound);
      const firstFailedBatch = batchFailures[0]?.batchNum || 1;
      const lastMsg = batchFailures[batchFailures.length - 1]?.lastError?.message || 'All cascade models failed';

      let errCode = 'TRANSLATION_FAILED';
      let errStatus = batchFailures[batchFailures.length - 1]?.lastError?.status || 502;
      let errMessage = `[Stage 6 Mode A] ការបកប្រែ AI បរាជ័យ (${errCode}) នៅ Batch ${firstFailedBatch}/${totalBatches} (បរាជ័យ ${untranslatedCount}/${dialogueList.length} ឃ្លា): ${lastMsg}`;

      if (hasQuotaErr) {
        errCode = 'QUOTA_EXCEEDED';
        errStatus = 429;
        errMessage = `[Stage 6 Mode A] Gemini API Quota/Rate Limit ពេញគ្រប់ Key និងគ្រប់ Cascade Model នៅ Batch ${firstFailedBatch}/${totalBatches} (បរាជ័យ ${untranslatedCount}/${dialogueList.length} ឃ្លា): ${lastMsg}`;
      } else if (hasNotFoundOnly) {
        errCode = 'MODEL_UNAVAILABLE';
        errStatus = 404;
        errMessage = `[Stage 6 Mode A] ម៉ូដែល Gemini មិនអាចប្រើបាន (404 Model Unavailable) នៅ Batch ${firstFailedBatch}/${totalBatches}: ${lastMsg}`;
      }

      const stage6Err = new Error(errMessage);
      stage6Err.code = errCode;
      stage6Err.status = errStatus;
      stage6Err.translationReport = {
        totalSegments: dialogueList.length,
        translatedCount: translatedSegmentsCount,
        untranslatedCount,
        totalBatches,
        failedBatches: batchFailures.length,
        isPartial: translatedSegmentsCount > 0,
      };
      throw stage6Err;
    }

    // Bounded Auto-Retry for isolated omitted/broken lines (never touches already healthy segments)
    const missingRetryIndices = [];
    for (let idx = 0; idx < dialogueList.length; idx++) {
      if (isPlaceholderTranslationText(dialogueList[idx]?.khmerTranslatedText)) {
        missingRetryIndices.push(idx);
      }
    }

    let retryQuotaAborted = false;
    if (missingRetryIndices.length > 0 && aiClient?.models?.generateContent) {
      const RETRY_BATCH_SIZE = 25;
      const targetRetryIndices = missingRetryIndices;
      const rTotalBatches = Math.ceil(targetRetryIndices.length / RETRY_BATCH_SIZE);
      let rescuedCount = 0;

      console.log(`[Stage 6 Mode A] 🔄 Auto-retrying ${targetRetryIndices.length} missing/broken segment(s) in ${rTotalBatches} small batch(es)...`);

      for (let rStart = 0; rStart < targetRetryIndices.length; rStart += RETRY_BATCH_SIZE) {
        if (signal?.aborted) {
          throw createStage6AbortError('Stage 6 Mode A aborted during recovery retry');
        }
        if (retryQuotaAborted) break;

        const rBatchNum = Math.floor(rStart / RETRY_BATCH_SIZE) + 1;
        let pendingSlice = targetRetryIndices.slice(rStart, rStart + RETRY_BATCH_SIZE);

        const orderedRetryModels = buildStage6OrderedModels(
          activePrimaryModel,
          fallbackModels,
          retiredModels,
          quotaDemotedModels,
          poolKeys
        ).slice(0, 6);

        let zeroMatchAttempts = 0;
        for (const candidateModel of orderedRetryModels) {
          if (signal?.aborted) {
            throw createStage6AbortError('Stage 6 Mode A aborted during recovery retry');
          }
          pendingSlice = pendingSlice.filter((globalIdx) => isPlaceholderTranslationText(dialogueList[globalIdx]?.khmerTranslatedText));
          if (pendingSlice.length === 0) break;

          const retryPayload = pendingSlice.map((globalIdx) => buildRetrySegmentPayload(dialogueList, globalIdx));
          const retryPrompt = `
អ្នកគឺជាអ្នកបកប្រែកុនភាគចិន-ខ្មែរអាជីព។ ឃ្លាខាងក្រោមត្រូវបានរំលង ឬមានអត្ថបទមិនគ្រប់លក្ខណៈពីជំហានមុន — សូមបកប្រែឃ្លានីមួយៗឡើងវិញឱ្យបានពេញលេញជាភាសាខ្មែរធម្មជាតិ ១០០%។

ច្បាប់តឹងរ៉ឹង៖
- 1 Segment = 1 Translation ដោយប្រើ "index" និង "segmentId" ដូចក្នុង Input ដដែល (រួមទាំងឃ្លា OCR ខ្លីៗ ឈ្មោះជំនាញ/ទិដ្ឋភាព ឬឃ្លាជេរ/កំហឹងក្នុងសាច់រឿង ហាមរំលងដាច់ខាត)។
- ហាមដាច់ខាតកុំឱ្យ "khmerText" ទទេ, មានតែសញ្ញាវណ្ណយុត្តិ (ដូចជា "។", "!", "?") ឬប្រើពាក្យជំនួស ("សន្ទនា", "សូមរង់ចាំ", "...")!
- ហាមមានតួអក្សរចិន ឬតួអក្សរថៃ នៅក្នុង "khmerText" ដាច់ខាត។
- រក្សាពាក្យកម្រិត (一点/有点 ➜ បន្តិច/ល្មមៗ, 很/非常 ➜ ខ្លាំង/ណាស់, 更 ➜ កាន់តែ) ហាមកាត់ចោលដើម្បីឱ្យចុះ maxKhmerWords; បញ្ជាក់ប្រធាន (គេ/បក្ស/គាត់/ខ្ញុំ/ឯង) ឱ្យច្បាស់បើការកាត់ប្រធានធ្វើឱ្យវិលន័យ (ដូច 舍不得 = គេមិនដាច់ចិត្តចំណាយ/លះបង់); សំណួរបញ្ច្រាសចិន (难道/不是...吗) ប្រើសញ្ញាសំណួរខ្មែរតែមួយគត់ (ទេឬ? / មែនទេ?) ហាមដាក់ "ឬមួយ..." ជាន់ជាមួយ "...ឬក៏អ្វី?" ឬ "...ទេហ្ដេស?"!

RECOVER MISSING OR BROKEN KHMER DIALOGUE SEGMENTS (Retry Batch ${rBatchNum}/${rTotalBatches}):
${JSON.stringify(retryPayload, null, 2)}

Return JSON ONLY matching this schema:
{
  "segments": [
    {
      "index": ${retryPayload[0]?.index || 1},
      "segmentId": ${retryPayload[0]?.segmentId || 1},${retryPayload[0]?.sourceCueId ? `\n      "sourceCueId": ${JSON.stringify(retryPayload[0].sourceCueId)},` : ''}
      "speaker": "តួឯកប្រុស",
      "gender": "male",
      "khmerText": "ប្រយោគបកប្រែជាភាសាខ្មែរពេញលេញ"
    }
  ]
}`;

          try {
            const resp = await aiClient.models.generateContent({
              model: candidateModel,
              contents: [retryPrompt],
              config: {
                temperature: 0.2,
                responseMimeType: 'application/json',
              },
            });
            recordGeminiUsage(resp, 'retry');
            const parsed = parseJsonResponseText(resp);
            const translations = extractSegmentsFromParsedResponse(parsed);
            const matchedTranslations = resolveBatchTranslationMatches(translations, retryPayload);

            let batchApplied = 0;
            for (let k = 0; k < pendingSlice.length; k++) {
              const globalIdx = pendingSlice[k];
              const payloadItem = retryPayload[k];
              const t = matchedTranslations[k];
              const targetSeg = dialogueList[globalIdx];
              if (!t || !targetSeg) continue;
              const ok = applyTranslatedSegmentResult(targetSeg, t, payloadItem.maxKhmerWords, globalIdx, { isFastOcrMode });
              if (ok) {
                clearRescuedSegmentFailureState(targetSeg);
                batchApplied++;
                rescuedCount++;
              }
            }

            if (batchApplied === pendingSlice.length) {
              break;
            }
            if (batchApplied > 0) {
              zeroMatchAttempts = 0;
              continue;
            }
            zeroMatchAttempts++;
            if (zeroMatchAttempts >= 2) {
              break;
            }
          } catch (retryErr) {
            if (isAbortLikeError(retryErr, signal)) {
              throw retryErr?.name === 'AbortError' ? retryErr : createStage6AbortError();
            }
            if (isAuthOrInvalidKeyError(retryErr)) {
              const sanitizedMsg = sanitizeStage6ErrorMsg(retryErr);
              const authErr = new Error(`[Stage 6 Mode A Retry] Gemini API Key មិនត្រឹមត្រូវ ឬផុតសុពលភាព (${sanitizedMsg})`);
              authErr.status = Number(retryErr?.status || retryErr?.statusCode || 401);
              authErr.code = 'INVALID_API_KEY';
              authErr.nonRetryable = true;
              throw authErr;
            }
            if (isModelNotFoundError(retryErr)) retiredModels.add(candidateModel);
            if (isQuotaOrRateLimitError(retryErr) || isTimeoutLikeError(retryErr)) {
              quotaDemotedModels.add(candidateModel);
              if (candidateModel === orderedRetryModels[orderedRetryModels.length - 1]) {
                retryQuotaAborted = true;
              }
            }
            console.warn(`[Stage 6 Mode A] Recovery retry batch ${rBatchNum}/${rTotalBatches} notice on '${candidateModel}': ${sanitizeStage6ErrorMsg(retryErr)}`);
          }
        }
      }

      if (rescuedCount > 0) {
        console.log(`[Stage 6 Mode A] ✅ Auto-retry rescued ${rescuedCount}/${targetRetryIndices.length} missing/broken segment(s)!`);
      }

      // Stage 3 Bounded Final Rescue: isolate any remaining omitted line (1-by-1 without batch index drift)
      const stillMissingPrioritized = [];
      const stillMissingFailed = [];
      for (let idx = 0; idx < dialogueList.length; idx++) {
        const s = dialogueList[idx];
        if (!s || !isPlaceholderTranslationText(s.khmerTranslatedText)) continue;
        const srcCn = String(s.originalChineseText || s.chineseText || s.originalText || s.spokenAudioText || '').trim();
        if (!srcCn) continue;
        if (s.translationWarning === 'TRANSLATION_FAILED') {
          stillMissingFailed.push(idx);
        } else {
          stillMissingPrioritized.push(idx);
        }
      }

      const singleLineTargets = [...stillMissingPrioritized, ...stillMissingFailed];
      if (singleLineTargets.length > 0 && !retryQuotaAborted) {
        let singleRescuedCount = 0;
        let consecAllFailedLines = 0;
        console.log(`[Stage 6 Mode A] 🎯 Single-line final rescue for ${singleLineTargets.length} remaining omitted segment(s)...`);

        for (const globalIdx of singleLineTargets) {
          if (signal?.aborted) {
            throw createStage6AbortError('Stage 6 Mode A aborted during single-line rescue');
          }
          if (consecAllFailedLines >= 3) break;

          const payloadItem = buildRetrySegmentPayload(dialogueList, globalIdx);
          const singlePrompt = `
អ្នកគឺជាអ្នកបកប្រែកុនភាគចិន-ខ្មែរអាជីព។ នេះជាការបកប្រែឃ្លាសន្ទនារឿងភាគសម្រាប់ Dubbing — ទោះបីជាឃ្លាកំហឹង/ជេរប្រមាថក្នុងសាច់រឿង ពាក្យ OCR ខ្លីៗ (ឧ. ឈ្មោះទីតាំង/ជំនាញ/មុំមើល) ឬឃ្លាមិនទាន់ចប់ន័យ ក៏ត្រូវបកប្រែជាភាសាខ្មែរធម្មជាតិ ១០០% ហាមរំលង ឬទុកទទេជាដាច់ខាត។
ច្បាប់គុណភាព៖ រក្សាពាក្យកម្រិត (一点/有点 ➜ បន្តិច/ល្មមៗ, 很/非常 ➜ ខ្លាំង/ណាស់, 更 ➜ កាន់តែ) ហាមកាត់ចោល; ដាក់ប្រធានច្បាស់ (គេ/បក្ស/គាត់/ខ្ញុំ/ឯង) បើបាត់ប្រធានធ្វើឱ្យវិលន័យ (ដូច 舍不得 = គេមិនដាច់ចិត្តចំណាយ/លះបង់); សំណួរបញ្ច្រាសចិន (难道/不是...吗) ប្រើពាក្យសួរខ្មែរតែមួយគត់ (ទេឬ? / មែនទេ?) ហាមដាក់ "ឬមួយ..." ជាន់ជាមួយ "...ឬក៏អ្វី?" / "...ទេហ្ដេស?"!

RECOVER SINGLE MISSING KHMER LINE (#${payloadItem.index}):
- sourceChineseToTranslate: ${JSON.stringify(payloadItem.sourceChineseToTranslate)}
${payloadItem.prevContext ? `- prevContext: ${JSON.stringify(payloadItem.prevContext)}` : ''}
${payloadItem.nextContext ? `- nextContext: ${JSON.stringify(payloadItem.nextContext)}` : ''}
- maxKhmerWords: ${payloadItem.maxKhmerWords}
- maxKhmerChars: ${payloadItem.maxKhmerChars} (ហាមមានតួអក្សរចិនសូម្បីតែ ១ តួ — ត្រូវបក ឬសរសេរសូរសព្ទជាអក្សរខ្មែរ ១០០%)
- speakerHint: ${JSON.stringify(payloadItem.speaker)}
- detectedGender: ${JSON.stringify(payloadItem.detectedGender)}

Return ONE JSON object ONLY (no array, no extra commentary):
{
  "speaker": "តួឯកប្រុស",
  "gender": "male",
  "khmerText": "ប្រយោគបកប្រែជាភាសាខ្មែរពេញលេញ"
}`;

          const orderedSingleModels = buildStage6OrderedModels(
            activePrimaryModel,
            fallbackModels,
            retiredModels,
            quotaDemotedModels,
            poolKeys
          ).slice(0, 6);

          let lineRescued = false;
          for (const candidateModel of orderedSingleModels) {
            if (signal?.aborted) {
              throw createStage6AbortError('Stage 6 Mode A aborted during single-line rescue');
            }
            try {
              const resp = await aiClient.models.generateContent({
                model: candidateModel,
                contents: [singlePrompt],
                config: {
                  temperature: 0.25,
                  responseMimeType: 'application/json',
                },
              });
              recordGeminiUsage(resp, 'rescue');
              const parsed = parseJsonResponseText(resp);
              const candidate = extractSingleLineRescueCandidate(parsed, payloadItem);
              const targetSeg = dialogueList[globalIdx];
              if (candidate && targetSeg) {
                const ok = applyTranslatedSegmentResult(targetSeg, candidate, payloadItem.maxKhmerWords, globalIdx, { isFastOcrMode });
                if (ok) {
                  clearRescuedSegmentFailureState(targetSeg);
                  if (canUseCache) {
                    const prevSeg = globalIdx > 0 ? dialogueList[globalIdx - 1] : null;
                    const prevContext = prevSeg ? (prevSeg.originalChineseText || prevSeg.chineseText || prevSeg.originalText || '') : '';
                    setCachedTranslation(payloadItem.sourceChineseToTranslate, {
                      khmerText: targetSeg.khmerTranslatedText,
                      speaker: targetSeg.speaker,
                      voiceGender: targetSeg.voiceGender || targetSeg.visualGender,
                      prevContext,
                      seriesId: effectiveSeriesId,
                      glossaryHash,
                      mode: isFastOcrMode ? 'fast_ocr' : 'dialogue',
                    });
                  }
                  lineRescued = true;
                  singleRescuedCount++;
                  break;
                }
              }
            } catch (singleErr) {
              if (isAbortLikeError(singleErr, signal)) {
                throw singleErr?.name === 'AbortError' ? singleErr : createStage6AbortError();
              }
              if (isAuthOrInvalidKeyError(singleErr)) {
                const sanitizedMsg = sanitizeStage6ErrorMsg(singleErr);
                const authErr = new Error(`[Stage 6 Mode A Single-Line Rescue] Gemini API Key មិនត្រឹមត្រូវ ឬផុតសុពលភាព (${sanitizedMsg})`);
                authErr.status = Number(singleErr?.status || singleErr?.statusCode || 401);
                authErr.code = 'INVALID_API_KEY';
                authErr.nonRetryable = true;
                throw authErr;
              }
              if (isModelNotFoundError(singleErr)) retiredModels.add(candidateModel);
              if (isQuotaOrRateLimitError(singleErr) || isTimeoutLikeError(singleErr)) {
                quotaDemotedModels.add(candidateModel);
              }
            }
          }

          if (lineRescued) {
            consecAllFailedLines = 0;
          } else {
            consecAllFailedLines++;
          }
        }

        if (singleRescuedCount > 0) {
          console.log(`[Stage 6 Mode A] ✅ Single-line rescue recovered ${singleRescuedCount}/${singleLineTargets.length} stubborn segment(s)!`);
        }
      }
      saveEpisodeTranslationCheckpoint();
    }

    // Phase 1: Non-destructive duplicate detection pass (flags warnings, never auto-deletes)
    dialogueList = detectDuplicateTranslations(dialogueList);

    // Whole-episode character gender consistency & voice re-derivation pass (both Fast OCR & Standard Dialogue)
    const consistencyRes = enforceEpisodeCharacterConsistency(dialogueList, {
      defaultGender: narratorGender,
      isFastOcrMode,
    });
    dialogueList = consistencyRes.segments;
    const consistencySummary = consistencyRes.stats;

    const scriptSegments = dialogueList.map((s, idx) => createCanonicalSegment(s, idx, normMode));
    const finalTranslatedCount = scriptSegments.filter((s) => !isPlaceholderTranslationText(s.khmerTranslatedText) && s.translationStatus !== 'review_needed').length;
    const finalUntranslatedCount = scriptSegments.length - finalTranslatedCount;
    const verifiedSourceCuesCount = reconciledSegments.length;
    const mappingBaseline = (reconciledSegments.every((s) => Boolean(s?.sourceCueId)) && (isFastOcrMode || dialogueList.length === reconciledSegments.length))
      ? reconciledSegments
      : dialogueList;
    const hasBaselineCueIds = mappingBaseline.some((s) => Boolean(s?.sourceCueId));
    const strictMapping = hasBaselineCueIds
      ? validateStrictSourceCueMapping(mappingBaseline, scriptSegments)
      : null;

    const missingCueIds = strictMapping
      ? [...new Set([...strictMapping.missingSourceCueIds, ...strictMapping.invalidTranslationCueIds])]
      : scriptSegments
          .filter((s) => isPlaceholderTranslationText(s.khmerTranslatedText) || s.translationStatus === 'review_needed')
          .map((s) => s.sourceCueId || s.segmentId);

    const translationCompletenessPct = verifiedSourceCuesCount > 0
      ? parseFloat(((Math.min(finalTranslatedCount, verifiedSourceCuesCount) / verifiedSourceCuesCount) * 100).toFixed(2))
      : 0;
    const oneToOneMappingValid = strictMapping
      ? Boolean(strictMapping.valid && finalUntranslatedCount === 0 && scriptSegments.length === verifiedSourceCuesCount)
      : Boolean(scriptSegments.length === verifiedSourceCuesCount && finalUntranslatedCount === 0);

    return {
      mode: normMode,
      genre: normRequestedGenre,
      detectedGenre: effectiveGenre,
      summary: overallSummary,
      ...(consistencySummary ? { consistencySummary } : {}),
      usage: usageStats,
      translationReport: {
        totalSegments: scriptSegments.length,
        verifiedSourceCuesCount,
        translatedCount: finalTranslatedCount,
        untranslatedCount: finalUntranslatedCount,
        missingCueIds,
        duplicateCueIds: strictMapping ? strictMapping.duplicateSourceCueIds : [],
        unexpectedCueIds: strictMapping ? strictMapping.unexpectedSourceCueIds : [],
        mismatchedCueIds: strictMapping ? strictMapping.mismatchedOrderCueIds : [],
        invalidTranslationCueIds: strictMapping ? strictMapping.invalidTranslationCueIds : [],
        exactCueIdSetMatch: strictMapping ? strictMapping.exactCueIdSetMatch : null,
        translationCompletenessPct,
        oneToOneMappingValid,
        totalBatches,
        failedBatches: batchFailures.length,
        isPartial: !oneToOneMappingValid || finalUntranslatedCount > 0,
        usage: usageStats,
      },
      scriptSegments,
    };
  } else {
    // ==========================================
    // MODE B: CINEMATIC DRAMA RECAP / NARRATION
    // ==========================================
    const normNarratorGender = String(narratorGender || 'male').toLowerCase() === 'female' ? 'female' : 'male';
    const totalDurStr = formatSecondsToTimecode(durationSec);

    const contextHints = reconciledSegments
      .slice(0, 80)
      .map((s) => `[${formatSecondsToTimecode(s.startSec)}]: ${s.originalChineseText}`)
      .join('\n');

    const modeBPrompt = `
You are a master Khmer video storytelling recap narrator (អ្នកសម្រាយរឿងបែបកុនភាគខ្មែរ).
MODE B - CINEMATIC DRAMA RECAP (សម្រាយសាច់រឿងកុនរស់រវើក).

TASK (MODE B - CINEMATIC DRAMA RECAP / NARRATION):
Craft an engaging, dramatic, theatrical storytelling narration in Khmer covering the story progression.

VIDEO DURATION: ${durationSec}s (${totalDurStr})
SPEAKER GENDER: ${normNarratorGender}
ORIGINAL CHINESE CONTEXT HINTS:
${contextHints || '(គ្មានពាក្យសន្ទនាចិន - ផ្អែកលើការនិទានសាច់រឿង)'}
${userDirection ? `Special Instructions: ${userDirection}` : ''}

RULES:
1. Divide the video duration into natural narrative segments (each 6.0s - 14.0s).
2. "khmerText": Cinematic, theatrical Khmer narration with engaging hooks.
3. Keep segments non-overlapping, in chronological order spanning the video duration.
4. "speaker": "អ្នកសម្រាយរឿង"
5. Absolutely forbid Thai characters or loanwords.
6. KEEP DEGREE WORDS: Never drop degree/quantity modifiers from Chinese context (一点/有点 -> បន្តិច/ល្មមៗ, 很/非常 -> ខ្លាំង/ណាស់, 更 -> កាន់តែ). Compress filler elsewhere instead of dropping degree words.
7. EXPLICIT SUBJECT: Always name the subject clearly (គេ/បក្ស/គាត់/តួឯក...) whenever omitting the subject would flip or blur WHO performs the action (e.g. 舍不得 = the sect/they unwilling to part with someone).
8. NATURAL KHMER QUESTIONS: Render rhetorical questions (难道...吗 / 不是...吗) in natural spoken Khmer with ONE question marker only (ទេឬ? / មែនទេ?) — never stack "ឬមួយ..." at the start with "...ឬក៏អ្វី?" / "...ទេហ្ដេស?" at the end, and never copy Chinese sentence skeletons word-for-word.

Return JSON ONLY:
{
  "summary": "សេចក្តីសង្ខេបសាច់រឿងទាំងមូល 1-2 ប្រយោគ",
  "segments": [
    {
      "startSec": 0.5,
      "endSec": 8.0,
      "khmerText": "ស្វាគមន៍មកកាន់ការសម្រាយរឿង..."
    }
  ]
}
`;

    let summary = 'សម្រាយរឿងបែបកុនភាគខ្មែរ';
    let segmentsOut = [];

    const modeBModels = buildStage6OrderedModels(resolvedInitialModel, fallbackModels, null, null, poolKeys);
    let lastModeBErr = null;

    for (let mIdx = 0; mIdx < modeBModels.length; mIdx++) {
      if (signal?.aborted) {
        throw createStage6AbortError('Stage 6 Mode B aborted by user signal');
      }
      const candidateModel = modeBModels[mIdx];
      try {
        const resp = await aiClient.models.generateContent({
          model: candidateModel,
          contents: [modeBPrompt],
          config: {
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        });
        recordGeminiUsage(resp, 'batch');

        const parsed = parseJsonResponseText(resp);
        if (parsed.summary) summary = parsed.summary;
        const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : [];
        segmentsOut = rawSegs.map((s) => ({
          ...s,
          khmerText: cleanKhmerSpokenText(s.khmerText || ''),
          speaker: 'អ្នកសម្រាយរឿង',
          speakerId: 'narrator',
          voiceGender: normNarratorGender,
          voiceId: normNarratorGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural',
          evidenceType: 'cinematic_recap',
        }));
        break;
      } catch (err) {
        if (isAbortLikeError(err, signal)) {
          throw err?.name === 'AbortError' ? err : createStage6AbortError();
        }
        const sanitizedMsg = sanitizeStage6ErrorMsg(err);
        if (isAuthOrInvalidKeyError(err)) {
          const authErr = new Error(`[Stage 6 Mode B] Gemini API Key មិនត្រឹមត្រូវ ឬផុតសុពលភាព (${sanitizedMsg})`);
          authErr.status = Number(err?.status || err?.statusCode || 401);
          authErr.code = 'INVALID_API_KEY';
          authErr.nonRetryable = true;
          throw authErr;
        }
        lastModeBErr = err;
        console.warn(`[Stage 6 Mode B] Recap model '${candidateModel}' failed:`, sanitizedMsg);
        const canCascade = isQuotaOrRateLimitError(err) || isModelNotFoundError(err) || isTimeoutLikeError(err);
        if (!canCascade) break;
      }
    }

    if (segmentsOut.length === 0 && lastModeBErr) {
      const sanitizedMsg = sanitizeStage6ErrorMsg(lastModeBErr);
      const recapErr = new Error(`[Stage 6 Mode B] Recap generation call error: ${sanitizedMsg}`);
      recapErr.isPartial = false;
      recapErr.code = isQuotaOrRateLimitError(lastModeBErr) ? 'QUOTA_EXCEEDED' : 'RECAP_FAILED';
      recapErr.status = lastModeBErr?.status || lastModeBErr?.statusCode || (recapErr.code === 'QUOTA_EXCEEDED' ? 429 : 502);
      throw recapErr;
    }

    if (segmentsOut.length === 0) {
      throw new Error('[Stage 6 Mode B] Recap generation produced 0 segments');
    }

    const normRequestedGenre = normalizeGenre(genre);
    const modeBEffectiveGenre = normRequestedGenre !== 'auto'
      ? normRequestedGenre
      : detectDramaGenre('', userDirection);
    const scriptSegments = segmentsOut.map((s, idx) => createCanonicalSegment(s, idx, normMode));
    return {
      mode: normMode,
      genre: normRequestedGenre,
      detectedGenre: modeBEffectiveGenre,
      summary,
      usage: usageStats,
      scriptSegments,
    };
  }
}


module.exports = {
  generateModeSpecificScript,
  createCanonicalSegment,
  deriveVoiceFromGender,
  enforceEpisodeCharacterConsistency,
  enforceFastOcrCharacterConsistency,
  applyTranslatedSegmentResult,
  buildSafeSpeakerId,
  splitLongDialogueSegment,
  condenseKhmerDialogue,
  detectDramaGenre,
  getGenrePromptGuidelines,
  cleanKhmerSpokenText,
  computeKhmerSimilarity,
  detectDuplicateTranslations,
  isPlaceholderTranslationText,
  getCachedTranslation,
  setCachedTranslation,
  getTranslationCacheKey,
  STAGE6_CASCADE_MODELS,
};
