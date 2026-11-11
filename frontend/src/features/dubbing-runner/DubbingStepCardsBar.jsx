import React from 'react';
import { Loader2, CheckCircle2, FileText, Mic, VolumeX, Play, Square } from 'lucide-react';
import { useDubbingFeature } from './useDubbingFeature';

export default function DubbingStepCardsBar({ episodes = [], selectedEpIds = null, setupOptions = {} }) {
  const feature = useDubbingFeature(episodes) || {};
  const {
    runnerStates = {},
    runSequentialStep = () => {},
    stopStep = () => {},
    stats = {},
  } = feature;

  const selectedList = React.useMemo(() => {
    if (!selectedEpIds || selectedEpIds.size === 0) return episodes;
    return episodes.filter((ep) => selectedEpIds.has(ep.id));
  }, [episodes, selectedEpIds]);

  const targetEpisodes = selectedList.length > 0 ? selectedList : episodes;

  const tState = runnerStates?.translate || {};
  const vState = runnerStates?.voice || {};
  const cState = runnerStates?.clean_bgm || {};

  const isTranslateRunning = tState.status === 'running';
  const isVoiceRunning = vState.status === 'running';
  const isCleanBgmRunning = cState.status === 'running';

  return (
    <div
      data-testid="batch-step-status-rows"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 8,
        width: '100%',
      }}
    >
      {/* ── CARD 1: 📝 1. Script ខ្មែរ ── */}
      <div
        data-testid="step-row-translate"
        style={{
          position: 'relative',
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(15, 23, 42, 0.65)',
          border: isTranslateRunning ? '1px solid #38BDF8' : '1px solid rgba(56, 189, 248, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          overflow: 'hidden',
          boxShadow: isTranslateRunning ? '0 0 14px rgba(56, 189, 248, 0.22)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {isTranslateRunning ? (
            <Loader2 size={13} className="animate-spin" color="#38BDF8" />
          ) : stats.translatePercent === 100 ? (
            <CheckCircle2 size={13} color="#34D399" />
          ) : (
            <FileText size={14} color="#38BDF8" />
          )}
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#F8FAFC', whiteSpace: 'nowrap' }}>
            1. Script ខ្មែរ:
          </span>
          <span style={{ fontSize: '0.70rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
            {stats.scriptedCount}/{stats.total} ភាគ
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span
            data-testid="step2-status-badge"
            style={{
              fontSize: '0.64rem',
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 9999,
              background: stats.translatePercent === 100 ? 'rgba(52, 211, 153, 0.18)' : 'rgba(56, 189, 248, 0.16)',
              color: stats.translatePercent === 100 ? '#34D399' : '#38BDF8',
            }}
          >
            {isTranslateRunning ? `EP${tState.currentEpIndex}/${tState.totalEps}` : `${stats.translatePercent}%`}
          </span>

          {/* 1-by-1 Run / Stop Toggle Button */}
          {isTranslateRunning ? (
            <button
              type="button"
              onClick={() => stopStep('translate')}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#F87171',
                fontSize: '0.64rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="បញ្ឈប់ការ Translate 1-by-1"
            >
              <Square size={9} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => runSequentialStep('translate', targetEpisodes, setupOptions)}
              style={{
                padding: '2px 7px',
                borderRadius: 4,
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                color: '#38BDF8',
                fontSize: '0.64rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="រត់ Translate ម្ដង ១ ភាគ (1-by-1)"
            >
              <Play size={8} fill="currentColor" />
              <span>Run 1-by-1</span>
            </button>
          )}
        </div>

        {/* Slim progress line */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'rgba(255, 255, 255, 0.06)' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(isTranslateRunning ? 8 : 0, stats.translatePercent)}%`,
              background: stats.translatePercent === 100 ? '#34D399' : '#38BDF8',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* ── CARD 2: 🎙️ 2. សំឡេងខ្មែរ AI ── */}
      <div
        data-testid="step-row-tts"
        style={{
          position: 'relative',
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(15, 23, 42, 0.65)',
          border: isVoiceRunning ? '1px solid #F472B6' : '1px solid rgba(244, 114, 182, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          overflow: 'hidden',
          boxShadow: isVoiceRunning ? '0 0 14px rgba(244, 114, 182, 0.22)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {isVoiceRunning ? (
            <Loader2 size={13} className="animate-spin" color="#F472B6" />
          ) : stats.voicePercent === 100 ? (
            <CheckCircle2 size={13} color="#34D399" />
          ) : (
            <Mic size={14} color="#F472B6" />
          )}
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#F8FAFC', whiteSpace: 'nowrap' }}>
            2. សំឡេង AI:
          </span>
          <span style={{ fontSize: '0.70rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
            {stats.voicedCount}/{stats.total} ភាគ
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span
            data-testid="step3-status-badge"
            style={{
              fontSize: '0.64rem',
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 9999,
              background: stats.voicePercent === 100 ? 'rgba(52, 211, 153, 0.18)' : 'rgba(244, 114, 182, 0.16)',
              color: stats.voicePercent === 100 ? '#34D399' : '#F472B6',
            }}
          >
            {isVoiceRunning ? `EP${vState.currentEpIndex}/${vState.totalEps}` : `${stats.voicePercent}%`}
          </span>

          {isVoiceRunning ? (
            <button
              type="button"
              onClick={() => stopStep('voice')}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#F87171',
                fontSize: '0.64rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="បញ្ឈប់ការបង្កើតសំឡេង 1-by-1"
            >
              <Square size={9} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => runSequentialStep('voice', targetEpisodes, setupOptions)}
              style={{
                padding: '2px 7px',
                borderRadius: 4,
                background: 'rgba(244, 114, 182, 0.15)',
                border: '1px solid rgba(244, 114, 182, 0.4)',
                color: '#F472B6',
                fontSize: '0.64rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="រត់បង្កើតសំឡេង AI ម្ដង ១ ភាគ (1-by-1)"
            >
              <Play size={8} fill="currentColor" />
              <span>Run 1-by-1</span>
            </button>
          )}
        </div>

        {/* Slim progress line */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'rgba(255, 255, 255, 0.06)' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(isVoiceRunning ? 8 : 0, stats.voicePercent)}%`,
              background: stats.voicePercent === 100 ? '#34D399' : '#F472B6',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* ── CARD 3: 🔇 3. Clean BGM ── */}
      <div
        data-testid="step-row-demucs"
        style={{
          position: 'relative',
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(15, 23, 42, 0.65)',
          border: isCleanBgmRunning ? '1px solid #34D399' : '1px solid rgba(52, 211, 153, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          overflow: 'hidden',
          boxShadow: isCleanBgmRunning ? '0 0 14px rgba(52, 211, 153, 0.22)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {isCleanBgmRunning ? (
            <Loader2 size={13} className="animate-spin" color="#34D399" />
          ) : stats.cleanBgmPercent === 100 ? (
            <CheckCircle2 size={13} color="#34D399" />
          ) : (
            <VolumeX size={14} color="#34D399" />
          )}
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#F8FAFC', whiteSpace: 'nowrap' }}>
            3. Clean BGM:
          </span>
          <span style={{ fontSize: '0.70rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
            {stats.cleanBgmCount}/{stats.total} ភាគ
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span
            data-testid="step4-status-badge"
            style={{
              fontSize: '0.64rem',
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 9999,
              background: stats.cleanBgmPercent === 100 ? 'rgba(52, 211, 153, 0.18)' : 'rgba(52, 211, 153, 0.16)',
              color: stats.cleanBgmPercent === 100 ? '#34D399' : '#34D399',
            }}
          >
            {isCleanBgmRunning ? `EP${cState.currentEpIndex}/${cState.totalEps}` : `${stats.cleanBgmPercent}%`}
          </span>

          {isCleanBgmRunning ? (
            <button
              type="button"
              onClick={() => stopStep('clean_bgm')}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#F87171',
                fontSize: '0.64rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="បញ្ឈប់ការបំបែកសំឡេង 1-by-1"
            >
              <Square size={9} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => runSequentialStep('clean_bgm', targetEpisodes, setupOptions)}
              style={{
                padding: '2px 7px',
                borderRadius: 4,
                background: 'rgba(52, 211, 153, 0.15)',
                border: '1px solid rgba(52, 211, 153, 0.4)',
                color: '#34D399',
                fontSize: '0.64rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
              title="រត់បំបែកសំឡេង Clean BGM ម្ដង ១ ភាគ (1-by-1)"
            >
              <Play size={8} fill="currentColor" />
              <span>Run 1-by-1</span>
            </button>
          )}
        </div>

        {/* Slim progress line */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'rgba(255, 255, 255, 0.06)' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(isCleanBgmRunning ? 8 : 0, stats.cleanBgmPercent)}%`,
              background: stats.cleanBgmPercent === 100 ? '#34D399' : '#34D399',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>
    </div>
  );
}

