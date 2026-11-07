import React from 'react';
import JobActionButtons from './JobActionButtons';

/**
 * Status style mapping with dark theme colors and badges
 */
const STATUS_CONFIG = {
  running: {
    labelKhmer: 'កំពុងដំណើរការ',
    labelEn: 'Running',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    dotClass: 'bg-blue-400 animate-pulse',
    borderClass: 'border-blue-500/30 hover:border-blue-500/50',
  },
  queued: {
    labelKhmer: 'រង់ចាំក្នុងជួរ',
    labelEn: 'Queued',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    dotClass: 'bg-amber-400',
    borderClass: 'border-amber-500/20 hover:border-amber-500/40',
  },
  paused: {
    labelKhmer: 'បានផ្អាក',
    labelEn: 'Paused',
    badgeClass: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    dotClass: 'bg-yellow-400',
    borderClass: 'border-yellow-500/20 hover:border-yellow-500/40',
  },
  recovering: {
    labelKhmer: 'កំពុងស្តារឡើងវិញ',
    labelEn: 'Recovering',
    badgeClass: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    dotClass: 'bg-purple-400 animate-pulse',
    borderClass: 'border-purple-500/30 hover:border-purple-500/50',
  },
  completed: {
    labelKhmer: 'បានបញ្ចប់ជោគជ័យ',
    labelEn: 'Completed',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    dotClass: 'bg-emerald-400',
    borderClass: 'border-emerald-500/20 hover:border-emerald-500/40',
  },
  failed: {
    labelKhmer: 'បានបរាជ័យ',
    labelEn: 'Failed',
    badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    dotClass: 'bg-rose-400',
    borderClass: 'border-rose-500/30 hover:border-rose-500/50',
  },
  cancelled: {
    labelKhmer: 'បានបោះបង់',
    labelEn: 'Cancelled',
    badgeClass: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    dotClass: 'bg-zinc-400',
    borderClass: 'border-zinc-700 hover:border-zinc-600',
  },
};

/**
 * Calculates estimated time remaining based on start time and segment progress
 */
function calculateEtaAndSpeed(job) {
  if (job.status !== 'running' || !job.startedAt || !job.completedSegments || job.completedSegments <= 0) {
    return { eta: null, speed: null };
  }

  const elapsedSec = (Date.now() - job.startedAt) / 1000;
  if (elapsedSec < 3) return { eta: null, speed: null };

  const speed = job.completedSegments / elapsedSec; // segments per sec
  const remaining = Math.max(0, (job.totalSegments || 0) - job.completedSegments);

  if (speed <= 0 || remaining <= 0) {
    return { eta: null, speed: speed > 0 ? `${speed.toFixed(1)} seg/s` : null };
  }

  const etaSec = Math.round(remaining / speed);
  const etaFormatted =
    etaSec > 60
      ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s`
      : `${etaSec}s`;

  return {
    eta: etaFormatted,
    speed: `${speed.toFixed(1)} seg/s`,
  };
}

export default function JobProgressCard({
  job,
  actionLoading,
  onPause,
  onResume,
  onRetry,
  onCancel,
}) {
  const statusKey = (job.status || 'queued').toLowerCase();
  const cfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.queued;
  const progressPercent = Math.min(100, Math.max(0, Math.round(job.progress || 0)));
  const { eta, speed } = calculateEtaAndSpeed(job);

  const completedSegs = job.completedSegments || 0;
  const totalSegs = job.totalSegments || 0;
  const failedSegs = job.failedSegments || 0;

  const outputVideoUrl = job.output?.finalVideoUrl;

  return (
    <div
      className={`bg-[#181A20] border rounded-xl p-4 transition-all duration-200 shadow-md ${cfg.borderClass}`}
    >
      {/* Top Row: Series, Episode, Job ID & Status Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3">
        <div className="flex items-center gap-2">
          {/* Episode Pill */}
          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#252830] text-zinc-200 border border-[#343843]">
            {job.seriesId || 'series_default'} • {job.episodeId || 'ep_1'}
          </span>

          {/* Job ID */}
          <span
            className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 cursor-pointer"
            title={`Full Job ID: ${job.jobId}`}
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(job.jobId);
              }
            }}
          >
            #{String(job.jobId).slice(0, 8)}
          </span>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.badgeClass}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
            <span>{cfg.labelKhmer}</span>
            <span className="opacity-60 text-[10px]">({cfg.labelEn})</span>
          </span>
        </div>
      </div>

      {/* Stage Info & Message */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between text-xs mb-1">
          <span className="font-medium text-zinc-200">
            {job.currentStage ? `Stage: ${job.currentStage}` : 'ដំណាក់កាលបឋម'}
          </span>
          <span className="font-semibold text-[#4C8DFF]">{progressPercent}%</span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-[#111216] rounded-full h-2 overflow-hidden border border-[#343843]">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              statusKey === 'completed'
                ? 'bg-emerald-500'
                : statusKey === 'failed'
                ? 'bg-rose-500'
                : statusKey === 'paused'
                ? 'bg-yellow-500'
                : 'bg-[#4C8DFF]'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Stage Message */}
        {job.stageMessage && (
          <p className="text-[11px] text-zinc-400 mt-1.5 truncate" title={job.stageMessage}>
            {job.stageMessage}
          </p>
        )}
      </div>

      {/* Segments & Performance Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 py-2 border-t border-[#252830] text-xs text-zinc-400">
        <div className="flex items-center gap-4">
          <span>
            Segments: <strong className="text-zinc-200">{completedSegs}</strong> / {totalSegs}
          </span>
          {failedSegs > 0 && (
            <span className="text-rose-400 font-medium">
              Failed: {failedSegs}
            </span>
          )}
          {speed && (
            <span className="text-zinc-400">
              Speed: <strong className="text-zinc-200">{speed}</strong>
            </span>
          )}
          {eta && (
            <span className="text-amber-400/90">
              ETA: <strong className="text-amber-300">{eta}</strong>
            </span>
          )}
        </div>

        {/* Output Link for completed jobs */}
        {statusKey === 'completed' && outputVideoUrl && (
          <a
            href={outputVideoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium underline"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>ទាញយកវីដេអូ</span>
          </a>
        )}
      </div>

      {/* Error Banner */}
      {(job.error || (statusKey === 'failed' && job.stageMessage)) && (
        <div className="mt-2.5 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="break-all leading-relaxed">
            {typeof job.error === 'string' ? job.error : job.error?.message || job.stageMessage || 'មានបញ្ហាបរាជ័យក្នុងដំណើរការ Job'}
          </span>
        </div>
      )}

      {/* Action Buttons Row */}
      <div className="mt-3 pt-2.5 border-t border-[#252830] flex items-center justify-between">
        <span className="text-[10px] text-zinc-500">
          Created: {new Date(job.createdAt || Date.now()).toLocaleTimeString()}
        </span>
        <JobActionButtons
          job={job}
          actionLoading={actionLoading}
          onPause={onPause}
          onResume={onResume}
          onRetry={onRetry}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

