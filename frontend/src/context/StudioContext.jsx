import React, { createContext, useContext } from 'react';

const NOOP = () => {};

const DEFAULT_STUDIO_CONTEXT = Object.freeze({
  onUpdateSegments: NOOP,
  onUpdateScript: NOOP,
  voiceSwitch: NOOP,
  repairBroken: NOOP,
});

export const StudioContext = createContext(DEFAULT_STUDIO_CONTEXT);

export function StudioProvider({ value, children }) {
  const safeValue = value || DEFAULT_STUDIO_CONTEXT;
  return <StudioContext.Provider value={safeValue}>{children}</StudioContext.Provider>;
}

export function useStudioContext() {
  return useContext(StudioContext) || DEFAULT_STUDIO_CONTEXT;
}

