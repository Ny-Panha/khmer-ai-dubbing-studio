import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

/**
 * EpisodeDemucsProgressCard:
 * Dynamic 0% - 100% smooth runner, glowing sky blue progress bar, 4 visual milestones,
 * and collapsible Live Console Terminal Drawer for Step 3 (Demucs AI Clean BGM & Vocal Separation).
 */
export default function EpisodeDemucsProgressCard({ liveStats, ep, onKill }) {
  const modelName = liveStats?.model || ep?.demucsModel || ep?.model || 'htdemucs';
  const targetPercent = Math.min(100, Math.max(0, liveStats?.percent ?? 5));
  const [smoothProgress, setSmoothProgress] = useState(targetPercent || 1);
  const [showConsole, setShowConsole] = useState(true);
  const consoleBottomRef = useRef(null);

  useEffect(() => {
    if (smoothProgress === targetPercent) return;
    const step = targetPercent > smoothProgress ? 1 : -1;
    const diff = Math.abs(targetPercent - smoothProgress);
    const delay = Math.max(16, Math.floor(250 / (diff || 1)));
    const timer = setTimeout(() => {
      setSmoothProgress((prev) => {
        const next = prev + step;
        if ((step > 0 && next >= targetPercent) || (step < 0 && next <= targetPercent)) {
          return targetPercent;
        }
        return next;
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [targetPercent, smoothProgress]);

  const isDone = Boolean(liveStats?.isDone || smoothProgress >= 100);
  const isFailed = Boolean(liveStats?.isFailed);
  const logs = Array.isArray(liveStats?.logs) ? liveStats.logs : [];

  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollTop = consoleBottomRef.current.scrollHeight;
    }
  }, [logs.length, smoothProgress, showConsole]);

  const stateColor = isFailed ? '#ef4444' : (isDone ? '#10b981' : '#38bdf8');
  const stateBorder = isFailed ? 'rgba(239, 68, 68, 0.55)' : (isDone ? 'rgba(16, 185, 129, 0.5)' : 'rgba(56, 189, 248, 0.55)');
  const stateGlow = isFailed ? '0 4px 20px rgba(239, 68, 68, 0.22)' : (isDone ? '0 4px 20px rgba(16, 185, 129, 0.22)' : '0 4px 20px rgba(56, 189, 248, 0.25)');

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'linear-gradient(135deg, rgba(10, 20, 35, 0.98) 0%, rgba(15, 30, 50, 0.92) 100%)',
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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: isFailed ? 'rgba(239, 68, 68, 0.2)' : (isDone ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)'),
            border: `1px solid ${isFailed ? 'rgba(239, 68, 68, 0.4)' : (isDone ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.4)')}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: stateColor,
            boxShadow: `0 0 10px ${isFailed ? 'rgba(239, 68, 68, 0.4)' : (isDone ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.4)')}`,
            flexShrink: 0,
          }}>
            {isFailed ? <AlertCircle size={15} /> : (isDone ? <CheckCircle2 size={15} /> : <Loader2 size={15} className="animate-spin" />)}
          </div>
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
              {isFailed ? '⚠️ បរាជ័យក្នុងការបំបែកសំឡេង' : (isDone ? '🎉 បំបែកសំឡេងដើម Demucs រួចរាល់ ១០០%' : '🎧 កំពុងបំបែកសំឡេងដើម (Demucs AI)...')}
            </div>
            <div style={{
              fontSize: '0.68rem',
              color: isFailed ? '#f87171' : (isDone ? '#34d399' : '#38bdf8'),
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {isFailed ? 'សូមពិនិត្យមើល Console Logs ខាងក្រោម...' : (isDone ? 'Clean BGM & Sound Effects Isolated' : (liveStats?.message || `AI Deep Learning Stem Separation (${modelName})...`))}
            </div>
          </div>
        </div>

        {/* Tabular Percentage & Kill Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {!isDone && !isFailed && onKill && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការបំបែកសំឡេង Demucs នេះមែនទេ?')) {
                  onKill(ep);
                }
              }}
              title="Kill Demucs Process"
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
            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: stateColor }}>%</span>
          </div>
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
            width: `${Math.max(3, Math.min(100, smoothProgress))}%`,
            transition: 'width 0.22s ease-out',
            background: isFailed
              ? 'linear-gradient(90deg, #f87171, #ef4444)'
              : (isDone
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : 'linear-gradient(90deg, #0284c7, #38bdf8)'),
            borderRadius: 9999,
            boxShadow: isFailed
              ? '0 0 12px rgba(239, 68, 68, 0.7)'
              : (isDone
                ? '0 0 12px rgba(16, 185, 129, 0.7)'
                : '0 0 12px rgba(56, 189, 248, 0.7)'),
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
          {smoothProgress >= 50 ? '✓ Demucs AI' : '2. Demucs AI'}
        </div>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: smoothProgress >= 85 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 50 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 85 ? '#10b981' : (smoothProgress >= 50 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 50 ? 700 : 500,
          border: smoothProgress >= 50 && smoothProgress < 85 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
          transition: 'all 0.15s ease',
        }}>
          {smoothProgress >= 85 ? '✓ Isolate' : '3. Isolate'}
        </div>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: isDone ? 'rgba(16, 185, 129, 0.2)' : (smoothProgress >= 85 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: isDone ? '#10b981' : (smoothProgress >= 85 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 85 ? 700 : 500,
          border: isDone ? '1px solid rgba(16, 185, 129, 0.4)' : (smoothProgress >= 85 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent'),
          transition: 'all 0.15s ease',
        }}>
          {isDone ? '✓ Clean BGM' : '4. Clean BGM'}
        </div>
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div style={{
        background: '#070b14',
        border: `1px solid ${isFailed ? 'rgba(239, 68, 68, 0.35)' : (isDone ? 'rgba(16, 185, 129, 0.35)' : 'rgba(56, 189, 248, 0.35)')}`,
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
            <Terminal size={11} color={isFailed ? '#ef4444' : (isDone ? '#34d399' : '#38bdf8')} />
            <span style={{ fontSize: '0.64rem', fontWeight: 800, color: '#94a3b8', letterSpacing: '0.04em' }}>
              CONSOLE LOGS (Demucs AI Model: {modelName})
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
              {isFailed ? 'FAILED' : (isDone ? 'DONE' : 'LIVE')}
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
                const timeStr = log.time || new Date().toLocaleTimeString();
                const prg = typeof log.progress === 'number' ? log.progress : 0;
                const isFail = log.message?.includes('បរាជ័យ') || log.message?.includes('Error') || log.message?.includes('failed');
                const logColor = isFail ? '#f87171' : (prg >= 100 ? '#10b981' : (prg >= 50 ? '#38bdf8' : '#7dd3fc'));
                return (
                  <div key={lIdx} style={{ color: logColor, wordBreak: 'break-word' }}>
                    <span style={{ color: '#64748b' }}>[{timeStr}]</span> <span style={{ color: '#38bdf8' }}>[{prg}%]</span> {log.message}
                  </div>
                );
              })
            ) : (
              <div style={{ color: '#7dd3fc' }}>
                [{new Date().toLocaleTimeString()}] [{smoothProgress}%] 🎧 កំពុងដំណើរការ Demucs Stem Separation (Vocal Extraction & Clean BGM)...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

