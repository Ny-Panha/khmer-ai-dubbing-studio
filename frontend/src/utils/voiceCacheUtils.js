const KNOWN_VOICE_IDS = ['km-KH-PisethNeural', 'km-KH-SreymomNeural', 'google-km-standard'];

export function normalizeVoiceSpeedKey(speed) {
  if (speed === undefined || speed === null || speed === '') return '1';
  if (typeof speed === 'string') {
    const trimmed = speed.trim().toLowerCase();
    if (!trimmed || trimmed === 'normal' || trimmed === 'default' || trimmed === '+0%' || trimmed === '-0%' || trimmed === '0%') {
      return '1';
    }
    if (trimmed === 'slow') return '0.75';
    if (trimmed === 'fast') return '1.25';
    const pctMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)%$/);
    if (pctMatch) {
      const val = 1 + Number(pctMatch[1]) / 100;
      return Number.isFinite(val) && val > 0 ? String(Number(val.toFixed(4))) : trimmed;
    }
    const numMatch = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*x?$/i);
    if (numMatch) {
      const val = Number(numMatch[1]);
      return Number.isFinite(val) && val > 0 ? String(Number(val.toFixed(4))) : trimmed;
    }
    return trimmed;
  }
  if (typeof speed === 'number' && Number.isFinite(speed) && speed > 0) {
    return String(Number(speed.toFixed(4)));
  }
  return String(speed);
}

export function normalizeEffectConfigKey(deliveryType = 'out_loud', audioEffect = 'none', effectConfig = null) {
  const isThought = deliveryType === 'inner_thought';
  if (!isThought) return 'clean';
  const eff = audioEffect || 'inner_thought_reverb';
  const cfg = effectConfig && typeof effectConfig === 'object' ? effectConfig : {};
  const inGain = cfg.inGain ?? 0.85;
  const outGain = cfg.outGain ?? 0.75;
  const delays = cfg.delays || '40|90';
  const decays = cfg.decays || '0.3|0.15';
  return `${eff}_${inGain}_${outGain}_${delays}_${decays}`;
}

export function isFilenameCompatibleWithVoice(fileRef, targetVoiceId) {
  if (!fileRef || !targetVoiceId) return true;
  const base = String(fileRef).split('?')[0].split('/').pop().split('\\').pop();
  if (!base) return true;
  for (const knownVoice of KNOWN_VOICE_IDS) {
    if (knownVoice !== targetVoiceId && base.includes(knownVoice)) {
      return false;
    }
  }
  return true;
}

export function isVerifiedVoiceVariantHit(
  variant,
  {
    targetVoiceId,
    currentText = '',
    speed = 'normal',
    pitch = '+0Hz',
    deliveryType = 'out_loud',
    audioEffect = null,
    effectConfig = null,
  } = {}
) {
  if (!variant || typeof variant !== 'object' || !variant.audioUrl || !targetVoiceId) {
    return false;
  }
  if (variant.provenanceVerified !== true) {
    return false;
  }
  if (variant.voiceId !== targetVoiceId) {
    return false;
  }
  if (variant.actualVoiceId && variant.actualVoiceId !== targetVoiceId) {
    return false;
  }
  const ref = variant.audioFile || variant.audioPath || variant.audioUrl;
  if (!isFilenameCompatibleWithVoice(ref, targetVoiceId)) {
    return false;
  }
  const expectedText = String(currentText || '').trim();
  const variantText = String(variant.text || '').trim();
  if (!expectedText || !variantText || variantText !== expectedText) {
    return false;
  }
  if (normalizeVoiceSpeedKey(variant.speed) !== normalizeVoiceSpeedKey(speed)) {
    return false;
  }
  if (String(variant.pitch || '+0Hz') !== String(pitch || '+0Hz')) {
    return false;
  }
  const expectedDelivery = deliveryType || 'out_loud';
  const variantDelivery = variant.deliveryType || 'out_loud';
  if (variantDelivery !== expectedDelivery) {
    return false;
  }
  const expectedEffect = audioEffect || (expectedDelivery === 'inner_thought' ? 'inner_thought_reverb' : 'none');
  const variantEffect = variant.audioEffect || (variantDelivery === 'inner_thought' ? 'inner_thought_reverb' : 'none');
  if (variantEffect !== expectedEffect) {
    return false;
  }
  const expectedEffectKey = normalizeEffectConfigKey(expectedDelivery, expectedEffect, effectConfig);
  const variantEffectKey = variant.effectConfigKey || normalizeEffectConfigKey(variantDelivery, variantEffect, variant.effectConfig || null);
  if (variantEffectKey !== expectedEffectKey) {
    return false;
  }
  return true;
}

export function isVerifiedSegmentAudioForVoice(seg, targetVoiceId) {
  if (!seg || !targetVoiceId) return false;
  if (!(seg.audioUrl || seg.audioPath || seg.audioFile)) return false;
  if (seg.audioOutdated || seg.voiceMismatch) return false;
  if (seg.ttsStatus === 'error' || seg.ttsStatus === 'voice_mismatch' || seg.ttsStatus === 'pending') return false;
  if (seg.actualVoiceId && seg.actualVoiceId !== targetVoiceId) return false;
  if (seg.rawVoiceId && seg.rawVoiceId !== targetVoiceId) return false;
  if (!isFilenameCompatibleWithVoice(seg.audioFile || seg.audioPath || seg.audioUrl, targetVoiceId)) return false;
  if (seg.rawAudioPath && !isFilenameCompatibleWithVoice(seg.rawAudioPath, targetVoiceId)) return false;
  return true;
}
