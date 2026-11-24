import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Clock, Loader2, RotateCcw, Wrench } from 'lucide-react';
import StudioConfirmDialog from '../../common/StudioConfirmDialog';

/**
 * EpisodeTranslateProgressCard:
 * Dynamic 0% - 100% smooth runner, glowing progress bar, 4 visual milestones,
 * and collapsible Live Console Terminal Drawer for Step 1 (Gemini Route Translation & ASR).
 */
export default function EpisodeTranslateProgressCard({
  activeJob,
  assignedKeyNum,
  isQueued,
  isFailed = false,
  isCancelled = false,
  onRetry = null,
  onRepair = null,
  onKill = null,
  onRequestConfirm = null,
}) {
  const targetProgress = isQueued
    ? 0
    : Math.min(100, Math.max(0, Number(activeJob?.progress ?? activeJob?.percent ?? 0)));
  const [smoothProgress, setSmoothProgress] = useState(targetProgress || (isQueued ? 0 : 1));
  const [showConsole, setShowConsole] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState(null);
  const consoleBottomRef = useRef(null);

  useEffect(() => {
    if (smoothProgress === targetProgress) return;
    const step = targetProgress > smoothProgress ? 1 : -1;
    const diff = Math.abs(targetProgress - smoothProgress);
    const delay = Math.max(16, Math.floor(350 / (diff || 1)));

    const timer = setTimeout(() => {
      setSmoothProgress((prev) => {
        const next = prev + step;
        if ((step > 0 && next >= targetProgress) || (step < 0 && next <= targetProgress)) {
          return targetProgress;
        }
        return next;
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [targetProgress, smoothProgress]);

  const logs = Array.isArray(activeJob?.logs) ? activeJob.logs : [];

  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollTop = consoleBottomRef.current.scrollHeight;
    }
  }, [logs.length, smoothProgress, showConsole]);

  const effectiveStopping = isStopping || Boolean(activeJob?.isStopping);
  const effectiveCancelled = (isCancelled || activeJob?.status === 'cancelled') && !effectiveStopping;
  const effectiveFailed = isFailed && !effectiveCancelled && !effectiveStopping;

  const rawMessage = activeJob?.stageMessage || activeJob?.message || '';
  const message = effectiveStopping
    ? 'កំពុងផ្ញើសញ្ញាបញ្ឈប់ និងរំលត់ដំណើរការ (Stopping...)...'
    : (stopError
      ? `⚠️ ${stopError}`
      : (effectiveCancelled
        ? (rawMessage || 'ការងារត្រូវបានបញ្ឈប់ (Job cancelled)')
        : (effectiveFailed
          ? (rawMessage ? rawMessage.replace(/^បរាជ័យ:\s*/, '') : 'ការងារបានបរាជ័យ')
          : (rawMessage || (isQueued ? `ក្នុង Queue (រង់ចាំ Route Key #${assignedKeyNum})...` : 'ដំណើរការ AI Pipeline...')))));
  const isDone = smoothProgress >= 100 && !effectiveFailed && !effectiveCancelled && !effectiveStopping;

  // Theme styling based on state
  const stateColor = effectiveStopping
    ? '#f59e0b'
    : (effectiveCancelled
      ? '#fb923c'
      : (effectiveFailed ? '#ef4444' : (isDone ? '#10b981' : (isQueued ? '#fbbf24' : '#38bdf8'))));
  const stateGlow = effectiveStopping
    ? '0 4px 16px rgba(245, 158, 11, 0.25)'
    : (effectiveCancelled
      ? '0 4px 16px rgba(251, 146, 60, 0.22)'
      : (effectiveFailed
        ? '0 4px 20px rgba(239, 68, 68, 0.22)'
        : (isDone
          ? '0 4px 20px rgba(16, 185, 129, 0.18)'
          : (isQueued ? '0 4px 16px rgba(251, 191, 36, 0.15)' : '0 4px 20px rgba(56, 189, 248, 0.22)'))));
  const stateBorder = effectiveStopping
    ? 'rgba(245, 158, 11, 0.55)'
    : (effectiveCancelled
      ? 'rgba(251, 146, 60, 0.55)'
      : (effectiveFailed
        ? 'rgba(239, 68, 68, 0.55)'
        : (isDone
          ? 'rgba(16, 185, 129, 0.5)'
          : (isQueued ? 'rgba(251, 191, 36, 0.45)' : 'rgba(56, 189, 248, 0.5)'))));

  const handlePerformKill = async () => {
    if (typeof onKill !== 'function') return;
    setIsStopping(true);
    setStopError(null);
    try {
      const res = await onKill(activeJob);
      if (res && res.success === false) {
        setStopError(res.error || 'Failed to stop translate process');
      }
    } catch (err) {
      setStopError(err?.message || 'Failed to stop translate process');
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'rgba(56, 189, 248, 0.05)',
        border: `1px solid ${stateBorder}`,
        borderRadius: 6,
        padding: '8px 9px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
      }}
    >
      {/* Header: Stage info + Big Tabular Percentage / Retry button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          {effectiveStopping ? (
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(245, 158, 11, 0.2)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f59e0b',
              boxShadow: '0 0 10px rgba(245, 158, 11, 0.35)',
              flexShrink: 0,
            }}>
              <Loader2 size={15} className="animate-spin" />
            </div>
          ) : effectiveCancelled ? (
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(251, 146, 60, 0.2)',
              border: '1px solid rgba(251, 146, 60, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fb923c',
              boxShadow: '0 0 10px rgba(251, 146, 60, 0.35)',
              flexShrink: 0,
            }}>
              <AlertCircle size={15} />
            </div>
          ) : effectiveFailed ? (
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ef4444',
              boxShadow: '0 0 10px rgba(239, 68, 68, 0.4)',
              flexShrink: 0,
            }}>
              <AlertCircle size={15} />
            </div>
          ) : isDone ? (
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.2)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10b981',
              boxShadow: '0 0 10px rgba(16, 185, 129, 0.35)',
              flexShrink: 0,
            }}>
              <CheckCircle2 size={15} />
            </div>
          ) : isQueued ? (
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(251, 191, 36, 0.2)',
              border: '1px solid rgba(251, 191, 36, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fbbf24',
              flexShrink: 0,
            }}>
              <Clock size={14} />
            </div>
          ) : (
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(56, 189, 248, 0.2)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
              boxShadow: '0 0 12px rgba(56, 189, 248, 0.35)',
              flexShrink: 0,
            }}>
              <Loader2 size={15} className="animate-spin" />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: '0.80rem',
              fontWeight: 800,
              color: effectiveStopping ? '#fde68a' : (effectiveCancelled ? '#fed7aa' : (effectiveFailed ? '#fca5a5' : '#f8fafc')),
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '-0.01em',
            }}>
              {effectiveStopping
                ? '🛑 1. កំពុងបញ្ឈប់ (Stopping...)'
                : (effectiveCancelled
                  ? '🛑 1. Translate Script ត្រូវបានបញ្ឈប់ (Cancelled)'
                  : (effectiveFailed
                    ? '⚠️ 1. Translate Script បរាជ័យ (Stage Error)'
                    : (isDone
                      ? '🎉 📝 1. Translate Script ជោគជ័យ 100%'
                      : (isQueued
                        ? `⏳ 📝 1. Translate Script (រង់ចាំ Route Key #${assignedKeyNum})`
                        : ((activeJob?.mode === 'repair_broken' || activeJob?.type === 'repair_broken')
                          ? '✍️ 1. កំពុងជួសជុល Script...'
                          : '📝 1. កំពុងវិភាគ & បកប្រែ...')))))}
            </div>
            <div
              style={{
                fontSize: '0.68rem',
                color: effectiveStopping ? '#fde68a' : (effectiveCancelled ? '#fb923c' : (effectiveFailed ? '#f87171' : (isDone ? '#34d399' : (isQueued ? '#fbbf24' : '#94a3b8')))),
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={message}
            >
              {message}
            </div>
          </div>
        </div>

        {/* Counter or Retry/Repair Buttons on Failure/Cancellation / Kill Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
          {(effectiveFailed || effectiveCancelled) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {typeof onRepair === 'function' && !effectiveCancelled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRepair();
                  }}
                  style={{
                    background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.28) 0%, rgba(234, 88, 12, 0.45) 100%)',
                    border: '1px solid rgba(251, 146, 60, 0.65)',
                    color: '#ffedd5',
                    borderRadius: 6,
                    padding: '4px 9px',
                    fontSize: '0.70rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    boxShadow: '0 0 10px rgba(251, 146, 60, 0.3)',
                    flexShrink: 0,
                  }}
                  title="ជួសជុលតែឃ្លាដែលខូច (Repair broken segments)"
                >
                  <Wrench size={11} />
                  <span>ជួសជុល</span>
                </button>
              )}
              <button
                type="button"
                disabled={effectiveStopping}
                onClick={(e) => {
                  e.stopPropagation();
                  if (effectiveStopping) return;
                  if (typeof onRetry === 'function') onRetry();
                }}
                style={{
                  background: effectiveCancelled
                    ? 'linear-gradient(135deg, rgba(251, 146, 60, 0.28) 0%, rgba(234, 88, 12, 0.45) 100%)'
                    : 'linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(220, 38, 38, 0.45) 100%)',
                  border: effectiveCancelled
                    ? '1px solid rgba(251, 146, 60, 0.65)'
                    : '1px solid rgba(239, 68, 68, 0.65)',
                  color: '#ffffff',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: '0.70rem',
                  fontWeight: 800,
                  cursor: effectiveStopping ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  boxShadow: effectiveCancelled
                    ? '0 0 14px rgba(251, 146, 60, 0.35)'
                    : '0 0 14px rgba(239, 68, 68, 0.35)',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                  opacity: effectiveStopping ? 0.6 : 1,
                }}
                title={effectiveStopping ? 'កំពុងរង់ចាំ Worker បញ្ឈប់...' : 'Retry ដំណើរការ Translation ឡើងវិញ (ធ្វើឡើងវិញ)'}
              >
                <RotateCcw size={12} />
                <span>ធ្វើឡើងវិញ (Retry)</span>
              </button>
            </div>
          ) : (
            <>
              {!isDone && onKill && (
                <button
                  type="button"
                  disabled={effectiveStopping}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (effectiveStopping) return;
                    if (typeof onRequestConfirm === 'function') {
                      const confirmed = await onRequestConfirm({
                        variant: 'danger',
                        badge: 'KILL TRANSLATE',
                        title: 'បញ្ឈប់ (Kill) ដំណើរការ Translate នេះ?',
                        subtitle: activeJob?.episodeId ? `Episode: ${activeJob.episodeId}` : '',
                        message: 'តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការ Translate នេះមែនទេ?',
                        confirmLabel: 'បញ្ឈប់ (Kill)',
                        cancelLabel: 'បន្តដំណើរការ',
                      });
                      if (confirmed) {
                        await handlePerformKill();
                      }
                      return;
                    }
                    setShowKillConfirm(true);
                  }}
                  title="Kill Translate Process"
                  style={{
                    background: effectiveStopping ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.16)',
                    border: effectiveStopping ? '1px solid rgba(245, 158, 11, 0.48)' : '1px solid rgba(239, 68, 68, 0.42)',
                    color: effectiveStopping ? '#fde68a' : '#fca5a5',
                    height: 20,
                    padding: '0 6px',
                    borderRadius: 4,
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: effectiveStopping ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    whiteSpace: 'nowrap',
                    opacity: effectiveStopping ? 0.75 : 1,
                  }}
                >
                  {effectiveStopping ? (
                    <>
                      <Loader2 size={10} className="animate-spin" />
                      <span>Stop...</span>
                    </>
                  ) : (
                    <span>Stop</span>
                  )}
                </button>
              )}
              <span style={{
                fontSize: '12px',
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                color: stateColor,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                {smoothProgress}%
              </span>
            </>
          )}
        </div>
      </div>

      {/* Glowing Progress Bar Track */}
      <div style={{
        width: '100%',
        height: 6,
        background: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 9999,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div
          style={{
            height: '100%',
            width: `${Math.max(isQueued ? 0 : 3, Math.min(100, smoothProgress))}%`,
            transition: 'width 0.22s ease-out',
            background: isStopping
              ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
              : (effectiveCancelled
                ? 'linear-gradient(90deg, #ea580c, #fb923c)'
                : (effectiveFailed
                  ? 'linear-gradient(90deg, #f87171, #ef4444)'
                  : (isDone
                    ? 'linear-gradient(90deg, #10b981, #34d399)'
                    : (isQueued
                      ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                      : 'linear-gradient(90deg, rgba(59, 130, 246, 0.4), #38bdf8, rgba(6, 182, 212, 0.4))')))),
            borderRadius: 9999,
            boxShadow: isStopping
              ? '0 0 12px rgba(245, 158, 11, 0.6)'
              : (effectiveCancelled
                ? '0 0 12px rgba(251, 146, 60, 0.6)'
                : (effectiveFailed
                  ? '0 0 12px rgba(239, 68, 68, 0.7)'
                  : (isDone
                    ? '0 0 12px rgba(16, 185, 129, 0.7)'
                    : (isQueued ? 'none' : '0 0 12px rgba(56, 189, 248, 0.5)')))),
          }}
        />
      </div>

      {/* 4 Crisp Single-Line Milestones */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 3 }}>
        <div style={{
          padding: '3px 2px',
          borderRadius: 4,
          fontSize: '10px',
          lineHeight: 1.2,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          background: smoothProgress >= 20 ? 'rgba(16, 185, 129, 0.14)' : (smoothProgress >= 1 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 20 ? '#34d399' : (smoothProgress >= 1 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 1 ? 700 : 500,
          border: smoothProgress >= 1 && smoothProgress < 20 ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent',
        }}>
          {smoothProgress >= 20 ? '✓ Ingest' : 'Ingest'}
        </div>
        <div style={{
          padding: '3px 2px',
          borderRadius: 4,
          fontSize: '10px',
          lineHeight: 1.2,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          background: smoothProgress >= 50 ? 'rgba(16, 185, 129, 0.14)' : (smoothProgress >= 20 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 50 ? '#34d399' : (smoothProgress >= 20 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 20 ? 700 : 500,
          border: smoothProgress >= 20 && smoothProgress < 50 ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent',
        }}>
          {smoothProgress >= 50 ? '✓ OCR' : 'OCR'}
        </div>
        <div style={{
          padding: '3px 2px',
          borderRadius: 4,
          fontSize: '10px',
          lineHeight: 1.2,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          background: isFailed && smoothProgress >= 50 && smoothProgress < 100
            ? 'rgba(239, 68, 68, 0.2)'
            : (smoothProgress >= 75 ? 'rgba(16, 185, 129, 0.14)' : (smoothProgress >= 50 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)')),
          color: isFailed && smoothProgress >= 50 && smoothProgress < 100
            ? '#f87171'
            : (smoothProgress >= 75 ? '#34d399' : (smoothProgress >= 50 ? '#38bdf8' : '#64748b')),
          fontWeight: smoothProgress >= 50 ? 700 : 500,
          border: isFailed && smoothProgress >= 50 && smoothProgress < 100
            ? '1px solid rgba(239, 68, 68, 0.6)'
            : (smoothProgress >= 50 && smoothProgress < 75 ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent'),
        }}>
          {isFailed && smoothProgress >= 50 && smoothProgress < 100
            ? '! Gemini'
            : (smoothProgress >= 75 ? '✓ Gemini' : 'Gemini')}
        </div>
        <div style={{
          padding: '3px 2px',
          borderRadius: 4,
          fontSize: '10px',
          lineHeight: 1.2,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          background: isDone
            ? 'rgba(16, 185, 129, 0.18)'
            : (smoothProgress >= 75 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: isDone
            ? '#34d399'
            : (smoothProgress >= 75 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 75 ? 700 : 500,
          border: isDone
            ? '1px solid rgba(16, 185, 129, 0.4)'
            : (smoothProgress >= 75 ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent'),
        }}>
          {isDone ? '✓ Script' : 'Script'}
        </div>
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div className="translate-console-drawer" style={{
        background: '#07080C',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        {/* Console Header Toggle */}
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          title={`CONSOLE LOGS (Gemini AI Key #${assignedKeyNum})`}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '4px 8px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: 'none',
            borderBottom: showConsole ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
            <Terminal size={10} color={isFailed ? '#ef4444' : '#38bdf8'} style={{ flexShrink: 0 }} />
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#94a3b8',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'left',
            }}>
              CONSOLE LOGS (Gemini AI Key #{assignedKeyNum})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <span style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: stateColor,
            }} />
            <span style={{ fontSize: '9.5px', color: stateColor, fontWeight: 700 }}>
              {isFailed ? 'FAILED' : (isDone ? 'DONE' : (isQueued ? 'QUEUE' : 'LIVE'))}
            </span>
            {showConsole ? <ChevronUp size={11} color="#64748b" /> : <ChevronDown size={11} color="#64748b" />}
          </div>
        </button>

        {/* Console Body */}
        {showConsole && (
          <div
            ref={consoleBottomRef}
            style={{
              maxHeight: 105,
              overflowY: 'auto',
              padding: '7px 9px',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              fontSize: '0.64rem',
              lineHeight: 1.5,
              color: '#cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            {logs.length > 0 ? (
              logs.map((log, lIdx) => {
                const timeStr = log.timestamp || (log.time ? new Date(log.time).toLocaleTimeString() : new Date().toLocaleTimeString());
                const prg = typeof log.progress === 'number' ? log.progress : 0;
                const isFail = log.message?.includes('បរាជ័យ') || log.message?.includes('Error') || log.message?.includes('401') || log.message?.includes('failed');
                const logColor = isFail ? '#f87171' : (prg >= 100 ? '#10b981' : (prg >= 50 ? '#38bdf8' : '#94a3b8'));
                return (
                  <div key={lIdx} style={{ color: logColor, wordBreak: 'break-word' }}>
                    <span style={{ color: '#64748b' }}>[{timeStr}]</span> <span style={{ color: '#0ea5e9' }}>[{prg}%]</span> {log.message || log.stage}
                  </div>
                );
              })
            ) : isFailed ? (
              <div style={{ color: '#f87171' }}>
                [{new Date().toLocaleTimeString()}] ❌ {message}
              </div>
            ) : isQueued ? (
              <div style={{ color: '#fbbf24' }}>
                [{new Date().toLocaleTimeString()}] [0%] ⏳ Enqueued: រង់ចាំ Worker Slot ទំនេរ (Gemini Key #{assignedKeyNum})...
              </div>
            ) : (
              <>
                <div style={{ color: '#64748b' }}>
                  [{new Date().toLocaleTimeString()}] [0%] 🚀 Start pipeline: Key #{assignedKeyNum} routed...
                </div>
                {smoothProgress >= 10 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [10%] 🔍 Ingest: ផ្ទៀងផ្ទាត់វីដេអូភាគ & បង្កើត Proxies...
                  </div>
                )}
                {smoothProgress >= 25 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [25%] 📊 Video OCR: ស្កេន Hardcoded Subtitles តាម Video Chunks...
                  </div>
                )}
                {smoothProgress >= 50 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [50%] 🎙️ Gemini ASR: បញ្ជូន Chunk Audio ទៅ Gemini 3.5...
                  </div>
                )}
                {smoothProgress >= 75 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [75%] 📝 Khmer Script: Reconcile OCR + ASR បង្កើតឃ្លាខ្មែរ...
                  </div>
                )}
                {smoothProgress >= 100 && (
                  <div style={{ color: '#10b981' }}>
                    [{new Date().toLocaleTimeString()}] [100%] 🎉 完成: រៀបចំ Script សម្រេច 100%
                  </div>
                )}
              </>
            )}
            {!isDone && !isQueued && !isFailed && (
              <div style={{ color: '#38bdf8', opacity: 0.8, animation: 'pulse 1s infinite' }}>
                ▍
              </div>
            )}
          </div>
        )}
      </div>
      <StudioConfirmDialog
        isOpen={showKillConfirm}
        variant="danger"
        badge="KILL TRANSLATE"
        title="បញ្ឈប់ (Kill) ដំណើរការ Translate នេះ?"
        subtitle={activeJob?.episodeId ? `Episode: ${activeJob.episodeId}` : ''}
        message="តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការ Translate នេះមែនទេ?"
        confirmLabel="🛑 បញ្ឈប់ (Kill)"
        cancelLabel="បន្តដំណើរការ"
        onConfirm={async () => {
          setShowKillConfirm(false);
          await handlePerformKill();
        }}
        onCancel={() => setShowKillConfirm(false)}
      />
    </div>
  );
}

