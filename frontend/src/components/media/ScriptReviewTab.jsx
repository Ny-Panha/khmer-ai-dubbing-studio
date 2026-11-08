import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search, Play, Pause, RefreshCw, Trash2, Subtitles, AlertCircle, AlertTriangle,
  User, Mic, Volume2, Sparkles, Languages, Edit3, Check, CheckCircle2,
  Loader2, MessageSquare, HelpCircle
} from 'lucide-react';
import { parseTimeToSeconds } from '../../utils/formatTime';
import { cleanKhmerText } from '../../utils/cleanKhmer';

function DebouncedScriptTextarea({ value, onChange, onBlur, placeholder, className, style, rows = 2 }) {
  const [localVal, setLocalVal] = React.useState(value || '');
  const timerRef = React.useRef(null);
  const committedRef = React.useRef(value || '');

  React.useEffect(() => {
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
 * Memoized single caption card to prevent 666+ items from re-rendering simultaneously
 */
const CaptionItemCard = React.memo(function CaptionItemCard({
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
  const startSec = typeof seg.startSec === 'number' ? seg.startSec : parseTimeToSeconds(seg.start, 0);
  const endSec = typeof seg.endSec === 'number' ? seg.endSec : parseTimeToSeconds(seg.end, startSec + 3.0);
  const segDuration = Math.max(0.1, endSec - startSec);
  const naturalAudioDur = (typeof seg.rawAudioDur === 'number' && seg.rawAudioDur > 0)
    ? seg.rawAudioDur
    : ((typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
      ? seg.finalAudioDuration
      : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
        ? seg.audioDuration
        : seg.audioDurationSec));
  const isOverflow = (typeof naturalAudioDur === 'number' && naturalAudioDur > (segDuration + 0.3)) || Boolean(seg.audioTrimmed);

  return (
    <div
      onClick={() => onSelectSegment && onSelectSegment(seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx))}
      className={`caption-item-card ${isSelected ? 'selected' : ''}`}
      style={{
        padding: '8px 10px',
        cursor: 'pointer',
      }}
    >
      {/* Clean Card Header */}
      <div className="caption-header" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        {/* Left: Index, Timing & Essential Speaker Badge */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary-accent)', minWidth: 20 }}>
            #{idx + 1}
          </span>

          {/* Time Range Pill */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'rgba(255, 255, 255, 0.04)', padding: '1px 4px', borderRadius: 4, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <input
              type="text"
              value={seg.start}
              onChange={(e) => handleSegmentChange(idx, 'start', e.target.value)}
              style={{ width: 44, padding: '1px 2px', fontSize: '0.70rem', textAlign: 'center', background: 'transparent', color: '#cbd5e1', border: 'none', outline: 'none' }}
              title="Start time (mm:ss)"
            />
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>-</span>
            <input
              type="text"
              value={seg.end}
              onChange={(e) => handleSegmentChange(idx, 'end', e.target.value)}
              style={{ width: 44, padding: '1px 2px', fontSize: '0.70rem', textAlign: 'center', background: 'transparent', color: '#cbd5e1', border: 'none', outline: 'none' }}
              title="End time (mm:ss)"
            />
          </div>

          {/* Clean Speaker Badge */}
          {(seg.speaker || seg.speakerName || seg.speakerId) && (
            <span style={{
              fontSize: '0.66rem',
              background: (seg.voiceGender === 'female' || seg.speakerGender === 'FEMALE') ? 'rgba(244, 114, 182, 0.12)' : 'rgba(56, 189, 248, 0.12)',
              color: (seg.voiceGender === 'female' || seg.speakerGender === 'FEMALE') ? '#f472b6' : '#38bdf8',
              border: `1px solid ${(seg.voiceGender === 'female' || seg.speakerGender === 'FEMALE') ? 'rgba(244, 114, 182, 0.25)' : 'rgba(56, 189, 248, 0.25)'}`,
              padding: '1px 6px',
              borderRadius: 4,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3
            }}>
              <User size={10} strokeWidth={2.4} />
              <span>{cleanKhmerText(seg.speakerName || seg.speaker || seg.speakerId)}</span>
            </span>
          )}

          {/* Unverified Fast OCR Speaker Warning */}
          {(seg.speakerSource === 'ocr_only' || seg.unverifiedSpeaker) && (
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                color: '#f59e0b',
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                padding: '1px 5px',
                borderRadius: 4,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
              title="Speaker unverified (Fast OCR mode without ASR diarization)"
            >
              speaker?
            </span>
          )}

          {/* Voice Actor Chip */}
          <span style={{
            fontSize: '0.62rem',
            padding: '1px 5px',
            borderRadius: 4,
            background: 'rgba(255, 255, 255, 0.04)',
            color: '#94a3b8',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3
          }}>
            <Mic size={9} />
            <span>{(seg.voiceId || seg.khmerVoiceId || '').includes('Sreymom') ? 'Sreymom' : 'Piseth'}</span>
          </span>

          {/* Single Consolidated Status Pill */}
          {seg.textStatus === 'generating' ? (
            <span style={{ fontSize: '0.62rem', color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Loader2 size={10} className="animate-spin" />
            </span>
          ) : seg.deliveryType === 'inner_thought' ? (
            <span style={{ fontSize: '0.62rem', color: '#d8b4fe', background: 'rgba(168, 85, 247, 0.15)', border: '1px dashed #c084fc', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }} title="និយាយក្នុងចិត្ត">
              💭 ក្នុងចិត្ត
            </span>
          ) : (!seg.khmerTranslatedText && !seg.khmer && !seg.khmerText) ? (
            <span style={{ fontSize: '0.62rem', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }} title="ត្រូវការបកប្រែ">
              Review
            </span>
          ) : seg.audioOutdated ? (
            <span style={{ fontSize: '0.62rem', color: '#fbbf24', display: 'inline-flex', alignItems: 'center', gap: 2 }} title="Text updated, needs audio regen">
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fbbf24' }} />
            </span>
          ) : seg.ttsStatus === 'ready' || seg.audioUrl ? (
            <span style={{ fontSize: '0.62rem', color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: 2 }} title="TTS Audio Synced">
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} />
            </span>
          ) : null}
        </div>

        {/* Right: Quick Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          {onToggleDeliveryType && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const segTarget = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
                onToggleDeliveryType(segTarget, seg.deliveryType === 'inner_thought' ? 'out_loud' : 'inner_thought', true, idx);
              }}
              style={{
                fontSize: '0.62rem',
                padding: '2px 5px',
                fontWeight: 600,
                borderRadius: 4,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                border: seg.deliveryType === 'inner_thought' ? '1px dashed #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                background: seg.deliveryType === 'inner_thought' ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                color: seg.deliveryType === 'inner_thought' ? '#d8b4fe' : '#94a3b8',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
              title={seg.deliveryType === 'inner_thought' ? "ប្តូរទៅជា និយាយធម្មតា" : "ប្តូរទៅជា និយាយក្នុងចិត្ត (Inner Thought)"}
            >
              {seg.deliveryType === 'inner_thought' ? '💭 ក្នុងចិត្ត' : '🔊 ធម្មតា'}
            </button>
          )}

          {seg.audioUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePlayLine(seg.audioUrl, seg.id || idx);
              }}
              className="icon-action-btn"
              style={{ color: isPlaying ? '#10b981' : '#94a3b8' }}
              title="Preview audio line"
            >
              {isPlaying ? <Pause size={11} /> : <Play size={11} fill="currentColor" />}
            </button>
          )}

          {onRegenerateSegment && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRegenerateSegment(seg.id || idx);
              }}
              className="icon-action-btn"
              style={{ color: seg.audioOutdated ? '#fbbf24' : '#64748b' }}
              title="Regenerate single line audio"
            >
              <RefreshCw size={11} />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteSegment(seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx));
            }}
            className="icon-action-btn danger"
            title="Delete line"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Original Chinese dialogue line if present */}
      {(seg.chineseText || seg.originalChineseText || seg.originalText || seg.original || seg.chinese) && (
        <div style={{ fontSize: '0.74rem', color: '#93c5fd', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: '0.62rem',
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#60a5fa',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            padding: '1px 5px',
            borderRadius: 4,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            flexShrink: 0
          }}>
            <Languages size={10} />
            <span>CN</span>
          </span>
          <span style={{ opacity: 0.9, lineHeight: 1.35 }}>{seg.chineseText || seg.originalChineseText || seg.originalText || seg.original || seg.chinese}</span>
        </div>
      )}

      {/* Khmer Translation Textarea with debouncing */}
      <DebouncedScriptTextarea
        rows={2}
        value={seg.khmerTranslatedText || seg.khmer || seg.khmerText || ''}
        onChange={(val) => handleSegmentChange(idx, 'khmer', val)}
        onBlur={(e) => handleSegmentBlur && handleSegmentBlur(idx, e.target.value)}
        placeholder="អត្ថបទសម្រាយ ឬបកប្រែជាភាសាខ្មែរ..."
        className="caption-textarea"
        style={{ width: '100%', fontSize: '0.82rem', lineHeight: 1.55, padding: '6px 8px', boxSizing: 'border-box' }}
      />

      {/* Duration Overflow Alert */}
      {isOverflow && (
        <div style={{ fontSize: '0.68rem', color: 'var(--color-warning)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertCircle size={11} />
          <span>Speech duration ({(naturalAudioDur || seg.audioDurationSec || 0).toFixed(1)}s) exceeds slot ({segDuration.toFixed(1)}s){seg.audioTrimmed ? ' (Trimmed ✂)' : ''}</span>
        </div>
      )}
    </div>
  );
});

function ScriptReviewTab({
  scriptData,
  handleBridgeGaps,
  handleAddSegment,
  searchQuery,
  setSearchQuery,
  speakerRegistry,
  filteredSegments = [],
  selectedSegmentId,
  onSelectSegment,
  handleSegmentChange,
  handleSegmentBlur,
  handlePlayLine,
  playingSegmentId,
  onRegenerateSegment,
  handleDeleteSegment,
  onToggleDeliveryType = null,
}) {
  const parentRef = React.useRef(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredSegments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 8,
    gap: 8,
    getItemKey: React.useCallback(
      (index) => filteredSegments[index]?._uid || filteredSegments[index]?.id || index,
      [filteredSegments]
    ),
  });

  return (
    <div className="media-tab-content" style={{ overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
          Segments ({scriptData?.segments?.length || 0})
        </span>
      </div>

      {/* Search Bar */}
      {scriptData?.segments && scriptData.segments.length > 3 && (
        <div style={{ position: 'relative', marginBottom: 10, flexShrink: 0 }}>
          <Search size={13} color="var(--text-dim)" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search dialogue or translation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="capcut-input"
            style={{ paddingLeft: 26, fontSize: '0.76rem', height: 28 }}
          />
        </div>
      )}

      <div
        ref={parentRef}
        className="captions-list-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          minHeight: 0,
          position: 'relative',
        }}
      >
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
              const idx = virtualRow.index;
              if (!seg) return null;

              const isSelected = Boolean(
                selectedSegmentId !== null && (
                  (seg._uid && String(selectedSegmentId) === String(seg._uid)) ||
                  (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === idx)
                )
              );
              const isPlaying = Boolean(playingSegmentId === (seg.id || idx));

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <CaptionItemCard
                    seg={seg}
                    idx={idx}
                    isSelected={isSelected}
                    isPlaying={isPlaying}
                    onSelectSegment={onSelectSegment}
                    handleSegmentChange={handleSegmentChange}
                    handleSegmentBlur={handleSegmentBlur}
                    handlePlayLine={handlePlayLine}
                    onRegenerateSegment={onRegenerateSegment}
                    handleDeleteSegment={handleDeleteSegment}
                    onToggleDeliveryType={onToggleDeliveryType}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 15px', color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <Subtitles size={28} color="var(--text-dim)" style={{ margin: '0 auto 10px', display: 'block' }} />
            <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              No Dialogue Lines
            </div>
            <p style={{ fontSize: '0.76rem', margin: 0 }}>
              Generate a script in the "AI Dubbing" tab or click "Add Line" to create dialogue manually.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(ScriptReviewTab);
