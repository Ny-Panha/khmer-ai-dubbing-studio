import { useState, useEffect, useRef } from 'react';

const MIN_LEFT_WIDTH = 220;
const MAX_LEFT_WIDTH = 650;
const DEFAULT_LEFT_WIDTH = 320;
const MIN_RIGHT_WIDTH = 240;
const MAX_RIGHT_WIDTH = 650;
const DEFAULT_RIGHT_WIDTH = 340;
const MIN_CENTER_RESERVE = 328; // 300px center panel min + 8px splitters + 20px slack

function readSavedPanelWidth(key, fallback, min, max) {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = Number.parseInt(saved, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  } catch {
    return fallback;
  }
}

function clampSideWidthsForViewport(rawLeft, rawRight, totalWidth) {
  const left = Number.isFinite(rawLeft) ? rawLeft : DEFAULT_LEFT_WIDTH;
  const right = Number.isFinite(rawRight) ? rawRight : DEFAULT_RIGHT_WIDTH;
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
    return { leftPanelWidth: left, rightPanelWidth: right };
  }
  const maxCombined = Math.max(0, totalWidth - MIN_CENTER_RESERVE);
  if (left + right <= maxCombined) {
    return { leftPanelWidth: left, rightPanelWidth: right };
  }
  if (maxCombined <= 0) {
    return { leftPanelWidth: MIN_LEFT_WIDTH, rightPanelWidth: MIN_RIGHT_WIDTH };
  }
  const scale = maxCombined / (left + right);
  const nextLeft = Math.max(MIN_LEFT_WIDTH, Math.floor(left * scale));
  const nextRight = Math.max(MIN_RIGHT_WIDTH, Math.min(right, maxCombined - nextLeft));
  const finalLeft = Math.max(MIN_LEFT_WIDTH, Math.min(nextLeft, maxCombined - nextRight));
  return { leftPanelWidth: finalLeft, rightPanelWidth: nextRight };
}

/**
 * Custom hook to handle 3-column resizable layout panels like CapCut Desktop
 * @param {React.RefObject} containerRef
 */
export function useResizablePanels(containerRef) {
  const [rawLeftWidth, setRawLeftWidth] = useState(() =>
    readSavedPanelWidth('CAPCUT_LEFT_PANEL_WIDTH', DEFAULT_LEFT_WIDTH, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH)
  );
  const [rawRightWidth, setRawRightWidth] = useState(() =>
    readSavedPanelWidth('CAPCUT_RIGHT_PANEL_WIDTH', DEFAULT_RIGHT_WIDTH, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH)
  );
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );
  const [activeSplitter, setActiveSplitter] = useState(null); // 'left' | 'right' | null
  const dragSplitterRef = useRef(null);

  useEffect(() => {
    try {
      if (Number.isFinite(rawLeftWidth)) {
        localStorage.setItem('CAPCUT_LEFT_PANEL_WIDTH', String(rawLeftWidth));
      }
    } catch {}
  }, [rawLeftWidth]);

  useEffect(() => {
    try {
      if (Number.isFinite(rawRightWidth)) {
        localStorage.setItem('CAPCUT_RIGHT_PANEL_WIDTH', String(rawRightWidth));
      }
    } catch {}
  }, [rawRightWidth]);

  useEffect(() => {
    const updateWidth = () => {
      const nextWidth = containerRef?.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1440);
      if (Number.isFinite(nextWidth) && nextWidth > 0) {
        setContainerWidth((prev) => (prev === nextWidth ? prev : nextWidth));
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef?.current) {
      ro = new ResizeObserver(updateWidth);
      ro.observe(containerRef.current);
    }
    return () => {
      window.removeEventListener('resize', updateWidth);
      if (ro) ro.disconnect();
    };
  }, [containerRef]);

  const { leftPanelWidth, rightPanelWidth } = clampSideWidthsForViewport(
    rawLeftWidth,
    rawRightWidth,
    containerWidth
  );

  const handleStartSplitterDrag = (e, side) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSplitter(side);
    dragSplitterRef.current = {
      side,
      startX: e.clientX,
      startLeftWidth: leftPanelWidth,
      startRightWidth: rightPanelWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    if (!activeSplitter) return;

    const handleMouseMove = (e) => {
      if (!dragSplitterRef.current) return;
      const { side, startX, startLeftWidth, startRightWidth } = dragSplitterRef.current;
      const totalWidth = containerRef?.current ? containerRef.current.clientWidth : window.innerWidth;

      if (side === 'left') {
        const delta = e.clientX - startX;
        const maxLeft = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, totalWidth - rightPanelWidth - 320));
        const nextLeft = Math.max(MIN_LEFT_WIDTH, Math.min(maxLeft, startLeftWidth + delta));
        if (Number.isFinite(nextLeft)) setRawLeftWidth(nextLeft);
      } else if (side === 'right') {
        const delta = startX - e.clientX;
        const maxRight = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, totalWidth - leftPanelWidth - 320));
        const nextRight = Math.max(MIN_RIGHT_WIDTH, Math.min(maxRight, startRightWidth + delta));
        if (Number.isFinite(nextRight)) setRawRightWidth(nextRight);
      }
    };

    const handleMouseUp = () => {
      setActiveSplitter(null);
      dragSplitterRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [activeSplitter, leftPanelWidth, rightPanelWidth, containerRef]);

  return {
    leftPanelWidth,
    rightPanelWidth,
    activeSplitter,
    handleStartSplitterDrag,
  };
}
