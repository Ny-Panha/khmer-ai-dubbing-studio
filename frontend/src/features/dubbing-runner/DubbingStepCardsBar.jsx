import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, CheckCircle2, FileText, Mic, VolumeX, Play, Square, RotateCcw, Wrench, Zap, Sparkles, Check, X } from 'lucide-react';
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

const SEPARATION_PRESET_OPTIONS = [
  {
    id: 'turbo',
    label: 'Demucs Turbo',
    title: 'Demucs Turbo Multi-Core (លឿនជាងមុន 3x–4x លើ CPU, ភ្លេង BGM ច្បាស់ល្អ)',
    activeBg: 'rgba(16, 185, 129, 0.22)',
    activeBorder: 'rgba(16, 185, 129, 0.55)',
    activeColor: '#6EE7B7',
  },
  {
    id: 'ffmpeg_fast',
    label: 'FFmpeg 5s',
    title: 'FFmpeg Instant (កាត់សំឡេងចិនកណ្តាល ~3–5 វិនាទី/ភាគ រក្សាបាស BGM សម្រាប់ Batch រហ័ស)',
    activeBg: 'rgba(245, 158, 11, 0.22)',
    activeBorder: 'rgba(245, 158, 11, 0.55)',
    activeColor: '#FDE68A',
  },
  {
    id: 'studio',
    label: 'Studio HQ',
    title: 'Studio Quality (Demucs htdemucs overlap 0.25 + shifts 1 គុណភាពខ្ពស់បំផុត)',
    activeBg: 'rgba(56, 189, 248, 0.22)',
    activeBorder: 'rgba(56, 189, 248, 0.55)',
    activeColor: '#7DD3FC',
  },
];

export default function DubbingStepCardsBar({
  episodes = [],
  selectedEpIds = null,
  setupOptions = {},
  separationPreset = null,
  onSeparationPresetChange = null,
  activeStageView = 'all',
  onSelectStageView = null,
  navOnly = false,
  openStudioDialog = null,
}) {
  const feature = useDubbingFeature(episodes) || {};
  const {
    runnerStates = {},
    runSequentialStep = () => {},
    stopStep = () => {},
    stats = {},
  } = feature;

  const [localSepPreset, setLocalSepPreset] = React.useState(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage?.getItem('dragondub_separation_preset') : null;
      return ['turbo', 'studio', 'ffmpeg_fast'].includes(saved) ? saved : 'turbo';
    } catch (_) {
      return 'turbo';
    }
  });

  const activeSepPreset = separationPreset || setupOptions?.separationPreset || localSepPreset;

  const handleSelectSepPreset = React.useCallback((nextId) => {
    setLocalSepPreset(nextId);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('dragondub_separation_preset', nextId);
      }
    } catch (_) {}
    if (typeof onSeparationPresetChange === 'function') {
      onSeparationPresetChange(nextId);
    }
  }, [onSeparationPresetChange]);

  const effectiveSetupOptions = React.useMemo(
    () => ({ ...setupOptions, separationPreset: activeSepPreset }),
    [setupOptions, activeSepPreset]
  );

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
  const cpState = runnerStates?.compact || {};
  const vState = runnerStates?.voice || {};
  const afState = runnerStates?.autofit || {};
  const cState = runnerStates?.clean_bgm || {};

  const isTranslateRunning = tState.status === 'running';
  const isCompactRunning = cpState.status === 'running';
  const isVoiceRunning = vState.status === 'running';
  const isAutoFitRunning = afState.status === 'running';
  const isCleanBgmRunning = cState.status === 'running';

  const [showCompactConfirm, setShowCompactConfirm] = React.useState(false);

  const totalSegmentsCount = React.useMemo(() => {
    let sum = 0;
    for (const ep of targetEpisodes) {
      sum += (ep.scriptData?.segments?.length || 0);
    }
    return sum;
  }, [targetEpisodes]);

  const isTranslateActiveView = activeStageView === 'translate';
  const isCompactActiveView = activeStageView === 'compact';
  const isTtsActiveView = activeStageView === 'tts';
  const isAutofitActiveView = activeStageView === 'autofit';
  const isDemucsActiveView = activeStageView === 'demucs';
  const canSelectStage = typeof onSelectStageView === 'function';
  const handleCardStageSelect = (stageKey) => {
    if (canSelectStage) onSelectStageView(stageKey);
  };

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
        data-active-stage={isTranslateActiveView ? 'true' : 'false'}
        onClick={() => handleCardStageSelect('translate')}
        title={canSelectStage ? 'ចុចដើម្បីមើលតែជំហាន 1. Script ខ្មែរ នៅបញ្ជីខាងស្តាំ (ចុចម្តងទៀតដើម្បីមើលទាំងអស់)' : undefined}
        style={{
          position: 'relative',
          padding: navOnly ? '9px 11px 11px' : '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: isTranslateActiveView ? 'var(--bg-active-card)' : 'var(--bg-secondary-panel)',
          border: (isTranslateRunning || isTranslateActiveView) ? '1px solid #38BDF8' : '1px solid var(--border-subtle)',
          boxShadow: isTranslateActiveView ? 'inset 3px 0 0 #38BDF8' : 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: navOnly ? 6 : 8,
          overflow: 'hidden',
          cursor: canSelectStage ? 'pointer' : 'default',
          transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
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
            {navOnly && brokenTextCount > 0 && (
              <span style={{
                fontSize: '9.5px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(245, 158, 11, 0.2)',
                color: '#FDE68A',
                whiteSpace: 'nowrap',
              }}>
                ខូច {brokenTextCount}
              </span>
            )}
            {isTranslateActiveView && (
              <span style={{
                fontSize: '9.5px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(56, 189, 248, 0.2)',
                color: '#7DD3FC',
                whiteSpace: 'nowrap',
              }}>
                កំពុងមើល
              </span>
            )}
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
              background: tState.status === 'failed' ? 'rgba(239, 68, 68, 0.18)' : stats.translatePercent === 100 ? 'rgba(16, 185, 129, 0.16)' : 'rgba(56, 189, 248, 0.14)',
              color: tState.status === 'failed' ? '#FCA5A5' : stats.translatePercent === 100 ? '#6EE7B7' : '#7DD3FC',
              flexShrink: 0,
            }}
          >
            {tState.status === 'failed' ? 'បរាជ័យ' : isTranslateRunning ? `EP${tState.currentEpIndex}/${tState.totalEps}` : `${stats.translatePercent}%`}
          </span>
        </div>

        {(!navOnly || isTranslateRunning) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
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
                onClick={async () => {
                  const unscripted = targetEpisodes.filter((ep) => !checkEpisodeHasScript(ep));
                  if (unscripted.length === 0) {
                    if (typeof openStudioDialog === 'function') {
                      await openStudioDialog({
                        showCancel: false,
                        variant: 'info',
                        badge: 'SCRIPT READY',
                        title: 'គ្រប់ភាគទាំងអស់មាន Script រួចរាល់ 100% ហើយ',
                        message: `គ្រប់ភាគទាំងអស់ (${targetEpisodes.length} ភាគ) មាន Script រួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់បកប្រែថ្មីពីដើមឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ" (Re-Translate)។`,
                        confirmLabel: 'យល់ព្រម',
                      });
                    }
                    return;
                  }
                  runSequentialStep('translate', targetEpisodes, setupOptions);
                }}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'rgba(56, 189, 248, 0.14)',
                  border: '1px solid rgba(56, 189, 248, 0.38)',
                  color: '#7DD3FC',
                }}
                title={targetEpisodes.every((ep) => checkEpisodeHasScript(ep)) ? 'គ្រប់ភាគទាំងអស់មាន Script រួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")' : 'រត់ Translate ភាគដែលមិនទាន់មាន Script (1-by-1)'}
              >
                <Play size={10} fill="currentColor" />
                <span>Run 1-by-1</span>
              </button>
              <button
                type="button"
                data-testid="btn-bar-retranslate"
                onClick={async () => {
                  const unscripted = targetEpisodes.filter((ep) => !checkEpisodeHasScript(ep));
                  const broken = targetEpisodes.filter((ep) => (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) > 0);
                  const todo = targetEpisodes.filter((ep) => !checkEpisodeHasScript(ep) || (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) > 0);
                  const done = targetEpisodes.filter((ep) => checkEpisodeHasScript(ep) && (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) === 0);

                  if (done.length > 0 && todo.length > 0) {
                    const confirmed = typeof openStudioDialog === 'function'
                      ? await openStudioDialog({
                          variant: 'warning',
                          badge: 'RE-TRANSLATE',
                          title: 'បកប្រែ Script ឡើងវិញ?',
                          message: `មាន ${done.length} ភាគបានធ្វើរួចរាល់ 100% ហើយ។ ប្រព័ន្ធនឹងបកប្រែឡើងវិញតែ ${todo.length} ភាគដែលមិនទាន់រួចរាល់/ខូចប៉ុណ្ណោះ ដើម្បីការពារកុំឱ្យបាត់ភាគដែលបានធ្វើរួច។`,
                          confirmLabel: `បកប្រែឡើងវិញតែភាគខូច/មិនទាន់ធ្វើ (${todo.length} ភាគ)`,
                          cancelLabel: 'បោះបង់',
                        })
                      : true;
                    if (confirmed) {
                      runSequentialStep('translate', todo, { ...setupOptions, force: true });
                    }
                    return;
                  }

                  const confirmed = typeof openStudioDialog === 'function'
                    ? await openStudioDialog({
                        variant: 'warning',
                        badge: 'RE-TRANSLATE',
                        title: 'បកប្រែ Script ឡើងវិញ?',
                        message: `តើអ្នកពិតជាចង់បកប្រែ Script ឡើងវិញលើ ${targetEpisodes.length} ភាគនេះមែនទេ? Script ចាស់ និងសំឡេងដែលបានបង្កើតនឹងត្រូវលុបចេញ ដើម្បីបកប្រែថ្មីពីដើម។`,
                        confirmLabel: 'បកប្រែឡើងវិញ',
                        cancelLabel: 'បោះបង់',
                      })
                    : true;
                  if (confirmed) {
                    runSequentialStep('translate', targetEpisodes, { ...setupOptions, force: true });
                  }
                }}
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
        )}

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

      {/* ── CARD 1.5: ✨ ខ្លីចំអត្ថន័យ (Auto Compact) ── */}
      <div
        data-testid="step-row-compact"
        data-active-stage={isCompactActiveView ? 'true' : 'false'}
        onClick={() => handleCardStageSelect('compact')}
        title={canSelectStage ? 'ចុចដើម្បីមើលតែជំហាន ខ្លីចំអត្ថន័យ នៅបញ្ជីខាងស្តាំ (ចុចម្តងទៀតដើម្បីមើលទាំងអស់)' : undefined}
        style={{
          position: 'relative',
          padding: navOnly ? '9px 11px 11px' : '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: isCompactActiveView ? 'var(--bg-active-card)' : 'var(--bg-secondary-panel)',
          border: (isCompactRunning || isCompactActiveView) ? '1px solid #C084FC' : '1px solid var(--border-subtle)',
          boxShadow: isCompactActiveView ? 'inset 3px 0 0 #C084FC' : 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: navOnly ? 6 : 8,
          overflow: 'hidden',
          cursor: canSelectStage ? 'pointer' : 'default',
          transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {isCompactRunning ? (
              <Loader2 size={14} className="animate-spin" color="#C084FC" />
            ) : (stats.compactPercent ?? 0) === 100 ? (
              <CheckCircle2 size={14} color="#34D399" />
            ) : (
              <Sparkles size={14} color="#C084FC" />
            )}
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              ✨ ខ្លីចំអត្ថន័យ:
            </span>
            <span style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {stats.compactCount ?? 0}/{stats.total}
            </span>
            {isCompactActiveView && (
              <span style={{
                fontSize: '9.5px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(168, 85, 247, 0.2)',
                color: '#D8B4FE',
                whiteSpace: 'nowrap',
              }}>
                កំពុងមើល
              </span>
            )}
          </div>

          <span
            data-testid="step-compact-status-badge"
            style={{
              fontSize: 'var(--text-2xs)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 'var(--radius-xs)',
              background: cpState.status === 'failed'
                ? 'rgba(239, 68, 68, 0.18)'
                : (stats.compactPercent ?? 0) === 100
                  ? 'rgba(16, 185, 129, 0.16)'
                  : 'rgba(168, 85, 247, 0.14)',
              color: cpState.status === 'failed'
                ? '#FCA5A5'
                : (stats.compactPercent ?? 0) === 100
                  ? '#6EE7B7'
                  : '#D8B4FE',
              flexShrink: 0,
            }}
          >
            {cpState.status === 'failed' ? 'បរាជ័យ' : isCompactRunning ? `EP${cpState.currentEpIndex}/${cpState.totalEps}` : `${stats.compactPercent ?? 0}%`}
          </span>
        </div>

        {(!navOnly || isCompactRunning) && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
          >
            {isCompactRunning ? (
              <button
                type="button"
                onClick={() => stopStep('compact')}
                style={{
                  ...STEP_BTN_BASE,
                  background: 'rgba(239, 68, 68, 0.18)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#FCA5A5',
                }}
                title="បញ្ឈប់ការ Auto Compact"
              >
                <Square size={10} fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="btn-open-compact-modal"
                  onClick={() => setShowCompactConfirm(true)}
                  style={{
                    ...STEP_BTN_BASE,
                    background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.22) 0%, rgba(124, 58, 237, 0.22) 100%)',
                    border: '1px solid rgba(168, 85, 247, 0.55)',
                    color: '#E9D5FF',
                  }}
                  title="បម្លែងគ្រប់ Script ជា «ខ្លីចំអត្ថន័យ» (Auto Compact)"
                >
                  <Play size={10} fill="currentColor" />
                  <span>Run 1-by-1</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCompactConfirm(true)}
                  style={{
                    ...STEP_BTN_BASE,
                    background: 'var(--bg-elevated-panel)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                  title="បើកផ្ទាំងផ្ទៀងផ្ទាត់ Auto Compact"
                >
                  <Sparkles size={10} />
                  <span>ផ្ទាំងបម្លែង</span>
                </button>
              </>
            )}
          </div>
        )}

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--border-subtle)' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(isCompactRunning ? 8 : 0, stats.compactPercent ?? 0)}%`,
              background: (stats.compactPercent ?? 0) === 100 ? '#10B981' : '#A855F7',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* ── CARD 2: 2. សំឡេងខ្មែរ AI ── */}
      <div
        data-testid="step-row-tts"
        data-active-stage={isTtsActiveView ? 'true' : 'false'}
        onClick={() => handleCardStageSelect('tts')}
        title={canSelectStage ? 'ចុចដើម្បីមើលតែជំហាន 2. សំឡេង AI នៅបញ្ជីខាងស្តាំ (ចុចម្តងទៀតដើម្បីមើលទាំងអស់)' : undefined}
        style={{
          position: 'relative',
          padding: navOnly ? '9px 11px 11px' : '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: isTtsActiveView ? 'var(--bg-active-card)' : 'var(--bg-secondary-panel)',
          border: (isVoiceRunning || isTtsActiveView) ? '1px solid #F472B6' : '1px solid var(--border-subtle)',
          boxShadow: isTtsActiveView ? 'inset 3px 0 0 #F472B6' : 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: navOnly ? 6 : 8,
          overflow: 'hidden',
          cursor: canSelectStage ? 'pointer' : 'default',
          transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
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
            {isTtsActiveView && (
              <span style={{
                fontSize: '9.5px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(244, 114, 182, 0.2)',
                color: '#F9A8D4',
                whiteSpace: 'nowrap',
              }}>
                កំពុងមើល
              </span>
            )}
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
              background: vState.status === 'failed' ? 'rgba(239, 68, 68, 0.18)' : stats.voicePercent === 100 ? 'rgba(16, 185, 129, 0.16)' : 'rgba(244, 114, 182, 0.16)',
              color: vState.status === 'failed' ? '#FCA5A5' : stats.voicePercent === 100 ? '#6EE7B7' : '#F9A8D4',
              flexShrink: 0,
            }}
          >
            {vState.status === 'failed' ? 'បរាជ័យ' : isVoiceRunning ? `EP${vState.currentEpIndex}/${vState.totalEps}` : `${stats.voicePercent}%`}
          </span>
        </div>

        {(!navOnly || isVoiceRunning) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
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
                onClick={async () => {
                  const unvoiced = targetEpisodes.filter((ep) => checkEpisodeHasScript(ep) && (!checkEpisodeHasAudioReady(ep, null, null) || ep.audioOutdated));
                  if (unvoiced.length === 0) {
                    if (typeof openStudioDialog === 'function') {
                      await openStudioDialog({
                        showCancel: false,
                        variant: 'info',
                        badge: 'AI VOICE READY',
                        title: 'គ្រប់ភាគទាំងអស់មានសំឡេង AI រួចរាល់ 100% ហើយ',
                        message: `គ្រប់ភាគទាំងអស់ (${targetEpisodes.length} ភាគ) មានសំឡេង AI រួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់បង្កើតសំឡេងឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ" (Re-Voice)។`,
                        confirmLabel: 'យល់ព្រម',
                      });
                    }
                    return;
                  }
                  runSequentialStep('voice', targetEpisodes, setupOptions);
                }}
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
                onClick={async () => {
                  const confirmed = typeof openStudioDialog === 'function'
                    ? await openStudioDialog({
                        variant: 'warning',
                        badge: 'RE-VOICE',
                        title: 'បង្កើតសំឡេង AI ឡើងវិញ?',
                        message: 'តើអ្នកពិតជាចង់បង្កើតសំឡេង AI ឡើងវិញមែនទេ? សំឡេងចាស់នឹងត្រូវលុបចេញ ដើម្បីបង្កើតសំឡេងថ្មី ដោយរក្សាទុក Script ដដែល។',
                        confirmLabel: 'បង្កើតឡើងវិញ',
                        cancelLabel: 'បោះបង់',
                      })
                    : true;
                  if (confirmed) {
                    runSequentialStep('voice', targetEpisodes, { ...setupOptions, force: true });
                  }
                }}
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
        )}

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
        data-active-stage={isAutofitActiveView ? 'true' : 'false'}
        onClick={() => handleCardStageSelect('autofit')}
        title={canSelectStage ? 'ចុចដើម្បីមើលតែជំហាន 3. Auto-Fit នៅបញ្ជីខាងស្តាំ (ចុចម្តងទៀតដើម្បីមើលទាំងអស់)' : undefined}
        style={{
          position: 'relative',
          padding: navOnly ? '9px 11px 11px' : '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: isAutofitActiveView ? 'var(--bg-active-card)' : 'var(--bg-secondary-panel)',
          border: (isAutoFitRunning || isAutofitActiveView) ? '1px solid #FBBF24' : '1px solid var(--border-subtle)',
          boxShadow: isAutofitActiveView ? 'inset 3px 0 0 #FBBF24' : 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: navOnly ? 6 : 8,
          overflow: 'hidden',
          cursor: canSelectStage ? 'pointer' : 'default',
          transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
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
            {isAutofitActiveView && (
              <span style={{
                fontSize: '9.5px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(245, 158, 11, 0.2)',
                color: '#FDE68A',
                whiteSpace: 'nowrap',
              }}>
                កំពុងមើល
              </span>
            )}
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

        {(!navOnly || isAutoFitRunning) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
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
                onClick={async () => {
                  const unfitted = targetEpisodes.filter((ep) => checkEpisodeHasScript(ep) && checkEpisodeHasAudioReady(ep, null, null) && !checkEpisodeHasAutoFitReady(ep));
                  if (unfitted.length === 0) {
                    if (typeof openStudioDialog === 'function') {
                      await openStudioDialog({
                        showCancel: false,
                        variant: 'info',
                        badge: 'AUTO-FIT READY',
                        title: 'គ្រប់ភាគទាំងអស់បាន Auto-Fit Speed រួចរាល់ 100% ហើយ',
                        message: `គ្រប់ភាគទាំងអស់ (${targetEpisodes.length} ភាគ) បាន Auto-Fit Speed រួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់ Auto-Fit ឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ"។`,
                        confirmLabel: 'យល់ព្រម',
                      });
                    }
                    return;
                  }
                  runSequentialStep('autofit', targetEpisodes, setupOptions);
                }}
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
        )}

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
        data-active-stage={isDemucsActiveView ? 'true' : 'false'}
        onClick={() => handleCardStageSelect('demucs')}
        title={canSelectStage ? 'ចុចដើម្បីមើលតែជំហាន 4. Clean BGM នៅបញ្ជីខាងស្តាំ (ចុចម្តងទៀតដើម្បីមើលទាំងអស់)' : undefined}
        style={{
          position: 'relative',
          padding: navOnly ? '9px 11px 11px' : '10px 12px 12px',
          borderRadius: 'var(--radius-sm)',
          background: isDemucsActiveView ? 'var(--bg-active-card)' : 'var(--bg-secondary-panel)',
          border: (isCleanBgmRunning || isDemucsActiveView) ? '1px solid #34D399' : '1px solid var(--border-subtle)',
          boxShadow: isDemucsActiveView ? 'inset 3px 0 0 #34D399' : 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: navOnly ? 6 : 8,
          overflow: 'hidden',
          cursor: canSelectStage ? 'pointer' : 'default',
          transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
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
            {isDemucsActiveView && (
              <span style={{
                fontSize: '9.5px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#6EE7B7',
                whiteSpace: 'nowrap',
              }}>
                កំពុងមើល
              </span>
            )}
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
              background: cState.status === 'failed'
                ? 'rgba(239, 68, 68, 0.18)'
                : cState.status === 'queued'
                  ? 'rgba(245, 158, 11, 0.18)'
                  : 'rgba(16, 185, 129, 0.16)',
              color: cState.status === 'failed'
                ? '#FCA5A5'
                : cState.status === 'queued'
                  ? '#FDE68A'
                  : '#6EE7B7',
              flexShrink: 0,
            }}
          >
            {cState.status === 'failed'
              ? 'បរាជ័យ'
              : cState.status === 'queued'
                ? 'ក្នុងជួរ'
                : isCleanBgmRunning
                  ? `EP${cState.currentEpIndex}/${cState.totalEps}`
                  : `${stats.cleanBgmPercent}%`}
          </span>
        </div>

        {/* Clean BGM Speed Mode Pill */}
        {!navOnly && (
        <div
          role="group"
          aria-label="Clean BGM Speed Mode"
          data-testid="clean-bgm-preset-bar"
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
          }}
        >
          {SEPARATION_PRESET_OPTIONS.map((opt) => {
            const isSelected = activeSepPreset === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`btn-preset-${opt.id}`}
                aria-pressed={isSelected}
                disabled={isCleanBgmRunning}
                onClick={() => handleSelectSepPreset(opt.id)}
                title={opt.title}
                style={{
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontSize: 'var(--text-2xs)',
                  fontWeight: isSelected ? 700 : 600,
                  lineHeight: 1.35,
                  cursor: isCleanBgmRunning ? 'not-allowed' : 'pointer',
                  opacity: isCleanBgmRunning && !isSelected ? 0.5 : 1,
                  background: isSelected ? opt.activeBg : 'var(--bg-elevated-panel)',
                  border: `1px solid ${isSelected ? opt.activeBorder : 'var(--border-subtle)'}`,
                  color: isSelected ? opt.activeColor : 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        )}

        {(!navOnly || isCleanBgmRunning) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
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
                onClick={async () => {
                  const unseparated = targetEpisodes.filter((ep) => !checkEpisodeHasDemucsReady(ep, null, null));
                  if (unseparated.length === 0) {
                    if (typeof openStudioDialog === 'function') {
                      await openStudioDialog({
                        showCancel: false,
                        variant: 'info',
                        badge: 'CLEAN BGM READY',
                        title: 'គ្រប់ភាគទាំងអស់មាន Clean BGM រួចរាល់ 100% ហើយ',
                        message: `គ្រប់ភាគទាំងអស់ (${targetEpisodes.length} ភាគ) បានបំបែកសំឡេង Clean BGM រួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់បំបែកឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ"។`,
                        confirmLabel: 'យល់ព្រម',
                      });
                    }
                    return;
                  }
                  runSequentialStep('clean_bgm', targetEpisodes, effectiveSetupOptions);
                }}
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
                onClick={() => runSequentialStep('clean_bgm', targetEpisodes, { ...effectiveSetupOptions, force: true })}
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
        )}

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

      {/* ── AUTO COMPACT CONFIRMATION MODAL (Image 1 Style) ── */}
      {showCompactConfirm && typeof document !== 'undefined' && createPortal(
        <div
          data-testid="modal-dubbing-compact-confirm"
          style={{
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999999,
            padding: 16,
            pointerEvents: 'auto',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setShowCompactConfirm(false);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: '#0e1320',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              borderRadius: 14,
              padding: '20px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 24px 50px rgba(0, 0, 0, 0.8), 0 0 25px rgba(168, 85, 247, 0.2)',
              color: '#f1f5f9',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.92rem', fontWeight: 800, color: '#f3e8ff' }}>
                <Sparkles size={18} color="#c084fc" />
                <span>បម្លែងគ្រប់ Script ជា «ខ្លីចំអត្ថន័យ» (Auto Compact)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCompactConfirm(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.80rem', color: '#cbd5e1', lineHeight: 1.55 }}>
              <div style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.25)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontWeight: 700, color: '#e9d5ff', fontSize: '0.84rem' }}>
                  តើអ្នកចង់បម្លែងគ្រប់ Script ទាំង {targetEpisodes.length} ភាគ {totalSegmentsCount > 0 ? `(${totalSegmentsCount} ឃ្លា)` : ''}?
                </div>
                <div style={{ color: '#d8b4fe', fontSize: '0.76rem' }}>
                  AI នឹងបកប្រែឡើងវិញជាភាសា Subtitle ខ្លី ចំខ្លឹមសារ ១០០% (បែបកុនចិន/ហុងកុង ទំនើប)
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingLeft: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>ខ្លី ចំអត្ថន័យ ១០០%៖</strong> កាត់បន្ថយពាក្យសម្ដីវែងអូសបន្លាយឥតប្រយោជន៍</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>Lip-sync ត្រូវមាត់៖</strong> ជួយឱ្យសំឡេង AI និយាយរលូន មិនហៀរជាន់ឃ្លាបន្ទាប់</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>Auto-Save៖</strong> រក្សាទុកទិន្នន័យដោយស្វ័យប្រវត្តក្នុង project</span>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <button
                type="button"
                onClick={() => setShowCompactConfirm(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  background: 'transparent',
                  color: '#94a3b8',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                data-testid="btn-confirm-compact-now-batch"
                onClick={() => {
                  setShowCompactConfirm(false);
                  const uncompacted = targetEpisodes.filter((ep) => checkEpisodeHasScript(ep) && !ep.scriptData?.autoCompacted);
                  if (uncompacted.length === 0) {
                    if (typeof openStudioDialog === 'function') {
                      openStudioDialog({
                        showCancel: false,
                        variant: 'info',
                        badge: 'COMPACT READY',
                        title: 'គ្រប់ភាគទាំងអស់បានបម្លែង Script ខ្លីរួចរាល់ 100% ហើយ',
                        message: `គ្រប់ភាគទាំងអស់ (${targetEpisodes.length} ភាគ) បានបម្លែង Script ខ្លីរួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។`,
                        confirmLabel: 'យល់ព្រម',
                      });
                    }
                    return;
                  }
                  runSequentialStep('compact', targetEpisodes, setupOptions);
                }}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  border: '1px solid rgba(168, 85, 247, 0.7)',
                  background: 'linear-gradient(135deg, #9333ea 0%, #7c3aed 100%)',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 10px rgba(147, 51, 234, 0.4)',
                }}
              >
                <Sparkles size={14} />
                <span>បម្លែងទាំងអស់ឥឡូវនេះ (Start Auto Compact)</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
