import {
  startGenerationJob,
  getJobStatus,
  generateAudioApi,
  syncTimelineAudioApi,
  startRepairBrokenJobApi,
  separateAudioApi,
  getSeparationProgressApi,
  getSeparationStatusApi,
  killSeparationApi,
  autoFitSpeechSpeedApi,
  resetEpisodeStateApi,
  retranslateAllSegmentsApi,
} from '../../services/api';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  getEpisodeBrokenSummary,
} from '../../components/dashboard/geminiRouteHelpers';
import {
  STEP_STATUS,
  normalizeDubbingOptions,
  createStepResult,
} from './dubbingExecutionAdapter';

/**
 * 1. Translate a Single Episode (Awaits 100% completion before resolving)
 * Skips immediately if episode already has script and options.force is not set (NO repair, NO TTS here).
 */
export async function runSingleTranslate(ep, options = {}, signal = null, ctx = {}) {
  const { activeSeries, updateRunnerState, setRunnerLiveStats, markEpisodeActive, markEpisodeInactive } = ctx;
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

    let jobRes;
    try {
      jobRes = await startGenerationJob({
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
    } catch (startErr) {
      const existingJobId = startErr.data?.existingJobId || startErr.data?.jobId;
      if (startErr.status === 409 && existingJobId && existingJobId !== 'episode_lock') {
        console.log(`[Translate 📝] Job already active (#${existingJobId}) for EP${ep.episodeNumber || ep.id}. Attaching to existing job...`);
        jobRes = { jobId: existingJobId, status: 'running' };
      } else {
        throw startErr;
      }
    }

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
      try {
        const cancelRes = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seriesId, episodeId: ep.id }),
        });
        if (!cancelRes.ok) {
          console.warn(`[DubbingRunner] Cancellation request for job ${jobId} returned HTTP ${cancelRes.status}`);
        }
      } catch (cancelErr) {
        console.error(`[DubbingRunner] Error cancelling job ${jobId}:`, cancelErr.message);
      }
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
    if (curStatus === 'failed' || curStatus === 'review_needed') {
      const isReview = curStatus === 'review_needed';
      const rawErr = st?.error || st?.job?.error || (isReview ? 'OCR requires review' : 'Translation failed');
      console.error(`[Translate 📝] ❌ EP${ep.episodeNumber || ep.id} ${isReview ? 'ត្រូវការផ្ទៀងផ្ទាត់ (Review Needed)' : 'បរាជ័យ'}:`, rawErr);
      setRunnerLiveStats((prev) => ({
        ...prev,
        translate: {
          ...prev.translate,
          [ep.id]: {
            ...(prev.translate?.[ep.id] || {}),
            isFailed: true,
            stageMessage: isReview ? `ត្រូវការផ្ទៀងផ្ទាត់: ${rawErr}` : `បរាជ័យ: ${rawErr}`,
            message: isReview ? `ត្រូវការផ្ទៀងផ្ទាត់: ${rawErr}` : `បរាជ័យ: ${rawErr}`,
          },
        },
      }));
      return createStepResult({
        status: STEP_STATUS.FAILED,
        jobId,
        error: rawErr,
        success: false,
        isReviewNeeded: isReview,
      });
    }
  }

  return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
} finally {
  markEpisodeInactive(ep.id);
  updateRunnerState('translate', (prev) => (prev.currentEpId === ep.id ? { ...prev, status: 'idle' } : prev));
  }
}

/**
 * 1B. Repair Broken Text for a Single Episode (Only repairs segments with Chinese/Thai/empty text)
 */
export async function runSingleTextRepair(ep, options = {}, signal = null, ctx = {}) {
  const { activeSeries, updateRunnerState } = ctx;
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
}

/**
 * 2. Generate Khmer AI Voice (TTS) for a Single Episode
 * Smart Reuse: Reuses valid audio; regenerates ONLY missing/changed segments unless options.forceRegen is true.
 */
export async function runSingleVoice(ep, options = {}, signal = null, ctx = {}) {
  const {
    activeSeries,
    refreshSeries,
    onInvalidateRenderedPreviewRef,
    updateRunnerState,
    setRunnerLiveStats,
    markEpisodeActive,
    markEpisodeInactive,
  } = ctx;
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

  const isTtsSuccess = Boolean(ttsRes?.success || ttsRes?.alreadyCompleted);
  if (!isTtsSuccess) {
    const errDetail = ttsRes?.error || 'TTS Generation failed';
    setRunnerLiveStats((prev) => ({
      ...prev,
      tts: {
        ...prev.tts,
        [ep.id]: {
          ...(prev.tts[ep.id] || {}),
          isFailed: true,
          isDone: false,
          message: `❌ បរាជ័យ: ${errDetail}`,
        },
      },
    }));
    console.error(`[Voice 🎙️] ❌ EP${ep.episodeNumber || ep.id} បរាជ័យ:`, errDetail);
    throw new Error(errDetail);
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
}

/**
 * 3. Clean BGM (Demucs AI Vocal Separation) for a Single Episode
 */
export async function runSingleCleanBgm(ep, options = {}, signal = null, ctx = {}) {
  const { activeSeries, updateRunnerState, setRunnerLiveStats, markEpisodeActive, markEpisodeInactive } = ctx;
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

  const separationPreset = norm.separationPreset || 'turbo';
  const presetLabel = separationPreset === 'ffmpeg_fast'
    ? '⚡ FFmpeg Instant (5s)'
    : (separationPreset === 'studio' ? '🎧 Studio Quality' : '⚡ Demucs Turbo');
  const displayModel = separationPreset === 'ffmpeg_fast' ? 'ffmpeg_fast' : (options.model || 'htdemucs');

  markEpisodeActive(ep.id);
  updateRunnerState('clean_bgm', {
    status: 'running',
    currentEpId: ep.id,
    message: `[EP${ep.episodeNumber || ep.id}] កំពុងបិទសំឡេងចិន (${presetLabel})...`,
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
            message: `🎧 [EP${ep.episodeNumber || ep.id}] ចាប់ផ្ដើមបំបែកសំឡេងដើម (${presetLabel} / ${displayModel})...`,
          },
        ],
        message: separationPreset === 'ffmpeg_fast' ? '⚡ FFmpeg Instant Center-Vocal Cut...' : `${presetLabel} Stem Separation...`,
        model: displayModel,
        separationPreset,
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
      separationPreset,
      force: norm.force,
      ...(options.model ? { model: options.model } : {}),
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

  // 2. If separateAudioApi returned without success (e.g. transient timeout or backend reconnect),
  //    keep polling until completed and verify disk cache before failing.
  if (!sepRes?.success || !sepRes?.noVocalsUrl) {
    let idleCount = 0;
    let unreachableCount = 0;
    let hadProgress = false;

    const tryRecoverCompletedStemFromDisk = async () => {
      if (norm.force && !hadProgress) return null;
      const diskStatus = await getSeparationStatusApi(videoRef, { signal }).catch(() => null);
      if (diskStatus?.available && diskStatus?.noVocalsUrl) {
        return {
          success: true,
          noVocalsUrl: diskStatus.noVocalsUrl,
          noVocalsPath: diskStatus.noVocalsPath,
          recoveredFromDisk: true,
        };
      }
      return null;
    };

    while (!signal?.aborted) {
      await new Promise((r) => setTimeout(r, 1500));
      if (signal?.aborted) {
        await killSeparationApi({ videoPath: videoRef, jobId: videoRef }).catch(() => {});
        throw new Error('Demucs separation aborted by user');
      }

      const prog = await getSeparationProgressApi(videoRef, { signal }).catch(() => null);
      if (prog) {
        unreachableCount = 0;
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
            const recovered = await tryRecoverCompletedStemFromDisk();
            if (recovered) {
              console.log(`[Clean BGM 🔇] ♻️ EP${ep.episodeNumber || ep.id} recovered completed Clean BGM from disk cache.`);
              sepRes = recovered;
              break;
            }
            console.warn(`[Clean BGM 🔇] Demucs process is idle/stopped for EP${ep.episodeNumber || ep.id}`);
            throw new Error('Demucs process ended unexpectedly (backend temporarily interrupted)');
          }
        } else {
          idleCount = 0;
        }
      } else {
        unreachableCount++;
        if (unreachableCount >= 12) {
          const recovered = await tryRecoverCompletedStemFromDisk();
          if (recovered) {
            sepRes = recovered;
            break;
          }
          throw new Error('Demucs separation endpoint temporarily unreachable');
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
}

/**
 * 4B. Auto-Fit Speech Speed for a Single Episode (1.05x - 1.50x)
 * Speeds up any red/overflowing/trimmed segments so they fit subtitle slots without cutting off speech
 */
export async function runSingleAutoFitSpeed(ep, options = {}, signal = null, ctx = {}) {
  const { activeSeries, refreshSeries, updateRunnerState, setRunnerLiveStats, markEpisodeActive, markEpisodeInactive } = ctx;
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
}

/**
 * 4C. Auto Compact Script for a Single Episode (1-Click Auto Compact: "📝 ខ្លីចំអត្ថន័យ")
 * Calls /api/dubbing/retranslate-all in chunks of 25 segments with style='compact'.
 */
export async function runSingleAutoCompact(ep, options = {}, signal = null, ctx = {}) {
  const { activeSeries, updateRunnerState, setRunnerLiveStats, markEpisodeActive, markEpisodeInactive } = ctx;
  if (!ep) return createStepResult({ status: STEP_STATUS.FAILED, error: 'No episode provided' });
  const norm = normalizeDubbingOptions(ep, 'translate', options, { activeSeries });
  const seriesId = norm.seriesId;
  const epId = ep.id;

  const segments = ep?.scriptData?.segments || [];
  if (!Array.isArray(segments) || segments.length === 0) {
    return createStepResult({ status: STEP_STATUS.SKIPPED, reason: 'no_segments_to_compact' });
  }

  markEpisodeActive(epId);
  updateRunnerState('compact', {
    status: 'running',
    currentEpId: epId,
    message: `[EP${ep.episodeNumber || epId}] កំពុងបម្លែង Script ខ្លីចំអត្ថន័យ...`,
  });

  const BATCH_CHUNK = 25;
  const count = segments.length;
  let failedBatches = 0;

  try {
    for (let i = 0; i < count; i += BATCH_CHUNK) {
      if (signal?.aborted) {
        return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
      }

      const slice = segments.slice(i, i + BATCH_CHUNK);
      const currentDone = Math.min(i + slice.length, count);
      const progressPercent = Math.min(95, Math.round((currentDone / count) * 100));

      setRunnerLiveStats?.((prev) => ({
        ...prev,
        compact: {
          ...(prev?.compact || {}),
          [epId]: {
            percent: progressPercent,
            stageMessage: `កំពុងបម្លែងឃ្លា ${currentDone}/${count}...`,
          },
        },
      }));

      try {
        await retranslateAllSegmentsApi({
          segments: slice,
          seriesId,
          episodeId: epId,
          options: { style: 'compact' },
          signal,
        });
      } catch (sliceErr) {
        if (signal?.aborted) {
          return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
        }
        console.warn(`[AutoCompact] Batch ${i}-${i + BATCH_CHUNK} failed for EP${epId}:`, sliceErr.message);
        failedBatches++;
      }
    }

    setRunnerLiveStats?.((prev) => ({
      ...prev,
      compact: {
        ...(prev?.compact || {}),
        [epId]: {
          percent: 100,
          stageMessage: 'បម្លែងខ្លីចំអត្ថន័យរួចរាល់ 100%',
        },
      },
    }));

    if (ep.scriptData) {
      ep.scriptData.autoCompacted = true;
    }

    return createStepResult({
      status: failedBatches === 0 ? STEP_STATUS.COMPLETED : STEP_STATUS.COMPLETED,
      failedBatches,
    });
  } catch (err) {
    if (signal?.aborted) return createStepResult({ status: STEP_STATUS.CANCELLED, reason: 'aborted' });
    console.error(`[DubbingRunner] Auto compact failed for EP ${epId}:`, err);
    return createStepResult({ status: STEP_STATUS.FAILED, error: err.message });
  } finally {
    markEpisodeInactive(epId);
    updateRunnerState('compact', (prev) => (prev.currentEpId === epId ? { ...prev, status: 'idle' } : prev));
  }
}
