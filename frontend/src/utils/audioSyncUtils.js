import { parseTimeToSeconds } from './timestampUtils.js';

/**
 * Scan decoded Web Audio PCM channel buffers to locate the exact leading silence
 * duration (dead Edge TTS padding) while preserving an acoustic cushion so
 * initial aspirated Khmer consonants (ក ខ ច ឆ ត ថ ប ផ ស) never clip.
 *
 * @param {Array<Float32Array|Array<number>>} channels
 * @param {number} sampleRate
 * @param {Object} [options]
 * @returns {number} Seconds to skip at playback start (0 .. maxSkipSec)
 */
export function findLeadingSilenceFromChannels(channels, sampleRate, options = {}) {
  const {
    threshold = 0.0045,
    maxScanSec = 0.65,
    minSilenceSec = 0.055,
    cushionSec = 0.025,
    maxSkipSec = 0.35,
  } = options;

  if (!Array.isArray(channels) || channels.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return 0;
  }

  let scanLen = Math.floor(sampleRate * maxScanSec);
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    if (!ch || typeof ch.length !== 'number') return 0;
    if (ch.length < scanLen) scanLen = ch.length;
  }
  if (scanLen <= 0) return 0;

  let firstSoundIdx = -1;
  for (let i = 0; i < scanLen; i++) {
    for (let c = 0; c < channels.length; c++) {
      if (Math.abs(channels[c][i]) >= threshold) {
        firstSoundIdx = i;
        break;
      }
    }
    if (firstSoundIdx !== -1) break;
  }

  if (firstSoundIdx === -1) return 0;

  const onsetSec = firstSoundIdx / sampleRate;
  if (onsetSec <= minSilenceSec) return 0;

  const skip = Math.min(maxSkipSec, Math.max(0, onsetSec - cushionSec));
  return parseFloat(skip.toFixed(3));
}

/**
 * Compute playback window, source file seek offset, and end limit for a segment audio element.
 * Incorporates detected leading-silence trimming ONLY when playing from offset 0
 * (never shifts split right-slices or user-trimmed left edges) and pre-rolls playback
 * start by lookaheadSec to compensate browser <audio>.play() audio-pipeline latency.
 *
 * @param {Object} params
 * @param {Object} params.seg
 * @param {number} params.now
 * @param {number|null} [params.audioDuration]
 * @param {number} [params.detectedLeadSkipSec=0]
 * @param {number} [params.lookaheadSec=0.035]
 */
export function computeSegmentAudioSyncTarget({
  seg,
  now,
  audioDuration = null,
  detectedLeadSkipSec = 0,
  lookaheadSec = 0.035,
}) {
  const segStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
    ? seg.audioStartSec
    : (typeof seg.startSec === 'number' && !isNaN(seg.startSec)
      ? seg.startSec
      : parseTimeToSeconds(seg.audioStart ?? seg.start, 0));

  const segDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
    ? seg.finalAudioDuration
    : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
      ? seg.audioDuration
      : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
        ? seg.audioDurationSec
        : 2.5));

  const trueAudioDuration = (Number.isFinite(audioDuration) && audioDuration > 0.2)
    ? audioDuration
    : ((typeof seg.originalAudioDuration === 'number' && seg.originalAudioDuration > 0)
      ? seg.originalAudioDuration
      : ((typeof seg.rawAudioDur === 'number' && seg.rawAudioDur > 0) ? seg.rawAudioDur : segDur));

  const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
  const effectiveSegEnd = (isTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
    ? seg.audioEndSec
    : (segStart + trueAudioDuration);

  const rawOffset = (typeof seg.audioOffset === 'number' && !isNaN(seg.audioOffset)) ? seg.audioOffset : 0;
  // Compare offset against real media file duration when loaded; when unloaded on a trimmed split slice,
  // avoid misclassifying valid right-slice offsets (where audioOffset >= slice duration) as stale.
  const offsetGuardDur = (Number.isFinite(audioDuration) && audioDuration > 0.2)
    ? audioDuration
    : (isTrimmed && rawOffset > 0 ? (rawOffset + segDur) : segDur);
  const segAudioOffset = (offsetGuardDur > 0 && rawOffset >= offsetGuardDur) ? 0 : Math.max(0, rawOffset);

  const safeDetectedSkip = (Number.isFinite(detectedLeadSkipSec) && detectedLeadSkipSec > 0) ? detectedLeadSkipSec : 0;
  const autoLeadTrim = (segAudioOffset === 0 && !seg.userTrimmed && safeDetectedSkip > 0)
    ? safeDetectedSkip
    : 0;

  const baseStartOffset = parseFloat((segAudioOffset + autoLeadTrim).toFixed(3));
  const elapsed = Math.max(0, (Number.isFinite(now) ? now : 0) - segStart);
  const expectedOffset = parseFloat((baseStartOffset + elapsed).toFixed(3));

  let clipLen = null;
  if (isTrimmed && typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec) && seg.audioDurationSec > 0) {
    clipLen = seg.audioDurationSec;
  } else if (isTrimmed && typeof seg.audioEndSec === 'number' && typeof seg.audioStartSec === 'number' && seg.audioEndSec > seg.audioStartSec) {
    clipLen = seg.audioEndSec - seg.audioStartSec;
  }

  const segAudioEndLimit = clipLen !== null
    ? parseFloat((baseStartOffset + clipLen).toFixed(3))
    : null;

  const safeLookahead = Number.isFinite(lookaheadSec) && lookaheadSec >= 0 ? lookaheadSec : 0.035;
  const safeNow = Number.isFinite(now) ? now : 0;
  const inRange = safeNow >= (segStart - safeLookahead) && safeNow < effectiveSegEnd;

  return {
    segStart,
    segDur,
    trueAudioDuration,
    isTrimmed,
    effectiveSegEnd,
    segAudioOffset,
    autoLeadTrim,
    baseStartOffset,
    expectedOffset,
    segAudioEndLimit,
    inRange,
  };
}
