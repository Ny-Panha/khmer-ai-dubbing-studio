const fs = require("fs");
const path = require("path");
const { uploadsDir } = require("../utils/pathUtils");

const LOGO_SETTING_KEYS = Object.freeze([
  "enableLogo",
  "logoImage",
  "logoPosition",
  "logoSize",
  "logoOpacity",
  "logoShape",
  "logoMargin",
  "logoXPercent",
  "logoYPercent",
]);

const VALID_LOGO_POSITIONS = new Set([
  "both",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
  "custom",
]);

const VALID_LOGO_SHAPES = new Set(["circle", "square"]);

const DEFAULT_GLOBAL_LOGO_SETTINGS = Object.freeze({
  enableLogo: true,
  logoImage: "/assets/dragon_town_logo.jpg",
  logoPosition: "both",
  logoSize: 72,
  logoOpacity: 0.9,
  logoShape: "circle",
  logoMargin: 20,
  logoXPercent: null,
  logoYPercent: null,
});

function getDefaultStoragePath() {
  return path.join(uploadsDir, "cache", "global_logo_settings.json");
}

function clampNumber(val, min, max, fallback) {
  if (val === null || val === undefined || val === "") return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeGlobalLogoSettings(input, fallback = DEFAULT_GLOBAL_LOGO_SETTINGS) {
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_GLOBAL_LOGO_SETTINGS;
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};

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
      : typeof rawImage === "string" && rawImage.trim()
        ? rawImage.trim()
        : base.logoImage ?? DEFAULT_GLOBAL_LOGO_SETTINGS.logoImage;

  const rawPos = src.logoPosition !== undefined ? src.logoPosition : src.position;
  const logoPosition =
    typeof rawPos === "string" && VALID_LOGO_POSITIONS.has(rawPos)
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
    typeof rawShape === "string" && VALID_LOGO_SHAPES.has(rawShape)
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
  if (logoPosition === "custom") {
    const rawX = src.logoXPercent !== undefined ? src.logoXPercent : src.xPercent;
    const rawY = src.logoYPercent !== undefined ? src.logoYPercent : src.yPercent;
    const fallbackX = typeof base.logoXPercent === "number" && Number.isFinite(base.logoXPercent) ? base.logoXPercent : 50;
    const fallbackY = typeof base.logoYPercent === "number" && Number.isFinite(base.logoYPercent) ? base.logoYPercent : 50;
    logoXPercent = Math.round(clampNumber(rawX, 0, 100, fallbackX) * 10) / 10;
    logoYPercent = Math.round(clampNumber(rawY, 0, 100, fallbackY) * 10) / 10;
  } else if (logoPosition === "center") {
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
  try {
    if (!fs.existsSync(storagePath)) {
      return {
        initialized: false,
        logoSettings: null,
        updatedAt: 0,
      };
    }
    const raw = fs.readFileSync(storagePath, "utf8");
    const parsed = JSON.parse(raw);
    const payload = parsed?.logoSettings || parsed?.settings || parsed;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        initialized: false,
        logoSettings: null,
        updatedAt: 0,
      };
    }
    return {
      initialized: true,
      logoSettings: normalizeGlobalLogoSettings(payload),
      updatedAt: Number(parsed?.updatedAt) || 0,
    };
  } catch (_) {
    return {
      initialized: false,
      logoSettings: null,
      updatedAt: 0,
    };
  }
}

function writeGlobalLogoSettings(input, options = {}) {
  const storagePath = options.storagePath || getDefaultStoragePath();
  const normalized = normalizeGlobalLogoSettings(input);
  const incomingUpdatedAt = Number(options.updatedAt) || Date.now();
  const existing = readGlobalLogoSettings(storagePath);
  if (existing.initialized && existing.updatedAt > incomingUpdatedAt) {
    return existing;
  }
  const updatedAt = incomingUpdatedAt;
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const envelope = {
    version: 1,
    updatedAt,
    logoSettings: normalized,
  };
  const tmpPath = `${storagePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), "utf8");
  try {
    fs.renameSync(tmpPath, storagePath);
  } catch (_) {
    fs.copyFileSync(tmpPath, storagePath);
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }
  return {
    initialized: true,
    logoSettings: normalized,
    updatedAt,
  };
}

function formatGlobalLogoSettingsForExport(logoSettings) {
  const normalized = normalizeGlobalLogoSettings(logoSettings);
  const isCustomOrCenter = normalized.logoPosition === "custom" || normalized.logoPosition === "center";
  return {
    enabled: Boolean(normalized.enableLogo),
    image: normalized.logoImage,
    position: normalized.logoPosition,
    size: normalized.logoSize,
    opacity: normalized.logoOpacity,
    shape: normalized.logoShape,
    margin: normalized.logoMargin,
    ...(isCustomOrCenter && typeof normalized.logoXPercent === "number" && typeof normalized.logoYPercent === "number"
      ? {
          logoXPercent: normalized.logoXPercent,
          logoYPercent: normalized.logoYPercent,
        }
      : {}),
  };
}

function getEffectiveGlobalLogoSettingsForExport(storagePath = getDefaultStoragePath()) {
  const stored = readGlobalLogoSettings(storagePath);
  return formatGlobalLogoSettingsForExport(
    stored.initialized && stored.logoSettings ? stored.logoSettings : DEFAULT_GLOBAL_LOGO_SETTINGS
  );
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
