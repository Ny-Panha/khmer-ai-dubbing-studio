const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND_SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf-8');
}

test('Step 1: DubbingRunnerContext exports DubbingRunnerProvider and strictly implements 1-by-1 sequential loop', () => {
  const ctx = read(FRONTEND_SRC, 'features', 'dubbing-runner', 'DubbingRunnerContext.jsx');
  assert.match(ctx, /export\s+function\s+DubbingRunnerProvider/);
  assert.match(ctx, /runSingleTranslate/);
  assert.match(ctx, /runSingleVoice/);
  assert.match(ctx, /runSingleCleanBgm/);
  assert.match(ctx, /runSingleEpisodeAll3/);
  assert.match(ctx, /runSequentialStep/);
  assert.match(ctx, /stopStep/);
  // Ensure strict sequential loop (for loop with await on single episode)
  assert.match(ctx, /for\s*\(\s*let\s+idx\s*=\s*0;\s*idx\s*<\s*queue\.length;\s*idx\+\+\s*\)/);
  assert.match(ctx, /await\s+runSingleTranslate/);
  assert.match(ctx, /await\s+runSingleVoice/);
  assert.match(ctx, /await\s+runSingleCleanBgm/);
  assert.match(ctx, /await\s+runSingleEpisodeAll3/);
  // Auto-target without throwing blocking dialogs
  assert.doesNotMatch(ctx, /សូមជ្រើសរើសភាគជាមុនសិន/);
});

test('Step 1b: useDubbingFeature hook exports runner states and step triggers', () => {
  const hook = read(FRONTEND_SRC, 'features', 'dubbing-runner', 'useDubbingFeature.js');
  assert.match(hook, /export\s+function\s+useDubbingFeature/);
  assert.match(hook, /runnerStates/);
  assert.match(hook, /runSequentialStep/);
  assert.match(hook, /stopStep/);
  assert.match(hook, /stats/);
});

test('Step 2: DubbingStepCardsBar renders 3 cards with live progress and Run 1-by-1 / Stop controls', () => {
  const bar = read(FRONTEND_SRC, 'features', 'dubbing-runner', 'DubbingStepCardsBar.jsx');
  assert.match(bar, /export\s+default\s+function\s+DubbingStepCardsBar/);
  assert.match(bar, /data-testid="batch-step-status-rows"/);
  assert.match(bar, /data-testid="step-row-translate"/);
  assert.match(bar, /data-testid="step2-status-badge"/);
  assert.match(bar, /data-testid="step-row-tts"/);
  assert.match(bar, /data-testid="step3-status-badge"/);
  assert.match(bar, /data-testid="step-row-demucs"/);
  assert.match(bar, /data-testid="step4-status-badge"/);
  assert.match(bar, /Run 1-by-1/);
  assert.match(bar, /Stop/);
  assert.match(bar, /runSequentialStep\('translate'/);
  assert.match(bar, /runSequentialStep\('voice'/);
  assert.match(bar, /runSequentialStep\('clean_bgm'/);
});

test('Step 2b: DubbingStepButton provides universal multi-variant button with live progress and stop toggle', () => {
  const btn = read(FRONTEND_SRC, 'features', 'dubbing-runner', 'DubbingStepButton.jsx');
  assert.match(btn, /export\s+default\s+function\s+DubbingStepButton/);
  assert.match(btn, /runSequentialStep/);
  assert.match(btn, /runSingleTranslate/);
  assert.match(btn, /runSingleVoice/);
  assert.match(btn, /runSingleCleanBgm/);
  assert.match(btn, /runSingleEpisodeAll3/);
  assert.match(btn, /stopStep/);
  assert.match(btn, /btn-tactile/);
});

test('Step 2c: index.js barrel exports all feature elements cleanly', () => {
  const index = read(FRONTEND_SRC, 'features', 'dubbing-runner', 'index.js');
  assert.match(index, /DubbingRunnerProvider/);
  assert.match(index, /useDubbingFeature/);
  assert.match(index, /DubbingStepCardsBar/);
  assert.match(index, /DubbingStepButton/);
});

test('Step 3: App.jsx wraps the application tree with DubbingRunnerProvider', () => {
  const app = read(FRONTEND_SRC, 'App.jsx');
  assert.match(app, /DubbingRunnerProvider/);
  assert.match(app, /<DubbingRunnerProvider/);
});

test('Step 3b: GeminiRouteModal integrates DubbingStepCardsBar and DubbingStepButton', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  assert.match(modal, /import\s+.*DubbingStepCardsBar.*from\s+['"]\.\.\/\.\.\/features\/dubbing-runner['"]/);
  assert.match(modal, /<DubbingStepCardsBar/);
  assert.match(modal, /<DubbingStepButton/);
});

test('Step 3c: EpisodesTab, DubbingModeTab, and VoiceSettings integrate the dubbing-runner feature', () => {
  const epTab = read(FRONTEND_SRC, 'components', 'media', 'EpisodesTab.jsx');
  assert.match(epTab, /DubbingStepButton/);

  const dubTab = read(FRONTEND_SRC, 'components', 'media', 'DubbingModeTab.jsx');
  assert.match(dubTab, /DubbingStepButton/);

  const voiceTab = read(FRONTEND_SRC, 'components', 'voice', 'VoiceSettings.jsx');
  assert.match(voiceTab, /DubbingStepButton/);
});

test('Step 4: api.js provides unified Demucs vocal separation endpoints', () => {
  const api = read(FRONTEND_SRC, 'services', 'api.js');
  assert.match(api, /export\s+async\s+function\s+separateAudioApi/);
  assert.match(api, /export\s+async\s+function\s+getSeparationProgressApi/);
  assert.match(api, /export\s+async\s+function\s+getSeparationStatusApi/);
  assert.match(api, /export\s+async\s+function\s+killSeparationApi/);
});

