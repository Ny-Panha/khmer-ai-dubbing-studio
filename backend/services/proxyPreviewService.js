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
  if (!job) return { state: 'stale' };
  if (job.id !== id) return { state: 'superseded' };
  if (job.state === 'fresh' && Date.now() >= job.checkAfter) {
    job.checkAfter = Date.now() + 5000;
    try {
      const ep = getSeriesMetadata(seriesId)?.episodes?.find(e => String(e.id) === episodeId);
      if (!ep || stemReference(ep) !== job.stemReference || fingerprint(job.files) !== job.fingerprint) job.state = 'stale';
    } catch { job.state = 'stale'; }
  }
  if (job.state === 'stale') return { state: 'stale' };
  const hit = cached(dir, id);
  if (hit) return { ...hit, state: 'fresh', url: '/uploads/projects/' + encodeURIComponent(seriesId) +
    '/episodes/' + encodeURIComponent(episodeId) + '/proxy-' + id + '.mp4' };
  return { state: job.state === 'fresh' ? 'stale' : job.state, error: job.error };
}

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (pending.size) {
      const [dir, job] = pending.entries().next().value;
      pending.delete(dir);
      job.state = 'rendering';
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
        const measured = await renderProxy(job.input, work, job.id);
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
  const dir = location(seriesId, episodeId);
  const ep = getSeriesMetadata(seriesId)?.episodes?.find(e => String(e.id) === episodeId);
  if (!ep?.video || ep.video.videoUrl !== snapshot.videoUrl) throw new Error('Episode media is still loading');
  const source = mediaPath(ep.sourceVideoPath || ep.video.videoPath || ep.video.videoUrl);
  const stem = mediaPath(stemReference(ep));
  if ((ep.isDemucsDone || ep.hasDemucs) && !stem) throw new Error('Clean BGM is missing');
  const { clips, settings, segments } = snapshot;
  if (!Array.isArray(clips) || !Array.isArray(segments) || !settings ||
      clips.some(c => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start ||
        (c.sourceStart != null && !(Number.isFinite(c.sourceStart) && c.sourceStart >= 0)))) throw new Error('Invalid proxy timeline');
  const audible = v => !v.muted && !v.isMuted && (v.audioPath || v.audioUrl || v.audioFile);
  const voices = segments.filter(audible).map(v => ({ ...v, audioPath: mediaPath(v.audioPath || v.audioUrl ||
    path.join(dir, 'audio', path.basename(v.audioFile))) }));
  const silentSegments = segments.filter(v => !audible(v));
  const input = { source, stem, clips, voices, settings, editSignature: snapshot.editSignature };
  if (silentSegments.length) input.silentSegments = silentSegments;
  const files = dependencies(input);
  const signature = fingerprint(files);
  const id = crypto.createHash('sha256').update('proxy-1').update(JSON.stringify(input)).update(signature).digest('hex');
  const existing = latest.get(dir);
  if (!existing || existing.id !== id || ['error', 'stale', 'fresh'].includes(existing.state)) {
    const hit = cached(dir, id);
    clearTimeout(existing?.timer);
    pending.delete(dir);
    const job = { id, files, fingerprint: signature, stemReference: stemReference(ep),
      checkAfter: Date.now() + 5000, state: hit ? 'fresh' : 'queued' };
    latest.set(dir, job);
    if (!hit) {
      job.input = input;
      // Debounce on the server so a committed edit still renders after leaving Studio.
      job.timer = setTimeout(() => {
        pending.set(dir, job);
        void drain();
      }, 5000);
    }
  }
  return { ...status(seriesId, episodeId, id), revision: id };
}

module.exports = { request, status };
