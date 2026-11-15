/**
/**
 * DragonDub AI - PP-OCRv5 Mobile Local OCR Service
 * Node.js wrapper service mirroring SenseVoice and Demucs workers.
 * Spawns backend/workers/ppocr_worker.py to run local OCR on candidate video frames.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { resolvePythonBinary } = require('./audioSeparationService');
const { registerProcess, terminateChildProcess } = require('../utils/processRegistry');
const { createAbortError } = require('../utils/asyncSemaphore');

/**
 * Executes local PP-OCRv5 mobile OCR on a list of candidate video frames.
 *
 * @param {object} params
 * @param {Array<{ timestampSec: number, filePath: string }>} params.frames - Candidate frames to process
 * @param {AbortSignal} [params.signal=null] - Abort signal for graceful cancellation
 * @param {number} [params.timeoutMs=300000] - Timeout in milliseconds (default 5 mins)
 * @param {number} [params.threads=8] - CPU threads for inference
 * @param {number} [params.limitSideLen=960] - Detection resolution limit
 * @param {string} [params.workerScriptOverride=''] - Path override for testing worker failures
 * @returns {Promise<{ frames: Array, totalFrames: number, engine: string, model: string, wallTimeMs: number }>}
 */
function extractSubtitlesPPOCR({
  frames = [],
  signal = null,
  timeoutMs = 300000,
  threads = 8,
  limitSideLen = 960,
  workerScriptOverride = '',
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(createAbortError('PP-OCR local extraction aborted before start'));
    }

    if (!Array.isArray(frames) || frames.length === 0) {
      return resolve({
        frames: [],
        totalFrames: 0,
        engine: 'ppocr-local',
        model: 'PP-OCRv5_mobile',
        wallTimeMs: 0,
      });
    }

    const defaultWorker = path.resolve(__dirname, '../workers/ppocr_worker.py');
    const workerPath = workerScriptOverride || defaultWorker;

    if (!fs.existsSync(workerPath)) {
      return reject(new Error(`PP-OCR worker script not found at ${workerPath}`));
    }

    const tempJsonPath = path.join(
      os.tmpdir(),
      `ppocr_input_${Date.now()}_${process.pid}_${Math.random().toString(36).substring(2, 8)}.json`
    );

    try {
      fs.writeFileSync(tempJsonPath, JSON.stringify(frames), 'utf8');
    } catch (writeErr) {
      return reject(new Error(`Failed to write PP-OCR input JSON: ${writeErr.message}`));
    }

    const pythonBin = resolvePythonBinary();
    const args = [
      workerPath,
      '--input_json', tempJsonPath,
      '--threads', String(threads || 8),
      '--limit_side_len', String(limitSideLen || 960),
    ];

    const startTime = Date.now();
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const child = spawn(pythonBin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const unregister = registerProcess(child, {
      type: 'ppocr_worker',
      label: `ppocr_${frames.length}_frames`,
    });

    // Ensure timeout scales appropriately with frame count (minimum 6s per candidate frame)
    const effectiveTimeoutMs = Math.max(Number(timeoutMs) || 300000, frames.length * 6000);
    let timeoutTimer = null;
    if (effectiveTimeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          terminateChildProcess(child);
          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
          const err = new Error(
            `PP-OCR worker timed out after ${elapsedSec}s. Stderr: ${stderrBuffer.trim() || 'none'}`
          );
          err.code = 'ETIMEDOUT';
          reject(err);
        }
      }, effectiveTimeoutMs);
    }

    const onAbort = () => {
      if (!settled) {
        settled = true;
        cleanup();
        terminateChildProcess(child);
        reject(createAbortError('PP-OCR local extraction aborted by user'));
      }
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    function cleanup() {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (signal) {
        try { signal.removeEventListener('abort', onAbort); } catch (_) {}
      }
      try {
        if (fs.existsSync(tempJsonPath)) {
          fs.unlinkSync(tempJsonPath);
        }
      } catch (_) {}
      unregister();
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrBuffer += text;
      const trimmed = text.trim();
      if (trimmed.startsWith('[PP-OCR Worker]')) {
        console.log(trimmed);
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Failed to spawn PP-OCR worker (${pythonBin}): ${err.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();

      const wallTimeMs = Date.now() - startTime;

      if (code !== 0) {
        const fullErr = stderrBuffer.trim() || stdoutBuffer.trim() || `Exit code ${code}`;
        return reject(new Error(`PP-OCR worker exited with code ${code}: ${fullErr}`));
      }

      try {
        const jsonStart = stdoutBuffer.indexOf('{');
        const jsonEnd = stdoutBuffer.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error('No JSON object delimiters found in worker output');
        }
        const jsonStr = stdoutBuffer.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        if (parsed.status === 'success') {
          resolve({
            frames: Array.isArray(parsed.frames) ? parsed.frames : [],
            totalFrames: parsed.totalFrames || (parsed.frames ? parsed.frames.length : 0),
            engine: parsed.engine || 'ppocr-local',
            model: parsed.model || 'PP-OCRv5_mobile',
            wallTimeMs,
          });
        } else {
          const errMsg = parsed.message || 'Worker reported error status';
          reject(new Error(`PP-OCR worker failed: ${errMsg}. Stderr: ${stderrBuffer.trim()}`));
        }
      } catch (parseErr) {
        reject(
          new Error(
            `Failed to parse PP-OCR JSON output (${parseErr.message}). Stderr: ${stderrBuffer.trim() || 'none'}. Raw stdout: ${stdoutBuffer.slice(0, 300)}`
          )
        );
      }
    });
  });
}

module.exports = {
  extractSubtitlesPPOCR,
};
