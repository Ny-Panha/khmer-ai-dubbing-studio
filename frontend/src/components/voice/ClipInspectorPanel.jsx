import { cleanKhmerText } from '../../utils/cleanKhmer';
import React, { useState } from 'react';
import {
  Mic, Edit3, Sparkles, Loader2, Scissors, CheckCircle2,
  Volume2, VolumeX, RefreshCw, Trash2, AlertCircle, Pause,
  Copy, Check
} from 'lucide-react';
import { isLongKhmerSubtitle } from '../../utils/khmerTextSplitter';
import { retranslateSegmentApi } from '../../services/api';

export default function ClipInspectorPanel({
  isOpen,
  onToggle,
  selectedSegment,
  selectedSegmentIndex,
  selectedClip,
  onSegmentTextChange,
  onSegmentTextBlur,
  onSingleRegen,
  regeneratingId,
  regenStatus,
  onSplitSegment,
  onClipVoiceChange,
  onClipSpeedChange,
  settings,
  playingSegmentId,
  onPlaySegmentAudio,
  onDeleteSegment,
  currentTime,
  onSplitClip,
  onDeleteClip,
  scriptData,
  onSelectSegment,
  autoplayBlocked = false,
  playbackError = null,
  onToggleMuteSegment = null,
  onToggleMuteVideoClip = null,
  onToggleMuteAllCuts = null,
  videoClips = [],
  onUpdateSpeakerVoice = null,
  onAutoSplitSegment = null,
  onToggleDeliveryType = null,
  onSegmentChineseChange = null,
}) {
  const [copiedChinese, setCopiedChinese] = useState(false);
  const [isRetranslating, setIsRetranslating] = useState(false);
  const [retranslateData, setRetranslateData] = useState(null);
  const retranslateCacheRef = React.useRef({});

  const originalChinese = selectedSegment?.originalChineseText || selectedSegment?.chineseText || selectedSegment?.originalText || selectedSegment?.original || selectedSegment?.chinese || '';
  const khmerText = selectedSegment?.khmerTranslatedText || selectedSegment?.khmer || selectedSegment?.khmerText || '';
  const currentSegKey = selectedSegment ? String(selectedSegment.id ?? selectedSegmentIndex) : '';

  // Local Chinese state with debouncing for direct editing
  const [localChineseText, setLocalChineseText] = useState(originalChinese);
  const localChineseTextRef = React.useRef(originalChinese);
  localChineseTextRef.current = localChineseText;
  const chineseDebounceTimerRef = React.useRef(null);
  const lastCommittedChineseRef = React.useRef(originalChinese);
  const prevPropChineseTextRef = React.useRef(originalChinese);
  const onSegmentChineseChangeRef = React.useRef(onSegmentChineseChange);
  onSegmentChineseChangeRef.current = onSegmentChineseChange;

  // Local text state with debouncing: typing updates in <1ms without re-rendering all segments across the app!
  const [localKhmerText, setLocalKhmerText] = useState(khmerText);
  const debounceTimerRef = React.useRef(null);
  const lastCommittedTextRef = React.useRef(khmerText);
  const localKhmerTextRef = React.useRef(khmerText);
  localKhmerTextRef.current = localKhmerText;
  const prevPropKhmerTextRef = React.useRef(khmerText);

  const onSegmentTextChangeRef = React.useRef(onSegmentTextChange);
  onSegmentTextChangeRef.current = onSegmentTextChange;
  const selectedSegmentIndexRef = React.useRef(selectedSegmentIndex);
  selectedSegmentIndexRef.current = selectedSegmentIndex;

  // Flush any pending debounce commit immediately to prevent data loss on unmount or segment switch
  const flushPendingCommit = React.useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      if (localKhmerTextRef.current !== lastCommittedTextRef.current && onSegmentTextChangeRef.current) {
        lastCommittedTextRef.current = localKhmerTextRef.current;
        onSegmentTextChangeRef.current(selectedSegmentIndexRef.current, localKhmerTextRef.current);
      }
    }
    if (chineseDebounceTimerRef.current) {
      clearTimeout(chineseDebounceTimerRef.current);
      chineseDebounceTimerRef.current = null;
      if (localChineseTextRef.current !== lastCommittedChineseRef.current && onSegmentChineseChangeRef.current) {
        lastCommittedChineseRef.current = localChineseTextRef.current;
        onSegmentChineseChangeRef.current(selectedSegmentIndexRef.current, localChineseTextRef.current);
      }
    }
  }, []);

  React.useEffect(() => {
    // Flush pending changes of previous segment before switching to new segment
    flushPendingCommit();
    if (selectedSegment) {
      setLocalKhmerText(khmerText);
      localKhmerTextRef.current = khmerText;
      lastCommittedTextRef.current = khmerText;
      prevPropKhmerTextRef.current = khmerText;

      setLocalChineseText(originalChinese);
      localChineseTextRef.current = originalChinese;
      lastCommittedChineseRef.current = originalChinese;
      prevPropChineseTextRef.current = originalChinese;

      setRetranslateData(retranslateCacheRef.current[currentSegKey] || null);
    }
  }, [currentSegKey, flushPendingCommit]);

  // Flush pending changes on unmount (e.g. Inspector unmounting when playhead enters a gap)
  React.useEffect(() => {
    return () => {
      flushPendingCommit();
    };
  }, [flushPendingCommit]);

  React.useEffect(() => {
    // Only sync if the prop actually changed from an external source and user is not actively typing
    if (selectedSegment && khmerText !== prevPropKhmerTextRef.current) {
      prevPropKhmerTextRef.current = khmerText;
      if (!debounceTimerRef.current && localKhmerTextRef.current === lastCommittedTextRef.current) {
        setLocalKhmerText(khmerText);
        localKhmerTextRef.current = khmerText;
        lastCommittedTextRef.current = khmerText;
      }
    }
    if (selectedSegment && originalChinese !== prevPropChineseTextRef.current) {
      prevPropChineseTextRef.current = originalChinese;
      if (!chineseDebounceTimerRef.current && localChineseTextRef.current === lastCommittedChineseRef.current) {
        setLocalChineseText(originalChinese);
        localChineseTextRef.current = originalChinese;
        lastCommittedChineseRef.current = originalChinese;
      }
    }
  }, [khmerText, originalChinese, currentSegKey]);

  // Find corresponding video clip for this segment
  const associatedClip = React.useMemo(() => {
    if (!videoClips || videoClips.length === 0) return selectedClip || null;
    if (selectedSegment) {
      const segId = selectedSegment.id ?? selectedSegmentIndex;
      return videoClips.find((c) => c.segmentId === segId || c.segmentIndex === segId) || selectedClip || null;
    }
    return selectedClip || null;
  }, [videoClips, selectedSegment, selectedClip, selectedSegmentIndex]);

  // Standalone Video Clip Inspector (e.g. for Gap or uncut video clips)
  if (!selectedSegment && selectedClip) {
    const isClipMuted = Boolean(selectedClip.isMuted);
    const startSec = Number(selectedClip.start) || 0;
    const endSec = Number(selectedClip.end) || 0;
    const durSec = Math.max(0, endSec - startSec);

    return (
      <div className="clip-inspector-section" style={{ marginBottom: 12, border: '1px solid rgba(0, 229, 255, 0.25)', borderRadius: 8, background: 'rgba(15, 23, 42, 0.7)', overflow: 'hidden' }}>
        <div
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'linear-gradient(90deg, rgba(13, 56, 68, 0.8) 0%, rgba(6, 34, 43, 0.6) 100%)',
            cursor: 'pointer',
            borderBottom: '1px solid rgba(0, 229, 255, 0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e0f2fe' }}>
              🎬 Video Clip: {selectedClip.name || 'Clip'}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)', background: 'rgba(0, 229, 255, 0.12)', padding: '2px 6px', borderRadius: 4 }}>
              {durSec.toFixed(2)}s
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isOpen ? '▲ បង្រួម' : '▼ ពង្រីក'}</span>
        </div>

        {isOpen && (
          <div style={{ padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                ចន្លោះម៉ោង៖ {startSec.toFixed(2)}s - {endSec.toFixed(2)}s
              </span>
              {onToggleMuteVideoClip && (
                <button
                  type="button"
                  onClick={() => onToggleMuteVideoClip(selectedClip.id)}
                  title={isClipMuted ? "បានបិទសំឡេងដើម (Muted) - ចុចដើម្បីបើកវិញ" : "ចុចដើម្បីបិទសំឡេងវីដេអូដើម (Mute Original Audio)"}
                  style={{
                    padding: '6px 14px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    borderRadius: 5,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    border: `1px solid ${isClipMuted ? '#ef4444' : 'var(--accent-cyan)'}`,
                    background: isClipMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(0, 229, 255, 0.12)',
                    color: isClipMuted ? '#f87171' : 'var(--accent-cyan)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isClipMuted ? (
                    <>
                      <VolumeX size={14} color="#f87171" />
                      <span>🔇 បានបិទសំឡេងដើម (Muted)</span>
                    </>
                  ) : (
                    <>
                      <Volume2 size={14} color="var(--accent-cyan)" />
                      <span>🎬 បិទសំឡេងដើម (Mute Video Audio)</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {onSplitClip && (
                <button
                  type="button"
                  onClick={() => onSplitClip(currentTime)}
                  className="btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <Scissors size={13} /> កាត់ត្រង់ Playhead
                </button>
              )}
              {onDeleteClip && (
                <button
                  type="button"
                  onClick={() => onDeleteClip(selectedClip.id)}
                  className="btn-danger"
                  style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <Trash2 size={13} /> លុប Clip នេះ
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!selectedSegment) {
    return null;
  }

  const isGenerating = regeneratingId === (selectedSegment.id || selectedSegmentIndex) || regenStatus === 'generating' || selectedSegment.textStatus === 'generating';
  const isVoiceUpdated = !isGenerating && (regenStatus === 'voice_updated' || (selectedSegment.textStatus === 'voice_updated' && regenStatus !== 'error'));
  const isError = !isGenerating && !isVoiceUpdated && (regenStatus === 'error' || (selectedSegment.textStatus === 'error' && !selectedSegment.audioUrl));
  const isTextUpdated = !isGenerating && !isVoiceUpdated && !isError && (regenStatus === 'text_updated' || selectedSegment.audioOutdated || selectedSegment.textStatus === 'text_updated');

  const commitTextChange = (textToCommit) => {
    if (textToCommit === lastCommittedTextRef.current) return;
    lastCommittedTextRef.current = textToCommit;
    if (onSegmentTextChange) {
      onSegmentTextChange(selectedSegmentIndex, textToCommit);
    }
  };

  const handleChineseTextChange = (e) => {
    const val = e.target.value;
    setLocalChineseText(val);
    localChineseTextRef.current = val;
    if (chineseDebounceTimerRef.current) {
      clearTimeout(chineseDebounceTimerRef.current);
    }
    chineseDebounceTimerRef.current = setTimeout(() => {
      chineseDebounceTimerRef.current = null;
      lastCommittedChineseRef.current = val;
      if (onSegmentChineseChangeRef.current) {
        onSegmentChineseChangeRef.current(selectedSegmentIndexRef.current, val);
      }
    }, 350);
  };

  const handleChineseTextBlur = (e) => {
    if (chineseDebounceTimerRef.current) {
      clearTimeout(chineseDebounceTimerRef.current);
      chineseDebounceTimerRef.current = null;
    }
    const val = e.target.value;
    if (val !== lastCommittedChineseRef.current && onSegmentChineseChangeRef.current) {
      lastCommittedChineseRef.current = val;
      onSegmentChineseChangeRef.current(selectedSegmentIndexRef.current, val);
    }
  };

  const handleKhmerTextChange = (e) => {
    const val = e.target.value;
    setLocalKhmerText(val);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      commitTextChange(val);
    }, 350);
  };

  const handleKhmerTextBlur = (e) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const val = e.target.value;
    commitTextChange(val);
    if (onSegmentTextBlur) {
      onSegmentTextBlur(selectedSegmentIndex, val);
    }
  };

  // ✨ AI In-App Re-Translation handler (1-Click classical drama options)
  const handleAiRetranslate = async () => {
    const textToTranslate = (localChineseText || originalChinese || '').trim();
    if (!textToTranslate || isRetranslating) return;
    setIsRetranslating(true);
    try {
      const res = await retranslateSegmentApi(textToTranslate, {
        speaker: selectedSegment?.speaker,
        gender: selectedSegment?.gender || selectedSegment?.speakerGender,
      });
      if (res && Array.isArray(res.options)) {
        const sanitizedRes = {
          ...res,
          note: cleanKhmerText(res.note),
          options: res.options.map((opt) => ({ ...opt, text: cleanKhmerText(opt.text) })),
        };
        setRetranslateData(sanitizedRes);
        retranslateCacheRef.current[currentSegKey] = sanitizedRes;
      }
    } catch (err) {
      console.error('AI Re-translation failed:', err);
    } finally {
      setIsRetranslating(false);
    }
  };

  // 1-Click apply AI translation option directly to text & auto-regen speech
  const handleApplyOption = (newText) => {
    const cleanText = cleanKhmerText(newText);
    if (!cleanText) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (selectedSegment) {
      delete selectedSegment.regenError;
      if (selectedSegment.textStatus === 'error') {
        selectedSegment.textStatus = 'generating';
      }
    }
    setLocalKhmerText(cleanText);
    localKhmerTextRef.current = cleanText;
    lastCommittedTextRef.current = cleanText;
    prevPropKhmerTextRef.current = cleanText;
    if (onSegmentTextChange) {
      onSegmentTextChange(selectedSegmentIndex, cleanText);
    }
    if (onSingleRegen && selectedSegment) {
      onSingleRegen(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex, cleanText);
    }
  };

  const handleCopyChinese = () => {
    const textToCopy = (localChineseText || originalChinese || '').trim();
    if (textToCopy) {
      navigator.clipboard?.writeText(textToCopy);
      setCopiedChinese(true);
      setTimeout(() => setCopiedChinese(false), 2000);
    }
  };

  // Speaker and Gender Details
  const speakerId = selectedSegment.speakerId || 'spk_0';
  const speakerName = cleanKhmerText(selectedSegment.speakerName || selectedSegment.speaker || speakerId);
  const rawGender = (selectedSegment.voiceGender || selectedSegment.speakerGender || 'unknown').toLowerCase();
  const detectedGender = rawGender.includes('fem') ? 'female' : (rawGender.includes('male') ? 'male' : 'unknown');
  const genderConfidence = typeof selectedSegment.genderConfidence === 'number'
    ? Math.round(selectedSegment.genderConfidence * 100)
    : null;

  const segVoiceId = selectedSegment.khmerVoiceId || selectedSegment.voiceId || '';
  const isThought = selectedSegment.deliveryType === 'inner_thought';
  const isPisethActive = segVoiceId.includes('Piseth') || (!segVoiceId.includes('Sreymom') && detectedGender !== 'female');
  const isSreymomActive = segVoiceId.includes('Sreymom') || (!segVoiceId.includes('Piseth') && detectedGender === 'female');
  const effectiveVoiceId = isSreymomActive ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';

  return (
    <div className="inspector-card-group">
      <div style={{
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: '#161922',
          borderRadius: 6,
          padding: '10px',
        }}>

          {/* Dialogue & Translation Card (Chinese Source + Khmer Target) */}
          <div style={{
            marginBottom: 10,
            padding: '8px 10px',
            background: 'rgba(20, 20, 30, 0.65)',
            borderRadius: 6,
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            {/* 1. Chinese Original Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '1px 5px', borderRadius: 3, fontSize: '0.62rem', fontWeight: 800 }}>CN</span>
                <span>អត្ថបទដើមចិន (Original):</span>
              </label>
              {(localChineseText || originalChinese) && (
                <button
                  type="button"
                  onClick={handleCopyChinese}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 4,
                    color: copiedChinese ? '#4ade80' : 'var(--text-dim)',
                    cursor: 'pointer',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '2px 6px',
                    transition: 'all 0.15s ease',
                  }}
                  title="Copy Chinese dialogue text"
                >
                  {copiedChinese ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copiedChinese ? 'Copied' : 'Copy'}</span>
                </button>
              )}
            </div>
            <textarea
              rows={2}
              value={localChineseText}
              onChange={handleChineseTextChange}
              onBlur={handleChineseTextBlur}
              placeholder="បញ្ចូល ឬកែសម្រួលអត្ថបទដើមចិននៅទីនេះ..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontSize: '0.86rem',
                color: '#f3f4f6',
                lineHeight: 1.5,
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                outline: 'none',
                resize: 'vertical',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif',
                transition: 'all 0.2s ease',
              }}
            />

            {/* AI Re-Translation Action Button (Clean, 1-Line, Never Squished) */}
            {(localChineseText || originalChinese) && (
              <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={handleAiRetranslate}
                  disabled={isRetranslating}
                  style={{
                    background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.28), rgba(139, 92, 246, 0.18))',
                    border: '1px solid rgba(168, 85, 247, 0.55)',
                    borderRadius: 4,
                    color: '#d8b4fe',
                    cursor: isRetranslating ? 'wait' : 'pointer',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                  title="✨ AI Re-Translate: ឱ្យ AI បកប្រែជាភាសាកុនបុរាណ ៣ ជម្រើសភ្លាមៗ"
                >
                  {isRetranslating ? <Loader2 size={11} className="spin animate-spin" /> : <Sparkles size={11} color="#d8b4fe" />}
                  <span>{isRetranslating ? 'កំពុងគិត...' : '✨ AI កែប្រែ (Re-Translate)'}</span>
                </button>
              </div>
            )}

            {/* Subtle Gradient Divider between Chinese Source & Khmer Target */}
            <div style={{
              height: 1,
              background: 'linear-gradient(90deg, rgba(56, 189, 248, 0.25) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(56, 189, 248, 0.25) 100%)',
              margin: '10px 0'
            }} />

            {/* 2. Khmer Translation Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '1px 5px', borderRadius: 3, fontSize: '0.62rem', fontWeight: 800 }}>KH</span>
                <span>អត្ថបទបកប្រែខ្មែរ (Translation):</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isGenerating && (
                  <span style={{ fontSize: '0.66rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.18)', border: '1px solid rgba(56, 189, 248, 0.45)', padding: '2px 7px', borderRadius: 4, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Loader2 size={11} className="animate-spin" />
                    <span>Generating Khmer Voice...</span>
                  </span>
                )}

                {isVoiceUpdated && (
                  <span style={{ fontSize: '0.66rem', color: '#4ade80', background: 'rgba(34, 197, 94, 0.18)', border: '1px solid rgba(34, 197, 94, 0.45)', padding: '2px 7px', borderRadius: 4, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={11} />
                    <span>Voice Updated</span>
                  </span>
                )}

                {isError && (
                  <span style={{ fontSize: '0.66rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.18)', border: '1px solid rgba(239, 68, 68, 0.45)', padding: '2px 7px', borderRadius: 4, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <AlertCircle size={11} />
                    <span>Error</span>
                  </span>
                )}

                {isTextUpdated && (
                  <span style={{ fontSize: '0.66rem', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.18)', border: '1px solid rgba(245, 158, 11, 0.45)', padding: '2px 7px', borderRadius: 4, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Edit3 size={11} />
                    <span>Text Updated</span>
                  </span>
                )}
              </div>
            </div>
                <textarea
                  rows={3}
                  value={localKhmerText}
                  onChange={handleKhmerTextChange}
                  onBlur={handleKhmerTextBlur}
                  placeholder="បញ្ចូល ឬកែសម្រួលអត្ថបទភាសាខ្មែរនៅទីនេះ..."
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    fontSize: '0.84rem',
                    color: '#ffffff',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: isGenerating
                      ? '1px solid #38bdf8'
                      : (isError ? '1px solid #ef4444' : (isVoiceUpdated ? '1px solid #22c55e' : (isTextUpdated ? '1px solid rgba(245, 158, 11, 0.65)' : '1px solid rgba(255, 255, 255, 0.08)'))),
                    boxShadow: isGenerating
                      ? '0 0 10px rgba(56, 189, 248, 0.25)'
                      : (isVoiceUpdated ? '0 0 8px rgba(34, 197, 94, 0.25)' : 'none'),
                    borderRadius: 4,
                    padding: '6px 8px',
                    lineHeight: 1.5,
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'var(--font-khmer), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    transition: 'all 0.2s ease',
                  }}
                />

                {/* ✨ AI Re-Translation Suggestion Chips (Classical Cinema Options) */}
                {retranslateData?.options && retranslateData.options.length > 0 && (
                  <div style={{
                    marginTop: 8,
                    marginBottom: 6,
                    padding: '8px 10px',
                    background: 'rgba(24, 20, 36, 0.95)',
                    border: '1px solid rgba(168, 85, 247, 0.45)',
                    borderRadius: 6,
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#d8b4fe', fontWeight: 700 }}>
                        <Sparkles size={12} color="#c084fc" />
                        <span>ជម្រើសបកប្រែដោយ AI (ចុចលើមួយណា យកមួយនោះភ្លាម)៖</span>
                      </div>
                      {retranslateData.note && (
                        <span style={{ fontSize: '0.68rem', color: '#cbd5e1', fontStyle: 'italic', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                          💡 {retranslateData.note}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {retranslateData.options.map((opt, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleApplyOption(opt.text)}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            padding: '6px 8px',
                            background: 'rgba(30, 26, 46, 0.85)',
                            border: '1px solid rgba(168, 85, 247, 0.25)',
                            borderRadius: 4,
                            color: '#f1f5f9',
                            fontSize: '0.78rem',
                            textAlign: 'left',
                            cursor: 'pointer',
                            lineHeight: 1.5,
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(168, 85, 247, 0.25)';
                            e.currentTarget.style.borderColor = '#c084fc';
                            e.currentTarget.style.transform = 'translateX(2px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(30, 26, 46, 0.85)';
                            e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.25)';
                            e.currentTarget.style.transform = 'none';
                          }}
                          title="ចុចដើម្បីជ្រើសរើសឃ្លានេះ និងបង្កើតសំឡេងថ្មីដោយស្វ័យប្រវត្តិ"
                        >
                          <span style={{
                            flexShrink: 0,
                            fontSize: '0.66rem',
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: opt.style === 'classical' ? 'rgba(59, 130, 246, 0.3)' : (opt.style === 'dramatic' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'),
                            color: opt.style === 'classical' ? '#93c5fd' : (opt.style === 'dramatic' ? '#fca5a5' : '#6ee7b7'),
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            fontWeight: 700,
                          }}>
                            {opt.label}
                          </span>
                          <span style={{ flex: 1 }}>{cleanKhmerText(opt.text)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}


                {/* Missing / Review translation alert */}
                {(!khmerText && originalChinese) && (
                  <div style={{
                    marginTop: 6,
                    padding: '5px 8px',
                    background: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    borderRadius: 5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.72rem',
                    color: '#fbbf24'
                  }}>
                    <AlertCircle size={12} color="#fbbf24" style={{ flexShrink: 0 }} />
                    <span>ឃ្លានេះត្រូវការពិនិត្យ (Missing Khmer translation) — សូមបំពេញការបកប្រែជាភាសាខ្មែរខាងលើ!</span>
                  </div>
                )}

                {/* Error Banner with Retry Button */}
                {isError && (
                  <div style={{
                    marginTop: 6,
                    padding: '6px 10px',
                    background: 'rgba(239, 68, 68, 0.14)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: 5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6
                  }}>
                    <span style={{ fontSize: '0.72rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertCircle size={12} color="#ef4444" />
                      <span>{selectedSegment.regenError ? `បរាជ័យ: ${selectedSegment.regenError}` : 'បរាជ័យក្នុងការបង្កើតសំឡេង!'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onSingleRegen(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex, localKhmerText)}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.7rem',
                        background: '#ef4444',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontWeight: 700,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      🔄 សាកល្បងម្ដងទៀត
                    </button>
                  </div>
                )}

                {/* Manual 1-click Regen Button when outdated or text edited */}
                {(selectedSegment.audioOutdated || isTextUpdated) && !isError && (
                  <button
                    type="button"
                    onClick={() => onSingleRegen(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex, localKhmerText)}
                    disabled={isGenerating}
                    style={{
                      marginTop: 6,
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: '0.72rem',
                      background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                      border: 'none',
                      borderRadius: 4,
                      color: '#ffffff',
                      cursor: 'pointer',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)'
                    }}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 size={12} className="pulse-glow" />
                        <span>Generating Khmer Voice...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} />
                        <span>🎙️ Generate សំឡេងតាមអត្ថបទដែលកែថ្មីនេះ</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              
              {/* Delivery Mode & Inner-Thought Toggle */}
              <div style={{
                marginBottom: 10,
                padding: '7px 9px',
                background: 'rgba(0, 0, 0, 0.25)',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.07)',
                transition: 'all 0.2s ease',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.70rem', color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{isThought ? '💭' : '🎙️'}</span>
                    <span>ទម្រង់នៃការនិយាយ (Delivery Type):</span>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {selectedSegment.deliveryOverride && (
                      <span style={{ fontSize: '0.60rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>
                        Manual
                      </span>
                    )}
                  </div>
                </div>

                {/* Sleek Segmented Switcher */}
                <div style={{ display: 'flex', gap: 4, background: 'rgba(255, 255, 255, 0.03)', padding: '2px', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.05)', marginBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() => onToggleDeliveryType && onToggleDeliveryType(selectedSegment.id || selectedSegmentIndex, 'out_loud', true, selectedSegmentIndex)}
                    disabled={isGenerating}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      fontSize: '0.70rem',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontWeight: !isThought ? 600 : 400,
                      border: !isThought ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
                      background: !isThought ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                      color: !isThought ? '#38bdf8' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      transition: 'all 0.15s ease',
                    }}
                    title="ប្តូរទៅជាការនិយាយសន្ទនាធម្មតា (Normal Speech without Reverb)"
                  >
                    <span>🔊 និយាយធម្មតា</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleDeliveryType && onToggleDeliveryType(selectedSegment.id || selectedSegmentIndex, 'inner_thought', true, selectedSegmentIndex)}
                    disabled={isGenerating}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      fontSize: '0.70rem',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontWeight: isThought ? 600 : 400,
                      border: isThought ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
                      background: isThought ? 'rgba(168, 85, 247, 0.18)' : 'transparent',
                      color: isThought ? '#d8b4fe' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      transition: 'all 0.15s ease',
                    }}
                    title="ប្តូរទៅជាការនិយាយក្នុងចិត្ត ដោយបន្ថែម Reverb Effect (Inner Thought Monologue)"
                  >
                    <span>💭 និយាយក្នុងចិត្ត</span>
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.64rem', color: isThought ? '#d8b4fe' : '#64748b' }}>
                  <span>
                    {isThought ? '✨ Reverb Active (aecho)' : '✨ Direct Voice Output'}
                  </span>
                  {selectedSegment.deliveryConfidence !== null && typeof selectedSegment.deliveryConfidence === 'number' && (
                    <span>Confidence: {Math.round(selectedSegment.deliveryConfidence * 100)}%</span>
                  )}
                </div>
              </div>

              {/* 4. Manual Voice Selection & Speaker Association */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                    ជ្រើសរើសសំឡេង Khmer Neural Voice:
                  </span>
                  {selectedSegment.voiceAssignmentSource === 'manual' && (
                    <span style={{ fontSize: '0.64rem', color: '#4ade80', fontWeight: 600 }}>
                      ✓ Manual Assigned
                    </span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      onClipVoiceChange(selectedSegment.id || selectedSegmentIndex, 'km-KH-PisethNeural', selectedSegmentIndex);
                    }}
                    disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex)}
                    style={{
                      padding: '8px 6px',
                      fontSize: '0.72rem',
                      borderRadius: 6,
                      border: `1.5px solid ${isPisethActive ? 'rgba(56, 189, 248, 0.7)' : 'rgba(255,255,255,0.08)'}`,
                      background: isPisethActive ? 'linear-gradient(135deg, rgba(2, 132, 199, 0.35), rgba(14, 165, 233, 0.2))' : 'rgba(255, 255, 255, 0.03)',
                      color: isPisethActive ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: isPisethActive ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      transition: 'all 0.15s ease',
                      boxShadow: isPisethActive ? '0 2px 8px rgba(56, 189, 248, 0.25)' : 'none'
                    }}
                    title="ប្តូរទៅសំឡេងប្រុស (Piseth Neural)"
                  >
                    <span>👨 ប្រុស</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClipVoiceChange(selectedSegment.id || selectedSegmentIndex, 'km-KH-SreymomNeural', selectedSegmentIndex);
                    }}
                    disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex)}
                    style={{
                      padding: '8px 6px',
                      fontSize: '0.72rem',
                      borderRadius: 6,
                      border: `1.5px solid ${isSreymomActive ? 'rgba(244, 114, 182, 0.8)' : 'rgba(255,255,255,0.08)'}`,
                      background: isSreymomActive ? 'linear-gradient(135deg, rgba(219, 39, 119, 0.38), rgba(244, 114, 182, 0.25))' : 'rgba(255, 255, 255, 0.03)',
                      color: isSreymomActive ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: isSreymomActive ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      transition: 'all 0.15s ease',
                      boxShadow: isSreymomActive ? '0 2px 8px rgba(244, 114, 182, 0.3)' : 'none'
                    }}
                    title="ប្តូរទៅសំឡេងស្រី (Sreymom Neural)"
                  >
                    <span>👩 ស្រី</span>
                  </button>
                </div>
              </div>

              {/* Speaker & Audio Status */}
              {(() => {
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.74rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {selectedSegment.audioUrl ? (
                          <span style={{ fontSize: '0.66rem', color: selectedSegment.audioOutdated ? 'var(--color-warning)' : 'var(--color-success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <CheckCircle2 size={11} /> {selectedSegment.audioOutdated ? 'អត្ថបទកែ (Outdated)' : 'Audio Ready'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-dim)' }}>Audio Pending</span>
                        )}
                      </div>

                      {/* Dual Mute / Unmute Controls: Video Original Audio & Khmer AI Voice */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {/* 1. Mute Original Video Audio Button */}
                        {onToggleMuteVideoClip && (associatedClip || selectedClip) && (
                          <button
                            type="button"
                            onClick={() => onToggleMuteVideoClip((associatedClip || selectedClip).id)}
                            title={(associatedClip || selectedClip).isMuted ? "បានបិទសំឡេងវីដេអូដើម (Muted) - ចុចដើម្បីបើកវិញ" : "ចុចដើម្បីបិទសំឡេងដើមនៃ Video Clip នេះ (Mute Original Audio)"}
                            style={{
                              padding: '4px 9px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              borderRadius: 4,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              border: `1px solid ${(associatedClip || selectedClip).isMuted ? 'rgba(239, 68, 68, 0.7)' : 'rgba(0, 229, 255, 0.4)'}`,
                              background: (associatedClip || selectedClip).isMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(0, 229, 255, 0.1)',
                              color: (associatedClip || selectedClip).isMuted ? '#f87171' : 'var(--accent-cyan)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {(associatedClip || selectedClip).isMuted ? (
                              <>
                                <VolumeX size={12} color="#f87171" />
                                <span>🔇 សំឡេងដើម (Muted)</span>
                              </>
                            ) : (
                              <>
                                <Volume2 size={12} color="var(--accent-cyan)" />
                                <span>🎬 សំឡេងដើម (Orig Audio)</span>
                              </>
                            )}
                          </button>
                        )}

                        {/* 1-Click: Mute All Cuts Shortcut */}
                        {onToggleMuteAllCuts && videoClips && videoClips.length > 1 && (() => {
                          const dialogueClips = videoClips.filter((c) => c.isDialogue);
                          const targetClips = dialogueClips.length > 0 ? dialogueClips : videoClips;
                          const areAllCutsMuted = targetClips.length > 0 && targetClips.every((c) => Boolean(c.isMuted));
                          return (
                            <button
                              type="button"
                              onClick={() => onToggleMuteAllCuts(true)}
                              title={areAllCutsMuted ? "ចុចដើម្បីបើកសំឡេងដើម Clip កាត់ទាំងអស់ឡើងវិញ" : "ចុចដើម្បីបិទសំឡេងដើម Clip កាត់ទាំងអស់ដោយ 1-Click"}
                              style={{
                                padding: '4px 9px',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                borderRadius: 4,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                border: '1px solid rgba(239, 68, 68, 0.45)',
                                background: areAllCutsMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.1)',
                                color: areAllCutsMuted ? '#fca5a5' : '#f87171',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {areAllCutsMuted ? <VolumeX size={12} color="#fca5a5" /> : <Volume2 size={12} color="#f87171" />}
                              <span>{areAllCutsMuted ? 'Unmute All Cuts' : '🔇 Mute All Cuts'}</span>
                            </button>
                          );
                        })()}

                        {/* 2. Single Clip Mute / Unmute Toggle (Khmer AI Voice) */}
                        {onToggleMuteSegment && (
                          <button
                            type="button"
                            onClick={() => onToggleMuteSegment(selectedSegment.id || selectedSegmentIndex)}
                            title={selectedSegment.muted ? "ចុចដើម្បីបើកសំឡេង AI ខ្មែរឡើងវិញ (Unmute Voice)" : "ចុចដើម្បីបិទសំឡេង AI ខ្មែរតែឃ្លានេះ (Mute Voice)"}
                            style={{
                              padding: '4px 9px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              borderRadius: 4,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              border: `1px solid ${selectedSegment.muted ? 'rgba(239, 68, 68, 0.7)' : 'rgba(255, 255, 255, 0.2)'}`,
                              background: selectedSegment.muted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                              color: selectedSegment.muted ? '#f87171' : 'var(--text-secondary)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {selectedSegment.muted ? (
                              <>
                                <VolumeX size={12} color="#f87171" />
                                <span>🔇 សំឡេង AI (Muted)</span>
                              </>
                            ) : (
                              <>
                                <Volume2 size={12} color="#38bdf8" />
                                <span>🔊 សំឡេង AI (Voice)</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Speaking Rate for this selected segment */}
                    {(() => {
                      const segSpeedNum = (() => {
                        if (typeof selectedSegment.speed === 'number') return selectedSegment.speed;
                        if (selectedSegment.speed === 'slow') return 0.75;
                        if (selectedSegment.speed === 'fast') return 1.25;
                        const parsed = parseFloat(selectedSegment.speed);
                        if (!isNaN(parsed) && parsed > 0) return parsed;
                        if (typeof settings?.speed === 'number') return settings.speed;
                        if (settings?.speed === 'slow') return 0.75;
                        if (settings?.speed === 'fast') return 1.25;
                        return 1.0;
                      })();

                      const getClipSpeedLabel = (spd) => {
                        if (spd <= 0.6) return 'យឺតខ្លាំង';
                        if (spd <= 0.85) return 'យឺត (Slow)';
                        if (spd <= 1.15) return 'ធម្មតា (Normal)';
                        if (spd <= 1.4) return 'លឿន (Fast)';
                        return 'ញាប់ (Rapid)';
                      };

                      const clipPresets = [
                        { label: '🐢 0.75x', val: 0.75 },
                        { label: '⚡ 1.0x', val: 1.0 },
                        { label: '🚀 1.25x', val: 1.25 },
                        { label: '🏎️ 1.5x', val: 1.5 },
                      ];

                      return (
                        <div style={{ marginBottom: 10, padding: '7px 9px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                              ល្បឿនឃ្លានេះ (Clip Speed):
                            </span>
                            <span style={{
                              fontSize: '0.68rem',
                              color: 'var(--accent-cyan, #38bdf8)',
                              background: 'rgba(56, 189, 248, 0.12)',
                              padding: '1px 7px',
                              borderRadius: 4,
                              fontWeight: 700
                            }}>
                              {segSpeedNum.toFixed(2)}x • {getClipSpeedLabel(segSpeedNum)}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontSize: '0.64rem', color: 'var(--text-dim)' }}>0.5x</span>
                            <input
                              type="range"
                              min="0.5"
                              max="2.0"
                              step="0.05"
                              value={segSpeedNum}
                              disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                onClipSpeedChange(selectedSegment.id || selectedSegmentIndex, val, selectedSegmentIndex);
                              }}
                              style={{
                                flex: 1,
                                cursor: 'pointer',
                                accentColor: 'var(--accent-cyan, #38bdf8)',
                                height: 4,
                              }}
                              title={`កែសម្រួលល្បឿនឃ្លានេះ: ${segSpeedNum.toFixed(2)}x`}
                            />
                            <span style={{ fontSize: '0.64rem', color: 'var(--text-dim)' }}>2.0x</span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                            {clipPresets.map((p) => {
                              const isMatch = Math.abs(segSpeedNum - p.val) < 0.03;
                              return (
                                <button
                                  key={p.val}
                                  type="button"
                                  disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex)}
                                  onClick={() => onClipSpeedChange(selectedSegment.id || selectedSegmentIndex, p.val, selectedSegmentIndex)}
                                  style={{
                                    padding: '3px 2px',
                                    fontSize: '0.65rem',
                                    borderRadius: 4,
                                    border: '1px solid',
                                    borderColor: isMatch ? 'var(--accent-cyan, #38bdf8)' : 'rgba(255,255,255,0.08)',
                                    background: isMatch ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255,255,255,0.03)',
                                    color: isMatch ? '#fff' : 'var(--text-muted)',
                                    cursor: 'pointer',
                                    fontWeight: isMatch ? 700 : 500,
                                    textAlign: 'center',
                                  }}
                                >
                                  {p.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}

              {/* Action Buttons: Listen & Regenerate */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {/* 1. Manual Play/Listen Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (selectedSegment.audioUrl && onPlaySegmentAudio) {
                      onPlaySegmentAudio(selectedSegment.audioUrl, selectedSegment.id || selectedSegmentIndex, true);
                    }
                  }}
                  disabled={!selectedSegment.audioUrl || isGenerating}
                  className={String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex) ? "btn-accent" : "btn-secondary"}
                  style={{
                    flex: 1,
                    minWidth: '110px',
                    padding: '7px 8px',
                    fontSize: '0.74rem',
                    justifyContent: 'center',
                    background: String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex)
                      ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                      : (autoplayBlocked ? 'rgba(234, 179, 8, 0.18)' : undefined),
                    borderColor: String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex)
                      ? '#34d399'
                      : (autoplayBlocked ? '#eab308' : undefined),
                    color: String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex)
                      ? '#ffffff'
                      : (autoplayBlocked ? '#fef08a' : undefined),
                    fontWeight: 600,
                  }}
                  title={selectedSegment.audioUrl ? "ចុចស្តាប់សំឡេងឃ្លានេះ (Play audio)" : "មិនទាន់មានសំឡេងសម្រាប់ឃ្លានេះទេ"}
                >
                  {String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex) ? (
                    <>
                      <Pause size={13} />
                      <span>កំពុងចាក់... (Pause)</span>
                    </>
                  ) : (
                    <>
                      <Volume2 size={13} color={autoplayBlocked ? "#facc15" : undefined} />
                      <span>ស្តាប់សំឡេង (Play)</span>
                    </>
                  )}
                </button>

                {/* 2. Regenerate Button */}
                <button
                  type="button"
                  onClick={() => onSingleRegen(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex, localKhmerText)}
                  disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex)}
                  className={selectedSegment.audioUrl ? "btn-secondary" : "btn-primary"}
                  style={{ flex: 1, minWidth: '110px', padding: '7px 8px', fontSize: '0.74rem', justifyContent: 'center' }}
                  title="Regenerate speech for this segment"
                >
                  {regeneratingId === (selectedSegment.id || selectedSegmentIndex) ? (
                    <>
                      <Loader2 size={13} className="pulse-glow" />
                      <span>កំពុងបង្កើត...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={13} />
                      <span>{selectedSegment.audioUrl ? 'Generate ឡើងវិញ' : 'Generate ឃ្លានេះ'}</span>
                    </>
                  )}
                </button>

                {/* 3. Split Segment at Playhead */}
                {onSplitClip && (
                  <button
                    type="button"
                    onClick={() => onSplitClip(currentTime, selectedSegment.id || selectedSegmentIndex)}
                    className="btn-secondary"
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.74rem',
                      justifyContent: 'center',
                      color: 'var(--accent-cyan, #38bdf8)',
                      borderColor: 'rgba(56, 189, 248, 0.35)',
                      background: 'rgba(56, 189, 248, 0.08)',
                    }}
                    title="កាត់ឃ្លានេះជាពីរត្រង់ Playhead (Split Segment at Playhead - Ctrl+B)"
                  >
                    <Scissors size={13} color="var(--accent-cyan)" />
                    <span>កាត់ឃ្លា (Split)</span>
                  </button>
                )}

                {/* 4. Delete Segment Button */}
                {onDeleteSegment && (
                  <button
                    type="button"
                    onClick={() => onDeleteSegment(selectedSegment._uid || (selectedSegment.id !== undefined && selectedSegment.id !== null ? selectedSegment.id : selectedSegmentIndex))}
                    className="btn-secondary"
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.74rem',
                      justifyContent: 'center',
                      color: '#f87171',
                      borderColor: 'rgba(239, 68, 68, 0.3)',
                      background: 'rgba(239, 68, 68, 0.08)'
                    }}
                    title="លុបឃ្លានេះចោល (Delete Segment)"
                  >
                    <Trash2 size={13} color="#f87171" />
                    <span>លុប</span>
                  </button>
                )}
              </div>

              {/* Autoplay Blocked Notification Banner */}
              {autoplayBlocked && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 4,
                  background: 'rgba(234, 179, 8, 0.12)',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  color: '#fef08a',
                  fontSize: '0.72rem',
                  marginTop: 6
                }}>
                  <AlertCircle size={13} color="#facc15" style={{ flexShrink: 0 }} />
                  <span>Browser រារាំង Auto-play — សូមចុចប៊ូតុង <strong>"ស្តាប់សំឡេង"</strong> ខាងលើដើម្បីចាក់!</span>
                </div>
              )}

              {/* Audio Playback Error Notification Banner */}
              {playbackError && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 4,
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  fontSize: '0.72rem',
                  marginTop: 6
                }}>
                  <AlertCircle size={13} color="#f87171" style={{ flexShrink: 0 }} />
                  <span>Audio Error: {playbackError}</span>
                </div>
              )}
      </div>
    </div>
  );
}
