const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let splitterMod;
let projectStorageMod;

test.before(async () => {
  splitterMod = await import(
    pathToFileURL(path.join(__dirname, '../../frontend/src/utils/khmerTextSplitter.js')).href
  );
  projectStorageMod = await import(
    pathToFileURL(path.join(__dirname, '../../frontend/src/utils/projectStorage.js')).href
  );
});

test('getLivePagedSubtitle never returns empty for any active segment with Khmer text', () => {
  const shortSeg = {
    startSec: 0,
    endSec: 1.5,
    khmerText: 'ហ៊ានបាំងផ្លូវអ្នកណា!',
  };
  assert.equal(splitterMod.getLivePagedSubtitle(shortSeg, 0.5), 'ហ៊ានបាំងផ្លូវអ្នកណា!');

  const longSeg = {
    startSec: 25,
    endSec: 30,
    audioStartSec: 25,
    finalAudioDuration: 4.2,
    khmerText: 'ពេលក្រោយមក ខ្ញុំបានបញ្ចូលកម្លាំងនុយក្លេអ៊ែរក្នុងដំណាក់កាលរួមបញ្ចូលគ្នា ហើយបង្កើតបានផ្កាយរណបមួយយ៉ាងអស្ចារ្យ',
  };

  for (const t of [-1, 0, 24.5, 25.0, 26.0, 27.1, 28.5, 29.2, 35.0, NaN, undefined, null]) {
    const out = splitterMod.getLivePagedSubtitle(longSeg, t);
    assert.ok(typeof out === 'string' && out.trim().length > 0, `Expected non-empty subtitle at t=${t}, got "${out}"`);
  }

  // Long text with no spaces at all still splits and never returns empty
  const noSpaceLongSeg = {
    startSec: 10,
    endSec: 14,
    khmerText: 'ក'.repeat(90),
  };
  for (const t of [9, 10, 11, 12, 13, 15]) {
    const out = splitterMod.getLivePagedSubtitle(noSpaceLongSeg, t);
    assert.ok(out.length > 0, `Expected non-empty subtitle for spaceless text at t=${t}`);
  }

  // Empty segment returns empty string
  assert.equal(splitterMod.getLivePagedSubtitle({ startSec: 0, endSec: 2, khmerText: '   ' }, 1), '');
  assert.equal(splitterMod.getLivePagedSubtitle(null, 1), '');
});

test('findActiveSubtitleSegment never misses overlapping segments and returns null in gaps', () => {
  const raw = [
    { start: 0, end: 2, seg: { id: 1 } },
    { start: 10, end: 15, seg: { id: 2 } },
    { start: 12, end: 13, seg: { id: 3 } }, // nested inside seg #2
    { start: 20, end: 22, seg: { id: 4 } },
  ];
  let maxEnd = -Infinity;
  const indexed = raw.map((it) => {
    maxEnd = Math.max(maxEnd, it.end);
    return { ...it, maxEnd };
  });

  assert.equal(splitterMod.findActiveSubtitleSegment(indexed, 0.5)?.id, 1);
  assert.equal(splitterMod.findActiveSubtitleSegment(indexed, 5.0), null);
  assert.equal(splitterMod.findActiveSubtitleSegment(indexed, 11.0)?.id, 2);
  assert.equal(splitterMod.findActiveSubtitleSegment(indexed, 12.5)?.id, 3);
  // Critical overlap case: naive binary search missed seg #2 at t=14 because mid landed on seg #3 [12..13]
  assert.equal(splitterMod.findActiveSubtitleSegment(indexed, 14.0)?.id, 2);
  assert.equal(splitterMod.findActiveSubtitleSegment(indexed, 16.0), null);
  assert.equal(splitterMod.findActiveSubtitleSegment(indexed, 21.0)?.id, 4);
  assert.equal(splitterMod.findActiveSubtitleSegment(indexed, NaN), null);
});

test('isRenderedVideoBurnedWithSubtitles detects stale/pre-fix and burned exports while allowing unburned renders', () => {
  const { isRenderedVideoBurnedWithSubtitles } = projectStorageMod;
  assert.equal(isRenderedVideoBurnedWithSubtitles(null), false);
  assert.equal(isRenderedVideoBurnedWithSubtitles(undefined), false);
  // Legacy / stale pre-fix renderedVideo objects without subtitlesBurned flag are treated as burned (no doubling!)
  assert.equal(isRenderedVideoBurnedWithSubtitles({ outputVideoUrl: '/uploads/old_export.mp4' }), true);
  assert.equal(isRenderedVideoBurnedWithSubtitles('/uploads/old_export.mp4'), true);
  assert.equal(isRenderedVideoBurnedWithSubtitles({ outputVideoUrl: '/uploads/new.mp4', subtitlesBurned: true }), true);
  // Explicit unburned render is safe for preview under LiveSubtitleOverlay
  assert.equal(isRenderedVideoBurnedWithSubtitles({ outputVideoUrl: '/uploads/clean.mp4', subtitlesBurned: false }), false);
});

test('Single subtitle source wiring: LiveSubtitleOverlay removes renderedVideo guard; preview avoids burned MP4s; exports keep burning', () => {
  const overlayCode = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/components/player/LiveSubtitleOverlay.jsx'),
    'utf8'
  );
  const appCode = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/App.jsx'),
    'utf8'
  );
  const videoRoutesCode = fs.readFileSync(
    path.join(__dirname, '../routes/videoRoutes.js'),
    'utf8'
  );
  const batchExportCode = fs.readFileSync(
    path.join(__dirname, '../services/batchExportService.js'),
    'utf8'
  );
  const stage10Code = fs.readFileSync(
    path.join(__dirname, '../services/pipeline/stages/stage10_previewAndExport.js'),
    'utf8'
  );

  // LiveSubtitleOverlay must NOT early-return on renderedVideo, and must keep burnSubtitles === false check
  assert.doesNotMatch(overlayCode, /\|\|\s*renderedVideo/);
  assert.match(overlayCode, /voiceSettings\.burnSubtitles\s*===\s*false/);
  assert.match(overlayCode, /size-large/);
  assert.match(overlayCode, /style-\$\{effectiveStyle\}/);

  // App.jsx filters burned/stale renderedVideo out of preview player while keeping effectiveRenderedVideo for download UI
  assert.match(appCode, /isRenderedVideoBurnedWithSubtitles/);
  assert.match(appCode, /const previewRenderedVideo\s*=/);
  assert.match(appCode, /renderedVideo=\{previewRenderedVideo\}/);
  assert.match(appCode, /renderedVideo=\{effectiveRenderedVideo\}/);

  // Final export and batch export keep burning subtitles untouched and tag subtitlesBurned
  assert.match(videoRoutesCode, /burnSubtitles:\s*Boolean\(burnSubtitles\)/);
  assert.match(videoRoutesCode, /subtitlesBurned:\s*Boolean\(burnSubtitles\)/);
  assert.match(batchExportCode, /burnSubtitles:\s*epPlan\.hasVoice\s*\?\s*burnSubtitles\s*:\s*false/);
  assert.match(batchExportCode, /subtitlesBurned:\s*epSubtitlesBurned/);

  // Stage 10 preview mode skips burning subtitles while export keeps burning
  assert.match(stage10Code, /exportOptions\.isPreviewRender\s*\?\s*false/);
});
