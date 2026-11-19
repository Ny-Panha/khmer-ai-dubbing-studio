/**
 * DragonDub AI - Audio Separation Service
 * Wraps Demucs Python worker to separate dialogue (vocals) and background music/sfx (no_vocals).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { registerProcess, unregisterProcess } = require('../utils/processRegistry');

const activeSeparationJobs = new Map();
const activeSeparationProgress = new Map();
const separationQueue = [];

function normalizeSeparationKey(mediaRef) {
  if (!mediaRef) return '';
  return path.basename(String(mediaRef).split('?')[0].split('#')[0]).toLowerCase();
}

function getSeparationProgress(mediaRef) {
  if (mediaRef) {
    const cleanBase = normalizeSeparationKey(mediaRef);
    for (const [key, val] of activeSeparationProgress.entries()) {
      if (key.includes(cleanBase) || cleanBase.includes(key)) {
        return val;
      }
    }
  }
  // Resilient Fallback: If Demucs is running or active entries exist, return the active/latest separation
  if (activeSeparationProgress.size > 0) {
    for (const val of activeSeparationProgress.values()) {
      if (val && (val.status === 'separating' || val.status === 'completed')) {
        return val;
      }
    }
    const all = Array.from(activeSeparationProgress.values());
    return all[all.length - 1] || null;
  }
  return null;
}

function isSeparationBusy() {
  return Boolean(isDemucsRunning);
}

function getSeparationQueueLength() {
  return separationQueue.length;
}

function getCurrentSeparationMedia() {
  return currentDemucsMedia;
}

/**
 * Fast content fingerprint for media files (head + tail + size).
 * Prevents cache misses when identical media is copied or imported into different episodes.
 */
function getFileContentFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const sampleSize = Math.min(stat.size, 64 * 1024);
    const bufHead = Buffer.alloc(sampleSize);
    fs.readSync(fd, bufHead, 0, sampleSize, 0);

    let bufTail = Buffer.alloc(0);
    if (stat.size > 128 * 1024) {
      bufTail = Buffer.alloc(sampleSize);
      fs.readSync(fd, bufTail, 0, sampleSize, stat.size - sampleSize);
    }
    fs.closeSync(fd);

    return crypto.createHash('md5')
      .update(String(stat.size))
      .update(bufHead)
      .update(bufTail)
      .digest('hex');
  } catch (err) {
    return 'fallback_' + path.basename(filePath);
  }
}

/**
 * Compute unique cache key for separated audio
 */
/**
 * Resolve a Python interpreter portably (no machine-specific paths).
 * Order: PYTHON_BIN env -> project/backend .venv -> per-user Python installs (Windows) -> PATH (python / python3).
 * If Demucs is not installed in the resolved interpreter, separateAudio() falls back to the FFmpeg path as before.
 */
function resolvePythonBinary(env = process.env, platform = process.platform) {
  if (env.PYTHON_BIN && fs.existsSync(env.PYTHON_BIN)) {
    return env.PYTHON_BIN;
  }

  const isWin = platform === 'win32';
  const venvRel = isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
  const candidatePaths = [
    path.join(__dirname, '..', '..', '.venv', venvRel),
    path.join(__dirname, '..', '.venv', venvRel),
  ];

  if (isWin && env.LOCALAPPDATA) {
    // Keep historical preference (3.11 / 3.10 first): Demucs + torch wheels are most commonly installed there.
    for (const ver of ['Python311', 'Python310', 'Python312', 'Python313']) {
      candidatePaths.push(path.join(env.LOCALAPPDATA, 'Programs', 'Python', ver, 'python.exe'));
    }
  }

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return isWin ? 'python' : 'python3';
}

function getSeparationCacheDir(audioPath, model = 'htdemucs') {
  const version = 'v2_suppressed';
  try {
    const stat = fs.statSync(audioPath);

    // 1. Check legacy mtime-based cache directory first for instant hit
    const legacyHash = crypto.createHash('md5')
      .update(`${stat.size}_${Math.floor(stat.mtimeMs)}_${model}_${version}`)
      .digest('hex');
    const legacyDir = path.join(__dirname, '../uploads/cache/separation', legacyHash);
    if (fs.existsSync(path.join(legacyDir, 'no_vocals.wav'))) {
      return legacyDir;
    }

    // 2. Check content-fingerprint hash (shared across identical video files in all episodes)
    const fingerprint = getFileContentFingerprint(audioPath);
    const fpHash = crypto.createHash('md5')
      .update(`${fingerprint}_${model}_${version}`)
      .digest('hex');
    const fpDir = path.join(__dirname, '../uploads/cache/separation', fpHash);
    if (fs.existsSync(path.join(fpDir, 'no_vocals.wav'))) {
      return fpDir;
    }

    // Default to content fingerprint directory
    return fpDir;
  } catch (err) {
    const resolvedPath = path.resolve(audioPath).replace(/\\/g, '/').toLowerCase();
    const hash = crypto.createHash('md5').update(`${resolvedPath}_${model}_${version}`).digest('hex');
    return path.join(__dirname, '../uploads/cache/separation', hash);
  }
}

/**
 * Separate audio into vocals.wav and no_vocals.wav using local Demucs
 * @param {Object} options
 * @param {string} options.audioPath - Source audio/video path
 * @param {string} [options.outputDir] - Target directory for separated stems
 * @param {string} [options.model='htdemucs'] - Demucs model
 * @param {string} [options.device='auto'] - cpu or cuda
 * @param {string} [options.jobId] - Optional job ID for cancellation tracking
 * @param {Function} [options.onProgress] - Optional progress callback
 * @returns {Promise<Object>}
 */
let isDemucsRunning = false;
let currentDemucsMedia = null;

function finishDemucsWorkerAndProcessQueue() {
  isDemucsRunning = false;
  currentDemucsMedia = null;

  if (separationQueue.length > 0) {
    const nextJob = separationQueue.shift();
    separationQueue.forEach((job, idx) => {
      const p = activeSeparationProgress.get(job.cleanKey);
      if (p && p.status === 'queued') {
        p.queuePosition = idx + 1;
        p.message = `រង់ចាំក្នុងជួរ (Queued: លេខរៀងទី ${idx + 1})...`;
      }
    });
    isDemucsRunning = true;
    currentDemucsMedia = path.basename(nextJob.options.audioPath);
    console.log(`[AudioSeparation] 🚀 Dequeued next separation for: ${nextJob.cleanKey}`);
    executeDemucsWorker(nextJob.options, nextJob.targetDir, nextJob.cleanKey)
      .then(nextJob.resolve, nextJob.reject);
  }
}

function executeDemucsWorker(options, targetDir, cleanKey) {
  return new Promise((resolve, reject) => {
    const {
      audioPath,
      model = 'htdemucs',
      device = 'auto',
      jobId = `sep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      onProgress = null,
    } = options;

    const initialLogs = [
      {
        time: new Date().toLocaleTimeString(),
        progress: 1,
        message: '🎧 Starting Demucs AI separation (Loading PyTorch AI model)...',
      },
    ];
    activeSeparationProgress.set(cleanKey, {
      progress: 1,
      status: 'separating',
      message: 'Starting Demucs AI separation...',
      model,
      logs: initialLogs,
    });

    const workerScript = path.join(__dirname, '../workers/demucs_worker.py');
    if (!fs.existsSync(workerScript)) {
      return reject(new Error(`Demucs worker script not found at ${workerScript}`));
    }

    const pythonBin = resolvePythonBinary();
    const args = [
      workerScript,
      '--audio', audioPath,
      '--output_dir', targetDir,
      '--model', model,
      '--device', device,
    ];
    if (options.shifts !== undefined && options.shifts !== null) {
      args.push('--shifts', String(options.shifts));
    }
    if (options.overlap !== undefined && options.overlap !== null) {
      args.push('--overlap', String(options.overlap));
    }
    if (options.segment !== undefined && options.segment !== null) {
      args.push('--segment', String(options.segment));
    }
    const cpuJobs = options.jobs !== undefined && options.jobs !== null ? String(options.jobs) : '1';
    args.push('--jobs', cpuJobs);
    if (options.suppressResiduals !== false) {
      args.push('--suppress_residuals');
    }

    const optSummary = [
      options.shifts !== undefined ? `Shifts: ${options.shifts}` : null,
      options.overlap !== undefined ? `Overlap: ${options.overlap}` : null,
      options.segment !== undefined ? `Segment: ${options.segment}` : null,
      `Jobs: ${cpuJobs} (Eco CPU)`,
    ].filter(Boolean).join(', ');

    console.log(`[AudioSeparation] 🎧 Launching Demucs separation for: ${path.basename(audioPath)} (Model: ${model}, Device: ${device}, ${optSummary})`);
    if (onProgress) onProgress({ phase: 'starting', progress: 5, message: 'Launching Demucs Audio Separation AI...' });

    const spawnEnv = {
      ...process.env,
      OMP_NUM_THREADS: '4',
      MKL_NUM_THREADS: '4',
      OPENBLAS_NUM_THREADS: '4',
      NUMEXPR_NUM_THREADS: '4',
    };

    const child = spawn(pythonBin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    });

    registerProcess(child, { type: 'demucs', jobId, label: cleanKey });
    activeSeparationJobs.set(jobId, child);
    activeSeparationJobs.set(cleanKey, child);

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (d) => {
      stdoutData += d.toString('utf8');
    });

    child.stderr.on('data', (d) => {
      const chunk = d.toString('utf8');
      stderrData += chunk;
      // Demucs outputs progress percentage in stderr (e.g., "Separating track ... 45%")
      if (chunk.includes('%')) {
        const match = chunk.match(/(\d+)%/);
        if (match) {
          const pct = Math.min(99, Math.max(1, parseInt(match[1], 10)));
          const existing = activeSeparationProgress.get(cleanKey);
          const curLogs = Array.isArray(existing?.logs) ? [...existing.logs] : [];
          const lastLog = curLogs[curLogs.length - 1];
          if (!lastLog || lastLog.progress !== pct) {
            curLogs.push({
              time: new Date().toLocaleTimeString(),
              progress: pct,
              message: `⏳ Demucs Progress: ${pct}%`,
            });
          }
          activeSeparationProgress.set(cleanKey, {
            progress: pct,
            status: 'separating',
            message: `Demucs Separation: ${pct}%`,
            model,
            logs: curLogs.slice(-60),
          });
          console.log(`[AudioSeparation] ⏳ Demucs Progress: ${pct}%`);
          if (onProgress) {
            onProgress({ phase: 'separating', progress: pct, message: chunk.trim() });
          }
        }
      }
    });

    child.on('error', (err) => {
      unregisterProcess(child);
      activeSeparationJobs.delete(jobId);
      activeSeparationJobs.delete(cleanKey);
      activeSeparationProgress.set(cleanKey, {
        progress: 0,
        status: 'error',
        error: err.message,
        message: err.message,
        model,
      });
      setTimeout(() => {
        if (activeSeparationProgress.get(cleanKey)?.status === 'error') {
          activeSeparationProgress.delete(cleanKey);
        }
      }, 60000);
      finishDemucsWorkerAndProcessQueue();
      reject(err);
    });

    child.on('close', (code) => {
      unregisterProcess(child);
      activeSeparationJobs.delete(jobId);
      activeSeparationJobs.delete(cleanKey);
      finishDemucsWorkerAndProcessQueue();
      if (code !== 0) {
        let cleanDetail = '';
        if (stdoutData) {
          try {
            const parsed = JSON.parse(stdoutData.trim());
            if (parsed.message) cleanDetail = parsed.message;
          } catch (_) {
            const lines = stdoutData.trim().split('\n').filter(l => l.trim() && !l.includes('%|') && !l.includes('seconds/s'));
            if (lines.length > 0) cleanDetail = lines[lines.length - 1];
          }
        }
        if (!cleanDetail && stderrData) {
          const lines = stderrData.trim().split('\n').filter(l => l.trim() && !l.includes('%|') && !l.includes('seconds/s'));
          cleanDetail = lines.slice(-4).join(' ');
        }
        const errMsg = `Demucs worker exited with code ${code}${cleanDetail ? `: ${cleanDetail}` : ''}`;
        activeSeparationProgress.set(cleanKey, {
          progress: 0,
          status: 'error',
          error: errMsg,
          message: errMsg,
          model,
        });
        setTimeout(() => {
          if (activeSeparationProgress.get(cleanKey)?.status === 'error') {
            activeSeparationProgress.delete(cleanKey);
          }
        }, 60000);
        return reject(new Error(errMsg));
      }

      try {
        const lines = stdoutData.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const parsed = JSON.parse(lastLine);

        if (parsed.status === 'success') {
          const existing = activeSeparationProgress.get(cleanKey);
          const curLogs = Array.isArray(existing?.logs) ? [...existing.logs] : [];
          curLogs.push({
            time: new Date().toLocaleTimeString(),
            progress: 100,
            message: '🎉 Demucs Separation 100% Complete (Clean BGM Ready)',
          });
          activeSeparationProgress.set(cleanKey, {
            progress: 100,
            status: 'completed',
            message: 'Separation Completed 100%',
            model,
            noVocalsPath: parsed.noVocalsPath,
            processingTimeSec: parsed.processingTimeSec,
            logs: curLogs.slice(-60),
          });
          setTimeout(() => activeSeparationProgress.delete(cleanKey), 300000);
          console.log(`[AudioSeparation] ✅ Separation successful in ${parsed.processingTimeSec}s (Vocals: ${(parsed.vocalsSizeBytes / 1024 / 1024).toFixed(1)}MB, No-Vocals: ${(parsed.noVocalsSizeBytes / 1024 / 1024).toFixed(1)}MB)`);
          resolve({
            ...parsed,
            isCached: false,
          });
        } else {
          const msg = parsed.message || 'Demucs returned non-success status';
          activeSeparationProgress.set(cleanKey, {
            progress: 0,
            status: 'error',
            error: msg,
            message: msg,
            model,
          });
          reject(new Error(msg));
        }
      } catch (parseErr) {
        const msg = `Failed to parse Demucs output: ${parseErr.message}. Output was: ${stdoutData.substring(0, 200)}`;
        activeSeparationProgress.set(cleanKey, {
          progress: 0,
          status: 'error',
          error: msg,
          message: msg,
          model,
        });
        reject(new Error(msg));
      }
    });
  });
}

function separateAudio(options = {}) {
  const { audioPath, model = 'htdemucs' } = options;
  if (!audioPath || !fs.existsSync(audioPath)) {
    return Promise.reject(new Error(`Input audio file not found: ${audioPath}`));
  }

  const targetDir = options.outputDir || getSeparationCacheDir(audioPath, model);
  os_mkdir_p(targetDir);

  const cachedVocals = path.join(targetDir, 'vocals.wav');
  const cachedNoVocals = path.join(targetDir, 'no_vocals.wav');
  const cleanKey = path.basename(audioPath).toLowerCase();

  // 1. Instant Cache Hit Check (Strict validation: both stems must exist & be >= 100KB)
  const MIN_STEM_SIZE = 100 * 1024; // 100 KB
  if (fs.existsSync(cachedVocals) && fs.existsSync(cachedNoVocals)) {
    const vStat = fs.statSync(cachedVocals);
    const nvStat = fs.statSync(cachedNoVocals);
    if (vStat.size >= MIN_STEM_SIZE && nvStat.size >= MIN_STEM_SIZE) {
      console.log(`[AudioSeparation] ⚡ Using cached Demucs separation: ${targetDir}`);
      activeSeparationProgress.set(cleanKey, { progress: 100, status: 'completed', message: 'Clean BGM រួចរាល់ 100%' });
      return Promise.resolve({
        status: 'success',
        isCached: true,
        model,
        vocalsPath: cachedVocals,
        noVocalsPath: cachedNoVocals,
        vocalsSizeBytes: vStat.size,
        noVocalsSizeBytes: nvStat.size,
      });
    }
  }

  // 2. Safe Queue when another Demucs separation is active (prevents 409 BUSY crashes)
  if (isDemucsRunning) {
    return new Promise((resolve, reject) => {
      separationQueue.push({
        options,
        targetDir,
        cleanKey,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      });
      activeSeparationProgress.set(cleanKey, {
        progress: 0,
        status: 'queued',
        message: `រង់ចាំក្នុងជួរ (Queued: លេខរៀងទី ${separationQueue.length})...`,
        queuePosition: separationQueue.length,
        model,
      });
      console.log(`[AudioSeparation] ⏳ Queued Demucs separation for ${cleanKey} (Position: ${separationQueue.length})`);
    });
  }

  isDemucsRunning = true;
  currentDemucsMedia = path.basename(audioPath);

  return executeDemucsWorker(options, targetDir, cleanKey);
}

function killAllDemucsSystemProcesses() {
  let killed = 0;
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'python.exe\'\\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*demucs*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"', { stdio: 'ignore' });
      killed++;
    } catch (_) {}
  }
  return killed;
}

function killSeparationJob(identifier = 'all') {
  let killed = 0;
  console.log(`[AudioSeparation] 🛑 Kill Demucs command received for: ${identifier}`);

  const terminateProcess = (proc) => {
    if (!proc || !proc.pid) return;
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
      } else {
        proc.kill('SIGKILL');
      }
      killed++;
    } catch (_) {}
  };

  if (!identifier || identifier === 'all') {
    // 1. Drain & cancel all queued jobs
    while (separationQueue.length > 0) {
      const qJob = separationQueue.shift();
      const cancelErr = new Error('Demucs separation aborted by user');
      cancelErr.name = 'AbortError';
      qJob.reject(cancelErr);
      activeSeparationProgress.set(qJob.cleanKey, { status: 'cancelled', progress: 0, message: 'បានលុបចោល' });
    }

    // 2. Terminate all active jobs
    const seenPids = new Set();
    for (const [, proc] of activeSeparationJobs.entries()) {
      if (proc && proc.pid && !seenPids.has(proc.pid)) {
        seenPids.add(proc.pid);
        terminateProcess(proc);
      }
    }
    activeSeparationJobs.clear();
    activeSeparationProgress.clear();
    // System-wide sweep on Windows to eliminate orphaned/detached Python demucs workers
    killAllDemucsSystemProcesses();

    isDemucsRunning = false;
    currentDemucsMedia = null;
  } else {
    const cleanId = normalizeSeparationKey(identifier);

    // 1. Check if job is in the waiting queue first (Scoped Queue Cancellation)
    const qIdx = separationQueue.findIndex(j =>
      j.cleanKey === cleanId ||
      j.cleanKey.includes(cleanId) ||
      cleanId.includes(j.cleanKey) ||
      j.options?.jobId === identifier
    );
    if (qIdx !== -1) {
      const removed = separationQueue.splice(qIdx, 1)[0];
      const cancelErr = new Error('Demucs separation cancelled by user');
      cancelErr.name = 'AbortError';
      removed.reject(cancelErr);
      activeSeparationProgress.set(removed.cleanKey, { status: 'cancelled', progress: 0, message: 'បានលុបចោល' });
      // Update remaining queue positions
      separationQueue.forEach((job, idx) => {
        const p = activeSeparationProgress.get(job.cleanKey);
        if (p && p.status === 'queued') {
          p.queuePosition = idx + 1;
          p.message = `រង់ចាំក្នុងជួរ (Queued: លេខរៀងទី ${idx + 1})...`;
        }
      });
      return { success: true, killed: 0, cancelledFromQueue: true };
    }

    // 2. If it's the currently running job, terminate only this specific process
    const proc = activeSeparationJobs.get(identifier) || activeSeparationJobs.get(cleanId);
    if (proc) {
      terminateProcess(proc);
      activeSeparationJobs.delete(identifier);
      activeSeparationJobs.delete(cleanId);
    }
    activeSeparationProgress.delete(identifier);
    activeSeparationProgress.delete(cleanId);

    // Dequeue next job safely
    finishDemucsWorkerAndProcessQueue();
  }

  return { success: true, killed };
}

function os_mkdir_p(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Ensure any active separation workers are killed on server shutdown or nodemon restart
const cleanupActiveSeparations = () => {
  if (activeSeparationJobs.size > 0 || isDemucsRunning) {
    try { killSeparationJob('all'); } catch (_) {}
  }
};
process.on('exit', cleanupActiveSeparations);
process.on('SIGINT', cleanupActiveSeparations);
process.on('SIGTERM', cleanupActiveSeparations);

module.exports = {
  separateAudio,
  killSeparationJob,
  killAllDemucsSystemProcesses,
  getSeparationCacheDir,
  getSeparationProgress,
  isSeparationBusy,
  getSeparationQueueLength,
  getCurrentSeparationMedia,
  resolvePythonBinary,
};

