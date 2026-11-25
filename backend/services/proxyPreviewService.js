const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { uploadsDir, isSafeUploadPath } = require('../utils/pathUtils');
const { getSeriesMetadata } = require('./episodeService');
const { renderProxy } = require('./proxyPreviewRenderer');

const pending = new Map();
const latest = new Map();
let busy = false;

function location(seriesId, episodeId) {
  if ([seriesId, episodeId].some(id => !id || id.startsWith('.') || /[\\/:%\x00-\x1f]/.test(id))) throw new Error('Invalid episode ID');
  const dir = path.join(uploadsDir, 'projects', seriesId, 'episodes', episodeId);
  if (!isSafeUploadPath(dir) || !fs.existsSync(dir)) throw new Error('Episode directory missing');
  return dir;
}

function mediaPath(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  const file = value.startsWith('/uploads/') ? path.resolve(uploadsDir, decodeURIComponent(value.slice(9).split('?')[0])) : path.resolve(value);
  if (!isSafeUploadPath(file) || !/\.(mp[34]|m4[av]|mov|mkv|avi|wav|ogg|aac|flac|webm|ts)$/i.test(file) ||
      !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error('Missing episode media: ' + path.basename(file));
  return file;
}

function fingerprint(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const stat = fs.statSync(file);
    hash.update(JSON.stringify([file, stat.size, stat.mtimeMs]));
  }
  return hash.digest('hex');
}

function dependencies(input) {
  return [...new Set([input.source, input.stem, ...input.voices.map(v => v.audioPath)].filter(Boolean))];
}

function stemReference(ep) {
  return ep?.isDemucsDone || ep?.hasDemucs ? ep.cleanBgmPath || ep.bgmAudioUrl || null : null;
}

function cached(dir, id) {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'proxy-preview.json'), 'utf8'));
    if (metadata.revision === id && metadata.bytes > 0 &&
        fs.statSync(path.join(dir, 'proxy-' + id + '.mp4')).size === metadata.bytes) return metadata;
  } catch { /* An interrupted render has no published manifest. */ }
  return null;
}

function status(seriesId, episodeId, id) {
  const dir = location(seriesId, episodeId);
  const job = latest.get(dir);
  if (!job) {
    if (id) {
      const hit = cached(dir, id);
      if (hit) return { ...hit, state: 'fresh', revision: id, url: '/uploads/projects/' + encodeURIComponent(seriesId) +
        '/episodes/' + encodeURIComponent(episodeId) + '/proxy-' + id + '.mp4' };
    }
    return { state: 'stale' };
  }
  if (id && job.id !== id) return { state: 'superseded', revision: job.id };

  // Watchdog: If queued for >= 25s without starting, kickstart drain immediately
  if (job.state === 'queued' && Date.now() - (job.queuedAt || 0) >= 25000) {
    if (!pending.has(dir) && job.input) {
      clearTimeout(job.timer);
      job.timer = null;
      pending.set(dir, job);
      busy = false;
      setImmediate(() => void drain());
    }
  }

  if (job.state === 'fresh' && Date.now() >= job.checkAfter) {
    job.checkAfter = Date.now() + 5000;
    try {
      const ep = getSeriesMetadata(seriesId)?.episodes?.find(e => String(e.id) === episodeId);
      if (!ep || stemReference(ep) !== job.stemReference || fingerprint(job.files) !== job.fingerprint) job.state = 'stale';
    } catch { job.state = 'stale'; }
  }
  if (job.state === 'stale') return { state: 'stale', revision: job.id };
  const hit = cached(dir, job.id);
  if (hit) return { ...hit, state: 'fresh', revision: job.id, url: '/uploads/projects/' + encodeURIComponent(seriesId) +
    '/episodes/' + encodeURIComponent(episodeId) + '/proxy-' + job.id + '.mp4' };

  if (job.state === 'rendering') {
    const elapsedSeconds = Math.round((Date.now() - (job.startedAt || Date.now())) / 1000);
    return { state: 'rendering', progress: job.progress || { phase: 'rendering', percent: 0 }, elapsedSeconds, revision: job.id };
  }

  if (job.state === 'queued') {
    const queuedSeconds = Math.round((Date.now() - (job.queuedAt || Date.now())) / 1000);
    return { state: 'queued', queuedSeconds, revision: job.id };
  }

  return { state: job.state === 'fresh' ? 'stale' : job.state, error: job.error, revision: job.id };
}

async function drain() {
  if (busy) return;
  busy = true;
  let yieldWaitMs = 0;
  try {
    while (pending.size) {
      // Yield briefly while a foreground source-proxy encode is active so two FFmpeg processes don't saturate disk/CPU.
      const { activeJobs: spActiveJobs } = require('./sourceProxyService');
      if (spActiveJobs && spActiveJobs.size > 0 && yieldWaitMs < 5000) {
        yieldWaitMs += 500;
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      yieldWaitMs = 0;
      const [dir, job] = pending.entries().next().value;
      pending.delete(dir);
      job.state = 'rendering';
      job.startedAt = Date.now();
      job.progress = { phase: 'starting', percent: 0 };
      const start = Date.now();
      let work;
      try {
        // An abrupt server exit can leave large PCM intermediates. Reclaim only
        // our own scratch directories whose encoder's parent no longer exists.
        for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
          const match = /^proxy-work-(\d+)-[a-zA-Z0-9]{6}$/.exec(entry.name);
          if (!entry.isDirectory() || !match) continue;
          try { process.kill(Number(match[1]), 0); } catch (err) {
            if (err.code === 'ESRCH') await fs.promises.rm(path.join(dir, entry.name), { recursive: true, force: true });
          }
        }
        work = await fs.promises.mkdtemp(path.join(dir, 'proxy-work-' + process.pid + '-'));
        const measured = await renderProxy(job.input, work, job.id, (prog) => {
          job.progress = prog;
        });
        // Undo or a rapid series switch can request this exact revision again
        // while its encoder is finishing. Publish the matching work once.
        const wanted = latest.get(dir);
        if (wanted?.id !== job.id) continue;
        if (fingerprint(job.files) !== job.fingerprint) { job.state = 'stale'; continue; }
        const filename = 'proxy-' + job.id + '.mp4';
        const metadata = { ...measured, revision: job.id, renderSeconds: (Date.now() - start) / 1000 };
        fs.renameSync(path.join(work, 'preview.mp4'), path.join(dir, filename));
        fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(metadata));
        fs.renameSync(path.join(work, 'manifest.json'), path.join(dir, 'proxy-preview.json'));
        clearTimeout(wanted.timer);
        pending.delete(dir);
        wanted.state = 'fresh';
        delete wanted.input;
        for (const old of fs.readdirSync(dir)) {
          if (/^proxy-[a-f0-9]{64}\.mp4$/.test(old) && old !== filename) {
            await fs.promises.unlink(path.join(dir, old)).catch(() => {});
          }
        }
      } catch (err) {
        job.state = 'error';
        job.error = err.message;
        console.warn('[Proxy Preview]', err.message);
      } finally {
        if (work && path.dirname(work) === dir) await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
        delete job.input;
      }
    }
  } finally { busy = false; }
}

function request(seriesId, episodeId, snapshot) {
  let dir;
  try {
    dir = location(seriesId, episodeId);
  } catch (err) {
    return {
      state: 'queued',
      queuedSeconds: 0,
      revision: null,
      message: err.message || 'Episode directory initializing',
    };
  }

  let ep = getSeriesMetadata(seriesId)?.episodes?.find(e => String(e.id) === episodeId);
  if (!ep || !ep.video) {
    ep = getSeriesMetadata(seriesId, { forceDisk: true })?.episodes?.find(e => String(e.id) === episodeId);
  }

  const normalizeVideoRef = (url) => {
    if (!url || typeof url !== 'string') return '';
    return url.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/\\/g, '/').toLowerCase().trim();
  };

  const epUrlNorm = normalizeVideoRef(ep?.video?.videoUrl || ep?.videoFile);
  const snapUrlNorm = normalizeVideoRef(snapshot?.videoUrl);
  const videoMatches = epUrlNorm && snapUrlNorm && (
    epUrlNorm === snapUrlNorm ||
    epUrlNorm.endsWith(path.posix.basename(snapUrlNorm)) ||
    snapUrlNorm.endsWith(path.posix.basename(epUrlNorm))
  );

  if (!ep?.video || !videoMatches) {
    return {
      state: 'queued',
      queuedSeconds: 0,
      revision: null,
      message: 'Episode media is still loading',
    };
  }

  let source = null;
  try {
    source = mediaPath(ep.sourceVideoPath || ep.video?.videoPath || ep.video?.videoUrl);
  } catch (err) {
    return {
      state: 'queued',
      queuedSeconds: 0,
      revision: null,
      message: err.message || 'Episode media is still loading',
    };
  }
  let stem = null;
  const customBgmRef = (snapshot?.settings?.enableCustomBgm && (snapshot?.settings?.customBgmPath || snapshot?.settings?.customBgmUrl))
    ? (snapshot.settings.customBgmPath || snapshot.settings.customBgmUrl)
    : null;
  if (customBgmRef) {
    try { stem = mediaPath(customBgmRef); } catch (e) { /* missing custom bgm is non-fatal */ }
  } else if (!snapshot?.settings?.youtubeSafeAudio) {
    try { stem = mediaPath(stemReference(ep)); } catch (e) { /* stem missing is non-fatal */ }
  }
  const { clips: rawClips, settings, segments } = snapshot;
  if (!Array.isArray(rawClips) || !Array.isArray(segments) || !settings ||
      rawClips.some(c => !c || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end < c.start ||
        (c.sourceStart != null && !(Number.isFinite(c.sourceStart) && c.sourceStart >= 0)))) throw new Error('Invalid proxy timeline');
  // Filter degenerate zero-duration boundary clips (e.g. start === end === videoDuration) instead of failing with HTTP 400
  const clips = rawClips.filter(c => c.end > c.start);
  const audible = v => !v.muted && !v.isMuted && (v.audioPath || v.audioUrl || v.audioFile);
  const voices = [];
  for (const v of segments.filter(audible)) {
    try {
      const p = mediaPath(v.audioPath || v.audioUrl || path.join(dir, 'audio', path.basename(v.audioFile || '')));
      if (p) voices.push({ ...v, audioPath: p });
    } catch { /* skip individual missing audio cleanly without aborting proxy */ }
  }
  const silentSegments = segments.filter(v => !audible(v));
  const input = { source, stem, clips, voices, settings, editSignature: snapshot.editSignature };
  if (silentSegments.length) input.silentSegments = silentSegments;
  const files = dependencies(input);
  const signature = fingerprint(files);
  const cacheVersion = settings.youtubeSafeAudio ? 'proxy-2-ytsafe' : 'proxy-2';
  const id = crypto.createHash('sha256').update(cacheVersion).update(JSON.stringify(input)).update(signature).digest('hex');
  const existing = latest.get(dir);

  // If already fresh for this exact id, return status directly
  if (existing && existing.id === id && existing.state === 'fresh') {
    return { ...status(seriesId, episodeId, id), revision: id };
  }

  // If already rendering this exact id, keep rendering
  if (existing && existing.id === id && existing.state === 'rendering') {
    return { ...status(seriesId, episodeId, id), revision: id };
  }

  // If already queued for this exact id, accelerate if immediate requested
  if (existing && existing.id === id && existing.state === 'queued') {
    if (snapshot.immediate) {
      clearTimeout(existing.timer);
      existing.timer = null;
      pending.set(dir, existing);
      setImmediate(() => void drain());
    }
    return { ...status(seriesId, episodeId, id), revision: id };
  }

  const hit = cached(dir, id);
  clearTimeout(existing?.timer);
  pending.delete(dir);

  const now = Date.now();
  const isImmediate = Boolean(snapshot.immediate) || !existing || ['error', 'stale'].includes(existing?.state);
  const job = {
    id,
    files,
    fingerprint: signature,
    stemReference: stemReference(ep),
    checkAfter: now + 5000,
    state: hit ? 'fresh' : 'queued',
    queuedAt: now,
    firstEditAt: isImmediate ? now : (existing?.firstEditAt || now),
  };
  latest.set(dir, job);

  if (!hit) {
    job.input = input;
    // Debounce rules:
    // (a) Episode open / missing / stale -> IMMEDIATE enqueue (delay = 0)
    // (b) Edits -> 2000ms debounce, capped at 5000ms max wait from firstEditAt
    const maxDebounceReached = (now - job.firstEditAt) >= 5000;
    const delay = (isImmediate || maxDebounceReached) ? 0 : 2000;
    if (delay === 0) {
      pending.set(dir, job);
      setImmediate(() => void drain());
    } else {
      job.timer = setTimeout(() => {
        job.timer = null;
        pending.set(dir, job);
        void drain();
      }, delay);
    }
  }

  return { ...status(seriesId, episodeId, id), revision: id };
}

module.exports = { request, status };
