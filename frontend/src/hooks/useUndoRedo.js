import { useState, useCallback } from 'react';

/**
 * Cycle-safe deep clone helper.
 * Uses JSON.stringify with a replacer tracking seen objects via WeakSet.
 * Replaces circular repeats with undefined (dropped from objects),
 * and drops functions/undefined as standard JSON does.
 * Snapshots are structurally identical for acyclic data.
 */
export function safeClone(value) {
  if (value === undefined || value === null) return value;
  const seen = new WeakSet();
  const jsonString = JSON.stringify(value, (key, val) => {
    if (typeof val === 'function') return undefined;
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) {
        return undefined; // Replace circular repeat with undefined
      }
      seen.add(val);
    }
    return val;
  });
  if (jsonString === undefined) return undefined;
  return JSON.parse(jsonString);
}

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
      videoClips: safeClone(clipsToSave || []),
      segments: safeClone(segsToSave || []),
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
        videoClips: safeClone(videoClips || []),
        segments: safeClone(scriptData?.segments || []),
        activeClipId,
      };
      setRedoStack((prevRedo) => [...prevRedo.slice(-30), currentSnapshot]);

      // Apply target snapshot
      if (targetSnapshot.videoClips) {
        setVideoClips(targetSnapshot.videoClips);
      }
      if (targetSnapshot.segments && setScriptData) {
        setScriptData((sPrev) => (sPrev ? { ...sPrev, segments: targetSnapshot.segments, updatedAt: Date.now() } : sPrev));
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
        videoClips: safeClone(videoClips || []),
        segments: safeClone(scriptData?.segments || []),
        activeClipId,
      };
      setUndoStack((prevUndo) => [...prevUndo.slice(-30), currentSnapshot]);

      // Apply target snapshot
      if (targetSnapshot.videoClips) {
        setVideoClips(targetSnapshot.videoClips);
      }
      if (targetSnapshot.segments && setScriptData) {
        setScriptData((sPrev) => (sPrev ? { ...sPrev, segments: targetSnapshot.segments, updatedAt: Date.now() } : sPrev));
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
    pushHistory: pushUndoSnapshot,
    handleUndo,
    handleRedo,
    clearHistory,
    setUndoStack,
    setRedoStack,
  };
}
