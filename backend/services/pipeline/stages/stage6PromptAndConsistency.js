const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { formatSecondsToTimecode } = require('../pipelineTypes');
const { detectSpeakerGender } = require('../../../models/speakerRegistry');
const { isAuthOrInvalidKeyError, isQuotaOrRateLimitError } = require('../../geminiKeyManager');
const { DUBBING_CASCADE_MODELS } = require('../../geminiModelCatalog');
const { geminiQuotaTracker } = require('../../geminiQuotaTracker');
const {
  stripPunctuationForSpeech,
  isExplicitFillerKhmer,
  containsChineseHanzi,
  containsForeignScriptLeak,
  isExpressiveVocalizationSource,
  isPureDescriptiveSoundLabel,
} = require('../../../utils/translationQuality');
const {
  classifyTextEvent,
  isIntroductionCategory,
  NARRATOR_SPEAKER_LABEL,
  NARRATOR_SPEAKER_ID,
} = require('../../../utils/textEventClassifier');

// Smart Segment-Level Translation Cache (Persists verified Chinese -> Khmer segment translations)
function getTranslationCacheDir() {
  const dir = path.join(__dirname, '../../../uploads/cache/translation');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getTranslationCacheKey(chineseSource, {
  seriesId = 'default',
  glossaryHash = '',
  mode = 'dialogue',
  speaker = '',
  voiceGender = '',
  prevContext = '',
  schemaVersion = 'v3_ctx',
} = {}) {
  const norm = String(chineseSource || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？,.!?、]/g, '');
  const sId = String(seriesId || 'default').trim();
  const spk = String(speaker || '').trim().toLowerCase();
  const gen = String(voiceGender || '').trim().toLowerCase();
  const prevNorm = String(prevContext || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？,.!?、]/g, '')
    .substring(0, 32);

  return crypto.createHash('sha256')
    .update(`${schemaVersion}__${norm}__${sId}__${glossaryHash}__${mode}__${spk}__${gen}__${prevNorm}`)
    .digest('hex')
    .substring(0, 16);
}

function getCachedTranslation(chineseSource, options = {}) {
  if (!chineseSource) return null;
  const key = getTranslationCacheKey(chineseSource, options);
  const cachePath = path.join(getTranslationCacheDir(), `tr_${key}.json`);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const expectedSchema = options.schemaVersion || 'v3_ctx';
    if (
      data &&
      data.schemaVersion === expectedSchema &&
      data.khmerText &&
      !isPlaceholderTranslationText(data.khmerText, chineseSource)
    ) {
      return data;
    }
  } catch (_) {}
  return null;
}

function setCachedTranslation(chineseSource, {
  khmerText,
  speaker,
  voiceGender,
  seriesId = 'default',
  glossaryHash = '',
  mode = 'dialogue',
  prevContext = '',
  schemaVersion = 'v3_ctx',
} = {}) {
  if (!chineseSource || !khmerText || isPlaceholderTranslationText(khmerText)) return;
  const key = getTranslationCacheKey(chineseSource, {
    seriesId,
    glossaryHash,
    mode,
    speaker,
    voiceGender,
    prevContext,
    schemaVersion,
  });
  const cachePath = path.join(getTranslationCacheDir(), `tr_${key}.json`);
  try {
    fs.writeFileSync(cachePath, JSON.stringify({
      schemaVersion,
      chineseSource,
      khmerText,
      speaker: speaker || 'តួអង្គ',
      voiceGender: voiceGender || 'unknown',
      prevContext: prevContext || '',
      seriesId,
      timestamp: Date.now(),
    }, null, 2), 'utf8');
  } catch (_) {}
}

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

function isPlaceholderTranslationText(text = '', chineseSource = '') {
  const cleaned = String(text || '').trim();
  if (!cleaned) return true;
  if (isExplicitFillerKhmer(cleaned)) return true;
  if (!stripPunctuationForSpeech(cleaned)) return true;
  if (containsForeignScriptLeak(cleaned)) return true;
  if (chineseSource && isExpressiveVocalizationSource(chineseSource) && isPureDescriptiveSoundLabel(cleaned)) {
    return true;
  }
  return false;
}

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
  if (norm === 'male') {
    return {
      voiceGender: 'male',
      gender: 'male',
      speakerGender: 'MALE',
      voiceId: 'km-KH-PisethNeural',
      khmerVoiceId: 'km-KH-PisethNeural',
      voice: 'km-KH-PisethNeural',
      voiceLabel: 'ពិសិដ្ឋ (Piseth)',
      avatar: '👨',
      badgeColor: '#3b82f6',
    };
  }
  return {
    voiceGender: 'unknown',
    gender: 'unknown',
    speakerGender: 'UNKNOWN',
    voiceId: 'km-KH-PisethNeural',
    khmerVoiceId: 'km-KH-PisethNeural',
    voice: 'km-KH-PisethNeural',
    voiceLabel: 'ពិសិដ្ឋ (Piseth - Fallback)',
    avatar: '👤',
    badgeColor: '#64748b',
    isFallback: true,
    reviewNeeded: true,
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
  const khmerText = isPlaceholderTranslationText(cleanedKhmer) ? '' : cleanedKhmer;
  const startSec = Math.max(0, typeof raw.startSec === 'number' ? raw.startSec : 0);
  const endSec = typeof raw.endSec === 'number' ? raw.endSec : startSec + 2.0;
  const dur = parseFloat(Math.max(0.6, endSec - startSec).toFixed(2));
  const evidenceSrc = raw.evidenceSource || raw.evidenceType || (mode === 'recap' ? 'cinematic_recap' : 'audio_asr');
  const cleanSpk = cleanKhmerSpokenText(raw.speaker || raw.speakerName) || (mode === 'recap' ? 'អ្នកសម្រាយរឿង' : 'តួអង្គ');

  const isOcrOnly = raw.speakerSource === 'ocr_only';
  const isUserOverridden = Boolean(raw.userOverridden);
  const isGenericSpeaker = cleanSpk === 'តួអង្គ' || cleanSpk.toLowerCase() === 'speaker';
  const hasLockedStep1 = Boolean(
    raw.speakerStatus === 'verified' ||
    raw.speakerVerified === true ||
    raw.voiceAssignmentSource === 'multimodal_verified' ||
    raw.voiceAssignmentSource === 'series_glossary'
  );
  const isStep1ReviewNeeded = Boolean(raw.speakerStatus === 'review_needed' || raw.speakerReviewNeeded === true);

  const hasFemalePitch = typeof raw.pitchHz === 'number' && raw.pitchHz >= 175;
  const hasMalePitch = typeof raw.pitchHz === 'number' && raw.pitchHz > 0 && raw.pitchHz <= 152;

  let resolvedGender = String(raw.voiceGender || '').toLowerCase();
  const titleKwGender = !isUserOverridden ? detectSpeakerGender(cleanSpk) : 'UNKNOWN';
  if (isUserOverridden) {
    if (resolvedGender !== 'female' && resolvedGender !== 'male') {
      const explicitVoice = String(raw.voiceId || raw.khmerVoiceId || raw.voice || '');
      if (explicitVoice.includes('Sreymom')) resolvedGender = 'female';
      else if (explicitVoice.includes('Piseth')) resolvedGender = 'male';
      else resolvedGender = mode === 'recap' ? 'male' : 'unknown';
    }
  } else if (hasLockedStep1 && (resolvedGender === 'female' || resolvedGender === 'male')) {
    // Preserve Step 1 multimodal / glossary verified gender unconditionally (never override via noisy raw pitch)
  } else if (isStep1ReviewNeeded) {
    resolvedGender = 'unknown';
  } else if (isGenericSpeaker && (hasFemalePitch || hasMalePitch)) {
    // Generic placeholder characters without manual override follow verified acoustic pitch
    resolvedGender = hasFemalePitch ? 'female' : 'male';
  } else if (titleKwGender === 'FEMALE' || titleKwGender === 'MALE') {
    resolvedGender = titleKwGender === 'FEMALE' ? 'female' : 'male';
  } else if (resolvedGender !== 'female' && resolvedGender !== 'male') {
    if (hasFemalePitch) {
      resolvedGender = 'female';
    } else if (hasMalePitch) {
      resolvedGender = 'male';
    } else if (/ស្រី|នាង|អ្នកនាង|ម៉ែ|យាយ|ព្រះនាង|សិស្សប្អូនស្រី|ប្រព័ន្ធ|កុមារី|មាតា|ធីតា/i.test(cleanSpk)) {
      resolvedGender = 'female';
    } else if (!raw.isOffScreen && (raw.visualGender === 'female' || raw.visualGender === 'male')) {
      resolvedGender = raw.visualGender;
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
  } else if (hasLockedStep1 && raw.speakerId && !['spk_1', 'spk_default', 'spk'].includes(String(raw.speakerId).trim())) {
    safeSpeakerId = raw.speakerId;
  } else if (isOcrOnly) {
    safeSpeakerId = raw.speakerId || buildSafeSpeakerId(cleanSpk, resolvedGender, index);
  } else {
    // Preserve genuine diarization IDs (e.g. spk_1, spk_2, spk_lead, etc.)
    // Only fall back to buildSafeSpeakerId if raw.speakerId is missing or generic
    safeSpeakerId = (raw.speakerId && !['spk_1', 'spk_default', 'spk'].includes(String(raw.speakerId).trim()))
      ? raw.speakerId
      : buildSafeSpeakerId(cleanSpk, resolvedGender, index);
  }

  return {
    id: index + 1,
    segmentId: index + 1,
    ...(raw.sourceCueId ? { sourceCueId: raw.sourceCueId } : {}),
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
    ...(raw.position ? { position: raw.position } : {}),
    ...(raw.textCategory ? { textCategory: raw.textCategory } : {}),
    ...(raw.orientation ? { orientation: raw.orientation } : {}),
    ...(raw.textRegion ? { textRegion: raw.textRegion } : {}),
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
    ...(raw.manualCharacterOverridden ? { manualCharacterOverridden: true } : {}),
    ...(raw.manualTextOverridden ? { manualTextOverridden: true } : {}),
    ...(raw.translationSource ? { translationSource: raw.translationSource } : {}),
    ...(raw.voiceOverride ? { voiceOverride: raw.voiceOverride } : {}),
    ...(typeof raw.pitchHz === 'number' ? { pitchHz: raw.pitchHz } : {}),
    ...(typeof raw.pitchIqr === 'number' ? { pitchIqr: raw.pitchIqr } : {}),
    ...(raw.acousticGender ? { acousticGender: raw.acousticGender } : {}),
    ...(typeof raw.acousticConfidence === 'number' ? { acousticConfidence: raw.acousticConfidence } : {}),
    ...(raw.acousticClusterId ? { acousticClusterId: raw.acousticClusterId } : {}),
    ...(raw.bgmSuspected !== undefined ? { bgmSuspected: Boolean(raw.bgmSuspected) } : {}),
    ...(raw.genderConfidence !== undefined ? { genderConfidence: raw.genderConfidence } : {}),
    ...(raw.speakerStatus ? { speakerStatus: raw.speakerStatus } : {}),
    ...(raw.speakerVerified !== undefined ? { speakerVerified: Boolean(raw.speakerVerified) } : {}),
    ...(typeof raw.speakerConfidence === 'number' ? { speakerConfidence: raw.speakerConfidence } : {}),
    ...(raw.speakerReviewNeeded !== undefined ? { speakerReviewNeeded: Boolean(raw.speakerReviewNeeded) } : {}),
    ...(raw.unverifiedSpeaker !== undefined ? { unverifiedSpeaker: Boolean(raw.unverifiedSpeaker) } : {}),
    ...(raw.speakerEvidence ? { speakerEvidence: raw.speakerEvidence } : {}),
    ...(Array.isArray(raw.internalSpeakerTurns) && raw.internalSpeakerTurns.length > 0 ? { internalSpeakerTurns: raw.internalSpeakerTurns } : {}),
    ...(raw.hasMultipleSpeakers ? { hasMultipleSpeakers: true } : {}),
    ...(raw.speakerLocation ? { speakerLocation: raw.speakerLocation } : {}),
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
    uncertainOcr: Boolean(raw.uncertainOcr || raw.ocrConfidence === 'low'),
    ocrConfidence: raw.ocrConfidence || 'high',
    ocrDisagreement: Boolean(raw.ocrDisagreement),
    reviewNeeded: Boolean(raw.reviewNeeded || raw.speakerReviewNeeded || raw.uncertainOcr || raw.ocrDisagreement || !khmerText || raw.translationWarning === 'POTENTIAL_DUPLICATE_TRANSLATION'),
    uncertainTiming: Boolean(raw.uncertainTiming),
    audioGenerated: false,
    audioOutdated: true,
    fullAudioPath: null,
    fullAudioUrl: null,
  };
}

function hasManualTextOverride(seg) {
  if (!seg || typeof seg !== 'object') return false;
  if (seg.manualTextOverridden === true || seg.translationSource === 'manual') return true;
  // Backward compatibility: legacy userOverridden WITHOUT speaker/voice-only markers,
  // only when a real non-placeholder Khmer translation already exists.
  const isSpeakerOrVoiceOnlyOverride = Boolean(
    seg.manualCharacterOverridden ||
    seg.voiceOverride ||
    seg.voiceAssignmentSource === 'manual'
  );
  return Boolean(
    seg.userOverridden &&
    !isSpeakerOrVoiceOnlyOverride &&
    seg.khmerTranslatedText &&
    !isPlaceholderTranslationText(seg.khmerTranslatedText)
  );
}

function hasManualSpeakerOrVoiceOverride(seg) {
  if (!seg || typeof seg !== 'object') return false;
  return Boolean(
    seg.manualCharacterOverridden ||
    seg.voiceOverride ||
    seg.voiceAssignmentSource === 'manual' ||
    seg.userOverridden
  );
}

function applyTranslatedSegmentResult(targetSeg, t, maxWords, segIdx, { isFastOcrMode = false, castRegistry = [], forceRetranslate = false } = {}) {
  if (!targetSeg || !t) return false;

  const candidateKhmerRaw = t.khmerText || t.khmerTranslatedText || t.khmer || t.khmer_dialogue || '';
  const rawTranslated = cleanKhmerSpokenText(candidateKhmerRaw);
  const usableTranslated = isPlaceholderTranslationText(rawTranslated) ? '' : rawTranslated;
  const condensed = usableTranslated ? condenseKhmerDialogue(usableTranslated, maxWords) : '';
  const finalTranslated = !isPlaceholderTranslationText(condensed)
    ? condensed
    : (!isPlaceholderTranslationText(usableTranslated) ? usableTranslated : '');

  if (hasManualSpeakerOrVoiceOverride(targetSeg)) {
    // Manual speaker/character/voice override keeps speaker/gender/voice untouched,
    // while still populating missing translations or allowing non-manual-text retranslation.
    const textLocked = hasManualTextOverride(targetSeg) && !forceRetranslate;
    if (!textLocked || isPlaceholderTranslationText(targetSeg.khmerTranslatedText)) {
      if (finalTranslated) {
        targetSeg.khmerTranslatedText = finalTranslated;
        targetSeg.khmerText = finalTranslated;
        targetSeg.khmer = finalTranslated;
        targetSeg.translationStatus = 'translated';
      } else if (isPlaceholderTranslationText(targetSeg.khmerTranslatedText)) {
        targetSeg.khmerTranslatedText = '';
        targetSeg.reviewNeeded = true;
        targetSeg.translationStatus = 'review_needed';
      }
    }
    return !isPlaceholderTranslationText(targetSeg.khmerTranslatedText);
  }

  targetSeg.khmerTranslatedText = finalTranslated;
  if (!finalTranslated) {
    targetSeg.reviewNeeded = true;
    targetSeg.translationStatus = 'review_needed';
  } else {
    targetSeg.translationStatus = 'translated';
  }
  const hasLockedStep1Speaker = Boolean(
    targetSeg.speakerStatus === 'verified' ||
    targetSeg.speakerVerified === true ||
    targetSeg.voiceAssignmentSource === 'multimodal_verified' ||
    targetSeg.voiceAssignmentSource === 'series_glossary'
  );
  const isStep1ReviewNeeded = Boolean(
    targetSeg.speakerStatus === 'review_needed' ||
    targetSeg.speakerReviewNeeded === true
  );
  const resolvedSegCat = classifyTextEvent({
    text: targetSeg.originalChineseText || targetSeg.chineseText || '',
    textCategory: targetSeg.textCategory,
    position: targetSeg.position,
    orientation: targetSeg.orientation,
    textRegion: targetSeg.textRegion,
    deliveryType: targetSeg.deliveryType,
  });
  const isNarratedIntroSeg = isIntroductionCategory(resolvedSegCat);
  if (isNarratedIntroSeg) {
    targetSeg.textCategory = resolvedSegCat;
    targetSeg.deliveryType = 'narration';
    targetSeg.position = 'title_card';
    targetSeg.speaker = NARRATOR_SPEAKER_LABEL;
    targetSeg.speakerName = NARRATOR_SPEAKER_LABEL;
    targetSeg.speakerId = NARRATOR_SPEAKER_ID;
    targetSeg.characterId = NARRATOR_SPEAKER_ID;
    return !isPlaceholderTranslationText(targetSeg.khmerTranslatedText);
  }

  const cleanSpk = ((hasLockedStep1Speaker || isStep1ReviewNeeded) && targetSeg.speaker)
    ? cleanKhmerSpokenText(targetSeg.speaker)
    : (cleanKhmerSpokenText(t.speaker) || cleanKhmerSpokenText(targetSeg.speaker) || 'តួអង្គ');
  targetSeg.speaker = cleanSpk;
  targetSeg.speakerName = cleanSpk;

  const isOcrSeg = isFastOcrMode || targetSeg.speakerSource === 'ocr_only';
  const castMatch = Array.isArray(castRegistry)
    ? castRegistry.find(
        (c) =>
          c &&
          ((t.speakerId && c.speakerId === t.speakerId) ||
            (cleanSpk && (c.speakerLabelKh === cleanSpk || c.speakerId === cleanSpk)))
      )
    : null;
  const aiGender = String(t.voiceGender || t.gender || castMatch?.voiceGender || '').toLowerCase();
  const visGender = String(targetSeg.visualGender || '').toLowerCase();

  if (!isOcrSeg) {
    const hasVerifiedStep1 = Boolean(
      targetSeg.speakerStatus === 'verified' ||
      targetSeg.speakerVerified === true ||
      targetSeg.voiceAssignmentSource === 'multimodal_verified' ||
      targetSeg.voiceAssignmentSource === 'series_glossary'
    );
    if (isStep1ReviewNeeded) {
      targetSeg.voiceGender = 'unknown';
      targetSeg.speakerGender = 'UNKNOWN';
      targetSeg.reviewNeeded = true;
      targetSeg.speakerReviewNeeded = true;
      targetSeg.unverifiedSpeaker = true;
      const vMetaRev = deriveVoiceFromGender('unknown');
      targetSeg.voiceId = targetSeg.voiceId || vMetaRev.voiceId;
      targetSeg.khmerVoiceId = targetSeg.khmerVoiceId || vMetaRev.khmerVoiceId;
      targetSeg.voice = targetSeg.voice || vMetaRev.voice;
      targetSeg.speakerId = targetSeg.speakerId || buildSafeSpeakerId(cleanSpk, 'unknown', segIdx);
      return !isPlaceholderTranslationText(targetSeg.khmerTranslatedText);
    }
    if (hasLockedStep1Speaker && (targetSeg.voiceGender === 'female' || targetSeg.voiceGender === 'male')) {
      const vMetaLocked = deriveVoiceFromGender(targetSeg.voiceGender);
      targetSeg.speakerGender = vMetaLocked.speakerGender;
      targetSeg.gender = vMetaLocked.gender;
      targetSeg.voiceId = targetSeg.voiceId || vMetaLocked.voiceId;
      targetSeg.khmerVoiceId = targetSeg.khmerVoiceId || vMetaLocked.khmerVoiceId;
      targetSeg.voice = targetSeg.voice || vMetaLocked.voice;
      targetSeg.speakerId = targetSeg.speakerId || buildSafeSpeakerId(cleanSpk, targetSeg.voiceGender, segIdx);
      return !isPlaceholderTranslationText(targetSeg.khmerTranslatedText);
    }
    // Standard Mode: explicit unambiguous speaker title beats noisy un-isolated YIN pitch;
    // generic/neutral characters still follow real acoustic pitch, visual gender, or AI dialogue context.
    const hasFemalePitch = typeof targetSeg.pitchHz === 'number' && targetSeg.pitchHz >= 175;
    const hasMalePitch = typeof targetSeg.pitchHz === 'number' && targetSeg.pitchHz > 0 && targetSeg.pitchHz <= 152;
    const titleGender = detectSpeakerGender(cleanSpk);
    const isExplicitRoleTitle = /ប្រព័ន្ធ|តួឯកស្រី|តួស្រី|តួឯកប្រុស|តួប្រុស|女主|男主|女主角|男主角/i.test(cleanSpk);

    if (isExplicitRoleTitle && (titleGender === 'FEMALE' || titleGender === 'MALE')) {
      targetSeg.voiceGender = titleGender === 'FEMALE' ? 'female' : 'male';
    } else if (hasFemalePitch) {
      targetSeg.voiceGender = 'female';
    } else if (hasMalePitch) {
      targetSeg.voiceGender = 'male';
    } else if (!targetSeg.isOffScreen && (visGender === 'female' || visGender === 'male')) {
      targetSeg.voiceGender = visGender;
    } else if (titleGender === 'FEMALE') {
      targetSeg.voiceGender = 'female';
    } else if (titleGender === 'MALE') {
      targetSeg.voiceGender = 'male';
    } else if (aiGender === 'female' || aiGender === 'male') {
      targetSeg.voiceGender = aiGender;
    } else {
      targetSeg.voiceGender = 'unknown';
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
    targetSeg.isFallback = Boolean(vMeta.isFallback);
    targetSeg.reviewNeeded = Boolean(vMeta.reviewNeeded);
    targetSeg.speakerId = targetSeg.speakerId || buildSafeSpeakerId(cleanSpk, targetSeg.voiceGender, segIdx);
    return !isPlaceholderTranslationText(targetSeg.khmerTranslatedText);
  }

  // Fast OCR ('ocr_only') Mode: prioritize Step 1 Multimodal verified speaker -> visual+acoustic evidence -> explicit role title (NEVER translate-text guess over verified Step 1 speakers!)
  const hasVerifiedStep1 = Boolean(
    targetSeg.speakerStatus === 'verified' ||
    targetSeg.speakerVerified === true ||
    targetSeg.voiceAssignmentSource === 'multimodal_verified' ||
    targetSeg.voiceAssignmentSource === 'series_glossary' ||
    targetSeg.voiceAssignmentSource === 'manual' ||
    targetSeg.userOverridden === true
  );
  targetSeg.speakerSource = hasVerifiedStep1 ? (targetSeg.voiceAssignmentSource || 'multimodal_verified') : 'ocr_only';
  if (hasVerifiedStep1 && (targetSeg.voiceGender === 'female' || targetSeg.voiceGender === 'male')) {
    // Keep verified Step 1 assignment strictly locked against Khmer translation drift
    targetSeg.speakerGender = targetSeg.voiceGender.toUpperCase();
    targetSeg.speaker = targetSeg.speaker || targetSeg.speakerName || cleanSpk;
    targetSeg.speakerName = targetSeg.speakerName || targetSeg.speaker || cleanSpk;
  } else if (targetSeg.speakerStatus === 'review_needed' && targetSeg.voiceGender === 'unknown') {
    targetSeg.voiceGender = 'unknown';
    targetSeg.speakerGender = 'UNKNOWN';
    targetSeg.reviewNeeded = true;
    targetSeg.speakerReviewNeeded = true;
    targetSeg.unverifiedSpeaker = true;
  } else if (visGender === 'female' || visGender === 'male') {
    targetSeg.voiceGender = visGender;
  } else if ((targetSeg.acousticGender === 'female' || targetSeg.acousticGender === 'male') && Number(targetSeg.acousticConfidence || 0) >= 0.7 && !targetSeg.acousticAmbiguous) {
    targetSeg.voiceGender = targetSeg.acousticGender;
  } else if (aiGender === 'female' || aiGender === 'male') {
    targetSeg.voiceGender = aiGender;
  } else {
    const kwGender = detectSpeakerGender(
      { ...targetSeg, speaker: cleanSpk },
      { castRegistry }
    );
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
  if (!hasVerifiedStep1 && !isStep1ReviewNeeded) {
    targetSeg.voiceId = vMeta.voiceId;
    targetSeg.khmerVoiceId = vMeta.khmerVoiceId;
    targetSeg.voice = vMeta.voice;
    targetSeg.voiceLabel = vMeta.voiceLabel;
    targetSeg.avatar = vMeta.avatar;
    targetSeg.badgeColor = vMeta.badgeColor;
    targetSeg.gender = vMeta.gender;
    targetSeg.speakerGender = vMeta.speakerGender;
    targetSeg.unverifiedSpeaker = cleanSpk === 'តួអង្គ' || cleanSpk.toLowerCase() === 'speaker' || targetSeg.voiceGender === 'unknown';
    targetSeg.speakerId = buildSafeSpeakerId(cleanSpk, targetSeg.voiceGender, segIdx);
  } else {
    targetSeg.voiceLabel = targetSeg.voiceLabel || vMeta.voiceLabel;
    targetSeg.avatar = targetSeg.avatar || vMeta.avatar;
    targetSeg.badgeColor = targetSeg.badgeColor || vMeta.badgeColor;
    targetSeg.gender = targetSeg.voiceGender === 'female' ? 'female' : (targetSeg.voiceGender === 'male' ? 'male' : vMeta.gender);
    targetSeg.speakerGender = targetSeg.gender === 'female' ? 'FEMALE' : (targetSeg.gender === 'male' ? 'MALE' : 'UNKNOWN');
    targetSeg.speakerId = targetSeg.speakerId || buildSafeSpeakerId(cleanSpk, targetSeg.voiceGender, segIdx);
  }
  return !isPlaceholderTranslationText(targetSeg.khmerTranslatedText);
}

/**
 * Whole-episode character consistency pass (Fast OCR + Standard Dialogue):
 * - Ignores userOverridden / manual / multimodal-verified segments (untouched by text voting)
 * - Keeps generic 'តួអង្គ' per-line gender judgement (and unverifiedSpeaker: true on OCR) while re-deriving voice
 * - Groups named characters by cleanSpk across the full episode; majority gender wins and minority lines are corrected + voice re-derived
 * - Logs episode character & correction stats
 */
function enforceEpisodeCharacterConsistency(segments = [], { defaultGender = 'male', isFastOcrMode = false } = {}) {
  const normDefault = String(defaultGender || 'male').toLowerCase() === 'female' ? 'female' : 'male';
  const updated = Array.isArray(segments) ? segments.map((s) => ({ ...s })) : [];

  const groups = new Map();
  const genericIndices = [];
  let manualOverrideCount = 0;
  let autoVerifiedSpeakerCount = 0;
  let reviewNeededSpeakerCount = 0;

  for (let idx = 0; idx < updated.length; idx++) {
    const seg = updated[idx];
    const hasVerifiedStep1 = Boolean(
      seg.speakerStatus === 'verified' ||
      seg.speakerVerified === true ||
      seg.voiceAssignmentSource === 'multimodal_verified' ||
      seg.voiceAssignmentSource === 'series_glossary'
    );
    const isStep1ReviewNeeded = Boolean(seg.speakerStatus === 'review_needed' || seg.speakerReviewNeeded === true);
    const isManualSpeakerOrVoice = Boolean(
      seg.userOverridden ||
      seg.manualCharacterOverridden ||
      seg.voiceAssignmentSource === 'manual' ||
      seg.voiceOverride
    );
    const isOcrSeg = !hasVerifiedStep1 && (isFastOcrMode || seg.speakerSource === 'ocr_only');

    if (isManualSpeakerOrVoice) {
      manualOverrideCount++;
      continue;
    }
    const segCat = classifyTextEvent({
      text: seg.originalChineseText || seg.chineseText || '',
      textCategory: seg.textCategory,
      position: seg.position,
      orientation: seg.orientation,
      textRegion: seg.textRegion,
      deliveryType: seg.deliveryType,
    });
    if (isIntroductionCategory(segCat) || seg.speakerId === NARRATOR_SPEAKER_ID || seg.speaker === NARRATOR_SPEAKER_LABEL) {
      const navMeta = deriveVoiceFromGender(normDefault);
      seg.textCategory = segCat;
      seg.speaker = NARRATOR_SPEAKER_LABEL;
      seg.speakerName = NARRATOR_SPEAKER_LABEL;
      seg.speakerId = NARRATOR_SPEAKER_ID;
      seg.characterId = NARRATOR_SPEAKER_ID;
      seg.deliveryType = isIntroductionCategory(segCat) ? 'narration' : (seg.deliveryType || 'narration');
      seg.voiceGender = normDefault;
      seg.gender = navMeta.gender;
      seg.speakerGender = navMeta.speakerGender;
      seg.voiceId = navMeta.voiceId;
      seg.khmerVoiceId = navMeta.khmerVoiceId;
      seg.voice = navMeta.voice;
      seg.voiceLabel = navMeta.voiceLabel;
      seg.avatar = navMeta.avatar;
      seg.badgeColor = navMeta.badgeColor;
      seg.unverifiedSpeaker = false;
      seg.speakerStatus = 'verified';
      autoVerifiedSpeakerCount++;
      continue;
    }
    if (isStep1ReviewNeeded) {
      reviewNeededSpeakerCount++;
      continue;
    }
    if (hasVerifiedStep1 && (seg.voiceGender === 'female' || seg.voiceGender === 'male')) {
      autoVerifiedSpeakerCount++;
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
    if (isOcrSeg || g === 'unknown') {
      seg.unverifiedSpeaker = true;
    }
    seg.speakerId = seg.speakerId && !['spk_1', 'spk_តួអង្គ'].includes(seg.speakerId)
      ? seg.speakerId
      : (seg.acousticClusterId ? `spk_${g}_${seg.acousticClusterId}` : buildSafeSpeakerId('តួអង្គ', g, idx));
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
        winnerGender = (firstG === 'female' || firstG === 'male') ? firstG : 'unknown';
      }
    }

    const vMeta = deriveVoiceFromGender(winnerGender);
    const existingEntryId = entry.indices
      .map((i) => updated[i]?.speakerId)
      .find((id) => id && !['spk_1', 'spk_តួអង្គ'].includes(id));
    const canonicalSpeakerId = existingEntryId || buildSafeSpeakerId(charName, winnerGender, entry.indices[0]);
    let charCorrected = 0;
    let charStaleVoiceFixed = 0;

    for (const idx of entry.indices) {
      const seg = updated[idx];
      if (seg.speakerStatus === 'review_needed' && seg.speakerReviewNeeded === true && seg.voiceGender === 'unknown' && winnerGender === 'unknown') {
        seg.speaker = charName;
        seg.speakerName = charName;
        seg.speakerId = canonicalSpeakerId;
        seg.reviewNeeded = true;
        seg.unverifiedSpeaker = true;
        continue;
      }
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
      seg.isFallback = Boolean(vMeta.isFallback);
      seg.reviewNeeded = Boolean(vMeta.reviewNeeded);
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

  const totalUntouchedCount = manualOverrideCount + autoVerifiedSpeakerCount + reviewNeededSpeakerCount;
  if (characterSummary.length > 0 || genericIndices.length > 0 || totalUntouchedCount > 0) {
    const modeTag = isFastOcrMode ? 'Fast OCR Consistency' : 'Episode Consistency';
    console.log(
      `[Stage 6 ${modeTag}] 📊 Episode pass: ${characterSummary.length} named character(s) found (${genericIndices.length} generic 'តួអង្គ', ${autoVerifiedSpeakerCount} autoVerifiedSpeaker, ${manualOverrideCount} manualOverride, ${reviewNeededSpeakerCount} speakerReviewNeeded), ${genderCorrectedCount} minority segment(s) corrected, ${staleVoiceFixedCount} stale voiceId fixed.`
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
      overriddenCount: manualOverrideCount,
      manualOverrideCount,
      autoVerifiedSpeakerCount,
      reviewNeededSpeakerCount,
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

function extractJsonSliceFromText(text = '') {
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  let start = -1;
  let openCh = '';
  let closeCh = '';
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    start = objStart;
    openCh = '{';
    closeCh = '}';
  } else if (arrStart !== -1) {
    start = arrStart;
    openCh = '[';
    closeCh = ']';
  }
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseJsonResponseText(resp) {
  const rawText = typeof resp?.text === 'function' ? resp.text() : resp?.text;
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty response text from Gemini');
  }
  let clean = rawText.replace(/^\uFEFF/, '').trim();
  const fencedMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    clean = fencedMatch[1].trim();
  } else {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  try {
    return JSON.parse(clean);
  } catch (firstErr) {
    const trailingCommaFixed = clean.replace(/,\s*([\]}])/g, '$1');
    try {
      return JSON.parse(trailingCommaFixed);
    } catch (_) {}

    const slice = extractJsonSliceFromText(clean);
    if (slice) {
      try {
        return JSON.parse(slice);
      } catch (_) {}
      try {
        return JSON.parse(slice.replace(/,\s*([\]}])/g, '$1'));
      } catch (_) {}
    }

    throw firstErr;
  }
}

function normalizePositiveLookupKey(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === 'string') {
    const stripped = value.trim().replace(/^#/, '');
    if (/^\d+$/.test(stripped)) {
      const n = Number(stripped);
      return Number.isInteger(n) && n >= 1 ? n : null;
    }
  }
  return null;
}

function extractSegmentsFromParsedResponse(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.segments)) return parsed.segments;
  if (Array.isArray(parsed?.items)) return parsed.items;
  return [];
}

function resolveBatchTranslationMatches(translations = [], expectedItems = []) {
  const items = Array.isArray(translations) ? translations.filter((t) => t && typeof t === 'object') : [];
  const matches = new Array(expectedItems.length).fill(null);
  const usedTransIndices = new Set();

  // Pass 0: Exact immutable sourceCueId match if returned
  const bySourceCueId = new Map();
  items.forEach((t, ti) => {
    if (typeof t.sourceCueId === 'string' && t.sourceCueId.trim()) {
      const cid = t.sourceCueId.trim();
      if (!bySourceCueId.has(cid)) bySourceCueId.set(cid, ti);
    }
  });
  for (let ei = 0; ei < expectedItems.length; ei++) {
    const expCid = typeof expectedItems[ei]?.sourceCueId === 'string' ? expectedItems[ei].sourceCueId.trim() : '';
    if (expCid && bySourceCueId.has(expCid)) {
      const ti = bySourceCueId.get(expCid);
      if (!usedTransIndices.has(ti)) {
        matches[ei] = items[ti];
        usedTransIndices.add(ti);
      }
    }
  }

  // Pass 1: Strict unambiguous key match (exact index, segmentId, or id; supports numeric strings like "86")
  const byKey = new Map();
  items.forEach((t, ti) => {
    if (usedTransIndices.has(ti)) return;
    const keys = [
      normalizePositiveLookupKey(t.index),
      normalizePositiveLookupKey(t.segmentId),
      normalizePositiveLookupKey(t.id),
    ].filter((k) => k !== null);
    for (const k of keys) {
      if (!byKey.has(k)) byKey.set(k, ti);
    }
  });

  for (let ei = 0; ei < expectedItems.length; ei++) {
    if (matches[ei]) continue;
    const exp = expectedItems[ei] || {};
    const expKeys = [
      normalizePositiveLookupKey(exp.index),
      normalizePositiveLookupKey(exp.segmentId),
      normalizePositiveLookupKey(exp.id),
    ].filter((k) => k !== null);

    for (const k of expKeys) {
      const ti = byKey.get(k);
      if (ti !== undefined && !usedTransIndices.has(ti)) {
        matches[ei] = items[ti];
        usedTransIndices.add(ti);
        break;
      }
    }
  }

  // Pass 2: Safe 1-based relative re-indexing (e.g. retry batch [67, 233] returned as index 1, 2)
  const unmatchedExpIndices = [];
  for (let ei = 0; ei < expectedItems.length; ei++) {
    if (!matches[ei]) unmatchedExpIndices.push(ei);
  }
  if (unmatchedExpIndices.length > 0) {
    const unusedTrans = [];
    for (let ti = 0; ti < items.length; ti++) {
      if (!usedTransIndices.has(ti)) unusedTrans.push({ ti, item: items[ti] });
    }

    const hasBadOutOfRangeIndex = unusedTrans.some(({ item }) => {
      const explicitVals = [item.index, item.segmentId, item.id].filter((v) => v !== undefined && v !== null);
      if (explicitVals.length === 0) return false;
      const posKeys = explicitVals.map((v) => normalizePositiveLookupKey(v));
      if (posKeys.some((k) => k === null)) return true; // rejects <= 0 like -19..0
      return false;
    });

    if (!hasBadOutOfRangeIndex) {
      const relMap = new Map();
      for (const { ti, item } of unusedTrans) {
        const k = normalizePositiveLookupKey(item.index ?? item.id ?? item.segmentId);
        if (k !== null && k >= 1 && k <= expectedItems.length && !relMap.has(k)) {
          relMap.set(k, ti);
        }
      }

      if (relMap.size > 0) {
        for (const ei of unmatchedExpIndices) {
          const ti = relMap.get(ei + 1);
          if (ti !== undefined && !usedTransIndices.has(ti)) {
            matches[ei] = items[ti];
            usedTransIndices.add(ti);
          }
        }
      }

      // Pass 3: Safe 1:1 positional alignment ONLY when response item count == expected item count
      if (items.length === expectedItems.length) {
        const expectedGlobalSet = new Set();
        for (const exp of expectedItems) {
          for (const k of [
            normalizePositiveLookupKey(exp.index),
            normalizePositiveLookupKey(exp.segmentId),
            normalizePositiveLookupKey(exp.id),
          ]) {
            if (k !== null) expectedGlobalSet.add(k);
          }
        }
        const allItemsPlausibleForThisSlice = items.every((item) => {
          const explicitVals = [item.index, item.segmentId, item.id].filter((v) => v !== undefined && v !== null);
          if (explicitVals.length === 0) return true;
          return explicitVals.some((v) => {
            const k = normalizePositiveLookupKey(v);
            return k !== null && (k <= expectedItems.length || expectedGlobalSet.has(k));
          });
        });

        if (allItemsPlausibleForThisSlice) {
          for (let ei = 0; ei < expectedItems.length; ei++) {
            if (!matches[ei] && !usedTransIndices.has(ei) && items[ei]) {
              matches[ei] = items[ei];
              usedTransIndices.add(ei);
            }
          }
        }
      }
    }
  }

  return matches;
}

function applyBatchTranslations({ batchSlice, dialogueList, dialoguePayload, batchOffset, parsed, isFastOcrMode }) {
  const translations = extractSegmentsFromParsedResponse(parsed);
  const castRegistry = Array.isArray(parsed?.castRegistry) ? parsed.castRegistry : [];
  const expectedItems = batchSlice.map((seg, i) => ({
    index: batchOffset + i + 1,
    segmentId: dialoguePayload[i]?.segmentId ?? (batchOffset + i + 1),
    id: dialoguePayload[i]?.segmentId ?? (batchOffset + i + 1),
    ...(seg?.sourceCueId ? { sourceCueId: seg.sourceCueId } : {}),
  }));
  const matchedTranslations = resolveBatchTranslationMatches(translations, expectedItems);

  let appliedCount = 0;
  const missingLocalIndices = [];

  for (let i = 0; i < batchSlice.length; i++) {
    const t = matchedTranslations[i];
    const targetSeg = dialogueList[batchOffset + i];
    if (!targetSeg) continue;
    if (t) {
      const maxWords = dialoguePayload[i]?.maxKhmerWords || 10;
      const ok = applyTranslatedSegmentResult(targetSeg, t, maxWords, batchOffset + i, { isFastOcrMode, castRegistry });
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
 * Compute realistic Khmer dubbing word & character budget from available slot duration.
 * Real Edge Neural Khmer TTS speaks ~14-15 chars/sec at 1.0x and ~19-20 chars/sec at comfortable <=1.35x speed.
 * Because Khmer does not put spaces between words, maxKhmerChars prevents overflowing tight slots (0.6s-1.5s).
 */
function computeKhmerSlotBudget(durationSec = 1.5) {
  const safeDur = Math.max(0.4, Math.min(4.5, Number(durationSec) || 1.5));
  const maxKhmerWords = Math.min(14, Math.max(2, Math.ceil(safeDur * 2.5)));
  const maxKhmerChars = Math.min(82, Math.max(8, Math.round(safeDur * 16)));
  return {
    durationSec: parseFloat(safeDur.toFixed(2)),
    maxKhmerWords,
    maxKhmerChars,
  };
}

function buildRetrySegmentPayload(dialogueList, globalIdx) {
  const s = dialogueList[globalIdx];
  const prevSeg = globalIdx > 0 ? dialogueList[globalIdx - 1] : null;
  const nextSeg = globalIdx + 1 < dialogueList.length ? dialogueList[globalIdx + 1] : null;
  const rawDur = typeof s.duration === 'number' && s.duration > 0
    ? s.duration
    : parseFloat(Math.max(0.6, (s.endSec || 0) - (s.startSec || 0)).toFixed(2));
  const slotUntilNext = (nextSeg && typeof nextSeg.startSec === 'number' && nextSeg.startSec > (s.startSec || 0))
    ? parseFloat((nextSeg.startSec - (s.startSec || 0)).toFixed(2))
    : rawDur;
  const budget = computeKhmerSlotBudget(Math.min(rawDur, slotUntilNext));
  const segChinese = String(s.originalChineseText || s.chineseText || s.originalText || s.spokenAudioText || '').trim();
  const prevChinese = prevSeg ? String(prevSeg.originalChineseText || prevSeg.chineseText || '').trim() : '';
  const nextChinese = nextSeg ? String(nextSeg.originalChineseText || nextSeg.chineseText || '').trim() : '';

  return {
    index: s.segmentId || s.id || (globalIdx + 1),
    segmentId: s.segmentId || s.id || (globalIdx + 1),
    ...(s.sourceCueId ? { sourceCueId: s.sourceCueId } : {}),
    sourceChineseToTranslate: segChinese,
    ...(prevChinese ? { prevContext: prevChinese } : {}),
    ...(nextChinese ? { nextContext: nextChinese } : {}),
    durationSec: budget.durationSec,
    maxKhmerWords: budget.maxKhmerWords,
    maxKhmerChars: budget.maxKhmerChars,
    speaker: s.speaker || 'តួអង្គ',
    detectedGender: s.voiceGender || 'unknown',
  };
}

function clearRescuedSegmentFailureState(targetSeg) {
  if (!targetSeg) return;
  targetSeg.reviewNeeded = Boolean(targetSeg.uncertainOcr);
  targetSeg.translationStatus = 'translated';
  if (
    targetSeg.translationWarning === 'MISSING_SEGMENT_TRANSLATION' ||
    targetSeg.translationWarning === 'TRANSLATION_FAILED'
  ) {
    targetSeg.translationWarning = null;
  }
  if (Array.isArray(targetSeg.validationErrors) && targetSeg.validationErrors.length > 0) {
    targetSeg.validationErrors = targetSeg.validationErrors.filter(
      (e) =>
        !String(e).includes('មិនមានលទ្ធផលបកប្រែពី AI') &&
        !String(e).includes('ការបកប្រែ AI បរាជ័យ') &&
        !String(e).includes('មិនទាន់មានអត្ថបទបកប្រែ')
    );
  }
}

function extractSingleLineRescueCandidate(parsed, expectedItem) {
  if (!parsed || typeof parsed !== 'object') return null;

  // Direct single-object response: { speaker, gender, khmerText }
  if (!Array.isArray(parsed) && (parsed.khmerText || parsed.khmerTranslatedText || parsed.khmer)) {
    const explicitVals = [parsed.index, parsed.segmentId, parsed.id].filter((v) => v !== undefined && v !== null);
    if (explicitVals.length === 0 || explicitVals.some((v) => normalizePositiveLookupKey(v) !== null)) {
      return parsed;
    }
  }

  const list = extractSegmentsFromParsedResponse(parsed).filter((item) => item && typeof item === 'object');
  if (list.length === 0) return null;

  const expectedKeys = [
    normalizePositiveLookupKey(expectedItem?.index),
    normalizePositiveLookupKey(expectedItem?.segmentId),
    normalizePositiveLookupKey(expectedItem?.id),
  ].filter((k) => k !== null);

  // Match explicit target key if multi-item or keyed response is returned
  for (const item of list) {
    const itemKeys = [
      normalizePositiveLookupKey(item.index),
      normalizePositiveLookupKey(item.segmentId),
      normalizePositiveLookupKey(item.id),
    ].filter((k) => k !== null);
    if (itemKeys.some((k) => expectedKeys.includes(k))) {
      return item;
    }
  }

  // If strictly 1 object was wrapped in an array/segments list, accept if it does NOT carry an invalid (<= 0) key
  if (list.length === 1) {
    const only = list[0];
    const explicitVals = [only.index, only.segmentId, only.id].filter((v) => v !== undefined && v !== null);
    if (explicitVals.length === 0) return only;
    if (explicitVals.every((v) => normalizePositiveLookupKey(v) !== null)) {
      const k = normalizePositiveLookupKey(explicitVals[0]);
      if (k === 1 || expectedKeys.includes(k)) {
        return only;
      }
    }
  }

  return null;
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

function condenseKhmerDialogue(khmerText = '', targetWordLimit = 0) {
  if (!khmerText || typeof khmerText !== 'string') return khmerText;
  const initialClean = cleanKhmerSpokenText(khmerText);
  let text = initialClean;

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
  // Never strip a valid short phrase (e.g. "កុំបារម្ភអី!") down to bare punctuation ("!") or empty string
  if (!stripPunctuationForSpeech(text) && stripPunctuationForSpeech(initialClean)) {
    return initialClean;
  }
  return text;
}

module.exports = {
  getTranslationCacheDir,
  getTranslationCacheKey,
  getCachedTranslation,
  setCachedTranslation,
  STAGE6_CASCADE_MODELS,
  sanitizeStage6ErrorMsg,
  isModelNotFoundError,
  isAbortLikeError,
  createStage6AbortError,
  isPlaceholderTranslationText,
  cleanKhmerSpokenText,
  condenseKhmerDialogue,
  computeKhmerSimilarity,
  detectDuplicateTranslations,
  detectDramaGenre,
  getGenrePromptGuidelines,
  deriveVoiceFromGender,
  buildSafeSpeakerId,
  createCanonicalSegment,
  hasManualTextOverride,
  hasManualSpeakerOrVoiceOverride,
  applyTranslatedSegmentResult,
  enforceEpisodeCharacterConsistency,
  enforceFastOcrCharacterConsistency,
  splitLongDialogueSegment,
  isTimeoutLikeError,
  buildStage6OrderedModels,
  extractJsonSliceFromText,
  parseJsonResponseText,
  normalizePositiveLookupKey,
  extractSegmentsFromParsedResponse,
  resolveBatchTranslationMatches,
  applyBatchTranslations,
  computeKhmerSlotBudget,
  buildRetrySegmentPayload,
  clearRescuedSegmentFailureState,
  extractSingleLineRescueCandidate,
};
