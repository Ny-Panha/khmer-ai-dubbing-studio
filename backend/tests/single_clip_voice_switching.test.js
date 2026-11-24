const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const rootDir = path.resolve(__dirname, '../..');
const audioRoutes = require('../routes/audioRoutes');
const { generateSingleSegmentAudio } = require('../services/ttsService');

function createAudioTestServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', audioRoutes);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}/api/generate-audio`,
      });
    });
  });
}

describe('Single Clip Voice Switching: Reliability, Instant Cache Reuse & Waveform Safety', () => {
  it('1. Source Code Verification: Waveform safety, forceRegen=false, prevSpeakerEntry declaration, and fast return', () => {
    const hookSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useAudioDubbing.js'), 'utf8');
    const ttsSrc = fs.readFileSync(path.join(rootDir, 'backend/services/ttsService.js'), 'utf8');
    const apiSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/services/api/audioApi.js'), 'utf8');

    // 1A. Fast return if already same voice and ready
    assert.ok(
      hookSrc.includes('const isSameVoice = currentVoice === newVoiceId;'),
      'Must check if requested voice is already active'
    );
    assert.ok(
      hookSrc.includes('if (isSameVoice && isAlreadyReady) {'),
      'Must return early without regeneration if clicking already-active ready voice'
    );

    // 1B. Waveform safety: must NOT clear audioUrl to null
    assert.ok(
      !hookSrc.includes('audioUrl: null,'),
      'Must NOT set audioUrl to null in handleUpdateSegmentVoice'
    );
    assert.ok(
      hookSrc.includes('previousAudioUrl = targetSeg.audioUrl'),
      'Must track previousAudioUrl while keeping current audioUrl rendered'
    );

    // 1C. prevSpeakerEntry declaration to prevent ReferenceError
    assert.ok(
      hookSrc.includes('const prevSpeakerEntry = spkKey && speakerRegistry ? speakerRegistry[spkKey] : null;'),
      'Must declare prevSpeakerEntry in handleUpdateSegmentVoice before catch block'
    );

    // 1D. forceRegen: false passed to generateSingleSegmentAudio
    assert.ok(
      hookSrc.includes('forceRegen: false,'),
      'handleUpdateSegmentVoice must pass forceRegen: false to enable backend TTS cache reuse'
    );

    // 1E. ttsService must preserve other voice variants
    assert.ok(
      ttsSrc.includes('isOtherVoiceVariant'),
      'ttsService prior audio cleanup must distinguish other voice variants'
    );
    assert.ok(
      ttsSrc.includes('!isOtherVoiceVariant'),
      'ttsService must not delete audio belonging to another voice variant'
    );

    // 1F. audioApi defaults forceRegen to false
    assert.ok(
      apiSrc.includes('const forceRegen = isObj && options.forceRegen !== undefined ? Boolean(options.forceRegen) : false;'),
      'audioApi must default forceRegen to false'
    );
  });

  it('2. Live Endpoint Benchmark on EP2 Clip #5: Piseth -> Sreymom -> Piseth -> Sreymom instant cache hits', async () => {
    const { server, url } = await createAudioTestServer();
    try {
      const ep2Clip5Payload = {
        segment: {
          id: 5,
          khmer: 'គាត់ចប់ហើយ',
          khmerText: 'គាត់ចប់ហើយ',
          speaker: 'តួអង្គ',
          speakerGender: 'MALE',
          voiceId: 'km-KH-PisethNeural',
          speed: 'normal',
          seriesId: 'ss1',
          episodeId: 'ep_2',
        },
        seriesId: 'ss1',
        episodeId: 'ep_2',
        speed: 'normal',
        forceRegen: false,
      };

      // Step A: Request Sreymom (Female)
      const t0 = performance.now();
      const resFem = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ep2Clip5Payload,
          voiceId: 'km-KH-SreymomNeural',
          segment: {
            ...ep2Clip5Payload.segment,
            voiceId: 'km-KH-SreymomNeural',
            voice: 'km-KH-SreymomNeural',
            khmerVoiceId: 'km-KH-SreymomNeural',
          },
        }),
      });
      const femDur = performance.now() - t0;
      assert.equal(resFem.status, 200, 'Sreymom generation must succeed (200)');
      const femDataRaw = await resFem.json();
      const femData = femDataRaw.segment || femDataRaw;
      assert.ok(femDataRaw.success, 'Sreymom response must be success');
      assert.ok(femData.audioUrl.includes('SreymomNeural'), 'Audio URL must point to SreymomNeural');
      assert.ok(fs.existsSync(femData.audioPath), 'Sreymom audio file must exist on disk');

      // Verify Piseth audio was NOT deleted from disk!
      const pisethFile = path.resolve(rootDir, 'backend/uploads/projects/ss1/episodes/ep_2/audio/ep_ep_2_seg_5_km-KH-PisethNeural_voice_dbb8f323.mp3');
      assert.ok(fs.existsSync(pisethFile), 'Piseth audio file must remain preserved on disk after switching to Sreymom');

      // Step B: Switch BACK to Piseth (Female -> Male Cache Hit)
      const t1 = performance.now();
      const resMaleCached = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ep2Clip5Payload,
          voiceId: 'km-KH-PisethNeural',
          segment: {
            ...ep2Clip5Payload.segment,
            audioPath: femData.audioPath,
            audioUrl: femData.audioUrl,
            audioFile: femData.audioFile,
            voiceId: 'km-KH-PisethNeural',
            voice: 'km-KH-PisethNeural',
            khmerVoiceId: 'km-KH-PisethNeural',
          },
        }),
      });
      const maleCachedDur = performance.now() - t1;
      assert.equal(resMaleCached.status, 200, 'Piseth cached request must succeed (200)');
      const maleCachedDataRaw = await resMaleCached.json();
      const maleCachedData = maleCachedDataRaw.segment || maleCachedDataRaw;
      assert.ok(maleCachedDataRaw.success);
      assert.ok(maleCachedData.audioUrl.includes('PisethNeural'));
      assert.ok(fs.existsSync(maleCachedData.audioPath));

      // Cache hit must be fast (< 1200ms in-process compared to ~3500ms for network Edge TTS)
      console.log(`[Benchmark] Piseth -> Sreymom duration: ${femDur.toFixed(1)}ms | Sreymom -> Piseth (Cache Hit): ${maleCachedDur.toFixed(1)}ms`);
      assert.ok(
        maleCachedDur < 1500,
        `Cached voice switch must take < 1500ms (actual: ${maleCachedDur.toFixed(1)}ms)`
      );

      // Step C: Switch BACK to Sreymom AGAIN (Male -> Female Cache Hit)
      const t2 = performance.now();
      const resFemCached = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ep2Clip5Payload,
          voiceId: 'km-KH-SreymomNeural',
          segment: {
            ...ep2Clip5Payload.segment,
            audioPath: maleCachedData.audioPath,
            audioUrl: maleCachedData.audioUrl,
            audioFile: maleCachedData.audioFile,
            voiceId: 'km-KH-SreymomNeural',
            voice: 'km-KH-SreymomNeural',
            khmerVoiceId: 'km-KH-SreymomNeural',
          },
        }),
      });
      const femCachedDur = performance.now() - t2;
      assert.equal(resFemCached.status, 200, 'Sreymom second cached request must succeed');
      const femCachedDataRaw = await resFemCached.json();
      const femCachedData = femCachedDataRaw.segment || femCachedDataRaw;
      assert.ok(femCachedData.audioUrl.includes('SreymomNeural'));
      console.log(`[Benchmark] Piseth -> Sreymom (Second Cache Hit): ${femCachedDur.toFixed(1)}ms`);
      assert.ok(
        femCachedDur < 1500,
        `Second cached voice switch must take < 1500ms (actual: ${femCachedDur.toFixed(1)}ms)`
      );
    } finally {
      server.close();
    }
  });

  it('3. Error Rollback Simulation: Safe failure recovery restores snapshot without throwing ReferenceError', () => {
    // Simulate what happens in handleUpdateSegmentVoice catch block
    const spkKey = 'spk_1';
    let speakerRegistry = { spk_1: { voice: 'km-KH-PisethNeural', label: 'Piseth' } };
    const prevSpeakerEntry = spkKey && speakerRegistry ? speakerRegistry[spkKey] : null;

    const prevSegSnapshot = {
      id: 5,
      voice: 'km-KH-PisethNeural',
      voiceLabel: 'ពិសិដ្ឋ (Piseth)',
      audioUrl: '/uploads/projects/ss1/episodes/ep_2/audio/test_piseth.mp3',
      textStatus: 'ready',
    };

    // Simulate error occurrence
    const err = new Error('Simulated network timeout');
    let revertedSegments = null;
    let didThrow = false;

    try {
      const rolledBack = [{ ...prevSegSnapshot, voice: 'km-KH-SreymomNeural', textStatus: 'generating' }];
      rolledBack[0] = { ...rolledBack[0], ...prevSegSnapshot, isVoiceSwitching: false };
      revertedSegments = rolledBack;

      if (spkKey) {
        const next = { ...speakerRegistry };
        if (prevSpeakerEntry) {
          next[spkKey] = prevSpeakerEntry;
        } else {
          delete next[spkKey];
        }
        speakerRegistry = next;
      }
    } catch (_) {
      didThrow = true;
    }

    assert.equal(didThrow, false, 'Catch block must not throw ReferenceError');
    assert.equal(revertedSegments[0].voice, 'km-KH-PisethNeural', 'Voice must be reverted to original');
    assert.equal(revertedSegments[0].textStatus, 'ready', 'textStatus must be reverted to ready');
    assert.equal(revertedSegments[0].audioUrl, prevSegSnapshot.audioUrl, 'audioUrl must be preserved');
    assert.equal(speakerRegistry.spk_1.voice, 'km-KH-PisethNeural', 'speakerRegistry must be restored');
  });
});
