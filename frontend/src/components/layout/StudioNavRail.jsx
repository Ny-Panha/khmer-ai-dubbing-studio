import React, { useContext } from 'react';
import {
  Home,
  Film,
  Layers,
  Download,
  Cpu,
  Activity,
  HelpCircle,
} from 'lucide-react';
import { useGeminiQuotaMonitor } from '../../hooks/useGeminiQuotaMonitor';
import { JobQueueContext } from '../../context/jobQueueStore';
import { useDubbingRunnerContext } from '../../features/dubbing-runner/DubbingRunnerContext';
import './StudioNavRail.css';

function StudioNavRail({
  currentRoute = '/studio',
  onNavigateRoute = null,
  onOpenGeminiRoute = null,
  onOpenBatchExportStudio = null,
  onOpenGeminiQuota = null,
  onOpenJobDashboard = null,
  onOpenShortcuts = null,
  isGeminiRouteActive = false,
  isBatchExportStudioActive = false,
  isGeminiQuotaActive = false,
  isJobDashboardActive = false,
  activeSeries = null,
  batchRender = null,
  activeJobCount = 0,
}) {
  const { keysHealth } = useGeminiQuotaMonitor({ enabled: false });
  const jobQueue = useContext(JobQueueContext);
  const queueStats = jobQueue?.stats || null;
  const effectiveActiveJobCount =
    activeJobCount || ((queueStats?.runningCount || 0) + (queueStats?.queuedCount || 0));

  const runnerContext = useDubbingRunnerContext();
  const runnerStates = runnerContext?.runnerStates || {};
  const contextActiveSeriesId = runnerContext?.activeSeriesId || activeSeries?.id || null;
  // Show a running runner even when it belongs to another folder, but label that folder in the title.
  const runningRunnerJob = (() => {
    const stepOrder = ['clean_bgm', 'voice', 'translate', 'repair', 'all3'];
    const activeStep = stepOrder.find((step) => runnerStates[step]?.status === 'running');
    if (activeStep) {
      return { stepType: activeStep, state: runnerStates[activeStep], seriesId: contextActiveSeriesId };
    }
    const allRunnerStates = runnerContext?.allRunnerStates;
    if (!allRunnerStates || typeof allRunnerStates !== 'object') return null;
    for (const [seriesId, steps] of Object.entries(allRunnerStates)) {
      const otherStep = stepOrder.find((step) => steps?.[step]?.status === 'running');
      if (otherStep) return { stepType: otherStep, state: steps[otherStep], seriesId };
    }
    return null;
  })();
  const activeRunnerStep = runningRunnerJob?.stepType || null;
  const activeRunnerState = runningRunnerJob?.state || null;
  const isRunnerFromInactiveFolder = Boolean(
    runningRunnerJob?.seriesId &&
    contextActiveSeriesId &&
    String(runningRunnerJob.seriesId) !== String(contextActiveSeriesId)
  );

  const episodesCount = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes.length : 0;
  const batchJob = batchRender?.job || null;
  const isBatchExportRunning = Boolean(batchRender?.isRunning || batchJob?.status === 'running');
  const quotaSummary = keysHealth?.quotaSummary || null;
  const readyKeys = quotaSummary?.readyKeys ?? 0;
  const totalKeys = quotaSummary?.totalKeys ?? 0;

  const isAnyOverlayRouteActive =
    isGeminiRouteActive || isBatchExportStudioActive || isGeminiQuotaActive || isJobDashboardActive;
  const isHomeActive = currentRoute === '/home' && !isAnyOverlayRouteActive;
  const isStudioActive = currentRoute === '/studio' && !isAnyOverlayRouteActive;

  const handleRouteClick = (e, fn, fallbackRoute) => {
    e.preventDefault();
    e.stopPropagation();
    if (fn) {
      fn();
    } else if (onNavigateRoute && fallbackRoute) {
      onNavigateRoute(fallbackRoute);
    }
  };

  return (
    <aside className="studio-nav-rail" aria-label="Studio Navigation Rail">
      <div className="nav-rail-group nav-rail-primary">
        <button
          type="button"
          data-testid="navbar-home-route-btn"
          className={`nav-rail-item ${isHomeActive ? 'active' : ''}`}
          aria-current={isHomeActive ? 'page' : undefined}
          onClick={(e) => handleRouteClick(e, () => onNavigateRoute?.('/home'), '/home')}
          title="ទំព័រដើម (Home Dashboard)"
        >
          <Home size={18} />
          <span className="nav-rail-label">Home</span>
        </button>

        <button
          type="button"
          data-testid="navbar-studio-route-btn"
          className={`nav-rail-item ${isStudioActive ? 'active' : ''}`}
          aria-current={isStudioActive ? 'page' : undefined}
          onClick={(e) => handleRouteClick(e, () => onNavigateRoute?.('/studio'), '/studio')}
          title="ផ្ទាំងកាត់ត (Studio Editor & Timeline)"
        >
          <Film size={18} />
          <span className="nav-rail-label">Studio</span>
        </button>

        <button
          type="button"
          data-testid="navbar-batch-generate-btn"
          className={`nav-rail-item ${isGeminiRouteActive ? 'active' : ''} ${activeRunnerStep ? 'is-running' : ''}`}
          aria-current={isGeminiRouteActive ? 'page' : undefined}
          onClick={(e) => handleRouteClick(e, onOpenGeminiRoute, '/batch')}
          title={
            activeRunnerStep
              ? `Batch Studio — កំពុងដំណើរការ ${activeRunnerStep} (${activeRunnerState?.progress || 0}%)${isRunnerFromInactiveFolder ? ` • Folder: ${runningRunnerJob.seriesId}` : ''}`
              : `Batch Dubbing Studio (${episodesCount} ភាគ)`
          }
        >
          <Layers size={18} className={activeRunnerStep ? 'animate-pulse' : ''} />
          <span className="nav-rail-label">Batch</span>
          {activeRunnerStep ? (
            <span className="nav-rail-badge is-live">{activeRunnerState?.progress || 0}%</span>
          ) : episodesCount > 0 ? (
            <span className="nav-rail-badge">{episodesCount}</span>
          ) : null}
        </button>

        <button
          type="button"
          data-testid="open-batch-export-studio-btn"
          className={`nav-rail-item ${isBatchExportStudioActive ? 'active' : ''} ${isBatchExportRunning ? 'is-running' : ''}`}
          aria-current={isBatchExportStudioActive ? 'page' : undefined}
          disabled={episodesCount === 0}
          onClick={(e) => handleRouteClick(e, onOpenBatchExportStudio, '/export')}
          title="Export Studio — Render & Merge គ្រប់ភាគ"
        >
          <Download size={18} />
          <span className="nav-rail-label">Export</span>
          {isBatchExportRunning && (
            <span className="nav-rail-badge is-live">{batchJob?.progress || 0}%</span>
          )}
        </button>

        <button
          type="button"
          data-testid="navbar-jobs-btn"
          className={`nav-rail-item ${isJobDashboardActive ? 'active' : ''}`}
          aria-current={isJobDashboardActive ? 'page' : undefined}
          onClick={(e) => handleRouteClick(e, onOpenJobDashboard, '/jobs')}
          title="Job Queue Dashboard — តាមដានដំណើរការ Background"
        >
          <Cpu size={18} />
          <span className="nav-rail-label">Jobs</span>
          {effectiveActiveJobCount > 0 && (
            <span className="nav-rail-badge is-live">{effectiveActiveJobCount}</span>
          )}
        </button>
      </div>

      <div className="nav-rail-group nav-rail-footer">
        <button
          type="button"
          data-testid="navbar-keys-quota-btn"
          className={`nav-rail-item ${isGeminiQuotaActive ? 'active' : ''}`}
          aria-current={isGeminiQuotaActive ? 'page' : undefined}
          onClick={(e) => handleRouteClick(e, onOpenGeminiQuota, '/quota')}
          title={`Gemini API Keys Pool & Quota (${totalKeys > 0 ? `${readyKeys}/${totalKeys} Ready` : 'Manage Keys'})`}
        >
          <Activity size={18} />
          <span className="nav-rail-label">Keys</span>
          {totalKeys > 0 && (
            <span className={`nav-rail-badge ${readyKeys === 0 ? 'is-warn' : ''}`}>
              {readyKeys}/{totalKeys}
            </span>
          )}
        </button>

        {onOpenShortcuts && (
          <button
            type="button"
            className="nav-rail-item nav-rail-shortcuts-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenShortcuts();
            }}
            aria-label="Keyboard Shortcuts"
            title="Keyboard Shortcuts (Ctrl+/)"
          >
            <HelpCircle size={17} />
            <span className="nav-rail-label">Help</span>
          </button>
        )}
      </div>
    </aside>
  );
}

export default React.memo(StudioNavRail);
