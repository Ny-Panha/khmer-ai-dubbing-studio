/**
 * Custom Hook: useEpisodeSelection
 * Handles episode multi-selection, quick-select pills, and selection locking during active batch execution.
 * DragonDub AI Studio - Frontend Features
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  getEpisodeBrokenSummary,
} from '../../../components/dashboard/geminiRouteHelpers.js';

export function useEpisodeSelection({
  episodes = [],
  isOpen = false,
  isBatchExecutionActive = false,
  completedTtsEpIds = null,
  ttsLiveStats = null,
  completedDemucsEpIds = null,
  demucsLiveStats = null,
} = {}) {
  const [selectedEpIds, setSelectedEpIds] = useState(new Set());

  // Check if an episode is 100% completed across all 3 steps (Translate + Audio TTS + Clean BGM)
  // Truly ready only when hasScript && brokenSegmentCount === 0 && hasAudio && !audioOutdated && hasDemucs
  const isEpisodeFullyDone = useCallback((ep) => {
    if (!ep) return false;
    const hasScript = checkEpisodeHasScript(ep);
    const brokenScan = getEpisodeBrokenSummary ? getEpisodeBrokenSummary(ep) : null;
    const hasBroken = (brokenScan?.totalBrokenCount || 0) > 0;
    const hasAudio = checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats);
    const hasDemucs = checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats);
    return Boolean(hasScript && !hasBroken && hasAudio && !ep?.audioOutdated && hasDemucs);
  }, [completedTtsEpIds, ttsLiveStats, completedDemucsEpIds, demucsLiveStats]);

  // All selectable episodes ordered sequentially (guaranteed to include all episodes in series)
  const allSelectableEpisodes = useMemo(() => {
    return (Array.isArray(episodes) ? episodes : [])
      .slice()
      .sort((a, b) => (Number(a.episodeNumber) || 0) - (Number(b.episodeNumber) || 0));
  }, [episodes]);

  // Episodes with a video file (or all episodes if none flagged)
  const episodesWithVideo = useMemo(() => {
    const vids = allSelectableEpisodes.filter((ep) => Boolean(ep?.video || ep?.videoFile || ep?.sourceVideoPath || ep?.videoPath || ep?.filePath));
    return vids.length > 0 ? vids : allSelectableEpisodes;
  }, [allSelectableEpisodes]);

  // Episodes that still have pending work (Step 1, Step 2, or Step 3 or broken segments)
  const pendingEpisodes = useMemo(() => {
    return allSelectableEpisodes.filter((ep) => !isEpisodeFullyDone(ep));
  }, [allSelectableEpisodes, isEpisodeFullyDone]);

  const incompleteEpisodes = pendingEpisodes;

  // Auto-select episodes by default on open (all selectable episodes by default)
  useEffect(() => {
    if (isOpen && episodes.length > 0 && selectedEpIds.size === 0 && !isBatchExecutionActive) {
      if (allSelectableEpisodes.length > 0) {
        setSelectedEpIds(new Set(allSelectableEpisodes.map((ep) => ep.id)));
      } else if (incompleteEpisodes.length > 0) {
        setSelectedEpIds(new Set(incompleteEpisodes.map((ep) => ep.id)));
      }
    }
  }, [isOpen, episodes.length, incompleteEpisodes, allSelectableEpisodes, isBatchExecutionActive]);

  const toggleSelect = useCallback((id) => {
    if (isBatchExecutionActive) return;
    setSelectedEpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [isBatchExecutionActive]);

  const handleSelectCount = useCallback((count) => {
    if (isBatchExecutionActive) return;
    const pool = incompleteEpisodes.length > 0 ? incompleteEpisodes : allSelectableEpisodes;
    const picked = pool.slice(0, count);
    setSelectedEpIds(new Set(picked.map((ep) => ep.id)));
  }, [isBatchExecutionActive, incompleteEpisodes, allSelectableEpisodes]);

  const handleSelectAllEpisodes = useCallback(() => {
    if (isBatchExecutionActive) return;
    setSelectedEpIds(new Set(allSelectableEpisodes.map((ep) => ep.id)));
  }, [isBatchExecutionActive, allSelectableEpisodes]);

  const handleSelectIncompleteEpisodes = useCallback(() => {
    if (isBatchExecutionActive) return;
    setSelectedEpIds(new Set(incompleteEpisodes.map((ep) => ep.id)));
  }, [isBatchExecutionActive, incompleteEpisodes]);

  const handleClearSelection = useCallback(() => {
    if (isBatchExecutionActive) return;
    setSelectedEpIds(new Set());
  }, [isBatchExecutionActive]);

  const handleSelectAllUnscripted = useCallback(() => {
    if (isBatchExecutionActive) return;
    const unscripted = allSelectableEpisodes.filter((ep) => !checkEpisodeHasScript(ep));
    setSelectedEpIds(new Set(unscripted.map((ep) => ep.id)));
  }, [isBatchExecutionActive, allSelectableEpisodes]);

  const handleSelectAll = handleSelectIncompleteEpisodes;
  const handleSelectAllWithVideo = handleSelectAllEpisodes;

  return {
    selectedEpIds,
    setSelectedEpIds,
    allSelectableEpisodes,
    episodesWithVideo,
    pendingEpisodes,
    incompleteEpisodes,
    isEpisodeFullyDone,
    toggleSelect,
    handleSelectCount,
    handleSelectAllEpisodes,
    handleSelectIncompleteEpisodes,
    handleClearSelection,
    handleSelectAllUnscripted,
    handleSelectAll,
    handleSelectAllWithVideo,
  };
}

