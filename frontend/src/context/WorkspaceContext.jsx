import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import {
  loadSavedVoiceSettings,
  saveVoiceSettings,
  saveEpisodeState,
  resolveDefaultAspectRatio,
  isRenderedRatioMismatch,
  sanitizeAspectRatio,
} from '../utils/projectStorage';
import {
  DEFAULT_GLOBAL_LOGO_SETTINGS,
  DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS,
  loadGlobalLogoSettings,
  loadGlobalCustomizeSettings,
} from '../utils/logoSettingsStorage';

const NOOP = () => {};

const DEFAULT_WORKSPACE_CONTEXT = Object.freeze({
  leftTab: 'media',
  setLeftTab: NOOP,
  scriptData: null,
  setScriptData: NOOP,
  speakerRegistry: {},
  setSpeakerRegistry: NOOP,
  voiceSettings: {},
  setVoiceSettings: NOOP,
  globalCustomizeSettings: DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS,
  setGlobalCustomizeSettings: NOOP,
  globalLogoSettings: DEFAULT_GLOBAL_CUSTOMIZE_SETTINGS,
  setGlobalLogoSettings: NOOP,
  audioGenerated: false,
  setAudioGenerated: NOOP,
  audioOutdated: false,
  setAudioOutdated: NOOP,
  fullAudioPath: null,
  setFullAudioPath: NOOP,
  fullAudioUrl: null,
  setFullAudioUrl: NOOP,
  timelineFocusRequest: null,
  setTimelineFocusRequest: NOOP,
  loadSavedVoiceSettings,
  saveVoiceSettings,
  saveEpisodeState,
  resolveDefaultAspectRatio,
  isRenderedRatioMismatch,
  sanitizeAspectRatio,
});

export const WorkspaceContext = createContext(DEFAULT_WORKSPACE_CONTEXT);

/**
 * Custom hook to manage core project/episode workspace state & projectStorage persistence
 */
function getInitialLeftTab() {
  if (typeof window === 'undefined' || !window.location) return 'media';
  try {
    const params = new URLSearchParams(window.location.search || '');
    const rawTab = (params.get('tab') || '').trim().toLowerCase();
    if (rawTab === 'script' || rawTab === 'voice' || rawTab === 'ai') return 'script';
    if (rawTab === 'subtitles' || rawTab === 'subs' || rawTab === 'text') return 'subtitles';
    if (rawTab === 'media' || rawTab === 'video') return 'media';
  } catch {
    // ignore URLSearchParams errors
  }
  return 'media';
}

export function useStudioWorkspaceState() {
  const [leftTab, setLeftTabState] = useState(getInitialLeftTab);
  const setLeftTab = useCallback((nextTab) => {
    setLeftTabState((prev) => {
      const resolved = typeof nextTab === 'function' ? nextTab(prev) : nextTab;
      if (typeof window !== 'undefined' && window.history && window.location) {
        const path = window.location.pathname || '';
        if (path === '/studio' && (resolved === 'media' || resolved === 'script' || resolved === 'subtitles')) {
          const nextSearch = `?tab=${resolved}`;
          if (window.location.search !== nextSearch) {
            window.history.replaceState({ route: '/studio', tab: resolved }, '', `/studio${nextSearch}`);
          }
        }
      }
      return resolved;
    });
  }, []);
  const [scriptData, setScriptData] = useState(null);
  const [speakerRegistry, setSpeakerRegistry] = useState({});
  const [voiceSettings, setVoiceSettings] = useState(loadSavedVoiceSettings);
  const [globalCustomizeSettings, setGlobalCustomizeSettings] = useState(loadGlobalCustomizeSettings);
  const globalLogoSettings = globalCustomizeSettings;
  const setGlobalLogoSettings = setGlobalCustomizeSettings;
  const [audioGenerated, setAudioGenerated] = useState(false);
  const [audioOutdated, setAudioOutdated] = useState(false);
  const [fullAudioPath, setFullAudioPath] = useState(null);
  const [fullAudioUrl, setFullAudioUrl] = useState(null);
  const [timelineFocusRequest, setTimelineFocusRequest] = useState(null);

  return useMemo(
    () => ({
      leftTab,
      setLeftTab,
      scriptData,
      setScriptData,
      speakerRegistry,
      setSpeakerRegistry,
      voiceSettings,
      setVoiceSettings,
      globalCustomizeSettings,
      setGlobalCustomizeSettings,
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
      loadSavedVoiceSettings,
      saveVoiceSettings,
      saveEpisodeState,
      resolveDefaultAspectRatio,
      isRenderedRatioMismatch,
      sanitizeAspectRatio,
    }),
    [
      leftTab,
      scriptData,
      speakerRegistry,
      voiceSettings,
      globalCustomizeSettings,
      globalLogoSettings,
      audioGenerated,
      audioOutdated,
      fullAudioPath,
      fullAudioUrl,
      timelineFocusRequest,
    ]
  );
}

export function WorkspaceProvider({ value, children }) {
  const internalState = useStudioWorkspaceState();
  const contextValue = value || internalState;
  return <WorkspaceContext.Provider value={contextValue}>{children}</WorkspaceContext.Provider>;
}

export function useStudioWorkspace() {
  return useContext(WorkspaceContext) || DEFAULT_WORKSPACE_CONTEXT;
}

