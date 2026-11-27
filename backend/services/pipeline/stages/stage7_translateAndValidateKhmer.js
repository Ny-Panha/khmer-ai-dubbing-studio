const {
  stripPunctuationForSpeech,
  isExplicitFillerKhmer,
  containsChineseHanzi,
  containsForeignScriptLeak,
  isExpressiveVocalizationSource,
  isPureDescriptiveSoundLabel,
} = require('../../../utils/translationQuality');
const { validateStrictSourceCueMapping } = require('../pipelineTypes');

/**
 * Stage 7: Translate and Validate Khmer
 * Preserves Chinese source text, links Khmer translation to segment ID & sourceCueId,
 * verifies semantic completeness, and flags uncertain OCR or missing translations.
 * 
 * @param {object} params
 * @param {Array} params.scriptSegments
 * @param {Array|null} [params.sourceCues=null]
 * @param {string} [params.mode='dialogue']
 * @returns {Promise<{ validatedSegments: Array, validationReport: object }>}
 */
async function translateAndValidateKhmer({ scriptSegments = [], sourceCues = null, mode = 'dialogue' }) {
  const validatedSegments = [];
  let reviewNeededCount = 0;
  let translatedCount = 0;
  let missingTranslationCount = 0;

  const missingCueIds = [];
  const invalidTimingCueIds = [];
  const seenCueIds = new Set();
  const duplicateCueIds = [];
  for (let idx = 0; idx < scriptSegments.length; idx++) {
    const seg = { ...scriptSegments[idx] };
    const cid = String(seg.sourceCueId || '').trim();
    if (cid) {
      if (seenCueIds.has(cid)) {
        duplicateCueIds.push(cid);
        seg.reviewNeeded = true;
      } else {
        seenCueIds.add(cid);
      }
    }
    const origChinese = String(seg.originalChineseText || seg.originalText || '').trim();
    let khmerText = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || '').trim();
    const hadThaiOrLaoBeforeClean = /[\u0E00-\u0EFF]/.test(khmerText);

    // Purge any accidental Thai/Lao characters or loanwords from Khmer translation
    if (khmerText) {
      khmerText = khmerText
        .replace(/ไอ้/g, "អា").replace(/ออกมานี่/g, "ចេញមកនេះ").replace(/ออกมา/g, "ចេញមក").replace(/អ្នក?ผู้?บรรยาย/g, "អ្នករៀបរាប់")
        .replace(/บรรยาย/g, "រៀបរាប់")
        .replace(/ยาก/g, "ពិបាក")
        .replace(/มั่ง/g, "ខ្លះ")
        .replace(/มึง/g, "ឯង").replace(/กู/g, "អញ").replace(/[\u0E00-\u0E7F]+/g, "").replace(/[\u0E80-\u0EFF]+/g, "").replace(/\s{2,}/g, " ")
        .trim();
    }
    if (seg.speaker) {
      seg.speaker = seg.speaker.replace(/អ្នក?ผู้?บรรยาย/g, "អ្នករៀបរាប់").replace(/บรรยาย/g, "រៀបរាប់").replace(/[\u0E00-\u0E7F]+/g, "").replace(/[\u0E80-\u0EFF]+/g, "").trim() || "អ្នករៀបរាប់";
    }
    if (seg.speakerName) {
      seg.speakerName = seg.speakerName.replace(/អ្នក?ผู้?บรรยาย/g, "អ្នករៀបរាប់").replace(/บรรยาย/g, "រៀបរាប់").replace(/[\u0E00-\u0E7F]+/g, "").replace(/[\u0E80-\u0EFF]+/g, "").trim() || "អ្នករៀបរាប់";
    }

    const errors = [];

    const rawKhmerBeforeFilter = khmerText;
    const isPlaceholderKhmer = isExplicitFillerKhmer(khmerText);
    const isPunctuationOnlyKhmer = Boolean(khmerText) && !stripPunctuationForSpeech(khmerText);
    const hasChineseLeak = Boolean(khmerText) && containsChineseHanzi(khmerText);
    const hasForeignLeak = Boolean(khmerText) && containsForeignScriptLeak(khmerText);
    const isDescriptiveSoundSubstitution = Boolean(
      origChinese &&
      khmerText &&
      isExpressiveVocalizationSource(origChinese) &&
      isPureDescriptiveSoundLabel(khmerText)
    );
    const hasAnyKhmerChar = /[\u1780-\u17FF]/.test(khmerText);
    if (isPlaceholderKhmer || isPunctuationOnlyKhmer || (hasChineseLeak && !hasAnyKhmerChar)) {
      khmerText = '';
    }

    // Ensure Chinese source text is preserved
    seg.originalChineseText = origChinese;
    seg.originalText = origChinese;
    seg.original = origChinese;

    // Ensure Khmer translation is preserved across all aliases
    seg.khmerTranslatedText = khmerText;
    seg.khmerText = khmerText;
    seg.khmer = khmerText;

    if (!khmerText) {
      missingTranslationCount++;
      missingCueIds.push(seg.sourceCueId || seg.segmentId || idx + 1);
      seg.translationStatus = 'review_needed';
      seg.reviewNeeded = true;
      errors.push(
        isPlaceholderKhmer
          ? `រកឃើញអត្ថបទជំនួស "${rawKhmerBeforeFilter}" ដែលមិនទាន់បកប្រែពិតប្រាកដ (ត្រូវការ Review ឬបកប្រែឡើងវិញ)`
          : hasChineseLeak
            ? `រកឃើញតួអក្សរចិននៅសល់ "${rawKhmerBeforeFilter}" ដោយមិនទាន់បកប្រែជាខ្មែរ (Chinese Hanzi Leak — ត្រូវបកប្រែឡើងវិញ)`
            : hadThaiOrLaoBeforeClean
              ? 'រកឃើញតួអក្សរថៃ/ឡាវ ហើយបន្ទាប់ពីលុបចេញគ្មានអត្ថបទខ្មែរនៅសល់ (Thai/Lao Leak — ត្រូវបកប្រែឡើងវិញ)'
              : isPunctuationOnlyKhmer
                ? 'រកឃើញអត្ថបទមានតែសញ្ញាវណ្ណយុត្តិ (គ្មានពាក្យអានជាសំឡេង — ត្រូវការ Review ឬបកប្រែឡើងវិញ)'
                : 'មិនទាន់មានអត្ថបទបកប្រែជាភាសាខ្មែរឡើយ (ត្រូវការ Review)'
      );
    } else if (hasChineseLeak || hasForeignLeak) {
      missingTranslationCount++;
      missingCueIds.push(seg.sourceCueId || seg.segmentId || idx + 1);
      seg.translationStatus = 'review_needed';
      seg.reviewNeeded = true;
      errors.push(
        hasChineseLeak
          ? `រកឃើញតួអក្សរចិនលាយក្នុងអត្ថបទខ្មែរ "${khmerText}" (Chinese Hanzi Leak — ត្រូវបកប្រែជាខ្មែរ ១០០%)`
          : `រកឃើញតួអក្សរបរទេសលាយក្នុងអត្ថបទខ្មែរ "${khmerText}" (Foreign Script Leak — ត្រូវបកប្រែជាខ្មែរ ១០០%)`
      );
    } else if (isDescriptiveSoundSubstitution) {
      missingTranslationCount++;
      missingCueIds.push(seg.sourceCueId || seg.segmentId || idx + 1);
      seg.translationStatus = 'review_needed';
      seg.reviewNeeded = true;
      errors.push(`ប្រើពាក្យពណ៌នា "${khmerText}" ជំនួសសំឡេងពិត "${origChinese}" (ត្រូវបកប្រែជាសំឡេងខ្មែរធម្មជាតិសម្រាប់ TTS)`);
    } else {
      translatedCount++;
      seg.translationStatus = seg.translationStatus === 'review_needed' ? 'translated' : (seg.translationStatus || 'translated');
      if (hadThaiOrLaoBeforeClean) {
        seg.validationWarnings = [...(seg.validationWarnings || []), 'បានសម្អាតតួអក្សរថៃ/ឡាវចេញពីអត្ថបទបកប្រែ'];
      }
    }

    // Validate start/end timing invariant
    const hasValidTiming =
      typeof seg.startSec === 'number' &&
      Number.isFinite(seg.startSec) &&
      seg.startSec >= 0 &&
      typeof seg.endSec === 'number' &&
      Number.isFinite(seg.endSec) &&
      seg.endSec > seg.startSec;
    if (!hasValidTiming) {
      invalidTimingCueIds.push(seg.sourceCueId || seg.segmentId || idx + 1);
      seg.reviewNeeded = true;
      seg.uncertainTiming = true;
      errors.push(`Timing មិនត្រឹមត្រូវ (startSec=${seg.startSec}, endSec=${seg.endSec})`);
    }

    // Flag uncertain OCR source
    if (seg.uncertainOcr) {
      seg.reviewNeeded = true;
      errors.push('អក្សរចិនដើមមិនសូវច្បាស់ ឬព្រិល (Uncertain OCR)');
    }

    seg.reviewNeeded = Boolean(seg.reviewNeeded);
    if (seg.reviewNeeded) {
      reviewNeededCount++;
    }

    seg.validationErrors = [...(seg.validationErrors || []), ...errors];
    validatedSegments.push(seg);
  }

  const totalSegs = validatedSegments.length;
  const translationCompletenessPct = totalSegs > 0
    ? parseFloat(((translatedCount / totalSegs) * 100).toFixed(2))
    : 0;
  const hasBaselineCues = Array.isArray(sourceCues) && sourceCues.length > 0 && sourceCues.some((c) => Boolean(c?.sourceCueId));
  const strictMapping = hasBaselineCues
    ? validateStrictSourceCueMapping(sourceCues, validatedSegments)
    : null;
  const oneToOneMappingValid = strictMapping
    ? Boolean(strictMapping.valid && missingTranslationCount === 0 && duplicateCueIds.length === 0 && invalidTimingCueIds.length === 0)
    : Boolean(totalSegs > 0 && missingTranslationCount === 0 && duplicateCueIds.length === 0 && invalidTimingCueIds.length === 0);

  return {
    validatedSegments,
    validationReport: {
      totalSegments: totalSegs,
      translatedCount,
      missingTranslationCount,
      missingCueIds: strictMapping ? [...new Set([...missingCueIds, ...strictMapping.missingSourceCueIds, ...strictMapping.invalidTranslationCueIds])] : missingCueIds,
      duplicateCueIds: strictMapping ? strictMapping.duplicateSourceCueIds : duplicateCueIds,
      unexpectedCueIds: strictMapping ? strictMapping.unexpectedSourceCueIds : [],
      mismatchedCueIds: strictMapping ? strictMapping.mismatchedOrderCueIds : [],
      invalidTimingCueIds,
      exactCueIdSetMatch: strictMapping ? strictMapping.exactCueIdSetMatch : null,
      translationCompletenessPct,
      oneToOneMappingValid,
      reviewNeededCount,
      mode,
    },
  };
}

module.exports = {
  translateAndValidateKhmer,
};
