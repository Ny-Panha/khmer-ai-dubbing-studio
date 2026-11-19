const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { registerProcess } = require('../utils/processRegistry');
const {
  FFMPEG_PATH, getMediaInfo, buildDynamicDuckingFilter,
  createSynchronizedNarrationAudio, resolveSegmentStartSec,
} = require('./ffmpegService');

// Sample the same first-covering-clip rule as timeline scrubbing. A clip named
// Gap contains actual source footage. Only uncovered timeline space is black.
function planRanges(clips, sourceDuration) {
  if (!clips.length) return [{ start: 0, end: sourceDuration, source: 0 }];
  const spans = clips.map(c => {
    const source = c.sourceStart ?? c.start;
    const available = Math.min(c.sourceEnd ?? sourceDuration, sourceDuration) - source;
    const end = Math.min(c.end, c.start + Math.max(0, available));
    return { start: c.start, end: Math.round(end * 1e6) / 1e6, source };
  });
  const points = [...new Set([0, ...clips.map(c => c.end), ...spans.flatMap(c => [c.start, c.end])])].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1], end = points[i];
    const clip = spans.find(c => c.start <= start && c.end > start);
    const source = clip ? clip.source + start - clip.start : null;
    const prev = ranges.at(-1);
    const contiguous = prev && (source === null ? prev.source === null :
      prev.source !== null && Math.abs(prev.source + start - prev.start - source) < 0.0001);
    if (contiguous) prev.end = end;
    else ranges.push({ start, end, source });
  }
  return ranges;
}

function encode(args, jobId) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    registerProcess(child, { type: 'proxy-preview', jobId });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-1800); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || 'FFmpeg exited ' + code)));
  });
}

async function renderProxy(input, dir, jobId) {
  const { source, stem, clips, voices, settings } = input;
  const info = await getMediaInfo(source);
  const ranges = planRanges(clips, Number(info.format.duration));
  const portrait = settings.aspectRatio === '9:16';
  const w = portrait || settings.aspectRatio === '1:1' ? 480 : 854, h = portrait ? 854 : 480;
  const fit = portrait && settings.verticalStyle === 'crop'
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const parts = [];
  for (const range of ranges) {
    // Round absolute boundaries so rounding never accumulates across micro-clips.
    const seconds = (Math.round(range.end * 30) - Math.round(range.start * 30)) / 30;
    if (seconds <= 0) continue;
    const length = seconds.toFixed(6);
    const args = [];
    let audio = '0:a:0';
    const silence = ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
    if (range.source === null) {
      args.push('-f', 'lavfi', '-i', `color=black:s=${w}x${h}:r=30`, ...silence);
      audio = '1:a:0';
    } else {
      const seek = ['-ss', range.source.toFixed(6)];
      args.push(...seek, '-i', source);
      if (stem) { args.push(...seek, '-i', stem); audio = '1:a:0'; }
      else if (!info.streams.some(s => s.codec_type === 'audio')) { args.push(...silence); audio = '1:a:0'; }
    }
    const name = 'part-' + parts.length + '.mkv';
    await encode([...args, '-map', '0:v:0', '-map', audio, '-t', length,
      '-vf', fit + ',setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=1', '-af', 'apad',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '30', '-threads', '4',
      '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', path.join(dir, name)], jobId);
    parts.push("file '" + name + "'\nduration " + length);
  }
  await fs.promises.writeFile(path.join(dir, 'parts.txt'), parts.join('\n'));
  const args = ['-f', 'concat', '-i', path.join(dir, 'parts.txt')];
  const level = Math.max(0, Math.min(1, Number(settings.duckingVolume ?? 0.15)));
  const duck = Math.min(0.2, level);
  const normal = stem ? (level > 0 ? Math.max(0.3, Math.min(1, level * 2)) : 0) : Math.min(1, level * 1.5);
  const duckSegments = voices.map(v => ({ startSeconds: resolveSegmentStartSec(v), audioDuration: v.audioDurationSec ?? v.duration }));
  const bg = buildDynamicDuckingFilter(duckSegments, duck, normal, clips);
  let graph = '[0:a]' + bg + '[out]';
  if (voices.length) {
    const narration = path.join(dir, 'voices.mp3');
    await createSynchronizedNarrationAudio(voices, narration);
    args.push('-i', narration);
    graph = '[0:a]' + bg + '[bg];[1:a]volume=' + Number(settings.khmerVolume ?? 1.3) +
      '[voice];[bg][voice]amix=inputs=2:duration=first:dropout_transition=2147483647,volume=2,alimiter=limit=0.95[out]';
  }
  const output = path.join(dir, 'preview.mp4');
  await encode([...args, '-filter_complex', graph, '-map', '0:v:0', '-map', '[out]', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output], jobId);
  const metadata = await getMediaInfo(output);
  return { duration: Number(metadata.format.duration), bytes: fs.statSync(output).size };
}

module.exports = { renderProxy, planRanges };
