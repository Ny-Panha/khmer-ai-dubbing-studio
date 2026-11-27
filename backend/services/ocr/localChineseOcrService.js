/**
 * DragonDub AI - Local Chinese OCR Service
 * High-performance, offline Chinese subtitle text recognition using RapidOCR (ONNXRuntime).
 * Verifies confident frames locally before Gemini Vision fallback.
 * Features persistent worker lifecycle (single RapidOCR model init), bounded streaming batches,
 * subtitle ROI deduplication, cancellation, resource cleanup, and automatic legacy fallback.
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
 * Persistent Job-Scoped Worker for RapidOCR.
 * Keeps Python process and ONNXRuntime models in memory across multiple streaming batches,
 * avoiding repeated process boot and model initialization overhead (~2.5s per batch on Windows).
 */
class PersistentChineseOcrWorker {
  constructor(options = {}) {
    this.options = options;
    this.child = null;
    this.closed = null;
    this.pythonBin = resolvePythonBinary();
    this.workerPath = path.resolve(__dirname, '../../workers/local_chinese_ocr_worker.py');
    this.isReady = false;
    this.isTerminated = false;
    this.stdoutBuffer = '';
    this.workerStartupMs = 0;
    this.rapidOcrInitMs = 0;
    this.workerCpuMs = 0;
    this.currentBatchResolve = null;
    this.currentBatchReject = null;
    this.currentBatchId = null;
    this.onProgressCb = null;
    this.unregisterProcess = null;
  }

  async start(signal = null) {
    if (signal?.aborted) {
      throw createAbortError('Persistent OCR worker aborted before start');
    }

    const startTime = Date.now();
    const args = [
      this.workerPath,
      '--persistent',
      '--det_limit_side_len', String(this.options.detLimitSideLen || Number(process.env.RAPIDOCR_DET_LIMIT_SIDE_LEN) || 480),
      '--roi_ymin', String(this.options.roiYMin ?? 0.72),
      '--roi_ymax', String(this.options.roiYMax ?? 0.98),
      '--roi_xmin', String(this.options.roiXMin ?? 0.10),
      '--roi_xmax', String(this.options.roiXMax ?? 0.90),
      '--intra_op_num_threads', String(this.options.intraOpNumThreads || process.env.RAPIDOCR_INTRA_OP_THREADS || 2),
    ];

    return new Promise((resolve, reject) => {
      let settled = false;

      try {
        this.child = spawn(this.pythonBin, args, {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        return reject(new Error(`Failed to spawn persistent OCR worker: ${err.message}`));
      }

      this.unregisterProcess = registerProcess(this.child, {
        type: 'local_chinese_ocr_persistent_worker',
        label: `persistent_ocr_${this.child.pid}`,
      });
      this.closed = new Promise((done) => this.child.once('close', done));
      // A write racing with child exit can emit EPIPE on stdin before 'close'.
      this.child.stdin.on('error', (err) => this.currentBatchReject?.(err));

      const onAbort = () => {
        if (!settled) {
          settled = true;
          this.terminate();
          reject(createAbortError('Persistent OCR worker startup aborted'));
        }
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      let stderrAcc = '';

      this.child.stderr.on('data', (chunk) => {
        stderrAcc += chunk.toString('utf8');
      });

      this.child.stdout.on('data', (chunk) => {
        this.stdoutBuffer += chunk.toString('utf8');
        const lines = this.stdoutBuffer.split('\n');
        this.stdoutBuffer = lines.pop(); // Retain trailing incomplete chunk

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const msg = JSON.parse(trimmed);
              if (msg.type === 'ready') {
                if (!settled && !this.isTerminated) {
                  settled = true;
                  this.isReady = true;
                  this.rapidOcrInitMs = msg.initMs || 0;
                  this.workerCpuMs = msg.workerCpuMs || 0;
                  this.workerStartupMs = Date.now() - startTime;
                  if (signal) signal.removeEventListener('abort', onAbort);
                  resolve(this);
                }
              } else if (msg.type === 'progress') {
                if (typeof this.onProgressCb === 'function') {
                  this.onProgressCb(msg);
                }
              } else if (msg.type === 'batch_result') {
                if (this.currentBatchResolve && (!this.currentBatchId || msg.batchId === this.currentBatchId)) {
                  const resolveFn = this.currentBatchResolve;
                  this.currentBatchResolve = null;
                  this.currentBatchReject = null;
                  this.currentBatchId = null;
                  resolveFn(msg);
                }
              }
            } catch (_) {}
          }
        }
      });

      this.child.on('close', (code) => {
        this.isReady = false;
        this.isTerminated = true;
        if (this.unregisterProcess) this.unregisterProcess();
        if (signal) signal.removeEventListener('abort', onAbort);

        if (!settled) {
          settled = true;
          reject(new Error(`Persistent OCR worker exited with code ${code} before ready. Stderr: ${stderrAcc.trim() || 'none'}`));
        } else if (this.currentBatchReject) {
          const rejectFn = this.currentBatchReject;
          this.currentBatchResolve = null;
          this.currentBatchReject = null;
          this.currentBatchId = null;
          rejectFn(new Error(`Persistent OCR worker closed with code ${code}. Stderr: ${stderrAcc.trim() || 'none'}`));
        }
      });

      this.child.on('error', (err) => {
        this.isReady = false;
        this.isTerminated = true;
        if (this.unregisterProcess) this.unregisterProcess();
        if (signal) signal.removeEventListener('abort', onAbort);

        if (!settled) {
          settled = true;
          reject(new Error(`Persistent OCR worker process error: ${err.message}`));
        } else if (this.currentBatchReject) {
          const rejectFn = this.currentBatchReject;
          this.currentBatchResolve = null;
          this.currentBatchReject = null;
          this.currentBatchId = null;
          rejectFn(err);
        }
      });
    });
  }

  async processBatch(frames = [], batchId = '', signal = null, onProgress = null) {
    if (this.isTerminated || !this.child || !this.isReady) {
      throw new Error('Persistent OCR worker is not running or ready');
    }
    if (signal?.aborted) {
      throw createAbortError('Batch OCR aborted');
    }

    this.currentBatchId = batchId || `batch_${Date.now()}`;
    this.onProgressCb = onProgress;

    return new Promise((resolve, reject) => {
      let batchSettled = false;

      const onAbort = () => {
        if (!batchSettled) {
          batchSettled = true;
          this.currentBatchResolve = null;
          this.currentBatchReject = null;
          this.terminate();
          reject(createAbortError('Batch OCR cancelled by user'));
        }
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.currentBatchResolve = (result) => {
        if (batchSettled) return;
        batchSettled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(result);
      };

      this.currentBatchReject = (err) => {
        if (batchSettled) return;
        batchSettled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      };

      const payload = {
        cmd: 'process_batch',
        batchId: this.currentBatchId,
        frames,
        roiYMin: this.options.roiYMin,
        roiYMax: this.options.roiYMax,
        roiXMin: this.options.roiXMin,
        roiXMax: this.options.roiXMax,
      };

      try {
        this.child.stdin.write(JSON.stringify(payload) + '\n');
      } catch (writeErr) {
        if (!batchSettled) {
          batchSettled = true;
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(new Error(`Failed to write batch to worker stdin: ${writeErr.message}`));
        }
      }
    });
  }

  terminate() {
    if (this.isTerminated) return;
    this.isTerminated = true;
    this.isReady = false;
    if (this.child) {
      try {
        this.child.stdin.write(JSON.stringify({ cmd: 'stop' }) + '\n');
      } catch (_) {}
      const timer = setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) {
          try { terminateChildProcess(this.child); } catch (_) {}
        }
      }, 300);
      this.closed.then(() => clearTimeout(timer));
    }
  }

  async stop() {
    this.terminate();
    await this.closed;
  }
}

/**
 * Executes a batch using legacy one-shot CLI (process-per-batch) as reliable fallback.
 */
async function executeLegacyBatch({
  batchSlice,
  batchIndex,
  pythonBin,
  workerPath,
  detLimitSideLen,
  roiYMin,
  roiYMax,
  roiXMin,
  roiXMax,
  intraOpNumThreads,
  tempDir,
  signal,
  onProgress,
  overallStartTime,
  framesTotal,
}) {
  const batchInputFile = path.join(tempDir, `batch_input_${batchIndex}.json`);
  const batchOutputFile = path.join(tempDir, `batch_output_${batchIndex}.json`);

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
    '--intra_op_num_threads', String(intraOpNumThreads || process.env.RAPIDOCR_INTRA_OP_THREADS || 2),
  ];

  return new Promise((resolveBatch, rejectBatch) => {
    let settled = false;
    let stdoutAcc = '';
    let stderrAcc = '';

    const child = spawn(pythonBin, batchArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const unregister = registerProcess(child, {
      type: 'local_chinese_ocr_worker',
      label: `local_ocr_legacy_batch_${batchIndex}`,
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
              const globalCompleted = batchIndex + (parsed.completed || 0);
              onProgress({
                completed: globalCompleted,
                total: framesTotal,
                percent: parseFloat(((globalCompleted / framesTotal) * 100).toFixed(1)),
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
      if (settled) return;
      settled = true;
      cleanup();

      if (signal?.aborted) {
        return rejectBatch(createAbortError('Local Chinese OCR cancelled by user'));
      }

      if (code !== 0) {
        return rejectBatch(new Error(`Legacy OCR worker failed with code ${code}. Stderr: ${stderrAcc.trim() || 'none'}`));
      }

      if (!fs.existsSync(batchOutputFile)) {
        return rejectBatch(new Error(`Legacy OCR output file was not produced at ${batchOutputFile}. Stderr: ${stderrAcc.trim() || 'none'}`));
      }

      try {
        const outContent = fs.readFileSync(batchOutputFile, 'utf8');
        const parsedOut = JSON.parse(outContent);
        resolveBatch(parsedOut);
      } catch (readErr) {
        rejectBatch(new Error(`Failed to parse legacy OCR output JSON: ${readErr.message}`));
      }
    });

    child.on('error', (spawnErr) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectBatch(new Error(`Failed to spawn legacy OCR worker (${pythonBin}): ${spawnErr.message}`));
    });
  });
}

/**
 * Run local Chinese OCR on an array of candidate frame files.
 * Uses a persistent, job-scoped worker to initialize RapidOCR only once across all batches.
 * Features bounded streaming batches, backpressure, retry of incomplete frames,
 * subtitle ROI deduplication, cancellation via AbortSignal, and automatic fallback.
 * 
 * @param {object} params
 * @param {Array<{ filePath: string, timestampSec: number, id?: string, cueIndex?: number, isShortCue?: boolean, sceneCut?: boolean }>} params.frames
 * @param {object} [params.options={}]
 * @param {number} [params.options.roiYMin=0.72]
 * @param {number} [params.options.roiYMax=0.98]
 * @param {number} [params.options.roiXMin=0.10]
 * @param {number} [params.options.roiXMax=0.90]
 * @param {number} [params.options.detLimitSideLen=360]
 * @param {number} [params.options.batchSize=60] - Bound frames per batch to maintain low RAM & streaming progress
 * @param {AbortSignal} [params.signal=null]
 * @param {function} [params.onProgress=null]
 * @param {function} [params.onBatchComplete=null] - Synchronously save each complete batch before starting the next.
 * @returns {Promise<{ success: boolean, results: Array, totalFrames: number, actualOcrFramesCount: number, dedupedFramesCount: number, workerStartupMs: number, rapidOcrInitMs: number, wallTimeMs: number, avgMsPerFrame: number, engine: string }>}
 */
async function runLocalChineseOcr({
  frames = [],
  options = {},
  signal = null,
  onProgress = null,
  onBatchComplete = null,
}) {
  if (signal?.aborted) {
    throw createAbortError('Local Chinese OCR aborted before execution');
  }

  if (!Array.isArray(frames) || frames.length === 0) {
    return {
      success: true,
      results: [],
      totalFrames: 0,
      actualOcrFramesCount: 0,
      dedupedFramesCount: 0,
      workerStartupMs: 0,
      rapidOcrInitMs: 0,
      wallTimeMs: 0,
      avgMsPerFrame: 0,
      imageDecodeMs: 0,
      inferenceMs: 0,
      avgInferenceMs: 0,
      workerCpuMs: 0,
      workerPeakRssMb: null,
      engine: 'rapidocr-onnxruntime',
    };
  }

  const overallStartTime = Date.now();
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
  const detLimitSideLen = typeof options.detLimitSideLen === 'number'
    ? options.detLimitSideLen
    : (Number(process.env.RAPIDOCR_DET_LIMIT_SIDE_LEN) || 480);
  const BATCH_SIZE = Math.min(100, Math.max(10, options.batchSize || 60));

  const allResults = [];
  let actualOcrFramesCount = 0;
  let dedupedFramesCount = 0;
  let workerStartupMs = 0;
  let rapidOcrInitMs = 0;
  let imageDecodeMs = 0;
  let inferenceMs = 0;
  let workerCpuMs = 0;
  let workerPeakRssMb = null;
  let processedCount = 0;

  function collectBatch(batch, expectedCount) {
    if (!batch?.success || batch.results?.length !== expectedCount) throw new Error('Incomplete OCR worker batch');
    allResults.push(...batch.results);
    actualOcrFramesCount += batch.actualOcrFrames;
    dedupedFramesCount += batch.dedupedFrames;
    imageDecodeMs += batch.imageDecodeMs;
    inferenceMs += batch.inferenceMs;
    workerCpuMs += batch.workerCpuMs;
    if (batch.workerPeakRssMb != null) workerPeakRssMb = Math.max(workerPeakRssMb ?? 0, batch.workerPeakRssMb);
    processedCount += expectedCount;
  }

  // 1. Attempt Persistent Worker (One-time RapidOCR model initialization)
  let persistentWorker = null;
  let persistentWorkerFailed = false;

  try {
    persistentWorker = new PersistentChineseOcrWorker({
      detLimitSideLen,
      roiYMin,
      roiYMax,
      roiXMin,
      roiXMax,
    });
    await persistentWorker.start(signal);
    workerStartupMs = persistentWorker.workerStartupMs;
    rapidOcrInitMs = persistentWorker.rapidOcrInitMs;
    workerCpuMs = persistentWorker.workerCpuMs;
  } catch (workerStartErr) {
    await persistentWorker?.stop();
    persistentWorker = null;
    if (signal?.aborted || workerStartErr?.name === 'AbortError') {
      throw workerStartErr?.name === 'AbortError' ? workerStartErr : createAbortError('Local Chinese OCR aborted');
    }
    console.warn(`[Local OCR] Persistent worker failed to start (${workerStartErr.message}). Falling back to legacy CLI mode.`);
    persistentWorkerFailed = true;
  }

  try {
    if (!persistentWorkerFailed && persistentWorker && persistentWorker.isReady) {
      // Stream bounded batches through persistent worker
      for (let i = 0; i < frames.length; i += BATCH_SIZE) {
        if (signal?.aborted) {
          throw createAbortError('Local Chinese OCR aborted');
        }

        const batchSlice = frames.slice(i, i + BATCH_SIZE);
        const batchId = `stream_batch_${i}_${Date.now()}`;

        let batchRes;
        try {
          batchRes = await persistentWorker.processBatch(
            batchSlice,
            batchId,
            signal,
            (p) => {
              if (typeof onProgress === 'function') {
                const globalCompleted = i + (p.completed || 0);
                onProgress({
                  completed: globalCompleted,
                  total: frames.length,
                  percent: parseFloat(((globalCompleted / frames.length) * 100).toFixed(1)),
                  elapsedSec: parseFloat(((Date.now() - overallStartTime) / 1000).toFixed(1)),
                });
              }
            }
          );

          collectBatch(batchRes, batchSlice.length);
        } catch (batchErr) {
          if (signal?.aborted || batchErr?.name === 'AbortError') {
            throw batchErr?.name === 'AbortError' ? batchErr : createAbortError('Local Chinese OCR aborted');
          }
          console.warn(`[Local OCR] Persistent batch execution failed at index ${i} (${batchErr.message}). Switching remaining frames to legacy CLI.`);
          persistentWorkerFailed = true;
          await persistentWorker.stop();
          persistentWorker = null;
          break; // Break loop to handle remaining frames in legacy fallback
        }
        onBatchComplete?.(batchRes.results);
      }
    }

    // 2. Fallback to Legacy CLI Mode if persistent worker failed or terminated midway
    if (processedCount < frames.length) {
      if (signal?.aborted) {
        throw createAbortError('Local Chinese OCR aborted');
      }

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_local_ocr_fallback_'));

      try {
        for (let i = processedCount; i < frames.length; i += BATCH_SIZE) {
          if (signal?.aborted) {
            throw createAbortError('Local Chinese OCR aborted');
          }

          const batchSlice = frames.slice(i, i + BATCH_SIZE);
          const batchResult = await executeLegacyBatch({
            batchSlice,
            batchIndex: i,
            pythonBin,
            workerPath,
            detLimitSideLen,
            roiYMin,
            roiYMax,
            roiXMin,
            roiXMax,
            intraOpNumThreads: options.intraOpNumThreads,
            tempDir,
            signal,
            onProgress,
            overallStartTime,
            framesTotal: frames.length,
          });

          collectBatch(batchResult, batchSlice.length);
          rapidOcrInitMs += batchResult.initMs;
          onBatchComplete?.(batchResult.results);
        }
      } finally {
        try {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (_) {}
      }
    }
  } finally {
    if (persistentWorker) {
      try { await persistentWorker.stop(); } catch (_) {}
      persistentWorker = null;
    }
  }

  const totalWallMs = Date.now() - overallStartTime;
  const avgMsPerFrame = parseFloat((totalWallMs / Math.max(1, frames.length)).toFixed(1));

  return {
    success: true,
    engine: 'rapidocr-onnxruntime',
    totalFrames: frames.length,
    actualOcrFramesCount,
    imageDecodeMs,
    inferenceMs,
    avgInferenceMs: actualOcrFramesCount ? inferenceMs / actualOcrFramesCount : 0,
    workerCpuMs,
    workerPeakRssMb,
    dedupedFramesCount,
    workerStartupMs,
    rapidOcrInitMs,
    wallTimeMs: totalWallMs,
    avgMsPerFrame,
    results: allResults,
  };
}

module.exports = {
  checkLocalChineseOcrStatus,
  isLocalChineseOcrAvailable,
  PersistentChineseOcrWorker,
  runLocalChineseOcr,
};
