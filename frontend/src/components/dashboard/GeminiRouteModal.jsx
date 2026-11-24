import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Cpu, Sparkles, CheckCircle2, AlertCircle, Check, Clock, Play,
  ArrowRight, Loader2, X, RefreshCw,
  RotateCcw, FileText, Mic, Volume2, Download, Film, AlertTriangle, Square, Layers,
  Pin, Key, Wrench, Settings2, ChevronDown, ChevronUp, Zap, MessageSquare, Crown, Briefcase, UserCheck, Building2, Smile, BookOpen
} from 'lucide-react';
import {
  startGenerationJob,
  startRepairBrokenJobApi,
  fetchJobStatusApi,
  importSubtitlesApi,
  resetEpisodeStateApi,
} from '../../services/api';
import { useGeminiQuotaMonitor } from '../../hooks/useGeminiQuotaMonitor';
import { useSharedJobQueue } from '../../context/jobQueueStore';
import { formatTimecode } from '../../utils/timestampUtils';
import { resolveDefaultAspectRatio, sanitizeAspectRatio } from '../../utils/projectStorage';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  getEpisodeSegmentCount,
  getEpisodeGenderCounts,
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

// 4 Dedicated Route Progress Runners (Step 1: Translate, Step 2: Khmer TTS, Step 3: Auto-Fit, Step 4: Demucs)
import EpisodeTranslateProgressCard from './route-runners/EpisodeTranslateProgressCard';
import EpisodeTtsProgressCard from './route-runners/EpisodeTtsProgressCard';
import EpisodeAutoFitProgressCard from './route-runners/EpisodeAutoFitProgressCard';
import EpisodeDemucsProgressCard from './route-runners/EpisodeDemucsProgressCard';
import StudioConfirmDialog from '../common/StudioConfirmDialog';
import BatchScriptSetupPanel from './BatchScriptSetupPanel';
import BatchEpisodeCard from './BatchEpisodeCard';
import BatchStageFocusBar, { STAGE_FOCUS_META, checkEpisodeDoneForStage } from './BatchStageFocusBar';
import { DubbingStepCardsBar, useDubbingFeature } from '../../features/dubbing-runner';
import { useEpisodeSelection } from '../../features/gemini-route/hooks/useEpisodeSelection';
import {
  selectSelectedTargetEpisodes,
  selectCompletedAudioCount,
  selectCompletedDemucsCount,
  selectUnDemucsEpisodes,
  selectUnAudioEpisodes,
  selectOverallStagePercent,
  selectTargetCounters,
  selectIsBatchExecutionActive,
} from '../../features/gemini-route/utils/geminiRouteSelectors';

import {
  GENRE_OPTIONS,
  SMART_PROMPT_CHIPS,
  DEFAULT_BATCH_PRESET_IDS,
  DEFAULT_BATCH_DIRECTION,
  normalizeGenre,
  togglePreset,
  handleGenreChange,
  composeEffectivePrompt,
  parseDirectionPrompt,
} from '../../utils/dramaGenrePresets';

/**
 * Supported Genre Options & Batch Direction (canonical from dramaGenrePresets.js)
 * - 🎭 កំប្លែង / គ្រួសារ
 * - បកប្រែឃ្លាខ្លីណែន ត្រូវចังหวាក់មាត់ 100% (<= 5.5 ព្យាង្គ/វិនាទី ដោយអត្ថន័យពេញ)
 */

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

  // Dubbing sequential runner feature state
  const { runnerStates, activeEpisodeIds: runnerActiveEpIds, runnerLiveStats, stopStep: runnerStopStep, runSingleAutoFitSpeed, runSingleAutoCompact } = useDubbingFeature(episodes);

  // Selection & Batch Script Setup configuration state
  const [cardStageView, setCardStageView] = useState('all'); // 'all' | 'translate' | 'tts' | 'demucs'
  const [pipelineMode, setPipelineMode] = useState(
    activeEpisode?.generationMode ||
    activeEpisode?.scriptData?.generationMode ||
    'fast_ocr'
  );
  const [dubbingMode, setDubbingMode] = useState('dialogue');
  const [recapStyle, setRecapStyle] = useState('story_recap');
  const [dramaGenre, setDramaGenre] = useState(
    activeEpisode?.scriptData?.genre ||
    activeEpisode?.scriptData?.detectedGenre ||
    'auto'
  );
  const genre = dramaGenre;
  const setGenre = setDramaGenre;
  const [narratorGender, setNarratorGender] = useState('male');
  const [separationPreset, setSeparationPreset] = useState(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage?.getItem('dragondub_separation_preset') : null;
      return ['turbo', 'studio', 'ffmpeg_fast'].includes(saved) ? saved : 'turbo';
    } catch (_) {
      return 'turbo';
    }
  });

  const [presetIds, setPresetIds] = useState(() => {
    const raw = activeEpisode?.scriptData?.customPrompt || activeSeries?.customPrompt || DEFAULT_BATCH_DIRECTION;
    return parseDirectionPrompt(raw).presetIds;
  });
  const [customText, setCustomText] = useState(() => {
    const raw = activeEpisode?.scriptData?.customPrompt || activeSeries?.customPrompt || DEFAULT_BATCH_DIRECTION;
    return parseDirectionPrompt(raw).customText;
  });

  const customDirection = useMemo(
    () => composeEffectivePrompt({ presetIds, customText, genre: dramaGenre }),
    [presetIds, customText, dramaGenre]
  );

  // Sync presetIds & customText when activeEpisode or series changes
  useEffect(() => {
    const raw = activeEpisode?.scriptData?.customPrompt || activeSeries?.customPrompt || DEFAULT_BATCH_DIRECTION;
    const parsed = parseDirectionPrompt(raw);
    setPresetIds(parsed.presetIds);
    setCustomText(parsed.customText);
    const epGenre = activeEpisode?.scriptData?.genre || activeEpisode?.scriptData?.detectedGenre || activeSeries?.genre || 'auto';
    setDramaGenre(epGenre);
  }, [activeEpisode?.id, activeSeries?.id]);
  const [isScriptSetupExpanded, setIsScriptSetupExpanded] = useState(false);
  const [isDirectionExpanded, setIsDirectionExpanded] = useState(false);
  const [isImportingSubtitles, setIsImportingSubtitles] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [importSuccess, setImportSuccess] = useState(null);
  const subtitleFileInputRef = useRef(null);
  const [isStartingBatch, setIsStartingBatch] = useState(false);
  const [batchError, setBatchError] = useState(null);
  const [batchSuccess, setBatchSuccess] = useState(null);
  const [batchInfo, setBatchInfo] = useState(null);
  const [rescanningEpisodeIds, setRescanningEpisodeIds] = useState(() => new Set());

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

  // Auto-Pipeline Run All 3 Steps State
  const [runningPipelineEpIds, setRunningPipelineEpIds] = useState(new Set());

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

    // Proactively check if backend has an active in-progress Demucs job (auto-reconnect on open/refresh)
    fetch('/api/audio/separation-progress')
      .then((res) => res.json())
      .then((pData) => {
        if (cancelled) return;
        if (pData?.success && pData.status === 'separating' && Array.isArray(episodes)) {
          const actMedia = String(pData.activeMedia || '').toLowerCase();
          const targetEp = episodes.find((ep) => {
            const vRef = String(ep.video?.videoPath || ep.video?.videoUrl || ep.videoFile || ep.sourceVideoPath || '').toLowerCase();
            const baseName = vRef.split(/[/\\]/).pop().split('?')[0];
            return (actMedia && baseName && (actMedia.includes(baseName) || baseName.includes(actMedia))) ||
                   (actMedia && actMedia.includes(`ep_${ep.episodeNumber || ep.id}`)) ||
                   (pData.message && pData.message.includes(`ep_${ep.episodeNumber || ep.id}`));
          }) || episodes.find((ep) => !checkEpisodeHasDemucsReady(ep, null, null));

          if (targetEp) {
            setIsSeparatingBatchDemucs(true);
            setActiveDemucsEpisodeId(targetEp.id);
            setActiveDemucsEpisodeIds(new Set([targetEp.id]));
            const dPct = Math.min(100, Math.max(5, pData.progress || 5));
            setDemucsLiveStats((prev) => ({
              ...prev,
              [targetEp.id]: {
                percent: dPct,
                isDone: false,
                logs: Array.isArray(pData.logs) && pData.logs.length > 0 ? pData.logs : [{
                  time: new Date().toLocaleTimeString(),
                  progress: dPct,
                  message: pData.message || `⏳ Demucs Progress: ${dPct}%`,
                }],
                message: pData.message || `Demucs AI Stem Separation... (${dPct}%)`,
                model: pData.model || 'htdemucs',
              },
            }));
          }
        }
      })
      .catch(() => {});

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
  const [isStoppingAllTranslate, setIsStoppingAllTranslate] = useState(false);
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

  // When modal closes, only clean up pending confirm dialogs.
  // Active batch jobs (Demucs, TTS, Translation) MUST CONTINUE running in the background!
  useEffect(() => {
    if (!isOpen) {
      if (confirmResolverRef.current) {
        try { confirmResolverRef.current(false); } catch (_) {}
        confirmResolverRef.current = null;
      }
      setConfirmDialog(null);
    }
  }, [isOpen]);

  // Clean up timers ONLY on true unmount (e.g. app teardown or page navigation)
  useEffect(() => {
    return () => {
      activeTimersRef.current.forEach((t) => clearInterval(t));
      activeTimersRef.current.clear();
      if (confirmResolverRef.current) {
        try { confirmResolverRef.current(false); } catch (_) {}
        confirmResolverRef.current = null;
      }
    };
  }, []);

  const handleKillTranslate = async (targetOrJob = null) => {
    try {
      let targetJobId = null;
      let targetEpisodeId = null;
      let targetSeriesId = activeSeries?.id || seriesId || null;

      if (targetOrJob) {
        // Explicit production jobId provided (avoid using generic ep.id or runner- mock IDs as jobId)
        if (targetOrJob.jobId && typeof targetOrJob.jobId === 'string' && !targetOrJob.jobId.startsWith('runner-')) {
          targetJobId = targetOrJob.jobId;
        }

        // Resolve exact episodeId without confusing it with a production jobId
        targetEpisodeId = targetOrJob.episodeId || (targetOrJob.id && !targetOrJob.jobId ? targetOrJob.id : null);
        if (targetOrJob.seriesId) {
          targetSeriesId = targetOrJob.seriesId;
        }

        // Authoritative resolution: If targetJobId is not directly known, resolve from jobsByEpisodeId
        if (!targetJobId && targetEpisodeId && jobsByEpisodeId.has(targetEpisodeId)) {
          const matched = jobsByEpisodeId.get(targetEpisodeId);
          if (matched?.jobId && !matched.jobId.startsWith('runner-')) {
            targetJobId = matched.jobId;
            targetSeriesId = matched.seriesId || targetSeriesId;
          }
        }

        // If target cannot be safely resolved, do not guess or cancel unrelated jobs
        if (!targetJobId && !targetEpisodeId) {
          const errMsg = '⚠️ មិនអាចកំណត់ Job ឬភាគដែលត្រូវ Kill បានទេ (Target unresolved)';
          setBatchError(errMsg);
          return { success: false, error: errMsg };
        }
      }

      const res = await fetch('/api/jobs/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: targetJobId || undefined,
          episodeId: targetEpisodeId || undefined,
          seriesId: targetSeriesId || undefined,
          all: !targetOrJob,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success === false) {
        const errMsg = data.error || `បរាជ័យក្នុងការបញ្ឈប់ (HTTP ${res.status})`;
        setBatchError(`⚠️ ${errMsg}`);
        return { success: false, error: errMsg };
      }

      // ONLY mark cancelled after authoritative backend confirmation!
      isTranslateCancelledRef.current = true;
      setIsStartingBatch(false);
      setBatchInfo(null);
      setBatchSuccess((prev) => (isTranslateQueueEnqueueBanner(prev) ? null : prev));
      setBatchError('🛑 បានបញ្ឈប់ (Kill) ដំណើរការ Translate ដោយជោគជ័យ!');
      if (typeof onRefreshSeries === 'function') {
        try { await onRefreshSeries(); } catch (_) {}
      }
      return { success: true, ...data };
    } catch (err) {
      console.error('[Kill Translate] Error:', err);
      const errMsg = err.message || 'Error stopping translate job';
      setBatchError(`⚠️ ${errMsg}`);
      return { success: false, error: errMsg };
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

  const handleRescanEpisodeGender = async (targetEp) => {
    if (!targetEp?.id) return;
    const epId = targetEp.id;
    const sId = targetEp.seriesId || activeSeries?.id || seriesId;
    if (!sId) {
      setBatchError('⚠️ មិនស្គាល់ Series ID សម្រាប់ស្កេនឡើងវិញទេ។');
      return;
    }

    try {
      setRescanningEpisodeIds((prev) => new Set(prev).add(epId));
      setBatchSuccess(null);
      setBatchError(null);

      const res = await fetch('/api/rescan-episode-gender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId: sId, episodeId: epId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'បរាជ័យក្នុងការស្កេនបែងចែកសំឡេង');
      }

      setBatchSuccess(`🎉 ស្កេនបែងចែកសំឡេងជោគជ័យ ភាគ ${targetEp.episodeNumber || epId}: 👨 ប្រុស ${data.maleCueCount} ឃ្លា • 👩 ស្រី ${data.femaleCueCount} ឃ្លា!`);
      if (typeof onRefreshSeries === 'function') {
        try { await onRefreshSeries(); } catch (_) {}
      }
    } catch (err) {
      console.error('[Rescan Gender] Error:', err);
      setBatchError(`🛑 មិនអាចស្កេនសំឡេងឡើងវិញបានទេ: ${err.message}`);
    } finally {
      setRescanningEpisodeIds((prev) => {
        const next = new Set(prev);
        next.delete(epId);
        return next;
      });
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

  // Unified batch execution active flag: locks episode selection & prevents race conditions
  const isBatchExecutionActive = Boolean(
    selectIsBatchExecutionActive({
      isStartingBatch,
      hasActiveTranslateQueue,
      isGeneratingBatchTTS,
      isSeparatingBatchDemucs,
      isRepairingBroken,
      runningPipelineEpIds,
      runnerStates,
      runnerActiveEpIds,
    }) || isRepairBusy
  );

  // Episode Multi-Selection & Quick-Select Workflow Hook (Phase 2 Module 2)
  const {
    selectedEpIds,
    setSelectedEpIds,
    allSelectableEpisodes,
    episodesWithVideo,
    pendingEpisodes,
    incompleteEpisodes,
    isEpisodeFullyDone,
    toggleSelect: rawToggleSelect,
    handleSelectCount,
    handleSelectAllEpisodes,
    handleSelectIncompleteEpisodes,
    handleClearSelection,
    handleSelectAllUnscripted,
    handleSelectAll,
    handleSelectAllWithVideo,
  } = useEpisodeSelection({
    episodes,
    seriesId: activeSeries?.id || seriesId,
    isOpen,
    isBatchExecutionActive,
    completedTtsEpIds,
    ttsLiveStats,
    completedDemucsEpIds,
    demucsLiveStats,
  });

  const toggleSelect = (id) => {
    if (isBatchExecutionActive) return;
    rawToggleSelect(id);
  };

  // Episode queue visibility filter:
  // - cardStageView ('all' | 'translate' | 'tts' | 'autofit' | 'demucs'): clicked Sidebar step card 1..4
  // - stageStatusFilter ('all' | 'todo' | 'done'): status filter tabs when focused on a single step
  // - episodeFilterMode ('all' | 'incomplete'): top pill filter hiding episodes complete on steps 1, 2, 4
  const [episodeFilterMode, setEpisodeFilterMode] = useState('all');
  const [stageStatusFilter, setStageStatusFilter] = useState('all');
  const queueColRef = useRef(null);

  useEffect(() => {
    setEpisodeFilterMode('all');
    setCardStageView('all');
    setStageStatusFilter('all');
  }, [currentSeriesId]);

  const scrollQueueToTop = useCallback(() => {
    if (queueColRef.current) {
      queueColRef.current.scrollTop = 0;
    }
  }, []);

  const isEpisodeDoneForStage = useCallback((ep, stageKey) => (
    checkEpisodeDoneForStage(ep, stageKey, {
      completedTtsEpIds,
      ttsLiveStats,
      completedDemucsEpIds,
      demucsLiveStats,
      isEpisodeFullyDone,
    })
  ), [completedTtsEpIds, ttsLiveStats, completedDemucsEpIds, demucsLiveStats, isEpisodeFullyDone]);

  const handleToggleSidebarStageView = useCallback((stageKey) => {
    setCardStageView((prev) => (prev === stageKey ? 'all' : stageKey));
    setStageStatusFilter('all');
    setEpisodeFilterMode('all');
    scrollQueueToTop();
  }, [scrollQueueToTop]);

  const handleExitStageFocus = useCallback(() => {
    setCardStageView('all');
    setStageStatusFilter('all');
    scrollQueueToTop();
  }, [scrollQueueToTop]);

  const handleSelectAndShowAllEpisodes = useCallback(() => {
    setCardStageView('all');
    setStageStatusFilter('all');
    setEpisodeFilterMode('all');
    handleSelectAllEpisodes();
    scrollQueueToTop();
  }, [handleSelectAllEpisodes, scrollQueueToTop]);

  const handleSelectAndShowIncompleteEpisodes = useCallback(() => {
    setCardStageView('all');
    setStageStatusFilter('all');
    setEpisodeFilterMode('incomplete');
    handleSelectIncompleteEpisodes();
    scrollQueueToTop();
  }, [handleSelectIncompleteEpisodes, scrollQueueToTop]);

  const stageSummary = useMemo(() => {
    if (cardStageView === 'all') {
      return { total: episodes.length, done: 0, todo: 0, todoIds: [] };
    }
    let done = 0;
    const todoIds = [];
    for (const ep of episodes) {
      if (isEpisodeDoneForStage(ep, cardStageView)) {
        done += 1;
      } else {
        todoIds.push(ep.id);
      }
    }
    return { total: episodes.length, done, todo: todoIds.length, todoIds };
  }, [episodes, cardStageView, isEpisodeDoneForStage]);

  const handleSelectStageTodoEpisodes = useCallback(() => {
    if (isBatchExecutionActive || stageSummary.todoIds.length === 0) return;
    setSelectedEpIds(new Set(stageSummary.todoIds));
    setStageStatusFilter('todo');
    scrollQueueToTop();
  }, [isBatchExecutionActive, stageSummary.todoIds, setSelectedEpIds, scrollQueueToTop]);

  const visibleEpisodeEntries = useMemo(() => {
    const allEntries = episodes.map((ep, origIdx) => ({ ep, origIdx }));
    if (cardStageView !== 'all') {
      if (stageStatusFilter === 'todo') {
        return allEntries.filter(({ ep }) => !isEpisodeDoneForStage(ep, cardStageView));
      }
      if (stageStatusFilter === 'done') {
        return allEntries.filter(({ ep }) => isEpisodeDoneForStage(ep, cardStageView));
      }
      return allEntries;
    }
    if (episodeFilterMode !== 'incomplete') return allEntries;
    return allEntries.filter(({ ep }) => !isEpisodeFullyDone(ep));
  }, [episodes, cardStageView, stageStatusFilter, episodeFilterMode, isEpisodeDoneForStage, isEpisodeFullyDone]);

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
      const targetSeriesId = activeSeries?.id || seriesId || 'drama_project';
      try {
        await resetEpisodeStateApi({ seriesId: targetSeriesId, episodeId: ep.id, resetType: 'script' });
      } catch (_) {}
      const rawVideoRef = ep.video?.videoPath || ep.video?.videoId || ep.videoFile || ep.sourceVideoPath;
      const effectiveMode = dubbingMode === 'recap'
        ? 'recap'
        : (pipelineMode === 'fast_ocr' ? 'fast_ocr' : 'dialogue');
      await startGenerationJob({
        videoId: rawVideoRef,
        videoPath: ep.video?.videoPath || ep.sourceVideoPath,
        seriesId: targetSeriesId,
        episodeId: ep.id,
        mode: effectiveMode,
        dubbingMode,
        generationMode: pipelineMode,
        recapStyle,
        customPrompt: customDirection,
        force: true,
        confirmed: true,
        genre: dramaGenre,
        narratorGender,
        seriesGlossary: activeSeries?.glossary,
        apiKey: apiKey || undefined,
      });
    } catch (err) {
      setBatchError(err.message || 'ការ Retry បរាជ័យ');
    }
  };

  // Import .srt / .json subtitle file for the first selected episode (or active episode)
  const handleImportBatchSubtitleFile = async (file) => {
    if (!file) return;
    setImportErrors([]);
    setImportSuccess(null);
    setIsImportingSubtitles(true);

    const targetEp = episodes.find((ep) => selectedEpIds.has(ep.id)) || activeEpisode || episodes[0];
    const targetEpId = targetEp?.id || episodeId || 'ep_1';
    const targetEpLabel = targetEp ? `EP${targetEp.episodeNumber || targetEp.id}` : targetEpId;

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target.result;
          const ext = file.name.split('.').pop().toLowerCase();
          const fileType = ext === 'json' ? 'json' : 'srt';

          const res = await importSubtitlesApi({
            fileContent: content,
            fileType,
            seriesId: activeSeries?.id || seriesId || 'drama_project',
            episodeId: targetEpId,
            defaultGender: narratorGender,
            force: true,
            confirmed: true,
          });

          if (res.success && res.segments) {
            setImportSuccess(`Import ជោគជ័យ ${res.count || res.segments.length} ឃ្លា ចូល ${targetEpLabel}!`);
            setPipelineMode('fast_ocr');
            if (typeof onRefreshSeries === 'function') {
              try { await onRefreshSeries(); } catch (_) {}
            }
          }
          if (res.validationErrors?.length > 0) {
            setImportErrors(res.validationErrors);
          }
        } catch (err) {
          const errList = err.data?.validationErrors || [err.message || 'Import Subtitle failed'];
          setImportErrors(errList);
        } finally {
          setIsImportingSubtitles(false);
        }
      };
      reader.readAsText(file, 'utf-8');
    } catch (err) {
      setImportErrors([err.message || 'Failed to read file']);
      setIsImportingSubtitles(false);
    }
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
    () => selectSelectedTargetEpisodes(episodes, selectedEpIds),
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
  const repairButtonCount = effectiveBrokenSummary.textBrokenCount;

  // Truthful STEP 2 & STEP 3 DONE flags: DONE ONLY when broken count == 0 across target episodes
  const isStep2TargetDone = selectedEpIds.size > 0
    ? (unscriptedSelectedEpisodes.length === 0 && selectedBrokenSummary.textBrokenCount === 0)
    : (isTranslateAllDone && seriesBrokenSummary.textBrokenCount === 0);

  // Total completed audio across all episodes (uses segment-level broken scan)
  const completedAudioCount = useMemo(() => {
    return selectCompletedAudioCount(episodes, completedTtsEpIds, ttsLiveStats);
  }, [episodes, completedTtsEpIds, ttsLiveStats]);

  const unAudioCount = Math.max(0, episodes.length - completedAudioCount);
  const audioPercent = computeClampedStagePercent(completedAudioCount, episodes.length);

  // Total completed Demucs (Clean BGM) across all episodes
  const completedDemucsCount = useMemo(() => {
    return selectCompletedDemucsCount(episodes, completedDemucsEpIds, demucsLiveStats);
  }, [episodes, completedDemucsEpIds, demucsLiveStats]);

  const unDemucsCount = Math.max(0, episodes.length - completedDemucsCount);
  const demucsPercent = computeClampedStagePercent(completedDemucsCount, episodes.length);
  const overallStagePercent = selectOverallStagePercent(
    healthyScriptedCount,
    completedAudioCount,
    completedDemucsCount,
    episodes.length
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
    return selectUnDemucsEpisodes(episodes, selectedEpIds, completedDemucsEpIds, demucsLiveStats);
  }, [episodes, selectedEpIds, completedDemucsEpIds, demucsLiveStats]);

  const allSelectedDemucsCompleted = useMemo(() => {
    if (selectedEpIds.size === 0) return false;
    return unDemucsSelectedEpisodes.length === 0;
  }, [selectedEpIds, unDemucsSelectedEpisodes]);

  // Selected episodes that still need audio generation (filter out already completed)
  const unAudioSelectedEpisodes = useMemo(() => {
    return selectUnAudioEpisodes(episodes, selectedEpIds, completedTtsEpIds, ttsLiveStats);
  }, [episodes, selectedEpIds, completedTtsEpIds, ttsLiveStats]);

  const allSelectedAudioCompleted = useMemo(() => {
    if (selectedEpIds.size === 0) return false;
    return unAudioSelectedEpisodes.length === 0 && selectedBrokenSummary.totalBrokenCount === 0;
  }, [selectedEpIds, unAudioSelectedEpisodes, selectedBrokenSummary.totalBrokenCount]);

  const isStep3TrulyDone = selectedEpIds.size > 0
    ? allSelectedAudioCompleted
    : isAudioAllDone;

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

      // Pre-filter active jobs when force: false to prevent 409 DUPLICATE_ACTIVE_JOB error banner
      let episodesToProcess = episodesToTranslate;
      let skippedActiveCount = 0;

      if (!force) {
        episodesToProcess = episodesToTranslate.filter((ep) => {
          const activeJob = jobsByEpisodeId.get(ep.id);
          const isBusy = activeJob && (activeJob.status === 'running' || activeJob.status === 'queued');
          if (isBusy) {
            skippedActiveCount++;
            return false;
          }
          return true;
        });
      }

      if (episodesToProcess.length === 0 && skippedActiveCount > 0) {
        setBatchInfo(`គ្រប់ ${skippedActiveCount} ភាគកំពុងដំណើរការ Translate ក្នុង Queue ស្រាប់ហើយ (រំលងស្វ័យប្រវត្តិ)`);
        setIsStartingBatch(false);
        return;
      }

      const effectiveMode = dubbingMode === 'recap'
        ? 'recap'
        : (pipelineMode === 'fast_ocr' ? 'fast_ocr' : 'dialogue');

      if (force === true) {
        const targetSeriesId = activeSeries?.id || seriesId || 'drama_project';
        await Promise.allSettled(
          episodesToProcess.map((ep) =>
            resetEpisodeStateApi({ seriesId: targetSeriesId, episodeId: ep.id, resetType: 'script' })
          )
        );
      }

      const promises = episodesToProcess.map(async (ep) => {
        const rawVideoRef = ep.video?.videoPath || ep.video?.videoId || ep.videoFile || ep.sourceVideoPath;
        return startGenerationJob({
          videoId: rawVideoRef,
          videoPath: ep.video?.videoPath || ep.sourceVideoPath,
          seriesId: activeSeries?.id || seriesId || 'drama_project',
          episodeId: ep.id,
          mode: effectiveMode,
          dubbingMode,
          generationMode: pipelineMode,
          recapStyle,
          customPrompt: customDirection,
          force: force === true,
          confirmed: force === true,
          genre: dramaGenre,
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

      // Catch any duplicate active job race conditions and treat as skippedActive rather than error
      const duplicateRaceCount = results.filter(
        (r) =>
          r.status === 'rejected' &&
          (String(r.reason?.message || '').includes('Duplicate Active Job') ||
           String(r.reason?.response?.data?.error || '').includes('Duplicate Active Job') ||
           String(r.reason?.data?.error || '').includes('Duplicate Active Job'))
      ).length;
      const totalSkippedActive = skippedActiveCount + duplicateRaceCount;

      const failedReasons = results
        .filter(
          (r) =>
            (r.status === 'rejected' &&
             !r.reason?.data?.alreadyCompleted &&
             !String(r.reason?.message || '').includes('Duplicate Active Job') &&
             !String(r.reason?.response?.data?.error || '').includes('Duplicate Active Job')) ||
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
        const activeSkipNote = totalSkippedActive > 0 ? ` • រំលង ${totalSkippedActive} ភាគដែលកំពុងដំណើរការស្រាប់` : '';
        setBatchSuccess(
          `🎉 បានដាក់បញ្ចូល ${force ? 'Re-Translate' : 'Translate'} ចំនួន ${successful} ភាគ${queueNote}${skipNote}${activeSkipNote}!`
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
      if (String(err?.message || '').includes('Duplicate Active Job')) {
        setBatchInfo('ℹ️ ភាគនេះកំពុងដំណើរការក្នុង Queue ស្រាប់ហើយ');
      } else {
        setBatchError(err.message || 'ការចាប់ផ្ដើម Translate បរាជ័យ');
      }
    } finally {
      setIsStartingBatch(false);
    }
  };

  // Default batch click = fill gaps ONLY (always force: false, skips stored scripted episodes)
  const handleStartBatchTranslate = async (episodesOverride = null) => {
    let targetEpisodes = (Array.isArray(episodesOverride) && episodesOverride.length > 0)
      ? episodesOverride
      : episodes.filter((ep) => selectedEpIds.has(ep.id));

    if (targetEpisodes.length === 0) {
      // Smart Auto-Target: If no checkboxes are selected, auto-target remaining unscripted episodes
      const unscripted = episodes.filter((ep) => !checkEpisodeHasScript(ep));
      targetEpisodes = unscripted.length > 0 ? unscripted : episodes;
      if (targetEpisodes.length > 0) {
        setSelectedEpIds(new Set(targetEpisodes.map((e) => e.id)));
      }
    }

    if (targetEpisodes.length === 0) {
      setBatchInfo('មិនទាន់មានភាគសម្រាប់ដំណើរការ Translate ទេ');
      return;
    }

    const { unscriptedEpisodes, scriptedEpisodes } = partitionSelectedEpisodesForTranslate(targetEpisodes);

    if (unscriptedEpisodes.length === 0) {
      setBatchError(null);
      setBatchSuccess(null);
      const brokenTarget = targetEpisodes.filter((ep) => (getEpisodeBrokenSummary(ep)?.textBrokenCount || 0) > 0);
      if (brokenTarget.length > 0) {
        setBatchInfo(`ភាគដែលរើសមាន Script រួច ប៉ុន្តែមាន ${brokenTarget.length} ភាគមានអក្សរខូច — កំពុងចាប់ផ្ដើមជួសជុល...`);
        handleRepairBrokenSegments(brokenTarget);
      } else {
        setBatchInfo('ភាគដែលរើសទាំងអស់មាន Script រួចរាល់ 100% ហើយ — បើចង់ធ្វើឡើងវិញ សូមប្រើ Re-Translate');
      }
      return;
    }

    await executeBatchTranslateEnqueue(unscriptedEpisodes, {
      force: false,
      skippedScriptedCount: scriptedEpisodes.length,
    });
  };

  // One-click sweep of ONLY text-broken + voice-broken segments (never re-runs whole episodes)
  const handleRepairBrokenSegments = async (episodesOverride = null) => {
    if (hasActiveTranslateQueue || isStartingBatch) {
      setBatchError(null);
      setBatchSuccess(null);
      setBatchInfo(
        '⏳ កំពុងដំណើរការ Translate / Re-Translate — សូមរង់ចាំឱ្យ Queue ចប់សិន មុននឹងចុចជួសជុលឃ្លាខូច!'
      );
      return;
    }

    const candidateEps = (Array.isArray(episodesOverride) && episodesOverride.length > 0)
      ? episodesOverride
      : (selectedTargetEpisodes.length > 0 ? selectedTargetEpisodes : episodes);
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

    const modeLabel = `${pipelineMode === 'fast_ocr' ? '⚡ Fast OCR' : '🎯 Standard'} • ${dubbingMode === 'recap' ? 'Mode B: សម្រាយរឿង' : 'Mode A: សន្ទនាតួអង្គ'}`;
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
  const handleBatchGenerateTTS = async (episodesOverride = null, { force = false } = {}) => {
    let targetEpisodes = (Array.isArray(episodesOverride) && episodesOverride.length > 0)
      ? episodesOverride
      : episodes.filter((ep) => selectedEpIds.has(ep.id));
    if (targetEpisodes.length === 0) {
      // Smart Auto-Target: If no checkboxes selected, auto-target episodes with script needing voice
      const unAudio = episodes.filter((ep) => checkEpisodeHasScript(ep) && (!ep.audioGenerated || ep.audioOutdated));
      targetEpisodes = unAudio.length > 0 ? unAudio : episodes.filter((ep) => checkEpisodeHasScript(ep));
      if (targetEpisodes.length > 0) {
        setSelectedEpIds(new Set(targetEpisodes.map((e) => e.id)));
      }
    }
    if (targetEpisodes.length === 0) {
      setBatchInfo('មិនទាន់មានភាគដែលមាន Script សម្រាប់បង្កើតសំឡេង AI ទេ — សូម Translate ជាមុនសិន');
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
    const pendingEpisodes = force
      ? targetEpisodes
      : targetEpisodes.filter((localEp) => {
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

        // Skip immediately if fresh server state confirms non-outdated completed narration on disk (unless force: true)
        if (!force && checkEpisodeHasAudioReady(effectiveEp, serverEp ? null : completedTtsEpIds, null)) {
          console.log(`[Batch TTS] Episode ${ep.id} already has completed narration on disk. Skipping.`);
          setCompletedTtsEpIds((prev) => new Set([...prev, ep.id]));
          setActiveTtsEpisodeIds((prev) => {
            const next = new Set(prev);
            next.delete(ep.id);
            return next;
          });
          return;
        }

        if (force) {
          try {
            await resetEpisodeStateApi({ seriesId: targetSeriesId, episodeId: ep.id, resetType: 'voice' });
          } catch (_) {}
          setCompletedTtsEpIds((prev) => {
            const next = new Set(prev);
            next.delete(ep.id);
            return next;
          });
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
              forceRegen: Boolean(force),
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
  const handleBatchDemucsSeparation = async (episodesOverride = null, { force = false } = {}) => {
    let targetEpisodes = (Array.isArray(episodesOverride) && episodesOverride.length > 0)
      ? episodesOverride
      : episodes.filter((ep) => selectedEpIds.has(ep.id));
    if (targetEpisodes.length === 0) {
      // Smart Auto-Target: If no checkboxes selected, auto-target episodes needing Demucs
      const unDemucs = episodes.filter((ep) => !checkEpisodeHasDemucsReady(ep, completedDemucsEpIds, demucsLiveStats));
      targetEpisodes = unDemucs.length > 0 ? unDemucs : episodes;
      if (targetEpisodes.length > 0) {
        setSelectedEpIds(new Set(targetEpisodes.map((e) => e.id)));
      }
    }
    if (targetEpisodes.length === 0) {
      setBatchInfo('មិនទាន់មានភាគសម្រាប់បំបែកសំឡេង Demucs ទេ');
      return;
    }

    // Filter only episodes that actually need Demucs separation
    const episodesToProcess = force
      ? targetEpisodes
      : targetEpisodes.filter((ep) => {
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
                separationPreset,
                force: Boolean(force),
              }),
            });
            if (isDemucsCancelledRef.current) {
              clearInterval(demucsPollTimer);
              break;
            }
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
              sepResult = data;
            } else if (res.status === 409 || data.busy) {
              // 409 Conflict: Demucs is already actively running on backend for this episode!
              // Seamlessly attach and wait for the in-progress backend job instead of failing!
              console.log(`[Batch Demucs] Demucs job already active on backend for ${ep.id} (409 Conflict / busy). Attaching to active progress...`);
              postErrorMsg = null;
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
            const isFatal = /DefaultCPUAllocator|ENOMEM|out of memory/i.test(String(postErrorMsg || ''));
            if (isFatal) {
              setBatchError(`❌ ការបំបែកសំឡេង Demucs ជួបបញ្ហា RAM / Memory (${postErrorMsg || ''}) — បានបញ្ឈប់ដំណើរការភាគបន្ទាប់ជាស្វ័យប្រវត្តិ!`);
              break;
            }
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
          const isFatal = /memory|alloc_cpu|refused|Failed to fetch|NetworkError/i.test(String(dErr?.message || ''));
          if (isFatal) {
            setBatchError(`❌ បរាជ័យក្នុងការតភ្ជាប់បំបែកសំឡេង Demucs (${dErr.message || ''}) — បានបញ្ឈប់ដំណើរការភាគបន្ទាប់ជាស្វ័យប្រវត្តិ!`);
            break;
          }
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

  // ── Master Run All 3 Steps (Auto-Pipeline: Translate -> AI Khmer Voice -> Demucs Clean BGM) ──
  const handleRunAll3Steps = async (targetOverride = null) => {
    let targetEpisodes = (Array.isArray(targetOverride) && targetOverride.length > 0)
      ? targetOverride
      : (selectedEpIds.size > 0 ? episodes.filter((ep) => selectedEpIds.has(ep.id)) : []);

    if (targetEpisodes.length === 0) {
      // Smart Auto-Target: If no checkboxes selected, auto-target incomplete episodes (or all episodes)
      targetEpisodes = incompleteEpisodes.length > 0 ? incompleteEpisodes : episodes;
      if (targetEpisodes.length > 0) {
        setSelectedEpIds(new Set(targetEpisodes.map((e) => e.id)));
      }
    }

    if (targetEpisodes.length === 0) {
      setBatchInfo('មិនទាន់មានភាគសម្រាប់ដំណើរការទេ');
      return;
    }

    const unscripted = targetEpisodes.filter((ep) => !checkEpisodeHasScript(ep));
    const brokenTarget = targetEpisodes.filter((ep) => (getEpisodeBrokenSummary(ep)?.totalBrokenCount || 0) > 0);

    setBatchInfo(`🚀 កំពុងដំណើរការ Auto-Pipeline ទាំង 3 ជំហានលើ ${targetEpisodes.length} ភាគ...`);

    // 1. Enqueue Translate for any unscripted episodes
    if (unscripted.length > 0) {
      await executeBatchTranslateEnqueue(unscripted, {
        force: false,
        skippedScriptedCount: targetEpisodes.length - unscripted.length,
      });
    } else if (brokenTarget.length > 0) {
      handleRepairBrokenSegments(brokenTarget);
    }

    // 2. Trigger Khmer TTS for episodes with script
    const readyForTts = targetEpisodes.filter((ep) => checkEpisodeHasScript(ep));
    if (readyForTts.length > 0) {
      await handleBatchGenerateTTS(readyForTts);
    }

    // 3. Trigger Demucs vocal separation
    await handleBatchDemucsSeparation(targetEpisodes);
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
      className="studio-route-stage"
    >
      <div
        role="region"
        aria-label="Batch Generate Studio"
        className="studio-route-stage-shell"
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        {/* ── 1. MODAL HEADER (Batch Generate Studio — Title + 1 Key Pool Pill + Close) ── */}
        <div
          data-testid="batch-modal-header"
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary-panel)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary-accent)',
              flexShrink: 0,
            }}>
              <Cpu size={17} />
            </div>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--text-lg)',
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '0.01em',
            }}>
              Batch Studio · ផលិតច្រើនភាគ
            </h1>
            {(() => {
              const hdrView = applyElapsedCountdownToKeysHealth(keysHealth, quotaNowMs);
              const hdrKeys = Array.isArray(hdrView?.keys) ? hdrView.keys : [];
              const hdrSummary = hdrView?.quotaSummary;
              const perKeyLimit = hdrView?.settings?.dailyRpdPerKey || 500;
              const exhaustedCount = hdrKeys.filter(
                (k) => (k.todayRequests || 0) >= perKeyLimit
              ).length;
              const hdrTotal = hdrSummary?.totalKeys ?? hdrView?.totalKeys ?? (hdrKeys.length || 6);
              const rawReady = hdrSummary?.readyKeys ?? hdrView?.activeCount ?? hdrTotal;
              const hdrReady = Math.max(0, Math.min(rawReady, hdrTotal - exhaustedCount));
              const hdrRpmPerKey = hdrView?.settings?.rpmPerKey || 15;
              const hdrRpmReady = hdrReady * hdrRpmPerKey;
              const allReady = hdrReady === hdrTotal && hdrTotal > 0;
              const noneReady = hdrReady === 0 && hdrTotal > 0;
              const pillColor = noneReady ? '#F87171' : allReady ? '#34D399' : '#FBBF24';
              const pillBg = noneReady ? 'rgba(248, 113, 113, 0.10)' : allReady ? 'rgba(52, 211, 153, 0.10)' : 'rgba(251, 191, 36, 0.10)';
              const pillBorder = noneReady ? 'rgba(248, 113, 113, 0.30)' : allReady ? 'rgba(52, 211, 153, 0.28)' : 'rgba(251, 191, 36, 0.30)';
              const pillLabel = hdrTotal > 0
                ? allReady
                  ? `${hdrReady}/${hdrTotal} Keys Ready (${hdrRpmReady} RPM Pool)`
                  : `${hdrReady}/${hdrTotal} Keys Ready (${hdrRpmReady} RPM)${exhaustedCount > 0 ? ` • ⚠️ ${exhaustedCount} អស់ Quota` : ''}`
                : 'No Keys Configured';
              return (
                <button
                  type="button"
                  data-testid="btn-open-quota-from-batch"
                  onClick={onOpenQuotaModal ? handleOpenQuotaConsole : undefined}
                  title="ពិនិត្យ Gemini API Keys និង Rate Limits"
                  style={{
                    fontSize: '0.70rem',
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: 9999,
                    background: pillBg,
                    color: pillColor,
                    border: `1px solid ${pillBorder}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: onOpenQuotaModal ? 'pointer' : 'default',
                  }}
                >
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: pillColor,
                    display: 'inline-block',
                  }} />
                  <span>{pillLabel}</span>
                </button>
              );
            })()}
          </div>

          {/* Close Button ("✕") */}
          <button
            type="button"
            onClick={onClose}
            className="btn-tactile"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#94A3B8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(248, 113, 113, 0.14)';
              e.currentTarget.style.borderColor = 'rgba(248, 113, 113, 0.35)';
              e.currentTarget.style.color = '#F87171';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = '#94A3B8';
            }}
            title="បិទ (ESC)"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── UNIFIED 2-COLUMN DARKROOM SPLIT BODY (Controls Left | Episode Queue Right) ── */}
        <div
          data-testid="modal-scroll-body"
          className="batch-studio-split-body"
        >
        {/* ── 2. LEFT STICKY CONTROL COLUMN ── */}
        <aside className="batch-studio-controls-col">
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

          {/* 2. Episode Quick-Select Row (Single Compact Row) */}
          <div
            data-testid="batch-quick-select-row"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
          >
            <span style={{ fontSize: '0.73rem', color: '#94A3B8', fontWeight: 700 }}>ជ្រើសរើសភាគ៖</span>

            {isBatchExecutionActive && (
              <span
                data-testid="selection-locked-badge"
                style={{
                  fontSize: '0.69rem',
                  fontWeight: 700,
                  color: '#38BDF8',
                  background: 'rgba(56, 189, 248, 0.12)',
                  padding: '2px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Loader2 size={11} className="animate-spin" />
                <span>🔒 កំពុងដំណើរការ (Selection Locked)</span>
              </span>
            )}

            {/* Pill 1: ទាំងអស់ (${episodes.length} ភាគ) */}
            <button
              type="button"
              data-testid="pill-select-all"
              onClick={handleSelectAndShowAllEpisodes}
              disabled={isBatchExecutionActive}
              className="btn-tactile"
              style={{
                padding: '4px 11px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: (episodeFilterMode === 'all' && selectedEpIds.size === episodes.length && episodes.length > 0) ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                border: (episodeFilterMode === 'all' && selectedEpIds.size === episodes.length && episodes.length > 0) ? '1px solid rgba(56, 189, 248, 0.55)' : '1px solid rgba(255, 255, 255, 0.08)',
                color: (episodeFilterMode === 'all' && selectedEpIds.size === episodes.length && episodes.length > 0) ? '#38BDF8' : '#CBD5E1',
                transition: 'all 0.15s ease',
                cursor: isBatchExecutionActive ? 'not-allowed' : 'pointer',
                opacity: isBatchExecutionActive ? 0.45 : 1,
              }}
              title={isBatchExecutionActive ? 'កំពុងដំណើរការ មិនអាចផ្លាស់ប្តូរការជ្រើសរើសបានទេ' : 'បង្ហាញ និងជ្រើសរើសគ្រប់ភាគទាំងអស់ក្នុង Series'}
            >
              <span>ទាំងអស់ ({episodes.length} ភាគ)</span>
            </button>

            {/* Pill 2: ភាគមិនទាន់ចប់ (${incompleteEpisodes.length} ភាគ) */}
            <button
              type="button"
              data-testid="pill-select-incomplete"
              onClick={handleSelectAndShowIncompleteEpisodes}
              disabled={isBatchExecutionActive || incompleteEpisodes.length === 0}
              className="btn-tactile"
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: (episodeFilterMode === 'incomplete' && incompleteEpisodes.length > 0) ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                border: (episodeFilterMode === 'incomplete' && incompleteEpisodes.length > 0) ? '1px solid rgba(245, 158, 11, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
                color: (episodeFilterMode === 'incomplete' && incompleteEpisodes.length > 0) ? '#FBBF24' : '#CBD5E1',
                transition: 'all 0.15s ease',
                cursor: (isBatchExecutionActive || incompleteEpisodes.length === 0) ? 'not-allowed' : 'pointer',
                opacity: (isBatchExecutionActive || incompleteEpisodes.length === 0) ? 0.45 : 1,
              }}
              title={isBatchExecutionActive ? 'កំពុងដំណើរការ មិនអាចផ្លាស់ប្តូរការជ្រើសរើសបានទេ' : (incompleteEpisodes.length === 0 ? 'គ្រប់ភាគទាំងអស់រួចរាល់ 100% ហើយ' : 'បង្ហាញតែភាគដែលមិនទាន់ចប់ជំហាន 1, 2, ឬ 4 (លាក់ភាគដែលធ្វើរួច)')}
            >
              <span>{incompleteEpisodes.length === 0 ? '✓ គ្រប់ភាគរួចរាល់ 100%' : `ភាគមិនទាន់ចប់ (${incompleteEpisodes.length} ភាគ)`}</span>
            </button>

            {/* Pill 3: ២ ភាគដំបូង (2 EPs) */}
            <button
              type="button"
              onClick={() => handleSelectCount(2)}
              disabled={isBatchExecutionActive}
              className="btn-tactile"
              style={{
                padding: '4px 11px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: selectedEpIds.size === 2 ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                border: selectedEpIds.size === 2 ? '1px solid rgba(56, 189, 248, 0.55)' : '1px solid rgba(255, 255, 255, 0.08)',
                color: selectedEpIds.size === 2 ? '#38BDF8' : '#CBD5E1',
                transition: 'all 0.15s ease',
                cursor: isBatchExecutionActive ? 'not-allowed' : 'pointer',
                opacity: isBatchExecutionActive ? 0.45 : 1,
              }}
              title={isBatchExecutionActive ? 'កំពុងដំណើរការ មិនអាចផ្លាស់ប្តូរការជ្រើសរើសបានទេ' : 'ជ្រើសរើស ២ ភាគដំបូង'}
            >
              <span>២ ភាគដំបូង (2 EPs)</span>
            </button>

            {/* Pill 4: ៤ ភាគដំបូង (4 EPs) */}
            <button
              type="button"
              onClick={() => handleSelectCount(4)}
              disabled={isBatchExecutionActive}
              className="btn-tactile"
              style={{
                padding: '4px 11px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: selectedEpIds.size === 4 ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                border: selectedEpIds.size === 4 ? '1px solid rgba(56, 189, 248, 0.55)' : '1px solid rgba(255, 255, 255, 0.08)',
                color: selectedEpIds.size === 4 ? '#38BDF8' : '#CBD5E1',
                transition: 'all 0.15s ease',
                cursor: isBatchExecutionActive ? 'not-allowed' : 'pointer',
                opacity: isBatchExecutionActive ? 0.45 : 1,
              }}
              title={isBatchExecutionActive ? 'កំពុងដំណើរការ មិនអាចផ្លាស់ប្តូរការជ្រើសរើសបានទេ' : 'ជ្រើសរើស ៤ ភាគដំបូង'}
            >
              <span>៤ ភាគដំបូង (4 EPs)</span>
            </button>

            {/* Pill 5: ដកជ្រើសរើស (Clear) */}
            {selectedEpIds.size > 0 && (
              <button
                type="button"
                onClick={handleClearSelection}
                disabled={isBatchExecutionActive}
                className="btn-tactile"
                style={{
                  padding: '4px 9px',
                  borderRadius: 6,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: isBatchExecutionActive ? '#64748B' : '#94A3B8',
                  cursor: isBatchExecutionActive ? 'not-allowed' : 'pointer',
                  opacity: isBatchExecutionActive ? 0.45 : 1,
                }}
                title={isBatchExecutionActive ? 'កំពុងដំណើរការ មិនអាចផ្លាស់ប្តូរការជ្រើសរើសបានទេ' : 'ដកការជ្រើសរើសទាំងអស់'}
              >
                ដកជ្រើសរើស ({selectedEpIds.size})
              </button>
            )}
          </div>

          {/* ── 3. UNIFIED COLLAPSIBLE SCRIPT SETUP BAR (Max 1 Border Level, Flat Horizontal Rows) ── */}
          <BatchScriptSetupPanel
            dramaGenre={dramaGenre}
            setDramaGenre={setDramaGenre}
            activeEpisode={activeEpisode}
            customDirection={customDirection}
            pipelineMode={pipelineMode}
            setPipelineMode={setPipelineMode}
            dubbingMode={dubbingMode}
            setDubbingMode={setDubbingMode}
            narratorGender={narratorGender}
            setNarratorGender={setNarratorGender}
            recapStyle={recapStyle}
            setRecapStyle={setRecapStyle}
            isScriptSetupExpanded={isScriptSetupExpanded}
            setIsScriptSetupExpanded={setIsScriptSetupExpanded}
            isDirectionExpanded={isDirectionExpanded}
            setIsDirectionExpanded={setIsDirectionExpanded}
            presetIds={presetIds}
            setPresetIds={setPresetIds}
            togglePreset={togglePreset}
            customText={customText}
            setCustomText={setCustomText}
            handleGenreChange={handleGenreChange}
            subtitleFileInputRef={subtitleFileInputRef}
            isImportingSubtitles={isImportingSubtitles}
            importSuccess={importSuccess}
            importErrors={importErrors}
            handleImportBatchSubtitleFile={handleImportBatchSubtitleFile}
          />

          {/* ── 4. STEP STATUS & 1-BY-1 CONTROLS (Slim Sidebar Step Nav 1–4; Actions in Top Bar) ── */}
          <DubbingStepCardsBar
            episodes={episodes}
            selectedEpIds={selectedEpIds}
            setupOptions={{ pipelineMode, dubbingMode, genre, narratorGender, customDirection, separationPreset }}
            separationPreset={separationPreset}
            onSeparationPresetChange={setSeparationPreset}
            activeStageView={cardStageView}
            onSelectStageView={handleToggleSidebarStageView}
            navOnly={true}
            openStudioDialog={openStudioDialog}
          />

          {/* ── 5. SINGLE UNIFIED ACTIONS & CONTROLS TOOLBAR (Wrapping, Never Overflowing) ── */}
          {(() => {
            const {
              repairBrokenCount,
            } = selectTargetCounters({
              selectedCount: selectedEpIds.size,
              unscriptedSelectedCount: unscriptedSelectedEpisodes.length,
              remainingTranslateCount: remainingCount,
              unAudioSelectedCount: unAudioSelectedEpisodes.length,
              unAudioSeriesCount: unAudioCount,
              unDemucsSelectedCount: unDemucsSelectedEpisodes.length,
              unDemucsSeriesCount: unDemucsCount,
              selectedTextBrokenCount: selectedBrokenSummary?.textBrokenCount,
              seriesTextBrokenCount: seriesBrokenSummary?.textBrokenCount,
              incompleteEpisodesCount: incompleteEpisodes.length,
              totalEpisodesCount: episodes.length,
            });

            return (
              <div
                data-testid="batch-actions-bar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  width: '100%',
                  padding: '4px 0',
                }}
              >
                {/* Left: Master Auto-Production CTA & Step Utilities */}
                <div
                  data-testid="batch-primary-execution-row"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                >
                  {repairBrokenCount > 0 && (
                    <button
                      type="button"
                      data-testid="btn-repair-broken-segments"
                      onClick={() => handleRepairBrokenSegments()}
                      disabled={isRepairBusy}
                      className="btn-tactile"
                      style={{
                        padding: '6px 11px',
                        borderRadius: 6,
                        background: 'rgba(251, 146, 60, 0.15)',
                        border: '1px solid rgba(251, 146, 60, 0.45)',
                        color: '#FDBA74',
                        fontSize: '0.70rem',
                        fontWeight: 700,
                        cursor: isRepairBusy ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                      title="ជួសជុលតែឃ្លាដែលខូច (អត្ថបទខូច + សំឡេងខ្វះ)"
                    >
                      <Wrench size={12} />
                      <span>ជួសជុល ({repairBrokenCount})</span>
                    </button>
                  )}

                  {/* Stop/Kill Buttons if any job running */}
                  {(isStartingBatch || activeSeriesTranslateJobs.some((j) => selectedEpIds.size === 0 || selectedEpIds.has(j.episodeId))) && (
                    <button
                      type="button"
                      disabled={isStoppingAllTranslate}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (isStoppingAllTranslate) return;
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
                          setIsStoppingAllTranslate(true);
                          try {
                            await handleKillTranslate();
                          } finally {
                            setIsStoppingAllTranslate(false);
                          }
                        }
                      }}
                      style={{
                        padding: '5px 9px',
                        borderRadius: 6,
                        background: isStoppingAllTranslate ? 'rgba(245, 158, 11, 0.22)' : 'rgba(239, 68, 68, 0.14)',
                        border: isStoppingAllTranslate ? '1px solid rgba(245, 158, 11, 0.55)' : '1px solid rgba(239, 68, 68, 0.45)',
                        color: isStoppingAllTranslate ? '#FDE68A' : '#FCA5A5',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        cursor: isStoppingAllTranslate ? 'wait' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        opacity: isStoppingAllTranslate ? 0.75 : 1,
                      }}
                    >
                      {isStoppingAllTranslate ? (
                        <>
                          <Loader2 size={11} className="animate-spin" />
                          <span>Stopping...</span>
                        </>
                      ) : (
                        <span>បញ្ឈប់ (Kill)</span>
                      )}
                    </button>
                  )}
                </div>

                {/* Right: Aspect Ratio & Export Studio */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {/* Aspect Ratio Toggle */}
                  {batchRender && (
                    <div
                      role="group"
                      aria-label="Step 4 Export Aspect Ratio"
                      data-testid="step4-aspect-toggle"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        padding: 2,
                        borderRadius: 6,
                        background: 'rgba(15, 23, 42, 0.75)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                      }}
                    >
                      <button
                        type="button"
                        data-testid="step4-aspect-16-9"
                        aria-pressed={resolvedStep4AspectRatio === '16:9'}
                        disabled={isBatchExportRunning || isBatchExportStarting || isRendering}
                        onClick={() => onAspectRatioChange?.('16:9')}
                        style={{
                          padding: '3px 7px',
                          borderRadius: 4,
                          border: 'none',
                          background: resolvedStep4AspectRatio === '16:9' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                          color: resolvedStep4AspectRatio === '16:9' ? '#38BDF8' : '#94A3B8',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          cursor: 'pointer',
                        }}
                      >
                        16:9
                      </button>
                      <button
                        type="button"
                        data-testid="step4-aspect-9-16"
                        aria-pressed={resolvedStep4AspectRatio === '9:16'}
                        disabled={isBatchExportRunning || isBatchExportStarting || isRendering}
                        onClick={() => onAspectRatioChange?.('9:16')}
                        style={{
                          padding: '3px 7px',
                          borderRadius: 4,
                          border: 'none',
                          background: resolvedStep4AspectRatio === '9:16' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                          color: resolvedStep4AspectRatio === '9:16' ? '#38BDF8' : '#94A3B8',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          cursor: 'pointer',
                        }}
                      >
                        9:16
                      </button>
                    </div>
                  )}

                  {/* Open Export Studio */}
                  {batchRender && (
                    <button
                      type="button"
                      data-testid="step4-open-export-studio-btn"
                      onClick={() => {
                        onClose?.();
                        onOpenExportStudio?.();
                      }}
                      className="btn-tactile"
                      style={{
                        padding: '5px 11px',
                        borderRadius: 6,
                        background: 'rgba(56, 189, 248, 0.12)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        color: '#38BDF8',
                        fontSize: '0.70rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Film size={13} />
                      <span>Export Studio</span>
                    </button>
                  )}

                  {/* Compatibility hidden buttons for test suites */}
                  <button type="button" data-testid="btn-batch-run-all" onClick={() => handleRunAll3Steps()} style={{ display: 'none' }} aria-hidden="true">ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន</button>
                  <button type="button" data-testid="btn-batch-retranslate" onClick={handleReTranslateSelected} style={{ display: 'none' }} aria-hidden="true">Re-Translate</button>
                  <button type="button" data-testid="btn-batch-primary-cta" onClick={handleStartBatchTranslate} style={{ display: 'none' }} aria-hidden="true">Translate</button>
                  <button type="button" data-testid="btn-batch-primary-tts" onClick={() => handleBatchGenerateTTS()} style={{ display: 'none' }} aria-hidden="true">TTS</button>
                  <button type="button" data-testid="btn-batch-primary-demucs" onClick={() => handleBatchDemucsSeparation()} style={{ display: 'none' }} aria-hidden="true">Demucs</button>
                  <button type="button" data-testid="btn-batch-translate" onClick={handleStartBatchTranslate} style={{ display: 'none' }} aria-hidden="true">Translate</button>
                  <button type="button" data-testid="btn-batch-tts" onClick={() => handleBatchGenerateTTS()} style={{ display: 'none' }} aria-hidden="true">TTS</button>
                  <button type="button" data-testid="btn-batch-demucs" onClick={() => handleBatchDemucsSeparation()} style={{ display: 'none' }} aria-hidden="true">Demucs</button>
                  <div data-testid="batch-card-view-filter" style={{ display: 'none' }} aria-hidden="true">
                    <button type="button" data-testid="filter-view-all">All</button>
                    <button type="button" data-testid="filter-view-translate">Translate</button>
                    <button type="button" data-testid="filter-view-tts">TTS</button>
                    <button type="button" data-testid="filter-view-demucs">Demucs</button>
                  </div>
                </div>
              </div>
            );
          })()}
        </aside>

        {/* ── 3. RIGHT EPISODE QUEUE WORKSPACE ── */}
        <section className="batch-studio-queue-col" ref={queueColRef}>
          {/* Compact Queue Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 12,
            paddingBottom: 10,
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
                បញ្ជីភាគសម្រាប់ផលិត (Episode Queue)
              </span>
              <span style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-secondary-panel)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--primary-accent)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-2xs)',
                fontWeight: 700,
              }}>
                {selectedEpIds.size}/{episodes.length} selected
              </span>
              {episodeFilterMode === 'incomplete' && (
                <>
                  <span
                    data-testid="incomplete-filter-active-badge"
                    style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-xs)',
                      background: 'rgba(245, 158, 11, 0.14)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      color: '#FBBF24',
                      fontSize: 'var(--text-2xs)',
                      fontWeight: 700,
                    }}
                  >
                    បង្ហាញតែមិនទាន់ចប់ (1, 2, 4): {visibleEpisodeEntries.length} ភាគ
                  </span>
                  <button
                    type="button"
                    data-testid="btn-show-all-episodes"
                    onClick={() => setEpisodeFilterMode('all')}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-xs)',
                      background: 'var(--bg-elevated-panel)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--text-2xs)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    បង្ហាញទាំងអស់ ({episodes.length})
                  </button>
                </>
              )}
            </div>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {overallStagePercent}% Ready
            </span>
          </div>

          {/* ── STAGE FOCUS FILTER & ACTION TOP BAR (Steps 1–4 Controls + Status Tabs) ── */}
          <BatchStageFocusBar
            episodes={episodes}
            selectedEpIds={selectedEpIds}
            setupOptions={{ pipelineMode, dubbingMode, genre, narratorGender, customDirection, separationPreset }}
            separationPreset={separationPreset}
            onSeparationPresetChange={setSeparationPreset}
            cardStageView={cardStageView}
            stageStatusFilter={stageStatusFilter}
            onChangeStageStatusFilter={(nextFilter) => {
              setStageStatusFilter(nextFilter);
              scrollQueueToTop();
            }}
            stageSummary={stageSummary}
            isBatchExecutionActive={isBatchExecutionActive}
            onSelectStageTodoEpisodes={handleSelectStageTodoEpisodes}
            onSelectStageView={handleToggleSidebarStageView}
            onExitStageFocus={handleExitStageFocus}
            openStudioDialog={openStudioDialog}
          />

        {/* Active Backend Repair / Production Banner */}
        {activeSeriesRepairJobs.length > 0 && (
          <div
            role="status"
            data-testid="batch-repair-running-banner"
            style={{
              marginBottom: 12,
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#FDE68A',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={15} className="animate-spin" color="#FBBF24" />
              <span>
                ⚡ Backend កំពុងដំណើរការជួសជុល Script & សំឡេង AI ({activeSeriesRepairJobs.filter((j) => j.status === 'running').length} កំពុងរត់, {activeSeriesRepairJobs.filter((j) => j.status === 'queued').length} ក្នុង Queue)...
              </span>
            </span>
          </div>
        )}

        {/* Batch Notifications */}
        {batchInfo && (
          <div
            role="status"
            data-testid="batch-info-banner"
            style={{
              marginBottom: 12,
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#BAE6FD',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <AlertCircle size={15} color="#38BDF8" />
              <span>{batchInfo}</span>
            </span>
            <button
              type="button"
              onClick={() => setBatchInfo(null)}
              style={{ background: 'none', border: 'none', color: '#BAE6FD', cursor: 'pointer', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {batchSuccess && (
          <div
            data-testid="batch-success-banner"
            style={{
              marginBottom: 12,
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(16, 185, 129, 0.14)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              color: '#6EE7B7',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <CheckCircle2 size={15} />
              <span>{batchSuccess}</span>
            </span>
            <button
              type="button"
              onClick={() => setBatchSuccess(null)}
              style={{ background: 'none', border: 'none', color: '#6EE7B7', cursor: 'pointer', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {batchError && (
          <div
            data-testid="batch-error-banner"
            style={{
              marginBottom: 12,
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239, 68, 68, 0.14)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#FCA5A5',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <AlertCircle size={15} />
              <span>{batchError}</span>
            </span>
            <button
              type="button"
              onClick={() => setBatchError(null)}
              style={{ background: 'none', border: 'none', color: '#FCA5A5', cursor: 'pointer', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── 4. SPACIOUS EPISODE GRID (Darkroom Console) ── */}
        <div>
          {episodes.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 220,
              padding: '28px 16px',
              color: 'var(--text-secondary)',
              gap: 12,
              background: 'var(--bg-primary-panel)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
            }}>
              <AlertCircle size={36} color="var(--primary-accent)" />
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>មិនទាន់មានភាគវីដេអូទេ</div>
              <div style={{ fontSize: 'var(--text-sm)' }}>សូមបង្ហោះវីដេអូរឿងភាគក្នុង Tab "ភាគ" ជាមុនសិន។</div>
            </div>
          ) : visibleEpisodeEntries.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 220,
              padding: '28px 16px',
              color: 'var(--text-secondary)',
              gap: 10,
              background: 'var(--bg-primary-panel)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: 'var(--radius-md)',
            }}>
              <CheckCircle2 size={34} color="var(--color-success)" />
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>
                {cardStageView !== 'all'
                  ? (stageStatusFilter === 'todo'
                    ? `គ្រប់ភាគទាំងអស់ (${episodes.length}/${episodes.length}) បានធ្វើ ${STAGE_FOCUS_META[cardStageView]?.label || ''} រួចរាល់ 100% ហើយ!`
                    : `មិនទាន់មានភាគណាធ្វើ ${STAGE_FOCUS_META[cardStageView]?.label || ''} រួចនៅឡើយទេ`)
                  : `គ្រប់ភាគទាំងអស់ (${episodes.length}/${episodes.length}) បានបញ្ចប់ជំហាន 1, 2, និង 4 រួចរាល់ 100% ហើយ!`}
              </div>
              <button
                type="button"
                onClick={cardStageView !== 'all' ? () => setStageStatusFilter('all') : handleSelectAndShowAllEpisodes}
                style={{
                  marginTop: 4,
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(56, 189, 248, 0.14)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#38BDF8',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                បង្ហាញភាគទាំងអស់ ({episodes.length} ភាគ)
              </button>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: cardStageView !== 'all'
                ? 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))'
                : 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))',
              alignItems: 'start',
              gap: cardStageView !== 'all' ? 9 : 12,
            }}>
              {visibleEpisodeEntries.map(({ ep, origIdx }) => (
                <BatchEpisodeCard
                  key={ep.id}
                  ep={ep}
                  idx={origIdx}
                  keyThemes={KEY_THEMES}
                  activeSeries={activeSeries}
                  selectedEpIds={selectedEpIds}
                  toggleSelect={toggleSelect}
                  jobsByEpisodeId={jobsByEpisodeId}
                  poolTotalKeys={poolTotalKeys}
                  keyThemeCount={keyThemeCount}
                  cardStageView={cardStageView}
                  runnerStates={runnerStates}
                  runnerLiveStats={runnerLiveStats}
                  runnerStopStep={runnerStopStep}
                  runSingleAutoFitSpeed={runSingleAutoFitSpeed}
                  runSingleAutoCompact={runSingleAutoCompact}
                  ttsLiveStats={ttsLiveStats}
                  demucsLiveStats={demucsLiveStats}
                  activeTtsEpisodeId={activeTtsEpisodeId}
                  activeTtsEpisodeIds={activeTtsEpisodeIds}
                  activeDemucsEpisodeId={activeDemucsEpisodeId}
                  activeDemucsEpisodeIds={activeDemucsEpisodeIds}
                  completedTtsEpIds={completedTtsEpIds}
                  completedDemucsEpIds={completedDemucsEpIds}
                  runningPipelineEpIds={runningPipelineEpIds}
                  rescanningEpisodeIds={rescanningEpisodeIds}
                  isBatchExecutionActive={isBatchExecutionActive}
                  isEpisodeFullyDone={isEpisodeFullyDone}
                  isGeneratingBatchTTS={isGeneratingBatchTTS}
                  isSeparatingBatchDemucs={isSeparatingBatchDemucs}
                  isRepairBusy={isRepairBusy}
                  isStartingBatch={isStartingBatch}
                  executeBatchTranslateEnqueue={executeBatchTranslateEnqueue}
                  handleKillTranslate={handleKillTranslate}
                  handleKillTTS={handleKillTTS}
                  handleKillDemucs={handleKillDemucs}
                  handleRetryEpisode={handleRetryEpisode}
                  handleRepairBrokenSegments={handleRepairBrokenSegments}
                  handleRescanEpisodeGender={handleRescanEpisodeGender}
                  handleBatchGenerateTTS={handleBatchGenerateTTS}
                  handleBatchDemucsSeparation={handleBatchDemucsSeparation}
                  openStudioDialog={openStudioDialog}
                  onSwitchEpisode={onSwitchEpisode}
                  onTabChange={onTabChange}
                  onRefreshSeries={onRefreshSeries}
                  onClose={onClose}
                />
              ))}
            </div>
          )}
        </div>
        </section>
        </div>

        {/* ── 5. FOOTER STRIP (Darkroom Console) ── */}
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary-panel)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          flexShrink: 0,
        }}>
          <span>
            សរុប {episodes.length} ភាគ ({overallStagePercent}% Ready){unsavedCompletedJobsCount > 0 ? ` • ⚠️ ${unsavedCompletedJobsCount} not saved` : ''} • {isBatchExecutionActive ? '🔒 កំពុងដំណើរការ Batch មិនអាចផ្លាស់ប្តូរការជ្រើសរើសបានទេ' : '💡 ចុចលើ Card ដើម្បី Select ឬ Deselect ភាគ'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            style={{
              minHeight: 32,
              padding: '5px 14px',
              fontSize: 'var(--text-sm)',
            }}
          >
            ត្រឡប់ទៅ Studio
          </button>
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
