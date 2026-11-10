import {
  scanEpisodeBrokenSegments,
  scanSeriesBrokenSegments,
} from '../../utils/translationQuality.js';

/**
 * Pure single-source-of-truth helpers for GeminiRouteModal and EpisodesTab.
 *
 * INVARIANT: Script readiness and segment counts MUST derive strictly from stored
 * episode data (`ep.scriptData.segments`, the exact array rendered by the Studio Editor),
 * NEVER from job queue status, job result counts, or unbacked status flags.
 */

export function hasEpisodeVideo(ep) {
  return Boolean(ep && (ep.video || ep.videoFile || ep.sourceVideoPath));
}

export function getStoredEpisodeSegments(ep) {
  if (!ep || !ep.scriptData || !Array.isArray(ep.scriptData.segments)) {
    return [];
  }
  return ep.scriptData.segments;
}

export function checkEpisodeHasScript(ep) {
  return getStoredEpisodeSegments(ep).length > 0;
}

export function getEpisodeBrokenSummary(ep) {
  return scanEpisodeBrokenSegments(ep);
}

export function getEpisodesBrokenSummary(episodes = []) {
  return scanSeriesBrokenSegments(episodes);
}

export function checkEpisodeScriptHealthy(ep) {
  const segments = getStoredEpisodeSegments(ep);
  if (segments.length === 0) return false;
  return scanEpisodeBrokenSegments(ep).textBrokenCount === 0;
}

export function checkEpisodeHasAudioReady(ep, completedTtsEpIds = null, ttsLiveStats = null) {
  if (!ep) return false;
  const hasExplicitSegmentsArray = Boolean(ep.scriptData && Array.isArray(ep.scriptData.segments));
  const segments = getStoredEpisodeSegments(ep);
  if (hasExplicitSegmentsArray && segments.length === 0) return false;

  // Segment-level truth: episode-level flags (hasAudio/Master) NEVER override broken segments
  if (segments.length > 0) {
    const brokenScan = scanEpisodeBrokenSegments(ep);
    if (brokenScan.totalBrokenCount > 0) return false;
  }

  if (ttsLiveStats && ttsLiveStats[ep.id]?.isDone) return true;
  if (ep.audioOutdated) return false;
  if (Boolean(ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio)) return true;
  return Boolean(completedTtsEpIds && typeof completedTtsEpIds.has === 'function' && completedTtsEpIds.has(ep.id));
}

export function checkEpisodeHasDemucsReady(ep, completedDemucsEpIds = null, demucsLiveStats = null) {
  if (!ep) return false;
  if (demucsLiveStats && demucsLiveStats[ep.id]?.isDone) return true;
  return Boolean(
    ep.bgmAudioUrl ||
    ep.cleanBgmPath ||
    ep.hasDemucs ||
    ep.isDemucsDone ||
    (completedDemucsEpIds && typeof completedDemucsEpIds.has === 'function' && completedDemucsEpIds.has(ep.id))
  );
}

export function getEpisodeSegmentCount(ep) {
  return getStoredEpisodeSegments(ep).length;
}

export function computeClampedStagePercent(completedCount = 0, totalCount = 0) {
  const safeTotal = Number(totalCount);
  if (!Number.isFinite(safeTotal) || safeTotal <= 0) {
    return 0;
  }
  const safeDone = Number(completedCount);
  if (!Number.isFinite(safeDone) || safeDone <= 0) {
    return 0;
  }
  const rawPct = Math.round((safeDone / safeTotal) * 100);
  return Math.min(100, Math.max(0, rawPct));
}

export function partitionSelectedEpisodesForTranslate(selectedEpisodes = []) {
  const safeSelected = Array.isArray(selectedEpisodes) ? selectedEpisodes : [];
  const unscriptedEpisodes = [];
  const scriptedEpisodes = [];

  for (const ep of safeSelected) {
    if (checkEpisodeHasScript(ep)) {
      scriptedEpisodes.push(ep);
    } else {
      unscriptedEpisodes.push(ep);
    }
  }

  return {
    unscriptedEpisodes,
    scriptedEpisodes,
  };
}

export function isJobCompletedSegmentsMissing(ep, activeJob) {
  return Boolean(
    activeJob &&
    activeJob.status === 'completed' &&
    !checkEpisodeHasScript(ep)
  );
}

export function computeSeriesTranslateSummary(episodes = [], jobsByEpisodeId = null) {
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];
  const totalEpisodes = safeEpisodes.length;
  let completedCount = 0;
  let healthyScriptedCount = 0;
  let totalTextBrokenCount = 0;
  let unscriptedWithVideoCount = 0;
  let unsavedCompletedJobsCount = 0;

  for (const ep of safeEpisodes) {
    const hasScript = checkEpisodeHasScript(ep);
    if (hasScript) {
      completedCount += 1;
      const scan = scanEpisodeBrokenSegments(ep);
      totalTextBrokenCount += scan.textBrokenCount;
      if (scan.textBrokenCount === 0) {
        healthyScriptedCount += 1;
      }
    } else {
      if (hasEpisodeVideo(ep)) {
        unscriptedWithVideoCount += 1;
      }
      const activeJob =
        jobsByEpisodeId && typeof jobsByEpisodeId.get === 'function'
          ? jobsByEpisodeId.get(ep?.id)
          : null;
      if (isJobCompletedSegmentsMissing(ep, activeJob)) {
        unsavedCompletedJobsCount += 1;
      }
    }
  }

  const remainingCount = Math.max(0, totalEpisodes - completedCount);
  const isTranslateAllDone =
    totalEpisodes > 0 &&
    healthyScriptedCount === totalEpisodes &&
    totalTextBrokenCount === 0;
  const translatePercent = computeClampedStagePercent(healthyScriptedCount, totalEpisodes);

  return {
    totalEpisodes,
    completedCount,
    healthyScriptedCount,
    totalTextBrokenCount,
    remainingCount,
    unscriptedCount: remainingCount,
    unscriptedWithVideoCount,
    unsavedCompletedJobsCount,
    isTranslateAllDone,
    translatePercent,
  };
}

export function formatQuotaDuration(totalSeconds = 0) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (sec <= 0) return 'Ready';
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (mins < 60) {
    return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function formatCompactTokenCount(tokens = 0) {
  const n = Math.max(0, Number(tokens) || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatQuotaMetricCount(value = 0) {
  const n = Math.max(0, Number(value) || 0);
  if (n >= 1000000) {
    const val = n % 1000000 === 0 ? String(n / 1000000) : (n / 1000000).toFixed(2).replace(/\.?0+$/, '');
    return `${val}M`;
  }
  if (n >= 1000) {
    const val = n % 1000 === 0 ? String(n / 1000) : (n / 1000).toFixed(1).replace(/\.0$/, '');
    return `${val}K`;
  }
  return String(Math.round(n));
}

export function getEffectiveModelMetrics(row, scopeMode = 'pool') {
  const bucket = (scopeMode === 'per_key' ? row?.perKey : row?.pool) || {};
  const rpmUsed = Math.max(0, Number(bucket.rpmUsed) || 0);
  const rpmLimit = Math.max(0, Number(bucket.rpmLimit) || 0);
  const tpmUsed = Math.max(0, Number(bucket.tpmUsed) || 0);
  const tpmLimit = Math.max(0, Number(bucket.tpmLimit) || 0);
  const rpdUsed = Math.max(0, Number(bucket.rpdUsed) || 0);
  const rpdLimit = Math.max(0, Number(bucket.rpdLimit) || 0);

  const calcPct = (used, limit) => {
    if (limit <= 0) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  };

  return {
    rpmUsed,
    rpmLimit,
    rpmPct: calcPct(rpmUsed, rpmLimit),
    tpmUsed,
    tpmLimit,
    tpmPct: calcPct(tpmUsed, tpmLimit),
    rpdUsed,
    rpdLimit,
    rpdPct: calcPct(rpdUsed, rpdLimit),
  };
}

export function getModelRateStatusMeta(row) {
  const status = row?.liveStatus || 'untested';
  if (status === 'ready') {
    return {
      label: row?.lastProbeCode === 200 ? '✓ 200 Ready' : '✓ Ready',
      color: '#34D399',
      bg: 'rgba(16, 185, 129, 0.14)',
      border: 'rgba(52, 211, 153, 0.35)',
    };
  }
  if (status === 'partial') {
    const ready = row?.readyKeysForModel ?? 0;
    const total = row?.totalActiveKeys ?? 0;
    return {
      label: total > 0 ? `${ready}/${total} Keys` : 'Partial Ready',
      color: '#38BDF8',
      bg: 'rgba(56, 189, 248, 0.14)',
      border: 'rgba(56, 189, 248, 0.35)',
    };
  }
  if (status === 'busy') {
    return {
      label: '⚠ 503 Busy',
      color: '#FBBF24',
      bg: 'rgba(251, 191, 36, 0.14)',
      border: 'rgba(251, 191, 36, 0.35)',
    };
  }
  if (status === 'timeout') {
    return {
      label: '⌛ Timeout',
      color: '#FBBF24',
      bg: 'rgba(251, 191, 36, 0.14)',
      border: 'rgba(251, 191, 36, 0.35)',
    };
  }
  if (status === 'rate_limited') {
    const cdSec = Number(row?.cooldownSec) || 0;
    return {
      label: cdSec > 0 ? `⏳ Wait ${formatQuotaDuration(cdSec)}` : '⏳ 429 Wait',
      color: '#FBBF24',
      bg: 'rgba(251, 191, 36, 0.14)',
      border: 'rgba(251, 191, 36, 0.35)',
    };
  }
  if (status === 'exhausted') {
    return {
      label: '🔴 429 Full',
      color: '#F87171',
      bg: 'rgba(248, 113, 113, 0.15)',
      border: 'rgba(248, 113, 113, 0.42)',
    };
  }
  if (status === 'deprecated') {
    return {
      label: 'Retired (404)',
      color: '#94A3B8',
      bg: 'rgba(148, 163, 184, 0.10)',
      border: 'rgba(148, 163, 184, 0.25)',
    };
  }
  if (status === 'zero_limit') {
    return {
      label: '0/0 Free Limit',
      color: '#64748B',
      bg: 'rgba(100, 116, 139, 0.10)',
      border: 'rgba(100, 116, 139, 0.25)',
    };
  }
  return {
    label: 'Standby',
    color: '#94A3B8',
    bg: 'rgba(148, 163, 184, 0.10)',
    border: 'rgba(148, 163, 184, 0.25)',
  };
}

export function getQuotaBarAccent(percent = 0, isExhausted = false) {
  if (isExhausted || percent >= 90) {
    return { bar: '#F87171', glow: 'rgba(248, 113, 113, 0.4)', text: '#FCA5A5' };
  }
  if (percent >= 65) {
    return { bar: '#FBBF24', glow: 'rgba(251, 191, 36, 0.35)', text: '#FDE68A' };
  }
  return { bar: '#34D399', glow: 'rgba(52, 211, 153, 0.35)', text: '#6EE7B7' };
}

export function applyElapsedCountdownToKeysHealth(keysHealth, nowMs = Date.now()) {
  if (!keysHealth || typeof keysHealth !== 'object') return null;
  const capturedAt = Number(keysHealth.timestamp) || nowMs;
  const elapsedSec = Math.max(0, Math.floor((nowMs - capturedAt) / 1000));
  const summary = keysHealth.quotaSummary || null;

  const adjustSummary = summary
    ? {
        ...summary,
        rpmResetsInSec: Math.max(0, (Number(summary.rpmResetsInSec) || 0) - elapsedSec),
        dailyResetsInSec: Math.max(0, (Number(summary.dailyResetsInSec) || 0) - elapsedSec),
      }
    : null;

  const adjustedKeys = Array.isArray(keysHealth.keys)
    ? keysHealth.keys.map((k) => {
        const nextCd = Math.max(0, (Number(k.cooldownSec) || 0) - elapsedSec);
        const nextRpmReset = Math.max(0, (Number(k.rpmResetsInSec) || 0) - elapsedSec);
        const recovered = k.status === 'rate_limited' && nextCd === 0;
        return {
          ...k,
          cooldownSec: nextCd,
          rpmResetsInSec: nextRpmReset,
          status: recovered ? 'ready' : k.status,
          badge: recovered
            ? `${k.rpmLimit || 15}/${k.rpmLimit || 15} RPM`
            : k.status === 'rate_limited' && nextCd > 0
              ? `Wait ${formatQuotaDuration(nextCd)}`
              : k.badge,
          isRateLimited: k.status === 'daily_exhausted' ? true : (k.isRateLimited && nextCd > 0),
        };
      })
    : [];

  const adjustedModels = Array.isArray(keysHealth.modelRateLimits)
    ? keysHealth.modelRateLimits.map((m) => {
        const nextCd = Math.max(0, (Number(m.cooldownSec) || 0) - elapsedSec);
        const modelRecovered = m.liveStatus === 'rate_limited' && nextCd === 0;
        return {
          ...m,
          cooldownSec: nextCd,
          liveStatus: modelRecovered
            ? (m.exhaustedDailyKeys > 0 ? 'partial' : 'ready')
            : m.liveStatus,
          readyKeysForModel: modelRecovered
            ? Math.max(0, (m.totalActiveKeys || 0) - (m.exhaustedDailyKeys || 0))
            : m.readyKeysForModel,
        };
      })
    : [];

  return {
    ...keysHealth,
    quotaSummary: adjustSummary,
    keys: adjustedKeys,
    modelRateLimits: adjustedModels,
  };
}
