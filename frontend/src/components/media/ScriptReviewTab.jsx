import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search, X, Play, Pause, RefreshCw, Trash2, Subtitles, AlertCircle, AlertTriangle,
  User, UserCheck, Volume2, Sparkles, Languages, Edit3, Check, CheckCircle2,
  Loader2, MessageSquare, HelpCircle, Wrench
} from 'lucide-react';
import { parseTimeToSeconds } from '../../utils/formatTime';
import { formatMinSec } from '../../utils/timestampUtils';
import { cleanKhmerText } from '../../utils/cleanKhmer';
import {
  retranslateSegmentApi,
  startRepairBrokenJobApi,
  fetchJobStatusApi,
} from '../../services/api';
import {
  findRepeatedJunkKhmerSet,
  isSegmentTextBroken,
  isSegmentVoiceBroken,
  scanEpisodeBrokenSegments,
} from '../../utils/translationQuality';
import { resolveVoiceMeta } from '../../utils/voiceCatalog';

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
  repeatedJunkSet = null,
  isSelected,
  isPlaying,
  onSelectSegment,
  handleSegmentChange,
  handleSegmentBlur,
  handlePlayLine,
  onRegenerateSegment,
  onTranslateSegment,
  handleDeleteSegment,
  onToggleDeliveryType,
}) {
  const [isTranslating, setIsTranslating] = React.useState(false);
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

  const isTextEmpty = isSegmentTextBroken(seg, repeatedJunkSet);
  const isVoiceBroken = !isTextEmpty && isSegmentVoiceBroken(seg, { repeatedJunkSet });
  const isReviewNeeded = Boolean(seg.reviewNeeded || seg.uncertainOcr || seg.ocrDisagreement || isTextEmpty || isVoiceBroken);

  const handleTranslateLine = async (e) => {
    e.stopPropagation();
    if (isTranslating) return;
    const textToTranslate = (seg.chineseText || seg.originalChineseText || seg.originalText || seg.original || '').trim();
    if (!textToTranslate) {
      alert(`Segment #${idx + 1} មិនមានអត្ថបទចិនដើមសម្រាប់បកប្រែទេ!`);
      return;
    }
    setIsTranslating(true);
    try {
      if (onTranslateSegment) {
        await onTranslateSegment(seg.id ?? idx, idx);
      } else {
        const res = await retranslateSegmentApi(textToTranslate, {
          speaker: seg.speaker,
          gender: seg.voiceGender || seg.speakerGender || seg.gender,
        });
        if (res && Array.isArray(res.options) && res.options.length > 0) {
          const best = cleanKhmerText(res.options[0].text);
          if (best) {
            handleSegmentChange(idx, 'khmer', best);
            if (handleSegmentBlur) {
              handleSegmentBlur(idx, best);
            }
          }
        }
      }
    } catch (err) {
      console.error('[Card] Failed to translate line:', err);
      alert(`បរាជ័យក្នុងការបកប្រែ: ${err.message}`);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div
      onClick={() => {
        if (!onSelectSegment) return;
        const segKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
        onSelectSegment(segKey, seg, idx);
      }}
      className={`caption-item-card ${isSelected ? 'selected' : ''}`}
      style={{
        padding: '8px 10px',
        cursor: 'pointer',
        borderLeft: isTextEmpty
          ? '3px solid #ef4444'
          : (isReviewNeeded ? '3px solid #f59e0b' : undefined),
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
              value={seg.start || (typeof seg.startSec === 'number' ? formatMinSec(seg.startSec) : '00:00')}
              onChange={(e) => handleSegmentChange(idx, 'start', e.target.value)}
              style={{ width: 44, padding: '1px 2px', fontSize: '0.70rem', textAlign: 'center', background: 'transparent', color: '#cbd5e1', border: 'none', outline: 'none' }}
              title="Start time (mm:ss)"
            />
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>-</span>
            <input
              type="text"
              value={seg.end || (typeof seg.endSec === 'number' ? formatMinSec(seg.endSec) : '00:00')}
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

          {/* Voice Actor Chip (resolved from voice catalog) */}
          {(() => {
            const voiceMeta = resolveVoiceMeta(seg);
            const isFemale = voiceMeta.gender === 'FEMALE';
            return (
              <span
                data-testid="segment-voice-chip"
                style={{
                  fontSize: '0.62rem',
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: isFemale ? 'rgba(244, 114, 182, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                  color: isFemale ? '#f472b6' : '#38bdf8',
                  border: `1px solid ${isFemale ? 'rgba(244, 114, 182, 0.25)' : 'rgba(56, 189, 248, 0.25)'}`,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3
                }}
                title={voiceMeta.id}
              >
                {isFemale ? <UserCheck size={9} strokeWidth={2.4} /> : <User size={9} strokeWidth={2.4} />}
                <span>{voiceMeta.label}</span>
              </span>
            );
          })()}

          {/* Single Consolidated Status Pill */}
          {seg.textStatus === 'generating' ? (
            <span style={{ fontSize: '0.62rem', color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Loader2 size={10} className="animate-spin" />
            </span>
          ) : seg.deliveryType === 'inner_thought' ? (
            <span style={{ fontSize: '0.62rem', color: '#d8b4fe', background: 'rgba(168, 85, 247, 0.15)', border: '1px dashed #c084fc', padding: '1px 5px', borderRadius: 4, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }} title="និយាយក្នុងចិត្ត">
              <MessageSquare size={9} />
              <span>ក្នុងចិត្ត</span>
            </span>
          ) : isTextEmpty ? (
            <span
              style={{
                fontSize: '0.62rem',
                color: '#ef4444',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                padding: '1px 6px',
                borderRadius: 4,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="ខ្វះអត្ថបទខ្មែរ — សូមបកប្រែ ឬវាយអត្ថបទ (Missing Khmer text)"
            >
              <AlertCircle size={10} />
              <span>ខ្វះអត្ថបទ</span>
            </span>
          ) : isVoiceBroken ? (
            <span
              style={{
                fontSize: '0.62rem',
                color: '#fb923c',
                background: 'rgba(249, 115, 22, 0.15)',
                border: '1px solid rgba(249, 115, 22, 0.4)',
                padding: '1px 6px',
                borderRadius: 4,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="ខ្វះសំឡេង AI (Missing or failed TTS audio)"
            >
              <AlertCircle size={10} />
              <span>ខ្វះសំឡេង</span>
            </span>
          ) : isReviewNeeded ? (
            <span
              style={{
                fontSize: '0.62rem',
                color: '#f59e0b',
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                padding: '1px 6px',
                borderRadius: 4,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="ត្រូវពិនិត្យឡើងវិញ (Review needed)"
            >
              <AlertTriangle size={10} />
              <span>Review</span>
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
                padding: '2px 6px',
                fontWeight: 600,
                borderRadius: 4,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: seg.deliveryType === 'inner_thought' ? '1px dashed #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                background: seg.deliveryType === 'inner_thought' ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                color: seg.deliveryType === 'inner_thought' ? '#d8b4fe' : '#94a3b8',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
              title={seg.deliveryType === 'inner_thought' ? "ប្តូរទៅជា និយាយធម្មតា" : "ប្តូរទៅជា និយាយក្នុងចិត្ត (Inner Thought)"}
            >
              {seg.deliveryType === 'inner_thought' ? (
                <>
                  <MessageSquare size={10} />
                  <span>ក្នុងចិត្ត</span>
                </>
              ) : (
                <>
                  <Volume2 size={10} />
                  <span>ធម្មតា</span>
                </>
              )}
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

          {/* One-Click Remedy: Translate this line */}
          {isTextEmpty && (
            <button
              type="button"
              disabled={isTranslating}
              onClick={handleTranslateLine}
              style={{
                padding: '2px 8px',
                fontSize: '0.68rem',
                borderRadius: 4,
                border: 'none',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#ffffff',
                fontWeight: 700,
                cursor: isTranslating ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                boxShadow: '0 1px 4px rgba(99, 102, 241, 0.35)',
              }}
              title="បកប្រែឃ្លានេះតាមរយៈ AI (Translate this line)"
            >
              {isTranslating ? (
                <>
                  <Loader2 size={10} className="animate-spin" />
                  <span>កំពុងបកប្រែ...</span>
                </>
              ) : (
                <>
                  <Sparkles size={10} />
                  <span>បកប្រែឃ្លានេះ</span>
                </>
              )}
            </button>
          )}

          {onRegenerateSegment && (
            <button
              type="button"
              disabled={isTextEmpty}
              onClick={(e) => {
                e.stopPropagation();
                if (isTextEmpty) return;
                onRegenerateSegment(seg.id || idx);
              }}
              className={`icon-action-btn ${isTextEmpty ? 'disabled' : ''}`}
              style={{
                color: isTextEmpty ? 'rgba(255, 255, 255, 0.2)' : (seg.audioOutdated ? '#fbbf24' : '#64748b'),
                cursor: isTextEmpty ? 'not-allowed' : 'pointer',
                opacity: isTextEmpty ? 0.35 : 1,
              }}
              title={
                isTextEmpty
                  ? "មិនអាចបង្កើតសំឡេងបានទេ — គ្មានអត្ថបទខ្មែរ (Missing text)"
                  : "Regenerate single line audio"
              }
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

function resolveOriginalSegmentIndex(segments, seg, fallbackIdx = 0) {
  if (!Array.isArray(segments) || segments.length === 0) return fallbackIdx;
  const found = segments.findIndex((s) =>
    s === seg ||
    (s._uid && seg?._uid && s._uid === seg._uid) ||
    (s.id !== undefined && s.id !== null && seg?.id !== undefined && seg?.id !== null && String(s.id) === String(seg.id))
  );
  return found >= 0 ? found : fallbackIdx;
}

function ScriptReviewTab({
  scriptData,
  seriesId = null,
  episodeId = null,
  apiKey = null,
  onRefreshSeries = null,
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
  onTranslateSegment = null,
  handleDeleteSegment,
  onToggleDeliveryType = null,
}) {
  const parentRef = React.useRef(null);
  const [filterMode, setFilterMode] = React.useState('all'); // 'all' | 'male' | 'female' | 'missing'
  const [isRepairingEpisode, setIsRepairingEpisode] = React.useState(false);
  const [repairJobId, setRepairJobId] = React.useState(null);
  const [repairStatusBanner, setRepairStatusBanner] = React.useState(null);

  const totalSegments = scriptData?.segments || [];
  const repeatedJunkSet = React.useMemo(
    () => findRepeatedJunkKhmerSet(totalSegments),
    [totalSegments]
  );
  const brokenScan = React.useMemo(
    () => scanEpisodeBrokenSegments({ id: episodeId, scriptData }),
    [episodeId, scriptData]
  );

  // Reset status banner when switching episodes
  React.useEffect(() => {
    setRepairStatusBanner(null);
    setRepairJobId(null);
    setIsRepairingEpisode(false);
  }, [episodeId]);

  // Poll active episode repair job until terminal status
  React.useEffect(() => {
    if (!repairJobId) return undefined;
    let cancelled = false;
    const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

    const checkStatus = async () => {
      try {
        const st = await fetchJobStatusApi(repairJobId);
        if (cancelled || !st || !st.success) return;

        if (TERMINAL_STATUSES.has(st.status)) {
          const fr = st.finalResult || {};
          const fixedCount = Number(fr.fixedCount || 0);
          const remainingCount = Number(fr.remainingCount ?? fr.remainingBroken ?? 0);
          const isQuota = fr.reason === 'quota' || /quota|429/i.test(String(fr.message || st.error || ''));

          setRepairJobId(null);
          setIsRepairingEpisode(false);

          if (typeof onRefreshSeries === 'function') {
            try { await onRefreshSeries(); } catch (_) {}
          }

          if (cancelled) return;

          if (remainingCount > 0) {
            setRepairStatusBanner({
              type: 'partial',
              text: `កែបាន ${fixedCount} • នៅសល់ ${remainingCount}${isQuota ? ' (quota)' : ''} — ចុចម្ដងទៀតដើម្បីបន្ត`,
            });
          } else if (st.status === 'failed' && fixedCount === 0) {
            setRepairStatusBanner({
              type: 'error',
              text: st.error || fr.message || 'ការជួសជុលឃ្លាខូចបរាជ័យ',
            });
          } else {
            setRepairStatusBanner({
              type: 'success',
              text: `✅ ជួសជុលឃ្លាខូច & Generate សំឡេងរួចរាល់ 100% (${fixedCount} ឃ្លា)!`,
            });
          }
        }
      } catch (_) {}
    };

    checkStatus();
    const timer = setInterval(checkStatus, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [repairJobId, onRefreshSeries]);

  const handleRepairEpisodeBroken = async () => {
    if (!seriesId || !episodeId || isRepairingEpisode) return;
    const n1 = brokenScan.textBrokenCount;
    const n2 = brokenScan.voiceBrokenCount;
    if (brokenScan.totalBrokenCount === 0) return;

    const confirmed = window.confirm(
      `🔧 បញ្ជាក់ការជួសជុលឃ្លាខូច & Generate ឡើងវិញ (${brokenScan.totalBrokenCount} ឃ្លា)\n\n` +
      `អត្ថបទខូច: ${n1} ឃ្លា • សំឡេងខ្វះ: ${n2} ឃ្លា\n\n` +
      `នឹងកែប្រែ & បង្កើតសំឡេងតែលើឃ្លាដែលខូចក្នុងភាគនេះប៉ុណ្ណោះ (មិនប៉ះពាល់ឃ្លាល្អឡើយ)។`
    );
    if (!confirmed) return;

    try {
      setIsRepairingEpisode(true);
      setRepairStatusBanner(null);

      const res = await startRepairBrokenJobApi({
        seriesId,
        episodeIds: [episodeId],
        apiKey: apiKey || undefined,
      });

      const job = Array.isArray(res?.jobs) && res.jobs[0] ? res.jobs[0] : null;
      const conflict = Array.isArray(res?.conflicts) && res.conflicts[0] ? res.conflicts[0] : null;
      const jid = job?.jobId || job?.id || conflict?.existingJobId || null;

      if (!jid) {
        setIsRepairingEpisode(false);
        if (typeof onRefreshSeries === 'function') {
          try { await onRefreshSeries(); } catch (_) {}
        }
        setRepairStatusBanner({
          type: 'success',
          text: '✅ គ្រប់ឃ្លារួចរាល់ 100% — គ្មានឃ្លាខូចទេ!',
        });
        return;
      }

      setRepairJobId(jid);
    } catch (err) {
      setIsRepairingEpisode(false);
      setRepairStatusBanner({
        type: 'error',
        text: err.message || 'ការជួសជុលឃ្លាខូចបរាជ័យ',
      });
    }
  };

  const missingTextCount = brokenScan.totalBrokenCount;

  // One pass: resolve voice gender per visible segment for filter pills + counts
  const voiceGenderCounts = React.useMemo(() => {
    let male = 0;
    let female = 0;
    for (const seg of filteredSegments) {
      if (resolveVoiceMeta(seg).gender === 'FEMALE') female += 1;
      else male += 1;
    }
    return { male, female };
  }, [filteredSegments]);

  const displayedSegments = React.useMemo(() => {
    if (filterMode === 'missing') {
      return filteredSegments.filter(
        (seg) =>
          isSegmentTextBroken(seg, repeatedJunkSet) ||
          isSegmentVoiceBroken(seg, { repeatedJunkSet })
      );
    }
    if (filterMode === 'male' || filterMode === 'female') {
      const wanted = filterMode === 'female' ? 'FEMALE' : 'MALE';
      return filteredSegments.filter((seg) => resolveVoiceMeta(seg).gender === wanted);
    }
    return filteredSegments;
  }, [filteredSegments, filterMode, repeatedJunkSet]);

  const rowVirtualizer = useVirtualizer({
    count: displayedSegments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 8,
    gap: 8,
    getItemKey: React.useCallback(
      (index) => displayedSegments[index]?._uid || displayedSegments[index]?.id || index,
      [displayedSegments]
    ),
  });

  return (
    <div className="media-tab-content" style={{ overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Mirrored Episode Repair Broken & Regenerate Action in Script/Subs Header */}
      {(brokenScan.totalBrokenCount > 0 || isRepairingEpisode) && seriesId && episodeId && (
        <div style={{ marginBottom: 8, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <button
            type="button"
            data-testid="btn-script-repair-broken"
            onClick={handleRepairEpisodeBroken}
            disabled={isRepairingEpisode || brokenScan.totalBrokenCount === 0}
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: 8,
              background: isRepairingEpisode
                ? 'rgba(56, 189, 248, 0.16)'
                : 'linear-gradient(135deg, rgba(251, 113, 133, 0.2) 0%, rgba(245, 158, 11, 0.28) 100%)',
              border: isRepairingEpisode
                ? '1px solid rgba(56, 189, 248, 0.55)'
                : '1px solid rgba(251, 146, 60, 0.65)',
              color: isRepairingEpisode ? '#7DD3FC' : '#FDBA74',
              fontSize: '0.73rem',
              fontWeight: 800,
              cursor: isRepairingEpisode ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
            }}
            title={`អត្ថបទខូច: ${brokenScan.textBrokenCount} ឃ្លា • សំឡេងខ្វះ: ${brokenScan.voiceBrokenCount} ឃ្លា`}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {isRepairingEpisode ? (
                <Loader2 size={13} className="animate-spin" color="#38BDF8" />
              ) : (
                <Wrench size={13} color="#FB923C" />
              )}
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isRepairingEpisode
                  ? 'កំពុងជួសជុលឃ្លាខូច & Generate សំឡេង...'
                  : `🔧 ជួសជុលឃ្លាខូច & Generate ឡើងវិញ (${brokenScan.totalBrokenCount})`}
              </span>
            </span>
            <span style={{
              fontSize: '0.62rem',
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 9999,
              background: 'rgba(0, 0, 0, 0.25)',
              flexShrink: 0,
            }}>
              អត្ថបទ {brokenScan.textBrokenCount} • សំឡេង {brokenScan.voiceBrokenCount}
            </span>
          </button>
        </div>
      )}

      {repairStatusBanner && (
        <div
          data-testid="script-repair-status-banner"
          style={{
            marginBottom: 8,
            padding: '6px 9px',
            borderRadius: 7,
            fontSize: '0.71rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            flexShrink: 0,
            background: repairStatusBanner.type === 'success'
              ? 'rgba(16, 185, 129, 0.15)'
              : repairStatusBanner.type === 'partial'
              ? 'rgba(245, 158, 11, 0.16)'
              : 'rgba(239, 68, 68, 0.15)',
            border: repairStatusBanner.type === 'success'
              ? '1px solid rgba(52, 211, 153, 0.45)'
              : repairStatusBanner.type === 'partial'
              ? '1px solid rgba(245, 158, 11, 0.45)'
              : '1px solid rgba(239, 68, 68, 0.45)',
            color: repairStatusBanner.type === 'success'
              ? '#6EE7B7'
              : repairStatusBanner.type === 'partial'
              ? '#FDE68A'
              : '#FCA5A5',
          }}
        >
          <span>{repairStatusBanner.text}</span>
          <button
            type="button"
            onClick={() => setRepairStatusBanner(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 1 }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
          Segments ({scriptData?.segments?.length || 0})
        </span>

        {/* Filter Chips: ទាំងអស់ / ប្រុស / ស្រី / ឃ្លាខូច */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            style={{
              padding: '2px 8px',
              fontSize: '0.70rem',
              borderRadius: 4,
              border: '1px solid',
              borderColor: filterMode === 'all' ? 'var(--primary-accent, #6366f1)' : 'rgba(255, 255, 255, 0.12)',
              background: filterMode === 'all' ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
              color: filterMode === 'all' ? '#fff' : 'var(--text-dim)',
              cursor: 'pointer',
              fontWeight: filterMode === 'all' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>ទាំងអស់</span>
            <span style={{ opacity: 0.75, fontSize: '0.64rem' }}>({filteredSegments.length})</span>
          </button>

          {[
            { mode: 'male', icon: <User size={11} strokeWidth={2.4} />, label: 'ប្រុស', count: voiceGenderCounts.male, tone: '56, 189, 248', text: '#7dd3fc' },
            { mode: 'female', icon: <UserCheck size={11} strokeWidth={2.4} />, label: 'ស្រី', count: voiceGenderCounts.female, tone: '244, 114, 182', text: '#f9a8d4' },
          ].map((pill) => {
            const active = filterMode === pill.mode;
            return (
              <button
                key={pill.mode}
                type="button"
                data-testid={`script-filter-${pill.mode}`}
                aria-pressed={active}
                onClick={() => setFilterMode(active ? 'all' : pill.mode)}
                style={{
                  padding: '2px 8px',
                  fontSize: '0.70rem',
                  borderRadius: 4,
                  border: '1px solid',
                  borderColor: active ? `rgba(${pill.tone}, 0.7)` : 'rgba(255, 255, 255, 0.12)',
                  background: active ? `rgba(${pill.tone}, 0.18)` : 'transparent',
                  color: active ? pill.text : 'var(--text-dim)',
                  cursor: 'pointer',
                  fontWeight: active ? 700 : 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title={`បង្ហាញតែឃ្លាសំឡេង${pill.label}`}
              >
                <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>{pill.icon}</span>
                <span>{pill.label}</span>
                <span style={{ opacity: 0.75, fontSize: '0.64rem', fontVariantNumeric: 'tabular-nums' }}>({pill.count})</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setFilterMode('missing')}
            style={{
              padding: '2px 8px',
              fontSize: '0.70rem',
              borderRadius: 4,
              border: '1px solid',
              borderColor: filterMode === 'missing' ? '#ef4444' : (missingTextCount > 0 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.12)'),
              background: filterMode === 'missing' ? 'rgba(239, 68, 68, 0.25)' : (missingTextCount > 0 ? 'rgba(239, 68, 68, 0.08)' : 'transparent'),
              color: filterMode === 'missing' ? '#fca5a5' : (missingTextCount > 0 ? '#ef4444' : 'var(--text-dim)'),
              cursor: 'pointer',
              fontWeight: filterMode === 'missing' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="បង្ហាញតែឃ្លាខូច ឬខ្វះសំឡេង (Broken text / missing voice)"
          >
            <AlertCircle size={10} />
            <span>ឃ្លាខូច/ខ្វះសំឡេង</span>
            <span
              style={{
                fontSize: '0.64rem',
                background: missingTextCount > 0 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(255, 255, 255, 0.1)',
                padding: '0 4px',
                borderRadius: 8,
                fontWeight: 700,
              }}
            >
              {missingTextCount}
            </span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      {scriptData?.segments && scriptData.segments.length > 3 && (
        <div style={{ position: 'relative', marginBottom: 10, flexShrink: 0 }}>
          <Search size={13} color="var(--text-dim)" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            type="text"
            aria-label="Search segments by number, dialogue, or speaker"
            placeholder="Search #37, dialogue, or speaker..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && displayedSegments.length > 0 && onSelectSegment) {
                e.preventDefault();
                const firstSeg = displayedSegments[0];
                const resolvedIdx = resolveOriginalSegmentIndex(scriptData?.segments, firstSeg, 0);
                const segKey = firstSeg._uid || (firstSeg.id !== undefined && firstSeg.id !== null ? firstSeg.id : resolvedIdx);
                onSelectSegment(segKey, firstSeg, resolvedIdx);
              }
            }}
            className="capcut-input"
            style={{ paddingLeft: 26, paddingRight: searchQuery ? 26 : 10, fontSize: '0.76rem', height: 28 }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              title="Clear search"
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                padding: 2,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={12} />
            </button>
          )}
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
        {displayedSegments.length > 0 ? (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const seg = displayedSegments[virtualRow.index];
              if (!seg) return null;

              const targetIdx = resolveOriginalSegmentIndex(scriptData?.segments, seg, virtualRow.index);

              const isSelected = Boolean(
                selectedSegmentId !== null && (
                  (seg._uid && String(selectedSegmentId) === String(seg._uid)) ||
                  (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === targetIdx)
                )
              );
              const isPlaying = Boolean(playingSegmentId === (seg.id || targetIdx));

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
                    idx={targetIdx}
                    repeatedJunkSet={repeatedJunkSet}
                    isSelected={isSelected}
                    isPlaying={isPlaying}
                    onSelectSegment={onSelectSegment}
                    handleSegmentChange={handleSegmentChange}
                    handleSegmentBlur={handleSegmentBlur}
                    handlePlayLine={handlePlayLine}
                    onRegenerateSegment={onRegenerateSegment}
                    onTranslateSegment={onTranslateSegment}
                    handleDeleteSegment={handleDeleteSegment}
                    onToggleDeliveryType={onToggleDeliveryType}
                  />
                </div>
              );
            })}
          </div>
        ) : filterMode === 'missing' ? (
          <div style={{ textAlign: 'center', padding: '30px 15px', color: 'var(--text-muted)', border: '1px dashed rgba(34, 197, 94, 0.3)', borderRadius: 'var(--radius-sm)', background: 'rgba(34, 197, 94, 0.04)' }}>
            <CheckCircle2 size={28} color="#22c55e" style={{ margin: '0 auto 10px', display: 'block' }} />
            <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#4ade80', marginBottom: 4 }}>
              គ្មានឃ្លាណាដែលខ្វះអត្ថបទទេ
            </div>
            <p style={{ fontSize: '0.76rem', margin: 0, color: 'var(--text-dim)' }}>
              គ្រប់ឃ្លាទាំងអស់មានអត្ថបទខ្មែររួចរាល់ហើយ! (All segments have Khmer text)
            </p>
          </div>
        ) : (filterMode === 'male' || filterMode === 'female') ? (
          <div style={{ textAlign: 'center', padding: '24px 15px', color: 'var(--text-dim)', fontSize: '0.78rem', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            គ្មានឃ្លាសំឡេង{filterMode === 'female' ? 'ស្រី' : 'ប្រុស'}ទេ
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
