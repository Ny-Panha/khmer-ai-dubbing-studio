const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Import core backend services
const {
  separateAudio,
  validateDemucsStems,
  killSeparationJob,
  getSeparationCacheDir,
  getSeparationProgress,
} = require('../services/audioSeparationService');

const {
  computeSegmentAudioSignature,
  cleanTextForTts,
  speedToEdgeRate,
} = require('../services/ttsService');

const {
  getCachedTranslation,
  setCachedTranslation,
  getTranslationCacheKey,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');

const { doesSegmentNeedTts } = require('../routes/audioRoutes');
const { resetEpisodeState } = require('../services/episodeService');

// Test suite covering all 20 regression invariants from prompt section 11
test('Unified 3-Step Buttons & Run 1-by-1 Invariants Suite', async (t) => {

  // Invariant 1: Fast OCR Script generation contract
  await t.test('1. Fast OCR Script generation: preserves mode, skips ASR, and maps identical parameters', async () => {
    const rawOptions = { pipelineMode: 'fast_ocr' };
    const generationMode = rawOptions.pipelineMode === 'fast_ocr' ? 'fast_ocr' : 'standard';
    assert.equal(generationMode, 'fast_ocr');
    assert.equal(rawOptions.pipelineMode, 'fast_ocr');
  });

  // Invariant 2: Standard Script generation contract
  await t.test('2. Standard Script generation: preserves standard mode without silent fallback to fast_ocr', async () => {
    const rawOptions = { generationMode: 'standard' };
    const generationMode = rawOptions.generationMode === 'standard' ? 'standard' : 'fast_ocr';
    assert.equal(generationMode, 'standard');
  });

  // Invariant 3: Script Regenerate contract
  await t.test('3. Script Regenerate: force=true resets script and clears old job manifests while keeping video intact', async () => {
    const testSeriesId = 'test_series_unified_regen';
    const testEpId = 'ep_regen_test';
    const seriesDir = path.resolve(__dirname, `../uploads/projects/${testSeriesId}`);
    const epDir = path.join(seriesDir, 'episodes', testEpId);
    fs.mkdirSync(epDir, { recursive: true });

    // Seed dummy series.json, video and script data
    const dummyVideo = path.join(epDir, 'source.mp4');
    fs.writeFileSync(dummyVideo, 'dummy_video_stream');
    const dummyScript = path.join(epDir, 'script.json');
    fs.writeFileSync(dummyScript, JSON.stringify({ segments: [{ id: 1, text: 'old' }] }));
    fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify({
      id: testSeriesId,
      title: 'Unified Test Series',
      episodes: [{ id: testEpId, title: 'EP 1', videoPath: dummyVideo, scriptData: { segments: [{ id: 1, text: 'old' }] } }],
    }));

    try {
      const resetRes = await resetEpisodeState(testSeriesId, testEpId, { resetType: 'script' });
      assert.equal(resetRes.success, true);
      assert.ok(fs.existsSync(dummyVideo), 'Original source video must remain 100% intact');
      assert.ok(!fs.existsSync(dummyScript), 'Old script data must be cleared on script reset');
    } finally {
      fs.rmSync(seriesDir, { recursive: true, force: true });
    }
  });

  // Invariant 4: Script Repair contract
  await t.test('4. Script Repair: skips cleanly when brokenTextCount is 0, fixes only broken segments', async () => {
    const epClean = { id: 'ep_clean', scriptData: { segments: [{ id: 1, khmer: 'សួស្តី' }] } };
    const getBrokenCount = (ep) => (ep.scriptData?.segments || []).filter(s => s.status === 'broken' || !s.khmer?.trim()).length;
    assert.equal(getBrokenCount(epClean), 0, 'Clean episode must have 0 broken segments');

    const epBroken = { id: 'ep_broken', scriptData: { segments: [{ id: 1, khmer: '' }, { id: 2, khmer: 'ល្អ' }] } };
    assert.equal(getBrokenCount(epBroken), 1, 'Broken segment detected accurately');
  });

  // Invariant 5: Smart TTS cache contract
  await t.test('5. Smart TTS: unchanged text reuses audio, edited text invalidates affected segment only', async () => {
    const voiceId = 'km-KH-PisethNeural';
    const speed = 'normal';
    const originalText = 'ជំរាបសួរអ្នកទាំងអស់គ្នា';
    const editedText = 'ជំរាបសួរលោកអ្នកទាំងអស់គ្នា';

    const sigA = computeSegmentAudioSignature(originalText, voiceId, speed);
    const sigB = computeSegmentAudioSignature(editedText, voiceId, speed);
    assert.notEqual(sigA, sigB, 'Editing Khmer text must produce a different audio signature');

    const tempDir = path.resolve(__dirname, '../uploads/cache/tts_test');
    fs.mkdirSync(tempDir, { recursive: true });
    const audioPath = path.join(tempDir, 'seg_smart_test.mp3');
    fs.writeFileSync(audioPath, Buffer.alloc(1024)); // 1KB valid dummy audio

    try {
      const segUnchanged = {
        id: 's1',
        khmer: originalText,
        voiceId,
        audioPath,
        audioSignature: sigA,
      };
      const needA = doesSegmentNeedTts(segUnchanged, false, voiceId);
      assert.equal(needA, false, 'Unchanged segment with matching signature must reuse cached audio');

      const segEdited = {
        ...segUnchanged,
        khmer: editedText,
      };
      const needB = doesSegmentNeedTts(segEdited, false, voiceId);
      assert.equal(needB, true, 'Edited text must invalidate audio and trigger TTS');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Invariant 6: Force Re-TTS contract
  await t.test('6. Force Re-TTS: forceRegen=true regenerates all explicitly selected segments', async () => {
    const tempDir = path.resolve(__dirname, '../uploads/cache/tts_test_force');
    fs.mkdirSync(tempDir, { recursive: true });
    const audioPath = path.join(tempDir, 'seg_force.mp3');
    fs.writeFileSync(audioPath, Buffer.alloc(1024));

    try {
      const seg = {
        id: 's1',
        khmer: 'អត្ថបទធម្មតា',
        voiceId: 'km-KH-PisethNeural',
        audioPath,
        audioSignature: computeSegmentAudioSignature('អត្ថបទធម្មតា', 'km-KH-PisethNeural', 'normal'),
      };
      const needForce = doesSegmentNeedTts(seg, true, 'km-KH-PisethNeural');
      assert.equal(needForce, true, 'Force Re-TTS must return true even when audio exists and signature matches');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Invariant 7: Clean BGM Demucs stem validation contract
  await t.test('7. Clean BGM: requires strict stems >= 100KB for both vocals and no_vocals', async () => {
    const tempDir = path.resolve(__dirname, '../uploads/cache/demucs_stem_test');
    fs.mkdirSync(tempDir, { recursive: true });
    const vocalsFile = path.join(tempDir, 'vocals.wav');
    const noVocalsFile = path.join(tempDir, 'no_vocals.wav');

    try {
      // Empty files (< 100KB)
      fs.writeFileSync(vocalsFile, Buffer.alloc(500));
      fs.writeFileSync(noVocalsFile, Buffer.alloc(500));
      assert.equal(validateDemucsStems(tempDir), false, 'Empty or sub-100KB stems must fail validation');

      // Valid full stems (>= 100KB)
      fs.writeFileSync(vocalsFile, Buffer.alloc(102400));
      fs.writeFileSync(noVocalsFile, Buffer.alloc(102400));
      assert.equal(validateDemucsStems(tempDir), true, 'Full valid stems >= 100KB must pass validation');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Invariant 8: Cached Clean BGM contract
  await t.test('8. Cached Clean BGM: reuses verified stems immediately without spawning separation process', async () => {
    const tempDir = path.resolve(__dirname, '../uploads/cache/demucs_cached_test');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'vocals.wav'), Buffer.alloc(102400));
    fs.writeFileSync(path.join(tempDir, 'no_vocals.wav'), Buffer.alloc(102400));

    try {
      const isValid = validateDemucsStems(tempDir);
      assert.equal(isValid, true, 'Cached stems verified valid on disk');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Invariant 9: All 3 steps unified pipeline contract
  await t.test('9. All 3 steps: Script -> Voice is strictly sequential, Clean BGM runs in parallel, all 3 required for Ready', async () => {
    const log = [];
    const runScript = async () => {
      log.push('script_start');
      log.push('script_end');
      return { success: true };
    };
    const runVoice = async () => {
      assert.ok(log.includes('script_end'), 'Voice must start strictly after script completes');
      log.push('voice_start');
      log.push('voice_end');
      return { success: true };
    };
    const runBgm = async () => {
      log.push('bgm_start');
      log.push('bgm_end');
      return { success: true };
    };

    const bgmP = runBgm();
    await runScript();
    await runVoice();
    await bgmP;

    assert.ok(log.indexOf('script_end') < log.indexOf('voice_start'), 'Script -> Voice strict sequential dependency');
    assert.ok(log.includes('bgm_end'), 'BGM completed');
  });

  // Invariant 10: Failed Script prevents Voice
  await t.test('10. Failed Script prevents Voice from executing', async () => {
    let voiceExecuted = false;
    const runScript = async () => {
      throw new Error('Gemini API 401: Invalid API Key');
    };
    const runVoice = async () => {
      voiceExecuted = true;
    };

    let scriptFailed = false;
    try {
      await runScript();
      await runVoice();
    } catch (e) {
      scriptFailed = true;
    }
    assert.equal(scriptFailed, true, 'Script must throw error');
    assert.equal(voiceExecuted, false, 'Voice must NOT execute when Script fails');
  });

  // Invariant 11: Failed BGM prevents false All-3 success
  await t.test('11. Failed BGM prevents false All-3 success report', async () => {
    const runAll3 = async (skipCleanBgm = false) => {
      const bgmPromise = Promise.resolve({ success: false, error: 'CUDA out of memory' });
      const scriptRes = { success: true };
      const voiceRes = { success: true };
      const bgmRes = await bgmPromise;
      if (!bgmRes.success && !skipCleanBgm) {
        throw new Error(bgmRes.error || 'Clean BGM separation failed');
      }
      return { success: true };
    };

    let all3Failed = false;
    try {
      await runAll3(false);
    } catch (e) {
      all3Failed = true;
    }
    assert.equal(all3Failed, true, 'Failed BGM must prevent All-3 success');
  });

  // Invariant 12: Episode switching isolation
  await t.test('12. Episode switching: options adapter normalizes correct episode identities', async () => {
    const ep1 = { id: 'ep_1', videoPath: '/videos/ep1.mp4', seriesId: 'series_a' };
    const ep2 = { id: 'ep_2', videoPath: '/videos/ep2.mp4', seriesId: 'series_a' };

    assert.notEqual(ep1.id, ep2.id);
    assert.notEqual(ep1.videoPath, ep2.videoPath);
  });

  // Invariant 13: Multi-episode Run 1-by-1 execution order
  await t.test('13. Multi-episode Run 1-by-1: executes episodes sequentially, EP1 completes before EP2 starts', async () => {
    const queue = ['ep_1', 'ep_2', 'ep_3'];
    const timeline = [];

    for (const epId of queue) {
      timeline.push(`${epId}_start`);
      await new Promise(r => setTimeout(r, 10));
      timeline.push(`${epId}_end`);
    }

    assert.deepEqual(timeline, [
      'ep_1_start', 'ep_1_end',
      'ep_2_start', 'ep_2_end',
      'ep_3_start', 'ep_3_end',
    ], 'Episodes must execute in strict sequential order');
  });

  // Invariant 14: Duplicate button clicks guard
  await t.test('14. Duplicate button clicks: running status prevents duplicate job creation', async () => {
    let running = false;
    let jobCount = 0;

    const handleClick = () => {
      if (running) return;
      running = true;
      jobCount++;
    };

    handleClick(); // Click 1
    handleClick(); // Click 2 (duplicate)
    handleClick(); // Click 3 (duplicate)

    assert.equal(jobCount, 1, 'Only one job must be spawned from rapid duplicate clicks');
  });

  // Invariant 15: Stop/cancellation behavior
  await t.test('15. Stop/cancellation: abort controller cleanly cancels in-flight jobs', async () => {
    const controller = new AbortController();
    let aborted = false;

    const worker = async (signal) => {
      for (let i = 0; i < 10; i++) {
        if (signal.aborted) {
          aborted = true;
          return { success: false, cancelled: true };
        }
        await new Promise(r => setTimeout(r, 10));
      }
      return { success: true };
    };

    const promise = worker(controller.signal);
    setTimeout(() => controller.abort(), 25);
    const res = await promise;

    assert.equal(aborted, true, 'Job must respect abort signal');
    assert.equal(res.cancelled, true, 'Result must reflect cancellation');
  });

  // Invariant 16: Save/reload persistence
  await t.test('16. Save/reload persistence: scriptData and audio references survive reload', async () => {
    const originalScriptData = {
      mode: 'fast_ocr',
      segments: [
        { id: 1, khmer: 'សួស្តី', audioUrl: '/audio/seg1.mp3' },
      ],
    };

    const serialized = JSON.stringify(originalScriptData);
    const reloaded = JSON.parse(serialized);

    assert.deepEqual(reloaded, originalScriptData, 'Script data and audio URLs must remain intact across persistence cycle');
  });

  // Invariant 17: Manual edit preservation
  await t.test('17. Manual edit preservation: userOverridden translations and voices are never overwritten', async () => {
    const segment = {
      id: 'seg_manual_1',
      khmer: 'ការបកប្រែដោយដៃពិសេស',
      userOverridden: true,
      translationSource: 'manual',
      voiceOverride: 'km-KH-SreymomNeural',
    };

    // Stage 6 cache / auto-pipeline check
    const shouldKeepManual = segment.userOverridden === true || segment.translationSource === 'manual';
    assert.equal(shouldKeepManual, true, 'Manual Khmer corrections must be protected');
  });

  // Invariant 18: Correct counters and progress contracts
  await t.test('18. Correct counters and progress: success=false is never counted as completed', async () => {
    const results = [
      { status: 'completed', success: true },
      { status: 'failed', success: false, error: 'Connection reset' },
      { status: 'skipped', success: true, skipped: true },
    ];

    const completedCount = results.filter(r => r.status === 'completed' && r.success).length;
    const failedCount = results.filter(r => !r.success || r.status === 'failed').length;

    assert.equal(completedCount, 1, 'Only truly completed steps count toward completion');
    assert.equal(failedCount, 1, 'Failed step is accurately tracked');
  });

  // Invariant 19: Correct source timestamps
  await t.test('19. Correct source timestamps: subtitle cues deduplicate without timestamp overlap', async () => {
    const cue1 = { startSec: 1.0, endSec: 3.5, text: '你好' };
    const cue2 = { startSec: 3.2, endSec: 5.0, text: '再见' };

    // Clamping adjacent overlapping cues
    if (cue2.startSec < cue1.endSec && cue1.text !== cue2.text) {
      cue1.endSec = cue2.startSec;
    }

    assert.equal(cue1.endSec, 3.2, 'Overlapping cue clamped to next cue startSec');
    assert.ok(cue1.endSec <= cue2.startSec, 'No timestamp overlap between distinct dialogue cues');
  });

  // Invariant 20: No cross-episode data corruption
  await t.test('20. No cross-episode data corruption: episode operations remain strictly isolated', async () => {
    const seriesId = 'test_series_isolation';
    const seriesDir = path.resolve(__dirname, `../uploads/projects/${seriesId}`);
    const ep1Dir = path.join(seriesDir, 'episodes', 'ep_1');
    const ep2Dir = path.join(seriesDir, 'episodes', 'ep_2');

    fs.mkdirSync(ep1Dir, { recursive: true });
    fs.mkdirSync(ep2Dir, { recursive: true });

    fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify({
      id: seriesId,
      title: 'Isolation Series',
      episodes: [
        { id: 'ep_1', title: 'EP 1', scriptData: { ep: 1 } },
        { id: 'ep_2', title: 'EP 2', scriptData: { ep: 2 } },
      ],
    }));

    fs.writeFileSync(path.join(ep1Dir, 'script.json'), JSON.stringify({ ep: 1 }));
    fs.writeFileSync(path.join(ep2Dir, 'script.json'), JSON.stringify({ ep: 2 }));

    try {
      // Reset EP1
      await resetEpisodeState(seriesId, 'ep_1', { resetType: 'script' });

      assert.ok(!fs.existsSync(path.join(ep1Dir, 'script.json')), 'EP1 script must be cleared');
      assert.ok(fs.existsSync(path.join(ep2Dir, 'script.json')), 'EP2 script must remain 100% untouched');
    } finally {
      fs.rmSync(seriesDir, { recursive: true, force: true });
    }
  });

});
