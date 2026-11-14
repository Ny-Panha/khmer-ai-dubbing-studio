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
  } = voiceSettings || {};

  const rootRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
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

  // Determine positions to render
  const renderLeft = logoPosition === 'both' || logoPosition === 'top-left';
  const renderRight = logoPosition === 'both' || logoPosition === 'top-right';
  const renderBottomLeft = logoPosition === 'bottom-left';
  const renderBottomRight = logoPosition === 'bottom-right';

  const handleCornerSelect = (e, newPos) => {
    e.stopPropagation();
    e.preventDefault();
    if (onUpdateVoiceSettings) {
      onUpdateVoiceSettings({ ...voiceSettings, logoPosition: newPos });
    }
  };

  const handleLogoMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    setIsDragging(true);
    setDragDelta({ x: 0, y: 0 });
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    const onMouseMove = (moveEvt) => {
      const dx = moveEvt.clientX - dragStartRef.current.x;
      const dy = moveEvt.clientY - dragStartRef.current.y;
      setDragDelta({ x: dx, y: dy });
    };

    const onMouseUp = (upEvt) => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      const dx = upEvt.clientX - (dragStartRef.current?.x || 0);
      const dy = upEvt.clientY - (dragStartRef.current?.y || 0);
      setDragDelta({ x: 0, y: 0 });

      // If clicked without dragging (< 6px movement), cycle corner to next position
      if (Math.hypot(dx, dy) < 6 && onUpdateVoiceSettings) {
        const cycleMap = {
          'top-right': 'bottom-right',
          'bottom-right': 'bottom-left',
          'bottom-left': 'top-left',
          'top-left': 'top-right',
          'both': 'top-right',
        };
        const nextPos = cycleMap[logoPosition] || 'top-right';
        onUpdateVoiceSettings({ ...voiceSettings, logoPosition: nextPos });
        return;
      }

      // If dragged, find quadrant relative to the player canvas
      if (Math.hypot(dx, dy) >= 6 && onUpdateVoiceSettings && rootRef.current) {
        const rect = rootRef.current.getBoundingClientRect();
        const relX = upEvt.clientX - rect.left;
        const relY = upEvt.clientY - rect.top;
        const isRight = relX >= rect.width / 2;
        const isBottom = relY >= rect.height / 2;

        let targetPos = 'top-right';
        if (!isRight && !isBottom) targetPos = 'top-left';
        else if (isRight && !isBottom) targetPos = 'top-right';
        else if (!isRight && isBottom) targetPos = 'bottom-left';
        else if (isRight && isBottom) targetPos = 'bottom-right';

        onUpdateVoiceSettings({ ...voiceSettings, logoPosition: targetPos });
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const renderLogoItem = (posName, styleObj) => {
    const isThisDragged = isDragging;
    const transformStyle = isThisDragged
      ? `translate(${dragDelta.x}px, ${dragDelta.y}px)`
      : 'none';

    return (
      <div
        className={`logo-overlay-item ${shapeClass} ${isHovered ? 'hovered' : ''} ${isThisDragged ? 'dragging' : ''}`}
        style={{
          ...styleObj,
          width: `${size}px`,
          height: `${size}px`,
          opacity,
          transform: transformStyle,
          cursor: isThisDragged ? 'grabbing' : 'grab',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleLogoMouseDown}
        title="ចុច (Click) ដើម្បីប្តូរជ្រុង ឬអូស (Drag) ទៅជ្រុងដែលចង់ដាក់"
      >
        <img src={logoImage} alt="Watermark Logo" draggable={false} />

        {/* Quick Corner Switcher Popover on Hover */}
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
      {renderLeft && renderLogoItem('top-left', { top: topOffset, left: `${margin}px` })}
      {renderRight && renderLogoItem('top-right', { top: topOffset, right: `${margin}px` })}
      {renderBottomLeft && renderLogoItem('bottom-left', { bottom: bottomOffset, left: `${margin}px` })}
      {renderBottomRight && renderLogoItem('bottom-right', { bottom: bottomOffset, right: `${margin}px` })}
    </div>
  );
}
