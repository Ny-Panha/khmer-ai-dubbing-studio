import React, { useRef, useEffect } from 'react';
import {
  Maximize2, Minimize2, Clock, SkipBack, Play, Pause,
  SkipForward, VolumeX, Volume2
} from 'lucide-react';
import { formatTimecode } from '../../utils/formatTime';

/**
 * Formats seconds into precision HH:MM:SS.ms timecode
 */
function formatPrecisionTimecode(seconds) {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 100);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  }
  return `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function PlayerTopBar() {
  return null;
}

export function PlayerBottomBar({
  currentTime,
  playheadTimeRef = null,
  subscribePlayhead = null,
  duration,
  onSeek,
  currentVideoSrc,
  isPlaying,
  onPlayPause,
  voiceSettings,
  onUpdateVoiceSettings = null,
  onAspectRatioChange = null,
  activeSegment = null,
  toggleFullscreen = null,
  isFullscreen = false,
  renderedVideo = null,
  onResetToPreview = null,
}) {
  const currentTimeSpanRef = useRef(null);

  useEffect(() => {
    if (typeof subscribePlayhead !== 'function') return undefined;
    return subscribePlayhead((liveTime) => {
      if (currentTimeSpanRef.current) {
        currentTimeSpanRef.current.textContent = formatPrecisionTimecode(liveTime);
      }
    });
  }, [subscribePlayhead]);

  const rawRatio = voiceSettings?.aspectRatio || null;
  const duckVol = voiceSettings?.duckingVolume !== undefined ? Number(voiceSettings.duckingVolume) : 0.15;
  const isDuckingActive = Boolean(isPlaying && activeSegment);
  const effectiveLinearGain = isDuckingActive ? duckVol : Math.min(1, duckVol + 0.35);
  const dbValue = duckVol <= 0.001
    ? '-∞ dB'
    : `${Math.max(-48, Math.round(20 * Math.log10(Math.max(0.01, duckVol)) * 10) / 10).toFixed(1)} dB`;
  const meterPercent = duckVol <= 0.001 ? 0 : Math.min(100, Math.max(8, Math.round(effectiveLinearGain * 100)));

  const handleSelectRatio = (ratioVal) => {
    if (ratioVal === 'fit') {
      if (onUpdateVoiceSettings) {
        onUpdateVoiceSettings({ ...(voiceSettings || {}), aspectRatio: null });
      }
      return;
    }
    if (onAspectRatioChange) {
      onAspectRatioChange(ratioVal);
    } else if (onUpdateVoiceSettings) {
      onUpdateVoiceSettings({ ...(voiceSettings || {}), aspectRatio: ratioVal });
    }
  };

  return (
    <div className="player-bottom-bar">
      {/* Precision Timecode HH:MM:SS.ms */}
      <div className="player-timecode" title="Precision Timecode (HH:MM:SS.ms)">
        <Clock size={12} color="var(--text-dim)" />
        <span ref={currentTimeSpanRef} className="current" data-testid="player-precision-timecode">
          {formatPrecisionTimecode(currentTime)}
        </span>
        <span className="divider">/</span>
        <span className="total">{formatTimecode(duration)}</span>
      </div>

      {/* Transport Playback Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => onSeek(Math.max(0, (playheadTimeRef?.current ?? currentTime) - 1))}
          className="player-control-btn icon-only"
          title="Step Back 1s"
          disabled={!currentVideoSrc}
        >
          <SkipBack size={13} />
        </button>

        <button
          type="button"
          onClick={onPlayPause}
          className="player-play-btn"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          disabled={!currentVideoSrc}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
        </button>

        <button
          type="button"
          onClick={() => onSeek(Math.min(duration, (playheadTimeRef?.current ?? currentTime) + 1))}
          className="player-control-btn icon-only"
          title="Step Forward 1s"
          disabled={!currentVideoSrc}
        >
          <SkipForward size={13} />
        </button>
      </div>

      {/* Aspect Ratio Selector (16:9 | 9:16 | 1:1 | Fit) + Live Audio Ducking dB Meter + Fullscreen */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
        {/* Aspect Ratio Selector Pill */}
        <div
          className="player-ratio-selector-group"
          role="group"
          aria-label="Viewport Aspect Ratio"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            background: 'rgba(9, 10, 15, 0.72)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: 2,
          }}
        >
          {[
            { id: '16:9', label: '16:9' },
            { id: '9:16', label: '9:16' },
          ].map((opt) => {
            const isActive = rawRatio === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`player-ratio-${opt.id}`}
                onClick={() => handleSelectRatio(opt.id)}
                style={{
                  background: isActive ? 'rgba(0, 229, 255, 0.16)' : 'transparent',
                  color: isActive ? 'var(--primary-accent)' : 'var(--text-secondary)',
                  border: isActive ? '1px solid rgba(0, 229, 255, 0.4)' : '1px solid transparent',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: '0.72rem',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  lineHeight: 1.3,
                }}
                title={`Aspect Ratio: ${opt.label}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Live Audio Ducking dB Meter */}
        <div
          className="player-ducking-db-meter"
          data-testid="player-ducking-db-meter"
          title={`Live Audio Ducking: ${dbValue} (${Math.round(duckVol * 100)}% BGM)`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            borderRadius: 6,
            background: 'rgba(9, 10, 15, 0.72)',
            border: '1px solid var(--line)',
          }}
        >
          {duckVol === 0 ? (
            <VolumeX size={13} color="var(--color-error)" />
          ) : (
            <Volume2 size={13} color="var(--accent-cyan)" />
          )}
          <div
            style={{
              width: 34,
              height: 5,
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.1)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${meterPercent}%`,
                height: '100%',
                borderRadius: 999,
                background: isDuckingActive
                  ? 'linear-gradient(90deg, #10B981, #00E5FF)'
                  : 'linear-gradient(90deg, #10B981, #F59E0B)',
                transition: 'width 0.15s ease',
              }}
            />
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: duckVol === 0 ? 'var(--color-error)' : 'var(--text-secondary)',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {dbValue}
          </span>
        </div>

        {renderedVideo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              onClick={() => {
                if (onResetToPreview) onResetToPreview();
              }}
              style={{
                fontSize: '0.72rem',
                background: 'rgba(34, 197, 94, 0.2)',
                color: '#4ade80',
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 600,
                border: '1px solid rgba(74, 222, 128, 0.3)',
                cursor: 'pointer',
              }}
              title="វីដេអូ Rendered — ចុចដើម្បីត្រឡប់ Edit"
            >
              🎬 Rendered
            </button>
            <button
              type="button"
              onClick={() => {
                if (onResetToPreview) onResetToPreview();
              }}
              className="player-control-btn"
              style={{ color: '#38bdf8', padding: '2px 6px', fontSize: '0.72rem', fontWeight: 600 }}
              title="ត្រឡប់ទៅ Live Preview"
            >
              ↺ Edit
            </button>
          </div>
        )}

        {toggleFullscreen && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`player-control-btn icon-only ${isFullscreen ? 'active-full' : ''}`}
            title={isFullscreen ? 'ចាកចេញពី Fullscreen (Exit Fullscreen / Esc)' : 'ពង្រីកពេញអេក្រង់ (Toggle Fullscreen ⛶)'}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}
