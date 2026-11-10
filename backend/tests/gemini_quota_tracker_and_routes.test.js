const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');
const express = require('express');
const { pathToFileURL } = require('node:url');

const {
  GeminiQuotaTracker,
  geminiQuotaTracker,
  getKeyFingerprint,
  getPacificDateKey,
  getNextPacificMidnightMs,
  parseGeminiRateLimitDetails,
} = require('../services/geminiQuotaTracker');
const {
  GEMINI_MODEL_CATALOG,
  DUBBING_CASCADE_MODELS,
  VISION_CASCADE_MODELS,
  isUsableDubbingModel,
} = require('../services/geminiModelCatalog');
const systemRoutes = require('../routes/systemRoutes');

test('parseGeminiRateLimitDetails distinguishes RPM retryDelay vs Daily RPD limit', () => {
  const now = Date.UTC(2026, 10, 10, 4, 0, 0);
  const rpmErr = {
    status: 429,
    message: '429 RESOURCE_EXHAUSTED: Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests. Please retry in 34.074s.',
  };
  const rpmParsed = parseGeminiRateLimitDetails(rpmErr, now);
  assert.equal(rpmParsed.cooldownType, 'rpm_limit');
  assert.equal(rpmParsed.isDaily, false);
  assert.equal(rpmParsed.retryAfterSec, 35);

  const rpdErr = {
    status: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. * Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier, limit: 500, model: gemini-3.5-flash-lite.',
  };
  const rpdParsed = parseGeminiRateLimitDetails(rpdErr, now);
  assert.equal(rpdParsed.cooldownType, 'rpd_limit');
  assert.equal(rpdParsed.isDaily, true);
  assert.ok(rpdParsed.cooldownUntil >= getNextPacificMidnightMs(now));
  assert.match(rpdParsed.sanitizedMessage, /limit:\s*500/i);
});

test('GeminiQuotaTracker tracks rolling 1m RPM, daily tokens, 429 exhaustion, and PT rollover without storing raw keys', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota_tracker_test_'));
  const storeFile = path.join(tmpDir, 'gemini_quota_usage.json');

  try {
    const k1 = 'AIzaSyTestKeyOne_1234567890_uB8A';
    const k2 = 'AIzaSyTestKeyTwo_1234567890_I64w';
    const t0 = Date.UTC(2026, 10, 10, 12, 0, 0); // Nov 10 04:00 PST
    const tracker = new GeminiQuotaTracker({ storagePath: storeFile, persistEnabled: true, now: t0 });

    tracker.recordSuccess(k1, { model: 'gemini-3.5-flash-lite', totalTokens: 1250, latencyMs: 320, now: t0 });
    tracker.recordSuccess(k1, { model: 'gemini-3.5-flash-lite', totalTokens: 750, latencyMs: 280, now: t0 + 5000 });
    tracker.recordRateLimit(
      k2,
      { status: 429, message: '429 RESOURCE_EXHAUSTED: Please retry in 30s' },
      { model: 'gemini-3.5-flash-lite', now: t0 + 6000 }
    );

    const snap = tracker.getPoolStatusSnapshot([k1, k2], { now: t0 + 10000 });
    assert.equal(snap.totalKeys, 2);
    assert.equal(snap.activeCount, 1);
    assert.equal(snap.keys[0].status, 'ready');
    assert.equal(snap.keys[0].rpmUsed, 2);
    assert.equal(snap.keys[0].rpmLeft, 13);
    assert.equal(snap.keys[0].todayRequests, 2);
    assert.equal(snap.keys[0].todayTokens, 2000);
    assert.equal(snap.keys[0].masked, '...uB8A');

    assert.equal(snap.keys[1].status, 'rate_limited');
    assert.equal(snap.keys[1].rpmLeft, 0);
    assert.ok(snap.keys[1].cooldownSec >= 25 && snap.keys[1].cooldownSec <= 26);

    assert.equal(snap.quotaSummary.todayTokens, 2000);
    assert.equal(snap.quotaSummary.cooldownKeys, 1);
    assert.equal(snap.quotaSummary.readyKeys, 1);

    // Ensure raw keys are NEVER written to disk
    tracker._writeNow();
    const rawSaved = fs.readFileSync(storeFile, 'utf8');
    assert.equal(rawSaved.includes(k1), false, 'Must NEVER persist raw API key 1');
    assert.equal(rawSaved.includes(k2), false, 'Must NEVER persist raw API key 2');
    assert.equal(rawSaved.includes(getKeyFingerprint(k1).keyId), true);

    // Reload cleanly from disk and verify RPM expiry after 65s + cooldown recovery
    const later = t0 + 70000;
    const reloaded = new GeminiQuotaTracker({ storagePath: storeFile, persistEnabled: true, now: later });
    const snapLater = reloaded.getPoolStatusSnapshot([k1, k2], { now: later });
    assert.equal(snapLater.activeCount, 2);
    assert.equal(snapLater.keys[0].rpmUsed, 0);
    assert.equal(snapLater.keys[1].status, 'ready');
    assert.equal(snapLater.keys[0].todayTokens, 2000, 'Same-day tokens survive reload');

    // Verify daily rollover on next Pacific Time day
    const nextPtDay = getNextPacificMidnightMs(t0) + 5000;
    assert.notEqual(getPacificDateKey(t0), getPacificDateKey(nextPtDay));
    const snapNextDay = reloaded.getPoolStatusSnapshot([k1, k2], { now: nextPtDay });
    assert.equal(snapNextDay.keys[0].todayRequests, 0);
    assert.equal(snapNextDay.keys[0].todayTokens, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HTTP GET /api/gemini/keys-status?probe=live|matrix & POST /api/gemini/quota-settings handle 429 vs 200, matrix probing, and preferredModel persistence', async () => {
  const prevEnvKeys = process.env.GEMINI_API_KEYS;
  const origFetch = global.fetch;

  // Snapshot live singleton tracker state so HTTP mock tests never corrupt real runtime telemetry
  const prevPersistEnabled = geminiQuotaTracker.persistEnabled;
  const prevSettings = { ...geminiQuotaTracker.settings };
  const prevPacificDate = geminiQuotaTracker.pacificDate;
  const prevKeys = new Map(
    Array.from(geminiQuotaTracker.keys.entries()).map(([k, v]) => [k, structuredClone(v)])
  );
  const prevModels = new Map(
    Array.from(geminiQuotaTracker.models.entries()).map(([k, v]) => [k, structuredClone(v)])
  );
  geminiQuotaTracker.persistEnabled = false;
  geminiQuotaTracker.keys.clear();
  geminiQuotaTracker.models.clear();
  geminiQuotaTracker.settings.preferredModel = 'auto';

  process.env.GEMINI_API_KEYS = [
    'AIzaSyMockHttpKey1_ValidLen_1111',
    'AIzaSyMockHttpKey2_ValidLen_2222',
  ].join(',');

  global.fetch = async (url) => {
    const strUrl = String(url);
    if (strUrl.includes('gemini-3.7-flash')) {
      return {
        status: 503,
        text: async () => JSON.stringify({ error: { code: 503, message: 'High demand / busy' } }),
      };
    }
    if (strUrl.includes('gemini-3.6-flash') || strUrl.includes('gemini-3.5-transcribe')) {
      return {
        status: 200,
        text: async () => JSON.stringify({ usageMetadata: { totalTokenCount: 2 } }),
      };
    }
    if (strUrl.includes('1111')) {
      return {
        status: 200,
        text: async () => JSON.stringify({ usageMetadata: { totalTokenCount: 2 } }),
      };
    }
    return {
      status: 429,
      text: async () =>
        JSON.stringify({
          error: {
            code: 429,
            message: 'Quota exceeded for GenerateRequestsPerDayPerProjectPerModel-FreeTier.',
          },
        }),
    };
  };

  const app = express();
  app.use(express.json());
  app.use('/api', systemRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const requestJson = (method, routePath, bodyObj = null) =>
      new Promise((resolve, reject) => {
        const payload = bodyObj ? JSON.stringify(bodyObj) : null;
        const req = http.request(
          `http://127.0.0.1:${port}${routePath}`,
          {
            method,
            headers: payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : undefined,
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
      });

    const liveRes = await requestJson('GET', '/api/gemini/keys-status?probe=live');
    assert.equal(liveRes.status, 200);
    assert.equal(liveRes.json.success, true);
    assert.equal(liveRes.json.probeMode, 'live');
    assert.equal(liveRes.json.totalKeys, 2);
    assert.equal(liveRes.json.activeCount, 1);

    const k1 = liveRes.json.keys.find((k) => k.masked === '...1111');
    const k2 = liveRes.json.keys.find((k) => k.masked === '...2222');
    assert.equal(k1.status, 'ready');
    assert.equal(k1.lastProbeCode, 200);
    assert.equal(k2.status, 'daily_exhausted');
    assert.equal(k2.isRateLimited, true);
    assert.equal(k2.dailyLeft, 0);
    assert.equal(liveRes.json.quotaSummary.dailyExhaustedKeys, 1);

    // Probe full model matrix with allModels=true (should probe transcribe too & report 503 on 3.7-flash + 200 on 3.6-flash)
    const matrixRes = await requestJson('GET', '/api/gemini/keys-status?probe=matrix&allModels=true');
    assert.equal(matrixRes.status, 200);
    assert.equal(matrixRes.json.probeMode, 'matrix');
    assert.equal(matrixRes.json.poolMultiplier, 2);
    assert.equal(matrixRes.json.modelRateLimits.length, GEMINI_MODEL_CATALOG.length);

    const row36 = matrixRes.json.modelRateLimits.find((m) => m.id === 'gemini-3.6-flash');
    const row37 = matrixRes.json.modelRateLimits.find((m) => m.id === 'gemini-3.7-flash');
    const rowTranscribe = matrixRes.json.modelRateLimits.find((m) => m.id === 'gemini-3.5-transcribe');
    assert.equal(row36.liveStatus, 'ready');
    assert.equal(row36.pool.rpmLimit, 10, '5 RPM * 2 keys');
    assert.equal(row36.pool.rpdLimit, 40, '20 RPD * 2 keys');
    assert.equal(row37.liveStatus, 'busy', 'HTTP 503 should show busy status');
    assert.equal(rowTranscribe.usableInDubbing, false);
    assert.equal(rowTranscribe.liveStatus, 'ready');

    // Test POST /api/gemini/quota-settings persisting Safe Pacing, daily cap, valid preferredModel & ignoring non-dubbing model
    const settingsRes = await requestJson('POST', '/api/gemini/quota-settings', {
      useAllKeysFast: false,
      dailyRpdPerKey: 250,
      preferredModel: 'gemini-3.6-flash',
      resetDailyStats: true,
    });
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.json.settings.useAllKeysFast, false);
    assert.equal(settingsRes.json.settings.dailyRpdPerKey, 250);
    assert.equal(settingsRes.json.settings.preferredModel, 'gemini-3.6-flash');
    assert.equal(settingsRes.json.activeCount, 2);
    assert.equal(settingsRes.json.quotaSummary.dailyTotal, 500);

    // Reject STT-only model cleanly from becoming preferred dubbing model
    const ignoreInvalidPref = await requestJson('POST', '/api/gemini/quota-settings', {
      preferredModel: 'gemini-3.5-transcribe',
    });
    assert.equal(ignoreInvalidPref.status, 200);
    assert.equal(ignoreInvalidPref.json.settings.preferredModel, 'gemini-3.6-flash');
  } finally {
    global.fetch = origFetch;
    if (prevEnvKeys === undefined) delete process.env.GEMINI_API_KEYS;
    else process.env.GEMINI_API_KEYS = prevEnvKeys;

    geminiQuotaTracker.persistEnabled = prevPersistEnabled;
    geminiQuotaTracker.settings = prevSettings;
    geminiQuotaTracker.pacificDate = prevPacificDate;
    geminiQuotaTracker.keys = prevKeys;
    geminiQuotaTracker.models = prevModels;

    await new Promise((resolve) => server.close(resolve));
  }
});

test('GeminiQuotaTracker isolates per-(key, model) 429 cooldowns and prioritizes healthy backup models', () => {
  const k1 = 'AIzaSyTestIsolation_1111';
  const k2 = 'AIzaSyTestIsolation_2222';
  const t0 = Date.UTC(2026, 10, 10, 12, 0, 0);
  const tracker = new GeminiQuotaTracker({ persistEnabled: false, now: t0 });

  assert.equal(DUBBING_CASCADE_MODELS.length, 10);
  assert.equal(DUBBING_CASCADE_MODELS.includes('gemini-3.5-transcribe'), false);
  assert.equal(isUsableDubbingModel('gemini-3.5-transcribe'), false);
  assert.equal(VISION_CASCADE_MODELS[1], 'gemini-2.5-flash');

  // Mark primary Flash-Lite models 429 RPD exhausted on both keys, plus stale 503 on 3.6-flash
  tracker.recordRateLimit(
    k1,
    { status: 429, message: 'Quota exceeded for GenerateRequestsPerDayPerProjectPerModel-FreeTier' },
    { model: 'gemini-3.5-flash-lite', now: t0 }
  );
  tracker.recordRateLimit(
    k2,
    { status: 429, message: 'Quota exceeded for GenerateRequestsPerDayPerProjectPerModel-FreeTier' },
    { model: 'gemini-3.5-flash-lite', now: t0 }
  );
  tracker.recordModelProbeStatus('gemini-3.6-flash', { statusCode: 503, message: 'Busy', latencyMs: 410, now: t0 });
  tracker.recordModelProbeStatus('gemini-2.5-flash', { statusCode: 404, message: 'No longer available', latencyMs: 300, now: t0 });

  // k1 is exhausted on 3.5-flash-lite, NOT on 3.6-flash!
  assert.equal(tracker.isKeyInCooldown(k1, t0 + 1000, 'gemini-3.5-flash-lite').inCooldown, true);
  assert.equal(tracker.isKeyInCooldown(k1, t0 + 1000, 'gemini-3.6-flash').inCooldown, false);

  // Real call succeeding on 3.6-flash clears its stale 503 probe status
  tracker.recordSuccess(k1, { model: 'gemini-3.6-flash', totalTokens: 450, latencyMs: 390, now: t0 + 1500 });

  const prioritized = tracker.prioritizeAvailableModels(
    ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'],
    [k1, k2],
    t0 + 2000
  );
  assert.deepEqual(
    prioritized,
    ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'],
    'Exhausted and 404 retired models move to back of cascade while preserving ready backup order'
  );

  const snap = tracker.getPoolStatusSnapshot([k1, k2], { now: t0 + 2000 });
  const mLite = snap.modelRateLimits.find((m) => m.id === 'gemini-3.5-flash-lite');
  const m36 = snap.modelRateLimits.find((m) => m.id === 'gemini-3.6-flash');
  const m25 = snap.modelRateLimits.find((m) => m.id === 'gemini-2.5-flash');
  assert.equal(mLite.liveStatus, 'exhausted');
  assert.equal(mLite.exhaustedDailyKeys, 2);
  assert.equal(m36.liveStatus, 'ready', 'Real request success clears prior 503 probe status');
  assert.equal(m36.pool.tpmUsed, 450);
  assert.equal(m25.liveStatus, 'deprecated');
  assert.equal(snap.quotaSummary.readyCascadeModelsCount, 8);
  assert.equal(snap.quotaSummary.readyKeys, 0, 'Primary 3.5-flash-lite is 429 on both keys under auto mode');
  assert.equal(snap.quotaSummary.appTodayRequests, 3, 'App counter preserves actual 3 requests instead of inflating to daily limit');

  // Switching preferredModel to healthy gemini-3.6-flash immediately clears stale flash-lite 429 from top Key pool cards
  tracker.updateSettings({ preferredModel: 'gemini-3.6-flash' }, t0 + 2100);
  const pinnedSnap = tracker.getPoolStatusSnapshot([k1, k2], { now: t0 + 2200 });
  assert.equal(pinnedSnap.quotaSummary.activePrimaryModel, 'gemini-3.6-flash');
  assert.equal(pinnedSnap.quotaSummary.readyKeys, 2);
  assert.equal(pinnedSnap.quotaSummary.dailyExhaustedKeys, 0);
  assert.equal(pinnedSnap.keys[0].status, 'ready');
  assert.equal(pinnedSnap.keys[1].status, 'ready');

  // Reverting to auto restores flash-lite daily_exhausted awareness
  tracker.updateSettings({ preferredModel: 'auto' }, t0 + 2300);
  const autoSnap = tracker.getPoolStatusSnapshot([k1, k2], { now: t0 + 2400 });
  assert.equal(autoSnap.quotaSummary.activePrimaryModel, 'gemini-3.5-flash-lite');
  assert.equal(autoSnap.quotaSummary.readyKeys, 0);
  assert.equal(autoSnap.quotaSummary.dailyExhaustedKeys, 2);
});

test('Frontend geminiRouteHelpers formats countdowns, compact tokens, model rate metrics, and ticks 429 cooldowns cleanly', async () => {
  const helperUrl = pathToFileURL(
    path.resolve(__dirname, '../../frontend/src/components/dashboard/geminiRouteHelpers.js')
  ).href;
  const helpers = await import(helperUrl);

  assert.equal(helpers.formatQuotaDuration(0), 'Ready');
  assert.equal(helpers.formatQuotaDuration(42), '42s');
  assert.equal(helpers.formatQuotaDuration(135), '2m 15s');
  assert.equal(helpers.formatQuotaDuration(13500), '3h 45m');
  assert.equal(helpers.formatCompactTokenCount(950), '950');
  assert.equal(helpers.formatCompactTokenCount(14250), '14.3K');
  assert.equal(helpers.formatQuotaMetricCount(250000), '250K');
  assert.equal(helpers.formatQuotaMetricCount(1000000), '1M');
  assert.equal(helpers.formatQuotaMetricCount(1250), '1.3K');

  const sampleModelRow = {
    id: 'gemini-3.6-flash',
    liveStatus: 'partial',
    readyKeysForModel: 3,
    totalActiveKeys: 4,
    perKey: { rpmUsed: 2, rpmLimit: 5, tpmUsed: 12500, tpmLimit: 250000, rpdUsed: 4, rpdLimit: 20 },
    pool: { rpmUsed: 8, rpmLimit: 20, tpmUsed: 50000, tpmLimit: 1000000, rpdUsed: 16, rpdLimit: 80 },
  };
  const poolMetrics = helpers.getEffectiveModelMetrics(sampleModelRow, 'pool');
  const perKeyMetrics = helpers.getEffectiveModelMetrics(sampleModelRow, 'per_key');
  assert.equal(poolMetrics.rpmLimit, 20);
  assert.equal(poolMetrics.rpmPct, 40);
  assert.equal(perKeyMetrics.rpmLimit, 5);
  assert.equal(perKeyMetrics.rpdPct, 20);
  assert.equal(helpers.getModelRateStatusMeta(sampleModelRow).label, '3/4 Keys');
  assert.equal(helpers.getModelRateStatusMeta({ liveStatus: 'busy' }).label, '⚠ 503 Busy');
  assert.equal(helpers.getModelRateStatusMeta({ liveStatus: 'deprecated' }).label, 'Retired (404)');

  const t0 = 1_794_280_000_000;
  const healthSnap = {
    timestamp: t0,
    quotaSummary: { rpmResetsInSec: 10, dailyResetsInSec: 3600 },
    keys: [
      { keyNum: 1, status: 'rate_limited', badge: 'Wait 10s', cooldownSec: 10, rpmResetsInSec: 10, rpmLimit: 15, isRateLimited: true },
      { keyNum: 2, status: 'daily_exhausted', badge: 'អស់ Quota ថ្ងៃនេះ', cooldownSec: 3600, rpmResetsInSec: 0, rpmLimit: 15, isRateLimited: true },
    ],
    modelRateLimits: [
      { id: 'gemini-3.5-flash-lite', liveStatus: 'rate_limited', cooldownSec: 10, totalActiveKeys: 2, exhaustedDailyKeys: 0, readyKeysForModel: 0 },
    ],
  };

  const after5s = helpers.applyElapsedCountdownToKeysHealth(healthSnap, t0 + 5000);
  assert.equal(after5s.quotaSummary.rpmResetsInSec, 5);
  assert.equal(after5s.keys[0].status, 'rate_limited');
  assert.equal(after5s.keys[0].cooldownSec, 5);
  assert.equal(after5s.keys[0].badge, 'Wait 5s');
  assert.equal(after5s.modelRateLimits[0].cooldownSec, 5);
  assert.equal(after5s.modelRateLimits[0].liveStatus, 'rate_limited');

  const after12s = helpers.applyElapsedCountdownToKeysHealth(healthSnap, t0 + 12000);
  assert.equal(after12s.quotaSummary.rpmResetsInSec, 0);
  assert.equal(after12s.keys[0].status, 'ready');
  assert.equal(after12s.keys[0].isRateLimited, false);
  assert.equal(after12s.keys[1].status, 'daily_exhausted', 'Daily limit stays exhausted after 12s');
  assert.equal(after12s.modelRateLimits[0].liveStatus, 'ready');
  assert.equal(after12s.modelRateLimits[0].readyKeysForModel, 2);
});
