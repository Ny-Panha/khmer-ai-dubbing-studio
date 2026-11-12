const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Builds an FFmpeg dynamic crop X expression for 9:16 vertical video.
 * Supports CapCut-style Keyframing (💎) with smooth camera pan across keyframe timestamps.
 * If keyframes exist, smoothly interpolates between keyframes.
 * Otherwise, falls back to segment-based framing and bridges gaps.
 */
function buildDynamicVerticalCropXExpr(segments = [], targetCropW = 1080, framingOverrides = [], framingKeyframes = []) {
  // CapCut-style Keyframing (💎) Priority:
  const cleanKeyframes = (Array.isArray(framingKeyframes) ? framingKeyframes : [])
    .map((k) => ({
      time: Math.max(0, Number(k.time) || 0),
      cropX: Math.max(5, Math.min(95, Number(k.cropX) || 50)),
    }))
    .filter((k) => Number.isFinite(k.time))
    .sort((a, b) => a.time - b.time);

  if (cleanKeyframes.length > 0) {
    if (cleanKeyframes.length === 1) {
      const ratio = cleanKeyframes[0].cropX / 100.0;
      return `(in_w-${targetCropW})*${ratio.toFixed(4)}`;
    }

    // Build continuous interpolation across keyframe intervals
    const exprParts = [];
    const firstKf = cleanKeyframes[0];
    const lastKf = cleanKeyframes[cleanKeyframes.length - 1];
    const firstRatio = (firstKf.cropX / 100.0).toFixed(4);
    const lastRatio = (lastKf.cropX / 100.0).toFixed(4);

    // Before first keyframe: hold first keyframe ratio
    exprParts.push(`lt(t\\,${firstKf.time.toFixed(2)})*${firstRatio}`);

    // Between adjacent keyframes: smooth pan (linear interpolation between t_i and t_{i+1})
    for (let i = 0; i < cleanKeyframes.length - 1; i++) {
      const k0 = cleanKeyframes[i];
      const k1 = cleanKeyframes[i + 1];
      const r0 = k0.cropX / 100.0;
      const r1 = k1.cropX / 100.0;
      const dur = Math.max(0.04, k1.time - k0.time);
      const delta = (r1 - r0).toFixed(4);
      const t0Str = k0.time.toFixed(2);
      const t1Str = k1.time.toFixed(2);

      // between(t, t0, t1) * (r0 + delta * (t - t0) / dur)
      exprParts.push(
        `between(t\\,${t0Str}\\,${t1Str})*(${r0.toFixed(4)}+(${delta})*(t-${t0Str})/${dur.toFixed(2)})`
      );
    }

    // After last keyframe: hold last keyframe ratio
    exprParts.push(`gte(t\\,${lastKf.time.toFixed(2)})*${lastRatio}`);

    return `(in_w-${targetCropW})*(${exprParts.join('+')})`;
  }

  // Filter out any corrupt overrides spanning the whole video
  const cleanOverrides = (framingOverrides || []).filter((o) => !(Number(o.startSec) === 0 && Number(o.endSec) > 30));

  // Combine segments and overrides into a unified timeline
  const allItems = [...(segments || []), ...cleanOverrides]
    .map((s) => ({
      startSec: Math.max(0, Number(s.startSec ?? s.startTime) || 0),
      endSec: Math.max(0, Number(s.endSec ?? s.endTime) || 0),
      cropX: s.cropX,
      cropPosition: s.cropPosition,
    }))
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  if (allItems.length === 0) {
    return `(in_w-${targetCropW})/2`;
  }

  // Build continuous time intervals by bridging gaps (Hold previous camera framing across pauses)
  const bridged = [];
  for (let i = 0; i < allItems.length; i++) {
    const cur = allItems[i];
    const next = allItems[i + 1];

    let ratio = 0.50;
    if (cur.cropX !== undefined && cur.cropX !== null && !isNaN(Number(cur.cropX))) {
      ratio = Math.max(0.05, Math.min(0.95, Number(cur.cropX) / 100.0));
    } else if (cur.cropPosition === "left") {
      ratio = 0.20;
    } else if (cur.cropPosition === "right") {
      ratio = 0.80;
    }

    // Bridge gap between current end and next start (unless current already covers or exceeds it)
    const effEnd = next && next.startSec > cur.endSec ? next.startSec : cur.endSec;

    bridged.push({
      start: cur.startSec,
      end: Math.max(cur.startSec + 0.1, effEnd),
      ratio,
    });
  }

  const terms = [];
  const maskTerms = [];

  for (const b of bridged) {
    terms.push(`between(t,${b.start.toFixed(2)},${b.end.toFixed(2)})*${b.ratio.toFixed(2)}`);
    maskTerms.push(`between(t,${b.start.toFixed(2)},${b.end.toFixed(2)})`);
  }

  const maskSum = maskTerms.join("+");
  const termsSum = terms.join("+");

  // Formula: (in_w - targetCropW) * [ (1 - min(1, maskSum)) * 0.50 + termsSum ]
  return `(in_w-${targetCropW})*((1-min(1,${maskSum}))*0.50+${termsSum})`;
}

/**
 * Runs Python YuNet face scanner on video to auto-detect face location for each segment.
 */
function analyzeEpisodeFraming({ videoPath, segments = [], modelPath = null }) {
  return new Promise((resolve, reject) => {
    if (!videoPath || !fs.existsSync(videoPath)) {
      return reject(new Error(`Video file not found: ${videoPath}`));
    }
    if (!Array.isArray(segments) || segments.length === 0) {
      return resolve([]);
    }

    const scriptPath = path.join(__dirname, "smartReframeService.py");
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`smartReframeService.py not found: ${scriptPath}`));
    }

    const tempDir = os.tmpdir();
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const inputJsonPath = path.join(tempDir, `reframe_in_${id}.json`);
    const outputJsonPath = path.join(tempDir, `reframe_out_${id}.json`);

    try {
      fs.writeFileSync(inputJsonPath, JSON.stringify(segments, null, 2), "utf-8");
    } catch (writeErr) {
      return reject(writeErr);
    }

    const resolvedModelPath = modelPath || path.join(__dirname, "models", "face_detection_yunet_2023mar.onnx");
    const pyArgs = [
      scriptPath,
      "--video", videoPath,
      "--segments", inputJsonPath,
      "--output", outputJsonPath,
    ];
    if (fs.existsSync(resolvedModelPath)) {
      pyArgs.push("--model", resolvedModelPath);
    }

    const proc = spawn("python", pyArgs);
    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      try { if (fs.existsSync(inputJsonPath)) fs.unlinkSync(inputJsonPath); } catch (_) {}

      if (code !== 0) {
        try { if (fs.existsSync(outputJsonPath)) fs.unlinkSync(outputJsonPath); } catch (_) {}
        return reject(new Error(`smartReframeService failed (code ${code}): ${stderr}`));
      }

      try {
        if (!fs.existsSync(outputJsonPath)) {
          return reject(new Error("smartReframeService produced no output JSON file"));
        }
        const raw = fs.readFileSync(outputJsonPath, "utf-8");
        fs.unlinkSync(outputJsonPath);
        const updated = JSON.parse(raw);
        resolve(updated);
      } catch (parseErr) {
        reject(parseErr);
      }
    });

    proc.on("error", (err) => {
      try { if (fs.existsSync(inputJsonPath)) fs.unlinkSync(inputJsonPath); } catch (_) {}
      try { if (fs.existsSync(outputJsonPath)) fs.unlinkSync(outputJsonPath); } catch (_) {}
      reject(err);
    });
  });
}

module.exports = {
  buildDynamicVerticalCropXExpr,
  analyzeEpisodeFraming,
};

