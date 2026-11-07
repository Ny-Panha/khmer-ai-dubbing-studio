import React, { useState, useRef, useCallback } from 'react';
import Navbar from './components/Navbar';
import JobDashboardModal from './components/dashboard/JobDashboardModal';
import GeminiRouteModal from './components/dashboard/GeminiRouteModal';
import WorkflowStepper from './components/WorkflowStepper';
import MediaLibrary from './components/MediaLibrary';
import VideoPlayerPreview from './components/VideoPlayerPreview';
import VoiceSettings from './components/VoiceSettings';
import TimelineEditor from './components/TimelineEditor';
import { loadSavedVoiceSettings } from './utils/projectStorage';
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
  const [scriptData, setScriptData] = useState(null);
  const [speakerRegistry, setSpeakerRegistry] = useState({});
  const [voiceSettings, setVoiceSettings] = useState(loadSavedVoiceSettings);
  const [audioGenerated, setAudioGenerated] = useState(false);
  const [audioOutdated, setAudioOutdated] = useState(false);
  const [fullAudioPath, setFullAudioPath] = useState(null);
  const [fullAudioUrl, setFullAudioUrl] = useState(null);

  const topSuiteRef = useRef(null);
  const videoRef = useRef(null);
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
    audioProgressTimerRef: audioRef.current.audioProgressTimerRef,
  });

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
    renderedVideo: renderRef.current.renderedVideo || null,
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
    audioGenerated: audio.audioGenerated,
    speakerRegistry,
    voiceSettings,
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
    pushHistory: undoRedo.pushHistory,
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
    pushHistory: undoRedo.pushHistory,
    pushUndoSnapshot: undoRedo.pushHistory,
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
  const handleUpdateVoiceSettings = useCallback((...args) => audioRef.current.handleUpdateVoiceSettings?.(...args), []);
  const handleRegenerateSingleSegment = useCallback((...args) => audioRef.current.handleRegenerateSingleSegment?.(...args), []);
  const handleUpdateSegmentText = useCallback((...args) => audioRef.current.handleUpdateSegmentText?.(...args), []);
  const handleUpdateSpeakerVoice = useCallback((...args) => audioRef.current.handleUpdateSpeakerVoice?.(...args), []);
  const handleUpdateSegmentVoice = useCallback((...args) => audioRef.current.handleUpdateSegmentVoice?.(...args), []);

  // Playback callbacks
  const handleSeek = useCallback((...args) => playbackRef.current.handleSeek?.(...args), []);
  const handlePlayPause = useCallback((...args) => playbackRef.current.handlePlayPause?.(...args), []);
  const handleTimeUpdate = useCallback((...args) => playbackRef.current.handleTimeUpdate?.(...args), []);
  const handleLoadedMetadata = useCallback((...args) => playbackRef.current.handleLoadedMetadata?.(...args), []);
  const handleVideoEnded = useCallback((...args) => playbackRef.current.handleVideoEnded?.(...args), []);

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
    if (seriesRef.current.episodeId && seriesRef.current.handleSaveEpisodeBackground) {
      seriesRef.current.handleSaveEpisodeBackground(seriesRef.current.episodeId, {
        renderedVideo: null,
      });
    }
  }, []);

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
          renderedVideo={render.renderedVideo}
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
        />

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
                onUpdateSegmentText={handleUpdateSegmentText}
                speakerRegistry={speakerRegistry || EMPTY_OBJECT}
                onUpdateSpeakerVoice={handleUpdateSpeakerVoice}
                onUpdateSegmentVoice={handleUpdateSegmentVoice}
                onToggleDeliveryType={handleToggleDeliveryType}
                selectedSegmentId={media.selectedSegmentId}
                onSelectSegment={media.setSelectedSegmentId}
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
                seriesId={series.seriesId}
                episodeId={series.episodeId}
                scriptData={scriptData}
                renderedVideo={render.renderedVideo}
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
                renderedVideo={render.renderedVideo}
                selectedVideo={media.selectedVideo}
                videoMetadata={media.videoMetadata}
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
            />
          </div>
        </main>

        {/* DragonDub Production Job Queue Dashboard Modal (Phase 4.4) */}
        <JobDashboardModal isOpen={showJobDashboard} onClose={handleCloseJobDashboard} />

        {/* DragonDub Gemini Multi-Key Route Studio Modal (Clean Full Dashboard) */}
        <GeminiRouteModal
          isOpen={showGeminiRouteModal}
          onClose={handleCloseGeminiRoute}
          activeSeries={series.activeSeries}
          activeEpisode={series.activeEpisode}
          seriesId={series.seriesId}
          episodeId={series.episodeId}
          onSwitchEpisode={handleSwitchEpisode}
          onTabChange={setLeftTab}
          onRefreshSeries={series.refreshSeriesFromServer}
          apiKey={persistence.apiKey}
        />
      </div>
    </JobQueueProvider>
  );
}
