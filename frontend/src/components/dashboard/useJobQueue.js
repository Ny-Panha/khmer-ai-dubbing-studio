import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchJobsListApi,
  pauseJobApi,
  resumeJobApi,
  retryJobApi,
  cancelJobApi,
} from '../../services/api';

/**
 * Custom hook to manage production job queue state, real-time SSE stream,
 * fallback polling, and asynchronous lifecycle actions.
 */
export function useJobQueue(options = {}) {
  const { enabled = true } = options;
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({
    maxConcurrency: 1,
    totalJobs: 0,
    runningCount: 0,
    queuedCount: 0,
    pausedCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
  });
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionMode, setConnectionMode] = useState('connecting'); // 'sse' | 'polling' | 'connecting'
  const [isConnected, setIsConnected] = useState(false);
  const [actionInProgress, setActionInProgress] = useState({}); // { [jobId]: 'pause' | 'resume' | 'retry' | 'cancel' }

  const eventSourceRef = useRef(null);
  const pollingTimerRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        // ignore socket close errors
      }
      eventSourceRef.current = null;
    }
  }, []);

  // Manual or polling data fetch
  const refreshJobs = useCallback(async (activeFilter = filter) => {
    try {
      const response = await fetchJobsListApi({ filter: activeFilter });
      if (!isMountedRef.current) return;
      if (response && response.success) {
        setJobs(response.jobs || []);
        if (response.stats) {
          setStats(response.stats);
        }
        setError(null);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      // If polling fails, record soft error
      setError(err.message || 'បរាជ័យក្នុងការទាញយកទិន្នន័យ Jobs');
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [filter]);

  // Stop fallback polling timer safely
  const stopPollingFallback = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  // Start polling fallback (3000ms minimum, active only when enabled and document visible)
  const startPollingFallback = useCallback(() => {
    stopPollingFallback();
    setConnectionMode('polling');
    setIsConnected(false);

    if (!enabled || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }

    // Initial immediate fetch
    refreshJobs();

    // Poll at 3000ms minimum
    pollingTimerRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refreshJobs();
    }, 3000);
  }, [enabled, refreshJobs, stopPollingFallback]);

  // Pause fallback polling when document is hidden (visibilitychange), resume when visible
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPollingFallback();
      } else if (enabled && connectionMode === 'polling') {
        startPollingFallback();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, connectionMode, startPollingFallback, stopPollingFallback]);

  // Connect to SSE stream cleanly with backoff, visibility awareness, and backend-online recovery
  useEffect(() => {
    if (!enabled) {
      closeEventSource();
      clearReconnectTimeout();
      stopPollingFallback();
      return;
    }
    isMountedRef.current = true;

    const scheduleReconnect = () => {
      if (!isMountedRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      clearReconnectTimeout();
      const attempt = Math.min(reconnectAttemptsRef.current, 4);
      const delayMs = Math.min(15000, 2000 * Math.pow(2, attempt));
      reconnectAttemptsRef.current = Math.min(reconnectAttemptsRef.current + 1, 10);
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        if (isMountedRef.current) {
          connectSSE();
        }
      }, delayMs);
    };

    function connectSSE() {
      if (!isMountedRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (typeof window === 'undefined' || !window.EventSource) {
        startPollingFallback();
        return;
      }

      clearReconnectTimeout();
      closeEventSource();

      try {
        const es = new EventSource('/api/jobs/stream');
        eventSourceRef.current = es;

        es.addEventListener('open', () => {
          if (!isMountedRef.current || eventSourceRef.current !== es) return;
          reconnectAttemptsRef.current = 0;
          setIsConnected(true);
          setConnectionMode('sse');
          setError(null);
          // If polling was running, clear it: SSE connected = no interval at all
          stopPollingFallback();
        });

        es.addEventListener('init', (e) => {
          if (!isMountedRef.current || eventSourceRef.current !== es) return;
          try {
            const data = JSON.parse(e.data);
            if (data.jobs) setJobs(data.jobs);
            if (data.stats) setStats(data.stats);
            setIsLoading(false);
          } catch (err) {
            console.warn('[useJobQueue] Error parsing SSE init:', err);
          }
        });

        es.addEventListener('job_update', (e) => {
          if (!isMountedRef.current || eventSourceRef.current !== es) return;
          try {
            const data = JSON.parse(e.data);
            if (data.job) {
              setJobs((prev) => {
                const updated = [...prev];
                const index = updated.findIndex((j) => j.jobId === data.job.jobId);
                if (index >= 0) {
                  updated[index] = { ...updated[index], ...data.job };
                } else {
                  updated.unshift(data.job);
                }
                return updated.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
              });
            }
            if (data.stats) {
              setStats(data.stats);
            }
          } catch (err) {
            console.warn('[useJobQueue] Error parsing SSE job_update:', err);
          }
        });

        es.addEventListener('error', () => {
          if (!isMountedRef.current || eventSourceRef.current !== es) return;
          // Any stream interruption (CLOSED or CONNECTING) immediately marks SSE disconnected
          // and closes the stale socket so browser + backoff timer never stack duplicate reconnects.
          setIsConnected(false);
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
          try {
            es.close();
          } catch {
            // ignore close errors
          }
          startPollingFallback();
          scheduleReconnect();
        });
      } catch {
        setIsConnected(false);
        startPollingFallback();
        scheduleReconnect();
      }
    }

    const handleBackendOnline = () => {
      if (!isMountedRef.current) return;
      if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
        reconnectAttemptsRef.current = 0;
        connectSSE();
      }
    };

    const handleVisibilityReconnect = () => {
      if (typeof document === 'undefined') return;
      if (!document.hidden && isMountedRef.current && (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED)) {
        reconnectAttemptsRef.current = 0;
        connectSSE();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('backend-online', handleBackendOnline);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityReconnect);
    }

    connectSSE();

    return () => {
      isMountedRef.current = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('backend-online', handleBackendOnline);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityReconnect);
      }
      closeEventSource();
      stopPollingFallback();
      clearReconnectTimeout();
    };
  }, [enabled, startPollingFallback, stopPollingFallback, closeEventSource, clearReconnectTimeout]);

  // Action: Pause Job
  const pauseJob = async (jobId) => {
    if (actionInProgress[jobId]) return;
    setActionInProgress((prev) => ({ ...prev, [jobId]: 'pause' }));
    try {
      await pauseJobApi(jobId);
      await refreshJobs();
    } catch (err) {
      alert(`បរាជ័យក្នុងការ Pause Job: ${err.message}`);
    } finally {
      setActionInProgress((prev) => {
        const copy = { ...prev };
        delete copy[jobId];
        return copy;
      });
    }
  };

  // Action: Resume Job
  const resumeJob = async (jobId) => {
    if (actionInProgress[jobId]) return;
    setActionInProgress((prev) => ({ ...prev, [jobId]: 'resume' }));
    try {
      await resumeJobApi(jobId);
      await refreshJobs();
    } catch (err) {
      alert(`បរាជ័យក្នុងការ Resume Job: ${err.message}`);
    } finally {
      setActionInProgress((prev) => {
        const copy = { ...prev };
        delete copy[jobId];
        return copy;
      });
    }
  };

  // Action: Retry Job
  const retryJob = async (jobId) => {
    if (actionInProgress[jobId]) return;
    setActionInProgress((prev) => ({ ...prev, [jobId]: 'retry' }));
    try {
      await retryJobApi(jobId);
      await refreshJobs();
    } catch (err) {
      alert(`បរាជ័យក្នុងការ Retry Job: ${err.message}`);
    } finally {
      setActionInProgress((prev) => {
        const copy = { ...prev };
        delete copy[jobId];
        return copy;
      });
    }
  };

  // Action: Cancel Job
  const cancelJob = async (jobId) => {
    if (actionInProgress[jobId]) return;
    setActionInProgress((prev) => ({ ...prev, [jobId]: 'cancel' }));
    try {
      await cancelJobApi(jobId);
      await refreshJobs();
    } catch (err) {
      alert(`បរាជ័យក្នុងការ Cancel Job: ${err.message}`);
    } finally {
      setActionInProgress((prev) => {
        const copy = { ...prev };
        delete copy[jobId];
        return copy;
      });
    }
  };

  // Filtered & Searched jobs
  const filteredJobs = jobs.filter((job) => {
    // Status filter
    if (filter !== 'all') {
      if (String(job.status).toLowerCase() !== filter.toLowerCase()) {
        return false;
      }
    }
    // Search filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      const matchId = String(job.jobId || '').toLowerCase().includes(q);
      const matchSeries = String(job.seriesId || '').toLowerCase().includes(q);
      const matchEpisode = String(job.episodeId || '').toLowerCase().includes(q);
      const matchStage = String(job.currentStage || '').toLowerCase().includes(q);
      if (!matchId && !matchSeries && !matchEpisode && !matchStage) {
        return false;
      }
    }
    return true;
  });

  return {
    jobs: filteredJobs,
    allJobsCount: jobs.length,
    stats,
    filter,
    setFilter,
    searchTerm,
    setSearchTerm,
    isLoading,
    error,
    connectionMode,
    isConnected,
    actionInProgress,
    pauseJob,
    resumeJob,
    retryJob,
    cancelJob,
    refreshJobs,
  };
}

