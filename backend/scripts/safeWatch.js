#!/usr/bin/env node
/**
 * DragonDub AI - Windows-Safe Backend Dev Watcher (mtime + size verified)
 *
 * Why this exists:
 * On Windows NTFS with DisableLastAccess=2 (LastAccessTime updates enabled),
 * raw `node --watch` / `fs.watch` fires `change` events on pure READ-ONLY file
 * access (Windows Defender scans, Search Indexer, IDE indexing, lazy `require()`),
 * causing phantom backend restarts that kill active Demucs/FFmpeg/TTS jobs and
 * flood the browser with 502 Bad Gateway (ECONNREFUSED/ECONNRESET) errors.
 *
 * This watcher verifies that a `.js` file's `mtimeMs` or `size` actually changed
 * (or a `.js` file was added/removed) before restarting `server.js`.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const BACKEND_DIR = path.resolve(__dirname, '..');
const DEFAULT_WATCH_TARGETS = [
  'server.js',
  'routes',
  'services',
  'utils',
  'middleware',
  'models/episodeModel.js',
  'models/segmentModel.js',
  'models/speakerRegistry.js',
  'models/timestampUtils.js',
];

function isWatchedCodeFile(filePath) {
  return /\.(?:js|cjs|mjs)$/i.test(String(filePath || ''));
}

function getFileSignature(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return null;
    return `${Math.floor(st.mtimeMs)}:${st.size}`;
  } catch {
    return null;
  }
}

function snapshotTarget(targetPath, snapshotMap) {
  let st;
  try {
    st = fs.statSync(targetPath);
  } catch {
    return;
  }

  if (st.isFile()) {
    if (isWatchedCodeFile(targetPath)) {
      snapshotMap.set(path.resolve(targetPath), `${Math.floor(st.mtimeMs)}:${st.size}`);
    }
    return;
  }

  if (st.isDirectory()) {
    let entries = [];
    try {
      entries = fs.readdirSync(targetPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '__pycache__' || ent.name.startsWith('.')) {
        continue;
      }
      const full = path.join(targetPath, ent.name);
      if (ent.isDirectory()) {
        snapshotTarget(full, snapshotMap);
      } else if (ent.isFile() && isWatchedCodeFile(full)) {
        const sig = getFileSignature(full);
        if (sig) snapshotMap.set(path.resolve(full), sig);
      }
    }
  }
}

function buildCodeSnapshot(baseDir, targets = DEFAULT_WATCH_TARGETS) {
  const map = new Map();
  for (const rel of targets) {
    snapshotTarget(path.resolve(baseDir, rel), map);
  }
  return map;
}

/**
 * Pure diff helper: returns list of actually modified/added/deleted JS file paths.
 * Read-only atime updates keep identical mtimeMs + size, so this returns [].
 */
function diffSnapshots(prevMap, nextMap) {
  const changed = [];
  for (const [file, sig] of nextMap.entries()) {
    if (prevMap.get(file) !== sig) {
      changed.push(file);
    }
  }
  for (const file of prevMap.keys()) {
    if (!nextMap.has(file)) {
      changed.push(file);
    }
  }
  return changed;
}

function startSafeWatcher({
  baseDir = BACKEND_DIR,
  entryFile = 'server.js',
  watchTargets = DEFAULT_WATCH_TARGETS,
  debounceMs = 350,
} = {}) {
  let snapshot = buildCodeSnapshot(baseDir, watchTargets);
  let child = null;
  let shuttingDown = false;
  let restartTimer = null;
  let pendingRestart = false;
  const watchers = [];

  const spawnServer = () => {
    if (shuttingDown) return;
    child = spawn(process.execPath, [entryFile], {
      cwd: baseDir,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code, signal) => {
      const wasExpectedRestart = pendingRestart;
      child = null;
      if (shuttingDown) {
        process.exit(code ?? 0);
        return;
      }
      if (wasExpectedRestart) {
        pendingRestart = false;
        spawnServer();
        return;
      }
      console.log(`[SafeWatch] ${entryFile} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}). Waiting for real code edit before restarting...`);
    });
  };

  const stopChildProcess = (targetChild) => {
    if (!targetChild || !targetChild.pid) return;
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${targetChild.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
        return;
      } catch {
        // Fallback to Node kill
      }
    }
    try {
      targetChild.kill('SIGTERM');
    } catch {
      try { targetChild.kill(); } catch {}
    }
  };

  const triggerRestart = (changedFiles) => {
    if (shuttingDown) return;
    const relList = changedFiles
      .slice(0, 3)
      .map((f) => path.relative(baseDir, f).replace(/\\/g, '/'))
      .join(', ');
    console.log(`[SafeWatch] Code edit detected (${relList}) -> restarting ${entryFile}...`);
    if (!child) {
      spawnServer();
      return;
    }
    pendingRestart = true;
    const victim = child;
    stopChildProcess(victim);
    const forceKillTimer = setTimeout(() => {
      if (child === victim && pendingRestart) {
        try { victim.kill('SIGKILL'); } catch {}
      }
    }, 2500);
    if (typeof forceKillTimer.unref === 'function') forceKillTimer.unref();
  };

  const scheduleCheck = () => {
    if (shuttingDown) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      const next = buildCodeSnapshot(baseDir, watchTargets);
      const changed = diffSnapshots(snapshot, next);
      if (changed.length > 0) {
        snapshot = next;
        triggerRestart(changed);
      }
    }, debounceMs);
  };

  for (const rel of watchTargets) {
    const abs = path.resolve(baseDir, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const st = fs.statSync(abs);
      const watcher = fs.watch(abs, { recursive: st.isDirectory() }, () => {
        scheduleCheck();
      });
      watcher.on('error', () => {});
      watchers.push(watcher);
    } catch {
      // Ignore watch setup failure for optional path
    }
  }

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (restartTimer) clearTimeout(restartTimer);
    for (const w of watchers) {
      try { w.close(); } catch {}
    }
    if (child) {
      stopChildProcess(child);
      const exitTimer = setTimeout(() => process.exit(0), 800);
      if (typeof exitTimer.unref === 'function') exitTimer.unref();
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  spawnServer();

  return { shutdown, watchers };
}

if (require.main === module) {
  startSafeWatcher();
}

module.exports = {
  DEFAULT_WATCH_TARGETS,
  isWatchedCodeFile,
  buildCodeSnapshot,
  diffSnapshots,
  startSafeWatcher,
};
