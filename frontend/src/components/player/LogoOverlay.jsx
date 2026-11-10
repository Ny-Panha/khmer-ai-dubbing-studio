import React from 'react';
import './LogoOverlay.css';

export default function LogoOverlay({
  voiceSettings = {},
  renderedVideo = null,
  aspectRatio = '16:9',
  verticalStyle = 'pad',
  videoMeta = null,
}) {
  const {
    enableLogo = false,
    logoImage = null,
    logoPosition = 'both',
    logoSize = 72,
    logoOpacity = 0.9,
    logoShape = 'circle',
    logoMargin = 20,
  } = voiceSettings || {};

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
  // Video top edge is at ~34.2% from top, bottom edge is at ~34.2% from bottom.
  const is916Letterbox = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const topOffset = is916Letterbox ? `calc(34.2% + ${margin}px)` : `${margin}px`;
  const bottomOffset = is916Letterbox ? `calc(34.2% + ${margin}px)` : `${margin}px`;

  // Determine positions to render
  const renderLeft = logoPosition === 'both' || logoPosition === 'top-left';
  const renderRight = logoPosition === 'both' || logoPosition === 'top-right';
  const renderBottomLeft = logoPosition === 'bottom-left';
  const renderBottomRight = logoPosition === 'bottom-right';

  return (
    <div className="logo-overlay-root">
      {/* 1. Top Left Logo */}
      {renderLeft && (
        <div
          className={`logo-overlay-item ${shapeClass}`}
          style={{
            top: topOffset,
            left: `${margin}px`,
            width: `${size}px`,
            height: `${size}px`,
            opacity,
          }}
        >
          <img src={logoImage} alt="Watermark Logo Left" />
        </div>
      )}

      {/* 2. Top Right Logo (សងខាង / Both Sides) */}
      {renderRight && (
        <div
          className={`logo-overlay-item ${shapeClass}`}
          style={{
            top: topOffset,
            right: `${margin}px`,
            width: `${size}px`,
            height: `${size}px`,
            opacity,
          }}
        >
          <img src={logoImage} alt="Watermark Logo Right" />
        </div>
      )}

      {/* 3. Bottom Left Logo */}
      {renderBottomLeft && (
        <div
          className={`logo-overlay-item ${shapeClass}`}
          style={{
            bottom: bottomOffset,
            left: `${margin}px`,
            width: `${size}px`,
            height: `${size}px`,
            opacity,
          }}
        >
          <img src={logoImage} alt="Watermark Logo Bottom Left" />
        </div>
      )}

      {/* 4. Bottom Right Logo */}
      {renderBottomRight && (
        <div
          className={`logo-overlay-item ${shapeClass}`}
          style={{
            bottom: bottomOffset,
            right: `${margin}px`,
            width: `${size}px`,
            height: `${size}px`,
            opacity,
          }}
        >
          <img src={logoImage} alt="Watermark Logo Bottom Right" />
        </div>
      )}
    </div>
  );
}
