import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Cpu, Sparkles, CheckCircle2, AlertCircle, Check, Clock, 
  ArrowRight, Loader2, X, RefreshCw,
  RotateCcw, FileText, Mic, Volume2, Download, Film, AlertTriangle, Square, Layers,
  Pin, Key, Wrench
} from 'lucide-react';
import {
  startGenerationJob,
  startRepairBrokenJobApi,
  fetchJobStatusApi,
} from '../../services/api';
import { useGeminiQuotaMonitor } from '../../hooks/useGeminiQuotaMonitor';
import { useSharedJobQueue } from '../../context/jobQueueStore';
import { formatTimecode } from '../../utils/formatTime';
import { resolveDefaultAspectRatio, sanitizeAspectRatio } from '../../utils/projectStorage';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  getEpisodeSegmentCount,
  getEpisodeBrokenSummary,
  getEpisodesBrokenSummary,
  isJobCompletedSegmentsMissing,
  computeSeriesTranslateSummary,
  partitionSelectedEpisodesForTranslate,
  computeClampedStagePercent,
  applyElapsedCountdownToKeysHealth,
  getActiveSeriesTranslateJobs,
  isTranslateQueueEnqueueBanner,
} from './geminiRouteHelpers';

// 3 Dedicated Route Progress Runners (Step 1: Translate, Step 2: Khmer TTS, Step 3: Demucs)
import EpisodeTranslateProgressCard from './route-runners/EpisodeTranslateProgressCard';
import EpisodeTtsProgressCard from './route-runners/EpisodeTtsProgressCard';
import EpisodeDemucsProgressCard from './route-runners/EpisodeDemucsProgressCard';
import StudioConfirmDialog from '../common/StudioConfirmDialog';

const EMPTY_EPISODES = [];

export default function GeminiRouteModal({
  isOpen,
  onClose,
  onOpenQuotaModal = null,
  onOpenExportStudio = null,
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  onSwitchEpisode = null,
  onTabChange = null,
  onRefreshSeries = null,
  apiKey = null,
  voiceSettings = {},
  currentAspectRatio = null,
  onAspectRatioChange = null,
  isRendering = false,
  batchRender = null,
}) {
  const episodes = (activeSeries && Array.isArray(activeSeries.episodes)) ? activeSeries.episodes : EMPTY_EPISODES;

  // Selection & generation settings
  const [selectedEpIds, setSelectedEpIds] = useState(new Set());
  const [dubbingMode, setDubbingMode] = useState('dialogue');
  const [genre, setGenre] = useState('auto');
  const [narratorGender, setNarratorGender] = useState('male');
  const [isStartingBatch, setIsStartingBatch] = useState(false);
  const [batchError, setBatchError] = useState(null);
  const [batchSuccess, setBatchSuccess] = useState(null);
  const [batchInfo, setBatchInfo] = useState(null);

  // Batch TTS State (Step 2: Generate TTS for 2, 5, or ALL selected episodes simultaneously)
  const [isGeneratingBatchTTS, setIsGeneratingBatchTTS] = useState(false);
  const [activeTtsEpisodeId, setActiveTtsEpisodeId] = useState(null);
  const [activeTtsEpisodeIds, setActiveTtsEpisodeIds] = useState(new Set());
  const [ttsCurrentEpTitle, setTtsCurrentEpTitle] = useState('');
  const [ttsProgressPercent, setTtsProgressPercent] = useState(0);
  const [ttsLiveStats, setTtsLiveStats] = useState({});
  const [completedTtsEpIds, setCompletedTtsEpIds] = useState(new Set());
  const [completedDemucsEpIds, setCompletedDemucsEpIds] = useState(new Set());

  // Batch Demucs State (Step 3: AI Vocal Separation for 2, 5, or ALL selected episodes simultaneously)
  const [isSeparatingBatchDemucs, setIsSeparatingBatchDemucs] = useState(false);
  const [activeDemucsEpisodeId, setActiveDemucsEpisodeId] = useState(null);
  const [activeDemucsEpisodeIds, setActiveDemucsEpisodeIds] = useState(new Set());
  const [demucsLiveStats, setDemucsLiveStats] = useState({});
  const [demucsCurrentEpTitle, setDemucsCurrentEpTitle] = useState('');
  const [demucsProgressPercent, setDemucsProgressPercent] = useState(0);

  // Repair Broken Segments State (ONE button sweeping text-broken + voice-broken subsets)
  const [isRepairingBroken, setIsRepairingBroken] = useState(false);
  const [trackedRepairJobIds, setTrackedRepairJobIds] = useState([]);
  const [repairProgressSummary, setRepairProgressSummary] = useState(null);

  const isGeneratingBatchTtsRef = useRef(false);
  const isSeparatingBatchDemucsRef = useRef(false);
  const ttsLiveStatsRef = useRef({});
  const demucsLiveStatsRef = useRef({});
  isGeneratingBatchTtsRef.current = isGeneratingBatchTTS;
  isSeparatingBatchDemucsRef.current = isSeparatingBatchDemucs;
  ttsLiveStatsRef.current = ttsLiveStats;
  demucsLiveStatsRef.current = demucsLiveStats;

  // Reconcile completed episodes cleanly from current episodes & server truth (never retain stale localStorage DONE flags)
  useEffect(() => {
    const alreadyAudioDone = new Set();
    const alreadyDemucsDone = new Set();
    episodes.forEach((ep) => {
      if (checkEpisodeHasAudioReady(ep, null, ttsLiveStats)) {
        alreadyAudioDone.add(ep.id);
      }
      if (checkEpisodeHasDemucsReady(ep, null, demucsLiveStats)) {
        alreadyDemucsDone.add(ep.id);
      }
    });
    setCompletedTtsEpIds(alreadyAudioDone);
    setCompletedDemucsEpIds(alreadyDemucsDone);
  }, [episodes, ttsLiveStats, demucsLiveStats]);

  // Direct server truth sync when modal opens: resets stale idle live stats & reconciles completed vs outdated episodes
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    if (!isGeneratingBatchTtsRef.current) {
      setTtsLiveStats({});
    }
    if (!isSeparatingBatchDemucsRef.current) {
      setDemucsLiveStats({});
    }

    const targetSeriesId = activeSeries?.id || seriesId;
    if (targetSeriesId) {
      fetch(`/api/series/${targetSeriesId}`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          if (data?.success && Array.isArray(data.series?.episodes)) {
            const serverTtsDone = new Set();
            const serverDemucsDone = new Set();
            const liveTts = isGeneratingBatchTtsRef.current ? ttsLiveStatsRef.current : {};
            const liveDemucs = isSeparatingBatchDemucsRef.current ? demucsLiveStatsRef.current : {};
            data.series.episodes.forEach((ep) => {
              if (checkEpisodeHasAudioReady(ep, null, liveTts)) {
                serverTtsDone.add(ep.id);
              }
              if (checkEpisodeHasDemucsReady(ep, null, liveDemucs)) {
                serverDemucsDone.add(ep.id);
              }
            });
            setCompletedTtsEpIds(serverTtsDone);
            setCompletedDemucsEpIds(serverDemucsDone);
          }
        })
        .catch(() => {});
    }
    if (typeof onRefreshSeries === 'function') {
      try { onRefreshSeries(); } catch (_) {}
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeSeries?.id, seriesId, onRefreshSeries]);

  const isDemucsCancelledRef = useRef(false);
  const isTranslateCancelledRef = useRef(false);
  const isTtsCancelledRef = useRef(false);
  const activeTimersRef = useRef(new Set());
  const [confirmDialog, setConfirmDialog] = useState(null);
  const confirmResolverRef = useRef(null);

  const openStudioDialog = useCallback((config) => new Promise((resolve) => {
    if (confirmResolverRef.current) {
      try { confirmResolverRef.current(false); } catch (_) {}
    }
    confirmResolverRef.current = resolve;
    setConfirmDialog({
      showCancel: true,
      ...config,
    });
  }), []);

  const closeStudioDialog = useCallback((accepted) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    if (typeof resolve === 'function') {
      resolve(Boolean(accepted));
    }
  }, []);

  // Cleanup all running polling timers and pending confirm dialog on modal unmount or when modal closes
  useEffect(() => {
    if (!isOpen) {
      activeTimersRef.current.forEach((t) => clearInterval(t));
      activeTimersRef.current.clear();
      if (confirmResolverRef.current) {
        try { confirmResolverRef.current(false); } catch (_) {}
        confirmResolverRef.current = null;
      }
      setConfirmDialog(null);
    }
    return () => {
      activeTimersRef.current.forEach((t) => clearInterval(t));
      activeTimersRef.current.clear();
      if (confirmResolverRef.current) {
        try { confirmResolverRef.current(false); } catch (_) {}
        confirmResolverRef.current = null;
      }
    };
  }, [isOpen]);

  const handleKillTranslate = async (targetOrJob = null) => {
    try {
      isTranslateCancelledRef.current = true;
      const jobId = targetOrJob?.jobId || targetOrJob?.id;
      const targetEpId = targetOrJob?.episodeId || (targetOrJob && !targetOrJob.jobId ? targetOrJob.id : null);
      await fetch('/api/jobs/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: jobId || undefined,
          episodeId: targetEpId || undefined,
          seriesId: activeSeries?.id || seriesId || undefined,
          all: !targetOrJob,
        }),
      });
      setIsStartingBatch(false);
      setBatchInfo(null);
      setBatchSuccess((prev) => (isTranslateQueueEnqueueBanner(prev) ? null : prev));
      setBatchError('🛑 បានបញ្ឈប់ (Kill) ដំណើរការ Translate ដោយជោគជ័យ!');
      if (typeof onRefreshSeries === 'function') {
        try { await onRefreshSeries(); } catch (_) {}
      }
    } catch (err) {
      console.error('[Kill Translate] Error:', err);
    }
  };

  const handleKillTTS = async (targetEp = null) => {
    try {
      isTtsCancelledRef.current = true;
      const targetSeriesId = activeSeries?.id || seriesId;
      await fetch('/api/tts/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesId: targetSeriesId,
          episodeId: targetEp?.id || undefined,
          all: !targetEp,
        }),
      });
      if (targetEp) {
        setActiveTtsEpisodeIds((prev) => {
          const next = new Set(prev);
          next.delete(targetEp.id);
          return next;
        });
        if (activeTtsEpisodeId === targetEp.id) {
          setActiveTtsEpisodeId(null);
        }
        setTtsLiveStats((prev) => ({
          ...prev,
          [targetEp.id]: {
            ...(prev[targetEp.id] || {}),
            isDone: false,
            logs: [...(prev[targetEp.id]?.logs || []), {
              time: new Date().toLocaleTimeString(),
              progress: prev[targetEp.id]?.percent || 0,
              message: '🛑 បានបញ្ឈប់ (Kill) ដំណើរការ TTS នៃភាគនេះ!',
            }],
          },
        }));
      } else {
        activeTimersRef.current.forEach((t) => clearInterval(t));
        activeTimersRef.current.clear();
        setIsGeneratingBatchTTS(false);
        setActiveTtsEpisodeId(null);
        setActiveTtsEpisodeIds(new Set());
        setBatchError('🛑 បានបញ្ឈប់ (Kill) ដំណើរការបង្កើតសំឡេង TTS ដោយជោគជ័យ!');
      }
      if (typeof onRefreshSeries === 'function') {
        try { await onRefreshSeries(); } catch (_) {}
      }
    } catch (err) {
      console.error('[Kill TTS] Error:', err);
    }
  };

  const handleKillDemucs = async (targetEp = null) => {
    try {
      isDemucsCancelledRef.current = true;
      const videoRef = targetEp ? (targetEp.video?.videoPath || targetEp.video?.videoUrl || targetEp.videoFile || targetEp.sourceVideoPath) : null;
      await fetch('/api/audio/separate-kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath: videoRef, jobId: 'all' }),
      });
      setIsSeparatingBatchDemucs(false);
      setActiveDemucsEpisodeId(null);
      setActiveDemucsEpisodeIds(new Set());
      setBatchError('🛑 បានបញ្ឈប់ (Kill) ដំណើរការបំបែកសំឡេង Demucs ដោយជោគជ័យ!');
      if (typeof onRefreshSeries === 'function') {
        try { await onRefreshSeries(); } catch (_) {}
      }
    } catch (err) {
      console.error('[Kill Demucs] Error:', err);
    }
  };

  // Single-source-of-truth job queue from JobQueueContext (Zero duplicate polling)
  const { jobs: activeJobs = [], isLoading: isJobsLoading = false } = useSharedJobQueue();

  // Shared Gemini Keys & Cascade Summary (heavy monitor lives in dedicated GeminiQuotaModal)
  const {
    keysHealth,
    isUpdatingQuotaSettings,
    handleSelectPreferredModel,
  } = useGeminiQuotaMonitor({
    enabled: Boolean(isOpen),
    initialProbe: 'stats',
    pollIntervalMs: 8000,
  });
  const [quotaNowMs, setQuotaNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return undefined;
    const tickTimer = setInterval(() => {
      setQuotaNowMs(Date.now());
    }, 1000);
    return () => clearInterval(tickTimer);
  }, [isOpen]);

  // Close on Escape key (only when dedicated Quota or Confirm modal isn't layered on top)
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (
        e.key === 'Escape' &&
        !document.querySelector('[data-testid="gemini-quota-modal"]') &&
        !document.querySelector('[data-testid="studio-confirm-modal"]')
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleOpenQuotaConsole = useCallback(() => {
    if (!onOpenQuotaModal) return;
    const isLocalLoopBusy = isGeneratingBatchTTS || isSeparatingBatchDemucs;
    if (!isLocalLoopBusy) {
      onClose?.();
    }
    onOpenQuotaModal();
  }, [onOpenQuotaModal, onClose, isGeneratingBatchTTS, isSeparatingBatchDemucs]);



  const currentSeriesId = activeSeries?.id || seriesId;

  // Map of latest job per episodeId for current series (tracks running, queued, completed, and failed states)
  const jobsByEpisodeId = useMemo(() => {
    const map = new Map();
    const sorted = [...activeJobs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const job of sorted) {
      if (currentSeriesId && job.seriesId && String(job.seriesId) !== String(currentSeriesId)) {
        continue;
      }
      if (job.episodeId && !map.has(job.episodeId)) {
        map.set(job.episodeId, job);
      }
    }
    return map;
  }, [activeJobs, currentSeriesId]);

  const activeSeriesTranslateJobs = useMemo(
    () => getActiveSeriesTranslateJobs(activeJobs, currentSeriesId),
    [activeJobs, currentSeriesId]
  );
  const hasActiveTranslateQueue = activeSeriesTranslateJobs.length > 0;
  const wasTranslateQueueActiveRef = useRef(false);

  // Trigger series refresh automatically whenever a queued/running translate job finishes via SSE
  const seenCompletedJobsRef = useRef(new Set());
  const hasInitializedSseRef = useRef(false);
  const prevSeriesForSseRef = useRef(currentSeriesId);

  useEffect(() => {
    if (prevSeriesForSseRef.current !== currentSeriesId) {
      prevSeriesForSseRef.current = currentSeriesId;
      seenCompletedJobsRef.current.clear();
      hasInitializedSseRef.current = false;
      wasTranslateQueueActiveRef.current = false;
    }

    const currentCompletedKeys = new Set();
    for (const job of activeJobs) {
      if (!job || (job.status !== 'completed' && job.status !== 'partial')) continue;
      if (currentSeriesId && job.seriesId && String(job.seriesId) !== String(currentSeriesId)) {
        continue;
      }
      const jKey = `${job.jobId || job.id || job.episodeId}:${job.status}:${job.completedAt || job.updatedAt || 'done'}`;
      currentCompletedKeys.add(jKey);
    }

    if (!hasInitializedSseRef.current) {
      if (isJobsLoading && activeJobs.length === 0) {
        return;
      }
      hasInitializedSseRef.current = true;
      currentCompletedKeys.forEach((k) => seenCompletedJobsRef.current.add(k));
      return;
    }

    let hasNewlyCompleted = false;
    for (const k of currentCompletedKeys) {
      if (!seenCompletedJobsRef.current.has(k)) {
        seenCompletedJobsRef.current.add(k);
        hasNewlyCompleted = true;
      }
    }

    if (hasNewlyCompleted && typeof onRefreshSeries === 'function') {
      try {
        onRefreshSeries();
      } catch (_) {}
    }

    if (hasNewlyCompleted && !hasActiveTranslateQueue && !isStartingBatch) {
      setBatchSuccess((prev) => (isTranslateQueueEnqueueBanner(prev) ? null : prev));
    }
  }, [activeJobs, isJobsLoading, currentSeriesId, onRefreshSeries, hasActiveTranslateQueue, isStartingBatch]);

  // Clear stale enqueue queue banner once active translate jobs drain from > 0 to 0
  useEffect(() => {
    if (hasActiveTranslateQueue) {
      wasTranslateQueueActiveRef.current = true;
      return;
    }
    if (wasTranslateQueueActiveRef.current && !isStartingBatch) {
      wasTranslateQueueActiveRef.current = false;
      setBatchSuccess((prev) => (isTranslateQueueEnqueueBanner(prev) ? null : prev));
    }
  }, [hasActiveTranslateQueue, isStartingBatch]);

  // Handle single-episode retry on failure
  const handleRetryEpisode = async (ep) => {
    try {
      setBatchError(null);
      const rawVideoRef = ep.video?.videoPath || ep.video?.videoId || ep.videoFile || ep.sourceVideoPath;
      await startGenerationJob({
        videoId: rawVideoRef,
        videoPath: ep.video?.videoPath || ep.sourceVideoPath,
        seriesId: activeSeries?.id || seriesId || 'drama_project',
        episodeId: ep.id,
        mode: dubbingMode,
        force: false,
        genre,
        narratorGender,
        seriesGlossary: activeSeries?.glossary,
        apiKey: apiKey || undefined,
      });
    } catch (err) {
      setBatchError(err.message || 'ការ Retry បរាជ័យ');
    }
  };

  // Check if an episode is 100% completed across all 3 steps (Translate + Audio TTS + Clean BGM)
  // Uses strictly stored episode segments via checkEpisodeHasScript from geminiRouteHelpers
  const isEpisodeFullyDone = useCallback((ep) => {
    if (!ep) return false;
    const hasScript = checkEpisodeHasScript(ep);
    const hasAudio = checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats);
    const hasDemucs = checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats);
    return Boolean(hasScript && hasAudio && hasDemucs);
  }, [completedTtsEpIds, ttsLiveStats, completedDemucsEpIds, demucsLiveStats]);

  // All episodes with a source video ordered sequentially (supports Step 4 export on completed episodes)
  const episodesWithVideo = useMemo(() => {
    return episodes
      .filter((ep) => Boolean(ep?.video || ep?.videoFile || ep?.sourceVideoPath))
      .sort((a, b) => (Number(a.episodeNumber) || 0) - (Number(b.episodeNumber) || 0));
  }, [episodes]);

  // Episodes that still have pending work (Step 1, Step 2, or Step 3)
  const pendingEpisodes = useMemo(() => {
    return episodesWithVideo.filter((ep) => !isEpisodeFullyDone(ep));
  }, [episodesWithVideo, isEpisodeFullyDone]);

  // Auto-select episodes by default on open (pending work if any, else all episodes with video for Step 4 export)
  useEffect(() => {
    if (isOpen && episodes.length > 0 && selectedEpIds.size === 0) {
      if (pendingEpisodes.length > 0) {
        const toPick = pendingEpisodes.slice(0, Math.min(4, pendingEpisodes.length));
        setSelectedEpIds(new Set(toPick.map((ep) => ep.id)));
      } else if (episodesWithVideo.length > 0) {
        setSelectedEpIds(new Set(episodesWithVideo.map((ep) => ep.id)));
      }
    }
  }, [isOpen, episodes.length, pendingEpisodes, episodesWithVideo]);

  const toggleSelect = (id) => {
    const ep = episodes.find((e) => e.id === id);
    const hasVid = Boolean(ep && (ep.video || ep.videoFile || ep.sourceVideoPath));
    if (!hasVid) return;
    const next = new Set(selectedEpIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedEpIds(next);
  };

  const handleSelectCount = (count) => {
    const pool = pendingEpisodes.length > 0 ? pendingEpisodes : episodesWithVideo;
    const picked = pool.slice(0, count);
    setSelectedEpIds(new Set(picked.map((ep) => ep.id)));
  };

  const handleSelectAllUnscripted = () => {
    const unscripted = pendingEpisodes.filter((ep) => !checkEpisodeHasScript(ep));
    setSelectedEpIds(new Set(unscripted.map((ep) => ep.id)));
  };

  const handleSelectAll = () => {
    setSelectedEpIds(new Set(pendingEpisodes.map((ep) => ep.id)));
  };

  const handleSelectAllWithVideo = () => {
    setSelectedEpIds(new Set(episodesWithVideo.map((ep) => ep.id)));
  };

  // Selected export readiness & shared aspect ratio for Step 4 handoff to Export Studio
  const checkEpHasVoiceReady = useCallback((ep) => {
    return checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats);
  }, [completedTtsEpIds, ttsLiveStats]);

  const selectedEpisodesForExport = useMemo(
    () => episodesWithVideo.filter((ep) => selectedEpIds.has(ep.id)),
    [episodesWithVideo, selectedEpIds]
  );

  const selectedVoicedForExport = useMemo(
    () => selectedEpisodesForExport.filter((ep) => checkEpHasVoiceReady(ep)),
    [selectedEpisodesForExport, checkEpHasVoiceReady]
  );

  const isBatchExportRunning = Boolean(batchRender?.isRunning || batchRender?.job?.status === 'running');
  const isBatchExportStarting = Boolean(batchRender?.isStarting);
  const batchExportJob = batchRender?.job || null;

  const firstSelectedWithVideo = selectedEpisodesForExport[0] || activeEpisode || null;
  const step4SrcW = Number(firstSelectedWithVideo?.metadata?.width || firstSelectedWithVideo?.video?.width) || 0;
  const step4SrcH = Number(firstSelectedWithVideo?.metadata?.height || firstSelectedWithVideo?.video?.height) || 0;
  const resolvedStep4AspectRatio =
    sanitizeAspectRatio(currentAspectRatio) ||
    sanitizeAspectRatio(voiceSettings?.aspectRatio) ||
    resolveDefaultAspectRatio(step4SrcW, step4SrcH) ||
    '16:9';

  const translateSummary = useMemo(
    () => computeSeriesTranslateSummary(episodes, jobsByEpisodeId),
    [episodes, jobsByEpisodeId]
  );
  const {
    completedCount,
    healthyScriptedCount,
    totalTextBrokenCount,
    remainingCount,
    unsavedCompletedJobsCount,
    isTranslateAllDone,
    translatePercent,
  } = translateSummary;

  const selectedTargetEpisodes = useMemo(
    () => episodes.filter((ep) => selectedEpIds.has(ep.id)),
    [episodes, selectedEpIds]
  );
  const {
    unscriptedEpisodes: unscriptedSelectedEpisodes,
    scriptedEpisodes: scriptedSelectedEpisodes,
  } = useMemo(
    () => partitionSelectedEpisodesForTranslate(selectedTargetEpisodes),
    [selectedTargetEpisodes]
  );

  // Segment-level broken summaries (stored segments are the single source of truth)
  const selectedBrokenSummary = useMemo(
    () => getEpisodesBrokenSummary(selectedTargetEpisodes),
    [selectedTargetEpisodes]
  );
  const seriesBrokenSummary = useMemo(
    () => getEpisodesBrokenSummary(episodes),
    [episodes]
  );
  const effectiveBrokenSummary = selectedEpIds.size > 0 ? selectedBrokenSummary : seriesBrokenSummary;
  const repairButtonCount = effectiveBrokenSummary.totalBrokenCount;

  // Truthful STEP 2 & STEP 3 DONE flags: DONE ONLY when broken count == 0 across target episodes
  const isStep2TargetDone = selectedEpIds.size > 0
    ? (unscriptedSelectedEpisodes.length === 0 && selectedBrokenSummary.textBrokenCount === 0)
    : (isTranslateAllDone && seriesBrokenSummary.textBrokenCount === 0);

  // Total completed audio across all episodes (uses segment-level broken scan)
  const completedAudioCount = useMemo(() => {
    return episodes.filter((ep) => checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats)).length;
  }, [episodes, completedTtsEpIds, ttsLiveStats]);

  const unAudioCount = Math.max(0, episodes.length - completedAudioCount);
  const audioPercent = computeClampedStagePercent(completedAudioCount, episodes.length);

  // Total completed Demucs (Clean BGM) across all episodes
  const completedDemucsCount = useMemo(() => {
    return episodes.filter((ep) => checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats)).length;
  }, [episodes, completedDemucsEpIds, demucsLiveStats]);

  const unDemucsCount = Math.max(0, episodes.length - completedDemucsCount);
  const demucsPercent = computeClampedStagePercent(completedDemucsCount, episodes.length);
  const overallStagePercent = computeClampedStagePercent(
    healthyScriptedCount + completedAudioCount + completedDemucsCount,
    episodes.length * 3
  );

  // Completion flags across the whole series (episode flags NEVER override segment-level broken counts)
  const isAudioAllDone =
    episodes.length > 0 &&
    completedAudioCount === episodes.length &&
    seriesBrokenSummary.totalBrokenCount === 0;
  const isDemucsAllDone = episodes.length > 0 && completedDemucsCount === episodes.length;
  const isAll1To3Done = isTranslateAllDone && isAudioAllDone && isDemucsAllDone;
  const is1And2Done = isTranslateAllDone && isAudioAllDone && !isDemucsAllDone;

  // Selected episodes that still need Demucs separation
  const unDemucsSelectedEpisodes = useMemo(() => {
    return episodes.filter((ep) => {
      const isDone = checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats);
      return selectedEpIds.has(ep.id) && !isDone;
    });
  }, [episodes, selectedEpIds, completedDemucsEpIds, demucsLiveStats]);

  const allSelectedDemucsCompleted = useMemo(() => {
    if (selectedEpIds.size === 0) return false;
    return unDemucsSelectedEpisodes.length === 0;
  }, [selectedEpIds, unDemucsSelectedEpisodes]);

  // Selected episodes that still need audio generation (filter out already completed)
  const unAudioSelectedEpisodes = useMemo(() => {
    return episodes.filter((ep) => {
      const isDone = checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats);
      return selectedEpIds.has(ep.id) && !isDone;
    });
  }, [episodes, selectedEpIds, completedTtsEpIds, ttsLiveStats]);

  const allSelectedAudioCompleted = useMemo(() => {
    if (selectedEpIds.size === 0) return false;
    return unAudioSelectedEpisodes.length === 0 && selectedBrokenSummary.totalBrokenCount === 0;
  }, [selectedEpIds, unAudioSelectedEpisodes, selectedBrokenSummary.totalBrokenCount]);

  const isStep3TrulyDone = selectedEpIds.size > 0
    ? allSelectedAudioCompleted
    : isAudioAllDone;

  const activeSeriesRepairJobs = useMemo(() => {
    return activeJobs.filter(
      (j) =>
        j &&
        (j.mode === 'repair_broken' || j.config?.isRepairBroken === true) &&
        (!currentSeriesId || !j.seriesId || String(j.seriesId) === String(currentSeriesId)) &&
        (j.status === 'running' || j.status === 'queued')
    );
  }, [activeJobs, currentSeriesId]);

  const isRepairBusy = isRepairingBroken || activeSeriesRepairJobs.length > 0;

  // Track submitted repair-broken queued jobs to report exact completed vs partial (quota) outcome
  useEffect(() => {
    if (!Array.isArray(trackedRepairJobIds) || trackedRepairJobIds.length === 0) {
      return undefined;
    }

    let cancelled = false;
    const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

    const finalizeIfAllDone = async (jobSnapshots) => {
      if (cancelled) return;
      if (jobSnapshots.length < trackedRepairJobIds.length) return;
      if (!jobSnapshots.every((j) => j && TERMINAL_STATUSES.has(j.status))) return;

      let totalFixed = 0;
      let totalRemaining = 0;
      let anyQuota = false;
      let firstError = null;

      for (const j of jobSnapshots) {
        const fr = j.finalResult || {};
        totalFixed += Number(fr.fixedCount || 0);
        totalRemaining += Number(fr.remainingCount ?? fr.remainingBroken ?? 0);
        if (fr.reason === 'quota' || /quota|429/i.test(String(fr.message || j.error || ''))) {
          anyQuota = true;
        }
        if (j.status === 'failed' && !firstError) {
          firstError = j.error || fr.message || 'ការជួសជុលឃ្លាខូចបរាជ័យ';
        }
      }

      setTrackedRepairJobIds([]);
      setIsRepairingBroken(false);
      setRepairProgressSummary(null);

      if (typeof onRefreshSeries === 'function') {
        try {
          await onRefreshSeries();
        } catch (_) {}
      }

      if (cancelled) return;

      if (totalRemaining > 0) {
        setBatchError(null);
        setBatchSuccess(null);
        setBatchInfo(
          `កែបាន ${totalFixed} • នៅសល់ ${totalRemaining}${anyQuota ? ' (quota)' : ''} — ចុចម្ដងទៀតដើម្បីបន្ត`
        );
      } else if (firstError && totalFixed === 0) {
        setBatchSuccess(null);
        setBatchInfo(null);
        setBatchError(`❌ ${firstError}`);
      } else {
        setBatchError(null);
        setBatchInfo(null);
        setBatchSuccess(
          `✅ ជួសជុលឃ្លាខូច & Generate សំឡេងរួចរាល់ 100% (${totalFixed} ឃ្លា)!`
        );
      }
    };

    const checkFromSharedOrApi = async () => {
      const snapshots = [];
      for (const jid of trackedRepairJobIds) {
        const fromShared = activeJobs.find((j) => String(j.jobId || j.id) === String(jid));
        if (fromShared && TERMINAL_STATUSES.has(fromShared.status)) {
          snapshots.push(fromShared);
          continue;
        }
        try {
          const st = await fetchJobStatusApi(jid);
          if (st && st.success && st.status) {
            snapshots.push({
              jobId: jid,
              status: st.status,
              progress: st.progress,
              stageMessage: st.message,
              finalResult: st.finalResult,
              error: st.error,
            });
          } else if (fromShared) {
            snapshots.push(fromShared);
          }
        } catch (_) {
          if (fromShared) snapshots.push(fromShared);
        }
      }

      if (!cancelled && snapshots.length > 0) {
        const runningOne = snapshots.find((s) => s.status === 'running' || s.status === 'queued');
        if (runningOne) {
          setRepairProgressSummary(runningOne.stageMessage || 'កំពុងជួសជុលឃ្លាខូច...');
        }
      }

      await finalizeIfAllDone(snapshots);
    };

    checkFromSharedOrApi();
    const pollTimer = setInterval(checkFromSharedOrApi, 1500);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, [trackedRepairJobIds, activeJobs, onRefreshSeries]);

  const executeBatchTranslateEnqueue = async (episodesToTranslate, { force = false, skippedScriptedCount = 0 } = {}) => {
    try {
      setIsStartingBatch(true);
      setBatchError(null);
      setBatchSuccess(null);
      setBatchInfo(null);

      const promises = episodesToTranslate.map(async (ep) => {
        const rawVideoRef = ep.video?.videoPath || ep.video?.videoId || ep.videoFile || ep.sourceVideoPath;
        return startGenerationJob({
          videoId: rawVideoRef,
          videoPath: ep.video?.videoPath || ep.sourceVideoPath,
          seriesId: activeSeries?.id || seriesId || 'drama_project',
          episodeId: ep.id,
          mode: dubbingMode,
          force: force === true,
          genre,
          narratorGender,
          seriesGlossary: activeSeries?.glossary,
          apiKey: apiKey || undefined,
        });
      });

      const results = await Promise.allSettled(promises);
      const successfulResults = results
        .filter((r) => r.status === 'fulfilled' && r.value?.success)
        .map((r) => r.value);
      const successful = successfulResults.length;
      const queuedCount = successfulResults.filter((v) => v?.status === 'queued').length;
      const runningCount = Math.max(0, successful - queuedCount);
      const alreadyDone = results.filter(
        (r) =>
          (r.status === 'fulfilled' && r.value?.alreadyCompleted) ||
          (r.status === 'rejected' && r.reason?.data?.alreadyCompleted)
      ).length;
      const failedReasons = results
        .filter(
          (r) =>
            (r.status === 'rejected' && !r.reason?.data?.alreadyCompleted) ||
            (r.status === 'fulfilled' && !r.value?.success && !r.value?.alreadyCompleted)
        )
        .map((r) => (r.status === 'rejected' ? (r.reason?.message || 'Request failed') : (r.value?.error || 'Request failed')));

      const totalSkipped = skippedScriptedCount + alreadyDone;

      if (successful === 0 && totalSkipped > 0 && failedReasons.length === 0) {
        setBatchInfo('ភាគដែលរើសទាំងអស់មាន Script រួចរាល់ហើយ — បើចង់ធ្វើឡើងវិញ សូមប្រើ Re-Translate');
      } else if (successful === 0 && failedReasons.length > 0) {
        setBatchError(`❌ ការចាប់ផ្ដើម Translate បរាជ័យ (${failedReasons.length} ភាគ): ${failedReasons[0]}`);
        if (skippedScriptedCount > 0) {
          setBatchInfo(`រំលង ${skippedScriptedCount} ភាគ (មាន Script រួចរាល់)`);
        }
      } else {
        const queueNote = queuedCount > 0 ? ` (ដំណើរការ ${runningCount} + រង់ចាំក្នុង Queue ${queuedCount})` : '';
        const skipNote = totalSkipped > 0 ? ` • រំលង ${totalSkipped} ភាគ (មាន Script រួចរាល់)` : '';
        setBatchSuccess(
          `🎉 បានដាក់បញ្ចូល ${force ? 'Re-Translate' : 'Translate'} ចំនួន ${successful} ភាគ${queueNote}${skipNote}!`
        );
        if (failedReasons.length > 0) {
          setBatchError(`⚠️ មាន ${failedReasons.length} ភាគមិនអាចចាប់ផ្ដើមបាន: ${failedReasons[0]}`);
        }
      }
      if (typeof onRefreshSeries === 'function') {
        try {
          await onRefreshSeries();
        } catch (_) {}
      }
    } catch (err) {
      console.error(err);
      setBatchError(err.message || 'ការចាប់ផ្ដើម Translate បរាជ័យ');
    } finally {
      setIsStartingBatch(false);
    }
  };

  // Default batch click = fill gaps ONLY (always force: false, skips stored scripted episodes)
  const handleStartBatchTranslate = async () => {
    const targetEpisodes = episodes.filter((ep) => selectedEpIds.has(ep.id));
    if (targetEpisodes.length === 0) {
      await openStudioDialog({
        showCancel: false,
        variant: 'warning',
        badge: 'TRANSLATE',
        title: 'សូមជ្រើសរើសភាគជាមុនសិន',
        message: 'សូមជ្រើសរើសភាគដែលចង់ Translate ជាមុនសិន!',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    const episodesWithoutVideo = targetEpisodes.filter((ep) => !ep.video && !ep.videoFile && !ep.sourceVideoPath);
    if (episodesWithoutVideo.length > 0) {
      await openStudioDialog({
        showCancel: false,
        variant: 'warning',
        badge: 'MISSING VIDEO',
        title: 'ភាគមួយចំនួនមិនទាន់មានវីដេអូទេ',
        chips: episodesWithoutVideo.map((e) => `EP${e.episodeNumber || e.id}`),
        message: 'សូម Upload វីដេអូសម្រាប់ភាគទាំងនេះជាមុនសិន មុននឹងចាប់ផ្ដើម Translate។',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    const { unscriptedEpisodes, scriptedEpisodes } = partitionSelectedEpisodesForTranslate(targetEpisodes);

    if (unscriptedEpisodes.length === 0) {
      setBatchError(null);
      setBatchSuccess(null);
      if (selectedBrokenSummary.textBrokenCount > 0) {
        setBatchInfo(
          `ភាគដែលរើសមាន Script រួច ប៉ុន្តែនៅខ្វះ/ខូច ${selectedBrokenSummary.textBrokenCount} ឃ្លា — សូមចុច "🔧 ជួសជុលឃ្លាខូច & Generate ឡើងវិញ" ខាងក្រោម Step 3 ដើម្បីកែតែឃ្លាខូច`
        );
      } else {
        setBatchInfo('ភាគដែលរើសទាំងអស់មាន Script រួចរាល់ហើយ — បើចង់ធ្វើឡើងវិញ សូមប្រើ Re-Translate');
      }
      return;
    }

    await executeBatchTranslateEnqueue(unscriptedEpisodes, {
      force: false,
      skippedScriptedCount: scriptedEpisodes.length,
    });
  };

  // One-click sweep of ONLY text-broken + voice-broken segments (never re-runs whole episodes)
  const handleRepairBrokenSegments = async () => {
    if (hasActiveTranslateQueue || isStartingBatch) {
      setBatchError(null);
      setBatchSuccess(null);
      setBatchInfo(
        '⏳ កំពុងដំណើរការ Translate / Re-Translate — សូមរង់ចាំឱ្យ Queue ចប់សិន មុននឹងចុចជួសជុលឃ្លាខូច!'
      );
      return;
    }

    const candidateEps = selectedTargetEpisodes.length > 0 ? selectedTargetEpisodes : episodes;
    if (candidateEps.length === 0) {
      await openStudioDialog({
        showCancel: false,
        variant: 'warning',
        badge: 'REPAIR',
        title: 'មិនទាន់មានភាគសម្រាប់ជួសជុលទេ',
        message: 'សូមបន្ថែម ឬជ្រើសរើសភាគវីដេអូជាមុនសិន។',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    // Filter to ONLY episodes that have at least 1 broken segment (skip 100% healthy episodes like EP1-EP4)
    const targetEps = candidateEps.filter((ep) => {
      const scan = getEpisodeBrokenSummary(ep);
      return (scan?.totalBrokenCount || 0) > 0;
    });

    if (targetEps.length === 0) {
      setBatchError(null);
      setBatchSuccess(null);
      setBatchInfo('គ្រប់ឃ្លារួចរាល់ 100% — គ្មានឃ្លាខូចទេ!');
      return;
    }

    const summary = getEpisodesBrokenSummary(targetEps);
    const n1 = summary.textBrokenCount;
    const n2 = summary.voiceBrokenCount;

    const confirmed = await openStudioDialog({
      variant: 'repair',
      badge: `REPAIR • ${summary.totalBrokenCount} ឃ្លា`,
      title: 'បញ្ជាក់ការជួសជុលឃ្លាខូច & Generate ឡើងវិញ',
      subtitle: `អត្ថបទខូច: ${n1} ឃ្លា • សំឡេងខ្វះ: ${n2} ឃ្លា (${targetEps.length} ភាគ)`,
      chips: targetEps.map((e) => `EP${e.episodeNumber || e.id}`),
      bullets: [
        'នឹងបកប្រែ & បង្កើតសំឡេងតែលើឃ្លាដែលខូចប៉ុណ្ណោះ (មិនប៉ះពាល់ឃ្លាដែលល្អរួចស្រាប់ទេ)។',
        'ប្រសិនបើ Gemini Quota អស់កណ្តាលទី ប្រព័ន្ធនឹងរក្សាទុកលទ្ធផលដែលកែរួច ហើយរាយការណ៍ដើម្បីចុចបន្ត។',
      ],
      question: 'តើអ្នកចង់ចាប់ផ្ដើមជួសជុលឃ្លាខូចទាំងនេះឥឡូវនេះទេ?',
      confirmLabel: `🔧 ជួសជុល (${summary.totalBrokenCount} ឃ្លា)`,
      cancelLabel: 'បោះបង់',
    });
    if (!confirmed) return;

    try {
      setIsRepairingBroken(true);
      setBatchError(null);
      setBatchSuccess(null);
      setBatchInfo(null);

      const res = await startRepairBrokenJobApi({
        seriesId: currentSeriesId || 'drama_project',
        episodeIds: targetEps.map((ep) => ep.id),
        apiKey: apiKey || undefined,
      });

      const enqueuedJobs = Array.isArray(res?.jobs) ? res.jobs : [];
      const conflictJobs = Array.isArray(res?.conflicts) ? res.conflicts : [];
      const allJobIds = [
        ...enqueuedJobs.map((j) => j.jobId || j.id).filter(Boolean),
        ...conflictJobs.map((c) => c.existingJobId).filter(Boolean),
      ];

      if (allJobIds.length === 0) {
        setIsRepairingBroken(false);
        if (typeof onRefreshSeries === 'function') {
          try { await onRefreshSeries(); } catch (_) {}
        }
        setBatchSuccess('✅ គ្រប់ឃ្លារួចរាល់ 100% — គ្មានឃ្លាខូចទេ!');
        return;
      }

      setRepairProgressSummary(
        `🔧 កំពុងជួសជុលឃ្លាខូច ${enqueuedJobs.length || allJobIds.length} ភាគ (អត្ថបទខូច: ${n1} ឃ្លា • សំឡេងខ្វះ: ${n2} ឃ្លា)...`
      );
      setTrackedRepairJobIds(allJobIds);
    } catch (err) {
      console.error('[Repair Broken] Error:', err);
      setIsRepairingBroken(false);
      setRepairProgressSummary(null);
      setBatchError(`❌ ${err.message || 'ការជួសជុលឃ្លាខូចបរាជ័យ'}`);
    }
  };

  // Separate explicit Re-Translate control (the ONLY path allowed to send force: true)
  const handleReTranslateSelected = async () => {
    const targetEpisodes = episodes.filter((ep) => selectedEpIds.has(ep.id));
    if (targetEpisodes.length === 0) {
      await openStudioDialog({
        showCancel: false,
        variant: 'warning',
        badge: 'RE-TRANSLATE',
        title: 'សូមជ្រើសរើសភាគជាមុនសិន',
        message: 'សូមជ្រើសរើសភាគដែលចង់ Re-Translate ជាមុនសិន!',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    const episodesWithoutVideo = targetEpisodes.filter((ep) => !ep.video && !ep.videoFile && !ep.sourceVideoPath);
    if (episodesWithoutVideo.length > 0) {
      await openStudioDialog({
        showCancel: false,
        variant: 'warning',
        badge: 'MISSING VIDEO',
        title: 'ភាគមួយចំនួនមិនទាន់មានវីដេអូទេ',
        chips: episodesWithoutVideo.map((e) => `EP${e.episodeNumber || e.id}`),
        message: 'សូម Upload វីដេអូសម្រាប់ភាគទាំងនេះជាមុនសិន មុននឹងចាប់ផ្ដើម Re-Translate។',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    const modeLabel = dubbingMode === 'fast_ocr' ? '⚡ Fast OCR' : (dubbingMode === 'recap' ? 'Mode B: សម្រាយរឿង' : 'Mode A: សន្ទនា 1:1');
    const confirmed = await openStudioDialog({
      variant: 'warning',
      badge: 'FORCE RE-RUN',
      title: 'បញ្ជាក់ការ Re-Translate ឡើងវិញ',
      subtitle: `សម្រាប់ ${targetEpisodes.length} ភាគ • ${modeLabel}`,
      chips: targetEpisodes.map((e) => `EP${e.episodeNumber || e.id}`),
      bullets: [
        `នឹងដំណើរការ FULL Pipeline ឡើងវិញពីដើម (OCR + ASR + Gemini) តាម (${modeLabel})។`,
        'នឹងប្រើប្រាស់ Quota របស់ Gemini API Keys (Key Pool)។',
        'ប្រព័ន្ធនឹងធ្វើ Auto-Backup Script ចាស់ទុកជាមុនសិន រួចទើបសរសេរជាន់លើ Script បច្ចុប្បន្ន (Overwrite) ពេល Job នីមួយៗបញ្ចប់។',
      ],
      question: 'តើអ្នកប្រាកដជាចង់បន្ត Re-Translate មែនទេ?',
      confirmLabel: `Re-Translate (${targetEpisodes.length} ភាគ)`,
      cancelLabel: 'បោះបង់',
    });
    if (!confirmed) return;

    await executeBatchTranslateEnqueue(targetEpisodes, {
      force: true,
      skippedScriptedCount: 0,
    });
  };

  // ── Trigger Batch Khmer TTS (Step 3) for Selected Episodes (Skip Already Completed) ──
  const handleBatchGenerateTTS = async () => {
    const targetEpisodes = episodes.filter((ep) => selectedEpIds.has(ep.id));
    if (targetEpisodes.length === 0) {
      await openStudioDialog({
        showCancel: false,
        variant: 'warning',
        badge: 'KHMER AI VOICE',
        title: 'សូមជ្រើសរើសភាគជាមុនសិន',
        message: 'សូមជ្រើសរើសភាគដែលចង់បង្កើតសំឡេង AI ជាមុនសិន!',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    const targetSeriesId = activeSeries?.id || seriesId;

    // Fetch fresh server metadata to guarantee 100% accuracy on which episodes are already completed on disk
    let freshServerEpisodes = [];
    try {
      const sRes = await fetch(`/api/series/${targetSeriesId}`);
      const sData = await sRes.json();
      if (sData?.success && Array.isArray(sData.series?.episodes)) {
        freshServerEpisodes = sData.series.episodes;
      }
    } catch (_) {}

    // Filter to only episodes that actually need audio generation (never skip outdated episodes using stale localStorage flags)
    const pendingEpisodes = targetEpisodes.filter((localEp) => {
      const serverEp = freshServerEpisodes.find((fe) => String(fe.id) === String(localEp.id));
      const isDone = serverEp
        ? checkEpisodeHasAudioReady(serverEp, null, isGeneratingBatchTtsRef.current ? ttsLiveStats : null)
        : checkEpisodeHasAudioReady(localEp, completedTtsEpIds, ttsLiveStats);
      return !isDone;
    });

    if (pendingEpisodes.length === 0) {
      setBatchSuccess(`🎉 គ្រប់ភាគដែលបានជ្រើសរើស (${targetEpisodes.length} ភាគ) គឺបានបង្កើតសំឡេង AI រួចរាល់ 100% ហើយ មិនបាច់បង្កើតឡើងវិញទេ!`);
      return;
    }

    try {
      setIsGeneratingBatchTTS(true);
      setBatchError(null);
      setBatchSuccess(null);
      setBatchInfo(null);
      setTtsProgressPercent(1);

      // Trigger ALL pending episodes simultaneously in parallel (100% Like Step 1)
      const allPendingIds = new Set(pendingEpisodes.map((e) => e.id));
      setActiveTtsEpisodeIds(allPendingIds);
      setActiveTtsEpisodeId(pendingEpisodes[0]?.id || null);
      setTtsCurrentEpTitle(`គ្រប់ភាគ (${pendingEpisodes.length} ភាគ) កំពុងដំណើរការព្រមគ្នា...`);

      let newlyCompletedCount = 0;

      const ttsPromises = pendingEpisodes.map(async (ep, idx) => {
        const serverEp = freshServerEpisodes.find((fe) => String(fe.id) === String(ep.id));
        const effectiveEp = serverEp || ep;

        // Skip immediately if fresh server state confirms non-outdated completed narration on disk
        if (checkEpisodeHasAudioReady(effectiveEp, serverEp ? null : completedTtsEpIds, null)) {
          console.log(`[Batch TTS] Episode ${ep.id} already has completed narration on disk. Skipping.`);
          setCompletedTtsEpIds((prev) => new Set([...prev, ep.id]));
          setActiveTtsEpisodeIds((prev) => {
            const next = new Set(prev);
            next.delete(ep.id);
            return next;
          });
          return;
        }

        // Ensure we have up-to-date script segments for this episode (prefer newer/repaired server segments when available)
        const localSegs = Array.isArray(ep.scriptData?.segments) ? ep.scriptData.segments : [];
        const serverSegs = Array.isArray(serverEp?.scriptData?.segments) ? serverEp.scriptData.segments : [];
        const localUpdatedAt = Number(ep.scriptData?.updatedAt || 0);
        const serverUpdatedAt = Number(serverEp?.scriptData?.updatedAt || 0);
        let segs = (serverSegs.length > 0 && (localSegs.length === 0 || serverUpdatedAt >= localUpdatedAt))
          ? serverSegs
          : localSegs;
        if (!Array.isArray(segs) || segs.length === 0) {
          try {
            const sRes = await fetch(`/api/series/${targetSeriesId}`);
            const sData = await sRes.json();
            const sEp = (sData?.series?.episodes || []).find((e) => e.id === ep.id);
            if (sEp?.scriptData?.segments?.length > 0) {
              segs = sEp.scriptData.segments;
            }
          } catch (_) {}
        }

        if (segs.length === 0) {
          console.warn(`[Batch TTS] Episode ${ep.id} has no script segments to generate.`);
          setActiveTtsEpisodeIds((prev) => {
            const next = new Set(prev);
            next.delete(ep.id);
            return next;
          });
          return;
        }

        const emptySegsCount = segs.filter(s => !String(s.khmer || s.khmerText || s.khmerTranslatedText || '').trim()).length;
        const validSegsCount = segs.length - emptySegsCount;
        const totalExpectedSegs = segs.length;
        const skippedNote = emptySegsCount > 0 ? ` (រំលង ${emptySegsCount} ឃ្លា គ្មានអត្ថបទ)` : '';
        const initialLog = {
          time: new Date().toLocaleTimeString(),
          progress: 0,
          message: `🎙️ ចាប់ផ្ដើមដំណើរការបង្កើតសំឡេងខ្មែរ AI (${validSegsCount}/${totalExpectedSegs} ឃ្លា${skippedNote}) តាមរយៈ km-KH-PisethNeural...`,
        };
        setTtsLiveStats((prev) => ({
          ...prev,
          [ep.id]: { current: 0, total: totalExpectedSegs, percent: 0, isDone: false, logs: [initialLog] },
        }));

        // Start live polling of generated audio segments with zero-blocking interval (1200ms)
        let lastReportedCurrent = 0;
        const pollTimer = setInterval(async () => {
          try {
            const pRes = await fetch(`/api/tts/progress?seriesId=${targetSeriesId}&episodeId=${ep.id}&total=${totalExpectedSegs}`);
            const pData = await pRes.json();
            if (pData && pData.success) {
              const cur = pData.current || 0;
              const tot = pData.total || totalExpectedSegs;
              const epPct = tot > 0 ? Math.min(100, Math.round((cur / tot) * 100)) : 0;

              setTtsLiveStats((prev) => {
                const prevStats = prev[ep.id] || { logs: [] };
                const currentLogs = [...(prevStats.logs || [])];

                if (cur > lastReportedCurrent) {
                  lastReportedCurrent = cur;
                  const lastFilename = pData.lastFile ? pData.lastFile.replace(/\.mp3$/, '') : `ឃ្លា #${cur}`;
                  currentLogs.push({
                    time: new Date().toLocaleTimeString(),
                    progress: epPct,
                    message: `⚡ សំយោគឃ្លា #${cur}/${tot} រួចរាល់ (${epPct}%) [${lastFilename}]`,
                  });
                }
                if (epPct >= 95 && !pData.isDone && !currentLogs.some((l) => l.message?.includes('FFmpeg Hierarchical'))) {
                  currentLogs.push({
                    time: new Date().toLocaleTimeString(),
                    progress: 95,
                    message: `🎧 FFmpeg Hierarchical Audio Sync: កំពុងតម្រឹម & ផ្គុំសំឡេងខ្មែរ Master Narration...`,
                  });
                }
                if (pData.isDone && !currentLogs.some((l) => l.message?.includes('Master Narration រួចរាល់'))) {
                  currentLogs.push({
                    time: new Date().toLocaleTimeString(),
                    progress: 100,
                    message: `✅ Master Narration រួចរាល់ ១០០% (${ep.id}_narration_khmer.mp3)`,
                  });
                }

                return {
                  ...prev,
                  [ep.id]: {
                    current: cur,
                    total: tot,
                    percent: epPct,
                    isDone: Boolean(pData.isDone),
                    logs: currentLogs.slice(-40),
                  },
                };
              });
            }
          } catch (_) {}
        }, 1200);
        activeTimersRef.current.add(pollTimer);

        // Build speakerMap if available (skip generic 'តួអង្គ'/'Speaker' collisions, prefer server registry when up-to-date)
        const speakerMap = {};
        const regSource = (serverUpdatedAt >= localUpdatedAt && serverEp?.speakerRegistry && Object.keys(serverEp.speakerRegistry).length > 0)
          ? serverEp.speakerRegistry
          : (ep.speakerRegistry && Object.keys(ep.speakerRegistry).length > 0)
            ? ep.speakerRegistry
            : (activeSeries?.glossary?.characters || {});
        Object.values(regSource)
          .sort((a, b) => (a.lineCount || 0) - (b.lineCount || 0))
          .forEach((spk) => {
            if (spk.voiceId) {
              const key = spk.id || spk.speakerId || spk.name;
              if (key) speakerMap[key] = spk.voiceId;
              const isGeneric = !spk.name || spk.name === 'តួអង្គ' || String(spk.name).toLowerCase() === 'speaker';
              if (!isGeneric) speakerMap[spk.name] = spk.voiceId;
            }
          });

        // Call TTS API for this episode
        try {
          const res = await fetch('/api/generate-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              seriesId: targetSeriesId,
              episodeId: ep.id,
              segments: segs,
              speed: 'normal',
              speakerMap,
            }),
          });
          const data = await res.json().catch(() => ({}));
          clearInterval(pollTimer);
          activeTimersRef.current.delete(pollTimer);

          if (res.ok && data.success) {
            newlyCompletedCount++;
            setCompletedTtsEpIds((prev) => new Set([...prev, ep.id]));
            const skippedEmpty = typeof data.skippedEmptyCount === 'number'
              ? data.skippedEmptyCount
              : segs.filter(s => !String(s.khmer || s.khmerText || s.khmerTranslatedText || '').trim()).length;
            const validCount = typeof data.validCount === 'number' ? data.validCount : (segs.length - skippedEmpty);
            const skippedMsg = skippedEmpty > 0 ? ` (រំលង ${skippedEmpty} ឃ្លា គ្មានអត្ថបទ)` : '';
            setTtsLiveStats((prev) => {
              const currentLogs = [...(prev[ep.id]?.logs || [])];
              currentLogs.push({
                time: new Date().toLocaleTimeString(),
                progress: 100,
                message: `🎉 សំឡេងខ្មែរ AI (${validCount} ឃ្លា) និង Master Narration សម្រេចជោគជ័យ${skippedMsg}!`,
              });
              return {
                ...prev,
                [ep.id]: {
                  current: totalExpectedSegs,
                  total: totalExpectedSegs,
                  percent: 100,
                  isDone: true,
                  logs: currentLogs.slice(-40),
                },
              };
            });
          }
        } catch (epErr) {
          clearInterval(pollTimer);
          activeTimersRef.current.delete(pollTimer);
          console.error(`[Batch TTS] Failed for episode ${ep.id}:`, epErr);
          setTtsLiveStats((prev) => {
            const currentLogs = [...(prev[ep.id]?.logs || [])];
            currentLogs.push({
              time: new Date().toLocaleTimeString(),
              progress: prev[ep.id]?.percent || 0,
              message: `❌ បរាជ័យក្នុងការបង្កើតសំឡេង: ${epErr.message || 'Error'}`,
            });
            return {
              ...prev,
              [ep.id]: {
                ...prev[ep.id],
                isFailed: true,
                logs: currentLogs.slice(-40),
              },
            };
          });
        } finally {
          setActiveTtsEpisodeIds((prev) => {
            const next = new Set(prev);
            next.delete(ep.id);
            return next;
          });
        }
      });

      // Wait for all episodes to complete simultaneously in parallel
      await Promise.all(ttsPromises);

      setTtsProgressPercent(100);
      setActiveTtsEpisodeId(null);
      setActiveTtsEpisodeIds(new Set());
      setBatchSuccess(`🎉 បានបង្កើតសំឡេងខ្មែរ AI (TTS) សម្រេចជោគជ័យចំនួន ${newlyCompletedCount} ភាគបន្ថែម!`);
      if (typeof onRefreshSeries === 'function') {
        try { await onRefreshSeries(); } catch (_) {}
      }
    } catch (err) {
      console.error('[Batch TTS] Error:', err);
      setBatchError(err.message || 'ការបង្កើតសំឡេង AI ជួបបញ្ហា');
    } finally {
      setIsGeneratingBatchTTS(false);
      setActiveTtsEpisodeId(null);
      setTtsCurrentEpTitle('');
    }
  };

  // ── Trigger Batch Demucs Vocal Separation (Step 3) for Selected Episodes (2, 5, or all) ──
  const handleBatchDemucsSeparation = async () => {
    const targetEpisodes = episodes.filter((ep) => selectedEpIds.has(ep.id));
    if (targetEpisodes.length === 0) {
      await openStudioDialog({
        showCancel: false,
        variant: 'warning',
        badge: 'DEMUCS AI',
        title: 'សូមជ្រើសរើសភាគជាមុនសិន',
        message: 'សូមជ្រើសរើសភាគដែលចង់បំបែកសំឡេង Demucs AI ជាមុនសិន!',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    // Filter only episodes that actually need Demucs separation
    const episodesToProcess = targetEpisodes.filter((ep) => {
      const isDone = checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats);
      return !isDone;
    });

    if (episodesToProcess.length === 0) {
      setBatchError(null);
      setBatchInfo(null);
      setBatchSuccess('🎉 ភាគដែលបានជ្រើសរើសទាំងអស់ មានសំឡេង Clean BGM រួចរាល់អស់ហើយ!');
      await openStudioDialog({
        showCancel: false,
        variant: 'success',
        badge: 'CLEAN BGM READY',
        title: 'សំឡេង Clean BGM រួចរាល់អស់ហើយ',
        message: '🎉 ភាគដែលបានជ្រើសរើសទាំងអស់ មានសំឡេង Clean BGM រួចរាល់អស់ហើយ!',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    const episodesWithVideo = episodesToProcess.filter((ep) => ep.video?.videoPath || ep.video?.videoId || ep.videoFile || ep.sourceVideoPath);
    if (episodesWithVideo.length === 0) {
      await openStudioDialog({
        showCancel: false,
        variant: 'warning',
        badge: 'MISSING VIDEO',
        title: 'មិនទាន់មានវីដេអូសម្រាប់បំបែកសំឡេងទេ',
        message: 'ភាគដែលបានជ្រើសរើសមិនទាន់មានវីដេអូសម្រាប់បំបែកសំឡេងទេ!',
        confirmLabel: 'យល់ព្រម',
      });
      return;
    }

    try {
      setIsSeparatingBatchDemucs(true);
      setBatchError(null);
      setBatchSuccess(null);
      setBatchInfo(null);
      setDemucsProgressPercent(5);
      isDemucsCancelledRef.current = false;

      let separatedCount = 0;
      const allDemucsPendingIds = new Set(episodesWithVideo.map((e) => e.id));
      setActiveDemucsEpisodeIds(allDemucsPendingIds);
      setActiveDemucsEpisodeId(episodesWithVideo[0]?.id || null);
      setDemucsCurrentEpTitle(`កំពុងបំបែកសំឡេង Clean BGM តាមលំដាប់លំដោយ (${episodesWithVideo.length} ភាគ)...`);

      // Execute sequentially one episode at a time:
      // Prevents Chrome socket exhaustion (net::ERR_INSUFFICIENT_RESOURCES),
      // keeps connection pool free, and prevents CPU memory overflow
      for (let i = 0; i < episodesWithVideo.length; i++) {
        if (isDemucsCancelledRef.current) {
          console.log('[Batch Demucs] Cancelled by user before ep:', episodesWithVideo[i].id);
          break;
        }
        const ep = episodesWithVideo[i];
        const videoRef = ep.video?.videoPath || ep.video?.videoUrl || ep.videoFile || ep.sourceVideoPath;
        const titleStr = ep.displayTitle || ep.title || `EP${ep.episodeNumber || i + 1}`;

        setActiveDemucsEpisodeId(ep.id);
        setDemucsCurrentEpTitle(`${titleStr} (${i + 1}/${episodesWithVideo.length}) - កំពុងបំបែកសំឡេង AI...`);

        const initialLog = {
          time: new Date().toLocaleTimeString(),
          progress: 5,
          message: `🎧 [ភាគ ${i + 1}/${episodesWithVideo.length}] ចាប់ផ្ដើមបំបែកសំឡេងដើម (Demucs AI Model: htdemucs) សម្រាប់ ${titleStr}...`,
        };
        setDemucsLiveStats((prev) => ({
          ...prev,
          [ep.id]: { percent: 5, isDone: false, logs: [initialLog], message: 'AI Deep Learning Stem Separation...', model: 'htdemucs' },
        }));

        // Controlled polling loop at 1200ms with in-flight request lock for real-time Terminal parity
        let isPolling = false;
        const demucsPollTimer = setInterval(async () => {
          if (isDemucsCancelledRef.current) {
            clearInterval(demucsPollTimer);
            activeTimersRef.current.delete(demucsPollTimer);
            return;
          }
          if (isPolling) return;
          isPolling = true;
          try {
            const dpRes = await fetch(`/api/audio/separation-progress?videoPath=${encodeURIComponent(videoRef)}`);
            if (!dpRes.ok) return;
            const dpData = await dpRes.json();
            if (dpData && dpData.success && typeof dpData.progress === 'number') {
              const dPct = Math.min(100, Math.max(5, dpData.progress));
              setDemucsProgressPercent(dPct);
              setDemucsLiveStats((prev) => {
                const prevD = prev[ep.id] || { logs: [] };
                let mergedLogs = [...(prevD.logs || [])];

                // Synchronize server-side logs directly from backend Demucs process
                if (Array.isArray(dpData.logs) && dpData.logs.length > 0) {
                  const seen = new Set(mergedLogs.map((l) => `${l.progress}_${l.message}`));
                  for (const sLog of dpData.logs) {
                    const key = `${sLog.progress}_${sLog.message}`;
                    if (!seen.has(key)) {
                      mergedLogs.push(sLog);
                      seen.add(key);
                    }
                  }
                } else {
                  const lastLog = mergedLogs[mergedLogs.length - 1];
                  const lastProgress = typeof lastLog?.progress === 'number' ? lastLog.progress : 0;
                  if (dPct > lastProgress) {
                    mergedLogs.push({
                      time: new Date().toLocaleTimeString(),
                      progress: dPct,
                      message: `⏳ Demucs Progress: ${dPct}%`,
                    });
                  }
                }

                return {
                  ...prev,
                  [ep.id]: {
                    percent: dPct,
                    isDone: dpData.status === 'completed' || dPct >= 100,
                    message: dpData.message || `⏳ Demucs Progress: ${dPct}%`,
                    model: dpData.model || 'htdemucs',
                    logs: mergedLogs.slice(-60),
                  },
                };
              });
            }
          } catch (_) {}
          finally {
            isPolling = false;
          }
        }, 1200);
        activeTimersRef.current.add(demucsPollTimer);

        try {
          let sepResult = null;
          let postErrorMsg = null;

          try {
            const res = await fetch('/api/audio/separate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                videoPath: videoRef,
                seriesId: activeSeries?.id || seriesId,
                episodeId: ep.id,
              }),
            });
            if (isDemucsCancelledRef.current) {
              clearInterval(demucsPollTimer);
              break;
            }
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
              sepResult = data;
            } else if (res.status !== 502) {
              postErrorMsg = data.error || 'Server error';
            }
          } catch (postNetErr) {
            const isTransientDisconnect =
              postNetErr?.name === 'TypeError' ||
              /failed to fetch|network|reset|empty/i.test(postNetErr?.message || '');
            if (!isTransientDisconnect) {
              postErrorMsg = postNetErr.message || 'Network error';
            }
          }

          // Recover seamlessly if browser connection dropped transiently while backend Demucs continues running
          if (!sepResult && !postErrorMsg && !isDemucsCancelledRef.current) {
            let consecutiveErrors = 0;
            while (!sepResult && !postErrorMsg && !isDemucsCancelledRef.current) {
              await new Promise((r) => setTimeout(r, 2000));
              if (isDemucsCancelledRef.current) break;
              try {
                const dpRes = await fetch(`/api/audio/separation-progress?videoPath=${encodeURIComponent(videoRef)}`);
                const dpData = await dpRes.json().catch(() => ({}));
                consecutiveErrors = 0;
                if (dpData.status === 'separating') continue;
                if (dpData.status === 'completed' && dpData.noVocalsUrl) {
                  sepResult = { success: true, noVocalsUrl: dpData.noVocalsUrl, noVocalsPath: dpData.noVocalsPath };
                  break;
                }
                if (dpData.status === 'error') {
                  postErrorMsg = dpData.error || dpData.message || 'Demucs failed';
                  break;
                }
                const stRes = await fetch('/api/audio/separation-status', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ videoPath: videoRef }),
                });
                const stData = await stRes.json().catch(() => ({}));
                if (stRes.ok && stData.success && stData.available && stData.noVocalsUrl) {
                  sepResult = { success: true, noVocalsUrl: stData.noVocalsUrl, noVocalsPath: stData.noVocalsPath };
                } else {
                  postErrorMsg = 'Connection lost during separation';
                }
                break;
              } catch (_) {
                consecutiveErrors++;
                if (consecutiveErrors >= 4) {
                  postErrorMsg = 'Backend server unreachable';
                  break;
                }
              }
            }
          }

          clearInterval(demucsPollTimer);
          if (isDemucsCancelledRef.current) {
            break;
          }
          if (sepResult && sepResult.success) {
            separatedCount++;
            ep.bgmAudioUrl = sepResult.noVocalsUrl;
            ep.cleanBgmPath = sepResult.noVocalsPath;
            ep.isDemucsDone = true;
            ep.hasDemucs = true;
            setCompletedDemucsEpIds((prev) => new Set([...prev, ep.id]));
            setDemucsLiveStats((prev) => ({
              ...prev,
              [ep.id]: {
                percent: 100,
                isDone: true,
                message: 'Clean BGM រួចរាល់ ១០០%',
                logs: [
                  ...(prev[ep.id]?.logs || []),
                  {
                    time: new Date().toLocaleTimeString(),
                    progress: 100,
                    message: `✅ បំបែកសំឡេងដើម (Clean BGM) សម្រេចជោគជ័យ ១០០%!`,
                  },
                ],
              },
            }));
          } else {
            console.error(`[Batch Demucs] Failed for ${ep.id}:`, postErrorMsg);
            setDemucsLiveStats((prev) => ({
              ...prev,
              [ep.id]: {
                ...prev[ep.id],
                isFailed: true,
                logs: [
                  ...(prev[ep.id]?.logs || []),
                  {
                    time: new Date().toLocaleTimeString(),
                    progress: prev[ep.id]?.percent || 5,
                    message: `❌ បរាជ័យក្នុងការបំបែកសំឡេង: ${postErrorMsg || 'Server error'}`,
                  },
                ],
              },
            }));
          }
        } catch (dErr) {
          clearInterval(demucsPollTimer);
          console.error(`[Batch Demucs] Error for ${ep.id}:`, dErr);
          setDemucsLiveStats((prev) => ({
            ...prev,
            [ep.id]: {
              ...prev[ep.id],
              isFailed: true,
              logs: [
                ...(prev[ep.id]?.logs || []),
                {
                  time: new Date().toLocaleTimeString(),
                  progress: prev[ep.id]?.percent || 5,
                  message: `❌ បរាជ័យ: ${dErr.message || 'Network error'}`,
                },
              ],
            },
          }));
        } finally {
          clearInterval(demucsPollTimer);
          activeTimersRef.current.delete(demucsPollTimer);
          setActiveDemucsEpisodeIds((prev) => {
            const next = new Set(prev);
            next.delete(ep.id);
            return next;
          });
          const stepPercent = Math.round(((i + 1) / episodesWithVideo.length) * 100);
          setDemucsProgressPercent(stepPercent);
        }
      }

      if (isDemucsCancelledRef.current) {
        return;
      }

      setDemucsProgressPercent(100);
      setActiveDemucsEpisodeId(null);
      setActiveDemucsEpisodeIds(new Set());
      if (separatedCount > 0) {
        setBatchSuccess(`🎉 បានបំបែកសំឡេងដើម (Demucs AI Clean BGM) សម្រេចជោគជ័យចំនួន ${separatedCount} ភាគ!`);
      } else {
        setBatchError(`❌ មិនទាន់អាចបំបែកសំឡេង Demucs បាននៅឡើយទេ សូមពិនិត្យមើល Console ឬដំណើរការម្ដងទៀត`);
      }
      if (typeof onRefreshSeries === 'function') {
        try { await onRefreshSeries(); } catch (_) {}
      }
    } catch (err) {
      console.error('[Batch Demucs] Error:', err);
      setBatchError(err.message || 'ការបំបែកសំឡេង Demucs ជួបបញ្ហា');
    } finally {
      setIsSeparatingBatchDemucs(false);
      setActiveDemucsEpisodeId(null);
      setDemucsCurrentEpTitle('');
    }
  };

  if (!isOpen) return null;

  const KEY_THEMES = {
    1: { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.3)', dot: '#38bdf8' },
    2: { color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.3)', dot: '#34d399' },
    3: { color: '#818cf8', bg: 'rgba(129, 140, 248, 0.12)', border: 'rgba(129, 140, 248, 0.3)', dot: '#818cf8' },
    4: { color: '#FF8577', bg: 'rgba(255, 133, 119, 0.12)', border: 'rgba(255, 133, 119, 0.3)', dot: '#FF8577' },
    5: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.3)', dot: '#fbbf24' },
    6: { color: '#e879f9', bg: 'rgba(232, 121, 249, 0.12)', border: 'rgba(232, 121, 249, 0.3)', dot: '#e879f9' },
  };
  const keyThemeCount = Object.keys(KEY_THEMES).length;
  const poolTotalKeys = Math.max(1, Number(keysHealth?.quotaSummary?.totalKeys ?? keysHealth?.totalKeys ?? 4) || 4);

  return (
    <div 
      data-testid="gemini-route-modal"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(5, 10, 24, 0.82)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
      onClick={onClose}
    >
      <div 
        style={{
          width: '95vw',
          maxWidth: '1280px',
          height: '92vh',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(20, 30, 51, 0.96)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 20,
          boxShadow: '0 30px 100px -15px rgba(0, 0, 0, 0.85), 0 0 60px -10px rgba(56, 189, 248, 0.18)',
          overflow: 'hidden',
          fontFamily: "'Kantumruy Pro', system-ui, sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 1. MODAL HEADER (Batch Generate Studio) ── */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(16, 25, 44, 0.95)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(255, 133, 119, 0.18) 0%, rgba(56, 189, 248, 0.18) 100%)',
              border: '1px solid rgba(255, 133, 119, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FF8577',
              boxShadow: '0 0 20px rgba(255, 133, 119, 0.25)',
              flexShrink: 0,
            }}>
              <Cpu size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ 
                  margin: 0, 
                  fontSize: '1.05rem', 
                  fontWeight: 900, 
                  color: '#F8FAFC', 
                  letterSpacing: '0.04em', 
                  textTransform: 'uppercase',
                  background: 'linear-gradient(135deg, #FFFFFF 0%, #E2E8F0 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                  BATCH GENERATE STUDIO
                </h2>
                {(() => {
                  const hdrView = applyElapsedCountdownToKeysHealth(keysHealth, quotaNowMs);
                  const hdrSummary = hdrView?.quotaSummary;
                  const hdrTotal = hdrSummary?.totalKeys ?? hdrView?.totalKeys ?? 4;
                  const hdrReady = hdrSummary?.readyKeys ?? hdrView?.activeCount ?? hdrTotal;
                  const hdrRpmPerKey = hdrView?.settings?.rpmPerKey || 15;
                  const hdrRpmReady = hdrReady * hdrRpmPerKey;
                  const allReady = hdrReady === hdrTotal && hdrTotal > 0;
                  const noneReady = hdrReady === 0 && hdrTotal > 0;
                  const pillColor = noneReady ? '#F87171' : allReady ? '#34D399' : '#FBBF24';
                  const pillBg = noneReady ? 'rgba(248, 113, 113, 0.12)' : allReady ? 'rgba(52, 211, 153, 0.12)' : 'rgba(251, 191, 36, 0.12)';
                  const pillBorder = noneReady ? 'rgba(248, 113, 113, 0.35)' : allReady ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 191, 36, 0.35)';
                  const pillShadow = noneReady ? '0 0 12px rgba(248, 113, 113, 0.2)' : allReady ? '0 0 12px rgba(52, 211, 153, 0.2)' : '0 0 12px rgba(251, 191, 36, 0.2)';
                  const pillLabel = hdrTotal > 0
                    ? `${hdrReady}/${hdrTotal} Keys Ready (${hdrRpmReady} RPM Pool)`
                    : 'No Keys Configured';
                  const hdrPrefModel = hdrView?.settings?.preferredModel || 'auto';
                  const hdrReadyModels = hdrSummary?.readyCascadeModelsCount ?? 10;
                  const hdrTotalModels = hdrSummary?.totalCascadeModelsCount ?? 10;
                  const isPinned = hdrPrefModel && hdrPrefModel !== 'auto';
                  return (
                    <>
                      <span style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        padding: '3px 10px',
                        borderRadius: 9999,
                        background: pillBg,
                        color: pillColor,
                        border: `1px solid ${pillBorder}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: pillShadow,
                      }}>
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: pillColor,
                          display: 'inline-block',
                          boxShadow: `0 0 6px ${pillColor}`,
                        }} />
                        {pillLabel}
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
                            ? `Primary: ${hdrPrefModel}`
                            : `Auto Cascade (${hdrReadyModels}/${hdrTotalModels} Models)`}
                        </span>
                      </span>
                    </>
                  );
                })()}
              </div>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.74rem', color: '#94A3B8' }}>
                Translate (Step 2) • Khmer AI Voice (Step 3) • Demucs Clean BGM • Batch Export &amp; Merge
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {onOpenQuotaModal && (
              <button
                type="button"
                data-testid="btn-open-quota-from-batch"
                onClick={handleOpenQuotaConsole}
                className="btn-tactile"
                style={{
                  padding: '7px 13px',
                  borderRadius: 9999,
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.38)',
                  color: '#38BDF8',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 12px rgba(56, 189, 248, 0.16)',
                }}
                title="បើកផ្ទាំងពិនិត្យ Gemini API Keys, Rate Limits គ្រប់ Model និង Pin Primary Model"
              >
                <Key size={13} />
                <span>Key &amp; Model Quota</span>
              </button>
            )}

            {/* Close Button */}
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

        {/* ── UNIFIED SCROLLABLE BODY (Prevents Top Monitor from squishing Episode Grid) ── */}
        <div
          data-testid="modal-scroll-body"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
        {/* ── 2. TOP CONTROL CENTER (GetLayers 4-Tier Depth) ── */}
        <div style={{
          padding: '14px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(16, 25, 44, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {/* Compact Quota Exhaustion Strip (Full Monitor lives in separate Keys & Quota Modal) */}
          {(() => {
            const liveView = applyElapsedCountdownToKeysHealth(keysHealth, quotaNowMs);
            const summary = liveView?.quotaSummary || null;
            const totalKeys = summary?.totalKeys ?? liveView?.totalKeys ?? 0;
            const readyKeys = summary?.readyKeys ?? liveView?.activeCount ?? totalKeys;
            if (totalKeys <= 0 || readyKeys > 0) return null;
            const preferredModel = liveView?.settings?.preferredModel || 'auto';
            const cascadeRows = (Array.isArray(liveView?.modelRateLimits) ? liveView.modelRateLimits : []).filter((m) => m.usableInDubbing);
            const readyModelsCount = summary?.readyCascadeModelsCount ?? cascadeRows.filter((m) => m.liveStatus === 'ready' || m.liveStatus === 'partial' || m.liveStatus === 'untested').length;
            const totalModelsCount = summary?.totalCascadeModelsCount ?? (cascadeRows.length || 10);
            const bestBackup = cascadeRows.find((m) => m.id !== preferredModel && m.liveStatus === 'ready')
              || cascadeRows.find((m) => m.id !== preferredModel && m.liveStatus === 'partial' && (preferredModel !== 'auto' || m.id !== cascadeRows[0]?.id))
              || null;
            return (
              <div
                data-testid="batch-quota-warning-strip"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '7px 12px',
                  borderRadius: 10,
                  background: 'linear-gradient(90deg, rgba(248, 113, 113, 0.14) 0%, rgba(255, 133, 119, 0.08) 100%)',
                  border: '1px solid rgba(248, 113, 113, 0.42)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                  <AlertTriangle size={14} color="#F87171" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '0.70rem', fontWeight: 700, color: '#F8FAFC', lineHeight: 1.35 }}>
                    {bestBackup
                      ? `Quota លើ ${preferredModel === 'auto' ? 'Primary Model' : preferredModel} កំពុងពេញ 429 — Auto Cascade នឹងរត់ទៅ Model ទំនេរ (${readyModelsCount}/${totalModelsCount} Models) ឬប្តូរទៅ «${bestBackup.displayName}»។`
                      : `Key ទាំង ${totalKeys} លើ Primary Model កំពុងជាប់ 429 — ចុច «Key & Model Quota» ដើម្បីពិនិត្យ និង Test គ្រប់ Model (${totalModelsCount} Models)។`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                  {bestBackup && (
                    <button
                      type="button"
                      disabled={isUpdatingQuotaSettings}
                      onClick={async () => {
                        const res = await handleSelectPreferredModel(bestBackup.id);
                        if (res?.success) setBatchInfo(`📌 បានកំណត់ «${bestBackup.id}» ជា Primary Model សម្រាប់បកប្រែ និង Pipeline!`);
                      }}
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
                      <span>ប្តូរទៅ {bestBackup.displayName}</span>
                    </button>
                  )}
                  {onOpenQuotaModal && (
                    <button
                      type="button"
                      onClick={handleOpenQuotaConsole}
                      className="btn-tactile"
                      style={{
                        padding: '4px 10px',
                        borderRadius: 8,
                        background: 'rgba(56, 189, 248, 0.14)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        color: '#38BDF8',
                        fontSize: '0.67rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Key size={11} />
                      <span>ពិនិត្យ Key &amp; Model Quota</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Quick Select & Filter Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            {/* Quick Select Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.74rem', color: '#94A3B8', fontWeight: 700 }}>ជ្រើសរើសភាគ៖</span>
              
              <button
                type="button"
                onClick={() => handleSelectCount(2)}
                className="btn-tactile"
                style={{
                  padding: '6px 14px',
                  borderRadius: 9999,
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: (selectedEpIds.size === 2 || (pendingEpisodes.length < 2 && selectedEpIds.size === pendingEpisodes.length && selectedEpIds.size > 0)) ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  border: selectedEpIds.size === 2 ? '1px solid #38BDF8' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: selectedEpIds.size === 2 ? '#38BDF8' : '#CBD5E1',
                  boxShadow: selectedEpIds.size === 2 ? '0 0 14px rgba(56, 189, 248, 0.25)' : 'none',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                  opacity: episodesWithVideo.length === 0 ? 0.5 : 1,
                  cursor: episodesWithVideo.length === 0 ? 'not-allowed' : 'pointer',
                }}
                disabled={episodesWithVideo.length === 0}
              >
                <Sparkles size={12} />
                <span>២ ភាគ (2 EPs)</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectCount(4)}
                className="btn-tactile"
                style={{
                  padding: '6px 14px',
                  borderRadius: 9999,
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: (selectedEpIds.size === 4 || (pendingEpisodes.length < 4 && selectedEpIds.size === pendingEpisodes.length && selectedEpIds.size > 0)) ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  border: selectedEpIds.size === 4 ? '1px solid #38BDF8' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: selectedEpIds.size === 4 ? '#38BDF8' : '#CBD5E1',
                  boxShadow: selectedEpIds.size === 4 ? '0 0 14px rgba(56, 189, 248, 0.25)' : 'none',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                  opacity: episodesWithVideo.length === 0 ? 0.5 : 1,
                  cursor: episodesWithVideo.length === 0 ? 'not-allowed' : 'pointer',
                }}
                disabled={episodesWithVideo.length === 0}
              >
                <Sparkles size={12} />
                <span>៤ ភាគ (4 EPs)</span>
              </button>

              <button
                type="button"
                onClick={handleSelectAll}
                className="btn-tactile"
                style={{
                  padding: '6px 15px',
                  borderRadius: 9999,
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: (selectedEpIds.size === pendingEpisodes.length && pendingEpisodes.length > 0) ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  border: (selectedEpIds.size === pendingEpisodes.length && pendingEpisodes.length > 0) ? '1px solid #38BDF8' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: (selectedEpIds.size === pendingEpisodes.length && pendingEpisodes.length > 0) ? '#38BDF8' : '#CBD5E1',
                  boxShadow: (selectedEpIds.size === pendingEpisodes.length && pendingEpisodes.length > 0) ? '0 0 14px rgba(56, 189, 248, 0.25)' : 'none',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                  opacity: pendingEpisodes.length === 0 ? 0.6 : 1,
                  cursor: pendingEpisodes.length === 0 ? 'not-allowed' : 'pointer',
                }}
                disabled={pendingEpisodes.length === 0}
                title={pendingEpisodes.length === 0 ? 'គ្រប់ភាគទាំងអស់រួចរាល់ 100% ហើយ' : 'ជ្រើសរើសភាគដែលនៅសល់'}
              >
                <Sparkles size={12} />
                <span>{pendingEpisodes.length === 0 ? '✓ គ្រប់ភាគរួចរាល់ 100%' : `ភាគនៅសល់ (${pendingEpisodes.length} ភាគ)`}</span>
              </button>

              <button
                type="button"
                onClick={handleSelectAllWithVideo}
                className="btn-tactile"
                style={{
                  padding: '6px 14px',
                  borderRadius: 9999,
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: (selectedEpIds.size === episodesWithVideo.length && episodesWithVideo.length > 0) ? 'rgba(16, 185, 129, 0.22)' : 'rgba(255, 255, 255, 0.04)',
                  border: (selectedEpIds.size === episodesWithVideo.length && episodesWithVideo.length > 0) ? '1px solid #34D399' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: (selectedEpIds.size === episodesWithVideo.length && episodesWithVideo.length > 0) ? '#34D399' : '#CBD5E1',
                  boxShadow: (selectedEpIds.size === episodesWithVideo.length && episodesWithVideo.length > 0) ? '0 0 14px rgba(16, 185, 129, 0.22)' : 'none',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                  opacity: episodesWithVideo.length === 0 ? 0.5 : 1,
                  cursor: episodesWithVideo.length === 0 ? 'not-allowed' : 'pointer',
                }}
                disabled={episodesWithVideo.length === 0}
                title="ជ្រើសរើសគ្រប់ភាគទាំងអស់ (រួមទាំងភាគធ្វើរួច) ដើម្បី Batch Export ឬ Merge Full Video"
              >
                <Layers size={12} />
                <span>🌐 ទាំងអស់ ({episodesWithVideo.length} ភាគ)</span>
              </button>

              {selectedEpIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedEpIds(new Set())}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 9999,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94A3B8',
                    cursor: 'pointer',
                  }}
                >
                  លុប ({selectedEpIds.size})
                </button>
              )}
            </div>

            {/* Dubbing Options Dropdowns */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(25, 39, 68, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 9999,
              padding: '3px 8px',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
            }}>
              {/* Dubbing Mode */}
              <select
                value={dubbingMode}
                onChange={(e) => setDubbingMode(e.target.value)}
                style={{
                  background: '#141E33',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#F8FAFC',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  borderRadius: 9999,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="fast_ocr">⚡ Fast OCR: Subtitle ចិន ➡️ ខ្មែរ (លឿនបំផុត 3-5x)</option>
                <option value="dialogue">Mode A: សន្ទនាតួអង្គ (1:1)</option>
                <option value="recap">Mode B: សម្រាយរឿងកុន</option>
              </select>

              {/* Genre */}
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                style={{
                  background: '#141E33',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#F8FAFC',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  borderRadius: 9999,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="auto">Auto (ស្គាល់ស្វ័យប្រវត្ត)</option>
                <option value="ancient">បុរាណចិន / Xianxia</option>
                <option value="modern">សម័យទំនើប / CEO</option>
                <option value="action">Action / សងសឹក</option>
              </select>

              {/* Narrator Voice in Mode B vs Fast OCR vs Mode A */}
              {dubbingMode === 'recap' ? (
                <select
                  value={narratorGender}
                  onChange={(e) => setNarratorGender(e.target.value)}
                  style={{
                    background: '#0f172a',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#f8fafc',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    borderRadius: 6,
                    padding: '5px 8px',
                    cursor: 'pointer',
                  }}
                >
                  <option value="male">👨 ប្រុស (Piseth)</option>
                  <option value="female">👩 ស្រី (Sreymom)</option>
                </select>
              ) : dubbingMode === 'fast_ocr' ? (
                <div style={{
                  background: 'rgba(251, 191, 36, 0.15)',
                  border: '1px solid rgba(251, 191, 36, 0.35)',
                  color: '#FBBF24',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  borderRadius: 6,
                  padding: '5px 9px',
                  whiteSpace: 'nowrap',
                }}>
                  ⚡ Bypass ASR (3-5x Faster)
                </div>
              ) : (
                <div style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: '#38bdf8',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  borderRadius: 6,
                  padding: '5px 9px',
                  whiteSpace: 'nowrap',
                }}>
                  ✨ Auto (ប្រុស + ស្រី)
                </div>
              )}
            </div>
          </div>

          {/* ── 3-STEP PRIMARY WORKFLOW ACTIONS (DragonDub Studio Suite - Tactile Glass) ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            paddingTop: 4,
          }}>
            {/* ── 1. TRANSLATE ACTION (Step 1 - Fill Gaps ONLY; Re-Translate is a separate explicit control) ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                data-testid="btn-batch-translate"
                onClick={handleStartBatchTranslate}
                disabled={isStartingBatch || selectedEpIds.size === 0}
                className="btn-tactile"
                style={{
                  position: 'relative',
                  padding: '11px 16px',
                  borderRadius: 14,
                  background: isStartingBatch
                    ? '#131b2e'
                    : (selectedEpIds.size === 0)
                    ? 'rgba(255, 255, 255, 0.04)'
                    : 'linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4338ca 100%)',
                  border: (selectedEpIds.size === 0)
                    ? '1px solid rgba(255, 255, 255, 0.08)'
                    : '1px solid #38bdf8',
                  color: (selectedEpIds.size === 0) ? '#64748B' : '#ffffff',
                  fontWeight: 800,
                  cursor: (isStartingBatch || selectedEpIds.size === 0) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  boxShadow: (selectedEpIds.size > 0 && !isStartingBatch)
                    ? '0 6px 20px rgba(2, 132, 199, 0.4)'
                    : 'none',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textAlign: 'left' }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {isStartingBatch ? (
                      <Loader2 size={17} className="animate-spin" color="#38bdf8" />
                    ) : (
                      <Sparkles size={17} color="#ffffff" />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {isStartingBatch
                        ? 'កំពុងបញ្ជូន Translate...'
                        : unscriptedSelectedEpisodes.length > 0 && scriptedSelectedEpisodes.length > 0
                        ? `🚀 Translate ${unscriptedSelectedEpisodes.length} ភាគថ្មី (រំលង ${scriptedSelectedEpisodes.length})`
                        : unscriptedSelectedEpisodes.length > 0
                        ? `🚀 Translate ${unscriptedSelectedEpisodes.length} ភាគ (${remainingCount} នៅសល់)`
                        : (selectedEpIds.size > 0 && selectedBrokenSummary.textBrokenCount > 0)
                        ? `⚠️ នៅខ្វះ/ខូច ${selectedBrokenSummary.textBrokenCount} ឃ្លា`
                        : (selectedEpIds.size === 0 && seriesBrokenSummary.textBrokenCount > 0)
                        ? `⚠️ នៅខ្វះ/ខូច ${seriesBrokenSummary.textBrokenCount} ឃ្លា`
                        : selectedEpIds.size > 0
                        ? `🚀 Translate (${selectedEpIds.size} ភាគមាន Script រួច)`
                        : `🚀 Translate (${remainingCount} ភាគនៅសល់)`}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'rgba(255, 255, 255, 0.8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {unscriptedSelectedEpisodes.length === 0 && selectedEpIds.size > 0
                        ? (selectedBrokenSummary.textBrokenCount > 0
                          ? `មាន Script (${completedCount}/${episodes.length}) • នៅខ្វះ/ខូចអត្ថបទ ${selectedBrokenSummary.textBrokenCount} ឃ្លា`
                          : `រំលងភាគមាន Script រួច (${completedCount}/${episodes.length})`)
                        : (seriesBrokenSummary.textBrokenCount > 0
                          ? `មាន Script ${completedCount}/${episodes.length} • នៅខ្វះ/ខូច ${seriesBrokenSummary.textBrokenCount} ឃ្លា`
                          : dubbingMode === 'fast_ocr'
                          ? `⚡ Fast OCR • រំលងភាគរួច (${completedCount}/${episodes.length})`
                          : `រំលងភាគមាន Script រួច (${completedCount}/${episodes.length})`)}
                    </div>
                  </div>
                </div>
                <span
                  data-testid="step2-status-badge"
                  style={{
                    fontSize: '0.64rem',
                    fontWeight: 900,
                    background: isStep2TargetDone ? 'rgba(16, 185, 129, 0.25)' : 'rgba(0, 0, 0, 0.35)',
                    color: isStep2TargetDone ? '#34d399' : '#38bdf8',
                    padding: '2px 8px',
                    borderRadius: 9999,
                    border: isStep2TargetDone ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(56, 189, 248, 0.3)',
                    flexShrink: 0,
                    letterSpacing: '0.04em',
                  }}
                >
                  {isStep2TargetDone ? 'DONE' : 'STEP 2'}
                </span>
              </button>

              {/* Separate explicit Re-Translate button (ONLY control allowed to send force: true) */}
              <button
                type="button"
                data-testid="btn-batch-retranslate"
                onClick={handleReTranslateSelected}
                disabled={isStartingBatch || selectedEpIds.size === 0 || scriptedSelectedEpisodes.length === 0}
                className="btn-tactile"
                title="ដំណើរការ FULL Pipeline (OCR + ASR + Gemini) ឡើងវិញលើភាគដែលរើស (ប្រើ Quota & Overwrite Script ក្រោយ Auto-Backup)"
                style={{
                  padding: '7px 12px',
                  borderRadius: 10,
                  background: (selectedEpIds.size > 0 && scriptedSelectedEpisodes.length > 0 && !isStartingBatch)
                    ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0%, rgba(217, 119, 6, 0.28) 100%)'
                    : 'rgba(255, 255, 255, 0.03)',
                  border: (selectedEpIds.size > 0 && scriptedSelectedEpisodes.length > 0 && !isStartingBatch)
                    ? '1px solid rgba(245, 158, 11, 0.55)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  color: (selectedEpIds.size > 0 && scriptedSelectedEpisodes.length > 0 && !isStartingBatch) ? '#FBBF24' : '#64748B',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: (isStartingBatch || selectedEpIds.size === 0 || scriptedSelectedEpisodes.length === 0) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <RotateCcw size={13} color={(selectedEpIds.size > 0 && scriptedSelectedEpisodes.length > 0 && !isStartingBatch) ? '#FBBF24' : '#64748B'} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {scriptedSelectedEpisodes.length > 0
                      ? `Re-Translate (${selectedTargetEpisodes.length} ភាគ)`
                      : 'Re-Translate (រើសភាគមាន Script រួច)'}
                  </span>
                </span>
                <span style={{
                  fontSize: '0.6rem',
                  fontWeight: 900,
                  padding: '1px 6px',
                  borderRadius: 9999,
                  background: (selectedEpIds.size > 0 && scriptedSelectedEpisodes.length > 0) ? 'rgba(245, 158, 11, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                  border: (selectedEpIds.size > 0 && scriptedSelectedEpisodes.length > 0) ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
                  color: (selectedEpIds.size > 0 && scriptedSelectedEpisodes.length > 0) ? '#FCD34D' : '#64748B',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}>
                  FORCE
                </span>
              </button>
              {(isStartingBatch || activeSeriesTranslateJobs.some((j) => selectedEpIds.size === 0 || selectedEpIds.has(j.episodeId))) && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const confirmed = await openStudioDialog({
                      variant: 'danger',
                      badge: 'KILL TRANSLATE',
                      title: 'បញ្ឈប់ (Kill) ដំណើរការ Translate ទាំងអស់?',
                      bullets: [
                        'នឹងបញ្ឈប់ Translate Jobs ដែលកំពុងរត់ និងដក Jobs ដែលរង់ចាំក្នុង Queue ទាំងអស់សម្រាប់ Series នេះ។',
                      ],
                      question: 'តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការ Translate ទាំងអស់មែនទេ?',
                      confirmLabel: '🛑 បញ្ឈប់ (Kill All)',
                      cancelLabel: 'បន្តដំណើរការ',
                    });
                    if (confirmed) {
                      handleKillTranslate();
                    }
                  }}
                  className="btn-tactile"
                  style={{
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(185, 28, 28, 0.45) 100%)',
                    border: '1px solid rgba(239, 68, 68, 0.75)',
                    boxShadow: '0 4px 15px rgba(239, 68, 68, 0.35)',
                    color: '#fee2e2',
                    padding: '9px 14px',
                    borderRadius: 10,
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                  }}
                  title="Kill Translate Process"
                >
                  🛑 បញ្ឈប់ (Kill Translate)
                </button>
              )}
            </div>

            {/* ── 2. KHMER AI VOICE ACTION (Step 3 - TTS Synthesis / Tavola Coral) ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                data-testid="btn-batch-tts"
                onClick={handleBatchGenerateTTS}
                disabled={isGeneratingBatchTTS || isSeparatingBatchDemucs || isStartingBatch || isRepairBusy || selectedEpIds.size === 0}
                className="btn-tactile"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: '11px 16px',
                  borderRadius: 14,
                  background: isGeneratingBatchTTS
                    ? 'linear-gradient(135deg, #182236 0%, #1e293b 100%)'
                    : isStep3TrulyDone
                    ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(5, 150, 105, 0.22) 100%)'
                    : (selectedEpIds.size === 0 && effectiveBrokenSummary.totalBrokenCount === 0)
                    ? 'rgba(255, 133, 119, 0.1)'
                    : 'linear-gradient(135deg, #FF8577 0%, #f43f5e 100%)',
                  border: isGeneratingBatchTTS
                    ? '1px solid rgba(255, 133, 119, 0.7)'
                    : isStep3TrulyDone
                    ? '1px solid rgba(16, 185, 129, 0.5)'
                    : (selectedEpIds.size === 0 && effectiveBrokenSummary.totalBrokenCount === 0)
                    ? '1px solid rgba(255, 133, 119, 0.2)'
                    : '1px solid #FF8577',
                  color: isGeneratingBatchTTS ? '#FF8577' : isStep3TrulyDone ? '#34d399' : '#0B132B',
                  fontWeight: 800,
                  cursor: (isGeneratingBatchTTS || isSeparatingBatchDemucs || isStartingBatch || isRepairBusy || selectedEpIds.size === 0) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  boxShadow: (isGeneratingBatchTTS)
                    ? '0 0 20px rgba(255, 133, 119, 0.3)'
                    : isStep3TrulyDone
                    ? '0 2px 14px rgba(16, 185, 129, 0.2)'
                    : (selectedEpIds.size > 0)
                    ? '0 6px 20px rgba(255, 133, 119, 0.38)'
                    : 'none',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* Realtime Progress Track within button during generation */}
                {isGeneratingBatchTTS && (
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    height: 3,
                    width: `${Math.max(4, ttsProgressPercent)}%`,
                    background: 'linear-gradient(90deg, #FF8577 0%, #f43f5e 100%)',
                    boxShadow: '0 0 8px #FF8577',
                    transition: 'width 0.3s ease',
                  }} />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textAlign: 'left' }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: isGeneratingBatchTTS
                      ? 'rgba(255, 133, 119, 0.22)'
                      : isStep3TrulyDone
                      ? 'rgba(16, 185, 129, 0.25)'
                      : 'rgba(11, 19, 43, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {isGeneratingBatchTTS ? (
                      <Loader2 size={17} className="animate-spin" color="#FF8577" />
                    ) : isStep3TrulyDone ? (
                      <CheckCircle2 size={17} color="#34d399" />
                    ) : (
                      <Mic size={17} color={isGeneratingBatchTTS ? '#FF8577' : '#0B132B'} />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.82rem',
                      fontWeight: 900,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: isGeneratingBatchTTS ? '#f8fafc' : isStep3TrulyDone ? '#34d399' : '#0B132B',
                    }}>
                      {isGeneratingBatchTTS
                        ? `🎙️ កំពុង TTS: ${ttsCurrentEpTitle}`
                        : isStep3TrulyDone
                        ? '✓ សំឡេងខ្មែរ AI រួចរាល់ 100%'
                        : effectiveBrokenSummary.totalBrokenCount > 0
                        ? `⚠️ នៅខ្វះ/ខូច ${effectiveBrokenSummary.totalBrokenCount} ឃ្លា (${selectedEpIds.size > 0 ? unAudioSelectedEpisodes.length : unAudioCount} ភាគ)`
                        : `🎙️ បង្កើតសំឡេងខ្មែរ AI (${selectedEpIds.size > 0 ? unAudioSelectedEpisodes.length : unAudioCount} ភាគនៅសល់)`}
                    </div>
                    <div style={{
                      fontSize: '0.68rem',
                      color: isGeneratingBatchTTS
                        ? '#fca5a5'
                        : isStep3TrulyDone
                        ? '#6ee7b7'
                        : 'rgba(11, 19, 43, 0.85)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontWeight: 700,
                    }}>
                      {isGeneratingBatchTTS
                        ? `${ttsLiveStats[activeTtsEpisodeId]?.current || 0}/${ttsLiveStats[activeTtsEpisodeId]?.total || '...'} ឃ្លា (${ttsLiveStats[activeTtsEpisodeId]?.percent || 0}%) • សរុប ${ttsProgressPercent}%`
                        : isStep3TrulyDone
                        ? `គ្រប់ភាគ (${selectedEpIds.size > 0 ? selectedEpIds.size : episodes.length} ភាគ) មានសំឡេង Master ពេញលេញ`
                        : effectiveBrokenSummary.totalBrokenCount > 0
                        ? `អត្ថបទខូច: ${effectiveBrokenSummary.textBrokenCount} • សំឡេងខ្វះ: ${effectiveBrokenSummary.voiceBrokenCount} (Master មិនទាន់គ្រប់)`
                        : 'រំលងភាគដែលធ្វើរួច • Edge-TTS'}
                    </div>
                  </div>
                </div>
                <span
                  data-testid="step3-status-badge"
                  style={{
                    fontSize: '0.64rem',
                    fontWeight: 900,
                    background: isGeneratingBatchTTS
                      ? 'rgba(255, 133, 119, 0.25)'
                      : isStep3TrulyDone
                      ? 'rgba(16, 185, 129, 0.25)'
                      : 'rgba(11, 19, 43, 0.15)',
                    color: isGeneratingBatchTTS ? '#FF8577' : isStep3TrulyDone ? '#34d399' : '#0B132B',
                    padding: '2px 8px',
                    borderRadius: 9999,
                    border: isGeneratingBatchTTS
                      ? '1px solid rgba(255, 133, 119, 0.4)'
                      : isStep3TrulyDone
                      ? '1px solid rgba(16, 185, 129, 0.35)'
                      : '1px solid rgba(11, 19, 43, 0.25)',
                    flexShrink: 0,
                    letterSpacing: '0.04em',
                  }}
                >
                  {isGeneratingBatchTTS ? `${ttsProgressPercent}%` : isStep3TrulyDone ? 'DONE' : 'STEP 3'}
                </span>
              </button>

              {/* ONE Repair Broken & Regenerate Button directly under STEP 3 (Sweeps ONLY text-broken + voice-broken segments) */}
              <button
                type="button"
                data-testid="btn-repair-broken-segments"
                onClick={handleRepairBrokenSegments}
                disabled={isRepairBusy || isGeneratingBatchTTS || isSeparatingBatchDemucs || isStartingBatch || hasActiveTranslateQueue || repairButtonCount === 0}
                className="btn-tactile"
                title={
                  hasActiveTranslateQueue
                    ? `រង់ចាំ Translate / Re-Translate ចប់សិន (${activeSeriesTranslateJobs.length} ភាគកំពុងដំណើរការ/ក្នុង Queue) ដើម្បីកុំឱ្យជាន់គ្នា`
                    : repairButtonCount > 0
                    ? `ជួសជុលតែឃ្លាដែលខូច (${repairButtonCount} ឃ្លា: អត្ថបទខូច ${effectiveBrokenSummary.textBrokenCount} • សំឡេងខ្វះ ${effectiveBrokenSummary.voiceBrokenCount}) ដោយមិនប៉ះពាល់ឃ្លាល្អឡើយ`
                    : 'គ្មានឃ្លាខូចទេ — គ្រប់ឃ្លារួចរាល់ 100%'
                }
                style={{
                  padding: '7px 12px',
                  borderRadius: 10,
                  background: isRepairBusy
                    ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(14, 165, 233, 0.32) 100%)'
                    : hasActiveTranslateQueue
                    ? 'rgba(255, 255, 255, 0.03)'
                    : repairButtonCount > 0
                    ? 'linear-gradient(135deg, rgba(251, 113, 133, 0.18) 0%, rgba(245, 158, 11, 0.26) 100%)'
                    : 'rgba(255, 255, 255, 0.03)',
                  border: isRepairBusy
                    ? '1px solid rgba(56, 189, 248, 0.65)'
                    : hasActiveTranslateQueue
                    ? '1px solid rgba(251, 191, 36, 0.28)'
                    : repairButtonCount > 0
                    ? '1px solid rgba(251, 146, 60, 0.6)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  color: isRepairBusy
                    ? '#7DD3FC'
                    : hasActiveTranslateQueue
                    ? '#94A3B8'
                    : repairButtonCount > 0
                    ? '#FDBA74'
                    : '#64748B',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: (isRepairBusy || isGeneratingBatchTTS || isSeparatingBatchDemucs || isStartingBatch || hasActiveTranslateQueue || repairButtonCount === 0)
                    ? 'not-allowed'
                    : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {isRepairBusy ? (
                    <Loader2 size={13} className="animate-spin" color="#38BDF8" />
                  ) : hasActiveTranslateQueue ? (
                    <Clock size={13} color="#FBBF24" />
                  ) : (
                    <Wrench size={13} color={repairButtonCount > 0 ? '#FB923C' : '#64748B'} />
                  )}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isRepairBusy
                      ? (repairProgressSummary || 'កំពុងជួសជុលឃ្លាខូច...')
                      : hasActiveTranslateQueue
                      ? `⏳ រង់ចាំ Translate Queue (${activeSeriesTranslateJobs.length})...`
                      : `🔧 ជួសជុលឃ្លាខូច & Generate ឡើងវិញ (${repairButtonCount})`}
                  </span>
                </span>
                <span style={{
                  fontSize: '0.6rem',
                  fontWeight: 900,
                  padding: '1px 6px',
                  borderRadius: 9999,
                  background: isRepairBusy
                    ? 'rgba(56, 189, 248, 0.22)'
                    : hasActiveTranslateQueue
                    ? 'rgba(251, 191, 36, 0.16)'
                    : repairButtonCount > 0
                    ? 'rgba(251, 146, 60, 0.22)'
                    : 'rgba(16, 185, 129, 0.14)',
                  border: isRepairBusy
                    ? '1px solid rgba(56, 189, 248, 0.45)'
                    : hasActiveTranslateQueue
                    ? '1px solid rgba(251, 191, 36, 0.38)'
                    : repairButtonCount > 0
                    ? '1px solid rgba(251, 146, 60, 0.45)'
                    : '1px solid rgba(52, 211, 153, 0.3)',
                  color: isRepairBusy
                    ? '#7DD3FC'
                    : hasActiveTranslateQueue
                    ? '#FDE68A'
                    : repairButtonCount > 0
                    ? '#FDBA74'
                    : '#34D399',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}>
                  {isRepairBusy ? 'REPAIRING' : hasActiveTranslateQueue ? 'QUEUE' : repairButtonCount > 0 ? `${repairButtonCount}` : '0'}
                </span>
              </button>
              {isGeneratingBatchTTS && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const confirmed = await openStudioDialog({
                      variant: 'danger',
                      badge: 'KILL TTS',
                      title: 'បញ្ឈប់ (Kill) ដំណើរការ TTS ទាំងអស់?',
                      bullets: [
                        'នឹងបញ្ឈប់ការសំយោគសំឡេងខ្មែរ Edge-TTS ដែលកំពុងដំណើរការភ្លាមៗ។',
                      ],
                      question: 'តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការបង្កើតសំឡេង TTS ទាំងអស់មែនទេ?',
                      confirmLabel: '🛑 បញ្ឈប់ (Kill TTS)',
                      cancelLabel: 'បន្តដំណើរការ',
                    });
                    if (confirmed) {
                      handleKillTTS();
                    }
                  }}
                  className="btn-tactile"
                  style={{
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(185, 28, 28, 0.45) 100%)',
                    border: '1px solid rgba(239, 68, 68, 0.75)',
                    boxShadow: '0 4px 15px rgba(239, 68, 68, 0.35)',
                    color: '#fee2e2',
                    padding: '9px 14px',
                    borderRadius: 10,
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                  }}
                  title="Kill TTS Process"
                >
                  🛑 បញ្ឈប់ (Kill TTS)
                </button>
              )}
            </div>

            {/* ── 3. DEMUCS VOCAL SEPARATION ACTION (Step 3 - AI Clean BGM) ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                onClick={handleBatchDemucsSeparation}
                disabled={isSeparatingBatchDemucs || isGeneratingBatchTTS || isStartingBatch || selectedEpIds.size === 0}
                className="btn-tactile"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: '11px 16px',
                  borderRadius: 14,
                  background: isSeparatingBatchDemucs
                    ? '#131b2e'
                    : allSelectedDemucsCompleted
                    ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(5, 150, 105, 0.22) 100%)'
                    : (selectedEpIds.size === 0)
                    ? 'rgba(56, 189, 248, 0.04)'
                    : 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(14, 165, 233, 0.2) 100%)',
                  border: isSeparatingBatchDemucs
                    ? '1px solid #38bdf8'
                    : allSelectedDemucsCompleted
                    ? '1px solid rgba(16, 185, 129, 0.5)'
                    : (selectedEpIds.size === 0)
                    ? '1px solid rgba(56, 189, 248, 0.18)'
                    : '1px solid rgba(56, 189, 248, 0.5)',
                  color: isSeparatingBatchDemucs ? '#38bdf8' : allSelectedDemucsCompleted ? '#34d399' : '#38bdf8',
                  fontWeight: 800,
                  cursor: (isSeparatingBatchDemucs || isGeneratingBatchTTS || isStartingBatch || selectedEpIds.size === 0) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  boxShadow: allSelectedDemucsCompleted
                    ? '0 2px 14px rgba(16, 185, 129, 0.2)'
                    : (selectedEpIds.size > 0 && !isSeparatingBatchDemucs)
                    ? '0 4px 16px rgba(56, 189, 248, 0.22)'
                    : isSeparatingBatchDemucs
                    ? '0 0 16px rgba(56, 189, 248, 0.25)'
                    : 'none',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* Realtime Progress Track within button during separation */}
                {isSeparatingBatchDemucs && (
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    height: 3,
                    width: `${Math.max(4, demucsProgressPercent)}%`,
                    background: '#38bdf8',
                    boxShadow: '0 0 8px #38bdf8',
                    transition: 'width 0.3s ease',
                  }} />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textAlign: 'left' }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: isSeparatingBatchDemucs
                      ? 'rgba(56, 189, 248, 0.22)'
                      : allSelectedDemucsCompleted
                      ? 'rgba(16, 185, 129, 0.25)'
                      : 'rgba(56, 189, 248, 0.16)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {isSeparatingBatchDemucs ? (
                      <Loader2 size={17} className="animate-spin" color="#38bdf8" />
                    ) : allSelectedDemucsCompleted ? (
                      <CheckCircle2 size={17} color="#34d399" />
                    ) : (
                      <Volume2 size={17} color="#38bdf8" />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.82rem',
                      fontWeight: 900,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: isSeparatingBatchDemucs ? '#f8fafc' : allSelectedDemucsCompleted ? '#34d399' : '#f8fafc',
                    }}>
                      {isSeparatingBatchDemucs
                        ? `🎧 កំពុងបំបែក: ${demucsCurrentEpTitle}`
                        : allSelectedDemucsCompleted
                        ? '✓ Demucs AI Clean BGM រួចរាល់ 100%'
                        : `🎧 បំបែកសំឡេងដើម AI (${unDemucsSelectedEpisodes.length} ភាគនៅសល់)`}
                    </div>
                    <div style={{
                      fontSize: '0.68rem',
                      color: isSeparatingBatchDemucs ? '#7dd3fc' : allSelectedDemucsCompleted ? '#6ee7b7' : '#38bdf8',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontWeight: 700,
                    }}>
                      {isSeparatingBatchDemucs
                        ? `${demucsProgressPercent}% រួចរាល់`
                        : allSelectedDemucsCompleted
                        ? `គ្រប់ភាគ (${selectedEpIds.size} ភាគ) មាន Clean BGM ពេញលេញ`
                        : 'រំលងភាគដែលធ្វើរួច • Demucs AI'}
                    </div>
                  </div>
                </div>
                <span style={{
                  fontSize: '0.64rem',
                  fontWeight: 900,
                  background: isSeparatingBatchDemucs
                    ? 'rgba(56, 189, 248, 0.25)'
                    : allSelectedDemucsCompleted
                    ? 'rgba(16, 185, 129, 0.25)'
                    : 'rgba(56, 189, 248, 0.18)',
                  color: isSeparatingBatchDemucs ? '#38bdf8' : allSelectedDemucsCompleted ? '#34d399' : '#38bdf8',
                  padding: '2px 8px',
                  borderRadius: 9999,
                  border: isSeparatingBatchDemucs
                    ? '1px solid rgba(56, 189, 248, 0.4)'
                    : allSelectedDemucsCompleted
                    ? '1px solid rgba(16, 185, 129, 0.35)'
                    : '1px solid rgba(56, 189, 248, 0.35)',
                  flexShrink: 0,
                  letterSpacing: '0.04em',
                }}>
                  {isSeparatingBatchDemucs ? `${demucsProgressPercent}%` : allSelectedDemucsCompleted ? 'DONE' : 'STEP 4'}
                </span>
              </button>
              {isSeparatingBatchDemucs && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const confirmed = await openStudioDialog({
                      variant: 'danger',
                      badge: 'KILL DEMUCS',
                      title: 'បញ្ឈប់ (Kill) ដំណើរការ Demucs ទាំងអស់?',
                      bullets: [
                        'នឹងបញ្ឈប់ការបំបែកសំឡេងដើម Demucs AI (Clean BGM) ដែលកំពុងដំណើរការ។',
                      ],
                      question: 'តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការបំបែកសំឡេង Demucs ទាំងអស់មែនទេ?',
                      confirmLabel: '🛑 បញ្ឈប់ (Kill Demucs)',
                      cancelLabel: 'បន្តដំណើរការ',
                    });
                    if (confirmed) {
                      handleKillDemucs();
                    }
                  }}
                  className="btn-tactile"
                  style={{
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(185, 28, 28, 0.45) 100%)',
                    border: '1px solid rgba(239, 68, 68, 0.75)',
                    boxShadow: '0 4px 15px rgba(239, 68, 68, 0.35)',
                    color: '#fee2e2',
                    padding: '9px 14px',
                    borderRadius: 10,
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                  }}
                  title="Kill Demucs Process"
                >
                  🛑 បញ្ឈប់ (Kill Demucs)
                </button>
              )}
            </div>
          </div>

          {/* ── STEP 4: BATCH EXPORT & FULL VIDEO MERGE BAR (Single Handoff to Export Studio) ── */}
          {batchRender && (
            <div style={{
              marginTop: 2,
              padding: '10px 12px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(25, 39, 68, 0.85) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 220, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 900, color: '#F8FAFC', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Film size={14} color="#38BDF8" />
                    STEP 4: Batch Export &amp; Merge
                  </span>
                  <span style={{
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: 'rgba(56, 189, 248, 0.14)',
                    color: '#38BDF8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                  }}>
                    {selectedEpisodesForExport.length} ភាគ • មានសំឡេង {selectedVoicedForExport.length} • {resolvedStep4AspectRatio}
                  </span>
                </div>
                <span style={{ fontSize: '0.69rem', color: '#94A3B8' }}>
                  ជ្រើសរើសភាគ Merge វីដេអូ ឬ Download ឯកសារ Export នៅក្នុង Export Studio
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div
                  role="group"
                  aria-label="Step 4 Export Aspect Ratio"
                  data-testid="step4-aspect-toggle"
                  title={`ទម្រង់វីដេអូ Export & Preview: ${resolvedStep4AspectRatio}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: 3,
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.88)',
                    border: '1px solid rgba(56, 189, 248, 0.28)',
                  }}
                >
                  <button
                    type="button"
                    data-testid="step4-aspect-16-9"
                    aria-pressed={resolvedStep4AspectRatio === '16:9'}
                    disabled={isBatchExportRunning || isBatchExportStarting || isRendering}
                    onClick={() => onAspectRatioChange?.('16:9')}
                    title="16:9 Landscape (ផ្ដេក — YouTube / Facebook)"
                    style={{
                      padding: '6px 11px',
                      borderRadius: 7,
                      border: resolvedStep4AspectRatio === '16:9'
                        ? '1px solid rgba(56, 189, 248, 0.7)'
                        : '1px solid transparent',
                      background: resolvedStep4AspectRatio === '16:9'
                        ? 'rgba(2, 132, 199, 0.28)'
                        : 'transparent',
                      color: resolvedStep4AspectRatio === '16:9' ? '#38BDF8' : '#94A3B8',
                      fontSize: '0.73rem',
                      fontWeight: 800,
                      fontFamily: 'monospace',
                      cursor: (isBatchExportRunning || isBatchExportStarting || isRendering) ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      opacity: (isBatchExportRunning || isBatchExportStarting || isRendering) ? 0.5 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 13,
                        height: 8,
                        border: '1.5px solid currentColor',
                        borderRadius: 1.5,
                      }}
                      aria-hidden="true"
                    />
                    <span>16:9</span>
                  </button>
                  <button
                    type="button"
                    data-testid="step4-aspect-9-16"
                    aria-pressed={resolvedStep4AspectRatio === '9:16'}
                    disabled={isBatchExportRunning || isBatchExportStarting || isRendering}
                    onClick={() => onAspectRatioChange?.('9:16')}
                    title="9:16 Portrait (បញ្ឈរ — TikTok / Reels / Shorts)"
                    style={{
                      padding: '6px 11px',
                      borderRadius: 7,
                      border: resolvedStep4AspectRatio === '9:16'
                        ? '1px solid rgba(56, 189, 248, 0.7)'
                        : '1px solid transparent',
                      background: resolvedStep4AspectRatio === '9:16'
                        ? 'rgba(2, 132, 199, 0.28)'
                        : 'transparent',
                      color: resolvedStep4AspectRatio === '9:16' ? '#38BDF8' : '#94A3B8',
                      fontSize: '0.73rem',
                      fontWeight: 800,
                      fontFamily: 'monospace',
                      cursor: (isBatchExportRunning || isBatchExportStarting || isRendering) ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      opacity: (isBatchExportRunning || isBatchExportStarting || isRendering) ? 0.5 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 12,
                        border: '1.5px solid currentColor',
                        borderRadius: 1.5,
                      }}
                      aria-hidden="true"
                    />
                    <span>9:16</span>
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="step4-open-export-studio-btn"
                  onClick={() => {
                    onClose?.();
                    onOpenExportStudio?.();
                  }}
                  className="btn-tactile"
                  style={{
                    padding: '9px 15px',
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                    border: '1px solid #38BDF8',
                    color: '#FFFFFF',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 4px 16px rgba(2, 132, 199, 0.35)',
                  }}
                >
                  <Film size={14} />
                  <span>Open Export Studio</span>
                  {isBatchExportRunning && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: 9999,
                        background: 'rgba(255, 255, 255, 0.22)',
                      }}
                    >
                      {batchExportJob?.progress || 0}%
                    </span>
                  )}
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── 3. BATCH NOTIFICATIONS ── */}
        {batchInfo && (
          <div
            role="status"
            data-testid="batch-info-banner"
            style={{
              margin: '12px 22px 0 22px',
              padding: '9px 14px',
              borderRadius: 8,
              background: 'rgba(56, 189, 248, 0.14)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              color: '#bae6fd',
              fontSize: '0.76rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 4px 14px rgba(56, 189, 248, 0.15)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <AlertCircle size={15} color="#38bdf8" />
              <span>{batchInfo}</span>
            </span>
            <button
              type="button"
              onClick={() => setBatchInfo(null)}
              style={{ background: 'none', border: 'none', color: '#bae6fd', cursor: 'pointer', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {batchSuccess && (
          <div
            data-testid="batch-success-banner"
            style={{
              margin: '12px 22px 0 22px',
              padding: '9px 14px',
              borderRadius: 8,
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#6ee7b7',
              fontSize: '0.76rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.15)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <CheckCircle2 size={15} />
              <span>{batchSuccess}</span>
            </span>
            <button 
              type="button" 
              onClick={() => setBatchSuccess(null)} 
              style={{ background: 'none', border: 'none', color: '#6ee7b7', cursor: 'pointer', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {batchError && (
          <div
            data-testid="batch-error-banner"
            style={{
              margin: '12px 22px 0 22px',
              padding: '9px 14px',
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
              fontSize: '0.76rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 4px 14px rgba(239, 68, 68, 0.15)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <AlertCircle size={15} />
              <span>{batchError}</span>
            </span>
            <button 
              type="button" 
              onClick={() => setBatchError(null)} 
              style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── 4. SPACIOUS EPISODE GRID (Clean UI) ── */}
        <div style={{
          padding: '16px 22px 24px 22px',
        }}>

          {episodes.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 190,
              padding: '28px 16px',
              color: '#94a3b8',
              gap: 12,
            }}>
              <AlertCircle size={36} color="#38bdf8" />
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>មិនទាន់មានភាគវីដេអូទេ</div>
              <div style={{ fontSize: '0.78rem' }}>សូម Upload វីដេអូរឿងភាគក្នុង Tab "1. Video" ជាមុនសិន។</div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(370px, 1fr))',
              gap: 14,
            }}>
              {episodes.map((ep, idx) => {
                const activeJob = jobsByEpisodeId.get(ep.id);
                const hasScript = checkEpisodeHasScript(ep);
                const hasVideo = Boolean(ep.video || ep.videoFile || ep.sourceVideoPath);
                const isSelected = selectedEpIds.has(ep.id);
                const isRunning = Boolean(activeJob && activeJob.status === 'running');
                const isQueued = Boolean(activeJob && activeJob.status === 'queued');
                const isFailed = Boolean(activeJob && activeJob.status === 'failed' && !hasScript);
                const segmentsMissingAfterJob = Boolean(!isRunning && !isQueued && !isFailed && isJobCompletedSegmentsMissing(ep, activeJob));
                const assignedKeyNum = (idx % poolTotalKeys) + 1;
                const keyTheme = KEY_THEMES[((assignedKeyNum - 1) % keyThemeCount) + 1] || KEY_THEMES[1];
                const segmentCount = getEpisodeSegmentCount(ep);
                const epBrokenScan = getEpisodeBrokenSummary(ep);
                const isFullyDone = isEpisodeFullyDone(ep);

                return (
                  <div
                    key={ep.id}
                    data-testid={`ep-card-${ep.id}`}
                    onClick={() => hasVideo && !isRunning && !isQueued && toggleSelect(ep.id)}
                    className={hasVideo ? 'motion-lift' : ''}
                    style={{
                      borderRadius: 16,
                      border: isRunning
                        ? '1px solid #38BDF8'
                        : isFailed
                        ? '1px solid rgba(248, 113, 113, 0.65)'
                        : segmentsMissingAfterJob
                        ? '1px solid rgba(245, 158, 11, 0.6)'
                        : isSelected
                        ? '1px solid #FF8577'
                        : isFullyDone
                        ? '1px solid rgba(52, 211, 153, 0.45)'
                        : hasScript
                        ? '1px solid rgba(52, 211, 153, 0.35)'
                        : '1px solid rgba(255, 255, 255, 0.07)',
                      background: isRunning
                        ? 'rgba(56, 189, 248, 0.12)'
                        : isFailed
                        ? 'rgba(248, 113, 113, 0.08)'
                        : segmentsMissingAfterJob
                        ? 'rgba(245, 158, 11, 0.08)'
                        : isFullyDone
                        ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.10) 0%, rgba(20, 32, 54, 0.75) 100%)'
                        : isSelected
                        ? 'rgba(39, 61, 107, 0.75)'
                        : 'rgba(25, 39, 68, 0.55)',
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 12,
                      cursor: hasVideo ? 'pointer' : 'not-allowed',
                      opacity: hasVideo ? 1 : 0.6,
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: isRunning 
                        ? '0 0 25px rgba(56, 189, 248, 0.25)' 
                        : isFailed
                        ? '0 0 20px rgba(248, 113, 113, 0.2)'
                        : isSelected
                        ? '0 10px 28px rgba(0, 0, 0, 0.45), 0 0 16px rgba(255, 133, 119, 0.22)'
                        : isFullyDone
                        ? '0 4px 14px rgba(16, 185, 129, 0.12)'
                        : '0 4px 14px rgba(0, 0, 0, 0.25)',
                    }}
                  >
                    {/* Card Header */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!hasVideo || isRunning || isQueued}
                            onChange={() => toggleSelect(ep.id)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 17, height: 17, cursor: hasVideo ? 'pointer' : 'not-allowed', accentColor: isFullyDone ? '#10B981' : '#FF8577', flexShrink: 0 }}
                          />
                          <span style={{
                            fontSize: '0.74rem',
                            fontWeight: 900,
                            padding: '3px 9px',
                            borderRadius: 9999,
                            background: isRunning ? '#38BDF8' : isFullyDone ? 'rgba(52, 211, 153, 0.2)' : isSelected ? 'rgba(255, 133, 119, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                            color: isRunning ? '#0B132B' : isFullyDone ? '#34D399' : isSelected ? '#FF8577' : '#E2E8F0',
                            border: isFullyDone ? '1px solid rgba(52, 211, 153, 0.45)' : isSelected ? '1px solid rgba(255, 133, 119, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                          }}>
                            EP{ep.episodeNumber || idx + 1}
                          </span>
                          {(ep.scriptData?.generationMode === 'fast_ocr' || ep.scriptData?.source?.startsWith('imported_')) && (
                            <span style={{
                              fontSize: '0.62rem',
                              fontWeight: 800,
                              padding: '2px 7px',
                              borderRadius: 9999,
                              background: 'rgba(251, 191, 36, 0.2)',
                              color: '#FBBF24',
                              border: '1px solid rgba(251, 191, 36, 0.45)',
                              letterSpacing: '0.03em',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}>
                              ⚡ Fast OCR
                            </span>
                          )}
                          {isFullyDone && (
                            <span style={{
                              fontSize: '0.62rem',
                              fontWeight: 800,
                              padding: '2px 7px',
                              borderRadius: 9999,
                              background: 'rgba(52, 211, 153, 0.2)',
                              color: '#34D399',
                              border: '1px solid rgba(52, 211, 153, 0.4)',
                              letterSpacing: '0.03em',
                            }}>
                              ✓ ALL DONE
                            </span>
                          )}
                          {hasScript && epBrokenScan.totalBrokenCount > 0 && (
                            <span
                              data-testid={`ep-broken-badge-${ep.id}`}
                              style={{
                                fontSize: '0.62rem',
                                fontWeight: 800,
                                padding: '2px 7px',
                                borderRadius: 9999,
                                background: 'rgba(245, 158, 11, 0.2)',
                                color: '#FBBF24',
                                border: '1px solid rgba(245, 158, 11, 0.45)',
                                letterSpacing: '0.02em',
                              }}
                              title={`អត្ថបទខូច: ${epBrokenScan.textBrokenCount} ឃ្លា • សំឡេងខ្វះ: ${epBrokenScan.voiceBrokenCount} ឃ្លា`}
                            >
                              ⚠️ ខូច {epBrokenScan.totalBrokenCount} ឃ្លា
                            </span>
                          )}
                          {(ep.renderedVideo?.videoUrl || ep.renderedVideo?.outputVideoUrl) && (
                            <span style={{
                              fontSize: '0.6rem',
                              fontWeight: 800,
                              padding: '2px 7px',
                              borderRadius: 9999,
                              background: 'rgba(56, 189, 248, 0.18)',
                              color: '#38BDF8',
                              border: '1px solid rgba(56, 189, 248, 0.4)',
                            }}>
                              MP4 EXPORTED
                            </span>
                          )}
                          <h4 style={{
                            margin: 0,
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            color: '#F8FAFC',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }} title={ep.title}>
                            {ep.title}
                          </h4>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          {ep.duration > 0 && (
                            <span style={{ fontSize: '0.68rem', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Clock size={11} />
                              {formatTimecode(ep.duration)}
                            </span>
                          )}
                          <span style={{
                            fontSize: '0.66rem',
                            fontWeight: 800,
                            padding: '2px 9px',
                            borderRadius: 9999,
                            background: keyTheme.bg,
                            color: keyTheme.color,
                            border: `1px solid ${keyTheme.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: keyTheme.dot }} />
                            Key #{assignedKeyNum}
                          </span>
                        </div>
                      </div>

                      {/* Dynamic 0% - 100% Progress Runner & Live Console Terminal (Running, Queued, or Failed State) */}
                      {(isRunning || isQueued || isFailed) && (
                        <EpisodeTranslateProgressCard
                          activeJob={activeJob}
                          assignedKeyNum={assignedKeyNum}
                          isQueued={isQueued}
                          isFailed={isFailed}
                          onRetry={() => handleRetryEpisode(ep)}
                          onKill={() => handleKillTranslate(activeJob || ep)}
                          onRequestConfirm={openStudioDialog}
                        />
                      )}

                      {/* Step 2: Dynamic Progress Runner & Live Console Terminal for Khmer TTS */}
                      {isGeneratingBatchTTS && (activeTtsEpisodeIds.has(ep.id) || activeTtsEpisodeId === ep.id) && (
                        <EpisodeTtsProgressCard
                          liveStats={ttsLiveStats[ep.id]}
                          ep={ep}
                          onKill={() => handleKillTTS(ep)}
                          onRequestConfirm={openStudioDialog}
                        />
                      )}

                      {/* Step 3: Dynamic Progress Runner & Live Console Terminal for Demucs AI Clean BGM (Active Running Ep Only) */}
                      {isSeparatingBatchDemucs && activeDemucsEpisodeId === ep.id && (
                        <EpisodeDemucsProgressCard
                          liveStats={demucsLiveStats[ep.id]}
                          ep={ep}
                          isCurrentRunning={true}
                          onKill={handleKillDemucs}
                          onRequestConfirm={openStudioDialog}
                        />
                      )}

                      {/* Step 3: Compact Queue Indicator for Episodes Waiting Their Turn (Only active ep expands full drawer) */}
                      {isSeparatingBatchDemucs && activeDemucsEpisodeIds.has(ep.id) && activeDemucsEpisodeId !== ep.id && (
                        <div style={{
                          marginTop: 6,
                          padding: '7px 11px',
                          borderRadius: 8,
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px dashed rgba(56, 189, 248, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Clock size={13} color="#94A3B8" />
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8' }}>
                              ⏳ រង់ចាំក្នុង Queue (Waiting in Queue)
                            </span>
                          </div>
                          <span style={{ fontSize: '0.64rem', color: '#64748B' }}>
                            ដំណើរការម្ដង ១ ភាគ
                          </span>
                        </div>
                      )}

                      {/* Completed State Banner */}
                      {hasScript && !isRunning && !isQueued && !isFailed && !(isGeneratingBatchTTS && (activeTtsEpisodeIds.has(ep.id) || activeTtsEpisodeId === ep.id)) && !(isSeparatingBatchDemucs && (activeDemucsEpisodeIds.has(ep.id) || activeDemucsEpisodeId === ep.id)) && (() => {
                        const isAudioReady = checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats);
                        const isDemucsReady = checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats);
                        const isAudioOutdated = Boolean(ep.audioOutdated && !isAudioReady);

                        if (epBrokenScan.totalBrokenCount > 0) {
                          return (
                            <div style={{
                              marginTop: 6,
                              padding: '10px 12px',
                              borderRadius: 10,
                              background: 'rgba(245, 158, 11, 0.10)',
                              border: '1px solid rgba(245, 158, 11, 0.42)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <AlertTriangle size={14} color="#FBBF24" />
                                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#FCD34D' }}>
                                    ⚠️ នៅខ្វះ/ខូច {epBrokenScan.totalBrokenCount} ឃ្លា {typeof segmentCount === 'number' && segmentCount > 0 ? `(សរុប ${segmentCount} ឃ្លា)` : ''}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  {epBrokenScan.textBrokenCount > 0 && (
                                    <span style={{
                                      fontSize: '0.60rem',
                                      fontWeight: 800,
                                      color: '#FCA5A5',
                                      background: 'rgba(239, 68, 68, 0.2)',
                                      padding: '1px 6px',
                                      borderRadius: 9999,
                                    }}>
                                      អត្ថបទខូច {epBrokenScan.textBrokenCount}
                                    </span>
                                  )}
                                  {epBrokenScan.voiceBrokenCount > 0 && (
                                    <span style={{
                                      fontSize: '0.60rem',
                                      fontWeight: 800,
                                      color: '#FDBA74',
                                      background: 'rgba(249, 115, 22, 0.2)',
                                      padding: '1px 6px',
                                      borderRadius: 9999,
                                    }}>
                                      សំឡេងខ្វះ {epBrokenScan.voiceBrokenCount}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div style={{ fontSize: '0.68rem', color: '#FDE68A', opacity: 0.9 }}>
                                អត្ថបទខូច: {epBrokenScan.textBrokenCount} ឃ្លា • សំឡេងខ្វះ: {epBrokenScan.voiceBrokenCount} ឃ្លា
                                {(ep.hasAudio || ep.fullAudioUrl) ? ' (មាន Master ចាស់ ប៉ុន្តែមិនទាន់គ្រប់ឃ្លា)' : ''} — ចុច "🔧 ជួសជុលឃ្លាខូច"
                              </div>
                            </div>
                          );
                        }

                        if (isAudioReady && isDemucsReady) {
                          return (
                            <div style={{
                              marginTop: 6,
                              padding: '10px 12px',
                              borderRadius: 10,
                              background: 'rgba(52, 211, 153, 0.12)',
                              border: '1px solid rgba(52, 211, 153, 0.45)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <CheckCircle2 size={14} color="#34D399" />
                                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#34D399' }}>
                                    ✅ សំឡេងខ្មែរ AI + Clean BGM រួចរាល់ {typeof segmentCount === 'number' && segmentCount > 0 ? `(${segmentCount} ឃ្លា)` : ''}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{
                                    fontSize: '0.60rem',
                                    fontWeight: 800,
                                    color: '#34D399',
                                    background: 'rgba(52, 211, 153, 0.2)',
                                    padding: '1px 6px',
                                    borderRadius: 9999,
                                  }}>
                                    AUDIO READY
                                  </span>
                                  <span style={{
                                    fontSize: '0.60rem',
                                    fontWeight: 800,
                                    color: '#38BDF8',
                                    background: 'rgba(56, 189, 248, 0.2)',
                                    padding: '1px 6px',
                                    borderRadius: 9999,
                                  }}>
                                    BGM READY
                                  </span>
                                </div>
                              </div>
                              <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
                                សំឡេងនិយាយខ្មែរ និងតន្ត្រី Clean BGM/SFX រួចរាល់ 100% អាច Export ឬ Dubbing បានភ្លាមៗ!
                              </div>
                            </div>
                          );
                        }

                        if (isAudioReady) {
                          return (
                            <div style={{
                              marginTop: 6,
                              padding: '10px 12px',
                              borderRadius: 10,
                              background: 'rgba(52, 211, 153, 0.10)',
                              border: '1px solid rgba(52, 211, 153, 0.35)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <CheckCircle2 size={14} color="#34D399" />
                                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#34D399' }}>
                                    ✅ សំឡេងខ្មែរ AI 100% រួចរាល់ {typeof segmentCount === 'number' && segmentCount > 0 ? `(${segmentCount} ឃ្លា)` : ''}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{
                                    fontSize: '0.60rem',
                                    fontWeight: 800,
                                    color: '#34D399',
                                    background: 'rgba(52, 211, 153, 0.2)',
                                    padding: '1px 6px',
                                    borderRadius: 9999,
                                  }}>
                                    AUDIO READY
                                  </span>
                                  <span style={{
                                    fontSize: '0.60rem',
                                    fontWeight: 700,
                                    color: '#94A3B8',
                                    background: 'rgba(255, 255, 255, 0.06)',
                                    padding: '1px 6px',
                                    borderRadius: 9999,
                                    border: '1px dashed rgba(255, 255, 255, 0.15)',
                                  }}>
                                    រង់ចាំ BGM
                                  </span>
                                </div>
                              </div>
                              <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
                                Chinese OCR + ASR Reconciled + Khmer Speech Synthesized! (ចុច Step 4 ដើម្បីបំបែក Clean BGM)
                              </div>
                            </div>
                          );
                        }

                        if (isDemucsReady) {
                          return (
                            <div style={{
                              marginTop: 6,
                              padding: '10px 12px',
                              borderRadius: 10,
                              background: 'rgba(56, 189, 248, 0.08)',
                              border: `1px solid ${isAudioOutdated ? 'rgba(245, 158, 11, 0.45)' : 'rgba(56, 189, 248, 0.35)'}`,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <CheckCircle2 size={14} color="#38BDF8" />
                                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#38BDF8' }}>
                                    🎧 Clean BGM 100% រួចរាល់ (Demucs AI)
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  {isAudioOutdated && (
                                    <span style={{
                                      fontSize: '0.60rem',
                                      fontWeight: 800,
                                      color: '#FBBF24',
                                      background: 'rgba(245, 158, 11, 0.2)',
                                      padding: '1px 6px',
                                      borderRadius: 9999,
                                    }}>
                                      OUTDATED AUDIO
                                    </span>
                                  )}
                                  <span style={{
                                    fontSize: '0.60rem',
                                    fontWeight: 800,
                                    color: '#38BDF8',
                                    background: 'rgba(56, 189, 248, 0.2)',
                                    padding: '1px 6px',
                                    borderRadius: 9999,
                                  }}>
                                    BGM READY
                                  </span>
                                </div>
                              </div>
                              <div style={{ fontSize: '0.68rem', color: isAudioOutdated ? '#FCD34D' : '#94A3B8' }}>
                                {isAudioOutdated
                                  ? '⚠️ សំឡេងចាស់ហួសសម័យ — សូមចុច Step 3 (បង្កើតសំឡេងខ្មែរ AI) ឡើងវិញ!'
                                  : 'សំឡេងតន្ត្រី Clean BGM បានបំបែករួចរាល់ — រង់ចាំបង្កើតសំឡេងខ្មែរ AI (Step 3)'}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div style={{
                            marginTop: 6,
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: isAudioOutdated ? 'rgba(245, 158, 11, 0.08)' : 'rgba(56, 189, 248, 0.08)',
                            border: `1px solid ${isAudioOutdated ? 'rgba(245, 158, 11, 0.38)' : 'rgba(56, 189, 248, 0.28)'}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <CheckCircle2 size={14} color={isAudioOutdated ? '#FBBF24' : '#38BDF8'} />
                                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: isAudioOutdated ? '#FCD34D' : '#38BDF8' }}>
                                  Script 100% រួចរាល់ {typeof segmentCount === 'number' && segmentCount > 0 ? `(${segmentCount} ឃ្លា)` : ''}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                {isAudioOutdated && (
                                  <span style={{
                                    fontSize: '0.60rem',
                                    fontWeight: 800,
                                    color: '#FBBF24',
                                    background: 'rgba(245, 158, 11, 0.2)',
                                    padding: '1px 6px',
                                    borderRadius: 9999,
                                    border: '1px solid rgba(245, 158, 11, 0.4)',
                                  }}>
                                    OUTDATED AUDIO
                                  </span>
                                )}
                                {ep.scriptData?.generationMode === 'fast_ocr' && (
                                  <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#FBBF24', background: 'rgba(251, 191, 36, 0.15)', padding: '1px 6px', borderRadius: 4, border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                                    ⚡ Fast OCR
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ fontSize: '0.68rem', color: isAudioOutdated ? '#FCD34D' : '#94A3B8' }}>
                              {isAudioOutdated
                                ? '⚠️ កែប្រែតួអង្គ/អត្ថបទរួច — សូមចុច Step 3 (បង្កើតសំឡេងខ្មែរ AI) ដើម្បីអាប់ដេតសំឡេងថ្មី!'
                                : (ep.scriptData?.generationMode === 'fast_ocr'
                                    ? '⚡ Subtitle ចិនត្រូវបានស្រង់លើអេក្រង់ & បកប្រែភាសាខ្មែរសម្រេច (Bypass Whisper)។'
                                    : 'Chinese OCR + ASR Reconciled ភ្ជាប់ជាភាសាខ្មែរសម្រេច។')}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Idle / Unsaved State Banner (Unscripted) */}
                      {!hasScript && !isRunning && !isQueued && !isFailed && (
                        segmentsMissingAfterJob ? (
                          <div style={{
                            marginTop: 6,
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: 'rgba(245, 158, 11, 0.12)',
                            border: '1px solid rgba(245, 158, 11, 0.45)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            color: '#FBBF24',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
                              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#FCD34D' }}>
                                  ⚠️ Job done — segments not saved
                                </div>
                                <div style={{ fontSize: '0.67rem', color: '#FDE68A', opacity: 0.85, marginTop: 2 }}>
                                  Job បានបញ្ចប់ ប៉ុន្តែមិនទាន់មាន Segments ក្នុង series.json ទេ — ចុច Refresh ឬ Translate ឡើងវិញ។
                                </div>
                              </div>
                            </div>
                            {typeof onRefreshSeries === 'function' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRefreshSeries();
                                }}
                                style={{
                                  flexShrink: 0,
                                  padding: '4px 10px',
                                  borderRadius: 9999,
                                  background: 'rgba(245, 158, 11, 0.2)',
                                  border: '1px solid rgba(245, 158, 11, 0.5)',
                                  color: '#FCD34D',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                <RefreshCw size={11} />
                                <span>Refresh</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{
                            marginTop: 6,
                            padding: '12px 14px',
                            borderRadius: 10,
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px dashed rgba(255, 255, 255, 0.08)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            color: '#64748B',
                          }}>
                            <FileText size={16} />
                            <div style={{ fontSize: '0.72rem' }}>
                              {hasVideo ? 'វីដេអូរួចរាល់ — ចុច Select ដើម្បី Translate' : 'មិនទាន់មានវីដេអូសម្រាប់ Translate ទេ'}
                            </div>
                          </div>
                        )
                      )}
                    </div>

                    {/* Card Footer */}
                    {!isRunning && !isQueued && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.70rem',
                        paddingTop: 8,
                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                      }}>
                        <div>
                          {(isGeneratingBatchTTS && (activeTtsEpisodeIds.has(ep.id) || activeTtsEpisodeId === ep.id)) ? (
                            <span style={{
                              color: '#FF8577',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              background: 'rgba(255, 133, 119, 0.15)',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              border: '1px solid rgba(255, 133, 119, 0.4)',
                            }}>
                              <Loader2 size={12} className="animate-spin" color="#FF8577" />
                              <span>កំពុង Render សំឡេង... ({ttsLiveStats[ep.id]?.current || 0}/{ttsLiveStats[ep.id]?.total || segmentCount || '...'})</span>
                            </span>
                          ) : (isSeparatingBatchDemucs && activeDemucsEpisodeId === ep.id) ? (
                            <span style={{
                              color: '#38bdf8',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              background: 'rgba(56, 189, 248, 0.15)',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              border: '1px solid rgba(56, 189, 248, 0.4)',
                            }}>
                              <Loader2 size={12} className="animate-spin" color="#38bdf8" />
                              <span>កំពុងបំបែកសំឡេង Demucs... ({demucsLiveStats[ep.id]?.percent || 0}%)</span>
                            </span>
                          ) : segmentsMissingAfterJob ? (
                            <span style={{
                              color: '#FBBF24',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(245, 158, 11, 0.14)',
                              padding: '2px 9px',
                              borderRadius: 9999,
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                            }}>
                              <span>⚠️ Job done — segments not saved</span>
                            </span>
                          ) : (checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats) || checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats)) ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats) && (
                                <span style={{
                                  color: '#34D399',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background: 'rgba(52, 211, 153, 0.15)',
                                  padding: '2px 8px',
                                  borderRadius: 9999,
                                  border: '1px solid rgba(52, 211, 153, 0.4)',
                                  boxShadow: '0 0 8px rgba(52, 211, 153, 0.18)',
                                }}>
                                  <Volume2 size={11} strokeWidth={2.5} />
                                  <span>សំឡេង AI</span>
                                </span>
                              )}
                              {ep.audioOutdated && !checkEpisodeHasAudioReady(ep, completedTtsEpIds, ttsLiveStats) && hasScript && (
                                <span style={{
                                  color: '#FBBF24',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background: 'rgba(245, 158, 11, 0.14)',
                                  padding: '2px 8px',
                                  borderRadius: 9999,
                                  border: '1px solid rgba(245, 158, 11, 0.4)',
                                }}>
                                  <span>ត្រូវបង្កើតសំឡេងថ្មី</span>
                                </span>
                              )}
                              {checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats) && (
                                <span style={{
                                  color: '#38BDF8',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  padding: '2px 8px',
                                  borderRadius: 9999,
                                  border: '1px solid rgba(56, 189, 248, 0.4)',
                                  boxShadow: '0 0 8px rgba(56, 189, 248, 0.18)',
                                }}>
                                  <Volume2 size={11} strokeWidth={2.5} />
                                  <span>Clean BGM</span>
                                </span>
                              )}
                            </div>
                          ) : (hasScript && epBrokenScan.totalBrokenCount > 0) ? (
                            <span style={{
                              color: '#FBBF24',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              background: 'rgba(245, 158, 11, 0.14)',
                              padding: '2px 9px',
                              borderRadius: 9999,
                              border: '1px solid rgba(245, 158, 11, 0.45)',
                            }}>
                              <span>⚠️ នៅខ្វះ/ខូច {epBrokenScan.totalBrokenCount} ឃ្លា ({segmentCount} ឃ្លា)</span>
                            </span>
                          ) : (hasScript && ep.audioOutdated) ? (
                            <span style={{
                              color: '#FBBF24',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              background: 'rgba(245, 158, 11, 0.14)',
                              padding: '2px 9px',
                              borderRadius: 9999,
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                            }}>
                              <span>⚠️ {segmentCount > 0 ? `${segmentCount} ឃ្លា • ` : ''}ត្រូវបង្កើតសំឡេងថ្មី</span>
                            </span>
                          ) : hasScript ? (
                            <span style={{
                              color: '#38BDF8',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              background: 'rgba(56, 189, 248, 0.12)',
                              padding: '2px 9px',
                              borderRadius: 9999,
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                            }}>
                              <Check size={12} strokeWidth={3} />
                              <span>{segmentCount > 0 ? `${segmentCount} ឃ្លាខ្មែរ` : 'Script រួចរាល់'}</span>
                            </span>
                          ) : isFailed ? (
                            <span style={{
                              color: '#F87171',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(248, 113, 113, 0.12)',
                              padding: '2px 9px',
                              borderRadius: 9999,
                              border: '1px solid rgba(248, 113, 113, 0.3)',
                            }}>
                              <span>❌ ត្រូវ Retry ឡើងវិញ</span>
                            </span>
                          ) : (
                            <span style={{
                              color: '#94A3B8',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(255, 255, 255, 0.04)',
                              padding: '2px 9px',
                              borderRadius: 9999,
                            }}>
                              <span>⏳ មិនទាន់មាន Script</span>
                            </span>
                          )}
                        </div>

                        {hasScript && onSwitchEpisode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSwitchEpisode(ep.id);
                              if (onTabChange) onTabChange('subtitles');
                              onClose();
                            }}
                            className="btn-tactile"
                            style={{
                              background: 'rgba(56, 189, 248, 0.12)',
                              border: '1px solid rgba(56, 189, 248, 0.4)',
                              color: '#38BDF8',
                              fontSize: '0.72rem',
                              fontWeight: 800,
                              borderRadius: 9999,
                              padding: '4px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              boxShadow: '0 2px 10px rgba(56, 189, 248, 0.15)',
                              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                          >
                            <span>បើកមើលក្នុង Studio</span>
                            <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>

        {/* ── 5. MODAL FOOTER ── */}
        <div style={{
          padding: '13px 24px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(16, 25, 44, 0.95)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.74rem',
          color: '#94A3B8',
          flexShrink: 0,
        }}>
          {/* Detailed Multi-Step Progress Tracker (Step 1, Step 2, Step 3 & 100% Celebration) */}
          <div data-testid="modal-footer-status" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <span style={{ color: '#F8FAFC', fontWeight: 800 }}>
              សរុប: <strong style={{ color: '#38bdf8' }}>{episodes.length} ភាគ</strong>
            </span>
            <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>|</span>

            {/* Step 1: Translate status */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              borderRadius: 6,
              background: isTranslateAllDone ? 'rgba(52, 211, 153, 0.12)' : 'rgba(56, 189, 248, 0.08)',
              border: `1px solid ${isTranslateAllDone ? 'rgba(52, 211, 153, 0.3)' : 'rgba(56, 189, 248, 0.2)'}`,
            }}>
              <span style={{ fontWeight: 800, color: isTranslateAllDone ? '#34D399' : '#38bdf8' }}>
                1. Translate:
              </span>
              <strong style={{ color: isTranslateAllDone ? '#34D399' : '#E2E8F0' }}>
                {healthyScriptedCount}/{episodes.length}
              </strong>
              <span style={{ fontSize: '0.68rem', color: isTranslateAllDone ? '#34D399' : '#FBBF24', fontWeight: 700 }}>
                ({isTranslateAllDone
                  ? `✓ រួចរាល់ ${translatePercent}%`
                  : totalTextBrokenCount > 0
                  ? `${translatePercent}% • នៅខ្វះ/ខូច ${totalTextBrokenCount} ឃ្លា`
                  : `${translatePercent}% • នៅសល់ ${remainingCount}`})
              </span>
              {unsavedCompletedJobsCount > 0 && (
                <span style={{
                  fontSize: '0.66rem',
                  color: '#FBBF24',
                  fontWeight: 800,
                  marginLeft: 4,
                  background: 'rgba(245, 158, 11, 0.14)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  padding: '1px 6px',
                  borderRadius: 9999,
                }}>
                  ⚠️ {unsavedCompletedJobsCount} not saved
                </span>
              )}
            </div>

            <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>|</span>

            {/* Step 2: Khmer TTS status */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              borderRadius: 6,
              background: isAudioAllDone ? 'rgba(52, 211, 153, 0.12)' : 'rgba(255, 133, 119, 0.08)',
              border: `1px solid ${isAudioAllDone ? 'rgba(52, 211, 153, 0.3)' : 'rgba(255, 133, 119, 0.25)'}`,
            }}>
              <span style={{ fontWeight: 800, color: isAudioAllDone ? '#34D399' : '#FF8577' }}>
                2. សំឡេងខ្មែរ AI:
              </span>
              <strong style={{ color: isAudioAllDone ? '#34D399' : '#E2E8F0' }}>
                {completedAudioCount}/{episodes.length}
              </strong>
              <span style={{ fontSize: '0.68rem', color: isAudioAllDone ? '#34D399' : '#FF8577', fontWeight: 700 }}>
                ({isAudioAllDone
                  ? `✓ រួចរាល់ ${audioPercent}%`
                  : seriesBrokenSummary.totalBrokenCount > 0
                  ? `${audioPercent}% • នៅខ្វះ/ខូច ${seriesBrokenSummary.totalBrokenCount} ឃ្លា (${unAudioCount} ភាគ)`
                  : `${audioPercent}% • នៅសល់ ${unAudioCount} ភាគ`})
              </span>
            </div>

            <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>|</span>

            {/* Step 3: Demucs AI Clean BGM status */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              borderRadius: 6,
              background: isDemucsAllDone ? 'rgba(52, 211, 153, 0.12)' : 'rgba(56, 189, 248, 0.08)',
              border: `1px solid ${isDemucsAllDone ? 'rgba(52, 211, 153, 0.3)' : 'rgba(56, 189, 248, 0.2)'}`,
            }}>
              <span style={{ fontWeight: 800, color: isDemucsAllDone ? '#34D399' : '#38bdf8' }}>
                3. Demucs AI:
              </span>
              <strong style={{ color: isDemucsAllDone ? '#34D399' : '#E2E8F0' }}>
                {completedDemucsCount}/{episodes.length}
              </strong>
              <span style={{ fontSize: '0.68rem', color: isDemucsAllDone ? '#34D399' : '#94A3B8', fontWeight: 700 }}>
                ({isDemucsAllDone ? `✓ រួចរាល់ ${demucsPercent}%` : `${demucsPercent}% • នៅសល់ ${unDemucsCount}`})
              </span>
            </div>

            {/* Grand Overall 1-3 Completion Badge */}
            {isAll1To3Done ? (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 9999,
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.35) 100%)',
                border: '1px solid rgba(52, 211, 153, 0.55)',
                color: '#34D399',
                fontSize: '0.72rem',
                fontWeight: 900,
                boxShadow: '0 0 12px rgba(52, 211, 153, 0.25)',
              }}>
                <CheckCircle2 size={13} color="#34D399" />
                🎉 ដំណាក់កាល 1-3 ធ្វើរួចរាល់ {overallStagePercent}% (ALL READY)!
              </span>
            ) : is1And2Done ? (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 9999,
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(14, 165, 233, 0.25) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                color: '#38bdf8',
                fontSize: '0.72rem',
                fontWeight: 800,
              }}>
                <Sparkles size={13} color="#38bdf8" />
                ⚡ ដំណាក់កាល ១ & ២ រួចរាល់ (នៅសល់ Step 3: Demucs AI {unDemucsCount} ភាគ)
              </span>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '0.68rem', color: '#64748B' }}>💡 ចុចលើ Card ដើម្បី Select ឬ Deselect ភាគ</span>
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
                transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = '#FFFFFF';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.color = '#E2E8F0';
              }}
            >
              បិទផ្ទាំង (Close)
            </button>
          </div>
        </div>
      </div>

      <StudioConfirmDialog
        {...(confirmDialog || {})}
        isOpen={Boolean(confirmDialog)}
        onConfirm={() => closeStudioDialog(true)}
        onCancel={() => closeStudioDialog(false)}
      />
    </div>
  );
}
