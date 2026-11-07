import React, { useState, useEffect } from 'react';
import {
  Film, Sparkles, Layers, AlertTriangle, CheckCircle2,
  RefreshCw, Play, Info
} from 'lucide-react';
import { fetchGeminiKeysStatusApi, startGenerationJob } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';
import { useSharedJobQueue } from '../../context/JobQueueContext';
import './WorkspaceLayout.css';
import '../../steps/script/ScriptPage.css';

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
  const [showConfirmRetranslate, setShowConfirmRetranslate] = useState(false);

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
      setShowConfirmRetranslate(false);
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

  // If a job is currently running, show live progress card
  if (isJobRunning) {
    const progress = activeJob.progress || 0;
    const stageNum = activeJob.stageNumber || (progress < 25 ? 1 : progress < 50 ? 2 : progress < 70 ? 3 : progress < 90 ? 4 : 5);
    const stageLabel = activeJob.currentStage || STAGE_LABELS[stageNum] || 'កំពុងដំណើរការ Pipeline...';

    return (
      <div className="workspace-inline-translate-wrapper">
        <div className="script-inline-run-card" style={{ maxWidth: 640 }}>
          <div className="script-key-status-strip">
            <div className="script-key-status-left">
              <span className="script-key-status-dot pulse" />
              <span>Job #{activeJob.jobId} • {activeJob.seriesId || 'Series'} / {activeJob.episodeId}</span>
            </div>
            <span style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 600 }}>
              {activeJob.workerId ? `Worker #${activeJob.workerId}` : 'Gemini AI Worker'}
            </span>
          </div>

          <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <RefreshCw size={18} className="script-spin-icon" color="#38bdf8" />
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
                  {stageLabel}
                </span>
              </div>
              <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#38bdf8' }}>
                {progress}%
              </span>
            </div>

            <div className="script-progress-track">
              <div className="script-progress-bar" style={{ width: `${Math.max(5, progress)}%` }} />
            </div>

            <div className="script-stage-list">
              {[1, 2, 3, 4, 5].map((num) => {
                const isDone = stageNum > num || progress === 100;
                const isCurrent = stageNum === num && progress < 100;
                return (
                  <div key={num} className={`script-stage-step ${isDone ? 'done' : isCurrent ? 'current' : 'pending'}`}>
                    <span className="script-stage-number">{isDone ? '✓' : num}</span>
                    <span className="script-stage-text">{STAGE_LABELS[num]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No script yet and not running: Focused Generate Card
  return (
    <div className="workspace-inline-translate-wrapper">
      <div className="script-inline-run-card" style={{ maxWidth: 640 }}>
        {/* Key Pool Strip */}
        <div className="script-key-status-strip">
          <div className="script-key-status-left">
            <span className="script-key-status-dot" />
            <span>Key Pool: {keyStatus.online}/{keyStatus.total} online • {keyStatus.rpm} RPM</span>
          </div>
          <button
            type="button"
            className="script-key-manage-btn"
            onClick={onOpenGeminiRoute}
            title="គ្រប់គ្រង Gemini Keys & Quotas"
          >
            Manage Keys
          </button>
        </div>

        {/* Video / Episode Summary */}
        <div className="script-summary-row">
          <div className="script-summary-icon">
            <Film size={26} color="#38bdf8" />
          </div>
          <div className="script-summary-info">
            <div className="script-summary-eyebrow">
              <span>ភាគទី {epNum}</span>
              <span>•</span>
              <span>{displayDuration}</span>
              <span>•</span>
              <span>{displayResolution}</span>
            </div>
            <h2 className="script-summary-title" title={displayTitle}>
              {displayTitle}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 600 }}>
                ⚠️ មិនទាន់មាន Script (No Script Yet)
              </span>
            </div>
          </div>
        </div>

        {/* Translation Mode & Genre options */}
        <div className="script-options-grid">
          <div className="script-option-field">
            <label className="script-option-label">របៀបបកប្រែ (Translate Mode):</label>
            <select
              value={dubbingMode}
              onChange={(e) => setDubbingMode(e.target.value)}
              className="script-select-input"
            >
              <option value="dialogue">Mode A: សន្ទនា 1:1 (Chinese Dialogue 1:1)</option>
              <option value="recap">Mode B: សម្រាយសាច់រឿង (Story Recap / Narration)</option>
              <option value="fast_ocr">⚡ Fast Subtitle OCR (3-5x Faster)</option>
            </select>
          </div>

          <div className="script-option-field">
            <label className="script-option-label">ប្រភេទរឿង (Genre):</label>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="script-select-input"
            >
              <option value="auto">✨ Auto (ស្គាល់ស្វ័យប្រវត្តិ)</option>
              <option value="ancient">🏛️ បុរាណចិន / Xianxia</option>
              <option value="modern">🏙️ សម័យទំនើប / CEO</option>
              <option value="action">⚔️ Action / សងសឹក</option>
              <option value="comedy">🎭 កំប្លែង / គ្រួសារ</option>
            </select>
          </div>
        </div>

        {submitError && (
          <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 6, color: '#f87171', fontSize: '0.78rem' }}>
            {submitError}
          </div>
        )}

        {/* 1-Click Action Button */}
        <div className="script-actions-section" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="script-primary-run-btn"
            disabled={isSubmitting}
            onClick={() => handleExecuteTranslate(false)}
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={15} className="script-spin-icon" />
                <span>កំពុងបញ្ជូនទៅកាន់ Job Queue...</span>
              </>
            ) : (
              <>
                <Sparkles size={16} />
                <span>✦ បង្កើត Script & បកប្រែ (Gemini Route)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
