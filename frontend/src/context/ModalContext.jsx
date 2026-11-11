import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const NOOP = () => {};

const DEFAULT_MODAL_CONTEXT = Object.freeze({
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
 * Custom hook to manage studio modal visibility states cleanly
 */
export function useModalState() {
  const [showJobDashboard, setShowJobDashboard] = useState(false);
  const [showGeminiRouteModal, setShowGeminiRouteModal] = useState(false);
  const [showGeminiQuotaModal, setShowGeminiQuotaModal] = useState(false);
  const [showBatchExportStudioModal, setShowBatchExportStudioModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [exportStudioSelectedEpIds, setExportStudioSelectedEpIds] = useState([]);
  const [exportStudioAllowOriginalAudio, setExportStudioAllowOriginalAudio] = useState(false);

  const handleOpenJobDashboard = useCallback(() => setShowJobDashboard(true), []);
  const handleCloseJobDashboard = useCallback(() => setShowJobDashboard(false), []);
  const handleOpenGeminiRoute = useCallback(() => setShowGeminiRouteModal(true), []);
  const handleCloseGeminiRoute = useCallback(() => setShowGeminiRouteModal(false), []);
  const handleOpenGeminiQuota = useCallback(() => setShowGeminiQuotaModal(true), []);
  const handleCloseGeminiQuota = useCallback(() => setShowGeminiQuotaModal(false), []);
  const handleOpenBatchExportStudio = useCallback(() => setShowBatchExportStudioModal(true), []);
  const handleCloseBatchExportStudio = useCallback(() => setShowBatchExportStudioModal(false), []);
  const handleOpenShortcutsModal = useCallback(() => setShowShortcutsModal(true), []);
  const handleCloseShortcutsModal = useCallback(() => setShowShortcutsModal(false), []);

  const isAnyModalOpen = Boolean(
    showJobDashboard ||
    showGeminiRouteModal ||
    showGeminiQuotaModal ||
    showBatchExportStudioModal ||
    showShortcutsModal
  );

  return useMemo(
    () => ({
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

