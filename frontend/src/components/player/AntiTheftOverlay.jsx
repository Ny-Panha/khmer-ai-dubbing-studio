import React from 'react';
import './AntiTheftOverlay.css';

export default function AntiTheftOverlay({
  voiceSettings = {},
  renderedVideo = null,
  aspectRatio = '16:9',
  videoMeta = null,
}) {
  if (!voiceSettings?.enableAntiTheft || renderedVideo) {
    return null;
  }

  const {
    marqueeText = '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»',
    marqueeSpeed = 'normal',
    marqueePosition = 'bottom',
    marqueeTextColor = '#FFE600',
    enableWatermark = true,
    watermarkText = 'រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama',
    watermarkPosition = 'above-ticker',
    watermarkColor = '#38BDF8',
    antiTheftSize = 'small',
  } = voiceSettings;

  const parsedSpeed = parseFloat(marqueeSpeed);
  const durationSec = (!isNaN(parsedSpeed) && parsedSpeed > 0)
    ? parsedSpeed
    : (marqueeSpeed === 'fast' ? 9 : (marqueeSpeed === 'slow' ? 20 : 13));
  const repeatedText = `${marqueeText}       ❖       ${marqueeText}       ❖       ${marqueeText}`;

  const isLandscapeInVertical = aspectRatio === '9:16' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const aspectClass = isLandscapeInVertical
    ? 'aspect-9-16-letterbox'
    : (aspectRatio === '9:16' ? 'aspect-9-16-vertical' : 'aspect-16-9');

  const posClass = marqueePosition === 'top' ? 'pos-top' : 'pos-bottom';
  const sizeClass = antiTheftSize === 'large'
    ? 'size-large'
    : (antiTheftSize === 'medium' ? 'size-medium' : 'size-small');

  return (
    <div className={`anti-theft-overlay-root ${posClass} ${aspectClass} ${sizeClass}`}>
      {/* 1. Static Copyright Watermark Badge */}
      {enableWatermark && watermarkText && (
        <div
          className={`anti-theft-watermark-badge wm-${watermarkPosition}`}
          style={{ color: watermarkColor }}
        >
          {watermarkText}
        </div>
      )}

      {/* 2. Semi-transparent Running Marquee Ribbon */}
      <div className="anti-theft-marquee-ribbon">
        <div
          className="anti-theft-marquee-track"
          style={{
            animationDuration: `${durationSec}s`,
            color: marqueeTextColor,
          }}
        >
          <span>{repeatedText}</span>
        </div>
      </div>
    </div>
  );
}
