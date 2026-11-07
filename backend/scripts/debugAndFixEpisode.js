/**
 * ឧបករណ៍ Debug & Auto-Fix ទូទៅ (Universal Episode Debug & Repair Tool)
 * ដំណើរការលើគ្រប់ប្រភេទរឿងទាំងអស់ (Modern CEO, Romance, Action/Crime, Xianxia, Period Drama, Comedy, etc.)
 * 
 * មុខងារស្នូល៖
 * 1. Gender Mismatch Detection (កែតម្រូវភេទសំឡេងស្រី SreymomNeural តាម F0 Pitch >= 172Hz, ឈ្មោះតួអង្គ, និងសព្វនាមស្ត្រីទូទៅ)
 * 2. Audio Timing Drift Correction (ទាញឃ្លាដែលរត់ហួសម៉ោងដើម ឬហួសប្រវែងវីដេអូមកពេលវេលាដើមវិញ)
 * 3. Dynamic Series Glossary / Pun Corrections (គាំទ្រការបញ្ជូនវចនានុក្រមប្រចាំរឿងពី seriesGlossary ឬ CLI)
 *
 * របៀបរត់៖ node backend/scripts/debugAndFixEpisode.js <path_to_json> [--fix] [--glossary <path_to_glossary.json>]
 */
const fs = require('fs');
const path = require('path');

// ពាក្យគន្លឹះភាសាចិន និងភាសាខ្មែរទូទៅសម្រាប់សម្គាល់តួស្រី (Universal Domain-Agnostic Cues)
const UNIVERSAL_FEMALE_CHINESE_CUES = [
  /奴家|臣妾|本姑娘|小女子|姑娘|小姐|夫人|太太|阿姨|姑姑|奶奶|妹妹|姐姐|女士|师姐|师妹|女侠|女总|女秘书|护士|医女|娘娘|公主|王妃/,
];

const UNIVERSAL_FEMALE_KHMER_CUES = [
  /តួស្រី|តួឯកស្រី|នាង|អ្នកនាង|កញ្ញា|លោកស្រី|អ្នកស្រី|ម៉ែ|ម្តាយ|ម្ដាយ|យាយ|ប្អូនស្រី|បងស្រី|ព្រះនាង|ក្មួយស្រី|ស្រី|អ្នកគ្រូ|គិលានុបដ្ឋាយិកា/,
];

function debugAndRepairSegments(segments = [], videoDurationSec = 375.37, applyFix = false, options = {}) {
  const customFemaleCues = options.customFemaleCues || [];
  const punCorrections = options.punCorrections || options.customGlossary || [];

  console.log(`\n================================================================================`);
  console.log(`🔍 ចាប់ផ្តើមត្រួតពិនិត្យសរុប ${segments.length} ឃ្លា (ប្រវែងវីដេអូ៖ ${videoDurationSec}s)`);
  console.log(`================================================================================`);

  let genderIssues = 0;
  let driftIssues = 0;
  let punIssues = 0;

  const repaired = segments.map((seg, idx) => {
    const updated = { ...seg };
    const id = updated.id || idx + 1;
    const cn = String(updated.originalChineseText || updated.chineseText || updated.original || '').trim();
    const km = String(updated.khmerTranslatedText || updated.khmerText || updated.khmer || '').trim();
    const startSec = Number(updated.startSec ?? updated.audioStartSec ?? 0);
    const sourceStartSec = Number(updated.sourceStartSec ?? startSec);
    const pitchHz = Number(updated.pitchHz || updated.acousticF0 || 0);

    // 1. ពិនិត្យបញ្ហា Gender Mismatch ដោយផ្អែកលើ F0 Acoustic Pitch និងសព្វនាមទូទៅ
    const hasAcousticFemale = pitchHz >= 172;
    const hasChineseFemale = UNIVERSAL_FEMALE_CHINESE_CUES.some((rx) => rx.test(cn)) ||
      customFemaleCues.some((rx) => rx.test(cn));
    const hasKhmerFemale = UNIVERSAL_FEMALE_KHMER_CUES.some((rx) => rx.test(updated.speaker || '')) ||
      UNIVERSAL_FEMALE_KHMER_CUES.some((rx) => rx.test(km));

    const isFemale = hasAcousticFemale || hasChineseFemale || hasKhmerFemale;
    const currentVoice = updated.voiceId || updated.khmerVoiceId || '';

    if (isFemale && (!currentVoice.includes('Sreymom') || updated.voiceGender !== 'female')) {
      genderIssues++;
      console.log(
        `⚠️ [GENDER MISMATCH] ឃ្លា #${id} (${startSec.toFixed(2)}s): ` +
        `អត្ថបទ="${cn}" | Pitch=${pitchHz || 'N/A'}Hz | Voice ចាស់=${currentVoice} (${updated.voiceGender})`
      );
      if (applyFix) {
        updated.voiceGender = 'female';
        updated.gender = 'female';
        updated.speakerGender = 'FEMALE';
        updated.speaker = updated.speaker === 'តួអង្គ' || updated.speaker === 'តួឯកប្រុស' ? 'តួឯកស្រី' : updated.speaker;
        updated.speakerId = updated.speakerId && updated.speakerId.includes('spk_female') ? updated.speakerId : `spk_female_${id}`;
        updated.voiceId = 'km-KH-SreymomNeural';
        updated.khmerVoiceId = 'km-KH-SreymomNeural';
        updated.voice = 'km-KH-SreymomNeural';
        updated.audioOutdated = true;
      }
    }

    // 2. ពិនិត្យបញ្ហា Audio Timing Drift (ឃ្លារត់ហួសម៉ោងដើម ឬហួសប្រវែងវីដេអូ)
    const driftSec = Math.abs(startSec - sourceStartSec);
    const isPastVideoEnd = videoDurationSec > 0 && (startSec >= videoDurationSec || (updated.endSec || 0) > videoDurationSec + 0.5);

    if (driftSec > 1.2 || isPastVideoEnd) {
      driftIssues++;
      console.log(
        `🚨 [TIMING DRIFT] ឃ្លា #${id}: startSec=${startSec.toFixed(2)}s ខុសពី sourceStartSec=${sourceStartSec.toFixed(2)}s ` +
        `(Drift: +${(startSec - sourceStartSec).toFixed(2)}s${isPastVideoEnd ? ' | ហួសប្រវែងវីដេអូ!' : ''})`
      );
      if (applyFix) {
        const nextSeg = segments[idx + 1];
        const nextSourceStart = nextSeg ? Number(nextSeg.sourceStartSec ?? nextSeg.startSec ?? (sourceStartSec + 2.5)) : videoDurationSec;
        const maxSlot = Math.max(0.6, nextSourceStart - sourceStartSec - 0.05);
        const origDur = Math.max(0.8, Number(updated.sourceEndSec || (sourceStartSec + 2.0)) - sourceStartSec);
        const safeDur = Math.min(origDur, maxSlot);

        updated.startSec = parseFloat(sourceStartSec.toFixed(2));
        updated.audioStartSec = updated.startSec;
        updated.endSec = parseFloat(Math.min(videoDurationSec, sourceStartSec + safeDur).toFixed(2));
        updated.audioEndSec = updated.endSec;
        updated.duration = parseFloat((updated.endSec - updated.startSec).toFixed(2));
        updated.userShifted = false;
      }
    }

    // 3. ពិនិត្យបញ្ហាបកប្រែតាម Dynamic Series Pun/Glossary (បើមានកំណត់ក្នុង Options ឬ File)
    for (const rule of punCorrections) {
      const matchCn = rule.matchChinese ? (rule.matchChinese instanceof RegExp ? rule.matchChinese.test(cn) : cn.includes(rule.matchChinese)) : false;
      const matchKm = rule.matchKhmer ? (rule.matchKhmer instanceof RegExp ? rule.matchKhmer.test(km) : km.includes(rule.matchKhmer)) : false;

      if (matchCn || matchKm) {
        punIssues++;
        console.log(`📝 [PUN / GLOSSARY FIX] ឃ្លា #${id}: "${cn}" | បកប្រែចាស់="${km}" ➔ ថ្មី="${rule.replaceKhmer}"`);
        if (applyFix) {
          updated.khmerTranslatedText = rule.replaceKhmer;
          updated.khmerText = rule.replaceKhmer;
          updated.khmer = rule.replaceKhmer;
          updated.audioOutdated = true;
        }
      }
    }

    return updated;
  });

  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`📊 សរុបលទ្ធផល Debug:`);
  console.log(`   - ច្រឡំភេទសំឡេង (Gender Mismatches): ${genderIssues} ឃ្លា`);
  console.log(`   - រត់ខុសម៉ោងវីដេអូ (Timing Drift / Overflow): ${driftIssues} ឃ្លា`);
  console.log(`   - កែវចនានុក្រម / ពាក្យលេងសើច (Custom Pun/Glossary): ${punIssues} ឃ្លា`);
  console.log(`--------------------------------------------------------------------------------\n`);

  return repaired;
}

if (require.main === module) {
  const targetFile = process.argv[2];
  const shouldFix = process.argv.includes('--fix');
  if (!targetFile || !fs.existsSync(targetFile)) {
    console.log('Usage: node backend/scripts/debugAndFixEpisode.js <path_to_json> [--fix] [--glossary <path_to_glossary.json>]');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  const segments = raw.segments || raw.scriptData?.segments || raw.finalResult?.segments || [];
  const duration = raw.duration || raw.pipelineMeta?.durationSec || raw.totalDurationSec || 375.37;

  let punCorrections = [];
  const glossaryIdx = process.argv.indexOf('--glossary');
  if (glossaryIdx !== -1 && process.argv[glossaryIdx + 1] && fs.existsSync(process.argv[glossaryIdx + 1])) {
    try {
      const gData = JSON.parse(fs.readFileSync(process.argv[glossaryIdx + 1], 'utf8'));
      punCorrections = Array.isArray(gData) ? gData : (gData.punCorrections || gData.glossary || []);
    } catch (e) {
      console.warn(`[debugAndFixEpisode] Failed to load custom glossary:`, e.message);
    }
  } else if (raw.seriesGlossary?.punCorrections) {
    punCorrections = raw.seriesGlossary.punCorrections;
  }

  const fixedSegments = debugAndRepairSegments(segments, duration, shouldFix, { punCorrections });

  if (shouldFix && fixedSegments.length > 0) {
    if (raw.segments) raw.segments = fixedSegments;
    if (raw.scriptData?.segments) raw.scriptData.segments = fixedSegments;
    if (raw.finalResult?.segments) raw.finalResult.segments = fixedSegments;
    fs.writeFileSync(targetFile, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`✅ បានរក្សាទុកការជួសជុលទៅក្នុង៖ ${targetFile}`);
  }
}

module.exports = { debugAndRepairSegments, UNIVERSAL_FEMALE_CHINESE_CUES, UNIVERSAL_FEMALE_KHMER_CUES };
