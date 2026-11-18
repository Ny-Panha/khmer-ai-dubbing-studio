import React, { useState, useRef, useEffect, useCallback } from 'react';
import { dispatchDraftPreview, clearDraftPreview } from '../../utils/sliderDraftPreview';

/**
 * Smooth-drag range slider for Inspector & Settings panels.
 * - During pointer drag: updates local draft state + lightweight preview bus ONLY
 *   (no full-studio state commit, no localStorage write, no backend sync, no render invalidation).
 * - On drag release (pointerup/pointercancel anywhere on window): commits ONCE.
 * - Keyboard arrows / programmatic change: commits immediately as a single commit.
 */
export default function SmoothRangeSlider({
  value,
  min,
  max,
  step = 1,
  disabled = false,
  className = '',
  style,
  title,
  previewKey = null,
  onDraftChange = null,
  onCommit,
  ...rest
}) {
  const [draftValue, setDraftValue] = useState(null);
  const isDraggingRef = useRef(false);
  const dirtyRef = useRef(false);
  const latestDraftRef = useRef(null);
  const lastDragCommitRef = useRef({ val: null, t: 0 });
  const cleanupWindowRef = useRef(null);

  const onCommitRef = useRef(onCommit);
  const onDraftChangeRef = useRef(onDraftChange);
  const previewKeyRef = useRef(previewKey);

  useEffect(() => {
    onCommitRef.current = onCommit;
    onDraftChangeRef.current = onDraftChange;
    previewKeyRef.current = previewKey;
  }, [onCommit, onDraftChange, previewKey]);

  const detachWindowListeners = useCallback(() => {
    if (cleanupWindowRef.current) {
      cleanupWindowRef.current();
      cleanupWindowRef.current = null;
    }
  }, []);

  const finishDrag = useCallback(() => {
    detachWindowListeners();
    if (!isDraggingRef.current) return;
    const shouldCommit = dirtyRef.current && Number.isFinite(latestDraftRef.current);
    const finalVal = latestDraftRef.current;

    isDraggingRef.current = false;
    dirtyRef.current = false;
    latestDraftRef.current = null;

    if (shouldCommit && typeof onCommitRef.current === 'function') {
      lastDragCommitRef.current = { val: finalVal, t: Date.now() };
      onCommitRef.current(finalVal);
    }

    setDraftValue(null);
    if (typeof onDraftChangeRef.current === 'function') {
      onDraftChangeRef.current(null);
    }
    if (previewKeyRef.current) {
      clearDraftPreview(previewKeyRef.current);
    }
  }, [detachWindowListeners]);

  useEffect(() => {
    return () => {
      detachWindowListeners();
      if (isDraggingRef.current && previewKeyRef.current) {
        clearDraftPreview(previewKeyRef.current);
      }
      isDraggingRef.current = false;
    };
  }, [detachWindowListeners]);

  const handlePointerDown = (e) => {
    if (disabled) return;
    // Only primary mouse button or touch/pen
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    detachWindowListeners();
    isDraggingRef.current = true;
    dirtyRef.current = false;
    const numStart = Number(value);
    latestDraftRef.current = Number.isFinite(numStart) ? numStart : Number(min) || 0;
    setDraftValue(latestDraftRef.current);

    if (typeof window !== 'undefined') {
      const onWinUp = () => finishDrag();
      window.addEventListener('pointerup', onWinUp, { passive: true });
      window.addEventListener('pointercancel', onWinUp, { passive: true });
      cleanupWindowRef.current = () => {
        window.removeEventListener('pointerup', onWinUp);
        window.removeEventListener('pointercancel', onWinUp);
      };
    }
  };

  const handleChange = (e) => {
    const nextVal = parseFloat(e.target.value);
    if (!Number.isFinite(nextVal)) return;

    if (isDraggingRef.current) {
      dirtyRef.current = true;
      latestDraftRef.current = nextVal;
      setDraftValue(nextVal);
      if (typeof onDraftChangeRef.current === 'function') {
        onDraftChangeRef.current(nextVal);
      }
      if (previewKeyRef.current) {
        dispatchDraftPreview(previewKeyRef.current, nextVal);
      }
    } else {
      // Ignore trailing native change event with identical value right after pointerup commit
      if (
        lastDragCommitRef.current.val === nextVal &&
        (Date.now() - lastDragCommitRef.current.t) < 80
      ) {
        return;
      }
      // Keyboard arrows or non-drag change: single direct commit
      setDraftValue(null);
      if (typeof onDraftChangeRef.current === 'function') {
        onDraftChangeRef.current(null);
      }
      if (typeof onCommitRef.current === 'function') {
        onCommitRef.current(nextVal);
      }
    }
  };

  const displayedValue = draftValue !== null ? draftValue : value;

  return (
    <input
      {...rest}
      type="range"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={displayedValue}
      onPointerDown={handlePointerDown}
      onChange={handleChange}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      className={className}
      style={style}
      title={title}
    />
  );
}
