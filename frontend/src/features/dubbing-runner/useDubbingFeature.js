import { useCallback, useMemo } from 'react';
import { useDubbingRunnerContext } from './DubbingRunnerContext';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  getEpisodeBrokenSummary,
} from '../../components/dashboard/geminiRouteHelpers';

/**
 * useDubbingFeature:
 * Hook used across all pages (Batch studio, EpisodesTab, DubbingModeTab, VoiceSettings, EP Cards).
 */
export function useDubbingFeature(episodes = [], activeSeries = null) {
  const context = useDubbingRunnerContext();

  const isEpisodeDone = useCallback((ep) => {
    if (!ep) return false;
    const hasScript = checkEpisodeHasScript(ep);
    const broken = getEpisodeBrokenSummary(ep)?.totalBrokenCount || 0;
    const hasVoice = checkEpisodeHasAudioReady(ep, null, null);
    const hasDemucs = checkEpisodeHasDemucsReady(ep, null, null);
    return Boolean(hasScript && broken === 0 && hasVoice && !ep.audioOutdated && hasDemucs);
  }, []);

  const stats = useMemo(() => {
    const epList = Array.isArray(episodes) ? episodes : (activeSeries?.episodes || []);
    const total = epList.length;
    const scriptedCount = epList.filter((ep) => checkEpisodeHasScript(ep) && (getEpisodeBrokenSummary(ep)?.totalBrokenCount || 0) === 0).length;
    const voicedCount = epList.filter((ep) => checkEpisodeHasAudioReady(ep, null, null) && !ep.audioOutdated).length;
    const cleanBgmCount = epList.filter((ep) => checkEpisodeHasDemucsReady(ep, null, null)).length;
    const allDoneCount = epList.filter(isEpisodeDone).length;

    return {
      total,
      scriptedCount,
      voicedCount,
      cleanBgmCount,
      allDoneCount,
      translatePercent: total > 0 ? Math.round((scriptedCount / total) * 100) : 0,
      voicePercent: total > 0 ? Math.round((voicedCount / total) * 100) : 0,
      cleanBgmPercent: total > 0 ? Math.round((cleanBgmCount / total) * 100) : 0,
      allDonePercent: total > 0 ? Math.round((allDoneCount / total) * 100) : 0,
    };
  }, [episodes, activeSeries?.episodes, isEpisodeDone]);

  const {
    runnerStates,
    activeEpisodeIds,
    runSingleTranslate,
    runSingleVoice,
    runSingleCleanBgm,
    runSingleEpisodeAll3,
    runSequentialStep,
    stopStep,
    ...restContext
  } = context;

  return {
    runnerStates,
    activeEpisodeIds,
    runSingleTranslate,
    runSingleVoice,
    runSingleCleanBgm,
    runSingleEpisodeAll3,
    runSequentialStep,
    stopStep,
    ...restContext,
    stats,
    isEpisodeDone,
  };
}

export default useDubbingFeature;
