import React, { useState } from 'react';
import { ArrowUpDown, X } from 'lucide-react';
import './AntiTheftOverlay.css';

export default function AntiTheftOverlay({
  voiceSettings = {},
  renderedVideo = null,
  aspectRatio = '16:9',
  verticalStyle = 'pad',
  videoMeta = null,
  onUpdateVoiceSettings = null,
}) {
  const [isHovered, setIsHovered] = useState(false);

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

  const isLandscapeInVertical = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const aspectClass = isLandscapeInVertical
    ? 'aspect-9-16-letterbox'
    : (aspectRatio === '9:16' ? 'aspect-9-16-vertical' : 'aspect-16-9');

  const posClass = marqueePosition === 'top' ? 'pos-top' : 'pos-bottom';
  const sizeClass = antiTheftSize === 'large'
    ? 'size-large'
    : (antiTheftSize === 'medium' ? 'size-medium' : 'size-small');

  const handleTogglePosition = (e) => {
    e.stopPropagation();
    if (onUpdateVoiceSettings) {
      onUpdateVoiceSettings({
        ...voiceSettings,
        marqueePosition: marqueePosition === 'bottom' ? 'top' : 'bottom',
      });
    }
  };

  const handleHideRibbon = (e) => {
    e.stopPropagation();
    if (onUpdateVoiceSettings) {
      onUpdateVoiceSettings({
        ...voiceSettings,
        enableAntiTheft: false,
      });
    }
  };

  return (
    <div
      className={`anti-theft-overlay-root ${posClass} ${aspectClass} ${sizeClass}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
      <div className="anti-theft-marquee-ribbon" style={{ pointerEvents: 'auto' }}>
        <div
          className="anti-theft-marquee-track"
          style={{
            animationDuration: `${durationSec}s`,
            color: marqueeTextColor,
          }}
        >
          <span>{repeatedText}</span>
        </div>

        {/* Quick controls on hover */}
        {isHovered && onUpdateVoiceSettings && (
          <div className="anti-theft-quick-bar" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="anti-theft-btn"
              onClick={handleTogglePosition}
              title={marqueePosition === 'bottom' ? "រំកិលទៅខាងលើ (Move to Top)" : "រំកិលទៅខាងក្រោម (Move to Bottom)"}
            >
              <ArrowUpDown size={11} />
              <span>{marqueePosition === 'bottom' ? 'ដាក់លើ' : 'ដាក់ក្រោម'}</span>
            </button>
            <button
              type="button"
              className="anti-theft-btn danger"
              onClick={handleHideRibbon}
              title="លាក់របាររក្សាសិទ្ធិ (Hide Banner)"
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
