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

    assert.strictEqual(parsed.model, 'htdemucs');
    assert.strictEqual(parsed.shifts, 0, 'shifts default must be 0');
    assert.strictEqual(parsed.overlap, 0.25, 'overlap default must be 0.25');
    assert.strictEqual(parsed.segment, 7, 'segment default must be 7');
    assert.ok(parsed.jobs >= 1 && parsed.jobs <= 2, 'jobs default must be 1 (Eco Mode) or 2');
    assert.strictEqual(parsed.suppress_residuals, true, 'suppress_residuals must stay ON by default');
  });

  await t.test('2. audioSeparationService.js inherits worker defaults instead of forcing shifts=1 or overlap=0.25', () => {
    const serviceSrc = fs.readFileSync(path.join(__dirname, '../services/audioSeparationService.js'), 'utf8');
    assert.strictEqual(serviceSrc.includes('options.shifts || 1'), false, 'must never fall back to shifts=1');
    assert.strictEqual(serviceSrc.includes("options.shifts !== undefined"), true, 'must only pass --shifts when explicitly provided');
    assert.strictEqual(serviceSrc.includes("options.overlap !== undefined"), true, 'must only pass --overlap when explicitly provided');
    assert.strictEqual(serviceSrc.includes("options.segment !== undefined"), true, 'must only pass --segment when explicitly provided');
    assert.strictEqual(serviceSrc.includes("options.jobs !== undefined"), true, 'must only pass --jobs when explicitly provided');
    assert.strictEqual(serviceSrc.includes("args.push('--suppress_residuals')"), true, 'second-stage suppression remains enabled by default');
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

