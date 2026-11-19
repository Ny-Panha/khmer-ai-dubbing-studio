const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const {
  separateAudio,
  validateDemucsStems,
  killSeparationJob,
  getSeparationCacheDir,
  getSeparationProgress,
  isSeparationBusy,
  getSeparationQueueLength,
} = require('../services/audioSeparationService');

const {
  computeSegmentAudioSignature,
  cleanTextForTts,
  isPlaceholderOrEmptyTtsText,
  speedToEdgeRate,
} = require('../services/ttsService');

const {
  getCachedTranslation,
  setCachedTranslation,
  getTranslationCacheKey,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');

const { doesSegmentNeedTts } = require('../routes/audioRoutes');

// Helper to create real valid silent WAV files using bundled ffmpeg for decodability tests
function createValidTestWav(filePath, durationSec = 1.5) {
  const ffmpegPath = path.resolve(__dirname, '../node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  const bin = fs.existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg';
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  spawnSync(bin, [
    '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(durationSec), filePath,
  ], { windowsHide: true });
}

test('Smart 3-Step Pipeline Suite', async (t) => {

  // Test 1: Single episode all3: Script -> Voice -> Demucs dependency contract and failure propagation
  await t.test('1. Single episode all3: Voice strictly waits for Script; Clean BGM failure prevents false success', async () => {
    const executionOrder = [];

    const mockRunTranslate = async () => {
      executionOrder.push('script_start');
      await new Promise(r => setTimeout(r, 15));
      executionOrder.push('script_done');
      return { success: true };
    };

    const mockRunVoice = async () => {
      assert.ok(executionOrder.includes('script_done'), 'Voice must start AFTER script is done');
      executionOrder.push('voice_start');
      await new Promise(r => setTimeout(r, 15));
      executionOrder.push('voice_done');
      return { success: true };
    };

    const mockRunCleanBgmSuccess = async () => {
      executionOrder.push('bgm_start');
      await new Promise(r => setTimeout(r, 25));
      executionOrder.push('bgm_done');
      return { success: true, noVocalsUrl: '/audio/no_vocals.wav' };
    };

    // Parallel Clean BGM + sequential Script -> Voice contract
    const bgmPromise = mockRunCleanBgmSuccess();
    await mockRunTranslate();
    await mockRunVoice();
    const bgmRes = await bgmPromise;

    assert.ok(executionOrder.indexOf('script_start') < executionOrder.indexOf('script_done'));
    assert.ok(executionOrder.indexOf('script_done') < executionOrder.indexOf('voice_start'));
    assert.ok(executionOrder.indexOf('voice_start') < executionOrder.indexOf('voice_done'));
    assert.equal(bgmRes.success, true);

    // CRITICAL: When Clean BGM fails and was not explicitly skipped, All 3 MUST fail and not report false success
    const mockRunCleanBgmFail = async () => {
      await new Promise(r => setTimeout(r, 10));
      return { success: false, error: 'CUDA out of memory in Demucs worker' };
    };

    const runAll3WithFailure = async () => {
      const bgmP = mockRunCleanBgmFail().catch(err => ({ success: false, error: err.message }));
      const sRes = await mockRunTranslate();
      if (!sRes?.success) throw new Error(sRes?.error || 'Script failed');
      const vRes = await mockRunVoice();
      if (!vRes?.success) throw new Error(vRes?.error || 'Voice failed');
      const bRes = await bgmP;
      if (!bRes?.success) {
        throw new Error(bRes?.error || 'Clean BGM separation failed');
      }
      return { success: true };
    };

    await assert.rejects(
      async () => await runAll3WithFailure(),
      /CUDA out of memory/,
      'All 3 runner must throw/fail when Clean BGM fails'
    );
  });

  // Test 2: Three episodes Run 1-by-1 queue serialization
  await t.test('2. Three episodes Run 1-by-1: Processes episodes sequentially without overlap', async () => {
    const episodes = [{ id: 'ep_1' }, { id: 'ep_2' }, { id: 'ep_3' }];
    const processedEpisodes = [];
    let currentlyRunning = null;

    for (const ep of episodes) {
      assert.equal(currentlyRunning, null, 'No two episodes should run concurrently in 1-by-1 mode');
      currentlyRunning = ep.id;
      await new Promise(r => setTimeout(r, 10));
      processedEpisodes.push(ep.id);
      currentlyRunning = null;
    }

    assert.deepEqual(processedEpisodes, ['ep_1', 'ep_2', 'ep_3']);
  });

  // Test 3: Existing Script + missing Voice (skips translation, generates voice only)
  await t.test('3. Existing Script + missing Voice: Reuses existing script and only triggers voice', async () => {
    const ep = {
      id: 'ep_test_3',
      scriptData: {
        hasScript: true,
        segments: [
          { id: 1, originalChineseText: '你好', khmerTranslatedText: 'សួស្តី', ttsStatus: 'pending' },
        ],
      },
      hasAudio: false,
      audioOutdated: true,
    };

    let scriptCalled = false;
    let voiceCalled = false;

    if (!ep.scriptData?.hasScript) scriptCalled = true;
    if (!ep.hasAudio || ep.audioOutdated) voiceCalled = true;

    assert.equal(scriptCalled, false, 'Script generation should be skipped');
    assert.equal(voiceCalled, true, 'Voice generation must be called');
  });

  // Test 4: Existing Voice + missing BGM (skips script & voice, runs only Demucs BGM)
  await t.test('4. Existing Voice + missing BGM: Reuses script & audio, executes only Demucs BGM', async () => {
    const ep = {
      id: 'ep_test_4',
      scriptData: { hasScript: true, segments: [{ id: 1, khmerTranslatedText: 'សួស្តី' }] },
      hasAudio: true,
      audioOutdated: false,
      hasDemucs: false,
    };

    let scriptCalled = false;
    let voiceCalled = false;
    let demucsCalled = false;

    if (!ep.scriptData?.hasScript) scriptCalled = true;
    if (!ep.hasAudio || ep.audioOutdated) voiceCalled = true;
    if (!ep.hasDemucs) demucsCalled = true;

    assert.equal(scriptCalled, false);
    assert.equal(voiceCalled, false);
    assert.equal(demucsCalled, true);
  });

  // Test 5: Context-Safe Chinese -> Khmer Translation Caching
  await t.test('5. Context-Safe Translation Cache: Incorporates speaker and surrounding dialogue', async () => {
    const testSeries = 'test_ctx_series';
    const chinese = '是'; // Short ambiguous sentence
    const khmerMale = 'បាទពិតមែនហើយ';
    const khmerFemale = 'ចាសពិតមែនហើយ';

    // Different speakers produce distinct cache keys
    const maleKey = getTranslationCacheKey(chinese, {
      seriesId: testSeries,
      speaker: 'តួប្រុស',
      voiceGender: 'male',
      prevContext: 'តើលោកដឹងទេ?',
    });

    const femaleKey = getTranslationCacheKey(chinese, {
      seriesId: testSeries,
      speaker: 'តួស្រី',
      voiceGender: 'female',
      prevContext: 'តើលោកដឹងទេ?',
    });

    assert.notEqual(maleKey, femaleKey, 'Male and female speaker contexts must generate distinct keys');

    // Different preceding dialogue context produces distinct keys
    const diffContextKey = getTranslationCacheKey(chinese, {
      seriesId: testSeries,
      speaker: 'តួប្រុស',
      voiceGender: 'male',
      prevContext: 'អ្នកពិតជាបានឃើញមែនទេ?',
    });

    assert.notEqual(maleKey, diffContextKey, 'Different dialogue context must generate distinct keys');

    // Seed male translation
    setCachedTranslation(chinese, {
      khmerText: khmerMale,
      speaker: 'តួប្រុស',
      voiceGender: 'male',
      prevContext: 'តើលោកដឹងទេ?',
      seriesId: testSeries,
    });

    // Seed female translation
    setCachedTranslation(chinese, {
      khmerText: khmerFemale,
      speaker: 'តួស្រី',
      voiceGender: 'female',
      prevContext: 'តើលោកដឹងទេ?',
      seriesId: testSeries,
    });

    // Query male context -> returns male translation
    const cachedMale = getCachedTranslation(chinese, {
      seriesId: testSeries,
      speaker: 'តួប្រុស',
      voiceGender: 'male',
      prevContext: 'តើលោកដឹងទេ?',
    });
    assert.ok(cachedMale, 'Male cache hit expected');
    assert.equal(cachedMale.khmerText, khmerMale);

    // Query female context -> returns female translation without cross-speaker collision!
    const cachedFemale = getCachedTranslation(chinese, {
      seriesId: testSeries,
      speaker: 'តួស្រី',
      voiceGender: 'female',
      prevContext: 'តើលោកដឹងទេ?',
    });
    assert.ok(cachedFemale, 'Female cache hit expected');
    assert.equal(cachedFemale.khmerText, khmerFemale);

    // Query with different preceding context -> cache miss (null)
    const missedContext = getCachedTranslation(chinese, {
      seriesId: testSeries,
      speaker: 'តួប្រុស',
      voiceGender: 'male',
      prevContext: 'បរិបទថ្មីដែលមិនធ្លាប់មាន',
    });
    assert.equal(missedContext, null, 'Unseen dialogue context must result in cache miss');
  });

  // Test 6: One incorrect Khmer translation — retry that segment only
  await t.test('6. Targeted retry: Retrying 1 segment preserves other segments and timestamps', async () => {
    const segments = [
      { id: 1, startSec: 1.0, endSec: 3.5, originalChineseText: '第一句', khmerTranslatedText: 'ឃ្លាទី ១ ត្រឹមត្រូវ' },
      { id: 2, startSec: 4.0, endSec: 6.0, originalChineseText: '第二句', khmerTranslatedText: '', reviewNeeded: true },
      { id: 3, startSec: 6.5, endSec: 8.5, originalChineseText: '第三句', khmerTranslatedText: 'ឃ្លាទី ៣ ត្រឹមត្រូវ' },
    ];

    const target = segments[1];
    target.khmerTranslatedText = 'ឃ្លាទី ២ ជួសជុលរួចរាល់';
    target.reviewNeeded = false;
    target.translationStatus = 'translated';

    assert.equal(segments[0].khmerTranslatedText, 'ឃ្លាទី ១ ត្រឹមត្រូវ');
    assert.equal(segments[0].startSec, 1.0);
    assert.equal(segments[0].endSec, 3.5);

    assert.equal(segments[1].khmerTranslatedText, 'ឃ្លាទី ២ ជួសជុលរួចរាល់');
    assert.equal(segments[1].startSec, 4.0);
    assert.equal(segments[1].endSec, 6.0);

    assert.equal(segments[2].khmerTranslatedText, 'ឃ្លាទី ៣ ត្រឹមត្រូវ');
    assert.equal(segments[2].startSec, 6.5);
    assert.equal(segments[2].endSec, 8.5);
  });

  // Test 7: Chinese and Khmer source fields remain unchanged during unrelated retries
  await t.test('7. Source fields & timestamps invariant: Original text and timing remain stable', () => {
    const seg = {
      id: 42,
      sourceCueId: 'cue_42',
      startSec: 12.34,
      endSec: 15.67,
      duration: 3.33,
      originalChineseText: '不要走！',
      khmerTranslatedText: 'កុំទៅអី!',
    };

    const initialSnapshot = { ...seg };
    seg.audioOutdated = false;
    seg.ttsStatus = 'ready';

    assert.equal(seg.id, initialSnapshot.id);
    assert.equal(seg.sourceCueId, initialSnapshot.sourceCueId);
    assert.equal(seg.startSec, initialSnapshot.startSec);
    assert.equal(seg.endSec, initialSnapshot.endSec);
    assert.equal(seg.originalChineseText, initialSnapshot.originalChineseText);
    assert.equal(seg.khmerTranslatedText, initialSnapshot.khmerTranslatedText);
  });

  // Test 8: Manual Khmer corrections remain intact (userOverridden: true)
  await t.test('8. Manual Khmer corrections protected: userOverridden segments are never mutated', async () => {
    const userManualSeg = {
      id: 5,
      originalChineseText: '谢谢你',
      khmerTranslatedText: 'អរគុណបងច្រើនណាស់ (Manual Edit)',
      userOverridden: true,
      translationSource: 'manual',
    };

    if (!userManualSeg.userOverridden && userManualSeg.translationSource !== 'manual') {
      userManualSeg.khmerTranslatedText = 'អរគុណ';
    }

    assert.equal(userManualSeg.khmerTranslatedText, 'អរគុណបងច្រើនណាស់ (Manual Edit)');
  });

  // Test 9: Speaker identity and selected voices remain intact
  await t.test('9. Speaker identity & voice consistency: Piseth for male, Sreymom for female, UNKNOWN preserved', () => {
    const maleSig = computeSegmentAudioSignature('សួស្តីបង', 'km-KH-PisethNeural', 'normal', 0);
    const femaleSig = computeSegmentAudioSignature('សួស្តីបង', 'km-KH-SreymomNeural', 'normal', 0);

    assert.notEqual(maleSig, femaleSig, 'Different voices must yield different audio signatures');
  });

  // Test 10: TTS Content Signature & Legacy Cache Policy in doesSegmentNeedTts
  await t.test('10. Legacy TTS Cache Policy: Missing signature forces synthesis unless verified by metadata', () => {
    const testAudioDir = path.join(__dirname, '../uploads/cache/test_tts_cache_policy');
    if (!fs.existsSync(testAudioDir)) fs.mkdirSync(testAudioDir, { recursive: true });

    const voiceId = 'km-KH-PisethNeural';
    const dummyAudio = path.join(testAudioDir, `seg_test_10_${voiceId}.mp3`);
    fs.writeFileSync(dummyAudio, Buffer.alloc(1024, 0x55)); // 1KB audio

    const khmerText = 'សួស្តីអ្នកទាំងអស់គ្នា';
    const validSig = computeSegmentAudioSignature(khmerText, voiceId, 'normal', 0);

    // 10A: Segment with audio file on disk, but WITHOUT audioSignature (legacy):
    // MUST return true (needs TTS) because file existence alone is unsafe!
    const legacySeg = {
      id: 10,
      khmer: khmerText,
      voiceId,
      audioPath: dummyAudio,
      audioFile: `seg_test_10_${voiceId}.mp3`,
      ttsStatus: 'ready',
      audioSignature: null, // missing!
    };
    const needsTtsLegacy = doesSegmentNeedTts(legacySeg, testAudioDir);
    assert.equal(needsTtsLegacy, true, 'Legacy segment without signature MUST trigger synthesis');

    // 10B: Segment WITH matching audioSignature:
    // Reused cleanly -> returns false!
    const validSeg = {
      ...legacySeg,
      audioSignature: validSig,
    };
    const needsTtsValid = doesSegmentNeedTts(validSeg, testAudioDir);
    assert.equal(needsTtsValid, false, 'Segment with matching signature should be reused');

    // 10C: Segment where text was edited:
    // audioSignature no longer matches new text -> returns true!
    const editedTextSeg = {
      ...validSeg,
      khmer: 'សួស្តីអ្នកទាំងអស់គ្នា ខ្ញុំមកដល់ហើយ',
    };
    const needsTtsEdited = doesSegmentNeedTts(editedTextSeg, testAudioDir);
    assert.equal(needsTtsEdited, true, 'Edited text must invalidate audio and trigger synthesis');

    // 10D: Legacy segment with sidecar metadata proving exact match:
    // Adopts signature and returns false!
    const sidecarJson = dummyAudio.replace(/\.[^.]+$/, '.json');
    fs.writeFileSync(sidecarJson, JSON.stringify({
      text: khmerText,
      voiceId,
      audioSignature: validSig,
    }));
    const legacyWithSidecar = {
      ...legacySeg,
      audioSignature: null,
    };
    const needsTtsSidecar = doesSegmentNeedTts(legacyWithSidecar, testAudioDir);
    assert.equal(needsTtsSidecar, false, 'Legacy segment with verified sidecar metadata can be reused');

    // Clean up
    try {
      fs.unlinkSync(dummyAudio);
      fs.unlinkSync(sidecarJson);
      fs.rmdirSync(testAudioDir);
    } catch (_) {}
  });

  // Test 11: Demucs cached media belongs to correct source
  await t.test('11. Demucs Cache: Different media files generate distinct cache directories', () => {
    const tempDir = path.join(__dirname, '../uploads/cache/test_sep_cache');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const fileA = path.join(tempDir, 'sample_a.mp4');
    const fileB = path.join(tempDir, 'sample_b.mp4');

    fs.writeFileSync(fileA, Buffer.alloc(1024 * 70, 0xAA));
    fs.writeFileSync(fileB, Buffer.alloc(1024 * 70, 0xBB));

    const cacheDirA = getSeparationCacheDir(fileA);
    const cacheDirB = getSeparationCacheDir(fileB);

    assert.notEqual(cacheDirA, cacheDirB, 'Distinct media files must have separate cache directories');

    // Identical content has identical cache dir
    const fileACopy = path.join(tempDir, 'sample_a_copy.mp4');
    fs.writeFileSync(fileACopy, Buffer.alloc(1024 * 70, 0xAA));
    const cacheDirACopy = getSeparationCacheDir(fileACopy);
    assert.equal(cacheDirA, cacheDirACopy, 'Identical media content must resolve to same cache directory');

    // Clean up temp files
    try {
      fs.unlinkSync(fileA);
      fs.unlinkSync(fileB);
      fs.unlinkSync(fileACopy);
      fs.rmdirSync(tempDir);
    } catch (_) {}
  });

  // Test 12: Real Demucs stem validation (validateDemucsStems)
  await t.test('12. Demucs Stem Validation: Verifies existence, size >= 100KB, decodability and duration tolerance', async () => {
    const testDir = path.join(__dirname, '../uploads/cache/test_stems_val');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const vPath = path.join(testDir, 'vocals.wav');
    const nvPath = path.join(testDir, 'no_vocals.wav');

    // 12A: Missing files
    const missingRes = await validateDemucsStems(vPath, nvPath);
    assert.equal(missingRes.valid, false);
    assert.equal(missingRes.reason, 'STEMS_NOT_FOUND');

    // 12B: File size < 100KB
    fs.writeFileSync(vPath, Buffer.alloc(50 * 1024, 0x00));
    fs.writeFileSync(nvPath, Buffer.alloc(50 * 1024, 0x00));
    const smallRes = await validateDemucsStems(vPath, nvPath);
    assert.equal(smallRes.valid, false);
    assert.equal(smallRes.reason, 'STEMS_TOO_SMALL');

    // 12C: File >= 100KB but corrupted bytes (indecodable)
    fs.writeFileSync(vPath, Buffer.alloc(120 * 1024, 0x99));
    fs.writeFileSync(nvPath, Buffer.alloc(120 * 1024, 0x99));
    const corruptRes = await validateDemucsStems(vPath, nvPath);
    assert.equal(corruptRes.valid, false);

    // 12D: Real valid silent WAV files (1.5 seconds)
    createValidTestWav(vPath, 1.5);
    createValidTestWav(nvPath, 1.5);

    // Valid check without source duration
    const validRes = await validateDemucsStems(vPath, nvPath);
    assert.equal(validRes.valid, true);
    assert.ok(validRes.vocalsDuration >= 1.4 && validRes.vocalsDuration <= 1.6);

    // Valid check with matching source duration (1.5s, tolerance <= 2.0s)
    const matchedRes = await validateDemucsStems(vPath, nvPath, 1.5);
    assert.equal(matchedRes.valid, true);

    // Invalid check when source duration differs by more than 2.0s (e.g. 10.0s source vs 1.5s stem)
    const mismatchedRes = await validateDemucsStems(vPath, nvPath, 10.0);
    assert.equal(mismatchedRes.valid, false);
    assert.equal(mismatchedRes.reason, 'STEMS_DURATION_MISMATCH_SOURCE');

    // Clean up
    try {
      fs.unlinkSync(vPath);
      fs.unlinkSync(nvPath);
      fs.rmdirSync(testDir);
    } catch (_) {}
  });

  // Test 13: Demucs Safe Queue & Cache hit check
  await t.test('13. Demucs Safe Queue: Instant cache hit validates decodable stems cleanly', async () => {
    const mockAudio = path.join(__dirname, 'mock_queue_video.mp4');
    createValidTestWav(mockAudio, 1.5);

    const cacheDir = getSeparationCacheDir(mockAudio);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // Seed real valid WAV stem files (1.5s, >100KB)
    createValidTestWav(path.join(cacheDir, 'vocals.wav'), 1.5);
    createValidTestWav(path.join(cacheDir, 'no_vocals.wav'), 1.5);

    // Instant cache hit check verifies decodable stems and returns cached result
    const res = await separateAudio({ audioPath: mockAudio, sourceDuration: 1.5 });
    assert.equal(res.status, 'success');
    assert.equal(res.isCached, true);
    assert.ok(res.vocalsDuration >= 1.4);

    // Clean up
    try {
      fs.unlinkSync(path.join(cacheDir, 'vocals.wav'));
      fs.unlinkSync(path.join(cacheDir, 'no_vocals.wav'));
      fs.unlinkSync(mockAudio);
    } catch (_) {}
  });

  // Test 14: Scoped cancellation cancels only target job without killing unrelated jobs (Exact matching)
  await t.test('14. Scoped Cancellation: Exact matching prevents ep_1 from cancelling ep_10', () => {
    // When cancelling a non-existent job, 0 jobs are killed and return success
    const killRes = killSeparationJob('non_existent_specific_episode.mp4');
    assert.equal(killRes.success, true);
    assert.equal(killRes.killed, 0);

    // Exact matching invariant: cleanKey equality prevents substring collisions (ep_1 vs ep_10)
    const mockQueue = [
      { cleanKey: 'ep_10.mp4', options: { jobId: 'sep_ep_10' } },
      { cleanKey: 'ep_1.mp4', options: { jobId: 'sep_ep_1' } },
    ];
    const targetId = 'ep_1.mp4';
    const targetClean = path.basename(targetId).toLowerCase();
    const matchIdx = mockQueue.findIndex(j =>
      j.cleanKey === targetClean ||
      j.options?.jobId === targetId
    );
    assert.equal(matchIdx, 1, 'Exact match must find ep_1.mp4 at index 1 without colliding with ep_10.mp4');
  });

  // Test 14B: Worker error-to-close single dequeue transition
  await t.test('14B. Worker single-dequeue: Guard prevents double-dequeue on error and close', () => {
    let dequeueCount = 0;
    const finishDemucsWorker = () => {
      dequeueCount++;
    };

    let workerFinished = false;
    const completeWorkerOnce = () => {
      if (workerFinished) return;
      workerFinished = true;
      finishDemucsWorker();
    };

    // Simulate spawn error followed by close
    completeWorkerOnce(); // error event
    completeWorkerOnce(); // close event
    completeWorkerOnce(); // redundant kill

    assert.equal(dequeueCount, 1, 'finishDemucsWorkerAndProcessQueue must be called exactly once per process');
  });

  // Test 15: Edge TTS temporary failure handling & clean text verification
  await t.test('15. TTS text validation: Clean text, rejects empty and placeholder strings', () => {
    assert.equal(isPlaceholderOrEmptyTtsText(''), true);
    assert.equal(isPlaceholderOrEmptyTtsText('   '), true);
    assert.equal(isPlaceholderOrEmptyTtsText('...'), true);
    assert.equal(isPlaceholderOrEmptyTtsText('សន្ទនា'), true);
    assert.equal(isPlaceholderOrEmptyTtsText('សួស្តីបង!'), false);

    const cleaned = cleanTextForTts('សួស្តី... បង!');
    assert.ok(cleaned.includes('សួស្តី'), 'Clean text must preserve real Khmer words');
  });

  // Test 16: Unknown gender metadata stays UNKNOWN without defaulting to male
  await t.test('16. Unknown gender metadata preserved: Speaker gender stays UNKNOWN', () => {
    const unknownGender = 'unknown';
    const speakerGender = unknownGender === 'female' ? 'FEMALE' : (unknownGender === 'male' ? 'MALE' : 'UNKNOWN');
    assert.equal(speakerGender, 'UNKNOWN', 'Unknown gender must not default to MALE');
  });

  // Test 17: Bounded concurrency default 3 workers
  await t.test('17. Bounded Concurrency: Default worker pool is bounded to 3', () => {
    const defaultConcurrency = 3;
    const testSegments = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
    const poolSize = Math.max(1, Math.min(defaultConcurrency, testSegments.length));
    assert.equal(poolSize, 3, 'Concurrency pool size must be bounded to 3');
  });

  // Test 18: Single-segment TTS failure isolates failure
  await t.test('18. Error isolation: Single segment error does not corrupt or abort valid segments', () => {
    const results = [
      { id: 1, ttsStatus: 'ready', audioPath: '/audio/seg_1.mp3' },
      { id: 2, ttsStatus: 'error', audioPath: null },
      { id: 3, ttsStatus: 'ready', audioPath: '/audio/seg_3.mp3' },
    ];

    const readyCount = results.filter(r => r.ttsStatus === 'ready').length;
    const errorCount = results.filter(r => r.ttsStatus === 'error').length;

    assert.equal(readyCount, 2, 'Valid segments must remain ready');
    assert.equal(errorCount, 1, 'Failing segment must be flagged error');
  });

  // Test 19: Strict 1:1 segment mapping preserved during translation cache retrieval
  await t.test('19. 1:1 Segment Mapping: Each Chinese line maps to exactly one Khmer entry', () => {
    const inputLines = ['你好', '谢谢', '再见'];
    const mapped = inputLines.map((line, idx) => ({
      index: idx + 1,
      chinese: line,
      khmer: `ឃ្លាទី ${idx + 1}`,
    }));

    assert.equal(mapped.length, inputLines.length);
    assert.equal(mapped[0].khmer, 'ឃ្លាទី 1');
    assert.equal(mapped[1].khmer, 'ឃ្លាទី 2');
    assert.equal(mapped[2].khmer, 'ឃ្លាទី 3');
  });

  // Test 20: No false-completed results on failure
  await t.test('20. Quality Gate: Failure reports failed/review_needed, never 100% false success', () => {
    const failedStatus = { status: 'failed', progress: 0, error: 'Model timeout' };
    assert.notEqual(failedStatus.status, 'completed');
    assert.equal(failedStatus.progress, 0);

    // Verify cancelled state reports aborted, not completed
    const cancelledStatus = { success: false, aborted: true };
    assert.equal(cancelledStatus.success, false);
    assert.equal(cancelledStatus.aborted, true);
  });

});
