export const STORAGE_GLOBAL_OVERLAY_SETTINGS_KEY = 'KHMER_AI_GLOBAL_OVERLAY_SETTINGS_V1';
export const LEGACY_STORAGE_GLOBAL_LOGO_SETTINGS_KEY = 'KHMER_AI_GLOBAL_LOGO_SETTINGS_V1';

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

export const CORNER_MASK_SETTING_KEYS = Object.freeze([
  'enableCornerMask',
  'cornerMaskText',
  'cornerMaskStyle',
  'cornerMaskPosition',
  'cornerMaskWidth',
  'cornerMaskHeight',
  'cornerMaskOpacity',
]);

export const SPONSOR_SETTING_KEYS = Object.freeze([
  'enableSponsor',
  'sponsorVideoUrl',
  'sponsorVideoPath',
  'sponsorChromaKey',
  'sponsorChromaSimilarity',
  'sponsorPosition',
  'sponsorXPercent',
  'sponsorYPercent',
  'sponsorTimingMode',
  'sponsorIntervalSec',
  'sponsorDurationSec',
  'sponsorStartSec',
  'sponsorEndSec',
  'sponsorScale',
  'sponsorOpacity',
  'sponsorMargin',
  'sponsorMuteAudio',
  'sponsorVolume',
]);

export const ANTI_THEFT_SETTING_KEYS = Object.freeze([
  'enableAntiTheft',
  'marqueeText',
  'marqueeSpeed',
  'marqueePosition',
  'marqueeTextColor',
  'enableWatermark',
  'watermarkText',
  'watermarkPosition',
  'watermarkColor',
  'antiTheftSize',
  'antiTheftBottomPercent',
]);

export const GLOBAL_OVERLAY_SETTING_KEYS = Object.freeze([
  ...LOGO_SETTING_KEYS,
  ...CORNER_MASK_SETTING_KEYS,
  ...SPONSOR_SETTING_KEYS,
  ...ANTI_THEFT_SETTING_KEYS,
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
const VALID_CORNER_MASK_STYLES = new Set(['badge', 'blur', 'solid']);
const VALID_CORNER_MASK_POSITIONS = new Set([
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
]);
const VALID_SPONSOR_POSITIONS = new Set([
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'top-left',
  'top-right',
  'custom',
]);
const VALID_SPONSOR_TIMING_MODES = new Set(['loop', 'interval', 'custom']);
const VALID_MARQUEE_POSITIONS = new Set(['bottom', 'top']);
const VALID_WATERMARK_POSITIONS = new Set([
  'above-ticker',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);
const VALID_ANTI_THEFT_SIZES = new Set(['small', 'medium', 'large']);

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

export const DEFAULT_GLOBAL_CORNER_MASK_SETTINGS = Object.freeze({
  enableCornerMask: false,
  cornerMaskText: '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»',
  cornerMaskStyle: 'badge',
  cornerMaskPosition: 'top-right',
  cornerMaskWidth: 220,
  cornerMaskHeight: 54,
  cornerMaskOpacity: 0.95,
});

export const DEFAULT_GLOBAL_SPONSOR_SETTINGS = Object.freeze({
  enableSponsor: false,
  sponsorVideoUrl: null,
  sponsorVideoPath: null,
  sponsorChromaKey: true,
  sponsorChromaSimilarity: 0.28,
  sponsorPosition: 'bottom-left',
  sponsorXPercent: null,
  sponsorYPercent: null,
  sponsorTimingMode: 'loop',
  sponsorIntervalSec: 60,
  sponsorDurationSec: 10,
  sponsorStartSec: 0,
  sponsorEndSec: 15,
  sponsorScale: 25,
  sponsorOpacity: 1.0,
  sponsorMargin: 16,
  sponsorMuteAudio: true,
  sponsorVolume: 0.5,
});

export const DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS = Object.freeze({
  enableAntiTheft: false,
  marqueeText: '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»',
  marqueeSpeed: 'normal',
  marqueePosition: 'bottom',
  marqueeTextColor: '#FFE600',
  enableWatermark: true,
  watermarkText: 'រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama',
  watermarkPosition: 'above-ticker',
  watermarkColor: '#38BDF8',
  antiTheftSize: 'small',
  antiTheftBottomPercent: null,
});

export const DEFAULT_GLOBAL_OVERLAY_SETTINGS = Object.freeze({
  ...DEFAULT_GLOBAL_LOGO_SETTINGS,
  ...DEFAULT_GLOBAL_CORNER_MASK_SETTINGS,
  ...DEFAULT_GLOBAL_SPONSOR_SETTINGS,
  ...DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS,
});

function clampNumber(val, min, max, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function extractKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) {
      out[key] = obj[key];
    }
  }
  return out;
}

function hasAnyKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return keys.some(
    (key) => Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined
  );
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
    const fallbackX =
      typeof base.logoXPercent === 'number' && Number.isFinite(base.logoXPercent)
        ? base.logoXPercent
        : 50;
    const fallbackY =
      typeof base.logoYPercent === 'number' && Number.isFinite(base.logoYPercent)
        ? base.logoYPercent
        : 50;
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

export function normalizeGlobalOverlaySettings(input, fallback = DEFAULT_GLOBAL_OVERLAY_SETTINGS) {
  const base =
    fallback && typeof fallback === 'object'
      ? { ...DEFAULT_GLOBAL_OVERLAY_SETTINGS, ...fallback }
      : DEFAULT_GLOBAL_OVERLAY_SETTINGS;
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  // 1. Logo family
  const logoNormalized = normalizeGlobalLogoSettings(extractKeys(src, LOGO_SETTING_KEYS), base);

  // 2. Corner Mask family
  const enableCornerMask =
    src.enableCornerMask !== undefined
      ? Boolean(src.enableCornerMask)
      : Boolean(base.enableCornerMask);
  const cornerMaskText =
    src.cornerMaskText !== undefined && src.cornerMaskText !== null
      ? String(src.cornerMaskText)
      : String(base.cornerMaskText ?? DEFAULT_GLOBAL_CORNER_MASK_SETTINGS.cornerMaskText);
  const cornerMaskStyle =
    typeof src.cornerMaskStyle === 'string' && VALID_CORNER_MASK_STYLES.has(src.cornerMaskStyle)
      ? src.cornerMaskStyle
      : VALID_CORNER_MASK_STYLES.has(base.cornerMaskStyle)
        ? base.cornerMaskStyle
        : DEFAULT_GLOBAL_CORNER_MASK_SETTINGS.cornerMaskStyle;
  const cornerMaskPosition =
    typeof src.cornerMaskPosition === 'string' &&
    VALID_CORNER_MASK_POSITIONS.has(src.cornerMaskPosition)
      ? src.cornerMaskPosition
      : VALID_CORNER_MASK_POSITIONS.has(base.cornerMaskPosition)
        ? base.cornerMaskPosition
        : DEFAULT_GLOBAL_CORNER_MASK_SETTINGS.cornerMaskPosition;
  const cornerMaskWidth = Math.round(
    clampNumber(
      src.cornerMaskWidth,
      40,
      600,
      Number(base.cornerMaskWidth) || DEFAULT_GLOBAL_CORNER_MASK_SETTINGS.cornerMaskWidth
    )
  );
  const cornerMaskHeight = Math.round(
    clampNumber(
      src.cornerMaskHeight,
      16,
      240,
      Number(base.cornerMaskHeight) || DEFAULT_GLOBAL_CORNER_MASK_SETTINGS.cornerMaskHeight
    )
  );
  const cornerMaskOpacity =
    Math.round(
      clampNumber(
        src.cornerMaskOpacity,
        0.1,
        1.0,
        Number(base.cornerMaskOpacity) || DEFAULT_GLOBAL_CORNER_MASK_SETTINGS.cornerMaskOpacity
      ) * 100
    ) / 100;

  // 3. Sponsor family
  const enableSponsor =
    src.enableSponsor !== undefined ? Boolean(src.enableSponsor) : Boolean(base.enableSponsor);
  const sponsorVideoUrl =
    src.sponsorVideoUrl === null
      ? null
      : typeof src.sponsorVideoUrl === 'string' && src.sponsorVideoUrl.trim()
        ? src.sponsorVideoUrl.trim()
        : (base.sponsorVideoUrl ?? null);
  const sponsorVideoPath =
    src.sponsorVideoPath === null
      ? null
      : typeof src.sponsorVideoPath === 'string' && src.sponsorVideoPath.trim()
        ? src.sponsorVideoPath.trim()
        : (base.sponsorVideoPath ?? null);
  const sponsorChromaKey =
    src.sponsorChromaKey !== undefined
      ? Boolean(src.sponsorChromaKey)
      : base.sponsorChromaKey !== false;
  const sponsorChromaSimilarity =
    Math.round(
      clampNumber(
        src.sponsorChromaSimilarity,
        0.05,
        0.65,
        Number(base.sponsorChromaSimilarity) || DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorChromaSimilarity
      ) * 100
    ) / 100;
  const sponsorPosition =
    typeof src.sponsorPosition === 'string' && VALID_SPONSOR_POSITIONS.has(src.sponsorPosition)
      ? src.sponsorPosition
      : VALID_SPONSOR_POSITIONS.has(base.sponsorPosition)
        ? base.sponsorPosition
        : DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorPosition;

  let sponsorXPercent = null;
  let sponsorYPercent = null;
  if (sponsorPosition === 'custom') {
    const fallbackSX =
      typeof base.sponsorXPercent === 'number' && Number.isFinite(base.sponsorXPercent)
        ? base.sponsorXPercent
        : 50;
    const fallbackSY =
      typeof base.sponsorYPercent === 'number' && Number.isFinite(base.sponsorYPercent)
        ? base.sponsorYPercent
        : 50;
    sponsorXPercent = Math.round(clampNumber(src.sponsorXPercent, 0, 100, fallbackSX) * 10) / 10;
    sponsorYPercent = Math.round(clampNumber(src.sponsorYPercent, 0, 100, fallbackSY) * 10) / 10;
  }

  const sponsorTimingMode =
    typeof src.sponsorTimingMode === 'string' &&
    VALID_SPONSOR_TIMING_MODES.has(src.sponsorTimingMode)
      ? src.sponsorTimingMode
      : VALID_SPONSOR_TIMING_MODES.has(base.sponsorTimingMode)
        ? base.sponsorTimingMode
        : DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorTimingMode;
  const sponsorIntervalSec = Math.round(
    clampNumber(
      src.sponsorIntervalSec,
      5,
      600,
      Number(base.sponsorIntervalSec) || DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorIntervalSec
    )
  );
  const sponsorDurationSec = Math.round(
    clampNumber(
      src.sponsorDurationSec,
      1,
      300,
      Number(base.sponsorDurationSec) || DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorDurationSec
    )
  );
  const sponsorStartSec = Math.round(
    clampNumber(
      src.sponsorStartSec,
      0,
      36000,
      Number.isFinite(Number(base.sponsorStartSec)) ? Number(base.sponsorStartSec) : 0
    )
  );
  const sponsorEndSec = Math.round(
    clampNumber(
      src.sponsorEndSec,
      0,
      36000,
      Number(base.sponsorEndSec) || DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorEndSec
    )
  );
  const sponsorScale = Math.round(
    clampNumber(
      src.sponsorScale,
      10,
      60,
      Number(base.sponsorScale) || DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorScale
    )
  );
  const sponsorOpacity =
    Math.round(
      clampNumber(
        src.sponsorOpacity,
        0.1,
        1.0,
        Number(base.sponsorOpacity) || DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorOpacity
      ) * 100
    ) / 100;
  const sponsorMargin = Math.round(
    clampNumber(
      src.sponsorMargin,
      0,
      100,
      Number.isFinite(Number(base.sponsorMargin))
        ? Number(base.sponsorMargin)
        : DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorMargin
    )
  );
  const sponsorMuteAudio =
    src.sponsorMuteAudio !== undefined
      ? Boolean(src.sponsorMuteAudio)
      : base.sponsorMuteAudio !== false;
  const sponsorVolume =
    Math.round(
      clampNumber(
        src.sponsorVolume,
        0,
        2.0,
        Number.isFinite(Number(base.sponsorVolume))
          ? Number(base.sponsorVolume)
          : DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorVolume
      ) * 100
    ) / 100;

  // 4. Anti-Theft / Marquee / Watermark family
  const enableAntiTheft =
    src.enableAntiTheft !== undefined
      ? Boolean(src.enableAntiTheft)
      : Boolean(base.enableAntiTheft);
  const marqueeText =
    src.marqueeText !== undefined && src.marqueeText !== null
      ? String(src.marqueeText)
      : String(base.marqueeText ?? DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.marqueeText);
  const marqueeSpeed =
    src.marqueeSpeed !== undefined && src.marqueeSpeed !== null && String(src.marqueeSpeed).trim()
      ? src.marqueeSpeed
      : (base.marqueeSpeed ?? DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.marqueeSpeed);
  const marqueePosition =
    typeof src.marqueePosition === 'string' && VALID_MARQUEE_POSITIONS.has(src.marqueePosition)
      ? src.marqueePosition
      : VALID_MARQUEE_POSITIONS.has(base.marqueePosition)
        ? base.marqueePosition
        : DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.marqueePosition;
  const marqueeTextColor =
    typeof src.marqueeTextColor === 'string' && src.marqueeTextColor.trim()
      ? src.marqueeTextColor.trim()
      : (base.marqueeTextColor || DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.marqueeTextColor);
  const enableWatermark =
    src.enableWatermark !== undefined
      ? Boolean(src.enableWatermark)
      : base.enableWatermark !== false;
  const watermarkText =
    src.watermarkText !== undefined && src.watermarkText !== null
      ? String(src.watermarkText)
      : String(base.watermarkText ?? DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.watermarkText);
  const watermarkPosition =
    typeof src.watermarkPosition === 'string' &&
    VALID_WATERMARK_POSITIONS.has(src.watermarkPosition)
      ? src.watermarkPosition
      : VALID_WATERMARK_POSITIONS.has(base.watermarkPosition)
        ? base.watermarkPosition
        : DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.watermarkPosition;
  const watermarkColor =
    typeof src.watermarkColor === 'string' && src.watermarkColor.trim()
      ? src.watermarkColor.trim()
      : (base.watermarkColor || DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.watermarkColor);
  const antiTheftSize =
    typeof src.antiTheftSize === 'string' && VALID_ANTI_THEFT_SIZES.has(src.antiTheftSize)
      ? src.antiTheftSize
      : VALID_ANTI_THEFT_SIZES.has(base.antiTheftSize)
        ? base.antiTheftSize
        : DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.antiTheftSize;

  let antiTheftBottomPercent = null;
  const rawBottomPct =
    src.antiTheftBottomPercent !== undefined
      ? src.antiTheftBottomPercent
      : base.antiTheftBottomPercent;
  if (rawBottomPct !== null && rawBottomPct !== undefined && rawBottomPct !== '') {
    const parsedPct = Number(rawBottomPct);
    if (Number.isFinite(parsedPct)) {
      antiTheftBottomPercent = Math.round(Math.max(0, Math.min(80, parsedPct)) * 10) / 10;
    }
  }

  return {
    ...logoNormalized,
    enableCornerMask,
    cornerMaskText,
    cornerMaskStyle,
    cornerMaskPosition,
    cornerMaskWidth,
    cornerMaskHeight,
    cornerMaskOpacity,
    enableSponsor,
    sponsorVideoUrl,
    sponsorVideoPath,
    sponsorChromaKey,
    sponsorChromaSimilarity,
    sponsorPosition,
    sponsorXPercent,
    sponsorYPercent,
    sponsorTimingMode,
    sponsorIntervalSec,
    sponsorDurationSec,
    sponsorStartSec,
    sponsorEndSec,
    sponsorScale,
    sponsorOpacity,
    sponsorMargin,
    sponsorMuteAudio,
    sponsorVolume,
    enableAntiTheft,
    marqueeText,
    marqueeSpeed,
    marqueePosition,
    marqueeTextColor,
    enableWatermark,
    watermarkText,
    watermarkPosition,
    watermarkColor,
    antiTheftSize,
    antiTheftBottomPercent,
  };
}

export function extractGlobalOverlaySettings(obj) {
  return extractKeys(obj, GLOBAL_OVERLAY_SETTING_KEYS);
}

export function hasAnyGlobalOverlaySettings(obj) {
  return hasAnyKeys(obj, GLOBAL_OVERLAY_SETTING_KEYS);
}

export function areGlobalOverlaySettingsEqual(a, b) {
  const normA = normalizeGlobalOverlaySettings(a);
  const normB = normalizeGlobalOverlaySettings(b);
  return GLOBAL_OVERLAY_SETTING_KEYS.every((key) => normA[key] === normB[key]);
}

export function hasCustomGlobalOverlaySettings(obj) {
  if (!hasAnyGlobalOverlaySettings(obj)) return false;
  const normalized = normalizeGlobalOverlaySettings(obj);
  return !areGlobalOverlaySettingsEqual(normalized, DEFAULT_GLOBAL_OVERLAY_SETTINGS);
}

export function stripGlobalOverlaySettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  let changed = false;
  const next = { ...obj };
  for (const key of GLOBAL_OVERLAY_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : obj;
}

export function readLegacyGlobalLogoRecord() {
  try {
    if (typeof localStorage === 'undefined') {
      return { initialized: false, settings: null, updatedAt: 0 };
    }
    const raw = localStorage.getItem(LEGACY_STORAGE_GLOBAL_LOGO_SETTINGS_KEY);
    if (!raw) return { initialized: false, settings: null, updatedAt: 0 };
    const parsed = JSON.parse(raw);
    const payload = parsed?.settings || parsed?.logoSettings || parsed;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { initialized: false, settings: null, updatedAt: 0 };
    }
    return {
      initialized: true,
      settings: normalizeGlobalLogoSettings(payload),
      updatedAt: Number(parsed?.updatedAt) || 0,
    };
  } catch {
    return { initialized: false, settings: null, updatedAt: 0 };
  }
}

export function loadGlobalOverlaySettingsRecord() {
  try {
    if (typeof localStorage === 'undefined') {
      return {
        initialized: false,
        settings: { ...DEFAULT_GLOBAL_OVERLAY_SETTINGS },
        updatedAt: 0,
      };
    }
    const raw = localStorage.getItem(STORAGE_GLOBAL_OVERLAY_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const payload = parsed?.settings || parsed?.overlaySettings || parsed;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return {
          initialized: true,
          settings: normalizeGlobalOverlaySettings(payload),
          updatedAt: Number(parsed?.updatedAt) || 0,
        };
      }
    }
    // Not initialized yet in V1 overlay store; carry legacy logo values as default preview until migration completes
    const legacyLogo = readLegacyGlobalLogoRecord();
    if (legacyLogo.initialized && legacyLogo.settings) {
      return {
        initialized: false,
        settings: normalizeGlobalOverlaySettings(legacyLogo.settings),
        legacyLogoSettings: legacyLogo.settings,
        updatedAt: 0,
      };
    }
  } catch {}
  return {
    initialized: false,
    settings: { ...DEFAULT_GLOBAL_OVERLAY_SETTINGS },
    updatedAt: 0,
  };
}

export function hasStoredGlobalOverlaySettings() {
  return loadGlobalOverlaySettingsRecord().initialized;
}

export function loadGlobalOverlaySettings() {
  return loadGlobalOverlaySettingsRecord().settings;
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
        const res = await fetch('/api/overlay-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            overlaySettings: next.settings,
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

export async function syncGlobalOverlaySettingsToServer(settings, updatedAt = Date.now()) {
  if (typeof fetch !== 'function') return null;
  const normalized = normalizeGlobalOverlaySettings(settings);
  const ts = Math.max(Number(updatedAt) || Date.now(), lastSavedUpdatedAt);
  lastSavedUpdatedAt = ts;
  pendingServerSyncPayload = { settings: normalized, updatedAt: ts };
  return flushPendingServerSync();
}

export async function fetchGlobalOverlaySettingsFromServer() {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/overlay-settings');
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    return {
      initialized: Boolean(data.initialized && data.overlaySettings),
      settings: data.overlaySettings ? normalizeGlobalOverlaySettings(data.overlaySettings) : null,
      legacyLogoSettings: data.legacyLogoSettings
        ? normalizeGlobalLogoSettings(data.legacyLogoSettings)
        : null,
      updatedAt: Number(data.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function saveGlobalOverlaySettings(
  settings,
  { syncServer = true, updatedAt = Date.now() } = {}
) {
  const normalized = normalizeGlobalOverlaySettings(settings);
  const rawTs = Number(updatedAt) || Date.now();
  const ts = syncServer ? Math.max(rawTs, lastSavedUpdatedAt + 1) : rawTs;
  if (ts > lastSavedUpdatedAt) {
    lastSavedUpdatedAt = ts;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        STORAGE_GLOBAL_OVERLAY_SETTINGS_KEY,
        JSON.stringify({
          version: 2,
          updatedAt: ts,
          settings: normalized,
        })
      );
    }
  } catch {}

  if (syncServer) {
    syncGlobalOverlaySettingsToServer(normalized, ts).catch(() => {});
  }
  return normalized;
}

function resolveFamilySeed(keys, defaults, candidates) {
  // Prefer first candidate that actually customized this family from defaults
  for (const candidate of candidates) {
    if (!hasAnyKeys(candidate, keys)) continue;
    const merged = normalizeGlobalOverlaySettings(extractKeys(candidate, keys), DEFAULT_GLOBAL_OVERLAY_SETTINGS);
    const differs = keys.some((k) => merged[k] !== defaults[k]);
    if (differs) {
      return extractKeys(merged, keys);
    }
  }
  // Otherwise prefer first candidate that has any keys from this family
  for (const candidate of candidates) {
    if (!hasAnyKeys(candidate, keys)) continue;
    const merged = normalizeGlobalOverlaySettings(extractKeys(candidate, keys), DEFAULT_GLOBAL_OVERLAY_SETTINGS);
    return extractKeys(merged, keys);
  }
  return { ...defaults };
}

/**
 * Determine initial migration seed across all 4 branding/overlay families:
 * - logo* preserves any previously migrated global logo settings first, then active episode, then legacy voiceSettings, then defaults.
 * - cornerMask*, sponsor*, antiTheft* seed from active episode first, then legacy voiceSettings, then defaults.
 */
export function resolveInitialOverlaySeed({
  activeEpisodeVoiceSettings = null,
  legacyVoiceSettings = null,
  legacyGlobalLogoSettings = null,
} = {}) {
  const logoCandidates = [
    legacyGlobalLogoSettings,
    activeEpisodeVoiceSettings,
    legacyVoiceSettings,
  ].filter(Boolean);
  const otherCandidates = [activeEpisodeVoiceSettings, legacyVoiceSettings].filter(Boolean);

  const logoSeed = resolveFamilySeed(LOGO_SETTING_KEYS, DEFAULT_GLOBAL_LOGO_SETTINGS, logoCandidates);
  const maskSeed = resolveFamilySeed(
    CORNER_MASK_SETTING_KEYS,
    DEFAULT_GLOBAL_CORNER_MASK_SETTINGS,
    otherCandidates
  );
  const sponsorSeed = resolveFamilySeed(
    SPONSOR_SETTING_KEYS,
    DEFAULT_GLOBAL_SPONSOR_SETTINGS,
    otherCandidates
  );
  const antiTheftSeed = resolveFamilySeed(
    ANTI_THEFT_SETTING_KEYS,
    DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS,
    otherCandidates
  );

  return normalizeGlobalOverlaySettings({
    ...logoSeed,
    ...maskSeed,
    ...sponsorSeed,
    ...antiTheftSeed,
  });
}

/**
 * One-time migration: seeds the unified global overlay store if not yet initialized.
 * Once stored, per-episode values in existing series.json files are ignored forever.
 */
export function migrateGlobalOverlaySettingsIfNeeded({
  activeEpisodeVoiceSettings = null,
  legacyVoiceSettings = null,
  legacyGlobalLogoSettings = null,
  syncServer = true,
} = {}) {
  const existing = loadGlobalOverlaySettingsRecord();
  if (existing.initialized) {
    return existing.settings;
  }
  const resolvedLegacyLogo =
    legacyGlobalLogoSettings || existing.legacyLogoSettings || readLegacyGlobalLogoRecord().settings;
  const seeded = resolveInitialOverlaySeed({
    activeEpisodeVoiceSettings,
    legacyVoiceSettings,
    legacyGlobalLogoSettings: resolvedLegacyLogo,
  });
  return saveGlobalOverlaySettings(seeded, { syncServer });
}

export function buildLogoExportPayload(overlaySettings = null) {
  const normalized = normalizeGlobalLogoSettings(overlaySettings || loadGlobalOverlaySettings());
  const isCustomOrCenter =
    normalized.logoPosition === 'custom' || normalized.logoPosition === 'center';
  return {
    enabled: Boolean(normalized.enableLogo),
    image: normalized.logoImage,
    position: normalized.logoPosition,
    size: normalized.logoSize,
    opacity: normalized.logoOpacity,
    shape: normalized.logoShape,
    margin: normalized.logoMargin,
    ...(isCustomOrCenter &&
    typeof normalized.logoXPercent === 'number' &&
    typeof normalized.logoYPercent === 'number'
      ? {
          logoXPercent: normalized.logoXPercent,
          logoYPercent: normalized.logoYPercent,
        }
      : {}),
  };
}

export function buildCornerMaskExportPayload(overlaySettings = null) {
  const normalized = normalizeGlobalOverlaySettings(overlaySettings || loadGlobalOverlaySettings());
  return {
    enabled: Boolean(normalized.enableCornerMask),
    text: normalized.cornerMaskText,
    style: normalized.cornerMaskStyle,
    position: normalized.cornerMaskPosition,
    width: normalized.cornerMaskWidth,
    height: normalized.cornerMaskHeight,
    opacity: normalized.cornerMaskOpacity,
  };
}

export function buildSponsorExportPayload(overlaySettings = null) {
  const normalized = normalizeGlobalOverlaySettings(overlaySettings || loadGlobalOverlaySettings());
  const isCustom = normalized.sponsorPosition === 'custom';
  const sponsorXPercent =
    isCustom && typeof normalized.sponsorXPercent === 'number' ? normalized.sponsorXPercent : null;
  const sponsorYPercent =
    isCustom && typeof normalized.sponsorYPercent === 'number' ? normalized.sponsorYPercent : null;
  return {
    enabled: Boolean(normalized.enableSponsor),
    enableSponsor: Boolean(normalized.enableSponsor),
    sponsorVideoUrl: normalized.sponsorVideoUrl,
    sponsorVideoPath: normalized.sponsorVideoPath,
    videoUrl: normalized.sponsorVideoUrl,
    videoPath: normalized.sponsorVideoPath,
    position: normalized.sponsorPosition,
    sponsorXPercent,
    sponsorYPercent,
    xPercent: sponsorXPercent,
    yPercent: sponsorYPercent,
    scale: normalized.sponsorScale,
    opacity: normalized.sponsorOpacity,
    margin: normalized.sponsorMargin,
    chromaKey: normalized.sponsorChromaKey,
    chromaSimilarity: normalized.sponsorChromaSimilarity,
    timingMode: normalized.sponsorTimingMode,
    intervalSec: normalized.sponsorIntervalSec,
    durationSec: normalized.sponsorDurationSec,
    startSec: normalized.sponsorStartSec,
    endSec: normalized.sponsorEndSec,
    muteAudio: normalized.sponsorMuteAudio,
    volume: normalized.sponsorVolume,
  };
}

export function buildAntiTheftExportPayload(overlaySettings = null) {
  const normalized = normalizeGlobalOverlaySettings(overlaySettings || loadGlobalOverlaySettings());
  return {
    enabled: Boolean(normalized.enableAntiTheft),
    marqueeText: normalized.marqueeText,
    marqueeSpeed: normalized.marqueeSpeed,
    marqueePosition: normalized.marqueePosition,
    marqueeTextColor: normalized.marqueeTextColor,
    enableWatermark: normalized.enableWatermark,
    watermarkText: normalized.watermarkText,
    watermarkPosition: normalized.watermarkPosition,
    watermarkColor: normalized.watermarkColor,
    antiTheftSize: normalized.antiTheftSize,
    ...(typeof normalized.antiTheftBottomPercent === 'number'
      ? { antiTheftBottomPercent: normalized.antiTheftBottomPercent }
      : {}),
  };
}
