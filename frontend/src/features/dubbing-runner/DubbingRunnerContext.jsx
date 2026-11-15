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
} from '../../services/api';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  checkEpisodeHasAutoFitReady,
  getEpisodeBrokenSummary,
} from '../../components/dashboard/geminiRouteHelpers';

const DubbingRunnerContext = createContext(null);

export function DubbingRunnerProvider({ children, activeSeries, refreshSeries }) {
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
    if (!ep) return { success: false, error: 'No episode provided' };
    const seriesId = activeSeries?.id || ep.seriesId || 'drama_project';
    const videoRef = ep.videoPath || ep.sourceVideoPath || ep.videoFile || (typeof ep.video === 'string' ? ep.video : ep.video?.videoPath) || '';
    const videoId = ep.videoId || ep.video?.videoId || videoRef;

    const hasScript = checkEpisodeHasScript(ep);

    // If episode already has script and not forcing: skip immediately (Pure translate, no repair / no TTS)
    if (hasScript && !options.force) {
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
        await fetch(`/api/jobs/${encodeURIComponent(jobId)}/kill`, { method: 'POST' }).catch(() => {});
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
        return { success: true, jobId, data: st };
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

    return { success: false, aborted: true };
  }, [activeSeries?.id, updateRunnerState]);

  /**
   * 1b. Repair Broken Text for a Single Episode (Text only, NO voice/TTS generation)
   */
  const runSingleTextRepair = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return { success: false, error: 'No episode provided' };
    const seriesId = activeSeries?.id || ep.seriesId || 'drama_project';
    const brokenScan = getEpisodeBrokenSummary(ep);
    const textBrokenCount = brokenScan?.textBrokenCount || 0;

    if (textBrokenCount === 0) {
      return { success: true, skipped: true };
    }

    updateRunnerState('repair', { message: `[EP${ep.episodeNumber || ep.id}] ជួសជុលឃ្លាអក្សរខូច (${textBrokenCount} ឃ្លា)...` });

    const res = await startRepairBrokenJobApi({
      seriesId,
      targetEpisodeIds: [ep.id],
      modelName: options.modelName || 'gemini-2.5-flash',
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
    return { success: true, repaired: true };
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

    // Build speaker map if character mapping exists
    const speakerMap = options.speakerMap || {};
    const voiceId = options.voiceId || 'km-KH-PisethNeural';

    console.log(`[Voice 🎙️] EP${ep.episodeNumber || ep.id}: កំពុងបង្កើតសំឡេង AI (${segments.length} ឃ្លា)...`);

    let pollTimer = null;
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
        seriesId,
        episodeId: ep.id,
        videoId,
        speakerMap,
        signal,
      });
    } finally {
      if (pollTimer) clearInterval(pollTimer);
    }

    if (!ttsRes?.success && ttsRes?.error) {
      setRunnerLiveStats((prev) => ({
        ...prev,
        tts: {
          ...prev.tts,
          [ep.id]: {
            ...(prev.tts[ep.id] || {}),
            isFailed: true,
            message: `❌ បរាជ័យ: ${ttsRes.error}`,
          },
        },
      }));
      console.error(`[Voice 🎙️] ❌ EP${ep.episodeNumber || ep.id} បរាជ័យ:`, ttsRes.error);
      throw new Error(ttsRes.error || 'TTS Generation failed');
    }

    setRunnerLiveStats((prev) => ({
      ...prev,
      tts: {
        ...prev.tts,
        [ep.id]: {
          ...(prev.tts[ep.id] || {}),
          percent: 100,
          isDone: true,
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

            return {
              ...prev,
              demucs: {
                ...prev.demucs,
                [ep.id]: {
                  percent: pct > 0 ? pct : (prevEp.percent || 5),
                  logs: mergedLogs.slice(-60),
                  message: prog.message || `Demucs Separation: ${pct}%`,
                  model: prog.model || options.model || 'htdemucs',
                  isDone: Boolean(prog.status === 'completed' || (prog.isDone && prog.noVocalsUrl) || pct >= 100),
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
          await killSeparationApi({ videoPath: videoRef, jobId: 'all' }).catch(() => {});
          throw new Error('Demucs separation aborted by user');
        }

        const prog = await getSeparationProgressApi(videoRef, { signal }).catch(() => null);
        if (prog) {
          const pct = Math.min(100, Math.max(0, Number(prog.progress || prog.percent || 0)));
          if (pct > 0) hadProgress = true;
          updateRunnerState('clean_bgm', { progress: pct });

          if (prog.status === 'completed' || (prog.isDone && prog.noVocalsUrl) || pct >= 100) {
            sepRes = { success: true, noVocalsUrl: prog.noVocalsUrl, noVocalsPath: prog.noVocalsPath };
            break;
          }
          if (prog.status === 'error' || prog.isFailed) {
            console.error(`[Clean BGM 🔇] ❌ EP${ep.episodeNumber || ep.id} បរាជ័យ:`, prog.error || prog.message);
            throw new Error(prog.error || prog.message || 'Demucs separation failed');
          }
          if (prog.status === 'idle') {
            idleCount++;
            // Give 10 consecutive ticks (12s) before declaring Demucs idle, avoiding false early aborts
            if (idleCount >= 10) {
              console.warn(`[Clean BGM 🔇] Demucs process is idle/stopped for EP${ep.episodeNumber || ep.id}`);
              throw new Error('Demucs process ended unexpectedly');
            }
          } else {
            idleCount = 0;
          }
        } else {
          idleCount++;
          // Give 15 consecutive failed polls (18s) of network grace period under heavy CPU load
          if (idleCount >= 15) {
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

    return { success: true, noVocalsUrl: sepRes?.noVocalsUrl };

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
   * 4B. Auto-Fit Speech Speed for a Single Episode (1.05x - 1.50x)
   * Speeds up any red/overflowing/trimmed segments so they fit subtitle slots without cutting off speech
   */
  const runSingleAutoFitSpeed = useCallback(async (ep, options = {}, signal = null) => {
    if (!ep) return { success: false, error: 'No episode provided' };
    const seriesId = activeSeries?.id || ep.seriesId || 'drama_project';
    const epId = ep.id;

    try {
      if (signal?.aborted) return { success: false, aborted: true };

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

        if (typeof refreshSeries === 'function') {
          await refreshSeries();
        }
        return { success: true, fittedCount: res.fittedCount || 0 };
      }

      setRunnerLiveStats((prev) => ({
        ...prev,
        autofit: {
          ...prev.autofit,
          [epId]: {
            percent: 100,
            isFailed: true,
            message: `❌ ${res?.error || 'Auto-fit speed failed'}`,
            logs: [
              { time: new Date().toLocaleTimeString(), message: `❌ ${res?.error || 'Auto-fit speed failed'}` },
            ],
          },
        },
      }));
      return { success: false, error: res?.error || 'Auto-fit speed failed' };
    } catch (err) {
      if (signal?.aborted) return { success: false, aborted: true };
      console.error(`[DubbingRunner] Auto-fit speed failed for EP ${epId}:`, err);
      setRunnerLiveStats((prev) => ({
        ...prev,
        autofit: {
          ...prev.autofit,
          [epId]: {
            percent: 100,
            isFailed: true,
            message: `❌ បរាជ័យ: ${err.message}`,
            logs: [
              { time: new Date().toLocaleTimeString(), message: `❌ Auto-Fit Error: ${err.message}` },
            ],
          },
        },
      }));
      return { success: false, error: err.message };
    }
  }, [activeSeries?.id, refreshSeries]);

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
        return { success: true, count: 0 };
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
            return { success: true, count: 0 };
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
      queuedEpIds: queue.map((e) => e.id),
      progress: 0,
      message: `ចាប់ផ្តើមរត់ 1-by-1 លើ ${queue.length} ភាគ...`,
    });

    try {
      for (let idx = 0; idx < queue.length; idx++) {
        if (controller.signal.aborted) {
          console.log(`[1-by-1 Runner] 🛑 បញ្ឈប់ដំណើរការ ${stepType} ដោយអ្នកប្រើប្រាស់`);
          break;
        }
        const currentEp = queue[idx];

        setActiveEpisodeIds((prev) => new Set([...prev, currentEp.id]));
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
        if (stepType === 'translate') {
          await runSingleTranslate(currentEp, options, controller.signal);
        } else if (stepType === 'repair') {
          await runSingleTextRepair(currentEp, options, controller.signal);
        } else if (stepType === 'voice') {
          await runSingleVoice(currentEp, options, controller.signal);
        } else if (stepType === 'clean_bgm') {
          await runSingleCleanBgm(currentEp, options, controller.signal);
        } else if (stepType === 'autofit') {
          await runSingleAutoFitSpeed(currentEp, options, controller.signal);
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

      console.log(`%c[1-by-1 Runner] 🎉 ជោគជ័យ 100% លើគ្រប់ទាំង ${queue.length} ភាគសម្រាប់ ${stepType.toUpperCase()}!`, 'color: #34d399; font-weight: bold;');

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
  }, [activeSeries?.episodes, updateRunnerState, runSingleTranslate, runSingleTextRepair, runSingleVoice, runSingleCleanBgm, runSingleAutoFitSpeed, runSingleEpisodeAll3, refreshSeries]);

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
      if (stepType === 'translate' || stepType === 'repair' || stepType === 'all3') {
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

