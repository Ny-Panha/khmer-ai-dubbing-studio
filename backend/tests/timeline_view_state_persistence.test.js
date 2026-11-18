import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEpisodeTimelineViewState,
  saveEpisodeTimelineViewState,
  computeAnchoredZoomScrollLeft,
  computeScrollToRevealPlayhead,
  TIMELINE_VIEW_STATE_STORAGE_KEY,
} from '../../frontend/src/utils/timelineViewState.js';
import { getPixelsPerSecond } from '../../frontend/src/utils/timelineUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

describe('Per-Episode Timeline View State, Seek Visibility & Playhead-Anchored Zoom', () => {
  it('1. Persists and restores playheadSec, scrollLeft, and zoom per episode independently in localStorage', () => {
    const store = createMemoryStorage();

    saveEpisodeTimelineViewState('Pseudo_Spiritual_Root', 'ep_5', {
      playheadSec: 41.25,
      scrollLeft: 2140,
      zoom: 1.4,
    }, store);

    saveEpisodeTimelineViewState('Pseudo_Spiritual_Root', 'ep_3', {
      playheadSec: 120.5,
      scrollLeft: 5100,
      zoom: 2.0,
    }, store);

    const ep5 = loadEpisodeTimelineViewState('Pseudo_Spiritual_Root', 'ep_5', store);
    const ep3 = loadEpisodeTimelineViewState('Pseudo_Spiritual_Root', 'ep_3', store);

    assert.equal(ep5.playheadSec, 41.25);
    assert.equal(ep5.scrollLeft, 2140);
    assert.equal(ep5.zoom, 1.4);

    assert.equal(ep3.playheadSec, 120.5);
    assert.equal(ep3.scrollLeft, 5100);
    assert.equal(ep3.zoom, 2.0);

    // Partial update preserves untouched fields
    saveEpisodeTimelineViewState('Pseudo_Spiritual_Root', 'ep_5', { zoom: 1.8 }, store);
    const ep5Updated = loadEpisodeTimelineViewState('Pseudo_Spiritual_Root', 'ep_5', store);
    assert.equal(ep5Updated.playheadSec, 41.25);
    assert.equal(ep5Updated.scrollLeft, 2140);
    assert.equal(ep5Updated.zoom, 1.8);
    assert.ok(store.getItem(TIMELINE_VIEW_STATE_STORAGE_KEY));
  });

  it('2. Zoom anchors on the playhead: zooming in/out 3x keeps playhead at same on-screen X and never leaves viewport', () => {
    const playheadSec = 41.0;
    const clientWidth = 1280;
    const trackHeaderWidth = 148;
    const trackViewportW = clientWidth - trackHeaderWidth;

    let zoom = 1.0;
    let pps = getPixelsPerSecond(zoom);
    // Start with playhead comfortably visible at screenOffset = 500px
    let scrollLeft = Math.round(playheadSec * pps - 500);

    // Zoom IN 3x: 1.0 -> 1.2 -> 1.4 -> 1.6
    for (const nextZoom of [1.2, 1.4, 1.6, 2.2, 3.0, 2.4, 1.8, 1.2, 0.8, 0.5]) {
      const nextPps = getPixelsPerSecond(nextZoom);
      const nextScroll = computeAnchoredZoomScrollLeft({
        playheadSec,
        oldPps: pps,
        newPps: nextPps,
        currentScrollLeft: scrollLeft,
        clientWidth,
        trackHeaderWidth,
      });

      const screenOffset = playheadSec * nextPps - nextScroll;
      assert.ok(
        screenOffset >= 0 && screenOffset <= trackViewportW,
        `Playhead went off-screen at zoom ${nextZoom}x (screenOffset=${screenOffset}, viewport=${trackViewportW})`
      );
      // When playhead isn't clamped at scrollLeft=0, it stays anchored right around 500px
      if (nextScroll > 0) {
        assert.ok(Math.abs(screenOffset - 500) <= 2, `Expected anchored offset ~500px at ${nextZoom}x, got ${screenOffset}`);
      }

      zoom = nextZoom;
      pps = nextPps;
      scrollLeft = nextScroll;
    }

    // Even if playhead was OFF-SCREEN before zoom (e.g. view sat at 01:45 while playhead at 00:41),
    // zooming brings the playhead back onto the screen!
    const rescuedScroll = computeAnchoredZoomScrollLeft({
      playheadSec: 41.0,
      oldPps: getPixelsPerSecond(1.0),
      newPps: getPixelsPerSecond(1.2),
      currentScrollLeft: 4500, // ~01:45 off-screen
      clientWidth,
      trackHeaderWidth,
    });
    const rescuedOffset = 41.0 * getPixelsPerSecond(1.2) - rescuedScroll;
    assert.ok(
      rescuedOffset >= 0 && rescuedOffset <= trackViewportW,
      `Zoom must rescue off-screen playhead into view (got offset=${rescuedOffset})`
    );
  });

  it('3. Seek = visible immediately regardless of autoCenter setting', () => {
    const pps = getPixelsPerSecond(1.2);
    const clientWidth = 1280;
    const trackHeaderWidth = 148;
    const trackViewportW = clientWidth - trackHeaderWidth;

    // Off-screen seek to 200s while viewing 00:00 (autoCenter OFF) -> MUST jump to reveal playhead
    const revealOff = computeScrollToRevealPlayhead({
      playheadSec: 200,
      pps,
      currentScrollLeft: 0,
      clientWidth,
      trackHeaderWidth,
      autoCenter: false,
    });
    const offsetOff = 200 * pps - revealOff;
    assert.ok(offsetOff >= 20 && offsetOff <= trackViewportW - 20, `Off-screen seek must be visible (offset=${offsetOff})`);

    // Already-visible seek with autoCenter OFF -> preserves scrollLeft (no unnecessary jump)
    const stayScroll = computeScrollToRevealPlayhead({
      playheadSec: 201,
      pps,
      currentScrollLeft: revealOff,
      clientWidth,
      trackHeaderWidth,
      autoCenter: false,
    });
    assert.equal(stayScroll, revealOff, 'Already-visible seek with autoCenter OFF keeps scroll steady');
  });

  it('4. Static audit: TimelineEditor, useSeriesManager, and useVideoPlayback wire view state without writing it to series.json', () => {
    const editorCode = fs.readFileSync(path.join(rootDir, 'frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');
    const seriesCode = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useSeriesManager.js'), 'utf8');
    const playbackCode = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useVideoPlayback.js'), 'utf8');

    assert.ok(editorCode.includes('loadEpisodeTimelineViewState') && editorCode.includes('saveEpisodeTimelineViewState'), 'TimelineEditor must persist/restore view state');
    assert.ok(editorCode.includes('computeAnchoredZoomScrollLeft'), 'TimelineEditor must anchor zoom on playhead');
    assert.ok(editorCode.includes('computeScrollToRevealPlayhead'), 'TimelineEditor must reveal playhead on seek');
    assert.ok(seriesCode.includes('loadEpisodeTimelineViewState'), 'useSeriesManager must restore per-episode playhead on load/reload');
    assert.ok(!seriesCode.includes('TIMELINE_VIEW_STATE'), 'View state must never be stored in series.json snapshots');
    assert.ok(playbackCode.includes('desiredTlTime') && playbackCode.includes('currentTimeRef.current'), 'useVideoPlayback must cue <video> on metadata load to restored playhead');
  });
});
