import React from 'react';
import {
  CheckCircle2, Check, Clock, ArrowRight, Loader2, RefreshCw, RotateCcw,
  AlertTriangle, Zap, Circle, Wrench, Volume2, Sparkles,
} from 'lucide-react';
import { formatTimecode } from '../../utils/timestampUtils';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  checkEpisodeHasAutoFitReady,
  getEpisodeSegmentCount,
  getEpisodeGenderCounts,
  getEpisodeBrokenSummary,
  isJobCompletedSegmentsMissing,
} from './geminiRouteHelpers';
import EpisodeTranslateProgressCard from './route-runners/EpisodeTranslateProgressCard';
import EpisodeCompactProgressCard from './route-runners/EpisodeCompactProgressCard';
import EpisodeTtsProgressCard from './route-runners/EpisodeTtsProgressCard';
import EpisodeAutoFitProgressCard from './route-runners/EpisodeAutoFitProgressCard';
import EpisodeDemucsProgressCard from './route-runners/EpisodeDemucsProgressCard';

const ROW_ACTION_BTN = {
  height: 26,
  padding: '0 9px',
  borderRadius: 6,
  fontSize: '11px',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'var(--transition-fast)',
};

function BatchEpisodeCard({
  ep,
  idx,
  keyThemes: KEY_THEMES,
  selectedEpIds,
  toggleSelect,
  jobsByEpisodeId,
  poolTotalKeys,
  keyThemeCount,
  cardStageView,
  runnerStates,
  runnerLiveStats,
  runnerStopStep,
  runSingleAutoFitSpeed,
  runSingleAutoCompact,
  ttsLiveStats,
  demucsLiveStats,
  activeTtsEpisodeId,
  activeTtsEpisodeIds,
  activeDemucsEpisodeId,
  activeDemucsEpisodeIds,
  completedTtsEpIds,
  completedDemucsEpIds,
  runningPipelineEpIds,
  rescanningEpisodeIds,
  isBatchExecutionActive,
  isEpisodeFullyDone,
  isGeneratingBatchTTS,
  isSeparatingBatchDemucs,
  isRepairBusy,
  isStartingBatch,
  executeBatchTranslateEnqueue,
  handleKillTranslate,
  handleKillTTS,
  handleKillDemucs,
  handleRetryEpisode,
  handleRepairBrokenSegments,
  handleRescanEpisodeGender,
  handleBatchGenerateTTS,
  handleBatchDemucsSeparation,
  openStudioDialog,
  onSwitchEpisode,
  onTabChange,
  onRefreshSeries,
  onClose,
}) {
  const activeJob = jobsByEpisodeId.get(ep.id);
  const hasScript = checkEpisodeHasScript(ep);
  const hasVideo = Boolean(ep.video || ep.videoFile || ep.sourceVideoPath);
  const isSelected = selectedEpIds.has(ep.id);
  const isRunnerTranslateActive = (runnerStates?.translate?.status === 'running' || runnerStates?.repair?.status === 'running' || runnerStates?.all3?.status === 'running') &&
    (runnerStates?.translate?.currentEpId === ep.id || runnerStates?.repair?.currentEpId === ep.id || (runnerStates?.all3?.status === 'running' && runnerStates?.all3?.currentEpId === ep.id));
  const isRunnerTranslateQueued = (runnerStates?.translate?.status === 'running' || runnerStates?.repair?.status === 'running' || runnerStates?.all3?.status === 'running') &&
    ((runnerStates?.translate?.queuedEpIds?.includes(ep.id) || runnerStates?.repair?.queuedEpIds?.includes(ep.id) || runnerStates?.all3?.queuedEpIds?.includes(ep.id)) && !isRunnerTranslateActive);

  const isRunning = Boolean((activeJob && activeJob.status === 'running') || isRunnerTranslateActive);
  const isQueued = Boolean((activeJob && activeJob.status === 'queued') || isRunnerTranslateQueued);
  const isFailed = Boolean(activeJob && activeJob.status === 'failed' && !hasScript);
  const isCancelled = Boolean(activeJob && activeJob.status === 'cancelled');
  const effectiveActiveJob = activeJob || runnerLiveStats?.translate?.[ep.id] || (isRunnerTranslateActive ? {
    jobId: `runner-${ep.id}`,
    episodeId: ep.id,
    status: 'running',
    progress: runnerStates?.translate?.progress || runnerStates?.repair?.progress || 10,
    stageMessage: runnerStates?.translate?.message || runnerStates?.repair?.message || 'កំពុងវិភាគ & បកប្រែ Script...',
    message: runnerStates?.translate?.message || runnerStates?.repair?.message || 'កំពុងវិភាគ & បកប្រែ Script...',
    logs: runnerLiveStats?.translate?.[ep.id]?.logs || [{
      time: new Date().toLocaleTimeString(),
      progress: runnerStates?.translate?.progress || runnerStates?.repair?.progress || 10,
      message: runnerStates?.translate?.message || 'កំពុងវិភាគ & បកប្រែ Script...',
    }],
  } : null);
  const segmentsMissingAfterJob = Boolean(!isRunning && !isQueued && !isFailed && isJobCompletedSegmentsMissing(ep, activeJob));
  const assignedKeyNum = (idx % poolTotalKeys) + 1;
  const keyTheme = KEY_THEMES[((assignedKeyNum - 1) % keyThemeCount) + 1] || KEY_THEMES[1];
  const segmentCount = getEpisodeSegmentCount(ep);
  const { maleCueCount, femaleCueCount } = getEpisodeGenderCounts(ep);
  const isRescanningGender = rescanningEpisodeIds.has(ep.id);
  const epBrokenScan = getEpisodeBrokenSummary(ep);
  const isFullyDone = isEpisodeFullyDone(ep);
  const isAudioReady = checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats);
  const isDemucsReady = checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats);
  const isAutoFitted = Boolean(isAudioReady && checkEpisodeHasAutoFitReady(ep));
  const isAudioOutdated = Boolean(ep.audioOutdated && !isAudioReady);
  const isCompactDone = Boolean(
    ep.scriptData?.autoCompacted ||
    (ep.scriptData?.segments && ep.scriptData.segments.length > 0 && ep.scriptData.segments.every((s) => s.translationStyle === 'compact'))
  );
  const missingAudioCount = epBrokenScan.voiceBrokenCount > 0
    ? epBrokenScan.voiceBrokenCount
    : (isAudioReady ? 0 : (segmentCount || 0));

  const completedStepsCount =
    (hasScript && epBrokenScan.textBrokenCount === 0 ? 1 : 0) +
    (isAudioReady ? 1 : 0) +
    (isAutoFitted ? 1 : 0) +
    (isDemucsReady ? 1 : 0);

  const isCompactStageMode = cardStageView !== 'all';
  const isFocusedStageDone =
    cardStageView === 'translate'
      ? Boolean(hasScript && epBrokenScan.textBrokenCount === 0)
      : cardStageView === 'compact'
        ? isCompactDone
        : cardStageView === 'tts'
          ? Boolean(isAudioReady && !isAudioOutdated)
          : cardStageView === 'autofit'
            ? isAutoFitted
            : cardStageView === 'demucs'
              ? isDemucsReady
              : isFullyDone;

  const borderColor = isRunning
    ? 'var(--primary-accent)'
    : isFailed
      ? 'rgba(239, 68, 68, 0.55)'
      : segmentsMissingAfterJob
        ? 'rgba(245, 158, 11, 0.5)'
        : isSelected
          ? 'var(--primary-accent)'
          : isCompactStageMode
            ? (isFocusedStageDone ? 'rgba(16, 185, 129, 0.45)' : 'var(--border-subtle)')
            : isFullyDone
              ? 'rgba(16, 185, 129, 0.32)'
              : 'var(--border-subtle)';

  const epNum = ep.episodeNumber || idx + 1;
  const cleanTitle = (ep.title || `ភាគទី ${epNum}`)
    .trim()
    .replace(/^ភាគទី\s*(\d+)\s*:\s*(?=ភាគទី\s*\1\b)/i, '');
  const isFastOcr = ep.scriptData?.generationMode === 'fast_ocr' || ep.scriptData?.source?.startsWith('imported_');

  const isRunnerCompact = runnerStates?.compact?.status === 'running';
  const isCurrentCompactRunnerEp = isRunnerCompact && runnerStates?.compact?.currentEpId === ep.id;
  const compactQueue = isRunnerCompact && Array.isArray(runnerStates?.compact?.queuedEpIds)
    ? runnerStates.compact.queuedEpIds
    : [];
  const compactCurIdx = compactQueue.indexOf(runnerStates?.compact?.currentEpId);
  const compactWaitingIds = isRunnerCompact
    ? (compactCurIdx >= 0
      ? compactQueue.slice(compactCurIdx + 1)
      : compactQueue.filter((id) => id !== runnerStates?.compact?.currentEpId))
    : [];
  const compactQueueIdx = !isCurrentCompactRunnerEp ? compactWaitingIds.indexOf(ep.id) : -1;
  const isCompactQueued = compactQueueIdx >= 0;

  const showStage1 = cardStageView === 'all' || cardStageView === 'translate';
  const showStageCompact = cardStageView === 'compact' || isCurrentCompactRunnerEp || isCompactQueued || (cardStageView === 'all' && isCompactDone);
  const showStage2 = cardStageView === 'all' || cardStageView === 'tts';
  const showStage3 = cardStageView === 'all' || cardStageView === 'autofit';
  const showStage4 = cardStageView === 'all' || cardStageView === 'demucs';

  return (
    <div
      key={ep.id}
      data-testid={`ep-card-${ep.id}`}
      data-compact-stage={isCompactStageMode ? cardStageView : undefined}
      onClick={() => hasVideo && !isBatchExecutionActive && !isRunning && !isQueued && toggleSelect(ep.id)}
      style={{
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${borderColor}`,
        background: isSelected
          ? 'var(--bg-active-card)'
          : (isCompactStageMode && isFocusedStageDone)
            ? 'linear-gradient(180deg, rgba(16, 185, 129, 0.06) 0%, var(--bg-primary-panel) 100%)'
            : 'var(--bg-primary-panel)',
        padding: isCompactStageMode ? '9px 10px' : '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: isCompactStageMode ? 7 : 10,
        cursor: isBatchExecutionActive ? 'default' : (hasVideo ? 'pointer' : 'not-allowed'),
        opacity: hasVideo ? 1 : 0.6,
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      }}
    >
      {/* ── Header Row 1: Checkbox + EP Badge + Readable Title + Duration/Key or Compact Status Pill ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
            <input
              type="checkbox"
              checked={isSelected}
              disabled={!hasVideo || isRunning || isQueued || isBatchExecutionActive}
              onChange={() => !isBatchExecutionActive && toggleSelect(ep.id)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 15,
                height: 15,
                margin: 0,
                cursor: (!hasVideo || isRunning || isQueued || isBatchExecutionActive) ? 'not-allowed' : 'pointer',
                accentColor: '#38BDF8',
                flexShrink: 0,
              }}
            />
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              padding: '2px 7px',
              borderRadius: 'var(--radius-xs)',
              background: isRunning
                ? 'var(--primary-accent)'
                : (isCompactStageMode ? isFocusedStageDone : isFullyDone)
                  ? 'rgba(16, 185, 129, 0.16)'
                  : 'var(--bg-elevated-panel)',
              color: isRunning ? '#0A0C10' : (isCompactStageMode ? isFocusedStageDone : isFullyDone) ? '#34D399' : 'var(--text-primary)',
              border: `1px solid ${isRunning ? 'var(--primary-accent)' : (isCompactStageMode ? isFocusedStageDone : isFullyDone) ? 'rgba(16, 185, 129, 0.35)' : 'var(--border-subtle)'}`,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              EP{epNum}
            </span>
            <h2
              style={{
                margin: 0,
                fontSize: isCompactStageMode ? '12.5px' : '13px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              title={cleanTitle}
            >
              {cleanTitle}
            </h2>
          </div>

          {isCompactStageMode ? (
            <span
              data-testid={`ep-stage-status-${ep.id}`}
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: 999,
                background: isFocusedStageDone ? 'rgba(16, 185, 129, 0.16)' : 'rgba(148, 163, 184, 0.12)',
                border: `1px solid ${isFocusedStageDone ? 'rgba(16, 185, 129, 0.42)' : 'rgba(148, 163, 184, 0.25)'}`,
                color: isFocusedStageDone ? '#34D399' : '#94A3B8',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {isFocusedStageDone ? <Check size={10} strokeWidth={3} /> : <Circle size={9} />}
              <span>{isFocusedStageDone ? 'ធ្វើរួច' : 'មិនទាន់'}</span>
            </span>
          ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {ep.duration > 0 && (
              <span style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-dim)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                whiteSpace: 'nowrap',
              }}>
                <Clock size={11} />
                {formatTimecode(ep.duration)}
              </span>
            )}
            <span style={{
              fontSize: '10.5px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 'var(--radius-xs)',
              background: 'var(--bg-secondary-panel)',
              color: keyTheme.color,
              border: '1px solid var(--border-subtle)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: keyTheme.dot }} />
              K{assignedKeyNum}
            </span>
          </div>
          )}
        </div>

        {/* ── Header Row 2: Single-Line Clean Meta Strip (Hidden in Compact Single-Stage View) ── */}
        {!isCompactStageMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 22 }}>
          {isFullyDone && (
            <span style={{
              fontSize: '10.5px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'rgba(16, 185, 129, 0.14)',
              color: '#34D399',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              whiteSpace: 'nowrap',
            }}>
              <Check size={10} strokeWidth={3} />
              <span>រួចរាល់</span>
            </span>
          )}
          {hasScript && epBrokenScan.textBrokenCount > 0 && (
            <span
              data-testid={`ep-broken-badge-${ep.id}`}
              style={{
                fontSize: '10.5px',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.16)',
                color: '#FCA5A5',
                whiteSpace: 'nowrap',
              }}
              title={`អត្ថបទខូច: ${epBrokenScan.textBrokenCount} ឃ្លា`}
            >
              ខូច {epBrokenScan.textBrokenCount} ឃ្លា
            </span>
          )}
          {isFastOcr && (
            <span style={{
              fontSize: '10.5px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'rgba(245, 158, 11, 0.12)',
              color: '#FBBF24',
              whiteSpace: 'nowrap',
            }}>
              Fast OCR
            </span>
          )}
          {(ep.renderedVideo?.videoUrl || ep.renderedVideo?.outputVideoUrl) && (
            <span style={{
              fontSize: '10.5px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'rgba(56, 189, 248, 0.12)',
              color: 'var(--primary-accent)',
              whiteSpace: 'nowrap',
            }}>
              MP4
            </span>
          )}
          {hasScript && segmentCount > 0 && (
            <span
              data-testid={`ep-audio-gender-counts-${ep.id}`}
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{segmentCount} ឃ្លា</span>
              <span>·</span>
              <span data-testid={`ep-male-count-${ep.id}`} style={{ color: '#7DD3FC' }}>ប្រុស {maleCueCount}</span>
              <span>·</span>
              <span data-testid={`ep-female-count-${ep.id}`} style={{ color: '#F472B6' }}>ស្រី {femaleCueCount}</span>
            </span>
          )}
        </div>
        )}
      </div>

      {/* ── Unified 4-Step Pipeline List (Single Bordered Container + Hairline Dividers) ── */}
      <div style={{
        background: 'var(--bg-secondary-panel)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* ── STAGE 1: 📝 1. Translate Script ── */}
        {showStage1 && (
          <div style={{ borderBottom: (showStageCompact || showStage2 || showStage3 || showStage4) ? '1px solid var(--border-subtle)' : 'none' }}>
            {(isRunning || isFailed || isCancelled) ? (
              <div style={{ padding: 6 }}>
                <EpisodeTranslateProgressCard
                  activeJob={effectiveActiveJob}
                  assignedKeyNum={assignedKeyNum}
                  isQueued={false}
                  isFailed={isFailed}
                  isCancelled={isCancelled}
                  onRetry={() => handleRetryEpisode(ep)}
                  onRepair={() => handleRepairBrokenSegments([ep])}
                  onKill={async () => {
                    if (isRunnerTranslateActive) {
                      runnerStopStep(runnerStates?.repair?.status === 'running' ? 'repair' : 'translate');
                    }
                    return await handleKillTranslate(activeJob || ep);
                  }}
                  onRequestConfirm={openStudioDialog}
                />
              </div>
            ) : isQueued ? (
              <div style={{
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={12} color={activeJob?.mode === 'repair_broken' ? '#FBBF24' : 'var(--primary-accent)'} />
                  <span>{activeJob?.mode === 'repair_broken' ? 'ជួសជុល Script — រង់ចាំ Queue' : '1. បកប្រែ Script — រង់ចាំ Queue'}</span>
                </span>
                <span style={{ fontSize: '10.5px', color: 'var(--text-dim)' }}>
                  {activeJob?.mode === 'repair_broken' ? 'ជួសជុល' : 'ម្ដង ១ ភាគ'}
                </span>
              </div>
            ) : segmentsMissingAfterJob ? (
              <div style={{
                padding: '8px 10px',
                background: 'rgba(245, 158, 11, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#FCD34D', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={13} color="#FBBF24" />
                  <span>Segments មិនទាន់ Save (ចុច Refresh)</span>
                </span>
                {typeof onRefreshSeries === 'function' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRefreshSeries();
                    }}
                    style={{
                      ...ROW_ACTION_BTN,
                      background: 'rgba(245, 158, 11, 0.16)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      color: '#FCD34D',
                      cursor: 'pointer',
                    }}
                  >
                    <RefreshCw size={11} />
                    <span>Refresh</span>
                  </button>
                )}
              </div>
            ) : (
              <div style={{
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: '110px', flex: '1 1 110px' }}>
                  {hasScript && epBrokenScan.textBrokenCount === 0 ? (
                    <CheckCircle2 size={14} color="#34D399" style={{ flexShrink: 0 }} />
                  ) : hasScript && epBrokenScan.textBrokenCount > 0 ? (
                    <AlertTriangle size={14} color="#F87171" style={{ flexShrink: 0 }} />
                  ) : (
                    <Circle size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
                      1. បកប្រែ Script
                    </div>
                    <div style={{ fontSize: '11px', color: epBrokenScan.textBrokenCount > 0 ? '#FCA5A5' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {hasScript
                        ? (epBrokenScan.textBrokenCount > 0 ? `ខូច ${epBrokenScan.textBrokenCount} ឃ្លា` : 'បកប្រែរួចរាល់ 100%')
                        : (hasVideo ? 'មិនទាន់មាន Script' : 'មិនទាន់មានវីដេអូ')}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 'auto' }}>
                  {!hasScript ? (
                    <button
                      type="button"
                      disabled={!hasVideo || isStartingBatch}
                      onClick={(e) => {
                        e.stopPropagation();
                        executeBatchTranslateEnqueue([ep], { force: false });
                      }}
                      style={{
                        ...ROW_ACTION_BTN,
                        background: hasVideo ? 'var(--primary-accent)' : 'var(--bg-elevated-panel)',
                        border: 'none',
                        color: hasVideo ? '#0A0C10' : 'var(--text-dim)',
                        cursor: (!hasVideo || isStartingBatch) ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <span>បកប្រែ</span>
                    </button>
                  ) : (
                    <>
                      {epBrokenScan.textBrokenCount > 0 && (
                        <button
                          type="button"
                          disabled={isRepairBusy || isStartingBatch}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRepairBrokenSegments([ep]);
                          }}
                          title="ជួសជុលតែឃ្លាដែលខូច"
                          style={{
                            ...ROW_ACTION_BTN,
                            background: 'rgba(239, 68, 68, 0.14)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#FCA5A5',
                            cursor: isRepairBusy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <Wrench size={11} />
                          <span>ជួសជុល ({epBrokenScan.textBrokenCount})</span>
                        </button>
                      )}
                      {hasScript && segmentCount > 5 && femaleCueCount === 0 && (
                        <button
                          type="button"
                          disabled={isRescanningGender || isBatchExecutionActive}
                          onClick={async (e) => {
                            e.stopPropagation();
                            await handleRescanEpisodeGender(ep);
                          }}
                          title="ស្កេនបែងចែកសំឡេង ប្រុស/ស្រី ឡើងវិញ"
                          style={{
                            ...ROW_ACTION_BTN,
                            background: 'var(--bg-elevated-panel)',
                            border: '1px solid var(--border-subtle)',
                            color: '#F472B6',
                            cursor: isRescanningGender ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isRescanningGender ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                          <span>ស្កេនភេទ</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isStartingBatch}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const confirmed = await openStudioDialog({
                            variant: 'warning',
                            badge: 'RE-TRANSLATE SCRIPT',
                            title: `បញ្ជាក់ការបកប្រែ Script ឡើងវិញ (ភាគ ${epNum})`,
                            message: `តើអ្នកពិតជាចង់បកប្រែ Script ភាគ ${epNum} ឡើងវិញមែនទេ? Script ចាស់ និងសំឡេងដែលបានបង្កើតនឹងត្រូវលុបចេញ ដើម្បីវិភាគវីដេអូ និងបកប្រែថ្មីពីដើម។`,
                            confirmText: 'យល់ព្រមបកប្រែឡើងវិញ',
                            cancelText: 'បោះបង់',
                          });
                          if (confirmed) {
                            executeBatchTranslateEnqueue([ep], { force: true });
                          }
                        }}
                        title="បកប្រែ Script ឡើងវិញ"
                        style={{
                          ...ROW_ACTION_BTN,
                          background: 'var(--bg-elevated-panel)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)',
                          cursor: isStartingBatch ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <RotateCcw size={10} />
                        <span>បកប្រែវិញ</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STAGE COMPACT: ✨ 1.5 ខ្លីចំអត្ថន័យ (Auto Compact) ── */}
        {showStageCompact && (() => {
          const effectiveCompactLiveStats = runnerLiveStats?.compact?.[ep.id] || (isCurrentCompactRunnerEp ? {
            percent: runnerStates?.compact?.progress || 10,
            stageMessage: runnerStates?.compact?.message || 'កំពុងបម្លែង Script ខ្លីចំអត្ថន័យ...',
            logs: [{
              time: new Date().toLocaleTimeString(),
              progress: runnerStates?.compact?.progress || 10,
              message: runnerStates?.compact?.message || 'កំពុងបម្លែង Script ខ្លីចំអត្ថន័យ...',
            }],
          } : null);

          const handleStopCompact = async () => {
            if (isCurrentCompactRunnerEp && typeof runnerStopStep === 'function') {
              await runnerStopStep('compact');
            }
          };

          return (
            <div style={{ borderBottom: (showStage2 || showStage3 || showStage4) ? '1px solid var(--border-subtle)' : 'none' }}>
              {isCurrentCompactRunnerEp ? (
                <div style={{ padding: 6 }}>
                  <EpisodeCompactProgressCard
                    liveStats={effectiveCompactLiveStats}
                    ep={ep}
                    isCurrentRunning={true}
                    onKill={handleStopCompact}
                    onRequestConfirm={openStudioDialog}
                  />
                </div>
              ) : isCompactQueued ? (
                <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={12} color="#C084FC" />
                    <span>✨ ខ្លីចំអត្ថន័យ — រង់ចាំ Queue</span>
                  </span>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-dim)' }}>ម្ដង ១ ភាគ</span>
                </div>
              ) : (
                <div style={{
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    {isCompactDone ? (
                      <CheckCircle2 size={14} color="#34D399" style={{ flexShrink: 0 }} />
                    ) : (
                      <Circle size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        ✨ ខ្លីចំអត្ថន័យ
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isCompactDone
                          ? 'បម្លែងខ្លីចំអត្ថន័យរួចរាល់ 100%'
                          : (hasScript ? 'បង្រួមពាក្យវែងឱ្យខ្លីចំអត្ថន័យ' : 'រង់ចាំ Script ជាមុនសិន')}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <button
                      type="button"
                      disabled={!hasScript || isRunnerCompact}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (runSingleAutoCompact) {
                          runSingleAutoCompact(ep, { force: isCompactDone });
                        }
                      }}
                      style={{
                        ...ROW_ACTION_BTN,
                        background: isCompactDone
                          ? 'var(--bg-elevated-panel)'
                          : 'linear-gradient(135deg, rgba(147, 51, 234, 0.22) 0%, rgba(124, 58, 237, 0.22) 100%)',
                        border: isCompactDone
                          ? '1px solid var(--border-subtle)'
                          : '1px solid rgba(168, 85, 247, 0.55)',
                        color: isCompactDone ? 'var(--text-secondary)' : '#E9D5FF',
                        opacity: (!hasScript || isRunnerCompact) ? 0.45 : 1,
                        cursor: (!hasScript || isRunnerCompact) ? 'not-allowed' : 'pointer',
                      }}
                      title={isCompactDone ? 'បម្លែង Script ខ្លីចំអត្ថន័យឡើងវិញ' : 'បម្លែង Script ខ្លីចំអត្ថន័យ'}
                    >
                      {isCompactDone ? <RotateCcw size={10} /> : <Sparkles size={10} color="#C084FC" />}
                      <span>{isCompactDone ? 'បម្លែងវិញ' : 'បម្លែង'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── STAGE 2: 🎙️ 2. AI Translate Voice ── */}
        {showStage2 && (() => {
          const isRunnerVoice = runnerStates?.voice?.status === 'running';
          const isRunnerAll3 = runnerStates?.all3?.status === 'running';
          const isCurrentVoiceRunnerEp = (isRunnerVoice && runnerStates?.voice?.currentEpId === ep.id) ||
            (isRunnerAll3 && runnerStates?.all3?.currentEpId === ep.id);
          const isQueuedVoiceRunnerEp = (isRunnerVoice && runnerStates?.voice?.queuedEpIds?.includes(ep.id) && !isCurrentVoiceRunnerEp) ||
            (isRunnerAll3 && runnerStates?.all3?.queuedEpIds?.includes(ep.id) && !isCurrentVoiceRunnerEp);

          const isCurrentRunning = (isGeneratingBatchTTS && activeTtsEpisodeId === ep.id) || isCurrentVoiceRunnerEp;
          const isTtsQueued = (isGeneratingBatchTTS && activeTtsEpisodeIds.has(ep.id) && activeTtsEpisodeId !== ep.id) || isQueuedVoiceRunnerEp;

          const effectiveLiveStats = ttsLiveStats[ep.id] || runnerLiveStats?.tts?.[ep.id] || (isCurrentRunning ? {
            percent: runnerStates?.voice?.progress || 15,
            message: runnerStates?.voice?.message || 'កំពុងបង្កើតសំឡេងខ្មែរ AI...',
            logs: [{
              time: new Date().toLocaleTimeString(),
              progress: runnerStates?.voice?.progress || 15,
              message: runnerStates?.voice?.message || 'កំពុងបង្កើតសំឡេងខ្មែរ AI...',
            }],
          } : null);

          const handleStopOrKillTTS = async (targetEp) => {
            if (isCurrentVoiceRunnerEp) {
              await runnerStopStep(isRunnerAll3 ? 'all3' : 'voice');
            }
            await handleKillTTS(targetEp);
          };

          return (
            <div style={{ borderBottom: (showStage3 || showStage4) ? '1px solid var(--border-subtle)' : 'none' }}>
              {isCurrentRunning ? (
                <div style={{ padding: 6 }}>
                  <EpisodeTtsProgressCard
                    liveStats={effectiveLiveStats}
                    ep={ep}
                    onKill={handleStopOrKillTTS}
                    onRequestConfirm={openStudioDialog}
                  />
                </div>
              ) : isTtsQueued ? (
                <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={12} color="var(--primary-accent)" />
                    <span>2. សំឡេងខ្មែរ AI — រង់ចាំ Queue</span>
                  </span>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-dim)' }}>ម្ដង ១ ភាគ</span>
                </div>
              ) : (
                <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    {isAudioReady && !isAudioOutdated ? (
                      <CheckCircle2 size={14} color="#34D399" style={{ flexShrink: 0 }} />
                    ) : isAudioOutdated ? (
                      <AlertTriangle size={14} color="#FBBF24" style={{ flexShrink: 0 }} />
                    ) : (
                      <Circle size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        2. សំឡេងខ្មែរ AI
                      </div>
                      <div style={{ fontSize: '11px', color: isAudioOutdated ? '#FBBF24' : 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isAudioReady
                          ? (isAudioOutdated ? 'សំឡេងចាស់ — គួរបង្កើតវិញ' : `រួចរាល់ (${segmentCount || '100%'} ឃ្លា)`)
                          : (hasScript ? `នៅខ្វះ ${missingAudioCount} ឃ្លា` : 'រង់ចាំ Script ជាមុនសិន')}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    {!isAudioReady ? (
                      <button
                        type="button"
                        disabled={!hasScript || isGeneratingBatchTTS}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBatchGenerateTTS([ep]);
                        }}
                        style={{
                          ...ROW_ACTION_BTN,
                          background: hasScript ? 'var(--primary-accent)' : 'var(--bg-elevated-panel)',
                          border: 'none',
                          color: hasScript ? '#0A0C10' : 'var(--text-dim)',
                          cursor: (!hasScript || isGeneratingBatchTTS) ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <span>បង្កើតសំឡេង</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isGeneratingBatchTTS}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const confirmed = await openStudioDialog({
                            variant: 'warning',
                            badge: 'RE-GENERATE VOICE',
                            title: `បញ្ជាក់ការបង្កើតសំឡេងឡើងវិញ (ភាគ ${epNum})`,
                            message: `តើអ្នកពិតជាចង់បង្កើតសំឡេងភាគ ${epNum} ឡើងវិញមែនទេ? សំឡេងចាស់នឹងត្រូវលុបចេញ ដើម្បីបង្កើតសំឡេងថ្មី ដោយរក្សាទុក Script ដដែល។`,
                            confirmText: 'យល់ព្រមបង្កើតសំឡេងឡើងវិញ',
                            cancelText: 'បោះបង់',
                          });
                          if (confirmed) {
                            handleBatchGenerateTTS([ep], { force: true });
                          }
                        }}
                        title="បង្កើតសំឡេងឡើងវិញ"
                        style={{
                          ...ROW_ACTION_BTN,
                          background: 'var(--bg-elevated-panel)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)',
                          cursor: isGeneratingBatchTTS ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <RotateCcw size={10} />
                        <span>បង្កើតវិញ</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── STAGE 3: ⚡ 3. Auto-Fit Speed (WSOLA + Atempo Fit Subtitles) ── */}
        {showStage3 && (() => {
          const isRunnerAutoFit = runnerStates?.autofit?.status === 'running';
          const isCurrentAutoFitRunnerEp = isRunnerAutoFit && runnerStates?.autofit?.currentEpId === ep.id;
          const isAutoFitQueued = isRunnerAutoFit && runnerStates?.autofit?.queuedEpIds?.includes(ep.id) && !isCurrentAutoFitRunnerEp;

          const effectiveLiveStats = runnerLiveStats?.autofit?.[ep.id] || (isCurrentAutoFitRunnerEp ? {
            percent: runnerStates?.autofit?.progress || 10,
            message: runnerStates?.autofit?.message || 'កំពុង Auto-Fit Speed...',
            logs: [{
              time: new Date().toLocaleTimeString(),
              progress: runnerStates?.autofit?.progress || 10,
              message: runnerStates?.autofit?.message || 'កំពុង Auto-Fit Speed...',
            }],
          } : null);

          const handleStopAutoFit = async () => {
            if (isCurrentAutoFitRunnerEp) {
              await runnerStopStep('autofit');
            }
          };

          const storedSegs = Array.isArray(ep.scriptData?.segments) ? ep.scriptData.segments : [];
          let measuredFitCount = 0;
          let fittedSegCount = 0;
          for (const seg of storedSegs) {
            const sStart = Number(seg?.startSec);
            const sEnd = Number(seg?.endSec);
            const slotDur = (Number.isFinite(sStart) && Number.isFinite(sEnd) && sEnd > sStart)
              ? (sEnd - sStart)
              : Number(seg?.slotDuration || seg?.availableSlotDuration || seg?.duration || 0);
            const audioDur = Number(
              seg?.audioDurationSec
              ?? seg?.finalAudioDuration
              ?? seg?.audioDuration
              ?? ((Number.isFinite(Number(seg?.audioStartSec)) && Number.isFinite(Number(seg?.audioEndSec)))
                ? (Number(seg.audioEndSec) - Number(seg.audioStartSec))
                : 0)
            );
            if (slotDur > 0 && audioDur > 0) {
              measuredFitCount++;
              if ((audioDur - slotDur) < 0.10 && !seg?.audioTrimmed) {
                fittedSegCount++;
              }
            }
          }
          const storedFitPctText = measuredFitCount > 0
            ? `${((fittedSegCount / measuredFitCount) * 100).toFixed(1)}%`
            : null;

          return (
            <div style={{ borderBottom: showStage4 ? '1px solid var(--border-subtle)' : 'none' }}>
              {isCurrentAutoFitRunnerEp ? (
                <div style={{ padding: 6 }}>
                  <EpisodeAutoFitProgressCard
                    liveStats={effectiveLiveStats}
                    ep={ep}
                    isCurrentRunning={true}
                    onKill={handleStopAutoFit}
                    onRequestConfirm={openStudioDialog}
                  />
                </div>
              ) : isAutoFitQueued ? (
                <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={12} color="#FBBF24" />
                    <span>3. Auto-Fit Speed — រង់ចាំ Queue</span>
                  </span>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-dim)' }}>ម្ដង ១ ភាគ</span>
                </div>
              ) : (
                <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    {isAutoFitted ? (
                      <CheckCircle2 size={14} color="#34D399" style={{ flexShrink: 0 }} />
                    ) : (
                      <Circle size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        3. Auto-Fit Speed
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isAutoFitted
                          ? (storedFitPctText ? `Fit ស្មើ Subtitle ${storedFitPctText}` : 'Fit ស្មើ Subtitle រួចរាល់')
                          : (isAudioReady ? 'ពន្លឿនឃ្លាលើសឱ្យ Fit Subtitle' : 'រង់ចាំសំឡេង AI ជាមុនសិន')}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!isAudioReady || isRunnerAutoFit}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (runSingleAutoFitSpeed) {
                        runSingleAutoFitSpeed(ep);
                      }
                    }}
                    style={{
                      ...ROW_ACTION_BTN,
                      background: isAutoFitted ? 'var(--bg-elevated-panel)' : 'rgba(245, 158, 11, 0.14)',
                      border: isAutoFitted ? '1px solid var(--border-subtle)' : '1px solid rgba(245, 158, 11, 0.4)',
                      color: isAutoFitted ? 'var(--text-secondary)' : '#FBBF24',
                      opacity: (!isAudioReady || isRunnerAutoFit) ? 0.45 : 1,
                      cursor: (!isAudioReady || isRunnerAutoFit) ? 'not-allowed' : 'pointer',
                    }}
                    title={isAutoFitted ? 'ពន្លឿន Auto-Fit Speed ឡើងវិញ' : 'ពន្លឿន Auto-Fit Speed'}
                  >
                    {isAutoFitted ? <RotateCcw size={10} /> : <Zap size={10} />}
                    <span>{isAutoFitted ? 'ធ្វើវិញ' : 'Auto-Fit'}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── STAGE 4: 🔇 4. AI បិទសំឡេងចិន (រក្សាភ្លេង BGM ដើម) ── */}
        {showStage4 && (() => {
          const isRunnerCleanBgm = runnerStates?.clean_bgm?.status === 'running';
          const isRunnerAll3 = runnerStates?.all3?.status === 'running';
          const isCurrentDemucsRunnerEp = (isRunnerCleanBgm && runnerStates?.clean_bgm?.currentEpId === ep.id) ||
            (isRunnerAll3 && runnerStates?.all3?.currentEpId === ep.id);

          const isCurrentRunning = (isSeparatingBatchDemucs && activeDemucsEpisodeId === ep.id) || isCurrentDemucsRunnerEp;

          const localWaitingIds = isSeparatingBatchDemucs
            ? Array.from(activeDemucsEpisodeIds).filter((id) => id !== activeDemucsEpisodeId)
            : [];
          const cleanBgmQueue = isRunnerCleanBgm && Array.isArray(runnerStates?.clean_bgm?.queuedEpIds)
            ? runnerStates.clean_bgm.queuedEpIds
            : [];
          const cleanBgmCurIdx = cleanBgmQueue.indexOf(runnerStates?.clean_bgm?.currentEpId);
          const runnerCleanBgmWaitingIds = isRunnerCleanBgm
            ? (cleanBgmCurIdx >= 0
              ? cleanBgmQueue.slice(cleanBgmCurIdx + 1)
              : cleanBgmQueue.filter((id) => id !== runnerStates?.clean_bgm?.currentEpId))
            : [];
          const all3Queue = isRunnerAll3 && Array.isArray(runnerStates?.all3?.queuedEpIds)
            ? runnerStates.all3.queuedEpIds
            : [];
          const all3CurIdx = all3Queue.indexOf(runnerStates?.all3?.currentEpId);
          const runnerAll3WaitingIds = isRunnerAll3
            ? (all3CurIdx >= 0
              ? all3Queue.slice(all3CurIdx + 1)
              : all3Queue.filter((id) => id !== runnerStates?.all3?.currentEpId))
            : [];

          const activeDemucsWaitingIds = localWaitingIds.length > 0
            ? localWaitingIds
            : (runnerCleanBgmWaitingIds.length > 0 ? runnerCleanBgmWaitingIds : runnerAll3WaitingIds);
          const demucsQueueIdx = !isCurrentRunning ? activeDemucsWaitingIds.indexOf(ep.id) : -1;
          const isDemucsQueued = demucsQueueIdx >= 0;
          const demucsQueuePos = demucsQueueIdx + 1;
          const demucsQueueTotal = activeDemucsWaitingIds.length;

          const effectiveLiveStats = demucsLiveStats[ep.id] || runnerLiveStats?.demucs?.[ep.id] || (isCurrentRunning ? {
            percent: runnerStates?.clean_bgm?.progress || 5,
            message: runnerStates?.clean_bgm?.message || 'កំពុងបំបែកភ្លេង Demucs...',
            logs: [{
              time: new Date().toLocaleTimeString(),
              progress: runnerStates?.clean_bgm?.progress || 5,
              message: runnerStates?.clean_bgm?.message || `Demucs Progress: ${runnerStates?.clean_bgm?.progress || 5}%`,
            }],
            model: 'htdemucs',
          } : null);

          const handleStopOrKillDemucs = async (targetEp) => {
            if (isCurrentDemucsRunnerEp) {
              await runnerStopStep(isRunnerAll3 ? 'all3' : 'clean_bgm');
            }
            await handleKillDemucs(targetEp);
          };

          if (isCurrentRunning) {
            return (
              <div style={{ padding: 6 }}>
                <EpisodeDemucsProgressCard
                  liveStats={effectiveLiveStats}
                  ep={ep}
                  isCurrentRunning={true}
                  onKill={handleStopOrKillDemucs}
                  onRequestConfirm={openStudioDialog}
                />
              </div>
            );
          }

          if (isDemucsQueued) {
            return (
              <div
                data-testid={`demucs-queued-row-${ep.id}`}
                style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
              >
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  <Clock size={12} color="var(--primary-accent)" style={{ flexShrink: 0 }} />
                  <span>4. បំបែកភ្លេង BGM</span>
                </span>
                <span
                  data-testid={`demucs-queue-pos-${ep.id}`}
                  style={{ fontSize: '11px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--primary-accent)', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  Queue {demucsQueuePos}/{demucsQueueTotal}
                </span>
              </div>
            );
          }

          return (
            <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                {isDemucsReady ? (
                  <CheckCircle2 size={14} color="#34D399" style={{ flexShrink: 0 }} />
                ) : (
                  <Circle size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                    4. បំបែកភ្លេង BGM
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isDemucsReady
                      ? 'បិទសំឡេងចិន · រក្សាភ្លេង BGM ដើម'
                      : (hasVideo ? 'មិនទាន់បំបែក (នៅមានសំឡេងចិន)' : 'មិនទាន់មានវីដេអូ')}
                  </div>
                </div>
              </div>

              {!isDemucsReady ? (
                <button
                  type="button"
                  disabled={!hasVideo || isSeparatingBatchDemucs}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleBatchDemucsSeparation([ep]);
                  }}
                  style={{
                    ...ROW_ACTION_BTN,
                    background: hasVideo ? 'rgba(16, 185, 129, 0.16)' : 'var(--bg-elevated-panel)',
                    border: hasVideo ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-subtle)',
                    color: hasVideo ? '#34D399' : 'var(--text-dim)',
                    cursor: (!hasVideo || isSeparatingBatchDemucs) ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Volume2 size={11} />
                  <span>បំបែក BGM</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSeparatingBatchDemucs}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleBatchDemucsSeparation([ep], { force: true });
                  }}
                  title="បំបែកភ្លេង BGM ឡើងវិញ"
                  style={{
                    ...ROW_ACTION_BTN,
                    background: 'var(--bg-elevated-panel)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    cursor: isSeparatingBatchDemucs ? 'not-allowed' : 'pointer',
                  }}
                >
                  <RotateCcw size={10} />
                  <span>ធ្វើវិញ</span>
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Clean Compact Card Footer (Zero Dead Gap / Matching Border Radius) ── */}
      {!isRunning && !isQueued && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingTop: 2,
        }}>
          <div style={{ fontSize: '11.5px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(isGeneratingBatchTTS && activeTtsEpisodeId === ep.id) ? (
              <span style={{ color: 'var(--primary-accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Loader2 size={11} className="animate-spin" />
                <span>កំពុងបង្កើតសំឡេង ({ttsLiveStats[ep.id]?.current || 0}/{ttsLiveStats[ep.id]?.total || segmentCount || '...'})</span>
              </span>
            ) : (isGeneratingBatchTTS && activeTtsEpisodeIds.has(ep.id)) ? (
              <span style={{ color: '#FBBF24', fontWeight: 600 }}>⏳ រង់ចាំក្នុង Queue</span>
            ) : (isSeparatingBatchDemucs && activeDemucsEpisodeId === ep.id) ? (
              <span style={{ color: 'var(--primary-accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Loader2 size={11} className="animate-spin" />
                <span>កំពុងបំបែក BGM ({demucsLiveStats[ep.id]?.percent || 0}%)</span>
              </span>
            ) : (isSeparatingBatchDemucs && activeDemucsEpisodeIds.has(ep.id)) ? (
              <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>រង់ចាំ BGM Queue</span>
            ) : (runningPipelineEpIds && runningPipelineEpIds.has(ep.id)) ? (
              <span style={{ color: 'var(--primary-accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Loader2 size={11} className="animate-spin" />
                <span>កំពុងដំណើរការ Auto-Pipeline...</span>
              </span>
            ) : segmentsMissingAfterJob ? (
              <span style={{ color: '#FBBF24', fontWeight: 600 }}>Segments មិនទាន់ Save</span>
            ) : isFailed ? (
              <span style={{ color: '#FCA5A5', fontWeight: 600 }}>បរាជ័យ — សូម Retry</span>
            ) : isCompactStageMode ? (
              <span style={{
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
                fontSize: '10.5px',
              }}>
                {hasScript && segmentCount > 0 ? `${segmentCount} ឃ្លា` : `K${assignedKeyNum}`}
              </span>
            ) : (
              <span style={{
                color: completedStepsCount === 4 ? '#34D399' : 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
              }}>
                {completedStepsCount}/4 ជំហានរួចរាល់
              </span>
            )}
          </div>

          {hasScript && onSwitchEpisode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSwitchEpisode(ep.id);
                if (onTabChange) onTabChange('subtitles');
                onClose();
              }}
              style={{
                height: isCompactStageMode ? 24 : 28,
                padding: isCompactStageMode ? '0 8px' : '0 10px',
                borderRadius: 6,
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: 'var(--primary-accent)',
                fontSize: isCompactStageMode ? '11px' : '11.5px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span>{isCompactStageMode ? 'Studio' : 'បើកក្នុង Studio'}</span>
              <ArrowRight size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(BatchEpisodeCard);
