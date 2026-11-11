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
  return null;
}

/**
 * Resolve voice metadata for a script segment.
 * Priority: explicit voice id (catalog match) -> gender hints -> default (Piseth).
 * @param {Object} seg
 * @param {Array} [catalog=KHMER_VOICE_CATALOG]
 * @returns {{ id: string, gender: 'MALE'|'FEMALE', label: string, icon: string, known: boolean }}
 */
export function resolveVoiceMeta(seg, catalog = KHMER_VOICE_CATALOG) {
  const voiceId = String(seg?.voiceOverride || seg?.voiceId || seg?.khmerVoiceId || '').trim();

  if (voiceId) {
    const hit = catalog.find((v) => v.id === voiceId || (v.match && v.match.test(voiceId)));
    if (hit) return { id: hit.id, gender: hit.gender, label: hit.label, icon: hit.icon, known: true };
  }

  const hinted = normalizeGender(seg?.voiceGender) || normalizeGender(seg?.speakerGender) || normalizeGender(seg?.gender);
  if (hinted) {
    const byGender = catalog.find((v) => v.gender === hinted) || DEFAULT_VOICE;
    if (voiceId) {
      // Unknown provider voice: keep its readable short name, trust the gender hint.
      const shortName = voiceId.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/Neural$/, '') || voiceId;
      return { id: voiceId, gender: hinted, label: shortName, icon: byGender.icon, known: false };
    }
    return { id: byGender.id, gender: byGender.gender, label: byGender.label, icon: byGender.icon, known: true };
  }

  if (voiceId) {
    const shortName = voiceId.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/Neural$/, '') || voiceId;
    return { id: voiceId, gender: DEFAULT_VOICE.gender, label: shortName, icon: '🎙️', known: false };
  }

  return { id: DEFAULT_VOICE.id, gender: DEFAULT_VOICE.gender, label: DEFAULT_VOICE.label, icon: DEFAULT_VOICE.icon, known: true };
}

