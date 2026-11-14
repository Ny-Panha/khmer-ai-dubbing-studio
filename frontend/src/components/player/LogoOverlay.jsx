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

  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    const onMouseMove = (moveEvt) => {
      // Dragging active
    };

    const onMouseUp = (upEvt) => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      const dx = upEvt.clientX - (dragStartRef.current?.x || 0);
      const dy = upEvt.clientY - (dragStartRef.current?.y || 0);

      // If user moved more than 20px, determine the quadrant to snap to
      if (Math.hypot(dx, dy) > 20 && onUpdateVoiceSettings) {
        const isRight = upEvt.clientX > window.innerWidth / 2;
        const isBottom = upEvt.clientY > window.innerHeight / 2;
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

  const renderLogoItem = (posName, styleObj) => (
    <div
      className={`logo-overlay-item ${shapeClass} ${isHovered ? 'hovered' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        ...styleObj,
        width: `${size}px`,
        height: `${size}px`,
        opacity,
        cursor: 'grab',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleLogoMouseDown}
      title="ចុចអូស (Drag) ឬចុចជ្រើសរើសជ្រុងដើម្បីប្តូរទីតាំង Logo"
    >
      <img src={logoImage} alt="Watermark Logo" draggable={false} />

      {/* Quick Corner Switcher Popover on Hover */}
      {isHovered && !isDragging && (
        <div className="logo-hover-controls" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`corner-btn ${logoPosition === 'top-left' ? 'active' : ''}`}
            onClick={(e) => handleCornerSelect(e, 'top-left')}
            title="ផ្លាស់ប្តូរទៅ ឆ្វេងលើ (Top-Left)"
          >
            ↖
          </button>
          <button
            type="button"
            className={`corner-btn ${logoPosition === 'top-right' ? 'active' : ''}`}
            onClick={(e) => handleCornerSelect(e, 'top-right')}
            title="ផ្លាស់ប្តូរទៅ ស្តាំលើ (Top-Right)"
          >
            ↗
          </button>
          <button
            type="button"
            className={`corner-btn ${logoPosition === 'bottom-left' ? 'active' : ''}`}
            onClick={(e) => handleCornerSelect(e, 'bottom-left')}
            title="ផ្លាស់ប្តូរទៅ ឆ្វេងក្រោម (Bottom-Left)"
          >
            ↙
          </button>
          <button
            type="button"
            className={`corner-btn ${logoPosition === 'bottom-right' ? 'active' : ''}`}
            onClick={(e) => handleCornerSelect(e, 'bottom-right')}
            title="ផ្លាស់ប្តូរទៅ ស្តាំក្រោម (Bottom-Right)"
          >
            ↘
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="logo-overlay-root">
      {renderLeft && renderLogoItem('top-left', { top: topOffset, left: `${margin}px` })}
      {renderRight && renderLogoItem('top-right', { top: topOffset, right: `${margin}px` })}
      {renderBottomLeft && renderLogoItem('bottom-left', { bottom: bottomOffset, left: `${margin}px` })}
      {renderBottomRight && renderLogoItem('bottom-right', { bottom: bottomOffset, right: `${margin}px` })}
    </div>
  );
}
