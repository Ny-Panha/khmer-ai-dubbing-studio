import React from 'react';
import { X, Play, Square, RotateCcw, Wrench, FileText, Mic, Zap, VolumeX, Sparkles } from 'lucide-react';
import { useDubbingFeature } from '../../features/dubbing-runner/useDubbingFeature';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  checkEpisodeHasAutoFitReady,
  checkEpisodeHasCompactReady,
  getEpisodeBrokenSummary,
} from './geminiRouteHelpers';

export const STAGE_FOCUS_META = {
  translate: {
    label: '1. Script ខ្មែរ',
    shortLabel: '1. Script',
    accent: '#38BDF8',
    tint: 'rgba(56, 189, 248, 0.14)',
    border: 'rgba(56, 189, 248, 0.42)',
    Icon: FileText,
  },
  compact: {
    label: '✨ ខ្លីចំអត្ថន័យ',
    shortLabel: 'Auto Compact',
    accent: '#C084FC',
    tint: 'rgba(168, 85, 247, 0.14)',
    border: 'rgba(168, 85, 247, 0.42)',
    Icon: Sparkles,
  },
  tts: {
    label: '2. សំឡេង AI',
    shortLabel: '2. សំឡេង AI',
    accent: '#F472B6',
    tint: 'rgba(244, 114, 182, 0.14)',
    border: 'rgba(244, 114, 182, 0.42)',
    Icon: Mic,
  },
  autofit: {
    label: '3. Auto-Fit Speed',
    shortLabel: '3. Auto-Fit',
    accent: '#FBBF24',
    tint: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.42)',
    Icon: Zap,
  },
  demucs: {
    label: '4. Clean BGM',
    shortLabel: '4. Clean BGM',
    accent: '#34D399',
    tint: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.42)',
    Icon: VolumeX,
  },
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
    title: 'FFmpeg Instant (កាត់សំឡេងចិនកណ្តាល ~3–5 វិនាទី/ភាគ)',
    activeBg: 'rgba(245, 158, 11, 0.22)',
    activeBorder: 'rgba(245, 158, 11, 0.55)',
    activeColor: '#FDE68A',
  },
  {
    id: 'studio',
    label: 'Studio HQ',
    title: 'Studio Quality (Demucs htdemucs overlap 0.25 + shifts 1)',
    activeBg: 'rgba(56, 189, 248, 0.22)',
    activeBorder: 'rgba(56, 189, 248, 0.55)',
    activeColor: '#7DD3FC',
  },
];

export function checkEpisodeDoneForStage(
  ep,
  stageKey,
  { completedTtsEpIds, ttsLiveStats, completedDemucsEpIds, demucsLiveStats, isEpisodeFullyDone } = {}
) {
  if (!ep) return false;
  if (stageKey === 'translate') {
    return Boolean(checkEpisodeHasScript(ep) && (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) === 0);
  }
  if (stageKey === 'compact') {
    return Boolean(checkEpisodeHasCompactReady(ep));
  }
  if (stageKey === 'tts') {
    return Boolean(checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats) && !ep?.audioOutdated);
  }
  if (stageKey === 'autofit') {
    return Boolean(checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats) && checkEpisodeHasAutoFitReady(ep));
  }
  if (stageKey === 'demucs') {
    return Boolean(checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats));
  }
  return typeof isEpisodeFullyDone === 'function' ? isEpisodeFullyDone(ep) : false;
}

const TAB_BASE_STYLE = {
  height: 26,
  padding: '0 10px',
  borderRadius: 'var(--radius-xs)',
  fontSize: '11.5px',
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  whiteSpace: 'nowrap',
  transition: 'var(--transition-fast)',
};

const ACTION_BTN_STYLE = {
  height: 26,
  padding: '0 10px',
  borderRadius: 'var(--radius-xs)',
  fontSize: '11.5px',
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  whiteSpace: 'nowrap',
  transition: 'var(--transition-fast)',
};

export default function BatchStageFocusBar({
  episodes = [],
  selectedEpIds = null,
  setupOptions = {},
  separationPreset = 'turbo',
  onSeparationPresetChange = null,
  cardStageView = 'all',
  stageStatusFilter = 'all',
  onChangeStageStatusFilter,
  stageSummary = { total: 0, done: 0, todo: 0 },
  isBatchExecutionActive = false,
  onSelectStageTodoEpisodes,
  onSelectStageView,
  onExitStageFocus,
  openStudioDialog = null,
}) {
  const feature = useDubbingFeature(episodes) || {};
  const {
    runnerStates = {},
    runSequentialStep = () => {},
    stopStep = () => {},
    stats = {},
  } = feature;

  const targetEpisodes = React.useMemo(() => {
    if (selectedEpIds && selectedEpIds.size > 0) {
      return episodes.filter((ep) => selectedEpIds.has(ep.id));
    }
    return episodes;
  }, [episodes, selectedEpIds]);

  // Scope target episodes by stageStatusFilter ('todo' -> only incomplete episodes for this stage, 'done' -> only completed)
  const effectiveTargetEpisodes = React.useMemo(() => {
    let list = targetEpisodes;
    if (cardStageView && cardStageView !== 'all') {
      if (stageStatusFilter === 'todo') {
        list = targetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, cardStageView));
      } else if (stageStatusFilter === 'done') {
        list = targetEpisodes.filter((ep) => checkEpisodeDoneForStage(ep, cardStageView));
      }
    }
    return list;
  }, [targetEpisodes, cardStageView, stageStatusFilter]);

  const brokenTextCount = React.useMemo(() => {
    return effectiveTargetEpisodes.reduce((sum, ep) => sum + (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0), 0);
  }, [effectiveTargetEpisodes]);

  const effectiveSetupOptions = React.useMemo(
    () => ({ ...setupOptions, separationPreset: separationPreset || 'turbo' }),
    [setupOptions, separationPreset]
  );

  // Overview Mode ('all'): Show quick 1, 2, 3, 4 stage tabs on the top bar so user can jump directly
  if (!cardStageView || cardStageView === 'all') {
    const overviewSteps = [
      { key: 'translate', countText: `${stats.scriptedCount ?? 0}/${stats.total ?? episodes.length}` },
      { key: 'compact', countText: `${stats.compactCount ?? 0}/${stats.scriptedCount || stats.total || episodes.length}` },
      { key: 'tts', countText: `${stats.voicedCount ?? 0}/${stats.total ?? episodes.length}` },
      { key: 'autofit', countText: `${stats.autofitCount ?? 0}/${stats.voicedCount || stats.total || episodes.length}` },
      { key: 'demucs', countText: `${stats.cleanBgmCount ?? 0}/${stats.total ?? episodes.length}` },
    ];
    return (
      <div
        data-testid="stage-overview-nav-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6,
          padding: '7px 10px',
          marginBottom: 12,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-primary-panel)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-dim)', whiteSpace: 'nowrap', marginRight: 2 }}>
            ជំហាន (ចុចដើម្បីមើល &amp; Run):
          </span>
          {overviewSteps.map(({ key, countText }) => {
            const m = STAGE_FOCUS_META[key];
            const StepIcon = m.Icon;
            return (
              <button
                key={key}
                type="button"
                data-testid={`top-stage-tab-${key}`}
                onClick={() => onSelectStageView?.(key)}
                style={{
                  ...TAB_BASE_STYLE,
                  background: 'var(--bg-secondary-panel)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title={`បើកផ្ទាំង ${m.label}`}
              >
                <StepIcon size={12} color={m.accent} />
                <span>{m.shortLabel}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--text-secondary)' }}>
                  {countText}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const meta = STAGE_FOCUS_META[cardStageView] || STAGE_FOCUS_META.translate;
  const isTranslateRunning = runnerStates?.translate?.status === 'running';
  const isCompactRunning = runnerStates?.compact?.status === 'running';
  const isVoiceRunning = runnerStates?.voice?.status === 'running';
  const isAutoFitRunning = runnerStates?.autofit?.status === 'running';
  const isCleanBgmRunning = runnerStates?.clean_bgm?.status === 'running';

  return (
    <div
      data-testid="stage-focus-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        padding: '8px 12px',
        marginBottom: 12,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-primary-panel)',
        border: `1px solid ${meta.border}`,
        boxShadow: `inset 3px 0 0 ${meta.accent}`,
      }}
    >
      {/* Left: Stage Title + [ទាំងអស់ | មិនទាន់ធ្វើ | ធ្វើរួច] + Moved Step Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: meta.accent, whiteSpace: 'nowrap' }}>
          {meta.label}
        </span>

        {/* Filter Tabs */}
        <div
          role="tablist"
          aria-label="Filter stage completion"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={stageStatusFilter === 'all'}
            data-testid="stage-filter-all"
            onClick={() => onChangeStageStatusFilter('all')}
            style={{
              ...TAB_BASE_STYLE,
              background: stageStatusFilter === 'all' ? meta.tint : 'var(--bg-secondary-panel)',
              border: `1px solid ${stageStatusFilter === 'all' ? meta.border : 'var(--border-subtle)'}`,
              color: stageStatusFilter === 'all' ? meta.accent : 'var(--text-secondary)',
            }}
          >
            <span>ទាំងអស់ ({stageSummary.total})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={stageStatusFilter === 'todo'}
            data-testid="stage-filter-todo"
            onClick={() => onChangeStageStatusFilter('todo')}
            style={{
              ...TAB_BASE_STYLE,
              background: stageStatusFilter === 'todo' ? 'rgba(245, 158, 11, 0.16)' : 'var(--bg-secondary-panel)',
              border: `1px solid ${stageStatusFilter === 'todo' ? 'rgba(245, 158, 11, 0.5)' : 'var(--border-subtle)'}`,
              color: stageStatusFilter === 'todo' ? '#FBBF24' : 'var(--text-secondary)',
            }}
          >
            <span>មិនទាន់ធ្វើ ({stageSummary.todo})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={stageStatusFilter === 'done'}
            data-testid="stage-filter-done"
            onClick={() => onChangeStageStatusFilter('done')}
            style={{
              ...TAB_BASE_STYLE,
              background: stageStatusFilter === 'done' ? 'rgba(16, 185, 129, 0.16)' : 'var(--bg-secondary-panel)',
              border: `1px solid ${stageStatusFilter === 'done' ? 'rgba(16, 185, 129, 0.5)' : 'var(--border-subtle)'}`,
              color: stageStatusFilter === 'done' ? '#34D399' : 'var(--text-secondary)',
            }}
          >
            <span>ធ្វើរួច ({stageSummary.done})</span>
          </button>
        </div>

        <span style={{ width: 1, height: 18, background: 'var(--border-subtle)', flexShrink: 0 }} />

        {/* Active Step Action Buttons (Moved cleanly from Left Sidebar to Top Bar) */}
        <div
          data-testid="top-stage-actions"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}
        >
          {cardStageView === 'translate' && (
            isTranslateRunning ? (
              <button
                type="button"
                data-testid="top-btn-stop-translate"
                onClick={() => stopStep('translate')}
                style={{
                  ...ACTION_BTN_STYLE,
                  background: 'rgba(239, 68, 68, 0.18)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#FCA5A5',
                }}
              >
                <Square size={10} fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="top-btn-run-translate"
                  onClick={async () => {
                    const unscripted = effectiveTargetEpisodes.filter((ep) => !checkEpisodeHasScript(ep));
                    const broken = effectiveTargetEpisodes.filter((ep) => (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) > 0);

                    if (unscripted.length === 0 && broken.length === 0) {
                      if (typeof openStudioDialog === 'function') {
                        await openStudioDialog({
                          showCancel: false,
                          variant: 'info',
                          badge: 'SCRIPT READY',
                          title: 'គ្រប់ភាគដែលបានជ្រើសមាន Script រួចរាល់ 100% ហើយ',
                          message: `ភាគដែលបានជ្រើស (${effectiveTargetEpisodes.length} ភាគ) មាន Script រួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់បកប្រែថ្មីពីដើមឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ" (Re-Translate)។`,
                          confirmLabel: 'យល់ព្រម',
                        });
                      }
                      return;
                    }

                    if (unscripted.length > 0) {
                      runSequentialStep('translate', effectiveTargetEpisodes, setupOptions);
                    } else if (broken.length > 0) {
                      runSequentialStep('repair', broken, setupOptions);
                    }
                  }}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'rgba(56, 189, 248, 0.16)',
                    border: '1px solid rgba(56, 189, 248, 0.42)',
                    color: '#7DD3FC',
                  }}
                  title={stageSummary.todo === 0 ? 'គ្រប់ភាគទាំងអស់មាន Script រួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")' : 'រត់ Translate ភាគដែលមិនទាន់មាន Script (1-by-1)'}
                >
                  <Play size={10} fill="currentColor" />
                  <span>Run 1-by-1</span>
                </button>
                <button
                  type="button"
                  data-testid="top-btn-retranslate"
                  onClick={async () => {
                    const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'translate'));
                    const doneInTarget = effectiveTargetEpisodes.filter((ep) => checkEpisodeDoneForStage(ep, 'translate'));

                    // Protect completed episodes if target contains both done and todo
                    if (doneInTarget.length > 0 && todoInTarget.length > 0) {
                      const confirmed = typeof openStudioDialog === 'function'
                        ? await openStudioDialog({
                            variant: 'warning',
                            badge: 'RE-TRANSLATE',
                            title: 'បកប្រែ Script ឡើងវិញ?',
                            message: `មាន ${doneInTarget.length} ភាគបានធ្វើរួចរាល់ 100% ហើយ។ ប្រព័ន្ធនឹងបកប្រែឡើងវិញតែ ${todoInTarget.length} ភាគដែលមិនទាន់រួចរាល់/ខូចប៉ុណ្ណោះ ដើម្បីការពារកុំឱ្យបាត់ភាគដែលបានធ្វើរួច។`,
                            confirmLabel: `បកប្រែឡើងវិញតែភាគខូច/មិនទាន់ធ្វើ (${todoInTarget.length} ភាគ)`,
                            cancelLabel: 'បោះបង់',
                          })
                        : true;
                      if (confirmed) {
                        runSequentialStep('translate', todoInTarget, { ...setupOptions, force: true });
                      }
                      return;
                    }

                    const confirmed = typeof openStudioDialog === 'function'
                      ? await openStudioDialog({
                          variant: 'warning',
                          badge: 'RE-TRANSLATE',
                          title: 'បកប្រែ Script ឡើងវិញ?',
                          message: `តើអ្នកពិតជាចង់បកប្រែ Script ឡើងវិញលើ ${effectiveTargetEpisodes.length} ភាគនេះមែនទេ? Script ចាស់ និងសំឡេងដែលបានបង្កើតនឹងត្រូវលុបចេញ ដើម្បីបកប្រែថ្មីពីដើម។`,
                          confirmLabel: 'បកប្រែឡើងវិញ',
                          cancelLabel: 'បោះបង់',
                        })
                      : true;
                    if (confirmed) {
                      runSequentialStep('translate', effectiveTargetEpisodes, { ...setupOptions, force: true });
                    }
                  }}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'var(--bg-elevated-panel)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <RotateCcw size={10} />
                  <span>ធ្វើឡើងវិញ</span>
                </button>
                <button
                  type="button"
                  data-testid="top-btn-repair-text"
                  onClick={() => runSequentialStep('repair', effectiveTargetEpisodes, setupOptions)}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: brokenTextCount > 0 ? 'rgba(245, 158, 11, 0.2)' : 'var(--bg-elevated-panel)',
                    border: brokenTextCount > 0 ? '1px solid rgba(245, 158, 11, 0.55)' : '1px solid var(--border-subtle)',
                    color: brokenTextCount > 0 ? '#FDE68A' : 'var(--text-secondary)',
                  }}
                >
                  <Wrench size={10} />
                  <span>{brokenTextCount > 0 ? `ជួសជុល (${brokenTextCount})` : 'ជួសជុល'}</span>
                </button>
              </>
            )
          )}

          {cardStageView === 'compact' && (
            isCompactRunning ? (
              <button
                type="button"
                data-testid="top-btn-stop-compact"
                onClick={() => stopStep('compact')}
                style={{
                  ...ACTION_BTN_STYLE,
                  background: 'rgba(239, 68, 68, 0.18)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#FCA5A5',
                }}
              >
                <Square size={10} fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="top-btn-auto-compact"
                  onClick={async () => {
                    const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'compact'));
                    if (todoInTarget.length === 0) {
                      if (typeof openStudioDialog === 'function') {
                        await openStudioDialog({
                          showCancel: false,
                          variant: 'info',
                          badge: 'COMPACT READY',
                          title: 'គ្រប់ភាគទាំងអស់បានបម្លែង Script ខ្លីរួចរាល់ 100% ហើយ',
                          message: `គ្រប់ភាគទាំងអស់ (${effectiveTargetEpisodes.length} ភាគ) បានបម្លែង Script ខ្លីរួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់បម្លែងឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ"។`,
                          confirmLabel: 'យល់ព្រម',
                        });
                      }
                      return;
                    }
                    runSequentialStep('compact', effectiveTargetEpisodes, setupOptions);
                  }}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.25) 0%, rgba(124, 58, 237, 0.25) 100%)',
                    border: '1px solid rgba(168, 85, 247, 0.55)',
                    color: '#E9D5FF',
                  }}
                  title={stageSummary.todo === 0 ? 'គ្រប់ភាគទាំងអស់បានបម្លែង Script ខ្លីរួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")' : 'រត់បម្លែង Script ខ្លីចំអត្ថន័យ 1-by-1'}
                >
                  <Play size={10} fill="currentColor" />
                  <span>Run 1-by-1</span>
                </button>
                <button
                  type="button"
                  data-testid="top-btn-recompact"
                  onClick={async () => {
                    const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'compact'));
                    const doneInTarget = effectiveTargetEpisodes.filter((ep) => checkEpisodeDoneForStage(ep, 'compact'));
                    if (doneInTarget.length > 0 && todoInTarget.length > 0) {
                      const confirmed = typeof openStudioDialog === 'function'
                        ? await openStudioDialog({
                            variant: 'warning',
                            badge: 'RE-COMPACT',
                            title: 'បម្លែង Script ឡើងវិញ?',
                            message: `មាន ${doneInTarget.length} ភាគបានបម្លែងខ្លីរួចរាល់ហើយ។ តើចង់បម្លែងឡើងវិញតែ ${todoInTarget.length} ភាគដែលមិនទាន់បានបម្លែងមែនទេ?`,
                            confirmLabel: `បម្លែងតែភាគមិនទាន់ធ្វើ (${todoInTarget.length} ភាគ)`,
                            cancelLabel: 'បោះបង់',
                          })
                        : true;
                      if (confirmed) {
                        runSequentialStep('compact', todoInTarget, { ...setupOptions, force: true });
                      }
                      return;
                    }
                    runSequentialStep('compact', effectiveTargetEpisodes, { ...setupOptions, force: true });
                  }}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'var(--bg-elevated-panel)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                  title="បម្លែង Script ឡើងវិញគ្រប់ភាគ (Re-Compact)"
                >
                  <RotateCcw size={10} />
                  <span>ធ្វើឡើងវិញ</span>
                </button>
              </>
            )
          )}

          {cardStageView === 'tts' && (
            isVoiceRunning ? (
              <button
                type="button"
                data-testid="top-btn-stop-tts"
                onClick={() => stopStep('voice')}
                style={{
                  ...ACTION_BTN_STYLE,
                  background: 'rgba(239, 68, 68, 0.18)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#FCA5A5',
                }}
              >
                <Square size={10} fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="top-btn-run-tts"
                  onClick={async () => {
                    const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'tts'));
                    if (todoInTarget.length === 0) {
                      if (typeof openStudioDialog === 'function') {
                        await openStudioDialog({
                          showCancel: false,
                          variant: 'info',
                          badge: 'AI VOICE READY',
                          title: 'គ្រប់ភាគទាំងអស់មានសំឡេង AI រួចរាល់ 100% ហើយ',
                          message: `គ្រប់ភាគទាំងអស់ (${effectiveTargetEpisodes.length} ភាគ) មានសំឡេង AI រួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់បង្កើតសំឡេងឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ" (Re-Voice)។`,
                          confirmLabel: 'យល់ព្រម',
                        });
                      }
                      return;
                    }
                    runSequentialStep('voice', effectiveTargetEpisodes, setupOptions);
                  }}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'rgba(244, 114, 182, 0.16)',
                    border: '1px solid rgba(244, 114, 182, 0.42)',
                    color: '#F9A8D4',
                  }}
                  title={stageSummary.todo === 0 ? 'គ្រប់ភាគទាំងអស់មានសំឡេង AI រួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")' : 'រត់បង្កើតសំឡេង AI ភាគដែលមិនទាន់មាន (1-by-1)'}
                >
                  <Play size={10} fill="currentColor" />
                  <span>Run 1-by-1</span>
                </button>
                <button
                  type="button"
                  data-testid="top-btn-revoice"
                  onClick={async () => {
                    const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'tts'));
                    const doneInTarget = effectiveTargetEpisodes.filter((ep) => checkEpisodeDoneForStage(ep, 'tts'));

                    if (doneInTarget.length > 0 && todoInTarget.length > 0) {
                      const confirmed = typeof openStudioDialog === 'function'
                        ? await openStudioDialog({
                            variant: 'warning',
                            badge: 'RE-VOICE',
                            title: 'បង្កើតសំឡេង AI ឡើងវិញ?',
                            message: `មាន ${doneInTarget.length} ភាគមានសំឡេងរួចរាល់ហើយ។ តើអ្នកចង់បង្កើតសំឡេងឡើងវិញតែលើ ${todoInTarget.length} ភាគដែលមិនទាន់មានសំឡេងមែនទេ?`,
                            confirmLabel: `បង្កើតសំឡេងតែភាគមិនទាន់មាន (${todoInTarget.length} ភាគ)`,
                            cancelLabel: 'បោះបង់',
                          })
                        : true;
                      if (confirmed) {
                        runSequentialStep('voice', todoInTarget, { ...setupOptions, force: true });
                      }
                      return;
                    }

                    const confirmed = typeof openStudioDialog === 'function'
                      ? await openStudioDialog({
                          variant: 'warning',
                          badge: 'RE-VOICE',
                          title: 'បង្កើតសំឡេង AI ឡើងវិញ?',
                          message: `តើអ្នកពិតជាចង់បង្កើតសំឡេង AI ឡើងវិញលើ ${effectiveTargetEpisodes.length} ភាគនេះមែនទេ? សំឡេងចាស់នឹងត្រូវលុបចេញ ដើម្បីបង្កើតសំឡេងថ្មី ដោយរក្សាទុក Script ដដែល។`,
                          confirmLabel: 'បង្កើតឡើងវិញ',
                          cancelLabel: 'បោះបង់',
                        })
                      : true;
                    if (confirmed) {
                      runSequentialStep('voice', effectiveTargetEpisodes, { ...setupOptions, force: true });
                    }
                  }}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'var(--bg-elevated-panel)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <RotateCcw size={10} />
                  <span>ធ្វើឡើងវិញ</span>
                </button>
              </>
            )
          )}

          {cardStageView === 'autofit' && (
            isAutoFitRunning ? (
              <button
                type="button"
                data-testid="top-btn-stop-autofit"
                onClick={() => stopStep('autofit')}
                style={{
                  ...ACTION_BTN_STYLE,
                  background: 'rgba(239, 68, 68, 0.18)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#FCA5A5',
                }}
              >
                <Square size={10} fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="top-btn-run-autofit"
                  onClick={async () => {
                    const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'autofit'));
                    if (todoInTarget.length === 0) {
                      if (typeof openStudioDialog === 'function') {
                        await openStudioDialog({
                          showCancel: false,
                          variant: 'info',
                          badge: 'AUTO-FIT READY',
                          title: 'គ្រប់ភាគទាំងអស់បាន Auto-Fit Speed រួចរាល់ 100% ហើយ',
                          message: `គ្រប់ភាគទាំងអស់ (${effectiveTargetEpisodes.length} ភាគ) បាន Auto-Fit Speed រួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់ Auto-Fit ឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ"។`,
                          confirmLabel: 'យល់ព្រម',
                        });
                      }
                      return;
                    }
                    runSequentialStep('autofit', effectiveTargetEpisodes, setupOptions);
                  }}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'rgba(245, 158, 11, 0.16)',
                    border: '1px solid rgba(245, 158, 11, 0.42)',
                    color: '#FDE68A',
                  }}
                  title={stageSummary.todo === 0 ? 'គ្រប់ភាគទាំងអស់បាន Auto-Fit Speed រួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")' : 'រត់ Auto-Fit Speed ភាគដែលមិនទាន់បាន Fit (1-by-1)'}
                >
                  <Play size={10} fill="currentColor" />
                  <span>Run 1-by-1</span>
                </button>
                <button
                  type="button"
                  data-testid="top-btn-reautofit"
                  onClick={async () => {
                    const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'autofit'));
                    const doneInTarget = effectiveTargetEpisodes.filter((ep) => checkEpisodeDoneForStage(ep, 'autofit'));

                    if (doneInTarget.length > 0 && todoInTarget.length > 0) {
                      const confirmed = typeof openStudioDialog === 'function'
                        ? await openStudioDialog({
                            variant: 'warning',
                            badge: 'RE-AUTOFIT',
                            title: 'Auto-Fit Speed ឡើងវិញ?',
                            message: `មាន ${doneInTarget.length} ភាគបាន Auto-Fit រួចរាល់ហើយ។ តើអ្នកចង់ Auto-Fit ឡើងវិញតែលើ ${todoInTarget.length} ភាគដែលមិនទាន់បាន Fit មែនទេ?`,
                            confirmLabel: `Auto-Fit តែភាគមិនទាន់ធ្វើ (${todoInTarget.length} ភាគ)`,
                            cancelLabel: 'បោះបង់',
                          })
                        : true;
                      if (confirmed) {
                        runSequentialStep('autofit', todoInTarget, { ...setupOptions, force: true });
                      }
                      return;
                    }

                    runSequentialStep('autofit', effectiveTargetEpisodes, { ...setupOptions, force: true });
                  }}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'var(--bg-elevated-panel)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <RotateCcw size={10} />
                  <span>ធ្វើឡើងវិញ</span>
                </button>
              </>
            )
          )}

          {cardStageView === 'demucs' && (
            <>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {SEPARATION_PRESET_OPTIONS.map((opt) => {
                  const isSelected = (separationPreset || 'turbo') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isCleanBgmRunning}
                      onClick={() => {
                        try {
                          if (typeof window !== 'undefined' && window.localStorage) {
                            window.localStorage.setItem('dragondub_separation_preset', opt.id);
                          }
                        } catch {
                          // ignore storage errors
                        }
                        onSeparationPresetChange?.(opt.id);
                      }}
                      title={opt.title}
                      style={{
                        height: 24,
                        padding: '0 8px',
                        borderRadius: 999,
                        fontSize: '10.5px',
                        fontWeight: isSelected ? 700 : 600,
                        cursor: isCleanBgmRunning ? 'not-allowed' : 'pointer',
                        opacity: isCleanBgmRunning && !isSelected ? 0.5 : 1,
                        background: isSelected ? opt.activeBg : 'var(--bg-elevated-panel)',
                        border: `1px solid ${isSelected ? opt.activeBorder : 'var(--border-subtle)'}`,
                        color: isSelected ? opt.activeColor : 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {isCleanBgmRunning ? (
                <button
                  type="button"
                  data-testid="top-btn-stop-demucs"
                  onClick={() => stopStep('clean_bgm')}
                  style={{
                    ...ACTION_BTN_STYLE,
                    background: 'rgba(239, 68, 68, 0.18)',
                    border: '1px solid rgba(239, 68, 68, 0.45)',
                    color: '#FCA5A5',
                  }}
                >
                  <Square size={10} fill="currentColor" />
                  <span>Stop</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid="top-btn-run-demucs"
                    onClick={async () => {
                      const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'demucs'));
                      if (todoInTarget.length === 0) {
                        if (typeof openStudioDialog === 'function') {
                          await openStudioDialog({
                            showCancel: false,
                            variant: 'info',
                            badge: 'CLEAN BGM READY',
                            title: 'គ្រប់ភាគទាំងអស់មាន Clean BGM រួចរាល់ 100% ហើយ',
                            message: `គ្រប់ភាគទាំងអស់ (${effectiveTargetEpisodes.length} ភាគ) បានបំបែកសំឡេង Clean BGM រួចរាល់អស់ហើយ មិនបាច់រត់ឡើងវិញទេ។ ប្រសិនបើអ្នកចង់បំបែកឡើងវិញ សូមចុចប៊ូតុង "ធ្វើឡើងវិញ"។`,
                            confirmLabel: 'យល់ព្រម',
                          });
                        }
                        return;
                      }
                      runSequentialStep('clean_bgm', effectiveTargetEpisodes, effectiveSetupOptions);
                    }}
                    style={{
                      ...ACTION_BTN_STYLE,
                      background: 'rgba(16, 185, 129, 0.16)',
                      border: '1px solid rgba(16, 185, 129, 0.42)',
                      color: '#6EE7B7',
                    }}
                    title={stageSummary.todo === 0 ? 'គ្រប់ភាគទាំងអស់មាន Clean BGM រួចរាល់ 100% ហើយ (បើចង់ធ្វើឡើងវិញ សូមប្រើ "ធ្វើឡើងវិញ")' : 'រត់បំបែក Clean BGM ភាគដែលមិនទាន់មាន (1-by-1)'}
                  >
                    <Play size={10} fill="currentColor" />
                    <span>Run 1-by-1</span>
                  </button>
                  <button
                    type="button"
                    data-testid="top-btn-reclean-bgm"
                    onClick={async () => {
                      const todoInTarget = effectiveTargetEpisodes.filter((ep) => !checkEpisodeDoneForStage(ep, 'demucs'));
                      const doneInTarget = effectiveTargetEpisodes.filter((ep) => checkEpisodeDoneForStage(ep, 'demucs'));

                      if (doneInTarget.length > 0 && todoInTarget.length > 0) {
                        const confirmed = typeof openStudioDialog === 'function'
                          ? await openStudioDialog({
                              variant: 'warning',
                              badge: 'RE-DEMUCS',
                              title: 'បំបែក Clean BGM ឡើងវិញ?',
                              message: `មាន ${doneInTarget.length} ភាគបាន Clean BGM រួចរាល់ហើយ។ តើអ្នកចង់បំបែកឡើងវិញតែលើ ${todoInTarget.length} ភាគដែលមិនទាន់មាន BGM មែនទេ?`,
                              confirmLabel: `បំបែកតែភាគមិនទាន់មាន (${todoInTarget.length} ភាគ)`,
                              cancelLabel: 'បោះបង់',
                            })
                          : true;
                        if (confirmed) {
                          runSequentialStep('clean_bgm', todoInTarget, { ...effectiveSetupOptions, force: true });
                        }
                        return;
                      }

                      runSequentialStep('clean_bgm', effectiveTargetEpisodes, { ...effectiveSetupOptions, force: true });
                    }}
                    style={{
                      ...ACTION_BTN_STYLE,
                      background: 'var(--bg-elevated-panel)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <RotateCcw size={10} />
                    <span>ធ្វើឡើងវិញ</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right: Quick Select Todo + Back to All 4 Steps */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {stageSummary.todo > 0 && !isBatchExecutionActive && (
          <button
            type="button"
            data-testid="btn-select-stage-todo"
            onClick={onSelectStageTodoEpisodes}
            style={{
              ...TAB_BASE_STYLE,
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              color: '#FDE68A',
            }}
            title="ជ្រើសរើសភាគដែលមិនទាន់ធ្វើជំហាននេះទាំងអស់"
          >
            <span>ជ្រើសមិនទាន់ធ្វើ ({stageSummary.todo})</span>
          </button>
        )}
        <button
          type="button"
          data-testid="btn-exit-stage-focus"
          onClick={onExitStageFocus}
          style={{
            ...TAB_BASE_STYLE,
            background: 'var(--bg-elevated-panel)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          <span>មើលទាំង 4 ជំហាន</span>
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
