import React from 'react';
import {
  Video, Maximize2, Minimize2, Clock, SkipBack, Play, Pause,
  SkipForward, VolumeX, Volume2
} from 'lucide-react';
import { formatTimecode } from '../../utils/formatTime';

export function PlayerTopBar() {
  return null;
}

export function PlayerBottomBar({
  currentTime,
  duration,
  onSeek,
  currentVideoSrc,
  isPlaying,
  onPlayPause,
  voiceSettings,
  toggleFullscreen = null,
  isFullscreen = false,
  renderedVideo = null,
  onResetToPreview = null,
}) {
  return (
    <div className="player-bottom-bar">
      {/* Timecode */}
      <div className="player-timecode">
        <Clock size={12} color="var(--text-dim)" />
        <span className="current">{formatTimecode(currentTime)}</span>
        <span className="divider">/</span>
        <span className="total">{formatTimecode(duration)}</span>
      </div>

      {/* Playback Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => onSeek(Math.max(0, currentTime - 1))}
          className="player-control-btn icon-only"
          title="Step Back 1s"
          disabled={!currentVideoSrc}
        >
          <SkipBack size={13} />
        </button>

        <button
          onClick={onPlayPause}
          className="player-play-btn"
          title={isPlaying ? "Pause" : "Play"}
          disabled={!currentVideoSrc}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
        </button>

        <button
          onClick={() => onSeek(Math.min(duration, currentTime + 1))}
          className="player-control-btn icon-only"
          title="Step Forward 1s"
          disabled={!currentVideoSrc}
        >
          <SkipForward size={13} />
        </button>
      </div>

      {/* Sound Status & Fullscreen Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {voiceSettings?.duckingVolume === 0 ? (
            <VolumeX size={13} color="var(--accent-rose)" />
          ) : (
            <Volume2 size={13} color="var(--accent-cyan)" />
          )}
          <span style={{ fontSize: '0.7rem', color: voiceSettings?.duckingVolume === 0 ? 'var(--color-error)' : 'var(--text-dim)', fontWeight: voiceSettings?.duckingVolume === 0 ? 700 : 400 }}>
            {voiceSettings?.duckingVolume === 0 ? 'Orig Muted (0%)' : `Orig Audio ${Math.round((voiceSettings?.duckingVolume !== undefined ? voiceSettings.duckingVolume : 0.15) * 100)}%`}
          </span>
        </div>

        {renderedVideo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => {
                if (onResetToPreview) onResetToPreview();
              }}
              style={{
                fontSize: '0.65rem',
                background: 'rgba(34, 197, 94, 0.2)',
                color: '#4ade80',
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 600,
                border: '1px solid rgba(74, 222, 128, 0.3)',
                cursor: 'pointer',
              }}
              title="វីដេអូ Rendered (1920×1080 Landscape 16:9)"
            >
              🎬 Rendered
            </button>
            <button
              onClick={() => {
                if (onResetToPreview) onResetToPreview();
              }}
              className="player-control-btn"
              style={{ color: '#38bdf8', padding: '2px 6px', fontSize: '0.68rem', fontWeight: 600 }}
              title="ត្រឡប់ទៅ Live Preview"
            >
              ↺ Edit
            </button>
          </div>
        )}

        {toggleFullscreen && (
          <button
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
