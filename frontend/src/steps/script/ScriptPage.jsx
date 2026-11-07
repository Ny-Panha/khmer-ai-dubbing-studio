import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Film, Sparkles, Plus, AlertCircle, Cpu, RotateCcw,
  Check, CheckCircle2, Loader2, Undo2, Redo2, Search,
  Sliders, ArrowRight, X, AlertTriangle, Layers, ShieldCheck
} from 'lucide-react';
import { formatTimecode } from '../../utils/formatTime';
import { startGenerationJob, fetchGeminiKeysStatusApi } from '../../services/api';
import { useSharedJobQueue } from '../../context/JobQueueContext';

import TranscriptSegmentList from '../../features/segment-list/TranscriptSegmentList';
import ThinSeekStrip from './ThinSeekStrip';
import VideoPlayerPreview from '../../components/VideoPlayerPreview';
import ClipInspectorPanel from '../../components/voice/ClipInspectorPanel';
import './ScriptPage.css';

/**
 * ScriptPage (Pattern A Step 2: Translate & Script)
 * - PART A: Inline single-episode translate run panel (replaces modal trigger).
 * - PART B: Transcript-first editing workspace with ~340px sticky right rail & thin seek strip.
 */
export default function ScriptPage({
  scriptData = null,
  setScriptData = null,
  selectedVideo = null,
  videoMetadata = null,
  seriesId = null,
  episodeId = null,
  activeSeries = null,
  activeEpisode = null,
  onSwitchEpisode = null,
  onRefreshSeries = null,
  onOpenGeminiRoute = null,
  onAddSegment = null,
  // Segment operations
  selectedSegmentId = null,
  onSelectSegment = null,
  onUpdateScript = null,
  onUpdateSegments = null,
  onUpdateSegmentText = null,
  onRegenerateSegment = null,
  onDeleteSegment = null,
  onToggleDeliveryType = null,
  onUpdateSpeakerVoice = null,
  onUpdateSegmentVoice = null,
  speakerRegistry = {},
  // Alignment & Undo
  onAutoAlignNoOverlap = null,
  onResetToSourceTiming = null,
  canUndo = false,
  canRedo = false,
  onUndo = null,
  onRedo = null,
  // Video player & playback
  videoRef = null,
  currentTime = 0,
  duration = 0,
  isPlaying = false,
  onPlayPause = null,
  onSeek = null,
  onTimeUpdate = null,
  onLoadedMetadata = null,
  onEnded = null,
  voiceSettings = {},
  onUpdateVoiceSettings = null,
  fullAudioUrl = null,
  audioGenerated = false,
  audioOutdated = false,
  onVideoSelected = null,
  videoClips = [],
  apiKey = null,
}) {
  const segments = scriptData?.segments || [];
  const hasSegments = segments.length > 0;

  // Shared Job Queue connection for real-time progress
  const jobQueue = useSharedJobQueue();
  const { jobs = [] } = jobQueue || {};

  const activeEpisodeId = activeEpisode?.id || episodeId;
  const activeJob = jobs.find(
    (j) => String(j.episodeId) === String(activeEpisodeId) && (j.status === 'running' || j.status === 'queued')
  );
  const isJobRunning = Boolean(activeJob);

  // Key Pool status
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

  // Inline translate runner settings
  const [dubbingMode, setDubbingMode] = useState('dialogue');
  const [genre, setGenre] = useState('auto');
  const [narratorGender, setNarratorGender] = useState('male');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Search in transcript
  const [searchQuery, setSearchQuery] = useState('');

  // Re-translate confirm modal
  const [showConfirmRetranslate, setShowConfirmRetranslate] = useState(false);

  // Submit Generation Job (Single Episode)
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

  // Auto-refresh when job completes to land directly in editor
  useEffect(() => {
    if (activeJob && (activeJob.status === 'completed' || activeJob.progress >= 100)) {
      const timer = setTimeout(() => {
        if (onRefreshSeries) onRefreshSeries();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [activeJob?.status, activeJob?.progress, onRefreshSeries]);

  // Selected segment object for right rail inspector
  const selectedSegment = useMemo(() => {
    if (selectedSegmentId === null || selectedSegmentId === undefined) return segments[0] || null;
    return segments.find((s, idx) => s.id === selectedSegmentId || idx === selectedSegmentId) || segments[0] || null;
  }, [segments, selectedSegmentId]);

  const selectedSegmentIndex = useMemo(() => {
    if (!selectedSegment) return -1;
    return segments.findIndex((s) => s.id === selectedSegment.id);
  }, [segments, selectedSegment]);

  // Total overflow segments
  const overflowCount = useMemo(() => {
    return segments.filter((s) => typeof s.audioDurationSec === 'number' && typeof s.durationSec === 'number' && s.audioDurationSec > (s.durationSec + 0.3)).length;
  }, [segments]);

  // ─────────────────────────────────────────────────────────────
  // PART A — INLINE RUN PANEL (When No Script Exists)
  // ─────────────────────────────────────────────────────────────
  if (!hasSegments && !isJobRunning) {
    const displayTitle = selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName || activeEpisode?.title || 'វីដេអូភាគ (Episode Video)';
    const videoDurationSec = videoMetadata?.durationSec || selectedVideo?.durationSec || 0;
    const displayDuration = videoDurationSec > 0 ? formatTimecode(videoDurationSec) : '00:00.00';
    const displayResolution = videoMetadata?.width && videoMetadata?.height ? `${videoMetadata.width}x${videoMetadata.height}` : 'HD 1080p';
    const epNum = activeEpisode?.episodeNumber || (activeEpisode?.id ? String(activeEpisode.id).replace(/\D/g, '') : '1');

    return (
      <div className="script-step-page">
        <div className="script-inline-run-container">
          <div className="script-inline-run-card">
            {/* Key Pool Status Strip */}
            <div className="script-key-status-strip">
              <div className="script-key-status-left">
                <span className="script-key-status-dot" />
                <span>Key Pool: {keyStatus.online}/{keyStatus.total} online • {keyStatus.rpm} RPM</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="script-key-manage-btn"
                  onClick={() => onOpenGeminiRoute && onOpenGeminiRoute()}
                  title="គ្រប់គ្រង Gemini Keys & Quotas"
                >
                  Manage Keys
                </button>
                <button
                  type="button"
                  className="script-secondary-btn"
                  style={{ padding: '3px 8px', fontSize: '0.70rem' }}
                  onClick={() => onOpenGeminiRoute && onOpenGeminiRoute()}
                >
                  <Layers size={11} />
                  <span>Batch & Keys</span>
                </button>
              </div>
            </div>

            {/* Episode Summary Header */}
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

            {/* Translation Configuration Options */}
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

              {dubbingMode === 'recap' && (
                <div className="script-option-field" style={{ gridColumn: 'span 2' }}>
                  <label className="script-option-label">សំឡេងអ្នកសម្រាយ (Narrator Gender):</label>
                  <select
                    value={narratorGender}
                    onChange={(e) => setNarratorGender(e.target.value)}
                    className="script-select-input"
                  >
                    <option value="male">សំឡេងប្រុស (Piseth - Male Narrator)</option>
                    <option value="female">សំឡេងស្រី (Sreymom - Female Narrator)</option>
                  </select>
                </div>
              )}
            </div>

            {submitError && (
              <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 6, color: '#f87171', fontSize: '0.78rem' }}>
                {submitError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="script-actions-section">
              <button
                type="button"
                className="script-primary-run-btn"
                disabled={isSubmitting}
                onClick={() => handleExecuteTranslate(false)}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>កំពុងចាប់ផ្ដើម...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={18} strokeWidth={2.2} />
                    <span>✦ បង្កើត Script & បកប្រែ</span>
                  </>
                )}
              </button>

              <div className="script-secondary-actions-row">
                <button
                  type="button"
                  className="script-secondary-btn"
                  onClick={() => onAddSegment && onAddSegment(0)}
                  title="បង្កើតបន្ទាត់សន្ទនាដំបូងដោយដៃ"
                >
                  <Plus size={14} />
                  <span>+ Add Line (manual)</span>
                </button>

                <button
                  type="button"
                  className="script-secondary-btn"
                  onClick={() => onOpenGeminiRoute && onOpenGeminiRoute()}
                  title="បើក Batch Runner សម្រាប់ Translate ច្រើនភាគព្រមគ្នា"
                >
                  <Layers size={14} />
                  <span>Batch Console (ច្រើនភាគ)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // PART A.1 (STAGED PROGRESS VIEW) — Job Running Inline
  // ─────────────────────────────────────────────────────────────
  if (isJobRunning && !hasSegments) {
    const rawProgress = Math.min(100, Math.max(0, Number(activeJob?.progress || 0)));
    const stage = activeJob?.currentStage || 'running';
    const message = activeJob?.stageMessage || 'ដំណើរការ AI ASR / Vision OCR Pipeline...';
    const logs = Array.isArray(activeJob?.logs) ? activeJob.logs : [];

    return (
      <div className="script-step-page">
        <div className="script-inline-run-container">
          <div className="script-inline-run-card" style={{ maxWidth: 640 }}>
            {/* Progress Box */}
            <div className="script-progress-box">
              <div className="script-progress-header">
                <div className="script-progress-stage-info">
                  <Loader2 size={16} className="animate-spin" />
                  <span>{message}</span>
                </div>
                <span className="script-progress-percent">{rawProgress}%</span>
              </div>

              {/* Progress Bar */}
              <div className="script-progress-bar-bg">
                <div
                  className="script-progress-bar-fill"
                  style={{ width: `${rawProgress}%` }}
                />
              </div>

              {/* 4 Milestones */}
              <div className="script-milestones-row">
                <div className={`script-milestone-pill ${rawProgress >= 20 ? 'completed' : 'active'}`}>
                  {rawProgress >= 20 ? '✓ Ingest' : '1. Ingest'}
                </div>
                <div className={`script-milestone-pill ${rawProgress >= 50 ? 'completed' : rawProgress >= 20 ? 'active' : 'pending'}`}>
                  {rawProgress >= 50 ? '✓ Video OCR' : '2. Video OCR'}
                </div>
                <div className={`script-milestone-pill ${rawProgress >= 75 ? 'completed' : rawProgress >= 50 ? 'active' : 'pending'}`}>
                  {rawProgress >= 75 ? '✓ Gemini ASR' : '3. Gemini ASR'}
                </div>
                <div className={`script-milestone-pill ${rawProgress >= 100 ? 'completed' : rawProgress >= 75 ? 'active' : 'pending'}`}>
                  {rawProgress >= 100 ? '✓ Khmer Script' : '4. Script'}
                </div>
              </div>

              {/* Console Logs Preview */}
              <div style={{
                background: '#090d16',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: 6,
                padding: '8px 10px',
                maxHeight: 120,
                overflowY: 'auto',
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                fontSize: '0.66rem',
                color: '#cbd5e1',
                lineHeight: 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}>
                {logs.length > 0 ? (
                  logs.slice(-8).map((l, i) => (
                    <div key={i} style={{ color: l.message?.includes('Error') ? '#f87171' : '#94a3b8' }}>
                      [{l.timestamp || 'Live'}] {l.message || l.stage}
                    </div>
                  ))
                ) : (
                  <div style={{ color: '#64748b' }}>
                    [Live] កំពុងដំណើរការ Route Worker (Key #{activeJob.assignedKeyNum || 1})...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // PART B — TRANSCRIPT-FIRST SCRIPT EDITOR VIEW (Script Exists)
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="script-step-page">
      {/* Top Toolbar */}
      <div className="script-editor-toolbar">
        {/* Left Actions */}
        <div className="script-toolbar-left">
          <button
            type="button"
            className="script-toolbar-btn retranslate"
            onClick={() => setShowConfirmRetranslate(true)}
            title="Translate ភាគនេះឡើងវិញ (Re-Translate Overwrite)"
          >
            <RotateCcw size={13} />
            <span>Re-Translate</span>
          </button>

          <div className="script-toolbar-divider" />

          {onAutoAlignNoOverlap && (
            <button
              type="button"
              className="script-toolbar-btn"
              onClick={onAutoAlignNoOverlap}
              title="តម្រៀប timing ដោយស្វ័យប្រវត្តិកុំឱ្យជាន់គ្នា"
            >
              <span>Auto-Align</span>
            </button>
          )}

          {onResetToSourceTiming && (
            <button
              type="button"
              className="script-toolbar-btn"
              onClick={onResetToSourceTiming}
              title="Reset timing ទៅតាមវីដេអូដើម"
            >
              <span>Reset Timing</span>
            </button>
          )}

          <div className="script-toolbar-divider" />

          <button
            type="button"
            className="script-toolbar-btn"
            onClick={() => onAddSegment && onAddSegment(currentTime || 0)}
            title="បន្ថែមបន្ទាត់សន្ទនាថ្មីនៅត្រង់ Playhead"
          >
            <Plus size={13} />
            <span>+ Add Line</span>
          </button>

          <div className="script-toolbar-divider" />

          {onUndo && (
            <button
              type="button"
              className="script-toolbar-btn"
              disabled={!canUndo}
              onClick={onUndo}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={13} />
            </button>
          )}

          {onRedo && (
            <button
              type="button"
              className="script-toolbar-btn"
              disabled={!canRedo}
              onClick={onRedo}
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={13} />
            </button>
          )}
        </div>

        {/* Right Status & Search */}
        <div className="script-toolbar-right">
          {/* Search box */}
          <div className="script-search-box">
            <Search size={13} color="#64748b" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ស្វែងរកឃ្លា..."
              className="script-search-input"
            />
          </div>

          {/* Counts */}
          <span className="script-badge-pill">
            Segments: {segments.length}
          </span>

          {overflowCount > 0 && (
            <span className="script-badge-pill" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
              OVER: {overflowCount}
            </span>
          )}

          {/* Key Pool Strip + Batch Console Launcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.70rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="script-key-status-dot" />
              <span>{keyStatus.online}/{keyStatus.total} Keys</span>
            </span>

            <button
              type="button"
              className="script-toolbar-btn"
              onClick={() => onOpenGeminiRoute && onOpenGeminiRoute()}
              title="បើក Batch Console & Quota Manager"
            >
              <Layers size={12} />
              <span>Batch & Keys</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="script-editor-workspace">
        {/* Main Column: Shared Virtualized Segment List */}
        <div className="script-main-column">
          <TranscriptSegmentList
            segments={segments}
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={onSelectSegment}
            onUpdateSegments={onUpdateSegments}
            onUpdateScript={onUpdateScript}
            onRegenerateSegment={onRegenerateSegment}
            onDeleteSegment={onDeleteSegment}
            onToggleDeliveryType={onToggleDeliveryType}
            searchQuery={searchQuery}
          />
        </div>

        {/* Right Rail: Compact Video + Seek Strip + Clip Inspector */}
        <div className="script-right-rail">
          {/* Compact Video Player Monitor */}
          <div className="script-rail-video-container">
            <VideoPlayerPreview
              selectedVideo={selectedVideo}
              seriesId={seriesId}
              episodeId={episodeId}
              scriptData={scriptData}
              videoRef={videoRef}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              onSeek={onSeek}
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMetadata}
              onEnded={onEnded}
              voiceSettings={voiceSettings}
              fullAudioUrl={fullAudioUrl}
              audioGenerated={audioGenerated}
              audioOutdated={audioOutdated}
              onVideoSelected={onVideoSelected}
              videoClips={videoClips}
            />
          </div>

          {/* Thin Seek Strip */}
          <ThinSeekStrip
            currentTime={currentTime}
            duration={duration}
            segments={segments}
            selectedSegmentId={selectedSegmentId}
            onSeek={onSeek}
            onSelectSegment={onSelectSegment}
          />

          {/* Selected-Segment Inspector */}
          <div className="script-rail-inspector-scroll">
            {selectedSegment ? (
              <ClipInspectorPanel
                isOpen={true}
                selectedSegment={selectedSegment}
                selectedSegmentIndex={selectedSegmentIndex}
                onSegmentTextChange={(text) => {
                  if (onUpdateSegmentText) {
                    onUpdateSegmentText(selectedSegment.id || selectedSegmentIndex, text);
                  }
                }}
                onSegmentTextBlur={(text) => {
                  if (onUpdateSegmentText) {
                    onUpdateSegmentText(selectedSegment.id || selectedSegmentIndex, text, false, selectedSegmentIndex);
                  }
                }}
                onSingleRegen={onRegenerateSegment}
                onClipVoiceChange={onUpdateSegmentVoice}
                onUpdateSpeakerVoice={onUpdateSpeakerVoice}
                onToggleDeliveryType={onToggleDeliveryType}
                onDeleteSegment={onDeleteSegment}
                currentTime={currentTime}
                scriptData={scriptData}
                onSelectSegment={onSelectSegment}
                settings={voiceSettings}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b', fontSize: '0.78rem' }}>
                <p>ចុចលើឃ្លាសន្ទនាណាមួយដើម្បីពិនិត្យ និងកំណត់សំឡេង (Click segment to inspect)</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Re-Translate Overwrite */}
      {showConfirmRetranslate && (
        <div className="script-confirm-modal-overlay" onClick={() => setShowConfirmRetranslate(false)}>
          <div className="script-confirm-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="script-confirm-title">
              <AlertTriangle size={18} />
              <span>បញ្ជាក់ការ Re-Translate (Confirm Overwrite)</span>
            </h3>
            <p className="script-confirm-desc">
              ⚠️ ដំណើរការនេះនឹងលុប Script និង Subtitle ដែលបានកែប្រែដោយដៃចោល ហើយបង្កើត Subtitle ថ្មីឡើងវិញ។
              <br /><br />
              • Script ចាស់នឹងត្រូវ Auto-Backup ទុកក្នុង folder backups។
              <br />
              • តើអ្នកពិតជាចង់បន្តមែនទេ?
            </p>
            <div className="script-confirm-actions">
              <button
                type="button"
                className="script-confirm-cancel-btn"
                onClick={() => setShowConfirmRetranslate(false)}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                className="script-confirm-ok-btn"
                onClick={() => handleExecuteTranslate(true)}
              >
                បាទ/ចាស, Re-Translate ឥឡូវនេះ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
