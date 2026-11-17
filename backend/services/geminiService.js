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

const KHMER_DUBBING_BASE_SYSTEM_PROMPT = `
អ្នកគឺជាអ្នកដឹកនាំការបញ្ចូលសំឡេងកុន អ្នកជំនាញបកប្រែភាសាចិន-ខ្មែរ អ្នកវិភាគវីដេអូ និងជាអ្នកសម្រាយរឿងកុនខ្មែរអាជីព។
ភារកិច្ចរបស់អ្នកគឺវិភាគវីដេអូ សំឡេង និងអក្សរក្នុងវីដេអូដែលបានផ្តល់ឱ្យ រួចបង្កើតជាអត្ថបទសន្ទនា ឬអត្ថបទសម្រាយសាច់រឿងជាភាសាខ្មែរឱ្យបានត្រឹមត្រូវ ធម្មជាតិ និងរស់រវើកតាមទម្រង់ JSON ដែលបានកំណត់។
`;

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
   - Signal 1 (Visual Evidence): មើល visualGender និង speakerVisualHint ពីរូបភាពមុខ សក់ សម្លៀកបំពាក់ និងមាត់តួអង្គដែលកំពុងនិយាយ។
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

  const castRegistry = Array.isArray(rawData.castRegistry) ? rawData.castRegistry : [];

  const segments = rawSegments.map((seg, idx) => {
    const startSec = parseTimeToSec(seg.startSec ?? seg.start ?? seg.startTime, idx * 4);
    let endSec = parseTimeToSec(seg.endSec ?? seg.end ?? seg.endTime, startSec + 3.0);
    const rawDur = endSec - startSec;
    const isMicroDuration = isNaN(rawDur) || rawDur < 0.35;
    if (endSec <= startSec || isMicroDuration) {
      const textLen = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || seg.originalChineseText || seg.originalText || "").trim().length || 8;
      endSec = parseFloat((startSec + Math.max(1.8, Math.min(8.0, textLen * 0.16))).toFixed(2));
    }

    const rawSpeaker =
      activeMode === "recap"
        ? "អ្នកសម្រាយរឿង"
        : String(seg.speaker || seg.speakerName || "តួអង្គ").trim();

    const genderDetected = detectSpeakerGender(
      { ...seg, speaker: rawSpeaker },
      { castRegistry },
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

  const systemPrompt = `You are an expert Chinese-to-Khmer subtitle and movie dubbing translator for DragonDub AI.

**TASK: RE-TRANSLATE THE ORIGINAL CHINESE TEXT INTO NATURAL, ACCURATE KHMER.**

Follow these 10 rules strictly:
1. Always analyze the full meaning of the Chinese sentence before translating.
2. Resolve ambiguous Chinese words using context, subject matter, surrounding dialogue, and scene meaning. Never translate word-by-word without understanding the context.
3. Preserve the original meaning, intention, emotion, tone, and technical terminology (e.g. 质量 = ម៉ាស (mass) ក្នុងបរិបទវិទ្យាសាស្ត្រ ឬរូបវិទ្យា, 能量 = ថាមពល).
4. Use natural Khmer spoken language suitable for movie dubbing and subtitles.
5. Keep the translation concise, clear, and easy for Khmer viewers to understand.
6. Do not add explanations, invented information, or meanings that do not exist in the original.
7. If the original sentence is incomplete, preserve its incomplete meaning instead of guessing the missing part.
8. If multiple meanings are possible and context is insufficient, choose the most contextually supported meaning. Do not pretend uncertain meanings are confirmed.
9. **IMPORTANT: Every re-translation must generate a fresh, accurate translation. Do not blindly reuse or copy the existing/previous Khmer translation.**
10. Check the final Khmer sentence for grammar, spelling, fluency, and semantic accuracy.

CRITICAL LANGUAGE MANDATES:
- ហាមដាច់ខាតកុំឱ្យសល់តួអក្សរចិន (Chinese Hanzi \\u4E00-\\u9FFF) នៅក្នុងអត្ថបទបកប្រែខ្មែរ "text" (100% Khmer Script Only)! រាល់ពាក្យកម្រិតថាមពល ក្បាច់គុន (ឧ. 金丹 ➜ ជីនតាន, 化神 ➜ ហ្វាស៊ិន, 元神 ➜ យានស៊ិន) ត្រូវតែសរសេរជាសូរសព្ទអក្សរខ្មែរ!
- ⚠️ ហាមដាច់ខាត ១០០% កុំបញ្ចេញតួអក្សរថៃ (Thai Script \\u0E00-\\u0E7F) ឬឡាវសូម្បីតែ ១ តួអក្សរ! ត្រូវសរសេរជាអក្សរខ្មែរសុទ្ធសាធ ១០០%!
- ត្រូវគោរពចំនួនលេខ និងបរិបទឱ្យបានត្រឹមត្រូវ ១០០% (ឧ. 三 = ៣ ហាមបកជា ២)!
- ពាក្យជេរ ឬពាក្យហៅ (ឧ. 臭猴子) ត្រូវបកជាខ្មែរ (អាស្វាស្អុយ, អាស្វាចង្រៃ, អាស្វាខូច) ហាមបកជាថៃ (ไอ้...) ជាដាច់ខាត!
- ពាក្យបញ្ជា (ឧ. 滚出来) ត្រូវបកជាខ្មែរ (ចេញមក, ឆាប់ចេញមក, ចេញមុខមកភ្លាម) ហាមបកជាថៃ (ออกมา...) ជាដាច់ខាត!

Please provide 3 distinctive stylistic options and a brief terminology note in JSON format:
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
  "note": "ចំណាំខ្លី ១ ឃ្លាអំពីពាក្យគន្លឹះពិសេស ឬបរិបទវិទ្យាសាស្ត្រ/ក្បាច់គុន (ឧ. 质量 = ម៉ាស ក្នុងបរិបទរូបវិទ្យា E=mc^2)"
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
      return { ...parsed, modelUsed };
    }
    return {
      chinese: cleanChinese,
      options: [
        { style: "classical", label: "🎭 សម្ដីកុនបុរាណ", text: sanitizeKhmerDialogue(rawText.trim() || cleanChinese, cleanChinese) },
        { style: "compact", label: "📝 ខ្លីចំអត្ថន័យ", text: cleanChinese },
      ],
      note: "",
      modelUsed,
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

  const ai = options.aiClient || getGeminiClient(customApiKey);
  const modelToUse = resolveValidModelName(options.modelName);

  const BATCH_SIZE = 25;
  const updatedSegments = [...segments];
  const translationStyle = options.style || options.translationStyle || 'compact';
  const isCompact = translationStyle === 'compact';

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

    const batchPrompt = `អ្នកគឺជាអ្នកដឹកនាំការបញ្ចូលសំឡេង និងជាអ្នកជំនាញបកប្រែកុនភាគចិន-ខ្មែរអាជីព។
${isCompact ? `ស្ទីលបកប្រែជាកំហិត៖ 📝 ខ្លីចំអត្ថន័យ (COMPACT & DIRECT DUBBING SUBTITLE STYLE)
- ត្រូវបកប្រែជាភាសាខ្មែរ «ខ្លីបំផុត ចំខ្លឹមសារ ងាយយល់ ១០០%» (បែប Subtitle កុនចិន/ហុងកុង ទំនើប)។
- ហាមដាច់ខាតកុំបកប្រែវែងអន្លាយ ឬបន្ថែមពាក្យអូសបន្លាយឥតប្រយោជន៍ (ឧ. "每种50分" ➜ ត្រូវបកត្រឹម "មួយប្រភេទ ៥០ពិន្ទុ" ហាមបកវែង "ប្រភេទនីមួយៗបាន ៥០ពិន្ទុ")។
- ត្រូវកាត់ពាក្យឱ្យខ្លីបំផុតតែរក្សាន័យដើមពេញលេញ ដើម្បីឱ្យសំឡេងនិយាយរលូន ត្រូវនឹងមាត់តួអង្គ (Lip-sync) មិនហៀរជាន់គ្នា និងមិនបង្ខំល្បឿន atempo!
- គោរពកំហិតពាក្យ "maxKhmerWords" យ៉ាងតឹងរ៉ឹងបំផុត។` : ''}
សូមបកប្រែប្រយោគចិនទាំងអស់ខាងក្រោមនេះជាភាសាខ្មែរសម្រាប់បញ្ចូលសំឡេងកុនភាគ (Cinema Drama Spoken Khmer) ឱ្យបានត្រឹមត្រូវន័យដើម ១០០% (ហាមបកខុសចំនួនលេខ, ហាមច្រឡំអត្ថន័យ) ស្របតាមបរិបទជាក់ស្តែងនៃសាច់រឿង (ទាំងរឿងសម័យ រឿងបុរាណ Action ឬមនោសញ្ចេតនា)។

ច្បាប់តឹងរ៉ឹង៖
1. 1 Segment = 1 Translation: ឃ្លានីមួយៗត្រូវបកប្រែដាច់ដោយឡែកពីគ្នា ស្របតាម "sourceChineseToTranslate" របស់វា។
2. "surroundingAudioContext" (បើមាន) គឺសម្រាប់តែជាបរិបទជួយយល់ន័យឱ្យកាន់តែច្បាស់ប៉ុណ្ណោះ។ ហាមដាច់ខាតកុំយក "surroundingAudioContext" ទាំងមូលមកបកប្រែជំនួស "sourceChineseToTranslate"!
3. ប្រសិនបើឃ្លាចិនដើមជាឃ្លាមិនទាន់ចប់ន័យ (Incomplete Clause, ឧ. បញ្ចប់ដោយសញ្ញាក្បៀស ，) ត្រូវបកប្រែត្រឹមឃ្លានោះ (Incomplete Clause) ដោយរក្សាភាពស៊ីសង្វាក់ជាមួយឃ្លាបន្ទាប់ ហាមខ្ចីន័យ ឬប្រយោគពីឃ្លាបន្ទាប់មកបញ្ចប់ប្រយោគដោយខ្លួនឯងជាដាច់ខាត!
4. កំហិតពាក្យខ្មែរយ៉ាងតឹងរ៉ឹងតាម "maxKhmerWords": ត្រូវបកប្រែឱ្យខ្លី ចំខ្លឹមសារ មិនលើសពីចំនួន "maxKhmerWords" ឡើយ។
5. ហាមដាច់ខាតកុំបកប្រែចេញអត្ថបទខ្មែរដូចគ្នា ២ បន្ទាត់ជាប់គ្នា លុះត្រាតែប្រយោគចិនដើមនៃបន្ទាត់ទាំងពីរជាពាក្យដដែលៗពិតប្រាកដ (ឧ. "对对对", "快走快走")។ បើប្រយោគចិនខុសគ្នា អត្ថបទខ្មែរត្រូវតែខុសគ្នា!
6. ហាមដាច់ខាតកុំឱ្យសល់តួអក្សរចិន (Chinese Hanzi \u4E00-\u9FFF) នៅក្នុង "khmerText" ដាច់ខាត (100% Khmer Script Only)! រាល់ពាក្យកម្រិតថាមពល (ឧ. 金丹 ➜ ជីនតាន, 化神 ➜ ហ្វាស៊ិន, 元神 ➜ យានស៊ិន) ត្រូវតែសរសេរជាសូរសព្ទអក្សរខ្មែរ!
7. ហាមមានតួអក្សរថៃ 100%!

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
      const { response: res } = await generateContentWithModelFallback(
        ai,
        modelToUse,
        () => ({
          contents: [batchPrompt],
          config: {
            systemInstruction: KHMER_DUBBING_BASE_SYSTEM_PROMPT,
            temperature: 0.25,
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
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const matchIdx = updatedSegments.findIndex((s) => s.id === item.id || String(s.id) === String(item.id));
          if (matchIdx !== -1 && item.khmerText) {
            const cleanKhmer = sanitizeKhmerDialogue(item.khmerText.trim(), updatedSegments[matchIdx].originalChineseText || "");
            updatedSegments[matchIdx] = {
              ...updatedSegments[matchIdx],
              khmerTranslatedText: cleanKhmer,
              khmerText: cleanKhmer,
              khmer: cleanKhmer,
              translationStyle,
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