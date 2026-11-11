import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import {
  startGenerationJob,
  getJobStatus,
  generateAudioApi,
  syncTimelineAudioApi,
  startRepairBrokenJobApi,
  separateAudioApi,
  getSeparationProgressApi,
  killSeparationApi,
} from '../../services/api';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  getEpisodeBrokenSummary,
} from '../../components/dashboard/geminiRouteHelpers';

const DubbingRunnerContext = createContext(null);

export function DubbingRunnerProvider({ children, activeSeries, refreshSeries }) {
  // Global runners state per step: 'translate' | 'voice' | 'clean_bgm' | 'all3'
  const [runnerStates, setRunnerStates] = useState({
    translate: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    voice: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    clean_bgm: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    all3: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
  });

  // Track currently processing episode IDs across all runners
  const [activeEpisodeIds, setActiveEpisodeIds] = useState(new Set());

  // Abort controllers per step for clean instantaneous stop
  const abortControllersRef = useRef({
    translate: null,
    voice: null,
    clean_bgm: null,
    all3: null,
  });

  const updateRunnerState = useCallback((step, updates) => {
    setRunnerStates((prev) => ({
      ...prev,
      [step]: {
        ...prev[step],
        ...(typeof updates === 'function' ? updates(prev[step]) : updates),
      },
    }));
  }, []);

  /**
   * 1. Translate / Repair a Single Episode (Awaits 100% completion before resolving)
   */
  const runSingleTranslate = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return { success: false, error: 'No episode provided' };
    const seriesId = activeSeries?.id || ep.seriesId || 'drama_project';
    const videoRef = ep.videoPath || ep.sourceVideoPath || ep.videoFile || (typeof ep.video === 'string' ? ep.video : ep.video?.videoPath) || '';
    const videoId = ep.videoId || ep.video?.videoId || videoRef;

    const brokenScan = getEpisodeBrokenSummary(ep);
    const hasBroken = (brokenScan?.totalBrokenCount || 0) > 0;
    const hasScript = checkEpisodeHasScript(ep);

    // If episode already has script and not forcing:
    if (hasScript && !options.force) {
      if (hasBroken) {
        // Auto repair broken segments
        updateRunnerState('translate', { message: `[EP${ep.episodeNumber || ep.id}] ជួសជុលឃ្លាខូច (${brokenScan.totalBrokenCount} ឃ្លា)...` });
        const res = await startRepairBrokenJobApi({
          seriesId,
          targetEpisodeIds: [ep.id],
          modelName: options.modelName || 'gemini-2.5-flash',
        });
        if (res?.jobId || res?.jobIds?.[0]) {
          const jId = res.jobId || res.jobIds[0];
          while (!signal?.aborted) {
            await new Promise((r) => setTimeout(r, 1500));
            if (signal?.aborted) break;
            const statusRes = await getJobStatus(jId, { seriesId, episodeId: ep.id, signal }).catch(() => null);
            if (statusRes?.status === 'completed' || statusRes?.job?.status === 'completed') {
              break;
            }
            if (statusRes?.status === 'failed' || statusRes?.job?.status === 'failed') {
              throw new Error(statusRes?.error || 'Repair failed');
            }
          }
        }
        return { success: true, repaired: true };
      }
      return { success: true, skipped: true };
    }

    updateRunnerState('translate', { message: `[EP${ep.episodeNumber || ep.id}] កំពុង Translate Script...` });

    const jobRes = await startGenerationJob({
      videoId,
      videoPath: videoRef,
      seriesId,
      episodeId: ep.id,
      pipelineMode: options.pipelineMode || 'fast_ocr',
      dubbingMode: options.dubbingMode || 'dialogue',
      genre: options.genre || 'auto',
      narratorGender: options.narratorGender || 'male',
      customPrompt: options.customDirection || '',
      force: Boolean(options.force),
    });

    const jobId = jobRes?.jobId || jobRes?.id;
    if (!jobId) {
      throw new Error(jobRes?.error || 'Failed to start translation job');
    }

    // Poll until 100% completed on disk
    while (!signal?.aborted) {
      await new Promise((r) => setTimeout(r, 1500));
      if (signal?.aborted) {
        await fetch(`/api/jobs/${encodeURIComponent(jobId)}/kill`, { method: 'POST' }).catch(() => {});
        throw new Error('Translation aborted by user');
      }
      const st = await getJobStatus(jobId, { seriesId, episodeId: ep.id, signal }).catch(() => null);
      const curStatus = st?.status || st?.job?.status;
      const progress = Number(st?.progress || st?.job?.progress || 0);

      updateRunnerState('translate', { progress });

      if (curStatus === 'completed') {
        return { success: true, jobId, data: st };
      }
      if (curStatus === 'failed') {
        throw new Error(st?.error || st?.job?.error || 'Translation failed');
      }
    }

    return { success: false, aborted: true };
  }, [activeSeries?.id, updateRunnerState]);

  /**
   * 2. AI Khmer Voice TTS for a Single Episode (Awaits 100% completion before resolving)
   */
  const runSingleVoice = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return { success: false, error: 'No episode provided' };
    const seriesId = activeSeries?.id || ep.seriesId || 'drama_project';
    const videoId = ep.videoId || ep.videoFile || ep.video?.videoId || ep.videoPath || '';

    const segments = ep.scriptData?.segments || [];
    if (!Array.isArray(segments) || segments.length === 0) {
      return { success: false, skipped: true, reason: 'no_segments' };
    }

    const hasAudio = checkEpisodeHasAudioReady(ep, null, null);
    if (hasAudio && !ep.audioOutdated && !options.force) {
      return { success: true, skipped: true };
    }

    updateRunnerState('voice', { message: `[EP${ep.episodeNumber || ep.id}] បង្កើតសំឡេងខ្មែរ AI (${segments.length} ឃ្លា)...` });

    // Build speaker map if character mapping exists
    const speakerMap = options.speakerMap || {};
    const voiceId = options.voiceId || 'km-KH-PisethNeural';

    const ttsRes = await generateAudioApi({
      segments,
      voiceId,
      seriesId,
      episodeId: ep.id,
      videoId,
      speakerMap,
      signal,
    });

    if (!ttsRes?.success && ttsRes?.error) {
      throw new Error(ttsRes.error || 'TTS Generation failed');
    }

    // Sync timeline audio tracks if available
    try {
      if (typeof syncTimelineAudioApi === 'function') {
        await syncTimelineAudioApi(segments, ep.title || `EP${ep.episodeNumber || ep.id}`, videoId, ep.id, seriesId);
      }
    } catch (_) {}

    return { success: true, data: ttsRes };
  }, [activeSeries?.id, updateRunnerState]);

  /**
   * 3. AI Vocal Separation (Demucs Clean BGM) for a Single Episode
   */
  const runSingleCleanBgm = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return { success: false, error: 'No episode provided' };
    const seriesId = activeSeries?.id || ep.seriesId || 'drama_project';
    const videoRef = ep.videoPath || ep.sourceVideoPath || ep.videoFile || (typeof ep.video === 'string' ? ep.video : ep.video?.videoPath) || '';

    if (!videoRef) {
      return { success: false, skipped: true, reason: 'no_video' };
    }

    const hasDemucs = checkEpisodeHasDemucsReady(ep, null, null);
    if (hasDemucs && !options.force) {
      return { success: true, skipped: true };
    }

    updateRunnerState('clean_bgm', { message: `[EP${ep.episodeNumber || ep.id}] កំពុងបិទសំឡេងចិន (Demucs Clean BGM)...` });

    let sepRes = null;
    try {
      sepRes = await separateAudioApi({
        videoPath: videoRef,
        seriesId,
        episodeId: ep.id,
        model: options.model || 'htdemucs',
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      const isFatal = /memory|alloc_cpu|DefaultCPUAllocator|refused|code 1/i.test(String(err?.message || ''));
      if (isFatal) throw err;
      console.warn('[DubbingRunner] Separate audio initial POST error, checking progress:', err.message);
    }

    // If response returned instantly with completed status
    if (sepRes?.success && sepRes?.noVocalsUrl) {
      return { success: true, noVocalsUrl: sepRes.noVocalsUrl };
    }

    // Poll separation progress until complete
    while (!signal?.aborted) {
      await new Promise((r) => setTimeout(r, 2000));
      if (signal?.aborted) {
        await killSeparationApi({ videoPath: videoRef, jobId: 'all' }).catch(() => {});
        throw new Error('Demucs separation aborted by user');
      }

      const prog = await getSeparationProgressApi(videoRef, { signal }).catch(() => null);
      if (prog) {
        const pct = Math.min(100, Math.max(0, Number(prog.progress || prog.percent || 0)));
        updateRunnerState('clean_bgm', { progress: pct });

        if (prog.status === 'completed' || (prog.isDone && prog.noVocalsUrl)) {
          return { success: true, noVocalsUrl: prog.noVocalsUrl };
        }
        if (prog.status === 'error' || prog.isFailed) {
          throw new Error(prog.error || prog.message || 'Demucs separation failed');
        }
      }
    }

    return { success: false, aborted: true };
  }, [activeSeries?.id, updateRunnerState]);

  /**
   * 4. Run all 3 steps for 1 single episode sequentially
   */
  const runSingleEpisodeAll3 = useCallback(async (ep, options = {}, signal = null) => {
    // 1. Script
    await runSingleTranslate(ep, options, signal);
    if (typeof refreshSeries === 'function') await refreshSeries();

    // 2. Voice
    await runSingleVoice(ep, options, signal);
    if (typeof refreshSeries === 'function') await refreshSeries();

    // 3. Demucs
    await runSingleCleanBgm(ep, options, signal);
    if (typeof refreshSeries === 'function') await refreshSeries();

    return { success: true };
  }, [runSingleTranslate, runSingleVoice, runSingleCleanBgm, refreshSeries]);

  /**
   * 5. Strict 1-by-1 Sequential Queue Runner (EP1 ➔ EP2 ➔ ... ➔ EPN)
   * Awaits 100% completion of episode N before triggering episode N+1.
   */
  const runSequentialStep = useCallback(async (stepType, episodesList = [], options = {}) => {
    const allEpisodes = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes : [];

    // Smart Auto-Targeting: If episodesList is empty, auto-target episodes needing this step
    let queue = Array.isArray(episodesList) && episodesList.length > 0 ? episodesList : [];
    if (queue.length === 0) {
      if (stepType === 'translate') {
        queue = allEpisodes.filter((ep) => !checkEpisodeHasScript(ep) || (getEpisodeBrokenSummary(ep)?.totalBrokenCount || 0) > 0);
      } else if (stepType === 'voice') {
        queue = allEpisodes.filter((ep) => checkEpisodeHasScript(ep) && (!checkEpisodeHasAudioReady(ep, null, null) || ep.audioOutdated));
      } else if (stepType === 'clean_bgm') {
        queue = allEpisodes.filter((ep) => !checkEpisodeHasDemucsReady(ep, null, null));
      } else if (stepType === 'all3') {
        queue = allEpisodes.filter((ep) => !checkEpisodeHasScript(ep) || !checkEpisodeHasAudioReady(ep, null, null) || !checkEpisodeHasDemucsReady(ep, null, null));
      }
      if (queue.length === 0 && options.force) {
        queue = allEpisodes;
      }
    }

    if (queue.length === 0) {
      updateRunnerState(stepType, { message: 'គ្រប់ភាគទាំងអស់រួចរាល់ហើយ' });
      return { success: true, count: 0 };
    }

    // Set up AbortController for clean cancellation
    const controller = new AbortController();
    abortControllersRef.current[stepType] = controller;

    updateRunnerState(stepType, {
      status: 'running',
      currentEpIndex: 1,
      totalEps: queue.length,
      currentEpId: queue[0]?.id || null,
      progress: 0,
      message: `ចាប់ផ្តើមរត់ 1-by-1 លើ ${queue.length} ភាគ...`,
    });

    try {
      for (let idx = 0; idx < queue.length; idx++) {
        if (controller.signal.aborted) break;
        const currentEp = queue[idx];

        setActiveEpisodeIds((prev) => new Set([...prev, currentEp.id]));
        updateRunnerState(stepType, {
          status: 'running',
          currentEpIndex: idx + 1,
          totalEps: queue.length,
          currentEpId: currentEp.id,
          message: `កំពុងរត់ EP${currentEp.episodeNumber || currentEp.id} (${idx + 1}/${queue.length})...`,
        });

        // Await 100% completion of single episode step before proceeding to next!
        if (stepType === 'translate') {
          await runSingleTranslate(currentEp, options, controller.signal);
        } else if (stepType === 'voice') {
          await runSingleVoice(currentEp, options, controller.signal);
        } else if (stepType === 'clean_bgm') {
          await runSingleCleanBgm(currentEp, options, controller.signal);
        } else if (stepType === 'all3') {
          await runSingleEpisodeAll3(currentEp, options, controller.signal);
        }

        setActiveEpisodeIds((prev) => {
          const next = new Set(prev);
          next.delete(currentEp.id);
          return next;
        });

        if (typeof refreshSeries === 'function') {
          await refreshSeries();
        }
      }

      updateRunnerState(stepType, {
        status: 'idle',
        currentEpId: null,
        currentEpIndex: 0,
        totalEps: 0,
        progress: 100,
        message: 'រួចរាល់ 100%!',
      });

      return { success: true, count: queue.length };
    } catch (err) {
      if (controller.signal.aborted) {
        updateRunnerState(stepType, { status: 'idle', message: 'បានបញ្ឈប់ដោយអ្នកប្រើប្រាស់' });
        return { success: false, aborted: true };
      }
      updateRunnerState(stepType, { status: 'failed', message: err.message || 'ជួបបញ្ហាពេលដំណើរការ' });
      throw err;
    } finally {
      abortControllersRef.current[stepType] = null;
      setActiveEpisodeIds((prev) => {
        const next = new Set(prev);
        queue.forEach((ep) => next.delete(ep.id));
        return next;
      });
    }
  }, [activeSeries?.episodes, updateRunnerState, runSingleTranslate, runSingleVoice, runSingleCleanBgm, runSingleEpisodeAll3, refreshSeries]);

  /**
   * Stop an active sequential runner cleanly (Guarantees both UI loop & Backend processes are terminated)
   */
  const stopStep = useCallback(async (stepType) => {
    // 1. Abort in-flight client fetch signal
    if (abortControllersRef.current[stepType]) {
      try { abortControllersRef.current[stepType].abort(); } catch (_) {}
      abortControllersRef.current[stepType] = null;
    }

    // 2. Transmit kill command to backend worker processes immediately
    try {
      if (stepType === 'clean_bgm' || stepType === 'all3') {
        await killSeparationApi({ jobId: 'all' }).catch(() => {});
      }
      if (stepType === 'translate' || stepType === 'all3') {
        const targetSeriesId = activeSeries?.id || 'drama_project';
        await fetch('/api/jobs/kill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seriesId: targetSeriesId, jobId: 'all' }),
        }).catch(() => {});
      }
    } catch (_) {}

    updateRunnerState(stepType, {
      status: 'idle',
      currentEpId: null,
      message: '🛑 បានបញ្ឈប់ (Stopped UI & Backend)',
    });
  }, [activeSeries?.id, updateRunnerState]);

  const value = {
    runnerStates,
    activeEpisodeIds,
    runSingleTranslate,
    runSingleVoice,
    runSingleCleanBgm,
    runSingleEpisodeAll3,
    runSequentialStep,
    stopStep,
  };

  return (
    <DubbingRunnerContext.Provider value={value}>
      {children}
    </DubbingRunnerContext.Provider>
  );
}

export function useDubbingRunnerContext() {
  const context = useContext(DubbingRunnerContext);
  return context;
}

