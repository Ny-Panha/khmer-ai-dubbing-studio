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
});

test('Step 1b: Elimination of blocking warning modal when selectedEpIds is empty', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  // Check that handleStartBatchTranslate, handleBatchGenerateTTS, handleBatchDemucsSeparation, handleRunAll3Steps auto-target
  assert.doesNotMatch(modal, /សូមជ្រើសរើសភាគដែលចង់ Translate ជាមុនសិន/);
  assert.doesNotMatch(modal, /សូមជ្រើសរើសភាគដែលចង់បង្កើតសំឡេង AI ជាមុនសិន/);
  assert.doesNotMatch(modal, /សូមជ្រើសរើសភាគដែលចង់បំបែកសំឡេង Demucs AI ជាមុនសិន/);
  assert.doesNotMatch(modal, /សូមជ្រើសរើសភាគដែលចង់ដំណើរការ Auto-Pipeline ទាំង 3 មុខងារ/);
});

test('Step 2: Unified 1-Click 3-step pipeline engine for batch & individual cards', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  assert.match(modal, /runEpisodeFullPipeline/);
  assert.match(modal, /btn-auto-run-ep-/);
  assert.match(modal, /▶ ផលិតទាំង 3 ជំហាន/);
  assert.match(modal, /🚀 ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន/);
});

test('Step 3: Decluttered top header - script setup collapsed & single compact progress summary', () => {
  const modal = read(FRONTEND_SRC, 'components', 'dashboard', 'GeminiRouteModal.jsx');
  assert.match(modal, /const\s+\[isScriptSetupExpanded,\s*setIsScriptSetupExpanded\]\s*=\s*useState\(false\)/);
  assert.match(modal, /gridTemplateColumns:\s*'repeat\(3,\s*minmax\(0,\s*1fr\)\)'/);
  assert.match(modal, /📝 1\. Script ខ្មែរ:/);
  assert.match(modal, /🎙️ 2\. សំឡេង AI:/);
  assert.match(modal, /🔇 3\. Clean BGM:/);
});

test('Step 4: Route runner console drawers default collapsed to preserve screen height', () => {
  const translateCard = read(FRONTEND_SRC, 'components', 'dashboard', 'route-runners', 'EpisodeTranslateProgressCard.jsx');
  const ttsCard = read(FRONTEND_SRC, 'components', 'dashboard', 'route-runners', 'EpisodeTtsProgressCard.jsx');
  const demucsCard = read(FRONTEND_SRC, 'components', 'dashboard', 'route-runners', 'EpisodeDemucsProgressCard.jsx');

  assert.match(translateCard, /const\s+\[showConsole,\s*setShowConsole\]\s*=\s*useState\(false\)/);
  assert.match(ttsCard, /const\s+\[showConsole,\s*setShowConsole\]\s*=\s*useState\(false\)/);
  assert.match(demucsCard, /const\s+\[showConsole,\s*setShowConsole\]\s*=\s*useState\(false\)/);
});
