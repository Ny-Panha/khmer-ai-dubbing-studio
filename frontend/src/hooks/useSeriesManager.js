import { useState, useEffect, useCallback, useRef } from 'react';
import {
  loadSeriesList,
  saveSeriesList,
  getActiveSeriesId,
  setActiveSeriesId,
  getActiveEpisodeId,
  setActiveEpisodeId,
  loadActiveSeriesAndEpisode,
  saveEpisodeState,
  addNewEpisodeToSeries,
  deleteEpisodeFromSeries,
  updateSeriesTitle,
  extractGlossaryFromEpisode,
  createDefaultEpisode,
  createDefaultSeries,
  loadSavedVoiceSettings,
  resolveStickyVoiceSettings,
  sanitizeRenderedVideo,
  sanitizeAndHealSeriesList,
} from '../utils/projectStorage';
import { generateVideoThumbnails } from '../utils/thumbnailUtils';
import { fetchVideoThumbnails } from '../services/api';
import { normalizeClips, sanitizeScriptData } from '../utils/timelineUtils';

/**
 * Custom Hook for Series & Multi-Episode Management
 */
export function useSeriesManager({
  selectedVideo,
  setSelectedVideo,
  videoMetadata,
  setVideoMetadata,
  scriptData,
  setScriptData,
  speakerRegistry,
  setSpeakerRegistry,
  audioGenerated,
  setAudioGenerated,
  audioOutdated,
  setAudioOutdated,
  fullAudioPath,
  setFullAudioPath,
  fullAudioUrl,
  setFullAudioUrl,
  duration,
  setDuration,
  videoClips,
  setVideoClips,
  activeClipId,
  setActiveClipId,
  selectedSegmentId,
  setSelectedSegmentId,
  renderedVideo,
  setRenderedVideo,
  voiceSettings,
  setVoiceSettings,
  setVideoThumbnails,
  setMediaAssets,
  setCurrentTime,
  setLeftTab,
  activeRequestRef,
  clearHistory,
  handleClearVideo,
}) {
  const [seriesList, setSeriesList] = useState(loadSeriesList);
  const [activeSeriesIdState, setActiveSeriesIdState] = useState(getActiveSeriesId);
  const [activeEpisodeIdState, setActiveEpisodeIdState] = useState(getActiveEpisodeId);

  // Reference to current active episode ID to prevent stale closures in async effects
  const activeEpisodeIdRef = useRef(activeEpisodeIdState);
  activeEpisodeIdRef.current = activeEpisodeIdState;

  // Initialization flag: prevents auto-save effect from wiping localStorage on initial mount
  const isInitializedRef = useRef(false);
  // Transition guard: prevents debounced auto-save from writing stale workspace state during episode switch/delete
  const isTransitioningRef = useRef(false);

  const activeSeries = seriesList.find((s) => s.id === activeSeriesIdState) || seriesList[0] || null;
  const activeEpisode = (activeSeries?.episodes || []).find((e) => e.id === activeEpisodeIdState) || activeSeries?.episodes?.[0] || null;

  const latestSeriesListRef = useRef(seriesList);
  latestSeriesListRef.current = seriesList;
  const latestScriptDataRef = useRef(scriptData);
  latestScriptDataRef.current = scriptData;

  // Stable reference to external setters to prevent applyEpisodeToWorkspace from recreating on every render
  const callbacksRef = useRef({});
  callbacksRef.current = {
    setSelectedVideo,
    setVideoMetadata,
    setScriptData,
    setSpeakerRegistry,
    setAudioGenerated,
    setAudioOutdated,
    setFullAudioPath,
    setFullAudioUrl,
    setDuration,
    setCurrentTime,
    setVideoClips,
    setActiveClipId,
    setSelectedSegmentId,
    setRenderedVideo,
    setVoiceSettings,
    setMediaAssets,
    setVideoThumbnails,
    setLeftTab,
    clearHistory,
    handleClearVideo,
  };

  // Helper to apply an episode state to the React workspace (stable reference)
  const applyEpisodeToWorkspace = useCallback((ep) => {
    if (!ep) return;
    const cb = callbacksRef.current;

    // If episode has no video yet (e.g. freshly created or reset episode), purge workspace cleanly
    if (!ep.video) {
      if (cb.handleClearVideo) {
        cb.handleClearVideo();
      } else {
        if (cb.setSelectedVideo) cb.setSelectedVideo(null);
        if (cb.setVideoMetadata) cb.setVideoMetadata(null);
        if (cb.setScriptData) cb.setScriptData(null);
        if (cb.setSpeakerRegistry) cb.setSpeakerRegistry({});
        if (cb.setAudioGenerated) cb.setAudioGenerated(false);
        if (cb.setAudioOutdated) cb.setAudioOutdated(false);
        if (cb.setFullAudioPath) cb.setFullAudioPath(null);
        if (cb.setFullAudioUrl) cb.setFullAudioUrl(null);
        if (cb.setDuration) cb.setDuration(0);
        if (cb.setCurrentTime) cb.setCurrentTime(0);
        if (cb.setVideoClips) cb.setVideoClips([]);
        if (cb.setActiveClipId) cb.setActiveClipId(null);
        if (cb.setSelectedSegmentId) cb.setSelectedSegmentId(null);
        if (cb.setRenderedVideo) cb.setRenderedVideo(null);
        if (cb.setMediaAssets) cb.setMediaAssets([]);
        if (cb.setVideoThumbnails) cb.setVideoThumbnails([]);
        if (cb.clearHistory) cb.clearHistory();
        if (cb.setLeftTab) cb.setLeftTab('media');
      }
      if (cb.setVoiceSettings) {
        cb.setVoiceSettings((prev) =>
          resolveStickyVoiceSettings({
            prevSettings: prev,
            savedGlobalSettings: loadSavedVoiceSettings(),
            episodeVoiceSettings: null,
          })
        );
      }
      return;
    }

    if (cb.setSelectedVideo) {
      cb.setSelectedVideo(ep.video || null);
    }
    if (cb.setVideoMetadata) {
      cb.setVideoMetadata(ep.metadata || null);
    }
    if (cb.setScriptData) {
      cb.setScriptData(ep.scriptData ? sanitizeScriptData(ep.scriptData) : null);
    }
    if (cb.setSpeakerRegistry) {
      cb.setSpeakerRegistry(ep.speakerRegistry || {});
    }
    if (cb.setAudioGenerated) {
      cb.setAudioGenerated(Boolean(ep.audioGenerated));
    }
    if (cb.setAudioOutdated) {
      cb.setAudioOutdated(Boolean(ep.audioOutdated));
    }
    // Episode Audio Isolation: verify audio references actually belong to this episode
    const isMatchingEpAudio = (audioRef) => {
      if (!audioRef || typeof audioRef !== 'string') return false;
      if (audioRef.includes('/episodes/') || audioRef.includes('\\episodes\\')) {
        return audioRef.includes(`/episodes/${ep.id}/`) || audioRef.includes(`\\episodes\\${ep.id}\\`);
      }
      return false;
    };

    if (cb.setFullAudioPath) {
      cb.setFullAudioPath(isMatchingEpAudio(ep.fullAudioPath) ? ep.fullAudioPath : null);
    }
    if (cb.setFullAudioUrl) {
      cb.setFullAudioUrl(isMatchingEpAudio(ep.fullAudioUrl) ? ep.fullAudioUrl : null);
    }
    const scriptMaxEnd = (ep.scriptData?.segments || []).reduce((max, s) => {
      const end = Number(s.audioEndSec) || Number(s.endSec) || (Number(s.startSec) || 0) + (Number(s.audioDurationSec) || 3.0);
      return Math.max(max, end);
    }, 0);
    const epDur = Math.max(
      ep.duration || 0,
      ep.metadata?.durationSec || 0,
      ep.video?.durationSec || 0,
      ep.video?.duration || 0,
      scriptMaxEnd
    );

    if (cb.setDuration) {
      cb.setDuration(epDur || ep.duration || 0);
    }
    if (cb.setCurrentTime) {
      cb.setCurrentTime(0);
    }
    if (cb.setVideoClips) {
      const existingClips = Array.isArray(ep.videoClips) ? ep.videoClips : [];
      if (existingClips.length === 0 && ep.video && epDur > 0) {
        cb.setVideoClips([
          {
            id: `clip-${ep.id || 'ep'}-${Date.now()}`,
            trackId: 'video-1',
            trackRow: 0,
            start: 0,
            end: epDur,
            sourceStart: 0,
            sourceEnd: epDur,
            duration: epDur,
            name: ep.video.originalFilename || ep.video.fileName || 'Full Video',
            videoUrl: ep.video.videoUrl,
            videoId: ep.video.videoId,
          }
        ]);
      } else {
        const normalized = normalizeClips(existingClips, epDur);
        // Auto-heal single truncated video clip: if there is only 1 uncut clip starting at 0,
        // but its end is way shorter than the episode duration (e.g. truncated at 20s-30s instead of 1200s),
        // stretch it to cover the full episode duration so the video track never runs out!
        if (normalized.length === 1 && normalized[0].start === 0 && epDur > 15 && normalized[0].end < epDur - 2) {
          normalized[0].end = epDur;
          normalized[0].sourceEnd = epDur;
          normalized[0].duration = epDur;
        }
        cb.setVideoClips(normalized);
      }
    }
    if (cb.setActiveClipId) {
      cb.setActiveClipId(ep.activeClipId || null);
    }
    if (cb.setSelectedSegmentId) {
      cb.setSelectedSegmentId(ep.selectedSegmentId || null);
    }
    if (cb.setRenderedVideo) {
      cb.setRenderedVideo(sanitizeRenderedVideo(ep.renderedVideo));
    }
    if (cb.setVoiceSettings) {
      cb.setVoiceSettings((prev) =>
        resolveStickyVoiceSettings({
          prevSettings: prev,
          savedGlobalSettings: loadSavedVoiceSettings(),
          episodeVoiceSettings: ep.voiceSettings || null,
        })
      );
    }
    if (cb.setMediaAssets) {
      if (ep.video) {
        cb.setMediaAssets([
          {
            id: `asset-${ep.id}-${Date.now()}`,
            videoId: ep.video.videoId,
            videoUrl: ep.video.videoUrl,
            fileName: ep.video.originalFilename || ep.video.fileName,
            originalFilename: ep.video.originalFilename || ep.video.fileName,
            displayTitle: ep.video.displayTitle || ep.displayTitle || (ep.video.fileName ? ep.video.fileName.replace(/\.[^/.]+$/, '').trim() : ''),
            size: ep.video.size,
            durationSec: ep.duration || ep.metadata?.durationSec || 0,
            resolution: ep.metadata?.resolution,
          },
        ]);
      } else {
        cb.setMediaAssets([]);
      }
    }
    if (cb.setVideoThumbnails) {
      if (ep.video?.videoId || ep.video?.videoUrl) {
        const vidRef = ep.video.videoId || ep.video.videoUrl;
        const dur = ep.duration || 30;
        fetchVideoThumbnails(vidRef, dur).then((serverThumbs) => {
          if (Array.isArray(serverThumbs) && serverThumbs.length > 0) {
            cb.setVideoThumbnails(serverThumbs);
          } else if (ep.video?.videoUrl) {
            generateVideoThumbnails(ep.video.videoUrl, dur).then(cb.setVideoThumbnails);
          }
        });
      } else {
        cb.setVideoThumbnails([]);
      }
    }
    if (cb.clearHistory) {
      cb.clearHistory();
    }
    // Auto-align left workflow tab to the episode's actual stage:
    // If episode has no video yet, automatically open Step 1 (media) so user can import video directly!
    if (cb.setLeftTab) {
      if (!ep.video?.videoId && !ep.video?.videoUrl) {
        cb.setLeftTab('media');
      } else if (ep.scriptData?.segments?.length > 0) {
        cb.setLeftTab('subtitles');
      } else {
        cb.setLeftTab('script');
      }
    }
  }, []);

  // Sync state on initial mount (runs once on mount)
  useEffect(() => {
    let cancelled = false;
    const storedSeriesId = getActiveSeriesId();
    const storedEpisodeId = getActiveEpisodeId();
    const { seriesList: sList, series, episode } = loadActiveSeriesAndEpisode();
    setSeriesList(sList);
    setActiveSeriesIdState(series.id);
    setActiveEpisodeIdState(episode.id);
    activeEpisodeIdRef.current = episode.id;

    // Apply initial episode state to workspace
    if (episode) {
      applyEpisodeToWorkspace(episode);
    }

    const markInitialized = () => {
      if (!cancelled && !isInitializedRef.current) {
        isInitializedRef.current = true;
      }
    };

    // Safety fallback so initialization never stalls indefinitely if backend is offline
    const fallbackTimer = setTimeout(markInitialized, 1500);

    // Server-truth hydration: sync latest series and episodes from server
    fetch('/api/series')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.success && Array.isArray(data.series) && data.series.length > 0) {
          const serverList = sanitizeAndHealSeriesList(data.series);
          const resolvedSeriesId = storedSeriesId || series?.id;
          const targetSeries = serverList.find((s) => s.id === resolvedSeriesId) || serverList[0];
          const userMovedOffInitial = activeEpisodeIdRef.current && activeEpisodeIdRef.current !== episode?.id;
          const preferredEpId = userMovedOffInitial
            ? activeEpisodeIdRef.current
            : (storedEpisodeId || episode?.id);
          const targetEp = targetSeries
            ? ((targetSeries.episodes || []).find((e) => e.id === preferredEpId) || targetSeries.episodes?.[0])
            : null;

          if (targetSeries) {
            setActiveSeriesId(targetSeries.id);
            setActiveSeriesIdState(targetSeries.id);
          }
          if (targetEp) {
            setActiveEpisodeId(targetEp.id);
            setActiveEpisodeIdState(targetEp.id);
            activeEpisodeIdRef.current = targetEp.id;
          }

          setSeriesList(serverList);
          try {
            saveSeriesList(serverList);
          } catch (_) {}

          if (targetEp) {
            applyEpisodeToWorkspace(targetEp);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(fallbackTimer);
        if (!cancelled) {
          setTimeout(markInitialized, 120);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
  }, [applyEpisodeToWorkspace]);

  // Extract current workspace snapshot for saving
  const getCurrentWorkspaceSnapshot = useCallback(() => {
    return {
      video: selectedVideo ? {
        videoId: selectedVideo.videoId,
        fileName: selectedVideo.originalFilename || selectedVideo.fileName,
        originalFilename: selectedVideo.originalFilename || selectedVideo.fileName,
        displayTitle: selectedVideo.displayTitle || (selectedVideo.fileName ? selectedVideo.fileName.replace(/\.[^/.]+$/, '').trim() : ''),
        storageFilename: selectedVideo.storageFilename,
        videoUrl: selectedVideo.videoUrl,
        videoPath: selectedVideo.videoPath,
        width: selectedVideo.width || videoMetadata?.width,
        height: selectedVideo.height || videoMetadata?.height,
        resolution: selectedVideo.resolution || videoMetadata?.resolution,
        size: selectedVideo.size,
        sizeBytes: selectedVideo.sizeBytes,
      } : null,
      metadata: videoMetadata || (selectedVideo?.width ? {
        width: selectedVideo.width,
        height: selectedVideo.height,
        resolution: selectedVideo.resolution,
        duration: duration || selectedVideo.durationSec,
        durationSec: duration || selectedVideo.durationSec,
      } : null),
      scriptData,
      speakerRegistry,
      audioGenerated,
      audioOutdated,
      fullAudioPath,
      fullAudioUrl,
      duration,
      videoClips,
      activeClipId,
      selectedSegmentId,
      renderedVideo,
      voiceSettings,
    };
  }, [
    selectedVideo,
    videoMetadata,
    scriptData,
    speakerRegistry,
    audioGenerated,
    audioOutdated,
    fullAudioPath,
    fullAudioUrl,
    duration,
    videoClips,
    activeClipId,
    selectedSegmentId,
    renderedVideo,
    voiceSettings,
  ]);

  // Auto-persist active episode state to localStorage whenever changes occur (debounced)
  useEffect(() => {
    // Guard against running auto-persist before initial workspace restore is complete
    if (!isInitializedRef.current) return;
    if (isTransitioningRef.current) return;
    if (!activeSeriesIdState || !activeEpisodeIdState) return;
    const timer = setTimeout(() => {
      if (isTransitioningRef.current) return;
      const snapshot = getCurrentWorkspaceSnapshot();
      saveEpisodeState(activeSeriesIdState, activeEpisodeIdState, snapshot);
    }, 400);
    return () => clearTimeout(timer);
  }, [
    activeSeriesIdState,
    activeEpisodeIdState,
    selectedVideo,
    videoMetadata,
    scriptData,
    speakerRegistry,
    audioGenerated,
    audioOutdated,
    fullAudioPath,
    fullAudioUrl,
    duration,
    videoClips,
    activeClipId,
    selectedSegmentId,
    renderedVideo,
    voiceSettings,
    getCurrentWorkspaceSnapshot,
  ]);

  // 1. Switch to another episode safely (Auto-save current episode first)
  const handleSwitchEpisode = useCallback(async (targetEpisodeId) => {
    if (!targetEpisodeId) return;

    const currentSeriesInMem = seriesList.find((s) => s.id === activeSeriesIdState);
    const targetInMem = (currentSeriesInMem?.episodes || []).find((e) => e.id === targetEpisodeId);
    const targetMemSegCount = Array.isArray(targetInMem?.scriptData?.segments) ? targetInMem.scriptData.segments.length : 0;
    const activeWorkspaceSegCount = Array.isArray(scriptData?.segments) ? scriptData.segments.length : 0;
    const targetMemUpdatedAt = Number(targetInMem?.scriptData?.updatedAt || 0);
    const activeWorkspaceUpdatedAt = Number(scriptData?.updatedAt || 0);

    if (
      targetEpisodeId === activeEpisodeIdRef.current &&
      targetMemSegCount === activeWorkspaceSegCount &&
      targetMemUpdatedAt === activeWorkspaceUpdatedAt &&
      (targetMemSegCount > 0 || activeWorkspaceSegCount > 0)
    ) {
      return;
    }

    isTransitioningRef.current = true;
    try {
      const prevEpisodeId = activeEpisodeIdRef.current;
      // 1. Save previous episode if actually switching away from it
      const snapshot = getCurrentWorkspaceSnapshot();
      if (prevEpisodeId && prevEpisodeId !== targetEpisodeId) {
        saveEpisodeState(activeSeriesIdState, prevEpisodeId, snapshot);
      }

      // 2. Allow active in-flight AI requests to complete in background.
      if (activeRequestRef?.current) {
        activeRequestRef.current.activeEpisodeId = targetEpisodeId;
      }

      // 3. Set active episode pointer immediately
      setActiveEpisodeId(targetEpisodeId);
      setActiveEpisodeIdState(targetEpisodeId);
      activeEpisodeIdRef.current = targetEpisodeId;

      // 4. Find target episode from current memory state or storage
      let currentSeries = currentSeriesInMem;
      if (!currentSeries) {
        const currentList = loadSeriesList();
        currentSeries = currentList.find((s) => s.id === activeSeriesIdState) || currentList[0];
      }
      const targetEp = (currentSeries?.episodes || []).find((e) => e.id === targetEpisodeId);

      // Apply immediate local state first for instant responsiveness
      if (targetEp) {
        applyEpisodeToWorkspace(targetEp);
      }

      // 5. Server-truth Hydration: always confirm latest episode state from backend series.json
      try {
        const res = await fetch(`/api/series/${activeSeriesIdState}`);
        const data = await res.json();
        if (activeEpisodeIdRef.current !== targetEpisodeId) return;
        if (data?.success && data.series) {
          setSeriesList((prevList) => {
            const exists = (prevList || []).some((s) => s.id === data.series.id);
            const updated = exists
              ? (prevList || []).map((s) => (s.id === data.series.id ? data.series : s))
              : [...(prevList || []), data.series];
            try {
              saveSeriesList(updated);
            } catch (_) {}
            return updated;
          });
          const hydratedEp = (data.series.episodes || []).find((e) => e.id === targetEpisodeId);
          const hydratedSegLen = Array.isArray(hydratedEp?.scriptData?.segments) ? hydratedEp.scriptData.segments.length : 0;
          const localSegLen = Array.isArray(targetEp?.scriptData?.segments) ? targetEp.scriptData.segments.length : 0;
          const hydratedUpdatedAt = Number(hydratedEp?.scriptData?.updatedAt || 0);
          const localUpdatedAt = Number(targetEp?.scriptData?.updatedAt || 0);
          const localHasNewerScript =
            localSegLen > 0 && localUpdatedAt > hydratedUpdatedAt && hydratedUpdatedAt > 0;
          const hydratedRv = sanitizeRenderedVideo(hydratedEp?.renderedVideo);
          const localRv = sanitizeRenderedVideo(targetEp?.renderedVideo);
          const hydratedRvUrl = typeof hydratedRv === 'string' ? hydratedRv : (hydratedRv?.outputVideoUrl || hydratedRv?.videoUrl || null);
          const localRvUrl = typeof localRv === 'string' ? localRv : (localRv?.outputVideoUrl || localRv?.videoUrl || null);
          const audioOrBgmChanged = Boolean(
            Boolean(hydratedEp?.audioGenerated) !== Boolean(targetEp?.audioGenerated) ||
            Boolean(hydratedEp?.audioOutdated) !== Boolean(targetEp?.audioOutdated) ||
            (hydratedEp?.fullAudioUrl || null) !== (targetEp?.fullAudioUrl || null) ||
            hydratedRvUrl !== localRvUrl ||
            (hydratedEp?.bgmAudioUrl && hydratedEp.bgmAudioUrl !== targetEp?.bgmAudioUrl)
          );
          if (
            hydratedEp &&
            !localHasNewerScript &&
            (hydratedSegLen > 0 || localSegLen === 0 || audioOrBgmChanged) &&
            (hydratedSegLen !== localSegLen || hydratedUpdatedAt !== localUpdatedAt || localSegLen === 0 || audioOrBgmChanged)
          ) {
            applyEpisodeToWorkspace(hydratedEp);
          }
        }
      } catch (_) {}
      console.log(`[SeriesManager] Switched from ${snapshot.video?.fileName || 'empty'} to ${targetEp?.title || targetEpisodeId} (${targetEpisodeId})`);
    } finally {
      setTimeout(() => {
        if (activeEpisodeIdRef.current === targetEpisodeId) {
          isTransitioningRef.current = false;
        }
      }, 100);
    }
  }, [
    activeSeriesIdState,
    seriesList,
    scriptData,
    getCurrentWorkspaceSnapshot,
    activeRequestRef,
    applyEpisodeToWorkspace,
  ]);

  // 2. Create and switch to a new episode
  const handleCreateEpisode = useCallback((customTitle = null) => {
    const safeTitle = (typeof customTitle === 'string' && customTitle.trim()) ? customTitle.trim() : null;
    // 1. Save current episode
    const snapshot = getCurrentWorkspaceSnapshot();
    saveEpisodeState(activeSeriesIdState, activeEpisodeIdRef.current, snapshot);

    // 2. Add new episode to series
    const newEp = addNewEpisodeToSeries(activeSeriesIdState, safeTitle);
    if (!newEp) return null;

    // 3. Preserve in-memory segments on sibling episodes while adding newEp
    setSeriesList((prevList) => {
      if (!Array.isArray(prevList) || prevList.length === 0) return loadSeriesList();
      return prevList.map((s) =>
        s.id === activeSeriesIdState ? { ...s, episodes: [...(s.episodes || []), newEp] } : s
      );
    });
    setActiveEpisodeId(newEp.id);
    setActiveEpisodeIdState(newEp.id);
    activeEpisodeIdRef.current = newEp.id;

    // 4. Apply clean episode state
    applyEpisodeToWorkspace(newEp);
    return newEp;
  }, [
    activeSeriesIdState,
    getCurrentWorkspaceSnapshot,
    applyEpisodeToWorkspace,
  ]);

  // 3. Delete an episode
  const handleDeleteEpisode = useCallback(async (targetEpisodeId) => {
    isTransitioningRef.current = true;
    const isDeletingActive = String(targetEpisodeId) === String(activeEpisodeIdRef.current);

    const success = deleteEpisodeFromSeries(activeSeriesIdState, targetEpisodeId);
    if (!success) {
      isTransitioningRef.current = false;
      return;
    }

    const updatedList = loadSeriesList();
    setSeriesList(updatedList);

    const activeEpId = getActiveEpisodeId();
    setActiveEpisodeIdState(activeEpId);
    activeEpisodeIdRef.current = activeEpId;

    const s = updatedList.find((item) => item.id === activeSeriesIdState) || updatedList[0];
    const newActiveEp = (s?.episodes || []).find((e) => e.id === activeEpId) || s?.episodes?.[0];

    // If deleting active episode or target has no video, clear workspace media immediately
    if (isDeletingActive || !newActiveEp?.video) {
      if (callbacksRef.current.handleClearVideo) {
        callbacksRef.current.handleClearVideo();
      }
    }

    if (newActiveEp) {
      applyEpisodeToWorkspace(newActiveEp);
    }

    // Sync with backend API
    try {
      await fetch(`/api/series/${activeSeriesIdState}/episodes/${targetEpisodeId}`, {
        method: 'DELETE',
      });
      const res = await fetch(`/api/series/${activeSeriesIdState}`);
      const data = await res.json();
      if (data?.success && data.series) {
        setSeriesList((prevList) =>
          (prevList || []).map((ser) => (ser.id === data.series.id ? data.series : ser))
        );
      }
    } catch (_) {}

    setTimeout(() => {
      isTransitioningRef.current = false;
    }, 400);
  }, [activeSeriesIdState, applyEpisodeToWorkspace]);

  // 4. Rename an episode
  const handleRenameEpisode = useCallback((targetEpisodeId, newTitle) => {
    if (!targetEpisodeId || !newTitle) return;
    const list = loadSeriesList();
    const sIdx = list.findIndex((s) => s.id === activeSeriesIdState);
    if (sIdx !== -1) {
      const eIdx = (list[sIdx].episodes || []).findIndex((e) => e.id === targetEpisodeId);
      if (eIdx !== -1) {
        list[sIdx].episodes[eIdx].title = newTitle;
        saveSeriesList(list);
      }
    }
    setSeriesList((prevList) =>
      (prevList || []).map((s) =>
        s.id === activeSeriesIdState
          ? {
              ...s,
              episodes: (s.episodes || []).map((e) =>
                e.id === targetEpisodeId ? { ...e, title: newTitle } : e
              ),
            }
          : s
      )
    );
  }, [activeSeriesIdState]);

  // 5. Rename Series
  const handleRenameSeries = useCallback((newTitle) => {
    if (!newTitle) return;
    updateSeriesTitle(activeSeriesIdState, newTitle);
    setSeriesList((prevList) =>
      (prevList || []).map((s) =>
        s.id === activeSeriesIdState ? { ...s, title: newTitle } : s
      )
    );
  }, [activeSeriesIdState]);

  // 6. Save background results (e.g. if user switched to EP2 while EP1 was generating)
  const handleSaveEpisodeBackground = useCallback((targetEpisodeId, partialData) => {
    if (!targetEpisodeId || !partialData) return;
    const list = loadSeriesList();
    const sIdx = list.findIndex((s) => s.id === activeSeriesIdState);
    if (sIdx !== -1) {
      const eIdx = (list[sIdx].episodes || []).findIndex((e) => e.id === targetEpisodeId);
      if (eIdx !== -1) {
        list[sIdx].episodes[eIdx] = {
          ...list[sIdx].episodes[eIdx],
          ...partialData,
          lastModified: Date.now(),
        };
        saveSeriesList(list);
      }
    }
    setSeriesList((prevList) =>
      (prevList || []).map((s) =>
        s.id === activeSeriesIdState
          ? {
              ...s,
              episodes: (s.episodes || []).map((e) =>
                e.id === targetEpisodeId
                  ? { ...e, ...partialData, lastModified: Date.now() }
                  : e
              ),
            }
          : s
      )
    );

    // If currently active is this episode, also update workspace
    if (activeEpisodeIdRef.current === targetEpisodeId) {
      if (partialData.scriptData && setScriptData) setScriptData(sanitizeScriptData(partialData.scriptData));
      if (partialData.speakerRegistry && setSpeakerRegistry) setSpeakerRegistry(partialData.speakerRegistry);
      if (partialData.audioGenerated !== undefined && setAudioGenerated) setAudioGenerated(partialData.audioGenerated);
      if (partialData.fullAudioUrl && setFullAudioUrl) setFullAudioUrl(partialData.fullAudioUrl);
      if (partialData.fullAudioPath && setFullAudioPath) setFullAudioPath(partialData.fullAudioPath);
    }
  }, [activeSeriesIdState, setScriptData, setSpeakerRegistry, setAudioGenerated, setFullAudioUrl, setFullAudioPath]);

  // 7. Reset all episodes back to a single fresh clean episode (Instant 1-click execution)
  const handleResetAllEpisodes = useCallback(() => {
    const freshSeries = createDefaultSeries('រឿងភាគ');
    saveSeriesList([freshSeries]);
    setSeriesList([freshSeries]);
    setActiveSeriesId(freshSeries.id);
    setActiveEpisodeId(freshSeries.episodes[0].id);
    setActiveSeriesIdState(freshSeries.id);
    setActiveEpisodeIdState(freshSeries.episodes[0].id);
    activeEpisodeIdRef.current = freshSeries.episodes[0].id;
    applyEpisodeToWorkspace(freshSeries.episodes[0]);
  }, [applyEpisodeToWorkspace]);

  // 8. Server-truth sync: manual or triggered refresh from backend disk
  const refreshSeriesFromServer = useCallback(async () => {
    if (!activeSeriesIdState) return;
    try {
      const res = await fetch(`/api/series/${activeSeriesIdState}`);
      const data = await res.json();
      if (data?.success && data.series) {
        const [healedSeries] = sanitizeAndHealSeriesList([data.series]) || [data.series];
        const prevSeries = (latestSeriesListRef.current || []).find((s) => s.id === healedSeries.id);
        const prevActiveEp = (prevSeries?.episodes || []).find((e) => e.id === activeEpisodeIdRef.current);
        const prevSegLen = Array.isArray(prevActiveEp?.scriptData?.segments) ? prevActiveEp.scriptData.segments.length : 0;
        const prevUpdatedAt = Number(prevActiveEp?.scriptData?.updatedAt || 0);
        const workspaceSegLen = Array.isArray(latestScriptDataRef.current?.segments) ? latestScriptDataRef.current.segments.length : 0;
        const workspaceUpdatedAt = Number(latestScriptDataRef.current?.updatedAt || 0);

        setSeriesList((prevList) => {
          const listToUpdate = Array.isArray(prevList) && prevList.length > 0 ? prevList : [healedSeries];
          const exists = listToUpdate.some((s) => s.id === healedSeries.id);
          const updated = exists
            ? listToUpdate.map((s) => (s.id === healedSeries.id ? healedSeries : s))
            : [...listToUpdate, healedSeries];
          try {
            saveSeriesList(updated);
          } catch (_) {}
          return updated;
        });

        const currentActiveEp = (healedSeries.episodes || []).find((e) => e.id === activeEpisodeIdRef.current);
        const nextSegLen = Array.isArray(currentActiveEp?.scriptData?.segments) ? currentActiveEp.scriptData.segments.length : 0;
        const nextUpdatedAt = Number(currentActiveEp?.scriptData?.updatedAt || 0);
        const serverOlderThanWorkspace =
          workspaceUpdatedAt > nextUpdatedAt && nextUpdatedAt > 0 && workspaceSegLen > 0;
        const serverRv = sanitizeRenderedVideo(currentActiveEp?.renderedVideo);
        const prevRv = sanitizeRenderedVideo(prevActiveEp?.renderedVideo);
        const serverRvUrl = typeof serverRv === 'string' ? serverRv : (serverRv?.outputVideoUrl || serverRv?.videoUrl || null);
        const prevRvUrl = typeof prevRv === 'string' ? prevRv : (prevRv?.outputVideoUrl || prevRv?.videoUrl || null);
        const videoChanged = Boolean(
          currentActiveEp && (
            (currentActiveEp.video?.videoId || null) !== (prevActiveEp?.video?.videoId || null) ||
            (currentActiveEp.video?.videoUrl || null) !== (prevActiveEp?.video?.videoUrl || null) ||
            (currentActiveEp.videoFile || null) !== (prevActiveEp?.videoFile || null) ||
            (currentActiveEp.sourceVideoPath || null) !== (prevActiveEp?.sourceVideoPath || null) ||
            (currentActiveEp.duration && prevActiveEp?.duration && Math.abs(currentActiveEp.duration - prevActiveEp.duration) > 1)
          )
        );
        const audioOrBgmChanged = Boolean(
          currentActiveEp && (
            Boolean(currentActiveEp.audioGenerated) !== Boolean(prevActiveEp?.audioGenerated) ||
            Boolean(currentActiveEp.audioOutdated) !== Boolean(prevActiveEp?.audioOutdated) ||
            (currentActiveEp.fullAudioUrl || null) !== (prevActiveEp?.fullAudioUrl || null) ||
            serverRvUrl !== prevRvUrl ||
            (currentActiveEp.bgmAudioUrl && currentActiveEp.bgmAudioUrl !== prevActiveEp?.bgmAudioUrl)
          )
        );
        if (
          currentActiveEp &&
          !serverOlderThanWorkspace &&
          (nextSegLen > 0 || audioOrBgmChanged || videoChanged) &&
          (workspaceSegLen === 0 || nextSegLen !== prevSegLen || nextUpdatedAt > prevUpdatedAt || audioOrBgmChanged || videoChanged)
        ) {
          applyEpisodeToWorkspace(currentActiveEp);
        }
      }
    } catch (_) {}
  }, [activeSeriesIdState, applyEpisodeToWorkspace]);

  // Get series glossary (characters and terms from EP1 or entire series)
  const seriesGlossary = activeSeries?.glossary || { characters: [], terms: [] };

  return {
    seriesList,
    activeSeries,
    activeEpisode,
    seriesId: activeSeriesIdState,
    episodeId: activeEpisodeIdState,
    seriesGlossary,
    refreshSeriesFromServer,
    handleSwitchEpisode,
    handleCreateEpisode,
    handleDeleteEpisode,
    handleResetAllEpisodes,
    handleRenameEpisode,
    handleRenameSeries,
    handleSaveEpisodeBackground,
    getCurrentWorkspaceSnapshot,
  };
}
