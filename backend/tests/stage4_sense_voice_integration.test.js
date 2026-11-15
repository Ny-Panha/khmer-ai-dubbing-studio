const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { analyzeDialogueAudio } = require('../services/pipeline/stages/stage4_analyzeDialogueAudio');

test('Stage 4: Local SenseVoice-Small ASR integration', async (t) => {
  const testVideo = path.resolve(__dirname, '../uploads/projects/series_1793898268958/episodes/ep_1/video/series_1793898268958_ep_1_source.mp4');

  if (!fs.existsSync(testVideo)) {
    t.skip(`Skipping test: test video ${testVideo} does not exist`);
    return;
  }

  // Run Stage 4 on dialogue window (offset 10s -> 30s) with NO aiClient (100% offline local)
  console.log('[Test Stage 4] Running analyzeDialogueAudio with local SenseVoice engine...');
  const result = await analyzeDialogueAudio({
    videoPath: testVideo,
    durationSec: 20,
    startOffsetSec: 10,
    aiClient: null, // Proves no Gemini API is required!
  });

  assert.ok(result, 'Result should be defined');
  assert.ok(Array.isArray(result.audioSegments), 'audioSegments should be an array');
  assert.ok(result.audioSegments.length > 0, `Expected at least 1 speech segment, got ${result.audioSegments.length}`);
  assert.strictEqual(result.audioMeta.asrEngineUsed, 'sensevoice-local', 'Engine used should be sensevoice-local');

  // Verify first segment fields
  const first = result.audioSegments[0];
  console.log('[Test Stage 4] First detected segment:', first);
  assert.ok(first.startSec >= 0, 'startSec must be >= 0');
  assert.ok(first.endSec > first.startSec, 'endSec must be > startSec');
  assert.ok(first.spokenChineseText.length > 0, 'spokenChineseText must not be empty');
  assert.ok(/[\u4e00-\u9fa5]/.test(first.spokenChineseText), 'spokenChineseText must contain Chinese characters');
  assert.strictEqual(first.source, 'sense_voice_local', 'source must be sense_voice_local');
  assert.ok(first.speakerId, 'speakerId must be defined');
  assert.ok(first.audioGender, 'audioGender must be defined');
});

