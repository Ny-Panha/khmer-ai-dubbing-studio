const {
  LOGO_SETTING_KEYS,
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  getDefaultOverlayStoragePath,
  normalizeGlobalLogoSettings,
  readGlobalOverlaySettings,
  writeGlobalOverlaySettings,
  formatGlobalLogoSettingsForExport,
  getEffectiveGlobalLogoSettingsForExport,
} = require("./globalOverlaySettingsService");

function getDefaultStoragePath() {
  return getDefaultOverlayStoragePath();
}

function stripLogoSettingsFromObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
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

function readGlobalLogoSettings(storagePath = getDefaultStoragePath()) {
  const state = readGlobalOverlaySettings(storagePath);
  if (state.initialized && state.overlaySettings) {
    return {
      initialized: true,
      logoSettings: normalizeGlobalLogoSettings(state.overlaySettings),
      updatedAt: state.updatedAt,
    };
  }
  if (state.legacyLogoSettings) {
    return {
      initialized: true,
      logoSettings: normalizeGlobalLogoSettings(state.legacyLogoSettings),
      updatedAt: state.updatedAt,
    };
  }
  return {
    initialized: false,
    logoSettings: null,
    updatedAt: 0,
  };
}

function writeGlobalLogoSettings(input, options = {}) {
  const storagePath = options.storagePath || getDefaultStoragePath();
  const logoSlice = normalizeGlobalLogoSettings(input);
  const state = writeGlobalOverlaySettings(logoSlice, {
    storagePath,
    updatedAt: options.updatedAt,
  });
  return {
    initialized: state.initialized,
    logoSettings: state.overlaySettings
      ? normalizeGlobalLogoSettings(state.overlaySettings)
      : logoSlice,
    updatedAt: state.updatedAt,
  };
}

module.exports = {
  LOGO_SETTING_KEYS,
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  getDefaultStoragePath,
  normalizeGlobalLogoSettings,
  stripLogoSettingsFromObject,
  readGlobalLogoSettings,
  writeGlobalLogoSettings,
  formatGlobalLogoSettingsForExport,
  getEffectiveGlobalLogoSettingsForExport,
};
