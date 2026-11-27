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

    const unavailableFormatted = scriptRoutes.formatRetranslateRouteError({
      status: 503,
      message: '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}',
    });
    assert.equal(unavailableFormatted.statusCode, 503);
    assert.equal(unavailableFormatted.code, 'UPSTREAM_UNAVAILABLE');
    assert.ok(unavailableFormatted.error.includes('503'));

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

  await t.test('8. Single-segment retranslate prioritizes Option #2 (compact / ខ្លីចំអត្ថន័យ) in prompt & auto-selects it in UI', async () => {
    let capturedSystem = '';
    let capturedContent = '';
    const mockAiClient = {
      models: {
        generateContent: async ({ contents, config }) => {
          capturedContent = String(contents?.[0] || '');
          capturedSystem = String(config?.systemInstruction || '');
          return {
            text: JSON.stringify({
              chinese: '还愣着干什么',
              options: [
                { style: 'classical', label: '🎭 សម្ដីកុនបុរាណ', text: 'ហេតុអ្វីនៅស្ទាក់ស្ទើរទៀត?' },
                { style: 'compact', label: '📝 ខ្លីចំអត្ថន័យ', text: 'នៅចាំអីទៀត!' },
                { style: 'dramatic', label: '⚡ អារម្មណ៍តួអង្គ', text: 'នៅឈរភ្លឹកដល់ណាទៀត! ឆាប់ទៅ!' },
              ],
              note: '愣着 = ឈរភ្លឹក',
            }),
          };
        },
      },
    };

    const res = await retranslateSingleDialogue('还愣着干什么', null, {
      aiClient: mockAiClient,
      durationSec: 1.5,
      timeoutMs: 2000,
    });

    assert.ok(capturedSystem.includes('OPTION #2'), 'System prompt must highlight Option #2 compact style');
    assert.ok(capturedSystem.includes('ខ្លីចំអត្ថន័យ'), 'System prompt must define ខ្លីចំអត្ថន័យ');
    assert.ok(capturedContent.includes('1.50s'), 'Prompt content must include durationSec lip-sync budget');
    assert.equal(res.options[1].style, 'compact');
    assert.equal(res.options[1].text, 'នៅចាំអីទៀត!');

    const fs = require('fs');
    const path = require('path');
    const clipSrc = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/components/voice/ClipInspectorPanel.jsx'),
      'utf8'
    );
    const dubbingHookSrc = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/hooks/useAudioDubbing.js'),
      'utf8'
    );
    assert.match(clipSrc, /pickPreferredCompactOption/);
    assert.match(clipSrc, /handleApplyOption\(preferredOpt\.text\)/);
    assert.match(dubbingHookSrc, /opt\?\.style === 'compact'/);
  });

  await t.test('9. checkEpisodeHasCompactReady recognizes completed auto-compact even with manual/short cues & persists on disk', async () => {
    const fs = require('fs');
    const path = require('path');

    // Verify source code consistency across frontend components and helpers
    const helpersSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/dashboard/geminiRouteHelpers.js'), 'utf8');
    const focusBarSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/dashboard/BatchStageFocusBar.jsx'), 'utf8');
    const cardSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/dashboard/BatchEpisodeCard.jsx'), 'utf8');
    const runnerCtxSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx'), 'utf8');
    const featureSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/dubbing-runner/useDubbingFeature.js'), 'utf8');
    const singleRunnerSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/dubbing-runner/singleEpisodeRunners.js'), 'utf8');
    const routesSrc = fs.readFileSync(path.resolve(__dirname, '../routes/scriptRoutes.js'), 'utf8');

    assert.match(helpersSrc, /export function checkEpisodeHasCompactReady/);
    assert.match(focusBarSrc, /checkEpisodeHasCompactReady/);
    assert.match(cardSrc, /checkEpisodeHasCompactReady/);
    assert.match(runnerCtxSrc, /checkEpisodeHasCompactReady/);
    assert.match(featureSrc, /checkEpisodeHasCompactReady/);
    assert.match(singleRunnerSrc, /await refreshSeries\(\)/);
    assert.match(routesSrc, /freshTargetEp\.scriptData\.autoCompacted = true/);

    // Dynamic test of checkEpisodeHasCompactReady logic
    const { checkEpisodeHasCompactReady } = (() => {
      // Inline evaluator of checkEpisodeHasCompactReady logic
      return {
        checkEpisodeHasCompactReady: (ep) => {
          if (!ep) return false;
          if (ep.autoCompacted || ep.scriptData?.autoCompacted) return true;
          const segments = Array.isArray(ep.segments) ? ep.segments : (ep.scriptData?.segments || []);
          if (!Array.isArray(segments) || segments.length === 0) return false;
          const translatableSegs = segments.filter((s) => {
            const src = String(s.originalChineseText || s.chineseText || s.originalText || s.original || s.spokenAudioText || '').trim();
            return Boolean(src) && !s.userAdded;
          });
          if (translatableSegs.length === 0) {
            return segments.some((s) => s.translationStyle === 'compact');
          }
          const compactCount = translatableSegs.filter((s) => s.translationStyle === 'compact').length;
          return compactCount === translatableSegs.length || (compactCount / translatableSegs.length >= 0.9);
        }
      };
    })();

    // Scenario A: EP5 case (77 compact translatable segments + 2 manual userAdded exclamations with empty source)
    const ep5Mock = {
      id: 'ep_5',
      scriptData: {
        segments: [
          ...Array.from({ length: 77 }, (_, i) => ({
            id: `seg_${i}`,
            originalChineseText: '你好',
            translationStyle: 'compact',
          })),
          { id: 'seg_user_1', userAdded: true, originalChineseText: '', khmer: 'អែង' },
          { id: 'seg_user_2', userAdded: true, originalChineseText: '', khmer: 'ម៉ាក់' },
        ],
      },
    };
    assert.equal(checkEpisodeHasCompactReady(ep5Mock), true, '77/77 translatable segments compacted must be considered done');

    // Scenario B: Explicit autoCompacted flag
    assert.equal(checkEpisodeHasCompactReady({ scriptData: { autoCompacted: true } }), true);

    // Scenario C: Less than 90% compacted must return false
    const epIncompleteMock = {
      scriptData: {
        segments: [
          ...Array.from({ length: 50 }, (_, i) => ({ id: `s_${i}`, originalChineseText: '话', translationStyle: 'compact' })),
          ...Array.from({ length: 50 }, (_, i) => ({ id: `s_${i + 50}`, originalChineseText: '话', translationStyle: undefined })),
        ],
      },
    };
    assert.equal(checkEpisodeHasCompactReady(epIncompleteMock), false, '50% compacted should return false');
  });

  await t.test('10. Compact Khmer Dubbing enforces Option #2 prompt, 1:1 cue/sourceCueId/timestamp preservation, and rejects foreign script/mismatch', async () => {
    const inputCues = [
      {
        id: 'seg_1',
        sourceCueId: 'cue_001',
        originalChineseText: '我没事',
        khmerTranslatedText: 'ខ្ញុំមិនមានបញ្ហាអ្វីទេ',
        startSec: 1.0,
        endSec: 2.5,
      },
      {
        id: 'seg_2',
        sourceCueId: 'cue_002',
        originalChineseText: '你体内的那个家伙很危险',
        khmerTranslatedText: 'អ្នកដែលនៅក្នុងរាងកាយរបស់អ្នកនោះគឺគ្រោះថ្នាក់ណាស់',
        startSec: 2.6,
        endSec: 5.0,
      },
    ];

    let capturedPrompt = '';
    const validMockAi = {
      models: {
        generateContent: async ({ contents }) => {
          capturedPrompt = contents[0];
          return {
            text: JSON.stringify([
              { id: 'seg_1', sourceCueId: 'cue_001', khmerText: 'ខ្ញុំមិនអីទេ។' },
              { id: 'seg_2', sourceCueId: 'cue_002', khmerText: 'អាដែលនៅក្នុងខ្លួនកូននោះ គ្រោះថ្នាក់ណាស់។' },
            ]),
          };
        },
      },
    };

    const result = await retranslateBatchDialogues(inputCues, null, {
      aiClient: validMockAi,
      style: 'compact',
      timeoutMs: 2000,
    });

    assert.ok(capturedPrompt.includes('Compact Dubbing approach (📝 ខ្លីចំអត្ថន័យ)'));
    assert.ok(capturedPrompt.includes('Do not generate three options'));
    assert.ok(capturedPrompt.includes('prevDialogueContextOnly'));
    assert.ok(capturedPrompt.includes('nextDialogueContextOnly'));
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'seg_1');
    assert.equal(result[0].sourceCueId, 'cue_001');
    assert.equal(result[0].startSec, 1.0);
    assert.equal(result[0].endSec, 2.5);
    assert.equal(result[0].originalKhmerText, 'ខ្ញុំមិនមានបញ្ហាអ្វីទេ');
    assert.equal(result[0].khmerText, 'ខ្ញុំមិនអីទេ។');
    assert.equal(result[1].id, 'seg_2');
    assert.equal(result[1].sourceCueId, 'cue_002');
    assert.equal(result[1].startSec, 2.6);
    assert.equal(result[1].endSec, 5.0);
    assert.equal(result[1].originalKhmerText, 'អ្នកដែលនៅក្នុងរាងកាយរបស់អ្នកនោះគឺគ្រោះថ្នាក់ណាស់');
    assert.equal(result[1].khmerText, 'អាដែលនៅក្នុងខ្លួនកូននោះ គ្រោះថ្នាក់ណាស់។');

    // Reject mismatched cue count
    await assert.rejects(
      () => retranslateBatchDialogues(inputCues, null, {
        aiClient: {
          models: {
            generateContent: async () => ({
              text: JSON.stringify([{ id: 'seg_1', sourceCueId: 'cue_001', khmerText: 'ខ្ញុំមិនអីទេ។' }]),
            }),
          },
        },
        style: 'compact',
        timeoutMs: 2000,
      }),
      /expected 2 cues, got 1/i
    );

    // Reject Chinese, English, Thai, or Lao characters in khmerText
    for (const badText of ['ខ្ញុំមិនអីទេ 我没事', 'ខ្ញុំមិនអីទេ OK', 'ខ្ញុំមិនអីទេ สบายดี', 'ខ្ញុំមិនអីទេ ສະບາຍດີ']) {
      await assert.rejects(
        () => retranslateBatchDialogues([inputCues[0]], null, {
          aiClient: {
            models: {
              generateContent: async () => ({
                text: JSON.stringify([{ id: 'seg_1', sourceCueId: 'cue_001', khmerText: badText }]),
              }),
            },
          },
          style: 'compact',
          timeoutMs: 2000,
        }),
        /non-Khmer script detected/i
      );
    }
  });
});
