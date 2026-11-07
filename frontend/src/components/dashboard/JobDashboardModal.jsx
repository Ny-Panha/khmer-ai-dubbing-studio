import React, { useEffect } from 'react';
import { useSharedJobQueue } from '../../context/JobQueueContext';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-[#050A18]/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-[#141E33] border border-white/10 rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl shadow-black/80 overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-white/5 bg-[#10192C] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF8577]/20 to-[#38BDF8]/20 border border-[#FF8577]/30 flex items-center justify-center text-[#FF8577] shadow-[0_0_14px_rgba(255,133,119,0.2)]">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>DragonDub Production Job Queue</span>
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                  Phase 4.4
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                ផ្ទាំងគ្រប់គ្រង និងតាមដានដំណើរការ Dubbing Jobs ទាំងអស់ (Real-Time Background Engine)
              </p>
            </div>
          </div>

          {/* Right Header: Connection Status & Controls */}
          <div className="flex items-center gap-2.5">
            {/* Connection Status Pill */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#192744] border border-white/10">
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnected
                    ? 'bg-emerald-400 animate-pulse'
                    : connectionMode === 'polling'
                    ? 'bg-amber-400'
                    : 'bg-zinc-500'
                }`}
              />
              <span className="text-slate-300 text-[11px]">
                {isConnected ? 'SSE Live' : 'Polling (3s)'}
              </span>
            </div>

            {/* Manual Refresh */}
            <button
              type="button"
              onClick={() => refreshJobs()}
              title="Refresh Jobs"
              className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              title="Close Dashboard (ESC)"
              className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-rose-500/20 hover:border-rose-500/40 border border-white/10 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Quick Stats Ribbon */}
        <div className="px-6 py-3 bg-[#10192C]/80 border-b border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#192744] border border-white/5">
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold">
              {stats.runningCount || 0}
            </div>
            <div>
              <div className="text-[10px] text-slate-400">កំពុងដំណើរការ</div>
              <div className="font-semibold text-white">Running Jobs</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#192744] border border-white/5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center font-bold">
              {stats.queuedCount || 0}
            </div>
            <div>
              <div className="text-[10px] text-slate-400">រង់ចាំក្នុងជួរ</div>
              <div className="font-semibold text-white">Queued Jobs</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#192744] border border-white/5">
            <div className="w-7 h-7 rounded-lg bg-yellow-500/15 text-yellow-400 flex items-center justify-center font-bold">
              {stats.pausedCount || 0}
            </div>
            <div>
              <div className="text-[10px] text-slate-400">បានផ្អាក</div>
              <div className="font-semibold text-white">Paused Jobs</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#192744] border border-white/5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold">
              {stats.completedCount || 0}
            </div>
            <div>
              <div className="text-[10px] text-slate-400">បានបញ្ចប់</div>
              <div className="font-semibold text-white">Completed</div>
            </div>
          </div>
        </div>

        {/* Modal Main Content */}
        <div className="flex-1 p-6 overflow-hidden">
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
        <div className="px-6 py-3 border-t border-white/5 bg-[#10192C] flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
          <div className="flex items-center gap-3">
            <span>
              Queue Concurrency: <strong className="text-slate-300">{stats.maxConcurrency || 1} Active Job</strong>
            </span>
            <span>•</span>
            <span className="text-slate-400">
              ការប្តូរ Episode ឬបិទផ្ទាំងនេះមិនធ្វើឱ្យខូចខាតដំណើរការ Job ក្នុង Background ឡើយ
            </span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Total Jobs Tracked: {stats.totalJobs || 0}
          </div>
        </div>
      </div>
    </div>
  );
}

