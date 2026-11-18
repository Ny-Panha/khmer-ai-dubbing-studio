import React, { useEffect } from 'react';
import { Monitor, RefreshCw, X, AlertCircle } from 'lucide-react';
import { useSharedJobQueue } from '../../context/jobQueueStore';
import JobQueueList from './JobQueueList';

export default function JobDashboardModal({ isOpen, onClose }) {
  const {
    jobs,
    stats,
    filter,
    setFilter,
    searchTerm,
    setSearchTerm,
    isLoading,
    error,
    clearError,
    connectionMode,
    isConnected,
    actionInProgress,
    pauseJob,
    resumeJob,
    retryJob,
    cancelJob,
    refreshJobs,
  } = useSharedJobQueue();

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="job-dashboard-modal"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100020,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        background: 'rgba(9, 10, 15, 0.82)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="DragonDub Production Job Queue"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-primary-panel)',
          border: '1px solid var(--border-subtle-hover)',
          borderRadius: 'var(--radius-lg)',
          width: '100%',
          maxWidth: 1040,
          height: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary-panel)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary-accent)',
                flexShrink: 0,
              }}
            >
              <Monitor size={19} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: 'var(--text-lg)',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <span>DragonDub Production Job Queue</span>
                <span
                  style={{
                    fontSize: 'var(--text-2xs)',
                    fontFamily: 'var(--font-mono)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-xs)',
                    background: 'rgba(56, 189, 248, 0.12)',
                    color: '#7DD3FC',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                  }}
                >
                  Background Queue
                </span>
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                ផ្ទាំងគ្រប់គ្រង និងតាមដានដំណើរការ Dubbing Jobs ទាំងអស់ (Real-Time Background Engine)
              </p>
            </div>
          </div>

          {/* Right Header: Connection Status & Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-2xs)',
                fontWeight: 600,
                background: 'var(--bg-elevated-panel)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isConnected
                    ? '#10B981'
                    : connectionMode === 'polling'
                    ? '#F59E0B'
                    : '#8E9EB5',
                  display: 'inline-block',
                }}
              />
              <span>{isConnected ? 'SSE Live' : 'Polling (3s)'}</span>
            </div>

            <button
              type="button"
              onClick={() => refreshJobs()}
              aria-label="Refresh Jobs"
              title="Refresh Jobs"
              style={{
                width: 34,
                height: 34,
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-primary)',
                background: 'var(--bg-elevated-panel)',
                border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={15} />
            </button>

            <button
              type="button"
              data-testid="job-dashboard-close-btn"
              onClick={onClose}
              aria-label="Close Job Dashboard"
              title="Close Dashboard (ESC)"
              style={{
                width: 34,
                height: 34,
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-primary)',
                background: 'var(--bg-elevated-panel)',
                border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Quick Stats Ribbon (4-col desktop, 2x2 mobile via .studio-stat-grid-4) */}
        <div
          className="studio-stat-grid-4"
          style={{
            padding: '12px 20px',
            background: 'var(--bg-desktop)',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary-panel)', border: '1px solid var(--border-subtle)', minWidth: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 'var(--radius-xs)', background: 'rgba(56, 189, 248, 0.14)', color: '#7DD3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body)', flexShrink: 0 }}>
              {stats.runningCount || 0}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>កំពុងដំណើរការ</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>Running Jobs</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary-panel)', border: '1px solid var(--border-subtle)', minWidth: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 'var(--radius-xs)', background: 'rgba(245, 158, 11, 0.14)', color: '#FDE68A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body)', flexShrink: 0 }}>
              {stats.queuedCount || 0}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>រង់ចាំក្នុងជួរ</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>Queued Jobs</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary-panel)', border: '1px solid var(--border-subtle)', minWidth: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 'var(--radius-xs)', background: 'rgba(234, 179, 8, 0.14)', color: '#FEF08A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body)', flexShrink: 0 }}>
              {stats.pausedCount || 0}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>បានផ្អាក</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>Paused Jobs</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary-panel)', border: '1px solid var(--border-subtle)', minWidth: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 'var(--radius-xs)', background: 'rgba(16, 185, 129, 0.14)', color: '#6EE7B7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body)', flexShrink: 0 }}>
              {stats.completedCount || 0}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>បានបញ្ចប់</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>Completed</div>
            </div>
          </div>
        </div>

        {/* Inline Error Notice Banner */}
        {error && (
          <div
            role="alert"
            style={{
              margin: '12px 22px 0 22px',
              padding: '9px 14px',
              borderRadius: 10,
              background: 'rgba(239, 68, 68, 0.14)',
              border: '1px solid rgba(239, 68, 68, 0.42)',
              color: '#FCA5A5',
              fontSize: '0.76rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <AlertCircle size={15} color="#F87171" style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </span>
            {typeof clearError === 'function' && (
              <button
                type="button"
                onClick={clearError}
                aria-label="បិទសារជូនដំណឹង"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#FCA5A5',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Modal Main Content */}
        <div style={{ flex: 1, padding: '16px 22px', overflow: 'hidden', minHeight: 0 }}>
          <JobQueueList
            jobs={jobs}
            stats={stats}
            filter={filter}
            setFilter={setFilter}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            isLoading={isLoading}
            actionInProgress={actionInProgress}
            onPause={pauseJob}
            onResume={resumeJob}
            onRetry={retryJob}
            onCancel={cancelJob}
          />
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '11px 22px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: '#10192C',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.73rem',
            color: '#64748B',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>
              Queue Concurrency: <strong style={{ color: '#CBD5E1' }}>{stats.maxConcurrency || 1} Active Job</strong>
            </span>
            <span>•</span>
            <span style={{ color: '#94A3B8' }}>
              ការប្តូរ Episode ឬបិទផ្ទាំងនេះមិនធ្វើឱ្យខូចខាតដំណើរការ Job ក្នុង Background ឡើយ
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontFamily: 'var(--font-mono), monospace' }}>
            Total Jobs Tracked: {stats.totalJobs || 0}
          </div>
        </div>
      </div>
    </div>
  );
}
