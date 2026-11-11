const { spawn } = require("child_process");

/**
 * Central Subprocess & Worker PID Registry
 * Tracks active FFmpeg and Demucs Python child processes so job cancellation
 * or server shutdown cleanly terminates orphan processes.
 */
const activeProcesses = new Map();

function terminateChildProcess(proc) {
  if (!proc) return false;
  const pid = Number(proc.pid);
  try {
    if (process.platform === "win32" && Number.isFinite(pid) && pid > 0) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    }
    if (typeof proc.kill === "function") {
      proc.kill("SIGTERM");
    }
    return true;
  } catch (_) {
    return false;
  }
}

function registerProcess(proc, metadata = {}) {
  if (!proc || !proc.pid) return () => {};
  const pid = Number(proc.pid);
  const entry = {
    pid,
    proc,
    type: metadata.type || "subprocess",
    jobId: metadata.jobId || null,
    label: metadata.label || null,
    startedAt: Date.now(),
  };
  activeProcesses.set(pid, entry);

  const cleanup = () => {
    activeProcesses.delete(pid);
  };

  if (typeof proc.once === "function") {
    proc.once("close", cleanup);
    proc.once("exit", cleanup);
    proc.once("error", cleanup);
  }

  return cleanup;
}

function unregisterProcess(procOrPid) {
  const pid = typeof procOrPid === "object" && procOrPid !== null ? Number(procOrPid.pid) : Number(procOrPid);
  if (Number.isFinite(pid)) {
    activeProcesses.delete(pid);
  }
}

function killProcessesByJob(jobId) {
  if (!jobId) return 0;
  let killed = 0;
  const target = String(jobId);
  for (const [pid, entry] of activeProcesses.entries()) {
    if (String(entry.jobId) === target || String(entry.label) === target) {
      if (terminateChildProcess(entry.proc)) {
        killed++;
      }
      activeProcesses.delete(pid);
    }
  }
  return killed;
}

function killAllProcesses() {
  let killed = 0;
  for (const [pid, entry] of activeProcesses.entries()) {
    if (terminateChildProcess(entry.proc)) {
      killed++;
    }
    activeProcesses.delete(pid);
  }
  return killed;
}

function getActiveProcesses() {
  return Array.from(activeProcesses.values()).map(({ pid, type, jobId, label, startedAt }) => ({
    pid,
    type,
    jobId,
    label,
    startedAt,
  }));
}

module.exports = {
  registerProcess,
  unregisterProcess,
  killProcessesByJob,
  killAllProcesses,
  getActiveProcesses,
  terminateChildProcess,
};

