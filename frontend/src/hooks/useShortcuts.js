import { useEffect } from 'react';

/**
 * Global Desktop Studio Keyboard Shortcuts Hook (CapCut Pro 2026)
 * Safely ignores key events when typing in inputs/textareas or when modals are open.
 */
export function useShortcuts({
  isModalOpen = false,
  onPlayPause,
  onSeek,
  currentTime = 0,
  duration = 0,
  onSplitClip,
  onDeleteClip,
  onDeleteSegment,
  activeClipId = null,
  selectedSegmentId = null,
  selectedClipKind = null,
  onUndo,
  onRedo,
  onRenderVideo,
}) {
  useEffect(() => {
    if (isModalOpen) return undefined;

    const handleKeyDown = (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;
      const key = (e.key || '').toLowerCase();

      // Space: Play / Pause
      if (e.code === 'Space' && !isMod && !e.altKey) {
        e.preventDefault();
        if (typeof document !== 'undefined' && document.activeElement && document.activeElement.tagName === 'BUTTON') {
          document.activeElement.blur();
        }
        onPlayPause?.();
        return;
      }

      // Ctrl/Cmd + B: Split Clip at Playhead
      if (isMod && key === 'b') {
        e.preventDefault();
        onSplitClip?.(currentTime, selectedSegmentId ?? activeClipId);
        return;
      }

      // Ctrl/Cmd + Z: Undo / Redo
      if (isMod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo?.();
        } else {
          onUndo?.();
        }
        return;
      }

      // Ctrl/Cmd + Y: Redo
      if (isMod && key === 'y') {
        e.preventDefault();
        onRedo?.();
        return;
      }

      // Ctrl/Cmd + E: Export / Render Video
      if (isMod && key === 'e') {
        e.preventDefault();
        onRenderVideo?.();
        return;
      }

      // Delete / Backspace: Delete Selected Segment or Clip (respecting selectedClipKind)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isMod) {
        if (selectedClipKind === 'video' && activeClipId) {
          e.preventDefault();
          onDeleteClip?.(activeClipId);
        } else if ((selectedClipKind === 'voice' || selectedClipKind === 'subtitle') && selectedSegmentId !== null && selectedSegmentId !== undefined) {
          e.preventDefault();
          onDeleteSegment?.(selectedSegmentId);
        } else if (selectedSegmentId !== null && selectedSegmentId !== undefined) {
          e.preventDefault();
          onDeleteSegment?.(selectedSegmentId);
        } else if (activeClipId) {
          e.preventDefault();
          onDeleteClip?.(activeClipId);
        }
        return;
      }

      // Left / Right Arrows: Step Playhead (-1s / +1s, or -5s / +5s with Shift)
      if (e.key === 'ArrowLeft' && !isMod && !e.altKey) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        onSeek?.(Math.max(0, (Number(currentTime) || 0) - step));
        return;
      }

      if (e.key === 'ArrowRight' && !isMod && !e.altKey) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const maxDur = Number(duration) > 0 ? Number(duration) : Infinity;
        onSeek?.(Math.min(maxDur, (Number(currentTime) || 0) + step));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isModalOpen,
    onPlayPause,
    onSeek,
    currentTime,
    duration,
    onSplitClip,
    onDeleteClip,
    onDeleteSegment,
    activeClipId,
    selectedSegmentId,
    selectedClipKind,
    onUndo,
    onRedo,
    onRenderVideo,
  ]);
}

