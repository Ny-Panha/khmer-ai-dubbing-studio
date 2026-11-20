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
  autoFitSpeechSpeedApi,
  resetEpisodeStateApi,
} from '../../services/api';
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

const DubbingRunnerContext = createContext(null);

export function DubbingRunnerProvider({ children, activeSeries, refreshSeries, onInvalidateRenderedPreview }) {
  const onInvalidateRenderedPreviewRef = useRef(onInvalidateRenderedPreview);
  onInvalidateRenderedPreviewRef.current = onInvalidateRenderedPreview;

  // Global runners state per step: 'translate' | 'repair' | 'voice' | 'clean_bgm' | 'autofit' | 'all3'
  const [runnerStates, setRunnerStates] = useState({
    translate: { status: 'idle', currentEpId: null, currentEpIndex: 0, totalEps: 0, progress: 0, message: '' },
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
    demucs: {},
    tts: {},
    autofit: {},
  });

  // Abort controllers per step for clean instantaneous stop
  const abortControllersRef = useRef({
    translate: null,
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
   * 1. Translate a Single Episode (Awaits 100% completion before resolving)
   * Skips immediately if episode already has script and options.force is not set (NO repair, NO TTS here).
   */
  const runSingleTranslate = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return createStepResult({ status: STEP_STATUS.FAILED, error: 'No episode provided' });
    const norm = normalizeDubbingOptions(ep, 'translate', options, { activeSeries });
    const seriesId = norm.seriesId;
    const videoRef = norm.videoPath;
    const videoId = norm.videoId;

    const hasScript = checkEpisodeHasScript(ep);

    // If episode already has script and not forcing: skip immediately (Pure translate, no repair / no TTS)
    if (hasScript && !norm.force) {
      return createStepResult({ status: STEP_STATUS.SKIPPED, reason: 'already_has_script' });
    }

    markEpisodeActive(ep.id);
    updateRunnerState('translate', {
      status: 'running',
      currentEpId: ep.id,
      message: `[EP${ep.episodeNumber || ep.id}] កំពុង Translate Script...`,
    });

    try {
      if (norm.force) {
        try {
          await resetEpisodeStateApi({ seriesId, episodeId: ep.id, resetType: 'script' });
        } catch (rErr) {
          console.warn(`[DubbingRunner] Reset script notice for ${ep.id}:`, rErr.message);
        }
      }

      const jobRes = await startGenerationJob({
      videoId,
      videoPath: videoRef,
      seriesId,
      episodeId: ep.id,
      pipelineMode: norm.pipelineMode,
      generationMode: norm.generationMode,
      dubbingMode: norm.dubbingMode,
      recapStyle: norm.recapStyle,
      genre: norm.genre,
      narratorGender: norm.narratorGender,
      customPrompt: norm.customPrompt,
      seriesGlossary: norm.seriesGlossary,
      force: norm.force,
      confirmed: norm.confirmed,
    });

    const jobId = jobRes?.jobId || jobRes?.id;
    if (!jobId) {
      throw new Error(jobRes?.error || 'Failed to start translation job');
    }

    setRunnerLiveStats((prev) => ({
      ...prev,
      translate: {
        ...prev.translate,
        [ep.id]: {
          percent: 5,
          stageMessage: 'ចាប់ផ្ដើមបកប្រែ Script (Gemini AI)...',
          message: 'ចាប់ផ្ដើមបកប្រែ Script (Gemini AI)...',
          logs: [
            {
              time: new Date().toLocaleTimeString(),
              progress: 5,
              message: `📝 ចាប់ផ្ដើមវិភាគវីដេអូ & បកប្រែ Script [EP${ep.episodeNumber || ep.id}]...`,
            },
          ],
          isDone: false,
          isFailed: false,
        },
      },
    }));

    // Poll until 100% completed on disk
    let lastLoggedProgress = -1;
    while (!signal?.aborted) {
      await new Promise((r) => setTimeout(r, 1500));
      if (signal?.aborted) {
        await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(() => {});
        throw new Error('Translation aborted by user');
      }
      const st = await getJobStatus(jobId, { seriesId, episodeId: ep.id, signal }).catch(() => null);
      const curStatus = st?.status || st?.job?.status;
      const progress = Number(st?.progress || st?.job?.progress || 0);
      const stageMsg = st?.stageMessage || st?.job?.stageMessage || '';
      const rawLogs = st?.logs || st?.job?.logs || [];

      updateRunnerState('translate', { progress, message: stageMsg });

      setRunnerLiveStats((prev) => {
        const prevLogs = prev.translate?.[ep.id]?.logs || [];
        let mergedLogs = [...prevLogs];
        if (Array.isArray(rawLogs) && rawLogs.length > 0) {
          mergedLogs = rawLogs;
        } else if (progress !== lastLoggedProgress && stageMsg) {
          mergedLogs.push({
            time: new Date().toLocaleTimeString(),
            progress,
            message: stageMsg,
          });
        }
        return {
          ...prev,
          translate: {
            ...prev.translate,
            [ep.id]: {
              percent: progress,
              stageMessage: stageMsg || `Gemini Translation: ${progress}%`,
              message: stageMsg || `Gemini Translation: ${progress}%`,
              logs: mergedLogs,
              isDone: curStatus === 'completed',
              isFailed: curStatus === 'failed',
            },
          },
        };
      });

      if (progress !== lastLoggedProgress) {
        lastLoggedProgress = progress;
        console.log(`[Translate 📝] EP${ep.episodeNumber || ep.id}: ${progress}% - ${stageMsg || 'កំពុងដំណើរការ...'}`);
      }

      if (curStatus === 'completed') {
        console.log(`[Translate 📝] ✅ EP${ep.episodeNumber || ep.id}: 100% រួចរាល់!`);
        setRunnerLiveStats((prev) => ({
          ...prev,
          translate: {
            ...prev.translate,
            [ep.id]: {
              ...(prev.translate?.[ep.id] || {}),
              percent: 100,
              isDone: true,
              stageMessage: 'បកប្រែ Script រួចរាល់ 100%',
              message: 'បកប្រែ Script រួចរាល់ 100%',
            },
          },
        }));
        return createStepResult({ status: STEP_STATUS.COMPLETED, jobId, data: st });
      }
      if (curStatus === 'failed') {
        console.error(`[Translate 📝] ❌ EP${ep.episodeNumber || ep.id} បរាជ័យ:`, st?.error || st?.job?.error);
        setRunnerLiveStats((prev) => ({
          ...prev,
          translate: {
            ...prev.translate,
            [ep.id]: {
              ...(prev.translate?.[ep.id] || {}),
              isFailed: true,
              stageMessage: `បរាជ័យ: ${st?.error || st?.job?.error || 'Translation failed'}`,
              message: `បរាជ័យ: ${st?.error || st?.job?.error || 'Translation failed'}`,
            },
          },
        }));
        throw new Error(st?.error || st?.job?.error || 'Translation failed');
      }
    }

    return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
  } finally {
    markEpisodeInactive(ep.id);
    updateRunnerState('translate', (prev) => (prev.currentEpId === ep.id ? { ...prev, status: 'idle' } : prev));
  }
}, [activeSeries, updateRunnerState, markEpisodeActive, markEpisodeInactive]);

  /**
   * 1b. Repair Broken Text for a Single Episode (Text only, NO voice/TTS generation)
   */
  const runSingleTextRepair = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return createStepResult({ status: STEP_STATUS.FAILED, error: 'No episode provided' });
    const norm = normalizeDubbingOptions(ep, 'repair', options, { activeSeries });
    const seriesId = norm.seriesId;
    const brokenScan = getEpisodeBrokenSummary(ep);
    const textBrokenCount = brokenScan?.textBrokenCount || 0;

    if (textBrokenCount === 0) {
      return createStepResult({ status: STEP_STATUS.SKIPPED, reason: 'no_broken_text' });
    }

    updateRunnerState('repair', { message: `[EP${ep.episodeNumber || ep.id}] ជួសជុលឃ្លាអក្សរខូច (${textBrokenCount} ឃ្លា)...` });

    const res = await startRepairBrokenJobApi({
      seriesId,
      targetEpisodeIds: [ep.id],
      modelName: options.modelName || 'gemini-3.8-flash',
      repairText: true,
      repairVoice: false,
      skipTts: true,
    });

    if (res?.jobId || res?.jobIds?.[0]) {
      const jId = res.jobId || res.jobIds[0];
      let lastLoggedRepair = -1;
      while (!signal?.aborted) {
        await new Promise((r) => setTimeout(r, 1500));
        if (signal?.aborted) break;
        const statusRes = await getJobStatus(jId, { seriesId, episodeId: ep.id, signal }).catch(() => null);
        const curStatus = statusRes?.status || statusRes?.job?.status;
        const pct = Number(statusRes?.progress || statusRes?.job?.progress || 0);

        if (pct !== lastLoggedRepair) {
          lastLoggedRepair = pct;
          console.log(`[Repair 🔧] EP${ep.episodeNumber || ep.id}: ${pct}% - ${statusRes?.stageMessage || 'កំពុងជួសជុល...'}`);
        }

        if (curStatus === 'completed') {
          console.log(`[Repair 🔧] ✅ EP${ep.episodeNumber || ep.id}: 100% ជួសជុលរួចរាល់!`);
          break;
        }
        if (curStatus === 'failed') {
          console.error(`[Repair 🔧] ❌ EP${ep.episodeNumber || ep.id} ជួសជុលបរាជ័យ:`, statusRes?.error);
          throw new Error(statusRes?.error || 'Text repair failed');
        }
      }
    }
    return createStepResult({ status: STEP_STATUS.COMPLETED, count: textBrokenCount });
  }, [activeSeries, updateRunnerState]);

  /**
   * 2. AI Khmer Voice TTS for a Single Episode (Awaits 100% completion before resolving)
   */
  const runSingleVoice = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return createStepResult({ status: STEP_STATUS.FAILED, error: 'No episode provided' });
    const norm = normalizeDubbingOptions(ep, 'voice', options, { activeSeries });
    const seriesId = norm.seriesId;
    const videoId = norm.videoId;

    let segments = ep.scriptData?.segments || [];
    // If segments are empty, attempt to hydrate fresh episode if scriptData exists on server
    if ((!Array.isArray(segments) || segments.length === 0) && checkEpisodeHasScript(ep)) {
      try {
        const epRes = await fetch(`/api/series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(ep.id)}`);
        if (epRes.ok) {
          const epData = await epRes.json();
          if (Array.isArray(epData?.episode?.scriptData?.segments) && epData.episode.scriptData.segments.length > 0) {
            segments = epData.episode.scriptData.segments;
            ep = epData.episode;
          }
        }
      } catch (_) {}
    }

    if (!Array.isArray(segments) || segments.length === 0) {
      return createStepResult({ status: STEP_STATUS.SKIPPED, reason: 'no_segments' });
    }

    const hasUnresolvedSpokenSegments = segments.some((s) => {
      const isSpoken = s && (s.isSpoken !== false) && Boolean(s.khmer || s.khmerText || s.khmerTranslatedText || s.text);
      if (!isSpoken) return false;
      const statusLower = String(s.ttsStatus || s.status || '').toLowerCase();
      return (
        s.audioOutdated === true ||
        statusLower === 'outdated' ||
        statusLower === 'error' ||
        statusLower === 'failed' ||
        (!s.audioUrl && !s.audioFile && !s.audioPath)
      );
    });

    const hasAudio = checkEpisodeHasAudioReady(ep, null, null);
    if (hasAudio && !ep.audioOutdated && !hasUnresolvedSpokenSegments && !norm.force) {
      return createStepResult({ status: STEP_STATUS.SKIPPED, reason: 'already_has_audio' });
    }

    markEpisodeActive(ep.id);
    updateRunnerState('voice', {
      status: 'running',
      currentEpId: ep.id,
      message: `[EP${ep.episodeNumber || ep.id}] បង្កើតសំឡេងខ្មែរ AI (${segments.length} ឃ្លា)...`,
    });

    let pollTimer = null;
    try {
      if (norm.force) {
        try {
          await resetEpisodeStateApi({ seriesId, episodeId: ep.id, resetType: 'voice' });
        } catch (rErr) {
          console.warn(`[DubbingRunner] Reset voice notice for ${ep.id}:`, rErr.message);
        }
      }

    setRunnerLiveStats((prev) => ({
      ...prev,
      tts: {
        ...prev.tts,
        [ep.id]: {
          percent: 15,
          logs: [
            {
              time: new Date().toLocaleTimeString(),
              progress: 15,
              message: `🎙️ ចាប់ផ្ដើមបង្កើតសំឡេងខ្មែរ AI (${segments.length} ឃ្លា)...`,
            },
          ],
          message: 'កំពុងបង្កើតសំឡេងខ្មែរ AI...',
          isDone: false,
          isFailed: false,
        },
      },
    }));

    const speakerMap = norm.speakerMap;
    const voiceId = norm.voiceId;
    const speed = norm.speed;

    console.log(`[Voice 🎙️] EP${ep.episodeNumber || ep.id}: កំពុងបង្កើតសំឡេង AI (${segments.length} ឃ្លា)...`);

    let lastReportedCurrent = 0;
    pollTimer = setInterval(async () => {
      try {
        const pRes = await fetch(`/api/tts/progress?seriesId=${seriesId}&episodeId=${ep.id}&total=${segments.length}`);
        const pData = await pRes.json();
        if (pData?.success) {
          const cur = pData.current || 0;
          const tot = pData.total || segments.length;
          const pct = tot > 0 ? Math.min(95, Math.max(10, Math.round((cur / tot) * 100))) : 15;
          updateRunnerState('voice', { progress: pct, message: `[EP${ep.episodeNumber || ep.id}] សំយោគ ${cur}/${tot} ឃ្លា (${pct}%)...` });
          setRunnerLiveStats((prev) => {
            const prevStats = prev.tts?.[ep.id] || { logs: [] };
            const currentLogs = [...(prevStats.logs || [])];
            if (cur > lastReportedCurrent) {
              lastReportedCurrent = cur;
              currentLogs.push({
                time: new Date().toLocaleTimeString(),
                progress: pct,
                message: `🎙️ សំយោគសំឡេង: ${cur}/${tot} ឃ្លា (${pct}%)`,
              });
            }
            return {
              ...prev,
              tts: {
                ...prev.tts,
                [ep.id]: {
                  current: cur,
                  total: tot,
                  percent: pct,
                  message: `កំពុងសំយោគ ${cur}/${tot} ឃ្លា (${pct}%)...`,
                  logs: currentLogs,
                  isDone: false,
                  isFailed: false,
                },
              },
            };
          });
        }
      } catch (_) {}
    }, 1200);

    let ttsRes;
    try {
      ttsRes = await generateAudioApi({
        segments,
        voiceId,
        speed,
        seriesId,
        episodeId: ep.id,
        videoId,
        speakerMap,
        forceRegen: norm.forceRegen,
        signal,
      });
    } finally {
      if (pollTimer) clearInterval(pollTimer);
    }

    if (!ttsRes?.success) {
      setRunnerLiveStats((prev) => ({
        ...prev,
        tts: {
          ...prev.tts,
          [ep.id]: {
            ...(prev.tts[ep.id] || {}),
            isFailed: true,
            isDone: false,
            message: `❌ បរាជ័យ: ${ttsRes?.error || 'TTS Generation failed'}`,
          },
        },
      }));
      console.error(`[Voice 🎙️] ❌ EP${ep.episodeNumber || ep.id} បរាជ័យ:`, ttsRes?.error);
      throw new Error(ttsRes?.error || 'TTS Generation failed');
    }

    // Sync timeline audio tracks with returned updated segments (persists successful clips even on partial fail)
    const finalSegments = Array.isArray(ttsRes?.segments) && ttsRes.segments.length > 0
      ? ttsRes.segments
      : segments;
    try {
      if (typeof syncTimelineAudioApi === 'function') {
        await syncTimelineAudioApi(finalSegments, ep.title || `EP${ep.episodeNumber || ep.id}`, videoId, ep.id, seriesId);
      }
    } catch (_) {}

    if (typeof refreshSeries === 'function') {
      try {
        await refreshSeries();
      } catch (_) {}
    }

    const failedCount = Number(ttsRes?.failedCount || 0);
    if (!ttsRes?.alreadyCompleted || failedCount > 0) {
      const invFn = onInvalidateRenderedPreviewRef.current || onInvalidateRenderedPreview;
      if (typeof invFn === 'function') {
        try {
          invFn(ep.id);
        } catch (_) {}
      }
    }
    if (failedCount > 0) {
      const partialPct = segments.length > 0
        ? Math.round(((segments.length - failedCount) / segments.length) * 100)
        : 0;
      setRunnerLiveStats((prev) => ({
        ...prev,
        tts: {
          ...prev.tts,
          [ep.id]: {
            ...(prev.tts[ep.id] || {}),
            percent: partialPct,
            isFailed: true,
            isDone: false,
            message: `⚠️ បង្កើតសំឡេងមាន ${failedCount} ឃ្លាបរាជ័យ (រក្សាទុក audioOutdated = true)`,
            logs: [
              ...(prev.tts[ep.id]?.logs || []),
              {
                time: new Date().toLocaleTimeString(),
                progress: partialPct,
                message: `⚠️ បង្កើតសំឡេងមាន ${failedCount} ឃ្លាមិនទាន់ជោគជ័យ សូម Re-TTS ឃ្លាដែលនៅសល់`,
              },
            ],
          },
        },
      }));
      return createStepResult({
        status: STEP_STATUS.FAILED,
        error: `${failedCount} segments failed TTS synthesis`,
        data: ttsRes,
      });
    }

    setRunnerLiveStats((prev) => ({
      ...prev,
      tts: {
        ...prev.tts,
        [ep.id]: {
          ...(prev.tts[ep.id] || {}),
          percent: 100,
          isDone: true,
          isFailed: false,
          message: '✅ សំឡេងខ្មែរ AI រួចរាល់ 100%!',
          logs: [
            ...(prev.tts[ep.id]?.logs || []),
            {
              time: new Date().toLocaleTimeString(),
              progress: 100,
              message: `✅ បង្កើតសំឡេង ${segments.length} ឃ្លារួចរាល់ 100%!`,
            },
          ],
        },
      },
    }));

    console.log(`[Voice 🎙️] ✅ EP${ep.episodeNumber || ep.id}: 100% បង្កើតសំឡេងរួចរាល់!`);

      return createStepResult({ status: STEP_STATUS.COMPLETED, data: ttsRes, count: segments.length });
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      markEpisodeInactive(ep.id);
      updateRunnerState('voice', (prev) => (prev.currentEpId === ep.id ? { ...prev, status: 'idle' } : prev));
    }
  }, [activeSeries, refreshSeries, onInvalidateRenderedPreview, updateRunnerState, markEpisodeActive, markEpisodeInactive]);

  /**
   * 3. AI Vocal Separation (Demucs Clean BGM) for a Single Episode
   */
  const runSingleCleanBgm = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return createStepResult({ status: STEP_STATUS.FAILED, error: 'No episode provided' });
    const norm = normalizeDubbingOptions(ep, 'clean_bgm', options, { activeSeries });
    const seriesId = norm.seriesId;
    const videoRef = norm.videoPath;

    if (!videoRef) {
      return createStepResult({ status: STEP_STATUS.SKIPPED, reason: 'no_video' });
    }

    const hasDemucs = checkEpisodeHasDemucsReady(ep, null, null);
    if (hasDemucs && !norm.force) {
      return createStepResult({ status: STEP_STATUS.SKIPPED, reason: 'already_has_demucs' });
    }

    markEpisodeActive(ep.id);
    updateRunnerState('clean_bgm', {
      status: 'running',
      currentEpId: ep.id,
      message: `[EP${ep.episodeNumber || ep.id}] កំពុងបិទសំឡេងចិន (Demucs Clean BGM)...`,
    });

    try {
      setRunnerLiveStats((prev) => ({
        ...prev,
      demucs: {
        ...prev.demucs,
        [ep.id]: {
          percent: 5,
          logs: [
            {
              time: new Date().toLocaleTimeString(),
              progress: 5,
              message: `🎧 [EP${ep.episodeNumber || ep.id}] ចាប់ផ្ដើមបំបែកសំឡេងដើម (Demucs AI Model: ${options.model || 'htdemucs'})...`,
            },
          ],
          message: 'AI Deep Learning Stem Separation...',
          model: options.model || 'htdemucs',
          isDone: false,
          isFailed: false,
        },
      },
    }));

    // 1. Start concurrent real-time polling every 1000ms while Demucs worker is in-flight
    let pollTimer = null;
    let lastLoggedDemucsPct = -1;

    const pollDemucs = async () => {
      try {
        const prog = await getSeparationProgressApi(videoRef, { signal }).catch(() => null);
        if (prog) {
          const pct = Math.min(100, Math.max(0, Number(prog.progress || prog.percent || 0)));
          if (pct > 0) {
            updateRunnerState('clean_bgm', {
              progress: pct,
              message: `[EP${ep.episodeNumber || ep.id}] កំពុងបិទសំឡេងចិន (Demucs ${pct}%)...`,
            });
          }

          setRunnerLiveStats((prev) => {
            const prevEp = prev.demucs?.[ep.id] || { logs: [] };
            let mergedLogs = [...(prevEp.logs || [])];

            if (Array.isArray(prog.logs) && prog.logs.length > 0) {
              const seen = new Set(mergedLogs.map((l) => `${l.progress}_${l.message}`));
              for (const sLog of prog.logs) {
                const key = `${sLog.progress}_${sLog.message}`;
                if (!seen.has(key)) {
                  mergedLogs.push(sLog);
                  seen.add(key);
                }
              }
            } else if (pct > (mergedLogs[mergedLogs.length - 1]?.progress || 0)) {
              mergedLogs.push({
                time: new Date().toLocaleTimeString(),
                progress: pct,
                message: prog.message || `⏳ Demucs Progress: ${pct}%`,
              });
            }

            const isDoneVerified = Boolean(
              prog.status === 'completed' ||
              (prog.isDone && prog.noVocalsUrl) ||
              (pct >= 100 && prog.noVocalsUrl)
            );

            return {
              ...prev,
              demucs: {
                ...prev.demucs,
                [ep.id]: {
                  percent: pct > 0 ? pct : (prevEp.percent || 5),
                  logs: mergedLogs.slice(-60),
                  message: prog.message || `Demucs Separation: ${pct}%`,
                  model: prog.model || options.model || 'htdemucs',
                  isDone: isDoneVerified,
                  isFailed: Boolean(prog.status === 'error' || prog.isFailed),
                },
              },
            };
          });

          if (pct !== lastLoggedDemucsPct && pct > 0) {
            lastLoggedDemucsPct = pct;
            console.log(`[Clean BGM 🔇] EP${ep.episodeNumber || ep.id}: ${pct}% - ${prog.message || 'កំពុងបំបែកសំឡេង Demucs...'}`);
          }
        }
      } catch (_) {}
    };

    pollDemucs();
    pollTimer = setInterval(pollDemucs, 1000);

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
    } finally {
      if (pollTimer) clearInterval(pollTimer);
    }

    // 2. If separateAudioApi returned without success (e.g. transient timeout), keep polling until completed
    if (!sepRes?.success || !sepRes?.noVocalsUrl) {
      let idleCount = 0;
      let hadProgress = false;
      while (!signal?.aborted) {
        await new Promise((r) => setTimeout(r, 1200));
        if (signal?.aborted) {
          await killSeparationApi({ videoPath: videoRef, jobId: videoRef }).catch(() => {});
          throw new Error('Demucs separation aborted by user');
        }

        const prog = await getSeparationProgressApi(videoRef, { signal }).catch(() => null);
        if (prog) {
          const pct = Math.min(100, Math.max(0, Number(prog.progress || prog.percent || 0)));
          if (pct > 0) hadProgress = true;
          updateRunnerState('clean_bgm', { progress: pct });

          const isFinished = Boolean(
            prog.status === 'completed' ||
            (prog.isDone && prog.noVocalsUrl) ||
            (pct >= 100 && prog.noVocalsUrl)
          );

          if (isFinished) {
            sepRes = { success: true, noVocalsUrl: prog.noVocalsUrl, noVocalsPath: prog.noVocalsPath };
            break;
          }
          if (prog.status === 'error' || prog.isFailed) {
            console.error(`[Clean BGM 🔇] ❌ EP${ep.episodeNumber || ep.id} បរាជ័យ:`, prog.error || prog.message);
            throw new Error(prog.error || prog.message || 'Demucs separation failed');
          }
          if (prog.status === 'idle') {
            idleCount++;
            if (hadProgress || idleCount >= 5) {
              console.warn(`[Clean BGM 🔇] Demucs process is idle/stopped for EP${ep.episodeNumber || ep.id}`);
              throw new Error('Demucs process ended unexpectedly');
            }
          } else {
            idleCount = 0;
          }
        } else {
          idleCount++;
          if (idleCount >= 6) {
            throw new Error('Demucs separation endpoint unreachable');
          }
        }
      }
    }

    // 3. Mark 100% completed
    console.log(`[Clean BGM 🔇] ✅ EP${ep.episodeNumber || ep.id}: 100% រួចរាល់!`);
    setRunnerLiveStats((prev) => ({
      ...prev,
      demucs: {
        ...prev.demucs,
        [ep.id]: {
          ...(prev.demucs?.[ep.id] || {}),
          percent: 100,
          isDone: true,
          isFailed: false,
          message: 'Clean BGM រួចរាល់ ១០០%',
          logs: [
            ...(prev.demucs?.[ep.id]?.logs || []),
            {
              time: new Date().toLocaleTimeString(),
              progress: 100,
              message: '🎉 [AudioSeparation] ✅ Clean BGM រួចរាល់ 100%!',
            },
          ],
        },
      },
    }));

      return createStepResult({ status: STEP_STATUS.COMPLETED, data: sepRes });
    } finally {
      markEpisodeInactive(ep.id);
      updateRunnerState('clean_bgm', (prev) => (prev.currentEpId === ep.id ? { ...prev, status: 'idle' } : prev));
    }
  }, [activeSeries, updateRunnerState, markEpisodeActive, markEpisodeInactive]);

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
   * 4B. Auto-Fit Speech Speed for a Single Episode (1.05x - 1.50x)
   * Speeds up any red/overflowing/trimmed segments so they fit subtitle slots without cutting off speech
   */
  const runSingleAutoFitSpeed = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return createStepResult({ status: STEP_STATUS.FAILED, error: 'No episode provided' });
    const seriesId = activeSeries?.id || ep.seriesId || 'drama_project';
    const epId = ep.id;

    // Guard: Verify episode has audio ready before attempting speed fitting
    const hasAudio = checkEpisodeHasAudioReady(ep, null, null);
    if (!hasAudio && !ep.audioGenerated && !ep.fullAudioUrl && !ep.hasAudio) {
      return createStepResult({
        status: STEP_STATUS.SKIPPED,
        reason: 'no_audio',
        error: 'មិនទាន់មានសំឡេងសម្រាប់ Auto-Fit ទេ សូមបង្កើតសំឡេង AI ជាមុនសិន',
      });
    }

    markEpisodeActive(epId);
    updateRunnerState('autofit', {
      status: 'running',
      currentEpId: epId,
      message: `[EP${ep.episodeNumber || epId}] កំពុងពន្លឿនសំឡេង...`,
    });

    try {
      if (signal?.aborted) return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });

      setRunnerLiveStats((prev) => ({
        ...prev,
        autofit: {
          ...prev.autofit,
          [epId]: {
            percent: 15,
            message: `⚡ [EP${ep.episodeNumber || epId}] ចាប់ផ្តើមវិភាគសំឡេង...`,
            logs: [{
              time: new Date().toLocaleTimeString(),
              message: `⚡ [EP${ep.episodeNumber || epId}] ចាប់ផ្តើមវិភាគសំឡេងដែលវែងលើស (Red / Trimmed segments)...`,
            }],
          },
        },
      }));

      const res = await autoFitSpeechSpeedApi({
        seriesId,
        episodeId: epId,
        maxSpeed: options.maxSpeed || 1.50,
      });

      if (res?.success) {
        setRunnerLiveStats((prev) => ({
          ...prev,
          autofit: {
            ...prev.autofit,
            [epId]: {
              percent: 100,
              isDone: true,
              isFailed: false,
              message: `✅ Auto-Fit រួចរាល់: បានពន្លឿន ${res.fittedCount || 0} ឃ្លា`,
              logs: Array.isArray(res.logs) && res.logs.length > 0 ? res.logs : [
                {
                  time: new Date().toLocaleTimeString(),
                  message: `✅ Auto-Fit Speed ជោគជ័យ: បានពន្លឿន ${res.fittedCount || 0} ឃ្លា ឱ្យ Fit ស្មើនឹង Subtitle ១០០%`,
                },
              ],
            },
          },
        }));

        if (Array.isArray(res?.segments) && typeof syncTimelineAudioApi === 'function') {
          try {
            await syncTimelineAudioApi(res.segments, ep.title || `EP${ep.episodeNumber || epId}`, ep.videoId, epId, seriesId);
          } catch (_) {}
        }

        if (typeof refreshSeries === 'function') {
          await refreshSeries();
        }
        return createStepResult({ status: STEP_STATUS.COMPLETED, count: res.fittedCount || 0, data: res });
      }

      setRunnerLiveStats((prev) => ({
        ...prev,
        autofit: {
          ...prev.autofit,
          [epId]: {
            percent: 100,
            isFailed: true,
            isDone: false,
            message: `❌ ${res?.error || 'Auto-fit speed failed'}`,
            logs: [
              { time: new Date().toLocaleTimeString(), message: `❌ ${res?.error || 'Auto-fit speed failed'}` },
            ],
          },
        },
      }));
      return createStepResult({ status: STEP_STATUS.FAILED, error: res?.error || 'Auto-fit speed failed' });
    } catch (err) {
      if (signal?.aborted) return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
      console.error(`[DubbingRunner] Auto-fit speed failed for EP ${epId}:`, err);
      setRunnerLiveStats((prev) => ({
        ...prev,
        autofit: {
          ...prev.autofit,
          [epId]: {
            percent: 100,
            isFailed: true,
            isDone: false,
            message: `❌ បរាជ័យ: ${err.message}`,
            logs: [
              { time: new Date().toLocaleTimeString(), message: `❌ Auto-Fit Error: ${err.message}` },
            ],
          },
        },
      }));
      return createStepResult({ status: STEP_STATUS.FAILED, error: err.message });
    } finally {
      markEpisodeInactive(epId);
      updateRunnerState('autofit', (prev) => (prev.currentEpId === epId ? { ...prev, status: 'idle' } : prev));
    }
  }, [activeSeries?.id, refreshSeries, markEpisodeActive, markEpisodeInactive, updateRunnerState]);

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
        let stepResult = null;
        if (stepType === 'translate') {
          stepResult = await runSingleTranslate(currentEp, options, controller.signal);
        } else if (stepType === 'repair') {
          stepResult = await runSingleTextRepair(currentEp, options, controller.signal);
        } else if (stepType === 'voice') {
          stepResult = await runSingleVoice(currentEp, options, controller.signal);
        } else if (stepType === 'clean_bgm') {
          stepResult = await runSingleCleanBgm(currentEp, options, controller.signal);
        } else if (stepType === 'autofit') {
          stepResult = await runSingleAutoFitSpeed(currentEp, options, controller.signal);
        } else if (stepType === 'all3') {
          stepResult = await runSingleEpisodeAll3(currentEp, options, controller.signal);
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
      updateRunnerState(stepType, { status: 'failed', message: err.message || 'ជួបបញ្ហាពេលដំណើរការ' });
      throw err;
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

    // 2. Transmit scoped kill command to backend worker processes immediately
    try {
      if (stepType === 'clean_bgm' || stepType === 'all3') {
        await killSeparationApi({ videoPath: videoRef, jobId: currentEpId || 'all' }).catch(() => {});
      }
      if (stepType === 'translate' || stepType === 'repair' || stepType === 'all3') {
        await fetch('/api/jobs/kill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seriesId: targetSeriesId,
            episodeId: currentEpId || undefined,
            all: !currentEpId,
          }),
        }).catch(() => {});
      }
    } catch (_) {}

    updateRunnerState(stepType, {
      status: 'idle',
      currentEpId: null,
      message: '🛑 បានបញ្ឈប់ (Stopped UI & Backend)',
    });
  }, [activeSeries, runnerStates, updateRunnerState]);

  const value = {
    runnerStates,
    activeEpisodeIds,
    markEpisodeActive,
    markEpisodeInactive,
    runnerLiveStats,
    runSingleTranslate,
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
