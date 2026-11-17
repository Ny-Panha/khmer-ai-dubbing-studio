const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { uploadsDir } = require('../utils/pathUtils');
const {
  GEMINI_MODEL_CATALOG,
  DUBBING_CASCADE_MODELS,
  isUsableDubbingModel,
  getModelCatalogEntry,
} = require('./geminiModelCatalog');

const DEFAULT_SETTINGS = {
  useAllKeysFast: true,
  rpmPerKey: 15,
  dailyRpdPerKey: 500,
  preferredModel: 'auto',
};

const PACIFIC_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getKeyFingerprint(apiKey) {
  const clean = String(apiKey || '').trim();
  if (!clean) {
    return { keyId: 'empty', masked: '****' };
  }
  const keyId = crypto.createHash('sha256').update(clean).digest('hex').slice(0, 12);
  const masked = clean.length > 8 ? `...${clean.slice(-4)}` : '****';
  return { keyId, masked };
}

function getPacificDateKey(nowMs = Date.now()) {
  const safeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  return PACIFIC_DATE_FORMATTER.format(new Date(safeMs));
}

function getNextPacificMidnightMs(nowMs = Date.now()) {
  const safeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const currentDay = getPacificDateKey(safeMs);
  let cursor = Math.floor(safeMs / 3600000) * 3600000 + 3600000;
  for (let i = 0; i < 30; i++) {
    if (getPacificDateKey(cursor) !== currentDay) {
      // Binary-refine to the exact minute boundary where PT date changes
      let lo = cursor - 3600000;
      let hi = cursor;
      while (hi - lo > 60000) {
        const mid = Math.floor((lo + hi) / 2);
        if (getPacificDateKey(mid) === currentDay) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      return Math.ceil(hi / 60000) * 60000;
    }
    cursor += 3600000;
  }
  return safeMs + 24 * 3600 * 1000;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sanitizeQuotaErrorMsg(msg) {
  return String(msg || '')
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
    .replace(/You exceeded your current quota, please check your plan and billing details\.?\s*/gi, '')
    .replace(/For more information on this error, head to:\s*https?:\/\/\S+\s*/gi, '')
    .replace(/To monitor your current usage, head to:\s*https?:\/\/\S+\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

function extractReportedDailyLimit(msg) {
  if (!msg) return null;
  const match = String(msg).match(/limit\s*:\s*(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Inspects a Gemini 429/503/504 error to distinguish per-minute (RPM) vs per-day (RPD) exhaustion
 * and extract Google's RetryInfo countdown.
 */
function parseGeminiRateLimitDetails(err, nowMs = Date.now()) {
  const rawMsg = typeof err === 'string'
    ? err
    : `${err?.message || ''} ${err?.details ? JSON.stringify(err.details) : ''}`;
  const lower = rawMsg.toLowerCase();

  let extractedMessage = err?.message || rawMsg || '429 RESOURCE_EXHAUSTED';
  try {
    const trimmed = String(rawMsg || '').trim();
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      if (parsed?.error?.message) {
        extractedMessage = parsed.error.message;
      }
    }
  } catch (_) {}

  let retryAfterSec = null;
  const retryMatch =
    rawMsg.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i) ||
    rawMsg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i) ||
    rawMsg.match(/retry_after\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (retryMatch) {
    retryAfterSec = Math.max(1, Math.ceil(Number(retryMatch[1])));
  }

  const mentionsDailyQuota =
    /generaterequestsperday|requests_?per_?day|\brpd\b|per\s*day|daily\s*limit/i.test(rawMsg);
  const isShortRetry = Boolean(retryAfterSec && retryAfterSec <= 120);
  const isDaily = mentionsDailyQuota && !isShortRetry;
  const isTokenRate = /tokens?\s*per\s*minute|\btpm\b|input_token_count/i.test(rawMsg);

  let cooldownType = 'rpm_limit';
  let cooldownUntil;
  if (isDaily) {
    cooldownType = 'rpd_limit';
    cooldownUntil = getNextPacificMidnightMs(nowMs);
  } else {
    const waitSec = retryAfterSec || (lower.includes('503') ? 15 : 60);
    cooldownUntil = nowMs + waitSec * 1000;
    retryAfterSec = waitSec;
  }

  return {
    cooldownType,
    isDaily,
    isTokenRate,
    retryAfterSec: Math.max(1, Math.ceil((cooldownUntil - nowMs) / 1000)),
    cooldownUntil,
    sanitizedMessage: sanitizeQuotaErrorMsg(extractedMessage),
  };
}

class GeminiQuotaTracker {
  constructor(options = {}) {
    const isTestRunner = Boolean(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test');
    this.persistEnabled = options.persistEnabled !== undefined
      ? Boolean(options.persistEnabled)
      : (!isTestRunner || Boolean(options.storagePath));
    this.storagePath = options.storagePath || path.join(uploadsDir, 'cache', 'gemini_quota_usage.json');
    const initNow = Number.isFinite(options.now) ? options.now : Date.now();
    this.pacificDate = getPacificDateKey(initNow);
    this.settings = { ...DEFAULT_SETTINGS };
    this.keys = new Map(); // keyId -> stats record
    this.models = new Map(); // modelId -> per-model stats & per-key exhaustion
    this.saveTimer = null;

    if (this.persistEnabled) {
      this._loadFromDisk(initNow);
    }
  }

  _createEmptyRecord(keyId, masked = '****') {
    return {
      keyId,
      masked,
      recentTimestamps: [],
      todayRequests: 0,
      todayTokens: 0,
      todayErrors429: 0,
      cooldownType: null,
      cooldownUntil: 0,
      lastErrorAt: 0,
      lastErrorMessage: null,
      lastSuccessAt: 0,
      lastModelUsed: null,
      lastErrorModel: null,
      lastProbeAt: 0,
      lastProbeCode: null,
      lastLatencyMs: null,
      isInvalid: false,
    };
  }

  _createEmptyModelRecord(modelId) {
    return {
      modelId,
      recentEvents: [], // [{ ts, tok, keyId }]
      todayRequests: 0,
      todayTokens: 0,
      todayErrors429: 0,
      exhaustedKeys: {}, // keyId -> { keyNum?, masked?, cooldownType, cooldownUntil, lastErrorAt, lastErrorMessage }
      lastProbeAt: 0,
      lastProbeCode: null,
      lastProbeLatencyMs: null,
      lastSuccessAt: 0,
      lastErrorAt: 0,
      lastErrorMessage: null,
    };
  }

  _rolloverIfNeeded(nowMs = Date.now()) {
    const currentDay = getPacificDateKey(nowMs);
    if (this.pacificDate === currentDay) return false;
    this.pacificDate = currentDay;
    for (const rec of this.keys.values()) {
      rec.todayRequests = 0;
      rec.todayTokens = 0;
      rec.todayErrors429 = 0;
      if (rec.cooldownType === 'rpd_limit') {
        rec.cooldownType = null;
        rec.cooldownUntil = 0;
        rec.lastErrorMessage = null;
      }
    }
    for (const mRec of this.models.values()) {
      mRec.todayRequests = 0;
      mRec.todayTokens = 0;
      mRec.todayErrors429 = 0;
      for (const [kId, info] of Object.entries(mRec.exhaustedKeys || {})) {
        if (!info || info.cooldownType === 'rpd_limit' || (info.cooldownUntil || 0) <= nowMs) {
          delete mRec.exhaustedKeys[kId];
        }
      }
      if (mRec.lastProbeCode === 429) {
        mRec.lastProbeCode = null;
        mRec.lastErrorMessage = null;
      }
    }
    this._scheduleSave();
    return true;
  }

  _ensureRecord(apiKey, nowMs = Date.now()) {
    this._rolloverIfNeeded(nowMs);
    const { keyId, masked } = getKeyFingerprint(apiKey);
    let rec = this.keys.get(keyId);
    if (!rec) {
      rec = this._createEmptyRecord(keyId, masked);
      this.keys.set(keyId, rec);
    } else if (masked && masked !== '****') {
      rec.masked = masked;
    }
    rec.recentTimestamps = rec.recentTimestamps.filter((ts) => ts > nowMs - 60000);
    if (rec.cooldownUntil && rec.cooldownUntil <= nowMs) {
      rec.cooldownType = null;
      rec.cooldownUntil = 0;
    }
    return rec;
  }

  _ensureModelRecord(modelId, nowMs = Date.now()) {
    this._rolloverIfNeeded(nowMs);
    const cleanModel = String(modelId || '').trim();
    if (!cleanModel) return null;
    let mRec = this.models.get(cleanModel);
    if (!mRec) {
      mRec = this._createEmptyModelRecord(cleanModel);
      this.models.set(cleanModel, mRec);
    }
    mRec.recentEvents = (mRec.recentEvents || []).filter((ev) => ev && Number.isFinite(ev.ts) && ev.ts > nowMs - 60000);
    for (const [kId, info] of Object.entries(mRec.exhaustedKeys || {})) {
      if (!info || (Number(info.cooldownUntil) || 0) <= nowMs) {
        delete mRec.exhaustedKeys[kId];
      }
    }
    return mRec;
  }

  _loadFromDisk(nowMs = Date.now()) {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        if (raw.settings && typeof raw.settings === 'object') {
          const rawPref = String(raw.settings.preferredModel || DEFAULT_SETTINGS.preferredModel).trim();
          this.settings = {
            useAllKeysFast: raw.settings.useAllKeysFast !== undefined
              ? Boolean(raw.settings.useAllKeysFast)
              : DEFAULT_SETTINGS.useAllKeysFast,
            rpmPerKey: clampInt(raw.settings.rpmPerKey, 1, 2000, DEFAULT_SETTINGS.rpmPerKey),
            dailyRpdPerKey: clampInt(raw.settings.dailyRpdPerKey, 10, 200000, DEFAULT_SETTINGS.dailyRpdPerKey),
            preferredModel: (rawPref === 'auto' || isUsableDubbingModel(rawPref)) ? rawPref : 'auto',
          };
        }
        const currentDay = getPacificDateKey(nowMs);
        const sameDay = raw.pacificDate === currentDay;
        this.pacificDate = currentDay;
        if (raw.keys && typeof raw.keys === 'object') {
          for (const [keyId, stored] of Object.entries(raw.keys)) {
            if (!stored || typeof stored !== 'object') continue;
            const rec = this._createEmptyRecord(keyId, stored.masked || '****');
            rec.recentTimestamps = Array.isArray(stored.recentTimestamps)
              ? stored.recentTimestamps.filter((ts) => Number.isFinite(ts) && ts > nowMs - 60000)
              : [];
            rec.todayRequests = sameDay ? Math.max(0, Number(stored.todayRequests) || 0) : 0;
            rec.todayTokens = sameDay ? Math.max(0, Number(stored.todayTokens) || 0) : 0;
            rec.todayErrors429 = sameDay ? Math.max(0, Number(stored.todayErrors429) || 0) : 0;
            const cdUntil = Number(stored.cooldownUntil) || 0;
            if (cdUntil > nowMs && (stored.cooldownType !== 'rpd_limit' || sameDay)) {
              rec.cooldownType = stored.cooldownType || 'rpm_limit';
              rec.cooldownUntil = cdUntil;
            }
            rec.lastErrorAt = Number(stored.lastErrorAt) || 0;
            rec.lastErrorMessage = stored.lastErrorMessage || null;
            rec.lastSuccessAt = Number(stored.lastSuccessAt) || 0;
            rec.lastModelUsed = stored.lastModelUsed || null;
            rec.lastErrorModel = stored.lastErrorModel || null;
            rec.lastProbeAt = Number(stored.lastProbeAt) || 0;
            rec.lastProbeCode = stored.lastProbeCode ?? null;
            rec.lastLatencyMs = stored.lastLatencyMs ?? null;
            rec.isInvalid = Boolean(stored.isInvalid);
            this.keys.set(keyId, rec);
          }
        }
        if (raw.models && typeof raw.models === 'object') {
          for (const [modelId, stored] of Object.entries(raw.models)) {
            if (!stored || typeof stored !== 'object') continue;
            const mRec = this._createEmptyModelRecord(modelId);
            mRec.recentEvents = Array.isArray(stored.recentEvents)
              ? stored.recentEvents.filter((ev) => ev && Number.isFinite(ev.ts) && ev.ts > nowMs - 60000)
              : [];
            mRec.todayRequests = sameDay ? Math.max(0, Number(stored.todayRequests) || 0) : 0;
            mRec.todayTokens = sameDay ? Math.max(0, Number(stored.todayTokens) || 0) : 0;
            mRec.todayErrors429 = sameDay ? Math.max(0, Number(stored.todayErrors429) || 0) : 0;
            if (stored.exhaustedKeys && typeof stored.exhaustedKeys === 'object') {
              for (const [kId, info] of Object.entries(stored.exhaustedKeys)) {
                const cdUntil = Number(info?.cooldownUntil) || 0;
                if (cdUntil > nowMs && (info?.cooldownType !== 'rpd_limit' || sameDay)) {
                  mRec.exhaustedKeys[kId] = {
                    masked: info.masked || '****',
                    cooldownType: info.cooldownType || 'rpm_limit',
                    cooldownUntil: cdUntil,
                    lastErrorAt: Number(info.lastErrorAt) || 0,
                    lastErrorMessage: info.lastErrorMessage || null,
                  };
                }
              }
            }
            mRec.lastProbeAt = Number(stored.lastProbeAt) || 0;
            mRec.lastProbeCode = stored.lastProbeCode ?? null;
            mRec.lastProbeLatencyMs = stored.lastProbeLatencyMs ?? null;
            mRec.lastSuccessAt = Number(stored.lastSuccessAt) || 0;
            mRec.lastErrorAt = Number(stored.lastErrorAt) || 0;
            mRec.lastErrorMessage = sameDay ? (stored.lastErrorMessage || null) : null;
            this.models.set(modelId, mRec);
          }
        }
      }
    } catch (_) {
      // Ignore corrupt cache files and start cleanly
    }
  }

  _writeNow() {
    if (!this.persistEnabled) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serializedKeys = {};
      for (const [keyId, rec] of this.keys.entries()) {
        serializedKeys[keyId] = {
          masked: rec.masked,
          recentTimestamps: rec.recentTimestamps.slice(-250),
          todayRequests: rec.todayRequests,
          todayTokens: rec.todayTokens,
          todayErrors429: rec.todayErrors429,
          cooldownType: rec.cooldownType,
          cooldownUntil: rec.cooldownUntil,
          lastErrorAt: rec.lastErrorAt,
          lastErrorMessage: rec.lastErrorMessage,
          lastSuccessAt: rec.lastSuccessAt,
          lastModelUsed: rec.lastModelUsed,
          lastErrorModel: rec.lastErrorModel,
          lastProbeAt: rec.lastProbeAt,
          lastProbeCode: rec.lastProbeCode,
          lastLatencyMs: rec.lastLatencyMs,
          isInvalid: rec.isInvalid,
        };
      }
      const serializedModels = {};
      for (const [modelId, mRec] of this.models.entries()) {
        serializedModels[modelId] = {
          recentEvents: (mRec.recentEvents || []).slice(-300),
          todayRequests: mRec.todayRequests,
          todayTokens: mRec.todayTokens,
          todayErrors429: mRec.todayErrors429,
          exhaustedKeys: mRec.exhaustedKeys || {},
          lastProbeAt: mRec.lastProbeAt,
          lastProbeCode: mRec.lastProbeCode,
          lastProbeLatencyMs: mRec.lastProbeLatencyMs,
          lastSuccessAt: mRec.lastSuccessAt,
          lastErrorAt: mRec.lastErrorAt,
          lastErrorMessage: mRec.lastErrorMessage,
        };
      }
      const payload = {
        pacificDate: this.pacificDate,
        updatedAt: Date.now(),
        settings: this.settings,
        keys: serializedKeys,
        models: serializedModels,
      };
      const tmpPath = `${this.storagePath}.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storagePath);
    } catch (_) {
      // Never throw on telemetry persistence
    }
  }

  _scheduleSave() {
    if (!this.persistEnabled) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._writeNow();
    }, 350);
    if (typeof this.saveTimer.unref === 'function') {
      this.saveTimer.unref();
    }
  }

  getSettings() {
    return { ...this.settings };
  }

  getPreferredPrimaryModel(fallbackModel = DUBBING_CASCADE_MODELS[0]) {
    const pref = this.settings.preferredModel;
    if (pref && pref !== 'auto' && isUsableDubbingModel(pref)) {
      return pref;
    }
    return fallbackModel;
  }

  updateSettings(patch = {}, nowMs = Date.now()) {
    this._rolloverIfNeeded(nowMs);
    if (patch.useAllKeysFast !== undefined) {
      this.settings.useAllKeysFast = Boolean(patch.useAllKeysFast);
    }
    if (patch.rpmPerKey !== undefined) {
      this.settings.rpmPerKey = clampInt(patch.rpmPerKey, 1, 2000, this.settings.rpmPerKey);
    }
    if (patch.dailyRpdPerKey !== undefined) {
      this.settings.dailyRpdPerKey = clampInt(patch.dailyRpdPerKey, 10, 200000, this.settings.dailyRpdPerKey);
    }
    if (patch.preferredModel !== undefined) {
      const cleanPref = String(patch.preferredModel || 'auto').trim();
      if (cleanPref === 'auto' || isUsableDubbingModel(cleanPref)) {
        this.settings.preferredModel = cleanPref;
      }
    }
    if (patch.resetDailyStats) {
      for (const rec of this.keys.values()) {
        rec.todayRequests = 0;
        rec.todayTokens = 0;
        rec.todayErrors429 = 0;
        rec.cooldownType = null;
        rec.cooldownUntil = 0;
        rec.lastErrorMessage = null;
        rec.lastErrorModel = null;
        rec.isInvalid = false;
      }
      for (const mRec of this.models.values()) {
        mRec.todayRequests = 0;
        mRec.todayTokens = 0;
        mRec.todayErrors429 = 0;
        mRec.exhaustedKeys = {};
        mRec.lastProbeCode = null;
        mRec.lastErrorMessage = null;
      }
    }
    this._writeNow();
    return this.getSettings();
  }

  recordSuccess(apiKey, { model = null, totalTokens = 0, latencyMs = null, statusCode = 200, isProbe = false, updateKeyCooldown = true, now = Date.now() } = {}) {
    if (!apiKey) return;
    const rec = this._ensureRecord(apiKey, now);
    rec.recentTimestamps.push(now);
    if (rec.recentTimestamps.length > 300) {
      rec.recentTimestamps = rec.recentTimestamps.slice(-250);
    }
    rec.todayRequests += 1;
    const safeTokens = Math.max(0, Number(totalTokens) || 0);
    rec.todayTokens += safeTokens;
    rec.isInvalid = false;
    rec.lastSuccessAt = now;
    if (model) rec.lastModelUsed = String(model);
    if (Number.isFinite(latencyMs)) rec.lastLatencyMs = Math.round(latencyMs);

    const activePrimary = this.getPreferredPrimaryModel();
    const shouldClearKeyCooldown =
      updateKeyCooldown && (!model || model === activePrimary || model === rec.lastErrorModel || rec.cooldownType !== 'rpd_limit');
    if (shouldClearKeyCooldown) {
      rec.cooldownType = null;
      rec.cooldownUntil = 0;
      if (isProbe) {
        rec.lastProbeAt = now;
        rec.lastProbeCode = statusCode || 200;
        rec.lastErrorMessage = null;
      }
    }

    if (model) {
      const mRec = this._ensureModelRecord(model, now);
      if (mRec) {
        mRec.recentEvents.push({ ts: now, tok: safeTokens, keyId: rec.keyId });
        if (mRec.recentEvents.length > 400) mRec.recentEvents = mRec.recentEvents.slice(-300);
        mRec.todayRequests += 1;
        mRec.todayTokens += safeTokens;
        mRec.lastSuccessAt = now;
        if (mRec.exhaustedKeys && mRec.exhaustedKeys[rec.keyId]) {
          delete mRec.exhaustedKeys[rec.keyId];
        }
        if (isProbe || (mRec.lastProbeCode && mRec.lastProbeCode >= 400)) {
          mRec.lastProbeCode = statusCode || 200;
          mRec.lastErrorMessage = null;
        }
        if (isProbe) {
          mRec.lastProbeAt = now;
          if (Number.isFinite(latencyMs)) mRec.lastProbeLatencyMs = Math.round(latencyMs);
        }
      }
    }
    this._scheduleSave();
  }

  recordRateLimit(apiKey, err, { model = null, latencyMs = null, isProbe = false, updateKeyCooldown = true, now = Date.now() } = {}) {
    if (!apiKey) return;
    const rec = this._ensureRecord(apiKey, now);
    const details = parseGeminiRateLimitDetails(err, now);
    rec.recentTimestamps.push(now);
    if (rec.recentTimestamps.length > 300) {
      rec.recentTimestamps = rec.recentTimestamps.slice(-250);
    }
    rec.todayRequests += 1;
    rec.todayErrors429 += 1;
    if (updateKeyCooldown) {
      rec.cooldownType = details.cooldownType;
      rec.cooldownUntil = details.cooldownUntil;
      rec.lastErrorAt = now;
      rec.lastErrorMessage = details.sanitizedMessage;
      rec.lastErrorModel = model ? String(model) : rec.lastErrorModel;
      if (isProbe) {
        rec.lastProbeAt = now;
        rec.lastProbeCode = 429;
      }
    }
    if (model) rec.lastModelUsed = String(model);
    if (Number.isFinite(latencyMs)) rec.lastLatencyMs = Math.round(latencyMs);

    if (model) {
      const mRec = this._ensureModelRecord(model, now);
      if (mRec) {
        mRec.recentEvents.push({ ts: now, tok: 0, keyId: rec.keyId });
        if (mRec.recentEvents.length > 400) mRec.recentEvents = mRec.recentEvents.slice(-300);
        mRec.todayRequests += 1;
        mRec.todayErrors429 += 1;
        mRec.lastErrorAt = now;
        mRec.lastErrorMessage = details.sanitizedMessage;
        mRec.exhaustedKeys[rec.keyId] = {
          masked: rec.masked,
          cooldownType: details.cooldownType,
          cooldownUntil: details.cooldownUntil,
          lastErrorAt: now,
          lastErrorMessage: details.sanitizedMessage,
        };
        if (isProbe) {
          mRec.lastProbeAt = now;
          mRec.lastProbeCode = 429;
          if (Number.isFinite(latencyMs)) mRec.lastProbeLatencyMs = Math.round(latencyMs);
        }
      }
    }
    this._scheduleSave();
    return details;
  }

  recordModelProbeStatus(modelId, { statusCode = 200, message = '', latencyMs = null, now = Date.now() } = {}) {
    const mRec = this._ensureModelRecord(modelId, now);
    if (!mRec) return;
    mRec.lastProbeAt = now;
    mRec.lastProbeCode = statusCode;
    if (Number.isFinite(latencyMs)) mRec.lastProbeLatencyMs = Math.round(latencyMs);
    if (statusCode >= 400) {
      mRec.lastErrorAt = now;
      if (message) mRec.lastErrorMessage = sanitizeQuotaErrorMsg(message);
    } else {
      mRec.lastErrorMessage = null;
    }
    this._scheduleSave();
  }

  recordInvalid(apiKey, statusCode = 401, message = '', { latencyMs = null, isProbe = false, now = Date.now() } = {}) {
    if (!apiKey) return;
    const rec = this._ensureRecord(apiKey, now);
    rec.isInvalid = true;
    rec.cooldownType = 'invalid_key';
    rec.cooldownUntil = 0;
    rec.lastErrorAt = now;
    rec.lastErrorMessage = sanitizeQuotaErrorMsg(message || `HTTP ${statusCode} Invalid API Key`);
    if (Number.isFinite(latencyMs)) rec.lastLatencyMs = Math.round(latencyMs);
    if (isProbe) {
      rec.lastProbeAt = now;
      rec.lastProbeCode = statusCode || 401;
    }
    this._scheduleSave();
  }

  recordModelListProbe(apiKey, { statusCode = 200, latencyMs = null, now = Date.now() } = {}) {
    if (!apiKey) return;
    const rec = this._ensureRecord(apiKey, now);
    if (statusCode === 200) {
      rec.isInvalid = false;
      rec.lastProbeAt = rec.lastProbeAt || now;
      if (rec.lastProbeCode === null || rec.lastProbeCode === 401 || rec.lastProbeCode === 403) {
        rec.lastProbeCode = 200;
      }
    } else if (statusCode === 401 || statusCode === 403) {
      rec.isInvalid = true;
      rec.cooldownType = 'invalid_key';
      rec.lastProbeAt = now;
      rec.lastProbeCode = statusCode;
    } else if (statusCode === 429) {
      this.recordRateLimit(apiKey, '429 Rate limited', { latencyMs, isProbe: true, now });
      return;
    }
    if (Number.isFinite(latencyMs)) rec.lastLatencyMs = Math.round(latencyMs);
    this._scheduleSave();
  }

  isKeyInCooldown(apiKey, now = Date.now(), modelName = null) {
    if (!apiKey) return { inCooldown: false, cooldownSec: 0, cooldownType: null, cooldownUntil: 0 };
    const rec = this._ensureRecord(apiKey, now);
    if (modelName) {
      const mRec = this._ensureModelRecord(modelName, now);
      const modelCd = mRec?.exhaustedKeys?.[rec.keyId];
      if (modelCd && Number(modelCd.cooldownUntil) > now) {
        return {
          inCooldown: true,
          cooldownType: modelCd.cooldownType || 'rpm_limit',
          cooldownUntil: modelCd.cooldownUntil,
          cooldownSec: Math.max(1, Math.ceil((modelCd.cooldownUntil - now) / 1000)),
          reason: modelCd.lastErrorMessage || '429 Rate limit',
        };
      }
      if (rec.cooldownUntil > now && (!rec.lastErrorModel || rec.lastErrorModel === modelName)) {
        return {
          inCooldown: true,
          cooldownType: rec.cooldownType || 'rpm_limit',
          cooldownUntil: rec.cooldownUntil,
          cooldownSec: Math.max(1, Math.ceil((rec.cooldownUntil - now) / 1000)),
          reason: rec.lastErrorMessage || '429 Rate limit',
        };
      }
      return { inCooldown: false, cooldownSec: 0, cooldownType: null, cooldownUntil: 0 };
    }
    if (!rec.cooldownUntil || rec.cooldownUntil <= now) {
      return { inCooldown: false, cooldownSec: 0, cooldownType: null, cooldownUntil: 0 };
    }
    return {
      inCooldown: true,
      cooldownType: rec.cooldownType || 'rpm_limit',
      cooldownUntil: rec.cooldownUntil,
      cooldownSec: Math.max(1, Math.ceil((rec.cooldownUntil - now) / 1000)),
      reason: rec.lastErrorMessage || '429 Rate limit',
    };
  }

  prioritizeAvailableModels(candidateModels = [], keysList = [], now = Date.now()) {
    const cleanList = Array.isArray(candidateModels) ? candidateModels : [];
    if (!Array.isArray(keysList) || keysList.length === 0 || cleanList.length <= 1) {
      return cleanList;
    }
    const ready = [];
    const busyOrDegraded = [];
    const exhaustedOrRetired = [];
    for (const modelId of cleanList) {
      const mRec = this._ensureModelRecord(modelId, now);
      if (mRec?.lastProbeCode === 404) {
        exhaustedOrRetired.push(modelId);
        continue;
      }
      let hasReadyKey = false;
      for (const rawKey of keysList) {
        const rec = this._ensureRecord(rawKey, now);
        if (rec.isInvalid) continue;
        if (!this.isKeyInCooldown(rawKey, now, modelId).inCooldown) {
          hasReadyKey = true;
          break;
        }
      }
      if (!hasReadyKey) {
        exhaustedOrRetired.push(modelId);
      } else if (mRec?.lastProbeCode === 503 || mRec?.lastProbeCode === 504) {
        busyOrDegraded.push(modelId);
      } else {
        ready.push(modelId);
      }
    }
    // High-Quota Flash-Lite models (15 RPM, 500 RPD) should always take precedence over heavy Flash models
    const isLiteModel = (id) => String(id).includes('flash-lite');
    const sortedReady = [
      ...ready.filter(isLiteModel),
      ...ready.filter((id) => !isLiteModel(id)),
    ];
    return [...sortedReady, ...busyOrDegraded, ...exhaustedOrRetired];
  }

  /**
   * When Safe Pacing is enabled (useAllKeysFast === false), returns a bounded delay (ms)
   * if the key is approaching its 1-minute RPM cap so batch jobs avoid burst 429 errors.
   */
  getRecommendedPacingDelayMs(apiKey, now = Date.now()) {
    if (this.settings.useAllKeysFast || !apiKey) return 0;
    const rec = this._ensureRecord(apiKey, now);
    const rpmLimit = Math.max(1, this.settings.rpmPerKey);
    const rpmUsed = rec.recentTimestamps.length;
    if (rpmUsed < Math.max(2, Math.floor(rpmLimit * 0.8))) {
      return 0;
    }
    const oldest = rec.recentTimestamps[0] || now;
    const msUntilWindowRelief = Math.max(300, oldest + 60000 - now);
    return Math.min(2500, msUntilWindowRelief);
  }

  getPoolStatusSnapshot(keysList = [], { invalidKeysSet = null, now = Date.now() } = {}) {
    this._rolloverIfNeeded(now);
    const { rpmPerKey, dailyRpdPerKey, useAllKeysFast, preferredModel = 'auto' } = this.settings;
    const activePrimaryModel = this.getPreferredPrimaryModel();
    const activePrimaryEntry = getModelCatalogEntry(activePrimaryModel);
    const activePrimaryMRec = this._ensureModelRecord(activePrimaryModel, now);
    const dailyResetsAt = getNextPacificMidnightMs(now);
    const dailyResetsInSec = Math.max(1, Math.ceil((dailyResetsAt - now) / 1000));

    let readyKeys = 0;
    let cooldownKeys = 0;
    let dailyExhaustedKeys = 0;
    let invalidKeys = 0;

    let poolRpmUsed = 0;
    let poolRpmTotal = 0;
    let poolRpmLeftSum = 0;
    let maxRpmResetSec = 0;

    let poolDailyUsed = 0;
    let poolDailyTotal = 0;
    let poolAppTodayRequests = 0;
    let poolTodayTokens = 0;
    let reportedDailyLimitPerKey = null;

    const validKeyIds = [];
    const keyEntries = keysList.map((rawKey, idx) => {
      const rec = this._ensureRecord(rawKey, now);
      const forcedInvalid = Boolean(invalidKeysSet && invalidKeysSet.has(rawKey));
      const hasQuotaError = String(rec.lastErrorMessage || '').toLowerCase().includes('quota') ||
        String(rec.lastErrorMessage || '').toLowerCase().includes('limit: 500') ||
        String(rec.lastErrorMessage || '').toLowerCase().includes('resource_exhausted');
      if (hasQuotaError && rec.isInvalid) {
        rec.isInvalid = false;
        rec.cooldownType = 'rpd_limit';
      }
      const isInvalid = !hasQuotaError && (forcedInvalid || rec.isInvalid);
      if (!isInvalid) {
        validKeyIds.push(rec.keyId);
      }

      const keyModelCd = isInvalid
        ? { inCooldown: false, cooldownSec: 0, cooldownType: null, cooldownUntil: 0, reason: null }
        : this.isKeyInCooldown(rawKey, now, activePrimaryModel);
      const inCooldown = !isInvalid && keyModelCd.inCooldown;
      const isDailyExhausted = !isInvalid && (
        (inCooldown && keyModelCd.cooldownType === 'rpd_limit') ||
        ((rec.todayRequests || 0) >= dailyRpdPerKey)
      );
      const isRateLimited = !isInvalid && inCooldown && !isDailyExhausted;

      const rpmUsed = rec.recentTimestamps.length;
      const oldestTs = rec.recentTimestamps[0] || 0;
      const rollingRpmResetSec = rpmUsed > 0 ? Math.max(1, Math.ceil((oldestTs + 60000 - now) / 1000)) : 0;
      const cooldownSec = inCooldown ? Math.max(1, Number(keyModelCd.cooldownSec) || 0) : 0;
      const rpmResetsInSec = isRateLimited ? Math.max(rollingRpmResetSec, cooldownSec) : rollingRpmResetSec;

      const rpmLeft = isInvalid || inCooldown ? 0 : Math.max(0, rpmPerKey - rpmUsed);
      const rpmPercent = isInvalid
        ? 100
        : isRateLimited
          ? 100
          : Math.min(100, Math.round((rpmUsed / Math.max(1, rpmPerKey)) * 100));

      const effectiveDailyUsed = isDailyExhausted
        ? Math.max(rec.todayRequests, dailyRpdPerKey)
        : rec.todayRequests;
      const dailyLeft = isInvalid || isDailyExhausted
        ? 0
        : Math.max(0, dailyRpdPerKey - effectiveDailyUsed);
      const dailyPercent = isInvalid || isDailyExhausted
        ? 100
        : Math.min(100, Math.round((effectiveDailyUsed / Math.max(1, dailyRpdPerKey)) * 100));

      const activeErrorMessage = isInvalid
        ? rec.lastErrorMessage
        : inCooldown
          ? (keyModelCd.reason || rec.lastErrorMessage)
          : null;
      const reportedCap = isDailyExhausted ? extractReportedDailyLimit(activeErrorMessage) : null;
      if (reportedCap && (!reportedDailyLimitPerKey || reportedCap < reportedDailyLimitPerKey)) {
        reportedDailyLimitPerKey = reportedCap;
      }

      const primaryMismatch = Boolean(rec.lastErrorModel && rec.lastErrorModel !== activePrimaryModel);
      const keyLastProbeCode = isInvalid
        ? (rec.lastProbeCode || 401)
        : inCooldown
          ? 429
          : primaryMismatch
            ? (activePrimaryMRec?.lastProbeCode ?? null)
            : rec.lastProbeCode;

      let status = 'ready';
      let badge = `${rpmLeft}/${rpmPerKey} RPM`;
      if (isInvalid) {
        status = 'invalid';
        badge = '401 Key ខុស';
        invalidKeys += 1;
      } else if (isDailyExhausted) {
        status = 'daily_exhausted';
        badge = 'អស់ Quota ថ្ងៃនេះ';
        dailyExhaustedKeys += 1;
      } else if (isRateLimited) {
        status = 'rate_limited';
        badge = `Wait ${cooldownSec}s`;
        cooldownKeys += 1;
      } else {
        readyKeys += 1;
      }

      if (!isInvalid && !isDailyExhausted) {
        poolRpmTotal += rpmPerKey;
        poolRpmUsed += rpmUsed;
        poolRpmLeftSum += rpmLeft;
      }
      if (!isInvalid) {
        poolDailyTotal += dailyRpdPerKey;
        poolDailyUsed += effectiveDailyUsed;
        poolAppTodayRequests += rec.todayRequests;
        poolTodayTokens += rec.todayTokens;
        if (rpmResetsInSec > maxRpmResetSec) {
          maxRpmResetSec = rpmResetsInSec;
        }
      }

      return {
        keyNum: idx + 1,
        masked: rec.masked,
        status,
        badge,
        code: isInvalid ? (rec.lastProbeCode || 401) : inCooldown ? 429 : (keyLastProbeCode || 200),
        latencyMs: rec.lastLatencyMs ?? 0,
        isRateLimited: isRateLimited || isDailyExhausted,
        isDailyExhausted,
        isInvalid,
        rpmUsed,
        rpmLimit: rpmPerKey,
        rpmLeft,
        rpmPercent,
        rpmResetsInSec,
        todayRequests: rec.todayRequests,
        effectiveDailyUsed,
        reportedDailyCap: reportedCap,
        todayTokens: rec.todayTokens,
        todayErrors429: rec.todayErrors429,
        dailyLimit: dailyRpdPerKey,
        dailyLeft,
        dailyPercent,
        cooldownType: inCooldown ? (keyModelCd.cooldownType || rec.cooldownType) : null,
        cooldownUntil: inCooldown ? (keyModelCd.cooldownUntil || rec.cooldownUntil) : 0,
        cooldownSec,
        lastModelUsed: rec.lastModelUsed,
        exhaustedModel: isDailyExhausted ? (rec.lastErrorModel || activePrimaryModel) : null,
        lastSuccessAt: rec.lastSuccessAt,
        lastErrorAt: rec.lastErrorAt,
        lastErrorMessage: activeErrorMessage || rec.lastErrorMessage,
        lastProbeAt: rec.lastProbeAt,
        lastProbeCode: keyLastProbeCode,
      };
    });

    const poolMultiplier = Math.max(1, validKeyIds.length || keysList.length || 1);
    let readyCascadeModelsCount = 0;

    const modelRateLimits = GEMINI_MODEL_CATALOG.map((catalogEntry, idx) => {
      const mRec = this._ensureModelRecord(catalogEntry.id, now);
      const recentEvents = mRec?.recentEvents || [];
      const rpmUsed = recentEvents.length;
      const tpmUsed = recentEvents.reduce((sum, ev) => sum + (Number(ev.tok) || 0), 0);

      let exhaustedDailyKeys = 0;
      let cooldownTempKeys = 0;
      let maxModelCooldownSec = 0;
      const exhaustedMap = mRec?.exhaustedKeys || {};

      for (const kId of validKeyIds) {
        const info = exhaustedMap[kId];
        if (info && Number(info.cooldownUntil) > now) {
          const rem = Math.max(1, Math.ceil((Number(info.cooldownUntil) - now) / 1000));
          if (rem > maxModelCooldownSec) maxModelCooldownSec = rem;
          if (info.cooldownType === 'rpd_limit') exhaustedDailyKeys += 1;
          else cooldownTempKeys += 1;
        }
      }

      const poolRpmLimit = catalogEntry.rpmLimit * poolMultiplier;
      const poolTpmLimit = catalogEntry.tpmLimit * poolMultiplier;
      const poolRpdLimit = catalogEntry.rpdLimit * poolMultiplier;

      const rawDailyReq = mRec?.todayRequests || 0;
      const effectivePoolRpdUsed = Math.max(rawDailyReq, exhaustedDailyKeys * catalogEntry.rpdLimit);
      const effectivePerKeyRpdUsed = Math.min(
        catalogEntry.rpdLimit || effectivePoolRpdUsed,
        exhaustedDailyKeys >= poolMultiplier
          ? catalogEntry.rpdLimit
          : Math.round(effectivePoolRpdUsed / poolMultiplier)
      );

      let liveStatus = 'untested';
      if (catalogEntry.deprecated || catalogEntry.rpdLimit === 0) {
        liveStatus = (mRec?.lastProbeCode === 404 || catalogEntry.deprecated) ? 'deprecated' : 'zero_limit';
      } else if (mRec?.lastProbeCode === 404) {
        liveStatus = 'deprecated';
      } else if (exhaustedDailyKeys >= validKeyIds.length && validKeyIds.length > 0) {
        liveStatus = 'exhausted';
      } else if (mRec?.lastProbeCode === 503) {
        liveStatus = 'busy';
      } else if (mRec?.lastProbeCode === 504 || mRec?.lastProbeCode === 408) {
        liveStatus = 'timeout';
      } else if (exhaustedDailyKeys > 0 || cooldownTempKeys > 0) {
        liveStatus = (validKeyIds.length - exhaustedDailyKeys - cooldownTempKeys) > 0 ? 'partial' : 'rate_limited';
      } else if (mRec?.lastProbeCode === 200 || (mRec?.lastSuccessAt || 0) > 0) {
        liveStatus = 'ready';
      } else if (mRec?.lastProbeCode === 429) {
        liveStatus = 'exhausted';
      }

      const isAvailableInPool =
        catalogEntry.usableInDubbing &&
        liveStatus !== 'deprecated' &&
        liveStatus !== 'exhausted' &&
        liveStatus !== 'zero_limit';
      if (isAvailableInPool && (liveStatus === 'ready' || liveStatus === 'partial' || liveStatus === 'untested')) {
        readyCascadeModelsCount += 1;
      }

      return {
        id: catalogEntry.id,
        displayName: catalogEntry.displayName,
        category: catalogEntry.category,
        roleTag: catalogEntry.roleTag,
        cascadeRank: catalogEntry.inCascade ? idx + 1 : null,
        usableInDubbing: catalogEntry.usableInDubbing,
        usableInApp: catalogEntry.usableInApp,
        inCascade: catalogEntry.inCascade,
        deprecated: catalogEntry.deprecated,
        notes: catalogEntry.notes,
        perKey: {
          rpmUsed: Math.round(rpmUsed / poolMultiplier),
          rpmLimit: catalogEntry.rpmLimit,
          tpmUsed: Math.round(tpmUsed / poolMultiplier),
          tpmLimit: catalogEntry.tpmLimit,
          rpdUsed: effectivePerKeyRpdUsed,
          rpdLimit: catalogEntry.rpdLimit,
        },
        pool: {
          rpmUsed,
          rpmLimit: poolRpmLimit,
          tpmUsed,
          tpmLimit: poolTpmLimit,
          rpdUsed: effectivePoolRpdUsed,
          rpdLimit: poolRpdLimit,
        },
        errors429: mRec?.todayErrors429 || 0,
        readyKeysForModel: Math.max(0, validKeyIds.length - exhaustedDailyKeys - cooldownTempKeys),
        totalActiveKeys: validKeyIds.length,
        exhaustedDailyKeys,
        cooldownTempKeys,
        cooldownSec: maxModelCooldownSec,
        liveStatus,
        lastProbeAt: mRec?.lastProbeAt || 0,
        lastProbeCode: mRec?.lastProbeCode ?? null,
        lastLatencyMs: mRec?.lastProbeLatencyMs ?? null,
        lastErrorMessage: mRec?.lastErrorMessage || null,
        isPreferred: preferredModel === catalogEntry.id,
      };
    });

    const poolRpmLeft = readyKeys === 0 ? 0 : Math.max(0, poolRpmLeftSum);
    const poolRpmBlockedOrUsed = Math.max(0, poolRpmTotal - poolRpmLeft);
    const poolRpmPercent = poolRpmTotal > 0
      ? Math.min(100, Math.round((poolRpmBlockedOrUsed / poolRpmTotal) * 100))
      : 0;
    const poolDailyLeft = Math.max(0, poolDailyTotal - poolDailyUsed);
    const poolDailyPercent = poolDailyTotal > 0
      ? Math.min(100, Math.round((poolDailyUsed / poolDailyTotal) * 100))
      : 0;

    return {
      totalKeys: keysList.length,
      activeCount: readyKeys,
      totalRPM: readyKeys * rpmPerKey,
      keys: keyEntries,
      poolMultiplier,
      settings: {
        useAllKeysFast,
        rpmPerKey,
        dailyRpdPerKey,
        preferredModel,
      },
      quotaSummary: {
        pacificDate: this.pacificDate,
        activePrimaryModel,
        primaryModelDisplayName: activePrimaryEntry?.displayName || activePrimaryModel,
        totalKeys: keysList.length,
        readyKeys,
        cooldownKeys,
        dailyExhaustedKeys,
        invalidKeys,
        rpmUsed: poolRpmUsed,
        rpmTotal: poolRpmTotal,
        rpmLeft: poolRpmLeft,
        rpmPercent: poolRpmPercent,
        rpmResetsInSec: maxRpmResetSec,
        dailyUsed: poolDailyUsed,
        dailyTotal: poolDailyTotal,
        dailyLeft: poolDailyLeft,
        dailyPercent: poolDailyPercent,
        appTodayRequests: poolAppTodayRequests,
        reportedDailyLimitPerKey,
        todayTokens: poolTodayTokens,
        dailyResetsAt,
        dailyResetsInSec,
        readyCascadeModelsCount,
        totalCascadeModelsCount: DUBBING_CASCADE_MODELS.length,
      },
      modelRateLimits,
      timestamp: now,
    };
  }
}

const geminiQuotaTracker = new GeminiQuotaTracker();

module.exports = {
  GeminiQuotaTracker,
  geminiQuotaTracker,
  getKeyFingerprint,
  getPacificDateKey,
  getNextPacificMidnightMs,
  parseGeminiRateLimitDetails,
};
