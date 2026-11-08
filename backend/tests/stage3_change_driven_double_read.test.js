const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  extractChineseSubtitles,
  areChineseTextsEquivalent,
  deduplicateFastOcrCues,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');

const {
  detectSubtitleChangePoints,
  extractSubtitleDifferenceGrid,
} = require('../services/ffmpegService');

test('Stage 3 Change-Driven: detectSubtitleChangePoints exports and calculates candidate cue states', async () => {
  assert.equal(typeof detectSubtitleChangePoints, 'function', 'detectSubtitleChangePoints must be exported by ffmpegService');

  const testVideoPath = path.resolve(__dirname, '../uploads/test_media/ep_2_source.mp4');
  if (!fs.existsSync(testVideoPath)) {
    console.log('[Stage 3 Test] Test video not found, skipping live media assertion');
    return;
  }

  // Run pre-pass on window 38s - 48s (10s window)
  const result = await detectSubtitleChangePoints(testVideoPath, 38.0, 10.0, 5.0);
  assert.ok(Array.isArray(result.changePoints), 'changePoints must be an array');
  assert.ok(Array.isArray(result.cueStates), 'cueStates must be an array');
  assert.ok(Array.isArray(result.frameDiffs), 'frameDiffs must be an array');

  // Verify that change points and cue states are detected
  assert.ok(result.changePoints.length >= 6, `Expected at least 6 change points in dialogue window, got ${result.changePoints.length}`);
  assert.ok(result.cueStates.length >= 6, `Expected at least 6 candidate cue states, got ${result.cueStates.length}`);

  // Verify candidate cue state properties
  const cue = result.cueStates[0];
  assert.ok(typeof cue.startSec === 'number', 'cueState must have startSec');
  assert.ok(typeof cue.endSec === 'number', 'cueState must have endSec');
  assert.ok(typeof cue.duration === 'number', 'cueState must have duration');
  assert.ok(typeof cue.sampleASec === 'number', 'cueState must have sampleASec (onset)');
  assert.ok(typeof cue.sampleBSec === 'number', 'cueState must have sampleBSec (mid-cue)');
  assert.ok(typeof cue.sampleTieSec === 'number', 'cueState must have sampleTieSec (tie-break)');

  // Verify short cue (<0.8s) exists in window (specifically cue around 42.2s - 42.8s: ~0.60s)
  const shortCue = result.cueStates.find((c) => c.duration < 0.8 && c.startSec >= 42.0 && c.endSec <= 43.0);
  assert.ok(shortCue, 'A short cue (<0.8s) must be detected in the 42.0s-43.0s window');
  assert.ok(shortCue.duration <= 0.75, `Short cue duration must be <= 0.75s, got ${shortCue.duration}s`);
});

test('Stage 3 Double-Read: areChineseTextsEquivalent correctly pairs equivalent texts and rejects disagreements', () => {
  // Equivalent pairs
  assert.ok(areChineseTextsEquivalent('老子要', '老子要'), 'Exact match');
  assert.ok(areChineseTextsEquivalent('老子要！', '老子要'), 'Punctuation variance');
  assert.ok(areChineseTextsEquivalent('替一个伪神者', '替一个伪神者 '), 'Whitespace variance');
  assert.ok(areChineseTextsEquivalent('凭他是老子的崽', '凭他是老子的崽'), 'Dialogue line match');

  // Disagreements
  assert.ok(!areChineseTextsEquivalent('替一个伪神者', '挑战神堂'), 'Distinct dialogue lines must not be equivalent');
  assert.ok(!areChineseTextsEquivalent('老子要', '凭什么'), 'Different lines must not match');
  assert.ok(!areChineseTextsEquivalent('', '挑战神堂'), 'Empty text must not match non-empty text');
});

test('Stage 3 Fast OCR Mode: deduplicateFastOcrCues preserves ocrConfidence, reviewNeeded, and ocrDisagreement flags', () => {
  const mockCues = [
    {
      startSec: 39.8,
      endSec: 41.2,
      originalChineseText: '老子要',
      ocrConfidence: 'high',
      reviewNeeded: false,
      ocrDisagreement: false,
    },
    {
      startSec: 41.2,
      endSec: 42.2,
      originalChineseText: '你凭什么',
      ocrConfidence: 'low',
      reviewNeeded: true,
      ocrDisagreement: true,
      uncertainOcr: true,
    },
  ];

  const deduped = deduplicateFastOcrCues(mockCues, 'male');
  assert.equal(deduped.length, 2);

  // High confidence cue
  assert.equal(deduped[0].ocrConfidence, 'high');
  assert.equal(deduped[0].reviewNeeded, false);
  assert.equal(deduped[0].ocrDisagreement, false);

  // Low confidence cue with disagreement flag
  assert.equal(deduped[1].ocrConfidence, 'low');
  assert.equal(deduped[1].reviewNeeded, true);
  assert.equal(deduped[1].ocrDisagreement, true);
  assert.equal(deduped[1].uncertainOcr, true);
});

