/**
 * Speaker Registry & Gender-to-Voice Auto-Detection
 * Multi-character drama dialogue voice assignments & Majority-Vote consistency
 */

const FEMALE_KEYWORDS = [
  // ភាសាខ្មែរ (ងារ, តួនាទី, សាច់ញាតិ)
  "ស្រី", "នារី", "ស្ត្រី", "កញ្ញា", "អ្នកនាង", "អ្នកនាងតូច", "អ្នកស្រី", "លោកស្រី", "ជំទាវ",
  "ម្តាយ", "ម្ដាយ", "ម៉ែ", "ម៉ាក់", "យាយ", "លោកយាយ", "មីង", "អ្នកមីង", "អ៊ំស្រី",
  "បងស្រី", "ប្អូនស្រី", "កូនស្រី", "ក្មួយស្រី", "ចៅស្រី", "ប្រពន្ធ", "ភរិយា",
  "ព្រះមហេសី", "មហេសី", "ព្រះនាង", "ម្ចាស់ក្សត្រី", "ម្ចាស់បងស្រី", "សិស្សប្អូនស្រី", "សិស្សច្បងស្រី", "ស្នំ", "អ្នកម្នាង",
  "តួស្រី", "តួឯកស្រី", "តួរងស្រី", "មិត្តស្រី", "សង្សារស្រី", "លេខាស្រី", "គិលានុបដ្ឋាយិកា",
  "អ្នកគ្រូ", "ដូនជី", "ស្រីមុំ", "នាង", "កុមារី", "មាតា", "ធីតា", "ម្ចាស់ស្រី", "ម្ចាស់អូន",
  "ខ្ញុំម្ចាស់", "នាងខ្ញុំ",
  // AI System / ប្រព័ន្ធ (Default Female / Sreymom)
  "ប្រព័ន្ធ", "ប្រព័ន្ធ ai", "ប្រព័ន្ធជំនួយ", "ប្រព័ន្ធណែនាំ", "ប្រព័ន្ធសំឡេង",
  "system", "ai system", "系统", "系统提示",
  // ភាសាចិន (Chinese Drama Cues)
  "女", "女主", "女主角", "女配", "女孩", "女人", "女生", "女士", "小姐", "姑娘",
  "夫人", "太太", "妈妈", "母亲", "娘", "妈", "奶奶", "外婆", "婆婆", "阿姨", "姑姑",
  "姐姐", "妹妹", "姐", "妹", "女儿", "妻子", "老婆", "闺蜜", "媳妇", "公主", "皇后", "皇太后", "太后",
  "王妃", "妃", "贵妃", "娘娘", "丫鬟", "婢女", "师姐", "师妹", "师太", "仙子", "仙女", "侍女", "医女",
  "臣妾", "奴婢", "本宫", "本妃",
  // ភាសាអង់គ្លេស (English Cues)
  "female", "woman", "girl", "lady", "miss", "ms", "mrs", "madam", "ma'am",
  "mother", "mom", "mum", "grandma", "grandmother", "aunt", "sister", "daughter",
  "wife", "girlfriend", "bride", "princess", "queen", "empress", "concubine",
  "maid", "actress", "heroine", "she", "her", "sreymom"
];

const MALE_KEYWORDS = [
  // ភាសាខ្មែរ (ងារ, តួនាទី, សាច់ញាតិ)
  "ប្រុស", "បុរស", "លោក", "ឧកញ៉ា", "ឯកឧត្តម", "លោកប្រធាន", "ប្រធាន", "ថៅកែ",
  "ឪពុក", "ពុក", "ប៉ា", "តា", "លោកតា", "ពូ", "លោកពូ", "អ៊ំប្រុស", "មា",
  "បងប្រុស", "ប្អូនប្រុស", "កូនប្រុស", "ក្មួយប្រុស", "ចៅប្រុស", "ប្តី", "ប្ដី", "ស្វាមី",
  "ព្រះអង្គ", "ព្រះអង្គម្ចាស់", "ព្រះរាជា", "ស្តេច", "ស្ដេច", "ព្រះបុត្រា", "រាជបុត្រ", "ម្ចាស់បង", "សិស្សច្បង", "លោកម្ចាស់",
  "ទូលបង្គំ", "យើងខ្ញុំព្រះករុណា", "ខ្ញុំបាទ",
  "មេទ័ព", "អង្គរក្ស", "កងការពារ", "តួប្រុស", "តួឯកប្រុស", "តួរងប្រុស", "មិត្តប្រុស",
  "លោកគ្រូ", "ព្រះសង្ឃ", "លោកគ្រូពេទ្យ", "អ្នកសម្រាយរឿង", "ពិសិដ្ឋ", "គាត់", "ចៅហ្វាយ", "កំលោះ",
  // ភាសាចិន (Chinese Drama Cues)
  "男", "男主", "男主角", "男配", "男孩", "男人", "男生", "先生", "公子", "少爷",
  "总裁", "老板", "董事长", "总", "爸爸", "父亲", "爹", "爸", "爷爷", "外公", "叔叔", "伯伯",
  "哥哥", "弟弟", "大哥", "哥", "弟", "儿子", "丈夫", "老公", "殿下", "太子", "皇上", "皇帝", "王爷", "陛下",
  "将军", "侍卫", "保镖", "师兄", "师弟", "师尊", "师父", "大师", "旁白", "太监", "掌柜", "刺客", "大人",
  "朕", "本王", "本尊", "本座", "微臣", "老夫",
  // ភាសាអង់គ្លេស (English Cues)
  "male", "man", "boy", "gentleman", "mr", "sir", "boss", "ceo", "president", "chairman",
  "father", "dad", "grandpa", "grandfather", "uncle", "brother", "son", "husband",
  "boyfriend", "groom", "prince", "king", "emperor", "general", "guard", "bodyguard",
  "actor", "hero", "narrator", "he", "him", "his", "piseth"
];

// Unambiguous 1st-person self-references only (NOT 2nd or 3rd person addressed titles like ព្រះអង្គ, 皇上, នាង, លោក)
const KHMER_FEMALE_PRONOUNS = ["នាងខ្ញុំ", "ខ្ញុំម្ចាស់", "臣妾", "奴婢", "本宫", "本妃"];
const KHMER_MALE_PRONOUNS = ["ខ្ញុំបាទ", "ទូលបង្គំ", "យើងខ្ញុំព្រះករុណា", "朕", "微臣", "本王", "本尊", "本座", "老夫"];

const VOICE_PROFILES = {
  female: {
    voiceId: "km-KH-SreymomNeural",
    voiceLabel: "ស្រីមុំ (Sreymom)",
    avatar: "👩",
    badgeColor: "#ec4899",
  },
  male: {
    voiceId: "km-KH-PisethNeural",
    voiceLabel: "ពិសិដ្ឋ (Piseth)",
    avatar: "👨",
    badgeColor: "#3b82f6",
  },
};

const AMBIGUOUS_SHORT_KHMER_MALE_TOKENS = new Set(["មា", "តា", "ពូ"]);

function matchesSpeakerKeyword(lowerName = "", kw = "") {
  const k = String(kw || "").toLowerCase().trim();
  if (!lowerName || !k) return false;
  if (/^[a-z0-9'.\s-]+$/i.test(k)) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, "i").test(lowerName);
  }
  if (AMBIGUOUS_SHORT_KHMER_MALE_TOKENS.has(k)) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[\\s_\\-(\u200b])${escaped}(?=$|[\\s_\\-)0-9\u200b])`, "u").test(lowerName);
  }
  return lowerName.includes(k);
}

/**
 * 1. វិភាគភេទតួអង្គ ("MALE" | "FEMALE" | "UNKNOWN")
 * Supports both `detectSpeakerGender(speakerName, explicitGender, khmerText)`
 * and `detectSpeakerGender(segment, context)`:
 * - Priority 1: Explicit `segment.visualGender` ("male" / "female") when confidence is high.
 * - Priority 2: Explicit `segment.voiceGender` / `segment.gender` / `castRegistry` gender.
 * - Priority 3: Speaker title/name keywords (`FEMALE_KEYWORDS` before `MALE_KEYWORDS`) and
 *   1st-person self-pronouns (`KHMER_FEMALE_PRONOUNS` / `KHMER_MALE_PRONOUNS`),
 *   strictly distinguishing self-pronouns from addressed pronouns.
 */
function detectSpeakerGender(speakerName = "", explicitGender = "", khmerText = "") {
  if (speakerName && typeof speakerName === "object") {
    const seg = speakerName;
    const ctx = (explicitGender && typeof explicitGender === "object") ? explicitGender : {};

    // Priority 1: Explicit segment.visualGender ("male" / "female") when confidence is high
    const visGender = String(seg.visualGender || ctx.visualGender || "").trim().toLowerCase();
    const visConf = typeof seg.genderConfidence === "number" ? seg.genderConfidence : 0.85;
    if ((visGender === "female" || visGender === "f") && visConf >= 0.6) {
      return "FEMALE";
    }
    if ((visGender === "male" || visGender === "m") && visConf >= 0.6) {
      return "MALE";
    }

    // Priority 2: Explicit voiceGender / gender from Gemini's castRegistry or segment
    const castList = Array.isArray(ctx.castRegistry)
      ? ctx.castRegistry
      : (Array.isArray(seg.castRegistry) ? seg.castRegistry : []);
    const castEntry = castList.find(
      (c) =>
        c &&
        ((seg.speakerId && c.speakerId === seg.speakerId) ||
          (seg.speaker && (c.speakerLabelKh === seg.speaker || c.speakerId === seg.speaker)))
    );
    const explicitCastGender = String(
      castEntry?.voiceGender ||
      castEntry?.gender ||
      seg.castGender ||
      seg.voiceGender ||
      seg.gender ||
      seg.speakerGender ||
      (typeof explicitGender === "string" ? explicitGender : "") ||
      ""
    ).trim().toLowerCase();

    if (explicitCastGender === "female" || explicitCastGender === "f" || explicitCastGender === "ស្រី" || explicitCastGender === "girl" || explicitCastGender === "woman") {
      return "FEMALE";
    }
    if (explicitCastGender === "male" || explicitCastGender === "m" || explicitCastGender === "ប្រុស" || explicitCastGender === "boy" || explicitCastGender === "man") {
      return "MALE";
    }

    // Priority 3: Speaker title/name keywords & 1st-person self-pronouns
    const segSpeaker = String(seg.speaker || seg.speakerName || "").trim();
    const segDialogue = [
      seg.khmerText,
      seg.khmer,
      seg.khmerTranslatedText,
      seg.originalChineseText,
      seg.chineseText,
      seg.originalText,
      khmerText,
    ]
      .filter(Boolean)
      .join(" ");
    return detectSpeakerGender(segSpeaker, "", segDialogue);
  }

  const cleanExplicit = String(explicitGender || "").trim().toLowerCase();
  if (cleanExplicit === "female" || cleanExplicit === "f" || cleanExplicit === "ស្រី" || cleanExplicit === "girl" || cleanExplicit === "woman") {
    return "FEMALE";
  }
  if (cleanExplicit === "male" || cleanExplicit === "m" || cleanExplicit === "ប្រុស" || cleanExplicit === "boy" || cleanExplicit === "man") {
    return "MALE";
  }

  const cleanName = String(speakerName || "").toLowerCase().trim();
  if (cleanName) {
    // 1. ពិនិត្យពាក្យគន្លឹះភេទស្រីមុនគេ (ការពារពាក្យ "លោកស្រី" ឬ "ម្ចាស់បងស្រី" កុំឱ្យច្រឡំជាមួយ "លោក" ឬ "ម្ចាស់បង")
    for (const kw of FEMALE_KEYWORDS) {
      if (matchesSpeakerKeyword(cleanName, kw)) {
        return "FEMALE";
      }
    }

    // 2. ពិនិត្យពាក្យគន្លឹះភេទប្រុស
    for (const kw of MALE_KEYWORDS) {
      if (matchesSpeakerKeyword(cleanName, kw)) {
        return "MALE";
      }
    }
  }

  // 3. វិភាគសព្វនាមបញ្ជាក់ខ្លួនឯងច្បាស់លាស់ក្នុងប្រយោគសន្ទនាខ្មែរ និងចិន (1st-person self-pronouns only)
  const cleanDialogue = String(khmerText || "").trim();
  if (cleanDialogue) {
    for (const pronoun of KHMER_FEMALE_PRONOUNS) {
      if (cleanDialogue.includes(pronoun)) {
        return "FEMALE";
      }
    }
    for (const pronoun of KHMER_MALE_PRONOUNS) {
      if (cleanDialogue.includes(pronoun)) {
        return "MALE";
      }
    }

    // Lookaround ensures ចាស/ច៎ាស is not part of ម្ចាស់ (master) or ចាស់ (old)
    const hasFemaleAffirmative = /(?<!្)ច[៎]?ាស(?!់)/u.test(cleanDialogue);
    const hasMaleAffirmative = /(?<!្)បាទ/u.test(cleanDialogue);

    if (hasFemaleAffirmative && !hasMaleAffirmative) return "FEMALE";
    if (hasMaleAffirmative && !hasFemaleAffirmative) return "MALE";
  }

  return "UNKNOWN";
}

/**
 * 2. បំប្លែងឈ្មោះតួអង្គចិន/អង់គ្លេស ទៅជាឈ្មោះខ្មែរស្តង់ដារសម្រាប់បង្ហាញលើ UI
 */
function normalizeSpeakerName(rawSpeaker = "", gender = "male") {
  let trimmed = String(rawSpeaker || "").trim();
  if (!trimmed) {
    return (gender === "female" || gender === "FEMALE") ? "តួស្រី" : "តួប្រុស";
  }

  // Purge any Thai text / Thai narrator loanwords (e.g. ผู้บรรยาย / บรรยาย)
  trimmed = trimmed.replace(/អ្នក?ผู้?บรรยาย/g, 'អ្នករៀបរាប់');
  trimmed = trimmed.replace(/บรรยาย/g, 'រៀបរាប់');
  trimmed = trimmed.replace(/[\u0E00-\u0E7F]+/g, '').replace(/[\u0E80-\u0EFF]+/g, '').trim();
  if (!trimmed || trimmed === 'អ្នក' || trimmed === 'តួ') {
    trimmed = 'អ្នករៀបរាប់';
  }

  const mapDict = {
    narrator: "អ្នករៀបរាប់",
    "旁白": "អ្នករៀបរាប់",
    "អ្នកសម្រាយរឿង": "អ្នករៀបរាប់",
    "អ្នករៀបរាប់": "អ្នករៀបរាប់",
    "女主": "តួឯកស្រី",
    "女主角": "តួឯកស្រី",
    "男主": "តួឯកប្រុស",
    "男主角": "តួឯកប្រុស",
    "总裁": "លោកប្រធាន",
    "夫人": "លោកស្រី",
    "小姐": "កញ្ញា",
  };

  return mapDict[trimmed.toLowerCase()] || mapDict[trimmed] || trimmed;
}

/**
 * 3. ទាញយក Voice Profile តាមភេទ ឬ Voice ID
 */
function getVoiceProfile(gender = "male", overrideVoiceId = null) {
  if (overrideVoiceId) {
    if (String(overrideVoiceId).includes("Sreymom") || overrideVoiceId === "google-km-standard") {
      return { ...VOICE_PROFILES.female, voiceId: overrideVoiceId };
    }
    if (String(overrideVoiceId).includes("Piseth")) {
      return { ...VOICE_PROFILES.male, voiceId: overrideVoiceId };
    }
  }
  const isFemale = String(gender).toLowerCase() === "female";
  return isFemale ? VOICE_PROFILES.female : VOICE_PROFILES.male;
}

/**
 * 4. Sync Segments ជាមួយ Speaker Registry ដោយប្រើ Majority Vote & Acoustic Evidence
 * Enforces strict consistency: every segment from the same character receives the SAME voice throughout the episode.
 * Preserves manual user voice overrides permanently.
 */
function syncSegmentsWithSpeakerRegistry(segments = [], customSpeakerVoiceMap = {}, seriesSpeakerMap = {}) {
  let customMap = customSpeakerVoiceMap;
  let seriesMap = seriesSpeakerMap;

  // Support passing options object as 2nd argument: syncSegmentsWithSpeakerRegistry(segments, { seriesSpeakerMap, customSpeakerVoiceMap })
  if (customSpeakerVoiceMap && typeof customSpeakerVoiceMap === "object") {
    if (customSpeakerVoiceMap.seriesSpeakerMap || customSpeakerVoiceMap.customSpeakerVoiceMap) {
      seriesMap = customSpeakerVoiceMap.seriesSpeakerMap || {};
      customMap = customSpeakerVoiceMap.customSpeakerVoiceMap || {};
    }
  }

  const speakerStatsMap = new Map();

  segments.forEach((seg) => {
    const rawSpeaker = String(seg.speaker || seg.speakerName || "តួអង្គ").trim();
    const explicitId = seg.speakerId || seg.spkId || null;
    const spkKey = explicitId ? String(explicitId).trim() : getSpeakerId(rawSpeaker);
    const isSegUserOverridden = Boolean(seg.userOverridden);
    const pureNameGender = detectSpeakerGender(rawSpeaker, "", "");
    const tentativeGender = detectSpeakerGender(rawSpeaker, "", seg.khmerText || seg.khmer || seg.originalText);
    const displayGender = tentativeGender !== "UNKNOWN"
      ? tentativeGender
      : detectSpeakerGender(rawSpeaker, seg.voiceGender || seg.gender || seg.speakerGender, "");
    const speakerName = normalizeSpeakerName(rawSpeaker, displayGender);

    if (!speakerStatsMap.has(spkKey)) {
      // Check existing manual assignment or series-level persistence (never inherit character-wide manual override from a single userOverridden segment, and never auto-map generic 'តួអង្គ' from seriesMap)
      const isGenericName = !speakerName || speakerName === "តួអង្គ" || speakerName.toLowerCase() === "speaker";
      const seriesEntry = seriesMap[spkKey] || (!isGenericName ? (seriesMap[speakerName] || seriesMap[rawSpeaker]) : null);
      const isSeriesSource = Boolean(seriesEntry && (seriesEntry.khmerVoiceId || seriesEntry.voiceId));
      const customVoice =
        customMap[spkKey] ||
        (!isGenericName ? customMap[speakerName] : null) ||
        (isSeriesSource ? (seriesEntry.khmerVoiceId || seriesEntry.voiceId) : null) ||
        (!isSegUserOverridden && seg.voiceAssignmentSource === "manual" ? (seg.khmerVoiceId || seg.voiceId || seg.voice) : null) ||
        (!isSegUserOverridden && seg.voiceOverride ? seg.voiceOverride : null);

      const isManual = Boolean((!isSegUserOverridden && (seg.voiceAssignmentSource === "manual" || seg.voiceOverride)) || customMap[spkKey] || (!isGenericName && customMap[speakerName]));
      const assignmentSource = isManual ? "manual" : (isSeriesSource ? (seriesEntry.voiceAssignmentSource || "series_glossary") : "automatic");

      speakerStatsMap.set(spkKey, {
        id: spkKey,
        speakerId: spkKey,
        name: speakerName,
        rawName: rawSpeaker,
        maleScore: 0,
        femaleScore: 0,
        unknownCount: 0,
        acousticObservations: 0,
        lineCount: 0,
        customVoice: customVoice || null,
        isManual,
        assignmentSource,
      });
    }

    const entry = speakerStatsMap.get(spkKey);
    entry.lineCount += 1;

    // Do NOT let a per-segment userOverridden segment hijack or skew character-wide voice/gender votes
    if (isSegUserOverridden) {
      return;
    }

    // Check manual override on individual segment
    if ((seg.voiceAssignmentSource === "manual" || seg.voiceOverride) && !entry.customVoice) {
      entry.customVoice = seg.voiceOverride || seg.khmerVoiceId || seg.voiceId || seg.voice;
      entry.isManual = true;
    }

    // 0. SpeakerId Gender Tag Evidence (moderate weight: 1.5 so stale IDs cannot outrank explicit role names or majority)
    if (/(?:^|_)female(?:_|$)/i.test(spkKey)) {
      entry.femaleScore += 1.5;
    } else if (/(?:^|_)male(?:_|$)/i.test(spkKey)) {
      entry.maleScore += 1.5;
    }

    // 1. Acoustic Evidence (High weight: 2.5)
    if (seg.acousticGender === "female" && (seg.acousticConfidence || 0) >= 0.55) {
      entry.femaleScore += 2.5 * (seg.acousticConfidence || 0.8);
      entry.acousticObservations += 1;
    } else if (seg.acousticGender === "male" && (seg.acousticConfidence || 0) >= 0.55) {
      entry.maleScore += 2.5 * (seg.acousticConfidence || 0.8);
      entry.acousticObservations += 1;
    }

    // 1.5. Multimodal Visual Face/Costume Evidence (Weight: 2.2)
    const rawVisualGender = String(seg.visualGender || "").toLowerCase();
    if (rawVisualGender === "female") {
      entry.femaleScore += 2.2;
    } else if (rawVisualGender === "male") {
      entry.maleScore += 2.2;
    }

    // 2. Keyword & Pronoun Evidence (Computed purely from name/pronouns, never stale voiceGender)
    if (pureNameGender === "FEMALE") {
      entry.femaleScore += 4.0;
    } else if (pureNameGender === "MALE") {
      entry.maleScore += 4.0;
    } else if (tentativeGender === "FEMALE") {
      entry.femaleScore += 2.0;
    } else if (tentativeGender === "MALE") {
      entry.maleScore += 2.0;
    }

    // 3. Diarization / Metadata tag evidence (Weight: 1.0)
    const rawGender = String(seg.voiceGender || seg.gender || seg.speakerGender || "").toLowerCase();
    if (rawGender === "female" || rawGender === "f") {
      entry.femaleScore += 1.0;
    } else if (rawGender === "male" || rawGender === "m") {
      entry.maleScore += 1.0;
    } else {
      entry.unknownCount += 1;
    }
  });

  // Unify non-manual votes across split speakerIds sharing the same non-generic named character
  const namedScoreTotals = new Map();
  for (const [, stats] of speakerStatsMap.entries()) {
    const isGeneric = !stats.name || stats.name === "តួអង្គ" || stats.name.toLowerCase() === "speaker";
    if (isGeneric || stats.isManual || stats.assignmentSource === "series_glossary") continue;
    if (!namedScoreTotals.has(stats.name)) {
      namedScoreTotals.set(stats.name, { femaleScore: 0, maleScore: 0 });
    }
    const agg = namedScoreTotals.get(stats.name);
    agg.femaleScore += stats.femaleScore;
    agg.maleScore += stats.maleScore;
  }

  const finalizedRegistry = {};
  const speakersList = [];

  for (const [spkKey, stats] of speakerStatsMap.entries()) {
    let resolvedGender = "unknown";
    let genderConfidence = 0.5;

    const isGeneric = !stats.name || stats.name === "តួអង្គ" || stats.name.toLowerCase() === "speaker";
    const unified = (!isGeneric && !stats.isManual && stats.assignmentSource !== "series_glossary")
      ? namedScoreTotals.get(stats.name)
      : null;
    const fScore = unified ? unified.femaleScore : stats.femaleScore;
    const mScore = unified ? unified.maleScore : stats.maleScore;

    if (fScore > mScore && fScore >= 1.5) {
      resolvedGender = "female";
      const total = fScore + mScore;
      genderConfidence = parseFloat((fScore / total).toFixed(2));
    } else if (mScore > fScore && mScore >= 1.5) {
      resolvedGender = "male";
      const total = fScore + mScore;
      genderConfidence = parseFloat((mScore / total).toFixed(2));
    } else {
      // Ambiguous or low evidence: check explicit character keywords or mark unknown
      const kw = detectSpeakerGender(stats.name);
      if (kw === "FEMALE") {
        resolvedGender = "female";
        genderConfidence = 0.75;
      } else if (kw === "MALE") {
        resolvedGender = "male";
        genderConfidence = 0.75;
      } else {
        resolvedGender = "unknown";
        genderConfidence = null;
      }
    }

    // Map to supported Khmer TTS voice: male -> Piseth, female -> Sreymom, unknown -> Piseth (project default)
    const effectiveGender = resolvedGender === "female" ? "female" : "male";
    const profile = getVoiceProfile(effectiveGender, stats.customVoice);
    const assignedVoice = profile.voiceId;
    const isManual = stats.isManual || (Boolean(stats.customVoice) && stats.assignmentSource === "manual");
    const finalSource = stats.assignmentSource || (isManual ? "manual" : "automatic");

    const speakerRecord = {
      id: spkKey,
      speakerId: spkKey,
      name: stats.name,
      speaker: stats.name,
      voiceGender: resolvedGender,
      gender: effectiveGender,
      speakerGender: assignedVoice.includes("Sreymom") ? "FEMALE" : "MALE",
      genderConfidence,
      khmerVoiceId: assignedVoice,
      voiceId: assignedVoice,
      voice: assignedVoice,
      voiceAssignmentSource: finalSource,
      voiceLabel: profile.voiceLabel,
      avatar: profile.avatar,
      badgeColor: profile.badgeColor,
      lineCount: stats.lineCount,
    };

    finalizedRegistry[spkKey] = speakerRecord;
    if (!isGeneric) {
      const existingNamed = finalizedRegistry[stats.name];
      if (
        !existingNamed ||
        (isManual && existingNamed.voiceAssignmentSource !== "manual") ||
        (stats.lineCount > existingNamed.lineCount && existingNamed.voiceAssignmentSource !== "manual")
      ) {
        finalizedRegistry[stats.name] = speakerRecord;
      }
    }
    speakersList.push(speakerRecord);
  }

  // Enrich segments with strictly consistent character voice assignments
  const enrichedSegments = segments.map((seg, idx) => {
    const rawSpeaker = String(seg.speaker || seg.speakerName || "តួអង្គ").trim();
    const explicitId = seg.speakerId || seg.spkId || null;
    const spkKey = explicitId ? String(explicitId).trim() : getSpeakerId(rawSpeaker);
    const normSpeaker = normalizeSpeakerName(rawSpeaker);
    const isGenericRaw = !normSpeaker || normSpeaker === "តួអង្គ" || normSpeaker.toLowerCase() === "speaker";
    const titleKw = detectSpeakerGender(rawSpeaker, "", "");
    const fallbackIsFemale = titleKw === "FEMALE" || (titleKw !== "MALE" && (seg.voiceGender === "female" || /(?:^|_)female(?:_|$)/i.test(spkKey) || (typeof seg.pitchHz === "number" && seg.pitchHz >= 170)));
    const fallbackGender = fallbackIsFemale ? "female" : "male";
    const fallbackVoice = fallbackIsFemale ? "km-KH-SreymomNeural" : "km-KH-PisethNeural";
    const reg = finalizedRegistry[spkKey] ||
      (!isGenericRaw ? finalizedRegistry[normSpeaker] : null) ||
      Object.values(finalizedRegistry).find((r) => r && (
        (r.speakerId && (r.speakerId === spkKey || r.speakerId === explicitId)) ||
        (!isGenericRaw && (r.speaker === rawSpeaker || r.name === rawSpeaker || r.speakerName === rawSpeaker))
      )) || {
      speakerId: spkKey,
      speaker: rawSpeaker,
      voiceGender: fallbackIsFemale ? "female" : "unknown",
      gender: fallbackGender,
      speakerGender: fallbackIsFemale ? "FEMALE" : "MALE",
      genderConfidence: 0.5,
      khmerVoiceId: fallbackVoice,
      voiceId: fallbackVoice,
      voice: fallbackVoice,
      voiceAssignmentSource: "automatic",
      voiceLabel: fallbackIsFemale ? "ស្រីមុំ (Sreymom)" : "ពិសិដ្ឋ (Piseth)",
      avatar: fallbackIsFemale ? "👩" : "👨",
      badgeColor: fallbackIsFemale ? "#ec4899" : "#3b82f6",
    };

    const isRegManual = Boolean(reg.userOverridden) || reg.voiceAssignmentSource === "manual";
    const isUserOverridden = Boolean(seg.userOverridden);
    const isManualOverride = isUserOverridden || isRegManual || seg.voiceAssignmentSource === "manual" || Boolean(seg.voiceOverride);
    const activeVoice = (isRegManual && (reg.khmerVoiceId || reg.voiceId))
      ? (reg.khmerVoiceId || reg.voiceId)
      : (isManualOverride
          ? (isUserOverridden
              ? (seg.voiceOverride || seg.voiceId || seg.khmerVoiceId || seg.voice || reg.khmerVoiceId)
              : (seg.voiceOverride || seg.khmerVoiceId || seg.voiceId || seg.voice || reg.khmerVoiceId))
          : reg.khmerVoiceId);
    const isFemale = String(activeVoice).includes("Sreymom");
    const activeGender = isRegManual
      ? (isFemale ? "female" : "male")
      : ((isUserOverridden && (seg.voiceGender === "female" || seg.voiceGender === "male"))
          ? seg.voiceGender
          : (isFemale ? "female" : "male"));
    const activeProfile = getVoiceProfile(activeGender, activeVoice);
    const isNarrator = rawSpeaker.toLowerCase().includes("narrator") || rawSpeaker.includes("អ្នកសម្រាយរឿង") || rawSpeaker.includes("旁白");
    const safeSpkKey = isNarrator ? "spk_narrator" : spkKey;

    const segId = seg.segmentId || seg.id || idx + 1;
    const origChinese = (seg.originalChineseText || seg.original || seg.originalText || seg.chineseText || "").trim();
    const khmerTrans = (seg.khmerTranslatedText || seg.khmer || seg.khmerText || "").trim();

    return {
      ...seg,
      id: segId,
      segmentId: segId,
      originalChineseText: origChinese,
      chineseText: origChinese,
      originalText: origChinese,
      original: origChinese,
      khmerTranslatedText: khmerTrans,
      khmerText: khmerTrans,
      khmer: khmerTrans,
      speakerId: isUserOverridden && seg.speakerId ? seg.speakerId : (reg.speakerId || safeSpkKey),
      speaker: isUserOverridden ? (seg.speaker || reg.speaker) : reg.speaker,
      speakerName: isUserOverridden ? (seg.speakerName || seg.speaker || reg.speaker) : reg.speaker,
      voiceGender: isRegManual
        ? (isFemale ? "female" : "male")
        : (isUserOverridden
            ? (seg.voiceGender || (isFemale ? "female" : "male"))
            : (isManualOverride ? (isFemale ? "female" : "male") : reg.voiceGender)),
      gender: activeGender,
      speakerGender: isFemale ? "FEMALE" : (activeGender === "female" ? "FEMALE" : (reg.voiceGender === "unknown" && !isManualOverride ? "UNKNOWN" : "MALE")),
      genderConfidence: isUserOverridden ? (seg.genderConfidence ?? null) : reg.genderConfidence,
      khmerVoiceId: activeProfile.voiceId,
      voice: activeProfile.voiceId,
      voiceId: activeProfile.voiceId,
      voiceAssignmentSource: isManualOverride ? (seg.voiceAssignmentSource || "manual") : reg.voiceAssignmentSource,
      voiceLabel: activeProfile.voiceLabel,
      avatar: activeProfile.avatar,
      badgeColor: activeProfile.badgeColor,
      translationStatus: seg.translationStatus || (khmerTrans ? "translated" : (origChinese ? "review_needed" : "pending")),
      ttsStatus: seg.ttsStatus || (seg.audioFile ? "ready" : "pending"),
    };
  });

  return {
    segments: enrichedSegments,
    speakers: speakersList,
    speakerMap: finalizedRegistry,
    speakerRegistry: finalizedRegistry,
    registry: finalizedRegistry,
  };
}

/**
 * 5. មុខងារប្តូរសំឡេង 1-Click សម្រាប់ឃ្លាណាមួយ ឬប្តូរសំឡេងតួអង្គទាំងមូល
 */
function switchSpeakerOrSegmentVoice(
  segments = [],
  { segmentId = null, speakerName = null, speakerId = null, targetVoiceOrGender = "female" }
) {
  const isFemale =
    targetVoiceOrGender === "female" ||
    targetVoiceOrGender === "FEMALE" ||
    String(targetVoiceOrGender).includes("Sreymom");

  const profile = isFemale ? VOICE_PROFILES.female : VOICE_PROFILES.male;

  const updatedSegments = segments.map((seg) => {
    const matchById = segmentId !== null && String(seg.id) === String(segmentId);
    const matchBySpkId = speakerId !== null && (seg.speakerId === speakerId || String(seg.speakerId) === String(speakerId));
    const matchBySpeaker = speakerName !== null && (seg.speaker === speakerName || seg.speakerName === speakerName);

    if (matchById || matchBySpkId || matchBySpeaker) {
      return {
        ...seg,
        gender: isFemale ? "female" : "male",
        voiceGender: isFemale ? "female" : "male",
        speakerGender: isFemale ? "FEMALE" : "MALE",
        genderConfidence: 1.0,
        khmerVoiceId: profile.voiceId,
        voice: profile.voiceId,
        voiceId: profile.voiceId,
        voiceLabel: profile.voiceLabel,
        avatar: profile.avatar,
        badgeColor: profile.badgeColor,
        voiceOverride: profile.voiceId,
        voiceAssignmentSource: "manual",
      };
    }
    return seg;
  });

  const customMap = {};
  if (speakerId) customMap[speakerId] = profile.voiceId;
  if (speakerName) customMap[speakerName] = profile.voiceId;

  return syncSegmentsWithSpeakerRegistry(updatedSegments, customMap);
}

/**
 * Backward compatibility helpers
 */
function getSpeakerId(speakerName = "") {
  const clean = String(speakerName || "Speaker").trim();
  if (clean === "អ្នកសម្រាយរឿង" || clean.toLowerCase() === "narrator" || clean === "旁白") {
    return "spk_narrator";
  }
  const safe = clean
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return safe ? `spk_${safe}` : "spk_default";
}

function getDefaultVoiceForGender(gender) {
  const norm = String(gender || "").toUpperCase();
  if (norm === "FEMALE" || norm === "GIRL" || norm === "WOMAN") {
    return "km-KH-SreymomNeural";
  }
  return "km-KH-PisethNeural";
}

function buildSpeakerRegistry(segments = [], existingRegistry = {}) {
  const syncRes = syncSegmentsWithSpeakerRegistry(segments, {}, existingRegistry);
  const out = { ...existingRegistry };
  syncRes.speakers.forEach((spk) => {
    const id = spk.speakerId || getSpeakerId(spk.speaker);
    out[id] = {
      id,
      speakerId: id,
      name: spk.speaker,
      speaker: spk.speaker,
      voiceGender: spk.voiceGender || (spk.gender === "female" ? "female" : "male"),
      gender: spk.speakerGender || (spk.gender === "female" ? "FEMALE" : "MALE"),
      genderConfidence: spk.genderConfidence || 0.8,
      khmerVoiceId: spk.khmerVoiceId || spk.voiceId,
      voiceId: spk.voiceId,
      voiceAssignmentSource: spk.voiceAssignmentSource || "automatic",
      speed: "normal",
      segmentCount: spk.lineCount,
      count: spk.lineCount,
    };
  });
  return out;
}

function applySpeakerVoiceToSegments(segments = [], speakerRegistry = {}) {
  const customVoiceMap = {};
  if (speakerRegistry && typeof speakerRegistry === "object") {
    Object.values(speakerRegistry).forEach((entry) => {
      if (entry && (entry.id || entry.speakerId || entry.name) && (entry.khmerVoiceId || entry.voiceId)) {
        const v = entry.khmerVoiceId || entry.voiceId;
        if (entry.id) customVoiceMap[entry.id] = v;
        if (entry.speakerId) customVoiceMap[entry.speakerId] = v;
        if (entry.name) customVoiceMap[entry.name] = v;
      }
    });
  }
  return syncSegmentsWithSpeakerRegistry(segments, customVoiceMap, speakerRegistry).segments;
}

const DEFAULT_VOICES = {
  male: {
    id: "km-KH-PisethNeural",
    name: "Piseth Neural",
    gender: "MALE",
  },
  female: {
    id: "km-KH-SreymomNeural",
    name: "Sreymom Neural",
    gender: "FEMALE",
  },
};

function detectGenderFromAcousticPitch(f0, confidence = 0.9) {
  if (typeof f0 !== "number" || f0 <= 0 || isNaN(f0)) {
    return { gender: "unknown", confidence: null };
  }
  if (confidence < 0.50) {
    return { gender: "unknown", confidence: null };
  }
  if (f0 >= 170) {
    return { gender: "female", confidence: parseFloat(confidence.toFixed(2)) };
  } else if (f0 <= 155) {
    return { gender: "male", confidence: parseFloat(confidence.toFixed(2)) };
  } else {
    return { gender: "unknown", confidence: null };
  }
}

module.exports = {
  FEMALE_KEYWORDS,
  MALE_KEYWORDS,
  KHMER_FEMALE_PRONOUNS,
  KHMER_MALE_PRONOUNS,
  FEMALE_MARKERS: FEMALE_KEYWORDS,
  MALE_MARKERS: MALE_KEYWORDS,
  VOICE_PROFILES,
  DEFAULT_VOICES,
  detectSpeakerGender,
  detectGenderFromAcousticPitch,
  normalizeSpeakerName,
  getVoiceProfile,
  syncSegmentsWithSpeakerRegistry,
  switchSpeakerOrSegmentVoice,
  getSpeakerId,
  getDefaultVoiceForGender,
  buildSpeakerRegistry,
  applySpeakerVoiceToSegments,
};
