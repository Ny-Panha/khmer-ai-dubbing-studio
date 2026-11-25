#!/usr/bin/env node
/**
 * Cross-Series Isolation Verification (P0)
 * Real-browser Playwright verification for cross-series isolation (ss1 vs ss2
 * sharing identical episode IDs such as ep_1..ep_28).
 *
 * Run with the dev servers up:
 *   backend  :5000
 *   frontend :5173
 *
 *   node scripts/verify-cross-series-isolation.cjs
 *
 * Results (JSON + screenshots) are written to %TEMP%\cross-series-verify\.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { getSeparationCacheDir } = require('../backend/services/audioSeparationService');

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const REPO_ROOT = path.resolve(__dirname, '..');
const UPLOADS = path.join(REPO_ROOT, 'backend', 'uploads', 'projects');
const ARTIFACT_DIR = path.join(process.env.TEMP || REPO_ROOT, 'cross-series-verify');

const results = [];
const startedAt = new Date().toISOString();
let shotIndex = 0;

function record(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail: String(detail || '') });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' :: ' + detail : ''}`);
}

async function apiJson(pathName, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND}${pathName}`, { ...options, signal: controller.signal });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      return { success: false, error: `Non-JSON response (${res.status}): ${text.slice(0, 200)}` };
    }
  } finally {
    clearTimeout(timer);
  }
}

function listDemucsPythonProcesses() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'python.exe'\\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*demucs_worker*' } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) {
    return [];
  }
}

function readEpisodeArray(seriesPayload) {
  const series = seriesPayload && seriesPayload.series ? seriesPayload.series : null;
  if (!series) return [];
  if (Array.isArray(series.episodes)) return series.episodes;
  if (series.episodes && typeof series.episodes === 'object') return Object.values(series.episodes);
  return [];
}

function episodeSnapshot(seriesPayload) {
  const map = {};
  for (const ep of readEpisodeArray(seriesPayload)) {
    const segs = Array.isArray(ep.scriptData?.segments) ? ep.scriptData.segments.length : 0;
    map[ep.id] = {
      id: ep.id,
      title: ep.title || '',
      videoFile: ep.videoFile || ep.sourceVideoPath || ep.video?.videoPath || '',
      sourceVideoPath: ep.sourceVideoPath || ep.video?.videoPath || '',
      bgmAudioUrl: ep.bgmAudioUrl || '',
      cleanBgmPath: ep.cleanBgmPath || '',
      isDemucsDone: Boolean(ep.isDemucsDone),
      audioGenerated: Boolean(ep.audioGenerated),
      audioOutdated: Boolean(ep.audioOutdated),
      fullAudioUrl: ep.fullAudioUrl || '',
      segments: segs,
      lastModified: Number(ep.lastModified || 0),
    };
  }
  return map;
}

function listFilesRecursive(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else {
        try {
          const stat = fs.statSync(abs);
          out.push({ path: path.relative(rootDir, abs), size: stat.size, mtimeMs: stat.mtimeMs });
        } catch (_) {}
      }
    }
  };
  walk(rootDir);
  return out;
}

function diffChangedFiles(beforeList, afterList) {
  const beforeMap = new Map(beforeList.map((f) => [f.path, f]));
  return afterList.filter((f) => {
    const prev = beforeMap.get(f.path);
    return !prev || prev.size !== f.size || Math.abs(prev.mtimeMs - f.mtimeMs) > 5;
  });
}

async function pollUntil(name, fn, timeoutMs = 30000, intervalMs = 350) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timeout waiting for ${name}${lastErr ? ` (${lastErr.message})` : ''}`);
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  // ---------------------------------------------------------------- health
  console.log('\n=== PHASE 0: environment health ===');
  const frontendRes = await fetch(FRONTEND + '/', { method: 'GET' }).catch((e) => ({ ok: false, error: e.message }));
  record('frontend dev server reachable', Boolean(frontendRes.ok), `${FRONTEND} (${frontendRes.status || frontendRes.error})`);
  const jobsHealth = await apiJson('/api/jobs?filter=running').catch((e) => ({ success: false, error: e.message }));
  record('backend API reachable', Boolean(jobsHealth && jobsHealth.success !== false), `${BACKEND}/api/jobs`);

  const ss1Before = await apiJson('/api/series/ss1');
  const ss2Before = await apiJson('/api/series/ss2');
  const snap1Before = episodeSnapshot(ss1Before);
  const snap2Before = episodeSnapshot(ss2Before);
  record('server truth loaded for ss1/ss2', Object.keys(snap1Before).length > 0 && Object.keys(snap2Before).length > 0,
    `ss1=${Object.keys(snap1Before).length} eps, ss2=${Object.keys(snap2Before).length} eps`);

  const ss1Ep4Video = snap1Before.ep_4?.videoFile || '';
  const ss2Ep4Video = snap2Before.ep_4?.videoFile || '';
  record('same episode id exists in both folders with distinct video files',
    Boolean(ss1Ep4Video && ss2Ep4Video && ss1Ep4Video !== ss2Ep4Video),
    `ss1/ep_4=${path.basename(ss1Ep4Video)} vs ss2/ep_4=${path.basename(ss2Ep4Video)}`);

  // Pick un-demucsed episodes in ss2 so we never regenerate completed production episodes
  const ss2PendingDemucs = ['ep_6', 'ep_7', 'ep_8', 'ep_9', 'ep_10'].filter(
    (id) => snap2Before[id] && !snap2Before[id].isDemucsDone && !snap2Before[id].bgmAudioUrl
  );
  if (ss2PendingDemucs.length < 2) {
    throw new Error(`Need at least 2 un-demucsed episodes in ss2, found: ${ss2PendingDemucs.join(',')}`);
  }
  const targetBgmEps = ss2PendingDemucs.slice(0, 2);
  const primaryBgmEp = targetBgmEps[0];
  const primaryBgmAbsVideo = snap2Before[primaryBgmEp].sourceVideoPath;
  const primaryBgmCacheDir = getSeparationCacheDir(primaryBgmAbsVideo, 'htdemucs');

  // Ensure clean pre-state for target BGM episode cache
  const cacheFilesBefore = listFilesRecursive(primaryBgmCacheDir);
  const ss2EpBeforeFiles = listFilesRecursive(path.join(UPLOADS, 'ss2', 'episodes', primaryBgmEp));
  const ss1Ep4BeforeFiles = listFilesRecursive(path.join(UPLOADS, 'ss1', 'episodes', 'ep_4'));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err).slice(0, 300)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push('console: ' + msg.text().slice(0, 300));
  });

  const shot = async (name) => {
    shotIndex += 1;
    const file = path.join(ARTIFACT_DIR, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
    try { await page.screenshot({ path: file, fullPage: false }); } catch (_) {}
    return file;
  };

  const modal = () => page.locator('[data-testid="gemini-route-modal"]');
  const modalText = async () => modal().innerText({ timeout: 5000 }).catch(() => '');
  const navbarSeries = () => page.locator('[data-testid="navbar-series-select"]');
  const navbarEpisode = () => page.locator('[data-testid="navbar-episode-select"]');
  const step4Row = () => page.locator('[data-testid="step-row-demucs"]');
  const step4BadgeText = async () => page.locator('[data-testid="step4-status-badge"]').innerText({ timeout: 3000 }).catch(() => '');

  const selectionSummary = async () => {
    const text = await modalText();
    const match = text.match(/(\d+)\/(\d+)\s*selected/);
    return match ? { selected: Number(match[1]), total: Number(match[2]), raw: match[0] } : { selected: -1, total: -1, raw: '' };
  };

  const switchFolderInModal = async (seriesId, expectEpisodes) => {
    await navbarSeries().selectOption(seriesId);
    await page.waitForFunction(
      (sid) => document.querySelector('[data-testid="navbar-series-select"]')?.value === sid,
      seriesId,
      { timeout: 20000 }
    );
    if (expectEpisodes) {
      await pollUntil(`modal shows ${expectEpisodes} episodes for ${seriesId}`, async () => {
        const summary = await selectionSummary();
        return summary.total === expectEpisodes ? summary : null;
      }, 30000, 250);
    }
  };

  let tempTtsEpDir = null;
  let capturedDemucsPid = null;
  let capturedJobId = null;

  try {
    // ------------------------------------------------------------ fresh load
    console.log('\n=== PHASE 1: fresh load + folder selection match ===');
    const t0 = Date.now();
    await page.goto(FRONTEND + '/home', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="home-series-folder-"]').length >= 2,
      null,
      { timeout: 150000 }
    );
    const folderCount = await page.locator('[data-testid^="home-series-folder-"]').count();
    record('home lists all server folders', folderCount >= 2, `count=${folderCount} in ${Date.now() - t0}ms`);

    await switchFolderInModal('ss2', null);
    record('folder selection matches ss2 (navbar)', (await navbarSeries().inputValue()) === 'ss2', `navbar=${await navbarSeries().inputValue()}`);
    const homeText = await page.locator('body').innerText();
    record('home breadcrumb marks ss2 as opened folder', /ss2/.test(homeText), 'ss2 present');

    // ------------------------------------------------------------ batch modal
    console.log('\n=== PHASE 2: Batch Studio follows the selected folder ===');
    await page.locator('[data-testid="navbar-batch-generate-btn"]').click();
    await modal().waitFor({ state: 'visible', timeout: 20000 });
    await pollUntil('batch modal lists ss2 episodes', async () => (await selectionSummary()).total === 25, 45000, 250);
    record('batch studio loads ss2 (25 episodes)', true, JSON.stringify(await selectionSummary()));
    await shot('batch-ss2-open');

    await switchFolderInModal('ss1', 28);
    record('batch studio follows folder switch to ss1 (28 episodes)', true, JSON.stringify(await selectionSummary()));
    await switchFolderInModal('ss2', 25);
    record('batch studio returns to ss2 (25 episodes)', true, JSON.stringify(await selectionSummary()));

    // ------------------------------------------------------------ start long Clean BGM job (turbo Demucs)
    console.log(`\n=== PHASE 3: start long Step 4 Clean BGM on ss2 (${targetBgmEps.join(',')} turbo) ===`);
    await step4Row().click();
    const runBtn = page.locator('[data-testid="top-btn-run-demucs"]');
    await runBtn.waitFor({ state: 'visible', timeout: 15000 });
    const turboPresetBtn = modal().locator('button', { hasText: /Turbo/i }).first();
    await turboPresetBtn.waitFor({ state: 'visible', timeout: 10000 });
    await turboPresetBtn.click();
    record('Clean BGM long preset selected', true, 'turbo');

    const clearBtn = modal().locator('button', { hasText: 'ដកជ្រើសរើស' }).first();
    if (await clearBtn.count()) {
      await clearBtn.click();
      await pollUntil('selection cleared to 0', async () => (await selectionSummary()).selected === 0, 10000, 150);
    }
    for (const epId of targetBgmEps) {
      await page.locator(`[data-testid="ep-card-${epId}"]`).click({ position: { x: 12, y: 12 } });
    }
    const selection = await selectionSummary();
    record('un-demucsed ss2 episodes selected for Clean BGM',
      selection.selected === targetBgmEps.length && selection.total === 25, JSON.stringify(selection));

    await runBtn.click();

    await pollUntil('ss2 Clean BGM runner start', async () => /EP\d+\s*\/\s*\d+/.test(await step4BadgeText()), 30000, 250);
    record('ss2 Clean BGM batch runner reports running', true, `badge=${await step4BadgeText()}`);

    const progressWhileSs2 = await pollUntil('backend separation job for ss2', async () => {
      const p = await apiJson(`/api/audio/separation-progress?seriesId=ss2&episodeId=${primaryBgmEp}`);
      if (p && p.success && p.status === 'separating' && String(p.seriesId) === 'ss2' && p.jobId) return p;
      return null;
    }, 30000, 350);
    capturedJobId = progressWhileSs2.jobId;

    const pyProcs = await pollUntil('OS python.exe demucs_worker process running', async () => {
      const list = listDemucsPythonProcesses().filter((p) =>
        String(p.CommandLine || '').includes(path.basename(primaryBgmAbsVideo))
      );
      return list.length > 0 ? list : null;
    }, 15000, 350);
    capturedDemucsPid = pyProcs[0].ProcessId;

    record('Clean BGM process confirmed running at OS level before cancellation',
      Boolean(capturedDemucsPid && capturedJobId),
      `seriesId=ss2 episodeId=${primaryBgmEp} jobId=${capturedJobId} pid=${capturedDemucsPid}`);
    await shot('ss2-cleanbgm-running');

    // ------------------------------------------------------------ backend cross-scope probe
    console.log('\n=== PHASE 4: backend poll isolation ===');
    const ss1Poll = await apiJson(`/api/audio/separation-progress?videoPath=${encodeURIComponent(ss1Ep4Video)}`);
    const ss2JobVisibleToSs1 = Boolean(ss1Poll && ss1Poll.status === 'separating' && String(ss1Poll.seriesId) === 'ss2');
    record('ss1 video poll does not receive ss2 separation progress', !ss2JobVisibleToSs1,
      `status=${ss1Poll?.status} seriesId=${ss1Poll?.seriesId}`);

    const ss2ScopedPoll = await apiJson('/api/audio/separation-progress?seriesId=ss1&episodeId=ep_4');
    const ss1ScopeLeaksSs2 = Boolean(ss2ScopedPoll && ss2ScopedPoll.status === 'separating' && String(ss2ScopedPoll.seriesId) === 'ss2');
    record('seriesId-scoped poll for ss1 does not return ss2 job', !ss1ScopeLeaksSs2,
      `status=${ss2ScopedPoll?.status} seriesId=${ss2ScopedPoll?.seriesId}`);

    // ------------------------------------------------------------ switch to ss1 while running
    console.log('\n=== PHASE 5: switch to ss1 while ss2 keeps processing ===');
    await switchFolderInModal('ss1', 28);
    await page.locator('[data-testid="ep-card-ep_1"]').waitFor({ state: 'visible', timeout: 15000 });
    const ss1Badge = await step4BadgeText();
    const ss1Step4Text = await step4Row().innerText().catch(() => '');
    record('ss1 Clean BGM card is not running while ss2 works',
      !/EP\d+\s*\/\s*\d+/.test(ss1Badge) && !/\bStop\b/.test(ss1Step4Text), `badge=${ss1Badge}`);
    const ss1QueuedRows = await page.locator('[data-testid^="demucs-queued-row-"]').count();
    record('ss1 episode cards show no demucs queue/progress rows from ss2', ss1QueuedRows === 0, `rows=${ss1QueuedRows}`);
    const ss1ModalText = await modalText();
    const ss1Locked = /មិនអាចផ្លាស់ប្តូរការជ្រើសរើសបានទេ/.test(ss1ModalText) || /🔒/.test(ss1ModalText);
    record('ss1 selection is NOT locked by ss2 background job', !ss1Locked, `locked=${ss1Locked}`);

    const selBefore = await selectionSummary();
    await page.locator('[data-testid="ep-card-ep_1"]').click({ position: { x: 12, y: 12 } });
    const selAfter = await pollUntil('ss1 selection toggled', async () => {
      const s = await selectionSummary();
      return s.selected !== selBefore.selected ? s : null;
    }, 10000, 150);
    record('ss1 episode selection remains interactive during ss2 job',
      selBefore.selected !== selAfter.selected,
      `${JSON.stringify(selBefore)} -> ${JSON.stringify(selAfter)}`);
    await page.locator('[data-testid="ep-card-ep_1"]').click({ position: { x: 12, y: 12 } });
    await shot('ss1-while-ss2-running');

    // ------------------------------------------------------------ per-folder episode identity
    console.log('\n=== PHASE 6: EP3 / EP4 stay independent between folders ===');
    const ss1Ep3Text = await page.locator('[data-testid="ep-card-ep_3"]').innerText();
    const ss1Ep4Text = await page.locator('[data-testid="ep-card-ep_4"]').innerText();
    await switchFolderInModal('ss2', 25);
    await page.locator('[data-testid="ep-card-ep_4"]').waitFor({ state: 'visible', timeout: 15000 });
    const ss2Ep3Text = await page.locator('[data-testid="ep-card-ep_3"]').innerText();
    const ss2Ep4Text = await page.locator('[data-testid="ep-card-ep_4"]').innerText();
    record('EP4 script segment counts differ per folder (71 vs 46)',
      /71\s*ឃ្លា/.test(ss1Ep4Text) && /46\s*ឃ្លា/.test(ss2Ep4Text),
      `ss1=${(ss1Ep4Text.match(/(\d+)\s*ឃ្លា/) || [])[0]} ss2=${(ss2Ep4Text.match(/(\d+)\s*ឃ្លា/) || [])[0]}`);
    record('EP3 titles differ per folder (no shared episode identity)',
      /ភាគទី 3 \(EP3\)/.test(ss1Ep3Text) && /ss2_ep_3_source/.test(ss2Ep3Text),
      `ss1Title=${(ss1Ep3Text.split('\n')[1] || '').trim()} ss2Title=${(ss2Ep3Text.split('\n')[1] || '').trim()}`);

    // ------------------------------------------------------------ concurrent TTS in ss1 (non-production temp episode) while ss2 Clean BGM runs
    console.log('\n=== PHASE 7: concurrent TTS in ss1 + Clean BGM in ss2 (without touching completed production episodes) ===');
    const tempTtsEpId = 'ep_verify_tts';
    tempTtsEpDir = path.join(UPLOADS, 'ss1', 'episodes', tempTtsEpId);
    const ttsSegments = [
      { id: 1, start: '00:00:00,000', end: '00:00:02,000', khmer: 'សួស្តីអ្នកទាំងអស់គ្នា ថ្ងៃនេះយើងធ្វើតេស្តប្រព័ន្ធសំឡេង។', voiceId: 'km-KH-PisethNeural' },
      { id: 2, start: '00:00:02,200', end: '00:00:04,200', khmer: 'ប្រព័ន្ធដំណើរការដោយឯករាជ្យរវាងថតឯកសារទាំងពីរ។', voiceId: 'km-KH-SreymomNeural' },
      { id: 3, start: '00:00:04,500', end: '00:00:06,500', khmer: 'ការបញ្ឈប់ការងារនៅថតទីពីរ មិនប៉ះពាល់ថតទីមួយឡើយ។', voiceId: 'km-KH-PisethNeural' },
      { id: 4, start: '00:00:06,800', end: '00:00:08,800', khmer: 'សូមពិនិត្យមើលដំណើរការបង្កើតសំឡេងខ្មែរឥឡូវនេះ។', voiceId: 'km-KH-SreymomNeural' },
      { id: 5, start: '00:00:09,000', end: '00:00:11,000', khmer: 'ឃ្លាទីប្រាំសម្រាប់ផ្ទៀងផ្ទាត់ដំណើរការព្រមគ្នា។', voiceId: 'km-KH-PisethNeural' },
      { id: 6, start: '00:00:11,200', end: '00:00:13,200', khmer: 'ឃ្លាទីប្រាំមួយបញ្ចប់ការសំយោគសំឡេងដោយជោគជ័យ។', voiceId: 'km-KH-SreymomNeural' },
    ];
    const ttsPromise = fetch(`${BACKEND}/api/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId: 'ss1',
        episodeId: tempTtsEpId,
        segments: ttsSegments,
        voiceId: 'km-KH-PisethNeural',
        forceRegen: true,
        concurrency: 2,
      }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
      .catch((e) => ({ error: e.message }));

    const ttsRunningSnap = await pollUntil('ss1 TTS job active concurrently', async () => {
      const p = await apiJson(`/api/tts/progress?seriesId=ss1&episodeId=${tempTtsEpId}&total=${ttsSegments.length}`);
      return (p && p.isRunning) ? p : null;
    }, 20000, 150);

    const ss2StillRunningDuringTts = await apiJson(`/api/audio/separation-progress?seriesId=ss2&episodeId=${primaryBgmEp}`);
    const ss1SepDuringTts = await apiJson(`/api/audio/separation-progress?seriesId=ss1&episodeId=${tempTtsEpId}`);
    const ss2TtsDuringTts = await apiJson(`/api/tts/progress?seriesId=ss2&episodeId=${primaryBgmEp}`);
    record('concurrent TTS in ss1 and Clean BGM in ss2 active simultaneously',
      Boolean(ttsRunningSnap?.isRunning && ss2StillRunningDuringTts?.status === 'separating' &&
        ss1SepDuringTts?.status === 'idle' && !ss2TtsDuringTts?.isRunning),
      `ss1TTS=${ttsRunningSnap?.current}/${ttsRunningSnap?.total} ss2BGM=${ss2StillRunningDuringTts?.progress}% pid=${capturedDemucsPid}`);

    // ------------------------------------------------------------ stop ss2 job and verify exact PID killed & zero further writes
    console.log('\n=== PHASE 8: stop ss2 job, verify exact PID terminated, zero further writes, ss1 TTS unaffected ===');
    const stillAliveBeforeStop = listDemucsPythonProcesses().some((p) => p.ProcessId === capturedDemucsPid);
    record('ss2 Clean BGM OS process still alive immediately before Stop click', stillAliveBeforeStop, `pid=${capturedDemucsPid}`);

    const stopBtn = page.locator('[data-testid="top-btn-stop-demucs"]');
    const activeStage = await step4Row().getAttribute('data-active-stage').catch(() => null);
    const badgeBeforeStop = await step4BadgeText();
    const overviewTabDemucs = page.locator('[data-testid="top-stage-tab-demucs"]');
    console.log(`  [Phase 8 UI check] activeStage=${activeStage} step4Badge=${badgeBeforeStop} overviewTabVisible=${await overviewTabDemucs.isVisible().catch(() => false)}`);
    if (await overviewTabDemucs.isVisible().catch(() => false)) {
      await overviewTabDemucs.click();
    } else if (activeStage !== 'true') {
      await step4Row().click();
    }
    const focusToolbarText = await page.locator('[data-testid="stage-focus-toolbar"]').innerText().catch(() => 'NO_FOCUS_TOOLBAR');
    console.log(`  [Phase 8 after click] activeStage=${await step4Row().getAttribute('data-active-stage').catch(() => null)} toolbar=${JSON.stringify(focusToolbarText)}`);
    await stopBtn.waitFor({ state: 'visible', timeout: 10000 });
    const killRespPromise = page.waitForResponse(
      (res) => res.url().includes('/api/audio/separate-kill') && res.request().method() === 'POST',
      { timeout: 20000 }
    );
    await stopBtn.click();
    const killHttpResp = await killRespPromise;
    const killJson = await killHttpResp.json().catch(() => ({}));
    const killedCount = Number(killJson?.result?.killed || 0);

    await pollUntil('ss2 Clean BGM runner stops in UI', async () => !/EP\d+\s*\/\s*\d+/.test(await step4BadgeText()), 20000, 200);
    const pidDead = await pollUntil('exact ss2 python.exe PID exited', async () => {
      const alive = listDemucsPythonProcesses().some((p) => p.ProcessId === capturedDemucsPid);
      return !alive;
    }, 15000, 200);

    record('Stop terminates the exact ss2 Clean BGM PID (killed >= 1)',
      killJson?.success === true && killedCount >= 1 && pidDead,
      `pid=${capturedDemucsPid} jobId=${capturedJobId} killResponse=${JSON.stringify(killJson)}`);

    // Check zero further output writes over a verification window
    const cacheAfterKill1 = listFilesRecursive(primaryBgmCacheDir);
    const ss2EpAfterKill1 = listFilesRecursive(path.join(UPLOADS, 'ss2', 'episodes', primaryBgmEp));
    await new Promise((r) => setTimeout(r, 2000));
    const cacheAfterKill2 = listFilesRecursive(primaryBgmCacheDir);
    const ss2EpAfterKill2 = listFilesRecursive(path.join(UPLOADS, 'ss2', 'episodes', primaryBgmEp));
    const ss2AfterCancelMeta = episodeSnapshot(await apiJson('/api/series/ss2'));
    const hasStemWritten = fs.existsSync(path.join(primaryBgmCacheDir, 'no_vocals.wav')) ||
      fs.existsSync(path.join(primaryBgmCacheDir, 'vocals.wav'));
    const lateCacheWrites = diffChangedFiles(cacheAfterKill1, cacheAfterKill2);
    const lateEpWrites = diffChangedFiles(ss2EpAfterKill1, ss2EpAfterKill2);

    record('cancellation prevents further output writes to cache and episode dir',
      !hasStemWritten && lateCacheWrites.length === 0 && lateEpWrites.length === 0 && !ss2AfterCancelMeta[primaryBgmEp]?.isDemucsDone,
      `hasStem=${hasStemWritten} lateCacheWrites=${lateCacheWrites.length} lateEpWrites=${lateEpWrites.length}`);
    await shot('ss2-after-stop');

    const ttsFinal = await ttsPromise;
    record('ss1 concurrent TTS completes unaffected after ss2 Clean BGM stop',
      Boolean(ttsFinal && ttsFinal.status === 200 && ttsFinal.body?.success !== false),
      JSON.stringify(ttsFinal?.body || ttsFinal).slice(0, 140));

    // Clean up temporary non-production TTS episode right after Phase 8 so Phase 10B sees exact 28 episodes in ss1
    await fetch(`${BACKEND}/api/series/ss1/episodes/${tempTtsEpId}`, { method: 'DELETE' }).catch(() => {});
    if (tempTtsEpDir && fs.existsSync(tempTtsEpDir)) {
      try { fs.rmSync(tempTtsEpDir, { recursive: true, force: true }); } catch (_) {}
    }

    // Close Batch modal and navigate to /studio for 20x workspace switching verification
    const closeModalBtn = modal().locator('button[aria-label="Close"], button:has-text("បិទ"), button:has-text("✕")').first();
    if (await closeModalBtn.count()) {
      await closeModalBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await modal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

    // ------------------------------------------------------------ 20x folder switches in Studio workspace
    console.log('\n=== PHASE 9: 20x switching between ss1 and ss2 on identical episode ID (ep_4) ===');
    await page.locator('[data-testid="navbar-studio-route-btn"]').click();
    await navbarSeries().waitFor({ state: 'visible', timeout: 20000 });

    // Bind ep_4 as the remembered episode in both ss1 and ss2 and capture ground-truth waveform baselines
    const baselines = {};
    for (const sid of ['ss1', 'ss2']) {
      await navbarSeries().selectOption(sid);
      await page.waitForFunction(
        (expected) => document.querySelector('[data-testid="navbar-series-select"]')?.value === expected,
        sid,
        { timeout: 20000 }
      );
      await navbarEpisode().selectOption('ep_4');
      await page.waitForFunction(
        (expected) => {
          const v = document.querySelector('[data-testid="player-stage-viewport"] video');
          const ep = document.querySelector('[data-testid="navbar-episode-select"]');
          return ep?.value === 'ep_4' && v?.getAttribute('src')?.includes(`/projects/${expected}/episodes/ep_4/`);
        },
        sid,
        { timeout: 20000 }
      );
      // Open អត្ថបទ (subtitles/script) tab in left panel
      const scriptTab = page.locator('button[role="tab"]', { hasText: 'អត្ថបទ' }).first();
      await scriptTab.click();
      await page.waitForFunction(
        (expectedText) => {
          const block = document.querySelector('.voice-segment-block[data-segment-id]');
          const wave = document.querySelector('.voice-segment-block .voice-waveform-bars path.waveform-bar');
          const ta = document.querySelector('.script-review-panel textarea, .subtitle-editor-list textarea, textarea');
          return Boolean(block && wave?.getAttribute('d') && ta && ta.value.includes(expectedText));
        },
        sid === 'ss1' ? 'អាល្អិត' : 'ស៊ូ មីង',
        { timeout: 20000 }
      );
      baselines[sid] = await page.evaluate(() => {
        const wave = document.querySelector('.voice-segment-block .voice-waveform-bars path.waveform-bar');
        const scriptTabBtn = Array.from(document.querySelectorAll('button[role="tab"]')).find((b) => b.textContent.includes('អត្ថបទ'));
        return {
          waveD: wave ? wave.getAttribute('d') : '',
          badge: scriptTabBtn?.querySelector('.tab-badge')?.textContent?.trim() || '',
        };
      });
    }

    let switchFailures = 0;
    const switchFailureDetails = [];
    for (let i = 0; i < 20; i += 1) {
      const target = i % 2 === 0 ? 'ss1' : 'ss2';
      const other = target === 'ss1' ? 'ss2' : 'ss1';
      const expectedText = target === 'ss1' ? 'អាល្អិត' : 'ស៊ូ មីង';
      const expectedSegCount = target === 'ss1' ? '71' : '46';
      const expectedBgmHash = target === 'ss1' ? 'cb11fe8b86b6315ada059ce941e9cf33' : '839f22ec5e07410e57655c74a18ab129';
      const foreignBgmHash = target === 'ss1' ? '839f22ec5e07410e57655c74a18ab129' : 'cb11fe8b86b6315ada059ce941e9cf33';

      await navbarSeries().selectOption(target);
      try {
        await page.waitForFunction(
          ({ t, expTxt, expBadge }) => {
            const sVal = document.querySelector('[data-testid="navbar-series-select"]')?.value;
            const epVal = document.querySelector('[data-testid="navbar-episode-select"]')?.value;
            const vSrc = document.querySelector('[data-testid="player-stage-viewport"] video')?.getAttribute('src') || '';
            const taVal = document.querySelector('textarea')?.value || '';
            const blockTitle = document.querySelector('.voice-segment-block[data-segment-id]')?.getAttribute('title') || '';
            const waveD = document.querySelector('.voice-segment-block .voice-waveform-bars path.waveform-bar')?.getAttribute('d') || '';
            const scriptTabBtn = Array.from(document.querySelectorAll('button[role="tab"]')).find((b) => b.textContent.includes('អត្ថបទ'));
            const badge = scriptTabBtn?.querySelector('.tab-badge')?.textContent?.trim() || '';
            return sVal === t && epVal === 'ep_4' && vSrc.includes(`/projects/${t}/episodes/ep_4/`) &&
              badge === expBadge && taVal.includes(expTxt) && blockTitle.includes(expTxt) && Boolean(waveD);
          },
          { t: target, expTxt: expectedText, expBadge: expectedSegCount },
          { timeout: 20000 }
        );
      } catch (err) {
        const failSnap = await page.evaluate(() => {
          const sVal = document.querySelector('[data-testid="navbar-series-select"]')?.value;
          const epVal = document.querySelector('[data-testid="navbar-episode-select"]')?.value;
          const vSrc = document.querySelector('[data-testid="player-stage-viewport"] video')?.getAttribute('src') || '';
          const taVal = document.querySelector('textarea')?.value?.slice(0, 30) || '';
          const blockTitle = document.querySelector('.voice-segment-block[data-segment-id]')?.getAttribute('title')?.slice(0, 40) || '';
          const waveD = document.querySelector('.voice-segment-block .voice-waveform-bars path.waveform-bar')?.getAttribute('d')?.slice(0, 30) || '';
          const scriptTabBtn = Array.from(document.querySelectorAll('button[role="tab"]')).find((b) => b.textContent.includes('អត្ថបទ'));
          const badge = scriptTabBtn?.querySelector('.tab-badge')?.textContent?.trim() || '';
          return { sVal, epVal, vSrc, taVal, blockTitle, waveD, badge };
        }).catch(() => ({}));
        switchFailures += 1;
        switchFailureDetails.push(`iter ${i} (${target}): ${err.message} snap=${JSON.stringify(failSnap)}`);
        continue;
      }

      const domCheck = await page.evaluate(() => {
        const sVal = document.querySelector('[data-testid="navbar-series-select"]')?.value || '';
        const epVal = document.querySelector('[data-testid="navbar-episode-select"]')?.value || '';
        const vSrc = document.querySelector('[data-testid="player-stage-viewport"] video')?.getAttribute('src') || '';
        const audioSrcs = Array.from(document.querySelectorAll('[data-testid="player-stage-viewport"] audio')).map((a) => a.getAttribute('src') || '');
        const taVal = document.querySelector('textarea')?.value || '';
        const blockTitle = document.querySelector('.voice-segment-block[data-segment-id]')?.getAttribute('title') || '';
        const waveD = document.querySelector('.voice-segment-block .voice-waveform-bars path.waveform-bar')?.getAttribute('d') || '';
        const scriptTabBtn = Array.from(document.querySelectorAll('button[role="tab"]')).find((b) => b.textContent.includes('អត្ថបទ'));
        const badge = scriptTabBtn?.querySelector('.tab-badge')?.textContent?.trim() || '';
        const batchTitle = document.querySelector('[data-testid="navbar-batch-generate-btn"]')?.getAttribute('title') || '';
        return { sVal, epVal, vSrc, audioSrcs, taVal, blockTitle, waveD, badge, batchTitle };
      });

      const sepProg = await apiJson(`/api/audio/separation-progress?seriesId=${target}&episodeId=ep_4`);
      const ttsProg = await apiJson(`/api/tts/progress?seriesId=${target}&episodeId=ep_4`);

      const okAudio = !domCheck.audioSrcs.some((u) => u.includes(foreignBgmHash)) &&
        (domCheck.audioSrcs.length === 0 || domCheck.audioSrcs.some((u) => u.includes(expectedBgmHash)));
      const okWave = domCheck.waveD === baselines[target].waveD && domCheck.waveD !== baselines[other].waveD;
      const okProgress = sepProg?.status === 'idle' && !ttsProg?.isRunning && !/កំពុងដំណើរការ/.test(domCheck.batchTitle);

      if (!okAudio || !okWave || !okProgress || domCheck.sVal !== target || domCheck.epVal !== 'ep_4' ||
        !domCheck.vSrc.includes(`/projects/${target}/episodes/ep_4/`) || domCheck.badge !== expectedSegCount ||
        !domCheck.taVal.includes(expectedText) || !domCheck.blockTitle.includes(expectedText)) {
        switchFailures += 1;
        switchFailureDetails.push(`iter ${i} (${target}): mismatch ${JSON.stringify({ okAudio, okWave, okProgress, domCheck })}`);
      }
    }
    record('20 folder switches verify video, script, audio, waveform, timeline, selected episode, and progress',
      switchFailures === 0,
      `failures=${switchFailures}${switchFailureDetails.length ? ' ' + switchFailureDetails[0] : ''}`);
    await shot('studio-after-20-switches');

    // ------------------------------------------------------------ reload persistence without duplicate jobs
    console.log('\n=== PHASE 10: reload persistence without duplicate jobs ===');
    const jobsBeforeReload = await apiJson('/api/jobs?filter=running');
    const activeIdBeforeReload = await page.evaluate(() => localStorage.getItem('KHMER_AI_ACTIVE_SERIES_ID'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navbarSeries().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="navbar-series-select"]')?.value === 'ss2' &&
        document.querySelector('[data-testid="navbar-episode-select"]')?.value === 'ep_4',
      null,
      { timeout: 30000 }
    );
    const jobsAfterReload = await apiJson('/api/jobs?filter=running');
    record('reload restores ss2 + ep_4 without duplicate jobs',
      (await navbarSeries().inputValue()) === 'ss2' && (await navbarEpisode().inputValue()) === 'ep_4' &&
      (jobsBeforeReload.total || 0) === 0 && (jobsAfterReload.total || 0) === 0,
      `beforeReload=${activeIdBeforeReload} navbar=${await navbarSeries().inputValue()}/${await navbarEpisode().inputValue()} runningJobs=${jobsAfterReload.total}`);

    // ------------------------------------------------------------ backend restart persistence without duplicate jobs
    console.log('\n=== PHASE 10B: backend restart persistence without duplicate jobs ===');
    const bootRestartTestServer = async (port) => {
      const bootScript = [
        `const { app } = require('./backend/server.js');`,
        `const { uploadsDir } = require('./backend/utils/pathUtils.js');`,
        `const { productionJobQueue } = require('./backend/services/pipeline/productionJobQueue.js');`,
        `const { ensurePipelineWorkerRegistered } = require('./backend/services/pipeline/jobWorker.js');`,
        `productionJobQueue.recoverDanglingJobs({ baseUploadsDir: uploadsDir });`,
        `ensurePipelineWorkerRegistered(productionJobQueue);`,
        `const srv = app.listen(${port}, '127.0.0.1', () => console.log('RESTART_TEST_READY'));`,
        `process.on('SIGTERM', () => { srv.close(() => process.exit(0)); });`,
      ].join(' ');
      const child = spawn(process.execPath, ['-e', bootScript], {
        cwd: REPO_ROOT,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        await pollUntil(`test backend listening on :${port}`, async () => {
          const r = await fetch(`http://127.0.0.1:${port}/api/jobs?filter=running`).catch(() => null);
          return r && r.ok ? await r.json() : null;
        }, 25000, 250);
        const allJobsRes = await fetch(`http://127.0.0.1:${port}/api/jobs`).then((r) => r.json());
        const runningRes = await fetch(`http://127.0.0.1:${port}/api/jobs?filter=running`).then((r) => r.json());
        const s1Res = await fetch(`http://127.0.0.1:${port}/api/series/ss1`).then((r) => r.json());
        const s2Res = await fetch(`http://127.0.0.1:${port}/api/series/ss2`).then((r) => r.json());
        return {
          totalJobs: Number(allJobsRes?.total || (allJobsRes?.jobs || []).length),
          jobIds: (allJobsRes?.jobs || []).map((j) => j.jobId),
          runningJobs: Number(runningRes?.total || 0),
          ss1Count: readEpisodeArray(s1Res).length,
          ss2Count: readEpisodeArray(s2Res).length,
        };
      } finally {
        try { child.kill('SIGKILL'); } catch (_) {}
        await new Promise((r) => setTimeout(r, 400));
      }
    };
    const boot1 = await bootRestartTestServer(5099);
    const boot2 = await bootRestartTestServer(5099);
    const uniqueIdsBoot2 = new Set(boot2.jobIds);
    record('backend restart preserves series and job state without duplicate jobs',
      boot1.totalJobs === boot2.totalJobs &&
      uniqueIdsBoot2.size === boot2.jobIds.length &&
      boot1.runningJobs === 0 && boot2.runningJobs === 0 &&
      boot1.ss1Count === 28 && boot2.ss1Count === 28 &&
      boot1.ss2Count === 25 && boot2.ss2Count === 25,
      `boot1Jobs=${boot1.totalJobs} boot2Jobs=${boot2.totalJobs} uniqueIds=${uniqueIdsBoot2.size} running=${boot1.runningJobs}/${boot2.runningJobs} ss1=${boot2.ss1Count} ss2=${boot2.ss2Count}`);

    // ------------------------------------------------------------ filesystem write isolation
    console.log('\n=== PHASE 11: server-truth + filesystem write isolation ===');
    const ss1After = await apiJson('/api/series/ss1');
    const ss2After = await apiJson('/api/series/ss2');
    const snap1After = episodeSnapshot(ss1After);
    const snap2After = episodeSnapshot(ss2After);

    const ss1Ep4AfterFiles = listFilesRecursive(path.join(UPLOADS, 'ss1', 'episodes', 'ep_4'));
    const ss1Changes = diffChangedFiles(ss1Ep4BeforeFiles, ss1Ep4AfterFiles);
    const ss1ProdMutated = Object.keys(snap1Before).some((id) =>
      snap1Before[id].fullAudioUrl !== snap1After[id]?.fullAudioUrl ||
      snap1Before[id].bgmAudioUrl !== snap1After[id]?.bgmAudioUrl ||
      snap1Before[id].cleanBgmPath !== snap1After[id]?.cleanBgmPath ||
      snap1Before[id].isDemucsDone !== snap1After[id]?.isDemucsDone ||
      snap1Before[id].audioGenerated !== snap1After[id]?.audioGenerated ||
      snap1Before[id].segments !== snap1After[id]?.segments ||
      snap1Before[id].videoFile !== snap1After[id]?.videoFile ||
      snap1Before[id].title !== snap1After[id]?.title
    );
    record('completed ss1 production episodes untouched and zero cross-folder writes',
      ss1Changes.length === 0 && !ss1ProdMutated,
      `ss1Ep4Changes=${ss1Changes.length} ss1ProdMutated=${ss1ProdMutated}`);

    const cacheAfterAll = listFilesRecursive(primaryBgmCacheDir);
    record('cancelled ss2 Clean BGM left zero stems in cache',
      diffChangedFiles(cacheFilesBefore, cacheAfterAll).length === 0 &&
      !fs.existsSync(path.join(primaryBgmCacheDir, 'no_vocals.wav')),
      `cacheFiles=${cacheAfterAll.length}`);

    const realPageErrors = pageErrors.filter((e) => !/net::ERR_ABORTED|Failed to load resource: the server responded with a status of 404/i.test(e));
    record('no unexpected browser page errors during verification', realPageErrors.length === 0,
      realPageErrors.length ? JSON.stringify(realPageErrors.slice(0, 4)) : 'none');

    await shot('final-state');
  } finally {
    try {
      await fetch(`${BACKEND}/api/tts/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId: 'ss1', episodeId: 'ep_verify_tts' }),
      });
      await new Promise((r) => setTimeout(r, 400));
      await fetch(`${BACKEND}/api/series/ss1/episodes/ep_verify_tts`, { method: 'DELETE' });
    } catch (_) {}
    if (tempTtsEpDir && fs.existsSync(tempTtsEpDir)) {
      try { fs.rmSync(tempTtsEpDir, { recursive: true, force: true }); } catch (_) {}
    }
    await browser.close().catch(() => {});
    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      results,
    };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    console.log('\n=== SUMMARY ===');
    console.log(`PASS ${report.passed} / ${report.passed + report.failed}`);
    console.log(`artifacts: ${ARTIFACT_DIR}`);
    if (report.failed > 0) process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error('\n[FATAL]', err && err.stack ? err.stack : err);
  results.push({ name: 'script completed without fatal error', pass: false, detail: String(err && err.message ? err.message : err) });
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), JSON.stringify({
      startedAt, finishedAt: new Date().toISOString(),
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      results,
    }, null, 2));
  } catch (_) {}
  process.exit(1);
});
