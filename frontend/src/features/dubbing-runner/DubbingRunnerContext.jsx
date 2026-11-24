import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { killSeparationApi } from '../../services/api';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  checkEpisodeHasAutoFitReady,
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

export function DubbingRunnerProvider({ children, activeSeries, refreshSeries, onInvalidateRenderedPreview }) {
  const onInvalidateRenderedPreviewRef = useRef(onInvalidateRenderedPreview);
  onInvalidateRenderedPreviewRef.current = onInvalidateRenderedPreview;

  // Global runners state per step: 'translate' | 'compact' | 'repair' | 'voice' | 'clean_bgm' | 'autofit' | 'all3'
  const [runnerStates, setRunnerStates] = useState({
    translate: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    compact: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    repair: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    voice: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    clean_bgm: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    autofit: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
    all3: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
  });

  // Track currently processing episode IDs across all runners
  const [activeEpisodeIds, setActiveEpisodeIds] = useState(new Set());
  const activeEpisodeCountsRef = useRef({});

  const markEpisodeActive = useCallback((epId) => {
    if (!epId) return;
    const current = activeEpisodeCountsRef.current[epId] || 0;
    activeEpisodeCountsRef.current[epId] = current + 1;
    setActiveEpisodeIds((prev) => {
      if (prev.has(epId)) return prev;
      const next = new Set(prev);
      next.add(epId);
      return next;
    });
  }, []);

  const markEpisodeInactive = useCallback((epId) => {
    if (!epId) return;
    const current = (activeEpisodeCountsRef.current[epId] || 1) - 1;
    if (current <= 0) {
      delete activeEpisodeCountsRef.current[epId];
      setActiveEpisodeIds((prev) => {
        if (!prev.has(epId)) return prev;
        const next = new Set(prev);
        next.delete(epId);
        return next;
      });
    } else {
      activeEpisodeCountsRef.current[epId] = current;
    }
  }, []);

  // Detailed live statistics & console logs per episode for rich UI parity with Studio
  const [runnerLiveStats, setRunnerLiveStats] = useState({
    translate: {},
    compact: {},
    demucs: {},
    tts: {},
    autofit: {},
  });

  // Abort controllers per step for clean instantaneous stop
  const abortControllersRef = useRef({
    translate: null,
    compact: null,
    repair: null,
    voice: null,
    clean_bgm: null,
    autofit: null,
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
   * 1. Translate a Single Episode (delegates to singleEpisodeRunners.js)
   */
  const runSingleTranslate = useCallback(
    (ep, options = {}, signal = null) =>
      runSingleTranslateExec(ep, options, signal, {
        activeSeries,
        updateRunnerState,
        setRunnerLiveStats,
        markEpisodeActive,
        markEpisodeInactive,
      }),
    [activeSeries, updateRunnerState, markEpisodeActive, markEpisodeInactive]
  );

  /**
   * 1b. Repair Broken Text for a Single Episode (delegates to singleEpisodeRunners.js)
   */
  const runSingleTextRepair = useCallback(
    (ep, options = {}, signal = null) =>
      runSingleTextRepairExec(ep, options, signal, { activeSeries, updateRunnerState }),
    [activeSeries, updateRunnerState]
  );

  /**
   * 1c. Auto Compact Script for a Single Episode (delegates to singleEpisodeRunners.js)
   */
  const runSingleAutoCompact = useCallback(
    (ep, options = {}, signal = null) =>
      runSingleAutoCompactExec(ep, options, signal, {
        activeSeries,
        updateRunnerState,
        setRunnerLiveStats,
        markEpisodeActive,
        markEpisodeInactive,
      }),
    [activeSeries, updateRunnerState, markEpisodeActive, markEpisodeInactive]
  );

  /**
   * 2. Generate Khmer AI Voice (TTS) for a Single Episode (delegates to singleEpisodeRunners.js)
   */
  const runSingleVoice = useCallback(async (ep, options = {}, signal = null) => {
    return runSingleVoiceExec(ep, options, signal, {
      activeSeries,
      refreshSeries,
      onInvalidateRenderedPreviewRef,
      updateRunnerState,
      setRunnerLiveStats,
      markEpisodeActive,
      markEpisodeInactive,
    });
  }, [activeSeries, refreshSeries, onInvalidateRenderedPreview, updateRunnerState, markEpisodeActive, markEpisodeInactive]);

  /**
   * 3. Clean BGM (Demucs / FFmpeg Fast) for a Single Episode (delegates to singleEpisodeRunners.js)
   */
  const runSingleCleanBgm = useCallback(
    (ep, options = {}, signal = null) =>
      runSingleCleanBgmExec(ep, options, signal, {
        activeSeries,
        updateRunnerState,
        setRunnerLiveStats,
        markEpisodeActive,
        markEpisodeInactive,
      }),
    [activeSeries, updateRunnerState, markEpisodeActive, markEpisodeInactive]
  );

  /**
   * 4. Run all 3 steps for 1 single episode
   * Resource-aware Smart Pipeline:
   * - Clean BGM (Demucs) depends only on video; starts in parallel or queues safely.
   * - Script (Fast OCR / Translation) runs.
   * - Voice (TTS) waits for Script completion (strict dependency contract).
   * - Awaits Clean BGM before marking episode complete.
   */
  const runSingleEpisodeAll3 = useCallback(async (ep, options = {}, signal = null) => {
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

    const norm = normalizeDubbingOptions(ep, 'all3', options, { activeSeries });
    const seriesId = norm.seriesId;
    const hasDemucs = checkEpisodeHasDemucsReady(ep, null, null);
    let bgmPromise = null;

    markEpisodeActive(ep.id);
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
      bgmPromise = runSingleCleanBgm(ep, options, signal).catch((bgmErr) => ({
        success: false,
        error: bgmErr?.message || 'Clean BGM separation failed',
      }));
    } else {
      stepsStatus.clean_bgm = { status: options.skipCleanBgm ? 'skipped' : 'completed' };
    }

    // 2. Step 1: Script Khmer (Chinese Subtitle OCR -> Khmer Translation)
    if (signal?.aborted) {
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
      scriptRes = await runSingleTranslate(ep, options, signal);
    } catch (sErr) {
      if (signal?.aborted) {
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

    if (signal?.aborted) {
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
    if (typeof refreshSeries === 'function') await refreshSeries();

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
    if (signal?.aborted) {
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
      voiceRes = await runSingleVoice(freshEp, options, signal);
    } catch (vErr) {
      if (signal?.aborted) {
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

    if (signal?.aborted) {
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
    if (typeof refreshSeries === 'function') await refreshSeries();

    // 4. Step 3: Await Clean BGM if running in background
    if (signal?.aborted) {
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
      if (signal?.aborted) {
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
        directBgmRes = await runSingleCleanBgm(freshEp, options, signal);
      } catch (bErr) {
        if (signal?.aborted) {
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

      if (signal?.aborted) {
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

    if (typeof refreshSeries === 'function') await refreshSeries();

      return {
        ...createStepResult({ status: STEP_STATUS.COMPLETED }),
        failedStep: null,
        steps: stepsStatus,
      };
    } finally {
      markEpisodeInactive(ep.id);
      updateRunnerState('all3', (prev) => (prev.currentEpId === ep.id ? { ...prev, status: 'idle' } : prev));
    }
  }, [runSingleTranslate, runSingleVoice, runSingleCleanBgm, refreshSeries, activeSeries, markEpisodeActive, markEpisodeInactive, updateRunnerState]);


  /**
   * 4B. Auto-Fit Speech Speed for a Single Episode (delegates to singleEpisodeRunners.js)
   */
  const runSingleAutoFitSpeed = useCallback(
    (ep, options = {}, signal = null) =>
      runSingleAutoFitSpeedExec(ep, options, signal, {
        activeSeries,
        refreshSeries,
        updateRunnerState,
        setRunnerLiveStats,
        markEpisodeActive,
        markEpisodeInactive,
      }),
    [activeSeries?.id, refreshSeries, markEpisodeActive, markEpisodeInactive, updateRunnerState]
  );

  /**
   * 5. Strict 1-by-1 Sequential Queue Runner (EP1 ➔ EP2 ➔ ... ➔ EPN)
   * Awaits 100% completion of episode N before triggering episode N+1.
   */
  const runSequentialStep = useCallback(async (stepType, episodesList = [], options = {}) => {
    const allEpisodes = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes : [];

    // Smart Auto-Targeting: If episodesList is empty, auto-target episodes needing this step
    let queue = Array.isArray(episodesList) && episodesList.length > 0 ? [...episodesList] : [];
    if (stepType === 'repair') {
      const candidates = queue.length > 0 ? queue : allEpisodes;
      queue = candidates.filter((ep) => {
        const scan = getEpisodeBrokenSummary(ep);
        return (scan?.textBrokenCount > 0 || scan?.totalBrokenCount > 0 || ep.status === 'failed');
      });
      if (queue.length === 0) {
        updateRunnerState('repair', { message: '✅ គ្រប់ភាគទាំងអស់មានអត្ថបទត្រឹមត្រូវ (គ្មានឃ្លាខូចទេ)' });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0 });
      }
    } else if (stepType === 'autofit') {
      const candidates = queue.length > 0 ? queue : allEpisodes;
      let unfitted = candidates.filter((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null) && !checkEpisodeHasAutoFitReady(ep));

      // If the passed selection is already all fitted, fall back to any remaining unfitted episodes in allEpisodes!
      if (unfitted.length === 0 && !options.force) {
        unfitted = allEpisodes.filter((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null) && !checkEpisodeHasAutoFitReady(ep));
      }

      queue = options.force
        ? candidates.filter((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null))
        : unfitted;

      if (queue.length === 0) {
        const remainingUnfitted = allEpisodes.filter((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null) && !checkEpisodeHasAutoFitReady(ep));
        if (remainingUnfitted.length > 0 && !options.force) {
          queue = remainingUnfitted;
        } else {
          const voiced = (queue.length > 0 ? queue : allEpisodes).filter((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null));
          if (voiced.length > 0) {
            queue = voiced;
          } else {
            updateRunnerState('autofit', { message: 'មិនទាន់មានភាគដែលមានសំឡេងសម្រាប់ Auto-Fit ទេ' });
            return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0 });
          }
        }
      }
    } else if (stepType === 'compact') {
      const candidates = queue.length > 0 ? queue : allEpisodes;
      queue = candidates.filter((ep) => checkEpisodeHasScript(ep));
      if (queue.length === 0) {
        updateRunnerState('compact', { message: 'មិនទាន់មានភាគដែលមាន Script សម្រាប់បម្លែងទេ' });
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0 });
      }
    } else if (options.force) {
      if (queue.length === 0) {
        queue = (stepType === 'voice')
          ? allEpisodes.filter((ep) => checkEpisodeHasScript(ep))
          : allEpisodes;
      }
    } else if (queue.length === 0) {
      if (stepType === 'translate') {
        queue = allEpisodes.filter((ep) => !checkEpisodeHasScript(ep));
      } else if (stepType === 'voice') {
        queue = allEpisodes.filter((ep) => checkEpisodeHasScript(ep) && (!checkEpisodeHasAudioReady(ep, null, null) || ep.audioOutdated));
      } else if (stepType === 'clean_bgm') {
        queue = allEpisodes.filter((ep) => !checkEpisodeHasDemucsReady(ep, null, null));
      } else if (stepType === 'all3') {
        queue = allEpisodes.filter((ep) => !checkEpisodeHasScript(ep) || !checkEpisodeHasAudioReady(ep, null, null) || !checkEpisodeHasDemucsReady(ep, null, null));
      }
    }

    if (queue.length === 0) {
      updateRunnerState(stepType, { message: 'គ្រប់ភាគទាំងអស់រួចរាល់ហើយ' });
      return createStepResult({ status: STEP_STATUS.COMPLETED, count: 0 });
    }

    // Set up AbortController for clean cancellation
    const controller = new AbortController();
    abortControllersRef.current[stepType] = controller;

    updateRunnerState(stepType, {
      status: 'running',
      currentEpIndex: 1,
      totalEps: queue.length,
      currentEpId: queue[0]?.id || null,
      queuedEpIds: queue.map((e) => e.id),
      progress: 0,
      message: `ចាប់ផ្តើមរត់ 1-by-1 លើ ${queue.length} ភាគ...`,
    });

    try {
      let lastStepResult = null;
      for (let idx = 0; idx < queue.length; idx++) {
        if (controller.signal.aborted) {
          console.log(`[1-by-1 Runner] 🛑 បញ្ឈប់ដំណើរការ ${stepType} ដោយអ្នកប្រើប្រាស់`);
          break;
        }
        const currentEp = queue[idx];

        markEpisodeActive(currentEp.id);
        updateRunnerState(stepType, {
          status: 'running',
          currentEpIndex: idx + 1,
          totalEps: queue.length,
          currentEpId: currentEp.id,
          queuedEpIds: queue.map((e) => e.id),
          message: `កំពុងរត់ EP${currentEp.episodeNumber || currentEp.id} (${idx + 1}/${queue.length})...`,
        });

        console.log(`%c[1-by-1 Runner] 🚀 [EP${currentEp.episodeNumber || currentEp.id}] ចាប់ផ្ដើម ${stepType.toUpperCase()} (${idx + 1}/${queue.length})...`, 'color: #38bdf8; font-weight: bold;');

        // Await 100% completion of single episode step before proceeding to next!
        // Retries up to 2 times with backoff on transient backend restart / 502 / ECONNRESET errors.
        let stepResult = null;
        const maxTransientRetries = 2;
        for (let attempt = 0; attempt <= maxTransientRetries; attempt++) {
          try {
            if (stepType === 'translate') {
              stepResult = await runSingleTranslate(currentEp, options, controller.signal);
            } else if (stepType === 'repair') {
              stepResult = await runSingleTextRepair(currentEp, options, controller.signal);
            } else if (stepType === 'voice') {
              stepResult = await runSingleVoice(currentEp, options, controller.signal);
            } else if (stepType === 'clean_bgm') {
              stepResult = await runSingleCleanBgm(currentEp, options, controller.signal);
            } else if (stepType === 'compact') {
              stepResult = await runSingleAutoCompact(currentEp, options, controller.signal);
            } else if (stepType === 'autofit') {
              stepResult = await runSingleAutoFitSpeed(currentEp, options, controller.signal);
            } else if (stepType === 'all3') {
              stepResult = await runSingleEpisodeAll3(currentEp, options, controller.signal);
            }
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

        markEpisodeInactive(currentEp.id);

        if (typeof refreshSeries === 'function') {
          await refreshSeries();
        }
      }

      if (controller.signal.aborted || lastStepResult?.aborted || lastStepResult?.status === STEP_STATUS.CANCELLED || lastStepResult?.status === 'cancelled') {
        updateRunnerState(stepType, { status: 'idle', message: 'បានបញ្ឈប់ដោយអ្នកប្រើប្រាស់' });
        return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
      }

      console.log(`%c[1-by-1 Runner] 🎉 ជោគជ័យ 100% លើគ្រប់ទាំង ${queue.length} ភាគសម្រាប់ ${stepType.toUpperCase()}!`, 'color: #34d399; font-weight: bold;');

      updateRunnerState(stepType, {
        status: 'idle',
        currentEpId: null,
        currentEpIndex: 0,
        totalEps: 0,
        progress: 100,
        message: 'រួចរាល់ 100%!',
      });

      return createStepResult({ status: STEP_STATUS.COMPLETED, count: queue.length });
    } catch (err) {
      if (controller.signal.aborted) {
        updateRunnerState(stepType, { status: 'idle', message: 'បានបញ្ឈប់ដោយអ្នកប្រើប្រាស់' });
        return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
      }
      const errMessage = err?.message || 'ជួបបញ្ហាពេលដំណើរការ';
      console.warn(`[1-by-1 Runner] ⚠️ ${stepType.toUpperCase()} stopped with error:`, errMessage);
      updateRunnerState(stepType, { status: 'failed', message: errMessage });
      return createStepResult({ status: STEP_STATUS.FAILED, error: errMessage });
    } finally {
      abortControllersRef.current[stepType] = null;
      queue.forEach((ep) => markEpisodeInactive(ep.id));
    }
  }, [activeSeries?.episodes, updateRunnerState, runSingleTranslate, runSingleTextRepair, runSingleVoice, runSingleCleanBgm, runSingleAutoFitSpeed, runSingleEpisodeAll3, refreshSeries, markEpisodeActive, markEpisodeInactive]);

  /**
   * Stop an active sequential runner cleanly (Guarantees both UI loop & Backend processes are terminated)
   */
  const stopStep = useCallback(async (stepType) => {
    // 1. Abort in-flight client fetch signal
    if (abortControllersRef.current[stepType]) {
      try { abortControllersRef.current[stepType].abort(); } catch (_) {}
      abortControllersRef.current[stepType] = null;
    }

    const currentEpId = runnerStates[stepType]?.currentEpId;
    const targetSeriesId = activeSeries?.id || 'drama_project';
    const allEpisodes = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes : [];
    const activeEp = allEpisodes.find((e) => e.id === currentEpId);
    const videoRef = activeEp?.videoPath || activeEp?.sourceVideoPath || activeEp?.videoFile || '';

    let stopFailed = false;
    let stopErrorMessage = '';

    // 2. Transmit scoped kill command to backend worker processes immediately
    try {
      if (stepType === 'clean_bgm' || stepType === 'all3') {
        const killSepRes = await killSeparationApi({ videoPath: videoRef, jobId: currentEpId || 'all' }).catch((err) => ({ success: false, error: err.message }));
        if (killSepRes && killSepRes.success === false) {
          console.warn('[DubbingRunner] Demucs kill returned error:', killSepRes.error);
          stopFailed = true;
          stopErrorMessage = killSepRes.error || 'បរាជ័យក្នុងការបញ្ឈប់ Demucs';
        }
      }
      if (stepType === 'translate' || stepType === 'repair' || stepType === 'all3') {
        const res = await fetch('/api/jobs/kill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seriesId: targetSeriesId,
            episodeId: currentEpId || undefined,
            all: !currentEpId,
          }),
        });
        if (!res.ok) {
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

    if (stopFailed) {
      updateRunnerState(stepType, {
        status: 'error',
        currentEpId,
        message: `⚠️ ការបញ្ឈប់បរាជ័យ: ${stopErrorMessage}`,
        error: stopErrorMessage,
      });
    } else {
      updateRunnerState(stepType, {
        status: 'idle',
        currentEpId: null,
        message: '🛑 បានបញ្ឈប់ (Stopped UI & Backend)',
      });
    }
  }, [activeSeries, runnerStates, updateRunnerState]);

  const value = {
    runnerStates,
    activeEpisodeIds,
    markEpisodeActive,
    markEpisodeInactive,
    runnerLiveStats,
    runSingleTranslate,
    runSingleAutoCompact,
    runSingleTextRepair,
    runSingleVoice,
    runSingleCleanBgm,
    runSingleAutoFitSpeed,
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
