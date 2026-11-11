/**
 * Pure Computed Selectors for Gemini Route / Batch Generate Studio
 * DragonDub AI Studio - Frontend Features
 *
 * NOTE: Pure utility functions only. NEVER import React, React hooks, or UI state here.
 */

import {
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  computeClampedStagePercent,
  partitionSelectedEpisodesForTranslate,
  computeSeriesTranslateSummary,
  getEpisodesBrokenSummary,
} from '../../../components/dashboard/geminiRouteHelpers.js';

/**
 * Filter episodes by a Set or Array of selected episode IDs
 * @param {Array} episodes
 * @param {Set|Array} selectedEpIds
 * @returns {Array}
 */
export function selectSelectedTargetEpisodes(episodes = [], selectedEpIds = new Set()) {
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];
  const safeSelected = selectedEpIds instanceof Set ? selectedEpIds : new Set(selectedEpIds || []);
  return safeEpisodes.filter((ep) => safeSelected.has(ep?.id));
}

/**
 * Partition selected episodes into unscripted and scripted
 * @param {Array} selectedTargetEpisodes
 * @returns {{ unscriptedEpisodes: Array, scriptedEpisodes: Array }}
 */
export function selectPartitionedSelectedEpisodes(selectedTargetEpisodes = []) {
  return partitionSelectedEpisodesForTranslate(selectedTargetEpisodes);
}

/**
 * Calculate completed audio count across episodes
 * @param {Array} episodes
 * @param {Set|null} completedTtsEpIds
 * @param {Object|null} ttsLiveStats
 * @returns {number}
 */
export function selectCompletedAudioCount(episodes = [], completedTtsEpIds = null, ttsLiveStats = null) {
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];
  return safeEpisodes.filter((ep) => checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats)).length;
}

/**
 * Calculate completed Demucs separation count across episodes
 * @param {Array} episodes
 * @param {Set|null} completedDemucsEpIds
 * @param {Object|null} demucsLiveStats
 * @returns {number}
 */
export function selectCompletedDemucsCount(episodes = [], completedDemucsEpIds = null, demucsLiveStats = null) {
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];
  return safeEpisodes.filter((ep) => checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats)).length;
}

/**
 * Filter episodes that still need Demucs vocal separation
 * @param {Array} episodes
 * @param {Set|null} selectedEpIds
 * @param {Set|null} completedDemucsEpIds
 * @param {Object|null} demucsLiveStats
 * @returns {Array}
 */
export function selectUnDemucsEpisodes(episodes = [], selectedEpIds = null, completedDemucsEpIds = null, demucsLiveStats = null) {
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];
  return safeEpisodes.filter((ep) => {
    const isDone = checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats);
    const matchesSelection = selectedEpIds ? selectedEpIds.has(ep.id) : true;
    return matchesSelection && !isDone;
  });
}

/**
 * Filter episodes that still need audio generation
 * @param {Array} episodes
 * @param {Set|null} selectedEpIds
 * @param {Set|null} completedTtsEpIds
 * @param {Object|null} ttsLiveStats
 * @returns {Array}
 */
export function selectUnAudioEpisodes(episodes = [], selectedEpIds = null, completedTtsEpIds = null, ttsLiveStats = null) {
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];
  return safeEpisodes.filter((ep) => {
    const isDone = checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats);
    const matchesSelection = selectedEpIds ? selectedEpIds.has(ep.id) : true;
    return matchesSelection && !isDone;
  });
}

/**
 * Compute overall 3-stage progress percent across series (3 stages per episode)
 * @param {number} healthyScriptedCount
 * @param {number} completedAudioCount
 * @param {number} completedDemucsCount
 * @param {number} totalEpisodes
 * @returns {number} 0-100 clamped percent
 */
export function selectOverallStagePercent(healthyScriptedCount = 0, completedAudioCount = 0, completedDemucsCount = 0, totalEpisodes = 0) {
  return computeClampedStagePercent(
    Number(healthyScriptedCount || 0) + Number(completedAudioCount || 0) + Number(completedDemucsCount || 0),
    Number(totalEpisodes || 0) * 3
  );
}

/**
 * Compute remaining target counts for toolbar buttons based on selection state
 * @param {Object} params
 * @returns {{ targetCount: number, targetTranslateLeft: number, targetAudioLeft: number, targetDemucsLeft: number, repairBrokenCount: number }}
 */
export function selectTargetCounters({
  selectedCount = 0,
  unscriptedSelectedCount = 0,
  remainingTranslateCount = 0,
  unAudioSelectedCount = 0,
  unAudioSeriesCount = 0,
  unDemucsSelectedCount = 0,
  unDemucsSeriesCount = 0,
  selectedTextBrokenCount = 0,
  seriesTextBrokenCount = 0,
  incompleteEpisodesCount = 0,
  totalEpisodesCount = 0,
}) {
  const hasSelection = Number(selectedCount) > 0;
  const targetCount = hasSelection
    ? selectedCount
    : (incompleteEpisodesCount > 0 ? incompleteEpisodesCount : totalEpisodesCount);
  const targetTranslateLeft = hasSelection ? unscriptedSelectedCount : remainingTranslateCount;
  const targetAudioLeft = hasSelection ? unAudioSelectedCount : unAudioSeriesCount;
  const targetDemucsLeft = hasSelection ? unDemucsSelectedCount : unDemucsSeriesCount;
  const repairBrokenCount = (hasSelection ? selectedTextBrokenCount : seriesTextBrokenCount) || 0;

  return {
    targetCount,
    targetTranslateLeft,
    targetAudioLeft,
    targetDemucsLeft,
    repairBrokenCount,
  };
}

/**
 * Determine if any batch runner or queue is actively executing
 * @param {Object} params
 * @returns {boolean}
 */
export function selectIsBatchExecutionActive({
  isStartingBatch = false,
  hasActiveTranslateQueue = false,
  isGeneratingBatchTTS = false,
  isSeparatingBatchDemucs = false,
  isRepairingBroken = false,
  runningPipelineEpIds = null,
  runnerStates = null,
  runnerActiveEpIds = null,
}) {
  return Boolean(
    isStartingBatch ||
    hasActiveTranslateQueue ||
    isGeneratingBatchTTS ||
    isSeparatingBatchDemucs ||
    isRepairingBroken ||
    (runningPipelineEpIds && runningPipelineEpIds.size > 0) ||
    (runnerStates?.translate?.status === 'running') ||
    (runnerStates?.voice?.status === 'running') ||
    (runnerStates?.clean_bgm?.status === 'running') ||
    (runnerStates?.all3?.status === 'running') ||
    (runnerActiveEpIds && runnerActiveEpIds.size > 0)
  );
}

/**
 * Compute stage completion flags across whole series and current targets
 * @param {Object} params
 * @returns {Object}
 */
export function selectStageCompletionFlags({
  episodes = [],
  selectedCount = 0,
  isTranslateAllDone = false,
  unscriptedSelectedCount = 0,
  selectedTextBrokenCount = 0,
  seriesTextBrokenCount = 0,
  completedAudioCount = 0,
  seriesTotalBrokenCount = 0,
  completedDemucsCount = 0,
  unAudioSelectedCount = 0,
  unDemucsSelectedCount = 0,
}) {
  const totalEps = episodes.length;
  const hasSelection = selectedCount > 0;

  const isStep2TargetDone = hasSelection
    ? (unscriptedSelectedCount === 0 && selectedTextBrokenCount === 0)
    : (isTranslateAllDone && seriesTextBrokenCount === 0);

  const isAudioAllDone = totalEps > 0 && completedAudioCount === totalEps && seriesTotalBrokenCount === 0;
  const isDemucsAllDone = totalEps > 0 && completedDemucsCount === totalEps;
  const isAll1To3Done = isTranslateAllDone && isAudioAllDone && isDemucsAllDone;
  const is1And2Done = isTranslateAllDone && isAudioAllDone && !isDemucsAllDone;

  const allSelectedDemucsCompleted = hasSelection ? unDemucsSelectedCount === 0 : false;
  const allSelectedAudioCompleted = hasSelection
    ? (unAudioSelectedCount === 0 && selectedTotalBrokenCount(selectedTextBrokenCount) === 0)
    : false;

  const isStep3TrulyDone = hasSelection ? allSelectedAudioCompleted : isAudioAllDone;

  return {
    isStep2TargetDone,
    isAudioAllDone,
    isDemucsAllDone,
    isAll1To3Done,
    is1And2Done,
    allSelectedDemucsCompleted,
    allSelectedAudioCompleted,
    isStep3TrulyDone,
  };
}

function selectedTotalBrokenCount(textBrokenCount) {
  return Number(textBrokenCount || 0);
}

export {
  computeSeriesTranslateSummary,
  getEpisodesBrokenSummary,
};
