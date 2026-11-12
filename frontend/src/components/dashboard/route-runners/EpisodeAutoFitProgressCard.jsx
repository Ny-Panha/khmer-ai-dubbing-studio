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
  const [showConsole, setShowConsole] = useState(true);
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

  const stateColor = isFailed ? '#ef4444' : (isDone ? '#10b981' : '#FBBF24');
  const stateBorder = isFailed ? 'rgba(239, 68, 68, 0.55)' : (isDone ? 'rgba(16, 185, 129, 0.5)' : 'rgba(251, 191, 36, 0.55)');
  const stateGlow = isFailed ? '0 4px 20px rgba(239, 68, 68, 0.22)' : (isDone ? '0 4px 20px rgba(16, 185, 129, 0.22)' : '0 4px 20px rgba(251, 191, 36, 0.25)');

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'linear-gradient(135deg, rgba(25, 20, 10, 0.98) 0%, rgba(35, 28, 15, 0.92) 100%)',
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
            background: isFailed ? 'rgba(239, 68, 68, 0.2)' : (isDone ? 'rgba(16, 185, 129, 0.2)' : 'rgba(251, 191, 36, 0.2)'),
            border: `1px solid ${isFailed ? 'rgba(239, 68, 68, 0.4)' : (isDone ? 'rgba(16, 185, 129, 0.4)' : 'rgba(251, 191, 36, 0.4)')}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: stateColor,
            flexShrink: 0,
          }}>
            {isFailed ? (
              <AlertCircle size={14} color="#ef4444" />
            ) : isDone ? (
              <CheckCircle2 size={14} color="#10b981" />
            ) : (
              <Zap size={14} className="animate-pulse" color="#FBBF24" />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
                ⚡ 3. Auto-Fit Speed
              </span>
              <span style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'rgba(251, 191, 36, 0.15)',
                color: '#FBBF24',
                border: '1px solid rgba(251, 191, 36, 0.35)',
              }}>
                WSOLA + Atempo
              </span>
            </div>
            <div style={{
              fontSize: '0.68rem',
              color: isFailed ? '#fca5a5' : '#94a3b8',
              marginTop: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {currentLive?.message || (isDone ? '✅ បានពន្លឿនឃ្លាក្រហមឱ្យ Fit ស្មើនឹង Subtitle ១០០%' : 'កំពុងវិភាគ និងពន្លឿនសំឡេង...')}
            </div>
          </div>
        </div>

        {/* Action Controls & Percentage */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
                gap: 4,
                padding: '3px 8px',
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#f87171',
                fontSize: '0.64rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="បញ្ឈប់ Auto-Fit Speed"
            >
              <Square size={9} fill="currentColor" />
              <span>Stop</span>
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
            <span style={{
              fontSize: '1.05rem',
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
                : 'linear-gradient(90deg, #F59E0B, #FBBF24)'),
            borderRadius: 9999,
            boxShadow: isFailed
              ? '0 0 12px rgba(239, 68, 68, 0.7)'
              : (isDone
                ? '0 0 12px rgba(16, 185, 129, 0.7)'
                : '0 0 12px rgba(251, 191, 36, 0.7)'),
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
          background: smoothProgress >= 25 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 1 ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 25 ? '#10b981' : (smoothProgress >= 1 ? '#FBBF24' : '#64748b'),
          fontWeight: smoothProgress >= 1 ? 700 : 500,
          border: smoothProgress >= 1 && smoothProgress < 25 ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid transparent',
          transition: 'all 0.15s ease',
        }}>
          {smoothProgress >= 25 ? '✓ 1. Scan' : '1. Scan'}
        </div>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: smoothProgress >= 60 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 25 ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 60 ? '#10b981' : (smoothProgress >= 25 ? '#FBBF24' : '#64748b'),
          fontWeight: smoothProgress >= 25 ? 700 : 500,
          border: smoothProgress >= 25 && smoothProgress < 60 ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid transparent',
          transition: 'all 0.15s ease',
        }}>
          {smoothProgress >= 60 ? '✓ 2. Stretch' : '2. Stretch'}
        </div>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: smoothProgress >= 85 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 60 ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 85 ? '#10b981' : (smoothProgress >= 60 ? '#FBBF24' : '#64748b'),
          fontWeight: smoothProgress >= 60 ? 700 : 500,
          border: smoothProgress >= 60 && smoothProgress < 85 ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid transparent',
          transition: 'all 0.15s ease',
        }}>
          {smoothProgress >= 85 ? '✓ 3. Re-Align' : '3. Re-Align'}
        </div>
        <div style={{
          padding: '4px 3px',
          borderRadius: 5,
          fontSize: '0.62rem',
          textAlign: 'center',
          background: isDone ? 'rgba(16, 185, 129, 0.2)' : (smoothProgress >= 85 ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
          color: isDone ? '#10b981' : (smoothProgress >= 85 ? '#FBBF24' : '#64748b'),
          fontWeight: smoothProgress >= 85 ? 700 : 500,
          border: isDone ? '1px solid rgba(16, 185, 129, 0.4)' : (smoothProgress >= 85 ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid transparent'),
          transition: 'all 0.15s ease',
        }}>
          {isDone ? '✓ 4. Re-Sync' : '4. Re-Sync'}
        </div>
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div className="autofit-console-drawer" style={{
        background: '#07080C',
        border: `1px solid ${isFailed ? 'rgba(239, 68, 68, 0.35)' : (isDone ? 'rgba(16, 185, 129, 0.35)' : 'rgba(251, 191, 36, 0.35)')}`,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.85)',
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
            <Terminal size={11} color={isFailed ? '#ef4444' : (isDone ? '#34d399' : '#FBBF24')} />
            <span style={{ fontSize: '0.64rem', fontWeight: 800, color: '#94a3b8', letterSpacing: '0.04em' }}>
              CONSOLE LOGS (Auto-Fit Speech Speed Engine)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.58rem', color: '#64748b' }}>
              {logs.length} lines
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
