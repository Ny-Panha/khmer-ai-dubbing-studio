import {
  STORAGE_GLOBAL_OVERLAY_SETTINGS_KEY,
  LOGO_SETTING_KEYS,
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  normalizeGlobalLogoSettings,
  normalizeGlobalOverlaySettings,
  loadGlobalOverlaySettingsRecord,
  saveGlobalOverlaySettings,
  fetchGlobalOverlaySettingsFromServer,
  syncGlobalOverlaySettingsToServer,
  resolveInitialOverlaySeed,
  migrateGlobalOverlaySettingsIfNeeded,
  buildLogoExportPayload,
} from './overlaySettingsStorage.js';

export const STORAGE_GLOBAL_LOGO_SETTINGS_KEY = STORAGE_GLOBAL_OVERLAY_SETTINGS_KEY;
export {
  LOGO_SETTING_KEYS,
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  normalizeGlobalLogoSettings,
  buildLogoExportPayload,
};

export function extractLogoSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const key of LOGO_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) {
      out[key] = obj[key];
    }
  }
  return out;
}

export function hasAnyLogoSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return LOGO_SETTING_KEYS.some(
    (key) => Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined
  );
}

export function areLogoSettingsEqual(a, b) {
  const normA = normalizeGlobalLogoSettings(a);
  const normB = normalizeGlobalLogoSettings(b);
  return LOGO_SETTING_KEYS.every((key) => normA[key] === normB[key]);
}

export function hasCustomLogoSettings(obj) {
  if (!hasAnyLogoSettings(obj)) return false;
  const normalized = normalizeGlobalLogoSettings(obj);
  return !areLogoSettingsEqual(normalized, DEFAULT_GLOBAL_LOGO_SETTINGS);
}

export function stripLogoSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  let changed = false;
  const next = { ...obj };
  for (const key of LOGO_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : obj;
}

export function loadGlobalLogoSettingsRecord() {
  const rec = loadGlobalOverlaySettingsRecord();
  return {
    initialized: rec.initialized,
    settings: normalizeGlobalLogoSettings(rec.settings),
    updatedAt: rec.updatedAt,
  };
}

export function hasStoredGlobalLogoSettings() {
  return loadGlobalOverlaySettingsRecord().initialized;
}

export function loadGlobalLogoSettings() {
  return normalizeGlobalLogoSettings(loadGlobalOverlaySettingsRecord().settings);
}

export async function syncGlobalLogoSettingsToServer(settings, updatedAt = Date.now()) {
  const current = loadGlobalOverlaySettingsRecord().settings;
  const merged = normalizeGlobalOverlaySettings(
    { ...current, ...normalizeGlobalLogoSettings(settings) },
    current
  );
  return syncGlobalOverlaySettingsToServer(merged, updatedAt);
}

export async function fetchGlobalLogoSettingsFromServer() {
  const server = await fetchGlobalOverlaySettingsFromServer();
  if (!server) return null;
  if (server.initialized && server.settings) {
    return {
      initialized: true,
      settings: normalizeGlobalLogoSettings(server.settings),
      updatedAt: server.updatedAt,
    };
  }
  if (server.legacyLogoSettings) {
    return {
      initialized: true,
      settings: normalizeGlobalLogoSettings(server.legacyLogoSettings),
      updatedAt: server.updatedAt,
    };
  }
  return {
    initialized: false,
    settings: null,
    updatedAt: 0,
  };
}

export function saveGlobalLogoSettings(
  settings,
  { syncServer = true, updatedAt = Date.now() } = {}
) {
  const current = loadGlobalOverlaySettingsRecord().settings;
  const logoSlice = normalizeGlobalLogoSettings(settings);
  const merged = normalizeGlobalOverlaySettings({ ...current, ...logoSlice }, current);
  saveGlobalOverlaySettings(merged, { syncServer, updatedAt });
  return logoSlice;
}

export function resolveInitialLogoSeed({
  activeEpisodeVoiceSettings = null,
  legacyVoiceSettings = null,
} = {}) {
  const seeded = resolveInitialOverlaySeed({
    activeEpisodeVoiceSettings,
    legacyVoiceSettings,
  });
  return normalizeGlobalLogoSettings(seeded);
}

export function migrateGlobalLogoSettingsIfNeeded({
  activeEpisodeVoiceSettings = null,
  legacyVoiceSettings = null,
  syncServer = true,
} = {}) {
  const migrated = migrateGlobalOverlaySettingsIfNeeded({
    activeEpisodeVoiceSettings,
    legacyVoiceSettings,
    syncServer,
  });
  return normalizeGlobalLogoSettings(migrated);
}
