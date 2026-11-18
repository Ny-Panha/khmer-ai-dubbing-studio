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

const CORNER_MASK_SETTING_KEYS = Object.freeze([
  "enableCornerMask",
  "cornerMaskText",
  "cornerMaskStyle",
  "cornerMaskPosition",
  "cornerMaskWidth",
  "cornerMaskHeight",
  "cornerMaskOpacity",
]);

const SPONSOR_SETTING_KEYS = Object.freeze([
  "enableSponsor",
  "sponsorVideoUrl",
  "sponsorVideoPath",
  "sponsorChromaKey",
  "sponsorChromaSimilarity",
  "sponsorPosition",
  "sponsorXPercent",
  "sponsorYPercent",
  "sponsorTimingMode",
  "sponsorIntervalSec",
  "sponsorDurationSec",
  "sponsorStartSec",
  "sponsorEndSec",
  "sponsorScale",
  "sponsorOpacity",
  "sponsorMargin",
  "sponsorMuteAudio",
  "sponsorVolume",
]);

const ANTI_THEFT_SETTING_KEYS = Object.freeze([
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

const GLOBAL_OVERLAY_SETTING_KEYS = Object.freeze([
  ...LOGO_SETTING_KEYS,
  ...CORNER_MASK_SETTING_KEYS,
  ...SPONSOR_SETTING_KEYS,
  ...ANTI_THEFT_SETTING_KEYS,
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
const VALID_CORNER_MASK_STYLES = new Set(["badge", "blur", "solid"]);
const VALID_CORNER_MASK_POSITIONS = new Set([
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
]);
const VALID_SPONSOR_POSITIONS = new Set([
  "bottom-left",
  "bottom-center",
  "bottom-right",
  "top-left",
  "top-right",
  "custom",
]);
const VALID_SPONSOR_TIMING_MODES = new Set(["loop", "interval", "custom"]);
const VALID_MARQUEE_POSITIONS = new Set(["bottom", "top"]);
const VALID_WATERMARK_POSITIONS = new Set([
  "above-ticker",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);
const VALID_ANTI_THEFT_SIZES = new Set(["small", "medium", "large"]);

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

const DEFAULT_GLOBAL_CORNER_MASK_SETTINGS = Object.freeze({
  enableCornerMask: false,
  cornerMaskText: "«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»",
  cornerMaskStyle: "badge",
  cornerMaskPosition: "top-right",
  cornerMaskWidth: 220,
  cornerMaskHeight: 54,
  cornerMaskOpacity: 0.95,
});

const DEFAULT_GLOBAL_SPONSOR_SETTINGS = Object.freeze({
  enableSponsor: false,
  sponsorVideoUrl: null,
  sponsorVideoPath: null,
  sponsorChromaKey: true,
  sponsorChromaSimilarity: 0.28,
  sponsorPosition: "bottom-left",
  sponsorXPercent: null,
  sponsorYPercent: null,
  sponsorTimingMode: "loop",
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

const DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS = Object.freeze({
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
  antiTheftBottomPercent: null,
});

const DEFAULT_GLOBAL_OVERLAY_SETTINGS = Object.freeze({
  ...DEFAULT_GLOBAL_LOGO_SETTINGS,
  ...DEFAULT_GLOBAL_CORNER_MASK_SETTINGS,
  ...DEFAULT_GLOBAL_SPONSOR_SETTINGS,
  ...DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS,
});

function getDefaultOverlayStoragePath() {
  return path.join(uploadsDir, "cache", "global_overlay_settings.json");
}

function getLegacyLogoStoragePath() {
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
    const fallbackX =
      typeof base.logoXPercent === "number" && Number.isFinite(base.logoXPercent)
        ? base.logoXPercent
        : 50;
    const fallbackY =
      typeof base.logoYPercent === "number" && Number.isFinite(base.logoYPercent)
        ? base.logoYPercent
        : 50;
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

function normalizeGlobalOverlaySettings(input, fallback = DEFAULT_GLOBAL_OVERLAY_SETTINGS) {
  const base =
    fallback && typeof fallback === "object"
      ? { ...DEFAULT_GLOBAL_OVERLAY_SETTINGS, ...fallback }
      : DEFAULT_GLOBAL_OVERLAY_SETTINGS;
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  // 1. Logo family (normalize using dedicated logo normalizer, ignoring unrelated alias keys)
  const logoSlice = {};
  for (const k of LOGO_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) {
      logoSlice[k] = src[k];
    }
  }
  const logoNormalized = normalizeGlobalLogoSettings(logoSlice, base);

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
    typeof src.cornerMaskStyle === "string" && VALID_CORNER_MASK_STYLES.has(src.cornerMaskStyle)
      ? src.cornerMaskStyle
      : VALID_CORNER_MASK_STYLES.has(base.cornerMaskStyle)
        ? base.cornerMaskStyle
        : DEFAULT_GLOBAL_CORNER_MASK_SETTINGS.cornerMaskStyle;
  const cornerMaskPosition =
    typeof src.cornerMaskPosition === "string" &&
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
      : typeof src.sponsorVideoUrl === "string" && src.sponsorVideoUrl.trim()
        ? src.sponsorVideoUrl.trim()
        : base.sponsorVideoUrl ?? null;
  const sponsorVideoPath =
    src.sponsorVideoPath === null
      ? null
      : typeof src.sponsorVideoPath === "string" && src.sponsorVideoPath.trim()
        ? src.sponsorVideoPath.trim()
        : base.sponsorVideoPath ?? null;
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
    typeof src.sponsorPosition === "string" && VALID_SPONSOR_POSITIONS.has(src.sponsorPosition)
      ? src.sponsorPosition
      : VALID_SPONSOR_POSITIONS.has(base.sponsorPosition)
        ? base.sponsorPosition
        : DEFAULT_GLOBAL_SPONSOR_SETTINGS.sponsorPosition;

  let sponsorXPercent = null;
  let sponsorYPercent = null;
  if (sponsorPosition === "custom") {
    const fallbackSX =
      typeof base.sponsorXPercent === "number" && Number.isFinite(base.sponsorXPercent)
        ? base.sponsorXPercent
        : 50;
    const fallbackSY =
      typeof base.sponsorYPercent === "number" && Number.isFinite(base.sponsorYPercent)
        ? base.sponsorYPercent
        : 50;
    sponsorXPercent = Math.round(clampNumber(src.sponsorXPercent, 0, 100, fallbackSX) * 10) / 10;
    sponsorYPercent = Math.round(clampNumber(src.sponsorYPercent, 0, 100, fallbackSY) * 10) / 10;
  }

  const sponsorTimingMode =
    typeof src.sponsorTimingMode === "string" &&
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
      : base.marqueeSpeed ?? DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.marqueeSpeed;
  const marqueePosition =
    typeof src.marqueePosition === "string" && VALID_MARQUEE_POSITIONS.has(src.marqueePosition)
      ? src.marqueePosition
      : VALID_MARQUEE_POSITIONS.has(base.marqueePosition)
        ? base.marqueePosition
        : DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.marqueePosition;
  const marqueeTextColor =
    typeof src.marqueeTextColor === "string" && src.marqueeTextColor.trim()
      ? src.marqueeTextColor.trim()
      : base.marqueeTextColor || DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.marqueeTextColor;
  const enableWatermark =
    src.enableWatermark !== undefined
      ? Boolean(src.enableWatermark)
      : base.enableWatermark !== false;
  const watermarkText =
    src.watermarkText !== undefined && src.watermarkText !== null
      ? String(src.watermarkText)
      : String(base.watermarkText ?? DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.watermarkText);
  const watermarkPosition =
    typeof src.watermarkPosition === "string" &&
    VALID_WATERMARK_POSITIONS.has(src.watermarkPosition)
      ? src.watermarkPosition
      : VALID_WATERMARK_POSITIONS.has(base.watermarkPosition)
        ? base.watermarkPosition
        : DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.watermarkPosition;
  const watermarkColor =
    typeof src.watermarkColor === "string" && src.watermarkColor.trim()
      ? src.watermarkColor.trim()
      : base.watermarkColor || DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.watermarkColor;
  const antiTheftSize =
    typeof src.antiTheftSize === "string" && VALID_ANTI_THEFT_SIZES.has(src.antiTheftSize)
      ? src.antiTheftSize
      : VALID_ANTI_THEFT_SIZES.has(base.antiTheftSize)
        ? base.antiTheftSize
        : DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS.antiTheftSize;

  let antiTheftBottomPercent = null;
  const rawBottomPct =
    src.antiTheftBottomPercent !== undefined
      ? src.antiTheftBottomPercent
      : base.antiTheftBottomPercent;
  if (rawBottomPct !== null && rawBottomPct !== undefined && rawBottomPct !== "") {
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

function stripGlobalOverlaySettingsFromObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
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

function readGlobalOverlaySettings(storagePath = getDefaultOverlayStoragePath()) {
  try {
    if (fs.existsSync(storagePath)) {
      const raw = fs.readFileSync(storagePath, "utf8");
      const parsed = JSON.parse(raw);
      const payload = parsed?.overlaySettings || parsed?.settings || parsed?.logoSettings || parsed;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return {
          initialized: true,
          overlaySettings: normalizeGlobalOverlaySettings(payload),
          updatedAt: Number(parsed?.updatedAt) || 0,
        };
      }
    }
  } catch (_) {}

  // Not yet initialized as unified overlay store; check if legacy logo-only file exists for partial seed hint
  let legacyLogoSettings = null;
  try {
    const legacyPath =
      storagePath === getDefaultOverlayStoragePath() ? getLegacyLogoStoragePath() : null;
    if (legacyPath && fs.existsSync(legacyPath)) {
      const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      const logoPayload = parsed?.logoSettings || parsed?.settings || parsed;
      if (logoPayload && typeof logoPayload === "object" && !Array.isArray(logoPayload)) {
        legacyLogoSettings = normalizeGlobalLogoSettings(logoPayload);
      }
    }
  } catch (_) {}

  return {
    initialized: false,
    overlaySettings: null,
    legacyLogoSettings,
    updatedAt: 0,
  };
}

function writeGlobalOverlaySettings(input, options = {}) {
  const storagePath = options.storagePath || getDefaultOverlayStoragePath();
  const incomingUpdatedAt = Number(options.updatedAt) || Date.now();
  const existing = readGlobalOverlaySettings(storagePath);
  if (existing.initialized && existing.updatedAt > incomingUpdatedAt) {
    return existing;
  }
  const base = existing.initialized && existing.overlaySettings
    ? existing.overlaySettings
    : existing.legacyLogoSettings
      ? { ...DEFAULT_GLOBAL_OVERLAY_SETTINGS, ...existing.legacyLogoSettings }
      : DEFAULT_GLOBAL_OVERLAY_SETTINGS;
  const normalized = normalizeGlobalOverlaySettings(input, base);
  const updatedAt = incomingUpdatedAt;

  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const envelope = {
    version: 2,
    updatedAt,
    overlaySettings: normalized,
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
    overlaySettings: normalized,
    updatedAt,
  };
}

function getEffectiveOverlaySettings(storagePath = getDefaultOverlayStoragePath()) {
  const stored = readGlobalOverlaySettings(storagePath);
  if (stored.initialized && stored.overlaySettings) {
    return stored.overlaySettings;
  }
  if (stored.legacyLogoSettings) {
    return normalizeGlobalOverlaySettings(stored.legacyLogoSettings, DEFAULT_GLOBAL_OVERLAY_SETTINGS);
  }
  return { ...DEFAULT_GLOBAL_OVERLAY_SETTINGS };
}

function formatGlobalLogoSettingsForExport(settings) {
  const normalized = normalizeGlobalLogoSettings(settings);
  const isCustomOrCenter =
    normalized.logoPosition === "custom" || normalized.logoPosition === "center";
  return {
    enabled: Boolean(normalized.enableLogo),
    image: normalized.logoImage,
    position: normalized.logoPosition,
    size: normalized.logoSize,
    opacity: normalized.logoOpacity,
    shape: normalized.logoShape,
    margin: normalized.logoMargin,
    ...(isCustomOrCenter &&
    typeof normalized.logoXPercent === "number" &&
    typeof normalized.logoYPercent === "number"
      ? {
          logoXPercent: normalized.logoXPercent,
          logoYPercent: normalized.logoYPercent,
        }
      : {}),
  };
}

function formatGlobalCornerMaskForExport(settings) {
  const normalized = normalizeGlobalOverlaySettings(settings);
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

function formatGlobalSponsorForExport(settings) {
  const normalized = normalizeGlobalOverlaySettings(settings);
  const isCustom = normalized.sponsorPosition === "custom";
  const sx = isCustom && typeof normalized.sponsorXPercent === "number" ? normalized.sponsorXPercent : null;
  const sy = isCustom && typeof normalized.sponsorYPercent === "number" ? normalized.sponsorYPercent : null;
  return {
    enabled: Boolean(normalized.enableSponsor),
    enableSponsor: Boolean(normalized.enableSponsor),
    sponsorVideoUrl: normalized.sponsorVideoUrl,
    sponsorVideoPath: normalized.sponsorVideoPath,
    videoUrl: normalized.sponsorVideoUrl,
    videoPath: normalized.sponsorVideoPath,
    position: normalized.sponsorPosition,
    sponsorXPercent: sx,
    sponsorYPercent: sy,
    xPercent: sx,
    yPercent: sy,
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

function formatGlobalAntiTheftForExport(settings) {
  const normalized = normalizeGlobalOverlaySettings(settings);
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
    ...(typeof normalized.antiTheftBottomPercent === "number"
      ? { antiTheftBottomPercent: normalized.antiTheftBottomPercent }
      : {}),
  };
}

function getEffectiveGlobalLogoSettingsForExport(storagePath = getDefaultOverlayStoragePath()) {
  return formatGlobalLogoSettingsForExport(getEffectiveOverlaySettings(storagePath));
}

function getEffectiveGlobalCornerMaskForExport(storagePath = getDefaultOverlayStoragePath()) {
  return formatGlobalCornerMaskForExport(getEffectiveOverlaySettings(storagePath));
}

function getEffectiveGlobalSponsorForExport(storagePath = getDefaultOverlayStoragePath()) {
  return formatGlobalSponsorForExport(getEffectiveOverlaySettings(storagePath));
}

function getEffectiveGlobalAntiTheftForExport(storagePath = getDefaultOverlayStoragePath()) {
  return formatGlobalAntiTheftForExport(getEffectiveOverlaySettings(storagePath));
}

module.exports = {
  LOGO_SETTING_KEYS,
  CORNER_MASK_SETTING_KEYS,
  SPONSOR_SETTING_KEYS,
  ANTI_THEFT_SETTING_KEYS,
  GLOBAL_OVERLAY_SETTING_KEYS,
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  DEFAULT_GLOBAL_CORNER_MASK_SETTINGS,
  DEFAULT_GLOBAL_SPONSOR_SETTINGS,
  DEFAULT_GLOBAL_ANTI_THEFT_SETTINGS,
  DEFAULT_GLOBAL_OVERLAY_SETTINGS,
  getDefaultOverlayStoragePath,
  getLegacyLogoStoragePath,
  normalizeGlobalLogoSettings,
  normalizeGlobalOverlaySettings,
  stripGlobalOverlaySettingsFromObject,
  readGlobalOverlaySettings,
  writeGlobalOverlaySettings,
  getEffectiveOverlaySettings,
  formatGlobalLogoSettingsForExport,
  formatGlobalCornerMaskForExport,
  formatGlobalSponsorForExport,
  formatGlobalAntiTheftForExport,
  getEffectiveGlobalLogoSettingsForExport,
  getEffectiveGlobalCornerMaskForExport,
  getEffectiveGlobalSponsorForExport,
  getEffectiveGlobalAntiTheftForExport,
};
