import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import StudioConfirmDialog from '../../common/StudioConfirmDialog';

/**
 * EpisodeTtsProgressCard:
 * Dynamic 0% - 100% smooth runner, glowing coral progress bar, 4 visual milestones,
 * and collapsible Live Console Terminal Drawer for Step 2 (Khmer TTS Voice Studio).
 */
export default function EpisodeTtsProgressCard({ liveStats, ep, onKill = null, onRequestConfirm = null }) {
  const [internalLiveStats, setInternalLiveStats] = useState(null);

  useEffect(() => {
    const sId = ep?.seriesId || 'drama_project';
    const epId = ep?.id;
    const totalSegs = ep?.scriptData?.segments?.length || ep?.scriptData?.totalSegments || 1;
    if (!epId) return;

    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/tts/progress?seriesId=${sId}&episodeId=${epId}&total=${totalSegs}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.success && active) {
          const cur = data.current || 0;
          const tot = data.total || totalSegs;
          const epPct = tot > 0 ? Math.min(100, Math.round((cur / tot) * 100)) : 0;
          if (cur > 0 || epPct > 0) {
            setInternalLiveStats({
              current: cur,
              total: tot,
              percent: epPct,
              message: `កំពុងសំយោគ ${cur}/${tot} ឃ្លា (${epPct}%)...`,
              logs: [
                {
                  time: new Date().toLocaleTimeString(),
                  progress: epPct,
                  message: `🎙️ សំយោគសំឡេង: ${cur}/${tot} ឃ្លា (${epPct}%)`,
                },
              ],
            });
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
  }, [ep]);

  const currentLive = (internalLiveStats && Number(internalLiveStats.percent || 0) > Number(liveStats?.percent || 0))
    ? {
        ...internalLiveStats,
        logs: (internalLiveStats.logs?.length || 0) >= (liveStats?.logs?.length || 0) ? internalLiveStats.logs : (liveStats?.logs || []),
      }
    : (liveStats || internalLiveStats);

  const current = currentLive?.current || 0;
  const segments = ep?.scriptData?.segments || ep?.scriptSegments || [];
  const femaleCues = segments.filter((s) => s.voiceGender === 'female' || s.gender === 'female' || s.speakerGender === 'FEMALE' || String(s.voiceId || s.khmerVoiceId || '').includes('Sreymom')).length;
  const maleCues = segments.length > 0 ? (segments.length - femaleCues) : 0;
  const total = currentLive?.total || segments.length || ep?.scriptData?.totalSegments || 1;
  const targetPercent = Math.min(100, Math.max(0, currentLive?.percent ?? Math.round((current / (total || 1)) * 100)));
  const [smoothProgress, setSmoothProgress] = useState(targetPercent || 1);
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

  const isDone = Boolean(currentLive?.isDone || smoothProgress >= 100);
  const isFailed = Boolean(currentLive?.isFailed);
  const logs = Array.isArray(currentLive?.logs) ? currentLive.logs : [];

  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollTop = consoleBottomRef.current.scrollHeight;
    }
  }, [logs.length, smoothProgress, showConsole]);

  const stateColor = isFailed ? '#ef4444' : (isDone ? '#10b981' : '#FF8577');
  const stateBorder = isFailed ? 'rgba(239, 68, 68, 0.55)' : (isDone ? 'rgba(16, 185, 129, 0.5)' : 'rgba(255, 133, 119, 0.55)');
  const stateGlow = isFailed ? '0 4px 20px rgba(239, 68, 68, 0.22)' : (isDone ? '0 4px 20px rgba(16, 185, 129, 0.22)' : '0 4px 20px rgba(255, 133, 119, 0.25)');

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'rgba(244, 114, 182, 0.05)',
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
            background: isFailed ? 'rgba(239, 68, 68, 0.2)' : (isDone ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 133, 119, 0.2)'),
            border: `1px solid ${isFailed ? 'rgba(239, 68, 68, 0.4)' : (isDone ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 133, 119, 0.4)')}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: stateColor,
            boxShadow: `0 0 10px ${isFailed ? 'rgba(239, 68, 68, 0.4)' : (isDone ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 133, 119, 0.4)')}`,
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
              {isFailed ? '⚠️ បរាជ័យក្នុងការបង្កើតសំឡេង' : (isDone ? '🎉 🎙️ 2. AI Translate Voice រួចរាល់ ១០០%' : '🎙️ 2. AI កំពុងបង្កើតសំឡេងខ្មែរ (Edge-TTS)...')}
            </div>
            <div style={{
              fontSize: '0.68rem',
              color: isFailed ? '#f87171' : (isDone ? '#34d399' : '#fda4af'),
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {isFailed
                ? 'សូមពិនិត្យមើល Console Logs ខាងក្រោម...'
                : (isDone
                  ? `Master Narration រួចរាល់ (${current}/${total} ឃ្លា${segments.length > 0 ? ` • 👨 ${maleCues} / 👩 ${femaleCues}` : ''})`
                  : (smoothProgress >= 95
                    ? '🎧 FFmpeg Hierarchical Sync: កំពុងផ្គុំសំឡេងខ្មែរ Master Narration...'
                    : `កំពុងសំយោគ ${current} / ${total} ឃ្លា${segments.length > 0 ? ` (👨 ${maleCues} • 👩 ${femaleCues})` : ''} • Concurrency: 3`))}
            </div>
          </div>
        </div>

        {/* Tabular Percentage & Kill Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
          {!isDone && !isFailed && onKill && (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                if (typeof onRequestConfirm === 'function') {
                  const confirmed = await onRequestConfirm({
                    variant: 'danger',
                    badge: 'KILL TTS',
                    title: 'បញ្ឈប់ (Kill) ដំណើរការ TTS នេះ?',
                    subtitle: ep?.episodeNumber ? `EP${ep.episodeNumber}` : '',
                    message: 'តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការ TTS នេះមែនទេ?',
                    confirmLabel: '🛑 បញ្ឈប់ (Kill)',
                    cancelLabel: 'បន្តដំណើរការ',
                  });
                  if (confirmed) onKill(ep);
                  return;
                }
                setShowKillConfirm(true);
              }}
              title="Kill TTS Process"
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
                : 'linear-gradient(90deg, #FF8577, #f43f5e)'),
            borderRadius: 9999,
            boxShadow: isFailed
              ? '0 0 12px rgba(239, 68, 68, 0.7)'
              : (isDone
                ? '0 0 12px rgba(16, 185, 129, 0.7)'
                : '0 0 12px rgba(255, 133, 119, 0.7)'),
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
          background: smoothProgress >= 20 ? 'rgba(16, 185, 129, 0.14)' : (smoothProgress >= 1 ? 'rgba(255, 133, 119, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 20 ? '#34d399' : (smoothProgress >= 1 ? '#FF8577' : '#64748b'),
          fontWeight: smoothProgress >= 1 ? 700 : 500,
          border: smoothProgress >= 1 && smoothProgress < 20 ? '1px solid rgba(255, 133, 119, 0.45)' : '1px solid transparent',
        }}>
          {smoothProgress >= 20 ? '✓ Segs' : 'Segs'}
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
          background: smoothProgress >= 50 ? 'rgba(16, 185, 129, 0.14)' : (smoothProgress >= 20 ? 'rgba(255, 133, 119, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 50 ? '#34d399' : (smoothProgress >= 20 ? '#FF8577' : '#64748b'),
          fontWeight: smoothProgress >= 20 ? 700 : 500,
          border: smoothProgress >= 20 && smoothProgress < 50 ? '1px solid rgba(255, 133, 119, 0.45)' : '1px solid transparent',
        }}>
          {smoothProgress >= 50 ? '✓ Voice' : 'Voice'}
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
          background: smoothProgress >= 85 ? 'rgba(16, 185, 129, 0.14)' : (smoothProgress >= 50 ? 'rgba(255, 133, 119, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 85 ? '#34d399' : (smoothProgress >= 50 ? '#FF8577' : '#64748b'),
          fontWeight: smoothProgress >= 50 ? 700 : 500,
          border: smoothProgress >= 50 && smoothProgress < 85 ? '1px solid rgba(255, 133, 119, 0.45)' : '1px solid transparent',
        }}>
          {smoothProgress >= 85 ? '✓ Sync' : 'Sync'}
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
          background: isDone ? 'rgba(16, 185, 129, 0.18)' : (smoothProgress >= 85 ? 'rgba(255, 133, 119, 0.18)' : 'rgba(255, 255, 255, 0.04)'),
          color: isDone ? '#34d399' : (smoothProgress >= 85 ? '#FF8577' : '#64748b'),
          fontWeight: smoothProgress >= 85 ? 700 : 500,
          border: isDone ? '1px solid rgba(16, 185, 129, 0.4)' : (smoothProgress >= 85 ? '1px solid rgba(255, 133, 119, 0.45)' : '1px solid transparent'),
        }}>
          {isDone ? '✓ Master' : 'Master'}
        </div>
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div className="tts-console-drawer" style={{
        background: '#07080C',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        {/* Console Header Toggle */}
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          title="CONSOLE LOGS (Edge-TTS AI Engine)"
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
            <Terminal size={10} color={isFailed ? '#ef4444' : (isDone ? '#34d399' : '#FF8577')} style={{ flexShrink: 0 }} />
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#94a3b8',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'left',
            }}>
              CONSOLE LOGS (Edge-TTS AI Engine)
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
                const logColor = isFail ? '#f87171' : (prg >= 100 ? '#10b981' : (prg >= 50 ? '#FF8577' : '#fda4af'));
                return (
                  <div key={lIdx} style={{ color: logColor, wordBreak: 'break-word' }}>
                    <span style={{ color: '#64748b' }}>[{timeStr}]</span> <span style={{ color: '#FF8577' }}>[{prg}%]</span> {log.message}
                  </div>
                );
              })
            ) : (
              <div style={{ color: '#fda4af' }}>
                [{new Date().toLocaleTimeString()}] [{smoothProgress}%] 🎙️ កំពុងដំណើរការសំយោគសំឡេងខ្មែរ {current}/{total} ឃ្លា...
              </div>
            )}
          </div>
        )}
      </div>
      <StudioConfirmDialog
        isOpen={showKillConfirm}
        variant="danger"
        badge="KILL TTS"
        title="បញ្ឈប់ (Kill) ដំណើរការ TTS នេះ?"
        subtitle={ep?.episodeNumber ? `EP${ep.episodeNumber}` : ''}
        message="តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការ TTS នេះមែនទេ?"
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

