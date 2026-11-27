const dns = require("dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

const { GoogleGenAI, Type } = require("@google/genai");
const {
  createSmartGenAIClient,
  extractAllGeminiKeys,
  isAuthOrInvalidKeyError,
  isQuotaOrRateLimitError,
  isModelOverloadOrUnavailable,
} = require("./geminiKeyManager");
const {
  DUBBING_CASCADE_MODELS,
  isUsableDubbingModel,
} = require("./geminiModelCatalog");
const { geminiQuotaTracker } = require("./geminiQuotaTracker");
const fs = require("fs");
const path = require("path");

const {
  syncSegmentsWithSpeakerRegistry,
  detectSpeakerGender,
  buildSpeakerRegistry,
  getDefaultVoiceForGender,
  getSpeakerId,
} = require("../models/speakerRegistry");
const { parseTimeToSec, formatTime } = require("../models/timestampUtils");
const { createSegment, normalizeSegmentList } = require("../models/segmentModel");
const { EXPRESSIVE_KHMER_DUBBING_RULES } = require("../utils/translationQuality");

const KHMER_DUBBING_BASE_SYSTEM_PROMPT = `
អ្នកគឺជាអ្នកដឹកនាំការបញ្ចូលសំឡេងកុន អ្នកជំនាញបកប្រែភាសាចិន-ខ្មែរ អ្នកវិភាគវីដេអូ និងជាអ្នកសម្រាយរឿងកុនខ្មែរអាជីព។
ភារកិច្ចរបស់អ្នកគឺវិភាគវីដេអូ សំឡេង និងអក្សរក្នុងវីដេអូដែលបានផ្តល់ឱ្យ រួចបង្កើតជាអត្ថបទសន្ទនា ឬអត្ថបទសម្រាយសាច់រឿងជាភាសាខ្មែរឱ្យបានត្រឹមត្រូវ ធម្មជាតិ និងរស់រវើកតាមទម្រង់ JSON ដែលបានកំណត់។
${EXPRESSIVE_KHMER_DUBBING_RULES}
`;

/**
 * កូដ Prompt សម្រាប់រំលងការគិតយូរ (Fast-Execution Multimodal Prompt)
 * សម្រាប់ Gemini 3.8 Flash វិភាគសាច់រឿងលឿន និងរក្សាពេល Generate ឱ្យនៅក្រោម ៥ នាទី
 * បញ្ជាឱ្យ AI ឈប់ខ្ជះខ្ជាយពេលវិភាគរូបភាពផ្ទៃខាងក្រោយ ឬរៀបរាប់សកម្មភាពតួអង្គ និងងាកមកផ្តោតតែលើការចាប់យកអក្សរ (OCR) និងបកប្រែសន្ទនាសុទ្ធ
 */
const systemPrompt = `
អ្នកគឺជាអ្នកបកប្រែ និងបញ្ចូលសំឡេងកុនអាជីព។ ភារកិច្ចរបស់អ្នកគឺបកប្រែសន្ទនាពីភាសាចិន ទៅជាភាសាខ្មែរ។

ដើម្បីធានាល្បឿនលឿន និងភាពត្រឹមត្រូវ សូមអនុវត្តតាមច្បាប់ទាំងនេះ៖
1. ហាមរៀបរាប់ទិដ្ឋភាព (NO DESCRIPTIONS): មិនត្រូវសរសេរពណ៌នាពីសកម្មភាពតួអង្គ ទីតាំង ឬផ្ទៃខាងក្រោយវីដេអូឡើយ។
2. ផ្តោតលើសន្ទនាសុទ្ធ (DIALOGUE ONLY): ចាប់យកតែអក្សរ Subtitle ចិនលើអេក្រង់ ឬសំឡេងនិយាយ រួចបកប្រែជាភាសាខ្មែរភ្លាមៗ។
3. ភាពខ្លីខ្លឹម (CONCISENESS): ប្រើប្រាស់ពាក្យសន្ទនាខ្មែរខ្លីៗ ត្រូវសាច់រឿង ដើម្បីងាយស្រួលដល់ការបញ្ចូលសំឡេង TTS កុំឱ្យលើសវិនាទី។
4. កំណត់អត្តសញ្ញាណតួ (SPEAKER IDENTIFICATION MUST BE GENDER SPECIFIC): 
   - ប្រសិនបើអ្នកនិយាយជាមនុស្សប្រុស ត្រូវដាក់ឈ្មោះថា "តួប្រុស"។
   - ប្រសិនបើអ្នកនិយាយជាមនុស្សស្រី ត្រូវដាក់ឈ្មោះថា "តួស្រី"។
   - ហាមដាក់ឈ្មោះមិនច្បាស់លាស់ (ឧ. "មនុស្សម្នាក់", "សំឡេងអនាមិក")។
5. ${EXPRESSIVE_KHMER_DUBBING_RULES}

ត្រូវផ្តល់លទ្ធផលជាទម្រង់ JSON Array សុទ្ធសាធ:
[
  {
    "start_time": "00:00.00",
    "end_time": "00:03.00",
    "speaker": "តួប្រុស",
    "khmer_dialogue": "ខ្ញុំប្រាប់ហើយថាកុំឱ្យទៅ!"
  }
]
`;

const FAST_EXECUTION_SYSTEM_PROMPT = systemPrompt;

/**
 * បញ្ជីម៉ូដែលផ្លូវការរបស់ Google AI Studio (ប្រើ Shared Catalog គ្រប់ Model ដែលអាច Translate & Dubbing បាន)
 */
const DEFAULT_MODELS = DUBBING_CASCADE_MODELS;

/**
 * ត្រួតពិនិត្យ និងជ្រើសរើសម៉ូដែលដែលមានសុពលភាព (គាំទ្រ preferredModel ពី UI ស្វ័យប្រវត្តិ)
 */
function resolveValidModelName(requestedModel = "") {
  const clean = String(requestedModel || "").trim();
  if (clean && clean !== "auto" && isUsableDubbingModel(clean)) {
    return clean;
  }
  return geminiQuotaTracker.getPreferredPrimaryModel(DEFAULT_MODELS[0]);
}

function getGeminiClient(customApiKey) {
  return createSmartGenAIClient(customApiKey);
}

/**
 * Checks whether an error warrants cascading to the next fallback Gemini model
 * (429 quota/rate limit, 503 overload, 504 deadline exceeded, 404 retired/missing model, network timeout).
 * Auth/invalid-key errors (401/403) and malformed request errors (400) fail fast instead of cascading.
 */
function isModelFallbackEligibleError(err) {
  if (!err) return false;
  if (isAuthOrInvalidKeyError(err)) return false;
  if (isQuotaOrRateLimitError(err)) return true;
  if (isModelOverloadOrUnavailable(err)) return true;

  const status = err.status || err.statusCode;
  const msg = String(err.message || err.toString() || "").toLowerCase();
  return (
    status === 404 ||
    status === 503 ||
    status === 504 ||
    msg.includes("404") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("not_found") ||
    msg.includes("not found") ||
    msg.includes("high demand") ||
    msg.includes("unavailable") ||
    msg.includes("no longer available") ||
    msg.includes("deadline_exceeded") ||
    msg.includes("deadline expired") ||
    msg.includes("gateway timeout")
  );
}

/**
 * Invokes `ai.models.generateContent` starting with `primaryModel` and cascading through
 * remaining `models` whenever a model hits 429 quota, 503 overload, 504 timeout, or 404 deprecation.
 */
async function generateContentWithModelFallback(
  ai,
  primaryModel,
  buildPayload,
  { models = DEFAULT_MODELS, logTag = "Gemini", timeoutMs = 25000 } = {}
) {
  let orderedModels = [];
  const seen = new Set();
  for (const m of [primaryModel, ...(Array.isArray(models) ? models : DEFAULT_MODELS)]) {
    const clean = String(m || "").trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      orderedModels.push(clean);
    }
  }
  if (models === DEFAULT_MODELS) {
    orderedModels = geminiQuotaTracker.prioritizeAvailableModels(orderedModels, extractAllGeminiKeys());
  }

  let lastErr = null;
  for (let i = 0; i < orderedModels.length; i++) {
    const currentModel = orderedModels[i];
    let timer = null;
    try {
      const payload = typeof buildPayload === "function" ? buildPayload(currentModel) : buildPayload;
      const callPromise = ai.models.generateContent({
        model: currentModel,
        ...payload,
      });

      let response;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            const timeoutErr = new Error(`Timeout ${Math.round(timeoutMs / 1000)}s on ${currentModel}`);
            timeoutErr.status = 504;
            reject(timeoutErr);
          }, timeoutMs);
          if (typeof timer.unref === "function") timer.unref();
        });
        response = await Promise.race([callPromise, timeoutPromise]);
      } else {
        response = await callPromise;
      }

      return { response, modelUsed: currentModel };
    } catch (err) {
      lastErr = err;
      const safeMsg = String(err?.message || err || "")
        .replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]")
        .slice(0, 180);

      if (!isModelFallbackEligibleError(err)) {
        throw err;
      }

      // If it's a 503 high demand spike, add a small 800ms backoff before next model so Google servers have time to recover
      const is503Spike = String(err?.message || "").includes("high demand") || err?.status === 503;
      if (is503Spike) {
        await new Promise((r) => setTimeout(r, 800));
      }

      const hasNext = i < orderedModels.length - 1;
      if (hasNext) {
        console.warn(
          `[GeminiService] ⚠️ [${logTag}] Model ${currentModel} failed (${safeMsg}). Falling back to ${orderedModels[i + 1]}...`
        );
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw lastErr || new Error("Gemini API failed across all cascade models");
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
    detectedGenre: {
      type: Type.STRING,
      enum: ["ancient", "ceo", "modern", "action", "comedy"],
      description: "ប្រភេទសាច់រឿងដែលបានកំណត់៖ ancient, ceo, modern, action, ឬ comedy",
    },
    summary: {
      type: Type.STRING,
      description: "សេចក្តីសង្ខេបខ្លឹមសាររឿងជាភាសាខ្មែរ (1-2 ប្រយោគ)",
    },
    castRegistry: {
      type: Type.ARRAY,
      description: "បញ្ជីតួអង្គសំខាន់ៗក្នុងឈុតឆាក (Pre-Translation Cast Registry) សម្រាប់ចាក់សោភេទ និងសព្វនាមឱ្យថេរ",
      items: {
        type: Type.OBJECT,
        properties: {
          speakerId: {
            type: Type.STRING,
            description: "ID សម្គាល់តួអង្គថេរ (ឧ. spk_male_lead, spk_female_lead, spk_emperor, spk_ceo)",
          },
          speakerLabelKh: {
            type: Type.STRING,
            description: "ឈ្មោះតួអង្គជាភាសាខ្មែរ (ឧ. តួឯកប្រុស (ព្រះអង្គម្ចាស់), តួឯកស្រី (ព្រះមហេសី), លោកប្រធាន)",
          },
          voiceGender: {
            type: Type.STRING,
            enum: ["male", "female"],
            description: "ភេទសំឡេងពិតរបស់តួអង្គ (male ឬ female)",
          },
          roleArchetype: {
            type: Type.STRING,
            description: "តួនាទីគំរូ (ឧ. royal_male_lead, royal_female_lead, ceo_male, maid_female)",
          },
          selfPronounKh: {
            type: Type.STRING,
            description: "សព្វនាមហៅខ្លួនឯងជាខ្មែរ (ឧ. យើង / ទូលបង្គំ / ខ្ញុំម្ចាស់ / នាងខ្ញុំ / បង / អូន)",
          },
          addressPronounKh: {
            type: Type.STRING,
            description: "សព្វនាមហៅដៃគូសន្ទនា (ឧ. នាង / ម្ចាស់អូន / ព្រះអង្គ / ម្ចាស់បង / លោកប្រធាន)",
          },
        },
        required: ["speakerId", "speakerLabelKh", "voiceGender"],
      },
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
  required: ["mode", "detectedGenre", "summary", "castRegistry", "segments"],
};

/**
 * Fast-Execution Response Schema សម្រាប់ JSON Array សុទ្ធសាធ (Under 5 Minutes Fast Dubbing)
 */
const FAST_SCRIPT_RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  description: "បញ្ជីឃ្លាសន្ទនាជាទម្រង់ JSON Array សុទ្ធសាធ",
  items: {
    type: Type.OBJECT,
    properties: {
      start_time: {
        type: Type.STRING,
        description: "ម៉ោងចាប់ផ្តើម MM:SS.ms (ឧ. 00:00.00)",
      },
      end_time: {
        type: Type.STRING,
        description: "ម៉ោងបញ្ចប់ MM:SS.ms (ឧ. 00:03.00)",
      },
      speaker: {
        type: Type.STRING,
        description: "ឈ្មោះតួថា 'តួប្រុស' ឬ 'តួស្រី'",
      },
      khmer_dialogue: {
        type: Type.STRING,
        description: "អត្ថបទបកប្រែជាភាសាខ្មែរខ្លីៗ ត្រូវសាច់រឿង",
      },
    },
    required: ["start_time", "end_time", "speaker", "khmer_dialogue"],
  },
};

function buildDialoguePrompt(userDirection = "", durationSec = 0, options = {}) {
  const cleanDirection = String(userDirection || "").trim();
  const rawGenre = options?.genre ? String(options.genre).trim().toLowerCase() : "auto";
  const genre = rawGenre === "ceo" ? "modern" : (rawGenre === "general" ? "auto" : rawGenre);
  const durationInstruction =
    durationSec > 0
      ? `\nការគ្របដណ្តប់រយៈពេលវីដេអូទាំងមូល៖ វីដេអូនេះមានប្រវែង ${formatSecondsToTimecode(durationSec)} (${Math.round(durationSec)} វិនាទី)។ សូមវិភាគ និងបកប្រែការសន្ទនាឱ្យគ្រប់ឈុតឆាកតាំងពី 00:00.00 រហូតដល់ ${formatSecondsToTimecode(durationSec)} ដោយហាមឈប់ពាក់កណ្តាលទី។`
      : "";

  let genreSpecificRule = "";
  if (genre === "ancient") {
    genreSpecificRule = `
   - រឿងបុរាណចិន/ប្រវត្តិសាស្ត្រ/គុណនិយម (ancient): ប្រើរាជស័ព្ទ និងពាក្យគុណនិយមខ្មែរពិតប្រាកដ (ព្រះអង្គ, ព្រះនាង, ទូលបង្គំ, ខ្ញុំម្ចាស់, ម្ចាស់បង, សិស្សប្អូន, គ្រូពេទ្យទេព, បក្ស, ថាមពលធាតុ) តាមឋានៈតួអង្គ។`;
  } else if (genre === "modern" || genre === "ceo") {
    genreSpecificRule = `
   - រឿងសម័យទំនើប/CEO/Romance (ceo / modern): ប្រើភាសាសន្ទនាទំនើបច្បាស់ៗ (លោកប្រធាន, អ្នកនាង, លេខា, អគ្គនាយក, បង, អូន, ខ្ញុំ)។ ហាមដាច់ខាតយកពាក្យគុណនិយម (លោកម្ចាស់, ព្រឹទ្ធាចារ្យ, ថាមពលធាតុ...) មកប្រើក្នុងរឿងសម័យទំនើប!`;
  } else if (genre === "action") {
    genreSpecificRule = `
   - រឿង Action/សងសឹក (action): ប្រើឃ្លាបញ្ជាខ្លីៗ មុតមាំ និងមានអំណាច (បញ្ឈប់ភ្លាម!, ថយក្រោយ!, ហ៊ានណាស់!)។`;
  } else if (genre === "comedy") {
    genreSpecificRule = `
   - រឿងកំប្លែង/គ្រួសារ (comedy): ប្រើពាក្យសន្ទនារស់រវើក និងធម្មជាតិ (ណ៎ា, ហ្នឹងណា, ងាប់ហើយ, ម៉េចចឹង)។`;
  } else {
    genreSpecificRule = `
   - ស្គាល់ប្រភេទរឿង (detectedGenre: "ancient" | "ceo" | "modern" | "action" | "comedy") តាមបរិបទជាក់ស្ដែង៖
     • ancient (បុរាណ/រាជវាំង/គុណនិយម): ព្រះអង្គ, ព្រះនាង, ទូលបង្គំ, ខ្ញុំម្ចាស់, ម្ចាស់បង, សិស្សប្អូន, គ្រូពេទ្យទេព, បក្ស, ថាមពលធាតុ។
     • ceo / modern (សម័យទំនើប/អគ្គនាយក): លោកប្រធាន, អ្នកនាង, លេខា, អគ្គនាយក, បង, អូន, ខ្ញុំ។
     • action (ប្រយុទ្ធ/សងសឹក): បញ្ឈប់ភ្លាម!, ថយក្រោយ!, ហ៊ានណាស់!
     • comedy (កំប្លែង): ណ៎ា, ហ្នឹងណា, ងាប់ហើយ, ម៉េចចឹង។`;
  }

  return `
==================================================
MODE A — FAITHFUL DIALOGUE TRANSLATION
(ការបញ្ចូលសំឡេងសន្ទនាតួអង្គតាមបន្ទាត់អក្សរចិនដើម ១០០% Line-by-Line Chinese Dialogue)
==================================================
គោលការណ៍គ្រឹះតឹងរ៉ឹងសម្រាប់ Mode A (Strict Rules for Mode A Dialogue Dubbing):
1. MANDATORY PRE-TRANSLATION CAST REGISTRY & GENRE LOCKING:
   - មុននឹងបកប្រែ segments អ្នកត្រូវតែកំណត់ "detectedGenre" ("ancient" | "ceo" | "modern" | "action" | "comedy") និងបង្កើត "castRegistry" (បញ្ជីតួអង្គដែលមាន speakerId, speakerLabelKh, voiceGender, roleArchetype, selfPronounKh, addressPronounKh) ជាមុនសិន ដើម្បីចាក់សោភេទ (male/female) និងសព្វនាមឱ្យថេរពេញមួយភាគ!
2. Mode A គឺជាការបកប្រែពាក្យសន្ទនាតាមបន្ទាត់អក្សរចិនជាក់ស្តែង (Faithful line-by-line Chinese dialogue translation) មិនមែនជាការសង្ខេបសាច់រឿង ឬការនិទានបែបសម្រាយរឿង (NOT narration, NOT story recap) ឡើយ។
3. ត្រូវអាន និងស្រង់រាល់អក្សរ Subtitle ចិនដែលបង្កប់លើអេក្រង់ (Burned-in Chinese Subtitles) ទាំងអស់ដោយគ្មានការរំលង ទោះបីជាឃ្លានោះខ្លីត្រឹមតែ 0.35s ទៅ 2.0s (ឧ. "住手!", "皇上!", "快走!", "是谁?", "不敢") ក៏ដោយ។
4. កាត់ឃ្លាតាមបន្ទាត់អក្សរ Subtitle ឬប្រយោគនីមួយៗដាច់ដោយឡែក (STRICT LINE-BY-LINE SENTENCE SEGMENTATION)៖
   - មួយបន្ទាត់អក្សរ Subtitle ឬមួយប្រយោគសន្ទនា = មួយ Segment ដាច់ដោយឡែកពីគ្នាជានិច្ច (One subtitle line on screen = One distinct segment)។
   - បើតួអង្គពីរនិយាយឆ្លើយឆ្លងគ្នា ត្រូវតែចែកជា Segment ដាច់ដោយឡែកពីគ្នា ហាមដាក់ចូលគ្នាក្នុង Segment តែមួយដាច់ខាត!
5. STRICT GENDER & CONVERSATIONAL TURN-TAKING RULES (ប្រុស vs ស្រី):
   ត្រូវរួមបញ្ចូលសញ្ញាទាំង ៣ (3 Signals) ដើម្បីកំណត់ voiceGender ("male" ឬ "female") ឱ្យត្រឹមត្រូវ ១០០%៖
   - Signal 1 (Voice Pitch & Visual Evidence):
     • Voice Pitch (F0): បើ F0 >= 170Hz (ឬ VOICE_PITCH: FEMALE) ➜ voiceGender: "female", speaker: "តួស្រី" (សំឡេងស្រីមុំ km-KH-SreymomNeural); បើ F0 <= 155Hz (ឬ VOICE_PITCH: MALE) ➜ voiceGender: "male", speaker: "តួប្រុស" (សំឡេងពិសិដ្ឋ km-KH-PisethNeural)។
     • Visual Evidence: មើល visualGender និង speakerVisualHint ពីរូបភាពមុខ សក់ សម្លៀកបំពាក់ និងមាត់តួអង្គដែលកំពុងនិយាយ។
   - Signal 2 (Conversational Turn-Taking A -> B -> A -> B): បើឃ្លាទី N ហៅឈ្មោះ ឬងារបុរស ("皇上 / 师兄 / 总裁 / 老公 / ព្រះអង្គ / ម្ចាស់បង / លោកប្រធាន") នោះអ្នកនិយាយឃ្លាទី N ច្រើនតែជាស្ត្រី (female) ឬកូនចៅ ហើយឃ្លាឆ្លើយតបបន្ទាប់ N+1 គឺជាបុរស (male) នោះជាអ្នកឆ្លើយ! ផ្ទុយទៅវិញ បើឃ្លាទី N ហៅស្ត្រី ("皇后 / 师妹 / 夫人 / 小姐 / 老婆 / ព្រះមហេសី / សិស្សប្អូនស្រី / អ្នកនាង") អ្នកនិយាយឃ្លាទី N ច្រើនតែជាបុរស (male) ហើយឃ្លាបន្ទាប់ N+1 គឺជាស្ត្រី (female) ឆ្លើយតប។ ហាមដាច់ខាតច្រឡំអ្នកហៅ ទៅជាអ្នកត្រូវគេហៅ!
   - Signal 3 (Self-Pronoun & Kinship Context):
     • ស្ត្រីហៅខ្លួនឯងថា៖ 臣妾, 奴婢, 本宫, 本妃, ខ្ញុំម្ចាស់, នាងខ្ញុំ, អូន ➜ voiceGender: "female", gender: "female" (សំឡេងស្រីមុំ km-KH-SreymomNeural)។
     • បុរសហៅខ្លួនឯងថា៖ 朕, 本王, 本尊, 本座, 微臣, ទូលបង្គំ, យើងខ្ញុំព្រះករុណា, បង, ខ្ញុំបាទ ➜ voiceGender: "male", gender: "male" (សំឡេងពិសិដ្ឋ km-KH-PisethNeural)។
6. ភាសាសន្ទនាខ្មែរ (khmerText) & STRICT LIP-SYNC DURATION RULE (<= 5.5 syllables/sec):
   - ភាសាសន្ទនាកុនភាគខ្មែរធម្មជាតិ រស់រវើក (Cinema-grade spoken drama Khmer)។ ហាមដាច់ខាតប្រើ Google Translate style ឬបកប្រែពាក្យមួយៗ!
   - គោរពកំហិតល្បឿនមាត់ (Strict Lip-Sync Pacing: <= 5.5 syllables/sec ឬ ~4.5 ទៅ 5.5 Khmer words/sec max) ដើម្បីឱ្យសំឡេង TTS ខ្មែរនិយាយត្រូវមាត់តួអង្គក្នុងរយៈពេល (endSec - startSec) ដោយមិនបាច់បង្ខំល្បឿន atempo > 1.35x!
   - ហាមដាច់ខាតកុំឱ្យមានតួអក្សរថៃ (Thai characters) ឬពាក្យថៃណាមួយ 100%!
${genreSpecificRule}
7. ការវិភាគ Inner Thought (Delivery Classification)៖
   - out_loud: ការសន្ទនានិយាយចេញក្រៅធម្មតា។
   - inner_thought: ការគិតក្នុងចិត្ត/និយាយក្នុងចិត្ត (មាត់បិទ)។
   - narration: សំឡេងអ្នកនិទាន/voice-over បរិយាយសាច់រឿង។
8. បញ្ចេញលទ្ធផលជា JSON ដែលមាន "mode": "dialogue", "detectedGenre", "castRegistry", និង "segments"។${durationInstruction}
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
3. បង្កើតឃ្លានិទានរឿងបន្តបន្ទាប់គ្នាជាប់រហូត (មួយឃ្លាៗមានរយៈពេលពី 4 ទៅ 8 វិនាទី ប្រហែល 15 ទៅ 28 ពាក្យខ្មែរ, <= 5.5 syllables/sec) ដោយមិនទុកចន្លោះស្ងាត់ (Gap) យូរឡើយ។
4. ហាមបកប្រែតែចំណងជើង ឬអក្សរលើអេក្រង់ដាច់ខាត! ត្រូវមើលសកម្មភាពតួអង្គក្នុងវីដេអូ ហើយនិទានសាច់រឿងឱ្យអ្នកមើលយល់ពីដើមដល់ចប់។`
      : `
ការគ្របដណ្តប់រយៈពេលវីដេអូទាំងមូល៖
1. សម្រាយសាច់រឿងពេញវីដេអូតាំងពីដើមរហូតដល់ចប់ ដោយមួយឃ្លាៗមានរយៈពេលពី 4 ទៅ 8 វិនាទី (<= 5.5 syllables/sec)។
2. មើលសកម្មភាពតួអង្គក្នុងវីដេអូ ហើយនិទានដំណើររឿងជាប់រហូតដោយគ្មានចន្លោះស្ងាត់។`;

  return `
==================================================
MODE B — CINEMATIC DRAMA RECAP (សម្រាយសាច់រឿងកុនរស់រវើក)
==================================================
អ្នកគឺជាអ្នកសម្រាយរឿងកុនដ៏ល្បីល្បាញនៅកម្ពុជា។ សូមមើលវីដេអូនេះទាំងមូល រួចតែងជាអត្ថបទសម្រាយសាច់រឿងជាភាសាខ្មែរ៖
1. កំណត់ "detectedGenre" ("ancient" | "ceo" | "modern" | "action" | "comedy") និង "castRegistry" សម្រាប់អ្នកសម្រាយរឿង និងតួអង្គសំខាន់ៗ។
2. ប្រើភាសាសម្រាយរឿងខ្មែររស់រវើក ទាក់ទាញ មានទឹកដម និងប្រើពាក្យភ្ជាប់សេចក្តីដូចជា៖ «ពេលនោះឯង», «រំពេចនោះ», «ស្រាប់តែ», «បន្ទាប់មក», «មិនបង្អង់យូរ», «ឃើញសភាពបែបនេះ...» និងប្រើវាក្យស័ព្ទតាមប្រភេទរឿង (បុរាណ៖ ព្រះអង្គ, ព្រះនាង, ម្ចាស់បង, សិស្សប្អូន / សម័យ CEO៖ លោកប្រធាន, អ្នកនាង, អគ្គនាយក)។
3. រៀបចំឃ្លាប្រយោគឱ្យច្បាស់លាស់ (<= 5.5 syllables/sec) ដើម្បីឱ្យ Microsoft Edge Neural TTS អានបានពិរោះធម្មជាតិ។
4. កំណត់អត្តសញ្ញាណអ្នកនិយាយគ្រប់ឃ្លាទាំងអស់៖
   - "speaker": "អ្នកសម្រាយរឿង"
   - "gender": "${normGender}"
5. បញ្ចេញលទ្ធផលជា JSON ដែលមាន "mode": "recap", "detectedGenre", "castRegistry", និង "segments"។
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
      if (Array.isArray(parsed) && !parsed.segments) {
        parsed.segments = parsed;
      }
      parsed._meta = { wasTruncated: false };
      return parsed;
    }
  } catch (_) {}

  try {
    const trailingCommaFixed = text.replace(/,\s*([\]}])/g, "$1");
    const parsed = JSON.parse(trailingCommaFixed);
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed) && !parsed.segments) {
        parsed.segments = parsed;
      }
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
      if (Array.isArray(parsed) && !parsed.segments) {
        parsed.segments = parsed;
      }
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
  let rawSegments = (
    Array.isArray(rawData) ? rawData : (Array.isArray(rawData?.segments) ? rawData.segments : [])
  ).filter(
    (s) => s && (
      String(s.khmerText || s.khmer || s.khmerTranslatedText || s.khmer_dialogue || "").trim().length > 0 ||
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

  const castRegistry = Array.isArray(rawData.castRegistry) ? rawData.castRegistry : [];

  const segments = rawSegments.map((seg, idx) => {
    const startSec = parseTimeToSec(seg.startSec ?? seg.start ?? seg.startTime ?? seg.start_time, idx * 4);
    let endSec = parseTimeToSec(seg.endSec ?? seg.end ?? seg.endTime ?? seg.end_time, startSec + 3.0);
    const rawDur = endSec - startSec;
    const isMicroDuration = isNaN(rawDur) || rawDur < 0.35;
    if (endSec <= startSec || isMicroDuration) {
      const textLen = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || seg.khmer_dialogue || seg.originalChineseText || seg.originalText || "").trim().length || 8;
      endSec = parseFloat((startSec + Math.max(1.8, Math.min(8.0, textLen * 0.16))).toFixed(2));
    }

    const rawSpeaker =
      activeMode === "recap"
        ? "អ្នកសម្រាយរឿង"
        : String(seg.speaker || seg.speakerName || "តួអង្គ").trim();

    const hasVerifiedStep1Speaker = Boolean(
      seg.speakerStatus === "verified" ||
      seg.speakerVerified === true ||
      seg.voiceAssignmentSource === "multimodal_verified" ||
      seg.voiceAssignmentSource === "series_glossary" ||
      seg.voiceAssignmentSource === "manual" ||
      seg.userOverridden === true
    );
    const explicitRawGender = String(seg.voiceGender || seg.speakerGender || seg.gender || "").toLowerCase().trim();
    const explicitUpper = explicitRawGender === "female" ? "FEMALE" : (explicitRawGender === "male" ? "MALE" : "UNKNOWN");

    // Never infer speaker gender from translated Khmer text when Step 1 verified/evaluated speaker exists or ever as primary source
    const genderDetected = hasVerifiedStep1Speaker && explicitUpper !== "UNKNOWN"
      ? explicitUpper
      : detectSpeakerGender(
          { ...seg, speaker: rawSpeaker },
          { castRegistry },
          ""
        );
    const finalGender =
      explicitUpper !== "UNKNOWN" && (hasVerifiedStep1Speaker || genderDetected === "UNKNOWN")
        ? explicitUpper
        : (genderDetected !== "UNKNOWN" ? genderDetected : "UNKNOWN");
    const voiceGender = seg.voiceGender === "female" || seg.voiceGender === "male"
      ? seg.voiceGender
      : (finalGender === "FEMALE" ? "female" : (finalGender === "MALE" ? "male" : "unknown"));
    const isAmbiguousSpeaker = Boolean(
      seg.speakerReviewNeeded ||
      seg.speakerStatus === "review_needed" ||
      voiceGender === "unknown"
    );
    const voiceId = seg.voiceId || seg.khmerVoiceId || getDefaultVoiceForGender(finalGender);

    const origChinese = String(seg.originalChineseText || seg.originalText || seg.original || seg.chineseText || "").trim();
    const khmerTrans = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || seg.khmer_dialogue || "").trim();
    const segId = seg.segmentId || seg.id || idx + 1;

    return {
      id: segId,
      segmentId: segId,
      ...(seg.sourceCueId ? { sourceCueId: seg.sourceCueId } : {}),
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
      speakerConfidence: typeof seg.speakerConfidence === "number" ? seg.speakerConfidence : (typeof seg.genderConfidence === "number" ? seg.genderConfidence : (voiceGender === "unknown" ? 0.45 : 0.85)),
      genderConfidence: typeof seg.genderConfidence === "number" ? seg.genderConfidence : (typeof seg.acousticConfidence === "number" ? seg.acousticConfidence : (voiceGender === "unknown" ? 0.45 : 0.85)),
      voiceId,
      khmerVoiceId: seg.khmerVoiceId || voiceId,
      voiceAssignmentSource: seg.voiceAssignmentSource || (voiceGender === "unknown" ? "fallback" : "automatic"),
      deliveryType: seg.deliveryType || "out_loud",
      speakerStatus: seg.speakerStatus || (isAmbiguousSpeaker ? "review_needed" : "verified"),
      speakerReviewNeeded: Boolean(seg.speakerReviewNeeded || voiceGender === "unknown"),
      unverifiedSpeaker: Boolean(seg.unverifiedSpeaker || isAmbiguousSpeaker),
      ...(seg.speakerEvidence ? { speakerEvidence: seg.speakerEvidence } : {}),
      ...(Array.isArray(seg.internalSpeakerTurns) && seg.internalSpeakerTurns.length > 0 ? { internalSpeakerTurns: seg.internalSpeakerTurns } : {}),
      acousticGender: seg.acousticGender || null,
      acousticConfidence: seg.acousticConfidence || null,
      pitchHz: seg.pitchHz || null,
      original: origChinese,
      originalText: origChinese,
      originalChineseText: origChinese,
      khmer: khmerTrans,
      khmerText: khmerTrans,
      khmerTranslatedText: khmerTrans,
      khmer_dialogue: khmerTrans,
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
    detectedGenre: rawData.detectedGenre || "modern",
    castRegistry,
    mode: activeMode,
    segments: syncRes.segments,
    speakers: syncRes.speakers,
    speakerRegistry: syncRes.speakerRegistry || syncRes.speakerMap || syncRes.registry || {},
    speakerMap: syncRes.speakerMap || syncRes.speakerRegistry || {},
  };
}

/**
 * បង្កើត Script ពីអត្ថបទ (Text Prompt Only)
 */
async function generateStorytellingScript(promptText, customApiKey, options = {}) {
  const ai = getGeminiClient(customApiKey);
  const modeObj = resolveGenerationMode(options);
  const resolvedMode = modeObj.mode;
  const isFastExecution = Boolean(
    options.fastExecution ||
    options.isFast ||
    options.fastMode ||
    options.generationMode === "fast_ocr" ||
    resolvedMode === "fast_ocr" ||
    String(options.modelName || "").includes("3.8-flash") ||
    String(options.customPrompt || "").includes("MAXIMUM SPEED") ||
    String(promptText || "").includes("MAXIMUM SPEED")
  );

  const activeSystemPrompt = options.systemPrompt || (isFastExecution ? systemPrompt : KHMER_DUBBING_BASE_SYSTEM_PROMPT);
  const activeSchema = isFastExecution ? FAST_SCRIPT_RESPONSE_SCHEMA : SCRIPT_RESPONSE_SCHEMA;

  const cinemaPrompt = buildCinemaPrompt(
    resolvedMode,
    options.customPrompt || promptText,
    options.narratorGender || "male",
    0,
    options
  );
  const targetModel = resolveValidModelName(
    options.modelName || (isFastExecution ? "gemini-3.8-flash" : process.env.GEMINI_MODEL)
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
        `[GeminiService] 🤖 កំពុងវិភាគអត្ថបទជាមួយ ${modelToTest} (Mode: ${resolvedMode}, FastExecution: ${isFastExecution})...`
      );
      const modelCall = ai.models.generateContent({
        model: modelToTest,
        contents: [`អត្ថបទដើម៖\n${promptText}\n\n${cinemaPrompt}`],
        config: {
          systemInstruction: activeSystemPrompt,
          temperature: isFastExecution ? 0.2 : 0.3,
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
          responseSchema: activeSchema,
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

/**
 * Strict Khmer Script Sanitizer: Strips any Thai, Lao, or foreign script leaks,
 * and fixes known Thai loanwords/slang (e.g. ไอ้ -> អា, ออกมา -> ចេញមក).
 */
function sanitizeKhmerDialogue(str = "", fallbackSource = "") {
  if (!str || typeof str !== "string") return str;
  let cleaned = str
    .replace(/ไอ้/g, "អា")
    .replace(/ออกมานี่/g, "ចេញមកនេះ")
    .replace(/ออกมา/g, "ចេញមក")
    .replace(/ผู้?บรรยาย/g, "អ្នករៀបរាប់")
    .replace(/บรรยาย/g, "រៀបរាប់")
    .replace(/ยาก/g, "ពិបាក")
    .replace(/มั่ง/g, "ខ្លះ")
    .replace(/มึง/g, "ឯង")
    .replace(/กู/g, "អញ")
    .replace(/[\u0E00-\u0E7F]+/g, "")
    .replace(/[\u0E80-\u0EFF]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned && fallbackSource) {
    cleaned = String(fallbackSource).trim();
  }
  return cleaned;
}

/**
 * ✨ AI Single Segment Re-Translation with 3 Classical Cinema Options
 * Powered by DragonDub AI Expert Chinese-to-Khmer Subtitle Translator Rules
 */
async function retranslateSingleDialogue(chineseText, customApiKey = null, context = {}) {
  const cleanChinese = String(chineseText || "").trim();
  if (!cleanChinese) {
    throw new Error("អត្ថបទចិនមិនអាចទទេបានឡើយ (Chinese text cannot be empty)");
  }

  const ai = context.aiClient || getGeminiClient(customApiKey);
  const modelToUse = resolveValidModelName(context.modelName);

  const previousTranslation = (context.previousTranslation || context.previous_translation || "").trim();
  const surroundingContext = (context.context || context.surroundingContext || "").trim();
  const speakerInfo = context.speaker ? `${context.speaker}${context.gender ? ` (${context.gender})` : ""}` : "";
  const rawDur = Number(context.durationSec ?? context.duration ?? 0);
  const effectiveDur = Number.isFinite(rawDur) && rawDur > 0 ? Math.max(0.4, Math.min(rawDur, 4.5)) : null;
  const maxKhmerWords = effectiveDur
    ? Math.min(14, Math.max(2, Math.ceil(effectiveDur * 2.5)))
    : null;

  const systemPrompt = `You are an expert Chinese-to-Khmer movie dubbing & subtitle translator for DragonDub AI.

**TASK: RE-TRANSLATE THE ORIGINAL CHINESE LINE INTO NATURAL, PUNCHY, ACCURATE SPOKEN KHMER (3 OPTIONS).**

Follow these strict dubbing translation rules:
1. Analyze the full Chinese meaning, idiom, tone, urgency, and speaker relationship BEFORE translating. Never translate word-by-word like robotic machine translation.
2. Resolve ambiguous terms using surrounding dialogue and scene context (e.g., 质量 = ម៉ាស in physics, 能量 = ថាមពល, 愣着 = ឈរភ្លឹក/ស្ទាក់ស្ទើរ).
3. Use real natural spoken Khmer used in professional Khmer-dubbed Chinese dramas — clear, crisp, natural rhythm for Khmer TTS voice acting.
4. **OPTION #2 ("compact" / "📝 ខ្លីចំអត្ថន័យ") IS THE PRIMARY AUTO-SELECTED DUBBING LINE**:
   - Must be the sharpest, shortest, most natural spoken Khmer that preserves 100% of the core meaning, tone, and emotion with ZERO bloated filler words!
   - Respect lip-sync pacing (<= 5.5 Khmer syllables/sec${maxKhmerWords ? `, HARD LIMIT: <= ${maxKhmerWords} Khmer words for ${effectiveDur.toFixed(2)}s slot` : ''}) so Khmer TTS fits the actor's mouth cleanly without rushing.${maxKhmerWords ? `
   - **STRICT COMPACT WORD BUDGET: Option #2 text MUST contain at most ${maxKhmerWords} Khmer words (space-separated tokens). Compress filler words first. NEVER drop degree words (បន្តិច/ខ្លាំង/ជាង/ណាស់/កាន់តែ) and NEVER drop the subject when that changes who acts.**` : ''}
   - Option #2 MUST be the shortest of all 3 options.
   - Real examples of great Option #2 ("📝 ខ្លីចំអត្ថន័យ"):
     * "还愣着干什么" ➜ "នៅចាំអីទៀត!" (NOT wordy "តើអ្នកនៅឈរភ្លឹកធ្វើអ្វីទៀត?")
     * "每种50分" ➜ "មួយប្រភេទ ៥០ពិន្ទុ" (NOT "ប្រភេទនីមួយៗបាន ៥០ពិន្ទុ")
     * "给本座三" ➜ "យកមកឱ្យយើងទាំង ៣"
     * "再快一点" ➜ "លឿនឡើង!"
     * "别管我，快走" ➜ "កុំខ្វល់ពីខ្ញុំ ឆាប់ទៅ!"
5. Preserve incomplete clauses accurately (if Chinese ends mid-thought or with a comma, translate ONLY that clause — never invent or borrow words from the next line).
6. Do NOT add invented meanings, explanations, parentheses, or speaker names inside "text".
7. **Every re-translation must generate a fresh, improved Khmer translation — never blindly copy the previous translation if it is stiff, long, or inaccurate.**
8. Check every option for fluent Khmer grammar, correct spelling, natural punctuation (! / ?), and 100% semantic accuracy.

CRITICAL LANGUAGE MANDATES:
- ហាមដាច់ខាតកុំឱ្យសល់តួអក្សរចិន (Chinese Hanzi \\u4E00-\\u9FFF) ឬអក្សរអង់គ្លេសនៅក្នុងអត្ថបទបកប្រែខ្មែរ "text" (100% Khmer Script Only)! ពាក្យកម្រិតថាមពល/ក្បាច់គុន (ឧ. 金丹 ➜ ជីនតាន, 化神 ➜ ហ្វាស៊ិន, 元神 ➜ យានស៊ិន) ត្រូវសរសេរជាសូរសព្ទអក្សរខ្មែរ!
- ហាមដាច់ខាត ១០០% កុំបញ្ចេញតួអក្សរថៃ (Thai Script \\u0E00-\\u0E7F) ឬឡាវសូម្បី ១ តួអក្សរ! ត្រូវប្រើអក្សរខ្មែរសុទ្ធ ១០០%!
- ត្រូវគោរពចំនួនលេខឱ្យត្រឹមត្រូវ ១០០% (ឧ. 三 = ៣ ហាមបកជា ២)!
- ពាក្យជេរ/ហៅ (ឧ. 臭猴子) ➜ ខ្មែរសុទ្ធ (អាស្វាស្អុយ, អាស្វាចង្រៃ) និងពាក្យបញ្ជា (ឧ. 滚出来) ➜ ខ្មែរសុទ្ធ (ចេញមក!, ឆាប់ចេញមក!)។
${EXPRESSIVE_KHMER_DUBBING_RULES}

Return EXACTLY 3 distinctive options in this exact order + a short 1-sentence note in JSON:
{
  "chinese": "អត្ថបទចិនដើម",
  "options": [
    {
      "style": "classical",
      "label": "🎭 សម្ដីកុនបុរាណ",
      "text": "ភាសានិយាយកុនបុរាណ/ផ្លូវការ ពិរោះ មានអំណាច ឬស្រទន់តាមឈុតឆាក"
    },
    {
      "style": "compact",
      "label": "📝 ខ្លីចំអត្ថន័យ",
      "text": "ជម្រើសចម្បងសម្រាប់បញ្ចូលសំឡេង៖ ខ្លីបំផុត ធម្មជាតិ ងាយយល់ ចំអត្ថន័យដើម ១០០% និងត្រូវចង្វាក់មាត់ (Lip-sync)"
    },
    {
      "style": "dramatic",
      "label": "⚡ អារម្មណ៍តួអង្គ",
      "text": "សម្ដីតួអង្គបញ្ចេញអារម្មណ៍ខ្លាំង ឌឺដង កំហឹង បន្ទាន់ ឬចោទសួរ"
    }
  ],
  "note": "ចំណាំខ្លី ១ ឃ្លាអំពីពាក្យគន្លឹះ ឬបរិបទឈុតឆាក"
}`;

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
    let promptContent = `**Original Chinese:** ${cleanChinese}`;
    if (previousTranslation) {
      promptContent += `\n**Previous Khmer Translation (for comparison only; do not copy blindly):** ${previousTranslation}`;
    }
    if (surroundingContext) {
      promptContent += `\n**Surrounding Context (if available):** ${surroundingContext}`;
    }
    if (speakerInfo) {
      promptContent += `\n**Speaker:** ${speakerInfo}`;
    }
    if (effectiveDur && maxKhmerWords) {
      promptContent += `\n**Time Slot Budget (for Option #2 compact lip-sync):** ${effectiveDur.toFixed(2)}s (target <= ${maxKhmerWords} Khmer words)`;
    }

    const { response: res, modelUsed } = await generateContentWithModelFallback(
      ai,
      modelToUse,
      () => ({
        contents: [promptContent],
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: RETRANSLATE_SCHEMA,
        },
      }),
      {
        models: context.fallbackModels || DEFAULT_MODELS,
        logTag: "retranslateSingleDialogue",
        timeoutMs: context.timeoutMs ?? 25000,
      }
    );

    const rawText = typeof res?.text === "function" ? res.text() : (res?.text || "");
    const parsed = safeParseOrRepairJson(rawText);
    if (parsed && Array.isArray(parsed.options) && parsed.options.length > 0) {
      parsed.options = parsed.options.map((opt) => ({
        ...opt,
        text: sanitizeKhmerDialogue(opt.text, cleanChinese),
      }));
      if (parsed.note) {
        parsed.note = sanitizeKhmerDialogue(parsed.note, "");
      }
      return { ...parsed, modelUsed, ...(maxKhmerWords ? { maxKhmerWords } : {}) };
    }
    const fallbackKhmer = sanitizeKhmerDialogue(rawText.trim() || previousTranslation || cleanChinese, cleanChinese);
    return {
      chinese: cleanChinese,
      options: [
        { style: "classical", label: "🎭 សម្ដីកុនបុរាណ", text: fallbackKhmer },
        { style: "compact", label: "📝 ខ្លីចំអត្ថន័យ", text: fallbackKhmer },
      ],
      note: "",
      modelUsed,
      ...(maxKhmerWords ? { maxKhmerWords } : {}),
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

const FORBIDDEN_DIALOGUE_SCRIPT_RE = /[\u4E00-\u9FFF\u3400-\u4DBFA-Za-z\u0E00-\u0E7F\u0E80-\u0EFF]/;

const COMPACT_DUBBING_PROMPT_HEADER = `You are an expert Chinese-to-Khmer movie dubbing and subtitle translator.

Your task is to generate natural, punchy, accurate spoken Khmer dialogue using the Compact Dubbing approach (📝 ខ្លីចំអត្ថន័យ).

## Translation Rules

1. Analyze the original Chinese dialogue, existing Khmer translation, surrounding dialogue, character relationships, tone, and scene context.
2. Preserve 100% of the original core meaning.
3. Use natural spoken Khmer, similar to professionally dubbed Chinese movies.
4. Make dialogue short, clear, expressive, and suitable for lip-sync.
5. Remove unnecessary filler words without losing meaning.
6. Never translate mechanically or word-for-word.
7. Preserve character names, numbers, titles, relationships, emotions, and important terminology.
8. Use appropriate pronouns based on context:
   - Family: ម៉ាក់, ប៉ា, កូន, បង, អូន
   - Friends: ខ្ញុំ, ឯង, បង
   - Enemies: អញ, ឯង, ហ្អែង
   - Formal: ខ្ញុំ, លោក, អ្នក
9. Output Khmer dialogue only. Preserve required identifiers and JSON structure outside the dialogue fields.
10. Never include Chinese, English, Thai, or Lao characters inside Khmer dialogue.
11. Never add information that does not exist in the original Chinese dialogue.
12. Do not shorten dialogue unnecessarily when it is already natural and compact.
13. Expressive Sounds & Emotional Vocalizations (AUTO-COMPACT SAFE):
   - NEVER skip short vocalizations or interjections merely because they contain few characters, and NEVER strip meaningful emotional sounds during compact dubbing.
   - Translate ALL interjections, repeated sounds, hesitation, laughter, coughing, crying, screaming, sighing, stuttering, and emotional vocalizations into natural, pronounceable Khmer phonetic expressions suitable for Edge TTS.
   - NEVER output descriptive sound words like "សើច", "យំ", "ក្អក", or "ស្រែក" unless those exact words are actually spoken as dialogue.
   - Match the original cue duration as closely as possible and never leave untranslated Chinese or English vocalizations.

## Translation Examples

- 我没事 → ខ្ញុំមិនអីទេ។
- 结束了 → ចប់ហើយ។
- 如果我说不呢 → ចុះបើខ្ញុំមិនព្រមវិញ?
- 给我十分钟时间 → ឱ្យពេលខ្ញុំ ១០ នាទី។
- 过家家游戏 → ល្បែងបាយឡុកបាយឡ។
- 你体内的那个家伙很危险 → អាដែលនៅក្នុងខ្លួនកូននោះ គ្រោះថ្នាក់ណាស់។ (Parent-to-child context)
- 老子好端端在角落里面待着 → អញនៅកៀនជ្រុងសុខៗសោះ។
- 哈哈哈 / hahaha → ហាហាហាហា!
- 呵呵 / hehehe → ហេហេហេ...
- 啊啊啊 → អា៎! អា៎! អា៎!
- 啊呃啊 → អា៎... អឺ... អា៎!
- 咳咳咳 → ខក់! ខក់! ខក់!
- 嗯嗯嗯 → អ៊ឹម... អ៊ឹម...
- 哼 → ហ៊ឹស!
- 唉 → ហ៊ឺ...

## Strict Output

Return only the final compact Khmer dialogue equivalent to Option 2 (📝 ខ្លីចំអត្ថន័យ).

Do not generate three options, explanations, headings, or alternative translations.`;

/**
 * Validate 1:1 cue mapping, identifiers, and pure Khmer script for batch retranslation.
 */
function validateCompactBatchOutput(inputLines, parsed) {
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid compact dubbing output: expected JSON array");
  }
  if (parsed.length !== inputLines.length) {
    throw new Error(`Invalid compact dubbing output: expected ${inputLines.length} cues, got ${parsed.length}`);
  }

  const expectedById = new Map();
  inputLines.forEach((item) => {
    expectedById.set(String(item.id), item);
  });

  const seenIds = new Set();
  const seenSourceCueIds = new Set();
  const validatedById = new Map();

  for (const outItem of parsed) {
    if (!outItem || typeof outItem !== "object") {
      throw new Error("Invalid compact dubbing output: cue item must be an object");
    }
    const idKey = outItem.id !== undefined && outItem.id !== null ? String(outItem.id) : "";
    if (!idKey || !expectedById.has(idKey)) {
      throw new Error(`Invalid compact dubbing output: unknown or missing cue id "${idKey}"`);
    }
    if (seenIds.has(idKey)) {
      throw new Error(`Invalid compact dubbing output: duplicate cue id "${idKey}"`);
    }
    seenIds.add(idKey);

    const expected = expectedById.get(idKey);
    if (expected.sourceCueId) {
      if (outItem.sourceCueId !== undefined && outItem.sourceCueId !== null && String(outItem.sourceCueId) !== String(expected.sourceCueId)) {
        throw new Error(`Invalid compact dubbing output: sourceCueId mismatch for id "${idKey}"`);
      }
      const cueKey = String(expected.sourceCueId);
      if (seenSourceCueIds.has(cueKey)) {
        throw new Error(`Invalid compact dubbing output: duplicate sourceCueId "${cueKey}"`);
      }
      seenSourceCueIds.add(cueKey);
    }

    const rawKhmer = typeof outItem.khmerText === "string" ? outItem.khmerText.trim() : "";
    if (!rawKhmer) {
      throw new Error(`Invalid compact dubbing output: empty khmerText for cue id "${idKey}"`);
    }
    if (FORBIDDEN_DIALOGUE_SCRIPT_RE.test(rawKhmer)) {
      throw new Error(`Invalid compact dubbing output: non-Khmer script detected in cue id "${idKey}"`);
    }

    validatedById.set(idKey, rawKhmer);
  }

  if (seenIds.size !== inputLines.length) {
    throw new Error(`Invalid compact dubbing output: missing cue identifiers (${seenIds.size}/${inputLines.length})`);
  }

  return validatedById;
}

/**
 * ✨ Batch AI Re-Translation for All Segments (Cinema Drama Mode)
 */
async function retranslateBatchDialogues(segments, customApiKey = null, options = {}) {
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  const ai = options.aiClient || getGeminiClient(customApiKey);
  const modelToUse = resolveValidModelName(options.modelName);

  const BATCH_SIZE = Number.isInteger(options.batchSize) && options.batchSize > 0 ? options.batchSize : 25;
  const updatedSegments = segments.map((s) => ({ ...s }));
  const translationStyle = options.style || options.translationStyle || 'compact';
  const isCompact = translationStyle === 'compact';
  const completedIds = new Set();

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const inputLines = batch.map((s, idx) => {
      const globalIdx = i + idx;
      const prevSeg = globalIdx > 0 ? segments[globalIdx - 1] : null;
      const nextSeg = globalIdx + 1 < segments.length ? segments[globalIdx + 1] : null;
      const rawDur = typeof s.duration === 'number' && s.duration > 0
        ? s.duration
        : parseFloat(Math.max(0.6, (s.endSec || 0) - (s.startSec || 0)).toFixed(2));
      const reliableSpeechDur = Number.isFinite(s.speechDuration) && s.speechDuration > 0
        ? s.speechDuration
        : null;
      const effectiveDur = reliableSpeechDur || Math.min(rawDur, 4.5);

      const segmentChinese = String(s.originalChineseText || s.chineseText || s.originalText || s.original || '').trim();
      const audioTranscript = String(s.spokenAudioText || '').trim();
      const targetToTranslate = segmentChinese || audioTranscript;

      const prevChinese = prevSeg ? String(prevSeg.originalChineseText || prevSeg.chineseText || prevSeg.originalText || prevSeg.spokenAudioText || '').trim() : '';
      const nextChinese = nextSeg ? String(nextSeg.originalChineseText || nextSeg.chineseText || nextSeg.originalText || nextSeg.spokenAudioText || '').trim() : '';

      return {
        id: s.id,
        ...(s.sourceCueId ? { sourceCueId: s.sourceCueId } : {}),
        sourceChinese: targetToTranslate,
        existingKhmer: s.khmerTranslatedText || s.khmerText || s.khmer || "",
        speaker: s.speaker || s.speakerName || "តួអង្គ",
        ...(s.gender ? { gender: s.gender } : {}),
        durationSec: parseFloat(effectiveDur.toFixed(2)),
        ...(prevChinese ? { prevDialogueContextOnly: prevChinese } : {}),
        ...(nextChinese ? { nextDialogueContextOnly: nextChinese } : {}),
      };
    }).filter(item => Boolean(item.sourceChinese.trim()));

    if (inputLines.length === 0) continue;

    const batchPrompt = `${isCompact ? COMPACT_DUBBING_PROMPT_HEADER : `You are an expert Chinese-to-Khmer movie dubbing and subtitle translator. Translate the following Chinese dialogue into natural spoken Khmer.\n\n${EXPRESSIVE_KHMER_DUBBING_RULES}`}

## Input Cues (Context fields are for reference only — never merge neighboring dialogue into a cue)
${JSON.stringify(inputLines, null, 2)}

## Required JSON Output Format
Return a JSON Array with the exact same ${inputLines.length} items, preserving each "id" and "sourceCueId" (if present) 1:1 in the same order:
[
  {
    "id": 1,
    "sourceCueId": "cue_1",
    "khmerText": "អត្ថបទខ្មែរ"
  }
]`;

    try {
      const { response: res } = await generateContentWithModelFallback(
        ai,
        modelToUse,
        () => ({
          contents: [batchPrompt],
          config: {
            systemInstruction: isCompact ? COMPACT_DUBBING_PROMPT_HEADER : KHMER_DUBBING_BASE_SYSTEM_PROMPT,
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
        {
          models: options.fallbackModels || DEFAULT_MODELS,
          logTag: "retranslateBatchDialogues",
          timeoutMs: options.timeoutMs ?? 45000,
        }
      );

      const rawText = typeof res?.text === "function" ? res.text() : (res?.text || "");
      const parsed = safeParseOrRepairJson(rawText);
      const validatedById = validateCompactBatchOutput(inputLines, parsed);

      for (const inputItem of inputLines) {
        const idKey = String(inputItem.id);
        const cleanKhmer = validatedById.get(idKey);
        const matchIdx = updatedSegments.findIndex((s) => String(s.id) === idKey);
        if (matchIdx !== -1 && cleanKhmer) {
          const prevSeg = updatedSegments[matchIdx];
          const preservedOriginalKhmer = prevSeg.originalKhmerText
            || prevSeg.khmerTranslatedText
            || prevSeg.khmerText
            || prevSeg.khmer
            || "";
          updatedSegments[matchIdx] = {
            ...prevSeg,
            ...(preservedOriginalKhmer ? { originalKhmerText: preservedOriginalKhmer } : {}),
            khmerTranslatedText: cleanKhmer,
            khmerText: cleanKhmer,
            khmer: cleanKhmer,
            translationStyle,
            textStatus: "retranslated",
            audioOutdated: true,
          };
          completedIds.add(idKey);
        }
      }
    } catch (batchErr) {
      if (completedIds.size > 0 && batchErr && typeof batchErr === "object") {
        batchErr.partialSegments = updatedSegments;
        batchErr.completedIds = Array.from(completedIds);
        batchErr.completedCount = completedIds.size;
        batchErr.failedBatchIndex = Math.floor(i / BATCH_SIZE);
      }
      throw batchErr;
    }
  }

  const evaluatedSegments = detectDuplicateTranslations(updatedSegments);
  return evaluatedSegments;
}

module.exports = {
  DEFAULT_MODELS,
  SCRIPT_RESPONSE_SCHEMA,
  FAST_SCRIPT_RESPONSE_SCHEMA,
  KHMER_DUBBING_BASE_SYSTEM_PROMPT,
  systemPrompt,
  FAST_EXECUTION_SYSTEM_PROMPT,
  getGeminiClient,
  resolveValidModelName,
   safeParseOrRepairJson,
  parseTimeToSeconds,
  formatSecondsToTimecode,
  resolveGenerationMode,
  buildDialoguePrompt,
  buildRecapPrompt,
  buildSubtitlePrompt,
  buildCinemaPrompt,
  normalizeScriptData,
  generateStorytellingScript,
  retranslateSingleDialogue,
  retranslateBatchDialogues,
  isModelFallbackEligibleError,
  generateContentWithModelFallback,
  sanitizeKhmerDialogue,
  computeKhmerSimilarity,
  detectDuplicateTranslations,
};