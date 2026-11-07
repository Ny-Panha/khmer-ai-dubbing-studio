import React from 'react';
import { useSharedJobQueue } from '../../context/JobQueueContext';
import { Key, Film, Mic, Music, Clapperboard } from 'lucide-react';
import './BottomStatusStrip.css';

export default function BottomStatusStrip({
  activeEpisode = null,
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
          <span className="bottom-status-tag" style={{ borderColor: 'rgba(56, 189, 248, 0.3)', color: '#7dd3fc' }}>
            <Mic size={11} color="#38bdf8" />
            <span>TTS Synthesizing: {audioProgress}%</span>
          </span>
        )}
        {isSeparatingAudio && (
          <span className="bottom-status-tag" style={{ borderColor: 'rgba(245, 158, 11, 0.3)', color: '#fcd34d' }}>
            <Music size={11} color="#f59e0b" />
            <span>Demucs AI Separation: {separationProgress}%</span>
          </span>
        )}
        {isRendering && (
          <span className="bottom-status-tag" style={{ borderColor: 'rgba(34, 197, 94, 0.3)', color: '#86efac' }}>
            <Clapperboard size={11} color="#22c55e" />
            <span>FFmpeg Exporting: {renderProgress}%</span>
          </span>
        )}
      </div>

      {/* Right: Key pool & Active episode (Segment count and OVER stay in toolbar only) */}
      <div className="bottom-status-right">
        {/* Gemini Key Pool */}
        <span
          className="bottom-status-link"
          onClick={onOpenKeyModal}
          title="Gemini Multi-Key Load Balancer Pool"
        >
          <Key size={11} color="#38bdf8" />
          <span style={{ fontFamily: 'var(--font-mono)' }}>Pool: 4/4 online • 60 RPM</span>
        </span>

        {/* Active episode */}
        <span className="bottom-status-tag" style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-dim)' }}>
          <Film size={10} color="#94a3b8" />
          <span style={{ fontFamily: 'var(--font-mono)' }}>{activeEpisode?.name || 'EP01'}</span>
        </span>
      </div>
    </footer>
  );
}
