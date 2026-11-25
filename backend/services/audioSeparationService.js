/**
 * DragonDub AI - Audio Separation Service
 * Wraps Demucs Python worker to separate dialogue (vocals) and background music/sfx (no_vocals).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { registerProcess, unregisterProcess } = require('../utils/processRegistry');

function resolveFfmpegBinary() {
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const sysPath = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim();
    if (sysPath && fs.existsSync(sysPath)) return sysPath;
  } catch (_) {}
  return ffmpegInstaller?.path || 'ffmpeg';
}

/**
 * Dynamically compute multi-core CPU worker count and per-worker BLAS/OMP thread count
 * while reserving OS/UI headroom cores so Windows & Browser scrolling stay 60fps smooth.
 * Default reserve: 2 cores on >=8-core CPUs, 1 core on 4-7-core CPUs (override via DEMUCS_CPU_RESERVE_CORES=0).
 * Default jobs: max(2, min(4, floor(usableCores / 3))), threadsPerJob: max(1, floor(usableCores / jobs)).
 */
function computeDefaultCpuConfig(cpuCount = os.cpus().length, env = process.env, requestedJobs = undefined) {
  const totalCores = Math.max(1, Number(cpuCount) || 4);
  const rawReserve = env?.DEMUCS_CPU_RESERVE_CORES;
  const defaultReserve = totalCores >= 8 ? 2 : totalCores >= 4 ? 1 : 0;
  const reserveCores = rawReserve !== undefined && rawReserve !== '' && Number.isFinite(Number(rawReserve)) && Number(rawReserve) >= 0
    ? Math.min(Math.max(0, totalCores - 1), Math.floor(Number(rawReserve)))
    : defaultReserve;
  const usableCores = Math.max(1, totalCores - reserveCores);

  const parsedRequested = requestedJobs !== undefined && requestedJobs !== null && Number.isFinite(Number(requestedJobs)) && Number(requestedJobs) > 0
    ? Math.floor(Number(requestedJobs))
    : null;
  const parsedEnv = env?.DEMUCS_CPU_JOBS !== undefined && env.DEMUCS_CPU_JOBS !== '' && Number.isFinite(Number(env.DEMUCS_CPU_JOBS)) && Number(env.DEMUCS_CPU_JOBS) > 0
    ? Math.floor(Number(env.DEMUCS_CPU_JOBS))
    : null;

  const autoJobs = usableCores >= 2 ? Math.max(2, Math.min(4, Math.floor(usableCores / 3))) : 1;
  const cpuJobs = parsedRequested || parsedEnv || autoJobs;
  const threadsPerJob = Math.max(1, Math.floor(usableCores / cpuJobs));
  return { totalCores, reserveCores, usableCores, cpuJobs, threadsPerJob };
}

/**
 * Resolve separation speed/quality preset into concrete engine + Demucs/FFmpeg parameters.
 * Presets:
 * - 'turbo' (default): Multi-core Demucs (htdemucs or DEMUCS_FAST_MODEL=mdx_extra_q), overlap=0.1, shifts=0 (~3x-4x faster on CPU)
 * - 'studio': Max-quality Demucs (htdemucs, overlap=0.25, shifts=1, multi-core)
 * - 'ffmpeg_fast': Instant (~3-5s) stereo-bass-preserved center-vocal suppression via FFmpeg
 */
function resolveSeparationPresetConfig(preset = 'turbo', options = {}, env = process.env) {
  const rawPreset = String(preset || options?.separationPreset || 'turbo').trim().toLowerCase();
  const separationPreset = ['turbo', 'studio', 'ffmpeg_fast'].includes(rawPreset) ? rawPreset : 'turbo';
  const cpuConfig = computeDefaultCpuConfig(os.cpus().length, env, options?.jobs);

  if (separationPreset === 'ffmpeg_fast') {
    return {
      separationPreset: 'ffmpeg_fast',
      engine: 'ffmpeg_fast',
      model: 'ffmpeg_fast',
      cacheModelKey: 'ffmpeg_fast',
      overlap: null,
      shifts: null,
      segment: null,
      jobs: cpuConfig.cpuJobs,
      threadsPerJob: cpuConfig.threadsPerJob,
      usableCores: cpuConfig.usableCores,
      totalCores: cpuConfig.totalCores,
    };
  }

  if (separationPreset === 'studio') {
    const model = options?.model || 'htdemucs';
    return {
      separationPreset: 'studio',
      engine: 'demucs',
      model,
      cacheModelKey: `${model}_studio`,
      overlap: options?.overlap !== undefined && options?.overlap !== null ? Number(options.overlap) : 0.25,
      shifts: options?.shifts !== undefined && options?.shifts !== null ? Number(options.shifts) : 1,
      segment: options?.segment !== undefined && options?.segment !== null ? Number(options.segment) : undefined,
      jobs: cpuConfig.cpuJobs,
      threadsPerJob: cpuConfig.threadsPerJob,
      usableCores: cpuConfig.usableCores,
      totalCores: cpuConfig.totalCores,
    };
  }

  // Default: 'turbo'
  const allowedFastModels = ['htdemucs', 'mdx_extra_q', 'mdx_extra', 'htdemucs_ft'];
  const envFastModel = env?.DEMUCS_FAST_MODEL && allowedFastModels.includes(String(env.DEMUCS_FAST_MODEL).trim())
    ? String(env.DEMUCS_FAST_MODEL).trim()
    : 'htdemucs';
  const model = options?.model || envFastModel;
  const defaultSegment = model.toLowerCase().includes('htdemucs') ? undefined : 10;

  return {
    separationPreset: 'turbo',
    engine: 'demucs',
    model,
    cacheModelKey: model,
    overlap: options?.overlap !== undefined && options?.overlap !== null ? Number(options.overlap) : 0.1,
    shifts: options?.shifts !== undefined && options?.shifts !== null ? Number(options.shifts) : 0,
    segment: options?.segment !== undefined && options?.segment !== null ? Number(options.segment) : defaultSegment,
    jobs: cpuConfig.cpuJobs,
    threadsPerJob: cpuConfig.threadsPerJob,
    usableCores: cpuConfig.usableCores,
    totalCores: cpuConfig.totalCores,
  };
}

function probeMediaDuration(filePath) {
  const { getMediaDuration } = require('./ffmpegService');
  return getMediaDuration(filePath);
}

const activeSeparationJobs = new Map();
const activeSeparationProgress = new Map();
const separationQueue = [];
// cleanKey (lowercased video basename) -> { jobId, seriesId, episodeId, mediaBase } for exact job attribution
const separationJobScope = new Map();
let lastProgressMismatchKey = '';

function scheduleUnrefTimeout(fn, delayMs) {
  const timer = setTimeout(fn, delayMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}

function normalizeSeparationKey(mediaRef) {
  if (!mediaRef) return '';
  return path.basename(String(mediaRef).split('?')[0].split('#')[0]).toLowerCase();
}

function deriveSeparationScope(mediaRef) {
  const raw = String(mediaRef || '');
  const match = raw.match(/projects[/\\]([^/\\]+)[/\\]episodes[/\\]([^/\\]+)/);
  return {
    seriesId: (match && match[1]) || null,
    episodeId: (match && match[2]) || null,
    mediaBase: raw ? path.basename(raw.split('?')[0].split('#')[0]) : null,
  };
}

function getScopedSeparationKey(mediaRef, scope = {}) {
  const mediaKey = normalizeSeparationKey(mediaRef);
  if (!mediaKey) return '';
  const derivedScope = deriveSeparationScope(mediaRef);
  const seriesId = scope.seriesId || derivedScope.seriesId;
  const episodeId = scope.episodeId || derivedScope.episodeId;
  return seriesId && episodeId
    ? `${seriesId}::${episodeId}::${mediaKey}`
    : mediaKey;
}

function findSeparationKey(identifier, scope = {}) {
  for (const [key, jobScope] of separationJobScope.entries()) {
    if (jobScope?.jobId === identifier) return key;
  }
  const scopedKey = getScopedSeparationKey(identifier, scope);
  if (scopedKey && separationJobScope.has(scopedKey)) return scopedKey;
  const hasScope = Boolean(scope.seriesId || scope.episodeId || deriveSeparationScope(identifier).seriesId || deriveSeparationScope(identifier).episodeId);
  const mediaKey = normalizeSeparationKey(identifier);
  return !hasScope && mediaKey && separationJobScope.has(mediaKey) ? mediaKey : null;
}

function getSeparationJobScope(cleanKey) {
  if (!cleanKey) return null;
  return separationJobScope.get(cleanKey) || null;
}

function findSeparationJobScope(identifier) {
  const cleanKey = findSeparationKey(identifier);
  return cleanKey ? getSeparationJobScope(cleanKey) : null;
}

function formatSeparationLog(event, jobScope = null, extra = {}) {
  return `[AudioSeparation] ${event} ${JSON.stringify({
    jobId: (jobScope && jobScope.jobId) || null,
    seriesId: (jobScope && jobScope.seriesId) || null,
    episodeId: (jobScope && jobScope.episodeId) || null,
    media: (jobScope && jobScope.mediaBase) || null,
    ...extra,
  })}`;
}

function logSeparationProgressMismatch(mismatchKey, jobScope, extra = {}) {
  if (mismatchKey === lastProgressMismatchKey) return;
  lastProgressMismatchKey = mismatchKey;
  console.log(formatSeparationLog('⚠️ progress-mismatch', jobScope, extra));
}

function getSeparationProgress(mediaRef, scope = {}) {
  const requestedSeriesId = scope && scope.seriesId ? String(scope.seriesId) : null;
  const requestedEpisodeId = scope && scope.episodeId ? String(scope.episodeId) : null;
  const scopeMatches = (cleanKey) => {
    const jobScope = getSeparationJobScope(cleanKey);
    if (!jobScope) return true;
    if (requestedSeriesId && jobScope.seriesId && jobScope.seriesId !== requestedSeriesId) return false;
    if (requestedEpisodeId && jobScope.episodeId && jobScope.episodeId !== requestedEpisodeId) return false;
    return true;
  };
  const withJobScope = (cleanKey, progress) => {
    const jobScope = getSeparationJobScope(cleanKey);
    return jobScope ? { ...progress, ...jobScope } : progress;
  };

  const cleanBase = normalizeSeparationKey(mediaRef);
  if (cleanBase) {
    const scopedKey = getScopedSeparationKey(mediaRef, {
      seriesId: requestedSeriesId,
      episodeId: requestedEpisodeId,
    });
    const cleanKey = activeSeparationProgress.has(scopedKey)
      ? scopedKey
      : (!requestedSeriesId && !requestedEpisodeId && activeSeparationProgress.has(cleanBase))
        ? cleanBase
        : (activeSeparationProgress.has(cleanBase) && scopeMatches(cleanBase) ? cleanBase : null);
    const exact = cleanKey ? activeSeparationProgress.get(cleanKey) : null;
    if (!exact) {
      const activeKey = normalizeSeparationKey(currentDemucsMedia);
      if (activeKey && activeKey !== cleanBase) {
        logSeparationProgressMismatch(`media:${cleanBase}->${activeKey}`, getSeparationJobScope(activeKey), {
          requestedMedia: cleanBase,
          reason: 'media-not-the-active-job',
        });
      }
      return null;
    }
    if (!scopeMatches(cleanKey)) {
      logSeparationProgressMismatch(`scope:${requestedSeriesId}:${requestedEpisodeId}->${cleanKey}`, getSeparationJobScope(cleanKey), {
        requestedSeriesId,
        requestedEpisodeId,
        reason: 'active-job-in-other-scope',
      });
      return null;
    }
    lastProgressMismatchKey = '';
    return withJobScope(cleanKey, exact);
  }

  // Global view (no mediaRef): keeps the modal auto-reconnect "any active" behavior, optionally narrowed to a series/episode.
  if (activeSeparationProgress.size > 0) {
    const entries = Array.from(activeSeparationProgress.entries()).filter(([key]) => scopeMatches(key));
    if (entries.length === 0) {
      if (requestedSeriesId || requestedEpisodeId) {
        logSeparationProgressMismatch(`active-scope:${requestedSeriesId}:${requestedEpisodeId}`, getSeparationJobScope(normalizeSeparationKey(currentDemucsMedia)), {
          requestedSeriesId,
          requestedEpisodeId,
          reason: 'active-job-in-other-scope',
        });
      }
      return null;
    }
    for (const [key, val] of entries) {
      if (val && val.status === 'separating') {
        lastProgressMismatchKey = '';
        return withJobScope(key, val);
      }
    }
    for (const [key, val] of entries) {
      if (val && val.status === 'completed') {
        lastProgressMismatchKey = '';
        return withJobScope(key, val);
      }
    }
    const [key, val] = entries[entries.length - 1];
    lastProgressMismatchKey = '';
    return withJobScope(key, val);
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
 * Find any existing valid Clean BGM separation cache directory across presets
 * (checks preferred preset first, then htdemucs, htdemucs_studio, mdx_extra_q, ffmpeg_fast).
 */
function findAnyCachedSeparationDir(audioPath, preferredPreset = null) {
  const candidates = [];
  if (preferredPreset) {
    const cfg = resolveSeparationPresetConfig(preferredPreset);
    candidates.push(cfg.cacheModelKey);
  }
  for (const key of ['htdemucs', 'htdemucs_studio', 'mdx_extra_q', 'ffmpeg_fast']) {
    if (!candidates.includes(key)) candidates.push(key);
  }
  for (const modelKey of candidates) {
    const dir = getSeparationCacheDir(audioPath, modelKey);
    if (fs.existsSync(path.join(dir, 'no_vocals.wav'))) {
      return { cacheDir: dir, modelKey };
    }
  }
  const fallbackKey = candidates[0] || 'htdemucs';
  return { cacheDir: getSeparationCacheDir(audioPath, fallbackKey), modelKey: fallbackKey };
}

/**
 * Validate Demucs separated stems for existence, size (>=100KB), decodability, and non-zero duration
 */
function validateDemucsStems(vocalsPath, noVocalsPath, sourceDuration = null) {
  const MIN_STEM_SIZE = 100 * 1024; // 100 KB

  // Polymorphic support: when called synchronously with 1 argument (targetDir)
  if (!noVocalsPath || typeof noVocalsPath !== 'string') {
    const dir = vocalsPath;
    const vFile = path.join(dir, 'vocals.wav');
    const nvFile = path.join(dir, 'no_vocals.wav');
    if (!fs.existsSync(vFile) || !fs.existsSync(nvFile)) {
      return false;
    }
    try {
      const vSize = fs.statSync(vFile).size;
      const nvSize = fs.statSync(nvFile).size;
      return vSize >= MIN_STEM_SIZE && nvSize >= MIN_STEM_SIZE;
    } catch (_) {
      return false;
    }
  }

  return (async () => {
    if (!fs.existsSync(vocalsPath) || !fs.existsSync(noVocalsPath)) {
      return { valid: false, reason: 'STEMS_NOT_FOUND' };
    }
    const vStat = fs.statSync(vocalsPath);
    const nvStat = fs.statSync(noVocalsPath);
    if (vStat.size < MIN_STEM_SIZE || nvStat.size < MIN_STEM_SIZE) {
      return { valid: false, reason: 'STEMS_TOO_SMALL', vocalsSizeBytes: vStat.size, noVocalsSizeBytes: nvStat.size };
    }

    try {
      const vDur = await probeMediaDuration(vocalsPath);
      const nvDur = await probeMediaDuration(noVocalsPath);

      if (typeof vDur !== 'number' || typeof nvDur !== 'number' || vDur <= 0.1 || nvDur <= 0.1) {
        return { valid: false, reason: 'STEMS_ZERO_OR_INVALID_DURATION', vDur, nvDur };
      }

      if (typeof sourceDuration === 'number' && sourceDuration > 0.5) {
        const tolerance = 2.0; // 2.0s tolerance
        if (Math.abs(vDur - sourceDuration) > tolerance || Math.abs(nvDur - sourceDuration) > tolerance) {
          return {
            valid: false,
            reason: 'STEMS_DURATION_MISMATCH_SOURCE',
            vDur,
            nvDur,
            sourceDuration,
            diffV: Math.abs(vDur - sourceDuration),
            diffNV: Math.abs(nvDur - sourceDuration),
          };
        }
      }

      return {
        valid: true,
        vocalsPath,
        noVocalsPath,
        vocalsDuration: vDur,
        noVocalsDuration: nvDur,
        vocalsSizeBytes: vStat.size,
        noVocalsSizeBytes: nvStat.size,
      };
    } catch (err) {
      return { valid: false, reason: 'STEMS_DECODE_ERROR', error: err.message };
    }
  })();
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
let pendingStartupCleanupPromise = null;

function finishDemucsWorkerAndProcessQueue() {
  isDemucsRunning = false;
  currentDemucsMedia = null;

  while (separationQueue.length > 0) {
    const nextJob = separationQueue.shift();
    separationQueue.forEach((job, idx) => {
      const p = activeSeparationProgress.get(job.cleanKey);
      if (p && p.status === 'queued') {
        p.queuePosition = idx + 1;
        p.message = `រង់ចាំក្នុងជួរ (Queued: លេខរៀងទី ${idx + 1})...`;
      }
    });

    // Check if dequeued job already has valid cache on disk (e.g. earlier identical run)
    const cachedVocals = path.join(nextJob.targetDir, 'vocals.wav');
    const cachedNoVocals = path.join(nextJob.targetDir, 'no_vocals.wav');
    const nextPreset = resolveSeparationPresetConfig(nextJob.options?.separationPreset, nextJob.options);
    if (!nextJob.options?.force && fs.existsSync(cachedVocals) && fs.existsSync(cachedNoVocals)) {
      const vSize = fs.statSync(cachedVocals).size;
      const nvSize = fs.statSync(cachedNoVocals).size;
      if (vSize >= 100 * 1024 && nvSize >= 100 * 1024) {
        console.log(formatSeparationLog('✅ separation-completed', getSeparationJobScope(nextJob.cleanKey), {
          preset: nextPreset.separationPreset,
          isCached: true,
        }));
        activeSeparationProgress.set(nextJob.cleanKey, {
          progress: 100,
          status: 'completed',
          message: 'Clean BGM រួចរាល់ 100%',
          model: nextPreset.model,
          separationPreset: nextPreset.separationPreset,
          noVocalsPath: cachedNoVocals,
        });
        nextJob.resolve({
          status: 'success',
          isCached: true,
          model: nextPreset.model,
          separationPreset: nextPreset.separationPreset,
          vocalsPath: cachedVocals,
          noVocalsPath: cachedNoVocals,
          vocalsSizeBytes: vSize,
          noVocalsSizeBytes: nvSize,
        });
        continue; // Advance to next in queue without blocking
      }
    }

    isDemucsRunning = true;
    currentDemucsMedia = path.basename(nextJob.options.audioPath);
    console.log(formatSeparationLog('▶️ separation-start', getSeparationJobScope(nextJob.cleanKey), {
      preset: nextPreset.separationPreset,
    }));
    executeDemucsWorker(nextJob.options, nextJob.targetDir, nextJob.cleanKey)
      .then(nextJob.resolve, nextJob.reject);
    break;
  }
}

/**
 * Instant (~3-5s) Clean BGM via FFmpeg stereo-bass-preserved center-vocal suppression.
 * Attenuates center-panned Chinese dialogue while keeping full stereo bass (<160Hz) and wide BGM intact.
 * Produces validated vocals.wav + no_vocals.wav in a single fast FFmpeg pass.
 */
function executeFfmpegFastSeparation(options, targetDir, cleanKey, presetConfig) {
  return new Promise(async (resolve, reject) => {
    const {
      audioPath,
      jobId = `sep_ff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      onProgress = null,
    } = options;

    const startTime = Date.now();
    let sourceDuration = null;
    if (typeof options.sourceDuration === 'number' && options.sourceDuration > 0) {
      sourceDuration = options.sourceDuration;
    } else {
      try { sourceDuration = await probeMediaDuration(audioPath); } catch (_) {}
    }

    const initialLogs = [
      {
        time: new Date().toLocaleTimeString(),
        progress: 5,
        message: '⚡ Starting FFmpeg Instant Clean BGM (Center-Vocal Cut + Stereo Bass Preservation)...',
      },
    ];
    activeSeparationProgress.set(cleanKey, {
      progress: 5,
      status: 'separating',
      message: '⚡ FFmpeg Instant Clean BGM (5s)...',
      model: 'ffmpeg_fast',
      separationPreset: 'ffmpeg_fast',
      logs: initialLogs,
    });

    if (onProgress) {
      onProgress({ phase: 'starting', progress: 5, message: '⚡ Launching FFmpeg Instant Clean BGM...' });
    }

    const ffmpegBin = resolveFfmpegBinary();
    const tmpSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tmpNoVocals = path.join(targetDir, `.tmp_no_vocals_${tmpSuffix}.wav`);
    const tmpVocals = path.join(targetDir, `.tmp_vocals_${tmpSuffix}.wav`);
    const destNoVocals = path.join(targetDir, 'no_vocals.wav');
    const destVocals = path.join(targetDir, 'vocals.wav');

    // Center-channel vocal attenuation + bandpass music preservation blended with original stereo bass (< 160Hz)
    const filterComplex = [
      '[0:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=3[s_side][s_bass][s_voc]',
      '[s_side]pan=stereo|c0=c0-0.65*c1|c1=c1-0.65*c0,highpass=f=45,lowpass=f=14000[bgm_side]',
      '[s_bass]highpass=f=35,lowpass=f=160,volume=0.65[bgm_bass]',
      '[bgm_side][bgm_bass]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[no_vocals]',
      '[s_voc]pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,highpass=f=180,lowpass=f=4500[vocals]',
    ].join(';');

    const args = [
      '-hide_banner',
      '-y',
      '-i', audioPath,
      '-vn',
      '-filter_complex', filterComplex,
      '-map', '[no_vocals]',
      '-c:a', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      tmpNoVocals,
      '-map', '[vocals]',
      '-c:a', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      tmpVocals,
    ];

    console.log(`[AudioSeparation] ⚡ Launching FFmpeg Instant Clean BGM for: ${path.basename(audioPath)} (Preset: ffmpeg_fast)`);

    let child;
    try {
      child = spawn(ffmpegBin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (spawnErr) {
      finishDemucsWorkerAndProcessQueue();
      return reject(spawnErr);
    }

    let workerFinished = false;
    const completeWorkerOnce = () => {
      if (workerFinished) return;
      workerFinished = true;
      unregisterProcess(child);
      activeSeparationJobs.delete(jobId);
      activeSeparationJobs.delete(cleanKey);
      finishDemucsWorkerAndProcessQueue();
    };
    child.__completeWorker = completeWorkerOnce;

    registerProcess(child, { type: 'demucs', jobId, label: cleanKey });
    activeSeparationJobs.set(jobId, child);
    activeSeparationJobs.set(cleanKey, child);

    let stderrData = '';
    child.stderr.on('data', (d) => {
      const chunk = d.toString('utf8');
      stderrData += chunk;
      const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (timeMatch && sourceDuration && sourceDuration > 0.5) {
        const curSec = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3]);
        const pct = Math.min(98, Math.max(10, Math.round((curSec / sourceDuration) * 100)));
        const existing = activeSeparationProgress.get(cleanKey);
        const curLogs = Array.isArray(existing?.logs) ? [...existing.logs] : [];
        const lastLog = curLogs[curLogs.length - 1];
        if (!lastLog || lastLog.progress !== pct) {
          curLogs.push({
            time: new Date().toLocaleTimeString(),
            progress: pct,
            message: `⚡ FFmpeg Instant BGM: ${pct}%`,
          });
        }
        activeSeparationProgress.set(cleanKey, {
          progress: pct,
          status: 'separating',
          message: `⚡ FFmpeg Instant BGM: ${pct}%`,
          model: 'ffmpeg_fast',
          separationPreset: 'ffmpeg_fast',
          logs: curLogs.slice(-60),
        });
        if (onProgress) onProgress({ phase: 'separating', progress: pct, message: `FFmpeg Instant BGM: ${pct}%` });
      }
    });

    const cleanupTemps = () => {
      try { if (fs.existsSync(tmpNoVocals)) fs.unlinkSync(tmpNoVocals); } catch (_) {}
      try { if (fs.existsSync(tmpVocals)) fs.unlinkSync(tmpVocals); } catch (_) {}
    };

    const atomicSwap = (src, dest) => {
      try {
        if (fs.existsSync(dest)) {
          try { fs.unlinkSync(dest); } catch (_) {}
        }
        fs.renameSync(src, dest);
      } catch (_) {
        fs.copyFileSync(src, dest);
        try { fs.unlinkSync(src); } catch (_) {}
      }
    };

    child.on('error', (err) => {
      cleanupTemps();
      activeSeparationProgress.set(cleanKey, {
        progress: 0,
        status: 'error',
        error: err.message,
        message: err.message,
        model: 'ffmpeg_fast',
        separationPreset: 'ffmpeg_fast',
      });
      scheduleUnrefTimeout(() => {
        if (activeSeparationProgress.get(cleanKey)?.status === 'error') {
          activeSeparationProgress.delete(cleanKey);
        }
      }, 60000);
      completeWorkerOnce();
      reject(err);
    });

    child.on('close', async (code) => {
      completeWorkerOnce();
      if (code !== 0) {
        cleanupTemps();
        const tailLines = stderrData.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' ');
        const errMsg = `FFmpeg Instant Clean BGM exited with code ${code}${tailLines ? `: ${tailLines}` : ''}`;
        activeSeparationProgress.set(cleanKey, {
          progress: 0,
          status: 'error',
          error: errMsg,
          message: errMsg,
          model: 'ffmpeg_fast',
          separationPreset: 'ffmpeg_fast',
        });
        scheduleUnrefTimeout(() => {
          if (activeSeparationProgress.get(cleanKey)?.status === 'error') {
            activeSeparationProgress.delete(cleanKey);
          }
        }, 60000);
        return reject(new Error(errMsg));
      }

      try {
        atomicSwap(tmpNoVocals, destNoVocals);
        atomicSwap(tmpVocals, destVocals);

        const validation = await validateDemucsStems(destVocals, destNoVocals, sourceDuration);
        if (!validation.valid) {
          try { if (fs.existsSync(destVocals)) fs.unlinkSync(destVocals); } catch (_) {}
          try { if (fs.existsSync(destNoVocals)) fs.unlinkSync(destNoVocals); } catch (_) {}
          const stemErr = `FFmpeg Instant Clean BGM stems failed validation: ${validation.reason}`;
          activeSeparationProgress.set(cleanKey, {
            progress: 0,
            status: 'error',
            error: stemErr,
            message: stemErr,
            model: 'ffmpeg_fast',
            separationPreset: 'ffmpeg_fast',
          });
          return reject(new Error(stemErr));
        }

        const processingTimeSec = Number(((Date.now() - startTime) / 1000).toFixed(2));
        const existing = activeSeparationProgress.get(cleanKey);
        const curLogs = Array.isArray(existing?.logs) ? [...existing.logs] : [];
        curLogs.push({
          time: new Date().toLocaleTimeString(),
          progress: 100,
          message: `🎉 FFmpeg Instant Clean BGM 100% Complete in ${processingTimeSec}s!`,
        });
        activeSeparationProgress.set(cleanKey, {
          progress: 100,
          status: 'completed',
          message: `⚡ FFmpeg Instant BGM រួចរាល់ (${processingTimeSec}s)`,
          model: 'ffmpeg_fast',
          separationPreset: 'ffmpeg_fast',
          noVocalsPath: destNoVocals,
          processingTimeSec,
          logs: curLogs.slice(-60),
        });
        scheduleUnrefTimeout(() => activeSeparationProgress.delete(cleanKey), 300000);
        console.log(formatSeparationLog('✅ separation-completed', getSeparationJobScope(cleanKey), {
          preset: 'ffmpeg_fast',
          processingTimeSec,
          isCached: false,
        }));

        resolve({
          status: 'success',
          model: 'ffmpeg_fast',
          separationPreset: 'ffmpeg_fast',
          device: 'cpu',
          jobs: presetConfig.jobs,
          processingTimeSec,
          durationSec: sourceDuration ? Number(sourceDuration.toFixed(2)) : validation.noVocalsDuration,
          vocalsPath: destVocals,
          noVocalsPath: destNoVocals,
          vocalsSizeBytes: validation.vocalsSizeBytes,
          noVocalsSizeBytes: validation.noVocalsSizeBytes,
          vocalsDuration: validation.vocalsDuration,
          noVocalsDuration: validation.noVocalsDuration,
          isCached: false,
        });
      } catch (err) {
        cleanupTemps();
        activeSeparationProgress.set(cleanKey, {
          progress: 0,
          status: 'error',
          error: err.message,
          message: err.message,
          model: 'ffmpeg_fast',
          separationPreset: 'ffmpeg_fast',
        });
        reject(err);
      }
    });
  });
}

function executeDemucsWorker(options, targetDir, cleanKey) {
  const presetConfig = resolveSeparationPresetConfig(options.separationPreset, options);
  if (presetConfig.engine === 'ffmpeg_fast') {
    return executeFfmpegFastSeparation(options, targetDir, cleanKey, presetConfig);
  }

  return new Promise((resolve, reject) => {
    const {
      audioPath,
      device = 'auto',
      jobId = `sep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      onProgress = null,
    } = options;
    const model = presetConfig.model;
    const separationPreset = presetConfig.separationPreset;
    const presetLabel = separationPreset === 'studio' ? 'Studio Quality' : 'Demucs Turbo';

    const initialLogs = [
      {
        time: new Date().toLocaleTimeString(),
        progress: 1,
        message: `🎧 Starting ${presetLabel} separation (Model: ${model}, Multi-Core: ${presetConfig.jobs} jobs × ${presetConfig.threadsPerJob} threads)...`,
      },
    ];
    activeSeparationProgress.set(cleanKey, {
      progress: 1,
      status: 'separating',
      message: `Starting ${presetLabel} separation...`,
      model,
      separationPreset,
      logs: initialLogs,
    });

    const workerScript = path.join(__dirname, '../workers/demucs_worker.py');
    if (!fs.existsSync(workerScript)) {
      finishDemucsWorkerAndProcessQueue();
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
    } else if (presetConfig.shifts !== undefined && presetConfig.shifts !== null) {
      args.push('--shifts', String(presetConfig.shifts));
    }
    if (options.overlap !== undefined && options.overlap !== null) {
      args.push('--overlap', String(options.overlap));
    } else if (presetConfig.overlap !== undefined && presetConfig.overlap !== null) {
      args.push('--overlap', String(presetConfig.overlap));
    }
    if (options.segment !== undefined && options.segment !== null) {
      args.push('--segment', String(options.segment));
    } else if (presetConfig.segment !== undefined && presetConfig.segment !== null) {
      args.push('--segment', String(presetConfig.segment));
    }
    const cpuJobs = options.jobs !== undefined && options.jobs !== null
      ? String(options.jobs)
      : String(presetConfig.jobs);
    args.push('--jobs', cpuJobs);
    if (options.suppressResiduals !== false) {
      args.push('--suppress_residuals');
    }

    const effectiveJobs = Math.max(1, Number(cpuJobs) || 1);
    const effectiveUsableCores = Math.max(1, presetConfig.usableCores || presetConfig.totalCores);
    const effectiveThreadsPerJob = Math.max(1, Math.floor(effectiveUsableCores / effectiveJobs));
    const usedCores = effectiveJobs * effectiveThreadsPerJob;

    const optSummary = [
      `Preset: ${separationPreset}`,
      `Shifts: ${presetConfig.shifts}`,
      `Overlap: ${presetConfig.overlap}`,
      presetConfig.segment !== undefined ? `Segment: ${presetConfig.segment}` : null,
      `Jobs: ${cpuJobs} × ${effectiveThreadsPerJob}T (${usedCores}/${presetConfig.totalCores} cores, BelowNormal)`,
    ].filter(Boolean).join(', ');

    console.log(`[AudioSeparation] 🎧 Launching ${presetLabel} separation for: ${path.basename(audioPath)} (Model: ${model}, Device: ${device}, ${optSummary})`);
    if (onProgress) onProgress({ phase: 'starting', progress: 5, message: `Launching ${presetLabel} AI...` });

    const threadsStr = String(effectiveThreadsPerJob);
    const spawnEnv = {
      ...process.env,
      OMP_NUM_THREADS: threadsStr,
      MKL_NUM_THREADS: threadsStr,
      OPENBLAS_NUM_THREADS: threadsStr,
      NUMEXPR_NUM_THREADS: threadsStr,
      OMP_WAIT_POLICY: 'PASSIVE',
      KMP_BLOCKTIME: '0',
    };

    let child;
    try {
      child = spawn(pythonBin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: spawnEnv,
      });
      // Lower OS scheduling priority so Windows DWM & Browser scrolling remain 60fps smooth
      // while Demucs still uses full background CPU speed when idle.
      try {
        if (child?.pid && typeof os.setPriority === 'function' && os.constants?.priority?.PRIORITY_BELOW_NORMAL !== undefined) {
          os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
        }
      } catch (_) {}
    } catch (spawnErr) {
      finishDemucsWorkerAndProcessQueue();
      return reject(spawnErr);
    }

    let workerFinished = false;
    const completeWorkerOnce = () => {
      if (workerFinished) return;
      workerFinished = true;
      unregisterProcess(child);
      activeSeparationJobs.delete(jobId);
      activeSeparationJobs.delete(cleanKey);
      finishDemucsWorkerAndProcessQueue();
    };
    child.__completeWorker = completeWorkerOnce;

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
      activeSeparationProgress.set(cleanKey, {
        progress: 0,
        status: 'error',
        error: err.message,
        message: err.message,
        model,
      });
      scheduleUnrefTimeout(() => {
        if (activeSeparationProgress.get(cleanKey)?.status === 'error') {
          activeSeparationProgress.delete(cleanKey);
        }
      }, 60000);
      completeWorkerOnce();
      reject(err);
    });

    child.on('close', async (code) => {
      completeWorkerOnce();
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
        scheduleUnrefTimeout(() => {
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
          let sourceDuration = null;
          if (typeof options.sourceDuration === 'number' && options.sourceDuration > 0) {
            sourceDuration = options.sourceDuration;
          } else if (audioPath) {
            try { sourceDuration = await probeMediaDuration(audioPath); } catch (_) {}
          }

          const validation = await validateDemucsStems(parsed.vocalsPath, parsed.noVocalsPath, sourceDuration);
          if (!validation.valid) {
            console.error(`[AudioSeparation] ❌ Generated stems failed validation: ${validation.reason}`);
            try { if (fs.existsSync(parsed.vocalsPath)) fs.unlinkSync(parsed.vocalsPath); } catch (_) {}
            try { if (fs.existsSync(parsed.noVocalsPath)) fs.unlinkSync(parsed.noVocalsPath); } catch (_) {}
            const stemErr = `Demucs separated stems failed validation: ${validation.reason}`;
            activeSeparationProgress.set(cleanKey, {
              progress: 0,
              status: 'error',
              error: stemErr,
              message: stemErr,
              model,
            });
            return reject(new Error(stemErr));
          }

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
            separationPreset,
            noVocalsPath: parsed.noVocalsPath,
            processingTimeSec: parsed.processingTimeSec,
            logs: curLogs.slice(-60),
          });
          scheduleUnrefTimeout(() => activeSeparationProgress.delete(cleanKey), 300000);
          console.log(formatSeparationLog('✅ separation-completed', getSeparationJobScope(cleanKey), {
            preset: separationPreset,
            model,
            processingTimeSec: parsed.processingTimeSec,
            isCached: false,
          }));
          resolve({
            ...parsed,
            separationPreset,
            vocalsDuration: validation.vocalsDuration,
            noVocalsDuration: validation.noVocalsDuration,
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
            separationPreset,
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
          separationPreset,
        });
        reject(new Error(msg));
      }
    });
  });
}

async function separateAudio(options = {}) {
  if (pendingStartupCleanupPromise) {
    try { await pendingStartupCleanupPromise; } catch (_) {}
  }
  const { audioPath } = options;
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Input audio file not found: ${audioPath}`);
  }

  const presetConfig = resolveSeparationPresetConfig(options.separationPreset, options);
  const model = presetConfig.model;
  const separationPreset = presetConfig.separationPreset;
  const force = Boolean(options.force);
  const targetDir = options.outputDir || getSeparationCacheDir(audioPath, presetConfig.cacheModelKey);
  os_mkdir_p(targetDir);

  const cachedVocals = path.join(targetDir, 'vocals.wav');
  const cachedNoVocals = path.join(targetDir, 'no_vocals.wav');
  const derivedScope = deriveSeparationScope(audioPath);
  const cleanKey = getScopedSeparationKey(audioPath, options);
  const jobId = options.jobId || `sep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const jobScope = {
    jobId,
    ...derivedScope,
    seriesId: options.seriesId || derivedScope.seriesId,
    episodeId: options.episodeId || derivedScope.episodeId,
  };
  jobScope.mediaBase = derivedScope.mediaBase;
  separationJobScope.set(cleanKey, jobScope);
  console.log(formatSeparationLog('▶️ separation-request', jobScope, { preset: separationPreset, force }));

  // 1. Instant Cache Hit Check (Strict validation: both stems must exist, be decodable & duration > 0.1s)
  if (!force && fs.existsSync(cachedVocals) && fs.existsSync(cachedNoVocals)) {
    let sourceDuration = null;
    if (typeof options.sourceDuration === 'number' && options.sourceDuration > 0) {
      sourceDuration = options.sourceDuration;
    } else {
      try { sourceDuration = await probeMediaDuration(audioPath); } catch (_) {}
    }

    const validation = await validateDemucsStems(cachedVocals, cachedNoVocals, sourceDuration);
    if (validation.valid) {
      console.log(formatSeparationLog('✅ separation-completed', jobScope, { preset: separationPreset, isCached: true }));
      activeSeparationProgress.set(cleanKey, {
        progress: 100,
        status: 'completed',
        message: 'Clean BGM រួចរាល់ 100%',
        model,
        separationPreset,
        noVocalsPath: cachedNoVocals,
      });
      return {
        status: 'success',
        isCached: true,
        model,
        separationPreset,
        vocalsPath: cachedVocals,
        noVocalsPath: cachedNoVocals,
        vocalsSizeBytes: validation.vocalsSizeBytes,
        noVocalsSizeBytes: validation.noVocalsSizeBytes,
        vocalsDuration: validation.vocalsDuration,
        noVocalsDuration: validation.noVocalsDuration,
      };
    } else {
      console.warn(`[AudioSeparation] ⚠️ Cached stems failed validation (${validation.reason}), discarding corrupt cache...`);
      try { if (fs.existsSync(cachedVocals)) fs.unlinkSync(cachedVocals); } catch (_) {}
      try { if (fs.existsSync(cachedNoVocals)) fs.unlinkSync(cachedNoVocals); } catch (_) {}
    }
  }

  // 2. Safe Queue when another Demucs separation is active (prevents 409 BUSY crashes)
  if (isDemucsRunning) {
    return new Promise((resolve, reject) => {
      separationQueue.push({
        options: { ...options, jobId },
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
        separationPreset,
      });
      console.log(formatSeparationLog('⏳ separation-queued', jobScope, {
        preset: separationPreset,
        queuePosition: separationQueue.length,
      }));
    });
  }

  isDemucsRunning = true;
  currentDemucsMedia = path.basename(audioPath);
  console.log(formatSeparationLog('▶️ separation-start', jobScope, { preset: separationPreset }));

  return executeDemucsWorker({ ...options, jobId }, targetDir, cleanKey);
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

/**
 * Non-blocking startup cleanup for orphaned Python Demucs workers.
 * Avoids stalling Express app.listen() for 1-3s on Windows while guaranteeing
 * any subsequent separateAudio() call awaits completion before spawning new workers.
 */
function killAllDemucsSystemProcessesAsync() {
  if (process.platform !== 'win32') {
    return Promise.resolve(0);
  }
  const p = new Promise((resolve) => {
    try {
      const child = spawn(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name = 'python.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*demucs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        ],
        { windowsHide: true, stdio: 'ignore' }
      );
      if (typeof child.unref === 'function') child.unref();
      let settled = false;
      const done = (count) => {
        if (settled) return;
        settled = true;
        resolve(count);
      };
      child.once('close', () => done(1));
      child.once('error', () => done(0));
      scheduleUnrefTimeout(() => done(0), 5000);
    } catch (_) {
      resolve(0);
    }
  });
  pendingStartupCleanupPromise = p.finally(() => {
    if (pendingStartupCleanupPromise === p) {
      pendingStartupCleanupPromise = null;
    }
  });
  return pendingStartupCleanupPromise;
}

function killSeparationJob(identifier, scope = {}) {
  let killed = 0;

  // Never treat a missing/empty identifier as "kill all": require an exact target or the explicit literal 'all'.
  if (!identifier) {
    console.log(formatSeparationLog('🛑 separation-kill-rejected', null, { reason: 'missing-identifier' }));
    return { success: false, killed: 0, error: 'Missing separation kill identifier' };
  }
  const scopedSeriesId = scope.seriesId || deriveSeparationScope(identifier).seriesId;
  const scopedEpisodeId = scope.episodeId || deriveSeparationScope(identifier).episodeId;
  const hasScopedTarget = Boolean(scopedSeriesId || scopedEpisodeId);
  const targetClean = identifier === 'all'
    ? 'all'
    : (findSeparationKey(identifier, { seriesId: scopedSeriesId, episodeId: scopedEpisodeId }) ||
      getScopedSeparationKey(identifier, { seriesId: scopedSeriesId, episodeId: scopedEpisodeId }));
  const targetBase = normalizeSeparationKey(identifier);
  const killTarget = identifier === 'all' ? 'all' : targetClean;

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

  if (identifier === 'all') {
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
    separationJobScope.clear();
    // System-wide sweep on Windows to eliminate orphaned/detached Python demucs workers
    killAllDemucsSystemProcesses();

    isDemucsRunning = false;
    currentDemucsMedia = null;
  } else {
    // 1. Check if job is in the waiting queue first (Scoped Queue Cancellation - Exact Match Only)
    const qIdx = separationQueue.findIndex(j =>
      j.cleanKey === targetClean ||
      j.options?.jobId === identifier ||
      (!hasScopedTarget && (j.cleanKey === targetBase || j.options?.audioPath === identifier))
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
      console.log(formatSeparationLog('🛑 separation-kill', getSeparationJobScope(removed.cleanKey), {
        target: killTarget,
        killed: 0,
        cancelledFromQueue: true,
      }));
      return { success: true, killed: 0, cancelledFromQueue: true };
    }

    // 2. If it's the currently running job, terminate only this specific process
    const proc = activeSeparationJobs.get(identifier) ||
      activeSeparationJobs.get(targetClean) ||
      (!hasScopedTarget ? activeSeparationJobs.get(targetBase) : null);
    if (proc) {
      terminateProcess(proc);
      // Let proc's 'close' event trigger completeWorkerOnce() so OS process exits before advancing queue
      const safetyTimer = setTimeout(() => {
        if (typeof proc.__completeWorker === 'function') {
          proc.__completeWorker();
        }
      }, 2500);
      proc.once('close', () => {
        clearTimeout(safetyTimer);
      });
      activeSeparationJobs.delete(identifier);
      activeSeparationJobs.delete(targetClean);
    }
    activeSeparationProgress.delete(identifier);
    activeSeparationProgress.delete(targetClean);
  }

  const killLogScope = identifier === 'all'
    ? null
    : (getSeparationJobScope(targetClean) || findSeparationJobScope(identifier) || deriveSeparationScope(identifier));
  console.log(formatSeparationLog('🛑 separation-kill', killLogScope, { target: killTarget, killed }));
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
  validateDemucsStems,
  killSeparationJob,
  killAllDemucsSystemProcesses,
  killAllDemucsSystemProcessesAsync,
  getSeparationCacheDir,
  findAnyCachedSeparationDir,
  getSeparationProgress,
  getScopedSeparationKey,
  isSeparationBusy,
  getSeparationQueueLength,
  getCurrentSeparationMedia,
  resolvePythonBinary,
  computeDefaultCpuConfig,
  resolveSeparationPresetConfig,
};

