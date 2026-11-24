/**
 * Shared Dubbing Execution Adapter:
 * Standardizes episode identity, options mapping, and step-result contract
 * across all 7 entry points (Single Generate, Single Regenerate, Run 1-by-1,
 * Repair, Run All 3, Re-TTS, Clean BGM).
 */

export const STEP_STATUS = {
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REVIEW_NEEDED: 'review_needed',
};

/**
 * Normalizes options for any step into a canonical execution payload.
 *
 * @param {object} ep - Episode object
 * @param {string} stepType - 'translate' | 'voice' | 'clean_bgm' | 'autofit' | 'all3' | 'repair'
 * @param {object} options - Input options from UI or runner
 * @param {object} context - Context containing activeSeries and seriesId
 * @returns {object} Canonical execution options
 */
export function normalizeDubbingOptions(ep, stepType, options = {}, context = {}) {
  const activeSeries = context.activeSeries || null;
  const seriesId = activeSeries?.id || ep?.seriesId || context.seriesId || 'drama_project';
  const episodeId = ep?.id || 'ep_1';

  const videoRef = ep?.videoPath || ep?.sourceVideoPath || ep?.videoFile ||
    (typeof ep?.video === 'string' ? ep.video : ep?.video?.videoPath) ||
    ep?.video?.videoUrl || ep?.videoUrl || '';
  const videoId = ep?.videoId || ep?.video?.videoId || videoRef;

  // Determine generation mode: 'fast_ocr' or 'standard' without silent fallback
  const rawGenMode = options.generationMode || options.pipelineMode;
  const epSavedGenMode = ep?.generationMode || ep?.scriptData?.generationMode;
  const generationMode = (rawGenMode === 'standard' || epSavedGenMode === 'standard') && rawGenMode !== 'fast_ocr'
    ? 'standard'
    : (rawGenMode === 'fast_ocr' ? 'fast_ocr' : (epSavedGenMode || 'fast_ocr'));
  const pipelineMode = generationMode;

  // Determine dubbing mode: 'dialogue' or 'recap'
  const rawDubbingMode = options.dubbingMode || ep?.scriptData?.mode;
  const dubbingMode = rawDubbingMode === 'recap' ? 'recap' : 'dialogue';

  // Effective mode for backend pipeline
  const mode = dubbingMode === 'recap'
    ? 'recap'
    : (generationMode === 'fast_ocr' ? 'fast_ocr' : 'dialogue');

  const recapStyle = options.recapStyle || ep?.scriptData?.recapStyle || 'story_recap';
  const genre = options.genre || ep?.scriptData?.genre || ep?.scriptData?.detectedGenre || 'auto';
  const narratorGender = options.narratorGender || 'male';
  const customPrompt = options.customPrompt || options.customDirection || '';

  const force = Boolean(options.force || options.forceRegen);
  const confirmed = Boolean(options.force || options.confirmed || options.forceRegen);

  // Authoritative character voices & settings for TTS
  const voiceId = options.voiceId || ep?.voiceSettings?.voiceId || activeSeries?.voiceSettings?.voiceId || 'km-KH-PisethNeural';
  const speed = options.speed || ep?.voiceSettings?.speed || 'normal';

  // Clean BGM separation speed preset: 'turbo' (default 3x-4x multi-core Demucs) | 'ffmpeg_fast' (5s instant) | 'studio'
  const rawSepPreset = options.separationPreset || ep?.separationPreset || 'turbo';
  const separationPreset = ['turbo', 'studio', 'ffmpeg_fast'].includes(String(rawSepPreset).toLowerCase())
    ? String(rawSepPreset).toLowerCase()
    : 'turbo';

  // Build merged speakerMap with strict priority:
  // 1. Explicit options.speakerMap
  // 2. Episode speakerRegistry
  // 3. Series glossary characters
  const speakerMap = { ...(options.speakerMap || {}) };
  const seriesChars = Array.isArray(activeSeries?.glossary?.characters) ? activeSeries.glossary.characters : [];
  seriesChars.forEach((c) => {
    const k = c.id || c.speakerId || c.name;
    const v = c.voiceId || c.khmerVoiceId;
    if (k && v && !speakerMap[k]) speakerMap[k] = v;
    if (c.khmerName && v && !speakerMap[c.khmerName]) speakerMap[c.khmerName] = v;
  });

  const spkReg = ep?.speakerRegistry || ep?.scriptData?.speakerRegistry || {};
  Object.values(spkReg).forEach((spk) => {
    const v = spk.voiceId || spk.khmerVoiceId;
    if (v) {
      if (spk.id) speakerMap[spk.id] = v;
      if (spk.name && spk.name !== 'តួអង្គ' && String(spk.name).toLowerCase() !== 'speaker') {
        speakerMap[spk.name] = v;
      }
      if (spk.speakerName) speakerMap[spk.speakerName] = v;
    }
  });

  return {
    seriesId,
    episodeId,
    videoId,
    videoPath: videoRef,
    generationMode,
    pipelineMode,
    dubbingMode,
    mode,
    recapStyle,
    genre,
    narratorGender,
    customPrompt,
    customDirection: customPrompt,
    force,
    forceRegen: force,
    confirmed,
    voiceId,
    speed,
    speakerMap,
    separationPreset,
    seriesGlossary: options.seriesGlossary || activeSeries?.glossary,
  };
}

/**
 * Standardizes step execution result contract.
 *
 * @param {object} params
 * @returns {object} Canonical step result object
 */
export function createStepResult({
  status = STEP_STATUS.COMPLETED,
  data = null,
  error = null,
  jobId = null,
  reason = null,
  count = 0,
} = {}) {
  const isSuccess = status === STEP_STATUS.COMPLETED || status === STEP_STATUS.SKIPPED;
  return {
    success: isSuccess,
    status,
    completed: status === STEP_STATUS.COMPLETED,
    skipped: status === STEP_STATUS.SKIPPED,
    failed: status === STEP_STATUS.FAILED,
    cancelled: status === STEP_STATUS.CANCELLED,
    reviewNeeded: status === STEP_STATUS.REVIEW_NEEDED,
    data,
    error: error ? (error.message || String(error)) : null,
    jobId,
    reason,
    count,
  };
}
