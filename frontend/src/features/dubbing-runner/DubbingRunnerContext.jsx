import React, { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';
import { killSeparationApi } from '../../services/api';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  checkEpisodeHasAutoFitReady,
  checkEpisodeHasCompactReady,
  getEpisodeBrokenSummary,
} from '../../components/dashboard/geminiRouteHelpers';
import {
  STEP_STATUS,
  normalizeDubbingOptions,
  createStepResult,
} from './dubbingExecutionAdapter';
import {
  runSingleTranslate as runSingleTranslateExec,
  runSingleTextRepair as runSingleTextRepairExec,
  runSingleVoice as runSingleVoiceExec,
  runSingleCleanBgm as runSingleCleanBgmExec,
  runSingleAutoFitSpeed as runSingleAutoFitSpeedExec,
  runSingleAutoCompact as runSingleAutoCompactExec,
} from './singleEpisodeRunners';

const DubbingRunnerContext = createContext(null);

// Every runner is owned by (seriesId, stepType). Episode-level progress is owned by
// (seriesId, type, episodeId). A running job registry binds the client loop + backend
// kill payload to the immutable series/episode snapshot captured when the job started,
// so switching the active folder can never retarget an in-flight job.
const STEP_TYPES = ['translate', 'compact', 'repair', 'voice', 'clean_bgm', 'autofit', 'all3'];
// Which live-statistics bucket each step owns (episode progress is stored per bucket+episodeId).
const STEP_LIVE_STATS_TYPE = {
  translate: 'translate',
  compact: 'compact',
  voice: 'tts',
  clean_bgm: 'demucs',
  autofit: 'autofit',
};
const FALLBACK_SERIES_ID = 'drama_project';

function createStepState(seriesId = null) {
  return {
    seriesId,
    status: 'idle',
    currentEpId: null,
    currentEpIndex: 0,
    totalEps: 0,
    queuedEpIds: [],
    progress: 0,
    message: '',
  };
}

function createSeriesRunnerStates(seriesId) {
  const states = {};
  STEP_TYPES.forEach((step) => {
    states[step] = createStepState(seriesId);
  });
  return states;
}

function createLiveStatsBucket() {
  return { translate: {}, compact: {}, demucs: {}, tts: {}, autofit: {} };
}

const EMPTY_RUNNER_STATES = createSeriesRunnerStates(null);
const EMPTY_LIVE_STATS = createLiveStatsBucket();

const episodeActiveKey = (seriesId, epId) => `${seriesId}::${epId}`;
const jobKeyFor = (seriesId, stepType) => `${seriesId}::${stepType}`;
const singleJobKeyFor = (seriesId, stepType, episodeId) => `${seriesId}::${stepType}::${episodeId}`;

function resolveEpisodeVideoRef(ep) {
  return ep?.videoPath || ep?.sourceVideoPath || ep?.videoFile ||
    (typeof ep?.video === 'string' ? ep.video : ep?.video?.videoPath) ||
    ep?.video?.videoUrl || ep?.videoUrl || '';
}

function createJobToken() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function DubbingRunnerProvider({ children, activeSeries, refreshSeries, onInvalidateRenderedPreview }) {
  const onInvalidateRenderedPreviewRef = useRef(onInvalidateRenderedPreview);
  onInvalidateRenderedPreviewRef.current = onInvalidateRenderedPreview;

  const activeSeriesId = activeSeries?.id || FALLBACK_SERIES_ID;
  const activeSeriesIdRef = useRef(activeSeriesId);
  activeSeriesIdRef.current = activeSeriesId;

  // { [seriesId]: { [stepType]: runnerState } }
  const [runnerStatesBySeries, setRunnerStatesBySeries] = useState({});
  // { [seriesId]: { translate: { [epId]: stats }, compact: {}, demucs: {}, tts: {}, autofit: {} } }
  const [runnerLiveStatsBySeries, setRunnerLiveStatsBySeries] = useState({});
  // Composite `${seriesId}::${episodeId}` keys so identical episode ids in two folders never collide.
  const [activeEpisodeKeys, setActiveEpisodeKeys] = useState(() => new Set());
  const activeEpisodeCountsRef = useRef({});
  // Immutable origin bindings for sequential runner jobs: `${seriesId}::${stepType}` -> entry.
  const jobRegistryRef = useRef(new Map());
  // Same for one-off single-episode runs (used by Stop to abort/reset only that folder's run).
  const singleJobRegistryRef = useRef(new Map());
  // Owning job token per (seriesId, liveStatsType|stepType, episodeId): stale async responses
  // from a superseded job are dropped instead of overwriting the newer job's progress.
  const jobTokenRegistryRef = useRef(new Map());

  const claimJobToken = useCallback((seriesId, keyType, epId, token) => {
    if (!seriesId || !keyType || !epId || !token) return;
    jobTokenRegistryRef.current.set(`${seriesId}::${keyType}::${epId}`, token);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Scoped writers                                                      */
  /* ------------------------------------------------------------------ */

  const updateRunnerStateForSeries = useCallback((seriesId, step, updates) => {
    if (!seriesId || !step) return;
    setRunnerStatesBySeries((prev) => {
      const seriesStates = prev[seriesId] || createSeriesRunnerStates(seriesId);
      const current = seriesStates[step] || createStepState(seriesId);
      const patch = typeof updates === 'function' ? updates(current) : updates;
      if (!patch) return prev;
      return {
        ...prev,
        [seriesId]: {
          ...seriesStates,
          [step]: { ...current, ...patch, seriesId },
        },
      };
    });
  }, []);

  const updateLiveStatsForSeries = useCallback((seriesId, updater) => {
    if (!seriesId || typeof updater !== 'function') return;
    setRunnerLiveStatsBySeries((prev) => {
      const seriesStats = prev[seriesId] || createLiveStatsBucket();
      const nextSeriesStats = updater(seriesStats);
      if (!nextSeriesStats || nextSeriesStats === seriesStats) return prev;
      return { ...prev, [seriesId]: nextSeriesStats };
    });
  }, []);

  const markEpisodeActiveForSeries = useCallback((seriesId, epId) => {
    if (!seriesId || !epId) return;
    const key = episodeActiveKey(seriesId, epId);
    const current = activeEpisodeCountsRef.current[key] || 0;
    activeEpisodeCountsRef.current[key] = current + 1;
    setActiveEpisodeKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const markEpisodeInactiveForSeries = useCallback((seriesId, epId) => {
    if (!seriesId || !epId) return;
    const key = episodeActiveKey(seriesId, epId);
    const current = activeEpisodeCountsRef.current[key] || 0;
    if (current === 0) return;
    const nextCount = current - 1;
    if (nextCount === 0) {
      delete activeEpisodeCountsRef.current[key];
      setActiveEpisodeKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } else {
      activeEpisodeCountsRef.current[key] = nextCount;
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /* Origin-bound helpers passed to executors                            */
  /* ------------------------------------------------------------------ */

  // Refresh must never re-apply another folder's server state into the active workspace:
  // while the origin series is not the active folder, background completion is a no-op.
  const refreshSeriesForOrigin = useCallback((originSeriesId) => {
    if (typeof refreshSeries !== 'function') return async () => null;
    return async () => {
      if (originSeriesId !== activeSeriesIdRef.current) return null;
      return refreshSeries();
    };
  }, [refreshSeries]);

  const makeRunContext = useCallback((originSeriesId, originSeriesSnapshot, jobMeta = {}) => {
    const scopedSeries = originSeriesSnapshot || (activeSeries?.id === originSeriesId ? activeSeries : null);
    const jobToken = jobMeta?.token || null;
    const liveStatsType = STEP_LIVE_STATS_TYPE[jobMeta?.stepType] || null;
    const isTokenCurrent = (keyType, epId) => {
      if (!jobToken || !epId) return true;
      const currentToken = jobTokenRegistryRef.current.get(`${originSeriesId}::${keyType}::${epId}`);
      return !currentToken || currentToken === jobToken;
    };
    return {
      activeSeries: scopedSeries,
      seriesId: originSeriesId,
      refreshSeries: refreshSeriesForOrigin(originSeriesId),
      // Only invalidate an active rendered preview when the completing job still belongs to the active folder.
      onInvalidateRenderedPreviewRef: {
        current: (epId) => {
          if (originSeriesId !== activeSeriesIdRef.current) return;
          const fn = onInvalidateRenderedPreviewRef.current;
          if (typeof fn === 'function') {
            try { fn(epId); } catch (_) {}
          }
        },
      },
      updateRunnerState: (step, updates) => {
        updateRunnerStateForSeries(originSeriesId, step, (prevState) => {
          const patched = typeof updates === 'function' ? updates(prevState) : updates;
          if (!patched) return prevState;
          // A superseded job must not write progress for an episode now owned by a newer job.
          if (patched.currentEpId && !isTokenCurrent(step, patched.currentEpId)) return prevState;
          return patched;
        });
      },
      setRunnerLiveStats: (updater) => {
        if (!liveStatsType || !jobToken) {
          updateLiveStatsForSeries(originSeriesId, updater);
          return;
        }
        updateLiveStatsForSeries(originSeriesId, (seriesStats) => {
          const nextSeriesStats = updater(seriesStats);
          if (!nextSeriesStats || nextSeriesStats === seriesStats) return seriesStats;
          const prevTypeStats = seriesStats[liveStatsType] || {};
          const nextTypeStats = nextSeriesStats[liveStatsType] || {};
          const changedEpIds = new Set();
          for (const epId of Object.keys(nextTypeStats)) {
            if (nextTypeStats[epId] !== prevTypeStats[epId]) changedEpIds.add(epId);
          }
          for (const epId of Object.keys(prevTypeStats)) {
            if (!(epId in nextTypeStats)) changedEpIds.add(epId);
          }
          for (const epId of changedEpIds) {
            if (!isTokenCurrent(liveStatsType, epId)) return seriesStats;
          }
          return nextSeriesStats;
        });
      },
      markEpisodeActive: (epId) => markEpisodeActiveForSeries(originSeriesId, epId),
      markEpisodeInactive: (epId) => markEpisodeInactiveForSeries(originSeriesId, epId),
    };
  }, [activeSeries, refreshSeriesForOrigin, updateRunnerStateForSeries, updateLiveStatsForSeries, markEpisodeActiveForSeries, markEpisodeInactiveForSeries]);

  const registerSingleJob = useCallback((originSeriesId, stepType, ep, signal, jobToken = createJobToken()) => {
    const controller = signal ? null : new AbortController();
    const token = jobToken;
    const liveStatsType = STEP_LIVE_STATS_TYPE[stepType] || null;
    singleJobRegistryRef.current.set(singleJobKeyFor(originSeriesId, stepType, ep?.id || ''), {
      seriesId: originSeriesId,
      stepType,
      episodeId: ep?.id || null,
      videoRef: resolveEpisodeVideoRef(ep),
      jobId: '',
      controller,
      token,
      isSingle: true,
    });
    claimJobToken(originSeriesId, stepType, ep?.id, token);
    claimJobToken(originSeriesId, liveStatsType, ep?.id, token);
    return { signal: signal || controller.signal, token };
  }, [claimJobToken]);

  const unregisterSingleJob = useCallback((originSeriesId, stepType, token) => {
    const entry = Array.from(singleJobRegistryRef.current.entries()).find(([, job]) =>
      job.seriesId === originSeriesId && job.stepType === stepType && job.token === token
    );
    if (!entry) return;
    const [key] = entry;
    const current = singleJobRegistryRef.current.get(key);
    if (current?.token === token) singleJobRegistryRef.current.delete(key);
  }, []);

  const executeSingleScoped = useCallback(async (executor, stepType, ep, options, signal, execCtx) => {
    const originSeriesId = execCtx?.seriesId || activeSeries?.id || ep?.seriesId || FALLBACK_SERIES_ID;
    const originSeriesSnapshot = execCtx?.activeSeries || (activeSeries?.id === originSeriesId ? activeSeries : null);
    const registration = registerSingleJob(originSeriesId, stepType, ep, signal, execCtx?.jobToken);
    try {
      return await executor(ep, options, registration.signal, makeRunContext(originSeriesId, originSeriesSnapshot, {
        stepType,
        token: registration.token,
      }));
    } finally {
      unregisterSingleJob(originSeriesId, stepType, registration.token);
    }
  }, [activeSeries, makeRunContext, registerSingleJob, unregisterSingleJob]);

  /* ------------------------------------------------------------------ */
  /* Single-episode runners                                              */
  /* ------------------------------------------------------------------ */

  const runSingleTranslate = useCallback(
    (ep, options = {}, signal = null, execCtx = null) =>
      executeSingleScoped(runSingleTranslateExec, 'translate', ep, options, signal, execCtx),
    [executeSingleScoped]
  );

  const runSingleTextRepair = useCallback(
    (ep, options = {}, signal = null, execCtx = null) =>
      executeSingleScoped(runSingleTextRepairExec, 'repair', ep, options, signal, execCtx),
    [executeSingleScoped]
  );

  const runSingleAutoCompact = useCallback(
    (ep, options = {}, signal = null, execCtx = null) =>
      executeSingleScoped(runSingleAutoCompactExec, 'compact', ep, options, signal, execCtx),
    [executeSingleScoped]
  );

  const runSingleVoice = useCallback(
    (ep, options = {}, signal = null, execCtx = null) => {
      return executeSingleScoped(runSingleVoiceExec, 'voice', ep, options, signal, execCtx);
    }, [activeSeries, refreshSeries, onInvalidateRenderedPreview, executeSingleScoped]
  );

  const runSingleCleanBgm = useCallback(
    (ep, options = {}, signal = null, execCtx = null) =>
      executeSingleScoped(runSingleCleanBgmExec, 'clean_bgm', ep, options, signal, execCtx),
    [executeSingleScoped]
  );

  const runSingleAutoFitSpeed = useCallback(
    (ep, options = {}, signal = null, execCtx = null) =>
      executeSingleScoped(runSingleAutoFitSpeedExec, 'autofit', ep, options, signal, execCtx),
    [executeSingleScoped]
  );

  /**
   * 4. Run all 3 steps for 1 single episode
   * Resource-aware Smart Pipeline:
   * - Clean BGM (Demucs) depends only on video; starts in parallel or queues safely.
   * - Script (Fast OCR / Translation) runs.
   * - Voice (TTS) waits for Script completion (strict dependency contract).
   * - Awaits Clean BGM before marking episode complete.
   */
  const runSingleEpisodeAll3 = useCallback(async (ep, options = {}, signal = null, execCtx = null) => {
    const originSeriesId = execCtx?.seriesId || activeSeries?.id || ep?.seriesId || FALLBACK_SERIES_ID;
    const originSeriesSnapshot = execCtx?.activeSeries || (activeSeries?.id === originSeriesId ? activeSeries : null);
    const jobToken = execCtx?.jobToken || createJobToken();

    const stepsStatus = {
      translate: { status: 'pending' },
      voice: { status: 'pending' },
      clean_bgm: { status: 'pending' },
    };

    if (!ep) {
      return {
        ...createStepResult({ status: STEP_STATUS.FAILED, error: 'No episode provided' }),
        failedStep: null,
        steps: stepsStatus,
        error: { code: 'INVALID_EPISODE', message: 'No episode provided' },
      };
    }

    if (signal?.aborted) {
      return {
        ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
        aborted: true,
        failedStep: null,
        steps: {
          translate: { status: 'cancelled' },
          voice: { status: 'pending' },
          clean_bgm: { status: 'cancelled' },
        },
        error: { code: 'ABORTED', message: 'Operation cancelled by user' },
      };
    }

    const registration = registerSingleJob(originSeriesId, 'all3', ep, signal, jobToken);
    const effectiveSignal = registration.signal;
    const originExecCtx = { seriesId: originSeriesId, activeSeries: originSeriesSnapshot, jobToken: registration.token };
    const ctx = makeRunContext(originSeriesId, originSeriesSnapshot, { stepType: 'all3', token: registration.token });
    const updateRunnerState = ctx.updateRunnerState;

    const norm = normalizeDubbingOptions(ep, 'all3', options, { activeSeries: originSeriesSnapshot, seriesId: originSeriesId });
    const seriesId = norm.seriesId;
    const hasDemucs = checkEpisodeHasDemucsReady(ep, null, null);
    let bgmPromise = null;

    try {
      ctx.markEpisodeActive(ep.id);
      updateRunnerState('all3', {
        status: 'running',
        currentEpId: ep.id,
        progress: 0,
        message: `[EP${ep.episodeNumber || ep.id}] ដំណើរការទាំង 3 ជំហាន...`,
      });

      try {
        // 1. Kick off Clean BGM in parallel if not already cached and not skipped
        if ((!hasDemucs || norm.force) && !options.skipCleanBgm) {
          stepsStatus.clean_bgm = { status: 'running' };
          bgmPromise = runSingleCleanBgm(ep, options, effectiveSignal, originExecCtx).catch((bgmErr) => ({
            success: false,
            error: bgmErr?.message || 'Clean BGM separation failed',
          }));
        } else {
          stepsStatus.clean_bgm = { status: options.skipCleanBgm ? 'skipped' : 'completed' };
        }

        // 2. Step 1: Script Khmer (Chinese Subtitle OCR -> Khmer Translation)
        if (effectiveSignal?.aborted) {
          return {
            ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
            aborted: true,
            failedStep: null,
            steps: stepsStatus,
            error: { code: 'ABORTED', message: 'Operation cancelled by user' },
          };
        }

        stepsStatus.translate = { status: 'running' };
        let scriptRes = null;
        try {
          scriptRes = await runSingleTranslate(ep, options, effectiveSignal, originExecCtx);
        } catch (sErr) {
          if (effectiveSignal?.aborted) {
            return {
              ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
              aborted: true,
              failedStep: null,
              steps: stepsStatus,
              error: { code: 'ABORTED', message: 'Operation cancelled by user' },
            };
          }
          scriptRes = { success: false, error: sErr?.message || 'Script generation failed' };
        }

        if (effectiveSignal?.aborted) {
          return {
            ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
            aborted: true,
            failedStep: null,
            steps: stepsStatus,
            error: { code: 'ABORTED', message: 'Operation cancelled by user' },
          };
        }

        if (!scriptRes?.success) {
          if (scriptRes?.skipped && checkEpisodeHasScript(ep)) {
            stepsStatus.translate = { status: 'completed' };
          } else {
            stepsStatus.translate = { status: 'failed' };
            return {
              ...createStepResult({
                status: STEP_STATUS.FAILED,
                error: scriptRes?.error || scriptRes?.reason || 'Script generation failed',
              }),
              failedStep: 'translate',
              steps: stepsStatus,
              error: {
                code: 'SCRIPT_GENERATION_FAILED',
                message: scriptRes?.error || scriptRes?.reason || 'Script generation failed',
              },
            };
          }
        } else {
          stepsStatus.translate = { status: 'completed' };
        }
        await ctx.refreshSeries();

        // Hydrate fresh episode from server to ensure fresh script segments reach Voice TTS
        let freshEp = ep;
        try {
          const epRes = await fetch(`/api/series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(ep.id)}`);
          if (epRes.ok) {
            const epData = await epRes.json();
            if (epData?.episode) freshEp = epData.episode;
          }
        } catch (_) {}

        // 3. Step 2: Voice TTS (Strictly depends on Script!)
        if (effectiveSignal?.aborted) {
          return {
            ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
            aborted: true,
            failedStep: null,
            steps: stepsStatus,
            error: { code: 'ABORTED', message: 'Operation cancelled by user' },
          };
        }

        stepsStatus.voice = { status: 'running' };
        let voiceRes = null;
        try {
          voiceRes = await runSingleVoice(freshEp, options, effectiveSignal, originExecCtx);
        } catch (vErr) {
          if (effectiveSignal?.aborted) {
            return {
              ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
              aborted: true,
              failedStep: null,
              steps: stepsStatus,
              error: { code: 'ABORTED', message: 'Operation cancelled by user' },
            };
          }
          voiceRes = { success: false, error: vErr?.message || 'Voice generation failed' };
        }

        if (effectiveSignal?.aborted) {
          return {
            ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
            aborted: true,
            failedStep: null,
            steps: stepsStatus,
            error: { code: 'ABORTED', message: 'Operation cancelled by user' },
          };
        }

        if (!voiceRes?.success) {
          if (voiceRes?.skipped && checkEpisodeHasAudioReady(freshEp, null, null) && !freshEp.audioOutdated) {
            stepsStatus.voice = { status: 'completed' };
          } else {
            stepsStatus.voice = { status: 'failed' };
            return {
              ...createStepResult({
                status: STEP_STATUS.FAILED,
                error: voiceRes?.error || voiceRes?.reason || 'Voice generation failed',
              }),
              failedStep: 'voice',
              steps: stepsStatus,
              error: {
                code: 'VOICE_GENERATION_FAILED',
                message: voiceRes?.error || voiceRes?.reason || 'Voice generation failed',
              },
            };
          }
        } else {
          stepsStatus.voice = { status: 'completed' };
        }
        await ctx.refreshSeries();

        // 4. Step 3: Await Clean BGM if running in background
        if (effectiveSignal?.aborted) {
          return {
            ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
            aborted: true,
            failedStep: null,
            steps: stepsStatus,
            error: { code: 'ABORTED', message: 'Operation cancelled by user' },
          };
        }

        if (bgmPromise) {
          const bgmRes = await bgmPromise;
          if (effectiveSignal?.aborted) {
            return {
              ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
              aborted: true,
              failedStep: null,
              steps: stepsStatus,
              error: { code: 'ABORTED', message: 'Operation cancelled by user' },
            };
          }
          if (!bgmRes?.success && !options.skipCleanBgm) {
            if (bgmRes?.skipped && checkEpisodeHasDemucsReady(freshEp, null, null)) {
              stepsStatus.clean_bgm = { status: 'completed' };
            } else {
              stepsStatus.clean_bgm = { status: 'failed' };
              return {
                ...createStepResult({
                  status: STEP_STATUS.FAILED,
                  error: bgmRes?.error || 'Clean BGM separation failed',
                }),
                failedStep: 'clean_bgm',
                steps: stepsStatus,
                error: {
                  code: 'BGM_GENERATION_FAILED',
                  message: bgmRes?.error || 'Clean BGM separation failed',
                },
              };
            }
          } else {
            stepsStatus.clean_bgm = { status: 'completed' };
          }
        } else if ((!hasDemucs || norm.force) && !options.skipCleanBgm) {
          stepsStatus.clean_bgm = { status: 'running' };
          let directBgmRes = null;
          try {
            directBgmRes = await runSingleCleanBgm(freshEp, options, effectiveSignal, originExecCtx);
          } catch (bErr) {
            if (effectiveSignal?.aborted) {
              return {
                ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
                aborted: true,
                failedStep: null,
                steps: stepsStatus,
                error: { code: 'ABORTED', message: 'Operation cancelled by user' },
              };
            }
            directBgmRes = { success: false, error: bErr?.message || 'Clean BGM separation failed' };
          }

          if (effectiveSignal?.aborted) {
            return {
              ...createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' }),
              aborted: true,
              failedStep: null,
              steps: stepsStatus,
              error: { code: 'ABORTED', message: 'Operation cancelled by user' },
            };
          }

          if (!directBgmRes?.success && !options.skipCleanBgm) {
            if (directBgmRes?.skipped && checkEpisodeHasDemucsReady(freshEp, null, null)) {
              stepsStatus.clean_bgm = { status: 'completed' };
            } else {
              stepsStatus.clean_bgm = { status: 'failed' };
              return {
                ...createStepResult({
                  status: STEP_STATUS.FAILED,
                  error: directBgmRes?.error || 'Clean BGM separation failed',
                }),
                failedStep: 'clean_bgm',
                steps: stepsStatus,
                error: {
                  code: 'BGM_GENERATION_FAILED',
                  message: directBgmRes?.error || 'Clean BGM separation failed',
                },
              };
            }
          } else {
            stepsStatus.clean_bgm = { status: 'completed' };
          }
        } else {
          stepsStatus.clean_bgm = { status: options.skipCleanBgm ? 'skipped' : 'completed' };
        }

        await ctx.refreshSeries();

        return {
          ...createStepResult({ status: STEP_STATUS.COMPLETED }),
          failedStep: null,
          steps: stepsStatus,
        };
      } finally {
        ctx.markEpisodeInactive(ep.id);
        updateRunnerState('all3', (prev) => (prev.currentEpId === ep.id ? { ...prev, status: 'idle' } : prev));
      }
    } finally {
      unregisterSingleJob(originSeriesId, 'all3', registration.token);
    }
  }, [activeSeries, makeRunContext, registerSingleJob, unregisterSingleJob, runSingleCleanBgm, runSingleTranslate, runSingleVoice]);

  /**
   * 5. Strict 1-by-1 Sequential Queue Runner (EP1 ➔ EP2 ➔ ... ➔ EPN)
   * Awaits 100% completion of episode N before triggering episode N+1.
   * The originating series is captured once here: all state writes, backend kills and
   * refresh calls stay bound to it even after the user switches folders.
   */
  const runSequentialStep = useCallback(async (stepType, episodesList = [], options = {}, execCtx = null) => {
    const originSeriesSnapshot = execCtx?.activeSeries || activeSeries;
    const originSeriesId = execCtx?.seriesId || originSeriesSnapshot?.id || FALLBACK_SERIES_ID;
    const originExecCtx = { seriesId: originSeriesId, activeSeries: originSeriesSnapshot };
    const updateRunnerState = (updates) => updateRunnerStateForSeries(originSeriesId, stepType, updates);
    const refreshOriginSeries = refreshSeriesForOrigin(originSeriesId);

    const allEpisodes = Array.isArray(originSeriesSnapshot?.episodes) ? originSeriesSnapshot.episodes : [];

    // Smart Auto-Targeting: If episodesList is empty, auto-target episodes needing this step
    let queue = Array.isArray(episodesList) && episodesList.length > 0 ? [...episodesList] : [];
    const candidates = queue.length > 0 ? queue : allEpisodes;

    if (stepType === 'repair') {
      queue = candidates.filter((ep) => {
        const scan = getEpisodeBrokenSummary(ep);
        return (scan?.textBrokenCount > 0 || scan?.totalBrokenCount > 0 || ep.status === 'failed');
      });
      if (queue.length === 0) {
        updateRunnerState({ status: 'idle', message: '✅ គ្រប់ភាគទាំងអស់មានអត្ថបទត្រឹមត្រូវ (គ្មានឃ្លាខូចទេ)' });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0, reason: 'no_broken_segments' });
      }
    } else if (stepType === 'autofit') {
      if (options.force) {
        queue = candidates.filter((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null));
      } else {
        queue = candidates.filter((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null) && !checkEpisodeHasAutoFitReady(ep));
      }

      if (queue.length === 0) {
        const hasVoiced = candidates.some((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null));
        updateRunnerState({
          status: 'idle',
          message: !hasVoiced
            ? 'មិនទាន់មានភាគដែលមានសំឡេងសម្រាប់ Auto-Fit ទេ'
            : 'គ្រប់ភាគទាំងអស់បាន Auto-Fit Speed រួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")',
        });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0, reason: 'already_autofitted' });
      }
    } else if (stepType === 'compact') {
      if (options.force) {
        queue = candidates.filter((ep) => checkEpisodeHasScript(ep));
      } else {
        queue = candidates.filter((ep) => checkEpisodeHasScript(ep) && !checkEpisodeHasCompactReady(ep));
      }

      if (queue.length === 0) {
        const hasScript = candidates.some((ep) => checkEpisodeHasScript(ep));
        updateRunnerState({
          status: 'idle',
          message: !hasScript
            ? 'មិនទាន់មានភាគដែលមាន Script សម្រាប់បម្លែងទេ'
            : 'គ្រប់ភាគទាំងអស់បានបម្លែង Script ខ្លីរួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")',
        });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0, reason: 'already_compacted' });
      }
    } else if (stepType === 'translate') {
      if (options.force) {
        if (options.todoOnly) {
          queue = candidates.filter((ep) => !checkEpisodeHasScript(ep) || (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) > 0);
        } else {
          queue = candidates;
        }
      } else {
        const unscripted = candidates.filter((ep) => !checkEpisodeHasScript(ep));
        if (unscripted.length > 0) {
          queue = unscripted;
        } else {
          // If all episodes have scripts but some have broken sentences, seamlessly repair them
          const brokenTarget = candidates.filter((ep) => (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) > 0);
          if (brokenTarget.length > 0) {
            return runSequentialStep('repair', brokenTarget, options, originExecCtx);
          }
          queue = [];
        }
      }

      if (queue.length === 0) {
        updateRunnerState({
          status: 'idle',
          message: 'គ្រប់ភាគទាំងអស់មាន Script រួចរាល់ 100% ហើយ — បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ"',
        });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0, reason: 'already_has_script' });
      }
    } else if (stepType === 'voice') {
      if (options.force) {
        queue = candidates.filter((ep) => checkEpisodeHasScript(ep));
      } else {
        queue = candidates.filter((ep) => checkEpisodeHasScript(ep) && (!checkEpisodeHasAudioReady(ep, null, null) || ep.audioOutdated));
      }

      if (queue.length === 0) {
        const hasScript = candidates.some((ep) => checkEpisodeHasScript(ep));
        updateRunnerState({
          status: 'idle',
          message: !hasScript
            ? 'មិនទាន់មានភាគដែលមាន Script សម្រាប់បង្កើតសំឡេង AI ទេ'
            : 'គ្រប់ភាគទាំងអស់មានសំឡេង AI រួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")',
        });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0, reason: 'already_voiced' });
      }
    } else if (stepType === 'clean_bgm') {
      if (options.force) {
        queue = candidates;
      } else {
        queue = candidates.filter((ep) => !checkEpisodeHasDemucsReady(ep, null, null));
      }

      if (queue.length === 0) {
        updateRunnerState({
          status: 'idle',
          message: 'គ្រប់ភាគទាំងអស់មាន Clean BGM រួចរាល់ 100% ហើយ — បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ"',
        });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0, reason: 'already_clean_bgm' });
      }
    } else if (stepType === 'all3') {
      if (options.force) {
        queue = candidates;
      } else {
        queue = candidates.filter((ep) => !checkEpisodeHasScript(ep) || !checkEpisodeHasAudioReady(ep, null, null) || !checkEpisodeHasDemucsReady(ep, null, null));
      }

      if (queue.length === 0) {
        updateRunnerState({
          status: 'idle',
          message: 'គ្រប់ភាគទាំងអស់បានបញ្ចប់គ្រប់ដំណាក់កាលរួចរាល់ 100% ហើយ',
        });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0, reason: 'all_already_done' });
      }
    }

    if (queue.length === 0) {
      updateRunnerState({ status: 'idle', message: 'គ្រប់ភាគទាំងអស់រួចរាល់ហើយ' });
      return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0 });
    }

    const targetSeriesId = originSeriesId;
    const queuedEpIds = queue.map((e) => e.id);

    // One abort controller + immutable origin payload per (series, step) running job.
    const controller = new AbortController();
    const token = createJobToken();
    const stepExecCtx = { ...originExecCtx, jobToken: token };
    const registryKey = jobKeyFor(targetSeriesId, stepType);
    const liveStatsType = STEP_LIVE_STATS_TYPE[stepType] || null;
    const buildRegistryEntry = (currentEp) => ({
      seriesId: targetSeriesId,
      stepType,
      episodeId: currentEp?.id || null,
      videoRef: resolveEpisodeVideoRef(currentEp),
      jobId: '',
      controller,
      token,
      queuedEpIds,
      isSingle: false,
    });
    jobRegistryRef.current.set(registryKey, buildRegistryEntry(queue[0]));
    claimJobToken(targetSeriesId, stepType, queue[0]?.id, token);
    claimJobToken(targetSeriesId, liveStatsType, queue[0]?.id, token);
    const refreshOwnEntry = (currentEp, jobId) => {
      const entry = jobRegistryRef.current.get(registryKey);
      if (!entry || entry.token !== token) return;
      entry.episodeId = currentEp?.id || entry.episodeId;
      entry.videoRef = resolveEpisodeVideoRef(currentEp) || entry.videoRef;
      if (jobId) entry.jobId = jobId;
    };

    updateRunnerState({
      seriesId: targetSeriesId,
      status: 'running',
      currentEpIndex: 1,
      totalEps: queue.length,
      currentEpId: queue[0]?.id || null,
      queuedEpIds,
      progress: 0,
      message: `ចាប់ផ្តើមរត់ 1-by-1 លើ ${queue.length} ភាគ...`,
    });

    try {
      let lastStepResult = null;
      for (let idx = 0; idx < queue.length; idx++) {
        if (controller.signal.aborted) {
          console.log(`[1-by-1 Runner] 🛑 បញ្ឈប់ដំណើរការ ${stepType} ដោយអ្នកប្រើប្រាស់ (series ${targetSeriesId})`);
          break;
        }
        const currentEp = queue[idx];

        markEpisodeActiveForSeries(targetSeriesId, currentEp.id);
        claimJobToken(targetSeriesId, stepType, currentEp.id, token);
        claimJobToken(targetSeriesId, liveStatsType, currentEp.id, token);
        refreshOwnEntry(currentEp);
        updateRunnerState({
          seriesId: targetSeriesId,
          status: 'running',
          currentEpIndex: idx + 1,
          totalEps: queue.length,
          currentEpId: currentEp.id,
          queuedEpIds,
          message: `កំពុងរត់ EP${currentEp.episodeNumber || currentEp.id} (${idx + 1}/${queue.length})...`,
        });

        console.log(`%c[1-by-1 Runner] 🚀 [${targetSeriesId} EP${currentEp.episodeNumber || currentEp.id}] ចាប់ផ្ដើម ${stepType.toUpperCase()} (${idx + 1}/${queue.length})...`, 'color: #38bdf8; font-weight: bold;');

        // Await 100% completion of single episode step before proceeding to next!
        // Retries up to 2 times with backoff on transient backend restart / 502 / ECONNRESET errors.
        let stepResult = null;
        const maxTransientRetries = 2;
        for (let attempt = 0; attempt <= maxTransientRetries; attempt++) {
          try {
            if (stepType === 'translate') {
              stepResult = await runSingleTranslate(currentEp, options, controller.signal, stepExecCtx);
            } else if (stepType === 'repair') {
              stepResult = await runSingleTextRepair(currentEp, options, controller.signal, stepExecCtx);
            } else if (stepType === 'voice') {
              stepResult = await runSingleVoice(currentEp, options, controller.signal, stepExecCtx);
            } else if (stepType === 'clean_bgm') {
              stepResult = await runSingleCleanBgm(currentEp, options, controller.signal, stepExecCtx);
            } else if (stepType === 'compact') {
              stepResult = await runSingleAutoCompact(currentEp, options, controller.signal, stepExecCtx);
            } else if (stepType === 'autofit') {
              stepResult = await runSingleAutoFitSpeed(currentEp, options, controller.signal, stepExecCtx);
            } else if (stepType === 'all3') {
              stepResult = await runSingleEpisodeAll3(currentEp, options, controller.signal, stepExecCtx);
            }
            if (stepResult?.jobId) refreshOwnEntry(currentEp, stepResult.jobId);
            const errText = String(stepResult?.error?.message || stepResult?.error || '');
            const isTransient = Boolean(
              stepResult && !stepResult.success && !stepResult.skipped &&
              /ECONNRESET|ECONNREFUSED|502|503|temporarily unreachable|Failed to fetch|ended unexpectedly|temporarily interrupted/i.test(errText)
            );
            if (isTransient && attempt < maxTransientRetries && !controller.signal.aborted) {
              console.warn(`[1-by-1 Runner] ⏳ [EP${currentEp.episodeNumber || currentEp.id}] Transient backend error (${errText}), retrying (${attempt + 1}/${maxTransientRetries})...`);
              await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
              continue;
            }
            break;
          } catch (stepErr) {
            const errMsg = String(stepErr?.message || '');
            const isTransient = /ECONNRESET|ECONNREFUSED|502|503|temporarily unreachable|Failed to fetch|ended unexpectedly|temporarily interrupted/i.test(errMsg);
            if (isTransient && attempt < maxTransientRetries && !controller.signal.aborted) {
              console.warn(`[1-by-1 Runner] ⏳ [EP${currentEp.episodeNumber || currentEp.id}] Transient network exception (${errMsg}), retrying (${attempt + 1}/${maxTransientRetries})...`);
              await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
              continue;
            }
            throw stepErr;
          }
        }
        lastStepResult = stepResult;

        if (controller.signal.aborted || stepResult?.aborted || stepResult?.status === STEP_STATUS.CANCELLED || stepResult?.status === 'cancelled') {
          break;
        }
        if (stepResult && !stepResult.success && !stepResult.skipped) {
          throw new Error(stepResult?.error?.message || stepResult?.error || `Episode ${stepType} step failed`);
        }

        markEpisodeInactiveForSeries(targetSeriesId, currentEp.id);

        await refreshOriginSeries();
      }

      if (controller.signal.aborted || lastStepResult?.aborted || lastStepResult?.status === STEP_STATUS.CANCELLED || lastStepResult?.status === 'cancelled') {
        updateRunnerState({ status: 'idle', currentEpId: null, queuedEpIds: [], message: 'បានបញ្ឈប់ដោយអ្នកប្រើប្រាស់' });
        return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
      }

      console.log(`%c[1-by-1 Runner] 🎉 ជោគជ័យ 100% លើគ្រប់ទាំង ${queue.length} ភាគសម្រាប់ ${stepType.toUpperCase()} (series ${targetSeriesId})!`, 'color: #34d399; font-weight: bold;');

      updateRunnerState({
        status: 'idle',
        currentEpId: null,
        currentEpIndex: 0,
        totalEps: 0,
        queuedEpIds: [],
        progress: 100,
        message: 'រួចរាល់ 100%!',
      });

      return createStepResult({ status: STEP_STATUS.COMPLETED, count: queue.length });
    } catch (err) {
      if (controller.signal.aborted) {
        updateRunnerState({ status: 'idle', currentEpId: null, queuedEpIds: [], message: 'បានបញ្ឈប់ដោយអ្នកប្រើប្រាស់' });
        return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
      }
      const errMessage = err?.message || 'ជួបបញ្ហាពេលដំណើរការ';
      console.warn(`[1-by-1 Runner] ⚠️ ${stepType.toUpperCase()} stopped with error (series ${targetSeriesId}):`, errMessage);
      updateRunnerState({ status: 'failed', message: errMessage });
      return createStepResult({ status: STEP_STATUS.FAILED, error: errMessage });
    } finally {
      const ownedEntry = jobRegistryRef.current.get(registryKey);
      if (ownedEntry?.token === token) {
        jobRegistryRef.current.delete(registryKey);
      }
      queue.forEach((ep) => markEpisodeInactiveForSeries(targetSeriesId, ep.id));
    }
  }, [activeSeries, updateRunnerStateForSeries, markEpisodeActiveForSeries, markEpisodeInactiveForSeries, claimJobToken, runSingleTranslate, runSingleTextRepair, runSingleVoice, runSingleCleanBgm, runSingleAutoFitSpeed, runSingleAutoCompact, runSingleEpisodeAll3, refreshSeriesForOrigin]);

  /**
   * Stop an active runner cleanly (Guarantees both UI loop & Backend processes are terminated).
   * The backend target is resolved ONLY from the immutable job registry captured when the job
   * started — never from the currently selected folder.
   */
  const stopStep = useCallback(async (stepType, opts = {}) => {
    const requestedSeriesId = opts && typeof opts === 'object' ? opts.seriesId : null;
    const requestedEpisodeId = opts && typeof opts === 'object' ? opts.episodeId : null;
    const requestedJobId = opts && typeof opts === 'object' ? opts.jobId : null;
    const lookupSeriesId = requestedSeriesId || activeSeriesIdRef.current || FALLBACK_SERIES_ID;
    const registryKey = jobKeyFor(lookupSeriesId, stepType);
    const sequentialEntry = jobRegistryRef.current.get(registryKey) || null;
    const sequentialMatches = sequentialEntry &&
      (!requestedEpisodeId || sequentialEntry.episodeId === requestedEpisodeId) &&
      (!requestedJobId || sequentialEntry.jobId === requestedJobId);
    const singleMatches = Array.from(singleJobRegistryRef.current.values()).filter((job) =>
      job.seriesId === lookupSeriesId &&
      job.stepType === stepType &&
      (!requestedEpisodeId || job.episodeId === requestedEpisodeId) &&
      (!requestedJobId || job.jobId === requestedJobId)
    );
    const trackedJob = (sequentialMatches && sequentialEntry) || singleMatches[singleMatches.length - 1] ||
      (!requestedEpisodeId && !requestedJobId ? sequentialEntry : null);

    // 1. Abort the exact in-flight client loop owned by this folder's job.
    if (trackedJob?.controller) {
      try { trackedJob.controller.abort(); } catch (_) {}
    }

    const targetSeriesId = trackedJob?.seriesId || lookupSeriesId;
    const currentEpId = trackedJob?.episodeId || null;
    const videoRef = trackedJob?.videoRef || '';
    const jobId = trackedJob?.jobId || '';

    let stopFailed = false;
    let stopErrorMessage = '';

    // 2. Transmit scoped kill command to the exact originating backend job only.
    if (trackedJob) {
      try {
        if (stepType === 'clean_bgm' || stepType === 'all3') {
          if (!videoRef) {
            stopFailed = true;
            stopErrorMessage = 'មិនអាចកំណត់ Video Path ដើមរបស់ Job បានទេ (origin target missing)';
          } else {
            const killSepRes = await killSeparationApi({
              videoPath: videoRef,
              jobId: jobId || videoRef,
              seriesId: targetSeriesId,
              episodeId: currentEpId,
            })
              .catch((err) => ({ success: false, error: err.message }));
            if (killSepRes && killSepRes.success === false) {
              console.warn('[DubbingRunner] Demucs kill returned error:', killSepRes.error);
              stopFailed = true;
              stopErrorMessage = killSepRes.error || 'បរាជ័យក្នុងការបញ្ឈប់ Demucs';
            }
          }
        }
        if (stepType === 'voice' || stepType === 'all3') {
          const res = await fetch('/api/tts/kill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              seriesId: targetSeriesId,
              episodeId: currentEpId,
              all: false,
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.success === false) {
            stopFailed = true;
            stopErrorMessage = result.error || `TTS cancellation failed (HTTP ${res.status})`;
          }
        }
        if (stepType === 'translate' || stepType === 'repair' || stepType === 'all3') {
          const res = await fetch('/api/jobs/kill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              seriesId: targetSeriesId,
              episodeId: currentEpId || undefined,
              all: false,
            }),
          });
          // 404 => no longer active/queued for that exact series+episode (already finished): treat as stopped.
          if (!res.ok && res.status !== 404) {
            const errData = await res.json().catch(() => ({}));
            console.warn(`[DubbingRunner] Kill jobs returned HTTP ${res.status}:`, errData.error);
            stopFailed = true;
            stopErrorMessage = errData.error || `Server ឆ្លើយតប error HTTP ${res.status}`;
          }
        }
      } catch (killErr) {
        console.error('[DubbingRunner] Error in stopStep kill call:', killErr.message);
        stopFailed = true;
        stopErrorMessage = killErr.message;
      }
    }

    // 3. Reset ONLY the originating folder's step state.
    const remainingSingleJob = Array.from(singleJobRegistryRef.current.values()).find((job) =>
      job.seriesId === targetSeriesId && job.stepType === stepType && job.token !== trackedJob?.token
    );
    const remainingSequentialJob = jobRegistryRef.current.get(registryKey);
    const remainingJob = remainingSequentialJob?.token !== trackedJob?.token
      ? remainingSequentialJob
      : remainingSingleJob;

    if (stopFailed) {
      updateRunnerStateForSeries(targetSeriesId, stepType, {
        status: remainingJob ? 'running' : 'error',
        currentEpId: remainingJob?.episodeId || currentEpId,
        message: remainingJob
          ? `កំពុងដំណើរការ EP${remainingJob.episodeId}...`
          : `⚠️ ការបញ្ឈប់បរាជ័យ: ${stopErrorMessage}`,
        error: stopErrorMessage,
      });
    } else {
      updateRunnerStateForSeries(targetSeriesId, stepType, {
        status: remainingJob ? 'running' : 'idle',
        currentEpId: remainingJob?.episodeId || null,
        currentEpIndex: remainingJob?.currentEpIndex || 0,
        totalEps: remainingJob?.totalEps || 0,
        queuedEpIds: remainingJob?.queuedEpIds || [],
        progress: 0,
        message: remainingJob
          ? `កំពុងដំណើរការ EP${remainingJob.episodeId}...`
          : '🛑 បានបញ្ឈប់ (Stopped UI & Backend)',
      });
    }

    // 4. Drop the registry entry only if it still belongs to the job we stopped.
    if (trackedJob) {
      const sequentialEntry = jobRegistryRef.current.get(registryKey);
      if (sequentialEntry && sequentialEntry.token === trackedJob.token) jobRegistryRef.current.delete(registryKey);
      const singleEntryKey = singleJobKeyFor(targetSeriesId, stepType, trackedJob.episodeId || '');
      const singleEntry = singleJobRegistryRef.current.get(singleEntryKey);
      if (singleEntry && singleEntry.token === trackedJob.token) singleJobRegistryRef.current.delete(singleEntryKey);
    }

    return {
      success: !stopFailed,
      stopped: Boolean(trackedJob),
      seriesId: targetSeriesId,
      episodeId: currentEpId,
    };
  }, [updateRunnerStateForSeries]);

  /* ------------------------------------------------------------------ */
  /* Scoped public views (consumers keep reading the active folder only) */
  /* ------------------------------------------------------------------ */

  const runnerStates = useMemo(
    () => runnerStatesBySeries[activeSeriesId] || EMPTY_RUNNER_STATES,
    [runnerStatesBySeries, activeSeriesId]
  );

  const runnerLiveStats = useMemo(
    () => runnerLiveStatsBySeries[activeSeriesId] || EMPTY_LIVE_STATS,
    [runnerLiveStatsBySeries, activeSeriesId]
  );

  const activeEpisodeIds = useMemo(() => {
    const prefix = `${activeSeriesId}::`;
    const ids = new Set();
    for (const key of activeEpisodeKeys) {
      if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
    }
    return ids;
  }, [activeEpisodeKeys, activeSeriesId]);

  const runningRunnerJobs = useMemo(() => {
    const running = [];
    for (const [seriesId, steps] of Object.entries(runnerStatesBySeries)) {
      STEP_TYPES.forEach((stepType) => {
        const state = steps?.[stepType];
        if (state?.status === 'running') running.push({ seriesId, stepType, state });
      });
    }
    return running;
  }, [runnerStatesBySeries]);

  const markEpisodeActive = useCallback(
    (epId, seriesId = null) => markEpisodeActiveForSeries(seriesId || activeSeriesIdRef.current, epId),
    [markEpisodeActiveForSeries]
  );
  const markEpisodeInactive = useCallback(
    (epId, seriesId = null) => markEpisodeInactiveForSeries(seriesId || activeSeriesIdRef.current, epId),
    [markEpisodeInactiveForSeries]
  );

  const value = useMemo(() => ({
    runnerStates,
    activeEpisodeIds,
    markEpisodeActive,
    markEpisodeInactive,
    runnerLiveStats,
    // Global (all folders) views for dashboards/badges; UI cards must use the scoped views above.
    allRunnerStates: runnerStatesBySeries,
    allRunnerLiveStats: runnerLiveStatsBySeries,
    runningRunnerJobs,
    activeSeriesId,
    runSingleTranslate,
    runSingleAutoCompact,
    runSingleTextRepair,
    runSingleVoice,
    runSingleCleanBgm,
    runSingleAutoFitSpeed,
    runSingleEpisodeAll3,
    runSequentialStep,
    stopStep,
  }), [
    runnerStates, activeEpisodeIds, markEpisodeActive, markEpisodeInactive, runnerLiveStats,
    runnerStatesBySeries, runnerLiveStatsBySeries, runningRunnerJobs, activeSeriesId,
    runSingleTranslate, runSingleAutoCompact, runSingleTextRepair, runSingleVoice,
    runSingleCleanBgm, runSingleAutoFitSpeed, runSingleEpisodeAll3, runSequentialStep, stopStep,
  ]);

  return (
    <DubbingRunnerContext.Provider value={value}>
      {children}
    </DubbingRunnerContext.Provider>
  );
}

export function useDubbingRunnerContext() {
  return useContext(DubbingRunnerContext);
}
