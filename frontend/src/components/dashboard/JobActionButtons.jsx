import React, { useState } from 'react';

/**
 * Action buttons for individual Jobs with status-based rules,
 * double-click lock, loading spinners, and cancel confirmation dialog.
 */
export default function JobActionButtons({
  job,
  actionLoading,
  onPause,
  onResume,
  onRetry,
  onCancel,
}) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const status = (job?.status || '').toLowerCase();
  const isBusy = Boolean(actionLoading);

  const handleConfirmCancel = () => {
    setShowCancelConfirm(false);
    if (onCancel) {
      onCancel(job.jobId);
    }
  };

  return (
    <div className="flex items-center gap-2 relative">
      {/* 1. Pause Button (Only for running) */}
      {status === 'running' && (
        <button
          type="button"
          onClick={() => onPause && onPause(job.jobId)}
          disabled={isBusy}
          title="Pause Job"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {actionLoading === 'pause' ? (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
          <span>ផ្អាក (Pause)</span>
        </button>
      )}

      {/* 2. Resume Button (Only for paused) */}
      {status === 'paused' && (
        <button
          type="button"
          onClick={() => onResume && onResume(job.jobId)}
          disabled={isBusy}
          title="Resume Job"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {actionLoading === 'resume' ? (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
          <span>បន្ត (Resume)</span>
        </button>
      )}

      {/* 3. Retry Button (For failed or cancelled) */}
      {(status === 'failed' || status === 'cancelled') && (
        <button
          type="button"
          onClick={() => onRetry && onRetry(job.jobId)}
          disabled={isBusy}
          title="Retry Job"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {actionLoading === 'retry' ? (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          )}
          <span>ព្យាយាមម្តងទៀត (Retry)</span>
        </button>
      )}

      {/* 4. Cancel Button (For active or paused or failed) */}
      {(status === 'running' || status === 'queued' || status === 'paused' || status === 'failed') && (
        <button
          type="button"
          onClick={() => setShowCancelConfirm(true)}
          disabled={isBusy}
          title="Cancel Job"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {actionLoading === 'cancel' ? (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
          <span>បោះបង់ (Cancel)</span>
        </button>
      )}

      {/* Cancel Confirmation Dialog */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-[#181A20] border border-[#343843] rounded-xl p-5 max-w-sm w-full shadow-2xl text-left animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5 text-rose-400 font-semibold text-sm mb-2">
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>បញ្ជាក់ការបោះបង់ Job</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed mb-4">
              តើអ្នកពិតជាចង់បោះបង់ Job <span className="text-white font-mono font-semibold">#{job.jobId.slice(0, 8)}</span> មែនទេ?
              ដំណើរការ render ឬ synthesis នឹងត្រូវបញ្ឈប់ភ្លាមៗ។
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:bg-[#252830] border border-[#343843] transition-colors cursor-pointer"
              >
                ត្រឡប់ក្រោយ
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-colors cursor-pointer"
              >
                យល់ព្រមបោះបង់
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

