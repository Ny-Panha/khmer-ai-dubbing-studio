const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planRanges, renderProxy } = require('../services/proxyPreviewRenderer');
const { FFMPEG_PATH, getMediaInfo } = require('../services/ffmpegService');
const proxyService = require('../services/proxyPreviewService');
const { uploadsDir } = require('../utils/pathUtils');

test('requests coalesce, replace pending edits, and recover from a missing cached file', async t => {
  const root = fs.mkdtempSync(path.join(uploadsDir, 'projects', 'proxy-test-'));
  const series = path.basename(root), episode = 'ep_1', dir = path.join(root, 'episodes', episode);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'video'), { recursive: true });
  const source = path.join(dir, 'video', 'source.mp4');
  execFileSync(FFMPEG_PATH, ['-loglevel', 'error', '-f','lavfi','-i','color=red:s=80x60:d=0.5',
    '-c:v','libx264', source], { windowsHide: true });
  const videoUrl = '/uploads/' + path.relative(uploadsDir, source).split(path.sep).join('/');
  fs.writeFileSync(path.join(root, 'series.json'), JSON.stringify({id:series,episodes:[{
    id: episode, sourceVideoPath: source, video:{videoUrl,videoPath:source}, duration:.5,
  }]}));
  const snapshot = {videoUrl, segments:[], clips:[], settings:{aspectRatio:'16:9'}};
  const first = proxyService.request(series, episode, snapshot);
  assert.equal(first.state, 'queued');
  assert.deepEqual(proxyService.request(series, episode, snapshot), first);
  const edited = { ...snapshot, settings:{aspectRatio:'9:16'} };
  const next = proxyService.request(series, episode, edited);
  assert.notEqual(next.revision, first.revision);
  assert.equal(proxyService.status(series, episode, first.revision).state, 'superseded');
  let result;
  for (let n=0; n<150; n++) {
    result = proxyService.status(series, episode, next.revision);
    if (result.state === 'fresh' || result.state === 'error') break;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.equal(result.state, 'fresh', result.error);
  assert.ok(result.bytes > 0 && result.duration > 0 && result.renderSeconds > 0);
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).length,1);
  assert.equal(proxyService.request(series, episode, edited).state,'fresh');
  fs.unlinkSync(path.join(dir, path.basename(result.url)));
  assert.equal(proxyService.status(series, episode, next.revision).state, 'stale');
});

test('adjacent Gap footage coalesces, repeated source and timeline holes keep their positions', () => {
  assert.deepEqual(planRanges([{start:0, end:2, sourceStart:4, sourceEnd:5}], 8),
    [{start:0,end:1,source:4}, {start:1,end:2,source:null}]);
  assert.deepEqual(planRanges([
    { start: 0, end: 1, sourceStart: 3 }, { name: 'Gap', start: 1, end: 2, sourceStart: 4 },
    { start: 3, end: 4, sourceStart: 3 },
  ], 10), [{ start: 0, end: 2, source: 3 }, { start: 2, end: 3, source: null }, { start: 3, end: 4, source: 3 }]);
});

test('proxy encodes reordered source, black holes and positioned voice over Clean BGM at portrait resolution', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-proxy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = args => execFileSync(FFMPEG_PATH, ['-loglevel', 'error', '-nostdin', '-y', ...args], { windowsHide: true });
  const source = path.join(dir, 'colors.mp4'), stem = path.join(dir, 'clean.wav'), voice = path.join(dir, 'voice.mp3');
  run(['-f','lavfi','-i','color=red:s=160x90:r=30:d=1','-f','lavfi','-i','color=blue:s=160x90:r=30:d=1',
    '-f','lavfi','-i','sine=frequency=180:duration=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map','[v]','-map','2:a','-c:v','libx264','-c:a','aac',source]);
  run(['-f','lavfi','-i','anullsrc','-t','2',stem]);
  run(['-f','lavfi','-i','sine=frequency=880:duration=0.3',voice]);
  const clips = [{ start: 0, end: 0.5, sourceStart: 1 }, { start: 1, end: 1.5, sourceStart: 0 }];
  const measured = await renderProxy({ source, stem, clips, voices: [{ audioPath: voice, audioStartSec: 1 }],
    settings: { aspectRatio: '9:16', verticalStyle: 'crop' } }, dir, 'test');
  const file = path.join(dir, 'preview.mp4'), meta = await getMediaInfo(file);
  assert.ok(Math.abs(measured.duration - 1.5) < .06);
  assert.deepEqual(meta.streams.map(s => s.codec_name), ['h264','aac']);
  assert.deepEqual([meta.streams[0].width,meta.streams[0].height], [480,854]);
  function pixel(time) {
    return [...run(['-ss',String(time),'-i',file,'-an','-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-'])];
  }
  assert.ok(pixel(.2)[2] > 200);
  assert.ok(Math.max(...pixel(.75)) < 12);
  assert.ok(pixel(1.2)[0] > 200);
  function peak(time) {
    const samples = run(['-ss',String(time),'-i',file,'-vn','-t','0.1','-ac','1','-f','s16le','-']);
    let peak = 0;
    for(let i=0;i<samples.length;i+=2) peak=Math.max(peak,Math.abs(samples.readInt16LE(i)));
    return peak;
  }
  assert.ok(peak(.2) < 8, 'silence from the stem replaces original source audio');
  assert.ok(peak(1.1) > 500, 'Khmer bus starts at the edited timeline position');
  // A silent narration sample isolates the gain applied to the original tone.
  run(['-f','lavfi','-i','anullsrc','-t','0.4',voice]);
  await renderProxy({ source, stem:null, clips:[], voices:[{audioPath:voice,audioStartSec:1,audioDurationSec:.4}],
    settings:{aspectRatio:'16:9',duckingVolume:.15} }, dir, 'test-original');
  assert.ok(peak(.3) > peak(1.15) * 1.3, 'original dialogue ducks inside the narration window');
});

test('immediate enqueue on open, progress reporting, and debounce stability on identical snapshots', async t => {
  const root = fs.mkdtempSync(path.join(uploadsDir, 'projects', 'proxy-imm-'));
  const series = path.basename(root), episode = 'ep_1', dir = path.join(root, 'episodes', episode);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'video'), { recursive: true });
  const source = path.join(dir, 'video', 'source.mp4');
  execFileSync(FFMPEG_PATH, ['-loglevel', 'error', '-f','lavfi','-i','color=green:s=80x60:d=0.3',
    '-c:v','libx264', source], { windowsHide: true });
  const videoUrl = '/uploads/' + path.relative(uploadsDir, source).split(path.sep).join('/');
  fs.writeFileSync(path.join(root, 'series.json'), JSON.stringify({id:series,episodes:[{
    id: episode, sourceVideoPath: source, video:{videoUrl,videoPath:source}, duration:.3,
  }]}));

  const snapshot = { videoUrl, segments:[], clips:[], settings:{aspectRatio:'16:9'}, immediate: true };
  const first = proxyService.request(series, episode, snapshot);
  assert.equal(first.state, 'queued');

  // Immediate mode must enqueue immediately (delay = 0), transitions to rendering without waiting 5s
  let sawRenderingOrFresh = false;
  let result;
  for (let n = 0; n < 40; n++) {
    result = proxyService.status(series, episode, first.revision);
    if (result.state === 'rendering' || result.state === 'fresh') {
      sawRenderingOrFresh = true;
      break;
    }
    await new Promise(res => setTimeout(res, 50));
  }
  assert.ok(sawRenderingOrFresh, 'Job should enter rendering/fresh immediately without 5s idle wait');

  // Identical snapshot request must NOT reset running/queued job
  const second = proxyService.request(series, episode, snapshot);
  assert.equal(second.revision, first.revision);

  // Wait for finish
  for (let n = 0; n < 60; n++) {
    result = proxyService.status(series, episode, first.revision);
    if (result.state === 'fresh') break;
    await new Promise(res => setTimeout(res, 100));
  }
  assert.equal(result.state, 'fresh');
  assert.ok(result.bytes > 0);
});
