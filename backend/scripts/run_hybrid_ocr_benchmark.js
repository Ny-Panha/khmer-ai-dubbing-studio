/**
 * Cold Stage 3 benchmark with real media + RapidOCR and a timestamp-matched
 * checkpoint replay in place of Gemini. No paid API calls or production cache writes.
 * node scripts/run_hybrid_ocr_benchmark.js --video FILE [--duration SEC]
 *   [--reference CHECKPOINT] [--output NEW_JSON] [--sweep [--frames-dir DIR]]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { performance } = require('node:perf_hooks');
const { once } = require('node:events');
const ocr = require('../services/ocr/localChineseOcrService');
const { getVideoMetadata, extractFramesAtTimestamps } = require('../services/ffmpegService');

function checkpointReference(file, durationSec, videoPath) {
  if (!file) return new Map();
  const { rawObservations, videoPath: recordedPath } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const filename = path.basename(file);
  const stat = fs.statSync(videoPath);
  const safeBase = path.basename(videoPath).replace(/[^a-zA-Z0-9_-]/g, '_');
  const signature = `ocr_ckpt_${safeBase}_${stat.size}_${Math.round(stat.mtimeMs)}_`;
  if (/^ocr_ckpt_.*_\d+_\d+_\d+_\d+\.json$/.test(filename)) {
    if (!filename.startsWith(signature)) throw new Error('Reference checkpoint signature does not match the input video');
  } else if (!recordedPath || path.relative(path.resolve(videoPath), path.resolve(recordedPath)) !== '') {
    throw new Error('Renamed reference checkpoint must record the input video path');
  }
  if (!Array.isArray(rawObservations)) throw new Error('Reference must contain checkpoint rawObservations');
  return new Map(rawObservations
    .filter(r => r?.isVerified === true && !r.ocrFailed && !r.isDeduped && typeof r.hasText === 'boolean' && Number.isFinite(r.timestampSec)
      && r.timestampSec >= 0 && r.timestampSec <= durationSec)
    .map(r => [r.timestampSec, r]));
}

function replayClient(reference, calls) {
  return { models: { generateContent: async ({ contents }) => {
    const times = contents.flatMap(part => {
      const match = /^\[FRAME_TIMESTAMP: ([\d.]+)s \|/.exec(part.text);
      return match ? [Number(match[1])] : [];
    });
    calls.push(times);
    // A timestamp-only placeholder explicitly parses as missing. Dropping the
    // entry entirely lets the tolerant production parser take a nearby answer.
    const frames = times.map(timestampSec => reference.get(timestampSec) || { timestampSec });
    return { text: JSON.stringify({ frames }) };
  } } };
}

function agreement(results, reference) {
  const seen = new Set();
  let matched = 0;
  const differences = [];
  for (const row of results) {
    const expected = reference.get(row.timestampSec);
    if (!expected) continue;
    seen.add(row.timestampSec);
    if (row.ocrStatus !== 'failed' && row.hasText === expected.hasText
      && row.chineseText === expected.chineseText) {
      matched++;
    } else {
      differences.push({ timestampSec: row.timestampSec, expected: expected.chineseText, observed: row.chineseText, status: row.ocrStatus });
    }
  }
  return { exactMatched: matched, compared: matched + differences.length, differences,
    referenceTimestampsNotSampled: [...reference.keys()].filter(t => !seen.has(t)) };
}

function spread(items, n) {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.round(i * (items.length - 1) / (n - 1))]);
}

async function sweep({ videoPath, durationSec, reference, dir, framesDir }) {
  let frames;
  if (framesDir) {
    frames = fs.readdirSync(framesDir).flatMap(name => {
      const match = /^f([0-9]+(?:\.[0-9]+)?)\.jpg$/i.exec(name);
      if (!match || Number(match[1]) > durationSec) return [];
      return [{ timestampSec: Number(match[1]), filePath: path.join(framesDir, name) }];
    }).sort((a, b) => a.timestampSec - b.timestampSec);
    const text = spread(frames.filter(f => reference.get(f.timestampSec)?.hasText === true), 8);
    const empty = spread(frames.filter(f => reference.get(f.timestampSec)?.hasText === false), 4);
    const selected = new Set([...text, ...empty]);
    frames = [...selected, ...spread(frames.filter(f => !selected.has(f)), 24 - selected.size)]
      .sort((a, b) => a.timestampSec - b.timestampSec);
  } else {
    const known = [...reference.values()].sort((a, b) => a.timestampSec - b.timestampSec);
    const chosen = new Set([...spread(known.filter(r => r.hasText), 8), ...spread(known.filter(r => !r.hasText), 4)].map(r => r.timestampSec));
    const additional = 24 - chosen.size;
    for (let i = 0; i < additional; i++) chosen.add(Number(((i + 0.5) * durationSec / additional).toFixed(2)));
    frames = await extractFramesAtTimestamps(videoPath, [...chosen], dir);
    if (frames.length !== chosen.size) throw new Error('FFmpeg could not extract every CPU sweep frame');
  }
  if (frames.length < 2) throw new Error('CPU sweep needs at least two real frames');
  if (!await ocr.isLocalChineseOcrAvailable()) throw new Error('RapidOCR unavailable');
  const configs = [];
  let stockResults;
  const logicalCpus = os.cpus().length;
  // Each configuration starts fresh sessions. Process startup is inside wallMs.
  for (const [workers, threads] of [[1, 0], [1, 1], [1, 2], [1, 4], [2, 1], [2, 2]]) {
    process.env.RAPIDOCR_INTRA_OP_THREADS = String(threads);
    const pool = Array.from({ length: workers }, () => new ocr.PersistentChineseOcrWorker());
    const started = performance.now();
    let batches;
    try {
      await Promise.all(pool.map(worker => worker.start()));
      batches = await Promise.all(pool.map((worker, index) => {
        const slice = frames.slice(Math.floor(index * frames.length / workers), Math.floor((index + 1) * frames.length / workers));
        return worker.processBatch(slice, 'sweep_' + index);
      }));
    } finally {
      const exiting = pool.filter(w => w.child && !w.isTerminated).map(w => once(w.child, 'close'));
      await Promise.all(pool.map(worker => worker.stop()));
      await Promise.all(exiting);
    }
    const wallMs = performance.now() - started;
    const results = batches.flatMap(b => b.results);
    if (results.length !== frames.length || results.some((r, i) => r.timestampSec !== frames[i].timestampSec || r.ocrStatus === 'failed')) {
      throw new Error('CPU sweep returned incomplete OCR');
    }
    const workerCpuMs = batches.reduce((sum, b, i) => sum + b.workerCpuMs + pool[i].workerCpuMs, 0);
    const actualInferences = batches.reduce((sum, b) => sum + b.actualOcrFrames, 0);
    const inferenceMs = batches.reduce((sum, b) => sum + b.inferenceMs, 0);
    stockResults ??= new Map(results.map(r => [r.timestampSec, r]));
    const config = { workers, threads, logicalCpus, wallMs, actualInferences, inferenceMs,
      avgInferenceMs: inferenceMs / actualInferences, imageDecodeMs: batches.reduce((sum, b) => sum + b.imageDecodeMs, 0),
      modelInitMsByWorker: pool.map(w => w.rapidOcrInitMs), workerCpuMs, workerCpuPercentOfMachine: 100 * workerCpuMs / wallMs / logicalCpus,
      peakRssMiBByWorker: batches.map(b => b.workerPeakRssMb),
      vsStock: agreement(results, stockResults), vsReference: agreement(results, reference),
      confidenceChangesVsStock: results.filter(r => r.confidence !== stockResults.get(r.timestampSec).confidence)
        .map(r => ({ timestampSec: r.timestampSec, stock: stockResults.get(r.timestampSec).confidence, measured: r.confidence })) };
    console.log('CPU sweep', JSON.stringify({ workers, threads, wallMs, actualInferences, differencesVsStock: config.vsStock.differences.length }));
    configs.push(config);
  }
  return { kind: 'cpu-sweep', sampleTimestamps: frames.map(f => f.timestampSec), configs };
}

async function runStage({ videoPath, durationSec, reference, dir }) {
  // This standalone CLI captures results before the hybrid router can replace
  // uncertain local reads with a replayed response. Keep the production worker.
  const local = ocr.runLocalChineseOcr;
  let localResults;
  ocr.runLocalChineseOcr = async args => {
    const run = await local(args);
    localResults.push(...run.results.map((r, i) => {
      const { timestampSec, hasText, chineseText, confidence, ocrStatus, isDeduped, sourceTimestampSec } = r;
      const { cueIndex, isShortCue, sceneCut } = args.frames[i];
      return { timestampSec, hasText, chineseText, confidence, ocrStatus, isDeduped, sourceTimestampSec, cueIndex, isShortCue, sceneCut };
    }));
    return run;
  };
  const quota = require('../services/geminiQuotaTracker');
  quota.geminiQuotaTracker = new quota.GeminiQuotaTracker({ persistEnabled: false });
  const { extractChineseSubtitles } = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
  const { generateChunkPlan } = require('../services/pipeline/chunkOrchestrator');
  const chunks = [];
  const calls = [];
  const aiClient = replayClient(reference, calls);
  const started = performance.now();
  for (const chunk of generateChunkPlan(durationSec)) {
    localResults = [];
    // generateChunkPlan rounds to centiseconds. Keep the exact media endpoint.
    const remaining = durationSec - chunk.startSec;
    const chunkDuration = chunk.isLast ? remaining : Math.min(chunk.durationSec, remaining);
    const result = await extractChineseSubtitles({ videoPath, startOffsetSec: chunk.startSec,
      durationSec: chunkDuration, aiClient, baseStepSec: 0.75, enableLocalOcr: true, cacheDir: dir });
    if (result.ocrMeta.resumedFromCheckpoint || (!localResults.length && result.ocrMeta.performance?.candidateFramesCount !== 0)) throw new Error('Cold benchmark requires fresh local OCR results in every chunk');
    chunks.push({ startSec: chunk.startSec, durationSec: chunkDuration, performance: result.ocrMeta.performance,
      rawObservations: result.rawObservations, visualSegments: result.visualSegments, localResults });
  }
  const wallTimeMs = performance.now() - started;
  const uniqueRequests = new Set(calls.flat());
  return { kind: 'stage3', wallTimeMs, chunks,
    mockGemini: { mode: 'exact timestamp checkpoint replay; unknown timestamps unresolved', calls,
      distinctFramesRequested: uniqueRequests.size, distinctUnansweredFrames: [...uniqueRequests].filter(t => !reference.has(t)).length },
    referenceAgreement: agreement(chunks.flatMap(c => c.localResults), reference) };
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    video: { type: 'string' }, reference: { type: 'string' }, duration: { type: 'string' },
    output: { type: 'string' }, sweep: { type: 'boolean' }, 'frames-dir': { type: 'string' },
  } });
  if (positionals.length > 1 || (values.duration && positionals.length)) throw new Error('Supply a single benchmark duration');
  if (values['frames-dir'] && !values.sweep) throw new Error('--frames-dir requires --sweep');
  const videoPath = values.video ? path.resolve(values.video) : ['series_test', 'series_delayed']
    .map(name => path.join(__dirname, '../uploads/projects', name, 'episodes/ep_1/video/ep_1_source.mp4')).find(p => fs.existsSync(p));
  if (!videoPath) throw new Error('Specify --video FILE');
  const { durationSec: mediaDurationSec } = await getVideoMetadata(videoPath);
  const durationSec = Number(values.duration ?? positionals[0] ?? mediaDurationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > mediaDurationSec) throw new Error('Requested duration is outside the media duration');
  const reference = checkpointReference(values.reference, durationSec, videoPath);
  const output = path.resolve(values.output || path.join(os.tmpdir(), 'stage3-benchmark-' + Date.now() + '.json'));
  if (fs.existsSync(output)) throw new Error('Choose a new output file: ' + output);
  const hardware = { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, installedMemoryMiB: Math.round(os.totalmem() / 1048576),
    platform: process.platform, nodeVersion: process.version, requestedIntraOpThreads: process.env.RAPIDOCR_INTRA_OP_THREADS ?? null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-benchmark-'));
  try {
    const options = { videoPath, durationSec, reference, dir, framesDir: values['frames-dir'] };
    const result = values.sweep ? await sweep(options) : await runStage(options);
    const report = { videoPath, mediaDurationSec, durationSec, hardware, referenceFile: values.reference ? path.resolve(values.reference) : null,
      referenceVerifiedTimestamps: reference.size, ...result };
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log('Report:', output);
    if (!values.sweep) console.log(JSON.stringify({ wallTimeMs: report.wallTimeMs, chunks: report.chunks.map(c => c.performance),
      mockGeminiRequested: report.mockGemini.distinctFramesRequested, localCheckpointMatches: report.referenceAgreement.exactMatched,
      localCheckpointComparisons: report.referenceAgreement.compared }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { checkpointReference, replayClient };

if (require.main === module) main().catch(err => { console.error(err); process.exitCode = 1; });
