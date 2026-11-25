import React from 'react';
import { Loader2, Play, Square, Check, RotateCcw } from 'lucide-react';
import { useDubbingFeature } from './useDubbingFeature';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  checkEpisodeHasAutoFitReady,
} from '../../components/dashboard/geminiRouteHelpers';

/**
 * DubbingStepButton:
 * Universal step button used across all pages:
 * <DubbingStepButton step="translate | voice | clean_bgm | all3" episodes={[ep]} variant="card | pill | full" />
 */
export default function DubbingStepButton({
  step = 'all3',
  episodes = [],
  variant = 'card',
  setupOptions = {},
  onComplete = null,
  className = '',
  style = {},
  ...restProps
}) {
  const {
    runnerStates,
    activeEpisodeIds,
    runSingleTranslate,
    runSingleVoice,
    runSingleCleanBgm,
    runSingleAutoFitSpeed,
    runSingleEpisodeAll3,
    runSequentialStep,
    stopStep,
    activeSeriesId,
  } = useDubbingFeature(episodes);

  const isBatch = Array.isArray(episodes) && episodes.length > 1;
  const singleEp = Array.isArray(episodes) && episodes.length === 1 ? episodes[0] : null;

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const runnerState = runnerStates?.[step] || {};
  const isRunnerActive = runnerState.status === 'running';

  // Check if this specific episode is currently being processed
  const isThisEpisodeRunning = isSubmitting || (singleEp ? activeEpisodeIds?.has(singleEp.id) : isRunnerActive);

  // Single episode completion checks
  const isStepDone = React.useMemo(() => {
    if (!singleEp) return false;
    if (step === 'translate') return checkEpisodeHasScript(singleEp);
    if (step === 'voice') {
      const hasAudio = checkEpisodeHasAudioReady(singleEp, null, null) && !singleEp.audioOutdated;
      if (!hasAudio) return false;
      const segs = singleEp.scriptData?.segments || [];
      const hasUnresolved = segs.some((s) => {
        const isSpoken = s && (s.isSpoken !== false) && Boolean(s.khmer || s.khmerText || s.khmerTranslatedText || s.text);
        if (!isSpoken) return false;
        const st = String(s.ttsStatus || s.status || '').toLowerCase();
        return s.audioOutdated === true || st === 'outdated' || st === 'error' || st === 'failed' || (!s.audioUrl && !s.audioFile && !s.audioPath);
      });
      return !hasUnresolved;
    }
    if (step === 'autofit') return checkEpisodeHasAudioReady(singleEp, null, null) && checkEpisodeHasAutoFitReady(singleEp);
    if (step === 'clean_bgm') return checkEpisodeHasDemucsReady(singleEp, null, null);
    if (step === 'all3') {
      return (
        checkEpisodeHasScript(singleEp) &&
        checkEpisodeHasAudioReady(singleEp, null, null) &&
        !singleEp.audioOutdated &&
        checkEpisodeHasDemucsReady(singleEp, null, null)
      );
    }
    return false;
  }, [singleEp, step]);

  const handleClick = async (e) => {
    e?.stopPropagation?.();
    if (isThisEpisodeRunning && !isSubmitting) {
      stopStep(step, singleEp
        ? { seriesId: singleEp.seriesId || activeSeriesId, episodeId: singleEp.id }
        : { seriesId: activeSeriesId });
      return;
    }
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const runOptions = isStepDone
        ? { ...setupOptions, force: true, forceRegen: true }
        : setupOptions;
      let result = null;
      if (isBatch || !singleEp) {
        result = await runSequentialStep(step, episodes, runOptions);
      } else {
        if (step === 'translate') result = await runSingleTranslate(singleEp, runOptions);
        else if (step === 'voice') result = await runSingleVoice(singleEp, runOptions);
        else if (step === 'autofit') result = await runSingleAutoFitSpeed(singleEp, runOptions);
        else if (step === 'clean_bgm') result = await runSingleCleanBgm(singleEp, runOptions);
        else if (step === 'all3') result = await runSingleEpisodeAll3(singleEp, runOptions);
      }
      if (result && result.success && (result.completed || result.count > 0)) {
        onComplete?.(result);
      }
    } catch (err) {
      console.error(`[DubbingStepButton] Step ${step} execution error:`, err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Label configuration based on step and status (Clean professional text, no duplicate emojis)
  const labels = {
    translate: {
      idle: 'បកប្រែ Script',
      running: 'កំពុង Translate...',
      done: 'Script រួចរាល់',
    },
    voice: {
      idle: 'បង្កើតសំឡេង AI',
      running: 'កំពុង TTS...',
      done: 'សំឡេងរួចរាល់',
    },
    autofit: {
      idle: 'Auto-Fit Speed',
      running: 'កំពុង Auto-Fit...',
      done: 'Auto-Fit រួចរាល់',
    },
    clean_bgm: {
      idle: 'បិទសំឡេងចិន',
      running: 'កំពុងបិទសំឡេង...',
      done: 'Clean BGM រួចរាល់',
    },
    all3: {
      idle: isBatch ? `ផលិតស្វ័យប្រវត្តិទាំង 3 ជំហាន (${episodes.length} ភាគ)` : 'ផលិតទាំង 3 ជំហាន',
      running: isBatch ? `កំពុងរត់ (${runnerState.currentEpIndex}/${runnerState.totalEps})...` : 'កំពុងផលិត...',
      done: '100% រួចរាល់',
    },
  };

  const currentLabel = isThisEpisodeRunning
    ? labels[step]?.running
    : isStepDone
    ? labels[step]?.done
    : labels[step]?.idle;

  // Base style based on variant
  const baseStyle = {
    padding: variant === 'pill' ? '3px 8px' : variant === 'card' ? '4px 10px' : '8px 16px',
    borderRadius: variant === 'pill' ? 9999 : 6,
    fontSize: variant === 'pill' ? '0.64rem' : '0.68rem',
    fontWeight: 800,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    transition: 'all 0.15s ease',
    border: 'none',
    ...style,
  };

  if (isThisEpisodeRunning) {
    return (
      <button
        type="button"
        {...restProps}
        onClick={handleClick}
        className={`btn-tactile ${className}`}
        style={{
          ...baseStyle,
          background: 'rgba(239, 68, 68, 0.18)',
          border: '1px solid rgba(239, 68, 68, 0.5)',
          color: '#FCA5A5',
        }}
        title="ចុចដើម្បីបញ្ឈប់ (Stop)"
      >
        <Loader2 size={11} className="animate-spin" />
        <span>{currentLabel}</span>
        <Square size={9} fill="currentColor" style={{ marginLeft: 3 }} />
      </button>
    );
  }

  if (isStepDone) {
    return (
      <button
        type="button"
        {...restProps}
        onClick={handleClick}
        className={`btn-tactile ${className}`}
        style={{
          ...baseStyle,
          background: 'rgba(52, 211, 153, 0.12)',
          border: '1px solid rgba(52, 211, 153, 0.35)',
          color: '#34D399',
        }}
        title="ចុចដើម្បីដំណើរការឡើងវិញ (Re-run)"
      >
        <Check size={11} strokeWidth={2.5} />
        <span>{currentLabel}</span>
        <RotateCcw size={10} style={{ marginLeft: 2, opacity: 0.7 }} />
      </button>
    );
  }

  // Primary active styling
  const stepColorMap = {
    translate: { bg: '#0284C7', border: '#38BDF8', color: '#FFFFFF' },
    voice: { bg: '#BE185D', border: '#F472B6', color: '#FFFFFF' },
    autofit: { bg: '#D97706', border: '#FBBF24', color: '#FFFFFF' },
    clean_bgm: { bg: '#059669', border: '#34D399', color: '#FFFFFF' },
    all3: {
      bg: 'linear-gradient(135deg, #4F46E5 0%, #0284C7 100%)',
      border: '#818CF8',
      color: '#FFFFFF',
      boxShadow: '0 2px 10px rgba(79, 70, 229, 0.3)',
    },
  };

  const scheme = stepColorMap[step] || stepColorMap.all3;

  return (
    <button
      type="button"
      {...restProps}
      onClick={handleClick}
      className={`btn-tactile ${className}`}
      style={{
        ...baseStyle,
        background: scheme.bg,
        border: `1px solid ${scheme.border}`,
        color: scheme.color,
        boxShadow: scheme.boxShadow || 'none',
      }}
    >
      <Play size={10} fill="currentColor" />
      <span>{currentLabel}</span>
    </button>
  );
}
