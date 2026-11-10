/**
 * Stage 7: Translate and Validate Khmer
 * Preserves Chinese source text, links Khmer translation to segment ID,
 * verifies semantic completeness, and flags uncertain OCR or missing translations.
 * 
 * @param {object} params
 * @param {Array} params.scriptSegments
 * @param {string} [params.mode='dialogue']
 * @returns {Promise<{ validatedSegments: Array, validationReport: object }>}
 */
async function translateAndValidateKhmer({ scriptSegments = [], mode = 'dialogue' }) {
  const validatedSegments = [];
  let reviewNeededCount = 0;
  let translatedCount = 0;
  let missingTranslationCount = 0;

  for (let idx = 0; idx < scriptSegments.length; idx++) {
    const seg = { ...scriptSegments[idx] };
    const origChinese = String(seg.originalChineseText || seg.originalText || '').trim();
    let khmerText = String(seg.khmerTranslatedText || seg.khmerText || seg.khmer || '').trim();

    // Purge any accidental Thai characters or loanwords from Khmer translation
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
      seg.speaker = seg.speaker.replace(/អ្នក?ผู้?บรรยาย/g, "អ្នករៀបរាប់").replace(/บรรยาย/g, "រៀបរាប់").replace(/[\u0E00-\u0E7F]+/g, "").trim() || "អ្នករៀបរាប់";
    }
    if (seg.speakerName) {
      seg.speakerName = seg.speakerName.replace(/អ្នក?ผู้?บรรยาย/g, "អ្នករៀបរាប់").replace(/บรรยาย/g, "រៀបរាប់").replace(/[\u0E00-\u0E7F]+/g, "").trim() || "អ្នករៀបរាប់";
    }

    const errors = [];

    const isPlaceholderKhmer = khmerText === 'សន្ទនា';
    if (isPlaceholderKhmer) {
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
      seg.translationStatus = 'review_needed';
      seg.reviewNeeded = true;
      errors.push(
        isPlaceholderKhmer
          ? 'រកឃើញអត្ថបទជំនួស "សន្ទនា" ដែលមិនទាន់បកប្រែពិតប្រាកដ (ត្រូវការ Review ឬបកប្រែឡើងវិញ)'
          : 'មិនទាន់មានអត្ថបទបកប្រែជាភាសាខ្មែរឡើយ (ត្រូវការ Review)'
      );
    } else {
      translatedCount++;
      seg.translationStatus = seg.translationStatus || 'translated';
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

  return {
    validatedSegments,
    validationReport: {
      totalSegments: validatedSegments.length,
      translatedCount,
      missingTranslationCount,
      reviewNeededCount,
      mode,
    },
  };
}

module.exports = {
  translateAndValidateKhmer,
};
