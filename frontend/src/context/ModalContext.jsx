import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';

const NOOP = () => {};

/**
 * Normalize browser pathname into canonical DragonDub Studio routes:
 * - '/' or '/home' -> '/home' (Home & Route Launchpad)
 * - '/studio'      -> '/studio' (Main 3-Column Dubbing Studio + Timeline)
 * - '/batch'       -> '/batch' (Batch Generate Studio Modal)
 * - '/quota'       -> '/quota' (Gemini Keys & Quota Pool Modal)
 * - '/export'      -> '/export' (Batch Export & Render Studio Modal)
 * - '/jobs'        -> '/jobs' (Production Job Queue Dashboard Modal)
 */
export function normalizeStudioRoute(rawPath) {
  const cleaned = String(rawPath || '/')
    .split('?')[0]
    .split('#')[0]
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '') || '/';

  if (cleaned === '/' || cleaned === '/home') return '/home';
  if (cleaned === '/studio') return '/studio';
  if (cleaned === '/batch' || cleaned === '/studio/batch') return '/batch';
  if (cleaned === '/quota' || cleaned === '/keys' || cleaned === '/studio/quota') return '/quota';
  if (cleaned === '/export' || cleaned === '/studio/export') return '/export';
  if (cleaned === '/jobs' || cleaned === '/studio/jobs') return '/jobs';
  return '/home';
}

function getInitialBrowserRoute() {
  if (typeof window === 'undefined' || !window.location) return '/studio';
  return normalizeStudioRoute(window.location.pathname);
}

const DEFAULT_MODAL_CONTEXT = Object.freeze({
  currentRoute: '/studio',
  isHomeRoute: false,
  navigateToRoute: NOOP,
  showJobDashboard: false,
  setShowJobDashboard: NOOP,
  showGeminiRouteModal: false,
  setShowGeminiRouteModal: NOOP,
  showGeminiQuotaModal: false,
  setShowGeminiQuotaModal: NOOP,
  showBatchExportStudioModal: false,
  setShowBatchExportStudioModal: NOOP,
  showShortcutsModal: false,
  setShowShortcutsModal: NOOP,
  exportStudioSelectedEpIds: [],
  setExportStudioSelectedEpIds: NOOP,
  exportStudioAllowOriginalAudio: false,
  setExportStudioAllowOriginalAudio: NOOP,
  handleOpenJobDashboard: NOOP,
  handleCloseJobDashboard: NOOP,
  handleOpenGeminiRoute: NOOP,
  handleCloseGeminiRoute: NOOP,
  handleOpenGeminiQuota: NOOP,
  handleCloseGeminiQuota: NOOP,
  handleOpenBatchExportStudio: NOOP,
  handleCloseBatchExportStudio: NOOP,
  handleOpenShortcutsModal: NOOP,
  handleCloseShortcutsModal: NOOP,
  isAnyModalOpen: false,
});

export const ModalContext = createContext(DEFAULT_MODAL_CONTEXT);

/**
 * Custom hook to manage studio routes and modal visibility states cleanly.
 * Syncs with browser URL so refreshing (F5) preserves the open view/modal.
 */
export function useModalState() {
  const initialRoute = getInitialBrowserRoute();
  const [currentRoute, setCurrentRoute] = useState(initialRoute);
  const [showJobDashboard, setShowJobDashboard] = useState(initialRoute === '/jobs');
  const [showGeminiRouteModal, setShowGeminiRouteModal] = useState(initialRoute === '/batch');
  const [showGeminiQuotaModal, setShowGeminiQuotaModal] = useState(initialRoute === '/quota');
  const [showBatchExportStudioModal, setShowBatchExportStudioModal] = useState(initialRoute === '/export');
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [exportStudioSelectedEpIds, setExportStudioSelectedEpIds] = useState([]);
  const [exportStudioAllowOriginalAudio, setExportStudioAllowOriginalAudio] = useState(false);

  const applyRouteState = useCallback((normalizedRoute, searchQuery = '', pushHistory = true) => {
    setCurrentRoute(normalizedRoute);
    setShowGeminiRouteModal(normalizedRoute === '/batch');
    setShowGeminiQuotaModal(normalizedRoute === '/quota');
    setShowBatchExportStudioModal(normalizedRoute === '/export');
    setShowJobDashboard(normalizedRoute === '/jobs');

    if (pushHistory && typeof window !== 'undefined' && window.history) {
      const targetUrl = `${normalizedRoute}${searchQuery || ''}`;
      const currentFull = `${window.location.pathname}${window.location.search || ''}`;
      if (currentFull !== targetUrl) {
        window.history.pushState({ route: normalizedRoute }, '', targetUrl);
      }
    }
  }, []);

  const navigateToRoute = useCallback(
    (rawTarget, options = {}) => {
      const str = String(rawTarget || '/studio');
      const qIdx = str.indexOf('?');
      const pathPart = qIdx >= 0 ? str.slice(0, qIdx) : str;
      const searchPart = qIdx >= 0 ? str.slice(qIdx) : (options.search || '');
      const normalized = normalizeStudioRoute(pathPart);
      applyRouteState(normalized, searchPart, options.replace ? false : true);
      if (options.replace && typeof window !== 'undefined' && window.history) {
        window.history.replaceState({ route: normalized }, '', `${normalized}${searchPart}`);
      }
    },
    [applyRouteState]
  );

  // Sync browser Back / Forward buttons (popstate)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePopState = () => {
      const nextRoute = normalizeStudioRoute(window.location.pathname);
      applyRouteState(nextRoute, window.location.search || '', false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyRouteState]);

  const handleOpenJobDashboard = useCallback(() => {
    applyRouteState('/jobs', '', true);
  }, [applyRouteState]);

  const handleCloseJobDashboard = useCallback(() => {
    applyRouteState('/studio', '', true);
  }, [applyRouteState]);

  const handleOpenGeminiRoute = useCallback(() => {
    applyRouteState('/batch', '', true);
  }, [applyRouteState]);

  const handleCloseGeminiRoute = useCallback(() => {
    applyRouteState('/studio', '', true);
  }, [applyRouteState]);

  const handleOpenGeminiQuota = useCallback(() => {
    applyRouteState('/quota', '', true);
  }, [applyRouteState]);

  const handleCloseGeminiQuota = useCallback(() => {
    applyRouteState('/studio', '', true);
  }, [applyRouteState]);

  const handleOpenBatchExportStudio = useCallback(() => {
    applyRouteState('/export', '', true);
  }, [applyRouteState]);

  const handleCloseBatchExportStudio = useCallback(() => {
    applyRouteState('/studio', '', true);
  }, [applyRouteState]);

  const handleOpenShortcutsModal = useCallback(() => setShowShortcutsModal(true), []);
  const handleCloseShortcutsModal = useCallback(() => setShowShortcutsModal(false), []);

  const isHomeRoute = currentRoute === '/home';

  const isAnyModalOpen = Boolean(
    showJobDashboard ||
    showGeminiRouteModal ||
    showGeminiQuotaModal ||
    showBatchExportStudioModal ||
    showShortcutsModal
  );

  return useMemo(
    () => ({
      currentRoute,
      isHomeRoute,
      navigateToRoute,
      showJobDashboard,
      setShowJobDashboard,
      showGeminiRouteModal,
      setShowGeminiRouteModal,
      showGeminiQuotaModal,
      setShowGeminiQuotaModal,
      showBatchExportStudioModal,
      setShowBatchExportStudioModal,
      showShortcutsModal,
      setShowShortcutsModal,
      exportStudioSelectedEpIds,
      setExportStudioSelectedEpIds,
      exportStudioAllowOriginalAudio,
      setExportStudioAllowOriginalAudio,
      handleOpenJobDashboard,
      handleCloseJobDashboard,
      handleOpenGeminiRoute,
      handleCloseGeminiRoute,
      handleOpenGeminiQuota,
      handleCloseGeminiQuota,
      handleOpenBatchExportStudio,
      handleCloseBatchExportStudio,
      handleOpenShortcutsModal,
      handleCloseShortcutsModal,
      isAnyModalOpen,
    }),
    [
      currentRoute,
      isHomeRoute,
      navigateToRoute,
      showJobDashboard,
      showGeminiRouteModal,
      showGeminiQuotaModal,
      showBatchExportStudioModal,
      showShortcutsModal,
      exportStudioSelectedEpIds,
      exportStudioAllowOriginalAudio,
      handleOpenJobDashboard,
      handleCloseJobDashboard,
      handleOpenGeminiRoute,
      handleCloseGeminiRoute,
      handleOpenGeminiQuota,
      handleCloseGeminiQuota,
      handleOpenBatchExportStudio,
      handleCloseBatchExportStudio,
      handleOpenShortcutsModal,
      handleCloseShortcutsModal,
      isAnyModalOpen,
    ]
  );
}

export function ModalProvider({ value, children }) {
  const internalState = useModalState();
  const contextValue = value || internalState;
  return <ModalContext.Provider value={contextValue}>{children}</ModalContext.Provider>;
}

export function useModalManager() {
  return useContext(ModalContext) || DEFAULT_MODAL_CONTEXT;
}
