const path = require('path');
const fs = require('fs');

const { extractChineseSubtitles, getOcrCachePath } = require('./services/pipeline/stages/stage3_extractChineseSubtitles');

async function runBenchmark() {
  const videoPath = path.resolve('backend/uploads/SaveTik.co_7703366571728653622-hd/episodes/ep_1/video/ep_1_source.mp4');
  const durationSec = 286.56;

  console.log(`=======================================================`);
  console.log(`[Stage 3 PP-OCR Benchmark] Starting standalone run`);
  console.log(`Video: ${videoPath}`);
  console.log(`Duration: ${durationSec}s`);
  console.log(`Engine: ppocr-local (PP-OCRv5 Mobile, CPU, 8 threads)`);
  console.log(`=======================================================`);

  // Clear any existing cache for this benchmark run to measure true wall time
  const cachePath = getOcrCachePath(videoPath, 0, durationSec, 'ppocr-local');
  if (cachePath && fs.existsSync(cachePath)) {
    console.log(`[Benchmark] Clearing previous cache: ${path.basename(cachePath)}`);
    try { fs.unlinkSync(cachePath); } catch (_) {}
  }

  const startMs = Date.now();
  const result = await extractChineseSubtitles({
    videoPath,
    durationSec,
    startOffsetSec: 0,
    ocrEngine: 'ppocr-local',
  });
  const totalWallMs = Date.now() - startMs;
  const totalWallSec = (totalWallMs / 1000).toFixed(2);

  const cues = result.visualSegments || [];
  console.log(`\n================ BENCHMARK RESULTS ===============`);
  console.log(`(a) Total Wall Time: ${totalWallSec}s (OCR execution: ${((result.ocrMeta?.wallTimeMs || 0) / 1000).toFixed(2)}s)`);
  console.log(`(b) Candidate frames sampled: ${result.ocrMeta?.totalFramesSampled || 0}`);
  console.log(`    Final deduplicated cue count: ${cues.length} cues`);
  console.log(`    (Comparison: Gemini Vision detected 310 change points / 556 candidate frames)`);
  console.log(`(c) First 10 Cues (Chinese text + timecode):`);
  cues.slice(0, 10).forEach((c, idx) => {
    console.log(`   [Cue ${idx + 1}] [${c.startSec}s -> ${c.endSec}s (${c.duration}s)] [${c.position}] "${c.chineseText}"`);
  });
  console.log(`===================================================\n`);

  fs.writeFileSync(
    path.resolve('C:/Users/nhastar/.gemini/antigravity/brain/c748a9df-11f5-4bc6-8f82-7731c1f0b3dd/scratch/benchmark_results.json'),
    JSON.stringify({
      totalWallSec: parseFloat(totalWallSec),
      ocrWallSec: parseFloat(((result.ocrMeta?.wallTimeMs || 0) / 1000).toFixed(2)),
      totalFramesSampled: result.ocrMeta?.totalFramesSampled || 0,
      cueCount: cues.length,
      first10Cues: cues.slice(0, 10),
    }, null, 2),
    'utf8'
  );
}

runBenchmark().catch((err) => {
  console.error('[Benchmark Error]', err);
  process.exit(1);
});
