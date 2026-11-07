import React, { createContext, useContext } from 'react';
import { useJobQueue } from '../components/dashboard/useJobQueue';

const JobQueueContext = createContext(null);

export function JobQueueProvider({ children, isAnyJobViewOpen }) {
  const jobQueue = useJobQueue({ enabled: Boolean(isAnyJobViewOpen) });
  return (
    <JobQueueContext.Provider value={jobQueue}>
      {children}
    </JobQueueContext.Provider>
  );
}

export function useSharedJobQueue() {
  const ctx = useContext(JobQueueContext);
  if (!ctx) {
    throw new Error('useSharedJobQueue must be used within a JobQueueProvider');
  }
  return ctx;
}

