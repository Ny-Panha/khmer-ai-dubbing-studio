const fs = require("fs");
const path = require("path");
const { resolveMediaFile, uploadsDir, isSafeUploadPath } = require("../../utils/pathUtils");

function isAdClip(clip) {
  return Boolean(clip && typeof clip === "object" && (clip.isAd || clip.clipType === "sponsor_ad"));
}

function resolveAdMediaPath(adClipOrSettings) {
  if (!adClipOrSettings) return null;
  const raw =
    adClipOrSettings.videoPath ||
    adClipOrSettings.sponsorPath ||
    adClipOrSettings.videoAdPath ||
    adClipOrSettings.videoUrl ||
    adClipOrSettings.videoAdUrl;
  if (!raw || typeof raw !== "string") return null;

  const candidates = [
    raw,
    resolveMediaFile(raw),
    path.join(uploadsDir, "sponsor", path.basename(raw)),
    path.join(__dirname, "../../../frontend/public", raw.replace(/^\//, "")),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      if (isSafeUploadPath(c, uploadsDir) || c.includes(`${path.sep}frontend${path.sep}public${path.sep}`)) {
        return c;
      }
    }
  }
  return null;
}

/**
 * Inject pre-roll / post-roll ad into videoClips ONLY if not already present (duplicate guard).
 */
function applyPlacementAdToTimeline({
  videoClips = [],
  segments = [],
  videoAdSettings = null,
  storyDurationSec = 0,
}) {
  const clips = Array.isArray(videoClips) ? videoClips.map((c) => ({ ...c })) : [];
  const segs = Array.isArray(segments) ? segments.map((s) => ({ ...s })) : [];

  if (!videoAdSettings || !videoAdSettings.enabled) {
    return { videoClips: clips, segments: segs, injected: false };
  }
  const placement = videoAdSettings.placement || "manual";
  if (placement !== "preroll" && placement !== "postroll") {
    return { videoClips: clips, segments: segs, injected: false };
  }
  const adPath = resolveAdMediaPath(videoAdSettings);
  const adDur = Number(videoAdSettings.durationSec || videoAdSettings.duration || 0);
  if (!adPath || !Number.isFinite(adDur) || adDur <= 0.05) {
    return { videoClips: clips, segments: segs, injected: false };
  }

  // Duplicate ad guard
  const maxEnd = clips.reduce((m, c) => Math.max(m, Number(c.end) || 0), storyDurationSec || 0);
  const alreadyHas = clips.some((c) => {
    if (!isAdClip(c)) return false;
    if (c.adPlacement === placement) return true;
    const cPath = resolveAdMediaPath(c);
    if (placement === "preroll" && Number(c.start) <= 0.05 && cPath === adPath) return true;
    if (placement === "postroll" && Number(c.end) >= maxEnd - 0.05 && cPath === adPath) return true;
    return false;
  });
  if (alreadyHas) {
    return { videoClips: clips, segments: segs, injected: false };
  }

  let baseClips = clips;
  if (baseClips.length === 0 && storyDurationSec > 0) {
    baseClips = [{
      id: `clip-story-base`,
      start: 0,
      end: storyDurationSec,
      sourceStart: 0,
      sourceEnd: storyDurationSec,
      duration: storyDurationSec,
      trackRow: 0,
      trackId: "video-1",
    }];
  }

  const insertAt = placement === "preroll" ? 0 : baseClips.reduce((m, c) => Math.max(m, Number(c.end) || 0), 0);
  const shiftedClips = baseClips.map((c) => (
    Number(c.start) >= insertAt - 0.001
      ? { ...c, start: Number((Number(c.start) + adDur).toFixed(3)), end: Number((Number(c.end) + adDur).toFixed(3)) }
      : c
  ));

  const newAd = {
    id: `clip-ad-${placement}-${Date.now()}`,
    trackRow: 0,
    trackId: "video-1",
    start: Number(insertAt.toFixed(3)),
    end: Number((insertAt + adDur).toFixed(3)),
    sourceStart: 0,
    sourceEnd: Number(adDur.toFixed(3)),
    duration: Number(adDur.toFixed(3)),
    name: videoAdSettings.name || path.basename(adPath),
    videoUrl: videoAdSettings.videoUrl || `/uploads/sponsor/${path.basename(adPath)}`,
    videoPath: adPath,
    isAd: true,
    clipType: "sponsor_ad",
    isDialogue: false,
    isMuted: Boolean(videoAdSettings.volume !== undefined && Number(videoAdSettings.volume) <= 0.001),
    adVolume: Number.isFinite(Number(videoAdSettings.volume)) ? Number(videoAdSettings.volume) : 1.0,
    adPlacement: placement,
  };

  const shiftedSegs = placement === "preroll"
    ? segs.map((s) => {
        const next = { ...s };
        if (typeof s.startSec === "number") next.startSec = Number((s.startSec + adDur).toFixed(3));
        if (typeof s.endSec === "number") next.endSec = Number((s.endSec + adDur).toFixed(3));
        if (typeof s.audioStartSec === "number") next.audioStartSec = Number((s.audioStartSec + adDur).toFixed(3));
        if (typeof s.audioEndSec === "number") next.audioEndSec = Number((s.audioEndSec + adDur).toFixed(3));
        if (typeof s.startSeconds === "number") next.startSeconds = Number((s.startSeconds + adDur).toFixed(3));
        if (typeof s.endSeconds === "number") next.endSeconds = Number((s.endSeconds + adDur).toFixed(3));
        return next;
      })
    : segs;

  return {
    videoClips: [...shiftedClips, newAd].sort((a, b) => Number(a.start) - Number(b.start)),
    segments: shiftedSegs,
    injected: true,
  };
}

/**
 * Build story-only clips + story-only segments (shifting out preceding ad durations)
 * plus ordered assembly plan of { type: 'story', storyStart, storyEnd } | { type: 'ad', ... }.
 */
function buildStoryAndAdAssemblyPlan(videoClips = [], segments = []) {
  const sorted = [...(Array.isArray(videoClips) ? videoClips : [])]
    .filter((c) => c && Number(c.end) > Number(c.start))
    .sort((a, b) => Number(a.start) - Number(b.start));

  const adClips = sorted.filter((c) => isAdClip(c));
  if (adClips.length === 0) {
    return { hasAds: false, storyClips: sorted, storySegments: segments, assembly: [] };
  }

  // Helper: sum duration of ads that appear strictly before timeline t
  const adOffsetBefore = (t) => {
    let off = 0;
    for (const ad of adClips) {
      if (Number(ad.end) <= t + 0.001) {
        off += Math.max(0, Number(ad.end) - Number(ad.start));
      } else if (Number(ad.start) < t - 0.001) {
        off += Math.max(0, t - Number(ad.start));
      }
    }
    return off;
  };

  const storyClips = [];
  const assembly = [];
  let storyCursor = 0;

  for (const clip of sorted) {
    const dur = Math.max(0, Number(clip.end) - Number(clip.start));
    if (dur <= 0.01) continue;
    if (isAdClip(clip)) {
      const adPath = resolveAdMediaPath(clip);
      if (!adPath) continue;
      assembly.push({
        type: "ad",
        adPath,
        sourceStart: Math.max(0, Number(clip.sourceStart) || 0),
        duration: dur,
        isMuted: Boolean(clip.isMuted),
        adVolume: Number.isFinite(Number(clip.adVolume)) ? Number(clip.adVolume) : 1.0,
      });
    } else {
      const sStart = Number(storyCursor.toFixed(3));
      const sEnd = Number((storyCursor + dur).toFixed(3));
      storyClips.push({
        ...clip,
        start: sStart,
        end: sEnd,
      });
      const prev = assembly[assembly.length - 1];
      if (prev && prev.type === "story") {
        prev.storyEnd = sEnd;
      } else {
        assembly.push({ type: "story", storyStart: sStart, storyEnd: sEnd });
      }
      storyCursor = sEnd;
    }
  }

  // Shift segments back to story-relative coordinates (excluding any segment placed inside an ad)
  const storySegments = (Array.isArray(segments) ? segments : [])
    .filter((seg) => {
      const t = Number(seg.audioStartSec ?? seg.startSec ?? seg.startSeconds ?? 0);
      return !adClips.some((ad) => t >= Number(ad.start) + 0.01 && t < Number(ad.end) - 0.01);
    })
    .map((seg) => {
      const t = Number(seg.audioStartSec ?? seg.startSec ?? seg.startSeconds ?? 0);
      const off = adOffsetBefore(t);
      if (off <= 0) return { ...seg };
      const next = { ...seg };
      if (typeof seg.startSec === "number") next.startSec = Math.max(0, Number((seg.startSec - off).toFixed(3)));
      if (typeof seg.endSec === "number") next.endSec = Math.max(0, Number((seg.endSec - off).toFixed(3)));
      if (typeof seg.audioStartSec === "number") next.audioStartSec = Math.max(0, Number((seg.audioStartSec - off).toFixed(3)));
      if (typeof seg.audioEndSec === "number") next.audioEndSec = Math.max(0, Number((seg.audioEndSec - off).toFixed(3)));
      if (typeof seg.startSeconds === "number") next.startSeconds = Math.max(0, Number((seg.startSeconds - off).toFixed(3)));
      if (typeof seg.endSeconds === "number") next.endSeconds = Math.max(0, Number((seg.endSeconds - off).toFixed(3)));
      return next;
    });

  return {
    hasAds: assembly.some((a) => a.type === "ad"),
    storyClips,
    storySegments,
    storyDurationSec: storyCursor,
    assembly,
  };
}

module.exports = {
  isAdClip,
  resolveAdMediaPath,
  applyPlacementAdToTimeline,
  buildStoryAndAdAssemblyPlan,
};
