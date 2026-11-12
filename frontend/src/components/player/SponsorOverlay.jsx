import React, { useRef, useEffect, useState } from 'react';
import './SponsorOverlay.css';

export default function SponsorOverlay({
  voiceSettings = {},
  renderedVideo = null,
  aspectRatio = '16:9',
  verticalStyle = 'pad',
  videoMeta = null,
  currentTime = 0,
  isPlaying = false,
}) {
  const {
    enableSponsor = false,
    sponsorVideoUrl = null,
    sponsorPosition = 'bottom-left',
    sponsorScale = 25,
    sponsorOpacity = 1.0,
    sponsorMargin = 16,
    sponsorChromaKey = true,
    sponsorChromaSimilarity = 0.28,
    sponsorTimingMode = 'loop', // 'loop' | 'interval' | 'custom'
    sponsorIntervalSec = 60,
    sponsorDurationSec = 10,
    sponsorStartSec = 0,
    sponsorEndSec = 15,
    sponsorMuteAudio = true,
    sponsorVolume = 0.5,
  } = voiceSettings || {};

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const [videoLoaded, setVideoLoaded] = useState(false);

  // If sponsor ads not enabled, no video URL, or viewing already-rendered video, skip overlay
  if (!enableSponsor || !sponsorVideoUrl || renderedVideo) {
    return null;
  }

  // Check timing visibility
  let isTimeVisible = true;
  if (sponsorTimingMode === 'interval') {
    const cycle = Math.max(5, Number(sponsorIntervalSec) || 60);
    const dur = Math.max(1, Number(sponsorDurationSec) || 10);
    const tMod = (Number(currentTime) || 0) % cycle;
    isTimeVisible = tMod < dur;
  } else if (sponsorTimingMode === 'custom') {
    const s = Number(sponsorStartSec) || 0;
    const e = Number(sponsorEndSec) || 15;
    const t = Number(currentTime) || 0;
    isTimeVisible = t >= s && t <= e;
  }

  // Video playback sync with player
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    vid.muted = Boolean(sponsorMuteAudio);
    vid.volume = Math.max(0, Math.min(1, Number(sponsorVolume) || 0.5));

    if (isPlaying && isTimeVisible) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [isPlaying, isTimeVisible, sponsorMuteAudio, sponsorVolume]);

  // Real-time canvas chroma key green-screen processing
  useEffect(() => {
    const vid = videoRef.current;
    const canvas = canvasRef.current;
    if (!vid || !canvas || !videoLoaded) return;

    let active = true;

    const renderFrame = () => {
      if (!active) return;

      if (vid.readyState >= 2 && !vid.paused && !vid.ended) {
        const w = vid.videoWidth || 320;
        const h = vid.videoHeight || 180;

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(vid, 0, 0, w, h);

          if (sponsorChromaKey) {
            const frame = ctx.getImageData(0, 0, w, h);
            const data = frame.data;
            const len = data.length;
            const sim = Math.max(0.1, Math.min(0.5, Number(sponsorChromaSimilarity) || 0.28));
            const greenThreshold = 70 + (sim * 100);

            for (let i = 0; i < len; i += 4) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];

              // Fast Chroma Key green detection
              if (g > greenThreshold && g > r * 1.3 && g > b * 1.3) {
                // Soft edge alpha
                const edgeDiff = g - Math.max(r, b) * 1.3;
                if (edgeDiff > 25) {
                  data[i + 3] = 0; // Fully transparent
                } else {
                  data[i + 3] = Math.round(data[i + 3] * (1 - (edgeDiff / 25)));
                }
              }
            }

            ctx.putImageData(frame, 0, 0);
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(renderFrame);
    };

    animFrameRef.current = requestAnimationFrame(renderFrame);

    return () => {
      active = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [videoLoaded, sponsorChromaKey, sponsorChromaSimilarity]);

  // Layout & positioning geometry
  const scaleFactor = aspectRatio === '9:16' ? 0.75 : 1.0;
  const widthPercent = Math.max(12, Math.min(60, Number(sponsorScale) || 25));
  const marginPx = Math.round(Math.max(4, Math.min(60, Number(sponsorMargin) || 16)) * scaleFactor);
  const opacity = Math.max(0.1, Math.min(1.0, Number(sponsorOpacity) || 1.0));

  // In 9:16 letterbox pad mode
  const is916Letterbox = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const topOffset = is916Letterbox ? `calc(34.2% + ${marginPx}px)` : `${marginPx}px`;
  const bottomOffset = is916Letterbox ? `calc(34.2% + ${marginPx}px)` : `${marginPx}px`;

  const getPositionStyles = () => {
    switch (sponsorPosition) {
      case 'bottom-right':
        return { bottom: bottomOffset, right: `${marginPx}px` };
      case 'top-left':
        return { top: topOffset, left: `${marginPx}px` };
      case 'top-right':
        return { top: topOffset, right: `${marginPx}px` };
      case 'bottom-center':
        return { bottom: bottomOffset, left: '50%', transform: 'translateX(-50%)' };
      case 'bottom-left':
      default:
        return { bottom: bottomOffset, left: `${marginPx}px` };
    }
  };

  return (
    <div
      className="sponsor-overlay-container"
      style={{
        ...getPositionStyles(),
        width: `${widthPercent}%`,
        opacity: isTimeVisible ? opacity : 0,
        pointerEvents: 'none',
        transition: 'opacity 0.25s ease',
      }}
    >
      {/* Hidden source video element providing playback & frames */}
      <video
        ref={videoRef}
        src={sponsorVideoUrl}
        loop
        playsInline
        muted={Boolean(sponsorMuteAudio)}
        onLoadedData={() => setVideoLoaded(true)}
        style={{ display: 'none' }}
      />

      {/* Rendered Canvas with Real-time Chroma Key */}
      {sponsorChromaKey ? (
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
          }}
        />
      ) : (
        <video
          src={sponsorVideoUrl}
          autoPlay
          loop
          playsInline
          muted={Boolean(sponsorMuteAudio)}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            borderRadius: 6,
            filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
          }}
        />
      )}
    </div>
  );
}

