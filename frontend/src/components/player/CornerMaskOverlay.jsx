import React, { useState, useEffect, useRef } from 'react';
import './CornerMaskOverlay.css';
import { subscribeDraftPreview } from '../../utils/sliderDraftPreview';

const MASK_DRAFT_KEYS = [
  'cornerMaskWidth',
  'cornerMaskHeight',
  'cornerMaskOffsetX',
  'cornerMaskOffsetY',
  'cornerMaskBlur',
];

/**
 * Corner Mask / Disclaimer Blocker Overlay
 * Cleanly blocks Chinese disclaimers, watermarks, or logos anywhere on video
 * with a customizable Khmer disclaimer badge, frosted blur box, or solid patch.
 * Supports free drag-and-drop placement & corner resize directly on the preview.
 */
export default function CornerMaskOverlay({
  voiceSettings = {},
  renderedVideo = null,
  aspectRatio = '16:9',
  verticalStyle = 'pad',
  videoMeta = null,
  onUpdateVoiceSettings = null,
}) {
  const [draftOverrides, setDraftOverrides] = useState({});
  const canvasRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  const [dragMode, setDragMode] = useState(null); // 'move' | 'resize' | null
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
  const [liveBadge, setLiveBadge] = useState(null);
  const dragStartRef = useRef(null);

  useEffect(() => {
    return subscribeDraftPreview(MASK_DRAFT_KEYS, ({ key, value, cleared }) => {
      setDraftOverrides((prev) => {
        if (cleared) {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (prev[key] === value) return prev;
        return { ...prev, [key]: value };
      });
    });
  }, []);

  const hasActiveDraft = Object.keys(draftOverrides).length > 0;
  const merged = hasActiveDraft ? { ...(voiceSettings || {}), ...draftOverrides } : (voiceSettings || {});

  const {
    enableCornerMask = false,
    cornerMaskText = '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»',
    cornerMaskStyle = 'badge', // 'badge' | 'blur' | 'solid'
    cornerMaskPosition = 'top-right', // 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'custom'
    cornerMaskWidth = 220,
    cornerMaskHeight = 54,
    cornerMaskOpacity = 0.95,
    cornerMaskBlur = 18,
    cornerMaskOffsetX = 14,
    cornerMaskOffsetY = 14,
    cornerMaskXPercent,
    cornerMaskYPercent,
  } = merged;

  if (!enableCornerMask || renderedVideo) {
    return null;
  }

  // Scale dimensions proportionally for 9:16 vertical player container
  const scale = aspectRatio === '9:16' ? 0.65 : 1.0;
  const baseW = Math.max(60, Math.min(500, Number(cornerMaskWidth) || 220));
  const baseH = Math.max(20, Math.min(200, Number(cornerMaskHeight) || 54));
  const previewW = Math.round(baseW * scale);
  const previewH = Math.round(baseH * scale);
  const displayW = dragMode === 'resize'
    ? Math.max(Math.round(60 * scale), Math.min(Math.round(500 * scale), previewW + dragDelta.x))
    : previewW;
  const displayH = dragMode === 'resize'
    ? Math.max(Math.round(20 * scale), Math.min(Math.round(200 * scale), previewH + dragDelta.y))
    : previewH;

  const blurPx = Math.max(4, Math.min(40, Math.round((Number.isFinite(Number(cornerMaskBlur)) ? Number(cornerMaskBlur) : 18) * scale)));
  const rawOffsetX = Number.isFinite(Number(cornerMaskOffsetX)) ? Number(cornerMaskOffsetX) : 14;
  const rawOffsetY = Number.isFinite(Number(cornerMaskOffsetY)) ? Number(cornerMaskOffsetY) : 14;
  const offsetX = Math.max(0, Math.min(200, Math.round(rawOffsetX * scale)));
  const offsetY = Math.max(0, Math.min(200, Math.round(rawOffsetY * scale)));

  // Solid Black & Real Blur must render at full opacity (1.0) so watermarks never bleed through
  const opacity = (cornerMaskStyle === 'solid' || cornerMaskStyle === 'blur')
    ? 1
    : Math.max(0.1, Math.min(1.0, Number(cornerMaskOpacity) || 0.95));

  const isCustomPos = cornerMaskPosition === 'custom' &&
    typeof cornerMaskXPercent === 'number' && Number.isFinite(cornerMaskXPercent) &&
    typeof cornerMaskYPercent === 'number' && Number.isFinite(cornerMaskYPercent);
  const effectiveX = isCustomPos ? Math.max(0, Math.min(100, cornerMaskXPercent)) : 50;
  const effectiveY = isCustomPos ? Math.max(0, Math.min(100, cornerMaskYPercent)) : 50;

  const is916Letterbox = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const aspectClass = is916Letterbox ? 'aspect-9-16-letterbox' : '';
  const posClass = isCustomPos ? 'pos-custom' : `pos-${cornerMaskPosition}`;
  const styleClass = `style-${cornerMaskStyle}`;

  // Font size scales with height
  const fontSize = Math.max(9, Math.min(18, Math.round(displayH * 0.28)));

  const positionStyle = {};
  if (isCustomPos) {
    positionStyle.left = `${effectiveX}%`;
    positionStyle.top = `${effectiveY}%`;
    positionStyle.right = 'auto';
    positionStyle.bottom = 'auto';
    positionStyle.transform = dragMode === 'move'
      ? `translate(calc(-${effectiveX}% + ${dragDelta.x}px), calc(-${effectiveY}% + ${dragDelta.y}px))`
      : `translate(-${effectiveX}%, -${effectiveY}%)`;
  } else {
    if (cornerMaskPosition === 'top-left' || cornerMaskPosition === 'bottom-left') {
      positionStyle.left = `${offsetX}px`;
      positionStyle.right = 'auto';
    } else {
      positionStyle.right = `${offsetX}px`;
      positionStyle.left = 'auto';
    }
    if (cornerMaskPosition === 'bottom-left' || cornerMaskPosition === 'bottom-right') {
      positionStyle.bottom = is916Letterbox ? `calc(34.2% + ${offsetY}px)` : `${offsetY}px`;
      positionStyle.top = 'auto';
    } else {
      positionStyle.top = is916Letterbox ? `calc(34.2% + ${offsetY}px)` : `${offsetY}px`;
      positionStyle.bottom = 'auto';
    }
    if (dragMode === 'move') {
      positionStyle.transform = `translate(${dragDelta.x}px, ${dragDelta.y}px)`;
    }
  }

  const innerBlurStyle = cornerMaskStyle === 'blur'
    ? {
        backdropFilter: `blur(${blurPx}px)`,
        WebkitBackdropFilter: `blur(${blurPx}px)`,
      }
    : undefined;

  const handleCornerPresetClick = (e, posId) => {
    e.stopPropagation();
    e.preventDefault();
    if (!onUpdateVoiceSettings) return;
    if (posId === 'center') {
      onUpdateVoiceSettings({
        ...voiceSettings,
        cornerMaskPosition: 'custom',
        cornerMaskXPercent: 50,
        cornerMaskYPercent: 50,
      });
    } else {
      onUpdateVoiceSettings({
        ...voiceSettings,
        cornerMaskPosition: posId,
        cornerMaskXPercent: null,
        cornerMaskYPercent: null,
      });
    }
  };

  const handleMoveMouseDown = (e) => {
    if (e.button !== 0 || !onUpdateVoiceSettings) return;
    if (e.target?.closest?.('.corner-mask-resize-handle, .corner-mask-hover-controls')) return;
    e.stopPropagation();
    e.preventDefault();

    const itemEl = e.currentTarget;
    const itemRect = itemEl.getBoundingClientRect();
    const canvasEl = canvasRef.current || itemEl.parentElement;
    const canvasRect = canvasEl.getBoundingClientRect();

    setDragMode('move');
    setDragDelta({ x: 0, y: 0 });
    setLiveBadge(null);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      itemRect,
      canvasRect,
    };

    const onMouseMove = (moveEvt) => {
      if (!dragStartRef.current) return;
      const dx = moveEvt.clientX - dragStartRef.current.startX;
      const dy = moveEvt.clientY - dragStartRef.current.startY;
      setDragDelta({ x: dx, y: dy });

      const curCanvas = canvasRef.current ? canvasRef.current.getBoundingClientRect() : dragStartRef.current.canvasRect;
      const curItem = dragStartRef.current.itemRect;
      const newLeft = curItem.left - curCanvas.left + dx;
      const newTop = curItem.top - curCanvas.top + dy;
      const availW = Math.max(1, curCanvas.width - curItem.width);
      const availH = Math.max(1, curCanvas.height - curItem.height);
      const xPct = Math.max(0, Math.min(100, Math.round((newLeft / availW) * 1000) / 10));
      const yPct = Math.max(0, Math.min(100, Math.round((newTop / availH) * 1000) / 10));
      setLiveBadge(`X: ${xPct}% · Y: ${yPct}%`);
    };

    const onMouseUp = (upEvt) => {
      setDragMode(null);
      setLiveBadge(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (!dragStartRef.current) return;
      const dx = upEvt.clientX - dragStartRef.current.startX;
      const dy = upEvt.clientY - dragStartRef.current.startY;
      setDragDelta({ x: 0, y: 0 });

      if (Math.hypot(dx, dy) >= 4 && canvasRef.current) {
        const curCanvas = canvasRef.current.getBoundingClientRect();
        const curItem = dragStartRef.current.itemRect;
        const newLeft = curItem.left - curCanvas.left + dx;
        const newTop = curItem.top - curCanvas.top + dy;
        const availW = Math.max(1, curCanvas.width - curItem.width);
        const availH = Math.max(1, curCanvas.height - curItem.height);
        const xPct = Math.max(0, Math.min(100, Math.round((newLeft / availW) * 1000) / 10));
        const yPct = Math.max(0, Math.min(100, Math.round((newTop / availH) * 1000) / 10));
        onUpdateVoiceSettings({
          ...voiceSettings,
          cornerMaskPosition: 'custom',
          cornerMaskXPercent: xPct,
          cornerMaskYPercent: yPct,
        });
      }
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleResizeMouseDown = (e) => {
    if (e.button !== 0 || !onUpdateVoiceSettings) return;
    e.stopPropagation();
    e.preventDefault();

    setDragMode('resize');
    setDragDelta({ x: 0, y: 0 });
    setLiveBadge(`${baseW}×${baseH}px`);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialW: baseW,
      initialH: baseH,
    };

    const onMouseMove = (moveEvt) => {
      if (!dragStartRef.current) return;
      const dx = moveEvt.clientX - dragStartRef.current.startX;
      const dy = moveEvt.clientY - dragStartRef.current.startY;
      setDragDelta({ x: dx, y: dy });
      const nextW = Math.max(60, Math.min(500, Math.round(dragStartRef.current.initialW + dx / scale)));
      const nextH = Math.max(20, Math.min(200, Math.round(dragStartRef.current.initialH + dy / scale)));
      setLiveBadge(`${nextW}×${nextH}px`);
    };

    const onMouseUp = (upEvt) => {
      setDragMode(null);
      setLiveBadge(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (!dragStartRef.current) return;
      const dx = upEvt.clientX - dragStartRef.current.startX;
      const dy = upEvt.clientY - dragStartRef.current.startY;
      setDragDelta({ x: 0, y: 0 });

      if (Math.hypot(dx, dy) >= 2) {
        const nextW = Math.max(60, Math.min(500, Math.round(dragStartRef.current.initialW + dx / scale)));
        const nextH = Math.max(20, Math.min(200, Math.round(dragStartRef.current.initialH + dy / scale)));
        onUpdateVoiceSettings({
          ...voiceSettings,
          cornerMaskWidth: nextW,
          cornerMaskHeight: nextH,
        });
      }
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="corner-mask-canvas" ref={canvasRef}>
      <div
        className={`corner-mask-root ${posClass} ${aspectClass} ${isHovered ? 'hovered' : ''} ${dragMode ? 'is-dragging' : ''}`}
        data-testid="corner-mask-root"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleMoveMouseDown}
        title="អូស (Drag) ដាក់កន្លែងណាក៏បាន ឬអូសជ្រុងក្រោមស្តាំដើម្បីកែទំហំ"
        style={{
          width: `${displayW}px`,
          height: `${displayH}px`,
          opacity,
          cursor: onUpdateVoiceSettings ? (dragMode === 'move' ? 'grabbing' : 'grab') : 'default',
          ...((hasActiveDraft || dragMode) ? { transition: 'none' } : null),
          ...positionStyle,
        }}
      >
        <div className={`corner-mask-inner ${styleClass}`} style={innerBlurStyle}>
          {cornerMaskStyle !== 'blur' && cornerMaskText && (
            <span
              className="corner-mask-text"
              style={{ fontSize: `${fontSize}px` }}
            >
              {cornerMaskText}
            </span>
          )}
        </div>

        {dragMode && liveBadge && (
          <div className="corner-mask-coords-badge">
            <span>{liveBadge}</span>
          </div>
        )}

        {onUpdateVoiceSettings && isHovered && !dragMode && (
          <>
            <div
              className="corner-mask-resize-handle"
              onMouseDown={handleResizeMouseDown}
              title="អូសកែទំហំប្រអប់ Mask"
            />
            <div className="corner-mask-hover-controls" onClick={(e) => e.stopPropagation()}>
              <button type="button" className={`corner-mask-pos-btn ${cornerMaskPosition === 'top-left' ? 'active' : ''}`} onClick={(e) => handleCornerPresetClick(e, 'top-left')} title="ឆ្វេងលើ">↖</button>
              <button type="button" className={`corner-mask-pos-btn ${cornerMaskPosition === 'top-right' ? 'active' : ''}`} onClick={(e) => handleCornerPresetClick(e, 'top-right')} title="ស្តាំលើ">↗</button>
              <button type="button" className={`corner-mask-pos-btn ${isCustomPos ? 'active' : ''}`} onClick={(e) => handleCornerPresetClick(e, 'center')} title="កណ្តាល">🎯</button>
              <button type="button" className={`corner-mask-pos-btn ${cornerMaskPosition === 'bottom-left' ? 'active' : ''}`} onClick={(e) => handleCornerPresetClick(e, 'bottom-left')} title="ឆ្វេងក្រោម">↙</button>
              <button type="button" className={`corner-mask-pos-btn ${cornerMaskPosition === 'bottom-right' ? 'active' : ''}`} onClick={(e) => handleCornerPresetClick(e, 'bottom-right')} title="ស្តាំក្រោម">↘</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
