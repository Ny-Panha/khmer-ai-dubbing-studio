import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import {
  loadSeriesList,
  saveSeriesList,
  getActiveSeriesId,
  setActiveSeriesId,
  getActiveEpisodeId,
  setActiveEpisodeId,
  getActiveEpisodeIdForSeries,
  setActiveEpisodeIdForSeries,
  loadActiveSeriesAndEpisode,
  saveEpisodeState,
  addNewEpisodeToSeries,
  deleteEpisodeFromSeries,
  deleteSeriesFromList,
  updateSeriesTitle,
  extractGlossaryFromEpisode,
  createDefaultEpisode,
  createDefaultSeries,
  loadSavedVoiceSettings,
  resolveStickyVoiceSettings,
  sanitizeRenderedVideo,
  isRenderedYoutubeTransformMismatch,
  normalizeVideoEditSettings,
  resolveEffectiveVideoEditSettings,
  applyVideoEditSettingsToSeriesList,
  saveGlobalVideoEditSettings,
  sanitizeAndHealSeriesList,
  flushAllPendingTimelinePersists,
  restorePendingEpisodeSyncs,
} from '../utils/projectStorage';
import { stripLogoSettings } from '../utils/logoSettingsStorage';
import { generateVideoThumbnails } from '../utils/thumbnailUtils';
import { fetchVideoThumbnails, deleteSeriesApi, renameSeriesApi, applyScopedVideoEditSettingsApi } from '../services/api';
import { normalizeClips, sanitizeScriptData } from '../utils/timelineUtils';
import { loadEpisodeTimelineViewState } from '../utils/timelineViewState';
import { applySpeakerVoiceToSegments } from '../utils/speakerUtils';
import { prefetchEpisodeWaveformPeaks } from '../utils/waveformCache';
import { prefetchSourceProxyStatus } from './useSourceProxy';

function prepareEpisode(ep, targetSeries) {
  const seriesSpeakerMap = {};
  const isIgnoredEntry = (name, id) => {
    const nm = String(name || '').trim().toLowerCase();
    const sid = String(id || '').trim();
    if (!nm || nm === 'តួអង្គ' || nm === 'unknown' || nm === 'speaker' || /^speaker[\s_-]*\d+$/i.test(nm)) return true;
    if (/^spk_(?:ocr|review|generic|unknown)_\d+$/i.test(sid) || /^spk_\d+$/i.test(sid)) return true;
    return false;
  };
  if (targetSeries?.seriesSpeakerMap && typeof targetSeries.seriesSpeakerMap === 'object') {
    Object.values(targetSeries.seriesSpeakerMap).forEach((c) => {
      if (!c) return;
      const key = c.speakerId || c.id || c.name;
      const cName = c.khmerName || c.name || c.speakerName || '';
      if (key && !isIgnoredEntry(cName, key) && (c.voiceId || c.khmerVoiceId)) {
        seriesSpeakerMap[key] = c;
      }
    });
  }
  if (Array.isArray(targetSeries?.glossary?.characters)) {
    targetSeries.glossary.characters.forEach((c) => {
      const key = c.id || c.speakerId || c.name;
      const cName = c.khmerName || c.name || '';
      if (key && !isIgnoredEntry(cName, key) && (c.voiceId || c.khmerVoiceId) && !seriesSpeakerMap[key]) {
        const isFemale = (c.gender === 'female' || c.gender === 'FEMALE');
        const isMale = (c.gender === 'male' || c.gender === 'MALE');
        seriesSpeakerMap[key] = {
          id: key,
          speakerId: key,
          characterId: c.characterId || null,
          speakerName: cName || key,
          name: cName || key,
          gender: isFemale ? 'FEMALE' : (isMale ? 'MALE' : 'UNKNOWN'),
          voiceGender: isFemale ? 'female' : (isMale ? 'male' : 'unknown'),
          voiceId: c.voiceId || c.khmerVoiceId,
          khmerVoiceId: c.khmerVoiceId || c.voiceId,
          voiceAssignmentSource: c.voiceAssignmentSource || 'series_glossary',
          userOverridden: Boolean(c.userOverridden),
          manualCharacterOverridden: Boolean(c.manualCharacterOverridden),
        };
      }
    });
  }
  const activeRegistry = {
    ...seriesSpeakerMap,
    ...(ep.speakerRegistry || {}),
  };
  const script = sanitizeScriptData(ep.scriptData);
  if (script?.segments && Object.keys(activeRegistry).length) {
    script.segments = applySpeakerVoiceToSegments(script.segments, activeRegistry);
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
  const existingClips = Array.isArray(ep.videoClips) ? ep.videoClips : [];
  let preparedClips;
  if (existingClips.length === 0 && ep.video && epDur > 0) {
    preparedClips = [
      {
        id: `clip-${ep.id || 'ep'}-full`,
        trackId: 'video-1',
        trackRow: 0,
        start: 0,
        end: epDur,
        sourceStart: 0,
        sourceEnd: epDur,
        duration: epDur,
        name: ep.video.originalFilename || ep.video.fileName || 'Full Video',
        videoUrl: ep.video.videoUrl || ep.videoFile || null,
        videoId: ep.video.videoId,
      },
    ];
  } else {
    const normalized = normalizeClips(existingClips, epDur);
    if (normalized.length === 1 && normalized[0].start === 0 && epDur > 15 && normalized[0].end < epDur - 2) {
      normalized[0].end = epDur;
      normalized[0].sourceEnd = epDur;
      normalized[0].duration = epDur;
    }
    preparedClips = normalized;
  }
  return { episode: ep, script, registry: activeRegistry, epDur, clips: preparedClips };
}

const episodeEtags = new WeakMap();

async function fetchEpisode(seriesId, episodeId, signal, priority, previous) {
  const url = `/api/series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(episodeId)}`;
  const etag = previous && episodeEtags.get(previous);
  const res = await fetch(url, {
    signal, priority, cache: 'no-store',
    headers: etag ? { 'If-None-Match': etag } : undefined,
  });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`Failed to load episode (${res.status})`);
  const { episode } = await res.json();
  if (episode && res.headers.get('ETag')) episodeEtags.set(episode, res.headers.get('ETag'));
  return episode;
}

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
  videoClipsUpdatedAt,
  setVideoClipsUpdatedAt,
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

  // Reference to current active series/episode IDs to prevent stale closures in async effects
  const activeSeriesIdRef = useRef(activeSeriesIdState);
  activeSeriesIdRef.current = activeSeriesIdState;
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
  const switchSeriesSeqRef = useRef(0);
  const lastVideoEditMutationAtRef = useRef(0);

  const episodeRequest = useRef(null);
  const compactEpisodes = useRef(new WeakSet());
  const workspaces = useRef(new Map());
  const thumbnails = useRef(new Map());
  const thumbnailRequest = useRef(null);
  const workspaceBaseline = useRef(null);
  const lastSavedSnapshot = useRef(null);
  const currentSnapshot = useRef(null);
  const readWorkspace = useCallback((series, record, fullEpisode = null) => {
    const revision = [record.lastModified, record.scriptData?.updatedAt, record.videoClipsUpdatedAt];
    const key = JSON.stringify([series?.id, record.id, ...revision]);
    const cache = workspaces.current;
    let entry = cache.get(key);
    if (!entry || entry.record !== record || entry.glossary !== series?.glossary || fullEpisode) {
      entry = { ...prepareEpisode(fullEpisode || record, series), record, glossary: series?.glossary,
        complete: Boolean(fullEpisode || (!compactEpisodes.current.has(record) && !(record.scriptData?.totalSegments > (record.scriptData?.segments?.length || 0)))) };
    }
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    return entry;
  }, []);

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
    setVideoClipsUpdatedAt,
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
  const applyEpisodeToWorkspace = useCallback((ep, explicitSeriesId = null, options = {}) => {
    if (!ep) return;
    workspaceBaseline.current = null;
    thumbnailRequest.current?.abort();
    const controller = new AbortController();
    thumbnailRequest.current = controller;
    const cb = callbacksRef.current;
    const resolvedSeriesId = explicitSeriesId || activeSeriesIdRef.current || getActiveSeriesId();

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
        const emptySeries = latestSeriesListRef.current.find((s) => s.id === resolvedSeriesId);
        const resolvedVe = resolveEffectiveVideoEditSettings({ episode: ep, series: emptySeries });
        cb.setVoiceSettings((prev) =>
          resolveStickyVoiceSettings({
            prevSettings: prev,
            savedGlobalSettings: loadSavedVoiceSettings(),
            episodeVoiceSettings: null,
            resolvedVideoEditSettings: resolvedVe,
          })
        );
      }
      return;
    }

    if (cb.setSelectedVideo) {
      const resolvedVid = ep.video ? {
        ...ep.video,
        videoUrl: ep.video.videoUrl || ep.videoFile || (ep.video.videoId ? (ep.video.videoId.startsWith('/') ? ep.video.videoId : `/uploads/${ep.video.videoId}`) : null),
      } : (ep.videoFile ? {
        videoId: ep.id,
        fileName: ep.originalFilename || ep.title,
        videoUrl: ep.videoFile,
        videoPath: ep.sourceVideoPath,
      } : null);
      cb.setSelectedVideo(resolvedVid);
    }
    if (cb.setVideoMetadata) {
      cb.setVideoMetadata(ep.metadata || null);
    }
    const series = latestSeriesListRef.current.find((s) => s.id === resolvedSeriesId);
    const workspace = options.prepared || readWorkspace(series, ep);
    cb.setSpeakerRegistry?.(workspace.registry);
    cb.setScriptData?.(workspace.script || null);
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
    const epDur = workspace.epDur ?? (ep.duration || 0);

    if (cb.setDuration) {
      cb.setDuration(epDur || ep.duration || 0);
    }
    if (cb.setCurrentTime) {
      // Restore persisted per-episode playhead time from localStorage (never from series.json)
      const savedView = loadEpisodeTimelineViewState(resolvedSeriesId, ep.id);
      const rawSavedTime = savedView && Number.isFinite(savedView.playheadSec) ? savedView.playheadSec : 0;
      const restoredTime = rawSavedTime > 0
        ? (epDur > 0 ? Math.min(rawSavedTime, epDur) : rawSavedTime)
        : 0;
      cb.setCurrentTime(parseFloat(restoredTime.toFixed(2)));
    }
    if (cb.setVideoClips) {
      cb.setVideoClips(workspace.clips || []);
    }
    if (cb.setVideoClipsUpdatedAt) {
      cb.setVideoClipsUpdatedAt(Number(ep.videoClipsUpdatedAt || 0));
    }
    if (cb.setActiveClipId) {
      cb.setActiveClipId(ep.activeClipId || null);
    }
    if (cb.setSelectedSegmentId) {
      cb.setSelectedSegmentId(ep.selectedSegmentId || null);
    }
    const resolvedVe = resolveEffectiveVideoEditSettings({ episode: ep, series });
    if (cb.setRenderedVideo) {
      const cleanRv = sanitizeRenderedVideo(ep.renderedVideo);
      cb.setRenderedVideo(
        cleanRv && isRenderedYoutubeTransformMismatch(cleanRv, resolvedVe) ? null : cleanRv
      );
    }
    if (cb.setVoiceSettings) {
      cb.setVoiceSettings((prev) =>
        resolveStickyVoiceSettings({
          prevSettings: prev,
          savedGlobalSettings: loadSavedVoiceSettings(),
          episodeVoiceSettings: ep.voiceSettings || null,
          resolvedVideoEditSettings: resolvedVe,
        })
      );
    }
    if (cb.setMediaAssets) {
      if (ep.video) {
        cb.setMediaAssets([
          {
            id: `asset-${ep.id}`,
            videoId: ep.video.videoId,
            videoUrl: ep.video.videoUrl || ep.videoFile || null,
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
      const resolvedVidUrl = ep.video.videoUrl || ep.videoFile || (ep.video.videoId ? (ep.video.videoId.startsWith('/') ? ep.video.videoId : `/uploads/${ep.video.videoId}`) : null);
      const vidRef = ep.video.videoId || resolvedVidUrl;
      const dur = ep.duration || 30;
      const key = JSON.stringify([resolvedSeriesId, ep.id, vidRef, resolvedVidUrl, dur]);
      const cached = thumbnails.current.get(key);
      cb.setVideoThumbnails(cached || []);
      if (vidRef && !cached) {
        const timer = setTimeout(async () => {
          let result = await fetchVideoThumbnails(vidRef, dur, controller.signal);
          if (controller.signal.aborted) return;
          if (!result?.length && resolvedVidUrl) {
            result = await generateVideoThumbnails(resolvedVidUrl, dur, null, controller.signal);
          }
          if (!controller.signal.aborted && result?.length) {
            thumbnails.current.set(key, result);
            if (thumbnails.current.size > 6) thumbnails.current.delete(thumbnails.current.keys().next().value);
            cb.setVideoThumbnails(result);
          }
        }, 350);
        controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
      }
    }
    if (cb.clearHistory) {
      cb.clearHistory();
    }
    // Auto-align left workflow tab to the episode's actual stage:
    // If episode has no video yet, automatically open Step 1 (media) so user can import video directly!
    if (cb.setLeftTab && !options.preserveTab) {
      if (!ep.video?.videoId && !ep.video?.videoUrl) {
        cb.setLeftTab('media');
      } else if (ep.scriptData?.segments?.length > 0) {
        cb.setLeftTab('subtitles');
      } else {
        cb.setLeftTab('script');
      }
    }
  }, [readWorkspace]);

  // Sync state on initial mount (runs once on mount)
  useEffect(() => {
    let cancelled = false;
    const storedSeriesId = getActiveSeriesId();
    const storedEpisodeId = getActiveEpisodeId();
    const { seriesList: sList, series, episode } = loadActiveSeriesAndEpisode();
    for (const local of sList) {
      for (const ep of local.episodes || []) compactEpisodes.current.add(ep);
    }
    const initialSequence = switchSeriesSeqRef.current;
    setSeriesList(sList);
    setActiveSeriesIdState(series.id);
    setActiveEpisodeIdState(episode.id);
    activeEpisodeIdRef.current = episode.id;

    // Apply initial episode state to workspace
    if (episode) {
      activeSeriesIdRef.current = series?.id || activeSeriesIdRef.current;
      applyEpisodeToWorkspace(episode, series?.id);
    }

    const markInitialized = () => {
      if (!cancelled && !isInitializedRef.current) {
        isInitializedRef.current = true;
      }
    };

    // Safety fallback so initialization never stalls indefinitely if backend is offline
    const fallbackTimer = setTimeout(markInitialized, 1500);

    // Flush any pending recovered timeline writes from a previous session or sudden reload
    // Recover captured edits before the initial server read so reload displays the persisted version.
    restorePendingEpisodeSyncs()
      .then(() => flushAllPendingTimelinePersists())
      .then(() => fetch('/api/series'))
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || initialSequence !== switchSeriesSeqRef.current) return;
        if (data?.success && Array.isArray(data.series)) {
          if (data.series.length === 0) {
            // When server returns 0 series (e.g. uploads/projects folder was wiped or deleted on disk),
            // reset frontend state & localStorage so deleted series do not persist as ghosts.
            const freshSeries = createDefaultSeries('រឿងភាគ (Series 1)');
            setActiveSeriesId(freshSeries.id);
            setActiveSeriesIdState(freshSeries.id);
            activeSeriesIdRef.current = freshSeries.id;
            setActiveEpisodeId(freshSeries.episodes[0].id);
            setActiveEpisodeIdState(freshSeries.episodes[0].id);
            activeEpisodeIdRef.current = freshSeries.episodes[0].id;
            setSeriesList([freshSeries]);
            try {
              saveSeriesList([freshSeries]);
            } catch (_) {}
            applyEpisodeToWorkspace(freshSeries.episodes[0], freshSeries.id);
          } else {
            const serverList = sanitizeAndHealSeriesList(data.series);
            const currentStoredId = getActiveSeriesId();
            const resolvedSeriesId = currentStoredId || storedSeriesId || series?.id;
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
              activeSeriesIdRef.current = targetSeries.id;
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
              applyEpisodeToWorkspace(targetEp, targetSeries?.id);
            }
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
      episodeRequest.current?.abort();
      thumbnailRequest.current?.abort();
      clearTimeout(fallbackTimer);
    };
  }, [applyEpisodeToWorkspace]);

  const activeClipIdRef = useRef(activeClipId);
  activeClipIdRef.current = activeClipId;
  const selectedSegmentIdRef = useRef(selectedSegmentId);
  selectedSegmentIdRef.current = selectedSegmentId;

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
      videoClipsUpdatedAt,
      activeClipId: activeClipIdRef.current,
      selectedSegmentId: selectedSegmentIdRef.current,
      renderedVideo,
      voiceSettings: stripLogoSettings(voiceSettings),
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
    videoClipsUpdatedAt,
    renderedVideo,
    voiceSettings,
  ]);

  useLayoutEffect(() => {
    currentSnapshot.current = getCurrentWorkspaceSnapshot;
    if (!workspaceBaseline.current) workspaceBaseline.current = getCurrentWorkspaceSnapshot;
  });

  // Auto-persist active episode state to localStorage whenever data changes occur (debounced).
  // Excludes ephemeral UI selection pointers (activeClipId, selectedSegmentId) so playback auto-follow
  // across clip/Gap boundaries never triggers full-series JSON serialization or /sync during playback.
  useEffect(() => {
    // Guard against running auto-persist before initial workspace restore is complete
    if (!isInitializedRef.current) return;
    if (isTransitioningRef.current || workspaceBaseline.current === getCurrentWorkspaceSnapshot) return;
    if (!activeSeriesIdState || !activeEpisodeIdState) return;
    const timer = setTimeout(() => {
      if (isTransitioningRef.current) return;
      const snapshot = getCurrentWorkspaceSnapshot();
      saveEpisodeState(activeSeriesIdState, activeEpisodeIdState, snapshot);
      lastSavedSnapshot.current = getCurrentWorkspaceSnapshot;
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
    videoClipsUpdatedAt,
    renderedVideo,
    voiceSettings,
    getCurrentWorkspaceSnapshot,
  ]);

  // 1. Switch to another episode safely (Auto-save current episode first)
  const handleSwitchEpisode = useCallback(async (targetEpisodeId) => {
    const series = latestSeriesListRef.current.find((s) => s.id === activeSeriesIdState);
    const target = series?.episodes?.find((ep) => ep.id === targetEpisodeId);
    const previous = activeEpisodeIdRef.current;
    if (!target || targetEpisodeId === previous) return;

    episodeRequest.current?.abort();
    const controller = new AbortController();
    episodeRequest.current = controller;
    const seq = ++switchSeriesSeqRef.current;
    const stillCurrent = () => !controller.signal.aborted && seq === switchSeriesSeqRef.current &&
      activeEpisodeIdRef.current === targetEpisodeId && activeSeriesIdRef.current === series.id;
    const snapshotChanged = previous === activeEpisodeIdState && workspaceBaseline.current &&
      workspaceBaseline.current !== getCurrentWorkspaceSnapshot;
    if (snapshotChanged) {
      const snapshot = getCurrentWorkspaceSnapshot();
      setSeriesList((list) => list.map((s) => s.id === series.id ? {
        ...s, episodes: s.episodes.map((ep) => ep.id === previous ? { ...ep, ...snapshot, lastModified: Date.now() } : ep),
      } : s));
      if (getCurrentWorkspaceSnapshot !== lastSavedSnapshot.current) {
        // Run after the new workspace can paint. Retain the captured episode identity and values.
        const persist = () => {
          window.removeEventListener('pagehide', persist);
          clearTimeout(timer);
          saveEpisodeState(series.id, previous, snapshot);
        };
        const timer = setTimeout(persist, 32);
        window.addEventListener('pagehide', persist, { once: true });
      }
    }

    setActiveEpisodeId(targetEpisodeId);
    setActiveEpisodeIdForSeries(series.id, targetEpisodeId);
    activeEpisodeIdRef.current = targetEpisodeId;
    setActiveEpisodeIdState(targetEpisodeId);
    if (activeRequestRef?.current) activeRequestRef.current.activeEpisodeId = targetEpisodeId;
    isTransitioningRef.current = false;
    const prepared = readWorkspace(series, target);
    applyEpisodeToWorkspace(prepared.episode, series.id, { preserveTab: true, prepared });
    const validate = async () => {
      const edited = () => workspaceBaseline.current && workspaceBaseline.current !== currentSnapshot.current &&
        (prepared.complete || Number(latestScriptDataRef.current?.updatedAt || 0) > Number(prepared.episode?.scriptData?.updatedAt || 0));
      if (!stillCurrent() || edited()) return;
      try {
        const ep = await fetchEpisode(series.id, target.id, controller.signal, prepared.complete ? 'low' : 'high', prepared.episode);
        if (!stillCurrent() || !ep || edited()) return;
        const cached = prepared.episode;
        const cachedScriptAt = Number(cached.scriptData?.updatedAt || 0);
        const serverScriptAt = Number(ep.scriptData?.updatedAt || 0);
        const cachedSegCount = Array.isArray(cached.scriptData?.segments) ? cached.scriptData.segments.length : 0;
        const serverSegCount = Array.isArray(ep.scriptData?.segments) ? ep.scriptData.segments.length : 0;
        const serverHasNewerScript = serverScriptAt > cachedScriptAt || (serverScriptAt === cachedScriptAt && serverSegCount > cachedSegCount);
        if (prepared.complete && !serverHasNewerScript && (Number(cached.lastModified || 0) > Number(ep.lastModified || 0) ||
            cachedScriptAt > serverScriptAt)) return;
        // Preserve newer local scoped video-edit settings if user switched rapidly before server sync landed
        const localSeriesNow = (latestSeriesListRef.current || []).find((s) => s.id === series.id);
        const localEpNow = (localSeriesNow?.episodes || []).find((e) => e.id === target.id);
        const localVeAt = Math.max(
          Number(localEpNow?.videoEditSettings?.updatedAt || 0),
          Number(localSeriesNow?.videoEditSettings?.updatedAt || 0),
          lastVideoEditMutationAtRef.current
        );
        const serverVeAt = Number(ep?.videoEditSettings?.updatedAt || 0);
        let mergedEpFromServer = ep;
        if (localVeAt > serverVeAt) {
          const localResolvedVe = resolveEffectiveVideoEditSettings({ episode: localEpNow || cached, series: localSeriesNow || series });
          mergedEpFromServer = {
            ...ep,
            videoEditSettings: localEpNow?.videoEditSettings || { ...localResolvedVe, updatedAt: localVeAt },
            voiceSettings: { ...(ep.voiceSettings || {}), ...localResolvedVe },
            renderedVideo: localEpNow?.renderedVideo !== undefined ? localEpNow.renderedVideo : ep.renderedVideo,
            renderInvalidatedAt: Math.max(Number(ep.renderInvalidatedAt || 0), Number(localEpNow?.renderInvalidatedAt || 0)),
          };
        }
        // Initial series hydration already supplied full data. Only compare fields used by the workspace.
        const fields = ['scriptData', 'video', 'metadata', 'duration', 'videoClips', 'videoClipsUpdatedAt',
          'fullAudioUrl', 'fullAudioPath', 'audioGenerated', 'audioOutdated', 'speakerRegistry',
          'voiceSettings', 'videoEditSettings', 'renderedVideo', 'bgmAudioUrl', 'videoFile', 'sourceVideoPath'];
        if (prepared.complete && fields.every((key) => JSON.stringify(mergedEpFromServer[key]) === JSON.stringify(cached[key]))) {
          if (episodeEtags.has(ep)) episodeEtags.set(cached, episodeEtags.get(ep));
          return;
        }
        const full = readWorkspace(series, target, mergedEpFromServer);
        applyEpisodeToWorkspace(mergedEpFromServer, series.id, { preserveTab: true, prepared: full });
        setSeriesList((list) => list.map((s) => s.id === series.id ? {
          ...s, episodes: s.episodes.map((item) => item === target ? mergedEpFromServer : item),
        } : s));
      } catch (err) {
        if (!controller.signal.aborted) console.warn('[SeriesManager] Episode load failed:', err.message);
      }
    };
    if (!prepared.complete) return validate();
    const timer = setTimeout(validate, 1000);
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  }, [activeSeriesIdState, activeEpisodeIdState, getCurrentWorkspaceSnapshot, activeRequestRef, readWorkspace, applyEpisodeToWorkspace]);

  useEffect(() => {
    if (!activeSeries || !activeEpisode) return;
    const controller = new AbortController();
    const idx = activeSeries.episodes.indexOf(activeEpisode);
    const neighbors = [activeSeries.episodes[idx - 1], activeSeries.episodes[idx + 1]].filter(Boolean);
    const timer = setTimeout(async () => {
      for (const ep of neighbors) {
        if (controller.signal.aborted) return;
        let targetEp = ep;
        if (!readWorkspace(activeSeries, ep).complete) {
          try {
            const full = await fetchEpisode(activeSeries.id, ep.id, controller.signal, 'low');
            if (!controller.signal.aborted && full) {
              readWorkspace(activeSeries, ep, full);
              targetEp = full;
            }
          } catch { /* Active load can retry a failed background request. */ }
        }
        if (controller.signal.aborted) return;
        const vidUrl = targetEp.video?.videoUrl || targetEp.videoFile || (targetEp.video?.videoId ? (targetEp.video.videoId.startsWith('/') ? targetEp.video.videoId : `/uploads/${targetEp.video.videoId}`) : null);
        if (vidUrl) {
          void prefetchSourceProxyStatus(activeSeries.id, targetEp.id, vidUrl, controller.signal);
        }
        if (Array.isArray(targetEp.scriptData?.segments) && targetEp.scriptData.segments.length > 0) {
          void prefetchEpisodeWaveformPeaks(activeSeries.id, targetEp.id, targetEp.scriptData.segments, controller.signal);
        }
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeEpisode, activeSeries, readWorkspace]);

  // 1b. Switch to another series
  const handleSwitchSeries = useCallback(async (targetSeriesId) => {
    if (!targetSeriesId || targetSeriesId === activeSeriesIdState) return;

    // 1. Save current workspace snapshot to current series/episode before switching
    if (activeSeriesIdState && activeEpisodeIdRef.current) {
      const snapshot = getCurrentWorkspaceSnapshot();
      saveEpisodeState(activeSeriesIdState, activeEpisodeIdRef.current, snapshot);
      setActiveEpisodeIdForSeries(activeSeriesIdState, activeEpisodeIdRef.current);
    }

    episodeRequest.current?.abort();
    switchSeriesSeqRef.current += 1;
    const currentSeq = switchSeriesSeqRef.current;
    isTransitioningRef.current = true;

    try {
      // 2. Resolve and load the target before publishing it as the active workspace.
      let targetSeries = (latestSeriesListRef.current || []).find((s) => s.id === targetSeriesId);
      try {
        const res = await fetch(`/api/series/${encodeURIComponent(targetSeriesId)}`);
        const data = await res.json();
        if (switchSeriesSeqRef.current !== currentSeq) return;
        if (data?.success && data.series) {
          targetSeries = data.series;
          setSeriesList((prev) => {
            const exists = (prev || []).some((s) => s.id === data.series.id);
            const updated = exists
              ? prev.map((s) => (s.id === data.series.id ? data.series : s))
              : [...(prev || []), data.series];
            try { saveSeriesList(updated); } catch (_) {}
            return updated;
          });
        }
      } catch (_) {}

      if (switchSeriesSeqRef.current !== currentSeq) return;

      // Refresh full list from server
      try {
        const allRes = await fetch('/api/series');
        const allData = await allRes.json();
        if (switchSeriesSeqRef.current === currentSeq && allData?.success && Array.isArray(allData.series)) {
          const healed = sanitizeAndHealSeriesList(allData.series);
          setSeriesList(healed);
          try { saveSeriesList(healed); } catch (_) {}
          targetSeries = healed.find((s) => s.id === targetSeriesId) || targetSeries;
        }
      } catch (_) {}

      if (switchSeriesSeqRef.current !== currentSeq) return;
      if (!targetSeries) {
        console.error(`[Series Switch] Cannot load target series: ${targetSeriesId}`);
        return;
      }

      setActiveSeriesId(targetSeriesId);
      setActiveSeriesIdState(targetSeriesId);
      activeSeriesIdRef.current = targetSeriesId;

      // 3. Remember and restore the last selected episode for target series (not just index 0)
      const targetEpisodes = Array.isArray(targetSeries?.episodes) ? targetSeries.episodes : [];
      const rememberedEpId = getActiveEpisodeIdForSeries(targetSeriesId);
      const targetEp = (rememberedEpId && targetEpisodes.find((e) => String(e.id) === String(rememberedEpId))) || targetEpisodes[0] || null;

      if (targetEp) {
        setActiveEpisodeId(targetEp.id);
        setActiveEpisodeIdState(targetEp.id);
        activeEpisodeIdRef.current = targetEp.id;
        activeSeriesIdRef.current = targetSeries.id;
        setActiveEpisodeIdForSeries(targetSeries.id, targetEp.id);
        applyEpisodeToWorkspace(targetEp, targetSeries.id);
      } else {
        setActiveEpisodeId(null);
        setActiveEpisodeIdState(null);
        activeEpisodeIdRef.current = null;
        if (callbacksRef.current.setSelectedVideo) callbacksRef.current.setSelectedVideo(null);
        if (callbacksRef.current.setVideoMetadata) callbacksRef.current.setVideoMetadata(null);
        if (callbacksRef.current.setScriptData) callbacksRef.current.setScriptData(null);
        if (callbacksRef.current.setSpeakerRegistry) callbacksRef.current.setSpeakerRegistry({});
        if (callbacksRef.current.setAudioGenerated) callbacksRef.current.setAudioGenerated(false);
        if (callbacksRef.current.setAudioOutdated) callbacksRef.current.setAudioOutdated(false);
        if (callbacksRef.current.setFullAudioPath) callbacksRef.current.setFullAudioPath(null);
        if (callbacksRef.current.setFullAudioUrl) callbacksRef.current.setFullAudioUrl(null);
        if (callbacksRef.current.setDuration) callbacksRef.current.setDuration(0);
        if (callbacksRef.current.setCurrentTime) callbacksRef.current.setCurrentTime(0);
        if (callbacksRef.current.setVideoClips) callbacksRef.current.setVideoClips([]);
        if (callbacksRef.current.setRenderedVideo) callbacksRef.current.setRenderedVideo(null);
        if (callbacksRef.current.setVideoThumbnails) callbacksRef.current.setVideoThumbnails([]);
        if (callbacksRef.current.setMediaAssets) callbacksRef.current.setMediaAssets([]);
        if (callbacksRef.current.clearHistory) callbacksRef.current.clearHistory();
        if (callbacksRef.current.setLeftTab) callbacksRef.current.setLeftTab('media');
      }
    } finally {
      setTimeout(() => {
        if (switchSeriesSeqRef.current === currentSeq) {
          isTransitioningRef.current = false;
        }
      }, 100);
    }
  }, [activeSeriesIdState, getCurrentWorkspaceSnapshot, applyEpisodeToWorkspace]);

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
      await fetch(`/api/series/${encodeURIComponent(activeSeriesIdState)}/episodes/${encodeURIComponent(targetEpisodeId)}`, {
        method: 'DELETE',
      });
      const res = await fetch(`/api/series/${encodeURIComponent(activeSeriesIdState)}`);
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

  // 5. Rename Series (renames physical folder under backend/uploads/projects/<newName> + updates all local/active references)
  const handleRenameSeries = useCallback(async (newTitle, targetSeriesId = null) => {
    const clean = typeof newTitle === 'string' ? newTitle.trim() : '';
    if (!clean) return { success: false, error: 'សូមបញ្ចូលឈ្មោះ Folder រឿងថ្មី!' };
    const sId = targetSeriesId || activeSeriesIdState;
    if (!sId) return { success: false, error: 'មិនមាន Series ID' };

    try {
      const result = await renameSeriesApi(sId, clean);
      if (result?.success && result.series) {
        const renamedSeries = result.series;
        const oldId = result.oldSeriesId || sId;
        const newId = result.newSeriesId || renamedSeries.id || sId;

        setSeriesList((prevList) => {
          const base = Array.isArray(prevList) ? prevList : [];
          const hasOld = base.some((s) => String(s.id) === String(oldId));
          const updated = hasOld
            ? base.map((s) => (String(s.id) === String(oldId) ? renamedSeries : s))
            : [...base, renamedSeries];
          try { saveSeriesList(updated); } catch (_) {}
          return updated;
        });

        if (String(activeSeriesIdState) === String(oldId) || String(activeSeriesIdRef.current) === String(oldId)) {
          setActiveSeriesId(newId);
          setActiveSeriesIdState(newId);
          activeSeriesIdRef.current = newId;
          if (newId !== oldId) {
            const targetEp =
              (renamedSeries.episodes || []).find((e) => String(e.id) === String(activeEpisodeIdRef.current)) ||
              (renamedSeries.episodes || [])[0] ||
              null;
            if (targetEp) {
              applyEpisodeToWorkspace(targetEp, newId);
            }
          }
        }

        return {
          success: true,
          oldSeriesId: oldId,
          newSeriesId: newId,
          renamedFolder: Boolean(result.renamedFolder),
          series: renamedSeries,
        };
      }
      return { success: false, error: result?.error || 'មិនអាចប្តូរឈ្មោះ Folder បានទេ' };
    } catch (err) {
      // Only fall back to local title update if series does not exist on backend yet (404)
      if (err?.status === 404) {
        updateSeriesTitle(sId, clean);
        setSeriesList((prevList) =>
          (prevList || []).map((s) => (s.id === sId ? { ...s, title: clean } : s))
        );
        return { success: true, oldSeriesId: sId, newSeriesId: sId };
      }
      console.warn('[useSeriesManager] Failed to rename series folder:', err?.message || err);
      return { success: false, error: err?.message || 'មិនអាចប្តូរឈ្មោះ Folder បានទេ' };
    }
  }, [activeSeriesIdState, applyEpisodeToWorkspace]);

  // 5b. Delete Series
  const handleDeleteSeries = useCallback(async (targetSeriesId) => {
    if (!targetSeriesId) return { success: false, error: 'No series ID' };
    try {
      const result = await deleteSeriesApi(targetSeriesId);
      if (!result?.success) {
        const errMsg = result?.error || 'Backend deletion failed';
        console.error('[useSeriesManager] ❌ Series deletion failed on backend:', errMsg);
        return { success: false, error: errMsg };
      }
    } catch (err) {
      const errMsg = err?.message || 'Network error during deletion';
      console.error('[useSeriesManager] ❌ Series deletion failed:', errMsg);
      return { success: false, error: errMsg };
    }
    // Backend confirmed deletion — now safe to remove from UI + localStorage
    const updated = deleteSeriesFromList(targetSeriesId);
    // Clear any pending timeline writes for the deleted series so they cannot resurrect it
    try {
      const pendingRaw = localStorage.getItem('KHMER_AI_PENDING_TIMELINE_WRITES');
      if (pendingRaw) {
        const pending = JSON.parse(pendingRaw);
        let changed = false;
        for (const key of Object.keys(pending)) {
          if (pending[key]?.seriesId === targetSeriesId) {
            delete pending[key];
            changed = true;
          }
        }
        if (changed) {
          localStorage.setItem('KHMER_AI_PENDING_TIMELINE_WRITES', JSON.stringify(pending));
        }
      }
    } catch (_) {}
    setSeriesList(updated);
    if (activeSeriesIdState === targetSeriesId) {
      const nextSeries = updated[0];
      setActiveSeriesId(nextSeries.id);
      setActiveSeriesIdState(nextSeries.id);
      activeSeriesIdRef.current = nextSeries.id;
      const targetEp = nextSeries.episodes?.[0] || null;
      if (targetEp) {
        setActiveEpisodeId(targetEp.id);
        setActiveEpisodeIdState(targetEp.id);
        activeEpisodeIdRef.current = targetEp.id;
        applyEpisodeToWorkspace(targetEp, nextSeries.id);
      }
    }
    return { success: true };
  }, [activeSeriesIdState, applyEpisodeToWorkspace]);

  // 6. Save background results (e.g. if user switched to EP2 while EP1 was generating)
  const handleSaveEpisodeBackground = useCallback((targetEpisodeId, partialData) => {
    if (!targetEpisodeId || !partialData) return;
    const safePartialData = partialData.voiceSettings && typeof partialData.voiceSettings === 'object'
      ? { ...partialData, voiceSettings: stripLogoSettings(partialData.voiceSettings) }
      : partialData;
    const list = loadSeriesList();
    const sIdx = list.findIndex((s) => s.id === activeSeriesIdState);
    if (sIdx !== -1) {
      const eIdx = (list[sIdx].episodes || []).findIndex((e) => e.id === targetEpisodeId);
      if (eIdx !== -1) {
        list[sIdx].episodes[eIdx] = {
          ...list[sIdx].episodes[eIdx],
          ...safePartialData,
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
                  ? { ...e, ...safePartialData, lastModified: Date.now() }
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

  // 8a. Server-truth sync: refresh full series list from backend disk
  const fetchAllSeriesFromServer = async (explicitList = null) => {
    if (Array.isArray(explicitList)) {
      const healed = sanitizeAndHealSeriesList(explicitList);
      setSeriesList(healed);
      try { saveSeriesList(healed); } catch (_) {}
      return healed;
    }
    try {
      const res = await fetch('/api/series');
      const data = await res.json();
      if (data?.success && Array.isArray(data.series)) {
        const healed = sanitizeAndHealSeriesList(data.series);
        setSeriesList(healed);
        try { saveSeriesList(healed); } catch (_) {}
        return healed;
      }
    } catch (err) {
      console.warn('[useSeriesManager] fetchAllSeriesFromServer error:', err);
    }
    return null;
  };

  // 8. Server-truth sync: manual or triggered refresh from backend disk
  const refreshSeriesFromServer = useCallback(async () => {
    const seq = switchSeriesSeqRef.current;
    // Refresh full series list from disk so newly created series are available.
    await fetchAllSeriesFromServer();
    if (seq !== switchSeriesSeqRef.current || activeSeriesIdRef.current !== activeSeriesIdState) return;

    if (!activeSeriesIdState) return;
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(activeSeriesIdState)}`);
      const data = await res.json();
      if (data?.success && data.series) {
        if (seq !== switchSeriesSeqRef.current || activeSeriesIdRef.current !== activeSeriesIdState) return;
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
          Boolean(currentActiveEp?.scriptData) &&
          workspaceUpdatedAt > nextUpdatedAt &&
          nextUpdatedAt > 0 &&
          workspaceSegLen > 0;
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

  // Apply only the 4 Video Edit Settings (Mirror Flip, Zoom, Color Grade, Mute Original OST)
  // to the explicit target scope ('episode' | 'folder' | 'global') without touching scripts, audio, or timeline.
  const applyVideoEditSettingsToScope = useCallback(async ({
    scope = 'folder',
    settings = null,
    updatedAt = Date.now(),
    syncServer = true,
  } = {}) => {
    const targetSeriesId = activeSeriesIdRef.current;
    const targetEpisodeId = activeEpisodeIdRef.current;
    const normScope = scope === 'episode' || scope === 'global' ? scope : 'folder';
    const ts = Math.max(Date.now(), Number(updatedAt) || 0, lastVideoEditMutationAtRef.current + 1);
    lastVideoEditMutationAtRef.current = ts;

    const normalizedEdit = normalizeVideoEditSettings(settings);
    if (normScope === 'global') {
      saveGlobalVideoEditSettings(normalizedEdit, { updatedAt: ts });
    }

    setSeriesList((prevList) => {
      const nextList = applyVideoEditSettingsToSeriesList(prevList, {
        scope: normScope,
        seriesId: targetSeriesId,
        episodeId: targetEpisodeId,
        settings: normalizedEdit,
        updatedAt: ts,
      });
      try { saveSeriesList(nextList); } catch (_) {}
      return nextList;
    });

    if (callbacksRef.current.setVoiceSettings) {
      callbacksRef.current.setVoiceSettings((prev) => ({
        ...(prev || {}),
        ...normalizedEdit,
      }));
    }

    if (callbacksRef.current.setRenderedVideo) {
      callbacksRef.current.setRenderedVideo((prevRv) => {
        if (!prevRv) return prevRv;
        return isRenderedYoutubeTransformMismatch(prevRv, normalizedEdit) ? null : prevRv;
      });
    }

    if (!syncServer) {
      return { success: true, scope: normScope, settings: normalizedEdit, updatedAt: ts };
    }

    try {
      const res = await applyScopedVideoEditSettingsApi({
        seriesId: targetSeriesId,
        episodeId: targetEpisodeId,
        scope: normScope,
        settings: normalizedEdit,
        updatedAt: ts,
      });
      return res;
    } catch (err) {
      console.warn('[useSeriesManager] Failed to persist scoped video edit settings:', err?.message || err);
      return { success: false, error: err?.message || 'Persist failed' };
    }
  }, []);

  return {
    seriesList,
    activeSeries,
    activeEpisode,
    seriesId: activeSeriesIdState,
    episodeId: activeEpisodeIdState,
    seriesGlossary,
    refreshSeriesFromServer,
    fetchAllSeriesFromServer,
    handleSwitchSeries,
    handleSwitchEpisode,
    handleCreateEpisode,
    handleDeleteEpisode,
    handleResetAllEpisodes,
    handleRenameEpisode,
    handleRenameSeries,
    handleDeleteSeries,
    handleSaveEpisodeBackground,
    getCurrentWorkspaceSnapshot,
    applyVideoEditSettingsToScope,
  };
}
