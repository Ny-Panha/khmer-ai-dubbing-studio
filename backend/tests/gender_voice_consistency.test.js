const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

const {
  detectSpeakerGender,
  syncSegmentsWithSpeakerRegistry,
} = require('../models/speakerRegistry');
const { createSegment } = require('../models/segmentModel');
const { reconcileTimelineEvidence } = require('../services/pipeline/stages/stage5_reconcileTimelineEvidence');
const {
  generateModeSpecificScript,
  createCanonicalSegment,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { generateSingleSegmentAudio, cleanTextForTts } = require('../services/ttsService');
const { getSeriesMetadata } = require('../services/episodeService');
const { GENERATION_MODES } = require('../services/pipeline/pipelineTypes');

test('Speaker Gender Keywords: "ប្រព័ន្ធ" defaults Female (Sreymom) and substring collisions are prevented', () => {
  assert.equal(detectSpeakerGender('ប្រព័ន្ធ'), 'FEMALE');
  assert.equal(detectSpeakerGender('ប្រព័ន្ធ', 'unknown'), 'FEMALE');
  assert.equal(detectSpeakerGender('ប្រព័ន្ធ AI', 'unknown'), 'FEMALE');
  assert.equal(detectSpeakerGender('AI System', ''), 'FEMALE');
  assert.equal(detectSpeakerGender('系统提示', 'unknown'), 'FEMALE');

  // Former Khmer short-token collisions ('មា', 'តា', 'ពូ' inside female words)
  assert.equal(detectSpeakerGender('កុមារី'), 'FEMALE');
  assert.equal(detectSpeakerGender('មាតា'), 'FEMALE');
  assert.equal(detectSpeakerGender('ធីតា'), 'FEMALE');

  // Standalone Khmer male tokens still match cleanly
  assert.equal(detectSpeakerGender('លោកតា'), 'MALE');
  assert.equal(detectSpeakerGender('តា'), 'MALE');
  assert.equal(detectSpeakerGender('ពូ'), 'MALE');

  // Former English 'her' substring collisions inside 'brother', 'father', 'hero', 'teacher'
  assert.equal(detectSpeakerGender('Brother Lin'), 'MALE');
  assert.equal(detectSpeakerGender('Father'), 'MALE');
  assert.equal(detectSpeakerGender('Grandfather'), 'MALE');
  assert.equal(detectSpeakerGender('Hero'), 'MALE');
  assert.equal(detectSpeakerGender('Heroine'), 'FEMALE');
  assert.equal(detectSpeakerGender('Teacher'), 'UNKNOWN');
});

test('SpeakerRegistry: Unifies split named IDs, blocks bare-name overwrite & generic collusion, preserves manual override', () => {
  const segments = [];
  for (let i = 1; i <= 15; i++) {
    segments.push({
      id: i,
      segmentId: i,
      startSec: i * 2,
      endSec: i * 2 + 1.5,
      speaker: 'ប្រព័ន្ធ',
      speakerId: 'spk_female_ប្រព_ន្ធ',
      voiceGender: 'female',
      khmerText: `សារប្រព័ន្ធ ${i}`,
    });
  }
  // Minority flipped cluster placed later (previously overwrote finalizedRegistry['ប្រព័ន្ធ'])
  for (let i = 16; i <= 17; i++) {
    segments.push({
      id: i,
      segmentId: i,
      startSec: i * 2,
      endSec: i * 2 + 1.5,
      speaker: 'ប្រព័ន្ធ',
      speakerId: 'spk_male_ប្រព_ន្ធ',
      voiceGender: 'male',
      khmerText: `សារប្រព័ន្ធច្រឡំ ${i}`,
    });
  }
  // Single userOverridden segment forced to Piseth must remain Piseth
  segments.push({
    id: 18,
    segmentId: 18,
    startSec: 36,
    endSec: 37.5,
    speaker: 'ប្រព័ន្ធ',
    speakerId: 'spk_sys_override',
    userOverridden: true,
    voiceAssignmentSource: 'manual',
    voiceGender: 'male',
    voiceId: 'km-KH-PisethNeural',
    voiceOverride: 'km-KH-PisethNeural',
    khmerText: 'សារប្រព័ន្ធកែដៃ',
  });
  // Two generic 'តួអង្គ' segments of opposite gender must NOT collide via registry['តួអង្គ']
  segments.push({
    id: 19,
    segmentId: 19,
    startSec: 38,
    endSec: 39.5,
    speaker: 'តួអង្គ',
    speakerId: 'spk_male_19',
    voiceGender: 'male',
    khmerText: 'ឃ្លាប្រុស',
  });
  segments.push({
    id: 20,
    segmentId: 20,
    startSec: 40,
    endSec: 41.5,
    speaker: 'តួអង្គ',
    speakerId: 'spk_female_20',
    voiceGender: 'female',
    khmerText: 'ឃ្លាស្រី',
  });

  const synced = syncSegmentsWithSpeakerRegistry(segments, {});
  assert.equal(synced.speakerMap['ប្រព័ន្ធ']?.voiceId, 'km-KH-SreymomNeural');
  assert.equal(synced.speakerMap['តួអង្គ'], undefined, 'Generic តួអង្គ must not occupy bare name key in registry');

  for (let idx = 0; idx < 17; idx++) {
    assert.equal(synced.segments[idx].voiceGender, 'female');
    assert.equal(synced.segments[idx].voiceId, 'km-KH-SreymomNeural');
  }

  assert.equal(synced.segments[17].userOverridden, true);
  assert.equal(synced.segments[17].voiceId, 'km-KH-PisethNeural');

  assert.equal(synced.segments[18].voiceId, 'km-KH-PisethNeural');
  assert.equal(synced.segments[19].voiceId, 'km-KH-SreymomNeural');
});

test('Stage 6 Standard Mode: Protects explicit roles from noisy YIN pitch, defaults System to Sreymom, and enforces consistency', async () => {
  const reconciledSegments = [];
  for (let i = 0; i < 22; i++) {
    if (i < 8) {
      reconciledSegments.push({
        id: i + 1,
        segmentId: i + 1,
        startSec: i * 3,
        endSec: i * 3 + 2,
        duration: 2,
        originalChineseText: `男主台词${i + 1}`,
        voiceGender: i === 2 ? 'female' : 'male',
        pitchHz: i === 2 ? 198 : 125, // noisy high YIN on seg #3 of តួឯកប្រុស
        voiceId: i === 2 ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural',
      });
    } else if (i < 13) {
      reconciledSegments.push({
        id: i + 1,
        segmentId: i + 1,
        startSec: i * 3,
        endSec: i * 3 + 2,
        duration: 2,
        originalChineseText: `系统提示${i + 1}`,
        voiceGender: 'unknown',
        pitchHz: i === 9 ? 138 : null, // noisy low pitch on ប្រព័ន្ធ
      });
    } else {
      reconciledSegments.push({
        id: i + 1,
        segmentId: i + 1,
        startSec: i * 3,
        endSec: i * 3 + 2,
        duration: 2,
        originalChineseText: `角色台词${i + 1}`,
        voiceGender: i === 21 ? 'male' : 'female',
        pitchHz: i === 21 ? 130 : 210,
      });
    }
  }

  let callNum = 0;
  const mockAiClient = {
    models: {
      generateContent: async () => {
        callNum++;
        if (callNum === 1) {
          const segs = [];
          for (let idx = 1; idx <= 20; idx++) {
            if (idx <= 8) {
              segs.push({ index: idx, speaker: 'តួឯកប្រុស', gender: 'male', khmerText: `ប្រុស ${idx}` });
            } else if (idx <= 13) {
              segs.push({ index: idx, speaker: 'ប្រព័ន្ធ', gender: idx === 10 ? 'male' : 'unknown', khmerText: `ប្រព័ន្ធ ${idx}` });
            } else {
              segs.push({ index: idx, speaker: 'សៀវអ៊ី', gender: 'female', khmerText: `សៀវអ៊ី ${idx}` });
            }
          }
          return { text: JSON.stringify({ summary: 'std', detectedGenre: 'modern', segments: segs }) };
        }
        return {
          text: JSON.stringify({
            summary: 'std',
            detectedGenre: 'modern',
            segments: [
              // Batch 2 flips សៀវអ៊ី to male once -> majority (7F vs 1M + high pitch) must correct to female/Sreymom
              { index: 21, speaker: 'សៀវអ៊ី', gender: 'female', khmerText: 'សៀវអ៊ី ២១' },
              { index: 22, speaker: 'សៀវអ៊ី', gender: 'male', khmerText: 'សៀវអ៊ី ច្រឡំ' },
            ],
          }),
        };
      },
    },
  };

  const res = await generateModeSpecificScript({
    mode: GENERATION_MODES.MODE_A_DIALOGUE,
    reconciledSegments,
    durationSec: 90,
    aiClient: mockAiClient,
    narratorGender: 'male',
  });

  // តួឯកប្រុស lines (incl idx 2 with noisy 198Hz pitch) stay male / Piseth & not tagged ocr_only
  for (let i = 0; i < 8; i++) {
    assert.equal(res.scriptSegments[i].speaker, 'តួឯកប្រុស');
    assert.equal(res.scriptSegments[i].voiceGender, 'male');
    assert.equal(res.scriptSegments[i].voiceId, 'km-KH-PisethNeural');
    assert.notEqual(res.scriptSegments[i].speakerSource, 'ocr_only');
  }

  // ប្រព័ន្ធ lines default female / Sreymom despite unknown/low noisy pitch
  for (let i = 8; i < 13; i++) {
    assert.equal(res.scriptSegments[i].speaker, 'ប្រព័ន្ធ');
    assert.equal(res.scriptSegments[i].voiceGender, 'female');
    assert.equal(res.scriptSegments[i].voiceId, 'km-KH-SreymomNeural');
  }

  // Neutral named character 'សៀវអ៊ី' flipped in batch 2 converges to female / Sreymom
  for (let i = 13; i < 22; i++) {
    assert.equal(res.scriptSegments[i].speaker, 'សៀវអ៊ី');
    assert.equal(res.scriptSegments[i].voiceGender, 'female');
    assert.equal(res.scriptSegments[i].voiceId, 'km-KH-SreymomNeural');
  }

  // Direct createCanonicalSegment: non-manual Standard segment never retains stale opposite voiceId
  const stdCanon = createCanonicalSegment({
    speaker: 'លីលី',
    voiceGender: 'female',
    voiceId: 'km-KH-PisethNeural',
    khmerTranslatedText: 'សួស្តី',
    startSec: 0,
    endSec: 2,
  }, 0, 'dialogue');
  assert.equal(stdCanon.voiceId, 'km-KH-SreymomNeural');
  assert.equal(stdCanon.khmerVoiceId, 'km-KH-SreymomNeural');
  assert.equal(stdCanon.voice, 'km-KH-SreymomNeural');
});

test('Stage 5 Reconciliation: Propagates pitchHz, acousticGender, acousticConfidence across fusion paths', async () => {
  const res = await reconcileTimelineEvidence({
    visualSegments: [
      { startSec: 1.0, endSec: 3.0, duration: 2.0, originalChineseText: '哥哥等一下', position: 'bottom_subtitle' },
      { startSec: 6.0, endSec: 8.0, duration: 2.0, originalChineseText: '', position: 'bottom_subtitle' },
    ],
    audioSegments: [
      {
        startSec: 1.1,
        endSec: 2.9,
        duration: 1.8,
        spokenChineseText: '哥哥等一下',
        speakerId: 'spk_female',
        audioGender: 'female',
        acousticGender: 'female',
        acousticF0: 218.5,
        acousticConfidence: 0.91,
      },
      {
        startSec: 6.1,
        endSec: 7.9,
        duration: 1.8,
        spokenChineseText: '快走吧',
        speakerId: 'spk_male',
        audioGender: 'male',
        acousticGender: 'male',
        acousticF0: 119.2,
        acousticConfidence: 0.88,
      },
    ],
    durationSec: 10,
  });

  assert.equal(res.reconciledSegments.length, 2);
  assert.equal(res.reconciledSegments[0].pitchHz, 218.5);
  assert.equal(res.reconciledSegments[0].acousticGender, 'female');
  assert.equal(res.reconciledSegments[0].acousticConfidence, 0.91);
  assert.equal(res.reconciledSegments[1].pitchHz, 119.2);
  assert.equal(res.reconciledSegments[1].acousticGender, 'male');
  assert.equal(res.reconciledSegments[1].acousticConfidence, 0.88);
});

test('EpisodeService applySafeDiskHydration: Matches disk MP3 to expected voice and rejects cross-voice mismatch', () => {
  const tmpProjectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrate_voice_test_'));
  const seriesId = 'series_hydrate_check';
  const epId = 'ep_1';
  const epAudioDir = path.join(tmpProjectsRoot, seriesId, 'episodes', epId, 'audio');
  fs.mkdirSync(epAudioDir, { recursive: true });

  try {
    // Seg 1 is Piseth on script, and BOTH Sreymom and Piseth exist on disk (alphabetically Sreymom comes after Piseth!)
    fs.writeFileSync(path.join(epAudioDir, 'ep_1_seg_1_km-KH-PisethNeural_voice_1111aaaa.mp3'), Buffer.alloc(400, 1));
    fs.writeFileSync(path.join(epAudioDir, 'ep_1_seg_1_km-KH-SreymomNeural_voice_2222bbbb.mp3'), Buffer.alloc(400, 1));

    // Seg 2 is Piseth on script, but ONLY Sreymom exists on disk -> must NOT hydrate Sreymom onto Piseth segment
    fs.writeFileSync(path.join(epAudioDir, 'ep_1_seg_2_km-KH-SreymomNeural_voice_3333cccc.mp3'), Buffer.alloc(400, 1));

    // Stale master narration MP3 on disk must NOT re-mark an audioOutdated episode as audioGenerated=true
    fs.writeFileSync(path.join(epAudioDir, `${epId}_narration_khmer.mp3`), Buffer.alloc(1200, 2));

    const seriesMeta = {
      id: seriesId,
      title: 'Test Hydration',
      episodes: [
        {
          id: epId,
          audioGenerated: false,
          audioOutdated: true,
          fullAudioUrl: null,
          scriptData: {
            hasScript: true,
            segments: [
              { id: 1, segmentId: 1, speaker: 'តួឯកប្រុស', voiceGender: 'male', voiceId: 'km-KH-PisethNeural', khmerText: 'សួស្តី' },
              { id: 2, segmentId: 2, speaker: 'តួឯកប្រុស', voiceGender: 'male', voiceId: 'km-KH-PisethNeural', audioOutdated: true, ttsStatus: 'outdated', khmerText: 'លាហើយ' },
            ],
          },
        },
      ],
    };
    fs.writeFileSync(path.join(tmpProjectsRoot, seriesId, 'series.json'), JSON.stringify(seriesMeta, null, 2), 'utf8');

    const loaded = getSeriesMetadata(seriesId, { projectsDir: tmpProjectsRoot });
    const loadedEp = loaded.episodes[0];
    const seg1 = loadedEp.scriptData.segments[0];
    const seg2 = loadedEp.scriptData.segments[1];

    assert.equal(Boolean(loadedEp.audioGenerated), false, 'audioOutdated episode must NOT auto-hydrate stale master narration');
    assert.equal(loadedEp.fullAudioUrl || null, null);
    assert.equal(seg1.audioFile, 'ep_1_seg_1_km-KH-PisethNeural_voice_1111aaaa.mp3');
    assert.equal(seg2.audioFile || null, null, 'Mismatched Sreymom MP3 must NOT be hydrated onto Piseth segment');
  } finally {
    fs.rmSync(tmpProjectsRoot, { recursive: true, force: true });
  }
});

test('segmentModel, ttsService & audioRoutes: System ("ប្រព័ន្ធ") gets Sreymom without manual Piseth hijack', async () => {
  // 1. segmentModel createSegment ignores 'unknown' & stale Piseth for System character
  const modelSeg = createSegment({
    id: 50,
    speaker: 'ប្រព័ន្ធ',
    voiceGender: 'unknown',
    voiceId: 'km-KH-PisethNeural',
    khmerTranslatedText: 'ប្រព័ន្ធបានបើកដំណើរការ',
    startSec: 0,
    endSec: 3,
  }, 0, 'dialogue');
  assert.equal(modelSeg.speakerGender, 'FEMALE');
  assert.equal(modelSeg.voiceGender, 'female');
  assert.equal(modelSeg.voiceId, 'km-KH-SreymomNeural');

  // 2. ttsService offline deterministic voice + cache selection check for "ប្រព័ន្ធ"
  const tmpTtsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts_system_voice_'));
  try {
    const khmerText = 'សូមស្វាគមន៍មកកាន់ប្រព័ន្ធ។';
    const cleaned = cleanTextForTts(khmerText);
    const cacheKey = `${cleaned}__km-KH-SreymomNeural__out_loud__clean__+0%__fit__lt1`;
    const cacheHash = crypto.createHash('md5').update(cacheKey).digest('hex').substring(0, 8);
    const cachedSreymomMp3 = path.join(tmpTtsDir, `ep_sys_seg_101_km-KH-SreymomNeural_voice_${cacheHash}.mp3`);

    // Generate tiny real valid MP3 with bundled ffmpeg so getMediaDuration validates cleanly without network
    const ffRes = spawnSync(ffmpegInstaller.path, [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.6', '-c:a', 'libmp3lame', '-b:a', '48k', cachedSreymomMp3,
    ], { windowsHide: true });
    assert.equal(ffRes.status, 0, 'Bundled ffmpeg should create valid silent MP3 for cache hit test');

    const ttsOut = await generateSingleSegmentAudio(
      {
        id: 101,
        speaker: 'ប្រព័ន្ធ',
        speakerId: 'spk_unknown_ប្រព_ន្ធ',
        voiceGender: 'unknown',
        voiceId: 'km-KH-PisethNeural', // stale stage3 default without manual flag
        khmer: khmerText,
        startSec: 0,
        endSec: 2,
      },
      tmpTtsDir,
      {
        episodeId: 'sys',
        voiceId: 'km-KH-PisethNeural', // batch default must NOT override System female voice!
      }
    );

    assert.equal(ttsOut.voiceId, 'km-KH-SreymomNeural');
    assert.equal(ttsOut.khmerVoiceId, 'km-KH-SreymomNeural');
    assert.equal(ttsOut.voiceGender, 'female');
  } finally {
    fs.rmSync(tmpTtsDir, { recursive: true, force: true });
  }

  // 3. Static guard on audioRoutes.js: never default destructured voiceId to Piseth (which falsely set isManual=true)
  const audioRoutesCode = fs.readFileSync(path.resolve(__dirname, '../routes/audioRoutes.js'), 'utf8');
  assert.ok(audioRoutesCode.includes('voiceId: rawBodyVoiceId,'), 'audioRoutes must not default destructured voiceId to Piseth');
});

