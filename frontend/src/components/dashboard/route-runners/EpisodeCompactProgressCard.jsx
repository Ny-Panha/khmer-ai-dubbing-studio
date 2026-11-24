import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp, CheckCircle2, Loader2, AlertCircle, Sparkles, Square } from 'lucide-react';
import StudioConfirmDialog from '../../common/StudioConfirmDialog';

/**
 * EpisodeCompactProgressCard:
 * Dynamic 0% - 100% smooth runner, glowing royal-purple progress bar, 4 visual milestones,
 * and collapsible Live Console Terminal Drawer for Step 1.5 (Auto Compact Script - ខ្លីចំអត្ថន័យ).
 */
export default function EpisodeCompactProgressCard({
  liveStats,
  ep,
  onKill = null,
  onRequestConfirm = null,
  isCurrentRunning = true,
}) {
  const isDone = Boolean(liveStats?.isDone || liveStats?.status === 'completed' || (liveStats?.percent ?? 0) >= 100);
  const isFailed = Boolean(liveStats?.isFailed || liveStats?.status === 'error');
  const isQueued = !isCurrentRunning && !isDone && !isFailed;
  const targetPercent = isQueued ? 0 : Math.min(100, Math.max(0, liveStats?.percent ?? liveStats?.progress ?? 10));
  const [smoothProgress, setSmoothProgress] = useState(targetPercent || 5);
  const [showConsole, setShowConsole] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
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

  const rawLogs = Array.isArray(liveStats?.logs) ? liveStats.logs : [];
  const logs = rawLogs.length > 0 ? rawLogs : [
    {
      time: new Date().toLocaleTimeString(),
      progress: smoothProgress,
      message: liveStats?.stageMessage || liveStats?.message || (isDone ? '✨ បម្លែងខ្លីចំអត្ថន័យរួចរាល់ 100%' : 'កំពុងវិភាគ & បម្លែង Script ខ្លីចំអត្ថន័យ...'),
    },
  ];

  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollTop = consoleBottomRef.current.scrollHeight;
    }
  }, [logs.length, smoothProgress, showConsole]);

  const stateColor = isFailed ? '#f87171' : (isDone ? '#34d399' : '#C084FC');
  const stateBorder = isFailed ? 'rgba(239, 68, 68, 0.45)' : (isDone ? 'rgba(16, 185, 129, 0.45)' : 'rgba(168, 85, 247, 0.45)');

  const milestones = [
    { key: 'scan', label: 'Scan', done: smoothProgress >= 25, active: smoothProgress >= 1 && smoothProgress < 25 },
    { key: 'compact', label: 'Compact', done: smoothProgress >= 60, active: smoothProgress >= 25 && smoothProgress < 60 },
    { key: 'lipsync', label: 'Lip-Sync', done: smoothProgress >= 85, active: smoothProgress >= 60 && smoothProgress < 85 },
    { key: 'save', label: 'Save', done: isDone, active: !isDone && smoothProgress >= 85 },
  ];

  const currentMessage = liveStats?.stageMessage || liveStats?.message || (isDone ? 'បម្លែង Script ខ្លីចំអត្ថន័យរួចរាល់ 100%' : 'កំពុងបង្រួមពាក្យវែង និងសម្រួល Lip-Sync...');

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      data-testid={`compact-progress-card-${ep?.id || 'active'}`}
      style={{
        background: 'rgba(147, 51, 234, 0.07)',
        border: `1px solid ${stateBorder}`,
        borderRadius: 6,
        padding: '8px 9px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        boxShadow: isDone ? '0 0 10px rgba(16, 185, 129, 0.18)' : '0 0 12px rgba(168, 85, 247, 0.22)',
      }}
    >
      {/* Row 1: Single-Line Title + Stop + Tabular % */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
          {isFailed ? (
            <AlertCircle size={13} color="#f87171" style={{ flexShrink: 0 }} />
          ) : isDone ? (
            <CheckCircle2 size={13} color="#34d399" style={{ flexShrink: 0 }} />
          ) : (
            <Sparkles size={13} color="#C084FC" style={{ flexShrink: 0 }} />
          )}
          <span style={{
            fontSize: '11.5px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            ✨ ខ្លីចំអត្ថន័យ
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {isCurrentRunning && onKill && (
            <button
              type="button"
              data-testid={`btn-stop-compact-${ep?.id}`}
              onClick={() => {
                if (typeof onRequestConfirm === 'function') {
                  onRequestConfirm({
                    title: `បញ្ឈប់ការបម្លែងខ្លីចំអត្ថន័យ ភាគ ${ep?.episodeNumber || ep?.id}?`,
                    message: `តើអ្នកចង់បញ្ឈប់ការបម្លែង Script ខ្លីចំអត្ថន័យលើភាគនេះដែរឬទេ?`,
                    confirmLabel: 'បញ្ឈប់ (Stop)',
                    cancelLabel: 'បន្តដំណើរការ',
                    isDestructive: true,
                    onConfirm: () => onKill(ep),
                  });
                } else {
                  setShowKillConfirm(true);
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                height: 20,
                padding: '0 6px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.16)',
                border: '1px solid rgba(239, 68, 68, 0.42)',
                color: '#fca5a5',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="បញ្ឈប់ Auto Compact"
            >
              <Square size={8} fill="currentColor" />
              <span>Stop</span>
            </button>
          )}

          <span style={{
            fontSize: '12px',
            fontWeight: 800,
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            color: stateColor,
            whiteSpace: 'nowrap',
          }}>
            {smoothProgress}%
          </span>
        </div>
      </div>

      {/* Row 2: Full-Width Live Status Line */}
      <div
        title={currentMessage}
        style={{
          fontSize: '10.5px',
          color: isFailed ? '#fca5a5' : 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.3,
        }}
      >
        {currentMessage}
      </div>

      {/* Progress Bar Track */}
      <div style={{
        width: '100%',
        height: 4,
        background: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 9999,
        overflow: 'hidden',
      }}>
        <div
          style={{
            height: '100%',
            width: `${Math.max(4, Math.min(100, smoothProgress))}%`,
            transition: 'width 0.22s ease-out',
            background: isFailed
              ? '#ef4444'
              : (isDone
                ? '#10b981'
                : 'linear-gradient(90deg, #9333ea 0%, #a855f7 50%, #c084fc 100%)'),
            borderRadius: 9999,
          }}
        />
      </div>

      {/* 4 Crisp Single-Line Milestones (Never Wraps to 2 Lines) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 3 }}>
        {milestones.map((m) => (
          <div
            key={m.key}
            style={{
              padding: '3px 2px',
              borderRadius: 4,
              fontSize: '10px',
              lineHeight: 1.2,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              background: m.done
                ? 'rgba(16, 185, 129, 0.14)'
                : m.active
                  ? 'rgba(168, 85, 247, 0.2)'
                  : 'rgba(255, 255, 255, 0.04)',
              color: m.done ? '#34d399' : m.active ? '#E9D5FF' : '#64748b',
              fontWeight: (m.done || m.active) ? 700 : 500,
              border: m.active ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
            }}
          >
            {m.done ? `✓ ${m.label}` : m.label}
          </div>
        ))}
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div className="compact-console-drawer" style={{
        background: '#07080C',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          title="CONSOLE LOGS (Auto Compact Script Engine)"
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
            <Terminal size={10} color={isFailed ? '#f87171' : (isDone ? '#34d399' : '#C084FC')} style={{ flexShrink: 0 }} />
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#94a3b8',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'left',
            }}>
              CONSOLE LOGS (Auto Compact Script Engine)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: '#64748b' }}>
              {logs.length}
            </span>
            {showConsole ? <ChevronUp size={11} color="#64748b" /> : <ChevronDown size={11} color="#64748b" />}
          </div>
        </button>

        {showConsole && (
          <div
            ref={consoleBottomRef}
            style={{
              padding: '7px 9px',
              maxHeight: 140,
              minHeight: 50,
              overflowY: 'auto',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              fontSize: '0.64rem',
              lineHeight: 1.5,
              color: '#cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: '#64748b', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={10} className="animate-spin" color="#C084FC" />
                <span>រង់ចាំ Console Logs ពី Compact Service...</span>
              </div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span style={{ color: '#C084FC', opacity: 0.7, flexShrink: 0, fontSize: '0.58rem' }}>
                    [{log.time || log.timestamp || 'LOG'}]
                  </span>
                  <span style={{
                    color: log.message?.includes('✅') || log.message?.includes('ជោគជ័យ') || log.message?.includes('រួចរាល់')
                      ? '#34d399'
                      : log.message?.includes('❌') || log.message?.includes('Failed')
                        ? '#f87171'
                        : log.message?.includes('✨')
                          ? '#E9D5FF'
                          : '#e2e8f0',
                    wordBreak: 'break-word',
                  }}>
                    {log.message || log.text || (typeof log === 'string' ? log : '')}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showKillConfirm && (
        <StudioConfirmDialog
          isOpen={showKillConfirm}
          title={`បញ្ឈប់ Auto Compact ភាគ ${ep?.episodeNumber || ep?.id}?`}
          message="តើអ្នកពិតជាចង់បញ្ឈប់ការបម្លែង Script ខ្លីចំអត្ថន័យលើភាគនេះមែនទេ?"
          confirmLabel="បញ្ឈប់ (Stop)"
          cancelLabel="បន្តដំណើរការ"
          isDestructive={true}
          onConfirm={() => {
            setShowKillConfirm(false);
            if (onKill) onKill(ep);
          }}
          onCancel={() => setShowKillConfirm(false)}
        />
      )}
    </div>
  );
}
