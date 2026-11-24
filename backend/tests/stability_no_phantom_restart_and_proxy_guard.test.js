const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const { buildCodeSnapshot, diffSnapshots } = require('../scripts/safeWatch');
const proxyService = require('../services/proxyPreviewService');
const { FFMPEG_PATH } = require('../services/ffmpegService');
const { uploadsDir } = require('../utils/pathUtils');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('dev.ps1 defaults to stable node server.js and backend/package.json dev uses safeWatch.js (no raw node --watch NTFS atime restarts)', () => {
  const devPs1 = fs.readFileSync(path.join(ROOT_DIR, 'dev.ps1'), 'utf8');
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'backend/package.json'), 'utf8'));

  assert.match(devPs1, /\$EnableWatchBackend\s*=\s*\$false/, 'dev.ps1 must default $EnableWatchBackend to $false');
  assert.ok(devPs1.includes('$backendCmd = "node server.js"'), 'dev.ps1 must run stable node server.js by default');
  assert.ok(devPs1.includes('node scripts/safeWatch.js'), 'dev.ps1 -WatchBackend must use mtime-verified safeWatch.js');
  assert.ok(!devPs1.includes('--watch-path='), 'dev.ps1 must not use raw node --watch-path (broken on Windows NTFS atime)');
  assert.equal(pkgJson.scripts.dev, 'node scripts/safeWatch.js', 'backend dev script must use safeWatch.js');
});

test('safeWatch.js ignores read-only NTFS LastAccessTime access and only restarts on real mtime/size code edits', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safewatch-test-'));
  let proc = null;

  t.after(async () => {
    if (proc && proc.pid) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
      } else {
        try { proc.kill('SIGTERM'); } catch {}
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  fs.mkdirSync(path.join(tmp, 'services'), { recursive: true });
  const svcFile = path.join(tmp, 'services', 'sample.js');
  const entryFile = path.join(tmp, 'server.js');
  fs.writeFileSync(svcFile, 'module.exports = 1;\n', 'utf8');
  // Backdate atime & mtime by 2 hours so NTFS updates LastAccessTime when read
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
  fs.utimesSync(svcFile, twoHoursAgo, twoHoursAgo);
  fs.writeFileSync(
    entryFile,
    'console.log("BOOT:" + process.pid); setTimeout(() => process.exit(0), 6000);\n',
    'utf8'
  );

  // Unit check on snapshot diff for read-only access
  const snap1 = buildCodeSnapshot(tmp, ['server.js', 'services']);
  fs.readFileSync(svcFile, 'utf8');
  const snap2 = buildCodeSnapshot(tmp, ['server.js', 'services']);
  assert.deepEqual(diffSnapshots(snap1, snap2), [], 'Read-only access must produce 0 changed files');

  // Re-backdate before starting live watcher so read-only access triggers NTFS atime update
  fs.utimesSync(svcFile, twoHoursAgo, twoHoursAgo);

  // Live watcher process check
  const runnerCode = `
    const { startSafeWatcher } = require(${JSON.stringify(path.join(ROOT_DIR, 'backend/scripts/safeWatch.js'))});
    startSafeWatcher({ baseDir: ${JSON.stringify(tmp)}, entryFile: 'server.js', watchTargets: ['server.js', 'services'], debounceMs: 120 });
  `;
  proc = spawn(process.execPath, ['-e', runnerCode], {
    cwd: tmp,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const boots = [];
  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('BOOT:')) boots.push(line.slice(5).trim());
    }
  });

  // Wait for initial boot
  for (let i = 0; i < 50 && boots.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(boots.length, 1, 'Watcher must boot server once');

  // Trigger read-only file read (would restart raw node --watch on Windows!)
  fs.readFileSync(svcFile, 'utf8');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(boots.length, 1, 'Read-only file access must NEVER trigger a backend restart');

  // Trigger a real JS modification -> MUST restart
  fs.writeFileSync(svcFile, 'module.exports = 2;\n', 'utf8');
  for (let i = 0; i < 60 && boots.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 60));
  }
  assert.equal(boots.length, 2, 'Real JS file edit must trigger exactly one clean restart');
  assert.notEqual(boots[0], boots[1], 'Restarted child must have a new PID');
});

test('proxyPreviewService gracefully filters zero-duration trailing clips instead of returning 400 while rejecting negative/inverted clips', async (t) => {
  const root = fs.mkdtempSync(path.join(uploadsDir, 'projects', 'proxy-zero-clip-'));
  const series = path.basename(root);
  const episode = 'ep_3';
  const dir = path.join(root, 'episodes', episode);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'video'), { recursive: true });
  const source = path.join(dir, 'video', 'source.mp4');
  execFileSync(
    FFMPEG_PATH,
    ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=80x60:d=0.5', '-c:v', 'libx264', source],
    { windowsHide: true }
  );
  const videoUrl = '/uploads/' + path.relative(uploadsDir, source).split(path.sep).join('/');
  fs.writeFileSync(
    path.join(root, 'series.json'),
    JSON.stringify({
      id: series,
      episodes: [{ id: episode, sourceVideoPath: source, video: { videoUrl, videoPath: source }, duration: 0.5 }],
    })
  );

  // Valid clip + degenerate zero-duration boundary clips (like ep_3's 300.03 -> 300.03)
  const snapshotWithZeroClips = {
    videoUrl,
    segments: [],
    clips: [
      { start: 0, end: 0.5, sourceStart: 0, sourceEnd: 0.5 },
      { start: 0.5, end: 0.5, sourceStart: 0.5, sourceEnd: 0.5 },
      { start: 0.5, end: 0.5, sourceStart: 0.5, sourceEnd: 0.5 },
    ],
    settings: { aspectRatio: '16:9' },
  };
  const res = proxyService.request(series, episode, snapshotWithZeroClips);
  assert.ok(['queued', 'rendering', 'fresh'].includes(res.state), `Expected valid proxy state, got ${res.state}`);

  // Wait for queued render to finish before t.after deletes temp dir
  let finalStatus = res;
  for (let i = 0; i < 80; i++) {
    finalStatus = proxyService.status(series, episode, res.revision);
    if (finalStatus.state === 'fresh' || finalStatus.state === 'error') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(finalStatus.state, 'fresh', `Expected proxy render to complete cleanly, got ${finalStatus.error || finalStatus.state}`);

  // Truly corrupted inverted clip (end < start) must still throw
  assert.throws(
    () =>
      proxyService.request(series, episode, {
        videoUrl,
        segments: [],
        clips: [{ start: 2.0, end: 1.0, sourceStart: 2.0, sourceEnd: 1.0 }],
        settings: { aspectRatio: '16:9' },
      }),
    /Invalid proxy timeline/
  );
});

test('frontend Clean BGM recovery, zero-duration clip guards, and coalesced series sync contracts are intact', () => {
  const runnersSrc = fs.readFileSync(path.join(ROOT_DIR, 'frontend/src/features/dubbing-runner/singleEpisodeRunners.js'), 'utf8');
  const ctxSrc = fs.readFileSync(path.join(ROOT_DIR, 'frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx'), 'utf8');
  const timelineUtilsSrc = fs.readFileSync(path.join(ROOT_DIR, 'frontend/src/utils/timelineUtils.js'), 'utf8');
  const proxyHookSrc = fs.readFileSync(path.join(ROOT_DIR, 'frontend/src/hooks/useProxyPreview.js'), 'utf8');
  const storageSrc = fs.readFileSync(path.join(ROOT_DIR, 'frontend/src/utils/projectStorage.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(ROOT_DIR, 'backend/server.js'), 'utf8');

  assert.ok(runnersSrc.includes('getSeparationStatusApi'), 'runSingleCleanBgm must check disk cache via getSeparationStatusApi before failing');
  assert.ok(runnersSrc.includes('tryRecoverCompletedStemFromDisk'), 'runSingleCleanBgm must recover completed stems from disk on transient idle/disconnect');
  assert.ok(ctxSrc.includes('ended unexpectedly|temporarily interrupted'), 'runSequentialStep must treat interrupted Clean BGM as transient retryable');
  assert.ok(
    ctxSrc.includes('return createStepResult({ status: STEP_STATUS.FAILED, error: errMessage });'),
    'runSequentialStep must return structured FAILED result instead of unhandled promise rejection'
  );
  assert.ok(timelineUtilsSrc.includes('if (clipEnd <= clipStart)'), 'Auto-Cut must skip degenerate zero-duration boundary clips');
  assert.ok(proxyHookSrc.includes('c.end > c.start'), 'useProxyPreview must filter zero-duration clips before POST');
  assert.ok(storageSrc.includes('pendingSeriesSyncState'), 'syncSeriesToBackend must coalesce concurrent syncs per series');
  assert.ok(serverSrc.includes('killAllDemucsSystemProcessesAsync'), 'server.js must run startup orphan Demucs cleanup asynchronously so port 5000 binds immediately');
});
