import React, { useState } from 'react';
import { Pause, Play, RotateCcw, X, AlertCircle, Loader2 } from 'lucide-react';

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

  const baseBtnStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 11px',
    borderRadius: 7,
    fontSize: '0.73rem',
    fontWeight: 600,
    cursor: isBusy ? 'not-allowed' : 'pointer',
    opacity: isBusy ? 0.55 : 1,
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
      {/* 1. Pause Button (Only for running) */}
      {status === 'running' && (
        <button
          type="button"
          onClick={() => onPause && onPause(job.jobId)}
          disabled={isBusy}
          title="Pause Job"
          style={{
            ...baseBtnStyle,
            background: 'rgba(245, 158, 11, 0.12)',
            color: '#FBBF24',
            border: '1px solid rgba(245, 158, 11, 0.35)',
          }}
        >
          {actionLoading === 'pause' ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />}
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
          style={{
            ...baseBtnStyle,
            background: 'rgba(56, 189, 248, 0.14)',
            color: '#38BDF8',
            border: '1px solid rgba(56, 189, 248, 0.38)',
          }}
        >
          {actionLoading === 'resume' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          <span>បន្ត (Resume)</span>
        </button>
      )}

      {/* 3. Retry Button (For failed, partial, or cancelled) */}
      {(status === 'failed' || status === 'cancelled' || status === 'partial') && (
        <button
          type="button"
          onClick={() => onRetry && onRetry(job.jobId)}
          disabled={isBusy}
          title="Retry Job"
          style={{
            ...baseBtnStyle,
            background: 'rgba(16, 185, 129, 0.12)',
            color: '#34D399',
            border: '1px solid rgba(16, 185, 129, 0.35)',
          }}
        >
          {actionLoading === 'retry' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
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
          style={{
            ...baseBtnStyle,
            background: 'rgba(244, 63, 94, 0.12)',
            color: '#FB7185',
            border: '1px solid rgba(244, 63, 94, 0.35)',
          }}
        >
          {actionLoading === 'cancel' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
          <span>បោះបង់ (Cancel)</span>
        </button>
      )}

      {/* Cancel Confirmation Dialog */}
      {showCancelConfirm && (
        <div
          onClick={() => setShowCancelConfirm(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100040,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2, 6, 23, 0.72)',
            backdropFilter: 'blur(4px)',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#141E33',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: 12,
              padding: 20,
              maxWidth: 380,
              width: '100%',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7)',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FB7185', fontWeight: 700, fontSize: '0.88rem', marginBottom: 8 }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>បញ្ជាក់ការបោះបង់ Job</span>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#CBD5E1', lineHeight: 1.5, margin: '0 0 16px' }}>
              តើអ្នកពិតជាចង់បោះបង់ Job <span style={{ color: '#FFFFFF', fontFamily: 'monospace', fontWeight: 700 }}>#{String(job.jobId || '').slice(-8)}</span> មែនទេ?
              ដំណើរការ render ឬ synthesis នឹងត្រូវបញ្ឈប់ភ្លាមៗ។
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 7,
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  color: '#CBD5E1',
                  background: '#1E293B',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  cursor: 'pointer',
                }}
              >
                ត្រឡប់ក្រោយ
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                style={{
                  padding: '6px 14px',
                  borderRadius: 7,
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  background: '#E11D48',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                បោះបង់ Job ឥឡូវនេះ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
