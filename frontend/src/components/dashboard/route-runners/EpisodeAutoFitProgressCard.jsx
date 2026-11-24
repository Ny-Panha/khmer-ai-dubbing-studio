import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp, CheckCircle2, Loader2, AlertCircle, Zap, Square } from 'lucide-react';
import StudioConfirmDialog from '../../common/StudioConfirmDialog';

/**
 * EpisodeAutoFitProgressCard:
 * Dynamic 0% - 100% smooth runner, glowing golden-amber progress bar, 4 visual milestones,
 * and collapsible Live Console Terminal Drawer for Step 3 (Auto-Fit Speech Speed).
 */
export default function EpisodeAutoFitProgressCard({ liveStats, ep, onKill = null, onRequestConfirm = null, isCurrentRunning = true }) {
  const [internalLiveStats, setInternalLiveStats] = useState(null);

  useEffect(() => {
    if (!isCurrentRunning) return;
    const sId = ep?.seriesId || 'drama_project';
    const epId = ep?.id;
    if (!epId) return;

    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/audio/autofit-progress?seriesId=${encodeURIComponent(sId)}&episodeId=${encodeURIComponent(epId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.success && active) {
          const pct = Math.min(100, Math.max(0, Number(data.progress || 0)));
          if (pct > 0 || (Array.isArray(data.logs) && data.logs.length > 0)) {
            setInternalLiveStats(data);
          }
        }
      } catch (_) {}
    };

    poll();
    const timer = setInterval(poll, 800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isCurrentRunning, ep]);

  const currentLive = (internalLiveStats && Number(internalLiveStats.progress || 0) > Number(liveStats?.percent || 0))
    ? {
        ...internalLiveStats,
        percent: internalLiveStats.progress,
        logs: (internalLiveStats.logs?.length || 0) >= (liveStats?.logs?.length || 0) ? internalLiveStats.logs : (liveStats?.logs || []),
      }
    : (liveStats || internalLiveStats);

  const isDone = Boolean(currentLive?.isDone || currentLive?.status === 'completed' || (currentLive?.percent ?? 0) >= 100);
  const isFailed = Boolean(currentLive?.isFailed || currentLive?.status === 'error');
  const isQueued = !isCurrentRunning && !isDone && !isFailed;
  const targetPercent = isQueued ? 0 : Math.min(100, Math.max(0, currentLive?.percent ?? currentLive?.progress ?? 10));
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

  const logs = Array.isArray(currentLive?.logs) ? currentLive.logs : [];

  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollTop = consoleBottomRef.current.scrollHeight;
    }
  }, [logs.length, smoothProgress, showConsole]);

  const stateColor = isFailed ? '#f87171' : (isDone ? '#34d399' : '#FBBF24');
  const stateBorder = isFailed ? 'rgba(239, 68, 68, 0.45)' : (isDone ? 'rgba(16, 185, 129, 0.45)' : 'rgba(245, 158, 11, 0.45)');

  const milestones = [
    { key: 'scan', label: 'Scan', done: smoothProgress >= 25, active: smoothProgress >= 1 && smoothProgress < 25 },
    { key: 'stretch', label: 'Stretch', done: smoothProgress >= 60, active: smoothProgress >= 25 && smoothProgress < 60 },
    { key: 'align', label: 'Align', done: smoothProgress >= 85, active: smoothProgress >= 60 && smoothProgress < 85 },
    { key: 'sync', label: 'Sync', done: isDone, active: !isDone && smoothProgress >= 85 },
  ];

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'rgba(245, 158, 11, 0.06)',
        border: `1px solid ${stateBorder}`,
        borderRadius: 6,
        padding: '8px 9px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
      }}
    >
      {/* Row 1: Single-Line Title + Stop + Tabular % (Zero Wrapping) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
          {isFailed ? (
            <AlertCircle size={13} color="#f87171" style={{ flexShrink: 0 }} />
          ) : isDone ? (
            <CheckCircle2 size={13} color="#34d399" style={{ flexShrink: 0 }} />
          ) : (
            <Zap size={13} color="#FBBF24" style={{ flexShrink: 0 }} />
          )}
          <span style={{
            fontSize: '11.5px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            3. Auto-Fit Speed
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {isCurrentRunning && onKill && (
            <button
              type="button"
              onClick={() => {
                if (typeof onRequestConfirm === 'function') {
                  onRequestConfirm({
                    title: `បញ្ឈប់ Auto-Fit Speed ភាគ ${ep?.episodeNumber || ep?.id}?`,
                    message: `តើអ្នកចង់បញ្ឈប់ការ Auto-Fit Speed លើភាគនេះដែរឬទេ?`,
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
              title="បញ្ឈប់ Auto-Fit Speed"
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
        title={currentLive?.message || ''}
        style={{
          fontSize: '10.5px',
          color: isFailed ? '#fca5a5' : 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.3,
        }}
      >
        {currentLive?.message || (isDone ? 'ពន្លឿនឃ្លា Fit ស្មើ Subtitle 100%' : 'កំពុងវិភាគ និងពន្លឿនសំឡេង...')}
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
            background: isFailed ? '#ef4444' : (isDone ? '#10b981' : '#F59E0B'),
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
                  ? 'rgba(245, 158, 11, 0.18)'
                  : 'rgba(255, 255, 255, 0.04)',
              color: m.done ? '#34d399' : m.active ? '#FBBF24' : '#64748b',
              fontWeight: (m.done || m.active) ? 700 : 500,
              border: m.active ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid transparent',
            }}
          >
            {m.done ? `✓ ${m.label}` : m.label}
          </div>
        ))}
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div className="autofit-console-drawer" style={{
        background: '#07080C',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        {/* Single-Line Console Header Toggle */}
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          title="CONSOLE LOGS (Auto-Fit Speech Speed Engine)"
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
            <Terminal size={10} color={isFailed ? '#f87171' : (isDone ? '#34d399' : '#FBBF24')} style={{ flexShrink: 0 }} />
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#94a3b8',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'left',
            }}>
              CONSOLE LOGS (Auto-Fit Speech Speed Engine)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: '#64748b' }}>
              {logs.length}
            </span>
            {showConsole ? <ChevronUp size={11} color="#64748b" /> : <ChevronDown size={11} color="#64748b" />}
          </div>
        </button>

        {/* Live Terminal Stream */}
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
                <Loader2 size={10} className="animate-spin" color="#FBBF24" />
                <span>រង់ចាំ Console Logs ពី FFmpeg Service...</span>
              </div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span style={{ color: '#FBBF24', opacity: 0.65, flexShrink: 0, fontSize: '0.58rem' }}>
                    [{log.time || log.timestamp || 'LOG'}]
                  </span>
                  <span style={{
                    color: log.message?.includes('✅') || log.message?.includes('ជោគជ័យ')
                      ? '#34d399'
                      : log.message?.includes('❌') || log.message?.includes('Failed')
                        ? '#f87171'
                        : log.message?.includes('⚡')
                          ? '#FDE047'
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
          title={`បញ្ឈប់ Auto-Fit Speed ភាគ ${ep?.episodeNumber || ep?.id}?`}
          message="តើអ្នកពិតជាចង់បញ្ឈប់ការដំណើរការ Auto-Fit Speed លើភាគនេះមែនទេ?"
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

