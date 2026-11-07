/**
 * Frontend Speaker Registry & Gender-to-Voice Utilities
 * Multi-character Khmer AI Dubbing voice assignment
 */

const FEMALE_MARKERS = [
  '女', '女主', '女性', '女人', '王妃', '皇后', '公主', '娘娘', '小姐', '夫人', '侍女', '丫鬟', 
  '姐姐', '妹妹', '母亲', '妈妈', '阿姨', '女士', '姑姑', '祖母', '奶奶', '郡主',
  '贵妃', '嫔妃', '女官', '医女', '师妹', '师姐', '姨母', '表妹', '表姐', '岳母',
  'នារី', 'នារីម្នាក់', 'ស្ត្រី', 'ស្ត្រីម្នាក់', 'ស្រី', 'តួស្រី', 'តួឯកស្រី', 'នាង', 'នាងតូច', 'ម្តាយ', 'ម៉ែ', 'បងស្រី', 'ប្អូនស្រី', 'យាយ', 
  'ម្ចាស់ក្សត្រី', 'អ្នកម្នាង', 'ភរិយា', 'កូនស្រី', 'អ្នកស្រី', 'កញ្ញា', 'ជំទាវ', 'មេម៉ាយ', 'កុមារី',
  'female', 'woman', 'girl', 'mother', 'sister', 'queen', 'princess', 'lady', 'maid', 'mrs', 'miss'
];

const MALE_MARKERS = [
  '男', '男主', '男性', '男人', '顾总', '王爷', '皇上', '陛下', '少爷', '总裁', '侍卫', '公公', 
  '哥哥', '弟弟', '父亲', '爸爸', '叔叔', '先生', '伯父', '祖父', '太监', '掌柜', 
  '刺客', '兄', '弟', '将军', '大人', '世子', '国公', '侯爷', '丞相', '太傅',
  '少主', '师兄', '师弟', '表哥', '表弟', '岳父', '老太爷',
  'បុរស', 'បុរសម្នាក់', 'បុរសវ័យ', 'ប្រុស', 'តួប្រុស', 'តួឯកប្រុស', 'លោក', 'ឪពុក', 'ប៉ា', 'បងប្រុស', 'ប្អូនប្រុស', 'តា', 
  'ស្ដេច', 'មេទ័ព', 'ចៅហ្វាយ', 'កូនប្រុស', 'អ្នកប្រុស', 'មន្ត្រី', 'ពេទ្យ', 'ប្តី', 'ស្វាមី', 'កំលោះ', 'យុវជន', 'កុមារា', 'ព្រះអង្គ',
  'male', 'man', 'boy', 'father', 'brother', 'king', 'prince', 'lord', 'guard', 'mr', 'sir', 'master'
];

/**
 * Detect speaker gender from explicit parameter, name, or keywords
 * @param {string} speakerName 
 * @param {string} [explicitGender] 
 * @param {string} [dialogueText]
 * @returns {'MALE' | 'FEMALE' | 'UNKNOWN'}
 */
export function detectSpeakerGender(speakerName = '', explicitGender = '', dialogueText = '') {
  if (explicitGender) {
    const norm = String(explicitGender).toUpperCase().trim();
    if (norm === 'MALE' || norm === 'BOY' || norm === 'MAN') return 'MALE';
    if (norm === 'FEMALE' || norm === 'GIRL' || norm === 'WOMAN') return 'FEMALE';
  }

  const name = String(speakerName || '').trim().toLowerCase();
  if (name) {
    for (const m of FEMALE_MARKERS) {
      if (name.includes(m.toLowerCase())) return 'FEMALE';
    }

    for (const m of MALE_MARKERS) {
      if (name.includes(m.toLowerCase())) return 'MALE';
    }
  }

  // Check unambiguous 1st-person self-references only (NOT 2nd or 3rd person words like នាង or លោក)
  const text = String(dialogueText || '').toLowerCase();
  if (text) {
    if (text.includes('នាងខ្ញុំ') || text.includes('ខ្ញុំម្ចាស់')) {
      return 'FEMALE';
    }
    if (text.includes('ខ្ញុំបាទ') || text.includes('ទូលបង្គំ')) {
      return 'MALE';
    }

    // Lookaround ensures ចាស/ច៎ាស is not part of ម្ចាស់ (master) or ចាស់ (old)
    const hasFemaleAffirmative = /(?<!្)ច[៎]?ាស(?!់)/u.test(text);
    const hasMaleAffirmative = /(?<!្)បាទ/u.test(text);

    if (hasMaleAffirmative && !hasFemaleAffirmative) {
      return 'MALE';
    }
    if (hasFemaleAffirmative && !hasMaleAffirmative) {
      return 'FEMALE';
    }
  }

  return 'UNKNOWN';
}

/**
 * Generate a clean, stable speaker ID for consistent voice lookup across segments
 * @param {string} speakerName 
 * @returns {string}
 */
export function getSpeakerId(speakerName = '') {
  const clean = String(speakerName || 'Speaker').trim();
  const safe = clean
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  return safe ? `spk_${safe}` : 'spk_default';
}

/**
 * Get default verified voice based on gender
 * @param {'MALE'|'FEMALE'|'UNKNOWN'} gender 
 * @returns {string} voiceId
 */
export function getDefaultVoiceForGender(gender) {
  if (gender === 'FEMALE') return 'km-KH-SreymomNeural';
  if (gender === 'MALE') return 'km-KH-PisethNeural';
  return 'km-KH-PisethNeural';
}

/**
 * Build or update the speaker registry mapping from an array of segments
 * @param {Array} segments 
 * @param {Object} [existingRegistry={}] 
 * @returns {Object} { [speakerId]: { id, speakerId, name, gender, voiceId, speed, segmentCount, count } }
 */
export function buildSpeakerRegistry(segments = [], existingRegistry = {}) {
  const registry = { ...existingRegistry };

  (segments || []).forEach((seg) => {
    const rawName = (seg.speaker || seg.speakerName || 'តួអង្គ').trim();
    const spkId = seg.speakerId || getSpeakerId(rawName);
    const gender = seg.speakerGender || detectSpeakerGender(rawName, seg.gender || seg.voiceGender);
    const voiceGender = seg.voiceGender || (gender === 'FEMALE' ? 'female' : (gender === 'MALE' ? 'male' : 'unknown'));
    const isManual = seg.voiceAssignmentSource === 'manual' || Boolean(registry[spkId]?.userOverridden);

    if (!registry[spkId]) {
      const voiceId = seg.khmerVoiceId || seg.voiceId || getDefaultVoiceForGender(gender);
      registry[spkId] = {
        id: spkId,
        speakerId: spkId,
        speakerName: rawName,
        name: rawName,
        gender,
        voiceGender,
        genderConfidence: typeof seg.genderConfidence === 'number' ? seg.genderConfidence : (voiceGender === 'unknown' ? 0.5 : 0.85),
        voiceId,
        khmerVoiceId: voiceId,
        voiceAssignmentSource: isManual ? 'manual' : 'automatic',
        userOverridden: isManual,
        speed: seg.speed || 'normal',
        segmentCount: 1,
        count: 1,
      };
    } else {
      const nextCount = (registry[spkId].segmentCount || registry[spkId].count || 0) + 1;
      registry[spkId].segmentCount = nextCount;
      registry[spkId].count = nextCount;
      registry[spkId].speakerId = registry[spkId].speakerId || spkId;
      registry[spkId].id = registry[spkId].id || spkId;
      registry[spkId].speakerName = registry[spkId].speakerName || rawName;

      if (isManual) {
        registry[spkId].userOverridden = true;
        registry[spkId].voiceAssignmentSource = 'manual';
      }

      if (registry[spkId].gender === 'UNKNOWN' && gender !== 'UNKNOWN') {
        registry[spkId].gender = gender;
        registry[spkId].voiceGender = gender.toLowerCase();
        if (!registry[spkId].userOverridden) {
          const autoVoice = getDefaultVoiceForGender(gender);
          registry[spkId].voiceId = autoVoice;
          registry[spkId].khmerVoiceId = autoVoice;
        }
      }
    }
  });

  return registry;
}

/**
 * Apply speaker voice assignments from registry to an array of segments
 * @param {Array} segments 
 * @param {Object} speakerRegistry 
 * @returns {Array}
 */
export function applySpeakerVoiceToSegments(segments = [], speakerRegistry = {}) {
  if (!segments || !Array.isArray(segments)) return [];

  return segments.map((seg, idx) => {
    const rawName = (seg.speaker || seg.speakerName || 'តួអង្គ').trim();
    const spkId = seg.speakerId || getSpeakerId(rawName);
    const reg = speakerRegistry[spkId] || speakerRegistry[rawName];

    const isManual = seg.voiceAssignmentSource === 'manual' || Boolean(reg?.userOverridden);
    const gender = reg?.gender || seg.speakerGender || detectSpeakerGender(rawName, seg.gender || seg.voiceGender);
    const voiceGender = reg?.voiceGender || (gender === 'FEMALE' ? 'female' : (gender === 'MALE' ? 'male' : 'unknown'));
    const voiceId = isManual
      ? (seg.khmerVoiceId || seg.voiceId || reg?.khmerVoiceId || reg?.voiceId || getDefaultVoiceForGender(gender))
      : (reg?.khmerVoiceId || reg?.voiceId || seg.khmerVoiceId || seg.voiceId || getDefaultVoiceForGender(gender));
    const speed = seg.speed || reg?.speed || 'normal';

    const segId = seg.segmentId || seg.id || `seg_${idx + 1}`;
    const origChinese = (seg.originalChineseText || seg.originalText || seg.original || '').trim();
    const khmerTrans = (seg.khmerTranslatedText || seg.khmerText || seg.khmer || '').trim();

    return {
      ...seg,
      id: segId,
      segmentId: segId,
      originalChineseText: origChinese,
      originalText: origChinese,
      original: origChinese,
      khmerTranslatedText: khmerTrans,
      khmerText: khmerTrans,
      khmer: khmerTrans,
      speaker: rawName,
      speakerName: rawName,
      speakerId: spkId,
      speakerGender: gender,
      voiceGender,
      genderConfidence: reg?.genderConfidence ?? seg.genderConfidence ?? (voiceGender === 'unknown' ? 0.5 : 0.85),
      voiceId,
      khmerVoiceId: voiceId,
      voiceAssignmentSource: isManual ? 'manual' : 'automatic',
      speed,
      voiceProvider: 'edge-tts',
      translationStatus: seg.translationStatus || (khmerTrans ? 'translated' : (origChinese ? 'review_needed' : 'pending')),
      ttsStatus: seg.ttsStatus || (seg.audioFile ? 'ready' : 'pending'),
    };
  });
}
