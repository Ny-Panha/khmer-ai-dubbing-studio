const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { analyzeDialogueAudio } = require('../services/pipeline/stages/stage4_analyzeDialogueAudio');

test('Stage 4: Local SenseVoice-Small ASR integration', async (t) => {
  const testVideo = path.resolve(__dirname, '../uploads/projects/series_1793272088927/episodes/ep_3/video/ep_3_source.mp4');

  if (!fs.existsSync(testVideo)) {
    t.skip(`Skipping test: test video ${testVideo} does not exist`);
    return;
  }

  // Run Stage 4 on dialogue window (offset 24s -> 39s) with NO aiClient (100% offline local)
  console.log('[Test Stage 4] Running analyzeDialogueAudio with local SenseVoice engine...');
  const result = await analyzeDialogueAudio({
    videoPath: testVideo,
    durationSec: 15,
    startOffsetSec: 24,
    aiClient: null, // Proves no Gemini API is required!
  });

  assert.ok(result, 'Result should be defined');
  assert.ok(Array.isArray(result.audioSegments), 'audioSegments should be an array');
  assert.ok(result.audioSegments.length > 0, `Expected at least 1 speech segment, got ${result.audioSegments.length}`);
  assert.strictEqual(result.audioMeta.asrEngineUsed, 'sense-voice-small-onnx', 'Engine used should be sense-voice-small-onnx');

  // Verify first segment fields
  const first = result.audioSegments[0];
  console.log('[Test Stage 4] First detected segment:', first);
  assert.ok(first.startSec >= 0, 'startSec must be >= 0');
  assert.ok(first.endSec > first.startSec, 'endSec must be > startSec');
  assert.ok(first.spokenChineseText.length > 0, 'spokenChineseText must not be empty');
  assert.ok(/[\u4e00-\u9fa5]/.test(first.spokenChineseText), 'spokenChineseText must contain Chinese characters');
  assert.strictEqual(first.source, 'sense_voice_local', 'source must be sense_voice_local');
});

