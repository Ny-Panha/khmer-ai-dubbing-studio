const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const backendTq = require('../utils/translationQuality');
const { filterValidChineseAsrSegments } = require('../services/pipeline/stages/stage4_analyzeDialogueAudio');
const { reconcileTimelineEvidence } = require('../services/pipeline/stages/stage5_reconcileTimelineEvidence');
const { generateModeSpecificScript } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { isPlaceholderTranslationText } = require('../services/pipeline/stages/stage6PromptAndConsistency');
const {
  KHMER_DUBBING_BASE_SYSTEM_PROMPT,
  systemPrompt,
  retranslateSingleDialogue,
  retranslateBatchDialogues,
} = require('../services/geminiService');
const { autoShortenOverflowingSegments } = require('../services/pipeline/stages/stage9_generateSegmentTTS');
const { cleanTextForTts, isPlaceholderOrEmptyTtsText } = require('../services/ttsService');

test('translationQuality (backend + frontend ESM): expressive vocalization helpers, junk exemption & descriptive label check', async () => {
  const frontendTqUrl = pathToFileURL(
    path.resolve(__dirname, '../../frontend/src/utils/translationQuality.js')
  ).href;
  const frontendTq = await import(frontendTqUrl);

  assert.equal(backendTq.EXPRESSIVE_KHMER_DUBBING_RULES, frontendTq.EXPRESSIVE_KHMER_DUBBING_RULES);
  assert.match(backendTq.EXPRESSIVE_KHMER_DUBBING_RULES, /សើច/);
  assert.match(backendTq.EXPRESSIVE_KHMER_DUBBING_RULES, /ហាហាហាហា!/);
  assert.match(backendTq.EXPRESSIVE_KHMER_DUBBING_RULES, /sourceCueId/);

  const expressiveSamples = ['哈哈哈', '呵呵', '啊啊啊', '啊呃啊', '咳咳咳', '嗯嗯嗯', '哼', '唉', 'hahaha', 'hehehe', 'hmm...', 'uh... ah!'];
  for (const sample of expressiveSamples) {
    assert.equal(backendTq.isExpressiveVocalizationSource(sample), true, `Expected expressive vocalization: ${sample}`);
    assert.equal(frontendTq.isExpressiveVocalizationSource(sample), true, `Frontend parity for: ${sample}`);
  }

  const hallucinationSamples = ['The.', 'Yeah.', 'Okay', 'Thank you for watching'];
  for (const sample of hallucinationSamples) {
    assert.equal(backendTq.isExpressiveVocalizationSource(sample), false, `Expected non-vocalization: ${sample}`);
    assert.equal(frontendTq.isExpressiveVocalizationSource(sample), false);
  }

  // Latin vocalizations from SenseVoice/ASR must NOT be auto-dropped as hallucinations
  assert.equal(
    backendTq.isNonChineseAsrHallucination({
      evidenceSource: 'audio_asr',
      spokenAudioText: 'hahaha',
      originalChineseText: 'hahaha',
      ocrSubtitleText: '',
    }),
    false
  );
  assert.equal(
    frontendTq.isNonChineseAsrHallucination({
      evidenceSource: 'sense_voice_local',
      spokenAudioText: 'hehehe',
      originalChineseText: 'hehehe',
      ocrSubtitleText: '',
    }),
    false
  );
  assert.equal(
    backendTq.isNonChineseAsrHallucination({
      evidenceSource: 'audio_asr',
      spokenAudioText: 'The.',
      originalChineseText: 'The.',
      ocrSubtitleText: '',
    }),
    true
  );

  // Repeated expressive laughter across slightly varied source strings must NOT be flagged as broken junk
  const laughSegs = [
    { id: 1, chineseText: '哈哈哈', khmerText: 'ហាហាហាហា!' },
    { id: 2, chineseText: '哈哈', khmerText: 'ហាហាហាហា!' },
    { id: 3, chineseText: '哈哈哈!', khmerText: 'ហាហាហាហា!' },
    { id: 4, chineseText: 'hahaha', khmerText: 'ហាហាហាហា!' },
    { id: 5, chineseText: '哈哈！', khmerText: 'ហាហាហាហា!' },
  ];
  assert.equal(backendTq.findRepeatedJunkKhmerSet(laughSegs).has('ហាហាហាហា!'), false);
  assert.equal(frontendTq.findRepeatedJunkKhmerSet(laughSegs).has('ហាហាហាហា!'), false);

  // Pure descriptive labels ("សើច", "យំ", "ក្អក", "ស្រែក") for vocalizations are broken, whereas real dialogue using them is NOT
  assert.equal(backendTq.isSegmentTextBroken({ chineseText: '哈哈哈', khmerText: 'សើច' }), true);
  assert.equal(frontendTq.isSegmentTextBroken({ chineseText: '啊啊啊', khmerText: 'ស្រែក' }), true);
  assert.equal(backendTq.isSegmentTextBroken({ chineseText: '咳咳咳', khmerText: 'ក្អក' }), true);
  assert.equal(backendTq.isSegmentTextBroken({ chineseText: '他在笑', khmerText: 'សើច' }), false);
  assert.equal(backendTq.isSegmentTextBroken({ chineseText: '哈哈哈', khmerText: 'ហាហាហាហា!' }), false);
});

test('Stage 4 ASR filter and Stage 5 reconciliation preserve short vocalizations and interjections 1:1', async () => {
  const stage4 = filterValidChineseAsrSegments([
    { startSec: 0.5, endSec: 1.2, text: 'The.', chineseText: 'The.' },
    { startSec: 1.5, endSec: 2.3, text: 'hahaha', spokenAudioText: 'hahaha' },
    { startSec: 2.6, endSec: 3.1, text: '哼', spokenChineseText: '哼' },
    { startSec: 3.5, endSec: 4.0, text: 'Yeah.' },
  ]);
  assert.deepEqual(
    stage4.map((s) => s.text),
    ['hahaha', '哼']
  );

  const { reconciledSegments } = await reconcileTimelineEvidence({
    visualSegments: [
      {
        startSec: 0.5,
        endSec: 1.3,
        originalChineseText: '哼',
        sourceCueId: 'cue_v_1',
        speaker: 'តួប្រុស',
        detectedGender: 'male',
      },
      {
        startSec: 1.6,
        endSec: 2.8,
        originalChineseText: '哈哈哈',
        sourceCueId: 'cue_v_2',
        speaker: 'តួស្រី',
        detectedGender: 'female',
      },
    ],
    audioSegments: [
      {
        startSec: 3.2,
        endSec: 4.1,
        spokenChineseText: '唉',
        sourceCueId: 'cue_a_1',
        speaker: 'តួប្រុស',
        detectedGender: 'male',
      },
      {
        startSec: 4.5,
        endSec: 5.8,
        spokenChineseText: '咳咳咳',
        sourceCueId: 'cue_a_2',
        speaker: 'តួស្រី',
        detectedGender: 'female',
      },
    ],
    durationSec: 7.0,
    mode: 'dialogue',
  });

  const texts = reconciledSegments.map((s) => s.originalChineseText);
  assert.ok(texts.includes('哼'), 'Visual 1-char interjection 哼 must be preserved');
  assert.ok(texts.includes('哈哈哈'), 'Visual laughter 哈哈哈 must be preserved');
  assert.ok(texts.includes('唉'), 'Audio 1-char sigh 唉 must be preserved');
  assert.ok(texts.includes('咳咳咳'), 'Audio cough 咳咳咳 must be preserved');
});

test('Stage 6 cache guard + Mode A translation preserve expressive vocalizations, sourceCueId, and voice identity', async () => {
  assert.equal(isPlaceholderTranslationText('សើច', '哈哈哈'), true);
  assert.equal(isPlaceholderTranslationText('ក្អក', '咳咳咳'), true);
  assert.equal(isPlaceholderTranslationText('ហាហាហាហា!', '哈哈哈'), false);
  assert.equal(isPlaceholderTranslationText('ហ៊ឹស!', '哼'), false);

  const capturedPrompts = [];
  const mockAiClient = {
    models: {
      generateContent: async ({ contents }) => {
        const prompt = Array.isArray(contents) ? contents.join('\n') : String(contents || '');
        capturedPrompts.push(prompt);
        return {
          text: JSON.stringify({
            summary: 'Expressive test',
            segments: [
              { index: 1, segmentId: 1, sourceCueId: 'cue_1', speaker: 'តួឯកប្រុស', gender: 'male', khmerText: 'ហ៊ឹស!' },
              { index: 2, segmentId: 2, sourceCueId: 'cue_2', speaker: 'តួឯកស្រី', gender: 'female', khmerText: 'ហាហាហាហា!' },
              { index: 3, segmentId: 3, sourceCueId: 'cue_3', speaker: 'តួឯកប្រុស', gender: 'male', khmerText: 'ខក់! ខក់! ខក់!' },
            ],
          }),
        };
      },
    },
  };

  const result = await generateModeSpecificScript({
    mode: 'dialogue',
    durationSec: 6.0,
    aiClient: mockAiClient,
    seriesId: 'test_expressive_cache_bypass',
    reconciledSegments: [
      { id: 1, index: 1, segmentId: 1, sourceCueId: 'cue_1', startSec: 0.5, endSec: 1.2, originalChineseText: '哼', speaker: 'តួឯកប្រុស', gender: 'male', voice: 'km-KH-PisethNeural' },
      { id: 2, index: 2, segmentId: 2, sourceCueId: 'cue_2', startSec: 1.4, endSec: 2.6, originalChineseText: '哈哈哈', speaker: 'តួឯកស្រី', gender: 'female', voice: 'km-KH-SreymomNeural' },
      { id: 3, index: 3, sourceCueId: 'cue_3', startSec: 3.0, endSec: 4.5, originalChineseText: '咳咳咳', speaker: 'តួឯកប្រុស', gender: 'male', voice: 'km-KH-PisethNeural' },
    ],
  });

  assert.ok(capturedPrompts.length >= 1);
  assert.match(capturedPrompts[0], /NEVER translate audible sounds into descriptive words/);
  const segs = result.scriptSegments;
  assert.equal(segs.length, 3);
  assert.equal(segs[0].sourceCueId, 'cue_1');
  assert.equal(segs[0].khmerText, 'ហ៊ឹស!');
  assert.equal(segs[0].voice, 'km-KH-PisethNeural');
  assert.equal(segs[1].sourceCueId, 'cue_2');
  assert.equal(segs[1].khmerText, 'ហាហាហាហា!');
  assert.equal(segs[1].voice, 'km-KH-SreymomNeural');
  assert.equal(segs[2].sourceCueId, 'cue_3');
  assert.equal(segs[2].khmerText, 'ខក់! ខក់! ខក់!');
});

test('geminiService single, batch normal & compact dubbing prompts include expressive rules and keep 1:1 cue mapping & voices', async () => {
  assert.match(KHMER_DUBBING_BASE_SYSTEM_PROMPT, /EXPRESSIVE SOUNDS/);
  assert.match(systemPrompt, /EXPRESSIVE SOUNDS/);

  const seenConfigs = [];
  const mockAiClient = {
    models: {
      generateContent: async ({ contents, config }) => {
        const prompt = Array.isArray(contents) ? contents.join('\n') : String(contents || '');
        const sysInst = config?.systemInstruction || '';
        seenConfigs.push({ prompt, systemInstruction: sysInst });
        if ((prompt + '\n' + sysInst).includes('3 distinctive options')) {
          return {
            text: JSON.stringify({
              chinese: '啊呃啊',
              options: [
                { style: 'classical', label: '🎭 សម្ដីកុនបុរាណ', text: 'អា៎... អឺ... អា៎!' },
                { style: 'compact', label: '📝 ខ្លីចំអត្ថន័យ', text: 'អា៎... អឺ... អា៎!' },
                { style: 'natural', label: '🗣️ និយាយធម្មជាតិ', text: 'អា៎... អឺ... អា៎!' },
              ],
              note: 'Expressive phonetic vocalization',
            }),
          };
        }
        return {
          text: JSON.stringify([
            { id: 10, sourceCueId: 'cue_10', khmerText: 'ហេហេហេ...' },
            { id: 11, sourceCueId: 'cue_11', khmerText: 'ហ៊ឺ...' },
          ]),
        };
      },
    },
  };

  const singleRes = await retranslateSingleDialogue('啊呃啊', null, { aiClient: mockAiClient });
  assert.equal(singleRes.options[1].text, 'អា៎... អឺ... អា៎!');
  assert.match(seenConfigs[0].systemInstruction, /EXPRESSIVE SOUNDS/);

  const inputSegs = [
    { id: 10, sourceCueId: 'cue_10', startSec: 0.5, endSec: 1.5, chineseText: '呵呵', khmerText: 'ហេហេ', speaker: 'តួស្រី', voice: 'km-KH-SreymomNeural' },
    { id: 11, sourceCueId: 'cue_11', startSec: 2.0, endSec: 2.8, chineseText: '唉', khmerText: 'ហ៊ឺ', speaker: 'តួប្រុស', voice: 'km-KH-PisethNeural' },
  ];

  const compactOut = await retranslateBatchDialogues(inputSegs, null, {
    aiClient: mockAiClient,
    style: 'compact',
  });
  assert.equal(compactOut.length, 2);
  assert.equal(compactOut[0].sourceCueId, 'cue_10');
  assert.equal(compactOut[0].khmer, 'ហេហេហេ...');
  assert.equal(compactOut[0].voice, 'km-KH-SreymomNeural');
  assert.equal(compactOut[1].sourceCueId, 'cue_11');
  assert.equal(compactOut[1].khmer, 'ហ៊ឺ...');
  assert.equal(compactOut[1].voice, 'km-KH-PisethNeural');
  assert.match(seenConfigs[1].prompt, /Expressive Sounds & Emotional Vocalizations \(AUTO-COMPACT SAFE\)/);
  assert.match(seenConfigs[1].prompt, /ហាហាហាហា!/);

  await retranslateBatchDialogues(inputSegs, null, {
    aiClient: mockAiClient,
    style: 'natural',
  });
  assert.match(seenConfigs[2].prompt, /EXPRESSIVE SOUNDS/);
});

test('Stage 9 autoShortenOverflowingSegments protects expressive vocalizations and Edge TTS validates all 8 examples', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd_expressive_s9_'));
  let seenPrompt = '';
  const mockAi = {
    models: {
      generateContent: async ({ contents }) => {
        seenPrompt = Array.isArray(contents) ? contents.join('\n') : String(contents || '');
        return {
          text: JSON.stringify({
            segments: [
              { index: 2, segmentId: 102, khmerText: 'អា៎! អា៎! អា៎!' },
            ],
          }),
        };
      },
    },
  };

  try {
    const out = await autoShortenOverflowingSegments({
      audioDir: tmpDir,
      aiClient: mockAi,
      segments: [
        // < 10 chars short vocalization must never be sent/shortened
        { id: 101, startSec: 0, endSec: 0.4, chineseText: '哼', khmer: 'ហ៊ឹស!', audioDurationSec: 0.6 },
        // >= 10 chars overflowing expressive exclamation triggers shortenPrompt with protection rules
        { id: 102, startSec: 1, endSec: 1.8, slotDuration: 0.8, chineseText: '啊啊啊', khmer: 'អា៎! អា៎! អា៎! អា៎!', audioDurationSec: 2.3 },
      ],
      generateSingleFn: async (draftSeg, dir) => {
        const outFile = path.join(dir, `seg_${draftSeg.id}.mp3`);
        fs.writeFileSync(outFile, Buffer.from('FAKE_MP3'));
        return {
          audioPath: outFile,
          finalAudioDuration: 0.75,
          audioDurationSec: 0.75,
        };
      },
    });
    assert.match(seenPrompt, /EXPRESSIVE SOUNDS PROTECTION \(AUTO-COMPACT\)/);
    assert.match(seenPrompt, /សើច/);
    assert.equal(out.segments[0].khmer, 'ហ៊ឹស!');
    assert.equal(out.segments[1].khmer, 'អា៎! អា៎! អា៎!');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const examples = [
    'ហាហាហាហា!',
    'ហេហេហេ...',
    'អា៎! អា៎! អា៎!',
    'អា៎... អឺ... អា៎!',
    'ខក់! ខក់! ខក់!',
    'អ៊ឹម... អ៊ឹម...',
    'ហ៊ឹស!',
    'ហ៊ឺ...',
  ];
  for (const ex of examples) {
    assert.equal(isPlaceholderOrEmptyTtsText(ex), false, `Must be speakable non-placeholder TTS text: ${ex}`);
    assert.ok(cleanTextForTts(ex).trim().length > 0, `cleanTextForTts must preserve speakable text for: ${ex}`);
  }
});
