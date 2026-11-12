import { useCallback, useMemo } from 'react';
import { useDubbingRunnerContext } from './DubbingRunnerContext';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  checkEpisodeHasAutoFitReady,
  getEpisodeBrokenSummary,
} from '../../components/dashboard/geminiRouteHelpers';

const DEFAULT_RUNNER_STATES = {
  translate: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
  repair: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
  voice: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
  clean_bgm: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
  autofit: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
  all3: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
};

/**
 * useDubbingFeature:
 * Hook used across all pages (Batch studio, EpisodesTab, DubbingModeTab, VoiceSettings, EP Cards).
 */
export function useDubbingFeature(episodes = [], activeSeries = null) {
  const context = useDubbingRunnerContext();
  const safeContext = context || {};

  const isEpisodeDone = useCallback((ep) => {
    if (!ep) return false;
    const hasScript = checkEpisodeHasScript(ep);
    const textBroken = getEpisodeBrokenSummary(ep)?.textBrokenCount || 0;
    const hasVoice = checkEpisodeHasAudioReady(ep, null, null);
    const hasDemucs = checkEpisodeHasDemucsReady(ep, null, null);
    return Boolean(hasScript && textBroken === 0 && hasVoice && !ep.audioOutdated && hasDemucs);
  }, []);

  const stats = useMemo(() => {
    const epList = Array.isArray(episodes) ? episodes : (activeSeries?.episodes || []);
    const total = epList.length;
    const scriptedCount = epList.filter((ep) => checkEpisodeHasScript(ep) && (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) === 0).length;
    const voicedCount = epList.filter((ep) => checkEpisodeHasAudioReady(ep, null, null) && !ep.audioOutdated).length;
    const autofitCount = epList.filter((ep) => checkEpisodeHasAudioReady(ep, null, null) && checkEpisodeHasAutoFitReady(ep)).length;
    const cleanBgmCount = epList.filter((ep) => checkEpisodeHasDemucsReady(ep, null, null)).length;
    const allDoneCount = epList.filter(isEpisodeDone).length;

    return {
      total,
      scriptedCount,
      voicedCount,
      autofitCount,
      cleanBgmCount,
      allDoneCount,
      translatePercent: total > 0 ? Math.round((scriptedCount / total) * 100) : 0,
      voicePercent: total > 0 ? Math.round((voicedCount / total) * 100) : 0,
      autofitPercent: voicedCount > 0 ? Math.round((autofitCount / voicedCount) * 100) : (total > 0 && voicedCount === 0 ? 0 : 100),
      cleanBgmPercent: total > 0 ? Math.round((cleanBgmCount / total) * 100) : 0,
      allDonePercent: total > 0 ? Math.round((allDoneCount / total) * 100) : 0,
    };
  }, [episodes, activeSeries?.episodes, isEpisodeDone]);

  const {
    runnerStates = DEFAULT_RUNNER_STATES,
    activeEpisodeIds = new Set(),
    runSingleTranslate = async () => ({ success: false, skipped: true }),
    runSingleTextRepair = async () => ({ success: false, skipped: true }),
    runSingleVoice = async () => ({ success: false, skipped: true }),
    runSingleCleanBgm = async () => ({ success: false, skipped: true }),
    runSingleAutoFitSpeed = async () => ({ success: false, skipped: true }),
    runSingleEpisodeAll3 = async () => ({ success: false, skipped: true }),
    runSequentialStep = async () => ({ success: false, count: 0 }),
    stopStep = async () => {},
    ...restContext
  } = safeContext;

  return {
    runnerStates,
    activeEpisodeIds,
    runSingleTranslate,
    runSingleTextRepair,
    runSingleVoice,
    runSingleCleanBgm,
    runSingleAutoFitSpeed,
    runSingleEpisodeAll3,
    runSequentialStep,
    stopStep,
    ...restContext,
    stats,
    isEpisodeDone,
  };
}

export default useDubbingFeature;
