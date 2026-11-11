import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Clock, Loader2, RotateCcw } from 'lucide-react';
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
  onRetry = null,
  onKill = null,
  onRequestConfirm = null,
}) {
  const targetProgress = isQueued
    ? 0
    : Math.min(100, Math.max(0, Number(activeJob?.progress || 0)));
  const [smoothProgress, setSmoothProgress] = useState(targetProgress || (isQueued ? 0 : 1));
  const [showConsole, setShowConsole] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
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

  const rawMessage = activeJob?.stageMessage || '';
  const message = isFailed
    ? (rawMessage ? rawMessage.replace(/^បរាជ័យ:\s*/, '') : 'ការងារបានបរាជ័យ')
    : (rawMessage || (isQueued ? `ក្នុង Queue (រង់ចាំ Route Key #${assignedKeyNum})...` : 'ដំណើរការ AI Pipeline...'));
  const isDone = smoothProgress >= 100 && !isFailed;

  // Theme styling based on state
  const stateColor = isFailed ? '#ef4444' : (isDone ? '#10b981' : (isQueued ? '#fbbf24' : '#38bdf8'));
  const stateGlow = isFailed
    ? '0 4px 20px rgba(239, 68, 68, 0.22)'
    : (isDone
      ? '0 4px 20px rgba(16, 185, 129, 0.18)'
      : (isQueued ? '0 4px 16px rgba(251, 191, 36, 0.15)' : '0 4px 20px rgba(56, 189, 248, 0.22)'));
  const stateBorder = isFailed
    ? 'rgba(239, 68, 68, 0.55)'
    : (isDone
      ? 'rgba(16, 185, 129, 0.5)'
      : (isQueued ? 'rgba(251, 191, 36, 0.45)' : 'rgba(56, 189, 248, 0.5)'));

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'linear-gradient(135deg, rgba(13, 20, 36, 0.98) 0%, rgba(20, 30, 52, 0.92) 100%)',
        border: `1px solid ${stateBorder}`,
        boxShadow: `${stateGlow}, inset 0 1px 0 rgba(255, 255, 255, 0.08)`,
        borderRadius: 10,
        padding: '11px 13px',
        marginTop: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        transition: 'all 0.25s ease',
      }}
    >
      {/* Header: Stage info + Big Tabular Percentage / Retry button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          {isFailed ? (
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
              color: isFailed ? '#fca5a5' : '#f8fafc',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '-0.01em',
            }}>
              {isFailed
                ? '⚠️ 1. Translate Script បរាជ័យ (Stage Error)'
                : (isDone
                  ? '🎉 📝 1. Translate Script ជោគជ័យ 100%'
                  : (isQueued ? `⏳ 📝 1. Translate Script (រង់ចាំ Route Key #${assignedKeyNum})` : '📝 1. កំពុងវិភាគ & បកប្រែ Script...'))}
            </div>
            <div
              style={{
                fontSize: '0.68rem',
                color: isFailed ? '#f87171' : (isDone ? '#34d399' : (isQueued ? '#fbbf24' : '#94a3b8')),
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

        {/* Counter or Retry Button on Failure / Kill Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
          {isFailed ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (typeof onRetry === 'function') onRetry();
              }}
              style={{
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(220, 38, 38, 0.45) 100%)',
                border: '1px solid rgba(239, 68, 68, 0.65)',
                color: '#ffffff',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: '0.70rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                boxShadow: '0 0 14px rgba(239, 68, 68, 0.35)',
                transition: 'all 0.15s ease',
                flexShrink: 0,
              }}
              title="Retry ដំណើរការ Translation ឡើងវិញ"
            >
              <RotateCcw size={12} />
              <span>Retry 🔄</span>
            </button>
          ) : (
            <>
              {!isDone && onKill && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (typeof onRequestConfirm === 'function') {
                      const confirmed = await onRequestConfirm({
                        variant: 'danger',
                        badge: 'KILL TRANSLATE',
                        title: 'បញ្ឈប់ (Kill) ដំណើរការ Translate នេះ?',
                        subtitle: activeJob?.episodeId ? `Episode: ${activeJob.episodeId}` : '',
                        message: 'តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការ Translate នេះមែនទេ?',
                        confirmLabel: '🛑 បញ្ឈប់ (Kill)',
                        cancelLabel: 'បន្តដំណើរការ',
                      });
                      if (confirmed) onKill(activeJob);
                      return;
                    }
                    setShowKillConfirm(true);
                  }}
                  title="Kill Translate Process"
                  style={{
                    background: 'rgba(239, 68, 68, 0.22)',
                    border: '1px solid rgba(239, 68, 68, 0.55)',
                    color: '#fca5a5',
                    padding: '4px 8px',
                    borderRadius: 6,
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.15s ease',
                  }}
                >
                  🛑 Kill
                </button>
              )}
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'flex-end',
                gap: 1,
                background: 'rgba(0, 0, 0, 0.5)',
                padding: '2px 8px',
                borderRadius: 6,
                border: `1px solid ${stateBorder}`,
                flexShrink: 0,
              }}>
                <span style={{
                  fontSize: '1.25rem',
                  fontWeight: 900,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                  fontVariantNumeric: 'tabular-nums',
                  color: stateColor,
                  textShadow: `0 0 12px ${stateColor}`,
                  letterSpacing: '-0.02em',
                }}>
                  {smoothProgress}
                </span>
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  color: stateColor,
                }}>
                  %
                </span>
              </div>
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
            background: isFailed
              ? 'linear-gradient(90deg, #f87171, #ef4444)'
              : (isDone
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : (isQueued
                  ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                  : 'linear-gradient(90deg, rgba(59, 130, 246, 0.4), #38bdf8, rgba(6, 182, 212, 0.4))')),
            borderRadius: 9999,
            boxShadow: isFailed
              ? '0 0 12px rgba(239, 68, 68, 0.7)'
              : (isDone
                ? '0 0 12px rgba(16, 185, 129, 0.7)'
                : (isQueued ? 'none' : '0 0 12px rgba(56, 189, 248, 0.5)')),
          }}
        />
      </div>

      {/* 4 Milestones */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: smoothProgress >= 20 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 1 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 20 ? '#10b981' : (smoothProgress >= 1 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 1 ? 700 : 500,
          border: smoothProgress >= 1 && smoothProgress < 20 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
          transition: 'all 0.15s ease',
        }}>
          {smoothProgress >= 20 ? '✓ Ingest' : '1. Ingest'}
        </div>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: smoothProgress >= 50 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 20 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 50 ? '#10b981' : (smoothProgress >= 20 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 20 ? 700 : 500,
          border: smoothProgress >= 20 && smoothProgress < 50 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
          transition: 'all 0.15s ease',
        }}>
          {smoothProgress >= 50 ? '✓ OCR' : '2. OCR'}
        </div>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: isFailed && smoothProgress >= 50 && smoothProgress < 100
            ? 'rgba(239, 68, 68, 0.2)'
            : (smoothProgress >= 75 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 50 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)')),
          color: isFailed && smoothProgress >= 50 && smoothProgress < 100
            ? '#f87171'
            : (smoothProgress >= 75 ? '#10b981' : (smoothProgress >= 50 ? '#38bdf8' : '#64748b')),
          fontWeight: smoothProgress >= 50 ? 700 : 500,
          border: isFailed && smoothProgress >= 50 && smoothProgress < 100
            ? '1px solid rgba(239, 68, 68, 0.6)'
            : (smoothProgress >= 50 && smoothProgress < 75 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent'),
          transition: 'all 0.15s ease',
        }}>
          {isFailed && smoothProgress >= 50 && smoothProgress < 100
            ? '⚠️ Gemini'
            : (smoothProgress >= 75 ? '✓ Gemini' : '3. Gemini')}
        </div>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: isDone
            ? 'rgba(16, 185, 129, 0.2)'
            : (smoothProgress >= 75 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: isDone
            ? '#10b981'
            : (smoothProgress >= 75 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 75 ? 700 : 500,
          border: isDone
            ? '1px solid rgba(16, 185, 129, 0.4)'
            : (smoothProgress >= 75 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent'),
          transition: 'all 0.15s ease',
        }}>
          {isDone ? '✓ Script' : '4. Script'}
        </div>
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div style={{
        background: '#070b14',
        border: `1px solid ${isFailed ? 'rgba(239, 68, 68, 0.35)' : 'rgba(56, 189, 248, 0.25)'}`,
        borderRadius: 7,
        overflow: 'hidden',
        boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.8)',
      }}>
        {/* Console Header Toggle */}
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 9px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: 'none',
            borderBottom: showConsole ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Terminal size={11} color={isFailed ? '#ef4444' : '#38bdf8'} />
            <span style={{ fontSize: '0.64rem', fontWeight: 800, color: '#94a3b8', letterSpacing: '0.04em' }}>
              CONSOLE LOGS (Key #{assignedKeyNum})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: stateColor,
              boxShadow: `0 0 6px ${stateColor}`,
            }} />
            <span style={{ fontSize: '0.60rem', color: stateColor, fontWeight: 700 }}>
              {isFailed ? 'FAILED' : (isDone ? 'DONE' : (isQueued ? 'QUEUE' : 'LIVE'))}
            </span>
            {showConsole ? <ChevronUp size={12} color="#64748b" /> : <ChevronDown size={12} color="#64748b" />}
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
        onConfirm={() => {
          setShowKillConfirm(false);
          onKill?.(activeJob);
        }}
        onCancel={() => setShowKillConfirm(false)}
      />
    </div>
  );
}

