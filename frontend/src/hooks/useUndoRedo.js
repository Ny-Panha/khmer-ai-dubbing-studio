import { useState, useCallback } from 'react';
import { persistTimelineOperationApi } from '../services/api';
import { saveTimelineOperationToLocalStorage } from '../utils/projectStorage';

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
  seriesId = null,
  episodeId = null,
  onInvalidateRenderedPreview = null,
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

  const persistSnapshot = useCallback((snapshot) => {
    persistTimelineOperationApi({
      seriesId,
      episodeId,
      operation: 'restore',
      segments: snapshot.segments || [],
      videoClips: snapshot.videoClips || [],
    }).catch((err) => console.warn('[useUndoRedo] Could not persist restored timeline snapshot:', err.message));
  }, [seriesId, episodeId]);

  const handleUndo = useCallback(() => {
    if (!undoStack.length) return;
    const targetSnapshot = undoStack[undoStack.length - 1];
    const currentSnapshot = {
      videoClips: safeClone(videoClips || []),
      segments: safeClone(scriptData?.segments || []),
      activeClipId,
    };
    const localSave = saveTimelineOperationToLocalStorage({
      seriesId,
      episodeId,
      operation: 'restore',
      segments: targetSnapshot.segments || [],
      videoClips: targetSnapshot.videoClips || [],
    });
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev.slice(-30), currentSnapshot]);
    setVideoClips(targetSnapshot.videoClips || []);
    if (targetSnapshot.segments && setScriptData) {
      setScriptData((sPrev) => (sPrev
        ? { ...sPrev, segments: targetSnapshot.segments, updatedAt: localSave?.updatedAt || Date.now(), explicitClear: targetSnapshot.segments.length === 0 }
        : (targetSnapshot.segments.length ? { mode: 'dialogue', segments: targetSnapshot.segments, updatedAt: localSave?.updatedAt || Date.now() } : sPrev)));
    }
    if (targetSnapshot.activeClipId !== undefined) setActiveClipId(targetSnapshot.activeClipId);
    if (typeof onInvalidateRenderedPreview === 'function') {
      onInvalidateRenderedPreview();
    }
    persistSnapshot(targetSnapshot);
  }, [undoStack, videoClips, scriptData, activeClipId, setVideoClips, setScriptData, setActiveClipId, seriesId, episodeId, persistSnapshot, onInvalidateRenderedPreview]);

  const handleRedo = useCallback(() => {
    if (!redoStack.length) return;
    const targetSnapshot = redoStack[redoStack.length - 1];
    const currentSnapshot = {
      videoClips: safeClone(videoClips || []),
      segments: safeClone(scriptData?.segments || []),
      activeClipId,
    };
    const localSave = saveTimelineOperationToLocalStorage({
      seriesId,
      episodeId,
      operation: 'restore',
      segments: targetSnapshot.segments || [],
      videoClips: targetSnapshot.videoClips || [],
    });
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev.slice(-30), currentSnapshot]);
    setVideoClips(targetSnapshot.videoClips || []);
    if (targetSnapshot.segments && setScriptData) {
      setScriptData((sPrev) => (sPrev
        ? { ...sPrev, segments: targetSnapshot.segments, updatedAt: localSave?.updatedAt || Date.now(), explicitClear: targetSnapshot.segments.length === 0 }
        : (targetSnapshot.segments.length ? { mode: 'dialogue', segments: targetSnapshot.segments, updatedAt: localSave?.updatedAt || Date.now() } : sPrev)));
    }
    if (targetSnapshot.activeClipId !== undefined) setActiveClipId(targetSnapshot.activeClipId);
    if (typeof onInvalidateRenderedPreview === 'function') {
      onInvalidateRenderedPreview();
    }
    persistSnapshot(targetSnapshot);
  }, [redoStack, videoClips, scriptData, activeClipId, setVideoClips, setScriptData, setActiveClipId, seriesId, episodeId, persistSnapshot, onInvalidateRenderedPreview]);

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
