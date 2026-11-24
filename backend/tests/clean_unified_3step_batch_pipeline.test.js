const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND_SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf-8');
}

test('Step 1: Top selection pills show accurate counts and include incompleteEpisodes', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  assert.match(modal, /pill-select-all/);
  assert.match(modal, /pill-select-incomplete/);
  assert.match(modal, /ទាំងអស់\s*\(\$\{episodes\.length\}\s*ភាគ\)/);
  assert.match(modal, /ភាគមិនទាន់ចប់\s*\(\$\{incompleteEpisodes\.length\}\s*ភាគ\)/);
  assert.match(modal, /២ ភាគដំបូង \(2 EPs\)/);
  assert.match(modal, /៤ ភាគដំបូង \(4 EPs\)/);
  assert.match(modal, /ដកជ្រើសរើស/);
  assert.match(modal, /episodeFilterMode/);
  assert.match(modal, /visibleEpisodeEntries\.map/);
  assert.match(modal, /!isEpisodeFullyDone\(ep\)/);
});

test('Step 1b: Elimination of blocking warning modal when selectedEpIds is empty', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  // Check that handleStartBatchTranslate, handleBatchGenerateTTS, handleBatchDemucsSeparation, handleRunAll3Steps auto-target
  assert.doesNotMatch(modal, /សូមជ្រើសរើសភាគដែលចង់ Translate ជាមុនសិន/);
  assert.doesNotMatch(modal, /សូមជ្រើសរើសភាគដែលចង់បង្កើតសំឡេង AI ជាមុនសិន/);
  assert.doesNotMatch(modal, /សូមជ្រើសរើសភាគដែលចង់បំបែកសំឡេង Demucs AI ជាមុនសិន/);
  assert.doesNotMatch(modal, /សូមជ្រើសរើសភាគដែលចង់ដំណើរការ Auto-Pipeline ទាំង 3 មុខងារ/);
});

test('Step 2: Unified 3-step pipeline engine for batch & individual cards', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  assert.match(modal, /handleRunAll3Steps/);
  assert.match(modal, /ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន/);
});

test('Step 3: Decluttered top header - script setup collapsed & single compact progress summary', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  const cardsBarPath = path.join(FRONTEND_SRC, 'features', 'dubbing-runner', 'DubbingStepCardsBar.jsx');
  const cardsBar = fs.existsSync(cardsBarPath) ? fs.readFileSync(cardsBarPath, 'utf8') : '';
  const combined = modal + '\n' + cardsBar;
  assert.match(modal, /const\s+\[isScriptSetupExpanded,\s*setIsScriptSetupExpanded\]\s*=\s*useState\(false\)/);
  assert.match(combined, /gridTemplateColumns:\s*'repeat\((3|4|auto-fit),\s*minmax\(/);
  assert.match(combined, /1\. Script ខ្មែរ:/);
  assert.match(combined, /2\. សំឡេង AI:/);
  assert.match(combined, /Clean BGM:/);
});

test('Step 4: Route runner console drawers default collapsed to preserve screen height', () => {
  const translateCard = read(FRONTEND_SRC, 'components', 'dashboard', 'route-runners', 'EpisodeTranslateProgressCard.jsx');
  const ttsCard = read(FRONTEND_SRC, 'components', 'dashboard', 'route-runners', 'EpisodeTtsProgressCard.jsx');
  const demucsCard = read(FRONTEND_SRC, 'components', 'dashboard', 'route-runners', 'EpisodeDemucsProgressCard.jsx');

  assert.match(translateCard, /const\s+\[showConsole,\s*setShowConsole\]\s*=\s*useState\(false\)/);
  assert.match(ttsCard, /const\s+\[showConsole,\s*setShowConsole\]\s*=\s*useState\(false\)/);
  assert.match(demucsCard, /const\s+\[showConsole,\s*setShowConsole\]\s*=\s*useState\(false\)/);
});

test('Step 5: Selection locking and accurate queued status during active batch runs', () => {
  const modal =
    read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx') +
    '\n' +
    read(FRONTEND_SRC, 'components', 'dashboard', 'BatchEpisodeCard.jsx');
  assert.match(modal, /const\s+isBatchExecutionActive\s*=\s*Boolean\(/);
  assert.match(modal, /hasActiveTranslateQueue/);
  assert.match(modal, /if\s*\(isBatchExecutionActive\)\s*return;/);
  assert.match(modal, /disabled=\{isBatchExecutionActive\}/);
  assert.match(modal, /data-testid="selection-locked-badge"/);
  assert.match(modal, /!isBatchExecutionActive\s*&&\s*!isRunning\s*&&\s*!isQueued\s*&&\s*toggleSelect\(ep\.id\)/);
  assert.match(modal, /disabled=\{!hasVideo\s*\|\|\s*isRunning\s*\|\|\s*isQueued\s*\|\|\s*isBatchExecutionActive\}/);
  assert.match(modal, /⏳ រង់ចាំក្នុង Queue/);
});

test('Step 6: Sidebar step cards (1-4) filter right episode queue with [All | Todo | Done] tabs and compact cards', () => {
  const stepBar = read(FRONTEND_SRC, 'features', 'dubbing-runner', 'DubbingStepCardsBar.jsx');
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  const focusBar = read(FRONTEND_SRC, 'components', 'dashboard', 'BatchStageFocusBar.jsx');
  const epCard = read(FRONTEND_SRC, 'components', 'dashboard', 'BatchEpisodeCard.jsx');

  assert.match(stepBar, /onSelectStageView/);
  assert.match(stepBar, /handleCardStageSelect\('translate'\)/);
  assert.match(stepBar, /handleCardStageSelect\('tts'\)/);
  assert.match(stepBar, /handleCardStageSelect\('autofit'\)/);
  assert.match(stepBar, /handleCardStageSelect\('demucs'\)/);
  assert.match(stepBar, /e\.stopPropagation\(\)/);

  assert.match(modal, /<BatchStageFocusBar\b/);
  assert.match(modal, /onSelectStageView=\{handleToggleSidebarStageView\}/);
  assert.match(modal, /navOnly=\{true\}/);
  assert.match(focusBar, /data-testid="stage-overview-nav-bar"/);
  assert.match(focusBar, /data-testid="stage-focus-toolbar"/);
  assert.match(focusBar, /data-testid="top-stage-actions"/);
  assert.match(focusBar, /data-testid="stage-filter-all"/);
  assert.match(focusBar, /data-testid="stage-filter-todo"/);
  assert.match(focusBar, /data-testid="stage-filter-done"/);
  assert.match(focusBar, /data-testid="btn-exit-stage-focus"/);

  assert.match(epCard, /checkEpisodeHasAutoFitReady/);
  assert.match(epCard, /isCompactStageMode/);
  assert.match(epCard, /data-compact-stage=/);
  assert.match(epCard, /ep-stage-status-/);
});
