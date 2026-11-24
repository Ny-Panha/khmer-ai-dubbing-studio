import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp, CheckCircle2, Loader2, AlertCircle, Clock } from 'lucide-react';
import StudioConfirmDialog from '../../common/StudioConfirmDialog';

/**
 * EpisodeDemucsProgressCard:
 * Dynamic 0% - 100% smooth runner, glowing sky blue progress bar, 4 visual milestones,
 * and collapsible Live Console Terminal Drawer for Step 3 (Demucs AI Clean BGM & Vocal Separation).
 */
export default function EpisodeDemucsProgressCard({ liveStats, ep, onKill, onRequestConfirm = null, isCurrentRunning = true }) {
  const [internalLiveStats, setInternalLiveStats] = useState(null);

  useEffect(() => {
    if (!isCurrentRunning) return;
    const videoRef = ep?.videoPath || ep?.sourceVideoPath || ep?.videoFile || (typeof ep?.video === 'string' ? ep?.video : ep?.video?.videoPath) || '';
    if (!videoRef) return;

    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/audio/separation-progress?videoPath=${encodeURIComponent(videoRef)}`);
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
    const timer = setInterval(poll, 1000);
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

  const modelName = currentLive?.model || ep?.demucsModel || ep?.model || 'htdemucs';
  const isDone = Boolean(currentLive?.isDone || currentLive?.status === 'completed' || (currentLive?.percent ?? 0) >= 100);
  const isFailed = Boolean(currentLive?.isFailed || currentLive?.status === 'error');
  const isQueued = !isCurrentRunning && !isDone && !isFailed;
  const targetPercent = isQueued ? 0 : Math.min(100, Math.max(0, currentLive?.percent ?? currentLive?.progress ?? 5));
  const [smoothProgress, setSmoothProgress] = useState(targetPercent || 0);
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

  const stateColor = isFailed ? '#ef4444' : (isDone ? '#10b981' : (isQueued ? '#94a3b8' : '#38bdf8'));
  const stateBorder = isFailed ? 'rgba(239, 68, 68, 0.55)' : (isDone ? 'rgba(16, 185, 129, 0.5)' : (isQueued ? 'rgba(148, 163, 184, 0.35)' : 'rgba(56, 189, 248, 0.55)'));
  const stateGlow = isFailed ? '0 4px 20px rgba(239, 68, 68, 0.22)' : (isDone ? '0 4px 20px rgba(16, 185, 129, 0.22)' : (isQueued ? 'none' : '0 4px 20px rgba(56, 189, 248, 0.25)'));

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'rgba(16, 185, 129, 0.05)',
        border: `1px solid ${stateBorder}`,
        borderRadius: 6,
        padding: '8px 9px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
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
            {isFailed ? <AlertCircle size={15} /> : (isDone ? <CheckCircle2 size={15} /> : (isQueued ? <Clock size={15} /> : <Loader2 size={15} className="animate-spin" />))}
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
              {isFailed ? '⚠️ បរាជ័យក្នុងការបិទសំឡេងចិន' : (isDone ? '🎉 🔇 4. AI បិទសំឡេងចិន (រក្សាភ្លេង BGM ដើម) រួចរាល់' : (isQueued ? '⏳ 🔇 4. AI បិទសំឡេងចិន — រង់ចាំក្នុង Queue' : '🔇 4. AI កំពុងបិទសំឡេងចិន (រក្សាភ្លេង BGM ដើម)...'))}
            </div>
            <div style={{
              fontSize: '0.68rem',
              color: isFailed ? '#f87171' : (isDone ? '#34d399' : (isQueued ? '#94a3b8' : '#38bdf8')),
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {isFailed ? 'សូមពិនិត្យមើល Console Logs ខាងក្រោម...' : (isDone ? 'Clean BGM & Sound Effects Isolated' : (isQueued ? 'រង់ចាំភាគមុនបញ្ចប់ (ដំណើរការ ១ ភាគម្ដង ដើម្បីការពារកុំឱ្យ CPU គាំង)' : (currentLive?.message || `AI Deep Learning Stem Separation (${modelName})...`)))}
            </div>
          </div>
        </div>

        {/* Tabular Percentage & Kill Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {!isDone && !isFailed && onKill && (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                if (typeof onRequestConfirm === 'function') {
                  const confirmed = await onRequestConfirm({
                    variant: 'danger',
                    badge: 'KILL DEMUCS',
                    title: 'បញ្ឈប់ (Kill) ដំណើរការ Demucs នេះ?',
                    subtitle: ep?.episodeNumber ? `EP${ep.episodeNumber}` : '',
                    message: 'តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការបំបែកសំឡេង Demucs នេះមែនទេ?',
                    confirmLabel: '🛑 បញ្ឈប់ (Kill)',
                    cancelLabel: 'បន្តដំណើរការ',
                  });
                  if (confirmed) onKill(ep);
                  return;
                }
                setShowKillConfirm(true);
              }}
              title="Kill Demucs Process"
              style={{
                background: 'rgba(239, 68, 68, 0.16)',
                border: '1px solid rgba(239, 68, 68, 0.42)',
                color: '#fca5a5',
                height: 20,
                padding: '0 6px',
                borderRadius: 4,
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                whiteSpace: 'nowrap',
              }}
            >
              Stop
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
          {smoothProgress >= 50 ? '✓ Demucs' : 'Demucs'}
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
          background: smoothProgress >= 85 ? 'rgba(16, 185, 129, 0.14)' : (smoothProgress >= 50 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 85 ? '#34d399' : (smoothProgress >= 50 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 50 ? 700 : 500,
          border: smoothProgress >= 50 && smoothProgress < 85 ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent',
        }}>
          {smoothProgress >= 85 ? '✓ Isolate' : 'Isolate'}
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
          background: isDone ? 'rgba(16, 185, 129, 0.18)' : (smoothProgress >= 85 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: isDone ? '#34d399' : (smoothProgress >= 85 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 85 ? 700 : 500,
          border: isDone ? '1px solid rgba(16, 185, 129, 0.4)' : (smoothProgress >= 85 ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent'),
        }}>
          {isDone ? '✓ BGM' : 'BGM'}
        </div>
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div className="demucs-console-drawer" style={{
        background: '#07080C',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        {/* Console Header Toggle */}
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          title={`CONSOLE LOGS (Demucs AI Model: ${modelName})`}
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
            <Terminal size={10} color={isFailed ? '#ef4444' : (isDone ? '#34d399' : '#38bdf8')} style={{ flexShrink: 0 }} />
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#94a3b8',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'left',
            }}>
              CONSOLE LOGS (Demucs AI Model: {modelName})
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
              {isFailed ? 'FAILED' : (isDone ? 'DONE' : 'LIVE')}
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
                const timeStr = log.time || new Date().toLocaleTimeString();
                const prg = typeof log.progress === 'number' ? log.progress : 0;
                const isFail = log.message?.includes('បរាជ័យ') || log.message?.includes('Error') || log.message?.includes('failed');
                const logColor = isFail ? '#f87171' : (prg >= 100 ? '#10b981' : (prg >= 50 ? '#38bdf8' : '#7dd3fc'));
                return (
                  <div key={lIdx} style={{ color: logColor, wordBreak: 'break-word', fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" }}>
                    <span style={{ color: '#64748b' }}>[{timeStr}]</span> <span style={{ color: '#38bdf8', fontWeight: 700 }}>[AudioSeparation]</span> <span>{log.message.startsWith('⏳') ? log.message : `⏳ ${log.message}`}</span>
                  </div>
                );
              })
            ) : isQueued ? (
              <div style={{ color: '#94a3b8', fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" }}>
                [{new Date().toLocaleTimeString()}] [AudioSeparation] ⏳ ភាគនេះកំពុងរង់ចាំក្នុង Queue — ប្រព័ន្ធនឹងបំបែកសំឡេង Clean BGM បន្តបន្ទាប់ពីភាគមុនបញ្ចប់ (ដំណើរការ ១ ភាគម្ដង ដើម្បីធានាម៉ាស៊ីនដើរស្រួល)
              </div>
            ) : (
              <div style={{ color: '#7dd3fc', fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" }}>
                [{new Date().toLocaleTimeString()}] [AudioSeparation] ⏳ កំពុងដំណើរការ Demucs Stem Separation (Vocal Extraction & Clean BGM)...
              </div>
            )}
          </div>
        )}
      </div>
      <StudioConfirmDialog
        isOpen={showKillConfirm}
        variant="danger"
        badge="KILL DEMUCS"
        title="បញ្ឈប់ (Kill) ដំណើរការ Demucs នេះ?"
        subtitle={ep?.episodeNumber ? `EP${ep.episodeNumber}` : ''}
        message="តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការបំបែកសំឡេង Demucs នេះមែនទេ?"
        confirmLabel="🛑 បញ្ឈប់ (Kill)"
        cancelLabel="បន្តដំណើរការ"
        onConfirm={() => {
          setShowKillConfirm(false);
          onKill?.(ep);
        }}
        onCancel={() => setShowKillConfirm(false)}
      />
    </div>
  );
}

