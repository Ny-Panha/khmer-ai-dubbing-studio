const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { extractSubtitlesPPOCR } = require('../services/ppocrService');
const {
  extractChineseSubtitles,
  deduplicateFastOcrCues,
  stripDecorativeSubtitleNoise,
  normalizeChineseChars,
  getOcrCachePath,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');

test('PP-OCR Worker: Contract verification (frames in -> lines and boxes out)', async () => {
  const scratchFrame = path.resolve('C:/Users/nhastar/.gemini/antigravity/brain/c748a9df-11f5-4bc6-8f82-7731c1f0b3dd/scratch/real_frame_40s.jpg');

  if (!fs.existsSync(scratchFrame)) {
    // Skip if test frame does not exist
    return;
  }

  const result = await extractSubtitlesPPOCR({
    frames: [{ timestampSec: 40.0, filePath: scratchFrame }],
    threads: 4,
  });

  assert.equal(result.engine, 'ppocr-local');
  assert.equal(result.totalFrames, 1);
  assert.ok(Array.isArray(result.frames), 'result.frames must be an array');
  assert.equal(result.frames.length, 1);

  const f0 = result.frames[0];
  assert.equal(f0.timestampSec, 40.0);
  assert.equal(f0.hasText, true);
  assert.equal(f0.position, 'bottom_subtitle');
  assert.ok(f0.chineseText.includes('挖个三米深'), `Expected dialogue text, got: ${f0.chineseText}`);
  assert.ok(Array.isArray(f0.rawLines), 'rawLines must be an array');
  assert.ok(f0.rawLines.length >= 1, 'Expected at least 1 raw line');

  // Verify bounding box and confidence contract
  const subLine = f0.rawLines.find((l) => l.text.includes('挖个三米深'));
  assert.ok(subLine, 'Dialogue subtitle line must be detected');
  assert.equal(subLine.position, 'bottom_subtitle');
  assert.equal(subLine.isNoise, false);
  assert.ok(subLine.confidence >= 0.8, 'Confidence should be high for clear text');
  assert.equal(subLine.box.length, 4, 'Bounding box must have [xmin, ymin, xmax, ymax]');
  assert.ok(subLine.box[1] > 800, 'Dialogue subtitle ymin must be in bottom area (> 800 for 1080p)');
});

test('PP-OCR Noise Filter: Correctly filters watermarks and disclaimers', async () => {
  const scratchFrame = path.resolve('C:/Users/nhastar/.gemini/antigravity/brain/c748a9df-11f5-4bc6-8f82-7731c1f0b3dd/scratch/real_frame_40s.jpg');
  if (!fs.existsSync(scratchFrame)) return;

  const result = await extractSubtitlesPPOCR({
    frames: [{ timestampSec: 40.0, filePath: scratchFrame }],
    threads: 4,
  });

  const f0 = result.frames[0];
  // Watermarks in this frame: '剧情为虚构演绎A生成', '懂点儿', '普法科普 切勿当真'
  const watermarkLines = f0.rawLines.filter((l) => l.isNoise);
  assert.ok(watermarkLines.length >= 1, 'Should detect at least 1 noise/watermark line');

  const disclaimer = watermarkLines.find((l) => l.text.includes('剧情为虚构') || l.text.includes('切勿当真'));
  assert.ok(disclaimer, 'Disclaimer overlay should be marked as noise');
  assert.equal(disclaimer.isNoise, true);

  // Subtitle should not contain the watermark
  assert.ok(!f0.chineseText.includes('切勿当真'), 'Final subtitle text must not contain watermark text');
  assert.ok(!f0.chineseText.includes('剧情为虚构'), 'Final subtitle text must not contain disclaimer text');
});

test('PP-OCR Wrapper: Returns empty frames gracefully on empty input', async () => {
  const result = await extractSubtitlesPPOCR({ frames: [] });
  assert.equal(result.totalFrames, 0);
  assert.equal(result.frames.length, 0);
  assert.equal(result.engine, 'ppocr-local');
});

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

test('Stage 3 Forced-Failure Fallback: Falls back to Gemini Vision on worker failure', async () => {
  let geminiVisionCalled = false;
  const mockAiClient = {
    models: {
      generateContent: async () => {
        geminiVisionCalled = true;
        return {
          text: JSON.stringify({
            frames: [
              {
                timestampSec: 0.5,
                hasText: true,
                textZh: '备用视觉识别成功',
                chineseText: '备用视觉识别成功',
                position: 'bottom_subtitle',
              },
            ],
          }),
        };
      },
    },
  };

  const realVideoPath = path.resolve('backend/uploads/SaveTik.co_7703366571728653622-hd/episodes/ep_1/video/ep_1_source.mp4');
  if (!fs.existsSync(realVideoPath)) return;

  const testDuration = 1.0;
  const testOffset = 0;
  const cachePath = getOcrCachePath(realVideoPath, testOffset, testDuration, 'ppocr-local');
  if (cachePath && fs.existsSync(cachePath)) {
    try { fs.unlinkSync(cachePath); } catch (_) {}
  }

  const badWorkerPath = path.join(os.tmpdir(), 'non_existent_ppocr_worker.py');

  try {
    const result = await extractChineseSubtitles({
      videoPath: realVideoPath,
      durationSec: testDuration,
      aiClient: mockAiClient,
      startOffsetSec: testOffset,
      workerScriptOverride: badWorkerPath,
    });

    assert.equal(geminiVisionCalled, true, 'Gemini Vision fallback must be called when PP-OCR worker fails');
    assert.equal(result.ocrMeta.ocrEngine, 'gemini-vision', 'Engine in ocrMeta should reflect fallback to gemini-vision');
    assert.ok(result.visualSegments.length >= 1, 'Should return visual segments from fallback Gemini Vision path');
  } finally {
    if (cachePath && fs.existsSync(cachePath)) {
      try { fs.unlinkSync(cachePath); } catch (_) {}
    }
  }
});
