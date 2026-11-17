import { cleanKhmerText } from '../../utils/cleanKhmer';
import React, { useState } from 'react';
import {
  Mic, Edit3, Sparkles, Loader2, Scissors, CheckCircle2,
  Volume2, VolumeX, RefreshCw, Trash2, AlertCircle, Pause,
  Copy, Check, User, UserCheck, Play, Film, MessageSquare
} from 'lucide-react';
import { retranslateSegmentApi } from '../../services/api';

export default function ClipInspectorPanel({
  isOpen,
  onToggle,
  selectedSegment,
  selectedSegmentIndex,
  selectedClip,
  selectedClipKind = null,
  onSegmentTextChange,
  onSegmentTextBlur,
  onSingleRegen,
  onTranslateSegment,
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
  videoClips = [],
  onUpdateSpeakerVoice = null,
  onAutoSplitSegment = null,
  onToggleDeliveryType = null,
  onSegmentChineseChange = null,
}) {
  const [copiedChinese, setCopiedChinese] = useState(false);
  const [switchingVoiceTarget, setSwitchingVoiceTarget] = useState(null);
  const [isRetranslating, setIsRetranslating] = useState(false);
  const [retranslateData, setRetranslateData] = useState(null);
  const [retranslateError, setRetranslateError] = useState(null);
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
      setRetranslateError(null);
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

  // Video Clip Inspector: focused when selectedClipKind === 'video' or when only selectedClip is available
  const isVideoMode = selectedClipKind === 'video' || (!selectedSegment && Boolean(selectedClip));
  const targetVideoClip = selectedClip || associatedClip;

  if (isVideoMode && targetVideoClip) {
    const isClipMuted = Boolean(targetVideoClip.isMuted);
    const startSec = Number(targetVideoClip.start) || 0;
    const endSec = Number(targetVideoClip.end) || 0;
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
            <Film size={14} color="#38bdf8" />
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e0f2fe' }}>
              Video Clip: {targetVideoClip.name || 'Clip'}
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
                  onClick={() => onToggleMuteVideoClip(targetVideoClip.id)}
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
                      <span>បានបិទសំឡេង (Muted)</span>
                    </>
                  ) : (
                    <>
                      <Volume2 size={14} color="var(--accent-cyan)" />
                      <span>បិទសំឡេងដើម</span>
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
                  onClick={() => onDeleteClip(targetVideoClip.id)}
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

  const isKhmerEmpty = !localKhmerText?.trim();
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

  const formatRetranslateUiError = (err) => {
    const rawMsg = String(err?.message || err || 'បរាជ័យក្នុងការបកប្រែឡើងវិញ');
    if (err?.status === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(rawMsg)) {
      return rawMsg.includes('Gemini API Quota')
        ? rawMsg
        : 'Gemini API Quota ពេញហើយ (429) — សូមរង់ចាំបន្តិច ឬពិនិត្យ API Key ក្នុង Settings។';
    }
    if (err?.status === 401 || err?.status === 403) {
      return rawMsg.includes('Gemini API Key')
        ? rawMsg
        : 'Gemini API Key មិនត្រឹមត្រូវ ឬអស់សុពលភាព (401/403)។';
    }
    return rawMsg;
  };

  // ✨ AI In-App Re-Translation handler (1-Click classical drama options)
  const handleAiRetranslate = async () => {
    const textToTranslate = (localChineseText || originalChinese || '').trim();
    if (!textToTranslate || isRetranslating) return;
    setIsRetranslating(true);
    setRetranslateError(null);
    try {
      // Context enrichment: previous translation + surrounding dialogue context
      const previousTranslation = (localKhmerText || selectedSegment?.khmerText || selectedSegment?.khmerTranslatedText || selectedSegment?.khmer || '').trim();
      const allSegs = scriptData?.segments || [];
      const segIdx = allSegs.findIndex(s => s.id === selectedSegment?.id || s._uid === selectedSegment?._uid);
      let surroundingContext = '';
      if (segIdx >= 0) {
        const prevSeg = segIdx > 0 ? allSegs[segIdx - 1] : null;
        const nextSeg = segIdx < allSegs.length - 1 ? allSegs[segIdx + 1] : null;
        const parts = [];
        if (prevSeg) {
          const prevCn = prevSeg.originalChineseText || prevSeg.chineseText || prevSeg.originalText || prevSeg.original || '';
          const prevKh = prevSeg.khmerTranslatedText || prevSeg.khmerText || prevSeg.text || '';
          if (prevCn || prevKh) parts.push(`[មុន]: ${prevCn} ➜ ${prevKh}`);
        }
        if (nextSeg) {
          const nextCn = nextSeg.originalChineseText || nextSeg.chineseText || nextSeg.originalText || nextSeg.original || '';
          const nextKh = nextSeg.khmerTranslatedText || nextSeg.khmerText || nextSeg.text || '';
          if (nextCn || nextKh) parts.push(`[បន្ទាប់]: ${nextCn} ➜ ${nextKh}`);
        }
        surroundingContext = parts.join(' | ');
      }

      const res = await retranslateSegmentApi(textToTranslate, {
        speaker: selectedSegment?.speaker,
        gender: selectedSegment?.gender || selectedSegment?.speakerGender,
        previousTranslation,
        context: surroundingContext,
      });
      if (res && Array.isArray(res.options) && res.options.length > 0) {
        const sanitizedRes = {
          ...res,
          note: cleanKhmerText(res.note),
          options: res.options.map((opt) => ({ ...opt, text: cleanKhmerText(opt.text) })),
        };
        setRetranslateData(sanitizedRes);
        retranslateCacheRef.current[currentSegKey] = sanitizedRes;
      } else {
        setRetranslateError('AI មិនបានបញ្ជូនជម្រើសបកប្រែត្រឡប់មកវិញទេ។ សូមសាកល្បងម្ដងទៀត។');
      }
    } catch (err) {
      console.error('AI Re-translation failed:', err);
      setRetranslateError(formatRetranslateUiError(err));
    } finally {
      setIsRetranslating(false);
    }
  };

  // ✨ One-Click AI Translation Remedy for Missing-Text Segments
  const handleTranslateThisLine = async () => {
    const textToTranslate = (localChineseText || originalChinese || selectedSegment?.chineseText || selectedSegment?.originalText || selectedSegment?.original || '').trim();
    if (!textToTranslate || isRetranslating) {
      if (!textToTranslate) {
        alert('មិនមានអត្ថបទចិនដើមសម្រាប់បកប្រែឡើយ!');
      }
      return;
    }
    setIsRetranslating(true);
    setRetranslateError(null);
    try {
      let bestText = null;
      let resOptions = null;

      if (onTranslateSegment && selectedSegment) {
        const updated = await onTranslateSegment(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex);
        if (updated) {
          bestText = updated.khmer || updated.khmerText || updated.khmerTranslatedText;
        }
      }

      if (!bestText) {
        const previousTranslation = (localKhmerText || selectedSegment?.khmerText || selectedSegment?.khmerTranslatedText || selectedSegment?.khmer || '').trim();
        const res = await retranslateSegmentApi(textToTranslate, {
          speaker: selectedSegment?.speaker,
          gender: selectedSegment?.gender || selectedSegment?.speakerGender,
          previousTranslation,
        });
        if (res && Array.isArray(res.options) && res.options.length > 0) {
          bestText = cleanKhmerText(res.options[0].text);
          resOptions = res;
        }
      }

      if (bestText) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        setLocalKhmerText(bestText);
        localKhmerTextRef.current = bestText;
        lastCommittedTextRef.current = bestText;
        prevPropKhmerTextRef.current = bestText;

        if (selectedSegment) {
          delete selectedSegment.regenError;
          selectedSegment.khmer = bestText;
          selectedSegment.khmerText = bestText;
          selectedSegment.khmerTranslatedText = bestText;
          selectedSegment.audioOutdated = true;
          selectedSegment.textStatus = 'text_updated';
          selectedSegment.reviewNeeded = false;
          selectedSegment.ttsStatus = 'pending';
          if (Array.isArray(selectedSegment.validationErrors)) {
            selectedSegment.validationErrors = selectedSegment.validationErrors.filter((e) => !e.includes('មិនទាន់មានអត្ថបទបកប្រែ'));
          }
        }

        if (onSegmentTextChange) {
          onSegmentTextChange(selectedSegmentIndex, bestText);
        }
        if (onSegmentTextBlur) {
          onSegmentTextBlur(selectedSegmentIndex, bestText);
        }

        if (resOptions) {
          const sanitizedRes = {
            ...resOptions,
            note: cleanKhmerText(resOptions.note),
            options: resOptions.options.map((opt) => ({ ...opt, text: cleanKhmerText(opt.text) })),
          };
          setRetranslateData(sanitizedRes);
          retranslateCacheRef.current[currentSegKey] = sanitizedRes;
        }
      }
    } catch (err) {
      console.error('[Inspector] Translate line failed:', err);
      const friendly = formatRetranslateUiError(err);
      setRetranslateError(friendly);
    } finally {
      setIsRetranslating(false);
    }
  };
  const handleApplyOption = (newText) => {
    const cleanText = cleanKhmerText(newText);
    if (!cleanText) return;
    setRetranslateError(null);
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
    <div className="inspector-card-group" style={{ padding: '8px' }}>
      {/* Dialogue & Translation Card (Chinese Source + Khmer Target) */}
      <div style={{
        marginBottom: 10,
        padding: '8px',
        background: 'rgba(20, 20, 30, 0.65)',
        borderRadius: 6,
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        {/* 1. Chinese Original Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '1px 5px', borderRadius: 3, fontSize: '0.62rem', fontWeight: 800 }}>CN</span>
            <span>អត្ថបទដើមចិន (Original):</span>
          </label>
          {(localChineseText || originalChinese) && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <button
                type="button"
                data-testid="btn-ai-retranslate"
                onClick={handleAiRetranslate}
                disabled={isRetranslating}
                style={{
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.28), rgba(139, 92, 246, 0.18))',
                  border: '1px solid rgba(168, 85, 247, 0.55)',
                  borderRadius: 4,
                  color: '#d8b4fe',
                  cursor: isRetranslating ? 'wait' : 'pointer',
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
                title="AI Re-Translate: ឱ្យ AI បកប្រែជាភាសាកុនបុរាណ ៣ ជម្រើសភ្លាមៗ"
              >
                {isRetranslating ? <Loader2 size={11} className="spin animate-spin" /> : <Sparkles size={11} color="#d8b4fe" />}
                <span>{isRetranslating ? 'កំពុងគិត...' : 'AI កែប្រែ'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyChinese}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 4,
                  color: copiedChinese ? '#4ade80' : 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: '0.66rem',
                  fontWeight: 600,
                  display: 'inline-flex',
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
            </div>
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

        {/* Retranslate Error Banner if failed */}
        {retranslateError && (
          <div
            data-testid="retranslate-error-banner"
            style={{
              marginTop: 6,
              padding: '6px 8px',
              background: 'rgba(239, 68, 68, 0.14)',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: '0.7rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1.4 }}>
              <AlertCircle size={12} color="#ef4444" style={{ flexShrink: 0 }} />
              <span>{retranslateError}</span>
            </span>
            <button
              type="button"
              onClick={handleAiRetranslate}
              disabled={isRetranslating}
              style={{
                padding: '2px 7px',
                fontSize: '0.66rem',
                background: 'rgba(239, 68, 68, 0.85)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 4,
                cursor: isRetranslating ? 'wait' : 'pointer',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <RefreshCw size={10} />
              <span>សាកម្ដងទៀត</span>
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
                  id="inspector-khmer-textarea"
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
                        <span>ជម្រើសបកប្រែដោយ AI៖</span>
                      </div>
                      {retranslateData.note && (
                        <span style={{ fontSize: '0.66rem', color: '#cbd5e1', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                          {retranslateData.note}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {retranslateData.options.map((opt, i) => {
                        const isCompactOpt = opt.style === 'compact' || String(opt.label || '').includes('ខ្លីចំអត្ថន័យ');
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => handleApplyOption(opt.text)}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 8,
                              padding: isCompactOpt ? '7px 9px' : '6px 8px',
                              background: isCompactOpt ? 'rgba(168, 85, 247, 0.18)' : 'rgba(30, 26, 46, 0.85)',
                              border: isCompactOpt ? '1.5px solid rgba(168, 85, 247, 0.65)' : '1px solid rgba(168, 85, 247, 0.25)',
                              borderRadius: 4,
                              color: '#f1f5f9',
                              fontSize: '0.78rem',
                              textAlign: 'left',
                              cursor: 'pointer',
                              lineHeight: 1.5,
                              boxShadow: isCompactOpt ? '0 0 10px rgba(168, 85, 247, 0.2)' : 'none',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = isCompactOpt ? 'rgba(168, 85, 247, 0.32)' : 'rgba(168, 85, 247, 0.25)';
                              e.currentTarget.style.borderColor = '#c084fc';
                              e.currentTarget.style.transform = 'translateX(2px)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = isCompactOpt ? 'rgba(168, 85, 247, 0.18)' : 'rgba(30, 26, 46, 0.85)';
                              e.currentTarget.style.borderColor = isCompactOpt ? 'rgba(168, 85, 247, 0.65)' : 'rgba(168, 85, 247, 0.25)';
                              e.currentTarget.style.transform = 'none';
                            }}
                            title="ចុចដើម្បីជ្រើសរើសឃ្លានេះ និងបង្កើតសំឡេងថ្មីដោយស្វ័យប្រវត្តិ"
                          >
                            <span style={{
                              flexShrink: 0,
                              fontSize: '0.66rem',
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: opt.style === 'classical' ? 'rgba(59, 130, 246, 0.3)' : (opt.style === 'dramatic' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(168, 85, 247, 0.35)'),
                              color: opt.style === 'classical' ? '#93c5fd' : (opt.style === 'dramatic' ? '#fca5a5' : '#e9d5ff'),
                              border: isCompactOpt ? '1px solid rgba(168, 85, 247, 0.6)' : '1px solid rgba(255, 255, 255, 0.12)',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}>
                              <span>{opt.label}</span>
                              {isCompactOpt && (
                                <span style={{
                                  fontSize: '0.58rem',
                                  background: '#9333ea',
                                  color: '#ffffff',
                                  padding: '0 4px',
                                  borderRadius: 3,
                                  fontWeight: 800,
                                }}>
                                  ណែនាំ
                                </span>
                              )}
                            </span>
                            <span style={{ flex: 1, fontWeight: isCompactOpt ? 600 : 400 }}>{cleanKhmerText(opt.text)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}


                {/* One-Click Missing Text Remedy */}
                {isKhmerEmpty && (
                  <div style={{
                    marginTop: 8,
                    marginBottom: 4,
                    padding: '8px 10px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: '0.72rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <AlertCircle size={13} color="#ef4444" style={{ flexShrink: 0 }} />
                      <span>គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែឃ្លានេះ</span>
                    </span>
                    <button
                      type="button"
                      disabled={isRetranslating}
                      onClick={handleTranslateThisLine}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.72rem',
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: isRetranslating ? 'not-allowed' : 'pointer',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 6px rgba(99, 102, 241, 0.35)',
                      }}
                      title="បកប្រែឃ្លានេះតាមរយៈ AI (Translate this line)"
                    >
                      {isRetranslating ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          <span>កំពុងបកប្រែ...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={12} />
                          <span>បកប្រែឃ្លានេះ</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Error Banner with Retry Button (Only when text is present) */}
                {isError && !isKhmerEmpty && (
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
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <RefreshCw size={11} />
                      <span>សាកល្បងម្ដងទៀត</span>
                    </button>
                  </div>
                )}

                {/* Manual 1-click Regen Button when outdated or text edited */}
                {(selectedSegment.audioOutdated || isTextUpdated) && !isError && !isKhmerEmpty && (
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
                        <span>Generate សំឡេងតាមអត្ថបទថ្មី</span>
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
                  <span style={{ fontSize: '0.70rem', color: '#94a3b8', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {isThought ? <MessageSquare size={12} color="#d8b4fe" /> : <Mic size={12} color="#38bdf8" />}
                    <span>ទម្រង់នៃការនិយាយ (Delivery):</span>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, background: 'rgba(255, 255, 255, 0.03)', padding: '2px', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.05)', marginBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() => onToggleDeliveryType && onToggleDeliveryType(selectedSegment.id || selectedSegmentIndex, 'out_loud', true, selectedSegmentIndex)}
                    disabled={isGenerating}
                    style={{
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
                    <Volume2 size={12} />
                    <span>និយាយធម្មតា</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleDeliveryType && onToggleDeliveryType(selectedSegment.id || selectedSegmentIndex, 'inner_thought', true, selectedSegmentIndex)}
                    disabled={isGenerating}
                    style={{
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
                    <MessageSquare size={12} />
                    <span>និយាយក្នុងចិត្ត</span>
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.64rem', color: isThought ? '#d8b4fe' : '#64748b' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Sparkles size={10} color={isThought ? '#d8b4fe' : '#64748b'} />
                    <span>{isThought ? 'Reverb Active (aecho)' : 'Direct Voice Output'}</span>
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
                    data-testid="voice-switch-male-btn"
                    onClick={async () => {
                      setSwitchingVoiceTarget('MALE');
                      const minSpin = new Promise((r) => setTimeout(r, 300));
                      try {
                        await Promise.all([
                          Promise.resolve(onClipVoiceChange(selectedSegment.id || selectedSegmentIndex, 'km-KH-PisethNeural', selectedSegmentIndex)),
                          minSpin,
                        ]);
                      } finally {
                        setSwitchingVoiceTarget(null);
                      }
                    }}
                    disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex) || switchingVoiceTarget !== null}
                    style={{
                      padding: '8px 6px',
                      fontSize: '0.8125rem',
                      lineHeight: 'var(--khmer-line-height, 1.68)',
                      borderRadius: 6,
                      border: `1.5px solid ${isPisethActive ? 'rgba(56, 189, 248, 0.7)' : 'rgba(255,255,255,0.08)'}`,
                      background: isPisethActive ? 'linear-gradient(135deg, rgba(2, 132, 199, 0.35), rgba(14, 165, 233, 0.2))' : 'rgba(255, 255, 255, 0.03)',
                      color: isPisethActive ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: isPisethActive ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                      transition: 'all 0.15s ease',
                      boxShadow: isPisethActive ? '0 2px 8px rgba(56, 189, 248, 0.25)' : 'none'
                    }}
                    title="ប្តូរទៅសំឡេងប្រុស (Piseth Neural)"
                  >
                    {switchingVoiceTarget === 'MALE' ? (
                      <Loader2 size={13} className="animate-spin" style={{ color: '#38bdf8' }} />
                    ) : (
                      <User size={13} />
                    )}
                    <span>ប្រុស (Piseth)</span>
                  </button>
                  <button
                    type="button"
                    data-testid="voice-switch-female-btn"
                    onClick={async () => {
                      setSwitchingVoiceTarget('FEMALE');
                      const minSpin = new Promise((r) => setTimeout(r, 300));
                      try {
                        await Promise.all([
                          Promise.resolve(onClipVoiceChange(selectedSegment.id || selectedSegmentIndex, 'km-KH-SreymomNeural', selectedSegmentIndex)),
                          minSpin,
                        ]);
                      } finally {
                        setSwitchingVoiceTarget(null);
                      }
                    }}
                    disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex) || switchingVoiceTarget !== null}
                    style={{
                      padding: '8px 6px',
                      fontSize: '0.8125rem',
                      lineHeight: 'var(--khmer-line-height, 1.68)',
                      borderRadius: 6,
                      border: `1.5px solid ${isSreymomActive ? 'rgba(244, 114, 182, 0.8)' : 'rgba(255,255,255,0.08)'}`,
                      background: isSreymomActive ? 'linear-gradient(135deg, rgba(219, 39, 119, 0.38), rgba(244, 114, 182, 0.25))' : 'rgba(255, 255, 255, 0.03)',
                      color: isSreymomActive ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: isSreymomActive ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                      transition: 'all 0.15s ease',
                      boxShadow: isSreymomActive ? '0 2px 8px rgba(244, 114, 182, 0.3)' : 'none'
                    }}
                    title="ប្តូរទៅសំឡេងស្រី (Sreymom Neural)"
                  >
                    {switchingVoiceTarget === 'FEMALE' ? (
                      <Loader2 size={13} className="animate-spin" style={{ color: '#f472b6' }} />
                    ) : (
                      <UserCheck size={13} />
                    )}
                    <span>ស្រី (Sreymom)</span>
                  </button>
                </div>
              </div>

              {/* Speaker & Audio Status */}
              {(() => {
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.74rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {selectedSegment.audioUrl ? (
                          <span style={{ fontSize: '0.66rem', color: selectedSegment.audioOutdated ? 'var(--color-warning)' : 'var(--color-success)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle2 size={11} /> {selectedSegment.audioOutdated ? 'អត្ថបទកែ (Outdated)' : 'Audio Ready'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-dim)' }}>Audio Pending</span>
                        )}
                      </div>
                    </div>

                    {/* Dual Mute / Unmute Controls: Video Original Audio & Khmer AI Voice */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, marginBottom: 8 }}>
                      {/* 1. Mute Original Video Audio Button */}
                      {onToggleMuteVideoClip && (associatedClip || selectedClip) && (
                        <button
                          type="button"
                          onClick={() => onToggleMuteVideoClip((associatedClip || selectedClip).id)}
                          title={(associatedClip || selectedClip).isMuted ? "បានបិទសំឡេងវីដេអូដើម (Muted) - ចុចដើម្បីបើកវិញ" : "ចុចដើម្បីបិទសំឡេងដើមនៃ Video Clip នេះ (Mute Original Audio)"}
                          style={{
                            padding: '4px 6px',
                            fontSize: '0.68rem',
                            fontWeight: 600,
                            borderRadius: 4,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            border: `1px solid ${(associatedClip || selectedClip).isMuted ? 'rgba(239, 68, 68, 0.7)' : 'rgba(0, 229, 255, 0.4)'}`,
                            background: (associatedClip || selectedClip).isMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(0, 229, 255, 0.1)',
                            color: (associatedClip || selectedClip).isMuted ? '#f87171' : 'var(--accent-cyan)',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {(associatedClip || selectedClip).isMuted ? (
                            <>
                              <VolumeX size={11} color="#f87171" />
                              <span style={{ whiteSpace: 'nowrap' }}>វីដេអូ Muted</span>
                            </>
                          ) : (
                            <>
                              <Film size={11} color="var(--accent-cyan)" />
                              <span style={{ whiteSpace: 'nowrap' }}>វីដេអូដើម</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* 2. Single Clip Mute / Unmute Toggle (Khmer AI Voice) */}
                      {onToggleMuteSegment && (
                        <button
                          type="button"
                          onClick={() => onToggleMuteSegment(selectedSegment.id || selectedSegmentIndex)}
                          title={selectedSegment.muted ? "ចុចដើម្បីបើកសំឡេង AI ខ្មែរឡើងវិញ (Unmute Voice)" : "ចុចដើម្បីបិទសំឡេង AI ខ្មែរតែឃ្លានេះ (Mute Voice)"}
                          style={{
                            padding: '4px 6px',
                            fontSize: '0.68rem',
                            fontWeight: 600,
                            borderRadius: 4,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            border: `1px solid ${selectedSegment.muted ? 'rgba(239, 68, 68, 0.7)' : 'rgba(255, 255, 255, 0.2)'}`,
                            background: selectedSegment.muted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                            color: selectedSegment.muted ? '#f87171' : 'var(--text-secondary)',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {selectedSegment.muted ? (
                            <>
                              <VolumeX size={11} color="#f87171" />
                              <span style={{ whiteSpace: 'nowrap' }}>AI Muted</span>
                            </>
                          ) : (
                            <>
                              <Volume2 size={11} color="#38bdf8" />
                              <span style={{ whiteSpace: 'nowrap' }}>សំឡេង AI</span>
                            </>
                          )}
                        </button>
                      )}
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
                        if (spd <= 0.85) return 'យឺត';
                        if (spd <= 1.15) return 'ធម្មតា';
                        if (spd <= 1.4) return 'លឿន';
                        return 'ញាប់';
                      };

                      const clipPresets = [
                        { label: '0.75x', val: 0.75 },
                        { label: '1.0x', val: 1.0 },
                        { label: '1.25x', val: 1.25 },
                        { label: '1.5x', val: 1.5 },
                      ];

                      return (
                        <div style={{ marginBottom: 10, padding: '7px 9px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <span style={{ fontSize: '0.70rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                              ល្បឿន (Clip Speed):
                            </span>
                            <span style={{
                              fontSize: '0.68rem',
                              color: 'var(--accent-cyan, #38bdf8)',
                              background: 'rgba(56, 189, 248, 0.12)',
                              padding: '1px 7px',
                              borderRadius: 4,
                              fontWeight: 700,
                              whiteSpace: 'nowrap'
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

              {/* Action Buttons: Listen, Regenerate & Tools */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                    title="🔊 ស្តាប់សាកល្បង (Play audio)"
                  >
                    {String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex) ? (
                      <>
                        <Pause size={13} />
                        <span>កំពុងចាក់...</span>
                      </>
                    ) : (
                      <>
                        <Play size={13} fill="currentColor" color={autoplayBlocked ? "#facc15" : undefined} />
                        <span>ស្តាប់សាកល្បង</span>
                      </>
                    )}
                  </button>

                  {/* 2. Regenerate Button or One-Click Translate Remedy */}
                  {isKhmerEmpty ? (
                    <button
                      type="button"
                      onClick={handleTranslateThisLine}
                      disabled={isRetranslating}
                      className="btn-primary"
                      style={{
                        padding: '7px 8px',
                        fontSize: '0.74rem',
                        justifyContent: 'center',
                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                        color: '#ffffff',
                        border: 'none',
                        cursor: isRetranslating ? 'not-allowed' : 'pointer',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)',
                      }}
                      title="បកប្រែឃ្លានេះជាភាសាខ្មែរតាមរយៈ AI (Translate this line)"
                    >
                      {isRetranslating ? (
                        <>
                          <Loader2 size={13} className="pulse-glow" />
                          <span>កំពុងបកប្រែ...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} />
                          <span>បកប្រែឃ្លានេះ</span>
                        </>
                      )}
                    </button>
                  ) : (() => {
                    const isRegenerating = regeneratingId === (selectedSegment.id || selectedSegmentIndex);
                    return (
                      <button
                        type="button"
                        onClick={() => onSingleRegen(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex, localKhmerText)}
                        disabled={isRegenerating}
                        className={selectedSegment.audioUrl ? "btn-secondary" : "btn-primary"}
                        style={{
                          padding: '7px 8px',
                          fontSize: '0.74rem',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                        title="Regenerate speech for this segment"
                      >
                        {isRegenerating ? (
                          <>
                            <Loader2 size={13} className="pulse-glow" />
                            <span>កំពុងបង្កើត...</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw size={13} />
                            <span>{selectedSegment.audioUrl ? 'Generate ឡើងវិញ' : 'Generate'}</span>
                          </>
                        )}
                      </button>
                    );
                  })()}
                </div>

                {/* Secondary Row: Split & Delete */}
                {(onSplitClip || onDeleteSegment) && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onSplitClip && (
                      <button
                        type="button"
                        onClick={() => onSplitClip(currentTime, selectedSegment.id || selectedSegmentIndex)}
                        className="btn-secondary"
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          fontSize: '0.72rem',
                          justifyContent: 'center',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
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

                    {onDeleteSegment && (
                      <button
                        type="button"
                        onClick={() => onDeleteSegment(selectedSegment._uid || (selectedSegment.id !== undefined && selectedSegment.id !== null ? selectedSegment.id : selectedSegmentIndex))}
                        className="btn-secondary"
                        style={{
                          width: onSplitClip ? '75px' : '100%',
                          padding: '6px 10px',
                          fontSize: '0.72rem',
                          justifyContent: 'center',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
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
  );
}
