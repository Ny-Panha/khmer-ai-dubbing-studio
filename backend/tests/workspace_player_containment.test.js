const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  STORAGE_VOICE_SETTINGS_KEY,
  VALID_ASPECT_RATIOS,
  sanitizeAspectRatio,
  resolveDefaultAspectRatio,
  inferRenderedAspectRatio,
  resolveStickyVoiceSettings,
  loadSavedVoiceSettings,
  saveVoiceSettings,
  sanitizeAndHealSeriesList,
} = require('../../frontend/src/utils/projectStorage');

function createMockLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };
}

test('sanitizeAspectRatio accepts only 16:9, 9:16, 1:1 and rejects poisoned values', () => {
  assert.deepEqual(VALID_ASPECT_RATIOS, ['16:9', '9:16', '1:1']);
  assert.equal(sanitizeAspectRatio('16:9'), '16:9');
  assert.equal(sanitizeAspectRatio('9:16'), '9:16');
  assert.equal(sanitizeAspectRatio('1:1'), '1:1');
  assert.equal(sanitizeAspectRatio(' 9:16 '), '9:16');

  for (const bad of [
    null,
    undefined,
    '',
    '   ',
    'auto',
    '4:3',
    '1:1 (Square / IG)',
    '16:10',
    16,
    true,
    {},
    ['16:9'],
  ]) {
    assert.equal(sanitizeAspectRatio(bad), null, `Expected ${JSON.stringify(bad)} -> null`);
  }
});

test('loadSavedVoiceSettings & saveVoiceSettings preserve valid 16:9/9:16/1:1 and neutralize bad values', () => {
  const prevStorage = globalThis.localStorage;
  try {
    // 1. Valid ratios including 1:1 must survive load
    for (const ratio of ['16:9', '9:16', '1:1']) {
      globalThis.localStorage = createMockLocalStorage({
        [STORAGE_VOICE_SETTINGS_KEY]: JSON.stringify({ aspectRatio: ratio, voiceId: 'km-KH-SreymomNeural' }),
      });
      const loaded = loadSavedVoiceSettings();
      assert.equal(loaded.aspectRatio, ratio);
      assert.equal(loaded.voiceId, 'km-KH-SreymomNeural');
    }

    // 2. Poisoned dropdown strings / non-string types fall back cleanly to null (follow-source default)
    for (const poisoned of ['1:1 (Square / IG)', 'auto', '4:3', { bad: true }, ['9:16'], 916]) {
      globalThis.localStorage = createMockLocalStorage({
        [STORAGE_VOICE_SETTINGS_KEY]: JSON.stringify({ aspectRatio: poisoned }),
      });
      const loaded = loadSavedVoiceSettings();
      assert.equal(loaded.aspectRatio, null);
    }

    // 3. Corrupt JSON or array root does not throw
    globalThis.localStorage = createMockLocalStorage({
      [STORAGE_VOICE_SETTINGS_KEY]: '{not-valid-json',
    });
    assert.equal(loadSavedVoiceSettings().aspectRatio, null);

    globalThis.localStorage = createMockLocalStorage({
      [STORAGE_VOICE_SETTINGS_KEY]: JSON.stringify(['unexpected']),
    });
    assert.equal(loadSavedVoiceSettings().aspectRatio, null);

    // 4. saveVoiceSettings normalizes invalid aspectRatio before persisting
    globalThis.localStorage = createMockLocalStorage();
    saveVoiceSettings({ aspectRatio: 'auto', voiceId: 'km-KH-PisethNeural' });
    const persisted = JSON.parse(globalThis.localStorage.getItem(STORAGE_VOICE_SETTINGS_KEY));
    assert.equal(persisted.aspectRatio, null);
    assert.equal(persisted.voiceId, 'km-KH-PisethNeural');
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('resolveStickyVoiceSettings, inferRenderedAspectRatio, and sanitizeAndHealSeriesList sanitize bad ratios', () => {
  const resolved = resolveStickyVoiceSettings({
    prevSettings: { aspectRatio: '1:1 (Square / IG)' },
    savedGlobalSettings: { aspectRatio: '9:16' },
    episodeVoiceSettings: { aspectRatio: 'bad-ratio', duckingVolume: 0.25 },
  });
  assert.equal(resolved.aspectRatio, '9:16');
  assert.equal(resolved.duckingVolume, 0.25);

  assert.equal(
    inferRenderedAspectRatio({ aspectRatio: 'auto', outputFilename: 'ep.mp4' }, { width: 1080, height: 1920 }, '16:9'),
    '9:16'
  );
  assert.equal(resolveDefaultAspectRatio(1920, 1080), '16:9');
  assert.equal(resolveDefaultAspectRatio(1080, 1920), '9:16');
  assert.equal(resolveDefaultAspectRatio(1080, 1080), '1:1');

  const prevStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = createMockLocalStorage();
    const healed = sanitizeAndHealSeriesList([
      {
        id: 's1',
        title: 'Test Series',
        episodes: [
          {
            id: 'ep_1',
            episodeNumber: 1,
            title: 'ភាគទី 1 (EP1)',
            voiceSettings: { aspectRatio: '4:3' },
            renderedVideo: { outputVideoUrl: '/uploads/ep1.mp4', aspectRatio: 'invalid' },
          },
          {
            id: 'ep_2',
            episodeNumber: 2,
            title: 'ភាគទី 2 (EP2)',
            voiceSettings: { aspectRatio: '1:1' },
          },
        ],
      },
    ]);
    assert.equal(healed[0].episodes[0].voiceSettings.aspectRatio, null);
    assert.equal(healed[0].episodes[0].renderedVideo.aspectRatio, undefined);
    assert.equal(healed[0].episodes[1].voiceSettings.aspectRatio, '1:1');
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('Workspace isolation, containment guards, and panel NaN guards exist in frontend source', () => {
  const appCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.jsx'), 'utf8');
  const playerCode = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/components/VideoPlayerPreview.jsx'),
    'utf8'
  );
  const panelsCode = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/hooks/useResizablePanels.js'),
    'utf8'
  );

  // Side panels, player, and timeline must each be isolated by an inline ErrorBoundary
  assert.match(appCode, /<ErrorBoundary inline name="Media Library">/);
  assert.match(appCode, /<ErrorBoundary inline name="Video Player">/);
  assert.match(appCode, /<ErrorBoundary inline name="Inspector">/);
  assert.match(appCode, /<ErrorBoundary inline name="Timeline">/);

  // Bounds = 0 must use CSS 16 / 9 aspect-ratio without inline 80px minimum pixel sizes
  assert.doesNotMatch(playerCode, /Math\.max\(80,\s*\(canvasBounds/);
  assert.match(playerCode, /aspectRatio:\s*'16 \/ 9'/);
  assert.match(playerCode, /Math\.min\(availW,\s*fittedW\)/);
  assert.match(playerCode, /Math\.min\(availH,\s*fittedH\)/);

  // Panel hook guards saved NaN widths with Number.isFinite
  assert.match(panelsCode, /Number\.isFinite\(parsed\)/);
});
