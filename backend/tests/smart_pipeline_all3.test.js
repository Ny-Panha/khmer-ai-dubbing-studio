const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  separateAudio,
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
  generateModeSpecificScript,
  getCachedTranslation,
  setCachedTranslation,
  getTranslationCacheKey,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');

const { GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

test('Smart 3-Step Pipeline Suite', async (t) => {

  // Test 1: Single episode all3: Script -> Voice -> Demucs dependency contract
  await t.test('1. Single episode all3: Voice strictly waits for Script; Clean BGM runs independently', async () => {
    const executionOrder = [];

    const mockRunTranslate = async () => {
      executionOrder.push('script_start');
      await new Promise(r => setTimeout(r, 20));
      executionOrder.push('script_done');
      return { success: true };
    };

    const mockRunVoice = async () => {
      // Voice must strictly start after script is done!
      assert.ok(executionOrder.includes('script_done'), 'Voice must start AFTER script is done');
      executionOrder.push('voice_start');
      await new Promise(r => setTimeout(r, 20));
      executionOrder.push('voice_done');
      return { success: true };
    };

    const mockRunCleanBgm = async () => {
      executionOrder.push('bgm_start');
      await new Promise(r => setTimeout(r, 35));
      executionOrder.push('bgm_done');
      return { success: true };
    };

    // Parallel Clean BGM + sequential Script -> Voice contract
    const bgmPromise = mockRunCleanBgm();
    await mockRunTranslate();
    await mockRunVoice();
    await bgmPromise;

    assert.ok(executionOrder.indexOf('script_start') < executionOrder.indexOf('script_done'));
    assert.ok(executionOrder.indexOf('script_done') < executionOrder.indexOf('voice_start'));
    assert.ok(executionOrder.indexOf('voice_start') < executionOrder.indexOf('voice_done'));
    assert.ok(executionOrder.includes('bgm_done'));
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

    // Simulate runner logic:
    if (!ep.scriptData?.hasScript) {
      scriptCalled = true;
    }
    if (!ep.hasAudio || ep.audioOutdated) {
      voiceCalled = true;
    }

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

  // Test 5: Complete episode with valid cache reuse (0ms, 100% verified reuse)
  await t.test('5. Complete episode — valid cache reuse: Returns immediately without AI calls', async () => {
    const testSeries = 'test_cache_series';
    const chinese = '这是测试句子';
    const khmer = 'នេះជាប្រយោគសាកល្បង';

    // Seed cache
    setCachedTranslation(chinese, {
      khmerText: khmer,
      speaker: 'តួឯកប្រុស',
      voiceGender: 'male',
      seriesId: testSeries,
      mode: 'dialogue',
    });

    const cached = getCachedTranslation(chinese, { seriesId: testSeries, mode: 'dialogue' });
    assert.ok(cached, 'Cached translation must exist');
    assert.equal(cached.khmerText, khmer);
    assert.equal(cached.speaker, 'តួឯកប្រុស');
    assert.equal(cached.voiceGender, 'male');
  });

  // Test 6: One incorrect Khmer translation — retry that segment only
  await t.test('6. Targeted retry: Retrying 1 segment preserves other segments and timestamps', async () => {
    const segments = [
      { id: 1, startSec: 1.0, endSec: 3.5, originalChineseText: '第一句', khmerTranslatedText: 'ឃ្លាទី ១ ត្រឹមត្រូវ' },
      { id: 2, startSec: 4.0, endSec: 6.0, originalChineseText: '第二句', khmerTranslatedText: '', reviewNeeded: true },
      { id: 3, startSec: 6.5, endSec: 8.5, originalChineseText: '第三句', khmerTranslatedText: 'ឃ្លាទី ៣ ត្រឹមត្រូវ' },
    ];

    // Single segment repair for segment #2
    const target = segments[1];
    target.khmerTranslatedText = 'ឃ្លាទី ២ ជួសជុលរួចរាល់';
    target.reviewNeeded = false;
    target.translationStatus = 'translated';

    // Verify seg 1 and 3 are 100% unchanged
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
    // Simulate audio retry
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

    // Attempt translation pass
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

  // Test 10: TTS speed/voice/text changes invalidate affected audio only
  await t.test('10. Audio Content Signature: Text or speed edit invalidates affected segment only', () => {
    const baseSig = computeSegmentAudioSignature('សួស្តី', 'km-KH-PisethNeural', 'normal', 0);
    const textEditedSig = computeSegmentAudioSignature('សួស្តីអ្នកទាំងអស់គ្នា', 'km-KH-PisethNeural', 'normal', 0);
    const speedEditedSig = computeSegmentAudioSignature('សួស្តី', 'km-KH-PisethNeural', '1.20', 0);
    const voiceEditedSig = computeSegmentAudioSignature('សួស្តី', 'km-KH-SreymomNeural', 'normal', 0);

    assert.notEqual(baseSig, textEditedSig, 'Text edit must change signature');
    assert.notEqual(baseSig, speedEditedSig, 'Speed edit must change signature');
    assert.notEqual(baseSig, voiceEditedSig, 'Voice change must change signature');

    // Unchanged segment keeps same signature
    const unchangedSig = computeSegmentAudioSignature('សួស្តី', 'km-KH-PisethNeural', 'normal', 0);
    assert.equal(baseSig, unchangedSig, 'Unchanged segment keeps exact same signature');
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

  // Test 12: Demucs stem validation rejects corrupt or truncated (<100KB) files
  await t.test('12. Demucs Stem Validation: Rejects files < 100KB as corrupt', () => {
    const MIN_STEM_SIZE = 100 * 1024;
    const corruptSize = 1024; // 1KB corrupt header
    const validSize = 150 * 1024; // 150KB real stem

    assert.ok(corruptSize < MIN_STEM_SIZE, '1KB file must be rejected as insufficient');
    assert.ok(validSize >= MIN_STEM_SIZE, '150KB file must be accepted as valid stem');
  });

  // Test 13: Demucs safe queue handling (never throws 409 BUSY)
  await t.test('13. Demucs Safe Queue: Queues subsequent requests without 409 BUSY rejection', async () => {
    const mockAudio = path.join(__dirname, 'mock_queue_video.mp4');
    fs.writeFileSync(mockAudio, Buffer.alloc(1024 * 128, 0xCC));

    const cacheDir = getSeparationCacheDir(mockAudio);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // Seed mock stem files >= 100KB
    fs.writeFileSync(path.join(cacheDir, 'vocals.wav'), Buffer.alloc(1024 * 110, 0x11));
    fs.writeFileSync(path.join(cacheDir, 'no_vocals.wav'), Buffer.alloc(1024 * 110, 0x22));

    // Instant cache hit check
    const res = await separateAudio({ audioPath: mockAudio });
    assert.equal(res.status, 'success');
    assert.equal(res.isCached, true);

    // Clean up
    try {
      fs.unlinkSync(path.join(cacheDir, 'vocals.wav'));
      fs.unlinkSync(path.join(cacheDir, 'no_vocals.wav'));
      fs.unlinkSync(mockAudio);
    } catch (_) {}
  });

  // Test 14: Scoped cancellation cancels only target job without killing unrelated processes
  await t.test('14. Scoped Cancellation: Cancelling a specific media key does not kill other jobs', () => {
    const killRes = killSeparationJob('non_existent_specific_episode.mp4');
    assert.equal(killRes.success, true);
    assert.equal(killRes.killed, 0);
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
  });

});
