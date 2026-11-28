const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  TEXT_CATEGORIES,
  classifyTextEvent,
  reconstructVerticalChineseText,
  consolidateContinuousIntroductionCues,
  isIntroductionCategory,
  isNonSpokenMetadataCategory,
  NARRATOR_SPEAKER_LABEL,
  NARRATOR_SPEAKER_ID,
} = require('../utils/textEventClassifier');
const { deduplicateFastOcrCues } = require('../services/pipeline/stages/stage3VisionBatchRunner');
const { stitchAndDeduplicateSegments } = require('../services/pipeline/chunkOrchestrator');
const { reconcileTimelineEvidence } = require('../services/pipeline/stages/stage5_reconcileTimelineEvidence');
const {
  identifySpeakersForCues,
  buildVerifiedSeriesSpeakerMapPatch,
} = require('../services/pipeline/speakerIdentificationService');
const {
  applyTranslatedSegmentResult,
  enforceEpisodeCharacterConsistency,
} = require('../services/pipeline/stages/stage6PromptAndConsistency');
const { repairDuplicateIntroductionsInSegments, repairEpisodeIntroductions } = require('../services/pipeline/introductionRepairService');
const { translateAndValidateKhmer } = require('../services/pipeline/stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('../services/pipeline/stages/stage8_validateSubtitleTiming');
const { generateModeSpecificScript } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { resolvePythonBinary } = require('../services/audioSeparationService');

async function runTests() {
  console.log('Running P0 Introduction Deduplication & Classification Tests...\n');

  // 1. Canonical 9-category classification (general linguistic/structural, zero episode hardcoding)
  {
    assert.strictEqual(
      classifyTextEvent({ text: '快走！这里要塌了！', position: 'bottom_subtitle', orientation: 'horizontal' }),
      TEXT_CATEGORIES.DIALOGUE,
      'Spoken line with punctuation/particle must classify as dialogue'
    );
    assert.strictEqual(
      classifyTextEvent({ text: '三阶岩石巨兽', position: 'title_card', orientation: 'vertical' }),
      TEXT_CATEGORIES.MONSTER_INTRODUCTION,
      'Ranked beast vertical card must classify as monster_introduction'
    );
    assert.strictEqual(
      classifyTextEvent({ text: '玄天宗大长老 厉寒', position: 'title_card', orientation: 'vertical' }),
      TEXT_CATEGORIES.CHARACTER_INTRODUCTION,
      'Title nameplate card must classify as character_introduction'
    );
    assert.strictEqual(
      classifyTextEvent({ text: '黑风深渊', position: 'title_card', orientation: 'vertical' }),
      TEXT_CATEGORIES.LOCATION_INTRODUCTION,
      'Place banner must classify as location_introduction'
    );
    assert.strictEqual(
      classifyTextEvent({ text: '三天后', position: 'title_card', orientation: 'horizontal' }),
      TEXT_CATEGORIES.TIME_CARD,
      'Relative time card must classify as time_card'
    );
    assert.strictEqual(
      classifyTextEvent({ text: '上古纪元传闻此地曾陨落一位武帝强者', position: 'title_card', orientation: 'horizontal' }),
      TEXT_CATEGORIES.STORY_LORE,
      'World lore card must classify as story_lore'
    );
    assert.strictEqual(
      classifyTextEvent({ text: '恭喜宿主获得SS级天赋', position: 'title_card', orientation: 'horizontal' }),
      TEXT_CATEGORIES.SYSTEM_ANNOUNCEMENT,
      'System banner must classify as system_announcement'
    );
    assert.strictEqual(
      classifyTextEvent({ text: '抖音@动漫解说号', position: 'title_card', textRegion: 'corner' }),
      TEXT_CATEGORIES.WATERMARK,
      'Creator watermark must classify as watermark'
    );
    assert.strictEqual(
      classifyTextEvent({ text: '--- ✦ ---', position: 'title_card', textRegion: 'corner' }),
      TEXT_CATEGORIES.DECORATIVE,
      'Pure non-Hanzi symbol stamp must classify as decorative'
    );
    console.log('PASS [1] All 9 canonical text categories classified accurately');
  }

  // 2. Vertical Chinese text reconstruction in traditional reading order
  {
    // Single vertical column top-to-bottom
    const singleCol = reconstructVerticalChineseText([
      { text: '兽', xMin: 0.15, xMax: 0.21, yMin: 0.70, yMax: 0.78 },
      { text: '阶', xMin: 0.15, xMax: 0.21, yMin: 0.30, yMax: 0.38 },
      { text: '三', xMin: 0.15, xMax: 0.21, yMin: 0.20, yMax: 0.28 },
      { text: '石', xMin: 0.15, xMax: 0.21, yMin: 0.50, yMax: 0.58 },
      { text: '岩', xMin: 0.15, xMax: 0.21, yMin: 0.40, yMax: 0.48 },
      { text: '巨', xMin: 0.15, xMax: 0.21, yMin: 0.60, yMax: 0.68 },
    ]);
    assert.strictEqual(singleCol.text, '三阶岩石巨兽');
    assert.strictEqual(singleCol.orientation, 'vertical');

    // Two vertical columns: right column reads top-to-bottom first, then left column
    const twoCol = reconstructVerticalChineseText([
      { text: '深', xMin: 0.10, xMax: 0.15, yMin: 0.25, yMax: 0.35 },
      { text: '渊', xMin: 0.10, xMax: 0.15, yMin: 0.40, yMax: 0.50 },
      { text: '黑', xMin: 0.22, xMax: 0.27, yMin: 0.25, yMax: 0.35 },
      { text: '风', xMin: 0.22, xMax: 0.27, yMin: 0.40, yMax: 0.50 },
    ]);
    assert.strictEqual(twoCol.text, '黑风 深渊');
    assert.strictEqual(twoCol.orientation, 'vertical');
    console.log('PASS [2] Vertical Chinese reading order reconstruction verified (single + multi-column)');
  }

  // 3. Continuous introduction consolidation (blurry fade-in + overhang fragments + full card) + genuine repeated dialogue preserved
  {
    const rawCues = [
      { id: 1, sourceCueId: 'cue_0_18440_1', startSec: 184.4, endSec: 186.2, originalChineseText: '那就把他找出来杀掉', position: 'bottom_subtitle', deliveryType: 'dialogue' },
      { id: 2, sourceCueId: 'cue_0_18620_2', startSec: 186.2, endSec: 186.8, originalChineseText: '是', position: 'bottom_subtitle', deliveryType: 'dialogue' },
      // Fragmented continuous monster card observations across 193.20..196.00
      { id: 3, sourceCueId: 'cue_0_19320_3', startSec: 193.2, endSec: 193.6, originalChineseText: '三阶白巨兽', position: 'title_card', orientation: 'vertical', isSharp: false },
      { id: 4, sourceCueId: 'cue_0_19360_4', startSec: 193.6, endSec: 194.2, originalChineseText: '兽', position: 'bottom_subtitle', orientation: 'horizontal', isSharp: true },
      { id: 5, sourceCueId: 'cue_0_19375_5', startSec: 193.75, endSec: 194.2, originalChineseText: '三阶岩石巨兽', position: 'title_card', orientation: 'vertical', isSharp: true },
      { id: 6, sourceCueId: 'cue_0_19420_6', startSec: 194.2, endSec: 196.0, originalChineseText: '兽', position: 'bottom_subtitle', orientation: 'horizontal', isSharp: true },
      // Persistent watermark to drop
      { id: 7, sourceCueId: 'cue_0_19400_7', startSec: 194.0, endSec: 195.0, originalChineseText: '星爽剧场', position: 'title_card', textRegion: 'corner', textCategory: 'watermark' },
      // Genuine repeated spoken dialogue later with pause between must NOT collapse!
      { id: 8, sourceCueId: 'cue_0_19800_8', startSec: 198.0, endSec: 199.0, originalChineseText: '散开', position: 'bottom_subtitle', deliveryType: 'dialogue' },
      { id: 9, sourceCueId: 'cue_0_19990_9', startSec: 199.9, endSec: 200.8, originalChineseText: '散开', position: 'bottom_subtitle', deliveryType: 'dialogue' },
    ];

    const consolidated = consolidateContinuousIntroductionCues(rawCues, { maxGapSec: 0.75, dropNonSpokenMetadata: true });
    assert.strictEqual(consolidated.length, 5, 'Should yield 2 prior dialogue + 1 consolidated intro + 2 distinct repeated dialogue cues');
    assert.strictEqual(consolidated[2].originalChineseText, '三阶岩石巨兽');
    assert.strictEqual(consolidated[2].startSec, 193.2);
    assert.strictEqual(consolidated[2].endSec, 196.0);
    assert.strictEqual(consolidated[2].textCategory, TEXT_CATEGORIES.MONSTER_INTRODUCTION);
    assert.strictEqual(consolidated[2].deliveryType, 'narration');
    assert.strictEqual(consolidated[3].originalChineseText, '散开');
    assert.strictEqual(consolidated[4].originalChineseText, '散开');

    // Fast OCR dedup parity
    const fastDeduped = deduplicateFastOcrCues(rawCues, 'male');
    assert.strictEqual(fastDeduped.length, 5, 'Fast OCR deduplicator must consolidate continuous intro equally');
    assert.strictEqual(fastDeduped[2].originalChineseText, '三阶岩石巨兽');

    // Cross-chunk stitching parity
    const stitched = stitchAndDeduplicateSegments(rawCues);
    assert.strictEqual(stitched.length, 5, 'Chunk stitcher must apply identical consolidation');
    assert.strictEqual(stitched[2].originalChineseText, '三阶岩石巨兽');
    console.log('PASS [3] Continuous intro consolidation + Fast OCR + Chunk stitcher parity & dialogue repetition intact');
  }

  // 4. Simultaneous dialogue + introduction card must stay separate (no dropping ordinary dialogue!)
  {
    const simultaneous = [
      { id: 1, startSec: 50.0, endSec: 52.5, originalChineseText: '苍穹圣子 萧凡', position: 'title_card', orientation: 'vertical', textRegion: 'left_vertical' },
      { id: 2, startSec: 50.2, endSec: 52.0, originalChineseText: '你究竟是什么人！', position: 'bottom_subtitle', orientation: 'horizontal', textRegion: 'center_bottom', deliveryType: 'dialogue' },
      { id: 3, startSec: 51.0, endSec: 52.6, originalChineseText: '凡', position: 'bottom_subtitle', orientation: 'horizontal' },
    ];
    const res = consolidateContinuousIntroductionCues(simultaneous, { maxGapSec: 0.75 });
    assert.strictEqual(res.length, 2, 'Should keep 1 consolidated char intro + 1 simultaneous spoken dialogue');
    const intro = res.find((r) => isIntroductionCategory(r.textCategory));
    const dlg = res.find((r) => r.textCategory === TEXT_CATEGORIES.DIALOGUE);
    assert.ok(intro && intro.originalChineseText === '苍穹圣子 萧凡');
    assert.ok(dlg && dlg.originalChineseText === '你究竟是什么人！');
    console.log('PASS [4] Simultaneous character introduction and spoken dialogue both preserved cleanly');
  }

  // 5. Stage 5 Reconciliation: ASR-narrated intro merges to 1 vs unspoken SFX intro stays 1 active narration cue
  {
    const resSilentAudio = await reconcileTimelineEvidence({
      visualSegments: [
        { sourceCueId: 'cue_intro_1', startSec: 193.2, endSec: 196.0, duration: 2.8, originalChineseText: '三阶岩石巨兽', position: 'title_card', textCategory: 'monster_introduction', orientation: 'vertical', verifiedDisappearance: true },
      ],
      audioSegments: [],
      durationSec: 200,
    });
    assert.strictEqual(resSilentAudio.reconciledSegments.length, 1);
    assert.strictEqual(resSilentAudio.reconciledSegments[0].skipTts, false, 'Unspoken monster introduction must narrate once instead of silently dropping');
    assert.strictEqual(resSilentAudio.reconciledSegments[0].speakerId, NARRATOR_SPEAKER_ID);
    assert.strictEqual(resSilentAudio.reconciledSegments[0].deliveryType, 'narration');

    const resNarratedAudio = await reconcileTimelineEvidence({
      visualSegments: [
        { sourceCueId: 'cue_intro_2', startSec: 10.0, endSec: 13.0, duration: 3.0, originalChineseText: '黑风深渊禁地', position: 'title_card', textCategory: 'location_introduction', orientation: 'vertical', verifiedDisappearance: true },
      ],
      audioSegments: [
        { startSec: 10.2, endSec: 12.8, spokenChineseText: '黑风深渊禁地', speakerId: 'spk_narrator', acousticGender: 'male', acousticConfidence: 0.9 },
      ],
      durationSec: 30,
    });
    assert.strictEqual(resNarratedAudio.reconciledSegments.length, 1, 'When original audio narrates the card, reconcile into 1 cue instead of duplicating');
    assert.strictEqual(resNarratedAudio.reconciledSegments[0].evidenceSource, 'audio_and_ocr');
    assert.strictEqual(resNarratedAudio.reconciledSegments[0].skipTts, false);
    console.log('PASS [5] Stage 5 handles both unspoken intro narration & ASR-narrated intro deduplication');
  }

  // 6. SpeakerID + Stage 6 + Registry protection: never classifies monster card as separate speaking character
  {
    const cues = [
      { sourceCueId: 'cue_d1', startSec: 184.4, endSec: 186.2, duration: 1.8, originalChineseText: '杀掉它', position: 'bottom_subtitle', pitchHz: 125, acousticGender: 'male', acousticConfidence: 0.9 },
      { sourceCueId: 'cue_m1', startSec: 193.2, endSec: 196.0, duration: 2.8, originalChineseText: '三阶岩石巨兽', position: 'title_card', textCategory: 'monster_introduction', orientation: 'vertical', pitchHz: 0 },
    ];
    const spkRes = await identifySpeakersForCues({
      cues,
      narratorGender: 'male',
      // No Gemini mock needed; verify intro skips character naming locally
    });
    assert.strictEqual(spkRes.cues.length, 2);
    const introCue = spkRes.cues[1];
    assert.strictEqual(introCue.speakerId, NARRATOR_SPEAKER_ID);
    assert.strictEqual(introCue.speakerName, NARRATOR_SPEAKER_LABEL);
    assert.strictEqual(introCue.deliveryType, 'narration');
    assert.ok(!spkRes.castRegistry.some((c) => String(c.name || '').includes('巨兽') || c.speakerId === NARRATOR_SPEAKER_ID));

    const seriesPatch = buildVerifiedSeriesSpeakerMapPatch(spkRes.cues, {}, {}, { seriesId: 'solo_test' });
    assert.strictEqual(seriesPatch[NARRATOR_SPEAKER_ID], undefined, 'Narrator / monster cards must not pollute recurring character map');

    // Stage 6 apply + episode consistency keep consistent narrator voice
    const seg = { ...introCue, originalChineseText: '三阶岩石巨兽' };
    applyTranslatedSegmentResult(seg, { khmerText: 'យក្សថ្មកម្រិតទី៣', speaker: 'តាប្រាក់', voiceGender: 'female' }, 10, 0);
    assert.strictEqual(seg.speakerId, NARRATOR_SPEAKER_ID, 'Stage 6 must preserve narrator instead of letting model assign dialogue speaker');
    const consistency = enforceEpisodeCharacterConsistency([seg], { defaultGender: 'female' });
    assert.strictEqual(consistency.segments[0].voiceId, 'km-KH-SreymomNeural', 'Narrator must obey episode narratorGender consistently');
    console.log('PASS [6] SpeakerID, Stage 6 & character registry never turn introductions into separate speaking characters');
  }

  // 7. Targeted repair preserves manual edits & unaffected audio MP3s while consolidating #71-#74
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd_repair_test_'));
    const dlgAudio = path.join(tmpDir, 'seg_1.mp3');
    const outroAudio = path.join(tmpDir, 'seg_6.mp3');
    fs.writeFileSync(dlgAudio, 'fake-mp3-1');
    fs.writeFileSync(outroAudio, 'fake-mp3-6');

    const epFixture = {
      id: 'ep_test',
      narratorGender: 'male',
      scriptData: {
        segments: [
          {
            id: 1, segmentId: 1, sourceCueId: 'cue_1',
            startSec: 184.4, endSec: 186.2, duration: 1.8,
            originalChineseText: '那就把他找出来杀掉', khmerTranslatedText: 'ទៅរកវាសម្លាប់ចោល (កែដោយដៃ)',
            manualTextOverridden: true, userOverridden: true,
            speaker: 'ស៊ូ មីង', speakerId: 'spk_su_ming', voiceId: 'km-KH-PisethNeural',
            audioPath: dlgAudio, audioFile: 'seg_1.mp3', audioUrl: '/uploads/seg_1.mp3', ttsStatus: 'ready', audioGenerated: true,
          },
          { id: 2, segmentId: 2, sourceCueId: 'cue_0_19320_71', startSec: 193.2, endSec: 193.6, duration: 0.4, originalChineseText: '三阶白巨兽', khmerTranslatedText: 'យក្សសកម្រិត៣', speaker: 'តាប្រាក់', speakerId: 'spk_old_man' },
          { id: 3, segmentId: 3, sourceCueId: 'cue_0_19360_72', startSec: 193.6, endSec: 194.2, duration: 0.6, originalChineseText: '兽', khmerTranslatedText: 'សត្វ!', speaker: 'តាប្រាក់', speakerId: 'spk_old_man' },
          { id: 4, segmentId: 4, sourceCueId: 'cue_0_19375_73', startSec: 193.75, endSec: 194.2, duration: 0.45, originalChineseText: '三阶岩石巨兽', khmerTranslatedText: 'យក្សថ្មកម្រិត៣', speaker: 'តាប្រាក់', speakerId: 'spk_old_man' },
          { id: 5, segmentId: 5, sourceCueId: 'cue_0_19420_74', startSec: 194.2, endSec: 196.0, duration: 1.8, originalChineseText: '兽', khmerTranslatedText: 'សត្វយក្ស!', speaker: 'តាប្រាក់', speakerId: 'spk_old_man' },
          {
            id: 6, segmentId: 6, sourceCueId: 'cue_6',
            startSec: 198.0, endSec: 199.1, duration: 1.1,
            originalChineseText: '散开', khmerTranslatedText: 'បំបែកគ្នា!',
            speaker: 'តួប្រុស', speakerId: 'spk_male', voiceId: 'km-KH-PisethNeural',
            audioPath: outroAudio, audioFile: 'seg_6.mp3', audioUrl: '/uploads/seg_6.mp3', ttsStatus: 'ready', audioGenerated: true,
          },
        ],
      },
    };

    let regenCalls = 0;
    const repaired = await repairEpisodeIntroductions({
      episode: epFixture,
      narratorGender: 'male',
      synthesizeSingleSegmentFn: async ({ segment }) => {
        regenCalls++;
        assert.strictEqual(segment.originalChineseText, '三阶岩石巨兽');
        assert.strictEqual(segment.speakerId, NARRATOR_SPEAKER_ID);
        return { audioPath: path.join(tmpDir, 'seg_repaired.mp3'), audioFile: 'seg_repaired.mp3', audioUrl: '/uploads/seg_repaired.mp3' };
      },
    });

    assert.strictEqual(repaired.changed, true);
    assert.strictEqual(repaired.removedDuplicatesCount, 3, 'Must remove 3 duplicate fragments (#71,#72,#74)');
    assert.strictEqual(repaired.segments.length, 3, 'Should yield 1 before + 1 intro + 1 after');
    assert.strictEqual(repaired.segments[0].khmerTranslatedText, 'ទៅរកវាសម្លាប់ចោល (កែដោយដៃ)', 'Manual edit preserved');
    assert.strictEqual(repaired.segments[0].audioPath, dlgAudio, 'Unaffected prior audio untouched');
    assert.strictEqual(repaired.segments[1].originalChineseText, '三阶岩石巨兽');
    assert.strictEqual(repaired.segments[1].khmerTranslatedText, 'យក្សថ្មកម្រិត៣');
    assert.strictEqual(repaired.segments[1].startSec, 193.2);
    assert.strictEqual(repaired.segments[1].endSec, 196.0);
    assert.strictEqual(repaired.segments[1].speakerId, NARRATOR_SPEAKER_ID);
    assert.strictEqual(repaired.segments[1].sourceCueId, 'cue_0_19375_73');
    assert.strictEqual(repaired.segments[2].audioPath, outroAudio, 'Unaffected trailing audio untouched');
    assert.strictEqual(regenCalls, 1, 'Must regenerate ONLY the single consolidated intro clip');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('PASS [7] Targeted episode repair preserves manual edits & unaffected audio while synthesizing 1 intro clip');
  }

  // 8. Python RapidOCR worker filter_dialogue_ocr_results rejects left/right 1-char overhang fragments
  {
    const pyBin = resolvePythonBinary();
    const workerDir = path.resolve(__dirname, '../workers');
    const pyCheck = [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(workerDir)})`,
      'from local_chinese_ocr_worker import filter_dialogue_ocr_results, reconstruct_vertical_columns',
      'roi_w, roi_h = 1000, 260',
      'left_overhang = [([[150, 20], [210, 20], [210, 80], [150, 80]], "兽", 0.98)]',
      'assert filter_dialogue_ocr_results(left_overhang, roi_w, roi_h) == []',
      'centered_reply = [([[470, 120], [530, 120], [530, 190], [470, 190]], "是", 0.96)]',
      'res_reply = filter_dialogue_ocr_results(centered_reply, roi_w, roi_h)',
      'assert len(res_reply) == 1 and res_reply[0]["text"] == "是"',
      'v_items = [{"text": "兽", "x_min": 0.1, "x_max": 0.2, "x_center": 0.15, "y_center": 0.8}, {"text": "三", "x_min": 0.1, "x_max": 0.2, "x_center": 0.15, "y_center": 0.1}, {"text": "阶岩石巨", "x_min": 0.1, "x_max": 0.2, "x_center": 0.15, "y_center": 0.4}]',
      'assert reconstruct_vertical_columns(v_items) == "三阶岩石巨兽"',
      'print("PY_OK")',
    ].join('\n');
    const out = execFileSync(pyBin, ['-c', pyCheck], { encoding: 'utf8' });
    assert.ok(out.includes('PY_OK'), `Unexpected Python worker test output: ${out}`);
    console.log('PASS [8] Python RapidOCR worker rejects side overhang fragments & preserves vertical order + centered replies');
  }

  // 9. Stage 7 & Stage 8 detect duplicate introduction events, preserve 1:1 sourceCueId mapping & genuine dialogue
  {
    const baselineCues = [
      { sourceCueId: 'cue_d1', startSec: 1.0, endSec: 2.2, originalChineseText: '快跑！', position: 'bottom_subtitle', textCategory: 'dialogue' },
      { sourceCueId: 'cue_i1', startSec: 3.0, endSec: 4.0, originalChineseText: '三阶白巨兽', position: 'title_card', textCategory: 'monster_introduction' },
      { sourceCueId: 'cue_i2', startSec: 3.5, endSec: 5.5, originalChineseText: '三阶岩石巨兽', position: 'title_card', textCategory: 'monster_introduction' },
    ];
    const translated = [
      { ...baselineCues[0], segmentId: 1, khmerTranslatedText: 'រត់ភ្លាម!', khmerText: 'រត់ភ្លាម!' },
      { ...baselineCues[1], segmentId: 2, khmerTranslatedText: 'យក្សសកម្រិត៣', khmerText: 'យក្សសកម្រិត៣' },
      { ...baselineCues[2], segmentId: 3, khmerTranslatedText: 'យក្សថ្មកម្រិត៣', khmerText: 'យក្សថ្មកម្រិត៣' },
    ];
    const s7 = await translateAndValidateKhmer({ scriptSegments: translated, sourceCues: baselineCues, mode: 'dialogue' });
    assert.strictEqual(s7.validationReport.exactCueIdSetMatch, true, '1:1 sourceCueId preserved cleanly');
    assert.strictEqual(s7.validationReport.duplicateIntroductionCount, 1, 'Stage 7 must detect residual duplicate intro event before persistence');
    assert.strictEqual(s7.validatedSegments[2].reviewNeeded, true, 'Duplicate intro flagged as review_needed');
    assert.strictEqual(s7.validatedSegments[0].originalChineseText, '快跑！', 'Genuine dialogue untouched');

    const s8 = await validateSubtitleTiming({ segments: s7.validatedSegments, sourceCues: baselineCues, durationSec: 10 });
    assert.strictEqual(s8.timingReport.duplicateIntroductionCount, 1, 'Stage 8 must detect duplicate intro with baseline');
    assert.strictEqual(s8.timedSegments.length, 3, 'Never silently drop distinct sourceCueId baseline rows');

    // Without baseline distinct IDs, Stage 8 consolidates residual un-indexed duplicate intro automatically
    const noIdSegs = [
      { segmentId: 1, startSec: 3.0, endSec: 4.0, duration: 1.0, originalChineseText: '三阶白巨兽', khmerTranslatedText: 'យក្សសកម្រិត៣', position: 'title_card', textCategory: 'monster_introduction' },
      { segmentId: 2, startSec: 3.5, endSec: 5.5, duration: 2.0, originalChineseText: '三阶岩石巨兽', khmerTranslatedText: 'យក្សថ្មកម្រិត៣', position: 'title_card', textCategory: 'monster_introduction' },
    ];
    const s8Consolidate = await validateSubtitleTiming({ segments: noIdSegs, sourceCues: null, durationSec: 10 });
    assert.strictEqual(s8Consolidate.timedSegments.length, 1, 'Stage 8 consolidates un-locked duplicate intro');
    assert.strictEqual(s8Consolidate.timedSegments[0].originalChineseText, '三阶岩石巨兽');
    console.log('PASS [9] Stage 7 & Stage 8 detect/consolidate duplicate intros while preserving 1:1 sourceCueId mapping & dialogue');
  }

  // 10. Stage 6 ASR-vs-OCR intro reconciliation + natural narration + expressive dialogue protection
  {
    const mockAiClient = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            summary: 'Test',
            detectedGenre: 'ancient',
            segments: [
              { index: 1, segmentId: 1, speakerId: 'spk_narrator', speaker: 'អ្នករៀបរាប់', gender: 'male', khmerText: 'អាណាចក្របុរាណកាលខ្មៅងងឹត' },
              { index: 2, segmentId: 2, speakerId: 'spk_m1', speaker: 'តួឯកប្រុស', gender: 'male', khmerText: 'ហាហាហា! គួរឱ្យអស់សំណើចណាស់!' },
            ],
          }),
        }),
      },
    };
    const reconciledInput = [
      { startSec: 1.0, endSec: 3.0, duration: 2.0, originalChineseText: '上古黑渊域', evidenceSource: 'audio_asr', deliveryType: 'narration', speakerId: 'spk_narrator' },
      { startSec: 1.1, endSec: 3.8, duration: 2.7, originalChineseText: '上古黑渊域界', position: 'title_card', textCategory: 'location_introduction', evidenceSource: 'visual_ocr', deliveryType: 'narration', speakerId: 'spk_narrator' },
      { startSec: 5.0, endSec: 6.5, duration: 1.5, originalChineseText: '哈哈哈！太好笑了！', position: 'bottom_subtitle', textCategory: 'dialogue', deliveryType: 'out_loud', speakerId: 'spk_m1' },
    ];
    const s6Res = await generateModeSpecificScript({
      mode: 'dialogue',
      reconciledSegments: reconciledInput,
      durationSec: 10,
      aiClient: mockAiClient,
      force: true,
      useTranslationCache: false,
    });
    assert.strictEqual(s6Res.scriptSegments.length, 2, 'Stage 6 reconciles spoken ASR narration + equivalent on-screen intro into 1 narration');
    assert.strictEqual(s6Res.scriptSegments[0].speakerId, 'spk_narrator');
    assert.ok(s6Res.scriptSegments[1].khmerTranslatedText.includes('ហាហាហា'), 'Expressive dialogue laughter preserved');
    console.log('PASS [10] Stage 6 reconciles ASR-vs-OCR intro narration & preserves expressive dialogue');
  }

  console.log('\nALL P0 INTRO DEDUP & CLASSIFICATION TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
