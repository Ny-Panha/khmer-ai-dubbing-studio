const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

const MASK_SETTING_KEYS = Object.freeze([
  "enableCornerMask",
  "cornerMaskText",
  "cornerMaskPosition",
  "cornerMaskStyle",
  "cornerMaskWidth",
  "cornerMaskHeight",
  "cornerMaskOpacity",
  "cornerMaskBlur",
  "cornerMaskOffsetX",
  "cornerMaskOffsetY",
]);

const BANNER_SETTING_KEYS = Object.freeze([
  "enableAntiTheft",
  "marqueeText",
  "marqueeSpeed",
  "marqueePosition",
  "marqueeTextColor",
  "enableWatermark",
  "watermarkText",
  "watermarkPosition",
  "watermarkColor",
  "antiTheftSize",
  "antiTheftBottomPercent",
]);

const CUSTOMIZE_SETTING_KEYS = Object.freeze([
  ...LOGO_SETTING_KEYS,
  ...MASK_SETTING_KEYS,
  ...BANNER_SETTING_KEYS,
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

const VALID_MASK_POSITIONS = new Set([
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
]);

const VALID_MASK_STYLES = new Set(["badge", "blur", "solid"]);

const VALID_BANNER_POSITIONS = new Set(["bottom", "top"]);
const VALID_BANNER_SIZES = new Set(["small", "medium", "large"]);

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

const DEFAULT_GLOBAL_MASK_SETTINGS = Object.freeze({
  enableCornerMask: false,
  cornerMaskText: "«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»",
  cornerMaskPosition: "top-right",
  cornerMaskStyle: "badge",
  cornerMaskWidth: 220,
  cornerMaskHeight: 54,
  cornerMaskOpacity: 0.95,
  cornerMaskBlur: 18,
  cornerMaskOffsetX: 14,
  cornerMaskOffsetY: 14,
});

const DEFAULT_GLOBAL_BANNER_SETTINGS = Object.freeze({
  enableAntiTheft: false,
  marqueeText: "«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»",
  marqueeSpeed: "normal",
  marqueePosition: "bottom",
  marqueeTextColor: "#FFE600",
  enableWatermark: true,
  watermarkText: "រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama",
  watermarkPosition: "above-ticker",
  watermarkColor: "#38BDF8",
  antiTheftSize: "small",
  antiTheftBottomPercent: 2,
});

const DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS = Object.freeze({
  ...DEFAULT_GLOBAL_LOGO_SETTINGS,
  ...DEFAULT_GLOBAL_MASK_SETTINGS,
  ...DEFAULT_GLOBAL_BANNER_SETTINGS,
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

function normalizeGlobalMaskSettings(input, fallback = DEFAULT_GLOBAL_MASK_SETTINGS) {
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_GLOBAL_MASK_SETTINGS;
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  const enableCornerMask =
    src.enableCornerMask !== undefined
      ? Boolean(src.enableCornerMask)
      : src.enabled !== undefined
        ? Boolean(src.enabled)
        : Boolean(base.enableCornerMask);

  const rawText = src.cornerMaskText !== undefined ? src.cornerMaskText : src.text;
  const cornerMaskText =
    rawText === null
      ? ""
      : typeof rawText === "string"
        ? rawText
        : (base.cornerMaskText ?? DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskText);

  const rawPos = src.cornerMaskPosition !== undefined ? src.cornerMaskPosition : src.position;
  const cornerMaskPosition =
    typeof rawPos === "string" && VALID_MASK_POSITIONS.has(rawPos)
      ? rawPos
      : VALID_MASK_POSITIONS.has(base.cornerMaskPosition)
        ? base.cornerMaskPosition
        : DEFAULT_GLOBAL_MASK_SETTINGS.cornerMaskPosition;

  const rawStyle = src.cornerMaskStyle !== undefined ? src.cornerMaskStyle : src.style;
  const cornerMaskStyle =
    typeof rawStyle === "string" && VALID_MASK_STYLES.has(rawStyle)
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
  };
}

function normalizeGlobalBannerSettings(input, fallback = DEFAULT_GLOBAL_BANNER_SETTINGS) {
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_GLOBAL_BANNER_SETTINGS;
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  const enableAntiTheft =
    src.enableAntiTheft !== undefined
      ? Boolean(src.enableAntiTheft)
      : src.enabled !== undefined
        ? Boolean(src.enabled)
        : Boolean(base.enableAntiTheft);

  const rawMarquee = src.marqueeText !== undefined ? src.marqueeText : src.text;
  const marqueeText =
    rawMarquee === null
      ? ""
      : typeof rawMarquee === "string"
        ? rawMarquee
        : (base.marqueeText ?? DEFAULT_GLOBAL_BANNER_SETTINGS.marqueeText);

  const rawSpeed = src.marqueeSpeed !== undefined ? src.marqueeSpeed : base.marqueeSpeed;
  const marqueeSpeed = rawSpeed !== undefined && rawSpeed !== null ? String(rawSpeed) : DEFAULT_GLOBAL_BANNER_SETTINGS.marqueeSpeed;

  const rawPos = src.marqueePosition !== undefined ? src.marqueePosition : base.marqueePosition;
  const marqueePosition =
    typeof rawPos === "string" && VALID_BANNER_POSITIONS.has(rawPos)
      ? rawPos
      : VALID_BANNER_POSITIONS.has(base.marqueePosition)
        ? base.marqueePosition
        : DEFAULT_GLOBAL_BANNER_SETTINGS.marqueePosition;

  const marqueeTextColor =
    typeof src.marqueeTextColor === "string" && src.marqueeTextColor.trim()
      ? src.marqueeTextColor.trim()
      : (base.marqueeTextColor || DEFAULT_GLOBAL_BANNER_SETTINGS.marqueeTextColor);

  const enableWatermark =
    src.enableWatermark !== undefined
      ? Boolean(src.enableWatermark)
      : (base.enableWatermark !== undefined ? Boolean(base.enableWatermark) : DEFAULT_GLOBAL_BANNER_SETTINGS.enableWatermark);

  const rawWm = src.watermarkText !== undefined ? src.watermarkText : base.watermarkText;
  const watermarkText =
    rawWm === null
      ? ""
      : typeof rawWm === "string"
        ? rawWm
        : (base.watermarkText ?? DEFAULT_GLOBAL_BANNER_SETTINGS.watermarkText);

  const watermarkPosition =
    typeof src.watermarkPosition === "string" && src.watermarkPosition.trim()
      ? src.watermarkPosition.trim()
      : (base.watermarkPosition || DEFAULT_GLOBAL_BANNER_SETTINGS.watermarkPosition);

  const watermarkColor =
    typeof src.watermarkColor === "string" && src.watermarkColor.trim()
      ? src.watermarkColor.trim()
      : (base.watermarkColor || DEFAULT_GLOBAL_BANNER_SETTINGS.watermarkColor);

  const rawSize = src.antiTheftSize !== undefined ? src.antiTheftSize : base.antiTheftSize;
  const antiTheftSize =
    typeof rawSize === "string" && VALID_BANNER_SIZES.has(rawSize)
      ? rawSize
      : VALID_BANNER_SIZES.has(base.antiTheftSize)
        ? base.antiTheftSize
        : DEFAULT_GLOBAL_BANNER_SETTINGS.antiTheftSize;

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
    antiTheftBottomPercent,
  };
}

function normalizeGlobalCustomizeSettings(input, fallback = DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS) {
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS;
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};

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

function stripCustomizeSettingsFromObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
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

function readGlobalCustomizeSettings(storagePath = getDefaultStoragePath()) {
  try {
    if (!fs.existsSync(storagePath)) {
      return {
        initialized: false,
        settings: null,
        logoSettings: null,
        cornerMaskSettings: null,
        antiTheftSettings: null,
        updatedAt: 0,
      };
    }
    const raw = fs.readFileSync(storagePath, "utf8");
    const parsed = JSON.parse(raw);
    const payload = parsed?.settings || parsed?.customizeSettings || parsed?.logoSettings || parsed;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        initialized: false,
        settings: null,
        logoSettings: null,
        cornerMaskSettings: null,
        antiTheftSettings: null,
        updatedAt: 0,
      };
    }
    const normalized = normalizeGlobalCustomizeSettings(payload);
    return {
      initialized: true,
      settings: normalized,
      logoSettings: normalizeGlobalLogoSettings(normalized),
      cornerMaskSettings: normalizeGlobalMaskSettings(normalized),
      antiTheftSettings: normalizeGlobalBannerSettings(normalized),
      customizeSettings: normalized,
      updatedAt: Number(parsed?.updatedAt) || 0,
    };
  } catch (_) {
    return {
      initialized: false,
      settings: null,
      logoSettings: null,
      cornerMaskSettings: null,
      antiTheftSettings: null,
      updatedAt: 0,
    };
  }
}

function readGlobalLogoSettings(storagePath = getDefaultStoragePath()) {
  const cust = readGlobalCustomizeSettings(storagePath);
  return {
    initialized: cust.initialized,
    logoSettings: cust.logoSettings,
    updatedAt: cust.updatedAt,
  };
}

function writeGlobalCustomizeSettings(input, options = {}) {
  const storagePath = options.storagePath || getDefaultStoragePath();
  const existing = readGlobalCustomizeSettings(storagePath);
  const normalized = normalizeGlobalCustomizeSettings(input, existing.settings || DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS);
  const incomingUpdatedAt = Number(options.updatedAt) || Date.now();
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
    settings: normalized,
    logoSettings: normalizeGlobalLogoSettings(normalized),
    cornerMaskSettings: normalizeGlobalMaskSettings(normalized),
    antiTheftSettings: normalizeGlobalBannerSettings(normalized),
    customizeSettings: normalized,
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
    settings: normalized,
    logoSettings: envelope.logoSettings,
    cornerMaskSettings: envelope.cornerMaskSettings,
    antiTheftSettings: envelope.antiTheftSettings,
    customizeSettings: normalized,
    updatedAt,
  };
}

function writeGlobalLogoSettings(input, options = {}) {
  const storagePath = options.storagePath || getDefaultStoragePath();
  const existing = readGlobalCustomizeSettings(storagePath);
  const merged = {
    ...(existing.settings || DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS),
    ...normalizeGlobalLogoSettings(input, existing.settings || DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS),
  };
  return writeGlobalCustomizeSettings(merged, { ...options, storagePath });
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

function formatGlobalCornerMaskForExport(cornerMask) {
  const norm = normalizeGlobalMaskSettings(cornerMask);
  return {
    enabled: Boolean(norm.enableCornerMask),
    text: norm.cornerMaskText ?? "«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»",
    style: norm.cornerMaskStyle || "badge",
    position: norm.cornerMaskPosition || "top-right",
    width: Number(norm.cornerMaskWidth) || 220,
    height: Number(norm.cornerMaskHeight) || 54,
    opacity: Number(norm.cornerMaskOpacity) || 0.95,
    blurStrength: Number(norm.cornerMaskBlur) || 18,
    offsetX: Number(norm.cornerMaskOffsetX) || 14,
    offsetY: Number(norm.cornerMaskOffsetY) || 14,
  };
}

function formatGlobalAntiTheftForExport(antiTheft) {
  const norm = normalizeGlobalBannerSettings(antiTheft);
  return {
    enabled: Boolean(norm.enableAntiTheft),
    marqueeText: norm.marqueeText || "«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»",
    marqueeSpeed: norm.marqueeSpeed || "normal",
    marqueePosition: norm.marqueePosition || "bottom",
    marqueeTextColor: norm.marqueeTextColor || "#FFE600",
    enableWatermark: norm.enableWatermark !== false,
    watermarkText: norm.watermarkText || "រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama",
    watermarkPosition: norm.watermarkPosition || "above-ticker",
    watermarkColor: norm.watermarkColor || "#38BDF8",
    antiTheftSize: norm.antiTheftSize || "small",
    antiTheftBottomPercent: norm.antiTheftBottomPercent ?? 2,
  };
}

function getEffectiveGlobalLogoSettingsForExport(storagePath = getDefaultStoragePath()) {
  const stored = readGlobalCustomizeSettings(storagePath);
  return formatGlobalLogoSettingsForExport(
    stored.initialized && stored.settings ? stored.settings : DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS
  );
}

function getEffectiveGlobalCornerMaskForExport(storagePath = getDefaultStoragePath()) {
  const stored = readGlobalCustomizeSettings(storagePath);
  return formatGlobalCornerMaskForExport(
    stored.initialized && stored.settings ? stored.settings : DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS
  );
}

function getEffectiveGlobalAntiTheftForExport(storagePath = getDefaultStoragePath()) {
  const stored = readGlobalCustomizeSettings(storagePath);
  return formatGlobalAntiTheftForExport(
    stored.initialized && stored.settings ? stored.settings : DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS
  );
}

function getEffectiveGlobalCustomizeSettingsForExport(storagePath = getDefaultStoragePath()) {
  return {
    logoSettings: getEffectiveGlobalLogoSettingsForExport(storagePath),
    cornerMask: getEffectiveGlobalCornerMaskForExport(storagePath),
    antiTheft: getEffectiveGlobalAntiTheftForExport(storagePath),
  };
}

function computeVisualFingerprint(options = {}) {
  const logo = formatGlobalLogoSettingsForExport(options.logo || options.logoSettings);
  const mask = formatGlobalCornerMaskForExport(options.mask || options.cornerMask);
  const banner = formatGlobalAntiTheftForExport(options.banner || options.antiTheft);
  const ratio = options.aspectRatio || null;
  const vStyle = options.verticalStyle || null;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ logo, mask, banner, ratio, vStyle }))
    .digest("hex")
    .slice(0, 16);
}

module.exports = {
  LOGO_SETTING_KEYS,
  MASK_SETTING_KEYS,
  BANNER_SETTING_KEYS,
  CUSTOMIZE_SETTING_KEYS,
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  DEFAULT_GLOBAL_MASK_SETTINGS,
  DEFAULT_GLOBAL_BANNER_SETTINGS,
  DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS,
  getDefaultStoragePath,
  normalizeGlobalLogoSettings,
  normalizeGlobalMaskSettings,
  normalizeGlobalBannerSettings,
  normalizeGlobalCustomizeSettings,
  stripLogoSettingsFromObject,
  stripCustomizeSettingsFromObject,
  readGlobalLogoSettings,
  readGlobalCustomizeSettings,
  writeGlobalLogoSettings,
  writeGlobalCustomizeSettings,
  formatGlobalLogoSettingsForExport,
  formatGlobalCornerMaskForExport,
  formatGlobalAntiTheftForExport,
  getEffectiveGlobalLogoSettingsForExport,
  getEffectiveGlobalCornerMaskForExport,
  getEffectiveGlobalAntiTheftForExport,
  getEffectiveGlobalCustomizeSettingsForExport,
  computeVisualFingerprint,
};
