import React from 'react';
import { useJobQueue } from '../components/dashboard/useJobQueue';
import { JobQueueContext } from './jobQueueStore';

export function JobQueueProvider({ children, isAnyJobViewOpen }) {
  const jobQueue = useJobQueue({ enabled: Boolean(isAnyJobViewOpen) });
  return (
    <JobQueueContext.Provider value={jobQueue}>
      {children}
    </JobQueueContext.Provider>
  );
}

