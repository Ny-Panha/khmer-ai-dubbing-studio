import React, { useMemo, useEffect } from 'react';
import {
  Film, Layers, Download, Loader2, CheckCircle2, AlertTriangle, AlertCircle,
  Square, X, Check, Clock, FileText, Mic, Volume2, CheckSquare
} from 'lucide-react';
import { resolveDefaultAspectRatio, sanitizeAspectRatio } from '../../utils/projectStorage';
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
      const segments = Array.isArray(ep?.scriptData?.segments) ? ep.scriptData.segments : [];
      const hasVoiceSegments = segments.some((s) => !s.muted && !s.isMuted && Boolean(s.audioUrl || s.audioFile || s.audioPath));
      const hasVoice = Boolean(
        checkEpisodeHasAudioReady(ep) ||
        hasActiveLocalVoice ||
        ep.hasAudio ||
        ep.audioGenerated ||
        hasVoiceSegments
      );
      const hasDemucs = Boolean(checkEpisodeHasDemucsReady(ep));
      const hasRendered = Boolean(
        ep?.renderedVideo?.success &&
        (ep?.renderedVideo?.outputFilename || ep?.renderedVideo?.videoUrl)
      );

      let notReadyReason = null;
      if (!hasVideo) {
        notReadyReason = '⚠️ គ្មានវីដេអូ';
      } else if (!hasScript) {
        notReadyReason = '⚠️ គ្មាន Script';
      } else if (!hasVoice) {
        notReadyReason = '⚠️ គ្មានសំឡេង AI';
      } else if (ep.audioOutdated) {
        notReadyReason = '⚠️ សំឡេងមិនទាន់អាប់ដេត';
      } else if (brokenSummary.totalBrokenCount > 0) {
        notReadyReason = `⚠️ នៅខ្វះ/ខូច ${brokenSummary.totalBrokenCount} ឃ្លា`;
      }

      return {
        ep,
        epNum,
        title: ep.displayTitle || ep.title || `ភាគទី ${epNum} (EP${epNum})`,
        hasVideo,
        hasScript,
        hasVoice,
        hasDemucs,
        hasRendered,
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
    sanitizeAspectRatio(currentAspectRatio) ||
    sanitizeAspectRatio(voiceSettings?.aspectRatio) ||
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
        const epPct = typeof batchJob.currentEpisodePercent === 'number' && batchJob.currentEpisodePercent > 0
          ? `${batchJob.currentEpisodePercent}%`
          : '0%';
        rows.push({
          episodeId: item.ep.id,
          epNum: item.epNum,
          title: item.title,
          state: 'running',
          label: `កំពុង Render ${epPct} (${batchJob.currentIndex || 1}/${batchJob.totalCount || 1})`,
          percent: typeof batchJob.currentEpisodePercent === 'number' ? batchJob.currentEpisodePercent : 0,
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
      role="region"
      aria-label="Export Studio — Batch Export & Merge"
      className="studio-route-stage"
    >
      <div className="studio-route-stage-shell">
        {/* ── Modal Header ── */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary-panel)',
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
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Film size={18} color="var(--primary-accent)" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.01em' }}>
                  Export Studio · បញ្ចេញ &amp; បូកវីដេអូ
                </h1>
                {activeSeries?.title && (
                  <span
                    style={{
                      fontSize: 'var(--text-2xs)',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-xs)',
                      background: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
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
            </div>
          </div>

          <button
            type="button"
            data-testid="close-export-studio-btn"
            onClick={onClose}
            className="btn-secondary"
            style={{
              minHeight: 34,
              padding: '6px 12px',
            }}
          >
            <X size={14} />
            <span>បិទ (Close)</span>
          </button>
        </div>

        {/* ── 2-Column Darkroom Split Body (Render Controls Left | Progress + Episodes Right) ── */}
        <div className="batch-studio-split-body">
          {/* LEFT COLUMN: Format, Actions & Summary */}
          <aside className="batch-studio-controls-col">
            {/* (b) Shared Aspect Indicator + Sticky 16:9 | 9:16 Toggle & (c) Allow Original Audio */}
            <section
              style={{
                background: 'var(--bg-secondary-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  ទម្រង់វីដេអូ (Aspect)
                </span>
                <span
                  data-testid="export-studio-aspect-indicator"
                  style={{
                    fontSize: 'var(--text-2xs)',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-xs)',
                    background: 'rgba(56, 189, 248, 0.14)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    color: 'var(--primary-accent)',
                    fontFamily: 'var(--font-mono)',
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
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 4,
                  padding: 3,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-desktop)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <button
                  type="button"
                  data-testid="export-studio-aspect-16-9"
                  aria-pressed={resolvedAspectRatio === '16:9'}
                  disabled={isBatchRunning || isBatchStarting || isRendering}
                  onClick={() => onAspectRatioChange?.('16:9')}
                  style={{
                    padding: '7px 11px',
                    borderRadius: 'var(--radius-xs)',
                    border: resolvedAspectRatio === '16:9' ? '1px solid rgba(56, 189, 248, 0.55)' : '1px solid transparent',
                    background: resolvedAspectRatio === '16:9' ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
                    color: resolvedAspectRatio === '16:9' ? 'var(--primary-accent)' : 'var(--text-secondary)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    cursor: (isBatchRunning || isBatchStarting || isRendering) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ display: 'inline-block', width: 14, height: 9, border: '1.5px solid currentColor', borderRadius: 1.5 }} aria-hidden="true" />
                  <span>16:9</span>
                </button>
                <button
                  type="button"
                  data-testid="export-studio-aspect-9-16"
                  aria-pressed={resolvedAspectRatio === '9:16'}
                  disabled={isBatchRunning || isBatchStarting || isRendering}
                  onClick={() => onAspectRatioChange?.('9:16')}
                  style={{
                    padding: '7px 11px',
                    borderRadius: 'var(--radius-xs)',
                    border: resolvedAspectRatio === '9:16' ? '1px solid rgba(56, 189, 248, 0.55)' : '1px solid transparent',
                    background: resolvedAspectRatio === '9:16' ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
                    color: resolvedAspectRatio === '9:16' ? 'var(--primary-accent)' : 'var(--text-secondary)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    cursor: (isBatchRunning || isBatchStarting || isRendering) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ display: 'inline-block', width: 9, height: 13, border: '1.5px solid currentColor', borderRadius: 1.5 }} aria-hidden="true" />
                  <span>9:16</span>
                </button>
              </div>

              {/* (c) Allow Original Audio Checkbox */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: allowOriginalAudio ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-elevated-panel)',
                  border: allowOriginalAudio ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid var(--border-subtle)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
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
                <span>ប្រើសំឡេងដើមបើគ្មានសំឡេង AI</span>
              </label>

              {/* (c2) Video Edit Settings Snapshot — read-only summary for batch */}
              {(() => {
                const vs = voiceSettings || {};
                const mirrorOn = Boolean(vs.enableMirrorFlip);
                const zoomRaw = Number(vs.zoomScale);
                const zoomOn = Number.isFinite(zoomRaw) && zoomRaw > 1.005;
                const colorOn = Boolean(vs.enableColorGrade);
                const muteOn = Boolean(vs.youtubeSafeAudio);
                const pills = [
                  mirrorOn && { label: 'Mirror Flip', color: '#38bdf8' },
                  zoomOn && { label: `Zoom ${Math.round(zoomRaw * 100)}%`, color: '#34d399' },
                  colorOn && { label: 'Color Grade', color: '#a78bfa' },
                  muteOn && { label: 'Mute OST', color: '#fb923c' },
                ].filter(Boolean);
                if (pills.length === 0) return null;
                return (
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(16,185,129,0.07)',
                      border: '1px solid rgba(16,185,129,0.25)',
                    }}
                  >
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: 5, fontWeight: 600 }}>
                      🎞 Video Edit Settings ({pills.length} ON) — applied to all episodes
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {pills.map((p) => (
                        <span
                          key={p.label}
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 4,
                            background: 'rgba(0,0,0,0.25)',
                            color: p.color,
                            border: `1px solid ${p.color}55`,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {p.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </section>

            {/* (d) Primary Export Actions */}
            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                background: 'var(--bg-secondary-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                <span>ភាគត្រៀម Export</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary-accent)' }}>
                  {eligibleItems.length} / {selectedItems.length} ភាគ
                </span>
              </div>

              <button
                type="button"
                data-testid="export-studio-merge-btn"
                disabled={isBatchRunning || isBatchStarting || isRendering || eligibleItems.length === 0}
                onClick={() => handleStartAction('merge')}
                className="btn-primary"
                style={{
                  width: '100%',
                  minHeight: 42,
                  padding: '10px 14px',
                  fontSize: 'var(--text-body)',
                  fontWeight: 700,
                  opacity: (isBatchRunning || eligibleItems.length === 0) ? 0.5 : 1,
                  cursor: (isBatchRunning || isBatchStarting || isRendering || eligibleItems.length === 0) ? 'not-allowed' : 'pointer',
                }}
              >
                {isBatchRunning && batchJob?.mode === 'merge' ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
                <span>បូកជារឿងពេញ ({eligibleItems.length} ភាគ)</span>
              </button>

              <button
                type="button"
                data-testid="export-studio-separate-btn"
                disabled={isBatchRunning || isBatchStarting || isRendering || eligibleItems.length === 0}
                onClick={() => handleStartAction('separate')}
                className="btn-secondary"
                style={{
                  width: '100%',
                  minHeight: 40,
                  padding: '9px 14px',
                  fontSize: 'var(--text-body)',
                  fontWeight: 700,
                  borderColor: (isBatchRunning || eligibleItems.length === 0) ? 'var(--border-subtle)' : 'rgba(52, 211, 153, 0.45)',
                  color: (isBatchRunning || eligibleItems.length === 0) ? 'var(--text-dim)' : '#6EE7B7',
                  background: (isBatchRunning || eligibleItems.length === 0) ? 'var(--bg-elevated-panel)' : 'rgba(16, 185, 129, 0.12)',
                  cursor: (isBatchRunning || isBatchStarting || isRendering || eligibleItems.length === 0) ? 'not-allowed' : 'pointer',
                }}
              >
                {isBatchRunning && batchJob?.mode === 'separate' ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
                <span>Export ដាច់ដោយឡែក ({eligibleItems.length} ភាគ)</span>
              </button>
            </section>

            {/* Missing Voice Warning Banner */}
            {selectedMissingVoiceItems.length > 0 && (
              <div
                data-testid="export-studio-missing-voice-warning"
                style={{
                  background: allowOriginalAudio ? 'rgba(56, 189, 248, 0.1)' : 'rgba(245, 158, 11, 0.12)',
                  border: allowOriginalAudio ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(245, 158, 11, 0.4)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1.55,
                  color: allowOriginalAudio ? '#BAE6FD' : '#FDE68A',
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2, color: allowOriginalAudio ? '#38BDF8' : '#FBBF24' }} />
                <span>
                  {allowOriginalAudio
                    ? `ភាគអត់ Voice (${selectedMissingVoiceItems.map((i) => `EP${i.epNum}`).join(', ')}) នឹង Export ដោយប្រើសំឡេងដើម។`
                    : `ភាគ ${selectedMissingVoiceItems.map((i) => `EP${i.epNum}`).join(', ')} មិនទាន់មានសំឡេងខ្មែរ — នឹងត្រូវរំលងពេល Export!`}
                </span>
              </div>
            )}

            {/* Error Banner */}
            {batchError && (
              <div
                data-testid="export-studio-error"
                style={{
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  fontSize: 'var(--text-sm)',
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
          </aside>

          {/* RIGHT COLUMN: Live Progress, Finished Downloads & Full-Height Episode Grid */}
          <section className="batch-studio-queue-col" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* (e) Live Job Progress Per Episode + Overall */}
            {batchJob && (
              <section
                data-testid="export-studio-progress-panel"
                style={{
                  background: 'var(--bg-primary-panel)',
                  border: batchJob.status === 'completed'
                    ? '1px solid rgba(52, 211, 153, 0.45)'
                    : batchJob.status === 'failed'
                    ? '1px solid rgba(248, 113, 113, 0.45)'
                    : '1px solid rgba(56, 189, 248, 0.45)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {batchJob.status === 'running' ? (
                      <Loader2 size={16} className="animate-spin" color="#38BDF8" />
                    ) : batchJob.status === 'completed' ? (
                      <CheckCircle2 size={16} color="#34D399" />
                    ) : (
                      <AlertCircle size={16} color="#F87171" />
                    )}
                    <span style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {batchJob.stage || 'កំពុងដំណើរការ Batch Export...'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {batchJob.elapsedSeconds > 0 && (
                      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {batchJob.elapsedSeconds}s
                      </span>
                    )}
                    {batchJob.status === 'running' && (
                      <span
                        style={{
                          fontSize: 'var(--text-2xs)',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)',
                          color: '#38BDF8',
                          background: 'rgba(56, 189, 248, 0.14)',
                          border: '1px solid rgba(56, 189, 248, 0.35)',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-xs)',
                        }}
                      >
                        {batchJob.currentEpisodeNumber
                          ? `EP${batchJob.currentEpisodeNumber}: ${batchJob.currentEpisodePercent || 0}%`
                          : `Merge: ${batchJob.currentEpisodePercent || 0}%`}
                      </span>
                    )}
                    <span style={{ fontSize: 'var(--text-md)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: batchJob.status === 'completed' ? '#34D399' : '#38BDF8' }}>
                      {batchJob.status === 'completed' ? '100%' : `សរុប ${batchJob.progress || 0}%`}
                    </span>
                    {batchJob.status === 'running' ? (
                      <button
                        type="button"
                        data-testid="export-studio-kill-btn"
                        onClick={() => batchRender?.kill?.(batchJob.jobId)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-xs)',
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid rgba(239, 68, 68, 0.5)',
                          color: '#FCA5A5',
                          fontSize: 'var(--text-2xs)',
                          fontWeight: 700,
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
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 2 }}
                        title="សម្អាតលទ្ធផល"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Overall Progress Bar */}
                <div style={{ width: '100%', height: 7, borderRadius: 'var(--radius-full)', background: 'var(--bg-desktop)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max(2, batchJob.progress || 0)}%`,
                      height: '100%',
                      borderRadius: 'var(--radius-full)',
                      background: batchJob.status === 'completed'
                        ? '#10B981'
                        : batchJob.status === 'failed'
                        ? '#EF4444'
                        : 'var(--primary-accent)',
                      transition: 'width 0.25s ease',
                    }}
                  />
                </div>

                {/* Per-Episode Progress Status Rows */}
                {perEpisodeJobProgress.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                      gap: 6,
                    }}
                  >
                    {perEpisodeJobProgress.map((row) => (
                      <div
                        key={row.episodeId}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          padding: '6px 9px',
                          borderRadius: 'var(--radius-xs)',
                          fontSize: 'var(--text-2xs)',
                          background: row.state === 'completed'
                            ? 'rgba(16, 185, 129, 0.1)'
                            : row.state === 'running'
                            ? 'rgba(56, 189, 248, 0.12)'
                            : row.state === 'skipped'
                            ? 'rgba(245, 158, 11, 0.1)'
                            : 'var(--bg-secondary-panel)',
                          border: row.state === 'completed'
                            ? '1px solid rgba(52, 211, 153, 0.3)'
                            : row.state === 'running'
                            ? '1px solid rgba(56, 189, 248, 0.35)'
                            : '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
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
                                : 'var(--text-secondary)',
                              flexShrink: 0,
                            }}
                          >
                            {row.state === 'completed' && <Check size={11} />}
                            {row.state === 'running' && <Loader2 size={11} className="animate-spin" />}
                            {row.state === 'queued' && <Clock size={11} />}
                            <span>{row.label}</span>
                          </span>
                        </div>
                        {row.state === 'running' && (
                          <div style={{ width: '100%', height: 3, background: 'var(--bg-desktop)', borderRadius: 2, overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.max(4, row.percent || 0)}%`,
                                height: '100%',
                                background: 'var(--primary-accent)',
                                transition: 'width 0.25s ease',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* (f) Finished Files Area with Download Button Per Produced File */}
            {hasFinishedFiles && (
              <section
                data-testid="export-studio-finished-files"
                style={{
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(52, 211, 153, 0.35)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: '#6EE7B7', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={15} color="#34D399" />
                    <span>ឯកសារវីដេអូដែលបាន Export រួចរាល់ ({Array.isArray(batchJob.outputs) ? `${batchJob.outputs.length} ភាគ` : 'Finished Files'})</span>
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
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-primary-panel)',
                      border: '1px solid rgba(52, 211, 153, 0.4)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Film size={14} color="#34D399" />
                        <span>{batchJob.mergedResult.outputFilename || 'Full_Merged_Khmer_Dubbed.mp4'}</span>
                      </span>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
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
                        borderRadius: 'var(--radius-sm)',
                        background: '#059669',
                        border: '1px solid #10B981',
                        color: '#FFFFFF',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 700,
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
                    {batchJob.outputs.map((out) => (
                      <div
                        key={out.episodeId || out.outputFilename}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '7px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-primary-panel)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                            borderRadius: 'var(--radius-xs)',
                            background: 'rgba(16, 185, 129, 0.16)',
                            border: '1px solid rgba(52, 211, 153, 0.4)',
                            color: '#6EE7B7',
                            fontSize: 'var(--text-2xs)',
                            fontWeight: 700,
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

            {/* (a) Episode Multi-Select Grid with Readiness States (Full Height, Uncramped) */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
                    ជ្រើសរើសភាគសម្រាប់ Export ({selectedItems.length}/{episodesWithVideo.length} ភាគ)
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--text-2xs)',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-xs)',
                      background: 'rgba(16, 185, 129, 0.14)',
                      border: '1px solid rgba(52, 211, 153, 0.35)',
                      color: '#6EE7B7',
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
                    className="btn-secondary"
                    style={{ minHeight: 30, padding: '4px 10px', fontSize: 'var(--text-sm)', color: 'var(--primary-accent)' }}
                  >
                    <CheckSquare size={12} />
                    <span>ទាំងអស់ ({episodesWithVideo.length})</span>
                  </button>
                  <button
                    type="button"
                    data-testid="export-studio-select-voiced"
                    disabled={isBatchRunning}
                    onClick={() => onChangeSelectedEpIds?.(episodesWithVideo.filter((item) => item.hasVoice).map((item) => item.ep.id))}
                    className="btn-secondary"
                    style={{ minHeight: 30, padding: '4px 10px', fontSize: 'var(--text-sm)', color: '#6EE7B7' }}
                  >
                    <Mic size={12} />
                    <span>មាន Voice ({episodesWithVideo.filter((item) => item.hasVoice).length})</span>
                  </button>
                  <button
                    type="button"
                    data-testid="export-studio-select-unrendered"
                    disabled={isBatchRunning}
                    onClick={() =>
                      onChangeSelectedEpIds?.(
                        episodesWithVideo
                          .filter((item) => item.hasVoice && !item.hasRendered)
                          .map((item) => item.ep.id)
                      )
                    }
                    className="btn-secondary"
                    style={{ minHeight: 30, padding: '4px 10px', fontSize: 'var(--text-sm)' }}
                    title="ជ្រើសរើសតែភាគដែលមាន Voice ហើយមិនទាន់បាន Export"
                  >
                    <Film size={12} />
                    <span>មិនទាន់ Export ({episodesWithVideo.filter((item) => item.hasVoice && !item.hasRendered).length})</span>
                  </button>
                  <button
                    type="button"
                    data-testid="export-studio-clear-all"
                    disabled={isBatchRunning || selectedItems.length === 0}
                    onClick={() => onChangeSelectedEpIds?.([])}
                    className="btn-secondary"
                    style={{ minHeight: 30, padding: '4px 10px', fontSize: 'var(--text-sm)' }}
                  >
                    <X size={12} />
                    <span>ដកជ្រើសរើស</span>
                  </button>
                </div>
              </div>

              {episodeReadinessList.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', background: 'var(--bg-primary-panel)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  មិនទាន់មានភាគនៅក្នុង Series នេះទេ។
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(245px, 1fr))',
                    gap: 10,
                  }}
                >
                  {episodeReadinessList.map((item) => {
                    const { ep, epNum, title, hasVideo, hasScript, hasVoice, hasDemucs, hasRendered, isReady, notReadyReason } = item;
                    const isChecked = selectedSet.has(String(ep.id));
                    return (
                      <label
                        key={ep.id}
                        data-testid={`export-studio-ep-card-${ep.id}`}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 7,
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          cursor: !hasVideo || isBatchRunning ? 'not-allowed' : 'pointer',
                          opacity: hasVideo ? 1 : 0.52,
                          background: isChecked
                            ? (isReady ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)')
                            : 'var(--bg-primary-panel)',
                          border: isChecked
                            ? (isReady ? '1px solid rgba(52, 211, 153, 0.45)' : '1px solid rgba(251, 191, 36, 0.48)')
                            : '1px solid var(--border-subtle)',
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
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 700,
                              fontFamily: 'var(--font-mono)',
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-xs)',
                              background: 'rgba(56, 189, 248, 0.14)',
                              color: 'var(--primary-accent)',
                              flexShrink: 0,
                            }}
                          >
                            EP{epNum}
                          </span>
                          <span
                            style={{
                              fontSize: 'var(--text-sm)',
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={title}
                          >
                            {title}
                          </span>
                        </div>

                        {/* Readiness Badges: Script, Voice, Demucs */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-xs)',
                              background: hasScript ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)',
                              color: hasScript ? '#6EE7B7' : '#FCA5A5',
                              border: hasScript ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(248, 113, 113, 0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <FileText size={10} />
                            <span>Script {hasScript ? '✓' : '✗'}</span>
                          </span>
                          <span
                            style={{
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-xs)',
                              background: hasVoice ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)',
                              color: hasVoice ? '#6EE7B7' : '#FDE68A',
                              border: hasVoice ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(251, 191, 36, 0.32)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <Mic size={10} />
                            <span>Voice {hasVoice ? '✓' : '✗'}</span>
                          </span>
                          <span
                            style={{
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-xs)',
                              background: hasDemucs ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-secondary-panel)',
                              color: hasDemucs ? '#7DD3FC' : 'var(--text-secondary)',
                              border: hasDemucs ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid var(--border-subtle)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <Volume2 size={10} />
                            <span>Demucs {hasDemucs ? '✓' : '✗'}</span>
                          </span>
                          {hasRendered && (
                            <span
                              style={{
                                fontSize: 'var(--text-2xs)',
                                fontWeight: 600,
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-xs)',
                                background: 'rgba(56, 189, 248, 0.16)',
                                color: '#7DD3FC',
                                border: '1px solid rgba(56, 189, 248, 0.35)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                              }}
                              title="ភាគនេះបាន Render រួចរាល់ 100% ហើយ"
                            >
                              <Film size={10} />
                              <span>Rendered ✓</span>
                            </span>
                          )}
                        </div>

                        {/* Not-Ready Reason Flag */}
                        {notReadyReason && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 600,
                              color: !hasVideo ? '#FCA5A5' : '#FDE68A',
                            }}
                          >
                            {!notReadyReason.includes('⚠️') && <AlertTriangle size={11} style={{ flexShrink: 0 }} />}
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
            </section>
          </section>
        </div>
      </div>
    </div>
  );
}
