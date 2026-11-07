import { useState, useCallback } from 'react';

/**
 * Custom hook to manage timeline undo and redo history snapshots
 */
export function useUndoRedo({
  videoClips,
  setVideoClips,
  scriptData,
  setScriptData,
  activeClipId,
  setActiveClipId,
}) {
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const pushUndoSnapshot = useCallback((customClips, customSegments, customActiveClipId) => {
    const clipsToSave = customClips !== undefined ? customClips : videoClips;
    const segsToSave = customSegments !== undefined ? customSegments : (scriptData?.segments || []);
    const activeIdToSave = customActiveClipId !== undefined ? customActiveClipId : activeClipId;

    const snapshot = {
      videoClips: JSON.parse(JSON.stringify(clipsToSave || [])),
      segments: JSON.parse(JSON.stringify(segsToSave || [])),
      activeClipId: activeIdToSave,
    };

    setUndoStack((prev) => [...prev.slice(-30), snapshot]);
    setRedoStack([]); // Clear redo stack on new action
  }, [videoClips, scriptData, activeClipId]);

  const handleUndo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (!prevUndo || prevUndo.length === 0) return prevUndo;
      const targetSnapshot = prevUndo[prevUndo.length - 1];
      const remainingUndo = prevUndo.slice(0, prevUndo.length - 1);

      // Save current state into redo stack
      const currentSnapshot = {
        videoClips: JSON.parse(JSON.stringify(videoClips || [])),
        segments: JSON.parse(JSON.stringify(scriptData?.segments || [])),
        activeClipId,
      };
      setRedoStack((prevRedo) => [...prevRedo.slice(-30), currentSnapshot]);

      // Apply target snapshot
      if (targetSnapshot.videoClips) {
        setVideoClips(targetSnapshot.videoClips);
      }
      if (targetSnapshot.segments && setScriptData) {
        setScriptData((sPrev) => ({ ...sPrev, segments: targetSnapshot.segments }));
      }
      if (targetSnapshot.activeClipId !== undefined) {
        setActiveClipId(targetSnapshot.activeClipId);
      }

      return remainingUndo;
    });
  }, [videoClips, scriptData, activeClipId, setVideoClips, setScriptData, setActiveClipId]);

  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (!prevRedo || prevRedo.length === 0) return prevRedo;
      const targetSnapshot = prevRedo[prevRedo.length - 1];
      const remainingRedo = prevRedo.slice(0, prevRedo.length - 1);

      // Save current state into undo stack
      const currentSnapshot = {
        videoClips: JSON.parse(JSON.stringify(videoClips || [])),
        segments: JSON.parse(JSON.stringify(scriptData?.segments || [])),
        activeClipId,
      };
      setUndoStack((prevUndo) => [...prevUndo.slice(-30), currentSnapshot]);

      // Apply target snapshot
      if (targetSnapshot.videoClips) {
        setVideoClips(targetSnapshot.videoClips);
      }
      if (targetSnapshot.segments && setScriptData) {
        setScriptData((sPrev) => ({ ...sPrev, segments: targetSnapshot.segments }));
      }
      if (targetSnapshot.activeClipId !== undefined) {
        setActiveClipId(targetSnapshot.activeClipId);
      }

      return remainingRedo;
    });
  }, [videoClips, scriptData, activeClipId, setVideoClips, setScriptData, setActiveClipId]);

  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    pushUndoSnapshot,
    handleUndo,
    handleRedo,
    clearHistory,
    setUndoStack,
    setRedoStack,
  };
}
