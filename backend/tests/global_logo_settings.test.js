const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  LOGO_SETTING_KEYS,
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  normalizeGlobalLogoSettings,
  stripLogoSettingsFromObject,
  readGlobalLogoSettings,
  writeGlobalLogoSettings,
  getEffectiveGlobalLogoSettingsForExport,
} = require('../services/globalLogoSettingsService');

const { syncSeriesMetadataSafely, getSeriesMetadata } = require('../services/episodeService');

function createMockLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    key(idx) {
      return Array.from(store.keys())[idx] ?? null;
    },
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };
}

let logoStorageMod;
let projectStorageMod;

test.before(async () => {
  logoStorageMod = await import(
    pathToFileURL(path.join(__dirname, '../../frontend/src/utils/logoSettingsStorage.js')).href
  );
  projectStorageMod = await import(
    pathToFileURL(path.join(__dirname, '../../frontend/src/utils/projectStorage.js')).href
  );
});

test('Frontend global logo store: normalizes all 9 keys, clears custom coords on preset switch, preserves 0%', () => {
  const custom = logoStorageMod.normalizeGlobalLogoSettings({
    enableLogo: true,
    logoImage: 'data:image/png;base64,AAA=',
    logoPosition: 'custom',
    logoSize: 96,
    logoOpacity: 0.75,
    logoShape: 'square',
    logoMargin: 32,
    logoXPercent: 0,
    logoYPercent: 0,
  });

  assert.equal(custom.logoPosition, 'custom');
  assert.equal(custom.logoXPercent, 0);
  assert.equal(custom.logoYPercent, 0);
  assert.equal(custom.logoSize, 96);
  assert.equal(custom.logoOpacity, 0.75);
  assert.equal(custom.logoShape, 'square');
  assert.equal(custom.logoMargin, 32);

  // Switching from custom to top-left must clear logoXPercent/logoYPercent so preset works cleanly
  const preset = logoStorageMod.normalizeGlobalLogoSettings(
    { ...custom, logoPosition: 'top-left' },
    custom
  );
  assert.equal(preset.logoPosition, 'top-left');
  assert.equal(preset.logoXPercent, null);
  assert.equal(preset.logoYPercent, null);

  const exportPreset = logoStorageMod.buildLogoExportPayload(preset);
  assert.equal(exportPreset.position, 'top-left');
  assert.equal(exportPreset.logoXPercent, undefined);
  assert.equal(exportPreset.logoYPercent, undefined);

  const exportCustom = logoStorageMod.buildLogoExportPayload(custom);
  assert.equal(exportCustom.position, 'custom');
  assert.equal(exportCustom.logoXPercent, 0);
  assert.equal(exportCustom.logoYPercent, 0);
});

test('Frontend one-time migration seeds from customized active episode once, then ignores per-episode logo values forever', () => {
  const prevStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = createMockLocalStorage();

    // First run: no global store yet -> seeds from currently open EP1 customized logo
    assert.equal(logoStorageMod.hasStoredGlobalLogoSettings(), false);
    const migrated = logoStorageMod.migrateGlobalLogoSettingsIfNeeded({
      activeEpisodeVoiceSettings: {
        enableLogo: true,
        logoPosition: 'custom',
        logoSize: 88,
        logoOpacity: 0.7,
        logoShape: 'square',
        logoXPercent: 85.5,
        logoYPercent: 12.3,
        subtitleColor: 'yellow',
      },
      syncServer: false,
    });

    assert.equal(logoStorageMod.hasStoredGlobalLogoSettings(), true);
    assert.equal(migrated.logoPosition, 'custom');
    assert.equal(migrated.logoSize, 88);
    assert.equal(migrated.logoOpacity, 0.7);
    assert.equal(migrated.logoShape, 'square');
    assert.equal(migrated.logoXPercent, 85.5);
    assert.equal(migrated.logoYPercent, 12.3);

    // Subsequent call with EP2's different logo values must NOT overwrite the global store
    const afterEp2 = logoStorageMod.migrateGlobalLogoSettingsIfNeeded({
      activeEpisodeVoiceSettings: {
        enableLogo: false,
        logoPosition: 'bottom-left',
        logoSize: 44,
        logoOpacity: 0.4,
      },
      syncServer: false,
    });
    assert.deepEqual(afterEp2, migrated);
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('Per-episode voiceSettings ignores logo* keys on load/switch and strips logo* keys on save, while preserving all other visual settings', () => {
  const prevStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = createMockLocalStorage();

    // DEFAULT_VOICE_SETTINGS must not carry logo* keys
    for (const key of LOGO_SETTING_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(projectStorageMod.DEFAULT_VOICE_SETTINGS, key),
        false,
        `DEFAULT_VOICE_SETTINGS should not contain ${key}`
      );
    }

    // Switching episodes with stale per-episode overlay keys must ignore global overlay families while keeping subtitle/ducking/volume/aspect settings
    const merged = projectStorageMod.resolveStickyVoiceSettings({
      prevSettings: { aspectRatio: '16:9', subtitleColor: 'white', duckingVolume: 0.15 },
      savedGlobalSettings: { aspectRatio: '16:9' },
      episodeVoiceSettings: {
        enableLogo: false,
        logoImage: '/assets/other.png',
        logoPosition: 'bottom-left',
        logoSize: 40,
        logoOpacity: 0.3,
        logoShape: 'square',
        logoMargin: 10,
        logoXPercent: 10,
        logoYPercent: 10,
        subtitleColor: 'yellow',
        enableWatermark: false,
        enableCornerMask: true,
        enableSponsor: true,
        duckingVolume: 0.25,
        khmerVolume: 1.5,
      },
    });

    for (const key of LOGO_SETTING_KEYS) {
      assert.equal(merged[key], undefined, `resolveStickyVoiceSettings must not include ${key}`);
    }
    assert.equal(merged.subtitleColor, 'yellow');
    assert.equal(merged.duckingVolume, 0.25);
    assert.equal(merged.khmerVolume, 1.5);
    assert.equal(merged.enableWatermark, undefined);
    assert.equal(merged.enableCornerMask, undefined);
    assert.equal(merged.enableSponsor, undefined);

    // saveVoiceSettings strips logo* keys
    projectStorageMod.saveVoiceSettings({
      voiceId: 'km-KH-SreymomNeural',
      subtitleColor: 'cyan',
      enableLogo: true,
      logoSize: 120,
      logoXPercent: 50,
    });
    const savedVoiceRaw = JSON.parse(
      globalThis.localStorage.getItem(projectStorageMod.STORAGE_VOICE_SETTINGS_KEY)
    );
    assert.equal(savedVoiceRaw.subtitleColor, 'cyan');
    for (const key of LOGO_SETTING_KEYS) {
      assert.equal(savedVoiceRaw[key], undefined, `STORAGE_VOICE_SETTINGS_KEY must strip ${key}`);
    }

    // saveEpisodeState strips logo* and other global overlay keys from ep.voiceSettings while keeping per-episode settings
    const series = projectStorageMod.createDefaultSeries('Test Series', 'series_logo_test');
    projectStorageMod.saveSeriesList([series]);
    const epId = series.episodes[0].id;
    projectStorageMod.saveEpisodeState('series_logo_test', epId, {
      voiceSettings: {
        subtitleColor: 'yellow',
        duckingVolume: 0.22,
        enableSponsor: true,
        enableLogo: true,
        logoPosition: 'top-right',
        logoSize: 110,
        logoXPercent: 77,
        logoYPercent: 22,
      },
    });
    const reloaded = projectStorageMod.loadSeriesList();
    const epVs = reloaded[0].episodes[0].voiceSettings;
    assert.equal(epVs.subtitleColor, 'yellow');
    assert.equal(epVs.duckingVolume, 0.22);
    assert.equal(epVs.enableSponsor, undefined);
    for (const key of LOGO_SETTING_KEYS) {
      assert.equal(epVs[key], undefined, `Saved ep.voiceSettings must strip ${key}`);
    }
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('Backend globalLogoSettingsService persists globally and episodeService strips logo* keys on series.json write', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-logo-test-'));
  try {
    const storePath = path.join(tmpDir, 'cache', 'global_logo_settings.json');
    assert.equal(readGlobalLogoSettings(storePath).initialized, false);

    const written = writeGlobalLogoSettings(
      {
        enableLogo: true,
        logoImage: '/assets/dragon_town_logo.jpg',
        logoPosition: 'bottom-right',
        logoSize: 104,
        logoOpacity: 0.85,
        logoShape: 'square',
        logoMargin: 24,
        logoXPercent: 90, // must be cleared since position is preset bottom-right
        logoYPercent: 10,
      },
      { storagePath: storePath, updatedAt: 123456789 }
    );

    assert.equal(written.initialized, true);
    assert.equal(written.logoSettings.logoPosition, 'bottom-right');
    assert.equal(written.logoSettings.logoSize, 104);
    assert.equal(written.logoSettings.logoShape, 'square');
    assert.equal(written.logoSettings.logoXPercent, null);
    assert.equal(written.logoSettings.logoYPercent, null);

    const readBack = readGlobalLogoSettings(storePath);
    assert.equal(readBack.initialized, true);
    assert.equal(readBack.updatedAt, 123456789);
    assert.deepEqual(readBack.logoSettings, written.logoSettings);

    const forExport = getEffectiveGlobalLogoSettingsForExport(storePath);
    assert.equal(forExport.enabled, true);
    assert.equal(forExport.position, 'bottom-right');
    assert.equal(forExport.size, 104);
    assert.equal(forExport.shape, 'square');
    assert.equal(forExport.logoXPercent, undefined);

    // Verify episodeService.syncSeriesMetadataSafely strips logo* keys from ep.voiceSettings while keeping non-logo settings
    const projectsDir = path.join(tmpDir, 'projects');
    await syncSeriesMetadataSafely(
      'series_strip_check',
      {
        id: 'series_strip_check',
        title: 'Strip Check',
        episodes: [
          {
            id: 'ep_1',
            episodeNumber: 1,
            title: 'EP 1',
            voiceSettings: {
              subtitleColor: 'yellow',
              enableCornerMask: true,
              enableLogo: true,
              logoPosition: 'top-left',
              logoSize: 80,
              logoXPercent: 12,
              logoYPercent: 34,
            },
          },
        ],
      },
      { projectsDir }
    );

    const diskSeries = getSeriesMetadata('series_strip_check', { forceDisk: true, projectsDir });
    const ep1Vs = diskSeries.episodes[0].voiceSettings;
    assert.equal(ep1Vs.subtitleColor, 'yellow');
    assert.equal(ep1Vs.enableCornerMask, undefined);
    for (const key of LOGO_SETTING_KEYS) {
      assert.equal(ep1Vs[key], undefined, `series.json ep.voiceSettings must not contain ${key}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Static wiring audit: single export, batch export, systemRoutes, and ffmpegService use global logo store safely', () => {
  const useVideoRenderCode = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/hooks/useVideoRender.js'),
    'utf8'
  );
  const videoRoutesCode = fs.readFileSync(
    path.join(__dirname, '../routes/videoRoutes.js'),
    'utf8'
  );
  const batchExportCode = fs.readFileSync(
    path.join(__dirname, '../services/batchExportService.js'),
    'utf8'
  );
  const systemRoutesCode = fs.readFileSync(
    path.join(__dirname, '../routes/systemRoutes.js'),
    'utf8'
  );
  const ffmpegCode = fs.readFileSync(
    path.join(__dirname, '../services/ffmpegService.js'),
    'utf8'
  );

  assert.ok(useVideoRenderCode.includes('buildLogoExportPayload'), 'useVideoRender uses global buildLogoExportPayload');
  assert.ok(useVideoRenderCode.includes('getLatestGlobalOverlaySettings'), 'buildLogoOptions reads from global overlay store');
  assert.ok(useVideoRenderCode.includes('logoSettings: buildLogoOptions()'), 'batch export uses buildLogoOptions()');
  assert.ok(useVideoRenderCode.includes('const logoOptions = buildLogoOptions()'), 'single export uses buildLogoOptions()');

  assert.ok(videoRoutesCode.includes('getEffectiveGlobalLogoSettingsForExport'), 'videoRoutes falls back to global logo store');
  assert.ok(!videoRoutesCode.includes('req.body?.voiceSettings?.logoSettings'), 'videoRoutes no longer reads per-episode logoSettings');
  assert.ok(batchExportCode.includes('getEffectiveGlobalLogoSettingsForExport'), 'batchExportService falls back to global logo store');

  assert.ok(systemRoutesCode.includes('router.get("/logo-settings"'), 'systemRoutes exposes GET /api/logo-settings');
  assert.ok(systemRoutesCode.includes('router.put("/logo-settings"'), 'systemRoutes exposes PUT /api/logo-settings');

  assert.ok(ffmpegCode.includes('logoSettings.logoXPercent !== null'), 'ffmpegService guards null logoXPercent from hijacking presets');
});
