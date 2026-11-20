const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const FFMPEG_PATH = ffmpegInstaller.path;
const { getSafeCliPath } = require("./ffmpegService");

/**
 * Acoustic Voice Pitch & Gender Classifier
 * Uses YIN fundamental frequency (F0) estimation on audio extracted from media files.
 * 
 * Human Voice Acoustic Standards:
 * - Adult Male F0: ~85 Hz to 155 Hz (typical mean ~120 Hz)
 * - Adult Female F0: ~170 Hz to 280 Hz (typical mean ~215 Hz)
 * - Ambiguous / Overlap: 155 Hz to 170 Hz
 */

/**
 * Standard YIN Pitch Detection Algorithm
 * @param {Int16Array} pcmData - Mono 16-bit PCM audio samples at sampleRate
 * @param {number} sampleRate - e.g. 16000 Hz
 * @param {number} threshold - Dip threshold for difference function (default 0.15)
 * @returns {{ f0: number, confidence: number, gender: 'male'|'female'|'unknown', voicedFrames: number }}
 */
function computeYinPitch(pcmData, sampleRate = 16000, threshold = 0.15) {
  if (!pcmData || pcmData.length < 1024) {
    return { f0: 0, confidence: 0, gender: "unknown", voicedFrames: 0 };
  }

  const minFreq = 80;   // 80 Hz
  const maxFreq = 340;  // 340 Hz
  const minLag = Math.floor(sampleRate / maxFreq); // ~47 samples at 16kHz
  const maxLag = Math.floor(sampleRate / minFreq); // ~200 samples at 16kHz

  const windowSize = 1024; // 64ms window
  const hopSize = 512;     // 32ms hop
  const numFrames = Math.floor((pcmData.length - windowSize - maxLag) / hopSize);

  if (numFrames <= 0) {
    return { f0: 0, confidence: 0, gender: "unknown", voicedFrames: 0 };
  }

  const pitchEstimates = [];

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;

    // Check frame energy (skip silence and pauses)
    let frameEnergy = 0;
    for (let i = 0; i < windowSize; i++) {
      const s = pcmData[offset + i] / 32768.0;
      frameEnergy += s * s;
    }
    const rms = Math.sqrt(frameEnergy / windowSize);
    if (rms < 0.02) continue; // Skip quiet / silence frames

    // Step 1: Difference function d(tau)
    const d = new Float32Array(maxLag + 1);
    for (let tau = 0; tau <= maxLag; tau++) {
      let sum = 0;
      for (let i = 0; i < windowSize; i++) {
        const delta = (pcmData[offset + i] - pcmData[offset + i + tau]) / 32768.0;
        sum += delta * delta;
      }
      d[tau] = sum;
    }

    // Step 2: Cumulative mean normalized difference d'(tau)
    const dPrime = new Float32Array(maxLag + 1);
    dPrime[0] = 1.0;
    let runningSum = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      runningSum += d[tau];
      dPrime[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1.0;
    }

    // Step 3: Absolute threshold
    let bestTau = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (dPrime[tau] < threshold) {
        while (tau + 1 <= maxLag && dPrime[tau + 1] < dPrime[tau]) {
          tau++;
        }
        bestTau = tau;
        break;
      }
    }

    // If no tau is under threshold, find global minimum
    if (bestTau === -1) {
      let minVal = 999;
      for (let tau = minLag; tau <= maxLag; tau++) {
        if (dPrime[tau] < minVal) {
          minVal = dPrime[tau];
          bestTau = tau;
        }
      }
      if (minVal > 0.40) bestTau = -1; // Unvoiced frame
    }

    if (bestTau > 0) {
      // Step 4: Parabolic interpolation
      const s0 = dPrime[bestTau];
      const sMinus = bestTau > 0 ? dPrime[bestTau - 1] : s0;
      const sPlus = bestTau < maxLag ? dPrime[bestTau + 1] : s0;
      let betterTau = bestTau;
      const denom = 2 * (2 * s0 - sMinus - sPlus);
      if (Math.abs(denom) > 1e-5) {
        betterTau = bestTau + (sMinus - sPlus) / denom;
      }

      const f0 = sampleRate / betterTau;
      const confidence = Math.max(0, 1 - dPrime[bestTau]);
      if (f0 >= 75 && f0 <= 350) {
        pitchEstimates.push({ f0, confidence });
      }
    }
  }

  if (pitchEstimates.length === 0) {
    return { f0: 0, confidence: 0, gender: "unknown", voicedFrames: 0, voicedDurationSec: 0 };
  }

  // Calculate median F0 and average confidence
  pitchEstimates.sort((a, b) => a.f0 - b.f0);
  const mid = Math.floor(pitchEstimates.length / 2);
  const medianF0 = Math.round(pitchEstimates[mid].f0);
  const avgConf = parseFloat(
    (
      pitchEstimates.reduce((acc, p) => acc + p.confidence, 0) /
      pitchEstimates.length
    ).toFixed(2)
  );

  const voicedFrames = pitchEstimates.length;
  const voicedDurationSec = parseFloat(((voicedFrames * hopSize) / sampleRate).toFixed(2));
  const voicedRatio = numFrames > 0 ? voicedFrames / numFrames : 0;

  // Calibrated Acoustic Voice Presentation decisions:
  // Require at least 5 voiced frames (~160ms) and minimum harmonic confidence
  let gender = "unknown";
  if (voicedFrames >= 5 && avgConf >= 0.58 && voicedRatio >= 0.08) {
    if (medianF0 >= 175 && medianF0 <= 320) {
      gender = "female";
    } else if (medianF0 <= 152 && medianF0 >= 80) {
      gender = "male";
    } else {
      // Ambiguous boundary zone (152 Hz - 175 Hz) or extreme outlier frequency
      gender = "unknown";
    }
  }

  return {
    f0: medianF0,
    confidence: avgConf,
    gender,
    voicedFrames,
    voicedDurationSec,
  };
}

/**
 * Aggregates acoustic pitch and voice presentation evidence across multiple segments
 * for the SAME verified speaker, preventing single-segment shouting or whispering outliers
 * from flipping speaker voice assignments.
 * 
 * @param {Array<object>} segments - Segments belonging to one verified speaker
 * @returns {{ f0: number, confidence: number, gender: 'male'|'female'|'unknown', totalVoicedFrames: number, observationCount: number }}
 */
function aggregateSpeakerAcoustics(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { f0: 0, confidence: 0, gender: "unknown", totalVoicedFrames: 0, observationCount: 0 };
  }

  const validAcousticSegs = segments.filter((s) => {
    const f0 = Number(s.pitchHz || s.acousticF0 || 0);
    const conf = Number(s.acousticConfidence || s.genderConfidence || 0);
    return f0 >= 75 && f0 <= 340 && conf >= 0.50;
  });

  if (validAcousticSegs.length === 0) {
    return { f0: 0, confidence: 0, gender: "unknown", totalVoicedFrames: 0, observationCount: 0 };
  }

  let totalWeight = 0;
  let weightedF0Sum = 0;
  let weightedConfSum = 0;
  let totalVoicedFrames = 0;

  for (const seg of validAcousticSegs) {
    const f0 = Number(seg.pitchHz || seg.acousticF0);
    const conf = Number(seg.acousticConfidence || seg.genderConfidence || 0.6);
    const vf = Number(seg.voicedFrames || 5);
    const weight = conf * Math.max(1, Math.min(10, vf / 5));

    weightedF0Sum += f0 * weight;
    weightedConfSum += conf * weight;
    totalWeight += weight;
    totalVoicedFrames += vf;
  }

  const aggF0 = Math.round(weightedF0Sum / totalWeight);
  const aggConf = parseFloat((weightedConfSum / totalWeight).toFixed(2));

  let aggGender = "unknown";
  if (totalVoicedFrames >= 5 && aggConf >= 0.58) {
    if (aggF0 >= 175 && aggF0 <= 320) {
      aggGender = "female";
    } else if (aggF0 <= 152 && aggF0 >= 80) {
      aggGender = "male";
    }
  }

  return {
    f0: aggF0,
    confidence: aggConf,
    gender: aggGender,
    totalVoicedFrames,
    observationCount: validAcousticSegs.length,
  };
}

/**
 * Extract audio slice from a video or audio file and estimate voice pitch / gender
 * @param {string} mediaFilePath - Path to source video or audio
 * @param {number} startSec - Segment start in seconds
 * @param {number} durationSec - Segment duration in seconds
 * @returns {Promise<{ gender: 'male'|'female'|'unknown', f0: number, confidence: number }>}
 */
function classifySegmentAcousticGender(mediaFilePathOrPcm, startSecOrSampleRate = 0, durationSec = 2.5) {
  if (mediaFilePathOrPcm instanceof Int16Array || (typeof mediaFilePathOrPcm === "object" && mediaFilePathOrPcm?.buffer)) {
    const sampleRate = typeof startSecOrSampleRate === "number" && startSecOrSampleRate > 1000 ? startSecOrSampleRate : 16000;
    return computeYinPitch(mediaFilePathOrPcm, sampleRate);
  }

  const mediaFilePath = mediaFilePathOrPcm;
  const startSec = startSecOrSampleRate;

  return new Promise((resolve) => {
    if (!mediaFilePath || typeof mediaFilePath !== "string" || !fs.existsSync(mediaFilePath)) {
      return resolve({ gender: "unknown", f0: 0, confidence: 0 });
    }

    const safeMedia = getSafeCliPath(mediaFilePath);
    const tempDir = path.dirname(mediaFilePath);
    const tempWav = path.join(
      tempDir,
      `temp_pitch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.wav`
    );

    const safeStart = Math.max(0, Number(startSec) || 0);
    const safeDur = Math.max(0.4, Math.min(8.0, Number(durationSec) || 2.5));

    const args = [
      "-y",
      "-ss", safeStart.toFixed(3),
      "-t", safeDur.toFixed(3),
      "-i", safeMedia,
      "-vn",
      "-af", "highpass=f=75,lowpass=f=380",
      "-ar", "16000",
      "-ac", "1",
      getSafeCliPath(tempWav),
    ];

    const proc = spawnSync(FFMPEG_PATH, args, { windowsHide: true });
    if (proc.status !== 0 || !fs.existsSync(tempWav)) {
      if (fs.existsSync(tempWav)) {
        try { fs.unlinkSync(tempWav); } catch (_) {}
      }
      return resolve({ gender: "unknown", f0: 0, confidence: 0 });
    }

    try {
      const buf = fs.readFileSync(tempWav);
      const pcm = new Int16Array(
        buf.buffer,
        buf.byteOffset + 44,
        (buf.byteLength - 44) / 2
      );
      const result = computeYinPitch(pcm, 16000);
      resolve({
        gender: result.gender,
        f0: result.f0,
        confidence: result.confidence,
        voicedFrames: result.voicedFrames,
      });
    } catch (_) {
      resolve({ gender: "unknown", f0: 0, confidence: 0 });
    } finally {
      if (fs.existsSync(tempWav)) {
        try { fs.unlinkSync(tempWav); } catch (_) {}
      }
    }
  });
}

module.exports = {
  computeYinPitch,
  classifySegmentAcousticGender,
  aggregateSpeakerAcoustics,
};
