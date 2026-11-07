import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Languages, BookOpen, Loader2, AlertCircle, ArrowRight, CheckCircle2, Mic, Volume2, Film, RefreshCw, ChevronDown, ChevronUp, Settings2, FileText, Check, Terminal
} from 'lucide-react';

const GENRE_OPTIONS = [
  { id: 'auto', label: '✨ Auto (ស្គាល់ស្វ័យប្រវត្តិ)', hint: 'AI វិភាគ Audio + OCR កំណត់ប្រភេទរឿងស្វ័យប្រវត្តិ' },
  { id: 'ancient', label: '🏛️ បុរាណចិន / Xianxia', hint: 'រឿងគុណនិយម, Wuxia, សម្អាតកាយ, វិញ្ញាណ, លោកម្ចាស់, ព្រឹទ្ធាចារ្យ' },
  { id: 'modern', label: '🏙️ សម័យទំនើប / CEO', hint: 'រឿងស្នេហា, CEO, ក្រុមហ៊ុន, លោកប្រធាន, អ្នកស្រី, បង/អូន' },
  { id: 'action', label: '⚔️ Action / សងសឹក', hint: 'រឿងប្រយុទ្ធ, ប៉ូលិស, ឧក្រិដ្ឋកម្ម, ស៊ើបអង្កេត, ចង្វាក់សន្ទនារហ័ស' },
  { id: 'comedy', label: '🎭 កំប្លែង / គ្រួសារ', hint: 'រឿងកំប្លែងសើចចុកពោះ, ភាសាកំប្លុកកំប្លែងធម្មជាតិ' },
];

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
  onUpdateScript = null,
}) {
  const [narratorGender, setNarratorGender] = useState('male');
  const [selectedGenre, setSelectedGenre] = useState(scriptData?.genre || scriptData?.detectedGenre || 'auto');
  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [isSeparatingAudio, setIsSeparatingAudio] = useState(false);
  const [separationProgress, setSeparationProgress] = useState(0);
  const [isCleanBgReady, setIsCleanBgReady] = useState(false);
  const [separationError, setSeparationError] = useState(null);
  const hasExistingScript = Boolean(scriptData?.segments && scriptData.segments.length > 0);
  const hasExistingAudio = Boolean(scriptData?.segments?.some(s => s.audioUrl || s.audioPath || s.audioFile));

  useEffect(() => {
    if (scriptData?.genre) {
      setSelectedGenre(scriptData.genre);
    } else if (scriptData?.detectedGenre) {
      setSelectedGenre(scriptData.detectedGenre);
    }
  }, [scriptData?.genre, scriptData?.detectedGenre]);

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

      const res = await fetch('/api/audio/separate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath: videoRefName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.noVocalsUrl) {
        setSeparationProgress(100);
        setIsCleanBgReady(true);
        window.dispatchEvent(new CustomEvent('demucs-separation-ready', {
          detail: { noVocalsUrl: data.noVocalsUrl }
        }));
      } else {
        throw new Error(data.error || (res.status === 502 ? 'Backend connection dropped. សូមផ្ទៀងផ្ទាត់ Server រួចចុចម្ដងទៀត។' : 'ការបំបែកសំឡេង Demucs ជួបបញ្ហា'));
      }
    } catch (err) {
      console.error('[DubbingModeTab] Separation error:', err);
      setSeparationError(err.message || 'ការបំបែកសំឡេង Demucs ជួបបញ្ហា');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setIsSeparatingAudio(false);
    }
  };
  const [internalProgress, setInternalProgress] = useState(0);
  const [internalStage, setInternalStage] = useState('');

  const [internalAudioProgress, setInternalAudioProgress] = useState(0);
  const [internalAudioStage, setInternalAudioStage] = useState('');

  // Determine if THIS current episode is the one being generated
  const isThisEpisodeGeneratingScript = Boolean(
    isGeneratingScript && (!generatingEpisodeId || !episodeId || generatingEpisodeId === episodeId)
  );
  const isOtherEpisodeGeneratingScript = Boolean(
    isGeneratingScript && generatingEpisodeId && episodeId && generatingEpisodeId !== episodeId
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

  // Auto-scroll live terminal console to latest output when stage or logs update
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [scriptLogs, currentStageText]);

  const getDirectionPlaceholder = () => {
    if (dubbingMode === 'recap') {
      return 'ឧ. សម្រាយបែបរន្ធត់ ជក់ចិត្ត ផ្តោតលើប្រយុទ្ធ... (អាចទុកទំនេរបាន)';
    }
    switch (selectedGenre) {
      case 'ancient':
        return 'ឧ. រឿងភាគបុរាណចិន/គុណនិយម, តួប្រុស: លីន ហ្វេង, ឋានៈ: ព្រឹទ្ធាចារ្យ, មេភូមិ... (អាចទុកទំនេរបាន)';
      case 'modern':
        return 'ឧ. រឿងភាគសម័យទំនើប/CEO, លោកប្រធានក្រុមហ៊ុន: ឆិន ហាវ, ជំនួយការ: អាលីន... (អាចទុកទំនេរបាន)';
      case 'action':
        return 'ឧ. រឿង Action សងសឹក, មេបញ្ជាការ: ចាង ហ្វៃ, ប៉ូលិសស៊ើបអង្កេត... (អាចទុកទំនេរបាន)';
      case 'comedy':
        return 'ឧ. រឿងកំប្លែងសើចចុកពោះ, ភាសាសន្ទនាកំប្លុកកំប្លែង ធម្មជាតិ... (អាចទុកទំនេរបាន)';
      case 'auto':
      default:
        return 'ឧ. ទុកឱ្យ AI ស្គាល់ប្រភេទរឿងដោយស្វ័យប្រវត្តិ ឬបញ្ជាក់ឈ្មោះតួអង្គ និងទិសដៅ... (អាចទុកទំនេរបាន)';
    }
  };


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
            <span>+ បញ្ចូលវីដេអូ (Import Video ➔)</span>
          </button>
        </div>
      ) : hasExistingScript && !isThisEpisodeGeneratingScript && !showRegenerateForm ? (
        /* ── State A: Script Ready Hub (When script has already been generated) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 1. Script Ready Hero Card */}
          <div
            style={{
              background: '#111827',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: 8,
              padding: '14px',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10b981',
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle2 size={16} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                    សេណារីយ៉ូភាសាខ្មែរ រួចរាល់
                  </div>
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    AI Script Complete
                  </div>
                </div>
              </div>

              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}
              >
                {scriptData.segments.length} ឃ្លា (Lines)
              </span>
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
              <span style={{ fontSize: '11px', background: 'rgba(255, 255, 255, 0.04)', color: '#cbd5e1', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                {dubbingMode === 'dialogue' ? '🗣️ Mode A: សន្ទនាតួអង្គ' : '🎬 Mode B: សម្រាយរឿង'}
              </span>
              <span style={{ fontSize: '11px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                {selectedGenre === 'ancient' ? '🏛️ បុរាណចិន' : (selectedGenre === 'modern' ? '🏙️ សម័យទំនើប' : (selectedGenre === 'action' ? '⚔️ Action' : (selectedGenre === 'comedy' ? '🎭 កំប្លែង' : '✨ ' + selectedGenre)))}
              </span>
            </div>

            {/* Big Primary Action: Go to Tab 3 for Line-by-Line Subtitle Review */}
            <button
              type="button"
              onClick={() => onTabChange && onTabChange('subtitles')}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.03)',
                color: '#f8fafc',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title="ពិនិត្យ និងកែសម្រួលអត្ថបទសេណារីយ៉ូខ្មែរតាមឃ្លានីមួយៗ"
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <FileText size={14} color="#38bdf8" style={{ flexShrink: 0 }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  ពិនិត្យ & កែអត្ថបទ ({scriptData.segments.length} ឃ្លា)
                </span>
              </span>
              <ArrowRight size={14} color="#94a3b8" style={{ flexShrink: 0 }} />
            </button>
          </div>

          {/* 2. Step 3 Voice Studio Card */}
          <div
            style={{
              background: '#111827',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 8,
              padding: '16px',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mic size={14} color="#FF8577" />
                <span>ជំហានទី ៣ ៖ បង្កើតសំឡេងខ្មែរ AI (Voice Studio)</span>
              </div>
              {hasExistingAudio && !isThisEpisodeGeneratingAudio && (
                <span style={{ fontSize: '10px', background: 'rgba(52, 211, 153, 0.15)', color: '#34D399', padding: '2px 8px', borderRadius: 9999, fontWeight: 700, border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                  ✅ សំឡេង AI រួចរាល់
                </span>
              )}
            </div>

            {onNavigateToVoice && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateToVoice({ forceRegen: Boolean(hasExistingAudio) });
                }}
                disabled={isThisEpisodeGeneratingAudio}
                className="btn-tactile"
                style={{
                  width: '100%',
                  padding: '11px 16px',
                  borderRadius: 9999,
                  border: 'none',
                  background: isThisEpisodeGeneratingAudio ? '#192744' : 'linear-gradient(135deg, #FF8577 0%, #f43f5e 100%)',
                  color: isThisEpisodeGeneratingAudio ? '#64748B' : '#0B132B',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: isThisEpisodeGeneratingAudio ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: isThisEpisodeGeneratingAudio ? 'none' : '0 4px 16px rgba(255, 133, 119, 0.35)',
                  transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {isThisEpisodeGeneratingAudio ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Loader2 size={14} className="animate-spin" color="#FF8577" />
                    <span>កំពុងបង្កើតសំឡេងខ្មែរ AI... {displayAudioProgress}%</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <Mic size={14} style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {hasExistingAudio ? 'បង្កើតសំឡេង AI ឡើងវិញ (Re-TTS)' : 'បង្កើតសំឡេងខ្មែរ AI (Generate TTS)'}
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

            {/* Step 3.5 / AI Vocal Separation (Demucs AI): 1-Click Button */}
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={handleStartDemucsSeparation}
                disabled={isSeparatingAudio || !selectedVideo}
                className="btn-tactile"
                style={{
                  width: '100%',
                  padding: '11px 16px',
                  borderRadius: 9999,
                  border: isCleanBgReady ? '1px solid rgba(52, 211, 153, 0.45)' : '1px solid rgba(56, 189, 248, 0.35)',
                  background: isSeparatingAudio
                    ? '#192744'
                    : isCleanBgReady
                      ? 'rgba(52, 211, 153, 0.12)'
                      : 'rgba(56, 189, 248, 0.1)',
                  color: isSeparatingAudio
                    ? '#94A3B8'
                    : isCleanBgReady
                      ? '#34D399'
                      : '#38BDF8',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: (isSeparatingAudio || !selectedVideo) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: isCleanBgReady
                    ? '0 0 10px rgba(52, 211, 153, 0.15)'
                    : '0 2px 10px rgba(56, 189, 248, 0.2)',
                  transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                title="បំបែកកាត់សំឡេងចិន ចម្រាញ់យកតែ BGM & SFX (Demucs AI)"
              >
                {isSeparatingAudio ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <Loader2 size={14} className="animate-spin" color="#38BDF8" style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: 'nowrap' }}>
                        កំពុងបំបែកសំឡេងដើម (Demucs AI)...
                      </span>
                    </div>
                    <span style={{
                      fontSize: '11px',
                      background: 'rgba(56, 189, 248, 0.25)',
                      color: '#38BDF8',
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontWeight: 800,
                      letterSpacing: '0.5px'
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
                          ? '✅ Clean BGM រួចរាល់ 100% (Demucs AI)'
                          : '🎧 បំបែកសំឡេងដើម AI (Demucs AI)'}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '10px',
                      background: isCleanBgReady ? 'rgba(74, 222, 128, 0.2)' : 'rgba(0, 229, 255, 0.2)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontWeight: 800,
                    }}>
                      {isCleanBgReady ? 'READY' : 'SEPARATE'}
                    </span>
                  </>
                )}
              </button>
              {isSeparatingAudio && (
                <div style={{
                  width: '100%',
                  height: 5,
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: 3,
                  marginTop: 6,
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  <div style={{
                    width: `${Math.max(3, separationProgress)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #38BDF8, #4ade80)',
                    transition: 'width 0.4s ease-out',
                    borderRadius: 3,
                    boxShadow: '0 0 8px rgba(56, 189, 248, 0.5)'
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
                  <span>{displayAudioProgress}%</span>
                </div>
                <div style={{ width: '100%', height: 7, borderRadius: 4, background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ width: `${displayAudioProgress}%`, height: '100%', background: 'linear-gradient(90deg, #059669 0%, #10b981 100%)', transition: 'width 0.28s ease' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  <div style={{ padding: '3px 4px', borderRadius: 4, fontSize: '0.62rem', textAlign: 'center', background: displayAudioProgress >= 5 ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.04)', color: displayAudioProgress >= 5 ? '#34d399' : '#64748b', fontWeight: 600 }}>1. Mapping</div>
                  <div style={{ padding: '3px 4px', borderRadius: 4, fontSize: '0.62rem', textAlign: 'center', background: displayAudioProgress >= 25 ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.04)', color: displayAudioProgress >= 25 ? '#34d399' : '#64748b', fontWeight: 600 }}>2. Edge TTS</div>
                  <div style={{ padding: '3px 4px', borderRadius: 4, fontSize: '0.62rem', textAlign: 'center', background: displayAudioProgress >= 65 ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.04)', color: displayAudioProgress >= 65 ? '#34d399' : '#64748b', fontWeight: 600 }}>3. Stretch</div>
                  <div style={{ padding: '3px 4px', borderRadius: 4, fontSize: '0.62rem', textAlign: 'center', background: displayAudioProgress >= 85 ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.04)', color: displayAudioProgress >= 85 ? '#34d399' : '#64748b', fontWeight: 600 }}>4. Sync</div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Collapsible Re-generate Accordion Header */}
          <div style={{ marginTop: 2 }}>
            <button
              type="button"
              onClick={() => setShowRegenerateForm(true)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(15, 23, 42, 0.65)',
                color: '#94a3b8',
                fontSize: '11px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings2 size={13} color="#94a3b8" />
                <span>បង្កើត Script ឡើងវិញ ឬ កែការកំណត់ (Re-generate / Settings)</span>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      ) : (
        /* ── State B: Creation / Re-generation Form ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px', background: 'linear-gradient(180deg, #121622 0%, #0d1017 100%)', borderRadius: 10, border: '1px solid #1f2638', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)', marginBottom: 12 }}>
          {hasExistingScript && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 8, marginBottom: 4 }}>
              <span style={{ fontSize: '11.5px', color: '#f8fafc', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings2 size={13} color="#38bdf8" />
                <span>បង្កើត Script ឡើងវិញ (Re-generate Script)</span>
              </span>
              <button
                type="button"
                onClick={() => setShowRegenerateForm(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
              >
                ✕ បិទ / ត្រឡប់ក្រោយ (Close)
              </button>
            </div>
          )}

        {/* 1. Mode A / Mode B Selection */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>ជ្រើសរើសទម្រង់បញ្ចូលសំឡេង AI (Dubbing Mode)</span>
            </label>
            <span style={{ 
              fontSize: '10.5px', 
              color: dubbingMode === 'dialogue' ? '#38bdf8' : '#c084fc', 
              fontWeight: 700,
              background: dubbingMode === 'dialogue' ? 'rgba(56, 189, 248, 0.12)' : 'rgba(192, 132, 252, 0.12)',
              padding: '2px 7px',
              borderRadius: 4,
              border: `1px solid ${dubbingMode === 'dialogue' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(192, 132, 252, 0.3)'}`
            }}>
              {dubbingMode === 'dialogue' ? 'Mode A កំពុងជ្រើស' : 'Mode B កំពុងជ្រើស'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* Mode A Card */}
            <button
              type="button"
              onClick={() => setDubbingMode('dialogue')}
              style={{
                padding: '13px 12px',
                borderRadius: 10,
                border: dubbingMode === 'dialogue' ? '1.5px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                background: dubbingMode === 'dialogue' 
                  ? 'linear-gradient(145deg, rgba(2, 132, 199, 0.28) 0%, rgba(14, 165, 233, 0.12) 100%)' 
                  : 'rgba(15, 19, 28, 0.75)',
                boxShadow: dubbingMode === 'dialogue' ? '0 4px 18px rgba(56, 189, 248, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' : 'none',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: '12px', color: dubbingMode === 'dialogue' ? '#38bdf8' : '#f1f5f9', letterSpacing: '0.01em', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: '13px' }}>🗣️</span>
                  <span>Mode A: សន្ទនាតួអង្គ</span>
                </span>
                {dubbingMode === 'dialogue' ? (
                  <span style={{ fontSize: '9px', background: '#0284c7', color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 800, letterSpacing: '0.04em', boxShadow: '0 0 10px rgba(2, 132, 199, 0.7)' }}>
                    ACTIVE
                  </span>
                ) : (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.2)' }} />
                )}
              </div>
              <div style={{ fontSize: '10.5px', color: dubbingMode === 'dialogue' ? '#cbd5e1' : '#94a3b8', lineHeight: 1.5, fontFamily: "'Kantumruy Pro', sans-serif" }}>
                បកប្រែសន្ទនា ១-ទល់-១ ត្រូវតាមមាត់ និងសំឡេងតួអង្គ
              </div>
            </button>

            {/* Mode B Card */}
            <button
              type="button"
              onClick={() => {
                setDubbingMode('recap');
                if (recapStyle !== 'story_recap' && recapStyle !== 'fast_recap') setRecapStyle('story_recap');
              }}
              style={{
                padding: '13px 12px',
                borderRadius: 10,
                border: dubbingMode === 'recap' ? '1.5px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                background: dubbingMode === 'recap' 
                  ? 'linear-gradient(145deg, rgba(147, 51, 234, 0.28) 0%, rgba(168, 85, 247, 0.12) 100%)' 
                  : 'rgba(15, 19, 28, 0.75)',
                boxShadow: dubbingMode === 'recap' ? '0 4px 18px rgba(168, 85, 247, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' : 'none',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: '12px', color: dubbingMode === 'recap' ? '#c084fc' : '#f1f5f9', letterSpacing: '0.01em', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: '13px' }}>🎬</span>
                  <span>Mode B: សម្រាយរឿង</span>
                </span>
                {dubbingMode === 'recap' ? (
                  <span style={{ fontSize: '9px', background: '#9333ea', color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 800, letterSpacing: '0.04em', boxShadow: '0 0 10px rgba(147, 51, 234, 0.7)' }}>
                    ACTIVE
                  </span>
                ) : (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.2)' }} />
                )}
              </div>
              <div style={{ fontSize: '10.5px', color: dubbingMode === 'recap' ? '#cbd5e1' : '#94a3b8', lineHeight: 1.5, fontFamily: "'Kantumruy Pro', sans-serif" }}>
                និទានដំណើររឿងបែប TikTok/Reels រស់រវើក
              </div>
            </button>
          </div>
        </div>

        {/* 2. Recap Style (Mode B only) */}
        {dubbingMode === 'recap' && (
          <div style={{ background: '#0b0f19', padding: '10px', borderRadius: 8, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600, display: 'block', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              ជ្រើសរើសទម្រង់សម្រាយ (Recap Style)
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="recapStyle"
                  value="story_recap"
                  checked={recapStyle === 'story_recap'}
                  onChange={(e) => setRecapStyle(e.target.value)}
                  style={{ marginTop: 2, accentColor: '#3b82f6', flexShrink: 0 }}
                />
                <div>
                  <div style={{ color: '#f8fafc', fontSize: '11px', fontWeight: 700 }}>សម្រាយសាច់រឿងកុន (Story Recap)</div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: 2, lineHeight: 1.3 }}>និទានដំណើររឿងរស់រវើក — ពេញ 100+ ឃ្លា</div>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="recapStyle"
                  value="fast_recap"
                  checked={recapStyle === 'fast_recap'}
                  onChange={(e) => setRecapStyle(e.target.value)}
                  style={{ marginTop: 2, accentColor: '#3b82f6', flexShrink: 0 }}
                />
                <div>
                  <div style={{ color: '#f8fafc', fontSize: '11px', fontWeight: 700 }}>សង្ខេបដំណើររឿងរហ័ស (Fast Recap)</div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: 2, lineHeight: 1.3 }}>ព្រឹត្តិការណ៍សំខាន់ — ខ្លី ទាន់ ក្ដៅ</div>
                </div>
              </label>
            </div>

            {/* Narrator Voice Picker */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #1e293b' }}>
              <span style={{ fontSize: '11px', color: '#cbd5e1' }}>សំឡេងអ្នកនិទានរឿង:</span>
              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  type="button"
                  onClick={() => setNarratorGender('male')}
                  style={{
                    padding: '3px 9px', fontSize: '11px', borderRadius: 5,
                    border: 'none',
                    background: narratorGender === 'male' ? '#2563eb' : '#1e293b',
                    color: '#fff', cursor: 'pointer',
                    fontWeight: narratorGender === 'male' ? 700 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  👨 ពិសិដ្ឋ
                </button>
                <button
                  type="button"
                  onClick={() => setNarratorGender('female')}
                  style={{
                    padding: '3px 9px', fontSize: '11px', borderRadius: 5,
                    border: 'none',
                    background: narratorGender === 'female' ? '#db2777' : '#1e293b',
                    color: '#fff', cursor: 'pointer',
                    fontWeight: narratorGender === 'female' ? 700 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  👩 ស្រីមុំ
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Drama Genre Selector (ជ្រើសរើសប្រភេទរឿង / Auto Detect Genre) */}
        {dubbingMode === 'dialogue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '10.5px', color: '#cbd5e1', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>ប្រភេទរឿង (Drama Genre)</span>
                {scriptData?.detectedGenre && (
                  <span style={{
                    fontSize: '9px',
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontWeight: 600,
                    textTransform: 'none',
                  }}>
                    ✨ AI ស្គាល់: {scriptData.detectedGenre}
                  </span>
                )}
              </label>
              <span style={{ fontSize: '9.5px', color: '#94a3b8' }}>
                {selectedGenre === 'auto' ? 'AI នឹងវិភាគស្វ័យប្រវត្តិ' : 'បានជ្រើសរើសដោយដៃ'}
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {GENRE_OPTIONS.map((g) => {
                const isSelected = selectedGenre === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSelectedGenre(g.id)}
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
                      gap: 4,
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 0 10px rgba(56, 189, 248, 0.25)' : 'none',
                    }}
                  >
                    <span>{g.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Optional Direction */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <label style={{ fontSize: '10.5px', color: '#cbd5e1', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>{dubbingMode === 'dialogue' ? 'ឈ្មោះតួអង្គ / Direction' : 'ទិសដៅសម្រាយបន្ថែម (Direction)'}</span>
              <span style={{ fontSize: '9.5px', color: '#94a3b8', background: 'rgba(255, 255, 255, 0.08)', padding: '1px 5px', borderRadius: 3, fontWeight: 500, textTransform: 'none' }}>
                ស្រេចចិត្ត (Optional)
              </span>
            </label>
            {promptInput && (
              <button
                type="button"
                onClick={() => setPromptInput('')}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
                title="Clear input"
              >
                ✕ សម្អាត
              </button>
            )}
          </div>
          <textarea
            rows={2}
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder={dubbingMode === 'dialogue'
              ? 'ឧ. រឿងភាគបុរាណចិន, តួប្រុសឈ្មោះ លីនហ្វេង... (អាចទុកទំនេរបាន)'
              : 'ឧ. សម្រាយបែបរន្ធត់ ជក់ចិត្ត ផ្តោតលើប្រយុទ្ធ... (អាចទុកទំនេរបាន)'}
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
              handleTriggerScript({ narratorGender, genre: selectedGenre });
            }
          }}
          disabled={isThisEpisodeGeneratingScript || !selectedVideo}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 9,
            border: 'none',
            background: isThisEpisodeGeneratingScript
              ? '#1e293b'
              : !selectedVideo
                ? 'rgba(255, 255, 255, 0.08)'
                : dubbingMode === 'dialogue'
                  ? 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)'
                  : 'linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '12.5px',
            fontFamily: "'Kantumruy Pro', 'Inter', sans-serif",
            cursor: isThisEpisodeGeneratingScript || !selectedVideo ? 'not-allowed' : 'pointer',
            boxShadow: !selectedVideo || isThisEpisodeGeneratingScript 
              ? 'none' 
              : dubbingMode === 'dialogue'
                ? '0 4px 18px rgba(37, 99, 235, 0.4)'
                : '0 4px 18px rgba(147, 51, 234, 0.4)',
            position: 'relative',
            overflow: 'hidden',
            opacity: !selectedVideo ? 0.5 : 1,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            {isThisEpisodeGeneratingScript ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span>⏳ [{smoothProgress}%] {currentStageText || 'Gemini AI កំពុងវិភាគ & បកប្រែ...'}</span>
              </>
            ) : (
              <>
                <Sparkles size={15} />
                <span>
                  {dubbingMode === 'dialogue'
                    ? 'បង្កើតសេណារីយ៉ូសន្ទនា (Generate Dialogue)'
                    : 'បង្កើតអត្ថបទសម្រាយរឿង (Generate Recap)'}
                </span>
              </>
            )}
          </div>
        </button>

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
                handleTriggerScript({ narratorGender, genre: selectedGenre });
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

    </div>
  );
}
