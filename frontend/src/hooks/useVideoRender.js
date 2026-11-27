import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  renderVideoApi,
  startBatchRenderApi,
  fetchBatchRenderProgressApi,
  fetchLatestBatchRenderApi,
  killBatchRenderApi,
} from '../services/api';
import { resolveDefaultAspectRatio, inferRenderedAspectRatio, sanitizeAspectRatio } from '../utils/projectStorage';
import {
  buildLogoExportPayload,
  buildCornerMaskExportPayload,
  buildAntiTheftExportPayload,
  loadGlobalLogoSettings,
  loadGlobalCustomizeSettings,
} from '../utils/logoSettingsStorage';

/**
 * Custom hook to manage single-episode and multi-episode batch/merged video export
 */
export function useVideoRender({
  selectedVideo,
  videoMetadata = null,
  activeEpisode = null,
  audioGenerated,
  speakerRegistry,
  voiceSettings,
  voiceSettingsRef = null,
  globalLogoSettings = null,
  globalLogoSettingsRef = null,
  scriptData,
  videoClips,
  fullAudioPath,
  videoRef,
  setIsPlaying,
  seriesId = null,
  episodeId = null,
  activeSeries = null,
  handleSaveEpisodeBackground = null,
  setAudioOutdated = null,
  refreshSeriesFromServer = null,
}) {
  const [renderedVideo, setRenderedVideo] = useState(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');

  // Shared Batch Export & Full Merge state (synced across ExportSettingsPanel & GeminiRouteModal)
  const [batchJob, setBatchJob] = useState(null);
  const [isStartingBatchRender, setIsStartingBatchRender] = useState(false);
  const [batchRenderError, setBatchRenderError] = useState(null);

  const batchPollTimerRef = useRef(null);
  const isPollingInFlightRef = useRef(false);
  const lastHandledCompletionJobIdRef = useRef(null);
  const seriesIdRef = useRef(seriesId);
  seriesIdRef.current = seriesId;
  const episodeIdRef = useRef(episodeId);
  episodeIdRef.current = episodeId;
  const refreshSeriesRef = useRef(refreshSeriesFromServer);
  refreshSeriesRef.current = refreshSeriesFromServer;
  const internalVoiceSettingsRef = useRef(voiceSettings);
  internalVoiceSettingsRef.current = voiceSettings;
  const internalGlobalLogoSettingsRef = useRef(globalLogoSettings);
  internalGlobalLogoSettingsRef.current = globalLogoSettings;

  const getLatestVoiceSettings = useCallback(
    () => voiceSettingsRef?.current || internalVoiceSettingsRef.current || voiceSettings || {},
    [voiceSettingsRef, voiceSettings]
  );

  const getLatestGlobalLogoSettings = useCallback(
    () => globalLogoSettingsRef?.current || internalGlobalLogoSettingsRef.current || globalLogoSettings || loadGlobalLogoSettings(),
    [globalLogoSettingsRef, globalLogoSettings]
  );

  const triggerBrowserDownload = useCallback((url, filename) => {
    if (!url || typeof document === 'undefined') return;
    try {
      const link = document.createElement('a');
      link.href = url;
      if (filename) link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (dlErr) {
      console.warn('Auto-download trigger error:', dlErr);
    }
  }, []);

  const stopBatchPolling = useCallback(() => {
    if (batchPollTimerRef.current) {
      clearInterval(batchPollTimerRef.current);
      batchPollTimerRef.current = null;
    }
    isPollingInFlightRef.current = false;
  }, []);

  const handleBatchJobFinished = useCallback((job, shouldAutoDownload = false) => {
    if (!job || job.status !== 'completed') return;
    if (lastHandledCompletionJobIdRef.current === job.jobId) return;
    lastHandledCompletionJobIdRef.current = job.jobId;

    if (episodeIdRef.current && Array.isArray(job.outputs)) {
      const matched = job.outputs.find((o) => String(o.episodeId) === String(episodeIdRef.current));
      if (matched) {
        const resolvedMatchedRatio =
          sanitizeAspectRatio(matched.aspectRatio) ||
          sanitizeAspectRatio(job.exportSettings?.aspectRatio) ||
          inferRenderedAspectRatio(matched, null, sanitizeAspectRatio(getLatestVoiceSettings()?.aspectRatio) || '16:9');
        setRenderedVideo({
          success: true,
          videoUrl: matched.videoUrl,
          outputVideoUrl: matched.outputVideoUrl || matched.videoUrl,
          outputFilename: matched.outputFilename,
          renderedAt: matched.renderedAt || job.completedAt || Date.now(),
          burnedSubtitleOptions: matched.burnedSubtitleOptions,
          downloadUrl: matched.downloadUrl,
          renderTimeSeconds: matched.renderTimeSeconds || 0,
          savedToDownloads: Boolean(matched.savedToDownloads),
          downloadsPath: matched.downloadsPath || null,
          aspectRatio: resolvedMatchedRatio,
          youtubeTransform: matched.youtubeTransform || job.exportSettings?.youtubeTransform || null,
        });
      }
    }

    if (typeof refreshSeriesRef.current === 'function') {
      try {
        Promise.resolve(refreshSeriesRef.current()).catch(() => {});
      } catch (_) {}
    }

    if (shouldAutoDownload) {
      if (job.mode === 'merge' && job.mergedResult?.downloadUrl) {
        triggerBrowserDownload(
          job.mergedResult.downloadUrl || job.mergedResult.videoUrl,
          job.mergedResult.outputFilename || 'Full_Merged_Khmer_Dubbed.mp4'
        );
      } else if (job.mode === 'separate' && Array.isArray(job.outputs) && job.outputs.length === 1) {
        const singleOut = job.outputs[0];
        triggerBrowserDownload(
          singleOut.downloadUrl || singleOut.videoUrl,
          singleOut.outputFilename
        );
      }
    }
  }, [triggerBrowserDownload]);

  const startBatchPolling = useCallback((jobId, targetSeriesId, shouldAutoDownload = true) => {
    stopBatchPolling();
    if (!jobId) return;

    const pollOnce = async () => {
      if (isPollingInFlightRef.current) return;
      isPollingInFlightRef.current = true;
      try {
        const res = await fetchBatchRenderProgressApi(jobId, targetSeriesId);
        if (seriesIdRef.current && targetSeriesId && String(seriesIdRef.current) !== String(targetSeriesId)) {
          stopBatchPolling();
          return;
        }
        const job = res?.job || null;
        if (!job) return;
        setBatchJob(job);
        if (job.status !== 'running') {
          stopBatchPolling();
          if (job.status === 'completed') {
            handleBatchJobFinished(job, shouldAutoDownload);
          } else if (job.status === 'failed' && job.error) {
            setBatchRenderError(job.error);
          }
        }
      } catch (err) {
        if (err?.status === 404) {
          stopBatchPolling();
          setBatchJob((prev) =>
            prev && prev.status === 'running'
              ? {
                  ...prev,
                  status: 'failed',
                  stage: '⚠️ Job មិនមាននៅលើ Server ទេ (អាចមកពី Server Restarted)',
                  error: 'Job not found on server',
                }
              : prev
          );
        }
      } finally {
        isPollingInFlightRef.current = false;
      }
    };

    pollOnce();
    batchPollTimerRef.current = setInterval(pollOnce, 1000);
  }, [stopBatchPolling, handleBatchJobFinished]);

  // Hydrate latest batch export job when series switches and resume polling if active
  useEffect(() => {
    stopBatchPolling();
    setBatchRenderError(null);
    lastHandledCompletionJobIdRef.current = null;

    if (!seriesId) {
      setBatchJob(null);
      return;
    }

    const controller = new AbortController();
    fetchLatestBatchRenderApi(seriesId, { signal: controller.signal })
      .then((res) => {
        const job = res?.job || null;
        setBatchJob(job);
        if (job?.status === 'running') {
          startBatchPolling(job.jobId, seriesId, false);
        } else if (job?.status === 'completed') {
          lastHandledCompletionJobIdRef.current = job.jobId;
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          setBatchJob(null);
        }
      });

    return () => {
      controller.abort();
      stopBatchPolling();
    };
  }, [seriesId, stopBatchPolling, startBatchPolling]);

  const buildAntiTheftOptions = useCallback(() => {
    const activeCustomize = getLatestGlobalLogoSettings();
    return buildAntiTheftExportPayload(activeCustomize);
  }, [getLatestGlobalLogoSettings]);

  const buildLogoOptions = useCallback(() => {
    const activeLogo = getLatestGlobalLogoSettings();
    return buildLogoExportPayload(activeLogo);
  }, [getLatestGlobalLogoSettings]);

  const buildCornerMaskOptions = useCallback(() => {
    const activeCustomize = getLatestGlobalLogoSettings();
    return buildCornerMaskExportPayload(activeCustomize);
  }, [getLatestGlobalLogoSettings]);

  const buildSponsorOptions = useCallback(() => {
    const activeSettings = getLatestVoiceSettings();
    const rawX = activeSettings?.sponsorXPercent;
    const rawY = activeSettings?.sponsorYPercent;
    const parsedX = rawX === null || rawX === undefined || rawX === '' ? NaN : Number(rawX);
    const parsedY = rawY === null || rawY === undefined || rawY === '' ? NaN : Number(rawY);
    const sponsorXPercent = Number.isFinite(parsedX) ? parsedX : null;
    const sponsorYPercent = Number.isFinite(parsedY) ? parsedY : null;
    return {
      enabled: Boolean(activeSettings?.enableSponsor),
      enableSponsor: Boolean(activeSettings?.enableSponsor),
      sponsorVideoUrl: activeSettings?.sponsorVideoUrl,
      sponsorVideoPath: activeSettings?.sponsorVideoPath,
      videoUrl: activeSettings?.sponsorVideoUrl,
      videoPath: activeSettings?.sponsorVideoPath,
      position: activeSettings?.sponsorPosition || 'bottom-left',
      sponsorXPercent,
      sponsorYPercent,
      xPercent: sponsorXPercent,
      yPercent: sponsorYPercent,
      scale: Number(activeSettings?.sponsorScale) || 25,
      opacity: Number(activeSettings?.sponsorOpacity) || 1.0,
      chromaKey: activeSettings?.sponsorChromaKey !== false,
      chromaSimilarity: Number(activeSettings?.sponsorChromaSimilarity) || 0.28,
      timingMode: activeSettings?.sponsorTimingMode || 'loop',
      intervalSec: Number(activeSettings?.sponsorIntervalSec) || 60,
      durationSec: Number(activeSettings?.sponsorDurationSec) || 10,
      startSec: Number(activeSettings?.sponsorStartSec) || 0,
      endSec: Number(activeSettings?.sponsorEndSec) || 15,
      muteAudio: activeSettings?.sponsorMuteAudio !== false,
      volume: Number(activeSettings?.sponsorVolume) || 0.5,
    };
  }, [getLatestVoiceSettings]);

  const buildVideoAdOptions = useCallback(() => {
    const activeSettings = getLatestVoiceSettings();
    return {
      enabled: Boolean(activeSettings?.enableVideoAds),
      videoUrl: activeSettings?.videoAdUrl || null,
      videoPath: activeSettings?.videoAdPath || null,
      name: activeSettings?.videoAdName || null,
      durationSec: Number(activeSettings?.videoAdDuration) || 0,
      hasAudio: activeSettings?.videoAdHasAudio !== false,
      placement: activeSettings?.videoAdPlacement || 'manual',
      volume: Number.isFinite(Number(activeSettings?.videoAdVolume)) ? Number(activeSettings.videoAdVolume) : 1.0,
      applyTo: activeSettings?.videoAdApplyTo || 'current',
    };
  }, [getLatestVoiceSettings]);

  const buildYoutubeTransformOptions = useCallback(() => {
    const activeSettings = getLatestVoiceSettings();
    const rawZoom = Number(activeSettings?.zoomScale);
    const zoomScale = Number.isFinite(rawZoom)
      ? Math.max(1.0, Math.min(1.15, Number(rawZoom.toFixed(3))))
      : 1.0;
    return {
      enableMirrorFlip: Boolean(activeSettings?.enableMirrorFlip),
      zoomScale,
      enableColorGrade: Boolean(activeSettings?.enableColorGrade),
      youtubeSafeAudio: Boolean(activeSettings?.youtubeSafeAudio),
    };
  }, [getLatestVoiceSettings]);

  const handleStartBatchRender = useCallback(async ({
    episodeIds = [],
    mode = 'merge',
    allowOriginalAudio = false,
  } = {}) => {
    const targetSeriesId = seriesId || activeSeries?.id;
    if (!targetSeriesId) {
      const msg = 'មិនទាន់មាន Series សម្រាប់ Batch Export ទេ!';
      setBatchRenderError(msg);
      return { success: false, error: msg };
    }
    if (!Array.isArray(episodeIds) || episodeIds.length === 0) {
      const msg = 'សូមជ្រើសរើសយ៉ាងតិច ១ ភាគសម្រាប់ Export!';
      setBatchRenderError(msg);
      return { success: false, error: msg };
    }

    setIsStartingBatchRender(true);
    setBatchRenderError(null);
    lastHandledCompletionJobIdRef.current = null;

    try {
      const activeSettings = getLatestVoiceSettings();
      const exportSettings = {
        aspectRatio: sanitizeAspectRatio(activeSettings?.aspectRatio),
        verticalStyle: activeSettings?.verticalStyle || 'pad',
        burnSubtitles: activeSettings?.burnSubtitles !== false,
        subtitleColor: activeSettings?.subtitleColor || 'white',
        subtitleSize: activeSettings?.subtitleSize || 'medium',
        subtitleStyle: activeSettings?.subtitleStyle || 'banner',
        subtitleOptions: activeSettings?.subtitleOptions || {},
        duckingVolume: activeSettings?.duckingVolume ?? 0.15,
        khmerVolume: activeSettings?.khmerVolume ?? 1.3,
        enableDemucs: Boolean(activeSettings?.enableDemucs),
        enableCustomBgm: Boolean(activeSettings?.enableCustomBgm && (activeSettings?.customBgmPath || activeSettings?.customBgmUrl)),
        customBgmPath: activeSettings?.customBgmPath || null,
        customBgmUrl: activeSettings?.customBgmUrl || null,
        antiTheft: buildAntiTheftOptions(),
        logoSettings: buildLogoOptions(),
        cornerMask: buildCornerMaskOptions(),
        sponsorSettings: buildSponsorOptions(),
        videoAdSettings: buildVideoAdOptions(),
        youtubeTransform: buildYoutubeTransformOptions(),
      };

      const episodeOverrides = {};
      if (
        episodeId &&
        episodeIds.map(String).includes(String(episodeId)) &&
        (scriptData?.segments?.length > 0 || (videoClips && videoClips.length > 0) || fullAudioPath)
      ) {
        episodeOverrides[episodeId] = {
          segments: scriptData?.segments || undefined,
          videoClips: videoClips || undefined,
          fullAudioPath: fullAudioPath || undefined,
        };
      }

      const res = await startBatchRenderApi({
        seriesId: targetSeriesId,
        episodeIds,
        mode: mode === 'separate' ? 'separate' : 'merge',
        allowOriginalAudio: Boolean(allowOriginalAudio),
        exportSettings,
        episodeOverrides,
      });

      const job = res?.job || null;
      if (job) {
        setBatchJob(job);
        startBatchPolling(job.jobId, targetSeriesId, true);
      }
      return { success: true, job };
    } catch (err) {
      const msg = err?.message || 'Batch Export បរាជ័យ';
      setBatchRenderError(msg);
      return {
        success: false,
        error: msg,
        skippedEpisodes: err?.data?.skippedEpisodes || [],
      };
    } finally {
      setIsStartingBatchRender(false);
    }
  }, [
    seriesId,
    activeSeries?.id,
    episodeId,
    getLatestVoiceSettings,
    scriptData,
    videoClips,
    fullAudioPath,
    buildAntiTheftOptions,
    buildLogoOptions,
    buildCornerMaskOptions,
    buildSponsorOptions,
    buildVideoAdOptions,
    buildYoutubeTransformOptions,
    startBatchPolling,
  ]);

  const handleKillBatchRender = useCallback(async (jobId = null) => {
    const targetJobId = jobId || batchJob?.jobId || null;
    const targetSeriesId = seriesId || activeSeries?.id || null;
    try {
      const res = await killBatchRenderApi({ jobId: targetJobId, seriesId: targetSeriesId });
      stopBatchPolling();
      if (res?.job) {
        setBatchJob(res.job);
      } else {
        setBatchJob((prev) =>
          prev
            ? { ...prev, status: 'cancelled', stage: '🛑 បានបញ្ឈប់ការ Export (Cancelled)' }
            : prev
        );
      }
    } catch (err) {
      setBatchRenderError(err?.message || 'មិនអាចបញ្ឈប់ Batch Export បានទេ');
    }
  }, [batchJob?.jobId, seriesId, activeSeries?.id, stopBatchPolling]);

  const clearBatchRenderResult = useCallback(() => {
    setBatchRenderError(null);
    setBatchJob((prev) => (prev?.status === 'running' ? prev : null));
  }, []);

  const batchRender = useMemo(() => ({
    job: batchJob,
    isRunning: batchJob?.status === 'running',
    isStarting: isStartingBatchRender,
    error: batchRenderError,
    start: handleStartBatchRender,
    kill: handleKillBatchRender,
    clear: clearBatchRenderResult,
  }), [
    batchJob,
    isStartingBatchRender,
    batchRenderError,
    handleStartBatchRender,
    handleKillBatchRender,
    clearBatchRenderResult,
  ]);

  // Render Final Dubbed Video via FFmpeg Backend
  const handleRenderVideo = async () => {
    if (!selectedVideo) {
      alert('សូម Import វីដេអូរឿងភាគចិនជាមុនសិន!');
      return;
    }

    if (!audioGenerated) {
      alert('សូមចុច "Generate Khmer Voice (TTS)" ដើម្បីបង្កើតសំឡេងខ្មែរ AI ជាមុនសិន!');
      return;
    }

    const speakerMap = {};
    Object.values(speakerRegistry || {}).forEach((spk) => {
      if (spk.voiceId) {
        speakerMap[spk.id] = spk.voiceId;
        speakerMap[spk.name] = spk.voiceId;
      }
    });

    setIsRendering(true);
    setRenderProgress(1);
    setRenderStage('1/4 បង្កើត Khmer .ASS Subtitles & ផ្ទុក Fonts...');

    let currentVal = 1;
    const progressTimer = setInterval(() => {
      if (currentVal < 25) {
        currentVal += 2;
        if (currentVal >= 25) {
          setRenderStage('2/4 រៀបចំ Smart Ducking 85% & កម្រិតសំឡេង...');
        }
      } else if (currentVal < 55) {
        currentVal += 1;
        if (currentVal >= 55) {
          setRenderStage('3/4 FFmpeg កំពុង Encode វីដេអូ & ដុត Subtitles...');
        }
      } else if (currentVal < 85) {
        currentVal += 1;
        if (currentVal >= 85) {
          setRenderStage('4/4 កំពុង Export ចូល Downloads Folder លើ PC...');
        }
      } else if (currentVal < 97) {
        if (Math.random() > 0.4) {
          currentVal += 1;
        }
      }
      setRenderProgress(Math.min(currentVal, 97));
    }, 280);

    try {
      const activeSettings = getLatestVoiceSettings();
      const activeVoiceId = activeSettings.voiceId || 'km-KH-PisethNeural';
      const activeSpeed = activeSettings.speed || 'normal';

      const humanDisplayTitle = selectedVideo?.displayTitle 
        || selectedVideo?.originalFilename?.replace(/\.[^/.]+$/, '').trim()
        || (selectedVideo?.fileName && !/^ep_\d+/i.test(selectedVideo.fileName) ? selectedVideo.fileName.replace(/\.[^/.]+$/, '').trim() : '')
        || (scriptData?.title || 'Drama_Recap');
      const dramaName = humanDisplayTitle;

      const antiTheftOptions = buildAntiTheftOptions();
      const logoOptions = buildLogoOptions();
      const cornerMaskOptions = buildCornerMaskOptions();
      const sponsorOptions = buildSponsorOptions();
      const videoAdOptions = buildVideoAdOptions();
      const youtubeTransformOptions = buildYoutubeTransformOptions();

      // Resolve effective export aspect ratio:
      // 1. User manual select in voiceSettings.aspectRatio takes precedence.
      // 2. Otherwise default from source dimensions (9:16 portrait, 16:9 landscape, 1:1 square).
      // 3. Last-resort 16:9 only if source dimensions are genuinely missing.
      const srcW = Number(videoMetadata?.width || selectedVideo?.width || activeEpisode?.metadata?.width || activeEpisode?.video?.width) || 0;
      const srcH = Number(videoMetadata?.height || selectedVideo?.height || activeEpisode?.metadata?.height || activeEpisode?.video?.height) || 0;
      const defaultRatio = resolveDefaultAspectRatio(srcW, srcH);

      let effectiveAspectRatio = sanitizeAspectRatio(activeSettings.aspectRatio);
      if (!effectiveAspectRatio) {
        if (defaultRatio) {
          effectiveAspectRatio = defaultRatio;
        } else {
          console.warn('[useVideoRender] Source video metadata genuinely missing dimensions, falling back to 16:9 last-resort.');
          effectiveAspectRatio = '16:9';
        }
      }

      const result = await renderVideoApi({
        videoId: selectedVideo.videoId,
        projectName: dramaName,
        videoTitle: dramaName,
        seriesId,
        episodeId,
        segments: scriptData?.segments || [],
        videoClips: videoClips || [],
        fullAudioPath,
        duckingVolume: activeSettings.duckingVolume,
        khmerVolume: activeSettings.khmerVolume,
        enableDemucs: Boolean(activeSettings.enableDemucs),
        enableCustomBgm: Boolean(activeSettings.enableCustomBgm && (activeSettings.customBgmPath || activeSettings.customBgmUrl)),
        customBgmPath: activeSettings.customBgmPath || null,
        customBgmUrl: activeSettings.customBgmUrl || null,
        burnSubtitles: activeSettings.burnSubtitles !== false,
        subtitleColor: activeSettings.subtitleColor,
        subtitleSize: activeSettings.subtitleSize,
        subtitleStyle: activeSettings.subtitleStyle || 'banner',
        aspectRatio: effectiveAspectRatio,
        verticalStyle: activeSettings.verticalStyle || 'pad',
        sourceDimensions: srcW && srcH ? { width: srcW, height: srcH } : null,
        voiceId: activeVoiceId,
        speed: activeSpeed,
        speakerMap,
        antiTheft: antiTheftOptions,
        logoSettings: logoOptions,
        cornerMask: cornerMaskOptions,
        sponsorSettings: sponsorOptions,
        videoAdSettings: videoAdOptions,
        youtubeTransform: youtubeTransformOptions,
      });

      clearInterval(progressTimer);
      setRenderProgress(100);
      setRenderStage('🎉 Render & Export ជោគជ័យ 100%!');
      await new Promise((r) => setTimeout(r, 600));

      setRenderedVideo({
        ...result,
        aspectRatio: effectiveAspectRatio,
        youtubeTransform: result?.youtubeTransform || youtubeTransformOptions,
        renderedAt: Date.now(),
      });
      if (videoRef?.current) {
        videoRef.current.pause();
        if (setIsPlaying) setIsPlaying(false);
      }

      // Automatically trigger browser download to user's Downloads folder
      triggerBrowserDownload(
        result.downloadUrl || result.outputVideoUrl,
        result.outputFilename || `${dramaName}_Khmer_Dubbed.mp4`
      );
    } catch (err) {
      clearInterval(progressTimer);
      setRenderProgress(0);
      setRenderStage('');
      console.error(err);
      alert('Export video failed: ' + err.message);
    } finally {
      clearInterval(progressTimer);
      setIsRendering(false);
      setTimeout(() => setRenderProgress(0), 1500);
    }
  };

  return {
    renderedVideo,
    setRenderedVideo,
    isRendering,
    setIsRendering,
    renderProgress,
    renderStage,
    handleRenderVideo,
    batchRender,
  };
}
