const dns = require("dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

const { GoogleGenAI, Type } = require("@google/genai");
const fs = require("fs");
const path = require("path");

function sanitizeSubtitleDuration(seg, minDurationSec = 1.5) {
  if (!seg || typeof seg !== "object") return seg;
  const startSec = typeof seg.startSec === "number" && !isNaN(seg.startSec)
    ? seg.startSec
    : parseTimeToSec(seg.startTime || seg.start, 0);
  let endSec = typeof seg.endSec === "number" && !isNaN(seg.endSec)
    ? seg.endSec
    : parseTimeToSec(seg.endTime || seg.end, startSec + minDurationSec);
  const rawDuration = endSec - startSec;
  const isMicroDuration = rawDuration < 0.6;
  if (isNaN(endSec) || endSec <= startSec || isMicroDuration) {
    const textLen = (seg.khmerTranslatedText || seg.khmerText || seg.khmer || seg.originalChineseText || "").length || 8;
    const safeDuration = Math.max(minDurationSec, Math.min(7.0, parseFloat((textLen * 0.16).toFixed(2))));
    endSec = parseFloat((startSec + safeDuration).toFixed(2));
  }
  const duration = parseFloat((endSec - startSec).toFixed(2));
  return {
    ...seg,
    startSec: parseFloat(startSec.toFixed(2)),
    endSec: parseFloat(endSec.toFixed(2)),
    duration,
    startTime: formatSecondsToTimecode(startSec),
    endTime: formatSecondsToTimecode(endSec),
    start: formatSecondsToTimecode(startSec),
    end: formatSecondsToTimecode(endSec),
  };
}
const {
  syncSegmentsWithSpeakerRegistry,
  detectSpeakerGender,
  buildSpeakerRegistry,
  getDefaultVoiceForGender,
  getSpeakerId,
} = require("../models/speakerRegistry");
const { parseTimeToSec, formatTime } = require("../models/timestampUtils");
const { createSegment, normalizeSegmentList } = require("../models/segmentModel");

const KHMER_DUBBING_BASE_SYSTEM_PROMPT = `
អ្នកគឺជាអ្នកដឹកនាំការបញ្ចូលសំឡេងកុន អ្នកជំនាញបកប្រែភាសាចិន-ខ្មែរ អ្នកវិភាគវីដេអូ និងជាអ្នកសម្រាយរឿងកុនខ្មែរអាជីព។
ភារកិច្ចរបស់អ្នកគឺវិភាគវីដេអូ សំឡេង និងអក្សរក្នុងវីដេអូដែលបានផ្តល់ឱ្យ រួចបង្កើតជាអត្ថបទសន្ទនា ឬអត្ថបទសម្រាយសាច់រឿងជាភាសាខ្មែរឱ្យបានត្រឹមត្រូវ ធម្មជាតិ និងរស់រវើកតាមទម្រង់ JSON ដែលបានកំណត់។
`;

/**
 * បញ្ជីម៉ូដែលផ្លូវការរបស់ Google AI Studio (ដាក់ gemini-3.5-flash-lite និង gemini-3.1-flash-lite ជាអាទិភាពទី ១ លឿន Quota ធំ និងស្ថិរភាពខ្ពស់)
 */
const DEFAULT_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-flash-latest",
];

/**
 * ត្រួតពិនិត្យ និងជ្រើសរើសម៉ូដែលដែលមានសុពលភាព
 */
function resolveValidModelName(requestedModel = "") {
  const clean = String(requestedModel || "").trim();
  if (DEFAULT_MODELS.includes(clean)) {
    return clean;
  }
  return DEFAULT_MODELS[0];
}

function getGeminiClient(customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("មិនរកឃើញ GEMINI_API_KEY ទេ! សូមបញ្ចូលក្នុង .env ឬក្នុង Settings នៃកម្មវិធី។");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: 300000 },
  });
}

function parseTimeToSeconds(timeStr) {
  if (typeof timeStr === "number") return timeStr;
  if (!timeStr) return 0;

  const cleanStr = String(timeStr).trim();
  const parts = cleanStr.split(":").map(Number);

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parseFloat(cleanStr) || 0;
}

function formatSecondsToTimecode(seconds) {
  const safeSec = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safeSec / 60);
  const secs = (safeSec % 60).toFixed(2);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(5, "0")}`;
}

const SCRIPT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mode: {
      type: Type.STRING,
      description: "Mode ដែលបានប្រើ: dialogue ឬ recap ឬ subtitles",
    },
    summary: {
      type: Type.STRING,
      description: "សេចក្តីសង្ខេបខ្លឹមសាររឿងជាភាសាខ្មែរ (1-2 ប្រយោគ)",
    },
    segments: {
      type: Type.ARRAY,
      description: "បញ្ជីឃ្លាសន្ទនា ឬឃ្លាសម្រាយរឿងតាមលំដាប់ Timestamp ពីដើមដល់ចប់វីដេអូ",
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.INTEGER,
            description: "លេខរៀងឃ្លា ចាប់ពី 1, 2, 3...",
          },
          startTime: {
            type: Type.STRING,
            description: "ម៉ោងចាប់ផ្តើម ទម្រង់ MM:SS.ms (ឧ. 00:01.50)",
          },
          endTime: {
            type: Type.STRING,
            description: "ម៉ោងបញ្ចប់ ទម្រង់ MM:SS.ms (ឧ. 00:05.20)",
          },
          speakerId: {
            type: Type.STRING,
            description: "ID សម្គាល់តួអង្គថេរ (ឧ. spk_male_lead, spk_female_lead, spk_boss, spk_narrator)",
          },
          speaker: {
            type: Type.STRING,
            description: "ឈ្មោះតួអង្គជាភាសាខ្មែរ (ឧ. លោកប្រធាន, តួឯកស្រី, អ្នកសម្រាយរឿង)",
          },
          voiceGender: {
            type: Type.STRING,
            enum: ["male", "female", "unknown"],
            description: "ភេទនៃសំឡេងពិតរបស់តួអង្គក្នុងវីដេអូ (male: សំឡេងប្រុស, female: សំឡេងស្រី, unknown: មិនច្បាស់)",
          },
          genderConfidence: {
            type: Type.NUMBER,
            description: "កម្រិតជឿជាក់លើភេទសំឡេងពី 0.0 ដល់ 1.0",
          },
          gender: {
            type: Type.STRING,
            enum: ["male", "female", "unknown"],
            description: "ភេទរបស់អ្នកនិយាយ (male/female/unknown)",
          },
          deliveryType: {
            type: Type.STRING,
            enum: ["out_loud", "inner_thought", "narration", "unknown"],
            description: "ប្រភេទនៃការនិយាយ៖ out_loud (និយាយចេញក្រៅធម្មតា), inner_thought (និយាយក្នុងចិត្ត/internal monologue), narration (អ្នកសម្រាយ), unknown (មិនទាន់ច្បាស់)",
          },
          deliveryConfidence: {
            type: Type.NUMBER,
            description: "កម្រិតជឿជាក់លើ deliveryType ពី 0.0 ដល់ 1.0",
          },
          deliveryReviewNeeded: {
            type: Type.BOOLEAN,
            description: "ពិត (true) បើភស្តុតាង delivery មិនច្បាស់លាស់ ត្រូវការត្រួតពិនិត្យ",
          },
          originalText: {
            type: Type.STRING,
            description: "អត្ថបទសន្ទនាដើម ឬការពិពណ៌នាឈុតឆាកសង្ខេប",
          },
          khmerText: {
            type: Type.STRING,
            description: "អត្ថបទនិយាយភាសាខ្មែរបែបកុនភាគ ឬសម្រាយរឿងធម្មជាតិ ពិរោះ និងត្រូវនឹងរយៈពេលឈុត",
          },
        },
        required: [
          "id",
          "startTime",
          "endTime",
          "speaker",
          "gender",
          "originalText",
          "khmerText",
        ],
      },
    },
  },
  required: ["mode", "summary", "segments"],
};

function buildDialoguePrompt(userDirection = "", durationSec = 0, options = {}) {
  const cleanDirection = String(userDirection || "").trim();
  const genre = options?.genre || "auto";
  const durationInstruction =
    durationSec > 0
      ? `\nការគ្របដណ្តប់រយៈពេលវីដេអូទាំងមូល៖ វីដេអូនេះមានប្រវែង ${formatSecondsToTimecode(durationSec)} (${Math.round(durationSec)} វិនាទី)។ សូមវិភាគ និងបកប្រែការសន្ទនាឱ្យគ្រប់ឈុតឆាកតាំងពី 00:00.00 រហូតដល់ ${formatSecondsToTimecode(durationSec)} ដោយហាមឈប់ពាក់កណ្តាលទី។`
      : "";

  let genreSpecificRule = "";
  if (genre === "ancient") {
    genreSpecificRule = `
   - រឿងបុរាណចិន/គុណនិយម/Xianxia: ប្រើពាក្យសព្វនាម និងឋានៈសមស្រប (ខ្ញុំ, ឯង, លោកម្ចាស់, អ្នកនាង, ព្រឹទ្ធាចារ្យ)។
   - វចនានុក្រមគុណនិយម៖ 淬体 ➜ "កម្រិតសម្អាតកាយ", 聚灵 ➜ "ដែនប្រមូលវិញ្ញាណ", 本命武器 ➜ "អាវុធកំណើតប្រាណ", 柳村 ➜ "ភូមិលីវ", 柳树/柳灵 ➜ "ដើមលីវ/ព្រលឹងដើមលីវ" (ហាមបកថាដើមទំពាំងបាយជូរ!), 骷髅怪物/邪物 ➜ "បិសាចឆ្អឹង/ពពួកបិសាច"។`;
  } else if (genre === "modern") {
    genreSpecificRule = `
   - រឿងសម័យទំនើប/CEO/Romance: ប្រើភាសាសន្ទនាធម្មជាតិ (បង, អូន, លោកប្រធាន, អ្នកស្រី, នាយក) តាមទំនាក់ទំនងតួអង្គ។ ហាមដាច់ខាតយកពាក្យគុណនិយម (លោកម្ចាស់, ព្រឹទ្ធាចារ្យ, សម្អាតកាយ...) មកប្រើក្នុងរឿងសម័យទំនើប!`;
  } else if (genre === "action") {
    genreSpecificRule = `
   - រឿង Action/សងសឹក: ភាសាមុតមាំ ខ្លី ចំៗ មានកំហឹង និងចង្វាក់សន្ទនារហ័សសមនឹងឈុតឆាក។`;
  } else if (genre === "comedy") {
    genreSpecificRule = `
   - រឿងកំប្លែង/គ្រួសារ: ភាសាសន្ទនាកំប្លុកកំប្លែង ធម្មជាតិ រស់រវើក។`;
  } else {
    genreSpecificRule = `
   - ស្គាល់ប្រភេទរឿងតាមបរិបទជាក់ស្ដែង៖ កុំសន្មតថាគ្រប់រឿងសុទ្ធតែជារឿងគុណនិយម។ បើជារឿងសម័យ ត្រូវប្រើភាសាសម័យ; បើជារឿងបុរាណ ត្រូវប្រើភាសាបុរាណ។ កុំប្រើពាក្យបច្ចេកទេសរបស់ប្រភេទរឿងមួយទៅលើរឿងផ្សេង។`;
  }

  return `
==================================================
MODE A — FAITHFUL DIALOGUE TRANSLATION
(ការបញ្ចូលសំឡេងសន្ទនាតួអង្គតាមបន្ទាត់អក្សរចិនដើម ១០០% Line-by-Line Chinese Dialogue)
==================================================
គោលការណ៍គ្រឹះតឹងរ៉ឹងសម្រាប់ Mode A (Strict Rules for Mode A Dialogue Dubbing):
1. Mode A គឺជាការបកប្រែពាក្យសន្ទនាតាមបន្ទាត់អក្សរចិនជាក់ស្តែង (Faithful line-by-line Chinese dialogue translation) មិនមែនជាការសង្ខេបសាច់រឿង ឬការនិទានបែបសម្រាយរឿង (NOT narration, NOT story recap) ឡើយ។
2. ត្រូវអាន និងស្រង់រាល់អក្សរ Subtitle ចិនដែលបង្កប់លើអេក្រង់ (Burned-in Chinese Subtitles) ទាំងអស់ដោយគ្មានការរំលង ទោះបីជាឃ្លានោះខ្លីត្រឹមតែ 1 ទៅ 2 វិនាទីក៏ដោយ។
3. កាត់ឃ្លាតាមបន្ទាត់អក្សរ Subtitle ឬប្រយោគនីមួយៗដាច់ដោយឡែក (STRICT LINE-BY-LINE SENTENCE SEGMENTATION)៖
   - មួយបន្ទាត់អក្សរ Subtitle ឬមួយប្រយោគសន្ទនា = មួយ Segment ដាច់ដោយឡែកពីគ្នាជានិច្ច (One subtitle line on screen = One distinct segment)។
   - រយៈពេល Segment នីមួយៗត្រូវស្ថិតនៅចន្លោះពី 1.8 ទៅ 5.0 វិនាទី (ហាមលើសពី 6.0 វិនាទីជាដាច់ខាត)!
   - ហាមដាច់ខាតមិនឱ្យច្របាច់ប្រយោគច្រើន ឬការសន្ទនាឆ្លើយឆ្លងគ្នារាប់សិបវិនាទី (10s - 20s) មកដាក់ក្នុង Segment តែមួយឡើយ!
   - រាល់ពេលដែលប្រយោគចិនចប់ (មានសញ្ញាខណ្ឌ "。", សញ្ញាសួរ "？", សញ្ញាឧទាន "！", ឬចុចបី "……"), ឬពេលអក្សរ Subtitle ចាស់រលត់ហើយអក្សរ Subtitle ថ្មីឡើង ត្រូវតែបង្កើត Segment ថ្មីភ្លាម!
   - បើតួអង្គពីរនិយាយឆ្លើយឆ្លងគ្នា ត្រូវតែចែកជា Segment ដាច់ដោយឡែកពីគ្នា ហាមដាក់ចូលគ្នាក្នុង Segment តែមួយដាច់ខាត!
4. រក្សាអត្ថបទចិនដើមឱ្យចំតួអក្សរដែលបានឃើញ (Preserve exact original Chinese characters as recognized)។ ហាមតែង ឬទាយអក្សរចិនដែលមើលមិនឃើញ។
5. កំណត់ startTime និង endTime ឱ្យសុក្រឹតតាមពេលវេលាដើមនៃវីដេអូ (Source-media timestamp)។
6. កំណត់អត្តសញ្ញាណតួអង្គ និងភេទសំឡេង (Speaker Diarization & Voice Gender)៖
   - សំឡេងដើមជាបុរស MALE (ប្រុស) ➜ voiceGender: "male", gender: "male" (សំឡេងពិសិដ្ឋ km-KH-PisethNeural)
   - សំឡេងដើមជាស្ត្រី FEMALE (ស្រី) ➜ voiceGender: "female", gender: "female" (សំឡេងស្រីមុំ km-KH-SreymomNeural)
   - មិនច្បាស់ ឬគ្មានសំឡេង ➜ voiceGender: "unknown", gender: "unknown"
7. ភាសាសន្ទនាខ្មែរ (khmerText) & Strict Syllable/Duration Budget:
   - ភាសាសន្ទនាកុនភាគខ្មែរធម្មជាតិ រស់រវើក (Cinema-grade spoken drama Khmer)។ ហាមដាច់ខាតប្រើ Google Translate style ឬបកប្រែពាក្យមួយៗ!
   - គោរពកំហិតពាក្យខ្មែរយ៉ាងតឹងរ៉ឹង៖ ចំនួនពាក្យខ្មែរអតិបរមា = Math.ceil((endTime - startTime) * 3.5) (ប្រហែល 3 ទៅ 3.5 ពាក្យក្នុង 1 វិនាទី)។ បើតួនិយាយ 1.0s ត្រូវបកត្រឹម 3-4 ពាក្យ (ឧ. "បើចឹងឯងនិយាយធ្វើអី!") ហាមបកវែង 10-15 ពាក្យដែលនាំឱ្យសំឡេង TTS អូសបន្លាយដល់ 5-6s ជាន់លើតួបន្ទាប់!
   - ហាមដាច់ខាតកុំឱ្យមានតួអក្សរថៃ (Thai characters) ឬពាក្យថៃណាមួយ 100%!
${genreSpecificRule}
   - ពេលមាន Dual-Source (Audio + OCR) ត្រូវយកសំឡេងនិយាយ Audio ជាធំដើម្បីកែអក្សរ OCR ដែលស្កេនខុស។
8. ការវិភាគ Inner Thought (Delivery Classification)៖
   - out_loud: ការសន្ទនានិយាយចេញក្រៅធម្មតា។
   - inner_thought: ការគិតក្នុងចិត្ត/និយាយក្នុងចិត្ត។
   - narration: សំឡេងអ្នកនិទាន/voice-over បរិយាយសាច់រឿង។
9. បញ្ចេញលទ្ធផលជា JSON ដែលមាន "mode": "dialogue"។${durationInstruction}
${cleanDirection ? `\nតម្រូវការបន្ថែមពីអ្នកប្រើប្រាស់៖ ${cleanDirection}` : ""}
`;
}

function buildRecapPrompt(userDirection = "", durationSec = 0, narratorGender = "male") {
  const cleanDirection = String(userDirection || "").trim();
  const normGender =
    String(narratorGender || "male").toLowerCase() === "female" ? "female" : "male";
  const durationInstruction =
    durationSec > 0
      ? `
ការគ្របដណ្តប់រយៈពេលវីដេអូទាំងមូល (សំខាន់បំផុត)៖
1. រយៈពេលវីដេអូសរុប៖ ${formatSecondsToTimecode(durationSec)} (${Math.round(durationSec)} វិនាទី)។
2. អ្នកត្រូវតែសម្រាយសាច់រឿងឱ្យពេញវីដេអូតាំងពីវិនាទីចាប់ផ្តើម (00:00.00) រហូតដល់វិនាទីចុងក្រោយ (${formatSecondsToTimecode(durationSec)}) ដោយហាមឈប់ពាក់កណ្តាលទីដាច់ខាត។
3. បង្កើតឃ្លានិទានរឿងបន្តបន្ទាប់គ្នាជាប់រហូត (មួយឃ្លាៗមានរយៈពេលពី 4 ទៅ 8 វិនាទី ប្រហែល 15 ទៅ 28 ពាក្យខ្មែរ) ដោយមិនទុកចន្លោះស្ងាត់ (Gap) យូរឡើយ។
4. ហាមបកប្រែតែចំណងជើង ឬអក្សរលើអេក្រង់ដាច់ខាត! ត្រូវមើលសកម្មភាពតួអង្គក្នុងវីដេអូ ហើយនិទានសាច់រឿងឱ្យអ្នកមើលយល់ពីដើមដល់ចប់។`
      : `
ការគ្របដណ្តប់រយៈពេលវីដេអូទាំងមូល៖
1. សម្រាយសាច់រឿងពេញវីដេអូតាំងពីដើមរហូតដល់ចប់ ដោយមួយឃ្លាៗមានរយៈពេលពី 4 ទៅ 8 វិនាទី។
2. មើលសកម្មភាពតួអង្គក្នុងវីដេអូ ហើយនិទានដំណើររឿងជាប់រហូតដោយគ្មានចន្លោះស្ងាត់។`;

  return `
==================================================
MODE B — CINEMATIC DRAMA RECAP (សម្រាយសាច់រឿងកុនរស់រវើក)
==================================================
អ្នកគឺជាអ្នកសម្រាយរឿងកុនដ៏ល្បីល្បាញនៅកម្ពុជា។ សូមមើលវីដេអូនេះទាំងមូល រួចតែងជាអត្ថបទសម្រាយសាច់រឿងជាភាសាខ្មែរ៖
1. ប្រើភាសាសម្រាយរឿងខ្មែររស់រវើក ទាក់ទាញ មានទឹកដម និងប្រើពាក្យភ្ជាប់សេចក្តីដូចជា៖ «ពេលនោះឯង», «រំពេចនោះ», «ស្រាប់តែ», «បន្ទាប់មក», «មិនបង្អង់យូរ», «ឃើញសភាពបែបនេះ...»។
2. រៀបចំឃ្លាប្រយោគឱ្យច្បាស់លាស់ ដើម្បីឱ្យ Microsoft Edge Neural TTS អានបានពិរោះធម្មជាតិ។
3. កំណត់អត្តសញ្ញាណអ្នកនិយាយគ្រប់ឃ្លាទាំងអស់៖
   - "speaker": "អ្នកសម្រាយរឿង"
   - "gender": "${normGender}"
4. បញ្ចេញលទ្ធផលជា JSON ដែលមាន "mode": "recap"។
${durationInstruction}
${cleanDirection ? `\nតម្រូវការបន្ថែម៖ ${cleanDirection}` : ""}
`;
}

function buildSubtitlePrompt(userDirection = "", durationSec = 0) {
  const cleanDirection = String(userDirection || "").trim();
  const durationInstruction =
    durationSec > 0
      ? `\nការគ្របដណ្តប់រយៈពេលវីដេអូទាំងមូល៖ វីដេអូនេះមានប្រវែង ${formatSecondsToTimecode(durationSec)} (${Math.round(durationSec)} វិនាទី)។ សូមស្រង់អក្សរចិនគ្រប់ឃ្លាតាំងពី 00:00.00 ដល់ ${formatSecondsToTimecode(durationSec)}។`
      : "";
  return `
==================================================
MODE C — ON-SCREEN TITLE & SUBTITLE TRANSLATION (ចំណងជើងលើអេក្រង់)
==================================================
សូមអាន និងបកប្រែអក្សរ Subtitle ចិន និងចំណងជើងទាំងអស់ដែលបង្ហាញលើអេក្រង់វីដេអូ (Burned-in Subtitles & Titles OCR) ជាភាសាខ្មែរ៖
1. ស្រង់អក្សរចិនគ្រប់ឃ្លាទាំងអស់ដែលមាននៅលើអេក្រង់វីដេអូ ដាក់ក្នុង originalText។
2. បកប្រែជាភាសាខ្មែរឱ្យចំអត្ថន័យដើម ដាក់ក្នុង khmerText។
3. កំណត់ "speaker": "ចំណងជើងលើអេក្រង់" សម្រាប់អក្សរ Title លើអេក្រង់ ឬឈ្មោះតួអង្គបើមានស្លាកឈ្មោះ។
4. បញ្ចេញលទ្ធផលជា JSON ដែលមាន "mode": "subtitles"។${durationInstruction}
${cleanDirection ? `\nតម្រូវការបន្ថែម៖ ${cleanDirection}` : ""}
`;
}

function getPromptForMode(mode = "dialogue", options = {}) {
  const norm = String(mode).toLowerCase();
  const durationSec = Number(options.durationSec || options.duration || 0);
  const narratorGender = options.narratorGender || "male";
  if (norm === "recap") return buildRecapPrompt(options.customPrompt, durationSec, narratorGender);
  if (norm === "subtitles") return buildSubtitlePrompt(options.customPrompt);
  return buildDialoguePrompt(options.customPrompt, durationSec, options);
}

function buildCinemaPrompt(mode = "dialogue", customPrompt = "", narratorGender = "male", durationSec = 0, options = {}) {
  const norm = String(mode).toLowerCase();
  if (norm === "recap") return buildRecapPrompt(customPrompt, durationSec, narratorGender);
  if (norm === "subtitles") return buildSubtitlePrompt(customPrompt);
  return buildDialoguePrompt(customPrompt, durationSec, options);
}

function resolveGenerationMode(optionsOrPrompt = {}) {
  if (typeof optionsOrPrompt === "string") {
    const text = optionsOrPrompt.toLowerCase();
    if (text.includes("សង្ខេប") || text.includes("recap") || text.includes("សម្រាយ")) {
      return { mode: "recap", recapStyle: "story_recap" };
    }
    if (text.includes("subtitle") || text.includes("ចំណងជើង") || text.includes("subtitles")) {
      return { mode: "subtitles", recapStyle: "title_translation" };
    }
    return { mode: "dialogue", recapStyle: "standard" };
  }

  const opts = optionsOrPrompt || {};
  const rawMode = String(opts.mode || "").trim().toLowerCase();
  const rawStyle = String(opts.recapStyle || "").trim().toLowerCase();

  // 1. បើអ្នកប្រើជ្រើសរើស Mode A (dialogue) ច្បាស់លាស់ ត្រូវតែជា dialogue ដាច់ខាត!
  if (rawMode === "dialogue") {
    return { mode: "dialogue", recapStyle: "standard" };
  }

  // 2. បើអ្នកប្រើជ្រើសរើស Mode B (recap)
  if (rawMode === "recap") {
    return { mode: "recap", recapStyle: rawStyle || "story_recap" };
  }

  // 3. Subtitles
  if (rawMode === "subtitles" || rawStyle === "title_translation") {
    return { mode: "subtitles", recapStyle: "title_translation" };
  }

  // 4. Fallback ករណីគ្មានបញ្ជាក់ mode ប៉ុន្តែមាន style ជា recap
  if (rawStyle.includes("recap") || rawStyle.includes("story")) {
    return { mode: "recap", recapStyle: rawStyle || "story_recap" };
  }

  return { mode: "dialogue", recapStyle: "standard" };
}

/**
 * អនុគមន៍ Parse និងជួសជុល JSON ដោយស្វ័យប្រវត្តិ (សង្គ្រោះទិន្នន័យទោះបីដាច់កន្ទុយ JSON)
 */
/**
 * អនុគមន៍ Parse និងជួសជុល JSON ដោយតាមដាន Truncation យ៉ាងច្បាស់លាស់
 * មិនបិទបាំងការដាច់កន្ទុយ JSON ឡើយ (Tracks _meta.wasTruncated)
 */
function safeParseOrRepairJson(raw) {
  if (!raw) throw new Error("Gemini បានឆ្លើយតបមកវិញនូវទិន្នន័យទទេ (Empty response text)");
  let text = String(raw).trim();

  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      parsed._meta = { wasTruncated: false };
      return parsed;
    }
  } catch (_) {}

  try {
    const trailingCommaFixed = text.replace(/,\s*([\]}])/g, "$1");
    const parsed = JSON.parse(trailingCommaFixed);
    if (parsed && typeof parsed === "object") {
      parsed._meta = { wasTruncated: false };
      return parsed;
    }
  } catch (_) {}

  try {
    const sanitized = text.replace(/[\x00-\x1F\x7F-\x9F]/g, (c) => {
      if (c === "\n" || c === "\r" || c === "\t") return c;
      return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
    });
    const parsed = JSON.parse(sanitized);
    if (parsed && typeof parsed === "object") {
      parsed._meta = { wasTruncated: false };
      return parsed;
    }
  } catch (_) {}

  // ករណី JSON ដាច់កន្ទុយពាក់កណ្តាលទី ("segments": [... ដាច់)
  const segmentsIdx = text.indexOf('"segments"');
  if (segmentsIdx !== -1) {
    let lastBrace = text.lastIndexOf("}");
    while (lastBrace > segmentsIdx) {
      const candidate =
        text
          .slice(0, lastBrace + 1)
          .replace(/,\s*$/, "")
          .replace(/,\s*([\]}])/g, "$1") + "\n  ]\n}";
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && Array.isArray(parsed.segments) && parsed.segments.length > 0) {
          console.warn(
            `[GeminiService] ⚠️ JSON ដាច់កន្ទុយពាក់កណ្តាលទី! បានស្រង់សង្គ្រោះបណ្តោះអាសន្ន ${parsed.segments.length} ឃ្លា (WasTruncated: true)`
          );
          parsed._meta = {
            wasTruncated: true,
            rescuedCount: parsed.segments.length,
            rawLength: text.length,
          };
          return parsed;
        }
      } catch (_) {}
      lastBrace = text.lastIndexOf("}", lastBrace - 1);
    }
  }

  if (text.startsWith("[")) {
    let lastBrace = text.lastIndexOf("}");
    while (lastBrace > 0) {
      const candidate =
        text
          .slice(0, lastBrace + 1)
          .replace(/,\s*$/, "")
          .replace(/,\s*([\]}])/g, "$1") + "\n]";
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return {
            segments: parsed,
            _meta: { wasTruncated: true, rescuedCount: parsed.length, rawLength: text.length },
          };
        }
      } catch (_) {}
      lastBrace = text.lastIndexOf("}", lastBrace - 1);
    }
  }

  try {
    const looseFixed = text
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/,\s*([\]}])/g, "$1");
    const parsed = JSON.parse(looseFixed);
    if (parsed && typeof parsed === "object") {
      parsed._meta = { wasTruncated: false };
      return parsed;
    }
  } catch (_) {}

  throw new Error("មិនអាច Parse ឬសង្គ្រោះ JSON ពី Gemini បានទេ");
}

/**
 * ផ្ទៀងផ្ទាត់ JSON Schema នៃ Segment នីមួយៗ និងកែតម្រូវទិន្នន័យមិនប្រក្រតី
 */
function validateAndSanitizeSegment(rawSeg, index = 0, activeMode = "dialogue") {
  if (!rawSeg || typeof rawSeg !== "object") {
    return { valid: false, reason: "Segment មិនមែនជា Object ត្រឹមត្រូវ" };
  }

  const khmerText = String(rawSeg.khmerText || rawSeg.khmer || rawSeg.khmerTranslatedText || "").trim();
  const originalText = String(rawSeg.originalText || rawSeg.original || rawSeg.originalChineseText || rawSeg.chineseText || "").trim();

  // If neither original Chinese text nor Khmer translation exists, reject as empty
  if (!khmerText && !originalText) {
    return { valid: false, reason: "ខ្វះអត្ថបទភាសាខ្មែរ (Empty khmerText)" };
  }

  let startSec = parseTimeToSec(rawSeg.startTime || rawSeg.start, index * 3.5);
  let endSec = parseTimeToSec(rawSeg.endTime || rawSeg.end, startSec + 3.0);

  const rawDuration = endSec - startSec;
  const isMicroDuration = isNaN(rawDuration) || rawDuration < 0.6; // Block 0.01s or zero duration

  if (isNaN(startSec) || startSec < 0) startSec = Math.max(0, index * 3.5);
  if (isNaN(endSec) || endSec <= startSec || isMicroDuration) {
    const textLen = khmerText.length || originalText.length || 10;
    const estimatedDuration = Math.max(1.8, Math.min(8.0, textLen * 0.16));
    endSec = parseFloat((startSec + estimatedDuration).toFixed(2));
  }

  const speaker = String(rawSeg.speaker || rawSeg.speakerName || (activeMode === "recap" ? "អ្នកសម្រាយរឿង" : "តួអង្គ")).trim();
  const rawGender = String(rawSeg.speakerGender || rawSeg.gender || rawSeg.voiceGender || "").toUpperCase();
  const gender = (rawGender === "MALE" || rawGender === "FEMALE")
    ? rawGender
    : detectSpeakerGender(speaker, rawGender, khmerText);
  const voiceGender = rawSeg.voiceGender
    ? String(rawSeg.voiceGender).toLowerCase()
    : (gender.toLowerCase() === "female" ? "female" : (gender.toLowerCase() === "male" ? "male" : "unknown"));
  const khmerVoiceId = rawSeg.khmerVoiceId || (voiceGender === "female" ? "km-KH-SreymomNeural" : "km-KH-PisethNeural");
  const genderConfidence = typeof rawSeg.acousticConfidence === "number"
    ? rawSeg.acousticConfidence
    : (typeof rawSeg.genderConfidence === "number" && rawSeg.genderConfidence !== 0.5
      ? rawSeg.genderConfidence
      : (voiceGender === "unknown" ? null : 0.85));

  const translationStatus = rawSeg.translationStatus || (khmerText ? "translated" : (originalText ? "review_needed" : "pending"));
  const ttsStatus = rawSeg.ttsStatus || (rawSeg.audioFile ? "ready" : "pending");

  // Delivery Classification (out_loud | inner_thought | narration | unknown)
  const deliveryType = rawSeg.deliveryOverride && rawSeg.deliveryType
    ? rawSeg.deliveryType
    : (['out_loud', 'inner_thought', 'narration', 'unknown'].includes(rawSeg.deliveryType)
      ? rawSeg.deliveryType
      : (activeMode === 'recap' ? 'narration' : 'out_loud'));
  const deliveryOverride = Boolean(rawSeg.deliveryOverride);
  const deliveryConfidence = typeof rawSeg.deliveryConfidence === 'number'
    ? rawSeg.deliveryConfidence
    : (deliveryType === 'unknown' ? null : (deliveryOverride ? 1.0 : 0.9));
  const deliveryReviewNeeded = Boolean(rawSeg.deliveryReviewNeeded || deliveryType === 'unknown');
  const audioEffect = rawSeg.audioEffect || (deliveryType === 'inner_thought' ? 'inner_thought_reverb' : 'none');
  const effectConfig = rawSeg.effectConfig || (deliveryType === 'inner_thought' ? { inGain: 0.85, outGain: 0.75, delays: "40|90", decays: "0.3|0.15" } : null);
  const rawAudioPath = rawSeg.rawAudioPath || null;
  const rawAudioFile = rawSeg.rawAudioFile || null;

  const segId = rawSeg.segmentId !== undefined && rawSeg.segmentId !== null
    ? rawSeg.segmentId
    : (rawSeg.id !== undefined && rawSeg.id !== null ? rawSeg.id : index + 1);

  return {
    valid: true,
    segment: {
      id: segId,
      segmentId: segId,
      mode: rawSeg.mode || activeMode,
      segmentType: rawSeg.segmentType || (activeMode === "recap" ? "narration" : (activeMode === "subtitles" ? "subtitle" : "dialogue")),
      startTime: formatSecondsToTimecode(startSec),
      endTime: formatSecondsToTimecode(endSec),
      start: formatSecondsToTimecode(startSec),
      end: formatSecondsToTimecode(endSec),
      startSec,
      endSec,
      sourceStartSec: typeof rawSeg.sourceStartSec === "number" ? rawSeg.sourceStartSec : startSec,
      sourceEndSec: typeof rawSeg.sourceEndSec === "number" ? rawSeg.sourceEndSec : endSec,
      speaker,
      speakerName: speaker,
      speakerId: rawSeg.speakerId ? String(rawSeg.speakerId).trim() : getSpeakerId(speaker),
      speakerGender: gender,
      gender: voiceGender === "female" ? "female" : (voiceGender === "male" ? "male" : "unknown"),
      voiceGender,
      genderConfidence,
      khmerVoiceId,
      voiceAssignmentSource: rawSeg.voiceAssignmentSource || "automatic",
      deliveryType,
      deliveryOverride,
      deliveryConfidence,
      deliveryReviewNeeded,
      audioEffect,
      effectConfig,
      rawAudioPath,
      rawAudioFile,
      acousticGender: rawSeg.acousticGender || null,
      acousticConfidence: rawSeg.acousticConfidence || null,
      pitchHz: rawSeg.pitchHz || null,
      originalText: originalText,
      original: originalText,
      originalChineseText: originalText,
      khmerText,
      khmer: khmerText,
      khmerTranslatedText: khmerText,
      translationStatus: isMicroDuration ? "review_needed" : translationStatus,
      ttsStatus,
      duration: parseFloat((endSec - startSec).toFixed(2)),
      reviewNeeded: Boolean(isMicroDuration || rawSeg.reviewNeeded || rawSeg.uncertainOcr || (rawSeg.translationStatus === "review_needed")),
      uncertainOcr: Boolean(rawSeg.uncertainOcr || rawSeg.isUncertain),
      uncertainTiming: Boolean(isMicroDuration || rawSeg.uncertainTiming),
      ocrTimestamp: rawSeg.ocrTimestamp || null,
      isRecovered: Boolean(rawSeg.isRecovered),
      recoveryGap: rawSeg.recoveryGap || null,
    },
  };
}

/**
 * សវនកម្មការគ្របដណ្តប់ Timeline (បែងចែក Genuine Silence ពី Dropped Gaps)
 */
function auditTimelineCoverage(segments = [], mediaDurationSec = 0) {
  if (!segments || segments.length === 0) {
    return {
      status: "critical",
      coverageRatio: 0,
      coveragePercentage: 0,
      totalDurationSec: mediaDurationSec,
      totalSegments: 0,
      gaps: mediaDurationSec > 0 ? [{
        type: "tail_gap",
        startSec: 0,
        endSec: mediaDurationSec,
        durationSec: mediaDurationSec,
        description: "គ្មាន Segment ណាមួយត្រូវបានស្រង់ចេញពីវីដេអូឡើយ",
      }] : [],
    };
  }

  const duration = mediaDurationSec > 0 ? mediaDurationSec : (segments[segments.length - 1].endSec || 0);
  const gaps = [];

  // 1. Check head gap (00:00 to first segment)
  const firstStart = segments[0].startSec;
  if (firstStart > 4.0) {
    const isSuspicious = firstStart > 12.0;
    gaps.push({
      type: isSuspicious ? "suspicious_gap" : "natural_pause",
      startSec: 0,
      endSec: parseFloat(firstStart.toFixed(2)),
      durationSec: parseFloat(firstStart.toFixed(2)),
      description: isSuspicious
        ? `ចន្លោះស្ងាត់វែងនៅដើមវីដេអូ (${firstStart.toFixed(1)}s) អាចបាត់សន្ទនា`
        : `ចន្លោះស្ងាត់ធម្មជាតិនៅដើមវីដេអូ (${firstStart.toFixed(1)}s)`,
    });
  }

  // 2. Check internal gaps between segments
  for (let i = 1; i < segments.length; i++) {
    const prevEnd = segments[i - 1].endSec;
    const curStart = segments[i].startSec;
    const gapDur = curStart - prevEnd;

    if (gapDur > 4.0) {
      const isSuspicious = gapDur > 12.0;
      gaps.push({
        type: isSuspicious ? "suspicious_gap" : "natural_pause",
        startSec: parseFloat(prevEnd.toFixed(2)),
        endSec: parseFloat(curStart.toFixed(2)),
        durationSec: parseFloat(gapDur.toFixed(2)),
        description: isSuspicious
          ? `ចន្លោះស្ងាត់មិនប្រក្រតី ${gapDur.toFixed(1)}s រវាងឃ្លា #${segments[i - 1].id} និង #${segments[i].id} (អាចបាត់សន្ទនា)`
          : `ចន្លោះស្ងាត់ធម្មជាតិ ${gapDur.toFixed(1)}s (Genuine Silence)`,
      });
    }
  }

  // 3. Check tail gap (last segment to end of video)
  const lastEnd = segments[segments.length - 1].endSec;
  if (duration > 0 && duration - lastEnd > 5.0) {
    const tailDur = duration - lastEnd;
    const isTailDrop = tailDur > 15.0;
    gaps.push({
      type: isTailDrop ? "tail_gap" : "natural_pause",
      startSec: parseFloat(lastEnd.toFixed(2)),
      endSec: parseFloat(duration.toFixed(2)),
      durationSec: parseFloat(tailDur.toFixed(2)),
      description: isTailDrop
        ? `ចន្លោះស្ងាត់ចុងវីដេអូ ${tailDur.toFixed(1)}s (សញ្ញាដាច់ JSON ឬរំលងឈុតចុងក្រោយ)`
        : `ចន្លោះស្ងាត់ធម្មជាតិចុងវីដេអូ ${tailDur.toFixed(1)}s`,
    });
  }

  const coverageRatio = duration > 0 ? Math.min(1.0, parseFloat((lastEnd / duration).toFixed(3))) : 1.0;
  const suspiciousCount = gaps.filter((g) => g.type === "suspicious_gap" || g.type === "tail_gap").length;

  let status = "good";
  if (coverageRatio < 0.70 || suspiciousCount >= 3) {
    status = "critical";
  } else if (coverageRatio < 0.90 || suspiciousCount > 0) {
    status = "warning";
  }

  return {
    status,
    totalDurationSec: duration,
    firstSegmentStart: segments[0].startTime,
    lastSegmentEnd: segments[segments.length - 1].endTime,
    totalSegments: segments.length,
    coverageRatio,
    coveragePercentage: Math.round(coverageRatio * 100),
    gaps,
  };
}

/**
 * Intelligent sentence splitter for long dialogue segments (> 6.0s)
 * Automatically cuts multi-sentence monologues or grouped exchanges into bite-sized dialogue lines
 */
function splitGiantDialogueSegment(seg) {
  const origChinese = String(seg.originalChineseText || seg.originalText || seg.original || "").trim();
  const fullKhmer = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || "").trim();
  const startSec = typeof seg.startSec === "number" ? seg.startSec : 0;
  const endSec = typeof seg.endSec === "number" ? seg.endSec : startSec + 4.0;
  const totalDur = parseFloat((endSec - startSec).toFixed(2));

  // If already short (<= 6.0s), do not split
  if (totalDur <= 6.0) {
    return [seg];
  }

  // Split Khmer sentences by punctuation: ។, ?, !, ..., \n
  const kmSentences = fullKhmer
    .split(/(?<=[។!?\n])\s*|(?<=\.{3,})\s*|(?<=…+)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Split Chinese sentences by punctuation: 。！？…\n；
  const cnSentences = origChinese
    .split(/(?<=[。！？\n；])\s*|(?<=\.{3,})\s*|(?<=…+)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const numSplits = Math.max(kmSentences.length, cnSentences.length);
  if (numSplits <= 1) {
    // If very long (> 9.0s) without sentence terminators, split by comma or words
    if (totalDur >= 9.0) {
      const kmHalves = fullKhmer.split(/(?<=[, ])\s*/).filter(Boolean);
      const cnHalves = origChinese.split(/(?<=[，,])\s*/).filter(Boolean);
      if (kmHalves.length >= 2 || cnHalves.length >= 2) {
        const midTime = parseFloat((startSec + totalDur / 2).toFixed(2));
        const kmMid = Math.floor(kmHalves.length / 2);
        const cnMid = Math.floor(cnHalves.length / 2);
        const km1 = kmHalves.slice(0, kmMid).join(" ").trim();
        const km2 = kmHalves.slice(kmMid).join(" ").trim();
        const cn1 = cnHalves.slice(0, cnMid).join(" ").trim();
        const cn2 = cnHalves.slice(cnMid).join(" ").trim();

        return [
          {
            ...seg,
            startSec,
            endSec: midTime,
            start: formatSecondsToTimecode(startSec),
            end: formatSecondsToTimecode(midTime),
            startTime: formatSecondsToTimecode(startSec),
            endTime: formatSecondsToTimecode(midTime),
            sourceStartSec: startSec,
            sourceEndSec: midTime,
            duration: parseFloat((midTime - startSec).toFixed(2)),
            khmer: km1,
            khmerText: km1,
            khmerTranslatedText: km1,
            original: cn1,
            originalText: cn1,
            originalChineseText: cn1,
          },
          {
            ...seg,
            id: `${seg.id || 1}_2`,
            startSec: midTime,
            endSec,
            start: formatSecondsToTimecode(midTime),
            end: formatSecondsToTimecode(endSec),
            startTime: formatSecondsToTimecode(midTime),
            endTime: formatSecondsToTimecode(endSec),
            sourceStartSec: midTime,
            sourceEndSec: endSec,
            duration: parseFloat((endSec - midTime).toFixed(2)),
            khmer: km2,
            khmerText: km2,
            khmerTranslatedText: km2,
            original: cn2,
            originalText: cn2,
            originalChineseText: cn2,
          },
        ];
      }
    }
    return [seg];
  }

  // Calculate proportional weights based on character length
  const weights = [];
  for (let i = 0; i < numSplits; i++) {
    const kmL = (kmSentences[i] || "").length;
    const cnL = (cnSentences[i] || "").length;
    weights.push(Math.max(1, kmL + cnL * 1.5));
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0) || 1;

  const result = [];
  let curStart = startSec;

  for (let i = 0; i < numSplits; i++) {
    const partDur = parseFloat(((weights[i] / sumWeights) * totalDur).toFixed(2));
    const isLast = i === numSplits - 1;
    const partEnd = isLast ? endSec : parseFloat((curStart + Math.max(1.5, partDur)).toFixed(2));

    const kmPart = kmSentences[i] || (i === 0 ? fullKhmer : "");
    const cnPart = cnSentences[i] || (i === 0 ? origChinese : "");

    result.push({
      ...seg,
      id: `${seg.id || 1}_${i + 1}`,
      startSec: curStart,
      endSec: partEnd,
      start: formatSecondsToTimecode(curStart),
      end: formatSecondsToTimecode(partEnd),
      startTime: formatSecondsToTimecode(curStart),
      endTime: formatSecondsToTimecode(partEnd),
      sourceStartSec: curStart,
      sourceEndSec: partEnd,
      duration: parseFloat((partEnd - curStart).toFixed(2)),
      originalChineseText: cnPart,
      originalText: cnPart,
      original: cnPart,
      khmerTranslatedText: kmPart,
      khmerText: kmPart,
      khmer: kmPart,
      audioGenerated: false,
      audioFile: null,
      fullAudioUrl: null,
    });

    curStart = partEnd;
  }

  return result;
}

function normalizeScriptData(rawData = {}, requestedMode = "dialogue", seriesSpeakerMap = {}) {
  const modeObj = resolveGenerationMode({ mode: rawData.mode || requestedMode });
  const activeMode = modeObj.mode;
  let rawSegments = (Array.isArray(rawData.segments) ? rawData.segments : []).filter(
    (s) => s && (
      String(s.khmerText || s.khmer || s.khmerTranslatedText || "").trim().length > 0 ||
      String(s.originalText || s.original || s.originalChineseText || s.chineseText || "").trim().length > 0
    )
  );

  if (rawSegments.length === 0) {
    let fallbackSpeaker = "ពិពណ៌នា";
    if (activeMode === "recap") fallbackSpeaker = "អ្នកសម្រាយរឿង";
    else if (activeMode === "subtitles") fallbackSpeaker = "ចំណងជើង/Subtitle";

    rawSegments = [
      {
        id: 1,
        start: "00:00",
        end: "00:03",
        startTime: "00:00.00",
        endTime: "00:03.00",
        speaker: fallbackSpeaker,
        speakerName: fallbackSpeaker,
        speakerGender: activeMode === "recap" ? "MALE" : "UNKNOWN",
        original: "",
        khmer: rawData.summary || "ឈុតឆាកវីដេអូ",
      },
    ];
  }

  const segments = rawSegments.map((seg, idx) => {
    const startSec = parseTimeToSec(seg.startSec ?? seg.start ?? seg.startTime, idx * 4);
    let endSec = parseTimeToSec(seg.endSec ?? seg.end ?? seg.endTime, startSec + 3.0);
    const rawDur = endSec - startSec;
    const isMicroDuration = isNaN(rawDur) || rawDur < 0.6;
    if (endSec <= startSec || isMicroDuration) {
      const textLen = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || seg.originalChineseText || seg.originalText || "").trim().length || 8;
      endSec = parseFloat((startSec + Math.max(1.8, Math.min(8.0, textLen * 0.16))).toFixed(2));
    }

    const rawSpeaker =
      activeMode === "recap"
        ? "អ្នកសម្រាយរឿង"
        : String(seg.speaker || seg.speakerName || "តួអង្គ").trim();

    const genderDetected = detectSpeakerGender(
      rawSpeaker,
      seg.speakerGender || seg.gender || seg.voiceGender,
      seg.khmer || seg.khmerText || ""
    );
    const finalGender =
      genderDetected !== "UNKNOWN"
        ? genderDetected
        : seg.speakerGender || (String(seg.gender || "").toLowerCase() === "female" ? "FEMALE" : (String(seg.gender || "").toLowerCase() === "male" ? "MALE" : "UNKNOWN"));
    const voiceGender = seg.voiceGender || (finalGender === "FEMALE" ? "female" : (finalGender === "MALE" ? "male" : "unknown"));
    const voiceId = seg.voiceId || seg.khmerVoiceId || getDefaultVoiceForGender(finalGender);

    const origChinese = String(seg.originalChineseText || seg.originalText || seg.original || seg.chineseText || "").trim();
    const khmerTrans = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || "").trim();
    const segId = seg.segmentId || seg.id || idx + 1;

    return {
      id: segId,
      segmentId: segId,
      start: formatSecondsToTimecode(startSec),
      end: formatSecondsToTimecode(endSec),
      startTime: formatSecondsToTimecode(startSec),
      endTime: formatSecondsToTimecode(endSec),
      startSec,
      endSec,
      startSeconds: startSec,
      endSeconds: endSec,
      duration: Number((endSec - startSec).toFixed(2)),
      speaker: rawSpeaker,
      speakerName: rawSpeaker,
      speakerId: seg.speakerId || null,
      speakerGender: finalGender,
      gender: voiceGender === "female" ? "female" : (voiceGender === "male" ? "male" : "unknown"),
      voiceGender,
      genderConfidence: typeof seg.genderConfidence === "number" ? seg.genderConfidence : (typeof seg.acousticConfidence === "number" ? seg.acousticConfidence : (voiceGender === "unknown" ? 0.5 : 0.85)),
      voiceId,
      khmerVoiceId: seg.khmerVoiceId || voiceId,
      voiceAssignmentSource: seg.voiceAssignmentSource || "automatic",
      acousticGender: seg.acousticGender || null,
      acousticConfidence: seg.acousticConfidence || null,
      pitchHz: seg.pitchHz || null,
      original: origChinese,
      originalText: origChinese,
      originalChineseText: origChinese,
      khmer: khmerTrans,
      khmerText: khmerTrans,
      translationStatus: seg.translationStatus || (khmerTrans ? "translated" : (origChinese ? "review_needed" : "pending")),
      ttsStatus: seg.ttsStatus || (seg.audioFile ? "ready" : "pending"),
      sourceStartSec: typeof seg.sourceStartSec === "number" ? seg.sourceStartSec : startSec,
      sourceEndSec: typeof seg.sourceEndSec === "number" ? seg.sourceEndSec : endSec,
      duration: parseFloat((endSec - startSec).toFixed(2)),
      reviewNeeded: Boolean(isMicroDuration || seg.reviewNeeded || seg.uncertainOcr || (seg.translationStatus === "review_needed")),
      uncertainOcr: Boolean(seg.uncertainOcr || seg.isUncertain),
      uncertainTiming: Boolean(isMicroDuration || seg.uncertainTiming),
      ocrTimestamp: seg.ocrTimestamp || null,
      isRecovered: Boolean(seg.isRecovered),
      recoveryGap: seg.recoveryGap || null,
    };
  });

  // For Dialogue and Subtitles mode, automatically split any giant segments (> 6.0s) into natural sentence lines
  let finalizedSegments = [];
  if (activeMode === "dialogue" || activeMode === "subtitles") {
    for (const seg of segments) {
      const splitPieces = splitGiantDialogueSegment(seg);
      finalizedSegments.push(...splitPieces);
    }
    finalizedSegments = finalizedSegments.map((item, idx) => ({
      ...item,
      id: idx + 1,
      segmentId: idx + 1,
    }));
  } else {
    finalizedSegments = segments.map((item, idx) => ({
      ...item,
      id: idx + 1,
      segmentId: idx + 1,
    }));
  }

  const syncRes = syncSegmentsWithSpeakerRegistry(finalizedSegments, { seriesSpeakerMap });

  return {
    title: (rawData.title || "វីដេអូសម្រាយរឿង").trim(),
    summary: (rawData.summary || "").trim(),
    mode: activeMode,
    segments: syncRes.segments,
    speakers: syncRes.speakers,
    speakerRegistry: syncRes.speakerRegistry || syncRes.speakerMap || syncRes.registry || {},
    speakerMap: syncRes.speakerMap || syncRes.speakerRegistry || {},
  };
}

/**
 * @deprecated Legacy video dubbing generator. Replaced by Clean 10-Stage Pipeline.
 */
async function generateDubbingScript(options = {}) {
  const { runDubbingPipeline } = require("./pipeline");
  return await runDubbingPipeline({
    videoPath: options.filePath,
    mode: options.mode || "dialogue",
    seriesId: options.seriesId || "series_default",
    episodeId: options.episodeId || "ep_1",
    apiKey: options.apiKey,
    modelName: options.modelName,
    customPrompt: options.customPrompt,
    narratorGender: options.narratorGender,
    seriesGlossary: options.seriesGlossary,
  });
}

/**
 * បង្កើត Script ពីអត្ថបទ (Text Prompt Only)
 */
async function generateStorytellingScript(promptText, customApiKey, options = {}) {
  const ai = getGeminiClient(customApiKey);
  const modeObj = resolveGenerationMode(options);
  const resolvedMode = modeObj.mode;
  const cinemaPrompt = buildCinemaPrompt(
    resolvedMode,
    options.customPrompt || promptText,
    options.narratorGender || "male",
    0,
    options
  );
  const targetModel = resolveValidModelName(
    options.modelName || process.env.GEMINI_MODEL
  );

  let response = null;
  let successfulModel = targetModel;
  let lastGeminiError = null;

  const modelsToTry = [
    targetModel,
    ...DEFAULT_MODELS.filter((m) => m !== targetModel),
  ];

  for (const modelToTest of modelsToTry) {
    try {
      console.log(
        `[GeminiService] 🤖 កំពុងវិភាគអត្ថបទជាមួយ ${modelToTest} (Mode: ${resolvedMode})...`
      );
      const modelCall = ai.models.generateContent({
        model: modelToTest,
        contents: [`អត្ថបទដើម៖\n${promptText}\n\n${cinemaPrompt}`],
        config: {
          systemInstruction: KHMER_DUBBING_BASE_SYSTEM_PROMPT,
          temperature: 0.3,
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
          responseSchema: SCRIPT_RESPONSE_SCHEMA,
        },
      });

      const timeoutCall = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout 45s on ${modelToTest}`)),
          45000
        )
      );

      response = await Promise.race([modelCall, timeoutCall]);
      successfulModel = modelToTest;
      break;
    } catch (geminiApiErr) {
      lastGeminiError = geminiApiErr;
      console.error(
        `[GeminiService] ❌ Gemini API Error Details (${modelToTest}):`,
        geminiApiErr.message || geminiApiErr
      );
      console.warn(
        `[GeminiService] ⚠️ ម៉ូដែល ${modelToTest} បរាជ័យ, សាកល្បងម៉ូដែលបន្ទាប់...`
      );
    }
  }

  if (!response) {
    const detailMsg = lastGeminiError
      ? lastGeminiError.message || String(lastGeminiError)
      : "ម៉ូដែលទាំងអស់បានបរាជ័យ";
    throw new Error(`Gemini API Error: ${detailMsg}`);
  }

  const rawResponseText =
    typeof response?.text === "function" ? response.text() : response?.text;

  if (!rawResponseText) {
    throw new Error("Gemini បានឆ្លើយតបមកវិញនូវទិន្នន័យទទេ (Empty response text)");
  }

  let rawData;
  try {
    rawData = safeParseOrRepairJson(rawResponseText);
  } catch (parseErr) {
    console.error("[GeminiService] ❌ JSON Parse Error. Raw Text was:", rawResponseText);
    throw new Error(`មិនអាច Parse JSON ពី Gemini បានទេ: ${parseErr.message}`);
  }

  const normalized = normalizeScriptData(rawData, resolvedMode);

  return {
    success: true,
    mode: normalized.mode,
    summary: normalized.summary,
    modelUsed: successfulModel,
    totalSegments: normalized.segments.length,
    segments: normalized.segments,
    script: normalized.segments,
    speakers: normalized.speakers,
    speakerRegistry: normalized.speakerRegistry,
  };
}

async function generateScriptFromMedia(mediaPath, mimeType, customApiKey, options = {}) {
  const { runDubbingPipeline } = require("./pipeline");
  return await runDubbingPipeline({
    videoPath: mediaPath,
    mode: options.mode || "dialogue",
    seriesId: options.seriesId || "series_default",
    episodeId: options.episodeId || "ep_1",
    apiKey: customApiKey,
    modelName: options.modelName,
    customPrompt: options.customPrompt,
    narratorGender: options.narratorGender,
    seriesGlossary: options.seriesGlossary,
  });
}

/**
 * ✨ AI Single Segment Re-Translation with 3 Classical Cinema Options
 */
async function retranslateSingleDialogue(chineseText, customApiKey = null, context = {}) {
  const cleanChinese = String(chineseText || "").trim();
  if (!cleanChinese) {
    throw new Error("អត្ថបទចិនមិនអាចទទេបានឡើយ (Chinese text cannot be empty)");
  }

  const ai = getGeminiClient(customApiKey);
  const modelToUse = resolveValidModelName(context.modelName || "gemini-3.5-flash-lite");

  const systemPrompt = `អ្នកគឺជាអ្នកដឹកនាំការបញ្ចូលសំឡេង និងជាអ្នកជំនាញបកប្រែកុនភាគបុរាណចិន-ខ្មែរអាជីព (Cinema-Grade Chinese to Khmer Dubbing Translator)។
ភារកិច្ចរបស់អ្នកគឺបកប្រែប្រយោគចិនដែលបានផ្តល់ឱ្យ ជាភាសាខ្មែរសម្រាប់បញ្ចូលសំឡេងកុនបុរាណចិន (យុទ្ធសិល្ប៍ ទេវតា រឿងព្រេង ឬភាគបុរាណ) ឱ្យបានត្រឹមត្រូវន័យដើម ១០០% និងពិរោះរស់រវើក។

សូមផ្តល់ជម្រើសជាទម្រង់ JSON ដូចខាងក្រោម៖
{
  "chinese": "អត្ថបទចិនដើម",
  "options": [
    {
      "style": "classical",
      "label": "🎭 សម្ដីកុនបុរាណ",
      "text": "ភាសានិយាយកុនបុរាណ ពិរោះ មានអំណាច ឬស្រទន់តាមឈុតឆាក"
    },
    {
      "style": "compact",
      "label": "📝 ខ្លីចំអត្ថន័យ",
      "text": "ភាសា Subtitle ខ្លី ងាយយល់ ចំអត្ថន័យដើម ១០០%"
    },
    {
      "style": "dramatic",
      "label": "⚡ អារម្មណ៍តួអង្គ",
      "text": "សម្ដីតួអង្គបញ្ចេញអារម្មណ៍ ឌឺដង កំហឹង ឬចោទសួរ"
    }
  ],
  "note": "ចំណាំខ្លី ១ ឃ្លាអំពីពាក្យគន្លឹះពិសេសបើមាន (ឧ. 神风 = ខ្យល់ទេវតា)"
}

ច្បាប់តឹងរ៉ឹង៖
- ហាមដាច់ខាតកុំបកប្រែពាក្យមួយៗបែប Google Translate!
- ត្រូវគោរពចំនួនលេខឱ្យបានត្រឹមត្រូវ (ឧ. 三 = ៣ ហាមបកជា ២, 吹不死 = ផ្លុំមិនស្លាប់ ហាមបកជាសម្លាប់)!
- ហាមមានតួអក្សរថៃ 100%!
- បញ្ចេញលទ្ធផលជា JSON សុទ្ធសាធ។`;

  const RETRANSLATE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      chinese: { type: Type.STRING },
      options: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            style: { type: Type.STRING },
            label: { type: Type.STRING },
            text: { type: Type.STRING },
          },
          required: ["style", "label", "text"],
        },
      },
      note: { type: Type.STRING },
    },
    required: ["chinese", "options"],
  };

  try {
    const res = await ai.models.generateContent({
      model: modelToUse,
      contents: [`សូមបកប្រែប្រយោគចិននេះ៖\n"${cleanChinese}"`],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: RETRANSLATE_SCHEMA,
      },
    });

    const parsed = safeParseOrRepairJson(res.text || "");
    if (parsed && Array.isArray(parsed.options) && parsed.options.length > 0) {
      return parsed;
    }
    return {
      chinese: cleanChinese,
      options: [
        { style: "classical", label: "🎭 សម្ដីកុនបុរាណ", text: res.text?.trim() || cleanChinese },
        { style: "compact", label: "📝 ខ្លីចំអត្ថន័យ", text: cleanChinese },
      ],
      note: "",
    };
  } catch (err) {
    console.error("[GeminiService] retranslateSingleDialogue error:", err.message);
    throw err;
  }
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
      curr.translationWarning = 'POTENTIAL_DUPLICATE_TRANSLATION';
      curr.reviewNeeded = true;
      curr.validationWarnings = [
        ...(curr.validationWarnings || []),
        `[POTENTIAL_DUPLICATE_TRANSLATION] បន្ទាត់ #${curr.id || i + 1} មានអត្ថបទបកប្រែដូចបន្ទាត់ #${prev.id || i} ទាំងស្រុង ទោះបីប្រយោគចិនដើមខុសគ្នា ("${currChinese}" vs "${prevChinese}")`,
      ];
    } else if (isIdenticalKhmer && isIdenticalChinese) {
      curr.translationWarning = 'POSSIBLE_DUPLICATE_INPUT';
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
 * ✨ Batch AI Re-Translation for All Segments (Cinema Drama Mode)
 */
async function retranslateBatchDialogues(segments, customApiKey = null, options = {}) {
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  const ai = getGeminiClient(customApiKey);
  const modelToUse = resolveValidModelName(options.modelName || "gemini-3.5-flash-lite");

  const BATCH_SIZE = 25;
  const updatedSegments = [...segments];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const inputLines = batch.map((s, idx) => {
      const rawDur = typeof s.duration === 'number' && s.duration > 0
        ? s.duration
        : parseFloat(Math.max(0.6, (s.endSec || 0) - (s.startSec || 0)).toFixed(2));
      const reliableSpeechDur = Number.isFinite(s.speechDuration) && s.speechDuration > 0
        ? s.speechDuration
        : null;
      const effectiveDur = reliableSpeechDur || Math.min(rawDur, 4.5);
      const maxWords = Math.min(16, Math.max(3, Math.ceil(effectiveDur * 3.2)));

      const segmentChinese = String(s.originalChineseText || s.chineseText || s.originalText || s.original || '').trim();
      const audioTranscript = String(s.spokenAudioText || '').trim();
      const targetToTranslate = segmentChinese || audioTranscript;
      const audioContext = (audioTranscript && audioTranscript !== targetToTranslate) ? audioTranscript : null;

      return {
        index: i + idx + 1,
        id: s.id,
        sourceChineseToTranslate: targetToTranslate,
        surroundingAudioContext: audioContext,
        currentKhmer: s.khmerTranslatedText || s.khmerText || s.khmer || "",
        speaker: s.speaker || s.speakerName || "តួអង្គ",
        durationSec: parseFloat(effectiveDur.toFixed(2)),
        maxKhmerWords: maxWords,
      };
    }).filter(item => Boolean(item.sourceChineseToTranslate.trim()));

    if (inputLines.length === 0) continue;

    const batchPrompt = `អ្នកគឺជាអ្នកដឹកនាំការបញ្ចូលសំឡេង និងជាអ្នកជំនាញបកប្រែកុនភាគបុរាណចិន-ខ្មែរអាជីព។
សូមបកប្រែប្រយោគចិនទាំងអស់ខាងក្រោមនេះជាភាសាខ្មែរបែបកុនភាគបុរាណចិន (Cinema Drama Spoken Khmer) ឱ្យបានត្រឹមត្រូវន័យដើម ១០០% (ហាមបកខុសចំនួនលេខ, ហាមច្រឡំអត្ថន័យ) និងពិរោះស័ក្តិសមជាមួយកុនបុរាណចិន។

ច្បាប់តឹងរ៉ឹង៖
1. 1 Segment = 1 Translation: ឃ្លានីមួយៗត្រូវបកប្រែដាច់ដោយឡែកពីគ្នា ស្របតាម "sourceChineseToTranslate" របស់វា។
2. "surroundingAudioContext" (បើមាន) គឺសម្រាប់តែជាបរិបទជួយយល់ន័យឱ្យកាន់តែច្បាស់ប៉ុណ្ណោះ។ ហាមដាច់ខាតកុំយក "surroundingAudioContext" ទាំងមូលមកបកប្រែជំនួស "sourceChineseToTranslate"!
3. ប្រសិនបើឃ្លាចិនដើមជាឃ្លាមិនទាន់ចប់ន័យ (Incomplete Clause, ឧ. បញ្ចប់ដោយសញ្ញាក្បៀស ，) ត្រូវបកប្រែត្រឹមឃ្លានោះ (Incomplete Clause) ដោយរក្សាភាពស៊ីសង្វាក់ជាមួយឃ្លាបន្ទាប់ ហាមខ្ចីន័យ ឬប្រយោគពីឃ្លាបន្ទាប់មកបញ្ចប់ប្រយោគដោយខ្លួនឯងជាដាច់ខាត!
4. កំហិតពាក្យខ្មែរយ៉ាងតឹងរ៉ឹងតាម "maxKhmerWords": ត្រូវបកប្រែឱ្យខ្លី ចំខ្លឹមសារ មិនលើសពីចំនួន "maxKhmerWords" ឡើយ។
5. ហាមដាច់ខាតកុំបកប្រែចេញអត្ថបទខ្មែរដូចគ្នា ២ បន្ទាត់ជាប់គ្នា លុះត្រាតែប្រយោគចិនដើមនៃបន្ទាត់ទាំងពីរជាពាក្យដដែលៗពិតប្រាកដ (ឧ. "对对对", "快走快走")។ បើប្រយោគចិនខុសគ្នា អត្ថបទខ្មែរត្រូវតែខុសគ្នា!
6. ហាមមានតួអក្សរថៃ 100%!

បញ្ជីប្រយោគចិនត្រូវបកប្រែ៖
${JSON.stringify(inputLines, null, 2)}

សូមបញ្ចេញលទ្ធផលជា JSON Array នៃវត្ថុដែលមានទម្រង់៖
[
  {
    "id": 1,
    "khmerText": "អត្ថបទខ្មែរដែលបានកែសម្រួលរួច"
  }
]`;

    try {
      const res = await ai.models.generateContent({
        model: modelToUse,
        contents: [batchPrompt],
        config: {
          systemInstruction: KHMER_DUBBING_BASE_SYSTEM_PROMPT,
          temperature: 0.25,
          responseMimeType: "application/json",
        },
      });

      const parsed = safeParseOrRepairJson(res.text || "");
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const matchIdx = updatedSegments.findIndex((s) => s.id === item.id || String(s.id) === String(item.id));
          if (matchIdx !== -1 && item.khmerText) {
            updatedSegments[matchIdx] = {
              ...updatedSegments[matchIdx],
              khmerTranslatedText: item.khmerText.trim(),
              khmerText: item.khmerText.trim(),
              khmer: item.khmerText.trim(),
              textStatus: "retranslated",
              audioOutdated: true,
            };
          }
        });
      }
    } catch (batchErr) {
      console.warn(`[GeminiService] Batch retranslation failed for slice ${i}-${i + BATCH_SIZE}:`, batchErr.message);
    }
  }

  const evaluatedSegments = detectDuplicateTranslations(updatedSegments);
  return evaluatedSegments;
}

module.exports = {
  DEFAULT_MODELS,
  SCRIPT_RESPONSE_SCHEMA,
  KHMER_DUBBING_BASE_SYSTEM_PROMPT,
  resolveValidModelName,
   safeParseOrRepairJson,
  parseTimeToSeconds,
  formatSecondsToTimecode,
  resolveGenerationMode,
  buildDialoguePrompt,
  buildRecapPrompt,
  buildSubtitlePrompt,
  getPromptForMode,
  buildCinemaPrompt,
  validateAndSanitizeSegment,
  auditTimelineCoverage,
  normalizeScriptData,
  generateDubbingScript,
  generateStorytellingScript,
  generateScriptFromMedia,
  sanitizeSubtitleDuration,
  retranslateSingleDialogue,
  retranslateBatchDialogues,
  computeKhmerSimilarity,
  detectDuplicateTranslations,
};