import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Cpu, Sparkles, CheckCircle2, AlertCircle, Check, Clock, 
  ArrowRight, Loader2, Terminal, ChevronDown, ChevronUp, X, RefreshCw,
  RotateCcw, FileText, CheckCheck, Activity, Layers, Mic, Volume2
} from 'lucide-react';
import { startGenerationJob, fetchGeminiKeysStatusApi } from '../../services/api';
import { useSharedJobQueue } from '../../context/JobQueueContext';
import { formatTimecode } from '../../utils/formatTime';

// 3 Dedicated Route Progress Runners (Step 1: Translate, Step 2: Khmer TTS, Step 3: Demucs)
import EpisodeTranslateProgressCard from './route-runners/EpisodeTranslateProgressCard';
import EpisodeTtsProgressCard from './route-runners/EpisodeTtsProgressCard';
import EpisodeDemucsProgressCard from './route-runners/EpisodeDemucsProgressCard';

export default function GeminiRouteModal({
  isOpen,
  onClose,
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  onSwitchEpisode = null,
  onTabChange = null,
  onRefreshSeries = null,
  apiKey = null,
}) {
  const episodes = (activeSeries && Array.isArray(activeSeries.episodes)) ? activeSeries.episodes : [];

  // Selection & generation settings
  const [selectedEpIds, setSelectedEpIds] = useState(new Set());
  const [dubbingMode, setDubbingMode] = useState('dialogue');
  const [genre, setGenre] = useState('auto');
  const [narratorGender, setNarratorGender] = useState('male');
  const [isStartingBatch, setIsStartingBatch] = useState(false);
  const [batchError, setBatchError] = useState(null);
  const [batchSuccess, setBatchSuccess] = useState(null);

  // Batch TTS State (Step 2: Generate TTS for 2, 5, or ALL selected episodes simultaneously)
  const [isGeneratingBatchTTS, setIsGeneratingBatchTTS] = useState(false);
  const [activeTtsEpisodeId, setActiveTtsEpisodeId] = useState(null);
  const [activeTtsEpisodeIds, setActiveTtsEpisodeIds] = useState(new Set());
  const [ttsCurrentEpTitle, setTtsCurrentEpTitle] = useState('');
  const [ttsProgressPercent, setTtsProgressPercent] = useState(0);
  const [ttsLiveStats, setTtsLiveStats] = useState({});
  const [completedTtsEpIds, setCompletedTtsEpIds] = useState(new Set());
  const [completedDemucsEpIds, setCompletedDemucsEpIds] = useState(new Set());

  // Initialize completed episodes from series data and server truth
  useEffect(() => {
    if (episodes.length > 0) {
      const alreadyAudioDone = new Set();
      const alreadyDemucsDone = new Set();
      episodes.forEach((ep) => {
        if (ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio) {
          alreadyAudioDone.add(ep.id);
        }
        if (ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone) {
          alreadyDemucsDone.add(ep.id);
        }
      });
      if (alreadyAudioDone.size > 0) {
        setCompletedTtsEpIds((prev) => new Set([...prev, ...alreadyAudioDone]));
      }
      if (alreadyDemucsDone.size > 0) {
        setCompletedDemucsEpIds((prev) => new Set([...prev, ...alreadyDemucsDone]));
      }
    }
  }, [episodes]);

  // Direct server truth sync when modal opens: guarantees completed audio and Demucs BGM are never forgotten after browser reload
  useEffect(() => {
    if (!isOpen) return;
    const targetSeriesId = activeSeries?.id || seriesId;
    if (targetSeriesId) {
      fetch(`/api/series/${targetSeriesId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && Array.isArray(data.series?.episodes)) {
            const serverTtsDone = new Set();
            const serverDemucsDone = new Set();
            data.series.episodes.forEach((ep) => {
              if (ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio) {
                serverTtsDone.add(ep.id);
              }
              if (ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone) {
                serverDemucsDone.add(ep.id);
              }
            });
            if (serverTtsDone.size > 0) {
              setCompletedTtsEpIds((prev) => new Set([...prev, ...serverTtsDone]));
            }
            if (serverDemucsDone.size > 0) {
              setCompletedDemucsEpIds((prev) => new Set([...prev, ...serverDemucsDone]));
            }
          }
        })
        .catch(() => {});
    }
    if (typeof onRefreshSeries === 'function') {
      try { onRefreshSeries(); } catch (_) {}
    }
  }, [isOpen, activeSeries?.id, seriesId, onRefreshSeries]);

  // Batch Demucs State (Step 3: AI Vocal Separation for 2, 5, or ALL selected episodes simultaneously)
  const [isSeparatingBatchDemucs, setIsSeparatingBatchDemucs] = useState(false);
  const [activeDemucsEpisodeId, setActiveDemucsEpisodeId] = useState(null);
  const [activeDemucsEpisodeIds, setActiveDemucsEpisodeIds] = useState(new Set());
  const [demucsLiveStats, setDemucsLiveStats] = useState({});
  const [demucsCurrentEpTitle, setDemucsCurrentEpTitle] = useState('');
  const [demucsProgressPercent, setDemucsProgressPercent] = useState(0);
  const isDemucsCancelledRef = useRef(false);
  const activeTimersRef = useRef(new Set());

  // Cleanup all running polling timers on modal unmount or when modal closes
  useEffect(() => {
    if (!isOpen) {
      activeTimersRef.current.forEach((t) => clearInterval(t));
      activeTimersRef.current.clear();
    }
    return () => {
      activeTimersRef.current.forEach((t) => clearInterval(t));
      activeTimersRef.current.clear();
    };
  }, [isOpen]);

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
  const { jobs: activeJobs = [] } = useSharedJobQueue();

  // Gemini Keys Quota & Rate Limit Health State
  const [keysHealth, setKeysHealth] = useState(null);
  const [isCheckingQuota, setIsCheckingQuota] = useState(false);

  const handleCheckQuota = async () => {
    try {
      setIsCheckingQuota(true);
      const res = await fetchGeminiKeysStatusApi();
      if (res && res.success) {
        setKeysHealth(res);
      }
    } catch (err) {
      console.error('Failed to check keys quota:', err);
    } finally {
      setIsCheckingQuota(false);
    }
  };

  // Run initial quota check when modal opens
  useEffect(() => {
    if (isOpen) {
      handleCheckQuota();
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);



  // Map of latest job per episodeId (tracks running, queued, completed, and failed states)
  const jobsByEpisodeId = useMemo(() => {
    const map = new Map();
    const sorted = [...activeJobs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const job of sorted) {
      if (job.episodeId && !map.has(job.episodeId)) {
        map.set(job.episodeId, job);
      }
    }
    return map;
  }, [activeJobs]);

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
        genre,
        narratorGender,
        seriesGlossary: activeSeries?.glossary,
        apiKey: apiKey || undefined,
      });
      setPollInterval(1000);
    } catch (err) {
      setBatchError(err.message || 'ការ Retry បរាជ័យ');
    }
  };

  // Robust helper: verifies whether an episode already has completed script/segments
  const checkEpisodeHasScript = (ep) => {
    if (!ep) return false;
    const activeJob = jobsByEpisodeId.get(ep.id);
    const isJobCompleted = Boolean(activeJob && activeJob.status === 'completed');
    return Boolean(
      (ep.scriptData?.segments && ep.scriptData.segments.length > 0) ||
      ep.scriptData?.hasScript ||
      (typeof ep.scriptData?.totalSegments === 'number' && ep.scriptData.totalSegments > 0) ||
      ep.status === 'translated' ||
      ep.status === 'voicing' ||
      ep.status === 'completed' ||
      isJobCompleted
    );
  };

  // Robust helper: accurately extracts total segment count from scriptData or completed job
  const getEpisodeSegmentCount = (ep) => {
    if (!ep) return 0;
    const activeJob = jobsByEpisodeId.get(ep.id);
    const count =
      ep.scriptData?.segments?.length ||
      ep.scriptData?.totalSegments ||
      activeJob?.result?.totalSegments ||
      activeJob?.result?.segmentsCount ||
      0;
    return count > 0 ? count : (checkEpisodeHasScript(ep) ? 'រួចរាល់' : 0);
  };

  // Check if an episode is 100% completed across all 3 steps (Translate + Audio TTS + Clean BGM)
  const isEpisodeFullyDone = useCallback((ep) => {
    if (!ep) return false;
    const hasScript = checkEpisodeHasScript(ep);
    const hasAudio = Boolean(ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio || completedTtsEpIds.has(ep.id) || ttsLiveStats[ep.id]?.isDone);
    const hasDemucs = Boolean(ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone || completedDemucsEpIds.has(ep.id) || demucsLiveStats[ep.id]?.isDone);
    return Boolean(hasScript && hasAudio && hasDemucs);
  }, [completedTtsEpIds, ttsLiveStats, completedDemucsEpIds, demucsLiveStats, jobsByEpisodeId]);

  // Episodes that still have pending work (Step 1, Step 2, or Step 3)
  const pendingEpisodes = useMemo(() => {
    return episodes.filter((ep) => {
      const hasVideo = Boolean(ep.video || ep.videoFile || ep.sourceVideoPath);
      return hasVideo && !isEpisodeFullyDone(ep);
    });
  }, [episodes, isEpisodeFullyDone]);

  // Auto-remove 100% completed episodes from selection
  useEffect(() => {
    setSelectedEpIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        const ep = episodes.find((e) => e.id === id);
        if (ep && isEpisodeFullyDone(ep)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [episodes, isEpisodeFullyDone]);

  // Auto-select pending episodes by default on open (skip completed episodes)
  useEffect(() => {
    if (isOpen && episodes.length > 0 && selectedEpIds.size === 0) {
      if (pendingEpisodes.length > 0) {
        const toPick = pendingEpisodes.slice(0, Math.min(4, pendingEpisodes.length));
        setSelectedEpIds(new Set(toPick.map((ep) => ep.id)));
      }
    }
  }, [isOpen, episodes.length, pendingEpisodes]);

  const toggleSelect = (id) => {
    const ep = episodes.find((e) => e.id === id);
    if (ep && isEpisodeFullyDone(ep)) {
      // Completed episodes cannot be selected
      return;
    }
    const next = new Set(selectedEpIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedEpIds(next);
  };

  const handleSelectCount = (count) => {
    const picked = pendingEpisodes.slice(0, count);
    setSelectedEpIds(new Set(picked.map((ep) => ep.id)));
  };

  const handleSelectAllUnscripted = () => {
    const unscripted = pendingEpisodes.filter((ep) => !checkEpisodeHasScript(ep));
    setSelectedEpIds(new Set(unscripted.map((ep) => ep.id)));
  };

  const handleSelectAll = () => {
    setSelectedEpIds(new Set(pendingEpisodes.map((ep) => ep.id)));
  };

  const unscriptedCount = useMemo(() => {
    return episodes.filter((ep) => {
      const hasScript = checkEpisodeHasScript(ep);
      return (ep.video || ep.videoFile || ep.sourceVideoPath) && !hasScript;
    }).length;
  }, [episodes, jobsByEpisodeId]);

  const completedCount = useMemo(() => {
    return episodes.filter((ep) => checkEpisodeHasScript(ep)).length;
  }, [episodes, jobsByEpisodeId]);

  // Total completed audio across all episodes
  const completedAudioCount = useMemo(() => {
    return episodes.filter((ep) => {
      return Boolean(ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio || completedTtsEpIds.has(ep.id) || ttsLiveStats[ep.id]?.isDone);
    }).length;
  }, [episodes, completedTtsEpIds, ttsLiveStats]);

  const unAudioCount = Math.max(0, episodes.length - completedAudioCount);

  // Total completed Demucs (Clean BGM) across all episodes
  const completedDemucsCount = useMemo(() => {
    return episodes.filter((ep) => {
      return Boolean(ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone || completedDemucsEpIds.has(ep.id) || demucsLiveStats[ep.id]?.isDone);
    }).length;
  }, [episodes, completedDemucsEpIds, demucsLiveStats]);

  const unDemucsCount = Math.max(0, episodes.length - completedDemucsCount);

  // Completion flags across the whole series
  const isTranslateAllDone = episodes.length > 0 && completedCount === episodes.length;
  const isAudioAllDone = episodes.length > 0 && completedAudioCount === episodes.length;
  const isDemucsAllDone = episodes.length > 0 && completedDemucsCount === episodes.length;
  const isAll1To3Done = isTranslateAllDone && isAudioAllDone && isDemucsAllDone;
  const is1And2Done = isTranslateAllDone && isAudioAllDone && !isDemucsAllDone;

  // Selected episodes that still need Demucs separation
  const unDemucsSelectedEpisodes = useMemo(() => {
    return episodes.filter((ep) => {
      const isDone = Boolean(ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone || completedDemucsEpIds.has(ep.id) || demucsLiveStats[ep.id]?.isDone);
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
      const isDone = Boolean(ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio || completedTtsEpIds.has(ep.id) || ttsLiveStats[ep.id]?.isDone);
      return selectedEpIds.has(ep.id) && !isDone;
    });
  }, [episodes, selectedEpIds, completedTtsEpIds, ttsLiveStats]);

  const allSelectedAudioCompleted = useMemo(() => {
    if (selectedEpIds.size === 0) return false;
    return unAudioSelectedEpisodes.length === 0;
  }, [selectedEpIds, unAudioSelectedEpisodes]);

  // Trigger parallel batch translation (or safe re-translation)
  const handleStartBatchTranslate = async (forceReTranslate = false) => {
    const targetEpisodes = episodes.filter((ep) => selectedEpIds.has(ep.id));
    if (targetEpisodes.length === 0) {
      alert('សូមជ្រើសរើសភាគដែលចង់ Translate ជាមុនសិន!');
      return;
    }

    const episodesWithoutVideo = targetEpisodes.filter((ep) => !ep.video && !ep.videoFile && !ep.sourceVideoPath);
    if (episodesWithoutVideo.length > 0) {
      alert(`ភាគមួយចំនួនមិនទាន់មានវីដេអូទេ: ${episodesWithoutVideo.map((e) => `EP${e.episodeNumber}`).join(', ')}`);
      return;
    }

    // Check if any selected episode is already completed and user is re-translating
    const isReTranslating = forceReTranslate || unscriptedCount === 0;
    if (isReTranslating) {
      const epNames = targetEpisodes.map((e) => `EP${e.episodeNumber || e.id}`).join(', ');
      const modeLabel = dubbingMode === 'fast_ocr' ? '⚡ Fast OCR (លឿនបំផុត)' : (dubbingMode === 'recap' ? 'Mode B: សម្រាយរឿង' : 'Mode A: សន្ទនា 1:1');
      const confirmed = window.confirm(
        `⚠️ តើអ្នកប្រាកដជាចង់ Re-Translate ឡើងវិញលើភាគ [${epNames}] មែនទេ?\n\n` +
        `• Script ចាស់នឹងត្រូវ Auto-Backup ទុកក្នុង folder backups ដោយស្វ័យប្រវត្ត។\n` +
        `• ដំណើរការនេះនឹងបង្កើត Subtitle & Translation ថ្មីតាម (${modeLabel})។`
      );
      if (!confirmed) return;
    }

    try {
      setIsStartingBatch(true);
      setBatchError(null);
      setBatchSuccess(null);

      const promises = targetEpisodes.map(async (ep) => {
        const rawVideoRef = ep.video?.videoPath || ep.video?.videoId || ep.videoFile || ep.sourceVideoPath;
        return startGenerationJob({
          videoId: rawVideoRef,
          videoPath: ep.video?.videoPath || ep.sourceVideoPath,
          seriesId: activeSeries?.id || seriesId || 'drama_project',
          episodeId: ep.id,
          mode: dubbingMode,
          force: isReTranslating,
          genre,
          narratorGender,
          seriesGlossary: activeSeries?.glossary,
          apiKey: apiKey || undefined,
        });
      });

      const results = await Promise.allSettled(promises);
      const successful = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
      const alreadyDone = results.filter((r) => r.status === 'fulfilled' && r.value?.alreadyCompleted).length;

      if (alreadyDone > 0 && alreadyDone === targetEpisodes.length) {
        setBatchSuccess(`🎉 ភាគដែលបានជ្រើសរើសទាំង ${alreadyDone} គឺបាន Translate រួចរាល់ ១០០% ហើយ មិនចាំបាច់ Translate ឡើងវិញទេ!`);
      } else {
        setBatchSuccess(`🎉 បានចាប់ផ្ដើមដំណើរការ ${isReTranslating ? 'Re-Translate' : 'Translate'} ចំនួន ${successful} ភាគព្រមគ្នាតាមរយៈ Gemini Route!`);
      }
      if (typeof onRefreshSeries === 'function') {
        try {
          await onRefreshSeries();
        } catch (_) {}
      }
      setPollInterval(1000);
    } catch (err) {
      console.error(err);
      setBatchError(err.message || 'ការចាប់ផ្ដើម Translate បរាជ័យ');
    } finally {
      setIsStartingBatch(false);
    }
  };

  // ── Trigger Batch Khmer TTS (Step 3) for Selected Episodes (Skip Already Completed) ──
  const handleBatchGenerateTTS = async () => {
    const targetEpisodes = episodes.filter((ep) => selectedEpIds.has(ep.id));
    if (targetEpisodes.length === 0) {
      alert('សូមជ្រើសរើសភាគដែលចង់បង្កើតសំឡេង AI ជាមុនសិន!');
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

    // Filter to only episodes that actually need audio generation (Skip already done)
    const pendingEpisodes = targetEpisodes.filter((localEp) => {
      const serverEp = freshServerEpisodes.find((fe) => String(fe.id) === String(localEp.id));
      const isDone = Boolean(
        serverEp?.audioGenerated ||
        serverEp?.fullAudioUrl ||
        serverEp?.hasAudio ||
        localEp.audioGenerated ||
        localEp.fullAudioUrl ||
        localEp.hasAudio ||
        completedTtsEpIds.has(localEp.id) ||
        ttsLiveStats[localEp.id]?.isDone
      );
      if (isDone) {
        setCompletedTtsEpIds((prev) => new Set([...prev, localEp.id]));
      }
      return !isDone;
    });

    if (pendingEpisodes.length === 0) {
      setBatchSuccess(`🎉 គ្រប់ភាគដែលបានជ្រើសរើស (${targetEpisodes.length} ភាគ) គឺបានបង្កើតសំឡេង AI រួចរាល់ ១០០% ហើយ មិនបាច់បង្កើតឡើងវិញទេ!`);
      return;
    }

    try {
      setIsGeneratingBatchTTS(true);
      setBatchError(null);
      setBatchSuccess(null);
      setTtsProgressPercent(1);

      // Trigger ALL pending episodes simultaneously in parallel (100% Like Step 1)
      const allPendingIds = new Set(pendingEpisodes.map((e) => e.id));
      setActiveTtsEpisodeIds(allPendingIds);
      setActiveTtsEpisodeId(pendingEpisodes[0]?.id || null);
      setTtsCurrentEpTitle(`គ្រប់ភាគ (${pendingEpisodes.length} ភាគ) កំពុងដំណើរការព្រមគ្នា...`);

      let newlyCompletedCount = 0;

      const ttsPromises = pendingEpisodes.map(async (ep, idx) => {
        const serverEp = freshServerEpisodes.find((fe) => String(fe.id) === String(ep.id)) || ep;

        // Skip immediately if server shows audio was already generated
        if (serverEp.audioGenerated || serverEp.fullAudioUrl || serverEp.hasAudio || completedTtsEpIds.has(ep.id)) {
          console.log(`[Batch TTS] Episode ${ep.id} already has completed narration on disk. Skipping.`);
          setCompletedTtsEpIds((prev) => new Set([...prev, ep.id]));
          setActiveTtsEpisodeIds((prev) => {
            const next = new Set(prev);
            next.delete(ep.id);
            return next;
          });
          return;
        }

        // Ensure we have full script segments for this episode
        let segs = ep.scriptData?.segments || [];
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

        const totalExpectedSegs = segs.length;
        const initialLog = {
          time: new Date().toLocaleTimeString(),
          progress: 0,
          message: `🎙️ ចាប់ផ្ដើមដំណើរការបង្កើតសំឡេងខ្មែរ AI (${totalExpectedSegs} ឃ្លា) តាមរយៈ km-KH-PisethNeural...`,
        };
        setTtsLiveStats((prev) => ({
          ...prev,
          [ep.id]: { current: 0, total: totalExpectedSegs, percent: 0, isDone: false, logs: [initialLog] },
        }));

        // Start live polling of generated audio segments with zero-blocking interval (1200ms)
        const targetSeriesId = activeSeries?.id || seriesId;
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

        // Build speakerMap if available
        const speakerMap = {};
        Object.values(ep.speakerRegistry || activeSeries?.glossary?.characters || {}).forEach((spk) => {
          if (spk.voiceId) {
            speakerMap[spk.id || spk.name] = spk.voiceId;
            speakerMap[spk.name] = spk.voiceId;
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
              voiceId: 'km-KH-PisethNeural',
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
            setTtsLiveStats((prev) => {
              const currentLogs = [...(prev[ep.id]?.logs || [])];
              currentLogs.push({
                time: new Date().toLocaleTimeString(),
                progress: 100,
                message: `🎉 សំឡេងខ្មែរ AI និង Master Narration សម្រេចជោគជ័យ ១០០%!`,
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
      alert('សូមជ្រើសរើសភាគដែលចង់បំបែកសំឡេង Demucs AI ជាមុនសិន!');
      return;
    }

    // Filter only episodes that actually need Demucs separation
    const episodesToProcess = targetEpisodes.filter((ep) => {
      const isDone = Boolean(ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone || completedDemucsEpIds.has(ep.id));
      return !isDone;
    });

    if (episodesToProcess.length === 0) {
      alert('🎉 ភាគដែលបានជ្រើសរើសទាំងអស់ មានសំឡេង Clean BGM រួចរាល់អស់ហើយ!');
      return;
    }

    const episodesWithVideo = episodesToProcess.filter((ep) => ep.video?.videoPath || ep.video?.videoId || ep.videoFile || ep.sourceVideoPath);
    if (episodesWithVideo.length === 0) {
      alert('ភាគដែលបានជ្រើសរើសមិនទាន់មានវីដេអូសម្រាប់បំបែកសំឡេងទេ!');
      return;
    }

    try {
      setIsSeparatingBatchDemucs(true);
      setBatchError(null);
      setBatchSuccess(null);
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
          [ep.id]: { percent: 5, isDone: false, logs: [initialLog], message: 'AI Deep Learning Stem Separation...' },
        }));

        // Controlled polling loop at 2500ms with in-flight request lock
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
              const dPct = Math.max(5, dpData.progress);
              setDemucsLiveStats((prev) => {
                const prevD = prev[ep.id] || { logs: [] };
                const curLogs = [...(prevD.logs || [])];
                if (dpData.message && !curLogs.some((l) => l.message === dpData.message)) {
                  curLogs.push({
                    time: new Date().toLocaleTimeString(),
                    progress: dPct,
                    message: dpData.message,
                  });
                }
                return {
                  ...prev,
                  [ep.id]: {
                    percent: dPct,
                    isDone: dpData.status === 'completed' || dPct >= 100,
                    message: dpData.message || 'Demucs Stem Separation...',
                    logs: curLogs.slice(-30),
                  },
                };
              });
            }
          } catch (_) {}
          finally {
            isPolling = false;
          }
        }, 2500);
        activeTimersRef.current.add(demucsPollTimer);

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
          clearInterval(demucsPollTimer);
          if (isDemucsCancelledRef.current) {
            break;
          }
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.success) {
            separatedCount++;
            ep.bgmAudioUrl = data.noVocalsUrl;
            ep.cleanBgmPath = data.noVocalsPath;
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
            console.error(`[Batch Demucs] Failed for ${ep.id}:`, data.error);
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
                    message: `❌ បរាជ័យក្នុងការបំបែកសំឡេង: ${data.error || 'Server error'}`,
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
  };

  return (
    <div 
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
        {/* ── 1. MODAL HEADER (Tavola Midnight Navy & Coral Accent) ── */}
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
                  GEMINI BATCH & KEYS CONSOLE
                </h2>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  padding: '3px 10px',
                  borderRadius: 9999,
                  background: 'rgba(52, 211, 153, 0.12)',
                  color: '#34D399',
                  border: '1px solid rgba(52, 211, 153, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 0 12px rgba(52, 211, 153, 0.2)',
                }}>
                  <span style={{ 
                    width: 6, 
                    height: 6, 
                    borderRadius: '50%', 
                    background: '#34D399', 
                    display: 'inline-block',
                    boxShadow: '0 0 6px #34D399',
                  }} />
                  4 Keys Active (60 RPM Pool)
                </span>
              </div>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.74rem', color: '#94A3B8' }}>
                បែងចែកបន្ទុកតាម Round-Robin ទៅកាន់ Key 1, 2, 3, 4 — Translate ២, ៤ ឬ គ្រប់ភាគព្រមគ្នាដោយគ្មាន Rate Limit!
              </p>
            </div>
          </div>

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

        {/* ── 2. TOP CONTROL CENTER (GetLayers 4-Tier Depth) ── */}
        <div style={{
          padding: '14px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(16, 25, 44, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flexShrink: 0,
        }}>
          {/* Key Monitor Header + Test Quota Button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Multi-Key Pool Status
              </span>
              <span style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                color: (keysHealth?.activeCount ?? 4) > 0 ? '#34D399' : '#FBBF24',
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '2px 9px',
                borderRadius: 9999,
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}>
                {isCheckingQuota
                  ? '🔄 កំពុងពិនិត្យ Keys...'
                  : keysHealth
                  ? `${keysHealth.activeCount}/${keysHealth.totalKeys} keys online • ${keysHealth.totalRPM} RPM pool`
                  : '4/4 keys online • 60 RPM pool'}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCheckQuota}
              disabled={isCheckingQuota}
              className="btn-tactile"
              style={{
                background: isCheckingQuota ? 'rgba(56, 189, 248, 0.15)' : 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: '#38BDF8',
                borderRadius: 9999,
                padding: '5px 14px',
                fontSize: '0.72rem',
                fontWeight: 800,
                cursor: isCheckingQuota ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                if (!isCheckingQuota) {
                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)';
                  e.currentTarget.style.boxShadow = '0 0 14px rgba(56, 189, 248, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isCheckingQuota) {
                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.25)';
                }
              }}
              title="ពិនិត្យ Rate Limit & Quota លើ Gemini Keys ទាំងអស់"
            >
              <RefreshCw size={13} className={isCheckingQuota ? 'animate-spin' : ''} />
              <span>{isCheckingQuota ? 'កំពុងពិនិត្យ Quota...' : '⚡ ពិនិត្យ Quota Keys'}</span>
            </button>
          </div>

          {/* Key Monitor Strip with Multi-Color Pool Accents & Real-time Quota Detection */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[1, 2, 3, 4].map((kNum) => {
              const theme = KEY_THEMES[kNum] || KEY_THEMES[1];
              const liveKeyData = keysHealth?.keys?.find((k) => k.keyNum === kNum);
              const isRateLimited = !isCheckingQuota && liveKeyData?.status === 'rate_limited';
              const isInvalid = !isCheckingQuota && liveKeyData?.status === 'invalid';
              const isError = !isCheckingQuota && liveKeyData?.status === 'error';
              
              let badgeText = '15 RPM Ready';
              if (isCheckingQuota) {
                badgeText = 'កំពុងពិនិត្យ...';
              } else if (liveKeyData?.badge) {
                badgeText = liveKeyData.badge;
              }

              const badgeColor = isCheckingQuota ? '#38BDF8' : isRateLimited ? '#FBBF24' : (isInvalid || isError) ? '#F87171' : theme.color;
              const badgeBg = isCheckingQuota ? 'rgba(56, 189, 248, 0.15)' : isRateLimited ? 'rgba(251, 191, 36, 0.15)' : (isInvalid || isError) ? 'rgba(248, 113, 113, 0.15)' : theme.bg;
              const badgeBorder = isCheckingQuota ? 'rgba(56, 189, 248, 0.4)' : isRateLimited ? 'rgba(251, 191, 36, 0.4)' : (isInvalid || isError) ? 'rgba(248, 113, 113, 0.4)' : theme.border;
              const dotColor = isCheckingQuota ? '#38BDF8' : isRateLimited ? '#FBBF24' : (isInvalid || isError) ? '#F87171' : theme.dot;

              return (
                <div 
                  key={kNum}
                  style={{
                    background: 'rgba(25, 39, 68, 0.7)',
                    border: `1px solid ${isRateLimited ? 'rgba(251, 191, 36, 0.5)' : (isInvalid || isError) ? 'rgba(248, 113, 113, 0.5)' : theme.border}`,
                    borderRadius: 12,
                    padding: '9px 13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: isRateLimited 
                      ? '0 0 12px rgba(251, 191, 36, 0.25)' 
                      : (isInvalid || isError) ? '0 0 12px rgba(248, 113, 113, 0.25)' : '0 2px 10px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ 
                      width: 8, 
                      height: 8, 
                      borderRadius: '50%', 
                      background: dotColor, 
                      boxShadow: `0 0 8px ${dotColor}` 
                    }} />
                    <span style={{ fontSize: '0.80rem', fontWeight: 800, color: '#F8FAFC' }}>Key #{kNum}</span>
                    {liveKeyData?.masked && (
                      <code style={{ 
                        fontSize: '0.62rem', 
                        background: 'rgba(0, 0, 0, 0.35)', 
                        color: '#94A3B8', 
                        padding: '1px 6px', 
                        borderRadius: 4, 
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" 
                      }}>
                        {liveKeyData.masked}
                      </code>
                    )}
                  </div>
                  <span style={{
                    fontSize: '0.66rem',
                    fontWeight: 800,
                    color: badgeColor,
                    background: badgeBg,
                    border: `1px solid ${badgeBorder}`,
                    padding: '3px 8px',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    {isCheckingQuota ? <Loader2 size={10} className="animate-spin" /> : isRateLimited ? '⏳ ' : (isInvalid || isError) ? '❌ ' : '✓ '}
                    {badgeText}
                  </span>
                </div>
              );
            })}
          </div>

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
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: (selectedEpIds.size === 2 || (pendingEpisodes.length < 2 && selectedEpIds.size === pendingEpisodes.length && selectedEpIds.size > 0)) ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  border: selectedEpIds.size === 2 ? '1px solid #38BDF8' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: selectedEpIds.size === 2 ? '#38BDF8' : '#CBD5E1',
                  boxShadow: selectedEpIds.size === 2 ? '0 0 14px rgba(56, 189, 248, 0.25)' : 'none',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                  opacity: pendingEpisodes.length === 0 ? 0.5 : 1,
                  cursor: pendingEpisodes.length === 0 ? 'not-allowed' : 'pointer',
                }}
                disabled={pendingEpisodes.length === 0}
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
                  opacity: pendingEpisodes.length === 0 ? 0.5 : 1,
                  cursor: pendingEpisodes.length === 0 ? 'not-allowed' : 'pointer',
                }}
                disabled={pendingEpisodes.length === 0}
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
                title={pendingEpisodes.length === 0 ? 'គ្រប់ភាគទាំងអស់រួចរាល់ ១០០% ហើយ' : 'ជ្រើសរើសភាគដែលនៅសល់'}
              >
                <Sparkles size={12} />
                <span>{pendingEpisodes.length === 0 ? '✓ គ្រប់ភាគរួចរាល់ ១០០%' : `ភាគនៅសល់ (${pendingEpisodes.length} ភាគ)`}</span>
              </button>
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
            {/* ── 1. TRANSLATE ACTION (Step 2 - Subtitle & Translation / Re-Translate) ── */}
            <button
              type="button"
              onClick={() => handleStartBatchTranslate(unscriptedCount === 0)}
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
                  : (unscriptedCount === 0)
                  ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.3) 100%)'
                  : 'linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4338ca 100%)',
                border: (selectedEpIds.size === 0)
                  ? '1px solid rgba(255, 255, 255, 0.08)'
                  : (unscriptedCount === 0)
                  ? '1px solid rgba(245, 158, 11, 0.5)'
                  : '1px solid #38bdf8',
                color: (selectedEpIds.size === 0) ? '#64748B' : (unscriptedCount === 0 ? '#FBBF24' : '#ffffff'),
                fontWeight: 800,
                cursor: (isStartingBatch || selectedEpIds.size === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                boxShadow: (selectedEpIds.size > 0 && !isStartingBatch)
                  ? (unscriptedCount === 0 ? '0 4px 18px rgba(245, 158, 11, 0.25)' : '0 6px 20px rgba(2, 132, 199, 0.4)')
                  : 'none',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textAlign: 'left' }}>
                <div style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: (unscriptedCount === 0) ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {isStartingBatch ? (
                    <Loader2 size={17} className="animate-spin" color="#38bdf8" />
                  ) : unscriptedCount === 0 ? (
                    <RotateCcw size={17} color="#FBBF24" />
                  ) : (
                    <Sparkles size={17} color="#ffffff" />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isStartingBatch
                      ? 'កំពុងបញ្ជូន Translate...'
                      : (unscriptedCount === 0 && selectedEpIds.size > 0)
                      ? `🔄 Re-Translate ${selectedEpIds.size} ភាគ`
                      : unscriptedCount === 0
                      ? '✓ គ្រប់ភាគ Translate រួចរាល់ ១០០%'
                      : `🚀 Translate ${selectedEpIds.size} ភាគ`}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: (unscriptedCount === 0) ? '#FCD34D' : 'rgba(255, 255, 255, 0.8)', whiteSpace: 'nowrap' }}>
                    {unscriptedCount === 0 && selectedEpIds.size > 0
                      ? (dubbingMode === 'fast_ocr' ? '⚡ Fast OCR (Bypass Whisper)' : 'ចុចដើម្បី Translate ឡើងវិញ')
                      : unscriptedCount === 0
                      ? `គ្រប់ភាគ (${episodes.length}/${episodes.length}) មាន Script ពេញលេញ`
                      : (dubbingMode === 'fast_ocr' ? '⚡ Fast Subtitle OCR (3-5x Faster)' : 'Gemini Multi-Key Route')}
                  </div>
                </div>
              </div>
              <span style={{
                fontSize: '0.64rem',
                fontWeight: 900,
                background: (unscriptedCount === 0) ? 'rgba(245, 158, 11, 0.25)' : 'rgba(0, 0, 0, 0.35)',
                color: (unscriptedCount === 0) ? '#FBBF24' : '#38bdf8',
                padding: '2px 8px',
                borderRadius: 9999,
                border: (unscriptedCount === 0) ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(56, 189, 248, 0.3)',
                flexShrink: 0,
                letterSpacing: '0.04em',
              }}>
                {unscriptedCount === 0 && selectedEpIds.size > 1 ? 'RE-RUN BATCH' : unscriptedCount === 0 ? 'DONE' : 'STEP 2'}
              </span>
            </button>

            {/* ── 2. KHMER AI VOICE ACTION (Step 3 - TTS Synthesis / Tavola Coral) ── */}
            <button
              type="button"
              onClick={handleBatchGenerateTTS}
              disabled={isGeneratingBatchTTS || isSeparatingBatchDemucs || isStartingBatch || selectedEpIds.size === 0}
              className="btn-tactile"
              style={{
                position: 'relative',
                overflow: 'hidden',
                padding: '11px 16px',
                borderRadius: 14,
                background: isGeneratingBatchTTS
                  ? 'linear-gradient(135deg, #182236 0%, #1e293b 100%)'
                  : allSelectedAudioCompleted
                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(5, 150, 105, 0.22) 100%)'
                  : (selectedEpIds.size === 0)
                  ? 'rgba(255, 133, 119, 0.1)'
                  : 'linear-gradient(135deg, #FF8577 0%, #f43f5e 100%)',
                border: isGeneratingBatchTTS
                  ? '1px solid rgba(255, 133, 119, 0.7)'
                  : allSelectedAudioCompleted
                  ? '1px solid rgba(16, 185, 129, 0.5)'
                  : (selectedEpIds.size === 0)
                  ? '1px solid rgba(255, 133, 119, 0.2)'
                  : '1px solid #FF8577',
                color: isGeneratingBatchTTS ? '#FF8577' : allSelectedAudioCompleted ? '#34d399' : '#0B132B',
                fontWeight: 800,
                cursor: (isGeneratingBatchTTS || isSeparatingBatchDemucs || isStartingBatch || selectedEpIds.size === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                boxShadow: (isGeneratingBatchTTS)
                  ? '0 0 20px rgba(255, 133, 119, 0.3)'
                  : allSelectedAudioCompleted
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
                    : allSelectedAudioCompleted
                    ? 'rgba(16, 185, 129, 0.25)'
                    : 'rgba(11, 19, 43, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {isGeneratingBatchTTS ? (
                    <Loader2 size={17} className="animate-spin" color="#FF8577" />
                  ) : allSelectedAudioCompleted ? (
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
                    color: isGeneratingBatchTTS ? '#f8fafc' : allSelectedAudioCompleted ? '#34d399' : '#0B132B',
                  }}>
                    {isGeneratingBatchTTS
                      ? `🎙️ កំពុង TTS: ${ttsCurrentEpTitle}`
                      : allSelectedAudioCompleted
                      ? '✓ សំឡេងខ្មែរ AI រួចរាល់ ១០០%'
                      : `🎙️ បង្កើតសំឡេងខ្មែរ AI (${unAudioSelectedEpisodes.length} ភាគនៅសល់)`}
                  </div>
                  <div style={{
                    fontSize: '0.68rem',
                    color: isGeneratingBatchTTS
                      ? '#fca5a5'
                      : allSelectedAudioCompleted
                      ? '#6ee7b7'
                      : 'rgba(11, 19, 43, 0.85)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: 700,
                  }}>
                    {isGeneratingBatchTTS
                      ? `${ttsLiveStats[activeTtsEpisodeId]?.current || 0}/${ttsLiveStats[activeTtsEpisodeId]?.total || '...'} ឃ្លា (${ttsLiveStats[activeTtsEpisodeId]?.percent || 0}%) • សរុប ${ttsProgressPercent}%`
                      : allSelectedAudioCompleted
                      ? `គ្រប់ភាគ (${selectedEpIds.size} ភាគ) មានសំឡេង Master ពេញលេញ`
                      : 'រំលងភាគដែលធ្វើរួច • Edge-TTS'}
                  </div>
                </div>
              </div>
              <span style={{
                fontSize: '0.64rem',
                fontWeight: 900,
                background: isGeneratingBatchTTS
                  ? 'rgba(255, 133, 119, 0.25)'
                  : allSelectedAudioCompleted
                  ? 'rgba(16, 185, 129, 0.25)'
                  : 'rgba(11, 19, 43, 0.15)',
                color: isGeneratingBatchTTS ? '#FF8577' : allSelectedAudioCompleted ? '#34d399' : '#0B132B',
                padding: '2px 8px',
                borderRadius: 9999,
                border: isGeneratingBatchTTS
                  ? '1px solid rgba(255, 133, 119, 0.4)'
                  : allSelectedAudioCompleted
                  ? '1px solid rgba(16, 185, 129, 0.35)'
                  : '1px solid rgba(11, 19, 43, 0.25)',
                flexShrink: 0,
                letterSpacing: '0.04em',
              }}>
                {isGeneratingBatchTTS ? `${ttsProgressPercent}%` : allSelectedAudioCompleted ? 'DONE' : 'STEP 3'}
              </span>
            </button>

            {/* ── 3. DEMUCS VOCAL SEPARATION ACTION (Step 3 - AI Clean BGM) ── */}
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
                      ? '✓ Demucs AI Clean BGM រួចរាល់ ១០០%'
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
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('តើអ្នកពិតជាចង់បញ្ឈប់ (Kill) ដំណើរការបំបែកសំឡេង Demucs ទាំងអស់មែនទេ?')) {
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

        {/* ── 3. BATCH NOTIFICATIONS ── */}
        {batchSuccess && (
          <div style={{
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
          }}>
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
          <div style={{
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
          }}>
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
          flex: 1,
          overflowY: 'auto',
          padding: '16px 22px',
        }}>
          {episodes.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
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
                const assignedKeyNum = (idx % 4) + 1;
                const keyTheme = KEY_THEMES[assignedKeyNum] || KEY_THEMES[1];
                const segmentCount = getEpisodeSegmentCount(ep);
                const isFullyDone = isEpisodeFullyDone(ep);

                return (
                  <div
                    key={ep.id}
                    onClick={() => !isFullyDone && hasVideo && toggleSelect(ep.id)}
                    className={isFullyDone ? '' : 'motion-lift'}
                    style={{
                      borderRadius: 16,
                      border: isRunning
                        ? '1px solid #38BDF8'
                        : isFailed
                        ? '1px solid rgba(248, 113, 113, 0.65)'
                        : isFullyDone
                        ? '1px solid rgba(52, 211, 153, 0.45)'
                        : isSelected
                        ? '1px solid #FF8577'
                        : hasScript
                        ? '1px solid rgba(52, 211, 153, 0.35)'
                        : '1px solid rgba(255, 255, 255, 0.07)',
                      background: isRunning
                        ? 'rgba(56, 189, 248, 0.12)'
                        : isFailed
                        ? 'rgba(248, 113, 113, 0.08)'
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
                      cursor: isFullyDone ? 'default' : hasVideo ? 'pointer' : 'not-allowed',
                      opacity: hasVideo ? 1 : 0.6,
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: isRunning 
                        ? '0 0 25px rgba(56, 189, 248, 0.25)' 
                        : isFailed
                        ? '0 0 20px rgba(248, 113, 113, 0.2)'
                        : isFullyDone
                        ? '0 4px 14px rgba(16, 185, 129, 0.12)'
                        : isSelected
                        ? '0 10px 28px rgba(0, 0, 0, 0.45), 0 0 16px rgba(255, 133, 119, 0.22)'
                        : '0 4px 14px rgba(0, 0, 0, 0.25)',
                    }}
                  >
                    {/* Card Header */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                          {isFullyDone ? (
                            <div
                              title="ភាគនេះរួចរាល់ ១០០% (Translate, Voice AI, Clean BGM) - ពេញលេញគ្រប់ដំណាក់កាល"
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 5,
                                background: 'rgba(52, 211, 153, 0.22)',
                                border: '1.5px solid #34D399',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#34D399',
                                boxShadow: '0 0 8px rgba(52, 211, 153, 0.35)',
                                flexShrink: 0,
                                cursor: 'default',
                              }}
                            >
                              <Check size={12} strokeWidth={3.5} />
                            </div>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!hasVideo || isRunning}
                              onChange={() => toggleSelect(ep.id)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#FF8577' }}
                            />
                          )}
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
                        />
                      )}

                      {/* Step 2: Dynamic Progress Runner & Live Console Terminal for Khmer TTS */}
                      {isGeneratingBatchTTS && (activeTtsEpisodeIds.has(ep.id) || activeTtsEpisodeId === ep.id) && (
                        <EpisodeTtsProgressCard
                          liveStats={ttsLiveStats[ep.id]}
                          ep={ep}
                        />
                      )}

                      {/* Step 3: Dynamic Progress Runner & Live Console Terminal for Demucs AI Clean BGM */}
                      {isSeparatingBatchDemucs && (activeDemucsEpisodeIds.has(ep.id) || activeDemucsEpisodeId === ep.id) && (
                        <EpisodeDemucsProgressCard
                          liveStats={demucsLiveStats[ep.id]}
                          ep={ep}
                          onKill={handleKillDemucs}
                        />
                      )}

                      {/* Completed State Banner */}
                      {hasScript && !isRunning && !isQueued && !isFailed && !(isGeneratingBatchTTS && (activeTtsEpisodeIds.has(ep.id) || activeTtsEpisodeId === ep.id)) && !(isSeparatingBatchDemucs && (activeDemucsEpisodeIds.has(ep.id) || activeDemucsEpisodeId === ep.id)) && (() => {
                        const isAudioReady = Boolean(completedTtsEpIds.has(ep.id) || ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio || ttsLiveStats[ep.id]?.isDone);
                        const isDemucsReady = Boolean(completedDemucsEpIds.has(ep.id) || ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone || demucsLiveStats[ep.id]?.isDone);

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
                                សំឡេងនិយាយខ្មែរ និងតន្ត្រី Clean BGM/SFX រួចរាល់ ១០០% អាច Export ឬ Dubbing បានភ្លាមៗ!
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
                                Chinese OCR + ASR Reconciled + Khmer Speech Synthesized! (ចុច Step 3 ដើម្បីបំបែក Clean BGM)
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
                              border: '1px solid rgba(56, 189, 248, 0.35)',
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
                              <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
                                សំឡេងតន្ត្រី Clean BGM បានបំបែករួចរាល់ — រង់ចាំបង្កើតសំឡេងខ្មែរ AI (Step 2)
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div style={{
                            marginTop: 6,
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: 'rgba(56, 189, 248, 0.08)',
                            border: '1px solid rgba(56, 189, 248, 0.28)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <CheckCircle2 size={14} color="#38BDF8" />
                                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#38BDF8' }}>
                                  Script 100% រួចរាល់ {typeof segmentCount === 'number' && segmentCount > 0 ? `(${segmentCount} ឃ្លា)` : ''}
                                </span>
                              </div>
                              {ep.scriptData?.generationMode === 'fast_ocr' && (
                                <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#FBBF24', background: 'rgba(251, 191, 36, 0.15)', padding: '1px 6px', borderRadius: 4, border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                                  ⚡ Fast OCR
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
                              {ep.scriptData?.generationMode === 'fast_ocr'
                                ? '⚡ Subtitle ចិនត្រូវបានស្រង់លើអេក្រង់ & បកប្រែភាសាខ្មែរសម្រេច (Bypass Whisper)។'
                                : 'Chinese OCR + ASR Reconciled ភ្ជាប់ជាភាសាខ្មែរសម្រេច។'}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Idle State Banner (Unscripted) */}
                      {!hasScript && !isRunning && !isQueued && !isFailed && (
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
                          ) : (Boolean(completedTtsEpIds.has(ep.id) || ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio || ttsLiveStats[ep.id]?.isDone) || Boolean(completedDemucsEpIds.has(ep.id) || ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone || demucsLiveStats[ep.id]?.isDone)) ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {Boolean(completedTtsEpIds.has(ep.id) || ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio || ttsLiveStats[ep.id]?.isDone) && (
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
                              {Boolean(completedDemucsEpIds.has(ep.id) || ep.bgmAudioUrl || ep.cleanBgmPath || ep.hasDemucs || ep.isDemucsDone || demucsLiveStats[ep.id]?.isDone) && (
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
                              <span>{typeof segmentCount === 'number' && segmentCount > 0 ? `${segmentCount} ឃ្លាខ្មែរ` : 'Script រួចរាល់'}</span>
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
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
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
                {completedCount}/{episodes.length}
              </strong>
              <span style={{ fontSize: '0.68rem', color: isTranslateAllDone ? '#34D399' : '#FBBF24', fontWeight: 700 }}>
                ({isTranslateAllDone ? '✓ រួចរាល់ ១០០%' : `នៅសល់ ${unscriptedCount}`})
              </span>
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
                ({isAudioAllDone ? '✓ រួចរាល់ ១០០%' : `នៅសល់ ${unAudioCount} ភាគ`})
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
                ({isDemucsAllDone ? '✓ រួចរាល់ ១០០%' : `នៅសល់ ${unDemucsCount}`})
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
                🎉 ដំណាក់កាល ១-៣ ធ្វើរួចរាល់ ១០០% (ALL READY)!
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
    </div>
  );
}
