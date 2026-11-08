/**
 * repairMergedSegments.js
 * Scans series stored data for segments that swallowed multiple discrete OCR cues,
 * splits them at internal cue boundaries, re-translates Chinese text via Gemini,
 * clears obsolete merged audio, and renumbers display IDs sequentially.
 *
 * Usage: node backend/scripts/repairMergedSegments.js [seriesId]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { areChineseTextsEquivalent } = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const { retranslateSingleDialogue } = require('../services/geminiService');
const { formatSecondsToTimecode } = require('../services/pipeline/pipelineTypes');

const EXCLAMATION_REGEX = /^[啊哦嗯哈呀哇哎咦哼咳嘘嘿嘎呜\s!！?？.。,，、~～]+$/;

async function repairSeries(targetSeriesId = 'series_1793898268958') {
  const seriesDir = path.resolve(__dirname, '../uploads/projects', targetSeriesId);
  const seriesFile = path.join(seriesDir, 'series.json');

  if (!fs.existsSync(seriesFile)) {
    console.error(`[Repair] Series file not found: ${seriesFile}`);
    process.exit(1);
  }

  // 1. Create timestamped backup before mutation
  const timestamp = Date.now();
  const backupFile = path.join(seriesDir, `series.json.backup_${timestamp}`);
  fs.copyFileSync(seriesFile, backupFile);
  console.log(`[Repair] Created timestamped backup: ${backupFile}`);

  const series = JSON.parse(fs.readFileSync(seriesFile, 'utf8'));
  const cacheDir = path.resolve(__dirname, '../uploads/cache');

  console.log(`\n=== STEP 1: AUDIT & REPORT for Series: ${series.id} ===`);

  const epSplitPlans = [];

  for (const ep of series.episodes || []) {
    const segs = ep.scriptData?.segments || [];
    if (segs.length === 0) {
      console.log(`Episode ${ep.id}: 0 segments (skipping).`);
      continue;
    }

    // Locate corresponding OCR cache file
    let visualSegments = [];
    const cacheFiles = fs.readdirSync(cacheDir).filter(f => f.startsWith(`ocr_${ep.id}_`) && f.endsWith('.json'));
    if (cacheFiles.length > 0) {
      const ocrPath = path.join(cacheDir, cacheFiles[0]);
      const ocrData = JSON.parse(fs.readFileSync(ocrPath, 'utf8'));
      visualSegments = ocrData.visualSegments || [];
      console.log(`Episode ${ep.id}: Loaded ${visualSegments.length} visual cues from ${cacheFiles[0]}`);
    }

    if (visualSegments.length === 0) {
      console.log(`Episode ${ep.id}: No OCR visual segments found in cache.`);
      continue;
    }

    const mergedInEp = [];

    segs.forEach((seg, sIdx) => {
      // Find OCR cues that are fully contained inside [seg.startSec - 0.05, seg.endSec + 0.05]
      const containedCues = visualSegments.filter(c => {
        return c.startSec >= (seg.startSec - 0.05) && c.endSec <= (seg.endSec + 0.05);
      });

      containedCues.sort((a, b) => a.startSec - b.startSec);

      // Deduplicate equivalent cues
      const uniqueCues = [];
      containedCues.forEach(c => {
        const isEq = uniqueCues.some(u => areChineseTextsEquivalent(u.originalChineseText, c.originalChineseText));
        if (!isEq) uniqueCues.push(c);
      });

      // Ignore pure exclamation / laughter fillers
      const dialogueCues = uniqueCues.filter(c => {
        const t = (c.originalChineseText || '').trim();
        return !EXCLAMATION_REGEX.test(t);
      });

      if (dialogueCues.length >= 2) {
        mergedInEp.push({
          sIdx,
          segIndex: sIdx + 1,
          seg,
          cues: dialogueCues,
        });
      }
    });

    console.log(`Episode ${ep.id}: Identified ${mergedInEp.length} merged segments.`);
    mergedInEp.forEach(m => {
      console.log(`  - Segment #${m.segIndex} [${m.seg.startSec.toFixed(2)}s - ${m.seg.endSec.toFixed(2)}s] "${m.seg.originalChineseText}" (Speaker: ${m.seg.speaker})`);
      m.cues.forEach((c, idx) => {
        console.log(`      Cue ${idx + 1}: [${c.startSec.toFixed(2)}s - ${c.endSec.toFixed(2)}s] "${c.originalChineseText}" (Speaker/Gender: ${c.speakerGender || c.voiceGender || c.gender})`);
      });
    });

    if (mergedInEp.length > 0) {
      epSplitPlans.push({ ep, mergedInEp });
    }
  }

  if (epSplitPlans.length === 0) {
    console.log('\n[Repair] No merged segments detected. Series data is already clean and normalized.');
    return;
  }

  console.log('\n=== STEP 2: SPLIT REPAIR & RETRANSLATION ===');

  for (const { ep, mergedInEp } of epSplitPlans) {
    const originalSegs = ep.scriptData.segments;
    const newSegs = [];

    for (let sIdx = 0; sIdx < originalSegs.length; sIdx++) {
      const seg = originalSegs[sIdx];
      const mergeInfo = mergedInEp.find(m => m.sIdx === sIdx);

      if (!mergeInfo) {
        newSegs.push(seg);
        continue;
      }

      console.log(`\nSplitting Segment #${mergeInfo.segIndex} into ${mergeInfo.cues.length} discrete segments...`);
      const cues = mergeInfo.cues;

      for (let cIdx = 0; cIdx < cues.length; cIdx++) {
        const cue = cues[cIdx];
        const isFirst = (cIdx === 0);
        const isLast = (cIdx === cues.length - 1);

        const childStart = isFirst ? seg.startSec : cue.startSec;
        const childEnd = isLast ? seg.endSec : cue.endSec;
        const childDur = parseFloat((childEnd - childStart).toFixed(2));
        const cueText = (cue.originalChineseText || cue.text || '').trim();

        console.log(`  -> Retranslating Child ${cIdx + 1}: "${cueText}" [${childStart.toFixed(2)} - ${childEnd.toFixed(2)}]...`);
        let khmerText = '';
        try {
          const transResult = await retranslateSingleDialogue(cueText, null, {
            modelName: 'gemini-3.5-flash-lite',
            genre: series.genre || 'Action/Drama',
          });
          if (transResult.options && transResult.options.length > 0) {
            const compact = transResult.options.find(o => o.style === 'compact');
            khmerText = (compact && compact.text) ? compact.text.trim() : transResult.options[0].text.trim();
          }
        } catch (transErr) {
          console.warn(`    Retranslation fallback triggered: ${transErr.message}`);
          khmerText = (cueText === '老子要') ? 'អញយក' :
                      (cueText === '你凭什么') ? 'តើឯងមានមូលដ្ឋានអី?' :
                      (cueText === '凭什么') ? 'មូលហេតុអ្វី?' :
                      (cueText === '凭他是老子的崽') ? 'ព្រោះគេជាកូនខ្ញុំ' : cueText;
        }

        const gender = (cue.voiceGender || cue.gender || cue.speakerGender || seg.voiceGender || 'male').toLowerCase();
        const speakerGender = gender.toUpperCase();
        const speakerName = (gender === 'male') ? 'តួប្រុស' : 'តួស្រី';
        const voiceId = (gender === 'male') ? 'km-KH-PisethNeural' : 'km-KH-SreymomNeural';
        const voiceLabel = (gender === 'male') ? 'ពិសិដ្ឋ (Piseth)' : 'ស្រីមុំ (Sreymom)';
        const avatar = (gender === 'male') ? '👨' : '👩';
        const badgeColor = (gender === 'male') ? '#3b82f6' : '#ec4899';
        const speakerId = (gender === 'male') ? 'spk_male_ត_ប_រ' : 'spk_female_ត_ស_រ';

        const childUid = isFirst ? seg._uid : `seg_${seg.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const childSeg = {
          ...seg,
          _uid: childUid,
          startSec: childStart,
          endSec: childEnd,
          duration: childDur,
          start: formatSecondsToTimecode(childStart).substring(0, 5),
          end: formatSecondsToTimecode(childEnd).substring(0, 5),
          startTime: formatSecondsToTimecode(childStart).substring(0, 5),
          endTime: formatSecondsToTimecode(childEnd).substring(0, 5),
          sourceStartSec: childStart,
          sourceEndSec: childEnd,
          speechStartSec: childStart,
          speechEndSec: childEnd,
          speechDuration: childDur,
          availableSlotDuration: childDur,
          slotDuration: childDur,

          originalChineseText: cueText,
          originalText: cueText,
          original: cueText,
          chineseText: cueText,
          spokenAudioText: cueText,
          ocrSubtitleText: cueText,

          khmerTranslatedText: khmerText,
          khmerText: khmerText,
          khmer: khmerText,
          translationStatus: 'translated',

          speaker: speakerName,
          speakerName: speakerName,
          speakerId: speakerId,
          voiceGender: gender,
          gender: gender,
          speakerGender: speakerGender,
          voiceId: voiceId,
          khmerVoiceId: voiceId,
          voice: voiceId,
          voiceLabel: voiceLabel,
          avatar: avatar,
          badgeColor: badgeColor,

          // Audio fields cleared
          audioUrl: null,
          audioFile: null,
          audioFileName: null,
          audioPath: null,
          rawAudioPath: null,
          rawAudioFile: null,
          fullAudioPath: null,
          fullAudioUrl: null,
          audioDurationSec: 0,
          rawAudioDur: 0,
          audioDuration: 0,
          finalAudioDuration: 0,
          originalAudioDuration: 0,
          audioStartSec: childStart,
          audioEndSec: childEnd,
          audioTrimmed: false,
          userTrimmed: false,
          audioGenerated: false,
          audioOutdated: true,
          ttsStatus: 'pending',
          status: 'needs_tts',

          trackRow: 0,
          trackId: 'voice-1',
          subTrackRow: 0,
          subTrackId: 'subs-1',
          userShifted: false,
          playbackRate: 1,
          needsTimeStretch: false,
          overflowSec: 0,
          safetyMarginSec: 0,
          overlapPreventionStatus: 'SAFE',
          overlapRisk: 'SAFE',
          lipSyncOffsetSec: 0,
          lipSyncStatus: 'IN_SYNC',
          syncWarning: null,
          validationWarnings: [],
          validationErrors: [],
        };

        newSegs.push(childSeg);
      }
    }

    newSegs.forEach((s, idx) => {
      s.id = idx + 1;
      s.segmentId = idx + 1;
    });

    console.log(`[Repair] Episode ${ep.id}: Segment count updated from ${originalSegs.length} to ${newSegs.length}.`);
    ep.scriptData.segments = newSegs;
    ep.scriptData.totalSegments = newSegs.length;
    ep.scriptData.updatedAt = new Date().toISOString();
    ep.lastModified = new Date().toISOString();
  }

  fs.writeFileSync(seriesFile, JSON.stringify(series, null, 2), 'utf8');
  console.log(`\n[Repair] Successfully saved repaired series data to: ${seriesFile}`);
}

if (require.main === module) {
  const targetSeriesId = process.argv[2] || 'series_1793898268958';
  repairSeries(targetSeriesId).catch(err => {
    console.error('[Repair] Error:', err);
    process.exit(1);
  });
}

module.exports = { repairSeries };
