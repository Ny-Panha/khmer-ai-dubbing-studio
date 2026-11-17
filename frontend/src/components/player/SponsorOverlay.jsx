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
  onUpdateVoiceSettings = null,
}) {
  const {
    enableSponsor = false,
    sponsorVideoUrl = null,
    sponsorPosition = 'bottom-left',
    sponsorXPercent = null,
    sponsorYPercent = null,
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

  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const latestVoiceSettingsRef = useRef(voiceSettings);
  const dragCleanupRef = useRef(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [livePos, setLivePos] = useState(null);

  useEffect(() => {
    latestVoiceSettingsRef.current = voiceSettings;
  }, [voiceSettings]);

  useEffect(() => {
    setVideoLoaded(false);
  }, [sponsorVideoUrl]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const shouldRender = Boolean(enableSponsor && sponsorVideoUrl && !renderedVideo);

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
    if (!shouldRender) return;
    const vid = videoRef.current;
    if (!vid) return;

    vid.muted = Boolean(sponsorMuteAudio);
    vid.volume = Math.max(0, Math.min(1, Number(sponsorVolume) || 0.5));

    if (isPlaying && isTimeVisible) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [shouldRender, isPlaying, isTimeVisible, sponsorMuteAudio, sponsorVolume]);

  // Real-time canvas chroma key green-screen processing (also draws a static frame when paused)
  useEffect(() => {
    if (!shouldRender) return;
    const vid = videoRef.current;
    const canvas = canvasRef.current;
    if (!vid || !canvas || !videoLoaded) return;

    let active = true;

    const drawCurrentFrame = () => {
      if (vid.readyState < 2) return;
      const w = vid.videoWidth || 320;
      const h = vid.videoHeight || 180;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
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
    };

    // Paint initial frame immediately so preview is visible even while paused
    let drewPausedFrame = false;
    if (vid.readyState >= 2) {
      drawCurrentFrame();
      drewPausedFrame = true;
    }

    const renderFrame = () => {
      if (!active) return;

      if (vid.readyState >= 2) {
        if (!vid.paused && !vid.ended) {
          drawCurrentFrame();
          drewPausedFrame = true;
        } else if (!drewPausedFrame) {
          drawCurrentFrame();
          drewPausedFrame = true;
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
  }, [shouldRender, videoLoaded, sponsorVideoUrl, sponsorChromaKey, sponsorChromaSimilarity]);

  // Layout & positioning geometry
  const scaleFactor = aspectRatio === '9:16' ? 0.75 : 1.0;
  const widthPercent = Math.max(12, Math.min(60, Number(sponsorScale) || 25));
  const marginPx = Math.round(Math.max(4, Math.min(60, Number(sponsorMargin) || 16)) * scaleFactor);
  const opacity = Math.max(0.1, Math.min(1.0, Number(sponsorOpacity) || 1.0));

  // In 9:16 letterbox pad mode
  const is916Letterbox = aspectRatio === '9:16' && verticalStyle !== 'crop' && (!videoMeta?.ratio || videoMeta.ratio > 1.2);
  const topOffset = is916Letterbox ? `calc(34.2% + ${marginPx}px)` : `${marginPx}px`;
  const bottomOffset = is916Letterbox ? `calc(34.2% + ${marginPx}px)` : `${marginPx}px`;

  const parsedX = sponsorXPercent === null || sponsorXPercent === undefined || sponsorXPercent === '' ? NaN : Number(sponsorXPercent);
  const parsedY = sponsorYPercent === null || sponsorYPercent === undefined || sponsorYPercent === '' ? NaN : Number(sponsorYPercent);
  const hasCustomCoords = Number.isFinite(parsedX) && Number.isFinite(parsedY);
  const isCustom = sponsorPosition === 'custom' || hasCustomCoords;
  const effectiveX = Number.isFinite(parsedX) ? Math.max(0, Math.min(100, parsedX)) : 50;
  const effectiveY = Number.isFinite(parsedY) ? Math.max(0, Math.min(100, parsedY)) : 50;

  const handlePointerDown = (e) => {
    if (e.button !== 0 || !isTimeVisible || !onUpdateVoiceSettings) return;
    e.stopPropagation();
    e.preventDefault();

    const itemEl = e.currentTarget;
    const rootEl = rootRef.current || itemEl.parentElement;
    if (!rootEl) return;

    const itemRect = itemEl.getBoundingClientRect();
    const rootRect = rootEl.getBoundingClientRect();
    const initialLeft = itemRect.left - rootRect.left;
    const initialTop = itemRect.top - rootRect.top;
    const itemW = itemRect.width;
    const itemH = itemRect.height;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let moved = false;
    let latestCoords = null;

    const computeClampedPercent = (clientX, clientY) => {
      const curRoot = rootRef.current ? rootRef.current.getBoundingClientRect() : rootRect;
      const availW = Math.max(1, curRoot.width - itemW);
      const availH = Math.max(1, curRoot.height - itemH);
      const nextLeft = Math.max(0, Math.min(availW, initialLeft + (clientX - startClientX)));
      const nextTop = Math.max(0, Math.min(availH, initialTop + (clientY - startClientY)));
      return {
        xPct: Math.round((nextLeft / availW) * 1000) / 10,
        yPct: Math.round((nextTop / availH) * 1000) / 10,
      };
    };

    dragCleanupRef.current?.();
    setIsDragging(true);

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      dragCleanupRef.current = null;
    };

    const onPointerMove = (moveEvt) => {
      const dx = moveEvt.clientX - startClientX;
      const dy = moveEvt.clientY - startClientY;
      if (!moved && Math.hypot(dx, dy) >= 2) {
        moved = true;
      }
      if (!moved) return;
      const coords = computeClampedPercent(moveEvt.clientX, moveEvt.clientY);
      latestCoords = coords;
      setLivePos(coords);
    };

    const onPointerUp = (upEvt) => {
      cleanup();
      setIsDragging(false);
      setLivePos(null);

      const dx = upEvt.clientX - startClientX;
      const dy = upEvt.clientY - startClientY;
      if (moved || Math.hypot(dx, dy) >= 2) {
        const finalCoords = latestCoords || computeClampedPercent(upEvt.clientX, upEvt.clientY);
        onUpdateVoiceSettings({
          ...(latestVoiceSettingsRef.current || {}),
          sponsorPosition: 'custom',
          sponsorXPercent: finalCoords.xPct,
          sponsorYPercent: finalCoords.yPct,
        });
      }
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const getPositionStyles = () => {
    if (livePos) {
      return {
        left: `${livePos.xPct}%`,
        top: `${livePos.yPct}%`,
        transform: `translate(-${livePos.xPct}%, -${livePos.yPct}%)`,
      };
    }
    if (isCustom) {
      return {
        left: `${effectiveX}%`,
        top: `${effectiveY}%`,
        transform: `translate(-${effectiveX}%, -${effectiveY}%)`,
      };
    }
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

  if (!shouldRender) return null;

  return (
    <div className="sponsor-overlay-root" ref={rootRef}>
      <div
        className={`sponsor-overlay-container ${isDragging ? 'dragging' : ''}`}
        data-testid="sponsor-overlay-draggable"
        style={{
          ...getPositionStyles(),
          width: `${widthPercent}%`,
          opacity: isTimeVisible ? opacity : 0,
          pointerEvents: isTimeVisible && onUpdateVoiceSettings ? 'auto' : 'none',
          cursor: onUpdateVoiceSettings ? (isDragging ? 'grabbing' : 'grab') : 'default',
          transition: isDragging ? 'none' : 'opacity 0.25s ease',
        }}
        onPointerDown={handlePointerDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        title="អូស (Drag) ដើម្បីផ្លាស់ទី Sponsor Banner"
      >
        {/* Hidden source video element providing playback & frames (offscreen opacity:0 so Chromium decodes frames while paused) */}
        <video
          ref={videoRef}
          src={sponsorVideoUrl}
          preload="auto"
          loop
          playsInline
          muted={Boolean(sponsorMuteAudio)}
          onLoadedData={() => setVideoLoaded(true)}
          onCanPlay={() => setVideoLoaded(true)}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />

        {/* Rendered Canvas with Real-time Chroma Key */}
        {sponsorChromaKey ? (
          <canvas
            ref={canvasRef}
            draggable={false}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              pointerEvents: 'none',
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
            draggable={false}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: 6,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
            }}
          />
        )}

        {isDragging && livePos && (
          <div className="sponsor-drag-coords-badge">
            <span>X: {livePos.xPct}% | Y: {livePos.yPct}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

