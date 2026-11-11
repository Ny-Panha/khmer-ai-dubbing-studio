import React, { createContext, useContext, useState, useMemo } from 'react';
import {
  loadSavedVoiceSettings,
  saveVoiceSettings,
  saveEpisodeState,
  resolveDefaultAspectRatio,
  isRenderedRatioMismatch,
  sanitizeAspectRatio,
} from '../utils/projectStorage';

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
export function useStudioWorkspaceState() {
  const [leftTab, setLeftTab] = useState('media');
  const [scriptData, setScriptData] = useState(null);
  const [speakerRegistry, setSpeakerRegistry] = useState({});
  const [voiceSettings, setVoiceSettings] = useState(loadSavedVoiceSettings);
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

