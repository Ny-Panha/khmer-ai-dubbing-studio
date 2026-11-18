import React, { useRef, useEffect } from 'react';
import {
  Maximize2, Minimize2, Clock, SkipBack, Play, Pause,
  SkipForward, VolumeX, Volume2, Diamond, ChevronLeft, ChevronRight,
  Sparkles, Loader2
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

/**
 * Direct Editable Number Input for Framing Percentage (5% - 95%)
 */
function FramingCropNumberInput({ value, onChange }) {
  const [localVal, setLocalVal] = React.useState(String(Math.round(value)));
  const isFocusedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalVal(String(Math.round(value)));
    }
  }, [value]);

  const commitValue = (valStr) => {
    const num = parseInt(valStr, 10);
    if (!isNaN(num)) {
      const clamped = Math.max(5, Math.min(95, num));
      setLocalVal(String(clamped));
      onChange?.(clamped);
    } else {
      setLocalVal(String(Math.round(value)));
    }
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        borderRadius: 4,
        padding: '0 3px',
        height: 20,
      }}
    >
      <input
        type="number"
        min="5"
        max="95"
        step="1"
        value={localVal}
        onFocus={(e) => {
          isFocusedRef.current = true;
          e.target.select();
        }}
        onBlur={(e) => {
          isFocusedRef.current = false;
          commitValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setLocalVal(raw);
          const num = parseInt(raw, 10);
          if (!isNaN(num) && num >= 5 && num <= 95) {
            onChange?.(num);
          }
        }}
        style={{
          width: 26,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: '#38BDF8',
          fontSize: '0.70rem',
          fontFamily: 'monospace',
          fontWeight: 700,
          textAlign: 'right',
          padding: 0,
          margin: 0,
        }}
        title="វាយបញ្ចូលលេខ % ផ្ទាល់ (5 - 95%) ឬចុចព្រួញ ឡើង/ចុះ"
      />
      <span style={{ fontSize: '0.62rem', color: '#94A3B8', fontWeight: 600, paddingLeft: 1 }}>%</span>
    </div>
  );
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
  onUpdateActiveCrop = null,
  onAnalyzeFraming = null,
  isAnalyzingFraming = false,
  activeCropX = null,
  framingKeyframes = [],
  onToggleKeyframe = null,
  onSeekToKeyframe = null,
}) {
  const currentTimeSpanRef = useRef(null);

  useEffect(() => {
    if (typeof subscribePlayhead !== 'function') return undefined;
    let lastText = '';
    return subscribePlayhead((liveTime) => {
      if (currentTimeSpanRef.current) {
        const nextText = formatPrecisionTimecode(liveTime);
        if (nextText !== lastText) {
          lastText = nextText;
          currentTimeSpanRef.current.textContent = nextText;
        }
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

      {/* 9:16 Framing Control (Smooth Slider / CapCut Keyframes / AI Auto) + Live Audio Ducking dB Meter + Fullscreen */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
        {/* 9:16 Framing Control (Slider / CapCut Keyframes / AI Auto) */}
        {rawRatio === '9:16' && (() => {
          const activeVal = activeCropX !== null && activeCropX !== undefined
            ? Number(activeCropX)
            : (activeSegment?.cropX !== undefined && activeSegment?.cropX !== null
              ? Number(activeSegment.cropX)
              : (activeSegment?.cropPosition === 'left' ? 20 : (activeSegment?.cropPosition === 'right' ? 80 : 50)));

          return (
            <div
              className="player-framing-control-group"
              data-testid="player-framing-control-group"
              role="group"
              aria-label="9:16 Framing Position"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                background: 'rgba(9, 10, 15, 0.72)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 6,
                padding: '2px 4px',
              }}
            >
              {/* Direct Smooth Slider & Exact Number Input (Type or Drag) */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '0 4px',
                }}
              >
                <input
                  type="range"
                  min="5"
                  max="95"
                  step="1"
                  value={Math.round(activeVal)}
                  onChange={(e) => onUpdateActiveCrop && onUpdateActiveCrop(Number(e.target.value))}
                  title={`ទាញរំកិល Crop X: ${Math.round(activeVal)}% (ឬវាយបញ្ចូលលេខក្នុងប្រអប់ក្បែរនេះ)`}
                  style={{
                    width: 110,
                    height: 4,
                    accentColor: '#38BDF8',
                    cursor: 'ew-resize',
                  }}
                />
                <FramingCropNumberInput
                  value={activeVal}
                  onChange={(val) => onUpdateActiveCrop && onUpdateActiveCrop(val)}
                />
              </div>

              {/* CapCut-style Keyframe Controls (Pure Lucide React Icons) */}
              {(() => {
                const curT = Number.isFinite(currentTime) ? currentTime : 0;
                const sortedKfs = [...(framingKeyframes || [])].sort((a, b) => a.time - b.time);
                const nearestKf = sortedKfs.find((k) => Math.abs(k.time - curT) <= 0.35);
                const hasKfAtPlayhead = Boolean(nearestKf);
                const hasPrevKf = sortedKfs.some((k) => k.time < curT - 0.1);
                const hasNextKf = sortedKfs.some((k) => k.time > curT + 0.1);

                return (
                  <div
                    className="player-keyframe-controls"
                    data-testid="player-keyframe-controls"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2,
                      padding: '0 4px',
                      borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
                    }}
                  >
                    {/* Jump to Prev Keyframe */}
                    <button
                      type="button"
                      disabled={!hasPrevKf}
                      onClick={() => onSeekToKeyframe && onSeekToKeyframe('prev')}
                      title="លោតទៅ Keyframe មុន (Previous Keyframe)"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: hasPrevKf ? '#94A3B8' : 'rgba(255,255,255,0.2)',
                        padding: '2px 3px',
                        cursor: hasPrevKf ? 'pointer' : 'default',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 3,
                      }}
                    >
                      <ChevronLeft size={13} />
                    </button>

                    {/* Toggle Keyframe (Add / Remove Diamond) */}
                    <button
                      type="button"
                      data-testid="btn-toggle-keyframe"
                      onClick={() => onToggleKeyframe && onToggleKeyframe()}
                      title={
                        hasKfAtPlayhead
                          ? `លុប Keyframe ត្រង់ ${nearestKf.time.toFixed(1)}s (${Math.round(nearestKf.cropX)}%)`
                          : `ដៅ Keyframe ថ្មី (Diamond) ត្រង់ ${curT.toFixed(1)}s`
                      }
                      style={{
                        background: hasKfAtPlayhead
                          ? 'rgba(56, 189, 248, 0.22)'
                          : 'rgba(255, 255, 255, 0.06)',
                        color: hasKfAtPlayhead ? '#38BDF8' : '#94A3B8',
                        border: hasKfAtPlayhead
                          ? '1px solid rgba(56, 189, 248, 0.55)'
                          : '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: 4,
                        padding: '2px 5px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Diamond
                        size={11}
                        fill={hasKfAtPlayhead ? '#38BDF8' : 'none'}
                        color={hasKfAtPlayhead ? '#38BDF8' : '#94A3B8'}
                      />
                    </button>

                    {/* Jump to Next Keyframe */}
                    <button
                      type="button"
                      disabled={!hasNextKf}
                      onClick={() => onSeekToKeyframe && onSeekToKeyframe('next')}
                      title="លោតទៅ Keyframe បន្ទាប់ (Next Keyframe)"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: hasNextKf ? '#94A3B8' : 'rgba(255,255,255,0.2)',
                        padding: '2px 3px',
                        cursor: hasNextKf ? 'pointer' : 'default',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 3,
                      }}
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                );
              })()}

              {onAnalyzeFraming && (
                <button
                  type="button"
                  data-testid="btn-ai-auto-framing"
                  onClick={onAnalyzeFraming}
                  disabled={isAnalyzingFraming}
                  title="ស្កេន AI Face Tracking ស្វ័យប្រវត្តគ្រប់ Segment ក្នុងភាគនេះ"
                  style={{
                    background: isAnalyzingFraming ? 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.12)',
                    color: '#C084FC',
                    border: '1px solid rgba(168, 85, 247, 0.35)',
                    borderRadius: 4,
                    padding: '3px 7px',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    cursor: isAnalyzingFraming ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isAnalyzingFraming ? (
                    <>
                      <Loader2 size={11} className="animate-spin" />
                      <span>ស្កេន...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={11} color="#C084FC" />
                      <span>AI Auto</span>
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })()}

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
            flexShrink: 0,
            whiteSpace: 'nowrap',
            minWidth: 'fit-content',
          }}
        >
          {duckVol === 0 ? (
            <VolumeX size={13} color="var(--color-error)" />
          ) : (
            <Volume2 size={13} color="var(--accent-cyan)" />
          )}
          <div
            style={{
              width: 30,
              height: 5,
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.1)',
              overflow: 'hidden',
              flexShrink: 0,
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
              fontSize: '0.70rem',
              color: duckVol === 0 ? 'var(--color-error)' : 'var(--text-secondary)',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              display: 'inline-block',
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
