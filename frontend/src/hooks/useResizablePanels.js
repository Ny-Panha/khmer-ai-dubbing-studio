import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook to handle 3-column resizable layout panels like CapCut Desktop
 * @param {React.RefObject} containerRef
 */
export function useResizablePanels(containerRef) {
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const saved = localStorage.getItem('CAPCUT_LEFT_PANEL_WIDTH');
    return saved ? Math.max(220, Math.min(650, parseInt(saved, 10))) : 320;
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('CAPCUT_RIGHT_PANEL_WIDTH');
    return saved ? Math.max(240, Math.min(650, parseInt(saved, 10))) : 340;
  });
  const [activeSplitter, setActiveSplitter] = useState(null); // 'left' | 'right' | null
  const dragSplitterRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('CAPCUT_LEFT_PANEL_WIDTH', String(leftPanelWidth));
  }, [leftPanelWidth]);

  useEffect(() => {
    localStorage.setItem('CAPCUT_RIGHT_PANEL_WIDTH', String(rightPanelWidth));
  }, [rightPanelWidth]);

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
        const maxLeft = Math.min(650, totalWidth - rightPanelWidth - 320);
        const nextLeft = Math.max(220, Math.min(maxLeft, startLeftWidth + delta));
        setLeftPanelWidth(nextLeft);
      } else if (side === 'right') {
        const delta = startX - e.clientX;
        const maxRight = Math.min(650, totalWidth - leftPanelWidth - 320);
        const nextRight = Math.max(240, Math.min(maxRight, startRightWidth + delta));
        setRightPanelWidth(nextRight);
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
