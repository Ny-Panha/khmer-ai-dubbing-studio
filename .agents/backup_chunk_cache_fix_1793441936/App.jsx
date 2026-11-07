import React, { useState, useRef, useCallback } from 'react';
import Navbar from './components/Navbar';
import JobDashboardModal from './components/dashboard/JobDashboardModal';
import WorkflowStepper from './components/WorkflowStepper';
import MediaLibrary from './components/MediaLibrary';
import VideoPlayerPreview from './components/VideoPlayerPreview';
import VoiceSettings from './components/VoiceSettings';
import TimelineEditor from './components/TimelineEditor';
import { loadSavedVoiceSettings } from './utils/projectStorage';

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
    onSaveEpisodeBackground: series.handleSaveEpisodeBackground,
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
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    seriesGlossary: series.seriesGlossary,
    onSaveEpisodeBackground: series.handleSaveEpisodeBackground,
    onNavigateToTab: setLeftTab,
  });
  scriptRef.current = script;

  // 8. Multi-Clip Timeline Editing Operations Hook
  const clips = useClipOperations({
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
    duration: playback.duration,
    setDuration: playback.setDuration,
    selectedVideo: media.selectedVideo,
    videoRef,
    scriptData,
    setScriptData,
    speakerRegistry,
    setSpeakerRegistry,
    audioGenerated: audio.audioGenerated,
    setSelectedSegmentId: media.setSelectedSegmentId,
    handleSeek: playback.handleSeek,
    pushUndoSnapshot: undoRedo.pushUndoSnapshot,
    setFullAudioUrl: audio.setFullAudioUrl,
    setFullAudioPath: audio.setFullAudioPath,
    syncAudioTimeoutRef: audio.syncAudioTimeoutRef,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    setAudioOutdated: audio.setAudioOutdated,
  });

  // 9. Project State Auto-Save & LocalStorage Persistence Hook
  const persistence = useProjectPersistence({
    selectedVideo: media.selectedVideo,
    setSelectedVideo: media.setSelectedVideo,
    videoMetadata: media.videoMetadata,
    setVideoMetadata: media.setVideoMetadata,
    scriptData,
    setScriptData,
    speakerRegistry,
    setSpeakerRegistry,
    audioGenerated: audio.audioGenerated,
    setAudioGenerated: audio.setAudioGenerated,
    audioOutdated: audio.audioOutdated,
    setAudioOutdated: audio.setAudioOutdated,
    fullAudioPath: audio.fullAudioPath,
    setFullAudioPath: audio.setFullAudioPath,
    fullAudioUrl: audio.fullAudioUrl,
    setFullAudioUrl: audio.setFullAudioUrl,
    duration: playback.duration,
    setDuration: playback.setDuration,
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
    selectedSegmentId: media.selectedSegmentId,
    setSelectedSegmentId: media.setSelectedSegmentId,
    renderedVideo: render.renderedVideo,
    setRenderedVideo: render.setRenderedVideo,
    voiceSettings,
    setVoiceSettings,
    setVideoThumbnails: media.setVideoThumbnails,
  });
  persistenceRef.current = persistence;

  return (
    <div className="capcut-app-container">
      {/* Top Application Navbar */}
      <Navbar
        apiKey={persistence.apiKey}
        onSaveApiKey={persistence.handleSaveApiKey}
        isBackendOnline={persistence.isBackendOnline}
        onRenderVideo={render.handleRenderVideo}
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
        onSwitchEpisode={series.handleSwitchEpisode}
        onCreateEpisode={series.handleCreateEpisode}
        onDeleteEpisode={series.handleDeleteEpisode}
        onResetAllEpisodes={series.handleResetAllEpisodes}
        onOpenJobDashboard={() => setShowJobDashboard(true)}
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
          onGenerateAudio={audio.handleGenerateAudio}
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
              selectedVideo={media.selectedVideo}
              videoMetadata={media.videoMetadata}
              videoThumbnails={media.videoThumbnails}
              videoClips={media.videoClips}
              mediaAssets={media.mediaAssets}
              currentTime={playback.currentTime}
              duration={playback.duration}
              onAddClipToTimeline={(t, asset) => media.handleAddClipToTimeline(typeof t === 'number' ? t : playback.currentTime, asset)}
              onVideoSelected={media.handleVideoLoaded}
              onRemoveVideo={media.handleClearVideo}
              scriptData={scriptData}
              onUpdateScript={script.handleUpdateScript}
              onUpdateSegments={clips.handleUpdateTimelineSegments}
              onGenerateScript={script.handleGenerateScript}
              isGeneratingScript={script.isGeneratingScript}
              generatingEpisodeId={script.generatingEpisodeId}
              scriptProgress={script.scriptProgress}
              scriptStage={script.scriptStage}
              scriptError={script.scriptError}
              activeTab={leftTab}
              onTabChange={setLeftTab}
              onNavigateToVoice={audio.handleGenerateAudio}
              isGeneratingAudio={audio.isGeneratingAudio}
              generatingAudioEpisodeId={audio.generatingAudioEpisodeId}
              audioProgress={audio.audioProgress}
              audioStage={audio.audioStage}
              onRegenerateSegment={audio.handleRegenerateSingleSegment}
              onUpdateSegmentText={audio.handleUpdateSegmentText}
              speakerRegistry={speakerRegistry}
              onUpdateSpeakerVoice={audio.handleUpdateSpeakerVoice}
              onUpdateSegmentVoice={audio.handleUpdateSegmentVoice}
              onToggleDeliveryType={audio.handleToggleDeliveryType}
              selectedSegmentId={media.selectedSegmentId}
              onSelectSegment={media.setSelectedSegmentId}
              onDeleteSegment={clips.handleDeleteSegment}
              seriesList={series.seriesList}
              activeSeries={series.activeSeries}
              activeEpisode={series.activeEpisode}
              seriesId={series.seriesId}
              episodeId={series.episodeId}
              seriesGlossary={series.seriesGlossary}
              onSwitchEpisode={series.handleSwitchEpisode}
              onCreateEpisode={series.handleCreateEpisode}
              onDeleteEpisode={series.handleDeleteEpisode}
              onRenameEpisode={series.handleRenameEpisode}
              onRenameSeries={series.handleRenameSeries}
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
              isRendering={render.isRendering}
              onRenderVideo={render.handleRenderVideo}
              videoRef={videoRef}
              currentTime={playback.currentTime}
              duration={playback.duration}
              isPlaying={playback.isPlaying}
              onPlayPause={playback.handlePlayPause}
              onSeek={playback.handleSeek}
              onTimeUpdate={playback.handleTimeUpdate}
              onLoadedMetadata={playback.handleLoadedMetadata}
              voiceSettings={voiceSettings}
              onEnded={playback.handleVideoEnded}
              fullAudioUrl={audio.fullAudioUrl}
              audioGenerated={audio.audioGenerated}
              audioOutdated={audio.audioOutdated}
              onImportClick={() => setLeftTab('media')}
              onVideoSelected={media.handleVideoLoaded}
              videoClips={media.videoClips}
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
              settings={voiceSettings}
              onUpdateSettings={audio.handleUpdateVoiceSettings}
              voiceCatalog={audio.ttsVoiceCatalog}
              audioOutdated={audio.audioOutdated}
              previewAudioUrl={
                audio.fullAudioUrl || scriptData?.segments?.find((s) => s.audioUrl)?.audioUrl || null
              }
              onRenderVideo={render.handleRenderVideo}
              isRendering={render.isRendering}
              renderProgress={render.renderProgress}
              renderStage={render.renderStage}
              renderedVideo={render.renderedVideo}
              selectedVideo={media.selectedVideo}
              videoMetadata={media.videoMetadata}
              duration={playback.duration}
              selectedClip={media.selectedClip}
              onSplitClip={clips.handleSplitClip}
              onDeleteClip={clips.handleDeleteClip}
              currentTime={playback.currentTime}
              isPlaying={playback.isPlaying}
              scriptData={scriptData}
              onGenerateAudio={audio.handleGenerateAudio}
              isGeneratingAudio={audio.isGeneratingAudio}
              audioProgress={audio.audioProgress}
              audioStage={audio.audioStage}
              audioGenerated={audio.audioGenerated}
              onRegenerateSegment={audio.handleRegenerateSingleSegment}
              speakerRegistry={speakerRegistry}
              onUpdateSpeakerVoice={audio.handleUpdateSpeakerVoice}
              onUpdateSegmentVoice={audio.handleUpdateSegmentVoice}
              onUpdateSegmentText={audio.handleUpdateSegmentText}
              onUpdateSegmentSpeed={audio.handleUpdateSegmentSpeed}
              onToggleDeliveryType={audio.handleToggleDeliveryType}
              onSplitSegment={audio.handleSplitSegment}
              onAutoSplitSegment={clips.handleAutoSplitSegment}
              selectedSegmentId={media.selectedSegmentId}
              onSelectSegment={media.setSelectedSegmentId}
              onDeleteSegment={clips.handleDeleteSegment}
              onUpdateSegments={clips.handleUpdateTimelineSegments}
              onToggleMuteSegment={clips.handleToggleMuteSegment}
              onToggleMuteVideoClip={clips.handleToggleMuteVideoClip}
              onToggleMuteAllCuts={clips.handleToggleMuteAllCuts}
              videoClips={media.videoClips}
              onUpdateScript={script.handleUpdateScript}
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
            onSeek={playback.handleSeek}
            onPlayPause={playback.handlePlayPause}
            videoClips={media.videoClips}
            activeClipId={media.activeClipId}
            onSelectClip={clips.handleSelectClip}
            onUpdateClips={clips.handleUpdateClips}
            onSplitClip={clips.handleSplitClip}
            onDeleteClip={clips.handleDeleteClip}
            onDeleteSegment={clips.handleDeleteSegment}
            scriptSegments={scriptData?.segments || []}
            onUpdateSegments={clips.handleUpdateTimelineSegments}
            onToggleMuteSegment={clips.handleToggleMuteSegment}
            onToggleMuteVideoClip={clips.handleToggleMuteVideoClip}
            onToggleMuteAllCuts={clips.handleToggleMuteAllCuts}
            onToggleDeliveryType={audio.handleToggleDeliveryType}
            speakerRegistry={speakerRegistry}
            voiceSettings={voiceSettings}
            onUpdateVoiceSettings={audio.handleUpdateVoiceSettings}
            audioGenerated={audio.audioGenerated}
            selectedVideo={media.selectedVideo}
            videoThumbnails={media.videoThumbnails}
            selectedSegmentId={media.selectedSegmentId}
            onSelectSegment={media.setSelectedSegmentId}
            onAutoSplitVideo={clips.handleAutoSplitVideo}
            onResetFullVideo={clips.handleResetFullVideo}
            onBridgeGaps={clips.handleBridgeGaps}
            onAutoAlignNoOverlap={clips.handleAutoAlignNoOverlap}
            onResetToSourceTiming={clips.handleResetToSourceTiming}
            onAddSegment={clips.handleAddSegmentAtTime}
            canUndo={undoRedo.canUndo}
            canRedo={undoRedo.canRedo}
            onUndo={undoRedo.handleUndo}
            onRedo={undoRedo.handleRedo}
            onGenerateAudio={audio.handleGenerateAudio}
            isGeneratingAudio={audio.isGeneratingAudio}
            onAddClipToTimeline={(t, asset) => media.handleAddClipToTimeline(typeof t === 'number' ? t : playback.currentTime, asset)}
            mediaAssets={media.mediaAssets}
          />
        </div>
      </main>

      {/* DragonDub Production Job Queue Dashboard Modal (Phase 4.4) */}
      <JobDashboardModal isOpen={showJobDashboard} onClose={() => setShowJobDashboard(false)} />
    </div>
  );
}
