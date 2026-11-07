import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search, Play, Pause, RefreshCw, Trash2, Subtitles, AlertCircle,
  User, Mic, Sparkles, MessageSquare, Plus, Scissors
} from 'lucide-react';
import { parseTimeToSeconds } from '../../utils/formatTime';
import { cleanKhmerText } from '../../utils/cleanKhmer';
import './TranscriptSegmentList.css';

/**
 * Debounced text area to avoid stuttering on massive transcript lists
 */
function DebouncedScriptTextarea({ value, onChange, onBlur, placeholder, className, style, rows = 2 }) {
  const [localVal, setLocalVal] = useState(value || '');
  const timerRef = useRef(null);
  const committedRef = useRef(value || '');

  useEffect(() => {
    if (value !== committedRef.current) {
      setLocalVal(value || '');
      committedRef.current = value || '';
    }
  }, [value]);

  const commit = (val) => {
    if (val === committedRef.current) return;
    committedRef.current = val;
    onChange(val);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setLocalVal(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      commit(next);
    }, 350);
  };

  const handleBlur = (e) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    commit(e.target.value);
    if (onBlur) onBlur(e);
  };

  return (
    <textarea
      rows={rows}
      value={localVal}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
      style={style}
    />
  );
}

/**
 * Memoized Single Transcript Card
 */
const TranscriptItemCard = React.memo(function TranscriptItemCard({
  seg,
  idx,
  isSelected,
  isPlaying,
  onSelectSegment,
  handleSegmentChange,
  handleSegmentBlur,
  handlePlayLine,
  onRegenerateSegment,
  handleDeleteSegment,
  onToggleDeliveryType,
}) {
  const chineseText = seg.original || seg.chineseText || seg.originalChineseText || seg.chinese || '';
  const khmerText = seg.khmer || seg.khmerText || '';
  const speakerName = seg.speakerName || seg.speaker || seg.speakerId || 'Speaker';
  const speakerGender = seg.speakerGender || seg.voiceGender || 'unknown';
  const isFemale = speakerGender.toLowerCase() === 'female';
  const isMale = speakerGender.toLowerCase() === 'male';

  return (
    <div
      onClick={() => onSelectSegment && onSelectSegment(seg.id !== undefined && seg.id !== null ? seg.id : idx)}
      className={`transcript-card ${isSelected ? 'is-selected' : ''}`}
    >
      {/* Header: Index, Time range, Speaker, Delivery, Actions */}
      <div className="transcript-card-header">
        <div className="transcript-header-left">
          <span className="transcript-index-badge">#{idx + 1}</span>

          {/* Time range inputs */}
          <div className="transcript-time-pill">
            <input
              type="text"
              value={seg.start}
              onChange={(e) => handleSegmentChange(idx, 'start', e.target.value)}
              className="transcript-time-input"
              title="Start time (mm:ss)"
            />
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>-</span>
            <input
              type="text"
              value={seg.end}
              onChange={(e) => handleSegmentChange(idx, 'end', e.target.value)}
              className="transcript-time-input"
              title="End time (mm:ss)"
            />
          </div>

          {/* Speaker & Gender chip */}
          <span className={`transcript-speaker-chip ${isFemale ? 'female' : isMale ? 'male' : 'unknown'}`}>
            <User size={10} strokeWidth={2.4} />
            <span>{cleanKhmerText(speakerName)}</span>
            <span style={{ fontSize: '0.58rem', opacity: 0.8 }}>({isFemale ? 'ស្រី' : isMale ? 'ប្រុស' : '?'})</span>
          </span>

          {/* Delivery Mode Toggle */}
          <span
            className={`transcript-delivery-chip ${seg.deliveryType === 'inner_thought' ? 'inner-thought' : 'normal'}`}
            onClick={(e) => {
              e.stopPropagation();
              if (onToggleDeliveryType) onToggleDeliveryType(seg.id !== undefined && seg.id !== null ? seg.id : idx);
            }}
            title="ចុចដើម្បីប្តូររបៀបនិយាយ (ធម្មតា / 💭 និយាយក្នុងចិត្ត)"
          >
            {seg.deliveryType === 'inner_thought' ? '💭 ក្នុងចិត្ត' : '💬 ធម្មតា'}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="transcript-card-actions" onClick={(e) => e.stopPropagation()}>
          {seg.audioUrl && (
            <button
              type="button"
              className="transcript-action-btn"
              onClick={() => handlePlayLine(seg.audioUrl, seg.id)}
              title="ចាក់ស្តាប់សំឡេងឃ្លានេះ"
            >
              {isPlaying ? <Pause size={12} color="#38bdf8" /> : <Play size={12} color="#38bdf8" />}
            </button>
          )}

          {onRegenerateSegment && (
            <button
              type="button"
              className="transcript-action-btn"
              onClick={() => onRegenerateSegment(seg.id !== undefined && seg.id !== null ? seg.id : idx)}
              title="Regenerate សំឡេងឃ្លានេះឡើងវិញ"
            >
              <RefreshCw size={11} />
            </button>
          )}

          <button
            type="button"
            className="transcript-action-btn delete"
            onClick={() => handleDeleteSegment(seg.id !== undefined && seg.id !== null ? seg.id : idx)}
            title="លុបឃ្លានេះចោល"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Chinese Source Text Row */}
      {chineseText && (
        <div className="transcript-source-row">
          <span className="transcript-source-tag">CN</span>
          <p className="transcript-source-text">{chineseText}</p>
        </div>
      )}

      {/* Khmer Editable Translation Textarea */}
      <DebouncedScriptTextarea
        value={khmerText}
        onChange={(val) => handleSegmentChange(idx, 'khmer', val)}
        onBlur={(e) => handleSegmentBlur(idx, e.target.value)}
        placeholder="បញ្ចូលអត្ថបទបកប្រែជាភាសាខ្មែរ..."
        className="transcript-textarea"
        rows={2}
      />
    </div>
  );
});

export default function TranscriptSegmentList({
  segments = [],
  selectedSegmentId = null,
  onSelectSegment = null,
  onUpdateSegments = null,
  onUpdateScript = null,
  onRegenerateSegment = null,
  onDeleteSegment = null,
  onToggleDeliveryType = null,
  searchQuery = '',
}) {
  const containerRef = useRef(null);
  const [playingSegmentId, setPlayingSegmentId] = useState(null);
  const audioPlayerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.removeAttribute('src');
      }
    };
  }, []);

  const handlePlayLine = useCallback((url, segId) => {
    if (!url) return;
    if (playingSegmentId === segId && audioPlayerRef.current && !audioPlayerRef.current.paused) {
      audioPlayerRef.current.pause();
      setPlayingSegmentId(null);
      return;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.removeAttribute('src');
    }
    const a = new Audio(url);
    audioPlayerRef.current = a;
    setPlayingSegmentId(segId);
    a.play().catch(() => setPlayingSegmentId(null));
    a.onended = () => setPlayingSegmentId(null);
    a.onerror = () => setPlayingSegmentId(null);
  }, [playingSegmentId]);

  const handleSegmentChange = useCallback((idx, field, value) => {
    if (!segments || !segments[idx]) return;
    const updated = [...segments];
    updated[idx] = {
      ...updated[idx],
      [field]: value,
      ...(field === 'khmer' ? { khmerText: value } : {}),
      ...(field === 'start' ? { startSec: parseTimeToSeconds(value, 0) } : {}),
      ...(field === 'end' ? { endSec: parseTimeToSeconds(value, 0) } : {}),
    };
    if (onUpdateSegments) {
      onUpdateSegments(updated);
    } else if (onUpdateScript) {
      onUpdateScript({ segments: updated });
    }
  }, [segments, onUpdateSegments, onUpdateScript]);

  const handleSegmentBlur = useCallback((idx, explicitText) => {
    if (!segments || !segments[idx]) return;
    const cleanText = explicitText !== null ? String(explicitText).trim() : (segments[idx].khmer || '').trim();
    if (!cleanText) return;
    handleSegmentChange(idx, 'khmer', cleanText);
  }, [segments, handleSegmentChange]);

  const handleDelete = useCallback((segIdOrIdx) => {
    if (onDeleteSegment) {
      onDeleteSegment(segIdOrIdx);
    } else {
      const updated = segments.filter((s, i) => s.id !== segIdOrIdx && i !== segIdOrIdx);
      if (onUpdateSegments) onUpdateSegments(updated);
    }
  }, [segments, onDeleteSegment, onUpdateSegments]);

  // Filter segments by search query
  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const q = searchQuery.toLowerCase().trim();
    return segments.filter((seg) => {
      const km = (seg.khmer || seg.khmerText || '').toLowerCase();
      const orig = (seg.original || seg.chineseText || seg.originalChineseText || '').toLowerCase();
      const spk = (seg.speaker || seg.speakerName || '').toLowerCase();
      return km.includes(q) || orig.includes(q) || spk.includes(q);
    });
  }, [segments, searchQuery]);

  // Virtualizer setup
  const rowVirtualizer = useVirtualizer({
    count: filteredSegments.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 140,
    overscan: 8,
    gap: 8,
  });

  return (
    <div className="transcript-segment-list-container">
      <div ref={containerRef} className="transcript-list-scrollable">
        {filteredSegments.length > 0 ? (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const seg = filteredSegments[virtualRow.index];
              const isSelected = selectedSegmentId === seg.id || selectedSegmentId === virtualRow.index;
              const isPlaying = playingSegmentId === seg.id;

              return (
                <div
                  key={seg.id || virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TranscriptItemCard
                    seg={seg}
                    idx={virtualRow.index}
                    isSelected={isSelected}
                    isPlaying={isPlaying}
                    onSelectSegment={onSelectSegment}
                    handleSegmentChange={handleSegmentChange}
                    handleSegmentBlur={handleSegmentBlur}
                    handlePlayLine={handlePlayLine}
                    onRegenerateSegment={onRegenerateSegment}
                    handleDeleteSegment={handleDelete}
                    onToggleDeliveryType={onToggleDeliveryType}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
            <Subtitles size={32} color="#475569" style={{ margin: '0 auto 10px', display: 'block' }} />
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
              {searchQuery ? 'រកមិនឃើញឃ្លាដែលត្រូវនឹងការស្វែងរកទេ' : 'មិនទាន់មានបន្ទាត់សន្ទនាទេ'}
            </div>
            <p style={{ fontSize: '0.78rem', margin: 0 }}>
              {searchQuery ? 'សូមសាកល្បងស្វែងរកដោយពាក្យគន្លឹះផ្សេងទៀត' : 'ចុច "+ Add Line" នៅលើ Toolbar ដើម្បីបង្កើតបន្ទាត់សន្ទនា'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
