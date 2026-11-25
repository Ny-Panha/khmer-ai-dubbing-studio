import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles, BookOpen, Loader2, AlertCircle, ArrowRight, CheckCircle2, Mic, Volume2, Film, RefreshCw, ChevronDown, Settings2, FileText, Check, Terminal, Zap, Layers, MessageSquare, Crown, Briefcase, UserCheck, Building2, Smile, X
} from 'lucide-react';
import { importSubtitlesApi, retranslateAllSegmentsApi } from '../../services/api';
import { DubbingStepButton } from '../../features/dubbing-runner';
import {
  GENRE_OPTIONS,
  SMART_PROMPT_CHIPS,
  normalizeGenre,
  togglePreset,
  handleGenreChange,
  composeEffectivePrompt,
  parseDirectionPrompt,
} from '../../utils/dramaGenrePresets';

/**
 * Smart Direction Presets & Drama Genre Options (imported from dramaGenrePresets.js)
 * Preserves user options:
 * - 🎭 ស្គាល់ភេទតាមមុខតួអង្គ (Auto Face Gender)
 * - 👑 រាជស័ព្ទបុរាណចិន (Royal/Xianxia)
 * - 💼 សន្ទនាអគ្គនាយក (Modern CEO)
 * - ⚡ ឃ្លាខ្លីត្រូវមាត់ 100% (Strict Lip-Sync)
 */

export default function DubbingModeTab({
  selectedVideo,
  dubbingMode,
  setDubbingMode,
  recapStyle,
  setRecapStyle,
  RECAP_PRESETS,
  promptInput,
  setPromptInput,
  handleTriggerScript,
  isGeneratingScript,
  generatingEpisodeId = null,
  scriptProgress = 0,
  scriptStage = '',
  scriptLogs = [],
  scriptError,
  scriptData,
  onTabChange,
  onNavigateToVoice,
  isGeneratingAudio = false,
  generatingAudioEpisodeId = null,
  audioProgress = 0,
  audioStage = '',
  episodeId = null,
  seriesId = null,
  activeSeries = null,
  activeEpisode = null,
  onUpdateScript = null,
  apiKey = null,
}) {
  const [generationMode, setGenerationMode] = useState(
    activeEpisode?.generationMode ||
    activeEpisode?.scriptData?.generationMode ||
    scriptData?.generationMode ||
    'standard'
  );
  const [isImportingSubtitles, setIsImportingSubtitles] = useState(false);
  const [subtitleImportMode, setSubtitleImportMode] = useState('auto');
  const [importErrors, setImportErrors] = useState([]);
  const [importSuccess, setImportSuccess] = useState(null);
  const fileInputRef = useRef(null);

  const [narratorGender, setNarratorGender] = useState('male');
  const [selectedGenre, setSelectedGenre] = useState(() =>
    normalizeGenre(
      scriptData?.genre ||
      scriptData?.detectedGenre ||
      activeEpisode?.scriptData?.genre ||
      activeSeries?.genre ||
      'auto'
    )
  );
  const [presetIds, setPresetIds] = useState(() => {
    const raw = promptInput || scriptData?.customPrompt || activeEpisode?.scriptData?.customPrompt || '';
    return parseDirectionPrompt(raw).presetIds;
  });
  const [customText, setCustomText] = useState(() => {
    const raw = promptInput || scriptData?.customPrompt || activeEpisode?.scriptData?.customPrompt || '';
    return parseDirectionPrompt(raw).customText;
  });

  const effectiveDirectionPrompt = useMemo(
    () => composeEffectivePrompt({ presetIds, customText, genre: selectedGenre }),
    [presetIds, customText, selectedGenre]
  );

  useEffect(() => {
    if (typeof setPromptInput === 'function' && promptInput !== effectiveDirectionPrompt) {
      setPromptInput(effectiveDirectionPrompt);
    }
  }, [effectiveDirectionPrompt, promptInput, setPromptInput]);
  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [showConfirmRetranslate, setShowConfirmRetranslate] = useState(false);
  const [showConfirmReTts, setShowConfirmReTts] = useState(false);
  const [isSeparatingAudio, setIsSeparatingAudio] = useState(false);
  const [separationProgress, setSeparationProgress] = useState(0);
  const [isCleanBgReady, setIsCleanBgReady] = useState(false);
  const [separationError, setSeparationError] = useState(null);

  // 1-Click Auto Compact "📝 ខ្លីចំអត្ថន័យ" state
  const [isAutoCompacting, setIsAutoCompacting] = useState(false);
  const [compactProgress, setCompactProgress] = useState({ current: 0, total: 0 });
  const [compactBanner, setCompactBanner] = useState(null);
  const [showCompactConfirm, setShowCompactConfirm] = useState(false);

  const handleAutoCompactAll = () => {
    const segments = scriptData?.segments || [];
    if (isAutoCompacting || segments.length === 0) return;
    setShowCompactConfirm(true);
  };

  const executeAutoCompact = async () => {
    const segments = scriptData?.segments || [];
    if (isAutoCompacting || segments.length === 0) return;
    const count = segments.length;

    setIsAutoCompacting(true);
    setCompactProgress({ current: 0, total: count });
    setCompactBanner(null);

    const BATCH_CHUNK = 25;
    let currentSegments = [...segments];
    let failedCount = 0;

    try {
      for (let i = 0; i < count; i += BATCH_CHUNK) {
        const slice = currentSegments.slice(i, i + BATCH_CHUNK);
        try {
          const resolvedSeriesId = seriesId || activeSeries?.id || activeEpisode?.seriesId || episodeId;
          const res = await retranslateAllSegmentsApi({
            segments: slice,
            seriesId: resolvedSeriesId,
            episodeId,
            options: { style: 'compact' },
            apiKey: apiKey || undefined,
          });
          if (res?.success && Array.isArray(res.segments)) {
            const resultMap = new Map();
            res.segments.forEach((s) => resultMap.set(String(s.id || s.index), s));
            currentSegments = currentSegments.map((orig) => {
              const match = resultMap.get(String(orig.id || orig.index));
              return match ? { ...orig, ...match } : orig;
            });
            if (typeof onUpdateScript === 'function') {
              onUpdateScript({
                ...scriptData,
                segments: currentSegments,
              });
            }
          }
        } catch (sliceErr) {
          console.warn(`[DubbingModeTab AutoCompact] Batch ${i}-${i + BATCH_CHUNK} failed:`, sliceErr);
          failedCount++;
        }
        setCompactProgress({ current: Math.min(i + BATCH_CHUNK, count), total: count });
      }

      setCompactBanner({
        type: failedCount === 0 ? 'success' : 'partial',
        text: failedCount === 0
          ? `✅ បានបម្លែងគ្រប់ Script ទាំង ${count} ទៅជា «ខ្លីចំអត្ថន័យ» រួចរាល់ 100%! (អ្នកអាចចុច Re-TTS ដើម្បីបង្កើតសំឡេងថ្មីបាន)`
          : `⚠️ បម្លែងបានភាគច្រើន (មាន ${failedCount} batch ជួបបញ្ហា network/quota) — សូមចុចបម្លែងម្ដងទៀត`,
      });
    } catch (err) {
      setCompactBanner({
        type: 'error',
        text: err.message || 'ការបម្លែង script បរាជ័យ',
      });
    } finally {
      setIsAutoCompacting(false);
    }
  };
  const hasExistingScript = Boolean(scriptData?.segments && scriptData.segments.length > 0);
  const hasExistingAudio = Boolean(scriptData?.segments?.some(s => s.audioUrl || s.audioPath || s.audioFile));
  const validTextSegments = (scriptData?.segments || []).filter((s) =>
    Boolean((s.khmer || s.khmerText || s.khmerTranslatedText || s.text || '').trim())
  );
  const pendingOrOutdatedCount = validTextSegments.filter((s) =>
    Boolean(s.audioOutdated) ||
    s.ttsStatus === 'pending' ||
    s.ttsStatus === 'error' ||
    s.status === 'tts_error' ||
    (!s.audioUrl && !s.audioPath && !s.audioFile)
  ).length;

  useEffect(() => {
    const detectedMode =
      activeEpisode?.generationMode ||
      activeEpisode?.scriptData?.generationMode ||
      scriptData?.generationMode;
    if (detectedMode) {
      setGenerationMode(detectedMode);
    }
  }, [activeEpisode?.generationMode, activeEpisode?.scriptData?.generationMode, scriptData?.generationMode]);

  const handleImportSubtitleFile = async (file) => {
    if (!file) return;
    setImportErrors([]);
    setImportSuccess(null);
    setIsImportingSubtitles(true);

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
            seriesId: seriesId || 'drama_project',
            episodeId: episodeId || 'ep_1',
            defaultGender: narratorGender,
            force: true,
            confirmed: true,
            importMode: subtitleImportMode,
            skipTranslation: subtitleImportMode === 'import_only',
          });

          if (res.success && res.segments) {
            const successMsg = res.isKhmerDirect
              ? `Import Subtitle ខ្មែរជោគជ័យ ${res.count || res.segments.length} ឃ្លា (⚡ 0 Gemini API · រួចរាល់សម្រាប់ Edge TTS)!`
              : `Import ជោគជ័យ ${res.count || res.segments.length} ឃ្លា!`;
            setImportSuccess(successMsg);
            setGenerationMode('fast_ocr');
            if (onUpdateScript) {
              onUpdateScript({
                ...(scriptData || {}),
                mode: 'fast_ocr',
                generationMode: 'fast_ocr',
                segments: res.segments,
              });
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

  const prevEpRef = useRef(activeEpisode?.id || episodeId);

  useEffect(() => {
    const curEpId = activeEpisode?.id || episodeId;
    if (prevEpRef.current !== curEpId) {
      prevEpRef.current = curEpId;
      const nextGenre = normalizeGenre(
        scriptData?.genre ||
        scriptData?.detectedGenre ||
        activeEpisode?.scriptData?.genre ||
        activeEpisode?.scriptData?.detectedGenre ||
        activeSeries?.genre ||
        'auto'
      );
      setSelectedGenre(nextGenre);

      const savedPrompt = scriptData?.customPrompt || activeEpisode?.scriptData?.customPrompt || '';
      const parsed = parseDirectionPrompt(savedPrompt);
      setPresetIds(parsed.presetIds);
      setCustomText(parsed.customText);
    } else {
      if (scriptData?.genre) {
        setSelectedGenre(normalizeGenre(scriptData.genre));
      } else if (scriptData?.detectedGenre) {
        setSelectedGenre(normalizeGenre(scriptData.detectedGenre));
      }
    }
  }, [activeEpisode?.id, episodeId, scriptData?.genre, scriptData?.detectedGenre, scriptData?.customPrompt, activeSeries?.genre]);

  // Check initial Demucs separation status for selected video
  useEffect(() => {
    if (!selectedVideo) {
      setIsCleanBgReady(false);
      return;
    }
    const videoRefName = selectedVideo?.videoUrl || selectedVideo?.filePath || selectedVideo?.fileName || selectedVideo?.name;
    if (!videoRefName) return;

    fetch('/api/audio/separation-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: videoRefName }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.available) {
          setIsCleanBgReady(true);
        } else {
          setIsCleanBgReady(false);
        }
      })
      .catch(() => setIsCleanBgReady(false));
  }, [selectedVideo]);

  const handleStartDemucsSeparation = async () => {
    if (!selectedVideo || isSeparatingAudio) return;
    const videoRefName = selectedVideo?.videoUrl || selectedVideo?.filePath || selectedVideo?.fileName || selectedVideo?.name;
    if (!videoRefName) return;

    setIsSeparatingAudio(true);
    setSeparationProgress(1);
    setSeparationError(null);

    let pollInterval = null;
    try {
      // Poll real-time 1% ... 99% ... 100% progress from backend Demucs AI worker
      pollInterval = setInterval(async () => {
        try {
          const pRes = await fetch(`/api/audio/separation-progress?videoPath=${encodeURIComponent(videoRefName)}`);
          const pData = await pRes.json();
          if (pData.success && typeof pData.progress === 'number' && pData.progress > 0) {
            setSeparationProgress(pData.progress);
          }
        } catch (_) {}
      }, 700);

      let resultData = null;
      try {
        const res = await fetch('/api/audio/separate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoPath: videoRefName }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success && data.noVocalsUrl) {
          resultData = data;
        } else if (res.status !== 502) {
          throw new Error(data.error || 'ការបំបែកសំឡេង Demucs ជួបបញ្ហា');
        }
      } catch (fetchErr) {
        // Recover seamlessly via progress/status polling if browser socket dropped while backend Demucs continues
        const isTransientDisconnect =
          fetchErr?.name === 'TypeError' ||
          /failed to fetch|network|reset|empty/i.test(fetchErr?.message || '');
        if (!isTransientDisconnect) {
          throw fetchErr;
        }
      }

      // If POST connection dropped transiently while backend is still separating, keep polling until completion
      if (!resultData) {
        let consecutiveNetErrors = 0;
        while (!resultData) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const pRes = await fetch(`/api/audio/separation-progress?videoPath=${encodeURIComponent(videoRefName)}`);
            const pData = await pRes.json().catch(() => ({}));
            consecutiveNetErrors = 0;
            if (pData.status === 'separating') {
              if (typeof pData.progress === 'number' && pData.progress > 0) {
                setSeparationProgress(pData.progress);
              }
              continue;
            }
            if (pData.status === 'completed' && pData.noVocalsUrl) {
              resultData = { success: true, noVocalsUrl: pData.noVocalsUrl };
              break;
            }
            if (pData.status === 'error') {
              throw new Error(pData.error || pData.message || 'ការបំបែកសំឡេង Demucs ជួបបញ្ហា');
            }
          } catch (pollErr) {
            if (pollErr.message && !/failed to fetch|network/i.test(pollErr.message)) {
              throw pollErr;
            }
            consecutiveNetErrors++;
            if (consecutiveNetErrors >= 4) {
              throw new Error('Backend server is temporarily unreachable. សូមផ្ទៀងផ្ទាត់ Server រួចចុចម្ដងទៀត។');
            }
            continue;
          }

          // Progress status became idle — verify cached stem availability via /audio/separation-status
          const sRes = await fetch('/api/audio/separation-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoPath: videoRefName }),
          });
          const sData = await sRes.json().catch(() => ({}));
          if (sRes.ok && sData.success && sData.available && sData.noVocalsUrl) {
            resultData = { success: true, noVocalsUrl: sData.noVocalsUrl };
            break;
          }
          throw new Error('ការភ្ជាប់ទៅ Backend ត្រូវបានកាត់ផ្ដាច់។ សូមផ្ទៀងផ្ទាត់ Server រួចចុចម្ដងទៀត។');
        }
      }

      if (resultData?.noVocalsUrl) {
        setSeparationProgress(100);
        setIsCleanBgReady(true);
        window.dispatchEvent(new CustomEvent('demucs-separation-ready', {
          detail: { noVocalsUrl: resultData.noVocalsUrl, videoPath: videoRefName }
        }));
      }
    } catch (err) {
      console.error('[DubbingModeTab] Separation error:', err);
      setSeparationError(err.message || 'ការបំបែកសំឡេង Demucs ជួបបញ្ហា');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setIsSeparatingAudio(false);
    }
  };

  const [internalAudioProgress, setInternalAudioProgress] = useState(0);
  const [internalAudioStage, setInternalAudioStage] = useState('');

  // Determine if THIS current episode is the one being generated
  const isThisEpisodeGeneratingScript = Boolean(
    isGeneratingScript && (!generatingEpisodeId || !episodeId || generatingEpisodeId === episodeId)
  );
  const isThisEpisodeGeneratingAudio = Boolean(
    isGeneratingAudio && (!generatingAudioEpisodeId || !episodeId || generatingAudioEpisodeId === episodeId)
  );

  // Honest stage tracking without fake percentage tickers
  const currentStageText = scriptStage || (
    isThisEpisodeGeneratingScript
      ? (dubbingMode === 'dialogue' ? 'កំពុងវិភាគការសន្ទនាតួអង្គ & សំឡេង (Analyzing Dialogue)...' : 'កំពុងវិភាគដំណើររឿង & រៀបចំសម្រាយ (Analyzing Narrative)...')
      : ''
  );
  const displayProgress = scriptProgress > 0 ? scriptProgress : (isThisEpisodeGeneratingScript ? 0 : 0);

  // Smooth live percentage counter (0, 1, 2, ... 100% doch console)
  const [smoothProgress, setSmoothProgress] = useState(0);
  const consoleEndRef = useRef(null);

  useEffect(() => {
    if (!isThisEpisodeGeneratingScript) {
      if (hasExistingScript) {
        setSmoothProgress(100);
      } else {
        setSmoothProgress(0);
      }
      return;
    }

    if (displayProgress >= 100) {
      setSmoothProgress(100);
      return;
    }

    const target = Math.max(displayProgress, 5);
    const interval = setInterval(() => {
      setSmoothProgress((prev) => {
        if (prev < target) {
          return prev + 1;
        } else if (prev < 95 && target < 95) {
          return prev + 1;
        }
        return prev;
      });
    }, 240);

    return () => clearInterval(interval);
  }, [isThisEpisodeGeneratingScript, displayProgress, hasExistingScript]);

  // Auto-scroll live terminal console to latest output when stage or logs update (non-blocking instant scroll)
  useEffect(() => {
    const el = consoleEndRef.current;
    if (el && el.parentElement) {
      el.parentElement.scrollTop = el.parentElement.scrollHeight;
    }
  }, [scriptLogs, currentStageText]);

  // Fallback animation timer for Step 3 Audio Dubbing (0 -> 100%)
  useEffect(() => {
    let timer = null;
    if (isThisEpisodeGeneratingAudio) {
      if (audioProgress > 0) {
        setInternalAudioProgress(audioProgress);
        setInternalAudioStage(audioStage);
      } else {
        setInternalAudioProgress(8);
        setInternalAudioStage('1/4 កំពុងរៀបចំឃ្លាសន្ទនា & Voice Mapping...');
        timer = setInterval(() => {
          setInternalAudioProgress((prev) => {
            let next = prev;
            if (prev < 25) {
              next = prev + 3;
              if (next >= 25) setInternalAudioStage('2/4 Microsoft Edge Neural AI កំពុងបង្កើតសំឡេងខ្មែរ...');
            } else if (prev < 65) {
              next = prev + 2;
              if (next >= 65) setInternalAudioStage('3/4 Auto Time-Stretch & Alignment (តម្រឹមតាម Timecode)...');
            } else if (prev < 85) {
              next = prev + 1;
              if (next >= 85) setInternalAudioStage('4/4 កំពុង Syncing Master Narration Timeline...');
            } else if (prev < 96) {
              if (Math.random() > 0.4) next = prev + 1;
            }
            return Math.min(next, 96);
          });
        }, 320);
      }
    } else {
      if (internalAudioProgress > 0) {
        if (!isGeneratingAudio) {
          setInternalAudioProgress(100);
          setInternalAudioStage('✅ បង្កើតសំឡេងខ្មែរ AI ជោគជ័យ 100%!');
          const resetTimer = setTimeout(() => {
            setInternalAudioProgress(0);
            setInternalAudioStage('');
          }, 2500);
          return () => clearTimeout(resetTimer);
        } else {
          setInternalAudioProgress(0);
          setInternalAudioStage('');
        }
      }
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isThisEpisodeGeneratingAudio, isGeneratingAudio, audioProgress, audioStage]);

  const displayAudioProgress = isThisEpisodeGeneratingAudio
    ? (audioProgress > 0 ? audioProgress : internalAudioProgress)
    : 0;
  const currentAudioStageText = audioStage || internalAudioStage || (
    displayAudioProgress < 25 
      ? '1/4 កំពុងរៀបចំឃ្លាសន្ទនា & Speaker Mapping...'
      : displayAudioProgress < 65 
        ? '2/4 Microsoft Edge Neural AI កំពុងបង្កើតសំឡេងខ្មែរ...'
        : displayAudioProgress < 85 
          ? '3/4 Auto Time-Stretch & Alignment (តម្រឹមតាម Timecode)...'
          : displayAudioProgress < 100 
            ? '4/4 កំពុង Syncing Master Narration Timeline...'
            : '✅ បង្កើតសំឡេងខ្មែរ AI ជោគជ័យ 100%!'
  );

  return (
    <div className="media-tab-content">
      {!selectedVideo ? (
        <div 
          className="motion-lift"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 12,
            padding: '36px 18px',
            background: 'rgba(0, 0, 0, 0.25)',
            borderRadius: 10,
            border: '1.5px dashed rgba(56, 189, 248, 0.35)',
            marginBottom: 12,
          }}
        >
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: 'rgba(56, 189, 248, 0.12)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#38bdf8',
          }}>
            <Film size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.94rem', fontWeight: 700, color: '#f8fafc', marginBottom: 4 }}>
              ភាគនេះមិនទាន់មានវីដេអូនៅឡើយទេ
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', maxWidth: 280, lineHeight: 1.5 }}>
              សូមបញ្ចូលវីដេអូសម្រាប់ភាគនេះ ដើម្បីចាប់ផ្ដើមបកប្រែ & បង្កើតសំឡេង AI
            </div>
          </div>
          <button
            type="button"
            onClick={() => onTabChange?.('media')}
            className="btn-primary"
            style={{
              padding: '8px 18px',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            <span>បង្ហោះវីដេអូ (Import Video)</span>
          </button>
        </div>
      ) : (
        <>
          {hasExistingScript && !isThisEpisodeGeneratingScript && !showRegenerateForm ? (
        /* ── State A: Script Ready Hub (When script has already been generated) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 1. Script Ready Hero Card */}
          <div
            style={{
              background: 'var(--bg-secondary-panel)',
              border: '1px solid rgba(16, 185, 129, 0.28)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 6,
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.28)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10b981',
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle2 size={15} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Script ខ្មែររួចរាល់
                  </div>
                  <div style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>
                    AI Script Complete
                  </div>
                </div>
              </div>

              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.28)',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}
              >
                {scriptData.segments.length} ឃ្លា
              </span>
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {generationMode === 'fast_ocr' ? (
                <span style={{ fontSize: '11px', fontWeight: 600, background: 'rgba(234, 179, 8, 0.12)', color: '#eab308', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(234, 179, 8, 0.28)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Zap size={11} />
                  <span>Fast OCR</span>
                </span>
              ) : (
                <span style={{ fontSize: '11px', fontWeight: 600, background: 'var(--bg-elevated-panel)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Layers size={11} />
                  <span>Standard</span>
                </span>
              )}
              <span style={{ fontSize: '11px', background: 'var(--bg-elevated-panel)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MessageSquare size={11} />
                <span>{dubbingMode === 'dialogue' ? 'សន្ទនាតួអង្គ' : 'សម្រាយរឿង'}</span>
              </span>
              <span style={{ fontSize: '11px', background: 'rgba(56, 189, 248, 0.1)', color: 'var(--primary-accent)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(56, 189, 248, 0.25)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Sparkles size={11} />
                <span>{selectedGenre === 'ancient' ? 'បុរាណចិន' : (selectedGenre === 'modern' ? 'សម័យទំនើប' : (selectedGenre === 'action' ? 'Action' : (selectedGenre === 'comedy' ? 'កំប្លែង' : selectedGenre)))}</span>
              </span>
            </div>

            {/* Primary Action: Go to Tab 3 for Line-by-Line Subtitle Review */}
            <button
              type="button"
              onClick={() => onTabChange && onTabChange('subtitles')}
              className="btn-secondary"
              style={{
                width: '100%',
                minHeight: 34,
                padding: '7px 12px',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
              title="ពិនិត្យ និងកែសម្រួលអត្ថបទខ្មែរតាមឃ្លានីមួយៗ"
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <FileText size={14} color="var(--primary-accent)" style={{ flexShrink: 0 }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  កែអត្ថបទ ({scriptData.segments.length} ឃ្លា)
                </span>
              </span>
              <ArrowRight size={14} color="var(--text-dim)" style={{ flexShrink: 0 }} />
            </button>

            {/* 1-Click Auto Compact Action (Flat Darkroom Console — Zero Purple Slop) */}
            <button
              type="button"
              data-testid="btn-dubbing-auto-compact"
              onClick={handleAutoCompactAll}
              disabled={isAutoCompacting || !scriptData?.segments?.length}
              style={{
                width: '100%',
                minHeight: 34,
                marginTop: 6,
                padding: '7px 12px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated-panel)',
                color: 'var(--text-primary)',
                fontSize: '11.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                cursor: isAutoCompacting ? 'not-allowed' : 'pointer',
              }}
              title="បំព្រួញគ្រប់ឃ្លាទាំងអស់ឱ្យខ្លីចំអត្ថន័យ និងត្រូវចង្វាក់មាត់"
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                {isAutoCompacting ? (
                  <Loader2 size={13} className="animate-spin" color="var(--primary-accent)" style={{ flexShrink: 0 }} />
                ) : (
                  <Sparkles size={13} color="var(--primary-accent)" style={{ flexShrink: 0 }} />
                )}
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isAutoCompacting
                    ? `កំពុងបំព្រួញឃ្លា (${compactProgress.current}/${compactProgress.total})...`
                    : `បំព្រួញឃ្លាទាំងអស់ឱ្យខ្លីស្អាត (1..${scriptData.segments.length})`}
                </span>
              </span>
              <span style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                background: 'rgba(56, 189, 248, 0.14)',
                color: 'var(--primary-accent)',
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 700,
                flexShrink: 0,
              }}>
                Compact
              </span>
            </button>

            {compactBanner && (
              <div
                style={{
                  marginTop: 6,
                  padding: '6px 9px',
                  borderRadius: 6,
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  background: compactBanner.type === 'success'
                    ? 'rgba(16, 185, 129, 0.14)'
                    : compactBanner.type === 'partial'
                    ? 'rgba(245, 158, 11, 0.14)'
                    : 'rgba(239, 68, 68, 0.14)',
                  border: compactBanner.type === 'success'
                    ? '1px solid rgba(16, 185, 129, 0.35)'
                    : compactBanner.type === 'partial'
                    ? '1px solid rgba(245, 158, 11, 0.35)'
                    : '1px solid rgba(239, 68, 68, 0.35)',
                  color: compactBanner.type === 'success'
                    ? '#6EE7B7'
                    : compactBanner.type === 'partial'
                    ? '#FDE68A'
                    : '#FCA5A5',
                }}
              >
                <span>{compactBanner.text}</span>
                <button
                  type="button"
                  onClick={() => setCompactBanner(null)}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 1 }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {/* 2. Voice & BGM Production Card */}
          <div
            style={{
              background: 'var(--bg-secondary-panel)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 6, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mic size={14} color="var(--primary-accent)" />
                <span>ផលិតសំឡេង AI &amp; ភ្លេង BGM</span>
              </div>
              {hasExistingAudio && !isThisEpisodeGeneratingAudio && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '10px', background: pendingOrOutdatedCount > 0 ? 'rgba(251, 191, 36, 0.14)' : 'rgba(16, 185, 129, 0.14)', color: pendingOrOutdatedCount > 0 ? '#fbbf24' : '#34D399', padding: '2px 7px', borderRadius: 4, fontWeight: 700, border: pendingOrOutdatedCount > 0 ? '1px solid rgba(251, 191, 36, 0.3)' : '1px solid rgba(16, 185, 129, 0.28)' }}>
                    {pendingOrOutdatedCount > 0 ? `ខ្វះ/កែ ${pendingOrOutdatedCount} ឃ្លា` : 'សំឡេងរួចរាល់'}
                  </span>
                  {pendingOrOutdatedCount > 0 && onNavigateToVoice && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowConfirmReTts(true);
                      }}
                      title="បង្កើតសំឡេង AI ឡើងវិញទាំងអស់"
                      style={{
                        fontSize: '10px',
                        background: 'var(--bg-elevated-panel)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 4,
                        padding: '2px 7px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Re-TTS ទាំងអស់
                    </button>
                  )}
                </div>
              )}
            </div>

            {onNavigateToVoice && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  if (!hasExistingAudio || pendingOrOutdatedCount > 0) {
                    onNavigateToVoice({ forceRegen: false });
                  } else {
                    setShowConfirmReTts(true);
                  }
                }}
                disabled={isThisEpisodeGeneratingAudio}
                className="btn-primary"
                style={{
                  width: '100%',
                  minHeight: 38,
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isThisEpisodeGeneratingAudio ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                {isThisEpisodeGeneratingAudio ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Loader2 size={14} className="animate-spin" />
                    <span>កំពុងបង្កើតសំឡេង AI... {displayAudioProgress}%</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <Mic size={14} style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {!hasExistingAudio
                          ? 'បង្កើតសំឡេងខ្មែរ AI (TTS)'
                          : pendingOrOutdatedCount > 0
                            ? `បង្កើតសំឡេងខ្វះ / កែប្រែ (${pendingOrOutdatedCount} ឃ្លា)`
                            : 'បង្កើតសំឡេង AI ឡើងវិញ (Re-TTS)'}
                      </span>
                    </div>
                    {hasExistingAudio ? (
                      <RefreshCw size={14} style={{ flexShrink: 0 }} />
                    ) : (
                      <ArrowRight size={14} style={{ flexShrink: 0 }} />
                    )}
                  </>
                )}
              </button>
            )}

            {/* Step 3: Auto-Fit Speed (1.05x - 1.50x) */}
            <div style={{ marginTop: 8 }}>
              <DubbingStepButton
                step="autofit"
                episodes={activeEpisode ? [activeEpisode] : []}
                variant="card"
                setupOptions={{
                  maxSpeed: 1.50,
                }}
                style={{ width: '100%', minHeight: 36, padding: '8px 12px', borderRadius: 6, justifyContent: 'space-between' }}
              />
            </div>

            {/* Step 4 / AI Vocal Separation (Demucs AI): 1-Click Button */}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={handleStartDemucsSeparation}
                disabled={isSeparatingAudio || !selectedVideo}
                className="btn-secondary"
                style={{
                  width: '100%',
                  minHeight: 36,
                  padding: '8px 12px',
                  borderRadius: 6,
                  borderColor: isCleanBgReady ? 'rgba(52, 211, 153, 0.35)' : 'var(--border-subtle)',
                  background: isSeparatingAudio
                    ? 'var(--bg-workspace-base)'
                    : (isCleanBgReady ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-elevated-panel)'),
                  color: isSeparatingAudio
                    ? 'var(--text-dim)'
                    : (isCleanBgReady ? '#34D399' : 'var(--text-secondary)'),
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: (isSeparatingAudio || !selectedVideo) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                title="បំបែកកាត់សំឡេងចិន ចម្រាញ់យកតែភ្លេង BGM ដើម (Demucs AI)"
              >
                {isSeparatingAudio ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <Loader2 size={14} className="animate-spin" color="var(--primary-accent)" style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: 'nowrap' }}>
                        កំពុងបំបែកភ្លេង BGM...
                      </span>
                    </div>
                    <span style={{
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      background: 'rgba(56, 189, 248, 0.18)',
                      color: 'var(--primary-accent)',
                      padding: '2px 7px',
                      borderRadius: 4,
                      fontWeight: 700,
                    }}>
                      {separationProgress}%
                    </span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <Volume2 size={14} style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {isCleanBgReady
                          ? 'ភ្លេង BGM ស្អាត (Demucs AI)'
                          : 'បំបែកភ្លេង BGM (Demucs AI)'}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      background: isCleanBgReady ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-workspace-base)',
                      color: isCleanBgReady ? '#34d399' : 'var(--text-dim)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontWeight: 700,
                    }}>
                      {isCleanBgReady ? 'READY' : 'RUN'}
                    </span>
                  </>
                )}
              </button>
              {isSeparatingAudio && (
                <div style={{
                  width: '100%',
                  height: 5,
                  background: 'var(--bg-elevated-panel)',
                  borderRadius: 999,
                  marginTop: 6,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${Math.max(3, separationProgress)}%`,
                    height: '100%',
                    background: 'var(--primary-accent)',
                    transition: 'width 0.4s ease-out',
                    borderRadius: 999,
                  }} />
                </div>
              )}
              {separationError && (
                <div style={{ fontSize: '11px', color: '#f87171', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={12} />
                  <span>{separationError}</span>
                </div>
              )}
            </div>

            {/* Progress Monitor when generating audio */}
            {isThisEpisodeGeneratingAudio && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#34d399', fontWeight: 600, marginBottom: 6 }}>
                  <span>{currentAudioStageText}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{displayAudioProgress}%</span>
                </div>
                <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'var(--bg-elevated-panel)', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ width: `${displayAudioProgress}%`, height: '100%', background: '#10b981', transition: 'width 0.28s ease' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  <div style={{ padding: '3px 4px', borderRadius: 4, fontSize: '0.62rem', textAlign: 'center', background: displayAudioProgress >= 5 ? 'rgba(52, 211, 153, 0.14)' : 'var(--bg-elevated-panel)', color: displayAudioProgress >= 5 ? '#34d399' : 'var(--text-dim)', fontWeight: 600 }}>1. Map</div>
                  <div style={{ padding: '3px 4px', borderRadius: 4, fontSize: '0.62rem', textAlign: 'center', background: displayAudioProgress >= 25 ? 'rgba(52, 211, 153, 0.14)' : 'var(--bg-elevated-panel)', color: displayAudioProgress >= 25 ? '#34d399' : 'var(--text-dim)', fontWeight: 600 }}>2. TTS</div>
                  <div style={{ padding: '3px 4px', borderRadius: 4, fontSize: '0.62rem', textAlign: 'center', background: displayAudioProgress >= 65 ? 'rgba(52, 211, 153, 0.14)' : 'var(--bg-elevated-panel)', color: displayAudioProgress >= 65 ? '#34d399' : 'var(--text-dim)', fontWeight: 600 }}>3. Fit</div>
                  <div style={{ padding: '3px 4px', borderRadius: 4, fontSize: '0.62rem', textAlign: 'center', background: displayAudioProgress >= 85 ? 'rgba(52, 211, 153, 0.14)' : 'var(--bg-elevated-panel)', color: displayAudioProgress >= 85 ? '#34d399' : 'var(--text-dim)', fontWeight: 600 }}>4. Sync</div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Collapsible Re-generate Accordion Header */}
          <div style={{ marginTop: 2 }}>
            <button
              type="button"
              onClick={() => setShowRegenerateForm(true)}
              className="btn-secondary"
              style={{
                width: '100%',
                minHeight: 34,
                padding: '7px 12px',
                fontSize: '11.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings2 size={13} color="var(--text-dim)" />
                <span>កំណត់ការបកប្រែ / បង្កើត Script ឡើងវិញ</span>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      ) : (
        /* ── State B: Creation / Re-generation Form ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'var(--bg-secondary-panel)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
          {hasExistingScript && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: 8, marginBottom: 2 }}>
              <span style={{ fontSize: '11.5px', color: '#f8fafc', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings2 size={13} color="#38bdf8" />
                <span>បង្កើត Script ឡើងវិញ (Re-generate Script)</span>
              </span>
              <button
                type="button"
                onClick={() => setShowRegenerateForm(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer', fontWeight: 600, padding: '2px 6px', borderRadius: 4, transition: 'color 0.15s' }}
                onMouseEnter={(e) => e.target.style.color = '#f1f5f9'}
                onMouseLeave={(e) => e.target.style.color = '#94a3b8'}
              >
                ✕ បិទ (Close)
              </button>
            </div>
          )}

          {/* Generation Mode Toggle (Standard vs Fast OCR) */}
          <div style={{ background: 'rgba(0, 0, 0, 0.22)', padding: '9px 11px', borderRadius: 7, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
              <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Zap size={12} color="#38bdf8" />
                <span>ល្បឿន & របៀប Pipeline (Generation Mode)</span>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 7 }}>
              <button
                type="button"
                onClick={() => setGenerationMode('standard')}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: generationMode === 'standard' ? '1.5px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: generationMode === 'standard' ? 'rgba(147, 51, 234, 0.18)' : 'rgba(15, 23, 42, 0.6)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11.5px', fontWeight: 700, color: generationMode === 'standard' ? '#c084fc' : '#e2e8f0' }}>
                  <Layers size={13} />
                  <span>Standard Mode</span>
                </span>
                {generationMode === 'standard' && <Check size={13} color="#c084fc" />}
              </button>

              <button
                type="button"
                data-testid="fast-ocr-toggle"
                onClick={() => setGenerationMode('fast_ocr')}
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: generationMode === 'fast_ocr' ? '1.5px solid #eab308' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: generationMode === 'fast_ocr' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11.5px', fontWeight: 700, color: generationMode === 'fast_ocr' ? '#eab308' : '#e2e8f0' }}>
                    <Zap size={13} />
                    <span>Fast OCR Mode</span>
                  </span>
                  {generationMode === 'fast_ocr' && <Check size={13} color="#eab308" />}
                </div>
                <div
                  data-testid="fast-ocr-summary-pill"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    alignSelf: 'flex-start',
                    padding: '1.5px 5px',
                    borderRadius: 3,
                    fontSize: '9px',
                    fontWeight: 600,
                    background: generationMode === 'fast_ocr' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    color: generationMode === 'fast_ocr' ? '#fde047' : '#94a3b8',
                    border: generationMode === 'fast_ocr' ? '1px solid rgba(234, 179, 8, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  OCR + Visual Speaker Gender + Direct Translate
                </div>
              </button>
            </div>

            {/* Import .srt / .json Button with Mode Selector */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.06)', flexWrap: 'wrap', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>មាន Subtitle ស្រាប់? (Import):</span>
                <select
                  value={subtitleImportMode}
                  onChange={(e) => setSubtitleImportMode(e.target.value)}
                  style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: '#1e293b',
                    color: subtitleImportMode === 'khmer_direct' ? '#34d399' : '#cbd5e1',
                    border: '1px solid rgba(255,255,255,0.15)',
                    cursor: 'pointer',
                  }}
                  title="ជ្រើសរើសប្រភេទ Subtitle ដែលត្រូវនាំចូល"
                >
                  <option value="auto">⚡ ស្វ័យប្រវត្តិ (Auto-Detect)</option>
                  <option value="khmer_direct">🇰🇭 Khmer SRT (0 Gemini API · បកប្រែរួច)</option>
                  <option value="chinese_translate">🇨🇳 Chinese SRT (Gemini AI · បកប្រែចិន ➜ ខ្មែរ)</option>
                  <option value="import_only">📁 Import Only (មិនបកប្រែ)</option>
                </select>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".srt,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportSubtitleFile(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={isImportingSubtitles}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 5,
                    fontSize: '10.5px',
                    fontWeight: 600,
                    background: subtitleImportMode === 'khmer_direct' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(56, 189, 248, 0.12)',
                    color: subtitleImportMode === 'khmer_direct' ? '#34d399' : '#38bdf8',
                    border: subtitleImportMode === 'khmer_direct' ? '1px solid rgba(52, 211, 153, 0.35)' : '1px solid rgba(56, 189, 248, 0.3)',
                    cursor: isImportingSubtitles ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {isImportingSubtitles ? <Loader2 size={11} className="spin" /> : <FileText size={11} />}
                  <span>{subtitleImportMode === 'khmer_direct' ? 'Import Khmer .srt (0 API)' : 'Import .srt / .json'}</span>
                </button>
              </div>
            </div>

            {/* Import Feedback */}
            {importSuccess && (
              <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', fontSize: '10.5px' }}>
                ✓ {importSuccess}
              </div>
            )}
            {importErrors.length > 0 && (
              <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: '10.5px' }}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>⚠️ បញ្ហាពេល Import Subtitle (Validation Errors):</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {importErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

        {/* 1. Mode A / Mode B Selection */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <MessageSquare size={12} color="#38bdf8" />
              <span>ទម្រង់បញ្ចូលសំឡេង AI (Dubbing Mode)</span>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {/* Mode A Button */}
            <button
              type="button"
              onClick={() => setDubbingMode('dialogue')}
              style={{
                padding: '9px 12px',
                borderRadius: 6,
                border: dubbingMode === 'dialogue' ? '1.5px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                background: dubbingMode === 'dialogue' 
                  ? 'rgba(56, 189, 248, 0.14)' 
                  : 'rgba(15, 23, 42, 0.6)',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '12px', color: dubbingMode === 'dialogue' ? '#38bdf8' : '#e2e8f0', display: 'flex', alignItems: 'center', gap: 7 }}>
                <MessageSquare size={14} />
                <span>Mode A: សន្ទនាតួអង្គ</span>
              </span>
              {dubbingMode === 'dialogue' ? (
                <Check size={13} color="#38bdf8" />
              ) : (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.2)' }} />
              )}
            </button>

            {/* Mode B Button */}
            <button
              type="button"
              onClick={() => {
                setDubbingMode('recap');
                if (recapStyle !== 'story_recap' && recapStyle !== 'fast_recap') setRecapStyle('story_recap');
              }}
              style={{
                padding: '9px 12px',
                borderRadius: 6,
                border: dubbingMode === 'recap' ? '1.5px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                background: dubbingMode === 'recap' 
                  ? 'rgba(192, 132, 252, 0.14)' 
                  : 'rgba(15, 23, 42, 0.6)',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '12px', color: dubbingMode === 'recap' ? '#c084fc' : '#e2e8f0', display: 'flex', alignItems: 'center', gap: 7 }}>
                <Film size={14} />
                <span>Mode B: សម្រាយរឿង</span>
              </span>
              {dubbingMode === 'recap' ? (
                <Check size={13} color="#c084fc" />
              ) : (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.2)' }} />
              )}
            </button>
          </div>
        </div>

        {/* 2. Recap Style (Mode B only) */}
        {dubbingMode === 'recap' && (
          <div style={{ background: '#0b0f19', padding: '9px 11px', borderRadius: 6, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600, display: 'block', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              ជ្រើសរើសទម្រង់សម្រាយ (Recap Style)
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 8px', borderRadius: 5, background: recapStyle === 'story_recap' ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.03)', border: recapStyle === 'story_recap' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)' }}>
                <input
                  type="radio"
                  name="recapStyle"
                  value="story_recap"
                  checked={recapStyle === 'story_recap'}
                  onChange={(e) => setRecapStyle(e.target.value)}
                  style={{ accentColor: '#38bdf8', margin: 0 }}
                />
                <span style={{ color: '#f8fafc', fontSize: '11px', fontWeight: 600 }}>សម្រាយសាច់រឿង</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 8px', borderRadius: 5, background: recapStyle === 'fast_recap' ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.03)', border: recapStyle === 'fast_recap' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)' }}>
                <input
                  type="radio"
                  name="recapStyle"
                  value="fast_recap"
                  checked={recapStyle === 'fast_recap'}
                  onChange={(e) => setRecapStyle(e.target.value)}
                  style={{ accentColor: '#38bdf8', margin: 0 }}
                />
                <span style={{ color: '#f8fafc', fontSize: '11px', fontWeight: 600 }}>សង្ខេបដំណើររឿងរហ័ស</span>
              </label>
            </div>

            {/* Narrator Voice Picker */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <span style={{ fontSize: '10.5px', color: '#cbd5e1' }}>សំឡេងអ្នកនិទានរឿង:</span>
              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  type="button"
                  onClick={() => setNarratorGender('male')}
                  style={{
                    padding: '3px 8px', fontSize: '10.5px', borderRadius: 5,
                    border: 'none',
                    background: narratorGender === 'male' ? '#2563eb' : '#1e293b',
                    color: '#fff', cursor: 'pointer',
                    fontWeight: narratorGender === 'male' ? 700 : 400,
                    display: 'flex', alignItems: 'center', gap: 4,
                    transition: 'all 0.15s',
                  }}
                >
                  <Mic size={11} /> ពិសិដ្ឋ
                </button>
                <button
                  type="button"
                  onClick={() => setNarratorGender('female')}
                  style={{
                    padding: '3px 8px', fontSize: '10.5px', borderRadius: 5,
                    border: 'none',
                    background: narratorGender === 'female' ? '#db2777' : '#1e293b',
                    color: '#fff', cursor: 'pointer',
                    fontWeight: narratorGender === 'female' ? 700 : 400,
                    display: 'flex', alignItems: 'center', gap: 4,
                    transition: 'all 0.15s',
                  }}
                >
                  <Mic size={11} /> ស្រីមុំ
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Drama Genre Selector (ជ្រើសរើសប្រភេទរឿង / Auto Detect Genre) */}
        {dubbingMode === 'dialogue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <BookOpen size={12} color="#38bdf8" />
                <span>ប្រភេទរឿង (Drama Genre)</span>
              </label>
              {scriptData?.detectedGenre && (
                <span style={{
                  fontSize: '9.5px',
                  background: 'rgba(56, 189, 248, 0.12)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '1.5px 6px',
                  borderRadius: 4,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  <Sparkles size={10} /> AI: {scriptData.detectedGenre}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {GENRE_OPTIONS.map((g) => {
                const isSelected = selectedGenre === g.id;
                const GenreIcon = g.icon || Sparkles;
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`ជ្រើសរើសប្រភេទរឿង ${g.shortLabel || g.label}`}
                    onClick={() => {
                      const res = handleGenreChange({ presetIds, newGenre: g.id });
                      setSelectedGenre(res.nextGenre);
                      setPresetIds(res.nextPresetIds);
                    }}
                    title={g.hint}
                    style={{
                      padding: '4px 9px',
                      fontSize: '11px',
                      borderRadius: 6,
                      border: isSelected ? '1.5px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                      background: isSelected
                        ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.25) 0%, rgba(56, 189, 248, 0.15) 100%)'
                        : '#0b0f19',
                      color: isSelected ? '#38bdf8' : '#cbd5e1',
                      cursor: 'pointer',
                      fontWeight: isSelected ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 0 10px rgba(56, 189, 248, 0.25)' : 'none',
                    }}
                  >
                    <GenreIcon size={12} />
                    <span>{g.shortLabel || g.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Optional Direction + 1-Click Smart Prompt Chips */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>{dubbingMode === 'dialogue' ? 'ឈ្មោះតួអង្គ / Direction' : 'ទិសដៅសម្រាយបន្ថែម (Direction)'}</span>
              <span style={{ fontSize: '9px', color: '#64748b', background: 'rgba(255, 255, 255, 0.06)', padding: '1px 5px', borderRadius: 3, fontWeight: 500, textTransform: 'none' }}>
                ស្រេចចិត្ត
              </span>
            </label>
            {(customText || presetIds.length > 0) && (
              <button
                type="button"
                onClick={() => setCustomText('')}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
                title="សម្អាតទិសដៅបន្ថែម (Clear custom text)"
                aria-label="សម្អាតទិសដៅបន្ថែម"
              >
                ✕ សម្អាត
              </button>
            )}
          </div>

          {/* 1-Click Smart Prompt Chips */}
          <div
            data-testid="smart-prompt-chips"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 5,
              marginBottom: 7,
            }}
          >
            {SMART_PROMPT_CHIPS.map((chip) => {
              const isChipActive = presetIds.includes(chip.id);
              const ChipIcon = chip.icon || Sparkles;
              return (
                <button
                  key={chip.id}
                  type="button"
                  data-testid={`smart-prompt-chip-${chip.id}`}
                  aria-pressed={isChipActive}
                  aria-label={`ទិសដៅ ${chip.shortLabel || chip.label}`}
                  title={chip.promptText}
                  onClick={() => {
                    const res = togglePreset({ presetIds, targetId: chip.id, currentGenre: selectedGenre });
                    setPresetIds(res.nextPresetIds);
                    if (res.nextGenre !== selectedGenre) {
                      setSelectedGenre(res.nextGenre);
                    }
                  }}
                  style={{
                    padding: '3.5px 8px',
                    borderRadius: 6,
                    fontSize: '10.5px',
                    fontWeight: isChipActive ? 700 : 500,
                    fontFamily: "'Kantumruy Pro', 'Battambang', system-ui, sans-serif",
                    background: isChipActive
                      ? 'rgba(56, 189, 248, 0.2)'
                      : 'rgba(15, 23, 42, 0.75)',
                    color: isChipActive ? '#38bdf8' : '#cbd5e1',
                    border: isChipActive
                      ? '1px solid rgba(56, 189, 248, 0.55)'
                      : '1px solid rgba(255, 255, 255, 0.09)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <ChipIcon size={12} color={isChipActive ? '#38bdf8' : '#94a3b8'} />
                  <span>{chip.shortLabel || chip.label}</span>
                </button>
              );
            })}
          </div>

          <textarea
            rows={2}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={dubbingMode === 'dialogue'
              ? 'ឧ. រឿងភាគបុរាណចិន, តួប្រុសឈ្មោះ លីនហ្វេង...'
              : 'ឧ. សម្រាយបែបរន្ធត់ ជក់ចិត្ត ផ្តោតលើប្រយុទ្ធ...'}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 8,
              background: '#0a0d15', border: '1px solid #1e2536',
              color: '#f1f5f9', fontSize: '11px', resize: 'none',
              fontFamily: "'Kantumruy Pro', 'Battambang', system-ui, sans-serif",
              lineHeight: 1.5, boxSizing: 'border-box',
              outline: 'none', transition: 'all 0.15s ease',
            }}
            onFocus={(e) => e.target.style.borderColor = dubbingMode === 'dialogue' ? '#38bdf8' : '#c084fc'}
            onBlur={(e) => e.target.style.borderColor = '#1e2536'}
          />
        </div>


        {/* Dynamic 0% - 100% Progress Monitor Card (Only for current episode) */}
        {isThisEpisodeGeneratingScript && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%)',
              border: `1px solid ${displayProgress >= 100 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(56, 189, 248, 0.4)'}`,
              boxShadow: displayProgress >= 100 
                ? '0 6px 20px rgba(16, 185, 129, 0.15)' 
                : '0 6px 20px rgba(56, 189, 248, 0.15)',
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 10,
              transition: 'all 0.3s ease',
            }}
          >
            {/* Header: Status title and Big Tabular Percentage */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {smoothProgress >= 100 ? (
                  <div style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'rgba(16, 185, 129, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10b981',
                    flexShrink: 0,
                  }}>
                    <CheckCircle2 size={17} />
                  </div>
                ) : (
                  <div style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'rgba(56, 189, 248, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#38bdf8',
                    flexShrink: 0,
                  }}>
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {smoothProgress >= 100 ? '🎉 បង្កើត Script ជោគជ័យ 100%' : 'កំពុងវិភាគ & បង្កើត Script...'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: smoothProgress >= 100 ? '#34d399' : '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentStageText || 'ដំណើរការ AI Pipeline...'}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'flex-end',
                  gap: 1,
                  background: 'rgba(0, 0, 0, 0.35)',
                  padding: '2px 8px',
                  borderRadius: 6,
                  border: `1px solid ${smoothProgress >= 100 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.3)'}`,
                }}>
                  <span style={{
                    fontSize: '1.35rem',
                    fontWeight: 900,
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                    color: smoothProgress >= 100 ? '#10b981' : '#38bdf8',
                    textShadow: smoothProgress >= 100 
                      ? '0 0 14px rgba(16, 185, 129, 0.6)' 
                      : '0 0 12px rgba(56, 189, 248, 0.5)',
                    letterSpacing: '-0.02em',
                  }}>
                    {smoothProgress}
                  </span>
                  <span style={{
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    color: smoothProgress >= 100 ? '#34d399' : '#38bdf8',
                  }}>
                    %
                  </span>
                </div>
              </div>
            </div>

            {/* Glowing Progress Bar Track */}
            <div style={{
              width: '100%',
              height: 8,
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 9999,
              overflow: 'hidden',
              position: 'relative',
              marginBottom: 8,
            }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(3, Math.min(100, smoothProgress))}%`,
                  transition: 'width 0.22s ease-out',
                  background: displayProgress >= 100 
                    ? 'linear-gradient(90deg, #10b981, #34d399)'
                    : 'linear-gradient(90deg, rgba(59, 130, 246, 0.3), #38bdf8, rgba(6, 182, 212, 0.3))',
                  borderRadius: 9999,
                  boxShadow: displayProgress >= 100 
                    ? '0 0 14px rgba(16, 185, 129, 0.7)'
                    : '0 0 14px rgba(56, 189, 248, 0.5)',
                  opacity: displayProgress >= 100 ? 1 : 0.85,
                }}
              />
            </div>

            {/* 4-Step Visual Milestones (Grounded in Truthful Stages) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
              <div style={{
                padding: '4px 4px',
                borderRadius: 4,
                fontSize: '0.64rem',
                textAlign: 'center',
                background: smoothProgress >= 20 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 1 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
                color: smoothProgress >= 20 ? '#10b981' : (smoothProgress >= 1 ? '#38bdf8' : '#64748b'),
                fontWeight: smoothProgress >= 1 && smoothProgress < 20 ? 700 : 500,
                border: smoothProgress >= 1 && smoothProgress < 20 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
              }}>
                {smoothProgress >= 20 ? '✓ 1. Ingest' : '1. Ingest'}
              </div>
              <div style={{
                padding: '4px 4px',
                borderRadius: 4,
                fontSize: '0.64rem',
                textAlign: 'center',
                background: smoothProgress >= 50 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 20 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
                color: smoothProgress >= 50 ? '#10b981' : (smoothProgress >= 20 ? '#38bdf8' : '#64748b'),
                fontWeight: smoothProgress >= 20 && smoothProgress < 50 ? 700 : 500,
                border: smoothProgress >= 20 && smoothProgress < 50 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
              }}>
                {smoothProgress >= 50 ? '✓ 2. Chunks/OCR' : '2. Chunks/OCR'}
              </div>
              <div style={{
                padding: '4px 4px',
                borderRadius: 4,
                fontSize: '0.64rem',
                textAlign: 'center',
                background: smoothProgress >= 75 ? 'rgba(16, 185, 129, 0.15)' : (smoothProgress >= 50 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
                color: smoothProgress >= 75 ? '#10b981' : (smoothProgress >= 50 ? '#38bdf8' : '#64748b'),
                fontWeight: smoothProgress >= 50 && smoothProgress < 75 ? 700 : 500,
                border: smoothProgress >= 50 && smoothProgress < 75 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
              }}>
                {smoothProgress >= 75 ? '✓ 3. Gemini ASR' : '3. Gemini ASR'}
              </div>
              <div style={{
                padding: '4px 4px',
                borderRadius: 4,
                fontSize: '0.64rem',
                textAlign: 'center',
                background: smoothProgress >= 100 ? 'rgba(16, 185, 129, 0.2)' : (smoothProgress >= 75 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'),
                color: smoothProgress >= 100 ? '#10b981' : (smoothProgress >= 75 ? '#38bdf8' : '#64748b'),
                fontWeight: smoothProgress >= 75 ? 700 : 500,
                border: smoothProgress >= 75 ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
              }}>
                {smoothProgress >= 100 ? '✓ 4. Script Khmer' : '4. Script Khmer'}
              </div>
            </div>

            {/* Live Console Terminal Output (Nha requested: run 0-100 doch console dak jea UI mk) */}
            <div style={{
              background: '#090d16',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: 6,
              overflow: 'hidden',
              boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.7)',
            }}>
              {/* Console Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Terminal size={12} color="#38bdf8" />
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.04em' }}>
                    CONSOLE LOGS
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: smoothProgress >= 100 ? '#10b981' : '#38bdf8',
                    boxShadow: smoothProgress >= 100 ? '0 0 6px #10b981' : '0 0 6px #38bdf8',
                  }} />
                  <span style={{ fontSize: '0.62rem', color: smoothProgress >= 100 ? '#10b981' : '#38bdf8', fontWeight: 600 }}>
                    {smoothProgress >= 100 ? 'DONE' : 'LIVE'}
                  </span>
                </div>
              </div>

              {/* Console Terminal Lines */}
              <div style={{
                maxHeight: 120,
                overflowY: 'auto',
                padding: '6px 8px',
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                fontSize: '0.68rem',
                lineHeight: 1.5,
                color: '#cbd5e1',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}>
                <div style={{ color: '#64748b' }}>
                  [{new Date().toLocaleTimeString()}] [0%] 🚀 Start pipeline: Initializing AI session...
                </div>
                {smoothProgress >= 10 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [10%] 🔍 Ingest: ផ្ទៀងផ្ទាត់ទិន្នន័យវីដេអូ & រៀបចំ Folder ភាគ...
                  </div>
                )}
                {smoothProgress >= 20 && (
                  <div style={{ color: '#38bdf8' }}>
                    [{new Date().toLocaleTimeString()}] [20%] 📊 FFprobe: វិភាគ Duration & Audio Streams រួចរាល់
                  </div>
                )}
                {smoothProgress >= 25 && (
                  <div style={{ color: '#a78bfa' }}>
                    [{new Date().toLocaleTimeString()}] [25%] ✂️ Chunk Plan: បែងចែកជា Chunks 5 នាទី (ការពារ Rate Limit 429)
                  </div>
                )}
                {Array.isArray(scriptLogs) && scriptLogs.map((log, idx) => (
                  <div key={idx} style={{ color: log.message?.includes('401') || log.message?.includes('បរាជ័យ') ? '#f87171' : log.progress >= 70 ? '#34d399' : '#e2e8f0', display: 'flex', gap: 6 }}>
                    <span style={{ color: '#64748b' }}>[{new Date(log.time || Date.now()).toLocaleTimeString()}]</span>
                    <span style={{ color: '#38bdf8', fontWeight: 700 }}>[{log.progress || 0}%]</span>
                    <span>
                      {log.message?.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') || log.message?.includes('API key not valid')
                        ? '❌ Error 401: Key ក្នុង .env មិនត្រឹមត្រូវ (Key ត្រូវតែផ្ដើមដោយ AIzaSy... ពី aistudio.google.com)'
                        : log.message}
                    </span>
                  </div>
                ))}
                {smoothProgress < 100 && currentStageText && (
                  <div style={{ color: currentStageText.includes('401') || currentStageText.includes('បរាជ័យ') ? '#f87171' : '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: '#64748b' }}>[{new Date().toLocaleTimeString()}]</span>
                    <span style={{ color: '#fbbf24', fontWeight: 700 }}>[{smoothProgress}%]</span>
                    <span>
                      {currentStageText.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') || currentStageText.includes('API key not valid')
                        ? '❌ Error 401: Key ក្នុង .env មិនត្រឹមត្រូវ (Key ត្រូវតែផ្ដើមដោយ AIzaSy...)'
                        : currentStageText}
                    </span>
                    <span style={{ color: '#38bdf8', fontWeight: 900 }}>▍</span>
                  </div>
                )}
                {smoothProgress >= 100 && (
                  <div style={{ color: '#34d399', fontWeight: 700 }}>
                    [{new Date().toLocaleTimeString()}] [100%] 🎉 Script Khmer generated successfully!
                  </div>
                )}
                <div ref={consoleEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* Generate Button */}
        <button
          type="button"
          onClick={() => {
            if (!isThisEpisodeGeneratingScript && selectedVideo) {
              if (hasExistingScript) {
                setShowConfirmRetranslate(true);
                return;
              }
              handleTriggerScript({ narratorGender, genre: selectedGenre, generationMode, customPrompt: effectiveDirectionPrompt });
            }
          }}
          disabled={isThisEpisodeGeneratingScript || !selectedVideo}
          className="btn-primary"
          style={{
            width: '100%',
            minHeight: 40,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '12.5px',
            cursor: isThisEpisodeGeneratingScript || !selectedVideo ? 'not-allowed' : 'pointer',
            opacity: !selectedVideo ? 0.5 : 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            {isThisEpisodeGeneratingScript ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>[{smoothProgress}%] {currentStageText || 'កំពុងបកប្រែ Script...'}</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>
                  {dubbingMode === 'dialogue'
                    ? 'បកប្រែ Script សន្ទនា (Generate)'
                    : 'បង្កើត Script សម្រាយរឿង (Generate)'}
                </span>
              </>
            )}
          </div>
        </button>

        {activeEpisode && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <DubbingStepButton
              step="all3"
              episodes={[activeEpisode]}
              variant="card"
              setupOptions={{
                pipelineMode: generationMode,
                dubbingMode,
                genre: selectedGenre,
                narratorGender,
              }}
            />
          </div>
        )}

        {!selectedVideo && (
          <div style={{
            fontSize: '0.72rem',
            color: '#94a3b8',
            textAlign: 'center',
            marginTop: 6,
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px dashed rgba(255, 255, 255, 0.1)',
          }}>
            ⚠️ សូមជ្រើសរើសវីដេអូនៅជំហានទី 1 ជាមុនសិន (Please select a video in Step 1)
          </div>
        )}

      </div>
      )}
      </>
      )}

      {scriptError && (
        <div
          className="error-banner"
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <AlertCircle size={16} color="#f87171" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fca5a5', marginBottom: 2 }}>
              ដំណើរការមិនជោគជ័យ (Generation Failed)
            </div>
            <div style={{ fontSize: '0.73rem', color: '#fecaca', lineHeight: 1.45, wordBreak: 'break-word' }}>
              {scriptError}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isThisEpisodeGeneratingScript && selectedVideo) {
                handleTriggerScript({ narratorGender, genre: selectedGenre, generationMode, customPrompt: effectiveDirectionPrompt });
              }
            }}
            disabled={isThisEpisodeGeneratingScript || !selectedVideo}
            style={{
              flexShrink: 0,
              padding: '5px 9px',
              borderRadius: 6,
              border: '1px solid rgba(248, 113, 113, 0.4)',
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#fee2e2',
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: isThisEpisodeGeneratingScript || !selectedVideo ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <RefreshCw size={11} />
            <span>ព្យាយាមម្ដងទៀត (Retry)</span>
          </button>
        </div>
      )}

      {/* Re-Translate Overwrite Confirmation Modal */}
      {showConfirmRetranslate && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowConfirmRetranslate(false)}
        >
          <div
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '20px 24px',
              maxWidth: 440,
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: '14px', color: 'var(--ink)', fontWeight: 600 }}>
              <AlertCircle size={18} color="var(--color-warning)" />
              <span>បញ្ជាក់ការ Re-Translate (Confirm Overwrite)</span>
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-dim)', lineHeight: 1.5 }}>
              ⚠️ ដំណើរការនេះនឹងលុប Script និង Subtitle ដែលបានកែប្រែដោយដៃចោល ហើយបង្កើត Subtitle ថ្មីឡើងវិញ។
              <br /><br />
              • Script ចាស់នឹងត្រូវ Auto-Backup ទុកក្នុង folder backups។
              <br />
              • តើអ្នកពិតជាចង់បន្តមែនទេ?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setShowConfirmRetranslate(false)}
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: 'transparent',
                  color: 'var(--ink-dim)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmRetranslate(false);
                  handleTriggerScript({ narratorGender, genre: selectedGenre, generationMode, customPrompt: effectiveDirectionPrompt, force: true, confirmed: true });
                }}
                style={{
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#0284c7',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                បាទ/ចាស, Re-Translate ឥឡូវនេះ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Custom Studio Auto-Compact Confirmation Modal ── */}
      {showCompactConfirm && (
        <div
          data-testid="modal-dubbing-compact-confirm"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: 16,
          }}
          onClick={() => !isAutoCompacting && setShowCompactConfirm(false)}
        >
          <div
            style={{
              background: 'linear-gradient(180deg, #181428 0%, #0f121d 100%)',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              borderRadius: 12,
              padding: '22px 24px',
              maxWidth: 460,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 24px 50px rgba(0, 0, 0, 0.8), 0 0 25px rgba(168, 85, 247, 0.2)',
              color: '#f1f5f9',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.92rem', fontWeight: 800, color: '#f3e8ff' }}>
                <Sparkles size={18} color="#c084fc" />
                <span>បម្លែងគ្រប់ Script ជា «ខ្លីចំអត្ថន័យ» (Auto Compact)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCompactConfirm(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.80rem', color: '#cbd5e1', lineHeight: 1.55 }}>
              <div style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.25)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontWeight: 700, color: '#e9d5ff', fontSize: '0.84rem' }}>
                  តើអ្នកចង់បម្លែងគ្រប់ Script ទាំង {scriptData?.segments?.length || 0} ឃ្លា?
                </div>
                <div style={{ color: '#d8b4fe', fontSize: '0.76rem' }}>
                  AI នឹងបកប្រែឡើងវិញជាភាសា Subtitle ខ្លី ចំខ្លឹមសារ ១០០% (បែបកុនចិន/ហុងកុង ទំនើប)
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingLeft: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>ខ្លី ចំអត្ថន័យ ១០០%៖</strong> កាត់បន្ថយពាក្យសម្ដីវែងអូសបន្លាយឥតប្រយោជន៍</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>Lip-sync ត្រូវមាត់៖</strong> ជួយឱ្យសំឡេង AI និយាយរលូន មិនហៀរជាន់ឃ្លាបន្ទាប់</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>Auto-Save៖</strong> រក្សាទុកទិន្នន័យដោយស្វ័យប្រវត្តក្នុង project</span>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <button
                type="button"
                onClick={() => setShowCompactConfirm(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  background: 'transparent',
                  color: '#94a3b8',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                data-testid="btn-confirm-compact-now-dubbing"
                onClick={() => {
                  setShowCompactConfirm(false);
                  executeAutoCompact();
                }}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  border: '1px solid rgba(168, 85, 247, 0.7)',
                  background: 'linear-gradient(135deg, #9333ea 0%, #7c3aed 100%)',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 10px rgba(147, 51, 234, 0.4)',
                }}
              >
                <Sparkles size={14} />
                <span>បម្លែងទាំងអស់ឥឡូវនេះ (Start Auto Compact)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-TTS Confirmation Modal (Prevents accidental 500-segment overwrite) */}
      {showConfirmReTts && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowConfirmReTts(false)}
        >
          <div
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '20px 24px',
              maxWidth: 460,
              width: '92%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: '14px', color: 'var(--ink)', fontWeight: 600 }}>
              <AlertCircle size={18} color="var(--color-warning)" />
              <span>បញ្ជាក់ការបង្កើតសំឡេង AI ឡើងវិញ (Confirm Re-TTS)</span>
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-dim)', lineHeight: 1.5 }}>
              ភាគនេះមានសំឡេងខ្មែរ AI រួចរាល់ហើយ ({validTextSegments.length} ឃ្លា)។
              <br /><br />
              • <strong>Smart Sync:</strong> រក្សាសំឡេងដើមទាំងអស់ និងបង្កើតតែឃ្លាដែលខ្វះ ឬទើបកែប្រែប៉ុណ្ណោះ។
              <br />
              • <strong>Force Re-TTS ទាំងអស់:</strong> បង្កើតសំឡេងថ្មីទាំង {validTextSegments.length} ឃ្លាឡើងវិញ (ត្រូវការពេលយូរ)។
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowConfirmReTts(false)}
                style={{
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: 'transparent',
                  color: 'var(--ink-dim)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmReTts(false);
                  onNavigateToVoice?.({ forceRegen: false });
                }}
                style={{
                  height: 34,
                  padding: '0 14px',
                  borderRadius: 6,
                  border: '1px solid rgba(52, 211, 153, 0.4)',
                  background: 'rgba(16, 185, 129, 0.16)',
                  color: '#34d399',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Smart Sync (រក្សាសំឡេងដើម)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmReTts(false);
                  onNavigateToVoice?.({ forceRegen: true });
                }}
                style={{
                  height: 34,
                  padding: '0 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#e11d48',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Re-TTS ទាំងអស់ ({validTextSegments.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Custom Studio Auto-Compact Confirmation Modal ── */}
      {showCompactConfirm && (
        <div
          data-testid="modal-dubbing-compact-confirm"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: 16,
          }}
          onClick={() => !isAutoCompacting && setShowCompactConfirm(false)}
        >
          <div
            style={{
              background: 'linear-gradient(180deg, #181428 0%, #0f121d 100%)',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              borderRadius: 12,
              padding: '22px 24px',
              maxWidth: 460,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 24px 50px rgba(0, 0, 0, 0.8), 0 0 25px rgba(168, 85, 247, 0.2)',
              color: '#f1f5f9',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.92rem', fontWeight: 800, color: '#f3e8ff' }}>
                <Sparkles size={18} color="#c084fc" />
                <span>បម្លែងគ្រប់ Script ជា «ខ្លីចំអត្ថន័យ» (Auto Compact)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCompactConfirm(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.80rem', color: '#cbd5e1', lineHeight: 1.55 }}>
              <div style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.25)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontWeight: 700, color: '#e9d5ff', fontSize: '0.84rem' }}>
                  តើអ្នកចង់បម្លែងគ្រប់ Script ទាំង {scriptData?.segments?.length || 0} ឃ្លា?
                </div>
                <div style={{ color: '#d8b4fe', fontSize: '0.76rem' }}>
                  AI នឹងបកប្រែឡើងវិញជាភាសា Subtitle ខ្លី ចំខ្លឹមសារ ១០០% (បែបកុនចិន/ហុងកុង ទំនើប)
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingLeft: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>ខ្លី ចំអត្ថន័យ ១០០%៖</strong> កាត់បន្ថយពាក្យសម្ដីវែងអូសបន្លាយឥតប្រយោជន៍</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>Lip-sync ត្រូវមាត់៖</strong> ជួយឱ្យសំឡេង AI និយាយរលូន មិនហៀរជាន់ឃ្លាបន្ទាប់</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span><strong>Auto-Save៖</strong> រក្សាទុកទិន្នន័យដោយស្វ័យប្រវត្តក្នុង project</span>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <button
                type="button"
                onClick={() => setShowCompactConfirm(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  background: 'transparent',
                  color: '#94a3b8',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                data-testid="btn-confirm-compact-now-dubbing"
                onClick={() => {
                  setShowCompactConfirm(false);
                  executeAutoCompact();
                }}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  border: '1px solid rgba(168, 85, 247, 0.7)',
                  background: 'linear-gradient(135deg, #9333ea 0%, #7c3aed 100%)',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 10px rgba(147, 51, 234, 0.4)',
                }}
              >
                <Sparkles size={14} />
                <span>បម្លែងទាំងអស់ឥឡូវនេះ (Start Auto Compact)</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
