import { useState, useEffect } from 'react';
import { checkBackendHealth } from '../services/api';
import { saveVoiceSettings } from '../utils/projectStorage';

/**
 * Custom hook to handle project state persistence (localStorage) and backend health checks
 */
export function useProjectPersistence({
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
}) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [backendOfflineBanner, setBackendOfflineBanner] = useState(false);

  const handleSaveApiKey = (key) => {
    setApiKey(key);
    localStorage.setItem('GEMINI_API_KEY', key);
  };

  // Listen for backend offline/online event notifications from API and storage sync
  useEffect(() => {
    const handleOffline = () => {
      setIsBackendOnline(false);
      setBackendOfflineBanner(true);
    };
    const handleOnline = () => {
      setIsBackendOnline(true);
      setBackendOfflineBanner(false);
    };

    window.addEventListener('backend-offline', handleOffline);
    window.addEventListener('backend-online', handleOnline);

    return () => {
      window.removeEventListener('backend-offline', handleOffline);
      window.removeEventListener('backend-online', handleOnline);
    };
  }, []);

  // Note: Project and episode persistence is managed as single-source-of-truth by useSeriesManager.

  // Persist voice settings to localStorage
  useEffect(() => {
    saveVoiceSettings(voiceSettings);
  }, [voiceSettings]);

  // Check backend health periodically
  useEffect(() => {
    let isMounted = true;
    const verifyHealth = async () => {
      const { online } = await checkBackendHealth();
      if (isMounted) {
        setIsBackendOnline(online);
        if (online) {
          setBackendOfflineBanner(false);
        }
      }
    };
    verifyHealth();

    const interval = setInterval(verifyHealth, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return {
    apiKey,
    handleSaveApiKey,
    isBackendOnline,
    setIsBackendOnline,
    backendOfflineBanner,
    setBackendOfflineBanner,
  };
}
