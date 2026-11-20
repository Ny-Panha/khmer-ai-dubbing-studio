const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkpointReference, replayClient } = require('../scripts/run_hybrid_ocr_benchmark');
const { parseVisionResponseFrames } = require('../services/pipeline/stages/stage3_extractChineseSubtitles');

test('benchmark replay keeps an unlabelled frame unresolved beside a known Chinese line', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-replay-test-'));
  try {
    const file = path.join(dir, 'ref.json');
    const videoPath = path.join(dir, 'source.mp4');
    fs.writeFileSync(videoPath, 'test');
    const known = { timestampSec: 1.02, hasText: true, chineseText: '走吧', isVerified: true };
    fs.writeFileSync(file, JSON.stringify({ videoPath, rawObservations: [
      known, { ...known, timestampSec: 1, isDeduped: true },
      { ...known, timestampSec: 1.03, ocrFailed: true }, { ...known, timestampSec: 2 },
    ] }));
    const calls = [];
    const ref = checkpointReference(file, 1.5, videoPath);
    assert.deepEqual([...ref.keys()], [1.02]);
    const wrongFile = path.join(dir, 'ocr_ckpt_source_mp4_4_0_0_2.json');
    fs.copyFileSync(file, wrongFile);
    assert.throws(() => checkpointReference(wrongFile, 1.5, videoPath), /signature does not match/);
    const client = replayClient(ref, calls);
    const timestamps = [1, 1.02, 1.03];
    const contents = timestamps.map(t => ({ text: `[FRAME_TIMESTAMP: ${t.toFixed(2)}s | Timecode: ...]` }));
    const reply = await client.models.generateContent({ contents });
    const rows = parseVisionResponseFrames(reply, timestamps.map(timestampSec => ({ timestampSec })));
    assert.deepEqual(calls, [timestamps]);
    assert.deepEqual(rows.map(r => [r.timestampSec, r.isVerified, r.chineseText]), [
      [1, false, ''], [1.02, true, '走吧'], [1.03, false, ''],
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
