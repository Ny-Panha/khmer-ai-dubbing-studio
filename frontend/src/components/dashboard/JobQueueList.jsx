import React from 'react';
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
    <div className="flex flex-col h-full">
      {/* Controls Bar: Filter Tabs & Search */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pb-4 mb-4 border-b border-[#252830]">
        {/* Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {TABS.map((tab) => {
            const count = getTabCount(tab.id);
            const isActive = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#4C8DFF] text-white shadow-sm'
                    : 'bg-[#181A20] text-zinc-400 hover:text-white hover:bg-[#252830] border border-[#343843]'
                }`}
              >
                <span>{tab.labelKhmer}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isActive ? 'bg-white/20 text-white' : 'bg-[#252830] text-zinc-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ស្វែងរកតាម Series, Ep, Job ID..."
            className="w-full bg-[#181A20] border border-[#343843] rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#4C8DFF] transition-colors"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Jobs Scrollable List */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {isLoading && jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400 text-xs gap-2">
            <svg className="animate-spin w-6 h-6 text-[#4C8DFF]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>កំពុងទាញយកបញ្ជី Jobs...</span>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400 text-xs border border-dashed border-[#343843] rounded-xl bg-[#181A20]/40">
            <svg className="w-10 h-10 text-zinc-600 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
            </svg>
            <p className="font-medium text-zinc-300">មិនមាន Job ណាមួយក្នុងបញ្ជីនេះឡើយ</p>
            <p className="text-[11px] text-zinc-500 mt-1">
              {filter !== 'all' ? `គ្មាន Job ដែលមាន status '${filter}' ទេ` : 'សូមចាប់ផ្តើម dubbing ដើម្បីបង្កើត Job ថ្មី'}
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

