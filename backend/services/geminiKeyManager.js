/**
 * Gemini Multi-Key Pool & Auto-Rotation Manager
 * Automatically detects multiple keys and seamlessly rotates on 429 / Rate Limit / Quota Exhaustion.
 */

const { GoogleGenAI } = require('@google/genai');

/**
 * Parses all available Gemini API keys from various sources:
 * - Passed string (single or comma/newline-separated)
 * - process.env.GEMINI_API_KEYS (comma-separated)
 * - process.env.GEMINI_API_KEY (comma or single)
 * - process.env.GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...
 */
function extractAllGeminiKeys(customInput = null) {
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

class GeminiKeyPool {
  constructor(initialKeyInput = null) {
    this.keys = extractAllGeminiKeys(initialKeyInput);
    if (this.keys.length > 0 && !initialKeyInput) {
      this.currentIndex = (globalStaggerIndex++) % this.keys.length;
    } else {
      this.currentIndex = 0;
    }
    this.clientCache = new Map(); // key -> GoogleGenAI instance

    if (this.keys.length > 0) {
      console.log(`[GeminiKeyPool] 🔑 Loaded ${this.keys.length} active Gemini API key(s) in pool (Active: Key #${this.currentIndex + 1}).`);
    }
  }

  getKeyCount() {
    return this.keys.length;
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  getCurrentKey() {
    if (this.keys.length === 0) return null;
    return this.keys[this.currentIndex];
  }

  getCurrentClient() {
    const key = this.getCurrentKey();
    if (!key) {
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

  rotateKey(reason = 'Rate limit / 429') {
    if (this.keys.length <= 1) return this.getCurrentKey();

    const oldIndex = this.currentIndex;
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;

    console.warn(
      `[GeminiKeyPool] 🔄 Key #${oldIndex + 1} hit quota or limit (${reason}). ` +
      `Switched to Key #${this.currentIndex + 1} of ${this.keys.length}.`
    );

    return this.getCurrentKey();
  }
}

/**
 * Creates a smart GenAI client wrapper that transparently auto-rotates
 * to the next key when a 429 / Quota / Resource Exhausted error occurs.
 */
function createSmartGenAIClient(initialKeyInput = null) {
  const pool = new GeminiKeyPool(initialKeyInput);
  if (pool.getKeyCount() === 0) {
    throw new Error('មិនរកឃើញ GEMINI_API_KEY ទេ! សូមបញ្ចូលក្នុង .env ឬក្នុង Settings នៃកម្មវិធី។');
  }

  function isQuotaOrRateLimitError(err) {
    if (!err) return false;
    const msg = String(err.message || err.toString() || '').toLowerCase();
    const status = err.status || err.statusCode;
    return (
      status === 429 ||
      status === 503 ||
      status === 401 ||
      status === 403 ||
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('unauthenticated') ||
      msg.includes('access_token_type_unsupported') ||
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

  // Dynamic Models Proxy
  const modelsProxy = {
    async generateContent(args) {
      const totalKeys = pool.getKeyCount();
      let lastErr = null;

      // Try across all keys in pool if rate-limited
      for (let attempt = 0; attempt < Math.max(1, totalKeys); attempt++) {
        try {
          const client = pool.getCurrentClient();
          return await client.models.generateContent(args);
        } catch (err) {
          lastErr = err;
          if (isQuotaOrRateLimitError(err) && totalKeys > 1) {
            pool.rotateKey(err.message || '429 Quota Exceeded');
            // Small pause before next key attempt
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    },
  };

  // Dynamic Files Proxy
  const filesProxy = {
    async upload(args) {
      const totalKeys = pool.getKeyCount();
      let lastErr = null;

      for (let attempt = 0; attempt < Math.max(1, totalKeys); attempt++) {
        try {
          const client = pool.getCurrentClient();
          return await client.files.upload(args);
        } catch (err) {
          lastErr = err;
          if (isQuotaOrRateLimitError(err) && totalKeys > 1) {
            pool.rotateKey(err.message || '429 Quota on file upload');
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    },
    async delete(args) {
      const client = pool.getCurrentClient();
      return await client.files.delete(args);
    },
  };

  // Dynamic Interactions Proxy (e.g. gemini-3.5-transcribe)
  const interactionsProxy = {
    async create(args) {
      const totalKeys = pool.getKeyCount();
      let lastErr = null;

      for (let attempt = 0; attempt < Math.max(1, totalKeys); attempt++) {
        try {
          const client = pool.getCurrentClient();
          if (client.interactions && typeof client.interactions.create === 'function') {
            return await client.interactions.create(args);
          }
          throw new Error('Interactions API not available on native client instance');
        } catch (err) {
          lastErr = err;
          if (isQuotaOrRateLimitError(err) && totalKeys > 1) {
            pool.rotateKey(err.message || '429 Quota on interactions');
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
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
  GeminiKeyPool,
  createSmartGenAIClient,
};
