const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  LOGO_SETTING_KEYS,
  CORNER_MASK_SETTING_KEYS,
  SPONSOR_SETTING_KEYS,
  ANTI_THEFT_SETTING_KEYS,
  GLOBAL_OVERLAY_SETTING_KEYS,
  DEFAULT_GLOBAL_OVERLAY_SETTINGS,
  normalizeGlobalOverlaySettings,
  stripGlobalOverlaySettingsFromObject,
  readGlobalOverlaySettings,
  writeGlobalOverlaySettings,
  getEffectiveGlobalLogoSettingsForExport,
  getEffectiveGlobalCornerMaskForExport,
  getEffectiveGlobalSponsorForExport,
  getEffectiveGlobalAntiTheftForExport,
} = require('../services/globalOverlaySettingsService');

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

let overlayStorageMod;
let projectStorageMod;

test.before(async () => {
  overlayStorageMod = await import(
    pathToFileURL(path.join(__dirname, '../../frontend/src/utils/overlaySettingsStorage.js')).href
  );
  projectStorageMod = await import(
    pathToFileURL(path.join(__dirname, '../../frontend/src/utils/projectStorage.js')).href
  );
});

test('Frontend and backend share exact 45 global overlay keys across all 4 families', () => {
  assert.deepEqual(overlayStorageMod.LOGO_SETTING_KEYS, LOGO_SETTING_KEYS);
  assert.deepEqual(overlayStorageMod.CORNER_MASK_SETTING_KEYS, CORNER_MASK_SETTING_KEYS);
  assert.deepEqual(overlayStorageMod.SPONSOR_SETTING_KEYS, SPONSOR_SETTING_KEYS);
  assert.deepEqual(overlayStorageMod.ANTI_THEFT_SETTING_KEYS, ANTI_THEFT_SETTING_KEYS);
  assert.deepEqual(overlayStorageMod.GLOBAL_OVERLAY_SETTING_KEYS, GLOBAL_OVERLAY_SETTING_KEYS);
  assert.equal(GLOBAL_OVERLAY_SETTING_KEYS.length, 45);
});

test('Frontend normalization & export payloads cover logo*, cornerMask*, sponsor*, and anti-theft/watermark accurately', () => {
  const normalized = overlayStorageMod.normalizeGlobalOverlaySettings({
    enableLogo: true,
    logoPosition: 'bottom-right',
    logoSize: 92,
    logoOpacity: 0.85,
    logoShape: 'square',
    logoMargin: 18,
    logoXPercent: 75, // cleared since preset bottom-right
    logoYPercent: 25,
    enableCornerMask: true,
    cornerMaskText: 'Mask Text',
    cornerMaskStyle: 'solid',
    cornerMaskPosition: 'top-right',
    cornerMaskWidth: 190,
    cornerMaskHeight: 42,
    cornerMaskOpacity: 0.9,
    enableSponsor: true,
    sponsorVideoUrl: '/uploads/sponsor/demo.mp4',
    sponsorVideoPath: '/tmp/demo.mp4',
    sponsorChromaKey: true,
    sponsorChromaSimilarity: 0.32,
    sponsorPosition: 'custom',
    sponsorXPercent: 0,
    sponsorYPercent: 80.5,
    sponsorTimingMode: 'interval',
    sponsorIntervalSec: 45,
    sponsorDurationSec: 8,
    sponsorScale: 30,
    sponsorOpacity: 0.95,
    sponsorMargin: 12,
    sponsorMuteAudio: false,
    sponsorVolume: 0.75,
    enableAntiTheft: true,
    marqueeText: 'No Reupload',
    marqueeSpeed: 'fast',
    marqueePosition: 'top',
    marqueeTextColor: '#00FF00',
    enableWatermark: true,
    watermarkText: 'Studio Brand',
    watermarkPosition: 'bottom-left',
    watermarkColor: '#FFFFFF',
    antiTheftSize: 'large',
    antiTheftBottomPercent: 14.5,
  });

  assert.equal(normalized.logoPosition, 'bottom-right');
  assert.equal(normalized.logoXPercent, null);
  assert.equal(normalized.logoYPercent, null);
  assert.equal(normalized.cornerMaskWidth, 190);
  assert.equal(normalized.cornerMaskHeight, 42);
  assert.equal(normalized.cornerMaskStyle, 'solid');
  assert.equal(normalized.sponsorPosition, 'custom');
  assert.equal(normalized.sponsorXPercent, 0);
  assert.equal(normalized.sponsorYPercent, 80.5);
  assert.equal(normalized.sponsorMuteAudio, false);
  assert.equal(normalized.sponsorVolume, 0.75);
  assert.equal(normalized.enableAntiTheft, true);
  assert.equal(normalized.antiTheftSize, 'large');
  assert.equal(normalized.antiTheftBottomPercent, 14.5);

  const logoPayload = overlayStorageMod.buildLogoExportPayload(normalized);
  assert.equal(logoPayload.enabled, true);
  assert.equal(logoPayload.position, 'bottom-right');
  assert.equal(logoPayload.size, 92);
  assert.equal(logoPayload.logoXPercent, undefined);

  const maskPayload = overlayStorageMod.buildCornerMaskExportPayload(normalized);
  assert.deepEqual(maskPayload, {
    enabled: true,
    text: 'Mask Text',
    style: 'solid',
    position: 'top-right',
    width: 190,
    height: 42,
    opacity: 0.9,
  });

  const sponsorPayload = overlayStorageMod.buildSponsorExportPayload(normalized);
  assert.equal(sponsorPayload.enabled, true);
  assert.equal(sponsorPayload.sponsorXPercent, 0);
  assert.equal(sponsorPayload.sponsorYPercent, 80.5);
  assert.equal(sponsorPayload.muteAudio, false);
  assert.equal(sponsorPayload.volume, 0.75);

  const antiTheftPayload = overlayStorageMod.buildAntiTheftExportPayload(normalized);
  assert.equal(antiTheftPayload.enabled, true);
  assert.equal(antiTheftPayload.marqueeText, 'No Reupload');
  assert.equal(antiTheftPayload.watermarkPosition, 'bottom-left');
  assert.equal(antiTheftPayload.antiTheftSize, 'large');
  assert.equal(antiTheftPayload.antiTheftBottomPercent, 14.5);
});

test('One-time migration preserves legacy global logo store, seeds cornerMask/sponsor/anti-theft from active episode once, then ignores series.json forever', () => {
  const prevStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = createMockLocalStorage({
      [overlayStorageMod.LEGACY_STORAGE_GLOBAL_LOGO_SETTINGS_KEY]: JSON.stringify({
        version: 1,
        updatedAt: 1000,
        settings: {
          enableLogo: true,
          logoImage: '/assets/dragon_town_logo.jpg',
          logoPosition: 'top-left',
          logoSize: 84,
          logoOpacity: 0.8,
          logoShape: 'square',
          logoMargin: 16,
          logoXPercent: null,
          logoYPercent: null,
        },
      }),
    });

    assert.equal(overlayStorageMod.hasStoredGlobalOverlaySettings(), false);
    const migrated = overlayStorageMod.migrateGlobalOverlaySettingsIfNeeded({
      activeEpisodeVoiceSettings: {
        // Stale episode logo must NOT override already-migrated legacy global logo
        enableLogo: false,
        logoPosition: 'bottom-left',
        logoSize: 40,
        // Customized EP1 cornerMask, sponsor, anti-theft MUST seed into unified store
        enableCornerMask: true,
        cornerMaskStyle: 'solid',
        cornerMaskPosition: 'top-right',
        cornerMaskWidth: 175,
        cornerMaskHeight: 34,
        enableSponsor: true,
        sponsorVideoUrl: '/uploads/sponsor/ep1.mp4',
        sponsorScale: 32,
        enableAntiTheft: true,
        watermarkText: 'EP1 Brand',
        antiTheftSize: 'medium',
        subtitleColor: 'yellow',
      },
      syncServer: false,
    });

    assert.equal(overlayStorageMod.hasStoredGlobalOverlaySettings(), true);
    // Logo preserved from legacy global logo store
    assert.equal(migrated.enableLogo, true);
    assert.equal(migrated.logoPosition, 'top-left');
    assert.equal(migrated.logoSize, 84);
    assert.equal(migrated.logoShape, 'square');
    // Other 3 families seeded from active episode
    assert.equal(migrated.enableCornerMask, true);
    assert.equal(migrated.cornerMaskWidth, 175);
    assert.equal(migrated.cornerMaskHeight, 34);
    assert.equal(migrated.cornerMaskStyle, 'solid');
    assert.equal(migrated.enableSponsor, true);
    assert.equal(migrated.sponsorVideoUrl, '/uploads/sponsor/ep1.mp4');
    assert.equal(migrated.sponsorScale, 32);
    assert.equal(migrated.enableAntiTheft, true);
    assert.equal(migrated.watermarkText, 'EP1 Brand');
    assert.equal(migrated.antiTheftSize, 'medium');

    // Subsequent call with EP2's different values (e.g. 130x24 mask) must NEVER override global store
    const afterEp2 = overlayStorageMod.migrateGlobalOverlaySettingsIfNeeded({
      activeEpisodeVoiceSettings: {
        enableCornerMask: true,
        cornerMaskWidth: 130,
        cornerMaskHeight: 24,
        enableSponsor: false,
        enableAntiTheft: false,
        watermarkText: 'EP2 Different',
      },
      syncServer: false,
    });
    assert.deepEqual(afterEp2, migrated);
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('Per-episode voiceSettings strips all 45 global overlay keys on load/switch/save while keeping subtitles, ducking, volumes, and aspectRatio per-episode', () => {
  const prevStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = createMockLocalStorage();

    for (const key of GLOBAL_OVERLAY_SETTING_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(projectStorageMod.DEFAULT_VOICE_SETTINGS, key),
        false,
        `DEFAULT_VOICE_SETTINGS must not contain global overlay key ${key}`
      );
    }

    const pollutedEpSettings = {
      ...DEFAULT_GLOBAL_OVERLAY_SETTINGS,
      enableCornerMask: true,
      cornerMaskWidth: 130,
      cornerMaskHeight: 24,
      enableSponsor: true,
      sponsorScale: 40,
      enableAntiTheft: true,
      watermarkText: 'Per-Ep Junk',
      // Per-episode settings that MUST remain untouched
      burnSubtitles: false,
      subtitleColor: 'yellow',
      subtitleSize: 'large',
      duckingVolume: 0.28,
      khmerVolume: 1.45,
      enableDemucs: true,
      verticalStyle: 'crop',
      voiceId: 'km-KH-SreymomNeural',
      speed: 'fast',
    };

    const merged = projectStorageMod.resolveStickyVoiceSettings({
      prevSettings: { aspectRatio: '9:16', subtitleColor: 'white', duckingVolume: 0.15 },
      savedGlobalSettings: { aspectRatio: '9:16' },
      episodeVoiceSettings: pollutedEpSettings,
    });

    for (const key of GLOBAL_OVERLAY_SETTING_KEYS) {
      assert.equal(merged[key], undefined, `resolveStickyVoiceSettings must ignore ${key}`);
    }
    assert.equal(merged.burnSubtitles, false);
    assert.equal(merged.subtitleColor, 'yellow');
    assert.equal(merged.subtitleSize, 'large');
    assert.equal(merged.duckingVolume, 0.28);
    assert.equal(merged.khmerVolume, 1.45);
    assert.equal(merged.enableDemucs, true);
    assert.equal(merged.verticalStyle, 'crop');
    assert.equal(merged.aspectRatio, '9:16');

    const series = projectStorageMod.createDefaultSeries('Overlay Test', 'series_overlay_strip');
    projectStorageMod.saveSeriesList([series]);
    const epId = series.episodes[0].id;
    projectStorageMod.saveEpisodeState('series_overlay_strip', epId, {
      voiceSettings: pollutedEpSettings,
    });
    const savedEpVs = projectStorageMod.loadSeriesList()[0].episodes[0].voiceSettings;
    for (const key of GLOBAL_OVERLAY_SETTING_KEYS) {
      assert.equal(savedEpVs[key], undefined, `saveEpisodeState must strip ${key}`);
    }
    assert.equal(savedEpVs.subtitleColor, 'yellow');
    assert.equal(savedEpVs.duckingVolume, 0.28);
    assert.equal(savedEpVs.khmerVolume, 1.45);
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('Backend globalOverlaySettingsService persists all 4 families, formats exports, guards stale timestamps, and episodeService strips all 45 keys on write', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-overlay-test-'));
  try {
    const storePath = path.join(tmpDir, 'cache', 'global_overlay_settings.json');
    assert.equal(readGlobalOverlaySettings(storePath).initialized, false);

    const written = writeGlobalOverlaySettings(
      {
        enableLogo: true,
        logoPosition: 'bottom-right',
        logoSize: 96,
        logoShape: 'square',
        enableCornerMask: true,
        cornerMaskStyle: 'solid',
        cornerMaskPosition: 'top-right',
        cornerMaskWidth: 190,
        cornerMaskHeight: 42,
        cornerMaskOpacity: 0.9,
        enableSponsor: true,
        sponsorVideoUrl: '/uploads/sponsor/ad.mp4',
        sponsorPosition: 'bottom-left',
        sponsorScale: 28,
        enableAntiTheft: true,
        marqueeText: 'Protected',
        watermarkText: 'Global Brand',
        antiTheftSize: 'medium',
      },
      { storagePath: storePath, updatedAt: 2000 }
    );

    assert.equal(written.initialized, true);
    assert.equal(written.updatedAt, 2000);

    // Out-of-order stale timestamp must not clobber newer write
    const staleAttempt = writeGlobalOverlaySettings(
      { cornerMaskWidth: 111, logoSize: 40 },
      { storagePath: storePath, updatedAt: 1500 }
    );
    assert.equal(staleAttempt.overlaySettings.cornerMaskWidth, 190);
    assert.equal(staleAttempt.overlaySettings.logoSize, 96);

    const logoExp = getEffectiveGlobalLogoSettingsForExport(storePath);
    const maskExp = getEffectiveGlobalCornerMaskForExport(storePath);
    const sponsorExp = getEffectiveGlobalSponsorForExport(storePath);
    const antiTheftExp = getEffectiveGlobalAntiTheftForExport(storePath);

    assert.equal(logoExp.position, 'bottom-right');
    assert.equal(logoExp.size, 96);
    assert.equal(maskExp.enabled, true);
    assert.equal(maskExp.width, 190);
    assert.equal(maskExp.height, 42);
    assert.equal(maskExp.style, 'solid');
    assert.equal(sponsorExp.enabled, true);
    assert.equal(sponsorExp.sponsorVideoUrl, '/uploads/sponsor/ad.mp4');
    assert.equal(antiTheftExp.enabled, true);
    assert.equal(antiTheftExp.watermarkText, 'Global Brand');

    // episodeService.syncSeriesMetadataSafely strips all 45 overlay keys while keeping per-episode keys
    const projectsDir = path.join(tmpDir, 'projects');
    await syncSeriesMetadataSafely(
      'series_overlay_backend_strip',
      {
        id: 'series_overlay_backend_strip',
        title: 'Backend Strip Check',
        episodes: [
          {
            id: 'ep_1',
            episodeNumber: 1,
            title: 'EP 1',
            voiceSettings: {
              ...DEFAULT_GLOBAL_OVERLAY_SETTINGS,
              enableCornerMask: true,
              cornerMaskWidth: 175,
              enableSponsor: true,
              enableAntiTheft: true,
              subtitleColor: 'yellow',
              duckingVolume: 0.2,
              khmerVolume: 1.4,
              aspectRatio: '16:9',
            },
          },
        ],
      },
      { projectsDir }
    );

    const diskSeries = getSeriesMetadata('series_overlay_backend_strip', { forceDisk: true, projectsDir });
    const ep1Vs = diskSeries.episodes[0].voiceSettings;
    assert.equal(ep1Vs.subtitleColor, 'yellow');
    assert.equal(ep1Vs.duckingVolume, 0.2);
    assert.equal(ep1Vs.khmerVolume, 1.4);
    assert.equal(ep1Vs.aspectRatio, '16:9');
    for (const key of GLOBAL_OVERLAY_SETTING_KEYS) {
      assert.equal(ep1Vs[key], undefined, `series.json ep.voiceSettings must strip ${key}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Static wiring audit: preview, single export, batch export, and API routes use the unified global overlay store', () => {
  const appCode = fs.readFileSync(path.join(__dirname, '../../frontend/src/App.jsx'), 'utf8');
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

  assert.ok(appCode.includes('globalOverlaySettings'), 'App uses globalOverlaySettings');
  assert.ok(appCode.includes('...(globalOverlaySettings || DEFAULT_GLOBAL_OVERLAY_SETTINGS)'), 'studioSettings merges globalOverlaySettings');

  assert.ok(useVideoRenderCode.includes('buildLogoExportPayload'), 'useVideoRender uses buildLogoExportPayload');
  assert.ok(useVideoRenderCode.includes('buildCornerMaskExportPayload'), 'useVideoRender uses buildCornerMaskExportPayload');
  assert.ok(useVideoRenderCode.includes('buildSponsorExportPayload'), 'useVideoRender uses buildSponsorExportPayload');
  assert.ok(useVideoRenderCode.includes('buildAntiTheftExportPayload'), 'useVideoRender uses buildAntiTheftExportPayload');

  assert.ok(videoRoutesCode.includes('getEffectiveGlobalLogoSettingsForExport'), 'videoRoutes falls back to global logo');
  assert.ok(videoRoutesCode.includes('getEffectiveGlobalCornerMaskForExport'), 'videoRoutes falls back to global cornerMask');
  assert.ok(videoRoutesCode.includes('getEffectiveGlobalSponsorForExport'), 'videoRoutes falls back to global sponsor');
  assert.ok(videoRoutesCode.includes('getEffectiveGlobalAntiTheftForExport'), 'videoRoutes falls back to global antiTheft');
  assert.ok(!videoRoutesCode.includes('req.body?.voiceSettings?.cornerMask'), 'videoRoutes no longer reads per-episode cornerMask');
  assert.ok(!videoRoutesCode.includes('req.body?.voiceSettings?.sponsorSettings'), 'videoRoutes no longer reads per-episode sponsorSettings');
  assert.ok(!videoRoutesCode.includes('req.body?.voiceSettings?.antiTheft'), 'videoRoutes no longer reads per-episode antiTheft');

  assert.ok(batchExportCode.includes('getEffectiveGlobalLogoSettingsForExport'), 'batchExportService falls back to global logo');
  assert.ok(batchExportCode.includes('getEffectiveGlobalCornerMaskForExport'), 'batchExportService falls back to global cornerMask');
  assert.ok(batchExportCode.includes('getEffectiveGlobalSponsorForExport'), 'batchExportService falls back to global sponsor');
  assert.ok(batchExportCode.includes('getEffectiveGlobalAntiTheftForExport'), 'batchExportService falls back to global antiTheft');
  assert.ok(batchExportCode.includes('cornerMask,'), 'batchExportService forwards cornerMask to renderDubbedVideoWithDucking');

  assert.ok(systemRoutesCode.includes('router.get("/overlay-settings"'), 'systemRoutes exposes GET /api/overlay-settings');
  assert.ok(systemRoutesCode.includes('router.put("/overlay-settings"'), 'systemRoutes exposes PUT /api/overlay-settings');
});
