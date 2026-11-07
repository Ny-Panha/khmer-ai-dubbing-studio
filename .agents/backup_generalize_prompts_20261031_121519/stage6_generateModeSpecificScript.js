const { GENERATION_MODES, formatSecondsToTimecode } = require('../pipelineTypes');

const DRAMA_GENRES = {
  AUTO: 'auto',
  ANCIENT: 'ancient',
  MODERN: 'modern',
  ACTION: 'action',
  COMEDY: 'comedy',
  GENERAL: 'general',
};

const CULTIVATION_DRAMA_GLOSSARY = `
BUILT-IN DRAMA & CULTIVATION TERMINOLOGY (វចនានុក្រមគុណនិយម/កម្រិតថាមពល/កុនភាគខ្មែរ):
- 淬体 / 淬体境 / 淬体一层: "កម្រិតសម្អាតកាយ" (Body Tempering - ឧ. 淬体一层 = "កម្រិតសម្អាតកាយជាន់ទី១", 一个淬体一层的老头 = "ត្រឹមតាចាស់កម្រិតសម្អាតកាយជាន់ទី១សោះ")
- 聚灵 / 聚灵境: "ដែនប្រមូលវិញ្ញាណ" ឬ "កម្រិតប្រមូលវិញ្ញាណ" (Spirit Gathering - ឧ. 聚灵境九层 = "ដែនប្រមូលវិញ្ញាណជាន់ទី៩")
- 凝气: "កម្រិតបង្រួបខ្យល់វិញ្ញាណ"
- 筑基: "កម្រិតគ្រឹះវិញ្ញាណ"
- 金丹: "គ្រាប់ថ្នាំទិព្វ" ឬ "ជិនតាន"
- 元婴: "យានយីង"
- 本命武器: "អាវុធកំណើតប្រាណ" (Natal Weapon - ឧ. 本命武器无 = "គ្មានអាវុធកំណើតប្រាណ", 本命武器六条 = "អាវុធកំណើតប្រាណមាន៦ខ្សែ")
- 分魂: "ព្រលឹងបំបែក" ឬ "វិញ្ញាណបំបែក"
- 柳村: "ភូមិលីវ" (Liu Village - ហាមបកថា ភូមិលីន ឬ ភូមិលីវន)
- 柳树 / 柳灵: "ដើមលីវ" / "ព្រលឹងដើមលីវ" ឬ "វិញ្ញាណដើមលីវ" (Willow Tree/Spirit - ហាមដាច់ខាតបកប្រែថា ដើមឈើទំពាំងបាយជូរ ឬ ដើមឈើទាំងបាយធូរ!)
- 莫雷: "ម៉ូឡី" (Mo Lei)
- 骷髅怪物: "បិសាចឆ្អឹង"
- 重邪 / 邪物 / 怪物: "ពពួកបិសាច" ឬ "សត្វអាក្រក់" (ឧ. 骷髅怪物和邪物 = "បិសាចឆ្អឹង និងពពួកបិសាច")
- 村长: "មេភូមិ"
- 系统: "ប្រព័ន្ធ" (Game/Cultivation System)
- 别着急，因为你急也没用: "កុំទាន់អាលភ័យ ព្រោះភ័យក៏គ្មានប្រយោជន៍ដែរ"
- 那你说个屁 / 那你说个鸡X / 那你说哥基: "បើចឹងឯងនិយាយធ្វើអី!"
- 二师兄 / 猪八戒 / 八戒 / 天蓬: "សិស្សច្បងទីពីរ" / "ប៉ាជៀ" / "មេទ័ពធានផឹង" (ហាមបកប្រែប្រាសចាកពីឈ្មោះប៉ាជៀ!)
- 那叫你爸戒: "ចុះហៅបងថាប៉ាជៀវិញបានទេ?" ឬ "អ៊ីចឹងហៅថាបងប៉ាជៀតែម្តងទៅ!" (ហាមដាច់ខាតបកថា "ប៉ាឆា"!)
- 元神: "វិញ្ញាណដើម" ឬ "ដួងវិញ្ញាណ" (ឧ. 元神都快散了 = "ដួងវិញ្ញាណជិតរលាយបាត់អស់ទៅហើយ")
- 拜师: "សុំធ្វើជាសិស្ស" ឬ "គោរពគ្រូ"
`;

/**
 * Clean any accidental Thai characters or Thai loanwords from Khmer text
 */
function cleanKhmerSpokenText(str = '') {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/ผู้?บรรยาย/g, 'អ្នករៀបរាប់')
    .replace(/บรรยาย/g, 'រៀបរាប់')
    .replace(/ยาก/g, 'ពិបាក')
    .replace(/มั่ง/g, 'ខ្លះ')
    .replace(/[\u0E00-\u0E7F]+/g, '')
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
      // Legitimately repeated spoken dialogue (e.g. "对对对", "បាទ បាទ")
      curr.translationWarning = 'POSSIBLE_DUPLICATE_INPUT';
      // Preserved without error or modification
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
DRAMA GENRE: 🏛️ រឿងបុរាណចិន, Wuxia, Xianxia & Fantasy
- របៀបនិយាយ និងសព្វនាម៖ ប្រើពាក្យសព្វនាម និងឋានៈសមស្របតាមកុនបុរាណចិន (ខ្ញុំ, ឯង, លោកម្ចាស់, អ្នកនាង, ព្រឹទ្ធាចារ្យ, មេភូមិ, លោកគ្រូ, ម្ចាស់បង, ម្ចាស់អូន, ព្រះអង្គ, លោកមេទ័ព)។
- កម្រិតថាមពល និងក្បាច់គុន៖ បកប្រែពាក្យបច្ចេកទេសឱ្យត្រឹមត្រូវ (ឧ. 淬体 = កម្រិតសម្អាតកាយ, 聚灵 = ដែនប្រមូលវិញ្ញាណ, 本命武器 = អាវុធកំណើតប្រាណ, 柳村 = ភូមិលីវ, 柳树/柳灵 = ដើមលីវ/ព្រលឹងដើមលីវ)។
- រក្សាទឹកដមសមរម្យ ថ្លៃថ្នូរ អង់អាច និងមានអំណាច។
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

function buildSafeSpeakerId(speakerName = '', voiceGender = 'unknown', fallbackIndex = 0) {
  const cleanName = String(speakerName || '').trim()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
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
  const khmerText = cleanKhmerSpokenText(rawKhmer);
  const startSec = Math.max(0, typeof raw.startSec === 'number' ? raw.startSec : 0);
  const endSec = typeof raw.endSec === 'number' ? raw.endSec : startSec + 2.0;
  const dur = parseFloat(Math.max(0.6, endSec - startSec).toFixed(2));
  const evidenceSrc = raw.evidenceSource || raw.evidenceType || (mode === 'recap' ? 'cinematic_recap' : 'audio_asr');
  const cleanSpk = cleanKhmerSpokenText(raw.speaker) || (mode === 'recap' ? 'អ្នកសម្រាយរឿង' : 'តួអង្គ');

  let resolvedGender = String(raw.voiceGender || '').toLowerCase();
  if (resolvedGender !== 'female' && resolvedGender !== 'male') {
    if (typeof raw.pitchHz === 'number' && raw.pitchHz >= 170) {
      resolvedGender = 'female';
    } else if (/ស្រី|នាង|អ្នកនាង|ម៉ែ|យាយ|ព្រះនាង|សិស្សប្អូនស្រី/i.test(cleanSpk)) {
      resolvedGender = 'female';
    } else {
      resolvedGender = mode === 'recap' ? 'male' : 'unknown';
    }
  }

  const safeSpeakerId = mode === 'recap'
    ? 'narrator'
    : (raw.speakerId && !raw.speakerId.startsWith('spk_1') && !raw.speakerId.endsWith('_unknown') && (raw.speakerId.includes('female') || raw.speakerId.includes('male'))
        ? raw.speakerId
        : buildSafeSpeakerId(cleanSpk, resolvedGender, index));

  const assignedVoiceId = resolvedGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';

  return {
    id: index + 1,
    segmentId: raw.segmentId || index + 1,
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
    speakerId: safeSpeakerId,
    voiceGender: resolvedGender,
    voiceId: raw.voiceId || raw.khmerVoiceId || assignedVoiceId,
    khmerVoiceId: raw.khmerVoiceId || raw.voiceId || assignedVoiceId,
    voiceAssignmentSource: raw.voiceAssignmentSource || 'ai_pipeline',
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
    validationWarnings: Array.isArray(raw.validationWarnings) ? [...raw.validationWarnings] : [],
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
 * @returns {Promise<{ mode: string, genre: string, detectedGenre: string, summary: string, scriptSegments: Array }>}
 */
async function generateModeSpecificScript({
  mode = GENERATION_MODES.MODE_A_DIALOGUE,
  reconciledSegments = [],
  durationSec = 0,
  aiClient,
  modelName = 'gemini-3.5-flash-lite',
  userDirection = '',
  narratorGender = 'male',
  seriesGlossary = {},
  genre = 'auto',
}) {
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
    for (let b = 0; b < dialogueList.length; b += TRANSLATION_BATCH) {
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
          detectedGender: s.voiceGender || 'unknown',
          acousticGenderHint: s.voiceGender || 'unknown',
          acousticPitchHz: s.pitchHz || s.acousticF0 || null,
        };
      });

      // Context Window: provide surrounding context lines so Gemini translates connected thoughts
      const previousContext = b > 0
        ? dialogueList.slice(Math.max(0, b - 5), b).map((p, pIdx) => `[#${b - 5 + pIdx + 1} ${p.speaker || 'តួ'}] ${p.originalChineseText} ➜ "${p.khmerTranslatedText || ''}"`).join('\n')
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

      // Only inject ancient cultivation glossary when genre is ancient/xianxia or in glossary
      const genreGlossarySection = (effectiveGenre === 'ancient')
        ? CULTIVATION_DRAMA_GLOSSARY
        : '';

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
- ហាមដាច់ខាតកុំឱ្យមានតួអក្សរថៃ (Thai characters) ឬពាក្យថៃណាមួយ 100%!
- កុំបកស្រាយ OCR ជាសំឡេងនិយាយដោយស្វ័យប្រវត្តិនូវរាល់ Credits, Title, ឬ Watermark។
- កុំប្ដូរឈ្មោះតួអង្គ ឬសំឡេងរបស់ Speaker ដោយគ្មានភស្តុតាង។

7. ការកំណត់អត្តសញ្ញាណតួអង្គ និងភេទអ្នកនិយាយ (SPEAKER vs ADDRESSEE GENDER IDENTIFICATION - សំខាន់បំផុត):
- ត្រូវបែងចែកឱ្យដាច់រវាង «អ្នកកំពុងនិយាយ (Speaker)» និង «អ្នកដែលត្រូវគេហៅក្នុងប្រយោគ (Addressee)»!
  * ឧទាហរណ៍៖ បើក្នុងប្រយោគនិយាយថា "那一世，我没有拜师，没有喊过你二师兄" (ជាតិនោះ ខ្ញុំមិនបានសុំធ្វើជាសិស្ស ក៏មិនដែលហៅបងថាសិស្សច្បងទីពីរដែរ) -> ពាក្យ "二师兄" (សិស្សច្បងទីពីរ) គឺជាអ្នកស្តាប់ (ប៉ាជៀ - ប្រុស) ចំណែកអ្នកដែលកំពុងនិយាយប្រយោគនេះគឺជា «តួឯកស្រី (female)»! ហាមដាច់ខាតឃើញពាក្យ 二师兄 ក្នុងប្រយោគ ហើយដាក់អ្នកនិយាយជាប្រុស (male)!
- ពិនិត្យ "acousticGenderHint" និង "acousticPitchHz"៖ បើ acousticPitchHz >= 170Hz ឬបរិបទជាសម្ដីនារីនិយាយទៅកាន់បុរស ត្រូវដាក់ "gender": "female" និង "speaker": "តួឯកស្រី" (ឬឈ្មោះតួស្រី) ដាច់ខាត។
- ការលេងពាក្យក្នុងភាសាចិន (Chinese Puns / 谐音梗)៖ ប្រសិនបើតួអង្គលេងពាក្យដូចជា "那叫你爸戒" (លេងសូរសំឡេងជាមួយឈ្មោះ 八戒 = ប៉ាជៀ) ត្រូវបកប្រែឱ្យស៊ីនឹងសាច់រឿងធម្មជាតិ (ឧ. "អ៊ីចឹងហៅថាប៉ាជៀតែម្ដងទៅ!") ហាមបកប្រែតាមសូរអក្សរឆ្គងៗដូចជា "ប៉ាឆា" ជាដាច់ខាត!
- "speaker": ឈ្មោះ ឬតួនាទីតួអង្គជាភាសាខ្មែរ (e.g. "តួឯកប្រុស", "តួឯកស្រី", "លោកប្រធាន", "អ្នកភូមិ")។
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

      try {
        let resp = null;
        let attempt = 0;
        while (attempt < 3 && !resp) {
          try {
            resp = await aiClient.models.generateContent({
              model: modelName,
              contents: [modeAPrompt],
              config: {
                temperature: 0.2,
                responseMimeType: 'application/json',
              },
            });
          } catch (tErr) {
            attempt++;
            if (attempt >= 3) throw tErr;
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }

        const rawText = typeof resp?.text === 'function' ? resp.text() : resp?.text;
        if (rawText) {
          const clean = rawText.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim();
          const parsed = JSON.parse(clean);
          if (parsed.summary && b === 0) overallSummary = parsed.summary;
          if (parsed.detectedGenre && genre === 'auto' && b === 0) {
            effectiveGenre = parsed.detectedGenre;
          }
          const translations = Array.isArray(parsed.segments) ? parsed.segments : [];
          const transMap = new Map();
          for (const t of translations) {
            if (t && typeof t.index === 'number') transMap.set(t.index, t);
          }

          for (let i = 0; i < batchSlice.length; i++) {
            const globalIndex = b + i + 1;
            const t = transMap.get(globalIndex);
            const targetSeg = dialogueList[b + i];
            if (t && targetSeg) {
              const maxWords = dialoguePayload[i]?.maxKhmerWords || 10;
              const rawTranslated = cleanKhmerSpokenText(t.khmerText || '');
              // បង្រួមពាក្យបន្ថែមដោយស្វ័យប្រវត្តិបើវែងពេក ដើម្បីការពារកុំឱ្យ TTS អូសបន្លាយ
              targetSeg.khmerTranslatedText = condenseKhmerDialogue(rawTranslated, maxWords);
              targetSeg.speaker = cleanKhmerSpokenText(t.speaker) || targetSeg.speaker || 'តួអង្គ';

              // រួមបញ្ចូលភេទពី AI និងភេទពីហ្វ្រេកង់សំឡេងពិត (Acoustic Pitch F0)
              const aiGender = String(t.gender || '').toLowerCase();
              const hasFemalePitch = typeof targetSeg.pitchHz === 'number' && targetSeg.pitchHz >= 172;
              const hasMalePitch = typeof targetSeg.pitchHz === 'number' && targetSeg.pitchHz > 0 && targetSeg.pitchHz <= 148;

              if (hasFemalePitch) {
                targetSeg.voiceGender = 'female';
              } else if (hasMalePitch && aiGender !== 'female') {
                targetSeg.voiceGender = 'male';
              } else if (aiGender === 'female' || aiGender === 'male') {
                targetSeg.voiceGender = aiGender;
              }

              // កំណត់ speakerId ថ្មីតាមឈ្មោះតួអង្គ និងភេទ ដើម្បីកុំឱ្យជាប់ 'spk_1' រួមគ្នា
              targetSeg.speakerId = buildSafeSpeakerId(targetSeg.speaker, targetSeg.voiceGender, b + i);
            }
          }
        }
      } catch (err) {
        const sanitizedMsg = (err?.message || String(err)).replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]');
        console.warn(`[Stage 6 Mode A] Translation call notice for batch at index ${b + 1}:`, sanitizedMsg);
        batchFailures.push({
          batchIndex: Math.floor(b / TRANSLATION_BATCH) + 1,
          startIndex: b + 1,
          endIndex: Math.min(b + TRANSLATION_BATCH, dialogueList.length),
          error: sanitizedMsg,
        });
      }
    }

    if (batchFailures.length > 0) {
      const summaryMsg = batchFailures
        .map((f) => `Batch ${f.batchIndex} (segments ${f.startIndex}-${f.endIndex}): ${f.error}`)
        .join('; ');
      const batchErr = new Error(`[Stage 6 Mode A] Translation failed for ${batchFailures.length} batch(es): ${summaryMsg}`);
      batchErr.batchFailures = batchFailures;
      batchErr.isPartial = true;
      throw batchErr;
    }

    // Phase 1: Non-destructive duplicate detection pass (flags warnings, never auto-deletes)
    dialogueList = detectDuplicateTranslations(dialogueList);

    const scriptSegments = dialogueList.map((s, idx) => createCanonicalSegment(s, idx, normMode));
    return {
      mode: normMode,
      genre: effectiveGenre,
      detectedGenre: effectiveGenre,
      summary: overallSummary,
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

    try {
      const resp = await aiClient.models.generateContent({
        model: modelName,
        contents: [modeBPrompt],
        config: {
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      });

      const rawText = typeof resp.text === 'function' ? resp.text() : resp.text;
      if (rawText) {
        const clean = rawText.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim();
        const parsed = JSON.parse(clean);
        if (parsed.summary) summary = parsed.summary;
        const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : [];
        segmentsOut = rawSegs.map((s, idx) => ({
          ...s,
          khmerText: cleanKhmerSpokenText(s.khmerText || ''),
          speaker: 'អ្នកសម្រាយរឿង',
          speakerId: 'narrator',
          voiceGender: normNarratorGender,
          voiceId: normNarratorGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural',
          evidenceType: 'cinematic_recap',
        }));
      }
    } catch (err) {
      const sanitizedMsg = (err?.message || String(err)).replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]');
      console.warn('[Stage 6 Mode B] Recap generation call error:', sanitizedMsg);
      const recapErr = new Error(`[Stage 6 Mode B] Recap generation call error: ${sanitizedMsg}`);
      recapErr.isPartial = false;
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
  buildSafeSpeakerId,
  splitLongDialogueSegment,
  condenseKhmerDialogue,
  detectDramaGenre,
  getGenrePromptGuidelines,
  cleanKhmerSpokenText,
  computeKhmerSimilarity,
  detectDuplicateTranslations,
  DRAMA_GENRES,
  CULTIVATION_DRAMA_GLOSSARY,
};
