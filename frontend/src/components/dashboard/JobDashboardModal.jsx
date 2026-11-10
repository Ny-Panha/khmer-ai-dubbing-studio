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
        background: 'rgba(5, 10, 24, 0.84)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#141E33',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 1040,
          height: '86vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '14px 22px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: '#10192C',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(255, 133, 119, 0.18), rgba(56, 189, 248, 0.18))',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38BDF8',
              }}
            >
              <Monitor size={19} />
            </div>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1rem',
                  fontWeight: 800,
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>DragonDub Production Job Queue</span>
                <span
                  style={{
                    fontSize: '0.66rem',
                    fontFamily: 'var(--font-mono), monospace',
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: 'rgba(56, 189, 248, 0.12)',
                    color: '#7DD3FC',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                  }}
                >
                  Background Queue
                </span>
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#94A3B8' }}>
                ផ្ទាំងគ្រប់គ្រង និងតាមដានដំណើរការ Dubbing Jobs ទាំងអស់ (Real-Time Background Engine)
              </p>
            </div>
          </div>

          {/* Right Header: Connection Status & Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 9999,
                fontSize: '0.73rem',
                fontWeight: 600,
                background: '#192744',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#CBD5E1',
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
                    : '#64748B',
                  display: 'inline-block',
                }}
              />
              <span>{isConnected ? 'SSE Live' : 'Polling (3s)'}</span>
            </div>

            <button
              type="button"
              onClick={() => refreshJobs()}
              title="Refresh Jobs"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#CBD5E1',
                background: '#192744',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={15} />
            </button>

            <button
              type="button"
              data-testid="job-dashboard-close-btn"
              onClick={onClose}
              title="Close Dashboard (ESC)"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#CBD5E1',
                background: '#192744',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Quick Stats Ribbon */}
        <div
          style={{
            padding: '12px 22px',
            background: 'rgba(16, 25, 44, 0.85)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: '#192744', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(56, 189, 248, 0.16)', color: '#38BDF8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.86rem' }}>
              {stats.runningCount || 0}
            </div>
            <div>
              <div style={{ fontSize: '0.67rem', color: '#94A3B8' }}>កំពុងដំណើរការ</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#FFFFFF' }}>Running Jobs</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: '#192744', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(245, 158, 11, 0.16)', color: '#FBBF24', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.86rem' }}>
              {stats.queuedCount || 0}
            </div>
            <div>
              <div style={{ fontSize: '0.67rem', color: '#94A3B8' }}>រង់ចាំក្នុងជួរ</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#FFFFFF' }}>Queued Jobs</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: '#192744', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(234, 179, 8, 0.16)', color: '#FACC15', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.86rem' }}>
              {stats.pausedCount || 0}
            </div>
            <div>
              <div style={{ fontSize: '0.67rem', color: '#94A3B8' }}>បានផ្អាក</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#FFFFFF' }}>Paused Jobs</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: '#192744', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(16, 185, 129, 0.16)', color: '#34D399', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.86rem' }}>
              {stats.completedCount || 0}
            </div>
            <div>
              <div style={{ fontSize: '0.67rem', color: '#94A3B8' }}>បានបញ្ចប់</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#FFFFFF' }}>Completed</div>
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
