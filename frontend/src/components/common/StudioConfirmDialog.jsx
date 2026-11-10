import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  AlertCircle,
  Wrench,
  CheckCircle2,
  X,
} from 'lucide-react';

const VARIANT_THEMES = {
  warning: {
    accent: '#FBBF24',
    accentSoft: 'rgba(251, 191, 36, 0.16)',
    border: 'rgba(251, 191, 36, 0.42)',
    glow: 'rgba(251, 191, 36, 0.22)',
    btnBg: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
    btnBorder: '#FBBF24',
    btnColor: '#0B132B',
    Icon: AlertTriangle,
  },
  repair: {
    accent: '#FB923C',
    accentSoft: 'rgba(251, 146, 60, 0.16)',
    border: 'rgba(251, 146, 60, 0.45)',
    glow: 'rgba(251, 146, 60, 0.22)',
    btnBg: 'linear-gradient(135deg, #FB923C 0%, #EA580C 100%)',
    btnBorder: '#FDBA74',
    btnColor: '#0B132B',
    Icon: Wrench,
  },
  danger: {
    accent: '#F87171',
    accentSoft: 'rgba(239, 68, 68, 0.18)',
    border: 'rgba(239, 68, 68, 0.5)',
    glow: 'rgba(239, 68, 68, 0.28)',
    btnBg: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)',
    btnBorder: '#F87171',
    btnColor: '#FFFFFF',
    Icon: AlertTriangle,
  },
  success: {
    accent: '#34D399',
    accentSoft: 'rgba(16, 185, 129, 0.16)',
    border: 'rgba(16, 185, 129, 0.45)',
    glow: 'rgba(16, 185, 129, 0.22)',
    btnBg: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
    btnBorder: '#34D399',
    btnColor: '#052E16',
    Icon: CheckCircle2,
  },
  info: {
    accent: '#38BDF8',
    accentSoft: 'rgba(56, 189, 248, 0.16)',
    border: 'rgba(56, 189, 248, 0.45)',
    glow: 'rgba(56, 189, 248, 0.22)',
    btnBg: 'linear-gradient(135deg, #0EA5E9 0%, #2563EB 100%)',
    btnBorder: '#38BDF8',
    btnColor: '#FFFFFF',
    Icon: AlertCircle,
  },
};

export default function StudioConfirmDialog({
  isOpen = false,
  variant = 'warning',
  badge = '',
  title = '',
  subtitle = '',
  chips = null,
  bullets = null,
  message = '',
  question = '',
  confirmLabel = 'បន្ត (Confirm)',
  cancelLabel = 'បោះបង់',
  showCancel = true,
  onConfirm = null,
  onCancel = null,
}) {
  const okBtnRef = useRef(null);
  const cancelBtnRef = useRef(null);

  const theme = VARIANT_THEMES[variant] || VARIANT_THEMES.warning;
  const Icon = theme.Icon;

  useEffect(() => {
    if (!isOpen) return undefined;

    const focusTimer = setTimeout(() => {
      if (variant === 'danger' && showCancel && cancelBtnRef.current) {
        cancelBtnRef.current.focus();
      } else if (okBtnRef.current) {
        okBtnRef.current.focus();
      }
    }, 10);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (showCancel) {
          onCancel?.();
        } else {
          onConfirm?.();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, variant, showCancel, onCancel, onConfirm]);

  if (!isOpen) return null;

  const chipList = Array.isArray(chips) ? chips.filter(Boolean) : [];
  const bulletList = Array.isArray(bullets) ? bullets.filter(Boolean) : [];

  const handleBackdropDismiss = (e) => {
    e.stopPropagation();
    if (showCancel) {
      onCancel?.();
    } else {
      onConfirm?.();
    }
  };

  const modalNode = (
    <div
      data-testid="studio-confirm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-confirm-title"
      onClick={handleBackdropDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100060,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        background: 'rgba(2, 6, 23, 0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        fontFamily: "'Kantumruy Pro', system-ui, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          borderRadius: 18,
          overflow: 'hidden',
          background: 'linear-gradient(180deg, rgba(20, 31, 53, 0.99) 0%, rgba(13, 21, 38, 0.99) 100%)',
          border: `1px solid ${theme.border}`,
          boxShadow: `0 28px 80px -12px rgba(0, 0, 0, 0.92), 0 0 42px -10px ${theme.glow}`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top glowing accent strip */}
        <div
          style={{
            height: 3,
            width: '100%',
            background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
          }}
        />

        {/* Header */}
        <div
          style={{
            padding: '16px 20px 12px 20px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: theme.accentSoft,
                border: `1px solid ${theme.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.accent,
                flexShrink: 0,
                boxShadow: `0 0 18px ${theme.glow}`,
              }}
            >
              <Icon size={20} />
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              {badge && (
                <span
                  style={{
                    display: 'inline-block',
                    marginBottom: 5,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: theme.accentSoft,
                    border: `1px solid ${theme.border}`,
                    color: theme.accent,
                    fontSize: '0.62rem',
                    fontWeight: 900,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {badge}
                </span>
              )}
              <h3
                id="studio-confirm-title"
                data-testid="studio-confirm-title"
                style={{
                  margin: 0,
                  fontSize: '0.96rem',
                  fontWeight: 900,
                  color: '#F8FAFC',
                  lineHeight: 1.38,
                }}
              >
                {title}
              </h3>
              {subtitle && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    color: '#94A3B8',
                    lineHeight: 1.4,
                  }}
                >
                  {subtitle}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => (showCancel ? onCancel?.() : onConfirm?.())}
            aria-label="បិទ"
            style={{
              width: 30,
              height: 30,
              borderRadius: 9999,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94A3B8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '2px 20px 18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 11,
          }}
        >
          {chipList.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                maxHeight: 88,
                overflowY: 'auto',
                padding: '8px 10px',
                borderRadius: 10,
                background: 'rgba(15, 23, 42, 0.72)',
                border: '1px solid rgba(255, 255, 255, 0.07)',
              }}
            >
              {chipList.map((chip, idx) => (
                <span
                  key={`${chip}-${idx}`}
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: theme.accentSoft,
                    border: `1px solid ${theme.border}`,
                    color: '#F8FAFC',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                >
                  {chip}
                </span>
              ))}
            </div>
          )}

          {bulletList.length > 0 && (
            <div
              style={{
                padding: '11px 13px',
                borderRadius: 12,
                background: 'rgba(7, 12, 24, 0.65)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {bulletList.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    fontSize: '0.76rem',
                    color: '#E2E8F0',
                    lineHeight: 1.5,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: theme.accent,
                      marginTop: 7,
                      flexShrink: 0,
                      boxShadow: `0 0 8px ${theme.accent}`,
                    }}
                  />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          )}

          {message && (
            <p
              style={{
                margin: 0,
                fontSize: '0.8rem',
                color: '#CBD5E1',
                lineHeight: 1.55,
                fontWeight: 600,
                whiteSpace: 'pre-line',
              }}
            >
              {message}
            </p>
          )}

          {question && (
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 800,
                color: '#F8FAFC',
                paddingTop: 2,
              }}
            >
              {question}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.07)',
            background: 'rgba(10, 16, 30, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          {showCancel && (
            <button
              ref={cancelBtnRef}
              type="button"
              data-testid="studio-confirm-cancel-btn"
              onClick={() => onCancel?.()}
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: '#E2E8F0',
                fontSize: '0.78rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {cancelLabel}
            </button>
          )}

          <button
            ref={okBtnRef}
            type="button"
            data-testid="studio-confirm-ok-btn"
            onClick={() => onConfirm?.()}
            style={{
              padding: '8px 18px',
              borderRadius: 10,
              background: theme.btnBg,
              border: `1px solid ${theme.btnBorder}`,
              color: theme.btnColor,
              fontSize: '0.78rem',
              fontWeight: 900,
              cursor: 'pointer',
              boxShadow: `0 4px 16px ${theme.glow}`,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalNode, document.body);
  }
  return modalNode;
}

