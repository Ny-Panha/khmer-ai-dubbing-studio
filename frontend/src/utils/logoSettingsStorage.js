export const STORAGE_GLOBAL_LOGO_SETTINGS_KEY = 'KHMER_AI_GLOBAL_LOGO_SETTINGS_V1';
export const STORAGE_GLOBAL_CUSTOMIZE_SETTINGS_KEY = STORAGE_GLOBAL_LOGO_SETTINGS_KEY;

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

export const MASK_SETTING_KEYS = Object.freeze([
  'enableCornerMask',
  'cornerMaskText',
  'cornerMaskPosition',
  'cornerMaskStyle',
  'cornerMaskWidth',
  'cornerMaskHeight',
  'cornerMaskOpacity',
  'cornerMaskBlur',
  'cornerMaskOffsetX',
  'cornerMaskOffsetY',
  'cornerMaskXPercent',
  'cornerMaskYPercent',
]);

export const BANNER_SETTING_KEYS = Object.freeze([
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
  'antiTheftHeight',
  'antiTheftBottomPercent',
  'antiTheftBgStyle',
  'antiTheftBlur',
]);

export const CUSTOMIZE_SETTING_KEYS = Object.freeze([
  ...LOGO_SETTING_KEYS,
  ...MASK_SETTING_KEYS,
  ...BANNER_SETTING_KEYS,
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

const VALID_MASK_POSITIONS = new Set([
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  'custom',
]);

const VALID_MASK_STYLES = new Set(['badge', 'blur', 'solid']);

const VALID_BANNER_POSITIONS = new Set(['bottom', 'top']);
const VALID_BANNER_SIZES = new Set(['small', 'medium', 'large', 'xlarge', 'xxlarge']);
const VALID_BANNER_BG_STYLES = new Set(['dark', 'blur', 'solid']);

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

export const DEFAULT_GLOBAL_MASK_SETTINGS = Object.freeze({
  enableCornerMask: false,
  cornerMaskText: '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»',
  cornerMaskPosition: 'top-right',
  cornerMaskStyle: 'badge',
  cornerMaskWidth: 220,
  cornerMaskHeight: 54,
  cornerMaskOpacity: 0.95,
  cornerMaskBlur: 18,
  cornerMaskOffsetX: 14,
  cornerMaskOffsetY: 14,
  cornerMaskXPercent: null,
  cornerMaskYPercent: null,
});

export const DEFAULT_GLOBAL_BANNER_SETTINGS = Object.freeze({
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
  antiTheftHeight: null,
  antiTheftBottomPercent: 2,
  antiTheftBgStyle: 'dark',
  antiTheftBlur: 18,
});

export const DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS = Object.freeze({
  ...DEFAULT_GLOBAL_LOGO_SETTINGS,
  ...DEFAULT_GLOBAL_MASK_SETTINGS,
  ...DEFAULT_GLOBAL_BANNER_SETTINGS,
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

export function normalizeGlobalMaskSettings(input, fallback = DEFAULT_GLOBAL_MASK_SETTINGS) {
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_GLOBAL_MASK_SETTINGS;
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const enableCornerMask =
    src.enableCornerMask !== undefined
      ? Boolean(src.enableCornerMask)
      : src.enabled !== undefined
        ? Boolean(src.enabled)
        : Boolean(base.enableCornerMask);

  const rawText = src.cornerMaskText !== undefined ? src.cornerMaskText : src.text;
  const cornerMaskText =
    rawText === null
      ? ''
      : typeof rawText === 'string'
        ? rawText
        : (base.cornerMaskText ?? DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskText);

  const rawPos = src.cornerMaskPosition !== undefined ? src.cornerMaskPosition : src.position;
  const cornerMaskPosition =
    typeof rawPos === 'string' && VALID_MASK_POSITIONS.has(rawPos)
      ? rawPos
      : VALID_MASK_POSITIONS.has(base.cornerMaskPosition)
        ? base.cornerMaskPosition
        : DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskPosition;

  const rawStyle = src.cornerMaskStyle !== undefined ? src.cornerMaskStyle : src.style;
  const cornerMaskStyle =
    typeof rawStyle === 'string' && VALID_MASK_STYLES.has(rawStyle)
      ? rawStyle
      : VALID_MASK_STYLES.has(base.cornerMaskStyle)
        ? base.cornerMaskStyle
        : DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskStyle;

  const cornerMaskWidth = Math.round(
    clampNumber(
      src.cornerMaskWidth !== undefined ? src.cornerMaskWidth : src.width,
      60,
      500,
      Number(base.cornerMaskWidth) || DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskWidth
    )
  );

  const cornerMaskHeight = Math.round(
    clampNumber(
      src.cornerMaskHeight !== undefined ? src.cornerMaskHeight : src.height,
      20,
      200,
      Number(base.cornerMaskHeight) || DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskHeight
    )
  );

  const cornerMaskOpacity =
    Math.round(
      clampNumber(
        src.cornerMaskOpacity !== undefined ? src.cornerMaskOpacity : src.opacity,
        0.1,
        1.0,
        Number(base.cornerMaskOpacity) || DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskOpacity
      ) * 100
    ) / 100;

  const cornerMaskBlur = Math.round(
    clampNumber(
      src.cornerMaskBlur !== undefined ? src.cornerMaskBlur : src.blurStrength,
      4,
      40,
      Number(base.cornerMaskBlur) || DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskBlur
    )
  );

  const cornerMaskOffsetX = Math.round(
    clampNumber(
      src.cornerMaskOffsetX !== undefined ? src.cornerMaskOffsetX : src.offsetX,
      0,
      200,
      Number.isFinite(Number(base.cornerMaskOffsetX)) ? Number(base.cornerMaskOffsetX) : DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskOffsetX
    )
  );

  const cornerMaskOffsetY = Math.round(
    clampNumber(
      src.cornerMaskOffsetY !== undefined ? src.cornerMaskOffsetY : src.offsetY,
      0,
      200,
      Number.isFinite(Number(base.cornerMaskOffsetY)) ? Number(base.cornerMaskOffsetY) : DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskOffsetY
    )
  );

  const rawMaskXPct = src.cornerMaskXPercent !== undefined ? src.cornerMaskXPercent : src.xPercent;
  const rawMaskYPct = src.cornerMaskYPercent !== undefined ? src.cornerMaskYPercent : src.yPercent;
  let cornerMaskXPercent = null;
  let cornerMaskYPercent = null;
  if (cornerMaskPosition === 'custom') {
    const fbX = typeof base.cornerMaskXPercent === 'number' && Number.isFinite(base.cornerMaskXPercent) ? base.cornerMaskXPercent : 50;
    const fbY = typeof base.cornerMaskYPercent === 'number' && Number.isFinite(base.cornerMaskYPercent) ? base.cornerMaskYPercent : 50;
    cornerMaskXPercent = Math.round(clampNumber(rawMaskXPct, 0, 100, fbX) * 10) / 10;
    cornerMaskYPercent = Math.round(clampNumber(rawMaskYPct, 0, 100, fbY) * 10) / 10;
  }

  return {
    enableCornerMask,
    cornerMaskText,
    cornerMaskPosition,
    cornerMaskStyle,
    cornerMaskWidth,
    cornerMaskHeight,
    cornerMaskOpacity,
    cornerMaskBlur,
    cornerMaskOffsetX,
    cornerMaskOffsetY,
    cornerMaskXPercent,
    cornerMaskYPercent,
  };
}

export function normalizeGlobalBannerSettings(input, fallback = DEFAULT_GLOBAL_BANNER_SETTINGS) {
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_GLOBAL_BANNER_SETTINGS;
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const enableAntiTheft =
    src.enableAntiTheft !== undefined
      ? Boolean(src.enableAntiTheft)
      : src.enabled !== undefined
        ? Boolean(src.enabled)
        : Boolean(base.enableAntiTheft);

  const rawMarquee = src.marqueeText !== undefined ? src.marqueeText : src.text;
  const marqueeText =
    rawMarquee === null
      ? ''
      : typeof rawMarquee === 'string'
        ? rawMarquee
        : (base.marqueeText ?? DEFAULT_GLOBAL_BANNER_SETTINGS.marqueeText);

  const rawSpeed = src.marqueeSpeed !== undefined ? src.marqueeSpeed : base.marqueeSpeed;
  const marqueeSpeed = rawSpeed !== undefined && rawSpeed !== null ? String(rawSpeed) : DEFAULT_GLOBAL_BANNER_SETTINGS.marqueeSpeed;

  const rawPos = src.marqueePosition !== undefined ? src.marqueePosition : base.marqueePosition;
  const marqueePosition =
    typeof rawPos === 'string' && VALID_BANNER_POSITIONS.has(rawPos)
      ? rawPos
      : VALID_BANNER_POSITIONS.has(base.marqueePosition)
        ? base.marqueePosition
        : DEFAULT_GLOBAL_BANNER_SETTINGS.marqueePosition;

  const marqueeTextColor =
    typeof src.marqueeTextColor === 'string' && src.marqueeTextColor.trim()
      ? src.marqueeTextColor.trim()
      : (base.marqueeTextColor || DEFAULT_GLOBAL_BANNER_SETTINGS.marqueeTextColor);

  const enableWatermark =
    src.enableWatermark !== undefined
      ? Boolean(src.enableWatermark)
      : (base.enableWatermark !== undefined ? Boolean(base.enableWatermark) : DEFAULT_GLOBAL_BANNER_SETTINGS.enableWatermark);

  const rawWm = src.watermarkText !== undefined ? src.watermarkText : base.watermarkText;
  const watermarkText =
    rawWm === null
      ? ''
      : typeof rawWm === 'string'
        ? rawWm
        : (base.watermarkText ?? DEFAULT_GLOBAL_BANNER_SETTINGS.watermarkText);

  const watermarkPosition =
    typeof src.watermarkPosition === 'string' && src.watermarkPosition.trim()
      ? src.watermarkPosition.trim()
      : (base.watermarkPosition || DEFAULT_GLOBAL_BANNER_SETTINGS.watermarkPosition);

  const watermarkColor =
    typeof src.watermarkColor === 'string' && src.watermarkColor.trim()
      ? src.watermarkColor.trim()
      : (base.watermarkColor || DEFAULT_GLOBAL_BANNER_SETTINGS.watermarkColor);

  const rawSize = src.antiTheftSize !== undefined ? src.antiTheftSize : base.antiTheftSize;
  const antiTheftSize =
    typeof rawSize === 'string' && VALID_BANNER_SIZES.has(rawSize)
      ? rawSize
      : VALID_BANNER_SIZES.has(base.antiTheftSize)
        ? base.antiTheftSize
        : DEFAULT_GLOBAL_BANNER_SETTINGS.antiTheftSize;

  const rawHeight = src.antiTheftHeight !== undefined ? src.antiTheftHeight : src.ribbonHeight;
  let antiTheftHeight = null;
  if (rawHeight === null || rawHeight === '' || rawHeight === 0) {
    antiTheftHeight = null;
  } else if (rawHeight !== undefined) {
    const numH = Number(rawHeight);
    antiTheftHeight = Number.isFinite(numH) && numH > 0 ? Math.round(Math.max(18, Math.min(120, numH))) : null;
  } else if (base.antiTheftHeight !== null && base.antiTheftHeight !== undefined && Number(base.antiTheftHeight) > 0) {
    antiTheftHeight = Math.round(Math.max(18, Math.min(120, Number(base.antiTheftHeight))));
  }

  const antiTheftBottomPercent = Math.round(
    clampNumber(
      src.antiTheftBottomPercent !== undefined ? src.antiTheftBottomPercent : src.bottomPercent,
      0,
      80,
      Number.isFinite(Number(base.antiTheftBottomPercent))
        ? Number(base.antiTheftBottomPercent)
        : DEFAULT_GLOBAL_BANNER_SETTINGS.antiTheftBottomPercent
    ) * 10
  ) / 10;

  const rawBgStyle = src.antiTheftBgStyle !== undefined ? src.antiTheftBgStyle : src.bgStyle;
  const antiTheftBgStyle =
    typeof rawBgStyle === 'string' && VALID_BANNER_BG_STYLES.has(rawBgStyle.toLowerCase())
      ? rawBgStyle.toLowerCase()
      : VALID_BANNER_BG_STYLES.has(base.antiTheftBgStyle)
        ? base.antiTheftBgStyle
        : DEFAULT_GLOBAL_BANNER_SETTINGS.antiTheftBgStyle;

  const antiTheftBlur = Math.round(
    clampNumber(
      src.antiTheftBlur !== undefined ? src.antiTheftBlur : src.blurStrength,
      0,
      40,
      Number.isFinite(Number(base.antiTheftBlur))
        ? Number(base.antiTheftBlur)
        : DEFAULT_GLOBAL_BANNER_SETTINGS.antiTheftBlur
    )
  );

  return {
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
    antiTheftHeight,
    antiTheftBottomPercent,
    antiTheftBgStyle,
    antiTheftBlur,
  };
}

export function normalizeGlobalCustomizeSettings(input, fallback = DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS) {
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS;
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const logoSrc = { ...src, ...(src.logoSettings || src.logo || {}) };
  const maskSrc = { ...src, ...(src.cornerMaskSettings || src.cornerMask || {}) };
  const bannerSrc = { ...src, ...(src.antiTheftSettings || src.antiTheft || {}) };

  const logo = normalizeGlobalLogoSettings(logoSrc, base);
  const mask = normalizeGlobalMaskSettings(maskSrc, base);
  const banner = normalizeGlobalBannerSettings(bannerSrc, base);

  return {
    ...logo,
    ...mask,
    ...banner,
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

export function extractCustomizeSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const key of CUSTOMIZE_SETTING_KEYS) {
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

export function hasAnyCustomizeSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return CUSTOMIZE_SETTING_KEYS.some(
    (key) => Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined
  );
}

export function areLogoSettingsEqual(a, b) {
  const normA = normalizeGlobalLogoSettings(a);
  const normB = normalizeGlobalLogoSettings(b);
  return LOGO_SETTING_KEYS.every((key) => normA[key] === normB[key]);
}

export function areCustomizeSettingsEqual(a, b) {
  const normA = normalizeGlobalCustomizeSettings(a);
  const normB = normalizeGlobalCustomizeSettings(b);
  return CUSTOMIZE_SETTING_KEYS.every((key) => normA[key] === normB[key]);
}

export function hasCustomLogoSettings(obj) {
  if (!hasAnyLogoSettings(obj)) return false;
  const normalized = normalizeGlobalLogoSettings(obj);
  return !areLogoSettingsEqual(normalized, DEFAULT_GLOBAL_LOGO_SETTINGS);
}

export function hasCustomCustomizeSettings(obj) {
  if (!hasAnyCustomizeSettings(obj)) return false;
  const normalized = normalizeGlobalCustomizeSettings(obj);
  return !areCustomizeSettingsEqual(normalized, DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS);
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

export function stripCustomizeSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  let changed = false;
  const next = { ...obj };
  for (const key of CUSTOMIZE_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : obj;
}

export function loadGlobalCustomizeSettingsRecord() {
  try {
    if (typeof localStorage === 'undefined') {
      return {
        initialized: false,
        settings: { ...DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS },
        updatedAt: 0,
      };
    }
    const raw = localStorage.getItem(STORAGE_GLOBAL_CUSTOMIZE_SETTINGS_KEY);
    if (!raw) {
      return {
        initialized: false,
        settings: { ...DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS },
        updatedAt: 0,
      };
    }
    const parsed = JSON.parse(raw);
    const payload = parsed?.settings || parsed?.customizeSettings || parsed?.logoSettings || parsed;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        initialized: false,
        settings: { ...DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS },
        updatedAt: 0,
      };
    }
    return {
      initialized: true,
      settings: normalizeGlobalCustomizeSettings(payload),
      updatedAt: Number(parsed?.updatedAt) || 0,
    };
  } catch {
    return {
      initialized: false,
      settings: { ...DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS },
      updatedAt: 0,
    };
  }
}

export function loadGlobalLogoSettingsRecord() {
  const customRecord = loadGlobalCustomizeSettingsRecord();
  return {
    initialized: customRecord.initialized,
    settings: normalizeGlobalLogoSettings(customRecord.settings),
    updatedAt: customRecord.updatedAt,
  };
}

export function hasStoredGlobalLogoSettings() {
  return loadGlobalLogoSettingsRecord().initialized;
}

export function loadGlobalLogoSettings() {
  return loadGlobalLogoSettingsRecord().settings;
}

export function loadGlobalCustomizeSettings() {
  return loadGlobalCustomizeSettingsRecord().settings;
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
            customizeSettings: next.settings,
            logoSettings: normalizeGlobalLogoSettings(next.settings),
            settings: next.settings,
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

export async function syncGlobalCustomizeSettingsToServer(settings, updatedAt = Date.now()) {
  if (typeof fetch !== 'function') return null;
  const normalized = normalizeGlobalCustomizeSettings(settings);
  const ts = Math.max(Number(updatedAt) || Date.now(), lastSavedUpdatedAt);
  lastSavedUpdatedAt = ts;
  pendingServerSyncPayload = { settings: normalized, updatedAt: ts };
  return flushPendingServerSync();
}

export async function syncGlobalLogoSettingsToServer(settings, updatedAt = Date.now()) {
  const current = loadGlobalCustomizeSettings();
  const merged = { ...current, ...normalizeGlobalLogoSettings(settings) };
  return syncGlobalCustomizeSettingsToServer(merged, updatedAt);
}

export async function fetchGlobalCustomizeSettingsFromServer() {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/logo-settings');
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    const payload = data.settings || data.customizeSettings || data.logoSettings || null;
    return {
      initialized: Boolean(data.initialized && payload),
      settings: payload ? normalizeGlobalCustomizeSettings(payload) : null,
      updatedAt: Number(data.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

export async function fetchGlobalLogoSettingsFromServer() {
  const s = await fetchGlobalCustomizeSettingsFromServer();
  if (!s) return null;
  return {
    ...s,
    settings: s.settings ? normalizeGlobalLogoSettings(s.settings) : null,
  };
}

export function saveGlobalCustomizeSettings(
  settings,
  { syncServer = true, updatedAt = Date.now() } = {}
) {
  const existingRecord = loadGlobalCustomizeSettingsRecord();
  const normalized = normalizeGlobalCustomizeSettings(settings, existingRecord.settings);
  const rawTs = Number(updatedAt) || Date.now();
  const ts = syncServer ? Math.max(rawTs, lastSavedUpdatedAt + 1) : rawTs;
  if (ts > lastSavedUpdatedAt) {
    lastSavedUpdatedAt = ts;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        STORAGE_GLOBAL_CUSTOMIZE_SETTINGS_KEY,
        JSON.stringify({
          version: 1,
          updatedAt: ts,
          settings: normalized,
        })
      );
    }
  } catch {}

  if (syncServer) {
    syncGlobalCustomizeSettingsToServer(normalized, ts).catch(() => {});
  }
  return normalized;
}

export function saveGlobalLogoSettings(
  settings,
  { syncServer = true, updatedAt = Date.now() } = {}
) {
  const existingRecord = loadGlobalCustomizeSettingsRecord();
  const next = {
    ...existingRecord.settings,
    ...normalizeGlobalLogoSettings(settings, existingRecord.settings),
  };
  return saveGlobalCustomizeSettings(next, { syncServer, updatedAt });
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

export function resolveInitialCustomizeSeed({
  activeEpisodeVoiceSettings = null,
  legacyVoiceSettings = null,
} = {}) {
  let base = { ...DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS };

  if (hasCustomLogoSettings(activeEpisodeVoiceSettings)) {
    base = { ...base, ...normalizeGlobalLogoSettings(activeEpisodeVoiceSettings) };
  } else if (hasCustomLogoSettings(legacyVoiceSettings)) {
    base = { ...base, ...normalizeGlobalLogoSettings(legacyVoiceSettings) };
  } else if (hasAnyLogoSettings(activeEpisodeVoiceSettings)) {
    base = { ...base, ...normalizeGlobalLogoSettings(activeEpisodeVoiceSettings) };
  } else if (hasAnyLogoSettings(legacyVoiceSettings)) {
    base = { ...base, ...normalizeGlobalLogoSettings(legacyVoiceSettings) };
  }

  const hasCustomMask = (obj) =>
    obj && typeof obj === 'object' && MASK_SETTING_KEYS.some((k) => obj[k] !== undefined);
  if (hasCustomMask(activeEpisodeVoiceSettings)) {
    base = { ...base, ...normalizeGlobalMaskSettings(activeEpisodeVoiceSettings) };
  } else if (hasCustomMask(legacyVoiceSettings)) {
    base = { ...base, ...normalizeGlobalMaskSettings(legacyVoiceSettings) };
  }

  const hasCustomBanner = (obj) =>
    obj && typeof obj === 'object' && BANNER_SETTING_KEYS.some((k) => obj[k] !== undefined);
  if (hasCustomBanner(activeEpisodeVoiceSettings)) {
    base = { ...base, ...normalizeGlobalBannerSettings(activeEpisodeVoiceSettings) };
  } else if (hasCustomBanner(legacyVoiceSettings)) {
    base = { ...base, ...normalizeGlobalBannerSettings(legacyVoiceSettings) };
  }

  return normalizeGlobalCustomizeSettings(base);
}

/**
 * One-time migration: seeds the dedicated global customize store if it does not exist yet.
 */
export function migrateGlobalLogoSettingsIfNeeded({
  activeEpisodeVoiceSettings = null,
  legacyVoiceSettings = null,
  syncServer = true,
} = {}) {
  const existing = loadGlobalCustomizeSettingsRecord();
  if (existing.initialized) {
    return existing.settings;
  }
  const seeded = resolveInitialCustomizeSeed({
    activeEpisodeVoiceSettings,
    legacyVoiceSettings,
  });
  return saveGlobalCustomizeSettings(seeded, { syncServer });
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

export function buildCornerMaskExportPayload(maskSettings = null) {
  const normalized = normalizeGlobalMaskSettings(maskSettings || loadGlobalCustomizeSettings());
  const isCustomPos = normalized.cornerMaskPosition === 'custom';
  return {
    enabled: Boolean(normalized.enableCornerMask),
    text: normalized.cornerMaskText ?? '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»',
    style: normalized.cornerMaskStyle || 'badge',
    position: normalized.cornerMaskPosition || 'top-right',
    width: Number(normalized.cornerMaskWidth) || 220,
    height: Number(normalized.cornerMaskHeight) || 54,
    opacity: Number(normalized.cornerMaskOpacity) || 0.95,
    blurStrength: Number.isFinite(Number(normalized.cornerMaskBlur)) ? Number(normalized.cornerMaskBlur) : 18,
    offsetX: Number.isFinite(Number(normalized.cornerMaskOffsetX)) ? Number(normalized.cornerMaskOffsetX) : 14,
    offsetY: Number.isFinite(Number(normalized.cornerMaskOffsetY)) ? Number(normalized.cornerMaskOffsetY) : 14,
    ...(isCustomPos && typeof normalized.cornerMaskXPercent === 'number' && typeof normalized.cornerMaskYPercent === 'number'
      ? {
          cornerMaskXPercent: normalized.cornerMaskXPercent,
          cornerMaskYPercent: normalized.cornerMaskYPercent,
        }
      : {}),
  };
}

export function buildAntiTheftExportPayload(bannerSettings = null) {
  const normalized = normalizeGlobalBannerSettings(bannerSettings || loadGlobalCustomizeSettings());
  return {
    enabled: Boolean(normalized.enableAntiTheft),
    marqueeText: normalized.marqueeText ?? '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»',
    marqueeSpeed: normalized.marqueeSpeed || 'normal',
    marqueePosition: normalized.marqueePosition || 'bottom',
    marqueeTextColor: normalized.marqueeTextColor || '#FFE600',
    enableWatermark: normalized.enableWatermark !== false,
    watermarkText: normalized.watermarkText ?? 'រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama',
    watermarkPosition: normalized.watermarkPosition || 'above-ticker',
    watermarkColor: normalized.watermarkColor || '#38BDF8',
    antiTheftSize: normalized.antiTheftSize || 'small',
    antiTheftHeight: normalized.antiTheftHeight ?? null,
    ribbonHeight: normalized.antiTheftHeight ?? null,
    antiTheftBottomPercent: normalized.antiTheftBottomPercent ?? 2,
    antiTheftBgStyle: normalized.antiTheftBgStyle || 'dark',
    bgStyle: normalized.antiTheftBgStyle || 'dark',
    antiTheftBlur: Number.isFinite(Number(normalized.antiTheftBlur)) ? Number(normalized.antiTheftBlur) : 18,
    blurStrength: Number.isFinite(Number(normalized.antiTheftBlur)) ? Number(normalized.antiTheftBlur) : 18,
  };
}
