import React, { useState, useEffect, useRef } from 'react';
import {
  Download,
  Loader2,
  RotateCcw,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  PanelLeft,
  PanelRight,
  PanelBottom,
} from 'lucide-react';
import { useGeminiQuotaMonitor, runQuotaCheck } from '../../hooks/useGeminiQuotaMonitor';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';
import ShortcutsModal from './ShortcutsModal';
import './Navbar.css';

function cleanSeriesTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return 'DragonDub Studio';
  let t = rawTitle.trim();
  if (isCorruptedOrMojibakeTitle(t)) return 'DragonDub Studio';
  t = t.replace(/\s+p\d+.*$/i, '').replace(/\s*\[BV[a-zA-Z0-9]+.*$/i, '').trim();
  if (t.length > 36) {
    t = `${t.slice(0, 35)}…`;
  }
  return t || 'DragonDub Studio';
}

function formatShortEpLabel(ep, idx) {
  const num = ep?.episodeNumber || idx + 1;
  const raw = String(ep?.title || ep?.displayTitle || '').trim();
  if (!raw || isCorruptedOrMojibakeTitle(raw)) return `EP ${num}`;
  const stripped = raw
    .replace(/^ភាគទី\s*\d+\s*:\s*/i, '')
    .replace(/^ភាគទី\s*\d+\s*/i, '')
    .replace(/^\(EP\d+\)$/i, '')
    .trim();
  return stripped && stripped !== `ភាគទី ${num}` ? `EP ${num} — ${stripped.slice(0, 22)}` : `EP ${num}`;
}

export default function Navbar({
  isBackendOnline,
  selectedVideo,
  onRenderVideo,
  isRendering,
  renderProgress = 0,
  renderedVideo,
  activeSeries = null,
  activeEpisode = null,
  episodeId = null,
  onSwitchEpisode = null,
  onOpenBatchExportStudio = null,
  batchRender = null,
  currentAspectRatio = '16:9',
  onAspectRatioChange = null,
  isLeftCollapsed = false,
  isRightCollapsed = false,
  isTimelineCollapsed = false,
  onToggleLeftPanel = null,
  onToggleRightPanel = null,
  onToggleTimelinePanel = null,
  currentRoute = '/studio',
  onNavigateRoute = null,
  showShortcutsModal: externalShowShortcuts = false,
  onCloseShortcutsModal = null,
}) {
  const [internalShowShortcuts, setInternalShowShortcuts] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  const showShortcuts = Boolean(externalShowShortcuts || internalShowShortcuts);
  const handleCloseShortcuts = () => {
    setInternalShowShortcuts(false);
    if (onCloseShortcutsModal) onCloseShortcutsModal();
  };

  // Warm quota stats quietly once backend is online so NavRail Keys badge stays accurate
  const { keysHealth } = useGeminiQuotaMonitor({ enabled: false });
  useEffect(() => {
    if (isBackendOnline && !keysHealth) {
      runQuotaCheck('stats');
    }
  }, [isBackendOnline, keysHealth]);

  // Close Export dropdown on outside click or Escape
  useEffect(() => {
    if (!showExportMenu) return undefined;
    const onDown = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowExportMenu(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [showExportMenu]);

  const episodes = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes : [];
  const episodesCount = episodes.length;
  const activeEpIdx = episodes.findIndex((e) => String(e.id) === String(episodeId || activeEpisode?.id));
  const safeEpIdx = activeEpIdx >= 0 ? activeEpIdx : 0;
  const canPrevEp = episodesCount > 1 && safeEpIdx > 0;
  const canNextEp = episodesCount > 1 && safeEpIdx < episodesCount - 1;

  const batchJob = batchRender?.job || null;
  const isBatchRunning = Boolean(batchRender?.isRunning || batchJob?.status === 'running');
  const isStudioView = currentRoute === '/studio';

  const downloadFilename =
    renderedVideo?.outputFilename ||
    (selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName
      ? `${(selectedVideo.displayTitle || selectedVideo.originalFilename || selectedVideo.fileName)
          .replace(/\.[^/.]+$/, '')
          .trim()}_Khmer_Dubbed.mp4`
      : 'Dubbed_Video_Khmer.mp4');

  return (
    <>
      <header className="capcut-navbar">
        {/* Left: Brand Mark + Active Series Breadcrumb + Inline Episode Switcher */}
        <div className="navbar-left-context">
          <button
            type="button"
            onClick={() => onNavigateRoute?.('/home')}
            className="concat-app-mark"
            aria-label="DragonDub AI Studio Home"
            title="DragonDub AI Studio — Go to Home (/home)"
          >
            <span>D</span>
          </button>

          <span className="navbar-brand-title" title={activeSeries?.title || 'DragonDub AI Studio'}>
            {cleanSeriesTitle(activeSeries?.title)}
          </span>

          {episodesCount > 0 && onSwitchEpisode && (
            <div className="navbar-ep-switcher" role="group" aria-label="Episode Switcher">
              <span className="navbar-crumb-sep" aria-hidden="true">/</span>
              <button
                type="button"
                className="navbar-ep-step-btn"
                disabled={!canPrevEp}
                onClick={() => canPrevEp && onSwitchEpisode(episodes[safeEpIdx - 1].id)}
                aria-label="Previous Episode"
                title="ភាគមុន (Previous Episode)"
              >
                <ChevronLeft size={14} />
              </button>

              <select
                data-testid="navbar-episode-select"
                className="navbar-ep-select"
                aria-label="Select Episode"
                value={String(episodeId || activeEpisode?.id || episodes[0]?.id || '')}
                onChange={(e) => onSwitchEpisode(e.target.value)}
              >
                {episodes.map((ep, idx) => (
                  <option key={ep.id} value={String(ep.id)}>
                    {formatShortEpLabel(ep, idx)} ({idx + 1}/{episodesCount})
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="navbar-ep-step-btn"
                disabled={!canNextEp}
                onClick={() => canNextEp && onSwitchEpisode(episodes[safeEpIdx + 1].id)}
                aria-label="Next Episode"
                title="ភាគបន្ទាប់ (Next Episode)"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Right: Focused Studio Controls (Panels, Aspect Ratio, Status, Unified Export) */}
        <div className="navbar-right-actions">
          {isStudioView && (onToggleLeftPanel || onToggleTimelinePanel || onToggleRightPanel) && (
            <div
              className="navbar-aspect-toggle navbar-panel-toggles"
              role="group"
              aria-label="Workspace Panel Toggles"
              title="បិទ/បើកផ្ទាំងការងារ (Left | Bottom | Right)"
            >
              {onToggleLeftPanel && (
                <button
                  type="button"
                  data-testid="toggle-left-panel-btn"
                  onClick={onToggleLeftPanel}
                  aria-pressed={!isLeftCollapsed}
                  aria-label={isLeftCollapsed ? 'Show Left Panel' : 'Collapse Left Panel'}
                  className={`navbar-aspect-btn ${!isLeftCollapsed ? 'active' : ''}`}
                  title={isLeftCollapsed ? 'បើកផ្ទាំងឆ្វេង' : 'បង្រួមផ្ទាំងឆ្វេង'}
                >
                  <PanelLeft size={14} />
                </button>
              )}
              {onToggleTimelinePanel && (
                <button
                  type="button"
                  data-testid="toggle-timeline-panel-btn"
                  onClick={onToggleTimelinePanel}
                  aria-pressed={!isTimelineCollapsed}
                  aria-label={isTimelineCollapsed ? 'Show Timeline' : 'Collapse Timeline'}
                  className={`navbar-aspect-btn ${!isTimelineCollapsed ? 'active' : ''}`}
                  title={isTimelineCollapsed ? 'បើក Timeline ខាងក្រោម' : 'បង្រួម Timeline'}
                >
                  <PanelBottom size={14} />
                </button>
              )}
              {onToggleRightPanel && (
                <button
                  type="button"
                  data-testid="toggle-right-panel-btn"
                  onClick={onToggleRightPanel}
                  aria-pressed={!isRightCollapsed}
                  aria-label={isRightCollapsed ? 'Show Right Inspector' : 'Collapse Right Inspector'}
                  className={`navbar-aspect-btn ${!isRightCollapsed ? 'active' : ''}`}
                  title={isRightCollapsed ? 'បើកផ្ទាំងស្តាំ' : 'បង្រួមផ្ទាំងស្តាំ'}
                >
                  <PanelRight size={14} />
                </button>
              )}
            </div>
          )}

          {/* Quick Aspect Ratio Switcher (16:9 / 9:16) */}
          <div
            className="navbar-aspect-toggle"
            role="group"
            aria-label="Preview and Export Aspect Ratio"
            title={`ទម្រង់វីដេអូ: ${currentAspectRatio}`}
          >
            <button
              type="button"
              onClick={() => onAspectRatioChange?.('16:9')}
              disabled={isRendering}
              aria-pressed={currentAspectRatio === '16:9'}
              className={`navbar-aspect-btn ${currentAspectRatio === '16:9' ? 'active' : ''}`}
              title="16:9 Landscape (YouTube / Facebook)"
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
              title="9:16 Portrait (TikTok / Reels / Shorts)"
            >
              <span className="aspect-icon aspect-icon-9-16" aria-hidden="true" />
              <span>9:16</span>
            </button>
          </div>

          {/* Compact Backend Status Chip */}
          <div
            className={`status-chip ${isBackendOnline ? 'online' : 'offline'}`}
            title={isBackendOnline ? 'FFmpeg Backend Online' : 'Backend Server Offline'}
          >
            <span className="status-dot" />
            <span className="navbar-status-text">{isBackendOnline ? 'Online' : 'Offline'}</span>
          </div>

          {/* Unified Export Split Control (Current EP + Batch Export dropdown) */}
          <div className="navbar-export-split" ref={exportMenuRef}>
            {isRendering ? (
              <button
                type="button"
                disabled
                className="navbar-export-btn is-rendering"
                title="Rendering Final Video with FFmpeg..."
              >
                <div
                  className="navbar-export-progress-fill"
                  style={{ width: `${renderProgress || 5}%` }}
                />
                <span className="navbar-export-btn-inner">
                  <Loader2 size={14} className="animate-spin" />
                  <span>{renderProgress ? `${renderProgress}%` : 'Rendering…'}</span>
                </span>
              </button>
            ) : renderedVideo ? (
              <div className="navbar-export-ready-group">
                <a
                  href={
                    typeof renderedVideo === 'string'
                      ? renderedVideo
                      : renderedVideo.downloadUrl || renderedVideo.outputVideoUrl
                  }
                  download={downloadFilename}
                  className="navbar-export-btn download-ready"
                  title={`Download Rendered Video: ${downloadFilename}`}
                >
                  <Download size={14} />
                  <span>Download MP4</span>
                </a>
                <button
                  type="button"
                  onClick={onRenderVideo}
                  disabled={!selectedVideo}
                  className="navbar-icon-btn navbar-reexport-btn"
                  aria-label="Re-Export Current Episode"
                  title="Render ភាគនេះម្តងទៀត (Re-Export)"
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
                title="Render & Export ភាគបច្ចុប្បន្ន"
              >
                <Download size={14} />
                <span>Export</span>
              </button>
            )}

            {onOpenBatchExportStudio && (
              <button
                type="button"
                className={`navbar-export-caret-btn ${showExportMenu ? 'active' : ''}`}
                onClick={() => setShowExportMenu((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={showExportMenu}
                aria-label="More Export Options"
                title="ជម្រើស Export បន្ថែម (Single / Batch Export)"
              >
                <ChevronDown size={14} />
              </button>
            )}

            {showExportMenu && (
              <div className="navbar-export-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="navbar-export-menu-item"
                  disabled={!selectedVideo || isRendering}
                  onClick={() => {
                    setShowExportMenu(false);
                    onRenderVideo?.();
                  }}
                >
                  <Download size={14} />
                  <div className="navbar-export-menu-copy">
                    <span className="navbar-export-menu-title">Export ភាគនេះ (Single MP4)</span>
                    <span className="navbar-export-menu-sub">Render តែភាគកំពុងបើក ({currentAspectRatio})</span>
                  </div>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="navbar-export-menu-item"
                  disabled={episodesCount === 0}
                  onClick={() => {
                    setShowExportMenu(false);
                    onOpenBatchExportStudio?.();
                  }}
                >
                  <Layers size={14} />
                  <div className="navbar-export-menu-copy">
                    <span className="navbar-export-menu-title">
                      Batch Export &amp; Merge ({isBatchRunning ? `${batchJob?.progress || 0}%` : `${episodesCount} ភាគ`})
                    </span>
                    <span className="navbar-export-menu-sub">បញ្ចេញច្រើនភាគព្រមគ្នា ឬបូកជារឿងពេញ</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <ShortcutsModal isOpen={showShortcuts} onClose={handleCloseShortcuts} />
    </>
  );
}
