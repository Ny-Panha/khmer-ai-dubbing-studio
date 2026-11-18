import React from 'react';
import { Loader2, CheckCircle2, FileText, Mic, VolumeX, Play, Square, RotateCcw, Wrench, Zap } from 'lucide-react';
import { useDubbingFeature } from './useDubbingFeature';
import { getEpisodeBrokenSummary } from '../../components/dashboard/geminiRouteHelpers';

const STEP_BTN_BASE = {
  minHeight: 28,
  padding: '3px 9px',
  borderRadius: 'var(--radius-xs)',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
};

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

  const brokenTextCount = React.useMemo(() => {
    let count = 0;
    for (const ep of targetEpisodes) {
      const scan = getEpisodeBrokenSummary ? getEpisodeBrokenSummary(ep) : null;
      count += (scan?.textBrokenCount || 0);
    }
    return count;
  }, [targetEpisodes]);

  const tState = runnerStates?.translate || {};
  const vState = runnerStates?.voice || {};
  const afState = runnerStates?.autofit || {};
  const cState = runnerStates?.clean_bgm || {};

  const isTranslateRunning = tState.status === 'running';
  const isVoiceRunning = vState.status === 'running';
  const isAutoFitRunning = afState.status === 'running';
  const isCleanBgmRunning = cState.status === 'running';

  return (
    <div
      data-testid="batch-step-status-rows"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 265px), 1fr))',
        gap: 10,
        width: '100%',
      }}
    >
      {/* ── CARD 1: 1. Script ខ្មែរ ── */}
      <div
        data-testid="step-row-translate"
        style={{
          position: 'relative',
          padding: '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-secondary-panel)',
          border: isTranslateRunning ? '1px solid #38BDF8' : '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {isTranslateRunning ? (
              <Loader2 size={14} className="animate-spin" color="#38BDF8" />
            ) : stats.translatePercent === 100 ? (
              <CheckCircle2 size={14} color="#34D399" />
            ) : (
              <FileText size={14} color="#38BDF8" />
            )}
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              1. Script ខ្មែរ:
            </span>
            <span style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {stats.scriptedCount}/{stats.total}
            </span>
          </div>

          <span
            data-testid="step2-status-badge"
            style={{
              fontSize: 'var(--text-2xs)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 'var(--radius-xs)',
              background: stats.translatePercent === 100 ? 'rgba(16, 185, 129, 0.16)' : 'rgba(56, 189, 248, 0.14)',
              color: stats.translatePercent === 100 ? '#6EE7B7' : '#7DD3FC',
              flexShrink: 0,
            }}
          >
            {isTranslateRunning ? `EP${tState.currentEpIndex}/${tState.totalEps}` : `${stats.translatePercent}%`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {isTranslateRunning ? (
            <button
              type="button"
              onClick={() => stopStep('translate')}
              style={{
                ...STEP_BTN_BASE,
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#FCA5A5',
              }}
              title="បញ្ឈប់ការ Translate 1-by-1"
            >
              <Square size={10} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => runSequentialStep('translate', targetEpisodes, setupOptions)}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'rgba(56, 189, 248, 0.14)',
                  border: '1px solid rgba(56, 189, 248, 0.38)',
                  color: '#7DD3FC',
                }}
                title="រត់ Translate ភាគដែលមិនទាន់មាន Script (1-by-1)"
              >
                <Play size={10} fill="currentColor" />
                <span>Run 1-by-1</span>
              </button>
              <button
                type="button"
                data-testid="btn-bar-retranslate"
                onClick={() => runSequentialStep('translate', targetEpisodes, { ...setupOptions, force: true })}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'var(--bg-elevated-panel)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title="បកប្រែឡើងវិញ (Re-Translate ភាគដែលរើស)"
              >
                <RotateCcw size={10} />
                <span>ធ្វើឡើងវិញ</span>
              </button>
              <button
                type="button"
                data-testid="btn-bar-repair-text"
                onClick={() => runSequentialStep('repair', targetEpisodes, setupOptions)}
                style={{
                  ...STEP_BTN_BASE,
                  background: brokenTextCount > 0 ? 'rgba(245, 158, 11, 0.2)' : 'var(--bg-elevated-panel)',
                  border: brokenTextCount > 0 ? '1px solid rgba(245, 158, 11, 0.55)' : '1px solid var(--border-subtle)',
                  color: brokenTextCount > 0 ? '#FDE68A' : 'var(--text-secondary)',
                }}
                title="ជួសជុលតែឃ្លាដែលខូច ឬ Translation Error (Repair)"
              >
                <Wrench size={10} />
                <span>{brokenTextCount > 0 ? `ជួសជុល (${brokenTextCount})` : 'ជួសជុល'}</span>
              </button>
            </>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--border-subtle)' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(isTranslateRunning ? 8 : 0, stats.translatePercent)}%`,
              background: stats.translatePercent === 100 ? '#10B981' : '#38BDF8',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* ── CARD 2: 2. សំឡេងខ្មែរ AI ── */}
      <div
        data-testid="step-row-tts"
        style={{
          position: 'relative',
          padding: '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-secondary-panel)',
          border: isVoiceRunning ? '1px solid #F472B6' : '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {isVoiceRunning ? (
              <Loader2 size={14} className="animate-spin" color="#F472B6" />
            ) : stats.voicePercent === 100 ? (
              <CheckCircle2 size={14} color="#34D399" />
            ) : (
              <Mic size={14} color="#F472B6" />
            )}
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              2. សំឡេង AI:
            </span>
            <span style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {stats.voicedCount}/{stats.total}
            </span>
          </div>

          <span
            data-testid="step3-status-badge"
            style={{
              fontSize: 'var(--text-2xs)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 'var(--radius-xs)',
              background: stats.voicePercent === 100 ? 'rgba(16, 185, 129, 0.16)' : 'rgba(244, 114, 182, 0.16)',
              color: stats.voicePercent === 100 ? '#6EE7B7' : '#F9A8D4',
              flexShrink: 0,
            }}
          >
            {isVoiceRunning ? `EP${vState.currentEpIndex}/${vState.totalEps}` : `${stats.voicePercent}%`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {isVoiceRunning ? (
            <button
              type="button"
              onClick={() => stopStep('voice')}
              style={{
                ...STEP_BTN_BASE,
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#FCA5A5',
              }}
              title="បញ្ឈប់ការបង្កើតសំឡេង 1-by-1"
            >
              <Square size={10} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => runSequentialStep('voice', targetEpisodes, setupOptions)}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'rgba(244, 114, 182, 0.14)',
                  border: '1px solid rgba(244, 114, 182, 0.38)',
                  color: '#F9A8D4',
                }}
                title="រត់បង្កើតសំឡេង AI ម្ដង ១ ភាគ (1-by-1)"
              >
                <Play size={10} fill="currentColor" />
                <span>Run 1-by-1</span>
              </button>
              <button
                type="button"
                data-testid="btn-bar-revoice"
                onClick={() => runSequentialStep('voice', targetEpisodes, { ...setupOptions, force: true })}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'var(--bg-elevated-panel)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title="បង្កើតសំឡេង AI ឡើងវិញ (Re-Voice ភាគដែលរើស)"
              >
                <RotateCcw size={10} />
                <span>ធ្វើឡើងវិញ</span>
              </button>
            </>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--border-subtle)' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(isVoiceRunning ? 8 : 0, stats.voicePercent)}%`,
              background: stats.voicePercent === 100 ? '#10B981' : '#F472B6',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* ── CARD 3: 3. Auto-Fit Speed ── */}
      <div
        data-testid="step-row-autofit"
        style={{
          position: 'relative',
          padding: '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-secondary-panel)',
          border: isAutoFitRunning ? '1px solid #FBBF24' : '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {isAutoFitRunning ? (
              <Loader2 size={14} className="animate-spin" color="#FBBF24" />
            ) : stats.autofitPercent === 100 ? (
              <CheckCircle2 size={14} color="#34D399" />
            ) : (
              <Zap size={14} color="#FBBF24" />
            )}
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              3. Auto-Fit:
            </span>
            <span style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {stats.autofitCount}/{stats.voicedCount || stats.total}
            </span>
          </div>

          <span
            data-testid="step-autofit-status-badge"
            style={{
              fontSize: 'var(--text-2xs)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 'var(--radius-xs)',
              background: stats.autofitPercent === 100 ? 'rgba(16, 185, 129, 0.16)' : 'rgba(245, 158, 11, 0.16)',
              color: stats.autofitPercent === 100 ? '#6EE7B7' : '#FDE68A',
              flexShrink: 0,
            }}
          >
            {isAutoFitRunning ? `EP${afState.currentEpIndex}/${afState.totalEps}` : `${stats.autofitPercent}%`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {isAutoFitRunning ? (
            <button
              type="button"
              onClick={() => stopStep('autofit')}
              style={{
                ...STEP_BTN_BASE,
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#FCA5A5',
              }}
              title="បញ្ឈប់ការ Auto-Fit Speed 1-by-1"
            >
              <Square size={10} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                data-testid="btn-bar-run-autofit"
                onClick={() => runSequentialStep('autofit', targetEpisodes, setupOptions)}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'rgba(245, 158, 11, 0.14)',
                  border: '1px solid rgba(245, 158, 11, 0.38)',
                  color: '#FDE68A',
                }}
                title="រត់ Auto-Fit Speed ម្ដង ១ ភាគ (1-by-1) គ្រប់ភាគដែលរើស"
              >
                <Play size={10} fill="currentColor" />
                <span>Run 1-by-1</span>
              </button>
              <button
                type="button"
                data-testid="btn-bar-reautofit"
                onClick={() => runSequentialStep('autofit', targetEpisodes, { ...setupOptions, force: true })}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'var(--bg-elevated-panel)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title="ពន្លឿន Auto-Fit Speed ឡើងវិញគ្រប់ភាគ (Re-Fit)"
              >
                <RotateCcw size={10} />
                <span>ធ្វើឡើងវិញ</span>
              </button>
            </>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--border-subtle)' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(isAutoFitRunning ? 8 : 0, stats.autofitPercent)}%`,
              background: stats.autofitPercent === 100 ? '#10B981' : '#F59E0B',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* ── CARD 4: 4. Clean BGM ── */}
      <div
        data-testid="step-row-demucs"
        style={{
          position: 'relative',
          padding: '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-secondary-panel)',
          border: isCleanBgmRunning ? '1px solid #34D399' : '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {isCleanBgmRunning ? (
              <Loader2 size={14} className="animate-spin" color="#34D399" />
            ) : stats.cleanBgmPercent === 100 ? (
              <CheckCircle2 size={14} color="#34D399" />
            ) : (
              <VolumeX size={14} color="#34D399" />
            )}
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              4. Clean BGM:
            </span>
            <span style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {stats.cleanBgmCount}/{stats.total}
            </span>
          </div>

          <span
            data-testid="step4-status-badge"
            style={{
              fontSize: 'var(--text-2xs)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 'var(--radius-xs)',
              background: 'rgba(16, 185, 129, 0.16)',
              color: '#6EE7B7',
              flexShrink: 0,
            }}
          >
            {isCleanBgmRunning ? `EP${cState.currentEpIndex}/${cState.totalEps}` : `${stats.cleanBgmPercent}%`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {isCleanBgmRunning ? (
            <button
              type="button"
              onClick={() => stopStep('clean_bgm')}
              style={{
                ...STEP_BTN_BASE,
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#FCA5A5',
              }}
              title="បញ្ឈប់ការបំបែកសំឡេង 1-by-1"
            >
              <Square size={10} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => runSequentialStep('clean_bgm', targetEpisodes, setupOptions)}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'rgba(16, 185, 129, 0.14)',
                  border: '1px solid rgba(16, 185, 129, 0.38)',
                  color: '#6EE7B7',
                }}
                title="រត់បំបែកសំឡេង Clean BGM ម្ដង ១ ភាគ (1-by-1)"
              >
                <Play size={10} fill="currentColor" />
                <span>Run 1-by-1</span>
              </button>
              <button
                type="button"
                data-testid="btn-bar-reclean-bgm"
                onClick={() => runSequentialStep('clean_bgm', targetEpisodes, { ...setupOptions, force: true })}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'var(--bg-elevated-panel)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title="បំបែកសំឡេង Clean BGM ឡើងវិញ (Re-Clean ភាគដែលរើស)"
              >
                <RotateCcw size={10} />
                <span>ធ្វើឡើងវិញ</span>
              </button>
            </>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--border-subtle)' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(isCleanBgmRunning ? 8 : 0, stats.cleanBgmPercent)}%`,
              background: '#10B981',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>
    </div>
  );
}
