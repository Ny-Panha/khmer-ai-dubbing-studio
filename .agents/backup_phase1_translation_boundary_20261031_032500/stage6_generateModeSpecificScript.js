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

function createCanonicalSegment(raw = {}, index = 0, mode = 'dialogue') {
  const origChinese = String(raw.originalChineseText || raw.chineseText || raw.originalText || '').trim();
  const rawKhmer = String(raw.khmerTranslatedText || raw.khmerText || raw.khmer || '').trim();
  const khmerText = cleanKhmerSpokenText(rawKhmer);
  const startSec = Math.max(0, typeof raw.startSec === 'number' ? raw.startSec : 0);
  const endSec = typeof raw.endSec === 'number' ? raw.endSec : startSec + 2.0;
  const dur = parseFloat(Math.max(0.6, endSec - startSec).toFixed(2));
  const evidenceSrc = raw.evidenceSource || raw.evidenceType || (mode === 'recap' ? 'cinematic_recap' : 'audio_asr');
  const cleanSpk = cleanKhmerSpokenText(raw.speaker) || (mode === 'recap' ? 'អ្នកសម្រាយរឿង' : 'តួអង្គ');

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
    speakerId: raw.speakerId || (mode === 'recap' ? 'narrator' : `spk_${index + 1}`),
    voiceGender: raw.voiceGender || (mode === 'recap' ? 'male' : 'unknown'),
    voiceId: raw.voiceId || raw.khmerVoiceId || (raw.voiceGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural'),
    khmerVoiceId: raw.khmerVoiceId || raw.voiceId || (raw.voiceGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural'),
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
    reviewNeeded: Boolean(raw.reviewNeeded || !khmerText),
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
        const segDur = typeof s.duration === 'number' && s.duration > 0
          ? s.duration
          : parseFloat(Math.max(0.6, s.endSec - s.startSec).toFixed(2));
        const maxWords = Math.max(3, Math.ceil(segDur * 3.5));
        return {
          index: b + idx + 1,
          startTime: formatSecondsToTimecode(s.startSec),
          endTime: formatSecondsToTimecode(s.endSec),
          durationSec: segDur,
          maxKhmerWords: maxWords,
          spokenChineseAudio: s.spokenAudioText || s.originalChineseText,
          ocrSubtitleText: s.ocrSubtitleText || s.originalChineseText,
          originalChineseText: s.originalChineseText,
          detectedGender: s.voiceGender || 'unknown',
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

3. ផ្ទៀងផ្ទាត់ ASR និង OCR (DUAL-SOURCE RECONCILIATION):
- "spokenChineseAudio" គឺជាសំឡេងនិយាយជាក់ស្តែងរបស់តួអង្គ (PRIMARY GROUND TRUTH)។
- ប្រើ ASR ដើម្បីយល់ពីអ្វីដែលតួអង្គនិយាយ និង OCR ដើម្បីជួយផ្ទៀងផ្ទាត់អក្សរលើអេក្រង់។
- ប្រើបរិបទដើម្បីកែអត្ថបទដែលចាប់ខុស ប៉ុន្តែកុំបង្កើតព័ត៌មានដែលមិនមានភស្តុតាង។
- បើប្រភពទាំងពីរផ្ទុយគ្នា ត្រូវជ្រើសរើសដោយប្រុងប្រយ័ត្ន។

4. រក្សាឈ្មោះ និងវចនានុក្រមតាមរឿងនីមួយៗ (SERIES GLOSSARY CONSISTENCY):
- រក្សាឈ្មោះតួអង្គ ទីកន្លែង ឋានៈ និងពាក្យពិសេសឱ្យស៊ីសង្វាក់គ្នាក្នុងភាគទាំងអស់នៃ Series ដដែល។
- កុំយកវចនានុក្រមរបស់ Series មួយទៅប្រើលើ Series ផ្សេងដោយស្វ័យប្រវត្តិ។

5. បកប្រែសម្រាប់សំឡេង DUBBING & កំហិតពាក្យតាម DURATIONS (STRICT WORD BUDGET FOR TTS):
- ប្រើភាសាខ្មែរដែលមនុស្សនិយាយពិតៗ។ បកប្រែឱ្យខ្លី ចំខ្លឹមសារ រក្សាអត្ថន័យ អារម្មណ៍ និងទំនាក់ទំនងរបស់តួអង្គ។
- កំហិតពាក្យខ្មែរយ៉ាងតឹងរ៉ឹង៖ "maxKhmerWords" = Math.ceil(durationSec * 3.5)។
- បើរយៈពេល 1.0s (maxKhmerWords = 4), ត្រូវបកប្រែត្រឹម 3-4 ពាក្យប៉ុណ្ណោះ! ហាមបង្កើតប្រយោគវែង 10-15 ពាក្យដែលនាំឱ្យសំឡេង TTS អូសបន្លាយជាន់លើតួអង្គបន្ទាប់។
- រក្សាភាពរលូន ហាមដាច់កន្ទុយប្រយោគ ឬបង្កើតឃ្លាមិនពេញលេញ។

6. អ្វីដែលត្រូវជៀសវាង (STRICT AVOIDANCE RULES):
- ហាមដាច់ខាតបកប្រែពាក្យតាមពាក្យ (Literal / robotic Google Translate)។
- ហាមដាច់ខាតកុំឱ្យមានតួអក្សរថៃ (Thai characters) ឬពាក្យថៃណាមួយ 100%!
- កុំបកស្រាយ OCR ជាសំឡេងនិយាយដោយស្វ័យប្រវត្តិនូវរាល់ Credits, Title, ឬ Watermark។
- កុំប្ដូរឈ្មោះតួអង្គ ឬសំឡេងរបស់ Speaker ដោយគ្មានភស្តុតាង។

7. CHARACTER ROLE & GENDER:
- "speaker": ឈ្មោះ ឬតួនាទីតួអង្គជាភាសាខ្មែរ (e.g. "តួឯកប្រុស", "តួឯកស្រី", "លោកប្រធាន", "អ្នកភូមិ")។
- "gender": "male" | "female" | "unknown" (សំឡេងប្រុសប្រើ Piseth, សំឡេងស្រីប្រើ Sreymom)។
${userDirection ? `User Custom Direction: ${userDirection}` : ''}

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
            if (t) {
              dialogueList[b + i].khmerTranslatedText = cleanKhmerSpokenText(t.khmerText || '');
              dialogueList[b + i].speaker = cleanKhmerSpokenText(t.speaker) || dialogueList[b + i].speaker || 'តួអង្គ';
              if (t.gender && t.gender !== 'unknown') {
                dialogueList[b + i].voiceGender = t.gender;
              }
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
  splitLongDialogueSegment,
  condenseKhmerDialogue,
  detectDramaGenre,
  getGenrePromptGuidelines,
  cleanKhmerSpokenText,
  DRAMA_GENRES,
  CULTIVATION_DRAMA_GLOSSARY,
};
