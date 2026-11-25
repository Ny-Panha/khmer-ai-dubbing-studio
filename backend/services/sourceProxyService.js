const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('node:crypto');
const os = require('node:os');
const { uploadsDir, isSafeUploadPath } = require('../utils/pathUtils');
const { registerProcess } = require('../utils/processRegistry');
const { FFMPEG_PATH, getMediaInfo } = require('./ffmpegService');
const { getSeriesMetadata } = require('./episodeService');

const sourceProxiesDir = path.join(uploadsDir, 'source_proxies');
if (!fs.existsSync(sourceProxiesDir)) {
  fs.mkdirSync(sourceProxiesDir, { recursive: true });
}

// The process-wide queue allows one active encode and one waiting episode.
const activeJobs = new Map();
let latestWaitingJob = null;
let latestRequest = 0;
const failures = new Map();

// Fast cache of file stat to source hash: "size:mtimeMs" -> sha256
const statToHashCache = new Map();

/**
 * Resolves the physical path of an episode's source video
 */
function resolveSourceVideoPath(seriesId, episodeId, explicitUrl = null) {
  if (explicitUrl) {
    let p = explicitUrl;
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
    const resolved = p.startsWith('/uploads/')
      ? path.resolve(uploadsDir, decodeURIComponent(p.slice(9).split('?')[0]))
      : path.resolve(p);
    if (isSafeUploadPath(resolved, uploadsDir) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  if (!seriesId || !episodeId) return null;
  const epDir = path.join(uploadsDir, 'projects', seriesId, 'episodes', episodeId);
  if (!isSafeUploadPath(epDir, uploadsDir) || !fs.existsSync(epDir)) return null;

  try {
    const series = getSeriesMetadata(seriesId);
    const ep = series?.episodes?.find(e => e.id === episodeId);
    const candidateUrls = [ep?.video?.videoUrl, ep?.sourceVideoPath, ep?.video?.videoPath, ep?.videoFile].filter(Boolean);
    for (const url of candidateUrls) {
      let p = url;
      if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
      const file = p.startsWith('/uploads/')
        ? path.resolve(uploadsDir, decodeURIComponent(p.slice(9).split('?')[0]))
        : path.resolve(p);
      if (isSafeUploadPath(file, uploadsDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return file;
      }
    }
  } catch (_) {}

  // Fallback: check video/ directory in episode
  const videoDir = path.join(epDir, 'video');
  if (fs.existsSync(videoDir)) {
    const files = fs.readdirSync(videoDir).filter(f => /\.(mp4|webm|mov|mkv)$/i.test(f) && !f.startsWith('proxy-'));
    if (files.length > 0) {
      return path.join(videoDir, files[0]);
    }
  }

  return null;
}

/**
 * Calculates or retrieves the cached SHA-256 content hash of the source video
 */
async function getSourceContentHash(filePath) {
  const stat = await fs.promises.stat(filePath);
  const key = `${filePath}:${stat.size}:${stat.mtimeMs}`;
  if (!statToHashCache.has(key)) {
    // Stream once per revision without blocking media range responses.
    const digest = (async () => {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
      return hash.digest('hex');
    })();
    statToHashCache.set(key, digest);
    digest.catch(() => statToHashCache.delete(key));
  }
  return statToHashCache.get(key);
}

/**
 * Validates whether a cached Source Proxy is complete and healthy
 */
function getValidCachedProxy(sourceHash, sourceDuration = null) {
  const proxyDir = path.join(sourceProxiesDir, sourceHash);
  const manifestPath = path.join(proxyDir, 'source-proxy.json');
  const videoPath = path.join(proxyDir, 'source-proxy.mp4');

  if (!fs.existsSync(manifestPath) || !fs.existsSync(videoPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.status !== 'ready' || manifest.sourceHash !== sourceHash || !manifest.bytes) {
      return null;
    }
    const stat = fs.statSync(videoPath);
    if (stat.size !== manifest.bytes || stat.size === 0) {
      return null;
    }
    // If source duration is known, ensure proxy duration aligns closely
    if (sourceDuration && manifest.duration && Math.abs(sourceDuration - manifest.duration) > 0.5) {
      return null;
    }
    return {
      status: 'ready',
      url: `/uploads/source_proxies/${sourceHash}/source-proxy.mp4`,
      duration: manifest.duration,
      bytes: manifest.bytes,
      width: manifest.width,
      height: manifest.height,
      sourceHash,
      renderSeconds: manifest.renderSeconds,
      cached: true,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Starts an asynchronous background transcode job for the given source
 * Target encoding: H.264, 480p-class (aspect ratio preserved), veryfast preset,
 * CRF 27, GOP 15, -bf 0, +faststart, AAC 96k.
 */
function startTranscodeJob(sourcePath, sourceHash, sourceDuration) {
  if (activeJobs.has(sourceHash)) return activeJobs.get(sourceHash);
  if (latestWaitingJob?.sourceHash === sourceHash) return latestWaitingJob;
  const job = { sourcePath, sourceHash, sourceDuration, status: 'queued', progress: 0 };
  // Finish the running encode, keeping only the latest episode waiting behind it.
  latestWaitingJob = job;
  runNextJob();
  return job;
}

function runNextJob() {
  if (activeJobs.size || !latestWaitingJob) return;
  const job = latestWaitingJob;
  latestWaitingJob = null;
  job.status = 'transcoding';
  job.startTime = Date.now();
  activeJobs.set(job.sourceHash, job);
  transcode(job).catch(err => {
    job.status = 'error';
    job.error = err.message;
    finishJob(job);
  });
}

function finishJob(job) {
  if (activeJobs.get(job.sourceHash) !== job) return;
  if (job.status === 'error') {
    failures.set(job.sourceHash, job.error);
    if (failures.size > 8) failures.delete(failures.keys().next().value);
  }
  activeJobs.delete(job.sourceHash);
  runNextJob();
}

async function transcode(job) {
  const { sourcePath, sourceHash } = job;
  let { sourceDuration } = job;
  if (sourceDuration == null) {
    const info = await getMediaInfo(sourcePath);
    sourceDuration = Number(info.format?.duration || 0);
  }
  const proxyDir = path.join(sourceProxiesDir, sourceHash);
  if (!fs.existsSync(proxyDir)) {
    fs.mkdirSync(proxyDir, { recursive: true });
  }

  const finalVideoPath = path.join(proxyDir, 'source-proxy.mp4');
  const manifestPath = path.join(proxyDir, 'source-proxy.json');
  const tempVideoPath = path.join(proxyDir, `temp_source-proxy_${Date.now()}_${process.pid}.mp4`);

  const ffmpegArgs = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-progress', 'pipe:1',
    '-y',
    '-threads', '1',
    '-filter_threads', '1',
    '-i', sourcePath,
    '-vf', "scale='if(gte(iw,ih),-2,480)':'if(gte(iw,ih),480,-2)'",
    '-c:v', 'libx264',
    '-threads:v', '2',
    '-preset', 'veryfast',
    '-crf', '27',
    '-g', '15',
    '-keyint_min', '15',
    '-bf', '0',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', '44100',
    '-ac', '2',
    tempVideoPath,
  ];

  console.log(`[SourceProxy] 🚀 Starting background transcode for hash ${sourceHash.slice(0, 12)} (${sourcePath})`);

  const child = spawn(FFMPEG_PATH, ffmpegArgs, { windowsHide: true });
  if (child.pid) {
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
  }
  registerProcess(child, { type: 'source-proxy', jobId: sourceHash });

  let lineBuffer = '';
  child.stdout.on('data', chunk => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('out_time_us=')) {
        const us = parseInt(trimmed.slice(12), 10);
        if (!isNaN(us) && sourceDuration > 0) {
          const currentSec = us / 1000000;
          const pct = Math.min(99, Math.round((currentSec / sourceDuration) * 100));
          job.progress = pct;
        }
      } else if (trimmed.startsWith('out_time_ms=')) {
        const ms = parseInt(trimmed.slice(12), 10);
        if (!isNaN(ms) && sourceDuration > 0) {
          const currentSec = ms / 1000000;
          const pct = Math.min(99, Math.round((currentSec / sourceDuration) * 100));
          job.progress = pct;
        }
      }
    }
    job.elapsedSeconds = Math.round((Date.now() - job.startTime) / 1000);
  });

  let stderr = '';
  child.stderr.on('data', data => {
    stderr = (stderr + data).slice(-2000);
  });

  child.once('close', async (code) => {
    const renderSeconds = (Date.now() - job.startTime) / 1000;
    if (code === 0 && fs.existsSync(tempVideoPath)) {
      try {
        const info = await getMediaInfo(tempVideoPath);
        const stat = fs.statSync(tempVideoPath);

        // Atomically publish finished proxy video
        if (fs.existsSync(finalVideoPath)) {
          try { fs.unlinkSync(finalVideoPath); } catch (_) {}
        }
        fs.renameSync(tempVideoPath, finalVideoPath);

        const manifest = {
          status: 'ready',
          sourceHash,
          sourcePath,
          sourceDuration,
          duration: Number(info.format?.duration || sourceDuration),
          bytes: stat.size,
          width: info.streams?.[0]?.width || 854,
          height: info.streams?.[0]?.height || 480,
          renderSeconds,
          completedAt: Date.now(),
        };

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        console.log(`[SourceProxy] ✅ Transcode complete for ${sourceHash.slice(0, 12)} in ${renderSeconds.toFixed(1)}s (${(stat.size / 1048576).toFixed(1)} MiB)`);

        job.status = 'ready';
        job.progress = 100;
        job.url = `/uploads/source_proxies/${sourceHash}/source-proxy.mp4`;
        job.duration = manifest.duration;
        job.bytes = manifest.bytes;
        job.renderSeconds = renderSeconds;
      } catch (postErr) {
        console.error(`[SourceProxy] ❌ Post-processing failed:`, postErr);
        job.status = 'error';
        job.error = postErr.message;
        try { if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath); } catch (_) {}
      }
    } else {
      console.error(`[SourceProxy] ❌ Transcode failed with code ${code}: ${stderr}`);
      job.status = 'error';
      job.error = stderr || `FFmpeg process exited with code ${code}`;
      try { if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath); } catch (_) {}
    }

    finishJob(job);
  });

  child.once('error', (err) => {
    console.error(`[SourceProxy] ❌ Child process error:`, err);
    job.status = 'error';
    job.error = err.message;
    try { if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath); } catch (_) {}
    finishJob(job);
  });

}

/**
 * Main query / trigger method for Source Proxy
 */
async function getStatus(seriesId, episodeId, options = {}) {
  const { immediate = false, videoUrl = null } = options;
  const sourcePath = resolveSourceVideoPath(seriesId, episodeId, videoUrl);

  if (!sourcePath) {
    return { status: 'no_source', message: 'No source video found for this episode' };
  }

  const request = immediate ? ++latestRequest : null;
  const sourceHash = await getSourceContentHash(sourcePath);

  // 1. Check existing valid cache
  const cached = getValidCachedProxy(sourceHash);
  if (cached) {
    return cached;
  }

  if (immediate) failures.delete(sourceHash);
  if (failures.has(sourceHash)) return { status: 'error', error: failures.get(sourceHash) };
  let job = activeJobs.get(sourceHash);
  if (!job && latestWaitingJob?.sourceHash === sourceHash) job = latestWaitingJob;
  if (!job && immediate && request === latestRequest) job = startTranscodeJob(sourcePath, sourceHash);
  if (job) {
    return {
      status: job.status,
      sourceHash,
      progress: job.progress || 0,
      elapsedSeconds: job.elapsedSeconds || 0,
      url: job.url || null,
      error: job.error || null,
    };
  }

  return {
    status: 'missing',
    sourceHash,
    url: null,
  };
}

module.exports = {
  getStatus,
  resolveSourceVideoPath,
  getSourceContentHash,
  getValidCachedProxy,
  startTranscodeJob,
  activeJobs,
};
