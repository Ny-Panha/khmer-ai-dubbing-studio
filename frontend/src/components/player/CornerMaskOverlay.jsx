import React from 'react';
import './CornerMaskOverlay.css';

/**
 * Corner Mask / Disclaimer Blocker Overlay
 * Cleanly blocks Chinese disclaimers, watermarks, or logos in video corners
 * with a customizable Khmer disclaimer badge, frosted blur box, or solid patch.
 */
export default function CornerMaskOverlay({
  voiceSettings = {},
  renderedVideo = null,
  aspectRatio = '16:9',
  verticalStyle = 'pad',
  videoMeta = null,
}) {
  const {
    enableCornerMask = false,
    cornerMaskText = '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»',
    cornerMaskStyle = 'badge', // 'badge' | 'blur' | 'solid'
    cornerMaskPosition = 'top-right', // 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
    cornerMaskWidth = 220,
    cornerMaskHeight = 54,
    cornerMaskOpacity = 0.95,
  } = voiceSettings || {};

  if (!enableCornerMask || renderedVideo) {
    return null;
  }

  // Scale dimensions proportionally for 9:16 vertical player container
  const scale = aspectRatio === '9:16' ? 0.65 : 1.0;
  const width = Math.round((Number(cornerMaskWidth) || 220) * scale);
  const height = Math.round((Number(cornerMaskHeight) || 54) * scale);
  const opacity = Math.max(0.1, Math.min(1.0, Number(cornerMaskOpacity) || 0.95));

  const is916Letterbox = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const aspectClass = is916Letterbox ? 'aspect-9-16-letterbox' : '';
  const posClass = `pos-${cornerMaskPosition}`;
  const styleClass = `style-${cornerMaskStyle}`;

  // Font size scales with height
  const fontSize = Math.max(9, Math.min(18, Math.round(height * 0.28)));

  return (
    <div
      className={`corner-mask-root ${posClass} ${aspectClass}`}
      data-testid="corner-mask-root"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        opacity,
      }}
    >
      <div className={`corner-mask-inner ${styleClass}`}>
        {cornerMaskStyle !== 'blur' && cornerMaskText && (
          <span
            className="corner-mask-text"
            style={{ fontSize: `${fontSize}px` }}
          >
            {cornerMaskText}
          </span>
        )}
      </div>
    </div>
  );
}
