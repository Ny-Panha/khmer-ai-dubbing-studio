const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  generateSingleSegmentSpeech,
  cleanTextForTts,
  isPlaceholderOrEmptyTtsText,
  speedToEdgeRate,
  computeSegmentAudioSignature,
} = require('../../ttsService');
const { getMediaDuration } = require('../../ffmpegService');
const {
  loadSegmentLedger,
  recordSegmentCompletion,
  verifySegmentAudioIntegrity,
} = require('../segmentLedger');
const { detectSpeakerGender } = require('../../../models/speakerRegistry');
const { containsChineseHanzi } = require('../../../utils/translationQuality');
const { isIntroductionCategory, NARRATOR_SPEAKER_LABEL, NARRATOR_SPEAKER_ID } = require('../../../utils/textEventClassifier');
const { DUBBING_CASCADE_MODELS } = require('../../geminiModelCatalog');
const {
  isPlaceholderTranslationText,
  cleanKhmerSpokenText,
  parseJsonResponseText,
  extractSegmentsFromParsedResponse,
} = require('./stage6PromptAndConsistency');

/**
 * Identify TTS-synthesized segments that STILL overflow their subtitle slot even after
 * auto-stretch, excluding user-overridden or custom-speed clips.
 */
function findOverflowShortenCandidates(segments = [], {
  maxOverflowThresholdSec = 0.15,
  maxSegments = 20,
} = {}) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const candidates = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (!seg || seg.userOverridden || seg.userCustomSpeed) continue;
    if (seg.ttsStatus === 'empty_text' || seg.ttsStatus === 'error' || seg.ttsStatus === 'failed') continue;

    const currentKhmer = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || '').trim();
    const hasHanzi = containsChineseHanzi(currentKhmer);
    if (!currentKhmer || (!hasHanzi && currentKhmer.length < 10)) continue;

    const segStart = typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)
      ? seg.audioStartSec
      : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : 0);
    const nextSeg = segments[idx + 1];
    const nextStart = nextSeg
      ? (typeof nextSeg.audioStartSec === 'number' && !isNaN(nextSeg.audioStartSec)
        ? nextSeg.audioStartSec
        : (typeof nextSeg.startSec === 'number' && !isNaN(nextSeg.startSec) ? nextSeg.startSec : null))
      : null;

    let slotSec = Number(seg.availableSlotDuration || seg.slotDuration || seg.duration || 0);
    if (nextStart !== null && nextStart > segStart) {
      const gapSlot = parseFloat((nextStart - segStart).toFixed(3));
      slotSec = slotSec > 0 ? Math.min(slotSec, gapSlot) : gapSlot;
    }
    if (!Number.isFinite(slotSec) || slotSec < 0.35) continue;

    const actualDur = Number(seg.finalAudioDuration || seg.audioDurationSec || seg.audioDuration || 0);
    const computedOverflow = actualDur > slotSec ? parseFloat((actualDur - slotSec).toFixed(3)) : 0;
    const overflowSec = Math.max(Number(seg.overflowSec || 0), computedOverflow);

    if (overflowSec > maxOverflowThresholdSec || hasHanzi) {
      candidates.push({
        idx,
        seg,
        currentKhmer,
        hasHanzi,
        slotSec: parseFloat(slotSec.toFixed(2)),
        actualDur: parseFloat(actualDur.toFixed(2)),
        overflowSec: parseFloat(overflowSec.toFixed(3)),
        maxKhmerChars: Math.max(6, Math.min(70, Math.floor(slotSec * 15))),
      });
    }
  }

  // Prioritize largest overlaps / Hanzi leaks first
  candidates.sort((a, b) => (Number(b.hasHanzi) - Number(a.hasHanzi)) || (b.overflowSec - a.overflowSec));
  return candidates.slice(0, maxSegments);
}

/**
 * Post-TTS Auto-Shorten Pass:
 * Sends ONLY overflowing segments (typically 3-10 lines/episode) in one tiny Gemini call
 * to condense verbose Khmer lines so they fit naturally inside their subtitle slot without
 * audio collisions, then re-synthesizes only those shortened clips.
 * Non-fatal: if AI client is unavailable or fails, returns original segments safely.
 */
async function autoShortenOverflowingSegments({
  segments = [],
  audioDir,
  aiClient = null,
  modelName = null,
  generateSingleFn = null,
  maxOverflowThresholdSec = 0.15,
  maxSegments = 20,
  signal = null,
  ttsOptions = {},
} = {}) {
  if (!Array.isArray(segments) || segments.length === 0 || !audioDir) {
    return { segments, shortenedCount: 0, shortenedIds: [] };
  }
  if (!aiClient?.models?.generateContent || signal?.aborted) {
    return { segments, shortenedCount: 0, shortenedIds: [] };
  }

  const candidates = findOverflowShortenCandidates(segments, {
    maxOverflowThresholdSec,
    maxSegments,
  });
  if (candidates.length === 0) {
    return { segments, shortenedCount: 0, shortenedIds: [] };
  }

  const payload = candidates.map((c) => ({
    index: c.idx + 1,
    segmentId: c.seg.segmentId || c.seg.id || (c.idx + 1),
    chinese: String(c.seg.originalChineseText || c.seg.chineseText || c.seg.originalText || '').trim(),
    currentKhmer: c.currentKhmer,
    currentAudioSec: c.actualDur,
    targetSlotSec: c.slotSec,
    maxKhmerChars: c.maxKhmerChars,
  }));

  const shortenPrompt = `អ្នកគឺជាអ្នកកែសម្រួល Script Dubbing កុនភាគខ្មែរអាជីព។ ឃ្លាខាងក្រោមមានសំឡេងអានខ្មែរវែងហួសប្រវែង slot វីដេអូ (overflow) ធ្វើឱ្យសំឡេងជាន់ឃ្លាបន្ទាប់។
សូមសង្ខេបឃ្លាខ្មែរនីមួយៗឱ្យ «ខ្លីជាងមុន ៣០%–៥០%» ដោយគោរព "maxKhmerChars" យ៉ាងតឹងរ៉ឹង ប៉ុន្តែរក្សាអត្ថន័យស្នូល អារម្មណ៍ និងភាសានិយាយធម្មជាតិដដែល!

ច្បាប់តឹងរ៉ឹង៖
- ហាមមានតួអក្សរចិន (汉字) ឬតួអក្សរថៃ នៅក្នុង "khmerText" ដាច់ខាត (100% Khmer Script Only)!
- ត្រូវខ្លីជាង "currentKhmer" ជានិច្ច (ឧ. slot 0.6s "再快一点" ➜ "លឿនឡើង!", slot 1.2s "再晚就没座位了" ➜ "យឺតអស់កន្លែងហើយ!")។
- រក្សា index និង segmentId ដូច Input ទាំងអស់។
- EXPRESSIVE SOUNDS PROTECTION (AUTO-COMPACT): ហាមលុបចោល ឬកាត់បន្ថយសំឡេងអារម្មណ៍មានន័យ ការសើច ការយំ ការក្អក ការដកដង្ហើមធំ ការស្ទាក់ស្ទើរ ឬពាក្យឧទានខ្លីៗ (ដូចជា ហាហាហាហា!, ហេហេហេ..., អា៎! អា៎!, ខក់! ខក់!, អ៊ឹម..., ហ៊ឹស!, ហ៊ឺ...) ហើយហាមប្តូរសំឡេងទាំងនោះទៅជាពាក្យពណ៌នា "សើច", "យំ", "ក្អក", ឬ "ស្រែក" ជាដាច់ខាត!

OVERFLOWING SEGMENTS TO CONDENSE:
${JSON.stringify(payload, null, 2)}

Return JSON ONLY matching this schema:
{
  "segments": [
    {
      "index": ${payload[0].index},
      "segmentId": ${payload[0].segmentId},
      "khmerText": "ប្រយោគខ្មែរខ្លីចំខ្លឹមសារ"
    }
  ]
}`;

  const modelsToTry = Array.from(
    new Set([modelName, ...(DUBBING_CASCADE_MODELS || [])].filter(Boolean))
  ).slice(0, 5);

  let parsedItems = [];
  for (const candidateModel of modelsToTry) {
    if (signal?.aborted) break;
    try {
      const resp = await aiClient.models.generateContent({
        model: candidateModel,
        contents: [shortenPrompt],
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      });
      const parsed = parseJsonResponseText(resp);
      parsedItems = extractSegmentsFromParsedResponse(parsed);
      if (parsedItems.length > 0) break;
    } catch (err) {
      console.warn(`[Stage 9 Auto-Shorten] Model '${candidateModel}' failed: ${err?.message || err}`);
    }
  }

  if (parsedItems.length === 0) {
    return { segments, shortenedCount: 0, shortenedIds: [] };
  }

  const byKey = new Map();
  for (const item of parsedItems) {
    if (!item || typeof item !== 'object') continue;
    const rawKh = item.khmerText || item.khmer || item.khmerTranslatedText || '';
    const cleaned = cleanKhmerSpokenText(rawKh);
    if (!cleaned || isPlaceholderTranslationText(cleaned)) continue;
    if (item.segmentId !== undefined && item.segmentId !== null) byKey.set(`sid:${item.segmentId}`, cleaned);
    if (item.index !== undefined && item.index !== null) byKey.set(`idx:${item.index}`, cleaned);
  }

  const synthFn = generateSingleFn || generateSingleSegmentSpeech;
  const updated = [...segments];
  const shortenedIds = [];
  let shortenedCount = 0;

  for (const c of candidates) {
    if (signal?.aborted) break;
    const segId = c.seg.segmentId || c.seg.id || (c.idx + 1);
    const rewritten = byKey.get(`idx:${c.idx + 1}`) || byKey.get(`sid:${segId}`);
    if (!rewritten) continue;
    if (!c.hasHanzi && rewritten.length >= c.currentKhmer.length) continue;

    const priorAudioPath = updated[c.idx]?.audioPath || null;
    const draftSeg = {
      ...updated[c.idx],
      khmer: rewritten,
      khmerText: rewritten,
      khmerTranslatedText: rewritten,
      availableSlotDuration: c.slotSec,
      slotDuration: c.slotSec,
      // Strip prior file references during speculative re-TTS so generateSingleSegmentAudio never unlinks the working fallback MP3 before we know reTts is shorter
      audioPath: null,
      audioFile: null,
      audioFileName: null,
      audioUrl: null,
    };

    try {
      const voiceId = draftSeg.voiceId || draftSeg.khmerVoiceId || draftSeg.voice || 'km-KH-PisethNeural';
      const reTts = await synthFn(draftSeg, audioDir, {
        ...ttsOptions,
        voiceId,
        targetDurationSec: c.slotSec,
        autoStretch: true,
        maxSpeed: 1.50,
        forceRegen: true,
        userCustomSpeed: false,
        preservePriorAudioOnDisk: true,
      });

      const newDur = Number(reTts?.finalAudioDuration || reTts?.audioDurationSec || reTts?.audioDuration || 0);
      const isAccepted = Boolean(reTts && reTts.audioPath && fs.existsSync(reTts.audioPath) && (c.hasHanzi || (newDur > 0 && newDur < c.actualDur)));
      if (isAccepted) {
        const newSig = computeSegmentAudioSignature(rewritten, voiceId, draftSeg.speed ?? draftSeg.rate, draftSeg.pitch);
        updated[c.idx] = {
          ...draftSeg,
          ...reTts,
          khmer: rewritten,
          khmerText: rewritten,
          khmerTranslatedText: rewritten,
          autoShortenedFrom: c.currentKhmer,
          audioSignature: newSig,
          audioGenerated: true,
          ttsStatus: 'ready',
          audioOutdated: false,
        };
        shortenedCount++;
        shortenedIds.push(segId);
      } else if (reTts?.audioPath && path.resolve(reTts.audioPath) !== (priorAudioPath ? path.resolve(priorAudioPath) : '')) {
        try { if (fs.existsSync(reTts.audioPath)) fs.unlinkSync(reTts.audioPath); } catch (_) {}
        try {
          const rejSidecar = reTts.audioPath.replace(/\.[^.]+$/, '.json');
          if (fs.existsSync(rejSidecar)) fs.unlinkSync(rejSidecar);
        } catch (_) {}
      }
    } catch (reTtsErr) {
      console.warn(`[Stage 9 Auto-Shorten] Re-TTS failed for segment #${segId}: ${reTtsErr?.message || reTtsErr}`);
    }
  }

  if (shortenedCount > 0) {
    console.log(`[Stage 9 Auto-Shorten] ✂️ Condensed & re-synthesized ${shortenedCount}/${candidates.length} overflowing segment(s): [${shortenedIds.join(', ')}]`);
  }

  return {
    segments: updated,
    shortenedCount,
    shortenedIds,
  };
}

function getTtsAudioCacheKey(text, voiceId, durationSec) {
  return crypto.createHash('md5')
    .update(`${text.trim()}_${voiceId}_${(durationSec || 0).toFixed(1)}`)
    .digest('hex');
}

/**
 * Stage 9: Generate Segment TTS
 * Synthesizes Khmer speech per segment with bounded parallel concurrency (5 workers),
 * durable per-segment completion ledger persistence, cancellation & pause checks,
 * and selective audio reuse.
 * 
 * @param {object} params
 * @param {Array} params.segments
 * @param {string} params.audioDir - Physical episode audio directory
 * @param {string} [params.defaultVoiceId='km-KH-PisethNeural']
 * @param {boolean} [params.forceRegen=false]
 * @param {number} [params.concurrency=3]
 * @param {string} [params.jobId=null]
 * @param {string} [params.seriesId='series_default']
 * @param {string} [params.episodeId='ep_1']
 * @param {string} [params.baseUploadsDir=null]
 * @param {AbortSignal} [params.signal=null]
 * @param {Function} [params.onSegmentCompleted=null]
 * @returns {Promise<{ segmentsWithAudio: Array, ttsReport: object }>}
 */
async function generateSegmentTTS({
  segments = [],
  audioDir,
  defaultVoiceId = 'km-KH-PisethNeural',
  speakerRegistry = {},
  forceRegen = false,
  concurrency = 3,
  jobId = null,
  seriesId = 'series_default',
  episodeId = 'ep_1',
  baseUploadsDir = null,
  signal = null,
  onSegmentCompleted = null,
  aiClient = null,
  modelName = null,
  autoShortenOverflow = true,
}) {
  if (signal?.aborted) {
    const abortErr = new Error('TTS generation interrupted by signal');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  if (!audioDir) {
    throw new Error('[Stage 9 TTS] Episode audio directory parameter is required');
  }

  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }

  const cacheDir = path.join(__dirname, '../../../uploads/cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Load existing durable ledger if jobId provided
  const { segments: ledger } = jobId
    ? loadSegmentLedger(jobId, seriesId, episodeId, baseUploadsDir)
    : { segments: {} };

  const results = new Array(segments.length);
  let generatedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;
  let skippedEmptyCount = 0;
  let currentIndex = 0;
  let isInterrupted = false;

  // បន្ថែមអថេរ uploadsRoot នៅខាងលើអនុគមន៍ worker() ក្នុង stage9_generateSegmentTTS.js
  const uploadsRoot = baseUploadsDir || path.resolve(__dirname, '../../../uploads');

  // បង្កើត Helper សម្រាប់បំប្លែងទីតាំងឯកសារសំឡេងទៅជា URL ត្រឹមត្រូវ
  function toPublicAudioUrl(targetAudioPath) {
    const relPath = path.relative(uploadsRoot, targetAudioPath).replace(/\\/g, '/');
    return `/uploads/${relPath}`;
  }

  async function worker() {
    while (currentIndex < segments.length) {
      if (signal?.aborted || isInterrupted) {
        isInterrupted = true;
        break;
      }

      const idx = currentIndex++;
      const seg = { ...segments[idx] };
      const rawKhmer = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || '');
      const khmerText = cleanTextForTts ? cleanTextForTts(rawKhmer) : rawKhmer.trim();

      if (!khmerText || isPlaceholderOrEmptyTtsText(rawKhmer)) {
        seg.ttsStatus = 'empty_text';
        seg.audioPath = null;
        seg.audioFile = null;
        seg.audioUrl = null;
        seg.audioGenerated = false;
        results[idx] = seg;
        skippedEmptyCount++;
        continue;
      }

      // Speaker-to-voice assignment following 6-tier precedence:
      // 1. Explicit manual segment voice override
      // 2. Explicit manual character voice assignment
      // 3. Confirmed series-level character voice assignment
      // 4. Reliable detected character gender (male -> Piseth, female -> Sreymom)
      // 5. Existing valid voice assignment
      // 6. Default fallback (Piseth)
      const segSpkName = String(seg.speaker || seg.speakerName || '').trim();
      const isNarratorOrIntro = Boolean(
        seg.speakerId === NARRATOR_SPEAKER_ID ||
        segSpkName === NARRATOR_SPEAKER_LABEL ||
        isIntroductionCategory(seg.textCategory)
      );
      const isGenericSegSpk = !segSpkName || segSpkName === 'តួអង្គ' || segSpkName.toLowerCase() === 'speaker';
      const localReg = isNarratorOrIntro ? {} : (speakerRegistry || seg.speakerRegistry || {});
      const regEntry =
        (seg.speakerId && localReg[seg.speakerId]) ||
        (!isGenericSegSpk && localReg[segSpkName]) ||
        Object.values(localReg).find((r) => r && (
          (r.speakerId && (r.speakerId === seg.speakerId || r.id === seg.speakerId)) ||
          (!isGenericSegSpk && (r.speakerName === segSpkName || r.name === segSpkName))
        )) || null;
      const registryVoice = regEntry?.voiceId || regEntry?.khmerVoiceId || null;
      const regIsManual = Boolean(regEntry?.userOverridden) || regEntry?.voiceAssignmentSource === 'manual';
      const segHasManual = Boolean(seg.userOverridden || seg.voiceAssignmentSource === 'manual' || seg.voiceOverride);

      const rawSegGender = String(regEntry?.voiceGender || seg.voiceGender || seg.speakerGender || '').trim().toLowerCase();
      let knownSegGender = (rawSegGender === 'female' || rawSegGender === 'f' || rawSegGender === 'girl')
        ? 'female'
        : ((rawSegGender === 'male' || rawSegGender === 'm' || rawSegGender === 'boy') ? 'male' : '');
      const hasVerifiedStep1 = Boolean(
        seg.speakerStatus === 'verified' ||
        seg.speakerVerified === true ||
        seg.voiceAssignmentSource === 'multimodal_verified' ||
        seg.voiceAssignmentSource === 'series_glossary' ||
        seg.manualCharacterOverridden === true
      );
      if (!knownSegGender && !hasVerifiedStep1 && !segHasManual && !regIsManual) {
        // Step 2 never guesses gender from translated Khmer text
        const kwG = detectSpeakerGender(segSpkName, '', '');
        if (kwG === 'FEMALE') knownSegGender = 'female';
        else if (kwG === 'MALE') knownSegGender = 'male';
      }
      const genderDerivedVoice = knownSegGender === 'female'
        ? 'km-KH-SreymomNeural'
        : (knownSegGender === 'male' ? 'km-KH-PisethNeural' : null);

      let chosenVoiceId;
      if (segHasManual && (seg.voiceOverride || seg.khmerVoiceId || seg.voiceId || seg.voice)) {
        chosenVoiceId = seg.voiceOverride || seg.khmerVoiceId || seg.voiceId || seg.voice;
      } else if (regIsManual && registryVoice) {
        chosenVoiceId = registryVoice;
      } else if (hasVerifiedStep1 && (seg.khmerVoiceId || seg.voiceId || seg.voice)) {
        chosenVoiceId = seg.khmerVoiceId || seg.voiceId || seg.voice;
      } else if (regEntry?.voiceAssignmentSource === 'series_glossary' && registryVoice) {
        chosenVoiceId = registryVoice;
      } else if (genderDerivedVoice) {
        chosenVoiceId = genderDerivedVoice;
      } else if (registryVoice || seg.khmerVoiceId || seg.voiceId || seg.voice) {
        chosenVoiceId = registryVoice || seg.khmerVoiceId || seg.voiceId || seg.voice;
      } else {
        chosenVoiceId = defaultVoiceId || 'km-KH-PisethNeural';
      }

      seg.khmerVoiceId = chosenVoiceId;
      seg.voiceId = chosenVoiceId;
      seg.voice = chosenVoiceId;

      const isManualChoice = Boolean(segHasManual || regIsManual);
      const isFallbackChoice = !isManualChoice && !hasVerifiedStep1 && !genderDerivedVoice && !registryVoice;

      // Preserve Step 1 character identity & voice metadata strictly without reclassifying
      if (regEntry?.characterId && !seg.characterId) {
        seg.characterId = regEntry.characterId;
      }
      const resolvedGender = knownSegGender || (regEntry?.voiceGender || seg.voiceGender || 'unknown');
      seg.voiceGender = resolvedGender;
      seg.gender = resolvedGender;
      seg.speakerGender = resolvedGender === 'female' ? 'FEMALE' : (resolvedGender === 'male' ? 'MALE' : 'UNKNOWN');
      seg.isFallback = isFallbackChoice;
      if (isFallbackChoice || seg.speakerStatus === 'review_needed' || seg.speakerReviewNeeded) {
        seg.reviewNeeded = true;
        if (isFallbackChoice) {
          seg.voiceAssignmentSource = 'fallback';
        }
      }

      const segKey = String(seg.id || `seg_${idx + 1}`);

      // Finding 1: Compute effectiveTargetDuration once per segment before Ledger Verification
      const effectiveTargetDuration =
        Number.isFinite(seg.duration) && seg.duration > 0
          ? (
              Number.isFinite(seg.slotDuration) && seg.slotDuration > 0
                ? Math.min(seg.duration, seg.slotDuration)
                : seg.duration
            )
          : null;

      if (effectiveTargetDuration === null) {
        seg.ttsStatus = 'failed';
        seg.validationErrors = [...(seg.validationErrors || []), 'INVALID_TARGET_DURATION'];
        results[idx] = seg;
        failedCount++;
        continue;
      }

      const segSpeedInfo = speedToEdgeRate(seg.speed ?? seg.rate);
      const hasCustomSegSpeed = Boolean(seg.userCustomSpeed || segSpeedInfo.isCustomNonDefault);
      const audioSignature = computeSegmentAudioSignature(khmerText, chosenVoiceId, seg.speed ?? seg.rate, seg.pitch);

      // 1. Check Durable Segment Ledger First (Phase 4.2 & 4.3 Requirement)
      const existingLedgerRecord = jobId ? ledger[segKey] : null;
      if (existingLedgerRecord && !forceRegen && !hasCustomSegSpeed) {
        const integrity = await verifySegmentAudioIntegrity({
          record: existingLedgerRecord,
          expectedText: khmerText,
          expectedVoiceId: chosenVoiceId,
          expectedTargetDurationSec: effectiveTargetDuration,
          jobId,
          seriesId,
          episodeId,
          baseUploadsDir,
          durationValidatorFn: getMediaDuration,
        });

        if (integrity.valid) {
          reusedCount++;
          seg.audioPath = integrity.audioPath;
          seg.audioFile = path.basename(integrity.audioPath);
          seg.audioUrl = toPublicAudioUrl(integrity.audioPath);
          seg.audioDurationSec = integrity.durationSec;
          seg.ttsStatus = 'ready';
          seg.audioOutdated = false;
          seg.audioSignature = audioSignature;
          results[idx] = seg;

          if (typeof onSegmentCompleted === 'function') {
            onSegmentCompleted(seg, idx, reusedCount + generatedCount);
          }
          continue;
        }
      }

      // 2. Check if existing episode audio file is valid (Smart TTS Cache v2: verify audioSignature & size >= 500B)
      const existingAudioPath = seg.audioPath || (seg.audioFile ? path.join(audioDir, path.basename(seg.audioFile)) : null);
      const customSpeedMatchesExisting = !hasCustomSegSpeed || Boolean(seg.ttsRate && segSpeedInfo.valid && seg.ttsRate === segSpeedInfo.rate);

      // A segment without audioSignature MUST NOT be trusted on file existence alone unless verified against a trusted ledger/metadata file that recorded the exact text and voice
      let sigMatches = Boolean(seg.audioSignature && seg.audioSignature === audioSignature);
      if (!sigMatches && !seg.audioSignature && existingAudioPath && fs.existsSync(existingAudioPath)) {
        const metaPath = existingAudioPath.replace(/\.[^.]+$/, '.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (
              meta &&
              meta.text &&
              cleanTextForTts(meta.text) === cleanTextForTts(khmerText) &&
              (meta.voiceId === chosenVoiceId || meta.voice === chosenVoiceId) &&
              (!meta.audioSignature || meta.audioSignature === audioSignature)
            ) {
              sigMatches = true;
              seg.audioSignature = audioSignature;
            }
          } catch (_) {}
        }
      }
      const canReuseExisting = !forceRegen && !seg.audioOutdated && customSpeedMatchesExisting && sigMatches && existingAudioPath && fs.existsSync(existingAudioPath) && fs.statSync(existingAudioPath).size > 500;

      if (canReuseExisting) {
        reusedCount++;
        seg.audioPath = existingAudioPath;
        seg.audioFile = path.basename(existingAudioPath);
        seg.audioUrl = toPublicAudioUrl(existingAudioPath);
        seg.audioSignature = audioSignature;
        try {
          const realDur = await getMediaDuration(existingAudioPath);
          if (typeof realDur === 'number' && realDur > 0) {
            seg.audioDurationSec = realDur;
            seg.finalAudioDuration = realDur;
            seg.rawAudioDur = realDur;
            seg.originalAudioDuration = realDur;
            const startSec = typeof seg.audioStartSec === 'number' ? seg.audioStartSec : (seg.startSec || 0);
            seg.audioEndSec = parseFloat((startSec + realDur).toFixed(2));
          }
        } catch (_) {}
        seg.ttsStatus = 'ready';
        seg.audioOutdated = false;
        results[idx] = seg;

        if (jobId) {
          recordSegmentCompletion({
            jobId,
            seriesId,
            episodeId,
            segmentId: segKey,
            segmentIndex: idx,
            text: khmerText,
            voiceId: chosenVoiceId,
            targetDurationSec: effectiveTargetDuration,
            audioPath: existingAudioPath,
            fileSize: fs.statSync(existingAudioPath).size,
            durationSec: seg.duration,
            baseUploadsDir,
          });
        }

        if (typeof onSegmentCompleted === 'function') {
          onSegmentCompleted(seg, idx, reusedCount + generatedCount);
        }
        continue;
      }

      // 3. Check persistent disk TTS cache (Smart TTS Cache v2: keyed by audioSignature)
      const cacheKey = audioSignature;
      const cachedAudioPath = path.join(cacheDir, `tts_${cacheKey}.mp3`);
      const cachedMetaPath = path.join(cacheDir, `tts_${cacheKey}.json`);

      if (!forceRegen && !hasCustomSegSpeed && fs.existsSync(cachedAudioPath) && fs.statSync(cachedAudioPath).size > 500) {
        try {
          let cachedDuration = seg.duration;
          let cacheVoiceValid = true;
          if (fs.existsSync(cachedMetaPath)) {
            const meta = JSON.parse(fs.readFileSync(cachedMetaPath, 'utf8'));
            if (meta?.audioDurationSec) cachedDuration = meta.audioDurationSec;
            const recordedVoice = meta?.actualVoiceId || meta?.voiceId;
            if (recordedVoice && recordedVoice !== chosenVoiceId) {
              cacheVoiceValid = false;
            }
          }
          if (cacheVoiceValid) {
            const destFile = `seg_${seg.id || idx + 1}_${cacheKey.substring(0, 8)}.mp3`;
            const destPath = path.join(audioDir, destFile);
            fs.copyFileSync(cachedAudioPath, destPath);

            reusedCount++;
            seg.audioFile = destFile;
            seg.audioPath = destPath;
            seg.audioUrl = toPublicAudioUrl(destPath);
            seg.audioDurationSec = cachedDuration;
            seg.audioSignature = audioSignature;
            seg.actualVoiceId = chosenVoiceId;
            seg.ttsStatus = 'ready';
            seg.audioOutdated = false;
            results[idx] = seg;

            if (jobId) {
              recordSegmentCompletion({
                jobId,
                seriesId,
                episodeId,
                segmentId: segKey,
                segmentIndex: idx,
                text: khmerText,
                voiceId: chosenVoiceId,
                targetDurationSec: effectiveTargetDuration,
                audioPath: destPath,
                fileSize: fs.statSync(destPath).size,
                durationSec: cachedDuration,
                baseUploadsDir,
              });
            }

            if (typeof onSegmentCompleted === 'function') {
              onSegmentCompleted(seg, idx, reusedCount + generatedCount);
            }
            continue;
          }
        } catch (_) {}
      }

      // 4. Synthesize new audio via Edge TTS
      try {
        const result = await generateSingleSegmentSpeech(
          seg,
          audioDir,
          {
            voiceId: chosenVoiceId,
            targetDurationSec: effectiveTargetDuration,
            maxSpeed: 1.35,
            speed: seg.speed,
            rate: segSpeedInfo.valid ? segSpeedInfo.rate : undefined,
            userCustomSpeed: hasCustomSegSpeed,
          }
        );

        generatedCount++;
        seg.audioFile = result.audioFile;
        seg.audioPath = result.audioPath;
        seg.audioUrl = result.audioUrl;
        seg.audioDurationSec = result.audioDurationSec;
        seg.audioDuration = result.audioDuration;
        seg.finalAudioDuration = result.finalAudioDuration;
        seg.originalAudioDuration = result.originalAudioDuration;
        seg.rawAudioDur = result.rawAudioDur;
        seg.audioEndSec = result.audioEndSec;
        seg.appliedSpeed = result.appliedSpeed;
        seg.userCustomSpeed = result.userCustomSpeed;
        seg.ttsRate = result.ttsRate;
        seg.speed = result.speed;
        seg.overflowSec = result.overflowSec;
        seg.ttsStatus = 'ready';
        seg.audioOutdated = false;
        seg.audioSignature = audioSignature;
        seg.actualVoiceId = result.actualVoiceId || chosenVoiceId;

        // Persist sidecar metadata next to audio file while preserving PROVENANCE_VERSION metadata written by ttsService
        if (result.audioPath && fs.existsSync(result.audioPath)) {
          try {
            const sidecarMeta = result.audioPath.replace(/\.[^.]+$/, '.json');
            let existingSidecar = {};
            if (fs.existsSync(sidecarMeta)) {
              try {
                existingSidecar = JSON.parse(fs.readFileSync(sidecarMeta, 'utf8')) || {};
              } catch (_) {}
            }
            fs.writeFileSync(sidecarMeta, JSON.stringify({
              ...existingSidecar,
              text: khmerText,
              voiceId: chosenVoiceId,
              actualVoiceId: seg.actualVoiceId,
              audioSignature,
              audioDurationSec: result.audioDurationSec,
              timestamp: Date.now(),
            }, null, 2), 'utf8');
          } catch (_) {}
        }

        // Persist to segment ledger atomically
        if (jobId && result.audioPath && fs.existsSync(result.audioPath)) {
          recordSegmentCompletion({
            jobId,
            seriesId,
            episodeId,
            segmentId: segKey,
            segmentIndex: idx,
            text: khmerText,
            voiceId: chosenVoiceId,
            targetDurationSec: effectiveTargetDuration,
            audioPath: result.audioPath,
            fileSize: fs.statSync(result.audioPath).size,
            durationSec: result.audioDurationSec,
            baseUploadsDir,
          });
        }

        // Persist to disk cache only for default-speed audio so custom-speed variants never poison +0% cache
        if (!hasCustomSegSpeed && result.audioPath && fs.existsSync(result.audioPath)) {
          try {
            fs.copyFileSync(result.audioPath, cachedAudioPath);
            fs.writeFileSync(cachedMetaPath, JSON.stringify({
              audioDurationSec: result.audioDurationSec,
              voiceId: chosenVoiceId,
              text: khmerText,
              timestamp: Date.now(),
            }, null, 2), 'utf8');
          } catch (_) {}
        }

        if (typeof onSegmentCompleted === 'function') {
          onSegmentCompleted(seg, idx, reusedCount + generatedCount);
        }
      } catch (ttsErr) {
        failedCount++;
        console.warn(`[Stage 9 TTS] Audio generation failed for segment #${seg.id || idx + 1}:`, ttsErr.message);
        seg.ttsStatus = 'error';
        seg.audioGenerated = false;
        seg.audioOutdated = true;
        seg.reviewNeeded = true;
        seg.ttsError = ttsErr.message;
      }

      results[idx] = seg;
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, segments.length));
  console.log(`[Stage 9 TTS] Starting parallel TTS synthesis for ${segments.length} segments with ${poolSize} concurrent workers...`);
  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);

  if (signal?.aborted || isInterrupted) {
    const abortErr = new Error('TTS generation interrupted by signal');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  let finalSegments = results;
  let autoShortenedCount = 0;
  let autoShortenedIds = [];
  if (autoShortenOverflow !== false && aiClient?.models?.generateContent && !signal?.aborted) {
    try {
      const shortenRes = await autoShortenOverflowingSegments({
        segments: results,
        audioDir,
        aiClient,
        modelName,
        signal,
      });
      finalSegments = shortenRes.segments;
      autoShortenedCount = shortenRes.shortenedCount;
      autoShortenedIds = shortenRes.shortenedIds;
    } catch (shortenErr) {
      console.warn(`[Stage 9 TTS] Auto-shorten pass skipped: ${shortenErr?.message || shortenErr}`);
    }
  }

  const failedSegmentIds = finalSegments
    .filter((s) => s && (s.ttsStatus === 'error' || s.ttsStatus === 'failed' || s.ttsStatus === 'voice_mismatch'))
    .map((s) => s.sourceCueId || s.segmentId || s.id);
  const ttsComplete = failedCount === 0 && failedSegmentIds.length === 0;

  return {
    segmentsWithAudio: finalSegments,
    ttsReport: {
      status: ttsComplete ? 'completed' : 'review_needed',
      isComplete: ttsComplete,
      totalSegments: segments.length,
      generatedCount,
      reusedCount,
      failedCount,
      failedSegmentIds,
      skippedEmptyCount,
      autoShortenedCount,
      autoShortenedIds,
    },
  };
}

module.exports = {
  generateSegmentTTS,
  findOverflowShortenCandidates,
  autoShortenOverflowingSegments,
};
