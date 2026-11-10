import { useSyncExternalStore, useEffect, useCallback } from 'react';
import {
  fetchGeminiKeysStatusApi,
  updateGeminiQuotaSettingsApi,
} from '../services/api';

let storeState = {
  keysHealth: null,
  isCheckingQuota: false,
  isTestingMatrix: false,
  isUpdatingQuotaSettings: false,
  lastLiveProbeAt: null,
  lastMatrixProbeAt: null,
  lastModelsProbeAt: 0,
  modelScopeMode: 'pool', // 'pool' (4x) | 'per_key' (1x)
  showAllModels: false,
  quotaNotice: null,
  quotaError: null,
};

const subscribers = new Set();
let activePollSubscribers = 0;
let sharedPollTimer = null;
let pollIntervalCurrentMs = 6000;

function updateStore(patch) {
  const next = typeof patch === 'function' ? patch(storeState) : patch;
  storeState = { ...storeState, ...next };
  subscribers.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  });
}

function subscribe(listener) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function getSnapshot() {
  return storeState;
}

export async function runQuotaCheck(probeMode = 'models', { allModels = false } = {}) {
  const safeMode =
    probeMode === 'live'
      ? 'live'
      : probeMode === 'matrix'
        ? 'matrix'
        : probeMode === 'stats'
          ? 'stats'
          : 'models';

  // Skip background stats tick if a manual/live probe is already in flight
  if (safeMode === 'stats' && (storeState.isCheckingQuota || storeState.isTestingMatrix)) {
    return null;
  }

  try {
    if (safeMode !== 'stats') {
      updateStore({ isCheckingQuota: true, quotaError: null });
    }
    if (safeMode === 'matrix') {
      updateStore({ isTestingMatrix: true, quotaError: null });
    }

    const res = await fetchGeminiKeysStatusApi({
      probe: safeMode,
      allModels: Boolean(allModels),
    });

    if (res && res.success) {
      const now = Date.now();
      updateStore({
        keysHealth: res,
        ...(safeMode === 'models' ? { lastModelsProbeAt: now } : {}),
        ...(safeMode === 'live' || safeMode === 'matrix'
          ? { lastLiveProbeAt: now, lastModelsProbeAt: now }
          : {}),
        ...(safeMode === 'matrix' ? { lastMatrixProbeAt: now } : {}),
      });
    }
    return res;
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('Failed to check keys quota:', err);
      if (safeMode !== 'stats') {
        updateStore({ quotaError: err?.message || 'មិនអាចពិនិត្យ Quota Keys បានទេ' });
      }
    }
    return null;
  } finally {
    if (safeMode !== 'stats') {
      updateStore({
        isCheckingQuota: false,
        ...(safeMode === 'matrix' ? { isTestingMatrix: false } : {}),
      });
    }
  }
}

export function useGeminiQuotaMonitor({
  enabled = false,
  initialProbe = 'models',
  pollIntervalMs = 6000,
} = {}) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!enabled) return undefined;

    const now = Date.now();
    const needsFreshModelsProbe =
      !storeState.keysHealth ||
      (initialProbe === 'models' && now - (storeState.lastModelsProbeAt || 0) > 15000);

    if (needsFreshModelsProbe) {
      runQuotaCheck(initialProbe === 'stats' && storeState.keysHealth ? 'stats' : 'models');
    } else if (now - (Number(storeState.keysHealth?.timestamp) || 0) > 2000) {
      runQuotaCheck('stats');
    }

    activePollSubscribers += 1;
    const desiredMs = Math.max(3000, Number(pollIntervalMs) || 6000);
    if (!sharedPollTimer || desiredMs < pollIntervalCurrentMs) {
      if (sharedPollTimer) clearInterval(sharedPollTimer);
      pollIntervalCurrentMs = desiredMs;
      sharedPollTimer = setInterval(() => {
        runQuotaCheck('stats');
      }, pollIntervalCurrentMs);
    }

    return () => {
      activePollSubscribers = Math.max(0, activePollSubscribers - 1);
      if (activePollSubscribers === 0 && sharedPollTimer) {
        clearInterval(sharedPollTimer);
        sharedPollTimer = null;
      }
    };
  }, [enabled, initialProbe, pollIntervalMs]);

  const handleCheckQuota = useCallback((probeMode = 'models', opts = {}) => {
    return runQuotaCheck(probeMode, opts);
  }, []);

  const handleToggleUseAllKeysFast = useCallback(async () => {
    const currentFast = storeState.keysHealth?.settings?.useAllKeysFast !== false;
    try {
      updateStore({ isUpdatingQuotaSettings: true, quotaError: null });
      const res = await updateGeminiQuotaSettingsApi({ useAllKeysFast: !currentFast });
      if (res && res.success) {
        updateStore({ keysHealth: res });
      }
    } catch (err) {
      console.error('Failed to toggle quota pacing:', err);
      updateStore({ quotaError: err?.message || 'មិនអាចប្តូរ Pacing Mode បានទេ' });
    } finally {
      updateStore({ isUpdatingQuotaSettings: false });
    }
  }, []);

  const handleChangeDailyLimit = useCallback(async (nextLimit) => {
    const safeLimit = Number(nextLimit);
    if (!Number.isFinite(safeLimit) || safeLimit < 10) return;
    try {
      updateStore({ isUpdatingQuotaSettings: true, quotaError: null });
      const res = await updateGeminiQuotaSettingsApi({ dailyRpdPerKey: safeLimit });
      if (res && res.success) {
        updateStore({ keysHealth: res });
      }
    } catch (err) {
      console.error('Failed to update daily quota limit:', err);
      updateStore({ quotaError: err?.message || 'មិនអាចកំណត់ Daily Limit បានទេ' });
    } finally {
      updateStore({ isUpdatingQuotaSettings: false });
    }
  }, []);

  const handleSelectPreferredModel = useCallback(async (nextModelId = 'auto') => {
    const cleanModel = String(nextModelId || 'auto').trim() || 'auto';
    try {
      updateStore({ isUpdatingQuotaSettings: true, quotaError: null });
      const res = await updateGeminiQuotaSettingsApi({ preferredModel: cleanModel });
      if (res && res.success) {
        updateStore({
          keysHealth: res,
          quotaNotice:
            cleanModel === 'auto'
              ? '✨ បានប្តូរទៅ Auto Cascade Mode (ជ្រើសរើស Model ទំនេរស្វ័យប្រវត្តិគ្រប់ 10 Models)'
              : `📌 បានកំណត់ «${cleanModel}» ជា Primary Model សម្រាប់បកប្រែ និង Pipeline!`,
        });
      }
      return res;
    } catch (err) {
      console.error('Failed to update preferred model:', err);
      updateStore({ quotaError: err?.message || 'មិនអាចកំណត់ Model ចម្បងបានទេ' });
      return null;
    } finally {
      updateStore({ isUpdatingQuotaSettings: false });
    }
  }, []);

  const setModelScopeMode = useCallback((mode) => {
    updateStore({ modelScopeMode: mode === 'per_key' ? 'per_key' : 'pool' });
  }, []);

  const setShowAllModels = useCallback((updater) => {
    updateStore((prev) => ({
      showAllModels: typeof updater === 'function' ? Boolean(updater(prev.showAllModels)) : Boolean(updater),
    }));
  }, []);

  const clearQuotaNotice = useCallback(() => {
    updateStore({ quotaNotice: null });
  }, []);

  const clearQuotaError = useCallback(() => {
    updateStore({ quotaError: null });
  }, []);

  return {
    ...snapshot,
    handleCheckQuota,
    handleToggleUseAllKeysFast,
    handleChangeDailyLimit,
    handleSelectPreferredModel,
    setModelScopeMode,
    setShowAllModels,
    clearQuotaNotice,
    clearQuotaError,
  };
}
