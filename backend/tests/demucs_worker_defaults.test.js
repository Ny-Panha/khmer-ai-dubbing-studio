const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const {
  killSeparationJob,
  isSeparationBusy,
  getSeparationProgress,
} = require('../services/audioSeparationService');

test('Demucs Worker Defaults & Service Inheritance', async (t) => {
  await t.test('1. demucs_worker.py argparse defaults match CPU-optimized Step-2-passing config', () => {
    const workerPath = path.join(__dirname, '../workers/demucs_worker.py');
    const pythonCandidates = [
      process.env.PYTHON_BIN,
      'C:\\Users\\nhastar\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
      'C:\\Users\\nhastar\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
      'python',
    ].filter(Boolean);
    const pythonBin = pythonCandidates.find((p) => p === 'python' || fs.existsSync(p)) || 'python';

    const pyCode = [
      'import sys, json',
      `sys.argv = ['demucs_worker.py', '--audio', 'a.mp4', '--output_dir', 'out']`,
      'import importlib.util',
      `spec = importlib.util.spec_from_file_location('demucs_worker', r'${workerPath}')`,
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'args = mod.parse_args()',
      'print(json.dumps({"shifts": args.shifts, "overlap": args.overlap, "segment": args.segment, "jobs": args.jobs, "suppress_residuals": args.suppress_residuals, "model": args.model}))',
    ].join('; ');

    const stdout = execFileSync(pythonBin, ['-c', pyCode], { encoding: 'utf8' });
    const parsed = JSON.parse(stdout.trim().split(/\r?\n/).pop());

    const os = require('os');
    const totalCores = os.cpus().length || 4;
    const reserveCores = totalCores >= 8 ? 2 : totalCores >= 4 ? 1 : 0;
    const usableCores = Math.max(1, totalCores - reserveCores);
    const expectedDefaultJobs = usableCores >= 2 ? Math.max(2, Math.min(4, Math.floor(usableCores / 3))) : 1;

    assert.strictEqual(parsed.model, 'htdemucs');
    assert.strictEqual(parsed.shifts, 0, 'shifts default must be 0');
    assert.strictEqual(parsed.overlap, 0.1, 'overlap default must be 0.1 (Turbo CPU speed)');
    assert.strictEqual(parsed.segment, null, 'segment default must be None (resolved safely per model: 7.8 for htdemucs, 10 for mdx_extra_q)');
    assert.strictEqual(parsed.jobs, expectedDefaultJobs, `jobs default must auto-scale to multi-core (${expectedDefaultJobs})`);
    assert.strictEqual(parsed.suppress_residuals, true, 'suppress_residuals must stay ON by default');
  });

  await t.test('2. audioSeparationService.js uses multi-core Turbo presets instead of hardcoded Eco CPU -j 1', () => {
    const serviceSrc = fs.readFileSync(path.join(__dirname, '../services/audioSeparationService.js'), 'utf8');
    assert.strictEqual(serviceSrc.includes('options.shifts || 1'), false, 'must never force shifts=1 in Turbo mode');
    assert.strictEqual(serviceSrc.includes('(Eco CPU)'), false, 'must no longer hardcode Eco CPU -j 1');
    assert.strictEqual(serviceSrc.includes("OMP_NUM_THREADS: '4'"), false, 'must no longer hardcode OMP_NUM_THREADS to 4');
    assert.strictEqual(serviceSrc.includes("options.shifts !== undefined"), true, 'must honor explicit --shifts override');
    assert.strictEqual(serviceSrc.includes("options.overlap !== undefined"), true, 'must honor explicit --overlap override');
    assert.strictEqual(serviceSrc.includes("options.segment !== undefined"), true, 'must honor explicit --segment override');
    assert.strictEqual(serviceSrc.includes("options.jobs !== undefined"), true, 'must honor explicit --jobs override');
    assert.strictEqual(serviceSrc.includes("args.push('--suppress_residuals')"), true, 'second-stage suppression remains enabled by default');
    assert.strictEqual(serviceSrc.includes('computeDefaultCpuConfig'), true, 'must dynamically compute multi-core CPU config');
    assert.strictEqual(serviceSrc.includes('resolveSeparationPresetConfig'), true, 'must resolve turbo / studio / ffmpeg_fast presets');
  });

  await t.test('3. killSeparationJob handles specific identifier without ReferenceError and busy state resets', () => {
    assert.strictEqual(isSeparationBusy(), false);
    const res = killSeparationJob('series_test_ep_1_source.mp4');
    assert.strictEqual(res.success, true);
    assert.strictEqual(getSeparationProgress('series_test_ep_1_source.mp4'), null);
  });

  await t.test('4. audioRoutes.js streams keep-alive headers & heartbeat on /audio/separate', () => {
    const routeSrc = fs.readFileSync(path.join(__dirname, '../routes/audioRoutes.js'), 'utf8');
    assert.strictEqual(routeSrc.includes('res.flushHeaders'), true, 'must flush headers early to avoid net::ERR_EMPTY_RESPONSE');
    assert.strictEqual(routeSrc.includes('heartbeatTimer'), true, 'must keep HTTP socket alive during long CPU runs');
    assert.strictEqual(routeSrc.includes('isSeparationBusy'), true, 'must check busy lock before sending 200 stream headers');
    assert.strictEqual(routeSrc.includes('noVocalsUrl'), true, 'progress endpoint returns recoverable noVocalsUrl');
  });
});

