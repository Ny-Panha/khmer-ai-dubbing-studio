import React from 'react';
import { Loader2, Briefcase } from 'lucide-react';
import JobProgressCard from './JobProgressCard';

const TABS = [
  { id: 'all', labelKhmer: 'ទាំងអស់', labelEn: 'All' },
  { id: 'running', labelKhmer: 'កំពុងដើរ', labelEn: 'Running' },
  { id: 'queued', labelKhmer: 'ក្នុងជួរ', labelEn: 'Queued' },
  { id: 'paused', labelKhmer: 'បានផ្អាក', labelEn: 'Paused' },
  { id: 'completed', labelKhmer: 'ជោគជ័យ', labelEn: 'Completed' },
  { id: 'failed', labelKhmer: 'បរាជ័យ', labelEn: 'Failed' },
  { id: 'cancelled', labelKhmer: 'បោះបង់', labelEn: 'Cancelled' },
];

export default function JobQueueList({
  jobs,
  stats,
  filter,
  setFilter,
  searchTerm,
  setSearchTerm,
  isLoading,
  actionInProgress,
  onPause,
  onResume,
  onRetry,
  onCancel,
}) {
  const getTabCount = (tabId) => {
    if (!stats) return 0;
    switch (tabId) {
      case 'all':
        return stats.totalJobs || 0;
      case 'running':
        return stats.runningCount || 0;
      case 'queued':
        return stats.queuedCount || 0;
      case 'paused':
        return stats.pausedCount || 0;
      case 'completed':
        return stats.completedCount || 0;
      case 'failed':
        return stats.failedCount || 0;
      case 'cancelled':
        return stats.cancelledCount || 0;
      default:
        return 0;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Controls Bar: Filter Tabs & Search */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingBottom: 14,
          marginBottom: 14,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          flexShrink: 0,
        }}
      >
        {/* Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {TABS.map((tab) => {
            const count = getTabCount(tab.id);
            const isActive = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: isActive ? 700 : 500,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'var(--transition-fast)',
                  background: isActive ? 'var(--btn-primary-bg)' : 'var(--bg-secondary-panel)',
                  color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                  border: isActive ? '1px solid var(--btn-primary-border)' : '1px solid var(--border-subtle)',
                }}
              >
                <span>{tab.labelKhmer}</span>
                <span
                  style={{
                    fontSize: 'var(--text-2xs)',
                    fontFamily: 'var(--font-mono)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-xs)',
                    background: isActive ? 'rgba(255, 255, 255, 0.2)' : 'var(--bg-elevated-panel)',
                    color: isActive ? '#FFFFFF' : 'var(--text-primary)',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div style={{ position: 'relative', minWidth: 220, flex: '1 1 220px', maxWidth: 320 }}>
          <input
            type="text"
            aria-label="ស្វែងរកតាម Series, Ep, ឬ Job ID"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ស្វែងរកតាម Series, Ep, Job ID..."
            style={{
              width: '100%',
              background: '#0E1422',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              padding: '7px 28px 7px 12px',
              fontSize: '0.76rem',
              color: '#F8FAFC',
              outline: 'none',
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Jobs Scrollable List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          paddingRight: 4,
          minHeight: 0,
        }}
      >
        {isLoading && jobs.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '64px 16px',
              color: '#94A3B8',
              fontSize: '0.8rem',
              gap: 10,
            }}
          >
            <Loader2 size={24} className="animate-spin" style={{ color: '#38BDF8' }} />
            <span>កំពុងទាញយកបញ្ជី Jobs...</span>
          </div>
        ) : jobs.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '56px 16px',
              color: '#94A3B8',
              fontSize: '0.8rem',
              border: '1px dashed rgba(255, 255, 255, 0.14)',
              borderRadius: 12,
              background: 'rgba(16, 25, 44, 0.5)',
              textAlign: 'center',
            }}
          >
            <Briefcase size={34} style={{ color: '#475569', marginBottom: 10 }} />
            <p style={{ fontWeight: 700, color: '#E2E8F0', margin: 0, fontSize: '0.86rem' }}>
              មិនមាន Job ណាមួយក្នុងបញ្ជីនេះឡើយ
            </p>
            <p style={{ fontSize: '0.74rem', color: '#64748B', margin: '6px 0 0' }}>
              {filter !== 'all'
                ? `គ្មាន Job ដែលមាន status '${filter}' ទេ`
                : 'សូមចាប់ផ្តើម Batch Generate / Repair / Dubbing ដើម្បីបង្កើត Job ថ្មី'}
            </p>
          </div>
        ) : (
          jobs.map((job) => (
            <JobProgressCard
              key={job.jobId}
              job={job}
              actionLoading={actionInProgress[job.jobId]}
              onPause={onPause}
              onResume={onResume}
              onRetry={onRetry}
              onCancel={onCancel}
            />
          ))
        )}
      </div>
    </div>
  );
}
