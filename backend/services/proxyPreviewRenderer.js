const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { registerProcess } = require('../utils/processRegistry');
const {
  FFMPEG_PATH, getMediaInfo, buildDynamicDuckingFilter,
  createSynchronizedNarrationAudio, resolveSegmentStartSec,
} = require('./ffmpegService');
const { isAdClip, resolveAdMediaPath } = require('./ffmpeg/ffmpegVideoAdsHelper');

// Sample the same first-covering-clip rule as timeline scrubbing. A clip named
// Gap contains actual source footage. Only uncovered timeline space is black.
function planRanges(clips, sourceDuration) {
  if (!clips.length) return [{ start: 0, end: sourceDuration, source: 0 }];
  const ranges = [];
  const sorted = [...clips].filter(c => c && Number(c.end) > Number(c.start)).sort((a, b) => Number(a.start) - Number(b.start));
  for (const c of sorted) {
    if (isAdClip(c)) {
      const dur = Number(c.end) - Number(c.start);
      ranges.push({
        start: Number(c.start),
        end: Number(c.end),
        source: Math.max(0, Number(c.sourceStart) || 0),
        isAd: true,
        adPath: resolveAdMediaPath(c),
        adVolume: Number.isFinite(Number(c.adVolume)) ? Number(c.adVolume) : 1.0,
        isMuted: Boolean(c.isMuted),
        dur,
      });
      continue;
    }
    const source = c.sourceStart ?? c.start;
    const available = Math.min(c.sourceEnd ?? sourceDuration, sourceDuration) - source;
    const end = Math.min(c.end, c.start + Math.max(0, available));
    if (end <= c.start) continue;
    const prev = ranges.at(-1);
    const contiguous = prev && !prev.isAd && prev.source !== null &&
      Math.abs(prev.source + Number(c.start) - prev.start - source) < 0.0001 &&
      Math.abs(prev.end - Number(c.start)) < 0.001;
    if (contiguous) prev.end = Math.round(end * 1e6) / 1e6;
    else ranges.push({ start: Number(c.start), end: Math.round(end * 1e6) / 1e6, source, isAd: false });
  }
  return ranges.length > 0 ? ranges : [{ start: 0, end: sourceDuration, source: 0 }];
}

function encode(args, jobId) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, ['-nostdin', '-hide_banner', '-loglevel', 'error',
      '-threads', '2', '-filter_threads', '1', '-filter_complex_threads', '1', '-y', ...args], { windowsHide: true });
    if (child.pid) {
      try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* OS may restrict priority changes. */ }
    }
    registerProcess(child, { type: 'proxy-preview', jobId });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-1800); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || 'FFmpeg exited ' + code)));
  });
}

async function renderProxy(input, dir, jobId, onProgress = null) {
  const { source, stem, clips, voices, settings } = input;
  const isCustomBgm = Boolean(settings?.enableCustomBgm && stem);
  const youtubeSafeAudio = Boolean(settings?.youtubeSafeAudio && !isCustomBgm);
  const effectiveStem = youtubeSafeAudio ? null : stem;
  let stemDur = 0;
  if (isCustomBgm && effectiveStem) {
    try {
      const stemInfo = await getMediaInfo(effectiveStem);
      stemDur = Number(stemInfo?.format?.duration) || 0;
    } catch (_) {}
  }
  const info = await getMediaInfo(source);
  const ranges = planRanges(clips, Number(info.format.duration));
  const portrait = settings.aspectRatio === '9:16';
  const w = portrait || settings.aspectRatio === '1:1' ? 480 : 854, h = portrait ? 854 : 480;
  const fit = portrait && settings.verticalStyle === 'crop'
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const parts = [];
  const totalRanges = ranges.length;
  for (let i = 0; i < totalRanges; i++) {
    const range = ranges[i];
    // Round absolute boundaries so rounding never accumulates across micro-clips.
    const seconds = (Math.round(range.end * 30) - Math.round(range.start * 30)) / 30;
    if (seconds <= 0) continue;
    const length = seconds.toFixed(6);
    const args = [];
    let audio = '0:a:0';
    const silence = ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
    if (range.isAd && range.adPath) {
      const adInfo = await getMediaInfo(range.adPath).catch(() => ({ streams: [] }));
      const adHasAudio = Boolean((adInfo.streams || []).some(s => s.codec_type === 'audio'));
      const adVol = range.isMuted ? 0 : Math.max(0, Math.min(2, Number(range.adVolume ?? 1)));
      args.push('-ss', range.source.toFixed(6), '-i', range.adPath);
      if (!adHasAudio || adVol <= 0.001) {
        args.push(...silence);
        audio = '1:a:0';
      } else {
        audio = '0:a:0';
      }
    } else if (range.source === null) {
      args.push('-f', 'lavfi', '-i', `color=black:s=${w}x${h}:r=30`, ...silence);
      audio = '1:a:0';
    } else {
      const seek = ['-ss', range.source.toFixed(6)];
      args.push(...seek, '-i', source);
      if (effectiveStem) {
        if (isCustomBgm) {
          const stemSeek = stemDur > 0 ? (range.source % stemDur) : 0;
          args.push('-stream_loop', '-1', '-ss', stemSeek.toFixed(6), '-i', effectiveStem);
        } else {
          args.push(...seek, '-i', effectiveStem);
        }
        audio = '1:a:0';
      }
      else if (!info.streams.some(s => s.codec_type === 'audio')) { args.push(...silence); audio = '1:a:0'; }
    }
    const name = 'part-' + parts.length + '.mkv';
    await encode([...args, '-map', '0:v:0', '-map', audio, '-t', length,
      '-vf', fit + ',setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=1', '-af', 'apad',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '30', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', path.join(dir, name)], jobId);
    parts.push("file '" + name + "'\nduration " + length);
    if (typeof onProgress === 'function') {
      const percent = Math.min(85, Math.round(((i + 1) / totalRanges) * 85));
      onProgress({ phase: 'encoding', percent, part: i + 1, totalParts: totalRanges });
    }
  }
  await fs.promises.writeFile(path.join(dir, 'parts.txt'), parts.join('\n'));
  const args = ['-f', 'concat', '-i', path.join(dir, 'parts.txt')];
  const rawLevel = Number(settings.duckingVolume);
  const level = Number.isFinite(rawLevel) ? Math.max(0, Math.min(1, rawLevel)) : 0.15;
  const duck = level <= 0.005 ? 0 : level;
  const normal = level <= 0.005 ? 0 : Math.min(1, Number((level <= 0.05 ? level : level * 1.4).toFixed(3)));
  const duckSegments = voices.map(v => ({ startSeconds: resolveSegmentStartSec(v), audioDuration: v.audioDurationSec ?? v.duration }));
  const bg = (youtubeSafeAudio || level <= 0.005)
    ? 'volume=0.0'
    : buildDynamicDuckingFilter(duckSegments, duck, normal, clips);
  let graph = '[0:a]' + bg + '[out]';
  if (voices.length) {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'narration', percent: 86 });
    }
    const narration = path.join(dir, 'voices.mp3');
    await createSynchronizedNarrationAudio(voices, narration);
    args.push('-i', narration);
    graph = '[0:a]' + bg + '[bg];[1:a]volume=' + Number(settings.khmerVolume ?? 1.3) +
      '[voice];[bg][voice]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[out]';
  }
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'muxing', percent: 90 });
  }
  const output = path.join(dir, 'preview.mp4');
  await encode([...args, '-filter_complex', graph, '-map', '0:v:0', '-map', '[out]', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output], jobId);
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'complete', percent: 100 });
  }
  const metadata = await getMediaInfo(output);
  return { duration: Number(metadata.format.duration), bytes: fs.statSync(output).size };
}

module.exports = { renderProxy, planRanges };
