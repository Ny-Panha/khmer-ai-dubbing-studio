const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

describe('Global Series Folder Selector with isolated multi-series workspaces', () => {
  it('1. Navbar.jsx: Renders Folder icon and dynamic series dropdown with episode count and highlight', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/components/layout/Navbar.jsx'), 'utf8');

    assert.ok(
      src.includes('data-testid="navbar-series-select"'),
      'Navbar must render navbar-series-select dropdown'
    );
    assert.ok(
      src.includes('<Folder size={14} className="navbar-series-icon" aria-hidden="true" />'),
      'Navbar must render Folder icon next to series dropdown'
    );
    assert.ok(
      src.includes('onSwitchSeries(e.target.value)'),
      'Navbar must invoke onSwitchSeries when series is selected'
    );
    assert.ok(
      src.includes('isSelected ? `✓ ${sTitle}` : sTitle'),
      'Navbar must highlight active series with checkmark'
    );
    assert.ok(
      src.includes('({sEpCount} ភាគ)'),
      'Navbar must display episode count for each series in dropdown'
    );
    assert.ok(
      src.includes('data-testid="navbar-episode-select"'),
      'Navbar must preserve the existing Episode Selector right next to it'
    );
  });

  it('2. App.jsx: Passes seriesList and onSwitchSeries into Navbar and MemoNavbar comparator', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/App.jsx'), 'utf8');

    assert.ok(
      src.includes('seriesList={series.seriesList}'),
      'App.jsx must pass seriesList to MemoNavbar'
    );
    assert.ok(
      src.includes('onSwitchSeries={series.handleSwitchSeries}'),
      'App.jsx must pass handleSwitchSeries to MemoNavbar'
    );
    assert.ok(
      src.includes('prev.seriesList === next.seriesList') && src.includes('prev.onSwitchSeries === next.onSwitchSeries'),
      'MemoNavbar comparator must check seriesList and onSwitchSeries'
    );
  });

  it('3. projectStorage.js: Stores and restores last active episode per series', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/utils/projectStorage.js'), 'utf8');

    assert.ok(
      src.includes('export function getActiveEpisodeIdForSeries(seriesId)'),
      'Must export getActiveEpisodeIdForSeries'
    );
    assert.ok(
      src.includes('export function setActiveEpisodeIdForSeries(seriesId, episodeId)'),
      'Must export setActiveEpisodeIdForSeries'
    );
    assert.ok(
      src.includes('getActiveEpisodeIdForSeries(series.id) || getActiveEpisodeId()'),
      'loadActiveSeriesAndEpisode must restore the remembered episode for the active series'
    );
  });

  it('4. useSeriesManager.js: Saves workspace snapshot and restores remembered episode on switch', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useSeriesManager.js'), 'utf8');

    assert.ok(
      src.includes('switchSeriesSeqRef'),
      'Must track switchSeriesSeqRef to prevent rapid switching race conditions'
    );
    assert.ok(
      src.includes('saveEpisodeState(activeSeriesIdState, activeEpisodeIdRef.current, snapshot)'),
      'Must save snapshot of current workspace before switching away'
    );
    assert.ok(
      src.includes('setActiveEpisodeIdForSeries(activeSeriesIdState, activeEpisodeIdRef.current)'),
      'Must remember last active episode for the previous series'
    );
    assert.ok(
      src.includes('getActiveEpisodeIdForSeries(targetSeriesId)'),
      'Must look up remembered episode for target series instead of blindly resetting to index 0'
    );
    assert.ok(
      src.includes('if (switchSeriesSeqRef.current !== currentSeq) return;'),
      'Must discard stale server responses if user switched series again rapidly'
    );
  });

  it('5. DubbingRunnerContext.jsx: Scopes runner state and stop actions by seriesId', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/features/dubbing-runner/DubbingRunnerContext.jsx'), 'utf8');

    assert.ok(
      src.includes('const targetSeriesId = activeSeries?.id || \'drama_project\';') &&
      src.includes('seriesId: targetSeriesId'),
      'Runner must record seriesId in runnerState at start of execution'
    );
    assert.ok(
      src.includes('runnerStates[stepType]?.seriesId || activeSeries?.id || \'drama_project\''),
      'StopStep must target the runnerState seriesId, not whatever series is currently active'
    );
  });

  it('6. dubbingExecutionAdapter.js: Prioritizes context.seriesId and ep.seriesId over activeSeries.id', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/features/dubbing-runner/dubbingExecutionAdapter.js'), 'utf8');

    assert.ok(
      src.includes('const seriesId = context.seriesId || ep?.seriesId || activeSeries?.id || \'drama_project\';'),
      'Execution adapter must strictly isolate background runners from active series switching'
    );
  });

  it('7. useEpisodeSelection.js: Scopes episode selections by seriesId to prevent cross-series contamination', () => {
    const src = fs.readFileSync(path.join(rootDir, 'frontend/src/features/gemini-route/hooks/useEpisodeSelection.js'), 'utf8');

    assert.ok(
      src.includes('useRef') && src.includes("import { useState, useMemo, useEffect, useCallback, useRef } from 'react';"),
      'Must import useRef from react in useEpisodeSelection'
    );
    assert.ok(
      src.includes('prevSeriesIdRef') && src.includes('prevSeriesIdRef.current !== seriesId'),
      'Must listen for seriesId changes and reset/scope selectedEpIds for the new series'
    );
  });
});
