const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { analyzeDialogueAudio } = require('../services/pipeline/stages/stage4_analyzeDialogueAudio');

test('Stage 4: Forced failure triggers visible fallback to Gemini ASR', async (t) => {
  const testVideo = path.resolve(__dirname, '../uploads/projects/series_1793898268958/episodes/ep_1/video/series_1793898268958_ep_1_source.mp4');

  if (!fs.existsSync(testVideo)) {
    t.skip(`Skipping test: test video ${testVideo} does not exist`);
    return;
  }

  // Create a mock aiClient to intercept the fallback call and verify it was invoked
  let geminiFallbackCalled = false;
  let fallbackPromptReceived = '';
  const mockAiClient = {
    interactions: {
      create: async ({ model, input }) => {
        geminiFallbackCalled = true;
        return {
          output_text: JSON.stringify({
            speechSegments: [
              {
                startSec: 10.5,
                endSec: 15.2,
                spokenChineseText: '这是Gemini备用ASR识别出的中文对话',
                gender: 'female',
                speakerId: 'spk_1',
              },
            ],
          }),
        };
      },
    },
    models: {
      generateContent: async () => {
        geminiFallbackCalled = true;
        return {
          text: () => JSON.stringify({
            speechSegments: [
              {
                startSec: 10.5,
                endSec: 15.2,
                spokenChineseText: '这是Gemini备用ASR识别出的中文对话',
                gender: 'female',
              },
            ],
          }),
        };
      },
    },
    files: {
      delete: async () => {},
    },
  };

  // Temporarily rename sensevoice_worker.py to simulate worker failure / missing model
  const realWorker = path.resolve(__dirname, '../workers/sensevoice_worker.py');
  const tempWorker = path.resolve(__dirname, '../workers/sensevoice_worker.py.bak');

  assert.ok(fs.existsSync(realWorker), 'sensevoice_worker.py must exist');
  fs.renameSync(realWorker, tempWorker);

  try {
    console.log('[Test Fallback] Running analyzeDialogueAudio with worker missing to trigger fallback...');
    // Use unique offset to avoid cache hits from previous runs
    const testOffset = 7.7 + Math.random();
    const result = await analyzeDialogueAudio({
      videoPath: testVideo,
      durationSec: 10,
      startOffsetSec: testOffset,
      aiClient: mockAiClient,
    });

    assert.ok(result, 'Result should be defined');
    assert.ok(geminiFallbackCalled, 'Gemini fallback ASR MUST have been called!');
    assert.ok(Array.isArray(result.audioSegments), 'audioSegments should be an array');
    assert.strictEqual(result.audioSegments.length, 1, 'Should have 1 segment from Gemini fallback');
    
    // Crucial check: engine must visibly show gemini fallback with reason!
    console.log('[Test Fallback] Result asrEngineUsed:', result.audioMeta.asrEngineUsed);
    assert.ok(
      result.audioMeta.asrEngineUsed.includes('fallback'),
      `Engine string must visibly indicate fallback, got: ${result.audioMeta.asrEngineUsed}`
    );
    assert.ok(
      result.audioMeta.asrEngineUsed.startsWith('gemini'),
      `Engine string must start with gemini, got: ${result.audioMeta.asrEngineUsed}`
    );
    assert.ok(result.audioMeta.fallbackReason, 'Fallback reason must be recorded in audioMeta');
  } finally {
    // Restore worker file immediately
    if (fs.existsSync(tempWorker)) {
      fs.renameSync(tempWorker, realWorker);
    }
  }
});
