const { GENERATION_MODES, formatSecondsToTimecode } = require('../pipelineTypes');
const { detectSpeakerGender } = require('../../../models/speakerRegistry');
const { isAuthOrInvalidKeyError, isQuotaOrRateLimitError } = require('../../geminiKeyManager');
const { DUBBING_CASCADE_MODELS } = require('../../geminiModelCatalog');
const { geminiQuotaTracker } = require('../../geminiQuotaTracker');

const DRAMA_GENRES = {
  AUTO: 'auto',
  ANCIENT: 'ancient',
  MODERN: 'modern',
  ACTION: 'action',
  COMEDY: 'comedy',
  GENERAL: 'general',
};

// Full Gemini cascade matching Shared Catalog (all 10 usable dubbing models)
const STAGE6_CASCADE_MODELS = DUBBING_CASCADE_MODELS;

function sanitizeStage6ErrorMsg(err) {
  return String(err?.message || err || 'Unknown error')
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]');
}

function isModelNotFoundError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  const msg = String(err.message || err.toString() || '').toLowerCase();
  return (
    status === 404 ||
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('not found') ||
    msg.includes('no longer available')
  );
}

function isAbortLikeError(err, signal = null) {
  if (signal?.aborted) return true;
  return Boolean(err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));
}

function createStage6AbortError(message = 'Stage 6 translation aborted by user signal') {
  const abortErr = new Error(message);
  abortErr.name = 'AbortError';
  abortErr.code = 'ABORT_ERR';
  return abortErr;
}

function isPlaceholderTranslationText(text = '') {
  const cleaned = String(text || '').trim();
  return !cleaned || cleaned === 'សន្ទនា';
}

// Universal Genre Reference (Series-specific glossaries are provided dynamically via seriesGlossary)
const CULTIVATION_DRAMA_GLOSSARY = '';

/**
 * Clean any accidental Thai characters or Thai loanwords from Khmer text
 */
function cleanKhmerSpokenText(str = '') {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/ไอ้/g, 'អា')
    .replace(/ออกมานี่/g, 'ចេញមកនេះ')
    .replace(/ออกมา/g, 'ចេញមក')
    .replace(/ผู้?บรรยาย/g, 'អ្នករៀបរាប់')
    .replace(/บรรยาย/g, 'រៀបរាប់')
    .replace(/ยาก/g, 'ពិបាក')
    .replace(/มั่ง/g, 'ខ្លះ')
    .replace(/มึง/g, 'ឯង')
    .replace(/กู/g, 'អញ')
    .replace(/[\u0E00-\u0E7F]+/g, '')
    .replace(/[\u0E80-\u0EFF]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Compute string similarity (Dice-Sorensen bigram overlap)
 * Safe for Khmer, Chinese, and mixed scripts without external dependencies.
 */
function computeKhmerSimilarity(strA = '', strB = '') {
  const cleanA = String(strA || '').replace(/\s+/g, '');
  const cleanB = String(strB || '').replace(/\s+/g, '');
  if (!cleanA && !cleanB) return 1.0;
  if (!cleanA || !cleanB) return 0.0;
  if (cleanA === cleanB) return 1.0;

  const getBigrams = (s) => {
    const bg = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.substring(i, i + 2);
      bg.set(g, (bg.get(g) || 0) + 1);
    }
    return bg;
  };

  const bgA = getBigrams(cleanA);
  const bgB = getBigrams(cleanB);
  if (bgA.size === 0 || bgB.size === 0) return 0.0;

  let intersection = 0;
  for (const [gram, countA] of bgA.entries()) {
    if (bgB.has(gram)) {
      intersection += Math.min(countA, bgB.get(gram));
    }
  }

  const total = (cleanA.length - 1) + (cleanB.length - 1);
  return total > 0 ? (2 * intersection) / total : 0.0;
}

/**
 * Non-destructive duplicate detection pass:
 * Flags warnings when adjacent segments share identical or highly similar Khmer translations
 * with different Chinese source inputs. Never automatically deletes or mutates text.
 */
function detectDuplicateTranslations(segments = []) {
  if (!Array.isArray(segments) || segments.length < 2) return segments;

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];

    const prevKhmer = String(prev.khmerTranslatedText || prev.khmerText || prev.khmer || '').trim();
    const currKhmer = String(curr.khmerTranslatedText || curr.khmerText || curr.khmer || '').trim();

    if (!prevKhmer || !currKhmer) continue;

    const prevChinese = String(prev.originalChineseText || prev.chineseText || prev.originalText || '').trim();
    const currChinese = String(curr.originalChineseText || curr.chineseText || curr.originalText || '').trim();

    const isIdenticalKhmer = prevKhmer === currKhmer;
    const isIdenticalChinese = prevChinese === currChinese;

    if (isIdenticalKhmer && !isIdenticalChinese) {
      // Different Chinese source but identical Khmer output
      curr.translationWarning = 'POTENTIAL_DUPLICATE_TRANSLATION';
      curr.reviewNeeded = true;
      curr.validationWarnings = [
        ...(curr.validationWarnings || []),
        `[POTENTIAL_DUPLICATE_TRANSLATION] បន្ទាត់ #${curr.id || i + 1} មានអត្ថបទបកប្រែដូចបន្ទាត់ #${prev.id || i} ទាំងស្រុង ទោះបីប្រយោគចិនដើមខុសគ្នា ("${currChinese}" vs "${prevChinese}")`,
      ];
    } else if (isIdenticalKhmer && isIdenticalChinese) {
      const timeDiff = Math.abs((curr.startSec || 0) - (prev.startSec || 0));
      if (timeDiff <= 2.0) {
        curr.translationWarning = 'SUSPICIOUS_CONSECUTIVE_DUPLICATE';
        curr.reviewNeeded = true;
        curr.validationWarnings = [
          ...(curr.validationWarnings || []),
          `[SUSPICIOUS_CONSECUTIVE_DUPLICATE] បន្ទាត់ #${curr.id || i + 1} ស្ទួនទាំងស្រុងជាមួយបន្ទាត់ #${prev.id || i} ("${currChinese}" -> "${currKhmer}") ក្នុងគម្លាត ${timeDiff.toFixed(2)}s`,
        ];
      } else {
        // Repeated spoken dialogue separated by time (e.g. "对对对", "បាទ បាទ")
        curr.translationWarning = 'POSSIBLE_DUPLICATE_INPUT';
      }
    } else if (!isIdenticalKhmer && !isIdenticalChinese) {
      const sim = computeKhmerSimilarity(prevKhmer, currKhmer);
      if (sim >= 0.85 && prevKhmer.length >= 10) {
        curr.translationWarning = 'HIGH_SIMILARITY_WARNING';
        curr.validationWarnings = [
          ...(curr.validationWarnings || []),
          `[HIGH_SIMILARITY_WARNING] បន្ទាត់ #${curr.id || i + 1} មានភាពស្រដៀងគ្នាខ្លាំង (${Math.round(sim * 100)}%) ជាមួយបន្ទាត់ #${prev.id || i}`,
        ];
      }
    }
  }

  return segments;
}

/**
 * Automatically detect drama genre from Chinese dialogue sample & user instructions
 */
function detectDramaGenre(chineseTextSample = '', userDirection = '') {
  const combined = (String(chineseTextSample) + ' ' + String(userDirection)).toLowerCase();

  // Explicit user direction overrides
  if (/បុរាណ|គុណនិយម|xianxia|wuxia|fantasy|cultivation|martial/i.test(userDirection)) return 'ancient';
  if (/សម័យទំនើប|ceo|romance|modern|office|corporate|ស្នេហា/i.test(userDirection)) return 'modern';
  if (/action|សងសឹក|កាប់ចាក់|ស៊ើបអង្កេត|detective|revenge|police/i.test(userDirection)) return 'action';
  if (/comedy|កំប្លែង|សើច/i.test(userDirection)) return 'comedy';

  const scores = { ancient: 0, modern: 0, action: 0, comedy: 0 };

  const ancientKeywords = [
    '修炼', '淬体', '聚灵', '凝气', '筑基', '金丹', '元婴', '本命武器', '宗门', '师父', '师尊', '师兄',
    '弟子', '陛下', '娘娘', '微臣', '本座', '老夫', '仙人', '神仙', '灵气', '掌门', '王爷', '公主',
    '公子', '姑娘', '殿下', '江湖', '武林', '妖兽', '骷髅', '邪物', '剑法', '丹药', '功法', '朕',
    '臣妾', '飞升', '魔教', '法宝', '道友', '太后', '太监', '皇帝', '皇上', '将军', '府上'
  ];

  const modernKeywords = [
    '总裁', '公司', '经理', '董事长', '秘书', '辞职', '合同', '项目', '手机', '电脑', '咖啡', '商业',
    '集团', '投资', '助理', '客户', '离婚', '相亲', '结婚', '豪门', '夫人', '少爷', '办公室', '薪水',
    '上班', '下班', '开会', '股票', '房产', '车钥匙', '酒吧', '医院', '医生', '护士', '学校', '老师'
  ];

  const actionKeywords = [
    '报仇', '杀手', '卧底', '警察', '抓捕', '凶手', '证据', '犯罪', '帮派', '调查', '战神', '战神归来',
    '特种兵', '子弹', '手枪', '炸弹', '人质', '老大', '兄弟们给我上', '血债血偿'
  ];

  const comedyKeywords = [
    '搞笑', '逗我', '神经病', '哈哈', '坑爹', '搞什么', '闹哪样', '卧槽', '开玩笑', '真逗', '笑死我了'
  ];

  for (const kw of ancientKeywords) {
    if (combined.includes(kw)) scores.ancient += 2;
  }
  for (const kw of modernKeywords) {
    if (combined.includes(kw)) scores.modern += 2;
  }
  for (const kw of actionKeywords) {
    if (combined.includes(kw)) scores.action += 2;
  }
  for (const kw of comedyKeywords) {
    if (combined.includes(kw)) scores.comedy += 2;
  }

  let maxGenre = 'general';
  let maxScore = 0;
  for (const [g, s] of Object.entries(scores)) {
    if (s > maxScore) {
      maxScore = s;
      maxGenre = g;
    }
  }

  return maxScore >= 2 ? maxGenre : 'general';
}

/**
 * Generate genre-specific guidelines for prompt
 */
function getGenrePromptGuidelines(genre = 'general') {
  switch (genre) {
    case 'ancient':
      return `
DRAMA GENRE: 🏛️ រឿងបុរាណចិន, Historical, Wuxia & Period Drama
- របៀបនិយាយ និងសព្វនាម៖ ប្រើពាក្យសព្វនាម និងឋានៈសមស្របតាមកុនបុរាណចិន (ខ្ញុំ, ឯង, លោកម្ចាស់, អ្នកនាង, ព្រះអង្គ, លោកមេទ័ព, ម្ចាស់បង, ម្ចាស់អូន, ព្រឹទ្ធាចារ្យ)។
- ទឹកដមសន្ទនា៖ ថ្លៃថ្នូរ អង់អាច សមរម្យតាមឋានៈក្នុងសម័យបុរាណ ដោយគោរពតាមបរិបទរឿង។
`;
    case 'modern':
      return `
DRAMA GENRE: 🏙️ រឿងសម័យទំនើប, CEO, Romance & គ្រួសារ
- របៀបនិយាយ និងសព្វនាម៖ ប្រើភាសាសន្ទនាធម្មជាតិនៃមនុស្សសម័យថ្មី (បង, អូន, ខ្ញុំ, លោក, អ្នក, លោកប្រធាន, អ្នកស្រី, អ្នកគ្រប់គ្រង, នាយក, ក្មួយ) តាមទំនាក់ទំនងតួអង្គ។
- ហាមដាច់ខាត៖ មិនត្រូវយកពាក្យបុរាណចិន គុណនិយម ឬកម្រិតថាមពល (ដូចជា លោកម្ចាស់, ព្រឹទ្ធាចារ្យ, សម្អាតកាយ...) មកប្រើក្នុងរឿងសម័យទំនើបឡើយ!
- ទឹកដមសន្ទនា៖ ធម្មជាតិ រស់រវើក ស្និទ្ធស្នាល ឬផ្លូវការតាមការងារក្រុមហ៊ុន។
`;
    case 'action':
      return `
DRAMA GENRE: ⚔️ រឿង Action, សងសឹក, ឧក្រិដ្ឋកម្ម & ស៊ើបអង្កេត
- របៀបនិយាយ និងសព្វនាម៖ ភាសាមុតមាំ ខ្លី ចំៗ មានកំហឹង ការគំរាម ឬការស៊ើបអង្កេត (ឯង, ពួកយើង, លោកប៉ូលិស, មេ, បងធំ)។
- ទឹកដមសន្ទនា៖ រក្សាចង្វាក់សន្ទនារហ័ស រំភើប តានតឹង និងអារម្មណ៍កំហឹងឱ្យសមនឹងឈុតឆាកប្រយុទ្ធ ឬសងសឹក។
`;
    case 'comedy':
      return `
DRAMA GENRE: 🎭 រឿងកំប្លែង, គ្រួសារ & មនោសញ្ចេតនាកំប្លុកកំប្លែង
- របៀបនិយាយ និងសព្វនាម៖ ភាសាសន្ទនាកំប្លុកកំប្លែង ធម្មជាតិ ប្រើពាក្យស្លោកខ្មែរដែលធ្វើឱ្យអ្នកស្តាប់អស់សំណើច តែមិនប្រមាថ។
- ទឹកដមសន្ទនា៖ បង្កប់ការភ្ញាក់ផ្អើល ភាពឡប់ៗ ឡូយឆាយ និងការសើចសប្បាយ។
`;
    case 'general':
    default:
      return `
DRAMA GENRE: ✨ រឿងទូទៅ / ស្គាល់តាមបរិបទជាក់ស្ដែង (Context-Aware Natural Drama)
- របៀបនិយាយ៖ វិភាគបរិបទជាក់ស្តែងនៃសាច់រឿង — ប្រសិនបើរឿងមានឈុតសម័យ ត្រូវប្រើភាសាសម័យ; បើជាឈុតបុរាណ ត្រូវប្រើភាសាបុរាណ។
- ហាមសន្មតថាគ្រប់រឿងសុទ្ធតែជារឿងគុណនិយម។ បើមិនប្រាកដ ត្រូវប្រើភាសាសន្ទនាខ្មែរធម្មជាតិបំផុត។
`;
  }
}

function deriveVoiceFromGender(gender = 'unknown') {
  const norm = String(gender || '').trim().toLowerCase();
  if (norm === 'female') {
    return {
      voiceGender: 'female',
      gender: 'female',
      speakerGender: 'FEMALE',
      voiceId: 'km-KH-SreymomNeural',
      khmerVoiceId: 'km-KH-SreymomNeural',
      voice: 'km-KH-SreymomNeural',
      voiceLabel: 'ស្រីមុំ (Sreymom)',
      avatar: '👩',
      badgeColor: '#ec4899',
    };
  }
  return {
    voiceGender: norm === 'male' ? 'male' : 'unknown',
    gender: 'male',
    speakerGender: norm === 'male' ? 'MALE' : 'UNKNOWN',
    voiceId: 'km-KH-PisethNeural',
    khmerVoiceId: 'km-KH-PisethNeural',
    voice: 'km-KH-PisethNeural',
    voiceLabel: 'ពិសិដ្ឋ (Piseth)',
    avatar: '👨',
    badgeColor: '#3b82f6',
  };
}

function buildSafeSpeakerId(speakerName = '', voiceGender = 'unknown', fallbackIndex = 0) {
  const cleanName = String(speakerName || '').trim()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const genderTag = voiceGender === 'female' ? 'female' : (voiceGender === 'male' ? 'male' : 'unknown');
  if (cleanName && cleanName !== 'តួអង្គ' && cleanName !== 'speaker') {
    return `spk_${genderTag}_${cleanName}`;
  }
  return `spk_${genderTag}_${fallbackIndex + 1}`;
}

function createCanonicalSegment(raw = {}, index = 0, mode = 'dialogue') {
  const origChinese = String(raw.originalChineseText || raw.chineseText || raw.originalText || '').trim();
  const rawKhmer = String(raw.khmerTranslatedText || raw.khmerText || raw.khmer || '').trim();
  const cleanedKhmer = cleanKhmerSpokenText(rawKhmer);
  const khmerText = cleanedKhmer === 'សន្ទនា' ? '' : cleanedKhmer;
  const startSec = Math.max(0, typeof raw.startSec === 'number' ? raw.startSec : 0);
  const endSec = typeof raw.endSec === 'number' ? raw.endSec : startSec + 2.0;
  const dur = parseFloat(Math.max(0.6, endSec - startSec).toFixed(2));
  const evidenceSrc = raw.evidenceSource || raw.evidenceType || (mode === 'recap' ? 'cinematic_recap' : 'audio_asr');
  const cleanSpk = cleanKhmerSpokenText(raw.speaker || raw.speakerName) || (mode === 'recap' ? 'អ្នកសម្រាយរឿង' : 'តួអង្គ');

  const isOcrOnly = raw.speakerSource === 'ocr_only';
  const isUserOverridden = Boolean(raw.userOverridden);
  const isGenericSpeaker = cleanSpk === 'តួអង្គ' || cleanSpk.toLowerCase() === 'speaker';

  let resolvedGender = String(raw.voiceGender || '').toLowerCase();
  const titleKwGender = !isUserOverridden ? detectSpeakerGender(cleanSpk) : 'UNKNOWN';
  if (isUserOverridden) {
    if (resolvedGender !== 'female' && resolvedGender !== 'male') {
      const explicitVoice = String(raw.voiceId || raw.khmerVoiceId || raw.voice || '');
      if (explicitVoice.includes('Sreymom')) resolvedGender = 'female';
      else if (explicitVoice.includes('Piseth')) resolvedGender = 'male';
      else resolvedGender = mode === 'recap' ? 'male' : 'unknown';
    }
  } else if (titleKwGender === 'FEMALE' || titleKwGender === 'MALE') {
    resolvedGender = titleKwGender === 'FEMALE' ? 'female' : 'male';
  } else if (resolvedGender !== 'female' && resolvedGender !== 'male') {
    if (typeof raw.pitchHz === 'number' && raw.pitchHz >= 170) {
      resolvedGender = 'female';
    } else if (/ស្រី|នាង|អ្នកនាង|ម៉ែ|យាយ|ព្រះនាង|សិស្សប្អូនស្រី|ប្រព័ន្ធ|កុមារី|មាតា|ធីតា/i.test(cleanSpk)) {
      resolvedGender = 'female';
    } else {
      resolvedGender = mode === 'recap' ? 'male' : 'unknown';
    }
  }

  const genderVoiceMeta = deriveVoiceFromGender(resolvedGender);
  const assignedVoiceId = genderVoiceMeta.voiceId;

  // For ALL non-manual/non-userOverridden segments with a resolved gender (Fast OCR & Standard),
  // ALWAYS derive voiceId/khmerVoiceId/voice from final voiceGender so stale earlier voices never leak through.
  const isManualVoice = isUserOverridden || raw.voiceAssignmentSource === 'manual' || Boolean(raw.voiceOverride);
  let finalVoiceId;
  let finalKhmerVoiceId;
  let finalVoice;
  if (isManualVoice) {
    finalVoiceId = raw.voiceOverride || raw.voiceId || raw.khmerVoiceId || raw.voice || assignedVoiceId;
    finalKhmerVoiceId = raw.voiceOverride || raw.khmerVoiceId || raw.voiceId || raw.voice || assignedVoiceId;
    finalVoice = raw.voice || finalVoiceId;
  } else if (isOcrOnly || resolvedGender === 'female' || resolvedGender === 'male') {
    finalVoiceId = assignedVoiceId;
    finalKhmerVoiceId = assignedVoiceId;
    finalVoice = assignedVoiceId;
  } else {
    finalVoiceId = raw.voiceId || raw.khmerVoiceId || assignedVoiceId;
    finalKhmerVoiceId = raw.khmerVoiceId || raw.voiceId || assignedVoiceId;
    finalVoice = raw.voice || finalVoiceId;
  }

  const displayVoiceMeta = String(finalVoiceId).includes('Sreymom')
    ? deriveVoiceFromGender('female')
    : deriveVoiceFromGender(resolvedGender === 'unknown' ? 'unknown' : 'male');

  let safeSpeakerId;
  if (mode === 'recap') {
    safeSpeakerId = 'narrator';
  } else if (isUserOverridden && raw.speakerId) {
    safeSpeakerId = raw.speakerId;
  } else if (isOcrOnly) {
    safeSpeakerId = buildSafeSpeakerId(cleanSpk, resolvedGender, index);
  } else {
    safeSpeakerId = (raw.speakerId && !raw.speakerId.startsWith('spk_1') && !raw.speakerId.endsWith('_unknown') && (raw.speakerId.includes('female') || raw.speakerId.includes('male')))
      ? raw.speakerId
      : buildSafeSpeakerId(cleanSpk, resolvedGender, index);
  }

  return {
    id: index + 1,
    segmentId: index + 1,
    startSec: parseFloat(startSec.toFixed(2)),
    endSec: parseFloat((startSec + dur).toFixed(2)),
    duration: dur,
    start: formatSecondsToTimecode(startSec),
    end: formatSecondsToTimecode(startSec + dur),
    startTime: formatSecondsToTimecode(startSec),
    endTime: formatSecondsToTimecode(startSec + dur),
    sourceStartSec: typeof raw.sourceStartSec === 'number' ? raw.sourceStartSec : startSec,
    sourceEndSec: typeof raw.sourceEndSec === 'number' ? raw.sourceEndSec : endSec,
    chineseText: origChinese,
    originalChineseText: origChinese,
    originalText: origChinese,
    original: origChinese,
    spokenAudioText: raw.spokenAudioText || '',
    ocrSubtitleText: raw.ocrSubtitleText || '',
    khmerTranslatedText: khmerText,
    khmerText: khmerText,
    khmer: khmerText,
    speaker: cleanSpk,
    speakerName: cleanSpk,
    speakerId: safeSpeakerId,
    voiceGender: resolvedGender,
    gender: displayVoiceMeta.gender,
    speakerGender: displayVoiceMeta.speakerGender,
    voiceId: finalVoiceId,
    khmerVoiceId: finalKhmerVoiceId,
    voice: finalVoice,
    voiceLabel: displayVoiceMeta.voiceLabel,
    avatar: displayVoiceMeta.avatar,
    badgeColor: displayVoiceMeta.badgeColor,
    voiceAssignmentSource: raw.voiceAssignmentSource || (isUserOverridden ? 'manual' : 'ai_pipeline'),
    ...(isOcrOnly
      ? {
          speakerSource: 'ocr_only',
          unverifiedSpeaker: isGenericSpeaker ? true : (raw.unverifiedSpeaker !== undefined ? Boolean(raw.unverifiedSpeaker) : false),
        }
      : (raw.speakerSource ? { speakerSource: raw.speakerSource } : {})),
    ...(isUserOverridden ? { userOverridden: true } : {}),
    ...(raw.voiceOverride ? { voiceOverride: raw.voiceOverride } : {}),
    ...(typeof raw.pitchHz === 'number' ? { pitchHz: raw.pitchHz } : {}),
    ...(raw.acousticGender ? { acousticGender: raw.acousticGender } : {}),
    ...(typeof raw.acousticConfidence === 'number' ? { acousticConfidence: raw.acousticConfidence } : {}),
    ...(raw.genderConfidence !== undefined ? { genderConfidence: raw.genderConfidence } : {}),
    evidenceType: evidenceSrc,
    evidenceSource: evidenceSrc,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.9,
    deliveryType: raw.deliveryType && ['out_loud', 'inner_thought', 'narration', 'unknown'].includes(raw.deliveryType)
      ? raw.deliveryType
      : (mode === 'recap' ? 'narration' : 'out_loud'),
    deliveryOverride: Boolean(raw.deliveryOverride),
    deliveryConfidence: typeof raw.deliveryConfidence === 'number'
      ? raw.deliveryConfidence
      : (raw.deliveryType === 'unknown' ? null : 0.9),
    deliveryReviewNeeded: Boolean(raw.deliveryReviewNeeded || raw.deliveryType === 'unknown'),
    audioEffect: raw.audioEffect || (raw.deliveryType === 'inner_thought' ? 'inner_thought_reverb' : 'none'),
    effectConfig: raw.effectConfig || null,
    rawAudioPath: raw.rawAudioPath || null,
    rawAudioFile: raw.rawAudioFile || null,
    translationWarning: raw.translationWarning || null,
    translationStatus: raw.translationStatus || (khmerText ? 'translated' : 'review_needed'),
    validationWarnings: Array.isArray(raw.validationWarnings) ? [...raw.validationWarnings] : [],
    validationErrors: Array.isArray(raw.validationErrors) ? [...raw.validationErrors] : [],
    speechStartSec: typeof raw.speechStartSec === 'number' ? raw.speechStartSec : null,
    speechEndSec: typeof raw.speechEndSec === 'number' ? raw.speechEndSec : null,
    speechDuration: typeof raw.speechDuration === 'number' ? raw.speechDuration : null,
    reviewNeeded: Boolean(raw.reviewNeeded || !khmerText || raw.translationWarning === 'POTENTIAL_DUPLICATE_TRANSLATION'),
    uncertainTiming: Boolean(raw.uncertainTiming),
    audioGenerated: false,
    audioOutdated: true,
    fullAudioPath: null,
    fullAudioUrl: null,
  };
}

function applyTranslatedSegmentResult(targetSeg, t, maxWords, segIdx, { isFastOcrMode = false } = {}) {
  if (!targetSeg || !t) return false;

  const rawTranslated = cleanKhmerSpokenText(t.khmerText || '');
  const usableTranslated = rawTranslated === 'សន្ទនា' ? '' : rawTranslated;
  const condensed = usableTranslated ? condenseKhmerDialogue(usableTranslated, maxWords) : '';
  const finalTranslated = condensed === 'សន្ទនា' ? '' : condensed;

  if (targetSeg.userOverridden || targetSeg.voiceAssignmentSource === 'manual' || targetSeg.voiceOverride) {
    // User-overridden/manual segment keeps its manual speaker/gender/voice untouched; only populate missing translation
    if (!targetSeg.khmerTranslatedText || targetSeg.khmerTranslatedText === 'សន្ទនា') {
      if (finalTranslated) {
        targetSeg.khmerTranslatedText = finalTranslated;
        targetSeg.translationStatus = 'translated';
      } else {
        targetSeg.khmerTranslatedText = '';
        targetSeg.reviewNeeded = true;
        targetSeg.translationStatus = 'review_needed';
      }
    }
    return Boolean(targetSeg.khmerTranslatedText && targetSeg.khmerTranslatedText !== 'សន្ទនា');
  }

  targetSeg.khmerTranslatedText = finalTranslated;
  if (!finalTranslated) {
    targetSeg.reviewNeeded = true;
    targetSeg.translationStatus = 'review_needed';
  } else {
    targetSeg.translationStatus = 'translated';
  }
  const cleanSpk = cleanKhmerSpokenText(t.speaker) || cleanKhmerSpokenText(targetSeg.speaker) || 'តួអង្គ';
  targetSeg.speaker = cleanSpk;
  targetSeg.speakerName = cleanSpk;

  const isOcrSeg = isFastOcrMode || targetSeg.speakerSource === 'ocr_only';
  const aiGender = String(t.gender || '').toLowerCase();

  if (!isOcrSeg) {
    // Standard Mode: explicit unambiguous speaker title beats noisy un-isolated YIN pitch;
    // generic/neutral characters still follow real acoustic pitch or AI dialogue context.
    const hasFemalePitch = typeof targetSeg.pitchHz === 'number' && targetSeg.pitchHz >= 172;
    const hasMalePitch = typeof targetSeg.pitchHz === 'number' && targetSeg.pitchHz > 0 && targetSeg.pitchHz <= 148;
    const titleGender = detectSpeakerGender(cleanSpk);

    if (titleGender === 'FEMALE') {
      targetSeg.voiceGender = 'female';
    } else if (titleGender === 'MALE') {
      targetSeg.voiceGender = 'male';
    } else if (hasFemalePitch) {
      targetSeg.voiceGender = 'female';
    } else if (hasMalePitch && aiGender !== 'female') {
      targetSeg.voiceGender = 'male';
    } else if (aiGender === 'female' || aiGender === 'male') {
      targetSeg.voiceGender = aiGender;
    }

    const vMeta = deriveVoiceFromGender(targetSeg.voiceGender);
    targetSeg.voiceId = vMeta.voiceId;
    targetSeg.khmerVoiceId = vMeta.khmerVoiceId;
    targetSeg.voice = vMeta.voice;
    targetSeg.voiceLabel = vMeta.voiceLabel;
    targetSeg.avatar = vMeta.avatar;
    targetSeg.badgeColor = vMeta.badgeColor;
    targetSeg.gender = vMeta.gender;
    targetSeg.speakerGender = vMeta.speakerGender;
    targetSeg.speakerId = buildSafeSpeakerId(cleanSpk, targetSeg.voiceGender, segIdx);
    return Boolean(targetSeg.khmerTranslatedText && targetSeg.khmerTranslatedText !== 'សន្ទនា');
  }

  // Fast OCR ('ocr_only') Mode: NO acoustic pitch exists — assign from AI dialogue context or speaker name keywords, then re-derive voice
  targetSeg.speakerSource = 'ocr_only';
  if (aiGender === 'female' || aiGender === 'male') {
    targetSeg.voiceGender = aiGender;
  } else {
    const kwGender = detectSpeakerGender(cleanSpk);
    if (kwGender === 'FEMALE') {
      targetSeg.voiceGender = 'female';
    } else if (kwGender === 'MALE') {
      targetSeg.voiceGender = 'male';
    } else if (cleanSpk === 'តួអង្គ' || cleanSpk.toLowerCase() === 'speaker') {
      targetSeg.voiceGender = (targetSeg.voiceGender === 'female' || targetSeg.voiceGender === 'male')
        ? targetSeg.voiceGender
        : 'unknown';
    }
  }

  const vMeta = deriveVoiceFromGender(targetSeg.voiceGender);
  targetSeg.voiceId = vMeta.voiceId;
  targetSeg.khmerVoiceId = vMeta.khmerVoiceId;
  targetSeg.voice = vMeta.voice;
  targetSeg.voiceLabel = vMeta.voiceLabel;
  targetSeg.avatar = vMeta.avatar;
  targetSeg.badgeColor = vMeta.badgeColor;
  targetSeg.gender = vMeta.gender;
  targetSeg.speakerGender = vMeta.speakerGender;
  targetSeg.unverifiedSpeaker = cleanSpk === 'តួអង្គ' || cleanSpk.toLowerCase() === 'speaker';
  targetSeg.speakerId = buildSafeSpeakerId(cleanSpk, targetSeg.voiceGender, segIdx);
  return Boolean(targetSeg.khmerTranslatedText && targetSeg.khmerTranslatedText !== 'សន្ទនា');
}

/**
 * Whole-episode character consistency pass (Fast OCR + Standard Dialogue):
 * - Ignores userOverridden / manual segments (untouched by both voting and mutation)
 * - Keeps generic 'តួអង្គ' per-line gender judgement (and unverifiedSpeaker: true on OCR) while re-deriving voice
 * - Groups named characters by cleanSpk across the full episode; majority gender wins and minority lines are corrected + voice re-derived
 * - Logs episode character & correction stats
 */
function enforceEpisodeCharacterConsistency(segments = [], { defaultGender = 'male', isFastOcrMode = false } = {}) {
  const normDefault = String(defaultGender || 'male').toLowerCase() === 'female' ? 'female' : 'male';
  const updated = Array.isArray(segments) ? segments.map((s) => ({ ...s })) : [];

  const groups = new Map();
  const genericIndices = [];
  let overriddenCount = 0;

  for (let idx = 0; idx < updated.length; idx++) {
    const seg = updated[idx];
    const isOcrSeg = isFastOcrMode || seg.speakerSource === 'ocr_only';

    if (seg.userOverridden || seg.voiceAssignmentSource === 'manual' || seg.voiceOverride) {
      overriddenCount++;
      continue;
    }

    if (isOcrSeg) {
      seg.speakerSource = 'ocr_only';
    }
    const cleanSpk = cleanKhmerSpokenText(seg.speaker || seg.speakerName || '') || 'តួអង្គ';
    seg.speaker = cleanSpk;
    seg.speakerName = cleanSpk;

    if (cleanSpk === 'តួអង្គ' || cleanSpk.toLowerCase() === 'speaker') {
      genericIndices.push(idx);
      continue;
    }

    if (!groups.has(cleanSpk)) {
      groups.set(cleanSpk, {
        speaker: cleanSpk,
        indices: [],
        femaleVotes: 0,
        maleVotes: 0,
        unknownVotes: 0,
      });
    }
    const entry = groups.get(cleanSpk);
    entry.indices.push(idx);

    const g = String(seg.voiceGender || '').toLowerCase();
    if (g === 'female') entry.femaleVotes++;
    else if (g === 'male') entry.maleVotes++;
    else entry.unknownVotes++;
  }

  // Generic 'តួអង្គ': preserve per-line gender judgement, re-derive voice when gender is resolved
  for (const idx of genericIndices) {
    const seg = updated[idx];
    const isOcrSeg = isFastOcrMode || seg.speakerSource === 'ocr_only';
    let g = String(seg.voiceGender || '').toLowerCase();
    if (g !== 'female' && g !== 'male') {
      g = 'unknown';
    }
    const vMeta = deriveVoiceFromGender(g);
    seg.voiceGender = g;
    seg.gender = vMeta.gender;
    seg.speakerGender = vMeta.speakerGender;
    seg.voiceId = vMeta.voiceId;
    seg.khmerVoiceId = vMeta.khmerVoiceId;
    seg.voice = vMeta.voice;
    seg.voiceLabel = vMeta.voiceLabel;
    seg.avatar = vMeta.avatar;
    seg.badgeColor = vMeta.badgeColor;
    if (isOcrSeg) {
      seg.unverifiedSpeaker = true;
    }
    seg.speakerId = buildSafeSpeakerId('តួអង្គ', g, idx);
  }

  // Named characters: majority gender (or explicit unambiguous role title like ប្រព័ន្ធ / តួឯកប្រុស) wins across the entire episode
  let genderCorrectedCount = 0;
  let staleVoiceFixedCount = 0;
  const characterSummary = [];

  for (const [charName, entry] of groups.entries()) {
    const kwGender = detectSpeakerGender(charName);
    const isSystemChar = /ប្រព័ន្ធ|system|系统/i.test(charName);
    let winnerGender;
    if (isSystemChar) {
      winnerGender = 'female';
    } else if (entry.femaleVotes > entry.maleVotes) {
      if (kwGender === 'MALE' && !updated[entry.indices[0]]?.pitchHz) {
        winnerGender = 'male';
      } else {
        winnerGender = 'female';
      }
    } else if (entry.maleVotes > entry.femaleVotes) {
      if (kwGender === 'FEMALE' && !updated[entry.indices[0]]?.pitchHz) {
        winnerGender = 'female';
      } else {
        winnerGender = 'male';
      }
    } else {
      if (kwGender === 'FEMALE') {
        winnerGender = 'female';
      } else if (kwGender === 'MALE') {
        winnerGender = 'male';
      } else {
        const firstG = String(updated[entry.indices[0]]?.voiceGender || '').toLowerCase();
        winnerGender = (firstG === 'female' || firstG === 'male') ? firstG : normDefault;
      }
    }

    const vMeta = deriveVoiceFromGender(winnerGender);
    const canonicalSpeakerId = buildSafeSpeakerId(charName, winnerGender, entry.indices[0]);
    let charCorrected = 0;
    let charStaleVoiceFixed = 0;

    for (const idx of entry.indices) {
      const seg = updated[idx];
      const isOcrSeg = isFastOcrMode || seg.speakerSource === 'ocr_only';
      const prevGender = String(seg.voiceGender || '').toLowerCase();
      const prevVoice = seg.voiceId || seg.khmerVoiceId || seg.voice || '';

      if (prevGender !== winnerGender) {
        charCorrected++;
      } else if (prevVoice !== vMeta.voiceId) {
        charStaleVoiceFixed++;
      }

      seg.speaker = charName;
      seg.speakerName = charName;
      seg.speakerId = canonicalSpeakerId;
      if (isOcrSeg) {
        seg.speakerSource = 'ocr_only';
        seg.unverifiedSpeaker = false;
      }
      seg.voiceGender = winnerGender;
      seg.gender = vMeta.gender;
      seg.speakerGender = vMeta.speakerGender;
      seg.voiceId = vMeta.voiceId;
      seg.khmerVoiceId = vMeta.khmerVoiceId;
      seg.voice = vMeta.voice;
      seg.voiceLabel = vMeta.voiceLabel;
      seg.avatar = vMeta.avatar;
      seg.badgeColor = vMeta.badgeColor;
    }

    genderCorrectedCount += charCorrected;
    staleVoiceFixedCount += charStaleVoiceFixed;
    characterSummary.push({
      speaker: charName,
      speakerId: canonicalSpeakerId,
      gender: winnerGender,
      voiceId: vMeta.voiceId,
      totalLines: entry.indices.length,
      femaleVotes: entry.femaleVotes,
      maleVotes: entry.maleVotes,
      unknownVotes: entry.unknownVotes,
      correctedCount: charCorrected,
      staleVoiceFixedCount: charStaleVoiceFixed,
    });
  }

  if (characterSummary.length > 0 || genericIndices.length > 0 || overriddenCount > 0) {
    const modeTag = isFastOcrMode ? 'Fast OCR Consistency' : 'Episode Consistency';
    console.log(
      `[Stage 6 ${modeTag}] 📊 Episode pass: ${characterSummary.length} named character(s) found (${genericIndices.length} generic 'តួអង្គ', ${overriddenCount} userOverridden untouched), ${genderCorrectedCount} minority segment(s) corrected, ${staleVoiceFixedCount} stale voiceId fixed.`
    );
    for (const ch of characterSummary) {
      console.log(
        `[Stage 6 ${modeTag}]   • "${ch.speaker}" => ${ch.gender} (${ch.voiceId}) | lines=${ch.totalLines}, votes[F:${ch.femaleVotes}/M:${ch.maleVotes}/U:${ch.unknownVotes}], corrected=${ch.correctedCount}`
      );
    }
  }

  return {
    segments: updated,
    stats: {
      namedCharactersCount: characterSummary.length,
      characters: characterSummary,
      genericCount: genericIndices.length,
      overriddenCount,
      correctedCount: genderCorrectedCount,
      staleVoiceFixedCount,
    },
  };
}

const enforceFastOcrCharacterConsistency = enforceEpisodeCharacterConsistency;

function splitLongDialogueSegment(seg, maxDur = 6.0) {
  const text = String(seg.originalChineseText || '').trim();
  const dur = typeof seg.duration === 'number' && seg.duration > 0
    ? seg.duration
    : parseFloat(((seg.endSec || 0) - (seg.startSec || 0)).toFixed(2));

  if (dur <= maxDur) return [seg];

  // 1. Try splitting by sentence-ending punctuation (。!！?？)
  const punctuationRegex = /([。!！?？]+)/;
  const parts = text.split(punctuationRegex).filter(Boolean);

  if (parts.length >= 2) {
    const sentences = [];
    for (let i = 0; i < parts.length; i += 2) {
      const sentence = parts[i] + (parts[i + 1] || '');
      if (sentence.trim()) sentences.push(sentence.trim());
    }

    if (sentences.length > 1) {
      const partDur = parseFloat((dur / sentences.length).toFixed(2));
      return sentences.map((sent, idx) => {
        const s = parseFloat((seg.startSec + idx * partDur).toFixed(2));
        const e = idx === sentences.length - 1 ? seg.endSec : parseFloat((s + partDur).toFixed(2));
        return {
          ...seg,
          startSec: s,
          endSec: e,
          duration: parseFloat((e - s).toFixed(2)),
          originalChineseText: sent,
        };
      });
    }
  }

  // 2. If single long sentence, try splitting by clause punctuation (，,；…)
  const clauseRegex = /([，,；…]+)/;
  const clauseParts = text.split(clauseRegex).filter(Boolean);
  if (clauseParts.length >= 2) {
    const clauses = [];
    for (let i = 0; i < clauseParts.length; i += 2) {
      const clause = clauseParts[i] + (clauseParts[i + 1] || '');
      if (clause.trim()) clauses.push(clause.trim());
    }

    if (clauses.length > 1) {
      const partDur = parseFloat((dur / clauses.length).toFixed(2));
      return clauses.map((cls, idx) => {
        const s = parseFloat((seg.startSec + idx * partDur).toFixed(2));
        const e = idx === clauses.length - 1 ? seg.endSec : parseFloat((s + partDur).toFixed(2));
        return {
          ...seg,
          startSec: s,
          endSec: e,
          duration: parseFloat((e - s).toFixed(2)),
          originalChineseText: cls,
        };
      });
    }
  }

  // 3. If text is short or cannot be split, NEVER clone identical duplicate sentences across a giant interval!
  // Clamp duration to natural spoken speech duration so it does NOT collide with or overwrite downstream dialogue.
  const charCount = text.replace(/[^\u4e00-\u9fa5]/g, '').length || text.length;
  const naturalDur = Math.min(dur, Math.max(1.8, parseFloat((charCount * 0.28 + 0.6).toFixed(2))));
  const clampedEnd = parseFloat((seg.startSec + naturalDur).toFixed(2));
  return [{
    ...seg,
    endSec: clampedEnd,
    duration: naturalDur,
  }];
}

function isTimeoutLikeError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  const msg = String(err.message || err.toString() || '').toLowerCase();
  return (
    status === 504 ||
    msg.includes('504') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('deadline expired') ||
    msg.includes('gateway timeout')
  );
}

function buildStage6OrderedModels(preferredModel = 'gemini-3.5-flash-lite', fallbackModels = STAGE6_CASCADE_MODELS, retiredModels = null, quotaDemotedModels = null, poolKeys = []) {
  const seen = new Set();
  const list = [];
  for (const m of [preferredModel, ...(Array.isArray(fallbackModels) ? fallbackModels : STAGE6_CASCADE_MODELS)]) {
    const cleanM = String(m || '').trim();
    if (!cleanM || seen.has(cleanM)) continue;
    if (retiredModels && retiredModels.has(cleanM)) continue;
    seen.add(cleanM);
    list.push(cleanM);
  }
  let ordered = list;
  if (Array.isArray(poolKeys) && poolKeys.length > 0) {
    ordered = geminiQuotaTracker.prioritizeAvailableModels(ordered, poolKeys);
  }
  if (!quotaDemotedModels || quotaDemotedModels.size === 0) {
    return ordered;
  }
  return [
    ...ordered.filter((m) => !quotaDemotedModels.has(m)),
    ...ordered.filter((m) => quotaDemotedModels.has(m)),
  ];
}

function parseJsonResponseText(resp) {
  const rawText = typeof resp?.text === 'function' ? resp.text() : resp?.text;
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty response text from Gemini');
  }
  const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(clean);
}

function applyBatchTranslations({ batchSlice, dialogueList, dialoguePayload, batchOffset, parsed, isFastOcrMode }) {
  const translations = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const transByIndex = new Map();
  const transBySegmentId = new Map();
  for (const t of translations) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.index === 'number') transByIndex.set(t.index, t);
    if (t.segmentId !== undefined && t.segmentId !== null) transBySegmentId.set(String(t.segmentId), t);
  }

  let appliedCount = 0;
  const missingLocalIndices = [];

  for (let i = 0; i < batchSlice.length; i++) {
    const globalIndex = batchOffset + i + 1;
    const payloadSegId = String(dialoguePayload[i]?.segmentId ?? globalIndex);
    const t = transByIndex.get(globalIndex) || transBySegmentId.get(payloadSegId);
    const targetSeg = dialogueList[batchOffset + i];
    if (!targetSeg) continue;
    if (t) {
      const maxWords = dialoguePayload[i]?.maxKhmerWords || 10;
      const ok = applyTranslatedSegmentResult(targetSeg, t, maxWords, batchOffset + i, { isFastOcrMode });
      if (ok) {
        appliedCount++;
      } else {
        missingLocalIndices.push(i);
      }
    } else {
      missingLocalIndices.push(i);
    }
  }

  return { appliedCount, missingLocalIndices };
}

/**
 * Stage 6: Generate Mode Specific Script
 * Mode A: Line-by-line faithful Chinese-to-Khmer spoken drama dubbing with character assignment,
 * strict duration/syllable word budget, isolated series glossary, auto genre awareness, and full context window.
 * Mode B: Theatrical cinematic recap narration based on global context.
 * 
 * @param {object} params
 * @param {string} params.mode - 'dialogue' (Mode A) or 'recap' (Mode B)
 * @param {Array} params.reconciledSegments
 * @param {number} params.durationSec
 * @param {object} params.aiClient
 * @param {string} [params.modelName='gemini-3.5-flash-lite']
 * @param {string} [params.userDirection='']
 * @param {string} [params.narratorGender='male']
 * @param {object} [params.seriesGlossary={}]
 * @param {string} [params.genre='auto']
 * @param {AbortSignal} [params.signal=null]
 * @param {Array<string>} [params.fallbackModels]
 * @param {number} [params.retryDelayMs=1500]
 * @returns {Promise<{ mode: string, genre: string, detectedGenre: string, summary: string, scriptSegments: Array, translationReport?: object }>}
 */
async function generateModeSpecificScript({
  mode = GENERATION_MODES.MODE_A_DIALOGUE,
  generationMode = '',
  reconciledSegments = [],
  durationSec = 0,
  aiClient,
  modelName = null,
  userDirection = '',
  narratorGender = 'male',
  seriesGlossary = {},
  genre = 'auto',
  signal = null,
  fallbackModels = STAGE6_CASCADE_MODELS,
  retryDelayMs = 1500,
}) {
  if (signal?.aborted) {
    throw createStage6AbortError();
  }

  const cleanReqModel = String(modelName || '').trim();
  const resolvedInitialModel = (cleanReqModel && cleanReqModel !== 'auto')
    ? cleanReqModel
    : geminiQuotaTracker.getPreferredPrimaryModel(STAGE6_CASCADE_MODELS[0]);
  const poolKeys = Array.isArray(aiClient?.pool?.keys) ? aiClient.pool.keys : [];

  const isFastOcrMode = generationMode === GENERATION_MODES.FAST_OCR;
  const normMode = (mode === GENERATION_MODES.MODE_B_RECAP || mode === 'cinematic_recap' || mode === 'recap')
    ? GENERATION_MODES.MODE_B_RECAP
    : GENERATION_MODES.MODE_A_DIALOGUE;

  if (normMode === GENERATION_MODES.MODE_A_DIALOGUE) {
    // ==========================================
    // MODE A: FAITHFUL LINE-BY-LINE DIALOGUE
    // ==========================================
    let dialogueList = [];
    for (const seg of reconciledSegments) {
      const pieces = splitLongDialogueSegment(seg);
      dialogueList.push(...pieces);
    }

    // Re-index strictly sequential IDs across all split dialogue items
    dialogueList = dialogueList.map((seg, idx) => ({
      ...seg,
      id: idx + 1,
      segmentId: idx + 1,
    }));

    if (dialogueList.length === 0) {
      return {
        mode: normMode,
        genre: genre || 'general',
        detectedGenre: genre || 'general',
        summary: 'គ្មានការសន្ទនាក្នុងវីដេអូនេះទេ (Genuine Silence/No Dialogue Detected)',
        scriptSegments: [],
      };
    }

    // Sample dialogue text for automatic genre detection
    const sampleText = dialogueList.slice(0, 40).map(s => s.originalChineseText || '').join(' ');
    let effectiveGenre = (genre && genre !== 'auto') ? genre : detectDramaGenre(sampleText, userDirection);

    // Process translations in batches of 20 lines to keep context tight and prevent token cut-off
    const TRANSLATION_BATCH = 20;
    let overallSummary = 'ការសន្ទនាក្នុងរឿងភាគ (Faithful Drama Dubbing)';

    const totalBatches = Math.ceil(dialogueList.length / TRANSLATION_BATCH);
    console.log(`[Stage 6 Mode A] 🌐 ចាប់ផ្តើមបកប្រែពាក្យសន្ទនាចិនទៅជាខ្មែរសរុប ${dialogueList.length} បន្ទាត់ (ចែកជា ${totalBatches} Batches)...`);

    const batchFailures = [];
    const retiredModels = new Set();
    const quotaDemotedModels = new Set();
    let activePrimaryModel = resolvedInitialModel;
    let consecutiveFailures = 0;

    for (let b = 0; b < dialogueList.length; b += TRANSLATION_BATCH) {
      if (signal?.aborted) {
        throw createStage6AbortError(`Stage 6 Mode A aborted before batch ${Math.floor(b / TRANSLATION_BATCH) + 1}/${totalBatches}`);
      }

      const batchNum = Math.floor(b / TRANSLATION_BATCH) + 1;
      const batchSlice = dialogueList.slice(b, b + TRANSLATION_BATCH);
      console.log(`[Stage 6 Mode A] ⏳ កំពុងបកប្រែ Batch ទី ${batchNum}/${totalBatches} (បន្ទាត់ ${b + 1} -> ${Math.min(dialogueList.length, b + TRANSLATION_BATCH)})...`);
      const dialoguePayload = batchSlice.map((s, idx) => {
        const globalIdx = b + idx;
        const nextSeg = dialogueList[globalIdx + 1];
        const rawDur = typeof s.duration === 'number' && s.duration > 0
          ? s.duration
          : parseFloat(Math.max(0.6, s.endSec - s.startSec).toFixed(2));

        // គណនា Slot ទំនេរពិតប្រាកដមុនពេលឃ្លាបន្ទាប់ចាប់ផ្តើម ដើម្បីការពារ Audio Timing Drift
        const slotUntilNext = (nextSeg && typeof nextSeg.startSec === 'number' && nextSeg.startSec > s.startSec)
          ? parseFloat((nextSeg.startSec - s.startSec).toFixed(2))
          : rawDur;

        const reliableSpeechDur = Number.isFinite(s.speechDuration) && s.speechDuration > 0
          ? s.speechDuration
          : null;
        const effectiveDur = Math.min(rawDur, slotUntilNext, reliableSpeechDur || rawDur, 4.5);

        // កំហិតពាក្យខ្មែរ 2.5 ពាក្យ/វិនាទី (សមស្របនឹងល្បឿនអានពិតរបស់ Edge TTS Khmer)
        const maxWords = Math.min(14, Math.max(2, Math.ceil(effectiveDur * 2.5)));

        const segmentChinese = String(s.originalChineseText || s.chineseText || s.originalText || '').trim();
        const audioTranscript = String(s.spokenAudioText || '').trim();
        const targetToTranslate = segmentChinese || audioTranscript;
        const audioContext = (audioTranscript && audioTranscript !== targetToTranslate) ? audioTranscript : null;

        const isOcrNoPitchSeg = isFastOcrMode || s.speakerSource === 'ocr_only';

        return {
          index: globalIdx + 1,
          segmentId: s.segmentId || s.id || (globalIdx + 1),
          startTime: formatSecondsToTimecode(s.startSec),
          endTime: formatSecondsToTimecode(s.endSec),
          durationSec: parseFloat(effectiveDur.toFixed(2)),
          maxKhmerWords: maxWords,
          sourceChineseToTranslate: targetToTranslate,
          surroundingAudioContext: audioContext,
          ocrSubtitleText: s.ocrSubtitleText || '',
          originalChineseText: s.originalChineseText || '',
          // Rule 3 (Honest hints): Fast OCR / ocr_only has no ASR or acoustic pitch — never feed fabricated stage-3 default as acoustic hint
          detectedGender: isOcrNoPitchSeg ? 'unknown' : (s.voiceGender || 'unknown'),
          acousticGenderHint: isOcrNoPitchSeg ? 'unknown' : (s.voiceGender || 'unknown'),
          acousticPitchHz: isOcrNoPitchSeg ? null : (s.pitchHz || s.acousticF0 || null),
        };
      });

      const isOcrBatch = isFastOcrMode || batchSlice.some((s) => s.speakerSource === 'ocr_only');

      // Context Window: provide surrounding context lines so Gemini translates connected thoughts
      const previousContext = b > 0
        ? dialogueList.slice(Math.max(0, b - 5), b).map((p, pIdx) => {
            const gLabel = p.voiceGender && p.voiceGender !== 'unknown' ? ` (${p.voiceGender})` : '';
            return `[#${b - 5 + pIdx + 1} ${p.speaker || 'តួ'}${gLabel}] ${p.originalChineseText} ➜ "${p.khmerTranslatedText || ''}"`;
          }).join('\n')
        : '(ដើមភាគដំបូង គ្មានបរិបទមុន)';

      const upcomingContext = dialogueList.slice(b + TRANSLATION_BATCH, b + TRANSLATION_BATCH + 5)
        .map((u, uIdx) => `[#${b + TRANSLATION_BATCH + uIdx + 1}] ${u.originalChineseText}`).join('\n') || '(ចុងបញ្ចប់ភាគ)';

      // Series-Isolated Glossary (តួអង្គ និងពាក្យពិសេសដាច់ដោយឡែកតាមរឿង)
      let customGlossaryPrompt = '';
      if (seriesGlossary?.characters?.length > 0) {
        const charNames = seriesGlossary.characters
          .map((c) => `${c.name || c.id}${c.khmerName ? ` -> "${c.khmerName}"` : ''}`)
          .join(', ');
        customGlossaryPrompt += `\n[SERIES CHARACTER GLOSSARY]: ${charNames}`;
      }
      if (seriesGlossary?.terms?.length > 0) {
        const termList = seriesGlossary.terms
          .map((t) => `${t.term || t.key}${t.khmer ? ` -> "${t.khmer}"` : ''}`)
          .join(', ');
        customGlossaryPrompt += `\n[SERIES TERMS GLOSSARY]: ${termList}`;
      }

      const genreGlossarySection = '';

      const modeAPrompt = `
អ្នកគឺជាអ្នកបកប្រែ និងសម្រួលសាច់រឿងចិនទៅជាភាសាខ្មែរសម្រាប់ DragonDub AI (Master Theatrical Drama Dubbing Translator & Script Director).
MODE A - FAITHFUL DIALOGUE TRANSLATION (ការបកប្រែពាក្យសន្ទនាតាមបន្ទាត់អក្សរចិនដើម ១០០% Line-by-Line Chinese Dialogue).

1. ស្គាល់ប្រភេទរឿង និងបរិបទ (DRAMA GENRE GUIDELINES):
${getGenrePromptGuidelines(effectiveGenre)}
${genreGlossarySection}
${customGlossaryPrompt}

2. ជ្រើសរើសរបៀបនិយាយឱ្យត្រូវនឹងរឿង:
- រឿងបុរាណ៖ ប្រើពាក្យសព្វនាម និងឋានៈសមស្រប (ខ្ញុំ, ឯង, លោកម្ចាស់, អ្នកនាង, ព្រឹទ្ធាចារ្យ)។
- រឿងសម័យទំនើប៖ ប្រើភាសាសន្ទនាធម្មជាតិ (បង, អូន, លោកប្រធាន, អ្នកស្រី) តាមទំនាក់ទំនងតួអង្គ។
- រឿងកំប្លែង ឬ Action៖ រក្សាអារម្មណ៍ កំហឹង ការភ្ញាក់ផ្អើល និងចង្វាក់សន្ទនាឱ្យសមនឹងឈុតឆាក។
- កុំប្រើពាក្យសព្វនាម ឬពាក្យបច្ចេកទេសរបស់ប្រភេទរឿងមួយ ទៅលើរឿងផ្សេងដោយគ្មានមូលហេតុ!

3. ប្រភពអត្ថបទចិន និងបរិបទសំឡេង (SOURCE CHINESE VS AUDIO CONTEXT):
- "sourceChineseToTranslate" គឺជាអត្ថបទចិនគោលដៅតែមួយគត់ដែលត្រូវបកប្រែសម្រាប់ Segment នេះ (THE SOLE TRANSLATION TARGET)។
- "surroundingAudioContext" (បើមាន) គឺសម្រាប់តែជាបរិបទជួយយល់ន័យឱ្យកាន់តែច្បាស់ប៉ុណ្ណោះ។ ហាមដាច់ខាតកុំយក "surroundingAudioContext" ទាំងមូលមកបកប្រែជំនួស "sourceChineseToTranslate"!
- ហាមដាច់ខាតកុំបកប្រែប្រយោគផ្សំ ASR ពេញលេញមួយ ដដែលៗលើ Segment ជាច្រើនដែលជាឃ្លាតូចៗនៃប្រយោគនោះ។

4. រក្សាឈ្មោះ និងវចនានុក្រមតាមរឿងនីមួយៗ (SERIES GLOSSARY CONSISTENCY):
- រក្សាឈ្មោះតួអង្គ ទីកន្លែង ឋានៈ និងពាក្យពិសេសឱ្យស៊ីសង្វាក់គ្នាក្នុងភាគទាំងអស់នៃ Series ដដែល។
- កុំយកវចនានុក្រមរបស់ Series មួយទៅប្រើលើ Series ផ្សេងដោយស្វ័យប្រវត្តិ។

5. បកប្រែសម្រាប់សំឡេង DUBBING & កំហិតពាក្យតាម DURATIONS (STRICT WORD BUDGET FOR TTS):
- ប្រើភាសាខ្មែរដែលមនុស្សនិយាយពិតៗ។ បកប្រែឱ្យខ្លី ចំខ្លឹមសារ រក្សាអត្ថន័យ អារម្មណ៍ និងទំនាក់ទំនងរបស់តួអង្គ។
- កំហិតពាក្យខ្មែរយ៉ាងតឹងរ៉ឹងតាម "maxKhmerWords": ត្រូវបកប្រែឱ្យខ្លី ចំខ្លឹមសារ មិនលើសពីចំនួន "maxKhmerWords" ដែលបានកំណត់ឡើយ ដើម្បីការពារកុំឱ្យសំឡេង TTS អូសបន្លាយជាន់លើតួអង្គបន្ទាប់។
- ប្រសិនបើឃ្លាចិនដើមជាឃ្លាមិនទាន់ចប់ន័យ (Incomplete Clause, ឧ. បញ្ចប់ដោយសញ្ញាក្បៀស ，) ត្រូវបកប្រែត្រឹមឃ្លានោះ (Incomplete Clause) ដោយរក្សាភាពស៊ីសង្វាក់ជាមួយឃ្លាបន្ទាប់ ហាមខ្ចីន័យ ឬប្រយោគពីឃ្លាបន្ទាប់មកបញ្ចប់ប្រយោគដោយខ្លួនឯងជាដាច់ខាត!

6. អ្វីដែលត្រូវជៀសវាង (STRICT AVOIDANCE RULES):
- ហាមដាច់ខាតបកប្រែពាក្យតាមពាក្យ (Literal / robotic Google Translate)។
- ហាមដាច់ខាតកុំឱ្យសល់តួអក្សរចិន (Chinese Characters / Hanzi 汉字) នៅក្នុង "khmerText" ដាច់ខាត (100% Khmer Script Only)! រាល់ពាក្យកម្រិតថាមពល (ឧ. 金丹 ➜ ជីនតាន, 化神 ➜ ហ្វាស៊ិន, 元神 ➜ យានស៊ិន, 灵根 ➜ ឫសវិញ្ញាណ) ត្រូវតែសរសេរជាសូរសព្ទអក្សរខ្មែរ ហាមទុកតួអក្សរចិន!
- ហាមដាច់ខាតកុំឱ្យមានតួអក្សរថៃ (Thai characters) ឬពាក្យថៃណាមួយ 100%!
- កុំបកស្រាយ OCR ជាសំឡេងនិយាយដោយស្វ័យប្រវត្តិនូវរាល់ Credits, Title, ឬ Watermark។
- កុំប្ដូរឈ្មោះតួអង្គ ឬសំឡេងរបស់ Speaker ដោយគ្មានភស្តុតាង។

7. ការកំណត់អត្តសញ្ញាណតួអង្គ និងភេទអ្នកនិយាយ (SPEAKER vs ADDRESSEE GENDER IDENTIFICATION):
- ត្រូវបែងចែកឱ្យដាច់រវាង «អ្នកកំពុងនិយាយ (Speaker)» និង «អ្នកដែលត្រូវគេហៅក្នុងប្រយោគ (Addressee / Person Mentioned)»!
  * គោលការណ៍ទូទៅ៖ នៅពេលតួអង្គស្រីនិយាយទៅកាន់បុរស ឬហៅឈ្មោះ/ងារតួប្រុស (ដូចជា "បង", "លោកប្រធាន", "សិស្សច្បង", "លោកប៉ា", "លោកម្ចាស់", "បងប្រុស") អ្នកនិយាយនៅតែជា «តួស្រី (female)» ដដែល។ ហាមដាច់ខាតឃើញពាក្យសម្គាល់ភេទប្រុស ឬឈ្មោះតួប្រុសក្នុងប្រយោគ ហើយដាក់អ្នកនិយាយជាប្រុស (male)!
${isOcrBatch
  ? '- Fast OCR Mode (គ្មាន ASR/Pitch ទេ — "acousticGenderHint" គឺ "unknown" និង "acousticPitchHz" គឺ null): មិនត្រូវអនុវត្តច្បាប់ pitch Hz ទេ។ ត្រូវវិនិច្ឆ័យ "speaker" និង "gender" ពីបរិបទអត្ថបទ និង [Previous Lines] ឱ្យស៊ីសង្វាក់គ្នា — តួអង្គដដែលត្រូវប្រើឈ្មោះ "speaker" និង "gender" ដូចគ្នាឆ្លងកាត់គ្រប់ Batch (ឧ. បើបរិបទជាសម្ដីនារីនិយាយទៅកាន់បុរស ត្រូវដាក់ "gender": "female" និង "speaker": "តួឯកស្រី" ឬឈ្មោះតួស្រី; ប្រើ "តួអង្គ" តែនៅពេលមិនដឹងតួអង្គពិតប្រាកដ)។'
  : '- ពិនិត្យ "acousticGenderHint" និង "acousticPitchHz"៖ បើ acousticPitchHz >= 170Hz ឬបរិបទជាសម្ដីនារីនិយាយទៅកាន់បុរស ត្រូវដាក់ "gender": "female" និង "speaker": "តួឯកស្រី" (ឬឈ្មោះតួស្រី) ដាច់ខាត។'}
- តួអង្គ «ប្រព័ន្ធ / AI System / 系统 / ទីប្រឹក្សាប្រព័ន្ធ» ត្រូវកំណត់ជា "speaker": "ប្រព័ន្ធ" និង "gender": "female" (សំឡេង Sreymom) ជាលំនាំដើម (លើកលែងតែបរិបទបញ្ជាក់ច្បាស់ថាជាតួបុរស)។
- ការលេងពាក្យក្នុងភាសាចិន (Chinese Puns / 谐音梗 / Slang)៖ ប្រសិនបើតួអង្គលេងពាក្យសូរសំឡេង ឬនិយាយពាក្យកំប្លុកកំប្លែង ត្រូវបកប្រែឱ្យស៊ីនឹងន័យកំប្លែង និងបរិបទសន្ទនាធម្មជាតិរបស់ខ្មែរ ហាមបកប្រែតាមសូរអក្សរឆ្គងៗរឹងៗ។
- "speaker": ឈ្មោះ ឬតួនាទីតួអង្គជាភាសាខ្មែរ (e.g. "តួឯកប្រុស", "តួឯកស្រី", "លោកប្រធាន", "អ្នកនាង", "អ្នកគ្រប់គ្រង", "មេទ័ព", "អ្នកភូមិ") តាមប្រភេទរឿង។
- "gender": "male" | "female" | "unknown" (សំឡេងប្រុសប្រើ Piseth, សំឡេងស្រីប្រើ Sreymom)។
${userDirection ? `User Custom Direction: ${userDirection}` : ''}

8. ព្រំដែនឃ្លា និងការការពារឃ្លាស្ទួន (STRICT CLAUSE BOUNDARY & ANTI-DUPLICATION):
- 1 Segment = 1 Translation: ឃ្លានីមួយៗត្រូវបកប្រែដាច់ដោយឡែកពីគ្នា ស្របតាម "sourceChineseToTranslate" របស់វា។
- ហាមដាច់ខាតកុំបកប្រែចេញអត្ថបទខ្មែរដូចគ្នា ២ បន្ទាត់ជាប់គ្នា លុះត្រាតែប្រយោគចិនដើមនៃបន្ទាត់ទាំងពីរជាពាក្យដដែលៗពិតប្រាកដ (ឧ. "对对对", "快走快走")។ បើប្រយោគចិនខុសគ្នា អត្ថបទខ្មែរត្រូវតែខុសគ្នា!
- ត្រូវផ្តល់លទ្ធផល "khmerText" មួយគត់សម្រាប់ index / segmentId នីមួយៗ ដោយមិនលុប ឬផ្លាស់ប្តូរលេខរៀងឡើយ។

SURROUNDING NARRATIVE CONTEXT:
[Previous Lines]:
${previousContext}

[Upcoming Lines Preview]:
${upcomingContext}

INPUT SEGMENTS TO TRANSLATE (Batch ${Math.floor(b / TRANSLATION_BATCH) + 1}):
${JSON.stringify(dialoguePayload, null, 2)}

Return JSON ONLY matching this schema:
{
  "summary": "សេចក្តីសង្ខេបសាច់រឿងខ្លី",
  "detectedGenre": "ancient" | "modern" | "action" | "comedy" | "general",
  "segments": [
    {
      "index": ${b + 1},
      "speaker": "តួឯកប្រុស",
      "gender": "male",
      "khmerText": "..."
    }
  ]
}
`;

      let orderedBatchModels = buildStage6OrderedModels(activePrimaryModel, fallbackModels, retiredModels, quotaDemotedModels, poolKeys);
      if (orderedBatchModels.length === 0) {
        orderedBatchModels = buildStage6OrderedModels(resolvedInitialModel, fallbackModels, null, null, poolKeys);
      }

      let recovered = false;
      const modelErrors = [];

      for (let mIdx = 0; mIdx < orderedBatchModels.length; mIdx++) {
        if (signal?.aborted) {
          throw createStage6AbortError(`Stage 6 Mode A aborted during batch ${batchNum}`);
        }
        const candidateModel = orderedBatchModels[mIdx];
        if (mIdx > 0) {
          console.log(`[Stage 6 Mode A] 🛡️ Batch ${batchNum}/${totalBatches}: Cascading to '${candidateModel}'...`);
        }

        const maxSameModelAttempts = 2;
        for (let attempt = 0; attempt < maxSameModelAttempts; attempt++) {
          try {
            const resp = await aiClient.models.generateContent({
              model: candidateModel,
              contents: [modeAPrompt],
              config: {
                temperature: 0.2,
                responseMimeType: 'application/json',
              },
            });

            const parsed = parseJsonResponseText(resp);
            const { appliedCount, missingLocalIndices } = applyBatchTranslations({
              batchSlice,
              dialogueList,
              dialoguePayload,
              batchOffset: b,
              parsed,
              isFastOcrMode,
            });

            if (appliedCount === 0 && batchSlice.length > 0) {
              throw new Error(`Model '${candidateModel}' returned 0 usable Khmer translations for Batch ${batchNum}`);
            }

            if (parsed.summary && b === 0) overallSummary = parsed.summary;
            if (parsed.detectedGenre && genre === 'auto' && b === 0) {
              effectiveGenre = parsed.detectedGenre;
            }

            // Flag any individual omitted lines inside an otherwise successful partial batch
            for (const missIdx of missingLocalIndices) {
              const targetSeg = dialogueList[b + missIdx];
              if (targetSeg && isPlaceholderTranslationText(targetSeg.khmerTranslatedText)) {
                targetSeg.khmerTranslatedText = '';
                targetSeg.reviewNeeded = true;
                targetSeg.translationStatus = 'review_needed';
                targetSeg.translationWarning = targetSeg.translationWarning || 'MISSING_SEGMENT_TRANSLATION';
                targetSeg.validationErrors = [
                  ...(targetSeg.validationErrors || []),
                  `មិនមានលទ្ធផលបកប្រែពី AI សម្រាប់បន្ទាត់ #${b + missIdx + 1} (ត្រូវការ Review ឬបកប្រែឡើងវិញ)`,
                ];
              }
            }

            activePrimaryModel = candidateModel;
            quotaDemotedModels.delete(candidateModel);
            recovered = true;
            if (mIdx > 0) {
              console.log(`[Stage 6 Mode A] ✅ Batch ${batchNum} rescued with '${candidateModel}'!`);
            }
            break;
          } catch (err) {
            if (isAbortLikeError(err, signal)) {
              throw err?.name === 'AbortError' ? err : createStage6AbortError();
            }

            const sanitizedMsg = sanitizeStage6ErrorMsg(err);

            // Fail-fast immediately on 401/403 authentication errors across ALL keys
            if (isAuthOrInvalidKeyError(err)) {
              const authErr = new Error(`[Stage 6 Mode A] Gemini API Key មិនត្រឹមត្រូវ ឬផុតសុពលភាព (${sanitizedMsg})`);
              authErr.status = Number(err?.status || err?.statusCode || 401);
              authErr.code = 'INVALID_API_KEY';
              authErr.nonRetryable = true;
              throw authErr;
            }

            const isNotFound = isModelNotFoundError(err);
            const isQuota = isQuotaOrRateLimitError(err);
            const isTimeout = isTimeoutLikeError(err);

            if (isNotFound) retiredModels.add(candidateModel);
            if (isQuota || isTimeout) quotaDemotedModels.add(candidateModel);

            // Cascade immediately on 404 / 429 / 503 / 504 without burning retry backoff on the same model
            const canRetrySameModel = !isNotFound && !isQuota && !isTimeout && attempt + 1 < maxSameModelAttempts;
            if (canRetrySameModel) {
              console.warn(`[Stage 6 Mode A] Retry '${candidateModel}' (attempt ${attempt + 1}/${maxSameModelAttempts}) for Batch ${batchNum}: ${sanitizedMsg}`);
              if (retryDelayMs > 0) {
                await new Promise((r) => setTimeout(r, retryDelayMs));
              }
              continue;
            }

            console.warn(`[Stage 6 Mode A] Batch ${batchNum} model '${candidateModel}' failed: ${sanitizedMsg}`);
            modelErrors.push({
              model: candidateModel,
              status: err?.status || err?.statusCode || null,
              isQuota,
              isNotFound,
              isTimeout,
              message: sanitizedMsg,
            });
            break;
          }
        }

        if (recovered) break;
      }

      if (recovered) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        const lastModelErr = modelErrors[modelErrors.length - 1] || { message: 'Unknown translation error' };
        batchFailures.push({
          batchNum,
          startIndex: b + 1,
          endIndex: b + batchSlice.length,
          segmentCount: batchSlice.length,
          lastError: lastModelErr,
          errors: modelErrors,
        });

        for (let i = 0; i < batchSlice.length; i++) {
          const targetSeg = dialogueList[b + i];
          if (targetSeg && isPlaceholderTranslationText(targetSeg.khmerTranslatedText)) {
            targetSeg.khmerTranslatedText = '';
            targetSeg.reviewNeeded = true;
            targetSeg.translationStatus = 'review_needed';
            targetSeg.translationWarning = 'TRANSLATION_FAILED';
            targetSeg.validationErrors = [
              ...(targetSeg.validationErrors || []),
              `ការបកប្រែ AI បរាជ័យសម្រាប់ Batch ${batchNum}: ${lastModelErr.message}`,
            ];
          }
        }

        // Fail fast on single-batch failures or consecutive full-cascade failures instead of hanging remaining batches
        if (totalBatches === 1 || consecutiveFailures >= 2) {
          console.error(`[Stage 6 Mode A] 🚨 Aborting Stage 6 early at Batch ${batchNum}/${totalBatches} after ${consecutiveFailures} consecutive full-cascade failure(s).`);
          break;
        }
      }
    }

    const translatedSegmentsCount = dialogueList.filter((s) => !isPlaceholderTranslationText(s.khmerTranslatedText)).length;
    const untranslatedCount = dialogueList.length - translatedSegmentsCount;
    const failedRatio = dialogueList.length > 0 ? untranslatedCount / dialogueList.length : 0;

    if (
      batchFailures.length > 0 &&
      (totalBatches === 1 ||
        consecutiveFailures >= 2 ||
        batchFailures.length >= 2 ||
        translatedSegmentsCount === 0 ||
        failedRatio >= 0.25)
    ) {
      const allErrors = batchFailures.flatMap((bf) => bf.errors || []);
      const hasQuotaErr = allErrors.some((e) => e.isQuota);
      const hasNotFoundOnly = allErrors.length > 0 && allErrors.every((e) => e.isNotFound);
      const firstFailedBatch = batchFailures[0]?.batchNum || 1;
      const lastMsg = batchFailures[batchFailures.length - 1]?.lastError?.message || 'All cascade models failed';

      let errCode = 'TRANSLATION_FAILED';
      let errStatus = batchFailures[batchFailures.length - 1]?.lastError?.status || 502;
      let errMessage = `[Stage 6 Mode A] ការបកប្រែ AI បរាជ័យ (${errCode}) នៅ Batch ${firstFailedBatch}/${totalBatches} (បរាជ័យ ${untranslatedCount}/${dialogueList.length} ឃ្លា): ${lastMsg}`;

      if (hasQuotaErr) {
        errCode = 'QUOTA_EXCEEDED';
        errStatus = 429;
        errMessage = `[Stage 6 Mode A] Gemini API Quota/Rate Limit ពេញគ្រប់ Key និងគ្រប់ Cascade Model នៅ Batch ${firstFailedBatch}/${totalBatches} (បរាជ័យ ${untranslatedCount}/${dialogueList.length} ឃ្លា): ${lastMsg}`;
      } else if (hasNotFoundOnly) {
        errCode = 'MODEL_UNAVAILABLE';
        errStatus = 404;
        errMessage = `[Stage 6 Mode A] ម៉ូដែល Gemini មិនអាចប្រើបាន (404 Model Unavailable) នៅ Batch ${firstFailedBatch}/${totalBatches}: ${lastMsg}`;
      }

      const stage6Err = new Error(errMessage);
      stage6Err.code = errCode;
      stage6Err.status = errStatus;
      stage6Err.translationReport = {
        totalSegments: dialogueList.length,
        translatedCount: translatedSegmentsCount,
        untranslatedCount,
        totalBatches,
        failedBatches: batchFailures.length,
        isPartial: translatedSegmentsCount > 0,
      };
      throw stage6Err;
    }

    // Phase 1: Non-destructive duplicate detection pass (flags warnings, never auto-deletes)
    dialogueList = detectDuplicateTranslations(dialogueList);

    // Whole-episode character gender consistency & voice re-derivation pass (both Fast OCR & Standard Dialogue)
    const consistencyRes = enforceEpisodeCharacterConsistency(dialogueList, {
      defaultGender: narratorGender,
      isFastOcrMode,
    });
    dialogueList = consistencyRes.segments;
    const consistencySummary = consistencyRes.stats;

    const scriptSegments = dialogueList.map((s, idx) => createCanonicalSegment(s, idx, normMode));
    const finalTranslatedCount = scriptSegments.filter((s) => !isPlaceholderTranslationText(s.khmerTranslatedText)).length;
    const finalUntranslatedCount = scriptSegments.length - finalTranslatedCount;

    return {
      mode: normMode,
      genre: effectiveGenre,
      detectedGenre: effectiveGenre,
      summary: overallSummary,
      ...(consistencySummary ? { consistencySummary } : {}),
      translationReport: {
        totalSegments: scriptSegments.length,
        translatedCount: finalTranslatedCount,
        untranslatedCount: finalUntranslatedCount,
        totalBatches,
        failedBatches: batchFailures.length,
        isPartial: finalUntranslatedCount > 0,
      },
      scriptSegments,
    };
  } else {
    // ==========================================
    // MODE B: CINEMATIC DRAMA RECAP / NARRATION
    // ==========================================
    const normNarratorGender = String(narratorGender || 'male').toLowerCase() === 'female' ? 'female' : 'male';
    const totalDurStr = formatSecondsToTimecode(durationSec);

    const contextHints = reconciledSegments
      .slice(0, 80)
      .map((s) => `[${formatSecondsToTimecode(s.startSec)}]: ${s.originalChineseText}`)
      .join('\n');

    const modeBPrompt = `
You are a master Khmer video storytelling recap narrator (អ្នកសម្រាយរឿងបែបកុនភាគខ្មែរ).
MODE B - CINEMATIC DRAMA RECAP (សម្រាយសាច់រឿងកុនរស់រវើក).

TASK (MODE B - CINEMATIC DRAMA RECAP / NARRATION):
Craft an engaging, dramatic, theatrical storytelling narration in Khmer covering the story progression.

VIDEO DURATION: ${durationSec}s (${totalDurStr})
SPEAKER GENDER: ${normNarratorGender}
ORIGINAL CHINESE CONTEXT HINTS:
${contextHints || '(គ្មានពាក្យសន្ទនាចិន - ផ្អែកលើការនិទានសាច់រឿង)'}
${userDirection ? `Special Instructions: ${userDirection}` : ''}

RULES:
1. Divide the video duration into natural narrative segments (each 6.0s - 14.0s).
2. "khmerText": Cinematic, theatrical Khmer narration with engaging hooks.
3. Keep segments non-overlapping, in chronological order spanning the video duration.
4. "speaker": "អ្នកសម្រាយរឿង"
5. Absolutely forbid Thai characters or loanwords.

Return JSON ONLY:
{
  "summary": "សេចក្តីសង្ខេបសាច់រឿងទាំងមូល 1-2 ប្រយោគ",
  "segments": [
    {
      "startSec": 0.5,
      "endSec": 8.0,
      "khmerText": "ស្វាគមន៍មកកាន់ការសម្រាយរឿង..."
    }
  ]
}
`;

    let summary = 'សម្រាយរឿងបែបកុនភាគខ្មែរ';
    let segmentsOut = [];

    const modeBModels = buildStage6OrderedModels(resolvedInitialModel, fallbackModels, null, null, poolKeys);
    let lastModeBErr = null;

    for (let mIdx = 0; mIdx < modeBModels.length; mIdx++) {
      if (signal?.aborted) {
        throw createStage6AbortError('Stage 6 Mode B aborted by user signal');
      }
      const candidateModel = modeBModels[mIdx];
      try {
        const resp = await aiClient.models.generateContent({
          model: candidateModel,
          contents: [modeBPrompt],
          config: {
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        });

        const parsed = parseJsonResponseText(resp);
        if (parsed.summary) summary = parsed.summary;
        const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : [];
        segmentsOut = rawSegs.map((s) => ({
          ...s,
          khmerText: cleanKhmerSpokenText(s.khmerText || ''),
          speaker: 'អ្នកសម្រាយរឿង',
          speakerId: 'narrator',
          voiceGender: normNarratorGender,
          voiceId: normNarratorGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural',
          evidenceType: 'cinematic_recap',
        }));
        break;
      } catch (err) {
        if (isAbortLikeError(err, signal)) {
          throw err?.name === 'AbortError' ? err : createStage6AbortError();
        }
        const sanitizedMsg = sanitizeStage6ErrorMsg(err);
        if (isAuthOrInvalidKeyError(err)) {
          const authErr = new Error(`[Stage 6 Mode B] Gemini API Key មិនត្រឹមត្រូវ ឬផុតសុពលភាព (${sanitizedMsg})`);
          authErr.status = Number(err?.status || err?.statusCode || 401);
          authErr.code = 'INVALID_API_KEY';
          authErr.nonRetryable = true;
          throw authErr;
        }
        lastModeBErr = err;
        console.warn(`[Stage 6 Mode B] Recap model '${candidateModel}' failed:`, sanitizedMsg);
        const canCascade = isQuotaOrRateLimitError(err) || isModelNotFoundError(err) || isTimeoutLikeError(err);
        if (!canCascade) break;
      }
    }

    if (segmentsOut.length === 0 && lastModeBErr) {
      const sanitizedMsg = sanitizeStage6ErrorMsg(lastModeBErr);
      const recapErr = new Error(`[Stage 6 Mode B] Recap generation call error: ${sanitizedMsg}`);
      recapErr.isPartial = false;
      recapErr.code = isQuotaOrRateLimitError(lastModeBErr) ? 'QUOTA_EXCEEDED' : 'RECAP_FAILED';
      recapErr.status = lastModeBErr?.status || lastModeBErr?.statusCode || (recapErr.code === 'QUOTA_EXCEEDED' ? 429 : 502);
      throw recapErr;
    }

    if (segmentsOut.length === 0) {
      throw new Error('[Stage 6 Mode B] Recap generation produced 0 segments');
    }

    const scriptSegments = segmentsOut.map((s, idx) => createCanonicalSegment(s, idx, normMode));
    return {
      mode: normMode,
      genre: genre || 'general',
      detectedGenre: genre || 'general',
      summary,
      scriptSegments,
    };
  }
}

function condenseKhmerDialogue(khmerText = '', targetWordLimit = 0) {
  if (!khmerText || typeof khmerText !== 'string') return khmerText;
  let text = cleanKhmerSpokenText(khmerText);

  // Remove superfluous filler phrases in spoken drama to tighten duration:
  const fillers = [
    /គឺថា\s*/g,
    /នោះគឺ\s*/g,
    /ទាល់តែសោះ/g,
    /យ៉ាងណាមិញ\s*/g,
    /ជាការពិតណាស់\s*/g,
    /ឯងដឹងទេថា\s*/g,
    /កុំបារម្ភអី\s*/g,
    /ដូច្នេះហើយ\s*/g,
    /ពិតជាខ្លាំងណាស់/g,
  ];
  for (const f of fillers) {
    text = text.replace(f, '');
  }

  // Compress repetitive spaces
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

module.exports = {
  generateModeSpecificScript,
  createCanonicalSegment,
  deriveVoiceFromGender,
  enforceEpisodeCharacterConsistency,
  enforceFastOcrCharacterConsistency,
  applyTranslatedSegmentResult,
  buildSafeSpeakerId,
  splitLongDialogueSegment,
  condenseKhmerDialogue,
  detectDramaGenre,
  getGenrePromptGuidelines,
  cleanKhmerSpokenText,
  computeKhmerSimilarity,
  detectDuplicateTranslations,
  isPlaceholderTranslationText,
  STAGE6_CASCADE_MODELS,
  DRAMA_GENRES,
  CULTIVATION_DRAMA_GLOSSARY,
};
