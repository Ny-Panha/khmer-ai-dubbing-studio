import React, { useState, useEffect } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, ChevronDown, ChevronUp,
  FlaskConical, Layers, Loader2, Pin, RefreshCw, Sparkles, X,
} from 'lucide-react';
import { useGeminiQuotaMonitor } from '../../hooks/useGeminiQuotaMonitor';
import {
  formatQuotaDuration,
  formatCompactTokenCount,
  formatQuotaMetricCount,
  getEffectiveModelMetrics,
  getModelRateStatusMeta,
  getQuotaBarAccent,
  applyElapsedCountdownToKeysHealth,
} from './geminiRouteHelpers';

const KEY_THEMES = {
  1: { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.3)', dot: '#38bdf8' },
  2: { color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.3)', dot: '#34d399' },
  3: { color: '#818cf8', bg: 'rgba(129, 140, 248, 0.12)', border: 'rgba(129, 140, 248, 0.3)', dot: '#818cf8' },
  4: { color: '#FF8577', bg: 'rgba(255, 133, 119, 0.12)', border: 'rgba(255, 133, 119, 0.3)', dot: '#FF8577' },
  5: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.3)', dot: '#fbbf24' },
  6: { color: '#e879f9', bg: 'rgba(232, 121, 249, 0.12)', border: 'rgba(232, 121, 249, 0.3)', dot: '#e879f9' },
};
const KEY_THEME_COUNT = Object.keys(KEY_THEMES).length;

const FALLBACK_CASCADE_OPTIONS = [
  { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite', perKey: { rpmLimit: 15, rpdLimit: 500 } },
  { id: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite', perKey: { rpmLimit: 15, rpdLimit: 500 } },
  { id: 'gemini-flash-lite-latest', displayName: 'Gemini Flash-Lite Latest', perKey: { rpmLimit: 15, rpdLimit: 500 } },
  { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', perKey: { rpmLimit: 5, rpdLimit: 20 } },
  { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', perKey: { rpmLimit: 5, rpdLimit: 20 } },
  { id: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', perKey: { rpmLimit: 5, rpdLimit: 20 } },
  { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', perKey: { rpmLimit: 5, rpdLimit: 20 } },
  { id: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash', perKey: { rpmLimit: 5, rpdLimit: 20 } },
  { id: 'gemini-flash-latest', displayName: 'Gemini Flash Latest', perKey: { rpmLimit: 5, rpdLimit: 20 } },
];

export default function GeminiQuotaModal({
  isOpen,
  onClose,
  onOpenBatchModal = null,
}) {
  const {
    keysHealth,
    isCheckingQuota,
    isTestingMatrix,
    isUpdatingQuotaSettings,
    lastLiveProbeAt,
    lastMatrixProbeAt,
    modelScopeMode,
    showAllModels,
    quotaNotice,
    quotaError,
    handleCheckQuota,
    handleToggleUseAllKeysFast,
    handleChangeDailyLimit,
    handleSelectPreferredModel,
    setModelScopeMode,
    setShowAllModels,
    clearQuotaNotice,
    clearQuotaError,
  } = useGeminiQuotaMonitor({
    enabled: Boolean(isOpen),
    initialProbe: 'models',
    pollIntervalMs: 6000,
  });

  const [quotaNowMs, setQuotaNowMs] = useState(() => Date.now());
  const [isModelMatrixOpen, setIsModelMatrixOpen] = useState(true);

  useEffect(() => {
    if (!isOpen) return undefined;
    const tickTimer = setInterval(() => {
      setQuotaNowMs(Date.now());
    }, 1000);
    return () => clearInterval(tickTimer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const liveView = applyElapsedCountdownToKeysHealth(keysHealth, quotaNowMs);
  const summary = liveView?.quotaSummary || null;
  const settings = liveView?.settings || keysHealth?.settings || {
    useAllKeysFast: true,
    rpmPerKey: 15,
    dailyRpdPerKey: 500,
    preferredModel: 'auto',
  };

  const useAllKeysFast = settings.useAllKeysFast !== false;
  const perKeyDailyLimit = settings.dailyRpdPerKey || 500;
  const preferredModel = settings.preferredModel || 'auto';
  const poolMultiplier = liveView?.poolMultiplier || Math.max(1, (liveView?.keys || []).length || 4);

  const allModelRows = Array.isArray(liveView?.modelRateLimits) ? liveView.modelRateLimits : [];
  const visibleModelRows = showAllModels
    ? allModelRows
    : allModelRows.filter((m) => m.usableInDubbing);
  const cascadeModelRows = allModelRows.filter((m) => m.usableInDubbing);
  const readyCascadeCount = summary?.readyCascadeModelsCount ?? cascadeModelRows.filter(
    (m) => m.liveStatus === 'ready' || m.liveStatus === 'partial' || m.liveStatus === 'untested'
  ).length;
  const totalCascadeCount = summary?.totalCascadeModelsCount ?? (cascadeModelRows.length || 10);

  const bestAvailableBackup = cascadeModelRows.find(
    (m) => m.id !== preferredModel && m.liveStatus === 'ready'
  ) || cascadeModelRows.find(
    (m) => m.id !== preferredModel && m.liveStatus === 'partial' && (preferredModel !== 'auto' || m.id !== cascadeModelRows[0]?.id)
  ) || cascadeModelRows.find(
    (m) => m.id !== preferredModel && m.liveStatus === 'untested'
  ) || null;

  const displayKeys = (liveView?.keys && liveView.keys.length > 0)
    ? liveView.keys
    : [1, 2, 3, 4].map((n) => ({
        keyNum: n,
        masked: null,
        status: 'ready',
        badge: `${settings.rpmPerKey || 15}/${settings.rpmPerKey || 15} RPM`,
        rpmUsed: 0,
        rpmLimit: settings.rpmPerKey || 15,
        rpmLeft: settings.rpmPerKey || 15,
        rpmPercent: 0,
        todayRequests: 0,
        todayTokens: 0,
        dailyLimit: perKeyDailyLimit,
        dailyLeft: perKeyDailyLimit,
        dailyPercent: 0,
      }));

  // Accurate per-key deduction for consistent header & monitor badges
  const activeExhaustedKeysCount = displayKeys.filter(
    (k) => (k.todayRequests || 0) >= perKeyDailyLimit
  ).length;
  const activeInvalidKeysCount = displayKeys.filter(
    (k) => (k.isInvalid || k.status === 'invalid' || k.status === 'error') && ((k.todayRequests || 0) < perKeyDailyLimit)
  ).length;
  const activeCooldownKeysCount = displayKeys.filter(
    (k) => k.status === 'rate_limited' && ((k.todayRequests || 0) < perKeyDailyLimit)
  ).length;

  const totalKeys = displayKeys.length || (summary?.totalKeys ?? 6);
  const dailyExhaustedKeys = activeExhaustedKeysCount;
  const invalidKeys = activeInvalidKeysCount;
  const cooldownKeys = activeCooldownKeysCount;
  const readyKeys = Math.max(0, totalKeys - dailyExhaustedKeys - invalidKeys - cooldownKeys);

  const rpmPerKey = settings.rpmPerKey || 15;
  const hdrRpmReady = readyKeys * rpmPerKey;
  const allReady = readyKeys === totalKeys && totalKeys > 0;
  const noneReady = readyKeys === 0 && totalKeys > 0;

  const hdrPillColor = noneReady ? '#F87171' : allReady ? '#34D399' : '#FBBF24';
  const hdrPillBg = noneReady ? 'rgba(248, 113, 113, 0.12)' : allReady ? 'rgba(52, 211, 153, 0.12)' : 'rgba(251, 191, 36, 0.12)';
  const hdrPillBorder = noneReady ? 'rgba(248, 113, 113, 0.35)' : allReady ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 191, 36, 0.35)';
  const hdrPillShadow = noneReady ? '0 0 12px rgba(248, 113, 113, 0.2)' : allReady ? '0 0 12px rgba(52, 211, 153, 0.2)' : '0 0 12px rgba(251, 191, 36, 0.2)';

  const hdrParts = [];
  if (dailyExhaustedKeys > 0) hdrParts.push(`⚠️ ${dailyExhaustedKeys} អស់ Quota`);
  if (invalidKeys > 0) hdrParts.push(`${invalidKeys} ខុស`);
  if (cooldownKeys > 0) hdrParts.push(`${cooldownKeys} Cooldown`);

  const hdrPillLabel = totalKeys > 0
    ? hdrParts.length > 0
      ? `${readyKeys}/${totalKeys} Keys Ready (${hdrRpmReady} RPM) • ${hdrParts.join(', ')}`
      : `${readyKeys}/${totalKeys} Keys Ready (${hdrRpmReady} RPM Pool)`
    : 'No Keys Configured';

  const rpmUsed = summary?.rpmUsed ?? 0;
  const rpmTotal = hdrRpmReady;
  const rpmLeft = Math.max(0, rpmTotal - rpmUsed);
  const rpmPercent = rpmTotal > 0 ? Math.min(100, Math.round((rpmUsed / rpmTotal) * 100)) : 0;
  const rpmResetsInSec = summary?.rpmResetsInSec ?? 0;

  const dailyUsed = summary?.dailyUsed ?? 0;
  const dailyTotal = summary?.dailyTotal ?? (totalKeys * perKeyDailyLimit);
  const dailyLeft = summary?.dailyLeft ?? Math.max(0, dailyTotal - dailyUsed);
  const dailyPercent = summary?.dailyPercent ?? 0;
  const appTodayRequests = summary?.appTodayRequests ?? displayKeys.reduce((acc, k) => acc + (k.todayRequests || 0), 0);
  const reportedDailyLimitPerKey = summary?.reportedDailyLimitPerKey ?? null;
  const primaryModelDisplay = summary?.primaryModelDisplayName || 'Primary Model';
  const todayTokens = summary?.todayTokens ?? 0;
  const dailyResetsInSec = summary?.dailyResetsInSec ?? 0;

  const rpmAccent = getQuotaBarAccent(rpmPercent, readyKeys === 0 && cooldownKeys > 0);
  const dailyAccent = getQuotaBarAccent(dailyPercent, dailyExhaustedKeys > 0 && readyKeys === 0);

  const hasExhaustion = dailyExhaustedKeys > 0 || invalidKeys > 0;
  const hasCooldown = cooldownKeys > 0;
  const isPinned = Boolean(preferredModel && preferredModel !== 'auto');

  let poolPillText = `${readyKeys}/${totalKeys} keys ready • ${hdrRpmReady} RPM`;
  let poolPillColor = allReady ? '#34D399' : '#FBBF24';
  if (isCheckingQuota) {
    poolPillText = '🔄 កំពុងផ្ទៀងផ្ទាត់ Quota ពិត...';
    poolPillColor = '#38BDF8';
  } else if (readyKeys === 0 && totalKeys > 0) {
    if (!isPinned && readyCascadeCount > 0) {
      poolPillText = `⚠️ ${primaryModelDisplay} អស់ • Auto Backup ${readyCascadeCount}/${totalCascadeCount} Ready`;
      poolPillColor = '#FBBF24';
    } else {
      poolPillText = `🔴 0/${totalKeys} ready (${dailyExhaustedKeys > 0 ? '429 អស់ថ្ងៃនេះ' : cooldownKeys > 0 ? '429 Cooldown' : 'Invalid'})`;
      poolPillColor = '#F87171';
    }
  } else if (hasExhaustion || hasCooldown) {
    const parts = [];
    if (dailyExhaustedKeys > 0) parts.push(`${dailyExhaustedKeys} អស់ Quota`);
    if (cooldownKeys > 0) parts.push(`${cooldownKeys} Cooldown`);
    if (invalidKeys > 0) parts.push(`${invalidKeys} ខុស`);
    poolPillText = `${readyKeys}/${totalKeys} ready • ${hdrRpmReady} RPM • ⚠️ ${parts.join(', ')}`;
    poolPillColor = '#FBBF24';
  }

  return (
    <div
      data-testid="gemini-quota-modal"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100010,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(5, 10, 24, 0.84)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(95vw, 1220px)',
          height: 'min(91vh, 880px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(20, 30, 51, 0.97)',
          border: '1px solid rgba(56, 189, 248, 0.16)',
          borderRadius: 20,
          boxShadow: '0 30px 100px -15px rgba(0, 0, 0, 0.88), 0 0 60px -10px rgba(56, 189, 248, 0.2)',
          overflow: 'hidden',
          fontFamily: "'Kantumruy Pro', system-ui, sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── MODAL HEADER ── */}
        <div
          style={{
            padding: '15px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(16, 25, 44, 0.96)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.22) 0%, rgba(52, 211, 153, 0.16) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38BDF8',
                boxShadow: '0 0 20px rgba(56, 189, 248, 0.24)',
                flexShrink: 0,
              }}
            >
              <Activity size={21} />
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '1.05rem',
                    fontWeight: 900,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    background: 'linear-gradient(135deg, #FFFFFF 0%, #BAE6FD 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  GEMINI KEYS &amp; MODEL QUOTA
                </h2>

                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    padding: '3px 10px',
                    borderRadius: 9999,
                    background: hdrPillBg,
                    color: hdrPillColor,
                    border: `1px solid ${hdrPillBorder}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: hdrPillShadow,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: hdrPillColor,
                      display: 'inline-block',
                      boxShadow: `0 0 6px ${hdrPillColor}`,
                    }}
                  />
                  {hdrPillLabel}
                </span>

                <span
                  data-testid="header-model-cascade-pill"
                  style={{
                    fontSize: '0.66rem',
                    fontWeight: 800,
                    padding: '3px 10px',
                    borderRadius: 9999,
                    background: isPinned ? 'rgba(255, 133, 119, 0.14)' : 'rgba(56, 189, 248, 0.12)',
                    color: isPinned ? '#FF8577' : '#38BDF8',
                    border: `1px solid ${isPinned ? 'rgba(255, 133, 119, 0.35)' : 'rgba(56, 189, 248, 0.32)'}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {isPinned ? <Pin size={10} /> : <Sparkles size={10} />}
                  <span>
                    {isPinned
                      ? `Primary: ${preferredModel}`
                      : `Auto Cascade (${readyCascadeCount}/${totalCascadeCount} Models)`}
                  </span>
                </span>
              </div>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.73rem', color: '#94A3B8' }}>
                តាមដាន Quota ពិត (RPM / TPM / RPD) របស់ {totalKeys > 1 ? `Key #1–#${totalKeys}` : totalKeys === 1 ? 'Key #1' : 'API Keys'} និងស្ថានភាព Model Cascade — ចុច Test ឬ Pin Model មុនពេល Generate!
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {onOpenBatchModal && (
              <button
                type="button"
                data-testid="btn-switch-to-batch"
                onClick={() => {
                  onClose?.();
                  onOpenBatchModal();
                }}
                className="btn-tactile"
                style={{
                  padding: '7px 13px',
                  borderRadius: 9999,
                  background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.24) 0%, rgba(37, 99, 235, 0.28) 100%)',
                  border: '1px solid rgba(56, 189, 248, 0.45)',
                  color: '#E0F2FE',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                title="ប្តូរទៅផ្ទាំង Batch Generate (Translate, Khmer TTS, Demucs & Export)"
              >
                <Layers size={13} color="#38BDF8" />
                <span>បើក Batch Generate</span>
                <ArrowRight size={13} color="#38BDF8" />
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="btn-tactile"
              style={{
                width: 34,
                height: 34,
                borderRadius: 9999,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94A3B8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 133, 119, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(255, 133, 119, 0.4)';
                e.currentTarget.style.color = '#FF8577';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = '#94A3B8';
              }}
              title="បិទ (ESC)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div
          data-testid="quota-modal-scroll-body"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '16px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {quotaNotice && (
            <div
              role="status"
              data-testid="quota-notice-banner"
              style={{
                padding: '9px 14px',
                borderRadius: 10,
                background: 'rgba(56, 189, 248, 0.14)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                color: '#bae6fd',
                fontSize: '0.75rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Sparkles size={14} color="#38BDF8" />
                <span>{quotaNotice}</span>
              </span>
              <button
                type="button"
                onClick={clearQuotaNotice}
                style={{ background: 'none', border: 'none', color: '#bae6fd', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {quotaError && (
            <div
              role="alert"
              data-testid="quota-error-banner"
              style={{
                padding: '9px 14px',
                borderRadius: 10,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#fca5a5',
                fontSize: '0.75rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <AlertCircle size={14} color="#F87171" />
                <span>{quotaError}</span>
              </span>
              <button
                type="button"
                onClick={clearQuotaError}
                style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Key Monitor & Real-Time Quota Pacing Card */}
          <div
            style={{
              background: 'rgba(11, 17, 32, 0.88)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {/* Header Title Row + Full-Width Balanced Controls Toolbar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  <span style={{ fontSize: '0.80rem', fontWeight: 800, color: '#F8FAFC', letterSpacing: '0.02em' }}>
                    ⚡ Gemini Quota &amp; Pool Monitor
                  </span>
                  <span
                    data-testid="quota-pool-pill"
                    style={{
                      fontSize: '0.67rem',
                      fontWeight: 700,
                      color: poolPillColor,
                      background: 'rgba(255, 255, 255, 0.04)',
                      padding: '2px 9px',
                      borderRadius: 9999,
                      border: `1px solid ${poolPillColor}40`,
                    }}
                  >
                    {poolPillText}
                  </span>
                  {reportedDailyLimitPerKey && perKeyDailyLimit > reportedDailyLimitPerKey && (
                    <span
                      style={{
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        color: '#FBBF24',
                        background: 'rgba(251, 191, 36, 0.10)',
                        border: '1px solid rgba(251, 191, 36, 0.30)',
                        padding: '2px 7px',
                        borderRadius: 9999,
                      }}
                      title={`Google API បានបញ្ជាក់ Free Tier limit: ${reportedDailyLimitPerKey}/day ខុសពី Limit/Key (${perKeyDailyLimit.toLocaleString()})`}
                    >
                      Google Free Cap: {reportedDailyLimitPerKey}/key
                    </span>
                  )}
                </div>

                {lastLiveProbeAt && !isCheckingQuota && (
                  <span style={{ fontSize: '0.63rem', color: '#64748B', fontWeight: 600, flexShrink: 0 }}>
                    ✓ Live tested {new Date(lastLiveProbeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>

              <div
                data-testid="quota-controls-toolbar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '7px 10px',
                  borderRadius: 10,
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                {/* Left: Model + Limit/Key Selectors */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Primary Model Selector */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.66rem',
                    color: '#94A3B8',
                    background: isPinned
                      ? 'rgba(255, 133, 119, 0.10)'
                      : 'rgba(255, 255, 255, 0.03)',
                    border: isPinned
                      ? '1px solid rgba(255, 133, 119, 0.38)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 9,
                    padding: '4px 8px',
                  }}
                  title="ជ្រើសរើស Model ចម្បងសម្រាប់ដំណើរការបកប្រែ ឬទុក Auto ដើម្បីរត់ Cascade ទាំង 10 Models ស្វ័យប្រវត្តិ"
                >
                  <span>Model:</span>
                  <select
                    data-testid="select-preferred-model"
                    value={preferredModel}
                    disabled={isUpdatingQuotaSettings}
                    onChange={(e) => handleSelectPreferredModel(e.target.value)}
                    style={{
                      background: 'transparent',
                      color: isPinned ? '#FF8577' : '#38BDF8',
                      border: 'none',
                      outline: 'none',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      maxWidth: 195,
                    }}
                  >
                    <option value="auto" style={{ background: '#0F172A', color: '#38BDF8' }}>
                      {`✨ Auto (${readyCascadeCount || 10}/${totalCascadeCount || 10} Models)`}
                    </option>
                    {(cascadeModelRows.length > 0 ? cascadeModelRows : FALLBACK_CASCADE_OPTIONS).map((opt) => (
                      <option key={opt.id} value={opt.id} style={{ background: '#0F172A', color: '#E2E8F0' }}>
                        {`${opt.displayName} (${opt.perKey?.rpmLimit || 5} RPM)`}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Daily Cap Selector */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.66rem',
                    color: '#94A3B8',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 9,
                    padding: '4px 8px',
                  }}
                  title="កំណត់ Daily Request Limit ក្នុង 1 Key ដើម្បីគណនា Progress Bar ឱ្យត្រូវនឹង Plan Google របស់បង"
                >
                  <span>Limit/Key:</span>
                  <select
                    value={perKeyDailyLimit}
                    disabled={isUpdatingQuotaSettings}
                    onChange={(e) => handleChangeDailyLimit(Number(e.target.value))}
                    style={{
                      background: 'transparent',
                      color: '#E2E8F0',
                      border: 'none',
                      outline: 'none',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <option value={250} style={{ background: '#0F172A' }}>250 (Free Low)</option>
                    <option value={500} style={{ background: '#0F172A' }}>500 (Free Flash-Lite)</option>
                    <option value={1000} style={{ background: '#0F172A' }}>1,000 (Free Lite)</option>
                    <option value={1500} style={{ background: '#0F172A' }}>1,500 (Free Std)</option>
                    <option value={10000} style={{ background: '#0F172A' }}>10,000 (Paid T1)</option>
                  </select>
                </label>
                </div>

                {/* Right: Pacing Toggle + Real 1-Token Quota Probe */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Use All Keys / Safe Pacing Toggle Card */}
                <button
                  type="button"
                  onClick={handleToggleUseAllKeysFast}
                  disabled={isUpdatingQuotaSettings}
                  className="btn-tactile"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '5px 11px',
                    borderRadius: 10,
                    background: useAllKeysFast ? 'rgba(245, 158, 11, 0.10)' : 'rgba(52, 211, 153, 0.10)',
                    border: useAllKeysFast ? '1px solid rgba(245, 158, 11, 0.38)' : '1px solid rgba(52, 211, 153, 0.38)',
                    cursor: isUpdatingQuotaSettings ? 'wait' : 'pointer',
                    transition: 'all 0.18s ease',
                  }}
                  title={useAllKeysFast ? 'ចុចដើម្បីបើក Safe Pacing (ការពារ 429)' : 'ចុចដើម្បីបើក Use All Keys លឿនពេញ'}
                >
                  <span
                    style={{
                      width: 32,
                      height: 18,
                      borderRadius: 9999,
                      background: useAllKeysFast ? '#F59E0B' : 'rgba(148, 163, 184, 0.35)',
                      position: 'relative',
                      display: 'inline-flex',
                      alignItems: 'center',
                      transition: 'background 0.2s ease',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: '#0F172A',
                        transform: useAllKeysFast ? 'translateX(16px)' : 'translateX(2px)',
                        transition: 'transform 0.2s ease',
                      }}
                    />
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#F8FAFC' }}>
                      {useAllKeysFast ? 'Use all keys' : 'Safe pacing'}
                    </span>
                    <span style={{ fontSize: '0.58rem', color: useAllKeysFast ? '#FCD34D' : '#6EE7B7', fontWeight: 600 }}>
                      {useAllKeysFast ? 'Pacing off • Max speed' : 'Anti-429 throttle'}
                    </span>
                  </div>
                </button>

                {/* Real 1-Token Quota Probe Button */}
                <button
                  type="button"
                  onClick={() => handleCheckQuota('live')}
                  disabled={isCheckingQuota}
                  className="btn-tactile"
                  style={{
                    background: isCheckingQuota ? 'rgba(56, 189, 248, 0.18)' : 'rgba(56, 189, 248, 0.10)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#38BDF8',
                    borderRadius: 10,
                    padding: '6px 12px',
                    fontSize: '0.70rem',
                    fontWeight: 800,
                    cursor: isCheckingQuota ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  title="ផ្ញើ 1-token test ពិតទៅ Gemini API ដើម្បីដឹងច្បាស់ថា Key ណាជាប់ 429 ឬនៅ Ready ពិត"
                >
                  <RefreshCw size={12} className={isCheckingQuota ? 'animate-spin' : ''} />
                  <span>{isCheckingQuota ? 'កំពុង Test...' : '⚡ ពិនិត្យ Quota ពិត'}</span>
                </button>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '0.67rem', color: '#94A3B8', lineHeight: 1.35 }}>
                {useAllKeysFast
                  ? 'Pacing off: ប្រើ Quota គ្រប់ Key ពេញល្បឿនភ្លាមៗ — គ្មានការពន្យឺតរវាង Batch ទេ (Same total quota either way).'
                  : 'Safe pacing on: បន្ថយល្បឿនបន្តិចពេល Key ជិតពេញ 15 RPM — ជួយការពារ Error 429 ពេល Translate ភាគវែង។'}
              </p>
            </div>

            {/* Contextual DragonDub Exhaustion & Auto-Cascade Strip */}
            {((readyKeys === 0 && totalKeys > 0) || cooldownKeys > 0 || dailyExhaustedKeys > 0) && (
              <div
                data-testid="quota-exhaustion-banner"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: readyKeys === 0
                    ? 'linear-gradient(90deg, rgba(248, 113, 113, 0.14) 0%, rgba(255, 133, 119, 0.08) 100%)'
                    : 'linear-gradient(90deg, rgba(251, 191, 36, 0.13) 0%, rgba(56, 189, 248, 0.07) 100%)',
                  border: readyKeys === 0
                    ? '1px solid rgba(248, 113, 113, 0.42)'
                    : '1px solid rgba(251, 191, 36, 0.38)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                  <AlertTriangle
                    size={15}
                    color={readyKeys === 0 ? '#F87171' : '#FBBF24'}
                    style={{ flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '0.70rem', fontWeight: 700, color: '#F8FAFC', lineHeight: 1.35 }}>
                    {readyKeys === 0 && bestAvailableBackup
                      ? `Quota លើ ${preferredModel === 'auto' ? 'Primary Model' : preferredModel} កំពុងពេញ 429 — Auto Cascade អាចបន្តទៅ «${bestAvailableBackup.displayName}» ឬចុច Pin ផ្ទាល់។`
                      : readyKeys === 0
                        ? `Key ទាំង ${totalKeys} កំពុងជាប់ 429 — ចុច «🔬 Test គ្រប់ Model» ដើម្បីរក Model ទំនេរផ្សេងក្នុង Pool (${totalCascadeCount} Models)។`
                        : `មាន ${cooldownKeys + dailyExhaustedKeys} Key កំពុងជាប់ 429 • នៅសល់ ${readyKeys}/${totalKeys} Key ទំនេរ + Pool ${totalCascadeCount} Models អាចរត់បន្តស្វ័យប្រវត្តិ។`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => handleCheckQuota('matrix', { allModels: showAllModels })}
                    disabled={isTestingMatrix || isCheckingQuota}
                    className="btn-tactile"
                    style={{
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: 'rgba(56, 189, 248, 0.14)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      color: '#38BDF8',
                      fontSize: '0.67rem',
                      fontWeight: 800,
                      cursor: isTestingMatrix ? 'wait' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <FlaskConical size={11} />
                    <span>{isTestingMatrix ? 'កំពុង Scan...' : 'Test គ្រប់ Model'}</span>
                  </button>
                  {bestAvailableBackup && (
                    <button
                      type="button"
                      onClick={() => handleSelectPreferredModel(bestAvailableBackup.id)}
                      disabled={isUpdatingQuotaSettings}
                      className="btn-tactile"
                      style={{
                        padding: '4px 10px',
                        borderRadius: 8,
                        background: 'rgba(52, 211, 153, 0.16)',
                        border: '1px solid rgba(52, 211, 153, 0.45)',
                        color: '#34D399',
                        fontSize: '0.67rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Pin size={10} />
                      <span>ប្តូរទៅ {bestAvailableBackup.displayName}</span>
                    </button>
                  )}
                  {isPinned && (
                    <button
                      type="button"
                      onClick={() => handleSelectPreferredModel('auto')}
                      disabled={isUpdatingQuotaSettings}
                      className="btn-tactile"
                      style={{
                        padding: '4px 9px',
                        borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.14)',
                        color: '#E2E8F0',
                        fontSize: '0.66rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Auto Mode
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Two Side-by-Side Quota Progress Bars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.70rem' }}>
                  <span style={{ color: '#94A3B8', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                    Rate Limit (1m RPM)
                  </span>
                  <span style={{ color: '#E2E8F0', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>
                    {rpmLeft.toLocaleString()} of {rpmTotal.toLocaleString()} left
                  </span>
                </div>
                <div style={{ width: '100%', height: 6, borderRadius: 9999, background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${rpmPercent}%`,
                      height: '100%',
                      borderRadius: 9999,
                      background: rpmAccent.bar,
                      boxShadow: `0 0 8px ${rpmAccent.glow}`,
                      transition: 'width 0.35s ease, background 0.25s ease',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.62rem', color: '#94A3B8', fontFamily: "'JetBrains Mono', monospace" }}>
                  <span>
                    {(cooldownKeys + dailyExhaustedKeys) > 0
                      ? `${cooldownKeys + dailyExhaustedKeys} key បិទលើ ${primaryModelDisplay} • ${rpmUsed} req/1m`
                      : `${rpmUsed.toLocaleString()} used (${rpmPercent}%)`}
                  </span>
                  <span style={{ color: cooldownKeys > 0 ? '#FBBF24' : '#64748B', fontWeight: 700 }}>
                    {rpmResetsInSec > 0 ? `resets in ${formatQuotaDuration(rpmResetsInSec)}` : 'resets every 60s'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.70rem', flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#94A3B8', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                      Today ({dailyExhaustedKeys > 0 && dailyLeft === 0 ? primaryModelDisplay : 'RPD & Tokens'})
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '1px 8px',
                        borderRadius: 6,
                        background: 'rgba(245, 158, 11, 0.14)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        color: '#FCD34D',
                        fontWeight: 800,
                        fontSize: '0.64rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      ⏰ Reset ម៉ោង 3:00 PM ({dailyResetsInSec > 0 ? `សល់ ${formatQuotaDuration(dailyResetsInSec)}` : '0s'})
                    </span>
                  </div>
                  <span style={{ color: '#E2E8F0', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                    {dailyExhaustedKeys > 0 && dailyLeft === 0
                      ? `0 left on ${primaryModelDisplay}`
                      : `${dailyLeft.toLocaleString()} of ${dailyTotal.toLocaleString()} left`}
                  </span>
                </div>
                <div style={{ width: '100%', height: 6, borderRadius: 9999, background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${dailyPercent}%`,
                      height: '100%',
                      borderRadius: 9999,
                      background: dailyAccent.bar,
                      boxShadow: `0 0 8px ${dailyAccent.glow}`,
                      transition: 'width 0.35s ease, background 0.25s ease',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.62rem', color: '#94A3B8', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                  <span>
                    {dailyExhaustedKeys > 0 && appTodayRequests < dailyUsed
                      ? `App: ${appTodayRequests.toLocaleString()} req • Google ${reportedDailyLimitPerKey ? `${reportedDailyLimitPerKey}/key` : '429'} អស់ • ${formatCompactTokenCount(todayTokens)} tok`
                      : `${dailyUsed.toLocaleString()} used (${dailyPercent}%) • ${formatCompactTokenCount(todayTokens)} tok`}
                  </span>
                  <span style={{ color: dailyExhaustedKeys > 0 ? '#F87171' : '#64748B', fontWeight: 700 }}>
                    {dailyResetsInSec > 0 ? `resets in ${formatQuotaDuration(dailyResetsInSec)}` : 'resets midnight PT'}
                  </span>
                </div>
              </div>
            </div>

            {/* Per-Key Breakdown Strip (Clean Symmetrical 3x2 Grid) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 10,
              }}
            >
              {displayKeys.map((liveKeyData) => {
                const kNum = liveKeyData.keyNum;
                const theme = KEY_THEMES[((kNum - 1) % KEY_THEME_COUNT) + 1] || KEY_THEMES[1];
                const keyDailyLeft = Math.max(0, perKeyDailyLimit - (liveKeyData.todayRequests || 0));
                const keyPercent = Math.min(100, Math.round(((liveKeyData.todayRequests || 0) / perKeyDailyLimit) * 100));
                const isDailyExhausted = !isCheckingQuota && (
                  keyDailyLeft <= 0 ||
                  (liveKeyData.todayRequests || 0) >= perKeyDailyLimit
                );
                const isRateLimited = !isCheckingQuota && !isDailyExhausted && liveKeyData.status === 'rate_limited';
                const isInvalid = !isCheckingQuota && !isDailyExhausted && liveKeyData.status === 'invalid';
                const isError = !isCheckingQuota && !isDailyExhausted && liveKeyData.status === 'error';

                let badgeText = `${liveKeyData.rpmLeft ?? 15}/${liveKeyData.rpmLimit ?? 15} RPM`;
                if (isCheckingQuota) {
                  badgeText = 'កំពុង Test...';
                } else if (isDailyExhausted) {
                  badgeText = '🔴 អស់ Quota (0 Left)';
                } else if (isRateLimited) {
                  badgeText = liveKeyData.cooldownSec > 0
                    ? `Wait ${formatQuotaDuration(liveKeyData.cooldownSec)}`
                    : (liveKeyData.badge || '429 Wait');
                } else if (isInvalid || isError) {
                  badgeText = liveKeyData.badge || 'Key ខុស';
                } else if (liveKeyData.lastProbeCode === 200 && (liveKeyData.rpmUsed || 0) === 0) {
                  badgeText = keyPercent >= 80 ? `⚠️ សល់តែ ${keyDailyLeft}` : '✓ Ready (200)';
                }

                const badgeColor = isCheckingQuota
                  ? '#38BDF8'
                  : isDailyExhausted
                    ? '#F87171'
                    : isRateLimited
                      ? '#FBBF24'
                      : (isInvalid || isError)
                        ? '#EF4444'
                        : keyPercent >= 80
                          ? '#FBBF24'
                          : '#34D399';
                const badgeBg = isCheckingQuota
                  ? 'rgba(56, 189, 248, 0.12)'
                  : isDailyExhausted
                    ? 'rgba(248, 113, 113, 0.12)'
                    : isRateLimited
                      ? 'rgba(251, 191, 36, 0.12)'
                      : (isInvalid || isError)
                        ? 'rgba(239, 68, 68, 0.12)'
                        : keyPercent >= 80
                          ? 'rgba(245, 158, 11, 0.12)'
                          : 'rgba(52, 211, 153, 0.10)';
                const badgeBorder = isCheckingQuota
                  ? 'rgba(56, 189, 248, 0.35)'
                  : isDailyExhausted
                    ? 'rgba(248, 113, 113, 0.35)'
                    : isRateLimited
                      ? 'rgba(251, 191, 36, 0.35)'
                      : (isInvalid || isError)
                        ? 'rgba(239, 68, 68, 0.35)'
                        : keyPercent >= 80
                          ? 'rgba(245, 158, 11, 0.35)'
                          : 'rgba(52, 211, 153, 0.28)';
                const dotColor = isCheckingQuota
                  ? '#38BDF8'
                  : isDailyExhausted
                    ? '#F87171'
                    : isRateLimited
                      ? '#FBBF24'
                      : (isInvalid || isError)
                        ? '#EF4444'
                        : keyPercent >= 80
                          ? '#FBBF24'
                          : '#34D399';

                return (
                  <div
                    key={kNum}
                    title={liveKeyData.lastErrorMessage || (liveKeyData.lastModelUsed ? `Last model: ${liveKeyData.lastModelUsed}` : `Key #${kNum}`)}
                    style={{
                      background: isDailyExhausted
                        ? 'rgba(239, 68, 68, 0.05)'
                        : isRateLimited
                          ? 'rgba(245, 158, 11, 0.05)'
                          : 'rgba(15, 23, 42, 0.72)',
                      border: `1px solid ${isDailyExhausted ? 'rgba(248, 113, 113, 0.35)' : isRateLimited ? 'rgba(251, 191, 36, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: dotColor,
                            boxShadow: `0 0 6px ${dotColor}`,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#F8FAFC' }}>Key #{kNum}</span>
                        {liveKeyData.masked && (
                          <code
                            style={{
                              fontSize: '0.62rem',
                              background: 'rgba(0, 0, 0, 0.35)',
                              color: '#94A3B8',
                              padding: '1px 5px',
                              borderRadius: 4,
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              fontFamily: "'JetBrains Mono', monospace",
                            }}
                          >
                            {liveKeyData.masked}
                          </code>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: '0.63rem',
                          fontWeight: 800,
                          color: badgeColor,
                          background: badgeBg,
                          border: `1px solid ${badgeBorder}`,
                          padding: '2px 7px',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isCheckingQuota ? <Loader2 size={9} className="animate-spin" /> : (isDailyExhausted ? '🔴 ' : isRateLimited ? '⏳ ' : (isInvalid || isError) ? '❌ ' : '')}
                        {badgeText}
                      </span>
                    </div>

                    {/* Mini Usage Progress Bar */}
                    <div style={{ width: '100%', height: 4, borderRadius: 9999, background: 'rgba(255, 255, 255, 0.07)', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${keyPercent}%`,
                          height: '100%',
                          borderRadius: 9999,
                          background: isDailyExhausted
                            ? '#F87171'
                            : isRateLimited
                              ? '#FBBF24'
                              : keyPercent >= 80
                                ? '#F59E0B'
                                : '#38BDF8',
                          transition: 'width 0.35s ease',
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.63rem', color: '#94A3B8', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                      <span>
                        {isDailyExhausted
                          ? `${liveKeyData.todayRequests || 0}/${perKeyDailyLimit} req (អស់ Quota)`
                          : `Used: ${liveKeyData.todayRequests || 0} • Left: ${keyDailyLeft}`}
                      </span>
                      <span>{formatCompactTokenCount(liveKeyData.todayTokens || 0)} tok</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DragonDub Rate Limits by Model Matrix */}
          <div
            data-testid="model-rate-limits-panel"
            style={{
              borderRadius: 14,
              background: 'rgba(8, 13, 26, 0.78)',
              border: '1px solid rgba(56, 189, 248, 0.18)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Toolbar */}
            <div
              style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
                background: 'rgba(15, 23, 42, 0.88)',
                borderBottom: isModelMatrixOpen ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Activity size={14} color="#38BDF8" />
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#F8FAFC', letterSpacing: '0.02em' }}>
                  Rate limits by model
                </span>
                <span
                  style={{
                    fontSize: '0.64rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: 'rgba(52, 211, 153, 0.12)',
                    color: '#34D399',
                    border: '1px solid rgba(52, 211, 153, 0.3)',
                  }}
                >
                  {readyCascadeCount}/{totalCascadeCount} Ready
                </span>
                {isPinned && (
                  <span
                    style={{
                      fontSize: '0.64rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 9999,
                      background: 'rgba(255, 133, 119, 0.14)',
                      color: '#FF8577',
                      border: '1px solid rgba(255, 133, 119, 0.35)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Pin size={9} />
                    <span>Pinned: {preferredModel}</span>
                  </span>
                )}
                {lastMatrixProbeAt && !isTestingMatrix && (
                  <span style={{ fontSize: '0.61rem', color: '#64748B', fontWeight: 600 }}>
                    ✓ Tested {new Date(lastMatrixProbeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Scope Toggle: 4 Keys Pool vs Per Key */}
                <div
                  role="group"
                  aria-label="Quota Scope Mode"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: 2,
                    borderRadius: 8,
                    background: 'rgba(15, 23, 42, 0.9)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    gap: 2,
                  }}
                >
                  <button
                    type="button"
                    data-testid="btn-scope-pool"
                    onClick={() => setModelScopeMode('pool')}
                    style={{
                      padding: '3px 9px',
                      borderRadius: 6,
                      border: 'none',
                      background: modelScopeMode === 'pool' ? 'rgba(56, 189, 248, 0.20)' : 'transparent',
                      color: modelScopeMode === 'pool' ? '#38BDF8' : '#94A3B8',
                      fontSize: '0.64rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {poolMultiplier} Keys Pool (×{poolMultiplier})
                  </button>
                  <button
                    type="button"
                    data-testid="btn-scope-per-key"
                    onClick={() => setModelScopeMode('per_key')}
                    style={{
                      padding: '3px 9px',
                      borderRadius: 6,
                      border: 'none',
                      background: modelScopeMode === 'per_key' ? 'rgba(56, 189, 248, 0.20)' : 'transparent',
                      color: modelScopeMode === 'per_key' ? '#38BDF8' : '#94A3B8',
                      fontSize: '0.64rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Per Key (1×)
                  </button>
                </div>

                {/* All models Switch */}
                <button
                  type="button"
                  data-testid="toggle-all-models"
                  onClick={() => setShowAllModels((prev) => !prev)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 9px',
                    borderRadius: 8,
                    background: showAllModels ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                    border: showAllModels ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: showAllModels ? '#38BDF8' : '#CBD5E1',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  title="បង្ហាញគ្រប់ Model ទាំងអស់ រួមទាំង Gemini 3.5 Transcribe, Gemma 4 និង Model ដែលបិទ Free Limit"
                >
                  <span
                    style={{
                      width: 24,
                      height: 13,
                      borderRadius: 9999,
                      background: showAllModels ? '#38BDF8' : 'rgba(148, 163, 184, 0.35)',
                      position: 'relative',
                      display: 'inline-flex',
                      alignItems: 'center',
                      transition: 'background 0.2s ease',
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: '#0F172A',
                        transform: showAllModels ? 'translateX(13px)' : 'translateX(2px)',
                        transition: 'transform 0.2s ease',
                      }}
                    />
                  </span>
                  <span>All models ({allModelRows.length || 17})</span>
                </button>

                {/* Matrix Live Probe */}
                <button
                  type="button"
                  data-testid="btn-test-all-models"
                  onClick={() => handleCheckQuota('matrix', { allModels: showAllModels })}
                  disabled={isTestingMatrix || isCheckingQuota}
                  className="btn-tactile"
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    background: isTestingMatrix
                      ? 'rgba(56, 189, 248, 0.22)'
                      : 'linear-gradient(135deg, rgba(56, 189, 248, 0.16) 0%, rgba(14, 165, 233, 0.12) 100%)',
                    border: '1px solid rgba(56, 189, 248, 0.42)',
                    color: '#38BDF8',
                    fontSize: '0.66rem',
                    fontWeight: 800,
                    cursor: isTestingMatrix ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                  title="Test 1-token ផ្ទៀងផ្ទាត់ Model នីមួយៗក្នុង Cascade (200 Ready / 429 Full / 503 Busy)"
                >
                  {isTestingMatrix ? <Loader2 size={11} className="animate-spin" /> : <FlaskConical size={11} />}
                  <span>{isTestingMatrix ? 'កំពុង Test...' : '🔬 Test គ្រប់ Model'}</span>
                </button>

                {/* Collapse Button */}
                <button
                  type="button"
                  data-testid="toggle-model-matrix"
                  onClick={() => setIsModelMatrixOpen((prev) => !prev)}
                  aria-expanded={isModelMatrixOpen}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#94A3B8',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title={isModelMatrixOpen ? 'បង្រួមតារាង Model' : 'ពង្រីកតារាង Model'}
                >
                  {isModelMatrixOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>
            </div>

            {isModelMatrixOpen && (
              <>
                <div
                  data-testid="model-rate-table-scroll"
                  style={{ maxHeight: 380, overflowY: 'auto', overflowX: 'auto' }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.69rem' }}>
                    <thead
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        background: 'rgba(13, 20, 38, 0.98)',
                        borderBottom: '1px solid rgba(56, 189, 248, 0.14)',
                      }}
                    >
                      <tr style={{ color: '#64748B', fontSize: '0.61rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '8px 12px', fontWeight: 800 }}>Model</th>
                        <th style={{ padding: '8px 8px', fontWeight: 800 }}>Category</th>
                        <th style={{ padding: '8px 10px', fontWeight: 800 }}>RPM</th>
                        <th style={{ padding: '8px 10px', fontWeight: 800 }}>TPM</th>
                        <th style={{ padding: '8px 10px', fontWeight: 800 }}>RPD</th>
                        <th style={{ padding: '8px 12px', fontWeight: 800, textAlign: 'right' }}>Status &amp; Pin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleModelRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: '16px 12px', textAlign: 'center', color: '#64748B' }}>
                            កំពុងផ្ទុកបញ្ជី Model Cascade (10 Active / 17 Total)...
                          </td>
                        </tr>
                      ) : (
                        visibleModelRows.map((row) => {
                          const eff = getEffectiveModelMetrics(row, modelScopeMode);
                          const statusMeta = getModelRateStatusMeta(row);
                          const isPinnedRow = preferredModel === row.id;
                          const isExhaustedRow = row.liveStatus === 'exhausted' || row.liveStatus === 'zero_limit' || row.liveStatus === 'deprecated';

                          const renderMetricCell = (used, limit, pct, forceExhausted = false) => {
                            const accent = getQuotaBarAccent(pct, forceExhausted);
                            const fillWidth = limit <= 0 ? 0 : (used > 0 ? Math.max(5, pct) : 0);
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 112 }}>
                                <div
                                  style={{
                                    width: 46,
                                    height: 5,
                                    borderRadius: 9999,
                                    background: 'rgba(255, 255, 255, 0.07)',
                                    overflow: 'hidden',
                                    flexShrink: 0,
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${fillWidth}%`,
                                      height: '100%',
                                      borderRadius: 9999,
                                      background: limit <= 0 ? 'rgba(100, 116, 139, 0.25)' : accent.bar,
                                      boxShadow: fillWidth > 0 ? `0 0 6px ${accent.glow}` : 'none',
                                      transition: 'width 0.3s ease',
                                    }}
                                  />
                                </div>
                                <span
                                  style={{
                                    fontFamily: "'JetBrains Mono', monospace",
                                    fontVariantNumeric: 'tabular-nums',
                                    fontSize: '0.66rem',
                                    fontWeight: 700,
                                    color: limit <= 0 ? '#64748B' : (forceExhausted || pct >= 90) ? '#FCA5A5' : '#E2E8F0',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatQuotaMetricCount(used)} / {formatQuotaMetricCount(limit)}
                                </span>
                              </div>
                            );
                          };

                          return (
                            <tr
                              key={row.id}
                              data-testid={`model-rate-row-${row.id}`}
                              title={row.notes || row.id}
                              style={{
                                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                                background: isPinnedRow
                                  ? 'rgba(255, 133, 119, 0.07)'
                                  : isExhaustedRow
                                    ? 'rgba(15, 23, 42, 0.35)'
                                    : 'transparent',
                                opacity: (!row.usableInApp && row.liveStatus !== 'deprecated') ? 0.65 : (row.deprecated ? 0.62 : 1),
                              }}
                            >
                              <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                  {row.cascadeRank ? (
                                    <span
                                      style={{
                                        fontSize: '0.57rem',
                                        fontWeight: 800,
                                        fontFamily: "'JetBrains Mono', monospace",
                                        padding: '1px 5px',
                                        borderRadius: 5,
                                        background: isPinnedRow ? 'rgba(255, 133, 119, 0.2)' : 'rgba(56, 189, 248, 0.12)',
                                        color: isPinnedRow ? '#FF8577' : '#7DD3FC',
                                        border: isPinnedRow ? '1px solid rgba(255, 133, 119, 0.4)' : '1px solid rgba(56, 189, 248, 0.24)',
                                      }}
                                    >
                                      #{row.cascadeRank}
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: '0.57rem',
                                        fontWeight: 700,
                                        padding: '1px 5px',
                                        borderRadius: 5,
                                        background: 'rgba(148, 163, 184, 0.1)',
                                        color: '#94A3B8',
                                      }}
                                    >
                                      REF
                                    </span>
                                  )}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <span style={{ fontWeight: 800, color: isPinnedRow ? '#FF8577' : '#F8FAFC', fontSize: '0.71rem' }}>
                                      {row.displayName}
                                    </span>
                                    <code style={{ fontSize: '0.57rem', color: '#64748B', fontFamily: "'JetBrains Mono', monospace" }}>
                                      {row.id}
                                    </code>
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#94A3B8', fontSize: '0.64rem', fontWeight: 600 }}>
                                  {row.category}
                                </span>
                              </td>
                              <td style={{ padding: '7px 10px' }}>
                                {renderMetricCell(eff.rpmUsed, eff.rpmLimit, eff.rpmPct, row.liveStatus === 'rate_limited')}
                              </td>
                              <td style={{ padding: '7px 10px' }}>
                                {renderMetricCell(eff.tpmUsed, eff.tpmLimit, eff.tpmPct, false)}
                              </td>
                              <td style={{ padding: '7px 10px' }}>
                                {renderMetricCell(eff.rpdUsed, eff.rpdLimit, eff.rpdPct, row.liveStatus === 'exhausted')}
                              </td>
                              <td style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                  {Number.isFinite(row.lastLatencyMs) && row.lastLatencyMs > 0 && (
                                    <span style={{ fontSize: '0.58rem', color: '#64748B', fontFamily: "'JetBrains Mono', monospace" }}>
                                      {row.lastLatencyMs}ms
                                    </span>
                                  )}
                                  <span
                                    title={row.lastErrorMessage || row.notes}
                                    style={{
                                      fontSize: '0.62rem',
                                      fontWeight: 800,
                                      padding: '2px 7px',
                                      borderRadius: 9999,
                                      color: statusMeta.color,
                                      background: statusMeta.bg,
                                      border: `1px solid ${statusMeta.border}`,
                                    }}
                                  >
                                    {statusMeta.label}
                                  </span>
                                  {row.usableInDubbing ? (
                                    <button
                                      type="button"
                                      data-testid={`btn-pin-model-${row.id}`}
                                      disabled={isUpdatingQuotaSettings}
                                      onClick={() => handleSelectPreferredModel(isPinnedRow ? 'auto' : row.id)}
                                      className="btn-tactile"
                                      style={{
                                        padding: '2px 8px',
                                        borderRadius: 7,
                                        fontSize: '0.62rem',
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        background: isPinnedRow
                                          ? 'rgba(255, 133, 119, 0.20)'
                                          : 'rgba(56, 189, 248, 0.10)',
                                        border: isPinnedRow
                                          ? '1px solid rgba(255, 133, 119, 0.5)'
                                          : '1px solid rgba(56, 189, 248, 0.35)',
                                        color: isPinnedRow ? '#FF8577' : '#38BDF8',
                                      }}
                                      title={isPinnedRow
                                        ? 'កំពុងប្រើ Model នេះជា Primary — ចុចដើម្បីត្រឡប់ទៅ Auto Cascade'
                                        : `កំណត់ ${row.displayName} ជា Primary Model មុនគេ`}
                                    >
                                      <Pin size={10} />
                                      <span>{isPinnedRow ? 'Pinned ✓' : 'Use First'}</span>
                                    </button>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: '0.60rem',
                                        fontWeight: 700,
                                        padding: '2px 7px',
                                        borderRadius: 7,
                                        background: 'rgba(255, 255, 255, 0.04)',
                                        border: '1px solid rgba(255, 255, 255, 0.08)',
                                        color: row.id === 'gemini-3.5-transcribe' ? '#7DD3FC' : '#64748B',
                                      }}
                                      title={row.notes}
                                    >
                                      {row.id === 'gemini-3.5-transcribe' ? 'STT Stage 4 Only' : row.roleTag}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    padding: '8px 14px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    background: 'rgba(15, 23, 42, 0.65)',
                    fontSize: '0.62rem',
                    color: '#64748B',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    រាប់ Request/Token ពិតក្នុង App + Live Probe (200/429/503) + PT Midnight Reset • Google API មិនអាចទាញ Log ក្រៅ App មកបង្ហាញទេ។
                  </span>
                  <span style={{ color: '#94A3B8', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                    Pool = Active Keys × Model Limit
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── MODAL FOOTER ── */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(16, 25, 44, 0.96)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            flexShrink: 0,
            fontSize: '0.73rem',
            color: '#94A3B8',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <span style={{ color: '#E2E8F0', fontWeight: 700 }}>
              Pool: <strong style={{ color: readyKeys > 0 ? '#34D399' : '#F87171' }}>{readyKeys}/{totalKeys} Keys</strong>
            </span>
            <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>|</span>
            <span style={{ color: '#E2E8F0', fontWeight: 700 }}>
              Cascade: <strong style={{ color: '#38BDF8' }}>{readyCascadeCount}/{totalCascadeCount} Models</strong>
            </span>
            <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>|</span>
            <span style={{ color: '#94A3B8' }}>
              Active Mode:{' '}
              <strong style={{ color: isPinned ? '#FF8577' : '#38BDF8' }}>
                {isPinned ? preferredModel : 'Auto Cascade'}
              </strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {onOpenBatchModal && (
              <button
                type="button"
                onClick={() => {
                  onClose?.();
                  onOpenBatchModal();
                }}
                className="btn-tactile"
                style={{
                  padding: '6px 14px',
                  borderRadius: 9999,
                  background: 'rgba(56, 189, 248, 0.14)',
                  border: '1px solid rgba(56, 189, 248, 0.42)',
                  color: '#38BDF8',
                  fontSize: '0.73rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Layers size={13} />
                <span>ទៅផ្ទាំង Batch Generate</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn-tactile"
              style={{
                padding: '6px 16px',
                borderRadius: 9999,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#E2E8F0',
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              បិទផ្ទាំង (Close)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
