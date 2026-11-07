import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import Navbar from './components/Navbar';
import JobDashboardModal from './components/dashboard/JobDashboardModal';
import GeminiRouteModal from './components/dashboard/GeminiRouteModal';
import VideoPlayerPreview from './components/VideoPlayerPreview';
import { loadSavedVoiceSettings } from './utils/projectStorage';
import { JobQueueProvider } from './context/JobQueueContext';

// Workspace Architecture Components
import { STEP_IDS } from './steps/registry';
import StageRail from './components/workspace/StageRail';
import MediaPanel from './components/workspace/MediaPanel';
import StageSettingsPanel from './components/workspace/StageSettingsPanel';
import WorkspaceToolbar from './components/workspace/WorkspaceToolbar';
import BottomStatusStrip from './components/workspace/BottomStatusStrip';
import InlineTranslatePanel from './components/workspace/InlineTranslatePanel';
import ThinSeekStrip from './steps/script/ThinSeekStrip';
import TranscriptSegmentList from './features/segment-list/TranscriptSegmentList';
import ClipInspectorPanel from './components/voice/ClipInspectorPanel';
import './components/workspace/WorkspaceLayout.css';

// Icons for overview card
import { Film, Sparkles, ChevronLeft, ChevronRight, Layers, AlertTriangle } from 'lucide-react';
import { formatTimecode } from './utils/formatTime';

// Hoisted immutable fallbacks (prevents prop churning and broken memoization)
const EMPTY_SEGMENTS = Object.freeze([]);
const EMPTY_CLIPS = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

// Custom Architectural Hooks (Modularized for clean maintainability & debugging)
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
  // Single Screen Workspace Mode ('import' | 'script' | 'voice' | 'demucs' | 'mix-export')
  const [workspaceMode, setWorkspaceMode] = useState(STEP_IDS.SCRIPT);

  // Panel Collapsible States
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // Search in transcript
  const [transcriptSearch, setTranscriptSearch] = useState('');

  // Re-translate Overwrite confirmation modal state
  const [showConfirmRetranslate, setShowConfirmRetranslate] = useState(false);

  // Demucs Separation State
  const [isCleanBgReady, setIsCleanBgReady] = useState(false);
  const [isSeparatingAudio, setIsSeparatingAudio] = useState(false);
  const [separationProgress, setSeparationProgress] = useState(0);
  const [separationError, setSeparationError] = useState(null);

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

  // Stable ref-delegated callbacks
  const handleSetDuration = useCallback((dur) => playbackRef.current.setDuration?.(dur), []);
  const handleSetCurrentTime = useCallback((t) => playbackRef.current.setCurrentTime?.(t), []);
  const handleSetRenderedVideo = useCallback((v) => renderRef.current.setRenderedVideo?.(v), []);
  const handleClearHistory = useCallback(() => undoRedoRef.current.clearHistory?.(), []);
  const handleSetScriptError = useCallback((err) => scriptRef.current.setScriptError?.(err), []);
  const handleSetIsGeneratingScript = useCallback((gen) => scriptRef.current.setIsGeneratingScript?.(gen), []);

  // 1. Workspace Media Hook (Videos, Clips, Thumbnails, and Selection)
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
  });

  // 2. Undo / Redo History Hook
  const undoRedo = useUndoRedo({
    scriptData,
    setScriptData,
  });

  // 3. Video Playback & Seek Hook
  const playback = useVideoPlayback({
    videoRef,
    selectedVideo: media.selectedVideo,
    videoClips: media.videoClips,
    selectedClip: media.selectedClip,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
    setSelectedSegmentId: media.setSelectedSegmentId,
    renderedVideo: renderRef.current.renderedVideo,
    scriptData,
  });
  playbackRef.current = playback;

  // 4. Series Manager Hook
  const series = useSeriesManager({
    selectedVideo: media.selectedVideo,
    videoMetadata: media.videoMetadata,
    scriptData,
    renderedVideo: renderRef.current.renderedVideo,
    fullAudioPath,
    speakerRegistry,
    voiceSettings,
    videoClips: media.videoClips,
    videoThumbnails: media.videoThumbnails,
    setScriptData,
    setRenderedVideo: handleSetRenderedVideo,
    setFullAudioPath,
    setFullAudioUrl,
    setSpeakerRegistry,
    setVoiceSettings,
    setSelectedVideo: media.setSelectedVideo,
    setVideoMetadata: media.setVideoMetadata,
    setVideoClips: media.setVideoClips,
    setVideoThumbnails: media.setVideoThumbnails,
    setAudioGenerated,
    setAudioOutdated,
    clearHistory: handleClearHistory,
    setCurrentTime: handleSetCurrentTime,
    setDuration: handleSetDuration,
    setSelectedSegmentId: media.setSelectedSegmentId,
    setActiveClipId: media.setActiveClipId,
    audioProgressTimerRef: audioRef.current.audioProgressTimerRef,
    activeRequestRef,
    setLeftTab,
  });

  // 5. Project Persistence & API Key Hook
  const persistence = useProjectPersistence({
    activeRequestRef,
    selectedVideo: media.selectedVideo,
    activeSeries: series.activeSeries,
    activeEpisode: series.activeEpisode,
    scriptData,
    speakerRegistry,
    voiceSettings,
    videoClips: media.videoClips,
    videoThumbnails: media.videoThumbnails,
    duration: playback.duration,
    currentTime: playback.currentTime,
    renderedVideo: renderRef.current.renderedVideo,
    fullAudioPath,
    fullAudioUrl,
    audioGenerated,
    audioOutdated,
    setScriptData,
    setSpeakerRegistry,
    setVoiceSettings,
    setSelectedVideo: media.setSelectedVideo,
    setVideoMetadata: media.setVideoMetadata,
    setVideoClips: media.setVideoClips,
    setVideoThumbnails: media.setVideoThumbnails,
    setAudioGenerated,
    setAudioOutdated,
    setFullAudioPath,
    setFullAudioUrl,
    setDuration: handleSetDuration,
    setCurrentTime: handleSetCurrentTime,
    setSelectedSegmentId: media.setSelectedSegmentId,
    setActiveClipId: media.setActiveClipId,
    setRenderedVideo: handleSetRenderedVideo,
    handleSaveEpisodeBackground: series.handleSaveEpisodeBackground,
    isWizardMode: true,
  });

  // 6. AI Dubbing & TTS Generation Hook
  const audio = useAudioDubbing({
    scriptData,
    setScriptData,
    pushHistory: undoRedo.pushHistory,
    voiceSettings,
    setVoiceSettings,
    speakerRegistry,
    setSpeakerRegistry,
    setAudioGenerated,
    setAudioOutdated,
    setFullAudioPath,
    setFullAudioUrl,
    selectedVideo: media.selectedVideo,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    activeSeries: series.activeSeries,
    handleSaveEpisodeBackground: series.handleSaveEpisodeBackground,
    activeRequestRef,
  });

  // 7. Video Rendering Hook
  const render = useVideoRender({
    selectedVideo: media.selectedVideo,
    videoMetadata: media.videoMetadata,
    scriptData,
    voiceSettings,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    activeSeries: series.activeSeries,
    handleSaveEpisodeBackground: series.handleSaveEpisodeBackground,
  });

  // 8. Script Generation Workflow Hook
  const script = useScriptWorkflow({
    selectedVideo: media.selectedVideo,
    activeSeries: series.activeSeries,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    seriesGlossary: series.seriesGlossary,
    apiKey: persistence.apiKey,
    setScriptData,
    setSpeakerRegistry,
    setLeftTab,
    pushHistory: undoRedo.pushHistory,
    clearHistory: handleClearHistory,
    setScriptError: handleSetScriptError,
    setIsGeneratingScript: handleSetIsGeneratingScript,
    activeRequestRef,
    onNavigateToStep: (stepId) => setWorkspaceMode(stepId),
  });

  // 9. Timeline Clip Operations Hook
  const clips = useClipOperations({
    duration: playback.duration,
    currentTime: playback.currentTime,
    videoRef,
    pushHistory: undoRedo.pushHistory,
    scriptData,
    setScriptData,
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

  // Sync ref holders every render for zero-prop-churn child components
  mediaRef.current = media;
  seriesRef.current = series;
  undoRedoRef.current = undoRedo;
  playbackRef.current = playback;
  audioRef.current = audio;
  renderRef.current = render;
  scriptRef.current = script;
  clipsRef.current = clips;

  // Stable callbacks
  const handleDeleteSegment = useCallback((...args) => clipsRef.current.handleDeleteSegment?.(...args), []);
  const handleUpdateTimelineSegments = useCallback((...args) => clipsRef.current.handleUpdateTimelineSegments?.(...args), []);
  const handleToggleDeliveryType = useCallback((...args) => audioRef.current.handleToggleDeliveryType?.(...args), []);
  const handleAutoAlignNoOverlap = useCallback((...args) => clipsRef.current.handleAutoAlignNoOverlap?.(...args), []);
  const handleResetToSourceTiming = useCallback((...args) => clipsRef.current.handleResetToSourceTiming?.(...args), []);
  const handleAddSegmentAtTime = useCallback((...args) => clipsRef.current.handleAddSegmentAtTime?.(...args), []);

  // Undo / Redo callbacks
  const handleUndo = useCallback((...args) => undoRedoRef.current.handleUndo?.(...args), []);
  const handleRedo = useCallback((...args) => undoRedoRef.current.handleRedo?.(...args), []);

  // Audio Dubbing callbacks
  const handleGenerateAudio = useCallback((...args) => audioRef.current.handleGenerateAudio?.(...args), []);
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

  // Mode Selection Callback
  const handleSelectMode = useCallback((modeId) => {
    setWorkspaceMode(modeId);
  }, []);

  // Check Demucs status whenever selected video changes
  useEffect(() => {
    if (!media.selectedVideo) {
      setIsCleanBgReady(false);
      return;
    }
    const videoRefName = media.selectedVideo?.videoUrl || media.selectedVideo?.filePath || media.selectedVideo?.fileName || media.selectedVideo?.name;
    if (!videoRefName) return;

    fetch('/api/audio/separation-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: videoRefName }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && data.available) {
          setIsCleanBgReady(true);
        } else {
          setIsCleanBgReady(false);
        }
      })
      .catch(() => setIsCleanBgReady(false));
  }, [media.selectedVideo]);

  // Demucs Separation Trigger
  const handleStartDemucsSeparation = useCallback(async () => {
    if (!media.selectedVideo || isSeparatingAudio) return;
    const videoRefName = media.selectedVideo?.videoUrl || media.selectedVideo?.filePath || media.selectedVideo?.fileName || media.selectedVideo?.name;
    if (!videoRefName) return;

    setIsSeparatingAudio(true);
    setSeparationProgress(1);
    setSeparationError(null);

    let pollInterval = null;
    try {
      pollInterval = setInterval(async () => {
        try {
          const pRes = await fetch(`/api/audio/separation-progress?videoPath=${encodeURIComponent(videoRefName)}`);
          const pData = await pRes.json();
          if (pData && pData.success && typeof pData.progress === 'number' && pData.progress > 0) {
            setSeparationProgress(pData.progress);
          }
        } catch (_) {}
      }, 700);

      const res = await fetch('/api/audio/separate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath: videoRefName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.noVocalsUrl) {
        setSeparationProgress(100);
        setIsCleanBgReady(true);
        window.dispatchEvent(new CustomEvent('demucs-separation-ready', {
          detail: { noVocalsUrl: data.noVocalsUrl }
        }));
      } else {
        throw new Error(data.error || (res.status === 409 ? 'Demucs AI កំពុងដំណើរការបំបែកសំឡេង (...)។ សូមរង់ចាំឱ្យចប់ជាមុនសិន ទើបអាចបំបែកភាគបន្ទាប់បាន។' : 'ការបំបែកសំឡេង Demucs ជួបបញ្ហា'));
      }
    } catch (err) {
      console.error('[App] Demucs Separation error:', err);
      setSeparationError(err.message || 'ការបំបែកសំឡេង Demucs ជួបបញ្ហា');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setIsSeparatingAudio(false);
    }
  }, [media.selectedVideo, isSeparatingAudio]);

  // Demucs Kill Trigger
  const handleKillDemucs = useCallback(async () => {
    try {
      await fetch('/api/audio/separate-kill', { method: 'POST' });
      setIsSeparatingAudio(false);
      setSeparationError('បានបញ្ឈប់ដំណើរការ Demucs AI');
    } catch (err) {
      console.error('[App] Kill Demucs error:', err);
    }
  }, []);

  // Compute live workflow state for Step gates and completed badges
  const workflowState = useMemo(() => ({
    selectedVideo: media.selectedVideo,
    activeEpisode: series.activeEpisode,
    scriptData,
    audioGenerated: audio.audioGenerated,
    hasDemucs: isCleanBgReady || Boolean(series.activeEpisode?.hasDemucs || series.activeEpisode?.cleanBgmPath),
    isDemucsDone: isCleanBgReady || Boolean(series.activeEpisode?.hasDemucs || series.activeEpisode?.cleanBgmPath),
    cleanBgmPath: series.activeEpisode?.cleanBgmPath,
    renderedVideo: render.renderedVideo,
  }), [
    media.selectedVideo,
    series.activeEpisode,
    scriptData,
    audio.audioGenerated,
    isCleanBgReady,
    render.renderedVideo,
  ]);

  // Script & Series callbacks
  const handleUpdateScript = useCallback((...args) => scriptRef.current.handleUpdateScript?.(...args), []);
  const handleSwitchEpisode = useCallback((...args) => seriesRef.current.handleSwitchEpisode?.(...args), []);
  const handleCreateEpisode = useCallback((...args) => seriesRef.current.handleCreateEpisode?.(...args), []);
  const handleDeleteEpisode = useCallback((...args) => seriesRef.current.handleDeleteEpisode?.(...args), []);
  const handleRenameEpisode = useCallback((...args) => seriesRef.current.handleRenameEpisode?.(...args), []);
  const handleRenameSeries = useCallback((...args) => seriesRef.current.handleRenameSeries?.(...args), []);
  const handleResetAllEpisodes = useCallback((...args) => seriesRef.current.handleResetAllEpisodes?.(...args), []);

  // Modal navigation callbacks
  const handleOpenJobDashboard = useCallback(() => setShowJobDashboard(true), []);
  const handleCloseJobDashboard = useCallback(() => setShowJobDashboard(false), []);
  const handleOpenGeminiRoute = useCallback(() => setShowGeminiRouteModal(true), []);
  const handleCloseGeminiRoute = useCallback(() => setShowGeminiRouteModal(false), []);

  // Video Selected Callback
  const handleVideoSelected = useCallback((vid) => {
    mediaRef.current.handleVideoLoaded?.(vid);
    if (seriesRef.current.episodeId && seriesRef.current.handleSaveEpisodeBackground) {
      seriesRef.current.handleSaveEpisodeBackground(seriesRef.current.episodeId, {
        video: vid,
        scriptData: null,
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

  // Derived transcript segments & metrics
  const segments = scriptData?.segments || EMPTY_SEGMENTS;
  const hasSegments = segments.length > 0;

  const selectedSegment = useMemo(() => {
    if (media.selectedSegmentId === null || media.selectedSegmentId === undefined) return segments[0] || null;
    return segments.find((s, idx) => s.id === media.selectedSegmentId || idx === media.selectedSegmentId) || segments[0] || null;
  }, [segments, media.selectedSegmentId]);

  const selectedSegmentIndex = useMemo(() => {
    if (!selectedSegment) return -1;
    return segments.findIndex((s) => s.id === selectedSegment.id);
  }, [segments, selectedSegment]);

  const overCount = useMemo(() => {
    return segments.filter((s) => typeof s.audioDurationSec === 'number' && typeof s.durationSec === 'number' && s.audioDurationSec > (s.durationSec + 0.3)).length;
  }, [segments]);

  return (
    <JobQueueProvider isAnyJobViewOpen={true}>
      <div className="workspace-root">
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
          onNavigateToStep={handleSelectMode}
        />

        {/* Unified CapCut-Style Workspace Body */}
        <div className="workspace-body">
          {/* 1. Left Rail (5 Stages Status List — Widen to 210px) */}
          <div
            className="workspace-rail-container"
            style={{ width: isRailCollapsed ? 56 : 210 }}
          >
            <StageRail
              currentMode={workspaceMode}
              onSelectMode={handleSelectMode}
              workflowState={workflowState}
              isGeneratingAudio={audio.isGeneratingAudio}
              audioProgress={audio.audioProgress}
              isCollapsed={isRailCollapsed}
              onToggleCollapse={() => setIsRailCollapsed((prev) => !prev)}
            />
          </div>

          {/* 2. Left Media Panel (Collapsible) */}
          <div
            className="workspace-media-container"
            style={{
              width: isLeftPanelOpen ? 300 : 0,
              minWidth: isLeftPanelOpen ? 300 : 0,
              display: isLeftPanelOpen ? 'flex' : 'none',
            }}
          >
            <MediaPanel
              seriesList={series.seriesList}
              activeSeries={series.activeSeries}
              activeEpisode={series.activeEpisode}
              seriesId={series.seriesId}
              episodeId={series.episodeId}
              onSwitchEpisode={handleSwitchEpisode}
              onCreateEpisode={handleCreateEpisode}
              onDeleteEpisode={handleDeleteEpisode}
              onRenameEpisode={handleRenameEpisode}
              onRenameSeries={handleRenameSeries}
              selectedVideo={media.selectedVideo}
              videoMetadata={media.videoMetadata}
              onVideoSelected={handleVideoSelected}
              onRemoveVideo={handleClearVideo}
              onClosePanel={() => setIsLeftPanelOpen(false)}
            />
          </div>

          {/* Floating Button to re-open Media Panel when collapsed */}
          {!isLeftPanelOpen && (
            <button
              type="button"
              className="workspace-panel-toggle-btn left-toggle"
              style={{ left: isRailCollapsed ? 56 : 210 }}
              onClick={() => setIsLeftPanelOpen(true)}
              title="បើក Media Panel ឡើងវិញ (Expand Media)"
            >
              <ChevronRight size={14} />
            </button>
          )}

          {/* 3. CENTRE WORKING COLUMN (Always Mounted, Never Unmounts) */}
          <div className="workspace-centre-container">
            {/* Top Video Player Monitor & Seek Strip */}
            <div className="workspace-centre-player-section">
              <div className="workspace-centre-player-box">
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
                  onImportClick={() => setIsLeftPanelOpen(true)}
                  onVideoSelected={handleVideoSelected}
                  videoClips={media.videoClips || EMPTY_CLIPS}
                />
              </div>

              {/* Persistent Thin Seek Strip */}
              <ThinSeekStrip
                currentTime={playback.currentTime}
                duration={playback.duration}
                segments={segments}
                selectedSegmentId={media.selectedSegmentId}
                onSeek={handleSeek}
                onSelectSegment={media.setSelectedSegmentId}
              />
            </div>

            {/* Bottom Working Area: Dynamic based on mode and segment presence */}
            <div className="workspace-centre-segments-section">
              {workspaceMode === 'import' ? (
                /* Point 3: Episode Overview Summary of all episodes in Import mode (No floating card) */
                <div className="workspace-episodes-overview-wrap">
                  <div className="workspace-episodes-overview-header">
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                      សង្ខេបស្ថានភាពភាគទាំងអស់ (Episodes Overview)
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {(series.activeSeries?.episodes || []).length} ភាគសរុប
                    </span>
                  </div>

                  <table className="workspace-overview-table">
                    <thead>
                      <tr>
                        <th>ភាគ (Episode)</th>
                        <th>វីដេអូ (Video)</th>
                        <th>Script</th>
                        <th>Voice (TTS)</th>
                        <th>Demucs (BGM)</th>
                        <th>Export</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(series.activeSeries?.episodes || []).map((ep, idx) => {
                        const isSelected = ep.id === series.episodeId;
                        const hasEpVideo = Boolean(ep.video?.videoId || ep.video?.videoUrl);
                        const hasEpScript = Boolean((ep.scriptData?.segments && ep.scriptData.segments.length > 0) || ep.scriptData?.hasScript);
                        const hasEpVoice = Boolean(ep.audioGenerated && !ep.audioOutdated);
                        const hasEpDemucs = Boolean(ep.hasDemucs || ep.cleanBgmPath);
                        const hasEpExport = Boolean(ep.renderedVideo);
                        const epNum = ep.episodeNumber || (idx + 1);

                        return (
                          <tr
                            key={ep.id}
                            onClick={() => handleSwitchEpisode?.(ep.id)}
                            className={`workspace-overview-row ${isSelected ? 'is-active' : ''}`}
                          >
                            <td style={{ fontWeight: 600, color: isSelected ? '#38bdf8' : '#e2e8f0' }}>
                              EP {epNum} {ep.displayTitle || ep.title ? `— ${ep.displayTitle || ep.title}` : ''}
                            </td>
                            <td>
                              {hasEpVideo ? (
                                <span style={{ color: '#22c55e', fontSize: 11 }}>✓ {formatTimecode(ep.video?.duration || 0)}</span>
                              ) : (
                                <span style={{ color: '#64748b' }}>—</span>
                              )}
                            </td>
                            <td>
                              {hasEpScript ? (
                                <span style={{ color: '#a855f7', fontSize: 11 }}>✓ {ep.scriptData?.segments?.length || ep.scriptData?.totalSegments || 'Ready'} ឃ្លា</span>
                              ) : (
                                <span style={{ color: '#64748b' }}>—</span>
                              )}
                            </td>
                            <td>
                              {hasEpVoice ? (
                                <span style={{ color: '#38bdf8', fontSize: 11 }}>✓ Ready</span>
                              ) : (
                                <span style={{ color: '#64748b' }}>—</span>
                              )}
                            </td>
                            <td>
                              {hasEpDemucs ? (
                                <span style={{ color: '#10b981', fontSize: 11 }}>✓ Clean</span>
                              ) : (
                                <span style={{ color: '#64748b' }}>—</span>
                              )}
                            </td>
                            <td>
                              {hasEpExport ? (
                                <span style={{ color: '#10b981', fontSize: 11 }}>✓ Exported</span>
                              ) : (
                                <span style={{ color: '#64748b' }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : hasSegments ? (
                <>
                  <WorkspaceToolbar
                    workspaceMode={workspaceMode}
                    segmentsCount={segments.length}
                    overCount={overCount}
                    searchQuery={transcriptSearch}
                    onSearchChange={setTranscriptSearch}
                    onReTranslateClick={() => setShowConfirmRetranslate(true)}
                    onAutoAlign={handleAutoAlignNoOverlap}
                    onResetTiming={handleResetToSourceTiming}
                    onAddSegment={handleAddSegmentAtTime}
                    canUndo={undoRedo.canUndo}
                    canRedo={undoRedo.canRedo}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    onOpenKeyModal={handleOpenGeminiRoute}
                    onGenerateAllVoice={handleGenerateAudio}
                    isGeneratingAudio={audio.isGeneratingAudio}
                    audioProgress={audio.audioProgress}
                    isCleanBgReady={isCleanBgReady}
                    onRenderVideo={handleRenderVideo}
                    isRendering={render.isRendering}
                    renderProgress={render.renderProgress}
                  />

                  <TranscriptSegmentList
                    segments={segments}
                    selectedSegmentId={media.selectedSegmentId}
                    onSelectSegment={media.setSelectedSegmentId}
                    onUpdateSegments={handleUpdateTimelineSegments}
                    onUpdateScript={handleUpdateScript}
                    onRegenerateSegment={handleRegenerateSingleSegment}
                    onDeleteSegment={handleDeleteSegment}
                    onToggleDeliveryType={handleToggleDeliveryType}
                    searchQuery={transcriptSearch}
                  />
                </>
              ) : (
                /* Inline Translate Run Panel when in other modes with no segments (In-Flow) */
                <InlineTranslatePanel
                  selectedVideo={media.selectedVideo}
                  videoMetadata={media.videoMetadata}
                  activeSeries={series.activeSeries}
                  activeEpisode={series.activeEpisode}
                  seriesId={series.seriesId}
                  episodeId={series.episodeId}
                  onRefreshSeries={series.refreshSeriesFromServer}
                  onOpenGeminiRoute={handleOpenGeminiRoute}
                  apiKey={persistence.apiKey}
                />
              )}
            </div>
          </div>

          {/* Floating Button to re-open Right Panel when collapsed */}
          {!isRightPanelOpen && (
            <button
              type="button"
              className="workspace-panel-toggle-btn right-toggle"
              style={{ right: 0 }}
              onClick={() => setIsRightPanelOpen(true)}
              title="បើក Inspector & Settings Panel (Expand)"
            >
              <ChevronLeft size={14} />
            </button>
          )}

          {/* 4. RIGHT PANEL: Inspector (Top) + Stage Settings (Bottom) */}
          <div
            className="workspace-right-container"
            style={{
              width: isRightPanelOpen ? 320 : 0,
              minWidth: isRightPanelOpen ? 320 : 0,
              display: isRightPanelOpen ? 'flex' : 'none',
            }}
          >
            {/* Header: Quiet label, no ALL-CAPS bar */}
            <div className="workspace-right-header">
              <span className="workspace-quiet-label">
                ការកំណត់ (Inspector & Settings)
              </span>
              <button
                type="button"
                className="workspace-toolbar-btn icon-only"
                style={{ padding: '2px 5px', border: 'none', background: 'transparent' }}
                onClick={() => setIsRightPanelOpen(false)}
                title="បង្រួម Right Panel (Collapse)"
              >
                <ChevronRight size={14} color="#64748b" />
              </button>
            </div>

            <div className="workspace-right-body">
              {/* Top: Selected Segment Inspector */}
              <div className="workspace-inspector-section">
                {selectedSegment && hasSegments ? (
                  <ClipInspectorPanel
                    isOpen={true}
                    selectedSegment={selectedSegment}
                    selectedSegmentIndex={selectedSegmentIndex}
                    onSegmentTextChange={(text) => {
                      if (handleUpdateSegmentText) {
                        handleUpdateSegmentText(selectedSegment.id || selectedSegmentIndex, text);
                      }
                    }}
                    onSegmentTextBlur={(text) => {
                      if (handleUpdateSegmentText) {
                        handleUpdateSegmentText(selectedSegment.id || selectedSegmentIndex, text, false, selectedSegmentIndex);
                      }
                    }}
                    onSingleRegen={handleRegenerateSingleSegment}
                    onClipVoiceChange={handleUpdateSegmentVoice}
                    onUpdateSpeakerVoice={handleUpdateSpeakerVoice}
                    onToggleDeliveryType={handleToggleDeliveryType}
                    onDeleteSegment={handleDeleteSegment}
                    currentTime={playback.currentTime}
                    scriptData={scriptData}
                    onSelectSegment={media.setSelectedSegmentId}
                    settings={voiceSettings}
                  />
                ) : (
                  <div style={{ padding: '12px 14px', color: '#64748b', fontSize: 11, textAlign: 'center' }}>
                    គ្មានការជ្រើសរើសឃ្លាសន្ទនា (No segment selected)
                  </div>
                )}
              </div>

              {/* Bottom: Contextual Stage Settings */}
              <div className="workspace-stage-settings-section">
                <StageSettingsPanel
                  workspaceMode={workspaceMode}
                  selectedVideo={media.selectedVideo}
                  videoMetadata={media.videoMetadata}
                  activeSeries={series.activeSeries}
                  activeEpisode={series.activeEpisode}
                  seriesGlossary={series.seriesGlossary}
                  voiceSettings={voiceSettings}
                  onUpdateVoiceSettings={setVoiceSettings}
                  voiceCatalog={audio.ttsVoiceCatalog}
                  isCleanBgReady={isCleanBgReady}
                  isSeparatingAudio={isSeparatingAudio}
                  separationProgress={separationProgress}
                  separationError={separationError}
                  onStartDemucsSeparation={handleStartDemucsSeparation}
                  onKillDemucs={handleKillDemucs}
                  onRenderVideo={handleRenderVideo}
                  isRendering={render.isRendering}
                  renderProgress={render.renderProgress}
                  renderStage={render.renderStage}
                  renderedVideo={render.renderedVideo}
                  audioGenerated={audio.audioGenerated}
                  previewAudioUrl={audio.fullAudioUrl}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 5. Live Bottom Status Strip (~32px) */}
        <BottomStatusStrip
          activeEpisode={series.activeEpisode}
          segmentsCount={segments.length}
          overCount={overCount}
          isGeneratingAudio={audio.isGeneratingAudio}
          audioProgress={audio.audioProgress}
          isSeparatingAudio={isSeparatingAudio}
          separationProgress={separationProgress}
          isRendering={render.isRendering}
          renderProgress={render.renderProgress}
          onOpenJobDashboard={handleOpenJobDashboard}
          onOpenKeyModal={handleOpenGeminiRoute}
        />

        {/* Modals */}
        <JobDashboardModal isOpen={showJobDashboard} onClose={handleCloseJobDashboard} />
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

        {/* Re-Translate Overwrite Confirmation Modal */}
        {showConfirmRetranslate && (
          <div className="script-confirm-modal-overlay" onClick={() => setShowConfirmRetranslate(false)}>
            <div className="script-confirm-modal-box" onClick={(e) => e.stopPropagation()}>
              <h3 className="script-confirm-title">
                <AlertTriangle size={18} />
                <span>បញ្ជាក់ការ Re-Translate (Confirm Overwrite)</span>
              </h3>
              <p className="script-confirm-desc">
                ⚠️ ដំណើរការនេះនឹងលុប Script និង Subtitle ដែលបានកែប្រែដោយដៃចោល ហើយបង្កើត Subtitle ថ្មីឡើងវិញ។
                <br /><br />
                • Script ចាស់នឹងត្រូវ Auto-Backup ទុកក្នុង folder backups។
                <br />
                • តើអ្នកពិតជាចង់បន្តមែនទេ?
              </p>
              <div className="script-confirm-actions">
                <button
                  type="button"
                  className="script-confirm-cancel-btn"
                  onClick={() => setShowConfirmRetranslate(false)}
                >
                  បោះបង់ (Cancel)
                </button>
                <button
                  type="button"
                  className="script-confirm-ok-btn"
                  onClick={() => {
                    setShowConfirmRetranslate(false);
                    // Switch to script mode to run re-translation
                    setWorkspaceMode(STEP_IDS.SCRIPT);
                  }}
                >
                  បាទ/ចាស, Re-Translate ឥឡូវនេះ
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </JobQueueProvider>
  );
}
