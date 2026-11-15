import React, { useState, useRef } from 'react';
import './LogoOverlay.css';

export default function LogoOverlay({
  voiceSettings = {},
  renderedVideo = null,
  aspectRatio = '16:9',
  verticalStyle = 'pad',
  videoMeta = null,
  onUpdateVoiceSettings = null,
}) {
  const {
    enableLogo = false,
    logoImage = null,
    logoPosition = 'top-right',
    logoSize = 72,
    logoOpacity = 0.9,
    logoShape = 'circle',
    logoMargin = 20,
    logoXPercent,
    logoYPercent,
  } = voiceSettings || {};

  const rootRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
  const [liveCoords, setLiveCoords] = useState(null);
  const dragStartRef = useRef(null);

  if (!enableLogo || !logoImage || renderedVideo) {
    return null;
  }

  // Scale logo proportionally for 9:16 vertical player container
  const scaleFactor = aspectRatio === '9:16' ? 0.55 : 1.0;
  const size = Math.round(Math.max(24, Math.min(200, Number(logoSize) || 72)) * scaleFactor);
  const opacity = Math.max(0.1, Math.min(1.0, Number(logoOpacity) || 0.9));
  const margin = Math.round(Math.max(5, Math.min(80, Number(logoMargin) || 20)) * scaleFactor);
  const shapeClass = logoShape === 'circle' ? 'shape-circle' : 'shape-square';

  // In 9:16 letterbox (16:9 video centered vertically, pad mode):
  const is916Letterbox = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const topOffset = is916Letterbox ? `calc(34.2% + ${margin}px)` : `${margin}px`;
  const bottomOffset = is916Letterbox ? `calc(34.2% + ${margin}px)` : `${margin}px`;

  // Free positioning: custom or center or explicit x/y percentages
  const isCustom = logoPosition === 'custom' || logoPosition === 'center' || (typeof logoXPercent === 'number' && typeof logoYPercent === 'number');

  const effectiveX = logoPosition === 'center'
    ? 50
    : (typeof logoXPercent === 'number' ? Math.max(0, Math.min(100, logoXPercent)) : 50);
  const effectiveY = logoPosition === 'center'
    ? 50
    : (typeof logoYPercent === 'number' ? Math.max(0, Math.min(100, logoYPercent)) : 50);

  // Determine preset positions to render
  const renderLeft = !isCustom && (logoPosition === 'both' || logoPosition === 'top-left');
  const renderRight = !isCustom && (logoPosition === 'both' || logoPosition === 'top-right');
  const renderBottomLeft = !isCustom && (logoPosition === 'bottom-left');
  const renderBottomRight = !isCustom && (logoPosition === 'bottom-right');

  const handleCornerSelect = (e, newPos) => {
    e.stopPropagation();
    e.preventDefault();
    if (onUpdateVoiceSettings) {
      if (newPos === 'center') {
        onUpdateVoiceSettings({
          ...voiceSettings,
          logoPosition: 'center',
          logoXPercent: 50,
          logoYPercent: 50,
        });
      } else {
        onUpdateVoiceSettings({
          ...voiceSettings,
          logoPosition: newPos,
          logoXPercent: undefined,
          logoYPercent: undefined,
        });
      }
    }
  };

  const handleLogoMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const itemEl = e.currentTarget;
    const itemRect = itemEl.getBoundingClientRect();
    const rootEl = rootRef.current || itemEl.parentElement;
    const rootRect = rootEl.getBoundingClientRect();

    setIsDragging(true);
    setDragDelta({ x: 0, y: 0 });
    setLiveCoords(null);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      itemRect,
      rootRect,
      wasCustom: isCustom,
      initialXPercent: effectiveX,
      initialYPercent: effectiveY,
    };

    const onMouseMove = (moveEvt) => {
      if (!dragStartRef.current) return;
      const dx = moveEvt.clientX - dragStartRef.current.startX;
      const dy = moveEvt.clientY - dragStartRef.current.startY;
      setDragDelta({ x: dx, y: dy });

      // Calculate real-time coordinates for visual feedback
      const curRootRect = rootRef.current ? rootRef.current.getBoundingClientRect() : dragStartRef.current.rootRect;
      const curItemRect = dragStartRef.current.itemRect;
      const newLeft = curItemRect.left - curRootRect.left + dx;
      const newTop = curItemRect.top - curRootRect.top + dy;
      const availW = Math.max(1, curRootRect.width - curItemRect.width);
      const availH = Math.max(1, curRootRect.height - curItemRect.height);
      const xPct = Math.max(0, Math.min(100, Math.round((newLeft / availW) * 1000) / 10));
      const yPct = Math.max(0, Math.min(100, Math.round((newTop / availH) * 1000) / 10));
      setLiveCoords({ xPct, yPct });
    };

    const onMouseUp = (upEvt) => {
      setIsDragging(false);
      setLiveCoords(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (!dragStartRef.current) return;

      const dx = upEvt.clientX - dragStartRef.current.startX;
      const dy = upEvt.clientY - dragStartRef.current.startY;
      setDragDelta({ x: 0, y: 0 });

      // If clicked without dragging (< 6px movement), cycle corner to next position
      if (Math.hypot(dx, dy) < 6 && onUpdateVoiceSettings) {
        const cycleMap = {
          'top-right': 'bottom-right',
          'bottom-right': 'bottom-left',
          'bottom-left': 'top-left',
          'top-left': 'center',
          'center': 'top-right',
          'both': 'top-right',
          'custom': 'top-right',
        };
        const nextPos = cycleMap[logoPosition] || 'top-right';
        if (nextPos === 'center') {
          onUpdateVoiceSettings({ ...voiceSettings, logoPosition: 'center', logoXPercent: 50, logoYPercent: 50 });
        } else {
          onUpdateVoiceSettings({ ...voiceSettings, logoPosition: nextPos, logoXPercent: undefined, logoYPercent: undefined });
        }
        return;
      }

      // If dragged (>= 6px), freely place anywhere on the video canvas (Free Move)
      if (Math.hypot(dx, dy) >= 6 && onUpdateVoiceSettings && rootRef.current) {
        const curRootRect = rootRef.current.getBoundingClientRect();
        const curItemRect = dragStartRef.current.itemRect;
        const newLeft = curItemRect.left - curRootRect.left + dx;
        const newTop = curItemRect.top - curRootRect.top + dy;
        const availW = Math.max(1, curRootRect.width - curItemRect.width);
        const availH = Math.max(1, curRootRect.height - curItemRect.height);

        const xPct = Math.max(0, Math.min(100, Math.round((newLeft / availW) * 1000) / 10));
        const yPct = Math.max(0, Math.min(100, Math.round((newTop / availH) * 1000) / 10));

        onUpdateVoiceSettings({
          ...voiceSettings,
          logoPosition: 'custom',
          logoXPercent: xPct,
          logoYPercent: yPct,
        });
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const renderLogoItem = (posName, baseStyle = {}) => {
    const isThisDragged = isDragging;

    let itemStyle = {
      ...baseStyle,
      width: `${size}px`,
      height: `${size}px`,
      opacity,
      cursor: isThisDragged ? 'grabbing' : 'grab',
    };

    if (isCustom) {
      itemStyle.left = `${effectiveX}%`;
      itemStyle.top = `${effectiveY}%`;
      itemStyle.transform = isThisDragged
        ? `translate(calc(-${effectiveX}% + ${dragDelta.x}px), calc(-${effectiveY}% + ${dragDelta.y}px))`
        : `translate(-${effectiveX}%, -${effectiveY}%)`;
    } else {
      itemStyle.transform = isThisDragged
        ? `translate(${dragDelta.x}px, ${dragDelta.y}px)`
        : 'none';
    }

    return (
      <div
        className={`logo-overlay-item ${shapeClass} ${isHovered ? 'hovered' : ''} ${isThisDragged ? 'dragging' : ''}`}
        style={itemStyle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleLogoMouseDown}
        title="ចុច (Click) ប្តូរទីតាំង ឬអូស (Drag) ដាក់កន្លែងណាក៏បាន (Free Move)"
      >
        <img src={logoImage} alt="Watermark Logo" draggable={false} />

        {/* Real-time coordinates pill while dragging */}
        {isThisDragged && liveCoords && (
          <div className="logo-drag-coords-badge">
            <span>X: {liveCoords.xPct}% | Y: {liveCoords.yPct}%</span>
          </div>
        )}

        {/* Quick Position Switcher Popover on Hover */}
        {isHovered && !isDragging && (
          <div className="logo-hover-controls" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`corner-btn ${logoPosition === 'top-left' ? 'active' : ''}`}
              onClick={(e) => handleCornerSelect(e, 'top-left')}
              title="ឆ្វេងលើ (Top-Left)"
            >
              ↖
            </button>
            <button
              type="button"
              className={`corner-btn ${logoPosition === 'top-right' ? 'active' : ''}`}
              onClick={(e) => handleCornerSelect(e, 'top-right')}
              title="ស្តាំលើ (Top-Right)"
            >
              ↗
            </button>
            <button
              type="button"
              className={`corner-btn ${logoPosition === 'center' ? 'active' : ''}`}
              onClick={(e) => handleCornerSelect(e, 'center')}
              title="ចំកណ្តាល (Center)"
            >
              🎯
            </button>
            <button
              type="button"
              className={`corner-btn ${logoPosition === 'bottom-left' ? 'active' : ''}`}
              onClick={(e) => handleCornerSelect(e, 'bottom-left')}
              title="ឆ្វេងក្រោម (Bottom-Left)"
            >
              ↙
            </button>
            <button
              type="button"
              className={`corner-btn ${logoPosition === 'bottom-right' ? 'active' : ''}`}
              onClick={(e) => handleCornerSelect(e, 'bottom-right')}
              title="ស្តាំក្រោម (Bottom-Right)"
            >
              ↘
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="logo-overlay-root" ref={rootRef}>
      {isCustom && renderLogoItem('custom')}
      {renderLeft && renderLogoItem('top-left', { top: topOffset, left: `${margin}px` })}
      {renderRight && renderLogoItem('top-right', { top: topOffset, right: `${margin}px` })}
      {renderBottomLeft && renderLogoItem('bottom-left', { bottom: bottomOffset, left: `${margin}px` })}
      {renderBottomRight && renderLogoItem('bottom-right', { bottom: bottomOffset, right: `${margin}px` })}
    </div>
  );
}
