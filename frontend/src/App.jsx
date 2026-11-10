import React, { useState, useRef, useCallback, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import Navbar from './components/Navbar';
import ErrorBoundary from './components/common/ErrorBoundary';
import JobDashboardModal from './components/dashboard/JobDashboardModal';
import GeminiRouteModal from './components/dashboard/GeminiRouteModal';
import GeminiQuotaModal from './components/dashboard/GeminiQuotaModal';
import BatchExportStudioModal from './components/dashboard/BatchExportStudioModal';
import WorkflowStepper from './components/WorkflowStepper';
import MediaLibrary from './components/MediaLibrary';
import VideoPlayerPreview from './components/VideoPlayerPreview';
import VoiceSettings from './components/VoiceSettings';
import TimelineEditor from './components/TimelineEditor';
import {
  loadSavedVoiceSettings,
  saveVoiceSettings,
  saveEpisodeState,
  resolveDefaultAspectRatio,
  isRenderedRatioMismatch,
} from './utils/projectStorage';
import { isSegmentMatch, resolveVoiceClipStartSec } from './utils/timelineUtils';
import { JobQueueProvider } from './context/JobQueueContext';

// Hoisted immutable fallbacks (prevents prop churning and broken memoization)
const EMPTY_SEGMENTS = Object.freeze([]);
const EMPTY_CLIPS = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

// Custom Architectural Hooks (Modularized for clean maintainability & debugging)
import { useResizablePanels } from './hooks/useResizablePanels';
import { useWorkspaceMedia } from './hooks/useWorkspaceMedia';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useVideoPlayback } from './hooks/useVideoPlayback';
import { useAudioDubbing } from './hooks/useAudioDubbing';
import { useVideoRender } from './hooks/useVideoRender';
import { useScriptWorkflow } from './hooks/useScriptWorkflow';
import { useClipOperations } from './hooks/useClipOperations';
import { useProjectPersistence } from './hooks/useProjectPersistence';
import { useSeriesManager } from './hooks/useSeriesManager';

export default function App() {
  const [leftTab, setLeftTab] = useState('media');
  const [showJobDashboard, setShowJobDashboard] = useState(false);
  const [showGeminiRouteModal, setShowGeminiRouteModal] = useState(false);
  const [showGeminiQuotaModal, setShowGeminiQuotaModal] = useState(false);
  const [showBatchExportStudioModal, setShowBatchExportStudioModal] = useState(false);
  const [exportStudioSelectedEpIds, setExportStudioSelectedEpIds] = useState([]);
  const [exportStudioAllowOriginalAudio, setExportStudioAllowOriginalAudio] = useState(false);
  const lastExportStudioSeriesRef = useRef(null);
  const [scriptData, setScriptData] = useState(null);
  const [speakerRegistry, setSpeakerRegistry] = useState({});
  const [voiceSettings, setVoiceSettings] = useState(loadSavedVoiceSettings);
  const [audioGenerated, setAudioGenerated] = useState(false);
  const [audioOutdated, setAudioOutdated] = useState(false);
  const [fullAudioPath, setFullAudioPath] = useState(null);
  const [fullAudioUrl, setFullAudioUrl] = useState(null);
  const [timelineFocusRequest, setTimelineFocusRequest] = useState(null);

  const topSuiteRef = useRef(null);
  const videoRef = useRef(null);
  const focusNonceRef = useRef(0);
  const activeRequestRef = useRef({
    requestId: null,
    videoId: null,
    abortController: null,
  });

  // Cross-hook reference holders for event callbacks (prevents TDZ)
  const playbackRef = useRef({});
  const renderRef = useRef({});
  const undoRedoRef = useRef({});
  const audioRef = useRef({});
  const scriptRef = useRef({});
  const persistenceRef = useRef({});
  const mediaRef = useRef({});
  const seriesRef = useRef({});
  const clipsRef = useRef({});
  const scriptDataRef = useRef(scriptData);
  scriptDataRef.current = scriptData;
  const voiceSettingsRef = useRef(voiceSettings);
  voiceSettingsRef.current = voiceSettings;

  // Stable ref-delegated callbacks (prevents infinite render loops & unnecessary effect runs)
  const handleSetDuration = useCallback((dur) => playbackRef.current.setDuration?.(dur), []);
  const handleSetCurrentTime = useCallback((t) => playbackRef.current.setCurrentTime?.(t), []);
  const handleSetRenderedVideo = useCallback((v) => renderRef.current.setRenderedVideo?.(v), []);
  const handleClearHistory = useCallback(() => undoRedoRef.current.clearHistory?.(), []);
  const handleSetScriptError = useCallback((err) => scriptRef.current.setScriptError?.(err), []);
  const handleSetIsGeneratingScript = useCallback((gen) => scriptRef.current.setIsGeneratingScript?.(gen), []);

  // 1. Resizable 3-Column Panels Hook
  const {
    leftPanelWidth,
    rightPanelWidth,
    activeSplitter,
    handleStartSplitterDrag
  } = useResizablePanels(topSuiteRef);

  // 2. Workspace Media Hook (Videos, Clips, Thumbnails, and Selection)
  const media = useWorkspaceMedia({
    activeRequestRef,
    duration: playbackRef.current.duration || 0,
    setDuration: handleSetDuration,
    setCurrentTime: handleSetCurrentTime,
    setLeftTab,
    clearHistory: handleClearHistory,
    setRenderedVideo: handleSetRenderedVideo,
    setScriptData,
    setSpeakerRegistry,
    setAudioGenerated,
    setAudioOutdated,
    setFullAudioPath,
    setFullAudioUrl,
    setScriptError: handleSetScriptError,
    setIsGeneratingScript: handleSetIsGeneratingScript,
  });

  // 3. Multi-Episode & Series Manager Hook
  const series = useSeriesManager({
    selectedVideo: media.selectedVideo,
    setSelectedVideo: media.setSelectedVideo,
    videoMetadata: media.videoMetadata,
    setVideoMetadata: media.setVideoMetadata,
    scriptData,
    setScriptData,
    speakerRegistry,
    setSpeakerRegistry,
    setLeftTab,
    audioGenerated,
    setAudioGenerated,
    audioOutdated,
    setAudioOutdated,
    fullAudioPath,
    setFullAudioPath,
    fullAudioUrl,
    setFullAudioUrl,
    duration: playbackRef.current.duration || 0,
    setDuration: handleSetDuration,
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
    selectedSegmentId: media.selectedSegmentId,
    setSelectedSegmentId: media.setSelectedSegmentId,
    renderedVideo: renderRef.current.renderedVideo || null,
    setRenderedVideo: handleSetRenderedVideo,
    voiceSettings,
    setVoiceSettings,
    setVideoThumbnails: media.setVideoThumbnails,
    setMediaAssets: media.setMediaAssets,
    setCurrentTime: handleSetCurrentTime,
    activeRequestRef,
    clearHistory: handleClearHistory,
    handleClearVideo: media.handleClearVideo,
    audioProgressTimerRef: audioRef.current.audioProgressTimerRef,
  });

  const srcW = Number(media.videoMetadata?.width || media.selectedVideo?.width || series.activeEpisode?.metadata?.width || series.activeEpisode?.video?.width) || 0;
  const srcH = Number(media.videoMetadata?.height || media.selectedVideo?.height || series.activeEpisode?.metadata?.height || series.activeEpisode?.video?.height) || 0;
  const currentAspectRatio = voiceSettings?.aspectRatio || resolveDefaultAspectRatio(srcW, srcH) || '16:9';

  const prevRawRendered = renderRef.current.renderedVideo || null;
  const playbackEffectiveRenderedVideo = isRenderedRatioMismatch(
    prevRawRendered,
    currentAspectRatio,
    { width: srcW, height: srcH }
  )
    ? null
    : prevRawRendered;

  // 4. Undo / Redo Stack Management Hook
  const undoRedo = useUndoRedo({
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    scriptData,
    setScriptData,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
  });
  undoRedoRef.current = undoRedo;

  // 5. Video Playback & Time Tracking Hook
  const playback = useVideoPlayback({
    videoRef,
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    renderedVideo: playbackEffectiveRenderedVideo,
    selectedVideo: media.selectedVideo,
    selectedClip: media.selectedClip,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
    setSelectedSegmentId: media.setSelectedSegmentId,
    scriptData,
  });
  playbackRef.current = playback;

  // 6. Audio Dubbing (Edge TTS & Timeline Synchronizer) Hook
  const audio = useAudioDubbing({
    scriptData,
    setScriptData,
    speakerRegistry,
    setSpeakerRegistry,
    voiceSettings,
    setVoiceSettings,
    videoRef,
    setIsPlaying: playback.setIsPlaying,
    setSelectedSegmentId: media.setSelectedSegmentId,
    selectedVideo: media.selectedVideo,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    activeSeries: series.activeSeries,
    handleSaveEpisodeBackground: series.handleSaveEpisodeBackground,
    onSaveEpisodeBackground: series.handleSaveEpisodeBackground,
    activeRequestRef,
    pushHistory: undoRedo.pushHistory || undoRedo.pushUndoSnapshot,
    audioGenerated,
    setAudioGenerated,
    audioOutdated,
    setAudioOutdated,
    fullAudioPath,
    setFullAudioPath,
    fullAudioUrl,
    setFullAudioUrl,
  });
  audioRef.current = audio;

  // 7. Final Video Export & Rendering Hook
  const render = useVideoRender({
    selectedVideo: media.selectedVideo,
    videoMetadata: media.videoMetadata,
    activeEpisode: series.activeEpisode,
    audioGenerated: audio.audioGenerated,
    speakerRegistry,
    voiceSettings,
    voiceSettingsRef,
    scriptData,
    videoClips: media.videoClips,
    fullAudioPath: audio.fullAudioPath,
    videoRef,
    setIsPlaying: playback.setIsPlaying,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    activeSeries: series.activeSeries,
    handleSaveEpisodeBackground: series.handleSaveEpisodeBackground,
    setAudioOutdated: audio.setAudioOutdated,
    refreshSeriesFromServer: series.refreshSeriesFromServer,
  });
  renderRef.current = render;

  // 8. AI Script Generation & Gemini Workflow Hook
  const script = useScriptWorkflow({
    selectedVideo: media.selectedVideo,
    apiKey: persistenceRef.current.apiKey || '',
    scriptData,
    setScriptData,
    speakerRegistry,
    setSpeakerRegistry,
    setAudioGenerated: audio.setAudioGenerated,
    setAudioOutdated: audio.setAudioOutdated,
    setFullAudioPath: audio.setFullAudioPath,
    setFullAudioUrl: audio.setFullAudioUrl,
    setSelectedSegmentId: media.setSelectedSegmentId,
    duration: playback.duration,
    videoRef,
    setVideoClips: media.setVideoClips,
    setActiveClipId: media.setActiveClipId,
    activeRequestRef,
    activeSeries: series.activeSeries,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    seriesGlossary: series.seriesGlossary,
    onSaveEpisodeBackground: series.handleSaveEpisodeBackground,
    onNavigateToTab: setLeftTab,
    setLeftTab,
    pushHistory: undoRedo.pushUndoSnapshot,
    clearHistory: handleClearHistory,
    setScriptError: handleSetScriptError,
    setIsGeneratingScript: handleSetIsGeneratingScript,
  });
  scriptRef.current = script;

  // 9. Multi-Clip Timeline Editing Operations Hook
  const clips = useClipOperations({
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
    duration: playback.duration,
    setDuration: playback.setDuration,
    currentTime: playback.currentTime,
    selectedVideo: media.selectedVideo,
    videoRef,
    scriptData,
    setScriptData,
    speakerRegistry,
    setSpeakerRegistry,
    audioGenerated: audio.audioGenerated,
    selectedSegmentId: media.selectedSegmentId,
    setSelectedSegmentId: media.setSelectedSegmentId,
    handleSeek: playback.handleSeek,
    pushHistory: undoRedo.pushUndoSnapshot,
    pushUndoSnapshot: undoRedo.pushUndoSnapshot,
    setFullAudioUrl: audio.setFullAudioUrl,
    setFullAudioPath: audio.setFullAudioPath,
    syncAudioTimeoutRef: audio.syncAudioTimeoutRef,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    setAudioOutdated: audio.setAudioOutdated,
    renderedVideo: render.renderedVideo,
    setRenderedVideo: render.setRenderedVideo,
    voiceSettings,
    setVoiceSettings,
    setVideoThumbnails: media.setVideoThumbnails,
  });

  // 10. Project State Auto-Save & LocalStorage Persistence Hook
  const persistence = useProjectPersistence({
    activeRequestRef,
    selectedVideo: media.selectedVideo,
    setSelectedVideo: media.setSelectedVideo,
    videoMetadata: media.videoMetadata,
    setVideoMetadata: media.setVideoMetadata,
    scriptData,
    setScriptData,
    speakerRegistry,
    setSpeakerRegistry,
    voiceSettings,
    setVoiceSettings,
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    videoThumbnails: media.videoThumbnails,
    setVideoThumbnails: media.setVideoThumbnails,
    duration: playback.duration,
    setDuration: playback.setDuration,
    currentTime: playback.currentTime,
    setCurrentTime: handleSetCurrentTime,
    renderedVideo: render.renderedVideo,
    setRenderedVideo: handleSetRenderedVideo,
    fullAudioPath: audio.fullAudioPath,
    setFullAudioPath: audio.setFullAudioPath,
    fullAudioUrl: audio.fullAudioUrl,
    setFullAudioUrl: audio.setFullAudioUrl,
    audioGenerated: audio.audioGenerated,
    setAudioGenerated: audio.setAudioGenerated,
    audioOutdated: audio.audioOutdated,
    setAudioOutdated: audio.setAudioOutdated,
    selectedSegmentId: media.selectedSegmentId,
    setSelectedSegmentId: media.setSelectedSegmentId,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
    handleSaveEpisodeBackground: series.handleSaveEpisodeBackground,
    isWizardMode: false,
  });
  persistenceRef.current = persistence;

  // Sync ref holders every render for zero-prop-churn child components
  mediaRef.current = media;
  seriesRef.current = series;
  undoRedoRef.current = undoRedo;
  playbackRef.current = playback;
  audioRef.current = audio;
  renderRef.current = render;
  scriptRef.current = script;
  clipsRef.current = clips;

  // Stable callbacks for TimelineEditor
  const handleSelectClip = useCallback((...args) => clipsRef.current.handleSelectClip?.(...args), []);
  const handleUpdateClips = useCallback((...args) => clipsRef.current.handleUpdateClips?.(...args), []);
  const handleSplitClip = useCallback((...args) => clipsRef.current.handleSplitClip?.(...args), []);
  const handleDeleteClip = useCallback((...args) => clipsRef.current.handleDeleteClip?.(...args), []);
  const handleDeleteSegment = useCallback((...args) => clipsRef.current.handleDeleteSegment?.(...args), []);
  const handleUpdateTimelineSegments = useCallback((...args) => clipsRef.current.handleUpdateTimelineSegments?.(...args), []);
  const handleToggleMuteSegment = useCallback((...args) => clipsRef.current.handleToggleMuteSegment?.(...args), []);
  const handleToggleMuteVideoClip = useCallback((...args) => clipsRef.current.handleToggleMuteVideoClip?.(...args), []);
  const handleToggleMuteAllCuts = useCallback((...args) => clipsRef.current.handleToggleMuteAllCuts?.(...args), []);
  const handleAutoSplitVideo = useCallback((...args) => clipsRef.current.handleAutoSplitVideo?.(...args), []);
  const handleResetFullVideo = useCallback((...args) => clipsRef.current.handleResetFullVideo?.(...args), []);
  const handleBridgeGaps = useCallback((...args) => clipsRef.current.handleBridgeGaps?.(...args), []);
  const handleAutoAlignNoOverlap = useCallback((...args) => clipsRef.current.handleAutoAlignNoOverlap?.(...args), []);
  const handleResetToSourceTiming = useCallback((...args) => clipsRef.current.handleResetToSourceTiming?.(...args), []);
  const handleAddSegmentAtTime = useCallback((...args) => clipsRef.current.handleAddSegmentAtTime?.(...args), []);
  const handleAddClipToTimeline = useCallback((t, asset) => {
    const curTime = typeof t === 'number' ? t : (playbackRef.current.currentTime || 0);
    mediaRef.current.handleAddClipToTimeline?.(curTime, asset);
  }, []);

  // Undo / Redo callbacks
  const handleUndo = useCallback((...args) => undoRedoRef.current.handleUndo?.(...args), []);
  const handleRedo = useCallback((...args) => undoRedoRef.current.handleRedo?.(...args), []);

  // Audio Dubbing callbacks
  const handleGenerateAudio = useCallback((...args) => audioRef.current.handleGenerateAudio?.(...args), []);
  const handleToggleDeliveryType = useCallback((...args) => audioRef.current.handleToggleDeliveryType?.(...args), []);
  const handleUpdateVoiceSettings = useCallback((newSettings) => {
    const prevRatio = voiceSettingsRef.current?.aspectRatio || null;
    if (newSettings && typeof newSettings === 'object') {
      voiceSettingsRef.current = newSettings;
    }
    audioRef.current.handleUpdateVoiceSettings?.(newSettings);
    if (newSettings?.aspectRatio && newSettings.aspectRatio !== prevRatio) {
      saveVoiceSettings(newSettings);
      const patch = { voiceSettings: newSettings };
      const sId = seriesRef.current.seriesId;
      const eId = seriesRef.current.episodeId;
      if (sId && eId) {
        saveEpisodeState(sId, eId, patch);
        seriesRef.current.handleSaveEpisodeBackground?.(eId, patch);
      }
    }
  }, []);

  const handleAspectRatioChange = useCallback((nextRatio) => {
    if (!nextRatio) return;
    const updated = { ...(voiceSettingsRef.current || {}), aspectRatio: nextRatio };
    voiceSettingsRef.current = updated;
    setVoiceSettings(updated);
    saveVoiceSettings(updated);
    const patch = { voiceSettings: updated };
    const sId = seriesRef.current.seriesId;
    const eId = seriesRef.current.episodeId;
    if (sId && eId) {
      saveEpisodeState(sId, eId, patch);
      seriesRef.current.handleSaveEpisodeBackground?.(eId, patch);
    }
  }, []);
  const handleRegenerateSingleSegment = useCallback((...args) => audioRef.current.handleRegenerateSingleSegment?.(...args), []);
  const handleTranslateSingleSegment = useCallback((...args) => audioRef.current.handleTranslateSingleSegment?.(...args), []);
  const handleUpdateSegmentText = useCallback((...args) => audioRef.current.handleUpdateSegmentText?.(...args), []);
  const handleUpdateSpeakerVoice = useCallback((...args) => audioRef.current.handleUpdateSpeakerVoice?.(...args), []);
  const handleUpdateSegmentVoice = useCallback((...args) => audioRef.current.handleUpdateSegmentVoice?.(...args), []);

  // Playback callbacks
  const handleSeek = useCallback((...args) => playbackRef.current.handleSeek?.(...args), []);
  const handlePlayPause = useCallback((...args) => playbackRef.current.handlePlayPause?.(...args), []);
  const handleTimeUpdate = useCallback((...args) => playbackRef.current.handleTimeUpdate?.(...args), []);
  const handleLoadedMetadata = useCallback((...args) => playbackRef.current.handleLoadedMetadata?.(...args), []);
  const handleVideoEnded = useCallback((...args) => playbackRef.current.handleVideoEnded?.(...args), []);

  // Selecting a segment from left "3. Subs" behaves like clicking that clip on the VOICE timeline track:
  // selects card/Inspector, syncs activeClipId, seeks playhead + video preview, and centers timeline view (no autoplay).
  const handleSelectSegmentFromScript = useCallback((segKey, segObj = null, idxHint = null) => {
    mediaRef.current.setSelectedSegmentId?.(segKey);
    if (segKey === null || segKey === undefined) return;

    const segs = scriptDataRef.current?.segments || EMPTY_SEGMENTS;
    let resolvedIdx = Number.isInteger(idxHint) && idxHint >= 0 && idxHint < segs.length ? idxHint : -1;
    let targetSeg = segObj && typeof segObj === 'object' ? segObj : (resolvedIdx >= 0 ? segs[resolvedIdx] : null);

    if (!targetSeg && segs.length > 0) {
      resolvedIdx = segs.findIndex((s, i) => isSegmentMatch(s, segKey, i));
      if (resolvedIdx >= 0) {
        targetSeg = segs[resolvedIdx];
      }
    } else if (targetSeg && resolvedIdx === -1 && segs.length > 0) {
      resolvedIdx = segs.findIndex((s) => s === targetSeg);
      if (resolvedIdx === -1) {
        resolvedIdx = segs.findIndex((s, i) => isSegmentMatch(s, segKey, i));
      }
    }

    if (!targetSeg) return;

    const currentClips = mediaRef.current.videoClips || EMPTY_CLIPS;
    if (mediaRef.current.setActiveClipId) {
      const matchClip = currentClips.find(
        (c) =>
          (targetSeg.id !== undefined && targetSeg.id !== null && c.segmentId === targetSeg.id) ||
          (resolvedIdx >= 0 && c.segmentIndex === resolvedIdx + 1)
      );
      mediaRef.current.setActiveClipId(matchClip ? matchClip.id : null);
    }

    const rawStartSec = resolveVoiceClipStartSec(targetSeg, resolvedIdx >= 0 ? resolvedIdx : 0);
    const playbackDur = playbackRef.current.duration || 0;
    const realVideoDur = videoRef.current?.duration || 0;
    const maxDur = Math.max(playbackDur > 0 ? playbackDur : 0, realVideoDur > 0 ? realVideoDur : 0);
    const seekSec = maxDur > 0 ? Math.max(0, Math.min(maxDur, rawStartSec)) : Math.max(0, rawStartSec);

    playbackRef.current.handleSeek?.(seekSec);
    focusNonceRef.current += 1;
    setTimelineFocusRequest({
      segKey,
      timeSec: seekSec,
      nonce: focusNonceRef.current,
    });
  }, []);

  // Render & Media callbacks
  const handleRenderVideo = useCallback((...args) => renderRef.current.handleRenderVideo?.(...args), []);
  const handleClearVideo = useCallback((...args) => mediaRef.current.handleClearVideo?.(...args), []);
  const handleImportClick = useCallback(() => setLeftTab('media'), []);

  // Script & Series callbacks
  const handleUpdateScript = useCallback((...args) => scriptRef.current.handleUpdateScript?.(...args), []);
  const handleGenerateScript = useCallback((...args) => scriptRef.current.handleGenerateScript?.(...args), []);
  const handleSwitchEpisode = useCallback((...args) => seriesRef.current.handleSwitchEpisode?.(...args), []);
  const handleCreateEpisode = useCallback((customTitle = null) => {
    const safeTitle = typeof customTitle === 'string' ? customTitle : null;
    return seriesRef.current.handleCreateEpisode?.(safeTitle);
  }, []);
  const handleDeleteEpisode = useCallback((...args) => seriesRef.current.handleDeleteEpisode?.(...args), []);
  const handleRenameEpisode = useCallback((...args) => seriesRef.current.handleRenameEpisode?.(...args), []);
  const handleRenameSeries = useCallback((...args) => seriesRef.current.handleRenameSeries?.(...args), []);
  const handleResetAllEpisodes = useCallback((...args) => seriesRef.current.handleResetAllEpisodes?.(...args), []);

  // Modal navigation callbacks
  const handleOpenJobDashboard = useCallback(() => setShowJobDashboard(true), []);
  const handleCloseJobDashboard = useCallback(() => setShowJobDashboard(false), []);
  const handleOpenGeminiRoute = useCallback(() => setShowGeminiRouteModal(true), []);
  const handleCloseGeminiRoute = useCallback(() => setShowGeminiRouteModal(false), []);
  const handleOpenGeminiQuota = useCallback(() => setShowGeminiQuotaModal(true), []);
  const handleCloseGeminiQuota = useCallback(() => setShowGeminiQuotaModal(false), []);
  const handleOpenBatchExportStudio = useCallback(() => setShowBatchExportStudioModal(true), []);
  const handleCloseBatchExportStudio = useCallback(() => setShowBatchExportStudioModal(false), []);

  // Persist Export Studio episode selections while app remains open
  useEffect(() => {
    const eps = Array.isArray(series.activeSeries?.episodes) ? series.activeSeries.episodes : [];
    const withVideo = eps.filter((ep) =>
      Boolean(ep?.sourceVideoPath || ep?.video?.videoPath || ep?.video?.videoId || ep?.videoFile || ep?.video?.videoUrl)
    );
    const validIds = new Set(withVideo.map((e) => String(e.id)));
    if (validIds.size === 0) {
      setExportStudioSelectedEpIds((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const seriesKey = String(series.seriesId || series.activeSeries?.id || 'default');
    if (lastExportStudioSeriesRef.current !== seriesKey) {
      lastExportStudioSeriesRef.current = seriesKey;
      setExportStudioSelectedEpIds(withVideo.map((e) => e.id));
      return;
    }
    setExportStudioSelectedEpIds((prev) => {
      const filtered = prev.filter((id) => validIds.has(String(id)));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [series.seriesId, series.activeSeries]);

  // Immediate episode workspace reset upon loading new video (prevents inheriting stale script/audio)
  const handleVideoSelected = useCallback((vid) => {
    mediaRef.current.handleVideoLoaded?.(vid);
    if (seriesRef.current.episodeId && seriesRef.current.handleSaveEpisodeBackground) {
      seriesRef.current.handleSaveEpisodeBackground(seriesRef.current.episodeId, {
        video: vid,
        scriptData: null,
        speakerRegistry: EMPTY_OBJECT,
        audioGenerated: false,
        audioOutdated: false,
        fullAudioPath: null,
        fullAudioUrl: null,
        renderedVideo: null,
      });
    }
  }, []);

  // Reset from rendered export back to live source video editor preview
  const handleResetToPreview = useCallback(() => {
    if (renderRef.current.setRenderedVideo) {
      renderRef.current.setRenderedVideo(null);
    }
    const sId = seriesRef.current.seriesId;
    const eId = seriesRef.current.episodeId;
    if (sId && eId) {
      saveEpisodeState(sId, eId, { renderedVideo: null });
    }
    if (eId && seriesRef.current.handleSaveEpisodeBackground) {
      seriesRef.current.handleSaveEpisodeBackground(eId, {
        renderedVideo: null,
      });
    }
  }, []);

  const effectiveRenderedVideo = isRenderedRatioMismatch(
    render.renderedVideo,
    currentAspectRatio,
    { width: srcW, height: srcH }
  )
    ? null
    : render.renderedVideo;

  return (
    <JobQueueProvider isAnyJobViewOpen={true}>
      <div className="capcut-app-container">
        {/* Top Application Navbar */}
        <Navbar
          apiKey={persistence.apiKey}
          onSaveApiKey={persistence.handleSaveApiKey}
          isBackendOnline={persistence.isBackendOnline}
          onRenderVideo={handleRenderVideo}
          isRendering={render.isRendering}
          renderProgress={render.renderProgress}
          selectedVideo={media.selectedVideo}
          videoMetadata={media.videoMetadata}
          renderedVideo={effectiveRenderedVideo}
          activeSeries={series.activeSeries}
          activeEpisode={series.activeEpisode}
          seriesId={series.seriesId}
          episodeId={series.episodeId}
          generatingEpisodeId={script.generatingEpisodeId}
          generatingAudioEpisodeId={audio.generatingAudioEpisodeId}
          onSwitchEpisode={handleSwitchEpisode}
          onCreateEpisode={handleCreateEpisode}
          onDeleteEpisode={handleDeleteEpisode}
          onResetAllEpisodes={handleResetAllEpisodes}
          activeTab={leftTab}
          onTabChange={setLeftTab}
          onOpenJobDashboard={handleOpenJobDashboard}
          onOpenGeminiRoute={handleOpenGeminiRoute}
          onOpenGeminiQuota={handleOpenGeminiQuota}
          isGeminiRouteActive={showGeminiRouteModal}
          isGeminiQuotaActive={showGeminiQuotaModal}
          currentAspectRatio={currentAspectRatio}
          onAspectRatioChange={handleAspectRatioChange}
        />

        {/* Backend Offline Dismissible Warning Banner / Toast */}
        {persistence.backendOfflineBanner && (
          <div className="backend-offline-banner" role="alert">
            <AlertTriangle size={16} style={{ color: '#F59E0B', flexShrink: 0 }} />
            <span>Backend offline — ការផ្លាស់ប្ដូររក្សាទុកតែក្នុងម៉ាស៊ីននេះសិន (changes saved locally only)</span>
            <button
              type="button"
              onClick={() => persistence.setBackendOfflineBanner(false)}
              aria-label="Dismiss banner"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Main Video Editing Workspace */}
        <main className="capcut-main-workspace">
          {/* Chinese Drama Dubbing Workflow Stepper Bar */}
          <WorkflowStepper
            leftTab={leftTab}
            onTabChange={setLeftTab}
            isStep1Done={Boolean(media.selectedVideo?.videoId)}
            isStep2Done={Boolean(scriptData?.segments?.length)}
            isStep3Done={Boolean(audio.audioGenerated)}
            isStep4Done={Boolean(audio.audioGenerated && voiceSettings.duckingVolume !== undefined)}
            onGenerateAudio={handleGenerateAudio}
            isGeneratingAudio={audio.isGeneratingAudio}
            audioProgress={audio.audioProgress}
            audioStage={audio.audioStage}
            hasSegments={Boolean(scriptData?.segments?.length)}
          />

          {/* Top 3-Column Suite: Left Tools | Video Monitor | Contextual Inspector */}
          <div className="capcut-top-suite" ref={topSuiteRef}>
            {/* 1. Left Panel: Media Library, AI Script, Subtitles */}
            <div className="top-suite-col-left" style={{ width: leftPanelWidth }}>
              <MediaLibrary
                apiKey={persistence.apiKey}
                selectedVideo={media.selectedVideo}
                videoMetadata={media.videoMetadata}
                videoThumbnails={media.videoThumbnails || EMPTY_ARRAY}
                videoClips={media.videoClips || EMPTY_CLIPS}
                mediaAssets={media.mediaAssets || EMPTY_ARRAY}
                duration={playback.duration}
                onAddClipToTimeline={handleAddClipToTimeline}
                onVideoSelected={handleVideoSelected}
                onRemoveVideo={handleClearVideo}
                scriptData={scriptData}
                onUpdateScript={handleUpdateScript}
                onUpdateSegments={handleUpdateTimelineSegments}
                onGenerateScript={handleGenerateScript}
                isGeneratingScript={script.isGeneratingScript}
                generatingEpisodeId={script.generatingEpisodeId}
                scriptProgress={script.scriptProgress}
                scriptStage={script.scriptStage}
                scriptLogs={script.scriptLogs}
                scriptError={script.scriptError}
                activeTab={leftTab}
                onTabChange={setLeftTab}
                onNavigateToVoice={handleGenerateAudio}
                isGeneratingAudio={audio.isGeneratingAudio}
                generatingAudioEpisodeId={audio.generatingAudioEpisodeId}
                audioProgress={audio.audioProgress}
                audioStage={audio.audioStage}
                onRegenerateSegment={handleRegenerateSingleSegment}
                onTranslateSegment={handleTranslateSingleSegment}
                onUpdateSegmentText={handleUpdateSegmentText}
                speakerRegistry={speakerRegistry || EMPTY_OBJECT}
                onUpdateSpeakerVoice={handleUpdateSpeakerVoice}
                onUpdateSegmentVoice={handleUpdateSegmentVoice}
                onToggleDeliveryType={handleToggleDeliveryType}
                selectedSegmentId={media.selectedSegmentId}
                onSelectSegment={handleSelectSegmentFromScript}
                onDeleteSegment={handleDeleteSegment}
                seriesList={series.seriesList}
                activeSeries={series.activeSeries}
                activeEpisode={series.activeEpisode}
                seriesId={series.seriesId}
                episodeId={series.episodeId}
                seriesGlossary={series.seriesGlossary}
                onSwitchEpisode={handleSwitchEpisode}
                onCreateEpisode={handleCreateEpisode}
                onDeleteEpisode={handleDeleteEpisode}
                onRenameEpisode={handleRenameEpisode}
                onRenameSeries={handleRenameSeries}
                onRefreshSeries={series.refreshSeriesFromServer}
              />
            </div>

            {/* Left Resizer Splitter (Drag Left / Right) */}
            <div
              className={`capcut-panel-splitter ${activeSplitter === 'left' ? 'is-active' : ''}`}
              onMouseDown={(e) => handleStartSplitterDrag(e, 'left')}
              title="Drag left or right to resize Media Library panel"
            />

            {/* 2. Center Panel: Video Preview Monitor */}
            <div className="top-suite-col-center">
              <VideoPlayerPreview
                selectedVideo={media.selectedVideo}
                videoMetadata={media.videoMetadata}
                seriesId={series.seriesId}
                episodeId={series.episodeId}
                scriptData={scriptData}
                renderedVideo={effectiveRenderedVideo}
                setRenderedVideo={render.setRenderedVideo}
                onResetToPreview={handleResetToPreview}
                isRendering={render.isRendering}
                onRenderVideo={handleRenderVideo}
                videoRef={videoRef}
                currentTime={playback.currentTime}
                duration={playback.duration}
                isPlaying={playback.isPlaying}
                onPlayPause={handlePlayPause}
                onSeek={handleSeek}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                voiceSettings={voiceSettings || EMPTY_OBJECT}
                onEnded={handleVideoEnded}
                fullAudioUrl={audio.fullAudioUrl}
                audioGenerated={audio.audioGenerated}
                audioOutdated={audio.audioOutdated}
                onImportClick={handleImportClick}
                onVideoSelected={handleVideoSelected}
                videoClips={media.videoClips || EMPTY_CLIPS}
              />
            </div>

            {/* Right Resizer Splitter (Drag Left / Right) */}
            <div
              className={`capcut-panel-splitter ${activeSplitter === 'right' ? 'is-active' : ''}`}
              onMouseDown={(e) => handleStartSplitterDrag(e, 'right')}
              title="Drag left or right to resize Inspector panel"
            />

            {/* 3. Right Panel: Khmer Voice (TTS), Audio Ducking, Export Settings */}
            <div className="top-suite-col-right" style={{ width: rightPanelWidth }}>
              <VoiceSettings
                settings={voiceSettings || EMPTY_OBJECT}
                onUpdateSettings={handleUpdateVoiceSettings}
                voiceCatalog={audio.ttsVoiceCatalog}
                audioOutdated={audio.audioOutdated}
                previewAudioUrl={
                  audio.fullAudioUrl || scriptData?.segments?.find((s) => s.audioUrl)?.audioUrl || null
                }
                onRenderVideo={handleRenderVideo}
                isRendering={render.isRendering}
                renderProgress={render.renderProgress}
                renderStage={render.renderStage}
                renderedVideo={effectiveRenderedVideo}
                selectedVideo={media.selectedVideo}
                videoMetadata={media.videoMetadata}
                activeEpisode={series.activeEpisode}
                activeSeries={series.activeSeries}
                seriesId={series.seriesId}
                episodeId={series.episodeId}
                batchRender={render.batchRender}
                onOpenBatchExportStudio={handleOpenBatchExportStudio}
                duration={playback.duration}
                selectedClip={media.selectedClip}
                onSplitClip={handleSplitClip}
                onDeleteClip={handleDeleteClip}
                currentTime={playback.currentTime}
                isPlaying={playback.isPlaying}
                scriptData={scriptData}
                onGenerateAudio={handleGenerateAudio}
                isGeneratingAudio={audio.isGeneratingAudio}
                audioProgress={audio.audioProgress}
                audioStage={audio.audioStage}
                audioGenerated={audio.audioGenerated}
                onRegenerateSegment={handleRegenerateSingleSegment}
                onTranslateSegment={handleTranslateSingleSegment}
                speakerRegistry={speakerRegistry || EMPTY_OBJECT}
                onUpdateSpeakerVoice={handleUpdateSpeakerVoice}
                onUpdateSegmentVoice={handleUpdateSegmentVoice}
                onUpdateSegmentText={handleUpdateSegmentText}
                onUpdateSegmentSpeed={audio.handleUpdateSegmentSpeed}
                onToggleDeliveryType={handleToggleDeliveryType}
                onSplitSegment={audio.handleSplitSegment}
                onAutoSplitSegment={clips.handleAutoSplitSegment}
                selectedSegmentId={media.selectedSegmentId}
                onSelectSegment={media.setSelectedSegmentId}
                onDeleteSegment={handleDeleteSegment}
                onUpdateSegments={handleUpdateTimelineSegments}
                onToggleMuteSegment={handleToggleMuteSegment}
                onToggleMuteVideoClip={handleToggleMuteVideoClip}
                onToggleMuteAllCuts={handleToggleMuteAllCuts}
                videoClips={media.videoClips || EMPTY_CLIPS}
                onUpdateScript={handleUpdateScript}
              />
            </div>
          </div>

          {/* Bottom Multi-Track Timeline */}
          <div className="capcut-bottom-timeline">
            <TimelineEditor
              videoRef={videoRef}
              activeTab={leftTab}
              currentTime={playback.currentTime}
              duration={playback.duration}
              isPlaying={playback.isPlaying}
              onSeek={handleSeek}
              onPlayPause={handlePlayPause}
              videoClips={media.videoClips || EMPTY_CLIPS}
              activeClipId={media.activeClipId}
              onSelectClip={handleSelectClip}
              onUpdateClips={handleUpdateClips}
              onSplitClip={handleSplitClip}
              onDeleteClip={handleDeleteClip}
              onDeleteSegment={handleDeleteSegment}
              scriptSegments={scriptData?.segments || EMPTY_SEGMENTS}
              onUpdateSegments={handleUpdateTimelineSegments}
              onToggleMuteSegment={handleToggleMuteSegment}
              onToggleMuteVideoClip={handleToggleMuteVideoClip}
              onToggleMuteAllCuts={handleToggleMuteAllCuts}
              onToggleDeliveryType={handleToggleDeliveryType}
              speakerRegistry={speakerRegistry || EMPTY_OBJECT}
              voiceSettings={voiceSettings || EMPTY_OBJECT}
              onUpdateVoiceSettings={handleUpdateVoiceSettings}
              audioGenerated={audio.audioGenerated}
              selectedVideo={media.selectedVideo}
              videoThumbnails={media.videoThumbnails || EMPTY_ARRAY}
              selectedSegmentId={media.selectedSegmentId}
              onSelectSegment={media.setSelectedSegmentId}
              timelineFocusRequest={timelineFocusRequest}
              onAutoSplitVideo={handleAutoSplitVideo}
              onResetFullVideo={handleResetFullVideo}
              onBridgeGaps={handleBridgeGaps}
              onAutoAlignNoOverlap={handleAutoAlignNoOverlap}
              onResetToSourceTiming={handleResetToSourceTiming}
              onAddSegment={handleAddSegmentAtTime}
              canUndo={undoRedo.canUndo}
              canRedo={undoRedo.canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onGenerateAudio={handleGenerateAudio}
              isGeneratingAudio={audio.isGeneratingAudio}
              onAddClipToTimeline={handleAddClipToTimeline}
              mediaAssets={media.mediaAssets || EMPTY_ARRAY}
              onImportClick={handleImportClick}
              onVideoSelected={handleVideoSelected}
              seriesId={series.seriesId}
              episodeId={series.episodeId}
            />
          </div>
        </main>

        {/* DragonDub Production Job Queue Dashboard Modal (Phase 4.4) */}
        <ErrorBoundary inline name="Job Dashboard" onReset={handleCloseJobDashboard}>
          <JobDashboardModal isOpen={showJobDashboard} onClose={handleCloseJobDashboard} />
        </ErrorBoundary>

        {/* DragonDub Batch Generate Studio Modal (Separated Clean Workflow) */}
        <ErrorBoundary inline name="Gemini Route" onReset={handleCloseGeminiRoute}>
          <GeminiRouteModal
            isOpen={showGeminiRouteModal}
            onClose={handleCloseGeminiRoute}
            onOpenQuotaModal={handleOpenGeminiQuota}
            onOpenExportStudio={handleOpenBatchExportStudio}
            activeSeries={series.activeSeries}
            activeEpisode={series.activeEpisode}
            episodeId={series.episodeId}
            onSwitchEpisode={handleSwitchEpisode}
            onTabChange={setLeftTab}
            onRefreshSeries={series.refreshSeriesFromServer}
            apiKey={persistence.apiKey}
            voiceSettings={voiceSettings || EMPTY_OBJECT}
            currentAspectRatio={currentAspectRatio}
            onAspectRatioChange={handleAspectRatioChange}
            isRendering={render.isRendering}
            batchRender={render.batchRender}
          />
        </ErrorBoundary>

        {/* DragonDub Dedicated Export Studio Modal (Batch Export & Full Video Merge) */}
        <ErrorBoundary inline name="Export Studio" onReset={handleCloseBatchExportStudio}>
          <BatchExportStudioModal
            isOpen={showBatchExportStudioModal}
            onClose={handleCloseBatchExportStudio}
            activeSeries={series.activeSeries}
            activeEpisode={series.activeEpisode}
            episodeId={series.episodeId}
            voiceSettings={voiceSettings || EMPTY_OBJECT}
            currentAspectRatio={currentAspectRatio}
            onAspectRatioChange={handleAspectRatioChange}
            isRendering={render.isRendering}
            batchRender={render.batchRender}
            audioGenerated={audio.audioGenerated}
            previewAudioUrl={
              audio.fullAudioUrl || scriptData?.segments?.find((s) => s.audioUrl)?.audioUrl || null
            }
            selectedEpIds={exportStudioSelectedEpIds}
            onChangeSelectedEpIds={setExportStudioSelectedEpIds}
            allowOriginalAudio={exportStudioAllowOriginalAudio}
            onChangeAllowOriginalAudio={setExportStudioAllowOriginalAudio}
          />
        </ErrorBoundary>

        {/* DragonDub Dedicated Gemini Keys & Model Quota Modal */}
        <ErrorBoundary inline name="Gemini Quota" onReset={handleCloseGeminiQuota}>
          <GeminiQuotaModal
            isOpen={showGeminiQuotaModal}
            onClose={handleCloseGeminiQuota}
            onOpenBatchModal={handleOpenGeminiRoute}
          />
        </ErrorBoundary>
      </div>
    </JobQueueProvider>
  );
}
