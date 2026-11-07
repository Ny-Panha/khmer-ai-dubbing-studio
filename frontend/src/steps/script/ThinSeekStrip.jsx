import React, { useRef, useCallback } from 'react';
import { formatTimecode, parseTimeToSeconds } from '../../utils/formatTime';
import './ThinSeekStrip.css';

/**
 * ThinSeekStrip: Compact scrubber strip replacing the heavy multi-track timeline on Step 2.
 * Renders segment ticks, highlighted active segment, playhead, and handles click-to-seek and scrubbing.
 */
export default function ThinSeekStrip({
  currentTime = 0,
  duration = 0,
  segments = [],
  selectedSegmentId = null,
  onSeek = null,
  onSelectSegment = null,
}) {
  const trackRef = useRef(null);
  const isDraggingRef = useRef(false);

  const safeDuration = duration > 0 ? duration : (
    segments.length > 0
      ? Math.max(...segments.map(s => typeof s.endSec === 'number' ? s.endSec : parseTimeToSeconds(s.end, 10)))
      : 60
  );

  const handlePointerSeek = useCallback((clientX) => {
    if (!trackRef.current || !onSeek || safeDuration <= 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = parseFloat((ratio * safeDuration).toFixed(2));
    onSeek(targetTime);
  }, [safeDuration, onSeek]);

  const handleMouseDown = (e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    handlePointerSeek(e.clientX);

    const handleMouseMove = (moveEvent) => {
      if (isDraggingRef.current) {
        handlePointerSeek(moveEvent.clientX);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const playheadPercent = Math.max(0, Math.min(100, (currentTime / (safeDuration || 1)) * 100));

  return (
    <div className="thin-seek-strip-container">
      {/* Current Timecode (Pinned Left) */}
      <span className="thin-seek-time-label left">
        {formatTimecode(currentTime)}
      </span>

      {/* Scrubbing Track (Spans 100% of Centre Width) */}
      <div
        ref={trackRef}
        className="thin-seek-strip-track"
        onMouseDown={handleMouseDown}
        title="Scrub video timeline (Click or Drag to Seek)"
      >
        {/* Dialogue Segment Ticks across Full Width */}
        {segments.map((seg, idx) => {
          const sSec = typeof seg.startSec === 'number' ? seg.startSec : parseTimeToSeconds(seg.start, 0);
          const eSec = typeof seg.endSec === 'number' ? seg.endSec : parseTimeToSeconds(seg.end, sSec + 3);
          const leftPct = Math.max(0, Math.min(100, (sSec / safeDuration) * 100));
          const widthPct = Math.max(0.3, Math.min(100 - leftPct, ((eSec - sSec) / safeDuration) * 100));
          const isSelected = selectedSegmentId === seg.id || selectedSegmentId === idx;

          return (
            <div
              key={seg.id || idx}
              className={`thin-seek-segment-tick ${isSelected ? 'is-selected' : ''}`}
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (onSeek) onSeek(sSec);
                if (onSelectSegment) onSelectSegment(seg.id !== undefined && seg.id !== null ? seg.id : idx);
              }}
              title={`#${idx + 1}: ${seg.start} - ${seg.end} (${seg.khmer || seg.khmerText || ''})`}
            />
          );
        })}

        {/* Live Playhead Indicator */}
        <div
          className="thin-seek-playhead"
          style={{ left: `${playheadPercent}%` }}
        />
      </div>

      {/* Total Duration Timecode (Pinned Right) */}
      <span className="thin-seek-time-label right">
        {formatTimecode(safeDuration)}
      </span>
    </div>
  );
}
