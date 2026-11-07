import React, { useState, useEffect } from 'react';
import {
  Film, Sparkles, AlertTriangle, RefreshCw
} from 'lucide-react';
import { fetchGeminiKeysStatusApi, startGenerationJob } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';
import { useSharedJobQueue } from '../../context/JobQueueContext';
import './WorkspaceLayout.css';

const STAGE_LABELS = {
  1: '1/5 Ingest Video & Extract Audio (SenseVoice + Fast OCR)',
  2: '2/5 Chinese Dialogue Timeline Alignment',
  3: '3/5 Reconcile & Verify Subtitle Boundaries',
  4: '4/5 Translate to Khmer (Gemini 2.5 Multi-Key)',
  5: '5/5 Generate Natural Khmer Subtitle Timing',
};

export default function InlineTranslatePanel({
  selectedVideo = null,
  videoMetadata = null,
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  onRefreshSeries = null,
  onOpenGeminiRoute = null,
  apiKey = null,
}) {
  let jobQueue = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    jobQueue = useSharedJobQueue();
  } catch (_) {}

  const activeEpisodeId = activeEpisode?.id || episodeId;
  const activeJob = jobQueue?.jobs?.find(
    (j) => String(j.episodeId) === String(activeEpisodeId) && (j.status === 'running' || j.status === 'queued')
  );
  const isJobRunning = Boolean(activeJob);

  // Key pool status
  const [keyStatus, setKeyStatus] = useState({ online: 4, total: 4, rpm: 60 });
  useEffect(() => {
    fetchGeminiKeysStatusApi()
      .then((res) => {
        if (res && res.success) {
          setKeyStatus({
            online: res.activeKeysCount || 4,
            total: res.totalKeysCount || 4,
            rpm: (res.activeKeysCount || 4) * 15,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Form options
  const [dubbingMode, setDubbingMode] = useState('dialogue');
  const [genre, setGenre] = useState('auto');
  const [narratorGender, setNarratorGender] = useState('male');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const handleExecuteTranslate = async (force = false) => {
    const rawVideoRef = selectedVideo?.videoPath || selectedVideo?.videoId || selectedVideo?.fileName || activeEpisode?.video?.videoPath || activeEpisode?.video?.videoId;
    if (!rawVideoRef) {
      alert('សូម Import ឬជ្រើសរើសវីដេអូជាមុនសិន!');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      await startGenerationJob({
        videoId: rawVideoRef,
        videoPath: selectedVideo?.videoPath || activeEpisode?.video?.videoPath,
        seriesId: activeSeries?.id || seriesId || 'drama_project',
        episodeId: activeEpisodeId,
        mode: dubbingMode,
        force,
        genre,
        narratorGender,
        seriesGlossary: activeSeries?.glossary,
        apiKey: apiKey || undefined,
      });

      if (onRefreshSeries) {
        try { await onRefreshSeries(); } catch (_) {}
      }
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || 'បរាជ័យក្នុងការចាប់ផ្ដើម Translate');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-refresh when job completes
  useEffect(() => {
    if (activeJob && (activeJob.status === 'completed' || activeJob.progress >= 100)) {
      const timer = setTimeout(() => {
        if (onRefreshSeries) onRefreshSeries();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [activeJob?.status, activeJob?.progress, onRefreshSeries]);

  const displayTitle = selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName || activeEpisode?.title || 'វីដេអូភាគ (Episode Video)';
  const videoDurationSec = videoMetadata?.durationSec || selectedVideo?.durationSec || 0;
  const displayDuration = videoDurationSec > 0 ? formatTimecode(videoDurationSec) : '00:00.00';
  const displayResolution = videoMetadata?.width && videoMetadata?.height ? `${videoMetadata.width}x${videoMetadata.height}` : 'HD 1080p';
  const epNum = activeEpisode?.episodeNumber || (activeEpisode?.id ? String(activeEpisode.id).replace(/\D/g, '') : '1');

  // If a job is currently running, show in-flow progress
  if (isJobRunning) {
    const progress = activeJob.progress || 0;
    const stageNum = activeJob.stageNumber || (progress < 25 ? 1 : progress < 50 ? 2 : progress < 70 ? 3 : progress < 90 ? 4 : 5);
    const stageLabel = activeJob.currentStage || STAGE_LABELS[stageNum] || 'កំពុងដំណើរការ Pipeline...';

    return (
      <div className="workspace-inflow-translate-panel">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 720 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Job #{activeJob.jobId} • {activeJob.workerId ? `Worker #${activeJob.workerId}` : 'Gemini AI'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
              {progress}%
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={15} className="spin-icon" color="#38bdf8" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>
              {stageLabel}
            </span>
          </div>

          <div className="stage-progress-bar-bg" style={{ height: 6 }}>
            <div className="stage-progress-bar-fill" style={{ width: `${Math.max(5, progress)}%` }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {[1, 2, 3, 4, 5].map((num) => {
              const isDone = stageNum > num || progress === 100;
              const isCurrent = stageNum === num && progress < 100;
              return (
                <div
                  key={num}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: isDone ? '#22c55e' : isCurrent ? '#38bdf8' : '#475569',
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  <span style={{ width: 16, textAlign: 'center', fontFamily: 'monospace' }}>
                    {isDone ? '✓' : num}
                  </span>
                  <span>{STAGE_LABELS[num]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // In-flow translate form (full-width-of-centre, top-aligned, max-width ~720px)
  return (
    <div className="workspace-inflow-translate-panel">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 720 }}>
        {/* Episode Summary In-Flow */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: 'rgba(56, 189, 248, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Film size={20} color="#38bdf8" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
              <span>ភាគទី {epNum}</span>
              <span>•</span>
              <span>{displayDuration}</span>
              <span>•</span>
              <span>{displayResolution}</span>
            </div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#f1f5f9' }}>
              {displayTitle}
            </h3>
            <span style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>
              មិនទាន់មាន Script (No script yet)
            </span>
          </div>
        </div>

        {/* Translation Mode & Genre options */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8' }}>
              របៀបបកប្រែ (Translate Mode):
            </label>
            <select
              value={dubbingMode}
              onChange={(e) => setDubbingMode(e.target.value)}
              className="stage-select"
            >
              <option value="dialogue">Mode A: សន្ទនា 1:1 (Dialogue 1:1)</option>
              <option value="recap">Mode B: សម្រាយសាច់រឿង (Story Recap)</option>
              <option value="fast_ocr">⚡ Fast Subtitle OCR (3-5x Faster)</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8' }}>
              ប្រភេទរឿង (Genre):
            </label>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="stage-select"
            >
              <option value="auto">✨ Auto (ស្គាល់ស្វ័យប្រវត្តិ)</option>
              <option value="ancient">🏛️ បុរាណចិន (Ancient / Xianxia)</option>
              <option value="modern">🏙️ សម័យទំនើប (Modern / Drama)</option>
              <option value="action">⚔️ សកម្មភាព (Action)</option>
              <option value="comedy">🎭 កំប្លែង (Comedy)</option>
            </select>
          </div>
        </div>

        {/* Quiet Key Pool line (Point 5) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
          <span>Key Pool: {keyStatus.online}/{keyStatus.total} online</span>
          <span style={{ color: '#334155' }}>•</span>
          <button
            type="button"
            onClick={onOpenGeminiRoute}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 12,
              color: '#38bdf8',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Manage Keys
          </button>
        </div>

        {submitError && (
          <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 6, color: '#f87171', fontSize: 12 }}>
            {submitError}
          </div>
        )}

        {/* 1-Click Action Button */}
        <div>
          <button
            type="button"
            className="stage-btn-primary"
            style={{ width: 'auto', minWidth: 260, padding: '10px 20px', fontSize: 13 }}
            disabled={isSubmitting}
            onClick={() => handleExecuteTranslate(false)}
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="spin-icon" />
                <span>កំពុងបញ្ជូនទៅកាន់ Job Queue...</span>
              </>
            ) : (
              <>
                <Sparkles size={15} />
                <span>✦ បង្កើត Script & បកប្រែ (Gemini Route)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
