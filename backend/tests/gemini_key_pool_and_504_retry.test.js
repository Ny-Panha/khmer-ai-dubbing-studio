const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  extractAllGeminiKeys,
  registerLiveDotenvFiles,
  resetLiveDotenvFiles,
  GeminiKeyPool,
  isAuthOrInvalidKeyError,
  isModelUnavailableError,
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

  await t.test('1. Error classification: 401/403 vs 503/504 vs 429', () => {
    // 401 / 403
    assert.strictEqual(isAuthOrInvalidKeyError({ status: 401, message: 'API key not valid' }), true);
    assert.strictEqual(isAuthOrInvalidKeyError({ message: 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. (401 UNAUTHENTICATED)' }), true);
    assert.strictEqual(isAuthOrInvalidKeyError({ status: 403, message: 'PERMISSION_DENIED' }), true);
    assert.strictEqual(isAuthOrInvalidKeyError({ message: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }), true);

    // 401/403 must NOT be classified as model unavailable or quota error
    assert.strictEqual(isModelUnavailableError({ status: 401, message: 'API key not valid' }), false);
    assert.strictEqual(isQuotaOrRateLimitError({ status: 401, message: 'API key not valid' }), false);
    assert.strictEqual(isQuotaOrRateLimitError({ status: 403, message: 'PERMISSION_DENIED' }), false);

    // 503 / 504 model unavailable classifier (must return true for isModelUnavailableError, and false for isQuotaOrRateLimitError)
    assert.strictEqual(isModelUnavailableError({ status: 503, message: 'Service Unavailable' }), true);
    assert.strictEqual(isModelUnavailableError({ message: 'This model is currently experiencing high demand.' }), true);
    assert.strictEqual(isModelUnavailableError({ status: 504, message: 'Deadline Exceeded' }), true);
    assert.strictEqual(isModelUnavailableError({ message: '504 DEADLINE_EXCEEDED' }), true);
    assert.strictEqual(isModelUnavailableError({ message: 'Service is temporarily unavailable' }), true);

    // 503 / 504 must NOT be classified as key quota/rate limit error
    assert.strictEqual(isQuotaOrRateLimitError({ status: 503, message: 'Service Unavailable' }), false);
    assert.strictEqual(isQuotaOrRateLimitError({ message: 'This model is currently experiencing high demand.' }), false);
    assert.strictEqual(isQuotaOrRateLimitError({ status: 504, message: 'Deadline Exceeded' }), false);

    // 429 is a quota error (NOT model unavailable)
    assert.strictEqual(isQuotaOrRateLimitError({ status: 429, message: 'RESOURCE_EXHAUSTED' }), true);
    assert.strictEqual(isQuotaOrRateLimitError({ message: 'Quota exceeded for quota metric' }), true);
    assert.strictEqual(isModelUnavailableError({ status: 429, message: 'RESOURCE_EXHAUSTED' }), false);

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

  await t.test('7. Live .env sync reloads newly added GEMINI_API_KEY5+ without restart and ignores blank slots', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live_env_keys_'));
    const rootEnv = path.join(tmpDir, 'root.env');
    const backendEnv = path.join(tmpDir, 'backend.env');
    const prevSnapshot = {};
    for (let i = 1; i <= 6; i++) {
      prevSnapshot[`GEMINI_API_KEY${i}`] = process.env[`GEMINI_API_KEY${i}`];
      delete process.env[`GEMINI_API_KEY${i}`];
    }

    try {
      fs.writeFileSync(
        rootEnv,
        [
          'GEMINI_API_KEY1=MockTestKey_One_111111',
          'GEMINI_API_KEY2=MockTestKey_Two_222222',
          'GEMINI_API_KEY3=MockTestKey_Three_3333',
          'GEMINI_API_KEY4=MockTestKey_Four_44444',
        ].join('\n'),
        'utf8'
      );
      fs.writeFileSync(
        backendEnv,
        [
          'GEMINI_API_KEY1=MockTestKey_One_111111',
          'GEMINI_API_KEY2=MockTestKey_Two_222222',
          'GEMINI_API_KEY3=MockTestKey_Three_3333',
          'GEMINI_API_KEY4=MockTestKey_Four_44444',
          'GEMINI_API_KEY5=MockTestKey_Five_55555',
          'GEMINI_API_KEY6=',
        ].join('\n'),
        'utf8'
      );

      registerLiveDotenvFiles([rootEnv, backendEnv]);
      const keysFive = extractAllGeminiKeys();
      assert.strictEqual(keysFive.length, 5);
      assert.strictEqual(keysFive[4], 'MockTestKey_Five_55555');

      // Simulate filling GEMINI_API_KEY6 while backend stays running
      fs.writeFileSync(
        backendEnv,
        [
          'GEMINI_API_KEY1=MockTestKey_One_111111',
          'GEMINI_API_KEY2=MockTestKey_Two_222222',
          'GEMINI_API_KEY3=MockTestKey_Three_3333',
          'GEMINI_API_KEY4=MockTestKey_Four_44444',
          'GEMINI_API_KEY5=MockTestKey_Five_55555',
          'GEMINI_API_KEY6=MockTestKey_Six_666666',
        ].join('\n'),
        'utf8'
      );
      // Force mtime delta on fast Windows filesystems
      const futureTime = new Date(Date.now() + 3000);
      fs.utimesSync(backendEnv, futureTime, futureTime);

      const keysSix = extractAllGeminiKeys();
      assert.strictEqual(keysSix.length, 6);
      assert.strictEqual(keysSix[5], 'MockTestKey_Six_666666');
    } finally {
      resetLiveDotenvFiles();
      for (const [k, v] of Object.entries(prevSnapshot)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('8. 503/504 Model Unavailable handling in runWithPool', async (t2) => {
    const fakeKeys = 'AIzaSyFakeKey1_ValidLen,AIzaSyFakeKey2_ValidLen,AIzaSyFakeKey3_ValidLen';

    await t2.test('(a) execFn always throws 503 -> throws after at most 2 attempts, 0 key rotations, tagged modelUnavailable', async () => {
      const client = createSmartGenAIClient(fakeKeys, { modelUnavailableDelayMs: 0 });
      let execCalls = 0;
      let rotateCalls = 0;
      const origRotateKey = client.pool.rotateKey.bind(client.pool);
      client.pool.rotateKey = (reason) => {
        rotateCalls++;
        return origRotateKey(reason);
      };

      const warnings = [];
      const origWarn = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));

      try {
        const err503 = new Error('503 This model is currently experiencing high demand.');
        err503.status = 503;

        await assert.rejects(
          async () => {
            await client.runWithPool(
              async () => {
                execCalls++;
                throw err503;
              },
              { getModel: () => 'gemini-503-model-a', backoffDelayMs: 0 }
            );
          },
          (err) => {
            assert.strictEqual(err.status, 503);
            assert.strictEqual(err.modelUnavailable, true, 'Error must be tagged modelUnavailable');
            return true;
          }
        );

        assert.strictEqual(execCalls, 2, 'Must stop after at most 2 attempts on 503');
        assert.strictEqual(rotateCalls, 0, 'rotateKey must NEVER be called for 503/model-unavailable');
        const loggedBusy = warnings.some((w) =>
          w.includes('[GeminiKeyPool] ⚠️ Model gemini-503-model-a busy (503) after 2 attempts — handing back for cascade switch.')
        );
        assert.strictEqual(loggedBusy, true, 'Must log clear single line on 503 exhaustion without "hit quota or limit"');
      } finally {
        console.warn = origWarn;
      }
    });

    await t2.test('(b) execFn throws 503 once then succeeds -> returns result (2 calls total, 0 key rotations)', async () => {
      const client = createSmartGenAIClient(fakeKeys, { modelUnavailableDelayMs: 0 });
      let execCalls = 0;
      let rotateCalls = 0;
      const origRotateKey = client.pool.rotateKey.bind(client.pool);
      client.pool.rotateKey = (reason) => {
        rotateCalls++;
        return origRotateKey(reason);
      };

      const result = await client.runWithPool(
        async () => {
          execCalls++;
          if (execCalls === 1) {
            const err503 = new Error('503 UNAVAILABLE');
            err503.status = 503;
            throw err503;
          }
          return { success: true, data: 'recovered_after_retry' };
        },
        { getModel: () => 'gemini-503-model-b', backoffDelayMs: 0 }
      );

      assert.deepStrictEqual(result, { success: true, data: 'recovered_after_retry' });
      assert.strictEqual(execCalls, 2, 'Must succeed on second attempt (2 calls total)');
      assert.strictEqual(rotateCalls, 0, 'rotateKey must NEVER be called when retrying 503 on same model');
    });

    await t2.test('(c) execFn throws 429 -> existing rotation behavior still works (key rotates, succeeds on next key)', async () => {
      const client = createSmartGenAIClient(fakeKeys);
      let execCalls = 0;
      let rotateCalls = 0;
      const origRotateKey = client.pool.rotateKey.bind(client.pool);
      client.pool.rotateKey = (reason) => {
        rotateCalls++;
        return origRotateKey(reason);
      };

      const initialKey = client.pool.getCurrentKey();
      const result = await client.runWithPool(
        async () => {
          execCalls++;
          if (execCalls === 1) {
            const err429 = new Error('429 RESOURCE_EXHAUSTED: Rate limit exceeded');
            err429.status = 429;
            throw err429;
          }
          return { success: true, activeKey: client.pool.getCurrentKey() };
        },
        { getModel: () => 'gemini-429-model-c' }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(execCalls, 2, 'Executes once on failing key and once on rotated key');
      assert.strictEqual(rotateCalls, 1, 'Key rotated exactly once for 429');
      assert.notStrictEqual(result.activeKey, initialKey, 'Must use next key after 429');
    });

    await t2.test('(d) execFn throws 401 -> key is marked invalid and removed, as before', async () => {
      const client = createSmartGenAIClient(fakeKeys);
      let execCalls = 0;
      const initialKeyCount = client.pool.getKeyCount();
      const failingKey = client.pool.getCurrentKey();

      const result = await client.runWithPool(
        async () => {
          execCalls++;
          if (execCalls === 1) {
            const err401 = new Error('401 API key not valid');
            err401.status = 401;
            throw err401;
          }
          return { success: true, activeKey: client.pool.getCurrentKey() };
        },
        { getModel: () => 'gemini-401-model-d' }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(isKeyInvalid(failingKey), true, 'Key that hit 401 must be marked invalid');
      assert.strictEqual(client.pool.getKeyCount(), initialKeyCount - 1, 'Key count must be reduced by 1');
      assert.notStrictEqual(result.activeKey, failingKey, 'Result must be obtained from a different active key');
    });
  });

  await t.test('9. 503 Model Unavailable in callGeminiVisionWithRetry cascades immediately without burning retries and marks modelUsed', async () => {
    const attemptedModels = [];
    let firstModelCalls = 0;

    const mockAiClient = {
      models: {
        generateContent: async ({ model }) => {
          attemptedModels.push(model);
          if (model === 'gemini-3.5-flash-lite') {
            firstModelCalls++;
            const err = new Error('503 Service Unavailable: High demand');
            err.status = 503;
            err.modelUnavailable = true;
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
      2 // maxRetries=2
    );

    assert.ok(resp, 'Must succeed when cascaded to next model');
    assert.strictEqual(firstModelCalls, 1, 'Must cascade immediately on 503 without burning 2nd attempt in Stage 3');
    assert.strictEqual(resp.modelUsed, attemptedModels[1], 'Must tag modelUsed on returned response');
  });
});
