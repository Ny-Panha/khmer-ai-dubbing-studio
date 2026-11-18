import { computeTimelineScrollForTime } from './timelineUtils.js';

export const TIMELINE_VIEW_STATE_STORAGE_KEY = 'KHMER_AI_TIMELINE_VIEW_STATE_V1';
const MAX_STORED_EPISODES = 60;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;

export function clampTimelineZoom(zoom) {
  const n = Number(zoom);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n)) * 100) / 100;
}

export function buildEpisodeViewKey(seriesId, episodeId) {
  const s = seriesId != null ? String(seriesId).trim() : '';
  const e = episodeId != null ? String(episodeId).trim() : '';
  if (!s || !e) return '';
  return `${s}::${e}`;
}

function readViewStateMap(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return {};
  try {
    const raw = store.getItem(TIMELINE_VIEW_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeViewStateMap(map, storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return;
  try {
    const entries = Object.entries(map);
    if (entries.length > MAX_STORED_EPISODES) {
      entries.sort((a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0));
      const trimmed = Object.fromEntries(entries.slice(0, MAX_STORED_EPISODES));
      store.setItem(TIMELINE_VIEW_STATE_STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    store.setItem(TIMELINE_VIEW_STATE_STORAGE_KEY, JSON.stringify(map));
  } catch (_) {}
}

/**
 * Load persisted per-episode timeline view state (playheadSec, scrollLeft, zoom) from localStorage.
 * Never stored inside series.json segment data.
 */
export function loadEpisodeTimelineViewState(seriesId, episodeId, storage = null) {
  const key = buildEpisodeViewKey(seriesId, episodeId);
  if (!key) return null;
  const map = readViewStateMap(storage);
  const entry = map[key];
  if (!entry || typeof entry !== 'object') return null;

  const playheadSec = Number.isFinite(Number(entry.playheadSec))
    ? Math.max(0, parseFloat(Number(entry.playheadSec).toFixed(3)))
    : 0;
  const scrollLeft = Number.isFinite(Number(entry.scrollLeft))
    ? Math.max(0, Math.round(Number(entry.scrollLeft)))
    : 0;
  const zoom = clampTimelineZoom(entry.zoom ?? 1);

  return { playheadSec, scrollLeft, zoom, updatedAt: Number(entry.updatedAt) || 0 };
}

/**
 * Merge and persist per-episode timeline view state (playheadSec, scrollLeft, zoom) to localStorage.
 */
export function saveEpisodeTimelineViewState(seriesId, episodeId, patch = {}, storage = null) {
  const key = buildEpisodeViewKey(seriesId, episodeId);
  if (!key || !patch || typeof patch !== 'object') return null;
  const map = readViewStateMap(storage);
  const prev = map[key] && typeof map[key] === 'object' ? map[key] : {};

  const next = {
    playheadSec: Number.isFinite(Number(patch.playheadSec))
      ? Math.max(0, parseFloat(Number(patch.playheadSec).toFixed(3)))
      : (Number.isFinite(Number(prev.playheadSec)) ? Math.max(0, Number(prev.playheadSec)) : 0),
    scrollLeft: Number.isFinite(Number(patch.scrollLeft))
      ? Math.max(0, Math.round(Number(patch.scrollLeft)))
      : (Number.isFinite(Number(prev.scrollLeft)) ? Math.max(0, Math.round(Number(prev.scrollLeft))) : 0),
    zoom: patch.zoom !== undefined && Number.isFinite(Number(patch.zoom))
      ? clampTimelineZoom(patch.zoom)
      : clampTimelineZoom(prev.zoom ?? 1),
    updatedAt: Date.now(),
  };

  map[key] = next;
  writeViewStateMap(map, storage);
  return next;
}

/**
 * Compute new scrollLeft when zooming so the playhead stays anchored at the exact same
 * on-screen position (or centers cleanly if it was off-screen or near an edge).
 * Guarantees the playhead is ALWAYS visible inside the viewport after zoom.
 */
export function computeAnchoredZoomScrollLeft({
  playheadSec = 0,
  oldPps = 45,
  newPps = 45,
  currentScrollLeft = 0,
  clientWidth = 0,
  trackHeaderWidth = 148,
}) {
  const safeTime = Number.isFinite(playheadSec) ? Math.max(0, playheadSec) : 0;
  const safeOldPps = Number.isFinite(oldPps) && oldPps > 0 ? oldPps : 45;
  const safeNewPps = Number.isFinite(newPps) && newPps > 0 ? newPps : 45;
  const safeWidth = Number.isFinite(clientWidth) && clientWidth > 0 ? clientWidth : 0;
  const safeScroll = Number.isFinite(currentScrollLeft) ? Math.max(0, currentScrollLeft) : 0;

  if (safeWidth <= 0) return 0;

  const trackViewportWidth = Math.max(0, safeWidth - trackHeaderWidth);
  if (trackViewportWidth <= 32) {
    return computeTimelineScrollForTime(safeTime, safeNewPps, safeWidth, trackHeaderWidth);
  }

  // Playhead's X offset inside the scrollable track viewport (0 = right edge of sticky track headers)
  const oldScreenOffset = safeTime * safeOldPps - safeScroll;
  const edgeMargin = Math.min(24, trackViewportWidth * 0.1);

  let targetScroll;
  if (oldScreenOffset >= edgeMargin && oldScreenOffset <= trackViewportWidth - edgeMargin) {
    // Keep playhead anchored at the exact same on-screen pixel position
    targetScroll = Math.max(0, Math.round(safeTime * safeNewPps - oldScreenOffset));
  } else {
    // Playhead was off-screen or tucked behind header: center it cleanly
    targetScroll = computeTimelineScrollForTime(safeTime, safeNewPps, safeWidth, trackHeaderWidth);
  }

  // Hard visibility invariant: playhead MUST remain inside [edgeMargin, trackViewportWidth - edgeMargin]
  // (or at scrollLeft=0 when playhead is near the very start of the timeline)
  const resultingOffset = safeTime * safeNewPps - targetScroll;
  if (resultingOffset < 0 || resultingOffset > trackViewportWidth - edgeMargin) {
    targetScroll = computeTimelineScrollForTime(safeTime, safeNewPps, safeWidth, trackHeaderWidth);
  }

  return Math.max(0, Math.round(targetScroll));
}

/**
 * Compute scrollLeft required to ensure the playhead is visible after any seek/jump/restore.
 * - If autoCenter or forceCenter is true: centers the playhead.
 * - If autoCenter is false: keeps currentScrollLeft if playhead is comfortably visible on screen,
 *   otherwise centers immediately so the playhead is never left off-screen.
 */
export function computeScrollToRevealPlayhead({
  playheadSec = 0,
  pps = 45,
  currentScrollLeft = 0,
  clientWidth = 0,
  trackHeaderWidth = 148,
  autoCenter = true,
  forceCenter = false,
}) {
  const safeTime = Number.isFinite(playheadSec) ? Math.max(0, playheadSec) : 0;
  const safePps = Number.isFinite(pps) && pps > 0 ? pps : 45;
  const safeWidth = Number.isFinite(clientWidth) && clientWidth > 0 ? clientWidth : 0;
  const safeScroll = Number.isFinite(currentScrollLeft) ? Math.max(0, currentScrollLeft) : 0;

  if (safeWidth <= 0) return safeScroll;

  const trackViewportWidth = Math.max(0, safeWidth - trackHeaderWidth);
  const screenOffset = safeTime * safePps - safeScroll;
  const margin = Math.min(28, Math.max(12, trackViewportWidth * 0.08));
  const isVisible = screenOffset >= margin && screenOffset <= (trackViewportWidth - margin);

  if (forceCenter || autoCenter) {
    return computeTimelineScrollForTime(safeTime, safePps, safeWidth, trackHeaderWidth);
  }

  if (isVisible) {
    return safeScroll;
  }

  return computeTimelineScrollForTime(safeTime, safePps, safeWidth, trackHeaderWidth);
}
