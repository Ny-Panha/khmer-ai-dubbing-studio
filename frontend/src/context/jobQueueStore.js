import { createContext, useContext } from 'react';

// Persist singleton Context identity across Vite HMR reloads so mounted consumers
// (e.g. JobDashboardModal / GeminiRouteModal) never split context identity from JobQueueProvider.
const JOB_QUEUE_CONTEXT_SYMBOL = Symbol.for('dragondub.JobQueueContext');

export const JobQueueContext =
  globalThis[JOB_QUEUE_CONTEXT_SYMBOL] ||
  (globalThis[JOB_QUEUE_CONTEXT_SYMBOL] = createContext(null));

export function useSharedJobQueue() {
  const ctx = useContext(JobQueueContext);
  if (!ctx) {
    throw new Error('useSharedJobQueue must be used within a JobQueueProvider');
  }
  return ctx;
}

