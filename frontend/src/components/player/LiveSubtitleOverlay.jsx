import React from 'react';
import { getLivePagedSubtitle } from '../../utils/khmerTextSplitter';
import { parseTimeToSeconds } from '../../utils/timestampUtils';

export default function LiveSubtitleOverlay({
  activeSegment,
  voiceSettings = {},
  renderedVideo = null,
  isAdActive = false,
  currentTime = 0,
  aspectRatio = 'auto',
  verticalStyle = 'pad',
  videoMeta = null,
}) {
  if (!activeSegment || voiceSettings.burnSubtitles === false || renderedVideo || isAdActive) {
    return null;
  }

  const color = voiceSettings.subtitleColor === 'white' ? '#ffffff' : '#ffe600';
  const sizeClass = voiceSettings.subtitleSize === 'large'
    ? 'size-large'
    : voiceSettings.subtitleSize === 'small'
      ? 'size-small'
      : 'size-medium';

  // Default to 'banner' (clean background title card requested by Nha)
  const effectiveStyle = voiceSettings.subtitleStyle === 'pill'
    ? 'pill'
    : (voiceSettings.subtitleStyle === 'cinema' ? 'cinema' : 'banner');
  const styleClass = `style-${effectiveStyle}`;

  const isLandscapeInVertical = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const aspectClass = isLandscapeInVertical
    ? 'aspect-9-16-letterbox'
    : (aspectRatio === '9:16'
      ? 'aspect-9-16-vertical'
      : (aspectRatio === '1:1' ? 'aspect-1-1' : 'aspect-16-9'));

  const text = getLivePagedSubtitle(activeSegment, currentTime, parseTimeToSeconds);
  if (!text) return null;

  return (
    <div
      className={`live-subtitle-overlay ${styleClass} ${sizeClass} ${aspectClass}`}
      data-testid="live-subtitle-overlay"
      data-subtitle-style={effectiveStyle}
      data-subtitle-color={voiceSettings.subtitleColor === 'white' ? 'white' : 'yellow'}
      data-subtitle-size={voiceSettings.subtitleSize === 'large' ? 'large' : (voiceSettings.subtitleSize === 'small' ? 'small' : 'medium')}
      style={{
        color,
      }}
    >
      <span>{text}</span>
    </div>
  );
}
