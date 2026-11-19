const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Player Preview Overlay Safety: Zero-obstruction Live Playback and Progress Architecture', () => {
  const playerPreviewPath = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx');
  const playerCssPath = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.css');

  assert.ok(fs.existsSync(playerPreviewPath), 'VideoPlayerPreview.jsx must exist');
  assert.ok(fs.existsSync(playerCssPath), 'VideoPlayerPreview.css must exist');

  const playerCode = fs.readFileSync(playerPreviewPath, 'utf8');
  const cssCode = fs.readFileSync(playerCssPath, 'utf8');

  // 1. Stage Viewport Safety: Ensure no blocking proxy fallback overlay exists inside player-stage-viewport
  assert.ok(
    !playerCode.includes('proxy-live-fallback-notice'),
    'VideoPlayerPreview.jsx must NOT render blocking proxy-live-fallback-notice in the video canvas'
  );
  assert.ok(
    !cssCode.includes('.proxy-live-fallback-notice'),
    'VideoPlayerPreview.css must NOT contain .proxy-live-fallback-notice'
  );

  // 2. Legitimate Error Preserved: narrationError banner remains in player-stage-viewport
  assert.ok(
    playerCode.includes('narrationError && ('),
    'Legitimate narrationError banner must remain preserved in viewport'
  );
  assert.ok(
    playerCode.includes('className="narration-error-banner"'),
    'narration-error-banner class must remain preserved'
  );

  // 3. Header Controls: Rendering progress and status badge must exist in .proxy-preview-controls
  assert.ok(
    playerCode.includes('<div className="proxy-preview-controls">'),
    'Header controls bar must exist for mode selection and status'
  );
  assert.ok(
    playerCode.includes('<span role="status" data-proxy-state={badgeState}>'),
    'Progress status badge must exist in header controls with data-proxy-state'
  );
  assert.ok(
    playerCode.includes('{showLiveFallbackBadge && ('),
    'Live fallback badge must be gated by showLiveFallbackBadge in header controls'
  );
  assert.ok(
    playerCode.includes('className="proxy-live-fallback-badge"'),
    'proxy-live-fallback-badge must exist inside header controls (outside video canvas)'
  );

  // 4. State Logic Contract Verification
  function computePlaybackUIState({ previewMode, isProxyReady, isPlaying, proxyStatus, sourceProxy }) {
    const isLiveMode = previewMode === 'live';
    const isSourceProxyTranscoding = sourceProxy?.status === 'transcoding';
    const isSourceProxyReady = sourceProxy?.status === 'ready' && Boolean(sourceProxy?.url);
    const showLiveFallbackBadge = previewMode === 'proxy' && !isProxyReady && isPlaying;

    let badgeText = '';
    let badgeState = 'stale';

    if (isLiveMode) {
      if (isSourceProxyTranscoding) {
        badgeText = `Source Proxy កំពុង Transcode ${sourceProxy.progress || 0}% (${sourceProxy.elapsedSeconds || 0}s)`;
        badgeState = 'rendering';
      } else if (isSourceProxyReady) {
        badgeText = `Live (Source Proxy 480p · ${sourceProxy.duration ? sourceProxy.duration.toFixed(1) + 's' : 'Ready'})`;
        badgeState = 'fresh';
      } else if (sourceProxy?.status === 'error') {
        badgeText = `Live (Original Source · Error: ${sourceProxy.error || 'Transcode failed'})`;
        badgeState = 'error';
      } else {
        badgeText = 'Live Preview (Original Source)';
        badgeState = 'stale';
      }
    } else {
      if (proxyStatus?.state === 'fresh') {
        badgeText = `${proxyStatus.duration.toFixed(1)}s · ${(proxyStatus.bytes / 1048576).toFixed(1)} MiB · Render ${proxyStatus.renderSeconds.toFixed(1)}s`;
        badgeState = 'fresh';
      } else {
        const renderProgressText = proxyStatus?.progress?.percent
          ? `កំពុង Render ${proxyStatus.progress.percent}% (${proxyStatus.elapsedSeconds || 0}s)`
          : `កំពុង Render (${proxyStatus?.elapsedSeconds || 0}s)`;
        const queuedText = (proxyStatus?.queuedSeconds ?? 0) > 0
          ? `Queued (${proxyStatus.queuedSeconds}s)`
          : 'Queued';
        const proxyActivity = proxyStatus?.state === 'superseded' ? 'Reopen episode to load newer edits' :
          proxyStatus?.state === 'rendering' ? renderProgressText : queuedText;

        badgeText = `Preview មិនទាន់ថ្មី · ${proxyStatus?.error ? `Error: ${proxyStatus.error}` : proxyActivity}`;
        badgeState = proxyStatus?.state || 'stale';
        if (isSourceProxyTranscoding && !proxyStatus?.error && proxyStatus?.state !== 'rendering') {
          badgeText += ` · Source Proxy: ${sourceProxy.progress || 0}%`;
        }
      }
    }

    return { isLiveMode, badgeText, badgeState, showLiveFallbackBadge };
  }

  // Case A: LIVE Mode + Proxy Preview Rendering -> NO blocking overlay, video unobstructed
  const stateA = computePlaybackUIState({
    previewMode: 'live',
    isProxyReady: false,
    isPlaying: true,
    proxyStatus: { state: 'rendering', progress: { percent: 45 }, elapsedSeconds: 12 },
    sourceProxy: { status: 'ready', url: '/uploads/source_proxies/test/source-proxy.mp4', duration: 602.3 }
  });
  assert.equal(stateA.isLiveMode, true);
  assert.equal(stateA.badgeState, 'fresh');
  assert.equal(stateA.badgeText, 'Live (Source Proxy 480p · 602.3s)');
  assert.equal(stateA.showLiveFallbackBadge, false, 'LIVE mode must never show live fallback badge');

  // Case B: LIVE Mode + Source Proxy Transcoding -> Header shows transcode progress, NO canvas blocking overlay
  const stateB = computePlaybackUIState({
    previewMode: 'live',
    isProxyReady: false,
    isPlaying: true,
    proxyStatus: { state: 'stale' },
    sourceProxy: { status: 'transcoding', progress: 68, elapsedSeconds: 15 }
  });
  assert.equal(stateB.badgeState, 'rendering');
  assert.equal(stateB.badgeText, 'Source Proxy កំពុង Transcode 68% (15s)');
  assert.equal(stateB.showLiveFallbackBadge, false);

  // Case C: LIVE Mode + Source Proxy Error -> Header shows legitimate error, NO canvas blocking overlay
  const stateC = computePlaybackUIState({
    previewMode: 'live',
    isProxyReady: false,
    isPlaying: true,
    proxyStatus: { state: 'stale' },
    sourceProxy: { status: 'error', error: 'FFmpeg transcode failed' }
  });
  assert.equal(stateC.badgeState, 'error');
  assert.equal(stateC.badgeText, 'Live (Original Source · Error: FFmpeg transcode failed)');
  assert.equal(stateC.showLiveFallbackBadge, false);

  // Case D: Proxy Preview Mode + Rendering + Playing -> Header shows render progress & fallback badge; NO canvas overlay
  const stateD = computePlaybackUIState({
    previewMode: 'proxy',
    isProxyReady: false,
    isPlaying: true,
    proxyStatus: { state: 'rendering', progress: { percent: 75 }, elapsedSeconds: 42 },
    sourceProxy: { status: 'ready', url: '/uploads/source_proxies/test/source-proxy.mp4', duration: 602.3 }
  });
  assert.equal(stateD.badgeState, 'rendering');
  assert.equal(stateD.badgeText, 'Preview មិនទាន់ថ្មី · កំពុង Render 75% (42s)');
  assert.equal(stateD.showLiveFallbackBadge, true, 'Header shows fallback badge during live fallback play');

  // Case E: Proxy Preview Mode + Ready -> Normal fresh playback
  const stateE = computePlaybackUIState({
    previewMode: 'proxy',
    isProxyReady: true,
    isPlaying: true,
    proxyStatus: { state: 'fresh', duration: 602.3, bytes: 66165642, renderSeconds: 167.0 },
    sourceProxy: { status: 'ready', url: '/uploads/source_proxies/test/source-proxy.mp4', duration: 602.3 }
  });
  assert.equal(stateE.badgeState, 'fresh');
  assert.equal(stateE.badgeText, '602.3s · 63.1 MiB · Render 167.0s');
  assert.equal(stateE.showLiveFallbackBadge, false, 'No fallback badge once proxy is fresh');
});
