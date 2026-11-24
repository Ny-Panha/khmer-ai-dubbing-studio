import { cleanKhmerText } from '../../utils/khmerTextSplitter';
import React, { useState } from 'react';
import SmoothRangeSlider from '../common/SmoothRangeSlider';
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
  onReleaseSegmentToAutoAlign = null,
  videoClips = [],
  onUpdateSpeakerVoice = null,
  onAutoSplitSegment = null,
  onToggleDeliveryType = null,
  onSegmentChineseChange = null,
}) {
  const [copiedChinese, setCopiedChinese] = useState(false);
  const [draftClipSpeed, setDraftClipSpeed] = useState(null);
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
      <div className="clip-inspector-section" style={{ marginBottom: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary-panel)', overflow: 'hidden' }}>
        <div
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            background: 'var(--bg-elevated-panel)',
            cursor: 'pointer',
            borderBottom: isOpen ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Film size={14} color="var(--primary-accent)" />
            <span style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Video: {targetVideoClip.name || 'Clip'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--primary-accent)', background: 'rgba(56, 189, 248, 0.12)', padding: '1px 6px', borderRadius: 'var(--radius-xs)' }}>
              {durSec.toFixed(2)}s
            </span>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>{isOpen ? 'បង្រួម' : 'ពង្រីក'}</span>
        </div>

        {isOpen && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {startSec.toFixed(2)}s – {endSec.toFixed(2)}s
              </span>
              {onToggleMuteVideoClip && (
                <button
                  type="button"
                  onClick={() => onToggleMuteVideoClip(targetVideoClip.id)}
                  className="btn-secondary"
                  style={{
                    minHeight: 30,
                    padding: '4px 10px',
                    fontSize: 'var(--text-sm)',
                    borderColor: isClipMuted ? 'rgba(239, 68, 68, 0.5)' : 'var(--border-subtle)',
                    background: isClipMuted ? 'rgba(239, 68, 68, 0.16)' : 'var(--bg-elevated-panel)',
                    color: isClipMuted ? '#FCA5A5' : 'var(--text-primary)',
                  }}
                >
                  {isClipMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  <span>{isClipMuted ? 'បានបិទសំឡេង' : 'បិទសំឡេងដើម'}</span>
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {onSplitClip && (
                <button
                  type="button"
                  onClick={() => onSplitClip(currentTime)}
                  className="btn-secondary"
                  style={{ minHeight: 32, fontSize: 'var(--text-sm)', justifyContent: 'center' }}
                >
                  <Scissors size={13} />
                  <span>កាត់ Clip</span>
                </button>
              )}
              {onDeleteClip && (
                <button
                  type="button"
                  onClick={() => onDeleteClip(targetVideoClip.id)}
                  className="btn-danger"
                  style={{ minHeight: 32, fontSize: 'var(--text-sm)', justifyContent: 'center' }}
                >
                  <Trash2 size={13} />
                  <span>លុប Clip</span>
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
    if (selectedSegment) {
      delete selectedSegment.regenError;
      if (selectedSegment.textStatus === 'error') {
        selectedSegment.textStatus = 'text_updated';
      }
    }
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

  const pickPreferredCompactOption = (options = []) => {
    if (!Array.isArray(options) || options.length === 0) return null;
    return (
      options.find((opt) => opt?.style === 'compact' || String(opt?.label || '').includes('ខ្លីចំអត្ថន័យ')) ||
      options[1] ||
      options[0]
    );
  };

  // ✨ AI In-App Re-Translation handler (generates 3 options & auto-applies Option #2 "📝 ខ្លីចំអត្ថន័យ")
  const handleAiRetranslate = async () => {
    const textToTranslate = (localChineseText || originalChinese || '').trim();
    if (!textToTranslate || isRetranslating) return;
    setIsRetranslating(true);
    setRetranslateError(null);
    try {
      // Context enrichment: previous translation + surrounding dialogue context + time slot duration
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

      const rawStart = Number(selectedSegment?.startSec ?? selectedSegment?.startTime ?? 0);
      const rawEnd = Number(selectedSegment?.endSec ?? selectedSegment?.endTime ?? 0);
      const segDurationSec = Number(selectedSegment?.duration) > 0
        ? Number(selectedSegment.duration)
        : (rawEnd > rawStart ? Number((rawEnd - rawStart).toFixed(2)) : undefined);

      const res = await retranslateSegmentApi(textToTranslate, {
        speaker: selectedSegment?.speaker,
        gender: selectedSegment?.gender || selectedSegment?.speakerGender,
        previousTranslation,
        context: surroundingContext,
        durationSec: segDurationSec,
      });
      if (res && Array.isArray(res.options) && res.options.length > 0) {
        const sanitizedRes = {
          ...res,
          note: cleanKhmerText(res.note),
          options: res.options.map((opt) => ({ ...opt, text: cleanKhmerText(opt.text) })),
        };
        setRetranslateData(sanitizedRes);
        retranslateCacheRef.current[currentSegKey] = sanitizedRes;
        // Display only — do not auto-pick for the user so user can review word count vs slot budget
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
        const rawStart = Number(selectedSegment?.startSec ?? selectedSegment?.startTime ?? 0);
        const rawEnd = Number(selectedSegment?.endSec ?? selectedSegment?.endTime ?? 0);
        const segDurationSec = Number(selectedSegment?.duration) > 0
          ? Number(selectedSegment.duration)
          : (rawEnd > rawStart ? Number((rawEnd - rawStart).toFixed(2)) : undefined);
        const previousTranslation = (localKhmerText || selectedSegment?.khmerText || selectedSegment?.khmerTranslatedText || selectedSegment?.khmer || '').trim();
        const res = await retranslateSegmentApi(textToTranslate, {
          speaker: selectedSegment?.speaker,
          gender: selectedSegment?.gender || selectedSegment?.speakerGender,
          previousTranslation,
          durationSec: segDurationSec,
        });
        if (res && Array.isArray(res.options) && res.options.length > 0) {
          const preferredOpt = pickPreferredCompactOption(res.options);
          bestText = cleanKhmerText(preferredOpt?.text || res.options[0].text);
          if (preferredOpt?.text) {
            handleApplyOption(preferredOpt.text);
          }
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

  const segVoiceId = selectedSegment.voiceOverride || selectedSegment.khmerVoiceId || selectedSegment.voiceId || selectedSegment.voice || '';
  const isThought = selectedSegment.deliveryType === 'inner_thought';
  const isPisethActive = segVoiceId.includes('Piseth') || (!segVoiceId.includes('Sreymom') && detectedGender !== 'female');
  const isSreymomActive = segVoiceId.includes('Sreymom') || (!segVoiceId.includes('Piseth') && detectedGender === 'female');
  const effectiveVoiceId = isSreymomActive ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';

  return (
    <div className="inspector-card-group" style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 1. Chinese Source + Khmer Translation Card */}
      <div style={{
        padding: '10px',
        background: 'var(--bg-secondary-panel)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {/* Chinese Original Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-elevated-panel)', border: '1px solid var(--border-subtle)', color: 'var(--primary-accent)', padding: '1px 5px', borderRadius: 'var(--radius-xs)', fontSize: '10.5px', fontWeight: 700 }}>CN</span>
            <span>អត្ថបទចិន</span>
          </label>
          {(localChineseText || originalChinese) && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <button
                type="button"
                data-testid="btn-ai-retranslate"
                onClick={handleAiRetranslate}
                disabled={isRetranslating}
                className="btn-secondary"
                style={{
                  minHeight: 26,
                  padding: '2px 8px',
                  fontSize: '11.5px',
                  borderColor: 'rgba(56, 189, 248, 0.35)',
                  color: 'var(--primary-accent)',
                  background: 'rgba(56, 189, 248, 0.1)',
                }}
                title="ឱ្យ AI បកប្រែឡើងវិញ ៣ ជម្រើស"
              >
                {isRetranslating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                <span>{isRetranslating ? 'កំពុងគិត...' : 'បកប្រែ AI'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyChinese}
                className="btn-secondary"
                style={{
                  minHeight: 26,
                  padding: '2px 7px',
                  fontSize: '11.5px',
                  color: copiedChinese ? '#6EE7B7' : 'var(--text-secondary)',
                }}
                title="ចម្លងអត្ថបទចិន"
              >
                {copiedChinese ? <Check size={11} /> : <Copy size={11} />}
                <span>{copiedChinese ? 'បានចម្លង' : 'Copy'}</span>
              </button>
            </div>
          )}
        </div>
        <textarea
          rows={2}
          value={localChineseText}
          onChange={handleChineseTextChange}
          onBlur={handleChineseTextBlur}
          placeholder="អត្ថបទដើមភាសាចិន..."
          className="capcut-input"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontSize: '13px',
            color: 'var(--text-primary)',
            lineHeight: 1.5,
            background: 'var(--bg-desktop)',
            padding: '7px 9px',
            borderRadius: 'var(--radius-xs)',
            border: '1px solid var(--border-subtle)',
            resize: 'vertical',
          }}
        />

        {/* Retranslate Error Banner */}
        {retranslateError && (
          <div
            data-testid="retranslate-error-banner"
            style={{
              padding: '6px 8px',
              background: 'rgba(239, 68, 68, 0.14)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 'var(--radius-xs)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: '11.5px', color: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1.4 }}>
              <AlertCircle size={12} color="#F87171" style={{ flexShrink: 0 }} />
              <span>{retranslateError}</span>
            </span>
            <button
              type="button"
              onClick={handleAiRetranslate}
              disabled={isRetranslating}
              className="btn-danger"
              style={{ minHeight: 24, padding: '2px 8px', fontSize: '11px', flexShrink: 0 }}
            >
              <RefreshCw size={10} />
              <span>សាកម្ដងទៀត</span>
            </button>
          </div>
        )}

        <div style={{ height: 1, background: 'var(--border-subtle)' }} />

        {/* Khmer Translation Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontFamily: 'var(--font-mono)', background: 'rgba(56, 189, 248, 0.14)', border: '1px solid rgba(56, 189, 248, 0.3)', color: 'var(--primary-accent)', padding: '1px 5px', borderRadius: 'var(--radius-xs)', fontSize: '10.5px', fontWeight: 700 }}>KH</span>
            <span>អត្ថបទខ្មែរ</span>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isGenerating && (
              <span style={{ fontSize: '11px', color: '#7DD3FC', background: 'rgba(56, 189, 248, 0.14)', border: '1px solid rgba(56, 189, 248, 0.35)', padding: '1px 7px', borderRadius: 'var(--radius-xs)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Loader2 size={11} className="animate-spin" />
                <span>កំពុងបង្កើត...</span>
              </span>
            )}
            {isVoiceUpdated && (
              <span style={{ fontSize: '11px', color: '#6EE7B7', background: 'rgba(16, 185, 129, 0.14)', border: '1px solid rgba(52, 211, 153, 0.35)', padding: '1px 7px', borderRadius: 'var(--radius-xs)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={11} />
                <span>រួចរាល់</span>
              </span>
            )}
            {isError && (
              <span style={{ fontSize: '11px', color: '#FCA5A5', background: 'rgba(239, 68, 68, 0.14)', border: '1px solid rgba(239, 68, 68, 0.35)', padding: '1px 7px', borderRadius: 'var(--radius-xs)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <AlertCircle size={11} />
                <span>មានបញ្ហា</span>
              </span>
            )}
            {isTextUpdated && (
              <span style={{ fontSize: '11px', color: '#FDE68A', background: 'rgba(245, 158, 11, 0.14)', border: '1px solid rgba(245, 158, 11, 0.35)', padding: '1px 7px', borderRadius: 'var(--radius-xs)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Edit3 size={10} />
                <span>បានកែអត្ថបទ</span>
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
          placeholder="វាយ ឬកែសម្រួលអត្ថបទភាសាខ្មែរ..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 'var(--text-body)',
            color: 'var(--text-primary)',
            background: 'var(--bg-desktop)',
            border: isGenerating
              ? '1px solid var(--primary-accent)'
              : (isError ? '1px solid var(--color-error)' : (isVoiceUpdated ? '1px solid var(--color-success)' : (isTextUpdated ? '1px solid rgba(245, 158, 11, 0.55)' : '1px solid var(--border-subtle)'))),
            borderRadius: 'var(--radius-xs)',
            padding: '7px 9px',
            lineHeight: 1.6,
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'var(--font-sans)',
          }}
        />

        {/* AI Re-Translation Suggestion Options (Clean Flat Darkroom Cards) */}
        {retranslateData?.options && retranslateData.options.length > 0 && (() => {
          const rawSegStart = Number(selectedSegment?.startSec ?? selectedSegment?.startTime ?? 0);
          const rawSegEnd = Number(selectedSegment?.endSec ?? selectedSegment?.endTime ?? 0);
          const currentSegDuration = Number(selectedSegment?.duration) > 0
            ? Number(selectedSegment.duration)
            : (rawSegEnd > rawSegStart ? Number((rawSegEnd - rawSegStart).toFixed(2)) : 0);
          const slotWordBudget = retranslateData?.maxKhmerWords || (currentSegDuration > 0
            ? Math.min(14, Math.max(2, Math.ceil(Math.min(currentSegDuration, 4.5) * 2.5)))
            : null);

          return (
            <div style={{
              padding: '8px',
              background: 'var(--bg-elevated-panel)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '12px', color: 'var(--primary-accent)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <Sparkles size={12} />
                    <span>ជម្រើសបកប្រែ AI</span>
                  </span>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: slotWordBudget ? 'rgba(56, 189, 248, 0.14)' : 'rgba(16, 185, 129, 0.14)',
                    border: slotWordBudget ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(16, 185, 129, 0.35)',
                    color: slotWordBudget ? 'var(--primary-accent)' : '#6EE7B7',
                    whiteSpace: 'nowrap',
                  }}>
                    {slotWordBudget ? `Budget: <= ${slotWordBudget} ពាក្យ` : 'ជ្រើសរើសជម្រើសសមស្រប'}
                  </span>
                </div>
                {retranslateData.note && (
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{retranslateData.note}</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {retranslateData.options.map((opt, i) => {
                  const isCompactOpt = opt.style === 'compact' || String(opt.label || '').includes('ខ្លីចំអត្ថន័យ');
                  const cleanOptText = cleanKhmerText(opt.text);
                  const isAppliedOpt = Boolean(cleanOptText && cleanKhmerText(localKhmerText) === cleanOptText);
                  const optWords = cleanOptText ? cleanOptText.trim().split(/\s+/).filter(Boolean).length : 0;
                  const isFit = slotWordBudget ? optWords <= slotWordBudget : true;

                  return (
                    <button
                      key={i}
                      type="button"
                      data-testid={`retranslate-opt-${opt.style || i}`}
                      onClick={() => handleApplyOption(opt.text)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 3,
                        padding: '7px 8px',
                        background: isAppliedOpt
                          ? 'rgba(56, 189, 248, 0.16)'
                          : (isCompactOpt ? 'rgba(56, 189, 248, 0.08)' : 'var(--bg-secondary-panel)'),
                        border: isAppliedOpt
                          ? '1px solid var(--primary-accent)'
                          : (isCompactOpt ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid var(--border-subtle)'),
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--text-sm)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        lineHeight: 1.5,
                      }}
                      title="ចុចដើម្បីជ្រើសរើសជម្រើសនេះ"
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, width: '100%' }}>
                        <span style={{
                          flexShrink: 0,
                          fontSize: '10.5px',
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-xs)',
                          background: isAppliedOpt || isCompactOpt ? 'var(--btn-primary-bg)' : 'var(--bg-elevated-panel)',
                          color: isAppliedOpt || isCompactOpt ? '#FFFFFF' : 'var(--text-secondary)',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}>
                          {opt.label}
                        </span>
                        <span style={{ flex: 1, fontWeight: isAppliedOpt || isCompactOpt ? 600 : 400 }}>{cleanOptText}</span>
                        {isAppliedOpt && (
                          <CheckCircle2 size={13} color="#34D399" style={{ flexShrink: 0, marginTop: 2 }} />
                        )}
                      </div>
                      {slotWordBudget && (
                        <div style={{ paddingLeft: '2px', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: isFit ? '#34D399' : '#F87171',
                          }}>
                            {isFit
                              ? `${optWords}/${slotWordBudget} ពាក្យ ✓ ចូល slot`
                              : `${optWords}/${slotWordBudget} ពាក្យ ⚠ លើស`}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Missing Text Remedy */}
        {isKhmerEmpty && (
          <div style={{
            padding: '8px 10px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 'var(--radius-xs)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}>
            <span style={{ fontSize: '12px', color: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 5 }}>
              <AlertCircle size={13} color="#F87171" style={{ flexShrink: 0 }} />
              <span>គ្មានអត្ថបទខ្មែរទេ</span>
            </span>
            <button
              type="button"
              disabled={isRetranslating}
              onClick={handleTranslateThisLine}
              className="btn-primary"
              style={{ minHeight: 28, padding: '3px 10px', fontSize: '12px' }}
            >
              {isRetranslating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              <span>{isRetranslating ? 'កំពុងបកប្រែ...' : 'បកប្រែ AI'}</span>
            </button>
          </div>
        )}

        {/* Audio Regen Error Banner */}
        {isError && !isKhmerEmpty && (
          <div style={{
            padding: '6px 9px',
            background: 'rgba(239, 68, 68, 0.14)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 'var(--radius-xs)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}>
            <span style={{ fontSize: '11.5px', color: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertCircle size={12} color="#F87171" />
              <span>{selectedSegment.regenError ? selectedSegment.regenError : 'បង្កើតសំឡេងបរាជ័យ'}</span>
            </span>
            <button
              type="button"
              onClick={() => onSingleRegen(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex, localKhmerText)}
              className="btn-danger"
              style={{ minHeight: 24, padding: '2px 8px', fontSize: '11px' }}
            >
              <RefreshCw size={10} />
              <span>សាកម្ដងទៀត</span>
            </button>
          </div>
        )}

        {/* Primary 1-Click Regen Button when text edited */}
        {(selectedSegment.audioOutdated || isTextUpdated) && !isError && !isKhmerEmpty && (
          <button
            type="button"
            onClick={() => onSingleRegen(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex, localKhmerText)}
            disabled={isGenerating}
            className="btn-primary"
            style={{ width: '100%', minHeight: 34, fontSize: 'var(--text-sm)' }}
          >
            {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            <span>{isGenerating ? 'កំពុងបង្កើតសំឡេង...' : 'បង្កើតសំឡេងតាមអត្ថបទថ្មី'}</span>
          </button>
        )}
      </div>

      {/* 2. Delivery Style (Normal vs Inner Thought — Zero Debug Noise) */}
      <div style={{
        padding: '9px 10px',
        background: 'var(--bg-secondary-panel)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {isThought ? <MessageSquare size={12} color="var(--primary-accent)" /> : <Mic size={12} color="var(--primary-accent)" />}
            <span>សំឡេងនិយាយ</span>
          </span>
          {isThought && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--primary-accent)', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '1px 6px', borderRadius: 'var(--radius-xs)', fontWeight: 600 }}>
              Reverb ON
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, background: 'var(--bg-desktop)', padding: 3, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => onToggleDeliveryType && onToggleDeliveryType(selectedSegment.id || selectedSegmentIndex, 'out_loud', true, selectedSegmentIndex)}
            disabled={isGenerating}
            style={{
              height: 30,
              fontSize: 'var(--text-sm)',
              borderRadius: 'var(--radius-xs)',
              cursor: 'pointer',
              fontWeight: !isThought ? 700 : 500,
              border: !isThought ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent',
              background: !isThought ? 'var(--bg-active-card)' : 'transparent',
              color: !isThought ? 'var(--primary-accent)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
            title="និយាយសន្ទនាធម្មតា"
          >
            <Volume2 size={12} />
            <span>ធម្មតា</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleDeliveryType && onToggleDeliveryType(selectedSegment.id || selectedSegmentIndex, 'inner_thought', true, selectedSegmentIndex)}
            disabled={isGenerating}
            style={{
              height: 30,
              fontSize: 'var(--text-sm)',
              borderRadius: 'var(--radius-xs)',
              cursor: 'pointer',
              fontWeight: isThought ? 700 : 500,
              border: isThought ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent',
              background: isThought ? 'var(--bg-active-card)' : 'transparent',
              color: isThought ? 'var(--primary-accent)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
            title="និយាយក្នុងចិត្ត (បន្ថែម Reverb)"
          >
            <MessageSquare size={12} />
            <span>ក្នុងចិត្ត</span>
          </button>
        </div>
      </div>

      {/* 3. Voice Selector & Audio Status */}
      <div style={{
        padding: '9px 10px',
        background: 'var(--bg-secondary-panel)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
            តួសំឡេង (Voice)
          </span>
          {(isGenerating || switchingVoiceTarget !== null) ? (
            <span data-testid="segment-audio-status-badge" style={{ fontSize: '11px', color: 'var(--primary-accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Loader2 size={11} className="animate-spin" /> កំពុងបង្កើតសំឡេង... (Generating)
            </span>
          ) : selectedSegment.audioUrl ? (
            <span data-testid="segment-audio-status-badge" style={{ fontSize: '11px', color: selectedSegment.audioOutdated ? '#FDE68A' : '#6EE7B7', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={11} /> {selectedSegment.audioOutdated ? 'ត្រូវ Update' : 'រួចរាល់'}
            </span>
          ) : (
            <span data-testid="segment-audio-status-badge" style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              មិនទាន់មាន
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
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
              height: 36,
              padding: '0 8px',
              fontSize: 'var(--text-sm)',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${isPisethActive ? 'rgba(56, 189, 248, 0.55)' : 'var(--border-subtle)'}`,
              background: isPisethActive ? 'rgba(56, 189, 248, 0.16)' : 'var(--bg-desktop)',
              color: isPisethActive ? '#FFFFFF' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: isPisethActive ? 700 : 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
            title="ប្តូរទៅសំឡេងប្រុស (ពិសិដ្ឋ)"
          >
            {switchingVoiceTarget === 'MALE' ? <Loader2 size={13} className="animate-spin" color="#38BDF8" /> : <User size={13} color={isPisethActive ? '#38BDF8' : 'currentColor'} />}
            <span>ប្រុស · ពិសិដ្ឋ</span>
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
              height: 36,
              padding: '0 8px',
              fontSize: 'var(--text-sm)',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${isSreymomActive ? 'rgba(244, 114, 182, 0.6)' : 'var(--border-subtle)'}`,
              background: isSreymomActive ? 'rgba(244, 114, 182, 0.16)' : 'var(--bg-desktop)',
              color: isSreymomActive ? '#FFFFFF' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: isSreymomActive ? 700 : 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
            title="ប្តូរទៅសំឡេងស្រី (ស្រីមុំ)"
          >
            {switchingVoiceTarget === 'FEMALE' ? <Loader2 size={13} className="animate-spin" color="#F472B6" /> : <UserCheck size={13} color={isSreymomActive ? '#F472B6' : 'currentColor'} />}
            <span>ស្រី · ស្រីមុំ</span>
          </button>
        </div>

        {/* Clean 2-Column Mute Toggles (Video Original | Khmer AI) */}
        {((onToggleMuteVideoClip && (associatedClip || selectedClip)) || onToggleMuteSegment) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {onToggleMuteVideoClip && (associatedClip || selectedClip) && (
              <button
                type="button"
                onClick={() => onToggleMuteVideoClip((associatedClip || selectedClip).id)}
                className="btn-secondary"
                style={{
                  minHeight: 30,
                  padding: '0 8px',
                  fontSize: '12px',
                  justifyContent: 'center',
                  borderColor: (associatedClip || selectedClip).isMuted ? 'rgba(239, 68, 68, 0.5)' : 'var(--border-subtle)',
                  background: (associatedClip || selectedClip).isMuted ? 'rgba(239, 68, 68, 0.14)' : 'var(--bg-desktop)',
                  color: (associatedClip || selectedClip).isMuted ? '#FCA5A5' : 'var(--text-secondary)',
                }}
                title="បិទ/បើកសំឡេងវីដេអូដើមលើឃ្លានេះ"
              >
                {(associatedClip || selectedClip).isMuted ? <VolumeX size={12} /> : <Film size={12} />}
                <span>{(associatedClip || selectedClip).isMuted ? 'វីដេអូ Muted' : 'សំឡេងវីដេអូ'}</span>
              </button>
            )}
            {onToggleMuteSegment && (
              <button
                type="button"
                onClick={() => onToggleMuteSegment(selectedSegment.id || selectedSegmentIndex)}
                className="btn-secondary"
                style={{
                  minHeight: 30,
                  padding: '0 8px',
                  fontSize: '12px',
                  justifyContent: 'center',
                  borderColor: selectedSegment.muted ? 'rgba(239, 68, 68, 0.5)' : 'var(--border-subtle)',
                  background: selectedSegment.muted ? 'rgba(239, 68, 68, 0.14)' : 'var(--bg-desktop)',
                  color: selectedSegment.muted ? '#FCA5A5' : 'var(--text-secondary)',
                }}
                title="បិទ/បើកសំឡេងខ្មែរ AI លើឃ្លានេះ"
              >
                {selectedSegment.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                <span>{selectedSegment.muted ? 'AI Muted' : 'សំឡេង AI'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 4. Clip Speed Control */}
      {(() => {
        const hasAutoFitSpeed = Boolean(
          !selectedSegment.userCustomSpeed &&
          typeof selectedSegment.appliedSpeed === 'number' &&
          Number.isFinite(selectedSegment.appliedSpeed) &&
          Math.abs(selectedSegment.appliedSpeed - 1.0) > 0.01
        );
        const segSpeedNum = (() => {
          if (selectedSegment.userCustomSpeed) {
            if (typeof selectedSegment.speed === 'number' && Number.isFinite(selectedSegment.speed)) return selectedSegment.speed;
            const parsedManual = parseFloat(selectedSegment.speed);
            if (!isNaN(parsedManual) && parsedManual > 0) return parsedManual;
          }
          if (hasAutoFitSpeed) return Number(selectedSegment.appliedSpeed);
          if (typeof selectedSegment.speed === 'number' && Number.isFinite(selectedSegment.speed)) return selectedSegment.speed;
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

        const displaySpeedNum = draftClipSpeed !== null ? draftClipSpeed : segSpeedNum;
        return (
          <div style={{ padding: '9px 10px', background: 'var(--bg-secondary-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                ល្បឿន (Speed)
              </span>
              <span
                data-testid="clip-speed-badge"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11.5px',
                  color: 'var(--primary-accent)',
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  padding: '1px 7px',
                  borderRadius: 'var(--radius-xs)',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                {displaySpeedNum.toFixed(2)}x · {hasAutoFitSpeed && draftClipSpeed === null ? 'Auto-Fit' : getClipSpeedLabel(displaySpeedNum)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--text-dim)' }}>0.5x</span>
              <SmoothRangeSlider
                min={0.5}
                max={2.0}
                step={0.05}
                value={segSpeedNum}
                disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex)}
                onDraftChange={setDraftClipSpeed}
                onCommit={(val) => {
                  onClipSpeedChange(selectedSegment.id || selectedSegmentIndex, val, selectedSegmentIndex);
                }}
                data-testid="slider-clip-speed"
                style={{ flex: 1, cursor: 'pointer', accentColor: 'var(--primary-accent)', height: 4 }}
                title={`ល្បឿនឃ្លានេះ: ${displaySpeedNum.toFixed(2)}x`}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--text-dim)' }}>2.0x</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {clipPresets.map((p) => {
                const isMatch = Math.abs(displaySpeedNum - p.val) < 0.03;
                return (
                  <button
                    key={p.val}
                    type="button"
                    disabled={regeneratingId === (selectedSegment.id || selectedSegmentIndex)}
                    onClick={() => onClipSpeedChange(selectedSegment.id || selectedSegmentIndex, p.val, selectedSegmentIndex)}
                    style={{
                      height: 26,
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid',
                      borderColor: isMatch ? 'rgba(56, 189, 248, 0.5)' : 'var(--border-subtle)',
                      background: isMatch ? 'rgba(56, 189, 248, 0.16)' : 'var(--bg-desktop)',
                      color: isMatch ? 'var(--primary-accent)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: isMatch ? 700 : 500,
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

      {/* 5. Clean Click Actions Row (Listen | Regenerate | Split | Delete) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            type="button"
            onClick={() => {
              if (selectedSegment.audioUrl && onPlaySegmentAudio) {
                onPlaySegmentAudio(selectedSegment.audioUrl, selectedSegment.id || selectedSegmentIndex, true);
              }
            }}
            disabled={!selectedSegment.audioUrl || isGenerating}
            className="btn-secondary"
            style={{
              minHeight: 34,
              fontSize: 'var(--text-sm)',
              justifyContent: 'center',
              background: String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex)
                ? 'var(--btn-success-bg)'
                : (autoplayBlocked ? 'rgba(245, 158, 11, 0.16)' : undefined),
              borderColor: String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex)
                ? 'rgba(52, 211, 153, 0.5)'
                : (autoplayBlocked ? 'rgba(245, 158, 11, 0.5)' : undefined),
              color: String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex)
                ? '#FFFFFF'
                : (autoplayBlocked ? '#FDE68A' : undefined),
            }}
            title="ស្តាប់សំឡេងឃ្លានេះ"
          >
            {String(playingSegmentId) === String(selectedSegment.id || selectedSegmentIndex) ? (
              <>
                <Pause size={13} />
                <span>កំពុងចាក់</span>
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" />
                <span>ស្តាប់សំឡេង</span>
              </>
            )}
          </button>

          {isKhmerEmpty ? (
            <button
              type="button"
              onClick={handleTranslateThisLine}
              disabled={isRetranslating}
              className="btn-primary"
              style={{ minHeight: 34, fontSize: 'var(--text-sm)', justifyContent: 'center' }}
            >
              {isRetranslating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              <span>{isRetranslating ? 'កំពុងបកប្រែ...' : 'បកប្រែឃ្លានេះ'}</span>
            </button>
          ) : (() => {
            const isRegenerating = regeneratingId === (selectedSegment.id || selectedSegmentIndex);
            return (
              <button
                type="button"
                onClick={() => onSingleRegen(selectedSegment.id || selectedSegmentIndex, selectedSegmentIndex, localKhmerText)}
                disabled={isRegenerating}
                className={selectedSegment.audioUrl ? 'btn-secondary' : 'btn-primary'}
                style={{ minHeight: 34, fontSize: 'var(--text-sm)', justifyContent: 'center' }}
                title="បង្កើតសំឡេង AI សម្រាប់ឃ្លានេះឡើងវិញ"
              >
                {isRegenerating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                <span>{isRegenerating ? 'កំពុងបង្កើត...' : (selectedSegment.audioUrl ? 'បង្កើតសំឡេងវិញ' : 'បង្កើតសំឡេង')}</span>
              </button>
            );
          })()}
        </div>

        {(onSplitClip || onDeleteSegment) && (
          <div style={{ display: 'grid', gridTemplateColumns: onSplitClip && onDeleteSegment ? '1fr auto' : '1fr', gap: 6 }}>
            {onSplitClip && (
              <button
                type="button"
                onClick={() => onSplitClip(currentTime, selectedSegment.id || selectedSegmentIndex)}
                className="btn-secondary"
                style={{ minHeight: 32, fontSize: 'var(--text-sm)', justifyContent: 'center', color: 'var(--primary-accent)' }}
                title="កាត់ឃ្លានេះត្រង់ Playhead (Ctrl+B)"
              >
                <Scissors size={13} />
                <span>កាត់ឃ្លា (Split)</span>
              </button>
            )}

            {onDeleteSegment && (
              <button
                type="button"
                onClick={() => onDeleteSegment(selectedSegment._uid || (selectedSegment.id !== undefined && selectedSegment.id !== null ? selectedSegment.id : selectedSegmentIndex))}
                className="btn-danger"
                style={{ minHeight: 32, minWidth: 76, fontSize: 'var(--text-sm)', justifyContent: 'center' }}
                title="លុបឃ្លានេះ"
              >
                <Trash2 size={13} />
                <span>លុប</span>
              </button>
            )}
          </div>
        )}

        {/* Contextual Action: Release to Auto-Align */}
        {Boolean(selectedSegment?.userShifted) && onReleaseSegmentToAutoAlign && (
          <button
            type="button"
            data-testid="btn-release-auto-align"
            onClick={() => onReleaseSegmentToAutoAlign(selectedSegment._uid || (selectedSegment.id !== undefined && selectedSegment.id !== null ? selectedSegment.id : selectedSegmentIndex))}
            className="btn-secondary"
            style={{ width: '100%', minHeight: 32, fontSize: 'var(--text-sm)', justifyContent: 'center', color: 'var(--primary-accent)', borderColor: 'rgba(56, 189, 248, 0.35)' }}
            title="Release to Auto-Align — លុបទីតាំងដៃ ដើម្បីឲ្យ Auto-Align រៀបឃ្លានេះឡើងវិញ"
          >
            <RefreshCw size={12} />
            <span>ឲ្យ Auto-Align គ្រប់គ្រងវិញ</span>
          </button>
        )}
      </div>

      {/* Autoplay Blocked Notice */}
      {autoplayBlocked && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 'var(--radius-xs)', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)', color: '#FDE68A', fontSize: '12px' }}>
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
          <span>ចុចប៊ូតុង <strong>«ស្តាប់សំឡេង»</strong> ខាងលើដើម្បីចាក់!</span>
        </div>
      )}

      {/* Playback Error Notice */}
      {playbackError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 'var(--radius-xs)', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#FCA5A5', fontSize: '12px' }}>
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
          <span>Audio Error: {playbackError}</span>
        </div>
      )}
    </div>
  );
}
