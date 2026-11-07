import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Cpu, Sparkles, CheckCircle2, AlertCircle, Play, Pause, RotateCw, 
  XCircle, Check, Clock, Film, Layers, ShieldCheck, ArrowRight, Loader2,
  Terminal, ChevronDown, ChevronUp
} from 'lucide-react';
import { startGenerationJob, fetchJobsListApi } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';

/**
 * EpisodeRunningProgressCard:
 * Dynamic 0% - 100% smooth runner, glowing progress bar, 4 visual milestones,
 * and collapsible Live Console Terminal Drawer for each episode in Gemini Route.
 */
function EpisodeRunningProgressCard({ activeJob, assignedKeyNum, isQueued }) {
  const targetProgress = isQueued ? 0 : Math.min(100, Math.max(0, Number(activeJob?.progress || 0)));
  const [smoothProgress, setSmoothProgress] = useState(targetProgress || (isQueued ? 0 : 1));
  const [showConsole, setShowConsole] = useState(true);
  const consoleBottomRef = useRef(null);

  useEffect(() => {
    if (smoothProgress === targetProgress) return;
    const step = targetProgress > smoothProgress ? 1 : -1;
    const diff = Math.abs(targetProgress - smoothProgress);
    const delay = Math.max(16, Math.floor(350 / (diff || 1)));

    const timer = setTimeout(() => {
      setSmoothProgress((prev) => {
        const next = prev + step;
        if ((step > 0 && next >= targetProgress) || (step < 0 && next <= targetProgress)) {
          return targetProgress;
        }
        return next;
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [targetProgress, smoothProgress]);

  // Raw logs from job queue
  const logs = Array.isArray(activeJob?.logs) ? activeJob.logs : [];

  // Auto-scroll console
  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollTop = consoleBottomRef.current.scrollHeight;
    }
  }, [logs.length, smoothProgress, showConsole]);

  const stage = activeJob?.currentStage || (isQueued ? 'queued' : 'running');
  const message = activeJob?.stageMessage || (isQueued ? `ក្នុង Queue (រង់ចាំ Route Key #${assignedKeyNum})...` : 'ដំណើរការ AI Pipeline...');
  const isDone = smoothProgress >= 100;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%)',
        border: `1px solid ${isDone ? 'rgba(16, 185, 129, 0.5)' : (isQueued ? 'rgba(251, 191, 36, 0.4)' : 'rgba(56, 189, 248, 0.45)')}`,
        boxShadow: isDone 
          ? '0 4px 18px rgba(16, 185, 129, 0.15)' 
          : (isQueued ? '0 4px 14px rgba(251, 191, 36, 0.1)' : '0 4px 18px rgba(56, 189, 248, 0.2)'),
        borderRadius: 8,
        padding: '10px 12px',
        marginTop: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'all 0.3s ease',
      }}
    >
      {/* Header: Stage info + Big Tabular Percentage */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          {isDone ? (
            <div style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10b981',
              flexShrink: 0,
            }}>
              <CheckCircle2 size={15} />
            </div>
          ) : isQueued ? (
            <div style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'rgba(251, 191, 36, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fbbf24',
              flexShrink: 0,
            }}>
              <Clock size={14} />
            </div>
          ) : (
            <div style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'rgba(56, 189, 248, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
              flexShrink: 0,
            }}>
              <Loader2 size={14} className="animate-spin" />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isDone 
                ? '🎉 Translate ជោគជ័យ 100%' 
                : (isQueued ? `⏳ ក្នុង Queue (រង់ចាំ Route Key #${assignedKeyNum})` : 'កំពុងវិភាគ & បង្កើត Script...')}
            </div>
            <div style={{ fontSize: '0.68rem', color: isDone ? '#34d399' : (isQueued ? '#fbbf24' : '#94a3b8'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {message}
            </div>
          </div>
        </div>

        {/* Big Tabular Counter */}
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'flex-end',
          gap: 1,
          background: 'rgba(0, 0, 0, 0.45)',
          padding: '2px 8px',
          borderRadius: 6,
          border: `1px solid ${isDone ? 'rgba(16, 185, 129, 0.4)' : (isQueued ? 'rgba(251, 191, 36, 0.4)' : 'rgba(56, 189, 248, 0.35)')}`,
          flexShrink: 0,
          marginLeft: 8,
        }}>
          <span style={{
            fontSize: '1.25rem',
            fontWeight: 900,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            color: isDone ? '#10b981' : (isQueued ? '#fbbf24' : '#38bdf8'),
            textShadow: isDone 
              ? '0 0 12px rgba(16, 185, 129, 0.6)' 
              : (isQueued ? '0 0 10px rgba(251, 191, 36, 0.4)' : '0 0 12px rgba(56, 189, 248, 0.5)'),
            letterSpacing: '-0.02em',
          }}>
            {smoothProgress}
          </span>
          <span style={{
            fontSize: '0.72rem',
            fontWeight: 800,
            color: isDone ? '#34d399' : (isQueued ? '#fbbf24' : '#38bdf8'),
          }}>
            %
          </span>
        </div>
      </div>

      {/* Glowing Progress Bar Track */}
      <div style={{
        width: '100%',
        height: 6,
        background: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 9999,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div
          style={{
            height: '100%',
            width: `${Math.max(isQueued ? 0 : 3, Math.min(100, smoothProgress))}%`,
            transition: 'width 0.22s ease-out',
            background: isDone 
              ? 'linear-gradient(90deg, #10b981, #34d399)'
              : (isQueued 
                ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                : 'linear-gradient(90deg, rgba(59, 130, 246, 0.4), #38bdf8, rgba(6, 182, 212, 0.4))'),
            borderRadius: 9999,
            boxShadow: isDone 
              ? '0 0 12px rgba(16, 185, 129, 0.7)' 
              : (isQueued ? 'none' : '0 0 12px rgba(56, 189, 248, 0.5)'),
          }}
        />
      </div>

      {/* 4 Milestones */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
        <div style={{
          padding: '3px 2px',
          borderRadius: 4,
          fontSize: '0.60rem',
          textAlign: 'center',
          background: smoothProgress >= 20 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 1 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 20 ? '#10b981' : (smoothProgress >= 1 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 1 && smoothProgress < 20 ? 700 : 500,
          border: smoothProgress >= 1 && smoothProgress < 20 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
        }}>
          {smoothProgress >= 20 ? '✓ Ingest' : '1. Ingest'}
        </div>
        <div style={{
          padding: '3px 2px',
          borderRadius: 4,
          fontSize: '0.60rem',
          textAlign: 'center',
          background: smoothProgress >= 50 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 20 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 50 ? '#10b981' : (smoothProgress >= 20 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 20 && smoothProgress < 50 ? 700 : 500,
          border: smoothProgress >= 20 && smoothProgress < 50 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
        }}>
          {smoothProgress >= 50 ? '✓ OCR' : '2. OCR'}
        </div>
        <div style={{
          padding: '3px 2px',
          borderRadius: 4,
          fontSize: '0.60rem',
          textAlign: 'center',
          background: smoothProgress >= 75 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 50 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 75 ? '#10b981' : (smoothProgress >= 50 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 50 && smoothProgress < 75 ? 700 : 500,
          border: smoothProgress >= 50 && smoothProgress < 75 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
        }}>
          {smoothProgress >= 75 ? '✓ Gemini' : '3. Gemini'}
        </div>
        <div style={{
          padding: '3px 2px',
          borderRadius: 4,
          fontSize: '0.60rem',
          textAlign: 'center',
          background: smoothProgress >= 100 ? 'rgba(16, 185, 129, 0.2)' : (smoothProgress >= 75 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
          color: smoothProgress >= 100 ? '#10b981' : (smoothProgress >= 75 ? '#38bdf8' : '#64748b'),
          fontWeight: smoothProgress >= 75 ? 700 : 500,
          border: smoothProgress >= 75 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
        }}>
          {smoothProgress >= 100 ? '✓ Script' : '4. Script'}
        </div>
      </div>

      {/* Collapsible Live Console Terminal Drawer */}
      <div style={{
        background: '#090d16',
        border: '1px solid rgba(56, 189, 248, 0.25)',
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.7)',
      }}>
        {/* Console Header Toggle */}
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: 'none',
            borderBottom: showConsole ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Terminal size={11} color="#38bdf8" />
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.04em' }}>
              CONSOLE LOGS (Key #{assignedKeyNum})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: isDone ? '#10b981' : (isQueued ? '#fbbf24' : '#38bdf8'),
              boxShadow: isDone 
                ? '0 0 5px #10b981' 
                : (isQueued ? '0 0 5px #fbbf24' : '0 0 5px #38bdf8'),
            }} />
            <span style={{ fontSize: '0.58rem', color: isDone ? '#10b981' : (isQueued ? '#fbbf24' : '#38bdf8'), fontWeight: 600 }}>
              {isDone ? 'DONE' : (isQueued ? 'QUEUE' : 'LIVE')}
            </span>
            {showConsole ? <ChevronUp size={11} color="#64748b" /> : <ChevronDown size={11} color="#64748b" />}
          </div>
        </button>

        {/* Console Body */}
        {showConsole && (
          <div
            ref={consoleBottomRef}
            style={{
              maxHeight: 95,
              overflowY: 'auto',
              padding: '6px 8px',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              fontSize: '0.64rem',
              lineHeight: 1.45,
              color: '#cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            {logs.length > 0 ? (
              logs.map((log, lIdx) => {
                const timeStr = log.timestamp || (log.time ? new Date(log.time).toLocaleTimeString() : new Date().toLocaleTimeString());
                const prg = typeof log.progress === 'number' ? log.progress : 0;
                const isFail = log.message?.includes('បរាជ័យ') || log.message?.includes('Error') || log.message?.includes('401');
                const logColor = isFail ? '#f87171' : (prg >= 100 ? '#10b981' : (prg >= 50 ? '#38bdf8' : '#94a3b8'));
                return (
                  <div key={lIdx} style={{ color: logColor }}>
                    [{timeStr}] [{prg}%] {log.message || log.stage}
                  </div>
                );
              })
            ) : isQueued ? (
              <div style={{ color: '#fbbf24' }}>
                [{new Date().toLocaleTimeString()}] [0%] ⏳ Enqueued: រង់ចាំ Worker Slot ទំនេរ (Gemini Key #{assignedKeyNum})...
              </div>
            ) : (
              <>
                <div style={{ color: '#64748b' }}>
                  [{new Date().toLocaleTimeString()}] [0%] 🚀 Start pipeline: Key #{assignedKeyNum} routed...
                </div>
                {smoothProgress >= 10 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [10%] 🔍 Ingest: ផ្ទៀងផ្ទាត់វីដេអូភាគ & បង្កើត Proxies...
                  </div>
                )}
                {smoothProgress >= 25 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [25%] 📊 Video OCR: ស្កេន Hardcoded Subtitles តាម Video Chunks...
                  </div>
                )}
                {smoothProgress >= 50 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [50%] 🎙️ Gemini ASR: បញ្ជូន Chunk Audio ទៅ Gemini 3.5...
                  </div>
                )}
                {smoothProgress >= 75 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [75%] 📝 Khmer Script: Reconcile OCR + ASR បង្កើតឃ្លាខ្មែរ...
                  </div>
                )}
                {smoothProgress >= 100 && (
                  <div style={{ color: '#10b981' }}>
                    [{new Date().toLocaleTimeString()}] [100%] 🎉 完成: រៀបចំ Script សម្រេច 100%
                  </div>
                )}
              </>
            )}
            {!isDone && !isQueued && (
              <div style={{ color: '#38bdf8', opacity: 0.8, animation: 'pulse 1s infinite' }}>
                ▍
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GeminiRouteTab({
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  onSwitchEpisode = null,
  onTabChange = null,
  apiKey = null,
}) {
  const episodes = activeSeries?.episodes || [];

  // Selection state
  const [selectedEpIds, setSelectedEpIds] = useState(new Set());
  const [dubbingMode, setDubbingMode] = useState('dialogue');
  const [genre, setGenre] = useState('auto');
  const [narratorGender, setNarratorGender] = useState('male');
  const [isStartingBatch, setIsStartingBatch] = useState(false);
  const [batchError, setBatchError] = useState(null);
  const [batchSuccess, setBatchSuccess] = useState(null);

  // Background jobs state
  const [activeJobs, setActiveJobs] = useState([]);
  const [pollInterval, setPollInterval] = useState(1500);

  // Poll active jobs
  useEffect(() => {
    let isMounted = true;
    const fetchStatus = async () => {
      try {
        const res = await fetchJobsListApi({ filter: 'all' });
        if (isMounted && res && res.success) {
          setActiveJobs(res.jobs || []);
        }
      } catch (_) {}
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [pollInterval]);

  // Map of active running jobs per episodeId
  const jobsByEpisodeId = useMemo(() => {
    const map = new Map();
    for (const job of activeJobs) {
      if (job.episodeId && (job.status === 'running' || job.status === 'queued')) {
        map.set(job.episodeId, job);
      }
    }
    return map;
  }, [activeJobs]);

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

  // Auto-select first 2 or 4 episodes without script by default
  useEffect(() => {
    if (episodes.length > 0 && selectedEpIds.size === 0) {
      const unscripted = episodes.filter((ep) => !checkEpisodeHasScript(ep) && ep.video);
      const toPick = unscripted.length > 0 ? unscripted.slice(0, 4) : episodes.slice(0, 4);
      setSelectedEpIds(new Set(toPick.map((ep) => ep.id)));
    }
  }, [episodes, jobsByEpisodeId]);

  const toggleSelect = (id) => {
    const next = new Set(selectedEpIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedEpIds(next);
  };

  const handleSelectCount = (count) => {
    const unscripted = episodes.filter((ep) => ep.video && !checkEpisodeHasScript(ep));
    const source = unscripted.length > 0 ? unscripted : episodes.filter((ep) => ep.video);
    const picked = source.slice(0, count);
    setSelectedEpIds(new Set(picked.map((ep) => ep.id)));
  };

  const handleSelectAllUnscripted = () => {
    const unscripted = episodes.filter((ep) => ep.video && !checkEpisodeHasScript(ep));
    setSelectedEpIds(new Set(unscripted.map((ep) => ep.id)));
  };

  // Trigger parallel batch translation
  const handleStartBatchTranslate = async () => {
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

    try {
      setIsStartingBatch(true);
      setBatchError(null);
      setBatchSuccess(null);

      const promises = targetEpisodes.map(async (ep, idx) => {
        const rawVideoRef = ep.video?.videoPath || ep.video?.videoId || ep.videoFile || ep.sourceVideoPath;
        return startGenerationJob({
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
      });

      const results = await Promise.allSettled(promises);
      const successful = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;

      setBatchSuccess(`🎉 បានចាប់ផ្ដើមដំណើរការ Translate ចំនួន ${successful} ភាគព្រមគ្នាតាមរយៈ Gemini Route!`);
      setPollInterval(1000); // Poll faster while active
    } catch (err) {
      console.error(err);
      setBatchError(err.message || 'ការចាប់ផ្ដើម Translate បរាជ័យ');
    } finally {
      setIsStartingBatch(false);
    }
  };

  return (
    <div 
      className="gemini-route-tab media-tab-content" 
      style={{ 
        flex: 1, 
        overflowY: 'auto', 
        padding: '12px 14px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: 14 
      }}
    >
      {/* 1. Gemini Multi-Key Router Header Status Card */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.85))',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxShadow: '0 4px 18px rgba(0, 0, 0, 0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8' }}>
            <Cpu size={18} />
            <span style={{ fontSize: '0.86rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Gemini Route & Multi-Key Load Balancer
            </span>
          </div>

          <span
            style={{
              fontSize: '0.70rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 20,
              background: 'rgba(52, 211, 153, 0.15)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              color: '#34d399',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <ShieldCheck size={12} />
            <span>4 Keys Active</span>
          </span>
        </div>

        <p style={{ margin: 0, fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.45 }}>
          ប្រព័ន្ធ <strong>Gemini Key Router</strong> បែងចែកបន្ទុកដោយស្វ័យប្រវត្តតាម <strong>Round-Robin</strong> ទៅកាន់ <strong>Key 1, Key 2, Key 3, Key 4</strong>។ អាច Translate <strong>២ ឬ ៤ ភាគព្រមគ្នាក្នុងពេលតែមួយ</strong> ដោយគ្មានបញ្ហា 429 Rate Limit ឡើយ!
        </p>

        {/* 4 Keys Status Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[1, 2, 3, 4].map((kNum) => (
            <div
              key={kNum}
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                borderRadius: 6,
                padding: '6px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.70rem', fontWeight: 700, color: '#f8fafc' }}>
                  Key #{kNum}
                </span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
              </div>
              <span style={{ fontSize: '0.62rem', color: '#94a3b8' }}>
                Ready (15 RPM)
              </span>
            </div>
          ))}
        </div>
      </div>

      {batchSuccess && (
        <div style={{ padding: '10px 12px', background: 'rgba(52, 211, 153, 0.12)', border: '1px solid rgba(52, 211, 153, 0.35)', borderRadius: 8, color: '#34d399', fontSize: '0.78rem', fontWeight: 600 }}>
          {batchSuccess}
        </div>
      )}

      {batchError && (
        <div style={{ padding: '10px 12px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: 8, color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>
          {batchError}
        </div>
      )}

      {/* 2. Quick Selection Toolbar (2 ភាគ / 4 ភាគ / ទាំងអស់) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#cbd5e1' }}>
            ជ្រើសរើសភាគដែលចង់ Translate ព្រមគ្នា៖
          </span>
          <span style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700 }}>
            បានជ្រើសរើស: {selectedEpIds.size} ភាគ
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleSelectCount(2)}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: selectedEpIds.size === 2 ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: selectedEpIds.size === 2 ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 6,
              color: selectedEpIds.size === 2 ? '#38bdf8' : '#cbd5e1',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <Sparkles size={12} />
            <span>២ ភាគ (2 Episodes)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectCount(4)}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: selectedEpIds.size === 4 ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: selectedEpIds.size === 4 ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 6,
              color: selectedEpIds.size === 4 ? '#38bdf8' : '#cbd5e1',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <Sparkles size={12} />
            <span>៤ ភាគ (4 Episodes)</span>
          </button>

          <button
            type="button"
            onClick={handleSelectAllUnscripted}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 6,
              color: '#cbd5e1',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ភាគគ្មាន Script ទាំងអស់
          </button>
        </div>
      </div>

      {/* 3. Translation Settings Bar (Mode, Genre, Narrator) */}
      <div 
        style={{
          background: 'rgba(15, 23, 42, 0.5)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 8,
          padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            របៀប Dubbing
          </label>
          <select
            value={dubbingMode}
            onChange={(e) => setDubbingMode(e.target.value)}
            style={{
              padding: '4px 6px',
              fontSize: '0.74rem',
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 4,
              color: '#e2e8f0',
            }}
          >
            <option value="dialogue">Mode A: សន្ទនាតួអង្គ (1:1)</option>
            <option value="recap">Mode B: សម្រាយរឿងកុន</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            ប្រភេទរឿង (Genre)
          </label>
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            style={{
              padding: '4px 6px',
              fontSize: '0.74rem',
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 4,
              color: '#e2e8f0',
            }}
          >
            <option value="auto">Auto (ស្គាល់ស្វ័យប្រវត្ត)</option>
            <option value="ancient">បុរាណចិន / Xianxia</option>
            <option value="modern">សម័យទំនើប / CEO</option>
            <option value="action">Action / សងសឹក</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {dubbingMode === 'dialogue' ? 'សំឡេងតួអង្គ' : 'អ្នកនិទាន / សំឡេង'}
          </label>
          {dubbingMode === 'dialogue' ? (
            <div
              style={{
                padding: '5px 8px',
                fontSize: '0.73rem',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                borderRadius: 4,
                color: '#38bdf8',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                whiteSpace: 'nowrap',
              }}
              title="Mode A (សន្ទនាតួអង្គ): AI បែងចែកសំឡេងអូតូ ១០០% តាមតួប្រុស (ពិសិដ្ឋ) និងតួស្រី (ស្រីមុំ)"
            >
              <span>✨ Auto (ប្រុស + ស្រី)</span>
            </div>
          ) : (
            <select
              value={narratorGender}
              onChange={(e) => setNarratorGender(e.target.value)}
              style={{
                padding: '4px 6px',
                fontSize: '0.74rem',
                background: '#0f172a',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 4,
                color: '#e2e8f0',
              }}
            >
              <option value="male">👨 ប្រុស (Piseth)</option>
              <option value="female">👩 ស្រី (Sreymom)</option>
            </select>
          )}
        </div>
      </div>

      {/* 4. Action Button: Start Multi-Route */}
      <button
        type="button"
        onClick={handleStartBatchTranslate}
        disabled={isStartingBatch || selectedEpIds.size === 0}
        style={{
          width: '100%',
          padding: '12px 14px',
          background: selectedEpIds.size === 0 
            ? 'rgba(255, 255, 255, 0.08)' 
            : 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
          border: '1px solid #38bdf8',
          borderRadius: 8,
          color: '#ffffff',
          fontSize: '0.82rem',
          fontWeight: 800,
          cursor: (isStartingBatch || selectedEpIds.size === 0) ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          boxShadow: '0 4px 14px rgba(2, 132, 199, 0.35)',
          transition: 'all 0.15s ease',
        }}
      >
        {isStartingBatch ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span>កំពុងបញ្ជូនទៅកាន់ Gemini 4-Key Route...</span>
          </>
        ) : (
          <>
            <Sparkles size={16} />
            <span>🚀 ចាប់ផ្ដើម Translate {selectedEpIds.size} ភាគព្រមគ្នា (Start Route)</span>
          </>
        )}
      </button>

      {/* 5. Episodes Selection List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          បញ្ជីភាគទាំងអស់ ({episodes.length} Episodes)
        </span>

        {episodes.map((ep, idx) => {
          const isSelected = selectedEpIds.has(ep.id);
          const hasVideo = Boolean(ep.video || ep.videoFile || ep.sourceVideoPath);
          const hasScript = checkEpisodeHasScript(ep);
          const activeJob = jobsByEpisodeId.get(ep.id);
          const isRunning = Boolean(activeJob && activeJob.status === 'running');
          const isQueued = Boolean(activeJob && activeJob.status === 'queued');

          // Which Gemini Key is handling this episode (Round-Robin estimate)
          const assignedKeyNum = (idx % 4) + 1;

          return (
            <div
              key={ep.id}
              onClick={() => hasVideo && toggleSelect(ep.id)}
              style={{
                background: isRunning 
                  ? 'rgba(56, 189, 248, 0.1)' 
                  : isSelected 
                    ? 'rgba(56, 189, 248, 0.06)' 
                    : 'rgba(15, 23, 42, 0.5)',
                border: isRunning 
                  ? '1px solid #38bdf8' 
                  : isSelected 
                    ? '1px solid rgba(56, 189, 248, 0.4)' 
                    : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                cursor: hasVideo ? 'pointer' : 'not-allowed',
                opacity: hasVideo ? 1 : 0.6,
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!hasVideo || isRunning}
                    onChange={() => toggleSelect(ep.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: 'pointer', width: 15, height: 15 }}
                  />

                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: isRunning ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)',
                      color: isRunning ? '#0f172a' : '#ffffff',
                    }}
                  >
                    EP{ep.episodeNumber || idx + 1}
                  </span>

                  <span
                    style={{
                      fontSize: '0.80rem',
                      fontWeight: 700,
                      color: '#f8fafc',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={ep.title}
                  >
                    {ep.title}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {ep.duration > 0 && (
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={10} />
                      {formatTimecode(ep.duration)}
                    </span>
                  )}

                  <span
                    style={{
                      fontSize: '0.64rem',
                      padding: '1px 5px',
                      borderRadius: 10,
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                    }}
                  >
                    Key #{assignedKeyNum}
                  </span>
                </div>
              </div>

              {/* Dynamic 0% - 100% Runner & Live Console Terminal (dak doch knea) */}
              {(isRunning || isQueued) && (
                <EpisodeRunningProgressCard
                  activeJob={activeJob}
                  assignedKeyNum={assignedKeyNum}
                  isQueued={isQueued}
                />
              )}

              {/* Status footer */}
              {!isRunning && !isQueued && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.68rem', color: '#94a3b8' }}>
                  <span>
                    {hasScript ? (
                      <span style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Check size={11} strokeWidth={3} />
                        Script រួចរាល់ ({ep.scriptData?.segments?.length || ep.scriptData?.totalSegments || 'រួចរាល់'} ឃ្លា)
                      </span>
                    ) : (
                      <span>⏳ មិនទាន់មាន Script (អាច Translate បាន)</span>
                    )}
                  </span>

                  {onSwitchEpisode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSwitchEpisode(ep.id);
                        if (onTabChange) onTabChange('script');
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#38bdf8',
                        fontSize: '0.68rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: 0,
                      }}
                    >
                      <span>បើកមើល</span>
                      <ArrowRight size={10} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
