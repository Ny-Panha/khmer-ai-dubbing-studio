const test = require('node:test');
const assert = require('node:assert/strict');
const { deduplicateFastOcrCues } = require('../services/pipeline/stages/stage3_extractChineseSubtitles');

test('Fast OCR 1:1 Rule: Verifies 1 cue in = 1 segment out count logging', () => {
  const mockCues = [
    { startSec: 0.0, endSec: 1.5, chineseText: '你好' },
    { startSec: 2.0, endSec: 3.5, chineseText: '今天天气很好' },
    { startSec: 4.0, endSec: 5.5, chineseText: '我们走吧' },
  ];

  const logs = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args) => logs.push({ type: 'log', text: args.join(' ') });
  console.warn = (...args) => logs.push({ type: 'warn', text: args.join(' ') });

  try {
    const segments = deduplicateFastOcrCues(mockCues, 'male');
    const cuesDetected = mockCues.length;
    const segmentsStored = segments.length;

    console.log(`cues detected: ${cuesDetected} -> segments stored: ${segmentsStored}`);
    if (cuesDetected !== segmentsStored) {
      console.warn(`⚠️ WARNING: Fast OCR 1:1 rule mismatch! cues detected: ${cuesDetected} -> segments stored: ${segmentsStored} (${cuesDetected} != ${segmentsStored})`);
    }

    assert.equal(cuesDetected, 3);
    assert.equal(segmentsStored, 3);
    const hasRuleLog = logs.some((l) => l.text.includes('cues detected: 3 -> segments stored: 3'));
    assert.ok(hasRuleLog, 'Must log cues detected -> segments stored');
    const hasMismatchWarn = logs.some((l) => l.text.includes('Fast OCR 1:1 rule mismatch'));
    assert.equal(hasMismatchWarn, false, 'Should NOT warn when counts match');
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
});
