/**
 * Regression suite for the Full-Project Master Upgrade (.specify/specs/full-project-master-upgrade.md).
 * Guards: UTF-8 integrity, portable Python discovery, SPA episode split, dynamic voice labels, quota model sync.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const FRONTEND_SRC = path.join(ROOT, 'frontend', 'src');
const BACKEND = path.join(ROOT, 'backend');
const SKIP_DIRS = new Set(['node_modules', 'uploads', 'dist', 'coverage', '.venv', 'temp', 'tmp', 'output', 'outputs', 'cache']);
const SOURCE_EXT = new Set(['.js', '.jsx', '.cjs', '.mjs', '.css', '.ts', '.tsx']);

function collectSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(path.join(dir, entry.name), out);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('Phase 1: zero U+FFFD replacement characters in frontend/src and backend source files', () => {
  const files = [...collectSourceFiles(FRONTEND_SRC), ...collectSourceFiles(BACKEND)];
  assert.ok(files.length > 50, `expected to scan many files, got ${files.length}`);
  const offenders = files
    .filter((f) => fs.readFileSync(f, 'utf8').includes('\uFFFD'))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, [], `Files containing U+FFFD: ${offenders.join(', ')}`);
});

test('Phase 3a: EpisodesTab split uses SPA refresh + inline banner (no alert / reload)', () => {
  const src = read(FRONTEND_SRC, 'components', 'media', 'EpisodesTab.jsx');
  assert.ok(!/window\.location\.reload\(/.test(src), 'window.location.reload() must be removed');
  assert.ok(!/\balert\(/.test(src), 'alert() must be removed');
  assert.match(src, /onRefreshSeries/);
  assert.match(src, /data-testid="episode-split-status-banner"/);

  const lib = read(FRONTEND_SRC, 'components', 'media', 'MediaLibrary.jsx');
  const episodesTabBlock = lib.slice(lib.indexOf('<EpisodesTab'), lib.indexOf('/>', lib.indexOf('<EpisodesTab')));
  assert.match(episodesTabBlock, /onRefreshSeries=\{onRefreshSeries\}/);
});

test('Phase 3b: ScriptReviewTab resolves voice labels from catalog + gender filter pills', async () => {
  const src = read(FRONTEND_SRC, 'components', 'media', 'ScriptReviewTab.jsx');
  assert.ok(!/includes\('Sreymom'\)\s*\?\s*'Sreymom'\s*:\s*'Piseth'/.test(src), 'hardcoded binary voice label must be removed');
  assert.match(src, /resolveVoiceMeta/);
  assert.match(src, /script-filter-\$\{pill\.mode\}/);
  assert.match(src, /ឃ្លាខូច\/ខ្វះសំឡេង/);

  const { resolveVoiceMeta } = await import(pathToFileURL(path.join(FRONTEND_SRC, 'utils', 'voiceCatalog.js')).href);
  assert.equal(resolveVoiceMeta({ voiceId: 'km-KH-SreymomNeural' }).label, 'ស្រីមុំ');
  assert.equal(resolveVoiceMeta({ voiceId: 'km-KH-SreymomNeural' }).gender, 'FEMALE');
  assert.equal(resolveVoiceMeta({ khmerVoiceId: 'km-KH-PisethNeural' }).label, 'ពិសិដ្ឋ');
  assert.equal(resolveVoiceMeta({ speakerGender: 'FEMALE' }).gender, 'FEMALE');
  assert.equal(resolveVoiceMeta({ voiceGender: 'female' }).label, 'ស្រីមុំ');
  assert.equal(resolveVoiceMeta({}).gender, 'MALE');
  const unknown = resolveVoiceMeta({ voiceId: 'km-KH-DaraNeural', gender: 'female' });
  assert.equal(unknown.gender, 'FEMALE');
  assert.equal(unknown.label, 'Dara');
  assert.equal(unknown.known, false);
});

test('Phase 5a: audioSeparationService has no machine-specific paths and honours PYTHON_BIN', () => {
  const servicesDir = path.join(BACKEND, 'services');
  const offenders = collectSourceFiles(servicesDir)
    .filter((f) => /C:\\\\Users\\\\nhastar|C:\\Users\\nhastar/i.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, [], `Hardcoded user paths in: ${offenders.join(', ')}`);

  const { resolvePythonBinary } = require('../services/audioSeparationService');
  assert.equal(typeof resolvePythonBinary, 'function');
  // PYTHON_BIN pointing at an existing file wins
  assert.equal(resolvePythonBinary({ PYTHON_BIN: process.execPath }, 'win32'), process.execPath);
  // Missing PYTHON_BIN + no installs -> PATH fallback per platform
  const winResult = resolvePythonBinary({ PYTHON_BIN: path.join(ROOT, '__missing__.exe') }, 'win32');
  assert.ok(winResult === 'python' || winResult.endsWith('python.exe'));
  const linuxResult = resolvePythonBinary({}, 'linux');
  assert.ok(linuxResult === 'python3' || /[\\/]bin[\\/]python$/.test(linuxResult));
});

test('Phase 2: GeminiRouteModal renders 4 batch action buttons and 3 stage cards per episode', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  assert.match(modal, /batch-primary-execution-row/);
  assert.match(modal, /1\.\s*Translate\s*Script/);
  assert.match(modal, /2\.\s*AI\s*Translate\s*Voice/);
  assert.match(modal, /(?:3|4)\.\s*AI\s*បិទសំឡេងចិន/);
  assert.match(modal, /Run\s*All\s*3\s*Steps/);
  assert.match(modal, /EpisodeTranslateProgressCard/);
  assert.match(modal, /EpisodeTtsProgressCard/);
  assert.match(modal, /EpisodeDemucsProgressCard/);
});

test('Phase 4: Export settings stages, sticky footer, and ClipInspector 300ms spinner + test preview', () => {
  const exportPanel = read(FRONTEND_SRC, 'components', 'voice', 'ExportSettingsPanel.jsx');
  assert.match(exportPanel, /1\/4\s*បង្កើតអក្សរខ្មែរ\s*\.ASS/);
  assert.match(exportPanel, /2\/4\s*បន្ថយសំឡេងដើម\s*Smart\s*Ducking/);
  assert.match(exportPanel, /3\/4\s*បញ្ចូលសំឡេងខ្មែរ\s*AI\s*&\s*Clean\s*BGM/);
  assert.match(exportPanel, /4\/4\s*Render\s*វីដេអូ\s*MP4/);

  const voiceCss = read(FRONTEND_SRC, 'components', 'voice', 'VoiceSettings.css');
  assert.match(voiceCss, /\.inspector-sticky-footer/);
  assert.match(voiceCss, /position:\s*sticky/);
  assert.match(voiceCss, /bottom:\s*0/);

  const clipInspector = read(FRONTEND_SRC, 'components', 'voice', 'ClipInspectorPanel.jsx');
  assert.match(clipInspector, /minSpin\s*=\s*new\s*Promise\(\(r\)\s*=>\s*setTimeout\(r,\s*300\)\)/);
  assert.match(clipInspector, /🔊\s*ស្តាប់សាកល្បង/);
});

test('Phase 3c: sanitizeScriptData and sanitizeSeriesEpisodes filter out null/non-object segment elements', async () => {
  const { sanitizeSeriesEpisodes } = require('../models/episodeModel');
  const dirtySeries = {
    id: 'test_series',
    episodes: [
      {
        id: 'ep_1',
        episodeNumber: 1,
        title: 'EP1',
        scriptData: {
          segments: [
            null,
            undefined,
            { id: 1, chineseText: '你好', khmerText: 'សួស្តី' },
            null,
          ],
        },
      },
    ],
  };
  const cleaned = sanitizeSeriesEpisodes(dirtySeries);
  assert.equal(cleaned.episodes[0].scriptData.segments.length, 1);
  assert.equal(cleaned.episodes[0].scriptData.segments[0].chineseText, '你好');

  // Verify frontend timelineUtils.sanitizeScriptData guards against nulls
  const timelineUtilsPath = path.join(FRONTEND_SRC, 'utils', 'timelineUtils.js');
  const timelineSrc = fs.readFileSync(timelineUtilsPath, 'utf8');
  assert.match(timelineSrc, /filter\(\(seg\)\s*=>\s*seg\s*&&\s*typeof\s*seg\s*===\s*['"]object['"]\)/);
});

test('Phase 5b: GeminiQuotaModal model IDs are all present in backend geminiModelCatalog', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiQuotaModal.jsx');
  const catalog = read(BACKEND, 'services', 'geminiModelCatalog.js');
  const modelIds = [...new Set((modal.match(/['"`](gemini-[0-9a-z.\-]+)['"`]/g) || []).map((s) => s.slice(1, -1)))]
    .filter((id) => id !== 'gemini-quota-modal');
  assert.ok(modelIds.length > 0, 'expected model IDs in GeminiQuotaModal.jsx');
  const missing = modelIds.filter((id) => !catalog.includes(`'${id}'`) && !catalog.includes(`"${id}"`));
  assert.deepEqual(missing, [], `Model IDs not in backend catalog: ${missing.join(', ')}`);

  const batchExportModal = read(FRONTEND_SRC, 'components', 'dashboard', 'BatchExportStudioModal.jsx');
  assert.match(batchExportModal, /⚠️\s*គ្មានវីដេអូ/);
  assert.match(batchExportModal, /⚠️\s*គ្មាន\s*Script/);
  assert.match(batchExportModal, /⚠️\s*សំឡេងមិនទាន់អាប់ដេត/);
  assert.match(batchExportModal, /⚠️\s*គ្មានសំឡេង\s*AI/);
});

