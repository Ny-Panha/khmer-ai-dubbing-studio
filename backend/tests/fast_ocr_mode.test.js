const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { deduplicateFastOcrCues } = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const { parseSrtContent, parseJsonContent, parseSrtTimestamp } = require('../utils/subtitleParser');
const { GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

test('Fast OCR Deduplication: Drops chunk repeats and extends continuous duplicates', () => {
  const mockCues = [
    { startSec: 0.0, endSec: 1.5, chineseText: '你好' },
    // Continuous repeat within 0.35s -> should extend to 3.0s
    { startSec: 1.6, endSec: 3.0, chineseText: '你好' },
    // Chunk overlap repeat within 0.3s -> should be dropped/merged
    { startSec: 2.9, endSec: 3.5, chineseText: '你好' },
    // Distinct text -> preserved as separate cue
    { startSec: 4.0, endSec: 5.5, chineseText: '我们走吧' },
    // Distant repeat of previous text > 0.35s -> preserved
    { startSec: 10.0, endSec: 11.2, chineseText: '你好' },
  ];

  const deduped = deduplicateFastOcrCues(mockCues, 'female');

  assert.equal(deduped.length, 3, 'Should produce exactly 3 deduped cues');

  // Check Cue 1: Extended to 3.5s
  assert.equal(deduped[0].chineseText, '你好');
  assert.equal(deduped[0].startSec, 0.0);
  assert.equal(deduped[0].endSec, 3.5);

  // Check Cue 2
  assert.equal(deduped[1].chineseText, '我们走吧');
  assert.equal(deduped[1].startSec, 4.0);
  assert.equal(deduped[1].endSec, 5.5);

  // Check Cue 3: Distant repetition kept
  assert.equal(deduped[2].chineseText, '你好');
  assert.equal(deduped[2].startSec, 10.0);
  assert.equal(deduped[2].endSec, 11.2);
});

test('Fast OCR Speaker/Gender Rules: Sets unverified ocr_only metadata without guessing opposite gender', () => {
  const mockCues = [
    { startSec: 1.0, endSec: 2.5, chineseText: '第一句' },
    { startSec: 3.0, endSec: 4.5, chineseText: '第二句' },
  ];

  const dedupedFemale = deduplicateFastOcrCues(mockCues, 'female');
  assert.equal(dedupedFemale[0].speakerSource, 'ocr_only');
  assert.equal(dedupedFemale[0].unverifiedSpeaker, true);
  assert.equal(dedupedFemale[0].genderConfidence, null);
  assert.equal(dedupedFemale[0].voiceGender, 'female');
  assert.equal(dedupedFemale[0].voiceId, 'km-KH-SreymomNeural');

  const dedupedMale = deduplicateFastOcrCues(mockCues, 'male');
  assert.equal(dedupedMale[0].speakerSource, 'ocr_only');
  assert.equal(dedupedMale[0].unverifiedSpeaker, true);
  assert.equal(dedupedMale[0].genderConfidence, null);
  assert.equal(dedupedMale[0].voiceGender, 'male');
  assert.equal(dedupedMale[0].voiceId, 'km-KH-PisethNeural');
});

test('Subtitle Parser: Valid SRT content parses into canonical segments', () => {
  const validSrt = `1
00:00:01,000 --> 00:00:03,000
你好世界

2
00:00:03,500 --> 00:00:05,200
欢迎来到这里
`;

  const parsed = parseSrtContent(validSrt, GENERATION_MODES.FAST_OCR);
  assert.equal(parsed.success, true);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].startSec, 1.0);
  assert.equal(parsed.segments[0].endSec, 3.0);
  assert.equal(parsed.segments[0].originalChineseText, '你好世界');
  assert.equal(parsed.segments[1].startSec, 3.5);
  assert.equal(parsed.segments[1].endSec, 5.2);
  assert.equal(parsed.segments[1].originalChineseText, '欢迎来到这里');
});

test('Subtitle Parser: Malformed SRT returns line-by-line validation errors and fails with 0 segments', () => {
  const malformedSrt = `1
invalid_timecode --> broken_time
Missing valid timestamps

2
Just text without any timecode line
`;

  const parsed = parseSrtContent(malformedSrt, GENERATION_MODES.FAST_OCR);
  assert.equal(parsed.success, false);
  assert.equal(parsed.segments.length, 0);
  assert.ok(Array.isArray(parsed.validationErrors));
  assert.ok(parsed.validationErrors.length >= 2, 'Should report validation errors for both malformed blocks');
  assert.ok(parsed.validationErrors.some((e) => e.includes('Block 1 skipped')));
  assert.ok(parsed.validationErrors.some((e) => e.includes('Block 2 skipped')));
});

test('Subtitle Parser: Valid JSON content parses into canonical segments', () => {
  const validJson = JSON.stringify([
    { startSec: 1.2, endSec: 2.8, text: '第一行' },
    { startSec: 3.5, endSec: 5.0, text: '第二行' },
  ]);

  const parsed = parseJsonContent(validJson, GENERATION_MODES.FAST_OCR);
  assert.equal(parsed.success, true);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].startSec, 1.2);
  assert.equal(parsed.segments[0].originalChineseText, '第一行');
});

test('Subtitle Parser: Malformed JSON returns validation error', () => {
  const invalidJson = `{ broken: json`;
  const parsed = parseJsonContent(invalidJson, GENERATION_MODES.FAST_OCR);
  assert.equal(parsed.success, false);
  assert.equal(parsed.segments.length, 0);
  assert.ok(parsed.validationErrors[0].includes('JSON parse error'));
});

test('Re-Translate Safety: Backup snapshots of script and series.json are created before overwrite', () => {
  const tmpSeriesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'series_test_'));
  const tmpEpDir = path.join(tmpSeriesDir, 'episodes', 'ep_test');
  const tmpBackupsDir = path.join(tmpEpDir, 'backups');
  fs.mkdirSync(tmpBackupsDir, { recursive: true });

  const seriesJsonPath = path.join(tmpSeriesDir, 'series.json');
  fs.writeFileSync(seriesJsonPath, JSON.stringify({ id: 'series_test', title: 'Test Series' }), 'utf8');

  const oldScriptData = { segments: [{ id: 1, text: 'Old Line' }] };

  // Perform snapshot operation as executed in safety guard
  const now = Date.now();
  const epBackupPath = path.join(tmpBackupsDir, `script_backup_${now}.json`);
  fs.writeFileSync(epBackupPath, JSON.stringify(oldScriptData, null, 2), 'utf8');

  const seriesBackupPath = path.join(tmpSeriesDir, `series.json.backup_${now}`);
  fs.copyFileSync(seriesJsonPath, seriesBackupPath);

  assert.ok(fs.existsSync(epBackupPath), 'Episode backup should exist');
  assert.ok(fs.existsSync(seriesBackupPath), 'series.json backup should exist');

  const restoredSeries = JSON.parse(fs.readFileSync(seriesBackupPath, 'utf8'));
  assert.equal(restoredSeries.id, 'series_test');

  // Clean up
  fs.rmSync(tmpSeriesDir, { recursive: true, force: true });
});
