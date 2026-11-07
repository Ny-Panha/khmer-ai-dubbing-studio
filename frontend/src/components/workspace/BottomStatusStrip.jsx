import React from 'react';
import { useSharedJobQueue } from '../../context/JobQueueContext';
import { AlertTriangle, Key, Film, Mic, Music, Clapperboard } from 'lucide-react';
import './BottomStatusStrip.css';

export default function BottomStatusStrip({
  activeEpisode = null,
  segmentsCount = 0,
  overCount = 0,
  isGeneratingAudio = false,
  audioProgress = 0,
  isSeparatingAudio = false,
  separationProgress = 0,
  isRendering = false,
  renderProgress = 0,
  onOpenJobDashboard = null,
  onOpenKeyModal = null,
}) {
  let jobQueue = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    jobQueue = useSharedJobQueue();
  } catch (_) {}

  const activeJob = jobQueue?.jobs?.find((j) => j.status === 'running');
  const isJobBusy = Boolean(activeJob || isGeneratingAudio || isSeparatingAudio || isRendering);

  return (
    <footer className="bottom-status-strip">
      {/* Left: Background Job Queue Status */}
      <div className="bottom-status-left">
        <span className={`status-indicator-dot ${isJobBusy ? 'busy' : 'online'}`} />
        {activeJob ? (
          <span
            className="bottom-status-link"
            onClick={onOpenJobDashboard}
            title="ចុចដើម្បីបើកមើល Production Job Queue"
          >
            Job: {activeJob.currentStage || activeJob.stage || 'Pipeline'} {activeJob.progress ? `${activeJob.progress}%` : ''}
            {activeJob.workerId ? ` [Worker #${activeJob.workerId}]` : ''}
          </span>
        ) : (
          <span
            className="bottom-status-link"
            onClick={onOpenJobDashboard}
            title="ចុចដើម្បីបើកមើល Production Job Queue"
          >
            Idle • Ready
          </span>
        )}
      </div>

      {/* Center: Realtime Local Audio/Demucs/Render Activity */}
      <div className="bottom-status-center">
        {isGeneratingAudio && (
          <span className="bottom-status-tag" style={{ borderColor: '#38bdf8', color: '#7dd3fc' }}>
            <Mic size={11} color="#38bdf8" />
            <span>TTS Synthesizing: {audioProgress}%</span>
          </span>
        )}
        {isSeparatingAudio && (
          <span className="bottom-status-tag" style={{ borderColor: '#f59e0b', color: '#fcd34d' }}>
            <Music size={11} color="#f59e0b" />
            <span>Demucs AI Separation: {separationProgress}%</span>
          </span>
        )}
        {isRendering && (
          <span className="bottom-status-tag" style={{ borderColor: '#22c55e', color: '#86efac' }}>
            <Clapperboard size={11} color="#22c55e" />
            <span>FFmpeg Exporting: {renderProgress}%</span>
          </span>
        )}
      </div>

      {/* Right: Counters, Key pool, Active episode */}
      <div className="bottom-status-right">
        {/* Total segments */}
        <span>💬 {segmentsCount} segments</span>

        {/* Over Count */}
        {overCount > 0 && (
          <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 3 }}>
            <AlertTriangle size={11} />
            <span>{overCount} OVER</span>
          </span>
        )}

        {/* Gemini Key Pool */}
        <span
          className="bottom-status-link"
          onClick={onOpenKeyModal}
          title="Gemini Multi-Key Load Balancer Pool"
        >
          <Key size={11} color="#38bdf8" />
          <span>Pool: 4/4 online • 60 RPM</span>
        </span>

        {/* Active episode */}
        <span className="bottom-status-tag" style={{ background: '#1e293b', color: '#f1f5f9' }}>
          <Film size={10} color="#94a3b8" />
          <span>{activeEpisode?.name || 'EP01'}</span>
        </span>
      </div>
    </footer>
  );
}
