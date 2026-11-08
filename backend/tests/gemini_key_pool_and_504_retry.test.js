const test = require('node:test');
const assert = require('node:assert');

const {
  GeminiKeyPool,
  isAuthOrInvalidKeyError,
  isQuotaOrRateLimitError,
  markKeyAsInvalid,
  isKeyInvalid,
  resetInvalidKeys,
  getGlobalInvalidKeys,
  createSmartGenAIClient,
} = require('../services/geminiKeyManager');

const {
  isRetryableVisionError,
  callGeminiVisionWithRetry,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');

test('GeminiKeyPool & 504 Timeout Resilience Suite', async (t) => {
  t.beforeEach(() => {
    resetInvalidKeys();
  });

  await t.test('1. Error classification: 401/403 vs 429/503/504', () => {
    // 401 / 403
    assert.strictEqual(isAuthOrInvalidKeyError({ status: 401, message: 'API key not valid' }), true);
    assert.strictEqual(isAuthOrInvalidKeyError({ message: 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. (401 UNAUTHENTICATED)' }), true);
    assert.strictEqual(isAuthOrInvalidKeyError({ status: 403, message: 'PERMISSION_DENIED' }), true);
    assert.strictEqual(isAuthOrInvalidKeyError({ message: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }), true);

    // 401/403 must NOT be classified as quota error
    assert.strictEqual(isQuotaOrRateLimitError({ status: 401, message: 'API key not valid' }), false);
    assert.strictEqual(isQuotaOrRateLimitError({ status: 403, message: 'PERMISSION_DENIED' }), false);

    // 429 / 503 are quota errors
    assert.strictEqual(isQuotaOrRateLimitError({ status: 429, message: 'RESOURCE_EXHAUSTED' }), true);
    assert.strictEqual(isQuotaOrRateLimitError({ status: 503, message: 'Service Unavailable' }), true);

    // 504 vision error classifier
    assert.strictEqual(isRetryableVisionError({ status: 504, message: '504 Gateway Timeout' }), true);
    assert.strictEqual(isRetryableVisionError({ message: '504 DEADLINE_EXCEEDED' }), true);
    assert.strictEqual(isRetryableVisionError({ message: 'Resource has been exhausted (e.g. check quota)' }), true);
    assert.strictEqual(isRetryableVisionError({ status: 503, message: 'The model is overloaded. Please try again later.' }), true);
    assert.strictEqual(isRetryableVisionError({ status: 400, message: 'Bad Request' }), false);
  });

  await t.test('2. 401 dead key is marked INVALID and permanently removed from rotation', async () => {
    const fakeKeys = 'AIzaSyFakeKey1_ValidLen,AIzaSyFakeKey2_ValidLen,AIzaSyFakeKey3_ValidLen';
    const pool = new GeminiKeyPool(fakeKeys);
    assert.strictEqual(pool.getKeyCount(), 3);

    // Intercept console.warn to verify exact log line requirement
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      // Simulate Key #1 failing with 401
      const key1 = pool.allKeysWithIndex[0].key;
      pool.markKeyInvalid(key1, 401);

      // Verify log line format: "Key #N invalid (401) — removed from pool, M keys remaining"
      const expectedLogMatch = warnings.some((w) =>
        w.includes('Key #1 invalid (401) — removed from pool, 2 keys remaining')
      );
      assert.strictEqual(expectedLogMatch, true, 'Must log exact line with Key #N, 401, and remaining count');

      // Verify key count is now 2
      assert.strictEqual(pool.getKeyCount(), 2);
      assert.strictEqual(pool.keys.length, 2);
      assert.strictEqual(isKeyInvalid(key1), true);

      // Rotating through pool will never return key1
      const rotatedKeys = new Set();
      for (let i = 0; i < 6; i++) {
        rotatedKeys.add(pool.getCurrentKey());
        pool.rotateKey('test');
      }
      assert.strictEqual(rotatedKeys.has(key1), false, 'Dead key must never be selected');
      assert.strictEqual(rotatedKeys.size, 2, 'Only the remaining 2 keys are cycled');
    } finally {
      console.warn = origWarn;
    }
  });

  await t.test('3. If all keys become invalid, fails fast with explicit error instead of looping', async () => {
    const fakeKeys = 'AIzaSyFakeKey1_ValidLen,AIzaSyFakeKey2_ValidLen';
    const pool = new GeminiKeyPool(fakeKeys);

    pool.markKeyInvalid(pool.allKeysWithIndex[0].key, 401);
    pool.markKeyInvalid(pool.allKeysWithIndex[1].key, 403);

    assert.strictEqual(pool.getKeyCount(), 0);

    assert.throws(
      () => pool.getCurrentClient(),
      (err) => err.message.includes('INVALID (401/403')
    );
  });

  await t.test('4. 429 Quota error preserves key in rotation', () => {
    const fakeKeys = 'AIzaSyFakeKey1_ValidLen,AIzaSyFakeKey2_ValidLen';
    const pool = new GeminiKeyPool(fakeKeys);

    const initialKey = pool.getCurrentKey();
    pool.rotateKey('429 Quota Exceeded');
    const nextKey = pool.getCurrentKey();

    assert.notStrictEqual(initialKey, nextKey, 'Should rotate to next key');
    assert.strictEqual(pool.getKeyCount(), 2, 'Key count must remain 2');
    assert.strictEqual(isKeyInvalid(initialKey), false, '429 must NOT mark key invalid');
  });

  await t.test('5. 504 DEADLINE_EXCEEDED triggers cascade across models in callGeminiVisionWithRetry', async () => {
    const attemptedModels = [];

    // Mock AI client that throws 504 on first model, succeeds on second model
    const mockAiClient = {
      models: {
        generateContent: async ({ model }) => {
          attemptedModels.push(model);
          if (model === 'gemini-3.5-flash-lite') {
            const err = new Error('504 DEADLINE_EXCEEDED: Gateway Timeout');
            err.status = 504;
            throw err;
          }
          return { text: () => '{"frames":[]}' };
        },
      },
    };

    const resp = await callGeminiVisionWithRetry(
      mockAiClient,
      'gemini-3.5-flash-lite',
      [{ text: 'test' }],
      1 // 1 retry per model to make test instant
    );

    assert.ok(resp, 'Must succeed when cascaded to next model');
    assert.strictEqual(attemptedModels[0], 'gemini-3.5-flash-lite', 'First tried requested model');
    assert.strictEqual(attemptedModels.includes('gemini-2.5-flash'), true, 'Cascaded to alternative model on 504');
  });

  await t.test('6. Unrecoverable cascade failure throws clear error for chunk failure', async () => {
    const mockAiClient = {
      models: {
        generateContent: async () => {
          const err = new Error('504 DEADLINE_EXCEEDED');
          err.status = 504;
          throw err;
        },
      },
    };

    await assert.rejects(
      async () => {
        await callGeminiVisionWithRetry(mockAiClient, 'gemini-3.5-flash-lite', [], 1);
      },
      (err) => err.message.includes('504') || err.message.includes('exceeded quota')
    );
  });
});
