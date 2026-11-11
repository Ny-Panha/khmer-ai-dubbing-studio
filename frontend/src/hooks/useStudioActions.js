import { useCallback, useMemo } from 'react';
import { startRepairBrokenJobApi } from '../services/api';

/**
 * Centralized Studio Action Dispatchers Hook
 * Guarantees stable, non-undefined callbacks (`onUpdateSegments`, `onUpdateScript`,
 * `repairBroken`, `voiceSwitch`, etc.) across all child panels and timeline tracks.
 */
export function useStudioActions({
  clipsRef,
  scriptRef,
  audioRef,
  undoRedoRef,
  playbackRef,
  renderRef,
  mediaRef,
  seriesRef,
}) {
  const onUpdateSegments = useCallback(
    (...args) => clipsRef.current?.handleUpdateTimelineSegments?.(...args),
    [clipsRef]
  );

  const onUpdateScript = useCallback(
    (...args) => scriptRef.current?.handleUpdateScript?.(...args),
    [scriptRef]
  );

  const voiceSwitch = useCallback(
    (...args) => audioRef.current?.handleUpdateSegmentVoice?.(...args),
    [audioRef]
  );

  const repairBroken = useCallback(
    async (options = {}) => {
      const sId = options.seriesId || seriesRef.current?.seriesId;
      const epIds = options.episodeIds || (seriesRef.current?.episodeId ? [seriesRef.current.episodeId] : []);
      if (!sId) return null;
      return startRepairBrokenJobApi({
        seriesId: sId,
        episodeIds: epIds,
        ...options,
      });
    },
    [seriesRef]
  );

  return useMemo(
    () => ({
      onUpdateSegments,
      onUpdateScript,
      voiceSwitch,
      repairBroken,
      undoRedoRef,
      playbackRef,
      renderRef,
      mediaRef,
    }),
    [onUpdateSegments, onUpdateScript, voiceSwitch, repairBroken, undoRedoRef, playbackRef, renderRef, mediaRef]
  );
}
