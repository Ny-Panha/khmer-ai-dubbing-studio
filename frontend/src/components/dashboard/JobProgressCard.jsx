import React from 'react';
import { Download, AlertCircle } from 'lucide-react';
import JobActionButtons from './JobActionButtons';

const STATUS_CONFIG = {
  running: {
    labelKhmer: 'កំពុងដំណើរការ',
    labelEn: 'Running',
    badgeBg: 'rgba(56, 189, 248, 0.15)',
    badgeText: '#38BDF8',
    badgeBorder: 'rgba(56, 189, 248, 0.35)',
    dotColor: '#38BDF8',
    cardBorder: 'rgba(56, 189, 248, 0.35)',
    barColor: '#38BDF8',
  },
  queued: {
    labelKhmer: 'រង់ចាំក្នុងជួរ',
    labelEn: 'Queued',
    badgeBg: 'rgba(245, 158, 11, 0.15)',
    badgeText: '#FBBF24',
    badgeBorder: 'rgba(245, 158, 11, 0.35)',
    dotColor: '#FBBF24',
    cardBorder: 'rgba(245, 158, 11, 0.25)',
    barColor: '#F59E0B',
  },
  paused: {
    labelKhmer: 'បានផ្អាក',
    labelEn: 'Paused',
    badgeBg: 'rgba(234, 179, 8, 0.15)',
    badgeText: '#FACC15',
    badgeBorder: 'rgba(234, 179, 8, 0.35)',
    dotColor: '#FACC15',
    cardBorder: 'rgba(234, 179, 8, 0.25)',
    barColor: '#EAB308',
  },
  recovering: {
    labelKhmer: 'កំពុងស្តារឡើងវិញ',
    labelEn: 'Recovering',
    badgeBg: 'rgba(168, 85, 247, 0.15)',
    badgeText: '#C084FC',
    badgeBorder: 'rgba(168, 85, 247, 0.35)',
    dotColor: '#C084FC',
    cardBorder: 'rgba(168, 85, 247, 0.3)',
    barColor: '#A855F7',
  },
  partial: {
    labelKhmer: 'បានមួយផ្នែក (Quota)',
    labelEn: 'Partial',
    badgeBg: 'rgba(245, 158, 11, 0.16)',
    badgeText: '#FBBF24',
    badgeBorder: 'rgba(245, 158, 11, 0.4)',
    dotColor: '#F59E0B',
    cardBorder: 'rgba(245, 158, 11, 0.3)',
    barColor: '#F59E0B',
  },
  completed: {
    labelKhmer: 'បានបញ្ចប់ជោគជ័យ',
    labelEn: 'Completed',
    badgeBg: 'rgba(16, 185, 129, 0.15)',
    badgeText: '#34D399',
    badgeBorder: 'rgba(16, 185, 129, 0.35)',
    dotColor: '#10B981',
    cardBorder: 'rgba(16, 185, 129, 0.25)',
    barColor: '#10B981',
  },
  failed: {
    labelKhmer: 'បានបរាជ័យ',
    labelEn: 'Failed',
    badgeBg: 'rgba(244, 63, 94, 0.15)',
    badgeText: '#FB7185',
    badgeBorder: 'rgba(244, 63, 94, 0.35)',
    dotColor: '#F43F5E',
    cardBorder: 'rgba(244, 63, 94, 0.3)',
    barColor: '#F43F5E',
  },
  cancelled: {
    labelKhmer: 'បានបោះបង់',
    labelEn: 'Cancelled',
    badgeBg: 'rgba(148, 163, 184, 0.14)',
    badgeText: '#94A3B8',
    badgeBorder: 'rgba(148, 163, 184, 0.28)',
    dotColor: '#94A3B8',
    cardBorder: 'rgba(255, 255, 255, 0.1)',
    barColor: '#64748B',
  },
};

function calculateEtaAndSpeed(job) {
  if (job.status !== 'running' || !job.startedAt || !job.completedSegments || job.completedSegments <= 0) {
    return { eta: null, speed: null };
  }

  const elapsedSec = (Date.now() - job.startedAt) / 1000;
  if (elapsedSec < 3) return { eta: null, speed: null };

  const speed = job.completedSegments / elapsedSec;
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
      style={{
        background: '#10192C',
        border: `1px solid ${cfg.cardBorder}`,
        borderRadius: 12,
        padding: '14px 16px',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.28)',
      }}
    >
      {/* Top Row: Series, Episode, Mode, Job ID & Status Badge */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '3px 9px',
              borderRadius: 6,
              fontSize: '0.74rem',
              fontWeight: 700,
              background: '#192744',
              color: '#E2E8F0',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {job.seriesId || 'series_default'} • {job.episodeId || 'ep_1'}
          </span>

          {job.mode && (
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 5,
                fontSize: '0.68rem',
                fontWeight: 600,
                background: 'rgba(56, 189, 248, 0.1)',
                color: '#7DD3FC',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                textTransform: 'uppercase',
              }}
            >
              {job.mode}
            </span>
          )}

          <span
            style={{
              fontSize: '0.72rem',
              fontFamily: 'var(--font-mono), monospace',
              color: '#94A3B8',
              cursor: 'pointer',
            }}
            title={`Full Job ID: ${job.jobId} (Click to copy)`}
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(job.jobId);
              }
            }}
          >
            #{String(job.jobId || '').slice(-8)}
          </span>
        </div>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 9999,
            fontSize: '0.73rem',
            fontWeight: 600,
            background: cfg.badgeBg,
            color: cfg.badgeText,
            border: `1px solid ${cfg.badgeBorder}`,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: cfg.dotColor,
              display: 'inline-block',
            }}
          />
          <span>{cfg.labelKhmer}</span>
          <span style={{ opacity: 0.72, fontSize: '0.67rem' }}>({cfg.labelEn})</span>
        </span>
      </div>

      {/* Stage Info & Progress Bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: '0.76rem', marginBottom: 5 }}>
          <span style={{ fontWeight: 600, color: '#E2E8F0' }}>
            {job.currentStage ? `Stage: ${job.currentStage}` : 'ដំណាក់កាលបឋម'}
          </span>
          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono), monospace', color: cfg.barColor }}>
            {progressPercent}%
          </span>
        </div>

        <div
          style={{
            width: '100%',
            height: 7,
            background: '#090D16',
            borderRadius: 9999,
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPercent}%`,
              background: cfg.barColor,
              borderRadius: 9999,
              transition: 'width 0.35s ease',
            }}
          />
        </div>

        {job.stageMessage && (
          <p
            style={{
              fontSize: '0.73rem',
              color: '#94A3B8',
              margin: '6px 0 0',
              lineHeight: 1.4,
            }}
            title={job.stageMessage}
          >
            {job.stageMessage}
          </p>
        )}
      </div>

      {/* Segments & Performance Metrics */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '8px 0',
          borderTop: '1px solid rgba(255, 255, 255, 0.07)',
          fontSize: '0.74rem',
          color: '#94A3B8',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span>
            Segments: <strong style={{ color: '#F1F5F9' }}>{completedSegs}</strong> / {totalSegs}
          </span>
          {failedSegs > 0 && (
            <span style={{ color: '#FB7185', fontWeight: 600 }}>
              Failed: {failedSegs}
            </span>
          )}
          {speed && (
            <span>
              Speed: <strong style={{ color: '#F1F5F9' }}>{speed}</strong>
            </span>
          )}
          {eta && (
            <span style={{ color: '#FBBF24' }}>
              ETA: <strong style={{ color: '#FDE68A' }}>{eta}</strong>
            </span>
          )}
        </div>

        {statusKey === 'completed' && outputVideoUrl && (
          <a
            href={outputVideoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: '0.74rem',
              color: '#34D399',
              fontWeight: 700,
              textDecoration: 'underline',
            }}
          >
            <Download size={13} />
            <span>ទាញយកវីដេអូ</span>
          </a>
        )}
      </div>

      {/* Error Banner */}
      {(job.error || (statusKey === 'failed' && job.stageMessage)) && (
        <div
          style={{
            marginTop: 6,
            marginBottom: 4,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid rgba(244, 63, 94, 0.32)',
            color: '#FDA4AF',
            fontSize: '0.74rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ wordBreak: 'break-word', lineHeight: 1.45 }}>
            {typeof job.error === 'string'
              ? job.error
              : job.error?.message || job.stageMessage || 'មានបញ្ហាបរាជ័យក្នុងដំណើរការ Job'}
          </span>
        </div>
      )}

      {/* Action Buttons Row */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid rgba(255, 255, 255, 0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.69rem', color: '#64748B', fontFamily: 'var(--font-mono), monospace' }}>
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
