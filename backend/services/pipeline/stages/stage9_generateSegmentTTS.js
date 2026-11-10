const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  generateSingleSegmentSpeech,
  cleanTextForTts,
  isPlaceholderOrEmptyTtsText,
  speedToEdgeRate,
} = require('../../ttsService');
const { getMediaDuration } = require('../../ffmpegService');
const {
  loadSegmentLedger,
  recordSegmentCompletion,
  verifySegmentAudioIntegrity,
} = require('../segmentLedger');
const { detectSpeakerGender } = require('../../../models/speakerRegistry');

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
 * @param {number} [params.concurrency=5]
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
  concurrency = 5,
  jobId = null,
  seriesId = 'series_default',
  episodeId = 'ep_1',
  baseUploadsDir = null,
  signal = null,
  onSegmentCompleted = null,
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

      // Speaker-to-voice assignment (manual override -> registry -> resolved gender/speaker title -> existing voiceId)
      const segSpkName = String(seg.speaker || seg.speakerName || '').trim();
      const isGenericSegSpk = !segSpkName || segSpkName === 'តួអង្គ' || segSpkName.toLowerCase() === 'speaker';
      const localReg = speakerRegistry || seg.speakerRegistry || {};
      const registryVoice =
        (seg.speakerId && localReg[seg.speakerId]?.voiceId) ||
        (!isGenericSegSpk && localReg[segSpkName]?.voiceId) ||
        null;
      const isManualSeg = Boolean(seg.userOverridden || seg.voiceAssignmentSource === 'manual' || seg.voiceOverride);
      const normSegGender = String(seg.voiceGender || seg.gender || seg.speakerGender || '').trim().toLowerCase();
      let knownSegGender = (normSegGender === 'female' || normSegGender === 'f' || normSegGender === 'girl')
        ? 'female'
        : ((normSegGender === 'male' || normSegGender === 'm' || normSegGender === 'boy') ? 'male' : '');
      if (!knownSegGender) {
        const kwG = detectSpeakerGender(segSpkName, '', khmerText);
        if (kwG === 'FEMALE') knownSegGender = 'female';
        else if (kwG === 'MALE') knownSegGender = 'male';
      }
      const genderDerivedVoice = knownSegGender === 'female'
        ? 'km-KH-SreymomNeural'
        : (knownSegGender === 'male' ? 'km-KH-PisethNeural' : null);

      const chosenVoiceId = isManualSeg
        ? (seg.voiceOverride || seg.voiceId || seg.khmerVoiceId || seg.voice || registryVoice || genderDerivedVoice || defaultVoiceId)
        : (registryVoice || genderDerivedVoice || seg.khmerVoiceId || seg.voiceId || seg.voice || defaultVoiceId);
      seg.khmerVoiceId = chosenVoiceId;
      seg.voiceId = chosenVoiceId;
      seg.voice = chosenVoiceId;

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
          seg.audioUrl = toPublicAudioUrl(integrity.audioPath); // សម្រាប់ចំណុចទី 1 (Ledger)
          seg.audioDurationSec = integrity.durationSec;
          seg.ttsStatus = 'ready';
          seg.audioOutdated = false;
          results[idx] = seg;

          if (typeof onSegmentCompleted === 'function') {
            onSegmentCompleted(seg, idx, reusedCount + generatedCount);
          }
          continue;
        }
      }

      // 2. Check if existing episode audio file is valid
      const existingAudioPath = seg.audioPath || (seg.audioFile ? path.join(audioDir, path.basename(seg.audioFile)) : null);
      const customSpeedMatchesExisting = !hasCustomSegSpeed || Boolean(seg.ttsRate && segSpeedInfo.valid && seg.ttsRate === segSpeedInfo.rate);
      const canReuseExisting = !forceRegen && !seg.audioOutdated && customSpeedMatchesExisting && existingAudioPath && fs.existsSync(existingAudioPath) && fs.statSync(existingAudioPath).size > 200;

      if (canReuseExisting) {
        reusedCount++;
        seg.audioPath = existingAudioPath;
        seg.audioFile = path.basename(existingAudioPath);
        seg.audioUrl = toPublicAudioUrl(existingAudioPath);   // សម្រាប់ចំណុចទី 2 (Existing Audio)
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

      // 3. Check persistent disk TTS cache
      const cacheKey = getTtsAudioCacheKey(khmerText, chosenVoiceId, effectiveTargetDuration);
      const cachedAudioPath = path.join(cacheDir, `tts_${cacheKey}.mp3`);
      const cachedMetaPath = path.join(cacheDir, `tts_${cacheKey}.json`);

      if (!forceRegen && !hasCustomSegSpeed && fs.existsSync(cachedAudioPath) && fs.statSync(cachedAudioPath).size > 200) {
        try {
          const destFile = `seg_${seg.id || idx + 1}_${cacheKey.substring(0, 8)}.mp3`;
          const destPath = path.join(audioDir, destFile);
          fs.copyFileSync(cachedAudioPath, destPath);

          let cachedDuration = seg.duration;
          if (fs.existsSync(cachedMetaPath)) {
            const meta = JSON.parse(fs.readFileSync(cachedMetaPath, 'utf8'));
            if (meta?.audioDurationSec) cachedDuration = meta.audioDurationSec;
          }

          reusedCount++;
          seg.audioFile = destFile;
          seg.audioPath = destPath;
          seg.audioUrl = toPublicAudioUrl(destPath);            // សម្រាប់ចំណុចទី 3 (Disk Cache)
          seg.audioDurationSec = cachedDuration;
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

  return {
    segmentsWithAudio: results,
    ttsReport: {
      totalSegments: segments.length,
      generatedCount,
      reusedCount,
      failedCount,
      skippedEmptyCount,
    },
  };
}

module.exports = {
  generateSegmentTTS,
};
