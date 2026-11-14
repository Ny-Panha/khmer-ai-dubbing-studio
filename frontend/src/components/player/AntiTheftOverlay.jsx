import React, { useState, useRef } from 'react';
import { ChevronUp, ChevronDown, RotateCcw, X, MoveVertical } from 'lucide-react';
import './AntiTheftOverlay.css';

export default function AntiTheftOverlay({
  voiceSettings = {},
  renderedVideo = null,
  aspectRatio = '16:9',
  verticalStyle = 'pad',
  videoMeta = null,
  onUpdateVoiceSettings = null,
}) {
  const rootRef = useRef(null);
  const dragStartYRef = useRef(0);
  const initialOffsetRef = useRef(0);

  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDeltaY, setDragDeltaY] = useState(0);

  if (!voiceSettings?.enableAntiTheft || renderedVideo) {
    return null;
  }

  const {
    marqueeText = '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»',
    marqueeSpeed = 'normal',
    marqueePosition = 'bottom',
    marqueeTextColor = '#FFE600',
    enableWatermark = true,
    watermarkText = 'រក្សាសិទ្ធិដោយ ៖ DragonDub AI',
    watermarkPosition = 'above-ticker',
    watermarkColor = '#38BDF8',
    antiTheftSize = 'small',
    antiTheftBottomPercent = 2, // Default 2% from bottom
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

  // Compute effective bottom percent
  const defaultBottom = isLandscapeInVertical ? 34.2 : (aspectRatio === '9:16' ? 16.5 : 2);
  const effectiveBottom = typeof voiceSettings?.antiTheftBottomPercent === 'number'
    ? voiceSettings.antiTheftBottomPercent
    : defaultBottom;

  // Mouse drag handler to freely move the bottom banner up/down
  const handleRibbonMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    setIsDragging(true);
    setDragDeltaY(0);
    dragStartYRef.current = e.clientY;
    initialOffsetRef.current = effectiveBottom;

    const onMouseMove = (moveEvt) => {
      const deltaY = moveEvt.clientY - dragStartYRef.current;
      setDragDeltaY(deltaY);
    };

    const onMouseUp = (upEvt) => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      const totalDeltaY = upEvt.clientY - dragStartYRef.current;
      setDragDeltaY(0);

      // If user moved more than 3px, compute new bottom percent
      if (Math.abs(totalDeltaY) >= 3 && onUpdateVoiceSettings && rootRef.current) {
        const container = rootRef.current.parentElement || rootRef.current;
        const containerH = container.getBoundingClientRect()?.height || 500;
        // Moving mouse UP (-deltaY) increases bottom percentage
        const percentChange = -(totalDeltaY / containerH) * 100;
        const newBottom = Math.max(1, Math.min(80, Math.round((initialOffsetRef.current + percentChange) * 10) / 10));

        onUpdateVoiceSettings({
          ...voiceSettings,
          antiTheftBottomPercent: newBottom,
          marqueePosition: 'bottom',
        });
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleNudgeOffset = (deltaPercent) => {
    if (onUpdateVoiceSettings) {
      const nextBottom = Math.max(1, Math.min(80, Math.round((effectiveBottom + deltaPercent) * 10) / 10));
      onUpdateVoiceSettings({
        ...voiceSettings,
        antiTheftBottomPercent: nextBottom,
        marqueePosition: 'bottom',
      });
    }
  };

  const handleResetOffset = () => {
    if (onUpdateVoiceSettings) {
      onUpdateVoiceSettings({
        ...voiceSettings,
        antiTheftBottomPercent: defaultBottom,
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

  const inlineBottomStyle = marqueePosition === 'bottom'
    ? {
        bottom: `${effectiveBottom}%`,
        transform: dragDeltaY !== 0 ? `translateY(${dragDeltaY}px)` : 'none',
        transition: isDragging ? 'none' : 'bottom 0.15s ease',
      }
    : {
        transform: dragDeltaY !== 0 ? `translateY(${dragDeltaY}px)` : 'none',
        transition: isDragging ? 'none' : 'transform 0.15s ease',
      };

  return (
    <div
      ref={rootRef}
      className={`anti-theft-overlay-root ${posClass} ${aspectClass} ${sizeClass} ${isHovered ? 'hovered' : ''} ${isDragging ? 'dragging' : ''}`}
      style={inlineBottomStyle}
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
      <div
        className={`anti-theft-marquee-ribbon ${isDragging ? 'is-dragging-ribbon' : ''}`}
        onMouseDown={handleRibbonMouseDown}
        title="ចុចសង្កត់ Mouse អូសឡើងលើ ឬចុះក្រោមដើម្បីផ្លាស់ប្តូរទីតាំងរបារនេះ (Drag Up/Down to Move)"
      >
        <div
          className="anti-theft-marquee-track"
          style={{
            animationDuration: `${durationSec}s`,
            color: marqueeTextColor,
          }}
        >
          <span>{repeatedText}</span>
        </div>

        {/* Center Drag Indicator on Hover */}
        {(isHovered || isDragging) && (
          <div className="ribbon-drag-indicator">
            <MoveVertical size={12} color="#38bdf8" />
            <span>{isDragging ? `កំពុង Move: ${Math.round(effectiveBottom)}%` : 'ចុចអូសឡើងលើ/ចុះក្រោម (Drag to Move)'}</span>
          </div>
        )}

        {/* Quick step controls on hover */}
        {isHovered && !isDragging && onUpdateVoiceSettings && (
          <div className="anti-theft-quick-bar" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="anti-theft-btn"
              onClick={() => handleNudgeOffset(5)}
              title="រំកិលឡើងលើ 5% (Nudge Up)"
            >
              <ChevronUp size={12} />
              <span>ឡើង</span>
            </button>
            <button
              type="button"
              className="anti-theft-btn"
              onClick={() => handleNudgeOffset(-5)}
              title="រំកិលចុះក្រោម 5% (Nudge Down)"
            >
              <ChevronDown size={12} />
              <span>ចុះ</span>
            </button>
            {Math.abs(effectiveBottom - defaultBottom) > 1 && (
              <button
                type="button"
                className="anti-theft-btn"
                onClick={handleResetOffset}
                title="Reset ទៅទីតាំងដើមវិញ (Reset to Default)"
              >
                <RotateCcw size={11} />
              </button>
            )}
            <button
              type="button"
              className="anti-theft-btn danger"
              onClick={handleHideRibbon}
              title="លាក់របាររក្សាសិទ្ធិ (Hide Banner)"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
