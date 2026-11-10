import React from 'react';
import { getLivePagedSubtitle } from '../../utils/khmerTextSplitter';
import { parseTimeToSeconds } from '../../utils/formatTime';

export default function LiveSubtitleOverlay({
  activeSegment,
  voiceSettings = {},
  renderedVideo = null,
  currentTime = 0,
  aspectRatio = 'auto',
  verticalStyle = 'pad',
  videoMeta = null,
}) {
  if (!activeSegment || !voiceSettings.burnSubtitles || renderedVideo) {
    return null;
  }

  const color = voiceSettings.subtitleColor === 'white' ? '#ffffff' : '#facc15';
  const sizeClass = voiceSettings.subtitleSize === 'large' 
    ? 'size-large' 
    : voiceSettings.subtitleSize === 'small' 
      ? 'size-small' 
      : 'size-medium';

  // Default to 'banner' (clean background title card requested by Nha)
  const styleClass = voiceSettings.subtitleStyle === 'pill'
    ? 'style-pill'
    : (voiceSettings.subtitleStyle === 'cinema' ? 'style-cinema' : 'style-banner');

  const isLandscapeInVertical = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const aspectClass = isLandscapeInVertical
    ? 'aspect-9-16-letterbox'
    : (aspectRatio === '9:16' ? 'aspect-9-16-vertical' : 'aspect-16-9');

  const text = getLivePagedSubtitle(activeSegment, currentTime, parseTimeToSeconds);
  if (!text) return null;

  return (
    <div 
      className={`live-subtitle-overlay ${styleClass} ${sizeClass} ${aspectClass}`}
      style={{
        color,
      }}
    >
      <span>{text}</span>
    </div>
  );
}
