import React, { useState, useContext, useEffect } from 'react';
import { 
  Key, HelpCircle, Download, Loader2, RotateCcw, X, Trash2, Film, Plus, Cpu, Layers, Activity,
  PanelLeft, PanelRight, PanelBottom
} from 'lucide-react';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';
import { useGeminiQuotaMonitor, runQuotaCheck } from '../../hooks/useGeminiQuotaMonitor';
import { JobQueueContext } from '../../context/jobQueueStore';
import ShortcutsModal from './ShortcutsModal';
import './Navbar.css';

export default function Navbar({
  apiKey,
  onSaveApiKey,
  isBackendOnline,
  selectedVideo,
  onRenderVideo,
  isRendering,
  renderProgress = 0,
  renderedVideo,
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  generatingEpisodeId = null,
  generatingAudioEpisodeId = null,
  onSwitchEpisode = null,
  onCreateEpisode = null,
  onDeleteEpisode = null,
  onResetAllEpisodes = null,
  activeTab = 'media',
  onTabChange = null,
  onOpenJobDashboard = null,
  onOpenGeminiRoute = null,
  onOpenGeminiQuota = null,
  onOpenBatchExportStudio = null,
  isGeminiRouteActive = false,
  isGeminiQuotaActive = false,
  isBatchExportStudioActive = false,
  isJobDashboardActive = false,
  batchRender = null,
  activeJobCount = 0,
  currentAspectRatio = '16:9',
  onAspectRatioChange = null,
  isLeftCollapsed = false,
  isRightCollapsed = false,
  isTimelineCollapsed = false,
  onToggleLeftPanel = null,
  onToggleRightPanel = null,
  onToggleTimelinePanel = null,
}) {
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey || '');
  const { keysHealth } = useGeminiQuotaMonitor({ enabled: false });
  useEffect(() => {
    if (isBackendOnline && !keysHealth) {
      runQuotaCheck('stats');
    }
  }, [isBackendOnline, keysHealth]);
  const jobQueue = useContext(JobQueueContext);
  const queueStats = jobQueue?.stats || null;
  const effectiveActiveJobCount = activeJobCount || ((queueStats?.runningCount || 0) + (queueStats?.queuedCount || 0));

  const handleSave = (e) => {
    e.preventDefault();
    onSaveApiKey(tempKey);
    setShowKeyModal(false);
  };

  const episodesCount = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes.length : 0;
  const batchJob = batchRender?.job || null;
  const isBatchRunning = Boolean(batchRender?.isRunning || batchJob?.status === 'running');
  const quotaSummary = keysHealth?.quotaSummary || null;
  const keysChipText = quotaSummary && (quotaSummary.totalKeys || 0) > 0
    ? `${quotaSummary.readyKeys}/${quotaSummary.totalKeys} Keys`
    : 'Keys';

  return (
    <>
      <header className="capcut-navbar">
        {/* Left: Brand Mark, Batch Generate, Keys & Quota, and Jobs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="concat-app-mark" title="DragonDub AI Studio">
            <span>D</span>
          </div>

          <button
            type="button"
            data-testid="navbar-batch-generate-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onOpenGeminiRoute) onOpenGeminiRoute();
            }}
            className={`navbar-gemini-route-btn ${isGeminiRouteActive ? 'active' : ''}`}
            title="Batch Generate Studio (Translate, Khmer AI Voice, Demucs & Batch Export)"
          >
            <Layers size={14} />
            <span>Batch Generate</span>
            <span className="gemini-badge-chip">{episodesCount > 0 ? `${episodesCount} EPs` : 'Batch'}</span>
          </button>

          {onOpenGeminiQuota && (
            <button
              type="button"
              data-testid="navbar-keys-quota-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenGeminiQuota();
              }}
              className={`navbar-gemini-route-btn ${isGeminiQuotaActive ? 'active' : ''}`}
              title="Gemini API Keys Pool & Model Rate Limits (RPM / TPM / RPD & Pin Primary Model)"
            >
              <Activity size={14} />
              <span>Keys &amp; Quota</span>
              <span className="gemini-badge-chip">{keysChipText}</span>
            </button>
          )}

          {onOpenJobDashboard && (
            <button
              type="button"
              data-testid="navbar-jobs-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenJobDashboard();
              }}
              className={`navbar-gemini-route-btn ${isJobDashboardActive ? 'active' : ''}`}
              title="Job Queue Dashboard (Production Pipeline Monitor)"
            >
              <Cpu size={14} />
              <span>Jobs</span>
              {effectiveActiveJobCount > 0 && (
                <span className="gemini-badge-chip">
                  {effectiveActiveJobCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Right: Actions, Shortcuts, Key & Export CTA */}
        <div className="navbar-right-actions">
          {/* Workspace Panel Collapse / Expand Toggles (Laptop 1366x768 & 1440x900) */}
          {(onToggleLeftPanel || onToggleTimelinePanel || onToggleRightPanel) && (
            <div
              className="navbar-aspect-toggle"
              role="group"
              aria-label="Workspace Panel Toggles"
              title="បិទ/បើកផ្ទាំងការងារ (Left Media | Bottom Timeline | Right Inspector)"
            >
              {onToggleLeftPanel && (
                <button
                  type="button"
                  data-testid="toggle-left-panel-btn"
                  onClick={onToggleLeftPanel}
                  aria-pressed={!isLeftCollapsed}
                  className={`navbar-aspect-btn ${!isLeftCollapsed ? 'active' : ''}`}
                  title={isLeftCollapsed ? 'បើកផ្ទាំងឆ្វេង (Show Left Media Library)' : 'បង្រួមផ្ទាំងឆ្វេង (Collapse Left Panel)'}
                >
                  <PanelLeft size={13} />
                </button>
              )}
              {onToggleTimelinePanel && (
                <button
                  type="button"
                  data-testid="toggle-timeline-panel-btn"
                  onClick={onToggleTimelinePanel}
                  aria-pressed={!isTimelineCollapsed}
                  className={`navbar-aspect-btn ${!isTimelineCollapsed ? 'active' : ''}`}
                  title={isTimelineCollapsed ? 'បើកផ្ទាំង Timeline ខាងក្រោម (Show Timeline)' : 'បង្រួមផ្ទាំង Timeline (Collapse Timeline)'}
                >
                  <PanelBottom size={13} />
                </button>
              )}
              {onToggleRightPanel && (
                <button
                  type="button"
                  data-testid="toggle-right-panel-btn"
                  onClick={onToggleRightPanel}
                  aria-pressed={!isRightCollapsed}
                  className={`navbar-aspect-btn ${!isRightCollapsed ? 'active' : ''}`}
                  title={isRightCollapsed ? 'បើកផ្ទាំងស្តាំ (Show Right Inspector)' : 'បង្រួមផ្ទាំងស្តាំ (Collapse Right Inspector)'}
                >
                  <PanelRight size={13} />
                </button>
              )}
            </div>
          )}

          {/* Quick Aspect Ratio Switcher (16:9 Landscape / 9:16 Portrait) — Syncs Preview & Auto Export */}
          <div
            className="navbar-aspect-toggle"
            role="group"
            aria-label="Preview and Export Aspect Ratio"
            title={`ទម្រង់វីដេអូ (Preview & Auto Export): ${currentAspectRatio}`}
          >
            <button
              type="button"
              onClick={() => onAspectRatioChange?.('16:9')}
              disabled={isRendering}
              aria-pressed={currentAspectRatio === '16:9'}
              className={`navbar-aspect-btn ${currentAspectRatio === '16:9' ? 'active' : ''}`}
              title="16:9 Landscape (ផ្ដេក — YouTube / Facebook)"
            >
              <span className="aspect-icon aspect-icon-16-9" aria-hidden="true" />
              <span>16:9</span>
            </button>
            <button
              type="button"
              onClick={() => onAspectRatioChange?.('9:16')}
              disabled={isRendering}
              aria-pressed={currentAspectRatio === '9:16'}
              className={`navbar-aspect-btn ${currentAspectRatio === '9:16' ? 'active' : ''}`}
              title="9:16 Portrait (បញ្ឈរ — TikTok / Reels / Shorts)"
            >
              <span className="aspect-icon aspect-icon-9-16" aria-hidden="true" />
              <span>9:16</span>
            </button>
          </div>

          {/* Backend Online status chip */}
          <div className={`status-chip ${isBackendOnline ? 'online' : 'offline'}`} title={isBackendOnline ? 'FFmpeg backend is running' : 'Backend server offline'}>
            <span className="status-dot" />
            <span>{isBackendOnline ? 'FFmpeg Online' : 'Backend Offline'}</span>
          </div>

          {/* Gemini API Key Configuration */}
          <button
            type="button"
            onClick={() => setShowKeyModal(true)}
            className={`api-key-btn ${apiKey ? 'configured' : 'missing'}`}
            title="Configure Gemini AI API Key"
          >
            <Key size={13} />
            <span>{apiKey ? 'API Key Configured' : 'Set Gemini Key'}</span>
          </button>

          {/* Keyboard Shortcuts */}
          <button
            type="button"
            onClick={() => setShowShortcutsModal(true)}
            className="navbar-icon-btn"
            title="Keyboard Shortcuts (Ctrl+/)"
          >
            <HelpCircle size={14} />
          </button>

          {/* Header Export / Download Action */}
          {isRendering ? (
            <button
              disabled
              className="navbar-export-btn"
              style={{
                opacity: 0.95,
                cursor: 'wait',
                position: 'relative',
                overflow: 'hidden',
                background: 'rgba(30, 41, 59, 0.9)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
              }}
              title="Rendering Final Video with FFmpeg..."
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: `${renderProgress || 5}%`,
                  background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.35), rgba(6, 182, 212, 0.45))',
                  transition: 'width 0.25s ease-out',
                }}
              />
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={13} className="animate-spin" style={{ color: '#38bdf8' }} />
                <span>Rendering {renderProgress ? `${renderProgress}%` : '...'}</span>
              </div>
            </button>
          ) : renderedVideo ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <a
                href={typeof renderedVideo === 'string' ? renderedVideo : (renderedVideo.downloadUrl || renderedVideo.outputVideoUrl)}
                download={
                  renderedVideo?.outputFilename ||
                  (selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName
                    ? `${(selectedVideo.displayTitle || selectedVideo.originalFilename || selectedVideo.fileName).replace(/\.[^/.]+$/, '').trim()}_Khmer_Dubbed.mp4`
                    : 'Dubbed_Video_Khmer.mp4')
                }
                className="navbar-export-btn download-ready"
                title={`Download Rendered Video: ${selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName ? (selectedVideo.displayTitle || selectedVideo.originalFilename || selectedVideo.fileName).replace(/\.[^/.]+$/, '').trim() + '_Khmer_Dubbed.mp4' : 'Dubbed Video'}`}
              >
                <Download size={14} />
                <span>Download MP4</span>
              </a>
              <button
                type="button"
                onClick={onRenderVideo}
                disabled={!selectedVideo}
                className="navbar-icon-btn"
                title="Re-Export Video"
                style={{ height: 28, padding: '0 8px', borderRadius: 'var(--radius-xs)', border: '1px solid #334155' }}
              >
                <RotateCcw size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onRenderVideo}
              disabled={!selectedVideo}
              className="navbar-export-btn"
              title="Render and Export Video with Audio Ducking & Subtitles"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
          )}

          {onOpenBatchExportStudio && (
            <button
              type="button"
              data-testid="open-batch-export-studio-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenBatchExportStudio();
              }}
              disabled={episodesCount === 0}
              className={`navbar-gemini-route-btn ${isBatchExportStudioActive ? 'active' : ''}`}
              style={{
                borderColor: isBatchRunning ? 'rgba(56, 189, 248, 0.6)' : 'rgba(56, 189, 248, 0.35)',
                color: '#E0F2FE',
                background: isBatchExportStudioActive ? 'rgba(2, 132, 199, 0.24)' : 'rgba(14, 165, 233, 0.12)',
              }}
              title="Export Studio — Batch Export & Merge គ្រប់ភាគ"
            >
              <Layers size={14} style={{ color: '#38BDF8' }} />
              <span>Batch Export</span>
              <span
                className="gemini-badge-chip"
                style={{
                  borderColor: 'rgba(56, 189, 248, 0.35)',
                  color: '#38BDF8',
                  background: 'rgba(15, 23, 42, 0.7)',
                }}
              >
                {isBatchRunning ? `${batchJob?.progress || 0}%` : `${episodesCount} ភាគ`}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* Shortcuts Modal */}
      <ShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="modal-backdrop" onClick={() => setShowKeyModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Key size={18} color="var(--accent-cyan)" />
              <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#fff' }}>
                Gemini AI API Key
              </h3>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              ប្រើប្រាស់ Google Gemini 3.8 Flash សម្រាប់វិភាគសំឡេងវីដេអូដើម និងសរសេរអត្ថបទសម្រាយរឿងខ្មែរ។
            </p>
            <input
              type="password"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              placeholder="AIzaSy..."
              className="capcut-input"
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="btn-secondary"
                style={{ fontSize: '0.78rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="btn-primary"
                style={{ fontSize: '0.78rem' }}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
