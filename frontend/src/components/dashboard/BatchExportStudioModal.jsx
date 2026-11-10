import React, { useMemo, useEffect } from 'react';
import {
  Film, Layers, Download, Loader2, CheckCircle2, AlertTriangle, AlertCircle,
  Square, X, Check, Clock
} from 'lucide-react';
import { resolveDefaultAspectRatio } from '../../utils/projectStorage';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  getEpisodeBrokenSummary,
} from './geminiRouteHelpers';

function checkEpHasVideo(ep) {
  return Boolean(
    ep?.sourceVideoPath ||
    ep?.video?.videoPath ||
    ep?.video?.videoId ||
    ep?.videoFile ||
    ep?.video?.videoUrl
  );
}

export default function BatchExportStudioModal({
  isOpen,
  onClose,
  activeSeries = null,
  activeEpisode = null,
  episodeId = null,
  voiceSettings = {},
  currentAspectRatio = null,
  onAspectRatioChange = null,
  isRendering = false,
  batchRender = null,
  audioGenerated = false,
  previewAudioUrl = null,
  selectedEpIds = [],
  onChangeSelectedEpIds = null,
  allowOriginalAudio = false,
  onChangeAllowOriginalAudio = null,
}) {
  const seriesEpisodes = useMemo(() => {
    const list = Array.isArray(activeSeries?.episodes) ? [...activeSeries.episodes] : [];
    return list.sort((a, b) => (Number(a.episodeNumber) || 0) - (Number(b.episodeNumber) || 0));
  }, [activeSeries]);

  const episodeReadinessList = useMemo(() => {
    return seriesEpisodes.map((ep, idx) => {
      const epNum = ep.episodeNumber || idx + 1;
      const hasVideo = checkEpHasVideo(ep);
      const hasScript = checkEpisodeHasScript(ep);
      const brokenSummary = getEpisodeBrokenSummary(ep);
      const isCurrentEp = Boolean(episodeId && String(ep.id) === String(episodeId));
      const hasActiveLocalVoice = Boolean(
        isCurrentEp &&
        !ep.audioOutdated &&
        !activeEpisode?.audioOutdated &&
        (audioGenerated || previewAudioUrl) &&
        brokenSummary.totalBrokenCount === 0
      );
      const hasVoice = Boolean(checkEpisodeHasAudioReady(ep) || hasActiveLocalVoice);
      const hasDemucs = Boolean(checkEpisodeHasDemucsReady(ep));

      let notReadyReason = null;
      if (!hasVideo) {
        notReadyReason = 'គ្មានវីដេអូដើម (No Video)';
      } else if (!hasScript) {
        notReadyReason = 'មិនទាន់មាន Script (No Script)';
      } else if (!hasVoice) {
        if (ep.audioOutdated) {
          notReadyReason = 'សំឡេងហួសសម័យ (Audio Outdated)';
        } else if (brokenSummary.totalBrokenCount > 0) {
          notReadyReason = `នៅខ្វះ/ខូច ${brokenSummary.totalBrokenCount} ឃ្លា`;
        } else {
          notReadyReason = 'មិនទាន់មានសំឡេងខ្មែរ (No Voice)';
        }
      }

      return {
        ep,
        epNum,
        title: ep.displayTitle || ep.title || `ភាគទី ${epNum} (EP${epNum})`,
        hasVideo,
        hasScript,
        hasVoice,
        hasDemucs,
        isReady: hasVideo && hasScript && hasVoice,
        notReadyReason,
      };
    });
  }, [seriesEpisodes, episodeId, activeEpisode?.audioOutdated, audioGenerated, previewAudioUrl]);

  const episodesWithVideo = useMemo(
    () => episodeReadinessList.filter((item) => item.hasVideo),
    [episodeReadinessList]
  );

  const selectedSet = useMemo(
    () => new Set((Array.isArray(selectedEpIds) ? selectedEpIds : []).map((id) => String(id))),
    [selectedEpIds]
  );

  const selectedItems = useMemo(
    () => episodesWithVideo.filter((item) => selectedSet.has(String(item.ep.id))),
    [episodesWithVideo, selectedSet]
  );

  const selectedVoicedItems = useMemo(
    () => selectedItems.filter((item) => item.hasVoice),
    [selectedItems]
  );

  const selectedMissingVoiceItems = useMemo(
    () => selectedItems.filter((item) => !item.hasVoice),
    [selectedItems]
  );

  const eligibleItems = allowOriginalAudio ? selectedItems : selectedVoicedItems;

  const batchJob = batchRender?.job || null;
  const isBatchRunning = Boolean(batchRender?.isRunning || batchJob?.status === 'running');
  const isBatchStarting = Boolean(batchRender?.isStarting);
  const batchError = batchRender?.error || null;

  // Shared aspect ratio resolution (identical to Navbar & Step 4)
  const firstSelectedWithVideo = selectedItems[0]?.ep || activeEpisode || null;
  const srcW = Number(firstSelectedWithVideo?.metadata?.width || firstSelectedWithVideo?.video?.width) || 0;
  const srcH = Number(firstSelectedWithVideo?.metadata?.height || firstSelectedWithVideo?.video?.height) || 0;
  const resolvedAspectRatio =
    currentAspectRatio ||
    voiceSettings?.aspectRatio ||
    resolveDefaultAspectRatio(srcW, srcH) ||
    '16:9';
  const effectiveVerticalStyle = voiceSettings?.verticalStyle || 'pad';

  // Escape key closes Export Studio modal cleanly
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  // Per-episode live job progress map (completed outputs, current running episode, queued, skipped)
  const perEpisodeJobProgress = useMemo(() => {
    if (!batchJob) return [];
    const outputsByEpId = new Map();
    if (Array.isArray(batchJob.outputs)) {
      for (const out of batchJob.outputs) {
        if (out?.episodeId) outputsByEpId.set(String(out.episodeId), out);
      }
    }
    const skippedByEpId = new Map();
    if (Array.isArray(batchJob.skippedEpisodes)) {
      for (const sk of batchJob.skippedEpisodes) {
        if (sk?.episodeId) skippedByEpId.set(String(sk.episodeId), sk);
      }
    }

    // Determine the set of episodes involved in this job
    const rows = [];
    for (const item of episodeReadinessList) {
      const idStr = String(item.ep.id);
      const out = outputsByEpId.get(idStr);
      const skip = skippedByEpId.get(idStr);
      const isCurrent =
        batchJob.status === 'running' &&
        batchJob.currentEpisodeId &&
        String(batchJob.currentEpisodeId) === idStr;

      if (out) {
        rows.push({
          episodeId: item.ep.id,
          epNum: item.epNum,
          title: item.title,
          state: 'completed',
          label: 'រួចរាល់ ✓',
          output: out,
        });
      } else if (isCurrent) {
        rows.push({
          episodeId: item.ep.id,
          epNum: item.epNum,
          title: item.title,
          state: 'running',
          label: `កំពុង Render (${batchJob.currentIndex || 1}/${batchJob.totalCount || 1})...`,
        });
      } else if (skip) {
        rows.push({
          episodeId: item.ep.id,
          epNum: item.epNum,
          title: item.title,
          state: 'skipped',
          label: `រំលង (${skip.reason || 'Skipped'})`,
        });
      } else if (selectedSet.has(idStr) && batchJob.status === 'running') {
        rows.push({
          episodeId: item.ep.id,
          epNum: item.epNum,
          title: item.title,
          state: 'queued',
          label: 'រង់ចាំក្នុងជួរ (Queued)',
        });
      }
    }
    return rows;
  }, [batchJob, episodeReadinessList, selectedSet]);

  if (!isOpen) return null;

  const toggleEpisode = (id) => {
    if (isBatchRunning || !onChangeSelectedEpIds) return;
    const strId = String(id);
    onChangeSelectedEpIds((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      return arr.some((item) => String(item) === strId)
        ? arr.filter((item) => String(item) !== strId)
        : [...arr, id];
    });
  };

  const handleStartAction = (mode) => {
    if (!batchRender?.start || eligibleItems.length === 0 || isBatchRunning || isBatchStarting) return;
    batchRender.start({
      episodeIds: selectedItems.map((item) => item.ep.id),
      mode,
      allowOriginalAudio: Boolean(allowOriginalAudio),
    });
  };

  const hasFinishedFiles = Boolean(
    batchJob &&
    (batchJob.mergedResult?.downloadUrl ||
      (Array.isArray(batchJob.outputs) && batchJob.outputs.length > 0))
  );

  return (
    <div
      data-testid="batch-export-studio-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Export Studio — Batch Export & Merge"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100005,
        background: 'rgba(2, 6, 23, 0.86)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 1120,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 16,
          background: 'linear-gradient(180deg, #0b1222 0%, #0f172a 100%)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65)',
          overflow: 'hidden',
        }}
      >
        {/* ── Modal Header ── */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.25), rgba(37, 99, 235, 0.35))',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Film size={18} color="#38BDF8" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 900, color: '#F8FAFC', letterSpacing: '0.01em' }}>
                  Export Studio — Batch Export &amp; Merge
                </h2>
                {activeSeries?.title && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 9999,
                      background: 'rgba(56, 189, 248, 0.14)',
                      border: '1px solid rgba(56, 189, 248, 0.32)',
                      color: '#7DD3FC',
                      maxWidth: 320,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {activeSeries.title}
                  </span>
                )}
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.72rem', color: '#94A3B8' }}>
                ជ្រើសរើសភាគ ពិនិត្យភាពរួចរាល់ (Script / Voice / Demucs) រួច Export បញ្ចូលគ្នា ឬ Export ដាច់ដោយឡែក
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="close-export-studio-btn"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              color: '#E2E8F0',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <X size={14} />
            <span>បិទផ្ទាំង (Close)</span>
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px 22px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* ── (a) Episode Multi-Select Grid with Readiness States ── */}
          <section
            style={{
              background: 'rgba(15, 23, 42, 0.72)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: 12,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#F8FAFC' }}>
                  ១. ជ្រើសរើសភាគសម្រាប់ Export ({selectedItems.length}/{episodesWithVideo.length} ភាគ)
                </span>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(52, 211, 153, 0.35)',
                    color: '#34D399',
                  }}
                >
                  មានសំឡេងខ្មែររួច: {selectedVoicedItems.length} ភាគ
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="export-studio-select-all"
                  disabled={isBatchRunning || episodesWithVideo.length === 0}
                  onClick={() => onChangeSelectedEpIds?.(episodesWithVideo.map((item) => item.ep.id))}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: 'rgba(56, 189, 248, 0.16)',
                    border: '1px solid rgba(56, 189, 248, 0.38)',
                    color: '#38BDF8',
                    fontSize: '0.71rem',
                    fontWeight: 700,
                    cursor: isBatchRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  Select All ({episodesWithVideo.length})
                </button>
                <button
                  type="button"
                  data-testid="export-studio-select-voiced"
                  disabled={isBatchRunning}
                  onClick={() => onChangeSelectedEpIds?.(episodesWithVideo.filter((item) => item.hasVoice).map((item) => item.ep.id))}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.38)',
                    color: '#34D399',
                    fontSize: '0.71rem',
                    fontWeight: 700,
                    cursor: isBatchRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  មាន Voice ({episodesWithVideo.filter((item) => item.hasVoice).length})
                </button>
                <button
                  type="button"
                  data-testid="export-studio-clear-all"
                  disabled={isBatchRunning || selectedItems.length === 0}
                  onClick={() => onChangeSelectedEpIds?.([])}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.14)',
                    color: '#CBD5E1',
                    fontSize: '0.71rem',
                    fontWeight: 700,
                    cursor: isBatchRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            {episodeReadinessList.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: '0.76rem', color: '#94A3B8' }}>
                មិនទាន់មានភាគនៅក្នុង Series នេះទេ។
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))',
                  gap: 8,
                  maxHeight: 270,
                  overflowY: 'auto',
                  paddingRight: 2,
                }}
              >
                {episodeReadinessList.map((item) => {
                  const { ep, epNum, title, hasVideo, hasScript, hasVoice, hasDemucs, isReady, notReadyReason } = item;
                  const isChecked = selectedSet.has(String(ep.id));
                  return (
                    <label
                      key={ep.id}
                      data-testid={`export-studio-ep-card-${ep.id}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '9px 10px',
                        borderRadius: 9,
                        cursor: !hasVideo || isBatchRunning ? 'not-allowed' : 'pointer',
                        opacity: hasVideo ? 1 : 0.52,
                        background: isChecked
                          ? (isReady ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)')
                          : 'rgba(2, 6, 23, 0.55)',
                        border: isChecked
                          ? (isReady ? '1px solid rgba(52, 211, 153, 0.45)' : '1px solid rgba(251, 191, 36, 0.48)')
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        userSelect: 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!hasVideo || isBatchRunning}
                          onChange={() => toggleEpisode(ep.id)}
                          style={{ margin: 0, accentColor: isReady ? '#10B981' : '#F59E0B', cursor: 'inherit' }}
                        />
                        <span
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 800,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'rgba(56, 189, 248, 0.16)',
                            color: '#38BDF8',
                            flexShrink: 0,
                          }}
                        >
                          EP{epNum}
                        </span>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: '#F8FAFC',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={title}
                        >
                          {title}
                        </span>
                      </div>

                      {/* Readiness Badges: Script ✓/✗, Voice ✓/✗, Demucs ✓/✗ */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: hasScript ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)',
                            color: hasScript ? '#6EE7B7' : '#FCA5A5',
                            border: hasScript ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(248, 113, 113, 0.3)',
                          }}
                        >
                          Script {hasScript ? '✓' : '✗'}
                        </span>
                        <span
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: hasVoice ? 'rgba(16, 185, 129, 0.16)' : 'rgba(245, 158, 11, 0.16)',
                            color: hasVoice ? '#6EE7B7' : '#FCD34D',
                            border: hasVoice ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(251, 191, 36, 0.32)',
                          }}
                        >
                          Voice {hasVoice ? '✓' : '✗'}
                        </span>
                        <span
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: hasDemucs ? 'rgba(56, 189, 248, 0.16)' : 'rgba(148, 163, 184, 0.1)',
                            color: hasDemucs ? '#7DD3FC' : '#94A3B8',
                            border: hasDemucs ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(148, 163, 184, 0.2)',
                          }}
                        >
                          Demucs {hasDemucs ? '✓' : '✗'}
                        </span>
                      </div>

                      {/* Not-Ready Reason Flag */}
                      {notReadyReason && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            color: !hasVideo ? '#FCA5A5' : '#FBBF24',
                          }}
                        >
                          <AlertTriangle size={11} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {notReadyReason}
                          </span>
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            {/* Missing Voice Warning Banner (Identical readiness check) */}
            {selectedMissingVoiceItems.length > 0 && (
              <div
                data-testid="export-studio-missing-voice-warning"
                style={{
                  background: allowOriginalAudio ? 'rgba(56, 189, 248, 0.1)' : 'rgba(245, 158, 11, 0.12)',
                  border: allowOriginalAudio ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(245, 158, 11, 0.4)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: '0.72rem',
                  color: allowOriginalAudio ? '#BAE6FD' : '#FDE68A',
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, color: allowOriginalAudio ? '#38BDF8' : '#FBBF24' }} />
                <span>
                  {allowOriginalAudio
                    ? `ភាគអត់ Voice (${selectedMissingVoiceItems.map((i) => `EP${i.epNum}`).join(', ')}) នឹង Export ដោយប្រើសំឡេងដើម។`
                    : `ភាគ ${selectedMissingVoiceItems.map((i) => `EP${i.epNum}`).join(', ')} មិនទាន់មានសំឡេងខ្មែរ — នឹងត្រូវរំលងពេល Export!`}
                </span>
              </div>
            )}
          </section>

          {/* ── (b) Shared Aspect Indicator + Sticky 16:9 | 9:16 Toggle & (c) Allow Original Audio ── */}
          <section
            style={{
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: 12,
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#CBD5E1' }}>
                  ទម្រង់វីដេអូ (Shared Aspect):
                </span>
                <span
                  data-testid="export-studio-aspect-indicator"
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: 'rgba(56, 189, 248, 0.16)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    color: '#38BDF8',
                    fontFamily: 'monospace',
                  }}
                >
                  {resolvedAspectRatio === '9:16'
                    ? `9:16 Portrait (${effectiveVerticalStyle === 'crop' ? 'Crop' : 'Pad'})`
                    : '16:9 Landscape'}
                </span>
              </div>

              {/* Sticky 16:9 | 9:16 Shared Toggle */}
              <div
                role="group"
                aria-label="Export Studio Aspect Ratio"
                data-testid="export-studio-aspect-toggle"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: 3,
                  borderRadius: 9,
                  background: 'rgba(2, 6, 23, 0.85)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                }}
              >
                <button
                  type="button"
                  data-testid="export-studio-aspect-16-9"
                  aria-pressed={resolvedAspectRatio === '16:9'}
                  disabled={isBatchRunning || isBatchStarting || isRendering}
                  onClick={() => onAspectRatioChange?.('16:9')}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 6,
                    border: resolvedAspectRatio === '16:9' ? '1px solid rgba(56, 189, 248, 0.7)' : '1px solid transparent',
                    background: resolvedAspectRatio === '16:9' ? 'rgba(2, 132, 199, 0.28)' : 'transparent',
                    color: resolvedAspectRatio === '16:9' ? '#38BDF8' : '#94A3B8',
                    fontSize: '0.73rem',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    cursor: (isBatchRunning || isBatchStarting || isRendering) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span style={{ display: 'inline-block', width: 13, height: 8, border: '1.5px solid currentColor', borderRadius: 1.5 }} aria-hidden="true" />
                  <span>16:9</span>
                </button>
                <button
                  type="button"
                  data-testid="export-studio-aspect-9-16"
                  aria-pressed={resolvedAspectRatio === '9:16'}
                  disabled={isBatchRunning || isBatchStarting || isRendering}
                  onClick={() => onAspectRatioChange?.('9:16')}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 6,
                    border: resolvedAspectRatio === '9:16' ? '1px solid rgba(56, 189, 248, 0.7)' : '1px solid transparent',
                    background: resolvedAspectRatio === '9:16' ? 'rgba(2, 132, 199, 0.28)' : 'transparent',
                    color: resolvedAspectRatio === '9:16' ? '#38BDF8' : '#94A3B8',
                    fontSize: '0.73rem',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    cursor: (isBatchRunning || isBatchStarting || isRendering) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span style={{ display: 'inline-block', width: 8, height: 12, border: '1.5px solid currentColor', borderRadius: 1.5 }} aria-hidden="true" />
                  <span>9:16</span>
                </button>
              </div>
            </div>

            {/* (c) Allow Original Audio Checkbox */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 10px',
                borderRadius: 8,
                background: allowOriginalAudio ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.04)',
                border: allowOriginalAudio ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: '0.73rem',
                fontWeight: 700,
                color: '#E2E8F0',
                cursor: isBatchRunning ? 'not-allowed' : 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                data-testid="export-studio-allow-original-audio"
                checked={Boolean(allowOriginalAudio)}
                disabled={isBatchRunning}
                onChange={(e) => onChangeAllowOriginalAudio?.(e.target.checked)}
                style={{ margin: 0, accentColor: '#38BDF8' }}
              />
              <span>Allow Original Audio (រួមបញ្ចូលភាគអត់ Voice ដោយប្រើសំឡេងដើម)</span>
            </label>
          </section>

          {/* Error Banner */}
          {batchError && (
            <div
              data-testid="export-studio-error"
              style={{
                background: 'rgba(239, 68, 68, 0.14)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                borderRadius: 9,
                padding: '9px 12px',
                fontSize: '0.74rem',
                color: '#FCA5A5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span>{batchError}</span>
              <button
                type="button"
                onClick={() => batchRender?.clear?.()}
                style={{ background: 'none', border: 'none', color: '#FCA5A5', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* ── (d) The Two Primary Export Actions ── */}
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 10,
            }}
          >
            <button
              type="button"
              data-testid="export-studio-merge-btn"
              disabled={isBatchRunning || isBatchStarting || isRendering || eligibleItems.length === 0}
              onClick={() => handleStartAction('merge')}
              className="btn-tactile"
              style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: (isBatchRunning || eligibleItems.length === 0)
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                border: (isBatchRunning || eligibleItems.length === 0)
                  ? '1px solid rgba(255, 255, 255, 0.12)'
                  : '1px solid #38BDF8',
                color: (isBatchRunning || eligibleItems.length === 0) ? '#64748B' : '#FFFFFF',
                fontSize: '0.82rem',
                fontWeight: 800,
                cursor: (isBatchRunning || isBatchStarting || isRendering || eligibleItems.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: (!isBatchRunning && eligibleItems.length > 0) ? '0 4px 18px rgba(2, 132, 199, 0.35)' : 'none',
              }}
            >
              {isBatchRunning && batchJob?.mode === 'merge' ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
              <span>Export 1 Full Video (Merge {eligibleItems.length} ភាគ)</span>
            </button>

            <button
              type="button"
              data-testid="export-studio-separate-btn"
              disabled={isBatchRunning || isBatchStarting || isRendering || eligibleItems.length === 0}
              onClick={() => handleStartAction('separate')}
              className="btn-tactile"
              style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: (isBatchRunning || eligibleItems.length === 0)
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'linear-gradient(135deg, rgba(16, 185, 129, 0.22) 0%, rgba(5, 150, 105, 0.35) 100%)',
                border: (isBatchRunning || eligibleItems.length === 0)
                  ? '1px solid rgba(255, 255, 255, 0.12)'
                  : '1px solid rgba(52, 211, 153, 0.55)',
                color: (isBatchRunning || eligibleItems.length === 0) ? '#64748B' : '#34D399',
                fontSize: '0.82rem',
                fontWeight: 800,
                cursor: (isBatchRunning || isBatchStarting || isRendering || eligibleItems.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {isBatchRunning && batchJob?.mode === 'separate' ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
              <span>Batch Export All ({eligibleItems.length} ភាគដាច់ដោយឡែក)</span>
            </button>
          </section>

          {/* ── (e) Live Job Progress Per Episode + Overall ── */}
          {batchJob && (
            <section
              data-testid="export-studio-progress-panel"
              style={{
                background: 'rgba(2, 6, 23, 0.75)',
                border: batchJob.status === 'completed'
                  ? '1px solid rgba(52, 211, 153, 0.5)'
                  : batchJob.status === 'failed'
                  ? '1px solid rgba(248, 113, 113, 0.5)'
                  : '1px solid rgba(56, 189, 248, 0.45)',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {batchJob.status === 'running' ? (
                    <Loader2 size={16} className="animate-spin" color="#38BDF8" />
                  ) : batchJob.status === 'completed' ? (
                    <CheckCircle2 size={16} color="#34D399" />
                  ) : (
                    <AlertCircle size={16} color="#F87171" />
                  )}
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {batchJob.stage || 'កំពុងដំណើរការ Batch Export...'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {batchJob.elapsedSeconds > 0 && (
                    <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                      {batchJob.elapsedSeconds}s
                    </span>
                  )}
                  <span style={{ fontSize: '0.92rem', fontWeight: 900, fontFamily: 'monospace', color: batchJob.status === 'completed' ? '#34D399' : '#38BDF8' }}>
                    {batchJob.progress || 0}%
                  </span>
                  {batchJob.status === 'running' ? (
                    <button
                      type="button"
                      data-testid="export-studio-kill-btn"
                      onClick={() => batchRender?.kill?.(batchJob.jobId)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: 'rgba(239, 68, 68, 0.25)',
                        border: '1px solid rgba(239, 68, 68, 0.6)',
                        color: '#FEE2E2',
                        fontSize: '0.71rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Square size={10} />
                      <span>Stop (Kill)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => batchRender?.clear?.()}
                      style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 2 }}
                      title="សម្អាតលទ្ធផល"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Overall Progress Bar */}
              <div style={{ width: '100%', height: 8, borderRadius: 9999, background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.max(2, batchJob.progress || 0)}%`,
                    height: '100%',
                    borderRadius: 9999,
                    background: batchJob.status === 'completed'
                      ? 'linear-gradient(90deg, #10b981, #34d399)'
                      : batchJob.status === 'failed'
                      ? '#ef4444'
                      : 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                    transition: 'width 0.25s ease',
                  }}
                />
              </div>

              {/* Per-Episode Progress Status Rows */}
              {perEpisodeJobProgress.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 6,
                  }}
                >
                  {perEpisodeJobProgress.map((row) => (
                    <div
                      key={row.episodeId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        padding: '5px 8px',
                        borderRadius: 6,
                        fontSize: '0.7rem',
                        background: row.state === 'completed'
                          ? 'rgba(16, 185, 129, 0.1)'
                          : row.state === 'running'
                          ? 'rgba(56, 189, 248, 0.14)'
                          : row.state === 'skipped'
                          ? 'rgba(245, 158, 11, 0.1)'
                          : 'rgba(255, 255, 255, 0.04)',
                        border: row.state === 'completed'
                          ? '1px solid rgba(52, 211, 153, 0.3)'
                          : row.state === 'running'
                          ? '1px solid rgba(56, 189, 248, 0.4)'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        EP{row.epNum}
                      </span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontWeight: 700,
                          color: row.state === 'completed'
                            ? '#34D399'
                            : row.state === 'running'
                            ? '#38BDF8'
                            : row.state === 'skipped'
                            ? '#FBBF24'
                            : '#94A3B8',
                          flexShrink: 0,
                        }}
                      >
                        {row.state === 'completed' && <Check size={11} />}
                        {row.state === 'running' && <Loader2 size={11} className="animate-spin" />}
                        {row.state === 'queued' && <Clock size={11} />}
                        <span>{row.label}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── (f) Finished Files Area with Download Button Per Produced File ── */}
          {hasFinishedFiles && (
            <section
              data-testid="export-studio-finished-files"
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(52, 211, 153, 0.38)',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#6EE7B7', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={15} color="#34D399" />
                  <span>ឯកសារវីដេអូដែលបាន Export រួចរាល់ (Finished Files)</span>
                </span>
              </div>

              {/* Merged Full Video File */}
              {batchJob.mergedResult?.downloadUrl && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 9,
                    background: 'rgba(2, 6, 23, 0.65)',
                    border: '1px solid rgba(52, 211, 153, 0.45)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#F8FAFC' }}>
                      🎬 {batchJob.mergedResult.outputFilename || 'Full_Merged_Khmer_Dubbed.mp4'}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
                      វីដេអូបញ្ចូលគ្នា {batchJob.mergedResult.mergedCount || ''} ភាគ • រក្សាទុកក្នុង Downloads រួចរាល់
                    </span>
                  </div>
                  <a
                    data-testid="export-studio-download-merged"
                    href={batchJob.mergedResult.downloadUrl || batchJob.mergedResult.videoUrl}
                    download={batchJob.mergedResult.outputFilename || 'Full_Merged_Khmer_Dubbed.mp4'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 14px',
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#FFFFFF',
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      textDecoration: 'none',
                    }}
                  >
                    <Download size={14} />
                    <span>Download Full Video</span>
                  </a>
                </div>
              )}

              {/* Per-Episode Produced Files */}
              {Array.isArray(batchJob.outputs) && batchJob.outputs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                  {batchJob.outputs.map((out) => (
                    <div
                      key={out.episodeId || out.outputFilename}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 7,
                        background: 'rgba(2, 6, 23, 0.55)',
                        border: '1px solid rgba(52, 211, 153, 0.28)',
                      }}
                    >
                      <span style={{ fontSize: '0.73rem', fontWeight: 700, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        EP{out.episodeNumber}: {out.outputFilename}
                      </span>
                      <a
                        data-testid={`export-studio-download-ep-${out.episodeId || out.episodeNumber}`}
                        href={out.downloadUrl || out.videoUrl}
                        download={out.outputFilename}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 11px',
                          borderRadius: 6,
                          background: 'rgba(16, 185, 129, 0.2)',
                          border: '1px solid rgba(52, 211, 153, 0.45)',
                          color: '#6EE7B7',
                          fontSize: '0.71rem',
                          fontWeight: 800,
                          textDecoration: 'none',
                          flexShrink: 0,
                        }}
                      >
                        <Download size={12} />
                        <span>Download</span>
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
