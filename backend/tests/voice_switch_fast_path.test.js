const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

describe('Single-Segment Voice Switch Fast Path & Honest Generating Status', () => {
  it('1. useAudioDubbing.handleUpdateSegmentVoice avoids full-episode sync-audio and full-series /sync contention while showing honest generating status', () => {
    const hookSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useAudioDubbing.js'), 'utf8').replace(/\r\n/g, '\n');
    const fnStart = hookSrc.indexOf('const handleUpdateSegmentVoice = async');
    assert.ok(fnStart > 0, 'handleUpdateSegmentVoice must exist');
    const fnEnd = hookSrc.indexOf('// 1-Click', fnStart);
    assert.ok(fnEnd > fnStart, 'handleUpdateSegmentVoice end marker must exist');
    const fnBody = hookSrc.slice(fnStart, fnEnd);

    assert.ok(fnBody.includes('suppressNextBackendSync('), 'Must suppress redundant full-series /sync during single-segment voice switch');
    assert.ok(
      fnBody.includes("textStatus: 'generating'") &&
      fnBody.includes('isVoiceSwitching: true') &&
      fnBody.includes('audioOutdated: true') &&
      fnBody.includes('previousAudioUrl'),
      'Must preserve previous audioUrl for waveform safety while marking textStatus=generating, isVoiceSwitching=true, and audioOutdated=true'
    );
    assert.ok(fnBody.includes("textStatus: 'ready'"), 'Must mark textStatus=ready only when new voice audio resolves');
    assert.ok(fnBody.includes('skipPeerDiskScan: true'), 'Must pass skipPeerDiskScan to avoid pre-TTS 17MB series.json disk read');
    assert.ok(fnBody.includes('speakerUpdate:'), 'Must forward speakerUpdate so backend persists manual assignment atomically');
    assert.ok(!fnBody.includes('syncTimelineAudioApi('), 'Must NOT fire 7-10s full-episode syncTimelineAudioApi on single-segment voice switch');
  });

  it('1b. TimelineTracksCanvas renders honest generating status indicator while keeping waveform visible', () => {
    const canvasSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(canvasSrc.includes("const isGeneratingVoice = seg.textStatus === 'generating'"), 'Timeline clip must read generating state from seg.textStatus');
    assert.ok(canvasSrc.includes("កំពុងបង្កើត...") && canvasSrc.includes('data-voice-generating'), 'Timeline clip must expose honest generating indicator while waveform stays rendered');
  });

  it('2. Backend /api/generate-audio honors skipPeerDiskScan, persists speakerUpdate, and unlinks stale master narration', () => {
    const routeSrc = fs.readFileSync(path.join(rootDir, 'backend/routes/audioRoutes.js'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(routeSrc.includes('if (req.body.skipPeerDiskScan)'), 'Route must support skipPeerDiskScan fast path');
    assert.ok(routeSrc.includes('req.body.speakerUpdate'), 'Route must persist speakerUpdate atomically in series.json');
    assert.ok(routeSrc.includes('staleMasterPath') && routeSrc.includes('fs.promises.unlink(staleMasterPath)'), 'Route must invalidate stale master narration asynchronously');
  });

  it('3. App.jsx invalidateRenderedPreview skips synchronous save/sync when no rendered video exists', () => {
    const appSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(appSrc.includes('if (isActiveEp && !hasActiveRendered)'), 'invalidateRenderedPreview must short-circuit when active episode has no renderedVideo');
  });

  it('4. ClipInspectorPanel renders honest Generating badge during voice switch (never false Audio Ready)', () => {
    const panelSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/components/voice/ClipInspectorPanel.jsx'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(panelSrc.includes('(isGenerating || switchingVoiceTarget !== null)'), 'Badge must check both isGenerating and switchingVoiceTarget');
    assert.ok(panelSrc.includes('កំពុងបង្កើតសំឡេង... (Generating)'), 'Badge must display honest Generating text while waiting');
  });
});
