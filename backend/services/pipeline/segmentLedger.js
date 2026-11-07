const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  atomicWriteJson,
  sanitizeIdentifier,
  getJobDir,
} = require('./productionJobQueue');

/**
 * Generates a deterministic content fingerprint for a TTS segment.
 * Combines cleaned text, voice ID, and target duration.
 */
function generateSegmentFingerprint({ text, voiceId, targetDurationSec = 0 }) {
  const cleanText = String(text || '').trim();
  const cleanVoice = String(voiceId || 'km-KH-PisethNeural').trim();
  const durStr = Number.isFinite(targetDurationSec) ? Number(targetDurationSec).toFixed(2) : '0.00';

  return crypto
    .createHash('sha256')
    .update(`${cleanText}__${cleanVoice}__${durStr}`)
    .digest('hex');
}

/**
 * Resolves the canonical segment ledger file path for a job.
 * uploads/projects/:seriesId/episodes/:episodeId/jobs/:jobId.segments.json
 */
function getSegmentLedgerFilePath(seriesId, episodeId, jobId, baseUploadsDir = null) {
  const jobDir = getJobDir(seriesId, episodeId, baseUploadsDir);
  const cleanJobId = sanitizeIdentifier(jobId, 'job_unknown');
  return path.join(jobDir, `${cleanJobId}.segments.json`);
}

/**
 * Loads the segment completion ledger safely from disk.
 */
function loadSegmentLedger(jobId, seriesId, episodeId, baseUploadsDir = null) {
  const filePath = getSegmentLedgerFilePath(seriesId, episodeId, jobId, baseUploadsDir);
  if (!fs.existsSync(filePath)) {
    return { segments: {}, corrupted: false };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { segments: {}, corrupted: true };
    }
    return { segments: parsed, corrupted: false };
  } catch (err) {
    console.warn(`[SegmentLedger] Corrupted segment ledger for job ${jobId}:`, err.message);
    return { segments: {}, corrupted: true };
  }
}

/**
 * Records or updates a successfully generated TTS segment record in the durable ledger.
 * Written atomically to disk to prevent half-written records.
 */
function recordSegmentCompletion({
  jobId,
  seriesId,
  episodeId,
  segmentId,
  segmentIndex,
  text,
  voiceId,
  targetDurationSec = 0,
  audioPath,
  fileSize = 0,
  durationSec = 0,
  status = 'completed',
  baseUploadsDir = null,
}) {
  const cleanSeries = sanitizeIdentifier(seriesId, 'series_default');
  const cleanEpisode = sanitizeIdentifier(episodeId, 'ep_1');
  const cleanJob = sanitizeIdentifier(jobId, 'job_unknown');
  const cleanSegId = String(segmentId != null ? segmentId : segmentIndex);

  const { segments, corrupted } = loadSegmentLedger(cleanJob, cleanSeries, cleanEpisode, baseUploadsDir);
  const ledger = corrupted ? {} : { ...segments };

  const fingerprint = generateSegmentFingerprint({ text, voiceId, targetDurationSec });

  const record = {
    segmentId: cleanSegId,
    segmentIndex: Number.isInteger(segmentIndex) ? segmentIndex : 0,
    jobId: cleanJob,
    seriesId: cleanSeries,
    episodeId: cleanEpisode,
    fingerprint,
    text: String(text || '').trim(),
    voiceId: String(voiceId || '').trim(),
    targetDurationSec: parseFloat((targetDurationSec || 0).toFixed(2)),
    audioPath: audioPath ? path.resolve(audioPath) : null,
    fileSize: Number.isFinite(fileSize) ? fileSize : (audioPath && fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0),
    durationSec: parseFloat((durationSec || 0).toFixed(3)),
    status, // 'completed' | 'corrupted' | 'failed'
    timestamp: Date.now(),
    validated: true,
  };

  ledger[cleanSegId] = record;

  const filePath = getSegmentLedgerFilePath(cleanSeries, cleanEpisode, cleanJob, baseUploadsDir);
  atomicWriteJson(filePath, ledger);

  return record;
}

/**
 * Validates whether an existing segment's audio file on disk is valid, decodable,
 * and matches the requested text, voice, and episode ownership.
 */
async function verifySegmentAudioIntegrity({
  record,
  expectedText = null,
  expectedVoiceId = null,
  expectedTargetDurationSec = 0,
  jobId = null,
  seriesId = null,
  episodeId = null,
  baseUploadsDir = null,
  durationValidatorFn = null,
}) {
  if (!record || typeof record !== 'object') {
    return { valid: false, reason: 'RECORD_MISSING' };
  }

  // 1. Episode and Job ownership validation
  if (jobId && record.jobId !== jobId) {
    return { valid: false, reason: 'JOB_MISMATCH' };
  }
  if (seriesId && record.seriesId !== seriesId) {
    return { valid: false, reason: 'SERIES_MISMATCH' };
  }
  if (episodeId && record.episodeId !== episodeId) {
    return { valid: false, reason: 'EPISODE_MISMATCH' };
  }

  // 2. File existence check
  const audioPath = record.audioPath;
  if (!audioPath || !fs.existsSync(audioPath)) {
    return { valid: false, reason: 'FILE_NOT_FOUND' };
  }

  // 3. Path containment security check (must not escape project upload structure)
  if (baseUploadsDir) {
    const resolvedBase = path.resolve(baseUploadsDir);
    const resolvedAudio = path.resolve(audioPath);
    if (!resolvedAudio.startsWith(resolvedBase)) {
      return { valid: false, reason: 'PATH_TRAVERSAL_DETECTED' };
    }
  }

  // 4. File size check (audio files must be at least 250 bytes to be valid MP3/WAV)
  const stat = fs.statSync(audioPath);
  if (stat.size < 250) {
    return { valid: false, reason: 'FILE_TOO_SMALL_OR_EMPTY', size: stat.size };
  }

  // 5. Content fingerprint match
  if (expectedText != null || expectedVoiceId != null) {
    const currentFingerprint = generateSegmentFingerprint({
      text: expectedText != null ? expectedText : record.text,
      voiceId: expectedVoiceId != null ? expectedVoiceId : record.voiceId,
      targetDurationSec: expectedTargetDurationSec || record.targetDurationSec || 0,
    });

    if (record.fingerprint && record.fingerprint !== currentFingerprint) {
      return { valid: false, reason: 'FINGERPRINT_MISMATCH' };
    }
  }

  // 6. Decodability & duration validation
  if (typeof durationValidatorFn === 'function') {
    try {
      const duration = await durationValidatorFn(audioPath);
      if (!duration || duration < 0.1) {
        return { valid: false, reason: 'AUDIO_INDECODABLE_OR_ZERO_DURATION' };
      }
      return { valid: true, durationSec: duration, size: stat.size, audioPath };
    } catch (err) {
      return { valid: false, reason: 'DECODE_ERROR', error: err.message };
    }
  }

  return { valid: true, durationSec: record.durationSec, size: stat.size, audioPath };
}

module.exports = {
  generateSegmentFingerprint,
  getSegmentLedgerFilePath,
  loadSegmentLedger,
  recordSegmentCompletion,
  verifySegmentAudioIntegrity,
};
