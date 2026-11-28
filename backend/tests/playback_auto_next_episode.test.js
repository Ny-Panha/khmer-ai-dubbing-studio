const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Auto-Next Episode: useVideoPlayback wires finishPlaybackAtEnd + armAutoPlayNextEpisode across all end paths', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/hooks/useVideoPlayback.js'),
    'utf8'
  );
  assert.ok(src.includes('onEpisodeEnded = null'));
  assert.ok(src.includes('pendingAutoPlayEpisodeRef'));
  assert.ok(src.includes('endDispatchedForKeyRef'));
  assert.ok(src.includes('const armAutoPlayNextEpisode = useCallback'));
  assert.ok(src.includes('const finishPlaybackAtEnd = useCallback'));
  assert.ok(src.includes('finishPlaybackAtEnd(duration > 0 ? duration : realDur)'));
  assert.ok(src.includes('finishPlaybackAtEnd(Number.isFinite(cEnd) ? cEnd : null)'));
  assert.ok(src.includes('return {\n    currentTime,') || src.includes('armAutoPlayNextEpisode,'));
});

test('Auto-Next Episode: App.jsx & PlayerControls.jsx expose persisted Auto-Next toggle and switch to next episode on end', () => {
  const appSrc = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/App.jsx'),
    'utf8'
  );
  const controlsSrc = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/components/player/PlayerControls.jsx'),
    'utf8'
  );
  const previewSrc = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx'),
    'utf8'
  );

  assert.ok(appSrc.includes('kads_auto_next_episode'));
  assert.ok(appSrc.includes('handleEpisodePlaybackEnded'));
  assert.ok(appSrc.includes('armAutoPlayNextEpisode'));
  assert.ok(appSrc.includes('handleSwitchEpisode'));
  assert.ok(appSrc.includes('onEpisodeEnded: handleEpisodePlaybackEnded'));

  assert.ok(previewSrc.includes('autoNextEpisode = true'));
  assert.ok(previewSrc.includes('onToggleAutoNextEpisode = null'));

  assert.ok(controlsSrc.includes('data-testid="btn-toggle-auto-next"'));
  assert.ok(controlsSrc.includes('ListVideo'));
  assert.ok(controlsSrc.includes('data-testid="player-speed-group"'));
  assert.ok(controlsSrc.includes('[1, 2, 3, 4]'));

  const playbackSrc = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/hooks/useVideoPlayback.js'),
    'utf8'
  );
  assert.ok(playbackSrc.includes('kads_player_playback_rate'));
  assert.ok(playbackSrc.includes('[1, 2, 3, 4].includes'));
  assert.ok(playbackSrc.includes('v.playbackRate = targetRate'));
});
