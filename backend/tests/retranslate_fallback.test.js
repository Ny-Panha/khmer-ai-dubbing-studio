const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const {
  retranslateSingleDialogue,
  retranslateBatchDialogues,
  isModelFallbackEligibleError,
} = require('../services/geminiService');
const scriptRoutes = require('../routes/scriptRoutes');

test('Retranslate Model Fallback & Route Error Mapping Suite', async (t) => {
  await t.test('1. isModelFallbackEligibleError classifies 429/503/504/404 vs 401/403/400 accurately', () => {
    assert.equal(isModelFallbackEligibleError({ status: 429, message: 'RESOURCE_EXHAUSTED' }), true);
    assert.equal(isModelFallbackEligibleError({ status: 503, message: 'Service Unavailable' }), true);
    assert.equal(isModelFallbackEligibleError({ status: 504, message: 'DEADLINE_EXCEEDED' }), true);
    assert.equal(isModelFallbackEligibleError({ status: 404, message: 'no longer available to new users' }), true);

    assert.equal(isModelFallbackEligibleError({ status: 401, message: 'API key not valid' }), false);
    assert.equal(isModelFallbackEligibleError({ status: 403, message: 'PERMISSION_DENIED' }), false);
    assert.equal(isModelFallbackEligibleError({ status: 400, message: 'Invalid argument' }), false);
  });

  await t.test('2. retranslateSingleDialogue cascades from 429 gemini-3.5-flash-lite to gemini-3.1-flash-lite', async () => {
    const attemptedModels = [];
    const mockAiClient = {
      models: {
        generateContent: async ({ model }) => {
          attemptedModels.push(model);
          if (model === 'gemini-3.5-flash-lite') {
            const err = new Error('{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}');
            err.status = 429;
            throw err;
          }
          return {
            text: JSON.stringify({
              chinese: '这五意凝天决想必适合你',
              options: [
                { style: 'classical', label: '🎭 សម្ដីកុនបុរាណ', text: 'ក្បាច់គុនទាំងប្រាំនេះពិតជាសក្តិសមនឹងអ្នកណាស់។' },
                { style: 'compact', label: '📝 ខ្លីចំអត្ថន័យ', text: 'វិជ្ជាទាំងប្រាំនេះសមនឹងអ្នក។' },
                { style: 'dramatic', label: '⚡ អារម្មណ៍តួអង្គ', text: 'វិជ្ជាប្រាំយ៉ាងនេះ ពិតជាត្រូវនឹងឯងមែន!' },
              ],
              note: '五意凝天决 = ក្បាច់គុន ឬវិជ្ជាពិសេស',
            }),
          };
        },
      },
    };

    const res = await retranslateSingleDialogue('这五意凝天决想必适合你', null, {
      aiClient: mockAiClient,
      fallbackModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
      timeoutMs: 2000,
    });

    assert.deepEqual(attemptedModels, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    assert.equal(res.modelUsed, 'gemini-3.1-flash-lite');
    assert.equal(res.options.length, 3);
    assert.ok(res.options[0].text.includes('សក្តិសម'));
  });

  await t.test('3. retranslateSingleDialogue cascades past 404 & 504 errors without failing prematurely', async () => {
    const attemptedModels = [];
    const mockAiClient = {
      models: {
        generateContent: async ({ model }) => {
          attemptedModels.push(model);
          if (model === 'gemini-3.5-flash-lite') {
            const err = new Error('This model is no longer available to new users');
            err.status = 404;
            throw err;
          }
          if (model === 'gemini-3.1-flash-lite') {
            const err = new Error('Deadline expired before operation could complete');
            err.status = 504;
            throw err;
          }
          return {
            text: JSON.stringify({
              chinese: '你好',
              options: [{ style: 'classical', label: '🎭 សម្ដីកុនបុរាណ', text: 'សួស្តី!' }],
              note: '',
            }),
          };
        },
      },
    };

    const res = await retranslateSingleDialogue('你好', null, {
      aiClient: mockAiClient,
      fallbackModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
      timeoutMs: 2000,
    });

    assert.deepEqual(attemptedModels, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']);
    assert.equal(res.modelUsed, 'gemini-3.8-flash');
    assert.equal(res.options[0].text, 'សួស្តី!');
  });

  await t.test('4. retranslateSingleDialogue fails fast on 401 auth error without cascading', async () => {
    const attemptedModels = [];
    const mockAiClient = {
      models: {
        generateContent: async ({ model }) => {
          attemptedModels.push(model);
          const err = new Error('API key not valid (401)');
          err.status = 401;
          throw err;
        },
      },
    };

    await assert.rejects(
      () =>
        retranslateSingleDialogue('你好', null, {
          aiClient: mockAiClient,
          fallbackModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
          timeoutMs: 2000,
        }),
      (err) => err.status === 401
    );

    assert.deepEqual(attemptedModels, ['gemini-3.5-flash-lite']);
  });

  await t.test('5. retranslateBatchDialogues cascades from 429 primary model to fallback model', async () => {
    const attemptedModels = [];
    const mockAiClient = {
      models: {
        generateContent: async ({ model }) => {
          attemptedModels.push(model);
          if (model === 'gemini-3.5-flash-lite') {
            const err = new Error('RESOURCE_EXHAUSTED 429');
            err.status = 429;
            throw err;
          }
          return {
            text: JSON.stringify([{ id: 1, khmerText: 'ក្បាច់គុននេះសមនឹងអ្នកណាស់' }]),
          };
        },
      },
    };

    const updated = await retranslateBatchDialogues(
      [{ id: 1, originalChineseText: '这五意凝天决想必适合你', startSec: 0, endSec: 2 }],
      null,
      {
        aiClient: mockAiClient,
        fallbackModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
        timeoutMs: 2000,
      }
    );

    assert.deepEqual(attemptedModels, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    assert.equal(updated[0].khmerText, 'ក្បាច់គុននេះសមនឹងអ្នកណាស់');
    assert.equal(updated[0].textStatus, 'retranslated');
  });

  await t.test('6. scriptRoutes formatRetranslateRouteError & Express validation/status codes', async () => {
    const quotaFormatted = scriptRoutes.formatRetranslateRouteError({
      status: 429,
      message: '{"error":{"code":429,"message":"Please retry in 14h17m0s.","status":"RESOURCE_EXHAUSTED"}}',
    });
    assert.equal(quotaFormatted.statusCode, 429);
    assert.equal(quotaFormatted.code, 'QUOTA_EXCEEDED');
    assert.ok(quotaFormatted.error.includes('429'));
    assert.ok(quotaFormatted.error.includes('14h17m0s'));
    assert.equal(quotaFormatted.error.includes('QuotaFailure'), false);

    const authFormatted = scriptRoutes.formatRetranslateRouteError({
      status: 401,
      message: 'API key not valid?key=AIzaFakeSecret123456',
    });
    assert.equal(authFormatted.statusCode, 401);
    assert.equal(authFormatted.code, 'INVALID_API_KEY');
    assert.equal(authFormatted.error.includes('AIzaFakeSecret'), false);

    // Mount router cleanly and test missing chineseText 400 response
    const app = express();
    app.use(express.json());
    app.use('/api', scriptRoutes);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      const resp = await fetch(`http://127.0.0.1:${port}/api/dubbing/retranslate-segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chineseText: '   ' }),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.equal(body.success, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('7. /api/dubbing/retranslate-all supports 1-click auto compact and updates segments', async () => {
    const mockAiClient = {
      models: {
        generateContent: async ({ contents }) => {
          assert.ok(contents[0].includes('ខ្លីចំអត្ថន័យ'));
          return {
            text: JSON.stringify([
              { id: 1, khmerText: 'មួយប្រភេទ ៥០ពិន្ទុ' },
              { id: 2, khmerText: 'យកមកឱ្យយើងទាំង ៣' },
            ]),
          };
        },
      },
    };

    const updated = await retranslateBatchDialogues(
      [
        { id: 1, originalChineseText: '每种50分', startSec: 28, endSec: 30 },
        { id: 2, originalChineseText: '给本座三', startSec: 30, endSec: 32 },
      ],
      null,
      {
        aiClient: mockAiClient,
        style: 'compact',
        timeoutMs: 2000,
      }
    );

    assert.equal(updated.length, 2);
    assert.equal(updated[0].khmerText, 'មួយប្រភេទ ៥០ពិន្ទុ');
    assert.equal(updated[0].translationStyle, 'compact');
    assert.equal(updated[0].audioOutdated, true);
    assert.equal(updated[1].khmerText, 'យកមកឱ្យយើងទាំង ៣');
    assert.equal(updated[1].translationStyle, 'compact');
    assert.equal(updated[1].audioOutdated, true);
  });
});
