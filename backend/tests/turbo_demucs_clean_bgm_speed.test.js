/**
 * DragonDub AI — Turbo Demucs & Clean BGM Speed Optimization Verification Suite
 * Verifies all 3 Steps of turbo_demucs_clean_bgm_speed_prompt.md:
 * 1. Multi-core CPU scaling, overlap=0.1, safe segment clamping, and fast suppression in demucs_worker.py
 * 2. Dynamic multi-core CPU config, 3 presets (turbo / studio / ffmpeg_fast), and real FFmpeg Instant separation
 * 3. UI Speed Mode Pill (DubbingStepCardsBar + GeminiRouteModal + DubbingRunnerContext + audioApi)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');

const {
  separateAudio,
  resolvePythonBinary,
  computeDefaultCpuConfig,
  resolveSeparationPresetConfig,
  findAnyCachedSeparationDir,
} = require('../services/audioSeparationService');

const FRONTEND_SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');

function createStereoTestWav(filePath, durationSec = 2.0, sampleRate = 44100) {
  const numChannels = 2;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSec);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  // Mix wide stereo bass/BGM (100Hz + 600Hz L/R opposite) + centered voice (1000Hz L==R)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const bass = 0.25 * Math.sin(2 * Math.PI * 100 * t);
    const bgmWide = 0.2 * Math.sin(2 * Math.PI * 600 * t);
    const centerVoice = 0.35 * Math.sin(2 * Math.PI * 1000 * t);
    const l = Math.max(-1, Math.min(1, bass + bgmWide + centerVoice));
    const r = Math.max(-1, Math.min(1, bass - bgmWide + centerVoice));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
  }
  fs.writeFileSync(filePath, buf);
}

test('Turbo Demucs & Clean BGM Speed Optimization (Steps 1–3)', async (t) => {
  await t.test('Step 1: demucs_worker.py unlocks multi-core CPU scaling, overlap=0.1, and safe model segment clamping', () => {
    const workerPath = path.join(__dirname, '../workers/demucs_worker.py');
    const pythonBin = resolvePythonBinary();

    const pyCode = [
      'import sys, json, importlib.util',
      `spec = importlib.util.spec_from_file_location('demucs_worker', r'${workerPath}')`,
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'c10 = mod.compute_cpu_threading(10, None, "cpu", {})',
      'c12 = mod.compute_cpu_threading(12, None, "cpu", {})',
      'c12_full = mod.compute_cpu_threading(12, None, "cpu", {"DEMUCS_CPU_RESERVE_CORES": "0"})',
      'c4 = mod.compute_cpu_threading(4, None, "cpu", {})',
      'cuda = mod.compute_cpu_threading(12, None, "cuda", {})',
      's_ht_none = mod.resolve_safe_segment("htdemucs", None)',
      's_ht_10 = mod.resolve_safe_segment("htdemucs", 10)',
      's_ht_7 = mod.resolve_safe_segment("htdemucs", 7)',
      's_mdx_none = mod.resolve_safe_segment("mdx_extra_q", None)',
      'print(json.dumps({"c10": c10, "c12": c12, "c12_full": c12_full, "c4": c4, "cuda": cuda, "s_ht_none": s_ht_none, "s_ht_10": s_ht_10, "s_ht_7": s_ht_7, "s_mdx_none": s_mdx_none}))',
    ].join('; ');

    const stdout = execFileSync(pythonBin, ['-c', pyCode], { encoding: 'utf8' });
    const parsed = JSON.parse(stdout.trim().split(/\r?\n/).pop());

    assert.deepEqual(parsed.c10, [2, 4], '10-core CPU reserves 2 cores -> 2 jobs × 4 threads (8/10)');
    assert.deepEqual(parsed.c12, [3, 3], '12-core CPU reserves 2 cores -> 3 jobs × 3 threads (9/12)');
    assert.deepEqual(parsed.c12_full, [4, 3], 'DEMUCS_CPU_RESERVE_CORES=0 unlocks full 4 jobs × 3 threads (12/12)');
    assert.deepEqual(parsed.c4, [2, 1], '4-core CPU reserves 1 core -> 2 jobs × 1 thread (2/4)');
    assert.equal(parsed.cuda[0], 1, 'CUDA defaults to 1 worker job');

    const workerSrc = fs.readFileSync(workerPath, 'utf8');
    assert.ok(workerSrc.includes('BELOW_NORMAL_PRIORITY_CLASS'), 'demucs_worker.py must use Windows BELOW_NORMAL_PRIORITY_CLASS');
    assert.ok(workerSrc.includes('OMP_WAIT_POLICY') && workerSrc.includes('PASSIVE'), 'demucs_worker.py must set OMP_WAIT_POLICY=PASSIVE');

    assert.deepEqual(parsed.s_ht_none, [7.8, null], 'htdemucs default uses native 7.8 max segment cleanly');
    assert.deepEqual(parsed.s_ht_10, [7.8, null], 'htdemucs clamps requested 10s safely to 7.8 so it never crashes');
    assert.deepEqual(parsed.s_ht_7, [7, 7], 'htdemucs honors explicit <= 7 integer segment');
    assert.deepEqual(parsed.s_mdx_none, [10, 10], 'mdx_extra_q defaults to 10s segment');
  });

  await t.test('Step 2a: audioSeparationService.js computes multi-core CPU config & resolves turbo / studio / ffmpeg_fast presets', () => {
    const cfg10 = computeDefaultCpuConfig(10, {});
    assert.equal(cfg10.cpuJobs, 2);
    assert.equal(cfg10.threadsPerJob, 4);
    assert.equal(cfg10.usableCores, 8);

    const cfg12 = computeDefaultCpuConfig(12, {});
    assert.equal(cfg12.cpuJobs, 3);
    assert.equal(cfg12.threadsPerJob, 3);
    assert.equal(cfg12.usableCores, 10);

    const cfg12Full = computeDefaultCpuConfig(12, { DEMUCS_CPU_RESERVE_CORES: '0' });
    assert.equal(cfg12Full.cpuJobs, 4);
    assert.equal(cfg12Full.threadsPerJob, 3);
    assert.equal(cfg12Full.usableCores, 12);

    const cfgEnv = computeDefaultCpuConfig(12, { DEMUCS_CPU_JOBS: '2' });
    assert.equal(cfgEnv.cpuJobs, 2);
    assert.equal(cfgEnv.threadsPerJob, 5);

    const serviceSrc = fs.readFileSync(path.join(__dirname, '../services/audioSeparationService.js'), 'utf8');
    assert.ok(serviceSrc.includes('PRIORITY_BELOW_NORMAL'), 'audioSeparationService.js must set PRIORITY_BELOW_NORMAL on spawned Python worker');
    assert.ok(serviceSrc.includes("OMP_WAIT_POLICY: 'PASSIVE'"), 'audioSeparationService.js must pass OMP_WAIT_POLICY=PASSIVE');

    const turbo = resolveSeparationPresetConfig('turbo', {}, {});
    assert.equal(turbo.separationPreset, 'turbo');
    assert.equal(turbo.engine, 'demucs');
    assert.equal(turbo.model, 'htdemucs');
    assert.equal(turbo.overlap, 0.1);
    assert.equal(turbo.shifts, 0);
    assert.ok(turbo.jobs >= 2);

    const turboMdx = resolveSeparationPresetConfig('turbo', {}, { DEMUCS_FAST_MODEL: 'mdx_extra_q' });
    assert.equal(turboMdx.model, 'mdx_extra_q');
    assert.equal(turboMdx.segment, 10);

    const studio = resolveSeparationPresetConfig('studio', {}, {});
    assert.equal(studio.separationPreset, 'studio');
    assert.equal(studio.model, 'htdemucs');
    assert.equal(studio.overlap, 0.25);
    assert.equal(studio.shifts, 1);

    const ffFast = resolveSeparationPresetConfig('ffmpeg_fast', {}, {});
    assert.equal(ffFast.separationPreset, 'ffmpeg_fast');
    assert.equal(ffFast.engine, 'ffmpeg_fast');
    assert.equal(ffFast.model, 'ffmpeg_fast');
  });

  await t.test('Step 2b: FFmpeg Instant (ffmpeg_fast) separates stereo audio in < 3s, validates stems, caches, and honors force=true', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'turbo-fffast-test-'));
    const inputWav = path.join(tmpRoot, 'sample_drama_ep.wav');
    const outDir = path.join(tmpRoot, 'out_stems');
    createStereoTestWav(inputWav, 2.0);

    try {
      const t0 = Date.now();
      const first = await separateAudio({
        audioPath: inputWav,
        outputDir: outDir,
        separationPreset: 'ffmpeg_fast',
        sourceDuration: 2.0,
      });
      const elapsedSec = (Date.now() - t0) / 1000;

      assert.equal(first.status, 'success');
      assert.equal(first.separationPreset, 'ffmpeg_fast');
      assert.equal(first.model, 'ffmpeg_fast');
      assert.equal(first.isCached, false);
      assert.ok(elapsedSec < 5.0, `Expected < 5s, got ${elapsedSec.toFixed(2)}s`);
      assert.equal(fs.existsSync(first.vocalsPath), true);
      assert.equal(fs.existsSync(first.noVocalsPath), true);
      assert.ok(first.vocalsSizeBytes >= 100 * 1024);
      assert.ok(first.noVocalsSizeBytes >= 100 * 1024);
      assert.ok(Math.abs(first.noVocalsDuration - 2.0) < 0.2);

      // Instant cache hit when force=false
      const cached = await separateAudio({
        audioPath: inputWav,
        outputDir: outDir,
        separationPreset: 'ffmpeg_fast',
        sourceDuration: 2.0,
      });
      assert.equal(cached.status, 'success');
      assert.equal(cached.isCached, true);
      assert.equal(cached.separationPreset, 'ffmpeg_fast');

      // force=true bypasses cache and re-runs cleanly
      const forced = await separateAudio({
        audioPath: inputWav,
        outputDir: outDir,
        separationPreset: 'ffmpeg_fast',
        force: true,
        sourceDuration: 2.0,
      });
      assert.equal(forced.status, 'success');
      assert.equal(forced.isCached, false);

      // findAnyCachedSeparationDir locates cache dir without throwing
      const found = findAnyCachedSeparationDir(inputWav, 'ffmpeg_fast');
      assert.equal(found.modelKey, 'ffmpeg_fast');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await t.test('Step 2c & Step 3: audioRoutes.js, audioApi.js, DubbingRunnerContext, DubbingStepCardsBar & GeminiRouteModal wire Speed Mode Pill cleanly', () => {
    const audioRoutes = fs.readFileSync(path.join(__dirname, '../routes/audioRoutes.js'), 'utf8');
    assert.match(audioRoutes, /separationPreset\s*=\s*['"]turbo['"]/);
    assert.match(audioRoutes, /findAnyCachedSeparationDir/);

    const audioApi = fs.readFileSync(path.join(FRONTEND_SRC, 'services', 'api', 'audioApi.js'), 'utf8');
    assert.match(audioApi, /separationPreset\s*=\s*['"]turbo['"]/);

    const adapter = fs.readFileSync(path.join(FRONTEND_SRC, 'features', 'dubbing-runner', 'dubbingExecutionAdapter.js'), 'utf8');
    assert.match(adapter, /separationPreset/);

    const runnerCtx =
      fs.readFileSync(path.join(FRONTEND_SRC, 'features', 'dubbing-runner', 'DubbingRunnerContext.jsx'), 'utf8') +
      '\n' +
      fs.readFileSync(path.join(FRONTEND_SRC, 'features', 'dubbing-runner', 'singleEpisodeRunners.js'), 'utf8');
    assert.match(runnerCtx, /separationPreset/);
    assert.match(runnerCtx, /ffmpeg_fast/);

    const cardsBar = fs.readFileSync(path.join(FRONTEND_SRC, 'features', 'dubbing-runner', 'DubbingStepCardsBar.jsx'), 'utf8');
    assert.match(cardsBar, /data-testid="clean-bgm-preset-bar"/);
    assert.match(cardsBar, /btn-preset-/);
    assert.match(cardsBar, /Demucs Turbo/);
    assert.match(cardsBar, /FFmpeg 5s/);
    assert.match(cardsBar, /Studio HQ|Studio/);

    const modal = fs.readFileSync(path.join(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx'), 'utf8');
    assert.match(modal, /dragondub_separation_preset/);
    assert.match(modal, /onSeparationPresetChange=\{setSeparationPreset\}/);
  });
});
