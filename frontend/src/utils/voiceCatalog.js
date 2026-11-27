/**
 * Khmer voice catalog + resolver for segment voice labels.
 * Single source for UI labels so components never hardcode a binary 'Sreymom' : 'Piseth' fallback.
 */

export const KHMER_VOICE_CATALOG = [
  { id: 'km-KH-PisethNeural', gender: 'MALE', label: 'ពិសិដ្ឋ', icon: '👨', match: /piseth/i },
  { id: 'km-KH-SreymomNeural', gender: 'FEMALE', label: 'ស្រីមុំ', icon: '👩', match: /sreymom/i },
];

const DEFAULT_VOICE = KHMER_VOICE_CATALOG[0];

function normalizeGender(value) {
  const g = String(value || '').trim().toLowerCase();
  if (g === 'female' || g === 'f' || g === 'woman') return 'FEMALE';
  if (g === 'male' || g === 'm' || g === 'man') return 'MALE';
  if (g === 'unknown' || g === 'unverified' || g === 'none' || g === 'n/a') return 'UNKNOWN';
  return null;
}

/**
 * Resolve true speaker/segment gender without counting UNKNOWN/fallback speakers as MALE.
 * @param {Object} seg
 * @param {Array} [catalog=KHMER_VOICE_CATALOG]
 * @returns {'MALE'|'FEMALE'|'UNKNOWN'}
 */
export function resolveSegmentGender(seg, catalog = KHMER_VOICE_CATALOG) {
  if (!seg || typeof seg !== 'object') return 'UNKNOWN';

  // 1. Explicit manual voice override governs when set
  const manualOverrideVoice = String(seg.voiceOverride || '').trim();
  const isManualVoice = Boolean(manualOverrideVoice || seg.voiceAssignmentSource === 'manual');
  if (isManualVoice) {
    const manualVid = manualOverrideVoice || String(seg.voiceId || seg.khmerVoiceId || seg.voice || '').trim();
    if (manualVid) {
      const hit = catalog.find((v) => v.id === manualVid || (v.match && v.match.test(manualVid)));
      if (hit) return hit.gender;
    }
  }

  // 2. Explicit unknown / fallback / unverified speaker status must stay UNKNOWN (never counted as MALE)
  const rawGenders = [seg.voiceGender, seg.speakerGender, seg.gender]
    .map(normalizeGender)
    .filter(Boolean);
  if (rawGenders.includes('UNKNOWN') && !rawGenders.includes('FEMALE') && !rawGenders.includes('MALE')) {
    return 'UNKNOWN';
  }
  if (
    (seg.isFallback === true || seg.voiceAssignmentSource === 'fallback' || seg.speakerStatus === 'review_needed') &&
    !rawGenders.includes('FEMALE') &&
    !rawGenders.includes('MALE')
  ) {
    return 'UNKNOWN';
  }

  // 3. Explicit resolved gender metadata
  const explicitGender = rawGenders.find((g) => g === 'FEMALE' || g === 'MALE');
  if (explicitGender) return explicitGender;

  // 4. Known non-fallback voice ID
  const voiceId = String(seg.voiceId || seg.khmerVoiceId || seg.voice || '').trim();
  if (voiceId && !seg.isFallback && seg.voiceAssignmentSource !== 'fallback') {
    const hit = catalog.find((v) => v.id === voiceId || (v.match && v.match.test(voiceId)));
    if (hit) return hit.gender;
  }

  return 'UNKNOWN';
}

/**
 * Resolve voice metadata for a script segment.
 * Priority: explicit voice id (catalog match) -> gender hints -> default (Piseth).
 * @param {Object} seg
 * @param {Array} [catalog=KHMER_VOICE_CATALOG]
 * @returns {{ id: string, gender: 'MALE'|'FEMALE', speakerGender: 'MALE'|'FEMALE'|'UNKNOWN', label: string, icon: string, known: boolean }}
 */
export function resolveVoiceMeta(seg, catalog = KHMER_VOICE_CATALOG) {
  const voiceId = String(seg?.voiceOverride || seg?.voiceId || seg?.khmerVoiceId || '').trim();
  const speakerGender = resolveSegmentGender(seg, catalog);

  if (voiceId) {
    const hit = catalog.find((v) => v.id === voiceId || (v.match && v.match.test(voiceId)));
    if (hit) return { id: hit.id, gender: hit.gender, speakerGender, label: hit.label, icon: hit.icon, known: true };
  }

  const rawHint = normalizeGender(seg?.voiceGender) || normalizeGender(seg?.speakerGender) || normalizeGender(seg?.gender);
  const hinted = (rawHint === 'FEMALE' || rawHint === 'MALE') ? rawHint : null;
  if (hinted) {
    const byGender = catalog.find((v) => v.gender === hinted) || DEFAULT_VOICE;
    if (voiceId) {
      // Unknown provider voice: keep its readable short name, trust the gender hint.
      const shortName = voiceId.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/Neural$/, '') || voiceId;
      return { id: voiceId, gender: hinted, speakerGender, label: shortName, icon: byGender.icon, known: false };
    }
    return { id: byGender.id, gender: byGender.gender, speakerGender, label: byGender.label, icon: byGender.icon, known: true };
  }

  if (voiceId) {
    const shortName = voiceId.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/Neural$/, '') || voiceId;
    return { id: voiceId, gender: DEFAULT_VOICE.gender, speakerGender, label: shortName, icon: '🎙️', known: false };
  }

  return { id: DEFAULT_VOICE.id, gender: DEFAULT_VOICE.gender, speakerGender, label: DEFAULT_VOICE.label, icon: DEFAULT_VOICE.icon, known: true };
}

