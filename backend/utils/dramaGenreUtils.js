/**
 * DragonDub AI Studio — Backend Drama Genre & Prompt Guidelines
 * Authoritative genre normalization, detection, and priority resolution.
 */

const SUPPORTED_GENRE_IDS = ['auto', 'ancient', 'modern', 'action', 'comedy'];

/**
 * Normalize drama genre string to standard supported ID
 * Maps legacy/alias 'ceo' -> 'modern', 'general' -> 'auto'
 */
function normalizeGenre(genre) {
  if (!genre || typeof genre !== 'string') return 'auto';
  const clean = genre.trim().toLowerCase();
  if (clean === 'ceo') return 'modern';
  if (clean === 'general') return 'auto';
  if (SUPPORTED_GENRE_IDS.includes(clean)) return clean;
  return 'auto';
}

/**
 * Automatically detect drama genre from Chinese dialogue sample & user instructions.
 * Used ONLY when genre === 'auto'.
 */
function detectDramaGenre(chineseTextSample = '', userDirection = '') {
  const cleanDir = String(userDirection || '');
  const combined = (String(chineseTextSample) + ' ' + cleanDir).toLowerCase();

  // Explicit user direction overrides
  if (/បុរាណ|គុណនិយម|xianxia|wuxia|fantasy|cultivation|martial/i.test(cleanDir)) return 'ancient';
  if (/សម័យទំនើប|ceo|romance|modern|office|corporate|ស្នេហា/i.test(cleanDir)) return 'modern';
  if (/action|សងសឹក|កាប់ចាក់|ស៊ើបអង្កេត|detective|revenge|police/i.test(cleanDir)) return 'action';
  if (/comedy|កំប្លែង|សើច/i.test(cleanDir)) return 'comedy';

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

  let maxGenre = 'auto';
  let maxScore = 0;
  for (const [g, s] of Object.entries(scores)) {
    if (s > maxScore) {
      maxScore = s;
      maxGenre = g;
    }
  }

  return maxScore >= 2 ? maxGenre : 'auto';
}

/**
 * Generate genre-specific guidelines for prompt
 * Correctly normalizes 'ceo' to 'modern'
 */
function getGenrePromptGuidelines(genre = 'general') {
  const norm = normalizeGenre(genre);
  switch (norm) {
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
    case 'auto':
    default:
      return `
DRAMA GENRE: ✨ រឿងទូទៅ / ស្គាល់តាមបរិបទជាក់ស្ដែង (Context-Aware Natural Drama)
- របៀបនិយាយ៖ វិភាគបរិបទជាក់ស្តែងនៃសាច់រឿង — ប្រសិនបើរឿងមានឈុតសម័យ ត្រូវប្រើភាសាសម័យ; បើជាឈុតបុរាណ ត្រូវប្រើភាសាបុរាណ។
- ហាមសន្មតថាគ្រប់រឿងសុទ្ធតែជារឿងគុណនិយម។ បើមិនប្រាកដ ត្រូវប្រើភាសាសន្ទនាខ្មែរធម្មជាតិបំផុត។
`;
  }
}

/**
 * Resolve effective genre adhering to documented priority order:
 * 1. Manual genre selection (when !== 'auto') is authoritative. Never overridden by AI detection.
 * 2. If genre === 'auto', AI-detected genre (from geminiDetectedGenre or sample analysis) determines effectiveGenre.
 * 3. Returns { effectiveGenre, requestedGenre, detectedGenre } preserving requestedGenre: 'auto' for retries.
 */
function resolveEffectiveGenre({
  genre = 'auto',
  chineseTextSample = '',
  userDirection = '',
  geminiDetectedGenre = null,
} = {}) {
  const normRequested = normalizeGenre(genre);

  if (normRequested !== 'auto') {
    // Explicit manual genre is authoritative
    return {
      effectiveGenre: normRequested,
      requestedGenre: normRequested,
      detectedGenre: normRequested,
    };
  }

  // Auto mode: check geminiDetectedGenre first, then fallback to heuristic sample detection
  let detected = 'auto';
  if (geminiDetectedGenre) {
    detected = normalizeGenre(geminiDetectedGenre);
  }
  if (detected === 'auto') {
    detected = detectDramaGenre(chineseTextSample, userDirection);
  }

  const effectiveGenre = detected === 'auto' ? 'general' : detected;

  return {
    effectiveGenre,
    requestedGenre: 'auto',
    detectedGenre: effectiveGenre,
  };
}

module.exports = {
  SUPPORTED_GENRE_IDS,
  normalizeGenre,
  detectDramaGenre,
  getGenrePromptGuidelines,
  resolveEffectiveGenre,
};
