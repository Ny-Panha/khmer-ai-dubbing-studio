export const STORAGE_GLOBAL_LOGO_SETTINGS_KEY = 'KHMER_AI_GLOBAL_LOGO_SETTINGS_V1';

export const LOGO_SETTING_KEYS = Object.freeze([
  'enableLogo',
  'logoImage',
  'logoPosition',
  'logoSize',
  'logoOpacity',
  'logoShape',
  'logoMargin',
  'logoXPercent',
  'logoYPercent',
]);

const VALID_LOGO_POSITIONS = new Set([
  'both',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'center',
  'custom',
]);

const VALID_LOGO_SHAPES = new Set(['circle', 'square']);

export const DEFAULT_GLOBAL_LOGO_SETTINGS = Object.freeze({
  enableLogo: true,
  logoImage: '/assets/dragon_town_logo.jpg',
  logoPosition: 'both',
  logoSize: 72,
  logoOpacity: 0.9,
  logoShape: 'circle',
  logoMargin: 20,
  logoXPercent: null,
  logoYPercent: null,
});

function clampNumber(val, min, max, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeGlobalLogoSettings(input, fallback = DEFAULT_GLOBAL_LOGO_SETTINGS) {
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_GLOBAL_LOGO_SETTINGS;
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const enableLogo =
    src.enableLogo !== undefined
      ? Boolean(src.enableLogo)
      : src.enabled !== undefined
        ? Boolean(src.enabled)
        : Boolean(base.enableLogo);

  const rawImage = src.logoImage !== undefined ? src.logoImage : src.image;
  const logoImage =
    rawImage === null
      ? null
      : typeof rawImage === 'string' && rawImage.trim()
        ? rawImage.trim()
        : (base.logoImage ?? DEFAULT_GLOBAL_LOGO_SETTINGS.logoImage);

  const rawPos = src.logoPosition !== undefined ? src.logoPosition : src.position;
  const logoPosition =
    typeof rawPos === 'string' && VALID_LOGO_POSITIONS.has(rawPos)
      ? rawPos
      : VALID_LOGO_POSITIONS.has(base.logoPosition)
        ? base.logoPosition
        : DEFAULT_GLOBAL_LOGO_SETTINGS.logoPosition;

  const logoSize = Math.round(
    clampNumber(
      src.logoSize !== undefined ? src.logoSize : src.size,
      24,
      200,
      Number(base.logoSize) || DEFAULT_GLOBAL_LOGO_SETTINGS.logoSize
    )
  );

  const logoOpacity =
    Math.round(
      clampNumber(
        src.logoOpacity !== undefined ? src.logoOpacity : src.opacity,
        0.1,
        1.0,
        Number(base.logoOpacity) || DEFAULT_GLOBAL_LOGO_SETTINGS.logoOpacity
      ) * 100
    ) / 100;

  const rawShape = src.logoShape !== undefined ? src.logoShape : src.shape;
  const logoShape =
    typeof rawShape === 'string' && VALID_LOGO_SHAPES.has(rawShape)
      ? rawShape
      : VALID_LOGO_SHAPES.has(base.logoShape)
        ? base.logoShape
        : DEFAULT_GLOBAL_LOGO_SETTINGS.logoShape;

  const logoMargin = Math.round(
    clampNumber(
      src.logoMargin !== undefined ? src.logoMargin : src.margin,
      5,
      80,
      Number(base.logoMargin) || DEFAULT_GLOBAL_LOGO_SETTINGS.logoMargin
    )
  );

  let logoXPercent = null;
  let logoYPercent = null;
  if (logoPosition === 'custom') {
    const rawX = src.logoXPercent !== undefined ? src.logoXPercent : src.xPercent;
    const rawY = src.logoYPercent !== undefined ? src.logoYPercent : src.yPercent;
    const fallbackX = typeof base.logoXPercent === 'number' && Number.isFinite(base.logoXPercent) ? base.logoXPercent : 50;
    const fallbackY = typeof base.logoYPercent === 'number' && Number.isFinite(base.logoYPercent) ? base.logoYPercent : 50;
    logoXPercent = Math.round(clampNumber(rawX, 0, 100, fallbackX) * 10) / 10;
    logoYPercent = Math.round(clampNumber(rawY, 0, 100, fallbackY) * 10) / 10;
  } else if (logoPosition === 'center') {
    logoXPercent = 50;
    logoYPercent = 50;
  }

  return {
    enableLogo,
    logoImage,
    logoPosition,
    logoSize,
    logoOpacity,
    logoShape,
    logoMargin,
    logoXPercent,
    logoYPercent,
  };
}

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
  try {
    if (typeof localStorage === 'undefined') {
      return {
        initialized: false,
        settings: { ...DEFAULT_GLOBAL_LOGO_SETTINGS },
        updatedAt: 0,
      };
    }
    const raw = localStorage.getItem(STORAGE_GLOBAL_LOGO_SETTINGS_KEY);
    if (!raw) {
      return {
        initialized: false,
        settings: { ...DEFAULT_GLOBAL_LOGO_SETTINGS },
        updatedAt: 0,
      };
    }
    const parsed = JSON.parse(raw);
    const payload = parsed?.settings || parsed?.logoSettings || parsed;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        initialized: false,
        settings: { ...DEFAULT_GLOBAL_LOGO_SETTINGS },
        updatedAt: 0,
      };
    }
    return {
      initialized: true,
      settings: normalizeGlobalLogoSettings(payload),
      updatedAt: Number(parsed?.updatedAt) || 0,
    };
  } catch {
    return {
      initialized: false,
      settings: { ...DEFAULT_GLOBAL_LOGO_SETTINGS },
      updatedAt: 0,
    };
  }
}

export function hasStoredGlobalLogoSettings() {
  return loadGlobalLogoSettingsRecord().initialized;
}

export function loadGlobalLogoSettings() {
  return loadGlobalLogoSettingsRecord().settings;
}

let lastSavedUpdatedAt = 0;
let pendingServerSyncPayload = null;
let isServerSyncInFlight = false;

async function flushPendingServerSync() {
  if (isServerSyncInFlight || !pendingServerSyncPayload) return null;
  if (typeof fetch !== 'function') {
    pendingServerSyncPayload = null;
    return null;
  }
  isServerSyncInFlight = true;
  let lastResult = null;
  try {
    while (pendingServerSyncPayload) {
      const next = pendingServerSyncPayload;
      pendingServerSyncPayload = null;
      try {
        const res = await fetch('/api/logo-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            logoSettings: next.settings,
            updatedAt: next.updatedAt,
          }),
        });
        if (res.ok) {
          lastResult = await res.json();
        }
      } catch {
        // Offline or transient error — localStorage remains authoritative
      }
    }
  } finally {
    isServerSyncInFlight = false;
  }
  return lastResult;
}

export async function syncGlobalLogoSettingsToServer(settings, updatedAt = Date.now()) {
  if (typeof fetch !== 'function') return null;
  const normalized = normalizeGlobalLogoSettings(settings);
  const ts = Math.max(Number(updatedAt) || Date.now(), lastSavedUpdatedAt);
  lastSavedUpdatedAt = ts;
  pendingServerSyncPayload = { settings: normalized, updatedAt: ts };
  return flushPendingServerSync();
}

export async function fetchGlobalLogoSettingsFromServer() {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/logo-settings');
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    return {
      initialized: Boolean(data.initialized && data.logoSettings),
      settings: data.logoSettings ? normalizeGlobalLogoSettings(data.logoSettings) : null,
      updatedAt: Number(data.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function saveGlobalLogoSettings(
  settings,
  { syncServer = true, updatedAt = Date.now() } = {}
) {
  const normalized = normalizeGlobalLogoSettings(settings);
  const rawTs = Number(updatedAt) || Date.now();
  const ts = syncServer ? Math.max(rawTs, lastSavedUpdatedAt + 1) : rawTs;
  if (ts > lastSavedUpdatedAt) {
    lastSavedUpdatedAt = ts;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        STORAGE_GLOBAL_LOGO_SETTINGS_KEY,
        JSON.stringify({
          version: 1,
          updatedAt: ts,
          settings: normalized,
        })
      );
    }
  } catch {}

  if (syncServer) {
    syncGlobalLogoSettingsToServer(normalized, ts).catch(() => {});
  }
  return normalized;
}

/**
 * Determine initial migration seed from current active episode / legacy global voiceSettings / defaults.
 */
export function resolveInitialLogoSeed({
  activeEpisodeVoiceSettings = null,
  legacyVoiceSettings = null,
} = {}) {
  if (hasCustomLogoSettings(activeEpisodeVoiceSettings)) {
    return normalizeGlobalLogoSettings(activeEpisodeVoiceSettings);
  }
  if (hasCustomLogoSettings(legacyVoiceSettings)) {
    return normalizeGlobalLogoSettings(legacyVoiceSettings);
  }
  if (hasAnyLogoSettings(activeEpisodeVoiceSettings)) {
    return normalizeGlobalLogoSettings(activeEpisodeVoiceSettings);
  }
  if (hasAnyLogoSettings(legacyVoiceSettings)) {
    return normalizeGlobalLogoSettings(legacyVoiceSettings);
  }
  return { ...DEFAULT_GLOBAL_LOGO_SETTINGS };
}

/**
 * One-time migration: seeds the dedicated global logo store if it does not exist yet.
 * Once stored, per-episode logo values are ignored forever.
 */
export function migrateGlobalLogoSettingsIfNeeded({
  activeEpisodeVoiceSettings = null,
  legacyVoiceSettings = null,
  syncServer = true,
} = {}) {
  const existing = loadGlobalLogoSettingsRecord();
  if (existing.initialized) {
    return existing.settings;
  }
  const seeded = resolveInitialLogoSeed({
    activeEpisodeVoiceSettings,
    legacyVoiceSettings,
  });
  return saveGlobalLogoSettings(seeded, { syncServer });
}

export function buildLogoExportPayload(logoSettings = null) {
  const normalized = normalizeGlobalLogoSettings(logoSettings || loadGlobalLogoSettings());
  const isCustomOrCenter = normalized.logoPosition === 'custom' || normalized.logoPosition === 'center';
  return {
    enabled: Boolean(normalized.enableLogo),
    image: normalized.logoImage,
    position: normalized.logoPosition,
    size: normalized.logoSize,
    opacity: normalized.logoOpacity,
    shape: normalized.logoShape,
    margin: normalized.logoMargin,
    ...(isCustomOrCenter && typeof normalized.logoXPercent === 'number' && typeof normalized.logoYPercent === 'number'
      ? {
          logoXPercent: normalized.logoXPercent,
          logoYPercent: normalized.logoYPercent,
        }
      : {}),
  };
}
