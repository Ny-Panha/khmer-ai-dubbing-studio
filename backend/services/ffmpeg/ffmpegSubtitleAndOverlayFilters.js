const path = require("path");
const fs = require("fs");
const { buildDynamicVerticalCropXExpr } = require("../smartReframeService");
const { parseTimeToSec, toSrtTime } = require("../../models/timestampUtils");
const { getSafeCliPath } = require("./ffmpegProbeAndFrames");


function hexToAssColor(hexColor = "#FFFFFF", alphaHex = "00") {
  const cleanHex = String(hexColor).replace("#", "").trim();
  if (cleanHex.length !== 6) return `&H${alphaHex}FFFFFF`;

  const r = cleanHex.substring(0, 2).toUpperCase();
  const g = cleanHex.substring(2, 4).toUpperCase();
  const b = cleanHex.substring(4, 6).toUpperCase();

  return `&H${alphaHex}${b}${g}${r}`;
}

function formatSecondsToAssTime(seconds) {
  const safeSec = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = Math.floor(safeSec % 60);
  const centisecs = Math.round((safeSec - Math.floor(safeSec)) * 100);

  if (centisecs === 100) {
    return formatSecondsToAssTime(Math.floor(safeSec) + 1);
  }

  return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centisecs).padStart(2, "0")}`;
}

function sanitizeKhmerSubtitleText(text = "") {
  return String(text)
    .normalize("NFC")
    .replace(/\r?\n/g, "\\N")
    .replace(/[{}]/g, "")
    .trim();
}

const SUBTITLE_SIZE_SCALE_MAP = {
  small: 0.8,
  medium: 1.0,
  large: 1.25,
};

function resolveRenderAspectRatio(requestedRatio, sourceDimensions) {
  if (requestedRatio) return requestedRatio;
  if (!sourceDimensions?.width || !sourceDimensions?.height) {
    console.warn("[FFmpegService] Source dimensions missing, falling back to 16:9 aspectRatio");
    return "16:9";
  }
  if (sourceDimensions.height > sourceDimensions.width) return "9:16";
  return sourceDimensions.height === sourceDimensions.width ? "1:1" : "16:9";
}

function resolveAssSubtitleLayoutDefaults({
  aspectRatio = "16:9",
  verticalStyle = "pad",
  sourceDimensions = null,
} = {}) {
  if (aspectRatio === "9:16") {
    const isSourcePortrait = Boolean(
      sourceDimensions && Number(sourceDimensions.height) > Number(sourceDimensions.width)
    );
    const isCropOrPortrait = verticalStyle === "crop" || isSourcePortrait;
    return {
      playResX: 1080,
      playResY: 1920,
      defaultFontSize: isCropOrPortrait ? 64 : 68,
    };
  }
  if (aspectRatio === "1:1") {
    return {
      playResX: 1080,
      playResY: 1080,
      defaultFontSize: 64,
    };
  }
  return {
    playResX: 1920,
    playResY: 1080,
    defaultFontSize: 64,
  };
}

function generateKhmerAssSubtitleFile({
  segments = [],
  outputPath,
  fontName = "Khmer OS Battambang",
  fontSize = null,
  subtitleSize = null,
  textColor = "#FFFFFF",
  outlineColor = "#000000",
  subtitleStyle = "banner",
  marginV = null,
  aspectRatio = "16:9",
  verticalStyle = "pad",
  antiTheft = null,
  cornerMask = null,
  totalDuration = null,
  sourceDimensions = null,
}) {
  const layoutDefaults = resolveAssSubtitleLayoutDefaults({
    aspectRatio,
    verticalStyle,
    sourceDimensions,
  });
  const playResX = layoutDefaults.playResX;
  const playResY = layoutDefaults.playResY;
  const explicitFontSize = Number(fontSize);
  const preset = String(subtitleSize ?? "").trim().toLowerCase();
  let effFontSize = layoutDefaults.defaultFontSize;
  let sizeLabel = "null";
  if (Number.isFinite(explicitFontSize) && explicitFontSize > 0) {
    effFontSize = explicitFontSize;
    sizeLabel = "explicit";
  } else if (Object.hasOwn(SUBTITLE_SIZE_SCALE_MAP, preset)) {
    effFontSize = Math.round(effFontSize * SUBTITLE_SIZE_SCALE_MAP[preset]);
    sizeLabel = preset;
  }
  let effMarginV = marginV;

  const isAntiTheftActive = Boolean(antiTheft && (antiTheft.enabled || antiTheft.enableAntiTheft));
  const marqueePos = antiTheft?.marqueePosition || antiTheft?.position || "bottom";

  // កំណត់គម្លាតស្វ័យប្រវត្តិតាមទម្រង់វីដេអូ ឱ្យត្រូវគ្នា 1:1 ជាមួយ Live Preview (bottom: 7.5% និង 36.5% letterbox)
  if (aspectRatio === "9:16") {
    const isSourcePortrait = Boolean(sourceDimensions && sourceDimensions.height > sourceDimensions.width);
    if (verticalStyle === "crop" || isSourcePortrait) {
      // Full-bleed 9:16 crop or naturally vertical video: matches Live Preview bottom: 7.5% (144px on 1920p)
      effMarginV = marginV || Math.round(playResY * 0.075);
    } else {
      // Pad mode with landscape source: matches Live Preview bottom: 36.5% (701px on 1920p)
      effMarginV = marginV || Math.round(playResY * 0.365);
    }
  } else if (aspectRatio === "1:1") {
    effMarginV = marginV || Math.round(playResY * 0.075);
  } else {
    // 16:9 YouTube Landscape: matches Live Preview bottom: 7.5% (81px on 1080p)
    effMarginV = marginV || Math.round(playResY * 0.075);
  }

  const primaryAssColor = hexToAssColor(textColor, "00");
  let outlineAssColor = hexToAssColor(outlineColor, "00");
  const shadowAssColor = "&H80000000";

  let borderStyle = 3;
  let outlineWidth = aspectRatio === "9:16" ? 12 : 10;
  let shadowWidth = 0;
  let backBoxColor = "&H3208080c"; // 80% opacity dark glass (rgba 0,0,0,0.80) matching Web Preview

  if (subtitleStyle === "cinema-soft" || subtitleStyle === "soft" || subtitleStyle === "clean" || subtitleStyle === "cinema") {
    borderStyle = 1;
    outlineWidth = 3.5;
    shadowWidth = 2;
    backBoxColor = "&H80000000";
  } else if (subtitleStyle === "glow") {
    borderStyle = 1;
    outlineWidth = 5;
    shadowWidth = 2;
    backBoxColor = "&H60000000";
  } else if (subtitleStyle === "pill") {
    borderStyle = 3;
    outlineWidth = 6;
    shadowWidth = 0;
    backBoxColor = "&H6408080c";
    outlineAssColor = hexToAssColor(outlineColor, "64");
  } else {
    // "banner" (default) — solid dark box that cleanly covers burned-in source subtitles
    borderStyle = 3;
    outlineWidth = aspectRatio === "9:16" ? 12 : 10;
    shadowWidth = 0;
    backBoxColor = "&H3208080c";
  }

  let antiTheftStyles = "";
  const antiTheftEvents = [];

  if (isAntiTheftActive) {
    const marqueeColorHex = antiTheft.marqueeTextColor || antiTheft.textColor || "#FFE600";
    const marqueeAssColor = hexToAssColor(marqueeColorHex, "00");
    const watermarkColorHex = antiTheft.watermarkColor || "#38BDF8";
    const watermarkAssColor = hexToAssColor(watermarkColorHex, "00");

    const antiTheftLayout = computeAntiTheftRibbonLayout({
      antiTheft,
      aspectRatio,
      verticalStyle,
      sourceDimensions,
    });
    const {
      ribbonH,
      ribbonY,
      marqueeFontSize,
      watermarkFontSize,
      textY,
      watermarkY,
    } = antiTheftLayout;
    const antiTheftBgStyle = String(antiTheft.bgStyle || antiTheft.antiTheftBgStyle || "dark").toLowerCase();

    antiTheftStyles = `
Style: AntiTheftRibbon,${fontName},10,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: AntiTheftMarquee,${fontName},${marqueeFontSize},${marqueeAssColor},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1,4,0,0,0,1
Style: AntiTheftWatermark,${fontName},${watermarkFontSize},${watermarkAssColor},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1.2,2,0,0,0,1`;

    // Calculate effective total duration in seconds
    let maxTimeSec = Number(totalDuration) || 0;
    if (maxTimeSec <= 0 && segments.length > 0) {
      segments.forEach((seg) => {
        const s = Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? parseTimeToSec(seg.start, 0));
        const d = Number(seg.audioDuration ?? seg.duration ?? seg.audioDurationSec ?? 2.5);
        if (s + d > maxTimeSec) maxTimeSec = s + d;
      });
    }
    if (maxTimeSec <= 0) maxTimeSec = 3600; // 1 hr default
    maxTimeSec += 2; // small safety padding

    const totalEndAss = formatSecondsToAssTime(maxTimeSec);

    // 1. Background Ribbon (Layer 1):
    // - 'blur': Skip ASS dark box so pure FFmpeg Gaussian blur strip shows cleanly behind crisp running title!
    // - 'solid': 100% opaque pure black (#000000, alpha 00, no border) to completely hide original subtitles.
    // - 'dark' (default): Semi-transparent dark ribbon.
    if (antiTheftBgStyle === "solid") {
      antiTheftEvents.push(
        `Dialogue: 1,0:00:00.00,${totalEndAss},AntiTheftRibbon,,0,0,0,,{\\p1\\c&H000000&\\1a&H00&\\bord0\\shad0\\pos(0,${ribbonY})}m 0 0 l ${playResX} 0 l ${playResX} ${ribbonH} l 0 ${ribbonH}{\\p0}`
      );
    } else if (antiTheftBgStyle !== "blur") {
      antiTheftEvents.push(
        `Dialogue: 1,0:00:00.00,${totalEndAss},AntiTheftRibbon,,0,0,0,,{\\p1\\c&H161618&\\1a&H12&\\bord1.5\\3c&H505058&\\shad0\\pos(0,${ribbonY})}m 0 0 l ${playResX} 0 l ${playResX} ${ribbonH} l 0 ${ribbonH}{\\p0}`
      );
    }

    // 2. Static Copyright Watermark Badge (Layer 2)
    const hasWatermark = antiTheft.enableWatermark !== false;
    const rawWmText =
      antiTheft.watermarkText !== undefined && antiTheft.watermarkText !== null
        ? String(antiTheft.watermarkText)
        : "រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama";
    if (hasWatermark && rawWmText.trim()) {
      const cleanWmText = sanitizeKhmerSubtitleText(rawWmText);
      const wmPos = antiTheft.watermarkPosition || "above-ticker";
      let posTag = `\\pos(${Math.round(playResX / 2)},${watermarkY})\\an2`;
      if (wmPos === "top-right") {
        posTag = `\\pos(${playResX - 50},${aspectRatio === "9:16" ? 140 : 50})\\an9`;
      } else if (wmPos === "top-left") {
        posTag = `\\pos(50,${aspectRatio === "9:16" ? 140 : 50})\\an7`;
      }
      antiTheftEvents.push(
        `Dialogue: 2,0:00:00.00,${totalEndAss},AntiTheftWatermark,,0,0,0,,{${posTag}\\fad(300,300)}${cleanWmText}`
      );
    }

    // 3. Continuous Running Marquee Ticker (Layer 3 — skipped when marqueeText is intentionally empty "")
    const rawMarquee =
      antiTheft.marqueeText !== undefined && antiTheft.marqueeText !== null
        ? String(antiTheft.marqueeText)
        : "«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»";
    const cleanMarquee = rawMarquee.trim() ? sanitizeKhmerSubtitleText(rawMarquee).trim() : "";
    if (cleanMarquee) {
      const repeatedMarquee = `${cleanMarquee}       ❖       ${cleanMarquee}       ❖       ${cleanMarquee}`;

      const speed = antiTheft.marqueeSpeed || "normal";
      const parsedSpeed = parseFloat(speed);
      const cycleDuration = (!isNaN(parsedSpeed) && parsedSpeed > 0)
        ? parsedSpeed
        : (speed === "fast" ? 9 : (speed === "slow" ? 20 : 13));

      const startX = playResX + 80;
      const estTextWidth = Math.max(playResX, repeatedMarquee.length * marqueeFontSize * 0.65);
      const endX = -Math.round(estTextWidth + 120);

      let t = 0;
      while (t < maxTimeSec) {
        const tStartAss = formatSecondsToAssTime(t);
        const tEndAss = formatSecondsToAssTime(Math.min(maxTimeSec, t + cycleDuration));
        antiTheftEvents.push(
          `Dialogue: 3,${tStartAss},${tEndAss},AntiTheftMarquee,,0,0,0,,{\\q2\\an4\\move(${startX},${textY},${endX},${textY})}${repeatedMarquee}`
        );
        t += cycleDuration;
      }
    }
  }

  // 🛡️ Corner Blocker / Disclaimer Mask Events & Styles (Badge / Solid Black via ASS; Real Blur uses FFmpeg video filtergraph)
  let cornerMaskStyles = "";
  const cornerMaskEvents = [];
  const rawCornerMaskStyle = String(cornerMask?.style || "badge").toLowerCase();
  const isCornerMaskActive = Boolean(
    cornerMask &&
    (cornerMask.enabled || cornerMask.enableCornerMask) &&
    rawCornerMaskStyle !== "blur"
  );
  if (isCornerMaskActive) {
    let maxTimeSec = Number(totalDuration) || 0;
    if (maxTimeSec <= 0 && segments.length > 0) {
      segments.forEach((seg) => {
        const s = Number(seg.startSeconds ?? seg.startSec ?? seg.audioStartSec ?? parseTimeToSec(seg.start, 0));
        const d = Number(seg.audioDuration ?? seg.duration ?? seg.audioDurationSec ?? 2.5);
        if (s + d > maxTimeSec) maxTimeSec = s + d;
      });
    }
    if (maxTimeSec <= 0) maxTimeSec = 3600;
    maxTimeSec += 2;
    const totalEndAss = formatSecondsToAssTime(maxTimeSec);

    const baseW = Math.max(60, Math.min(500, Number(cornerMask.width) || 220));
    const baseH = Math.max(20, Math.min(200, Number(cornerMask.height) || 54));
    const rawOffsetX = cornerMask.offsetX ?? cornerMask.cornerMaskOffsetX;
    const rawOffsetY = cornerMask.offsetY ?? cornerMask.cornerMaskOffsetY;
    const baseOffX = Math.max(0, Math.min(200, Number.isFinite(Number(rawOffsetX)) ? Number(rawOffsetX) : 14));
    const baseOffY = Math.max(0, Math.min(200, Number.isFinite(Number(rawOffsetY)) ? Number(rawOffsetY) : 14));
    const scale = playResX / 1000;
    const maskW = Math.round(baseW * scale);
    const maskH = Math.round(baseH * scale);
    const offX = Math.round(baseOffX * scale);
    const offY = Math.round(baseOffY * scale);
    const maskPos = cornerMask.position || "top-right";
    const maskStyle = rawCornerMaskStyle;
    const maskText = cornerMask.text ?? "«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»";
    const is916Letterbox = aspectRatio === "9:16" && verticalStyle !== "crop";
    const letterboxTopY = Math.round(playResY * 0.342);
    const hasCustomCoords =
      maskPos === "custom" &&
      Number.isFinite(Number(cornerMask.cornerMaskXPercent ?? cornerMask.xPercent)) &&
      Number.isFinite(Number(cornerMask.cornerMaskYPercent ?? cornerMask.yPercent));

    let maskX = Math.max(0, playResX - maskW - offX);
    let maskY = is916Letterbox ? (letterboxTopY + offY) : offY;

    if (hasCustomCoords) {
      const xPct = Math.max(0, Math.min(100, Number(cornerMask.cornerMaskXPercent ?? cornerMask.xPercent))) / 100;
      const yPct = Math.max(0, Math.min(100, Number(cornerMask.cornerMaskYPercent ?? cornerMask.yPercent))) / 100;
      maskX = Math.round(Math.max(0, playResX - maskW) * xPct);
      maskY = Math.round(Math.max(0, playResY - maskH) * yPct);
    } else if (maskPos === "top-left") {
      maskX = offX;
      maskY = is916Letterbox ? (letterboxTopY + offY) : offY;
    } else if (maskPos === "bottom-right") {
      maskX = Math.max(0, playResX - maskW - offX);
      maskY = is916Letterbox ? Math.max(0, playResY - letterboxTopY - maskH - offY) : Math.max(0, playResY - maskH - offY);
    } else if (maskPos === "bottom-left") {
      maskX = offX;
      maskY = is916Letterbox ? Math.max(0, playResY - letterboxTopY - maskH - offY) : Math.max(0, playResY - maskH - offY);
    }

    const textFontSize = Math.max(16, Math.round(maskH * 0.28));
    cornerMaskStyles = `
Style: CornerMaskBox,${fontName},10,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: CornerMaskText,${fontName},${textFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,5,0,0,0,1`;

    const isSolid = maskStyle === "solid";
    const boxColor = isSolid ? "000000" : "121216";
    const boxAlpha = isSolid ? "00" : "18";
    const boxBorder = isSolid ? "\\bord0" : "\\bord1.5\\3c&H404050&";
    cornerMaskEvents.push(
      `Dialogue: 1,0:00:00.00,${totalEndAss},CornerMaskBox,,0,0,0,,{\\p1\\c&H${boxColor}&\\1a&H${boxAlpha}&${boxBorder}\\shad0\\pos(${maskX},${maskY})}m 0 0 l ${maskW} 0 l ${maskW} ${maskH} l 0 ${maskH}{\\p0}`
    );

    if (maskText && maskText.trim()) {
      const cleanMaskText = sanitizeKhmerSubtitleText(maskText);
      const textCenterX = maskX + Math.round(maskW / 2);
      const textCenterY = maskY + Math.round(maskH / 2);
      cornerMaskEvents.push(
        `Dialogue: 2,0:00:00.00,${totalEndAss},CornerMaskText,,0,0,0,,{\\pos(${textCenterX},${textCenterY})\\an5}${cleanMaskText}`
      );
    }
  }

  const assHeader = `[Script Info]
Title: Khmer AI Dubbing Studio Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${effFontSize},${primaryAssColor},&H000000FF,${outlineAssColor},${backBoxColor},-1,0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadowWidth},2,60,60,${effMarginV},1${antiTheftStyles}${cornerMaskStyles}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogueLines = segments
    .filter((seg) => (seg.khmerText || seg.khmer) && String(seg.khmerText || seg.khmer).trim().length > 0)
    .map((seg) => {
      const hasVoice = Boolean(
        seg.audioUrl || seg.audioPath || seg.rawAudioPath || seg.audioFile || seg.rawAudioFile ||
        seg.ttsStatus === "ready" || seg.status === "audio_ready" ||
        (typeof seg.finalAudioDuration === "number" && seg.finalAudioDuration > 0) ||
        (typeof seg.audioDuration === "number" && seg.audioDuration > 0) ||
        (typeof seg.audioDurationSec === "number" && seg.audioDurationSec > 0)
      );

      const startSec = Number(
        (hasVoice && seg.audioStartSec !== undefined && seg.audioStartSec !== null && !isNaN(Number(seg.audioStartSec)))
          ? seg.audioStartSec
          : (seg.startSec ?? seg.startSeconds ?? parseTimeToSec(seg.start, 0))
      );

      const realAudioDur = hasVoice
        ? (seg.finalAudioDuration ?? seg.audioDurationSec ?? seg.audioDuration ?? seg.originalAudioDuration ?? seg.rawAudioDur)
        : null;

      const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
      let rawDur;
      if (isTrimmed && typeof seg.audioEndSec === "number" && !isNaN(seg.audioEndSec)) {
        rawDur = seg.audioEndSec - startSec;
      } else if (realAudioDur && !isNaN(realAudioDur) && realAudioDur > 0) {
        rawDur = Number(realAudioDur);
      } else {
        rawDur = Number(seg.duration ?? (seg.endSec ? seg.endSec - startSec : (seg.endSeconds ? seg.endSeconds - startSec : 2.5)));
      }

      // Match voice clip timing: when voice is present, end right when speech ends (with minimal min clamp for ultra-short clips)
      const safeDuration = (!rawDur || isNaN(rawDur) || rawDur <= 0.1)
        ? Math.max(1.2, Math.min(5.0, String(seg.khmerText || seg.khmer || "").length * 0.16))
        : rawDur;
      const endSec = startSec + safeDuration;

      const startAss = formatSecondsToAssTime(startSec);
      const endAss = formatSecondsToAssTime(endSec);
      const cleanText = sanitizeKhmerSubtitleText(seg.khmerText || seg.khmer);
      const speakerName = String(seg.speaker || seg.speakerName || "Speaker").replace(/,/g, " ");

      return `Dialogue: 0,${startAss},${endAss},Default,${speakerName},0,0,0,,{\\fad(0,0)}${cleanText}`;
    });

  const allEvents = [...antiTheftEvents, ...cornerMaskEvents, ...dialogueLines];
  const fullAssContent = assHeader + allEvents.join("\n") + "\n";

  fs.writeFileSync(outputPath, "\uFEFF" + fullAssContent, "utf8");
  console.log(
    `🎬 ASS burn: style=${subtitleStyle} color=${textColor} fontSize=${effFontSize} (size=${sizeLabel}) playRes=${playResX}x${playResY}`
  );
  console.log(`[FFmpegService] 📝 បានបង្កើត File Subtitle ខ្មែរ (.ass)៖ ${path.basename(outputPath)} (Anti-theft: ${isAntiTheftActive ? 'Active' : 'Off'}, Corner-mask: ${isCornerMaskActive ? 'Active' : 'Off'})`);

  return outputPath;
}

function buildAssSubtitleVideoFilter(assFilePath, customFontsDir = null) {
  const safeAssPath = getSafeCliPath(assFilePath);
  const escapeFfmpegPath = (p) =>
    path
      .resolve(p)
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");

  const escapedAss = escapeFfmpegPath(safeAssPath);
  const defaultFontsDir =
    customFontsDir || path.join(__dirname, "..", "..", "assets", "fonts");

  if (fs.existsSync(defaultFontsDir)) {
    const escapedFontsDir = escapeFfmpegPath(getSafeCliPath(defaultFontsDir));
    return `ass=filename='${escapedAss}':fontsdir='${escapedFontsDir}'`;
  }

  return `ass=filename='${escapedAss}'`;
}

// ============================================================================
// ផ្នែកទី 4: SMART AUDIO DUCKING (85%) + ADELAY MIX + VIDEO RENDER
// ============================================================================


/**
 * Builds the FFmpeg filter_complex chain for 9:16 vertical output (1080x1920).
 * When blurSubtitleBand is enabled (9:16 crop or native portrait with burned Khmer captions),
 * blurs and slightly darkens the bottom source subtitle band BEFORE ASS subtitle burning
 * so source burned-in Chinese captions are unreadable soft shapes beneath Khmer text.
 */
function buildVerticalVideoFilterChain({
  inputLabel = "[0:v:0]",
  outputLabel = "[final_video]",
  verticalStyle = "pad",
  blurSubtitleBand = false,
  blurBandY = 1592,
  blurRadius = 24,
  blurPower = 2,
  darkenBrightness = -0.08,
  segments = [],
  framingOverrides = [],
  framingKeyframes = [],
} = {}) {
  const isCrop = verticalStyle === "crop";
  const rawCropX = isCrop ? buildDynamicVerticalCropXExpr(segments, 1080, framingOverrides, framingKeyframes) : "(in_w-1080)/2";
  const cropXExpr = (rawCropX && rawCropX.startsWith("'") && rawCropX.endsWith("'"))
    ? rawCropX
    : (rawCropX && rawCropX.includes("between") ? `'${rawCropX}'` : (rawCropX || "(in_w-1080)/2"));
  const baseScaleFilter = isCrop
    ? `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:${cropXExpr}:(in_h-1920)/2,setsar=1`
    : "scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(1080-iw)/2:(1920-ih)/2:color=black,setsar=1";

  if (!blurSubtitleBand) {
    return [`${inputLabel}${baseScaleFilter}${outputLabel}`];
  }

  // Align Y and strip height to even integers for yuv420p and clamp chroma blur within FFmpeg limits.
  const rawY = Math.round(Number(blurBandY));
  const y = Math.max(0, Math.min(1856, (Number.isFinite(rawY) ? rawY : 1592) & ~1));
  const h = Math.max(16, (1920 - y) & ~1);
  const requestedR = Math.max(2, Math.round(Number(blurRadius) || 24));
  const maxChromaR = Math.max(1, Math.floor(h / 4) - 1);
  const chromaR = Math.min(requestedR, maxChromaR);
  const power = Math.max(1, Math.round(Number(blurPower) || 2));
  const brightness = Number.isFinite(Number(darkenBrightness)) ? Number(darkenBrightness) : -0.08;

  return [
    `${inputLabel}${baseScaleFilter},split[v_vert_main][v_vert_band_src]`,
    `[v_vert_band_src]crop=1080:${h}:0:${y},boxblur=luma_radius=${requestedR}:luma_power=${power}:chroma_radius=${chromaR}:chroma_power=${power},eq=brightness=${brightness.toFixed(2)}[v_vert_sub_blur]`,
    `[v_vert_main][v_vert_sub_blur]overlay=0:${y}${outputLabel}`,
  ];
}

/**
 * Builds a true Gaussian-blur watermark mask filter chain (`split -> crop -> gblur -> overlay`)
 * matching the frontend CornerMaskOverlay preview position, size, offset, and blur strength.
 * Safe across all resolutions and YUV420P chroma dimensions (uses gblur instead of boxblur).
 */
function buildCornerBlurVideoFilterChain({
  inputLabel = "[0:v:0]",
  outputLabel = "[v_corner_blur]",
  cornerMask = null,
  aspectRatio = "16:9",
  verticalStyle = "pad",
} = {}) {
  const baseW = Math.max(60, Math.min(500, Number(cornerMask?.width) || 220));
  const baseH = Math.max(20, Math.min(200, Number(cornerMask?.height) || 54));
  const rawOffX = cornerMask?.offsetX ?? cornerMask?.cornerMaskOffsetX;
  const rawOffY = cornerMask?.offsetY ?? cornerMask?.cornerMaskOffsetY;
  const rawBlur = cornerMask?.blurStrength ?? cornerMask?.cornerMaskBlur;
  const baseOffX = Math.max(0, Math.min(200, Number.isFinite(Number(rawOffX)) ? Number(rawOffX) : 14));
  const baseOffY = Math.max(0, Math.min(200, Number.isFinite(Number(rawOffY)) ? Number(rawOffY) : 14));
  const rawBlurNum = Number.isFinite(Number(rawBlur)) ? Number(rawBlur) : 18;
  // Scale CSS backdrop-filter px (~750px wide preview player) to 1080p video pixels with floor 18 so Chinese watermarks are completely frosted
  const blurSigma = Math.max(18, Math.min(64, Math.round(rawBlurNum * 2.6)));
  const pos = String(cornerMask?.position || "top-right");
  const is916Letterbox = aspectRatio === "9:16" && verticalStyle !== "crop";
  const hasCustomCoords =
    pos === "custom" &&
    Number.isFinite(Number(cornerMask?.cornerMaskXPercent ?? cornerMask?.xPercent)) &&
    Number.isFinite(Number(cornerMask?.cornerMaskYPercent ?? cornerMask?.yPercent));

  // Match Live Preview CSS pixel proportions (~750px wide 16:9 Studio preview canvas -> 1920/750 = 2.56x)
  const previewRefW = 750;
  const wFrac = (baseW / previewRefW).toFixed(4);
  const hFrac = (baseH / previewRefW).toFixed(4);
  const offXFrac = (baseOffX / previewRefW).toFixed(4);
  const offYFrac = (baseOffY / previewRefW).toFixed(4);

  const buildX = (W, w) => {
    if (hasCustomCoords) {
      const xRatio = (Math.max(0, Math.min(100, Number(cornerMask?.cornerMaskXPercent ?? cornerMask?.xPercent))) / 100).toFixed(4);
      return `max(0,min(${W}-${w},trunc((${W}-${w})*${xRatio}/2)*2))`;
    }
    return pos === "top-left" || pos === "bottom-left"
      ? `max(0,min(${W}-${w},trunc(${W}*${offXFrac}/2)*2))`
      : `max(0,min(${W}-${w},${W}-${w}-trunc(${W}*${offXFrac}/2)*2))`;
  };

  const buildY = (W, H, h) => {
    if (hasCustomCoords) {
      const yRatio = (Math.max(0, Math.min(100, Number(cornerMask?.cornerMaskYPercent ?? cornerMask?.yPercent))) / 100).toFixed(4);
      return `max(0,min(${H}-${h},trunc((${H}-${h})*${yRatio}/2)*2))`;
    }
    if (pos === "bottom-left" || pos === "bottom-right") {
      return is916Letterbox
        ? `max(0,min(${H}-${h},trunc(${H}*0.658-${h}-${W}*${offYFrac})))`
        : `max(0,min(${H}-${h},${H}-${h}-trunc(${W}*${offYFrac}/2)*2))`;
    }
    return is916Letterbox
      ? `max(0,min(${H}-${h},trunc(${H}*0.342+${W}*${offYFrac})))`
      : `max(0,min(${H}-${h},trunc(${W}*${offYFrac}/2)*2))`;
  };

  const cropW = `min(iw,max(16,trunc(iw*${wFrac}/2)*2))`;
  const cropH = `min(ih,max(16,trunc(iw*${hFrac}/2)*2))`;
  const cropX = buildX("iw", "ow");
  const cropY = buildY("iw", "ih", "oh");
  const ovX = buildX("W", "w");
  const ovY = buildY("W", "H", "h");

  return [
    `${inputLabel}split[v_cm_bg][v_cm_fg]`,
    `[v_cm_fg]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',gblur=sigma=${blurSigma}:steps=2[v_cm_blurred]`,
    `[v_cm_bg][v_cm_blurred]overlay=x='${ovX}':y='${ovY}':format=auto${outputLabel}`,
  ];
}

/**
 * Shared Anti-Theft Marquee Ribbon geometry calculator used by BOTH ASS subtitle
 * generation and FFmpeg Real Video Blur (`buildAntiTheftBlurVideoFilterChain`)
 * so blurred background strip aligns pixel-exactly with running title text.
 */
function computeAntiTheftRibbonLayout({
  antiTheft = null,
  aspectRatio = "16:9",
  verticalStyle = "pad",
  sourceDimensions = null,
} = {}) {
  const playResX = aspectRatio === "9:16" || aspectRatio === "1:1" ? 1080 : 1920;
  const playResY = aspectRatio === "9:16" ? 1920 : 1080;
  const marqueePos = antiTheft?.marqueePosition || antiTheft?.position || "bottom";
  const antiTheftSize = antiTheft?.antiTheftSize || "small";
  const rawCustomHeight = antiTheft?.antiTheftHeight ?? antiTheft?.ribbonHeight;
  const parsedCustomHeight = Number(rawCustomHeight);
  const customPreviewHeightPx =
    rawCustomHeight !== null && rawCustomHeight !== undefined && rawCustomHeight !== "" &&
      Number.isFinite(parsedCustomHeight) && parsedCustomHeight > 0
      ? Math.max(18, Math.min(120, Math.round(parsedCustomHeight)))
      : null;

  let ribbonH = 56;
  let ribbonY = 1024;
  let marqueeFontSize = 24;
  let watermarkFontSize = 24;
  let textY = ribbonY + 22;
  let watermarkY = ribbonY - 14;

  const applyCustomHeightOverride = () => {
    if (customPreviewHeightPx !== null) {
      // Scale Live Preview CSS px (~422px tall 16:9 canvas -> 1080/422 = 2.56x) to even video px
      ribbonH = Math.max(32, Math.min(360, Math.round(customPreviewHeightPx * 2.56) & ~1));
    }
  };

  if (aspectRatio === "9:16") {
    let vTop = verticalStyle === "crop" ? 0 : 656;
    let vBottom = verticalStyle === "crop" ? 1920 : 1264;
    if (verticalStyle !== "crop" && sourceDimensions && sourceDimensions.width > 0 && sourceDimensions.height > 0) {
      const srcRatio = sourceDimensions.width / sourceDimensions.height;
      let scaledH = Math.round(1080 / srcRatio);
      if (scaledH % 2 !== 0) scaledH += 1;
      scaledH = Math.min(1920, Math.max(300, scaledH));
      vTop = Math.round((1920 - scaledH) / 2);
      vBottom = vTop + scaledH;
    }

    if (antiTheftSize === "xxlarge") {
      ribbonH = 164;
      marqueeFontSize = 42;
      watermarkFontSize = 36;
    } else if (antiTheftSize === "xlarge") {
      ribbonH = 124;
      marqueeFontSize = 38;
      watermarkFontSize = 34;
    } else if (antiTheftSize === "large") {
      ribbonH = 92;
      marqueeFontSize = 36;
      watermarkFontSize = 32;
    } else if (antiTheftSize === "medium") {
      ribbonH = 72;
      marqueeFontSize = 30;
      watermarkFontSize = 28;
    } else {
      ribbonH = 56;
      marqueeFontSize = 26;
      watermarkFontSize = 24;
    }
    applyCustomHeightOverride();

    if (marqueePos === "top") {
      ribbonY = vTop + 8;
      textY = ribbonY + Math.round(ribbonH / 2);
      watermarkY = ribbonY + ribbonH + 24;
    } else {
      const bottomPct = Number(antiTheft?.antiTheftBottomPercent ?? antiTheft?.bottomPercent);
      if (Number.isFinite(bottomPct) && bottomPct >= 0) {
        ribbonY = Math.round(1920 - (1920 * (bottomPct / 100)) - ribbonH);
      } else if (verticalStyle === "crop") {
        ribbonY = Math.round(1592 - ribbonH - 8);
      } else {
        ribbonY = vBottom - ribbonH;
      }
      textY = ribbonY + Math.round(ribbonH / 2);
      watermarkY = ribbonY - 12;
    }
  } else if (aspectRatio === "1:1") {
    if (antiTheftSize === "xxlarge") {
      ribbonH = 156;
      marqueeFontSize = 38;
      watermarkFontSize = 34;
    } else if (antiTheftSize === "xlarge") {
      ribbonH = 118;
      marqueeFontSize = 34;
      watermarkFontSize = 32;
    } else if (antiTheftSize === "large") {
      ribbonH = 88;
      marqueeFontSize = 32;
      watermarkFontSize = 30;
    } else if (antiTheftSize === "medium") {
      ribbonH = 68;
      marqueeFontSize = 28;
      watermarkFontSize = 26;
    } else {
      ribbonH = 54;
      marqueeFontSize = 24;
      watermarkFontSize = 22;
    }
    applyCustomHeightOverride();
    const bottomPct1 = Number(antiTheft?.antiTheftBottomPercent ?? antiTheft?.bottomPercent);
    if (marqueePos === "top") {
      ribbonY = 30;
      textY = ribbonY + Math.round(ribbonH / 2);
      watermarkY = ribbonY + ribbonH + 26;
    } else if (Number.isFinite(bottomPct1) && bottomPct1 >= 0) {
      ribbonY = Math.round(1080 - (1080 * (bottomPct1 / 100)) - ribbonH);
      textY = ribbonY + Math.round(ribbonH / 2);
      watermarkY = ribbonY - 14;
    } else {
      ribbonY = 1080 - ribbonH - 16;
      textY = ribbonY + Math.round(ribbonH / 2);
      watermarkY = ribbonY - 14;
    }
  } else {
    // 16:9 Landscape (1920x1080) — matches ~750x422 Live Preview ribbon height (22/28/36/48/64px -> 56/72/92/124/164px)
    if (antiTheftSize === "xxlarge") {
      ribbonH = 164;
      marqueeFontSize = 40;
      watermarkFontSize = 34;
    } else if (antiTheftSize === "xlarge") {
      ribbonH = 124;
      marqueeFontSize = 36;
      watermarkFontSize = 32;
    } else if (antiTheftSize === "large") {
      ribbonH = 92;
      marqueeFontSize = 32;
      watermarkFontSize = 30;
    } else if (antiTheftSize === "medium") {
      ribbonH = 72;
      marqueeFontSize = 28;
      watermarkFontSize = 26;
    } else {
      ribbonH = 56;
      marqueeFontSize = 24;
      watermarkFontSize = 22;
    }
    applyCustomHeightOverride();

    if (marqueePos === "top") {
      ribbonY = 32;
      textY = ribbonY + Math.round(ribbonH / 2);
      watermarkY = ribbonY + ribbonH + 26;
    } else {
      const bottomPct = Number(antiTheft?.antiTheftBottomPercent ?? antiTheft?.bottomPercent);
      if (Number.isFinite(bottomPct) && bottomPct >= 0) {
        ribbonY = Math.round(1080 - (1080 * (bottomPct / 100)) - ribbonH);
      } else {
        ribbonY = 1080 - ribbonH - 16;
      }
      textY = ribbonY + Math.round(ribbonH / 2);
      watermarkY = ribbonY - 12;
    }
  }

  ribbonY = Math.max(0, Math.min(playResY - ribbonH, ribbonY));
  return {
    playResX,
    playResY,
    ribbonH,
    ribbonY,
    marqueeFontSize,
    watermarkFontSize,
    textY,
    watermarkY,
  };
}

/**
 * Builds a true Gaussian-blur strip filter chain (`split -> crop -> gblur -> overlay`)
 * behind the Anti-Theft Running Title ribbon (matching Corner Mask Real Blur).
 * Blurs out underlying Chinese subtitles across full frame width while keeping running Khmer title sharp.
 */
function buildAntiTheftBlurVideoFilterChain({
  inputLabel = "[0:v:0]",
  outputLabel = "[v_at_blur]",
  antiTheft = null,
  aspectRatio = "16:9",
  verticalStyle = "pad",
  sourceDimensions = null,
} = {}) {
  const layout = computeAntiTheftRibbonLayout({
    antiTheft,
    aspectRatio,
    verticalStyle,
    sourceDimensions,
  });
  const rawBlur = antiTheft?.blurStrength ?? antiTheft?.antiTheftBlur;
  const rawBlurNum = Number.isFinite(Number(rawBlur)) ? Number(rawBlur) : 18;
  // Scale CSS backdrop-filter px (~422px tall 16:9 preview player) to 1080p video pixels (1080/422 = 2.56x)
  const blurSigma = Math.max(6, Math.min(64, Math.round(rawBlurNum * 2.56)));

  const yFrac = (layout.ribbonY / layout.playResY).toFixed(4);
  const hFrac = (layout.ribbonH / layout.playResY).toFixed(4);

  const cropH = `min(ih,max(16,trunc(ih*${hFrac}/2)*2))`;
  const cropY = `max(0,min(ih-oh,trunc(ih*${yFrac}/2)*2))`;
  const ovY = `max(0,min(H-h,trunc(H*${yFrac}/2)*2))`;

  return [
    `${inputLabel}split[v_at_bg][v_at_fg]`,
    `[v_at_fg]crop=w=iw:h='${cropH}':x=0:y='${cropY}',gblur=sigma=${blurSigma}:steps=2[v_at_blurred]`,
    `[v_at_bg][v_at_blurred]overlay=x=0:y='${ovY}':format=auto${outputLabel}`,
  ];
}

/**
 * Normalizes optional YouTube Safe Edit transform settings so FFmpeg filter generation
 * and audio muting always receive bounded, validated values.
 */
function normalizeYoutubeTransform(youtubeTransform = null) {
  if (!youtubeTransform || typeof youtubeTransform !== "object") {
    return {
      enableMirrorFlip: false,
      zoomScale: 1.0,
      enableColorGrade: false,
      youtubeSafeAudio: false,
    };
  }
  const rawZoom = Number(youtubeTransform.zoomScale ?? youtubeTransform.zoom ?? 1.0);
  const zoomScale = Number.isFinite(rawZoom)
    ? Math.max(1.0, Math.min(1.15, Number(rawZoom.toFixed(3))))
    : 1.0;
  return {
    enableMirrorFlip: Boolean(youtubeTransform.enableMirrorFlip),
    zoomScale,
    enableColorGrade: Boolean(youtubeTransform.enableColorGrade),
    youtubeSafeAudio: Boolean(youtubeTransform.youtubeSafeAudio),
  };
}

/**
 * Builds the YouTube-Safe base video transform filter chain (`hflip -> zoom/crop -> eq`).
 * MUST execute strictly BEFORE aspect-ratio scale/pad, Corner Mask, Anti-Theft blur,
 * `.ass` Khmer subtitles, and Logo/Sponsor overlays so Khmer text and channel logo
 * are NEVER mirrored backwards or cropped.
 */
function buildYoutubeTransformVideoFilterChain({
  inputLabel = "[0:v:0]",
  outputLabel = "[v_yt_tx]",
  youtubeTransform = null,
} = {}) {
  const tx = normalizeYoutubeTransform(youtubeTransform);
  const filters = [];

  if (tx.enableMirrorFlip) {
    filters.push("hflip");
  }

  if (tx.zoomScale > 1.005) {
    const z = tx.zoomScale.toFixed(3);
    // Upscale by z (rounded up to even dimensions for yuv420p) with fast_bilinear SIMD scaler then center-crop back to source size
    filters.push(
      `scale=w='ceil(iw*${z}/2)*2':h='ceil(ih*${z}/2)*2':flags=fast_bilinear`,
      `crop=w='min(iw,max(2,trunc(iw/${z}/2)*2))':h='min(ih,max(2,trunc(ih/${z}/2)*2))':x='(iw-ow)/2':y='(ih-oh)/2'`
    );
  }

  if (tx.enableColorGrade) {
    filters.push("eq=contrast=1.05:brightness=0.015:saturation=1.08");
  }

  if (filters.length === 0) {
    return [];
  }

  const safeIn = inputLabel.startsWith("[") ? inputLabel : `[${inputLabel}]`;
  return [`${safeIn}${filters.join(",")}${outputLabel}`];
}


function wrapKhmerSubtitleText(text, maxLineChars = 28) {
  if (!text) return "";
  const clean = text.trim().replace(/\r?\n+/g, " ");
  if (clean.length <= maxLineChars) return clean;

  const words = clean.split(/\s+/);
  if (words.length > 1) {
    let line1 = "";
    let line2 = "";
    const targetHalf = Math.ceil(clean.length / 2);
    let currentLen = 0;

    for (const w of words) {
      if (currentLen + w.length <= targetHalf || !line1) {
        line1 = line1 ? line1 + " " + w : w;
        currentLen += w.length + 1;
      } else {
        line2 = line2 ? line2 + " " + w : w;
      }
    }
    if (line2) return line1 + "\n" + line2;
  }

  const isKhmerConsonant = (c) => c >= "\u1780" && c <= "\u17A2";
  const isCoeng = (c) => c === "\u17D2";
  const target = Math.ceil(clean.length / 2);
  let safeIdx = target;
  for (let offset = 0; offset <= 8; offset++) {
    const idx1 = target - offset;
    if (idx1 > 0 && idx1 < clean.length && isKhmerConsonant(clean[idx1]) && !isCoeng(clean[idx1 - 1])) {
      safeIdx = idx1;
      break;
    }
    const idx2 = target + offset;
    if (idx2 > 0 && idx2 < clean.length && isKhmerConsonant(clean[idx2]) && !isCoeng(clean[idx2 - 1])) {
      safeIdx = idx2;
      break;
    }
  }

  return clean.slice(0, safeIdx) + "\n" + clean.slice(safeIdx);
}

function generateSrtFile(segments, outputPath) {
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return null;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let srtContent = "";
  segments.forEach((seg, index) => {
    const hasVoice = Boolean(
      seg.audioUrl || seg.audioPath || seg.rawAudioPath || seg.audioFile || seg.rawAudioFile ||
      seg.ttsStatus === "ready" || seg.status === "audio_ready" ||
      (typeof seg.finalAudioDuration === "number" && seg.finalAudioDuration > 0) ||
      (typeof seg.audioDuration === "number" && seg.audioDuration > 0) ||
      (typeof seg.audioDurationSec === "number" && seg.audioDurationSec > 0)
    );

    let startSec = Number(
      (hasVoice && seg.audioStartSec !== undefined && seg.audioStartSec !== null && !isNaN(Number(seg.audioStartSec)))
        ? seg.audioStartSec
        : (typeof seg.startSec === "number" && !isNaN(seg.startSec) ? seg.startSec : parseTimeToSec(seg.start, index * 4))
    );

    const realAudioDur = hasVoice
      ? (seg.finalAudioDuration ?? seg.audioDurationSec ?? seg.audioDuration ?? seg.originalAudioDuration ?? seg.rawAudioDur)
      : null;

    const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
    let endSec;
    if (isTrimmed && typeof seg.audioEndSec === "number" && !isNaN(seg.audioEndSec)) {
      endSec = seg.audioEndSec;
    } else if (realAudioDur && !isNaN(realAudioDur) && realAudioDur > 0) {
      endSec = startSec + Number(realAudioDur);
    } else if (typeof seg.endSec === "number" && !isNaN(seg.endSec)) {
      endSec = seg.endSec;
    } else {
      endSec = parseTimeToSec(seg.end, startSec + 2.5);
    }

    const srtDur = endSec - startSec;
    if (endSec <= startSec || isNaN(srtDur) || srtDur <= 0.1) {
      const textLen = (seg.khmerText || seg.khmer || "").length || 8;
      endSec = parseFloat((startSec + Math.max(1.2, Math.min(5.0, textLen * 0.16))).toFixed(2));
    }

    const startTime = toSrtTime(startSec);
    const endTime = toSrtTime(endSec);

    srtContent += `${index + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    const formattedKhmer = wrapKhmerSubtitleText(seg.khmerText || seg.khmer || "");
    srtContent += `${formattedKhmer}\n\n`;
  });

  fs.writeFileSync(outputPath, srtContent, "utf-8");
  return outputPath;
}


module.exports = {
  hexToAssColor,
  formatSecondsToAssTime,
  sanitizeKhmerSubtitleText,
  wrapKhmerSubtitleText,
  SUBTITLE_SIZE_SCALE_MAP,
  resolveRenderAspectRatio,
  resolveAssSubtitleLayoutDefaults,
  generateKhmerAssSubtitleFile,
  buildAssSubtitleVideoFilter,
  generateSrtFile,
  buildVerticalVideoFilterChain,
  buildCornerBlurVideoFilterChain,
  computeAntiTheftRibbonLayout,
  buildAntiTheftBlurVideoFilterChain,
  normalizeYoutubeTransform,
  buildYoutubeTransformVideoFilterChain,
};
