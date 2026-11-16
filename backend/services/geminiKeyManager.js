/**
 * Gemini Multi-Key Pool & Auto-Rotation Manager
 * Automatically detects multiple keys and seamlessly rotates on 429 / Rate Limit / Quota Exhaustion.
 */

const fs = require('fs');
const dotenv = require('dotenv');
const { GoogleGenAI } = require('@google/genai');
const { geminiQuotaTracker } = require('./geminiQuotaTracker');

const GEMINI_KEY_ENV_REGEX = /^GEMINI_API_KEYS?$|^GEMINI_API_KEY_?\d+$/;
let liveDotenvPaths = [];
let liveDotenvStatCache = new Map();
let managedEnvKeys = new Set();

function isGeminiKeyEnvName(name) {
  return GEMINI_KEY_ENV_REGEX.test(String(name || ''));
}

/**
 * Registers .env files for lightweight mtime-based key hot-reload in running server mode.
 * Kept opt-in (called by server.js on boot) so unit tests remain completely isolated from real .env files.
 */
function registerLiveDotenvFiles(filePaths = []) {
  liveDotenvPaths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
  liveDotenvStatCache = new Map();
  managedEnvKeys = new Set();
  return syncGeminiKeysFromEnvFilesIfChanged();
}

function resetLiveDotenvFiles() {
  liveDotenvPaths = [];
  liveDotenvStatCache = new Map();
  managedEnvKeys = new Set();
}

/**
 * Re-parses registered .env files only when mtime/size changes, updating GEMINI_API_KEY* vars
 * in process.env without restarting Node or interrupting active dubbing/TTS/Demucs jobs.
 */
function syncGeminiKeysFromEnvFilesIfChanged(pathsOverride = null) {
  const targetPaths = Array.isArray(pathsOverride) ? pathsOverride : liveDotenvPaths;
  if (!targetPaths || targetPaths.length === 0) return false;

  let changed = false;
  const nextStats = new Map();
  for (const envPath of targetPaths) {
    let sig = 'missing';
    try {
      const st = fs.statSync(envPath);
      sig = `${st.mtimeMs}:${st.size}`;
    } catch (_) {}
    nextStats.set(envPath, sig);
    if (liveDotenvStatCache.get(envPath) !== sig) {
      changed = true;
    }
  }

  if (!changed) return false;

  const mergedGeminiVars = {};
  for (const envPath of targetPaths) {
    try {
      if (!fs.existsSync(envPath)) continue;
      const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      for (const [key, val] of Object.entries(parsed || {})) {
        if (isGeminiKeyEnvName(key)) {
          mergedGeminiVars[key] = String(val ?? '');
        }
      }
    } catch (_) {}
  }

  for (const prevKey of managedEnvKeys) {
    if (!Object.prototype.hasOwnProperty.call(mergedGeminiVars, prevKey)) {
      delete process.env[prevKey];
    }
  }

  for (const [key, val] of Object.entries(mergedGeminiVars)) {
    process.env[key] = val;
    managedEnvKeys.add(key);
  }

  liveDotenvStatCache = nextStats;
  return true;
}

/**
 * Parses all available Gemini API keys from various sources:
 * - Passed string (single or comma/newline-separated)
 * - process.env.GEMINI_API_KEYS (comma-separated)
 * - process.env.GEMINI_API_KEY (comma or single)
 * - process.env.GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...
 */
function extractAllGeminiKeys(customInput = null) {
  if (!customInput && liveDotenvPaths.length > 0) {
    syncGeminiKeysFromEnvFilesIfChanged();
  }

  const rawList = [];

  // 1. From custom input (e.g. from UI or argument)
  if (customInput && typeof customInput === 'string') {
    rawList.push(...customInput.split(/[\n,;]+/));
  }

  // 2. From GEMINI_API_KEYS (plural)
  if (process.env.GEMINI_API_KEYS) {
    rawList.push(...process.env.GEMINI_API_KEYS.split(/[\n,;]+/));
  }

  // 3. From GEMINI_API_KEY (can be comma-separated or single)
  if (process.env.GEMINI_API_KEY) {
    rawList.push(...process.env.GEMINI_API_KEY.split(/[\n,;]+/));
  }

  // 4. From numbered keys GEMINI_API_KEY1, GEMINI_API_KEY2, or GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
  for (let i = 1; i <= 20; i++) {
    const k1 = process.env[`GEMINI_API_KEY_${i}`];
    if (k1) rawList.push(k1);
    const k2 = process.env[`GEMINI_API_KEY${i}`];
    if (k2) rawList.push(k2);
  }

  // Clean, trim, and filter unique valid keys
  const cleaned = [];
  const seen = new Set();
  for (const item of rawList) {
    const k = String(item || '').trim();
    if (k && k.length >= 8 && !seen.has(k)) {
      seen.add(k);
      cleaned.push(k);
    }
  }

  return cleaned;
}

let globalStaggerIndex = 0;
const globalInvalidKeys = new Set();

/**
 * Checks if an error is an authentication / invalid key error (401 / 403).
 */
function isAuthOrInvalidKeyError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  const msg = String(err.message || err.toString() || '').toLowerCase();

  // Explicit quota and rate limit errors must NEVER be treated as invalid keys
  if (
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('high demand')
  ) {
    return false;
  }

  return (
    status === 401 ||
    status === 403 ||
    msg.includes('unauthenticated') ||
    msg.includes('api key not valid') ||
    msg.includes('api_key_invalid') ||
    msg.includes('access_token_type_unsupported') ||
    msg.includes('permission_denied')
  );
}

/**
 * Checks if an error is a temporary rate limit or quota error (429 / 503).
 * Note: 401/403 are explicitly NOT treated as quota/rate limits.
 */
function isQuotaOrRateLimitError(err) {
  if (!err) return false;
  if (isAuthOrInvalidKeyError(err)) return false;
  const status = err.status || err.statusCode;
  const msg = String(err.message || err.toString() || '').toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('high demand') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('socket hang up')
  );
}

function markKeyAsInvalid(key, statusOrReason = 401) {
  if (!key) return;
  globalInvalidKeys.add(key);
}

function isKeyInvalid(key) {
  return globalInvalidKeys.has(key);
}

function getGlobalInvalidKeys() {
  return globalInvalidKeys;
}

function resetInvalidKeys() {
  globalInvalidKeys.clear();
}

class GeminiKeyPool {
  constructor(initialKeyInput = null) {
    const rawKeys = extractAllGeminiKeys(initialKeyInput);
    this.allKeysWithIndex = rawKeys.map((k, idx) => ({ key: k, originalNum: idx + 1 }));
    this.clientCache = new Map(); // key -> GoogleGenAI instance
    this.currentIndex = 0;

    const active = this.getActiveKeys();
    if (active.length > 0 && !initialKeyInput) {
      this.currentIndex = (globalStaggerIndex++) % active.length;
    } else {
      this.currentIndex = 0;
    }

    if (active.length > 0) {
      console.log(`[GeminiKeyPool] 🔑 Loaded ${active.length} active Gemini API key(s) in pool (Active: Key #${active[this.currentIndex].originalNum}).`);
    } else if (this.allKeysWithIndex.length > 0) {
      console.warn(`[GeminiKeyPool] ⚠️ All ${this.allKeysWithIndex.length} Gemini API keys are marked invalid.`);
    }
  }

  getActiveKeys() {
    return this.allKeysWithIndex.filter((item) => !globalInvalidKeys.has(item.key));
  }

  get keys() {
    return this.getActiveKeys().map((item) => item.key);
  }

  getKeyCount() {
    return this.getActiveKeys().length;
  }

  getTotalKeyCount() {
    return this.allKeysWithIndex.length;
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  getCurrentKeyInfo() {
    const active = this.getActiveKeys();
    if (active.length === 0) return null;
    if (this.currentIndex >= active.length) {
      this.currentIndex = 0;
    }
    return active[this.currentIndex];
  }

  getCurrentKey() {
    const info = this.getCurrentKeyInfo();
    return info ? info.key : null;
  }

  getCurrentClient() {
    const key = this.getCurrentKey();
    if (!key) {
      if (this.allKeysWithIndex.length > 0 && this.getActiveKeys().length === 0) {
        throw new Error('[GeminiKeyPool] 🚨 All Gemini API keys in pool are INVALID (401/403 Unauthenticated/Forbidden). Cannot proceed.');
      }
      throw new Error('មិនរកឃើញ GEMINI_API_KEY ទេ! សូមបញ្ចូលក្នុង .env ឬក្នុង Settings នៃកម្មវិធី។');
    }

    if (!this.clientCache.has(key)) {
      const client = new GoogleGenAI({
        apiKey: key,
        httpOptions: { timeout: 180000 },
      });
      this.clientCache.set(key, client);
    }

    return this.clientCache.get(key);
  }

  markKeyInvalid(key, statusOrReason = 401) {
    if (!key) return;
    const isNew = !globalInvalidKeys.has(key);
    globalInvalidKeys.add(key);

    const item = this.allKeysWithIndex.find((i) => i.key === key);
    const keyNum = item ? item.originalNum : '?';
    const active = this.getActiveKeys();
    const remaining = active.length;

    if (isNew) {
      console.warn(`[GeminiKeyPool] ❌ Key #${keyNum} invalid (${statusOrReason || 401}) — removed from pool, ${remaining} keys remaining`);
    }

    if (active.length > 0) {
      this.currentIndex = this.currentIndex % active.length;
    } else {
      this.currentIndex = 0;
    }

    return remaining;
  }

  rotateKey(reason = 'Rate limit / 429') {
    const active = this.getActiveKeys();
    if (active.length === 0) return null;
    if (active.length === 1) return active[0].key;

    const oldKeyInfo = active[this.currentIndex % active.length];
    this.currentIndex = (this.currentIndex + 1) % active.length;
    const newKeyInfo = active[this.currentIndex];

    console.warn(
      `[GeminiKeyPool] 🔄 Key #${oldKeyInfo.originalNum} hit quota or limit (${reason}). ` +
      `Switched to Key #${newKeyInfo.originalNum} of ${this.allKeysWithIndex.length} (${active.length} active remaining).`
    );

    return newKeyInfo.key;
  }
}

/**
 * Creates a smart GenAI client wrapper that transparently auto-rotates
 * to the next key when a 429 / Quota / Resource Exhausted error occurs,
 * and permanently disables invalid 401/403 keys from the rotation.
 */
function createSmartGenAIClient(initialKeyInput = null) {
  const pool = new GeminiKeyPool(initialKeyInput);
  if (pool.getKeyCount() === 0) {
    if (pool.getTotalKeyCount() > 0) {
      throw new Error('[GeminiKeyPool] 🚨 All Gemini API keys in pool are INVALID (401/403 Unauthenticated/Forbidden). Cannot proceed.');
    }
    throw new Error('មិនរកឃើញ GEMINI_API_KEY ទេ! សូមបញ្ចូលក្នុង .env ឬក្នុង Settings នៃកម្មវិធី។');
  }

  function selectReadyKeyIfAvailable(modelName = null) {
    const activeCount = pool.getKeyCount();
    if (activeCount <= 1) return pool.getCurrentKey();
    const now = Date.now();
    for (let step = 0; step < activeCount; step++) {
      const candidate = pool.getCurrentKey();
      if (!candidate) break;
      const cd = geminiQuotaTracker.isKeyInCooldown(candidate, now, modelName);
      if (!cd.inCooldown) return candidate;
      pool.rotateKey(`Skip ${modelName || 'key'} cooldown (${cd.cooldownSec}s left)`);
    }
    return pool.getCurrentKey();
  }

  async function runWithPool(execFn, { getModel = () => null, errorLabel = 'Quota Exceeded' } = {}) {
    let lastErr = null;
    let quotaAttempts = 0;

    while (pool.getKeyCount() > 0) {
      const modelName = getModel();
      const currentKey = selectReadyKeyIfAvailable(modelName);
      const pacingDelay = geminiQuotaTracker.getRecommendedPacingDelayMs(currentKey);
      if (pacingDelay > 0) {
        await new Promise((r) => setTimeout(r, pacingDelay));
      }

      const startedAt = Date.now();
      try {
        const client = pool.getCurrentClient();
        const result = await execFn(client);
        try {
          const totalTokens = result?.usageMetadata?.totalTokenCount || 0;
          geminiQuotaTracker.recordSuccess(currentKey, {
            model: modelName,
            totalTokens,
            latencyMs: Date.now() - startedAt,
          });
        } catch (_) {}
        return result;
      } catch (err) {
        lastErr = err;

        // 1. Permanent Auth/Invalid Key Failure (401 / 403)
        if (isAuthOrInvalidKeyError(err)) {
          const status = err.status || err.statusCode || 401;
          try {
            geminiQuotaTracker.recordInvalid(currentKey, status, err.message, {
              latencyMs: Date.now() - startedAt,
            });
          } catch (_) {}
          const remaining = pool.markKeyInvalid(currentKey, status);
          if (remaining === 0) {
            throw new Error(`[GeminiKeyPool] 🚨 All Gemini API keys in pool are INVALID (${status} Unauthenticated/Forbidden). Cannot proceed.`);
          }
          continue;
        }

        // 2. Temporary Quota / Rate Limit (429 / 503)
        if (isQuotaOrRateLimitError(err)) {
          try {
            geminiQuotaTracker.recordRateLimit(currentKey, err, {
              model: modelName,
              latencyMs: Date.now() - startedAt,
            });
          } catch (_) {}

          if (pool.getKeyCount() > 1) {
            quotaAttempts++;
            if (quotaAttempts >= pool.getKeyCount()) {
              throw err;
            }
            pool.rotateKey(err.message || `429 ${errorLabel}`);
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
        }

        throw err;
      }
    }
    throw lastErr || new Error('[GeminiKeyPool] 🚨 All Gemini API keys in pool are INVALID (401/403). Cannot proceed.');
  }

  // Dynamic Models Proxy
  const modelsProxy = {
    async generateContent(args) {
      return await runWithPool((client) => client.models.generateContent(args), {
        getModel: () => args?.model || null,
        errorLabel: 'Quota Exceeded',
      });
    },
  };

  // Dynamic Files Proxy
  const filesProxy = {
    async upload(args) {
      return await runWithPool((client) => client.files.upload(args), {
        getModel: () => 'files.upload',
        errorLabel: 'Quota on file upload',
      });
    },
    async delete(args) {
      const client = pool.getCurrentClient();
      return await client.files.delete(args);
    },
  };

  // Dynamic Interactions Proxy (e.g. gemini-3.5-transcribe)
  const interactionsProxy = {
    async create(args) {
      return await runWithPool(
        (client) => {
          if (client.interactions && typeof client.interactions.create === 'function') {
            return client.interactions.create(args);
          }
          throw new Error('Interactions API not available on native client instance');
        },
        {
          getModel: () => args?.model || 'interactions',
          errorLabel: 'Quota on interactions',
        }
      );
    },
  };

  return {
    models: modelsProxy,
    files: filesProxy,
    interactions: interactionsProxy,
    get pool() {
      return pool;
    },
    get activeKey() {
      return pool.getCurrentKey();
    },
    rotateKey(reason) {
      return pool.rotateKey(reason);
    },
  };
}

module.exports = {
  extractAllGeminiKeys,
  registerLiveDotenvFiles,
  resetLiveDotenvFiles,
  syncGeminiKeysFromEnvFilesIfChanged,
  GeminiKeyPool,
  createSmartGenAIClient,
  isAuthOrInvalidKeyError,
  isQuotaOrRateLimitError,
  markKeyAsInvalid,
  isKeyInvalid,
  getGlobalInvalidKeys,
  resetInvalidKeys,
};
