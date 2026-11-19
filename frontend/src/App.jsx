import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useProxyPreview } from './hooks/useProxyPreview';
import { AlertTriangle, X } from 'lucide-react';
import Navbar from './components/layout/Navbar';
import HomeDashboard from './components/layout/HomeDashboard';
import ErrorBoundary from './components/common/ErrorBoundary';
import JobDashboardModal from './components/dashboard/JobDashboardModal';
import GeminiRouteModal from './components/dashboard/GeminiRouteModal';
import GeminiQuotaModal from './components/dashboard/GeminiQuotaModal';
import BatchExportStudioModal from './components/dashboard/BatchExportStudioModal';
import MediaLibrary from './components/media/MediaLibrary';
import VideoPlayerPreview from './components/player/VideoPlayerPreview';
import VoiceSettings from './components/voice/VoiceSettings';

// Skip re-rendering closed modals completely on 5Hz playback currentTime ticks (prevents heavy series scans while closed)
const MemoJobDashboardModal = React.memo(JobDashboardModal, (prev, next) => !prev.isOpen && !next.isOpen);
const MemoGeminiRouteModal = React.memo(GeminiRouteModal, (prev, next) => !prev.isOpen && !next.isOpen);
const MemoBatchExportStudioModal = React.memo(BatchExportStudioModal, (prev, next) => !prev.isOpen && !next.isOpen);
const MemoGeminiQuotaModal = React.memo(GeminiQuotaModal, (prev, next) => !prev.isOpen && !next.isOpen);

// Skip Navbar re-renders on playback currentTime ticks (Navbar does not display currentTime)
const MemoNavbar = React.memo(Navbar, (prev, next) => (
  prev.apiKey === next.apiKey &&
  prev.isBackendOnline === next.isBackendOnline &&
  prev.isRendering === next.isRendering &&
  prev.renderProgress === next.renderProgress &&
  prev.selectedVideo === next.selectedVideo &&
  prev.videoMetadata === next.videoMetadata &&
  prev.renderedVideo === next.renderedVideo &&
  prev.activeSeries === next.activeSeries &&
  prev.activeEpisode === next.activeEpisode &&
  prev.seriesId === next.seriesId &&
  prev.episodeId === next.episodeId &&
  prev.generatingEpisodeId === next.generatingEpisodeId &&
  prev.generatingAudioEpisodeId === next.generatingAudioEpisodeId &&
  prev.activeTab === next.activeTab &&
  prev.isGeminiRouteActive === next.isGeminiRouteActive &&
  prev.isGeminiQuotaActive === next.isGeminiQuotaActive &&
  prev.isBatchExportStudioActive === next.isBatchExportStudioActive &&
  prev.isJobDashboardActive === next.isJobDashboardActive &&
  prev.batchRender === next.batchRender &&
  prev.currentAspectRatio === next.currentAspectRatio &&
  prev.isLeftCollapsed === next.isLeftCollapsed &&
  prev.isRightCollapsed === next.isRightCollapsed &&
  prev.isTimelineCollapsed === next.isTimelineCollapsed &&
  prev.currentRoute === next.currentRoute
));

// Prevent 5Hz playback currentTime ticks from re-rendering the 3,800-line Inspector panel
const MemoVoiceSettings = React.memo(VoiceSettings, (prev, next) => {
  if (prev.isPlaying !== next.isPlaying) return false;
  if (!next.isPlaying && prev.currentTime !== next.currentTime) return false;
  if (prev.selectedSegmentId !== next.selectedSegmentId) return false;
  if (prev.selectedClipKind !== next.selectedClipKind) return false;
  if (prev.selectedClip !== next.selectedClip) return false;
  if (prev.settings !== next.settings) return false;
  if (prev.scriptData !== next.scriptData) return false;
  if (prev.videoClips !== next.videoClips) return false;
  if (prev.speakerRegistry !== next.speakerRegistry) return false;
  if (prev.voiceCatalog !== next.voiceCatalog) return false;
  if (prev.audioOutdated !== next.audioOutdated) return false;
  if (prev.audioGenerated !== next.audioGenerated) return false;
  if (prev.isGeneratingAudio !== next.isGeneratingAudio) return false;
  if (prev.audioProgress !== next.audioProgress) return false;
  if (prev.audioStage !== next.audioStage) return false;
  if (prev.isRendering !== next.isRendering) return false;
  if (prev.renderProgress !== next.renderProgress) return false;
  if (prev.renderStage !== next.renderStage) return false;
  if (prev.renderedVideo !== next.renderedVideo) return false;
  if (prev.previewAudioUrl !== next.previewAudioUrl) return false;
  if (prev.selectedVideo !== next.selectedVideo) return false;
  if (prev.videoMetadata !== next.videoMetadata) return false;
  if (prev.activeEpisode !== next.activeEpisode) return false;
  if (prev.activeSeries !== next.activeSeries) return false;
  if (prev.seriesId !== next.seriesId || prev.episodeId !== next.episodeId) return false;
  if (prev.batchRender !== next.batchRender) return false;
  if (prev.duration !== next.duration) return false;
  return true;
});
import TimelineEditor from './components/timeline/TimelineEditor';
import {
  STORAGE_SERIES_LIST_KEY,
  getActiveSeriesId,
  getActiveEpisodeId,
  readLegacyVoiceSettingsRaw,
  saveVoiceSettings,
  saveEpisodeState,
  resolveDefaultAspectRatio,
  isRenderedRatioMismatch,
  sanitizeAspectRatio,
} from './utils/projectStorage';
import {
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  normalizeGlobalLogoSettings,
  extractLogoSettings,
  hasAnyLogoSettings,
  areLogoSettingsEqual,
  stripLogoSettings,
  loadGlobalLogoSettingsRecord,
  saveGlobalLogoSettings,
  fetchGlobalLogoSettingsFromServer,
  syncGlobalLogoSettingsToServer,
  resolveInitialLogoSeed,
} from './utils/logoSettingsStorage';
import { isSegmentMatch, resolveVoiceClipStartSec } from './utils/timelineUtils';
import { parseTimeToSeconds } from './utils/timestampUtils';
import { JobQueueProvider } from './context/JobQueueContext';
import { StudioProvider } from './context/StudioContext';
import { ModalProvider, useModalState } from './context/ModalContext';
import { WorkspaceProvider, useStudioWorkspaceState } from './context/WorkspaceContext';
import { DubbingRunnerProvider } from './features/dubbing-runner';

// Hoisted immutable fallbacks (prevents prop churning and broken memoization)
const EMPTY_SEGMENTS = Object.freeze([]);
const EMPTY_CLIPS = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

const VISUAL_SETTING_DEFAULTS = {
  aspectRatio: null,
  verticalStyle: 'pad',
  burnSubtitles: true,
  subtitleStyle: 'banner',
  subtitleColor: 'white',
  subtitleSize: 'medium',
  enableCornerMask: false,
  cornerMaskText: '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»',
  cornerMaskStyle: 'badge',
  cornerMaskPosition: 'top-right',
  cornerMaskWidth: 220,
  cornerMaskHeight: 54,
  cornerMaskOpacity: 0.95,
  cornerMaskBlur: 18,
  cornerMaskOffsetX: 14,
  cornerMaskOffsetY: 14,
  enableSponsor: false,
  sponsorVideoUrl: null,
  sponsorVideoPath: null,
  sponsorChromaKey: true,
  sponsorChromaSimilarity: 0.28,
  sponsorPosition: 'bottom-left',
  sponsorXPercent: null,
  sponsorYPercent: null,
  sponsorTimingMode: 'loop',
  sponsorIntervalSec: 60,
  sponsorDurationSec: 10,
  sponsorStartSec: 0,
  sponsorEndSec: 15,
  sponsorScale: 25,
  sponsorMuteAudio: true,
  sponsorVolume: 0.5,
  enableAntiTheft: false,
  marqueeText: '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»',
  marqueeSpeed: 'normal',
  marqueePosition: 'bottom',
  marqueeTextColor: '#FFE600',
  enableWatermark: true,
  watermarkText: 'រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama',
  watermarkPosition: 'above-ticker',
  watermarkColor: '#38BDF8',
  antiTheftSize: 'small',
  duckingVolume: 0.15,
  khmerVolume: 1.3,
  enableDemucs: false,
};

const RENDER_INVALIDATING_SETTING_KEYS = Object.keys(VISUAL_SETTING_DEFAULTS);
const SUBTITLE_PREVIEW_SETTING_KEYS = [
  'burnSubtitles',
  'subtitleStyle',
  'subtitleColor',
  'subtitleSize',
  'verticalStyle',
];

function readNormalizedSettingVal(settings, key) {
  const raw = settings?.[key];
  if (key === 'aspectRatio') return sanitizeAspectRatio(raw);
  if (raw === undefined || raw === null) return VISUAL_SETTING_DEFAULTS[key];
  return raw;
}

function readLocalActiveEpisodeVoiceSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_SERIES_LIST_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return null;
    const sId = getActiveSeriesId();
    const eId = getActiveEpisodeId();
    const series = list.find((s) => s?.id === sId) || list[0];
    const ep = (series?.episodes || []).find((e) => e?.id === eId) || series?.episodes?.[0];
    return ep?.voiceSettings && typeof ep.voiceSettings === 'object' ? ep.voiceSettings : null;
  } catch {
    return null;
  }
}

function shallowEqualObjects(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

function resolveSubtitleSampleSeekTime(segments = [], currentTimeSec = 0) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const t = Number.isFinite(currentTimeSec) ? currentTimeSec : 0;
  const intervals = [];
  for (const seg of segments) {
    if (!seg) continue;
    const text = String(seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || '').trim();
    if (!text) continue;
    const s = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
      ? seg.startSec
      : parseTimeToSeconds(seg.start ?? seg.startTime, 0);
    let e = (typeof seg.endSec === 'number' && !isNaN(seg.endSec))
      ? seg.endSec
      : parseTimeToSeconds(seg.end ?? seg.endTime, s + 2.5);
    if (isNaN(e) || e <= s || (e - s) < 0.6) {
      e = s + Math.max(1.8, Math.min(6.0, text.length * 0.16));
    }
    if (t >= s && t < (e - 0.05)) {
      return null;
    }
    intervals.push({ s, e });
  }
  if (intervals.length === 0) return null;
  const target = intervals.find((it) => it.s >= t) || intervals[intervals.length - 1];
  const sampleOffset = Math.min(0.35, Math.max(0.05, (target.e - target.s) / 2));
  return parseFloat(Math.min(target.e - 0.05, target.s + sampleOffset).toFixed(2));
}

// Custom Architectural Hooks (Modularized for clean maintainability & debugging)
import { useResizablePanels } from './hooks/useResizablePanels';
import { useWorkspaceMedia } from './hooks/useWorkspaceMedia';
import { useUndoRedo } from './hooks/useUndoRedo';
import { usePlaybackEngine } from './hooks/usePlaybackEngine';
import { useAudioDubbing } from './hooks/useAudioDubbing';
import { useVideoRender } from './hooks/useVideoRender';
import { useScriptWorkflow } from './hooks/useScriptWorkflow';
import { useClipOperations } from './hooks/useClipOperations';
import { useProjectPersistence } from './hooks/useProjectPersistence';
import { useSeriesManager } from './hooks/useSeriesManager';
import { useShortcuts } from './hooks/useShortcuts';
import { useStudioActions } from './hooks/useStudioActions';

export default function App() {
  const modalState = useModalState();
  const {
    currentRoute,
    isHomeRoute,
    navigateToRoute,
    showJobDashboard,
    showGeminiRouteModal,
    showGeminiQuotaModal,
    showBatchExportStudioModal,
    exportStudioSelectedEpIds,
    setExportStudioSelectedEpIds,
    exportStudioAllowOriginalAudio,
    setExportStudioAllowOriginalAudio,
    handleOpenJobDashboard,
    handleCloseJobDashboard,
    handleOpenGeminiRoute,
    handleCloseGeminiRoute,
    handleOpenGeminiQuota,
    handleCloseGeminiQuota,
    handleOpenBatchExportStudio,
    handleCloseBatchExportStudio,
    isAnyModalOpen,
  } = modalState;

  const workspaceState = useStudioWorkspaceState();
  const {
    leftTab,
    setLeftTab,
    scriptData,
    setScriptData,
    speakerRegistry,
    setSpeakerRegistry,
    voiceSettings,
    setVoiceSettings,
    globalLogoSettings,
    setGlobalLogoSettings,
    audioGenerated,
    setAudioGenerated,
    audioOutdated,
    setAudioOutdated,
    fullAudioPath,
    setFullAudioPath,
    fullAudioUrl,
    setFullAudioUrl,
    timelineFocusRequest,
    setTimelineFocusRequest,
  } = workspaceState;

  const lastExportStudioSeriesRef = useRef(null);

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
  const globalLogoSettingsRef = useRef(globalLogoSettings);
  globalLogoSettingsRef.current = globalLogoSettings;
  const userEditedLogoRef = useRef(false);
  const initialLogoBootRef = useRef(null);
  if (initialLogoBootRef.current === null) {
    initialLogoBootRef.current = {
      localRecord: loadGlobalLogoSettingsRecord(),
      legacyVoiceRaw: readLegacyVoiceSettingsRaw(),
      localEpisodeVoice: readLocalActiveEpisodeVoiceSettings(),
    };
  }

  // Hydrate or perform one-time migration for global logo settings (server <-> localStorage)
  useEffect(() => {
    let cancelled = false;
    const { localRecord, legacyVoiceRaw, localEpisodeVoice } = initialLogoBootRef.current;

    async function syncOrMigrateGlobalLogo() {
      const serverState = await fetchGlobalLogoSettingsFromServer();
      if (cancelled || userEditedLogoRef.current) return;

      if (serverState && serverState.initialized && serverState.settings) {
        if (!localRecord.initialized || serverState.updatedAt > localRecord.updatedAt) {
          globalLogoSettingsRef.current = serverState.settings;
          setGlobalLogoSettings(serverState.settings);
          saveGlobalLogoSettings(serverState.settings, {
            syncServer: false,
            updatedAt: serverState.updatedAt || Date.now(),
          });
        } else if (localRecord.initialized && localRecord.updatedAt > serverState.updatedAt) {
          syncGlobalLogoSettingsToServer(localRecord.settings, localRecord.updatedAt);
        }
        return;
      }

      if (localRecord.initialized) {
        if (serverState && !serverState.initialized) {
          syncGlobalLogoSettingsToServer(localRecord.settings, localRecord.updatedAt || Date.now());
        }
        return;
      }

      // First-time migration: seed from currently open episode (if owner customized it) or legacy voiceSettings or defaults
      let serverActiveEpVoice = null;
      if (serverState) {
        try {
          const res = await fetch('/api/series');
          const data = await res.json();
          if (!cancelled && data?.success && Array.isArray(data.series) && data.series.length > 0) {
            const sId = getActiveSeriesId();
            const eId = getActiveEpisodeId();
            const targetSeries = data.series.find((s) => s?.id === sId) || data.series[0];
            const targetEp = (targetSeries?.episodes || []).find((e) => e?.id === eId) || targetSeries?.episodes?.[0];
            if (targetEp?.voiceSettings && typeof targetEp.voiceSettings === 'object') {
              serverActiveEpVoice = targetEp.voiceSettings;
            }
          }
        } catch {}
      }

      if (cancelled || userEditedLogoRef.current) return;
      const seeded = resolveInitialLogoSeed({
        activeEpisodeVoiceSettings: serverActiveEpVoice || localEpisodeVoice,
        legacyVoiceSettings: legacyVoiceRaw,
      });
      globalLogoSettingsRef.current = seeded;
      setGlobalLogoSettings(seeded);
      saveGlobalLogoSettings(seeded, { syncServer: Boolean(serverState) });
    }

    syncOrMigrateGlobalLogo();
    return () => {
      cancelled = true;
    };
  }, [setGlobalLogoSettings]);

  // Stable ref-delegated callbacks (prevents infinite render loops & unnecessary effect runs)
  const handleSetDuration = useCallback((dur) => playbackRef.current.setDuration?.(dur), []);
  const handleSetCurrentTime = useCallback((t) => playbackRef.current.setCurrentTime?.(t), []);
  const handleSetRenderedVideo = useCallback((v) => renderRef.current.setRenderedVideo?.(v), []);
  const handleClearHistory = useCallback(() => undoRedoRef.current.clearHistory?.(), []);
  const handleSetScriptError = useCallback((err) => scriptRef.current.setScriptError?.(err), []);
  const handleSetIsGeneratingScript = useCallback((gen) => scriptRef.current.setIsGeneratingScript?.(gen), []);

  // 1. Resizable 3-Column & Bottom Timeline Panels Hook
  const {
    leftPanelWidth,
    rightPanelWidth,
    timelineHeight,
    isLeftCollapsed,
    isRightCollapsed,
    isTimelineCollapsed,
    toggleLeftPanel,
    toggleRightPanel,
    toggleTimelinePanel,
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
    videoClipsUpdatedAt: media.videoClipsUpdatedAt,
    setVideoClipsUpdatedAt: media.setVideoClipsUpdatedAt,
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
  const currentAspectRatio = sanitizeAspectRatio(voiceSettings?.aspectRatio) || resolveDefaultAspectRatio(srcW, srcH) || '16:9';

  const prevRawRendered = renderRef.current.renderedVideo || null;
  const [previewChoice, setPreviewChoice] = useState(null);
  const proxySettings = useMemo(() => Object.fromEntries([
    ...RENDER_INVALIDATING_SETTING_KEYS, 'videoZoom', 'videoPanX', 'videoPanY', 'verticalBg',
  ].map(key => [key, readNormalizedSettingVal(voiceSettings, key)])), [voiceSettings]);
  const proxy = useProxyPreview({
    seriesId: series.seriesId, episodeId: series.episodeId, videoUrl: media.selectedVideo?.videoUrl,
    clips: media.videoClips, segments: scriptData?.segments, settings: proxySettings,
    framing: scriptData?.framingOverrides, keyframes: scriptData?.framingKeyframes,
    logo: globalLogoSettings, aspectRatio: currentAspectRatio, active: !isHomeRoute,
    stem: series.activeEpisode?.cleanBgmPath || series.activeEpisode?.bgmAudioUrl,
  });
  const playbackEffectiveRenderedVideo = isRenderedRatioMismatch(
    prevRawRendered,
    currentAspectRatio,
    { width: srcW, height: srcH }
  )
    ? null
    : prevRawRendered;
  const previewMode = previewChoice === 'live' || previewChoice === 'proxy' ? previewChoice :
    playbackEffectiveRenderedVideo ? 'rendered' : 'proxy';
  const playingProxy = previewMode === 'proxy' && Boolean(proxy.media);
  const invalidateProxy = proxy.invalidate;

  // Central stale-render invalidator for any audio-mix / segment / timeline edit.
  // Mirrors the settings-change invalidation pattern: clears active renderedVideo and stamps
  // renderInvalidatedAt in localStorage + backend sync WITHOUT deleting the MP4 file on disk.
  const invalidateRenderedPreview = useCallback((targetEpId = null) => {
    const sId = seriesRef.current.seriesId;
    const activeEpId = seriesRef.current.episodeId;
    const eId = targetEpId || activeEpId;
    const isActiveEp = !targetEpId || String(targetEpId) === String(activeEpId);
    if (isActiveEp) invalidateProxy();
    const hasActiveRendered = Boolean(renderRef.current?.renderedVideo);
    const prevRenderedAt = Number(renderRef.current?.renderedVideo?.renderedAt || 0);
    const invalidatedAt = Math.max(Date.now(), prevRenderedAt > 0 ? prevRenderedAt + 1 : 0);

    // Fast path: if invalidating the active episode and no rendered video exists, avoid a synchronous
    // localStorage + 1MB POST /api/series/:id/sync round-trip on every single clip/voice edit.
    if (isActiveEp && !hasActiveRendered) {
      return invalidatedAt;
    }

    if (isActiveEp) {
      if (renderRef.current?.setRenderedVideo) {
        renderRef.current.setRenderedVideo(null);
      }
    }
    const patch = { renderedVideo: null, renderInvalidatedAt: invalidatedAt };
    if (sId && eId) {
      saveEpisodeState(sId, eId, patch);
    }
    if (eId && seriesRef.current?.handleSaveEpisodeBackground) {
      seriesRef.current.handleSaveEpisodeBackground(eId, patch);
    }
    return invalidatedAt;
  }, [invalidateProxy]);

  // 4. Undo / Redo Stack Management Hook
  const undoRedo = useUndoRedo({
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    scriptData,
    setScriptData,
    activeClipId: media.activeClipId,
    setActiveClipId: media.setActiveClipId,
    seriesId: series.seriesId,
    episodeId: series.episodeId,
    onInvalidateRenderedPreview: invalidateRenderedPreview,
  });
  undoRedoRef.current = undoRedo;

  // 5. Video Playback & 60fps RAF Time Tracking Engine Hook
  const playback = usePlaybackEngine({
    videoRef,
    videoClips: media.videoClips,
    setVideoClips: playingProxy ? undefined : media.setVideoClips,
    renderedVideo: previewMode === 'proxy' ? proxy.media : previewMode === 'live' ? null : playbackEffectiveRenderedVideo,
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
    onInvalidateRenderedPreview: invalidateRenderedPreview,
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
    globalLogoSettings,
    globalLogoSettingsRef,
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
    onInvalidateRenderedPreview: invalidateRenderedPreview,
  });
  scriptRef.current = script;

  // 9. Multi-Clip Timeline Editing Operations Hook
  const clips = useClipOperations({
    videoClips: media.videoClips,
    setVideoClips: media.setVideoClips,
    setVideoClipsUpdatedAt: media.setVideoClipsUpdatedAt,
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
    selectedClipKind: media.selectedClipKind,
    setSelectedSegmentId: media.setSelectedSegmentId,
    setSelectedClipKind: media.setSelectedClipKind,
    videoMetadata: media.videoMetadata,
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
    onInvalidateRenderedPreview: invalidateRenderedPreview,
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
  const handleAutoSplitVideo = useCallback((...args) => clipsRef.current.handleAutoSplitVideo?.(...args), []);
  const handleResetFullVideo = useCallback((...args) => clipsRef.current.handleResetFullVideo?.(...args), []);
  const handleBridgeGaps = useCallback((...args) => clipsRef.current.handleBridgeGaps?.(...args), []);
  const handleAutoAlignNoOverlap = useCallback((...args) => clipsRef.current.handleAutoAlignNoOverlap?.(...args), []);
  const handleReleaseSegmentToAutoAlign = useCallback((...args) => clipsRef.current.handleReleaseSegmentToAutoAlign?.(...args), []);
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
    const prevSettings = voiceSettingsRef.current || EMPTY_OBJECT;
    const prevRatio = sanitizeAspectRatio(prevSettings?.aspectRatio);
    const prevLogo = globalLogoSettingsRef.current || DEFAULT_GLOBAL_LOGO_SETTINGS;
    const normalizedSettings = newSettings && typeof newSettings === 'object' && !Array.isArray(newSettings)
      ? {
          ...newSettings,
          aspectRatio: sanitizeAspectRatio(newSettings.aspectRatio),
        }
      : newSettings;

    // Route logo* keys strictly to the single global logo store (never per-episode voiceSettings)
    let logoChanged = false;
    if (normalizedSettings && typeof normalizedSettings === 'object' && hasAnyLogoSettings(normalizedSettings)) {
      const nextLogo = normalizeGlobalLogoSettings(extractLogoSettings(normalizedSettings), prevLogo);
      if (!areLogoSettingsEqual(prevLogo, nextLogo)) {
        logoChanged = true;
        userEditedLogoRef.current = true;
        globalLogoSettingsRef.current = nextLogo;
        setGlobalLogoSettings(nextLogo);
        saveGlobalLogoSettings(nextLogo);
      }
    }

    const nonLogoSettings = normalizedSettings && typeof normalizedSettings === 'object'
      ? stripLogoSettings(normalizedSettings)
      : normalizedSettings;

    const hasNonLogoChange = Boolean(
      nonLogoSettings &&
      typeof nonLogoSettings === 'object' &&
      !shallowEqualObjects(prevSettings, nonLogoSettings)
    );
    const hasNonLogoRenderChange = Boolean(
      nonLogoSettings &&
      typeof nonLogoSettings === 'object' &&
      RENDER_INVALIDATING_SETTING_KEYS.some(
        (key) => readNormalizedSettingVal(prevSettings, key) !== readNormalizedSettingVal(nonLogoSettings, key)
      )
    );
    const clearedRenderedForEdit = hasNonLogoRenderChange || logoChanged;
    const hasSubtitleVisualChange = Boolean(
      nonLogoSettings &&
      typeof nonLogoSettings === 'object' &&
      SUBTITLE_PREVIEW_SETTING_KEYS.some(
        (key) => readNormalizedSettingVal(prevSettings, key) !== readNormalizedSettingVal(nonLogoSettings, key)
      )
    );

    if (nonLogoSettings && typeof nonLogoSettings === 'object' && (!logoChanged || hasNonLogoChange)) {
      voiceSettingsRef.current = nonLogoSettings;
      saveVoiceSettings(nonLogoSettings);
      audioRef.current.handleUpdateVoiceSettings?.(nonLogoSettings);
    }

    const sId = seriesRef.current.seriesId;
    const eId = seriesRef.current.episodeId;
    const ratioChanged = Boolean(nonLogoSettings?.aspectRatio && nonLogoSettings.aspectRatio !== prevRatio);

    if (clearedRenderedForEdit) {
      if (renderRef.current.setRenderedVideo) {
        renderRef.current.setRenderedVideo(null);
      }
      const patch = { renderedVideo: null, renderInvalidatedAt: Date.now() };
      if (hasNonLogoChange || ratioChanged) patch.voiceSettings = nonLogoSettings;
      if (sId && eId) {
        saveEpisodeState(sId, eId, patch);
      }
      if (eId && seriesRef.current.handleSaveEpisodeBackground) {
        seriesRef.current.handleSaveEpisodeBackground(eId, patch);
      }
    }

    if (
      hasSubtitleVisualChange &&
      nonLogoSettings?.burnSubtitles !== false &&
      !playbackRef.current?.isPlaying
    ) {
      const sampleTime = resolveSubtitleSampleSeekTime(
        scriptDataRef.current?.segments,
        playbackRef.current?.currentTime || 0
      );
      if (sampleTime !== null) {
        playbackRef.current?.handleSeek?.(sampleTime);
      }
    }
  }, [setGlobalLogoSettings]);

  const handleAspectRatioChange = useCallback((nextRatio) => {
    const sanitizedRatio = sanitizeAspectRatio(nextRatio);
    if (!sanitizedRatio) return;
    const updated = { ...(voiceSettingsRef.current || {}), aspectRatio: sanitizedRatio };
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
  const handleRenderVideo = useCallback((...args) => {
    setPreviewChoice(null);
    return renderRef.current.handleRenderVideo?.(...args);
  }, []);
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

  const studioSettings = useMemo(
    () => ({
      ...(voiceSettings || EMPTY_OBJECT),
      ...(globalLogoSettings || DEFAULT_GLOBAL_LOGO_SETTINGS),
    }),
    [voiceSettings, globalLogoSettings]
  );

  const effectiveRenderedVideo = isRenderedRatioMismatch(
    render.renderedVideo,
    currentAspectRatio,
    { width: srcW, height: srcH }
  )
    ? null
    : render.renderedVideo;

  useShortcuts({
    isModalOpen: isAnyModalOpen,
    onPlayPause: handlePlayPause,
    onSeek: handleSeek,
    currentTime: playback.currentTime,
    duration: playback.duration,
    onSplitClip: handleSplitClip,
    onDeleteClip: handleDeleteClip,
    onDeleteSegment: handleDeleteSegment,
    activeClipId: media.activeClipId,
    selectedSegmentId: media.selectedSegmentId,
    selectedClipKind: media.selectedClipKind,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onRenderVideo: handleRenderVideo,
  });

  const studioActions = useStudioActions({
    clipsRef,
    scriptRef,
    audioRef,
    undoRedoRef,
    playbackRef,
    renderRef,
    mediaRef,
    seriesRef,
  });

  return (
    <JobQueueProvider isAnyJobViewOpen={true}>
      <ModalProvider value={modalState}>
        <WorkspaceProvider value={workspaceState}>
          <StudioProvider value={studioActions}>
            <DubbingRunnerProvider
              activeSeries={series.activeSeries}
              refreshSeries={series.refreshSeriesFromServer}
            >
              <div className="capcut-app-container">
        {/* Top Application Navbar */}
        <MemoNavbar
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
          onOpenBatchExportStudio={handleOpenBatchExportStudio}
          isGeminiRouteActive={showGeminiRouteModal}
          isGeminiQuotaActive={showGeminiQuotaModal}
          isBatchExportStudioActive={showBatchExportStudioModal}
          isJobDashboardActive={showJobDashboard}
          batchRender={render.batchRender}
          currentAspectRatio={currentAspectRatio}
          onAspectRatioChange={handleAspectRatioChange}
          isLeftCollapsed={isLeftCollapsed}
          isRightCollapsed={isRightCollapsed}
          isTimelineCollapsed={isTimelineCollapsed}
          onToggleLeftPanel={toggleLeftPanel}
          onToggleRightPanel={toggleRightPanel}
          onToggleTimelinePanel={toggleTimelinePanel}
          currentRoute={currentRoute}
          onNavigateRoute={navigateToRoute}
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

        {/* Voice Switch Error / Rollback Toast */}
        {audio.voiceSwitchError && (
          <div
            data-testid="voice-switch-error-toast"
            className="backend-offline-banner"
            role="alert"
            style={{
              background: 'rgba(127, 29, 29, 0.94)',
              borderColor: 'rgba(248, 113, 113, 0.65)',
              color: '#fecaca',
            }}
          >
            <AlertTriangle size={16} style={{ color: '#f87171', flexShrink: 0 }} />
            <span>{audio.voiceSwitchError}</span>
            <button
              type="button"
              onClick={() => audio.clearVoiceSwitchError?.()}
              aria-label="Dismiss voice error"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Home & Route Launchpad (/ or /home) vs Main Video Editing Workspace (/studio, /batch, /quota, /export, /jobs) */}
        {isHomeRoute ? (
          <ErrorBoundary inline name="Home Dashboard">
            <HomeDashboard
              activeSeries={series.activeSeries}
              activeEpisode={series.activeEpisode}
              episodeId={series.episodeId}
              onNavigateRoute={navigateToRoute}
              onSwitchEpisode={handleSwitchEpisode}
              onTabChange={setLeftTab}
            />
          </ErrorBoundary>
        ) : (
        <main className={`capcut-main-workspace ${activeSplitter ? 'is-resizing' : ''}`}>
          {/* Top 3-Column Suite: Left Tools | Video Monitor | Contextual Inspector */}
          <div className="capcut-top-suite" ref={topSuiteRef}>
            {/* 1. Left Panel: Media Library, AI Script, Subtitles */}
            <div
              className="top-suite-col-left"
              style={{
                width: leftPanelWidth,
                display: isLeftCollapsed ? 'none' : undefined,
              }}
            >
              <ErrorBoundary inline name="Media Library">
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
                  onSwitchSeries={series.handleSwitchSeries}
                  onSwitchEpisode={handleSwitchEpisode}
                  onCreateEpisode={handleCreateEpisode}
                  onDeleteEpisode={handleDeleteEpisode}
                  onRenameEpisode={handleRenameEpisode}
                  onRenameSeries={handleRenameSeries}
                  onRefreshSeries={series.refreshSeriesFromServer}
                />
              </ErrorBoundary>
            </div>

            {/* Left Resizer Splitter (Drag Left / Right) */}
            {!isLeftCollapsed && (
              <div
                className={`capcut-panel-splitter ${activeSplitter === 'left' ? 'is-active' : ''}`}
                onMouseDown={(e) => handleStartSplitterDrag(e, 'left')}
                title="Drag left or right to resize Media Library panel"
              />
            )}

            {/* 2. Center Panel: Video Preview Monitor */}
            <div className="top-suite-col-center">
              <ErrorBoundary inline name="Video Player">
                <VideoPlayerPreview
                  selectedVideo={media.selectedVideo}
                  videoMetadata={media.videoMetadata}
                  seriesId={series.seriesId}
                  episodeId={series.episodeId}
                  scriptData={scriptData}
                  renderedVideo={previewMode === 'proxy' ? proxy.media : previewMode === 'live' ? null : effectiveRenderedVideo}
                  previewMode={previewMode}
                  onPreviewMode={setPreviewChoice}
                  canViewRender={Boolean(effectiveRenderedVideo)}
                  proxyStatus={proxy.value}
                  setRenderedVideo={render.setRenderedVideo}
                  onResetToPreview={handleResetToPreview}
                  isRendering={render.isRendering}
                  onRenderVideo={handleRenderVideo}
                  videoRef={videoRef}
                  currentTime={playback.currentTime}
                  playheadTimeRef={playback.playheadTimeRef}
                  subscribePlayhead={playback.subscribePlayhead}
                  duration={playback.duration}
                  isPlaying={playback.isPlaying}
                  onPlayPause={handlePlayPause}
                  onSeek={handleSeek}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  voiceSettings={studioSettings}
                  onUpdateVoiceSettings={handleUpdateVoiceSettings}
                  onAspectRatioChange={handleAspectRatioChange}
                  onEnded={handleVideoEnded}
                  onUpdateSegments={handleUpdateTimelineSegments}
                  fullAudioUrl={audio.fullAudioUrl}
                  audioGenerated={audio.audioGenerated}
                  audioOutdated={audio.audioOutdated}
                  onImportClick={handleImportClick}
                  onVideoSelected={handleVideoSelected}
                  videoClips={media.videoClips || EMPTY_CLIPS}
                />
              </ErrorBoundary>
            </div>

            {/* Right Resizer Splitter (Drag Left / Right) */}
            {!isRightCollapsed && (
              <div
                className={`capcut-panel-splitter ${activeSplitter === 'right' ? 'is-active' : ''}`}
                onMouseDown={(e) => handleStartSplitterDrag(e, 'right')}
                title="Drag left or right to resize Inspector panel"
              />
            )}

            {/* 3. Right Panel: Khmer Voice (TTS), Audio Ducking, Export Settings */}
            <div
              className="top-suite-col-right"
              style={{
                width: rightPanelWidth,
                display: isRightCollapsed ? 'none' : undefined,
              }}
            >
              <ErrorBoundary inline name="Inspector">
                <MemoVoiceSettings
                  settings={studioSettings}
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
                  duration={playback.duration}
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
                  selectedClipKind={media.selectedClipKind}
                  selectedClip={media.selectedClip}
                  onSplitClip={handleSplitClip}
                  onDeleteClip={handleDeleteClip}
                  onDeleteSegment={handleDeleteSegment}
                  onUpdateSegments={handleUpdateTimelineSegments}
                  onToggleMuteSegment={handleToggleMuteSegment}
                  onToggleMuteVideoClip={handleToggleMuteVideoClip}
                  onReleaseSegmentToAutoAlign={handleReleaseSegmentToAutoAlign}
                  videoClips={media.videoClips || EMPTY_CLIPS}
                  onUpdateScript={handleUpdateScript}
                />
              </ErrorBoundary>
            </div>
          </div>

          {/* Horizontal Resizer Splitter (Drag Up / Down for Timeline Height 220px–450px) */}
          {!isTimelineCollapsed && (
            <div
              className={`capcut-panel-splitter-horizontal ${activeSplitter === 'timeline' ? 'is-active' : ''}`}
              onMouseDown={(e) => handleStartSplitterDrag(e, 'timeline')}
              title="Drag up or down to resize Timeline height (220px–450px)"
            />
          )}

          {/* Bottom Multi-Track Timeline */}
          <div
            className="capcut-bottom-timeline"
            style={{
              height: timelineHeight,
              display: isTimelineCollapsed ? 'none' : undefined,
            }}
          >
            <ErrorBoundary inline name="Timeline">
              <TimelineEditor
                playingProxy={playingProxy}
                videoRef={videoRef}
                activeTab={leftTab}
                currentTime={playback.currentTime}
                playheadTimeRef={playback.playheadTimeRef}
                subscribePlayhead={playback.subscribePlayhead}
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
                framingKeyframes={scriptData?.framingKeyframes || EMPTY_ARRAY}
                onUpdateSegments={handleUpdateTimelineSegments}
                onToggleMuteSegment={handleToggleMuteSegment}
                onToggleMuteVideoClip={handleToggleMuteVideoClip}
                onToggleDeliveryType={handleToggleDeliveryType}
                speakerRegistry={speakerRegistry || EMPTY_OBJECT}
                voiceSettings={voiceSettings || EMPTY_OBJECT}
                onUpdateVoiceSettings={handleUpdateVoiceSettings}
                audioGenerated={audio.audioGenerated}
                selectedVideo={media.selectedVideo}
                videoThumbnails={media.videoThumbnails || EMPTY_ARRAY}
                selectedSegmentId={media.selectedSegmentId}
                onSelectSegment={media.setSelectedSegmentId}
                selectedClipKind={media.selectedClipKind}
                onSelectClipKind={media.setSelectedClipKind}
                timelineFocusRequest={timelineFocusRequest}
                onAutoSplitVideo={handleAutoSplitVideo}
                onResetFullVideo={handleResetFullVideo}
                onBridgeGaps={handleBridgeGaps}
                onAutoAlignNoOverlap={handleAutoAlignNoOverlap}
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
            </ErrorBoundary>
          </div>
        </main>
        )}

        {/* DragonDub Production Job Queue Dashboard Modal (Phase 4.4) */}
        <ErrorBoundary inline name="Job Dashboard" onReset={handleCloseJobDashboard}>
          <MemoJobDashboardModal isOpen={showJobDashboard} onClose={handleCloseJobDashboard} />
        </ErrorBoundary>

        {/* DragonDub Batch Generate Studio Modal (Separated Clean Workflow) */}
        <ErrorBoundary inline name="Gemini Route" onReset={handleCloseGeminiRoute}>
          <MemoGeminiRouteModal
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
          <MemoBatchExportStudioModal
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
          <MemoGeminiQuotaModal
            isOpen={showGeminiQuotaModal}
            onClose={handleCloseGeminiQuota}
            onOpenBatchModal={handleOpenGeminiRoute}
          />
        </ErrorBoundary>
            </div>
            </DubbingRunnerProvider>
          </StudioProvider>
        </WorkspaceProvider>
      </ModalProvider>
    </JobQueueProvider>
  );
}
