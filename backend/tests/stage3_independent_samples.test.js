const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('../services/ffmpegService');
const ocr = require('../services/ocr/localChineseOcrService');

test('Stage 3 reads both static samples, resumes local batches and retries only unverified cloud reads', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-independent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const videoPath = path.join(dir, 'fixture.mp4');
  fs.writeFileSync(videoPath, 'mock frame bytes');
  const cues = [
    { cueIndex: 1, startSec: 0, endSec: 1.5, duration: 1.5, sampleASec: 0.12, sampleBSec: 0.75, sampleTieSec: 1.1 },
    { cueIndex: 2, startSec: 1.5, endSec: 2.3, duration: 0.8, sampleASec: 1.62, sampleBSec: 1.9, sampleTieSec: 2.1 },
  ];
  t.mock.method(ffmpeg, 'detectSubtitleChangePoints', async () => ({
    cueStates: cues, changePoints: [], frameDiffs: Array.from({ length: 12 }, (_, i) => ({ timestampSec: i / 5, subDiff: 0.1 })),
  }));
  const decoded = [];
  t.mock.method(ffmpeg, 'extractFramesAtTimestamps', async (_video, times) => {
    decoded.push([...times]);
    return times.map(timestampSec => ({ timestampSec, filePath: videoPath }));
  });
  t.mock.method(ocr, 'isLocalChineseOcrAvailable', async () => true);
  const inferred = [];
  let interrupt = true;
  const texts = new Map([[0.12, '我相信你'], [0.75, '我不相信你'], [1.9, '走']]);
  const row = t => ({
    timestampSec: t, chineseText: texts.get(t) || '', hasText: texts.has(t),
    confidence: t === 1.9 ? 0.4 : 0.99, ocrStatus: texts.has(t) ? 'text' : 'empty',
  });
  t.mock.method(ocr, 'runLocalChineseOcr', async ({ frames, onBatchComplete }) => {
    const rows = (interrupt ? frames.slice(0, 2) : frames).map(f => {
      inferred.push(f.timestampSec);
      if (f.timestampSec === 1.9) assert.equal(f.isShortCue, true);
      return row(f.timestampSec);
    });
    onBatchComplete(rows);
    if (interrupt) {
      interrupt = false;
      throw Object.assign(new Error('Stopped between worker batches'), { name: 'AbortError' });
    }
    return { results: rows, actualOcrFramesCount: rows.length };
  });
  const stage = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
  const cloud = [];
  let answer = false;
  const aiClient = { models: { generateContent: async ({ contents }) => {
    const times = contents.flatMap(part => {
      const m = part.text?.match(/^\[FRAME_TIMESTAMP: ([\d.]+)s/);
      return m ? [Number(m[1])] : [];
    });
    cloud.push(...times);
    return { text: JSON.stringify({ frames: times.map(t => answer || t !== 1.9 ? row(t) : { timestampSec: t }) }) };
  } } };
  const args = { videoPath, durationSec: 2.3, aiClient, cacheDir: dir };
  await assert.rejects(stage.extractChineseSubtitles(args), { name: 'AbortError' });
  const partial = await stage.extractChineseSubtitles(args);
  assert.equal(partial.ocrMeta.performance.localCheckpointReusedFramesCount, 2);
  assert.equal(partial.hasUnresolvedFrames, true);
  assert.ok(cloud.includes(1.9));
  const total = inferred.length;
  cloud.length = 0;
  answer = true;
  const final = await stage.extractChineseSubtitles(args);
  assert.deepEqual(cloud, [1.9]);
  assert.deepEqual(decoded.at(-1), [1.9]);
  assert.equal(inferred.length, total);
  assert.equal(new Set(inferred).size, total);
  assert.equal(final.ocrMeta.performance.actualOcrFramesCount, 0);
  assert.equal(final.hasUnresolvedFrames, false);
  for (const [time, text] of texts) {
    assert.equal(final.rawObservations.find(o => o.timestampSec === time)?.chineseText, text);
    assert.ok(final.visualSegments.some(c => c.chineseText === text), text);
  }
});
