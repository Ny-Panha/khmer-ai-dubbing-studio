const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const {
  registerProcess,
  unregisterProcess,
  killProcessesByJob,
  killAllProcesses,
  getActiveProcesses,
} = require('../utils/processRegistry');

const {
  sendSuccess,
  sendError,
  requireBodyFields,
  validateJsonBodyEnvelope,
} = require('../middleware/validateRequest');

test('Phase 1: Frontend hooks, contexts, and barrel exports exist and are wired in App.jsx', () => {
  const rootDir = path.resolve(__dirname, '../../frontend/src');
  const appCode = fs.readFileSync(path.join(rootDir, 'App.jsx'), 'utf8');
  const playbackEngineCode = fs.readFileSync(path.join(rootDir, 'hooks/usePlaybackEngine.js'), 'utf8');
  const modalContextCode = fs.readFileSync(path.join(rootDir, 'context/ModalContext.jsx'), 'utf8');
  const workspaceContextCode = fs.readFileSync(path.join(rootDir, 'context/WorkspaceContext.jsx'), 'utf8');

  // Verify hooks & contexts
  assert.match(playbackEngineCode, /requestAnimationFrame/);
  assert.match(playbackEngineCode, /export function usePlaybackEngine/);
  assert.match(modalContextCode, /export function useModalManager/);
  assert.match(modalContextCode, /export function ModalProvider/);
  assert.match(workspaceContextCode, /export function useStudioWorkspace/);
  assert.match(workspaceContextCode, /export function WorkspaceProvider/);

  // Verify App.jsx integration
  assert.match(appCode, /usePlaybackEngine/);
  assert.match(appCode, /<ModalProvider/);
  assert.match(appCode, /<WorkspaceProvider/);

  // Verify feature folder barrel exports
  for (const folder of ['layout', 'media', 'player', 'voice', 'timeline']) {
    const indexFile = path.join(rootDir, 'components', folder, 'index.js');
    assert.ok(fs.existsSync(indexFile), `Barrel export must exist at components/${folder}/index.js`);
  }
});

test('Phase 2: CapCut Pro OKLCH tokens, Khmer line-height 1.68, resizable split panes, and NLE UI upgrades', () => {
  const rootDir = path.resolve(__dirname, '../../frontend/src');
  const tokensCss = fs.readFileSync(path.join(rootDir, 'styles/tokens.css'), 'utf8');
  const layoutCss = fs.readFileSync(path.join(rootDir, 'styles/layout.css'), 'utf8');
  const panelsCode = fs.readFileSync(path.join(rootDir, 'hooks/useResizablePanels.js'), 'utf8');
  const navbarCode = fs.readFileSync(path.join(rootDir, 'components/layout/Navbar.jsx'), 'utf8');
  const playerControlsCode = fs.readFileSync(path.join(rootDir, 'components/player/PlayerControls.jsx'), 'utf8');
  const voiceSettingsCode = fs.readFileSync(path.join(rootDir, 'components/voice/VoiceSettings.jsx'), 'utf8');
  const clipInspectorCode = fs.readFileSync(path.join(rootDir, 'components/voice/ClipInspectorPanel.jsx'), 'utf8');
  const trackHeadersCode = fs.readFileSync(path.join(rootDir, 'components/timeline/TimelineTrackHeaders.jsx'), 'utf8');
  const tracksCanvasCode = fs.readFileSync(path.join(rootDir, 'components/timeline/TimelineTracksCanvas.jsx'), 'utf8');

  // 1. OKLCH tokens & Khmer typography
  assert.match(tokensCss, /--khmer-line-height:\s*1\.68/);
  assert.match(tokensCss, /oklch\(0\.72 0\.14 195\)/);
  assert.match(tokensCss, /oklch\(0\.70 0\.17 350\)/);
  assert.match(tokensCss, /oklch\(0\.68 0\.16 250\)/);
  assert.match(tokensCss, /oklch\(0\.68 0\.17 295\)/);

  // 2. Resizable 3-column + bottom timeline & Navbar collapse toggles
  assert.match(layoutCss, /\.capcut-panel-splitter-horizontal/);
  assert.match(panelsCode, /MIN_TIMELINE_HEIGHT = 220/);
  assert.match(panelsCode, /MAX_TIMELINE_HEIGHT = 450/);
  assert.match(panelsCode, /toggleLeftPanel/);
  assert.match(panelsCode, /toggleRightPanel/);
  assert.match(panelsCode, /toggleTimelinePanel/);
  assert.match(navbarCode, /toggle-left-panel-btn/);
  assert.match(navbarCode, /toggle-timeline-panel-btn/);
  assert.match(navbarCode, /toggle-right-panel-btn/);

  // 3. Player controls: precision timecode, 16:9 | 9:16 | 1:1 | Fit, and live Ducking dB meter
  assert.match(playerControlsCode, /formatPrecisionTimecode/);
  assert.match(playerControlsCode, /player-ducking-db-meter/);
  assert.match(playerControlsCode, /id:\s*'fit'/);
  assert.match(playerControlsCode, /player-ratio-\$\{opt\.id\}/);

  // 4. Right Inspector: Character Voice Mapping accordion, sticky Export CTA, and inline voice switch spinner
  assert.match(voiceSettingsCode, /inspector-character-mapping-card/);
  assert.match(voiceSettingsCode, /inspector-sticky-export-bar/);
  assert.match(clipInspectorCode, /switchingVoiceTarget/);

  // 5. Timeline: translate3d 60fps playhead and Solo (S) / Mute (M) / Lock track headers
  assert.match(tracksCanvasCode, /translate3d\(\$\{playheadX\}px, 0, 0\)/);
  assert.match(trackHeadersCode, /is-active-solo/);
  assert.match(trackHeadersCode, /CLEAN BGM/);
});

test('Phase 3: Backend processRegistry, validateRequest middleware, and scoped 5mb JSON limit', () => {
  const serverCode = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  assert.match(serverCode, /express\.json\(\{\s*limit:\s*"5mb"\s*\}\)/);
  assert.match(serverCode, /killAllProcesses/);
  assert.match(serverCode, /validateJsonBodyEnvelope/);

  // Test processRegistry lifecycle with mock child processes
  const mockProc1 = new EventEmitter();
  mockProc1.pid = 999001;
  mockProc1.killed = false;
  mockProc1.kill = () => {
    mockProc1.killed = true;
  };

  const mockProc2 = new EventEmitter();
  mockProc2.pid = 999002;
  mockProc2.killed = false;
  mockProc2.kill = () => {
    mockProc2.killed = true;
  };

  registerProcess(mockProc1, { type: 'demucs', jobId: 'job_test_1', label: 'ep1.mp4' });
  registerProcess(mockProc2, { type: 'ffmpeg', jobId: 'job_test_2', label: 'ep2.mp4' });

  const active = getActiveProcesses();
  assert.ok(active.some((p) => p.pid === 999001 && p.type === 'demucs'));
  assert.ok(active.some((p) => p.pid === 999002 && p.type === 'ffmpeg'));

  const killedJob1 = killProcessesByJob('job_test_1');
  assert.equal(killedJob1, 1);
  assert.equal(mockProc1.killed, true);

  unregisterProcess(mockProc2);
  killAllProcesses();

  // Test validateRequest middleware
  let capturedStatus = null;
  let capturedJson = null;
  const mockRes = {
    status(code) {
      capturedStatus = code;
      return this;
    },
    json(payload) {
      capturedJson = payload;
      return this;
    },
  };

  const checkMiddleware = requireBodyFields(['videoPath', 'seriesId']);
  let nextCalled = false;
  checkMiddleware({ body: { videoPath: '/uploads/test.mp4' } }, mockRes, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(capturedStatus, 400);
  assert.equal(capturedJson.success, false);
  assert.match(capturedJson.error, /Missing required field: seriesId/);

  checkMiddleware({ body: { videoPath: '/uploads/test.mp4', seriesId: 's_1' } }, mockRes, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  sendSuccess(mockRes, { ok: true }, 200);
  assert.equal(capturedStatus, 200);
  assert.equal(capturedJson.success, true);

  sendError(mockRes, 'Custom validation error', 422);
  assert.equal(capturedStatus, 422);
  assert.equal(capturedJson.success, false);
  assert.equal(capturedJson.error, 'Custom validation error');
});
