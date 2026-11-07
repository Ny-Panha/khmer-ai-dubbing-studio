/**
 * ឧបករណ៍ Debug & Auto-Fix សម្រាប់ត្រួតពិនិត្យបញ្ហា៖
 * 1. Gender Mismatch (តួស្រីតែជាប់សំឡេងប្រុស PisethNeural)
 * 2. Audio Timing Drift (ឃ្លារត់ហួសម៉ោងដើម ឬហួសប្រវែងវីដេអូ ដូចឃ្លា #88-#98)
 * 3. Pun / Keyword Mistranslation (ឧ. "那叫你爸戒" -> "ហៅខ្ញុំថាប៉ាឆា")
 *
 * របៀបរត់៖ node backend/scripts/debugAndFixEpisode.js <path_to_series.json_or_checkpoint.json> [--fix]
 */
const fs = require('fs');
const path = require('path');

const FEMALE_CHINESE_CUES = [
  /二师兄/,           // ហៅសិស្សច្បងទីពីរ (ប៉ាជៀ) ក្នុងឈុតសន្ទនាតួស្រី
  /我没有拜师/,       // នាងនៀនអាននិយាយទៅកាន់ប៉ាជៀ
  /我要是留下/,       // "បើខ្ញុំសុំនៅទីនេះ..."
  /元神都快散了/,     // "មើលខ្លួនឯងសិនផង ដួងវិញ្ញាណជិតរលាយហើយ"
  /奴家|臣妾|本姑娘|小女子/,
];

const PUN_CORRECTIONS = [
  {
    matchChinese: /爸戒/,
    matchKhmer: /ប៉ាឆា/,
    replaceKhmer: 'អ៊ីចឹងហៅបងថាប៉ាជៀតែម្ដងទៅ!',
  },
];

function debugAndRepairSegments(segments = [], videoDurationSec = 375.37, applyFix = false) {
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

    // 1. ពិនិត្យបញ្ហា Gender Mismatch
    const hasFemaleCue = FEMALE_CHINESE_CUES.some((rx) => rx.test(cn)) ||
      /តួស្រី|តួឯកស្រី|នាង/.test(updated.speaker || '') ||
      (pitchHz >= 172);
    const currentVoice = updated.voiceId || updated.khmerVoiceId || '';

    if (hasFemaleCue && (!currentVoice.includes('Sreymom') || updated.voiceGender !== 'female')) {
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
        updated.speakerId = `spk_female_${id}`;
        updated.voiceId = 'km-KH-SreymomNeural';
        updated.khmerVoiceId = 'km-KH-SreymomNeural';
        updated.voice = 'km-KH-SreymomNeural';
        updated.audioOutdated = true;
      }
    }

    // 2. ពិនិត្យបញ្ហា Audio Timing Drift (ឧ. ឃ្លា #88-#98 រត់ហួសម៉ោងដើម ឬហួសវីដេអូ 06:15.37)
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

    // 3. ពិនិត្យបញ្ហាបកប្រែពាក្យលេងសើច (Pun Translation)
    for (const rule of PUN_CORRECTIONS) {
      if (rule.matchChinese.test(cn) || rule.matchKhmer.test(km)) {
        punIssues++;
        console.log(`📝 [PUN FIX] ឃ្លា #${id}: "${cn}" | បកប្រែចាស់="${km}" ➔ ថ្មី="${rule.replaceKhmer}"`);
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
  console.log(`   - ខុសពាក្យលេងសើច (Pun Mistranslations): ${punIssues} ឃ្លា`);
  console.log(`--------------------------------------------------------------------------------\n`);

  return repaired;
}

if (require.main === module) {
  const targetFile = process.argv[2];
  const shouldFix = process.argv.includes('--fix');
  if (!targetFile || !fs.existsSync(targetFile)) {
    console.log('Usage: node backend/scripts/debugAndFixEpisode.js <path_to_json> [--fix]');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  const segments = raw.segments || raw.scriptData?.segments || raw.finalResult?.segments || [];
  const duration = raw.duration || raw.pipelineMeta?.durationSec || raw.totalDurationSec || 375.37;
  const fixedSegments = debugAndRepairSegments(segments, duration, shouldFix);

  if (shouldFix && fixedSegments.length > 0) {
    if (raw.segments) raw.segments = fixedSegments;
    if (raw.scriptData?.segments) raw.scriptData.segments = fixedSegments;
    if (raw.finalResult?.segments) raw.finalResult.segments = fixedSegments;
    fs.writeFileSync(targetFile, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`✅ បានរក្សាទុកការជួសជុលទៅក្នុង៖ ${targetFile}`);
  }
}

module.exports = { debugAndRepairSegments };
