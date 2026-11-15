/**
 * DragonDub AI - SenseVoice Local ASR Service
 * Node.js wrapper service mirroring Demucs audio separation worker.
 * Spawns backend/workers/sensevoice_worker.py to transcribe Chinese audio locally.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolvePythonBinary } = require('./audioSeparationService');
const { registerProcess, unregisterProcess, terminateChildProcess } = require('../utils/processRegistry');
const { createAbortError } = require('../utils/asyncSemaphore');

/**
 * Transcribes an audio file locally using SenseVoice-Small worker.
 * 
 * @param {object} params
 * @param {string} params.audioPath - Path to input audio or video file
 * @param {number} [params.startOffsetSec=0] - Timeline start offset in seconds
 * @param {AbortSignal} [params.signal=null] - Abort signal for graceful cancellation
 * @param {number} [params.timeoutMs=300000] - Sensible timeout for full episode (default 5 mins)
 * @param {string} [params.modelDir=''] - Optional model directory override
 * @returns {Promise<{ speechSegments: Array, totalSegments: number, engine: string, wallTimeMs: number }>}
 */
function transcribeSenseVoice({
  audioPath,
  startOffsetSec = 0,
  signal = null,
  timeoutMs = 300000,
  modelDir = '',
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(createAbortError('SenseVoice transcription aborted before start'));
    }

    if (!audioPath || !fs.existsSync(audioPath)) {
      return reject(new Error(`Input audio file not found: ${audioPath}`));
    }

    const workerPath = path.resolve(__dirname, '../workers/sensevoice_worker.py');
    if (!fs.existsSync(workerPath)) {
      return reject(new Error(`SenseVoice worker script not found at ${workerPath}`));
    }

    const pythonBin = resolvePythonBinary();
    const args = [
      workerPath,
      '--audio', audioPath,
      '--start_offset', String(startOffsetSec || 0),
    ];

    if (modelDir && fs.existsSync(modelDir)) {
      args.push('--model_dir', modelDir);
    }

    const startTime = Date.now();
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const child = spawn(pythonBin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const unregister = registerProcess(child, {
      type: 'sensevoice_worker',
      label: `sensevoice_${path.basename(audioPath)}`,
    });

    // Timeout protection
    let timeoutTimer = null;
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          terminateChildProcess(child);
          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
          const err = new Error(
            `SenseVoice worker timed out after ${elapsedSec}s. Stderr: ${stderrBuffer.trim() || 'none'}`
          );
          err.code = 'ETIMEDOUT';
          reject(err);
        }
      }, timeoutMs);
    }

    const onAbort = () => {
      if (!settled) {
        settled = true;
        cleanup();
        terminateChildProcess(child);
        reject(createAbortError('SenseVoice transcription aborted by user'));
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
      unregister();
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrBuffer += text;
      // Forward worker progress/notices to server logs
      const trimmed = text.trim();
      if (trimmed.startsWith('[SenseVoice Worker]')) {
        console.log(trimmed);
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Failed to spawn SenseVoice worker (${pythonBin}): ${err.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();

      const wallTimeMs = Date.now() - startTime;

      if (code !== 0) {
        const fullErr = stderrBuffer.trim() || stdoutBuffer.trim() || `Exit code ${code}`;
        return reject(new Error(`SenseVoice worker exited with code ${code}: ${fullErr}`));
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
            speechSegments: Array.isArray(parsed.speechSegments) ? parsed.speechSegments : [],
            totalSegments: parsed.totalSegments || (parsed.speechSegments ? parsed.speechSegments.length : 0),
            engine: parsed.engine || 'sensevoice-local',
            wallTimeMs,
          });
        } else {
          const errMsg = parsed.message || 'Worker reported error status';
          reject(new Error(`SenseVoice worker failed: ${errMsg}. Stderr: ${stderrBuffer.trim()}`));
        }
      } catch (parseErr) {
        reject(
          new Error(
            `Failed to parse SenseVoice JSON output (${parseErr.message}). Stderr: ${stderrBuffer.trim() || 'none'}. Raw stdout was: ${stdoutBuffer.slice(0, 300)}`
          )
        );
      }
    });
  });
}

module.exports = {
  transcribeSenseVoice,
};
