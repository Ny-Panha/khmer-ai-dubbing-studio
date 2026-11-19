/**
 * DragonDub AI - Local Chinese OCR Service
 * High-performance, offline Chinese subtitle text recognition using RapidOCR (ONNXRuntime).
 * Replaces unnecessary Gemini Vision API calls while maintaining 100% subtitle accuracy.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { resolvePythonBinary } = require('../audioSeparationService');
const { registerProcess, unregisterProcess, terminateChildProcess } = require('../../utils/processRegistry');
const { createAbortError } = require('../../utils/asyncSemaphore');

let cachedAvailability = null;
let lastAvailabilityCheckTime = 0;
const AVAILABILITY_TTL_MS = 60000; // 1 minute cache

/**
 * Check if local Chinese OCR (RapidOCR) is installed and available in the Python runtime.
 * Caches result for 60 seconds to avoid repeating process spawns on every frame.
 * 
 * @param {boolean} [force=false]
 * @returns {Promise<{ available: boolean, engine: string, status?: string, error?: string }>}
 */
function checkLocalChineseOcrStatus(force = false) {
  const now = Date.now();
  if (!force && cachedAvailability !== null && (now - lastAvailabilityCheckTime < AVAILABILITY_TTL_MS)) {
    return Promise.resolve(cachedAvailability);
  }

  return new Promise((resolve) => {
    try {
      const pythonBin = resolvePythonBinary();
      const workerPath = path.resolve(__dirname, '../../workers/local_chinese_ocr_worker.py');

      if (!fs.existsSync(workerPath)) {
        cachedAvailability = { available: false, engine: 'none', error: `Worker not found at ${workerPath}` };
        lastAvailabilityCheckTime = now;
        return resolve(cachedAvailability);
      }

      execFile(pythonBin, [workerPath, '--check'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
        if (err) {
          cachedAvailability = { available: false, engine: 'none', error: err.message };
          lastAvailabilityCheckTime = now;
          return resolve(cachedAvailability);
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed && parsed.available) {
            cachedAvailability = { available: true, engine: parsed.engine || 'rapidocr-onnxruntime', status: 'ready' };
          } else {
            cachedAvailability = { available: false, engine: 'none', error: parsed?.error || 'Unavailable' };
          }
        } catch (parseErr) {
          cachedAvailability = { available: false, engine: 'none', error: parseErr.message };
        }
        lastAvailabilityCheckTime = now;
        resolve(cachedAvailability);
      });
    } catch (e) {
      cachedAvailability = { available: false, engine: 'none', error: e.message };
      lastAvailabilityCheckTime = now;
      resolve(cachedAvailability);
    }
  });
}

/**
 * Quick synchronous or cached check for local OCR availability.
 */
async function isLocalChineseOcrAvailable() {
  const status = await checkLocalChineseOcrStatus();
  return Boolean(status.available);
}

/**
 * Run local Chinese OCR on an array of candidate frame files.
 * Supports cancellation via AbortSignal, bounded batch execution, and live progress reporting.
 * 
 * @param {object} params
 * @param {Array<{ filePath: string, timestampSec: number, id?: string }>} params.frames
 * @param {object} [params.options={}]
 * @param {number} [params.options.roiYMin=0.72]
 * @param {number} [params.options.roiYMax=0.98]
 * @param {number} [params.options.roiXMin=0.10]
 * @param {number} [params.options.roiXMax=0.90]
 * @param {number} [params.options.detLimitSideLen=360]
 * @param {number} [params.options.batchSize=60] - Bound frames per execution to prevent RAM bloat
 * @param {AbortSignal} [params.signal=null]
 * @param {function} [params.onProgress=null]
 * @returns {Promise<{ success: boolean, results: Array, totalFrames: number, wallTimeMs: number, engine: string }>}
 */
async function runLocalChineseOcr({
  frames = [],
  options = {},
  signal = null,
  onProgress = null,
}) {
  if (signal?.aborted) {
    throw createAbortError('Local Chinese OCR aborted before execution');
  }

  if (!Array.isArray(frames) || frames.length === 0) {
    return {
      success: true,
      results: [],
      totalFrames: 0,
      wallTimeMs: 0,
      engine: 'rapidocr-onnxruntime',
    };
  }

  const availability = await checkLocalChineseOcrStatus();
  if (!availability.available) {
    throw new Error(`Local Chinese OCR engine is not available: ${availability.error || 'RapidOCR not installed'}`);
  }

  const pythonBin = resolvePythonBinary();
  const workerPath = path.resolve(__dirname, '../../workers/local_chinese_ocr_worker.py');

  const roiYMin = typeof options.roiYMin === 'number' ? options.roiYMin : 0.72;
  const roiYMax = typeof options.roiYMax === 'number' ? options.roiYMax : 0.98;
  const roiXMin = typeof options.roiXMin === 'number' ? options.roiXMin : 0.10;
  const roiXMax = typeof options.roiXMax === 'number' ? options.roiXMax : 0.90;
  const detLimitSideLen = typeof options.detLimitSideLen === 'number' ? options.detLimitSideLen : 360;
  const BATCH_SIZE = Math.min(100, Math.max(10, options.batchSize || 60));

  const overallStartTime = Date.now();
  const allResults = [];
  const tempDir = path.join(os.tmpdir(), `dragondub_local_ocr_${Date.now()}_${process.pid}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    for (let i = 0; i < frames.length; i += BATCH_SIZE) {
      if (signal?.aborted) {
        throw createAbortError('Local Chinese OCR aborted');
      }

      const batchSlice = frames.slice(i, i + BATCH_SIZE);
      const batchInputFile = path.join(tempDir, `batch_input_${i}.json`);
      const batchOutputFile = path.join(tempDir, `batch_output_${i}.json`);

      fs.writeFileSync(batchInputFile, JSON.stringify({ frames: batchSlice }, null, 2), 'utf8');

      const batchArgs = [
        workerPath,
        '--input_json', batchInputFile,
        '--output_json', batchOutputFile,
        '--det_limit_side_len', String(detLimitSideLen),
        '--roi_ymin', String(roiYMin),
        '--roi_ymax', String(roiYMax),
        '--roi_xmin', String(roiXMin),
        '--roi_xmax', String(roiXMax),
      ];

      const batchResult = await new Promise((resolveBatch, rejectBatch) => {
        let settled = false;
        let stdoutAcc = '';
        let stderrAcc = '';

        const child = spawn(pythonBin, batchArgs, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const unregister = registerProcess(child, {
          type: 'local_chinese_ocr_worker',
          label: `local_ocr_batch_${i}`,
        });

        const cleanup = () => {
          unregister();
          if (signal) signal.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
          if (!settled) {
            settled = true;
            cleanup();
            terminateChildProcess(child);
            rejectBatch(createAbortError('Local Chinese OCR cancelled by user'));
          }
        };

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }

        child.stdout.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          stdoutAcc += text;
          const lines = text.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
              try {
                const parsed = JSON.parse(trimmed);
                if (parsed.type === 'progress' && typeof onProgress === 'function') {
                  const globalCompleted = i + (parsed.completed || 0);
                  onProgress({
                    completed: globalCompleted,
                    total: frames.length,
                    percent: parseFloat(((globalCompleted / frames.length) * 100).toFixed(1)),
                    elapsedSec: parseFloat(((Date.now() - overallStartTime) / 1000).toFixed(1)),
                  });
                }
              } catch (_) {}
            }
          }
        });

        child.stderr.on('data', (chunk) => {
          stderrAcc += chunk.toString('utf8');
        });

        child.on('close', (code) => {
          cleanup();
          if (settled) return;
          settled = true;

          if (signal?.aborted) {
            return rejectBatch(createAbortError('Local Chinese OCR cancelled by user'));
          }

          if (code !== 0) {
            return rejectBatch(new Error(`Local OCR worker failed with code ${code}. Stderr: ${stderrAcc.trim() || 'none'}`));
          }

          if (!fs.existsSync(batchOutputFile)) {
            return rejectBatch(new Error(`Local OCR output file was not produced at ${batchOutputFile}. Stderr: ${stderrAcc.trim() || 'none'}`));
          }

          try {
            const outContent = fs.readFileSync(batchOutputFile, 'utf8');
            const parsedOut = JSON.parse(outContent);
            resolveBatch(parsedOut);
          } catch (readErr) {
            rejectBatch(new Error(`Failed to parse local OCR output JSON: ${readErr.message}`));
          }
        });

        child.on('error', (spawnErr) => {
          cleanup();
          if (settled) return;
          settled = true;
          rejectBatch(new Error(`Failed to spawn local OCR worker (${pythonBin}): ${spawnErr.message}`));
        });
      });

      if (batchResult && Array.isArray(batchResult.results)) {
        allResults.push(...batchResult.results);
      }

      // Clean up batch temporary JSON files immediately to keep disk footprint minimal
      try { if (fs.existsSync(batchInputFile)) fs.unlinkSync(batchInputFile); } catch (_) {}
      try { if (fs.existsSync(batchOutputFile)) fs.unlinkSync(batchOutputFile); } catch (_) {}
    }
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }

  const totalWallMs = Date.now() - overallStartTime;
  return {
    success: true,
    engine: 'rapidocr-onnxruntime',
    totalFrames: frames.length,
    wallTimeMs: totalWallMs,
    results: allResults,
  };
}

module.exports = {
  checkLocalChineseOcrStatus,
  isLocalChineseOcrAvailable,
  runLocalChineseOcr,
};
