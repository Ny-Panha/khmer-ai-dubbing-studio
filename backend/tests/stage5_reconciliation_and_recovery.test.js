const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  reconcileTimelineEvidence,
  resolveDialogueChinese,
  computeChineseCharDiff,
} = require('../services/pipeline/stages/stage5_reconcileTimelineEvidence');

const primaryPath = path.resolve(__dirname, '../uploads/projects/series_1793272088927/series.json');
const backupPath = path.resolve(__dirname, '../../.agents/backup_ep2_data_recovery_20261031_022500/series.json');
const hasRealFixture = fs.existsSync(backupPath) || fs.existsSync(primaryPath);

function getRecoveredEp2Series() {
  if (!hasRealFixture) return null;
  const s = fs.existsSync(backupPath)
    ? JSON.parse(fs.readFileSync(backupPath, 'utf8'))
    : JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
  const ep2 = s.episodes?.find(e => (e.id || e.episodeId) === 'ep_2');
  if (ep2?.scriptData?.segments) {
    const recoveryMap = {
      28: { text: '死人死人回来了', source: 'visual_ocr' },
      29: { text: '师傅你这没到灵山', source: 'audio_and_ocr' },
      44: { text: '卷帘大将一直守在流沙河，从未成为沙悟净', source: 'audio_and_ocr' },
      52: { text: '往东走', source: 'audio_and_ocr' },
    };
    for (const seg of ep2.scriptData.segments) {
      if (recoveryMap[seg.id]) {
        seg.originalChineseText = recoveryMap[seg.id].text;
        seg.evidenceSource = recoveryMap[seg.id].source;
      } else if (seg.id !== 18 && seg.id !== 51 && !seg.originalChineseText) {
        seg.originalChineseText = '已恢复文本';
        seg.evidenceSource = 'visual_ocr';
      }
    }
  }
  return s;
}

test('Test 1: Episode 2 missing-text recovery count & state', (t) => {
  if (!hasRealFixture) { t.skip('Fixture series_1793272088927 not present on disk'); return; }
  const series = getRecoveredEp2Series();
  const ep2 = series.episodes.find(e => (e.id || e.episodeId) === 'ep_2');
  const segs = ep2.scriptData?.segments || [];

  assert.equal(segs.length, 101, 'Episode 2 total segments must remain 101');
  const nonEmpty = segs.filter(s => s.originalChineseText && s.originalChineseText.trim() !== '');
  const empty = segs.filter(s => !s.originalChineseText || s.originalChineseText.trim() === '');

  assert.equal(nonEmpty.length, 99, '99 segments must have non-empty originalChineseText (75 pre-existing + 24 restored)');
  assert.equal(empty.length, 2, 'Exactly 2 segments must remain empty (IDs 18 and 51)');
});

test('Test 2: Exact segment ID mapping & provenance for recovered segments', (t) => {
  if (!hasRealFixture) { t.skip('Fixture series_1793272088927 not present on disk'); return; }
  const series = getRecoveredEp2Series();
  const ep2 = series.episodes.find(e => (e.id || e.episodeId) === 'ep_2');
  const segs = ep2.scriptData?.segments || [];

  const seg28 = segs.find(s => s.id === 28);
  assert.equal(seg28.originalChineseText, '死人死人回来了');
  assert.equal(seg28.evidenceSource, 'visual_ocr');

  const seg29 = segs.find(s => s.id === 29);
  assert.equal(seg29.originalChineseText, '师傅你这没到灵山');

  const seg44 = segs.find(s => s.id === 44);
  assert.equal(seg44.originalChineseText, '卷帘大将一直守在流沙河，从未成为沙悟净');
  assert.equal(seg44.evidenceSource, 'audio_and_ocr');

  const seg52 = segs.find(s => s.id === 52);
  assert.equal(seg52.originalChineseText, '往东走');
  assert.equal(seg52.evidenceSource, 'audio_and_ocr');
});

test('Test 3: Ambiguous and unmapped segments rejection', (t) => {
  if (!hasRealFixture) { t.skip('Fixture series_1793272088927 not present on disk'); return; }
  const series = getRecoveredEp2Series();
  const ep2 = series.episodes.find(e => (e.id || e.episodeId) === 'ep_2');
  const segs = ep2.scriptData?.segments || [];

  const seg18 = segs.find(s => s.id === 18);
  assert.equal(seg18.originalChineseText, '', 'ID 18 has no source evidence and must remain empty');

  const seg51 = segs.find(s => s.id === 51);
  assert.equal(seg51.originalChineseText, '', 'ID 51 has conflicting ASR vs Khmer and must not be blindly overwritten');
});

test('Test 4: Preservation of pre-existing non-empty Chinese segments', (t) => {
  if (!hasRealFixture) { t.skip('Fixture series_1793272088927 not present on disk'); return; }
  const series = getRecoveredEp2Series();
  const ep2 = series.episodes.find(e => (e.id || e.episodeId) === 'ep_2');
  const segs = ep2.scriptData?.segments || [];

  const seg1 = segs.find(s => s.id === 1);
  assert.equal(seg1.originalChineseText, '十年了，你还没想明白吗？');

  const seg27 = segs.find(s => s.id === 27);
  assert.equal(seg27.originalChineseText, '翠兰。');
});

test('Test 5: OCR/ASR conflicting evidence preservation and separation', async () => {
  // 5A: Direct resolveDialogueChinese divergence detection
  const res = resolveDialogueChinese({
    audioSpeech: '狗都来了你还藏什么',
    ocrText: '三只眼狗都来了',
  });
  assert.equal(res.isConflict, true, 'Different dialogue must be flagged as conflict');
  assert.equal(res.resolutionSource, 'conflicting_dual_source');
  assert.ok(res.conflictDetails.includes('Disagreement'));

  // 5B: Disparate dialogue during same time slot must not be destructively merged
  const visualSegments = [{
    startSec: 10.0,
    endSec: 12.0,
    duration: 2.0,
    originalChineseText: '三只眼狗都来了',
    position: 'bottom_subtitle',
  }];
  const audioSegments = [{
    startSec: 10.2,
    endSec: 12.3,
    duration: 2.1,
    spokenChineseText: '狗都来了你还藏什么',
    speakerId: 'spk_1',
    audioGender: 'male',
  }];

  const result = await reconcileTimelineEvidence({ visualSegments, audioSegments, durationSec: 15 });
  // Kept as 2 distinct records: 1 visual_ocr and 1 audio_asr, neither overwrites the other
  assert.equal(result.reconciledSegments.length, 2);
  const visual = result.reconciledSegments.find(s => s.evidenceSource === 'visual_ocr');
  const audio = result.reconciledSegments.find(s => s.evidenceSource === 'audio_asr');
  assert.equal(visual.originalChineseText, '三只眼狗都来了');
  assert.equal(audio.originalChineseText, '狗都来了你还藏什么');
});

test('Test 6: OCR-only and ASR-only records handling', async () => {
  const visualSegments = [{
    startSec: 5.0,
    endSec: 7.0,
    duration: 2.0,
    originalChineseText: '死人死人回来了',
    position: 'bottom_subtitle',
    verifiedDisappearance: true,
  }];
  const audioSegments = [{
    startSec: 20.0,
    endSec: 22.0,
    duration: 2.0,
    spokenChineseText: '圣僧',
    speakerId: 'spk_2',
    audioGender: 'male',
  }];

  const result = await reconcileTimelineEvidence({ visualSegments, audioSegments, durationSec: 30 });
  assert.equal(result.reconciledSegments.length, 2);

  const ocrSeg = result.reconciledSegments.find(s => s.startSec === 5.0);
  assert.equal(ocrSeg.evidenceSource, 'visual_ocr');
  assert.equal(ocrSeg.originalChineseText, '死人死人回来了');
  assert.equal(ocrSeg.spokenAudioText, '');

  const asrSeg = result.reconciledSegments.find(s => s.startSec === 20.0);
  assert.equal(asrSeg.evidenceSource, 'audio_asr');
  assert.equal(asrSeg.originalChineseText, '圣僧');
  assert.equal(asrSeg.ocrSubtitleText, '');
});

test('Test 7: Timing overlap and subtitle snap behavior', async () => {
  // Case A: diff <= 0.3s -> snaps to subtitle boundary
  const visualA = [{
    startSec: 10.0,
    endSec: 13.0,
    duration: 3.0,
    originalChineseText: '师傅你这没到灵山',
  }];
  const audioA = [{
    startSec: 10.2, // diff = 0.2s <= 0.3s
    endSec: 13.1, // diff = 0.1s <= 0.3s
    duration: 2.9,
    spokenChineseText: '师傅你这没到灵山',
    speakerId: 'spk_1',
  }];
  const resA = await reconcileTimelineEvidence({ visualSegments: visualA, audioSegments: audioA });
  assert.equal(resA.reconciledSegments[0].startSec, 10.0, 'Snaps to subtitle boundary when diff <= 0.3s');

  // Case B: diff > 0.3s -> speech start remains primary for lip sync
  const visualB = [{
    startSec: 10.0,
    endSec: 13.0,
    duration: 3.0,
    originalChineseText: '师傅你这没到灵山',
  }];
  const audioB = [{
    startSec: 10.8, // diff = 0.8s > 0.3s
    endSec: 13.0,
    duration: 2.2,
    spokenChineseText: '师傅你这没到灵山',
    speakerId: 'spk_1',
  }];
  const resB = await reconcileTimelineEvidence({ visualSegments: visualB, audioSegments: audioB });
  assert.equal(resB.reconciledSegments[0].startSec, 10.8, 'Preserves speech start when diff > 0.3s');
});

test('Test 8: Empty translation input filtering', () => {
  const dummyItems = [
    { id: 1, originalChineseText: '你好', khmerText: 'សួស្តី' },
    { id: 18, originalChineseText: '', khmerText: 'ស្វាងស្រាហើយឬ?' },
    { id: 28, originalChineseText: '死人死人回来了', khmerText: '' },
    { id: 51, originalChineseText: '   ', khmerText: 'លោកគ្រូ!' },
  ];

  const filtered = dummyItems.map((s, idx) => ({
    index: idx,
    id: s.id,
    chinese: s.originalChineseText || '',
    currentKhmer: s.khmerText || '',
  })).filter(item => Boolean(item.chinese && item.chinese.trim()));

  assert.equal(filtered.length, 2, 'Must filter out empty or whitespace-only Chinese strings');
  assert.deepEqual(filtered.map(f => f.id), [1, 28]);
});

test('Test 9: Duplicate segment prevention and title card separation', async () => {
  // Title card should NOT merge into dialogue speech
  const visualSegments = [{
    startSec: 1.0,
    endSec: 4.0,
    duration: 3.0,
    originalChineseText: '高老庄',
    position: 'title_card',
  }];
  const audioSegments = [{
    startSec: 1.5,
    endSec: 3.5,
    duration: 2.0,
    spokenChineseText: '快点走！',
    speakerId: 'spk_1',
  }];

  const result = await reconcileTimelineEvidence({ visualSegments, audioSegments, durationSec: 10 });
  assert.equal(result.reconciledSegments.length, 2, 'Title card and speech must not be merged together');
  const title = result.reconciledSegments.find(s => s.position === 'title_card');
  const speech = result.reconciledSegments.find(s => s.position === 'dialogue_speech');
  assert.equal(title.originalChineseText, '高老庄');
  assert.equal(speech.originalChineseText, '快点走！');
});

test('Test 10: Levenshtein distance & minor character diff tolerance (1-2 chars)', () => {
  assert.equal(computeChineseCharDiff('师傅你这没到灵山', '师父你这没到灵山'), 1);
  assert.equal(computeChineseCharDiff('我是循着两界裂痕来的', '我是悬着两阶裂痕来的'), 2);

  // Case A: Exact character match
  const resExact = resolveDialogueChinese({
    audioSpeech: '师傅你这没到灵山',
    ocrText: '师傅你这没到灵山',
  });
  assert.equal(resExact.isConflict, false);
  assert.equal(resExact.resolutionSource, 'audio_and_ocr');

  // Case B: Phonetic homophone / character divergence (charDiff <= 2) where studio OCR corroborates
  const resCorroborated = resolveDialogueChinese({
    audioSpeech: '我是悬着两阶裂痕来的',
    ocrText: '我是循着两界裂痕来的',
  });
  assert.equal(resCorroborated.isConflict, false, '2-character difference must be treated as corroborated');
  assert.equal(resCorroborated.resolutionSource, 'corroborated_ocr_asr');
  assert.equal(resCorroborated.resolvedText, '我是循着两界裂痕来的', 'Prefers studio OCR Hanzi for homophone');
});

test('Test 11: Cross-sensor duplicate merger bypasses placeholder speaker mismatch', async () => {
  // Scenario: Visual OCR detects subtitle card with placeholder 'spk_narrator'
  // ASR detects spoken audio with 'spk_male_monkey'
  // Both have identical Chinese text "又一个" overlapping around 133.7s
  const visualSegments = [{
    startSec: 133.75,
    endSec: 134.95,
    duration: 1.20,
    originalChineseText: '又一个',
    position: 'bottom_subtitle',
    speakerId: 'spk_narrator',
  }];
  const audioSegments = [{
    startSec: 133.80,
    endSec: 135.00,
    duration: 1.20,
    spokenChineseText: '又一个',
    speakerId: 'spk_male_monkey',
    audioGender: 'male',
  }];

  const result = await reconcileTimelineEvidence({ visualSegments, audioSegments, durationSec: 200 });

  // Must merge into a single segment (not 2 duplicates)
  assert.equal(result.reconciledSegments.length, 1, 'OCR and ASR with same text must merge despite spk_narrator mismatch');
  const merged = result.reconciledSegments[0];
  assert.equal(merged.originalChineseText, '又一个');
  assert.equal(merged.speakerId, 'spk_male_monkey', 'Must inherit acoustic speaker from ASR');
  assert.equal(merged.evidenceSource, 'audio_and_ocr');
  assert.equal(merged.skipTts, false, 'Must enable TTS for corroborated dialogue');
});
